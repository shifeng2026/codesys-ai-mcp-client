'use strict'

// T231：抽屉里"上次选的模型 + 思考强度"必须**跨重启**记住，并在新会话里**静默恢复一次**。
//
// 用户报障原话：「还有一个事情，模型切换关闭程序打开之后为什么不会保存？」
//
// 真因（取证原文）：抽屉里那次切换是**会话级**的 ——
//   app/renderer/renderer.js  `codesysAiChatChangeModel()` / `codesysAiChatChangeEffort()`
//     → `window.taskhive.codesysAiChatModel({ action:'select', id, effort })`
//   → app/main.js `codesys:ai-chat-model` 的 `select` → `codesysAiChatBridgeCall('setModel', …)`
//   → dsh/src/78-codesys-ai-chat.js `codesysAiChatSetModel()` 的
//     `directory.select({ provider, model, reasoningEffort? })` /
//     `remote.session.selectModel({ sessionId, provider, model, reasoningEffort? })`。
// 它落在**这条会话**的 `modelSelection` 投影上（真包
// `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:333` 就是
// `projected.next ?? catalog.value.default`）。重启之后建立的是**新会话**，投影是空的 ⇒ DSH 回落到
// 目录里的全局默认值 —— 用户看到的就是"没有保存"。这次选择从来没有被写进任何**跨进程**的地方。
//
// 这条契约钉住三件事（每一件都驱动**真实源码**，不是副本）：
//   PART A —— `app/main.js` 里那份偏好存储的**真实函数文本**切出来放进 `vm`，配上**真实**的
//             `app/atomic-json.js` 与一个临时 userData：写入后**断言文件内容**（模型与强度都在，
//             且不抹掉同文件里的"启动时预打开"开关）；再用一个**全新的 vm 上下文**（= 重启后的
//             新进程）重新读回同一个文件 ⇒ 记忆真的在盘上。
//   PART B —— `app/renderer/renderer.js` 在 mini-DOM 上跑：新会话（投影为空）⇒ 真的发出一次
//             `select` 且**带 reasoningEffort**；会话已有显式选择 ⇒ 一个请求都不发（不 clobber）；
//             从来没存过 ⇒ 走默认且**不多发调用**；存的东西不可用 ⇒ 静默退回默认（只有主进程那行
//             审计说真话，界面零文字）；等级不在档位里 ⇒ 丢强度只留模型；成功路径零文字、无新增定时器、
//             除模型通道外**一个 IPC 都不发**。
//   PART C —— 静态：不新增通道 / 不新增动作（数据桥一个字节都不用改）、桥调用载荷形状不变、
//             `source` 只进审计、恢复路径不写任何界面文字、也不碰 localStorage。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')
const { createTempDir } = require('./lib/temp-dir')

const appRoot = path.join(__dirname, '..')
const mainFile = path.join(appRoot, 'app', 'main.js')
const rendererFile = path.join(appRoot, 'app', 'renderer', 'renderer.js')
const bridgeFile = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'src', '78-codesys-ai-chat.js')
const preloadFile = path.join(appRoot, 'app', 'preload.js')

const mainSource = fs.readFileSync(mainFile, 'utf8')
const rendererSource = fs.readFileSync(rendererFile, 'utf8')
const bridgeSource = fs.readFileSync(bridgeFile, 'utf8')
const preloadSource = fs.readFileSync(preloadFile, 'utf8')

const json = (value) => JSON.stringify(value)
const flush = async () => { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve)) }

const PROVIDER = 'deepseek-official'
const PRO_MODEL = 'deepseek-v4-pro'
const FLASH_MODEL = 'deepseek-v4-flash'
// 第三个模型：**支持**等级、而且不等于目录默认值 —— 恢复它时模型与强度会同时变，
// 所以"两样都恢复了"是可判定的（前两个分别是默认值本身与"不支持等级"的那一个）。
const LONG_MODEL = 'deepseek-v4-pro-long'
const PRO_ID = `${PROVIDER}/${PRO_MODEL}`
const FLASH_ID = `${PROVIDER}/${FLASH_MODEL}`
const LONG_ID = `${PROVIDER}/${LONG_MODEL}`
const SESSION_ID = 'session-231-codesys-drawer'

// 真包那份等级清单（`dsh-llm-deepseek/lib/index.js` 的 `REASONING_EFFORTS`，与 T186 契约同一份 fixture）。
const REAL_EFFORTS = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]
const REAL_REASONING = { efforts: REAL_EFFORTS, defaultEffort: 'high' }

