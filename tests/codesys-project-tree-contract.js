'use strict'
// Contract: the CODESYS code workbench must show the REAL project tree —
// device → Plc Logic → application → POU / GVL / DUT / Library Manager — with
// multi-level expand/collapse and a code/device distinction.
//
// Two halves are pinned here:
//  1. `scriptengine.cjs` could only report a FLAT recursive object list, so no
//     hierarchy existed to render. The emitted Python now walks the tree one
//     level at a time and reports parentGuid / depth / path while keeping full
//     object coverage (anything the walk cannot reach becomes an ungrouped root).
//  2. The client must classify objects by their CODESYS object-type GUID, build
//     the parent/child tree, expand/collapse it, filter it, and colour changes
//     on the right rows.
//
// The emitted Python is EXECUTED against fake CODESYS objects: the walk, the
// coverage fallback and the payload shape are asserted as behaviour, not as
// source text. Python is optional — the suite skips that part when unavailable.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const enginePath = path.join(root, 'plugins/installed/codesys-monitor/scriptengine.cjs')
const clientPath = path.join(root, 'plugins/installed/taskhive-surfaces/dsh/client.js')
const mainPath = path.join(root, 'app/main.js')
const engine = fs.readFileSync(enginePath, 'utf8')
const client = fs.readFileSync(clientPath, 'utf8')
const main = fs.readFileSync(mainPath, 'utf8')
const hostPath = path.join(root, 'plugins/installed/taskhive-surfaces/dsh/index.js')
const host = fs.readFileSync(hostPath, 'utf8')

// --- 1. the engine reports a hierarchy, not just a flat list ---------------
assert(engine.includes('def object_children(obj):'), 'the engine needs a direct-children helper')
assert(engine.includes('def object_class(obj):'), 'the engine reports the scripting class as a hint')
assert(engine.includes('def walk(obj, parent_row, depth):'), 'the inspect walk must be recursive')
assert(engine.includes("row['parentGuid'] = parent_row.get('guid', '') if parent_row else ''"), 'every row carries its parent GUID')
assert(engine.includes("row['parentName'] = parent_row.get('name', '') if parent_row else ''"), 'every row carries its parent name')
assert(engine.includes("row['depth'] = depth"), 'every row carries its depth')
assert(engine.includes("row['path'] = (parent_row.get('path', []) if parent_row else []) + [row['name']]"), 'every row carries its path')
assert(engine.includes("row['hasChildren'] = len(children) > 0"), 'group rows must be recognisable')
assert(engine.includes("row['ungrouped'] = True"), 'objects the walk cannot reach must be preserved as ungrouped roots')
assert(engine.includes("result['hierarchy'] = {'roots': len(roots), 'grouped': len(rows) - ungrouped, 'ungrouped': ungrouped}"), 'the payload reports how much of the tree was resolved')
assert(engine.includes('for obj in (project.get_children(True) or []):'), 'coverage fallback must consult the flat recursive list')
// The Python lives inside a JS template literal, where a stray backtick ends the
// whole script. That bug shipped once; the marker below cannot survive it.
const pythonSource = engine.slice(engine.indexOf('function buildOfflineActionScript'))
assert(!/`[^`]*`[^`]*get_children/.test(pythonSource.slice(0, pythonSource.indexOf('def find_one'))), 'the embedded Python must not contain JS backticks')
// The scripting model reports code objects at project scope while the IDE shows
// them under the application (measured: 12 POUs + a GlobalTextList became 18
// top-level rows). They must be re-parented, and the objects CODESYS hides must
// be marked instead of rendered as extra roots.
assert(engine.includes('row[\'internal\'] = True'), 'internal / duplicate objects must be marked')
assert(engine.includes("row['reparented'] = True"), 'application-scoped orphans must be re-parented')
assert(engine.includes("result['hierarchy']['reparented'] = reparented"), 'the payload must report the re-parenting')
// Reading a project costs a full ScriptEngine launch (measured 31,852 ms), so the
// result must survive an app restart, keyed by the saved .project bytes.
assert(engine.includes('readInspectDiskCache(sourceSha256)'), 'a persistent inspect cache must exist')
assert(engine.includes('this.inspectCacheRoot = path.join(this.root, \'cache\', \'codesys-inspect\')'), 'the disk cache must live under cache/codesys-inspect')
assert(engine.includes("status: 'verified-disk-cached'"), 'a disk cache hit must be reported honestly')
assert(engine.includes('this.writeInspectDiskCache(inspectSourceSha, result.payload)'), 'a successful inspect must be cached')
assert(engine.includes("this.readInspectDiskCache(inspectSourceSha)"), 'the cache must be consulted before launching the engine')
// Field failure: a 62-object inspect wrote a COMPLETE result, the CODESYS --noUI
// host did not exit, the 120 s cap killed it, and the engine threw the finished
// work away — two minutes of waiting ended in "Command failed" and no tree.
assert(engine.includes('const payloadComplete = Boolean(payload && payload.ok === true)'), 'a complete payload must be recognised')
assert(engine.includes('const recovered = Boolean(payloadComplete && processError)'), 'a process error after a complete result must be recoverable')
assert(engine.includes('const actionOk = payloadComplete;'), 'a complete payload must win over the process outcome')
assert(engine.includes('CODESYS_PROCESS_ERROR_AFTER_RESULT'), 'the recovered error must be reported as a warning')
assert(engine.includes("'verified-with-process-warning'"), 'the recovered status must be distinguishable')
// And the wait must be explainable: in-process phase timings + the cache state.
assert(engine.includes("result['timings'] = {'walkMs'"), 'the engine must measure the tree walk')
assert(engine.includes("result['timings']['totalMs']"), 'the engine must measure the payload phase')
assert(engine.includes('import time'), 'the embedded Python needs the time module for its phase timings')
assert(client.includes("const wait = cached"), 'the workbench must say when a read came from cache')
assert(client.includes('读取耗时 ${(processMs / 1000).toFixed(1)} 秒'), 'the workbench must report the real read cost')
assert(client.includes('CODESYS 进程被结束但结果完整'), 'a recovered read must say so')
// The raw IPC failure the user pasted ("Error invoking remote method
// 'codesys:scriptengine-action': Error: Command failed: C:\Program Files\...")
// must be translated into an actionable sentence, not echoed verbatim.
assert(client.includes('function codesysScriptEngineErrorMessage(error)'), 'engine failures must be mapped to a readable message')
assert(client.includes('CODESYS ScriptEngine 进程超时未结束或异常退出'), 'the timeout case must be explained')
assert(client.includes('当前工程自动绑定失败：${codesysScriptEngineErrorMessage(error)}'), 'the bind failure path must use the mapped message')
assert(client.includes('工程读取失败：${codesysScriptEngineErrorMessage(error)}'), 'the manual read failure path must use the mapped message')

