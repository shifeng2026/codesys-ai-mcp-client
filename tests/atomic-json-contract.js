'use strict';

// Behaviour tests for the atomic JSON store. These exercise the real module
// against a real filesystem, because the property under test is a filesystem
// property (an interrupted write must not truncate the live file, and damage
// must be quarantined rather than silently replaced by defaults).
//
// The previous persistence path was `writeFileSync(file, JSON.stringify(value))`
// straight over the live file, with a failed parse swallowed as "first run".
// The cases below are exactly the ones that made that pattern lossy.

const assert = require('assert');
const fs = require('fs');
const { createTempDir } = require('./lib/temp-dir');
const path = require('path');

const { readJson, writeJson } = require('../app/atomic-json');
const { DirectoryStore } = require('../app/directory-store');

const workspace = createTempDir('taskhive-atomic-json-');
let counter = 0;
const tempFile = (name = 'store.json') => path.join(workspace, `${counter += 1}-${name}`);

const problems = [];
const collect = (message) => problems.push(String(message));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  }
}

test('writeJson then readJson round-trips the exact value', () => {
  const file = tempFile();
  writeJson(file, { version: 2, entries: [{ id: 'a' }] });
  assert.deepStrictEqual(readJson(file, null), { version: 2, entries: [{ id: 'a' }] });
  // The file on disk must be exactly the serialized form, never a partial write.
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{\n  "version": 2,\n  "entries": [\n    {\n      "id": "a"\n    }\n  ]\n}\n');
});

test('a missing file is a first run: fallback returned, nothing reported', () => {
  const file = tempFile('absent.json');
  const seen = [];
  const value = readJson(file, { defaults: true }, { label: 'test', onProblem: (m) => seen.push(m) });
  assert.deepStrictEqual(value, { defaults: true });
  assert.strictEqual(seen.length, 0, 'a missing file must not be reported as damage');
  const quarantined = fs.readdirSync(workspace).filter((name) => name.startsWith(path.basename(file)) && name.includes('.corrupt-'));
  assert.deepStrictEqual(quarantined, [], 'no quarantine is created for a missing file');
});

test('a corrupt file is quarantined, recovered from .bak, and reported', () => {
  const file = tempFile();
  writeJson(file, { generation: 1 });
  writeJson(file, { generation: 2 }); // creates .bak containing generation 1
  fs.writeFileSync(file, '{"generation": 2', 'utf8'); // truncated by an interrupted write

  const seen = [];
  const value = readJson(file, { generation: 'defaults' }, { label: 'test-store', onProblem: (m) => seen.push(m) });

  assert.deepStrictEqual(value, { generation: 1 }, 'the last good generation must be preferred over defaults');
  assert.strictEqual(seen.length >= 1, true, 'damage must be reported');
  assert.ok(seen.some((m) => /test-store/.test(m) && /隔离/.test(m)), `report must name the file and the quarantine: ${seen.join(' | ')}`);

  const quarantined = fs.readdirSync(workspace).filter((name) => name.startsWith(path.basename(file)) && name.includes('.corrupt-'));
  assert.strictEqual(quarantined.length, 1, 'the damaged content must be preserved for inspection');
  assert.strictEqual(fs.readFileSync(path.join(workspace, quarantined[0]), 'utf8'), '{"generation": 2');
  // The live path must no longer hold the damaged bytes.
  assert.deepStrictEqual(readJson(file, null), { generation: 1 });
});

test('recovery is sticky: the next read still sees the recovered value', () => {
  const file = tempFile();
  writeJson(file, { kept: 'first' });
  writeJson(file, { kept: 'second' }); // .bak now holds the first generation
  fs.writeFileSync(file, 'half a json doc', 'utf8');

  assert.deepStrictEqual(readJson(file, { kept: 'defaults' }, { label: 'sticky' }), { kept: 'first' }, 'first read recovers from the backup');
  // Regression guard: the damaged file was moved aside, so without restoring the
  // live path the second read would return the defaults and lose the same
  // settings the first read had just recovered.
  assert.deepStrictEqual(readJson(file, { kept: 'defaults' }, { label: 'sticky' }), { kept: 'first' }, 'second read must not fall back to defaults');
  assert.strictEqual(fs.existsSync(file), true, 'the live path is restored from the backup');
});

