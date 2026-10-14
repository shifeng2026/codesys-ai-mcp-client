'use strict'

// 本轮：**放弃**（用户原话：「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」）。
//
// 语义（两个面一致，只有一处实现）：
//   点击「放弃」→ ① 作废当前 AI 提案与审查状态；② 作废用户在编辑器里手打、还没写入的草稿；
//   ③ 编辑器内容退回**磁盘上的最新版本**（＝最后一次成功读取/快照的内容；必要时走既有只读
//   `inspect-project` 重读一次，**绝不写工程**）；④ 回到"等待 AI 改动"的空态。
//
// 这条契约钉五件事，**驱动真实源码**（工作台那半用 `lib/workbench-driver` 渲染真实的
// `CodesysWorkbench`，抽屉那半在 mini-DOM 上跑真实的 `app/renderer/renderer.js`）：
//   ① 点「放弃」→ 提案与手写**都消失**，编辑器内容 === 磁盘最新（逐字比较）；
//   ② 那一次动作里 `apply-and-build` / `apply-changes` / `build` / `update-text` / `create-*` /
//      `rollback` **一次都没有出现**（零写通道 IPC；抽屉那半连 `codesysAiChatApply` 都是 0 次）；
//   ③ 没有手写改动时，反馈只提提案（`已放弃此提案`）；有手写时报处数（`已放弃此提案与 N 处手写改动`）；
//   ④ 没有待放弃内容时那枚按钮**不出现**（两个面同一条口径）；
//   ⑤ 既有「确认写入」与 sha 三态守卫不回归：`checkSourceUnchanged` 仍在 `apply-and-build`
//      **之前**、渲染层里 `codesysAiChatApply` 仍然只有一个调用点，点「确认写入」仍只产生一次写入。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')
const { createWorkbenchDriver } = require('./lib/workbench-driver')

const appRoot = path.join(__dirname, '..')
const rendererFile = path.join(appRoot, 'app', 'renderer', 'renderer.js')
const workbenchFile = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'src', '50-codesys-workbench.js')

const SESSION_ID = 'session-discard-codesys'

// 与 `codesys-workbench-source-refresh-behaviour.js` **同一份**清单：任何会改工程 / 编译 /
// 回滚 / 推进写入的动作，都不许出现在"放弃"这一趟里。
const MUTATING = ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'rollback', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'import-xml']

// ── 工作台那一半的素材（"磁盘上的最新版本"就是这些字节）────────────────────────────────────────
const PLC_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', 'END_VAR'].join('\n')
const PLC_IMPLEMENTATION = 'x := x + 1;'
const GVL_DECLARATION = ['VAR_GLOBAL', '  y : INT;', 'END_VAR'].join('\n')
const TYPED_PLC = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  mine : BOOL;', 'END_VAR'].join('\n')
const TYPED_PLC_IMPL = 'x := x + 1;\nmine := TRUE;'
const TYPED_GVL = ['VAR_GLOBAL', '  y : INT;', '  alsoMine : BOOL;', 'END_VAR'].join('\n')
const AI_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  fromAi : INT;', 'END_VAR'].join('\n')

function diskObjects () {
  return [
    {
      name: 'PLC_PRG',
      guid: 'guid-plc-prg',
      type: 'PROGRAM',
      hasDeclaration: true,
      hasImplementation: true,
      declaration: PLC_DECLARATION,
      implementation: PLC_IMPLEMENTATION,
      path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
    },
    {
      name: 'GVL_Data',
      guid: 'guid-gvl-data',
      type: 'GVL',
      hasDeclaration: true,
      hasImplementation: false,
      declaration: GVL_DECLARATION,
      implementation: '',
      path: ['Device', 'PLC Logic', 'Application', 'GVL_Data'],
    },
  ]
}

