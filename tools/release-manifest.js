#!/usr/bin/env node
'use strict'

/*
 * release-manifest.js — regenerate and verify `release-manifest.json`.
 *
 * WHY THIS EXISTS
 * ---------------
 * `release-manifest.json` already recorded the shipped `TaskHive.exe` hash, but
 * nothing tied that EXE to the source tree that produced it. Two install folders
 * labelled "same version" could therefore run different code, and a
 * `resources/app` edited after the release was built was indistinguishable from
 * a pristine one. This tool adds two identity fields:
 *
 *   appDigest     — a SHA-256 over the application source tree (see below)
 *   sourceCommit  — `git -C .repo-stage rev-parse HEAD` at generation time
 *
 * and can verify both later with `--check`, which is the concrete answer to
 * "was resources/app modified after the release was built?".
 *
 * ===========================================================================
 * appDigest DEFINITION (what is included, what is excluded, and why)
 * ===========================================================================
 *
 * Root: `resources/app` (the manifest's `appRoot`). Every recorded path is
 * relative to that root, with `/` separators, so the digest is identical no
 * matter where the checkout lives or which OS separators the host uses.
 *
 * Per-file entry:  utf8(repoRelativePath) + "\u0000" + contentSha256
 * Concatenation:   entries sorted by repoRelativePath (code-unit order), each
 *                  followed by "\n"
 * appDigest:       sha256(concatenation), lowercase hex
 *
 * Paths are hashed in addition to content because a rename or a move between
 * directories is a real source change even when no byte of any file changed.
 * Sorting makes the digest independent of readdir order (which is
 * filesystem-dependent on Windows). No mtime, ctime, size, permissions or
 * absolute path ever enter the digest, so it is stable across machines, across
 * checkouts, and across repeated runs.
 *
 * INCLUDED (the code that actually ships):
 *   app/                 — Electron main/preload/renderer + assets. Renderer
 *                          assets (app/renderer/**, app/assets/**) are part of
 *                          this tree, which is why they are not listed again.
 *   harness/             — harness runtime sources and slot manifests; nested
 *                          `node_modules/` is excluded (see below).
 *   tests/               — the contract suite that is the acceptance evidence.
 *   tools/               — build/verification tooling, including this script.
 *   plugins/installed/   — every installed plugin's shipped source/bundle.
 *   package.json         — app identity: name, version, main, scripts.
 *
 * EXCLUDED, and why each one is excluded:
 *   node_modules/        — dependency payload (repeatable via pnpm/npm install,
 *                          hundreds of MB, contents depend on registry state,
 *                          not on TaskHive source).
 *   cache/               — generated/derived data; recreated at runtime.
 *   logs/                — runtime traces, new on every launch.
 *   workspaces/          — per-user session/working data (GB scale).
 *   profiles/            — per-machine runtime state. Excluded whole, which
 *                          also keeps `profiles/api-credentials.json` out of
 *                          the walk. Credentials must never be hashed into a
 *                          published digest.
 *   *.log, *.tmp         — volatile scratch/trace files.
 *   screenshots          — `screenshots/` dirs and `screenshot*` /
 *                          `*-screenshot.*` files: captured evidence, not code.
 *   api-credentials.json, credentials.json, *.credentials.json
 *                        — defence in depth: any credential-shaped filename is
 *                          skipped anywhere in the tree, not only under
 *                          `profiles/`, so no secret can leak into a digest.
 *   .git/, .gh-deploy/, .tmp/, .DS_Store, Thumbs.db, desktop.ini
 *                        — VCS metadata, deploy staging and OS cruft.
 *
 * Symlinks are NOT followed (following one could pull an out-of-tree payload
 * into the digest). They are recorded deterministically as
 * `sha256("symlink:" + readlink target)` so that adding/removing/retargeting a
 * link still changes the digest.
 *
 * ===========================================================================
 * USAGE
 * ===========================================================================
 *   node tools/release-manifest.js            # print a JSON report, write nothing
 *   node tools/release-manifest.js --write    # update release-manifest.json in place
 *   node tools/release-manifest.js --check    # exit non-zero if the tree drifted
 *   node tools/release-manifest.js --verify   # --check, and RUN the contract suite
 *   node tools/release-manifest.js --list     # print the included file list
 *
 * --check and --verify RUN `node tests/run-contracts.js` (cwd: resources/app) as
 * part of the gate: the recorded `contractTestResult` is produced by that run —
 * real command, real counts, real exit code — never typed in by hand, and a
 * non-zero suite exit is a check failure. `--skip-contract-test` opts out for a
 * digest-only check; it is recorded as `skipped`, never as a pass.
 *
 * Optional: --app-root <dir>  --manifest <file>  --stage <dir>
 *           --skip-artifact   (do not re-hash the 200+ MB EXE)
 *           --skip-contract-test
 *
 * Exit codes: 0 = ok / match, 1 = --check mismatch, 2 = operational error.
 *
 * `--write` NEVER rewrites the recorded EXE `sha256` when the on-disk EXE
 * disagrees with it: the recorded value describes the artifact that was
 * released, and silently adopting a different hash would destroy the evidence.
 * The disagreement is surfaced instead (`artifactVerification`) and on stderr.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT_DIR = __dirname
const DEFAULT_APP_ROOT = path.resolve(SCRIPT_DIR, '..')
const DEFAULT_CHECKOUT_ROOT = path.resolve(DEFAULT_APP_ROOT, '..', '..')
const DEFAULT_MANIFEST = path.join(DEFAULT_CHECKOUT_ROOT, 'release-manifest.json')
const DEFAULT_STAGE = path.join(DEFAULT_CHECKOUT_ROOT, '.repo-stage')

const APP_ROOT_REL = 'resources/app'

// Included trees, relative to appRoot. `plugins/installed` is included but the
// rest of `plugins/` (catalog/manager/backups/staging/runtimes) is not: those
// are manager metadata and install scratch, not shipped plugin code.
const INCLUDED_TREES = ['app', 'harness', 'tests', 'tools', 'plugins/installed']
// Included individual files, relative to appRoot.
const INCLUDED_FILES = ['package.json']

// Directory names excluded at any depth.
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  'cache',
  'logs',
  'workspaces',
  'profiles',
  'screenshots',
  '.git',
  '.gh-deploy',
  '.tmp',
])

// Exact file names excluded at any depth.
const EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  'api-credentials.json',
  'credentials.json',
])

// File-name suffixes excluded at any depth.
const EXCLUDED_FILE_SUFFIXES = ['.log', '.tmp', '.credentials.json']

const SCREENSHOT_RE = /(^screenshot|^screen-shot|-screenshot\.|-screenshots\.)/i

const DIGEST_ALGORITHM =
  'sha256 over newline-joined entries sorted by repo-relative path, ' +
  'each entry = utf8(path) + "\\u0000" + sha256(file content, lowercase hex)'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function sha256String(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex')
}

function sha256FileSync(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024)
    let read
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

function toPosix(relPath) {
  return relPath.split(path.sep).join('/')
}

/**
 * Hex casing is not part of a hash's identity. The pre-existing manifest was
 * written by PowerShell and records the EXE hash in UPPERCASE, while this tool
 * emits lowercase; comparing raw strings would report a bogus "EXE changed"
 * mismatch, so every hash comparison normalises case first.
 */
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null
  return a.toLowerCase() === b.toLowerCase()
}

