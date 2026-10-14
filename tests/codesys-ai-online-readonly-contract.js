'use strict'
// Contract (T199 item 3): the ONLINE analysis of the CODESYS plugin must reach the AI as a
// READ-ONLY, ON-DEMAND capability.
//
// What the operator asked for, verbatim in intent:
//   * the CODESYS plugin's real strength is ONLINE (reading the program's internal state);
//   * the AI conversation is the operating surface;
//   * do NOT rebuild "real-time monitoring" -- modlens and the AI live monitor were deleted by
//     the operator, and re-adding a continuous push would be re-adding exactly that;
//   * a read-only online action may be exposed to the AI; every write (download / online
//     change / variable write / start / stop / reset / Force) must stay behind an explicit
//     user click and must never be reachable from a tool.
//
// Why this contract EXECUTES the plugin instead of only grepping it:
//   `taskhive-surfaces/dsh/index.js` is loaded by the DSH runtime and registers its tools
//   through `apply(ctx)`. Nothing in the file needs DSH at module scope, so a contract can
//   import it and drive the real registration, the real fenced route and the real tool. That
//   is what makes the three claims below falsifiable:
//     1. with nothing observed yet, the tool answers with a readable reason AND a nextStep
//        that names what the USER must click -- it never invents a connected state;
//     2. once the panel has published an online snapshot (replayed here through the existing
//        `/taskhive/api/codesys.workbench.publish` route, the only channel the client uses),
//        the same tool returns the real state;
//     3. calling the tool writes nothing and contacts nothing: no engine is constructed, no
//        file appears, and the workbench tool's payload gains no field.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createTempDir } = require('./lib/temp-dir')

const appRoot = path.resolve(__dirname, '..')
const dshDir = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh')
const indexPath = path.join(dshDir, 'index.js')
const host = fs.readFileSync(indexPath, 'utf8')
const client = fs.readFileSync(path.join(dshDir, 'client.js'), 'utf8')
// "某个符号已经彻底消失"这类判据必须只看**代码**：删除原因按本仓惯例写在注释里（含样式表那些
// 模板字符串里的 CSS 注释），注释里出现旧名字不算回归。
const clientCode = client
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── static: the read-only tool, and the absence of any write path into it ─────────────────
assert(host.includes("name: 'taskhive_codesys_online'"), 'the host must register the online read tool')
assert(/description: '[^']*READ-ONLY[^']*never contacts the controller/.test(host),
  'the tool description must say plainly that it is read-only and never contacts the controller')
assert(host.includes("enum: ['state', 'values']"), 'include must be a declared enum, not free text')
assert(host.includes('readOnly: true'), 'every payload must carry readOnly:true')
assert(host.includes('CODESYS_ONLINE_NOT_CONNECTED_NEXT_STEP') && host.includes('CODESYS_ONLINE_NOT_REPORTED_NEXT_STEP'),
  'both "no data yet" and "known but not connected" must have their own actionable next step')

// The tool body must contain NO way to act on a controller or to write anything. These are the
// names that would have to appear if it ever talked to the engine, the PLC or the disk.
const onlineToolStart = host.indexOf("name: 'taskhive_codesys_online'")
const onlineToolEnd = host.indexOf('// The workbench link needs a fenced route', onlineToolStart)
assert(onlineToolStart > 0 && onlineToolEnd > onlineToolStart, 'the online tool must be a registered tool block of its own')
const onlineExecuteStart = host.indexOf('execute: (args, exec) => {', onlineToolStart)
const onlineExecuteEnd = host.indexOf('}, disposers)', onlineExecuteStart)
assert(onlineExecuteStart > 0 && onlineExecuteEnd > onlineExecuteStart, 'the online tool must have an execute body')
// Only the BODY is checked: the description is prose and legitimately says "never downloads".
const onlineExecute = host.slice(onlineExecuteStart, onlineExecuteEnd)
for (const forbidden of ['codesysScriptEngine(', 'writeFileSync', 'appendFileSync', 'child_process', 'spawn(', "send('login'", 'fetch(', 'writeJson', 'rmSync']) {
  assert(!onlineExecute.includes(forbidden),
    `the online read tool's execute body must not be able to ${forbidden} -- it reports what the workbench already observed`)
}
assert(onlineExecute.includes('onlineToolPayload(exec.agent?.session?.id, args?.include)'),
  'the tool must read exactly the published snapshot for this session')

