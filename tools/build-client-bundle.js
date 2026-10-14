'use strict';

// Assemble the DSH client bundle from the responsibility fragments in
// `plugins/installed/taskhive-surfaces/dsh/src/`.
//
// WHY THIS EXISTS
// The DSH client loader resolves modules from a static table, not from the
// filesystem. Asked for a second file of this package it answers:
//   "missed the module table — not a platform seed word, not a materialized
//    module, and no registered package factory"
// so the shipped bundle MUST stay a single file. The fragments are therefore the
// editable source and this script is the only thing that produces the bundle.
//
// WHY IT IS SAFE
// The fragments are verbatim, contiguous slices of the bundle: splitting them out
// was verified to reassemble byte for byte, and the only difference this script
// introduces is the generated-file banner below. `--check` is an exact byte
// comparison, so an edit made directly to `dsh/client.js` is detected instead of
// being silently overwritten by the next build.
//
// WHY --write IS GUARDED (T199)
// `--write` used to be read-concatenate-overwrite with nothing held in between, so two
// writers that started from different fragment states raced and the loser's fragment edit
// never reached the bundle. The fragments still held it, so the next build repaired it —
// but until that happened the running client was wrong, and the only defence was the human
// convention "dispatch writers serially". That is a protocol, not a guard. Three things now
// stand in the way of a silent lost update:
//
//   * an exclusive lock, so two `--write` runs cannot interleave at all (the loser refuses
//     instead of overwriting);
//   * a fragment re-read, so a `--write` whose sources changed underneath it aborts rather
//     than publishing a bundle that matched no single source state;
//   * an on-disk re-read, so a hand edit that landed in `client.js` between our first read
//     and our write is reported instead of being discarded.
//
// The lock file lives in the OS temp directory rather than next to the bundle ON PURPOSE:
// `plugins/installed/taskhive-surfaces/dsh/` is compared byte for byte across the dev / stage
// / live trees by `tools/check-tree-parity.js`, and a lock file left behind by a killed
// writer would surface there as TREE-ONLY drift. The name is derived from the resolved
// bundle path, so two checkouts cannot share one lock.
//
// USAGE  node tools/build-client-bundle.js [--write | --check | --list]

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dshDir = path.resolve(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh');
const srcDir = path.join(dshDir, 'src');
const bundlePath = path.join(dshDir, 'client.js');

// Kept byte-stable: `--check` compares the whole file including this banner.
const BANNER = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// Assembled from ./src/*.js (in filename order) by tools/build-client-bundle.js.',
  '// The DSH client loader resolves modules from a static table, so this bundle has',
  '// to stay one file: edit the fragments, then rebuild with --write.',
  '',
].join('\n');

// ── lock ──────────────────────────────────────────────────────────────────────────────────
const LOCK_PATH = path.join(
  os.tmpdir(),
  `taskhive-client-bundle-${crypto.createHash('sha1').update(bundlePath).digest('hex').slice(0, 12)}.lock`,
);
// A writer that is genuinely alive keeps its lock no matter how long it takes. A lock whose
// holder cannot be probed (dead pid, or a different machine) is only reclaimed once it is old
// enough that no plausible build is still running.
const LOCK_STALE_MS = 5 * 60 * 1000;

function fragments() {
  if (!fs.existsSync(srcDir)) throw new Error(`fragment directory is missing: ${srcDir}`);
  const names = fs.readdirSync(srcDir).filter((name) => name.endsWith('.js')).sort();
  if (names.length === 0) throw new Error(`no fragments found in ${srcDir}`);
  return names.map((name) => ({ name, text: fs.readFileSync(path.join(srcDir, name), 'utf8') }));
}

// Identity of a whole fragment set: name + byte length + bytes, so a rename, a truncation and
// an edit are all distinguishable.
function fingerprint(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update(part.name);
    hash.update('\u0000');
    hash.update(String(Buffer.byteLength(part.text, 'utf8')));
    hash.update('\u0000');
    hash.update(part.text, 'utf8');
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

function describeChanges(before, after) {
  const beforeByName = new Map(before.map((part) => [part.name, part.text]));
  const afterByName = new Map(after.map((part) => [part.name, part.text]));
  const changed = [];
  for (const [name, text] of afterByName) {
    if (!beforeByName.has(name)) changed.push(`${name} appeared`);
    else if (beforeByName.get(name) !== text) changed.push(name);
  }
  for (const name of beforeByName.keys()) if (!afterByName.has(name)) changed.push(`${name} vanished`);
  return changed.join(', ');
}

// Windows host names are case-insensitive, and the two ways of asking can disagree on case
// (`COMPUTERNAME`=PAYSON vs `os.hostname()`=Payson). Comparing them verbatim would make a
// lock on this very machine look like a lock from another machine, which skips the liveness
// probe — so normalise before comparing.
function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to someone else: still alive.
    return Boolean(error && error.code === 'EPERM');
  }
}