// `provider/model` 复合键那一行（`models()` 归一之后的形状）：真包是 `provider` 命名空间下的裸 id。
const row = (compositeId, modelId, name, reasoning) => ({
  id: compositeId,
  provider: PROVIDER,
  providerName: 'DeepSeek 官方',
  model: modelId,
  name,
  label: `DeepSeek 官方 · ${name}`,
  routable: true,
  ...(reasoning ? { reasoning } : {}),
})

// ── PART A: 主进程那份偏好存储（真实函数文本 + 真实 atomic-json + 临时 userData）────────────────

// 从 `app/main.js` 里把**具名函数**的原文切出来（按大括号配平，字符串/模板串里的括号不算）。
// 找不到就抛 —— 函数改名/搬走会让这条契约红，而不是静默测一个副本。
function sliceFunction (source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert(start >= 0, `app/main.js must still define ${name}() — 偏好存储那一段不许改名或搬走`)
  let depth = 0
  let inString = ''
  let escaped = false
  const open = source.indexOf('{', start)
  assert(open > start, `${name}() must have a body`)
  for (let at = open; at < source.length; at += 1) {
    const char = source[at]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (inString) { if (char === inString) inString = ''; continue }
    if (char === '"' || char === "'" || char === '`') { inString = char; continue }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, at + 1)
    }
  }
  throw new Error(`cannot slice ${name}() out of app/main.js`)
}

const PREFERENCE_FUNCTIONS = [
  'codesysPreferencesPath',
  'readCodesysPreferences',
  'writeCodesysPreferences',
  'codesysAiModelPreferenceOf',
  'readCodesysAiModelPreference',
  'writeCodesysAiModelPreference',
  'codesysAiModelSelectionFromId',
  'codesysAiModelRememberedFromSelect',
]

/**
 * Build a fresh "main process" around ONE userData directory.
 *
 * A NEW call = a new vm context over the same file = what a restart looks like from the file's point
 * of view: nothing carried in memory, only what is on disk. It requires the REAL `app/atomic-json.js`,
 * so a change to the storage mechanism breaks this contract instead of being papered over.
 *
 * @param userData - directory the stubbed `app.getPath('userData')` returns.
 * @returns the extracted real functions plus the problems the reader reported.
 */
function createPreferenceHost (userData) {
  const problems = []
  const file = /const CODESYS_PREFERENCES_FILE = '([^']+)'/.exec(mainSource)
  const key = /const CODESYS_AI_MODEL_PREFERENCE_KEY = '([^']+)'/.exec(mainSource)
  assert(file, 'app/main.js must still name the preference file in CODESYS_PREFERENCES_FILE')
  assert(key, 'app/main.js must name the remembered-model field in CODESYS_AI_MODEL_PREFERENCE_KEY')
  const code = [
    `const CODESYS_PREFERENCES_FILE = ${json(file[1])};`,
    `const CODESYS_AI_MODEL_PREFERENCE_KEY = ${json(key[1])};`,
    ...PREFERENCE_FUNCTIONS.map((name) => sliceFunction(mainSource, name)),
    'globalThis.__prefs = { codesysPreferencesPath, readCodesysPreferences, writeCodesysPreferences, codesysAiModelPreferenceOf, readCodesysAiModelPreference, writeCodesysAiModelPreference, codesysAiModelSelectionFromId, codesysAiModelRememberedFromSelect, CODESYS_AI_MODEL_PREFERENCE_KEY, CODESYS_PREFERENCES_FILE };',
  ].join('\n')
  const { readJson, writeJson } = require('../app/atomic-json')
  const sandbox = {
    app: { getPath: (name) => (name === 'userData' ? userData : userData) },
    path,
    readJson,
    writeJson,
    reportBootstrapProblem: (message) => problems.push(String(message)),
    console,
  }
  const context = vm.createContext(sandbox)
  vm.runInContext(code, context, { filename: mainFile })
  return { api: sandbox.__prefs, problems, file: path.join(userData, file[1]), key: key[1] }
}

