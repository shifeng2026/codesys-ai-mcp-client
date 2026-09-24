const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { CodesysOnlineSession } = require('./online-session.cjs');

const execFileAsync = promisify(execFile);
const ALLOWED_ACTIONS = Object.freeze([
  'doctor', 'probe', 'capabilities', 'create-project', 'stage-project', 'bind-project', 'inspect-project',
  'create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'export-xml', 'import-xml',
  'build', 'rebuild', 'diff', 'rollback',
]);
// `apply-and-build` is the composite used by the workbench's confirmed write: one
// CODESYS process applies the batch, saves, compiles offline, and (by default)
// returns the refreshed object tree. It is MUTATING because it writes, so it keeps
// the same confirmation gate, recovery snapshot and commit-back as apply-changes.
const MUTATING_ACTIONS = new Set(['create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'import-xml']);
const PROJECT_ACTIONS = new Set(['inspect-project', 'create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'export-xml', 'import-xml', 'build', 'rebuild']);

// PLC online actions. These are NOT part of the offline allowlist: they run
// through the persistent online session (online-session.cjs) and each one needs
// an explicit operator authorization bound to the workbench window and the bound
// project. `online-login` only connects the device; the program transfer happens
// in `online-download` alone.
const ONLINE_ACTIONS = Object.freeze([
  'online-login', 'online-logout', 'online-download',
  'online-change', 'online-start', 'online-stop', 'online-reset',
  'online-write', 'online-force', 'online-unforce',
]);
const ONLINE_ACTION_CAPABILITY = Object.freeze({
  'online-login': 'login',
  'online-logout': 'logout',
  'online-download': 'download',
  'online-change': 'online-change',
  'online-start': 'start',
  'online-stop': 'stop',
  'online-reset': 'reset',
  'online-write': 'write-variable',
  'online-force': 'force',
  'online-unforce': 'force',
});
// Action -> worker command. Kept separate from the capability table so a rename on
// one side cannot silently change what the other authorizes.
const ONLINE_ACTION_COMMAND = Object.freeze({
  'online-login': 'login',
  'online-logout': 'logout',
  'online-download': 'download',
  'online-change': 'online-change',
  'online-start': 'start',
  'online-stop': 'stop',
  'online-reset': 'reset',
  'online-write': 'write-variable',
  'online-force': 'force',
  'online-unforce': 'unforce',
});
// CODESYS 暴露的 12 项在线能力，全部保留用于审计与报告。
const PLC_ONLINE_CAPABILITIES = Object.freeze([
  'login', 'logout', 'download', 'online-change', 'write-variable', 'start', 'stop', 'reset', 'debug', 'breakpoint', 'step', 'force',
]);
// 这 3 项本版本的 ScriptEngine **没有任何接口**（set_breakpoint / step_* / debug 在
// 21.5MB 官方 API dump 里全部不存在），不是被禁止，而是够不着。
const UNSUPPORTED_ONLINE_CAPABILITIES = Object.freeze(['debug', 'breakpoint', 'step']);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// CODESYS 把它的控制台输出写在 **Windows ANSI 代码页**（本机是 GBK/CP936），不是 UTF-8。
// 按 UTF-8 解会把每一条中文编译消息变成一片 U+FFFD：工作台编译输出里看到的
// "[Info] ����: Text: C0: ------ ��ʼ����Ӧ�ó��� ..." 就是这么来的（`编译` 的 4 个 GBK
// 字节 → 4 个替换字符）。所以子进程按**原始字节**捕获，再挑替换字符最少的编码来解。
// 注意 Python 侧不需要改：它读写 result.json 已经显式 utf-8 了。
const PROCESS_TEXT_ENCODINGS = ['utf-8', 'gbk'];
function decodeProcessText(value) {
  if (value === undefined || value === null) return '';
  // 自定义 runProcess 可能已经给出字符串（测试会注入），此时原样返回。
  if (typeof value === 'string') return value;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!buffer.length) return '';
  let best = '';
  let bestBad = Infinity;
  for (const encoding of PROCESS_TEXT_ENCODINGS) {
    let text = '';
    try { text = new TextDecoder(encoding).decode(buffer); } catch { continue }
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad < bestBad) { best = text; bestBad = bad; }
    if (bad === 0) break; // ASCII 或真 UTF-8：第一条就干净，不必再试
  }
  return best;
}

function refreshInspectionSnapshot(sourcePath, targetPath) {
  if (fs.existsSync(targetPath)) {
    try { fs.chmodSync(targetPath, 0o600); } catch { /* internal snapshot may already be writable */ }
  }
  fs.copyFileSync(sourcePath, targetPath);
  try { fs.chmodSync(targetPath, 0o600); } catch { /* best effort on non-Windows filesystems */ }
}

// CODESYS enforces an application-level project lock: a second --noUI
// ScriptEngine process cannot call projects.open() on a project currently
// owned by the GUI.  Keep the GUI project as the source of truth, but execute
// the script against a per-run copy and commit the result only after the
// script succeeds.  This also gives us a cheap conflict check before a
// confirmed write so an external GUI save is never silently overwritten.
function copyProject(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  try { fs.chmodSync(targetPath, 0o600); } catch { /* best effort */ }
}

function commitProject(sourcePath, stagedPath, expectedSha256 = '') {
  if (expectedSha256 && sha256(sourcePath) !== expectedSha256) {
    throw Object.assign(new Error('当前 CODESYS 工程在写入期间已被外部保存，已停止提交以避免覆盖最新内容；写前恢复快照仍保留'), { code: 'CODESYS_SCRIPTENGINE_SOURCE_CHANGED_DURING_ACTION' });
  }
  const backupPath = `${sourcePath}.taskhive-write-backup`;
  try { fs.copyFileSync(sourcePath, backupPath); } catch { /* source may not permit sidecar backup */ }
  try {
    fs.copyFileSync(stagedPath, sourcePath);
  } catch (error) {
    try { if (fs.existsSync(backupPath)) fs.copyFileSync(backupPath, sourcePath); } catch { /* preserve original error */ }
    throw Object.assign(new Error(`无法提交 CODESYS 工程文件：${error?.code || error?.message || error}`), { code: 'CODESYS_SCRIPTENGINE_SOURCE_COMMIT_FAILED' });
  } finally {
    try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch { /* best effort cleanup */ }
  }
}

function safeId(value, label = '名称') {
  const text = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(text)) {
    const error = new Error(`${label}必须是 IEC 标识符（字母或下划线开头）`);
    error.code = 'CODESYS_SCRIPTENGINE_IDENTIFIER_INVALID';
    throw error;
  }
  return text;
}

function safeGuid(value, label = '对象 GUID') {
  const text = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw Object.assign(new Error(`${label}无效`), { code: 'CODESYS_SCRIPTENGINE_GUID_INVALID' });
  }
  return text.toLowerCase();
}

function inside(parent, child) {
  const base = path.resolve(parent) + path.sep;
  const target = path.resolve(child);
  return target.startsWith(base);
}

