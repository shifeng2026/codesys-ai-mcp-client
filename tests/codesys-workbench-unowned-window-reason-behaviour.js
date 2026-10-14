'use strict'

// Contract (T199 + T208): the CODESYS panel's 「代码任务」 button and the host behind it.
//
// 两个方向都要成立（T208 之后这不再是一份"只钉拒绝"的契约）：
//
//   (a) 外部启动的窗口，**没有被用户显式选择** → 拒绝，而且是面板内**一行可读的原因 + 下一步**，
//       不是 renderer 控制台里的 `Uncaught (in promise)`；
//   (b) 外部启动的窗口，**已经被用户显式选择**（下拉里点过它一下）→ **允许绑定**，工作台照常打开，
//       并且只走只读那条链（`bind-project` / `inspect-project`），一个字节都不写工程；
//   (c) 本插件自己启动的窗口 → 照旧（按 PID 绑，句柄换了也照旧，T199 不回归）；
//   (d) **未显式选择时绝不放行** —— 包括伪造的 per-request 声明、`automatic:true` 的凭据、
//       拿另一个窗口（含"曾经选过的那一个"）的凭据来指这个句柄。
//
// ── T199 的现场（2026-10-08，用户报「点代码任务为什么报错」）────────────────────────
// `renderer-console.log` 逐字可查：
//   Uncaught (in promise) Error: Error invoking remote method 'codesys:workbench-open':
//     Error: 工作台只能绑定由当前插件打开的 CODESYS 窗口
// 根因：`#window-list` 为了能托管"你自己启动的 CODESYS"而把非本插件启动的窗口也列出来
// （选项末尾标「外部启动」，见 refreshWindows()），而宿主的 `codesys:workbench-open`
// 只接受**本插件启动**的窗口。于是"选外部窗口 + 点代码任务"必然被拒，而旧绑定是一个没有
// try/catch 的 inline async 箭头函数 —— 拒绝直接落成控制台未处理拒绝，面板上什么都不说。
//
// ── T208 的用户裁决（原话）───────────────────────────────────────────────────────────
// 「外部窗口也可以成为监视和读取的窗口，前提是由 codesys 插件选择外部窗口，不能是未经过
// 选择就直接获取」。T207 已把这条口径落到监视窗口 / 原生托管 / 检测读取三条链上；这一次把
// **「代码任务」的工作台绑定**按同一口径放行 —— 而授权的依据必须是**已记录在主进程里的那条
// 显式选择**（`codesysExplicitWindowSelection`，`automatic:false`），**不是**让渲染层每次在
// 请求体里再声明一个可以伪造的 flag。
//
// 这份契约的两半：
//   1. 面板那一半：把**真实** renderer 脚本装进 mini-DOM 并调用真实处理函数（改名、去掉
//      try/catch、把外部程序调用塞回来、或让它在请求里声明授权，都会立刻失败）；
//   2. 宿主那一半：把 `app/main.js` 里 `codesys:workbench-open` 的**真实文本**切出来放进
//      `vm` 跑，配上**真实**的 `CodesysWindowMonitor` + `CodesysWindowOwnership`（只把
//      枚举换成数组；`electron` 只做最小替身）—— 所以放行/拒绝都是真的算出来的，不是 grep。

const assert = require('node:assert')
const fs = require('node:fs')
const { join } = require('node:path')
const vm = require('node:vm')
const Module = require('node:module')

// `app/windows-monitor.js` 是全仓唯一 require('electron') 的应用模块（desktopCapturer，属被删掉的
// 实时监视那一半）。窗口解析这条链一次都不碰它，所以这里注入最小替身，而不是为了一个契约去起 Electron。
const realLoad = Module._load
Module._load = function taskhiveContractElectronStub (request, parent, isMain) {
  if (request === 'electron') return { desktopCapturer: { getSources: async () => [] } }
  return realLoad.call(this, request, parent, isMain)
}

const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')
const { createWorkbenchDriver } = require('./lib/workbench-driver')
const { CodesysWindowOwnership } = require('../app/codesys-window-ownership')
const { CodesysWindowMonitor } = require('../app/windows-monitor')
const { createTempDir } = require('./lib/temp-dir')

const appRoot = join(__dirname, '..')
const rendererFile = join(appRoot, 'app', 'renderer', 'renderer.js')
const mainFile = join(appRoot, 'app', 'main.js')
const monitorFile = join(appRoot, 'app', 'windows-monitor.js')
const rendererSource = fs.readFileSync(rendererFile, 'utf8')
const mainSource = fs.readFileSync(mainFile, 'utf8')
const monitorSource = fs.readFileSync(monitorFile, 'utf8')

const HANDLER = 'openCodesysWorkbenchFromPanel'

