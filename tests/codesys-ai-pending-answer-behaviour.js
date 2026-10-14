'use strict'

// T185: "待回答" — the drawer must SHOW it, must let the user answer it, and must
// never answer it on its own.
//
// The user's report: "原会话（主页那条）有一个『待回答』，但 CODESYS 插件的 AI 对话抽屉不显示
// 这个待回答，于是一直卡住".  The word "待回答" is DSH's own session-row label
// (`@deepseek-ai/dsh-client-ui-workspace` `status.compact.answer`), and it is shown while
// `pendingInteraction.kind === 'question'` — i.e. while an `ask_user_question` tool call is
// waiting for the human.  The old data bridge never reported that at all: it only reported
// `running` / `pendingSubmissions` / `awaitingFirstTurn` / `reasoning`, and during a pending
// question `running` stays TRUE (the turn is still open, blocked inside the tool).  So the
// drawer kept painting "正在分析请求" with no question and no way out.
//
// This contract drives the REAL sources, not copies:
//
//   PART A — `dsh/src/78-codesys-ai-chat.js` (the data bridge) in a `vm` context against a
//            fake DSH that exposes the REAL shape (`uiSession.sessionStatus` →
//            `{ running, pendingInteraction }`, the pending interaction being a
//            `PendingQuestion`-like carrier with `kind/key/sessionId/questions/answer()`).
//            It pins the two halves of the fix: `snapshot()` reports the question verbatim,
//            and `answer()` is the ONLY thing that ever calls the carrier's `answer()`.
//
//   PART B — `app/renderer/renderer.js` (the drawer) through `loadRendererScript` on the
//            mini-DOM, fed the same real-shaped snapshot.  It pins that the question text
//            reaches the DOM, that "正在分析请求" is suppressed while a question is pending,
//            that polling performs ZERO answer calls, and that one real click on
//            「提交回答」 produces exactly one `codesys:ai-chat-answer` call with DSH's own
//            payload encoding.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')

const bridgeFile = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'src', '78-codesys-ai-chat.js')
const rendererFile = path.join(__dirname, '..', 'app', 'renderer', 'renderer.js')

const SESSION_ID = 'session-9228d530-2ce3-4735-bf1c-43bdf35d9a46'
const WAIT_KEY = 'question:7'

// The real question batch out of the user's own session log
// (`.../sessions/--C-Users-29925-Documents--/<SESSION_ID>/session.v4.jsonl.zstd`, the
// `ask_user_question` tool call that has no matching `tool/result`), verbatim.
const QUESTIONS = [
  {
    id: 'pou_type',
    header: '对象类型',
    question: '`test` 要建成哪种 POU？',
    options: [
      { label: '程序 PROGRAM（推荐）', description: '最符合“写入一个名为 test 的程序”的字面要求，可作为任务主体被调用。' },
      { label: '功能块 FUNCTION_BLOCK', description: '若你想把它作为可实例化的逻辑单元复用。' },
      { label: '函数 FUNCTION', description: '若它应当是无状态、带返回值的一次性计算。' },
    ],
  },
  {
    id: 'lang_body',
    header: '实现语言',
    question: '程序体用什么语言写？',
    options: [{ label: 'ST（结构化文本）' }, { label: '先建空壳，占位注释' }, { label: '我来描述逻辑' }],
  },
]

// The renderer compares across `vm` realms, where `deepStrictEqual` would trip over
// different `Array.prototype` identities. Comparing the JSON text compares the VALUES.
const json = (value) => JSON.stringify(value)

// `assert.strictEqual` on a vm-realm value would compare realm-foreign prototypes, so every
// structural comparison in PART A goes through its JSON text.
const same = (actual, expected, message) => assert.strictEqual(json(actual), json(expected), message)

// ── PART A: the data bridge ──────────────────────────────────────────────────────────

/**
 * Build the bridge against a fake DSH document that carries the REAL 0.2.0-rc.1 shape.
 * @param options - `{ questions, kind, withAnswer, pending }` shape switches for one scenario.
 * @returns the installed bridge plus the recorded `answer()` calls and the carrier itself.
 */
