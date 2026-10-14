'use strict'

// T186：抽屉里的**思考强度（推理等级 / reasoningEffort）**选择。
//
// 用户要求（本轮）：给「AI 对话」抽屉加思考强度选择，UI 与既有模型选择同款；等级**不要自造枚举**，
// 从模型描述符的 `reasoning` 能力取；模型不支持时**不显示**该控件；四层串起来（渲染层 → preload →
// main → 数据桥 → `select` / `selectModel` 带 effort）；成功路径零新增常驻文字；失败一行可读原因；
// `reasoningEffort` 必须走**会话级**，且不得触发任何写入 / 编译 / 确认。
//
// 这条契约**驱动真实源码**，不是副本：
//   PART A —— `dsh/src/78-codesys-ai-chat.js`（数据桥）在 `vm` 里对着一个**真实形状**的假 DSH 跑：
//             `models()` 必须把每个模型的 `reasoning` 能力原样带出来；`setModel({ id, effort })`
//             必须把 `reasoningEffort` 真的送进 `directory.select` / `remote.session.selectModel`
//             （两个落点都断言）；不支持等级的模型 / 不在清单里的档位都必须被挡在发请求之前。
//   PART B —— `app/renderer/renderer.js`（抽屉）在 mini-DOM 上跑：支不支持决定控件显不显示、
//             档位清单来自能力面、选一档真的带进 IPC、失败一行可读原因、无点击 0 次 effort IPC、
//             既有模型座位与输入行顺序不回归。
//
// 等级清单的**真包来源**（本文件里 fixture 的那四条就是照它写的，不是自造）：
//   * `@deepseek-ai/dsh-llm-deepseek/lib/index.js:452-477` ——
//     `REASONING_EFFORTS = [{ id: ReasoningEffortId('off'), name: 'Off' }, low/'Low', high/'High', max/'Max']`；
//   * `@deepseek-ai/dsh-llm-deepseek/lib/index.js:503-524` 的 `modelInfo()` ——
//     模型描述符带的正是 `reasoning: { efforts: REASONING_EFFORTS, defaultEffort: … }`；
//   * `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:121` ——
//     客户端把 `group.models[].reasoning` 原样存进 `reasoning` Map（就是这条数据流）；
//     `:782` 用它决定画不画那一格；`:522`/`:524-532` 决定当前档位与档位清单。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')

const appRoot = path.join(__dirname, '..')
const dshRoot = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh')
const bridgeFile = path.join(dshRoot, 'src', '78-codesys-ai-chat.js')
const rendererFile = path.join(appRoot, 'app', 'renderer', 'renderer.js')

const SESSION_ID = 'session-186-codesys-drawer'
const PROVIDER = 'deepseek-official'
const PRO_MODEL = 'deepseek-v4-pro'
const FLASH_MODEL = 'deepseek-v4-flash'
const PRO_ID = `${PROVIDER}/${PRO_MODEL}`
const FLASH_ID = `${PROVIDER}/${FLASH_MODEL}`

const json = (value) => JSON.stringify(value)

// ── 真包那份等级清单（`dsh-llm-deepseek/lib/index.js:456-477` 的 `REASONING_EFFORTS`）──────────
const REAL_EFFORTS = [
  { id: 'off', name: 'Off', description: 'Use for simple tasks that do not need reasoning.' },
  { id: 'low', name: 'Low', description: 'Prefer for routine or latency-sensitive tasks.' },
  { id: 'high', name: 'High', description: 'The default balance for most tasks.' },
  { id: 'max', name: 'Max', description: 'Reserve for the hardest quality-first tasks.' },
]
const REAL_REASONING = { efforts: REAL_EFFORTS, defaultEffort: 'high' }

// host 侧目录里的模型描述符：`groups[].models[]` 的 `id` 是**裸模型 id**（provider 各自命名空间）。
const groupModel = (modelId, name, reasoning) => ({
  id: modelId,
  name,
  ...(reasoning ? { reasoning } : {}),
})

// 数据桥归一之后的那一行（`models()` 的 `available` / `current`）：`id` 是**复合键**
// `provider/model`，能力面跟着走。这两个形状必须区分开 —— 混用会让"改等级"改错模型
// （本轮就是被这条断言抓到的）。
const normalizedRow = (compositeId, modelId, name, reasoning) => ({
  id: compositeId,
  provider: PROVIDER,
  providerName: 'DeepSeek 官方',
  model: modelId,
  name,
  label: `DeepSeek 官方 · ${name}`,
  routable: true,
  ...(reasoning ? { reasoning } : {}),
})

// ── PART A: the data bridge ────────────────────────────────────────────────────────────────