// 宿主拒绝"外部窗口不是你当前点选的监视窗口"时逐字给出的那一句。面板必须把它原文搬上来，
// 而宿主那一半（下面第 4 节）必须真的产生它 —— 两半用同一个常量，改成一边就会红。
const EXTERNAL_NOT_SELECTED_REASON = '这个外部启动的 CODESYS 窗口不是你当前点选的监视窗口：请先在面板的窗口列表里点选它（点选后它就是当前监视/读取窗口），再点「代码任务」'
const IPC_MESSAGE = `Error invoking remote method 'codesys:workbench-open': Error: ${EXTERNAL_NOT_SELECTED_REASON}`

// 真机那一次的两个窗口（数值来自 T207 审计原文）。
const PLUGIN_PID = 6236
const EXTERNAL_PID = 31548
const OWNED_WINDOW = { id: '0x50E86', pid: PLUGIN_PID, title: 'home.project - CODESYS', width: 2063, height: 1402, usable: true, visible: true, styleVisible: true }
const OWNED_REPLACEMENT = { id: '0x50E87', pid: PLUGIN_PID, title: 'home.project - CODESYS', width: 2063, height: 1402, usable: true, visible: true, styleVisible: true }
const EXTERNAL_WINDOW = { id: '0x200EEA', pid: EXTERNAL_PID, title: 'home.project - CODESYS', width: 1402, height: 1084, usable: true, visible: true, styleVisible: true }
const OTHER_EXTERNAL_WINDOW = { id: '0x9911', pid: 717, title: 'other.project - CODESYS', width: 1200, height: 900, usable: true, visible: true, styleVisible: true }

const codeOf = (text) => String(text).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')

// --- 1. renderer 源码形状：一个有名字的、catch 兜住的处理函数，且不启动外部程序 ----------
const handlerStart = rendererSource.indexOf(`async function ${HANDLER}()`)
assert(handlerStart >= 0, `app/renderer/renderer.js must define ${HANDLER}() as a named function (the button is tested, not grepped at random)`)
const handlerEnd = rendererSource.indexOf('\nasync function renderCodesys()', handlerStart)
assert(handlerEnd > handlerStart, `${HANDLER}() must sit immediately before renderCodesys(), so its body can be sliced deterministically`)
const handlerBody = rendererSource.slice(handlerStart, handlerEnd)

assert(handlerBody.includes('catch (error)'), 'the panel handler must catch the host rejection instead of leaking an unhandled rejection')
assert(!rendererSource.includes(`$('#codesys-workbench').onclick = async () =>`),
  'the old unguarded inline async arrow must stay gone')
assert(rendererSource.includes(`$('#codesys-workbench').onclick = ${HANDLER};`),
  'the 代码任务 button must be bound to the guarded panel handler')
// 面板内的那一条通路绝不启动外部程序（本仓唯一的 shell.openExternal 在 main.js 的
// CODESYS 安装包下载入口，不在这条链上）。
for (const forbidden of ['openPath', 'openExternal', 'Invoke-Item', 'Start-Process', 'cmd.exe', 'Code.exe', 'require(\'child_process\')']) {
  assert(!handlerBody.includes(forbidden), `「代码任务」的通路不得出现 ${forbidden}：它只切面板内的工作台页签`)
}

function createRenderer (hostCall, calls) {
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
      '#window-list': {},
    },
    taskhive: createTaskhiveStub({
      harnessStatus: async () => ({ runtime: { state: 'ready' } }),
      listPlugins: async () => [],
      harnessUrl: async () => null,
      listCodesysWindows: async () => [],
      openCodesysWorkbench: hostCall,
    }),
  })
  if (calls) {
    const original = scene.window.taskhive.openCodesysWorkbench
    scene.window.taskhive.openCodesysWorkbench = (input) => { calls.push(input); return original(input) }
  }
  const loaded = loadRendererScript(rendererFile, { scene, exports: [HANDLER, 'state'] })
  assert.strictEqual(typeof loaded.api[HANDLER], 'function',
    'app/renderer/renderer.js must still define the 代码任务 panel handler')
  return loaded
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

// --- 2. 宿主那一半：把真实处理器切出来，在 vm 里配真实 monitor 跑 ------------------------
const CHANNEL = "handleTrusted('codesys:workbench-open'"
const hostHandlerStart = mainSource.indexOf(CHANNEL)
assert(hostHandlerStart > 0, 'main.js must register codesys:workbench-open')
const hostHandlerEnd = mainSource.indexOf('\n  handleTrusted(', hostHandlerStart + CHANNEL.length)
assert(hostHandlerEnd > hostHandlerStart, 'the workbench-open handler must be sliceable')
const HOST_HANDLER_SOURCE = mainSource.slice(hostHandlerStart, hostHandlerEnd)

const tempRoot = createTempDir('taskhive-codesys-workbench-explicit-selection-')

