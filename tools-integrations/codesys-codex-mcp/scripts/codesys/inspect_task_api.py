# encoding: utf-8
from __future__ import print_function

import json
import os
import sys
import traceback


def _string(value):
    try:
        return unicode(value)  # noqa: F821 - IronPython 2
    except NameError:
        return str(value)
    except Exception:
        return repr(value)


def _write_json(path, payload):
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with open(path, "w") as handle:
        json.dump(payload, handle, indent=2, default=_string)


def _read_json(path):
    with open(path, "r") as handle:
        return json.load(handle)


def _object_name(obj):
    try:
        return obj.get_name(False)
    except Exception:
        try:
            return obj.name
        except Exception:
            return _string(obj)


def _object_type(obj):
    for attr in ("type", "object_type", "type_name"):
        try:
            value = getattr(obj, attr)
            if value is not None:
                return _string(value)
        except Exception:
            pass
    try:
        return _string(obj.get_type())
    except Exception:
        return obj.__class__.__name__


def _children(obj, recursive=False):
    try:
        return list(obj.get_children(recursive))
    except Exception:
        try:
            return list(obj.get_children())
        except Exception:
            return []


def _find_all(root, name):
    found = []
    stack = list(_children(root, False))
    while stack:
        obj = stack.pop(0)
        if _object_name(obj) == name:
            found.append(obj)
        stack.extend(_children(obj, False))
    return found


def _attr_summary(obj):
    result = []
    names = set()
    for name in dir(obj):
        if name.startswith("_"):
            continue
        names.add(name)
    for name in (
        "create", "create_child", "add", "add_child", "append", "insert",
        "create_task", "add_task", "create_object", "insert_object",
        "create_pou", "create_program", "create_pou_instance",
        "create_program_call", "create_pou_call", "add_pou_call",
        "add_program_call",
        "remove", "delete", "move", "get_children", "get_parent",
        "get_name", "get_type", "set_parameter", "get_parameter",
        "set_property", "get_property", "update", "export_xml", "import_xml"
    ):
        names.add(name)
    for name in sorted(names):
        if name in ("get_children",):
            pass
        lowered = name.lower()
        interesting = any(token in lowered for token in (
            "add", "append", "call", "pou", "program", "task", "insert", "create", "remove", "delete", "move", "instance"
            , "parent"
        ))
        if not interesting:
            continue
        item = {"name": name}
        try:
            value = getattr(obj, name)
            item["type"] = _string(type(value))
            item["callable"] = callable(value)
            if callable(value):
                doc = getattr(value, "__doc__", None)
                if doc:
                    item["doc"] = _string(doc)
            if not callable(value):
                item["value"] = _string(value)
        except Exception as error:
            item["error"] = _string(error)
        result.append(item)
    return result


def _summarize(obj, depth):
    item = {
        "name": _object_name(obj),
        "type": _object_type(obj),
        "class": _string(obj.__class__)
    }
    if depth > 0:
        item["children"] = [_summarize(child, depth - 1) for child in _children(obj, False)]
    return item


def main():
    if len(sys.argv) < 2:
        raise Exception("Expected one script argument containing a job JSON path.")
    job_path = sys.argv[1]
    job = _read_json(job_path)
    result_path = job.get("resultPath")
    args = job.get("arguments") or {}
    project_path = args.get("projectPath")
    task_name = args.get("taskName") or "MainTask"
    project = None
    try:
        project = projects.open(project_path)  # noqa: F821 - CODESYS global
        tasks = _find_all(project, task_name)
        payload = {
            "ok": True,
            "projectPath": project_path,
            "taskName": task_name,
            "taskCount": len(tasks),
            "tasks": []
        }
        for task in tasks:
            payload["tasks"].append({
                "summary": _summarize(task, 2),
                "attrs": _attr_summary(task)
            })
        _write_json(result_path, payload)
        print("INSPECT_TASK_API_RESULT:" + json.dumps(payload, default=_string))
    except Exception as error:
        payload = {
            "ok": False,
            "error": _string(error),
            "traceback": traceback.format_exc()
        }
        _write_json(result_path, payload)
        print("INSPECT_TASK_API_RESULT:" + json.dumps(payload, default=_string))
        sys.exit(1)
    finally:
        if project is not None:
            try:
                project.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
