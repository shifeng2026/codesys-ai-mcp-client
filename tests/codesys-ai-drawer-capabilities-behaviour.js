'use strict'

// T191（A 段）：用户口径「AI 对话就是唯一操作面，工作台只做能力提供」。
//
// 用户原话（本轮）："我预想 AI 对话只是调用工作台的能力，不是转到工作台操作，代码输出等都应该出现
// 在 AI 输出框，确认写入等应该为对话输出框提示"。
//
// 这条契约钉三件事，**驱动真实源码**，不是副本：
//
//   PART A —— `dsh/src/78-codesys-ai-chat.js`（数据桥）在 `vm` 里对着一个**真实形状**的假 DSH 跑：
//             `snapshot()` 必须把工作台能力面（差异 / 写入闸门 / 编译结果）原样带出来，并且只认
//             **本会话**那份；`apply()` 是唯一会把用户点击交给工作台写入函数的入口；**轮询多少次
//             都不会调用 `apply()`**（"没有点击 → 0 次写入"）。
//
//   PART B —— `app/renderer/renderer.js`（抽屉）在 mini-DOM 上跑：差异原文（对象 + 前后行）真的
//             画进了消息流、`确认写入工程` 真的在那一段里、轮询 0 次写入 IPC、**一次真实点击 = 一次
//             `codesys:ai-chat-apply`**（载荷是快照原样带回的签名）；sha 防护挡下时写出可读原因并
//             多出第二枚必须用户点的按钮；编译结果（进度 / 终态 / 诊断）同处消息流。
//
//   PART C —— 口径一致：`50-codesys-workbench.js` 里那段的"哪几行变了"必须与工作台编辑器用的是
//             **同一个** `codesysChangedLineNumbers()`（shard 10），不是这里另写的一套。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript, loadPluginClient } = require('./lib/load-source')

const dshRoot = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh')
const bridgeFile = path.join(dshRoot, 'src', '78-codesys-ai-chat.js')
const clientFile = path.join(dshRoot, 'client.js')
const rendererFile = path.join(__dirname, '..', 'app', 'renderer', 'renderer.js')

const SESSION_ID = 'session-191-codesys-drawer'
const OTHER_SESSION = 'session-191-someone-else'
const PROPOSAL_SIGNATURE = '123456789'

const json = (value) => JSON.stringify(value)
const same = (actual, expected, message) => assert.strictEqual(json(actual), json(expected), message)

// ── 工作台发布的那份能力面（`50-*.js` 的 `read()` 的**真实形状**） ────────────────────────────
// 差异原文的口径与工作台编辑器一致：`- 行号 | 旧文本` / `+ 行号 | 新文本`
// （工作台里 `codesysChangedLineNumbers(base, next)` 算出来的行号）。
const CAPABILITIES = {
  ok: true,
  sessionId: SESSION_ID,
  projectPath: 'C:\\work\\demo.project',
  projectName: 'demo.project',
  gate: { busy: false, writeAvailable: true, writeBlockReason: '', jobId: 'job-191', changeCount: 1, errors: [] },
  blockReason: '',
  proposal: {
    summary: '把 bStart 改成按钮触发',
    source: 'chat',
    signature: PROPOSAL_SIGNATURE,
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

const snapshotWith = (capabilities, extra = {}) => ({ ...SNAPSHOT_BASE, capabilities, ...extra })

// ── PART A: the data bridge ────────────────────────────────────────────────────────────────

/**
 * Build the REAL shard 78 in a `vm` against a fake DSH document whose shape is the one the bridge
 * really reads (`sessions.list.getSnapshot()` + `uiSession.current.getSnapshot()`), plus a fake
 * workbench capability seam on `window`.
 * @param options - `{ seam }`: the seam object to expose (omit for "no workbench").
 * @returns the installed bridge, the seam call log and the raw window.
 */
function createBridge (options = {}) {
  const calls = { read: 0, apply: [] }
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: [SESSION_ID],
        byId: { [SESSION_ID]: { id: SESSION_ID, retainedBy: { mainView: 1 }, running: false } },
        phase: 'ready',
      }),
    },
    binding: () => ({ session: { getSnapshot: () => ({ nodes: [] }), prompt: async () => ({}) } }),
  }
  const uiSession = {
    current: { getSnapshot: () => ({ key: SESSION_ID, hooks: {} }) },
    sessionStatus: { getSnapshot: () => new Map([[SESSION_ID, { running: false, pendingInteraction: null }]]) },
  }
  const ctx = {
    sessions,
    uiSession,
    get: (name) => (name === 'uiSession' ? uiSession : (name === 'sessions' ? sessions : undefined)),
    reflect: { get: () => undefined, props: {} },
    root: null,
    fiber: null,
  }
  const windowStub = {}
  if (options.seam !== undefined) windowStub.__TASKHIVE_CODESYS_CAPABILITIES__ = options.seam
  if (options.activeSurface) windowStub.__TASKHIVE_ACTIVE_SURFACE__ = options.activeSurface
  const sandbox = { window: windowStub, ctx, console, getOptionalService: (context, name) => (context ? context[name] : undefined) }
  const context = vm.createContext(sandbox)
  vm.runInContext(
    `${fs.readFileSync(bridgeFile, 'utf8')}\n;installCodesysAiChat(ctx); globalThis.__api = window.__TASKHIVE_CODESYS_AI_BRIDGE__;\n`,
    context,
    { filename: bridgeFile },
  )
  const api = sandbox.__api
  assert(api, 'shard 78 must install window.__TASKHIVE_CODESYS_AI_BRIDGE__')
  return { api, calls, window: windowStub, ctx }
}

