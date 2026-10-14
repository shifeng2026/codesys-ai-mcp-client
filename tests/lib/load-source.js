'use strict'

// Load the REAL browser-side application sources into a Node `vm` context so a
// test can drive their functions with the stub document/window from
// `mini-dom.js`.
//
// Two shapes are supported, because TaskHive ships two of them:
//
//   1. `loadRendererScript` — `app/renderer/renderer.js` is a classic script
//      whose top-level `function` declarations become context globals. Instead
//      of copying a function into the test, the loader appends one epilogue
//      line to the real source that hands the named bindings to the test. If a
//      binding is renamed or removed the epilogue throws a ReferenceError and
//      the test fails loudly — it can never silently test a stale copy.
//
//   2. `loadPluginClient` — `plugins/installed/taskhive-surfaces/dsh/client.js`
//      is a DSH client bundle: `window.__ModuleLoader__.load({ id, factory })`.
//      The loader captures the factory, stubs `require('react')`, and appends
//      one line that exports the named factory-scope bindings on
//      `module.exports.__taskhiveTestExports`. The factory's own module-scope
//      statements run for real; the React components it defines are only
//      *registered*, not rendered (a test that needs a component render drives
//      it through `createHookRuntime`).
//
// Neither loader modifies the file on disk, and neither reimplements any
// application logic: the assertions run against the real source text.

const { readFileSync } = require('node:fs')
const vm = require('node:vm')

function buildGlobals (scene, extra = {}) {
  const sandbox = {
    window: scene.window,
    document: scene.document,
    location: scene.window.location,
    navigator: { userAgent: 'taskhive-contract-test', platform: 'win32' },
    getComputedStyle: scene.getComputedStyle,
    requestAnimationFrame: scene.requestAnimationFrame,
    cancelAnimationFrame: scene.cancelAnimationFrame,
    setTimeout: scene.setTimeout,
    clearTimeout: scene.clearTimeout,
    setInterval: scene.setInterval,
    clearInterval: scene.clearInterval,
    MutationObserver: scene.MutationObserver,
    ResizeObserver: scene.ResizeObserver,
    performance: { now: () => Date.now() },
    console,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    // In a browser the global `localStorage` and `window.localStorage` are the SAME object.
    // The plugin code reads it through `window.localStorage`, so the sandbox must hand over
    // the scene's store rather than a private copy — otherwise a preference the app "remembers"
    // would be invisible to the test (and a test-set preference invisible to the app).
    localStorage: scene.window?.localStorage || {
      _store: new Map(),
      getItem (key) { return this._store.has(String(key)) ? this._store.get(String(key)) : null },
      setItem (key, value) { this._store.set(String(key), String(value)) },
      removeItem (key) { this._store.delete(String(key)) },
      clear () { this._store.clear() },
    },
    sessionStorage: null,
    matchMedia: () => ({ matches: false, addEventListener () {}, removeEventListener () {} }),
    screen: { width: scene.viewport.width, height: scene.viewport.height },
    Event: class Event {
      constructor (type, init = {}) { this.type = type; Object.assign(this, init) }
      preventDefault () {}
      stopPropagation () {}
    },
    CustomEvent: class CustomEvent {
      constructor (type, init = {}) { this.type = type; this.detail = init?.detail; Object.assign(this, init) }
      preventDefault () {}
      stopPropagation () {}
    },
    KeyboardEvent: class KeyboardEvent { constructor (type, init = {}) { this.type = type; Object.assign(this, init) } },
    MouseEvent: class MouseEvent { constructor (type, init = {}) { this.type = type; Object.assign(this, init) } },
    PointerEvent: class PointerEvent { constructor (type, init = {}) { this.type = type; Object.assign(this, init) } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 },
    Element: class Element {},
    HTMLElement: class HTMLElement {},
    Image: class Image { constructor () { this.style = {} } },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
    ...extra,
  }
  sandbox.sessionStorage = sandbox.localStorage
  sandbox.globalThis = sandbox
  return sandbox
}

function exportsEpilogue (names, globalName) {
  const pairs = names.map((name) => `${JSON.stringify(name)}: ${name}`).join(', ')
  return `\n;globalThis.${globalName} = { ${pairs} };\n`
}

function loadRendererScript (file, { scene, exports, extraGlobals = {} } = {}) {
  const source = readFileSync(file, 'utf8')
  const script = source + exportsEpilogue(exports, '__TEST_EXPORTS__')
  const sandbox = buildGlobals(scene, extraGlobals)
  const context = vm.createContext(sandbox)
  // The renderer's trailing bootstrap IIFE is async and runs after this call;
  // it is answered by the `taskhive` stub on the scene's window.
  new vm.Script(script, { filename: file }).runInContext(context)
  const api = context.__TEST_EXPORTS__
  if (!api) throw new Error(`${file}: the epilogue did not run — the script failed before its end`)
  return { api, context, scene, source }
}

function loadPluginClient (file, { scene, exports, extraGlobals = {}, react } = {}) {
  const source = readFileSync(file, 'utf8')
  const anchor = '    module.exports.apply = apply'
  const index = source.indexOf(anchor)
  if (index < 0) throw new Error(`${file}: cannot find "${anchor}" — the client bundle shape changed`)
  const pairs = exports.map((name) => `${JSON.stringify(name)}: ${name}`).join(', ')
  const injected = `${source.slice(0, index)}    module.exports.__taskhiveTestExports = { ${pairs} }\n${source.slice(index)}`

  let captured = null
  scene.window.__ModuleLoader__ = { load: (definition) => { captured = definition } }
  const sandbox = buildGlobals(scene, extraGlobals)
  const context = vm.createContext(sandbox)
  new vm.Script(injected, { filename: file }).runInContext(context)
  if (!captured) throw new Error(`${file}: window.__ModuleLoader__.load was never called`)
  if (typeof captured.factory !== 'function') throw new Error(`${file}: the loaded definition has no factory`)

  const reactShim = react || createReactShim()
  const moduleExports = captured.factory((id) => {
    if (id === 'react') return reactShim.React
    throw new Error(`the client bundle tried to require(${JSON.stringify(id)}); the test only stubs "react"`)
  })
  const api = moduleExports.__taskhiveTestExports
  if (!api) throw new Error(`${file}: the injected export line did not run`)
  return { api, moduleExports, context, scene, source, react: reactShim }
}