const statusOf = (driver) => {
  const value = driver.statusText()
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('') : String(value)
}
// 待领取提案的替身（本轮 A① 之后）。
// 实测顺序是「挂载/回到界面时的那次领取」→ `detect → bind → inspect` → 「绑定之后那次事件式领取」；
// 而**工作台还没有绑定工程**时领到的提案现在会被挡下（它无处可放：sha 防护、编辑器退回、写入闸门
// 全都以 jobId 为前提 —— 绑定前放行正是"残留提案自动加载进新打开的程序"的另一条走法）。所以这套
// 用具要把提案放在**绑定之后**那次领取上，才是真机上"提案落进工作台等着审查"的那一帧。
const pendingProposalFetch = (items) => {
  let claims = 0
  return async (url) => {
    if (!String(url).endsWith('.pending')) return { ok: true, json: async () => ({ ok: true, value: { accepted: true } }) }
    claims += 1
    const deliver = claims > 1 ? items.splice(0, items.length) : []
    return { ok: true, json: async () => ({ ok: true, value: { proposals: deliver } }) }
  }
}
const discardButton = (driver) => driver.find((props) => props['data-codesys-discard-proposal'] === 'true')
const confirmButton = (driver) => driver.find((props) => props['data-codesys-confirm-write'] === 'true')
const reviewBox = (driver) => driver.find((props) => props['data-codesys-review-accepted'] === 'true')
const writeActions = (calls) => calls.filter((item) => MUTATING.includes(item.action)).map((item) => item.action)

// ── ① / ③(a)：手写改动 + 提案一起被放弃，编辑器逐字退回磁盘 ────────────────────────────────────
async function handWrittenDraftsAreDiscarded () {
  const driver = createWorkbenchDriver({ objects: diskObjects(), sourcePath: 'C:/projects/demo.project', jobId: 'discard-job-1' })
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION, '编辑器的起点是磁盘上的文本')

  // 用户手打两处（第二处在切走之后才落进草稿表 —— 这正是 T096 的"切换对象保留草稿"那条路）。
  driver.typeInEditor('declaration', TYPED_PLC)
  driver.typeInEditor('implementation', TYPED_PLC_IMPL)
  driver.clickTreeRow('GVL_Data')
  driver.typeInEditor('declaration', TYPED_GVL)
  driver.clickTreeRow('PLC_PRG')
  assert.strictEqual(driver.editorValue('declaration'), TYPED_PLC, '切回来必须看到用户手打的那一段（否则下面的断言是空的）')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), 'manual', '手写改动必须在项目树上标成待写入')
  assert.strictEqual(driver.treeChangeState('GVL_Data'), 'manual', '另一处草稿同样在案')

  const button = discardButton(driver)
  assert(button, '有待放弃内容时「放弃」必须出现（就在「确认写入」旁边）')
  assert.strictEqual(button.props.disabled, false, '「放弃」不受写入闸门约束（它只减少待写入内容）')
  assert.strictEqual(confirmButton(driver).props.disabled, true, '对照：还没勾「已核对」时「确认写入」是禁用的')

  const readsBefore = driver.ipcCalls.length
  button.props.onClick()
  await driver.settle()
  const during = driver.ipcCalls.slice(readsBefore)

  // ① 提案与手写都消失、回到空态。
  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION, '编辑器必须逐字退回磁盘上的最新版本（声明）')
  assert.strictEqual(driver.editorValue('implementation'), PLC_IMPLEMENTATION, '编辑器必须逐字退回磁盘上的最新版本（实现）')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), '', '放弃之后待写入标记必须消失')
  assert.strictEqual(driver.treeChangeState('GVL_Data'), '', '另一处草稿的标记同样必须消失')
  assert.strictEqual(reviewBox(driver), null, '没有待确认提案了：审查勾选框那一段整个不存在（回到空态）')
  // 本轮（写入行抽屉化）按**意图**更新：空闲时那一行**根本不存在**（用户口径原文：「空闲时
  // 这一行根本不存在」），所以判据从"确认按钮回到禁用"改成更严的一条：整枚按钮都不在 DOM 里。
  // 有内容时它在（本用例上面第 114 行已经断言过），所以"入口没被删掉"这件事一条都没丢。
  assert.strictEqual(confirmButton(driver), null, '没有待写入内容 ⇒ 整条写入行（含「确认写入」）都不出现，而不是留一枚禁用按钮')
  assert.strictEqual(discardButton(driver), null, '没有待放弃内容 ⇒ 那枚按钮**不出现**（与抽屉同一条口径）')

  // ② 零写通道 IPC：只有只读的重读（inspect-project），没有任何 apply / build / rollback。
  assert.deepStrictEqual(writeActions(during), [], `放弃绝不许写工程 / 编译 / 回滚（实际动作：${during.map((item) => item.action).join(', ')}）`)
  assert(during.some((item) => item.action === 'inspect-project'), '退回磁盘最新版本必须真的走既有只读 inspect-project 重读一次')

  // ③(a) 一行说清丢了什么：有手写 ⇒ 报处数。
  const status = statusOf(driver)
  assert.strictEqual(status, '已放弃此提案与 2 处手写改动', `有手写改动时必须报出处数（实际：${JSON.stringify(status)}）`)

  // ⑤ 放弃之后写入通路一个字没动：确认按钮仍然只调 applyProposal（同一个函数、同一条 sha 防护）。
  const source = fs.readFileSync(workbenchFile, 'utf8')
  const applyCalls = source.match(/run\('apply-and-build'/g) || []
  assert.strictEqual(applyCalls.length, 1, 'apply-and-build 必须仍然只有一个调用点（放弃没有新增写入实现）')
  const guardAt = source.indexOf('const guard = await checkSourceUnchanged(jobId)')
  const applyAt = source.indexOf("run('apply-and-build'")
  assert(guardAt > 0 && guardAt < applyAt, 'sha 三态守卫必须仍在 apply-and-build **之前**')

  driver.unmount()
  console.log(`[自测①] 手写 2 处 + 提案一起放弃 → 编辑器逐字退回磁盘（${JSON.stringify(PLC_DECLARATION.split('\n')[0])}…）；动作=${during.map((item) => item.action).join(',')}；写通道=${writeActions(during).length} 次；一行反馈="${status}"`)
  return status
}

