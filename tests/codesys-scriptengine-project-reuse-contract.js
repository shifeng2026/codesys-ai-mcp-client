'use strict'
// Contract (T185 items 1-3): the offline engine must stop paying "open the project again"
// for every single action, and must stop reporting an unknown compile result.
//
// Real-machine evidence this contract exists for (`logs/codesys-timings.jsonl`, 1.1.0):
//   * inspect-project  serviceMs=13534  treeMs=2664  pythonReused=1  processStarts=0
//   * apply-and-build  serviceMs=24253  applyMs=909    pythonReused=1  processStarts=0
// i.e. the Python/CODESYS launch was already amortised and the edits themselves were fast;
// what dominated both actions was `openMs` (9-20 s) -- the project was re-opened on every
// request, because `handle_request` ended with `finally: project.close()`.
//
// What is asserted here:
//   1. the persistent worker keeps ONE project open across actions, guarded by the file's
//      sha256 (same path + same sha256 => reuse; anything else => reopen and drop the old
//      state), and reports it honestly (`openMs` / `projectReused` in the timing record);
//   2. the same worker caches the object tree for an unchanged file, so `treeMs` is not
//      paid twice for identical bytes;
//   3. before the HOST overwrites the working copy (source changed externally) it makes the
//      worker release the file first -- otherwise a reused open project would turn into a
//      Windows sharing violation instead of a speed-up;
//   4. a compile whose console output only exists in the worker's stdio LOG (which is exactly
//      how the real persistent worker works: stdio goes to files, not pipes) still yields a
//      real errorCount / diagnostics, never `ok:true, errorCount:null`.
//
// The worker half runs against an in-process emulator of the real file protocol so the host
// side is executed rather than grepped. The Python side is asserted statically + compiled.

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
  const root = createTempDir('taskhive-reuse-')
  roots.push(root)
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function makeFixture (root, bytes = 256 * 1024) {
  const source = path.join(root, 'source.project')
  fs.writeFileSync(source, Buffer.alloc(bytes, 0x41))
  return source
}

function sha12 (file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12) } catch { return '' }
}

function argValue (argv, prefix) {
  const found = (argv || []).find((item) => String(item).startsWith(prefix))
  return found ? String(found).slice(prefix.length).replace(/^"|"$/g, '') : ''
}