function readLock() {
  try {
    // The body is written immediately after the exclusive create, so a reader can legitimately
    // catch the file empty or half-written; a BOM would also break JSON.parse. Neither may be
    // read as "no lock" (see lockAge in acquireLock).
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

// Age evidence for a lock we hold or are contending. A body with no usable timestamp is NOT
// evidence of staleness: it is the normal shape of a lock being created right now. The file's
// own mtime is the fallback, and only a lock older than the window by THAT measure is stale.
function lockAge(held) {
  const fromBody = Number(held && held.atMs);
  if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
  try {
    return fs.statSync(LOCK_PATH).mtimeMs;
  } catch {
    return NaN; // gone: the holder released it, so the caller may retry
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, JSON.stringify({
        pid: process.pid,
        host: os.hostname(),
        atMs: Date.now(),
        at: new Date().toISOString(),
        bundle: bundlePath,
      }));
      fs.closeSync(fd);
      return { ok: true, reclaimed: attempt > 0 };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const held = readLock();
      const atMs = lockAge(held);
      const ageMs = Number.isFinite(atMs) ? Date.now() - atMs : Infinity;
      const sameHost = Boolean(held) && hostKey(held.host) === hostKey(os.hostname());
      const alive = sameHost && processAlive(held && held.pid);
      if (!alive && ageMs > LOCK_STALE_MS) {
        // Stale: the holder is gone (or unprovable and long overdue). Take it over.
        try { fs.unlinkSync(LOCK_PATH); } catch { /* another writer won the reclaim */ }
        continue;
      }
      return { ok: false, held, ageMs, alive, sameHost, unreadable: held === null };
    }
  }
  return { ok: false, held: readLock(), ageMs: NaN, alive: false, sameHost: false, unreadable: false };
}