// --- 2. the client builds and paints the multi-level tree ------------------
assert(client.includes("const CODESYS_KIND_BY_TYPE_GUID = {"), 'the CODESYS object-type GUID table must exist')
assert(client.includes("'225bfe47-7336-4dbc-9419-4105a7c831fa': { kind: 'device', category: 'device', label: '设备' }"), 'a device must be classified as a device')
assert(client.includes("'6f9dac99-8de1-4efc-8465-68ac443b7d08': { kind: 'pou', category: 'code', label: 'POU' }"), 'a POU must be classified as code')
assert(client.includes("'adb5cb65-8e1d-4a00-b70a-375ea27582f3': { kind: 'library-manager'"), 'the library manager must be its own kind')
assert(client.includes('function codesysKindOfObject(item)'), 'classification must be a pure function')
assert(client.includes('if (item?.ungrouped) return CODESYS_KIND_OBJECT'), 'an ungrouped object must never be guessed as a device')
assert(client.includes('function buildCodesysTree(items)'), 'the flat payload must be turned into a tree')
assert(client.includes('node.parent = parent && parent !== node && !codesysTreeWouldCycle(node, parent) ? parent : null'), 'parent links must be cycle-safe')
assert(client.includes("node.item?.__parentName || node.item?.parentName"), 'an AI-created object must attach to its parentName')
assert(client.includes('function codesysTreeVisibleKeys(tree, filter)'), 'filtering must keep the hierarchy')
assert(client.includes('function codesysTreeChangeStates(tree, changeStates, changedKeys)'), 'a collapsed ancestor must still show that a descendant changed')
assert(client.includes("className: `taskhive-codesys-treerow"), 'tree rows render through the new row element')
assert(client.includes("'data-node-kind': kind.kind"), 'rows expose their kind')
assert(client.includes("'data-node-category': kind.category"), 'rows expose code vs device category')
assert(client.includes("'data-node-depth': String(depth)"), 'rows expose their depth')
assert(client.includes("'data-node-children': String(node.children.length)"), 'rows expose their child count')
assert(client.includes("'aria-expanded': expanded ? 'true' : 'false'"), 'group rows are real ARIA treeitems')
assert(client.includes("'data-twisty': expanded ? 'open' : 'closed'"), 'expand/collapse must have a dedicated control')
assert(client.includes("'data-codesys-tree-filter': value"), 'the code/device filter must be reachable')
// T082: 「全展开 / 全折叠」按用户要求删除——树的默认状态就是全展开，逐节点仍用
// twisty 折叠，选中对象时会自动展开到它所在层级。删除后默认 400px 侧栏下工具栏
// 回到一行，约 20px 还给了对象树。这里改成断言它们不再回潮。
assert(!client.includes("'data-codesys-tree-expand'"), 'the expand-all/collapse-all buttons must stay removed (T082)')
assert(client.includes('treeFilter === \'all\' && collapsedKeys.has(node.key)'), 'an active filter must not hide its own matches')
assert(client.includes("React.useEffect(() => {"), 'selection reveal effect must exist')
assert(client.includes('let cursor = objectTree.byKey.get(selectedKey)?.parent || null'), 'selecting an object must reveal it inside collapsed branches')
// ...but ONLY when the selection changes. Re-running it on every render made a
// branch the user had just collapsed spring back open (field report: "展开的列表
// 不能折叠回去").
assert(client.includes('const revealedSelectionRef = React.useRef(\'\')'), 'the reveal must be guarded by a ref')
assert(client.includes('if (!selectedKey || revealedSelectionRef.current === selectedKey) return'), 'the reveal must run once per selection, not per render')
// The panes gained children (filter toolbar, legend, editor hint) while the
// shared 1.0.2 rule still declared two grid rows: the tree was pushed into
// clipped implicit rows, so neither rows nor filter buttons could be clicked.
assert(client.includes('.taskhive-codesys-object-pane{grid-template-rows:auto auto minmax(0,1fr) auto!important}'), 'the object pane must declare its four rows')
assert(client.includes('.taskhive-codesys-code-pane{grid-template-rows:auto auto minmax(0,1fr) auto!important}'), 'the code pane must declare its rows too')
// A ~30 s ScriptEngine launch must look like work, not like a freeze.
assert(client.includes("'data-codesys-busy-seconds': String(busySeconds)"), 'a busy read must show elapsed seconds')
assert(client.includes('const [busySeconds, setBusySeconds] = React.useState(0)'), 'the elapsed counter must be local state')
assert(client.includes('setBusySeconds(Math.round((Date.now() - startedAt) / 1000))'), 'the counter must only tick while a read is running')
// 「打开 CODESYS」→ open/save a project → the workbench must follow on its own.
// A fixed 120 s fallback left the user staring at an empty pane for up to two
// minutes; while nothing is bound the cadence is short and stops after 5 minutes.
assert(client.includes('const CODESYS_WAIT_DETECT_MS = 6000'), 'the waiting cadence must be short')
assert(client.includes('const CODESYS_WAIT_GIVE_UP_MS = 300000'), 'the waiting cadence must give up eventually')
assert(client.includes('waitingSinceRef.current = waitingSinceRef.current || Date.now()'), 'an unbound probe must start the waiting window')
assert(client.includes('waitingSinceRef.current = 0'), 'a successful bind must end the waiting window')
assert(client.includes('const waiting = !jobIdRef.current && waitingSinceRef.current > 0'), 'the cadence must depend on being unbound')
assert(client.includes('}, waiting ? CODESYS_WAIT_DETECT_MS : CODESYS_FALLBACK_DETECT_MS)'), 'the fallback timer must pick the cadence per state')
assert(client.includes('已检测到本插件打开的 CODESYS 窗口（${owned} 个）'), 'the waiting state must explain itself')
assert(!/setInterval\([^)]*detectCurrentProjectRef/.test(client), 'background DETECTION must not run on a fixed interval (the claim poll is a separate, engine-free call)')
assert(client.includes('timer = setTimeout(() => {'), 'the detection fallback must be self-scheduled')
assert(client.includes('首次读取需启动 CODESYS ScriptEngine'), 'the status must explain the first-read wait')
// T097b: 「选择工程」必须**常驻** —— 用户要求绑定工程之后仍然能点它，以便第二次选择工程。
// 所以契约钉住"不存在把它藏起来的条件渲染分支"（原来只在未绑定/空树时才渲染）。
assert(!client.includes('!sourcePath || !displayObjects.length ?'), 'the manual .project picker must NOT be conditionally hidden after a project is bound (the user needs to pick a second project)')
assert(client.includes("'data-codesys-tree-internal'"), 'internal objects must be toggleable instead of cluttering the tree')
assert(client.includes('const treeItems = showInternal ? displayObjects : displayObjects.filter((item) => !item.internal)'), 'internal objects must be hidden by default like real CODESYS')
// CODESYS has two editors — 声明区 and 代码区 — each numbered from line 1. The
// workbench used to concatenate them into ONE textarea (so the implementation's
// line numbers were offset by the declaration length) and split manual edits on
// the first blank line (which moved text into the wrong section whenever the
// declaration contained a blank line).
assert(client.includes("'data-editor-section': section.id"), 'each editor section must be identifiable')
assert(client.includes("id: 'declaration', label: '声明（Declaration）'"), 'the declaration section must exist')
assert(client.includes("id: 'implementation', label: '实现（Implementation）'"), 'the implementation section must exist')
assert(client.includes("...(selected.hasDeclaration ? [{ id: 'declaration'"), 'a section is rendered only when the object has it')
assert(client.includes('const declarationRefs = { gutter: React.useRef(null), highlight: React.useRef(null), values: React.useRef(null) }'), 'the declaration needs its own gutter/tint/value refs')
assert(client.includes('const implementationRefs = { gutter: React.useRef(null), highlight: React.useRef(null), values: React.useRef(null) }'), 'the implementation needs its own gutter/tint/value refs')
assert(client.includes("'data-section-changed-lines': [...changed].join(',')"), 'each section tracks its own changed lines')
// Clicking into a section must not flash a dark box: the native `title` tooltip
// and the 1.0.2 black focus ring are both gone.
assert(!/data-editor-part': section\.id,\s*\n?\s*'aria-label'[^\n]*title:/.test(client), 'the editor textarea must not carry a title attribute')
assert(client.includes("'data-no-native-tooltip': 'true'"), 'the editor textarea must opt out of the native tooltip')
assert(client.includes("const tooltipAllowed = !control.closest?.('[data-taskhive-codesys-workbench=\"true\"]')"), 'the accessibility backfill must not add tooltips inside the workbench')
assert(client.includes('.taskhive-codesys-code-editor:focus{box-shadow:none!important;outline:none!important'), 'clicking the code must paint nothing at all')
assert(client.includes('.taskhive-codesys-code-editor:focus-visible{outline:2px solid var(--th-brand)!important'), 'keyboard focus must keep a visible ring')
// Resizable layout: two drag handles, clamped so everything can be squeezed to
// a floor, with the shape remembered. "调整代码编辑器高度不好用…应该可以继续扩大
// 挤压其余功能区 ui 直到极限".
assert(client.includes("'data-codesys-split': 'tree'"), 'the tree/editor divider must exist')
assert(client.includes("'data-codesys-split': 'declaration'"), 'the declaration/implementation divider must exist')
assert(client.includes("role: 'separator'"), 'drag handles must be accessible separators')
assert(client.includes('beginCodesysDrag(event, moveTreeSplit'), 'the tree divider must drag')
assert(client.includes('beginCodesysDrag(event, moveDeclarationSplit'), 'the section divider must drag')
assert(client.includes('const minRatio = Math.max(limits.min, limits.floorPx / rect.width)'), 'the tree divider must clamp to a floor')
assert(client.includes('const maxRatio = Math.min(limits.max, 1 - limits.otherFloorPx / rect.height)'), 'the section divider must stop before the other section is crushed')
assert(client.includes("floorPx: 132, otherFloorPx: 170"), 'the tree may shrink to 132px and the editor keeps at least 170px')
assert(client.includes('const [treeFraction, setTreeFraction] = React.useState(() => readStoredFraction(CODESYS_LAYOUT_KEYS.tree, 0.52))'), 'the drag ratio must be remembered, defaulting to a wider tree (T081)')
assert(client.includes("'--th-tree-fr': `${treeFraction}fr`"), 'the dragged ratio must drive the grid columns')
assert(client.includes("style: { flex: `${section.id === 'declaration' ? declarationFraction : 1 - declarationFraction} 1 0%` }"), 'the two sections must split the code pane by the dragged ratio')
assert(client.includes('onKeyDown: (event) => {'), 'drag handles must be keyboard adjustable')
assert(client.includes('background:transparent!important;resize:none!important}'), 'the code editor must not show the useless resize gripper (the divider does the resizing now)')
assert(client.includes('const changedLineNumbersImplementation = implementationDiff'), 'the implementation diff must be computed against its own base')
assert(!client.includes('editedParts'), 'the fragile blank-line split of the manual edit must be gone')
assert(client.includes("...(selected.hasDeclaration && declarationManual ? { declaration: editedDeclaration } : {})"), 'the manual change must be built from the declaration section directly')
assert(client.includes("...(selected.hasImplementation && implementationManual ? { implementation: editedImplementation } : {})"), 'the manual change must be built from the implementation section directly')
assert(client.includes('declaration: String(editedDeclaration || \'\').slice(0, CODESYS_OPEN_OBJECT_BUDGET)'), 'the published state must carry the two sections separately')
assert(main.includes("const declarationEditor = workbench?.querySelector('[data-editor-part=\"declaration\"]')"), 'the probe must read both editor parts')
assert(main.includes('const sectionNumberingVerified = editorSections.length >= 1'), 'the probe must verify per-section line numbering')
assert(main.includes("section.firstGutterNumber === '1' && section.gutterLines === section.lines"), 'each section must start at line 1 with matching gutter length')
assert(main.includes("/PROGRAM\\s+PLC_PRG/i.test(String(snapshot.editor.declaration || ''))"), 'the PROGRAM marker lives in the declaration, not the implementation')
// The workbench already owns the project controls, so the tree pane must NOT
// repeat them (field report: "为什么项目树里边会有检测工程和打开文件？").
assert(!client.includes("'data-codesys-empty-detect'"), 'the empty tree must not duplicate the 刷新当前工程 action')
assert(!client.includes("'data-codesys-empty-select'"), 'the empty tree must not duplicate the 选择 .project 文件 action')
assert(!client.includes('taskhive-codesys-empty-actions'), 'the empty tree must have no action button row at all')
assert(client.includes('taskhive-codesys-empty-pointer'), 'the empty tree must point at the existing controls instead')
assert(client.includes("'data-codesys-open-projects': 'true'"), 'the ambiguous-project choice must live in the 当前工程 row')
assert(client.includes("'data-codesys-select-project': 'true'"), 'the single manual picker must stay where it always was')
// Objects keep the attributes the packaged probe and the AI snapshot rely on.
assert(client.includes("'data-codesys-object-guid': item.guid || ''"), 'object rows keep their GUID attribute')
assert(client.includes("'data-codesys-object-has-code': item.hasDeclaration || item.hasImplementation ? 'true' : 'false'"), 'object rows keep the has-code attribute')
assert(client.includes("'data-codesys-object-library-manager': item.hasLibraryManager ? 'true' : 'false'"), 'object rows keep the library-manager attribute')
assert(client.includes("'data-pending-create': item.__pendingKey ? 'true' : 'false'"), 'pending creates keep their marker')
assert(client.includes('selected && !selectedIsCode'), 'selecting a device/container must explain itself instead of showing an empty editor')
assert(client.includes('window.__TASKHIVE_CODESYS_WORKBENCH__ = {'), 'the read-only seam must exist')
assert(client.includes('buildTree: (items) => {'), 'the seam must expose the tree builder for probes')
assert(client.includes('kindOf: (item) => codesysKindOfObject(item || {})'), 'the seam must expose the classifier for probes')

// --- 3. the packaged probe verifies it in the real window ------------------
assert(main.includes('const objectItems = treeRows.filter((item) => item.guid)'), 'the probe must separate group rows from object rows')
assert(main.includes('snapshot.uniqueGuidCount === snapshot.objectItems.length'), 'the GUID assertions must read object rows only')
assert(main.includes('const treeStructureVerified ='), 'the probe must assert the tree structure')
assert(main.includes('const treeInteractionVerified ='), 'the probe must assert expand/collapse and filtering')
assert(main.includes('const seamVerified ='), 'the probe must exercise the classifier/tree seam')
assert(main.includes("snapshot.seam.kinds.join(',') === 'device,plc-logic,application,library-manager,pou'"), 'the probe must assert the synthetic classification result')
assert(main.includes("const treeToggle = await frame.executeJavaScript(`new Promise((resolve) => {"), 'the probe must click a real twisty')
assert(main.includes("const treeFilterProbe = await frame.executeJavaScript(`new Promise((resolve) => {"), 'the probe must click a real filter')
assert(main.includes('const editor = workbench?.querySelector(\'[data-codesys-code-editor="true"]\')'), 'the probe must read the real code editor (the old diff pane no longer exists)')
// The model must see WHERE the open object lives, not only its text.
assert(host.includes('treePath: Array.isArray(open.path) ? open.path.slice(0, 32).map((part) => String(part || \'\')) : []'), 'the read tool must report the open object tree path')
assert(host.includes('kindCounts: state.kindCounts || {}'), 'the read tool must report the project shape')

// --- 4. execute the client tree helpers on realistic payload rows ----------
// The helpers are pure, so they are extracted from the shipped bundle and run
// here: classification, hierarchy, filtering and change aggregation are checked
// as behaviour instead of being grepped for.
function loadClientTreeHelpers() {
  const start = client.indexOf('    const CODESYS_KIND_BY_TYPE_GUID = {')
  const end = client.indexOf('    // ── CODESYS 代码工作台 ↔ 对话 联动')
  assert(start > 0 && end > start, 'the client tree helper block must be extractable')
  const keyStart = client.indexOf('    function codesysObjectKey(item) {')
  const keyEnd = client.indexOf('    function resolveCodesysProposalObject(')
  assert(keyStart > 0 && keyEnd > keyStart, 'codesysObjectKey must be extractable')
  const keyFn = client.slice(keyStart, keyEnd)
  const block = client.slice(start, end)
  const factory = new Function(`${keyFn}\n${block}\nreturn { codesysObjectKey, codesysKindOfObject, buildCodesysTree, codesysTreeVisibleKeys, codesysTreeChangeStates }`)
  return factory()
}

function verifyClientTree() {
  const H = loadClientTreeHelpers()
  const DEVICE = '225bfe47-7336-4dbc-9419-4105a7c831fa'
  const PLC_LOGIC = '40b404f9-e5dc-42c6-907f-c89f4a517386'
  const APPLICATION = '639b491f-5557-464c-af91-1471bac9f549'
  const LIBRARY = 'adb5cb65-8e1d-4a00-b70a-375ea27582f3'
  const POU = '6f9dac99-8de1-4efc-8465-68ac443b7d08'
  const GVL = 'ffbfa93a-b94d-45fc-a329-229860183b1d'
  const DUT = '2db5746d-d284-4425-9f7f-2663a34b0ebc'
  const FOLDER = '738bea1e-99bb-4f04-90bb-a7a567e74e3a'
  const rows = [
    { name: 'Device', guid: 'g-dev', type: DEVICE },
    { name: 'Plc Logic', guid: 'g-plc', type: PLC_LOGIC, parentGuid: 'g-dev' },
    { name: 'Application', guid: 'g-app', type: APPLICATION, parentGuid: 'g-plc', isApplication: true },
    { name: 'Library Manager', guid: 'g-lib', type: LIBRARY, parentGuid: 'g-app', hasLibraryManager: true },
    { name: 'PLC_PRG', guid: 'g-pou', type: POU, parentGuid: 'g-app', hasDeclaration: true, hasImplementation: true },
    { name: 'GVL', guid: 'g-gvl', type: GVL, parentGuid: 'g-app', hasDeclaration: true },
    { name: 'DT_Log', guid: 'g-dut', type: DUT, parentGuid: 'g-app', hasDeclaration: true },
    { name: 'ServoMotor', guid: 'g-folder', type: FOLDER, isFolder: true },
    { name: 'Loose', guid: 'g-loose', type: 'ffffffff-ffff-ffff-ffff-ffffffffffff', ungrouped: true },
    { name: 'NewPOU', __pendingKey: 'pending:create-pou:newpou', __parentName: 'Application', hasDeclaration: true },
  ]
  assert.strictEqual(H.codesysKindOfObject(rows[0]).kind, 'device', 'a device GUID must classify as a device')
  assert.strictEqual(H.codesysKindOfObject({ type: 'ffffffff-ffff-ffff-ffff-ffffffffffff', ungrouped: true }).kind, 'object', 'an ungrouped object must not become a device')
  assert.strictEqual(H.codesysKindOfObject({ type: 'ffffffff-ffff-ffff-ffff-ffffffffffff', declaration: 'VAR_GLOBAL\nEND_VAR' }).kind, 'gvl', 'an unknown GUID with a VAR_GLOBAL declaration is a GVL')
  assert.strictEqual(H.codesysKindOfObject({ type: 'ffffffff-ffff-ffff-ffff-ffffffffffff', declaration: 'TYPE X : STRUCT\nEND_STRUCT\nEND_TYPE' }).kind, 'dut', 'an unknown GUID with a TYPE declaration is a DUT')
  const tree = H.buildCodesysTree(rows)
  assert.strictEqual(tree.nodes.length, rows.length, 'no row may be dropped')
  assert.strictEqual(tree.roots.length, 3, 'Device, ServoMotor and Loose are roots')
  const maxDepth = tree.order.reduce((max, node) => Math.max(max, node.depth), 0)
  assert.strictEqual(maxDepth, 3, 'device → Plc Logic → application → POU is four levels')
  const byName = new Map(tree.order.map((node) => [node.item.name, node]))
  assert.strictEqual(byName.get('PLC_PRG').parent.item.name, 'Application', 'the POU hangs off the application')
  assert.strictEqual(byName.get('NewPOU').parent.item.name, 'Application', 'an AI-created object attaches to its parentName')
  assert.strictEqual(byName.get('NewPOU').kind.category, 'code', 'a pending create is a code row')
  assert.strictEqual(byName.get('Library Manager').kind.kind, 'library-manager')
  assert.strictEqual(byName.get('ServoMotor').kind.kind, 'folder')
  const codeKeys = [...H.codesysTreeVisibleKeys(tree, 'code')]
  assert.strictEqual(codeKeys.length, 7, `the code filter keeps code rows plus their ancestors, got ${codeKeys.length}`)
  assert(codeKeys.includes('g-pou') && codeKeys.includes('g-app') && codeKeys.includes('g-dev'), 'ancestors stay visible')
  assert(!codeKeys.includes('g-lib') && !codeKeys.includes('g-folder') && !codeKeys.includes('g-loose'), 'non-code rows are filtered out')
  const deviceKeys = [...H.codesysTreeVisibleKeys(tree, 'device')]
  assert.strictEqual(deviceKeys.length, 6, `the device filter keeps the non-code rows, got ${deviceKeys.length}`)
  assert(deviceKeys.includes('g-lib') && deviceKeys.includes('g-folder'), 'library and folder rows belong to the non-code view')
  const states = H.codesysTreeChangeStates(tree, { 'g-pou': 'agent' }, new Set())
  assert.strictEqual(states.states.get('g-pou'), 'agent')
  assert.strictEqual(states.scopes.get('g-pou'), 'self')
  assert.strictEqual(states.states.get('g-dev'), 'agent', 'an ancestor must aggregate its descendants state')
  assert.strictEqual(states.scopes.get('g-dev'), 'subtree', 'an aggregated state must be marked as a subtree state')
  assert.strictEqual(states.states.get('g-gvl'), undefined, 'an unchanged sibling must stay unmarked')
  process.stdout.write('client tree helpers: classification, hierarchy, filter and change aggregation verified\n')
}

// --- 5. execute the emitted Python against fake CODESYS objects ------------
function findPython() {
  for (const candidate of [['python'], ['py', '-3'], ['python3']]) {
    const probe = spawnSync(candidate[0], [...candidate.slice(1), '--version'], { stdio: 'ignore' })
    if (probe.status === 0) return candidate
  }
  return null
}

function extractSnippets(script) {
  const helperStart = script.indexOf('def value_or(obj, name, default=None):')
  const helperEnd = script.indexOf('def find_one(project, name, guid=\'\', require_text=False):')
  // The tree walk now lives in a shared helper: the confirmed-write composite
  // (`apply-and-build`) calls this same code from inside the write's own CODESYS
  // process instead of paying a third ScriptEngine launch to refresh the tree. The
  // contract therefore executes the HELPER body, which is already at the 4-space
  // indent the harness wants, instead of a branch body that had to be re-indented.
  const walkFn = 'def collect_project_tree(project, result, inspect_started):'
  const walkStart = script.indexOf(walkFn)
  const walkEnd = script.indexOf('request = read_json(request_path)', walkStart)
  assert(helperStart > 0 && helperEnd > helperStart, 'the helper block must be findable in the emitted script')
  assert(walkStart > 0 && walkEnd > walkStart, 'the tree-walk helper must be findable in the emitted script')
  const walkBody = script.slice(walkStart + walkFn.length, walkEnd).replace(/^\n+/, '').replace(/\s+$/, '')
  return { helpers: script.slice(helperStart, helperEnd), inspect: walkBody }
}

function runContract() {
  verifyClientTree()
  const generated = require(enginePath).buildOfflineActionScript(path.join(os.tmpdir(), 'th-request.json'), path.join(os.tmpdir(), 'th-result.json'))
  const python = findPython()
  if (!python) {
    process.stdout.write('codesys project tree contract passed (Python unavailable: emitted-script execution skipped)\n')
    return
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-tree-'))
  const scriptFile = path.join(dir, 'offline-action.py')
  fs.writeFileSync(scriptFile, generated, 'utf8')
  const compile = spawnSync(python[0], [...python.slice(1), '-m', 'py_compile', scriptFile], { stdio: 'inherit' })
  assert.strictEqual(compile.status, 0, 'the emitted ScriptEngine Python must compile')

  const { helpers, inspect } = extractSnippets(generated)
  // The helper body is already indented for a function body, so it is used verbatim.
  const body = inspect
  const harness = [
    '# -*- coding: utf-8 -*-',
    // The real script imports time in its header (for the phase timings) before
    // the helper block this harness extracts.
    'import time',
    helpers,
    'class FakeObj(object):',
    '    def __init__(self, name, guid, type_guid="", children=None, **flags):',
    '        self.name = name',
    '        self.guid = guid',
    '        self.type = type_guid',
    '        self._children = list(children or [])',
    '        for key, value in flags.items(): setattr(self, key, value)',
    '    def get_name(self): return self.name',
    '    def get_children(self, recursive=False):',
    '        if not recursive: return list(self._children)',
    '        out = []',
    '        for child in self._children:',
    '            out.append(child)',
    '            out.extend(child.get_children(True))',
    '        return out',
    'class FakeProject(FakeObj):',
    '    def __init__(self, roots, orphan=None):',
    '        FakeObj.__init__(self, "Project", "g-project", "", roots)',
    '        self.path = "C:/fake/door.project"',
    '        self.dirty = False',
    '        self.active_application = roots[0]._children[0]._children[0]',
    '        self._orphan = list(orphan or [])',
    '    def get_children(self, recursive=False):',
    '        if not recursive: return list(self._children)',
    '        return list(self._children) + self._children[0].get_children(True) + self._orphan',
    'def run_inspect(project):',
    '    result = {}',
    "    action = 'inspect-project'",
    '    inspect_started = time.time()',
    body,
    '    return result',
    'DEVICE = "225bfe47-7336-4dbc-9419-4105a7c831fa"',
    'PLC_LOGIC = "40b404f9-e5dc-42c6-907f-c89f4a517386"',
    'APPLICATION = "639b491f-5557-464c-af91-1471bac9f549"',
    'LIBRARY = "adb5cb65-8e1d-4a00-b70a-375ea27582f3"',
    'POU = "6f9dac99-8de1-4efc-8465-68ac443b7d08"',
    'GVL = "ffbfa93a-b94d-45fc-a329-229860183b1d"',
    'pou = FakeObj("PLC_PRG", "g-pou", POU, None, has_textual_declaration=True, has_textual_implementation=True)',
    'gvl = FakeObj("GVL", "g-gvl", GVL, None, has_textual_declaration=True)',
    'library = FakeObj("Library Manager", "g-lib", LIBRARY, None, has_library_manager=True)',
    'application = FakeObj("Application", "g-app", APPLICATION, [library, pou, gvl], is_application=True)',
    'plc_logic = FakeObj("Plc Logic", "g-plc", PLC_LOGIC, [application])',
    'device = FakeObj("Device", "g-dev", DEVICE, [plc_logic])',
    'folder = FakeObj("ServoMotor", "g-folder", "738bea1e-99bb-4f04-90bb-a7a567e74e3a", None, is_folder=True)',
    '# Real projects report code objects at PROJECT scope while the IDE shows them',
    '# inside the application (they compile into it and tasks call them).',
    'orphan_pou = FakeObj("JogX", "g-jogx", POU, None, has_textual_declaration=True, has_textual_implementation=True)',
    '# CODESYS hides internal (__) objects and never shows a second Library Manager.',
    'internal_style = FakeObj("__VisualizationStyle", "g-style", "8e687a04-7ca7-42d3-be06-fcbda676c5ef", None)',
    'duplicate_lib = FakeObj("Library Manager", "g-lib-project", LIBRARY, None, has_library_manager=True)',
    'orphan = FakeObj("Loose_Object", "g-orphan", "ffffffff-ffff-ffff-ffff-ffffffffffff", None)',
    'project = FakeProject([device, folder, orphan_pou, internal_style, duplicate_lib], [orphan])',
    'result = run_inspect(project)',
    'rows = result["objects"]',
    'by_name = {}',
    'for row in rows: by_name.setdefault(row["name"], row)',
    'assert len(rows) == 11, "every object must be reported exactly once: %r" % sorted(by_name)',
    'assert result["objectCount"] == 11',
    'assert result["complete"] is True and result["textTruncated"] is False',
    'hierarchy = result["hierarchy"]',
    'assert hierarchy["roots"] == 3, hierarchy',
    'assert hierarchy["grouped"] == 10 and hierarchy["ungrouped"] == 1, hierarchy',
    'assert hierarchy["reparented"] == 1, hierarchy',
    'assert hierarchy["internal"] == 2, hierarchy',
    'assert by_name["Device"]["depth"] == 0 and by_name["Device"]["parentGuid"] == ""',
    'assert by_name["Plc Logic"]["depth"] == 1 and by_name["Plc Logic"]["parentGuid"] == "g-dev"',
    'assert by_name["Application"]["depth"] == 2 and by_name["Application"]["parentGuid"] == "g-plc"',
    'assert by_name["Library Manager"]["depth"] == 3 and by_name["Library Manager"]["parentGuid"] == "g-app"',
    'assert by_name["PLC_PRG"]["depth"] == 3 and by_name["PLC_PRG"]["parentName"] == "Application"',
    'assert by_name["PLC_PRG"]["path"] == ["Device", "Plc Logic", "Application", "PLC_PRG"], by_name["PLC_PRG"]["path"]',
    'assert by_name["PLC_PRG"]["hasChildren"] is False and by_name["Device"]["hasChildren"] is True',
    'assert by_name["GVL"]["type"] == GVL and by_name["Library Manager"]["hasLibraryManager"] is True',
    '# A project-scope POU lands under the application instead of at the root.',
    'assert by_name["JogX"]["reparented"] is True, by_name["JogX"]',
    'assert by_name["JogX"]["parentGuid"] == "g-app" and by_name["JogX"]["depth"] == 3, by_name["JogX"]',
    'assert by_name["JogX"]["path"] == ["Device", "Plc Logic", "Application", "JogX"], by_name["JogX"]["path"]',
    '# Internal and duplicate project objects are marked, not shown as extra roots.',
    'assert by_name["__VisualizationStyle"]["internal"] is True, by_name["__VisualizationStyle"]',
    'assert by_name["Library Manager"].get("internal") is not True, "the application-owned Library Manager stays visible"',
    'assert [row for row in rows if row["name"] == "Library Manager" and row.get("internal")][0]["internalReason"] == "duplicate-of-Application", rows',
    'assert by_name["Loose_Object"]["ungrouped"] is True and by_name["Loose_Object"]["depth"] == 0',
    'assert by_name["Loose_Object"]["parentGuid"] == "" and by_name["Loose_Object"].get("internal") is not True',
    'assert by_name["ServoMotor"]["isFolder"] is True and by_name["ServoMotor"]["depth"] == 0',
    'assert result["project"]["activeApplication"] == "Application", result["project"]',
    'print("emitted ScriptEngine walk: hierarchy and coverage verified")',
  ].join('\n')
  const harnessFile = path.join(dir, 'tree-harness.py')
  fs.writeFileSync(harnessFile, harness, 'utf8')
  const run = spawnSync(python[0], [...python.slice(1), harnessFile], { stdio: 'inherit' })
  assert.strictEqual(run.status, 0, 'the emitted walk must produce the real hierarchy')

  process.stdout.write('codesys project tree contract passed (engine walk executed + client tree asserted)\n')
}

runContract()
