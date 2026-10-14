'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createTempDir } = require('./lib/temp-dir');
const path = require('node:path');
const { prepareStartupPaths, seedPortableProfile } = require('../app/startup-paths');

const fixture = createTempDir('taskhive-startup-paths-');
const previousTemp = process.env.TEMP;
const previousTmp = process.env.TMP;
const originalWrite = fs.writeFileSync;
function makeApp(userData, temporary) {
  const paths = { userData, temp: temporary };
  return { getPath: (key) => paths[key], setPath: (key, value) => { paths[key] = value; } };
}
try {
  const original = path.join(fixture, 'original');
  const temporary = path.join(fixture, 'temporary');
  const program = path.join(fixture, 'program');
  const app = makeApp(original, temporary);
  const normal = prepareStartupPaths(app, program);
  assert.equal(normal.source, null);
  assert.equal(app.getPath('userData'), original);

  const session = path.join(original, 'runtime', 'profiles', 'dsh', 'sessions', 'existing.jsonl');
  fs.mkdirSync(path.dirname(session), { recursive: true });
  fs.writeFileSync(session, 'existing conversation');
  fs.mkdirSync(path.join(original, 'data'), { recursive: true });
  fs.writeFileSync(path.join(original, 'data', 'weights'), 'do not duplicate large model assets');
  fs.mkdirSync(path.join(original, 'runtime', 'profiles', 'dsh', 'profiles', 'web', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(original, 'runtime', 'profiles', 'dsh', 'profiles', 'web', 'node_modules', 'dependency'), 'rebuild');
  fs.symlinkSync(original, path.join(original, 'recursive-link'), process.platform === 'win32' ? 'junction' : 'dir');

  fs.writeFileSync = function (file, ...args) {
    if ([original, temporary].some((dir) => path.dirname(String(file)) === dir)) {
      const error = new Error('simulated access denial');
      error.code = 'EPERM';
      throw error;
    }
    return originalWrite.call(this, file, ...args);
  };
  const fallback = prepareStartupPaths(app, program);
  fs.writeFileSync = originalWrite;
  const portable = path.join(program, 'user-data');
  assert.equal(app.getPath('userData'), portable);
  assert.equal(process.env.TEMP, path.join(portable, 'temp'));
  assert.equal(app.getPath('temp'), process.env.TEMP);
  seedPortableProfile(fallback);
  const copiedSession = path.join(portable, path.relative(original, session));
  assert.equal(fs.readFileSync(copiedSession, 'utf8'), 'existing conversation');
  assert.equal(fs.readFileSync(session, 'utf8'), 'existing conversation');
  assert.equal(fs.existsSync(path.join(portable, 'data')), false);
  assert.equal(fs.existsSync(path.join(portable, 'recursive-link')), false);
  assert.equal(fs.existsSync(path.join(portable, 'runtime', 'profiles', 'dsh', 'profiles', 'web', 'node_modules')), false);

  fs.writeFileSync(copiedSession, 'new conversation');
  seedPortableProfile(fallback);
  assert.equal(fs.readFileSync(copiedSession, 'utf8'), 'new conversation');
  const restarted = makeApp(original, temporary);
  prepareStartupPaths(restarted, program);
  assert.equal(restarted.getPath('userData'), portable, 'keep imported history when original directory becomes writable');

  const isolated = makeApp(path.join(fixture, 'isolated'), temporary);
  const isolatedPaths = prepareStartupPaths(isolated, program, { isolated: true });
  assert.equal(isolatedPaths.source, null);
  assert.equal(isolated.getPath('userData'), path.join(fixture, 'isolated'));
  console.log('startup paths: writable default, denied profile/temp recovery, state preservation, dependency exclusion, repeat launch and isolation passed');
} finally {
  fs.writeFileSync = originalWrite;
  if (previousTemp === undefined) delete process.env.TEMP; else process.env.TEMP = previousTemp;
  if (previousTmp === undefined) delete process.env.TMP; else process.env.TMP = previousTmp;
  fs.rmSync(fixture, { recursive: true, force: true });
}