const workbenchSeam = (overrides = {}) => ({
  version: 1,
  sessionId: () => (overrides.sessionId === undefined ? SESSION_ID : overrides.sessionId),
  signature: () => PROPOSAL_SIGNATURE,
  read: () => { overrides.readCalls && (overrides.readCalls.count += 1); return overrides.value || CAPABILITIES },
  apply: async (input) => { (overrides.applyCalls || []).push(input); return overrides.applyResult || { ok: true, written: 1, buildPending: true, buildId: 'build-1' } },
})

async function bridgeChecks () {
  // ── 1. 能力面随快照出来（差异原文 / 闸门 / 编译结果都在里面）────────────────────────────
  {
    const seam = workbenchSeam()
    const bridge = createBridge({ seam })
    const snapshot = await bridge.api.snapshot(40)
    assert.strictEqual(snapshot.ok, true, '快照必须成功')
    assert(snapshot.capabilities, 'snapshot() 必须带回工作台能力面 —— 这是"差异出现在抽屉里"的全部数据来源')
    same(snapshot.capabilities.proposal.changes[0], CAPABILITIES.proposal.changes[0], '差异原文必须逐字带回（对象 / 前后行）')
    assert.strictEqual(snapshot.capabilities.gate.writeAvailable, true, '写入闸门必须一起带回（抽屉据此决定按钮能不能点）')
    same(snapshot.capabilities.build, { state: 'idle' }, '编译状态必须一起带回')
  }

  // ── 2. 只认本会话那份工作台：别的会话 / 没自报会话 / 没有入口 一律当作"没有" ───────────────
  {
    const foreign = await createBridge({ seam: workbenchSeam({ sessionId: OTHER_SESSION }) }).api.snapshot(40)
    assert.strictEqual(foreign.capabilities, null, '别的会话的工作台不能被当成这一条会话的')
    const anonymous = await createBridge({ seam: workbenchSeam({ sessionId: '' }) }).api.snapshot(40)
    assert.strictEqual(anonymous.capabilities, null, '没自报会话的能力面不能采用（宁可不显示，也不显示错的）')
    const absent = await createBridge({}).api.snapshot(40)
    assert.strictEqual(absent.capabilities, null, '没有能力面入口时必须是 null（而不是空对象）')
  }

  // ── 3. 轮询永远不会写工程：读 N 次快照 → apply 0 次 ────────────────────────────────────────
  {
    const applyCalls = []
    const bridge = createBridge({ seam: workbenchSeam({ applyCalls }) })
    for (let index = 0; index < 5; index += 1) await bridge.api.snapshot(40)
    assert.strictEqual(applyCalls.length, 0, '快照轮询绝不能调用 apply()（"没有点击 = 0 次写入"的数据侧一半）')
  }

  // ── 4. apply() 只把用户点击交给工作台，并把结果原样回传 ────────────────────────────────────
  {
    const applyCalls = []
    const bridge = createBridge({ seam: workbenchSeam({ applyCalls }) })
    const result = await bridge.api.apply({ sessionId: SESSION_ID, proposalSignature: PROPOSAL_SIGNATURE, overwriteConfirmed: false })
    assert.strictEqual(result.ok, true, '写入结果必须原样回传')
    same(applyCalls, [{ proposalSignature: PROPOSAL_SIGNATURE, overwriteConfirmed: false }], '交出去的只有签名与这一次点击的语义（overwriteConfirmed 只有第二枚按钮会带 true）')
    const overrideCalls = []
    const second = createBridge({ seam: workbenchSeam({ applyCalls: overrideCalls }) })
    await second.api.apply({ sessionId: SESSION_ID, proposalSignature: PROPOSAL_SIGNATURE, overwriteConfirmed: true })
    same(overrideCalls, [{ proposalSignature: PROPOSAL_SIGNATURE, overwriteConfirmed: true }], '第二次显式点击才带 overwriteConfirmed:true')
  }

  // ── 5. 跨会话写入被挡下（工作台不是这一条会话的，就不许写）────────────────────────────────
  {
    const applyCalls = []
    const bridge = createBridge({ seam: workbenchSeam({ sessionId: OTHER_SESSION, applyCalls }) })
    const result = await bridge.api.apply({ sessionId: SESSION_ID, proposalSignature: PROPOSAL_SIGNATURE })
    assert.strictEqual(result.ok, false, '别的会话的工作台不能被这条会话写')
    assert.strictEqual(result.reason, 'foreign-session')
    assert.strictEqual(applyCalls.length, 0, '被挡下时一次都不能交出去')
  }

  // ── 6. 没有能力面时给一句可读原因（绝不静默）──────────────────────────────────────────────
  {
    const bridge = createBridge({})
    const result = await bridge.api.apply({ sessionId: SESSION_ID, proposalSignature: PROPOSAL_SIGNATURE })
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.reason, 'no-capabilities')
    assert(String(result.detail || '').includes('__TASKHIVE_CODESYS_CAPABILITIES__'), 'detail 必须点明缺的是哪个入口')
  }
}