/**
 * Build the REAL shard 78 in a `vm` against a fake DSH document whose shape is the one the bridge
 * really reads, and capture what it hands to the two real model-selection seams.
 * @param options - `{ groupModels, selectOutcome, selectModelOutcome }`.
 * @returns the installed bridge plus the captured seam calls.
 */
function createBridge (options = {}) {
  const calls = { directorySelect: [], remoteSelectModel: [], catalog: 0 }
  const groupModels = options.groupModels || [groupModel(PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING), groupModel(FLASH_MODEL, 'DeepSeek V4 Flash', undefined)]
  const directory = {
    load: async () => ({ current: { provider: PROVIDER, model: PRO_MODEL }, routable: true, groups: [{ id: PROVIDER, name: 'DeepSeek 官方', models: groupModels }], failures: [], status: 'ready' }),
    select: async (selection) => {
      calls.directorySelect.push(selection)
      return options.selectOutcome === undefined ? { ok: true } : options.selectOutcome
    },
  }
  const remoteSession = {
    modelCatalog: async () => {
      calls.catalog += 1
      return { ok: true, value: { default: { provider: PROVIDER, model: PRO_MODEL }, routableProviders: [PROVIDER], groups: [{ id: PROVIDER, name: 'DeepSeek 官方', models: groupModels }], failures: [] } }
    },
    selectModel: async (selection) => {
      calls.remoteSelectModel.push(selection)
      return options.selectModelOutcome === undefined ? { ok: true, value: { selected: { provider: selection.provider, model: selection.model, ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}) } } } : options.selectModelOutcome
    },
  }
  const sessions = {
    list: {
      getSnapshot: () => ({
        ids: [SESSION_ID],
        byId: { [SESSION_ID]: { id: SESSION_ID, retainedBy: { mainView: 1 }, running: false } },
        phase: 'ready',
      }),
    },
    binding: () => ({
      session: {
        getSnapshot: () => ({ nodes: [] }),
        prompt: async () => ({}),
        // 会话级投影：这一份就是"下一次请求真的会用哪个模型/哪一档等级"的权威值。
        projections: { faceOf: () => ({ getSnapshot: () => ({ next: options.projectedNext || { provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'high' } }) }) },
      },
    }),
  }
  const uiSession = {
    current: { getSnapshot: () => ({ key: SESSION_ID, hooks: {} }) },
    sessionStatus: { getSnapshot: () => new Map([[SESSION_ID, { running: false, pendingInteraction: null }]]) },
  }
  const services = { modelDirectories: { directoryFor: () => directory }, remote: { session: remoteSession } }
  const ctx = {
    sessions,
    uiSession,
    get: (name) => (name === 'uiSession' ? uiSession : (name === 'sessions' ? sessions : undefined)),
    // T178：`ctx.get(name)` 是不要求 inject 的读法 —— shard 78 就是这么取 modelDirectories / remote 的。
    reflect: { get: (name) => services[name], props: {} },
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
  return { api, calls }
}

