#!/usr/bin/env node
'use strict'

// Three-tree parity check (T198 item C): the development source tree, the source mirror and
// the running copy must not drift apart silently.
//
//   node tools/check-tree-parity.js            # compare, print the list + totals
//   node tools/check-tree-parity.js --strict   # also fail on files that exist in only one tree
//   node tools/check-tree-parity.js --json     # machine-readable report
//
// The three trees are the same application seen from three places:
//   dev    the development source tree      <checkout>\resources\app
//   stage  the source/repo mirror           <checkout>\.repo-stage
//   live   the copy the user actually runs  C:\TaskHive\resources\app
// (The stage mirror holds `app/`, `tests/`, `tools/` at its root; the other two hold the
//  same relative paths below `resources\app`. Paths are therefore compared RELATIVE TO
//  EACH TREE ROOT, which is what makes them comparable at all.)
//
// What counts as drift:
//   * DRIFT      a relative path that exists in two or three trees with DIFFERENT bytes —
//                the same file says two different things depending on where you look. This
//                is the failure that matters, and it always exits non-zero.
//   * TREE-ONLY  a relative path that exists in exactly one tree. Reported and counted, but
//                only fatal with `--strict`, because a payload tree is not required to carry
//                the source mirror's documents (see the exclusion table for the legitimate
//                cases, and read the printed list for the rest).
//
// Excluded paths, each with the reason it cannot be compared (printed in the report too):
const EXCLUDES = [
  { id: 'logs/**', reason: 'append-only runtime audit/timing logs: the app appends to whichever tree it ran from, so the bytes differ by run history, not by code' },
  { id: 'cache/**', reason: 'content-addressed object-tree caches keyed by a source project sha: written when a tree actually reads a project' },
  { id: 'user-data/**', reason: 'Electron userData (profiles, sessions, window geometry): per-install mutable state' },
  { id: 'workspaces/**', reason: 'per-job working copies and harness workspaces: created and pruned by the job retention policy' },
  { id: 'profiles/model-catalog.json', reason: 'regenerated from the provider configuration on every start; contains no code' },
  { id: '**/*.bak', reason: 'timestamped backups written by the atomic-write path; presence depends on write history' },
  { id: 'harness/runtime/slot/**', reason: 'the DSH runtime slot is materialized per machine; its lockfiles/manifest are re-pinned by pnpm install, never copied between trees' },
  { id: 'knowledge/**', reason: 'knowledge catalog and managed repository working copies: the app rewrites books.json / cards.json / sync-state.json at runtime' },
  { id: 'plugins/catalog.json', reason: 'the plugin catalog is rewritten by the plugin manager at runtime' },
  { id: 'plugins/runtimes/**', reason: 'vendored third-party runtime downloads (e.g. mnemon.exe): fetched on demand, present only where fetched' },
  { id: 'profiles/dsh/**', reason: 'the Harness/DSH home (installed dependencies, auth cookies, session store) is materialized per install: machine state, not code. The authoritative copy of the surface client bundle lives under plugins/installed/taskhive-surfaces/ and IS compared' },
  { id: '**/node_modules/**', reason: 'installed dependencies at any depth, per tree' },
  { id: '**/.git/**', reason: 'SCM metadata at any depth (the source mirror is a git working copy)' },
  { id: '.tmp/**', reason: 'scratch space for throwaway tooling' },
  { id: 'docs/**', reason: 'repository documentation: the source mirror carries documents and archives the shipped payload does not' },
  { id: 'README.md', reason: 'source-repository document, never loaded by the app at runtime' },
  { id: '.gitignore', reason: 'source-repository file, never loaded by the app at runtime' },
  { id: 'contract-run.log', reason: 'contract-runner bookkeeping written by CI/agent runs' },
  { id: 'maintenance-log-*.md', reason: 'maintenance-pass notes written by agent runs' },
]

// ── matcher ───────────────────────────────────────────────────────────────────────────────
// Small, explicit glob matcher: `**` spans path segments, `*` stays inside one segment.
function globToRegExp (glob) {
  let out = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') {
        index += 1
        if (glob[index + 1] === '/') index += 1
        out += '(?:.*/)?'
      } else {
        out += '[^/]*'
      }
    } else if (char === '.') {
      out += '\\.'
    } else {
      out += char.replace(/[\\^$+?()[\]{}|]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

const EXCLUDE_MATCHERS = EXCLUDES.map((rule) => ({ ...rule, regex: globToRegExp(rule.id) }))

function exclusionFor (relative) {
  return EXCLUDE_MATCHERS.find((rule) => rule.regex.test(relative)) || null
}

// ── trees ─────────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const devRoot = path.resolve(__dirname, '..')
const checkoutRoot = path.resolve(devRoot, '..', '..')
const TREES = [
  { id: 'dev', root: process.env.TASKHIVE_PARITY_DEV || devRoot },
  { id: 'stage', root: process.env.TASKHIVE_PARITY_STAGE || path.join(checkoutRoot, '.repo-stage') },
  { id: 'live', root: process.env.TASKHIVE_PARITY_LIVE || 'C:\\TaskHive\\resources\\app' },
]

function sha256 (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// Count the files below an excluded path without hashing them, so the report can say how
// much was skipped per rule instead of only that "something" was.
function countFiles (absolute) {
  let total = 0
  const stack = [absolute]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name))
      else if (entry.isFile()) total += 1
    }
  }
  return total
}