// ── ③(b)：没有手写改动时，反馈只提提案 ────────────────────────────────────────────────────────
async function aiOnlyProposalReportsNoDrafts () {
  const proposals = [{
    id: 'proposal-discard-1',
    note: '调整 PLC_PRG',
    proposal: { summary: '调整 PLC_PRG', changes: [{ operation: 'update-text', objectGuid: 'guid-plc-prg', objectName: 'PLC_PRG', declaration: AI_DECLARATION }] },
  }]
  const countingFetch = pendingProposalFetch(proposals)
  const driver = createWorkbenchDriver({
    objects: diskObjects(),
    sourcePath: 'C:/projects/demo.project',
    jobId: 'discard-job-2',
    ownerSessionId: SESSION_ID,
    extraGlobals: { fetch: countingFetch },
  })
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), AI_DECLARATION, 'AI 提案必须先真的落在编辑器里（否则下面的断言是空的）')

  const button = discardButton(driver)
  assert(button, 'AI 提案在案时「放弃」必须出现')
  const readsBefore = driver.ipcCalls.length
  button.props.onClick()
  await driver.settle()
  const during = driver.ipcCalls.slice(readsBefore)

  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION, '放弃 AI 提案 → 编辑器退回磁盘上的文本')
  assert.strictEqual(reviewBox(driver), null, '提案与审查状态一起作废')
  assert.deepStrictEqual(writeActions(during), [], '放弃这一趟同样一次写通道 IPC 都不许出现')
  const status = statusOf(driver)
  assert.strictEqual(status, '已放弃此提案', `没有手写改动时只提提案（实际：${JSON.stringify(status)}）`)
  driver.unmount()
  console.log(`[自测③] 只有 AI 提案、没有手写 → 一行反馈="${status}"；写通道=${writeActions(during).length} 次`)
  return status
}