async function bridgeChecks () {
  // ── A1. `models()` 把每个模型的 reasoning 能力原样带出来（不支持的那个**没有**这个字段）──────
  {
    const { api } = createBridge()
    const catalog = await api.models()
    assert.strictEqual(catalog.ok, true, 'models() 必须读得到目录')
    const pro = catalog.available.find((item) => item.id === PRO_ID)
    const flash = catalog.available.find((item) => item.id === FLASH_ID)
    assert(pro, '目录里必须有 deepseek-v4-pro')
    assert(flash, '目录里必须有 deepseek-v4-flash')
    assert(pro.reasoning, '支持等级的模型必须带上 reasoning 能力面')
    assert.strictEqual(json(pro.reasoning.efforts), json(REAL_EFFORTS.map(({ id, name }) => ({ id, name }))),
      '等级清单必须是 provider 自己声明的那四条（id + name 原样，不自造枚举）')
    assert.strictEqual(pro.reasoning.defaultEffort, 'high', 'defaultEffort 必须原样带出来')
    assert.strictEqual(flash.reasoning, undefined, '不支持等级的模型**不得**被塞一个空的 reasoning 字段')
    console.log(`[自测①] models() 的等级来源 → ${PRO_ID}: ${json(pro.reasoning)}（真包 dsh-llm-deepseek/lib/index.js:456-477 的 REASONING_EFFORTS）`)
    console.log(`[自测②] 不支持等级的模型 → ${FLASH_ID}: reasoning=${json(flash.reasoning)}（外壳据此不显示控件）`)
  }

  // ── A3. `setModel({ id, effort })` 真的把 reasoningEffort 送进两个 select 落点 ───────────────
  {
    const { api, calls } = createBridge()
    const result = await api.setModel({ id: PRO_ID, effort: 'max' })
    assert.strictEqual(result.ok, true, 'setModel 必须成功')
    assert.strictEqual(calls.directorySelect.length, 1, '必须调用 modelDirectories 的 directory.select（与主页 composer 同一个服务）')
    assert.strictEqual(json(calls.directorySelect[0]), json({ provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'max' }),
      'directory.select 的载荷必须含 reasoningEffort（会话级写入的那一半）')
    assert.strictEqual(result.effort, 'max', '结果必须回报这次生效的等级')
    console.log(`[自测③-a] directory.select 收到 → ${json(calls.directorySelect[0])}`)
  }

  // ── A4. 不支持等级的模型 / 不在清单里的档位：**一个请求都不发**，只回一句可读原因 ─────────────
  {
    const { api, calls } = createBridge()
    const unsupported = await api.setModel({ id: FLASH_ID, effort: 'high' })
    assert.strictEqual(unsupported.ok, false, '不支持等级的模型必须拒绝带等级的写入')
    assert.strictEqual(unsupported.reason, 'effort-unsupported', 'reason 必须说清是"不支持等级"')
    assert(unsupported.detail.includes('不支持推理等级'), `detail 必须是一句可读原因，实际：${unsupported.detail}`)
    assert.strictEqual(calls.directorySelect.length + calls.remoteSelectModel.length, 0, '被挡下的请求绝不能落到 select 上')
    console.log(`[自测④-a] 不支持等级 → 0 次 select · ${unsupported.reason}: ${unsupported.detail}`)

    const unknown = await api.setModel({ id: PRO_ID, effort: 'ultra' })
    assert.strictEqual(unknown.ok, false, '不在清单里的档位必须拒绝')
    assert.strictEqual(unknown.reason, 'unknown-effort', 'reason 必须说清是"档位不在清单里"')
    assert(unknown.detail.includes('ultra'), `detail 必须带上那个档位名，实际：${unknown.detail}`)
    assert.strictEqual(calls.directorySelect.length + calls.remoteSelectModel.length, 0, '被挡下的请求绝不能落到 select 上')
    console.log(`[自测④-b] 未知档位 → 0 次 select · ${unknown.reason}: ${unknown.detail}`)
  }

  // ── A5. 老的裸 id 串仍然能用（向后兼容），且**不**带等级字段 ────────────────────────────────
  {
    const { api, calls } = createBridge()
    const legacy = await api.setModel(PRO_ID)
    assert.strictEqual(legacy.ok, true, '裸 id 串必须继续可用（主进程以外没有别的调用点，但兼容不能破）')
    assert.strictEqual(json(calls.directorySelect[0]), json({ provider: PROVIDER, model: PRO_MODEL }),
      '没要求改等级时，载荷形状必须与改动前**一字不差**（不额外发一个空 reasoningEffort）')
    console.log(`[自测⑥-a] 裸 id 串（不带等级）→ ${json(calls.directorySelect[0])}`)
  }

  // ── A6. 远端回退路径（没有 modelDirectories）同样带回 reasoningEffort ─────────────────────────
  {
    const calls = { remoteSelectModel: [] }
    const groupModels = [groupModel(PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING)]
    const remoteSession = {
      modelCatalog: async () => ({ ok: true, value: { default: { provider: PROVIDER, model: PRO_MODEL }, routableProviders: [PROVIDER], groups: [{ id: PROVIDER, name: 'DeepSeek 官方', models: groupModels }], failures: [] } }),
      selectModel: async (selection) => { calls.remoteSelectModel.push(selection); return { ok: true, value: { selected: { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort } } } },
    }
    const sessions = {
      list: { getSnapshot: () => ({ ids: [SESSION_ID], byId: { [SESSION_ID]: { id: SESSION_ID, retainedBy: { mainView: 1 } } }, phase: 'ready' }) },
      binding: () => ({ session: { prompt: async () => ({}), projections: { faceOf: () => ({ getSnapshot: () => ({ next: { provider: PROVIDER, model: PRO_MODEL } }) }) } } }),
    }
    const uiSession = { current: { getSnapshot: () => ({ key: SESSION_ID, hooks: {} }) }, sessionStatus: { getSnapshot: () => new Map([[SESSION_ID, { running: false }]]) } }
    const ctx = {
      sessions,
      uiSession,
      get: (name) => (name === 'uiSession' ? uiSession : (name === 'sessions' ? sessions : undefined)),
      reflect: { get: (name) => (name === 'remote' ? { session: remoteSession } : undefined), props: {} },
      root: null,
      fiber: null,
    }
    const sandbox = { window: {}, ctx, console, getOptionalService: (context, name) => (context ? context[name] : undefined) }
    const context = vm.createContext(sandbox)
    vm.runInContext(`${fs.readFileSync(bridgeFile, 'utf8')}\n;installCodesysAiChat(ctx); globalThis.__api = window.__TASKHIVE_CODESYS_AI_BRIDGE__;\n`, context, { filename: bridgeFile })
    const result = await sandbox.__api.setModel({ id: PRO_ID, effort: 'low' })
    assert.strictEqual(result.ok, true, '远端回退路径必须成功')
    assert.strictEqual(calls.remoteSelectModel.length, 1, '必须调用 remote.session.selectModel')
    assert.strictEqual(json(calls.remoteSelectModel[0]), json({ sessionId: SESSION_ID, provider: PROVIDER, model: PRO_MODEL, reasoningEffort: 'low' }),
      'remote.session.selectModel 的载荷必须含 sessionId + reasoningEffort（会话级）')
    console.log(`[自测③-b] remote.session.selectModel 收到 → ${json(calls.remoteSelectModel[0])}`)
  }
}

