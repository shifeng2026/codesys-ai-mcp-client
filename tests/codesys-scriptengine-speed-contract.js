'use strict'
// Contract (T183 items 0-4): the CODESYS offline engine must
//   0. emit a fixed-shape timing record for every action (so "20-40 s" can be
//      attributed instead of guessed),
//   1. reuse ONE persistent ScriptEngine worker instead of paying the CODESYS
//      launch per action -- and never replay a mutation whose worker died,
//   2. stop copying the whole `.project` for every action,
//   3. stop hashing the whole `.project` six times per apply -- without ever
//      letting a cached hash authorise an overwrite,
//   4. be able to report "applied and on disk" before the compile finishes.
//
// Everything here runs the REAL engine with an injected process seam: no CODESYS
// installation is needed. The persistent-worker half uses an in-process worker
// emulator that speaks the real file protocol (ready / command / ack / result),
// so the host side is exercised rather than grepped.
//
// Safety semantics that must survive the speed work are asserted here too:
//   * the write guard is a FRESH hash of the source and refuses an external save
//     (T170's "变了" case) while keeping the recovery snapshot,
//   * the job-directory retention policy still keeps the baseline (T169) and now
//     also the reusable working copy.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const roots = []
function makeRoot () {
  const root = createTempDir('taskhive-speed-')
  roots.push(root)
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function makeFixture (root, megabytes = 2) {
  const source = path.join(root, 'source.project')
  const chunk = Buffer.alloc(1024 * 1024, 0x41)
  const handle = fs.openSync(source, 'w')
  try { for (let index = 0; index < megabytes; index += 1) fs.writeSync(handle, chunk) } finally { fs.closeSync(handle) }
  return source
}

function argValue (argv, prefix) {
  const found = (argv || []).find((item) => String(item).startsWith(prefix))
  return found ? String(found).slice(prefix.length).replace(/^"|"$/g, '') : ''
}

function scriptLiterals (scriptPath) {
  const script = fs.readFileSync(scriptPath, 'utf8')
  const request = script.match(/request_path = ("(?:[^"\\]|\\.)*")/)
  const result = script.match(/result_path = ("(?:[^"\\]|\\.)*")/)
  assert(request && result, 'the emitted script must declare its request and result paths')
  return { requestPath: JSON.parse(request[1]), resultPath: JSON.parse(result[1]) }
}

// ── the cold path: one CODESYS process per action ---------------------------
function makeColdRunner (state = {}) {
  const runner = async function runProcess (_exePath, args) {
    state.processStarts = (state.processStarts || 0) + 1
    state.coldRuns = (state.coldRuns || 0) + 1
    const { requestPath, resultPath } = scriptLiterals(argValue(args, '--runscript='))
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
    // A real CODESYS save rewrites the file it opened. Simulating it is what makes
    // "the source content changed after this action" observable.
    if (state.saveOnRun !== false && request.projectPath) fs.appendFileSync(request.projectPath, `\n# codesys save ${state.processStarts}\n`)
    if (state.externalSavePath) fs.appendFileSync(state.externalSavePath, '\n# external save\n')
    const payload = makePayload(request, state)
    fs.mkdirSync(path.dirname(resultPath), { recursive: true })
    fs.writeFileSync(resultPath, JSON.stringify(payload), 'utf8')
    return { stdout: Buffer.from(''), stderr: Buffer.from('') }
  }
  runner.state = state
  return runner
}

function makePayload (request, state = {}) {
  const payload = { ok: true, action: request.action, safetyMode: 'isolated-offline-project-only', projectPath: request.projectPath }
  if (request.action === 'inspect-project') {
    Object.assign(payload, {
      complete: true,
      textTruncated: false,
      objectCount: 1,
      hierarchy: { roots: 1, grouped: 1, ungrouped: 0, reparented: 0, internal: 0 },
      objects: [{ name: 'PLC_PRG', guid: 'g-pou', type: '6f9dac99-8de1-4efc-8465-68ac443b7d08', depth: 0, parentGuid: '', parentName: '', path: ['PLC_PRG'], hasChildren: false, hasDeclaration: true, hasImplementation: true, declaration: 'PROGRAM PLC_PRG', implementation: 'x := 1;' }],
      timings: { walkMs: 1, coverageMs: 0, totalMs: 2, objects: 1 },
    })
  }
  if (request.action === 'apply-and-build' || request.action === 'apply-changes') {
    payload.applied = (request.changes || []).map((change) => ({ operation: change.operation, object: { name: change.objectName, guid: 'g-pou' } }))
    payload.changeCount = payload.applied.length
    payload.applyCommitted = true
  }
  if (request.action === 'apply-and-build' && request.build !== false) {
    payload.messages = []
    payload.errorCount = 0
    payload.warningCount = 0
  }
  const builds = request.action === 'build' || request.action === 'rebuild' || (request.action === 'apply-and-build' && request.build !== false)
  payload.phaseMs = { openMs: 3, applyMs: state.applyMs !== undefined ? state.applyMs : 4, saveMs: 2, buildMs: builds ? (state.buildMs !== undefined ? state.buildMs : 300) : 0, treeMs: 2, totalMs: 15 }
  payload.serviceMs = 20
  return Object.assign(payload, state.payloadExtra || {})
}

// ── the persistent worker: an in-process emulator of the file protocol ------
function makeWorkerEmulator (state = {}) {
  state.spawns = []
  state.coldRuns = 0
  const spawner = function spawnProcess (_exePath, argv, options) {
    const scriptPath = argValue(argv, '--runscript=')
    const workDir = path.dirname(scriptPath)
    const token = path.basename(scriptPath).replace(/^offline-worker-/, '').replace(/\.py$/, '')
    const record = { workDir, token, scriptPath, commands: 0 }
    state.spawns.push(record)
    const commandPath = path.join(workDir, `offline-command-${token}.json`)
    const readyPath = path.join(workDir, `offline-ready-${token}.json`)
    const child = new EventEmitter()
    child.pid = 4000 + state.spawns.length
    child.exitCode = null
    child.killed = false
    child.kill = () => { child.killed = true; child.exitCode = 1; child.emit('exit', 1, null) }
    let seen = 0
    let timer = null
    const stop = () => { if (timer) clearInterval(timer); timer = null }
    timer = setInterval(() => {
      if (child.exitCode !== null) return stop()
      let command = null
      try { command = JSON.parse(fs.readFileSync(commandPath, 'utf8')) } catch { return }
      if (!command || Number(command.seq) <= seen) return
      seen = Number(command.seq)
      record.commands += 1
      const seq = Number(command.seq)
      fs.writeFileSync(path.join(workDir, `offline-ack-${token}-${seq}.json`), JSON.stringify({ seq, acceptedAt: Date.now() }), 'utf8')
      if (state.mode === 'die-after-ack') {
        stop()
        child.exitCode = 9
        child.emit('exit', 9, null)
        return
      }
      const request = command.request || {}
      const payload = makePayload(request, state)
      payload.workerSeq = seq
      payload.serviceMs = 20
      const writeResult = () => {
        try {
          fs.mkdirSync(path.dirname(command.resultPath), { recursive: true })
          fs.writeFileSync(command.resultPath, JSON.stringify(payload), 'utf8')
        } catch { /* dir cleaned */ }
      }
      // A real compile costs 45-47 s in the field; the emulator sleeps so the
      // "apply reports before the compile" claim is measured, not asserted.
      const builds = request.action === 'build' || request.action === 'rebuild' || (request.action === 'apply-and-build' && request.build !== false)
      if (builds && state.buildMs) setTimeout(writeResult, state.buildMs)
      else writeResult()
    }, 5)
    child.on('exit', stop)
    setTimeout(() => { try { fs.writeFileSync(readyPath, JSON.stringify({ ok: true, pid: child.pid }), 'utf8') } catch { /* dir cleaned */ } }, 5)
    if (state.mode === 'die-before-ack') setTimeout(() => { child.exitCode = 7; child.emit('exit', 7, null) }, 30)
    return child
  }
  spawner.state = state
  return spawner
}

function makeEngine (root, options, state) {
  const engine = new CodesysScriptEngine(root, options)
  engine.doctor = () => ({ ready: true, exePath: 'C:\\fake\\CODESYS.exe', profile: 'CODESYS V3.5 SP20 Patch 4' })
  if (state) state.engine = engine
  return engine
}

const TIMING_FIELDS = ['jobDirCopyMs', 'pythonStartMs', 'hashMs', 'applyMs', 'buildMs', 'parseMs', 'totalMs', 'jobDirCopyBytes', 'jobDirCopyFiles', 'hashCalls', 'hashBytes']
const CHANGES = [{ operation: 'update-text', objectName: 'PLC_PRG', declaration: 'PROGRAM PLC_PRG', implementation: 'x := 2;' }]

function jobProjectFiles (root, jobId) {
  const jobDir = path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', jobId)
  const found = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.project$/i.test(entry.name)) found.push(path.relative(jobDir, full))
    }
  }
  walk(jobDir)
  return found.sort()
}

