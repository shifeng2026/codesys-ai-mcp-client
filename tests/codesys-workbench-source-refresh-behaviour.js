'use strict'
// Scenario (this round, user report): "我在 codesys 里面改动程序，代码工作台里面的代码没有更新".
//
// What the machine actually does (measured on the live tree, see the timing
// stream): the user edits in the NATIVE CODESYS IDE and saves; the .project bytes
// on disk change; the engine has no trouble with that — `inspect-project` keys
// both its in-memory and its on-disk object-tree cache by the SOURCE sha
// (`scriptengine.cjs` inspectCacheKey / readInspectDiskCache) and `ensureWorkProject`
// re-copies the working copy whenever `workProjectSha256 !== sourceSha`. A new sha
// therefore always reads a new tree; `codesys-scriptengine-project-reuse-contract.js`
// pins that.
//
// The missing half was the workbench side: NOTHING ever asked again.
// `detectCurrentProject`'s "same project" branch deliberately refreshes identity
// and write permission only ("Re-reading the whole project tree here was the
// source of the 15-second refresh"), and the explicit 刷新 button calls that very
// same function — so an external save left the workbench showing the old text
// forever, and 刷新 answered "已完整读取 N 个工程对象" without reading anything.
//
// This file drives the REAL `CodesysWorkbench` component (see
// `lib/workbench-driver`) against a host that models the real machine instead of
// a fixed answer: `diff` re-hashes the bytes that are on disk right now, and
// `inspect-project` answers for those same bytes. The only thing a step changes
// is "the user saved in the native IDE" — which is exactly the reported gesture.
//
// The five claims, each measured instead of grepped:
//   ① a source sha change is picked up (explicit 刷新, a window-focus event, and
//     the low-frequency visible check), and a pending AI proposal is voided with
//     ONE readable line naming both hashes;
//   ② an unchanged source produces ZERO actions and ZERO text (the quiet rule);
//   ③ a workbench holding hand-typed, unwritten edits is never silently reloaded
//     over (T166) — it says one line and leaves the write guard's baseline alone;
//   ④ no click ever produces a write / compile / rollback IPC;
//   ⑤ the pre-existing path (another project bound) still rebinds.

const assert = require('node:assert')
const { createWorkbenchDriver } = require('./lib/workbench-driver')

const SOURCE_PATH = 'C:/projects/demo.project'
const JOB_ID = 'direct-src-refresh-1'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

const PATH_TO_POU = ['Device', 'PLC Logic', 'Application', 'PLC_PRG']
const OLD_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', 'END_VAR'].join('\n')
const NEW_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  y : INT;', 'END_VAR'].join('\n')
const AI_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  z : INT;', 'END_VAR'].join('\n')
const OLD_IMPLEMENTATION = 'x := x + 1;'
const NEW_IMPLEMENTATION = 'x := x + 2;'

function objectsFor (declaration, implementation = OLD_IMPLEMENTATION) {
  return [{
    name: 'PLC_PRG',
    guid: 'guid-plc-prg',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration,
    implementation,
    path: PATH_TO_POU,
  }]
}

// A host that behaves like the real one: `diff` is a plain re-hash of the file
// that is on disk (`scriptengine.cjs` diff(): read job.json + sha256, no
// ScriptEngine), so it always agrees with what `inspect-project` would return.
function makeHost (options = {}) {
  const state = {
    // "the .project bytes on disk"
    diskSha: options.diskSha || SHA_A,
    diskObjects: options.diskObjects || objectsFor(OLD_DECLARATION),
    ipc: [],
    inspectCalls: 0,
  }
  const host = {
    state,
    // The user's gesture: change the code in the native IDE and save.
    saveInNativeIde (declaration, sha, implementation = OLD_IMPLEMENTATION) {
      state.diskObjects = objectsFor(declaration, implementation)
      state.diskSha = sha
    },
    inspectCalls: () => state.inspectCalls,
    actionsNamed: (action) => state.ipc.filter((item) => item.action === action),
    async run (action, input) {
      state.ipc.push({ action, input })
      if (action === 'bind-project') {
        return { sourcePath: SOURCE_PATH, jobId: JOB_ID, writeAvailable: true, writeBlockReason: '', baselineSha256: state.diskSha }
      }
      if (action === 'diff') {
        return { ok: true, action: 'diff', jobId: JOB_ID, currentSha256: state.diskSha, baselineSha256: SHA_A, changed: state.diskSha !== SHA_A }
      }
      if (action === 'inspect-project') {
        state.inspectCalls += 1
        return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(state.diskObjects)) } }
      }
      return { status: 'complete', payload: {} }
    },
  }
  return host
}