function isExcludedDirName(name) {
  return EXCLUDED_DIR_NAMES.has(name)
}

function isExcludedFileName(relPath, name) {
  if (EXCLUDED_FILE_NAMES.has(name)) return true
  for (const suffix of EXCLUDED_FILE_SUFFIXES) {
    if (name.endsWith(suffix)) return true
  }
  if (SCREENSHOT_RE.test(name)) return true
  if (relPath.split('/').some((segment) => isExcludedDirName(segment))) return true
  return false
}

/**
 * Walk one included subtree. Symlinks are recorded, never followed.
 * Returns entries: { rel, kind: 'file' | 'symlink', abs?, target? }
 */
function walk(absDir, relPrefix, out) {
  let dirents
  try {
    dirents = fs.readdirSync(absDir, { withFileTypes: true })
  } catch (err) {
    if (err && err.code === 'ENOENT') return
    throw err
  }
  for (const dirent of dirents) {
    const name = dirent.name
    const rel = relPrefix ? `${relPrefix}/${name}` : name
    const abs = path.join(absDir, name)

    // Check the link bit before the directory bit so a junction/symlink that
    // points outside the tree is recorded rather than walked into.
    if (dirent.isSymbolicLink()) {
      let target = null
      try {
        target = fs.readlinkSync(abs)
      } catch {
        target = null
      }
      out.push({ rel, kind: 'symlink', target })
      continue
    }
    if (dirent.isDirectory()) {
      if (isExcludedDirName(name)) continue
      walk(abs, rel, out)
      continue
    }
    if (!dirent.isFile()) continue // skip fifo/socket/device
    if (isExcludedFileName(rel, name)) continue
    out.push({ rel, kind: 'file', abs })
  }
}