async function main () {
  const report = {}

  // ── 0. timing record shape ───────────────────────────────────────────────
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const state = { externalSavePath: '' }
    const engine = makeEngine(root, { runProcess: makeColdRunner(state) })
    const bound = engine.bindProject({ sourcePath: source })
    const write = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
    for (const field of TIMING_FIELDS) {
      assert(Object.prototype.hasOwnProperty.call(write.timings, field), `the timing record must always carry ${field}`)
    }
    assert(write.timings.pythonIsColdProcessTotal === 1, 'a cold run must say that pythonStartMs is the whole process')
    assert(write.timings.pythonReused === 0, 'a cold run must not claim worker reuse')
    // Binding is where the two job-dir copies belong (baseline + reusable working
    // copy); the first write after binding must add ZERO copies because the
    // working copy and the baseline already hold exactly the source bytes.
    assert.strictEqual(bound.timings.jobDirCopyFiles, 2, `bind-project must create exactly two job-dir copies, got ${bound.timings.jobDirCopyFiles}`)
    assert.strictEqual(bound.timings.jobDirCopyBytes, 2 * 2 * 1024 * 1024, 'bind-project must report the bytes it copied')
    assert.strictEqual(write.timings.jobDirCopyBytes, 0, `the first write after binding must copy 0 bytes, got ${write.timings.jobDirCopyBytes}`)
    assert.strictEqual(write.timings.snapshotReused, 1, 'that write must reuse the baseline as its pre-write snapshot')
    assert(write.timings.hashCalls >= 1 && write.timings.hashCalls <= 4, `an apply must hash the project at most 4 times, got ${write.timings.hashCalls}`)
    assert(write.timings.totalMs >= 0, 'totalMs must be present')
    const auditPath = path.join(root, 'logs', 'codesys-timings.jsonl')
    assert(fs.existsSync(auditPath), 'every action must append one line to the timing audit')
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert(lines.length >= 2, `bind + write must both be audited (got ${lines.length})`)
    for (const field of ['jobDirCopyMs', 'pythonStartMs', 'hashMs', 'applyMs', 'buildMs', 'totalMs']) {
      assert(Object.prototype.hasOwnProperty.call(lines[lines.length - 1], field), `the audit line must carry ${field}`)
    }
    assert(lines.some((line) => line.action === 'apply-and-build'), 'the audit must say which action it measured')
    report.timing = { hashCalls: write.timings.hashCalls, auditLines: lines.length }
    engine.stopOfflineWorker('contract')
  }

  // ── 2. no whole-project copy per action; 3. hashing ----------------------
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const cold = makeColdRunner({})
    const engine = makeEngine(root, { runProcess: cold })
    const bound = engine.bindProject({ sourcePath: source })
    const filesAfterBind = jobProjectFiles(root, bound.jobId)
    const writes = []
    for (let index = 0; index < 3; index += 1) {
      writes.push(await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true }))
    }
    const copyFiles = writes.map((item) => item.timings.jobDirCopyFiles)
    const copyBytes = writes.map((item) => item.timings.jobDirCopyBytes)
    const hashCalls = writes.map((item) => item.timings.hashCalls)
    assert(copyFiles.every((value) => value <= 1), `no action may copy more than one project file (got ${copyFiles.join(', ')})`)
    assert(copyFiles.reduce((sum, value) => sum + value, 0) <= 2, `three confirmed writes must not rebuild the project three times (copied ${copyFiles.join(', ')})`)
    assert(copyBytes.includes(0), `at least one write must copy 0 bytes (got ${copyBytes.join(', ')})`)
    assert(writes.every((item) => item.timings.snapshotCopyBytes === 0), 'the pre-write snapshot must come from reuse/rename, not a fresh copy')
    assert(writes.every((item) => item.timings.snapshotReused === 1 || item.timings.snapshotRenamed === 1), 'every write must report how its snapshot was obtained')
    assert(writes.every((item) => item.timings.commitBackupBytes === 0), 'the commit must restore from the verified snapshot instead of copying a second backup')
    assert(writes.every((item) => item.timings.hashCalls <= 4), `an apply must not hash the project six times (got ${hashCalls.join(', ')})`)
    assert(writes.some((item) => item.timings.hashCacheHits >= 1), 'the stat-validated hash cache must actually be hit')
    const filesAfterWrites = jobProjectFiles(root, bound.jobId)
    // What must NOT accumulate is the throwaway execution copy (`staged/<action>-*`).
    // The pre-write recovery snapshots do exist by design (T170) -- one per write at
    // most, and retention keeps the newest two.
    assert(!filesAfterWrites.some((name) => name.startsWith('staged')), `no per-action staged copy may exist (found ${filesAfterWrites.join(', ')})`)
    assert(filesAfterWrites.includes(path.join('snapshots', '000-baseline.project')), 'the baseline must still exist')
    assert(filesAfterWrites.includes(path.join('snapshots', 'working.project')), 'the reusable working copy must live in snapshots/working.project')
    const beforeSnapshots = filesAfterWrites.filter((name) => /^snapshots[\\/]\d{3}-/.test(name) && !/000-baseline\.project$/.test(name))
    assert(beforeSnapshots.length <= 2, `three writes must not leave more than two pre-write snapshots (found ${beforeSnapshots.length}: ${beforeSnapshots.join(', ')})`)
    report.copy = { copyFiles, copyBytes, hashCalls, projectFiles: filesAfterWrites.length, beforeSnapshots: beforeSnapshots.length }
    // The evidence reports both phases separately.
    assert(writes[0].timings.buildMs === 300, 'the engine must report the compile phase from the Python-side timings')
  }

  // ── T169 retention + T170 write guard ------------------------------------
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const engine = makeEngine(root, { runProcess: makeColdRunner({}) })
    const bound = engine.bindProject({ sourcePath: source })
    // Four writes leave three pre-write snapshots, so retention (keep 2) has
    // something to prune while the baseline must survive.
    for (let index = 0; index < 4; index += 1) {
      await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
    }
    const jobDir = path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', bound.jobId)
    const snapshotsDir = path.join(jobDir, 'snapshots')
    assert(fs.existsSync(path.join(snapshotsDir, '000-baseline.project')), 'the rollback baseline must exist')
    fs.writeFileSync(path.join(jobDir, 'x.bootinfo'), Buffer.alloc(1024), 'utf8')
    const aged = Date.now() - 60 * 60 * 1000
    for (const name of fs.readdirSync(jobDir)) {
      try { fs.utimesSync(path.join(jobDir, name), aged / 1000, aged / 1000) } catch { /* directories */ }
      const full = path.join(jobDir, name)
      if (fs.statSync(full).isDirectory()) {
        for (const inner of fs.readdirSync(full)) {
          try { fs.utimesSync(path.join(full, inner), aged / 1000, aged / 1000) } catch { /* best effort */ }
        }
      }
    }
    try { fs.utimesSync(path.join(jobDir, 'job.json'), aged / 1000, aged / 1000) } catch { /* best effort */ }
    const before = fs.readdirSync(snapshotsDir).filter((name) => name.startsWith('00') && name !== '000-baseline.project').length
    const cleanup = engine.cleanupJobArtifacts(bound.jobId, { now: Date.now() })
    assert(cleanup.freedBytes > 0, `retention must free the sidecars and old snapshots (freed ${cleanup.freedBytes})`)
    assert(!fs.existsSync(path.join(jobDir, 'x.bootinfo')), 'known CODESYS intermediates must still be removed')
    assert(fs.existsSync(path.join(snapshotsDir, '000-baseline.project')), 'the baseline must never be pruned')
    assert(fs.existsSync(path.join(snapshotsDir, 'working.project')), 'the reusable working copy must survive retention (it is not a stale staged copy)')
    const pruned = cleanup.removed.filter((item) => item.reason === 'before-snapshot')
    assert(pruned.length >= 1, `old before-* snapshots must be pruned (pruned ${pruned.length}, before ${before})`)
    const second = engine.cleanupJobArtifacts(bound.jobId, { now: Date.now() })
    assert(second.freedBytes === 0, `retention must be idempotent (second run freed ${second.freedBytes})`)
    report.retention = { freedBytes: cleanup.freedBytes, prunedBefore: pruned.length, idempotent: second.freedBytes === 0 }

    // T170 "变了": the source is saved externally while the action is in flight.
    const guardRoot = makeRoot()
    const guardSource = makeFixture(guardRoot)
    const guardState = { externalSavePath: '' }
    const guardEngine = makeEngine(guardRoot, { runProcess: makeColdRunner(guardState) })
    const guardBound = guardEngine.bindProject({ sourcePath: guardSource })
    guardState.externalSavePath = guardSource
    const failure = await guardEngine.execute('apply-and-build', { jobId: guardBound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
      .then(() => null, (error) => error)
    assert(failure, 'a write whose source changed underneath must not resolve')
    assert.strictEqual(failure.code, 'CODESYS_SCRIPTENGINE_SOURCE_CHANGED_DURING_ACTION', 'the external-save guard must keep its own error code')
    const guardJob = JSON.parse(fs.readFileSync(path.join(guardRoot, 'workspaces', 'codesys-scriptengine', 'jobs', guardBound.jobId, 'job.json'), 'utf8'))
    const guardSnapshots = (guardJob.snapshots || []).filter((item) => item.path && fs.existsSync(item.path))
    assert(guardSnapshots.length >= 1, 'the recovery snapshot must survive a refused commit')
    const externalText = fs.readFileSync(guardSource, 'utf8')
    assert(externalText.includes('# external save'), 'the refused commit must not overwrite the externally saved bytes')
    assert(!externalText.includes('x := 2;') || externalText.length === 0, 'the staged content must not have been committed')
    report.guard = { code: failure.code, snapshotsKept: guardSnapshots.length }

    // T170's three states are fed by `diff` + the bind baseline. The speed work must
    // not have touched them: "unchanged", "changed" and "cannot be proven" must all
    // still be distinguishable, and `diff` must keep hashing the project for real.
    const diffRoot = makeRoot()
    const diffSource = makeFixture(diffRoot)
    const diffEngine = makeEngine(diffRoot, { runProcess: makeColdRunner({ saveOnRun: false }) })
    const diffBound = diffEngine.bindProject({ sourcePath: diffSource })
    assert(diffBound.baselineSha256, 'bind must still report the baseline hash the write guard compares against')
    const same = diffEngine.diff({ jobId: diffBound.jobId })
    assert.strictEqual(same.changed, false, 'an untouched project must diff as unchanged')
    fs.appendFileSync(diffSource, '\n# external edit\n')
    const changed = diffEngine.diff({ jobId: diffBound.jobId })
    assert.strictEqual(changed.changed, true, 'an externally saved project must diff as changed')
    assert.notStrictEqual(changed.currentSha256, same.currentSha256, 'diff must recompute the real hash, not a cached one')
    const unprovable = (() => {
      try { diffEngine.diff({ jobId: 'direct-0000000000000-deadbeef' }); return null } catch (error) { return error }
    })()
    assert(unprovable, 'a diff that cannot be computed must throw, which is the client\'s "unverifiable" state')
    report.threeState = { unchanged: same.changed, changed: changed.changed, unprovable: unprovable.code || 'thrown' }
  }

  // ── 1. persistent worker + 4. split apply/build ---------------------------
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const state = { buildMs: 250 }
    const spawner = makeWorkerEmulator(state)
    const cold = makeColdRunner(spawner.state)
    const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: spawner, runProcess: cold })
    const bound = engine.bindProject({ sourcePath: source })
    // Binding pre-warms the worker so the launch overlaps the bind round trip
    // instead of the following read. The host polls the ready file (150 ms), so
    // wait for it rather than for a fixed delay.
    const warmDeadline = Date.now() + 2000
    while (Date.now() < warmDeadline && engine.offlineWorkerState().running !== true) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert(engine.offlineWorkerState().running === true, 'binding must pre-warm the persistent worker')
    const first = await engine.execute('inspect-project', { jobId: bound.jobId })
    assert.strictEqual(first.timings.pythonReused, 1, 'the first read must reuse the pre-warmed worker')
    assert(first.timings.pythonStartMs > 0, 'the first read must report the startup it actually waited for')
    assert.strictEqual(state.spawns.length, 1, 'pre-warming plus the first read may start exactly one CODESYS worker')
    const jobs = []
    for (let index = 0; index < 3; index += 1) {
      fs.appendFileSync(source, `\n# change ${index}\n`)
      jobs.push(await engine.execute('inspect-project', { jobId: bound.jobId }))
    }
    assert(state.spawns.length === 1, `later actions must reuse the worker (spawned ${state.spawns.length})`)
    assert(jobs.every((item) => item.timings.pythonReused === 1), 'a reused worker must be reported as such')
    assert(jobs.every((item) => item.timings.pythonStartMs === 0), 'a warm worker must not pay the startup again')
    assert(state.spawns[0].commands >= 4, `the one worker must have served every command (served ${state.spawns[0].commands})`)

    // The composite reports the two phases separately, and deferBuild reports the
    // apply phase before the compile has run.
    const normalStartedAt = Date.now()
    const normal = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
    const normalMs = Date.now() - normalStartedAt
    const deferredStartedAt = Date.now()
    const deferred = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, deferBuild: true })
    const deferredMs = Date.now() - deferredStartedAt
    assert.strictEqual(deferred.buildPending, true, 'the deferred write must report that the compile is still pending')
    assert(deferred.buildId, 'the deferred write must hand back a build id')
    assert(deferred.sourceProjectModified === true, 'the deferred write must already be committed to disk')
    assert(deferredMs + 100 < normalMs, `the apply phase must report before the compile (apply ${deferredMs}ms vs apply+build ${normalMs}ms)`)
    let status = null
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      status = await engine.execute('build-status', { jobId: bound.jobId, buildId: deferred.buildId })
      if (status.state === 'done' || status.state === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert(status && status.state === 'done', `the background compile must become observable (state ${status && status.state}, error ${status && status.error})`)
    assert(status.buildMs >= 200, `the deferred build must report the real compile cost (buildMs ${status.buildMs})`)
    assert(status.durationMs >= 200, 'the deferred build must report how long the background compile took')
    report.split = { normalMs, deferredMs, deferredBuildMs: status.buildMs, deferredDurationMs: status.durationMs, workerSpawns: state.spawns.length, commands: state.spawns[0].commands }
    await engine.stopOfflineWorker('contract')
  }

  // ── 1b. never replay a mutation whose worker died -------------------------
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const state = { mode: 'die-after-ack' }
    const spawner = makeWorkerEmulator(state)
    const cold = makeColdRunner(spawner.state)
    const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: spawner, runProcess: cold })
    const bound = engine.bindProject({ sourcePath: source })
    const failure = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
      .then(() => null, (error) => error)
    assert(failure, 'a worker that dies after accepting a write must surface an error')
    assert.strictEqual(failure.code, 'CODESYS_OFFLINE_WORKER_UNSAFE_RETRY', 'a write that may have half-executed must never be retried automatically')
    assert.strictEqual(spawner.state.coldRuns, 0, 'the unsafe-retry path must NOT fall back to a second CODESYS process')
    const job = JSON.parse(fs.readFileSync(path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', bound.jobId, 'job.json'), 'utf8'))
    assert.strictEqual(job.workProjectDirty, true, 'a dirty working copy must be marked so the next action rebuilds it from the source')
    report.unsafeRetry = { code: failure.code, workCopyDirty: job.workProjectDirty }
    await engine.stopOfflineWorker('contract')
  }

  // ── 1c. a worker that dies before accepting anything falls back safely ----
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const state = { mode: 'die-before-ack' }
    const spawner = makeWorkerEmulator(state)
    const cold = makeColdRunner(spawner.state)
    const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: spawner, runProcess: cold })
    const bound = engine.bindProject({ sourcePath: source })
    const result = await engine.execute('inspect-project', { jobId: bound.jobId })
    assert.strictEqual(result.status, 'verified', 'an unclaimed command must fall back to the one-process-per-action path')
    assert(spawner.state.coldRuns >= 1, 'the fallback must actually run the cold path')
    assert(engine.offlineWorkerState().failures >= 1, 'the breaker must record the failure so the next action does not wait again')
    report.fallback = { coldRuns: spawner.state.coldRuns, breakerFailures: engine.offlineWorkerState().failures }
    await engine.stopOfflineWorker('contract')
  }

  process.stdout.write(
    'codesys scriptengine speed contract passed ' +
    `(timing audit: hashCalls=${report.timing.hashCalls} lines=${report.timing.auditLines}; ` +
    `copy files ${report.copy.copyFiles.join('/')} bytes ${report.copy.copyBytes.join('/')} hashCalls ${report.copy.hashCalls.join('/')} projectFiles ${report.copy.projectFiles}; ` +
    `retention freed=${report.retention.freedBytes} prunedBefore=${report.retention.prunedBefore} idempotent=${report.retention.idempotent}; ` +
    `guard=${report.guard.code} snapshotsKept=${report.guard.snapshotsKept}; ` +
    `three-state/unchanged=${report.threeState.unchanged} changed=${report.threeState.changed} unprovable=${report.threeState.unprovable}; ` +
    `split apply=${report.split.deferredMs}ms vs apply+build=${report.split.normalMs}ms, deferred build=${report.split.deferredBuildMs}ms; ` +
    `worker spawns=${report.split.workerSpawns} commands=${report.split.commands}; ` +
    `unsafe-retry=${report.unsafeRetry.code} dirty=${report.unsafeRetry.workCopyDirty}; ` +
    `fallback coldRuns=${report.fallback.coldRuns} failures=${report.fallback.breakerFailures})\n`,
  )
}

main()
  .then(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } } process.exit(0) })
  .catch((error) => {
    for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
    console.error(`codesys scriptengine speed contract failed: ${error.message}`)
    // The worker emulator keeps an interval alive on purpose; a failed contract must
    // still terminate instead of hanging the suite.
    process.exit(1)
  })
