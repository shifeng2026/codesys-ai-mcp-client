'use strict'

// Scenario: 连续展开收起侧栏 (rapidly toggling the sidebar open/closed).
//
// The desktop surface is a native WebContentsView positioned from the geometry
// the DSH frame publishes (`{ source: 'taskhive-dsh', type: 'surface.geometry' }`).
// While a rail transitions, the DOM passes through rectangles that describe no
// usable pane — the rail is momentarily absent while the conversation pane
// still spans the whole window. A rectangle published from that moment leaves
// the native overlay sitting over the left rail until the next geometry change.
//
// This drives the REAL `installWorkspaceGeometryBridge()` out of the shipped
// client bundle in a `vm` context with a stub document, toggles the rail faster
// than the bridge's own 180 ms / 520 ms republish timers, and asserts:
//
//   1. an intermediate rectangle is never published by the mutation-driven
//      path (the two-identical-frames rule);
//   2. no published rectangle ever covers the docked right rail;
//   3. once the toggling stops, the LAST published geometry is the settled one
//      — the same geometry the same real bridge publishes for a quiet scene in
//      that state. This is the "no stale/wide rectangle left as the final
//      state" requirement, and the expectation is produced by the code under
//      test rather than hand-computed, so it cannot drift.
//
// The forced republish path (`click` → `publish(true)` at 180/520 ms) is
// exercised too. Force bypasses the two-frame rule, so a mid-transition frame IS
// published — and that frame is exactly where a boundary could land on top of a
// rail the user is looking at. The invariant asserted for it is the same one the
// mutation-driven path obeys: no published edge may cut into a rail whose box is
// still measured. (Before the fix this frame emitted `{ left: 0, width: 1122 }`
// over the 240 px left rail.)

const assert = require('node:assert')
const { join } = require('node:path')
const { createScene } = require('./lib/mini-dom')
const { loadPluginClient } = require('./lib/load-source')

const clientFile = join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js')

const CONVERSATION = '[data-pane="conversation"]'
const SIDEBAR = '[data-pane="sidebar"], aside, [class*="sidebarCol"]'
// ⚠️ 必须与 `dsh/client.js` 里 `document.querySelectorAll(...)` 的那串**逐字一致**
// （含顺序）：mini-dom 是按精确字符串查表的，只差一个选择器或顺序变了就查不到节点，
// 于是两态 oracle 相同 → 测试静默空转。产品侧当前为 client.js:5304。
// 同时它必须含 DSH 0.2 的实际右栏类名 `rightbarCol`（T139 才补上，旧选择器查不到右栏）。
const RIGHT_RAIL_LIST = '[data-pane="right-sidebar"], [data-taskhive-right-sidebar-plugins], [class*="rightbarCol"], [class*="rightSidebar"], [class*="sidebarRight"], [data-dsh-better-sidebar] > *'
const RIGHT_TOGGLE = '[data-dsh-right-sidebar-toggle]'

const VIEWPORT = { width: 1200, height: 800 }
const LEFT_RAIL_WIDTH = 240
const RAIL_LEFT = 820
const CONVERSATION_SETTLED = { left: LEFT_RAIL_WIDTH, top: 0, width: 960, height: 800 }
// Only ever real mid-transition: the rail is already gone while the
// conversation pane still spans the window (so `left` resolves to 0).
const INTERMEDIATE_WIDE = { left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height }
const SETTLED_EXPANDED = { conversation: CONVERSATION_SETTLED, railPresent: true, toggleLabel: '收起侧边栏' }
const SETTLED_COLLAPSED = { conversation: CONVERSATION_SETTLED, railPresent: false, toggleLabel: '展开侧边栏' }
// `right` is required, not cosmetic: the bridge only treats a rail as docked when
// `rect.right` reaches the window edge (`>= viewport.width - 4`). Without it the
// docked branch never engages and the boundary falls back to a value that happens
// to equal the rail's edge, which would make the "never cover the docked rail"
// assertions pass for the wrong reason.
const RAIL_RECT = { left: RAIL_LEFT, top: 0, width: VIEWPORT.width - RAIL_LEFT, height: VIEWPORT.height, right: VIEWPORT.width }

function createBridgeScene () {
  return createScene({
    viewport: VIEWPORT,
    cssVars: { '--dsh-sidebar-width': '380' },
    nodes: {
      [CONVERSATION]: { rect: CONVERSATION_SETTLED },
      [SIDEBAR]: { rect: { left: 0, top: 0, width: LEFT_RAIL_WIDTH, height: VIEWPORT.height } },
      [RIGHT_TOGGLE]: { attributes: { 'aria-label': SETTLED_EXPANDED.toggleLabel } },
    },
    lists: {
      [RIGHT_RAIL_LIST]: [{ rect: RAIL_RECT }],
    },
  })
}

// `setList` stores whatever it is handed, so handing it `{ rect }` literals leaves
// plain objects in the list — objects with no `getBoundingClientRect`, which the
// bridge then filters out as "not a docked rail". That made the docked-rail
// assertions pass through the fallback boundary instead of through a measured
// rail. Keep the real StubNode (created from the `lists` descriptor) and toggle it
// in and out instead.
const railNodes = new WeakMap()
function railNode (scene) {
  if (!railNodes.has(scene)) railNodes.set(scene, scene.list(RIGHT_RAIL_LIST)[0] || null)
  return railNodes.get(scene)
}

