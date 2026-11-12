#!/usr/bin/env python3
"""Deterministic generation, checking, preview, build and acceptance core.

This module is the single implementation used by:
  * templates/s3/scripts/{generate,verify}.py (S3 template entry points)
  * skill/nacl-ui/scripts/nacl_ui.py (distributable UI Skill)

The caller resolves a `Distribution` from the script location. The same code
therefore runs from the repository template and from a copied distribution
without reading the original repository at generation/build time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

EXCLUDED = {"node_modules", "dist", "target", ".vite", "gen", "__pycache__", ".tmp", ".git"}
VALID_MODES = ("a", "b", "d")
VALID_ADAPTERS = ("ipc", "mock")
LAYOUT_LABELS = {"sidebar": "侧栏工作台", "studio": "命令工作台", "nacl": "NaCL"}

# Product documentation that cannot be regenerated from the managed inputs.
# A distribution or backup lacking these is incomplete, not "one file less".
REQUIRED_DISTRIBUTION_DOCS = (
    "README.md",
    "SKILL.md",
    "LICENSE",
    "THIRD-PARTY-NOTICES.md",
    "references/boundaries.md",
    "references/modes.md",
    "references/troubleshooting.md",
    "references/workflow.md",
)


def missing_distribution_docs(root: Path) -> list[str]:
    missing: list[str] = []
    for relative in REQUIRED_DISTRIBUTION_DOCS:
        path = root / relative
        if not path.is_file() or path.stat().st_size == 0:
            missing.append(relative)
    return missing



class ToolError(Exception):
    """Expected failure with a stable code and process exit code."""

    def __init__(
        self,
        code: str,
        message: str,
        exit_code: int = 1,
        *,
        path: str | None = None,
        hint: str | None = None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.path = path
        self.hint = hint
        self.details = details

    def as_dict(self) -> dict:
        value = {"code": self.code, "message": self.message, "exitCode": self.exit_code}
        if self.path:
            value["path"] = self.path
        if self.hint:
            value["hint"] = self.hint
        if self.details is not None:
            value["details"] = self.details
        return value


def configure_stdio() -> None:
    """Emit JSON on stdout/stderr as UTF-8 regardless of the Windows code page.

    Callers must decode UTF-8. This does not depend on PYTHONUTF8 or the user's
    locale, and it never drops characters with errors="ignore".
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="strict")


def json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def is_json_object(value: Any) -> bool:
    return isinstance(value, dict)


READ_FAILED = object()


def nested_get(value: Any, *keys: str, default: Any = None) -> Any:
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return current


def root_error(
    file_label: str,
    label: str,
    value: Any,
    *,
    json_path: str | None = None,
) -> dict:
    return {
        "path": json_path or f"{file_label}#",
        "code": "config/invalid-root",
        "message": f"{label}的 JSON 根必须是对象，实际为 {json_type_name(value)}",
        "file": file_label,
    }


def add_root_error_once(errors: list[dict], error: dict) -> None:
    file_label = error.get("file")
    for item in errors:
        if item.get("code") != "config/invalid-root":
            continue
        if item.get("file") == file_label or str(item.get("path", "")).startswith(f"{file_label}#"):
            return
    errors.append(error)


@dataclass
class Distribution:
    kind: str  # "source" | "distribution"
    root: Path
    starter: Path
    templates: Path
    schemas: Path
    sdk_crate: Path
    sdk_contracts: Path
    shell: Path
    shell_contracts: Path
    shell_lock: Path
    compatibility: Path
    page_tool: Path
    hints: Path
    cli: Path
    brand: str
    identifier_prefix: str

    @property
    def forbidden(self) -> list[str]:
        values = []
        root = str(self.root)
        values.extend([root, root.replace("\\", "/")])
        if self.kind == "source":
            repo = str(self.root.parents[1])
            values.extend([repo, repo.replace("\\", "/")])
        return sorted(set(values))


def find_distribution() -> Distribution:
    root = Path(__file__).resolve().parents[1]
    page_tool = root / "scripts" / "page-tool.mjs"
    hints = root / "scripts" / "error-hints.json"
    cli = root / "scripts" / "nacl_ui.py"
    if (root / "DISTRIBUTION.json").is_file() and (root / "assets" / "starter").is_dir():
        return Distribution(
            kind="distribution",
            root=root,
            starter=root / "assets" / "starter",
            templates=root / "assets" / "templates",
            schemas=root / "schemas",
            sdk_crate=root / "assets" / "sdk" / "nacl-next-sdk",
            sdk_contracts=root / "assets" / "sdk" / "contracts",
            shell=root / "assets" / "shell" / "src-tauri",
            shell_contracts=root / "assets" / "shell" / "contracts",
            shell_lock=root / "assets" / "shell" / "Cargo.lock",
            compatibility=root / "assets" / "compatibility.json",
            page_tool=page_tool,
            hints=hints,
            cli=cli,
            brand="",
            identifier_prefix="local.nacl-next",
        )
    if (root / "starter").is_dir() and (root / "layouts").is_dir():
        repo = root.parents[1]
        return Distribution(
            kind="source",
            root=root,
            starter=root / "starter",
            templates=root / "layouts",
            schemas=root / "schema",
            sdk_crate=repo / "sdk" / "nacl-next-sdk",
            sdk_contracts=repo / "sdk" / "contracts",
            shell=repo / "apps" / "s1-shell" / "src-tauri",
            shell_contracts=repo / "apps" / "s1-shell" / "contracts",
            shell_lock=root / "sdk-git.lock",
            compatibility=root / "compatibility.json",
            page_tool=page_tool,
            hints=hints,
            cli=cli,
            brand="S3 ",
            identifier_prefix="local.nacl-next.s3",
        )
    raise ToolError(
        "dist/manifest-missing",
        f"{root} 既不是 S3 模板也不是完整的分发目录；请复制完整 nacl-ui 目录",
        exit_code=2,
    )


