'use strict'

// Scenario: 断连重连 (disconnect / reconnect of the online session).
//
// After a PLC session goes away — the worker exits, the connection drops, the
// idle process is released — the UI must stop claiming "connected". The panel's
// connection state is derived from the host status payload (`state.connected`),
// and the host's `onlineStatus()` is what produces it, so both halves of that
// contract are exercised here against the real code:
//
//   Part 1  the REAL `CodesysWorkbench` component + its real 8 s/60 s status
//           poll: connected → the bottom row shows the PLC state; session gone
//           → the chip and the state text must disappear; reconnect → they come
//           back. Nothing here fakes the derivation.
//   Part 2  the REAL `CodesysOnlineSession` (host side) driven through its own
//           file protocol with a fake worker process: an abrupt exit must be
//           reported as "not running", `send` must classify it, and a restart
//           must produce a NEW session (new run token, fresh ready payload,
//           sequence reset) instead of resurrecting the previous one.
//   Part 3  the REAL `CodesysScriptEngine.onlineStatus()` — the exact function
//           the renderer's IPC call reaches: while a session is gone or
//           unresponsive it must return a payload with NO `state`, which is what
//           makes the UI render "not connected" rather than keep the stale one.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { join } = require('node:path')
const { createWorkbenchDriver } = require('./lib/workbench-driver')
const { CodesysOnlineSession } = require('../plugins/installed/codesys-monitor/online-session.cjs')
const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const CONNECTED = {
  ok: true,
  running: true,
  state: {
    connected: true,
    isLoggedIn: true,
    loginMode: 'keep',
    applicationState: 'run',
    applicationStateLabel: '运行',
    operationFlags: [],
    operationWarnings: [],
  },
  ready: { deviceName: 'GCAN-PLC-521C', application: 'PLC_PRG' },
}
const SESSION_GONE = { ok: true, running: false, ready: null, lastError: '在线进程已退出' }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── 内部预算与诊断（T229）───────────────────────────────────────────────────
//
// 失败类型必须由**契约自己**判定，不能交给 runner 猜。runner 的全局预算是 120 s
// （`tests/run-contracts.js` 的 DEFAULT_TIMEOUT_MS），而 `CodesysOnlineSession` 自带的
// `start(timeoutMs = 180000)` / `send(timeoutMs = 120000)` 默认值**都不小于**这个数 ——
// 于是一旦哪一步真的卡住，先被杀掉的一定是进程，契约自己的诊断永远打不出来，现场只
// 剩一行 `[TIMEOUT] … (budget 120000ms, killed)`：分不清"环境停顿"还是"回归"。
//
// 实测（T229；单跑与三棵树并行各 ≥3 轮）：
//   * 就绪握手（夹具同步写 ready 文件）：< 1 ms；
//   * 每一次 `send`：≈150 ms（`send` 的 150 ms 轮询节拍）；
//   * 每一次 `stop` 的 quit 握手：≈200 ms。
// 三笔预算因此各留数倍以上余量，同时**总和仍显著小于 120 s**（最坏 ≈75 s：三次 start
// 10 s + 五次 send 8 s + 两次 stop ≈2.6 s + 半截场景一次 start/stop）：契约总是在
// runner 动手之前自己失败、自己打印原因。
//
// `ONLINE_STOP_GRACE_MS` 另有一层理由：生产侧 `stop()` 用
// `Promise.race([send('quit', {}, graceMs), sleep(graceMs)])`，race 的败者**不会**被取消，
// 于是每走到那一步就留一个 graceMs 长的未决定时器挂着事件循环。旧契约用默认
// graceMs=4000：实测 4,865-4,903 ms 的墙钟 ≈ 0.9 s 真工作 + 一次 stop 留下的 4.0 s
// 空等（`stop('disconnect')` 那一次 worker 已经退出，`stop()` 连 race 都不会进）。
// 800 ms 是实测握手（200 ms）的 4 倍，把这段无谓迟滞压到 <1 s，同时仍远大于握手本身。
const ONLINE_START_BUDGET_MS = 10000;
const ONLINE_SEND_BUDGET_MS = 8000;
const ONLINE_STOP_GRACE_MS = 800;

// 分段耗时 / 计数：成功与失败**都**打印。下一次读日志时，"环境停顿、进程被杀"
// 与"断言不成立、真回归"必须一眼可分。
const runStartedAt = Date.now();
const stages = [];
function stage (name) {
  stages.push(`${name}=${Date.now() - runStartedAt}ms`);
}
let readyFaults = 0;   // 夹具就绪文件"存在但读不出/解析不出"的观测次数（T203 同口径）
let tornWindowMs = 0;  // 生产侧容忍半截就绪文件的窗口（半截写 → 完整写之间的毫秒）

