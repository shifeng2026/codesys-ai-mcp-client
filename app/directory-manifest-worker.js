'use strict';

// Runs the whole-tree directory inventory on a worker thread.
//
// The scan walks ~140k entries (including every junction-free subtree) and takes
// roughly ten seconds on a real install. Doing that on the Electron main thread
// froze the window on every automatic refresh, so the background/scheduled
// refresh runs here instead. The explicit `--update-directory-manifest` command
// still uses the synchronous implementation, because a CLI must finish writing
// before the process exits.
//
// This module intentionally requires nothing but the manifest module itself —
// it must stay loadable outside the Electron runtime.

const { parentPort, workerData } = require('node:worker_threads');
const { generateDirectoryManifest } = require('./directory-manifest');

try {
  const manifest = generateDirectoryManifest(workerData.programRoot);
  parentPort.postMessage({ ok: true, generatedAt: manifest.generatedAt, totals: manifest.totals });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String((error && error.stack) || error) });
}