/** Compute the appDigest. Pure function of the tree contents. */
function computeAppDigest(appRoot) {
  const collected = []
  for (const rel of INCLUDED_TREES) {
    walk(path.join(appRoot, rel), rel, collected)
  }
  for (const rel of INCLUDED_FILES) {
    const abs = path.join(appRoot, rel)
    let stat
    try {
      stat = fs.lstatSync(abs)
    } catch {
      continue
    }
    if (stat.isSymbolicLink()) {
      let target = null
      try {
        target = fs.readlinkSync(abs)
      } catch {
        target = null
      }
      collected.push({ rel, kind: 'symlink', target })
    } else if (stat.isFile()) {
      collected.push({ rel, kind: 'file', abs })
    }
  }

  const entries = collected.map((item) => {
    const contentHash =
      item.kind === 'symlink'
        ? sha256String(`symlink:${item.target === null ? '<unreadable>' : item.target}`)
        : sha256FileSync(item.abs)
    return { rel: item.rel, kind: item.kind, contentHash }
  })

  // Deterministic order: plain code-unit comparison of the repo-relative path,
  // independent of locale and of the filesystem's readdir order.
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  const concatenation = entries.map((e) => `${e.rel}\u0000${e.contentHash}\n`).join('')
  const digest = sha256String(concatenation)

  return {
    digest,
    fileCount: entries.length,
    symlinkCount: entries.filter((e) => e.kind === 'symlink').length,
    entries,
  }
}

function git(args, cwd) {
  let res
  try {
    res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  } catch (err) {
    return { ok: false, reason: `git spawn failed: ${err && err.message ? err.message : String(err)}` }
  }
  if (!res || res.error) {
    return { ok: false, reason: `git unavailable: ${res && res.error ? res.error.message : 'unknown error'}` }
  }
  if (res.status !== 0) {
    const detail = String(res.stderr || res.stdout || '').trim().split('\n')[0] || `exit ${res.status}`
    return { ok: false, reason: `git ${args.join(' ')} failed: ${detail}` }
  }
  return { ok: true, stdout: String(res.stdout || '') }
}

/** Read `.repo-stage` HEAD + dirty state. Never throws. */
function readSourceIdentity(stageDir) {
  const result = {
    repo: toPosix(path.relative(path.dirname(stageDir), stageDir)) || stageDir,
    commit: null,
    dirty: null,
    commitUnavailableReason: null,
    dirtyUnavailableReason: null,
  }
  if (!fs.existsSync(stageDir)) {
    result.commitUnavailableReason = `staging repo not found at ${stageDir}`
    result.dirtyUnavailableReason = result.commitUnavailableReason
    return result
  }
  const head = git(['rev-parse', 'HEAD'], stageDir)
  if (head.ok) {
    result.commit = head.stdout.trim() || null
    if (!result.commit) result.commitUnavailableReason = 'git rev-parse HEAD returned an empty commit'
  } else {
    result.commitUnavailableReason = head.reason
  }
  const status = git(['status', '--porcelain'], stageDir)
  if (status.ok) {
    result.dirty = status.stdout.trim().length > 0
  } else {
    result.dirtyUnavailableReason = status.reason
  }
  return result
}

function readJsonIfPresent(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw new Error(`cannot read ${file}: ${err.message}`)
  }
}