function preferenceChecks () {
  const userData = createTempDir('taskhive-ai-model-preference-')
  const host = createPreferenceHost(userData)
  const api = host.api

  // ① 显式切换 ⇒ 偏好被写入（模型**与强度**都在），而且是写进与"启动时预打开"同一份文件
  {
    // 先写另一个字段，证明两次写入是**补丁式合并**的（互相不抹掉）。
    api.writeCodesysPreferences({ preopenOnStart: false })
    api.writeCodesysAiModelPreference({ provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'max' })
    assert(fs.existsSync(host.file), `the preference must be written to ${host.file}`)
    const onDisk = JSON.parse(fs.readFileSync(host.file, 'utf8'))
    assert.deepStrictEqual(onDisk[host.key], { provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'max' },
      `the stored selection must carry provider + model + reasoningEffort, got ${json(onDisk[host.key])}`)
    assert.strictEqual(onDisk.preopenOnStart, false,
      'writing the model preference must not drop the pre-open switch that lives in the SAME file')
    console.log(`[自测①] 显式切换 ⇒ ${path.basename(host.file)} 里的 ${host.key} = ${json(onDisk[host.key])}（同文件 preopenOnStart=${json(onDisk.preopenOnStart)} 原样保留）`)
  }

  // ② "重启" ⇒ 新进程重新读盘，模型与强度都还在
  {
    const restarted = createPreferenceHost(userData)
    // 跨 vm 上下文的对象来自另一个 realm（原型不同），所以按 JSON 逐字比较。
    assert.strictEqual(json(restarted.api.readCodesysAiModelPreference()), json({ provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'max' }),
      'after a restart (a brand-new context over the same userData) the remembered selection must read back with its effort')
    assert.strictEqual(restarted.problems.length, 0, `reading a healthy file must not report a problem: ${json(restarted.problems)}`)
    console.log(`[自测②] "重启"后重新读盘 ⇒ ${json(restarted.api.readCodesysAiModelPreference())}（全新上下文，只有盘上那份）`)
  }

  // ③ 没存过 ⇒ 读到 null（外壳据此走默认值，且一个请求都不发）
  {
    const empty = createPreferenceHost(createTempDir('taskhive-ai-model-empty-'))
    assert.strictEqual(empty.api.readCodesysAiModelPreference(), null, 'a first run must read back "nothing remembered"')
    assert.strictEqual(fs.existsSync(empty.file), false, 'reading must not create the file')
    console.log('[自测③] 没存过 ⇒ readCodesysAiModelPreference() = null（且不建文件）')
  }

  // ④ 没有强度的那次选择：存下来就只有 provider+model（T202 口径 —— 不替用户记一个他没选的档位）
  {
    const dir = createTempDir('taskhive-ai-model-noeffort-')
    const plain = createPreferenceHost(dir)
    plain.api.writeCodesysAiModelPreference({ provider: PROVIDER, model: FLASH_MODEL })
    const onDisk = JSON.parse(fs.readFileSync(plain.file, 'utf8'))
    assert.deepStrictEqual(onDisk[plain.key], { provider: PROVIDER, model: FLASH_MODEL },
      'a selection with no explicit effort must be stored WITHOUT a reasoningEffort field')
    assert(!('reasoningEffort' in onDisk[plain.key]), 'no empty-string effort field may be written')
    // 数据桥回报的默认档**不**算用户的选择：provider/model 取 `selected`，强度只认请求里带的那个。
    const fromResponse = plain.api.codesysAiModelRememberedFromSelect(
      { ok: true, selected: { provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'high' }, effort: 'high' }, PRO_ID, '')
    assert.strictEqual(json(fromResponse), json({ provider: PROVIDER, model: PRO_MODEL }),
      'the remembered record must take the effort from the REQUEST, never from the provider default the bridge echoed back')
    console.log(`[自测④] 只切模型（没带强度）⇒ 盘上 = ${json(onDisk[plain.key])}；桥回报的默认档不会被当成用户选择（${json(fromResponse)}）`)
  }

  // ⑤ 半条记忆不写：缺 provider / 缺 model 一律返回 null 且不动盘上的内容
  {
    const dir = createTempDir('taskhive-ai-model-invalid-')
    const invalid = createPreferenceHost(dir)
    invalid.api.writeCodesysAiModelPreference({ provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'low' })
    const before = fs.readFileSync(invalid.file, 'utf8')
    for (const bad of [{ provider: PROVIDER }, { model: PRO_MODEL }, {}, null, 'deepseek-official/x', { provider: '', model: 'x' }]) {
      assert.strictEqual(invalid.api.writeCodesysAiModelPreference(bad), null, `an incomplete selection must not be stored: ${json(bad)}`)
    }
    assert.strictEqual(fs.readFileSync(invalid.file, 'utf8'), before, 'a rejected write must leave the file byte-identical')
    assert.strictEqual(invalid.api.codesysAiModelSelectionFromId('nonsense'), null, 'an id without a provider/model split must yield no selection')
    console.log('[自测⑤] 半条记忆（缺 provider / 缺 model / 非法 id）⇒ 一个字节都不写')
  }
}

// ── PART B: 抽屉（真实 renderer.js + mini-DOM）──────────────────────────────────────────────

