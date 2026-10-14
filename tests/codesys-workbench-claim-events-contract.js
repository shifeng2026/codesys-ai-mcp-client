'use strict'
// Contract (T183 item 5): the workbench must stop asking its host "any new
// proposals?" every 4 seconds and become event-driven, while keeping a slow
// fallback so a broken event source can never strand a queued proposal.
//
// Measured, not grepped: the REAL `CodesysWorkbench` component is mounted from
// the shipped DSH bundle with a virtual clock and a counting `fetch`, then 300
// simulated seconds are advanced in 4-second steps. The baseline is the SAME
// bundle text with `CODESYS_CLAIM_FALLBACK_MS` set to 0 — that is byte-for-byte
// the pre-change behaviour (a claim on every tick); the old bundle itself is not
// recoverable because `dsh/src/` is untracked in the repository.
//
// The pre-change cadence is therefore pinned as data: 75 ticks must produce 75
// claims in the baseline and at most 15 in the shipped bundle (30 s fallback =
// 10, plus a couple of event-forced claims), and a window focus must force one
// immediately instead of waiting for the fallback.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')

const { createWorkbenchDriver, clientFile } = require('./lib/workbench-driver')

const client = fs.readFileSync(clientFile, 'utf8')

// ── 1. the shape that makes the throttle possible ---------------------------
assert(client.includes('const CODESYS_CLAIM_FALLBACK_MS = 30000'), 'the claim fallback interval must exist and be low frequency')
assert(client.includes('const CODESYS_CLAIM_FALLBACK_MS = 4000') === false, 'the fallback must not be the old 4-second cadence')
assert(
  client.includes('if (options.force !== true && now - lastClaimAtRef.current < CODESYS_CLAIM_FALLBACK_MS) return'),
  'the poll tick must be throttled in memory before it reaches the host',
)
assert(client.includes('const lastClaimAtRef = React.useRef(0)'), 'the throttle needs the last real claim timestamp')
assert(client.includes('if (claimInFlightRef.current) return'), 'only one claim may be in flight at a time')
// The 4-second heartbeat itself is deliberately kept (and is pinned by
// codesys-workbench-link-contract.js): it only compares a timestamp now.
assert(client.includes('}, CODESYS_CLAIM_POLL_MS)'), 'the fallback heartbeat must stay wired to the claim')
assert(client.includes('if (!sessionId || !workbenchVisible) return undefined'), 'the claim must only run with a session on screen')
// Event sources: a new assistant message (chat revision), the session snapshot,
// returning to the window and switching to this surface.
assert(client.includes('void claimPendingProposalRef.current?.({ force: true })'), 'the event paths must force an immediate claim')
assert(client.includes("void claimPendingProposalRef.current?.({ force: true })\n      }, [conversation, chatRevision])"), 'a new chat revision must claim immediately')
assert(client.includes('window.addEventListener(\'focus\', recheck)'), 'returning to the window must be an event source')
assert(client.includes('document.addEventListener(\'visibilitychange\', recheck)'), 'becoming visible must be an event source')

// ── 2. measured cadence over 300 simulated seconds ---------------------------
const OBJECTS = [{
  name: 'PLC_PRG', guid: 'g-pou', type: '6f9dac99-8de1-4efc-8465-68ac443b7d08',
  declaration: 'PROGRAM PLC_PRG', implementation: '', hasDeclaration: true, hasImplementation: true,
  depth: 1, parentGuid: 'g-app', parentName: 'Application', path: ['Device', 'Application', 'PLC_PRG'], hasChildren: false,
}]
const SIM_SECONDS = 300
const TICK_SECONDS = 4
const TICKS = SIM_SECONDS / TICK_SECONDS

function makeClock (startMs) {
  const clock = { now: startMs }
  class VirtualDate extends Date {
    constructor (...args) {
      if (args.length === 0) super(clock.now)
      else super(...args)
    }

    static now () { return clock.now }
  }
  return { clock, VirtualDate }
}