/** Hash + measure the released EXE if it sits next to the manifest. */
function inspectArtifact(checkoutRoot, existing) {
  const exePath = path.join(checkoutRoot, 'TaskHive.exe')
  const recorded = {
    sha256: existing && typeof existing.sha256 === 'string' ? existing.sha256 : null,
    length: existing && Number.isFinite(existing.length) ? existing.length : null,
  }
  if (!fs.existsSync(exePath)) {
    return { present: false, path: toPosix(path.relative(checkoutRoot, exePath)), recorded }
  }
  const length = fs.statSync(exePath).size
  const sha256 = sha256FileSync(exePath)
  return {
    present: true,
    path: toPosix(path.relative(checkoutRoot, exePath)),
    observed: { sha256, length },
    recorded,
    sha256MatchesRecorded: recorded.sha256 ? sameHash(sha256, recorded.sha256) : null,
    lengthMatchesRecorded: recorded.length !== null ? length === recorded.length : null,
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    mode: 'report',
    appRoot: DEFAULT_APP_ROOT,
    manifest: DEFAULT_MANIFEST,
    stage: DEFAULT_STAGE,
    skipArtifact: false,
    skipContractTest: false,
  }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1)
    const takeValue = () => {
      if (inlineValue !== null) return inlineValue
      i += 1
      if (i >= argv.length) throw new Error(`${flag} requires a value`)
      return argv[i]
    }
    switch (flag) {
      case '--write':
        opts.mode = 'write'
        break
      case '--check':
        opts.mode = 'check'
        break
      case '--verify':
        // The release/packaging entry point. Identical gate to --check, named for
        // the flow that must call it; both run the contract suite.
        opts.mode = 'check'
        opts.verify = true
        break
      case '--list':
        opts.mode = 'list'
        break
      case '--report':
        opts.mode = 'report'
        break
      case '--skip-artifact':
        opts.skipArtifact = true
        break
      case '--skip-contract-test':
        opts.skipContractTest = true
        break
      case '--app-root':
        opts.appRoot = path.resolve(takeValue())
        break
      case '--manifest':
        opts.manifest = path.resolve(takeValue())
        break
      case '--stage':
        opts.stage = path.resolve(takeValue())
        break
      case '--help':
      case '-h':
        opts.mode = 'help'
        break
      default:
        if (flag.startsWith('--')) throw new Error(`unknown flag: ${flag}`)
        positional.push(arg)
    }
  }
  if (positional.length > 0) throw new Error(`unexpected argument(s): ${positional.join(' ')}`)
  return opts
}

const HELP = `release-manifest.js — regenerate and verify release-manifest.json

  node tools/release-manifest.js            print a JSON report (writes nothing)
  node tools/release-manifest.js --write    update release-manifest.json in place
  node tools/release-manifest.js --check    exit 1 if appDigest/sourceCommit drifted
  node tools/release-manifest.js --verify   --check AND run the contract suite (release gate)
  node tools/release-manifest.js --list     print the sorted list of digested files

--check and --verify run \`node tests/run-contracts.js\` from resources/app. A non-zero
suite exit is a check failure, and the recorded contractTestResult on --write is
that run's real command / counts / exit code. --skip-contract-test opts out for a
digest-only check and is recorded as skipped, never as a pass.

Options (also accepted as --flag=value):
  --app-root <dir>   application source root   (default: ${DEFAULT_APP_ROOT})
  --manifest <file>  manifest to read/write    (default: ${DEFAULT_MANIFEST})
  --stage <dir>      staging git repo          (default: ${DEFAULT_STAGE})
  --skip-artifact    do not re-hash TaskHive.exe (faster; appDigest only)
  --skip-contract-test
                     do not run tests/run-contracts.js

Exit codes: 0 = ok/match, 1 = --check mismatch, 2 = operational error.
`

// ---------------------------------------------------------------------------
// contract suite
// ---------------------------------------------------------------------------

// The acceptance suite is the only evidence that the recorded digest is a
// WORKING tree, not merely an unchanged one. It used to be a hand-pasted string
// ("49 run, 49 passed" / observedBy: "recorded by hand") that `--write` dutifully
// preserved, so the manifest could claim a green suite for a tree the suite was
// never run against. This runs it for real and records what happened.
const CONTRACT_SUMMARY_RE = /^contracts: (\d+) run, (\d+) passed, (\d+) failed, (\d+) timed out$/m
const CONTRACT_COMMAND = 'node tests/run-contracts.js'
const CONTRACT_CWD = APP_ROOT_REL

function parseContractSummary(stdout) {
  const match = CONTRACT_SUMMARY_RE.exec(String(stdout || ''))
  if (!match) return null
  return {
    total: Number(match[1]),
    passed: Number(match[2]),
    failed: Number(match[3]),
    timedOut: Number(match[4]),
  }
}

/** Run tests/run-contracts.js from appRoot and report exactly what came back. */
function runContractSuite(appRoot) {
  const startedAt = Date.now()
  const timeoutMs = Number(process.env.TASKHIVE_RELEASE_CONTRACT_TIMEOUT_MS) > 0
    ? Math.floor(Number(process.env.TASKHIVE_RELEASE_CONTRACT_TIMEOUT_MS))
    : 30 * 60 * 1000
  const observedAt = new Date().toISOString()
  const result = spawnSync(process.execPath, ['tests/run-contracts.js'], {
    cwd: appRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TASKHIVE_ROOT: appRoot, TASKHIVE_RELEASE_CONTRACT_RUN: '1' },
  })
  const durationMs = Date.now() - startedAt
  const stdout = String(result.stdout || '')
  const stderr = String(result.stderr || '')
  const timedOut = result.error?.code === 'ETIMEDOUT'
  const spawnFailed = Boolean(result.error) && !timedOut
  const counts = parseContractSummary(stdout)
  const exitCode = spawnFailed || timedOut ? null : result.status
  const ok = !timedOut && !spawnFailed && exitCode === 0 && Boolean(counts)
  const summary = counts
    ? `${counts.total} run, ${counts.passed} passed, ${counts.failed} failed, ${counts.timedOut} timed out`
    : 'summary line missing from the suite output'
  return {
    command: CONTRACT_COMMAND,
    cwd: CONTRACT_CWD,
    exitCode,
    signal: result.signal || null,
    timedOut,
    spawnFailed,
    spawnError: result.error ? String(result.error.message || result.error) : null,
    counts,
    summary,
    ok,
    durationMs,
    observedAt,
    stdoutTail: stdout.split('\n').slice(-80).join('\n'),
    stderrTail: stderr.split('\n').slice(-40).join('\n'),
  }
}