function buildOfflineActionScript(requestPath, resultPath) {
  const requestLiteral = JSON.stringify(path.resolve(requestPath));
  const resultLiteral = JSON.stringify(path.resolve(resultPath));
  return `# -*- coding: utf-8 -*-
import json
import os
import sys
import time
import traceback

request_path = ${requestLiteral}
result_path = ${resultLiteral}

def read_json(path_value):
    handle = open(path_value, 'rb')
    try:
        return json.loads(handle.read().decode('utf-8'))
    finally:
        handle.close()

def write_json(value):
    parent = os.path.dirname(result_path)
    if parent and not os.path.isdir(parent): os.makedirs(parent)
    handle = open(result_path, 'wb')
    try:
        handle.write(json.dumps(value, sort_keys=True, ensure_ascii=False).encode('utf-8'))
    finally:
        handle.close()

def value_or(obj, name, default=None):
    try: return getattr(obj, name)
    except: return default

def object_name(obj):
    try: return obj.get_name()
    except: return str(value_or(obj, 'name', ''))

def object_class(obj):
    try: return str(obj.__class__.__name__)
    except: return ''

def object_children(obj):
    # Direct children only. get_children is documented with a recursive flag;
    # when a CODESYS build rejects the positional form, fall back to the keyword
    # form, and treat any failure as "no children" (the caller still reports such
    # objects as ungrouped roots, so nothing disappears from the payload).
    for call in (lambda: obj.get_children(False), lambda: obj.get_children(recursive=False)):
        try:
            children = call()
            return list(children) if children else []
        except: pass
    return []

def object_row(obj):
    row = {
        'name': object_name(obj),
        'type': str(value_or(obj, 'type', '')),
        'guid': str(value_or(obj, 'guid', '')),
        'isFolder': bool(value_or(obj, 'is_folder', False)),
        'hasDeclaration': bool(value_or(obj, 'has_textual_declaration', False)),
        'hasImplementation': bool(value_or(obj, 'has_textual_implementation', False)),
        'isApplication': bool(value_or(obj, 'is_application', False)),
        'hasLibraryManager': bool(value_or(obj, 'has_library_manager', False))
    }
    try:
        if row['hasDeclaration'] or hasattr(obj, 'textual_declaration'):
            row['declaration'] = obj.textual_declaration.text
    except: pass
    try:
        if row['hasImplementation'] or hasattr(obj, 'textual_implementation'):
            row['implementation'] = obj.textual_implementation.text
    except: pass
    try:
        manager = obj.get_library_manager()
        refs = []
        for ref in manager.references:
            refs.append({'name': str(value_or(ref, 'name', '')), 'namespace': str(value_or(ref, 'namespace', '')), 'id': str(value_or(ref, 'id', ''))})
        row['libraries'] = refs[:500]
    except: pass
    return row

def find_one(project, name, guid='', require_text=False):
    matches = project.find(name, True) or []
    if guid:
        wanted_guid = str(guid).lower()
        matches = [obj for obj in matches if str(value_or(obj, 'guid', '')).lower() == wanted_guid]
    if require_text:
        matches = [obj for obj in matches if bool(value_or(obj, 'has_textual_declaration', False)) or bool(value_or(obj, 'has_textual_implementation', False))]
    if len(matches) == 0: raise Exception('Object not found: ' + name)
    if len(matches) > 1: raise Exception('Object name is ambiguous; provide objectGuid: ' + name)
    return matches[0]

class TaskHiveExportReporter(ExportReporter):
    def __init__(self): self.messages = []
    def error(self, obj, message): self.messages.append({'level':'error','object':object_name(obj),'message':str(message)})
    def warning(self, obj, message): self.messages.append({'level':'warning','object':object_name(obj),'message':str(message)})
    def nonexportable(self, obj): self.messages.append({'level':'skipped','object':object_name(obj),'message':'nonexportable'})
    @property
    def aborting(self): return False

class TaskHiveImportReporter(ImportReporter):
    def __init__(self): self.messages = []
    def error(self, message): self.messages.append({'level':'error','message':str(message)})
    def warning(self, message): self.messages.append({'level':'warning','message':str(message)})
    def added(self, obj): self.messages.append({'level':'added','object':object_name(obj)})
    def replaced(self, obj): self.messages.append({'level':'replaced','object':object_name(obj)})
    def skipped(self, objectname): self.messages.append({'level':'skipped','object':str(objectname)})
    def resolve_conflict(self, obj): return ConflictResolve.Replace
    @property
    def aborting(self): return False

def apply_project_changes(project, changes):
    applied = []
    for change in changes:
        operation = str(change.get('operation', 'update-text'))
        if operation in ['create-pou', 'create-gvl', 'create-dut']:
            parent_name = change.get('parentName', '')
            container = find_one(project, parent_name) if parent_name else value_or(project, 'active_application', None)
            if container is None: raise Exception('No active application/container; provide parentName')
            if operation == 'create-pou':
                pou_types = {'program': PouType.Program, 'function-block': PouType.FunctionBlock, 'function': PouType.Function}
                created = container.create_pou(change['objectName'], pou_types.get(change.get('pouType', 'program'), PouType.Program), ImplementationLanguages.st)
            elif operation == 'create-gvl': created = container.create_gvl(change['objectName'])
            else: created = container.create_dut(change['objectName'], DutType.Structure)
            if change.get('declaration') is not None and hasattr(created, 'textual_declaration'): created.textual_declaration.replace(change.get('declaration', ''))
            if change.get('implementation') is not None and hasattr(created, 'textual_implementation'): created.textual_implementation.replace(change.get('implementation', ''))
            applied.append({'operation': operation, 'object': object_row(created)})
        elif operation == 'update-text':
            target = find_one(project, change['objectName'], change.get('objectGuid', ''), True)
            if change.get('declaration') is not None: target.textual_declaration.replace(change.get('declaration', ''))
            if change.get('implementation') is not None: target.textual_implementation.replace(change.get('implementation', ''))
            applied.append({'operation': operation, 'object': object_row(target)})
        else:
            raise Exception('Unsupported batch operation: ' + operation)
    return applied

def collect_build_messages():
    # SP20 declares get_message_objects(category, severities). The old no-argument
    # call raised TypeError inside a bare except, so the message list was ALWAYS
    # empty and the workbench only ever showed stderr-derived diagnostics. Probe
    # the real signatures at runtime instead of hard-coding one build's shape.
    categories = [None, '', 'Compiler', 'Build']
    severities = []
    try:
        for name in ('All', 'Any', 'Error', 'Warning', 'Information'):
            try: severities.append(getattr(Severity, name))
            except: pass
    except: pass
    severities.append(None)
    for category in categories:
        for severity in severities:
            for call in (lambda c=category, s=severity: system.get_message_objects(c, s),
                         lambda c=category: system.get_message_objects(c)):
                try:
                    value = call()
                except:
                    continue
                if value is None: continue
                try:
                    items = list(value)
                except:
                    continue
                if items: return items
    try:
        return [{'severity': 'Info', 'text': str(message)} for message in (system.get_messages('Compiler') or [])]
    except:
        return []

def run_project_build(project, action):
    application = value_or(project, 'active_application', None)
    if application is None: raise Exception('Project has no active application')
    if action == 'build': application.build()
    else: application.rebuild()
    messages = []
    for item in collect_build_messages():
        if isinstance(item, dict):
            messages.append({'severity': str(item.get('severity', 'Info')), 'text': str(item.get('text', ''))})
            continue
        messages.append({'severity': str(value_or(item, 'severity', '')), 'text': str(value_or(item, 'text', item))})
    return messages

def collect_project_tree(project, result, inspect_started):
    # Phase timings: the caller needs to know whether a slow read is
    # CODESYS starting up, the tree walk, or the payload layout — the
    # Python side is the only place that can tell them apart.
    inspect_started = time.time()
    walked_started = None
    # A flat recursive list cannot say WHERE an object lives, and the
    # ScriptEngine returns it in its own order, so the workbench could
    # only ever show one level. Walk the tree one level at a time and
    # record each object's parent, depth and path — that is what makes a
    # real CODESYS-like tree (device → Plc Logic → application → POU /
    # GVL / DUT / Library Manager) possible.
    #
    # Coverage is preserved unconditionally: every object of the flat
    # list that the walk could not reach is appended as an ungrouped
    # root, so the model context and the write path keep seeing the
    # complete project even on a CODESYS build whose tree API differs.
    active_application = value_or(project, 'active_application', None)
    result['project'] = {'path': str(project.path), 'dirty': bool(project.dirty), 'activeApplication': object_name(active_application) if active_application else ''}
    rows = []
    seen_guids = set()
    seen_names = set()
    def walk(obj, parent_row, depth):
        guid = str(value_or(obj, 'guid', ''))
        if guid and guid in seen_guids: return
        row = object_row(obj)
        row['parentGuid'] = parent_row.get('guid', '') if parent_row else ''
        row['parentName'] = parent_row.get('name', '') if parent_row else ''
        row['depth'] = depth
        row['path'] = (parent_row.get('path', []) if parent_row else []) + [row['name']]
        row['className'] = object_class(obj)
        children = object_children(obj)
        row['hasChildren'] = len(children) > 0
        if guid: seen_guids.add(guid)
        elif row['name']: seen_names.add(row['name'])
        rows.append(row)
        for child in children:
            walk(child, row, depth + 1)
    roots = list(project.get_children(False) or [])
    for root in roots:
        walk(root, None, 0)
    walk_done = time.time()
    ungrouped = 0
    for obj in (project.get_children(True) or []):
        guid = str(value_or(obj, 'guid', ''))
        name = object_name(obj)
        if guid and guid in seen_guids: continue
        if not guid and name and name in seen_names: continue
        row = object_row(obj)
        row['parentGuid'] = ''
        row['parentName'] = ''
        row['depth'] = 0
        row['path'] = [row['name']]
        row['className'] = object_class(obj)
        row['hasChildren'] = False
        row['ungrouped'] = True
        rows.append(row)
        if guid: seen_guids.add(guid)
        ungrouped += 1
    result['objects'] = rows
    result['objectCount'] = len(rows)
    result['hierarchy'] = {'roots': len(roots), 'grouped': len(rows) - ungrouped, 'ungrouped': ungrouped}
    result['timings'] = {'walkMs': int((walk_done - inspect_started) * 1000), 'coverageMs': int((time.time() - walk_done) * 1000), 'objects': len(rows)}
    # The scripting model can report code objects at PROJECT scope even
    # though the IDE shows them inside the application (they compile into
    # it and tasks call them). Measured on a real project: 12 POUs and a
    # project-level GlobalTextList were project children while the
    # application owned the rest, which rendered as 18 top-level rows.
    # Re-parent those orphans to the active application so the workbench
    # tree matches the IDE, and mark the objects CODESYS hides (internal
    # __* names, and a project-level duplicate of an object the
    # application already owns, e.g. a second Library Manager).
    application_row = None
    for row in rows:
        if row.get('isApplication'): application_row = row; break
    if application_row is None and result['project']['activeApplication']:
        for row in rows:
            if row['name'] == result['project']['activeApplication']: application_row = row; break
    application_children = set()
    if application_row is not None:
        for row in rows:
            if row.get('parentGuid') and row['parentGuid'] == application_row.get('guid'):
                application_children.add(row['name'])
    application_scoped_types = set([
        '6f9dac99-8de1-4efc-8465-68ac443b7d08',  # POU
        'ffbfa93a-b94d-45fc-a329-229860183b1d',  # GVL
        '2db5746d-d284-4425-9f7f-2663a34b0ebc',  # DUT
        '63784cbb-9ba0-45e6-9d69-babf3f040511',  # Global text list
        'f7aa3620-8073-4c91-b6ec-86ed9eb60303',  # Trace
        'adb5cb65-8e1d-4a00-b70a-375ea27582f3',  # Library manager
    ])
    reparented = 0
    internal = 0
    for row in rows:
        if row.get('parentGuid'): continue
        if str(row['name']).startswith('__'):
            row['internal'] = True
            internal += 1
            continue
        if application_row is None: continue
        if row['name'] in application_children:
            row['internal'] = True
            row['internalReason'] = 'duplicate-of-' + application_row['name']
            internal += 1
            continue
        if str(row.get('type', '')).lower() in application_scoped_types:
            row['parentGuid'] = application_row.get('guid', '')
            row['parentName'] = application_row['name']
            row['reparented'] = True
            reparented += 1
    # Depth/path are always derived from the FINAL parent links, so a
    # re-parented object reports its real position in the tree.
    rows_by_guid = {}
    for row in rows:
        key = str(row.get('guid', '')).lower()
        if key: rows_by_guid[key] = row
    def row_chain(row, guard=0):
        if guard > 64: return [row['name']]
        parent = rows_by_guid.get(str(row.get('parentGuid', '')).lower())
        if parent is None or parent is row: return [row['name']]
        return row_chain(parent, guard + 1) + [row['name']]
    for row in rows:
        chain = row_chain(row)
        row['path'] = chain
        row['depth'] = len(chain) - 1
    result['hierarchy']['reparented'] = reparented
    result['hierarchy']['internal'] = internal
    result['hierarchy']['roots'] = len([row for row in rows if not row.get('parentGuid') and not row.get('internal') and row['depth'] == 0])
    result['timings']['totalMs'] = int((time.time() - inspect_started) * 1000)
    result['complete'] = True
    result['textTruncated'] = False

request = read_json(request_path)
action = request['action']
project_path = request.get('projectPath', '')
project = None
result = {'ok': True, 'action': action, 'safetyMode': 'isolated-offline-project-only', 'projectPath': project_path, 'reporterGlobals': sorted([str(key) for key in globals().keys() if 'Reporter' in str(key) or 'Conflict' in str(key)])}
try:
    if action == 'create-project':
        project = projects.create(project_path, True)
        project.save()
        result['created'] = True
    else:
        project = projects.open(project_path)
        if action == 'inspect-project':
            collect_project_tree(project, result, time.time())
        elif action in ['create-pou', 'create-gvl', 'create-dut']:
            parent_name = request.get('parentName', '')
            container = find_one(project, parent_name) if parent_name else value_or(project, 'active_application', None)
            if container is None: raise Exception('No active application/container; provide parentName')
            if action == 'create-pou':
                pou_types = {'program': PouType.Program, 'function-block': PouType.FunctionBlock, 'function': PouType.Function}
                created = container.create_pou(request['objectName'], pou_types[request.get('pouType', 'program')], ImplementationLanguages.st)
            elif action == 'create-gvl': created = container.create_gvl(request['objectName'])
            else: created = container.create_dut(request['objectName'], DutType.Structure)
            if request.get('declaration') is not None and hasattr(created, 'textual_declaration'): created.textual_declaration.replace(request.get('declaration', ''))
            if request.get('implementation') is not None and hasattr(created, 'textual_implementation'): created.textual_implementation.replace(request.get('implementation', ''))
            project.save()
            result['createdObject'] = object_row(created)
        elif action == 'update-text':
            target = find_one(project, request['objectName'], request.get('objectGuid', ''), True)
            if request.get('declaration') is not None: target.textual_declaration.replace(request.get('declaration', ''))
            if request.get('implementation') is not None: target.textual_implementation.replace(request.get('implementation', ''))
            project.save()
            result['updatedObject'] = object_row(target)
        elif action == 'apply-changes':
            # Batch all confirmed object edits in one ScriptEngine process and
            # one project.save().  The previous UI loop spawned CODESYS once
            # per object, which made multi-object writes needlessly serial.
            applied = apply_project_changes(project, request.get('changes', []))
            project.save()
            result['applied'] = applied
            result['changeCount'] = len(applied)
        elif action == 'apply-and-build':
            # ONE CODESYS process for the whole confirmed write: apply the batch,
            # save once (exactly as apply-changes does), compile offline, then hand
            # back the refreshed object tree so the workbench needs no third launch.
            #
            # Why: measured on a real 62-object project, one confirmed write was
            #   apply-changes 34-36 s + build 45-47 s + inspect-project 32-34 s
            #   = ~115 s, and scriptEngineProcess was 99.9 % of EACH call
            #   (34,387 / 34,411 ms): the cost was three CODESYS startups, not the
            #   edits themselves. The three steps share one process here.
            applied = apply_project_changes(project, request.get('changes', []))
            project.save()
            result['applied'] = applied
            result['changeCount'] = len(applied)
            messages = run_project_build(project, 'build')
            result['messages'] = messages[-1000:]
            result['errorCount'] = len([item for item in messages if 'error' in item.get('severity', '').lower()])
            if request.get('includeTree') is not False:
                collect_project_tree(project, result, time.time())
        elif action == 'export-xml':
            target_name = request.get('objectName', '')
            target = find_one(project, target_name) if target_name else project
            reporter = TaskHiveExportReporter()
            target.export_xml(reporter, request['xmlPath'], True)
            result['xmlPath'] = request['xmlPath']
            result['messages'] = reporter.messages
        elif action == 'import-xml':
            reporter = TaskHiveImportReporter()
            project.import_xml(reporter, request['xmlPath'])
            project.save()
            result['xmlPath'] = request['xmlPath']
            result['messages'] = reporter.messages
        elif action == 'build' or action == 'rebuild':
            messages = run_project_build(project, action)
            result['messages'] = messages[-1000:]
            result['errorCount'] = len([item for item in messages if 'error' in item.get('severity', '').lower()])
finally:
    if project is not None:
        try: project.close()
        except: pass
write_json(result)
`;
}