// The snapshot comes in over the EXISTING publish route (no new route, no new method, no push).
assert(host.includes('if (state.online !== undefined) publishOnlineState(sessionId, state.online)'),
  'the online snapshot must ride the existing workbench publish instead of a new route or channel')
assert(host.includes('function publishOnlineState(sessionId, online)') && host.includes('function readOnlineState(sessionId)'),
  'the host must own one store for the published online snapshot')
const routeMethods = host.slice(host.indexOf('function installWorkbenchRoutes'), host.indexOf('function readWorkbenchBody'))
for (const inventedMethod of ["method === 'online'", "codesys.workbench.online", "method === 'online-publish'"]) {
  assert(!routeMethods.includes(inventedMethod), `no new route method may be added for the online snapshot (${inventedMethod})`)
}
assert(!/setInterval\([\s\S]{0,200}?(online|Online)/.test(host) && !/setInterval\(/.test(host.slice(host.indexOf('function onlineToolPayload'), host.indexOf('function onlineToolPayload') + 4000)),
  'the host half must not add a timer for the online state (on demand only)')

// ── the client half: one extra field on the EXISTING 900 ms debounced publish ─────────────
assert(client.includes('online: {'), 'the client must publish the online snapshot as a field of the existing payload')
assert(!client.includes("kind: 'codesys-online'"), 'the payload shape is the host tool\'s concern; the client must not build a tool payload')
assert(client.includes('onlineStateSignature'), 'the client must fingerprint the online SESSION state')
assert(!/onlineStateSignature = \[[\s\S]{0,1200}?onlineValues\.values/.test(client),
  'the online signature must exclude the variable values: including them would make the 1.5 s value poll a continuous push (the deleted live-monitor feature)')
// 本轮 B 项（用户报障原文：「而且对话依然读取不到在线变量」）：上一条纪律只管
// `onlineStateSignature` 这个数组里不许出现**值** —— 而**发布本身**也一起被指纹挡住了：
// 值变了、在线状态没变时就没有发布，于是宿主手里永远停在"打开 POU 那一刻"的那一批值
// （常常还是空的，因为第一笔值 1.5 秒后才回来）。真机帧证明了这就是"对话读不到在线变量"
// 的来源：18:03 用户已经登录（connected:true / isLoggedIn:true / loginMode:"keep"），面板
// 也真的读回了值（startMove=FALSE / iAxis=INT#0 / MaxVel=UDINT#2048576000），宿主却拿不到。
// 解法**不新增任何东西**：把**值的观测时刻**（不是值本身）放进发布指纹，并且只在**已登录到
// 应用**时才放 —— 未登录时 `onlineValues` 恒为 null，这个分量恒为常量 'ov:off'，
// 一个字节都不会多发。
// 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：这个分量原来的判据是
// 「用户自己把那枚开关打开」；开关已整段删除，所以判据按**意图**换成更强的一条 —— 由
// **登录状态**把总闸（值只在登录后存在，登录后也一定会被发布）。
assert(client.includes("onlineLoggedIn && onlineValues ? `ov:${String(onlineValues.at || 0)}` : 'ov:off',"),
  'the observed-value stamp must reach the host, gated by the login state alone'
  + ' (the 「在线值」 switch is gone, so no remembered flag may gate it)');
assert(!clientCode.includes('inlineOnlineValues'),
  'and the deleted switch\'s state must never come back to gate the publish')
assert(!/liveStateFingerprint = \[[\s\S]{0,4000}?onlineValues\.values/.test(client),
  'the publish fingerprint must still never contain the values themselves')
assert(client.includes('valuesObservedAt'), 'the values must carry the time the workbench observed them, so "how fresh is this" is answerable')

// ── executed: real registration, real route, real tool ──────────────────────────────────
function fakeRouteRequest (body) {
  const listeners = { data: [], end: [], error: [] }
  const request = {
    method: 'POST',
    url: '/taskhive/api/codesys.workbench.publish',
    headers: { host: '127.0.0.1:54141' },
    on (event, handler) { if (listeners[event]) listeners[event].push(handler); return request },
    destroy () {},
  }
  setImmediate(() => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    for (const handler of listeners.data) handler(payload)
    for (const handler of listeners.end) handler()
  })
  return request
}

function callRoute (route, body) {
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 0,
      headers: null,
      body: '',
      writeHead (code, headers) { this.statusCode = code; this.headers = headers },
      end (text) { this.body = String(text || ''); resolve({ statusCode: this.statusCode, value: JSON.parse(this.body) }) },
    }
    Promise.resolve(route.handler(fakeRouteRequest(body), response)).catch(reject)
  })
}