/** The block `--write` records: the real run, or an explicit "not-run". */
function contractTestBlock({ existing, digest, contractRun }) {
  const prior = existing && existing.verification && existing.verification.contractTest
  const extra = prior && typeof prior === 'object' ? { ...prior } : {}
  // Never carry a previously recorded RESULT forward: every field below is
  // observed, and a stale/hand-typed result is exactly what this replaces.
  delete extra.contractTestResult
  const block = {
    command: CONTRACT_COMMAND,
    cwd: CONTRACT_CWD,
    meaning:
      'Full TaskHive contract suite (tests/run-contracts.js, run from resources/app). ' +
      'Exit 0 means every shipped behavioral contract still holds for this exact source tree, ' +
      'so the acceptance gate passed against the digest recorded here.',
    ...extra,
    contractTestResult: contractRun
      ? {
          command: CONTRACT_COMMAND,
          result: contractRun.ok ? contractRun.summary : `FAILED (exit ${contractRun.exitCode === null ? 'n/a' : contractRun.exitCode}): ${contractRun.summary}`,
          exitCode: contractRun.exitCode,
          counts: contractRun.counts,
          total: contractRun.counts?.total ?? null,
          passed: contractRun.counts?.passed ?? null,
          failed: contractRun.counts?.failed ?? null,
          timedOut: contractRun.counts?.timedOut ?? null,
          durationMs: contractRun.durationMs,
          observedAt: contractRun.observedAt,
          observedAgainstAppDigest: digest,
          observedBy: 'tools/release-manifest.js executed the suite itself during --write; the counts above are this run\'s output',
        }
      : {
          command: CONTRACT_COMMAND,
          result: 'not-run',
          exitCode: null,
          observedAgainstAppDigest: null,
          observedAt: new Date().toISOString(),
          observedBy: 'skipped: --skip-contract-test was passed to --write',
        },
  }
  return block
}

function verificationBlock({ existing, digest, contractRun }) {
  const generated = {
    appDigestCheckCommand: 'node resources/app/tools/release-manifest.js --check',
    appDigestMeaning:
      'exit 0 == resources/app is byte-identical to the source tree this manifest was generated from; ' +
      'non-zero == the app was modified after the release was built.',
    verifyCommand: 'node resources/app/tools/release-manifest.js --verify',
    contractTest: contractTestBlock({ existing, digest, contractRun }),
  }
  // Hand-recorded acceptance evidence — runtime/UI smoke output, extra probe runs —
  // must survive `--write`. Rebuilding this block from scratch used to drop all of
  // it silently, which is how a recorded verification result disappeared between
  // two runs. `contractTest` is the exception: it is observed, not recorded.
  const prior = existing && existing.verification && typeof existing.verification === 'object' ? existing.verification : {}
  for (const [key, value] of Object.entries(prior)) {
    if (key === 'generatedAt' || key === 'contractTest') continue
    if (generated[key] === undefined) generated[key] = value
  }
  return generated
}

// A pasted suite result describes the tree it was run against. If the digest moved
// since, say so instead of letting the manifest imply the result covers the new
// tree. This never edits the recorded result — it only warns.
function warnIfRecordedResultPredatesDigest(existing, digestInfo) {
  const recordedDelay =
    existing &&
    existing.verification &&
    existing.verification.contractTest &&
    existing.verification.contractTest.contractTestResult
  const recorded = recordedDelay && typeof recordedDelay.result === 'string' ? recordedDelay.result : null
  if (!recorded || recorded === 'not-run') return
  const priorDigest = existing && typeof existing.appDigest === 'string' ? existing.appDigest : null
  if (!priorDigest || priorDigest === digestInfo.digest) return
  process.stderr.write(
    'release-manifest: WARNING the recorded contract-test result was observed against appDigest ' +
    `${priorDigest} but the tree now hashes to ${digestInfo.digest}; re-run the suite and re-record it.\n`,
  )
}

