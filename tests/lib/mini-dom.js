'use strict'

// A tiny, dependency-free DOM / window stub for behaviour tests.
//
// Why this exists: the TaskHive renderer (`app/renderer/renderer.js`) and the
// DSH client bundle (`plugins/installed/taskhive-surfaces/dsh/client.js`) are
// plain browser scripts with no module entry point, and the repo ships no DOM
// library and no test framework. Loading them in a Node `vm` context with this
// stub lets a test drive the REAL functions (selection guards, the geometry
// bridge, the draft store) instead of asserting that their source text contains
// a string.
//
// It is deliberately small: it models exactly the DOM surface those modules
// use — element identity, `isConnected`, attributes, rects, a per-scene
// `querySelector` registry, observers and deterministic timers. It is NOT a
// general DOM. Nothing here reimplements application logic.

class StubStyle {
  constructor () {
    this._values = new Map()
    this._props = {}
  }

  setProperty (name, value) { this._values.set(String(name), String(value)) }
  getPropertyValue (name) { return this._values.get(String(name)) || '' }
  removeProperty (name) { this._values.delete(String(name)) }
}

class StubClassList {
  constructor (node) { this._node = node }

  _set () {
    const raw = String(this._node._attributes.class || '')
    return new Set(raw.split(/\s+/).filter(Boolean))
  }

  _write (set) { this._node._attributes.class = [...set].join(' ') }
  add (...names) { const set = this._set(); for (const name of names) set.add(name); this._write(set) }
  remove (...names) { const set = this._set(); for (const name of names) set.delete(name); this._write(set) }
  contains (name) { return this._set().has(name) }
  toggle (name, force) {
    const set = this._set()
    const wanted = force === undefined ? !set.has(name) : force === true
    if (wanted) set.add(name); else set.delete(name)
    this._write(set)
    return wanted
  }
  get value () { return [...this._set()].join(' ') }
}

let nextNodeId = 1

class StubNode {
  constructor (tagName = 'div', owner = null) {
    this.nodeType = 1
    this.nodeName = String(tagName).toUpperCase()
    this.tagName = this.nodeName
    this.id = nextNodeId++
    this.ownerDocument = owner
    this.parentElement = null
    this.children = []
    this._attributes = Object.create(null)
    this._innerHTML = ''
    this._textContent = ''
    this.style = new StubStyle()
    this.classList = new StubClassList(this)
    this.dataset = new Proxy({}, {
      get: (_target, key) => this._attributes[`data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`],
      set: (_target, key, value) => { this._attributes[`data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`] = String(value); return true },
      has: (_target, key) => `data-${String(key).replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}` in this._attributes,
    })
    this.hidden = false
    this.disabled = false
    this.scrollTop = 0
    this.value = ''
    // Tests flip this to model "the pane that owned this node was torn down".
    this._connected = true
    this.listeners = new Map()
    this.observedBy = []
    this.rect = { left: 0, top: 0, width: 0, height: 0 }
  }

  get isConnected () { return this._connected === true }
  set isConnected (value) { this._connected = value === true }

  get innerHTML () { return this._innerHTML }
  set innerHTML (value) { this._innerHTML = String(value ?? '') }

  get textContent () { return this._textContent }
  set textContent (value) { this._textContent = String(value ?? '') }

  get outerHTML () { return this._innerHTML }

  setAttribute (name, value) { this._attributes[String(name)] = String(value) }
  getAttribute (name) { const value = this._attributes[String(name)]; return value === undefined ? null : value }
  removeAttribute (name) { delete this._attributes[String(name)] }
  hasAttribute (name) { return String(name) in this._attributes }
  // `toggleAttribute(name, force)` 是标准 DOM API，产品代码真的在用它
  // （`dsh/src/00-core-and-surfaces.js` 的 `setPluginSurfaceMode` 用它打
  // `data-taskhive-plugin-surface-active`）。缺了它，任何走到 `openSurface()` 的场景都会在
  // 这一步炸掉 —— 那不是被测代码的问题，而是替身少了一个 API。
  toggleAttribute (name, force) {
    const key = String(name)
    const on = force === undefined ? !(key in this._attributes) : force === true
    if (on) this._attributes[key] = ''
    else delete this._attributes[key]
    return on
  }

