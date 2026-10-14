'use strict'

// Renderer crashes must be observable.
//
// `console-message` only fires while a renderer is alive and logging, so a
// renderer that died, hung, or failed to load produced nothing: `electron-smoke.json`
// reported `ok:true` over a blank window and logs/renderer-console.log stayed
// quiet. This contract drives the REAL handler functions out of app/main.js
// against a stub webContents (no Electron, no crash) and checks that
//
//   * `did-fail-load` (a real failure) reaches the smoke error collector,
//   * `render-process-gone` reaches it (with reason and exit code),
//   * `unresponsive` reaches it,
//   * `did-fail-load` with ERR_ABORTED (-3) does NOT (normal surface switching
//     aborts in-flight loads; treating that as an error would redden every run),
//   * a plain console error still goes through the untouched
//     `normalizeConsoleMessage` path,
//   * the app-level `child-process-gone` handler records a crashed child but not
//     a clean exit.
//
// The extraction is source-driven on purpose: the code under test is the shipped
// text, and a marker that disappears fails this contract loudly instead of
// silently testing a stale copy.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const vm = require('node:vm')
const { appendDiagnosticLog } = require('../app/diagnostic-log')

const app = path.resolve(__dirname, '..')
const mainPath = path.join(app, 'app', 'main.js')
const mainSource = fs.readFileSync(mainPath, 'utf8')

function sliceBetween (source, startMarker, endMarker, label) {
  const from = source.indexOf(startMarker)
  assert(from >= 0, `${label}: start marker not found — ${startMarker}`)
  const to = source.indexOf(endMarker, from)
  assert(to > from, `${label}: end marker not found after the start — ${endMarker}`)
  return source.slice(from, to)
}

// 1. The console normaliser and the collector/attachers, verbatim.
const collectorSource = sliceBetween(
  mainSource,
  'function normalizeConsoleMessage(args) {',
  '// Same contract for one-way channels',
  'renderer error collector',
)
// 2. The app-level child-process-gone registration, verbatim.
const childProcessSource = sliceBetween(
  mainSource,
  "app.on('child-process-gone'",
  "app.on('before-quit'",
  'child-process-gone registration',
)

const root = createTempDir('taskhive-renderer-errors-')
const registeredChildHandlers = []
const sandbox = {
  root,
  path,
  fs,
  process,
  console,
  appendDiagnosticLog,
  Error,
  JSON,
  Date,
  Number,
  String,
  Boolean,
  RegExp,
  Object,
  Array,
  Buffer,
  setTimeout,
}
sandbox.app = {
  on (event, handler) {
    assert.strictEqual(event, 'child-process-gone', `unexpected app event registration: ${event}`)
    registeredChildHandlers.push(handler)
  },
}
sandbox.globalThis = sandbox
const context = vm.createContext(sandbox)
new vm.Script(`${collectorSource}\n${childProcessSource}\n;globalThis.__TEST_EXPORTS__ = { smokeRendererErrors, SMOKE_RENDERER_ERROR_LIMIT, recordSmokeRendererError, normalizeConsoleMessage, attachRendererConsoleLogging, attachRendererLifecycleLogging, recordRendererLifecycleFailure };\n`, { filename: mainPath }).runInContext(context)
const api = context.__TEST_EXPORTS__
assert(api, 'the extraction did not run — the marked region moved')
assert.strictEqual(typeof api.attachRendererLifecycleLogging, 'function', 'attachRendererLifecycleLogging must exist in main.js')
assert.strictEqual(typeof api.attachRendererConsoleLogging, 'function', 'attachRendererConsoleLogging must exist in main.js')

// A minimal EventEmitter-shaped webContents: `on` records, `emit` fires.
function fakeWebContents () {
  const listeners = new Map()
  return {
    listeners,
    on (event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
      return this
    },
    emit (event, ...args) {
      for (const handler of listeners.get(event) || []) handler({}, ...args)
      return (listeners.get(event) || []).length
    },
    isDestroyed: () => false,
  }
}

const contents = fakeWebContents()
api.attachRendererConsoleLogging(contents, 'unit-test-surface')
api.attachRendererLifecycleLogging(contents, 'unit-test-surface')

assert(api.smokeRendererErrors.length === 0, 'the collector must start empty')

// ── did-fail-load (a real failure) enters the collector ──────────────────────
assert.strictEqual(contents.emit('did-fail-load', -105, 'NAME_NOT_RESOLVED', 'http://127.0.0.1:1/index.html', true), 1, 'did-fail-load must have exactly one handler')
assert.strictEqual(api.smokeRendererErrors.length, 1, 'a failed load must be recorded as a renderer error')
assert.strictEqual(api.smokeRendererErrors[0].label, 'unit-test-surface', 'the entry must name the surface (like the console path)')
assert.strictEqual(api.smokeRendererErrors[0].sourceId, 'renderer-lifecycle:did-fail-load', 'the entry must be identifiable as a lifecycle failure')
assert(/-105/.test(api.smokeRendererErrors[0].message), 'the entry must carry the error code')

// ── ERR_ABORTED (-3) is a non-event ─────────────────────────────────────────
contents.emit('did-fail-load', -3, 'ERR_ABORTED', 'file:///app/renderer/index.html', true)
assert.strictEqual(api.smokeRendererErrors.length, 1, 'an aborted load must not be counted as a renderer error')

