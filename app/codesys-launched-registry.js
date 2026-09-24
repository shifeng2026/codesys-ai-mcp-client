'use strict';
// CODESYS instances that THIS app launched.
//
// They are deliberately detached — the panel says "只有你手动关闭才会结束" — and
// nothing used to end them when TaskHive exited, so instances accumulated in the
// background across restarts (field report: "之前由程序打开的 codesys 工程关闭
// 程序后会一直在留存后台"). This registry remembers what was launched so the exit
// path (and, after a crash, the next start) can close exactly those instances.
//
// Cleanup is deliberately conservative — it must never destroy the user's work:
//   * only PIDs this app launched are ever considered;
//   * the PID must still own a running CODESYS window (which also rejects a
//     recycled PID that now belongs to something else);
//   * the process start time must match the recorded launch, so a recycled PID
//     can never be killed by accident;
//   * a window whose title marks unsaved changes (`*`) is always left open.

const fs = require('fs');
const path = require('path');

const PID_REUSE_TOLERANCE_MS = 15 * 60 * 1000;
const UNSAVED_MARKER = /\*\s*[-–—]\s*CODESYS/i;

function processStartMatches(recordedAtMs, actualStartedAtMs, toleranceMs = PID_REUSE_TOLERANCE_MS) {
  const recorded = Number(recordedAtMs) || 0;
  const actual = Number(actualStartedAtMs) || 0;
  if (!recorded || !actual) return true; // nothing to compare: fall back to the window check
  return Math.abs(actual - recorded) <= toleranceMs;
}

// Pure decision: what to do with one remembered instance.
function classifyLaunchedInstance(record, facts = {}) {
  const pid = Number(record?.pid) || 0;
  if (!pid) return { action: 'skip', reason: 'invalid-record' };
  if (facts.running !== true) return { action: 'skip', reason: 'already-gone' };
  const window = facts.window || null;
  if (!window) return { action: 'keep', reason: 'no-window' };
  if (UNSAVED_MARKER.test(String(window.title || ''))) return { action: 'keep', reason: 'unsaved-changes' };
  if (!processStartMatches(record.launchedAtMs, facts.startedAtMs)) return { action: 'keep', reason: 'pid-reused' };
  return { action: 'close', reason: String(facts.reason || 'launched-by-taskhive') };
}

class CodesysLaunchedRegistry {
  constructor(root, options = {}) {
    this.file = path.join(root, 'logs', 'codesys-launched.json');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.maxEntries = Math.max(4, Number(options.maxEntries) || 32);
  }

  read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!value || typeof value !== 'object') return { cleanExit: true, launched: [] };
      return { cleanExit: value.cleanExit !== false, launched: Array.isArray(value.launched) ? value.launched : [] };
    } catch { return { cleanExit: true, launched: [] }; }
  }

  write(state) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({
        cleanExit: state.cleanExit === true,
        launched: (state.launched || []).slice(-this.maxEntries),
      }, null, 2), 'utf8');
      return true;
    } catch { return false; }
  }

  record(entry) {
    const pid = Number(entry?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    const state = this.read();
    // A live launch always re-opens the sweep window: only the exit path (or a
    // completed startup sweep) may declare the state clean again.
    state.cleanExit = false;
    state.launched = [
      ...state.launched.filter((item) => Number(item.pid) !== pid),
      { pid, exePath: String(entry.exePath || ''), profile: String(entry.profile || ''), launchedAtMs: this.now(), launchedAt: new Date(this.now()).toISOString() },
    ];
    return this.write(state);
  }

  markCleanExit() {
    const state = this.read();
    state.cleanExit = true;
    state.launched = [];
    return this.write(state);
  }

  // Instances remembered by a session that never finished its exit cleanup.
  pending() {
    const state = this.read();
    return state.cleanExit === true ? [] : state.launched;
  }
}

module.exports = { CodesysLaunchedRegistry, classifyLaunchedInstance, processStartMatches, PID_REUSE_TOLERANCE_MS, UNSAVED_MARKER };