// ── PART B: the drawer renderer ────────────────────────────────────────────────────────────

const CATALOG = (options = {}) => ({
  ok: true,
  sessionId: SESSION_ID,
  hasSession: true,
  sessionDetail: '',
  source: 'remote.session.modelCatalog',
  current: options.current === undefined ? normalizedRow(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING) : options.current,
  available: options.available || [normalizedRow(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING), normalizedRow(FLASH_ID, FLASH_MODEL, 'DeepSeek V4 Flash', undefined)],
  blocked: options.blocked || [],
  routableProviders: [PROVIDER],
  catalogError: '',
  failures: [],
})

function createRenderer (options = {}) {
  const calls = { model: [], snapshot: [] }
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
      // T186：第二枚胶囊 + 第二层浮层 + 它自己的座位外壳。
      '#codesys-ai-effort-seat': {},
      '#codesys-ai-effort': {},
      '#codesys-ai-effort-name': {},
      '#codesys-ai-effort-menu': {},
    },
    taskhive: createTaskhiveStub({
      harnessStatus: async () => ({ runtime: { state: 'ready' } }),
      listPlugins: async () => [],
      harnessUrl: async () => null,
      codesysAiChatSnapshot: async (input) => { calls.snapshot.push(input); return options.snapshot || null },
      codesysAiChatModel: async (input) => {
        calls.model.push(input)
        if (input && input.action === 'select') return options.selectResult === undefined ? { ok: true, model: input.id, effort: input.effort || '', current: normalizedRow(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', REAL_REASONING) } : options.selectResult
        return options.catalog === undefined ? CATALOG() : options.catalog
      },
    }),
  })
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: [
      'bindCodesysAiChatUi',
      'codesysAiChatApplySnapshot',
      'codesysAiChatPullSnapshot',
      'codesysAiChatRefreshModels',
      'codesysAiChatChangeModel',
      'codesysAiChatEffortCapability',
      'codesysAiChatEffortLevels',
      'codesysAiChatEffortSelectedValue',
      'codesysAiChatEffortLabel',
      'codesysAiChatEffortMenuOpen',
      'codesysAiChatModelMenuOpen',
      'codesysAiChatChangeEffort',
      'state',
    ],
  })
  assert.strictEqual(typeof loaded.api.codesysAiChatChangeEffort, 'function', 'renderer.js must define codesysAiChatChangeEffort()')
  return { ...loaded, calls }
}

const flush = async () => { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve)) }

async function settledRenderer (options = {}) {
  const created = createRenderer(options)
  await flush()
  created.api.bindCodesysAiChatUi()
  created.api.state.codesysAiChatOpen = true
  await created.api.codesysAiChatRefreshModels({ force: true })
  return created
}

// 一个假选项节点：真 DOM 里它们是 `menu.innerHTML` 生成后查回来的，mini-DOM 不做 HTML 解析，
// 所以指针路径直接把"被点到的那一条"按真实属性形状喂给委托（与既有抽屉测试同一招）。
const optionNode = (attributes) => ({
  getAttribute: (name) => (name in attributes ? attributes[name] : null),
  textContent: attributes.textContent === undefined ? '' : attributes.textContent,
})
const optionTarget = (node) => ({ closest: (selector) => (selector === '.codesys-ai-model-option' ? node : null) })

