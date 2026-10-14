'use strict'
// Scenario (T183 item 4, CLIENT half): a confirmed write must show "已落盘/已提交"
// as soon as the apply phase commits, and collect the offline compile afterwards
// through a **read-only** `build-status` poll.
//
// The engine half (deferBuild / build-status) is pinned by
// `codesys-scriptengine-speed-contract.js`. This file drives the REAL
// `CodesysWorkbench` component (see `lib/workbench-driver`) against a stub host
// that behaves like the real one: the write returns `buildPending + buildId`
// immediately, and every `build-status` request stays IN FLIGHT until THIS test
// releases it. That is what makes the claims measurable instead of lucky:
//
//   * "已落盘 is on screen before the compile finished" cannot be an artefact of
//     a fast compile — the compile is still running, unresolved, by construction;
//   * "never more than one request in flight" is proven by firing the resume
//     event while a request is deliberately held open;
//   * "the poll stops at its terminal state" is measured by then advancing many
//     more simulated seconds and firing another resume event.
//
// Also covered: pause while the page is hidden, resume on visibilitychange,
// unmount cleanup, the failed-compile wording, and the default one-IPC path for
// a host that answers the write without a build id.

const assert = require('node:assert')
const { createWorkbenchDriver } = require('./lib/workbench-driver')

const SOURCE_PATH = 'C:/projects/demo.project'
const JOB_ID = 'direct-t183'
const BASELINE_SHA = 'a'.repeat(64)
const AFTER_WRITE_SHA = 'b'.repeat(64)

const DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', 'END_VAR'].join('\n')
const EDITED_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  y : INT;', 'END_VAR'].join('\n')

function makeObjects () {
  return [{
    name: 'PLC_PRG',
    guid: 'guid-plc-prg',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration: DECLARATION,
    implementation: 'x := x + 1;',
    path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
  }]
}

const RUNNING = { ok: true, action: 'build-status', jobId: JOB_ID, buildId: 'build-7', state: 'running', durationMs: 0, buildMs: 0, errorCount: null, messages: [] }
const DONE = {
  ok: true,
  action: 'build-status',
  jobId: JOB_ID,
  buildId: 'build-7',
  state: 'done',
  durationMs: 1200,
  buildMs: 900,
  errorCount: 0,
  warningCount: 1,
  messageCount: 1,
  messages: [{ severity: 'warning', text: 'C0199: 测试用警告' }],
}

// A host that speaks the deferred protocol. `build-status` never answers on its
// own: the test decides both WHEN it answers and WHAT it answers.
function makeDeferredHost (options = {}) {
  const state = {
    ipc: [],
    buildStatusCalls: [],
    inFlight: 0,
    maxInFlight: 0,
    // `returnBuildId: false` = an engine/host that answers the write as before.
    returnBuildId: options.returnBuildId !== false,
    held: [],
    // The sha the SOURCE FILE on disk currently hashes to. This has to be state, not a
    // constant: the real `diff` re-hashes the file itself (`scriptengine.cjs` diff():
    // `sha256(job.projectPath)`, no ScriptEngine), so after a confirmed write the disk
    // really does hold the post-write bytes. With a constant BASELINE_SHA the stub would
    // contradict the `currentSha256` its own write just returned, i.e. it would claim an
    // external save landed in the middle of our own write — which is not this test's
    // scenario (and is a scenario the workbench must react to, deliberately).
    diskSha: BASELINE_SHA,
  }
  const host = {
    state,
    inFlightCount: () => state.held.length,
    // Answer the oldest held request (a held request is one that is really in
    // flight: the component is awaiting it).
    release (value) {
      const next = state.held.shift()
      if (!next) throw new Error('no build-status request is currently in flight')
      next(value || RUNNING)
    },
    async run (action, input) {
      state.ipc.push({ action, input })
      if (action === 'bind-project') return { sourcePath: SOURCE_PATH, jobId: JOB_ID, writeAvailable: true, writeBlockReason: '', baselineSha256: BASELINE_SHA }
      if (action === 'inspect-project') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: makeObjects() } }
      if (action === 'diff') {
        return { ok: true, action: 'diff', jobId: JOB_ID, currentSha256: state.diskSha, baselineSha256: BASELINE_SHA, changed: state.diskSha !== BASELINE_SHA }
      }
      if (action === 'apply-and-build') {
        // The write replaces the file on disk, so the very next `diff` must answer with
        // the post-write bytes — that is what makes the write's own baseline advance
        // instead of looking like somebody else saved the project.
        state.diskSha = AFTER_WRITE_SHA
        return state.returnBuildId
          ? { ok: true, status: 'complete', currentSha256: AFTER_WRITE_SHA, buildPending: true, buildId: 'build-7', payload: { changeCount: 1 } }
          : {
            ok: true,
            status: 'complete',
            currentSha256: AFTER_WRITE_SHA,
            payload: { complete: true, textTruncated: false, objects: makeObjects(), messages: [{ severity: 'error', text: 'E1234: 测试用错误' }], errorCount: 1, warningCount: 0, changeCount: 1 },
          }
      }
      if (action === 'build-status') {
        state.buildStatusCalls.push({ buildId: String(input?.buildId || '') })
        state.maxInFlight = Math.max(state.maxInFlight, state.held.length + 1)
        state.inFlight = state.held.length + 1
        const answer = await new Promise((resolve) => state.held.push(resolve))
        state.inFlight = state.held.length
        return answer
      }
      return { status: 'complete', payload: {} }
    },
  }
  return host
}

