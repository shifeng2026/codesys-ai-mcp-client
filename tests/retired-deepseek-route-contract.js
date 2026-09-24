'use strict';

// Contract for the retired duplicate DeepSeek route.
//
// `deepseek-api` shipped pointing at the public api.deepseek.com while an install
// already reaches DeepSeek through its own gateway route in the Harness settings
// document. The picker therefore offered two near-identically named DeepSeek
// cards and there was no way for a user to tell which one a turn would use. The
// id is now withdrawn, and this contract holds the three places it used to come
// back from, because dropping it from only one of them is exactly the mistake
// that would make it "mysteriously return":
//
//   1. the in-memory seed in main.js,
//   2. the `ensureLayout()` built-in top-up list (re-added it on every boot), and
//   3. an already-persisted `profiles/model-catalog.json`.
//
// It also pins the positive half: the other seven providers must survive, so a
// future edit cannot "retire the duplicate" by quietly deleting more than asked.

const assert = require('node:assert');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const appRoot = join(__dirname, '..');
const main = readFileSync(join(appRoot, 'app', 'main.js'), 'utf8');

// ── 1. No seed entry, and no ensureLayout top-up entry ─────────────────────
assert(
  !/id:\s*'deepseek-api'/.test(main),
  "main.js must not declare a `deepseek-api` provider entry — that is the seed and the ensureLayout top-up that re-create the duplicate on every boot"
);

// ── 2. A persisted copy is filtered on load ────────────────────────────────
// The merge at `Object.assign(modelCatalog, saved)` is what would otherwise carry
// a previously written copy forward forever, so the load path must name the id.
assert(
  /RETIRED_CATALOG_PROVIDER_IDS/.test(main),
  'main.js must filter retired provider ids out of the persisted catalog on load'
);
const retiredSet = main.match(/new Set\(\[([^\]]*)\]\)/g) || [];
assert(
  retiredSet.some((entry) => entry.includes("'deepseek-api'")),
  "the retired-id set must contain 'deepseek-api'"
);
// The set has to be *applied* to the persisted providers, not merely declared:
// `.filter((provider) => !RETIRED_CATALOG_PROVIDER_IDS.has(provider?.id))`.
assert(
  /providers:\s*saved\.providers\.filter\(/.test(main)
    && /RETIRED_CATALOG_PROVIDER_IDS\.has\(/.test(main),
  'the persisted providers must be filtered through the retired-id set, not merely defined'
);

// ── 3. The shipped catalog no longer carries it, and keeps the rest ────────
const catalogPath = join(appRoot, 'profiles', 'model-catalog.json');
assert(existsSync(catalogPath), `the shipped catalog must exist: ${catalogPath}`);
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const ids = (catalog.providers || []).map((provider) => provider.id);
assert(!ids.includes('deepseek-api'), 'the shipped catalog must not declare deepseek-api');

const expected = ['codex-cli', 'claude-code', 'web-ai', 'modlens-vision', 'video-local', 'anthropic-api', 'ollama-local'];
for (const id of expected) {
  assert(ids.includes(id), `retiring the duplicate must not remove ${id} (catalog has: ${ids.join(', ')})`);
}
assert.strictEqual(ids.length, expected.length, `catalog must declare exactly ${expected.length} providers, found ${ids.length}: ${ids.join(', ')}`);

// A stale visibility entry is the other half of a persisted copy: the map is
// keyed `<provider>::<model>`, so a leftover key would resurrect picker rows.
const staleKeys = Object.keys(catalog.visibility || {}).filter((key) => key.startsWith('deepseek-api::'));
assert.deepStrictEqual(staleKeys, [], `catalog visibility must not keep deepseek-api keys: ${staleKeys.join(', ')}`);

// ── 4. The probes that referenced its models were updated too ──────────────
// `--smoke-model` counts picker labels against the catalog; a leftover
// `deepseek-chat` label would make it demand a model that no longer exists.
assert(
  !/localLabels\s*=\s*\[[^\]]*deepseek-chat/.test(main),
  'the smoke probe must not expect deepseek-chat among the local picker labels'
);
assert(
  !/visibleCount\('deepseek-api'\)/.test(main),
  'the smoke probe must not derive an expectation from the retired provider'
);

console.log(`retired-deepseek-route-contract: ok (${ids.length} providers, no deepseek-api)`);