function applyState (scene, state) {
  scene.node(CONVERSATION).rect = state.conversation
  const rail = railNode(scene)
  if (rail) rail.rect = RAIL_RECT
  scene.setList(RIGHT_RAIL_LIST, state.railPresent && rail ? [rail] : [])
  scene.node(RIGHT_TOGGLE).setAttribute('aria-label', state.toggleLabel)
}

const geometryMessages = (scene) => scene.posted
  .filter((entry) => entry.channel === 'parent' && entry.message?.source === 'taskhive-dsh' && entry.message?.type === 'surface.geometry')
  .map((entry) => entry.message.geometry)

// Geometries are created inside the vm context, so their prototype is the
// context's Object.prototype — `deepStrictEqual` would reject two identical
// objects for that alone. Normalise to host objects before comparing.
const plain = (geometry) => (geometry ? JSON.parse(JSON.stringify(geometry)) : geometry)

// Deliver a structural mutation through the observers the bridge really bound.
// Before the bridge's first frame it has bound nothing, so this is a no-op —
// which is exactly why the driver below runs frames and mutations in rounds.
function mutate (scene) {
  let delivered = 0
  for (const observer of scene.observers.mutation) {
    if (!observer.observed.length) continue
    observer.fire([{ type: 'childList', addedNodes: [], target: scene.documentElement }])
    delivered += 1
  }
  return delivered
}

function runFrames (scene) {
  let ran = 0
  while (scene.pendingFrames() && ran < 16) { scene.runFrame(); ran += 1 }
  return ran
}

// Steady state: drive rounds of (mutation → frames) until the bridge publishes.
function settle (scene, state) {
  applyState(scene, state)
  for (let round = 0; round < 6; round += 1) {
    mutate(scene)
    runFrames(scene)
    if (geometryMessages(scene).length) return
  }
}

// ── the settled oracles, from the same real bridge on quiet scenes ──────────
function settledGeometryFor (state) {
  const scene = createBridgeScene()
  const loaded = loadPluginClient(clientFile, { scene, exports: ['installWorkspaceGeometryBridge'] })
  const dispose = loaded.api.installWorkspaceGeometryBridge()
  settle(scene, state)
  const geometry = geometryMessages(scene).at(-1)
  dispose()
  return geometry
}

const oracleExpanded = settledGeometryFor(SETTLED_EXPANDED)
const oracleCollapsed = settledGeometryFor(SETTLED_COLLAPSED)
assert(oracleExpanded && oracleCollapsed, 'the bridge must publish a settled geometry for a stable scene')
assert.notDeepStrictEqual(plain(oracleExpanded), plain(oracleCollapsed),
  'the expanded and collapsed settled geometries must differ, otherwise this test proves nothing')

// ── the churn run ───────────────────────────────────────────────────────────
const scene = createBridgeScene()
const loaded = loadPluginClient(clientFile, { scene, exports: ['installWorkspaceGeometryBridge'] })
assert.strictEqual(typeof loaded.api.installWorkspaceGeometryBridge, 'function',
  'the shipped client bundle must still install the workspace geometry bridge')
const dispose = loaded.api.installWorkspaceGeometryBridge()

settle(scene, SETTLED_EXPANDED)
assert.deepStrictEqual(plain(geometryMessages(scene).at(-1)), plain(oracleExpanded), 'the initial settled publish must match the oracle')

// Six toggles, each passing through the wide intermediate rectangle, and all of
// them closer together than the 180 ms / 520 ms republish timers.
const toggleTarget = { closest: (selector) => selector === RIGHT_TOGGLE }
let churnFrames = 0
for (let index = 0; index < 6; index += 1) {
  scene.fire('document', 'click', { target: toggleTarget })
  scene.node(CONVERSATION).rect = INTERMEDIATE_WIDE
  scene.setList(RIGHT_RAIL_LIST, [])
  mutate(scene)
  churnFrames += runFrames(scene)
  applyState(scene, index % 2 === 0 ? SETTLED_COLLAPSED : SETTLED_EXPANDED)
  mutate(scene)
  churnFrames += runFrames(scene)
}
assert(churnFrames >= 6, `the churn must actually schedule measurement frames (saw ${churnFrames})`)

// Settle on the collapsed state, then stop touching the DOM entirely.
settle(scene, SETTLED_COLLAPSED)
for (let index = 0; index < 4; index += 1) { mutate(scene); runFrames(scene) }

const published = geometryMessages(scene)
assert(published.length >= 1, 'the bridge must have published something during the churn')

// 1. No intermediate rectangle was published by the mutation-driven path.
const intermediates = published.filter((geometry) => geometry.left === INTERMEDIATE_WIDE.left && geometry.width === INTERMEDIATE_WIDE.width)
assert.strictEqual(intermediates.length, 0,
  `an intermediate wide rectangle must never be published: ${JSON.stringify(intermediates)}`)

