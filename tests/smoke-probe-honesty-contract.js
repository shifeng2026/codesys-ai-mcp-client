'use strict'

// "A probe must not lie."
//
// Audit 2026-10-02 recorded five packaged probes that computed an `ok` verdict
// and then returned it without acting on it: `probeNativeSettings`,
// `probeHistorySessionSwitch`, `probePluginRightSidebar`,
// `exerciseRepositorySurfaces` and the workspace-geometry verdict inside
// `exerciseTaskHiveSurface` (plus the unreferenced `exerciseChartSurface`). Each
// one wrote `ok:false` into its evidence JSON while `--smoke-ui` still exited 0,
// so every "probe evidence ok=true" claim was unfalsifiable.
//
// This contract pins three things that all fail SILENTLY otherwise:
//
//   1. STRUCTURE — every probe that computes an `ok` routes it through
//      `enforceProbeResult` (or throws on it). A mutation proof strips the
//      enforcement out of a copy of the module and checks that the scanner
//      reports the probe as a liar again, so the guard itself is tested.
//   2. BEHAVIOUR — the real probe functions run against a stubbed context and
//      really reject when their evidence says false (and really resolve when it
//      says true, so the enforcement is not just "always throw").
//   3. ANCHORS — the knowledge/repository probes no longer point at the deleted
//      shell-overlay selectors, and the anchors they use now exist in the shipped
//      DSH client bundle. The proof that a wrong selector turns a probe red is a
//      mutated copy of probes.js whose knowledge anchor is swapped back to
//      `#repo-results .plugin-row`: the strict lookup in the frame double refuses
//      the undeclared selector and the probe rejects.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')