function walk (root) {
  const files = new Map()
  const skipped = new Map()
  if (!fs.existsSync(root)) return { files, skipped, missingRoot: true }
  const stack = ['']
  while (stack.length) {
    const relative = stack.pop()
    const absolute = relative ? path.join(root, relative) : root
    let entries
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        const rule = exclusionFor(`${childRelative}/`)
        if (rule) {
          skipped.set(rule.id, (skipped.get(rule.id) || 0) + countFiles(path.join(root, childRelative)))
          continue
        }
        stack.push(childRelative)
      } else if (entry.isFile()) {
        const rule = exclusionFor(childRelative)
        if (rule) {
          skipped.set(rule.id, (skipped.get(rule.id) || 0) + 1)
          continue
        }
        files.set(childRelative, sha256(path.join(root, childRelative)))
      }
    }
  }
  return { files, skipped, missingRoot: false }
}

function main () {
  const strict = process.argv.includes('--strict')
  const asJson = process.argv.includes('--json')

  const scanned = {}
  for (const tree of TREES) scanned[tree.id] = walk(tree.root)

  const lines = []
  const problems = []
  const missingRoots = TREES.filter((tree) => scanned[tree.id].missingRoot)
  if (missingRoots.length) {
    for (const tree of missingRoots) problems.push(`tree root missing: ${tree.id} ${tree.root}`)
  }

  lines.push('three-tree parity (SHA256 per file, relative to each tree root)')
  for (const tree of TREES) {
    lines.push(`  ${tree.id.padEnd(6)} ${tree.root}  (${scanned[tree.id].files.size} files compared)`)
  }

  // Exclusion table, with the hit count per tree so a reader can see what was NOT compared.
  lines.push('')
  lines.push(`exclusions (${EXCLUDES.length} rules; each rule prints what it skipped and why):`)
  for (const rule of EXCLUDES) {
    const counts = TREES.map((tree) => `${tree.id}=${scanned[tree.id].skipped.get(rule.id) || 0}`).join(' ')
    lines.push(`  ${rule.id.padEnd(30)} ${counts}`)
    lines.push(`    reason: ${rule.reason}`)
  }

  const allPaths = new Set()
  for (const tree of TREES) for (const relative of scanned[tree.id].files.keys()) allPaths.add(relative)

  const drift = []
  const treeOnly = []
  for (const relative of [...allPaths].sort()) {
    const present = TREES.filter((tree) => scanned[tree.id].files.has(relative))
    const distinct = new Set(present.map((tree) => scanned[tree.id].files.get(relative)))
    if (present.length > 1 && distinct.size > 1) {
      drift.push({ relative, hashes: Object.fromEntries(present.map((tree) => [tree.id, scanned[tree.id].files.get(relative)])) })
      problems.push(`DRIFT ${relative}`)
    } else if (present.length === 1) {
      treeOnly.push({ relative, tree: present[0].id })
    }
  }
  if (strict) for (const item of treeOnly) problems.push(`TREE-ONLY ${item.relative} (only in ${item.tree})`)

  lines.push('')
  lines.push(`comparison set: ${allPaths.size} distinct relative paths`)
  lines.push(`DRIFT (same path, different bytes): ${drift.length}`)
  for (const item of drift) {
    lines.push(`  ${item.relative}  ${TREES.map((tree) => `${tree.id}:${(item.hashes[tree.id] || 'absent').slice(0, 12)}`).join(' ')}`)
  }
  lines.push(`TREE-ONLY (present in exactly one tree; fatal only with --strict): ${treeOnly.length}`)
  for (const item of treeOnly) lines.push(`  only in ${item.tree}: ${item.relative}`)

  const total = drift.length + treeOnly.length
  const verdict = drift.length > 0 || (strict && treeOnly.length > 0) ? 'FAIL' : 'OK'
  lines.push('')
  lines.push(`parity: ${drift.length} inconsistent + ${treeOnly.length} tree-only = ${total} total differences  [${verdict}]`)

  const report = {
    ok: verdict === 'OK',
    strict,
    trees: Object.fromEntries(TREES.map((tree) => [tree.id, { root: tree.root, files: scanned[tree.id].files.size, missingRoot: scanned[tree.id].missingRoot }])),
    exclusions: EXCLUDES.map((rule) => ({ id: rule.id, reason: rule.reason, skipped: Object.fromEntries(TREES.map((tree) => [tree.id, scanned[tree.id].skipped.get(rule.id) || 0])) })),
    compared: allPaths.size,
    drift,
    treeOnly,
    driftCount: drift.length,
    treeOnlyCount: treeOnly.length,
    totalDifferences: total,
    problems,
  }

  if (asJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  else process.stdout.write(`${lines.join(os.EOL)}\n`)
  return verdict === 'OK' ? 0 : 1
}

process.exitCode = main()
