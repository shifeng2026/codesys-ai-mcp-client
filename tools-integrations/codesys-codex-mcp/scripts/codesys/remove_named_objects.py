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


def _read_json(path):
    with open(path, "r") as handle:
        return json.load(handle)


def _write_json(path, payload):
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with open(path, "w") as handle:
        json.dump(payload, handle, indent=2, default=_string)


def _object_name(obj):
    try:
        return obj.get_name(False)
    except Exception:
        try:
            return obj.name
        except Exception:
            return _string(obj)


def _children(obj):
    try:
        return list(obj.get_children(False))
    except Exception:
        try:
            return list(obj.get_children())
        except Exception:
            return []


def _walk(root):
    result = []

    def visit(obj, path):
        result.append((obj, path))
        for child in _children(obj):
            visit(child, path + [_object_name(child)])

    visit(root, [])
    return result


def _save_project(project):
    for method in ("save", "save_all"):
        fn = getattr(project, method, None)
        if fn:
            fn()
            return method
    return None


def main():
    if len(sys.argv) < 2:
        raise Exception("Expected one script argument containing a job JSON path.")
    job_path = sys.argv[1]
    job = _read_json(job_path)
    result_path = job.get("resultPath")
    args = job.get("arguments") or {}
    project_path = args.get("projectPath")
    names = args.get("names") or []
    project = None
    try:
        project = projects.open(project_path)  # noqa: F821 - CODESYS global
        removed = []
        for name in names:
            matches = [(obj, path) for obj, path in _walk(project) if _object_name(obj) == name]
            for obj, path in matches:
                removed.append({"name": name, "path": path})
                obj.remove()
        saved_by = _save_project(project)
        payload = {
            "ok": True,
            "projectPath": project_path,
            "removed": removed,
            "savedBy": saved_by
        }
        _write_json(result_path, payload)
        print("REMOVE_NAMED_OBJECTS_RESULT:" + json.dumps(payload, default=_string))
    except Exception as error:
        payload = {
            "ok": False,
            "error": _string(error),
            "traceback": traceback.format_exc()
        }
        _write_json(result_path, payload)
        print("REMOVE_NAMED_OBJECTS_RESULT:" + json.dumps(payload, default=_string))
        sys.exit(1)
    finally:
        if project is not None:
            try:
                project.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
