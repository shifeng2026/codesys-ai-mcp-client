'use strict'

const assert = require('node:assert')
const { pathToFileURL } = require('node:url')
const { join } = require('node:path')

async function run() {
  const moduleUrl = pathToFileURL(join(__dirname, '..', 'plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js')).href
  const {
    CatalogModelAdapter,
    ClaudeCodeAdapter,
    CodexCliAdapter,
    WebAiAdapter,
  } = await import(moduleUrl)

  const prepared = await Promise.all([
    new CodexCliAdapter().prepareCall('codex-cli', 'gpt-5.5'),
    new ClaudeCodeAdapter().prepareCall('claude-code', 'sonnet'),
    new WebAiAdapter().prepareCall('web-ai', 'deepseek-web'),
    // `anthropic-api` stands in as the catalog-backed HTTP route; `deepseek-api`
    // used to play this role until it was retired as a duplicate DeepSeek route.
    new CatalogModelAdapter('anthropic-api').prepareCall('anthropic-api', 'claude-sonnet-4-5'),
  ])

  for (const call of prepared) {
    assert(call.model?.id, 'prepared call must include model metadata')
    assert.strictEqual(typeof call.stream, 'function', 'prepared call must bind a stream entry point')
  }

  assert.strictEqual(prepared[0].model.id, 'gpt-5.5')
  assert.strictEqual(prepared[1].model.id, 'sonnet')
  assert.strictEqual(prepared[2].model.id, 'deepseek-web')
  assert.strictEqual(prepared[3].model.id, 'claude-sonnet-4-5')
  console.log('model adapter compatibility contract passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
