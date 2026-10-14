'use strict'

// 本轮 B 项（**冻结**）契约。用户拍板的规则原话：
//   「开启在线值后会把原来的代码编辑区给覆盖掉，变成一片白和监控过来的值；登录应该是这个
//     逻辑，登录之后就不允许修改代码，只可以查看在线变量」
//   「同意，**ai写入和手动写入都禁止，编辑栏直接被冻结**」
//
// 所以：**已登录到应用**（`state.isLoggedIn === true`）时，写入工程这条通路整体关闭 ——
// 两层都有，缺一不可（"按钮灰掉"不算闸门）：
//
//   ① UI 层（真跑 CodesysWorkbench 组件，见 lib/workbench-driver）
//      · 编辑栏 `readOnly`：程序化输入也不改内容、**不产生草稿**；
//      · 「确认写入」禁用 + **一行**原因与出路（不许静默）；直接触发它的 onClick 也不写；
//      · 抽屉那条「确认写入工程」的能力面（`window.__TASKHIVE_CODESYS_CAPABILITIES__.apply`）
//        同样被拒，理由可读 —— 那是 AI 写入的入口；
//      · 只读查看不受影响：**已登录就自动**在每个变量后面有值（本轮用户规则原文：
//        「把在线值开关去除，登录后默认在线值开启」—— 原来那枚「在线值」开关已整段删除，
//        所以"看值"这件事不再需要（也不再有）任何点击）；
//      · **未登录**（含"只连上设备、没登录应用"）时一切照旧：可编辑、产生草稿、不冻结。
//
//   ② 引擎/宿主层（真跑 CodesysScriptEngine，进程接缝可数）
//      · 已登录 ⇒ 写类动作（MUTATING + rollback）被**引擎**拒绝，code=ONLINE_WRITE_FROZEN，
//        可读原因 + 出路；CODESYS 进程启动 **0** 次、job 日志里 apply-and-build **0** 条；
//      · 读类动作（inspect/diff/build/build-status）连在线状态都不问，一步不多走；
//      · status 读失败**不解除**冻结（"读不到"不等于"没登录"）；
//      · 退出登录 ⇒ 同一次写入立刻成功落盘（未登录语义完全不变）。
//
// 未登录时既有安全语义（sha 三态守卫 / 写前快照 / 原子提交 / per-job 互斥 / 用户点击）
// 由各自的既有契约继续钉住，这一条只加冻结，不动它们。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createWorkbenchDriver } = require('./lib/workbench-driver')
const { createTempDir } = require('./lib/temp-dir')
const { CodesysScriptEngine, ONLINE_WRITE_FROZEN_ACTIONS, ONLINE_WRITE_FROZEN_CODE } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const FROZEN_DETAIL = '在线状态下不允许写入工程；如需修改请先退出登录（面板在线区「退出登录」）。'

const DECLARATION = [
  'PROGRAM PLC_PRG',
  'VAR',
  '  startMove : BOOL;',
  '  iAxis : INT;',
  'END_VAR',
].join('\n')
const IMPLEMENTATION = [
  'IF startMove THEN',
  '  iAxis := 1;',
  'END_IF',
].join('\n')

const OBJECTS = [
  {
    name: 'PLC_PRG',
    guid: 'guid-plc-prg',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration: DECLARATION,
    implementation: IMPLEMENTATION,
    path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
  },
]

const MONITOR_EXPRESSIONS = ['startMove', 'iAxis']
const MONITOR_VALUES = ['TRUE', 'INT#7']

// 真机帧形状（见 codesys-inline-online-values-behaviour.js 的同名 fixture）。
function onlineStatus (state = {}) {
  return {
    ok: true,
    running: true,
    ready: { deviceName: 'GCAN-PLC-521C' },
    state: {
      connected: true,
      isLoggedIn: false,
      loginMode: '',
      applicationState: 'stop (2)',
      applicationStateLabel: '已停止（STOP）',
      ...state,
    },
  }
}

function editableRunning () {
  return onlineStatus({ connected: false, running: true, state: { connected: false, isLoggedIn: false } })
}

