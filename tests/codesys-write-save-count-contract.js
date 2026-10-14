'use strict'
// Contract (T196 item B): "is there a duplicate save in saveMs?"
//
// Real-machine evidence this contract exists for (previous round, 1.1.0, five-axis fixture):
//   write (confirm -> disk) 3,337 ms = openMs 19 + applyMs 302 + saveMs 2,491 + commit/copy ms
// `saveMs` is the remaining bulk, and the question is whether the write path asks CODESYS to
// serialise the whole project MORE THAN ONCE. Wall-clock cannot answer that (one 2.5 s save and
// two 1.25 s saves look identical in a total), so the Python side counts the calls per request
// and the count travels with the result into `logs/codesys-timings.jsonl`:
//
//   1. CODESYS may be asked to serialise the project from exactly ONE place
//      (`project.save()` inside `save_project`), and a confirmed write's composite branch
//      calls it exactly once;
//   2. the count is per REQUEST, never accumulated across the persistent worker's lifetime
//      (otherwise one worker would report rising numbers that mean nothing);
//   3. the audit record always carries `saveCalls` (fixed field set) and reports 0 for anything
//      that cannot have saved -- a cached read, an offline build, a pre-open -- so an aggregated
//      stream can never count the same serialisation twice;
//   4. the write's commit-back is a byte copy (`commitProject`), not a second CODESYS save.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { EventEmitter } = require('node:events')

const enginePath = path.join(__dirname, '..', 'plugins', 'installed', 'codesys-monitor', 'scriptengine.cjs')
const engineModule = require(enginePath)
const { CodesysScriptEngine } = engineModule