// A minimal React implementation for driving a REAL component function.
//
// The components in the client bundle are ordinary functions that call hooks.
// This runtime gives them real hook semantics — stable refs across renders,
// state setters that trigger a re-render, effects that run when their deps
// change — without any DOM or scheduler. Component output is a plain element
// descriptor, so no renderer is needed to make the component body execute.
//
// It exists so a behaviour test can drive the workbench component (selection,
// drafts, online reconciliation) instead of asserting on its source text.
function createReactShim (options = {}) {
  const maxPasses = options.maxPasses ?? 50
  let slots = []
  let cursor = 0
  let pendingRender = false
  let current = null

  const sameDeps = (left, right) => {
    if (!left || !right || left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }

  const scheduleRender = () => { pendingRender = true }

  class Component {
    constructor (props) { this.props = props || {}; this.state = {}; this.context = undefined }
    setState (next) {
      const patch = typeof next === 'function' ? next(this.state) : next
      this.state = { ...this.state, ...patch }
    }
    forceUpdate () {}
    render () { return null }
  }
  Component.prototype.isReactComponent = {}

  const React = {
    Component,
    PureComponent: Component,
    createElement (type, props, ...children) {
      return { type, props: props || {}, children: children.length > 1 ? children : children[0] }
    },
    Fragment: Symbol.for('react.fragment'),
    memo: (component) => component,
    forwardRef: (component) => component,
    createContext: (value) => ({ Provider: ({ children }) => children, Consumer: () => null, _currentValue: value }),
    cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
    isValidElement: (value) => Boolean(value && typeof value === 'object' && 'type' in value),
    Children: { toArray: (value) => (Array.isArray(value) ? value : [value]).filter(Boolean) },
    useRef (initial) {
      const slot = slots[cursor++] || (slots[cursor - 1] = { kind: 'ref', value: { current: initial } })
      return slot.value
    },
    useState (initial) {
      const index = cursor++
      const slot = slots[index] || (slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial })
      if (!slot.setter) {
        slot.setter = (next) => {
          const value = typeof next === 'function' ? next(slot.value) : next
          if (Object.is(value, slot.value)) return
          slot.value = value
          scheduleRender()
        }
      }
      return [slot.value, slot.setter]
    },
    useReducer (reducer, initial) {
      const index = cursor++
      const slot = slots[index] || (slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial })
      if (!slot.setter) {
        slot.setter = (action) => {
          const value = reducer(slot.value, action)
          if (Object.is(value, slot.value)) return
          slot.value = value
          scheduleRender()
        }
      }
      return [slot.value, slot.setter]
    },
    useMemo (factory, deps) {
      const index = cursor++
      const slot = slots[index]
      if (slot && sameDeps(slot.deps, deps)) return slot.value
      const value = factory()
      slots[index] = { kind: 'memo', value, deps }
      return value
    },
    useCallback (callback, deps) {
      const index = cursor++
      const slot = slots[index]
      if (slot && sameDeps(slot.deps, deps)) return slot.value
      slots[index] = { kind: 'callback', value: callback, deps }
      return callback
    },
    useEffect (effect, deps) {
      const index = cursor++
      const slot = slots[index]
      if (!slot) {
        slots[index] = { kind: 'effect', effect, deps, cleanup: undefined, hasRun: false, dirty: true }
        return
      }
      if (!sameDeps(slot.deps, deps)) {
        slot.effect = effect
        slot.deps = deps
        slot.dirty = true
      }
    },
    useLayoutEffect (effect, deps) { React.useEffect(effect, deps) },
    useInsertionEffect (effect, deps) { React.useEffect(effect, deps) },
    useSyncExternalStore (subscribe, getSnapshot, getServerSnapshot) {
      return (getSnapshot || getServerSnapshot || (() => null))()
    },
    useId: () => 'test-id',
    useTransition: () => [false, (callback) => callback()],
    startTransition: (callback) => callback(),
    version: 'taskhive-test-shim',
  }

  // Renders `component(props)` until state settles, running effects after each
  // pass whose deps changed (React's own ordering, minus the scheduler).
  const render = (component, props) => {
    let output = null
    let pass = 0
    let effectSweep = false
    do {
      pendingRender = false
      cursor = 0
      output = component(props)
      pass += 1
      for (const slot of slots) {
        if (slot?.kind !== 'effect' || !slot.dirty) continue
        slot.dirty = false
        try { slot.cleanup?.() } catch { /* cleanup failures belong to the component */ }
        slot.hasRun = true
        slot.cleanup = slot.effect()
      }
      effectSweep = pendingRender
      if (pass > maxPasses) throw new Error(`component did not settle after ${maxPasses} renders`)
      if (effectSweep) current?.onRerender?.()
    } while (pendingRender)
    return { output, passes: pass }
  }

  const unmount = () => {
    for (const slot of slots) {
      if (slot?.kind !== 'effect') continue
      try { slot.cleanup?.() } catch { /* ignore */ }
      slot.cleanup = undefined
    }
  }

  return { React, render, unmount, hooks: () => slots, setCurrent: (value) => { current = value } }
}

module.exports = { buildGlobals, loadRendererScript, loadPluginClient, createReactShim }