function makeDriver (host, options = {}) {
  return createWorkbenchDriver({
    objects: objectsFor(OLD_DECLARATION),
    sourcePath: SOURCE_PATH,
    jobId: JOB_ID,
    ownerSessionId: options.ownerSessionId,
    extraGlobals: options.extraGlobals,
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

// Every action that would change the source project or start CODESYS. A refresh
// must never be able to reach one of these without a click.
const MUTATING = ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'rollback', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'import-xml']

function assertNoWrite (host, label) {
  const offenders = host.state.ipc.filter((item) => MUTATING.includes(item.action))
  assert.strictEqual(
    offenders.length,
    0,
    `${label} must never write, compile or roll back (saw ${offenders.map((item) => item.action).join(', ') || 'none'})`,
  )
}

function clickRefresh (driver) {
  const button = driver.find((props) => props['data-codesys-detect-project'] === 'true')
  assert(button, 'the workbench must render its one detection/refresh button')
  button.props.onClick()
}

// ── ① an external save is picked up, through all three triggers ─────────────

async function explicitRefreshAfterExternalSave () {
  const host = makeHost()
  const driver = makeDriver(host)
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), OLD_DECLARATION, 'the first read must be on screen')
  const readsBefore = host.inspectCalls()

  // The reported gesture: edit in the native IDE, Ctrl+S.
  host.saveInNativeIde(NEW_DECLARATION, SHA_B, NEW_IMPLEMENTATION)
  clickRefresh(driver)
  await driver.settle()

  assert.strictEqual(driver.editorValue('declaration'), NEW_DECLARATION,
    'the displayed code must follow an external save (the reported bug: it did not)')
  assert.strictEqual(driver.editorValue('implementation'), NEW_IMPLEMENTATION,
    'the implementation section must follow too, not just the declaration')
  assert(host.inspectCalls() > readsBefore, 'picking up the change requires really re-reading the project')
  assertNoWrite(host, 'a refresh')
  const status = statusTextOf(driver)
  assert(status.includes(SHA_A.slice(0, 8)) && status.includes(SHA_B.slice(0, 8)),
    `the change must be explained with both hashes (status was ${JSON.stringify(status)})`)
  driver.unmount()
  return { status, reads: host.inspectCalls() }
}

async function focusAfterExternalSave () {
  const host = makeHost()
  const driver = makeDriver(host)
  await driver.settle()

  host.saveInNativeIde(NEW_DECLARATION, SHA_B, NEW_IMPLEMENTATION)
  // Coming back to the TaskHive window from the IDE: the existing
  // focus/visibilitychange listener is the event source, so no new listener and
  // no waiting for a timer.
  driver.scene.fire('window', 'focus', {})
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), NEW_DECLARATION,
    'returning to the window after an external save must show the new code')
  assertNoWrite(host, 'a focus event')
  driver.unmount()
  return { status: statusTextOf(driver) }
}

async function visibleCheckAfterExternalSave () {
  const host = makeHost()
  const driver = makeDriver(host)
  await driver.settle()

  host.saveInNativeIde(NEW_DECLARATION, SHA_B, NEW_IMPLEMENTATION)
  // No event, no click: only simulated time passes while the workbench stays on
  // screen (two monitors, or a user watching this window). `settle` advances
  // whatever timers the component armed.
  await driver.settle(3)
  assert.strictEqual(driver.editorValue('declaration'), NEW_DECLARATION,
    'a visible workbench must eventually notice a save it was never told about')
  assertNoWrite(host, 'the visible low-frequency check')
  driver.unmount()
  return { status: statusTextOf(driver) }
}