// 2. No published rectangle covers the docked right rail. While the rail is
//    docked the surface must stop at its left edge; only the collapsed state
//    may use the space, and it says so explicitly.
for (const geometry of published) {
  if (geometry.rightSidebarCollapsed === true) continue
  assert(geometry.rightBoundary <= RAIL_LEFT + 4,
    `a published geometry covered the docked right rail: ${JSON.stringify(geometry)}`)
}

// 3. The toggling left the user with the settled geometry, not an intermediate.
assert.deepStrictEqual(plain(published.at(-1)), plain(oracleCollapsed),
  'after rapid toggling the last published geometry must be the settled collapsed geometry')

// ── the forced republish path ───────────────────────────────────────────────
// A click arms `publish(true)` at 180 ms and 520 ms. Force bypasses the
// two-frame rule, so the mid-transition frame is published — which is precisely
// the frame that used to land on the left rail. The scene reproduces the reported
// case: the rail is already gone and the toggle already says "expanded", but the
// conversation marker still spans the whole window.
const forcedScene = createBridgeScene()
const forcedLoaded = loadPluginClient(clientFile, { scene: forcedScene, exports: ['installWorkspaceGeometryBridge'] })
const disposeForced = forcedLoaded.api.installWorkspaceGeometryBridge()
settle(forcedScene, SETTLED_EXPANDED)
const beforeForced = geometryMessages(forcedScene).length
forcedScene.fire('document', 'click', { target: toggleTarget })
forcedScene.node(CONVERSATION).rect = INTERMEDIATE_WIDE
forcedScene.setList(RIGHT_RAIL_LIST, [])
forcedScene.node(RIGHT_TOGGLE).setAttribute('aria-label', SETTLED_COLLAPSED.toggleLabel)
mutate(forcedScene)
runFrames(forcedScene)
forcedScene.flushTimers()          // the 180 ms / 520 ms publishes fire mid-transition
runFrames(forcedScene)
const forcedMessages = geometryMessages(forcedScene).slice(beforeForced)
assert(forcedMessages.length >= 1, 'the click-driven republish must still reach the parent')
for (const geometry of forcedMessages) {
  assert(geometry.left >= LEFT_RAIL_WIDTH - 4,
    `a mid-transition forced publish covered the left rail: ${JSON.stringify(geometry)}`)
  if (geometry.rightSidebarCollapsed !== true) {
    assert(geometry.rightBoundary <= RAIL_LEFT + 4,
      `a mid-transition forced publish covered the docked right rail: ${JSON.stringify(geometry)}`)
  }
}
// Whatever the transition emitted, settling must supersede it.
applyState(forcedScene, SETTLED_COLLAPSED)
for (let index = 0; index < 4; index += 1) { mutate(forcedScene); runFrames(forcedScene) }
assert.deepStrictEqual(plain(geometryMessages(forcedScene).at(-1)), plain(oracleCollapsed),
  'a mid-transition forced publish must be superseded by the settled geometry')
disposeForced()

// ── the toggle-label race (right rail) ──────────────────────────────────────
// The mirror image of the case above: the toggle already reports the rail
// collapsed while the rail itself is still docked and measurable. The label alone
// may not let the surface take space a rail is still occupying.
const raceScene = createBridgeScene()
const raceLoaded = loadPluginClient(clientFile, { scene: raceScene, exports: ['installWorkspaceGeometryBridge'] })
const disposeRace = raceLoaded.api.installWorkspaceGeometryBridge()
settle(raceScene, SETTLED_EXPANDED)
const beforeRace = geometryMessages(raceScene).length
raceScene.node(RIGHT_TOGGLE).setAttribute('aria-label', SETTLED_COLLAPSED.toggleLabel)
raceScene.fire('document', 'click', { target: toggleTarget })
mutate(raceScene)
runFrames(raceScene)
raceScene.flushTimers()
runFrames(raceScene)
const raceMessages = geometryMessages(raceScene).slice(beforeRace)
// T142 起**右栏盒子是唯一权威**：标签自报"已收起"、而栏位仍可测量时不得据此占位。
// 因此不再要求"标签变化必须发一条消息"（没有几何变化就不发布也是正确行为）；
// 只要求任何发出的几何都不得覆盖仍停靠的栏位 —— 一条都没发时父窗口保留上一份
// （仍是停靠态）几何，同样正确。
for (const geometry of raceMessages) {
  assert(geometry.rightBoundary <= RAIL_LEFT + 4,
    `the collapsed label must not cover a rail that is still docked: ${JSON.stringify(geometry)}`)
}
disposeRace()

// 4. A settled scene stays quiet: the dedupe must survive the churn.
const countBefore = geometryMessages(scene).length
for (let index = 0; index < 3; index += 1) { mutate(scene); runFrames(scene); scene.flushTimers() }
assert.strictEqual(geometryMessages(scene).length, countBefore,
  'the bridge must not republish an unchanged geometry')

dispose()
for (const observer of scene.observers.mutation) {
  assert.strictEqual(observer.observed.length, 0, 'disposing the bridge must stop observing')
}

console.log('codesys sidebar geometry behaviour test passed')
