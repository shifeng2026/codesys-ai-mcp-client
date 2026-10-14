'use strict'
// Contract (T183 item 2, HOST half): the timing sink must really be wired to the
// audit stream, and the persistent ScriptEngine worker must be pre-warmed when
// the user first opens the CODESYS panel — so the FIRST read does not pay the
// ~30 s CODESYS launch.
//
// Two kinds of evidence, because the two halves live in different processes:
//
//   A. the SINK is measured end to end against the REAL engine: a real action is
//      executed with an injected `timingSink`, and the record handed to the sink
//      is compared field-for-field with the line the engine appended to
//      `logs/codesys-timings.jsonl`. "One record per line, fields verbatim" is
//      therefore proven, not asserted about a source string.
//
//   B. the main-process WIRING cannot be executed here (it needs Electron), so it
//      is pinned by source facts plus the ENGINE properties it relies on:
//        * `new CodesysScriptEngine(root, { timingSink: (record) => harness.append(...) })`
//          is the only construction site, and the record is passed through
//          untouched (no JSON.stringify / no field picking in the host);
//        * the preheat is triggered from `showPluginSurface('codesys')` — the one
//          place the CODESYS panel really comes to the front — BEFORE the
//          "same surface already shown" early return, is not awaited, and defers
//          itself to `setImmediate` so no surface switch ever blocks on it;
//        * it is idempotent (`ensureOfflineWorker` waits on the same start
//          promise: the existing speed contract measures "pre-warm + first read
//          spawn exactly ONE CODESYS worker"), and a preheat that fails must not
//          break the read that follows — which is measured here by making the
//          worker spawn throw and then executing a real `inspect-project`.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const appRoot = path.resolve(__dirname, '..')
const mainSource = fs.readFileSync(path.join(appRoot, 'app', 'main.js'), 'utf8')
const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const roots = []
function makeRoot () {
  const root = createTempDir('taskhive-timing-sink-')
  roots.push(root)
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function makeFixture (root) {
  const source = path.join(root, 'source.project')
  fs.writeFileSync(source, 'x'.repeat(64 * 1024), 'utf8')
  return source
}

function argValue (argv, prefix) {
  const found = (argv || []).find((item) => String(item).startsWith(prefix))
  return found ? String(found).slice(prefix.length).replace(/^"|"$/g, '') : ''
}

// One CODESYS process per action (the cold seam): no installation is needed and
// every action really runs through the engine's own bookkeeping.
function makeColdRunner (state = {}) {
  return async function runProcess (_exePath, args) {
    state.coldRuns = (state.coldRuns || 0) + 1
    const script = fs.readFileSync(argValue(args, '--runscript='), 'utf8')
    const requestPath = JSON.parse(script.match(/request_path = ("(?:[^"\\]|\\.)*")/)[1])
    const resultPath = JSON.parse(script.match(/result_path = ("(?:[^"\\]|\\.)*")/)[1])
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
    const payload = {
      ok: true,
      action: request.action,
      safetyMode: 'isolated-offline-project-only',
      projectPath: request.projectPath,
      complete: true,
      textTruncated: false,
      objects: [],
      phaseMs: { openMs: 3, applyMs: 4, saveMs: 2, buildMs: request.build === false ? 0 : 300, treeMs: 2, totalMs: 15 },
      serviceMs: 20,
    }
    if (request.action === 'apply-and-build') {
      payload.changeCount = (request.changes || []).length
      payload.applyCommitted = true
      payload.messages = []
      payload.errorCount = 0
      payload.warningCount = 0
    }
    fs.mkdirSync(path.dirname(resultPath), { recursive: true })
    fs.writeFileSync(resultPath, JSON.stringify(payload), 'utf8')
    return { stdout: Buffer.from(''), stderr: Buffer.from('') }
  }
}

const CHANGES = [{ operation: 'update-text', objectName: 'PLC_PRG', declaration: 'PROGRAM PLC_PRG', implementation: 'x := 2;' }]

// An in-process emulator of the persistent worker's FILE PROTOCOL (ready /
// command / ack / result), with a configurable start delay. It exists so the
// "preheat then first read" claim can be MEASURED: `startDelayMs` stands in for
// the ~30 s CODESYS launch, and the read that follows must not pay it again.
function makeWorkerHarness (options = {}) {
  const state = { spawns: 0, startDelayMs: options.startDelayMs || 1200, commands: 0, children: [] }
  state.spawn = function spawnProcess (_exePath, argv) {
    state.spawns += 1
    const scriptPath = argValue(argv, '--runscript=')
    const workDir = path.dirname(scriptPath)
    const token = path.basename(scriptPath).replace(/^offline-worker-/, '').replace(/\.py$/, '')
    const commandPath = path.join(workDir, `offline-command-${token}.json`)
    const readyPath = path.join(workDir, `offline-ready-${token}.json`)
    const stopPath = path.join(workDir, `offline-stop-${token}`)
    const child = new EventEmitter()
    child.pid = 4242
    child.exitCode = null
    child.killed = false
    child.kill = () => { if (child.exitCode === null) { child.exitCode = 0; child.killed = true; child.emit('exit', 0, null) } return true }
    setTimeout(() => {
      if (child.exitCode !== null) return
      fs.writeFileSync(readyPath, JSON.stringify({ ok: true, engine: 'preheat-emulator', pid: 4242, startedAt: Date.now() / 1000 }), 'utf8')
    }, state.startDelayMs)
    let seenSeq = 0
    const timer = setInterval(() => {
      if (child.exitCode !== null || fs.existsSync(stopPath)) { clearInterval(timer); child.kill(); return }
      let payload = null
      try { payload = JSON.parse(fs.readFileSync(commandPath, 'utf8')) } catch { return }
      const seq = Number(payload?.seq || 0)
      if (!seq || seq <= seenSeq) return
      seenSeq = seq
      state.commands += 1
      try { fs.writeFileSync(path.join(workDir, `offline-ack-${token}-${seq}.json`), JSON.stringify({ seq, acceptedAt: Date.now() / 1000 }), 'utf8') } catch { /* best effort */ }
      const request = payload.request || {}
      const result = {
        ok: true,
        action: request.action,
        safetyMode: 'isolated-offline-project-only',
        projectPath: request.projectPath,
        complete: true,
        textTruncated: false,
        objects: [],
        phaseMs: { openMs: 1, applyMs: 1, saveMs: 1, buildMs: 0, treeMs: 1, totalMs: 4 },
        serviceMs: 4,
        workerSeq: seq,
      }
      if (request.action === 'apply-and-build') {
        result.changeCount = (request.changes || []).length
        result.applyCommitted = true
        result.messages = []
        result.errorCount = 0
        result.warningCount = 0
      }
      fs.writeFileSync(payload.resultPath, JSON.stringify(result), 'utf8')
    }, 10)
    state.children.push({ child, timer })
    return child
  }
  state.stop = () => { for (const item of state.children) { clearInterval(item.timer); item.child.kill() } }
  return state
}

// ── A. the sink receives the audit record verbatim, one per action ──────────
async function sinkIsTheAuditStream () {
  const root = makeRoot()
  const source = makeFixture(root)
  const seen = []
  const engine = new CodesysScriptEngine(root, {
    runProcess: makeColdRunner(),
    timingSink: (record) => seen.push(record),
  })
  const bound = engine.bindProject({ sourcePath: source })
  await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
  await engine.execute('inspect-project', { jobId: bound.jobId })

  const auditPath = path.join(root, 'logs', 'codesys-timings.jsonl')
  assert(fs.existsSync(auditPath), 'the engine must keep writing its own JSONL audit')
  const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

  assert(lines.length >= 3, `bind + write + read must each be audited (got ${lines.length})`)
  assert.strictEqual(seen.length, lines.length, `the sink must be called exactly once per audited action (sink ${seen.length}, jsonl ${lines.length})`)
  // Field-for-field: the sink is not a summary, it is THE record (this is what
  // "字段原样" means, and it is what makes the audit stream and the timings file
  // two views of one measurement instead of two competing ones).
  assert.deepStrictEqual(seen, lines, 'every record handed to the sink must equal its JSONL line exactly')
  for (const record of seen) {
    for (const field of ['action', 'jobId', 'totalMs', 'pythonStartMs', 'hashMs', 'hashCalls', 'jobDirCopyBytes']) {
      assert(Object.prototype.hasOwnProperty.call(record, field), `the audited record must carry ${field}`)
    }
  }
  assert(seen.some((record) => record.action === 'apply-and-build'), 'the write must be attributed in the audit stream')
  assert(seen.some((record) => record.action === 'inspect-project'), 'the read must be attributed too')
  // One line per record: the file may not hold multi-record lines, and no record
  // may be missing from it (that would make the sink the only copy).
  assert(lines.every((line) => typeof line === 'object' && line !== null), 'every line must be one JSON record')
  await engine.stopOfflineWorker('contract')
  return { calls: seen.length, lines: lines.length, actions: seen.map((record) => record.action) }
}

// ── B1. a preheat that fails must not break the read ────────────────────────
async function failedPreheatStillReads () {
  const root = makeRoot()
  const source = makeFixture(root)
  const state = {}
  const engine = new CodesysScriptEngine(root, {
    // The host's preheat uses the persistent worker; here that worker cannot
    // start at all, which is exactly "预热失败".
    persistentScriptEngine: true,
    offlineSpawnProcess: () => { throw Object.assign(new Error('模拟：CODESYS 离线常驻进程起不来'), { code: 'CODESYS_OFFLINE_WORKER_SPAWN_FAILED' }) },
    runProcess: makeColdRunner(state),
  })
  const bound = engine.bindProject({ sourcePath: source })
  // Exactly what the host does: fire the preheat and walk away from it.
  const preheat = engine.ensureOfflineWorker(null).then(() => 'resolved', (error) => error)
  const outcome = await preheat
  assert.notStrictEqual(outcome, 'resolved', 'a preheat that cannot start must not claim success')
  assert.strictEqual(outcome.code, 'CODESYS_OFFLINE_WORKER_SPAWN_FAILED', 'the failure must be an error the host sink can record')
  const read = await engine.execute('inspect-project', { jobId: bound.jobId })
  assert.strictEqual(read.ok, true, 'a failed preheat must not break the first read')
  assert.strictEqual(read.status, 'verified', 'the read must fall back to the one-process-per-action path')
  assert((state.coldRuns || 0) >= 1, 'the fallback must really run a CODESYS process')
  assert(engine.offlineWorkerState().running !== true, 'no worker may be left half-started')
  return { preheatError: outcome.code, readStatus: read.status, coldRuns: state.coldRuns }
}

// ── B2. the main-process wiring, by source fact ─────────────────────────────
function wiringFacts () {
  const construction = mainSource.match(/new CodesysScriptEngine\([^)]*\)/g) || []
  assert.strictEqual(construction.length, 1, `the engine must be constructed exactly once (found ${construction.length})`)
  const sinkLine = "timingSink: (record) => harness.append('codesys.scriptengine.timing', record)"
  assert(mainSource.includes(sinkLine), 'the engine timingSink must be wired straight into harness.append')
  // No reshaping between the engine and the audit stream: the record is the
  // payload, byte for byte.
  assert(!/timingSink:\s*\(record\)\s*=>\s*harness\.append\([^)]*JSON\.stringify/.test(mainSource), 'the host must not re-serialise the timing record')
  assert(!/timingSink:[\s\S]{0,200}?action:/.test(mainSource), 'the host must not pick fields out of the timing record')

  // The preheat trigger: inside showPluginSurface, before the "already showing
  // this surface" early return, never awaited.
  const show = mainSource.indexOf('async function showPluginSurface(kind) {')
  assert(show > 0, 'showPluginSurface must exist')
  const showBody = mainSource.slice(show, mainSource.indexOf('\nfunction ', show + 10) > 0 ? mainSource.indexOf('\nfunction ', show + 10) : undefined)
  const trigger = "if (kind === 'codesys') preheatCodesysOfflineWorker('codesys-surface-open');"
  assert(showBody.includes(trigger), 'the CODESYS panel becoming visible must trigger the preheat')
  assert(!showBody.includes(`await preheatCodesysOfflineWorker`), 'the surface switch must never await the preheat')
  // T193：那次早退的判据现在是先取好的 `sameSurface`（`pluginSurfaceKind` 必须**先落笔**、
  // 再让视图可见 —— 见 codesys-panel-sender-gate-contract.js 的根因断言）。意图不变：
  // 预热必须在**任何**早退之前点火，否则"面板第一次打开"这条触发点就落空了。
  assert(showBody.includes('const sameSurface = pluginSurfaceKind === kind;'),
    'the "already showing this surface" decision must still exist (as `sameSurface`)')
  assert(
    showBody.indexOf(trigger) < showBody.indexOf('if (sameSurface) {'),
    'the preheat must start on the first panel open, not after the "same surface" early return',
  )
  // It must not run on the synchronous path of the switch.
  const helper = mainSource.slice(mainSource.indexOf('function preheatCodesysOfflineWorker(reason) {'), mainSource.indexOf('async function showPluginSurface(kind) {'))
  assert(helper.includes('setImmediate('), 'the preheat must defer itself so a surface switch never blocks on it')
  assert(helper.includes('if (codesysOfflinePreheat) return codesysOfflinePreheat'), 'a second panel switch must join the in-flight preheat instead of starting another')
  assert(helper.includes('codesysScriptEngine.ensureOfflineWorker(null)'), 'the preheat must reuse the engine side dedupe (ensureOfflineWorker)')
  assert(/catch \(error\)[\s\S]{0,300}?resolve\(null\)/.test(helper), 'a failed preheat must resolve instead of rejecting into nobody')
  assert(helper.includes("harness.append('codesys.scriptengine.preheat.failed'"), 'a failed preheat must leave one audit line saying so')
  assert(helper.includes('codesysOfflinePreheat = null'), 'the in-flight marker must be released so a later panel open can retry')
  assert(!/process\.on\(|app\.on\(/.test(helper), 'the preheat must not hook process/app lifecycle events')
  // No IPC channel was added for any of this: the workbench keeps using the
  // existing `codesys:scriptengine-action`.
  assert(!mainSource.includes('codesys:scriptengine-preheat'), 'no new IPC channel may be invented for the preheat')
  return {
    constructionSites: construction.length,
    helperLines: helper.split('\n').length,
  }
}

// ── B3. "preheat first, read later" = the first read pays no startup ───────
// This is the whole POINT of the preheat: the panel-open trigger starts the
// worker while the user is still choosing/binding a project, so by the time the
// FIRST read happens the ~30 s launch is already paid. `startDelayMs` stands in
// for that launch, and the read is measured against it.
async function preheatedFirstReadIsCheap () {
  const root = makeRoot()
  const source = makeFixture(root)
  const harness = makeWorkerHarness({ startDelayMs: 1200 })
  const engine = new CodesysScriptEngine(root, {
    persistentScriptEngine: true,
    offlineSpawnProcess: harness.spawn,
    runProcess: makeColdRunner({}),
  })
  // t0 = the user opens the CODESYS panel (what showPluginSurface triggers).
  const preheatStartedAt = Date.now()
  await engine.ensureOfflineWorker(null)
  const preheatMs = Date.now() - preheatStartedAt
  assert(preheatMs >= harness.startDelayMs, `the preheat must really wait for the worker (waited ${preheatMs}ms for a ${harness.startDelayMs}ms start)`)
  assert.strictEqual(harness.spawns, 1, 'the preheat must start exactly one worker')

  // The user then binds a project and the workbench reads it: this is the FIRST
  // read of the session.
  const bound = engine.bindProject({ sourcePath: source })
  const readStartedAt = Date.now()
  const read = await engine.execute('inspect-project', { jobId: bound.jobId })
  const readMs = Date.now() - readStartedAt
  assert.strictEqual(read.timings.pythonReused, 1, 'the first read must reuse the pre-warmed worker')
  assert.strictEqual(harness.spawns, 1, 'preheat + bind + first read must start exactly ONE CODESYS worker (no double-open)')
  assert(readMs * 3 < harness.startDelayMs, `the first read must be a fraction of the launch it avoided (read ${readMs}ms vs start ${harness.startDelayMs}ms)`)
  // `pythonStartMs` is NOT asserted to be 0 here, and that is deliberate: the
  // engine attributes a freshly started worker's launch to the FIRST action that
  // uses it (`noteWorkerStart`), so after a panel-open preheat that first read
  // still carries the launch the PREHEAT paid. What the user feels — and what
  // this block measures — is the read's own wall clock (readMs), which is now a
  // fraction of the launch instead of all of it.
  assert(read.timings.pythonReused === 1 && readMs < harness.startDelayMs / 3, 'the read wait must not include the startup')
  await engine.stopOfflineWorker('contract')
  harness.stop()
  return { startDelayMs: harness.startDelayMs, preheatMs, readMs, spawns: harness.spawns, pythonStartMs: read.timings.pythonStartMs, commands: harness.commands }
}

async function main () {
  const sink = await sinkIsTheAuditStream()
  const failed = await failedPreheatStillReads()
  const preheated = await preheatedFirstReadIsCheap()
  const wiring = wiringFacts()
  process.stdout.write(
    'codesys timing sink + preheat contract passed ' +
    `(sink records ${sink.calls} == jsonl lines ${sink.lines} for ${sink.actions.join('/')}, fields verbatim; ` +
    `failed preheat ${failed.preheatError} still read ${failed.readStatus} with ${failed.coldRuns} one-shot process; ` +
    `preheat ${preheated.preheatMs}ms -> FIRST read ${preheated.readMs}ms with pythonStartMs=${preheated.pythonStartMs} ` +
    `(launch stood in for ${preheated.startDelayMs}ms, ${preheated.spawns} worker spawn, ${preheated.commands} command(s)); ` +
    `wiring: ${wiring.constructionSites} construction site, preheat helper ${wiring.helperLines} lines)\n`,
  )
}

main()
  .then(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } } process.exit(0) })
  .catch((error) => {
    for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
    console.error(`codesys timing sink + preheat contract failed: ${error.message}`)
    process.exit(1)
  })
