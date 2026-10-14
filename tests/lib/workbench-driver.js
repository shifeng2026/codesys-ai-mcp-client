'use strict'

// Drives the REAL `CodesysWorkbench` React component headlessly.
//
// The component is the whole CODESYS code workbench: object tree, code editor,
// drafts, compile report and the online (PLC) panel. It lives inside the DSH
// client bundle as a function that calls React hooks, so this driver supplies a
// hook runtime (`createReactShim`) plus a stub `window.taskhive` bridge and a
// stub `ctx`, renders the component, and then interacts with it exactly the way
// the UI does: it walks the rendered element tree and calls the component's own
// `onClick` / `onChange` handlers. Nothing here reimplements component logic.
//
// The rendered tree is a plain descriptor tree (`{ type, props, children }`), so
// "what the user sees" is asserted by reading the same props the browser would
// turn into DOM attributes — e.g. `data-change-state`, `data-codesys-online-state`,
// `data-editor-part` — and the code text comes from the editor textarea's `value`.

const { join } = require('node:path')
const { createScene, createTaskhiveStub } = require('./mini-dom')
const { loadPluginClient } = require('./load-source')

const clientFile = join(__dirname, '..', '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js')

function createStubContext () {
  // The workbench reads narrow services off `ctx`; each one is an object whose
  // unknown members behave like async no-ops. Anything a scenario must control
  // is passed in explicitly.
  const section = new Proxy({}, {
    get (target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return async () => null
    },
  })
  return new Proxy({}, {
    get (target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return section
    },
  })
}

function flatten (value, into = []) {
  if (Array.isArray(value)) { for (const item of value) flatten(item, into); return into }
  if (value && typeof value === 'object' && 'type' in value) {
    into.push(value)
    flatten(value.children, into)
  }
  return into
}

function createWorkbenchDriver (options = {}) {
  const objects = options.objects || []
  const sourcePath = options.sourcePath || 'C:/projects/demo.project'
  const jobId = options.jobId || 'direct-1'
  const ipcCalls = []
  let onlineStatus = options.onlineStatus || { ok: true, running: false }
  const scene = createScene({
    viewport: options.viewport || { width: 1400, height: 900 },
    nodes: options.nodes || {},
    taskhive: createTaskhiveStub({
      currentCodesysProject: async () => ({ found: true, sourcePath, detection: 'monitored-window', writeAvailable: true, activeGui: true }),
      runCodesysScriptEngineAction: async (action, input) => {
        ipcCalls.push({ action, input })
        if (action === 'bind-project') return { sourcePath, jobId, writeAvailable: true, writeBlockReason: '' }
        if (action === 'inspect-project') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(objects)) } }
        if (action === 'apply-and-build') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(objects)) } }
        return { status: 'complete', payload: {} }
      },
      codesysOnlineStatus: async () => (typeof onlineStatus === 'function' ? onlineStatus() : onlineStatus),
      codesysScriptEngineStatus: async () => ({ ready: true, version: 'V3.5 SP20', missing: [] }),
      ...(options.taskhive || {}),
    }),
  })

  // `sourceFile` exists so a reviewer can point the driver at a mutated copy of
  // the bundle to check that this driver's assertions really detect a
  // regression; the suite always uses the shipped file.
  //
  // T183: `extraGlobals` / `ownerSessionId` were added so a behaviour test can give
  // the component a virtual clock plus a counting `fetch` (the workbench talks to
  // its host half through same-origin fetch, not through preload IPC) and a real
  // session id — the pending-proposal claim effect only runs with a session on
  // screen. Both are opt-in; existing callers see exactly the previous behaviour.
  const loaded = loadPluginClient(options.sourceFile || clientFile, { scene, exports: ['CodesysWorkbench'], extraGlobals: options.extraGlobals })
  const runtime = loaded.react
  const component = loaded.api.CodesysWorkbench
  if (typeof component !== 'function') throw new Error('the client bundle no longer exports CodesysWorkbench')
  // One stable ctx, like the host provides: a fresh object per render would make
  // every `[ctx, …]` effect dependency change on every pass.
  const ctx = createStubContext()

  let output = null
  const render = () => {
    const result = runtime.render(component, { ctx, ownerSessionId: options.ownerSessionId })
    output = result.output
    return result
  }

  const tick = () => new Promise((resolve) => setImmediate(resolve))

  // Renders until the component's async work (detect → bind → inspect, or an
  // online poll) has settled. Bounded so a stuck implementation fails the test
  // instead of hanging it.
  const settle = async (rounds = options.rounds || 12) => {
    for (let index = 0; index < rounds; index += 1) {
      scene.flushTimers()
      await tick()
      render()
    }
    return output
  }

  const nodes = () => flatten(output)

  const findAll = (predicate) => nodes().filter((element) => predicate(element.props || {}, element))
  const find = (predicate) => findAll(predicate)[0] || null

  const findTreeRow = (name) => find((props) => props.role === 'treeitem' && props['data-codesys-object-name'] === name)
  const findEditor = (part) => find((props) => props['data-editor-part'] === part)

  const driver = {
    scene,
    ipcCalls,
    render,
    settle,
    nodes,
    find,
    findAll,
    // ── the gestures a user can make ────────────────────────────────────────
    clickTreeRow (name) {
      const row = findTreeRow(name)
      if (!row) throw new Error(`the project tree has no row for ${name}`)
      row.props.onClick()
      return render()
    },
    typeInEditor (part, text) {
      const editor = findEditor(part)
      if (!editor) throw new Error(`the code editor has no ${part} section`)
      editor.props.onChange({ target: { value: text } })
      return render()
    },
    // ── what the user can see ───────────────────────────────────────────────
    treeRowNames: () => findAll((props) => props.role === 'treeitem').map((element) => element.props['data-codesys-object-name']),
    treeChangeState: (name) => findTreeRow(name)?.props['data-change-state'] ?? null,
    treeSelected: (name) => findTreeRow(name)?.props['data-selected'] ?? null,
    editorValue: (part) => findEditor(part)?.props.value ?? null,
    editorSections: () => findAll((props) => 'data-editor-part' in props).map((element) => element.props['data-editor-part']),
    onlineChipState: () => find((props) => 'data-codesys-online-state' in props)?.props['data-codesys-online-state'] ?? null,
    // The bottom status row only renders a PLC state text while the workbench
    // believes it is connected, so `null` here means "no stale connected text".
    onlineStateText: () => {
      const element = find((props) => props['data-codesys-online-state-text'] === 'true')
      if (!element) return null
      return flatten(element.children).length || typeof element.children === 'string' ? element.children : null
    },
    // The status row renders the status string plus optional busy/online
    // suffixes, so its `children` is a mixed array. Tests want the sentence, not
    // the element descriptors: flatten it to the visible text.
    statusText: () => {
      const element = find((props) => props['data-codesys-workbench-status'] === 'true')
      if (!element) return null
      const parts = Array.isArray(element.children) ? element.children : [element.children]
      return parts.filter((item) => typeof item === 'string').join('') || null
    },
    setOnlineStatus (next) { onlineStatus = next },
    setObjects (next) { objects.length = 0; for (const item of next) objects.push(item) },
    unmount: () => runtime.unmount(),
  }
  return driver
}

module.exports = { createWorkbenchDriver, clientFile }
