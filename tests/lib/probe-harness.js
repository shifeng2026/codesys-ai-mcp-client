'use strict'

// A test double for the main-process probe context.
//
// Why this exists: the packaged smoke probes (app/smoke/probes.js) talk to
// Electron through a narrow context object, and five of them used to compute an
// `ok` verdict that nothing ever read. "The probe throws now" is a claim that has
// to be executable, not asserted from source text, because the interesting part
// (does the enforced failure actually reach the caller?) only exists at runtime.
//
// Two pieces:
//
//   1. `createRecordingFrame` — a frame/webContents double whose
//      `executeJavaScript` answers from declared matchers and whose selector
//      lookups go through a STRICT mini-dom scene. A selector a scenario did not
//      declare throws MINI_DOM_MISSING_SELECTOR instead of reading as "absent",
//      which is what turns a deliberately mistyped selector into a red probe.
//
//   2. `createProbeContext` — the ctx object probes.js destructures, with live
//      getters like main.js has, a temp `root` so evidence writes never touch the
//      shipped logs directory, and a `openSurfaceForProbe` that mirrors the real
//      knowledge branch (DSH frame + strict selector poll).
//
// Nothing here reimplements probe logic; assertions run against the real module.

const fs = require('node:fs')
const path = require('node:path')
const { createScene } = require('./mini-dom')
const { createTempDir } = require('./temp-dir')

// T197：这里以前**只建不删** —— 每次进程（= 每个契约）建 14 个 `taskhive-probe-harness-*`
// 目录就再也不管。真机实测 %TEMP% 里累积了 **4,084 个 `taskhive-*` 目录 / 78.61 MB**
// （其中 521 个是当天新建的），是这套测试当时最大的"只写不回收"路径。
// T198：回收机制收成**唯一一份**（`tests/lib/temp-dir.js`），于是这一路和其余 29 个调用点
// 共用同一段代码 —— 成功时回收、失败时保留取证、只删本进程自己建的目录。
const createTempRoot = () => createTempDir('taskhive-probe-harness-', { logs: true })

function matchHandler (handlers, code) {
  for (const handler of handlers) {
    if (handler.match instanceof RegExp) {
      if (handler.match.test(code)) return handler
    } else if (typeof handler.match === 'string') {
      if (code.includes(handler.match)) return handler
    } else if (typeof handler.when === 'function' && handler.when(code)) {
      return handler
    }
  }
  return null
}

/**
 * A frame double.
 *
 * @param {object} options
 *   - `selectors`: selectors the strict mini-dom scene declares. A lookup for
 *     anything else THROWS (that is the wrong-selector proof).
 *   - `handlers`: [{ match: string|RegExp, value | fn(code) }] answered in order.
 *   - `fallback`: value (or fn) for a script no handler matched. Defaults to a
 *     function that throws, so an unexpected probe call is a loud test failure
 *     rather than a silent `undefined`.
 */
function createRecordingFrame (options = {}) {
  const selectors = options.selectors || []
  const handlers = options.handlers || []
  const calls = []
  const unmatched = []
  const scene = createScene({
    viewport: options.viewport || { width: 1200, height: 800 },
    nodes: Object.fromEntries(selectors.map((selector) => [selector, {}])),
    strictLookups: options.strictLookups !== false,
  })
  const fallback = options.fallback === undefined
    ? (code) => { const error = new Error(`probe harness: no canned response for ${JSON.stringify(String(code).slice(0, 200))}`); error.code = 'PROBE_HARNESS_UNMATCHED'; throw error }
    : options.fallback

  const frame = {
    name: options.name || 'frame',
    url: options.url || 'http://127.0.0.1:45678/',
    scene,
    calls,
    unmatched,
    // Selector presence, answered by the strict scene: an undeclared selector is
    // an error, exactly like a probe whose anchor was renamed or deleted.
    has: (selector) => Boolean(scene.document.querySelector(selector)),
    async executeJavaScript (code, _userGesture) {
      const source = String(code)
      calls.push(source)
      const handler = matchHandler(handlers, source)
      if (!handler) {
        unmatched.push(source)
        const value = typeof fallback === 'function' ? fallback(source) : fallback
        return value
      }
      return typeof handler.value === 'function' ? handler.value(source, frame) : handler.value
    },
  }
  return frame
}

/**
 * The ctx probes.js destructures. Getters mirror main.js so a probe always sees
 * the current surface state.
 */
