'use strict'

// 本轮（写入状态行抽屉化）契约。用户口径原文：
//   「把「写入 · 等待 AI 改动」那一行改成抽屉式，只在需要时出现」
//   「空闲时这一行根本不存在（界面零文字）；需要时才出现一个紧凑把手，点开看细节」
//
// 出场条件（四件事之一为真）：有待确认提案 / 正在写入 / 在线已冻结（T217）/ 上次写入或编译失败。
// 其余情况**不渲染**。把手文案一行：写入 · N 项待确认 / 写入 · 在线已冻结 / 写入 · 写入中 /
// 写入 · 上次写入失败（外加编译失败那一档）。展开只由用户点击驱动：默认收起、绝不自动展开、
// 再点收起；不再需要时整行消失。
//
// 只动展示层：「确认写入 / 放弃 / 已核对」仍留在这一行里（位置与行为不变，冻结时禁用 + 同一行
// 原因），抽屉的展开/收起本身**一个 IPC 都不发**，MUTATING 仍然是 0；写入仍然只在用户点击
// 「确认写入」之后发生，冻结语义一个字都没动。
//
// 这一条真跑 `CodesysWorkbench` 组件（tests/lib/workbench-driver）与真引擎常量表，
// 不是 grep 源码。源码形状那一半（条件渲染 / hidden / 宽度中性）在
// codesys-workbench-compact-layout-contract.js 的 9b 段。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createWorkbenchDriver, clientFile } = require('./lib/workbench-driver')
const { ONLINE_WRITE_FROZEN_ACTIONS } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const FROZEN_DETAIL = '在线状态下不允许写入工程；如需修改请先退出登录（面板在线区「退出登录」）。'
const JOB_ID = 'drawer-job-1'
const SOURCE_PATH = 'C:/projects/demo.project'

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
const TYPED_DECLARATION = DECLARATION.replace('  iAxis : INT;', '  iAxis : INT; (* 用户手打的一行 *)')

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

const onlineStatus = (state = {}) => ({
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
})

// ── helpers ────────────────────────────────────────────────────────────────────
function kids (node) {
  return Array.isArray(node.children) ? node.children : (node.children === undefined || node.children === null ? [] : [node.children])
}
function textOf (node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  return kids(node).map(textOf).join('')
}
const row = (driver) => driver.find((props) => props['data-codesys-commandbar'] === 'true')
const handle = (driver) => driver.find((props) => props['data-codesys-write-handle'] === 'true')
const stateWordNode = (driver) => driver.find((props) => props['data-codesys-write-state'] === 'true')
const reasonNode = (driver) => driver.find((props) => props['data-codesys-write-reason'] === 'true')
const drawerBody = (driver) => driver.find((props) => props['data-codesys-write-drawer-body'] !== undefined)
const confirmNode = (driver) => driver.find((props) => props['data-codesys-confirm-write'] === 'true')
const discardNode = (driver) => driver.find((props) => props['data-codesys-discard-proposal'] === 'true')
const reviewNode = (driver) => driver.find((props) => props['data-codesys-review-accepted'] === 'true')
const stateWord = (driver) => (stateWordNode(driver) ? textOf(stateWordNode(driver)) : null)
const drawerText = (driver) => {
  const body = drawerBody(driver)
  return body ? textOf(body) : null
}
const drawerLine = (driver, marker) => {
  const node = driver.find((props) => props[marker] === 'true')
  return node ? textOf(node) : null
}
const wholeText = (driver) => textOf(driver.nodes()[0])
const mutatingActions = (calls) => calls.map((call) => call.action).filter((action) => ONLINE_WRITE_FROZEN_ACTIONS.has(action))

// 引擎替身：形状照抄 driver 的默认实现，只把要演的某一件事换掉（组件看到的是同一条 API）。
// 写入那一趟必须连同 **sha 三态守卫**一起满足（既有安全语义）：`bind-project` 给基线，
// `diff` 报"磁盘没被动过"，`apply-and-build` 推进磁盘 sha 并回报新 sha。缺了 `diff` 那一步，
// 工作台会以为"无法确认工程没被外部改过"并弹出确认对话框 —— 那不是本契约要演的场景。
const BASELINE_SHA = 'a'.repeat(64)
const AFTER_WRITE_SHA = 'b'.repeat(64)

