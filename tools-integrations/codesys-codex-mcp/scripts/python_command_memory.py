# -*- coding: utf-8 -*-
"""Generate and remember per-file Python execution commands.

The memory key is the absolute file path plus a version id. The version id uses
an explicit script version when one is visible in code or filename, and always
includes a content hash so changed files do not accidentally reuse stale
commands.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
GENERATOR_VERSION = 2
VERSION_NAMES = {
    "__version__",
    "VERSION",
    "SCRIPT_VERSION",
    "TOOL_VERSION",
    "APP_VERSION",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def default_memory_path() -> Path:
    override = os.environ.get("PYTHON_COMMAND_MEMORY_PATH")
    if override:
        return Path(override).expanduser().resolve()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "codesys-codex-mcp" / "python-command-memory.json"
    return Path.home() / ".codesys-codex-mcp" / "python-command-memory.json"


def q(value: str) -> str:
    if os.name == "nt":
        return subprocess_list2cmdline([value])
    return shlex.quote(value)


def subprocess_list2cmdline(values: list[str]) -> str:
    try:
        import subprocess

        return subprocess.list2cmdline(values)
    except Exception:
        return " ".join('"' + item.replace('"', '\\"') + '"' for item in values)


def json_result(payload: dict[str, Any]) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return 0 if payload.get("ok", True) else 1


def load_memory(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": SCHEMA_VERSION, "entries": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        backup = path.with_suffix(path.suffix + ".broken")
        path.replace(backup)
        return {"schemaVersion": SCHEMA_VERSION, "entries": {}, "recoveredFromBroken": str(backup)}
    if not isinstance(data, dict):
        return {"schemaVersion": SCHEMA_VERSION, "entries": {}}
    data.setdefault("schemaVersion", SCHEMA_VERSION)
    data.setdefault("entries", {})
    return data


def save_memory(path: Path, memory: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(memory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def path_key(path: Path) -> str:
    normalized = str(path).casefold() if os.name == "nt" else str(path)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def literal_string(node: ast.AST) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float)):
        return str(node.value)
    return None


def extract_versions(source: str, tree: ast.AST, script_path: Path) -> list[dict[str, str]]:
    versions: list[dict[str, str]] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        value = literal_string(node.value)
        if value is None:
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in VERSION_NAMES:
                versions.append({"source": "assignment", "name": target.id, "value": value})

    regexes = [
        (r"(?im)^\s*#\s*(?:version|script_version|tool_version)\s*[:=]\s*([A-Za-z0-9_.-]+)", "comment"),
        (r"(?im)^\s*(?:version|script_version|tool_version)\s*[:=]\s*([A-Za-z0-9_.-]+)", "plain_text"),
    ]
    for pattern, source_name in regexes:
        for match in re.finditer(pattern, source):
            versions.append({"source": source_name, "name": "version", "value": match.group(1)})

    name_match = re.search(r"(?:^|[_\-.])(v\d+(?:[._-]\d+)*)", script_path.stem, re.IGNORECASE)
    if name_match:
        versions.append({"source": "filename", "name": "filename_version", "value": name_match.group(1)})

    seen = set()
    unique: list[dict[str, str]] = []
    for item in versions:
        key = (item["source"], item["name"], item["value"])
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = call_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    if isinstance(node, ast.Call):
        return call_name(node.func)
    return ""


def kw_value(node: ast.Call, name: str) -> Any:
    for kw in node.keywords:
        if kw.arg == name:
            if isinstance(kw.value, ast.Constant):
                return kw.value.value
            if isinstance(kw.value, ast.Name):
                return kw.value.id
            return ast.unparse(kw.value) if hasattr(ast, "unparse") else None
    return None


def string_args(node: ast.Call) -> list[str]:
    result = []
    for arg in node.args:
        value = literal_string(arg)
        if value is not None:
            result.append(value)
    return result


def has_main_guard(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        test = node.test
        if not isinstance(test, ast.Compare):
            continue
        left = test.left
        if not (isinstance(left, ast.Name) and left.id == "__name__"):
            continue
        for comparator in test.comparators:
            if literal_string(comparator) == "__main__":
                return True
    return False


def discover_argparse(tree: ast.AST) -> dict[str, Any]:
    parser_names = set()
    arguments: list[dict[str, Any]] = []
    parse_calls = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            name = call_name(node.value.func)
            if name.endswith("ArgumentParser") or name == "argparse.ArgumentParser":
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        parser_names.add(target.id)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            receiver = call_name(node.func.value)
            method = node.func.attr
            if method == "add_argument" and (not parser_names or receiver in parser_names or receiver.endswith("parser")):
                names = string_args(node)
                if not names:
                    continue
                action = kw_value(node, "action")
                required = kw_value(node, "required")
                nargs = kw_value(node, "nargs")
                metavar = kw_value(node, "metavar")
                dest = kw_value(node, "dest")
                arguments.append(
                    {
                        "names": names,
                        "action": str(action) if action is not None else "",
                        "required": bool(required) if isinstance(required, bool) else False,
                        "nargs": str(nargs) if nargs is not None else "",
                        "metavar": str(metavar) if metavar is not None else "",
                        "dest": str(dest) if dest is not None else "",
                    }
                )
            elif method in {"parse_args", "parse_known_args"}:
                parse_calls.append(receiver)

    return {"parserNames": sorted(parser_names), "arguments": arguments, "parseCalls": parse_calls}


def discover_click_typer(tree: ast.AST) -> dict[str, Any]:
    decorators = []
    imports = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in {"click", "typer"}:
                    imports.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module in {"click", "typer"}:
            imports.add(node.module)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                name = call_name(decorator)
                if "click" in name or "typer" in name:
                    decorators.append({"function": node.name, "decorator": name})
    return {"imports": sorted(imports), "decorators": decorators}


def discover_runtime_signals(tree: ast.AST) -> dict[str, Any]:
    signals = {
        "hasMainGuard": has_main_guard(tree),
        "usesSysArgv": False,
        "usesInput": False,
        "usesEnv": False,
        "topLevelFunctions": [],
    }

    for node in ast.walk(tree):
        name = call_name(node)
        if name == "sys.argv":
            signals["usesSysArgv"] = True
        elif isinstance(node, ast.Call) and call_name(node.func) == "input":
            signals["usesInput"] = True
        elif name.startswith("os.environ") or name == "environ":
            signals["usesEnv"] = True

    if isinstance(tree, ast.Module):
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                signals["topLevelFunctions"].append(node.name)
    return signals


def placeholder_for(arg: dict[str, Any]) -> str:
    name = arg.get("metavar") or arg.get("dest") or ""
    if not name:
        names = arg.get("names") or []
        if names:
            name = names[-1].lstrip("-").replace("-", "_")
    return f"<{name or 'value'}>"


def command_from_argparse(script_path: Path, python_exe: str, argparse_info: dict[str, Any]) -> tuple[str, list[str], list[str]]:
    argv = [python_exe, str(script_path)]
    optional_examples = []

    for arg in argparse_info.get("arguments", []):
        names = arg.get("names") or []
        if not names:
            continue
        primary = next((item for item in names if item.startswith("--")), names[0])
        is_optional = primary.startswith("-")
        action = arg.get("action", "")
        is_flag = action in {"store_true", "store_false", "count"}
        if not is_optional:
            argv.append(placeholder_for(arg))
        elif arg.get("required"):
            argv.append(primary)
            if not is_flag:
                argv.append(placeholder_for(arg))
        else:
            if is_flag:
                optional_examples.append(primary)
            else:
                optional_examples.append(f"{primary} {placeholder_for(arg)}")

    return subprocess_list2cmdline(argv), argv, optional_examples


def infer_project_root(script_path: Path, cwd: str | None) -> Path:
    if cwd:
        candidate = Path(cwd).expanduser().resolve()
        if (candidate / "daq_plc_interface").exists():
            return candidate

    parts = list(script_path.resolve().parts)
    lowered = [part.lower() for part in parts]
    if "daq_plc_interface" in lowered:
        index = lowered.index("daq_plc_interface")
        if index > 0:
            return Path(*parts[:index])
    return script_path.parent


def method_names(tree: ast.AST) -> set[str]:
    return {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def class_names(tree: ast.AST) -> set[str]:
    return {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef)
    }


def generate_daqctrl_project_command(script_path: Path, source: str, tree: ast.AST, python_exe: str, cwd: str | None) -> dict[str, Any] | None:
    root = infer_project_root(script_path, cwd)
    package_dir = root / "daq_plc_interface"
    ctrl_path = package_dir / "ctrl.py"
    devices_path = package_dir / "devices.json"
    if not ctrl_path.exists() or not (package_dir / "__init__.py").exists():
        return None

    methods = method_names(tree)
    classes = class_names(tree)
    script_text = str(script_path).lower()
    source_has_fivedof = (
        "ControlFiveDOF" in classes
        or "FiveDOF_positions" in source
        or "FiveDOF_move_fivedof" in source
        or "read_all_actual_positions" in methods
        or "move_fivedof_platform" in methods
        or "fivedof" in script_text
    )
    if not source_has_fivedof:
        return None

    device_name = "fivedof"
    device_info: dict[str, Any] = {}
    if devices_path.exists():
        try:
            devices = json.loads(devices_path.read_text(encoding="utf-8-sig"))
            if isinstance(devices, dict) and isinstance(devices.get(device_name), dict):
                device_info = devices[device_name]
        except Exception:
            device_info = {}

    code = (
        "import json,atexit; "
        "from daq_plc_interface import ModbusCtrl; "
        "ctrl=ModbusCtrl(fivedof_device='fivedof'); "
        "atexit.register(ctrl.close); "
        "print(json.dumps({'fivedof_positions': ctrl.get('fivedof_positions')}, ensure_ascii=False))"
    )
    argv = [python_exe, "-c", code]
    notes = [
        "已读取当前五轴 Python 代码和 daq_plc_interface.ctrl.ModbusCtrl，生成的是可执行的一行命令。",
        "默认命令只读当前位置反馈；需要写 PLC 的移动/回零命令应在现场安全确认后再生成或手动保存。",
    ]
    if "FiveDOF_move_push" in source and "move_pushmotor" not in methods:
        notes.append("未生成 FiveDOF_move_push：当前代码 actions 引用了缺失的 move_pushmotor()。")
    if "FiveDOF_vibrator" in source and "control_vibrator" not in methods:
        notes.append("未生成 FiveDOF_vibrator：当前代码 actions 引用了缺失的 control_vibrator()。")

    return {
        "command": subprocess_list2cmdline(argv),
        "argv": argv,
        "cwd": str(root),
        "confidence": "high",
        "notes": notes,
        "analysis": {
            "projectApi": {
                "type": "daq_plc_interface.ModbusCtrl",
                "deviceName": device_name,
                "device": device_info,
                "scriptClassNames": sorted(classes),
                "scriptMethods": sorted(methods),
            }
        },
    }


def generate_command(script_path: Path, source: str, tree: ast.AST, python_exe: str, cwd: str | None) -> dict[str, Any]:
    argparse_info = discover_argparse(tree)
    click_typer = discover_click_typer(tree)
    signals = discover_runtime_signals(tree)
    notes = []
    confidence = "medium"

    project_command = generate_daqctrl_project_command(script_path, source, tree, python_exe, cwd)
    if project_command:
        project_command["analysis"].update(
            {
                "argparse": argparse_info,
                "clickTyper": click_typer,
                "signals": signals,
            }
        )
        return project_command

    if argparse_info["arguments"] or argparse_info["parseCalls"]:
        command, argv, optional_examples = command_from_argparse(script_path, python_exe, argparse_info)
        notes.append("Detected argparse usage; required positionals and required options were added as placeholders.")
        if optional_examples:
            notes.append("Optional arguments seen: " + "; ".join(optional_examples))
        confidence = "high"
    elif click_typer["imports"] or click_typer["decorators"]:
        argv = [python_exe, str(script_path), "--help"]
        command = subprocess_list2cmdline(argv)
        notes.append("Detected click/typer style CLI. Start with --help, then save the real command after confirming options.")
        confidence = "medium"
    elif signals["hasMainGuard"] or signals["usesSysArgv"]:
        argv = [python_exe, str(script_path)]
        command = subprocess_list2cmdline(argv)
        notes.append("Detected a script entry point. No required CLI arguments were proven by static analysis.")
        confidence = "medium"
    else:
        argv = [python_exe, str(script_path)]
        command = subprocess_list2cmdline(argv)
        notes.append("No clear CLI entry point was found. This command only runs the file; confirm the intended function before using it for automation.")
        confidence = "low"

    if signals["usesInput"]:
        notes.append("Script appears to use input(); unattended execution may block.")
    if signals["usesEnv"]:
        notes.append("Script appears to read environment variables; verify required environment before running.")

    return {
        "command": command,
        "argv": argv,
        "cwd": cwd or str(script_path.parent),
        "confidence": confidence,
        "notes": notes,
        "analysis": {
            "argparse": argparse_info,
            "clickTyper": click_typer,
            "signals": signals,
        },
    }


def inspect_script(script_path: Path, python_exe: str) -> dict[str, Any]:
    resolved = script_path.expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"Python file not found: {resolved}")
    if not resolved.is_file():
        raise ValueError(f"Path is not a file: {resolved}")
    if resolved.suffix.lower() != ".py":
        raise ValueError(f"Path is not a .py file: {resolved}")

    content_bytes = resolved.read_bytes()
    source = content_bytes.decode("utf-8-sig")
    tree = ast.parse(source, filename=str(resolved))
    digest = hashlib.sha256(content_bytes).hexdigest()
    stat = resolved.stat()
    versions = extract_versions(source, tree, resolved)
    explicit_version = versions[0]["value"] if versions else ""
    version_id = f"{explicit_version}|sha256:{digest[:12]}" if explicit_version else f"sha256:{digest[:12]}"

    return {
        "path": str(resolved),
        "fileName": resolved.name,
        "pathKey": path_key(resolved),
        "sha256": digest,
        "sha256Short": digest[:12],
        "sizeBytes": stat.st_size,
        "mtimeUtc": datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat(),
        "versions": versions,
        "explicitVersion": explicit_version,
        "versionId": version_id,
        "source": source,
        "tree": tree,
        "pythonExe": python_exe,
    }


def suggest(args: argparse.Namespace) -> int:
    memory_path = Path(args.memory_path).expanduser().resolve() if args.memory_path else default_memory_path()
    python_exe = args.python_exe or os.environ.get("PYTHON_EXE") or sys.executable or "python"
    info = inspect_script(Path(args.script), python_exe)
    memory = load_memory(memory_path)
    entries = memory.setdefault("entries", {})
    file_entry = entries.setdefault(
        info["pathKey"],
        {
            "canonicalPath": info["path"],
            "fileName": info["fileName"],
            "versions": {},
        },
    )
    file_entry["canonicalPath"] = info["path"]
    file_entry["fileName"] = info["fileName"]
    file_entry.setdefault("versions", {})

    version_id = info["versionId"]
    existing = file_entry["versions"].get(version_id)
    cache_hit = existing is not None and not args.force and existing.get("generatorVersion") == GENERATOR_VERSION

    if cache_hit:
        existing["hitCount"] = int(existing.get("hitCount", 0)) + 1
        existing["lastUsedAt"] = utc_now()
        save_memory(memory_path, memory)
        return json_result(
            {
                "ok": True,
                "cache": "hit",
                "memoryPath": str(memory_path),
                "file": file_summary(info),
                "commandRecord": existing,
            }
        )

    generated = generate_command(Path(info["path"]), info["source"], info["tree"], python_exe, args.cwd)
    if args.command:
        generated["command"] = args.command
        generated["argv"] = []
        generated["confidence"] = "manual"
        generated.setdefault("notes", []).append("Command was provided manually and saved for this file/version.")
    if args.notes:
        generated.setdefault("notes", []).append(args.notes)

    record = {
        "versionId": version_id,
        "generatorVersion": GENERATOR_VERSION,
        "explicitVersion": info["explicitVersion"],
        "sha256": info["sha256"],
        "sha256Short": info["sha256Short"],
        "sizeBytes": info["sizeBytes"],
        "mtimeUtc": info["mtimeUtc"],
        "command": generated["command"],
        "argv": generated["argv"],
        "cwd": generated["cwd"],
        "confidence": generated["confidence"],
        "notes": generated["notes"],
        "analysis": generated["analysis"],
        "createdAt": utc_now(),
        "updatedAt": utc_now(),
        "hitCount": 0,
        "lastUsedAt": None,
    }
    file_entry["versions"][version_id] = record
    file_entry["lastUpdatedAt"] = utc_now()
    save_memory(memory_path, memory)

    return json_result(
        {
            "ok": True,
            "cache": "miss" if existing is None else "refreshed",
            "memoryPath": str(memory_path),
            "file": file_summary(info),
            "commandRecord": record,
        }
    )


def file_summary(info: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": info["path"],
        "fileName": info["fileName"],
        "pathKey": info["pathKey"],
        "versionId": info["versionId"],
        "explicitVersion": info["explicitVersion"],
        "versions": info["versions"],
        "sha256Short": info["sha256Short"],
        "sizeBytes": info["sizeBytes"],
        "mtimeUtc": info["mtimeUtc"],
    }


def list_memory(args: argparse.Namespace) -> int:
    memory_path = Path(args.memory_path).expanduser().resolve() if args.memory_path else default_memory_path()
    memory = load_memory(memory_path)
    entries = memory.get("entries", {})
    if args.script:
        try:
            script_path = Path(args.script).expanduser().resolve()
            key = path_key(script_path)
            entries = {key: entries[key]} if key in entries else {}
        except Exception:
            entries = {}
    return json_result({"ok": True, "memoryPath": str(memory_path), "entries": entries})


def forget(args: argparse.Namespace) -> int:
    memory_path = Path(args.memory_path).expanduser().resolve() if args.memory_path else default_memory_path()
    memory = load_memory(memory_path)
    entries = memory.setdefault("entries", {})
    removed: dict[str, Any] = {"files": 0, "versions": 0}

    if args.all:
        removed["files"] = len(entries)
        removed["versions"] = sum(len(item.get("versions", {})) for item in entries.values())
        memory["entries"] = {}
        save_memory(memory_path, memory)
        return json_result({"ok": True, "memoryPath": str(memory_path), "removed": removed})

    if not args.script:
        return json_result({"ok": False, "error": "Provide --script or --all."})

    script_path = Path(args.script).expanduser().resolve()
    key = path_key(script_path)
    file_entry = entries.get(key)
    if not file_entry:
        return json_result({"ok": True, "memoryPath": str(memory_path), "removed": removed})

    if args.version_id:
        if args.version_id in file_entry.get("versions", {}):
            del file_entry["versions"][args.version_id]
            removed["versions"] = 1
        if not file_entry.get("versions"):
            del entries[key]
            removed["files"] = 1
    else:
        removed["versions"] = len(file_entry.get("versions", {}))
        removed["files"] = 1
        del entries[key]

    save_memory(memory_path, memory)
    return json_result({"ok": True, "memoryPath": str(memory_path), "removed": removed})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate and remember Python execution commands per file/version.")
    subparsers = parser.add_subparsers(dest="command_name", required=True)

    suggest_parser = subparsers.add_parser("suggest", help="Return cached command or generate one by reading code.")
    suggest_parser.add_argument("--script", required=True, help="Python file to inspect.")
    suggest_parser.add_argument("--cwd", help="Working directory to store with the command.")
    suggest_parser.add_argument("--python-exe", help="Python executable to use in generated commands.")
    suggest_parser.add_argument("--memory-path", help="Override memory JSON path.")
    suggest_parser.add_argument("--force", action="store_true", help="Re-read code and replace the saved command.")
    suggest_parser.add_argument("--command", help="Manual command to save for this file/version.")
    suggest_parser.add_argument("--notes", help="Extra notes to store with the generated command.")
    suggest_parser.set_defaults(func=suggest)

    list_parser = subparsers.add_parser("list", help="List saved command memory.")
    list_parser.add_argument("--script", help="Limit history to one Python file.")
    list_parser.add_argument("--memory-path", help="Override memory JSON path.")
    list_parser.set_defaults(func=list_memory)

    forget_parser = subparsers.add_parser("forget", help="Delete command memory.")
    forget_parser.add_argument("--script", help="Python file to forget.")
    forget_parser.add_argument("--version-id", help="Delete only one version id for the file.")
    forget_parser.add_argument("--memory-path", help="Override memory JSON path.")
    forget_parser.add_argument("--all", action="store_true", help="Delete all command memory.")
    forget_parser.set_defaults(func=forget)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:
        return json_result({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    raise SystemExit(main())