// 每个 harness 一套全新的 ownership + monitor：枚举换成数组（不起 PowerShell），
// 解析走的仍是 `resolveOwnedWindow` 的**真实**代码。
function hostHarness (options = {}) {
  const ownership = new CodesysWindowOwnership({ now: () => 5_000_000, discoveryWindowMs: 60_000 })
  ownership.registerPid(PLUGIN_PID, { profile: 'CODESYS V3.5 SP20 Patch 4' })
  const monitor = new CodesysWindowMonitor(tempRoot, { ownership })
  let live = options.windows || [OWNED_WINDOW, EXTERNAL_WINDOW]
  monitor.listRawWindows = async () => live

  const registered = []
  const audit = []
  const posted = []
  const sandbox = {
    monitor,
    codesysWindowOwnership: ownership,
    codesysReviveOwnedPids: () => [],
    codesysNativeHost: { status: () => ({ windowId: '' }) },
    codesysPreferredWindowId: '',
    // 主进程那份"用户显式选择"的记录。真实代码里它只有 `codesys:preferred-window` 会写。
    codesysExplicitWindowSelection: options.selection || null,
    currentHarnessFrame: () => ({ executeJavaScript: async (script) => { posted.push(String(script)); return true } }),
    harness: { append: (event, payload) => { audit.push({ event, payload }) } },
    handleTrusted: (channel, handler) => { registered.push({ channel, handler }) },
  }
  vm.createContext(sandbox)
  vm.runInContext(HOST_HANDLER_SOURCE, sandbox, { filename: 'app/main.js#codesys:workbench-open' })
  const entry = registered.find((item) => item.channel === 'codesys:workbench-open')
  assert(entry, 'the sliced workbench-open handler must register itself through handleTrusted')
  return {
    handler: entry.handler,
    monitor,
    ownership,
    audit,
    posted,
    setLive: (next) => { live = next },
    selection: sandbox,
  }
}

const userSelection = (windowId) => ({ windowId, source: 'user-selection', automatic: false, at: new Date().toISOString() })