function applyWrite (state, objects, input) {
  state.diskSha = AFTER_WRITE_SHA
  // 真的把改动落到替身工程上：写完之后重读回来的必须是**写进去的那份文本**，否则
  // "磁盘上的旧文本 vs 编辑器里的手打文本"看起来还是一处待写入改动（那是替身不真实，不是组件错）。
  for (const change of input?.changes || []) {
    const target = objects.find((item) => String(item.guid || '').toLowerCase() === String(change?.objectGuid || '').toLowerCase())
    if (!target) continue
    if (typeof change.declaration === 'string') target.declaration = change.declaration
    if (typeof change.implementation === 'string') target.implementation = change.implementation
  }
  return {
    ok: true,
    status: 'complete',
    currentSha256: AFTER_WRITE_SHA,
    payload: {
      complete: true,
      textTruncated: false,
      objects: JSON.parse(JSON.stringify(objects)),
      messages: [],
      errorCount: 0,
      warningCount: 0,
      changeCount: 1,
    },
  }
}

function engineStub (objects, overrides = {}) {
  const calls = []
  const state = { diskSha: BASELINE_SHA }
  const run = async (action, input) => {
    calls.push({ action, input })
    if (typeof overrides[action] === 'function') return overrides[action](input, state)
    if (action === 'bind-project') return { sourcePath: SOURCE_PATH, jobId: JOB_ID, writeAvailable: true, writeBlockReason: '', baselineSha256: BASELINE_SHA }
    if (action === 'inspect-project') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(objects)) } }
    if (action === 'diff') return { ok: true, action: 'diff', jobId: JOB_ID, currentSha256: state.diskSha, baselineSha256: BASELINE_SHA, changed: state.diskSha !== BASELINE_SHA }
    if (action === 'apply-and-build') return applyWrite(state, objects, input)
    return { status: 'complete', payload: {} }
  }
  return { calls, run }
}

function createDriver (options = {}) {
  const objects = JSON.parse(JSON.stringify(OBJECTS))
  const stub = options.stub || null
  const driver = createWorkbenchDriver({
    objects,
    sourcePath: SOURCE_PATH,
    jobId: JOB_ID,
    onlineStatus: options.onlineStatus || { ok: true, running: false },
    ...(stub ? { taskhive: { runCodesysScriptEngineAction: stub.run } } : {}),
  })
  return { driver, objects, calls: stub ? stub.calls : driver.ipcCalls }
}

async function typeDraft (driver) {
  driver.typeInEditor('declaration', TYPED_DECLARATION)
  await driver.settle()
}

async function acceptReview (driver) {
  const review = reviewNode(driver)
  assert(review, '有待写入内容时「已核对」必须在（写入闸门没变）')
  review.props.onChange({ target: { checked: true } })
  await driver.settle()
}

// ── ① 空闲 ⇒ 那一行根本不存在（DOM 断言 + 零文字）──────────────────────────────
async function idleRowDoesNotExist () {
  const { driver, calls } = createDriver()
  await driver.settle()

  assert.strictEqual(row(driver), null, '空闲时命令条（写入那一行）根本不存在')
  assert.strictEqual(handle(driver), null, '空闲时没有把手')
  assert.strictEqual(stateWordNode(driver), null, '空闲时没有状态词')
  assert.strictEqual(reasonNode(driver), null, '空闲时没有原因文字')
  assert.strictEqual(confirmNode(driver), null, '空闲时没有「确认写入」')
  assert.strictEqual(discardNode(driver), null, '空闲时没有「放弃」')
  assert.strictEqual(drawerBody(driver), null, '空闲时连收起的细节块都不在 DOM 里')

  const text = wholeText(driver)
  for (const forbidden of ['等待 AI 改动', '项待确认', '在线已冻结', '写入中', '上次写入失败']) {
    assert(!text.includes(forbidden), `空闲时界面上不许出现「${forbidden}」（那一行零文字）`)
  }
  assert.strictEqual(mutatingActions(calls).length, 0, '渲染/空闲状态一个 MUTATING 动作都不许有')
  console.log('[自测①] 空闲 ⇒ 命令条/把手/状态词/确认写入/放弃/细节块全部不在 DOM 里；'
    + `整棵树的文字里没有「等待 AI 改动 / 项待确认 / 在线已冻结 / 写入中 / 上次写入失败」；MUTATING 0 ✓`)
  driver.unmount()
}