// 夹具真句柄登记表：**任何退出路径**都必须把它们清掉。契约若用裸
// `process.exitCode = 1` 收尾，一个漏掉的 `setInterval` 会让进程永远不退出 ——
// runner 只能报 TIMEOUT（T229 变异实证）。其余五条用假 worker 的契约
// （session-concurrency / preopen-early / scriptengine-project-reuse /
//  scriptengine-speed / write-save-count）都以显式 `process.exit()` 收尾，
// 这一条是唯一漏网的。
const fakeWorkers = [];
function stopFakeWorkers () {
  for (const worker of fakeWorkers) worker.stopWatchers();
}
function diagnostics () {
  const live = fakeWorkers.reduce((total, worker) => total + worker.liveWatchers(), 0);
  return `总 ${Date.now() - runStartedAt}ms · 分段 ${stages.join(' ')} · 就绪读故障 ${readyFaults} 次 · 半截容忍窗口 ${tornWindowMs}ms · 夹具 ${fakeWorkers.length} 个（未清句柄 ${live}）`;
}

// ── Part 1: the UI must reconcile ───────────────────────────────────────────
async function uiReconciliation () {
  let status = CONNECTED
  let statusCalls = 0
  const driver = createWorkbenchDriver({
    objects: [{
      name: 'PLC_PRG',
      guid: 'guid-plc-prg',
      type: 'PROGRAM',
      hasDeclaration: true,
      hasImplementation: true,
      declaration: 'PROGRAM PLC_PRG\nEND_VAR',
      implementation: 'x := 1;',
      path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
    }],
    onlineStatus: () => { statusCalls += 1; return status },
  })
  await driver.settle()

  assert.strictEqual(driver.onlineChipState(), 'logged-in',
    'a connected session must show up as connected')
  const connectedText = driver.onlineStateText()
  assert(typeof connectedText === 'string' && /PLC/.test(connectedText),
    `the bottom status row must show the PLC state while connected (saw ${JSON.stringify(connectedText)})`)
  const callsAfterMount = statusCalls
  assert(callsAfterMount >= 1, 'the workbench must poll the host for the online status')

  // The worker exits / the connection drops / the idle process is released.
  status = SESSION_GONE
  await driver.settle()
  assert(statusCalls > callsAfterMount,
    'the disconnect must be noticed by a real status round trip, not by a lucky re-render')
  assert.strictEqual(driver.onlineChipState(), 'idle',
    'after the session is gone the panel must not still claim to be connected')
  assert.strictEqual(driver.onlineStateText(), null,
    'the stale "PLC 运行" text must disappear with the connection')

  // Reconnect.
  status = CONNECTED
  await driver.settle()
  assert.strictEqual(driver.onlineChipState(), 'logged-in',
    'reconnecting must bring the connected state back')
  assert(typeof driver.onlineStateText() === 'string',
    'the PLC state text must come back after a reconnect')

  // And away again: the flip must be repeatable, not a one-shot.
  status = SESSION_GONE
  await driver.settle()
  assert.strictEqual(driver.onlineChipState(), 'idle', 'a second disconnect must reconcile again')
  driver.unmount()
}

