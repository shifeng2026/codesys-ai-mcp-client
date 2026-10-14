'use strict'
// Contract (T196 item A): the background "pre-open the project" must start at the EARLIEST
// moment the project path is known -- not at `bind-project`.
//
// Real-machine evidence this contract exists for (previous round, 1.1.0):
//   * write (confirm -> disk)      3,337 ms  OK   (openMs 19 ms: the project was already open)
//   * read, project already open   2,553 ms  OK
//   * read, FIRST time this project is opened by CODESYS   29,062 ms  FAIL
//       = persistent-worker cold start + `projects.open` 19.5-25 s + first tree walk 3.5 s
//   * bind itself was 33 ms (enumerateMs 18 / readProjectMs 5 / hashMs 2 / jobDirCopyMs 4)
// The pre-open was hung on `bind-project`, and the workbench runs
//   detect -> bind -> read   back to back (`detectCurrentProject` awaits `bindSourceProject`,
// which awaits `inspect`), so a read that follows the binding immediately still paid the whole
// 29 s. Moving the trigger earlier only helps if the SAME job the read will use is the one that
// was pre-opened -- which is what this contract pins:
//
//   1. the host fires the pre-open at the panel-open surface switch AND at the first moment a
//      project is really detected (`codesys:current-project`), never awaits it, and reports a
//      failure in one audit line instead of swallowing it;
//   2. the engine's `preopenProjectForRead` builds the bind job with the SAME code path as
//      `bind-project` (baseline snapshot + baseline sha + working copy), opens THAT working copy
//      in the persistent worker and walks the object tree once, storing it under the SOURCE sha;
//   3. `bind-project` then ADOPTS that job (no re-copy, no re-open, no second job directory),
//      and the first real read is served from the object-tree cache without touching the worker;
//   4. it is idempotent: a second pre-open for the same content does nothing (one worker spawn,
//      one open) -- and it can never double-open a project or start a second worker;
//   5. it does NOT weaken the write guard: if the source changed between the pre-open and the
//      binding, the pre-opened job is discarded and a fresh job is built whose recovery
//      snapshot is the CURRENT bytes.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')

const enginePath = path.join(__dirname, '..', 'plugins', 'installed', 'codesys-monitor', 'scriptengine.cjs')
const mainPath = path.join(__dirname, '..', 'app', 'main.js')
const engineModule = require(enginePath)
const { CodesysScriptEngine } = engineModule

