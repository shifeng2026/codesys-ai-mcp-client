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


def _json_default(value):
    return _string(value)


def _read_json(path):
    with open(path, "r") as handle:
        return json.load(handle)


def _write_json(path, payload):
    directory = os.path.dirname(path)
    if directory and not os.path.isdir(directory):
        os.makedirs(directory)
    with open(path, "w") as handle:
        json.dump(payload, handle, indent=2, default=_json_default)


def _strip_outer_quotes(value):
    if not value:
        return value
    if (value[0] == '"' and value[-1:] == '"') or (value[0] == "'" and value[-1:] == "'"):
        return value[1:-1]
    return value


def _load_job():
    if len(sys.argv) < 2:
        raise Exception("Expected one --scriptargs value containing the job JSON path.")
    job_path = _strip_outer_quotes(sys.argv[1])
    job = _read_json(job_path)
    job["_jobPath"] = job_path
    return job


def _finish(job, payload, exit_code):
    payload["jobPath"] = job.get("_jobPath")
    result_path = job.get("resultPath")
    if result_path:
        _write_json(result_path, payload)
    print("CODESYS_MCP_RESULT_JSON:" + json.dumps(payload, default=_json_default))
    sys.exit(exit_code)


def _safe_attr(obj, name, default=None):
    try:
        return getattr(obj, name)
    except Exception:
        return default


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
        value = _safe_attr(obj, attr)
        if value is not None:
            return _string(value)
    try:
        return _string(obj.get_type())
    except Exception:
        return obj.__class__.__name__


def _children(obj, recursive):
    try:
        return list(obj.get_children(recursive))
    except Exception:
        try:
            return list(obj.get_children())
        except Exception:
            return []


def _summarize_object(obj, depth):
    item = {
        "name": _object_name(obj),
        "type": _object_type(obj)
    }
    if depth > 0:
        children = _children(obj, False)
        if children:
            item["children"] = [_summarize_object(child, depth - 1) for child in children]
    return item


def _find_object_by_slash_path(root, slash_path):
    parts = [part for part in slash_path.replace("\\", "/").split("/") if part]
    if not parts:
        return None
    current = root
    if _object_name(current) == parts[0]:
        parts = parts[1:]
    for part in parts:
        found = None
        for child in _children(current, False):
            if _object_name(child) == part:
                found = child
                break
        if found is None:
            return None
        current = found
    return current


def _find_object(root, name_or_path):
    by_path = _find_object_by_slash_path(root, name_or_path)
    if by_path is not None:
        return by_path
    for obj in _children(root, True):
        if _object_name(obj) == name_or_path:
            return obj
    return None


def _project_children(project):
    children = _children(project, False)
    if children:
        return children
    return _children(project, True)


def _resolve_objects(project, object_paths):
    if object_paths:
        result = []
        missing = []
        for item in object_paths:
            obj = _find_object(project, item)
            if obj is None:
                missing.append(item)
            else:
                result.append(obj)
        if missing:
            raise Exception("Object paths not found: " + ", ".join(missing))
        return result
    return _project_children(project)


def _open_project(project_path):
    if not project_path:
        raise Exception("projectPath is required")
    if not os.path.isfile(project_path):
        raise Exception("projectPath does not exist: " + project_path)
    return projects.open(project_path)  # noqa: F821 - CODESYS global


def _save_project(project, save_as_path=None):
    if save_as_path:
        try:
            project.save_as(save_as_path)
            return "save_as"
        except Exception:
            project.save_as_compiled_library(save_as_path)
            return "save_as_compiled_library"
    for method in ("save", "save_all"):
        fn = _safe_attr(project, method)
        if fn:
            fn()
            return method
    return None


def _close_project(project):
    for method in ("close", "close_all"):
        fn = _safe_attr(project, method)
        if fn:
            try:
                fn()
                return
            except Exception:
                pass


def _select_application(project, application_name):
    active = _safe_attr(project, "active_application")
    if application_name:
        for obj in _children(project, True):
            if _object_name(obj) == application_name:
                return obj
        if active is not None and _object_name(active) == application_name:
            return active
        raise Exception("Application not found: " + application_name)
    if active is not None:
        return active
    for obj in _children(project, True):
        if str(_object_type(obj)).lower().endswith("application") or _safe_attr(obj, "is_application", False):
            return obj
    raise Exception("No active application found in project.")


