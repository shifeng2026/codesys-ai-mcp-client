'use strict'

// `release-manifest.js --check` must be REAL.
//
// The recorded `contractTestResult` used to be a hand-pasted string
// ("49 run, 49 passed, 0 failed, 0 timed out" / observedBy: "recorded by hand
// from the run output; --write preserves this field rather than inventing a
// result") that `--write` carried forward verbatim. The manifest could therefore
// claim a green acceptance suite for a tree the suite was never run against, and
// `--check` only compared digests — so a red contract suite still produced a
// green release check.
//
// This contract drives the real tool against a tiny fixture app root (one green
// contract, then one red one) and pins:
//   * `--write` records the suite's real command, counts and exit code;
//   * `--check` runs the suite itself and FAILS when a contract is red — with the
//     digest still matching, so the failure can only come from the suite;
//   * restoring the contract turns `--check` green again;
//   * `--skip-contract-test` is recorded as skipped/not-run, never as a pass;
//   * the release/packaging path (`npm run verify`, and the pre-hooks on
//     clean:release) is wired to the same gate.
//
// A nested suite run (the tool running the suite that is running this test) is
// detected through TASKHIVE_RELEASE_CONTRACT_RUN and skipped, so `--verify` stays
// finite.

const assert = require('node:assert')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const app = path.resolve(__dirname, '..')
const tool = path.join(app, 'tools', 'release-manifest.js')
const runnerSource = fs.readFileSync(path.join(app, 'tests', 'run-contracts.js'), 'utf8')

// The tool parses this exact line; a reformat must break this contract rather
// than make every recorded count silently "summary line missing".
assert(
  runnerSource.includes('contracts: ${run} run, ${passedCount} passed, ${failedCount} failed, ${timedOutCount} timed out'),
  'the contract runner summary format changed — release-manifest.js can no longer parse real counts',
)

const workDir = createTempDir('taskhive-release-manifest-')
const fixtureRoot = path.join(workDir, 'app')
const fixtureTests = path.join(fixtureRoot, 'tests')
const manifestPath = path.join(workDir, 'release-manifest.json')
fs.mkdirSync(fixtureTests, { recursive: true })
fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'taskhive-release-fixture', version: '0.0.0' }, null, 2), 'utf8')
fs.copyFileSync(path.join(app, 'tests', 'run-contracts.js'), path.join(fixtureTests, 'run-contracts.js'))
const GREEN_CONTRACT = '10-green-contract.js'
const RED_CONTRACT = '20-red-contract.js'
fs.writeFileSync(path.join(fixtureTests, GREEN_CONTRACT), "console.log('fixture green contract passed')\n", 'utf8')

function runTool (args, extraEnv = {}) {
  // 外层预算（runner）是 120 s，内层**必须**严格小于它：相等的话，一个卡住的工具进程
  // 会先撞上 runner 的硬杀，这一条契约自己的诊断（`--write must succeed: <stderr>`）
  // 就永远打不出来，现场只剩 `[TIMEOUT]`（T229 同类，属尚未被观测到的潜在脆弱）。
  // 实测每个 runTool ≈300-450 ms（整条契约 895 ms），30 s 是 ~70× 余量，同时给外层
  // 留出 ~90 s 让契约把真实的 stderr/退出码讲清楚。
  const result = spawnSync(process.execPath, [tool, ...args], {
    cwd: app,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, ...extraEnv },
  })
  let report = null
  try { report = JSON.parse(String(result.stdout || '')) } catch { /* asserted by the caller when it matters */ }
  return { status: result.status, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), report }
}

const baseArgs = ['--manifest', manifestPath, '--app-root', fixtureRoot, '--stage', path.join(workDir, 'no-stage'), '--skip-artifact']

// ── 1. --write records the real run ─────────────────────────────────────────
{
  const write = runTool([...baseArgs, '--write'])
  assert.strictEqual(write.status, 0, `--write must succeed: ${write.stderr}`)
  assert(write.report, `--write must print a JSON report: ${write.stdout}${write.stderr}`)
  assert.strictEqual(write.report.contractTestExitCode, 0, 'a green fixture suite must record exit code 0')
  assert.strictEqual(write.report.contractTestSummary, '1 run, 1 passed, 0 failed, 0 timed out', `unexpected summary: ${write.report.contractTestSummary}`)

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const recorded = manifest.verification.contractTest.contractTestResult
  assert(recorded, 'the manifest must record a contractTestResult')
  assert.strictEqual(recorded.exitCode, 0, 'the recorded exit code must be the real one')
  assert.deepStrictEqual(recorded.counts, { total: 1, passed: 1, failed: 0, timedOut: 0 }, 'the recorded counts must be the real ones')
  assert.strictEqual(recorded.observedAgainstAppDigest, manifest.appDigest, 'the result must name the digest it was observed against')
  assert(/executed the suite itself/.test(String(recorded.observedBy)), 'the recorded result must say it was executed, not pasted')
  assert(!/recorded by hand/.test(JSON.stringify(recorded)), 'a hand-recorded result must never be preserved')
}