def read_json(path: Path) -> Any:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ToolError(
            "config/invalid-encoding",
            f"{path} 不是有效的 UTF-8：{error.reason}（字节偏移 {error.start}）",
            exit_code=2,
            path=str(path),
        ) from error
    except OSError as error:
        raise ToolError(
            "config/read-failed",
            f"无法读取 {path}：{error}",
            exit_code=2,
            path=str(path),
        ) from error
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise ToolError(
            "config/read-failed",
            f"无法读取 {path}：{error}",
            exit_code=2,
            path=str(path),
        ) from error


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json_object(path: Path, label: str = "配置文件") -> dict:
    value = read_json(path)
    if not isinstance(value, dict):
        raise ToolError(
            "config/invalid-root",
            f"{label}的 JSON 根必须是对象，实际为 {json_type_name(value)}：{path}",
            exit_code=2,
            path=str(path),
            hint="把该文件改为 JSON 对象；null、数组、字符串和数字都不是有效根。",
        )
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_files(root: Path, excluded: Iterable[str] = EXCLUDED) -> str:
    excluded_set = set(excluded)
    digest = hashlib.sha256()
    files = [
        item
        for item in root.rglob("*")
        if item.is_file()
        and not any(part in excluded_set for part in item.relative_to(root).parts)
    ]
    for item in sorted(files, key=lambda value: value.relative_to(root).as_posix()):
        relative = item.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(item.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def copy_tree(source: Path, destination: Path, extra_excluded: Iterable[str] = ()) -> None:
    excluded = EXCLUDED | set(extra_excluded)
    for entry in sorted(source.rglob("*")):
        relative = entry.relative_to(source)
        if any(part in excluded for part in relative.parts):
            continue
        if entry.is_symlink():
            raise ToolError("project/missing-file", f"源包含符号链接，拒绝复制：{relative}", exit_code=2)
        target = destination / relative
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(entry, target)


RENAME_RETRY_DELAYS = (0.0, 0.05, 0.1, 0.2, 0.4, 0.8)
TRANSIENT_RENAME_WINERRORS = {5, 32, 33}


def _is_transient_rename_error(error: OSError) -> bool:
    return isinstance(error, PermissionError) or getattr(error, "winerror", None) in TRANSIENT_RENAME_WINERRORS


def replace_directory(source: Path, destination: Path) -> None:
    """Commit a completed staging directory with a bounded transient retry.

    Windows can refuse MoveFileEx for a freshly written directory while another
    process briefly holds a handle (observed only inside a watched workspace;
    an immediate retry usually succeeds). The retry is bounded and only for
    access/sharing errors; the target is never written before the swap and the
    caller cleans the staging directory on final failure.
    """
    attempts = 0
    last_error: OSError | None = None
    for index, delay in enumerate(RENAME_RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        attempts = index + 1
        try:
            os.replace(source, destination)
            return
        except OSError as error:
            last_error = error
            if not _is_transient_rename_error(error):
                break
    raise ToolError(
        "project/commit-failed",
        f"无法提交生成目录：{last_error}",
        exit_code=1,
        path=str(destination),
        hint="目标未被覆盖，暂存目录已清理；确认目标路径未被其他进程占用后重跑。",
        details={
            "staging": str(source),
            "destination": str(destination),
            "attempts": attempts,
            "lastError": repr(last_error),
        },
    )


def parse_package_version(path: Path, field: str = "version") -> str:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ToolError("compat/source-missing", f"缺少 {path}：{error}", exit_code=2) from error
    match = re.search(rf'^{re.escape(field)}\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        raise ToolError("compat/source-missing", f"{path} 缺少 {field}", exit_code=2)
    return match.group(1)


def load_hints(dist: Distribution) -> dict[str, str]:
    try:
        return read_json(dist.hints)
    except ToolError:
        return {}


def hint_for(hints: dict[str, str], code: str) -> str | None:
    if code in hints:
        return hints[code]
    for prefix in ("schema/", "page/", "project/", "config/", "contract/", "compat/", "dist/", "env/", "build/", "preview/"):
        if code.startswith(prefix) and f"{prefix}*" in hints:
            return hints[f"{prefix}*"]
    return None


def run_node_json(dist: Distribution, args: list[str], timeout: int = 600) -> dict:
    node = shutil.which("node") or shutil.which("node.exe")
    if not node:
        raise ToolError("env/missing-node", "找不到 Node.js；安装 Node 后重试", exit_code=3)
    result = subprocess.run(
        [node, str(dist.page_tool), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
    )
    stdout = (result.stdout or "").strip()
    try:
        payload = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        payload = {}
    if result.returncode != 0:
        errors = payload.get("errors") or []
        message = (result.stderr or stdout or "页面工具执行失败").strip()
        raise ToolError(
            "tool/internal",
            message[-2000:],
            exit_code=2,
            details={"errors": errors, "stderr": (result.stderr or "")[-4000:]},
        )
    if not payload:
        raise ToolError("tool/internal", "页面工具没有返回 JSON", exit_code=2)
    return payload


def check_compatibility(dist: Distribution) -> dict:
    compat = read_json_object(dist.compatibility, "兼容记录")
    errors: list[dict] = []
    distribution = dist.kind == "distribution"
    compat_label = "assets/compatibility.json" if distribution else "compatibility.json"
    starter_label = "assets/starter/package.json" if distribution else "starter/package.json"
    shell_label = "assets/shell/src-tauri/Cargo.toml" if distribution else "apps/s1-shell/src-tauri/Cargo.toml"
    sdk_label = "assets/sdk/nacl-next-sdk/Cargo.toml" if distribution else "sdk/nacl-next-sdk/Cargo.toml"

    def add(code: str, message: str, path: str | None = None) -> None:
        errors.append({"code": code, "message": message, "path": path} if path else {"code": code, "message": message})

    if compat.get("templateVersion") != 1:
        add("compat/template-version", f"templateVersion 必须为 1，实际 {compat.get('templateVersion')}")
    if compat.get("pageSchemaVersion") != 1:
        add("compat/page-schema", f"pageSchemaVersion 必须为 1，实际 {compat.get('pageSchemaVersion')}")
    try:
        navigation_version = nested_get(inspect_contract(dist), "layouts", "nacl", "navigationVersion")
        if compat.get("naclNavigationVersion") != navigation_version or navigation_version != 1:
            add("compat/page-schema", "NaCL 导航版本与注册表不一致", f"{compat_label}#/naclNavigationVersion")
    except ToolError:
        add("compat/page-schema", "无法核对 NaCL 导航注册表", f"{compat_label}#/naclNavigationVersion")

    sdk_version = nested_get(compat, "sdk", "version")
    starter_package = read_json_object(dist.starter / "package.json", "starter package.json")
    dependencies = starter_package.get("dependencies")
    dev_dependencies = starter_package.get("devDependencies")
    installed = {
        **(dependencies if isinstance(dependencies, dict) else {}),
        **(dev_dependencies if isinstance(dev_dependencies, dict) else {}),
    }
    npm_compat = compat.get("npm")
    for name, expected in (npm_compat if isinstance(npm_compat, dict) else {}).items():
        if installed.get(name) != expected:
            add(
                "compat/npm-version",
                f"npm 版本漂移：{name} 期望 {expected}，模板为 {installed.get(name)}",
                f"{starter_label}#/dependencies/{name}",
            )

    try:
        shell_manifest = (dist.shell / "Cargo.toml").read_text(encoding="utf-8")
    except OSError as error:
        add("compat/source-missing", f"缺少 IPC 壳清单：{error}", shell_label)
        shell_manifest = ""
    cargo_compat = compat.get("cargo")
    for crate, expected in (cargo_compat if isinstance(cargo_compat, dict) else {}).items():
        match = re.search(
            rf'^{re.escape(crate)}\s*=\s*\{{\s*version\s*=\s*"=([^"]+)"',
            shell_manifest,
            re.MULTILINE,
        )
        if not match or match.group(1) != expected:
            add("compat/cargo-version", f"Cargo 版本漂移：{crate} 期望 {expected}", shell_label)

    page_schema = read_json_object(dist.schemas / "page.schema.json", "页面 Schema")
    properties = page_schema.get("properties")
    if not isinstance(properties, dict) or "schemaVersion" not in properties:
        add("compat/page-schema", "页面 Schema 缺少 schemaVersion 属性")

    required_files = [
        ("assets/starter/package-lock.json" if distribution else "starter/package-lock.json", dist.starter / "package-lock.json"),
        ("schemas/project.schema.json", dist.schemas / "project.schema.json"),
        ("assets/sdk/contracts/InstanceConfig.ts" if distribution else "sdk/contracts/InstanceConfig.ts", dist.sdk_contracts / "InstanceConfig.ts"),
        ("assets/shell/contracts/TaskRecord.ts" if distribution else "apps/s1-shell/contracts/TaskRecord.ts", dist.shell_contracts / "TaskRecord.ts"),
        ("assets/shell/Cargo.lock" if distribution else "apps/s1-shell/src-tauri/Cargo.lock", dist.shell_lock),
    ]
    for label, required in required_files:
        if not required.is_file():
            add("compat/source-missing", f"缺少必要文件 {label}", label)

    snapshot_hash = sha256_files(dist.sdk_contracts)
    if nested_get(compat, "sdk", "contractsSha256") != snapshot_hash:
        add("compat/sdk-source", "SDK 契约哈希与固定提交的兼容记录不一致")
    import tomllib
    try:
        lock = tomllib.loads(dist.shell_lock.read_text(encoding="utf-8"))
        sdk = compat["sdk"]
        expected_source = f'git+{sdk["git"]}?rev={sdk["rev"]}#{sdk["rev"]}'
        packages = [p for p in lock["package"] if p.get("name") == "nacl-next-sdk"]
        if len(packages) != 1 or packages[0].get("source") != expected_source or packages[0].get("version") != sdk_version:
            add("compat/sdk-source", "Cargo 锁文件 SDK 来源与兼容记录不一致")
    except (OSError, ValueError, KeyError, TypeError) as error:
        add("compat/sdk-source", f"无法解析 Cargo 锁文件：{error}")

    if dist.kind == "distribution":
        lock_path = dist.root / "assets/validator-lock.json"
        if not lock_path.is_file():
            add("compat/validator-drift", "分发缺少 assets/validator-lock.json", "assets/validator-lock.json")
        else:
            lock = read_json_object(lock_path, "校验器锁")
            pairs = (
                ("pageSchemaSha256", dist.schemas / "page.schema.json"),
                ("projectSchemaSha256", dist.schemas / "project.schema.json"),
                ("pageValidatorSha256", dist.starter / "src/validation/generated/page-validator.mjs"),
                ("projectValidatorSha256", dist.starter / "src/validation/generated/project-validator.mjs"),
            )
            for key, path in pairs:
                if not path.is_file():
                    add("compat/validator-drift", f"缺少 {key} 对应文件", path.name)
                elif lock.get(key) != sha256_file(path):
                    add(
                        "compat/validator-drift",
                        f"{key} 与当前文件不一致；重新组装分发",
                        "assets/validator-lock.json",
                    )

    if dist.kind == "distribution":
        manifest_path = dist.root / "DISTRIBUTION.json"
        if not manifest_path.is_file():
            add("dist/manifest-missing", "分发缺少 DISTRIBUTION.json")
        else:
            manifest = read_json_object(manifest_path, "分发表")
            if manifest.get("templateVersion") != compat.get("templateVersion"):
                add("dist/compatibility-mismatch", "DISTRIBUTION.templateVersion 与兼容记录不一致")
            if manifest.get("pageSchemaVersion") != compat.get("pageSchemaVersion"):
                add("dist/compatibility-mismatch", "DISTRIBUTION.pageSchemaVersion 与兼容记录不一致")
            if nested_get(manifest, "sdk", "version") != sdk_version:
                add("dist/compatibility-mismatch", "DISTRIBUTION SDK 版本与快照不一致")
            if any(nested_get(manifest, "sdk", key) != nested_get(compat, "sdk", key) for key in ("git", "rev")):
                add("dist/compatibility-mismatch", "DISTRIBUTION SDK Git 来源不一致")
            if nested_get(manifest, "sdk", "contractsSha256") != snapshot_hash:
                add("dist/compatibility-mismatch", "DISTRIBUTION SDK 契约哈希与当前文件不一致")
            compatibility_hash = sha256_file(dist.compatibility)
            if nested_get(manifest, "compatibility", "sha256") != compatibility_hash:
                add("dist/compatibility-mismatch", "DISTRIBUTION 兼容记录哈希与当前文件不一致")

    if errors:
        raise ToolError(
            "compat/invalid",
            "兼容检查失败：" + "；".join(item["message"] for item in errors[:5]),
            exit_code=2,
            details={"errors": errors},
        )
    return {
        "compatibility": compat,
        "sdkVersion": sdk_version,
        "contractsSha256": snapshot_hash,
    }


def self_check(dist: Distribution, critical_only: bool = False) -> dict:
    if dist.kind != "distribution":
        return {"ok": True, "skipped": "source layout has no DISTRIBUTION.json", "files": 0}
    manifest_path = dist.root / "DISTRIBUTION.json"
    if not manifest_path.is_file():
        raise ToolError("dist/manifest-missing", "分发缺少 DISTRIBUTION.json", exit_code=2)
    manifest = read_json_object(manifest_path, "分发表")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ToolError(
            "dist/manifest-invalid",
            "DISTRIBUTION.json 的 files 必须是对象",
            exit_code=2,
            path=str(manifest_path),
        )
    errors: list[dict] = []
    checked = 0
    manifest_files = set(files)
    for relative in missing_distribution_docs(dist.root):
        errors.append(
            {
                "code": "dist/hand-authored-missing",
                "path": relative,
                "message": f"分发缺少必需手写资料或文件为空：{relative}",
            }
        )
    for relative in REQUIRED_DISTRIBUTION_DOCS:
        if relative not in manifest_files:
            errors.append(
                {
                    "code": "dist/hand-authored-missing",
                    "path": relative,
                    "message": f"分发表未登记必需手写资料：{relative}",
                }
            )
    critical_prefixes = ("assets/", "schemas/", "scripts/")

    expected_critical = set()
    for relative, meta in sorted(files.items()):
        if not isinstance(meta, dict):
            errors.append(
                {
                    "code": "dist/manifest-invalid",
                    "path": relative,
                    "message": f"分发清单条目必须是对象：{relative}",
                }
            )
            continue
        critical = bool(meta.get("critical"))
        if critical:
            expected_critical.add(relative)
        if critical_only and not critical:
            continue
        path = dist.root / relative
        if not path.is_file():
            errors.append(
                {
                    "code": "dist/file-missing",
                    "path": relative,
                    "message": f"分发文件缺失：{relative}",
                }
            )
            continue
        actual = sha256_file(path)
        checked += 1
        if actual != meta.get("sha256"):
            errors.append(
                {
                    "code": "dist/file-modified",
                    "path": relative,
                    "message": f"分发文件已改动：{relative}",
                }
            )
    if critical_only:
        actual_critical = {
            path.relative_to(dist.root).as_posix()
            for prefix in critical_prefixes
            for path in (dist.root / prefix).rglob("*")
            if path.is_file()
            and not any(part in {"__pycache__", ".tmp", ".nacl", "node_modules", "target", "dist"} for part in path.relative_to(dist.root).parts)
            and path.suffix != ".pyc"
        }
        for relative in sorted(actual_critical - expected_critical):
            errors.append(
                {
                    "code": "dist/file-unexpected",
                    "path": relative,
                    "message": f"分发关键目录出现清单外文件：{relative}",
                }
            )
    if errors:
        code = (
            "dist/hand-authored-missing"
            if any(item["code"] == "dist/hand-authored-missing" for item in errors)
            else "dist/file-modified"
        )
        raise ToolError(
            code,
            f"分发完整性检查失败（{len(errors)} 项）",
            exit_code=2,
            details={"errors": errors, "checkedFiles": checked},
        )
    return {
        "ok": True,
        "checkedFiles": checked,
        "criticalOnly": critical_only,
        "manifest": {
            "skillVersion": manifest.get("skillVersion"),
            "templateVersion": manifest.get("templateVersion"),
            "sourceHead": nested_get(manifest, "source", "head"),
            "sourceDirty": nested_get(manifest, "source", "dirty"),
            "sourceInputSha256": nested_get(manifest, "source", "inputSha256"),
        },
    }


def validate_templates(dist: Distribution) -> dict:
    payload = run_node_json(
        dist,
        [
            "validate-templates",
            "--starter",
            str(dist.starter),
            "--templates",
            str(dist.templates),
            "--schema",
            str(dist.schemas / "page.schema.json"),
        ],
    )
    if not payload.get("ok"):
        raise ToolError(
            "page/template-invalid",
            "布局/模式矩阵校验未通过：" + "；".join(payload.get("failures") or [])[:2000],
            exit_code=2,
            details={"matrix": payload.get("matrix"), "negatives": payload.get("negatives")},
        )
    return payload


def compose_page(dist: Distribution, layout: str, mode: str, title: str | None = None) -> dict:
    args = [
        "compose",
        "--starter",
        str(dist.starter),
        "--templates",
        str(dist.templates),
        "--schema",
        str(dist.schemas / "page.schema.json"),
        "--layout",
        layout,
        "--mode",
        mode,
    ]
    if title:
        args.extend(["--title", title])
    payload = run_node_json(dist, args)
    if not payload.get("ok"):
        errors = payload.get("errors") or []
        raise ToolError(
            "page/invalid",
            "页面组合校验失败：" + "；".join(item.get("message", "") for item in errors[:5]),
            exit_code=2,
            details={"errors": errors},
        )
    return payload["page"]


def inspect_contract(dist: Distribution) -> dict:
    payload = run_node_json(
        dist,
        [
            "inspect",
            "--starter",
            str(dist.starter),
            "--templates",
            str(dist.templates),
            "--schema",
            str(dist.schemas / "page.schema.json"),
        ],
    )
    if not payload.get("ok"):
        raise ToolError("tool/internal", "无法读取页面注册表", exit_code=2, details=payload)
    return payload


def _check_output(dist: Distribution, output: Path) -> None:
    if output == dist.root or dist.root in output.parents or output in dist.root.parents:
        raise ToolError(
            "project/target-conflict",
            "输出目录不能位于分发/模板源码内，也不能包含分发/模板源码",
            exit_code=2,
            path=str(output),
        )
    if output.exists():
        if not output.is_dir():
            raise ToolError("project/target-conflict", f"输出路径已存在且不是目录：{output}", exit_code=4)
        if any(output.iterdir()):
            raise ToolError(
                "project/target-conflict",
                f"输出目录已存在且非空，生成器不会覆盖：{output}",
                exit_code=4,
                path=str(output),
            )


def _patch_shell_manifest(path: Path, mode: str) -> None:
    contents = path.read_text(encoding="utf-8")
    contents = contents.replace(
        'nacl-next-sdk = { path = "../../../sdk/nacl-next-sdk" }',
        'nacl-next-sdk = { git = "https://github.com/Nalongur/nacl-next-sdk.git", rev = "160fea422ab679bc5d8fa74c6a4035264c718db5" }',
    )
    contents = re.sub(r'default\s*=\s*\["mode-[abd]"\]', f'default = ["mode-{mode}"]', contents)
    path.write_text(contents, encoding="utf-8")


def _patch_tauri_config(path: Path, project: dict, window_title: str, window: dict) -> None:
    config = read_json(path)
    config["productName"] = project["app"]["productName"]
    config["identifier"] = project["app"]["identifier"]
    config["build"] = {"beforeBuildCommand": "npm run build", "frontendDist": "../dist"}
    if config.get("app", {}).get("windows"):
        first = config["app"]["windows"][0]
        first.update(
            {
                "title": window_title,
                "width": window["width"],
                "height": window["height"],
                "minWidth": window["minWidth"],
                "minHeight": window["minHeight"],
            }
        )
        config["app"]["withGlobalTauri"] = False
    write_json(path, config)


def _generated_readme(project: dict, dist: Distribution) -> str:
    mode = project["mode"].upper()
    if project["mode"] == "a":
        identity = (
            "A（仅正版）：只注册 Microsoft 身份命令；开发者/发行者通过 "
            "`NACL_NEXT_MICROSOFT_CLIENT_ID` 配置其有权使用的 Client ID。"
        )
    elif project["mode"] == "b":
        identity = "B（仅本地）：只注册本地档案与共享命令，不启用 Microsoft 依赖/请求。"
    else:
        identity = "D（共存）：同时注册两类身份；每次启动必须在身份选择器中明确选择一种。"
    adapter = (
        "MOCK 模拟数据（仅布局预览，不代表真实账号/文件/进程）"
        if project["adapter"] == "mock"
        else "IPC 桌面后端"
    )
    origin = "NaCL Next UI Skill" if dist.kind == "distribution" else "NaCL Next S3 模板"
    return f"""# {project["app"]["productName"]}

由 {origin} 生成：布局 `{project["layout"]}` · 模式 {mode} · 适配器 {adapter}。

{identity}

## 构建

```powershell
npm ci
npm run validate
npm run build
npm run desktop
```

`npm run desktop` 使用 Tauri 的 `--no-bundle` 生成 EXE，不产生安装包。
生成工程固定公开 SDK Git 提交，并自带 TypeScript 契约和 IPC 壳源码，
不依赖原始模板仓库或任何私有目录。

## 运行

```powershell
$env:NACL_NEXT_S1_ROOT = "<可写数据目录>"
$env:NACL_NEXT_MICROSOFT_CLIENT_ID = "<A/D 模式可选：开发者配置的 Client ID>"
.\\target\\release\\nacl-next-s1-shell.exe
```

未设置 `NACL_NEXT_S1_ROOT` 时使用 EXE 同级 `s1-data`。不获取游戏文件；
缺失元数据/客户端/Java 只报告原因，不自动下载或修复。模拟适配器不会发起
账号、文件或进程操作。
"""


def create_project(
    dist: Distribution,
    *,
    layout: str,
    mode: str,
    adapter: str,
    output: Path,
    product_name: str | None = None,
    identifier: str | None = None,
    title: str | None = None,
) -> dict:
    started = time.monotonic()
    if layout not in LAYOUT_LABELS:
        raise ToolError("usage/invalid", f"--layout 只能是 {sorted(LAYOUT_LABELS)}", exit_code=2)
    if mode not in VALID_MODES:
        raise ToolError("usage/invalid", f"--mode 只能是 {list(VALID_MODES)}", exit_code=2)
    if adapter not in VALID_ADAPTERS:
        raise ToolError("usage/invalid", f"--adapter 只能是 {list(VALID_ADAPTERS)}", exit_code=2)

    output = output.resolve()
    _check_output(dist, output)

    if not shutil.which("node") and not shutil.which("node.exe"):
        raise ToolError("env/missing-node", "找不到 Node.js，无法执行页面校验", exit_code=3)

    if dist.kind == "distribution":
        self_check(dist, critical_only=True)

    compatibility = check_compatibility(dist)
    template_summary = validate_templates(dist)
    page = compose_page(dist, layout, mode, title=title)

    product_name = product_name or f"NaCL Next {dist.brand}{layout.title()} {mode.upper()}"
    identifier = identifier or f"{dist.identifier_prefix}.{layout}.{mode}"
    window_by_layout = {
        "nacl": {"width": 1240, "height": 820, "minWidth": 980, "minHeight": 660},
        "sidebar": {"width": 1240, "height": 820, "minWidth": 980, "minHeight": 660},
        "studio": {"width": 1360, "height": 880, "minWidth": 1100, "minHeight": 720},
    }
    window = window_by_layout[layout]
    project = {
        "schemaVersion": 1,
        "mode": mode,
        "layout": layout,
        "adapter": adapter,
        "pageSchemaVersion": compatibility["compatibility"]["pageSchemaVersion"],
        "sdk": {
            "name": "nacl-next-sdk",
            "version": compatibility["sdkVersion"],
            "git": compatibility["compatibility"]["sdk"]["git"],
            "rev": compatibility["compatibility"]["sdk"]["rev"],
            "contractsSha256": compatibility["contractsSha256"],
        },
        "template": {
            "version": compatibility["compatibility"]["templateVersion"],
            "layout": layout,
            "mode": mode,
        },
        "app": {
            "productName": product_name,
            "identifier": identifier,
            "window": window,
        },
    }

    target_existed = output.exists()
    staging = output.parent / f".{output.name}.nacl-staging-{uuid.uuid4().hex[:8]}"
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        staging.mkdir(parents=True, exist_ok=False)
        copy_tree(dist.starter, staging)
        copy_tree(dist.schemas, staging / "schema")
        copy_tree(dist.sdk_contracts, staging / "sdk/contracts")
        copy_tree(dist.shell, staging / "src-tauri", extra_excluded=("Cargo.lock",))
        copy_tree(dist.shell_contracts, staging / "src/contracts/shell")
        shutil.copyfile(dist.shell_lock, staging / "Cargo.lock")
        for name in ("LICENSE", "THIRD-PARTY-NOTICES.md"):
            source = dist.root / name
            if source.is_file():
                shutil.copyfile(source, staging / name)
        (staging / "Cargo.toml").write_text(
            '[workspace]\nmembers = ["src-tauri"]\nresolver = "2"\n',
            encoding="utf-8",
        )
        _patch_shell_manifest(staging / "src-tauri/Cargo.toml", mode)
        _patch_tauri_config(
            staging / "src-tauri/tauri.conf.json",
            project,
            f"NaCL Next · {LAYOUT_LABELS[layout]} · 模式 {mode.upper()}",
            window,
        )
        write_json(staging / "nacl.project.json", project)
        write_json(staging / "src/page.json", page)
        write_json(
            staging / "compatibility.json",
            {
                **compatibility["compatibility"],
                "generated": {
                    "layout": layout,
                    "mode": mode,
                    "adapter": adapter,
                    "sdkContractsSha256": compatibility["contractsSha256"],
                },
            },
        )
        (staging / "README.md").write_text(_generated_readme(project, dist), encoding="utf-8")

        hashes: dict[str, str] = {}
        skipped = EXCLUDED | {"generation.json"}
        for path in sorted(
            (item for item in staging.rglob("*") if item.is_file()),
            key=lambda item: item.relative_to(staging).as_posix(),
        ):
            relative = path.relative_to(staging)
            if any(part in skipped for part in relative.parts):
                continue
            hashes[relative.as_posix()] = sha256_file(path)

        generation = {
            "templateVersion": compatibility["compatibility"]["templateVersion"],
            "layout": layout,
            "mode": mode,
            "adapter": adapter,
            "sdkVersion": compatibility["sdkVersion"],
            "sdkContractsSha256": compatibility["contractsSha256"],
            "distribution": {
                "kind": dist.kind,
                "skillVersion": (self_check(dist).get("manifest") or {}).get("skillVersion")
                if dist.kind == "distribution"
                else None,
            },
            "files": hashes,
        }
        write_json(staging / "generation.json", generation)

        if output.exists():
            output.rmdir()
        try:
            replace_directory(staging, output)
        except ToolError:
            if target_existed and not output.exists():
                try:
                    output.mkdir()
                except OSError:
                    pass
            raise
    except OSError as error:
        shutil.rmtree(staging, ignore_errors=True)
        raise ToolError(
            "project/write-failed",
            f"生成工程写入失败：{error}",
            exit_code=1,
            path=str(output),
            details={"staging": str(staging), "error": repr(error)},
        ) from error
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    return {
        "generated": str(output),
        "layout": layout,
        "mode": mode,
        "adapter": adapter,
        "files": len(hashes),
        "sdkVersion": compatibility["sdkVersion"],
        "sdkContractsSha256": compatibility["contractsSha256"],
        "templateVersion": compatibility["compatibility"]["templateVersion"],
        "matrix": {"combinations": len(template_summary.get("matrix") or []), "negatives": len(template_summary.get("negatives") or [])},
        "seconds": round(time.monotonic() - started, 2),
    }


def _error(path: str, code: str, message: str) -> dict:
    return {"path": path, "code": code, "message": message}


def _enrich_errors(errors: list[dict], hints: dict[str, str]) -> list[dict]:
    enriched = []
    for item in errors:
        value = dict(item)
        value["hint"] = item.get("hint") or hint_for(hints, str(item.get("code", ""))) or "按 path 指向的字段修正配置。"
        path = str(item.get("path") or "")
        code = str(item.get("code") or "")
        if not value.get("file"):
            if code == "config/invalid-root":
                value["file"] = path.split("#", 1)[0] or "nacl.project.json"
            elif code.startswith("page/") or (code.startswith("schema/") and path.startswith("page")):
                value["file"] = "src/page.json"
            elif code.startswith(("project/", "compat/")) or "nacl.project" in path:
                value["file"] = "nacl.project.json"
            elif code in ("config/read-failed", "contract/missing"):
                value["file"] = path
            else:
                value["file"] = "nacl.project.json"
        enriched.append(value)
    return enriched


CONFIG_READ_ERROR_CODES = frozenset({"config/read-failed", "config/invalid-encoding"})


def _read_config_for_errors(path: Path, file_label: str, label: str, errors: list[dict]) -> Any:
    """Read a user config without losing the structured error list.

    validate_project already collects the JS validator's read error; a second
    Python read must not replace that list with a bare ToolError. Unreadable
    files and invalid UTF-8 both stay structured; decoding never guesses or
    replaces bytes. Return READ_FAILED and add the error only when it is not
    present yet; valid JSON null is returned as None so root checks can flag it.
    """
    try:
        return read_json(path)
    except ToolError as error:
        if error.code not in CONFIG_READ_ERROR_CODES:
            raise
        if not any(
            item.get("code") == error.code
            and (item.get("file") == file_label or str(item.get("path", "")).startswith(file_label))
            for item in errors
        ):
            errors.append(
                {
                    "path": file_label,
                    "code": error.code,
                    "message": error.message,
                    "file": file_label,
                }
            )
        return READ_FAILED


def validate_project(dist: Distribution, project_dir: Path) -> dict:
    project_dir = project_dir.resolve()
    if not (project_dir / "nacl.project.json").is_file():
        raise ToolError(
            "project/missing-file",
            f"不是生成工程：{project_dir}",
            exit_code=2,
            path=str(project_dir),
        )
    payload = run_node_json(dist, ["validate-project", "--project", str(project_dir)])
    errors = list(payload.get("errors") or [])
    project = _read_config_for_errors(project_dir / "nacl.project.json", "nacl.project.json", "项目配置", errors)
    if project is READ_FAILED:
        project = {}
    elif not is_json_object(project):
        add_root_error_once(errors, root_error("nacl.project.json", "项目配置", project))
        project = {}
    page_path = project_dir / "src/page.json"
    if page_path.is_file():
        page = _read_config_for_errors(page_path, "src/page.json", "页面配置", errors)
        if page is not READ_FAILED and not is_json_object(page):
            add_root_error_once(errors, root_error("src/page.json", "页面配置", page))

    for name in ("page.schema.json", "project.schema.json"):
        expected = dist.schemas / name
        actual = project_dir / "schema" / name
        if not actual.is_file():
            errors.append(_error(f"schema/{name}", "project/missing-file", f"缺少 Schema {name}"))
        elif sha256_file(expected) != sha256_file(actual):
            errors.append(
                _error(
                    f"schema/{name}",
                    "compat/schema-modified",
                    f"工程 Schema {name} 与分发固定契约不一致",
                )
            )

    hints = load_hints(dist)
    errors = _enrich_errors(errors, hints)
    return {
        "project": str(project_dir),
        "mode": project.get("mode"),
        "layout": project.get("layout"),
        "adapter": project.get("adapter"),
        "summary": payload.get("summary"),
        "errors": errors,
        "ok": not errors,
    }


def _read_check_json(
    path: Path, relative: str, label: str, errors: list[dict]
) -> tuple[Any, bool]:
    """Read a project JSON file for `check` without raising past the report.

    A missing file has already been recorded by the required-file pass. A read
    failure or non-object root is recorded here; callers must not run checks
    that assume the value has a valid shape.
    """
    if not path.is_file():
        return {}, False
    try:
        value = read_json(path)
    except ToolError as error:
        errors.append(
            {
                "path": relative,
                "code": error.code,
                "message": error.message,
                "file": relative,
            }
        )
        return {}, False
    if not is_json_object(value):
        add_root_error_once(errors, root_error(relative, label, value))
        return {}, False
    return value, True


def check_project(dist: Distribution, project_dir: Path) -> dict:
    project_dir = project_dir.resolve()
    required = [
        "nacl.project.json",
        "generation.json",
        "compatibility.json",
        "src/page.json",
        "schema/page.schema.json",
        "schema/project.schema.json",
        "sdk/contracts/InstanceConfig.ts",
        "src-tauri/Cargo.toml",
        "src/contracts/shell/TaskRecord.ts",
    ]
    errors = [
        _error(relative, "project/missing-file", f"缺少生成文件 {relative}")
        for relative in required
        if not (project_dir / relative).is_file()
    ]
    if any(item["path"] == "nacl.project.json" for item in errors):
        raise ToolError(
            "project/missing-file",
            f"不是完整生成工程：{project_dir}",
            exit_code=2,
            details={"errors": errors},
        )

    project, project_ok = _read_check_json(
        project_dir / "nacl.project.json", "nacl.project.json", "项目配置", errors
    )
    generation, generation_ok = _read_check_json(
        project_dir / "generation.json", "generation.json", "生成记录", errors
    )
    compatibility, compatibility_ok = _read_check_json(
        project_dir / "compatibility.json", "compatibility.json", "工程兼容记录", errors
    )
    compatibility_base = check_compatibility(dist)
    validation = validate_project(dist, project_dir)
    errors.extend(validation["errors"])

    def expect(condition: bool, path: str, code: str, message: str) -> None:
        if not condition:
            errors.append(_error(path, code, message))

    def expect_enum(value: Any, allowed: Any, path: str, code: str, message: str) -> None:
        if not isinstance(value, str) or value not in allowed:
            errors.append(_error(path, code, f"{message}（实际 {json_type_name(value)}）"))

    if project_ok:
        expect(project.get("schemaVersion") == 1, "nacl.project.json#/schemaVersion", "compat/page-schema", "项目 schemaVersion 必须为 1")
        expect_enum(project.get("mode"), VALID_MODES, "nacl.project.json#/mode", "usage/invalid", "模式不合法")
        expect_enum(project.get("layout"), tuple(LAYOUT_LABELS), "nacl.project.json#/layout", "usage/invalid", "布局不合法")
        expect_enum(project.get("adapter"), VALID_ADAPTERS, "nacl.project.json#/adapter", "compat/unknown-adapter", "适配器不合法")

    if project_ok and compatibility_ok:
        expect(
            nested_get(project, "template", "version") == compatibility.get("templateVersion") == nested_get(compatibility_base, "compatibility", "templateVersion"),
            "nacl.project.json#/template/version",
            "compat/template-version",
            "项目模板版本与分发兼容记录不一致",
        )
        expect(
            project.get("pageSchemaVersion") == compatibility.get("pageSchemaVersion") == nested_get(compatibility_base, "compatibility", "pageSchemaVersion"),
            "nacl.project.json#/pageSchemaVersion",
            "compat/page-schema",
            "项目页面 Schema 版本与分发不一致",
        )
        expect(
            nested_get(project, "sdk", "name") == nested_get(compatibility_base, "compatibility", "sdk", "name"),
            "nacl.project.json#/sdk/name",
            "compat/sdk-version",
            "项目 SDK 名称与分发不一致",
        )
        expect(
            nested_get(project, "sdk", "version") == nested_get(compatibility, "sdk", "version") == compatibility_base["sdkVersion"],
            "nacl.project.json#/sdk/version",
            "compat/sdk-version",
            "项目 SDK 版本与分发表不一致",
        )

    if project_ok and generation_ok:
        for key in ("mode", "adapter"):
            expect(
                generation.get(key) == project.get(key),
                f"generation.json#/{key}",
                "project/template-mismatch",
                f"generation.{key} 与项目配置不一致",
            )
        # `layout` is an allowed L2 customization: generation.json keeps the
        # original baseline, while project/page must agree with each other.
        # Mode and adapter are not freely customizable without regeneration.
        expect(
            generation.get("sdkVersion") == nested_get(project, "sdk", "version"),
            "generation.json#/sdkVersion",
            "compat/sdk-version",
            "generation SDK 版本与项目不一致",
        )
        expect(
            (generation.get("sdkContractsSha256") or generation.get("sdkSnapshotSha256")) == (nested_get(project, "sdk", "contractsSha256") or nested_get(project, "sdk", "snapshotSha256")),
            "generation.json#/sdkSnapshotSha256",
            "project/snapshot-mismatch",
            "generation 快照哈希与项目不一致",
        )

    if project_ok:
        sdk_root = project_dir / "sdk/nacl-next-sdk"
        sdk = project.get("sdk")
        if not isinstance(sdk, dict):
            sdk = {}
        if sdk.get("git"):
            import tomllib
            try:
                manifest = tomllib.loads((project_dir / "src-tauri/Cargo.toml").read_text(encoding="utf-8"))
                lock = tomllib.loads((project_dir / "Cargo.lock").read_text(encoding="utf-8"))
                expected = compatibility_base["compatibility"]["sdk"]
                dep = manifest["dependencies"]["nacl-next-sdk"]
                source = f'git+{expected["git"]}?rev={expected["rev"]}#{expected["rev"]}'
                packages = [p for p in lock["package"] if p.get("name") == "nacl-next-sdk"]
                valid = sdk.get("git") == expected["git"] and sdk.get("rev") == expected["rev"] and dep.get("git") == expected["git"] and dep.get("rev") == expected["rev"] and len(packages) == 1 and packages[0].get("source") == source and packages[0].get("version") == sdk.get("version")
                expect(valid, "src-tauri/Cargo.toml", "project/sdk-source-mismatch", "SDK Git 依赖或锁文件与固定来源不一致")
                expect(sha256_files(project_dir / "sdk/contracts") == sdk.get("contractsSha256") == compatibility_base["contractsSha256"], "sdk/contracts", "project/contracts-mismatch", "SDK TypeScript 契约哈希不一致")
            except (OSError, ValueError, KeyError, TypeError) as error:
                errors.append(_error("Cargo.lock", "project/sdk-source-mismatch", f"无法检查 SDK 来源：{error}"))
        elif sdk_root.is_dir():
            expect(sha256_files(sdk_root) == sdk.get("snapshotSha256"), "sdk/nacl-next-sdk", "project/snapshot-mismatch", "SDK 快照哈希不一致")
        else:
            errors.append(_error("sdk/nacl-next-sdk", "project/missing-file", "缺少 SDK 快照目录"))

    cargo_relative = "src-tauri/Cargo.toml"
    cargo_path = project_dir / cargo_relative
    if cargo_path.is_file() and project_ok:
        try:
            shell_manifest = cargo_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as error:
            errors.append(
                _error(cargo_relative, "project/read-failed", f"无法读取 Cargo 清单：{error}")
            )
        else:
            feature_mode = re.search(r'default\s*=\s*\["mode-([abd])"\]', shell_manifest)
            expect(
                bool(feature_mode) and feature_mode.group(1) == project.get("mode"),
                "src-tauri/Cargo.toml#/features/default",
                "project/build-mode-mismatch",
                "Cargo 默认模式与项目模式不一致",
            )

    if dist.kind == "distribution":
        try:
            self_check(dist)
        except ToolError as error:
            errors.extend((error.details or {}).get("errors") or [_error("dist", error.code, error.message)])

    modified: list[str] = []
    missing: list[str] = []
    generation_files: dict = {}
    if generation_ok:
        candidate = generation.get("files")
        if not isinstance(candidate, dict):
            errors.append(
                _error(
                    "generation.json#/files",
                    "project/generation-invalid",
                    "generation.files 必须是路径到 SHA-256 的对象",
                )
            )
        else:
            generation_files = candidate
    for relative, expected_hash in generation_files.items():
        path = project_dir / relative
        if not path.is_file():
            missing.append(relative)
        elif sha256_file(path) != expected_hash:
            modified.append(relative)

    known_missing = {str(item.get("path")) for item in errors if item.get("code") == "project/missing-file"}
    for relative in sorted(missing):
        if relative not in known_missing:
            errors.append(_error(relative, "project/missing-file", f"缺少生成文件 {relative}"))

    hints = load_hints(dist)
    enriched = _enrich_errors(errors, hints)
    return {
        "project": str(project_dir),
        "mode": project.get("mode"),
        "layout": project.get("layout"),
        "adapter": project.get("adapter"),
        "sdkVersion": nested_get(project, "sdk", "version"),
        "sdkContractsSha256": nested_get(project, "sdk", "contractsSha256"),
        "checks": {
            "generatedFiles": len(generation_files),
            "modifiedFiles": sorted(modified),
            "missingFiles": sorted(missing),
            "generationLayout": generation.get("layout"),
        },
        "errors": enriched,
        "ok": not errors,
    }


def _env_versions(*, desktop: bool) -> dict:
    missing: list[str] = []
    node = shutil.which("node") or shutil.which("node.exe")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    cargo = shutil.which("cargo")
    rustc = shutil.which("rustc")
    versions: dict[str, Any] = {
        "node": node,
        "npm": npm,
        "cargo": cargo,
        "rustc": rustc,
        "python": sys.version.split()[0],
    }
    if not node:
        missing.append("node")
    if not npm:
        missing.append("npm")
    if desktop:
        if not cargo:
            missing.append("cargo")
        if not rustc:
            missing.append("rustc")
    if missing:
        if "node" in missing:
            code = "env/missing-node"
        elif "npm" in missing:
            code = "env/missing-npm"
        elif "cargo" in missing:
            code = "env/missing-cargo"
        elif "rustc" in missing:
            code = "env/missing-rustc"
        else:
            code = "env/missing-cargo"
        raise ToolError(
            code,
            "缺少运行环境：" + "、".join(missing),
            exit_code=3,
            details={"missing": missing, "versions": versions},
        )
    for key, command in (("node", [node, "--version"]), ("cargo", [cargo, "--version"] if cargo else None), ("rustc", [rustc, "--version"] if rustc else None)):
        if command:
            try:
                result = subprocess.run(command, capture_output=True, text=True, timeout=30)
                versions[f"{key}Version"] = (result.stdout or result.stderr).strip()
            except OSError:
                pass
    return versions


def _run_step(
    name: str,
    command: list[str],
    cwd: Path,
    log_dir: Path,
    results: list[dict],
    *,
    timeout: int = 2400,
    extra_env: dict[str, str] | None = None,
) -> dict:
    log_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = log_dir / f"{name}.log"
    stderr_path = log_dir / f"{name}.stderr.log"
    temp_dir = cwd / ".tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    env = {
        **os.environ,
        "CI": "true",
        "CARGO_TERM_COLOR": "never",
        "TMP": str(temp_dir),
        "TEMP": str(temp_dir),
    }
    if extra_env:
        env.update(extra_env)
    print(f"START {name}: {' '.join(command)}", file=sys.stderr, flush=True)
    started = time.monotonic()
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        try:
            code = subprocess.run(
                command,
                cwd=cwd,
                stdout=stdout,
                stderr=stderr,
                timeout=timeout,
                env=env,
            ).returncode
        except subprocess.TimeoutExpired:
            code = "timeout"
        except OSError as error:
            code = f"os-error: {error}"
    result = {
        "check": name,
        "command": command,
        "exitCode": code,
        "seconds": round(time.monotonic() - started, 2),
        "stdout": str(stdout_path),
        "stderr": str(stderr_path),
    }
    results.append(result)
    write_json(log_dir / "results.json", {"results": results})
    print(json.dumps(result, ensure_ascii=False), file=sys.stderr, flush=True)
    return result


def _log_tail(path: Path, limit: int = 4000) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[-limit:]


def _ensure_node_modules(project: Path, log_dir: Path, results: list[dict], fresh: bool) -> None:
    if (project / "node_modules").is_dir() and not fresh:
        return
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise ToolError("env/missing-npm", "找不到 npm", exit_code=3)
    result = _run_step(
        "npm-ci",
        [npm, "ci", "--no-audit", "--no-fund"],
        project,
        log_dir,
        results,
        timeout=1800,
    )
    if result["exitCode"] != 0:
        raise ToolError(
            "env/npm-ci-failed",
            "npm ci 失败；日志：" + result["stdout"],
            exit_code=3,
            details={"log": result["stdout"], "tail": _log_tail(Path(result["stderr"])) or _log_tail(Path(result["stdout"]))},
        )


def build_project(
    dist: Distribution,
    *,
    project_dir: Path,
    frontend_only: bool = False,
    fresh: bool = False,
) -> dict:
    started = time.monotonic()
    project_dir = project_dir.resolve()
    validation = validate_project(dist, project_dir)
    if not validation["ok"]:
        raise ToolError(
            "page/invalid",
            f"配置校验失败（{len(validation['errors'])} 项），未开始构建",
            exit_code=2,
            details={"errors": validation["errors"]},
        )
    versions = _env_versions(desktop=not frontend_only)
    log_dir = project_dir / ".nacl" / "logs" / time.strftime("%Y%m%d-%H%M%S")
    results: list[dict] = []
    _ensure_node_modules(project_dir, log_dir, results, fresh)
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    command = [npm, "run", "build"] if frontend_only else [npm, "run", "desktop"]
    result = _run_step("build", command, project_dir, log_dir, results, timeout=3600)
    if result["exitCode"] != 0:
        raise ToolError(
            "build/step-failed",
            "构建失败；日志：" + result["stdout"],
            exit_code=1,
            details={"log": result["stdout"], "tail": _log_tail(Path(result["stderr"])) or _log_tail(Path(result["stdout"]))},
        )
    artifact = None
    if not frontend_only:
        executable = project_dir / "target/release/nacl-next-s1-shell.exe"
        if not executable.is_file():
            raise ToolError("build/artifact-missing", f"未找到桌面产物 {executable}", exit_code=1)
        artifact = {
            "name": executable.name,
            "bytes": executable.stat().st_size,
            "sha256": sha256_file(executable),
        }
    if not (project_dir / "dist/index.html").is_file():
        raise ToolError("build/artifact-missing", "前端构建缺少 dist/index.html", exit_code=1)
    return {
        "project": str(project_dir),
        "frontendOnly": frontend_only,
        "environment": versions,
        "results": results,
        "artifact": artifact,
        "logDirectory": str(log_dir),
        "seconds": round(time.monotonic() - started, 2),
    }


def _scan_path_leaks(project: Path, dist: Distribution) -> list[str]:
    leaks: list[str] = []
    suffixes = {".toml", ".json", ".ts", ".vue", ".mjs", ".js", ".rs", ".html", ".css", ".md", ".txt", ".py"}
    skipped = {"target", "node_modules", "dist", ".git", ".tmp", ".nacl"}
    for path in project.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        if any(part in skipped for part in path.parts):
            continue
        try:
            contents = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for snippet in dist.forbidden:
            if snippet and snippet in contents:
                leaks.append(f"{path.relative_to(project)} contains {snippet}")
    return leaks


def verify_project(
    dist: Distribution,
    *,
    project_dir: Path,
    evidence: Path,
) -> dict:
    started = time.monotonic()
    project_dir = project_dir.resolve()
    evidence = evidence.resolve()
    if not (project_dir / "nacl.project.json").is_file():
        raise ToolError("project/missing-file", f"不是生成工程：{project_dir}", exit_code=2)
    generation_path = project_dir / "generation.json"
    if generation_path.is_file():
        generation_pre = read_json_object(generation_path, "生成记录")
        files_pre = generation_pre.get("files")
        missing_pre = (
            [relative for relative in files_pre if not (project_dir / relative).is_file()]
            if isinstance(files_pre, dict)
            else []
        )
        if missing_pre:
            raise ToolError(
                "project/missing-file",
                f"生成工程缺少 {len(missing_pre)} 个生成文件，未开始验收",
                exit_code=2,
                details={
                    "errors": [
                        _error(relative, "project/missing-file", f"缺少生成文件 {relative}")
                        for relative in sorted(missing_pre)
                    ]
                },
            )
    if evidence.exists() and any(evidence.iterdir()):
        raise ToolError("evidence/non-empty", f"证据目录已存在且非空：{evidence}", exit_code=4)
    evidence.mkdir(parents=True, exist_ok=True)

    versions = _env_versions(desktop=True)
    write_json(evidence / "environment.json", versions)
    project = read_json_object(project_dir / "nacl.project.json", "项目配置")
    results: list[dict] = []
    steps: list[tuple[str, list[str]]] = []
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    cargo = shutil.which("cargo")

    steps.extend(
        [
            ("npm-ci", [npm, "ci", "--no-audit", "--no-fund"]),
            ("config", [npm, "run", "validate"]),
            ("frontend-test", [npm, "run", "test"]),
            ("typecheck", [npm, "run", "typecheck"]),
            ("frontend-build", [npm, "run", "build"]),
            ("rust-fmt", [cargo, "fmt", "--all", "--", "--check"]),
            ("rust-test", [cargo, "test", "--locked"]),
            ("rust-clippy", [cargo, "workspace", "--all-targets", "--locked", "--", "-D", "warnings"]),
            ("desktop-build", [npm, "run", "desktop"]),
        ]
    )
    # cargo clippy is invoked as `cargo clippy ...`; the first element above is
    # shared with rust-fmt, so patch the clippy step explicitly.
    steps[7] = ("rust-clippy", [cargo, "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"])

    failed: dict | None = None
    for name, command in steps:
        result = _run_step(name, command, project_dir, evidence, results, timeout=3600)
        if result["exitCode"] != 0:
            failed = result
            break

    artifact = None
    executable = project_dir / "target/release/nacl-next-s1-shell.exe"
    if executable.is_file():
        artifact = {
            "name": executable.name,
            "bytes": executable.stat().st_size,
            "sha256": sha256_file(executable),
        }
    snapshot_actual = sha256_files(project_dir / ("sdk/contracts" if nested_get(project, "sdk", "git") else "sdk/nacl-next-sdk"))
    snapshot_ok = snapshot_actual == (nested_get(project, "sdk", "contractsSha256") or nested_get(project, "sdk", "snapshotSha256"))
    leaks = _scan_path_leaks(project_dir, dist)

    generation = None
    modified: list[str] = []
    missing: list[str] = []
    if (project_dir / "generation.json").is_file():
        generation = read_json_object(project_dir / "generation.json", "生成记录")
        generation_files = generation.get("files")
        if not isinstance(generation_files, dict):
            raise ToolError(
                "project/generation-invalid",
                "generation.files 必须是路径到 SHA-256 的对象",
                exit_code=2,
                path=str(project_dir / "generation.json"),
            )
        for relative, expected_hash in generation_files.items():
            path = project_dir / relative
            if not path.is_file():
                missing.append(relative)
            elif sha256_file(path) != expected_hash:
                modified.append(relative)

    summary = {
        "ok": failed is None and snapshot_ok and not leaks and artifact is not None and not missing,
        "project": str(project_dir),
        "layout": project.get("layout"),
        "mode": project.get("mode"),
        "adapter": project.get("adapter"),
        "sdkVersion": nested_get(project, "sdk", "version"),
        "sdkContractsSha256": nested_get(project, "sdk", "contractsSha256"),
        "snapshotActualSha256": snapshot_actual,
        "snapshotOk": snapshot_ok,
        "results": results,
        "failedStep": failed["check"] if failed else None,
        "artifact": artifact,
        "pathLeaks": leaks,
        "modifiedFiles": sorted(modified),
        "missingGeneratedFiles": sorted(missing),
        "environment": versions,
        "seconds": round(time.monotonic() - started, 2),
    }
    write_json(evidence / "verification.json", summary)
    for name in ("generation.json", "nacl.project.json", "compatibility.json"):
        source = project_dir / name
        if source.is_file():
            shutil.copyfile(source, evidence / name)
    if artifact:
        write_json(evidence / "artifact.json", artifact)

    if failed:
        error_code = "env/npm-ci-failed" if failed["check"] == "npm-ci" else "build/step-failed"
        exit_code = 3 if failed["check"] == "npm-ci" else 1
        raise ToolError(
            error_code,
            f"{failed['check']} 退出码 {failed['exitCode']}；日志见 {evidence}",
            exit_code=exit_code,
            details={"failedStep": failed["check"], "summary": summary},
        )
    if not snapshot_ok:
        raise ToolError(
            "project/snapshot-mismatch",
            "SDK 快照哈希与项目记录不一致",
            exit_code=1,
            details={"summary": summary},
        )
    if missing:
        raise ToolError(
            "project/missing-file",
            f"验收期间生成文件缺失（{len(missing)} 项）",
            exit_code=2,
            details={
                "summary": summary,
                "errors": [
                    _error(relative, "project/missing-file", f"缺少生成文件 {relative}")
                    for relative in sorted(missing)
                ],
            },
        )
    if leaks:
        raise ToolError(
            "tool/internal",
            f"生成工程包含分发/仓库绝对路径：{leaks[:5]}",
            exit_code=1,
            details={"summary": summary},
        )
    if artifact is None:
        raise ToolError("build/artifact-missing", "没有产出桌面 EXE", exit_code=1, details={"summary": summary})
    return summary


def preview_project(
    dist: Distribution,
    *,
    project_dir: Path,
    port: int,
    check_only: bool,
    mock_override: bool,
) -> dict:
    project_dir = project_dir.resolve()
    project = read_json_object(project_dir / "nacl.project.json", "项目配置")
    adapter = project.get("adapter")
    if adapter != "mock" and not mock_override:
        raise ToolError(
            "preview/adapter-ipc",
            "IPC 工程没有 mock 适配器；布局预览请加 --mock，或创建 --adapter mock 的工程",
            exit_code=2,
        )
    if not (project_dir / "node_modules" / "vite" / "bin" / "vite.js").is_file():
        raise ToolError(
            "env/node-modules-missing",
            "工程尚未安装前端依赖；先运行 npm ci（或 nacl_ui.py build）",
            exit_code=3,
        )
    node = shutil.which("node") or shutil.which("node.exe")
    if not node:
        raise ToolError("env/missing-node", "找不到 Node.js", exit_code=3)
    if not (1 <= port <= 65535):
        raise ToolError("usage/invalid", f"端口不合法：{port}", exit_code=2)

    log_dir = project_dir / ".nacl" / "logs" / time.strftime("%Y%m%d-%H%M%S")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "preview.log"
    env = {**os.environ}
    if adapter == "mock" or mock_override:
        env["VITE_NACL_ADAPTER"] = "mock"
    command = [
        node,
        str(project_dir / "node_modules/vite/bin/vite.js"),
        "--mode",
        "mock",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--strictPort",
    ]
    log_handle = log_path.open("wb")
    process = subprocess.Popen(command, cwd=project_dir, stdout=log_handle, stderr=subprocess.STDOUT, env=env)
    url = f"http://127.0.0.1:{port}/"
    started = time.monotonic()
    ready = False
    try:
        while time.monotonic() - started < 60:
            if process.poll() is not None:
                break
            try:
                with urllib.request.urlopen(url, timeout=2) as response:
                    if response.status == 200:
                        ready = True
                        break
            except (urllib.error.URLError, TimeoutError, OSError):
                pass
            time.sleep(0.5)
    finally:
        log_handle.close()
    if not ready:
        code = "preview/exited" if process.poll() is not None else "preview/timeout"
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        raise ToolError(
            code,
            f"预览服务器未就绪；日志：{log_path}",
            exit_code=1,
            details={"log": str(log_path), "tail": _log_tail(log_path)},
        )

    summary = {
        "ok": True,
        "url": url,
        "port": port,
        "projectAdapter": adapter,
        "mock": True,
        "checkOnly": check_only,
        "log": str(log_path),
        "seconds": round(time.monotonic() - started, 2),
    }
    if check_only:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    else:
        print("预览已就绪；按 Ctrl+C 停止。", file=sys.stderr, flush=True)
        try:
            process.wait()
        except KeyboardInterrupt:
            process.terminate()
    return summary


def distribution_check(dist: Distribution) -> dict:
    compat = check_compatibility(dist)
    integrity = self_check(dist)
    return {
        "ok": True,
        "kind": dist.kind,
        "root": str(dist.root),
        "sdkVersion": compat["sdkVersion"],
        "sdkContractsSha256": compat["contractsSha256"],
        "templateVersion": compat["compatibility"].get("templateVersion"),
        "pageSchemaVersion": compat["compatibility"].get("pageSchemaVersion"),
        "integrity": integrity,
    }


def matrix(
    dist: Distribution,
    *,
    base: Path,
    evidence_root: Path,
    layouts: list[str],
    modes: list[str],
    adapter: str,
) -> dict:
    base = base.resolve()
    evidence_root = evidence_root.resolve()
    if evidence_root.exists() and any(evidence_root.iterdir()):
        raise ToolError(
            "evidence/non-empty",
            f"证据根已存在且非空：{evidence_root}；换新目录，保留旧证据",
            exit_code=4,
            path=str(evidence_root),
        )
    base.mkdir(parents=True, exist_ok=True)
    evidence_root.mkdir(parents=True, exist_ok=True)
    summary: list[dict] = []
    for layout in layouts:
        for mode in modes:
            label = f"{layout}-{mode}"
            output = base / label
            evidence = evidence_root / f"matrix-{label}"
            record: dict[str, Any] = {
                "label": label,
                "layout": layout,
                "mode": mode,
                "adapter": adapter,
                "ok": False,
            }
            if output.exists():
                record.update({"stage": "generate", "error": f"输出目录已存在：{output}"})
                summary.append(record)
                write_json(evidence_root / "matrix-summary.json", summary)
                continue
            if evidence.exists() and any(evidence.iterdir()):
                record.update({"stage": "verify", "error": f"证据目录已存在且非空：{evidence}"})
                summary.append(record)
                write_json(evidence_root / "matrix-summary.json", summary)
                continue
            create = subprocess.run(
                [
                    sys.executable,
                    str(dist.cli),
                    "create",
                    "--layout",
                    layout,
                    "--mode",
                    mode,
                    "--adapter",
                    adapter,
                    "--output",
                    str(output),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if create.returncode != 0:
                record.update({"stage": "generate", "error": (create.stdout or create.stderr)[-4000:]})
                summary.append(record)
                write_json(evidence_root / "matrix-summary.json", summary)
                continue
            verify = subprocess.run(
                [
                    sys.executable,
                    str(dist.cli),
                    "verify",
                    "--project",
                    str(output),
                    "--evidence",
                    str(evidence),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            verification_file = evidence / "verification.json"
            record["stage"] = "verify"
            record["evidence"] = str(evidence)
            record["output"] = str(output)
            if verification_file.is_file():
                verification = read_json(verification_file)
                record["ok"] = bool(verification.get("ok"))
                record["artifact"] = verification.get("artifact")
                record["seconds"] = verification.get("seconds")
                record["failedStep"] = verification.get("failedStep")
            if verify.returncode != 0:
                record["ok"] = False
                record["error"] = (verify.stdout or verify.stderr)[-4000:]
            summary.append(record)
            write_json(evidence_root / "matrix-summary.json", summary)
    failures = [item for item in summary if not item.get("ok")]
    result = {"ok": not failures, "summary": summary, "failures": len(failures)}
    write_json(evidence_root / "matrix-result.json", result)
    return result