const roots = []
function makeRoot () {
  const root = createTempDir('taskhive-preopen-')
  roots.push(root)
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function makeFixture (root, byte = 0x41, bytes = 256 * 1024) {
  const source = path.join(root, 'source.project')
  fs.writeFileSync(source, Buffer.alloc(bytes, byte))
  return source
}

function sha256Of (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function argValue (argv, prefix) {
  const found = (argv || []).find((item) => String(item).startsWith(prefix))
  return found ? String(found).slice(prefix.length).replace(/^"|"$/g, '') : ''
}

// ── persistent worker emulator ───────────────────────────────────────────────────────────
// It remembers which project it has open and charges `openCostMs` only when it really opens,
// exactly like the real worker's `acquire_project` (path + real file sha). `includeTree`
// records the object tree the engine asked for, and reports its own openMs/treeMs so the
// contract can prove the pre-open reports the cost it paid instead of hiding it.
function makeWorkerEmulator (state = {}) {
  state.spawns = []
  state.commands = []
  state.openCostMs = state.openCostMs === undefined ? 300 : state.openCostMs
  state.treeCostMs = state.treeCostMs === undefined ? 250 : state.treeCostMs
  let held = null
  const spawner = function spawnProcess (_exePath, argv) {
    const scriptPath = argValue(argv, '--runscript=')
    const workDir = path.dirname(scriptPath)
    const token = path.basename(scriptPath).replace(/^offline-worker-/, '').replace(/\.py$/, '')
    const record = { workDir, token, scriptPath, commands: 0 }
    state.spawns.push(record)
    const commandPath = path.join(workDir, `offline-command-${token}.json`)
    const readyPath = path.join(workDir, `offline-ready-${token}.json`)
    const child = new EventEmitter()
    child.pid = 7100 + state.spawns.length
    child.exitCode = null
    child.killed = false
    child.kill = () => { child.killed = true; child.exitCode = 1; child.emit('exit', 1, null) }
    let seen = 0
    const timer = setInterval(() => {
      if (child.exitCode !== null) { clearInterval(timer); return }
      let command = null
      try { command = JSON.parse(fs.readFileSync(commandPath, 'utf8')) } catch { return }
      if (!command || Number(command.seq) <= seen) return
      seen = Number(command.seq)
      record.commands += 1
      const seq = Number(command.seq)
      const request = command.request || {}
      const action = String(request.action || '')
      const projectPath = String(request.projectPath || '')
      try { fs.writeFileSync(path.join(workDir, `offline-ack-${token}-${seq}.json`), JSON.stringify({ seq }), 'utf8') } catch { /* dir cleaned */ }
      state.commands.push({ action, seq, projectPath, includeTree: request.includeTree === true, heldPath: held ? held.path : '' })
      const payload = {
        ok: true,
        action,
        safetyMode: 'isolated-offline-project-only',
        projectPath,
        workerSeq: seq,
        phaseMs: { openMs: 0, applyMs: 0, saveMs: 0, buildMs: 0, treeMs: 0 },
      }
      if (action === 'release-project') {
        held = null
        payload.released = true
        payload.stillOpen = false
      } else if (projectPath) {
        const currentSha = fs.existsSync(projectPath) ? sha256Of(projectPath) : ''
        if (held && held.path === projectPath && held.sha === currentSha && currentSha) {
          payload.openReused = 1
        } else {
          held = { path: projectPath, sha: currentSha }
          payload.openReused = 0
          payload.phaseMs.openMs = state.openCostMs
        }
        payload.heldProjectPath = projectPath
        if (action === 'preload-project' && request.includeTree === true) {
          // The tree is a pure function of the saved bytes: one walk, cached by the worker.
          payload.complete = true
          payload.textTruncated = false
          payload.objectCount = 1
          payload.objects = [{ name: 'PLC_PRG', guid: 'g-pou', path: ['PLC_PRG'], depth: 0 }]
          payload.treeReused = 0
          payload.phaseMs.treeMs = state.treeCostMs
        }
        if (action === 'inspect-project') {
          payload.complete = true
          payload.textTruncated = false
          payload.objectCount = 1
          payload.objects = [{ name: 'PLC_PRG', guid: 'g-pou', path: ['PLC_PRG'], depth: 0 }]
          payload.treeReused = 0
          payload.phaseMs.treeMs = state.treeCostMs
        }
      }
      try {
        fs.mkdirSync(path.dirname(command.resultPath), { recursive: true })
        fs.writeFileSync(command.resultPath, JSON.stringify(payload), 'utf8')
      } catch { /* dir cleaned */ }
    }, 4)
    child.on('exit', () => clearInterval(timer))
    setTimeout(() => { try { fs.writeFileSync(readyPath, JSON.stringify({ ok: true, pid: child.pid }), 'utf8') } catch { /* dir cleaned */ } }, 4)
    return child
  }
  spawner.state = state
  return spawner
}

// ── a worker that dies before it is ready, exactly like the real machine did ─────────────
// Real-machine evidence this emulator exists for (previous round, dev tree, low integrity):
// the persistent worker never reported ready, and the ONLY place that said why was its own
// stderr file:
//   CODESYS.APInstaller: Cannot open log for source 'AP Installer' (Win32 5)
// while `worker.lastError` — and therefore every message built from it — was just
// "CODESYS 离线常驻进程已退出（code=1）". The engine must carry the stderr body out with the
// failure (audit row, returned value and thrown message), otherwise "preopened:false" is all
// anyone ever sees.
const REAL_MACHINE_STDERR = "CODESYS.APInstaller: Cannot open log for source 'AP Installer' (Win32 5)\r\n"
  + 'Traceback (most recent call last):\r\n  File "offline-worker.py", line 12, in <module>\r\n'
function makeDyingWorkerEmulator (state = {}) {
  state.spawns = []
  const spawner = function spawnProcess (_exePath, argv) {
    const scriptPath = argValue(argv, '--runscript=')
    const workDir = path.dirname(scriptPath)
    const token = path.basename(scriptPath).replace(/^offline-worker-/, '').replace(/\.py$/, '')
    state.spawns.push({ workDir, token, scriptPath })
    // The worker's stderr file (the engine opened it just before spawning) is the only place
    // the real reason lives. Append, never truncate: the engine still holds a handle on it.
    try { fs.appendFileSync(path.join(workDir, 'offline-worker.stderr.log'), REAL_MACHINE_STDERR, 'utf8') } catch { /* dir cleaned */ }
    const child = new EventEmitter()
    child.pid = 7900 + state.spawns.length
    // It starts alive and dies one tick later — exactly like the real worker, which got far
    // enough to write its stderr before CODESYS' log initialisation killed it. That ordering
    // matters: it is what makes the engine's own exit handler run, so the message under test
    // is the real "已退出（code=1）" + stderr body, not a bare fallback string.
    child.exitCode = null
    child.killed = false
    child.kill = () => { child.killed = true; child.exitCode = 1; try { child.emit('exit', 1, null) } catch { /* already emitted */ } }
    setImmediate(() => { child.exitCode = 1; try { child.emit('exit', 1, null) } catch { /* listener may be gone */ } })
    return child
  }
  spawner.state = state
  return spawner
}

function makeEngine (root, options) {
  const engine = new CodesysScriptEngine(root, options)
  engine.doctor = () => ({ ready: true, exePath: 'C:\\fake\\CODESYS.exe', profile: 'CODESYS V3.5 SP20 Patch 4' })
  return engine
}

function jobDirOf (root, jobId) {
  return path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', jobId)
}

function auditLines (root) {
  try {
    return fs.readFileSync(path.join(root, 'logs', 'codesys-timings.jsonl'), 'utf8').trim().split('\n')
      .filter(Boolean).map((line) => JSON.parse(line))
  } catch { return [] }
}

function waitFor (predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve(true)
      if (Date.now() > deadline) return reject(new Error('timed out waiting for condition'))
      setTimeout(tick, 15)
    }
    tick()
  })
}

