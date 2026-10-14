'use strict'

// Scenario: 切换页面时请求返回 — a CODESYS window-list refresh that resolves
// AFTER the user switched surface/pane must not write into the new pane's DOM.
//
// `refreshWindows()` in `app/renderer/renderer.js` captures `#window-list`
// before it awaits the host, and writes the enumeration result when the host
// answers. If the user switched away in the meantime, the surface is re-rendered
// and the captured element is detached while a brand-new `#window-list` lives in
// the new pane. Writing into "whatever `#window-list` is now" would repaint the
// new pane with the old pane's answer (or, on failure, with "窗口枚举失败"),
// which is the visible race the lifecycle guards exist for.
//
// This loads the real renderer script in a `vm` context with a stub document and
// drives the real function with a deferred host call, so the timing is exact:
// the pane is swapped while the request is in flight.

const assert = require('node:assert')
const { join } = require('node:path')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadRendererScript } = require('./lib/load-source')

const rendererFile = join(__dirname, '..', 'app', 'renderer', 'renderer.js')
const WINDOW_LIST = '#window-list'
const PLACEHOLDER = '<option value="">正在枚举窗口…</option>'
const FAILED = '<option value="">窗口枚举失败</option>'

const WINDOWS = [
  { id: '0x101', pid: 4100, title: 'alpha.project - CODESYS', width: 1600, height: 900, usable: true, windowPhase: 'main' },
  { id: '0x102', pid: 4100, title: 'Library Manager', width: 900, height: 600, usable: true, windowPhase: 'dialog' },
]

function deferred () {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function createRenderer (hostCall) {
  const scene = createScene({
    viewport: { width: 1200, height: 800 },
    nodes: {
      '#surface': {},
      '#activity': {},
      '#plugin-overlay': {},
      '#plugin-content': {},
      '#left-plugin-nav': {},
      '#right-plugin-nav': {},
      '#harness-state': {},
      '#input-status': {},
      [WINDOW_LIST]: { rect: { left: 0, top: 0, width: 220, height: 30 } },
    },
    taskhive: createTaskhiveStub({
      harnessStatus: async () => ({ runtime: { state: 'ready' } }),
      listPlugins: async () => [],
      harnessUrl: async () => null,
      listCodesysWindows: hostCall,
    }),
  })
  const loaded = loadRendererScript(rendererFile, { scene, exports: ['refreshWindows', 'state'] })
  assert.strictEqual(typeof loaded.api.refreshWindows, 'function',
    'app/renderer/renderer.js must still define refreshWindows()')
  return loaded
}

// Simulates the user switching surface: the pane that owned the node is torn
// down and a NEW node is what `#window-list` resolves to now.
function swapPane (scene) {
  const oldNode = scene.node(WINDOW_LIST)
  oldNode.isConnected = false
  const nextNode = scene.document.createElement('select')
  scene.single.set(WINDOW_LIST, nextNode)
  return { oldNode, nextNode }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function main () {
  // ── 1. success answer arriving after the pane was replaced ────────────────
  {
    const call = deferred()
    const { api, scene } = createRenderer(() => call.promise)
    const original = scene.node(WINDOW_LIST)

    const pending = api.refreshWindows()
    // The placeholder write happens synchronously, before the await.
    assert.strictEqual(original.innerHTML, PLACEHOLDER,
      'the refresh must mark the list it owns before awaiting the host')

    const { nextNode } = swapPane(scene)
    call.resolve(WINDOWS)
    const selected = await pending
    await tick()

    assert.strictEqual(selected, null,
      'a refresh whose list was detached must report that it published nothing')
    assert.strictEqual(nextNode.innerHTML, '',
      `the new pane must not receive the stale enumeration result (saw ${JSON.stringify(nextNode.innerHTML)})`)
    assert.strictEqual(original.innerHTML, PLACEHOLDER,
      'the detached list must keep whatever it owned; the result belongs to a pane that is gone')
    assert.strictEqual(api.state.windows.length, WINDOWS.length,
      'the host answer must still be recorded in renderer state')
  }

  // ── 2. failure answer arriving after the pane was replaced ───────────────
  {
    const call = deferred()
    const { api, scene } = createRenderer(() => call.promise)
    const pending = api.refreshWindows()
    const { nextNode } = swapPane(scene)
    call.reject(new Error('host unavailable'))
    const selected = await pending
    await tick()

    assert.strictEqual(selected, null, 'a failed refresh must resolve to null')
    assert.strictEqual(nextNode.innerHTML, '',
      `the failure banner must not be written into the new pane (saw ${JSON.stringify(nextNode.innerHTML)})`)
    assert(!nextNode.innerHTML.includes(FAILED), 'the stale failure path must stay out of the live pane')
  }

  // ── 3. control: while the list is still connected the result IS published ─
  // Without this, the assertions above would also hold for a refresh that never
  // writes anything at all.
  {
    const call = deferred()
    const { api, scene } = createRenderer(() => call.promise)
    const node = scene.node(WINDOW_LIST)
    const pending = api.refreshWindows()
    call.resolve(WINDOWS)
    const selected = await pending
    await tick()

    assert(selected && selected.id === WINDOWS[0].id,
      'the refresh must select a usable window from the host answer')
    assert(node.innerHTML.includes('alpha.project - CODESYS'),
      'a connected list must receive the enumerated windows')
    assert(node.innerHTML.includes('PID 4100'), 'the option text must carry the PID')
    assert(!node.innerHTML.includes(PLACEHOLDER), 'the placeholder must be replaced by the answer')
    assert.strictEqual(typeof node.onchange, 'function', 'the refreshed list must still own its change handler')
  }

  // ── 4. the guard must not wedge refreshing for the new pane ──────────────
  {
    const first = deferred()
    const second = deferred()
    let calls = 0
    const { api, scene } = createRenderer(() => (calls++ === 0 ? first.promise : second.promise))
    const pending = api.refreshWindows()
    const { nextNode } = swapPane(scene)
    first.resolve(WINDOWS)
    await pending

    // The user is now on the new pane and asks again.
    const retry = api.refreshWindows()
    second.resolve(WINDOWS)
    await retry
    await tick()
    assert(nextNode.innerHTML.includes('alpha.project - CODESYS'),
      'once the request belongs to a live pane again the result must be published')
  }

  console.log('codesys window refresh race behaviour test passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