// ── ④(a)：没有待放弃内容时，工作台那枚按钮不出现 ───────────────────────────────────────────────
async function workbenchButtonAbsentWithoutContent () {
  const driver = createWorkbenchDriver({ objects: diskObjects(), sourcePath: 'C:/projects/demo.project', jobId: 'discard-job-3' })
  await driver.settle()
  assert.strictEqual(discardButton(driver), null, '既没有提案也没有手写改动 ⇒ 工作台那枚「放弃」不出现')
  // 本轮（写入行抽屉化）按**意图**更新：这一条原来是"对照：「确认写入」仍然在（既有入口一个
  // 都没少）"，而用户本轮的口径正好相反 —— 空闲时那条行**根本不存在**（界面零文字）。所以
  // 判据换成更严的一对：空闲 ⇒ 行与「确认写入」都不在；一旦有待写入内容（用例①/③ 覆盖）
  // ⇒ 「确认写入」立刻回来。入口没有被删掉，只是不再常驻。
  assert.strictEqual(confirmButton(driver), null, '空闲 ⇒ 整条写入行（含「确认写入」）根本不存在')
  assert.strictEqual(driver.find((props) => props['data-codesys-commandbar'] === 'true'), null,
    '空闲 ⇒ 连命令条本身都不渲染（零文字、零高度）')
  driver.unmount()
  console.log('[自测④a] 无待放弃内容 → 工作台「放弃」不出现，且整条写入行（确认写入 / 状态词）都不在 DOM 里')
}

// ── 抽屉那一半：真实 renderer.js + mini-DOM ──────────────────────────────────────────────────
const DRAWER_CAPABILITIES = {
  ok: true,
  sessionId: SESSION_ID,
  projectPath: 'C:\\work\\demo.project',
  projectName: 'demo.project',
  gate: { busy: false, writeAvailable: true, writeBlockReason: '', jobId: 'discard-job-9', changeCount: 1, errors: [] },
  blockReason: '',
  draftCount: 2,
  proposal: {
    summary: '把 bStart 改成按钮触发',
    source: 'chat',
    signature: '777888999',
    changeCount: 1,
    omittedChanges: 0,
    changes: [{
      objectName: 'PLC_PRG',
      objectGuid: 'guid-plc-prg',
      operation: 'update-text',
      exists: true,
      declaration: { changedLines: 1, truncated: false, lines: [{ kind: '-', line: 3, text: '  bStart : BOOL;' }, { kind: '+', line: 3, text: '  bStart : BOOL := FALSE;' }] },
      implementation: null,
    }],
  },
  build: { state: 'idle' },
}

const SNAPSHOT_BASE = {
  ok: true,
  sessionId: SESSION_ID,
  total: 1,
  messages: [{ role: 'assistant', seq: 3, text: '我把改动整理成提案了。' }],
  model: null,
  running: false,
  runningVia: 'session',
  pending: 0,
  awaitingFirstTurn: false,
  reasoning: '',
  pendingInteraction: null,
}
const snapshotWith = (capabilities) => ({ ...SNAPSHOT_BASE, capabilities })

function createDrawer (options = {}) {
  const calls = { snapshot: [], apply: [], other: [] }
  const scene = createScene({
    viewport: { width: 1200, height: 800 },
    nodes: {
      '#surface': {},
      '#activity': {},
      '#plugin-overlay': {},
      '#plugin-content': {},
      '#left-plugin-nav': {},
      '#right-plugin-nav': {},
      '#harness-state': {},
      '#input-status': {},
      '#codesys-ai-drawer': {},
      '#codesys-ai-thread': {},
      '#codesys-ai-resizer': {},
      '#codesys-ai-close': {},
      '#codesys-ai-draft': {},
      '#codesys-ai-send': {},
      '#codesys-ai-model': {},
      '#codesys-ai-model-name': {},
      '#codesys-ai-model-note': {},
      '#codesys-ai-model-menu': {},
      // `codesysAiChatHarnessFrame()` 按 `ensureShell()` 用的**同一个 title** 找 DSH 那个框架。
      'iframe[title*="Harness"]': {},
    },
    taskhive: createTaskhiveStub({
      harnessStatus: async () => ({ runtime: { state: 'ready' } }),
      listPlugins: async () => [],
      harnessUrl: async () => null,
      codesysAiChatSnapshot: async (input) => { calls.snapshot.push(input); return options.snapshot || null },
      codesysAiChatApply: async (input) => { calls.apply.push(input); return { ok: true, written: 1 } },
    }),
  })
  const posted = []
  scene.requireNode('iframe[title*="Harness"]').contentWindow = { postMessage: (message) => posted.push(message) }
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: ['bindCodesysAiChatUi', 'codesysAiChatApplySnapshot', 'codesysAiChatPullSnapshot', 'state'],
  })
  assert.strictEqual(typeof loaded.api.bindCodesysAiChatUi, 'function', 'renderer.js 必须仍然定义 bindCodesysAiChatUi()')
  return { ...loaded, calls, posted }
}

