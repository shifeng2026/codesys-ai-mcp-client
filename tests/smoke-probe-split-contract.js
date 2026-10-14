'use strict';

// Contract for the smoke-probe extraction.
//
// The packaged probes were moved out of `app/main.js` into `app/smoke/probes.js`
// so the main process keeps startup, IPC, window-management and configuration
// responsibilities. This guards the three properties that the move depends on,
// because every one of them fails SILENTLY (a syntax check passes, the contract
// suite passes, and only a --smoke*/--probe* run reveals the breakage):
//
//   1. The probes really are gone from main.js (otherwise the split is fiction).
//   2. The module exports a factory that returns every probe, so a probe that was
//      dropped in the move cannot hide behind a `typeof undefined` call site.
//   3. main.js obtains them at MODULE SCOPE. An earlier attempt inserted the
//      destructuring inside an unrelated function body; the probes then threw
//      "probeHarnessFrames is not defined" at runtime while every static check
//      still passed. Column 0 is the cheap, reliable signal for module scope here.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const app = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(app, 'app', 'main.js'), 'utf8');
const probeModulePath = path.join(app, 'app', 'smoke', 'probes.js');

assert(fs.existsSync(probeModulePath), 'app/smoke/probes.js must exist');
const probeSource = fs.readFileSync(probeModulePath, 'utf8');

// 1. no probe definitions left behind
const leftovers = mainSource.match(/^(?:async\s+)?function (?:probe|exercise)[A-Z]\w*/gm) || [];
assert.strictEqual(leftovers.length, 0, `main.js must not still define probes: ${leftovers.join(', ')}`);

// 3. the context and the destructuring must sit at module scope (column 0)
assert(/^const probes = createProbes\(/m.test(mainSource), 'the probe context must be created at module scope');
assert(/^const \{ probeSplash/m.test(mainSource), 'the probes must be destructured at module scope, not inside a function');
assert(/^const createProbes = require\('\.\/smoke\/probes'\);/m.test(mainSource), 'main.js must require the probe module');

// The destructured list is the source of truth for "which probes were moved".
// (A plain `probe[A-Z]\w*` scan of main.js would also match helpers imported from
// other modules, e.g. `probePage` from web-ai-driver.)
const destructuredLine = mainSource.split(/\r?\n/).find((line) => line.startsWith('const { probeSplash')) || '';
const wired = (destructuredLine.match(/\b(?:probe|exercise)[A-Z]\w*/g) || []);
assert(wired.length >= 20, `expected the extracted probe set, found ${wired.length} names in the destructuring`);
// Two probes were already unreferenced in main.js BEFORE the move (verified against
// the pre-split file: 0 call sites each). A mechanical extraction preserves them
// verbatim; deleting them is a separate decision, not part of this contract.
const preExistingDeadProbes = new Set(['exercisePackageSurface', 'exerciseChartSurface']);

for (const name of wired) {
  if (preExistingDeadProbes.has(name)) continue;
  // A probe is reachable either from main.js's dispatch or from another probe
  // inside the module (probeHarnessFrames is only called by its sibling).
  const calledInMain = mainSource.includes(`${name}(`);
  const moduleWithoutItsOwnDefinition = probeSource.replace(new RegExp(`function ${name}\\(`, 'g'), '');
  const calledInModule = new RegExp(`(^|[^.\\w$])${name}\\(`).test(moduleWithoutItsOwnDefinition);
  assert(calledInMain || calledInModule, `${name} is destructured but never called`);
}

// 2. the factory must return every probe as a function. A stub context is enough:
// construction only reads the context, it never runs a probe.
const createProbes = require(probeModulePath);
assert.strictEqual(typeof createProbes, 'function', 'the probe module must export a factory');
const stub = new Proxy({}, { get: () => () => undefined, has: () => true });
const probes = createProbes(stub);
assert(probes && typeof probes === 'object', 'the factory must return the probe map');
for (const name of wired) {
  assert.strictEqual(typeof probes[name], 'function', `the factory must return ${name}`);
}

// The live-state members must be getters/setters on the context, otherwise a probe
// would read a value captured before mainWindow existed.
for (const live of ['mainWindow', 'pluginSurfaceKind', 'pluginSurfaceView', 'splashWindow']) {
  assert(new RegExp(`^\\s+get ${live}\\(\\)`, 'm').test(mainSource), `the context must expose a live getter for ${live}`);
}

console.log(`smoke probe split contract passed (${Object.keys(probes).length} probes exported, ${wired.length} wired from main.js)`);