function makeDriver (host, options = {}) {
  return createWorkbenchDriver({
    objects: makeObjects(),
    sourcePath: SOURCE_PATH,
    jobId: JOB_ID,
    ...options,
    taskhive: {
      currentCodesysProject: async () => ({ found: true, sourcePath: SOURCE_PATH, detection: 'monitored-window', writeAvailable: true, activeGui: true }),
      runCodesysScriptEngineAction: (action, input) => host.run(action, input),
      codesysOnlineStatus: async () => ({ ok: true, running: false }),
      codesysScriptEngineStatus: async () => ({ ready: true, version: 'V3.5 SP20', missing: [] }),
    },
  })
}

function statusTextOf (driver) {
  const value = driver.statusText()
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('') : String(value)
}

// The deferred-build poll is the ONLY 1-second timer this scenario can have (the
// busy / scan / online-busy counters are 1 s intervals but only exist while busy,
// and the workbench is idle here). Reading the timer table is how "the poll left
// no timer behind" is measured instead of asserted about a source string.
function pollTimers (driver) {
  return driver.scene.timers.filter((timer) => !timer.cleared && timer.delay === 1000)
}

function clickConfirmWrite (driver) {
  driver.typeInEditor('declaration', EDITED_DECLARATION)
  const review = driver.find((props) => props['data-codesys-review-accepted'] === 'true')
  assert(review, 'the review checkbox must be rendered once there are pending changes')
  review.props.onChange({ target: { checked: true } })
  driver.render()
  const button = driver.find((props) => props['data-codesys-confirm-write'] === 'true')
  assert(button, 'the confirm-write button must be rendered')
  assert.strictEqual(button.props.disabled, false, 'the confirm button must be enabled once the review is accepted')
  const startedAt = Date.now()
  button.props.onClick()
  return startedAt
}

