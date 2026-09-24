'use strict'
// Contract: CODESYS instances launched by TaskHive must not outlive it.
//
// Field report: "之前由程序打开的 codesys 工程关闭程序后会一直在留存后台" — the
// panel deliberately detaches the instance ("只有你手动关闭才会结束") and nothing
// closed it on exit, so instances accumulated across restarts (the machine was
// seen running three at once).
//
// The decision logic is pure and exercised here; main.js only executes the
// verdict. Safety rules asserted: never an instance with unsaved changes, never
// an unverifiable PID, never a recycled PID.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { CodesysLaunchedRegistry, classifyLaunchedInstance, processStartMatches, PID_REUSE_TOLERANCE_MS } = require('../app/codesys-launched-registry')

const DIALOG_TITLE = 'fourDofPlatform -ui+io调整阻尼测试.project - CODESYS '
const DIRTY_TITLE = 'fourDofPlatform -ui+io调整阻尼测试.project* - CODESYS '

// ── The verdict ─────────────────────────────────────────────────────────────
assert.deepStrictEqual(
  classifyLaunchedInstance({ pid: 1, launchedAtMs: 1000 }, { running: false }),
  { action: 'skip', reason: 'already-gone' },
  'a process that already exited needs no action',
)
assert.deepStrictEqual(
  classifyLaunchedInstance({ pid: 1, launchedAtMs: 1000 }, { running: true, window: null, startedAtMs: 1000 }),
  { action: 'keep', reason: 'no-window' },
  'an instance with no verifiable window must be left alone',
)
assert.deepStrictEqual(
  classifyLaunchedInstance({ pid: 1, launchedAtMs: 1000 }, { running: true, window: { title: DIRTY_TITLE }, startedAtMs: 1000 }),
  { action: 'keep', reason: 'unsaved-changes' },
  'a project with unsaved changes must never be closed',
)
assert.deepStrictEqual(
  classifyLaunchedInstance({ pid: 1, launchedAtMs: 1000 }, { running: true, window: { title: DIALOG_TITLE }, startedAtMs: 1000 }),
  { action: 'close', reason: 'launched-by-taskhive' },
  'a saved instance launched by TaskHive is closed on exit',
)
assert.deepStrictEqual(
  classifyLaunchedInstance({ pid: 1, launchedAtMs: 1000 }, { running: true, window: { title: DIALOG_TITLE }, startedAtMs: 1000 + PID_REUSE_TOLERANCE_MS + 1 }),
  { action: 'keep', reason: 'pid-reused' },
  'a PID that no longer matches the recorded launch time must not be killed',
)
assert.strictEqual(processStartMatches(1000, -1), true, 'an unknown start time falls back to the window check')
assert.strictEqual(processStartMatches(1000, 1000), true)
assert.strictEqual(processStartMatches(1000, 1000 + 60 * 1000), true, 'small drift is tolerated')
assert.strictEqual(processStartMatches(1000, 0), true, 'a missing record cannot veto cleanup')
assert.deepStrictEqual(classifyLaunchedInstance({}, { running: true }), { action: 'skip', reason: 'invalid-record' })

// ── The registry ────────────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-launched-'))
let nowValue = 1_700_000_000_000
const registry = new CodesysLaunchedRegistry(root, { now: () => nowValue })
assert.deepStrictEqual(registry.pending(), [], 'a fresh install has nothing to sweep')

registry.record({ pid: 4242, exePath: 'C:\\CODESYS\\CODESYS.exe', profile: 'CODESYS V3.5 SP20 Patch 4' })
const pending = registry.pending()
assert.strictEqual(pending.length, 1, 'a launched instance must be remembered')
assert.strictEqual(pending[0].pid, 4242)
assert.strictEqual(pending[0].launchedAtMs, nowValue)
assert.strictEqual(pending[0].exePath, 'C:\\CODESYS\\CODESYS.exe')

// Re-launching the same PID must not duplicate the record.
nowValue += 5000
registry.record({ pid: 4242, profile: 'p' })
registry.record({ pid: 4343, profile: 'p' })
assert.deepStrictEqual(registry.pending().map((entry) => entry.pid).sort((a, b) => a - b), [4242, 4343])

// A clean exit retires everything.
registry.markCleanExit()
assert.deepStrictEqual(registry.pending(), [], 'after a clean exit there is nothing left to sweep')
// ...and a later launch re-opens the sweep window.
registry.record({ pid: 4444, profile: 'p' })
assert.deepStrictEqual(registry.pending().map((entry) => entry.pid), [4444], 'a new launch must be sweepable again')

// A crash leaves the record behind for the next start.
const crashed = new CodesysLaunchedRegistry(root)
assert.strictEqual(crashed.pending().length, 1, 'a session that never exited cleanly leaves its instance recorded')

// The wire-up in main.js: record on launch, sweep on startup, close on exit.
const main = fs.readFileSync(path.resolve(__dirname, '../app/main.js'), 'utf8')
assert(main.includes("codesysLaunchedRegistry?.record({ pid: launch.pid, exePath: doctor.exePath, profile: doctor.profile })"), 'the launch path must record the instance')
assert(main.includes("void closeLaunchedCodesysInstances('startup-sweep', leftoverCodesysInstances)"), 'startup must sweep crash leftovers')
assert(main.includes("await closeLaunchedCodesysInstances('application-shutdown', codesysLaunchedRegistry?.pending() || [])"), 'exit must close the launched instances')
assert(main.includes('const decision = classifyLaunchedInstance(record, {'), 'the close path must use the tested verdict')
assert(main.includes('if (quitCleanupDone) return;'), 'the cleanup must be allowed to finish before the app exits')
assert(main.includes('event.preventDefault();'), 'before-quit must hold the quit while cleanup runs')
assert(main.includes('await processStartTimeMs(pid)'), 'the PID-reuse guard must compare process start times')
// The documented lifecycle changed with the behaviour: a launched instance still
// survives surface/session switches, but it no longer outlives TaskHive.
assert(main.includes('persistsAfterTaskHiveExit: false'), 'the lifecycle contract must state that launched instances do not outlive TaskHive')
assert(main.includes('taskHiveMayCloseProgram: true'), 'the lifecycle contract must allow TaskHive to close what it launched')
assert(main.includes('closePolicy: \'taskhive-closes-launched-instances-unless-unsaved\''), 'the close policy must be explicit')
assert(main.includes('codesys.externalProgram.launchedProgramClosePolicyLabel'), 'the packaged probe must assert the new label')
const renderer = fs.readFileSync(path.resolve(__dirname, '../app/renderer/renderer.js'), 'utf8')
assert(renderer.includes('退出 TaskHive 时会自动关闭本插件启动的实例（工程有未保存改动时保留）'), 'the panel button must state the real policy')

fs.rmSync(root, { recursive: true, force: true })
process.stdout.write('codesys launched-instance cleanup contract passed\n')