const CATALOG = (options = {}) => ({
  ok: true,
  sessionId: SESSION_ID,
  hasSession: true,
  sessionDetail: '',
  source: 'remote.session.modelCatalog',
  current: options.current === undefined ? row(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING) : options.current,
  available: options.available || [
    row(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING),
    row(FLASH_ID, FLASH_MODEL, 'DeepSeek V4 Flash', undefined),
    row(LONG_ID, LONG_MODEL, 'DeepSeek V4 Pro Long', REAL_REASONING),
  ],
  blocked: options.blocked || [],
  routableProviders: [PROVIDER],
  catalogError: '',
  failures: [],
  // 主进程那份记忆（`codesys:ai-chat-model` 的 `list` 一并带回）。没有这个字段 = 从来没存过。
  ...(options.remembered ? { remembered: options.remembered } : {}),
})

// 快照：`model` 就是会话 `modelSelection` 投影里的 `next`（shard 78 的 `codesysAiChatModelSummary`），
// **没有**被目录默认值兜底过 —— `null` 就是"这条会话还没有显式选过模型"，那正是重启后的新会话。
const SNAPSHOT = (model, sessionId = SESSION_ID) => ({
  ok: true,
  sessionId,
  total: 1,
  messages: [{ role: 'user', seq: 1, text: '你好' }],
  running: false,
  model,
})

// 一个假选项节点：真 DOM 里它们是 `menu.innerHTML` 生成后查回来的，mini-DOM 不做 HTML 解析，
// 所以指针路径直接把"被点到的那一条"按真实属性形状喂给委托（与既有抽屉契约同一招）。
const optionNode = (attributes) => ({
  getAttribute: (name) => (name in attributes ? attributes[name] : null),
  textContent: attributes.textContent === undefined ? '' : attributes.textContent,
})
const optionTarget = (node) => ({ closest: (selector) => (selector === '.codesys-ai-model-option' ? node : null) })

function createDrawer (options = {}) {
  const calls = { model: [], snapshot: [], touched: [] }
  const timers = { created: 0 }
  const taskhive = createTaskhiveStub({
    harnessStatus: async () => ({ runtime: { state: 'ready' } }),
    listPlugins: async () => [],
    harnessUrl: async () => null,
    codesysAiChatSnapshot: async (input) => {
      calls.snapshot.push(input || {})
      return options.snapshot === undefined ? SNAPSHOT(null) : options.snapshot
    },
    codesysAiChatModel: async (input) => {
      calls.model.push(input)
      if (input && input.action === 'select') {
        return options.selectResult === undefined
          ? { ok: true, model: input.id, effort: input.effort || '', current: row(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING) }
          : options.selectResult
      }
      return options.catalog === undefined ? CATALOG() : options.catalog
    },
  })
  // 记下这一轮**碰过哪些** IPC 方法：恢复路径除了模型通道之外一个都不许碰（= 没有写入 / 编译 / 确认）。
  const stub = new Proxy(taskhive, {
    get (target, key) {
      if (typeof key === 'string' && key.startsWith('codesys')) calls.touched.push(key)
      return target[key]
    },
  })
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
      '#codesys-ai-effort-seat': {},
      '#codesys-ai-effort': {},
      '#codesys-ai-effort-name': {},
      '#codesys-ai-effort-menu': {},
    },
    taskhive: stub,
  })
  // 记"有没有新建定时器"：`window.setTimeout` 与沙箱里的 `setTimeout` 是同一份实现，两边都要包。
  const countTimer = (original) => (...args) => { timers.created += 1; return original(...args) }
  scene.setTimeout = countTimer(scene.setTimeout)
  scene.window.setTimeout = countTimer(scene.window.setTimeout)
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: ['bindCodesysAiChatUi', 'codesysAiChatApplySnapshot', 'codesysAiChatPullSnapshot', 'codesysAiChatRefreshModels', 'state'],
  })
  return { ...loaded, calls, timers }
}

/**
 * A drawer with its catalog loaded, the panel open, and ONE snapshot already applied — the state the
 * user is in right after opening the AI drawer following a restart.
 *
 * @param options - `{ catalog, snapshot, selectResult, applySnapshot }`.
 */
async function settledDrawer (options = {}) {
  const created = createDrawer(options)
  await flush()
  created.api.bindCodesysAiChatUi()
  created.api.state.codesysAiChatOpen = true
  await created.api.codesysAiChatRefreshModels({ force: true })
  if (options.skipSnapshot !== true) created.api.codesysAiChatApplySnapshot(options.snapshot === undefined ? SNAPSHOT(null) : options.snapshot)
  await flush()
  return created
}

const selectCalls = (calls) => calls.model.filter((input) => input && input.action === 'select')

