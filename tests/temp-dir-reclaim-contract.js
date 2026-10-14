'use strict'

// Contract (T198 item B): every %TEMP% directory a contract creates must be reclaimed,
// and a FAILING contract must keep its evidence.
//
// Measured reason this exists (T198, real machine):
//   * %TEMP% held 4,030 `taskhive-*` directories before the run;
//   * one fully green round (73/73) of the OLD code added exactly 3 more:
//       taskhive-reload-handoff-* / taskhive-sessions-* / taskhive-tree-*
//     — the three files that create a directory and never remove it;
//   * T197 had already fixed the largest single path (`tests/lib/probe-harness.js`,
//     14 dirs per process) but left ~30 `mkdtempSync` call sites on their own.
//
// Two halves, both executable:
//   1. a SOURCE SCAN that pins the mechanism — no contract may root a temp directory
//      directly in `os.tmpdir()` again, and the T197 fix must use the same helper as
//      everyone else (one mechanism, not two);
//   2. a RUNTIME CHECK of the cleanup rule itself — a child that exits 0 loses its
//      directory, a child that exits non-zero keeps it, and neither touches anything
//      it did not create.
//
// The "keeps it on failure" half is deliberately asserted: deleting evidence on a red
// run is how a real failure becomes unreproducible.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const testsDir = __dirname
const sharedHelper = path.join(testsDir, 'lib', 'temp-dir.js')
const { createTempDir } = require('./lib/temp-dir')

// ── 1. source scan: the leak cannot come back through a new call site ────────────────────
function collectSources (dir) {
  const found = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collectSources(full))
    else if (entry.isFile() && entry.name.endsWith('.js')) found.push(full)
  }
  return found
}

// Both leak shapes: a directory created by `mkdtempSync` straight under `os.tmpdir()`, and
// the older `mkdirSync` + `path.join(os.tmpdir(), ...)` variant that probe-harness used
// before T197.
const ROOTED_IN_TEMPDIR = /(?:mkdtempSync|mkdirSync)\(\s*(?:path\.join\(\s*)?os\.tmpdir\(\)/

const sources = collectSources(testsDir)
assert(sources.length > 60, `the scan must see the whole contract suite (saw ${sources.length})`)
assert.strictEqual(path.resolve(sharedHelper), path.join(testsDir, 'lib', 'temp-dir.js'))

const offenders = []
for (const file of sources) {
  const relative = path.relative(testsDir, file).replace(/\\/g, '/')
  if (relative === 'lib/temp-dir.js') continue // the one place allowed to create a %TEMP% root
  const text = fs.readFileSync(file, 'utf8')
  if (ROOTED_IN_TEMPDIR.test(text)) offenders.push(relative)
}
assert.deepStrictEqual(offenders, [],
  `these contracts root a temp directory in os.tmpdir() instead of using tests/lib/temp-dir.js: ${offenders.join(', ')}`)

// One mechanism, not two: the T197 fix in probe-harness must go through the shared helper.
const probeHarness = fs.readFileSync(path.join(testsDir, 'lib', 'probe-harness.js'), 'utf8')
assert(/require\(['"]\.\/temp-dir['"]\)/.test(probeHarness),
  'probe-harness must reuse the shared temp-dir helper instead of its own cleanup copy')

// The helper must be the thing that actually creates the root (a call site that merely
// imports it proves nothing).
const helperSource = fs.readFileSync(sharedHelper, 'utf8')
assert(/fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\)/.test(helperSource),
  'the shared helper must be the one calling mkdtempSync under os.tmpdir()')
assert(/if \(process\.exitCode\) return/.test(helperSource),
  'the shared helper must keep the directory when the process failed (evidence, not tidiness)')

// ── 2. runtime: reclaim on success, keep on failure, never touch a bystander ──────────────
const childSource = (exitCode) => `
  const { createTempDir } = require(${JSON.stringify(sharedHelper)});
  const dir = createTempDir(${JSON.stringify('taskhive-tempdir-contract-')}, { logs: true });
  process.stdout.write(JSON.stringify({ dir, hasLogs: require('node:fs').existsSync(require('node:path').join(dir, 'logs')) }));
  process.exitCode = ${exitCode};
`

function runChild (exitCode) {
  const result = spawnSync(process.execPath, ['-e', childSource(exitCode)], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.strictEqual(result.status, exitCode, `the probe child must exit ${exitCode}: ${result.stderr || ''}`)
  const parsed = JSON.parse(String(result.stdout || ''))
  assert(parsed.dir, 'the child must report the directory it created')
  assert.strictEqual(parsed.hasLogs, true, 'createTempDir({ logs: true }) must create <dir>/logs')
  return parsed.dir
}

// A directory this contract itself owns: it must survive both children untouched, which is
// what proves the cleanup is scoped to the process that created the directory.
const bystander = createTempDir('taskhive-tempdir-bystander-')

const succeeded = runChild(0)
assert.strictEqual(fs.existsSync(succeeded), false,
  `a successful child must reclaim its temp directory (left behind: ${succeeded})`)

const failed = runChild(1)
assert.strictEqual(fs.existsSync(failed), true,
  'a FAILING child must keep its temp directory as evidence')
// Evidence was read; remove it now so this contract still leaves the machine clean.
fs.rmSync(failed, { recursive: true, force: true })

assert.strictEqual(fs.existsSync(bystander), true,
  'a child\'s cleanup must never remove a directory it did not create')

const scanned = sources.length - 1
process.stdout.write(`temp dir reclaim contract passed (scanned ${scanned} contract sources, 0 direct os.tmpdir() roots)\n`)
