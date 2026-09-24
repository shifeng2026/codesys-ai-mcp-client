'use strict'
// Contract: the CODESYS code workbench must stay calm during use, and it must
// be genuinely linked to the conversation.
//
// Two regressions are pinned here:
//  1. The workbench used to re-detect the current project every 15 s and that
//     tick went through `setBusy(true)` + a status rewrite, so every control
//     flickered disabled and a guard miss re-read the whole project tree —
//     wiping the pending diff and the user's edits mid-typing ("frequent
//     automatic refresh").
//  2. The code shown in the workbench and the code the model edits were two
//     unrelated things: a request typed in the chat could not see the open
//     object's code and could not change it.
//
// The host half is EXERCISED, not just grepped: a mocked plugin context
// registers the real tools and the real fenced route, and the publish → read →
// propose → claim round trip is asserted end to end.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const client = fs.readFileSync(path.join(root, 'plugins/installed/taskhive-surfaces/dsh/client.js'), 'utf8')
const host = fs.readFileSync(path.join(root, 'plugins/installed/taskhive-surfaces/dsh/index.js'), 'utf8')
const main = fs.readFileSync(path.join(root, 'app/main.js'), 'utf8')
const project = fs.readFileSync(path.join(root, 'app/codesys-current-project.js'), 'utf8')

// --- 1. no fixed-cadence refresh that touches busy/status -------------------
assert(!/setInterval\([^)]*,\s*15000\s*\)/.test(client), 'the 15-second workbench poll must stay removed')
assert(client.includes('CODESYS_FALLBACK_DETECT_MS = 300000'), 'the only fallback poll must be rare and silent')
// 现场实测：每次「当前工程」探测 = PowerShell 窗口枚举 + CODESYS 选项扫描 ≈ 2 秒，
// 而切回窗口/标签页都会触发一次 —— 那就是"点一下别的界面就停顿刷新"。所以交互重检测
// 的节流从 15 秒放宽到 45 秒（宿主侧的探测缓存同步放宽到 45 秒）。
assert(client.includes('CODESYS_DETECT_MIN_GAP_MS = 45000'), 'background re-detection must be throttled')
assert(client.includes('const { silent = false, force = false } = options'), 'detection must distinguish silent background probes from user refreshes')
assert(client.includes('if (!silent) { setBusy(true)'), 'a background probe must never toggle busy (that was the flicker)')
assert(client.includes("if (!force && now - lastDetectAtRef.current < CODESYS_DETECT_MIN_GAP_MS) return"), 'throttle must skip unforced repeats')
assert(client.includes('new IntersectionObserver'), 'the fallback poll must be gated on real visibility')
assert(client.includes('document.addEventListener(\'visibilitychange\', recheck)'), 'returning to the window must re-check')

// --- 2. a probe can never destroy work in progress --------------------------
assert(client.includes('normalizeCodesysPath(detected.sourcePath) === normalizeCodesysPath(boundPathRef.current || sourcePathRef.current)'), 'the same project must be matched by path, not by a GUI flag')
assert(!client.includes('requestSeq === null'), 'the old null-gated conversation watcher must be gone')
assert(!client.includes("if (activeProject?.activeGui && sourcePath && jobId) return"), 'a manual/offline binding must not be treated as unverified')
assert(client.includes('if (sameObject && (declarationTyped || implementationTyped)) { setAgentReloadAvailable(true); return }'), 'an incoming proposal must never overwrite manual edits, while selecting another object must still load it')
assert(client.includes('const editorMatchesProposal = Boolean(aiProposed && editedDeclaration === newDeclaration && editedImplementation === newImplementation)'), 'an untouched AI proposal must keep its own identity instead of looking like a manual edit')
assert(client.includes("'data-codesys-reload-suggestion': 'true'"), 'the user must get an explicit way to load the AI suggestion instead')
assert(host.includes('complete declaration/implementation text'), 'proposal text contract must be stated for the model')