const nodeTarget = (selector, node) => ({ closest: (asked) => (asked === selector ? node : null) })
const attributeNode = (attributes, disabled = false) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null), disabled })
const flush = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)) }

async function settledDrawer (options = {}) {
  const created = createDrawer(options)
  await flush()
  created.api.bindCodesysAiChatUi()
  created.api.state.codesysAiChatOpen = true
  // 真机上"抽屉是打开着的"必然意味着数据桥已经连上过一次（否则根本不会有待确认提案）。
  // 这一步必须显式摆好：`codesysAiChatPullSnapshot()` 对**第一次**成功快照的既有语义是
  // "把打开时那句'正在…'清空"（T180 的安静规则），所以不摆好它，收尾那次只读快照会把
  // 刚刚写下的一行反馈清掉 —— 那是测试场景不真实，不是被放弃的反馈丢了。
  created.api.state.codesysAiChatBridgeOk = true
  return created
}

async function drawerDiscardIsOneMessageAndZeroWriteIpc () {
  const drawer = await settledDrawer({ snapshot: snapshotWith({ ...DRAWER_CAPABILITIES, proposal: null }) })
  const thread = drawer.scene.requireNode('#codesys-ai-thread')
  drawer.api.codesysAiChatApplySnapshot(snapshotWith(DRAWER_CAPABILITIES))
  const markup = String(thread.innerHTML || '')
  assert(markup.includes('data-ai-confirm-write="1"'), '对照：「确认写入工程」仍在（既有入口一个都没少）')
  assert(markup.includes('data-ai-discard-proposal="1"'), '「放弃」必须与「确认写入工程」并排出现在同一段里')
  assert(markup.includes('放弃当前提案与工作台里的手写改动，回到磁盘上的最新版本'), '范围必须写在按钮上（含手写改动 + 回到磁盘最新版本）')
  assert(markup.indexOf('data-ai-discard-proposal') < markup.indexOf('data-ai-confirm-write'), '「放弃」就在「确认写入工程」旁边（同一行、它左边）')

  // 一次真实点击 = 一条交给 DSH 工作台的消息，而且**没有**任何写入 IPC。
  thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-discard-proposal]', attributeNode({})) })
  await flush()
  assert.strictEqual(drawer.posted.length, 1, '一次点击只许产生一条消息（幂等）')
  const message = drawer.posted[0]
  assert.strictEqual(message.source, 'taskhive-desktop', '消息形状与既有的 codesys.task 同源（source=taskhive-desktop）')
  assert.strictEqual(message.type, 'codesys.proposal.discard', '消息类型就是放弃那条')
  assert.strictEqual(message.sessionId, SESSION_ID, '带上这条会话，工作台据此判定"是不是我的"')
  assert.strictEqual(message.proposalSignature, DRAWER_CAPABILITIES.proposal.signature, '带上快照原样回来的提案签名（防串位）')
  assert(message.nonce, '每一次放弃都有自己的 nonce（回信据此对上号）')
  assert.strictEqual(drawer.calls.apply.length, 0, '⚠️ 放弃**不是**写入：codesysAiChatApply 必须 0 次')
  assert.strictEqual(drawer.calls.snapshot.length, 0, '点击本身不发快照请求（它在回信/轮询之后）')
  assert(String(thread.innerHTML).includes('放弃中…'), '在途时按钮就地表示"放弃中…"（不阻塞界面）')

  // 工作台回信：一行说清丢了什么（有手写 ⇒ 报处数）。
  drawer.scene.window.dispatchEvent({ type: 'message', data: { source: 'taskhive-dsh', type: 'codesys.proposal.discarded', nonce: message.nonce, ok: true, droppedDrafts: 2, hadProposal: true } })
  await flush()
  const after = String(thread.innerHTML || '')
  assert(after.includes('已放弃此提案与 2 处手写改动'), `回信必须变成那一行事实（实际：${/已放弃[^<]*/.exec(after)?.[0] || '(没有)'}）`)
  assert.strictEqual(drawer.calls.apply.length, 0, '整条路径里 codesysAiChatApply 仍然是 0 次')
  // 收尾：拉一次**只读**快照（stub 回的是"提案已消失"那一帧）→ 那一段整个消失，回到空态。
  assert(drawer.calls.snapshot.length >= 1, '收尾必须拉一次只读快照（那一段随之消失）')
  assert(!String(thread.innerHTML).includes('data-ai-proposal="1"'), '提案消失之后那一段必须整个撤掉（回到空态）')
  assert(!String(thread.innerHTML).includes('data-ai-confirm-write'), '没有待写入内容 ⇒ 那两枚按钮一起消失')

  console.log(`[自测②] 抽屉点「放弃」→ postMessage=${drawer.posted.length} 条（${message.type}，nonce=${message.nonce}）· codesysAiChatApply=${drawer.calls.apply.length} 次 · 一行反馈="${/已放弃[^<]*/.exec(after)?.[0] || ''}"`)
}