function createBridge (options = {}) {
  const questions = options.questions === undefined ? QUESTIONS : options.questions
  const calls = []
  const carrier = {
    kind: options.kind || 'question',
    key: WAIT_KEY,
    sessionId: SESSION_ID,
    questions,
    ...(options.withAnswer === false ? {} : { answer: async (payload) => { calls.push(payload) } }),
  }
  const pending = options.pending === false ? null : carrier
  const statusSource = {
    getSnapshot: () => new Map([[SESSION_ID, { running: true, pendingInteraction: pending, completionUnread: false }]]),
  }
  const conversation = { getSnapshot: () => ({ nodes: [] }), prompt: async () => ({}) }
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: [SESSION_ID],
        byId: { [SESSION_ID]: { id: SESSION_ID, retainedBy: { mainView: 1 }, running: true } },
        phase: 'ready',
      }),
    },
    binding: () => ({ session: conversation }),
  }
  const uiSession = {
    current: { getSnapshot: () => ({ key: SESSION_ID, hooks: {} }) },
    sessionStatus: statusSource,
  }
  const ctx = {
    // The two services shard 78 resolves: `sessions` through the plain accessor (it declares
    // that one in its inject list) and `uiSession` through the reflective "no inject required"
    // readers first. Both spellings are on the object, like a real cordis context.
    sessions,
    uiSession,
    get: (name) => (name === 'uiSession' ? uiSession : (name === 'sessions' ? sessions : undefined)),
    reflect: { get: () => undefined, props: {} },
    root: null,
    fiber: null,
  }
  const sandbox = { window: {}, ctx, console, getOptionalService: (context, name) => (context ? context[name] : undefined) }
  const context = vm.createContext(sandbox)
  vm.runInContext(
    `${fs.readFileSync(bridgeFile, 'utf8')}\n;installCodesysAiChat(ctx); globalThis.__api = window.__TASKHIVE_CODESYS_AI_BRIDGE__;\n`,
    context,
    { filename: bridgeFile },
  )
  const api = sandbox.__api
  assert(api, 'shard 78 must install window.__TASKHIVE_CODESYS_AI_BRIDGE__')
  return { api, calls, carrier }
}