function createDriver (status) {
  const monitorCalls = []
  const driver = createWorkbenchDriver({
    objects: JSON.parse(JSON.stringify(OBJECTS)),
    onlineStatus: status,
    taskhive: {
      monitorCodesysOnline: async (input) => {
        monitorCalls.push(input)
        return {
          ok: true,
          applicationState: 'stop (2)',
          expressions: MONITOR_EXPRESSIONS,
          values: MONITOR_VALUES,
          partial: true,
          readMode: 'per-expression',
        }
      },
    },
  })
  return { driver, monitorCalls }
}

function kids (node) {
  return Array.isArray(node.children) ? node.children : (node.children === undefined || node.children === null ? [] : [node.children])
}

function textOf (node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  return kids(node).map(textOf).join('')
}

// 打开工作台并选中那个对象（真跑组件，只能用它自己的 handler）。
async function openWorkbench (driver) {
  await driver.settle()
  driver.clickTreeRow('PLC_PRG')
  await driver.settle()
}

function editorNode (driver, part) {
  return driver.find((props) => props['data-editor-part'] === part)
}

function confirmNode (driver) {
  return driver.find((props) => props['data-codesys-confirm-write'] === 'true')
}

function writeReason (driver) {
  const node = driver.find((props) => props['data-codesys-write-reason'] === 'true')
  return node ? textOf(node) : null
}

function writeStateWord (driver) {
  const node = driver.find((props) => props['data-codesys-write-state'] === 'true')
  return node ? textOf(node) : null
}

function capabilitySeam (driver) {
  return driver.scene.window.__TASKHIVE_CODESYS_CAPABILITIES__ || null
}

function mutatingCalls (driver) {
  return driver.ipcCalls.map((call) => call.action).filter((action) => ONLINE_WRITE_FROZEN_ACTIONS.has(action))
}