// ── 2. --check runs the suite and is green on a green fixture ───────────────
{
  const check = runTool([...baseArgs, '--check'])
  assert.strictEqual(check.status, 0, `--check must pass on a matching, green tree: ${check.stderr}`)
  assert.strictEqual(check.report.ok, true, '--check must report ok')
  assert.strictEqual(check.report.appDigestMatches, true, 'the digest must match')
  assert(check.report.contractTest && check.report.contractTest.skipped === false, 'the suite must really have been run')
  assert.strictEqual(check.report.contractTest.exitCode, 0, 'the check must report the suite exit code')
  assert.strictEqual(check.report.contractTest.counts.total, 1, 'the check must report the real counts')
  assert.strictEqual(check.report.appDigestStableDuringContractRun, true, 'the suite must be read-only')
}

// ── 3. one red contract turns --check red, with the digest still matching ───
{
  fs.writeFileSync(path.join(fixtureTests, RED_CONTRACT), "console.error('fixture red contract failed')\nprocess.exitCode = 1\n", 'utf8')
  // Re-record the digest (the red file is part of the tree now) WITHOUT letting
  // the suite run, so the only thing left to fail in --check is the suite.
  const rewrite = runTool([...baseArgs, '--write', '--skip-contract-test'])
  assert.strictEqual(rewrite.status, 0, `--write --skip-contract-test must succeed: ${rewrite.stderr}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.strictEqual(manifest.verification.contractTest.contractTestResult.result, 'not-run', 'a skipped run must be recorded as not-run')
  assert(/skipped/.test(String(manifest.verification.contractTest.contractTestResult.observedBy)), 'the skip must carry its reason')

  const check = runTool([...baseArgs, '--check'])
  assert.strictEqual(check.status, 1, 'a red contract suite must fail --check')
  assert.strictEqual(check.report.ok, false, '--check must report ok:false')
  assert.strictEqual(check.report.appDigestMatches, true, 'the digest must still match — the failure must come from the suite')
  assert.strictEqual(check.report.contractTest.exitCode, 1, 'the reported exit code must be the suite exit code')
  assert.strictEqual(check.report.contractTest.counts.failed, 1, 'the reported counts must include the red contract')
  const problems = check.report.problems || []
  assert(problems.some((problem) => /contract suite FAILED/.test(problem)), `--check must name the contract failure: ${JSON.stringify(problems)}`)
  assert(!problems.some((problem) => /appDigest MISMATCH/.test(problem)), 'the digest must not be blamed for a contract failure')
  assert(/FAIL/.test(check.stderr), 'the failing contract must be named on stderr for the operator')
}

// ── 4. restoring the contract turns --check green again ─────────────────────
{
  fs.rmSync(path.join(fixtureTests, RED_CONTRACT), { force: true })
  const rewrite = runTool([...baseArgs, '--write', '--skip-contract-test'])
  assert.strictEqual(rewrite.status, 0, `restore --write must succeed: ${rewrite.stderr}`)
  const check = runTool([...baseArgs, '--check'])
  assert.strictEqual(check.status, 0, `--check must be green again: ${check.stderr}`)
  assert.strictEqual(check.report.appDigestMatches, true, 'the digest must match again')
  assert.deepStrictEqual(check.report.contractTest.counts, { total: 1, passed: 1, failed: 0, timedOut: 0 }, 'the restored suite must really be green')
}

// ── 5. --skip-contract-test is visible and never claims a pass ──────────────
{
  const check = runTool([...baseArgs, '--check', '--skip-contract-test'])
  assert.strictEqual(check.status, 0, 'a digest-only check may still pass')
  assert.strictEqual(check.report.contractTest.skipped, true, 'the report must say the suite was skipped')
  assert(/--skip-contract-test was passed/.test(check.stderr), 'the operator must be warned that the acceptance gate was not run')
}

// ── 6. the release/packaging path is wired to the same gate ────────────────
{
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8'))
  assert.strictEqual(pkg.scripts.verify, 'node tools/release-manifest.js --verify --skip-artifact', 'npm run verify must enter the gate')
  assert.strictEqual(pkg.scripts['preclean:release'], 'npm run verify', 'clean:release must verify first (npm pre-hook)')
  assert.strictEqual(pkg.scripts['preclean:release:apply'], 'npm run verify', 'clean:release:apply must verify first (npm pre-hook)')
  assert(/--skip-contract-test/.test(pkg.scripts['verify:digest']), 'the digest-only escape hatch must be explicit about skipping the suite')

  const help = runTool(['--help'])
  assert.strictEqual(help.status, 0, '--help must succeed')
  assert(/--verify/.test(help.stdout) && /contract suite/.test(help.stdout), '--help must document the verify gate')
}

fs.rmSync(workDir, { recursive: true, force: true })
console.log('release manifest realness contract passed')