// ── PART B: the drawer ─────────────────────────────────────────────────────────────────────

/**
 * Load the real renderer with the drawer's anchors declared and an IPC stub that records the two
 * channels this scenario cares about (`codesys:ai-chat-snapshot` / `codesys:ai-chat-apply`).
 * @param options - `{ applyResult }` for the write channel's reply.
 */
function createRenderer (options = {}) {
  const calls = { snapshot: [], apply: [], reload: [], reloadGate: null }
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
    },
    taskhive: createTaskhiveStub({
      harnessStatus: async () => ({ runtime: { state: 'ready' } }),
      listPlugins: async () => [],
      harnessUrl: async () => null,
      codesysAiChatSnapshot: async (input) => { calls.snapshot.push(input); return options.snapshot || null },
      codesysAiChatApply: async (input) => {
        calls.apply.push(input)
        return options.applyResult || { ok: true, written: 1, buildPending: true, buildId: 'build-1' }
      },
      // T192：写入之后那枚「让 CODESYS 重新加载」。`reloadGate` 让测试把这一次 IPC **挂在半路**
      // （验"在途时连点不叠加"），`reloadThrows` 验 IPC 自己抛错那一支。
      codesysNativeHostReloadProject: async () => {
        calls.reload.push({})
        if (calls.reloadGate) await calls.reloadGate
        if (options.reloadThrows) throw new Error('simulated ipc failure')
        return options.reloadResult || { ok: true, invoked: true, reason: '', detail: '已把「重新加载」命令发给 CODESYS（菜单项 id 257）。' }
      },
    }),
  })
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: ['bindCodesysAiChatUi', 'codesysAiChatApplySnapshot', 'codesysAiChatPullSnapshot', 'state'],
  })
  assert.strictEqual(typeof loaded.api.bindCodesysAiChatUi, 'function', 'renderer.js must still define bindCodesysAiChatUi()')
  return { ...loaded, calls }
}

const nodeTarget = (selector, node) => ({ closest: (asked) => (asked === selector ? node : null) })
const attributeNode = (attributes, disabled = false) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null), disabled })
const flush = async () => { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve)) }

async function settledRenderer (options = {}) {
  const created = createRenderer(options)
  await flush()
  created.api.bindCodesysAiChatUi()
  created.api.state.codesysAiChatOpen = true
  return created
}