def _collect_messages(limit):
    messages = []
    try:
        raw_messages = list(system.get_message_objects())  # noqa: F821 - CODESYS global
    except Exception:
        raw_messages = []
        try:
            raw_text = system.get_messages()  # noqa: F821
            if isinstance(raw_text, list):
                raw_messages = raw_text
            else:
                raw_messages = [raw_text]
        except Exception:
            raw_messages = []

    for item in raw_messages[-limit:]:
        if isinstance(item, basestring):  # noqa: F821 - IronPython 2
            messages.append({"text": item})
            continue
        text = _safe_attr(item, "message")
        if text is None:
            text = _safe_attr(item, "text")
        if text is None:
            text = _string(item)
        messages.append({
            "severity": _string(_safe_attr(item, "severity", "")),
            "category": _string(_safe_attr(item, "category", "")),
            "text": _string(text),
            "object": _string(_safe_attr(item, "object", ""))
        })
    return messages


def _message_counts(messages):
    errors = 0
    warnings = 0
    for message in messages:
        severity = str(message.get("severity", "")).lower()
        text = str(message.get("text", "")).lower()
        if "fatal" in severity or severity.endswith("error") or severity == "error":
            errors += 1
        elif severity.endswith("warning") or severity == "warning":
            warnings += 1
        elif "traceback" in text or "exception" in text:
            errors += 1
    return errors, warnings


def _call_first(attempts):
    last_error = None
    for attempt in attempts:
        try:
            return attempt()
        except TypeError as error:
            last_error = error
        except AttributeError as error:
            last_error = error
    if last_error is not None:
        raise last_error
    raise Exception("No callable export/import overload was available.")


def _make_export_reporter():
    try:
        base = ExportReporter  # noqa: F821 - CODESYS global
    except Exception:
        return None

    class Reporter(base):
        def __init__(self):
            self.events = []

        def error(self, obj, message):
            self.events.append({"level": "error", "object": _object_name(obj), "message": _string(message)})

        def warning(self, obj, message):
            self.events.append({"level": "warning", "object": _object_name(obj), "message": _string(message)})

        def nonexportable(self, obj):
            self.events.append({"level": "warning", "object": _object_name(obj), "message": "Object is not exportable"})

    return Reporter()


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


def _conflict_replace():
    try:
        return ConflictResolve.Replace  # noqa: F821 - CODESYS global
    except Exception:
        return None


def _run_info(args):
    project = _open_project(args.get("projectPath"))
    try:
        application = None
        try:
            application = _select_application(project, args.get("applicationName"))
        except Exception:
            application = None
        return {
            "ok": True,
            "action": "info",
            "projectPath": args.get("projectPath"),
            "activeApplication": _object_name(application) if application is not None else None,
            "objects": [_summarize_object(child, 2) for child in _project_children(project)]
        }
    finally:
        _close_project(project)


def _run_build(args):
    project = _open_project(args.get("projectPath"))
    try:
        if args.get("saveBeforeBuild"):
            _save_project(project)
        application = _select_application(project, args.get("applicationName"))
        mode = args.get("mode") or "rebuild"
        build_return = None
        if mode == "clean":
            build_return = application.clean()
        elif mode == "build":
            build_return = application.build()
        elif mode == "generate_code":
            build_return = application.generate_code()
        elif mode == "clean_build":
            try:
                application.clean()
            except Exception:
                pass
            build_return = application.build()
        else:
            build_return = application.rebuild()

        messages = _collect_messages(500)
        errors, warnings = _message_counts(messages)
        return {
            "ok": errors == 0,
            "action": "build",
            "projectPath": args.get("projectPath"),
            "applicationName": _object_name(application),
            "mode": mode,
            "buildReturn": _string(build_return),
            "errors": errors,
            "warnings": warnings,
            "messages": messages
        }
    finally:
        _close_project(project)