// ── ④(b)：抽屉里没有待放弃内容 ⇒ 那枚按钮不出现；无工作台窗口 ⇒ 一行可读原因 ────────────────────
async function drawerButtonAbsentAndFailureIsReadable () {
  const none = await settledDrawer()
  none.api.codesysAiChatApplySnapshot(snapshotWith({ ...DRAWER_CAPABILITIES, proposal: null }))
  const empty = String(none.scene.requireNode('#codesys-ai-thread').innerHTML || '')
  assert(!empty.includes('data-ai-proposal="1"'), '没有提案时那一段整个不存在')
  assert(!empty.includes('data-ai-discard-proposal'), '没有待放弃内容 ⇒ 抽屉里那枚「放弃」不出现')
  assert(!empty.includes('data-ai-confirm-write'), '对照：「确认写入工程」同样不出现（既有行为）')

  // 找不到 DSH 框架（工作台没挂起来）时必须写一行**可读**原因，而且什么也不发。
  const lost = await settledDrawer()
  lost.scene.requireNode('iframe[title*="Harness"]').contentWindow = undefined
  lost.api.codesysAiChatApplySnapshot(snapshotWith(DRAWER_CAPABILITIES))
  lost.scene.requireNode('#codesys-ai-thread').dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-discard-proposal]', attributeNode({})) })
  await flush()
  assert.strictEqual(lost.posted.length, 0, '找不到工作台窗口时一条消息都不许发')
  const text = String(lost.scene.requireNode('#codesys-ai-thread').innerHTML || '')
  assert(text.includes('找不到 DSH 工作台窗口'), `失败必须一行可读（实际：${/放弃失败[^<]*/.exec(text)?.[0] || '(没有)'}）`)
  console.log(`[自测④b] 无待放弃内容 → 抽屉按钮不出现；工作台窗口缺失 → "${(/放弃失败[^<]*/.exec(text)?.[0] || '').slice(0, 60)}…"`)
}