async function main () {
  // ══ 3. 面板那一半 ══════════════════════════════════════════════════════════════════

  // ── 3a. 外部窗口**没有被显式选择** → 拒绝，并且是面板内一行可读原因 + 下一步 ──────────
  {
    const calls = []
    const { api, scene } = createRenderer(async () => { throw new Error(IPC_MESSAGE) }, calls)
    api.state.selectedWindow = { id: '0x200EEA', pid: EXTERNAL_PID, title: 'FiveDofPlatform0921.project - CODESYS', owned: false }

    // The old binding rejected; the guarded one must settle.
    await api[HANDLER]()
    await tick()

    assert.strictEqual(calls.length, 1, 'the handler must still ask the host exactly once')
    assert.strictEqual(calls[0].windowId, '0x200EEA', 'the handler must still hand the selected window to the host (the ownership check is the host\'s job)')
    assert.strictEqual(calls[0].pid, EXTERNAL_PID, 'the selected window PID must still travel with the request')

    const status = scene.node('#input-status')
    const line = status.textContent
    assert(line, 'a refused 代码任务 must say something in the panel instead of failing silently')
    assert(line.includes('代码任务工作台没能打开'), `the panel line must name the action (saw ${JSON.stringify(line)})`)
    assert(line.includes(EXTERNAL_NOT_SELECTED_REASON), `the panel line must carry the host's own reason verbatim (saw ${JSON.stringify(line)})`)
    assert(!line.includes('Error invoking remote method'),
      `the Electron IPC wrapper must be stripped so the line stays readable (saw ${JSON.stringify(line)})`)
    assert(line.includes('外部启动'), `an externally started window must be named as such (saw ${JSON.stringify(line)})`)
    assert(line.includes('点选'),
      `the next step must be "在窗口列表里点选这个窗口" — 乙之后"改选本插件启动的窗口"已经不是唯一的下一步 (saw ${JSON.stringify(line)})`)
    assert(line.includes('打开 CODESYS'), 'the line must still offer the plugin-launched fallback')
    assert.strictEqual(status.title, line, 'the full text must also be reachable through title (the strip truncates)')
    assert(line.split('\n').length === 1, 'the reason must stay ONE line')
  }

  // ── 3b. 外部窗口**已被显式选择**（下拉里点过它）→ 宿主放行 → 面板不画任何错误 ──────────
  {
    const calls = []
    const { api, scene } = createRenderer(async () => ({ opened: true, owner: 'Harness/DSH', windowId: '0x200EEA', externalLaunch: true }), calls)
    const status = scene.node('#input-status')
    status.textContent = '既有状态'
    api.state.selectedWindow = { id: '0x200EEA', pid: EXTERNAL_PID, title: 'home.project - CODESYS', owned: false }
    await api[HANDLER]()
    await tick()

    assert.strictEqual(calls.length, 1, 'an accepted click must ask the host once')
    // 伪造面：渲染层交上去的东西**只有**这三样 —— 没有任何"授权"字段可以声明。
    // 放行与否由宿主按它自己记着的那条显式选择判定（下面第 4 节逐条验）。
    assert.deepStrictEqual(Object.keys(calls[0]).sort(), ['pid', 'title', 'windowId'],
      `the panel must hand over identity only; an authorization flag declared here would be forgeable (saw ${JSON.stringify(Object.keys(calls[0]))})`)
    assert.strictEqual(status.textContent, '既有状态',
      'a successful 代码任务 must not rewrite the panel status as a failure')
  }

  // ── 3c. 没有 `owned` 标记（老宿主载荷）时，下一步照旧给出来 ──────────────────────────
  {
    const { api, scene } = createRenderer(async () => { throw new Error(IPC_MESSAGE) })
    api.state.selectedWindow = { id: '0x55', pid: 7, title: 'CODESYS' }
    await api[HANDLER]()
    await tick()
    const line = scene.node('#input-status').textContent
    assert(line.includes(EXTERNAL_NOT_SELECTED_REASON) && line.includes('打开 CODESYS'),
      `without the owned flag the line must still carry reason + next step (saw ${JSON.stringify(line)})`)
  }

  // ── 3d. 对照：宿主接受时不许无条件画错误横幅 ─────────────────────────────────────────
  {
    const calls = []
    const { api, scene } = createRenderer(async () => ({ opened: true, owner: 'Harness/DSH' }), calls)
    const status = scene.node('#input-status')
    status.textContent = '既有状态'
    api.state.selectedWindow = { id: '0x2001', pid: 4242, title: 'owned.project - CODESYS', owned: true }
    await api[HANDLER]()
    await tick()
    assert.strictEqual(calls.length, 1, 'an accepted click must ask the host once')
    assert.strictEqual(status.textContent, '既有状态',
      'a successful 代码任务 must not rewrite the panel status as a failure')
  }

  // ══ 4. 宿主那一半（真实处理器 + 真实解析器）══════════════════════════════════════════

  // ── 4a.(d) 外部窗口未被显式选择 → 拒绝 + 可读原因 + 下一步 + 零副作用 ────────────────
  {
    const harness = hostHarness()
    await assert.rejects(() => harness.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: EXTERNAL_PID }), (error) => {
      assert.strictEqual(error.code, 'CODESYS_WORKBENCH_WINDOW_NOT_OWNED', 'the refusal code must stay the one the panel already reports')
      assert.strictEqual(error.reason, 'not-plugin-launched-window')
      assert.strictEqual(error.message, EXTERNAL_NOT_SELECTED_REASON,
        'the host must produce, verbatim, the reason the panel is asserted to display')
      assert(error.message.includes('先在面板的窗口列表里点选它'), 'the refusal must carry the concrete next step')
      assert(!error.message.includes('只能绑定由当前插件打开的'),
        '乙之后那句"只能绑定本插件打开的窗口"已经与事实不符，必须消失')
      return true
    })
    assert.deepStrictEqual(harness.posted, [], '被拒绝时不许打开工作台页签')
    assert.deepStrictEqual(harness.audit, [], '被拒绝时一行审计都不许留')
  }

  // ── 4b.(b) 外部窗口已被显式选择 → 允许绑定，且只走只读那条链 ─────────────────────────
  {
    const harness = hostHarness({ selection: userSelection(EXTERNAL_WINDOW.id) })
    const result = await harness.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: EXTERNAL_PID })
    assert.strictEqual(result.opened, true, 'a window the user explicitly selected must open the workbench')
    assert.strictEqual(result.externalLaunch, true, 'the answer must say this window is externally started')
    assert.strictEqual(result.windowId, EXTERNAL_WINDOW.id)
    assert.strictEqual(result.owner, 'Harness/DSH', 'the workbench is still the DSH one (nothing else opened)')
    assert.strictEqual(harness.posted.length, 1, 'the workbench-open message must be delivered exactly once')
    assert(harness.posted[0].includes("type:'codesys.workbench.open'"),
      'the handler must still deliver the same workbench-open message (nothing else opened it)')
    // 工作台状态里要能看出"外部启动（你选择的）"：成功路径只留这一行，不加常驻文字。
    assert.strictEqual(harness.audit.length, 1, '绑定外部窗口时必须恰好留一行（成功路径不加常驻文字）')
    assert.strictEqual(harness.audit[0].event, 'codesys.workbench.window-bound')
    assert.strictEqual(harness.audit[0].payload.windowId, EXTERNAL_WINDOW.id)
    assert.strictEqual(harness.audit[0].payload.pid, EXTERNAL_PID)
    assert.strictEqual(harness.audit[0].payload.externalLaunch, true)
    assert.strictEqual(harness.audit[0].payload.pluginOwned, false)
    assert.strictEqual(harness.audit[0].payload.source, 'user-selection')
    assert.strictEqual(harness.audit[0].payload.automatic, false,
      'automatic:false 就是"你选的"与"自动抓的"那条分界线')

    // **没有任何写动作**：这个处理器的全部副作用面就是"读枚举 + 审计一行 + postMessage 一次"。
    // 沙箱里刻意没有 fs / scriptengine / 写入工具，所以真去写会 ReferenceError。
    const handlerCode = codeOf(HOST_HANDLER_SOURCE)
    for (const forbidden of ['writeFileSync', 'appendFileSync', 'baselineSha256', 'commitProject', 'codesysScriptEngine', 'apply-and-build', 'runTool(']) {
      assert(!handlerCode.includes(forbidden), `工作台绑定不得出现写/编译入口：发现 ${forbidden}`)
    }
    // sha 三态守卫仍然排在写入动作**之前**（写入通路本身归 DSH 侧 shard 50，见 T199 契约那一条）。
    const shard = fs.readFileSync(join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'src', '50-codesys-workbench.js'), 'utf8')
    assert(shard.indexOf('const guard = await checkSourceUnchanged(jobId)') > 0
      && shard.indexOf('const guard = await checkSourceUnchanged(jobId)') < shard.indexOf("run('apply-and-build'"),
      'the sha tri-state guard must still run BEFORE apply-and-build — this change does not touch the write path')
  }

  // ── 4c.(c) 本插件自启窗口照旧：按 PID 绑，句柄换了也照旧（T199 不回归）──────────────
  {
    const harness = hostHarness()
    const first = await harness.handler({}, { windowId: OWNED_WINDOW.id, pid: PLUGIN_PID })
    assert.strictEqual(first.opened, true, 'a plugin-launched window must still open the workbench with no selection at all')
    assert.strictEqual(first.externalLaunch, false)
    assert.strictEqual(first.windowId, OWNED_WINDOW.id)
    assert.deepStrictEqual(harness.audit, [], '本插件窗口那条路不写 externalLaunch 那行')

    // CODESYS 启动时销毁并重建顶层窗口（T199 现场：0x1204AC → 0x1304AC），面板手里还是旧句柄。
    harness.setLive([OWNED_REPLACEMENT])
    const rebound = await harness.handler({}, { windowId: OWNED_WINDOW.id, pid: PLUGIN_PID })
    assert.strictEqual(rebound.opened, true, 'the remembered handle is gone — the plugin PID must re-resolve, not refuse')
    assert.strictEqual(rebound.windowId, OWNED_REPLACEMENT.id,
      'the answer must name the CURRENT window of that PID, not the destroyed handle the panel remembered')
    assert.deepStrictEqual(harness.audit, [], '按 PID 重解析后的绑定依旧是本插件窗口，不留 externalLaunch 行')

    // 进程是本插件启动的、但现在没有可用顶层窗口 → 如实说，且**不**说成"不是本插件打开的"。
    harness.setLive([])
    await assert.rejects(() => harness.handler({}, { windowId: OWNED_WINDOW.id, pid: PLUGIN_PID }), (error) => {
      assert.strictEqual(error.reason, 'plugin-pid-without-usable-window')
      assert(error.message.includes(`PID ${PLUGIN_PID}`) && error.message.includes('「刷新」'))
      return true
    })
  }

  // ── 4d.(d) 伪造 / 过期的声明一律拒绝 ────────────────────────────────────────────────
  {
    // ① 渲染层自己在请求体里声明一份"完整的凭据" —— 主进程一个字都不许读。
    {
      const harness = hostHarness()
      await assert.rejects(() => harness.handler({}, {
        windowId: EXTERNAL_WINDOW.id,
        pid: EXTERNAL_PID,
        explicitSelection: { windowId: EXTERNAL_WINDOW.id, source: 'user-selection', automatic: false },
        automatic: false,
        source: 'user-selection',
      }), (error) => {
        assert.strictEqual(error.reason, 'not-plugin-launched-window',
          'a credential declared by the renderer must not authorize anything')
        return true
      })
      assert.deepStrictEqual(harness.posted, [], 'a forged declaration must not open the workbench')
    }

    // ② 记录在案的选择**不是**这个窗口（"曾经选过，但当前选择已经换成别的了"）。
    {
      const harness = hostHarness({ selection: userSelection(OTHER_EXTERNAL_WINDOW.id) })
      await assert.rejects(() => harness.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: EXTERNAL_PID }), (error) => {
        assert.strictEqual(error.reason, 'not-plugin-launched-window',
          'a stale selection must not authorize a different handle')
        return true
      })
      // 而记录里的那一个照旧可以绑（凭据是按句柄逐字匹配的，不是"选过一次就全放开"）。
      const live = await hostHarness({ selection: userSelection(OTHER_EXTERNAL_WINDOW.id), windows: [OWNED_WINDOW, EXTERNAL_WINDOW, OTHER_EXTERNAL_WINDOW] })
      const allowed = await live.handler({}, { windowId: OTHER_EXTERNAL_WINDOW.id, pid: OTHER_EXTERNAL_WINDOW.pid })
      assert.strictEqual(allowed.opened, true, 'the recorded selection itself must still bind')
    }

    // ③ `automatic: true` 的凭据（"自动路径抓到的"）不算数；缺 `source` 也不算数。
    {
      for (const forged of [
        { windowId: EXTERNAL_WINDOW.id, source: 'user-selection', automatic: true },
        { windowId: EXTERNAL_WINDOW.id, source: 'user-selection' },
        { windowId: EXTERNAL_WINDOW.id, source: 'main-process', automatic: false },
      ]) {
        const harness = hostHarness({ selection: forged })
        await assert.rejects(() => harness.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: EXTERNAL_PID }), (error) => {
          assert.strictEqual(error.reason, 'not-plugin-launched-window',
            `a selection record shaped ${JSON.stringify(forged)} must not authorize an external window`)
          return true
        })
      }
    }

    // ④ 选择记录里的那个窗口现在已经不在枚举里了（关掉了 / 句柄被回收）→ 拒绝，并如实说明。
    {
      const harness = hostHarness({ selection: userSelection(EXTERNAL_WINDOW.id), windows: [OWNED_WINDOW] })
      await assert.rejects(() => harness.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: EXTERNAL_PID }), (error) => {
        assert.strictEqual(error.reason, 'selected-external-window-unavailable',
          'a selected window that is no longer enumerated must be reported as unavailable, not as "not selected"')
        assert(error.message.includes('「刷新」') && error.message.includes('重选'))
        return true
      })
    }

    // ⑤ 谎报一个本插件的 PID 指向外部窗口：**那个外部句柄借不走**。
    //    T199 的语义是"记住的句柄解析不出窗口时，按这个 PID 找它**当前**的顶层窗口"，所以答案
    //    只可能是本插件自己的窗口（或 null），而不是这个外来句柄 —— 这里把答案钉死成"绝不是它"。
    {
      const harness = hostHarness()
      const borrowed = await harness.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: PLUGIN_PID })
      assert.strictEqual(borrowed.opened, true, 'T199: a plugin PID still resolves to that PID\'s own current window')
      assert.strictEqual(borrowed.externalLaunch, false, 'the borrowed answer is a plugin window, not an external one')
      assert.strictEqual(borrowed.windowId, OWNED_WINDOW.id,
        'the answer must be the plugin PID\'s own window — never the foreign handle the caller pointed at')
      assert.deepStrictEqual(harness.audit, [], '拿到的不是外部窗口，所以不写 externalLaunch 那行')

      // 同一个 PID 名下确实没有可用窗口时，答案就是空 —— 不从别处借。
      const empty = hostHarness({ windows: [EXTERNAL_WINDOW] })
      await assert.rejects(() => empty.handler({}, { windowId: EXTERNAL_WINDOW.id, pid: PLUGIN_PID }), (error) => {
        assert.strictEqual(error.reason, 'plugin-pid-without-usable-window',
          'a plugin PID with no window on screen must answer "no usable window", not reach for a foreign one')
        return true
      })
    }
  }

  // ── 4e.(b) 解析器层面的形状判据：只有**完整且逐字匹配**的凭据才放行外部窗口 ──────────
  {
    const ownership = new CodesysWindowOwnership({ now: () => 6_000_000 })
    ownership.registerPid(PLUGIN_PID)

    // ① 枚举里**只有**那个外部窗口：不传凭据时，两个 PID 都答不出来。
    const externalOnly = new CodesysWindowMonitor(tempRoot, { ownership })
    externalOnly.listRawWindows = async () => [EXTERNAL_WINDOW]
    assert.strictEqual(await externalOnly.resolveOwnedWindow(EXTERNAL_WINDOW.id, EXTERNAL_PID, {}), null,
      'without an explicit credential the resolver must stay exactly as strict as T199')
    assert.strictEqual(await externalOnly.resolveOwnedWindow(EXTERNAL_WINDOW.id, PLUGIN_PID, { launchedPids: [] }), null,
      'a plugin PID must never answer with a foreign handle, even when that PID has no window (T199: answer null, do not borrow)')

    // ② 完整凭据 → 放行（这是唯一的放行形态）。
    assert.strictEqual((await externalOnly.resolveOwnedWindow(EXTERNAL_WINDOW.id, EXTERNAL_PID, {
      explicitSelection: { windowId: EXTERNAL_WINDOW.id, source: 'user-selection', automatic: false },
    }))?.id, EXTERNAL_WINDOW.id, 'the recorded explicit selection is the one extra authorization')

    for (const forged of [
      { windowId: '0xDEADBEE', source: 'user-selection', automatic: false },
      { windowId: EXTERNAL_WINDOW.id, source: 'user-selection', automatic: true },
      { windowId: EXTERNAL_WINDOW.id, source: 'user-selection' },
      { windowId: EXTERNAL_WINDOW.id, source: 'panel', automatic: false },
      true,
      'user-selection',
    ]) {
      assert.strictEqual(await externalOnly.resolveOwnedWindow(EXTERNAL_WINDOW.id, EXTERNAL_PID, { explicitSelection: forged }), null,
        `a credential shaped ${JSON.stringify(forged)} must not resolve an external window`)
    }

    // ③ 本插件那条路不回归，且凭据不会把外部窗口变成"本插件窗口"以外的东西。
    const both = new CodesysWindowMonitor(tempRoot, { ownership })
    both.listRawWindows = async () => [OWNED_WINDOW, EXTERNAL_WINDOW]
    assert.strictEqual((await both.resolveOwnedWindow(OWNED_WINDOW.id, PLUGIN_PID, { launchedPids: [] }))?.id, OWNED_WINDOW.id,
      'the plugin-launched path must not regress')
    // 拿外部窗口的凭据去指本插件窗口：不匹配 → 依旧按归属判定（本插件窗口照旧绑上，但**不是**
    // 因为凭据）。反过来，本插件窗口的凭据对外部句柄毫无用处。
    assert.strictEqual((await both.resolveOwnedWindow(EXTERNAL_WINDOW.id, EXTERNAL_PID, {
      explicitSelection: { windowId: EXTERNAL_WINDOW.id, source: 'user-selection', automatic: false },
    }))?.id, EXTERNAL_WINDOW.id)
    assert.strictEqual(await both.resolveOwnedWindow(EXTERNAL_WINDOW.id, EXTERNAL_PID, {
      explicitSelection: { windowId: OWNED_WINDOW.id, source: 'user-selection', automatic: false },
    }), null, 'a credential for another handle must not resolve this one')

    // ④ 窗口没在这一次枚举里 → 凭据作废（"曾经选过、现在枚举变了"）。
    const gone = new CodesysWindowMonitor(tempRoot, { ownership })
    gone.listRawWindows = async () => [OWNED_WINDOW]
    assert.strictEqual(await gone.resolveOwnedWindow(EXTERNAL_WINDOW.id, EXTERNAL_PID, {
      explicitSelection: { windowId: EXTERNAL_WINDOW.id, source: 'user-selection', automatic: false },
    }), null, 'a credential for a handle that is no longer enumerated must be void')
  }

  // ── 4f. 授权怎么传：只有 workbench-open 这一条带它，且只从主进程记录里构造 ────────────
  {
    const handlerCode = codeOf(HOST_HANDLER_SOURCE)
    assert(handlerCode.includes('const selection = codesysExplicitWindowSelection'),
      'the credential must be built from the main process\'s own record of the explicit selection')
    assert(handlerCode.includes("selection.source === 'user-selection'")
      && handlerCode.includes('selection.automatic === false'),
      'the record\'s provenance must be VERIFIED (来源=显式 + automatic:false), not normalised into a valid credential')
    assert(!/input\s*\??\.\s*explicitSelection/.test(handlerCode),
      'the request body\'s own explicitSelection field must never be read (that is the forgeable flag we did not take)')
    assert(!handlerCode.includes('options.explicitSelection'),
      'the handler must not forward any caller-supplied credential object')
    assert(handlerCode.includes('explicitSelection,'),
      'the handler must hand the credential to the resolver explicitly')

    // 全仓只有这一个调用点经过归属/凭据解析，且它就在 workbench-open 的切片里。
    const callSites = mainSource.split('resolveOwnedWindow(').length - 1
    assert.strictEqual(callSites, 1, `main.js must call resolveOwnedWindow from exactly one place (saw ${callSites})`)
    const callAt = mainSource.indexOf('resolveOwnedWindow(')
    assert(callAt > hostHandlerStart && callAt < hostHandlerEnd,
      'the only resolveOwnedWindow call must live inside codesys:workbench-open')
    assert(HOST_HANDLER_SOURCE.includes('codesysReviveOwnedPids()'),
      'the plugin-owned PID set must still be the T194 one (current registrations + records from the previous run)')

    // 那份"显式选择"记录只能由 `codesys:preferred-window`（用户真的点了一下）写：
    // 清空那一次 + 选中那一次，全在它里面。
    const preferredAt = mainSource.indexOf("handleTrusted('codesys:preferred-window'")
    assert(preferredAt > 0, 'main.js must register codesys:preferred-window')
    const preferredEnd = mainSource.indexOf(CHANNEL, preferredAt)
    assert(preferredEnd > preferredAt, 'the preferred-window handler must be sliceable')
    const preferredHandler = mainSource.slice(preferredAt, preferredEnd)
    assert(preferredHandler.includes('codesysExplicitWindowSelection = { windowId: codesysPreferredWindowId, source: \'user-selection\', automatic: false'),
      'only the user\'s explicit pick may write the selection record, and it must be marked automatic:false')
    assert(preferredHandler.includes('codesysExplicitWindowSelection = null'),
      'clearing the selection must clear the record too')
    assert(!codeOf(HOST_HANDLER_SOURCE).includes('codesysExplicitWindowSelection ='),
      'workbench-open must never write the selection record — otherwise binding would authorize itself')
    const writes = mainSource.split('codesysExplicitWindowSelection =').length - 1
    assert.strictEqual(writes, 3,
      `exactly three writes: the declaration, the clear, the pick (saw ${writes}) — any other writer widens the authorization`)
    assert(mainSource.includes('codesysExplicitWindowSelection = null;'),
      'the declaration and the clear site must both be present')
  }

  // ── 4g. 解析器源码：默认判据完整保留，新增判据是**额外**的，不是替换 ──────────────────
  {
    const resolverAt = monitorSource.indexOf('async resolveOwnedWindow(')
    const resolverEnd = monitorSource.indexOf('\n  async resolveDesktopSource(', resolverAt)
    assert(resolverAt > 0 && resolverEnd > resolverAt, 'windows-monitor.js must still own resolveOwnedWindow')
    const resolver = codeOf(monitorSource.slice(resolverAt, resolverEnd))

    // 默认（T199）那条一字未动。
    assert(resolver.includes('this.ownership.ownsWindow(exact)'),
      'the exact-handle hit must still be filtered by ownership (listWindows returns external windows too)')
    assert(resolver.includes('this.ownership.ownedPidForWindow('),
      'the PID-stable fallback must stay')
    assert(resolver.includes('this.ownership.windowForOwnedPid('),
      'the "current window of that PID" answer must stay')
    // 新增的额外授权。
    assert(resolver.includes('const explicit = options.explicitSelection'))
    assert(resolver.includes("explicit.source === 'user-selection'"))
    assert(resolver.includes('explicit.automatic === false'))
    assert(resolver.includes("String(explicit.windowId || '') === wanted"))
    assert(resolver.includes('exact.owned === false'),
      'the extra authorization is scoped to externally launched windows only')
    // 它必须排在归属判定**之后**、并且在"没有 ownership 就退回精确命中"之前都不改变语义。
    assert(resolver.indexOf('this.ownership.ownsWindow(exact)') < resolver.indexOf('const explicit = options.explicitSelection'),
      'the plugin-owned answer must be computed first: the explicit path is an addition, not a replacement')
  }

  // ── 4h.(b) 绑上外部窗口之后，工作台那条链**真的只读**：bind-project + inspect-project ──
  // 这一条把真实的 `CodesysWorkbench` 组件（shipped DSH bundle）挂起来跑：宿主给出的"当前工程"
  // 就是那个外部启动、用户点选过的监视窗口里的工程（T207 的 `codesys:current-project` 口径），
  // 于是"点代码任务"之后真正发生的动作序列被逐条记下来。
  {
    const OBJECTS = [{
      name: 'PLC_PRG', guid: 'g-pou', type: '6f9dac99-8de1-4efc-8465-68ac443b7d08',
      declaration: 'PROGRAM PLC_PRG', implementation: '', hasDeclaration: true, hasImplementation: true,
      depth: 1, parentGuid: 'g-app', parentName: 'Application', path: ['Device', 'Application', 'PLC_PRG'], hasChildren: false,
    }]
    const seen = []
    const driver = createWorkbenchDriver({
      objects: OBJECTS,
      taskhive: {
        currentCodesysProject: async () => ({
          found: true, sourcePath: 'C:/projects/home.project', detection: 'monitored-window',
          windowId: EXTERNAL_WINDOW.id, pid: EXTERNAL_PID, writeAvailable: true, activeGui: true,
        }),
        runCodesysScriptEngineAction: async (action) => {
          seen.push(action)
          if (action === 'bind-project') return { sourcePath: 'C:/projects/home.project', jobId: 'direct-1', writeAvailable: true, writeBlockReason: '', baselineSha256: 'a'.repeat(64) }
          if (action === 'inspect-project') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(OBJECTS)) } }
          return { status: 'complete', payload: {} }
        },
      },
    })
    await driver.settle(20)
    assert(seen.includes('bind-project'), `工作台必须真的走 bind-project 完成绑定（实际 ${JSON.stringify(seen)}）`)
    assert(seen.includes('inspect-project'), `绑定之后必须真的 inspect-project 读树（实际 ${JSON.stringify(seen)}）`)
    for (const write of ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'rollback']) {
      assert(!seen.includes(write), `绑上外部窗口那条链不许出现任何写/编译动作（发现 ${write}）`)
    }
  }

  console.log('codesys workbench external-window binding: 显式选择后允许绑定，未选择一律拒绝')
}

main().catch((error) => {
  console.error(`codesys workbench unowned-window reason behaviour test failed: ${error.message}`)
  process.exitCode = 1
})
