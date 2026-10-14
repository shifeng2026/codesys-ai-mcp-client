'use strict';

// Responsibility boundaries inside the DSH client bundle.
//
// `dsh/client.js` cannot be split into multiple FILES: its `require` is a static
// module table lookup, not a filesystem resolver. A probe module added to this
// same package failed with the loader's own message —
//   "missed the module table — not a platform seed word, not a materialized
//    module, and no registered package factory"
// — so a second file would only work if a build step materialized it, which is a
// release-pipeline change this contract does not assume.
//
// What CAN be enforced is the property the split was meant to buy: a change in
// one responsibility must not reach into another. The regions below are real
// slices of the file, and every cross-region reference must be on the allow-list.
// Adding a new entanglement fails this test and forces a conscious decision.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const clientPath = path.resolve(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js');
const source = fs.readFileSync(clientPath, 'utf8');
const lines = source.split(/\r?\n/);

// Top-level members of the factory are indented by exactly four spaces; anything
// deeper is a nested helper and therefore part of its enclosing region.
const declRe = /^    (?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^    (?:const|let)\s+([A-Za-z_$][\w$]*)/;
const decls = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(declRe);
  if (m) decls.push({ name: m[1] || m[2], idx: i });
}
for (let i = 0; i < decls.length; i++) decls[i].end = i + 1 < decls.length ? decls[i + 1].idx - 1 : lines.length - 1;
const byName = new Map(decls.map((d) => [d.name, d]));

function slice(name) {
  const d = byName.get(name);
  assert(d, `${name} must still exist in dsh/client.js (a rename must be reflected in this contract)`);
  return { name, text: lines.slice(d.idx, d.end + 1).join('\n'), size: d.end - d.idx + 1 };
}

const groups = {
  layout: ['installWorkspaceGeometryBridge'],
  workbench: ['CodesysWorkbench', 'SessionRecordsPanel', 'codesysWorkbenchApi', 'sessionRecordsApi', 'publishCodesysWorkbenchMirror'],
  skin: ['installTaskHiveSkin', 'surfaceIcon', 'iconPaths', 'WebModelSelect', 'DirectorySettingsItem', 'ModelCatalogSection', 'PluginInventoryTab'],
  online: ['codesysOnlineErrorMessage', 'showCodesysOnlineDangerDialog'],
  bridges: ['installNativeNavigationBridge', 'installWebLoginCardBridge'],
};

// A cross-region reference is allowed only where it is genuinely part of the
// seam. Everything else must stay inside its own region.
const allowedEdges = new Set([
  'workbench->online:codesysOnlineErrorMessage',
  'workbench->online:showCodesysOnlineDangerDialog',
  'skin->workbench:sessionRecordsApi',
]);

const owner = new Map();
for (const [group, names] of Object.entries(groups)) for (const name of names) owner.set(name, group);

const countIn = (text, name) => (text.match(new RegExp(`(^|[^.\\w$])${name.replace(/\$/g, '\\$')}\\b`, 'g')) || []).length;

let checked = 0;
const violations = [];
for (const [group, names] of Object.entries(groups)) {
  for (const member of names) {
    const region = slice(member);
    const from = owner.get(member);
    for (const [otherGroup, otherNames] of Object.entries(groups)) {
      if (otherGroup === from) continue;
      for (const other of otherNames) {
        const hits = countIn(region.text, other);
        if (!hits) continue;
        checked += 1;
        const edge = `${from}->${otherGroup}:${other}`;
        if (!allowedEdges.has(edge)) violations.push(`${member} (${from}) references ${other} (${otherGroup}) ${hits}x`);
      }
    }
  }
}

assert.deepStrictEqual(
  violations,
  [],
  `new cross-responsibility coupling inside dsh/client.js:\n  - ${violations.join('\n  - ')}\n` +
  'Either remove the dependency, or add the edge to allowedEdges with a comment saying why the seam is real.',
);

// The layout bridge is the seam the audit was most worried about: it must not
// depend on any UI region, because a workbench or skin change would then move
// the native overlay geometry.
const layoutRegion = slice('installWorkspaceGeometryBridge');
for (const forbidden of ['CodesysWorkbench', 'sessionRecordsApi', 'installTaskHiveSkin', 'codesysWorkbenchApi', 'pluginSurfaceMode']) {
  assert(!countIn(layoutRegion.text, forbidden), `the layout bridge must not depend on ${forbidden}`);
}

// It also must not go back to observing the whole document (the audit finding).
assert(!/observe\(\s*document\.documentElement/.test(layoutRegion.text), 'the layout bridge must not observe the whole document again');
assert(/new ResizeObserver\(/.test(layoutRegion.text), 'the layout bridge must keep its ResizeObserver on the conversation pane');

console.log(`client responsibility boundaries contract passed (${Object.keys(groups).length} regions, ${checked} cross-region references, all on the allow-list)`);