function buildManifest({ opts, existing, digestInfo, source, artifact, nowIso, contractRun }) {
  // Preserve every field we are not deliberately changing, in its original
  // order, then append the identity fields.
  const manifest = Object.assign({}, existing || {})

  manifest.generatedAt = nowIso
  if (!manifest.artifact) manifest.artifact = 'TaskHive.exe'
  if (!manifest.appRoot) manifest.appRoot = APP_ROOT_REL
  if (manifest.runtime === undefined) manifest.runtime = 'local electron'

  // The released EXE hash is evidence: only adopt an observed hash when nothing
  // was recorded before, never overwrite a recorded one.
  const recordedSha = existing && typeof existing.sha256 === 'string' ? existing.sha256 : null
  const recordedLength = existing && Number.isFinite(existing.length) ? existing.length : null
  if (artifact.present) {
    manifest.sha256 = recordedSha || artifact.observed.sha256
    manifest.length = recordedLength !== null ? recordedLength : artifact.observed.length
  } else {
    if (recordedSha) manifest.sha256 = recordedSha
    if (recordedLength !== null) manifest.length = recordedLength
  }

  manifest.appDigest = digestInfo.digest
  manifest.appDigestSpec = {
    algorithm: DIGEST_ALGORITHM,
    root: APP_ROOT_REL,
    fileCount: digestInfo.fileCount,
    symlinkCount: digestInfo.symlinkCount,
    included: INCLUDED_TREES.concat(INCLUDED_FILES).map((rel) => `${APP_ROOT_REL}/${rel}`),
    excluded: [
      `${APP_ROOT_REL}/**/node_modules/`,
      `${APP_ROOT_REL}/cache/`,
      `${APP_ROOT_REL}/logs/`,
      `${APP_ROOT_REL}/workspaces/`,
      `${APP_ROOT_REL}/profiles/`,
      `${APP_ROOT_REL}/**/screenshots/`,
      '*.log',
      '*.tmp',
      'screenshot* / *-screenshot.*',
      'api-credentials.json, credentials.json, *.credentials.json (any depth)',
      '.git/, .gh-deploy/, .tmp/, .DS_Store, Thumbs.db, desktop.ini',
    ],
  }

  manifest.sourceCommit = source.commit
  manifest.sourceDirty = source.dirty
  manifest.source = {
    repo: source.repo,
    commit: source.commit,
    dirty: source.dirty,
    commitUnavailableReason: source.commitUnavailableReason,
    dirtyUnavailableReason: source.dirtyUnavailableReason,
    packageVersion: readPackageVersion(opts.appRoot),
  }

  manifest.artifactVerification = {
    filePresent: artifact.present,
    path: artifact.present ? artifact.path : 'TaskHive.exe',
    sha256MatchesRecordedOnDisk: artifact.present ? artifact.sha256MatchesRecorded : null,
    lengthMatchesRecordedOnDisk: artifact.present ? artifact.lengthMatchesRecorded : null,
    observedSha256: artifact.present ? artifact.observed.sha256 : null,
    observedLength: artifact.present ? artifact.observed.length : null,
  }

  manifest.verification = verificationBlock({ existing, digest: digestInfo.digest, contractRun });
  manifest.verification.generatedAt = nowIso;
  warnIfRecordedResultPredatesDigest(existing, digestInfo)
  return manifest
}