async function rendererChecks () {
  // ── ② 重启后新会话：模型**与强度**都被恢复（且只发这一次；成功路径零文字）────────────────────
  {
    const remembered = { provider: PROVIDER, model: LONG_MODEL, reasoningEffort: 'low' }
    const drawer = await settledDrawer({ catalog: CATALOG({ remembered }), snapshot: SNAPSHOT(null) })
    const selects = selectCalls(drawer.calls)
    assert.strictEqual(selects.length, 1,
      `a fresh session (empty modelSelection projection) with a remembered selection must produce exactly ONE select, saw ${json(selects)}`)
    assert.strictEqual(json(selects[0]), json({ action: 'select', id: LONG_ID, effort: 'low', source: 'restore' }),
      'the restore must go through the SAME channel/action as a click and must carry the remembered reasoningEffort')
    assert.strictEqual(drawer.scene.requireNode('#codesys-ai-model-note').textContent, '', '成功路径**零文字**（座位上更新后的模型短名就是确认）')
    console.log(`[自测①-恢复] 新会话 ⇒ IPC = ${json(selects[0])} · 说明行 = ${json(drawer.scene.requireNode('#codesys-ai-model-note').textContent)}`)

    // 一条会话只决策一次：后续快照（投影还没回流的那几拍）**不再**重发、也**不再**碰任何 IPC。
    const before = drawer.calls.touched.length
    const timersBefore = drawer.timers.created
    for (let index = 0; index < 4; index += 1) drawer.api.codesysAiChatApplySnapshot(SNAPSHOT(null))
    await flush()
    assert.strictEqual(selectCalls(drawer.calls).length, 1, 'the restore must happen ONCE per session, not once per 1.5s poll')
    assert.strictEqual(drawer.timers.created, timersBefore, '恢复路径不得新建任何定时器（走的是既有那一条 1.5 秒轮询）')
    const afterRestore = drawer.calls.touched.slice(before)
    assert.deepStrictEqual(afterRestore, [], `恢复之后那 4 拍快照不许再碰任何 IPC（实际 ${json(afterRestore)}）`)
    // 整个抽屉生命周期里碰过的 IPC：只有模型通道。写入工程 / 编译 / 确认 / 发送 / 作答一个都不在这条链上
    //（用户口径里那条"零写动作"的红线：恢复选择不是一次会话动作之外的事）。
    const touched = [...new Set(drawer.calls.touched)]
    for (const forbidden of ['codesysAiChatPrompt', 'codesysAiChatApply', 'codesysAiChatAnswer']) {
      assert(!touched.includes(forbidden), `the restore path must never touch ${forbidden} (no write/compile/confirm/prompt)`)
    }
    assert(touched.includes('codesysAiChatModel'), 'the restore itself must have gone through the model channel')
    assert.deepStrictEqual(touched.filter((name) => name !== 'codesysAiChatModel'), [],
      `the restore must touch the model channel and NOTHING else, saw ${json(touched)}`)
    console.log(`[自测⑥] 后续 4 拍快照 ⇒ 仍然只发过 ${selectCalls(drawer.calls).length} 次 select · 新增定时器 ${drawer.timers.created - timersBefore} 个 · 恢复后再碰的 IPC = ${json(afterRestore)} · 这一轮碰过的 IPC = ${json(touched)}`)
  }

  // ── ③ 从来没存过 ⇒ 走默认，且**不多发调用** ────────────────────────────────────────────────
  {
    const drawer = await settledDrawer({ catalog: CATALOG(), snapshot: SNAPSHOT(null) })
    for (let index = 0; index < 4; index += 1) {
      await drawer.api.codesysAiChatPullSnapshot()
      await drawer.api.codesysAiChatRefreshModels({ force: true })
    }
    await flush()
    assert.strictEqual(drawer.calls.snapshot.length >= 4, true, 'the snapshots must really have been taken (otherwise this assertion is empty)')
    assert.strictEqual(selectCalls(drawer.calls).length, 0,
      'with nothing remembered the drawer must send ZERO select calls and simply run on the catalog default')
    console.log(`[自测③] 没存过 ⇒ ${drawer.calls.snapshot.length} 次快照 + 5 次目录刷新 → select IPC = 0 次（走默认值）`)
  }

  // ── ⑤ 会话里已经有**显式**选择 ⇒ 一个请求都不发（不 clobber）──────────────────────────────
  {
    const explicit = { id: PRO_ID, provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'high', label: 'DeepSeek 官方 · DeepSeek V4 Pro' }
    const drawer = await settledDrawer({
      catalog: CATALOG({ remembered: { provider: PROVIDER, model: FLASH_MODEL, reasoningEffort: 'low' } }),
      snapshot: SNAPSHOT(explicit),
    })
    for (let index = 0; index < 3; index += 1) drawer.api.codesysAiChatApplySnapshot(SNAPSHOT(explicit))
    await flush()
    assert.strictEqual(drawer.api.state.codesysAiChatSessionSelection.id, PRO_ID, 'the snapshot must record the session\'s own explicit selection')
    assert.strictEqual(selectCalls(drawer.calls).length, 0,
      'a session that already has an explicit selection must NEVER be overwritten by the remembered one')
    console.log(`[自测⑤] 会话现值 = ${PRO_ID}（显式）· 记忆 = ${FLASH_ID}@low ⇒ select IPC = 0 次（会话现值优先）`)
  }

  // ── ④ 存的东西不可用 ⇒ 静默退回默认：只有主进程那行审计说真话，界面一个字都不写 ─────────────
  {
    const drawer = await settledDrawer({
      catalog: CATALOG({ remembered: { provider: 'gone-provider', model: 'retired-model' } }),
      snapshot: SNAPSHOT(null),
      selectResult: { ok: false, reason: 'unknown-model', detail: '模型 gone-provider/retired-model 不在可用目录里（当前可用 2 个）' },
    })
    const selects = selectCalls(drawer.calls)
    assert.strictEqual(selects.length, 1,
      'an unavailable remembered model must still be attempted ONCE — that attempt is what writes the honest audit line (reason + model)')
    assert.strictEqual(json(selects[0]), json({ action: 'select', id: 'gone-provider/retired-model', effort: '', source: 'restore' }),
      'the attempt must name the remembered model so the audit says which one is gone')
    assert.strictEqual(drawer.scene.requireNode('#codesys-ai-model-note').textContent, '', '静默回退：界面不许出现任何文字')
    // "不谎报"：座位与目录里的 current 都还停在**真实的**当前值（目录默认值），没有被换成那个下架的模型。
    assert.strictEqual(drawer.api.state.codesysAiChatModels.current.id, PRO_ID,
      'the drawer must keep the real current model (the catalog default) — no optimistic "switched" claim')
    assert(!String(drawer.scene.requireNode('#codesys-ai-model-name').textContent).includes('retired-model'),
      'the seat label must not show the model that was just rejected')
    console.log(`[自测④] 记忆里的模型下架 ⇒ 1 次尝试（主进程记 ${json(selects[0].id)} 的 model-failed）· 说明行空 · 当前仍是 ${PRO_ID}（不谎报成功）`)
  }

  // ── ④-b 等级不在该模型声明的档位里 ⇒ 丢强度只留模型（与 T202 的校验口径一致）────────────────
  {
    const unknownEffort = await settledDrawer({
      catalog: CATALOG({ remembered: { provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'ultra' } }),
      snapshot: SNAPSHOT(null),
    })
    const unknownSelects = selectCalls(unknownEffort.calls)
    assert.strictEqual(unknownSelects.length, 1, 'a stale effort must not stop the model from being restored')
    assert.strictEqual(unknownSelects[0].effort, '', `an effort outside the model's declared list must be dropped (saw ${json(unknownSelects[0])})`)
    assert.strictEqual(unknownSelects[0].id, PRO_ID, 'the model itself is still restored')
    console.log(`[自测④-b] 记忆里的等级 'ultra' 不在档位里 ⇒ 发出的仍是模型 + 空等级：${json(unknownSelects[0])}`)

    // 模型自己**没有** reasoning 能力 ⇒ 同样只留模型（T202 第一道防御）
    const noCapability = await settledDrawer({
      catalog: CATALOG({ remembered: { provider: PROVIDER, model: FLASH_MODEL, reasoningEffort: 'high' } }),
      snapshot: SNAPSHOT(null),
    })
    const noCapSelects = selectCalls(noCapability.calls)
    assert.strictEqual(noCapSelects.length, 1, 'a model with no reasoning capability must still be restored (model only)')
    assert.strictEqual(json(noCapSelects[0]), json({ action: 'select', id: FLASH_ID, effort: '', source: 'restore' }),
      'a model that declares no reasoning must never be sent an effort')
    console.log(`[自测④-c] 记忆里带等级、模型不支持等级 ⇒ ${json(noCapSelects[0])}`)
  }

  // ── ⑥ 用户刚在这条会话里显式换过（投影还没回流的那一拍）⇒ 恢复必须让位 ──────────────────────
  {
    const drawer = await settledDrawer({ catalog: CATALOG({ remembered: { provider: PROVIDER, model: PRO_MODEL } }), snapshot: SNAPSHOT(null) })
    // 第一次打开时记忆正好等于这条会话的现值？换成"先让恢复被消费掉"，再模拟用户点击。
    const baseline = selectCalls(drawer.calls).length
    drawer.scene.requireNode('#codesys-ai-model-menu').dispatchEvent({
      type: 'click',
      target: optionTarget(optionNode({ 'data-ai-model': FLASH_ID, 'aria-selected': 'false' })),
    })
    await flush()
    const afterClick = selectCalls(drawer.calls)
    assert.strictEqual(afterClick.length, baseline + 1, 'the click itself must go through (one select)')
    assert.strictEqual(afterClick[afterClick.length - 1].id, FLASH_ID, 'the user\'s own click selects what the user clicked')
    assert.strictEqual(drawer.api.state.codesysAiChatModelPickedSession, SESSION_ID, 'an explicit user switch must mark this session')
    // 投影晚一拍：这一帧快照里 `model` 还是空的 —— 恢复**不许**在这时候把用户的选择盖回去。
    const timersBefore = drawer.timers.created
    for (let index = 0; index < 3; index += 1) drawer.api.codesysAiChatApplySnapshot(SNAPSHOT(null))
    await flush()
    assert.strictEqual(selectCalls(drawer.calls).length, afterClick.length,
      'while the projection lags behind a user click, the restore must NOT fire and clobber it')
    assert.strictEqual(drawer.timers.created, timersBefore, 'the restore path must not create timers')
    console.log(`[自测⑥-b] 用户点击 ${FLASH_ID} 后、投影未回流的 3 拍里 ⇒ select IPC 数不变（${afterClick.length} 次，没有覆盖用户的选择）`)
  }

  // ── ② 新会话建立后仍然恢复（一条会话一次决策，不是"一辈子只恢复一次"）────────────────────────
  {
    const NEXT_SESSION = 'session-231-codesys-drawer-2'
    const drawer = await settledDrawer({
      catalog: CATALOG({ remembered: { provider: PROVIDER, model: LONG_MODEL, reasoningEffort: 'max' } }),
      snapshot: SNAPSHOT(null, SESSION_ID),
    })
    assert.strictEqual(selectCalls(drawer.calls).length, 1, 'the first session is restored')
    drawer.api.codesysAiChatApplySnapshot(SNAPSHOT(null, NEXT_SESSION))
    await flush()
    const selects = selectCalls(drawer.calls)
    assert.strictEqual(selects.length, 2, `a NEW session must be restored again (saw ${json(selects)})`)
    assert.strictEqual(json(selects[1]), json({ action: 'select', id: LONG_ID, effort: 'max', source: 'restore' }), 'the new session gets the same remembered model + effort')
    assert.strictEqual(drawer.api.state.codesysAiChatSessionId, NEXT_SESSION, 'the drawer must track which session it is looking at')
    console.log(`[自测②-b] 换到新会话 ${NEXT_SESSION} ⇒ 再恢复一次：${json(selects[1])}`)
  }
}

