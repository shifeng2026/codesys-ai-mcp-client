const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
assert.match(main, /appendSwitch\(['"]disk-cache-size['"], String\(128 \* 1024 \* 1024\)\)/, 'desktop cache must have a bounded disposable budget');
const logger = fs.readFileSync(path.join(__dirname, '..', 'app', 'diagnostic-log.js'), 'utf8');
assert.match(logger, /DEFAULT_MAX_BYTES = 2 \* 1024 \* 1024/, 'diagnostic logs must use a finite default budget');
console.log('runtime storage budget contract passed');