// ── the persistent worker emulator: it REMEMBERS which project it has open ────────────────
// `state.openCostMs` is the (simulated) cost of projects.open(); it is only charged when the
// emulator really has to open -- exactly the semantics the real worker's acquire_project has.
function makeWorkerEmulator (state = {}) {
  state.spawns = []
  state.commands = []
  state.openCostMs = state.openCostMs === undefined ? 300 : state.openCostMs
  state.logLines = state.logLines || {}
  let held = null
  const spawner = function spawnProcess (_exePath, argv) {
    const scriptPath = argValue(argv, '--runscript=')
    const workDir = path.dirname(scriptPath)
    const token = path.basename(scriptPath).replace(/^offline-worker-/, '').replace(/\.py$/, '')
    const record = { workDir, token, scriptPath, commands: 0 }
    state.spawns.push(record)
    const commandPath = path.join(workDir, `offline-command-${token}.json`)
    const readyPath = path.join(workDir, `offline-ready-${token}.json`)
    const logPath = path.join(workDir, 'offline-worker.stdout.log')
    const child = new EventEmitter()
    child.pid = 7000 + state.spawns.length
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
      try {
        fs.writeFileSync(path.join(workDir, `offline-ack-${token}-${seq}.json`), JSON.stringify({ seq, acceptedAt: Date.now() }), 'utf8')
      } catch { /* dir cleaned */ }
      // 记下"服务这条命令的那一刻，工作副本的内容是什么"：release 与真正的覆盖谁先谁后
      // 因此是可举证的，而不是靠读代码猜。
      state.commands.push({ action, seq, workCopySha: sha12(projectPath), heldPath: held ? held.path : '' })
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
        const currentSha = sha12(projectPath)
        if (held && held.path === projectPath && held.sha === currentSha && currentSha) {
          payload.openReused = 1
          payload.phaseMs.openMs = 0
        } else {
          held = { path: projectPath, sha: currentSha }
          payload.openReused = 0
          payload.phaseMs.openMs = state.openCostMs
        }
        payload.heldProjectPath = projectPath
        if (action === 'inspect-project') {
          payload.complete = true
          payload.textTruncated = false
          payload.objectCount = 1
          payload.hierarchy = { roots: 1, grouped: 1, ungrouped: 0, reparented: 0, internal: 0 }
          payload.objects = [{ name: 'PLC_PRG', guid: 'g-pou', path: ['PLC_PRG'], depth: 0 }]
          // 源没变 + 同一个文件 ⇒ 真实 worker 直接返回缓存里的树（treeMs=0）。
          payload.treeReused = state.commands.filter((item) => item.action === 'inspect-project' && item.workCopySha === currentSha).length > 1 ? 1 : 0
          payload.phaseMs.treeMs = payload.treeReused ? 0 : 250
        }
        if (action === 'apply-and-build' || action === 'apply-changes') {
          payload.applied = (request.changes || []).map((change) => ({ operation: change.operation, object: { name: change.objectName, guid: 'g-pou' } }))
          payload.changeCount = payload.applied.length
          payload.applyCommitted = true
          payload.phaseMs.applyMs = 40
          payload.phaseMs.saveMs = 60
          // 真实 worker 的 save 之后磁盘内容 == 内存内容 ⇒ 缓存键推进到新的 sha。
          held = { path: projectPath, sha: sha12(projectPath) }
        }
        if (action === 'apply-and-build' && request.build !== false) {
          const lines = state.logLines.build || []
          if (lines.length && !state.noLog) {
            try { fs.appendFileSync(logPath, `${lines.join('\n')}\n`, 'utf8') } catch { /* dir cleaned */ }
          }
          payload.messages = []
          payload.phaseMs.buildMs = 120
        }
        if (action === 'build' || action === 'rebuild') {
          payload.messages = []
          payload.phaseMs.buildMs = 120
        }
      }
      const buildActions = action === 'apply-and-build' ? request.build !== false : (action === 'build' || action === 'rebuild')
      const settle = state.buildMs || 0
      const writeResult = () => {
        try {
          fs.mkdirSync(path.dirname(command.resultPath), { recursive: true })
          fs.writeFileSync(command.resultPath, JSON.stringify(payload), 'utf8')
        } catch { /* dir cleaned */ }
      }
      if (buildActions && settle) setTimeout(writeResult, settle)
      else writeResult()
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

const CHANGES = [{ operation: 'update-text', objectName: 'PLC_PRG', implementation: 'x := 2;' }]

function jobDirOf (root, jobId) {
  return path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', jobId)
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

// ── static: the emitted Python ───────────────────────────────────────────────────────────
function verifyGeneratedPython (report) {
  const dir = createTempDir('taskhive-reuse-py-')
  roots.push(dir)
  const single = engineModule.buildOfflineActionScript(path.join(dir, 'request.json'), path.join(dir, 'result.json'))
  const worker = engineModule.buildPersistentOfflineWorkerScript(path.join(dir, 'work'), { runToken: '-deadbeef' })
  fs.writeFileSync(path.join(dir, 'single.py'), single, 'utf8')
  fs.writeFileSync(path.join(dir, 'worker.py'), worker, 'utf8')
  // 复用开关只在常驻 worker 打开：单发脚本的语义必须与改前一模一样（进程结束即释放）。
  assert(/^PERSIST_OPEN_PROJECT = False$/m.test(single), 'the one-process-per-action script must NOT keep a project open')
  assert(/^PERSIST_OPEN_PROJECT = True$/m.test(worker), 'the persistent worker must keep its project open across actions')
  // 复用判据必须是"路径 + 真读一遍文件的 sha256"，不是 mtime/size 这类可被糊弄的签名。
  for (const text of [single, worker]) {
    assert(text.includes('def acquire_project(project_path):'), 'the emitted service must carry acquire_project')
    assert(text.includes('def project_file_sha(project_path):'), 'reuse must be guarded by a real sha256 of the file')
    assert(text.includes("hashlib.sha256()"), 'the reuse guard must hash the file itself')
    assert(text.includes("def close_cached_project():"), 'a stale/half-written project must be droppable')
    assert(text.includes("if action == 'release-project':"), 'the host must be able to make the worker let go of the file')
    assert(text.includes("if action == 'preload-project':"), 'binding must be able to pre-open the working copy')
  }
  // 失败即作废：内存里那份可能已经被改到一半，绝不能留给下一次动作。
  assert(/except Exception:\n[\s\S]{0,400}?close_cached_project\(\)\n\s+raise/.test(single),
    'a failed action must drop the cached project before re-raising')
  // 只有单发路径在 finally 里关工程。
  assert(single.includes("if project is not None and not globals().get('PERSIST_OPEN_PROJECT'):"),
    'the per-request close must be conditional on the persistence switch')
  // 空闲上限：默认 3600 秒（旧的 900 秒在真机上自杀过一次），且可显式覆盖。
  const idle = worker.match(/^MAX_IDLE_SECONDS = (\d+)$/m)
  assert(idle, 'the worker script must declare its idle ceiling')
  assert.strictEqual(Number(idle[1]), 3600, `the idle ceiling must default to 3600s (got ${idle && idle[1]})`)
  const overridden = engineModule.buildPersistentOfflineWorkerScript(path.join(dir, 'work2'), { runToken: '-x', maxIdleSeconds: 120 })
  assert(/^MAX_IDLE_SECONDS = 120$/m.test(overridden), 'an explicit idle ceiling must be honoured')
  // 编译错误数：worker 的 stdio 只进日志，所以宿主必须能把那段尾巴读回来。
  const engineSource = fs.readFileSync(enginePath, 'utf8')
  assert(engineSource.includes('readWorkerLogChunk(worker, logOffsets)'),
    'the host must read the worker stdio log so a compile summary on the console is not lost')
  // Python 侧真的能编译。
  const python = findPython()
  if (python) {
    for (const name of ['single.py', 'worker.py']) {
      const compile = spawnSync(python[0], [...python.slice(1), '-m', 'py_compile', path.join(dir, name)], { stdio: 'inherit' })
      assert.strictEqual(compile.status, 0, `${name} must compile`)
    }
  }
  report.python = { compiled: Boolean(python), persistFlag: true, idleSeconds: Number(idle[1]) }
}

function findPython () {
  for (const candidate of [['python'], ['py', '-3'], ['python3']]) {
    const probe = spawnSync(candidate[0], [...candidate.slice(1), '--version'], { stdio: 'ignore' })
    if (probe.status === 0) return candidate
  }
  return null
}

async function main () {
  const report = {}
  verifyGeneratedPython(report)

  // ── 1+2. one open project, reused across actions; tree cached for identical bytes ─────
  {
    const root = makeRoot()
    const source = makeFixture(root)
    const state = {}
    const spawner = makeWorkerEmulator(state)
    const engine = makeEngine(root, { persistentScriptEngine: true, offlineSpawnProcess: spawner })
    const bound = engine.bindProject({ sourcePath: source })
    const workCopy = path.join(jobDirOf(root, bound.jobId), 'snapshots', 'working.project')

    // 绑定必须后台预开工作副本（它让紧接着的第一次读取只需走对象树）。
    await waitFor(() => state.commands.some((item) => item.action === 'preload-project'))
    const preload = state.commands.find((item) => item.action === 'preload-project')
    assert(preload, 'binding must pre-open the working copy in the background')
    assert.strictEqual(spawner.state.spawns.length, 1, 'pre-warming plus pre-opening must start exactly one worker')

    const auditLines = () => fs.readFileSync(path.join(root, 'logs', 'codesys-timings.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    await waitFor(() => auditLines().some((line) => line.action === 'preload-project'))
    const preloadLine = auditLines().find((line) => line.action === 'preload-project')
    assert(preloadLine, 'the pre-open must leave its own audit line instead of hiding inside the read')
    assert.strictEqual(Number(preloadLine.openMs), 300, `the pre-open must report the open it paid (got ${preloadLine.openMs})`)
    assert(Object.prototype.hasOwnProperty.call(preloadLine, 'treeReused'), 'every audited record keeps the fixed field set')

    const first = await engine.execute('inspect-project', { jobId: bound.jobId })
    assert.strictEqual(first.timings.projectReused, 1, 'the first read must reuse the project the pre-open already opened')
    assert.strictEqual(first.timings.openMs, 0, 'a reused project must cost 0 ms of openMs')
    assert.strictEqual(first.timings.treeReused, 0, 'the first tree walk is real work')
    assert(first.timings.treeMs > 0, 'the first tree walk must report its cost')

    // The host keeps its own result caches (memory + disk, keyed by the source sha). A repeat
    // read normally hits THOSE (14 ms on the real machine) and never reaches the worker, so
    // the worker-side tree cache has to be measured with them out of the way -- which is
    // exactly the "真读（把缓存临时挪开）" case.
    engine.inspectCache.clear()
    fs.rmSync(path.join(root, 'cache', 'codesys-inspect'), { recursive: true, force: true })
    const second = await engine.execute('inspect-project', { jobId: bound.jobId })
    assert.strictEqual(second.timings.cachedRead, false, 'the second read must really go to the worker for this measurement')
    assert.strictEqual(second.timings.projectReused, 1, 'a second read of an unchanged project must reuse the open project')
    assert.strictEqual(second.timings.openMs, 0, 'no openMs may be paid twice for the same bytes')
    assert.strictEqual(second.timings.treeReused, 1, 'an unchanged file must reuse the cached object tree')
    assert.strictEqual(second.timings.treeMs, 0, 'a reused tree must cost 0 ms of treeMs')
    assert.strictEqual(second.timings.pythonReused, 1, 'both reads must reuse the one persistent worker')
    assert.strictEqual(state.spawns.length, 1, `the whole session must use one CODESYS worker (spawned ${state.spawns.length})`)

    // ... and with the caches left in place the host answer must come straight from memory.
    const third = await engine.execute('inspect-project', { jobId: bound.jobId })
    assert.strictEqual(third.timings.cachedRead, true, 'a repeat read of unchanged bytes must be answered from the host cache')
    assert(third.timings.totalMs < 50, `the cached read must be almost free (took ${third.timings.totalMs}ms)`)

    // A confirmed write must reuse the open project too -- that is where the real machine
    // measured openMs=20235 + pythonStartMs=11861 for a 909 ms edit.
    const write = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
    assert.strictEqual(write.timings.projectReused, 1, 'a confirmed write must reuse the project already open in the worker')
    assert.strictEqual(write.timings.openMs, 0, 'a confirmed write must not re-open the project')
    assert.strictEqual(write.timings.applyMs, 40, 'the edit itself must be reported from the Python side')
    report.reuse = {
      firstRead: { openMs: first.timings.openMs, treeMs: first.timings.treeMs, projectReused: first.timings.projectReused },
      secondRead: { openMs: second.timings.openMs, treeMs: second.timings.treeMs, projectReused: second.timings.projectReused, treeReused: second.timings.treeReused },
      cachedReadMs: third.timings.totalMs,
      write: { openMs: write.timings.openMs, applyMs: write.timings.applyMs, projectReused: write.timings.projectReused },
      spawns: state.spawns.length,
      commands: state.spawns[0].commands,
      preloadOpenMs: Number(preloadLine.openMs),
    }

    // ── 3. the host lets go of the file BEFORE it overwrites it ────────────────────────
    // An external save changes the source sha, so the next action has to rebuild the working
    // copy. If the worker still held that file, the copy would fail on Windows; the release
    // must therefore be served while the working copy still holds the OLD bytes.
    const beforeSha = sha12(workCopy)
    fs.appendFileSync(source, '\n# external edit\n')
    const commandsBefore = state.commands.length
    const afterExternal = await engine.execute('inspect-project', { jobId: bound.jobId })
    const served = state.commands.slice(commandsBefore)
    const releaseIndex = served.findIndex((item) => item.action === 'release-project')
    assert(releaseIndex >= 0, `an overwrite of a held working copy must be preceded by a release (served: ${served.map((item) => item.action).join(', ')})`)
    assert.strictEqual(served[releaseIndex].workCopySha, beforeSha,
      'the release must be served while the working copy still holds the old bytes (i.e. before the host overwrites it)')
    assert.strictEqual(sha12(workCopy) !== beforeSha, true, 'the working copy must have been rebuilt from the new source')
    assert.strictEqual(afterExternal.timings.projectReused, 0, 'changed bytes must NOT be served from the stale open project')
    assert.strictEqual(afterExternal.timings.openMs, 300, 'changed bytes must really be re-opened in CODESYS')
    assert.strictEqual(engine.offlineWorkerHeldPath(), workCopy, 'the worker must report the project it holds')

    // ── 4. a compile whose output only exists in the worker stdio log ──────────────────
    // The emulator answers with `messages: []` (exactly what the real worker did) and writes
    // the real console text to its stdout log. The host must recover the summary line.
    state.logLines = { build: ['编译: Text: C0: 编译代码 ...', '编译: Text: 错误: C0032: 无法转换类型', '编译: Text: 警告: C0180: 变量未使用', '编译: Text: C0: 编译完成 -- 2错误,1警告'] }
    const failed = await engine.execute('apply-and-build', { jobId: bound.jobId, changes: CHANGES, confirmed: true, includeTree: true })
    assert(failed.compile, 'the compile family must always come back with a structured result')
    assert.strictEqual(failed.compile.errorCountKnown, true, `the console summary must make the error count known (got ${JSON.stringify(failed.compile)})`)
    assert.strictEqual(failed.compile.errorCount, 2, `the real summary says 2 errors (got ${failed.compile.errorCount})`)
    assert.strictEqual(failed.compile.warningCount, 1, `the real summary says 1 warning (got ${failed.compile.warningCount})`)
    assert.strictEqual(failed.compile.succeeded, false, 'a failed compile must NOT be reported as success')
    assert.strictEqual(failed.payload.errorCount, 2, 'the payload the workbench reads must carry the real count')
    // ── 计数口径（本轮）：总结行的数字与"正文里显示出来的条数"必须**分开**回传 ──────────────
    // 这里正文只有 2 条明细（1 Error + 1 Warning），而总结行说的是 `2错误,1警告`。
    // 现场报障是相反的方向（总结 28 条警告 / 正文只显示 7 条），两者都要能被界面区分出来，
    // 所以两套数字、各自来源、以及"不一致"这个事实都必须过桥；只加强上面的断言，不删弱。
    assert.strictEqual(failed.compile.summaryErrorCount, 2, '总结行原话里的错误数必须单独保留')
    assert.strictEqual(failed.compile.summaryWarningCount, 1, '总结行原话里的警告数必须单独保留')
    assert.strictEqual(failed.compile.detailErrorCount, 1, '正文里显示出来的错误条目数必须单独保留')
    assert.strictEqual(failed.compile.detailWarningCount, 1, '正文里显示出来的警告条目数必须单独保留')
    assert.strictEqual(failed.compile.warningCountSource, 'codesys-summary', '警告数以总结行为准')
    assert.strictEqual(failed.compile.countsDiffer, true,
      '总结行(2/1) 与正文条目数(1/1) 不同 ⇒ 必须显式标成"不一致"，界面才能两个都显示')
    assert.strictEqual(failed.compile.warningConflict, false,
      'warningConflict 只标"正文多于总结"这个方向（这里相等，所以是 false）')
    assert.strictEqual(failed.payload.summaryWarningCount, 1, 'payload 也必须带总结行的警告数')
    assert.strictEqual(failed.payload.detailWarningCount, 1, 'payload 也必须带正文条目数')
    assert.strictEqual(failed.payload.summaryErrorCount, 2, 'payload 也必须带总结行的错误数')
    assert.strictEqual(failed.payload.warningCountSource, 'codesys-summary', 'payload 也必须带来源')
    assert.strictEqual(failed.payload.compileSummary, failed.compile.summary.raw,
      'payload 里的总结行原文必须与结构化结果里那一份一致')
    assert(failed.payload.messages.length >= 2, `the diagnostics must reach the drawer (got ${failed.payload.messages.length})`)
    assert(failed.payload.messages.some((item) => /C0032/.test(String(item.text))), 'the C0032 detail line must survive')
    assert(failed.payload.messages.some((item) => /C0180/.test(String(item.text))), 'the warning detail line must survive too')
    report.compile = { errorCount: failed.compile.errorCount, warningCount: failed.compile.warningCount, known: failed.compile.errorCountKnown, status: failed.status }

    // No console output at all must stay "unknown", never silently 0.
    state.logLines = {}
    const silent = await engine.execute('build', { jobId: bound.jobId })
    assert.strictEqual(silent.compile.errorCountKnown, false, 'without any console output the count must stay unknown')
    assert.strictEqual(silent.compile.errorCount, null, 'unknown must never be flattened to 0')
    assert.strictEqual(silent.compile.succeeded, null, 'unknown must never be flattened to "passed"')
    // 计数口径（本轮）：警告数同样不许退化成 0，来源也必须如实说"unknown"。
    assert.strictEqual(silent.compile.warningCount, null, '没有输出时警告数也必须是未知，不是 0')
    assert.strictEqual(silent.compile.errorCountSource, 'unknown', '来源必须如实标 unknown')
    assert.strictEqual(silent.compile.warningCountSource, 'unknown', '警告数的来源也必须如实标 unknown')
    assert.strictEqual(silent.compile.summaryErrorCount, null, '没有总结行 ⇒ 总结行的数字是 null，不是 0')
    assert.strictEqual(silent.compile.countsDiffer, false, '没有总结行就没有"不一致"可言')
    report.silentBuild = { errorCount: silent.compile.errorCount, succeeded: silent.compile.succeeded }

    await engine.stopOfflineWorker('contract')
  }

  process.stdout.write(
    'codesys scriptengine project-reuse contract passed ' +
    `(python compiled=${report.python.compiled} idleSeconds=${report.python.idleSeconds}; ` +
    `pre-open openMs=${report.reuse.preloadOpenMs}; ` +
    `first read openMs=${report.reuse.firstRead.openMs} treeMs=${report.reuse.firstRead.treeMs} projectReused=${report.reuse.firstRead.projectReused}; ` +
    `second read openMs=${report.reuse.secondRead.openMs} treeMs=${report.reuse.secondRead.treeMs} projectReused=${report.reuse.secondRead.projectReused} treeReused=${report.reuse.secondRead.treeReused}; ` +
    `write openMs=${report.reuse.write.openMs} applyMs=${report.reuse.write.applyMs} projectReused=${report.reuse.write.projectReused}; ` +
    `worker spawns=${report.reuse.spawns} commands=${report.reuse.commands}; ` +
    `compile errorCount=${report.compile.errorCount} warningCount=${report.compile.warningCount} known=${report.compile.known} status=${report.compile.status}; ` +
    `silent build errorCount=${report.silentBuild.errorCount} succeeded=${report.silentBuild.succeeded})\n`,
  )
}

main()
  .then(() => { for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } } process.exit(0) })
  .catch((error) => {
    for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } }
    console.error(`codesys scriptengine project-reuse contract failed: ${error.message}`)
    process.exit(1)
  })