const app = path.resolve(__dirname, '..')
const probeModulePath = path.join(app, 'app', 'smoke', 'probes.js')
const probeSource = fs.readFileSync(probeModulePath, 'utf8')
const clientBundle = fs.readFileSync(path.join(app, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js'), 'utf8')
const { createRecordingFrame, createProbeContext, createProbes } = require('./lib/probe-harness')

// ── 1. structure: no probe may compute an ok it does not act on ────────────────

// Body of every top-level probe function, keyed by name. The module ends with
// `return { ... }`, which is the terminator for the last function.
function probeBodies (source) {
  const lines = source.split(/\r?\n/)
  const endMarker = lines.findIndex((line) => line === '  return {')
  const starts = []
  lines.forEach((line, index) => {
    const match = /^(?:async )?function ((?:probe|exercise)[A-Za-z0-9_]+)\(/.exec(line)
    if (match) starts.push({ name: match[1], line: index })
  })
  const bodies = new Map()
  for (let i = 0; i < starts.length; i += 1) {
    const from = starts[i].line
    const to = i + 1 < starts.length ? starts[i + 1].line : endMarker
    bodies.set(starts[i].name, lines.slice(from, to).join('\n'))
  }
  return bodies
}

// A probe "computes an ok" when it builds an `ok:` field, an `ok` variable, or
// assigns `evidence.ok`. Both spellings are in use and both were liars.
const COMPUTES_OK = /(^|[\s{,(])ok:\s|(^|\s)const ok\s*=|(^|\s)let ok\s*=|(^|\s)evidence\.ok\s*=/
// It is honest when it hands the verdict to the shared enforcement helper, or
// when it throws on the verdict itself.
const ENFORCES_OK = /enforceProbeResult\(|if \(!(?:[\w$]+\.)*\bok\b/
// Every probe listed here was a recorded liar; the scan must see them as fixed.
const KNOWN_FORMER_LIARS = [
  'probeNativeSettings',
  'probeHistorySessionSwitch',
  'probePluginRightSidebar',
  'exerciseRepositorySurfaces',
  'exerciseChartSurface',
  'exerciseTaskHiveSurface',
  'probeTaskHiveBranding',
]

function scanLiars (source) {
  const liars = []
  const checked = []
  for (const [name, body] of probeBodies(source)) {
    if (!COMPUTES_OK.test(body)) continue
    if (/function enforceProbeResult/.test(body)) continue
    checked.push(name)
    if (!ENFORCES_OK.test(body)) liars.push(name)
  }
  return { liars, checked }
}

// A frame whose knowledge surface is declared and whose scripts answer green.
function knowledgeProbeFixture () {
  let reads = 0
  const frame = createRecordingFrame({
    name: 'dsh-knowledge-frame',
    selectors: ['[data-taskhive-knowledge]', '#knowledge-category-grid', '#chart-output svg', '#scriptengine-status', '#web-ai-address'],
    handlers: [
      // Order matters: the read script also mentions input[type="search"], so the
      // structural read has to be matched before the generic ones.
      { match: 'rootState', value: () => {
        reads += 1
        if (reads === 1) {
          return { root: true, rootState: 'active', searchBox: true, searchValue: '', tabs: ['书架', '待审核', '开源索引', '全部卡片'], activeTab: '书架', stats: 4, cards: 0, shelves: 0, shelfBody: false, emptyText: '书架还空着', errorText: '', text: '知识库' }
        }
        return { root: true, rootState: 'active', searchBox: true, searchValue: 'CODESYS', tabs: ['书架', '待审核', '开源索引', '全部卡片'], activeTab: '开源索引', stats: 4, cards: 0, shelves: 1, shelfBody: true, emptyText: '', errorText: '', text: '开源索引' }
      } },
      { match: 'HTMLInputElement.prototype', value: true },
      { match: '开源索引', value: { clicked: true, label: '开源索引' } },
      { match: '书架', value: true },
      // The left-layout script also mentions [data-sidebar-plugin-id], so it has
      // to be answered before the plain plugin-button click script.
      { match: 'native-left-sidebar', value: { viewport: { width: 1200, height: 800 }, architecture: 'native-left-sidebar', pluginButton: { visible: true, x: 10, y: 40, width: 40, height: 40 }, sidebars: [{ x: 0, y: 0, width: 260, height: 780 }], rightSidebarProbeSkipped: true } },
      { match: 'topRightControls', value: { viewport: { width: 1200, height: 800 }, collapsed: false, declaredWidth: 260, candidates: [{ width: 300, height: 700 }], topRightControls: [], toggle: { visible: true, label: '收起侧边栏' } } },
      { match: 'controls:', value: { marker: true, controls: 5 } },
      { match: 'data-taskhive-plugin-surface-active', value: { pluginSurfaceActive: false, leftSidebarVisible: true } },
      { match: 'data-sidebar-plugin-id', value: { clicked: true, text: '知识库' } },
      { match: 'chart-output', value: { visible: true, kind: 'bar', svgLength: 4000, exportSvg: true, exportJson: true, status: 'ok' } },
    ],
    fallback: () => null,
  })
  return { frame }
}

function repositoryFixture () {
  const { frame } = knowledgeProbeFixture()
  const repositories = {
    knowledge: {
      sync: async ({ remotePath }) => {
        fs.mkdirSync(remotePath, { recursive: true })
        fs.writeFileSync(path.join(remotePath, 'taskhive-knowledge-cards.json'), JSON.stringify({ cards: [], revision: 3 }), 'utf8')
        return { state: 'synchronized', clients: 1, conflicts: 0 }
      },
    },
  }
  return { frame, repositories }
}

async function expectRejects (fn, pattern, why) {
  let error = null
  try {
    await fn()
  } catch (caught) {
    error = caught
  }
  assert(error, `${why}: the probe resolved, so its failure could not reach the caller`)
  assert(pattern.test(String(error.message)), `${why}: expected ${pattern} but got ${error.message}`)
  return error
}

async function structureChecks () {
  const scan = scanLiars(probeSource)
  assert(scan.checked.length >= 18, `expected the scan to see every ok-computing probe, found ${scan.checked.length}`)
  assert.deepStrictEqual(scan.liars, [], `probes compute an ok they never act on: ${scan.liars.join(', ')}`)
  for (const name of KNOWN_FORMER_LIARS) {
    assert(scan.checked.includes(name), `${name} must still compute an ok for this contract to be meaningful`)
  }

  // Mutation proof: remove the enforcement from one probe in a COPY and check the
  // scanner reports it again. Without this, a scanner that silently matched
  // nothing would look exactly like a clean tree.
  const mutantSource = probeSource.replace(
    "  return enforceProbeResult('plugin-right-sidebar-probe', evidence);",
    '  return evidence;',
  )
  assert.notStrictEqual(mutantSource, probeSource, 'the mutation must actually change the source')
  const mutantScan = scanLiars(mutantSource)
  assert(mutantScan.liars.includes('probePluginRightSidebar'), 'the scanner must flag the de-enforced probe')

  // The de-enforced probe must also really stop failing at runtime.
  const dir = createTempDir('taskhive-probe-mutant-')
  try {
    const mutantPath = path.join(dir, 'probes.js')
    fs.writeFileSync(mutantPath, mutantSource, 'utf8')
    const { frame } = knowledgeProbeFixture()
    const ctx = createProbeContext({ frames: { knowledge: frame }, pluginSurfaceAttached: false, pluginSurfaceKind: null })
    const evidence = await createProbes(ctx, mutantPath).probePluginRightSidebar(frame)
    assert.strictEqual(evidence.ok, false, 'the mutant probe must still produce ok:false evidence')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function repositoryChecks () {
  // GREEN, then the same probe with one anchor deliberately written wrong (the
  // deleted shell-overlay selector).
  const { frame, repositories } = repositoryFixture()
  const probes = createProbes(createProbeContext({ frames: { knowledge: frame }, repositories }))
  const evidence = await probes.exerciseRepositorySurfaces()
  assert.strictEqual(evidence.ok, true, 'the green knowledge fixture must satisfy the repository probe')
  assert.strictEqual(evidence.searchRoundTrip, true, 'the search round-trip must be the controlled-input echo')
  assert.strictEqual(evidence.indexEvidence.skipped, false, 'the declared index shelf must not be reported as skipped')
  assert.strictEqual(evidence.knowledge.listed.root, true, 'the probe must read the real DSH knowledge root')

  const dir = createTempDir('taskhive-probe-selector-')
  try {
    const mutantPath = path.join(dir, 'probes.js')
    fs.writeFileSync(mutantPath, probeSource.replace(
      "openSurfaceForProbe('knowledge', '[data-taskhive-knowledge]', 30000)",
      "openSurfaceForProbe('knowledge', '#repo-results .plugin-row', 30000)",
    ), 'utf8')
    const mutantCtx = createProbeContext({ frames: { knowledge: frame }, repositories })
    const error = await expectRejects(
      () => createProbes(mutantCtx, mutantPath).exerciseRepositorySurfaces(),
      /mini-dom-missing-selector/,
      'a deliberately wrong selector must turn the repository probe red',
    )
    assert.strictEqual(error.code, 'MINI_DOM_MISSING_SELECTOR', 'the red result must come from the unmatched selector, not from a timeout')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function rightSidebarChecks () {
  // GREEN with the DSH-rendered knowledge contract (no native overlay, T143),
  // then RED when the surface is not actually there.
  const { frame } = knowledgeProbeFixture()
  const evidence = await createProbes(createProbeContext({ dshFrame: frame, frames: { knowledge: frame }, pluginSurfaceAttached: false, pluginSurfaceKind: null })).probePluginRightSidebar(frame)
  assert.strictEqual(evidence.ok, true, 'the knowledge case must be satisfiable by the DSH-rendered contract')
  const knowledgeCase = evidence.results.find((item) => item.kind === 'knowledge')
  assert.strictEqual(knowledgeCase.architecture, 'dsh-client-rendered', 'the knowledge case must use the DSH architecture')
  assert.strictEqual(knowledgeCase.dshRendered, true, 'the knowledge case must be marked as DSH-rendered')
  assert.strictEqual(knowledgeCase.ghostOverlayAttached, false, 'no ghost native overlay may be attached')
  assert.strictEqual(knowledgeCase.surfaceReadyError, null, 'the knowledge marker must resolve through the DSH frame')

  const hollowFrame = createRecordingFrame({
    selectors: ['[data-taskhive-knowledge]', '#scriptengine-status', '#web-ai-address'],
    handlers: [
      { match: 'native-left-sidebar', value: { viewport: { width: 1200, height: 800 }, pluginButton: { visible: true }, sidebars: [{}] } },
      { match: 'topRightControls', value: { viewport: { width: 1200, height: 800 }, collapsed: false, declaredWidth: 260, candidates: [{}], toggle: { visible: true } } },
      { match: 'controls:', value: { marker: false, controls: 0 } },
      { match: 'data-taskhive-plugin-surface-active', value: { pluginSurfaceActive: false, leftSidebarVisible: true } },
      { match: 'data-sidebar-plugin-id', value: { clicked: true } },
    ],
    fallback: () => null,
  })
  const hollowCtx = createProbeContext({ frames: { knowledge: hollowFrame }, pluginSurfaceAttached: false, pluginSurfaceKind: null })
  await expectRejects(
    () => createProbes(hollowCtx).probePluginRightSidebar(hollowFrame),
    /^plugin-right-sidebar-probe-failed$/,
    'a surface that never rendered must fail the right-sidebar probe',
  )
}

async function singleProbeChecks () {
  // probeTaskHiveBranding — the caller used to be the only guard, and one of its
  // two call sites threw the result away.
  const failing = createRecordingFrame({ handlers: [{ match: 'railGlyphApplied', value: { railGlyphApplied: false, brandMarkIsProgramIcon: false, wordmarkReplaced: false, foreignRailIcons: 2, foreignWordmark: true, visibleDeepSeek: true, visibleInternalNotice: true, primarySurface: false, brandAudit: {}, themeProbe: { brandToken: '#000', forcedMonochromeRules: 3 } } }] })
  await expectRejects(
    () => createProbes(createProbeContext({})).probeTaskHiveBranding(failing),
    /^ui-branding-probe-failed$/,
    'failing branding evidence must throw',
  )
  const passing = createRecordingFrame({
    handlers: [{
      match: 'railGlyphApplied',
      value: {
        railGlyphApplied: true,
        brandMarkIsProgramIcon: true,
        brandMarkSrcPrefix: 'data:image/png;base64,',
        wordmarkReplaced: true,
        foreignRailIcons: 0,
        foreignWordmark: false,
        visibleDeepSeek: false,
        visibleInternalNotice: false,
        primarySurface: true,
        brandAudit: { collapsedSidebar: { brandMarkTag: 'IMG', brandMarkSrc: 'data:image/png;base64,' }, expandedSidebar: { brandMarkTag: 'IMG' } },
        themeProbe: { brandToken: '#4f6ef2', forcedMonochromeRules: 0 },
      },
    }],
  })
  const evidence = await createProbes(createProbeContext({})).probeTaskHiveBranding(passing)
  assert.strictEqual(evidence.ok, true, 'passing branding evidence must resolve (the guard is not just "always throw")')

  // probeHistorySessionSwitch — its own `ok` was only read under
  // --smoke-codesys-fixture.
  const historyFrame = createRecordingFrame({
    handlers: [
      { match: 'session-probe-unavailable', value: { ok: false, reason: 'session-probe-unavailable' } },
      { match: 'snapshot', value: { snapshot: { sessions: { current: 'probe-target' } }, bodyText: '' } },
      { match: 'sessionRow', value: { clicked: false, rows: [], before: null } },
    ],
    fallback: () => null,
  })
  await expectRejects(
    () => createProbes(createProbeContext({ harnessFrame: historyFrame })).probeHistorySessionSwitch(historyFrame),
    /^history-session-switch-probe-failed$/,
    'a session switch that never happened must fail the history probe',
  )

  // probeNativeSettings — the settings dialog never rendered.
  const settingsFrame = createRecordingFrame({
    handlers: [
      { match: 'index, tag: node.tagName', value: [] },
      { match: '访问模式，当前：', value: { found: false, visible: false, marked: false, text: '' } },
      { match: 'aria-haspopup', value: { clicked: true } },
      { match: 'settings-dialog-not-found', value: { dialog: null, reason: 'settings-dialog-not-found' } },
    ],
    fallback: () => null,
  })
  await expectRejects(
    () => createProbes(createProbeContext({ harnessFrame: settingsFrame })).probeNativeSettings(),
    /^native-settings-probe-failed$/,
    'a missing settings dialog must fail the native-settings probe',
  )

  // exerciseChartSurface — unreferenced, but the same lie shape.
  const chartFrame = createRecordingFrame({ selectors: ['#chart-output svg'], handlers: [{ match: '#chart-output svg', value: { visible: false, svgLength: 0, exportSvg: false, exportJson: false, status: '' } }] })
  await expectRejects(
    () => createProbes(createProbeContext({ frames: { charts: chartFrame } })).exerciseChartSurface(),
    /^chart-ui-probe-failed$/,
    'a missing chart surface must fail the chart probe',
  )
}

function mainWindowStub (frame) {
  return {
    isMenuBarVisible: () => false,
    isDestroyed: () => false,
    webContents: {
      getURL: () => 'http://127.0.0.1:45678/',
      isLoading: () => false,
      executeJavaScript: async () => true,
      capturePage: async () => ({ toPNG: () => Buffer.from('harness-png') }),
      mainFrame: { url: 'http://127.0.0.1:45678/', frames: [], executeJavaScript: (code, gesture) => frame.executeJavaScript(code, gesture) },
    },
  }
}

async function harnessFrameChecks () {
  // probeHarnessFrames — a frame that rejects every script used to be recorded in
  // the evidence array and then dropped, because main.js discards the return value.
  const clean = createRecordingFrame({
    handlers: [
      { match: 'taskhiveSurfacesRegistered', value: { url: 'http://127.0.0.1:45678/', bodyTextLength: 10, taskhiveSurfacesRegistered: true, taskhiveSurfaceIds: ['codesys'], betterSidebar: true } },
      { match: '新会话', value: false },
      { match: 'data-taskhive-deep-diving', value: { nativeDisclosurePresent: false, nativeDisclosureAnchors: 0, taskHiveDisclosureOverlayPresent: false, removedOverlaySelectors: [] } },
    ],
  })
  const report = await createProbes(createProbeContext({ mainWindow: mainWindowStub(clean) })).probeHarnessFrames()
  assert.strictEqual(report.ok, true, 'a frame that answers every script must pass')
  assert.strictEqual(report.inspectedFrames, 1, 'the probe must record how many frames it really inspected')

  const broken = createRecordingFrame({ fallback: () => { throw new Error('executeJavaScript rejected: renderer is gone') } })
  await expectRejects(
    () => createProbes(createProbeContext({ mainWindow: mainWindowStub(broken) })).probeHarnessFrames(),
    /^dsh-frame-probe-failed$/,
    'a frame error must fail the harness-frame probe instead of being swallowed',
  )
}

async function disclosureChecks () {
  // probeDeepDivingDisclosure — the removed overlay selectors can no longer be
  // evidence of anything, so a run without the native anchor must SKIP.
  const skipped = createRecordingFrame({ handlers: [{ match: 'data-taskhive-deep-diving', value: { nativeDisclosurePresent: false, nativeDisclosureAnchors: 0, taskHiveDisclosureOverlayPresent: false, removedOverlaySelectors: ['[data-taskhive-deep-diving]'] } }] })
  const evidence = await createProbes(createProbeContext({})).probeDeepDivingDisclosure(skipped)
  assert.strictEqual(evidence.skipped, true, 'no native disclosure anchor means the probe is skipped')
  assert.strictEqual(evidence.ok, false, 'a skipped probe must never report ok')
  assert(/no-native-reasoning-disclosure-in-this-run/.test(evidence.skipReason), 'the skip must carry its reason')

  const overlay = createRecordingFrame({ handlers: [{ match: 'data-taskhive-deep-diving', value: { nativeDisclosurePresent: true, nativeDisclosureAnchors: 1, taskHiveDisclosureOverlayPresent: true, removedOverlaySelectors: ['[data-taskhive-deep-diving]'] } }] })
  await expectRejects(
    () => createProbes(createProbeContext({})).probeDeepDivingDisclosure(overlay),
    /^deep-diving-disclosure-probe-failed$/,
    'a TaskHive overlay on top of the native disclosure must fail',
  )
}

// ── 3. anchors: the deleted shell-overlay selectors must be gone ──────────────

const DELETED_KNOWLEDGE_ANCHORS = [
  '#repo-results', '#repo-query', '#repo-search', '#repo-status', '#repo-audit',
  '.knowledge-workbench', '.knowledge-book', '#knowledge-card-create', '#knowledge-sync',
]

function anchorChecks () {
  for (const selector of DELETED_KNOWLEDGE_ANCHORS) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert(
      !new RegExp(`querySelector(?:All)?\\(\\s*'${escaped}`).test(probeSource),
      `the probes must not query the deleted shell-overlay anchor ${selector} — it only ever times out now`,
    )
  }
  assert(!probeSource.includes("openSurfaceForProbe('knowledge', '#knowledge-category-grid'"), 'the knowledge marker must not be a tab-scoped id that the default view never renders')
  assert(probeSource.includes("'[data-taskhive-knowledge]'"), 'the knowledge probes must use the anchor the DSH view always renders')
  assert(clientBundle.includes('data-taskhive-knowledge'), 'the current DSH client bundle must still render [data-taskhive-knowledge]')
  assert(clientBundle.includes('knowledge-category-grid'), 'the open-source index shelf body must still exist in the bundle')
  assert(!clientBundle.includes('data-taskhive-deep-diving') && !clientBundle.includes('data-taskhive-public-reasoning'), 'the deep-diving overlay selectors are deleted from the bundle, which is why their absence can no longer be a pass')
}

async function main () {
  await structureChecks()
  await repositoryChecks()
  await rightSidebarChecks()
  await singleProbeChecks()
  await harnessFrameChecks()
  await disclosureChecks()
  anchorChecks()
  console.log(`smoke probe honesty contract passed (${scanLiars(probeSource).checked.length} ok-computing probes enforced, ${DELETED_KNOWLEDGE_ANCHORS.length} deleted anchors refused)`)
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
