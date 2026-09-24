'use strict'
// Contract: the context window a route DECLARES must come from the catalog and
// must match the model's real window.
//
// Why this matters beyond a display percentage: DSH derives the compaction
// threshold from the declared window (contextWindow x 0.8). Declaring 114000 for
// Codex while the installed CLI bundles 272000 for every slug it routes made DSH
// compact at 91 200 tokens — long before the model was actually full — and doubled
// the reported context pressure (a 38 833-token turn read as 34% instead of 14%).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PLUGIN = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js')
const SHIPPED_CATALOG = path.join(__dirname, '..', 'profiles', 'model-catalog.json')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-window-'))
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true })
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  const catalogPath = path.join(root, 'profiles', 'model-catalog.json')
  process.env.TASKHIVE_ROOT = root

  const plugin = await import(pathToFileURL(PLUGIN).href)
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
  const writeCatalog = (providers) => fs.writeFileSync(catalogPath, `${JSON.stringify({ version: 2, visibility: {}, providers }, null, 2)}\n`, 'utf8')
  const windowOf = async (adapter, provider, model) => (await adapter.resolveModel(provider, model)).context?.contextWindow

  try {
    // 1. A catalog override wins on every route that used to be hardcoded.
    writeCatalog([
      { id: 'codex-cli', kind: 'codex-cli', models: ['gpt-5.5'], contextWindow: 999000 },
      { id: 'claude-code', kind: 'cli', models: ['sonnet'], contextWindow: 888000 },
      { id: 'web-ai', kind: 'web', models: ['deepseek-web'], contextWindow: 777000 },
    ])
    const codex = new plugin.CodexCliAdapter({})
    const claude = new plugin.ClaudeCodeAdapter({})
    const web = new plugin.WebAiAdapter()
    check('codex-cli takes its window from the catalog', await windowOf(codex, 'codex-cli', 'gpt-5.5') === 999000, String(await windowOf(codex, 'codex-cli', 'gpt-5.5')))
    check('claude-code takes its window from the catalog', await windowOf(claude, 'claude-code', 'sonnet') === 888000, String(await windowOf(claude, 'claude-code', 'sonnet')))
    check('web-ai takes its window from the catalog', await windowOf(web, 'web-ai', 'deepseek-web') === 777000, String(await windowOf(web, 'web-ai', 'deepseek-web')))

    // 2. With no catalog entry the defaults must still be truthful.
    writeCatalog([
      { id: 'codex-cli', kind: 'codex-cli', models: ['gpt-5.5'] },
      { id: 'claude-code', kind: 'cli', models: ['sonnet'] },
      { id: 'web-ai', kind: 'web', models: ['deepseek-web'] },
    ])
    check('the codex default is the real bundled window, not 114000', await windowOf(codex, 'codex-cli', 'gpt-5.5') === 272000, String(await windowOf(codex, 'codex-cli', 'gpt-5.5')))
    check('the claude default stays at Claude\'s real window', await windowOf(claude, 'claude-code', 'sonnet') === 200000, String(await windowOf(claude, 'claude-code', 'sonnet')))
    check('the web default stays conservative', await windowOf(web, 'web-ai', 'deepseek-web') === 64000, String(await windowOf(web, 'web-ai', 'deepseek-web')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  // 3. The shipped catalog must state the codex window explicitly, so an install
  //    can adjust it without touching code.
  const shipped = JSON.parse(fs.readFileSync(SHIPPED_CATALOG, 'utf8'))
  const codexEntry = (shipped.providers || []).find((provider) => provider.id === 'codex-cli')
  check('the shipped catalog declares the codex window', codexEntry?.contextWindow === 272000, String(codexEntry?.contextWindow))

  // 4. The reported pressure a real measured turn would produce.
  const measured = 38833
  check('a 38833-token turn reads as ~14% of 272000, not 34%',
    Math.round(measured / 272000 * 100) === 14 && Math.round(measured / 114000 * 100) === 34,
    `${Math.round(measured / 272000 * 100)}%`)

  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  <- ${item.detail}`}`)
  const failed = checks.filter((item) => !item.ok)
  console.log(failed.length ? `${failed.length}/${checks.length} checks failed` : `all ${checks.length} checks passed`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch((error) => {
  console.error(`context window contract failed: ${error?.stack || error}`)
  process.exitCode = 1
})