// --- 3. the two halves are actually wired ----------------------------------
// KNOWN-ISSUES #9: both namespaces must hang off ONE literal, because the host dispatches them
// from a single trusted prefix. The old shape (`${CODESYS_WORKBENCH_API}/sessions.x`)
// produced `/taskhive/api/codesys.workbench/sessions.x`, which matches neither branch
// (the workbench prefix ends in a DOT, not a slash) and fell through to 404 — every
// session-records call failed with "宿主未响应，请重启 TaskHive 后重试".
assert(client.includes("const TASKHIVE_API_BASE = '/taskhive/api'"), 'the client must derive every plugin route from one namespace literal')
assert(client.includes('const CODESYS_WORKBENCH_API = `${TASKHIVE_API_BASE}/codesys.workbench`'), 'the client must call the workbench route')
assert(client.includes('const CODESYS_SESSIONS_API = `${TASKHIVE_API_BASE}/sessions`'), 'the sessions route must hang off the SAME base, not off the workbench base')
assert(client.includes("codesysWorkbenchApi('publish'"), 'the workbench must publish its live state')
assert(client.includes("codesysWorkbenchApi('pending', { sessionId: activeSession, consume: true })"), 'the workbench must claim queued proposals')
// Delivery must not wait for the end of the turn: the page claims on a short
// timer while it is on screen.
assert(client.includes('const CODESYS_CLAIM_POLL_MS = 4000'), 'the claim poll must exist')
assert(client.includes('}, CODESYS_CLAIM_POLL_MS)'), 'the claim poll must drive claimPendingProposal')
assert(client.includes('if (!sessionId || !workbenchVisible) return undefined'), 'the claim poll must only run with a session on screen')
assert(client.includes('window.__TASKHIVE_CODESYS_WORKBENCH__'), 'a read-only live-state seam must exist for probes and other plugins')
assert(client.includes('applyAgentProposal'), 'proposals from the conversation must be applied to the workbench')
assert(client.includes('consumedSeqRef'), 'already-seen assistant messages must never be replayed as a fresh diff')
assert(host.includes("WORKBENCH_ROUTE = '/taskhive/api'"), 'the host must own the route namespace')
assert(host.includes('taskhive_codesys_workbench_propose'), 'the model needs a tool that hands a diff to the workbench')
assert(host.includes("name: 'taskhive:codesys-workbench'"), 'the chat must learn the workbench contract from the system prompt')
assert(host.includes('isTrustedWorkbenchRequest'), 'the publish route must stay fenced')

// --- 4. colouring: tree + expanded file, driven by change state -------------
assert(client.includes("'data-change-state': state"), 'project tree rows must carry their change state')
assert(client.includes('taskhive-codesys-tree-kind'), 'tree rows must render a per-kind colour mark')
assert(client.includes('taskhive-codesys-editor-highlights'), 'the expanded file needs a line highlight layer')
assert(client.includes("'data-line-state': changed.has(index + 1)"), 'only changed lines may be tinted')
assert(client.includes('codesysChangedLineNumbers(section.base, section.value)'), 'the tint must come from a real line diff against the on-disk base of that section')
// T096: the written keys are resolved once so the green badge and the draft cleanup
// can never disagree about which objects were actually written.
assert(client.includes('const writtenKeys = proposalKeys(proposalToApply.changes, proposalToApply)'), 'the written objects must be resolved once')
assert(client.includes("setObjectChangeState(writtenKeys, 'written')"), 'a written object must stay marked green')
assert(client.includes('clearObjectDrafts(writtenKeys)'), 'the written objects must also drop their editor drafts')
assert(client.includes('taskhive-codesys-legend'), 'the colour legend must be visible')
assert(host.includes('humanConfirmationRequired'), 'the proposal tool result must state that the user confirms the write')

// --- 5. the desktop probe is memoized, never repeated per poll --------------
assert(main.includes('CODESYS_CURRENT_PROJECT_TTL_MS'), 'the desktop must memoize the project probe')
assert(main.includes('codesysCurrentProjectInFlight'), 'concurrent probes must be de-duplicated')
assert(main.includes('input?.force === true'), 'an explicit refresh must bypass the memo')
assert(project.includes('OPTION_SCAN_TTL_MS'), 'the CODESYS options scan must be memoized')

// --- 6. exercised host behaviour -------------------------------------------
function fakeRequest({ url, method = 'POST', headers = { host: '127.0.0.1:55134', 'content-type': 'application/json' }, body = {} } = {}) {
  const payload = Buffer.from(JSON.stringify(body))
  const handlers = new Map()
  return {
    url, method, headers,
    on(event, handler) {
      handlers.set(event, handler)
      if (event === 'data' && payload.length) setImmediate(() => handler(payload))
      if (event === 'end') setImmediate(() => handler())
      return this
    },
    destroy() {},
  }
}

function fakeResponse() {
  const state = { status: 0, body: '' }
  return {
    writeHead(status) { state.status = status },
    end(payload) { state.body = String(payload || '') },
    get state() { return state },
  }
}

