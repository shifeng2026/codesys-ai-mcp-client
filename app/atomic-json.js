'use strict';

// Atomic, recoverable JSON persistence for the small config files TaskHive owns
// (model catalog, directory list, credentials, browser preferences, plugin
// links, local memory).
//
// The pattern this replaces was `fs.writeFileSync(file, JSON.stringify(value))`
// straight over the live file, with a failed `JSON.parse` swallowed and replaced
// by generated defaults. Two failure modes followed from that:
//
//   1. An interrupted write (crash, power loss, full disk) left a truncated
//      file. Because the write was not atomic there was no prior generation to
//      fall back to.
//   2. The next save then wrote the in-memory defaults over whatever the user
//      had, so a single bad write turned into permanent configuration loss —
//      the original content was gone and nothing recorded that it had ever
//      existed.
//
// This module closes both:
//
//   * Writes go to a temp file in the SAME directory, are flushed with fsync,
//     and are then renamed over the target. `rename` replaces the destination
//     atomically, so a reader never observes a half-written file. The previous
//     good content is copied to `<file>.bak` first, giving one recoverable
//     generation.
//   * Reads distinguish "the file does not exist yet" (a legitimate first run,
//     which must not raise an alarm) from "the file exists but cannot be used"
//     (damage). Damaged files are quarantined to `<file>.corrupt-<timestamp>`
//     so they remain available for inspection, and the last good `.bak` is used
//     instead of silently starting over from defaults.
//
// Nothing here reads or logs file contents; only the path and the failure
// reason are ever surfaced, so a credential file can use the same helpers.

const fs = require('fs');
const path = require('path');

function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// Reads a JSON file, recovering from damage as described above.
//
// Returns the parsed value, or `fallback` when the file is absent or unusable.
// `options.onProblem(message)` is called for damage (never for a missing file)
// so the caller can surface it in the bootstrap log.
function readJson(file, fallback, options = {}) {
  const { label = path.basename(file), onProblem } = options;
  const report = (message) => {
    if (typeof onProblem === 'function') {
      try { onProblem(message); } catch { /* reporting must never break the read */ }
    }
  };
  const parseFile = (target) => {
    const stat = fs.statSync(target);
    // A zero-byte file is damage, not "no configuration": the previous
    // implementation treated it as a parse error and silently used defaults,
    // which is exactly the case that lost the user's settings.
    if (stat.size === 0) throw Object.assign(new Error('文件为空（0 字节）'), { code: 'EMPTY_FILE' });
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  };

  try {
    return parseFile(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // No live file. If a good backup exists the file most likely vanished
      // mid-write, so restore it rather than silently starting from defaults.
      // A genuine first run has no backup and takes the silent path below.
      try {
        const recovered = parseFile(`${file}.bak`);
        try { fs.copyFileSync(`${file}.bak`, file); } catch { /* read-only install: keep the recovered value in memory */ }
        report(`${label} 主文件缺失，已从最近一次有效备份 ${file}.bak 恢复`);
        return recovered;
      } catch {
        return fallback;
      }
    }

    // The file exists but is unusable. Move it aside instead of leaving it in
    // place to be overwritten by the next save.
    const quarantine = `${file}.corrupt-${timestampSuffix()}`;
    let quarantined = '';
    try {
      fs.renameSync(file, quarantine);
      quarantined = quarantine;
    } catch { /* best effort: a quarantine failure must not stop recovery */ }
    // T151：隔离文件带时间戳且**原先永不清理** —— 每次解析损坏都永久新增一个。
    // 每个受管文件只保留最近 3 份隔离副本。
    try {
      const dir = path.dirname(file);
      const base = path.basename(file);
      const stale = fs.readdirSync(dir)
        .filter((name) => name.startsWith(`${base}.corrupt-`))
        .sort()
        .slice(0, -3);
      for (const name of stale) {
        try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* best effort */ }
      }
    } catch { /* best effort */ }

    const reason = `${label} 无法解析（${error.message}）`;
    report(`${reason}${quarantined ? `；已隔离为 ${quarantined}` : '；隔离失败'}`);

    // Prefer the previous good generation over generated defaults. Starting
    // from defaults and then saving is what made one bad write permanent.
    try {
      const recovered = parseFile(`${file}.bak`);
      // Restore the live path as well. Without this the recovery is not sticky:
      // the live file is gone, so the NEXT read would see a missing file and hand
      // back the defaults — losing the same settings the recovery just saved.
      try { fs.copyFileSync(`${file}.bak`, file); } catch { /* keep the recovered value in memory */ }
      report(`${label} 已从最近一次有效备份 ${file}.bak 恢复`);
      return recovered;
    } catch {
      report(`${label} 无可用备份，本次使用默认值`);
      return fallback;
    }
  }
}

// Writes JSON atomically, keeping one generation of the previous content.
function writeJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const text = serialize(value);

  let handle = null;
  try {
    handle = fs.openSync(temp, 'w');
    fs.writeFileSync(handle, text, 'utf8');
    // Flush before the rename so the rename cannot publish an empty file.
    fs.fsyncSync(handle);
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch { /* already closed */ }
    }
  }

  if (fs.existsSync(file)) {
    try {
      if (fs.statSync(file).size > 0) fs.copyFileSync(file, `${file}.bak`);
    } catch { /* a missing backup must never block the write */ }
  }

  try {
    fs.renameSync(temp, file);
  } catch (error) {
    // On Windows a rename fails if the destination is momentarily held open by
    // another process (indexer, antivirus). Fall back to a copy so a save is
    // still durable, and let a real failure surface through.
    try {
      fs.copyFileSync(temp, file);
      fs.rmSync(temp, { force: true });
    } catch {
      try { fs.rmSync(temp, { force: true }); } catch { /* leave it for the next run */ }
      throw error;
    }
  }
  return true;
}

module.exports = { readJson, writeJson, serialize };