async function bridgeChecks () {
  // ── 1. the question reaches the drawer, verbatim, as pure data ──────────────────────
  {
    const bridge = createBridge()
    const snapshot = await bridge.api.snapshot(40)
    assert.strictEqual(snapshot.ok, true, 'the snapshot must succeed while a question is pending')
    const pending = snapshot.pendingInteraction
    assert(pending, 'snapshot() must report pendingInteraction — this is the whole fix')
    assert.strictEqual(pending.kind, 'question', 'the user-reported case is an ordinary question')
    assert.strictEqual(pending.key, WAIT_KEY, 'the carrier key must survive so an answer can be matched back')
    // DSH's own two words, taken verbatim from `dsh-client-ui-workspace`
    // (`status.waitingAnswer` and `status.compact.answer`) — not invented here.
    assert.strictEqual(pending.label, '等待回答', 'the full status word must be DSH\'s own `status.waitingAnswer`')
    assert.strictEqual(pending.compactLabel, '待回答', 'the compact word must be DSH\'s own `status.compact.answer`')
    assert.strictEqual(pending.answerable, true, 'a question carrier with an answer() must be answerable in place')
    assert.strictEqual(pending.questions.length, 2, 'both questions of the batch must be carried')
    assert.strictEqual(pending.questions[0].question, '`test` 要建成哪种 POU？', 'the question text must be verbatim')
    assert.strictEqual(pending.questions[0].header, '对象类型', 'the asker header must be carried')
    assert.strictEqual(pending.questions[0].options.length, 3, 'every offered option must be carried')
    assert.strictEqual(pending.questions[0].options[0].label, '程序 PROGRAM（推荐）', 'the option label is the answer value and must be verbatim')
    assert.strictEqual(pending.questions[0].multiSelect, false, 'multiSelect defaults to false, like the tool schema')
    // The turn really is still running: the fix must not lie about that (only the drawer's
    // "正在分析请求" line is suppressed — see PART B).
    assert.strictEqual(snapshot.running, true, 'a pending question keeps the turn running; the bridge must not fake `running: false`')

    // ── 2. polling is read-only: N snapshots, ZERO answers ────────────────────────────
    for (let index = 0; index < 8; index += 1) await bridge.api.snapshot(40)
    assert.strictEqual(bridge.calls.length, 0, 'snapshot() must never answer for the user — 8 polls, 0 answers')
  }

  // ── 3. the explicit answer: exactly one call, DSH's own encoding ────────────────────
  {
    const bridge = createBridge()
    await bridge.api.snapshot(40)
    const result = await bridge.api.answer({
      key: WAIT_KEY,
      answers: [
        { id: 'pou_type', selected: ['程序 PROGRAM（推荐）'] },
        { id: 'lang_body', selected: ['ST（结构化文本）'], custom: 'ST' },
      ],
    })
    assert.strictEqual(result.ok, true, 'a complete answer must be accepted')
    assert.strictEqual(result.answered, 2, 'both questions must be reported answered')
    assert.strictEqual(bridge.calls.length, 1, 'exactly one carrier answer() call per user submission')
    // `submitDrafts()` in `dsh-client-ui-user-questions` empties `selected` when a custom
    // answer is given on a single-select question — the bridge must reproduce that encoding
    // exactly, or the host receives a different answer than the main composer would send.
    same(bridge.calls[0], {
      answers: [
        { id: 'pou_type', selected: ['程序 PROGRAM（推荐）'] },
        { id: 'lang_body', selected: [], custom: 'ST' },
      ],
    }, 'the answer payload must be DSH\'s own `{ answers:[{id,selected,custom?}] }` encoding')
  }

  // ── 4. every refusal path: a readable reason and ZERO carrier calls ─────────────────
  const refusals = [
    {
      title: 'a stale key (the user is answering a question that already moved on)',
      options: {},
      payload: { key: 'question:999', answers: [{ id: 'pou_type', selected: ['函数 FUNCTION'] }, { id: 'lang_body', selected: ['我来描述逻辑'] }] },
      reason: 'stale-pending',
    },
    {
      title: 'no answers at all',
      options: {},
      payload: { key: WAIT_KEY, answers: [] },
      reason: 'empty-answer',
    },
    {
      title: 'a silently dropped question',
      options: {},
      payload: { key: WAIT_KEY, answers: [{ id: 'pou_type', selected: ['函数 FUNCTION'] }] },
      reason: 'incomplete-answer',
    },
    {
      title: 'a question answered with neither an option nor custom text',
      options: {},
      payload: { key: WAIT_KEY, answers: [{ id: 'pou_type', selected: [] }, { id: 'lang_body', selected: ['我来描述逻辑'] }] },
      reason: 'incomplete-answer',
    },
    {
      title: 'an option label the asker never offered (the plugin must not invent one)',
      options: {},
      payload: { key: WAIT_KEY, answers: [{ id: 'pou_type', selected: ['随便建一个'] }, { id: 'lang_body', selected: ['我来描述逻辑'] }] },
      reason: 'unknown-option',
    },
  ]
  for (const scenario of refusals) {
    const bridge = createBridge(scenario.options)
    await bridge.api.snapshot(40)
    const result = await bridge.api.answer(scenario.payload)
    assert.strictEqual(result.ok, false, `${scenario.title}: must be refused`)
    assert.strictEqual(result.reason, scenario.reason, `${scenario.title}: must report reason ${scenario.reason}`)
    assert(String(result.detail || '').length > 0, `${scenario.title}: a refusal must carry a readable reason`)
    assert.strictEqual(bridge.calls.length, 0, `${scenario.title}: a refused answer must not reach the host`)
  }

  // ── 5. nothing pending → a readable refusal, never a guess ─────────────────────────
  {
    const bridge = createBridge({ pending: false })
    const snapshot = await bridge.api.snapshot(40)
    assert.strictEqual(snapshot.pendingInteraction, null, 'with nothing pending the snapshot must say so (null), not omit the field')
    const result = await bridge.api.answer({ key: WAIT_KEY, answers: [{ id: 'pou_type', selected: ['函数 FUNCTION'] }] })
    assert.strictEqual(result.ok, false, 'answering with nothing pending must be refused')
    assert.strictEqual(result.reason, 'no-pending', 'the refusal reason must be `no-pending`')
    assert.strictEqual(bridge.calls.length, 0, 'a refused answer must not reach the host')
  }

  // ── 6. an APPROVAL is displayed but never answerable from the drawer ───────────────
  // Approving a permission request for the user is exactly what a plugin must not do in
  // one click. The bridge reports the state (so the drawer can say something) and marks it
  // un-answerable with a readable reason; there is no path from here to the host.
  {
    const bridge = createBridge({ kind: 'approval', questions: [] })
    const snapshot = await bridge.api.snapshot(40)
    const pending = snapshot.pendingInteraction
    assert(pending, 'an approval must still be REPORTED (the user must not be left staring at a spinner)')
    assert.strictEqual(pending.kind, 'approval', 'the kind must survive')
    assert.strictEqual(pending.answerable, false, 'an approval must never be answerable from the drawer')
    assert(/审批/.test(pending.notAnswerableReason), 'the un-answerable reason must say it is an approval')
    assert.strictEqual(pending.compactLabel, '待审批', 'the compact word must be DSH\'s own `status.compact.approval`')
    const result = await bridge.api.answer({ key: WAIT_KEY, answers: [{ id: 'x', selected: ['允许'] }] })
    assert.strictEqual(result.ok, false, 'answering an approval through this bridge must be refused')
    assert.strictEqual(result.reason, 'not-answerable', 'the refusal reason must be `not-answerable`')
    assert.strictEqual(bridge.calls.length, 0, 'an approval must never be answered through this bridge')
  }

  // ── 7. a carrier without `answer()` is reported, not crashed on ────────────────────
  {
    const bridge = createBridge({ withAnswer: false })
    const snapshot = await bridge.api.snapshot(40)
    assert.strictEqual(snapshot.pendingInteraction.answerable, false, 'no answer() method ⇒ not answerable in place')
    assert(String(snapshot.pendingInteraction.notAnswerableReason || '').length > 0, 'and it must say why')
    const result = await bridge.api.answer({ key: WAIT_KEY, answers: [{ id: 'pou_type', selected: ['函数 FUNCTION'] }, { id: 'lang_body', selected: ['我来描述逻辑'] }] })
    assert.strictEqual(result.reason, 'not-answerable', 'the refusal must be a readable data payload')
    assert.strictEqual(bridge.calls.length, 0, 'nothing may be sent')
  }
}