test('a live file that vanished but has a backup is restored, not defaulted', () => {
  const file = tempFile();
  writeJson(file, { generation: 'old' });
  writeJson(file, { generation: 'new' }); // .bak = old
  fs.rmSync(file);
  // The most recent good generation, not the built-in defaults.
  assert.deepStrictEqual(readJson(file, { generation: 'defaults' }, { label: 'vanished' }), { generation: 'old' });
});

test('a corrupt file with no usable backup falls back but still preserves the damage', () => {
  const file = tempFile();
  fs.writeFileSync(file, 'not json at all', 'utf8');

  const seen = [];
  const value = readJson(file, { fallback: true }, { label: 'no-backup', onProblem: (m) => seen.push(m) });

  assert.deepStrictEqual(value, { fallback: true });
  assert.strictEqual(seen.length, 2, `expected a damage report and a no-backup report: ${seen.join(' | ')}`);
  assert.ok(!fs.existsSync(file), 'the damaged file is moved aside, not left to be overwritten');
  assert.strictEqual(fs.readdirSync(workspace).filter((n) => n.includes('.corrupt-')).length >= 1, true);
});

test('a zero-byte file counts as damage, not as "not configured yet"', () => {
  const file = tempFile();
  writeJson(file, { keep: 'me' });
  writeJson(file, { keep: 'me' }); // ensure a .bak exists
  fs.writeFileSync(file, '', 'utf8');

  const seen = [];
  const value = readJson(file, { keep: 'defaults' }, { label: 'empty', onProblem: (m) => seen.push(m) });
  assert.deepStrictEqual(value, { keep: 'me' }, 'an empty file is damage; the backup must win over defaults');
  assert.ok(seen.some((m) => /0 字节/.test(m)), `the empty-file reason must be reported: ${seen.join(' | ')}`);
});

test('writeJson leaves no temp file behind and survives a second write', () => {
  const file = tempFile();
  writeJson(file, { a: 1 });
  writeJson(file, { a: 2 });
  const leftovers = fs.readdirSync(workspace).filter((name) => name.endsWith('.tmp'));
  assert.deepStrictEqual(leftovers, [], 'no temporary file may remain after a successful write');
  assert.deepStrictEqual(readJson(file, null), { a: 2 });
  assert.deepStrictEqual(readJson(`${file}.bak`, null), { a: 1 }, 'the previous generation is retained');
});

test('DirectoryStore recovers a damaged directory list from its backup', () => {
  const root = fs.mkdtempSync(path.join(workspace, 'root-'));
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  const file = path.join(root, 'profiles', 'directories.json');

  const store = new DirectoryStore(root);
  const custom = store.read();
  custom.entries.push({ id: 'custom-one', name: '自定义目录', path: path.join(root, 'custom'), gitUrl: '', builtin: false, portable: false });
  store.write(custom);
  store.write(custom); // produce a .bak holding the entry

  fs.writeFileSync(file, '{"version":2,"entries":[', 'utf8');

  const reported = [];
  const recovered = new DirectoryStore(root, root, { onProblem: (m) => reported.push(m) }).read();
  assert.ok(recovered.entries.some((entry) => entry.id === 'custom-one'), 'the user entry must survive a truncated file');
  assert.strictEqual(reported.length >= 1, true, 'DirectoryStore must surface the damage through onProblem');
});

test('DirectoryStore with a damaged file and no backup reports rather than silently defaulting', () => {
  const root = fs.mkdtempSync(path.join(workspace, 'root-'));
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'profiles', 'directories.json'), '{oops', 'utf8');

  const reported = [];
  const store = new DirectoryStore(root, root, { onProblem: (m) => reported.push(m) });
  const value = store.read();
  // 7, not 8: the built-in 「专家目录」 default was removed with the experts layer
  // (app/directory-store.js), so the shipped default list is now 7 entries.
  assert.strictEqual(value.entries.length, 7, 'the built-in defaults are still returned so the app can start');
  assert.strictEqual(reported.length >= 1, true, 'but the damage is reported, not hidden');
  assert.ok(fs.readdirSync(path.join(root, 'profiles')).some((n) => n.includes('.corrupt-')), 'the damaged file is quarantined');
});

fs.rmSync(workspace, { recursive: true, force: true });
console.log(`atomic-json contract tests passed (${problems.length} recovered-damage reports observed)`);