const roots = []
function makeRoot () {
  const root = createTempDir('taskhive-savecount-')
  roots.push(root)
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function makeFixture (root, bytes = 256 * 1024) {
  const source = path.join(root, 'source.project')
  fs.writeFileSync(source, Buffer.alloc(bytes, 0x41))
  return source
}

function sha256Of (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function argValue (argv, prefix) {
  const found = (argv || []).find((item) => String(item).startsWith(prefix))
  return found ? String(found).slice(prefix.length).replace(/^"|"$/g, '') : ''
}

// ── the emitted Python: one serialisation point, one save per composite write ─────────────
function verifyGeneratedPython (report) {
  const dir = createTempDir('taskhive-savecount-py-')
  roots.push(dir)
  const single = engineModule.buildOfflineActionScript(path.join(dir, 'request.json'), path.join(dir, 'result.json'))
  const worker = engineModule.buildPersistentOfflineWorkerScript(path.join(dir, 'work'), { runToken: '-deadbeef' })
  fs.writeFileSync(path.join(dir, 'single.py'), single, 'utf8')
  fs.writeFileSync(path.join(dir, 'worker.py'), worker, 'utf8')

  let callSites = 0
  for (const [name, python] of [['single', single], ['worker', worker]]) {
    // Code shape is asserted on the code, not on the prose: the emitted service documents the
    // single save in a comment, and a comment must never be mistaken for a second call site.
    const code = python.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
    // ONE choke point for "CODESYS, serialise the project".
    assert.strictEqual((code.match(/project\.save\(\)/g) || []).length, 1,
      `${name}: the whole emitted service must call project.save() from exactly one place`)
    assert(code.includes('def save_project(project, project_path):'), `${name}: that place must be save_project`)
    // One call site per action that really writes -- never two for the same action.
    // (An indented standalone line: the `def` line contains the same text and is not a call.)
    const sites = (code.match(/^[ \t]+save_project\(project, project_path\)$/gm) || []).length
    callSites = sites
    assert.strictEqual(sites, 6, `${name}: exactly six action branches may save (got ${sites})`)
    // The composite the workbench's "confirm write" uses must save exactly once.
    const compositeAt = code.indexOf("elif action == 'apply-and-build':")
    assert(compositeAt > 0, `${name}: the composite write branch must exist`)
    const composite = code.slice(compositeAt, code.indexOf("elif action == 'export-xml':", compositeAt))
    assert.strictEqual((composite.match(/^[ \t]+save_project\(project, project_path\)$/gm) || []).length, 1,
      `${name}: a confirmed composite write must serialise the project exactly once`)
    assert(composite.includes("result['applyCommitted'] = True"),
      `${name}: the single save must happen BEFORE the write is reported as committed`)
    assert(composite.indexOf('save_project(project, project_path)') < composite.indexOf("result['applyCommitted'] = True"),
      `${name}: commit must follow the save, never the other way round`)
    // Per-request counting, not per-process accumulation.
    assert(code.includes("globals()['_SAVE_CALLS'] = 0"), `${name}: the counter must be reset once per request`)
    assert(code.includes("globals()['_SAVE_CALLS'] = int(globals().get('_SAVE_CALLS') or 0) + 1"),
      `${name}: save_project must count every serialisation it performs`)
    assert(code.includes("result['saveCalls'] = int(globals().get('_SAVE_CALLS') or 0)"),
      `${name}: the count must travel back with the result`)
    assert(code.includes("'saveCalls': 0"), `${name}: control requests must report the field explicitly`)
  }
  // The commit-back half: a byte copy, not a second CODESYS save.
  const engineSource = fs.readFileSync(enginePath, 'utf8')
  assert.strictEqual((engineSource.match(/commitProject\(job\.projectPath, stagedProjectPath,/g) || []).length, 1,
    'the write chain must commit back exactly once, with one byte copy')
  assert(!/commitProject\([\s\S]{0,200}?save_project/.test(engineSource), 'the host must never trigger a second save while committing')

  const python = findPython()
  if (python) {
    for (const name of ['single.py', 'worker.py']) {
      const compile = spawnSync(python[0], [...python.slice(1), '-m', 'py_compile', path.join(dir, name)], { stdio: 'inherit' })
      assert.strictEqual(compile.status, 0, `${name} must compile`)
    }
  }
  report.python = { callSites, compositeSaves: 1, oneSerialisationPoint: true, compiled: Boolean(python) }
}

function findPython () {
  for (const candidate of [['python'], ['py', '-3'], ['python3']]) {
    const probe = spawnSync(candidate[0], [...candidate.slice(1), '--version'], { stdio: 'ignore' })
    if (probe.status === 0) return candidate
  }
  return null
}

// ── worker emulator: mirrors the real service's per-request save accounting ───────────────
function makeWorkerEmulator (state = {}) {
  state.spawns = []
  state.commands = []
  let held = null
  const spawner = function spawnProcess (_exePath, argv) {
    const scriptPath = argValue(argv, '--runscript=')
    const workDir = path.dirname(scriptPath)
    const token = path.basename(scriptPath).replace(/^offline-worker-/, '').replace(/\.py$/, '')
    state.spawns.push({ workDir, token, commands: 0 })
    const record = state.spawns[state.spawns.length - 1]
    const commandPath = path.join(workDir, `offline-command-${token}.json`)
    const readyPath = path.join(workDir, `offline-ready-${token}.json`)
    const child = new EventEmitter()
    child.pid = 7200 + state.spawns.length
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
      state.commands.push({ action, seq, projectPath })
      const payload = {
        ok: true,
        action,
        safetyMode: 'isolated-offline-project-only',
        projectPath,
        workerSeq: seq,
        phaseMs: { openMs: 0, applyMs: 0, saveMs: 0, buildMs: 0, treeMs: 0 },
        // Exactly what the real Python side reports: a number that can only be 1 for one
        // confirmed write, and 0 for everything that does not serialise the project.
        saveCalls: 0,
      }
      if (action === 'release-project') {
        held = null
        payload.released = true
      } else if (projectPath) {
        const currentSha = fs.existsSync(projectPath) ? sha256Of(projectPath) : ''
        if (held && held.path === projectPath && held.sha === currentSha && currentSha) {
          payload.openReused = 1
        } else {
          held = { path: projectPath, sha: currentSha }
          payload.openReused = 0
          payload.phaseMs.openMs = 300
        }
        payload.heldProjectPath = projectPath
        if (action === 'preload-project') {
          payload.preloaded = true
          if (request.includeTree === true) {
            payload.complete = true
            payload.textTruncated = false
            payload.objectCount = 1
            payload.objects = [{ name: 'PLC_PRG', guid: 'g-pou', path: ['PLC_PRG'], depth: 0 }]
            payload.treeReused = 0
            payload.phaseMs.treeMs = 250
          }
        }
        if (action === 'inspect-project') {
          payload.complete = true
          payload.textTruncated = false
          payload.objectCount = 1
          payload.objects = [{ name: 'PLC_PRG', guid: 'g-pou', path: ['PLC_PRG'], depth: 0 }]
          payload.treeReused = 0
          payload.phaseMs.treeMs = 250
        }
        if (action === 'apply-and-build' || action === 'apply-changes') {
          payload.applied = (request.changes || []).map((change) => ({ operation: change.operation, object: { name: change.objectName, guid: 'g-pou' } }))
          payload.changeCount = payload.applied.length
          payload.phaseMs.applyMs = 40
          // ONE project.save() on the Python side: 2,491 ms is what ONE serialisation costs.
          payload.phaseMs.saveMs = 2491
          payload.saveCalls = 1
          if (action === 'apply-and-build' && request.build === false) {
            payload.applyCommitted = true
            payload.applyCommittedAt = Date.now() / 1000
            payload.buildSkipped = true
            payload.messages = []
          }
          held = { path: projectPath, sha: '' }
          try { held.sha = sha256Of(projectPath) } catch { held.sha = '' }
        }
        if (action === 'build' || action === 'rebuild') {
          payload.messages = []
          payload.phaseMs.buildMs = 120
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

function makeEngine (root, options) {
  const engine = new CodesysScriptEngine(root, options)
  engine.doctor = () => ({ ready: true, exePath: 'C:\\fake\\CODESYS.exe', profile: 'CODESYS V3.5 SP20 Patch 4' })
  return engine
}

function auditLines (root) {
  try {
    return fs.readFileSync(path.join(root, 'logs', 'codesys-timings.jsonl'), 'utf8').trim().split('\n')
      .filter(Boolean).map((line) => JSON.parse(line))
  } catch { return [] }
}

function waitFor (predicate, timeoutMs = 5000) {
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

// ── the executed half: count the serialisations of one whole write chain ─────────────────
async function oneSavePerConfirmedWrite () {
  const root = makeRoot()
  const source = makeFixture(root)
  const state = {}
  const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: makeWorkerEmulator(state) })

  // Pre-open the way the host now does it (panel open / detection), then adopt it by binding.
  const pre = await engine.preopenProjectForRead(source, 'contract')
  assert.strictEqual(pre.preopened, true, 'the pre-open must have happened')
  const bound = engine.bindProject({ sourcePath: source })
  assert.strictEqual(bound.adoptedPreopen, true, 'binding must adopt the pre-opened job')
  const jobId = bound.jobId

  // The confirmed write the workbench issues ("确认写入工程" -> apply-and-build, deferred build).
  const write = await engine.execute('apply-and-build', {
    jobId, changes: [{ operation: 'update-text', objectName: 'PLC_PRG', implementation: 'x := 2;' }], confirmed: true, includeTree: false, deferBuild: true,
  })
  assert.strictEqual(write.ok, true, 'the confirmed write must succeed')
  // The deferred build runs off the same working copy and must NOT save again. It is queued
  // behind the write's job lock, so wait for the task itself. (The background build has no
  // separate structured row of its own -- so the audit stream cannot even count it twice.)
  const buildId = String(write.buildId || '')
  assert(buildId, 'the deferred build must report a buildId')
  const buildTask = engine.deferredBuildTasks.get(buildId)
  if (buildTask) await buildTask.catch(() => {})
  await waitFor(() => engine.readDeferredBuild({ jobId, buildId }).state === 'done')
  const buildStatus = engine.readDeferredBuild({ jobId, buildId })
  assert.strictEqual(buildStatus.state, 'done', `the deferred build must have finished (got ${buildStatus.state})`)
  const rows = auditLines(root)
  const writeRow = rows.filter((row) => row.action === 'apply-and-build' && row.saveMs > 0).pop()
  assert(writeRow, 'the write must have its own audited row')
  assert.strictEqual(Number(writeRow.saveCalls), 1, `one confirmed write must serialise the project exactly once (got ${writeRow.saveCalls})`)
  assert.strictEqual(Number(writeRow.saveMs), 2491, 'and saveMs must be the cost of that ONE serialisation')
  assert.strictEqual(Number(writeRow.applyMs), 40, 'applyMs must stay the edit, not the save')
  assert.strictEqual(Number(writeRow.openMs), 0, 'the write must reuse the project the pre-open already opened')

  // The background build is not a second serialisation, and it leaves no structured row of its
  // own -- assert both facts so a future "helpful" extra row cannot inflate the aggregate.
  assert.strictEqual(rows.filter((row) => row.action === 'build').length, 0,
    'the split background build must not add a second audited row for the same write')
  assert.strictEqual(Number(buildStatus.saveCalls || 0), 0, 'the background build must not have saved')

  // A read served from the object-tree cache cannot have saved anything either.
  const read = await engine.execute('inspect-project', { jobId })
  assert.strictEqual(read.timings.cachedRead, true, 'the read must be answered from the object-tree cache')
  assert.strictEqual(Number(read.timings.saveCalls), 0, 'a cached read must report saveCalls=0 (no double counting)')
  assert.strictEqual(Number(read.timings.saveMs), 0, 'a cached read must report saveMs=0')

  // The whole chain: exactly ONE serialisation, and every audited row carries both fields.
  const chain = rows.filter((row) => ['preopen-project', 'preload-project', 'bind-project', 'apply-and-build', 'build', 'inspect-project'].includes(row.action))
  const serialisations = chain.reduce((total, row) => total + Number(row.saveCalls || 0), 0)
  assert.strictEqual(serialisations, 1, `the whole pre-open -> bind -> write -> build -> read chain must serialise the project once (got ${serialisations})`)
  // Every TIMING-SNAPSHOT row (the ones with the fixed field set, identified by `totalMs`)
  // must carry both save fields, so an aggregate over the stream can never silently lose them.
  // Event-style rows (e.g. `apply-and-build.apply-phase`, appended with a partial record on
  // purpose) are excluded by that same marker and must not claim a save either.
  const snapshotRows = rows.filter((row) => Object.prototype.hasOwnProperty.call(row, 'totalMs'))
  assert(snapshotRows.length >= 4, `the chain must have produced several timing rows (got ${snapshotRows.length})`)
  for (const row of snapshotRows) {
    assert(Object.prototype.hasOwnProperty.call(row, 'saveCalls'), `every timing record must carry saveCalls (${row.action})`)
    assert(Object.prototype.hasOwnProperty.call(row, 'saveMs'), `every timing record must carry saveMs (${row.action})`)
  }
  for (const row of rows.filter((item) => !Object.prototype.hasOwnProperty.call(item, 'totalMs'))) {
    assert(!Number(row.saveCalls), `an event-style row must not claim a save (${row.action})`)
  }
  const preopenRow = rows.find((row) => row.action === 'preopen-project')
  assert.strictEqual(Number(preopenRow.saveCalls), 0, 'the pre-open must not save anything')
  const preloadRow = rows.find((row) => row.action === 'preload-project')
  assert.strictEqual(Number(preloadRow.saveCalls), 0, 'opening a project for a read must not save it')
  const bindRow = rows.find((row) => row.action === 'bind-project')
  assert.strictEqual(Number(bindRow.saveCalls), 0, 'binding must not save the project')

  await engine.stopOfflineWorker('contract-finished')
  return {
    writeSaveCalls: Number(writeRow.saveCalls),
    writeSaveMs: Number(writeRow.saveMs),
    writeApplyMs: Number(writeRow.applyMs),
    chainSerialisations: serialisations,
    spawns: state.spawns.length,
  }
}

async function main () {
  const report = {}
  verifyGeneratedPython(report)
  const executed = await oneSavePerConfirmedWrite()
  console.log('[自测] B 项（saveMs 里有没有重复保存）：生成脚本 = 1 处 project.save() / 6 个可保存动作 / 复合写入恰好 1 次；'
    + `执行：一次确认写入 saveCalls=${executed.writeSaveCalls} saveMs=${executed.writeSaveMs}ms applyMs=${executed.writeApplyMs}ms，`
    + `整条 预打开→绑定→写入→编译→读取 链 saveCalls 合计=${executed.chainSerialisations}（编译/缓存读/预打开/绑定 全 0）；`
    + `python compiled=${report.python.compiled}；worker ${executed.spawns} 个`)
}

main().then(() => {
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
  console.log('codesys write save-count contract passed')
  process.exit(0)
}).catch((error) => {
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
  console.error(`codesys write save-count contract failed: ${error.message}`)
  process.exit(1)
})
