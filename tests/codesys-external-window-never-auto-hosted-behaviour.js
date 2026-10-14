'use strict'

// T207：**外部启动的 CODESYS 窗口允许成为监视/读取目标，但必须由用户在插件里显式选择。**
//
// 用户口径（原话）：「外部窗口也可以成为监视和读取到窗口，前提是由 codesys 插件选择外部
// 窗口，不能是未经过选择就直接获取；刚刚的情况就是我外部有 codesys 窗口，一打开插件直接
// 强制捕获过来了」。
//
// 现场（真机逐字可查，2026-10-08）：
//   logs/desktop.log:3019            2026-10-08T02:36:24.381Z plugin.surface.shown
//                                    {"pluginSurfaceKind":"codesys","trigger":"surface:open:codesys",
//                                     "attachedBefore":false,"nativeAttached":false,"nativeWindowId":""}
//   logs/trajectory.jsonl            02:36:24.877Z tool.request  codesys.list-windows {}
//                                    02:36:25.780Z tool.request  codesys:native-host.attach
//                                                 {"windowId":"0x200EEA"}      ← 用户一次都没点
//   logs/codesys-native-host-audit.jsonl
//                                    02:36:26.893Z {"event":"attached","windowId":"0x200EEA","pid":31548,…}
//   同一次的 codesys.program.opened   02:36:54.322Z 本插件才启动自己的 CODESYS（pid 6236），
//                                    且 registration.excludedWindowIds = ["0X200EEA"] ——
//                                    这恰好证明 0x200EEA **早于**本插件启动，是用户自己开的窗口。
//
// 根因是 `renderCodesys()` 进面时无条件托管：
//   app/renderer/renderer.js  (旧) const selected = await refreshWindows();
//                                  if (selected?.fixture !== true) await attachSelectedCodesysNativeHost();
// 而 `refreshWindows()` 会从 `codesys:list-windows`（T137 起**把外部窗口也带回来**，`owned:false`）
// 里自动挑一个，于是"打开插件"就等于"抓住外面的 CODESYS"。
//
// 这份契约钉住修法之后的五条：
//   ① 打开面板时存在外部窗口 → **0 次 attach、0 次读取、0 次捕获 IPC**，面板只列出（带「外部启动」）；
//   ② 在窗口列表里**点选**那个外部窗口 → 才托管，并如实标出「外部启动（你选择的）」；
//   ③ 本插件自启窗口那条路**不回归**（按登记 PID 自动跟随，照旧托管）；
//   ④ 没有点击 ⇒ 零写入 / 零编译 / 零自动确认；
//   ⑤ 不抢焦点、不改中央面板。
//
// 行为那一半把**真实** renderer 脚本（`app/renderer/renderer.js`）装进 mini-DOM 并调用真实
// 函数，所以把自动托管塞回来、放宽 `owned === false` 的判据、或改掉 `list.onchange` 的显式
// 选择语义，都会立刻失败。

const assert = require('node:assert')
const fs = require('node:fs')
const { join } = require('node:path')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')

const rendererFile = join(__dirname, '..', 'app', 'renderer', 'renderer.js')
const mainFile = join(__dirname, '..', 'app', 'main.js')
const hostScriptFile = join(__dirname, '..', 'app', 'win-window-host.ps1')

const rendererSource = fs.readFileSync(rendererFile, 'utf8')
const mainSource = fs.readFileSync(mainFile, 'utf8')
const hostScript = fs.readFileSync(hostScriptFile, 'utf8')

// ── 真机那一次的两个窗口（数值来自上面的审计原文） ──────────────────────────────
// 外部：用户自己启动的 CODESYS，pid 31548，HWND 0x200EEA。
const EXTERNAL_WINDOW = { id: '0x200EEA', pid: 31548, title: 'home.project - CODESYS', width: 1402, height: 1084, usable: true, windowPhase: 'main', owned: false }
// 本插件启动：pid 6236，HWND 0x50E86（`native-host-window-replaced` 之后那个句柄）。
const OWNED_WINDOW = { id: '0x50E86', pid: 6236, title: 'home.project - CODESYS', width: 2063, height: 1402, usable: true, windowPhase: 'main', owned: true }