def _run_export(args):
    project = _open_project(args.get("projectPath"))
    try:
        export_path = args.get("exportPath")
        if not export_path:
            raise Exception("exportPath is required")
        export_path = os.path.abspath(export_path)
        export_format = (args.get("format") or "xml").lower()
        recursive = bool(args.get("recursive", True))
        declarations = bool(args.get("declarationsAsPlainText", True))
        objects = _resolve_objects(project, args.get("objectPaths") or [])
        reporter = _make_export_reporter()

        if export_format in ("xml", "plcopenxml"):
            directory = os.path.dirname(export_path)
            if directory and not os.path.isdir(directory):
                os.makedirs(directory)
            _call_first([
                lambda: project.export_xml(reporter, objects, export_path, recursive, declarations),
                lambda: project.export_xml(reporter, objects, export_path, recursive),
                lambda: project.export_xml(reporter, objects, export_path),
                lambda: project.export_xml(objects, export_path, recursive),
                lambda: project.export_xml(objects, export_path)
            ])
        elif export_format == "native":
            if not os.path.isdir(export_path):
                os.makedirs(export_path)
            _call_first([
                lambda: project.export_native(reporter, objects, export_path, recursive),
                lambda: project.export_native(reporter, objects, export_path),
                lambda: project.export_native(objects, export_path, recursive),
                lambda: project.export_native(objects, export_path)
            ])
        else:
            raise Exception("Unsupported export format: " + export_format)

        return {
            "ok": True,
            "action": "export",
            "projectPath": args.get("projectPath"),
            "exportPath": export_path,
            "format": export_format,
            "objectCount": len(objects),
            "reporterEvents": _safe_attr(reporter, "events", [])
        }
    finally:
        _close_project(project)


def _import_files(import_path, import_format):
    import_path = os.path.abspath(import_path)
    if os.path.isfile(import_path):
        return [import_path]
    if not os.path.isdir(import_path):
        raise Exception("importPath does not exist: " + import_path)
    extensions = [".export"] if import_format == "native" else [".xml"]
    result = []
    for root, _dirs, files in os.walk(import_path):
        for filename in files:
            if os.path.splitext(filename)[1].lower() in extensions:
                result.append(os.path.join(root, filename))
    result.sort()
    if not result:
        raise Exception("No import files found in " + import_path)
    return result


def _run_import(args):
    project = _open_project(args.get("projectPath"))
    try:
        import_path = args.get("importPath")
        if not import_path:
            raise Exception("importPath is required")
        import_format = (args.get("format") or "xml").lower()
        files = _import_files(import_path, "native" if import_format == "native" else "xml")
        reporter = _make_import_reporter()

        imported = []
        for file_path in files:
            if import_format in ("xml", "plcopenxml"):
                _call_first([
                    lambda path=file_path: project.import_xml(
                        dataOrPath=path,
                        conflictResolve=_conflict_replace(),
                        import_folder_structure=True,
                        reporter=reporter
                    ),
                    lambda path=file_path: project.import_xml(
                        dataOrPath=path,
                        conflictResolve=_conflict_replace(),
                        reporter=reporter
                    ),
                    lambda path=file_path: project.import_xml(path, _conflict_replace(), True, reporter),
                    lambda path=file_path: project.import_xml(path, _conflict_replace(), False, reporter),
                    lambda path=file_path: project.import_xml(path, _conflict_replace()),
                    lambda path=file_path: project.import_xml(path, reporter),
                    lambda path=file_path: project.import_xml(reporter, path),
                    lambda path=file_path: project.import_xml(path)
                ])
            elif import_format == "native":
                _call_first([
                    lambda path=file_path: project.import_native(reporter, path),
                    lambda path=file_path: project.import_native(path)
                ])
            else:
                raise Exception("Unsupported import format: " + import_format)
            imported.append(file_path)

        saved_by = None
        if args.get("save", True):
            saved_by = _save_project(project, args.get("saveAsPath"))

        return {
            "ok": True,
            "action": "import",
            "projectPath": args.get("projectPath"),
            "importPath": os.path.abspath(import_path),
            "format": import_format,
            "imported": imported,
            "savedBy": saved_by,
            "reporterEvents": _safe_attr(reporter, "events", [])
        }
    finally:
        _close_project(project)


def main():
    job = None
    try:
        job = _load_job()
        action = job.get("action")
        args = job.get("arguments") or {}
        if action == "info":
            result = _run_info(args)
        elif action == "build":
            result = _run_build(args)
        elif action == "export":
            result = _run_export(args)
        elif action == "import":
            result = _run_import(args)
        else:
            raise Exception("Unknown action: " + _string(action))
        _finish(job, result, 0 if result.get("ok") else 2)
    except SystemExit:
        raise
    except Exception as error:
        payload = {
            "ok": False,
            "error": _string(error),
            "traceback": traceback.format_exc()
        }
        if job is None:
            job = {"_jobPath": None, "resultPath": None}
        _finish(job, payload, 1)


if __name__ == "__main__":
    main()
