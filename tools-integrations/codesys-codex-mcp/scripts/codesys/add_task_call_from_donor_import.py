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


def _object_type(obj):
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


def _walk(root):
    result = []

    def visit(obj, path):
        result.append((obj, path))
        for child in _children(obj, False):
            visit(child, path + [child])

    visit(root, [])
    return result


def _path_names(path):
    return [_object_name(item) for item in path]


def _find_by_name(root, name):
    return [(obj, path) for obj, path in _walk(root) if _object_name(obj) == name]


def _child_by_name(obj, name):
    for index, child in enumerate(_children(obj, False)):
        if _object_name(child) == name:
            return child, index
    return None, -1


def _has_child(obj, name):
    child, _index = _child_by_name(obj, name)
    return child is not None


def _first_differing_ancestor(path_a, path_b):
    limit = min(len(path_a), len(path_b))
    index = 0
    while index < limit and path_a[index] is path_b[index]:
        index += 1
    if index < len(path_b):
        return path_b[index], index
    return None, -1


def _make_import_reporter():
    try:
        base = ImportReporter  # noqa: F821 - CODESYS global
    except Exception:
        return None

    class Reporter(base):
        def __init__(self):
            self.events = []

        def error(self, message):
            self.events.append({"level": "error", "message": _string(message)})

        def warning(self, message):
            self.events.append({"level": "warning", "message": _string(message)})

        def resolve_conflict(self, obj):
            try:
                return ConflictResolve.Replace  # noqa: F821 - CODESYS global
            except Exception:
                return None

    return Reporter()


def _import_xml(project, import_path):
    reporter = _make_import_reporter()
    last_error = None
    for attempt in (
        lambda: project.import_xml(import_path, reporter),
        lambda: project.import_xml(reporter, import_path),
        lambda: project.import_xml(import_path),
    ):
        try:
            attempt()
            return reporter
        except TypeError as error:
            last_error = error
        except AttributeError as error:
            last_error = error
    if last_error is not None:
        raise last_error
    return reporter


def _save_project(project):
    for method in ("save", "save_all"):
        fn = getattr(project, method, None)
        if fn:
            fn()
            return method
    return None


def _summarize_task(task):
    return {
        "name": _object_name(task),
        "type": _object_type(task),
        "children": [_object_name(child) for child in _children(task, False)]
    }


def _repair(project, task_name, call_name, before_name):
    tasks = _find_by_name(project, task_name)
    if not tasks:
        raise Exception("Task not found: " + task_name)

    tasks_with_call = [(obj, path) for obj, path in tasks if _has_child(obj, call_name)]
    tasks_without_call = [(obj, path) for obj, path in tasks if not _has_child(obj, call_name)]

    if tasks_with_call and len(tasks) == 1:
        return {
            "changed": False,
            "reason": "target task already contains call",
            "tasks": [_summarize_task(item[0]) for item in tasks]
        }

    if not tasks_with_call:
        raise Exception("No donor task contains call: " + call_name)
    if not tasks_without_call:
        raise Exception("No original task without call was found")

    original_task, original_path = tasks_without_call[0]
    donor_task, donor_path = tasks_with_call[-1]
    original_path_names = _path_names(original_path)
    donor_path_names = _path_names(donor_path)
    call_obj, _call_index = _child_by_name(donor_task, call_name)
    if call_obj is None:
        raise Exception("Call disappeared before move: " + call_name)

    _before_obj, before_index = _child_by_name(original_task, before_name)
    insert_index = max(before_index - 1, 0) if before_index >= 0 else len(_children(original_task, False))
    call_obj.move(original_task, insert_index)
    moved_call_obj, _moved_call_index = _child_by_name(original_task, call_name)
    if moved_call_obj is not None:
        moved_call_obj.move(original_task, len(_children(original_task, False)))

    reordered_before = False
    moved_children = _children(original_task, False)
    call_pos = -1
    before_pos = -1
    before_obj_after_move = None
    for index, child in enumerate(moved_children):
        child_name = _object_name(child)
        if child_name == call_name:
            call_pos = index
        elif child_name == before_name:
            before_pos = index
            before_obj_after_move = child
    if before_obj_after_move is not None and call_pos > before_pos >= 0:
        before_obj_after_move.move(original_task, len(moved_children))
        reordered_before = True

    donor_branch, donor_branch_index = _first_differing_ancestor(original_path, donor_path)
    removed_branch = None
    if donor_branch is not None:
        removed_branch = {
            "name": _object_name(donor_branch),
            "type": _object_type(donor_branch),
            "path": donor_path_names[:donor_branch_index + 1]
        }
        donor_branch.remove()

    return {
        "changed": True,
        "movedCall": call_name,
        "insertIndex": insert_index,
        "reorderedBeforeObjectToEnd": reordered_before,
        "originalTaskPath": original_path_names,
        "donorTaskPath": donor_path_names,
        "removedDonorBranch": removed_branch,
        "taskAfterMove": _summarize_task(original_task)
    }


def main():
    if len(sys.argv) < 2:
        raise Exception("Expected one script argument containing a job JSON path.")
    job_path = sys.argv[1]
    job = _read_json(job_path)
    result_path = job.get("resultPath")
    args = job.get("arguments") or {}
    project_path = args.get("projectPath")
    import_path = args.get("importPath")
    task_name = args.get("taskName") or "MainTask"
    call_name = args.get("callName") or "AxisStatusFeedback_PRG"
    before_name = args.get("beforeName") or "ModbusTcpSlave"
    project = None
    try:
        project = projects.open(project_path)  # noqa: F821 - CODESYS global
        before_tasks = [_summarize_task(item[0]) for item in _find_by_name(project, task_name)]
        reporter = None
        if import_path:
            reporter = _import_xml(project, import_path)
        repair_result = _repair(project, task_name, call_name, before_name)
        saved_by = _save_project(project)
        payload = {
            "ok": True,
            "projectPath": project_path,
            "importPath": import_path,
            "reporterEvents": getattr(reporter, "events", []) if reporter is not None else [],
            "beforeTasks": before_tasks,
            "repair": repair_result,
            "savedBy": saved_by
        }
        _write_json(result_path, payload)
        print("ADD_TASK_CALL_RESULT:" + json.dumps(payload, default=_string))
    except Exception as error:
        payload = {
            "ok": False,
            "error": _string(error),
            "traceback": traceback.format_exc()
        }
        _write_json(result_path, payload)
        print("ADD_TASK_CALL_RESULT:" + json.dumps(payload, default=_string))
        sys.exit(1)
    finally:
        if project is not None:
            try:
                project.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