async function pendingProposalIsVoided () {
  const host = makeHost()
  const proposals = [{
    id: 'proposal-1',
    note: '调整 PLC_PRG',
    proposal: {
      summary: '调整 PLC_PRG',
      changes: [{ operation: 'update-text', objectGuid: 'guid-plc-prg', objectName: 'PLC_PRG', declaration: AI_DECLARATION }],
    },
  }]
  // 本轮 A①：待领取提案现在**绑定工程身份**，而且"工作台还没有绑定工程"时领到的提案会被挡下。
  // 领取请求虽然在 `detect → bind → inspect` 之前发出，但它的回包落在绑定之后 —— 这条用具里
  // 第 1 次领取请求正好是那一次，所以在它上面空手而归、把提案放在绑定之后那次领取上，才是真机上
  // "提案落进工作台等着审查"的那一帧。
  const countingFetch = (() => {
    let claims = 0
    return async (url) => {
      if (!String(url).endsWith('.pending')) return { ok: true, json: async () => ({ ok: true, value: { accepted: true } }) }
      claims += 1
      const deliver = claims > 1 ? proposals.splice(0, proposals.length) : []
      return { ok: true, json: async () => ({ ok: true, value: { proposals: deliver } }) }
    }
  })()
  const driver = makeDriver(host, { ownerSessionId: 'session-src-refresh', extraGlobals: { fetch: countingFetch } })
  await driver.settle()
  assert(driver.find((props) => props['data-codesys-review-accepted'] === 'true'),
    'the AI proposal must have landed as a pending diff the user could review')
  assert.strictEqual(driver.editorValue('declaration'), AI_DECLARATION, 'the pending proposal is what the editor shows')

  // The project is saved externally while that proposal is still pending.
  host.saveInNativeIde(NEW_DECLARATION, SHA_B, NEW_IMPLEMENTATION)
  clickRefresh(driver)
  await driver.settle()

  assert.strictEqual(driver.find((props) => props['data-codesys-review-accepted'] === 'true'), null,
    'the stale proposal must be voided: there is nothing left to review')
  // 本轮（写入行抽屉化）按**意图**更新：这一条原来是"the write entry point itself stays on
  // screen（nothing was added or removed）"，而用户本轮的口径正好相反 —— 空闲时那条行
  // **根本不存在**。所以判据换成更严的一对：提案作废后 ⇒ 行与「确认写入」都不在；而
  // 行还在的时候（上面那段有待确认提案）它照样只走同一条 applyProposal，禁用状态照旧。
  const confirmButton = driver.find((props) => props['data-codesys-confirm-write'] === 'true')
  assert.strictEqual(confirmButton, null,
    'the voided proposal leaves the workbench with nothing to write: the write row itself is gone (not merely disabled)')
  assert.strictEqual(driver.find((props) => props['data-codesys-commandbar'] === 'true'), null,
    'and the command bar may not stay on screen as an empty shell')
  assert.strictEqual(driver.editorValue('declaration'), NEW_DECLARATION,
    'the editor must show the freshly read project, not the voided proposal')
  const status = statusTextOf(driver)
  assert(status.includes('此前提案已作废'), `the voiding must be stated in ONE line (status was ${JSON.stringify(status)})`)
  assertNoWrite(host, 'voiding a stale proposal')
  driver.unmount()
  return { status }
}

// ── ② an unchanged source stays completely quiet ────────────────────────────