// ── ① 已登录：编辑栏只读、不产生草稿、值仍可看 ───────────────────────────────
async function uiFrozen () {
  const { driver } = createDriver(onlineStatus({ isLoggedIn: true, loginMode: 'keep' }))
  await openWorkbench(driver)

  const beforeDeclaration = driver.editorValue('declaration')
  const beforeChangeState = driver.treeChangeState('PLC_PRG')
  const editor = editorNode(driver, 'declaration')
  assert(editor, 'the declaration editor must exist')
  assert.strictEqual(editor.props.readOnly, true, 'logged in, the code editor must be read-only')
  assert.strictEqual(editor.props['data-editor-readonly'], 'true', 'and it must say so for a probe')
  assert.strictEqual(editor.props['aria-readonly'], 'true', 'and for a screen reader')
  assert(String(editor.props['aria-label']).includes('只读'), 'the accessible name must say it is read-only')

  // 程序化输入（等价于用户打字）：内容不动、不产生草稿。
  const seam = capabilitySeam(driver)
  assert(seam && typeof seam.apply === 'function', 'the drawer capability seam must be installed')
  const draftsBefore = Number(seam.read().draftCount || 0)
  driver.typeInEditor('declaration', `${DECLARATION}\n(* 我手打的一行：在线时不该被接受 *)`)
  driver.typeInEditor('implementation', 'iAxis := 99;')
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), beforeDeclaration,
    'while frozen, typing must not change the declaration (readOnly + the handler guard)')
  assert.strictEqual(driver.editorValue('implementation'), IMPLEMENTATION,
    'while frozen, typing must not change the implementation either')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), beforeChangeState,
    'and no draft may be produced (the tree row must not turn into a manual edit)')
  assert.strictEqual(Number(seam.read().draftCount || 0), draftsBefore,
    'the draft store must be untouched by a frozen editing attempt')
  assert.strictEqual(mutatingCalls(driver).length, 0, 'a frozen editing attempt may not reach a mutating action')
  console.log('[自测③] 已登录 ⇒ 编辑栏 readOnly（readOnly=true / data-editor-readonly=true / aria-readonly=true）；'
    + `模拟输入后声明仍是 ${beforeDeclaration.split('\n').length} 行原文、树状态仍是 ${JSON.stringify(beforeChangeState)}、`
    + `草稿数 ${draftsBefore} → ${Number(seam.read().draftCount || 0)}）✓`)

  // ── ② 只读查看不受影响：已登录就自动每个变量后面有值（无需任何点击）────────────
  // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）按**意图**更新了这一条：
  // 原来这里先找那枚开关、点开它，再断言镜像层出现。开关整段删除了，所以判据变成**更强**的
  // 一条：值**自动**出现 —— 不点任何东西，镜像层就已经在画；而且全局断言那枚开关**不存在**
  // （DOM 里既没有 data-codesys-online-values-toggle，也没有它的旧文案）。
  assert.strictEqual(driver.find((props) => props['data-codesys-online-values-toggle'] !== undefined), null,
    'the 「在线值」 switch must not exist anywhere in the rendered workbench')
  assert.strictEqual(driver.find((props) => props['data-editor-online'] !== undefined), null,
    'and neither may its live light (data-editor-online)')
  assert.strictEqual(driver.findAll((props) => String(props.className || '').includes('taskhive-codesys-editor-online')).length, 0,
    'nor any element carrying the deleted switch\'s class')
  for (let i = 0; i < 6 && !driver.find((props) => props['data-codesys-inline-online'] === 'declaration'); i += 1) {
    driver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    driver.render()
  }
  const overlay = driver.find((props) => props['data-codesys-inline-online'] === 'declaration')
  assert(overlay, 'logged in, the mirror must appear on its own (values are still viewable while frozen)')
  const overlayText = textOf(overlay)
  assert(overlayText.includes('TRUE') && overlayText.includes('7'),
    `the observed values must be visible in place (saw ${JSON.stringify(overlayText)})`)
  console.log('[自测④] 冻结只禁写入：那枚「在线值」开关在 DOM 里**不存在**（marker/绿灯/class 全 0），'
    + `而镜像层不用点任何东西就已经把每个变量的值画在代码流里（${JSON.stringify(overlayText.slice(0, 80))}…）✓`)

  // ── ③ 「确认写入」禁用 + 一行原因与出路；直接触发 onClick 也一个字节都不写 ──
  const confirm = confirmNode(driver)
  assert(confirm, 'the confirm-write control must still exist (nothing may silently disappear)')
  assert.strictEqual(confirm.props.disabled, true, 'logged in, the confirmed write must be DISABLED')
  assert.strictEqual(confirm.props['data-codesys-write-frozen'], 'true', 'and it must expose the frozen state')
  assert(String(confirm.props.title).includes('在线状态下不允许写入工程') && String(confirm.props.title).includes('退出登录'),
    'the disabled control must say WHY and name the way out (never silent)')
  // 本轮（写入行抽屉化）按**意图**只把那个词说得更准：冻结那一档从「已冻结」改成
  // 「在线已冻结」（**仍然包含**原来的词），所以这里的判据是"包含 + 逐字等于新词" ——
  // 比原来那条 `=== '已冻结'` 更严（旧断言在新词上照样会绿，那才是假绿）。
  assert(/已冻结/.test(String(writeStateWord(driver))), 'the one-line write bar must still say 已冻结')
  assert.strictEqual(writeStateWord(driver), '在线已冻结', 'the one-line write bar must say 在线已冻结 (which freeze)')
  assert.strictEqual(writeReason(driver), FROZEN_DETAIL, 'and carry the single readable reason + way out')

  const beforeCalls = driver.ipcCalls.length
  confirm.props.onClick() // 最坏情况：按钮的"禁用"没生效，点击照样到达 handler
  await driver.settle()
  const written = driver.ipcCalls.slice(beforeCalls).map((call) => call.action)
  assert(!written.includes('apply-and-build') && !written.includes('apply-changes'),
    `even a forced click may not write while frozen (saw ${JSON.stringify(written)})`)
  assert.strictEqual(mutatingCalls(driver).length, 0, 'no mutating action may appear anywhere in the frozen flow')
  assert(String(driver.statusText() || '').includes('在线状态下不允许写入工程'),
    `the refusal must be explained in the status line, not swallowed (saw ${JSON.stringify(driver.statusText())})`)
  console.log('[自测④] 已登录 ⇒ 「确认写入」disabled=true · title/详情行 = '
    + `${JSON.stringify(FROZEN_DETAIL)} · 强行触发 onClick 后 apply-and-build/apply-changes 均 0 次、`
    + `状态行如实说明 ✓`)
  return { driver }
}

