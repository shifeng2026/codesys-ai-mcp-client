'use strict'

// Contract runner.
//
// Every `*.js` file in this directory (except this runner) is one contract.
// Each one runs in its own Node process with `cwd` pinned to the app root and
// `TASKHIVE_ROOT` pointing at it (see the note further down), so a contract
// always sees the same app root no matter where the runner was invoked from.
//
// Two properties of the runner itself are part of the contract, because a test
// runner that lies about its results is worse than no runner at all:
//
//   1. A hung test must not hang the suite. Before this, the loop waited
//      forever on `spawnSync` with no timeout, so ONE never-settling contract
//      froze the whole run with no output — the suite could neither pass nor
//      fail, and a reader could not tell which test was stuck.
//   2. The run must end with a per-test report (status + elapsed ms) and a
//      total line stating how many ran / passed / failed / timed out. Exit code
//      alone says "something, somewhere, failed" and nothing more.
//
// The summary is printed on success AND on failure. Exit code is 0 only when
// every contract exited 0 within its budget; a timed-out contract is a failure
// even though its own process never got to report one.

const { readdirSync, statSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const appRoot = join(__dirname, '..')

// Default per-test budget. Override for a whole run with
// `TASKHIVE_CONTRACT_TIMEOUT_MS`, or per test through TIMEOUT_OVERRIDES below.
const DEFAULT_TIMEOUT_MS = 120000
const configured = Number(process.env.TASKHIVE_CONTRACT_TIMEOUT_MS)
const defaultTimeoutMs = Number.isFinite(configured) && configured > 0
  ? Math.floor(configured)
  : DEFAULT_TIMEOUT_MS

// Contracts that legitimately need more than the default budget (they drive a
// real Electron smoke/probe run or a real CODESYS process). Every entry here
// must say WHY it is slow; an unexplained override is a hung test in disguise.
//
// These two are NOT slow. They are the two contracts whose reported failure mode
// under concurrent load has been a runner `[TIMEOUT]`, while each one runs in a
// fraction of the default budget:
//
//   measured (T229; standalone and 3 trees in parallel, 3 rounds each):
//     codesys-online-gate-contract.js          109-143 ms  (0.1% of 120 s)
//     codesys-online-reconnect-behaviour.js   2242-2288 ms (2% of 120 s; measured
//       4865-4903 ms before — ≈4.0 s of that was one grace timer leaked by the
//       production `stop()` race, removed by bounding the contract's own graceMs,
//       not by removing any work or assertion)
//
// A contract that needs 0.1% / 4% of its budget cannot reach it by being slow, so a
// timeout there is a process-level stall (paging, or a filter driver inside file
// I/O, while several suites run at once) — observed once at 120 s under exactly
// that concurrent-agent load. The override is stall headroom, NOT tolerance for
// regressions: every assertion still fails in milliseconds, and both contracts now
// print their own staged timings, so a genuine regression can never be presented
// as "slow". The reconnect number sits above that contract's own worst case
// (~75 s: the sum of its explicit internal deadlines) and the gate number only
// covers the stall class that actually produced the timeout.
const TIMEOUT_OVERRIDES = {
  'codesys-online-gate-contract.js': 300000,
  'codesys-online-reconnect-behaviour.js': 240000,
}

const tests = readdirSync(__dirname)
  .filter((name) => name.endsWith('.js') && name !== 'run-contracts.js')
  // A subdirectory named `*.js` would not be runnable; only real files are tests.
  .filter((name) => {
    try { return statSync(join(__dirname, name)).isFile() } catch { return false }
  })
  .sort()

const results = []
for (const test of tests) {
  const budget = TIMEOUT_OVERRIDES[test] || defaultTimeoutMs
  const startedAt = Date.now()
  // Pin every contract to the app root instead of whatever directory the caller
  // happened to be in. `taskhive-codex-model` resolves its model catalog from
  // `process.env.TASKHIVE_ROOT || process.cwd()`, so invoking this runner as
  // `node resources/app/tests/run-contracts.js` from the checkout root made
  // `model-adapter-compatibility-contract.js` fail with
  //   LlmError: Catalog model unavailable: anthropic-api/claude-sonnet-4-5
  // — a false failure that says nothing about the code under test. `npm test`
  // already ran with the app root as cwd; this makes that implicit contract
  // explicit and holds for any invocation path.
  const result = spawnSync(process.execPath, [join(__dirname, test)], {
    stdio: 'inherit',
    cwd: appRoot,
    env: { ...process.env, TASKHIVE_ROOT: appRoot },
    // spawnSync kills the child once this budget is exceeded and reports
    // ETIMEDOUT. The kill is NOT recursive: on Windows a grandchild started by
    // the contract (e.g. an Electron smoke run) can survive it, so a contract
    // that leaks child processes still needs fixing on its own side.
    timeout: budget,
    killSignal: 'SIGKILL',
  })
  const elapsedMs = Date.now() - startedAt
  const timedOut = result.error?.code === 'ETIMEDOUT'
  const spawnFailed = Boolean(result.error) && !timedOut
  const passed = !timedOut && !spawnFailed && result.status === 0
  results.push({ test, passed, timedOut, spawnFailed, elapsedMs, budget, result })
}

const pad = (value, width) => String(value).padEnd(width)
const nameWidth = results.reduce((max, entry) => Math.max(max, entry.test.length), 0)
const lines = []
for (const entry of results) {
  if (entry.timedOut) {
    lines.push(`[TIMEOUT] ${pad(entry.test, nameWidth)}  ${entry.elapsedMs}ms (budget ${entry.budget}ms, killed — a process-level stall, not a slow assertion; a regression in a contract prints its own [自测]/[诊断] line before this)`)
  } else if (entry.spawnFailed) {
    lines.push(`[FAIL]    ${pad(entry.test, nameWidth)}  ${entry.elapsedMs}ms (spawn error: ${entry.result.error?.message || 'unknown'})`)
  } else if (entry.passed) {
    lines.push(`[PASS]    ${pad(entry.test, nameWidth)}  ${entry.elapsedMs}ms`)
  } else {
    const detail = entry.result.signal
      ? `killed by ${entry.result.signal}`
      : `exit code ${entry.result.status}`
    lines.push(`[FAIL]    ${pad(entry.test, nameWidth)}  ${entry.elapsedMs}ms (${detail})`)
  }
}

const run = results.length
const passedCount = results.filter((entry) => entry.passed).length
const timedOutCount = results.filter((entry) => entry.timedOut).length
const failedCount = run - passedCount - timedOutCount

// The summary must be printed even when contracts failed — that is the whole
// point of it. Nothing here throws before this point.
process.stdout.write(`\n${lines.join('\n')}\n`)
process.stdout.write(`contracts: ${run} run, ${passedCount} passed, ${failedCount} failed, ${timedOutCount} timed out\n`)

process.exitCode = passedCount === run ? 0 : 1