// ── render-process-gone enters the collector ────────────────────────────────
assert.strictEqual(contents.emit('render-process-gone', { reason: 'crashed', exitCode: 133 }), 1, 'render-process-gone must have exactly one handler')
assert.strictEqual(api.smokeRendererErrors.length, 2, 'a gone renderer process must be recorded')
assert.strictEqual(api.smokeRendererErrors[1].sourceId, 'renderer-lifecycle:render-process-gone', 'the entry must name the event')
assert(/crashed/.test(api.smokeRendererErrors[1].message) && /133/.test(api.smokeRendererErrors[1].message), 'the entry must carry reason and exit code')

// ── unresponsive enters the collector; responsive is a recovery note ────────
assert.strictEqual(contents.emit('unresponsive'), 1, 'unresponsive must have exactly one handler')
assert.strictEqual(api.smokeRendererErrors.length, 3, 'a hung renderer must be recorded')
assert.strictEqual(api.smokeRendererErrors[2].sourceId, 'renderer-lifecycle:unresponsive', 'the entry must name the event')
assert.strictEqual(contents.emit('responsive'), 1, 'responsive must have a handler')
assert.strictEqual(api.smokeRendererErrors.length, 3, 'recovering must not add an error')

// ── a console error still flows through normalizeConsoleMessage ─────────────
// Deprecated positional shape: (event, level, message, line, sourceId). Blink's
// level 3 is an ERROR; the old mapping turned it into 'warning', which is why a
// real `React error #130` never failed a smoke run.
contents.emit('console-message', 3, 'React error #130', 12, 'client.js')
assert.strictEqual(api.smokeRendererErrors.length, 4, 'a numeric level-3 console message must be recorded as an error')
assert.strictEqual(api.smokeRendererErrors[3].label, 'unit-test-surface', 'the console path keeps the bare label')
assert(/React error #130/.test(api.smokeRendererErrors[3].message), 'the console message must survive normalisation')
// Modern shape: (event, details).
contents.emit('console-message', { level: 'error', message: 'Uncaught TypeError', lineNumber: 3, sourceId: 'renderer.js' })
assert.strictEqual(api.smokeRendererErrors.length, 5, 'the (event, details) console shape must be recorded too')
assert(/Uncaught TypeError/.test(api.smokeRendererErrors[4].message), 'the details message must survive normalisation')
contents.emit('console-message', { level: 'info', message: 'nothing to see' })
contents.emit('console-message', 1, 'nothing to see', 0, 'client.js')
assert.strictEqual(api.smokeRendererErrors.length, 5, 'info/verbose messages must not be recorded')
contents.emit('console-message', 2, 'a deprecation', 0, 'client.js')
assert.strictEqual(api.smokeRendererErrors.length, 5, 'a warning is logged but is not an error entry')

// ── the log file is really written, through appendDiagnosticLog ─────────────
const logFile = path.join(root, 'logs', 'renderer-console.log')
assert(fs.existsSync(logFile), 'lifecycle failures must be written to renderer-console.log')
const logText = fs.readFileSync(logFile, 'utf8')
assert(/render-process-gone/.test(logText), 'the log must name the crash event')
assert(/load-aborted/.test(logText), 'the aborted load must still be visible as a non-error line')

// ── app-level child-process-gone ────────────────────────────────────────────
assert.strictEqual(registeredChildHandlers.length, 1, 'main.js must register exactly one child-process-gone handler')
const childErrorsBefore = api.smokeRendererErrors.length
registeredChildHandlers[0]({}, { type: 'GPU', reason: 'crashed', exitCode: 1 })
assert.strictEqual(api.smokeRendererErrors.length, childErrorsBefore + 1, 'a crashed child process must be recorded')
assert(/child-process-gone/.test(api.smokeRendererErrors[childErrorsBefore].sourceId), 'the child entry must be identifiable')
registeredChildHandlers[0]({}, { type: 'GPU', reason: 'clean-exit', exitCode: 0 })
assert.strictEqual(api.smokeRendererErrors.length, childErrorsBefore + 1, 'a clean child exit must not be an error')
registeredChildHandlers[0]({}, { type: 'Utility', reason: 'killed', exitCode: 1 })
assert.strictEqual(api.smokeRendererErrors.length, childErrorsBefore + 1, 'a killed child process must not be an error')

// ── the collector stays capped ──────────────────────────────────────────────
for (let index = 0; index < api.SMOKE_RENDERER_ERROR_LIMIT + 10; index += 1) {
  contents.emit('render-process-gone', { reason: `crashed-${index}`, exitCode: 1 })
}
assert.strictEqual(api.smokeRendererErrors.length, api.SMOKE_RENDERER_ERROR_LIMIT, 'the collector must stay capped')

// ── every long-lived webContents is really wired in main.js ─────────────────
const attachCalls = mainSource.match(/attachRendererLifecycleLogging\(([^)]*)\)/g) || []
const attachTargets = attachCalls.join('\n')
for (const target of ['mainWindow.webContents', 'pluginSurfaceView.webContents', 'splashWindow.webContents', 'view.webContents']) {
  assert(attachTargets.includes(target), `attachRendererLifecycleLogging must be wired to ${target}`)
}
const consoleCalls = (mainSource.match(/attachRendererConsoleLogging\(([^)]*)\)/g) || []).join('\n')
for (const target of ['mainWindow.webContents', 'pluginSurfaceView.webContents', 'splashWindow.webContents', 'view.webContents']) {
  assert(consoleCalls.includes(target), `attachRendererConsoleLogging must be wired to ${target}`)
}

fs.rmSync(root, { recursive: true, force: true })
console.log('renderer crash observability contract passed')
