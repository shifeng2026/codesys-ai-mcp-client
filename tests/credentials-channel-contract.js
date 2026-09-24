'use strict';

// Contract for the credentials channel that `main.js` documents and
// `model-provider-config-contract.js` already asserts on its producing side.
//
// Background: `main.js` merges `apiCredentialEnvironment()` into the Harness
// child's environment and says so in a comment ("API keys live only in the main
// process; the Harness child receives them as environment variables, which is
// the channel the adapter reads"). `harness-runtime.js` then deleted every
// `DEEPSEEK_*` key out of that same already-merged object. The two facts
// contradicted each other, and the contradiction was invisible because
// `dsh-credentials-local` resolves an env source first and only then falls back
// to the on-disk `.credentials.yaml` — so a file-sourced key masked the loss.
//
// What makes the deletion actively harmful rather than merely redundant: a
// credential stored from the native Models page is written into a settings
// namespace and resolves as an `env` source, which `describe()` reports as
// non-writable. Strip it and the user sees a saved key that never takes effect.
//
// This contract fails if the filter comes back, and it also pins the ordering
// that makes the point: the delete must not run after the merge.

const assert = require('assert');
const { readFileSync } = require('fs');
const { join } = require('path');

const appRoot = join(__dirname, '..');
const runtime = readFileSync(join(appRoot, 'app', 'harness-runtime.js'), 'utf8');
const main = readFileSync(join(appRoot, 'app', 'main.js'), 'utf8');

// ── 1. No blanket `DEEPSEEK_*` strip in the spawn path ─────────────────────
// Any of the shapes this bug could regress into: a regex test over the merged
// object's keys, an explicit delete, or a `for` loop over `env` keys.
assert(
  !/for\s*\([^)]*Object\.keys\(\s*env\s*\)[^)]*\)[^\n]*delete\s+env\s*\[/.test(runtime),
  'harness-runtime.js must not delete keys out of the merged spawn env (that is how the DEEPSEEK_* filter silently dropped stored credentials)'
);
assert(
  !/delete\s+env\s*\[\s*(key|k)\s*\]/.test(runtime),
  'harness-runtime.js must not delete env keys by variable — the credential channel must survive intact'
);
assert(
  !/\^DEEPSEEK_/i.test(runtime),
  'harness-runtime.js must not carry a DEEPSEEK_* filter pattern'
);

// ── 2. The env the child receives still merges the stored credentials ──────
assert(
  /\.\.\.this\.environment/.test(runtime),
  'the spawn env must still spread this.environment (the caller-provided credential layer)'
);
assert(
  /\.\.\.apiCredentialEnvironment\(\),/.test(main),
  'main.js must still pass the stored credentials into the Harness spawn environment'
);

// ── 3. Ordering: the merge happens once, and nothing re-deletes after it ───
const mergeIndex = runtime.indexOf('const env = { ...process.env, ...this.environment');
assert(mergeIndex >= 0, 'the spawn env merge must remain, and stay recognisable');
// The window has to cover the real gap: the merge and the `spawn(` call are
// ~2000 characters apart (the block between them is the long load-bearing
// comment about `--expose-internals`). An 8000-char window keeps the ordering
// check honest without being coupled to the comment's current length.
const afterMerge = runtime.slice(mergeIndex, mergeIndex + 8000);
const spawnIndex = afterMerge.indexOf('spawn(');
assert(spawnIndex > 0, 'the spawn call must follow the env merge');
const between = afterMerge.slice(0, spawnIndex);
assert(
  !/delete\s+env\s*\[/.test(between),
  'no delete may run between building the spawn env and spawning the child'
);

console.log('credentials-channel-contract: ok');