async function rendererChecks () {
  // ── 1. 差异原文出现在消息流里（对象 + 前后行，口径与工作台一致）────────────────────────────
  {
    const { api, scene, calls } = await settledRenderer()
    const thread = scene.requireNode('#codesys-ai-thread')
    api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    const markup = String(thread.innerHTML || '')
    assert(markup.includes('data-ai-proposal="1"'), '消息流里必须有「待确认改动」那一段')
    assert(markup.includes('PLC_PRG'), '改动对象名必须在消息流里')
    assert(markup.includes('修改代码'), '操作口径（修改代码 / 新增 POU…）必须在')
    // 前后原文：`- 3 | 旧` 与 `+ 3 | 新` —— 行号用的是工作台那个 helper 算出来的同一个数字。
    assert(markup.includes('- 3 |') && markup.includes('bStart : BOOL;'), '旧文本那一行必须在（"前后"里的前）')
    assert(markup.includes('+ 3 |') && markup.includes('bStart : BOOL := FALSE;'), '新文本那一行必须在（"前后"里的后）')
    assert(markup.includes('data-ai-confirm-write="1"'), '「确认写入工程」必须是那一段里的真按钮')
    assert(markup.includes('bStart 改成按钮触发'), '提案摘要（AI 自己写的那句话）必须在')
    // 原文证据：把差异那一段（真的会被送进 `#codesys-ai-thread` 的 HTML）打到屏幕上。
    const diffEvidence = (markup.match(/<pre class="codesys-ai-proposal-patch">[\s\S]*?<\/pre>/) || [''])[0]
    console.log(`[自测①] 抽屉消息流里的差异原文 → ${diffEvidence.replace(/<\/?span[^>]*>/g, '').replace(/\n/g, ' ⏎ ')}`)

    // ── 2. 轮询 0 次写入 ────────────────────────────────────────────────────────────────────
    const pollsBefore = calls.snapshot.length
    for (let index = 0; index < 4; index += 1) await api.codesysAiChatPullSnapshot()
    assert.strictEqual(calls.snapshot.length - pollsBefore, 4, '这 4 次必须真的打到 codesys:ai-chat-snapshot（否则下面的断言是空的）')
    assert.strictEqual(calls.apply.length, 0, '轮询快照绝不能调用 codesys:ai-chat-apply（"没有点击 = 0 次"的界面侧一半）')
    console.log(`[自测②] 无点击：快照轮询 ${calls.snapshot.length} 次 → codesys:ai-chat-apply 调用数 = ${calls.apply.length}`)

    // ── 3. 一次真实点击 = 一次 IPC，载荷是快照原样带回的签名 ────────────────────────────────
    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write]', attributeNode({})) })
    await flush()
    assert.strictEqual(calls.apply.length, 1, '一次点击必须产生且只产生一次 codesys:ai-chat-apply')
    same(calls.apply[0], { sessionId: SESSION_ID, proposalSignature: PROPOSAL_SIGNATURE, overwriteConfirmed: false },
      'IPC 载荷必须是快照原样带回的签名 + 这一次点击的语义')
    console.log(`[自测③] 点一次「确认写入工程」→ codesys:ai-chat-apply 调用数 = ${calls.apply.length} · 载荷=${json(calls.apply[0])}`)
    // 成功之后不写提示（用户要求安静）：那一段随下一次快照消失，接着由编译那一段说话。
    assert(!String(thread.innerHTML).includes('写入失败'), '成功路径不许出现失败文案')
  }

  // ── 4. sha 防护挡下（T170 三态的后两态）：可读原因 + 第二枚必须用户点的按钮 ─────────────────
  {
    const blocked = {
      ok: false,
      reason: 'source-changed',
      detail: '磁盘上的工程文件与本次会话最后一次写入时不一致（基线 sha256 aaaa… / 磁盘 sha256 bbbb…）。',
      needsOverwriteConfirmation: true,
    }
    const { api, scene, calls } = await settledRenderer({ applyResult: blocked })
    const thread = scene.requireNode('#codesys-ai-thread')
    api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write]', attributeNode({})) })
    await flush()
    assert.strictEqual(calls.apply.length, 1, '第一次点击就是 it')
    assert.strictEqual(calls.apply[0].overwriteConfirmed, false, '第一次点击绝不能替用户确认覆盖')
    const markup = String(thread.innerHTML || '')
    assert(markup.includes('已阻止写入'), '被 sha 防护挡下必须写出一行可读原因（失败必须可见）')
    assert(markup.includes('基线 sha256'), '工作台给的那句 detail 必须原样出现在抽屉里')
    assert(markup.includes('data-ai-confirm-write-override="1"'), '必须多出第二枚「我已确认，继续写入」')

    // 第二枚也必须真的点一次：overwriteConfirmed 只由它带上。
    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write-override]', attributeNode({})) })
    await flush()
    assert.strictEqual(calls.apply.length, 2, '第二枚按钮的点击才产生第二次调用')
    assert.strictEqual(calls.apply[1].overwriteConfirmed, true, '只有这一次带 overwriteConfirmed:true')
  }

  // ── 5. 闸门不满足时按钮禁用，并把工作台给的原因摆在旁边 ────────────────────────────────────
  {
    const { api, scene } = await settledRenderer()
    const thread = scene.requireNode('#codesys-ai-thread')
    const blockedCapabilities = {
      ...CAPABILITIES,
      gate: { ...CAPABILITIES.gate, writeAvailable: false, writeBlockReason: '当前工程只读（隔离验收工程）' },
      blockReason: '当前工程只读（隔离验收工程）',
    }
    api.codesysAiChatApplySnapshot(snapshotWith(blockedCapabilities))
    const markup = String(thread.innerHTML || '')
    assert(markup.includes('data-ai-confirm-write="1" disabled'), '不可写时按钮必须禁用')
    assert(markup.includes('当前工程只读（隔离验收工程）'), '禁用原因必须写出来（不许只说不可用）')
  }

  // ── 6. 编译进度 / 终态 / 诊断回到抽屉 ─────────────────────────────────────────────────────
  {
    const { api, scene } = await settledRenderer()
    const thread = scene.requireNode('#codesys-ai-thread')
    api.codesysAiChatApplySnapshot(snapshotWith({
      ...CAPABILITIES,
      proposal: null,
      build: { state: 'running', mode: 'build', written: 1, buildId: 'build-1', errorCount: 0, warningCount: 0, infoCount: 0, messages: [] },
    }))
    assert(String(thread.innerHTML).includes('后台离线编译中'), '后台编译进行中必须在消息流里说一句')
    api.codesysAiChatApplySnapshot(snapshotWith({
      ...CAPABILITIES,
      proposal: null,
      build: {
        state: 'done', mode: 'build', written: 1, durationMs: 42000, errorCount: 1, warningCount: 1, infoCount: 3,
        messages: [{ severity: 'warning', text: 'C0199: 变量未使用' }, { severity: 'error', text: 'C0032: 无法转换类型' }], omitted: 2,
      },
    }))
    const done = String(thread.innerHTML || '')
    assert(done.includes('离线编译完成') && done.includes('错误 1') && done.includes('警告 1'), '编译终态必须带上错误/警告计数')
    assert(done.includes('C0032: 无法转换类型'), '编译诊断（错误原文）必须真的列出来')
    assert(done.includes('[error]') && done.indexOf('[error]') < done.indexOf('C0199'), '错误必须排在警告前面（用户先看该看的）')
    assert(done.includes('还有 2 条诊断'), '被省略的条数必须如实写出来（不假装列全了）')
    // 原文证据：编译**终态**那一段的 HTML（计数 + 诊断全文都在这一个节点里）。
    const buildAt = done.indexOf('data-ai-build-state="done"')
    const buildEvidence = buildAt < 0 ? '' : done.slice(buildAt, buildAt + 700)
    console.log(`[自测⑤] 抽屉消息流里的编译终态 → ${buildEvidence.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)}`)
    api.codesysAiChatApplySnapshot(snapshotWith({
      ...CAPABILITIES,
      proposal: null,
      build: { state: 'failed', mode: 'build', written: 1, errorCount: 0, warningCount: 0, infoCount: 0, messages: [], error: '后台编译失败：进程退出' },
    }))
    assert(String(thread.innerHTML).includes('编译失败'), '编译失败必须在抽屉里可见')
  }

  // ── 7. 提案一换，上一次的写入失败原因就作废（不许留在新提案上骗人）──────────────────────────
  {
    const { api, scene } = await settledRenderer({ applyResult: { ok: false, reason: 'write-failed', detail: '写入或编译失败：E9999' } })
    const thread = scene.requireNode('#codesys-ai-thread')
    api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write]', attributeNode({})) })
    await flush()
    assert(String(thread.innerHTML).includes('写入失败'), '失败必须可见')
    const next = { ...CAPABILITIES, proposal: { ...CAPABILITIES.proposal, signature: '999', summary: '另一份提案' } }
    api.codesysAiChatApplySnapshot(snapshotWith(next))
    assert(!String(thread.innerHTML).includes('写入失败'), '换了一份提案之后，上一份的失败原因必须消失')
    assert(String(thread.innerHTML).includes('另一份提案'), '新提案本身要画出来')
  }

  // ── 8. T192：写入成功之后那一段「让 CODESYS 重新加载」────────────────────────────────────
  //
  // 用户报障原话：「测试程序虽然写进去了，但是我每次都要重新启动 codesys 程序才会看到」。
  // 机制：写入走离线作业改磁盘上的 `.project`，运行中的 GUI 把工程读在内存里不会自己读盘，而
  // CODESYS 3.5 没有可编程的重载入口（三重证据见 app/codesys-native-host.js 的 reloadProject）。
  // 这一段就是回落实现：只画一行事实 + 一行"为什么不能自动" + 一枚按钮，**不点就什么都不发生**。
  {
    const { api, scene, calls } = await settledRenderer()
    const thread = scene.requireNode('#codesys-ai-thread')
    api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    assert(!String(thread.innerHTML).includes('data-ai-reload'), '还没写入成功时不许出现那一段（成功路径之外不加常驻文字）')

    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write]', attributeNode({})) })
    await flush()
    assert.strictEqual(calls.apply.length, 1, '这一下点击就是那次写入')
    const markup = String(thread.innerHTML || '')
    assert(markup.includes('data-ai-reload="1"'), '写入成功之后必须出现"已写入工程 + 让 CODESYS 重新加载"那一段')
    assert(markup.includes('data-ai-reload-project="1"'), '那一段里必须有那枚按钮')
    assert(markup.includes('已提交回源工程'), '必须写明这次写入已经落盘（一行事实）')
    assert(markup.includes('CODESYS 3.5 没有可编程的重载入口'), '按钮旁必须有一行说明为什么不能自动重载')
    // ③ 没有点击就没有重载：写入成功本身**不**产生任何 reload IPC（也不许被定时器触发）。
    assert.strictEqual(calls.reload.length, 0, '⚠️ 写入成功不许自动重载：没有点击 → 0 次 codesys:native-host-reload-project')
    console.log(`[自测⑦] 写入成功后抽屉里的那一段 → ${markup.slice(markup.indexOf('data-ai-reload="1"')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)}`)
    console.log(`[自测⑧] 无点击：codesys:native-host-reload-project 调用数 = ${calls.reload.length}`)

    // ④ 幂等：那一次 IPC **在途**时连点两次，只许产生一次调用，且按钮就地转成"正在…"。
    calls.reloadGate = new Promise((resolve) => { calls.releaseReload = resolve })
    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-reload-project]', attributeNode({})) })
    thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-reload-project]', attributeNode({})) })
    await flush()
    assert.strictEqual(calls.reload.length, 1, '在途时连点两次只许产生一次重载 IPC（幂等）')
    assert(String(thread.innerHTML).includes('正在让 CODESYS 重新加载'), '在途时按钮必须就地表示"正在…"（不阻塞界面）')
    calls.releaseReload()
    await flush()
    const done = String(thread.innerHTML || '')
    assert(done.includes('菜单项 id 257'), '成功之后必须把那一次的事实写出来（真正发出的命令 id）')
    console.log(`[自测⑨] 连点两次（第一次在途）→ codesys:native-host-reload-project 调用数 = ${calls.reload.length} · 结果行=${/已把[^<]*/.exec(done)?.[0] || ''}`)

    // 换一份**不同**提案 → 上一次写入那一段必须撤掉；同一份提案回来（陈旧轮询）必须保留。
    api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    assert(String(thread.innerHTML).includes('data-ai-reload="1"'), '同一份提案的陈旧轮询不许把用户刚得到的按钮擦掉')
    api.codesysAiChatApplySnapshot(snapshotWith({ ...CAPABILITIES, proposal: { ...CAPABILITIES.proposal, signature: '999', summary: '另一份提案' } }))
    assert(!String(thread.innerHTML).includes('data-ai-reload'), '换了另一份提案之后，上一段写入结果必须撤掉（不许留在新提案旁边骗人）')
  }

  // ── 9. T192：没有重载入口 / IPC 抛错 → 一行可读原因（绝不静默）────────────────────────────
  {
    const missing = {
      ok: false,
      invoked: false,
      reason: 'no-reload-command',
      detail: 'CODESYS 的菜单里没有「重新加载工程」这一项（已扫过 7 项，顶级菜单：file / project）。请在 CODESYS 里「文件 → 关闭工程」（弹「是否保存」选“不保存”）再「文件 → 打开工程」选同一份 .project。',
    }
    const first = await settledRenderer({ reloadResult: missing })
    first.api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    first.scene.requireNode('#codesys-ai-thread').dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write]', attributeNode({})) })
    await flush()
    first.scene.requireNode('#codesys-ai-thread').dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-reload-project]', attributeNode({})) })
    await flush()
    const thread = first.scene.requireNode('#codesys-ai-thread')
    const text = String(thread.innerHTML || '')
    assert(text.includes('没有「重新加载工程」这一项'), '没有入口必须写出具体原因')
    assert(text.includes('已扫过 7 项'), '原因里必须带上"已扫过多少项"这一事实（不是一句空话）')
    assert(text.includes('关闭工程') && text.includes('打开工程'), '没有入口必须给出最短步骤')
    console.log(`[自测⑩] 没有重载入口 → ${(/CODESYS 的菜单里没有[^<]*/.exec(text)?.[0] || '').slice(0, 160)}`)

    const threw = await settledRenderer({ reloadThrows: true })
    threw.api.codesysAiChatApplySnapshot(snapshotWith(CAPABILITIES))
    threw.scene.requireNode('#codesys-ai-thread').dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-confirm-write]', attributeNode({})) })
    await flush()
    threw.scene.requireNode('#codesys-ai-thread').dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-reload-project]', attributeNode({})) })
    await flush()
    const errorText = String(threw.scene.requireNode('#codesys-ai-thread').innerHTML || '')
    assert(errorText.includes('IPC codesys:native-host-reload-project'), 'IPC 抛错必须把通道名与原因写成一行（不静默）')
    assert(errorText.includes('simulated ipc failure'), 'IPC 的真实错误必须原样出现')
  }
}