// ── PART C: 静态面（通道 / 动作 / 载荷 / 界面文字 / 存储位置）──────────────────────────────────

function staticChecks () {
  // 通道与动作：**不新增**（等级与"记住的选择"都复用 codesys:ai-chat-model）。
  const modelChannels = mainSource.match(/handleTrusted\('codesys:ai-chat/g) || []
  assert.strictEqual(modelChannels.length, 6, `the six codesys:ai-chat* channels must stay exactly six, saw ${modelChannels.length}`)
  assert(!preloadSource.includes("'codesys:ai-chat-model-remember'") && !mainSource.includes("'codesys:ai-chat-model-remember'"),
    '不得为"记住/恢复"新增通道')
  assert(!mainSource.includes("'codesys:ai-chat-preference'") && !mainSource.includes("'settings:codesys-ai-model'"),
    '不得为"记住/恢复"新增通道')
  const baseline = JSON.parse(fs.readFileSync(path.join(appRoot, 'tools', 'ipc-contract-baseline.json'), 'utf8'))
  assert(!baseline.channels.some((channel) => /ai-model|ai-chat-preference|codesys-preferences/.test(channel)),
    'the IPC baseline must not have gained a preference channel')
  // preload 一个字都不用改：`input` 原样透传（新字段 `source` 就是顺着它过去的）。
  assert(preloadSource.includes("codesysAiChatModel: (input) => ipcRenderer.invoke('codesys:ai-chat-model', input || {})"),
    'preload 必须仍是 input 原样透传（所以记住/恢复不需要新的 preload 方法）')

  // 主进程：记住 + 读回，都走**既有**那份偏好文件与既有 atomic-json 读写。
  assert(mainSource.includes("const CODESYS_AI_MODEL_PREFERENCE_KEY = 'aiModelSelection'"),
    'the remembered selection must live in a named field of the existing codesys-preferences.json')
  assert(mainSource.includes('return codesysAiModelPreferenceOf(readCodesysPreferences()[CODESYS_AI_MODEL_PREFERENCE_KEY]);'),
    'reading must go through readCodesysPreferences() (the same file as the pre-open switch)')
  assert(mainSource.includes('writeCodesysPreferences({ [CODESYS_AI_MODEL_PREFERENCE_KEY]: normalized });'),
    'writing must go through writeCodesysPreferences() (patch merge, atomic-json) — not a second storage mechanism')
  assert(mainSource.includes('remembered: readCodesysAiModelPreference(), frames: result.frames, frame: result.frame'),
    'the list action must hand the remembered selection back (no new channel, no new action)')
  assert(mainSource.includes('remembered = writeCodesysAiModelPreference(codesysAiModelRememberedFromSelect(value, id, effort));'),
    'a SUCCESSFUL select must record what was chosen')
  assert(/if \(value\.ok === true\) \{\s*\n\s*try \{ remembered = writeCodesysAiModelPreference/.test(mainSource),
    'the record must be written only on a successful select (a failed switch must not be remembered as if it had happened)')
  assert(mainSource.includes("writeCodesysPreferences({ [CODESYS_AI_MODEL_PREFERENCE_KEY]: normalized })"),
    'the patch must be field-scoped so preopenOnStart survives')
  // 桥调用载荷形状一字不变，且 `source` **不**进数据桥（它只是审计用的来源标记）。
  assert(mainSource.includes("codesysAiChatBridgeCall('setModel', effort ? { id, effort } : { id })"),
    'the bridge payload must stay byte-identical: { id } / { id, effort } (source is audit-only)')
  assert(!/codesysAiChatBridgeCall\('setModel'[^\n]*source/.test(mainSource),
    '`source` must never be forwarded to the DSH bridge')
  assert(mainSource.includes('...(source ? { source } : {}),'),
    'the audit line must carry the source only when a caller gave one (user clicks keep the old line shape)')

  // 数据桥（DSH 侧）**一个字节都不用改**：记住/恢复全在外壳 + 主进程 ⇒ 不需要重建 bundle。
  assert(!bridgeSource.includes('aiModelSelection') && !bridgeSource.includes('codesys-preferences'),
    'shard 78 must not learn about the preference file: remembering/restoring stays in the shell + main process')

  // 渲染层：恢复路径**不写任何界面文字**、不碰 localStorage、不新增定时器、不绕回用户点击那条函数。
  // 先把整行注释摘掉：这段的注释里就点着那两个函数名（说明"为什么要让位"），判据只对**代码**成立。
  const codeOf = (text) => String(text).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
  const restoreBody = codeOf(sliceFunction(rendererSource, 'codesysAiChatRestoreRememberedModel'))
  for (const forbidden of ['codesysAiChatSetModelNote', 'codesysAiChatSetStatus', 'localStorage', 'setTimeout', 'setInterval', 'codesysAiChatChangeModel', 'codesysAiChatChangeEffort']) {
    assert(!restoreBody.includes(forbidden), `the restore path must not contain ${forbidden}`)
  }
  assert(restoreBody.includes("action: 'select'") && restoreBody.includes("source: 'restore'"),
    'the restore must reuse the existing select action and mark itself in the audit')
  assert(rendererSource.includes('state.codesysAiChatSessionSelection = (result.model && result.model.id)'),
    'the drawer must take the "has this session an explicit selection" fact from the snapshot projection')
  assert(rendererSource.includes('void codesysAiChatRestoreRememberedModel().catch(() => null);'),
    'the snapshot path must call the restore without ever leaking an unhandled rejection')
  assert(!rendererSource.includes('aiModelSelection'),
    'the renderer must not know the storage layout: it goes through IPC (same discipline as the pre-open switch)')
  // 用户显式切换的两个入口都要打"让位"标记（投影可能晚一拍）。
  const picks = rendererSource.match(/state\.codesysAiChatModelPickedSession = String\(state\.codesysAiChatSessionId \|\| '\*'\);/g) || []
  assert.strictEqual(picks.length, 2,
    `both explicit switch entry points (model + effort) must mark the session so the restore yields, saw ${picks.length}`)

  console.log('[自测⑦] 静态面：通道 6 条不变 · preload 不变 · 数据桥 0 改动 · 恢复路径 0 文字/0 定时器/0 localStorage · 两个显式入口都打了让位标记')
}

async function main () {
  preferenceChecks()
  await rendererChecks()
  staticChecks()
  console.log('codesys AI model preference behaviour passed (user switch is remembered in userData/codesys-preferences.json with its effort; a new session restores it once, silently; an existing explicit session selection is never clobbered; an unavailable model falls back to the default with only an audit line telling the truth; no new channel, no new action, no new timer)')
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