// ── ② / ③ 有提案 ⇒ 出现把手 + 「1 项待确认」+ 默认收起；点开见细节，再点收起 ──────
async function proposalHandleToggles () {
  const { driver, calls } = createDriver()
  await driver.settle()
  await typeDraft(driver)

  const beforeOpenValue = driver.editorValue('declaration')
  const openHandle = handle(driver)
  assert(openHandle, '有待写入内容 ⇒ 把手必须出现')
  assert.strictEqual(stateWord(driver), '1 项待确认', '把手文案必须是「1 项待确认」（用户口径的写法）')
  assert.strictEqual(textOf(openHandle).includes('写入'), true, '把手读作「写入 · …」')
  assert.strictEqual(openHandle.props['aria-expanded'], 'false', '默认必须是**收起**的')
  assert.strictEqual(openHandle.props['data-codesys-write-handle'], 'true', '把手要有可探测标记')
  const body = drawerBody(driver)
  assert(body, '细节块渲染出来了（但收起）')
  assert.strictEqual(body.props.hidden, true, '默认收起：细节块 hidden')
  assert.strictEqual(body.props['data-codesys-write-drawer-body'], 'closed', '默认收起：细节块标记为 closed')
  assert.strictEqual(row(driver).props['data-codesys-write-drawer'], 'closed', '命令条自身也标着收起')

  // 「确认写入 / 放弃 / 已核对」仍留在这一行里（位置与行为不变）。
  assert(confirmNode(driver), '「确认写入」仍在这一行里')
  assert(discardNode(driver), '「放弃」仍在这一行里（有待放弃内容）')
  assert(reviewNode(driver), '「已核对」仍在这一行里')
  assert.strictEqual(discardNode(driver).props.disabled, false, '「放弃」不受写入闸门约束（行为不变）')
  assert.strictEqual(confirmNode(driver).props.disabled, true, '还没勾「已核对」时「确认写入」禁用（行为不变）')

  // MUTATING 0：展开/收起本身一个 IPC 都不发，也不动用户手打的字。
  const ipcBefore = calls.length
  openHandle.props.onClick()
  await driver.settle()
  assert.strictEqual(handle(driver).props['aria-expanded'], 'true', '点一下 ⇒ 展开')
  assert.strictEqual(drawerBody(driver).props.hidden, false, '展开后细节可见（hidden 去掉）')
  assert.strictEqual(drawerBody(driver).props['data-codesys-write-drawer-body'], 'open', '细节块标记为 open')
  assert.strictEqual(row(driver).props['data-codesys-write-drawer'], 'open', '命令条标着展开')
  const details = drawerText(driver)
  assert(details.includes('提案状态'), `展开后必须说明提案状态（实际：${JSON.stringify(details)}）`)
  assert(String(drawerLine(driver, 'data-codesys-drawer-proposal')).includes('1 个对象'),
    '提案状态那一行必须报出待写入的对象数')
  assert(details.includes('上次写入'), '展开后必须说明上次写入结果（哪怕只是"没有失败记录"）')
  assert.strictEqual(driver.editorValue('declaration'), beforeOpenValue, '开抽屉不许改动编辑器里的字')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), 'manual', '也不许动用户的草稿标记')

  handle(driver).props.onClick()
  await driver.settle()
  assert.strictEqual(handle(driver).props['aria-expanded'], 'false', '再点一下 ⇒ 收起')
  assert.strictEqual(drawerBody(driver).props.hidden, true, '收起后细节块重新 hidden')
  assert.strictEqual(driver.editorValue('declaration'), beforeOpenValue, '收起同样不动用户手打的字')
  // 这一开一合**没有新动作**：`diff` 是 settle() 那几轮里既有的只读轮询（实测：不点任何东西、
  // 只跑一次 settle() 同样是这些 diff），所以把它滤掉之后必须一个动作都不剩。
  const during = calls.slice(ipcBefore).map((call) => call.action)
  assert.deepStrictEqual(
    during.filter((action) => action !== 'diff'), [],
    '展开/收起本身只允许既有的只读 diff 轮询，不许发任何新动作（更不许有 MUTATING）',
  )
  assert.strictEqual(mutatingActions(calls).length, 0, '整段交互 MUTATING 仍然是 0')
  console.log('[自测②] 有待写入内容 ⇒ 把手出现、文案「1 项待确认」、aria-expanded=false 且细节块 hidden=true'
    + '（默认收起）；「确认写入 / 放弃 / 已核对」仍在同一行 ✓')
  console.log('[自测③] 点开 ⇒ aria-expanded=true / hidden=false，细节里能看到「提案状态：待写入 1 个对象」；'
    + '再点 ⇒ 收起；这一开一合 IPC 0 次、编辑器里的手打字与草稿标记一个字都没变 ✓')
  driver.unmount()
}

