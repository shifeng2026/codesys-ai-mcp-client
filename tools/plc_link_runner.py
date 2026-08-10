# -*- coding: utf-8 -*-
"""Run focused PLC/Python verification actions for the local Codex client."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any]) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n")
    return 0 if payload.get("ok", True) else 1


def load_module(script: Path, python_root: Path):
    resolved_script = script.expanduser().resolve()
    resolved_root = python_root.expanduser().resolve()
    if not resolved_script.exists():
        raise FileNotFoundError(f"Python file not found: {resolved_script}")
    if str(resolved_root) not in sys.path:
        sys.path.insert(0, str(resolved_root))
    spec = importlib.util.spec_from_file_location("codex_plc_target", resolved_script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import Python file: {resolved_script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, resolved_script, resolved_root


def make_controller(module, class_name: str, ip: str, port: int, timeout: float):
    cls = getattr(module, class_name, None)
    if cls is None:
        candidates = [
            value for value in module.__dict__.values()
            if isinstance(value, type) and ("control" in value.__name__.lower() or "plc" in value.__name__.lower())
        ]
        if not candidates:
            raise AttributeError(f"Class not found: {class_name}")
        cls = candidates[0]
    return cls(ip, port=port, timeout=timeout)


def close_controller(controller) -> None:
    close = getattr(controller, "close", None)
    if callable(close):
        close()


def action_import_check(args: argparse.Namespace) -> dict[str, Any]:
    module, script, root = load_module(Path(args.script), Path(args.python_root))
    class_names = [
        name for name, value in module.__dict__.items()
        if isinstance(value, type) and getattr(value, "__module__", "") == module.__name__
    ]
    return {
        "ok": True,
        "action": "import_check",
        "script": str(script),
        "pythonRoot": str(root),
        "classes": class_names,
    }


def action_with_controller(args: argparse.Namespace) -> dict[str, Any]:
    module, script, root = load_module(Path(args.script), Path(args.python_root))
    controller = make_controller(module, args.class_name, args.ip, args.port, args.timeout)
    try:
        if args.action == "read_positions":
            if hasattr(controller, "get"):
                value = controller.get("FiveDOF_positions")
            else:
                value = controller.read_all_actual_positions()
            return {
                "ok": value is not None,
                "action": args.action,
                "readOnly": True,
                "script": str(script),
                "pythonRoot": str(root),
                "ip": args.ip,
                "port": args.port,
                "value": value,
                "error": "" if value is not None else "No feedback returned",
            }
        if args.action == "read_log":
            if hasattr(controller, "get"):
                value = controller.get("plc_log")
            else:
                value = controller.get_log()
            return {
                "ok": True,
                "action": args.action,
                "readOnly": False,
                "script": str(script),
                "pythonRoot": str(root),
                "ip": args.ip,
                "port": args.port,
                "value": value,
                "note": "This action may acknowledge the PLC log as read.",
            }
        if args.action == "call_get":
            value = controller.get(args.key)
            return {
                "ok": value is not None,
                "action": args.action,
                "key": args.key,
                "value": value,
            }
        if args.action == "call_set":
            value = json.loads(args.value_json)
            result = controller.set(args.key, value, wait_complete=args.wait_complete)
            return {
                "ok": bool(result),
                "action": args.action,
                "key": args.key,
                "value": value,
                "result": result,
            }
        raise ValueError(f"Unsupported action: {args.action}")
    finally:
        close_controller(controller)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run local PLC/Python linkage checks.")
    parser.add_argument("--python-root", required=True)
    parser.add_argument("--script", required=True)
    parser.add_argument("--class-name", default="ControlFiveDOF")
    parser.add_argument("--ip", required=True)
    parser.add_argument("--port", type=int, default=502)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--action", required=True, choices=["import_check", "read_positions", "read_log", "call_get", "call_set"])
    parser.add_argument("--key", default="")
    parser.add_argument("--value-json", default="null")
    parser.add_argument("--wait-complete", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.action == "import_check":
            return emit(action_import_check(args))
        return emit(action_with_controller(args))
    except Exception as exc:
        return emit({"ok": False, "action": args.action, "error": str(exc)})


if __name__ == "__main__":
    raise SystemExit(main())
