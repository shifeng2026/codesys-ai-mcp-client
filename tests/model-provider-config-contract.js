'use strict';

// Contract for the model/provider layer and the Harness-as-architecture rules.
//
// Covers three things that were previously broken or unverifiable:
//   1. A custom OpenAI/Anthropic-compatible endpoint can actually be configured
//      and used (endpoint + credential are persisted, reach the Harness child's
//      environment, and readiness is computed from them).
//   2. The raw API key never travels to the renderer.
//   3. DeepSeek Harness stays the single authoritative runtime: its version is
//      read from the installed slot rather than hardcoded, every provider id is
//      registered at most once (a duplicate aborts the whole plugin tree), and a
//      slot/manifest mismatch is reported instead of trusted.

const assert = require('assert');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const appRoot = join(__dirname, '..');
const read = (relative) => readFileSync(join(appRoot, relative), 'utf8');

const main = read(join('app', 'main.js'));
const preload = read(join('app', 'preload.js'));
const runtime = read(join('app', 'harness-runtime.js'));
const adapter = read(join('plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js'));
const surfaces = read(join('plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js'));
const manifest = JSON.parse(read(join('harness', 'runtime', 'slot', 'manifest.json')));

// ── 1. Credential plumbing exists in the main process ─────────────────────
for (const name of [
  'readApiCredentials',
  'writeApiCredentials',
  'apiKeyEnvName',
  'effectiveProviderEndpoint',
  'resolveConfiguredState',
  'apiCredentialEnvironment',
  'maskApiKey',
  'decorateProviderCredentials',
]) {
  assert(main.includes(`function ${name}(`), `main.js must define ${name}`);
}
assert(main.includes("path.join(root, 'profiles', 'api-credentials.json')"), 'credentials must live in a per-install file');
// The adapter reads the key from the child's environment, so the environment
// must carry it.
assert(/\.\.\.apiCredentialEnvironment\(\),/.test(main), 'the Harness spawn environment must include the stored credentials');