// ── ④ 在线已冻结 ⇒ 把手文案含「在线已冻结」，且**不自动展开**（T217）────────────
async function frozenHandleStaysCollapsed () {
  const { driver, calls } = createDriver({ onlineStatus: onlineStatus({ isLoggedIn: true, loginMode: 'keep' }) })
  await driver.settle()

  const frozenHandle = handle(driver)
  assert(frozenHandle, '已登录（冻结）时那一行必须出现 —— 冻结原因与出路不许沉默')
  assert.strictEqual(stateWord(driver), '在线已冻结', '把手文案必须含「在线已冻结」')
  assert.strictEqual(frozenHandle.props['aria-expanded'], 'false', '冻结也绝不自动展开')
  assert.strictEqual(drawerBody(driver).props.hidden, true, '冻结时细节默认不可见')
  // 同一行原因 + 禁用（既有 T217 行为一字未改）。
  assert.strictEqual(reasonNode(driver) ? textOf(reasonNode(driver)) : null, FROZEN_DETAIL,
    '冻结时那一行必须带着唯一一行原因与出路')
  assert.strictEqual(confirmNode(driver).props.disabled, true, '「确认写入」在冻结时必须禁用')
  assert.strictEqual(confirmNode(driver).props['data-codesys-write-frozen'], 'true', '并且如实暴露冻结态')
  assert.strictEqual(frozenHandle.props['aria-expanded'], 'false', '渲染若干轮之后仍然不许自己展开')

  frozenHandle.props.onClick()
  await driver.settle()
  const frozenDetails = drawerText(driver)
  assert(frozenDetails.includes('冻结原因') && frozenDetails.includes('退出登录'),
    `展开后必须能看到冻结原因与出路（实际：${JSON.stringify(frozenDetails)}）`)
  assert.strictEqual(mutatingActions(calls).length, 0, '冻结这一行上不许出现任何 MUTATING')
  console.log('[自测④] 冻结 ⇒ 把手「在线已冻结」+ aria-expanded=false + 细节 hidden=true（不自动展开）·'
    + ` 同一行原因=${JSON.stringify(FROZEN_DETAIL)} · 「确认写入」disabled=true · 展开后可见「冻结原因」与出路 · MUTATING 0 ✓`)
  driver.unmount()
}

// ── ⑤ 正在写入 ⇒ 把手读作「写入中」（写盘期间那一行必须还在）────────────────────
async function writingHandle () {
  let release = null
  const gate = new Promise((resolve) => { release = resolve })
  const objects = JSON.parse(JSON.stringify(OBJECTS))
  const stub = engineStub(objects, {
    'apply-and-build': async (input, state) => { await gate; return applyWrite(state, objects, input) },
  })
  const { driver, calls } = createDriver({ stub })
  await driver.settle()
  await typeDraft(driver)
  await acceptReview(driver)

  const ipcBefore = calls.length
  confirmNode(driver).props.onClick() // 用户点击 ⇒ 写入开始（这里的"写入"是用户点出来的，不是抽屉发起的）
  await driver.settle()
  assert.strictEqual(stateWord(driver), '写入中', '写入进行中那一行必须读作「写入中」')
  assert(handle(driver), '写入进行中那一行仍然在（不然用户看不到进度）')

  release()
  await driver.settle()
  const during = calls.slice(ipcBefore).map((call) => call.action)
  assert(during.includes('apply-and-build'), '确认写入那一趟必须真的走既有的 apply-and-build')
  assert.strictEqual(row(driver), null, '写完之后回到空闲 ⇒ 那一行自动消失（提案件已消费）')
  console.log('[自测⑤a] 写入进行中 ⇒ 把手文案「写入中」；写完之后 ⇒ 那一行**自动消失**'
    + `（无需用户操作；这一趟动作：${during.join(', ')}）✓`)
  driver.unmount()
}