// ── 1. host wiring: the trigger moved earlier, and it is still background/audited ─────────
function verifyHostWiring (report) {
  const main = fs.readFileSync(mainPath, 'utf8')
  const nextFunctionAt = (from) => {
    const candidates = ['\nasync function ', '\nfunction '].map((needle) => main.indexOf(needle, from)).filter((at) => at > 0)
    return candidates.length ? Math.min(...candidates) : main.length
  }
  const showStart = main.indexOf('async function showPluginSurface(kind) {')
  assert(showStart > 0, 'showPluginSurface must still exist')
  const show = main.slice(showStart, nextFunctionAt(showStart + 10))

  // The T183 preheat trigger must survive verbatim (it is a different, cheaper warm-up).
  assert(show.includes("if (kind === 'codesys') preheatCodesysOfflineWorker('codesys-surface-open');"),
    'the existing worker preheat on panel open must not be removed')
  // Trigger (1): panel brought to the front -- the earliest moment on the whole chain.
  assert(show.includes("if (kind === 'codesys') preopenRememberedCodesysProject('codesys-surface-open');"),
    'opening the CODESYS panel must fire the project pre-open')
  assert(!show.includes('await preopenRememberedCodesysProject'), 'the surface switch must never await the pre-open')

  // Trigger (2): the first moment a project path is really known.
  const detectAt = main.indexOf("handleTrusted('codesys:current-project'")
  assert(detectAt > 0, 'the detection channel must still exist')
  const detect = main.slice(detectAt, main.indexOf("handleTrusted('codesys:open-program'", detectAt))
  assert(detect.includes("rememberCodesysProjectPath(detected.sourcePath)"),
    'a detected project must be remembered for the next panel open')
  assert(detect.includes("preopenCodesysProjectOnce('current-project-detected', detected.sourcePath)"),
    'detection must fire the pre-open: it is the earliest moment the path is known')
  assert(!/await preopenCodesysProjectOnce/.test(detect), 'detection must not wait for the pre-open')

  // Binding is the authoritative answer for "the user's current project" -- remember it too.
  const actionAt = main.indexOf("handleTrusted('codesys:scriptengine-action'")
  const action = main.slice(actionAt, main.indexOf('handleTrusted(', actionAt + 10))
  assert(action.includes("action !== 'bind-project'"), 'the bind channel must be singled out for remembering')
  assert(action.includes('rememberCodesysProjectPath(result.sourcePath)'),
    'a successful binding must remember the project path for the next panel open')

  // Idempotency + failure visibility + the "never block" discipline live in the helper.
  const helperAt = main.indexOf('function codesysLastProjectFile() {')
  assert(helperAt > 0, 'the host must own the remembered-path state')
  assert(main.includes('function preopenCodesysProject(reason, projectPath) {'), 'the host must own one pre-open helper')
  const helperEnd = main.indexOf('function preheatCodesysOfflineWorker(reason) {', helperAt)
  assert(helperEnd > helperAt, 'the pre-open helper block must sit before the preheat helper')
  const helper = main.slice(helperAt, helperEnd)
  assert(helper.includes('setImmediate('), 'the pre-open must defer itself off the synchronous path')
  assert(helper.includes('codesysScriptEngine.preopenProjectForRead('),
    'the pre-open must go through the engine entry point (no IPC channel, no extra process)')
  assert(helper.includes('codesysPreopenByPath'), 'a second request for the same path must join the in-flight one')
  assert(helper.includes("harness.append('codesys.scriptengine.preopen'"), 'a pre-open must leave one audit line')
  assert(helper.includes("harness.append('codesys.scriptengine.preopen.failed'"),
    'a failed pre-open must leave one audit line saying so instead of being swallowed')
  assert(/catch \(error\)[\s\S]{0,400}?resolve\(null\)/.test(helper), 'a failed pre-open must resolve instead of rejecting into nobody')
  // A remembered path is only a hint; a missing/stale one must do nothing at all.
  assert(helper.includes("path.extname(value).toLowerCase() === '.project' && fs.existsSync(value)"),
    'a remembered path must be re-validated before it is used')
  assert(helper.includes('rememberCodesysProjectPath'), 'the path must be remembered for the next panel open')
  // Trigger (3), T198: the application itself ignites the pre-open at start-up, from the
  // remembered last project, behind an explicit off switch. This is the only trigger that
  // can move the ~38 s CODESYS `projects.open` to BEFORE the user's first action -- and it
  // is therefore also the only one that costs ~38 s on every start, used or not.
  const startHelperAt = main.indexOf('function preopenRememberedCodesysProjectOnStart(')
  assert(startHelperAt > 0, 'the host must own one start-up ignition helper')
  assert(startHelperAt > helperAt && startHelperAt < helperEnd,
    'the start-up ignition must live in the same audited helper block as the other two triggers')
  assert(main.includes("preopenRememberedCodesysProjectOnStart('application-start')"),
    'application start-up must ignite the pre-open for the remembered project')
  assert(!/await preopenRememberedCodesysProjectOnStart/.test(main),
    'the startup path must never await the pre-open (the whole point is that it is off the critical path)')
  assert(helper.includes('CODESYS_PREOPEN_ON_START_ENV'),
    'the start-up ignition must have an explicit off switch')
  assert(helper.includes("TASKHIVE_CODESYS_PREOPEN_ON_START"),
    'the off switch must be the documented environment variable')
  assert(helper.includes("['0', 'false', 'off', 'no']"),
    'the switch must accept the documented off values')
  // T199 item 2: the switch is no longer env-only. The settings page owns it, the environment
  // variable stays usable but only when it is EXPLICITLY set, and the default is still ON
  // ("default = the behaviour before the change" was the operator's decision).
  assert(helper.includes('codesysPreopenOnStartSetting'),
    'the start-up switch must consult the persisted UI setting')
  assert(/preopenOnStart !== false/.test(helper),
    'the UI setting must default to ON when the user never stored a value')
  assert(/if \(raw\) return !\['0', 'false', 'off', 'no'\]\.includes\(raw\)/.test(helper),
    'an explicitly set environment variable must take precedence over the UI setting')
  assert(/return codesysPreopenOnStartSetting\(\)/.test(helper),
    'with no environment variable the decision must fall through to the UI setting')
  assert(/codesysPreopenOnStartEnvRaw/.test(helper),
    'the host must be able to tell "env explicitly set" from "env unset" (otherwise the precedence cannot be honoured)')
  assert(helper.includes('codesys-preferences.json'),
    'the UI setting must be persisted through the existing config path')
  assert(helper.includes("app.getPath('userData')"),
    'the preference must live in the per-install userData area (three-tree parity excludes it); a profiles/*.json file would make the three trees differ byte for byte as soon as one machine toggles the switch')
  assert(/readJson\(codesysPreferencesPath\(\)/.test(helper) && /writeJson\(codesysPreferencesPath\(\)/.test(helper),
    'the preference must be read/written with the existing atomic-json helpers (no second config mechanism)')
  assert(!/window\.localStorage|localStorage\./.test(main),
    'the switch must not be persisted in the renderer (localStorage is not a config store)')
  assert(helper.includes("skipped: 'disabled-by-setting'"),
    'turning it off in the settings page must be visible in the audit stream as its own reason (distinct from the env override)')
  // T199 item 2: ONE gate, consulted by all three triggers. It did not exist for trigger (1)
  // before, so a "open the CODESYS panel" probe really ignited a pre-open (and left job
  // directories in workspaces/codesys-scriptengine/jobs).
  assert(helper.includes('function preopenSmokeGateApplies(mode, reason) {'),
    'the host must own exactly one smoke/probe gate for the pre-open')
  assert(/if \(!smokeLaunch\(\)\) return false;/.test(helper),
    'the gate must be the same smokeLaunch() predicate the start-up trigger has always used')
  assert(/mode, skipped: 'smoke-or-probe-run'/.test(helper),
    'the gate must leave one audit line naming the trigger that was stopped')
  assert(helper.includes("preopenSmokeGateApplies('codesys-surface-open', reason)"),
    'trigger (1) must consult the shared gate')
  assert(helper.includes("preopenSmokeGateApplies('application-start', reason)"),
    'the start-up trigger must consult the shared gate')
  assert(detect.includes("preopenSmokeGateApplies('current-project-detected', 'current-project-detected')"),
    'project detection must consult the shared gate')
  for (const mode of ['codesys-surface-open', 'application-start', 'current-project-detected']) {
    assert(main.includes(`'${mode}'`), `the ${mode} trigger must still pass its own mode to the gate`)
  }
  assert(helper.includes('lastRememberedCodesysProjectPath()'),
    'the start-up ignition must use the remembered (re-validated) project only')
  assert(helper.includes("skipped: 'no-remembered-project'"),
    'with no remembered project it must do nothing at all -- and say so')
  assert(helper.includes("skipped: 'disabled-by-env'"),
    'switching it off must be visible in the audit stream')
  assert(helper.includes("skipped: 'smoke-or-probe-run'"),
    'smoke/probe runs must not ignite a CODESYS process behind the measurement')
  assert(helper.includes("harness.append('codesys.scriptengine.preopen.skipped'"),
    'every "did not ignite" outcome must leave exactly one audit line (success/failed/skipped)')
  const startBody = main.slice(startHelperAt, helperEnd)
  const switchCheckAt = startBody.indexOf('if (!codesysPreopenOnStartEnabled())')
  const readRememberedAt = startBody.indexOf('const remembered = lastRememberedCodesysProjectPath();')
  const igniteAt = startBody.indexOf('preopenCodesysProjectOnce(reason, remembered);')
  assert(switchCheckAt > 0, 'the off switch must actually be consulted')
  assert(readRememberedAt > 0, 'the start-up ignition must read the remembered project through the re-validating helper')
  assert(igniteAt > 0, 'the start-up ignition must go through the idempotent in-flight de-duplicator')
  assert(switchCheckAt < readRememberedAt && switchCheckAt < igniteAt,
    'the off switch must be checked before the remembered project is read or anything is started')
  assert(!/process\.on\(|app\.on\(/.test(helper), 'the pre-open must not hook process/app lifecycle events')

  // No new IPC channel may be invented for this (the panel gate list is contract-pinned).
  for (const invented of ['codesys:preopen', 'codesys:scriptengine-preopen', 'codesys:preopen-project']) {
    assert(!main.includes(invented), `no new IPC channel may be invented for the pre-open (${invented})`)
  }

  // T199 item 2: moving the switch into the UI needs exactly TWO new channels (one read, one
  // write) and nothing else. Both are shell-renderer-only, so both must sit on the same
  // document-identity gate as every other "only the shell may call this" channel.
  assert(main.includes("handleTrusted('settings:codesys-preopen',"),
    'the settings page must be able to READ the switch through a trusted channel')
  assert(main.includes("handleTrusted('settings:codesys-preopen-save',"),
    'the settings page must be able to WRITE the switch through a trusted channel')
  const panelOnly = /CODESYS_PANEL_ONLY_CHANNELS = new Set\(\[([\s\S]*?)\]\)/.exec(main)
  assert(panelOnly, 'main.js must keep its CODESYS_PANEL_ONLY_CHANNELS list')
  assert(panelOnly[1].includes("'settings:codesys-preopen'") && panelOnly[1].includes("'settings:codesys-preopen-save'"),
    'both new channels must be on the shell-document identity gate (the settings page renders in the shell app/renderer document, the DSH document must not be able to flip the user\'s background-cost switch)')
  const preload = fs.readFileSync(path.join(__dirname, '..', 'app', 'preload.js'), 'utf8')
  assert(preload.includes("ipcRenderer.invoke('settings:codesys-preopen'") && preload.includes("ipcRenderer.invoke('settings:codesys-preopen-save'"),
    'the preload bridge must expose both new channels (a channel with no caller is dead code)')

  // The UI half: the switch and its one-line cost note must exist in the REAL settings page,
  // and the page must mirror the main process instead of keeping a second copy of the truth.
  const shellRenderer = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'renderer.js'), 'utf8')
  assert(shellRenderer.includes('data-settings-tab="startup"') && shellRenderer.includes('data-settings-panel="startup"'),
    'the settings page must have a startup tab (otherwise the switch has nowhere to live)')
  assert(shellRenderer.includes('id="codesys-preopen-on-start"'),
    'the startup tab must carry the "pre-open on start" switch')
  assert(shellRenderer.includes('id="codesys-preopen-cost"'),
    'the startup tab must carry the one-line cost note the operator asked for')
  assert(shellRenderer.includes('codesysPreopenPreference') && shellRenderer.includes('saveCodesysPreopenPreference'),
    'the settings page must read and persist the switch through the main process')

  // The probe that proves all of it on a real run, and the gate that keeps the probe itself
  // from igniting anything.
  assert(main.includes("'--probe-codesys-preopen-setting'") && main.includes("'--probe-codesys-preopen-setting-on'"),
    'both probe variants must be recognised by the host')
  assert(/const smokeLaunch = \(\) => process\.argv\.some\(\(arg\) => \[[^\]]*'--probe-codesys-preopen-setting'[^\]]*\]\.includes\(arg\)\)/.test(main),
    'the probe flags must be inside the smokeLaunch() list, so the probe run is itself a run that must not ignite')
  assert(main.includes('runCodesysPreopenSettingProbe('),
    'the host must own the self-test that drives the real settings page')
  report.wiring = {
    triggers: 3,
    awaits: 0,
    helperLines: helper.split('\n').length,
    newChannels: 2,
  }
}

