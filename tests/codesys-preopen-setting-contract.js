'use strict'
// Contract (T199 item 2): the "pre-open the CODESYS project at start-up" switch must be a
// USER-CONTROLLABLE setting, not an environment variable only a developer can reach.
//
// Why this contract exists (the recorded state before this change):
//   * the application ignited the pre-open on every start (`main.js`, the T198 trigger) and
//     the ONLY switch was `TASKHIVE_CODESYS_PREOPEN_ON_START`, i.e. an environment variable;
//   * the cost is real and unconditional: ~38-67 s of CODESYS CPU/disk on EVERY start plus a
//     ~670 MB resident process, **even in a round that never touches CODESYS**;
//   * trigger (1) -- bringing the CODESYS panel to the front -- had NO probe/smoke gate at all,
//     so a probe run really ignited a pre-open and left job directories behind.
//
// What this contract pins, and why each part is here rather than only in the executable probe:
//   1. WHERE the preference lives. It must be the app's own per-install `userData` directory
//      (read/written through the existing `app/atomic-json.js` helpers). It must NOT be a new
//      `profiles/*.json`: `tools/check-tree-parity.js` compares `profiles/` byte for byte
//      across dev / stage / live, so as soon as one machine toggles the switch the three trees
//      could never agree again -- a self-inflicted DRIFT. `user-data/**` is the documented
//      exemption for per-install mutable state.
//   2. PRECEDENCE: an explicitly set environment variable > the UI setting > the default (ON).
//      "Default ON" is not an opinion: it is the behaviour that shipped, and the operator's
//      decision for T198 was "do it", so turning the switch into a UI control must not change
//      what an untouched install does.
//   3. THE UI: a startup tab in the real settings page (`app/renderer/renderer.js`), a switch,
//      and exactly ONE line of cost explanation (necessary information, not permanent noise).
//      The page mirrors the main process; it keeps no second copy of the truth.
//   4. THE GATES: both new channels are shell-renderer-only, and every one of the three
//      pre-open triggers carries the same smoke/probe gate.
//   5. THE PROBE at all: the claim "UI off => no ignition, UI on => ignition, probe => never"
//      is only falsifiable if there is a probe that drives the real settings page and fails
//      loudly. A source-only assertion cannot show that.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const main = fs.readFileSync(path.join(appRoot, 'app', 'main.js'), 'utf8')
const preload = fs.readFileSync(path.join(appRoot, 'app', 'preload.js'), 'utf8')
const renderer = fs.readFileSync(path.join(appRoot, 'app', 'renderer', 'renderer.js'), 'utf8')

// ── 1. where the preference lives ─────────────────────────────────────────────────────────
assert(/const CODESYS_PREFERENCES_FILE = 'codesys-preferences\.json'/.test(main),
  'the preference file name must be a named constant (one place to look)')
assert(/return path\.join\(app\.getPath\('userData'\), CODESYS_PREFERENCES_FILE\)/.test(main),
  'the preference must live in the per-install userData directory: three-tree parity excludes user-data/** but compares profiles/** byte for byte, so a profiles/*.json setting would become permanent DRIFT')