// ── PART B: the drawer ───────────────────────────────────────────────────────────────

const PENDING_ONE = {
  kind: 'question',
  key: WAIT_KEY,
  sessionId: SESSION_ID,
  label: '等待回答',
  compactLabel: '待回答',
  questions: [QUESTIONS[0]],
  answerable: true,
  notAnswerableReason: '',
}

const MESSAGES = [
  { role: 'user', seq: 9, text: '写入一个名为test的程序到里面' },
  { role: 'assistant', seq: 26, text: 'I couldn\'t write it — and I want to be straight with you about why rather than guess.' },
]

const snapshotWith = (pendingInteraction) => ({
  ok: true,
  sessionId: SESSION_ID,
  total: MESSAGES.length,
  messages: MESSAGES,
  model: null,
  running: true,
  runningVia: 'session',
  pending: 0,
  awaitingFirstTurn: false,
  reasoning: '',
  pendingInteraction,
})

/**
 * Load the real renderer with the drawer markup's anchors declared, and an IPC stub that
 * records the two channels this scenario cares about.
 * @param options - `{ answerResult }` for the answer channel's reply.
 * @returns the renderer API plus the recorded IPC calls.
 */
function createRenderer (options = {}) {
  const calls = { answer: [], snapshot: [] }
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
      codesysAiChatAnswer: async (input) => {
        calls.answer.push(input)
        return options.answerResult || { ok: true, key: input.key, answered: input.answers.length }
      },
    }),
  })
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: ['bindCodesysAiChatUi', 'codesysAiChatApplySnapshot', 'codesysAiChatPullSnapshot', 'state', 'codesysAiChatAnswerDraft'],
  })
  assert.strictEqual(typeof loaded.api.bindCodesysAiChatUi, 'function', 'renderer.js must still define bindCodesysAiChatUi()')
  assert.strictEqual(typeof loaded.api.codesysAiChatApplySnapshot, 'function', 'renderer.js must still define codesysAiChatApplySnapshot()')
  return { ...loaded, calls }
}

// A stand-in for the clicked element. The real delegation resolves the node through
// `event.target.closest(selector)`; mini-dom's `closest()` always answers null, so the
// scenario supplies the node the real browser would have supplied.
const nodeTarget = (selector, node) => ({ closest: (asked) => (asked === selector ? node : null) })
const attributeNode = (attributes) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null), disabled: false })

const flush = async () => { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve)) }

/**
 * A renderer whose own bootstrap has already settled, with the drawer bound and open.
 *
 * `renderer.js` ends with an async bootstrap IIFE that selects the initial surface; when it
 * reaches `selectSurface('chat')` it runs `teardownCodesysSurface()`, which resets
 * `state.codesysAiChatOpen`. A scenario that binds and then awaits would have its drawer
 * closed underneath it — and `codesysAiChatPullSnapshot()` returns early while closed, so a
 * "polling never answers" assertion would pass without a single poll happening. Waiting for
 * the bootstrap first (and then opening the drawer) is what makes the poll loop real.
 * @param options - forwarded to `createRenderer`.
 * @returns the renderer API, the scene and the recorded IPC calls.
 */