function createProbeContext (options = {}) {
  const root = options.root || createTempRoot()
  const state = {
    pluginSurfaceAttached: options.pluginSurfaceAttached === true,
    pluginSurfaceKind: options.pluginSurfaceKind ?? null,
    pluginSurfaceBounds: options.pluginSurfaceBounds ?? null,
    lastSurfaceGeometry: options.lastSurfaceGeometry ?? null,
    activeWebAiViewId: null,
    webAiAttached: false,
    webAiView: null,
    splashWindow: options.splashWindow ?? null,
    mainWindow: options.mainWindow ?? null,
  }
  const windowList = options.windows || [{ id: 1, getTitle: () => 'TaskHive', getBounds: () => ({ x: 0, y: 0, width: 1280, height: 820 }), webContents: { getURL: () => 'http://127.0.0.1:45678/' } }]
  const frames = options.frames || {}
  const surfaceCalls = []
  // Mirrors DSH_RENDERED_SURFACES in app/main.js: these kinds are rendered inside
  // the DSH frame, so `showPluginSurface` hides the native overlay instead of
  // attaching one.
  const DSH_RENDERED_KINDS = new Set(options.dshRenderedKinds || ['knowledge'])

  const mainWindow = state.mainWindow || {
    isMenuBarVisible: () => false,
    isDestroyed: () => false,
    webContents: {
      getURL: () => 'http://127.0.0.1:45678/',
      isLoading: () => false,
      // A `surface.open chat` message is what the shell handles by detaching the
      // native overlay; modelling it keeps the probes' "wait until detached" loops
      // from burning their 30 x 100 ms budget.
      executeJavaScript: async (code) => {
        const source = String(code)
        if (source.includes('surface.open') && source.includes("'chat'")) {
          state.pluginSurfaceKind = null
          state.pluginSurfaceAttached = false
        }
        return true
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('harness-png') }),
    },
  }
  state.mainWindow = mainWindow

  const ctx = {
    // ── the members probes.js destructures ────────────────────────────────────
    BrowserWindow: {
      getAllWindows: () => windowList,
    },
    codesysExternalProgramLifecycle: options.codesysExternalProgramLifecycle || { launchPolicy: 'test' },
    codesysFixtureIdentityStable: options.codesysFixtureIdentityStable || (() => true),
    codesysFixtureLifecycleSnapshot: options.codesysFixtureLifecycleSnapshot || ((stage) => ({ stage, windows: [] })),
    codesysSmokeProjectPath: options.codesysSmokeProjectPath || (() => null),
    crypto: require('node:crypto'),
    currentHarnessFrame: () => options.harnessFrame ?? null,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    execFile: () => {},
    fs,
    hideWebAiView: () => {},
    modelCatalog: {},
    monitorVisibleConsoleWindows: async () => [],
    openSurfaceForProbe: options.openSurfaceForProbe || (async (kind, selector, _timeoutMs, _requestOpen) => {
      surfaceCalls.push({ kind, selector })
      const frame = frames[kind] || options.dshFrame
      // The real helper only reports a surface ready once its marker is really
      // rendered. `frame.has` runs that lookup in the strict scene, so a selector
      // the scenario never declared throws instead of resolving as "absent".
      if (selector && frame && frame.has(selector) !== true) {
        throw new Error(`Plugin surface timeout: ${kind} ${selector}`.trim())
      }
      if (DSH_RENDERED_KINDS.has(kind)) {
        // T143: a DSH-rendered surface must NOT attach the native overlay.
        if (!frame) throw new Error(`Plugin surface timeout: ${kind} ${selector || ''}`.trim())
        state.pluginSurfaceKind = null
        state.pluginSurfaceAttached = false
        return frame
      }
      state.pluginSurfaceKind = kind
      state.pluginSurfaceAttached = true
      state.pluginSurfaceBounds = state.pluginSurfaceBounds || { x: 0, y: 0, width: 700, height: 780 }
      return frame || { executeJavaScript: async () => ({}) }
    }),
    path,
    root,
    showPluginSurface: async (kind) => {
      state.pluginSurfaceKind = kind
      state.pluginSurfaceAttached = kind !== 'knowledge'
      return { kind }
    },
    visibleConsoleWindows: async () => options.visibleConsoleWindows || [],
    webAiBounds: () => ({ x: 0, y: 0, width: 600, height: 800 }),
    webAiViews: options.webAiViews || new Map(),
    webAiWindowState: () => ({ windows: [] }),
    webContents: {},
    // ── live state (getters, like main.js) ────────────────────────────────────
    get activeWebAiViewId () { return state.activeWebAiViewId },
    set activeWebAiViewId (value) { state.activeWebAiViewId = value },
    get codesysNativeHost () { return options.codesysNativeHost ?? null },
    get harness () { return options.harness || { status: () => ({ state: 'ready' }), runTool: async () => null } },
    get lastSurfaceGeometry () { return state.lastSurfaceGeometry },
    get mainWindow () { return state.mainWindow },
    get monitor () { return options.monitor || { listWindows: async () => [] } },
    get pluginSurfaceAttached () { return state.pluginSurfaceAttached },
    set pluginSurfaceAttached (value) { state.pluginSurfaceAttached = value === true },
    get pluginSurfaceBounds () { return state.pluginSurfaceBounds },
    get pluginSurfaceKind () { return state.pluginSurfaceKind },
    get pluginSurfaceView () { return options.pluginSurfaceView ?? null },
    get repositories () { return options.repositories || { knowledge: { sync: async () => ({ state: 'synchronized', clients: 1, conflicts: 0 }) } } },
    get runtimeRoot () { return root },
    get splashWindow () { return state.splashWindow },
    get webAiAttached () { return state.webAiAttached },
    get webAiView () { return state.webAiView },
    set webAiView (value) { state.webAiView = value },
    // ── harness-only controls ─────────────────────────────────────────────────
    __state: state,
    __surfaceCalls: surfaceCalls,
  }
  return ctx
}

function createProbes (ctx, modulePath) {
  // eslint-disable-next-line global-require
  const create = require(modulePath || path.resolve(__dirname, '..', '..', 'app', 'smoke', 'probes.js'))
  return create(ctx)
}

module.exports = { createRecordingFrame, createProbeContext, createProbes, createTempRoot }