// ── Part 2: the host-side session across a disconnect / reconnect ───────────
// `options.tornReadyMs` 注入 T203 那一类**非原子就绪握手**（先半截、后完整）。
function createFakeWorker (workDir, options = {}) {
  const sessions = []
  const state = { starts: 0 }
  const spawnProcess = (exePath, args) => {
    const scriptArg = String(args.find((arg) => String(arg).startsWith('--runscript=')) || '')
    const scriptPath = scriptArg.slice('--runscript='.length).replace(/^"|"$/g, '')
    const token = /online-worker-(.+)\.py$/.exec(path.basename(scriptPath))?.[1]
    if (!token) throw new Error(`the worker script name must carry the run token: ${scriptPath}`)
    state.starts += 1
    const runIndex = state.starts

    const emitter = new EventEmitter()
    // 这个假 worker 只用一个**真**句柄（5 ms 轮询定时器）。它必须能被
    // `stopWatchers()` 无条件清掉：契约失败时进程还得照常退出（见文件头注释）。
    const handles = []
    const track = (kind, handle) => {
      const entry = { kind, handle, cleared: false }
      handles.push(entry)
      return entry
    }
    const clearSessionHandles = () => {
      for (const entry of handles) {
        if (entry.cleared) continue
        entry.cleared = true
        if (entry.kind === 'interval') clearInterval(entry.handle)
        else clearTimeout(entry.handle)
      }
    }
    const child = {
      pid: 9000 + runIndex,
      exitCode: null,
      killed: false,
      on: (event, handler) => { emitter.on(event, handler); return child },
      once: (event, handler) => { emitter.once(event, handler); return child },
      kill: () => { child.killed = true; clearSessionHandles(); return true },
      // test-side controls
      exitNow: (code) => { child.exitCode = code; emitter.emit('exit', code, null) },
    }
    const connection = { connected: false, isLoggedIn: false, loginMode: '' }
    child.connection = connection
    child.runIndex = runIndex
    child.token = token
    child.handles = handles

    const readyPath = path.join(workDir, `online-ready-${token}.json`)
    const writeReadyFile = () => fs.writeFileSync(readyPath, JSON.stringify({
      ok: true,
      deviceName: `GCAN-PLC-521C (run ${runIndex})`,
      application: 'PLC_PRG',
      sessionReused: false,
      runIndex,
    }))
    // The worker writes its ready file before `start()` begins polling.
    //
    // T203 的病灶就长在这里：`Set-Content` 那一类写法是"先建路径、写完才关句柄"，
    // 于是"文件已存在"与"文件已就绪"是两件事。生产侧的 `start()` 按**语义**就绪判定
    // （读得出 + 能解析 + 字段齐，半截/空只当"还没好"继续轮询）。`tornReadyMs` 就是
    // 把这个空窗**注进来**：先写半截（存在、读得出、解析不出），过 N ms 再写完整。
    // 契约必须容忍它 —— 容忍不了就是"就绪握手是原子"这个假设被写进了测试。
    if (options.tornReadyMs) {
      fs.writeFileSync(readyPath, '{"ok":true,"deviceName":"GCAN-PLC-521C (run ')
      state.tornAt = Date.now()
      track('timeout', setTimeout(() => { writeReadyFile(); state.tornSettledAt = Date.now() }, options.tornReadyMs))
    } else {
      writeReadyFile()
    }

    let lastSeq = 0
    const commandPath = path.join(workDir, `online-command-${token}.json`)
    track('interval', setInterval(() => {
      if (child.exitCode !== null) return
      if (!fs.existsSync(commandPath)) return
      let payload = null
      try { payload = JSON.parse(fs.readFileSync(commandPath, 'utf8')) } catch { return }
      if (!payload || payload.seq === lastSeq) return
      lastSeq = payload.seq
      let value = {}
      let ok = true
      if (payload.command === 'status' || payload.command === 'monitor') {
        value = { ...connection, deviceName: `GCAN-PLC-521C (run ${runIndex})`, runIndex }
      } else if (payload.command === 'login') {
        connection.connected = true
        connection.isLoggedIn = true
        connection.loginMode = 'keep'
        value = { ...connection, runIndex }
      } else if (payload.command === 'logout') {
        connection.connected = false
        connection.isLoggedIn = false
        connection.loginMode = ''
        value = { ...connection, runIndex }
      } else if (payload.command === 'quit') {
        value = { quit: true, runIndex }
        child.exitNow(0)
      }
      fs.writeFileSync(
        path.join(workDir, `online-result-${token}-${payload.seq}.json`),
        JSON.stringify({ seq: payload.seq, ok, value }),
      )
    }, 5))
    // 真进程退出时它的定时器也随进程消失：夹具照此办理，把该会话的句柄全部清掉。
    emitter.on('exit', clearSessionHandles)

    sessions.push(child)
    return child
  }
  // 夹具级清理：契约的 main() 在**成功与失败两条路径**上都调它。
  const stopWatchers = () => { for (const child of sessions) child.kill(); }
  const liveWatchers = () => sessions.reduce((total, child) => total + child.handles.filter((entry) => !entry.cleared).length, 0)
  const fixture = { spawnProcess, sessions, state, stopWatchers, liveWatchers }
  fakeWorkers.push(fixture)
  return fixture
}

