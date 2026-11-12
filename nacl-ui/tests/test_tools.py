"""Boundary and recovery tests for the shared generation/validation core.

The same file runs in two places:
  * templates/s3/tests  -> exercises the S3 template entry
  * skill/nacl-ui/tests -> exercises a copied distribution

It uses only public CLI entry points except for the staging-cleanup seam,
which deliberately injects a copy failure because no natural input can fail
exactly there deterministically.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve()
ROOT = HERE.parents[1]
CLI = ROOT / "scripts" / "nacl_ui.py"
SCRIPTS = ROOT / "scripts"
IS_DISTRIBUTION = (ROOT / "DISTRIBUTION.json").is_file()

sys.path.insert(0, str(SCRIPTS))
import nacl_core  # noqa: E402


def run_cli(*args: str, env: dict | None = None, cwd: Path | None = None):
    code, stdout, stderr = run_cli_raw(*args, env=env, cwd=cwd)
    try:
        payload = json.loads(stdout.decode("utf-8")) if stdout.strip() else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {"rawStdout": stdout.decode("utf-8", "backslashreplace")}
    return code, payload, stderr.decode("utf-8", "backslashreplace")


def run_cli_raw(*args: str, env: dict | None = None, cwd: Path | None = None):
    result = subprocess.run(
        [sys.executable, str(CLI), *args],
        capture_output=True,
        env=env,
        cwd=str(cwd or ROOT),
        timeout=600,
    )
    return result.returncode, result.stdout, result.stderr


def env_without_utf8(*, explicit_utf8: bool) -> dict:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in ("PYTHONUTF8", "PYTHONIOENCODING", "PYTHONLEGACYWINDOWSSTDIO")
    }
    if explicit_utf8:
        env["PYTHONUTF8"] = "1"
    return env


def codes(payload: dict) -> list[str]:
    values = [item.get("code") for item in payload.get("errors", [])]
    if payload.get("error", {}).get("code"):
        values.append(payload["error"]["code"])
    return values


def edit_json(path: Path, mutate) -> None:
    value = json.loads(path.read_text(encoding="utf-8"))
    mutate(value)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class ToolBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = Path(tempfile.mkdtemp(prefix="nacl ui tests "))
        self.addCleanup(shutil.rmtree, self.temp, ignore_errors=True)

    def create(self, layout: str = "sidebar", mode: str = "b", adapter: str = "ipc", name: str = "generated project"):
        output = self.temp / name
        code, payload, stderr = run_cli(
            "create", "--layout", layout, "--mode", mode, "--adapter", adapter, "--output", str(output)
        )
        self.assertEqual(code, 0, f"{payload}\n{stderr}")
        self.assertTrue(payload["ok"])
        return output, payload

    def test_nacl_layout_rejects_unknown_page(self):
        output, _ = self.create(layout="nacl")
        code, payload, stderr = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 0, f"{payload}\n{stderr}")
        edit_json(output / "src/page.json", lambda value: value["blocks"][0].update(page="arbitrary-route"))
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2, payload)

    def test_nacl_navigation_version_and_old_layouts(self):
        output, _ = self.create(layout="nacl")
        page = output / "src/page.json"
        edit_json(page, lambda value: value.update(navigationVersion=2))
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2, payload)
        for layout in ("sidebar", "studio"):
            old, _ = self.create(layout=layout, name=layout)
            code, payload, _ = run_cli("validate", "--project", str(old))
            self.assertEqual(code, 0, payload)

    def test_create_validates_matrix_and_writes_complete_project(self):
        output, payload = self.create()
        self.assertTrue((output / "nacl.project.json").is_file())
        self.assertTrue((output / "src/page.json").is_file())
        self.assertFalse((output / "sdk/nacl-next-sdk").exists())
        self.assertTrue((output / "sdk/contracts/InstanceConfig.ts").is_file())
        self.assertTrue((output / "src-tauri/tauri.conf.json").is_file())
        self.assertEqual(payload["matrix"], {"combinations": 9, "negatives": 10})
        project = json.loads((output / "nacl.project.json").read_text(encoding="utf-8"))
        page = json.loads((output / "src/page.json").read_text(encoding="utf-8"))
        self.assertEqual(project["mode"], "b")
        self.assertEqual(page["mode"], "b")
        self.assertNotIn("MicrosoftIdentity", [block["component"] for block in page["blocks"]])
        code, validation, stderr = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 0, f"{validation}\n{stderr}")
        code, checked, stderr = run_cli("check", "--project", str(output))
        self.assertEqual(code, 0, f"{checked}\n{stderr}")
        self.assertEqual(checked["checks"]["modifiedFiles"], [])

    def test_git_source_and_lock_tampering_is_rejected(self):
        output, _ = self.create()
        cargo = output / "src-tauri/Cargo.toml"
        original = cargo.read_text(encoding="utf-8")
        cargo.write_text(original.replace("160fea422ab679bc5d8fa74c6a4035264c718db5", "0" * 40), encoding="utf-8")
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 2, payload)
        self.assertIn("project/sdk-source-mismatch", codes(payload))
        cargo.write_text(original, encoding="utf-8")
        lock = output / "Cargo.lock"
        lock.write_text(lock.read_text(encoding="utf-8").replace("#160fea422ab679bc5d8fa74c6a4035264c718db5", "#" + "0" * 40), encoding="utf-8")
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 2, payload)
        self.assertIn("project/sdk-source-mismatch", codes(payload))

    def test_create_accepts_existing_empty_directory_and_spaces(self):
        output = self.temp / "empty target with spaces"
        output.mkdir(parents=True)
        code, payload, stderr = run_cli(
            "create", "--layout", "studio", "--mode", "d", "--output", str(output)
        )
        self.assertEqual(code, 0, f"{payload}\n{stderr}")
        self.assertTrue((output / "src/page.json").is_file())

    def test_create_refuses_non_empty_directory_and_keeps_user_file(self):
        output = self.temp / "existing project"
        output.mkdir()
        user_file = output / "user-notes.txt"
        user_file.write_text("keep me", encoding="utf-8")
        code, payload, _ = run_cli(
            "create", "--layout", "sidebar", "--mode", "b", "--output", str(output)
        )
        self.assertEqual(code, 4)
        self.assertEqual(payload["error"]["code"], "project/target-conflict")
        self.assertEqual(user_file.read_text(encoding="utf-8"), "keep me")
        self.assertEqual(sorted(item.name for item in output.iterdir()), ["user-notes.txt"])

    def test_rerun_create_does_not_overwrite_customized_project(self):
        output, _ = self.create()
        page = output / "src/page.json"
        before = page.read_text(encoding="utf-8")
        edit_json(page, lambda value: value["theme"].update(accent="#123456"))
        customized = page.read_text(encoding="utf-8")
        code, payload, _ = run_cli(
            "create", "--layout", "sidebar", "--mode", "b", "--output", str(output)
        )
        self.assertEqual(code, 4)
        self.assertEqual(payload["error"]["code"], "project/target-conflict")
        self.assertEqual(page.read_text(encoding="utf-8"), customized)
        self.assertNotEqual(customized, before)

    def test_unknown_layout_or_mode_is_a_usage_error(self):
        code, payload, _ = run_cli(
            "create", "--layout", "billboard", "--mode", "b", "--output", str(self.temp / "x")
        )
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "usage/invalid")
        code, payload, _ = run_cli(
            "create", "--layout", "sidebar", "--mode", "z", "--output", str(self.temp / "y")
        )
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "usage/invalid")

    def test_illegal_json_reports_file_and_path(self):
        output, _ = self.create()
        page = output / "src/page.json"
        page.write_text("{ this is not json", encoding="utf-8")
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("config/read-failed", codes(payload))
        error = next(item for item in payload["errors"] if item["code"] == "config/read-failed")
        self.assertEqual(error["file"], "src/page.json")
        self.assertIn("src/page.json", error["path"])

    def test_unknown_component_action_and_param_are_targeted(self):
        output, _ = self.create()
        page = output / "src/page.json"

        edit_json(page, lambda value: value["blocks"][3].update(component="MysteryPanel"))
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        error = next(item for item in payload["errors"] if item["code"] == "page/unknown-component")
        self.assertEqual(error["file"], "src/page.json")
        self.assertIn("blocks[3]", error["path"])
        self.assertTrue(error["hint"])

        output, _ = self.create(name="action project")
        page = output / "src/page.json"
        edit_json(
            page,
            lambda value: next(
                block for block in value["blocks"] if block["component"] == "LaunchPanel"
            )["actions"].update(start="launch.begin"),
        )
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("page/action-mismatch", codes(payload))

        output, _ = self.create(name="param project")
        page = output / "src/page.json"
        edit_json(
            page,
            lambda value: next(
                block for block in value["blocks"] if block["component"] == "TaskMonitor"
            )["params"].update(maxItems=0),
        )
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        error = next(item for item in payload["errors"] if item["code"] == "page/invalid-param")
        self.assertIn("maxItems", error["path"])

        output, _ = self.create(name="unknown param project")
        page = output / "src/page.json"
        edit_json(
            page,
            lambda value: next(
                block for block in value["blocks"] if block["component"] == "InstanceList"
            )["params"].update(script="alert(1)"),
        )
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("page/unknown-param", codes(payload))

    def test_mode_mismatch_and_schema_drift_are_rejected(self):
        output, _ = self.create()
        page = output / "src/page.json"
        edit_json(page, lambda value: value.update(mode="d"))
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("page/mode-mismatch", codes(payload))

        output, _ = self.create(name="schema project")
        schema = output / "schema/page.schema.json"
        schema.write_text(schema.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        code, payload, _ = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("compat/schema-modified", codes(payload))

    def test_check_detects_version_and_template_mismatch(self):
        output, _ = self.create()
        project = output / "nacl.project.json"
        edit_json(project, lambda value: value["sdk"].update(version="9.9.9"))
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("compat/sdk-version", codes(payload))

        output, _ = self.create(name="template project")
        project = output / "nacl.project.json"
        edit_json(project, lambda value: value["template"].update(version=2))
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("compat/template-version", codes(payload))

    def test_check_reports_valid_customization_as_modified_not_corrupt(self):
        output, _ = self.create()
        page = output / "src/page.json"
        edit_json(
            page,
            lambda value: value["theme"].update(accent="#4f8cff", density="compact", radius=8),
        )
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 0, payload)
        self.assertIn("src/page.json", payload["checks"]["modifiedFiles"])

    def test_missing_generated_file_is_reported(self):
        output, _ = self.create()
        (output / "src/contracts/shell/TaskRecord.ts").unlink()
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertIn("project/missing-file", codes(payload))
        self.assertIn("contract/missing", codes(payload))

    def test_missing_generated_source_file_fails_check(self):
        output, _ = self.create()
        source = output / "src/App.vue"
        self.assertTrue(source.is_file())
        source.unlink()
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 2)
        self.assertFalse(payload["ok"])
        self.assertIn("src/App.vue", payload["checks"]["missingFiles"])
        error = next(item for item in payload["errors"] if item["path"] == "src/App.vue")
        self.assertEqual(error["code"], "project/missing-file")
        self.assertIn("file", error)
        self.assertTrue(error["hint"])

    def test_normal_l1_l2_edits_remain_modified_not_missing(self):
        output, _ = self.create()
        page = output / "src/page.json"
        edit_json(
            page,
            lambda value: value["theme"].update(accent="#4f8cff", density="compact", radius=8),
        )
        code, payload, _ = run_cli("check", "--project", str(output))
        self.assertEqual(code, 0, payload)
        self.assertTrue(payload["ok"])
        self.assertIn("src/page.json", payload["checks"]["modifiedFiles"])
        self.assertEqual(payload["checks"]["missingFiles"], [])
        self.assertEqual(payload["errors"], [])

    def test_missing_required_inputs_are_structured(self):
        output, _ = self.create()
        cases = [
            "src-tauri/Cargo.toml",
            "generation.json",
            "compatibility.json",
            "src/App.vue",
            "sdk/contracts/InstanceConfig.ts",
            "schema/page.schema.json",
        ]
        for relative in cases:
            target = output / relative
            hidden = target.with_name(target.name + ".test-bak")
            hidden.write_bytes(target.read_bytes())
            try:
                target.unlink()
                code, payload, stderr = run_cli("check", "--project", str(output))
                self.assertEqual(code, 2, f"{relative}: {payload}\n{stderr}")
                self.assertTrue(payload.get("ok") is False, relative)
                self.assertNotIn("Traceback", stderr, relative)
                errors = payload.get("errors") or []
                matching = [item for item in errors if item.get("path") == relative]
                self.assertTrue(matching, f"{relative}: {errors}")
                self.assertEqual(matching[0]["code"], "project/missing-file", relative)
                self.assertTrue(matching[0].get("file"), relative)
            finally:
                hidden.replace(target)

    def test_invalid_utf8_inputs_are_structured_errors(self):
        output, _ = self.create()
        cases = [
            ("nacl.project.json", ("validate", "check")),
            ("generation.json", ("check",)),
            ("compatibility.json", ("check",)),
            ("src/page.json", ("validate",)),
        ]
        for relative, commands in cases:
            target = output / relative
            original = target.read_bytes()
            try:
                target.write_bytes(b'{"x": "\xff"}\n')
                for command in commands:
                    label = f"{relative} {command}"
                    code, stdout, stderr = run_cli_raw(command, "--project", str(output))
                    self.assertEqual(code, 2, f"{label}: {stderr!r}")
                    self.assertNotIn(b"Traceback", stderr, label)
                    payload = json.loads(stdout.decode("utf-8"))
                    self.assertFalse(payload.get("ok"), label)
                    errors = payload.get("errors") or []
                    matching = [
                        item
                        for item in errors
                        if item.get("path") == relative or item.get("file") == relative
                    ]
                    self.assertTrue(matching, f"{label}: {errors}")
                    self.assertIn(
                        "config/invalid-encoding",
                        [item.get("code") for item in matching],
                        f"{label}: {matching}",
                    )
            finally:
                target.write_bytes(original)

    def test_illegal_root_nested_and_enum_types_are_structured(self):
        output, _ = self.create()
        cases = [
            ("nacl.project.json", lambda value: value.update(layout=[]), "project/layout", "schema/enum"),
            ("nacl.project.json", lambda value: value.update(layout={}), "project/layout", "schema/enum"),
            ("nacl.project.json", lambda value: value.update(mode=[]), "project/mode", "schema/enum"),
            ("nacl.project.json", lambda value: value.update(adapter={}), "project/adapter", "schema/enum"),
            ("nacl.project.json", lambda value: value.update(sdk=[]), "project/sdk", "schema/type"),
            ("nacl.project.json", lambda value: value["template"].update(version=[]), "project/template/version", "schema/type"),
            ("src/page.json", lambda value: value.update(layout=[]), "page/layout", "schema/enum"),
            ("src/page.json", lambda value: value.update(blocks={}), "page/blocks", "schema/type"),
        ]
        for file_label, mutate, expected_path, expected_code in cases:
            target = output / file_label
            original = target.read_text(encoding="utf-8")
            try:
                value = json.loads(original)
                mutate(value)
                target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                for command in ("validate", "check"):
                    code, payload, stderr = run_cli(command, "--project", str(output))
                    label = f"{file_label} {expected_path} {command}"
                    self.assertEqual(code, 2, f"{label}: {payload}\n{stderr}")
                    self.assertFalse(payload.get("ok"), label)
                    self.assertNotIn("Traceback", stderr, label)
                    errors = payload.get("errors") or []
                    self.assertTrue(
                        any(
                            item.get("path") == expected_path and item.get("code") == expected_code
                            for item in errors
                        ),
                        f"{label}: {errors}",
                    )
                    for item in errors:
                        self.assertTrue(item.get("file"), f"{label}: {item}")
                        self.assertTrue(item.get("path"), f"{label}: {item}")
                        self.assertTrue(item.get("code"), f"{label}: {item}")
            finally:
                target.write_text(original, encoding="utf-8")

    def test_non_object_json_roots_are_structured_errors(self):
        output, _ = self.create()
        cases = [
            ("src/page.json", "null"),
            ("src/page.json", "false"),
            ("src/page.json", "0"),
            ("src/page.json", '"text"'),
            ("src/page.json", "[]"),
            ("nacl.project.json", "null"),
            ("nacl.project.json", "false"),
            ("nacl.project.json", "0"),
            ("nacl.project.json", '"text"'),
            ("nacl.project.json", "[]"),
        ]
        for file_label, literal in cases:
            target = output / file_label
            original = target.read_text(encoding="utf-8")
            try:
                target.write_text(literal, encoding="utf-8")
                for command in ("validate", "check"):
                    code, payload, stderr = run_cli(command, "--project", str(output))
                    self.assertEqual(code, 2, f"{file_label}={literal} {command} {payload}\n{stderr}")
                    self.assertFalse(payload["ok"], f"{file_label}={literal} {command}")
                    error = next(
                        item for item in payload["errors"] if item["code"] == "config/invalid-root"
                    )
                    self.assertEqual(error["file"], file_label)
                    self.assertTrue(error["path"].endswith("#"), error)
            finally:
                target.write_text(original, encoding="utf-8")

    def test_page_root_is_checked_even_with_legacy_project_validator(self):
        output, _ = self.create()
        (output / "scripts/validate.mjs").write_text(
            "export function validateProjectDirectory() { return { errors: [], summary: null }; }\n",
            encoding="utf-8",
        )
        (output / "src/page.json").write_text("null", encoding="utf-8")
        code, payload, stderr = run_cli("validate", "--project", str(output))
        self.assertEqual(code, 2, f"{payload}\n{stderr}")
        error = next(item for item in payload["errors"] if item["code"] == "config/invalid-root")
        self.assertEqual(error["file"], "src/page.json")
        self.assertTrue(error["path"].endswith("#"))

    def test_nested_invalid_structures_report_schema_errors(self):
        output, _ = self.create()
        cases = [
            ("nacl.project.json", lambda value: value.update(app=None), "project/app"),
            ("nacl.project.json", lambda value: value.update(sdk=None), "project/sdk"),
            ("src/page.json", lambda value: value.update(blocks=None), "page/blocks"),
            ("src/page.json", lambda value: value.update(theme=[]), "page/theme"),
        ]
        for file_label, mutate, expected_path in cases:
            target = output / file_label
            original = target.read_text(encoding="utf-8")
            try:
                edit_json(target, mutate)
                code, payload, stderr = run_cli("validate", "--project", str(output))
                self.assertEqual(code, 2, f"{file_label} {payload}\n{stderr}")
                self.assertFalse(payload["ok"])
                self.assertFalse(any(item["code"] == "config/invalid-root" for item in payload["errors"]))
                paths = [str(item.get("path")) for item in payload["errors"]]
                self.assertTrue(any(expected_path in path for path in paths), paths)
                self.assertTrue(any(item["code"] == "schema/type" for item in payload["errors"]))
            finally:
                target.write_text(original, encoding="utf-8")

    def test_json_output_is_utf8_in_default_and_explicit_env(self):
        output, _ = self.create(name="中文 工程 路径")
        page = output / "src/page.json"
        edit_json(
            page,
            lambda value: next(
                block for block in value["blocks"] if block["component"] == "InstanceList"
            ).update(component="MysteryPanel"),
        )
        missing = self.temp / "不存在 的 工程"
        for explicit_utf8 in (False, True):
            env = env_without_utf8(explicit_utf8=explicit_utf8)
            with self.subTest(explicitUtf8=explicit_utf8, case="chinese-error"):
                code, stdout, stderr = run_cli_raw(
                    "validate", "--project", str(output), env=env
                )
                self.assertEqual(code, 2)
                payload = json.loads(stdout.decode("utf-8"))
                self.assertFalse(payload["ok"])
                self.assertIn("中文", payload["project"])
                message = next(
                    item["message"] for item in payload["errors"] if item["code"] == "page/unknown-component"
                )
                self.assertIn("未注册组件", message)
                stderr.decode("utf-8")
            with self.subTest(explicitUtf8=explicit_utf8, case="missing-project"):
                code, stdout, stderr = run_cli_raw("check", "--project", str(missing), env=env)
                self.assertEqual(code, 2)
                payload = json.loads(stdout.decode("utf-8"))
                self.assertFalse(payload["ok"])
                self.assertIn("不是完整生成工程", payload["error"]["message"])
                stderr.decode("utf-8")

    def test_directory_commit_retries_transient_access_denied(self):
        source = self.temp / "staging"
        source.mkdir()
        (source / "file.txt").write_text("content", encoding="utf-8")
        destination = self.temp / "committed"
        calls = {"count": 0}
        real_replace = os.replace

        def flaky_replace(src, dst):
            calls["count"] += 1
            if calls["count"] < 3:
                raise PermissionError(13, "denied")
            return real_replace(src, dst)

        with mock.patch.object(nacl_core.os, "replace", side_effect=flaky_replace):
            nacl_core.replace_directory(source, destination)
        self.assertEqual(calls["count"], 3)
        self.assertTrue((destination / "file.txt").is_file())

    def test_directory_commit_failure_is_structured_and_preserves_target(self):
        dist = nacl_core.find_distribution()
        output = self.temp / "existing empty target"
        output.mkdir()
        with mock.patch.object(
            nacl_core.os, "replace", side_effect=PermissionError(13, "denied")
        ) as patched:
            with self.assertRaises(nacl_core.ToolError) as caught:
                nacl_core.create_project(
                    dist,
                    layout="sidebar",
                    mode="b",
                    adapter="ipc",
                    output=output,
                )
        error = caught.exception
        self.assertEqual(error.code, "project/commit-failed")
        self.assertEqual(error.exit_code, 1)
        self.assertIn("staging", error.details or {})
        self.assertEqual(patched.call_count, len(nacl_core.RENAME_RETRY_DELAYS))
        self.assertTrue(output.is_dir())
        self.assertEqual(list(output.iterdir()), [])
        self.assertEqual(list(self.temp.glob(".existing empty target.nacl-staging-*")), [])

    def test_directory_commit_does_not_retry_permanent_error(self):
        source = self.temp / "staging"
        source.mkdir()
        destination = self.temp / "committed"
        with mock.patch.object(
            nacl_core.os, "replace", side_effect=FileNotFoundError("missing")
        ) as patched:
            with self.assertRaises(nacl_core.ToolError) as caught:
                nacl_core.replace_directory(source, destination)
        self.assertEqual(caught.exception.code, "project/commit-failed")
        self.assertEqual(patched.call_count, 1)

    def test_staging_is_removed_when_copy_fails(self):
        dist = nacl_core.find_distribution()
        output = self.temp / "failed generation"
        with mock.patch.object(nacl_core, "copy_tree", side_effect=[None, RuntimeError("copy failed")]):
            with self.assertRaises(RuntimeError):
                nacl_core.create_project(
                    dist,
                    layout="sidebar",
                    mode="b",
                    adapter="ipc",
                    output=output,
                )
        self.assertFalse(output.exists())
        self.assertEqual(list(self.temp.glob(".failed generation.nacl-staging-*")), [])

    def test_stale_staging_directory_does_not_confuse_new_create(self):
        output = self.temp / "new project"
        stale = self.temp / ".new project.nacl-staging-deadbeef"
        stale.mkdir()
        (stale / "leftover.txt").write_text("old", encoding="utf-8")
        output, _ = self.create(name="new project")
        self.assertTrue((output / "nacl.project.json").is_file())
        self.assertTrue((stale / "leftover.txt").is_file())

    def test_missing_environment_reports_specific_gap(self):
        output, _ = self.create()
        env = {**os.environ, "PATH": ""}
        code, payload, _ = run_cli("build", "--project", str(output), env=env)
        self.assertEqual(code, 3)
        self.assertEqual(payload["error"]["code"], "env/missing-node")
        self.assertFalse((output / ".nacl").exists())

    def test_preview_requires_mock_and_installed_dependencies(self):
        ipc, _ = self.create()
        code, payload, _ = run_cli("preview", "--project", str(ipc), "--check")
        self.assertEqual(code, 2)
        self.assertEqual(payload["error"]["code"], "preview/adapter-ipc")

        mock_project, _ = self.create(adapter="mock", name="mock project")
        code, payload, _ = run_cli("preview", "--project", str(mock_project), "--check")
        self.assertEqual(code, 3)
        self.assertEqual(payload["error"]["code"], "env/node-modules-missing")

    def test_verify_refuses_non_empty_evidence(self):
        output, _ = self.create()
        evidence = self.temp / "evidence used"
        evidence.mkdir()
        marker = evidence / "old-evidence.txt"
        marker.write_text("keep", encoding="utf-8")
        code, payload, _ = run_cli(
            "verify", "--project", str(output), "--evidence", str(evidence)
        )
        self.assertEqual(code, 4)
        self.assertEqual(payload["error"]["code"], "evidence/non-empty")
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_matrix_refuses_non_empty_evidence_root(self):
        evidence = self.temp / "matrix evidence"
        evidence.mkdir()
        (evidence / "old.json").write_text("{}", encoding="utf-8")
        base = self.temp / "matrix project base"
        code, payload, _ = run_cli(
            "matrix", "--base", str(base), "--evidence", str(evidence)
        )
        self.assertEqual(code, 4)
        self.assertEqual(payload["error"]["code"], "evidence/non-empty")
        self.assertFalse(base.exists())

    def test_build_failure_returns_exit_one(self):
        output, _ = self.create()
        package_path = output / "package.json"
        package = json.loads(package_path.read_text(encoding="utf-8"))
        package["scripts"]["build"] = "node -e \"console.error('forced failure'); process.exit(1)\""
        package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        code, payload, _ = run_cli(
            "build", "--project", str(output), "--frontend-only"
        )
        self.assertEqual(code, 1)
        self.assertEqual(payload["error"]["code"], "build/step-failed")
        self.assertTrue((output / "package-lock.json").is_file())

    def test_inspect_lists_registry_surface(self):
        code, payload, _ = run_cli("inspect")
        self.assertEqual(code, 0)
        self.assertEqual(payload["pageSchemaVersion"], 1)
        self.assertEqual(payload["modes"], ["a", "b", "d"])
        for component in ("InstanceList", "JavaPanel", "IdentityPicker", "MicrosoftIdentity"):
            self.assertIn(component, payload["components"])
        self.assertIn("identity.select", payload["actions"])
        self.assertEqual(payload["templates"]["sidebar"]["b"]["ok"], True)

    def test_self_check(self):
        code, payload, _ = run_cli("self-check")
        self.assertEqual(code, 0, payload)
        self.assertTrue(payload["ok"])
        if not IS_DISTRIBUTION:
            self.assertEqual(payload["kind"], "source")
            self.assertTrue(payload["integrity"]["skipped"])


@unittest.skipUnless(IS_DISTRIBUTION, "distribution integrity checks need DISTRIBUTION.json")
class DistributionIntegrityTests(unittest.TestCase):
    def test_self_check_detects_missing_hand_authored_docs(self):
        for name in ("README.md", "SKILL.md"):
            target = ROOT / name
            original = target.read_bytes()
            try:
                target.unlink()
                code, payload, stderr = run_cli("self-check")
                self.assertEqual(code, 2, f"{name}: {payload}\n{stderr}")
                self.assertNotIn("Traceback", stderr, name)
                self.assertEqual(payload["error"]["code"], "dist/hand-authored-missing")
                self.assertTrue(
                    any(item.get("path") == name for item in payload.get("errors", [])),
                    f"{name}: {payload}",
                )
            finally:
                target.write_bytes(original)
        code, payload, stderr = run_cli("self-check")
        self.assertEqual(code, 0, f"{payload}\n{stderr}")

    def test_tampered_schema_is_detected_and_restored(self):
        schema = ROOT / "schemas" / "page.schema.json"
        original = schema.read_bytes()
        try:
            schema.write_bytes(original + b"\n")
            code, payload, _ = run_cli("self-check")
            self.assertEqual(code, 2)
            # A schema edit is caught by the schema/validator lock before the
            # manifest hash check; accept either stable failure code.
            if payload["error"]["code"] == "compat/invalid":
                self.assertTrue(
                    any(item.get("code") == "compat/validator-drift" for item in payload.get("errors", []))
                )
            else:
                self.assertEqual(payload["error"]["code"], "dist/file-modified")
                self.assertTrue(
                    any(item.get("code") == "dist/file-modified" for item in payload.get("errors", []))
                )
        finally:
            schema.write_bytes(original)
        code, payload, _ = run_cli("self-check")
        self.assertEqual(code, 0, payload)


if __name__ == "__main__":
    unittest.main(verbosity=2)