async function deferredLifecycle () {
  const host = makeDeferredHost()
  const driver = makeDriver(host)
  await driver.settle()
  assert.deepStrictEqual(driver.treeRowNames(), ['PLC_PRG'], 'the workbench must have read the project before the write')

  const clickedAt = clickConfirmWrite(driver)
  await driver.settle(2)
  const statusAfterWrite = statusTextOf(driver)
  const elapsedToLanded = Date.now() - clickedAt
  assert.strictEqual(host.state.buildStatusCalls.length, 1, 'the deferred write must be followed by exactly one build-status request')
  assert.strictEqual(host.inFlightCount(), 1, 'that first request must be in flight (the test holds it open)')
  assert(
    statusAfterWrite.includes('已落盘并提交回源工程'),
    `the landed result must be on screen while the compile is still running (status was ${JSON.stringify(statusAfterWrite)})`,
  )
  assert(!statusAfterWrite.includes('后台编译完成'), 'the compile must not be reported as finished while it is still running')
  assert(elapsedToLanded < 1000, `the landed result must appear without waiting for the compile (took ${elapsedToLanded}ms)`)

  // The write really was ONE confirmed composite with deferBuild, and the sha
  // guard (T167/T170) ran before it.
  const writeCall = host.state.ipc.find((item) => item.action === 'apply-and-build')
  assert(writeCall, 'the write must go through apply-and-build')
  assert.strictEqual(writeCall.input.confirmed, true, 'the write must still be explicitly confirmed')
  assert.strictEqual(writeCall.input.deferBuild, true, 'the write must ask for the deferred compile')
  assert.strictEqual(writeCall.input.includeTree, false, 'the deferred write must not pay for the post-write tree (it is re-read separately)')
  const diffIndex = host.state.ipc.findIndex((item) => item.action === 'diff')
  const writeIndex = host.state.ipc.indexOf(writeCall)
  assert(diffIndex >= 0 && diffIndex < writeIndex, 'the "unsaved external change" sha guard must still run BEFORE the write')
  assert(host.state.ipc.every((item) => item.action !== 'build'), 'the separate `build` action must stay gone')

  // ── ONE request in flight at a time ───────────────────────────────────────
  // The resume event is fired while the first request is deliberately held open.
  // A poll without an in-flight guard would open a second one right here.
  driver.scene.fire('document', 'visibilitychange', {})
  await driver.settle(1)
  assert.strictEqual(host.state.buildStatusCalls.length, 1, 'a resume event must not stack a second request on top of an in-flight one')
  assert.strictEqual(host.inFlightCount(), 1, 'exactly one request may be in flight')

  host.release(RUNNING)
  // Two rounds: the first lets the released answer be processed (which arms the
  // next 1-second timer), the second fires that timer.
  await driver.settle(2)
  assert.strictEqual(host.state.buildStatusCalls.length, 2, 'a still-running compile must be re-checked one second later')
  assert.strictEqual(host.inFlightCount(), 1, 'the follow-up request must be in flight too')
  assert.strictEqual(host.state.maxInFlight, 1, 'there must never be more than one build-status request in flight')
  assert(host.state.buildStatusCalls.every((call) => call.buildId === 'build-7'), 'the poll must ask for the build id the write returned')
  assert(host.state.ipc.filter((item) => item.action === 'build-status').every((item) => item.input.jobId === JOB_ID), 'the poll must stay on the job the write used')

  // ── a hidden page pauses the poll (no request, and no timer left behind) ───
  driver.scene.document.visibilityState = 'hidden'
  host.release(RUNNING)
  await driver.settle(3)
  const callsWhileHidden = host.state.buildStatusCalls.length
  assert.strictEqual(pollTimers(driver).length, 0, 'a hidden workbench must not keep the poll timer alive')
  assert.strictEqual(host.inFlightCount(), 0, 'a hidden workbench must not have a request in flight')
  await driver.settle(3)
  assert.strictEqual(host.state.buildStatusCalls.length, callsWhileHidden, 'a hidden workbench must not keep asking the host')

  // ── becoming visible again resumes it ──────────────────────────────────────
  driver.scene.document.visibilityState = 'visible'
  driver.scene.fire('document', 'visibilitychange', {})
  await driver.settle(1)
  assert.strictEqual(host.state.buildStatusCalls.length, callsWhileHidden + 1, 'returning to the page must resume the deferred-build poll')
  assert.strictEqual(host.inFlightCount(), 1, 'the resumed poll must have exactly one request in flight')

  // ── the terminal state stops the poll and shows the compile output ─────────
  host.release(DONE)
  await driver.settle(3)
  const finalStatus = statusTextOf(driver)
  assert(finalStatus.includes('后台编译完成'), `the finished compile must be reported (status was ${JSON.stringify(finalStatus)})`)
  assert(finalStatus.includes('Build 错误 0'), `the final status must carry the engine error count (status was ${JSON.stringify(finalStatus)})`)
  assert(finalStatus.includes('警告 1'), `the final status must carry the engine warning count (status was ${JSON.stringify(finalStatus)})`)
  assert(finalStatus.includes('可使用恢复基线回滚'), 'the recovery baseline must stay advertised after a deferred write')
  const compileToggle = driver.find((props) => props['data-codesys-compile-toggle'] === 'true')
  assert(compileToggle, 'the compile output panel must be rendered from the deferred result')
  assert(String(compileToggle.children).includes('警告 1'), 'the compile panel must show the warning count the poll carried back')
  assert(driver.find((props) => props['data-codesys-compile-text'] === 'true'), 'a warning must open the compile output so the text is readable')
  assert(driver.treeChangeState('PLC_PRG') === 'written', 'the written object must keep its green "written" marker')

  // Terminal = stopped. More simulated time AND another resume event must
  // produce zero further requests (this is what catches a poll that keeps the
  // watch alive after `done`).
  const callsAtTerminal = host.state.buildStatusCalls.length
  assert.strictEqual(pollTimers(driver).length, 0, 'a finished deferred build must leave no timer behind')
  await driver.settle(8)
  driver.scene.fire('document', 'visibilitychange', {})
  await driver.settle(3)
  assert.strictEqual(
    host.state.buildStatusCalls.length,
    callsAtTerminal,
    `the poll must stop at the terminal state (grew from ${callsAtTerminal} to ${host.state.buildStatusCalls.length})`,
  )
  assert.strictEqual(host.inFlightCount(), 0, 'a finished deferred build must not leave a request in flight')

  driver.unmount()
  return {
    elapsedToLanded,
    buildStatusCalls: host.state.buildStatusCalls.length,
    callsWhileHidden: callsWhileHidden + 0,
    maxInFlight: host.state.maxInFlight,
    statusAfterWrite,
    finalStatus,
  }
}