// ── 2. the engine + worker half, executed (not grepped) ───────────────────────────────────
async function preOpenedFirstReadIsCheap () {
  const root = makeRoot()
  const source = makeFixture(root)
  const state = {}
  const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: makeWorkerEmulator(state) })

  const preopenStartedAt = Date.now()
  const pre = await engine.preopenProjectForRead(source, 'contract')
  const preopenMs = Date.now() - preopenStartedAt
  assert.strictEqual(pre.preopened, true, 'the pre-open must really open the project')
  assert.strictEqual(state.spawns.length, 1, 'the pre-open must start exactly one worker')
  const preload = state.commands.filter((item) => item.action === 'preload-project')
  assert.strictEqual(preload.length, 1, 'the pre-open must issue exactly one preload-project command')
  assert.strictEqual(preload[0].includeTree, true, 'the pre-open must ask for the object tree in the same command')
  const workingCopy = path.join(jobDirOf(root, pre.jobId), 'snapshots', 'working.project')
  assert.strictEqual(preload[0].projectPath, workingCopy,
    'the pre-open must open the SAME working copy the first read will use (otherwise it buys nothing)')

  // The tree the pre-open walked is stored under the SOURCE sha, so it is path-independent.
  const sourceSha = sha256Of(source)
  const cacheFile = path.join(root, 'cache', 'codesys-inspect', `${sourceSha}.json`)
  assert(fs.existsSync(cacheFile), 'the pre-open tree must be cached under the source project sha')
  assert.strictEqual(pre.inspectCacheWritten, true, 'the pre-open must report that it wrote the object-tree cache')
  const preopenRow = auditLines(root).find((line) => line.action === 'preopen-project')
  assert(preopenRow, 'the pre-open must leave its own structured timing row')
  assert.strictEqual(Number(preopenRow.openMs), state.openCostMs, `the pre-open must report the open it paid (got ${preopenRow.openMs})`)
  assert.strictEqual(Number(preopenRow.treeMs), state.treeCostMs, `the pre-open must report the walk it paid (got ${preopenRow.treeMs})`)
  // T200: the error field exists on every row of this action, but a SUCCESSFUL pre-open must
  // add no text to it — otherwise "there is something in .error" stops meaning "it failed".
  assert.strictEqual(preopenRow.error, '', 'a successful pre-open must carry no error text')
  assert.strictEqual(preopenRow.skipped, '', 'a successful pre-open must carry no skip reason')
  assert.strictEqual(pre.error, '', 'a successful pre-open must hand back an empty error, not a stale one')
  const successPreloadRow = auditLines(root).find((line) => line.action === 'preload-project')
  assert(successPreloadRow, 'the pre-open must leave a preload-project row')
  assert.strictEqual(successPreloadRow.error, '', 'a successful pre-warm must put no text in the error field')

  // Binding adopts that job: no new job directory, no re-copy of the working copy.
  const workingCopyStatBefore = fs.statSync(workingCopy)
  const bindStartedAt = Date.now()
  const bound = engine.bindProject({ sourcePath: source })
  const bindMs = Date.now() - bindStartedAt
  assert.strictEqual(bound.adoptedPreopen, true, 'binding must adopt the job the pre-open already built')
  assert.strictEqual(bound.jobId, pre.jobId, 'adoption must keep the pre-opened job id')
  assert.strictEqual(fs.readdirSync(path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs')).length, 1,
    'adoption must not create a second job directory')
  assert.strictEqual(fs.statSync(workingCopy).mtimeMs, workingCopyStatBefore.mtimeMs,
    'adoption must not rewrite the working copy (0 bytes copied)')
  assert.strictEqual(bound.baselineSha256, sourceSha, 'the adopted baseline sha must still be the current source sha')

  // The first real read is served from the object-tree cache and never reaches the worker.
  const readStartedAt = Date.now()
  const first = await engine.execute('inspect-project', { jobId: bound.jobId })
  const readMs = Date.now() - readStartedAt
  assert.strictEqual(first.artifacts?.cached, true, 'the first read after binding must hit the object-tree cache')
  assert.strictEqual(first.artifacts?.cacheSource, 'disk', 'the hit must be the persisted (source-sha keyed) cache')
  assert.strictEqual(first.timings.cachedRead, true, 'a cached read must say so in the timing record')
  assert.strictEqual(first.timings.openMs, 0, 'a cached read must not report an open of its own')
  assert.strictEqual(first.timings.saveCalls, 0, 'a cached read must not report any save (no double counting)')
  assert.strictEqual(state.commands.filter((item) => item.action === 'inspect-project').length, 0,
    'the first read after binding must not need any worker command (that is the whole point)')
  assert.strictEqual(state.spawns.length, 1, 'the whole flow must use exactly one CODESYS worker')

  // Idempotency: the same content is pre-opened once, never twice.
  const again = await engine.preopenProjectForRead(source, 'contract-again')
  assert.strictEqual(again.preopened, false, 'a second pre-open for the same content must do nothing')
  assert.strictEqual(again.reason, 'inspect-cache-warm', 'and it must say why it did nothing')
  assert.strictEqual(state.commands.filter((item) => item.action === 'preload-project').length, 1,
    'a second pre-open must not open the project again')
  assert.strictEqual(state.spawns.length, 1, 'a second pre-open must not start a second worker')

  await engine.stopOfflineWorker('contract-finished')
  return { preopenMs, bindMs, readMs, openCostMs: state.openCostMs, treeCostMs: state.treeCostMs, spawns: state.spawns.length, commands: state.commands.length }
}

