'use strict';

// Regression contract for "switching a surface must never pop up the terminal".
//
// The bottom panel hosting a terminal lives in the bundled better-sidebar
// plugin. The "first bottom-panel expansion opens a terminal" feature is gone
// (its locale strings survive, its consumer does not), so the only thing left
// of it is the `bottomPanelAutoTerminal` preference. Every layer must agree
// that this preference is OFF, and no surface/session/tab change may click the
// bottom-panel toggle or open a terminal tab on its own.

const assert = require('assert');
const { readFileSync } = require('fs');
const { join } = require('path');

const sidebarRoot = join(__dirname, '..', 'plugins', 'installed', 'better-sidebar');
const surfacesClientPath = join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js');
const read = (path) => readFileSync(path, 'utf8');
const readSidebar = (relative) => read(join(sidebarRoot, relative));

// ── 1. The host schema default must be OFF, not the legacy ON ───────────────
// (lib/index.js is the schema the settings service validates/resolves with;
// a `true` here overrode the client default for every fresh profile.)
for (const relative of ['lib/index.js', 'src/config.ts']) {
  const source = readSidebar(relative);
  assert(
    /bottomPanelAutoTerminal:\s*z\.boolean\(\)\.default\(false\)/.test(source),
    `${relative} must default bottomPanelAutoTerminal to false`,
  );
  assert(
    !/bottomPanelAutoTerminal:\s*z\.boolean\(\)\.default\(true\)/.test(source),
    `${relative} keeps the legacy auto-terminal default`,
  );
}

// ── 2. The client and client-registry defaults must be OFF too ──────────────
for (const relative of ['src/prefs-shared.ts', 'lib/client.js', 'lib/client-registry.js']) {
  const source = readSidebar(relative);
  assert(
    source.includes('bottomPanelAutoTerminal: false'),
    `${relative} must default bottomPanelAutoTerminal to false`,
  );
  assert(
    !source.includes('bottomPanelAutoTerminal: true'),
    `${relative} must not default bottomPanelAutoTerminal to true`,
  );
}

// ── 3. No layout change may auto-open the bottom panel / a terminal ─────────
for (const relative of ['src/client/Sidebar.tsx', 'lib/client.js', 'lib/client-registry.js']) {
  const source = readSidebar(relative);
  assert(
    !source.includes('bottomOpenedOnce: true'),
    `${relative} can still open a terminal on a layout change`,
  );
}

// ── 4. No surface-switch code path may OPEN the bottom panel ───────────────
const TOGGLE_CLICK = /\[data-dsh-bottom-panel-toggle\][^;]{0,80}?\.click\(\)/;
for (const relative of ['lib/client.js', 'lib/client-registry.js']) {
  assert(!TOGGLE_CLICK.test(readSidebar(relative)), `${relative} clicks the bottom-panel toggle`);
}

// The TaskHive surfaces client is allowed to COLLAPSE the panel, and must never
// EXPAND it.
//
// Collapsing is required for the user-visible guarantee: a plugin surface only
// CSS-hides the panel (`visibility: hidden`) and the sidebar persists
// `bottomOpen` per session, so a panel left open becomes visible again the
// moment the user switches back to chat — which is exactly the reported
// "a terminal pops up when switching interfaces". Closing it on surface entry
// removes anything to reveal.
const surfaces = read(surfacesClientPath);
const toggleUses = surfaces.match(/data-dsh-bottom-panel-toggle/g) || [];
assert.strictEqual(
  toggleUses.length,
  1,
  'the surfaces client may reference the bottom-panel toggle exactly once, to collapse it',
);
const closeStart = surfaces.indexOf('const closeBottomPanel = ()');
assert(closeStart !== -1, 'the surfaces client must define closeBottomPanel to retire the hidden panel');
const closeEnd = surfaces.indexOf('\n    }', closeStart);
assert(closeEnd > closeStart, 'could not bound the body of closeBottomPanel');
const closeBody = surfaces.slice(closeStart, closeEnd);
assert(closeBody.includes('data-dsh-bottom-panel-toggle'), 'the single toggle reference must live in the collapse helper');
assert(
  /bottomPanelHeight\(\)\s*<=\s*0\)\s*return false/.test(closeBody),
  'the collapse helper must be a no-op when the panel is already closed, so it can never act as a toggle',
);
assert(closeBody.includes('.click()'), 'the collapse helper must actually collapse the panel');
// Nothing anywhere in this file may open the panel or a terminal with it.
assert(!/bottomOpen\s*:\s*true/.test(surfaces), 'the surfaces client must not force the bottom panel open');
assert(!/expandBottomPanel/.test(surfaces), 'the surfaces client must not expand the bottom panel');

// ── 5. The TaskHive surface switch must never open a terminal tab ───────────
for (const name of ['setPluginSurfaceMode', 'openSurface']) {
  const start = surfaces.indexOf(`function ${name}(`);
  assert(start !== -1, `the TaskHive surfaces client must define ${name}`);
  const end = surfaces.indexOf('\n    }', start);
  assert(end > start, `could not bound the body of ${name}`);
  const body = surfaces.slice(start, end);
  assert(!/terminal/i.test(body), `${name} must not open a terminal on a surface switch`);
  assert(!/openTab/.test(body), `${name} must not open a tab on a surface switch`);
}

// The single terminal open left in the TaskHive client is the explicit bridge
// the desktop probe drives; it is unreachable from a surface switch and must
// keep working (the user's deliberate "open terminal" affordance).
const terminalOpens = surfaces.match(/openTab\(\{[^}]*type:\s*['"]terminal['"]/g) || [];
assert.strictEqual(terminalOpens.length, 1, 'only the explicit terminal bridge may open a terminal tab');
assert(surfaces.includes('__TASKHIVE_OPEN_TERMINAL__'), 'the explicit terminal bridge must keep working');

console.log('terminal panel autostart contract passed');