// 面板进面时 `renderCodesys()` 会 `$('#…')` 取到的每一个 id。它们必须存在，否则
// `$('#x').onclick = …` 会抛在空节点上 —— 那是替身的缺件，不是被测代码的问题。
// 直接从**真实源码**里把这些函数体内的 `$('#id')` 抽出来，源码改名/加控件时这份清单自动跟上。
function declaredIdsFromSource () {
  const slices = []
  const between = (from, to) => {
    const start = rendererSource.indexOf(from)
    const end = rendererSource.indexOf(to, start)
    assert(start >= 0 && end > start, `renderer.js must still contain ${from} … ${to}`)
    return rendererSource.slice(start, end)
  }
  slices.push(between('async function renderCodesys()', 'async function waitForLaunchedCodesysWindow'))
  slices.push(between('function bindCodesysAiChatUi()', 'async function submitCodesysCodeAi'))
  const ids = new Set()
  for (const slice of slices) {
    for (const match of slice.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) ids.add(`#${match[1]}`)
  }
  return [...ids]
}

// 一次运行的全部证据：IPC 调用（按方法名）、postMessage、以及 scene。
function createHarness (windows, overrides = {}) {
  const calls = []
  const base = createTaskhiveStub({
    harnessStatus: async () => ({ runtime: { state: 'ready' } }),
    listPlugins: async () => [],
    harnessUrl: async () => null,
    listCodesysWindows: async () => windows,
    codesysScriptEngineStatus: async () => ({ ready: false, missing: [], state: 'stub', version: '0.0' }),
    ...overrides,
  })
  // 记下每一次 IPC 的方法名与入参 —— 这就是"0 次 attach / 0 次读取"的证据面。
  const taskhive = new Proxy(base, {
    get (target, key) {
      const value = target[key]
      if (typeof key !== 'string' || typeof value !== 'function') return value
      return (...args) => { calls.push({ method: key, args }); return value(...args) }
    },
  })
  const nodes = {
    '#surface': {},
    '#activity': {},
    '#plugin-overlay': {},
    '#plugin-content': {},
    '#left-plugin-nav': {},
    '#right-plugin-nav': {},
    '#harness-state': {},
    '#input-status': {},
    '#stream-result': { rect: { left: 432, top: 116, width: 2063, height: 1402 } },
    '#window-list': { rect: { left: 0, top: 0, width: 220, height: 30 } },
  }
  for (const selector of declaredIdsFromSource()) if (!(selector in nodes)) nodes[selector] = {}
  const scene = createScene({ viewport: { width: 1200, height: 800 }, nodes, taskhive })
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: ['renderCodesys', 'refreshWindows', 'attachSelectedCodesysNativeHost', 'state'],
  })
  for (const name of ['renderCodesys', 'refreshWindows', 'attachSelectedCodesysNativeHost']) {
    assert.strictEqual(typeof loaded.api[name], 'function', `app/renderer/renderer.js must still define ${name}()`)
  }
  return { api: loaded.api, scene, calls, windows }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const methodsOf = (calls) => calls.map((entry) => entry.method)
const callsTo = (calls, method) => calls.filter((entry) => entry.method === method)

// 「窗口族」= 唯一能改变"托管了哪一块屏幕 / 读了哪个工程 / 开了哪个面"的那几条 IPC。
// 外壳 bootstrap（harnessStatus / harnessUrl）与 ScriptEngine 状态检查不在其中：那些只是读
// 自己的运行态，而且渲染脚本尾部的 bootstrap IIFE 是**异步**的，落地时刻不确定 —— 断言必须
// 只看这一族，否则测的是时序噪音而不是被测语义。
const WINDOW_FAMILY = [
  'setCodesysPreferredWindow',
  'attachCodesysNativeHost',
  'moveCodesysNativeHost',
  'detachCodesysNativeHost',
  'currentCodesysProject',
  'openCodesysWorkbench',
]
const windowFamily = (calls) => calls.filter((entry) => WINDOW_FAMILY.includes(entry.method))

// 去掉整行的 `//` 注释再做源码断言。这些改动把"旧行为长什么样"逐字写进了注释里（那正是
// T205 报告指出的矛盾所在，值得留在原位），所以"这个词还在不在"必须只看**代码**那一半。
const codeOf = (text) => String(text).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')