function readPackageVersion(appRoot) {
  const pkg = readJsonIfPresent(path.join(appRoot, 'package.json'))
  return pkg && typeof pkg.version === 'string' ? pkg.version : null
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`release-manifest: ${err.message}\n`)
    process.exitCode = 2
    return
  }

  if (opts.mode === 'help') {
    process.stdout.write(HELP)
    return
  }

  const checkoutRoot = path.dirname(opts.manifest)
  let existing
  try {
    existing = readJsonIfPresent(opts.manifest)
  } catch (err) {
    process.stderr.write(`release-manifest: ${err.message}\n`)
    process.exitCode = 2
    return
  }

  if (!fs.existsSync(opts.appRoot)) {
    process.stderr.write(`release-manifest: app root not found: ${opts.appRoot}\n`)
    process.exitCode = 2
    return
  }

  const digestInfo = computeAppDigest(opts.appRoot)
  const source = readSourceIdentity(opts.stage)
  const artifact = opts.skipArtifact
    ? {
        present: fs.existsSync(path.join(checkoutRoot, 'TaskHive.exe')),
        path: 'TaskHive.exe',
        observed: null,
        recorded: {
          sha256: existing && typeof existing.sha256 === 'string' ? existing.sha256 : null,
          length: existing && Number.isFinite(existing.length) ? existing.length : null,
        },
        sha256MatchesRecorded: null,
        lengthMatchesRecorded: null,
      }
    : inspectArtifact(checkoutRoot, existing)

  if (opts.mode === 'list') {
    process.stdout.write(`${digestInfo.entries.map((e) => e.rel).join('\n')}\n`)
    return
  }

  const recordedDigest = existing && typeof existing.appDigest === 'string' ? existing.appDigest : null
  const recordedCommit = existing && typeof existing.sourceCommit === 'string' ? existing.sourceCommit : null
  const digestMatch = recordedDigest === null ? null : sameHash(recordedDigest, digestInfo.digest)
  const commitMatch = recordedCommit === null ? null : recordedCommit === source.commit

  // The contract suite is the acceptance gate, so --write and --check both run it
  // for real (see runContractSuite). `--skip-contract-test` is an explicit,
  // visible opt-out; it records "not-run"/skipped and never a green result.
  const needsContractRun = (opts.mode === 'write' || opts.mode === 'check') && opts.skipContractTest !== true
  let contractRun = null
  let digestAfterContractRun = digestInfo.digest
  if (needsContractRun) {
    process.stderr.write(`release-manifest: running ${CONTRACT_COMMAND} from ${opts.appRoot} …\n`)
    contractRun = runContractSuite(opts.appRoot)
    process.stderr.write(`release-manifest: contract suite exit=${contractRun.exitCode === null ? 'n/a' : contractRun.exitCode} ${contractRun.summary} (${contractRun.durationMs} ms)\n`)
    if (!contractRun.ok) {
      // Surface the failing contract names on stderr; stdout stays the JSON report.
      const detail = contractRun.stdoutTail.split('\n').filter((line) => /^\[(FAIL|TIMEOUT)\]/.test(line)).join('\n')
      if (detail) process.stderr.write(`${detail}\n`)
      if (contractRun.stderrTail.trim()) process.stderr.write(`${contractRun.stderrTail.trim()}\n`)
    }
    // The suite must be read-only. Re-hash to prove it, and say so if it is not.
    const after = computeAppDigest(opts.appRoot)
    digestAfterContractRun = after.digest
    if (after.digest !== digestInfo.digest) {
      process.stderr.write(
        'release-manifest: WARNING the app tree changed while the contract suite ran ' +
        `(${digestInfo.digest} -> ${after.digest}); the suite is supposed to be read-only.\n`,
      )
    }
  }

  if (opts.mode === 'write') {
    const nowIso = new Date().toISOString()
    const manifest = buildManifest({ opts, existing, digestInfo, source, artifact, nowIso, contractRun })
    fs.writeFileSync(opts.manifest, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8')
    if (artifact.present && artifact.sha256MatchesRecorded === false) {
      process.stderr.write(
        'release-manifest: WARNING TaskHive.exe on disk no longer matches the recorded sha256; ' +
          'the recorded release hash was preserved and the mismatch was flagged in artifactVerification.\n',
      )
    }
    if (source.dirty === true) {
      process.stderr.write(
        'release-manifest: WARNING .repo-stage was DIRTY at generation time; sourceCommit names a commit ' +
          'whose tree does not match the staged working tree.\n',
      )
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          action: 'write',
          manifest: opts.manifest,
          wrote: true,
          appRoot: opts.appRoot,
          appDigest: digestInfo.digest,
          previousAppDigest: recordedDigest,
          appDigestChanged: recordedDigest === null ? null : sameHash(recordedDigest, digestInfo.digest) === false,
          fileCount: digestInfo.fileCount,
          sourceCommit: source.commit,
          sourceDirty: source.dirty,
          sourceCommitUnavailableReason: source.commitUnavailableReason,
          artifactSha256MatchesRecordedOnDisk: artifact.present ? artifact.sha256MatchesRecorded : null,
          contractTestExitCode: contractRun ? contractRun.exitCode : null,
          contractTestSummary: contractRun ? contractRun.summary : 'not-run (--skip-contract-test)',
          contractTestDurationMs: contractRun ? contractRun.durationMs : null,
        },
        null,
        4,
      )}\n`,
    )
    return
  }

  const report = {
    action: opts.mode,
    ok: digestMatch !== false && commitMatch !== false,
    manifest: opts.manifest,
    appRoot: opts.appRoot,
    appDigest: digestInfo.digest,
    recordedAppDigest: recordedDigest,
    appDigestMatches: digestMatch,
    appDigestAfterContractRun: needsContractRun ? digestAfterContractRun : null,
    appDigestStableDuringContractRun: needsContractRun ? digestAfterContractRun === digestInfo.digest : null,
    appDigestSpec: {
      algorithm: DIGEST_ALGORITHM,
      fileCount: digestInfo.fileCount,
      symlinkCount: digestInfo.symlinkCount,
    },
    sourceCommit: source.commit,
    recordedSourceCommit: recordedCommit,
    sourceCommitMatches: commitMatch,
    sourceDirty: source.dirty,
    sourceCommitUnavailableReason: source.commitUnavailableReason,
    sourceDirtyUnavailableReason: source.dirtyUnavailableReason,
    artifact: {
      filePresent: artifact.present,
      sha256MatchesRecordedOnDisk: artifact.present ? artifact.sha256MatchesRecorded : null,
      lengthMatchesRecordedOnDisk: artifact.present ? artifact.lengthMatchesRecorded : null,
      observedLength: artifact.observed ? artifact.observed.length : null,
    },
    contractTest: opts.skipContractTest === true
      ? { skipped: true, skipReason: '--skip-contract-test', command: CONTRACT_COMMAND, cwd: CONTRACT_CWD }
      : (contractRun
          ? {
              skipped: false,
              command: contractRun.command,
              cwd: contractRun.cwd,
              exitCode: contractRun.exitCode,
              ok: contractRun.ok,
              summary: contractRun.summary,
              counts: contractRun.counts,
              durationMs: contractRun.durationMs,
              observedAt: contractRun.observedAt,
              observedAgainstAppDigest: digestInfo.digest,
            }
          : { skipped: true, skipReason: 'not-run-in-this-mode', command: CONTRACT_COMMAND, cwd: CONTRACT_CWD }),
  }

  if (opts.mode === 'check') {
    const problems = []
    if (recordedDigest === null) {
      problems.push('manifest has no recorded appDigest — run with --write first')
    } else if (digestMatch === false) {
      problems.push(
        `appDigest MISMATCH: recorded ${recordedDigest} but the tree now hashes to ${digestInfo.digest} — ` +
          'resources/app was modified after this release manifest was generated.',
      )
    }
    if (recordedCommit === null) {
      if (source.commit !== null) {
        problems.push('manifest has no recorded sourceCommit — run with --write first')
      }
    } else if (commitMatch === false) {
      problems.push(
        `sourceCommit MISMATCH: recorded ${recordedCommit} but .repo-stage HEAD is now ` +
          `${source.commit === null ? `<unavailable: ${source.commitUnavailableReason}>` : source.commit}.`,
      )
    }
    // The acceptance gate. A red contract suite means this tree is not shippable,
    // whatever the digest says.
    if (contractRun && contractRun.ok !== true) {
      const detail = contractRun.timedOut
        ? 'the suite timed out'
        : (contractRun.spawnFailed ? `the suite could not be spawned: ${contractRun.spawnError}` : `exit code ${contractRun.exitCode}`)
      problems.push(
        `contract suite FAILED (${detail}): ${contractRun.summary} — ` +
          `ran \`${CONTRACT_COMMAND}\` from ${CONTRACT_CWD}.`,
      )
    } else if (opts.skipContractTest === true) {
      process.stderr.write(
        'release-manifest: WARNING --skip-contract-test was passed: the contract suite was NOT run, ' +
          'so this check says nothing about whether the tree still passes. Do not use it as a release gate.\n',
      )
    }
    report.problems = problems
    report.ok = problems.length === 0
    if (problems.length > 0) {
      process.stderr.write(`release-manifest: CHECK FAILED for ${opts.manifest}\n`)
      for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
      process.exitCode = 1
    } else {
      report.ok = true
      if (contractRun) {
        process.stderr.write(
          `release-manifest: check OK — ${digestInfo.fileCount} files match the recorded digest and the ` +
          `contract suite passed (${contractRun.summary}, ${contractRun.durationMs} ms).\n`,
        )
      }
      if (source.dirty === true) {
        process.stderr.write(
          'release-manifest: check OK, but .repo-stage is currently dirty (working tree differs from the ' +
            'recorded commit); appDigest still matches the recorded tree.\n',
        )
      }
    }
  }

  process.stdout.write(`${JSON.stringify(report, null, 4)}\n`)
}

main()