// ── ④ AI 写入入口（抽屉能力面）也被拒，理由可读 ─────────────────────────────
async function drawerApplyFrozen () {
  const { driver } = createDriver(onlineStatus({ isLoggedIn: true, loginMode: 'keep' }))
  await openWorkbench(driver)
  const seam = capabilitySeam(driver)
  const read = seam.read()
  assert.strictEqual(read.gate.onlineWriteFrozen, true, 'the published gate must tell the drawer it is frozen')
  assert.strictEqual(read.gate.frozenDetail, FROZEN_DETAIL, 'and hand it the single readable reason')
  assert.strictEqual(read.blockReason, FROZEN_DETAIL, 'the block reason the drawer prints must be that reason')
  const result = await seam.apply({ proposalSignature: read.signature })
  assert(result && result.ok !== true, 'the drawer apply path must be refused while frozen')
  assert.strictEqual(result.reason, 'online-write-frozen', 'with its own structured reason')
  assert(String(result.detail || '').includes('退出登录'), 'and the way out in the readable detail')
  assert.strictEqual(mutatingCalls(driver).length, 0, 'the drawer refusal must not reach the engine')
  console.log(`[自测④] AI 写入入口：gate.onlineWriteFrozen=true · blockReason=${JSON.stringify(read.blockReason)} ·`
    + ` seam.apply() → ${JSON.stringify(result)}（apply-and-build 0 次）✓`)
}

// ── ⑤ 未登录（含"只连上设备、没登录应用"）⇒ 一切照旧 ────────────────────────
async function unfrozenUnchanged () {
  for (const [label, status] of [
    ['未登录', editableRunning()],
    ['已连接但未登录应用', onlineStatus({ connected: true, isLoggedIn: false, loginMode: '' })],
  ]) {
    const { driver } = createDriver(status)
    await openWorkbench(driver)
    const editor = editorNode(driver, 'declaration')
    assert.notStrictEqual(editor.props.readOnly, true, `${label}: the editor must stay editable`)
    assert.strictEqual(editor.props['data-editor-readonly'], 'false', `${label}: and must say so`)
    // 本轮（写入行抽屉化）按**意图**更新了这一条：空闲时那一行**根本不存在**（用户口径），
    // 所以"确认写入常驻在屏幕上"这句话不再成立 —— 换成更严的一条：空闲 ⇒ 行与状态词都不在；
    // 只要真的有待写入内容（下面几行就会打进去），行与「确认写入」必须立刻回来，而且**未冻结**。
    // 冻结判据本身一条都没少（data-codesys-write-frozen / 状态词 / title 三项还在，只是挪到
    // "有待写入内容"那一帧上断言）。
    assert.strictEqual(confirmNode(driver), null, `${label}: idle ⇒ the write row (and its confirm control) must not exist at all`)
    assert.strictEqual(writeStateWord(driver), null, `${label}: and no write state word may be on screen while idle`)
    const seam = capabilitySeam(driver)
    assert.strictEqual(seam.read().gate.onlineWriteFrozen, false, `${label}: the published gate must not claim a freeze`)
    // 可编辑 + 会产生草稿（既有语义）。
    const edited = `${DECLARATION}\n(* ${label}：这行必须能打进去 *)`
    driver.typeInEditor('declaration', edited)
    await driver.settle()
    assert.strictEqual(driver.editorValue('declaration'), edited, `${label}: typing must still work`)
    assert.strictEqual(driver.treeChangeState('PLC_PRG'), 'manual',
      `${label}: an unwritten edit must still be marked as a manual draft on the tree row`)
    const confirm = confirmNode(driver)
    assert(confirm, `${label}: with an unwritten draft the write row (and its confirm control) must come back`)
    assert.strictEqual(confirm.props['data-codesys-write-frozen'], 'false', `${label}: the write must not be frozen`)
    assert(!/冻结/.test(String(writeStateWord(driver))), `${label}: the write bar must keep its normal wording`)
    assert(!String(confirm.props.title).includes('在线状态下不允许写入工程'),
      `${label}: the confirm control must keep its normal title`)
    console.log(`[自测⑤] ${label}：readOnly=false · 可编辑（树标记 ${JSON.stringify(driver.treeChangeState('PLC_PRG'))}）·`
      + ' 写入闸门未冻结 ✓')
  }
}