assert(!/path\.join\(root, 'profiles', .*codesys-preferences/.test(main),
  'the preference must not be a new file under profiles/ (that is the compared tree config)')
assert(/readJson\(codesysPreferencesPath\(\)/.test(main) && /writeJson\(codesysPreferencesPath\(\)/.test(main),
  'it must be read and written with the existing app/atomic-json.js helpers, not a second storage mechanism')
assert(!/localStorage[^\n]*preopen/i.test(renderer) && !/preopen[^\n]*localStorage/i.test(renderer),
  'the preopen switch must not be persisted in localStorage (it is per-renderer, invisible to the main process and lost on a profile reset)')
assert(/codesys-preferences\.json/.test(main) && !/codesys-preferences\.json/.test(renderer),
  'the renderer must not know the storage layout: it goes through IPC')

// ── 2. precedence: env (explicit) > UI setting > default (ON) ─────────────────────────────
assert(/function codesysPreopenOnStartSetting\(\) \{\s*\n\s*return readCodesysPreferences\(\)\.preopenOnStart !== false/.test(main),
  'the UI setting must default to ON when no value was ever stored (default = the behaviour before the change)')
assert(/function codesysPreopenOnStartEnabled\(\) \{\s*\n\s*const raw = codesysPreopenOnStartEnvRaw\(\)\.toLowerCase\(\);\s*\n\s*if \(raw\) return !\['0', 'false', 'off', 'no'\]\.includes\(raw\);\s*\n\s*return codesysPreopenOnStartSetting\(\);/.test(main),
  'the decision must be: an explicitly set env var wins, otherwise the UI setting, otherwise its ON default')
assert(/function codesysPreopenOnStartEnvRaw\(\) \{\s*\n\s*return String\(process\.env\[CODESYS_PREOPEN_ON_START_ENV\] \?\? ''\)\.trim\(\);/.test(main),
  'an EMPTY environment variable must count as "not set" (otherwise an exported-but-empty variable would silently pin the setting)')
// The audited reason must distinguish the two ways of being off, or "why did this start not
// pre-open?" is unanswerable after the fact.
assert(main.includes("skipped: 'disabled-by-env'") && main.includes("skipped: 'disabled-by-setting'"),
  'the audit must distinguish the env override from the user turning the switch off')
// The environment variable is an INPUT. The only code allowed to write it is the probe, which
// does so to execute the precedence table (two combinations) instead of only reading a comment.
const envWrites = main.match(/process\.env\[CODESYS_PREOPEN_ON_START_ENV\]\s*=/g) || []
assert.strictEqual(envWrites.length, 2,
  `the host must never set the environment variable itself (found ${envWrites.length} assignments; exactly 2 are allowed, both inside the self-test)`)

// ── 3. the UI: a startup tab, one switch, exactly one line of cost ────────────────────────
assert(renderer.includes('data-settings-tab="startup"') && renderer.includes('data-settings-panel="startup"'),
  'the settings page must gain a startup tab (and a matching panel)')
assert(renderer.includes('id="codesys-preopen-on-start"') && renderer.includes('type="checkbox"'),
  'the startup tab must carry a checkbox for "pre-open the CODESYS project at start-up"')
assert(renderer.includes('id="codesys-preopen-cost"'),
  'the startup tab must carry the cost line (necessary information, per the operator)')
assert(/关掉可省每次启动约 38–67 s 与约 670 MB 常驻/.test(main),
  'the cost line\'s text must state the measured cost of leaving it on')
// The page must not invent a second default: it renders whatever the main process reports.
assert(/preopenToggle\.checked = value\?\.preopenOnStart === true/.test(renderer),
  'the switch must mirror the value the main process reports instead of assuming one')
assert(/effective !== next/.test(renderer),
  'when an environment variable overrides the UI the page must say so instead of pretending the switch took effect')
// Quiet on the success path: the status line starts hidden and is only revealed on an event.
assert(/id="codesys-preopen-status" class="notice" hidden/.test(renderer),
  'the status line must start hidden (no permanent text on the success path)')
assert(/hidePreopenStatus\(\)/.test(renderer) && /showPreopenStatus\(/.test(renderer),
  'the status line must be explicitly hidden/shown rather than always populated')

// ── 4. the gates ─────────────────────────────────────────────────────────────────────────
assert(preload.includes("codesysPreopenPreference: () => ipcRenderer.invoke('settings:codesys-preopen')"),
  'the preload bridge must expose the read channel')
assert(preload.includes("saveCodesysPreopenPreference: (input) => ipcRenderer.invoke('settings:codesys-preopen-save', input || {})"),
  'the preload bridge must expose the write channel')
assert(/handleTrusted\('settings:codesys-preopen',/.test(main) && /handleTrusted\('settings:codesys-preopen-save',/.test(main),
  'both channels must be registered as trusted handlers')
assert(/typeof input\?\.preopenOnStart !== 'boolean'/.test(main),
  'the write channel must reject anything that is not a boolean (no truthy coercion from a caller)')
const panelOnly = /CODESYS_PANEL_ONLY_CHANNELS = new Set\(\[([\s\S]*?)\]\)/.exec(main)
assert(panelOnly, 'CODESYS_PANEL_ONLY_CHANNELS must still exist')
assert(panelOnly[1].includes("'settings:codesys-preopen'") && panelOnly[1].includes("'settings:codesys-preopen-save'"),
  'both new channels must be on the shell-document identity gate')
for (const channel of ['settings:codesys-preopen', 'settings:codesys-preopen-save']) {
  assert(!/plugins[\\/]installed[\\/]taskhive-surfaces/.test(channel), 'sanity: channel names must not encode a tree path')
}

// Every pre-open trigger carries the same smoke/probe gate, so a probe run cannot ignite.
assert(main.includes('function preopenSmokeGateApplies(mode, reason) {') && /mode, skipped: 'smoke-or-probe-run'/.test(main),
  'one shared gate must decide "this run must not ignite", and it must leave one audit line')
for (const mode of ['application-start', 'codesys-surface-open', 'current-project-detected']) {
  assert(main.includes(`preopenSmokeGateApplies('${mode}'`),
    `the ${mode} trigger must consult the shared smoke/probe gate`)
}
assert(main.includes("if (kind === 'codesys') preopenRememberedCodesysProject('codesys-surface-open');"),
  'trigger (1) must still be wired at the surface switch (this contract strengthens it, it does not move it)')

// ── 5. the probe: real settings page, real IPC, honest verdict ───────────────────────────
assert(main.includes('async function runCodesysPreopenSettingProbe(leaveOn = false)'),
  'the host must own the self-test')
assert(!/^(?:async\s+)?function (?:probe|exercise)[A-Z]/.test('async function runCodesysPreopenSettingProbe(leaveOn = false) {'),
  'the self-test name must not look like a probes.js probe (the probe-split contract forbids probe definitions in main.js)')
for (const flag of ["'--probe-codesys-preopen-setting'", "'--probe-codesys-preopen-setting-on'"]) {
  assert(main.includes(flag), `the ${flag} flag must be recognised`)
  assert(new RegExp(`const smokeLaunch = \\(\\) => process\\.argv\\.some\\(\\(arg\\) => \\[[^\\]]*${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\]]*\\]\\.includes\\(arg\\)\\)`).test(main),
    `${flag} must be in the smokeLaunch() list so the probe run itself never ignites`)
}
// The probe must drive the settings page the way a user does, and must be able to fail.
assert(/document\.querySelector\('#left-settings'\)/.test(main) && /button\.click\(\)/.test(main),
  'the probe must open the settings page through the real shell nav button, not by calling the IPC handler directly')
assert(/const clickToggle = async \(\) => \{/.test(main) && /toggle\.click\(\)/.test(main),
  'the probe must toggle the switch by clicking it')
for (const check of [
  'settings-page-has-the-switch',
  'defaults-to-on-with-no-stored-value',
  'shows-the-cost-line',
  'ui-off-persists-false',
  'ui-on-persists-true',
  'precedence-env-explicit-beats-ui',
  'probe-run-never-ignites',
  'probe-gate-skips-trigger-1',
  'probe-gate-skips-startup',
  'probe-gate-skips-trigger-2',
]) {
  assert(main.includes(`record('${check}'`), `the probe must record the "${check}" verdict`)
}
assert(/if \(!evidence\.ok\) \{[\s\S]{0,200}?throw error/.test(main),
  'the probe must throw on its own verdict (a probe that only writes ok:false and exits 0 is a liar)')
assert(main.includes("path.join(root, 'logs', 'codesys-preopen-setting-probe.json')"),
  'the probe must write its evidence where the release run can find it')
// The probe deletes the stored value first, so "the default is ON" is executed rather than
// assumed -- and it records what it removed.
assert(/const previousPreference = fs\.existsSync\(preferencePath\)/.test(main) && /fs\.rmSync\(preferencePath, \{ force: true \}\)/.test(main),
  'the probe must remove any stored value before asserting the default (and keep the old content in its evidence)')

console.log('codesys pre-open setting contract passed (UI switch + precedence env>UI>default + probe gate on all 3 triggers + real-page probe)')