async function main () {
  // TASKHIVE_ROOT only matters to the tools that construct an engine. Pointing it at a temp
  // root makes "the online tool touched nothing" observable: a job directory would show up.
  const root = createTempDir('taskhive-online-readonly-')
  const previousRoot = process.env.TASKHIVE_ROOT
  process.env.TASKHIVE_ROOT = root
  try {
    const module = await import(pathToFileURL(indexPath).href)
    const tools = new Map()
    const routes = []
    const scope = {
      webServer: { register: (spec) => { routes.push(spec); return () => {} } },
      webRuntime: { trustedHosts: [] },
      workspaceRegistry: {},
    }
    const ctx = {
      tools: { register: (tool) => { tools.set(tool.name, tool); return () => {} } },
      sessions: { list: () => [] },
      settings: {},
      permissionPresets: { names: ['danger-full-access'], set: () => {} },
      on: () => () => {},
      inject: (_services, callback) => { callback(scope); return () => {} },
    }
    module.apply(ctx)

    const tool = tools.get('taskhive_codesys_online')
    assert(tool, 'apply(ctx) must register taskhive_codesys_online')
    const workbenchTool = tools.get('taskhive_codesys_workbench')
    assert(workbenchTool, 'the workbench read tool must still be registered')
    const route = routes.find((item) => item.path === '/taskhive/api')
    assert(route, 'the fenced /taskhive/api route must still be registered')

    const sessionId = 'session-online-contract'
    const exec = { signal: { throwIfAborted: () => {} }, agent: { session: { id: sessionId } } }
    const snapshotFiles = () => {
      const found = []
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full); else found.push(full)
        }
      }
      walk(root)
      return found
    }
    const filesBefore = snapshotFiles()

    // ① nothing observed yet: a readable reason + an actionable next step, never a fake state.
    const before = await tool.execute({}, exec)
    assert.strictEqual(before.reported, false, 'with no published snapshot the tool must say it has none')
    assert.strictEqual(before.connected, false, 'it must never invent a connection')
    assert.strictEqual(before.readOnly, true, 'the answer must be marked read-only')
    assert(before.reason && before.reason.length > 10, 'the refusal must carry a readable reason')
    assert(before.nextStep && before.nextStep.includes('面板'), 'the refusal must carry an actionable next step naming the panel')
    assert(before.nextStep.includes('只读'), 'the next step must repeat that the tool itself is read-only')
    assert.deepStrictEqual(before.values, [], 'no observed values means an empty list, not a guess')

    // ② replay the client publish: this is the ONLY channel the panel uses, and the state below
    //    is exactly the shape 50-codesys-workbench.js builds.
    const published = {
      sessionId,
      state: {
        projectPath: 'C:\\plc\\Platform.project',
        online: {
          readOnly: true,
          running: true,
          connected: true,
          loggedIn: true,
          loginMode: 'keep',
          applicationState: 'run',
          deviceName: 'PLC_7DOF',
          bound: true,
          target: { summary: 'PLC_7DOF · 192.168.0.10', source: 'scan', address: '192.168.0.10' },
          authorization: { armed: true, capabilities: ['login', 'logout', 'download'], projectName: 'Platform.project', targetSummary: '192.168.0.10' },
          deniedCapabilities: ['debug', 'breakpoint', 'step'],
          values: [{ expression: 'prg.permit', value: 'TRUE' }, { expression: 'prg.speed', value: '12.5' }],
          valuesObservedAt: '2026-10-05T01:02:03.000Z',
          observedAt: '2026-10-05T01:02:04.000Z',
        },
      },
    }
    const accepted = await callRoute(route, published)
    assert.strictEqual(accepted.statusCode, 200, `the publish route must accept the payload (got ${accepted.statusCode}: ${accepted.body})`)
    assert.strictEqual(accepted.value.ok, true, 'the publish must be acknowledged')
    assert.strictEqual(accepted.value.value.accepted, true, 'the publish must be accepted')

    // ③ connected: the tool now returns the real state.
    const state = await tool.execute({}, exec)
    assert.strictEqual(state.reported, true, 'a published snapshot must be readable')
    assert.strictEqual(state.available, true, 'the snapshot must count as available')
    assert.strictEqual(state.connected, true, 'the replay says connected, so the tool must say so')
    assert.strictEqual(state.running, true, 'the online process state must be reported')
    assert.strictEqual(state.loggedIn, true, 'the application login state must be reported')
    assert.strictEqual(state.loginMode, 'keep', 'the login mode must be reported verbatim (monitor-only vs transfer matters)')
    assert.strictEqual(state.applicationState, 'run', 'the PLC application state must be reported')
    assert.strictEqual(state.deviceName, 'PLC_7DOF', 'the device name must be reported')
    assert.strictEqual(state.bound, true, 'the bound flag must be reported')
    assert.strictEqual(state.target.address, '192.168.0.10', 'the bound target must be reported')
    assert.strictEqual(state.authorization.armed, true, 'the armed capabilities must be reported')
    assert.deepStrictEqual(state.authorization.capabilities, ['login', 'logout', 'download'], 'the granted capabilities must be reported verbatim')
    assert.deepStrictEqual(state.deniedCapabilities, ['debug', 'breakpoint', 'step'], 'the capabilities the platform cannot reach must be reported')
    assert.strictEqual(state.reason, '', 'when connected there is no refusal to explain')
    assert.strictEqual(state.nextStep, '', 'when connected there is no next step to give')
    // Values only on request, and always stamped with when the workbench observed them.
    assert.deepStrictEqual(state.values, [], 'include:"state" must not return the value list')
    const withValues = await tool.execute({ include: 'values' }, exec)
    assert.deepStrictEqual(withValues.values, [
      { expression: 'prg.permit', value: 'TRUE' },
      { expression: 'prg.speed', value: '12.5' },
    ], 'include:"values" must return the observed expressions and values')
    assert.strictEqual(withValues.valuesObservedAt, '2026-10-05T01:02:03.000Z',
      'the values must carry the observation time (so a stale read is recognisable)')
    // 本轮 B 项：值**取到**时这一行必须是空串（不制造噪音），而值的年龄必须机器可读。
    assert.strictEqual(withValues.valuesNote, '',
      'when the values are there, valuesNote must stay silent (valuesObservedAt already says how fresh they are)')
    assert.strictEqual(typeof withValues.valuesAgeSeconds, 'number',
      'the value age must be machine-readable, not buried in prose')
    assert(withValues.valuesAgeSeconds >= 0, 'a real valuesObservedAt must yield a real value age')
    assert.strictEqual(withValues.observedAt, '2026-10-05T01:02:04.000Z', 'the snapshot time must be reported')

    // ⑤ 本轮 B 项（用户报障原文：「我通过原声 codesys 登录之后，ai 对话依然检查不到登录状态」）：
    //    我方未登录 + 设备上另有客户端（`sharedConnected`）⇒ 必须**如实一行 + 下一步**，
    //    而且**不许**把它说成故障、不许暗示"登录失败"。零写动作（这条通道本来就只读）。
    const notConnectedShared = {
      sessionId,
      state: {
        projectPath: 'C:\\plc\\Platform.project',
        online: {
          readOnly: true,
          running: true,
          connected: false,
          loggedIn: false,
          loginMode: '',
          applicationState: 'none (0)',
          deviceName: 'Device',
          bound: false,
          sharedConnected: true,
          target: { summary: 'GCAN-PLC-521C · Application', source: '', address: '' },
          authorization: { armed: false, capabilities: [], projectName: '', targetSummary: '' },
          deniedCapabilities: ['debug', 'breakpoint', 'step'],
          values: [],
          valuesObservedAt: '',
          observedAt: '2026-10-08T08:13:27.980Z',
        },
      },
    }
    const acceptedShared = await callRoute(route, notConnectedShared)
    assert.strictEqual(acceptedShared.value.ok, true, 'the not-connected publish must be accepted too')
    const offlineState = await tool.execute({}, exec)
    assert.strictEqual(offlineState.connected, false, 'the replay says not connected, so the tool must say so')
    assert.strictEqual(offlineState.sharedConnected, true,
      'the "another client is connected" weak signal must be reported verbatim (it is the only trace of the native-IDE login)')
    assert(offlineState.reason && offlineState.reason.length > 10, 'the not-connected case still carries its factual reason')
    assert(offlineState.nextStep && offlineState.nextStep.includes('面板'),
      'and the actionable next step still names the panel (the only path that works)')
    assert(offlineState.loginVisibility && offlineState.loginVisibility.length > 20,
      'a readable line must explain WHY the login state cannot be read')
    assert(offlineState.loginVisibility.includes('看不到'),
      'it must say plainly that the native IDE login is invisible to us (process isolation), not that the login failed')
    assert(offlineState.loginVisibility.includes('共享') || offlineState.loginVisibility.includes('别的客户端'),
      'and it must relay the sharedConnected signal truthfully when it is present')
    assert(offlineState.loginVisibility.includes('不等于'),
      'it must explicitly refuse to equate "I cannot see it" with "your login failed" (the user DID log in)')
    assert(offlineState.loginVisibility.includes('登录'),
      'it must name the one step that makes the online values readable: logging in from the panel')
    assert(offlineState.values.length === 0, 'still no invented values')

    // ⑥ 能**看到登录后状态**时那三行必须**不出现**（已经读到了，再挂一行说明就是过期的
    //    解释）——回到第 ③ 步那一帧确认。判据是 loggedIn（应用层登录），不是 connected。
    const stillConnected = await callRoute(route, published)
    assert.strictEqual(stillConnected.value.ok, true, 're-publishing the connected state must be accepted')
    const connectedState = await tool.execute({}, exec)
    assert.strictEqual(connectedState.connected, true, 'the connected frame is back')
    assert.strictEqual(connectedState.loggedIn, true, 'the application login is visible in this frame')
    assert.strictEqual(connectedState.reason, '', 'when the login is visible there is no refusal to explain')
    assert.strictEqual(connectedState.nextStep, '', 'when the login is visible there is no next step to give')
    assert.strictEqual(connectedState.loginVisibility, '',
      'when the login is visible the "why can I not see your login" line must be gone (it would be a stale explanation)')

    console.log('[自测] ⑤⑥ 登录状态看不见：未连接 + sharedConnected=true → 如实一行 + 下一步（nextStep 含「面板」）；'
      + `loggedIn=true 时 reason/nextStep/loginVisibility 全为空串；变量 ${offlineState.values.length} 条（不编造） ✓`)
    console.log(`        loginVisibility = ${JSON.stringify(offlineState.loginVisibility)}`)

    // ⑦ 本轮 C 项（用户报障原文：「我已经在codesys工作台登录了，但是对话依然读不到」）：
    //    真机逐帧证据（jobs\direct-1791451665733-44f1472e\online\online-result-22e040686b1b-*.json，
    //    用户 17:28:49 点「登录」后每 8 秒一条 status，到 17:32:01 共 40 条逐条相同）就是这一帧：
    //      connected:true  sharedConnected:true  isLoggedIn:false  applicationState:"none (0)"
    //    旧写法把 reason/nextStep/loginVisibility 全挂在 connected 上 ⇒ 恰好在这一帧三条全空，
    //    模型只能说一句 "loggedIn:false"。这条断言就是这个缺陷的回归闸门。
    const connectedNotLoggedIn = {
      sessionId,
      state: {
        projectPath: 'C:\\plc\\Platform.project',
        online: {
          readOnly: true,
          running: true,
          connected: true,
          loggedIn: false,
          loginMode: '',
          applicationState: 'none (0)',
          deviceName: 'Device',
          bound: true,
          sharedConnected: true,
          target: { summary: 'GCAN-PLC-521C · Application', source: 'scan', address: '0301.60BC' },
          authorization: { armed: true, capabilities: ['login', 'logout'], projectName: 'Platform.project', targetSummary: '0301.60BC' },
          deniedCapabilities: ['debug', 'breakpoint', 'step'],
          values: [],
          valuesObservedAt: '',
          observedAt: '2026-10-08T09:28:49.123Z',
        },
      },
    }
    const acceptedNotLoggedIn = await callRoute(route, connectedNotLoggedIn)
    assert.strictEqual(acceptedNotLoggedIn.value.ok, true, 'the connected-but-not-logged-in publish must be accepted too')
    const notLoggedInState = await tool.execute({}, exec)
    assert.strictEqual(notLoggedInState.connected, true, 'the replay is connected, so the tool must say connected:true')
    assert.strictEqual(notLoggedInState.loggedIn, false, 'the application login is still not visible, so loggedIn stays false (never invented)')
    assert(notLoggedInState.reason && notLoggedInState.reason.length > 10,
      'connected:true + loggedIn:false MUST carry a reason — three empty strings here is the reported bug')
    assert(notLoggedInState.nextStep && notLoggedInState.nextStep.length > 10,
      'AND an actionable next step (the user was told nothing and could do nothing)')
    assert(notLoggedInState.loginVisibility && notLoggedInState.loginVisibility.length > 20,
      'AND the line that explains why the login state cannot be read')
    assert(notLoggedInState.nextStep.includes('下载'),
      'the only step that can actually log the application in is the panel download button')
    assert(!notLoggedInState.nextStep.includes('扫描设备'),
      'it must not send the operator back to a step they already completed (scan/login is what produced this exact frame)')
    assert(notLoggedInState.loginVisibility.includes('不等于'),
      'it must still refuse to equate "I cannot see it" with "your click failed"')
    assert(notLoggedInState.loginVisibility.includes('看不到'),
      'and it must still say the native IDE session is invisible to us')
    assert(notLoggedInState.loginVisibility.includes('共享') || notLoggedInState.loginVisibility.includes('别的客户端'),
      'and relay the sharedConnected signal truthfully')
    assert.strictEqual(notLoggedInState.sharedConnected, true, 'the weak signal is reported verbatim, still as a non-verdict')
    assert.strictEqual(notLoggedInState.values.length, 0, 'still no invented values')

    // ⑨ 本轮 B 项：include:"values" 在一个"已连接 + 未登录 + 没有值"的帧上必须**说清缺哪
    //    一步**，而不是只回一个空数组（用户抱怨的原话就是"对话依然读取不到在线变量"）。
    const notLoggedInValues = await tool.execute({ include: 'values' }, exec)
    assert(notLoggedInValues.values.length === 0, 'still no invented values')
    assert(notLoggedInValues.valuesNote.includes('下载'),
      'with the application not logged in, the note must name the panel download as the only step that logs it in')
    assert(notLoggedInValues.valuesNote.includes('登录之后才有'),
      'and it must say WHY the values are unreadable (they only exist after an application login)')
    assert.strictEqual(notLoggedInValues.valuesAgeSeconds, -1,
      'with no observed values there is no value age to claim (-1, never 0 which would say "just now"）')
    // 没要求值时这一行必须是空串：它只在"要了值却拿不到"时说话，不制造噪音。
    assert.strictEqual(notLoggedInState.valuesNote, '',
      'without include:"values" there is nothing to explain about values')

    // ⑧ 本轮 D 项：陈旧快照必须**如实披露年龄**，不许把旧时刻当现状。
    //    这是"两次调用 observedAt 完全相同"的正解：面板的发布是指纹驱动的
    //    （50-codesys-workbench.js:2714-2731 / 2732），指纹里没有时间戳，observedAt
    //    是"最后一次观测到**变化**的时刻"（2823 行），状态不变它就不推进 —— 不是缓存、
    //    也不是读了旧文件。工具不轮询、也不能自己去取心跳（只读红线 + 上面的禁用名单），
    //    所以它必须把这个时刻**有多旧**说出来。
    assert.strictEqual(typeof notLoggedInState.observedAgeSeconds, 'number',
      'the observation age must be machine-readable, not buried in prose')
    assert(notLoggedInState.observedAgeSeconds >= 0, 'a published observedAt must yield a real age, not the -1 "unknown"')
    assert(notLoggedInState.freshness.includes(notLoggedInState.observedAt),
      'the freshness line must quote the observation time it is ageing')
    assert(notLoggedInState.freshness.includes('秒前'), 'and say how old it is in plain words')
    const secondRead = await tool.execute({}, exec)
    assert.strictEqual(secondRead.observedAt, notLoggedInState.observedAt,
      'an unchanged panel snapshot keeps the same observedAt (fingerprint-gated publish, not a cache)')
    assert(secondRead.freshness.includes('最后一次观测到状态变化'),
      'the freshness line must state that observedAt is the last CHANGE, not the moment of this read')
    assert(secondRead.observedAgeSeconds >= notLoggedInState.observedAgeSeconds,
      'the disclosed age must keep moving forward even while observedAt stands still')
    assert.strictEqual(before.observedAgeSeconds, -1,
      'with no published snapshot there is no age to claim (0 would be a lie: it says "just now")')
    assert(before.freshness && before.freshness.length > 10,
      'and the absence of any observation time must be said out loud')

    console.log('[自测] ⑦⑧ 已连接但未登录：reason/nextStep/loginVisibility 三条都非空，'
      + `nextStep 指向「下载」（含「扫描设备」=${notLoggedInState.nextStep.includes('扫描设备')}）；`
      + `年龄 observedAgeSeconds=${notLoggedInState.observedAgeSeconds}s（observedAt=${notLoggedInState.observedAt} 两次调用不变），`
      + `未观测时 observedAgeSeconds=${before.observedAgeSeconds} + 如实一行 ✓`)
    console.log(`        freshness = ${JSON.stringify(notLoggedInState.freshness)}`)

    // ⑩ 本轮 B 项（真机现场：用户 18:03 **确实已经登录**、面板**确实读到了值**，而对话
    //    读不到）：已连接 + **已登录** + 但这一列还没有值 ⇒ 缺的那一步是**切到某个 POU**
    //    （读值的清单来自它的声明），因为读值**随登录自动开始**；同时**不许**把这件事
    //    说成登录问题 —— 这一帧的 reason/nextStep/loginVisibility 必须仍然是空串。
    //    本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）按**意图**更新了
    //    这几条：文案里**不许**再出现任何"要用户去点的开关"（开关已整段删除）。
    const loggedInNoValues = {
      sessionId,
      state: {
        projectPath: 'C:\\plc\\Platform.project',
        online: {
          readOnly: true,
          running: true,
          connected: true,
          loggedIn: true,
          loginMode: 'keep',
          applicationState: 'stop (2)',
          deviceName: 'GCAN-PLC-521C',
          bound: true,
          sharedConnected: true,
          target: { summary: 'GCAN-PLC-521C · Application', source: 'scan', address: '0301.60BC' },
          authorization: { armed: true, capabilities: ['login', 'logout'], projectName: 'Platform.project', targetSummary: '0301.60BC' },
          deniedCapabilities: ['debug', 'breakpoint', 'step'],
          values: [],
          valuesObservedAt: '',
          observedAt: '2026-10-08T10:03:40.000Z',
        },
      },
    }
    const acceptedNoValues = await callRoute(route, loggedInNoValues)
    assert.strictEqual(acceptedNoValues.value.ok, true, 'the logged-in-without-values publish must be accepted too')
    const noValues = await tool.execute({ include: 'values' }, exec)
    assert.strictEqual(noValues.loggedIn, true, 'this frame has the application logged in')
    assert.strictEqual(noValues.connected, true, 'and the controller connected')
    assert(noValues.values.length === 0, 'and yet no observed values (the code editor has no POU open)')
    assert(noValues.valuesNote.includes('在线值'),
      'the note must name the inline online values as what is missing')
    assert(!noValues.valuesNote.includes('开关'),
      'and it must NOT tell the operator to click a switch: the 「在线值」 switch has been deleted,'
      + ' the values are read automatically once logged in')
    assert(noValues.valuesNote.includes('随登录自动') || noValues.valuesNote.includes('自动开始'),
      'it must say plainly that the read starts by itself after a login (no click required)')
    assert(noValues.valuesNote.includes('POU'),
      'and point at opening a POU first (that is what makes the editor ask for values)')
    assert(noValues.valuesNote.includes('只读') || noValues.valuesNote.includes('不会替用户'),
      'and repeat that the tool itself will not read anything on its own')
    assert(noValues.valuesNote.includes('登录'),
      'and it must still be about a logged-in session (the values only exist after a login)')
    assert.strictEqual(noValues.reason, '',
      'an unread variable value is NOT a login failure: this frame must carry no refusal')
    assert.strictEqual(noValues.nextStep, '',
      'and no "log in / download" next step either (the login already succeeded)')
    assert.strictEqual(noValues.valuesAgeSeconds, -1, 'no values ⇒ no value age')
    console.log('[自测] ⑩ 已登录但没有值：valuesNote 指向"切到一个 POU"（读值随登录自动开始、'
      + `文案里没有任何开关：开关=${noValues.valuesNote.includes('开关')}）；`
      + `reason/nextStep 仍为空串（不把"还没打开 POU"说成登录失败）✓`)

    // The declared output schema and the actual payload must agree exactly: a field the schema
    // does not declare is a field the model cannot rely on.
    const declared = Object.keys(tool.output.schema.properties).sort()
    assert.deepStrictEqual(Object.keys(state).sort(), declared,
      'the payload must have exactly the declared fields')
    assert.deepStrictEqual(tool.output.schema.required.slice().sort(), declared,
      'every declared field must be required (a partial read model is a lie by omission)')

    // ④ read-only, proven: no engine, no file, and the workbench payload gained nothing.
    assert.deepStrictEqual(snapshotFiles(), filesBefore,
      'calling the online tool must not create or modify a single file (no engine, no job directory, no log)')
    const workbench = await workbenchTool.execute({}, exec)
    assert(!Object.prototype.hasOwnProperty.call(workbench, 'online'),
      'the workbench tool must not expose the online snapshot through its own payload (one tool, one concern)')
    assert.strictEqual(workbench.kind, 'codesys-workbench', 'the workbench tool must keep working unchanged')

    // A different session must not see this session's controller state.
    const otherSession = await tool.execute({}, { signal: exec.signal, agent: { session: { id: 'someone-else' } } })
    assert.strictEqual(otherSession.reported, false, 'the online snapshot must be scoped to the session that observed it')

    console.log('[自测] ③ 只读在线工具：未观测 → reported=false + reason + nextStep；回放面板发布（同一条 /taskhive/api/codesys.workbench.publish）→ connected='
      + `${state.connected} device=${state.deviceName} loginMode=${state.loginMode} app=${state.applicationState} 变量 ${withValues.values.length} 条（观测于 ${withValues.valuesObservedAt}）；`
      + `调用零副作用（文件数 ${filesBefore.length} → ${snapshotFiles().length}）、工作台工具负载未变、会话隔离 ✓`)
  } finally {
    if (previousRoot === undefined) delete process.env.TASKHIVE_ROOT
    else process.env.TASKHIVE_ROOT = previousRoot
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

main().then(() => {
  console.log('codesys online readonly AI contract passed')
  process.exit(0)
}).catch((error) => {
  console.error(`codesys online readonly AI contract failed: ${error.message}`)
  process.exit(1)
})