// ── 3. the guard: a source that changed after the pre-open must NOT be adopted ────────────
async function changedSourceIsNotAdopted () {
  const root = makeRoot()
  const source = makeFixture(root, 0x41)
  const state = {}
  const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: makeWorkerEmulator(state) })
  const pre = await engine.preopenProjectForRead(source, 'contract')
  assert.strictEqual(pre.preopened, true, 'the pre-open must have happened before the source changes')
  const preopenedBaselineSha = pre.sourceSha256

  // Someone saves the project externally (CODESYS GUI or another editor) in between.
  fs.writeFileSync(source, Buffer.alloc(256 * 1024, 0x42))
  const changedSha = sha256Of(source)

  const bound = engine.bindProject({ sourcePath: source })
  assert.notStrictEqual(bound.jobId, pre.jobId, 'a changed source must not adopt the pre-opened job')
  assert(!bound.adoptedPreopen, 'a changed source must produce a fresh binding')
  assert.strictEqual(bound.baselineSha256, changedSha, 'the fresh baseline must be the CURRENT bytes')
  assert.notStrictEqual(bound.baselineSha256, preopenedBaselineSha, 'the stale baseline must never be reused')
  const baselinePath = path.join(jobDirOf(root, bound.jobId), 'snapshots', '000-baseline.project')
  assert.strictEqual(sha256Of(baselinePath), changedSha,
    'the recovery snapshot must be a byte-exact copy of the pre-write content')
  const workingPath = path.join(jobDirOf(root, bound.jobId), 'snapshots', 'working.project')
  assert.strictEqual(sha256Of(workingPath), changedSha, 'the working copy must match the pre-write content too')
  const discarded = auditLines(root).find((line) => line.action === 'preopen-project.discarded')
  assert(discarded, 'the discarded pre-open must be visible in the audit stream')
  assert.strictEqual(discarded.reason, 'source-changed', 'the discard must say why')
  await engine.stopOfflineWorker('contract-finished')
  return { discardedReason: discarded.reason, baselineMatchesCurrent: true }
}