async function unchangedSourceIsSilent () {
  const host = makeHost()
  const driver = makeDriver(host)
  await driver.settle()
  const statusBefore = statusTextOf(driver)
  const readsBefore = host.inspectCalls()

  // Plenty of simulated time, plus the events that would re-check.
  await driver.settle(4)
  driver.scene.fire('window', 'focus', {})
  await driver.settle(4)

  assert.strictEqual(host.inspectCalls(), readsBefore, 'an unchanged source must not trigger a single re-read')
  assert.strictEqual(statusTextOf(driver), statusBefore,
    `an unchanged source must add no text (was ${JSON.stringify(statusBefore)}, now ${JSON.stringify(statusTextOf(driver))})`)
  assert(host.actionsNamed('diff').length > 0, 'the check must really have run (a check that never fires proves nothing)')
  assertNoWrite(host, 'an unchanged-source check')
  driver.unmount()
  return { statusBefore, diffs: host.actionsNamed('diff').length }
}

// ── ③ hand-typed, unwritten edits are never silently replaced (T166) ─────────

async function unwrittenEditsAreNotClobbered () {
  const host = makeHost()
  const driver = makeDriver(host)
  await driver.settle()
  const typed = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  mine : INT;', 'END_VAR'].join('\n')
  driver.typeInEditor('declaration', typed)
  assert.strictEqual(driver.editorValue('declaration'), typed, 'the user is typing in the workbench editor')

  // A save lands externally, carrying DIFFERENT code for the same object.
  host.saveInNativeIde(NEW_DECLARATION, SHA_B, NEW_IMPLEMENTATION)
  await driver.settle(4)

  assert.strictEqual(driver.editorValue('declaration'), typed,
    'the user\'s unwritten text must survive an external save (a silent reload would destroy it)')
  const status = statusTextOf(driver)
  assert(status.includes(SHA_A.slice(0, 8)) && status.includes(SHA_B.slice(0, 8)),
    `the user must be told the disk moved, in one line (status was ${JSON.stringify(status)})`)
  assertNoWrite(host, 'the not-clobbered path')
  driver.unmount()
  return { status }
}

// ── ⑤ the pre-existing "another project" path is untouched ──────────────────

async function otherProjectStillRebinds () {
  const host = makeHost()
  const other = 'C:/projects/other.project'
  const seen = []
  const driver = createWorkbenchDriver({
    objects: objectsFor(OLD_DECLARATION),
    sourcePath: SOURCE_PATH,
    jobId: JOB_ID,
    taskhive: {
      currentCodesysProject: async () => ({ found: true, sourcePath: other, detection: 'monitored-window', writeAvailable: true, activeGui: true }),
      runCodesysScriptEngineAction: async (action, input) => {
        seen.push(action)
        return host.run(action, input)
      },
      codesysOnlineStatus: async () => ({ ok: true, running: false }),
      codesysScriptEngineStatus: async () => ({ ready: true, version: 'V3.5 SP20', missing: [] }),
    },
  })
  await driver.settle()
  // A FIRST detect happens with the other project already current, so the
  // workbench binds it rather than the placeholder above.
  assert(seen.includes('bind-project'), 'a different detected project must still bind through bind-project')
  driver.unmount()
  return { actions: [...new Set(seen)].join(',') }
}

async function main () {
  const explicit = await explicitRefreshAfterExternalSave()
  const focus = await focusAfterExternalSave()
  const visible = await visibleCheckAfterExternalSave()
  const proposal = await pendingProposalIsVoided()
  const silent = await unchangedSourceIsSilent()
  const typed = await unwrittenEditsAreNotClobbered()
  const other = await otherProjectStillRebinds()
  process.stdout.write(
    'codesys workbench source-refresh behaviour passed ' +
    `(refresh re-read ${explicit.reads} reads: "${explicit.status.slice(0, 60)}…"; focus and the visible check both updated; ` +
    `proposal voided: "${proposal.status.slice(0, 60)}…"; ` +
    `unchanged source: ${silent.diffs} sha checks, 0 re-reads, status byte-identical; ` +
    `typed text kept with "${typed.status.slice(0, 48)}…"; other project still bound: ${other.actions})\n`,
  )
}

main().catch((error) => {
  console.error(`codesys workbench source-refresh behaviour failed: ${error.stack || error.message}`)
  process.exitCode = 1
})