// A failed background compile must be reported as "the write landed, the compile
// did not" — never as a failed write, and never as a silent success.
async function failurePath () {
  const host = makeDeferredHost()
  const driver = makeDriver(host)
  await driver.settle()
  clickConfirmWrite(driver)
  await driver.settle(2)
  host.release({ ok: true, action: 'build-status', jobId: JOB_ID, buildId: 'build-7', state: 'failed', error: 'E9999: CODESYS 编译进程退出', errorCount: null, messages: [] })
  await driver.settle(3)
  const status = statusTextOf(driver)
  assert(status.includes('已写入 1 个对象并提交回源工程'), `a compile failure must still say the write landed (status was ${JSON.stringify(status)})`)
  assert(status.includes('后台编译失败'), 'a compile failure must be reported as such')
  assert(status.includes('E9999'), 'the engine error text must reach the status line')
  assert(!status.includes('写入或编译失败'), 'the write-failure wording must not be reused for a write that succeeded')
  const callsAtFailure = host.state.buildStatusCalls.length
  assert.strictEqual(pollTimers(driver).length, 0, 'a failed compile must stop the poll')
  await driver.settle(8)
  assert.strictEqual(host.state.buildStatusCalls.length, callsAtFailure, 'a failed compile must not be re-polled')
  driver.unmount()
  return { status }
}

// Closing the workbench (unmount) must drop the poll instead of leaking a timer
// that keeps writing to a torn-down component.
async function unmountCleanup () {
  const host = makeDeferredHost()
  const driver = makeDriver(host)
  await driver.settle()
  clickConfirmWrite(driver)
  await driver.settle(2)
  assert.strictEqual(host.state.buildStatusCalls.length, 1, 'the poll must have started before the workbench is closed')
  assert.strictEqual(host.inFlightCount(), 1, 'the request must really be in flight when the workbench closes')
  driver.unmount()
  const callsAtUnmount = host.state.buildStatusCalls.length
  assert.strictEqual(pollTimers(driver).length, 0, 'unmounting must clear the poll timer')
  driver.scene.flushTimers()
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(host.state.buildStatusCalls.length, callsAtUnmount, 'a closed workbench must not keep polling the host')
  assert(host.state.maxInFlight <= 1, 'the in-flight guard must survive unmounting')
  return { callsAtUnmount }
}

// The default path (the host answers the write with no buildId — an engine that
// does not implement the split): ONE IPC to the end, compile output from the
// composite payload, and zero build-status traffic. Behaviour 字面未变.
async function defaultPath () {
  const host = makeDeferredHost({ returnBuildId: false })
  const driver = makeDriver(host)
  await driver.settle()
  clickConfirmWrite(driver)
  await driver.settle(6)
  const status = statusTextOf(driver)
  assert.strictEqual(host.state.buildStatusCalls.length, 0, 'the default path must not poll build-status at all')
  assert.strictEqual(host.state.ipc.filter((item) => item.action === 'apply-and-build').length, 1, 'the default path must stay one composite call')
  assert(status.includes('单次 ScriptEngine 完成写入+离线编译'), `the default path must keep its original wording (status was ${JSON.stringify(status)})`)
  assert(status.includes('Build 错误 1'), 'the default path must report the compile errors from the composite payload')
  const compileToggle = driver.find((props) => props['data-codesys-compile-toggle'] === 'true')
  assert(compileToggle && String(compileToggle.children).includes('错误 1'), 'the composite compile messages must still feed the compile panel')
  assert(pollTimers(driver).length === 0, 'the default path must not leave a polling timer behind')
  driver.unmount()
  return { status }
}

async function main () {
  const lifecycle = await deferredLifecycle()
  const failure = await failurePath()
  const unmount = await unmountCleanup()
  await defaultPath()
  process.stdout.write(
    'codesys deferred-build poll behaviour passed ' +
    `(click→已落盘 ${lifecycle.elapsedToLanded}ms while the compile was held open; ` +
    `build-status ${lifecycle.buildStatusCalls} calls, max in flight ${lifecycle.maxInFlight}; ` +
    `paused while hidden then resumed; terminal state stopped the poll; ` +
    `failed compile reported as "${failure.status.slice(0, 42)}…"; ` +
    `unmount stopped the poll at ${unmount.callsAtUnmount} calls; ` +
    'default path 0 build-status calls / 1 composite call)\n',
  )
}

main().catch((error) => {
  console.error(`codesys deferred-build poll behaviour failed: ${error.stack || error.message}`)
  process.exitCode = 1
})