function makeTaskhive () {
  return {
    currentCodesysProject: async () => ({ found: true, sourcePath: 'C:/projects/demo.project', detection: 'monitored-window', writeAvailable: true, activeGui: true }),
    runCodesysScriptEngineAction: async (action) => {
      if (action === 'bind-project') return { sourcePath: 'C:/projects/demo.project', jobId: 'direct-1', writeAvailable: true, writeBlockReason: '', baselineSha256: 'a'.repeat(64) }
      if (action === 'inspect-project') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(OBJECTS)) } }
      return { status: 'complete', payload: {} }
    },
    codesysOnlineStatus: async () => ({ ok: true, running: false }),
    codesysScriptEngineStatus: async () => ({ ready: true, version: 'V3.5 SP20', missing: [] }),
  }
}

async function measure (options) {
  const { clock, VirtualDate } = makeClock(Date.UTC(2026, 0, 2, 3, 4, 5))
  const calls = { claim: 0, other: 0 }
  const countingFetch = async (url) => {
    if (String(url).endsWith('.pending')) calls.claim += 1
    else calls.other += 1
    return { ok: true, json: async () => ({ ok: true, value: { proposals: [] } }) }
  }
  const driver = createWorkbenchDriver({
    objects: OBJECTS,
    taskhive: makeTaskhive(),
    ownerSessionId: 'session-t183-claim',
    sourceFile: options.sourceFile,
    extraGlobals: { Date: VirtualDate, fetch: countingFetch },
  })
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  await driver.settle(20)
  calls.claim = 0
  calls.other = 0
  for (let index = 0; index < TICKS; index += 1) {
    clock.now += TICK_SECONDS * 1000
    driver.scene.flushTimers()
    await tick()
    driver.render()
  }
  const steady = calls.claim
  // One event: focus, only 4 seconds after the last steady tick. It must claim
  // immediately (a throttle that ignored events would claim nothing here).
  clock.now += TICK_SECONDS * 1000
  driver.scene.fire('window', 'focus', {})
  driver.scene.flushTimers()
  await tick()
  driver.render()
  const afterFocus = calls.claim
  // And an ordinary tick right after must be throttled again.
  clock.now += TICK_SECONDS * 1000
  driver.scene.flushTimers()
  await tick()
  driver.render()
  const afterNextTick = calls.claim
  driver.unmount()
  return { clock, steady, afterFocus, afterNextTick, ticks: TICKS }
}

async function main () {
  const dir = createTempDir('taskhive-claim-')
  try {
    const anchored = 'const CODESYS_CLAIM_FALLBACK_MS = 30000'
    assert(client.includes(anchored), 'the constant to neutralise must be present')
    const baselineFile = path.join(dir, 'client-baseline.js')
    fs.writeFileSync(baselineFile, client.split(anchored).join('const CODESYS_CLAIM_FALLBACK_MS = 0'), 'utf8')
    const baseline = await measure({ sourceFile: baselineFile })
    const shipped = await measure({ sourceFile: undefined })

    assert.strictEqual(baseline.steady, TICKS, `the pre-change cadence is one claim per ${TICK_SECONDS}s tick (got ${baseline.steady})`)
    // Fallback budget: one claim per CODESYS_CLAIM_FALLBACK_MS (300 s / 30 s = 10),
    // plus headroom for event-forced claims.
    const fallbackBudget = Math.ceil((SIM_SECONDS * 1000) / 30000) + 4
    assert(
      shipped.steady <= fallbackBudget,
      `the shipped workbench must claim at most the fallback rate plus events (got ${shipped.steady} over ${SIM_SECONDS}s, budget ${fallbackBudget}, baseline ${baseline.steady})`,
    )
    assert(shipped.steady >= 1, 'the fallback must still run, so a broken event source cannot strand a proposal')
    assert(
      shipped.steady * 5 <= baseline.steady,
      `the claim round trips must drop by at least 5x (baseline ${baseline.steady}, shipped ${shipped.steady})`,
    )
    assert.strictEqual(shipped.afterFocus, shipped.steady + 1, 'a window focus must claim immediately instead of waiting for the fallback')
    assert.strictEqual(shipped.afterNextTick, shipped.afterFocus, 'the tick right after an event must be throttled in memory, not sent to the host')

    process.stdout.write(
      `codesys workbench claim contract passed (steady claims ${baseline.steady} -> ${shipped.steady} over ${SIM_SECONDS}s; ` +
      `${(baseline.steady / SIM_SECONDS).toFixed(4)}/s -> ${(shipped.steady / SIM_SECONDS).toFixed(4)}/s; focus forced 1, next tick 0)\n`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`codesys workbench claim contract failed: ${error.message}`)
  process.exitCode = 1
})