// ── 2. A custom endpoint can be created and reconfigured ───────────────────
// api/local providers need a base URL; the old handler accepted neither.
assert(/if \(kind === 'api' && !endpoint\) throw new Error/.test(main), 'an api provider must require an endpoint');
assert(/if \(endpoint\) entry\.endpoint = endpoint/.test(main), 'the endpoint must be persisted on the provider');
assert(/entry\.apiKeyEnv = apiKeyEnv/.test(main), 'the key env var name must be persisted on the provider');
assert(/entry\.protocol = protocol/.test(main), 'the wire protocol must be persisted on the provider');
assert(/kind === 'cli'\) throw new Error\('自定义 CLI/.test(main), 'an inert custom CLI provider must be rejected with a clear message rather than created');
assert(main.includes("ipcMain.handle('models:set-credential'"), 'there must be a way to set or clear a credential for an existing provider');
const credentialHandler = main.slice(main.indexOf("ipcMain.handle('models:set-credential'"));
assert(/restartHarnessRuntime\('model-credential'\)/.test(credentialHandler), 'setting a credential must restart the Harness so it sees the key');
// A restart binds a new port, so the window must be re-pointed at it or the page
// keeps talking to a dead server.
assert(/function restartHarnessRuntime\(reason\)/.test(main), 'a restart helper must exist');
assert(/reloadWorkbench\(reason\)/.test(main), 'a restart must reload the workbench against the new URL');
// A visibility change must reach an ALREADY-LOADED client in place. The Harness
// plugin watches profiles/model-catalog.json and republishes the forwarded
// `llm/adapters-updated` event, so the client refetches `session.modelCatalog()`
// and re-renders the composer model seat and the /model popup without a page
// reload (which drops the user's view) and without a restart (which changes the
// port and drops the server-side session).
assert(/function reloadWorkbench\(reason\)/.test(main), 'a workbench reload helper must exist');
const refreshHelper = main.slice(main.indexOf('function scheduleModelCatalogRefresh'), main.indexOf('function modelHealthSnapshot'));
assert(refreshHelper.length > 0, 'the batched model-catalog refresh helper must exist');
assert(!/reloadWorkbench\(/.test(refreshHelper), 'a visibility change must not reload the workbench');
assert(/modelCatalogRefreshState = \{ at: new Date\(\)\.toISOString\(\), state: 'refreshed', phase: 'done'/.test(refreshHelper), 'the batched window must still report completion');
assert(/modelCatalogRefreshState\.phase === 'refreshing' \|\| modelCatalogRefreshState\.phase === 'reloading'/.test(main), 'refreshState must stay pending through both the live-refresh window and a post-restart reload');
assert(/fs\.watch\(watchDirectory/.test(adapter), 'the Harness plugin must watch the catalog file itself');
assert(/handle\.replace\(\[route\]\)/.test(adapter), 'an unchanged replace() is what republishes llm/adapters-updated');
assert(preload.includes('setModelCredential'), 'preload must expose setModelCredential');

// ── 3. Readiness is computed, not the literal `unconfigured` ────────────────
assert(/return endpoint && \(storedKey \|\| envKey\) \? 'ready' : 'unconfigured'/.test(main), 'api readiness must require endpoint + key');
assert(/provider\.state = resolveConfiguredState\(provider\)/.test(main), 'models:list must recompute config-driven readiness');
assert(/if \(\['api', 'local'\]\.includes\(provider\.kind\)\) provider\.state = resolveConfiguredState\(provider\)/.test(main), 'models:select must recompute readiness too');

// ── 4. The raw key never leaves the main process ───────────────────────────
const listHandler = main.slice(main.indexOf("ipcMain.handle('models:list'"), main.indexOf("ipcMain.handle('models:select'"));
assert(/decorateProviderCredentials\(catalog\)/.test(listHandler), 'models:list must decorate the catalog with masked credentials');
assert(!/apiKey\s*:/.test(listHandler), 'models:list must not attach a raw apiKey field');
assert(/provider\.apiKeyMasked = maskApiKey\(key\)/.test(main), 'only a masked key may be exposed');

// ── 5. DeepSeek Harness is the authoritative runtime ───────────────────────
// Version comes from the installed slot, not a literal.
assert(runtime.includes('function readSlotVersion(slotRoot)'), 'the runtime must read its version from the slot');
assert(/this\.runtimeVersion = readSlotVersion\(this\.slotRoot\)/.test(runtime), 'the version must be captured at construction');
assert(/runtime: this\.runtimeVersion/.test(runtime), 'status() must report the slot version');
assert(!/runtime: '0\.1\.3-alpha\.2'/.test(runtime), 'the version must not be hardcoded');
// A slot/manifest mismatch is reported, not trusted.
assert(main.includes('function assertHarnessSlotConsistency('), 'startup must check the slot against its manifest');
assert(main.includes('function noteRuntimeOwner('), 'the runtime owner must be recorded for cross-install diagnosis');
assert(/if \(keptLive\)/.test(read(join('app', 'main.js'))), 'a live sibling install path must not be rewritten');
// The patch declares the runtime as the single owner of the agent loop.
assert(/owner: 'Harness\/DSD'|owner: 'Harness\/DSH'/.test(runtime), 'the Harness must remain the declared owner');

// ── 6. Every provider id is registered at most once ────────────────────────
// Registering twice raised DUPLICATE_ADAPTER, which aborted the whole plugin
// tree and made the workbench unloadable. The guard now has to cover two
// sources — the static TaskHive-owned routes and the catalog-driven ones — and
// it must survive the live-refresh path, which re-derives the dynamic set on
// every catalog write and swaps routes with replace().
assert(adapter.includes('const staticRoutes = new Set('), 'the adapter must track its statically registered routes');
assert(/if \(!id \|\| staticRoutes\.has\(id\) \|\| desired\.has\(id\)\) continue/.test(adapter), 'the catalog loop must skip already-registered providers');
assert(/desired\.set\(id, /.test(adapter), 'the loop must record what it registers');
assert(/const desired = new Map\(\)/.test(adapter), 'a catalog pass must de-duplicate its own route set');
assert(/if \(desired\.get\(id\) === entry\.protocol\) continue/.test(adapter), 'the live refresh must keep an unchanged route registered instead of duplicating it');
assert(/if \(dynamic\.has\(id\)\) continue/.test(adapter), 'the live refresh must not re-register a route it already holds');
assert(/ctx\.llm\.registerAdapter\(\[ANTHROPIC_PROVIDER\]/.test(adapter), 'the Anthropic adapter must be registered');
assert(/AnthropicApiAdapter : CatalogModelAdapter/.test(adapter), 'protocol:"anthropic" must select the Anthropic adapter');

// ── 7. The catalog advertises the Anthropic route, and no duplicate DeepSeek ──
const anthropic = (manifest && null) || JSON.parse(read(join('profiles', 'model-catalog.json')));
const providerById = (id) => (anthropic.providers || []).find((item) => item.id === id);
const anthropicProvider = providerById('anthropic-api');
assert(anthropicProvider, 'the catalog must declare anthropic-api');
assert.strictEqual(anthropicProvider.protocol, 'anthropic', 'anthropic-api must use the Anthropic wire protocol');
assert.strictEqual(anthropicProvider.apiKeyEnv, 'ANTHROPIC_API_KEY', 'anthropic-api must document its key env var');
// `deepseek-api` was retired: it pointed at the public api.deepseek.com while the
// install already reaches DeepSeek through its own gateway route, which put two
// near-identically named DeepSeek cards in the picker. The invariant is now the
// opposite of what it was — exactly one DeepSeek route, the gateway one, and it
// lives in the Harness settings document rather than this catalog.
assert(
  !providerById('deepseek-api'),
  'the catalog must NOT declare deepseek-api — a second DeepSeek route is the duplicate this contract exists to prevent'
);
assert(
  !(anthropic.providers || []).some((item) => /deepseek/i.test(String(item.name || ''))),
  'no catalog provider may be named after DeepSeek: the only DeepSeek route is the gateway one in the Harness settings document'
);

// ── 8. UI affordances exist for endpoint + key ─────────────────────────────
assert(surfaces.includes('data-taskhive-save-credential'), 'the model settings must offer a save-credential action');
assert(surfaces.includes('自定义模型服务地址'), 'the add-model form must collect a service address');
assert(/value: draft\.protocol/.test(surfaces), 'the add-model form must let the user pick the protocol');
assert(/type: 'password'/.test(surfaces), 'the API key input must be masked');

// ── 9. The heavy inventory scan stays off the main thread ──────────────────
const manifestModule = read(join('app', 'directory-manifest.js'));
assert(manifestModule.includes('function refreshDirectoryManifestAsync('), 'the inventory must offer an async refresh');
assert(manifestModule.includes('new Worker('), 'the async refresh must use a worker thread');
assert(existsSync(join(appRoot, 'app', 'directory-manifest-worker.js')), 'the worker entry point must exist');

console.log('model provider config contract passed');