// ── PART C: 差异口径与工作台编辑器同源 ─────────────────────────────────────────────────────

function capabilitySectionChecks () {
  const scene = createScene({ viewport: { width: 1200, height: 800 } })
  const loaded = loadPluginClient(clientFile, {
    scene,
    exports: ['codesysCapabilitySection', 'codesysChangedLineNumbers'],
  })
  assert.strictEqual(typeof loaded.api.codesysCapabilitySection, 'function', '工作台必须发布 codesysCapabilitySection()')
  assert.strictEqual(typeof loaded.api.codesysChangedLineNumbers, 'function', '工作台的"哪几行变了"helper 必须还在')
  const base = 'PROGRAM PLC_PRG\nVAR\n  bStart : BOOL;\nEND_VAR\n'
  const next = 'PROGRAM PLC_PRG\nVAR\n  bStart : BOOL := FALSE;\nEND_VAR\n'
  const section = loaded.api.codesysCapabilitySection(base, next)
  const expectedLines = [...loaded.api.codesysChangedLineNumbers(base, next)].sort((left, right) => left - right)
  assert.deepStrictEqual(JSON.parse(json(section.lines.map((row) => row.line).filter((line, index, list) => list.indexOf(line) === index))), JSON.parse(json(expectedLines)),
    '抽屉里差异的行号必须**就是**工作台编辑器用的那个 helper 算出来的行号（同一个口径）')
  assert.deepStrictEqual(JSON.parse(json(section.lines.map((row) => row.kind))), ['-', '+'], '一行变化必须画成"旧一行 + 新一行"')
  same(section.changedLines, expectedLines.length, 'changedLines 是变化行数')
  // 新增对象（base 为空）→ 全是 `+` 行。
  const created = loaded.api.codesysCapabilitySection('', 'PROGRAM NEW_POU\nEND_PROGRAM')
  assert.deepStrictEqual(JSON.parse(json(created.lines.map((row) => row.kind))), ['+', '+'], '新增对象的每一行都是 + 行（与工作台"待新增"一致）')
}