// ── ⑤b 上次写入失败 ⇒ 出现 + 可展开见原因 ──────────────────────────────────────
async function writeFailureHandle () {
  const objects = JSON.parse(JSON.stringify(OBJECTS))
  const failureText = '模拟写入失败：工程文件被其他程序独占'
  const stub = engineStub(objects, {
    'apply-and-build': async () => { throw new Error(failureText) },
  })
  const { driver, calls } = createDriver({ stub })
  await driver.settle()
  await typeDraft(driver)
  await acceptReview(driver)

  confirmNode(driver).props.onClick()
  await driver.settle()
  assert.strictEqual(stateWord(driver), '上次写入失败', '写入失败之后把手必须读作「上次写入失败」')
  assert.strictEqual(handle(driver).props['aria-expanded'], 'false', '失败也不许自己展开（用户没点就不展开）')
  assert.strictEqual(drawerBody(driver).props.hidden, true, '失败时细节默认收起')

  handle(driver).props.onClick()
  await driver.settle()
  const failureDetails = drawerText(driver)
  assert(failureDetails.includes('写入或编译失败') && failureDetails.includes(failureText),
    `展开后必须能看到失败原因原文（实际：${JSON.stringify(failureDetails)}）`)
  assert(failureDetails.includes('写前恢复快照已保留'), '并且如实说明写前恢复快照还在')
  assert.strictEqual(mutatingActions(calls).length, 1, '整段只有用户点的那一次写入尝试（没有第二次写入）')
  console.log('[自测⑤b] 上次写入失败 ⇒ 把手「上次写入失败」+ 默认收起；展开后可见 '
    + `${JSON.stringify(failureDetails)}（MUTATING 只有用户点的那 1 次）✓`)
  driver.unmount()
  return failureText
}

// ── ⑤c 上次编译失败 ⇒ 出现 + 可展开见计数（既有「编译输出」行不回归）────────────
async function compileFailureHandle () {
  const objects = JSON.parse(JSON.stringify(OBJECTS))
  const stub = engineStub(objects, {
    build: async () => ({
      status: 'complete',
      payload: {
        messages: [{ severity: 'error', text: '模拟编译错误 C0032：未定义的标识符' }],
        errorCount: 1,
        warningCount: 0,
        summaryErrorCount: 1,
        summaryWarningCount: 0,
        compileSummary: '1错误,0警告',
      },
    }),
  })
  const { driver, calls } = createDriver({ stub })
  await driver.settle()
  const compileButton = driver.find((props) => props['data-codesys-compile'] === 'true')
  assert(compileButton, '顶栏「编译」入口必须还在')
  compileButton.props.onClick({})
  await driver.settle()

  assert.strictEqual(stateWord(driver), '上次编译失败', '编译失败同样必须让那一行出现，并说明是编译失败')
  assert(handle(driver).props['aria-expanded'], 'false', '编译失败也不自动展开')
  handle(driver).props.onClick()
  await driver.settle()
  const details = drawerText(driver)
  assert(details.includes('上次编译'), `展开后必须能看到上次编译的计数（实际：${JSON.stringify(details)}）`)
  // 既有「编译输出」行一个字都没动。
  assert(driver.find((props) => props['data-codesys-compile-output'] === 'true'), '既有「编译输出」行必须仍在')
  assert(driver.find((props) => props['data-codesys-compile-toggle'] === 'true'), '编译输出的展开/收起入口也必须仍在')
  assert.strictEqual(mutatingActions(calls).length, 0, '编译不是 MUTATING（既有语义）')
  console.log('[自测⑤c] 上次编译失败 ⇒ 把手「上次编译失败」+ 可展开见计数；既有「编译输出」行仍在；MUTATING 0 ✓')
  driver.unmount()
}