  appendChild (child) { if (child) { this.children.push(child); child.parentElement = this } return child }
  removeChild (child) { this.children = this.children.filter((item) => item !== child); if (child) child.parentElement = null; return child }
  insertBefore (child) { return this.appendChild(child) }
  replaceChildren (...children) { this.children = []; for (const child of children) this.appendChild(child) }
  append (...children) { for (const child of children) this.appendChild(child) }
  prepend (...children) { for (const child of children) this.children.unshift(child) }
  get firstElementChild () { return this.children[0] || null }
  get lastElementChild () { return this.children[this.children.length - 1] || null }
  get childNodes () { return this.children.slice() }
  get nextSibling () { return null }
  insertAdjacentHTML (_position, markup) { this._innerHTML += String(markup ?? '') }
  insertAdjacentElement (_position, element) { return this.appendChild(element) }
  cloneNode () { return new StubNode(this.tagName, this.ownerDocument) }
  getElementsByTagName () { return [] }
  get offsetWidth () { return this.rect?.width || 0 }
  get offsetHeight () { return this.rect?.height || 0 }
  remove () { this._connected = false; this.parentElement?.removeChild(this) }
  contains (node) { return node === this || this.children.includes(node) }
  closest () { return null }
  matches () { return false }
  focus () {}
  blur () {}
  click () { this.dispatchEvent({ type: 'click', target: this }) }
  scrollIntoView () {}
  getClientRects () { return this.isConnected ? [this.getBoundingClientRect()] : [] }

  getBoundingClientRect () {
    const rect = this.rect || {}
    const left = Number(rect.left) || 0
    const top = Number(rect.top) || 0
    const width = Number(rect.width) || 0
    const height = Number(rect.height) || 0
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }
  }

  setRect (left, top, width, height) { this.rect = { left, top, width, height }; return this }

  addEventListener (type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
  }

  removeEventListener (type, handler) { this.listeners.get(type)?.delete(handler) }

  dispatchEvent (event) {
    const payload = event && typeof event === 'object' ? event : { type: String(event) }
    for (const handler of this.listeners.get(payload.type) || []) handler(payload)
    return true
  }

  querySelector () { return null }
  querySelectorAll () { return [] }
}

