'use strict'

// mini-dom must fail on a selector that cannot match.
//
// `document.querySelector` in the stub returned null / [] for any selector a test
// never declared. That is right for the APPLICATION code under test (a real DOM
// also returns null for a mistyped selector) and wrong for an ASSERTION: a probe
// asking for an anchor that was renamed or deleted reads "the overlay is absent,
// so the overlay check passed" — the same silent-empty behaviour that let five
// packaged probes report green for months.
//
// This contract pins the strict path:
//   * `requireNode` / `requireList` / `requireCount` throw MINI_DOM_MISSING_SELECTOR
//     for an undeclared (or too-small) selector instead of returning empty;
//   * `scene.strictLookups(true)` makes every later `querySelector` /
//     `querySelectorAll` / `getElementById` on the scene refuse an undeclared
//     selector instead of fabricating an empty answer;
//   * the non-strict path is unchanged (real renderer code and the existing
//     behaviour tests keep working), and every miss is still recorded in
//     `scene.misses` so a test can audit its own scenario.

const assert = require('node:assert')
const { createScene } = require('./lib/mini-dom')

const scene = createScene({
  nodes: {
    '[data-taskhive-knowledge]': { attributes: { 'data-taskhive-knowledge': 'active' } },
    '#search': {},
  },
  lists: {
    '.tk-card': [{}, {}, {}],
  },
})

// ── the non-strict path is unchanged ─────────────────────────────────────────
assert.strictEqual(scene.document.querySelector('#never-declared'), null, 'an undeclared selector still resolves to null for application code')
assert.deepStrictEqual(scene.document.querySelectorAll('.never-declared'), [], 'an undeclared list selector still resolves to []')
assert.strictEqual(scene.missesFor('#never-declared'), 1, 'every undeclared lookup must be recorded')
assert.strictEqual(scene.missesFor('.never-declared'), 1, 'list misses are recorded too')

// A declared selector answers normally, and an id is only fabricated outside
// strict mode (fabrication is still recorded).
assert(scene.document.querySelector('[data-taskhive-knowledge]'), 'a declared selector must resolve')
assert.strictEqual(scene.document.getElementById('made-up').textContent, '', 'non-strict getElementById still fabricates an empty node')
assert.strictEqual(scene.missesFor('#made-up'), 1, 'the fabricated node is on the record')

// ── assertion lookups fail on a miss ─────────────────────────────────────────
{
  const node = scene.requireNode('[data-taskhive-knowledge]')
  assert.strictEqual(node.getAttribute('data-taskhive-knowledge'), 'active', 'requireNode returns the declared node')

  let error = null
  try { scene.requireNode('#knowledge-category-grid') } catch (caught) { error = caught }
  assert(error, 'requireNode must throw for a selector the scenario never declared')
  assert.strictEqual(error.code, 'MINI_DOM_MISSING_SELECTOR', 'the failure must be identifiable by code')
  assert(/knowledge-category-grid/.test(error.message), 'the failure must name the selector')

  error = null
  try { scene.requireList('.never-declared') } catch (caught) { error = caught }
  assert(error && error.code === 'MINI_DOM_MISSING_SELECTOR', 'requireList must throw for an undeclared list selector')

  assert.strictEqual(scene.requireList('.tk-card').length, 3, 'requireList returns the declared nodes')
  error = null
  try { scene.requireList('.tk-card', 4) } catch (caught) { error = caught }
  assert(error && /at least 4/.test(error.message), 'requireList must enforce its minimum count')

  error = null
  try { scene.requireCount('.tk-card', 2) } catch (caught) { error = caught }
  assert(error && /expected 2/.test(error.message), 'requireCount must enforce the exact count')
  assert.strictEqual(scene.requireCount('.tk-card', 3).length, 3, 'requireCount returns the nodes when the count matches')
}

// ── strict mode: no lookup may fabricate an empty answer ─────────────────────
{
  const strict = createScene({ nodes: { '[data-taskhive-knowledge]': {} } })
  strict.strictLookups(true)

  assert(strict.document.querySelector('[data-taskhive-knowledge]'), 'a declared selector still resolves in strict mode')

  let error = null
  try { strict.document.querySelector('#repo-results .plugin-row') } catch (caught) { error = caught }
  assert(error, 'strict querySelector must throw for an undeclared selector')
  assert.strictEqual(error.code, 'MINI_DOM_MISSING_SELECTOR', 'the strict failure must be identifiable by code')

  error = null
  try { strict.document.querySelectorAll('.tk-card') } catch (caught) { error = caught }
  assert(error && error.code === 'MINI_DOM_MISSING_SELECTOR', 'strict querySelectorAll must throw for an undeclared selector')

  error = null
  try { strict.document.getElementById('never-declared') } catch (caught) { error = caught }
  assert(error && error.code === 'MINI_DOM_MISSING_SELECTOR', 'strict getElementById must not fabricate a node')

  strict.strictLookups(false)
  assert.strictEqual(strict.document.querySelector('#repo-results .plugin-row'), null, 'strict mode can be turned off again')
}

// ── the "deliberately wrong selector" proof, as a probe would ask it ─────────
// smoke-probe-honesty-contract.js runs this against the REAL probes: a mutated
// probes.js whose knowledge anchor is the deleted `#repo-results .plugin-row`
// must go red, and the red must come from this error rather than a timeout.
{
  const probeScene = createScene({ nodes: { '[data-taskhive-knowledge]': {} }, strictLookups: true })
  const ask = (selector) => probeScene.document.querySelector(selector)
  assert(ask('[data-taskhive-knowledge]'), 'the current DSH knowledge anchor must resolve')
  let error = null
  try { ask('#knowledge-category-grid') } catch (caught) { error = caught }
  assert(error && error.code === 'MINI_DOM_MISSING_SELECTOR', 'a wrong selector must turn the lookup red instead of reading as "absent"')
}

console.log('mini-dom strict selector contract passed')