// ── ⑥ 不再需要 ⇒ 自动收起/消失（放弃之后 + 新提案重新是收起的）──────────────────
async function disappearanceAndFreshCollapse () {
  const { driver, calls } = createDriver()
  await driver.settle()
  await typeDraft(driver)
  handle(driver).props.onClick()
  await driver.settle()
  assert.strictEqual(handle(driver).props['aria-expanded'], 'true', '先把它打开（下面要证明它会自己收起来）')

  discardNode(driver).props.onClick()
  await driver.settle()
  assert.strictEqual(row(driver), null, '放弃之后没有待写入内容 ⇒ 那一行整个消失（不是留着收起状态）')
  assert.strictEqual(handle(driver), null, '把手也不在')
  assert.strictEqual(confirmNode(driver), null, '「确认写入」也不在（空闲）')
  const text = wholeText(driver)
  assert(!text.includes('项待确认') && !text.includes('等待 AI 改动'), '空闲之后那一行的字样必须一个都不剩')

  // 再来一份待写入内容：它必须从**收起**开始（绝不带着上一轮的展开状态）。
  await typeDraft(driver)
  assert.strictEqual(handle(driver).props['aria-expanded'], 'false', '新一次"需要"必须从收起开始（绝不自动展开）')
  assert.strictEqual(drawerBody(driver).props.hidden, true, '新一次"需要"的细节默认不可见')
  assert.strictEqual(mutatingActions(calls).length, 0, '放弃 + 开合抽屉全程 MUTATING 0（放弃本身也不写工程）')
  console.log('[自测⑥] 不再需要（放弃后）⇒ 那一行**自动消失**（命令条/把手/确认写入/状态词全部不在）；'
    + '再次出现时 aria-expanded=false（从收起开始，绝不自动展开）· MUTATING 0 ✓')
  driver.unmount()
}

// ── ⑦ 源码形状：只动展示层（不碰写入/编译/冻结逻辑，不抢焦点，不加定时器）────────
function sourceShapeIsDisplayOnly () {
  const source = fs.readFileSync(clientFile, 'utf8')
  const start = source.indexOf("writeDrawerNeeded ? h('section', {")
  const end = source.indexOf("// T097: 编译输出", start)
  assert(start > 0 && end > start, 'the drawer block must be findable in the generated bundle')
  const slice = source.slice(start, end)

  assert(slice.includes("onClick: () => setWriteDrawerOpen((current) => !current)"),
    'the only way to open the drawer is the user clicking the handle')
  assert(!slice.includes('autoFocus') && !slice.includes('.focus('),
    'the drawer may not steal focus from whatever the user was doing')
  assert(!slice.includes('setInterval') && !slice.includes('setTimeout'),
    'the drawer adds no timer (no continuous watching)')
  assert(slice.includes("'data-codesys-write-panel': 'true'") && slice.includes("'data-codesys-confirm-write': 'true'"),
    'the write-panel marker and the confirm control stay inside the same band')
  assert(slice.includes("'data-codesys-discard-proposal': 'true'"),
    '「放弃」stays inside the same band (same position, same behaviour)')
  assert(slice.includes("'data-codesys-write-frozen': onlineWriteFrozen ? 'true' : 'false'"),
    'the frozen state must still be exposed by the confirm control')
  // 既有的写入闸门与冻结判据一个都没有被这一段改写。
  assert(source.includes("if (onlineWriteFrozen) {\n          if (!fromChat) setStatus(`已阻止写入：${CODESYS_ONLINE_WRITE_FROZEN_DETAIL}`)"),
    'the write path itself must still refuse while frozen (the drawer changed nothing there)')
  const applyCalls = source.match(/run\('apply-and-build'/g) || []
  assert.strictEqual(applyCalls.length, 1, 'apply-and-build 必须仍然只有一个调用点（抽屉没有新增写入实现）')
  console.log('[自测⑦] 抽屉只动展示层：打开只由用户点击触发、无 autoFocus/focus、无 setTimeout/setInterval、'
    + '写入面板与确认/放弃标记仍在同一段、apply-and-build 仍然只有 1 个调用点 ✓')
}

async function main () {
  await idleRowDoesNotExist()          // ①
  await proposalHandleToggles()        // ②③
  await frozenHandleStaysCollapsed()   // ④
  await writingHandle()                // ⑤a 正在写入
  await writeFailureHandle()           // ⑤b 上次写入失败
  await compileFailureHandle()         // ⑤c 上次编译失败 + 编译输出行不回归
  await disappearanceAndFreshCollapse() // ⑥
  sourceShapeIsDisplayOnly()           // ⑦
  console.log('[自测⑧] 既有「确认写入 / 放弃 / 已核对」「编译输出」行全部原地保留（上面每个场景都在断言它们）✓')
  process.stdout.write('codesys workbench write-row drawer contract passed\n')
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
  process.exitCode = 1
})