// ── ⑥ 引擎/宿主层：已登录 ⇒ 写类动作被拒（0 次进程 / 0 条 apply-and-build）────
function createEngine (root, state) {
  // 进程接缝：任何一次真的把 CODESYS 拉起来都会被记账 —— 所以"0 次"是可观测的事实。
  const engine = new CodesysScriptEngine(root, {
    runProcess: async (_exePath, args) => {
      state.starts += 1
      const scriptArg = String((args || []).find((item) => String(item).startsWith('--runscript=')) || '')
      const scriptPath = scriptArg.slice('--runscript='.length).replace(/^"|"$/g, '')
      const script = fs.readFileSync(scriptPath, 'utf8')
      const requestPath = JSON.parse(script.match(/request_path = ("(?:[^"\\]|\\.)*")/)[1])
      const resultPath = JSON.parse(script.match(/result_path = ("(?:[^"\\]|\\.)*")/)[1])
      const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
      if (request.projectPath) fs.appendFileSync(request.projectPath, `\n# codesys save ${state.starts}\n`)
      fs.writeFileSync(resultPath, JSON.stringify({
        ok: true,
        action: request.action,
        projectPath: request.projectPath,
        applied: (request.changes || []).map((change) => ({ operation: change.operation, object: { name: change.objectName, guid: 'g-pou' } })),
        changeCount: (request.changes || []).length,
        applyCommitted: true,
        messages: [],
        errorCount: 0,
        warningCount: 0,
        phaseMs: { openMs: 1, applyMs: 1, saveMs: 1, buildMs: 1, treeMs: 1, totalMs: 5 },
        serviceMs: 6,
      }), 'utf8')
      return { stdout: Buffer.from(''), stderr: Buffer.from('') }
    },
  })
  engine.doctor = () => ({ ready: true, exePath: 'C:\\fake\\CODESYS.exe', profile: 'fake' })
  return engine
}

async function engineFreeze () {
  const root = createTempDir('taskhive-online-freeze-')
  try {
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
    const source = path.join(root, 'source.project')
    fs.writeFileSync(source, 'fixture-project-bytes')
    const state = { starts: 0 }
    const engine = createEngine(root, state)
    const bound = engine.bindProject({ sourcePath: source })
    assert(bound && bound.jobId, 'the freeze test needs a bound job')
    const CHANGES = [{ operation: 'update-text', objectName: 'PLC_PRG', declaration: 'PROGRAM PLC_PRG', implementation: 'iAxis := 1;' }]

    // 已登录到应用：每一个写类动作都被拒，而且**一次 CODESYS 进程都没有起来**。
    const statusQueries = []
    engine.onlineSession = {
      running: true,
      stop: async () => ({ stopped: true }),
      send: async (command) => { statusQueries.push(command); return { connected: true, isLoggedIn: true, loginMode: 'keep' }; },
    }
    for (const action of [...ONLINE_WRITE_FROZEN_ACTIONS]) {
      let error = null
      try { await engine.execute(action, { jobId: bound.jobId, changes: CHANGES, confirmed: true }) } catch (caught) { error = caught }
      assert(error, `while logged in, ${action} must be refused by the ENGINE — a greyed-out button is not a gate`)
      assert.strictEqual(error.code, ONLINE_WRITE_FROZEN_CODE, `${action} must be refused with the structured code`)
      assert(String(error.message).includes('在线状态下不允许写入工程') && String(error.message).includes('退出登录'),
        `${action} must carry a readable reason AND the way out (got "${error.message}")`)
      assert(String(error.message).includes(action), `${action} must be named in its own refusal`)
    }
    assert.strictEqual(state.starts, 0, 'a refused write must not start a single CODESYS process')
    assert(!engine.readJob(bound.jobId).job.actions.some((item) => item.action === 'apply-and-build'),
      'the composite write must appear 0 times in the job action log')
    // 读类动作不受影响：它们连在线状态都不问（未登录/已登录的既有语义都不动）。
    assert.deepStrictEqual(await engine.assertOnlineWriteAllowed('inspect-project'), { frozen: false, checked: false },
      'read-only actions must not even query the online session')
    assert.deepStrictEqual(await engine.assertOnlineWriteAllowed('build'), { frozen: false, checked: false },
      'compiling an isolated copy is not a project write, so it must stay ungated')
    assert.strictEqual(statusQueries.length, ONLINE_WRITE_FROZEN_ACTIONS.size,
      'exactly the write actions may query the session status (one query each)')
    // 在线区的面板操作（登录/退出/下载/启停/Force）**不在冻结范围内** —— 那是用户自己的显式
    // 控制。用一次"没有授权标记的 logout"证明：引擎仍然按**它自己的**规则拒绝
    // （CODESYS_ONLINE_NOT_ARMED），而不是被冻结拦下（ONLINE_WRITE_FROZEN）。
    let onlineError = null
    try { await engine.execute('online-logout', { jobId: bound.jobId }) } catch (caught) { onlineError = caught }
    assert(onlineError && onlineError.code === 'CODESYS_ONLINE_NOT_ARMED',
      `the panel's own online actions must keep their own gate while frozen (got ${onlineError && onlineError.code})`)
    for (const action of ['online-login', 'online-logout', 'online-download', 'online-start', 'online-stop', 'online-reset', 'online-write', 'online-force', 'online-unforce']) {
      assert(!ONLINE_WRITE_FROZEN_ACTIONS.has(action),
        `${action} is the operator's own explicit control and must never be frozen`)
    }
    console.log(`[自测④] 引擎层：已登录 ⇒ ${ONLINE_WRITE_FROZEN_ACTIONS.size} 个写类动作全部被拒`
      + `（code=${ONLINE_WRITE_FROZEN_CODE}）· CODESYS 进程启动 ${state.starts} 次 · job 日志里 apply-and-build `
      + `${engine.readJob(bound.jobId).job.actions.filter((item) => item.action === 'apply-and-build').length} 条 ·`
      + ` 读类动作查询在线状态 ${0} 次（合计查询 ${statusQueries.length} 次 = 写类动作数）✓`)

    // 「读不到登录状态」不许被当成"没登录"：否则一次超时就是绕过冻结的窗口。
    engine.onlineSession.send = async () => { throw new Error('worker busy') }
    let blindError = null
    try { await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true }) } catch (caught) { blindError = caught }
    assert(blindError && blindError.code === ONLINE_WRITE_FROZEN_CODE,
      'a failed status read must KEEP the freeze: "cannot read it" is not "not logged in"')

    // 退出登录（worker 如实回报 isLoggedIn:false）⇒ 写路径立刻回到既有语义：真的写进去一次。
    engine.onlineSession.send = async () => ({ connected: true, isLoggedIn: false, loginMode: '' })
    const write = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true })
    assert(write && write.ok === true, 'once logged out the very same write must go through again (no regression)')
    assert(state.starts >= 1, 'the logged-out write must really run the engine')
    assert(engine.readJob(bound.jobId).job.actions.some((item) => item.action === 'apply-and-build'),
      'and it must be recorded in the job action log (the freeze did not become a permanent block)')
    console.log(`[自测⑤] 退出登录 ⇒ 同一次 apply-and-build 成功落盘（进程启动 ${state.starts} 次、`
      + 'job 日志里有记录）· status 读失败时仍然拒绝 ✓')

    // 会话停掉 = 未登录：冻结立刻解除，而且一次 status 都不再问。
    await engine.stopOnlineSession('contract')
    assert.deepStrictEqual(await engine.onlineWriteFreeze(), { running: false, loggedIn: false, frozen: false },
      'no online session must mean "not frozen", with no query at all')
    return { starts: state.starts }
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

async function main () {
  await uiFrozen()
  await drawerApplyFrozen()
  await unfrozenUnchanged()
  const engine = await engineFreeze()
  console.log(`[自测⑥] 冻结总结：UI 层（只读 + 禁用 + 一行原因/出路 + 抽屉拒绝）与引擎层`
    + `（ONLINE_WRITE_FROZEN，0 次进程）都在；未登录时全部照旧（含"只连设备没登录应用"）✓`
    + `（引擎在解除冻结后写入了 ${engine.starts} 次）`)
  console.log('codesys online write freeze contract passed')
}

main().then(() => {
  process.exit(0)
}).catch((error) => {
  console.error(`codesys online write freeze contract failed: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