async function main_() {
  // The host logs queueing/hand-over; capture it so the trail itself is asserted.
  const consoleLines = []
  const originalLog = console.log
  console.log = (...args) => { consoleLines.push(args.map(String).join(' ')) }
  try {
  const plugin = await import(pathToFileURL(path.join(root, 'plugins/installed/taskhive-surfaces/dsh/index.js')).href)
  const tools = new Map()
  const routes = []
  const sections = []
  const context = {
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    inject: (deps, callback) => {
      const scope = {
        ...context,
        webServer: { register: (route) => { routes.push(route); return () => { const at = routes.indexOf(route); if (at >= 0) routes.splice(at, 1) } } },
        webRuntime: { trustedHosts: [] },
        systemPrompt: { section: (section) => { sections.push(section); return () => { const at = sections.indexOf(section); if (at >= 0) sections.splice(at, 1) } } },
        effect: (factory) => factory(),
      }
      callback(scope)
      return () => {}
    },
    on: () => () => {},
    sessions: { list: () => [] },
    permissionPresets: { set() {}, names: ['danger-full-access'] },
  }
  const dispose = plugin.apply(context)
  assert.deepStrictEqual(typeof dispose, 'function', 'apply must return a disposer')

  const readTool = tools.get('taskhive_codesys_workbench')
  const proposeTool = tools.get('taskhive_codesys_workbench_propose')
  assert(readTool && proposeTool, 'both workbench tools must register')
  assert.strictEqual(routes.length, 1, 'exactly one workbench route must register')
  assert.strictEqual(routes[0].path, '/taskhive/api')
  const promptSection = sections.find((section) => section.name === 'taskhive:codesys-workbench')
  assert(promptSection && promptSection.text.includes('taskhive_codesys_workbench'), 'the prompt section must name the tools')

  const exec = { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-1' } } }
  const before = await readTool.execute({}, exec)
  assert.strictEqual(before.available, false, 'an unused workbench must report unavailable instead of guessing')

  const route = routes[0]
  const publish = fakeResponse()
  await route.handler(fakeRequest({
    url: '/taskhive/api/codesys.workbench.publish',
    body: {
      sessionId: 'session-1',
      state: {
        sessionId: 'session-1', projectPath: 'C:\\plc\\door.project', projectName: 'door.project', jobId: 'job-9',
        writeAvailable: true, objectCount: 42, visible: true, updatedAt: '2026-01-01T00:00:00.000Z',
        openObject: { name: 'PLC_PRG', guid: 'guid-prg', type: 'POU', hasDeclaration: true, hasImplementation: true, source: 'disk', code: 'PROGRAM PLC_PRG\nEND_PROGRAM', baseCode: 'PROGRAM PLC_PRG\nEND_PROGRAM' },
        changedObjects: [{ name: 'PLC_PRG', guid: 'guid-prg', type: 'POU', state: 'manual' }],
        pendingProposal: null,
      },
    },
  }), publish)
  assert.strictEqual(publish.state.status, 200, `publish must answer 200, got ${publish.state.status}`)
  assert.strictEqual(JSON.parse(publish.state.body).value.accepted, true)

  const after = await readTool.execute({}, exec)
  assert.strictEqual(after.available, true, 'the published state must reach the model')
  assert.strictEqual(after.openObject.name, 'PLC_PRG')
  assert.strictEqual(after.openObject.code, 'PROGRAM PLC_PRG\nEND_PROGRAM', 'the chat must receive the workbench code verbatim')
  assert.strictEqual(after.changedObjects[0].state, 'manual')
  assert(after.contract.forbidden.join('|').includes('PLC'), 'the PLC-online prohibition must travel with the payload')

  const queued = await proposeTool.execute({ summary: 'add test program', changes: [{ operation: 'create-pou', objectName: 'test', pouType: 'program', declaration: 'PROGRAM test\nEND_PROGRAM', implementation: '' }] }, exec)
  assert.strictEqual(queued.accepted, true)
  assert.strictEqual(queued.humanConfirmationRequired, true, 'a proposal must never claim the project was written')
  assert(/确认写入工程/.test(queued.note), 'the model must be told the user confirms the write')
  assert.strictEqual(queued.delivered, false, 'a queued proposal must not claim it is already shown')
  assert.strictEqual(queued.deliveryState, 'queued-awaiting-workbench')

  // Reported bug: propose returned accepted:true but the very next read showed
  // pendingProposal:null / changedObjects:[] — the read model only looked at the
  // page-published state while the proposal was still in the host queue. The
  // read model must be the UNION of both, with delivery stated explicitly.
  const beforeClaim = await readTool.execute({}, exec)
  assert(beforeClaim.pendingProposal, 'a queued proposal must be visible to the model before the page claims it')
  assert.strictEqual(beforeClaim.pendingProposal.id, queued.proposalId, 'the read model must report the same proposal id that propose returned')
  assert.strictEqual(beforeClaim.pendingProposal.delivered, false)
  assert.strictEqual(beforeClaim.pendingProposal.source, 'host-queue')
  assert.strictEqual(beforeClaim.deliveryState, 'queued-awaiting-workbench')
  assert.strictEqual(beforeClaim.queuedProposals.length, 1)
  assert.strictEqual(beforeClaim.queuedProposals[0].id, queued.proposalId)
  assert.deepStrictEqual(beforeClaim.queuedProposals[0].objectNames, ['test'])
  assert(beforeClaim.changedObjects.some((item) => item.name === 'test' && item.state === 'agent-queued'), 'a queued change must show up as a pending object')
  assert.strictEqual(beforeClaim.changedObjects.filter((item) => item.name === 'PLC_PRG').length, 1, 'the merge must not duplicate an object the workbench already reports')
  assert(/数秒内自动领取/.test(beforeClaim.note), 'the model must be told the workbench claims it shortly, not to resubmit')

  const pending = fakeResponse()
  await route.handler(fakeRequest({ url: '/taskhive/api/codesys.workbench.pending', body: { sessionId: 'session-1', consume: true } }), pending)
  const claimed = JSON.parse(pending.state.body).value.proposals
  assert.strictEqual(claimed.length, 1, 'the workbench must be able to claim the queued proposal')
  assert.strictEqual(claimed[0].proposal.changes[0].objectName, 'test')

  // After the claim the queue is empty but the delivery trail is not: the model
  // can still tell "handed to the workbench" apart from "lost".
  const afterClaim = await readTool.execute({}, exec)
  assert.strictEqual(afterClaim.queuedProposals.length, 0, 'a claimed proposal leaves the queue')
  assert.strictEqual(afterClaim.deliveredProposals.length, 1, 'the delivery trail must record the hand-over')
  assert.strictEqual(afterClaim.deliveredProposals[0].id, queued.proposalId)
  assert.strictEqual(afterClaim.deliveredProposals[0].delivered, true)

  const again = fakeResponse()
  await route.handler(fakeRequest({ url: '/taskhive/api/codesys.workbench.pending', body: { sessionId: 'session-1', consume: true } }), again)
  assert.strictEqual(JSON.parse(again.state.body).value.proposals.length, 0, 'a claimed proposal must not be handed out twice')
  const consoleTrail = consoleLines.join('\n')
  assert(/codesys\.workbench\.proposal\.queued id=codesys-proposal-/.test(consoleTrail), 'the host must log the queueing so a delivery question is answerable server-side')
  assert(/codesys\.workbench\.proposal\.claimed session=session-1 ids=codesys-proposal-/.test(consoleTrail), 'the host must log the hand-over')

  const forbidden = fakeResponse()
  await route.handler(fakeRequest({ url: '/taskhive/api/codesys.workbench.publish', headers: { host: '127.0.0.1:55134', 'sec-fetch-site': 'cross-site' }, body: { sessionId: 'session-1', state: {} } }), forbidden)
  assert.strictEqual(forbidden.state.status, 403, 'a cross-site request must be refused')

  const otherSession = await readTool.execute({}, { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-2' } } })
  assert.strictEqual(otherSession.available, false, 'workbench state must never leak between sessions')

  const unbound = fakeResponse()
  await route.handler(fakeRequest({
    url: '/taskhive/api/codesys.workbench.publish',
    body: { sessionId: 'session-3', state: { sessionId: 'session-3', projectPath: '', jobId: '', openObject: null, changedObjects: [] } },
  }), unbound)
  const unboundRead = await readTool.execute({}, { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-3' } } })
  assert.strictEqual(unboundRead.projectBound, false, 'an open but unbound workbench must say so')
  assert(/尚未绑定/.test(unboundRead.note), 'the model must be told to ask the user instead of guessing')
  await assert.rejects(
    async () => proposeTool.execute({ summary: 'x', changes: [{ objectName: 'PLC_PRG', implementation: 'x' }] }, { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-3' } } }),
    /尚未绑定工程/,
    'a proposal without a bound project must fail loudly instead of queueing into the void',
  )

  assert.throws(() => proposeTool.execute({ summary: 'x', changes: [] }, exec), /changes/, 'an empty proposal must be rejected')
  dispose()
  process.stdout.write('codesys workbench link contract passed\n')
  } finally {
    console.log = originalLog
  }
}

main_().catch((error) => {
  console.error(`codesys workbench link contract failed: ${error.message}`)
  process.exitCode = 1
})