// ── ④(c)：本轮——「放弃」**永不静默**（用户原话「点击放弃没有反映」）─────────────────────────────
//
// fix 之前 `codesysAiChatDiscardProposal()` 里那两条是**裸 `return`**：快照里已经没有提案、或
// 上一次放弃/写入还在途时，用户点下去界面上一个字都不变 —— 看起来就是按钮坏了。现在两种各写
// 一行可读原因；而且这两种情况下都**不许**再发第二条消息（幂等仍然是幂等）。
async function drawerDiscardNeverNoOpsSilently () {
  // (a) 快照里已经没有待放弃的提案（DOM 里那枚按钮是上一次重画留下的那个节点）。
  const none = await settledDrawer()
  none.api.codesysAiChatApplySnapshot(snapshotWith({ ...DRAWER_CAPABILITIES, proposal: null }))
  const noneThread = none.scene.requireNode('#codesys-ai-thread')
  noneThread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-discard-proposal]', attributeNode({})) })
  await flush()
  assert.strictEqual(none.posted.length, 0, '没有待放弃内容 ⇒ 一条消息都不许发')
  const noneText = String(noneThread.innerHTML || '')
  assert(noneText.includes('放弃没有生效'), `这一下点击必须留下**一行**可读原因，不许静默（实际：${/放弃[^<]*/.exec(noneText)?.[0] || '(没有)'}）`)

  // (b) 写入在途（`codesysAiChatWriteBusy`）：点「放弃」也必须说明为什么这一下没生效。
  const busy = await settledDrawer()
  busy.api.codesysAiChatApplySnapshot(snapshotWith(DRAWER_CAPABILITIES))
  const busyThread = busy.scene.requireNode('#codesys-ai-thread')
  busy.api.state.codesysAiChatWriteBusy = true
  busyThread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-discard-proposal]', attributeNode({})) })
  await flush()
  assert.strictEqual(busy.posted.length, 0, '写入在途时放弃不许抢跑（幂等仍要保住）')
  const busyText = String(busyThread.innerHTML || '')
  assert(busyText.includes('工作台正在写入'), `写入在途时也必须写一行说明（实际：${/放弃[^<]*/.exec(busyText)?.[0] || '(没有)'}）`)

  console.log(`[自测④c] 永不静默：无提案 → "${(/放弃没有生效[^<]*/.exec(noneText)?.[0] || '').slice(0, 34)}…" · 写入在途 → "${(/放弃没有生效[^<]*/.exec(busyText)?.[0] || '').slice(0, 34)}…"；两种都 0 条消息`)
}

// ── ⑤(b)：渲染层里写入通道仍然只有一个调用点，而且放弃不在它上面 ─────────────────────────────────
function writePathStillSingle () {
  const renderer = fs.readFileSync(rendererFile, 'utf8')
  const rendererApplyCalls = renderer.match(/taskhive\.codesysAiChatApply\(/g) || []
  assert.strictEqual(rendererApplyCalls.length, 1, `渲染层里 codesysAiChatApply 只许有一个调用点（实际 ${rendererApplyCalls.length} 个）`)
  const discardAt = renderer.indexOf('function codesysAiChatDiscardProposal()')
  const discardEnd = renderer.indexOf('function codesysAiChatDiscardSettled(')
  assert(discardAt > 0 && discardEnd > discardAt, '放弃那一段必须仍然是可切片的命名函数')
  const body = renderer.slice(discardAt, discardEnd)
  assert(!/codesysAiChatApply\(/.test(body), '放弃那条路径里不许出现任何写入通道调用')
  assert(!/ipcRenderer|invoke\(/.test(body), '放弃不新增 IPC 调用点（它只 postMessage 给 DSH 侧的数据桥）')
  console.log(`[自测⑤] 写入路径唯一性 → renderer 的 codesysAiChatApply 调用点=${rendererApplyCalls.length}；放弃那一段 0 处写入调用`)
}

async function main () {
  const withDrafts = await handWrittenDraftsAreDiscarded()
  const aiOnly = await aiOnlyProposalReportsNoDrafts()
  await workbenchButtonAbsentWithoutContent()
  await drawerDiscardIsOneMessageAndZeroWriteIpc()
  await drawerButtonAbsentAndFailureIsReadable()
  await drawerDiscardNeverNoOpsSilently()
  writePathStillSingle()
  console.log(`codesys discard proposal behaviour passed (有手写："${withDrafts}" · 只有提案："${aiOnly}" · 两个面：按钮并排、无内容不出现、零写通道 IPC)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