function boundedFind(directory, fileName, depth = 0) {
  if (!directory || depth > 4 || !fs.existsSync(directory)) return null;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return path.join(directory, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = boundedFind(path.join(directory, entry.name), fileName, depth + 1);
    if (found) return found;
  }
  return null;
}

function candidateInstallations() {
  const candidates = [];
  if (process.env.TASKHIVE_CODESYS_EXE) candidates.push(process.env.TASKHIVE_CODESYS_EXE);
  const bases = [...new Set([
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean))];
  for (const base of bases) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^CODESYS\s+3\.5\./i.test(entry.name)) continue;
      candidates.push(path.join(base, entry.name, 'CODESYS', 'Common', 'CODESYS.exe'));
    }
  }
  return [...new Set(candidates)].filter((file) => fs.existsSync(file)).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
}

function versionFromExe(exePath) {
  const match = String(exePath || '').match(/CODESYS\s+(\d+\.\d+\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

function profileFromVersion(version) {
  const parts = String(version || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return `CODESYS V${parts[0]}.${parts[1]} SP${parts[2]} Patch ${Math.floor(parts[3] / 10)}`;
}

function buildProbeScript(outputPath) {
  const target = JSON.stringify(path.resolve(outputPath));
  return `# -*- coding: utf-8 -*-\nimport json\nimport os\nimport sys\nimport traceback\n\noutput_path = ${target}\nresult = {\n    "ok": True,\n    "engine": "CODESYS ScriptEngine",\n    "pythonVersion": sys.version,\n    "platform": sys.platform,\n    "hasProjectsApi": "projects" in globals(),\n    "hasSystemApi": "system" in globals(),\n    "hasOnlineApi": "online" in globals(),\n    "safetyMode": "offline-probe-only"\n}\ntry:\n    parent = os.path.dirname(output_path)\n    if parent and not os.path.isdir(parent):\n        os.makedirs(parent)\n    handle = open(output_path, "wb")\n    handle.write(json.dumps(result, sort_keys=True))\n    handle.close()\nexcept Exception:\n    result = {"ok": False, "engine": "CODESYS ScriptEngine", "error": traceback.format_exc(), "safetyMode": "offline-probe-only"}\n    try:\n        handle = open(output_path, "wb")\n        handle.write(json.dumps(result, sort_keys=True))\n        handle.close()\n    except Exception:\n        pass\n`;
}

class CodesysScriptEngine {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.exePath = options.exePath || null;
    this.profile = options.profile || process.env.TASKHIVE_CODESYS_PROFILE || null;
    this.runProcess = options.runProcess || execFileAsync;
    // The online session spawns a long-lived process with file-backed stdio, so
    // it needs a spawner rather than the awaited execFile helper.
    this.spawnProcess = options.spawnProcess || null;
    this.onlineLog = typeof options.onlineLog === 'function' ? options.onlineLog : ((message) => console.log(`[codesys-online] ${message}`));
    // One online session at a time: it owns a PLC connection, and two of them
    // would fight over the same controller.
    this.onlineSession = null;
    this.onlineSessionJobId = '';
    // 正在启动中的会话（promise）。启动要 20–40 秒，这段时间里 this.onlineSession
    // 还是 null，后来者必须等这个 promise 而不是再起一个（见 ensureOnlineSession）。
    this.onlineSessionPending = null;
    this.onlineSessionPendingJobId = '';
    // 每次"要求停止"都 +1，用来丢弃那些在停止请求之后才启动完成的会话。
    this.onlineSessionGeneration = 0;
    this.jobsRoot = path.join(this.root, 'workspaces', 'codesys-scriptengine', 'jobs');
    this.logsRoot = path.join(this.root, 'logs');
    // Installation discovery walks the CODESYS plug-in tree. Cache it briefly
    // so opening a workbench and refreshing its project do not repeat that
    // expensive scan on every action.
    this.doctorCache = null;
    this.inspectCache = new Map();
    // Persistent inspect cache. Launching the CODESYS ScriptEngine dominates the
    // cost of reading a project (measured: scriptEngineProcess = 31,852 ms for a
    // 66-object project), and the result is a pure function of the saved
    // .project bytes — so it survives restarts, keyed by that file's sha256.
    this.inspectCacheRoot = path.join(this.root, 'cache', 'codesys-inspect');
  }

  inspectCacheFile(sourceSha256) {
    return path.join(this.inspectCacheRoot, `${String(sourceSha256 || '').slice(0, 64)}.json`);
  }

  readInspectDiskCache(sourceSha256) {
    if (!sourceSha256) return null;
    const file = this.inspectCacheFile(sourceSha256);
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!payload || payload.complete !== true || !Array.isArray(payload.objects)) return null;
      const now = new Date();
      try { fs.utimesSync(file, now, now); } catch { /* LRU touch is best effort */ }
      return payload;
    } catch { return null; }
  }

  writeInspectDiskCache(sourceSha256, payload) {
    if (!sourceSha256 || !payload || payload.complete !== true || !Array.isArray(payload.objects)) return false;
    try {
      fs.mkdirSync(this.inspectCacheRoot, { recursive: true });
      const file = this.inspectCacheFile(sourceSha256);
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(payload), 'utf8');
      fs.renameSync(temp, file);
      // Keep the cache bounded: newest 8 projects by mtime.
      const entries = fs.readdirSync(this.inspectCacheRoot)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .map((name) => {
          const full = path.join(this.inspectCacheRoot, name);
          let at = 0;
          try { at = fs.statSync(full).mtimeMs } catch { at = 0 }
          return { full, at };
        })
        .sort((left, right) => right.at - left.at);
      for (const stale of entries.slice(8)) { try { fs.unlinkSync(stale.full) } catch { /* best effort */ } }
      return true;
    } catch { return false }
  }

  policy() {
    return {
      mode: 'offline-allowlist',
      allowedActions: [...ALLOWED_ACTIONS],
      onlineActions: [...ONLINE_ACTIONS],
      onlineActionCapabilities: { ...ONLINE_ACTION_CAPABILITY },
      plcOnlineCapabilities: [...PLC_ONLINE_CAPABILITIES],
      unsupportedOnlineCapabilities: [...UNSUPPORTED_ONLINE_CAPABILITIES],
      // 这 9 项都只能通过工作台、在显式授权下到达；3 项无 API。
      onlineAuthorizationRequired: true,
      onlineHardGateRequired: ['write-variable', 'reset', 'force'],
      onlineSessionModel: 'persistent-worker-process',
      plcLogin: 'authorized-only',
      plcLogout: 'authorized-only',
      plcDownload: 'authorized-only',
      plcOnlineChange: 'authorized-only',
      plcStartStopReset: 'authorized-only',
      variableWrite: 'authorized-with-confirmation-phrase',
      force: 'authorized-with-confirmation-phrase',
      debugBreakpointStep: 'unsupported-by-this-scriptengine-version',
      arbitraryScript: false,
      sourceProjectWrite: 'confirmed-with-recovery-snapshot',
      isolatedProjectCopyRequired: false,
      recoverySnapshotRequired: true,
    };
  }

  doctor({ persist = false } = {}) {
    if (this.doctorCache && Date.now() - this.doctorCache.at < 30000) {
      const cached = { ...this.doctorCache.value, cached: true };
      if (persist) this.persistEvidence('codesys-scriptengine-doctor.json', cached);
      return cached;
    }
    const exePath = this.exePath && fs.existsSync(this.exePath) ? this.exePath : candidateInstallations()[0] || null;
    const version = versionFromExe(exePath);
    const codesysRoot = exePath ? path.resolve(path.dirname(exePath), '..') : null;
    const commonRoot = exePath ? path.dirname(exePath) : null;
    const pluginsRoot = codesysRoot ? path.join(codesysRoot, 'PlugIns') : null;
    const lacRoot = codesysRoot ? path.join(codesysRoot, 'LacBinaries', 'GAC_MSIL') : null;
    const scriptEngineDll = commonRoot && fs.existsSync(path.join(commonRoot, 'ScriptEngine.dll')) ? path.join(commonRoot, 'ScriptEngine.dll') : null;
    const scriptEnginePlugin = boundedFind(pluginsRoot, 'ScriptEngine.plugin.dll');
    const ironPythonDll = boundedFind(lacRoot && path.join(lacRoot, 'IronPython'), 'IronPython.dll');
    const profile = this.profile || profileFromVersion(version);
    const missing = [];
    if (!exePath) missing.push({ id: 'codesys-exe', label: 'CODESYS.exe' });
    if (!scriptEngineDll) missing.push({ id: 'scriptengine-core', label: 'ScriptEngine.dll' });
    if (!scriptEnginePlugin) missing.push({ id: 'scriptengine-plugin', label: 'ScriptEngine.plugin.dll' });
    if (!ironPythonDll) missing.push({ id: 'ironpython', label: 'IronPython.dll' });
    if (!profile) missing.push({ id: 'profile', label: '兼容的 CODESYS profile' });
    const result = {
      installed: Boolean(exePath && scriptEngineDll && scriptEnginePlugin && ironPythonDll && profile),
      ready: Boolean(exePath && scriptEngineDll && scriptEnginePlugin && ironPythonDll && profile),
      state: exePath ? (scriptEngineDll && scriptEnginePlugin && ironPythonDll ? 'ready' : 'incomplete') : 'not-installed',
      exePath: exePath || '',
      version: version || '',
      profile: profile || '',
      scriptEngineDll: scriptEngineDll || '',
      scriptEnginePlugin: scriptEnginePlugin || '',
      ironPythonDll: ironPythonDll || '',
      missing,
      configuration: {
        automaticInstallAvailable: false,
        mode: missing.length ? 'official-installer-or-component-manager' : 'ready',
        reason: missing.length ? 'TaskHive 不静默下载或替换 CODESYS；仅打开经过签名验证的本机官方安装器，或引导到官方组件管理器。' : '',
      },
      policy: this.policy(),
      checkedAt: new Date().toISOString(),
    };
    this.doctorCache = { at: Date.now(), value: result };
    if (persist) this.persistEvidence('codesys-scriptengine-doctor.json', result);
    return result;
  }

  async execute(action, input = {}, exec = {}) {
    const normalized = String(action || '').trim().toLowerCase();
    // Online actions are not part of the offline allowlist: they never touch the
    // project file and are governed by their own authorization contract.
    if (ONLINE_ACTIONS.includes(normalized)) return this.runOnlineAction(normalized, input, exec);
    if (!ALLOWED_ACTIONS.includes(normalized)) {
      const error = new Error(`CODESYS ScriptEngine 动作不在离线白名单：${normalized || '(empty)'}`);
      error.code = 'CODESYS_SCRIPTENGINE_ACTION_DENIED';
      throw error;
    }
    if (normalized === 'doctor') return this.doctor({ persist: input.persist !== false });
    if (normalized === 'probe') return this.probe({ timeoutMs: input.timeoutMs, signal: exec.signal });
    if (normalized === 'capabilities') return this.capabilities({ persist: input.persist !== false });
    if (normalized === 'stage-project') return this.stageProject(input);
    if (normalized === 'bind-project') return this.bindProject(input);
    if (normalized === 'diff') return this.diff(input);
    if (normalized === 'rollback') return this.rollback(input);
    return this.runOfflineAction(normalized, input, exec);
  }

  onlineState() {
    const session = this.onlineSession;
    return {
      running: Boolean(session && session.running),
      jobId: this.onlineSessionJobId,
      ready: session ? session.ready : null,
      lastError: session ? session.lastError : '',
      pid: session ? (session.child?.pid || 0) : 0,
    };
  }

  async stopOnlineSession(reason = 'manual') {
    // 即使此刻没有会话，也要推进代数：一个正在启动中的会话必须看到"有人要求停止过"。
    this.onlineSessionGeneration += 1;
    if (!this.onlineSession) {
      const pending = this.onlineSessionPending;
      this.onlineSessionPending = null;
      this.onlineSessionPendingJobId = '';
      return { stopped: false, reason, pending: Boolean(pending) };
    }
    const session = this.onlineSession;
    this.onlineSession = null;
    this.onlineSessionJobId = '';
    try {
      return await session.stop(reason);
    } catch (error) {
      return { stopped: false, reason, error: String(error?.message || error) };
    }
  }

  // Read-only online status. It asks the worker for its connection state, which
  // is safe to call without an authorization: nothing on the controller changes.
  async onlineStatus() {
    if (!this.onlineSession || !this.onlineSession.running) {
      return { ok: true, running: false, ...this.onlineState() };
    }
    try {
      const value = await this.onlineSession.send('status', {}, 20000);
      return { ok: true, running: true, ...this.onlineState(), state: value };
    } catch (error) {
      return { ok: false, running: false, ...this.onlineState(), error: String(error?.message || error) };
    }
  }

  // CODESYS' own "scan network". It asks the gateway to discover controllers on
  // the network; no controller is contacted and nothing is changed. A live scan
  // can take a while, the cached variant returns instantly.
  async onlineScanDevices(input = {}) {
    if (!this.onlineSession || !this.onlineSession.running) {
      return { ok: false, running: false, reason: 'session-not-running' };
    }
    const value = await this.onlineSession.send('scan', { useCache: input.useCache === true }, input.useCache === true ? 30000 : 180000);
    return { ok: true, running: true, ...value };
  }

  // Retarget THIS session. The worker holds a throwaway copy of the project and
  // never saves it, so this changes where a login goes WITHOUT editing the
  // operator's .project file.
  async onlineSetTarget(input = {}) {
    // 绑定过的目标要跟着**作业**走，而不是只活在这一次的在线进程里：否则进程空闲
    // 10 分钟退出后，"已绑定"就凭空消失，用户会以为绑定没生效。写的是作业元数据
    // （job.json），**不是** .project —— 工程文件仍然一个字节都不动（worker 侧照旧
    // 报 saved:false）。
    const override = {
      gatewayName: String(input.gatewayName || '').trim(),
      gatewayGuid: String(input.gatewayGuid || '').trim(),
      address: String(input.address || '').trim(),
      ipAddress: String(input.ipAddress || '').trim(),
      port: Number(input.port) || 0,
      source: String(input.source || 'scan').trim() || 'scan',
      boundAt: new Date().toISOString(),
    };
    const jobId = String(input.jobId || '').trim();
    let persisted = false;
    if (jobId) {
      try {
        const { job } = this.readJob(jobId);
        job.onlineTargetOverride = override;
        this.writeJob(path.join(this.jobPath(job.jobId), 'job.json'), job);
        persisted = true;
      } catch {
        // 作业元数据写不进去时仍然尝试应用到当前会话：绑定本身不该因此失败。
      }
    }
    if (!this.onlineSession || !this.onlineSession.running) {
      // 会话没在跑：绑定先记下来，等它起来时自动应用（见 openOnlineSession）。
      return { ok: true, running: false, appliedNow: false, deferred: true, persisted, boundTarget: override };
    }
    const value = await this.onlineSession.send('set-target', {
      gatewayName: override.gatewayName,
      gatewayGuid: override.gatewayGuid,
      address: override.address,
      // ip 模式：走 set_gateway_and_ip_address（没有 getter，设完读不回来）
      ipAddress: override.ipAddress,
      port: override.port,
    }, 60000);
    if (this.onlineSession.ready) {
      this.onlineSession.ready.targetSource = override.source;
      this.onlineSession.ready.boundTarget = override;
    }
    // 注意展开顺序：worker 自己也会回一个 `applied`（是 'name'/'address'/'ip' 这种
    // 字符串，审计要用），所以"这次真的应用了"另起一个字段，别把它盖掉。
    return { ...value, ok: true, running: true, appliedNow: true, deferred: false, persisted, boundTarget: override };
  }

  // Start the online worker WITHOUT connecting to anything. This is what lets the
  // operator see the configured target (gateway / address / device identification)
  // before any login: the worker only opens a copy of the project and reads it.
  async prepareOnlineSession(jobId, timeoutMs) {
    const { job } = this.readJob(jobId);
    const ensured = await this.ensureOnlineSession(job, timeoutMs);
    return { ok: true, reused: ensured.reused === true, running: true, ready: ensured.ready };
  }

  // 唯一的"确保在线会话存在"入口。存在的理由是现场报错：
  //   EBUSY: resource busy or locked, open '...\online\online-worker.py'
  // 一次启动要 20–40 秒，而"绑定工程后读目标"的后台准备、扫描按钮、登录按钮都会
  // 走到这里。此前 this.onlineSession 是在 start() **完成之后**才赋值的，于是这段
  // 窗口里第二次调用会认为"没有会话"，再起一个 CODESYS 去写同一个目录 —— 第二个
  // 写 online-worker.py 时，第一个 CODESYS 已经把它打开，Windows 直接 EBUSY。
  // 现在：同一个 job 的启动在途时，后来者等同一个 promise，绝不重复启动。
  async ensureOnlineSession(job, timeoutMs) {
    if (this.onlineSession && this.onlineSession.running && this.onlineSessionJobId === job.jobId) {
      return { session: this.onlineSession, ready: this.onlineSession.ready, reused: true };
    }
    if (this.onlineSessionPending && this.onlineSessionPendingJobId === job.jobId) {
      const opened = await this.onlineSessionPending;
      return { ...opened, reused: true };
    }
    // 先占坑、再 await：stopOnlineSession 也是异步的，若先 await 再占坑，三个并发
    // 调用会一起穿过上面的检查、各自启动一个 worker —— 那正是 EBUSY 的成因。
    const pending = (async () => {
      await this.stopOnlineSession('rebind');
      return this.openOnlineSession(job, timeoutMs);
    })();
    this.onlineSessionPending = pending;
    this.onlineSessionPendingJobId = job.jobId;
    const clear = () => {
      if (this.onlineSessionPending === pending) {
        this.onlineSessionPending = null;
        this.onlineSessionPendingJobId = '';
      }
    };
    pending.then(clear, clear);
    return pending;
  }

  // Read online values from the session that a login (Keep) or a download established.
  // Reading is not a mutating action, so it is not gated behind a new capability;
  // the worker itself refuses unless the application is actually logged in.
  // `scope` is the selected object's name: a PROGRAM's locals are only reachable as
  // "POU.var" in the application scope, while a GVL's globals work bare. The worker
  // tries both and remembers which one worked.
  async onlineMonitor(expressions, scope = '') {
    if (!this.onlineSession || !this.onlineSession.running) {
      return { ok: false, running: false, reason: 'session-not-running', ...this.onlineState() };
    }
    const list = Array.isArray(expressions)
      ? [...new Set(expressions.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 120)
      : [];
    if (!list.length) return { ok: true, running: true, isLoggedIn: false, expressions: [], values: [] };
    try {
      const value = await this.onlineSession.send('monitor', { expressions: list, scope: String(scope || '') }, 20000);
      return { ok: true, running: true, ...value };
    } catch (error) {
      return {
        ok: false,
        running: this.onlineSession.running,
        code: error?.code || '',
        error: String(error?.message || error),
      };
    }
  }

  async openOnlineSession(job, timeoutMs) {
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) {
      throw Object.assign(new Error('CODESYS ScriptEngine 未就绪'), { code: 'CODESYS_SCRIPTENGINE_NOT_READY', details: doctor });
    }
    const jobDir = this.jobPath(job.jobId);
    // The online worker keeps its project open for the whole session, so it must
    // NOT share the inspect snapshot path: a later 刷新 (inspect-project) would
    // overwrite the file CODESYS currently holds open, which fails on Windows and
    // would break the live session.
    // 运行令牌同时进文件名：CODESYS 会一直持有它打开的 .project 与脚本，固定名字会让
    // "上一个进程还没退干净、下一个就启动"在 Windows 上直接 EBUSY（现场报错就是这个）。
    const runToken = crypto.randomBytes(6).toString('hex');
    const snapshotsDir = path.join(jobDir, 'snapshots');
    const workProject = path.join(snapshotsDir, `online-session-${runToken}.project`);
    // 上一轮留下的工程副本已经没有主人了（每个名字都带令牌），清掉免得越积越多；
    // 还被旧进程占用的删不掉，忽略即可。
    try {
      for (const name of fs.readdirSync(snapshotsDir)) {
        if (!/^online-session(-[0-9a-f]+)?\.project$/.test(name)) continue;
        try { fs.unlinkSync(path.join(snapshotsDir, name)); } catch { /* still held by an exiting worker */ }
      }
    } catch { /* no snapshot dir yet */ }
    refreshInspectionSnapshot(job.projectPath, workProject);
    job.onlineProjectPath = workProject;
    this.writeJob(path.join(jobDir, 'job.json'), job);
    const workDir = path.join(jobDir, 'online');
    const session = new CodesysOnlineSession({
      exePath: doctor.exePath,
      profile: doctor.profile,
      ...(this.spawnProcess ? { spawnProcess: this.spawnProcess } : {}),
      log: this.onlineLog,
    });
    const generation = this.onlineSessionGeneration;
    const ready = await session.start({ workDir, projectPath: workProject, timeoutMs, runToken });
    // 启动期间有人要求停止（例如操作者点了「释放在线会话」）：不要把这个刚起来的
    // 会话挂上去 —— 否则它会带着一个 PLC 连接继续活着，谁也找不到它。
    if (generation !== this.onlineSessionGeneration) {
      try { await session.stop('superseded-start'); } catch { /* best effort */ }
      throw Object.assign(new Error('在线会话在启动期间被要求停止，已放弃这次启动。'), { code: 'CODESYS_ONLINE_START_SUPERSEDED' });
    }
    this.onlineSession = session;
    this.onlineSessionJobId = job.jobId;
    // 把"上次绑定过的目标"重新应用到新进程：只改这份工程副本的内存值，绝不写
    // .project。这样一来，在线进程空闲退出、或换了一个新进程之后，界面上的
    // 「已绑定」仍然是真的，而不是只活了一次会话。
    const bound = job.onlineTargetOverride;
    if (bound && (bound.address || bound.ipAddress)) {
      try {
        const applied = await session.send('set-target', {
          gatewayName: String(bound.gatewayName || ''),
          gatewayGuid: String(bound.gatewayGuid || ''),
          address: String(bound.address || ''),
          ipAddress: String(bound.ipAddress || ''),
          port: Number(bound.port) || 0,
        }, 60000);
        ready.boundTarget = { ...bound, appliedAt: new Date().toISOString() };
        ready.targetSource = String(bound.source || 'scan');
        ready.target = applied?.target || ready.target;
      } catch (error) {
        // 应用失败要如实报出来（例如设备/网关已不在），否则界面会显示"已绑定"
        // 而登录其实会去别的地方。
        ready.boundTargetError = String(error?.message || error);
      }
    }
    return { session, ready, workProject, workDir };
  }

  async runOnlineAction(action, input = {}, exec = {}) {
    const capability = ONLINE_ACTION_CAPABILITY[action];
    // Defense in depth: main.js performs the real authorization checks, but the
    // engine still refuses to move unless the caller declares the authorization
    // it was granted, so a stray IPC call cannot drive a controller.
    if (input.onlineAuthorization !== true) {
      throw Object.assign(new Error('在线动作缺少授权标记：请先在工作台开启在线授权'), { code: 'CODESYS_ONLINE_NOT_ARMED' });
    }
    const actionStartedAt = Date.now();
    const timings = {};
    const { job } = this.readJob(input.jobId);
    timings.jobRead = Date.now() - actionStartedAt;

    // 绑定是登录 / 下载 / 在线修改的前置条件：没有绑定过设备时，绝不去连"工程文件里
    // 碰巧配着的那台"（用户口径：「我都没有绑定设备 为什么可以登录？明显不合理」）。
    // 界面已经把这几个按钮禁用了，这里是第二道锁：绕过界面直接发 IPC 也一样拒绝。
    const REQUIRES_BOUND_TARGET = ['online-login', 'online-download', 'online-change'];
    if (REQUIRES_BOUND_TARGET.includes(action) && !job.onlineTargetOverride) {
      throw Object.assign(
        new Error('尚未绑定设备：请先在工作台点「扫描设备」选中一台 PLC（或手动填写目标并应用），再登录/下载。工程文件里配置的目标不作为登录依据。'),
        { code: 'CODESYS_ONLINE_TARGET_NOT_BOUND', details: { action } },
      );
    }

    if (action === 'online-download') {
      // Authoritative "the file is still what we last knew" check. The job stores
      // the sha it last observed; a CODESYS save that happened after that point
      // would otherwise let older content (already read into the workbench) be
      // downloaded over newer code.
      const currentSha = sha256(job.projectPath);
      if (job.currentSha256 && currentSha !== job.currentSha256) {
        throw Object.assign(
          new Error('工程文件在本次读取之后被改动过（可能刚在 CODESYS 中保存）。已拒绝下载，请先在 CODESYS 中确认，再点工作台「刷新」重新读取工程。'),
          { code: 'CODESYS_ONLINE_PROJECT_CHANGED', details: { expectedSha256: job.currentSha256, actualSha256: currentSha } },
        );
      }
    }

    let session = this.onlineSession;
    const reused = Boolean(session && session.running && this.onlineSessionJobId === job.jobId);
    if (!reused) {
      const phaseStartedAt = Date.now();
      const opened = await this.ensureOnlineSession(job, input.timeoutMs);
      session = opened.session;
      timings.sessionStart = Date.now() - phaseStartedAt;
    } else {
      timings.sessionStart = 0;
    }

    const command = ONLINE_ACTION_COMMAND[action] || 'status';
    const commandArgs = { capability };
    if (action === 'online-write' || action === 'online-force') {
      commandArgs.assignments = Array.isArray(input.assignments) ? input.assignments.slice(0, 60) : [];
    }
    if (action === 'online-reset') {
      commandArgs.resetOption = String(input.resetOption || 'warm');
      commandArgs.forceKill = input.forceKill === true;
    }
    const defaultTimeout = (command === 'download' || command === 'online-change') ? 300000 : 120000;
    const commandStartedAt = Date.now();
    const value = await session.send(command, commandArgs, Number(input.timeoutMs) || defaultTimeout);
    timings.onlineCommand = Date.now() - commandStartedAt;

    if (command === 'logout') {
      // An explicit logout ends the session: the persistent process exists only
      // to hold the connection, and leaving it alive would keep a half-open
      // worker attached to the controller with nothing to do.
      await this.stopOnlineSession('logout');
    }

    const evidence = {
      ok: true,
      status: 'verified-online',
      action,
      capability,
      command,
      jobId: job.jobId,
      mode: job.mode || 'isolated-copy',
      sourcePath: job.sourcePath || '',
      projectPath: job.projectPath,
      sessionProjectPath: job.onlineProjectPath || '',
      durationMs: Date.now() - actionStartedAt,
      payload: value,
      target: session.ready || null,
      sessionReused: reused,
      policy: this.policy(),
      timings: { ...timings, total: Date.now() - actionStartedAt },
      completedAt: new Date().toISOString(),
    };
    this.persistEvidence('codesys-scriptengine-online.json', evidence);
    return evidence;
  }

  capabilities({ persist = true } = {}) {
    const doctor = this.doctor({ persist: false });
    const result = {
      ok: doctor.ready,
      source: 'local-official-scriptengine-help',
      codesysVersion: doctor.version,
      scriptEngine: doctor.scriptEngineDll,
      open: {
        projectLifecycle: ['create-project', 'stage-project', 'bind-project', 'inspect-project', 'diff', 'rollback'],
        iecObjects: ['create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes'],
        interchange: ['export-xml', 'import-xml'],
        compilation: ['build', 'rebuild'],
        inspection: ['project-tree', 'textual-declaration', 'textual-implementation', 'library-references', 'device-objects'],
      },
      restrictions: { sourceWriteMode: 'confirmed-with-recovery-snapshot', arbitraryScript: false, onlineActions: [...ONLINE_ACTIONS], onlineAuthorizationRequired: true, onlineHardGateRequired: ['write-variable', 'reset', 'force'], unsupportedOnlineCapabilities: [...UNSUPPORTED_ONLINE_CAPABILITIES] },
      verifiedApis: ['projects.create', 'projects.open', 'get_children', 'find', 'create_pou', 'create_gvl', 'create_dut', 'textual_declaration.replace', 'textual_implementation.replace', 'export_xml', 'import_xml', 'build', 'rebuild'],
      checkedAt: new Date().toISOString(),
    };
    if (persist) this.persistEvidence('codesys-scriptengine-capabilities.json', result);
    return result;
  }

  newJobId(prefix = 'offline') { return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }

  jobPath(jobId) {
    const value = String(jobId || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{5,100}$/i.test(value)) throw Object.assign(new Error('ScriptEngine 作业 ID 无效'), { code: 'CODESYS_SCRIPTENGINE_JOB_INVALID' });
    const target = path.join(this.jobsRoot, value);
    if (!inside(this.jobsRoot, target)) throw Object.assign(new Error('ScriptEngine 作业越界'), { code: 'CODESYS_SCRIPTENGINE_JOB_OUTSIDE_ROOT' });
    return target;
  }

  readJob(jobId) {
    const jobDir = this.jobPath(jobId);
    const metadataPath = path.join(jobDir, 'job.json');
    if (!fs.existsSync(metadataPath)) throw Object.assign(new Error('ScriptEngine 隔离作业不存在'), { code: 'CODESYS_SCRIPTENGINE_JOB_NOT_FOUND' });
    const job = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const directSource = ['direct-source', 'active-gui-saved-source'].includes(job.mode) && path.resolve(job.projectPath) === path.resolve(job.sourcePath || '');
    if ((!directSource && !inside(jobDir, job.projectPath)) || !fs.existsSync(job.projectPath)) throw Object.assign(new Error('绑定的工程文件不存在'), { code: 'CODESYS_SCRIPTENGINE_PROJECT_MISSING' });
    return { jobDir, metadataPath, job };
  }

  writeJob(metadataPath, job) { fs.writeFileSync(metadataPath, `${JSON.stringify(job, null, 2)}\n`, 'utf8'); }

  stageProject(input = {}) {
    const sourcePath = path.resolve(String(input.sourcePath || ''));
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || path.extname(sourcePath).toLowerCase() !== '.project') {
      throw Object.assign(new Error('请选择现有的 .project 工程文件'), { code: 'CODESYS_SCRIPTENGINE_SOURCE_PROJECT_INVALID' });
    }
    const jobId = this.newJobId('stage');
    const jobDir = this.jobPath(jobId);
    const projectDir = path.join(jobDir, 'project');
    const snapshotsDir = path.join(jobDir, 'snapshots');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const projectPath = path.join(projectDir, path.basename(sourcePath));
    const baselinePath = path.join(snapshotsDir, '000-baseline.project');
    fs.copyFileSync(sourcePath, projectPath);
    fs.copyFileSync(sourcePath, baselinePath);
    const hash = sha256(projectPath);
    const job = { jobId, state: 'staged', sourcePath, sourceProjectModified: false, projectPath, baselinePath, baselineSha256: hash, currentSha256: hash, snapshots: [{ id: '000-baseline', path: baselinePath, sha256: hash, reason: 'immutable-source-copy' }], actions: [], createdAt: new Date().toISOString(), policy: this.policy() };
    const metadataPath = path.join(jobDir, 'job.json');
    this.writeJob(metadataPath, job);
    const result = { ok: true, action: 'stage-project', jobId, state: job.state, sourcePath, projectPath, sourceProjectModified: false, baselineSha256: hash, policy: this.policy() };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', result);
    return result;
  }

  bindProject(input = {}) {
    const sourcePath = path.resolve(String(input.sourcePath || ''));
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || path.extname(sourcePath).toLowerCase() !== '.project') {
      throw Object.assign(new Error('请选择现有的 .project 工程文件'), { code: 'CODESYS_SCRIPTENGINE_SOURCE_PROJECT_INVALID' });
    }
    const jobId = this.newJobId('direct');
    const jobDir = this.jobPath(jobId);
    const snapshotsDir = path.join(jobDir, 'snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const baselinePath = path.join(snapshotsDir, '000-baseline.project');
    const inspectionProjectPath = path.join(snapshotsDir, 'current-saved-read.project');
    fs.copyFileSync(sourcePath, baselinePath);
    refreshInspectionSnapshot(sourcePath, inspectionProjectPath);
    const hash = sha256(sourcePath);
    const activeProject = input.activeProject && typeof input.activeProject === 'object' ? {
      activeGui: input.activeProject.activeGui === true,
      windowId: String(input.activeProject.windowId || ''),
      pid: Number(input.activeProject.pid || 0),
      title: String(input.activeProject.title || ''),
      readOnly: input.activeProject.readOnly === true,
      detection: String(input.activeProject.detection || ''),
      writeAvailable: input.activeProject.writeAvailable === true,
      writeBlockReason: String(input.activeProject.writeBlockReason || ''),
    } : null;
    const job = { jobId, mode: activeProject?.activeGui ? 'active-gui-saved-source' : 'direct-source', state: 'bound', sourcePath, sourceProjectModified: false, projectPath: sourcePath, inspectionProjectPath, activeProject, baselinePath, baselineSha256: hash, currentSha256: hash, snapshots: [{ id: '000-baseline', path: baselinePath, sha256: hash, reason: 'automatic-recovery-baseline', createdAt: new Date().toISOString() }], actions: [], createdAt: new Date().toISOString(), policy: this.policy() };
    const metadataPath = path.join(jobDir, 'job.json');
    this.writeJob(metadataPath, job);
    const result = { ok: true, action: 'bind-project', jobId, mode: job.mode, state: job.state, sourcePath, projectPath: sourcePath, inspectionProjectPath, activeProject, writeAvailable: activeProject ? activeProject.writeAvailable : true, writeBlockReason: activeProject?.writeBlockReason || '', recoverySnapshotPath: baselinePath, sourceProjectModified: false, baselineSha256: hash, policy: this.policy() };
    this.persistEvidence('codesys-scriptengine-direct-workbench.json', result);
    return result;
  }

  async createProject(input = {}, exec = {}) {
    const jobId = this.newJobId('create');
    const jobDir = this.jobPath(jobId);
    const projectDir = path.join(jobDir, 'project');
    const snapshotsDir = path.join(jobDir, 'snapshots');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const rawName = String(input.name || 'TaskHiveOffline').trim().replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'TaskHiveOffline';
    const projectPath = path.join(projectDir, `${rawName}.project`);
    const job = { jobId, state: 'creating', sourcePath: '', sourceProjectModified: false, projectPath, baselinePath: '', baselineSha256: '', currentSha256: '', snapshots: [], actions: [], createdAt: new Date().toISOString(), policy: this.policy() };
    const metadataPath = path.join(jobDir, 'job.json');
    this.writeJob(metadataPath, job);
    await this.invokeOfflineScript('create-project', jobDir, { action: 'create-project', projectPath }, input.timeoutMs, exec.signal);
    const baselinePath = path.join(snapshotsDir, '000-baseline.project');
    fs.copyFileSync(projectPath, baselinePath);
    const hash = sha256(projectPath);
    Object.assign(job, { state: 'ready', baselinePath, baselineSha256: hash, currentSha256: hash, snapshots: [{ id: '000-baseline', path: baselinePath, sha256: hash, reason: 'created-project' }] });
    this.writeJob(metadataPath, job);
    return { ok: true, action: 'create-project', jobId, projectPath, sourceProjectModified: false, sha256: hash, policy: this.policy() };
  }

  snapshot(jobDir, metadataPath, job, reason) {
    const id = `${String(job.snapshots.length).padStart(3, '0')}-${Date.now()}`;
    const target = path.join(jobDir, 'snapshots', `${id}.project`);
    fs.copyFileSync(job.projectPath, target);
    const value = { id, path: target, sha256: sha256(target), reason, createdAt: new Date().toISOString() };
    job.snapshots.push(value);
    this.writeJob(metadataPath, job);
    return value;
  }

  normalizeActionInput(action, input, jobDir, projectPath) {
    const request = { action, projectPath };
    if (['create-pou', 'create-gvl', 'create-dut', 'update-text'].includes(action)) request.objectName = safeId(input.objectName, '对象名称');
    if (input.objectGuid) request.objectGuid = safeGuid(input.objectGuid);
    if (input.parentName) request.parentName = safeId(input.parentName, '父对象名称');
    if (action === 'create-pou') {
      request.pouType = ['program', 'function-block', 'function'].includes(input.pouType) ? input.pouType : 'program';
    }
    if (['create-pou', 'create-gvl', 'create-dut', 'update-text'].includes(action)) {
      if (input.declaration !== undefined) request.declaration = String(input.declaration).slice(0, 1024 * 1024);
      if (input.implementation !== undefined) request.implementation = String(input.implementation).slice(0, 1024 * 1024);
      if (action === 'update-text' && request.declaration === undefined && request.implementation === undefined) throw Object.assign(new Error('至少提供声明或实现文本'), { code: 'CODESYS_SCRIPTENGINE_TEXT_REQUIRED' });
    }
    if (action === 'apply-changes' || action === 'apply-and-build') {
      // The composite validates its batch exactly like apply-changes, so the two
      // paths cannot drift apart. `includeTree` defaults to true: returning the
      // post-write tree is the whole point of the composite.
      if (action === 'apply-and-build') request.includeTree = input.includeTree !== false;
      const changes = Array.isArray(input.changes) ? input.changes : [];
      if (!changes.length || changes.length > 200) throw Object.assign(new Error('批量写入变更数量无效'), { code: 'CODESYS_SCRIPTENGINE_BATCH_INVALID' });
      request.changes = changes.map((change) => {
        const item = { operation: String(change.operation || 'update-text') };
        if (!['create-pou', 'create-gvl', 'create-dut', 'update-text'].includes(item.operation)) throw Object.assign(new Error(`不允许的批量操作：${item.operation}`), { code: 'CODESYS_SCRIPTENGINE_BATCH_OPERATION_INVALID' });
        item.objectName = safeId(change.objectName, '对象名称');
        if (change.objectGuid) item.objectGuid = safeGuid(change.objectGuid);
        if (change.parentName) item.parentName = safeId(change.parentName, '父对象名称');
        if (item.operation === 'create-pou') item.pouType = ['program', 'function-block', 'function'].includes(change.pouType) ? change.pouType : 'program';
        if (change.declaration !== undefined) item.declaration = String(change.declaration).slice(0, 1024 * 1024);
        if (change.implementation !== undefined) item.implementation = String(change.implementation).slice(0, 1024 * 1024);
        if (item.operation === 'update-text' && item.declaration === undefined && item.implementation === undefined) throw Object.assign(new Error('批量更新至少提供声明或实现文本'), { code: 'CODESYS_SCRIPTENGINE_TEXT_REQUIRED' });
        return item;
      });
    }
    if (action === 'export-xml') {
      request.objectName = input.objectName ? safeId(input.objectName, '导出对象名称') : '';
      const exportDir = path.join(jobDir, 'exports');
      fs.mkdirSync(exportDir, { recursive: true });
      request.xmlPath = path.join(exportDir, `${request.objectName || 'project'}-${Date.now()}.xml`);
    }
    if (action === 'import-xml') {
      const source = path.resolve(String(input.xmlPath || ''));
      if (!fs.existsSync(source) || path.extname(source).toLowerCase() !== '.xml') throw Object.assign(new Error('请选择有效的 PLCopenXML 文件'), { code: 'CODESYS_SCRIPTENGINE_XML_INVALID' });
      const importDir = path.join(jobDir, 'imports');
      fs.mkdirSync(importDir, { recursive: true });
      request.xmlPath = path.join(importDir, `${Date.now()}-${path.basename(source)}`);
      fs.copyFileSync(source, request.xmlPath);
    }
    return request;
  }

  async runOfflineAction(action, input = {}, exec = {}) {
    if (action === 'create-project') return this.createProject(input, exec);
    if (!PROJECT_ACTIONS.has(action)) throw Object.assign(new Error(`未实现的离线动作：${action}`), { code: 'CODESYS_SCRIPTENGINE_ACTION_UNAVAILABLE' });
    const actionStartedAt = Date.now();
    const timings = {};
    const mark = (name, startedAt) => { timings[name] = Date.now() - startedAt; };
    const { jobDir, metadataPath, job } = this.readJob(input.jobId);
    timings.jobRead = Date.now() - actionStartedAt;
    const directSource = job.mode === 'direct-source' || job.mode === 'active-gui-saved-source';
    if (directSource && MUTATING_ACTIONS.has(action) && input.confirmed !== true) throw Object.assign(new Error('直接写入当前工程前必须确认具体代码差异'), { code: 'CODESYS_SCRIPTENGINE_DIRECT_CONFIRMATION_REQUIRED' });
    // The user explicitly confirms writes in the dedicated workbench. When
    // the current GUI project file is writable, mutate that saved source
    // directly; no PLC/online operation is performed by this engine.
    if (job.mode === 'active-gui-saved-source' && MUTATING_ACTIONS.has(action) && job.activeProject?.writeAvailable !== true) {
      throw Object.assign(new Error(job.activeProject?.writeBlockReason || '当前工程文件不可写'), { code: 'CODESYS_SCRIPTENGINE_ACTIVE_GUI_WRITE_UNAVAILABLE' });
    }
    const sourceSha256BeforeAction = sha256(job.projectPath);
    let actionProjectPath = job.projectPath;
    let stagedProjectPath = '';
    if (action === 'inspect-project' && directSource) {
      const inspectionProjectPath = job.inspectionProjectPath || path.join(jobDir, 'snapshots', 'current-saved-read.project');
      refreshInspectionSnapshot(job.projectPath, inspectionProjectPath);
      job.inspectionProjectPath = inspectionProjectPath;
      this.writeJob(metadataPath, job);
      actionProjectPath = inspectionProjectPath;
    }
    // A GUI-owned project cannot be opened by a second CODESYS --noUI
    // process.  Run every direct-source action against an isolated copy;
    // successful confirmed mutations are committed back atomically after
    // ScriptEngine closes the copy.  This removes the
    // ProjectConcurrentlyInUseException path while retaining the write
    // snapshot and an external-save conflict check.
    if (directSource && action !== 'inspect-project') {
      const phaseStartedAt = Date.now();
      stagedProjectPath = path.join(jobDir, 'staged', `${action}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.project`);
      copyProject(job.projectPath, stagedProjectPath);
      actionProjectPath = stagedProjectPath;
      mark('stageCopy', phaseStartedAt);
    }
    const normalizeStartedAt = Date.now();
    const request = this.normalizeActionInput(action, input, jobDir, actionProjectPath);
    mark('requestNormalize', normalizeStartedAt);
    if (action === 'inspect-project' && directSource) {
      request.sourceProjectPath = job.projectPath;
      request.inspectionMode = job.mode === 'active-gui-saved-source' ? 'active-gui-saved-snapshot' : 'direct-source-saved-snapshot';
    }
    let before = null;
    if (MUTATING_ACTIONS.has(action)) {
      const snapshotStartedAt = Date.now();
      before = this.snapshot(jobDir, metadataPath, job, `before-${action}`);
      mark('recoverySnapshot', snapshotStartedAt);
    }
    let result = null;
    const inspectCacheKey = action === 'inspect-project' && directSource
      ? `${path.resolve(job.sourcePath).toLowerCase()}::${sha256(job.sourcePath)}`
      : '';
    const cachedInspection = inspectCacheKey ? this.inspectCache.get(inspectCacheKey) : null;
    const inspectSourceSha = action === 'inspect-project' ? sha256(job.sourcePath) : '';
    const diskInspection = !cachedInspection && inspectSourceSha ? this.readInspectDiskCache(inspectSourceSha) : null;
    if (cachedInspection) {
      result = {
        ok: true,
        status: 'verified-cached',
        action,
        durationMs: 0,
        payload: JSON.parse(JSON.stringify(cachedInspection.payload)),
        processError: {},
        stdout: '',
        stderr: '',
        policy: this.policy(),
        artifacts: { cached: true, sourceCacheKey: inspectCacheKey },
      };
    } else if (diskInspection) {
      // Same saved .project bytes ⇒ the same object tree, without paying the
      // ~30 s ScriptEngine launch again after an app restart.
      result = {
        ok: true,
        status: 'verified-disk-cached',
        action,
        durationMs: 0,
        payload: JSON.parse(JSON.stringify(diskInspection)),
        processError: {},
        stdout: '',
        stderr: '',
        policy: this.policy(),
        artifacts: { cached: true, cacheSource: 'disk', sourceCacheKey: inspectSourceSha },
      };
      if (result.payload && typeof result.payload === 'object') {
        result.payload.projectPath = actionProjectPath;
        if (result.payload.project && typeof result.payload.project === 'object') result.payload.project.path = actionProjectPath;
      }
      if (inspectCacheKey) {
        this.inspectCache.set(inspectCacheKey, { payload: JSON.parse(JSON.stringify(result.payload)), cachedAt: Date.now() });
        if (this.inspectCache.size > 16) this.inspectCache.delete(this.inspectCache.keys().next().value);
      }
    } else {
      const scriptStartedAt = Date.now();
      result = await this.invokeOfflineScript(action, jobDir, request, input.timeoutMs, exec.signal);
      mark('scriptEngineProcess', scriptStartedAt);
      if (inspectCacheKey && result?.payload?.complete === true && result?.payload?.textTruncated === false) {
        this.inspectCache.set(inspectCacheKey, { payload: JSON.parse(JSON.stringify(result.payload)), cachedAt: Date.now() });
        if (this.inspectCache.size > 16) this.inspectCache.delete(this.inspectCache.keys().next().value);
      }
      if (inspectSourceSha && result?.payload?.complete === true && result?.payload?.textTruncated === false) {
        this.writeInspectDiskCache(inspectSourceSha, result.payload);
      }
    }
    if ((action === 'inspect-project' || (action === 'apply-and-build' && result?.payload?.objects)) && result?.payload) {
      result.payload.sourceProjectPath = job.projectPath;
      result.payload.inspectionMode = request.inspectionMode || (action === 'apply-and-build' ? 'post-write-refresh' : undefined);
      result.payload.activeProject = job.activeProject || null;
    }
    job.currentSha256 = sha256(job.projectPath);
    job.state = 'ready';
    job.actions.push({ action, at: new Date().toISOString(), beforeSnapshot: before?.id || '', beforeSha256: before?.sha256 || '', afterSha256: job.currentSha256, resultPath: result.artifacts.resultPath, ok: result.ok });
    if (stagedProjectPath && MUTATING_ACTIONS.has(action) && result.ok === true) {
      const commitStartedAt = Date.now();
      commitProject(job.projectPath, stagedProjectPath, sourceSha256BeforeAction);
      job.currentSha256 = sha256(job.projectPath);
      mark('sourceCommit', commitStartedAt);
    }
    // The composite already read the post-write tree inside the write's own CODESYS
    // process, so cache it under the NEW source hash: a later read of this project
    // then costs 0 ms instead of another ~33 s ScriptEngine launch. This has to run
    // AFTER the commit — a post-write read used to miss the cache by definition,
    // because the write had just changed the content the key is derived from.
    if (action === 'apply-and-build' && result?.ok === true
      && result.payload?.complete === true && result.payload?.textTruncated === false
      && Array.isArray(result.payload?.objects)) {
      try { this.writeInspectDiskCache(sha256(job.projectPath), result.payload); } catch { /* the cache is best effort */ }
    }
    const sourceProjectModified = directSource && MUTATING_ACTIONS.has(action) && result.ok === true;
    job.sourceProjectModified = job.sourceProjectModified || sourceProjectModified;
    const metadataStartedAt = Date.now();
    this.writeJob(metadataPath, job);
    mark('metadataWrite', metadataStartedAt);
    const evidence = { ...result, jobId: job.jobId, mode: job.mode || 'isolated-copy', sourcePath: job.sourcePath || '', projectPath: job.projectPath, actionProjectPath, stagedProjectPath, sourceProjectModified, beforeSnapshot: before || null, currentSha256: job.currentSha256, baselineSha256: job.baselineSha256, timings: { ...timings, total: Date.now() - actionStartedAt } };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', evidence);
    return evidence;
  }

  diff(input = {}) {
    const { job } = this.readJob(input.jobId);
    const currentSha256 = sha256(job.projectPath);
    const result = { ok: true, action: 'diff', jobId: job.jobId, mode: job.mode || 'isolated-copy', sourcePath: job.sourcePath || '', projectPath: job.projectPath, changed: currentSha256 !== job.baselineSha256, baselineSha256: job.baselineSha256, currentSha256, sourceProjectModified: job.mode === 'direct-source' && currentSha256 !== job.baselineSha256, snapshots: job.snapshots.map(({ id, path: snapshotPath, sha256: hash, reason, createdAt }) => ({ id, path: snapshotPath, sha256: hash, reason, createdAt })) };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', result);
    return result;
  }

  rollback(input = {}) {
    const { metadataPath, job } = this.readJob(input.jobId);
    if (job.mode === 'active-gui-saved-source' && job.activeProject?.writeAvailable !== true) {
      throw Object.assign(new Error(job.activeProject?.writeBlockReason || '当前工程文件不可写'), { code: 'CODESYS_SCRIPTENGINE_ACTIVE_GUI_WRITE_UNAVAILABLE' });
    }
    const wanted = String(input.snapshotId || '000-baseline');
    const snapshot = job.snapshots.find((item) => item.id === wanted);
    if (!snapshot || !fs.existsSync(snapshot.path)) throw Object.assign(new Error('回滚快照不存在'), { code: 'CODESYS_SCRIPTENGINE_SNAPSHOT_NOT_FOUND' });
    fs.copyFileSync(snapshot.path, job.projectPath);
    job.currentSha256 = sha256(job.projectPath);
    job.state = 'rolled-back';
    job.sourceProjectModified = job.mode === 'direct-source' && job.currentSha256 !== job.baselineSha256;
    job.actions.push({ action: 'rollback', snapshotId: snapshot.id, at: new Date().toISOString() });
    this.writeJob(metadataPath, job);
    const result = { ok: true, action: 'rollback', jobId: job.jobId, mode: job.mode || 'isolated-copy', sourcePath: job.sourcePath || '', projectPath: job.projectPath, snapshotId: snapshot.id, currentSha256: job.currentSha256, sourceProjectModified: job.sourceProjectModified, restored: true };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', result);
    return result;
  }

  async invokeOfflineScript(action, jobDir, request, timeoutMs = 180000, signal) {
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) throw Object.assign(new Error('CODESYS ScriptEngine 未就绪'), { code: 'CODESYS_SCRIPTENGINE_NOT_READY', details: doctor });
    const runId = `${action}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const runDir = path.join(jobDir, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const requestPath = path.join(runDir, 'request.json');
    const scriptPath = path.join(runDir, 'action.py');
    const resultPath = path.join(runDir, 'result.json');
    fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    fs.writeFileSync(scriptPath, buildOfflineActionScript(requestPath, resultPath), 'utf8');
    const safeTimeout = Math.max(10000, Math.min(300000, Number(timeoutMs) || 180000));
    const args = [`--profile=\"${doctor.profile}\"`, '--noUI', `--runscript=\"${scriptPath}\"`];
    const startedAt = Date.now();
    let output = {}; let processError = null;
    try {
      // encoding:'buffer' —— 见 decodeProcessText：CODESYS 的控制台输出是 GBK，按 UTF-8 解
      // 会得到一片 U+FFFD（编译输出面板里显示成乱码的根因）。
      output = await this.runProcess(doctor.exePath, args, { cwd: runDir, windowsHide: true, windowsVerbatimArguments: process.platform === 'win32', timeout: safeTimeout, maxBuffer: 4 * 1024 * 1024, signal, encoding: 'buffer' });
    } catch (error) {
      output = error || {};
      processError = { code: error?.code || null, signal: error?.signal || null, killed: Boolean(error?.killed), message: String(error?.message || error).slice(0, 4000) };
    }
    let payload = null;
    try { payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch {}
    const stdout = decodeProcessText(output?.stdout).slice(-32000);
    const stderr = decodeProcessText(output?.stderr).slice(-32000);
    if ((action === 'build' || action === 'rebuild' || action === 'apply-and-build') && payload) {
      const stderrDiagnostics = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text) => ({
        severity: /\bError\s*:|错误\s*[:：]|不能打开库/i.test(text) ? 'Error' : /\bWarning\s*:|警告\s*[:：]|缺少/i.test(text) ? 'Warning' : 'Info',
        text,
        source: 'codesys-stderr',
      }));
      const messageKeys = new Set((payload.messages || []).map((item) => `${String(item.severity || '')}\u0000${String(item.text || '')}`));
      payload.messages = [...(payload.messages || []), ...stderrDiagnostics.filter((item) => !messageKeys.has(`${item.severity}\u0000${item.text}`))];
      payload.errorCount = Math.max(Number(payload.errorCount || 0), stderrDiagnostics.filter((item) => item.severity === 'Error').length);
      payload.buildSucceeded = payload.errorCount === 0;
    }
    // A CODESYS --noUI host sometimes does not exit after a finished script (a
    // hidden warning dialog blocks it), and the process cap then kills a run
    // whose result was ALREADY complete on disk. Measured in the field: a
    // 62-object inspect wrote a complete result and was killed at the 120 s cap,
    // so the user waited two minutes and got "Command failed" with no tree. A
    // complete payload wins over the process outcome; the process error becomes
    // a warning instead of throwing finished work away.
    const payloadComplete = Boolean(payload && payload.ok === true)
      && (action !== 'inspect-project' || (payload.complete === true && payload.textTruncated === false));
    const recovered = Boolean(payloadComplete && processError);
    const actionOk = payloadComplete;
    const warnings = recovered ? [{ code: 'CODESYS_PROCESS_ERROR_AFTER_RESULT', message: processError?.message || 'ScriptEngine 进程在写出完整结果后被结束' }] : [];
    const status = actionOk
      ? ((action === 'build' || action === 'rebuild') && payload?.buildSucceeded === false ? 'completed-with-errors' : (recovered ? 'verified-with-process-warning' : 'verified'))
      : 'failed';
    const evidence = { ok: actionOk, status, warnings, action, durationMs: Date.now() - startedAt, payload, processError: processError || {}, stdout, stderr, policy: this.policy(), artifacts: { jobDir, runDir, requestPath, scriptPath, resultPath }, completedAt: new Date().toISOString() };
    if (!evidence.ok) throw Object.assign(new Error(processError?.message || `ScriptEngine 离线动作失败：${action}`), { code: 'CODESYS_SCRIPTENGINE_OFFLINE_ACTION_FAILED', details: evidence });
    return evidence;
  }

  async probe({ timeoutMs = 45000, signal } = {}) {
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) {
      const error = new Error('CODESYS ScriptEngine 未就绪');
      error.code = 'CODESYS_SCRIPTENGINE_NOT_READY';
      error.details = doctor;
      throw error;
    }
    const safeTimeout = Math.max(5000, Math.min(120000, Number(timeoutMs) || 45000));
    const jobId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const jobDir = path.join(this.jobsRoot, jobId);
    const scriptPath = path.join(jobDir, 'probe.py');
    const resultPath = path.join(jobDir, 'result.json');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(scriptPath, buildProbeScript(resultPath), 'utf8');
    const args = [`--profile=\"${doctor.profile}\"`, '--noUI', `--runscript=\"${scriptPath}\"`];
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let processError = null;
    try {
      const output = await this.runProcess(doctor.exePath, args, {
        cwd: jobDir,
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32',
        timeout: safeTimeout,
        maxBuffer: 1024 * 1024,
        signal,
      });
      stdout = String(output?.stdout || '').slice(-16000);
      stderr = String(output?.stderr || '').slice(-16000);
    } catch (error) {
      stdout = String(error?.stdout || '').slice(-16000);
      stderr = String(error?.stderr || '').slice(-16000);
      processError = { code: error?.code || null, signal: error?.signal || null, killed: Boolean(error?.killed), message: String(error?.message || error).slice(0, 2000) };
    }
    let payload = null;
    try { payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { /* reported below */ }
    const evidence = {
      ok: Boolean(payload?.ok) && !processError,
      status: payload?.ok && !processError ? 'verified' : 'failed',
      action: 'probe',
      jobId,
      durationMs: Date.now() - startedAt,
      executable: doctor.exePath,
      version: doctor.version,
      profile: doctor.profile,
      args: [`--profile=\"${doctor.profile}\"`, '--noUI', '--runscript="<isolated-probe.py>"'],
      payload,
      processError: processError || {},
      stdout,
      stderr,
      policy: this.policy(),
      artifacts: { jobDir, scriptPath, resultPath },
      completedAt: new Date().toISOString(),
    };
    this.persistEvidence('codesys-scriptengine-probe.json', evidence);
    if (!evidence.ok) {
      const error = new Error(processError?.message || 'CODESYS ScriptEngine 探针未生成有效结果');
      error.code = 'CODESYS_SCRIPTENGINE_PROBE_FAILED';
      error.details = evidence;
      throw error;
    }
    return evidence;
  }

  persistEvidence(name, value) {
    fs.mkdirSync(this.logsRoot, { recursive: true });
    fs.writeFileSync(path.join(this.logsRoot, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

module.exports = {
  CodesysScriptEngine,
  ALLOWED_ACTIONS,
  ONLINE_ACTIONS,
  ONLINE_ACTION_CAPABILITY,
  ONLINE_ACTION_COMMAND,
  PLC_ONLINE_CAPABILITIES,
  UNSUPPORTED_ONLINE_CAPABILITIES,
  buildProbeScript,
  buildOfflineActionScript,
  profileFromVersion,
  versionFromExe,
};