async function rendererChecks () {
  // ── ① 模型支持 effort ⇒ 控件出现，且等级清单取自能力面（真包那四条）──────────────────────
  {
    const { api, scene } = await settledRenderer()
    const seat = scene.requireNode('#codesys-ai-effort-seat')
    const menu = scene.requireNode('#codesys-ai-effort-menu')
    const name = scene.requireNode('#codesys-ai-effort-name')
    const capability = api.codesysAiChatEffortCapability()
    assert(capability, '支持等级的模型必须能读出能力面')
    assert.strictEqual(json(capability.efforts), json(REAL_EFFORTS.map(({ id, name: label }) => ({ id, name: label }))),
      '档位清单必须逐条等于 provider 声明的那四条')
    assert.strictEqual(json(api.codesysAiChatEffortLevels(capability).map((level) => [level.id, level.label])),
      json(REAL_EFFORTS.map((level) => [level.id, level.name])),
      'defaultEffort 已声明 ⇒ 菜单里就是那四档，**不**额外多一条 Default（与真包 client.js:524-532 一致）')
    assert.strictEqual(capability.defaultEffort, 'high', 'defaultEffort 必须透传到渲染层')
    assert.strictEqual(seat.hidden, false, '模型支持推理等级时控件必须显示')
    const markup = String(menu.innerHTML || '')
    for (const level of REAL_EFFORTS) {
      assert(markup.includes(`data-ai-effort="${level.id}"`), `浮层里必须有 ${level.id} 这一档`)
      assert(markup.includes(`>${level.name}<`), `浮层里必须用 provider 给的名字 ${level.name}`)
    }
    assert(markup.includes('aria-selected="true"'), '必须把当前档位标成已选')
    // 当前投影是 high ⇒ 座位短名 = "High"（defaultEffort 兜底，真包 client.js:522）
    assert.strictEqual(name.textContent, 'High', `座位短名必须是当前档位名，实际 ${json(name.textContent)}`)
    console.log(`[自测①] 控件出现 · 档位=${json(api.codesysAiChatEffortLevels(capability).map((level) => level.label))} · 座位短名=${json(name.textContent)} · defaultEffort=${json(capability.defaultEffort)}`)
    console.log(`[自测①-原文] 浮层里的等级项 → ${(markup.match(/data-ai-effort="[^"]*"/g) || []).join(' ')}`)

    // provider **没有**声明 defaultEffort ⇒ 多一条 "Default"（空串 = 不发 reasoningEffort）
    const noDefault = createRenderer({ catalog: CATALOG({ current: normalizedRow(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', { efforts: REAL_EFFORTS }) }) })
    await flush()
    noDefault.api.bindCodesysAiChatUi()
    await noDefault.api.codesysAiChatRefreshModels({ force: true })
    const levels = noDefault.api.codesysAiChatEffortLevels(noDefault.api.codesysAiChatEffortCapability())
    assert.strictEqual(levels[0].id, '' , '没声明 defaultEffort 时第一条必须是 Default（空串）')
    assert.strictEqual(levels[0].label, 'Default', 'Default 这一条的短名与真包 client.js:948 的 effort.providerDefault 一致')
    console.log(`[自测①-b] 未声明 defaultEffort ⇒ 第一条 = ${json(levels[0])}`)
  }

  // ── ② 模型不支持 effort ⇒ 控件**不显示**，而且浮层里一条不可选项都没有 ────────────────────────
  {
    const { api, scene } = await settledRenderer({
      catalog: CATALOG({ current: normalizedRow(FLASH_ID, FLASH_MODEL, 'DeepSeek V4 Flash', undefined) }),
    })
    const seat = scene.requireNode('#codesys-ai-effort-seat')
    const menu = scene.requireNode('#codesys-ai-effort-menu')
    assert.strictEqual(api.codesysAiChatEffortCapability(), null, '不支持等级的模型必须读不出能力面')
    assert.strictEqual(seat.hidden, true, '不支持推理等级时控件必须**不显示**（不是画一个禁用的空壳）')
    assert.strictEqual(String(menu.innerHTML || ''), '', '不显示时浮层里不许留任何不可选的档位')
    assert.strictEqual(api.codesysAiChatEffortMenuOpen(), false, '不显示时连"打开浮层"都必须是 no-op')
    console.log('[自测②] 模型不支持 ⇒ 控件 hidden=true · 浮层为空 · 打开是 no-op')

    // 目录读不到 / IPC 抛错 ⇒ 档位**不可验证**了，控件同样必须收起来（不许留一份可能过期的清单）。
    const readFailed = await settledRenderer({ catalog: { ok: false, reason: 'no-model-service', detail: 'DSH 文档里既没有 modelDirectories.directoryFor，也没有 remote.session.modelCatalog' } })
    assert.strictEqual(readFailed.scene.requireNode('#codesys-ai-effort-seat').hidden, true, '目录读失败时必须收起等级座位')
    assert.strictEqual(String(readFailed.scene.requireNode('#codesys-ai-effort-menu').innerHTML || ''), '', '目录读失败时浮层里不许留旧档位')
    console.log('[自测②-b] 目录读失败 ⇒ 等级座位收起（档位不可验证就不给选）')
  }

  // ── ③ 选一档 ⇒ 真的带进 IPC（payload 含 effort），并且 id 是**当前模型**（会话级）────────────
  {
    const { api, scene, calls } = await settledRenderer()
    const menu = scene.requireNode('#codesys-ai-effort-menu')
    menu.dispatchEvent({ type: 'click', target: optionTarget(optionNode({ 'data-ai-effort': 'max', 'aria-selected': 'false' })) })
    await flush()
    const selects = calls.model.filter((input) => input && input.action === 'select')
    assert.strictEqual(selects.length, 1, '一次点击必须产生且只产生一次 model select IPC')
    assert.strictEqual(json(selects[0]), json({ action: 'select', id: PRO_ID, effort: 'max' }),
      'IPC 载荷必须含 action/id/effort —— 这就是"四层串起来"的那一段')
    const seat = scene.requireNode('#codesys-ai-effort-seat')
    const name = scene.requireNode('#codesys-ai-effort-name')
    assert.strictEqual(seat.hidden, false, '切完控件仍在')
    assert.strictEqual(name.textContent, 'Max', `成功后的反馈 = 座位上的短名，实际 ${json(name.textContent)}`)
    assert.strictEqual(scene.requireNode('#codesys-ai-model-note').textContent, '', '成功路径**零新增常驻文字**（说明行必须是空的）')
    console.log(`[自测③] 点「Max」→ IPC=${json(selects[0])} · 座位短名=${json(name.textContent)} · 说明行=${json(scene.requireNode('#codesys-ai-model-note').textContent)}`)

    // "Default" 那一档（空串）也是合法选择：发出去的 effort 是空串（= 不发 reasoningEffort 字段）。
    // ⚠️ 当前值必须**不是** Default，否则它是一次 no-op（与真包 chooseEffort 的"选当前档就关菜单"一致）。
    const noDefault = await settledRenderer({ catalog: CATALOG({ current: { ...normalizedRow(PRO_ID, PRO_MODEL, 'DeepSeek V4 Pro', { efforts: REAL_EFFORTS }), reasoningEffort: 'high' } }) })
    assert.strictEqual(noDefault.scene.requireNode('#codesys-ai-effort-name').textContent, 'High', '当前档位是显式的 high')
    noDefault.scene.requireNode('#codesys-ai-effort-menu').dispatchEvent({ type: 'click', target: optionTarget(optionNode({ 'data-ai-effort': '', 'aria-selected': 'false' })) })
    await flush()
    const defaultSelects = noDefault.calls.model.filter((input) => input && input.action === 'select')
    assert.strictEqual(defaultSelects.length, 1, '点 Default 也必须发一次（它不是"没选"）')
    assert.strictEqual(json(defaultSelects[0]), json({ action: 'select', id: PRO_ID, effort: '' }), 'Default = effort 空串')
    console.log(`[自测③-b] 点「Default」→ IPC=${json(defaultSelects[0])}`)
  }

  // ── ④ 失败 ⇒ **一行**可读原因（写在既有那条说明行上），且不留旧档位 ────────────────────────
  {
    const { api, scene } = await settledRenderer({
      selectResult: { ok: false, reason: 'model-unavailable', detail: 'RemoteError: session/model-unavailable: 这个模型当前不可路由' },
    })
    scene.requireNode('#codesys-ai-effort-menu').dispatchEvent({ type: 'click', target: optionTarget(optionNode({ 'data-ai-effort': 'low', 'aria-selected': 'false' })) })
    await flush()
    const note = scene.requireNode('#codesys-ai-model-note')
    assert.strictEqual(note.textContent, '切换失败：这条会话用不了这个模型：RemoteError: session/model-unavailable: 这个模型当前不可路由',
      `失败必须写出一行可读原因（沿用既有那条说明行的同一套说法），实际 ${json(note.textContent)}`)
    assert(!String(note.textContent).includes('\n'), '失败反馈必须是**一行**，不许换行摊开')
    assert.strictEqual(note.title, note.textContent, '全文必须同时进 title（窄抽屉里会被截断）')
    console.log(`[自测④] 失败 → 说明行 = ${json(note.textContent)}`)
    void api

    // 数据桥自己写好的那两句（等级不支持 / 档位不在清单里）也必须是完整可读的一句话，
    // 不许退化成 "effort-unsupported：…" 这种半英文（渲染层的 reason→人话 映射表要认这两个 reason）。
    const detailRun = await settledRenderer({
      selectResult: { ok: false, reason: 'unknown-effort', detail: '推理等级 ultra 不在 DeepSeek V4 Pro 声明的档位里（可用：off, low, high, max）' },
    })
    detailRun.scene.requireNode('#codesys-ai-effort-menu').dispatchEvent({ type: 'click', target: optionTarget(optionNode({ 'data-ai-effort': 'low', 'aria-selected': 'false' })) })
    await flush()
    const detailNote = detailRun.scene.requireNode('#codesys-ai-model-note').textContent
    assert.strictEqual(detailNote, '切换失败：推理等级 ultra 不在 DeepSeek V4 Pro 声明的档位里（可用：off, low, high, max）',
      `reason 必须映射成人话再拼 detail，实际 ${json(detailNote)}`)
    console.log(`[自测④-b] 数据桥自报原因 → 说明行 = ${json(detailNote)}`)
  }

  // ── ⑤ 无点击 ⇒ 一次 effort IPC 都不发（快照轮询 / 目录刷新都不带 effort 写）──────────────────
  {
    const { api, calls } = await settledRenderer()
    const before = calls.model.length
    for (let index = 0; index < 4; index += 1) await api.codesysAiChatPullSnapshot()
    await api.codesysAiChatRefreshModels({ force: true })
    const selects = calls.model.filter((input) => input && input.action === 'select')
    assert.strictEqual(calls.snapshot.length, 4, '这 4 次必须真的打到 codesys:ai-chat-snapshot（否则下面的断言是空的）')
    assert.strictEqual(selects.length, 0, '没有任何点击时不得发出一次 model/effort 写入')
    assert(calls.model.length > before, '目录刷新必须真的发生（上面那次 force 刷新）')
    console.log(`[自测⑤] 无点击：快照轮询 ${calls.snapshot.length} 次 + 目录刷新 → select IPC = ${selects.length} 次`)
  }

  // ── ⑥ 既有模型座位 / 输入行顺序 / 抽屉渲染不回归 ───────────────────────────────────────────
  {
    // ⑥-a：模型座位选择仍然只发 `{ action:'select', id }`（**不**被 effort 污染）
    const { api, scene, calls } = await settledRenderer()
    const modelMenu = scene.requireNode('#codesys-ai-model-menu')
    modelMenu.dispatchEvent({ type: 'click', target: optionTarget(optionNode({ 'data-ai-model': FLASH_ID, 'aria-selected': 'false' })) })
    await flush()
    const selects = calls.model.filter((input) => input && input.action === 'select')
    assert.strictEqual(selects.length, 1, '模型座位的一次点击 = 一次 IPC')
    assert.strictEqual(json(selects[0]), json({ action: 'select', id: FLASH_ID }), '改模型时**不**替用户猜一档等级（与真包 choose() 一致）')
    console.log(`[自测⑥-a] 模型座位仍然可用 → ${json(selects[0])}`)

    // ⑥-b：blocked 行仍然只给一行原因、不发请求
    const blockedRun = await settledRenderer({ catalog: CATALOG({ blocked: [{ id: 'broken-provider', name: '坏提供方', message: '上游 502' }] }) })
    blockedRun.scene.requireNode('#codesys-ai-model-menu').dispatchEvent({
      type: 'click',
      target: optionTarget(optionNode({ 'data-ai-model': '', 'aria-disabled': 'true', 'data-blocked-reason': '上游 502', textContent: '坏提供方：上游 502' })),
    })
    await flush()
    assert.strictEqual(blockedRun.calls.model.filter((input) => input && input.action === 'select').length, 0, 'blocked 行绝不许发请求')
    assert(blockedRun.scene.requireNode('#codesys-ai-model-note').textContent.includes('上游 502'), 'blocked 行必须给一行可读原因')
    console.log(`[自测⑥-b] blocked 行 → 0 次 IPC · 说明行=${json(blockedRun.scene.requireNode('#codesys-ai-model-note').textContent)}`)

    // ⑥-c：两个浮层互斥（打开一个必须收掉另一个）
    const exclusive = await settledRenderer()
    assert.strictEqual(exclusive.api.codesysAiChatModelMenuOpen(), true, '模型浮层必须能打开')
    assert.strictEqual(exclusive.scene.requireNode('#codesys-ai-model-menu').hidden, false, '模型浮层必须真的显示')
    assert.strictEqual(exclusive.api.codesysAiChatEffortMenuOpen(), true, '等级浮层必须能打开')
    assert.strictEqual(exclusive.scene.requireNode('#codesys-ai-model-menu').hidden, true, '打开等级浮层必须收掉模型浮层（互斥）')
    assert.strictEqual(exclusive.scene.requireNode('#codesys-ai-effort-menu').hidden, false, '等级浮层必须真的显示')
    assert.strictEqual(exclusive.api.codesysAiChatModelMenuOpen(), true, '模型浮层还能再打开')
    assert.strictEqual(exclusive.scene.requireNode('#codesys-ai-effort-menu').hidden, true, '打开模型浮层必须收掉等级浮层（互斥）')
    console.log('[自测⑥-c] 两个浮层互斥：打开一个 ⇒ 另一个 hidden=true')
  }

  // ⑥-d：输入行顺序与既有元素（T176 的意图：输入框 → [模型 · 等级] → 发送，同处底行）
  {
    const source = fs.readFileSync(rendererFile, 'utf8')
    const composeStart = source.indexOf('class="codesys-ai-compose"')
    const composeEnd = source.indexOf('</aside>', composeStart)
    const shell = source.slice(composeStart, composeEnd)
    assert(shell.includes('class="codesys-ai-inputrow"'), '底行 class 必须在（.codesys-ai-inputrow）')
    const at = (needle) => shell.indexOf(needle)
    assert(at('id="codesys-ai-draft"') >= 0 && at('id="codesys-ai-model"') >= 0 && at('id="codesys-ai-effort"') >= 0 && at('id="codesys-ai-send"') >= 0,
      '输入卡片里必须同时有输入框、模型座位、推理等级座位与发送按钮（T176 的意图：既有元素一个不少）')
    assert(at('id="codesys-ai-draft"') < at('id="codesys-ai-model"'), '模型座位必须在输入框之后（"框底下切换"）')
    assert(at('id="codesys-ai-model"') < at('id="codesys-ai-effort"') && at('id="codesys-ai-effort"') < at('id="codesys-ai-send"'),
      '底行顺序必须是 模型 → 推理等级 → 发送（模型/等级在左、发送在右）')
    assert(at('class="codesys-ai-inputrow"') < at('id="codesys-ai-send"'), '底行必须包住发送按钮')
    // 输入行里不许出现模板 / 快捷项记号（T180/T181 的 0 命中纪律：那两枚按钮不许回来）
    for (const forbidden of ['data-ai-template', 'data-ai-quick', 'codesys-ai-template', 'codesys-ai-quick']) {
      assert(!shell.includes(forbidden), `输入卡片里不得再出现模板/快捷按钮记号：${forbidden}`)
    }
    console.log('[自测⑥-d] 输入行顺序 = draft → model → effort → send（同一底行，发送在最后）；模板/快捷记号 0 命中')
  }
}

// ── PART C: the classic three-tree surface (静态契约：控件确实挂在既有通道上) ────────────────────
function staticChecks () {
  const renderer = fs.readFileSync(rendererFile, 'utf8')
  const preload = fs.readFileSync(path.join(appRoot, 'app', 'preload.js'), 'utf8')
  const main = fs.readFileSync(path.join(appRoot, 'app', 'main.js'), 'utf8')
  const bridge = fs.readFileSync(bridgeFile, 'utf8')
  // 四层：渲染层 → preload → main → 数据桥（且**没有**新增通道：仍然只有 codesys:ai-chat-model）
  assert(renderer.includes("codesysAiChatModel({ action: 'select', id: modelId, effort: value })"), '渲染层必须把 effort 一起交给 preload 的方法')
  assert(preload.includes("ipcRenderer.invoke('codesys:ai-chat-model', input || {})"), 'preload 必须是 input 原样透传（所以 effort 不需要新通道）')
  assert(main.includes("codesysAiChatBridgeCall('setModel', effort ? { id, effort } : { id })"), 'main.js 必须把 effort 交给数据桥的 setModel')
  assert(bridge.includes('reasoningEffort: effort'), '数据桥必须把 reasoningEffort 带进 select / selectModel')
  assert(!preload.includes("invoke('codesys:ai-chat-effort'"), '不得**新增**通道（等级复用 codesys:ai-chat-model）')
  assert(!main.includes("'codesys:ai-chat-effort'"), '不得**新增**通道（等级复用 codesys:ai-chat-model）')
  console.log('[自测⑥-e] 四层串联：renderer → preload(透传) → main(桥调用) → shard 78(reasoningEffort)，新增通道 0 个')
}

async function main () {
  await bridgeChecks()
  await rendererChecks()
  staticChecks()
  console.log('codesys AI reasoning-effort behaviour passed (bridge carries the model reasoning capability; effort rides the existing session-level codesys:ai-chat-model channel; hidden when unsupported; silent on success, one readable line on failure; 0 effort IPC without a click)')
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