// `createScene` builds one controlled document. Everything the modules under
// test can look up is declared up front, so a test can mutate a rect or an
// attribute between animation frames and know exactly what the code will read.
// A selector a test never declared resolves to null / [], exactly like a real
// miss — correct for the APPLICATION code under test (a real DOM also returns
// null), but silently wrong for an ASSERTION: "the node I expect is not there"
// reads as "the feature is absent" or, worse, as "no overlay was found, so the
// overlay check passed".
//
// `strictLookups` + the `require*` helpers below are that failure path. Every
// lookup the scene cannot answer is recorded in `misses`, so a test can also
// assert "this scenario performed no undeclared lookups at all". Enabling strict
// mode makes a miss throw (code MINI_DOM_MISSING_SELECTOR) instead of returning
// an empty result — used by tests/smoke-probe-honesty-contract.js, where a
// mistyped probe selector must turn the probe red.
function createScene (options = {}) {
  const viewport = { width: options.viewport?.width ?? 1200, height: options.viewport?.height ?? 800 }
  const cssVars = new Map(Object.entries(options.cssVars || {}))
  // selector -> node (single) and selector -> nodes (list). A selector a test
  // never declared resolves to null / [], exactly like a real miss.
  const single = new Map()
  const lists = new Map()
  const misses = []
  let strictLookups = options.strictLookups === true

  const missingSelectorError = (selector, kind) => {
    const error = new Error(
      `mini-dom-missing-selector: no ${kind} node was declared for ${JSON.stringify(String(selector))} ` +
      `(declared singles: ${single.size}, declared lists: ${lists.size}). ` +
      'Declare it through createScene({ nodes | lists }) — a lookup that can never match must not pass as "empty".'
    )
    error.code = 'MINI_DOM_MISSING_SELECTOR'
    error.selector = String(selector)
    return error
  }

  const noteSelectorMiss = (selector, kind) => {
    misses.push({ selector: String(selector), kind })
    if (strictLookups) throw missingSelectorError(selector, kind)
    return null
  }

  const documentElement = new StubNode('html')
  const head = new StubNode('head')
  const body = new StubNode('body')
  const root = new StubNode('div')
  root.setAttribute('id', 'root')
  const document = new StubNode('#document')
  document.documentElement = documentElement
  document.head = head
  document.body = body
  document.visibilityState = options.visibilityState || 'visible'
  document.title = ''

  const timers = []
  const allTimers = new Map()
  let timerSeq = 0
  const frames = []
  const observers = { mutation: [], resize: [] }
  const listeners = new Map()

  const addListener = (target, type, handler) => {
    const key = `${target}:${type}`
    if (!listeners.has(key)) listeners.set(key, new Set())
    // `addEventListener(..., true)` (capture) is accepted and fired on dispatch:
    // the ordering difference does not matter for the code under test.
    listeners.get(key).add(handler)
    return handler
  }
  const removeListener = (target, type, handler) => { listeners.get(`${target}:${type}`)?.delete(handler) }

  const fire = (target, type, event = {}) => {
    const payload = { type, target: event.target || null, ...event }
    if (target === 'document') return document.dispatchEvent(payload)
    if (target === 'window') return windowStub.dispatchEvent(payload)
    return target?.dispatchEvent?.(payload)
  }

  const register = (selector, node) => { single.set(selector, node); return node }
  const makeNode = (selector, rect) => {
    const node = new StubNode('div', document)
    if (rect) node.rect = rect
    register(selector, node)
    return node
  }

  // Declared single-selector nodes.
  for (const [selector, descriptor] of Object.entries(options.nodes || {})) {
    const node = makeNode(selector, descriptor.rect)
    if (descriptor.attributes) for (const [name, value] of Object.entries(descriptor.attributes)) node.setAttribute(name, value)
    if (descriptor.rect) node.rect = descriptor.rect
  }
  // Declared list-selector nodes.
  for (const [selector, descriptors] of Object.entries(options.lists || {})) {
    lists.set(selector, descriptors.map((descriptor) => {
      const node = new StubNode('div', document)
      if (descriptor.rect) node.rect = descriptor.rect
      if (descriptor.attributes) for (const [name, value] of Object.entries(descriptor.attributes)) node.setAttribute(name, value)
      return node
    }))
  }

  document.querySelector = (selector) => {
    const key = String(selector)
    if (single.has(key)) return single.get(key)
    return noteSelectorMiss(key, 'single')
  }
  document.querySelectorAll = (selector) => {
    const key = String(selector)
    if (lists.has(key)) return lists.get(key)
    noteSelectorMiss(key, 'list')
    return []
  }
  document.getElementById = (id) => {
    const selector = `#${id}`
    if (!single.has(selector)) {
      // Fabricating an empty node is the same silent-empty behaviour as a
      // `querySelector` miss: an assertion that reads `.textContent` off it then
      // sees '' and reports success. Fabrication stays (real renderer code
      // tolerates a missing node) but is on the record, and strict mode refuses.
      noteSelectorMiss(selector, 'id')
      register(selector, new StubNode('div', document))
    }
    return single.get(selector)
  }
  document.createElement = (tag) => new StubNode(tag, document)
  document.createTextNode = (text) => { const node = new StubNode('#text', document); node.nodeType = 3; node.textContent = text; return node }
  document.addEventListener = (type, handler) => addListener('document', type, handler)
  document.removeEventListener = (type, handler) => removeListener('document', type, handler)
  document.dispatchEvent = (event) => {
    const payload = event && typeof event === 'object' ? event : { type: String(event) }
    for (const handler of [...(listeners.get(`document:${payload.type}`) || [])]) handler(payload)
    for (const handler of [...(listeners.get(`document:${payload.type}:capture`) || [])]) handler(payload)
    return true
  }

  class FakeMutationObserver {
    constructor (callback) { this.callback = callback; this.observed = []; observers.mutation.push(this) }
    observe (node, opts) { this.observed.push({ node, opts }); node?.observedBy?.push?.(this) }
    disconnect () { this.observed = [] }
    takeRecords () { return [] }
    // Test-side driver: deliver mutation records through the REAL callback.
    fire (records = []) { this.callback(records, this) }
  }

  class FakeResizeObserver {
    constructor (callback) { this.callback = callback; this.observed = []; observers.resize.push(this) }
    observe (node) { this.observed.push(node) }
    unobserve () {}
    disconnect () { this.observed = [] }
    fire (entries = []) { this.callback(entries, this) }
  }

  const posted = []
  const windowStub = {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    devicePixelRatio: 1,
    location: { href: 'http://127.0.0.1/taskhive/index.html', hash: options.hash || '', search: options.search || '' },
    parent: { postMessage: (message) => { posted.push({ channel: 'parent', message }) } },
    postMessage: (message) => { posted.push({ channel: 'self', message }) },
    addEventListener: (type, handler) => addListener('window', type, handler),
    removeEventListener: (type, handler) => removeListener('window', type, handler),
    dispatchEvent: (event) => {
      const payload = event && typeof event === 'object' ? event : { type: String(event) }
      for (const handler of [...(listeners.get(`window:${payload.type}`) || [])]) handler(payload)
      return true
    },
    taskhive: options.taskhive || {},
    document,
    // In a browser `window.localStorage` IS the global `localStorage`. The harness has to
    // match that, or every "remember what I chose" preference (editor split ratios, the
    // inline online-value switch) would write nowhere and could not be tested at all.
    localStorage: options.localStorage || {
      _store: new Map(),
      getItem (key) { return this._store.has(String(key)) ? this._store.get(String(key)) : null },
      setItem (key, value) { this._store.set(String(key), String(value)) },
      removeItem (key) { this._store.delete(String(key)) },
      clear () { this._store.clear() },
    },
  }

  const scene = {
    window: windowStub,
    document,
    documentElement,
    head,
    body,
    root,
    viewport,
    cssVars,
    posted,
    timers,
    frames,
    observers,
    single,
    lists,
    // ── test-side controls ────────────────────────────────────────────────────
    node: (selector) => single.get(selector),
    list: (selector) => lists.get(selector) || [],
    // Assertion-style lookups: an unmatched selector is a FAILURE, not an empty
    // result. `requireNode` is what a probe/test must use when it means "this
    // anchor must exist"; `querySelector` keeps modelling optional nodes.
    requireNode: (selector) => {
      const key = String(selector)
      if (!single.has(key)) throw missingSelectorError(key, 'single')
      return single.get(key)
    },
    requireList: (selector, minimum = 1) => {
      const key = String(selector)
      if (!lists.has(key)) throw missingSelectorError(key, 'list')
      const nodes = lists.get(key)
      if (nodes.length < minimum) {
        const error = missingSelectorError(key, 'list')
        error.message = `mini-dom-missing-selector: ${JSON.stringify(key)} has ${nodes.length} node(s) but the assertion requires at least ${minimum}`
        throw error
      }
      return nodes
    },
    requireCount: (selector, expected) => {
      const key = String(selector)
      const nodes = lists.has(key) ? lists.get(key) : (single.has(key) ? [single.get(key)] : null)
      const actual = nodes ? nodes.length : 0
      if (actual !== expected) {
        const error = missingSelectorError(key, 'count')
        error.message = `mini-dom-count-mismatch: ${JSON.stringify(key)} has ${actual} node(s), expected ${expected}`
        throw error
      }
      return nodes
    },
    // Audit trail: every lookup this scene could not answer, in order.
    misses,
    missesFor: (selector) => misses.filter((entry) => entry.selector === String(selector)).length,
    strictLookups: (enabled = true) => { strictLookups = enabled === true; return strictLookups },
    setList: (selector, nodes) => { lists.set(selector, nodes) },
    setCssVar: (name, value) => { cssVars.set(name, String(value)) },
    setViewport: (width, height) => { viewport.width = width; viewport.height = height; windowStub.innerWidth = width; windowStub.innerHeight = height },
    // Deterministic animation frames: the test decides when a frame runs, so a
    // "two identical frames" rule is observable instead of timing-dependent.
    runFrame: () => {
      const pending = frames.splice(0, frames.length)
      for (const callback of pending) callback(0)
      return pending.length
    },
    pendingFrames: () => frames.length,
    // Deterministic timers (the geometry bridge's 180 ms / 520 ms republish,
    // the online poll's interval). Runs exactly the timers that are pending at
    // the moment of the call; an interval re-arms into the NEXT batch instead of
    // looping forever inside one flush.
    flushTimers: () => {
      const batch = timers.filter((timer) => !timer.cleared)
      timers.length = 0
      let fired = 0
      for (const timer of batch) {
        if (timer.cleared) continue
        timer.callback(...(timer.args || []))
        fired += 1
        if (timer.repeat && !timer.cleared) timers.push(timer)
      }
      return fired
    },
    pendingTimers: () => timers.filter((timer) => !timer.cleared).length,
    fire: (target, type, event) => fire(target, type, event),
    getComputedStyle: (node) => ({
      getPropertyValue: (name) => {
        if (node === documentElement || node === body) return cssVars.get(String(name)) || ''
        return node?.style?.getPropertyValue?.(name) || ''
      },
    }),
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length },
    cancelAnimationFrame: () => {},
    setTimeout: (callback, delay, ...args) => {
      const timer = { id: ++timerSeq, callback, delay, args, cleared: false, repeat: false }
      timers.push(timer)
      allTimers.set(timer.id, timer)
      return timer.id
    },
    // `setInterval` keeps firing until cleared, like the browser: without this
    // the workbench's online status poll could never observe a later change.
    setInterval: (callback, delay, ...args) => {
      const timer = { id: ++timerSeq, callback, delay, args, cleared: false, repeat: true }
      timers.push(timer)
      allTimers.set(timer.id, timer)
      return timer.id
    },
    clearTimeout: (id) => { const timer = allTimers.get(id); if (timer) timer.cleared = true },
    clearInterval: (id) => { const timer = allTimers.get(id); if (timer) timer.cleared = true },
    MutationObserver: FakeMutationObserver,
    ResizeObserver: FakeResizeObserver,
  }
  windowStub.requestAnimationFrame = scene.requestAnimationFrame
  windowStub.cancelAnimationFrame = scene.cancelAnimationFrame
  windowStub.setTimeout = scene.setTimeout
  windowStub.clearTimeout = scene.clearTimeout
  windowStub.getComputedStyle = scene.getComputedStyle
  windowStub.MutationObserver = FakeMutationObserver
  windowStub.ResizeObserver = FakeResizeObserver
  windowStub.performance = { now: () => Date.now() }
  return scene
}

// `taskhive` stub used by every renderer test: every IPC method the renderer
// may call exists and resolves to null, and a test overrides the ones its
// scenario depends on. Without this a missing method becomes an async throw in
// the renderer's bootstrap IIFE, which would surface as an unhandled rejection
// instead of a test failure.
function createTaskhiveStub (overrides = {}) {
  const base = { ...overrides }
  return new Proxy(base, {
    get (target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string') return undefined
      return async () => null
    },
    has () { return true },
  })
}

module.exports = { StubNode, StubStyle, StubClassList, createScene, createTaskhiveStub }