async function hostSessionLifecycle () {
  const workDir = createTempDir('taskhive-online-session-')
  const projectPath = path.join(workDir, 'demo.project')
  fs.writeFileSync(projectPath, 'fixture')
  const fake = createFakeWorker(workDir)

  const first = new CodesysOnlineSession({ spawnProcess: fake.spawnProcess, log: () => {} })
  const ready = await first.start({ workDir, projectPath, timeoutMs: ONLINE_START_BUDGET_MS })
  assert.strictEqual(ready.ok, true, 'the fake worker must report ready')
  assert.strictEqual(first.running, true)
  const firstToken = first.runToken
  assert(firstToken, 'a started session must carry a run token')

  const status = await first.send('status', {}, ONLINE_SEND_BUDGET_MS)
  assert.strictEqual(status.connected, false, 'a fresh session starts disconnected')
  const login = await first.send('login', {}, ONLINE_SEND_BUDGET_MS)
  assert.strictEqual(login.connected, true)
  assert.strictEqual(login.runIndex, 1)
  assert.strictEqual((await first.send('status', {}, ONLINE_SEND_BUDGET_MS)).connected, true)

  // ── the disconnect: the worker process is gone ────────────────────────────
  fake.sessions[0].exitNow(1)
  assert.strictEqual(first.running, false, 'a dead worker must not read as running')
  await assert.rejects(() => first.send('status', {}, ONLINE_SEND_BUDGET_MS), (error) => error.code === 'CODESYS_ONLINE_SESSION_NOT_RUNNING',
    'a command against a dead session must be classified, not silently answered from the previous state')
  const stopped = await first.stop('disconnect', { graceMs: ONLINE_STOP_GRACE_MS })
  assert.strictEqual(stopped.stopped, true)
  assert.strictEqual(first.ready, null, 'stopping a session must drop its ready payload')

  // ── the reconnect: a NEW session, not the old one resurrected ─────────────
  const second = new CodesysOnlineSession({ spawnProcess: fake.spawnProcess, log: () => {} })
  const readyAgain = await second.start({ workDir, projectPath, timeoutMs: ONLINE_START_BUDGET_MS })
  assert.strictEqual(readyAgain.ok, true)
  assert.strictEqual(second.running, true)
  assert.notStrictEqual(second.runToken, firstToken,
    'a reconnect must get its own run token so nothing from the previous session can be mistaken for it')
  assert.strictEqual(second.seq, 0, 'a new session starts its command sequence over')
  assert.strictEqual(readyAgain.runIndex, 2, 'the ready payload must come from the NEW worker')
  assert.strictEqual(readyAgain.sessionReused, false)

  const freshStatus = await second.send('status', {}, ONLINE_SEND_BUDGET_MS)
  assert.strictEqual(freshStatus.runIndex, 2,
    'the reconnect must answer with the new worker state, never the previous session answer')
  assert.strictEqual(freshStatus.connected, false, 'the new worker has no PLC connection yet')
  const freshLogin = await second.send('login', {}, ONLINE_SEND_BUDGET_MS)
  assert.strictEqual(freshLogin.connected, true)
  assert.strictEqual(freshLogin.runIndex, 2)

  await second.stop('test-cleanup', { graceMs: ONLINE_STOP_GRACE_MS })
  assert.strictEqual(second.running, false)
  fs.rmSync(workDir, { recursive: true, force: true })
}

// ── Part 2b: the ready handshake is NOT atomic (T203 病灶，注入证明）──────────
//
// 夹具先写一个**存在但解析不出**的半截 `/ready` 文件，隔一段时间才写完整的。
// 生产侧 `start()` 必须按语义就绪判定（读得出 + 能解析 + 字段齐）继续轮询到完整
// 那一份为止：既不能在半截上"成功"，也不能把半截当失败（那条路会让 CODESYS 冷启动
// 直接报"初始化失败"）。注入窗口就是 T203 实测到的那个空窗形态。
async function tornReadyHandshake () {
  const workDir = createTempDir('taskhive-online-torn-ready-')
  const projectPath = path.join(workDir, 'demo.project')
  fs.writeFileSync(projectPath, 'fixture')
  const tornMs = 300
  const fake = createFakeWorker(workDir, { tornReadyMs: tornMs })
  const session = new CodesysOnlineSession({ spawnProcess: fake.spawnProcess, log: () => {} })

  // 数出生产侧**真的**看见了几次"存在但解析不出"：只包住这一段，且读完就还原。
  // 这个计数是注入是否落地的证据 —— 计数为 0 说明空窗根本没被观测到，那样这一节
  // 就什么都没证明。
  const realReadFileSync = fs.readFileSync
  fs.readFileSync = function countTornReady (file, ...rest) {
    const body = realReadFileSync.call(fs, file, ...rest)
    if (String(file).includes('online-ready-') && typeof body === 'string') {
      try { JSON.parse(body) } catch { readyFaults += 1 }
    }
    return body
  }
  let ready
  try {
    ready = await session.start({ workDir, projectPath, timeoutMs: ONLINE_START_BUDGET_MS })
  } finally {
    fs.readFileSync = realReadFileSync
  }

  assert.strictEqual(fake.state.tornAt > 0, true, 'the injection must have written the torn ready file first')
  tornWindowMs = Date.now() - fake.state.tornAt
  assert(tornWindowMs >= tornMs,
    `start() must not resolve before the complete ready file exists (torn window ${tornWindowMs}ms < ${tornMs}ms)`)
  assert(readyFaults >= 1,
    `the production readiness loop must have OBSERVED the torn ready file at least once (saw ${readyFaults}) — otherwise the injection proved nothing`)
  assert.strictEqual(ready.ok, true, 'a torn ready file must not be reported as an initialization failure')
  assert.strictEqual(ready.runIndex, 1, 'the payload must come from the complete ready file, not the torn one')
  assert.strictEqual(ready.sessionReused, false)
  assert.strictEqual(session.running, true)
  // 半截文件里那句话（`GCAN-PLC-521C (run `）绝不许被当成设备名报出去。
  assert.strictEqual(ready.deviceName, 'GCAN-PLC-521C (run 1)',
    'a half-written ready payload must never be reported as the device')

  await session.stop('torn-ready-cleanup', { graceMs: ONLINE_STOP_GRACE_MS })
  fs.rmSync(workDir, { recursive: true, force: true })
}