function releaseLock() {
  try {
    const held = readLock();
    if (held && held.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch { /* best effort: a lock that will not delete ages out */ }
}

function lockSummary(lock) {
  const held = lock.held || {};
  const since = held.at ? ` since ${held.at}` : '';
  const age = Number.isFinite(lock.ageMs) ? ` (${Math.round(lock.ageMs / 1000)}s old)` : '';
  let state;
  if (lock.alive) state = 'holder process is still running';
  else if (lock.sameHost === false) state = `holder is on another host (${held.host === undefined ? '?' : held.host}), so its process cannot be probed here`;
  else if (lock.unreadable) state = 'lock body has no readable timestamp yet (a writer is mid-create); treating it as held';
  else state = `holder process is not running, but the lock is younger than ${LOCK_STALE_MS / 1000}s`;
  return `pid=${held.pid === undefined ? '?' : held.pid} host=${held.host === undefined ? '?' : held.host}${since}${age} — ${state}`;
}

// ── build ─────────────────────────────────────────────────────────────────────────────────
function assemble(parts) {
  return BANNER + parts.map((part) => part.text).join('');
}

function describe(parts) {
  const total = parts.reduce((sum, part) => sum + part.text.split('\n').length, 0);
  for (const part of parts) {
    process.stdout.write(`  ${part.name.padEnd(42)} ${String(part.text.split('\n').length - 1).padStart(5)} lines\n`);
  }
  process.stdout.write(`  ${String(parts.length).padStart(2)} fragments, ${total - 1} lines of source\n`);
}

// Newest mtime in a directory, or 0 when nothing is readable: used only to explain a
// mismatch, never to decide one.
function newestMtimeMs(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.js'))
      .reduce((newest, name) => Math.max(newest, fs.statSync(path.join(dir, name)).mtimeMs), 0);
  } catch {
    return 0;
  }
}

// Only ever called to EXPLAIN a mismatch that was already decided by bytes.
function reportMtimeSkew() {
  const srcMtime = newestMtimeMs(srcDir);
  let bundleMtime = 0;
  try { bundleMtime = fs.statSync(bundlePath).mtimeMs; } catch { /* reported as missing elsewhere */ }
  if (!srcMtime || !bundleMtime) return;
  const skewMs = srcMtime - bundleMtime;
  if (skewMs > 1000) {
    process.stderr.write(
      `note: dsh/src/*.js is NEWER than dsh/client.js by ${Math.round(skewMs / 1000)}s — ` +
      'the fragments were edited after the last build, which is the usual cause of this mismatch. ' +
      'Re-run with --write to regenerate the bundle.\n',
    );
  } else if (skewMs < -1000) {
    process.stderr.write(
      `note: dsh/client.js is NEWER than dsh/src/*.js by ${Math.round(-skewMs / 1000)}s — ` +
      'the bundle was edited or written AFTER the fragments, which is the signature of a direct edit to ' +
      'the generated file (it is the file that actually runs). Move the change into dsh/src/ or re-run with --write.\n',
    );
  }
}

function runWrite(parts, built, startBundle) {
  const lock = acquireLock();
  if (!lock.ok) {
    process.stderr.write(
      'client-bundle: refusing to --write — another build holds the lock.\n' +
      `  lock: ${LOCK_PATH}\n` +
      `  ${lockSummary(lock)}\n` +
      'Two concurrent writes race on dsh/client.js and the loser\'s fragment edit is silently lost.\n' +
      'Wait for the other build to finish; delete the lock file only if you are certain it is stale.\n',
    );
    return 1;
  }
  if (lock.reclaimed) {
    process.stderr.write(`client-bundle: reclaimed a stale lock at ${LOCK_PATH}\n`);
  }
  try {
    // Guard 1 — the source did not move while we were assembling.
    const again = fragments();
    if (fingerprint(again) !== fingerprint(parts)) {
      const changed = describeChanges(parts, again);
      process.stderr.write(
        'client-bundle: refusing to --write — dsh/src/*.js changed while this build was running' +
        `${changed ? ` (${changed})` : ''}.\n` +
        'Writing now would publish a bundle that never matched any single source state.\n' +
        'Re-run the build against the settled fragments.\n',
      );
      return 1;
    }
    // Guard 2 — nothing else rewrote the bundle between our first read and this write.
    const onDisk = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, 'utf8') : null;
    if (onDisk !== null && onDisk !== built && onDisk !== startBundle) {
      process.stderr.write(
        'client-bundle: refusing to --write — dsh/client.js changed after this build read it, and the new bytes ' +
        'are not what this build assembled.\n' +
        'Refusing so the other change is not silently discarded; inspect it, then re-run.\n',
      );
      return 1;
    }
    fs.writeFileSync(bundlePath, built, 'utf8');
  } finally {
    releaseLock();
  }
  process.stdout.write('client bundle written:\n');
  describe(parts);
  return 0;
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────
function main() {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  const parts = fragments();
  const built = assemble(parts);
  // `client.js` as it stood when this run started, used by write guard 2: it has to be a
  // genuine "before" image, so it is read before the lock is taken.
  const startBundle = fs.existsSync(bundlePath) ? fs.readFileSync(bundlePath, 'utf8') : null;

  if (!write && !check) {
    process.stdout.write('client bundle fragments:\n');
    describe(parts);
    process.stdout.write(`  dsh/client.js ${startBundle === null ? 'is MISSING' : startBundle === built ? 'matches the fragments' : 'DRIFTED from the fragments'}\n`);
    return 0;
  }

  if (write) return runWrite(parts, built, startBundle);

  const current = startBundle;
  if (current === null) {
    process.stderr.write('client-bundle: dsh/client.js is missing; run with --write\n');
    return 1;
  }
  if (current !== built) {
    const currentLines = current.split('\n').length;
    const builtLines = built.split('\n').length;
    process.stderr.write(
      'client-bundle: dsh/client.js does not match ./src/*.js ' +
      `(${currentLines} lines on disk vs ${builtLines} assembled).\n` +
      'It is generated output — edit the fragments under dsh/src/ and re-run with --write.\n',
    );
    reportMtimeSkew();
    if (fs.existsSync(LOCK_PATH)) {
      const held = readLock();
      const atMs = lockAge(held);
      const ageMs = Number.isFinite(atMs) ? Date.now() - atMs : NaN;
      const sameHost = Boolean(held) && hostKey(held.host) === hostKey(os.hostname());
      process.stderr.write(
        `note: a build lock is held right now (${lockSummary({ held, ageMs, sameHost, alive: sameHost && processAlive(held && held.pid), unreadable: held === null })}). ` +
        'A concurrent --write can explain this mismatch; re-run --check once it finishes.\n',
      );
    }
    return 1;
  }
  // Bytes agree, so the bundle is correct. The only timestamp shape worth mentioning is a
  // fragment SAVED AFTER the last build without changing bytes: harmless, but it is how a
  // forgotten edit looks. ("Bundle newer than fragments" is simply the normal result of a
  // build and is deliberately NOT reported — a passing check must stay quiet.)
  const srcMtime = newestMtimeMs(srcDir);
  let bundleMtime = 0;
  try { bundleMtime = fs.statSync(bundlePath).mtimeMs; } catch { /* exists: we just read it */ }
  if (srcMtime && bundleMtime && srcMtime > bundleMtime + 1000) {
    process.stdout.write(
      'client-bundle: dsh/client.js matches ./src/*.js, but a fragment is NEWER than the bundle ' +
      '(identical bytes: saved after the last build without changing content). Byte comparison is exact, ' +
      'so the bundle is correct; re-run --write only if a rebuild was intended.\n',
    );
  } else {
    process.stdout.write('client-bundle: dsh/client.js matches ./src/*.js\n');
  }
  return 0;
}

process.exitCode = main();
