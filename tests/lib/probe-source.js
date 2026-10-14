'use strict';

// Source locator for the packaged smoke probes.
//
// The probe functions were moved out of `app/main.js` into `app/smoke/probes.js`
// (main.js keeps startup, IPC, window management and configuration). Contracts
// that assert what a PROBE checks must read the module; contracts that assert
// main-process wiring keep reading main.js. Reading main.js for a probe string
// now fails for the wrong reason — it says "the probe lost this check" when the
// probe simply lives somewhere else.

const fs = require('fs');
const path = require('path');

const probeSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'smoke', 'probes.js'), 'utf8');

// For the few contracts that only care that "the app contains this probe check",
// search both files so they do not depend on where the probe is defined.
const appSourceWithProbes = `${fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'main.js'), 'utf8')}\n${probeSource}`;

module.exports = { probeSource, appSourceWithProbes };