// ── Part 3: the payload the UI derives "connected" from ─────────────────────
async function statusPayloadContract () {
  const root = createTempDir('taskhive-online-status-')
  const engine = new CodesysScriptEngine(root)

  const noSession = await engine.onlineStatus()
  assert.strictEqual(noSession.running, false)
  assert(!('state' in noSession),
    'without a session the status payload must carry no `state`, so the UI cannot read a stale connected flag')

  // A live session reports a state.
  const liveSession = {
    running: true,
    ready: { deviceName: 'GCAN-PLC-521C' },
    lastError: '',
    child: { pid: 4321 },
    send: async () => ({ connected: true, isLoggedIn: true, applicationState: 'run' }),
  }
  engine.onlineSession = liveSession
  engine.onlineSessionJobId = 'direct-1'
  const live = await engine.onlineStatus()
  assert.strictEqual(live.ok, true)
  assert.strictEqual(live.running, true)
  assert.strictEqual(live.state.connected, true, 'a live session must report its connection state')

  // The worker dies: `running` flips to false and the state disappears.
  liveSession.running = false
  const dead = await engine.onlineStatus()
  assert.strictEqual(dead.running, false)
  assert(!('state' in dead),
    'a dead session must not keep answering with the last connected state')

  // The worker is alive but unresponsive: the probe fails and must ALSO fall
  // back to "no state", or the UI would keep showing connected. `running` here
  // deliberately still reports the PROCESS as alive (spread over the failure),
  // which is what lets the panel still offer to release the session — the
  // connection flag the UI reads is `state`, and that one must be gone.
  const stuckSession = {
    running: true,
    ready: { deviceName: 'GCAN-PLC-521C' },
    lastError: '',
    child: { pid: 4322 },
    send: async () => { throw new Error('CODESYS 在线进程在 status 期间退出') },
  }
  engine.onlineSession = stuckSession
  const stuck = await engine.onlineStatus()
  assert.strictEqual(stuck.ok, false)
  assert.strictEqual(stuck.running, true, 'the process itself is still reported as running')
  assert(!('state' in stuck),
    'an unresponsive session must reconcile to not-connected instead of reporting the stale state')
  assert(String(stuck.error || '').length > 0, 'the failure must be reported, not swallowed')

  fs.rmSync(root, { recursive: true, force: true })
}

async function main () {
  stage('boot')
  await uiReconciliation()
  stage('ui')
  await sleep(0)
  await hostSessionLifecycle()
  stage('host-session')
  await tornReadyHandshake()
  stage('torn-ready')
  await statusPayloadContract()
  stage('status-payload')
}

main().then(
  () => {
    // 成功路径不强制 exit：句柄清干净后事件循环自己会空掉。`[自测]` 一行把分段
    // 耗时留在日志里，下一次抖动可以直接和这一行比。
    stopFakeWorkers()
    console.log(`codesys online reconnect behaviour test passed (${diagnostics()})`)
  },
  (error) => {
    // 失败路径**必须**自己了结：其余五条用假 worker 的契约都以显式 process.exit()
    // 收尾（session-concurrency / preopen-early / scriptengine-project-reuse /
    // scriptengine-speed / write-save-count）。裸 `process.exitCode = 1` 会被漏掉的
    // setInterval 挂住 —— 真实回归于是变成 runner 的 `[TIMEOUT]`（T229 变异实证）。
    stopFakeWorkers()
    console.error(error)
    console.error(`[诊断] ${diagnostics()} · 最后完成的分段 ${stages[stages.length - 1] || '(none)'}`)
    process.exit(1)
  },
)
