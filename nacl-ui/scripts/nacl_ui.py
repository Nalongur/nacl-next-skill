#!/usr/bin/env python3
"""Command-line entry for the NaCL Next UI Skill and the S3 template.

Exit codes (stable):
  0  success
  1  build / acceptance step failed
  2  usage, configuration, compatibility or validation error
  3  missing environment or installable dependency
  4  target/evidence path conflict (refused to overwrite user data)

Every command prints one JSON object on stdout; progress goes to stderr.
Stdout and stderr are always UTF-8 (independent of the Windows code page or
PYTHONUTF8); consumers must decode UTF-8.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from nacl_core import (
    LAYOUT_LABELS,
    ToolError,
    VALID_ADAPTERS,
    VALID_MODES,
    build_project,
    check_project,
    configure_stdio,
    create_project,
    distribution_check,
    find_distribution,
    inspect_contract,
    matrix,
    preview_project,
    validate_project,
    verify_project,
)


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:  # type: ignore[override]
        raise ToolError("usage/invalid", message, exit_code=2)


def build_parser() -> Parser:
    parser = Parser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="从固定 starter 生成一个工程")
    create.add_argument("--layout", choices=sorted(LAYOUT_LABELS), required=True)
    create.add_argument("--mode", choices=sorted(VALID_MODES), required=True)
    create.add_argument("--adapter", choices=sorted(VALID_ADAPTERS), default="ipc")
    create.add_argument("--output", required=True)
    create.add_argument("--product-name")
    create.add_argument("--identifier")
    create.add_argument("--title")

    check = subparsers.add_parser("check", help="检查分发完整性、兼容记录或生成工程")
    check.add_argument("--project")
    check.add_argument("--self", dest="self_check", action="store_true")

    validate = subparsers.add_parser("validate", help="校验页面与工程配置")
    validate.add_argument("--project", required=True)

    inspect = subparsers.add_parser("inspect", help="列出注册布局、组件、绑定、动作和参数")
    inspect.add_argument("--format", choices=["json"], default="json")

    preview = subparsers.add_parser("preview", help="以 mock 适配器启动布局预览")
    preview.add_argument("--project", required=True)
    preview.add_argument("--port", type=int, default=5173)
    preview.add_argument("--check", action="store_true", help="就绪后退出（自动化）")
    preview.add_argument("--mock", action="store_true", help="对 IPC 工程显式使用 mock 适配器")

    build = subparsers.add_parser("build", help="构建前端或桌面 EXE")
    build.add_argument("--project", required=True)
    build.add_argument("--frontend-only", action="store_true")
    build.add_argument("--fresh", action="store_true", help="强制重新执行 npm ci")

    verify = subparsers.add_parser("verify", help="完整验收：依赖、配置、测试、类型、构建、Rust、桌面")
    verify.add_argument("--project", required=True)
    verify.add_argument("--evidence", required=True)

    run_matrix = subparsers.add_parser("matrix", help="生成并验收两布局 × A/B/D 矩阵")
    run_matrix.add_argument("--base", required=True)
    run_matrix.add_argument("--evidence", required=True)
    run_matrix.add_argument("--layouts", default="sidebar,studio")
    run_matrix.add_argument("--modes", default="a,b,d")
    run_matrix.add_argument("--adapter", choices=sorted(VALID_ADAPTERS), default="ipc")

    subparsers.add_parser("self-check", help="只检查分发清单完整性")
    subparsers.add_parser("version", help="打印分发/模板版本与 SDK 快照")
    return parser


def dispatch(args: argparse.Namespace) -> dict:
    dist = find_distribution()
    if args.command == "create":
        return create_project(
            dist,
            layout=args.layout,
            mode=args.mode,
            adapter=args.adapter,
            output=Path(args.output),
            product_name=args.product_name,
            identifier=args.identifier,
            title=args.title,
        )
    if args.command == "check":
        if args.project:
            return check_project(dist, Path(args.project))
        if args.self_check:
            return distribution_check(dist)
        raise ToolError("usage/invalid", "check 需要 --project 或 --self", exit_code=2)
    if args.command == "self-check":
        return distribution_check(dist)
    if args.command == "validate":
        return validate_project(dist, Path(args.project))
    if args.command == "inspect":
        return inspect_contract(dist)
    if args.command == "preview":
        return preview_project(
            dist,
            project_dir=Path(args.project),
            port=args.port,
            check_only=args.check,
            mock_override=args.mock,
        )
    if args.command == "build":
        return build_project(
            dist,
            project_dir=Path(args.project),
            frontend_only=args.frontend_only,
            fresh=args.fresh,
        )
    if args.command == "verify":
        return verify_project(dist, project_dir=Path(args.project), evidence=Path(args.evidence))
    if args.command == "matrix":
        return matrix(
            dist,
            base=Path(args.base),
            evidence_root=Path(args.evidence),
            layouts=[item.strip() for item in args.layouts.split(",") if item.strip()],
            modes=[item.strip() for item in args.modes.split(",") if item.strip()],
            adapter=args.adapter,
        )
    if args.command == "version":
        return distribution_check(dist)
    raise ToolError("usage/invalid", f"未知命令 {args.command}", exit_code=2)


def main(argv: list[str] | None = None) -> int:
    configure_stdio()
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        result = dispatch(args)
    except ToolError as error:
        details = error.details if isinstance(error.details, dict) else {}
        payload = {
            "ok": False,
            "error": error.as_dict(),
            "errors": details.get("errors", []),
        }
        if error.details is not None:
            payload["details"] = error.details
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"[{error.code}] {error.message}", file=sys.stderr)
        return error.exit_code
    print(json.dumps({"ok": True, **result}, ensure_ascii=False, indent=2))
    if result.get("ok") is False:
        # validate/check report structured errors as a successful command run;
        # the process still fails so scripts cannot ignore the result.
        return 2 if args.command in ("validate", "check", "self-check") else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
