'use strict'

const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const app = join(__dirname, '..')
const catalog = JSON.parse(readFileSync(join(app, 'profiles', 'model-catalog.json'), 'utf8'))
const adapter = readFileSync(join(app, 'plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js'), 'utf8')
const main = readFileSync(join(app, 'app', 'main.js'), 'utf8')

assert.strictEqual(catalog.directory, join(app, 'models'))
assert.deepStrictEqual(catalog.defaultRoute, { providerId: 'codex-cli', modelId: 'gpt-5.5' })
assert.strictEqual(catalog.visibility['codex-cli::gpt-6-astra'], true)
assert(catalog.providers.find((provider) => provider.id === 'codex-cli').models.includes('gpt-6-astra'))
assert(adapter.includes("{ id: 'gpt-6-astra', name: 'GPT-6 Astra'"))
// The invariant is about the DEFAULT ROUTE, not about one model's boolean.
// `visibility` is user-editable state that persists across launches, so pinning
// `codex-cli::gpt-5.5 === true` made a legitimate Settings toggle fail the suite
// — which is exactly what happened on 2026-09-15, when the shipped catalog was
// found with `gpt-5.5 = false` while `defaultRoute` still pointed at it. What
// must hold is that the route a turn actually uses is a route the composer can
// show: `models:select` refuses to select a hidden model and `models:set-visible`
// refuses to hide the active one, so no user-editable map may leave the default
// route hidden. Every declared model must also keep an explicit visibility entry,
// and an unreadable catalog still fails closed on the routes the shipped build
// hides.
assert.notStrictEqual(
  catalog.visibility[`${catalog.defaultRoute.providerId}::${catalog.defaultRoute.modelId}`],
  false,
  'the default route must not point at a hidden model',
)
const defaultProvider = catalog.providers.find((provider) => provider.id === catalog.defaultRoute.providerId)
assert(
  defaultProvider && (defaultProvider.models || []).includes(catalog.defaultRoute.modelId),
  'the default route must name a model the catalog declares',
)
for (const provider of catalog.providers) {
  for (const modelId of provider.models || []) {
    assert(
      Object.prototype.hasOwnProperty.call(catalog.visibility, `${provider.id}::${modelId}`),
      `visibility must have an explicit entry for ${provider.id}::${modelId}`,
    )
  }
}
assert(adapter.includes("'codex-cli::gpt-5.6-sol'"), 'the fail-closed list must hide gpt-5.6-sol when the catalog is unreadable')
assert(adapter.includes("'codex-cli::gpt-5.6-terra'"), 'the fail-closed list must hide gpt-5.6-terra when the catalog is unreadable')
assert(adapter.includes("'codex-cli::gpt-5.6-luna'"), 'the fail-closed list must hide gpt-5.6-luna when the catalog is unreadable')
// Changing visibility must reach the running Harness, otherwise the composer
// keeps the model list it captured at plugin load (the reported bug).
assert(main.includes('function scheduleModelCatalogRefresh('), 'a visibility change must schedule a model catalog refresh')
// The two directions must stay symmetric: `models:select` refuses to select a
// hidden model (`模型已在设置中隐藏，不能作为默认路由`), and `models:set-visible`
// must refuse to hide the model the default route is currently using. Only the
// first was enforced, which is how this catalog ended up with
// `defaultRoute = codex-cli/gpt-5.5` while `gpt-5.5` was hidden.
const setVisibleHandler = main.slice(main.indexOf("ipcMain.handle('models:set-visible'"), main.indexOf("ipcMain.handle('models:add-custom'"))
assert(
  /defaultRoute\?\.providerId === provider\.id && modelCatalog\.defaultRoute\?\.modelId === modelId/.test(setVisibleHandler),
  'models:set-visible must refuse to hide the model the current default route uses',
)
assert(/scheduleModelCatalogRefresh\(\)/.test(main.slice(main.indexOf("ipcMain.handle('models:set-visible'"), main.indexOf("ipcMain.handle('models:add-custom'"))), 'models:set-visible must refresh the Harness')
// A hung CLI must not hold a turn forever, but the cap has to fit the gateway: this
// install's answers a trivial prompt in 46-79s and sometimes past 300s, so the old
// hardcoded 120s failed ordinary turns. It is now generous and overridable.
assert(adapter.includes('TASKHIVE_MODEL_TIMEOUT_MS'), 'the request timeout must be overridable per install')
assert(/configured >= 1000 \? configured : 300000/.test(adapter), 'the request timeout default must leave room for a slow gateway')
// A timeout says more about the gateway than about the request — the same trivial
// prompt has taken 46s and 300s+ on this install — so the timed-out attempt is
// retried instead of failing the whole turn. The count stays bounded and
// overridable, and nothing but a timeout is retried.
assert(/const CODEX_REQUEST_ATTEMPTS = \(\(\) => \{[\s\S]{0,400}?\}\)\(\)/.test(adapter), 'a timed-out CLI attempt must be retried')
assert(adapter.includes("error?.code === 'TIMEOUT' && index < CODEX_REQUEST_ATTEMPTS"), 'only a timeout is retried, and only up to the attempt limit')
assert(adapter.includes('TASKHIVE_MODEL_ATTEMPTS'), 'the attempt count must be overridable per install')
assert(adapter.includes("'TIMEOUT'"))
assert(adapter.includes('is not supported'))
assert(adapter.includes('模型响应流已中断'))
assert(main.includes("defaultRoute: { providerId: 'codex-cli', modelId: 'gpt-5.5' }"))
// The smoke probe must not pin any model count. `visibility` is user-editable
// state, so the invariant is "the composer lists exactly the visible catalog
// models". The probe derives the expected counts from the catalog the app
// reports and compares the native picker against them.
assert(main.includes('let expected = { gpt: 0, web: 0, local: 0 }'), 'the probe must derive expected counts, not hardcode them')
assert(main.includes("const visibleCount = (pid) => { const entry = cat.providers.find((item) => item.id === pid); return ((entry && entry.models) || []).filter((m) => cat.visibility[pid + '::' + m] !== false).length; }"), 'expected counts must come from the reported catalog visibility')
assert(main.includes('const visibleCodexCount = expected.gpt'), 'the Codex comparison must use the derived count')
assert(main.includes('result.nativeWebModels?.length === visibleWebCount'), 'the web model count must be compared, not pinned')
assert(main.includes('result.nativeLocalModels?.length === visibleLocalCount'), 'the local model count must be compared, not pinned')
assert(main.includes('result.nativeGptModels?.length === visibleCodexCount'), 'the composer must be compared against the reported catalog')
for (const pinned of ['result.nativeWebModels?.length === 8', 'result.nativeLocalModels?.length === 4', "const nativeGptModels = ['GPT-6 Astra', 'GPT-5.5']"]) {
  assert(!main.includes(pinned), `the pinned assertion must be gone: ${pinned}`)
}
// A visibility change must be waited for, because it now triggers a Harness
// refresh before the composer reflects it.
assert(main.includes('const waitForCatalogRefresh = async (timeoutMs = 25000) =>'), 'the probe must wait for the catalog refresh')
assert(main.includes('catalog.refreshState = { pending: Boolean(modelCatalogRefreshTimer)'), 'models:list must expose the refresh state')
assert(main.includes("hasCodex6: options.some((item) => item.providerId === 'codex-cli' && item.modelId === 'gpt-6-astra')"))
assert(main.includes('reportedReserve || 380'))
assert(main.includes("模型已在设置中隐藏，不能作为默认路由"))
assert(main.includes("const health = modelHealthSnapshot();"))
assert(main.includes('claudeCodeStatusAsync'))
assert(main.includes('firstCatalogOpenMs <= 1500'))

console.log('model routing contract passed')
