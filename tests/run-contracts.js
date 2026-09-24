'use strict'

const { readdirSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const appRoot = join(__dirname, '..')
const tests = readdirSync(__dirname)
  .filter((name) => name.endsWith('.js') && name !== 'run-contracts.js')
  .sort()

let failed = false
for (const test of tests) {
  // Pin every contract to the app root instead of whatever directory the caller
  // happened to be in. `taskhive-codex-model` resolves its model catalog from
  // `process.env.TASKHIVE_ROOT || process.cwd()`, so invoking this runner as
  // `node resources/app/tests/run-contracts.js` from the checkout root made
  // `model-adapter-compatibility-contract.js` fail with
  //   LlmError: Catalog model unavailable: anthropic-api/claude-sonnet-4-5
  // — a false failure that says nothing about the code under test. `npm test`
  // already ran with the app root as cwd; this makes that implicit contract
  // explicit and holds for any invocation path.
  const result = spawnSync(process.execPath, [join(__dirname, test)], {
    stdio: 'inherit',
    cwd: appRoot,
    env: { ...process.env, TASKHIVE_ROOT: appRoot },
  })
  if (result.status !== 0) failed = true
}

process.exitCode = failed ? 1 : 0
