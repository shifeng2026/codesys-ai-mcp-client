'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function checkWritable(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.taskhive-write-${crypto.randomUUID()}`);
  fs.writeFileSync(probe, '', { flag: 'wx' });
  fs.unlinkSync(probe);
}

// A denied profile write is not evidence of another running instance. Select a
// writable profile BEFORE Chromium creates its singleton lock, keeping the lock
// enabled. Once imported, retain that profile even if AppData later recovers.
function prepareStartupPaths(app, programRoot, { isolated = false, log = () => {} } = {}) {
  const original = app.getPath('userData');
  const portable = path.join(programRoot, 'user-data');
  const marker = path.join(portable, '.taskhive-portable-profile.json');
  let source = null;
  if (!isolated) {
    if (fs.existsSync(marker)) {
      checkWritable(portable);
      app.setPath('userData', portable);
    } else {
      try { checkWritable(original); }
      catch (error) {
        if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
        checkWritable(portable);
        app.setPath('userData', portable);
        source = original;
        log(`user-data-fallback source=${original} destination=${portable} reason=${error.code}`);
      }
    }
  }

  // DSH spill-local also needs a writable temp directory. Keep this override
  // inside TaskHive and its children; do not change Windows environment values.
  try { checkWritable(app.getPath('temp')); }
  catch (error) {
    if (!['EACCES', 'EPERM'].includes(error.code)) throw error;
    const temporary = path.join(app.getPath('userData'), 'temp');
    checkWritable(temporary);
    app.setPath('temp', temporary);
    process.env.TEMP = temporary;
    process.env.TMP = temporary;
    log(`temp-fallback destination=${temporary} reason=${error.code}`);
  }
  return { source, destination: app.getPath('userData'), marker };
}

// Run only AFTER the singleton lock is acquired. Copy durable state once; never
// move/delete the original, follow dependency junctions, or copy model weights
// and disposable caches. Rebuild profile dependencies from the installed slot.
function seedPortableProfile({ source, destination, marker }, log = () => {}) {
  if (!source || fs.existsSync(marker)) return;
  const excludedRoot = new Set(['data', 'cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'blob_storage', 'Crashpad', 'logs', 'temp']);
  if (fs.existsSync(source)) {
    fs.cpSync(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: false,
      filter: (entry) => {
        const relative = path.relative(source, entry);
        if (!relative) return true;
        const segments = relative.split(path.sep);
        if (excludedRoot.has(segments[0])) return false;
        if (segments.some((name) => ['node_modules', '.dsh-module-fallback', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(name))) return false;
        if (relative === path.join('runtime', 'run-state.json') || relative === path.join('runtime', 'runtime-owner.json')) return false;
        return !fs.lstatSync(entry).isSymbolicLink();
      },
    });
  }
  fs.writeFileSync(marker, JSON.stringify({ source, importedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  log(`user-data-imported source=${source} destination=${destination}`);
}

module.exports = { prepareStartupPaths, seedPortableProfile };