// ── PART D: 「确认写入工程」与工作台那枚按钮**同源**，而且只有这一条通路 ───────────────────────

function writePathChecks () {
  const workbench = fs.readFileSync(path.join(dshRoot, 'src', '50-codesys-workbench.js'), 'utf8')
  const bridge = fs.readFileSync(bridgeFile, 'utf8')
  const renderer = fs.readFileSync(rendererFile, 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8')

  // ① 工作台里 `apply-and-build` 只出现一次，而且在 `applyProposal` 里面（抽屉与按钮都走它）。
  const applyCalls = workbench.match(/run\('apply-and-build'/g) || []
  assert.strictEqual(applyCalls.length, 1, `apply-and-build 必须只有一个调用点（实际 ${applyCalls.length} 个）：抽屉与工作台按钮必须走同一个函数`)
  const applyProposalAt = workbench.indexOf('const applyProposal = async')
  const applyCallAt = workbench.indexOf("run('apply-and-build'")
  assert(applyProposalAt > 0 && applyCallAt > applyProposalAt, 'apply-and-build 必须落在 applyProposal 内部（同一条 sha 防护 / 恢复快照 / deferred build）')
  // sha 防护必须仍在写入**之前**（T170 三态）。
  const guardAt = workbench.indexOf('const guard = await checkSourceUnchanged(jobId)')
  assert(guardAt > 0 && guardAt < applyCallAt, 'sha 防护（checkSourceUnchanged）必须在 apply-and-build 之前')
  // 抽屉那一级调的就是 `applyProposal`，而不是另一个写入实现。
  assert(/return await applyProposal\(proposal, state\.gate\?\.errors \|\| \[\], \{/.test(workbench),
    '抽屉能力面的 apply() 必须调工作台那枚按钮调的同一个 applyProposal')
  // 注（本轮 A②）：seam 的两条入口改成经 ref **转派到当次渲染**的实现。安装时闭包会让抽屉那条路
  // 永远走第一次渲染的 `jobId`（空串 ⇒ "退回磁盘最新版本"被整段跳过），那正是"点击放弃没有反映"
  // 的真因之一。判据仍然是**意图**：能力面只暴露组件自己那两个函数、没有第二个写入实现 ——
  // 不是那两个字符的形状。
  assert(/capabilityApply/.test(workbench) && /apply: \(input\) => capabilityApplyRef\.current\(input\)/.test(workbench),
    '能力面必须把 apply 转派到工作台组件自己的 capabilityApply（唯一入口，不新增写入实现）')
  assert(/discard: \(input\) => capabilityDiscardRef\.current\(input\)/.test(workbench),
    '能力面的 discard 同样只转派组件自己的 capabilityDiscard（不新增第二条清状态实现）')
  assert((workbench.match(/capabilityApplyRef\.current = capabilityApply/g) || []).length === 1,
    'capabilityApplyRef 每次渲染都必须指向当次渲染的 capabilityApply')
  assert((workbench.match(/capabilityDiscardRef\.current = capabilityDiscard/g) || []).length === 1,
    'capabilityDiscardRef 每次渲染都必须指向当次渲染的 capabilityDiscard')

  // ② DSH 侧：只有 `codesysAiChatApply` 会调 `seam.apply`（且只有 bridge.apply 调它）。
  assert(/const value = await seam\.apply\(\{/.test(bridge), 'shard 78 必须把点击交给能力面的 apply()')
  assert((bridge.match(/seam\.apply\(/g) || []).length === 1, 'shard 78 里 seam.apply 只许有一个调用点')

  // ③ 外壳侧：只有 confirm-write 那两枚按钮会调 `codesysAiChatApply`。
  const rendererApplyCalls = renderer.match(/taskhive\.codesysAiChatApply\(/g) || []
  assert.strictEqual(rendererApplyCalls.length, 1, `渲染层里 codesysAiChatApply 只许有一个调用点（实际 ${rendererApplyCalls.length} 个）`)
  assert(/data-ai-confirm-write/.test(renderer) && /data-ai-confirm-write-override/.test(renderer),
    '那一个调用点必须由「确认写入工程」/「我已确认，继续写入」两枚按钮的委托分支触发')
  assert(/codesysAiChatApply: \(input\) => ipcRenderer\.invoke\('codesys:ai-chat-apply'/.test(preload),
    'preload 必须把 codesysAiChatApply 接到 codesys:ai-chat-apply')

  // 本轮 B 项（冻结）：抽屉那枚「确认写入工程」与工作台共用同一条闸门 —— 已登录到应用
  // （gate.onlineWriteFrozen === true）时它必须**禁用**，而且 title 用 blockReason /
  // frozenDetail 说出原因 + 出路（"ai写入和手动写入都禁止"这条规则在这条通路上也成立）。
  assert(/gate\.onlineWriteFrozen !== true/.test(renderer),
    '「确认写入工程」必须把"在线冻结"算进 ready 判定（禁用，而不是点下去才被拒）')
  assert(/gate\.onlineWriteFrozen === true \? String\(gate\.frozenDetail \|\| ''\)/.test(renderer),
    '冻结时那枚按钮的 title 必须显示冻结原因（可读、不静默）')
  assert(/gate\?\.onlineWriteFrozen === true \? 1 : 0/.test(renderer),
    '在线冻结状态必须进抽屉重绘签名，否则冻结了画面还停在"可写"')

  // ④ 主进程：那一条通道只搬数据，写入由工作台自己的函数完成。
  assert(/handleTrusted\('codesys:ai-chat-apply'/.test(main), 'main.js 必须注册 codesys:ai-chat-apply')
  assert(/codesysAiChatBridgeCall\('apply', payload\)/.test(main), '那条通道必须只调数据桥的 apply（不自己写工程）')
  assert(/'codesys:ai-chat-apply',/.test(main), '那条通道必须挂在"只能由 CODESYS 面板触发"的身份门上')
  console.log('[自测⑥] 同源与唯一入口 → 50-*.js 的 apply-and-build 调用点=1（在 applyProposal 内，sha 防护在其之前）· renderer.js 的 codesysAiChatApply 调用点=1 · preload→codesys:ai-chat-apply（面板专属门）· 78 的 seam.apply 调用点=1')
}

async function main () {
  await bridgeChecks()
  await rendererChecks()
  capabilitySectionChecks()
  writePathChecks()
  console.log('codesys ai drawer capabilities behaviour passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