async function settledRenderer (options = {}) {
  const created = createRenderer(options)
  await flush()
  created.api.bindCodesysAiChatUi()
  created.api.state.codesysAiChatOpen = true
  return created
}

async function rendererChecks () {
  const { api, scene, calls } = await settledRenderer()
  const thread = scene.node('#codesys-ai-thread')
  assert(thread, 'the scene must declare #codesys-ai-thread')

  // ── 1. the pending question is RENDERED (not blank, not a bare spinner) ────────────
  api.codesysAiChatApplySnapshot(snapshotWith(PENDING_ONE))
  const markup = String(thread.innerHTML || '')
  assert(markup.includes('待回答'), 'the drawer must show DSH\'s own compact status word 待回答')
  assert(markup.includes('codesys-ai-pending'), 'the drawer must render the pending-question block')
  // The text is rendered through `codesysAiChatTextMarkup()`, the same renderer the messages
  // use, so the ``` `test` ``` inline-code span is markup — the WORDS are what must be present.
  assert(markup.includes('要建成哪种 POU？'), 'the QUESTION TEXT must be on screen, verbatim — this is what the user could not see')
  assert(markup.includes('codesys-ai-inline-code">test<'), 'and the inline-code span inside the question must render like it does in a message')
  assert(markup.includes('对象类型'), 'the asker header must be on screen')
  assert(markup.includes('程序 PROGRAM（推荐）') && markup.includes('功能块 FUNCTION_BLOCK') && markup.includes('函数 FUNCTION'),
    'every offered option must be a real, clickable choice')
  assert(markup.includes('data-ai-answer-submit="1"'), 'there must be a submit control')
  assert(markup.includes('data-ai-answer-custom="pou_type"'), 'there must be a custom-answer field')
  assert(!markup.includes('正在分析请求'),
    '"正在分析请求" must NOT be shown while the turn is waiting for the user — that stale line is the 「一直卡住」 the user reported')

  // ── 2. polling never answers ──────────────────────────────────────────────────────
  // The drawer is already open (see `settledRenderer`), so these really are polls.
  const pollsBefore = calls.snapshot.length
  for (let index = 0; index < 4; index += 1) await api.codesysAiChatPullSnapshot()
  assert.strictEqual(calls.snapshot.length - pollsBefore, 4,
    'the polling loop must really have hit codesys:ai-chat-snapshot 4 times, or the assertion below is vacuous')
  assert.strictEqual(calls.answer.length, 0, 'polling the snapshot must never call codesys:ai-chat-answer')

  // ── 3. one real click selects, one real click submits → exactly one IPC call ───────
  thread.dispatchEvent({
    type: 'click',
    target: nodeTarget('[data-ai-answer-option]', attributeNode({ 'data-ai-answer-option': 'pou_type', 'data-ai-answer-label': '程序 PROGRAM（推荐）' })),
  })
  assert.strictEqual(calls.answer.length, 0, 'choosing an option must not submit anything on its own')
  const draft = api.codesysAiChatAnswerDraft('pou_type')
  assert.strictEqual(json(draft.selected), json(['程序 PROGRAM（推荐）']), 'the click must record the choice as a draft')
  assert(String(thread.innerHTML).includes('aria-checked="true"'), 'the chosen option must be visibly selected after the repaint')

  thread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-answer-submit]', attributeNode({})) })
  await flush()
  assert.strictEqual(calls.answer.length, 1, 'exactly one click on 提交回答 must produce exactly one IPC call')
  same(calls.answer[0], {
    key: WAIT_KEY,
    answers: [{ id: 'pou_type', selected: ['程序 PROGRAM（推荐）'] }],
  }, 'the IPC payload must carry the carrier key and DSH\'s answer encoding')

  // ── 4. a failure is readable, and still only ever from a click ────────────────────
  {
    const failing = await settledRenderer({ answerResult: { ok: false, reason: 'stale-pending', detail: '待回答的已经不是刚才那一条了（现在是 question:9）：请按刷新后显示的新问题作答。' } })
    const failingThread = failing.scene.node('#codesys-ai-thread')
    failing.api.codesysAiChatApplySnapshot(snapshotWith(PENDING_ONE))
    failingThread.dispatchEvent({
      type: 'click',
      target: nodeTarget('[data-ai-answer-option]', attributeNode({ 'data-ai-answer-option': 'pou_type', 'data-ai-answer-label': '函数 FUNCTION' })),
    })
    failingThread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-answer-submit]', attributeNode({})) })
    await flush()
    assert.strictEqual(failing.calls.answer.length, 1, 'the click is what produced the call')
    assert(String(failingThread.innerHTML).includes('提交回答失败'),
      'a failed submission must leave a readable line — never a silent no-op')
    assert(String(failingThread.innerHTML).includes('question:9'), 'the bridge\'s readable detail must survive into the drawer')
  }

  // ── 5. an approval is shown read-only, with the home-conversation escape hatch ─────
  {
    const approval = await settledRenderer()
    const approvalThread = approval.scene.node('#codesys-ai-thread')
    approval.api.codesysAiChatApplySnapshot(snapshotWith({
      kind: 'approval',
      key: 'approval:3',
      sessionId: SESSION_ID,
      label: '等待审批',
      compactLabel: '待审批',
      questions: [],
      answerable: false,
      notAnswerableReason: '这是一条权限审批请求。代你批准权限是插件最不该做的事，所以这里只提示、不给按钮：请在主页会话里处理它。',
    }))
    const approvalMarkup = String(approvalThread.innerHTML || '')
    assert(approvalMarkup.includes('待审批'), 'an approval must be visible as 待审批')
    assert(approvalMarkup.includes('data-ai-answer-open-home="1"'), 'an approval must offer the 「在主页会话里回答」 route')
    assert(!approvalMarkup.includes('data-ai-answer-submit="1"'), 'an approval must NOT offer a submit button — no one-click approvals')
    assert(approvalMarkup.includes('权限审批'), 'the reason must be readable')
    // Clicking the escape hatch switches the shell to the DSH chat surface and sends nothing.
    approvalThread.dispatchEvent({ type: 'click', target: nodeTarget('[data-ai-answer-open-home]', attributeNode({})) })
    await flush()
    assert.strictEqual(approval.calls.answer.length, 0, 'the escape hatch must not answer anything')
    const posted = approval.scene.posted.map((entry) => entry.message).filter((message) => message?.type === 'surface.open')
    assert(posted.some((message) => message.surface === 'chat' && message.source === 'taskhive-dsh'),
      'the escape hatch must ask the shell to bring the main DSH conversation forward')
  }

  // ── 6. no regression: a plain running turn still shows 「正在分析请求」 ─────────────
  {
    const plain = await settledRenderer()
    const plainThread = plain.scene.node('#codesys-ai-thread')
    plain.api.codesysAiChatApplySnapshot(snapshotWith(null))
    const plainMarkup = String(plainThread.innerHTML || '')
    assert(plainMarkup.includes('正在分析请求'), 'a turn with no pending question must keep T183\'s live line')
    assert(!plainMarkup.includes('codesys-ai-pending'), 'and must not grow a pending block')

    // Settled: neither the live line nor the pending block survives.
    plain.api.codesysAiChatApplySnapshot({ ...snapshotWith(null), running: false, total: MESSAGES.length })
    const settled = String(plainThread.innerHTML || '')
    assert(!settled.includes('正在分析请求'), 'a settled turn must not keep the live line')
    assert(!settled.includes('codesys-ai-pending'), 'a settled turn must not keep a pending block')
    assert(settled.includes('写入一个名为test的程序到里面'), 'and the conversation itself must still be rendered')
  }

  // ── 7. a second question batch starts from a clean draft ─────────────────────────
  {
    const fresh = await settledRenderer()
    fresh.api.codesysAiChatApplySnapshot(snapshotWith(PENDING_ONE))
    fresh.api.codesysAiChatAnswerDraft('pou_type').selected = ['函数 FUNCTION']
    fresh.api.codesysAiChatApplySnapshot(snapshotWith({ ...PENDING_ONE, key: 'question:9' }))
    assert.strictEqual(json(fresh.api.codesysAiChatAnswerDraft('pou_type').selected), json([]),
      'a different pending question must not inherit the previous draft (that would highlight a stale choice)')
  }
}

async function main () {
  await bridgeChecks()
  await rendererChecks()
  console.log('codesys ai pending answer behaviour passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