// ── 4. a failed pre-open must carry its error BODY, not only a reason ────────────────────
// The honesty gap this pins: the audit row for a failed pre-open used to be
//   {"action":"preopen-project","preopened":0,"skipped":"preopen:preopen"}
// and nothing else — while the actual reason (the worker died on CODESYS' own log
// initialisation) existed ONLY inside the worker's stderr file. The operator therefore saw
// "preopened:false" and had no way to answer "why".
async function failedPreopenKeepsItsErrorBody () {
  const root = makeRoot()
  const source = makeFixture(root)
  const state = {}
  const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: makeDyingWorkerEmulator(state) })

  // (a) the engine's OWN contract: the thrown worker-start failure carries the stderr body,
  //     keeps its machine code, and that body is collapsed to one BOUNDED line.
  const startError = await engine.ensureOfflineWorker(null).then(() => null, (error) => error)
  assert(startError, 'a worker that dies before ready must surface an error')
  assert.strictEqual(startError.code, 'CODESYS_OFFLINE_WORKER_EXITED', 'the failure must keep its machine code')
  assert(startError.message.includes('AP Installer'),
    `the thrown message must carry the worker stderr body (got: ${startError.message})`)
  assert(startError.stderrTail.includes('AP Installer'),
    'the body must also travel as its own field, so a caller never has to parse the message')
  assert(!/[\r\n]/.test(startError.message), 'the failure message must be ONE line (a JSONL record may not read as several)')
  assert(startError.stderrTail.length <= 400, `the body must be truncated to a sane length (got ${startError.stderrTail.length})`)

  // (b) the audit stream: a failed pre-open says WHAT failed (readable reason) and WHY (body).
  const pre = await engine.preopenProjectForRead(source, 'contract-dying')
  assert.strictEqual(pre.preopened, false, 'the pre-open must report that it did not happen')
  assert.strictEqual(pre.skipped, 'preload-failed', `the outcome reason must be readable, not the trigger name (got ${pre.skipped})`)
  assert(pre.error.includes('AP Installer'), `the returned value must carry the body (got: ${pre.error})`)

  const rows = auditLines(root)
  const preopenRow = rows.find((line) => line.action === 'preopen-project')
  assert(preopenRow, 'a failed pre-open must still leave its own row')
  assert.strictEqual(Number(preopenRow.preopened), 0, 'the row must not claim a pre-open happened')
  assert(preopenRow.error && preopenRow.error.includes('AP Installer'),
    `the preopen-project audit row must carry the error body (got: ${JSON.stringify(preopenRow.error)})`)
  assert(!/[\r\n]/.test(preopenRow.error), 'the audited body must be one line')
  assert(preopenRow.error.length <= 400, `the audited body must be bounded (got ${preopenRow.error.length})`)
  assert.strictEqual((preopenRow.error.match(/stderr 末尾/g) || []).length, 1,
    'the worker stderr body must appear exactly once (message and tail must not duplicate it)')
  assert.strictEqual((preopenRow.error.match(/AP Installer/g) || []).length, 1,
    'the real reason must appear exactly once and survive the truncation budget')
  assert.strictEqual(preopenRow.skipped, 'preload-failed', 'the row must still name the failure in one readable word')
  for (const key of ['totalMs', 'openMs', 'treeMs', 'saveCalls', 'saveMs']) {
    assert(Object.prototype.hasOwnProperty.call(preopenRow, key),
      `the failure row must keep the fixed timing field set (missing ${key})`)
  }

  const preloadRow = rows.find((line) => line.action === 'preload-project')
  assert(preloadRow, 'a pre-warm that could not even start the worker must leave its own row')
  assert(preloadRow.error && preloadRow.error.includes('AP Installer'),
    'the preload-project row must carry the same body (a failure must not be swallowed one level down)')

  await engine.stopOfflineWorker('contract-finished')
  return {
    code: startError.code,
    preopenSkipped: preopenRow.skipped,
    bodyLength: preopenRow.error.length,
    body: preopenRow.error.slice(0, 200),
    spawns: state.spawns.length,
  }
}