// 用户没点击时**绝不允许**出现的调用面：托管、工程读取、写入/编译/确认、启动、切面。
const NO_CLICK_FORBIDDEN = [
  'attachCodesysNativeHost',
  'moveCodesysNativeHost',
  'currentCodesysProject',
  'openCodesysProgram',
  'openCodesysWorkbench',
  'codesysAiChatApply',
  'codesysAiChatAnswer',
  'codesysAiChatPrompt',
  'runCodesysScriptEngineAction',
  'codesysNativeHostReloadProject',
  'requestCodesysCodeAi',
]

async function main () {
  // ── ① 打开面板时存在外部窗口 → 0 attach / 0 读取 / 0 捕获 IPC，只列出 ──────────
  {
    const { api, scene, calls } = createHarness([EXTERNAL_WINDOW])
    await api.renderCodesys()
    await tick()

    // 进面本身要跑外壳 bootstrap（harnessStatus / harnessUrl）与 ScriptEngine 状态检查，
    // 那些都只是读自己的运行态；**窗口/工程/托管**这一族只许有"枚举"这一条。
    assert.deepStrictEqual(
      methodsOf(calls).filter((method) => ['listCodesysWindows', 'currentCodesysProject', 'attachCodesysNativeHost', 'moveCodesysNativeHost', 'detachCodesysNativeHost', 'openCodesysProgram', 'openCodesysWorkbench'].includes(method)),
      ['listCodesysWindows'],
      `打开 CODESYS 面只许枚举窗口（实际窗口族调用 ${JSON.stringify(methodsOf(calls))}）`)
    for (const forbidden of NO_CLICK_FORBIDDEN) {
      assert.strictEqual(callsTo(calls, forbidden).length, 0,
        `没有点击时 ${forbidden} 一次都不许被调用（用户实测的「一打开插件直接强制捕获」就是它）`)
    }
    assert.strictEqual(api.state.selectedWindow, null,
      '只有外部窗口时不许自动选中任何窗口 —— 自动选择只认本插件启动过的窗口')

    const list = scene.node('#window-list')
    assert(list.innerHTML.includes('home.project - CODESYS'), '外部窗口必须仍然被**列出**（用户要点得到它）')
    assert(list.innerHTML.includes('· 外部启动'), '外部窗口必须带「外部启动」标记')
    assert(list.innerHTML.includes('尚未选择 CODESYS 窗口'),
      '没有任何自动选择时，列表要如实显示"尚未选择"，而不是靠浏览器默认选中第一项装作选好了')
    assert.strictEqual(scene.node('#stream-result').innerHTML, '',
      '没有点击时中央区域不许被任何托管占位改写')
  }

  // ── ② 点选那个外部窗口 → 才托管，并标出「外部启动（你选择的）」 ────────────────
  {
    const { api, scene, calls } = createHarness([EXTERNAL_WINDOW], {
      attachCodesysNativeHost: async () => ({ attached: true, mode: 'owned-native-host', taskbarHidden: true }),
      setCodesysPreferredWindow: async (input) => ({ preferredWindowId: input.windowId, externalLaunch: true, pluginOwned: false }),
    })
    await api.renderCodesys()
    await tick()
    const list = scene.node('#window-list')
    assert.strictEqual(typeof list.onchange, 'function', '窗口列表必须仍然拥有它的 change 处理器（显式选择入口）')

    assert.strictEqual(windowFamily(calls).length, 0,
      `打开面板本身一条"窗口族"IPC 都不许发（实际 ${JSON.stringify(methodsOf(windowFamily(calls)))}）`)
    const before = calls.length
    list.value = '0'
    await list.onchange()
    await tick()
    const clicked = windowFamily(calls.slice(before))

    // 显式选择 = **一条** setCodesysPreferredWindow（把"监视窗口"记成它）+ **一条** attach。
    assert.deepStrictEqual(methodsOf(clicked), ['setCodesysPreferredWindow', 'attachCodesysNativeHost'],
      `点选外部窗口应当恰好发出"记监视窗口 + 托管"两条 IPC（实际 ${JSON.stringify(methodsOf(clicked))}）`)
    // 注意：这些对象是在 vm 上下文里造出来的，`deepStrictEqual` 连原型一起比，所以先摊平。
    assert.deepStrictEqual({ ...clicked[0].args[0] }, { windowId: '0x200EEA', pid: 31548 },
      '点选必须先把选中的窗口发布成监视窗口（监视线程/读取链据此收敛到这一个句柄）')
    assert.strictEqual(clicked[1].args[0].windowId, '0x200EEA', '托管的必须是用户点选的那一个句柄')
    assert.strictEqual(clicked[1].args[0].explicitSelection, true,
      '只有"用户的显式选择"这条路才带 explicitSelection —— 宿主按它放行外部窗口')
    assert(clicked[1].args[0].bounds && clicked[1].args[0].bounds.width > 0, '托管必须带上中央区域的几何')

    const line = scene.node('#input-status').textContent
    assert(line.includes('外部启动') && line.includes('你选择的'),
      `托管外部窗口后面板必须如实标出「外部启动（你选择的）」（实际 ${JSON.stringify(line)}）`)
    assert(line.includes('不抢焦点'), `那一行还要说明它不抢焦点 / 不改中央面板（实际 ${JSON.stringify(line)}）`)
  }

  // ── ③ 本插件自启窗口那条路不回归：按登记 PID 自动跟随，照旧托管 ────────────────
  {
    const { api, calls } = createHarness([OWNED_WINDOW], {
      attachCodesysNativeHost: async () => ({ attached: true, mode: 'owned-native-host' }),
    })
    const selected = await api.refreshWindows({ preferredPid: 6236 })
    assert(selected && selected.id === '0x50E86',
      '本插件启动的窗口（owned:true）照旧在没有点击时被自动选中 —— 自动路径只对它们开')
    const attached = await api.attachSelectedCodesysNativeHost()
    assert.strictEqual(attached, true, '本插件启动的窗口照旧可以被自动托管（不回归）')
    const attachCalls = callsTo(calls, 'attachCodesysNativeHost')
    assert.strictEqual(attachCalls.length, 1)
    assert.strictEqual(attachCalls[0].args[0].windowId, '0x50E86')
    assert.strictEqual(attachCalls[0].args[0].explicitSelection, false,
      '自动路径不带 explicitSelection —— 它对 owned:true 无所谓，对外部窗口就是那道门')
  }

  // ── ③b 自动路径碰到外部窗口：拒绝，且**一条 IPC 都不发** ──────────────────────
  {
    const { api, calls } = createHarness([EXTERNAL_WINDOW])
    assert.strictEqual(await api.refreshWindows(), null,
      '只有外部窗口时 refreshWindows() 必须返回 null（没有任何自动选择）')
    const attached = await api.attachSelectedCodesysNativeHost()
    assert.strictEqual(attached, false, '没有 explicitSelection 时，外部窗口必须被渲染层第一道门挡住')
    assert.deepStrictEqual(windowFamily(calls), [], '被挡住就不许再发任何窗口族 IPC（连尝试都不尝试）')
  }

  // ── ④ 没有点击 ⇒ 零写入 / 零编译 / 零自动确认 ────────────────────────────────
  {
    const { api, scene, calls } = createHarness([EXTERNAL_WINDOW, OWNED_WINDOW])
    await api.renderCodesys()
    await api.refreshWindows()
    await tick()
    for (const forbidden of ['codesysAiChatApply', 'codesysAiChatAnswer', 'runCodesysScriptEngineAction', 'codesysNativeHostReloadProject']) {
      assert.strictEqual(callsTo(calls, forbidden).length, 0, `没有点击时 ${forbidden} 一次都不许调用`)
    }
    // 那条唯一能写入的通道只有一个落点：抽屉里被点过的「确认写入」按钮（见 renderer 的
    // data-ai-confirm-write / data-ai-confirm-write-override 委托分支）。这里再钉一次
    // "它不在进面这条链上"。
    const entryOnly = rendererSource.slice(rendererSource.indexOf('async function renderCodesys()'), rendererSource.indexOf('\nasync function teardownCodesysSurface()'))
    assert(!/codesysAiChatApply\(/.test(entryOnly), 'renderCodesys() 那条链上不许出现确认写入（写入只在用户点击）')
    assert.strictEqual(scene.posted.filter((entry) => entry.message?.type === 'surface.open').length, 0,
      '打开 CODESYS 面本身不许再发 surface.open（那会把用户从别的面拽走）')
  }

  // ── ⑤ 不抢焦点、不改中央面板 ────────────────────────────────────────────────
  {
    // 焦点这一半在 PowerShell 侧：attach 分支只允许 SWP_NOACTIVATE（不激活、不抢前台）。
    const attachAt = hostScript.indexOf("if ($Mode -eq 'attach') {")
    assert(attachAt >= 0, 'win-window-host.ps1 必须仍然有 attach 分支')
    const attachBody = hostScript.slice(attachAt, hostScript.indexOf("if ($Mode -eq 'move') {", attachAt))
    assert(attachBody.includes('$SWP_NOACTIVATE'),
      'attach 只许用 SWP_NOACTIVATE 摆放（用户的 CODESYS 不许被抢到前台）')
    assert(!/SetForegroundWindow|SW_SHOWNORMAL|SW_SHOW\b|SetActiveWindow|SetFocus/.test(attachBody),
      'attach 分支不许出现任何会把窗口激活/抢前台的 API')
    // 仓库里唯一会 SetForegroundWindow 的是已删除的"面板遥控"输入通道，主进程不再引用它。
    assert(!mainSource.includes('win-window-input'),
      '主进程不许再引用 win-window-input.ps1（那条通道带 SetForegroundWindow，已按用户要求整体删除）')
    // 中央面板这一半：进面 + 点选两条路都不许切面。
    const posted = []
    const { api, scene } = createHarness([EXTERNAL_WINDOW], {
      attachCodesysNativeHost: async () => ({ attached: true }),
      setCodesysPreferredWindow: async () => ({ preferredWindowId: '0x200EEA' }),
    })
    await api.renderCodesys()
    scene.node('#window-list').value = '0'
    await scene.node('#window-list').onchange()
    await tick()
    for (const entry of scene.posted) posted.push(entry.message?.type)
    assert.deepStrictEqual(posted.filter((type) => type === 'surface.open'), [],
      '托管外部窗口不许改中央面板（不 postMessage surface.open）')
  }

  // ── 源码锚点：修法本身在场，且旧行为不会再回来 ───────────────────────────────
  // `renderCodesys()` 自己的函数体（到下一条函数为止）—— 只看它，别把后面定义
  // `attachSelectedCodesysNativeHost` 的那一段也算进来。
  const renderStart = rendererSource.indexOf('async function renderCodesys()')
  const renderEnd = rendererSource.indexOf('\nasync function teardownCodesysSurface()', renderStart)
  assert(renderStart >= 0 && renderEnd > renderStart, 'renderCodesys() 必须仍然是一条可切片的命名函数')
  const renderBody = rendererSource.slice(renderStart, renderEnd)
  assert(renderBody.includes('await refreshWindows()'), 'renderCodesys() 必须仍然枚举窗口')
  // 进面的**尾部**（脚本引擎状态 + 枚举窗口那一段）不许出现托管。函数体里还有
  // 「打开 CODESYS」那枚按钮的点击处理器，它按登记的 PID 自动跟随 —— 那是允许的自动路径，
  // 所以判据必须落在尾部这一段上，而不是整个函数体。
  const entryTail = renderBody.slice(renderBody.indexOf('state.codesysSurfaceInitialized = true'))
  assert(entryTail.includes('await refreshWindows()'), '进面尾部必须仍然枚举窗口（面板要列出可选窗口）')
  assert(!codeOf(entryTail).includes('attachSelectedCodesysNativeHost'),
    '进面尾部不许出现 attachSelectedCodesysNativeHost —— 打开/切到 CODESYS 面只列窗口（T207）')
  assert(!rendererSource.includes('if (selected?.fixture !== true) await attachSelectedCodesysNativeHost();'),
    '旧的"进面即托管"那一句必须消失（它就是用户实测"一打开插件直接强制捕获"的那一步）')
  assert(rendererSource.includes("$('#refresh-windows').onclick = async () => { await refreshWindows(); };"),
    '「刷新」只重新枚举窗口，不再托管（否则用户以为只是刷新，窗口却被抓进面板）')

  const refreshStart = rendererSource.indexOf('async function refreshWindows(options = {})')
  const refreshEnd = rendererSource.indexOf('\nasync function waitForLaunchedCodesysWindow', refreshStart)
  const refreshBody = rendererSource.slice(refreshStart, refreshEnd)
  assert(refreshBody.includes('const autoSelectable = state.windows.filter((item) => item.owned !== false)'),
    'refreshWindows() 的自动选择必须只从本插件启动过的窗口（owned !== false）里挑')
  assert(refreshBody.includes('|| autoSelectable[0] || null'),
    '没有本插件窗口时必须落到 null（而不是列表第一项那个外部窗口）')
  assert(refreshBody.includes('explicitSelection: true'),
    'list.onchange（用户的显式选择）必须把 explicitSelection: true 交上去')

  const attachFnStart = rendererSource.indexOf('async function attachSelectedCodesysNativeHost(options = {})')
  const attachFnBody = rendererSource.slice(attachFnStart, rendererSource.indexOf('\nasync function toggleCodesysNativeHost()', attachFnStart))
  assert(attachFnBody.includes('selected.owned === false && options.explicitSelection !== true'),
    '渲染层必须有第一道门：外部窗口没有 explicitSelection 就不托管')

  const mainAttachAt = mainSource.indexOf("handleTrusted('codesys:native-host-attach'")
  const mainAttach = mainSource.slice(mainAttachAt, mainSource.indexOf("handleTrusted('codesys:native-host-move'", mainAttachAt))
  assert(mainAttach.includes('CODESYS_EXTERNAL_WINDOW_NOT_SELECTED'),
    '宿主侧必须有第二道门：外部窗口没有 explicitSelection 就拒绝托管')
  assert(mainAttach.includes("attachTarget.owned === false && input?.explicitSelection !== true"),
    '第二道门的判据必须是 owned === false + explicitSelection')

  const preferredAt = mainSource.indexOf("handleTrusted('codesys:preferred-window'")
  // 口径注释写在处理器**之前**，所以切片要从那块注释的开头起 —— 否则"一句话口径"根本不在
  // 断言范围里，测试会变成一句自我安慰。
  const preferredCommentAt = mainSource.lastIndexOf('\n  // ── T207', preferredAt)
  assert(preferredCommentAt > 0 && preferredCommentAt < preferredAt,
    'preferred-window 的口径注释必须就写在处理器上方（本契约据此切片）')
  const preferred = mainSource.slice(preferredCommentAt, mainSource.indexOf("handleTrusted('codesys:workbench-open'", preferredAt))
  const preferredCode = codeOf(preferred)
  assert(!preferredCode.includes('ownership-filtered'),
    'preferred-window 那段假的注释必须删掉（它说走了归属过滤，而这条通道用的 resolveWindow 根本没有过滤）')
  assert(preferredCode.includes('monitor.resolveWindow(requestedWindowId)'),
    '这条通道仍然按句柄解析（外部窗口允许），放行与否由"仅经显式选择"负责')
  assert(!preferredCode.includes('resolveOwnedWindow'),
    '这条通道不做归属过滤 —— 那是 workbench-open 的判据，不是窗口选择器的')
  assert(preferred.includes('外部允许') && preferred.includes('永不自动'),
    'preferred-window 的语义必须统一成「外部允许，但仅经显式选择；永不自动」')
  assert(preferredCode.includes('externalLaunch'), '显式选中外部窗口时返回值必须标出它是外部启动的那一个')
  assert(preferredCode.includes('automatic: false'),
    '显式选择必须留一条 automatic:false 的审计，事后能分清"你选的"和"自动抓的"')

  const projectAt = mainSource.indexOf("handleTrusted('codesys:current-project'")
  const project = mainSource.slice(projectAt, mainSource.indexOf("handleTrusted('codesys:open-program'", projectAt))
  assert(project.includes('scopedWindows'),
    '检测链必须在没有显式选择时把外部窗口排除（否则"没点过就读了外部窗口的工程"）')
  assert(project.includes('item.owned !== false || (explicitWindowId && String(item.id) === explicitWindowId)'),
    '显式选中过的那一个窗口必须照旧参与（外部允许，但仅经显式选择）')

  console.log('codesys external window never auto hosted: 外部窗口只在显式点选后才托管，进面/刷新只列出')
}

main().catch((error) => {
  console.error(`codesys external window never auto hosted test failed: ${error.message}`)
  process.exitCode = 1
})