async function main () {
  const report = {}
  verifyHostWiring(report)
  const cheap = await preOpenedFirstReadIsCheap()
  const guard = await changedSourceIsNotAdopted()
  const failed = await failedPreopenKeepsItsErrorBody()
  console.log('[自测] A 项（预打开提前）：宿主点火 3 处（应用启动 / 面板打开 / 检测到工程）· 0 次 await · 0 个新通道；'
    + `引擎：预打开(openMs=${cheap.openCostMs} treeMs=${cheap.treeCostMs}) ${cheap.preopenMs}ms → 绑定接管 ${cheap.bindMs}ms → 第一次真读 ${cheap.readMs}ms `
    + `（缓存命中、0 条 worker 命令）· worker ${cheap.spawns} 个 / 命令 ${cheap.commands} 条 · 重复预打开=no-op；`
    + `源变了不接管：discarded=${guard.discardedReason}，基线=当前字节 ✓；`
    + `失败留正文：${failed.code} · skipped=${failed.preopenSkipped} · 正文 ${failed.bodyLength} 字符（单行）「${failed.body}」✓`
    + `（成功路径 error 为空串 ✓）`)
}

main().then(() => {
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
  console.log('codesys pre-open early contract passed')
  process.exit(0)
}).catch((error) => {
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
  console.error(`codesys pre-open early contract failed: ${error.message}`)
  process.exit(1)
})
