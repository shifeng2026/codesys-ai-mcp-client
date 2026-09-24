'use strict';

const fs = require('fs');
const path = require('path');

function decodeXmlText(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Which project is open RIGHT NOW.
//
// CODESYS writes a `<project file name>.~u` marker next to an open project.
// Measured on a live machine, the file holds four lines: the owning user, the
// machine, the PID of the CODESYS process and a timestamp. That PID is the only
// signal that pairs a CODESYS window with the file it actually has open, and it
// keeps working when the window title and the "recent projects" list disagree,
// when a project was renamed, or when a new project was never written to the
// recent list at all — all of which made auto-detection fail in the field.
// ---------------------------------------------------------------------------
const ULOCK_SUFFIX = '.~u';

function decodeUlock(buffer) {
  const lines = String(decodeOptionBuffer(buffer) || '').split(/\r?\n/).map((line) => line.trim());
  return { user: lines[0] || '', machine: lines[1] || '', pid: Number(lines[2]) || 0, stamp: lines[3] || '' };
}

function openProjectsFromLocks(directories, limit = 64) {
  const records = [];
  for (const directory of new Set((Array.isArray(directories) ? directories : []).filter(Boolean))) {
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (records.length >= limit) return records;
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(ULOCK_SUFFIX)) continue;
      const lockPath = path.join(directory, entry.name);
      const base = entry.name.slice(0, -ULOCK_SUFFIX.length);
      // The marker drops the .project extension; fall back to the bare name in
      // case a project file itself ends with `.project`.
      const projectPath = [path.join(directory, `${base}.project`), path.join(directory, base)]
        .find((candidate) => { try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile() } catch { return false } });
      if (!projectPath) continue;
      let owner = { user: '', machine: '', pid: 0, stamp: '' };
      try { owner = decodeUlock(fs.readFileSync(lockPath)); } catch { /* an unreadable lock is still a lock */ }
      records.push({ projectPath: path.resolve(projectPath), lockPath, ...owner });
    }
  }
  return records;
}

function projectNameFromWindowTitle(title) {
  const match = String(title || '').match(/(?:^|[\\/])([^\\/]+\.project)(?=\s|\[|\-|$)/i)
    || String(title || '').match(/([^\\/]+\.project)/i);
  return match ? match[1].trim() : '';
}

function projectPathsFromOptions(text) {
  const matches = [];
  const pattern = /<Single\b[^>]*Type=["']string["'][^>]*>([^<]*?\.project)<\/Single>/gi;
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    const value = decodeXmlText(match[1]).trim();
    if (/^[A-Za-z]:[\\/]/.test(value)) matches.push(path.resolve(value));
  }
  return matches;
}

function collectOptionFiles(directory, depth = 0, output = []) {
  if (!directory || depth > 4 || output.length >= 256 || !fs.existsSync(directory)) return output;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (output.length >= 256) break;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collectOptionFiles(target, depth + 1, output);
    else if (entry.isFile() && /\.opt$/i.test(entry.name)) output.push(target);
  }
  return output;
}

function decodeOptionBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return String(buffer || '');
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    for (let index = 0; index + 1 < swapped.length; index += 2) { const value = swapped[index]; swapped[index] = swapped[index + 1]; swapped[index + 1] = value; }
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

// The options scan walks up to 256 `.opt` files (up to 8 MB each) under
// %ProgramData%\CODESYS. The workbench may ask for the current project several
// times a minute, so the result is memoized against the roots' directory
// mtimes: opening or closing a project rewrites the option file and touches the
// directory, which is exactly when the answer can change.
const OPTION_SCAN_TTL_MS = 15000;
let optionScanCache = { key: '', at: 0, value: [] };

function optionRootsFingerprint(optionRoots) {
  return (Array.isArray(optionRoots) ? optionRoots : []).map((root) => {
    try { return `${root}:${fs.statSync(root).mtimeMs}` } catch { return `${root}:missing` }
  }).join('|');
}

function recentCodesysProjectPaths(optionRoots = []) {
  const cacheKey = optionRootsFingerprint(optionRoots);
  if (optionScanCache.key === cacheKey && Date.now() - optionScanCache.at < OPTION_SCAN_TTL_MS) return optionScanCache.value;
  const values = [];
  for (const root of optionRoots) {
    for (const file of collectOptionFiles(root)) {
      try {
        if (fs.statSync(file).size > 8 * 1024 * 1024) continue;
        values.push(...projectPathsFromOptions(decodeOptionBuffer(fs.readFileSync(file))));
      } catch { /* malformed or concurrently updated option file */ }
    }
  }
  const result = [...new Map(values.map((value) => [value.toLowerCase(), value])).values()];
  optionScanCache = { key: cacheKey, at: Date.now(), value: result };
  return result;
}

function describeCodesysProject(window, sourcePath, detection) {
  const readOnly = /\[(?:只读|read[- ]?only)\]/i.test(String(window?.title || ''));
  let writeAvailable = !readOnly;
  let writeBlockReason = '';
  if (writeAvailable) {
    try {
      const handle = fs.openSync(sourcePath, 'r+');
      fs.closeSync(handle);
    } catch (error) {
      writeAvailable = false;
      writeBlockReason = `工程文件当前不可写：${error?.code || error?.message || '文件被占用或权限不足'}`;
    }
  } else writeBlockReason = '当前 CODESYS 工程以只读方式打开';
  return {
    found: true,
    sourcePath,
    projectName: path.basename(sourcePath),
    windowId: String(window?.id || ''),
    pid: Number(window?.pid || 0),
    title: String(window?.title || ''),
    readOnly,
    activeGui: true,
    detection,
    writeAvailable,
    writeBlockReason,
  };
}

function resolveCurrentCodesysProject(windows, projectPaths, preferredWindowId = '', openProjects = []) {
  const all = (Array.isArray(windows) ? windows : []).filter(Boolean);
  const titled = all.filter((item) => projectNameFromWindowTitle(item?.title));
  // Usability gates capture/stream, NOT identity: a minimized, hidden or
  // native-host-suspended window can still be the one holding the project open.
  // Preferred and usable windows are simply tried first.
  const ordered = [
    ...titled.filter((item) => item.usable !== false).sort((left, right) => String(left.id) === String(preferredWindowId) ? -1 : String(right.id) === String(preferredWindowId) ? 1 : 0),
    ...titled.filter((item) => item.usable === false),
  ];
  const existing = (Array.isArray(projectPaths) ? projectPaths : [])
    .map((value) => path.resolve(String(value || '')))
    .filter((value) => path.extname(value).toLowerCase() === '.project' && fs.existsSync(value) && fs.statSync(value).isFile());
  const allLocks = (Array.isArray(openProjects) ? openProjects : [])
    .filter((entry) => entry?.projectPath && Number(entry.pid) > 0)
    .filter((entry) => { try { return fs.statSync(entry.projectPath).isFile() } catch { return false } });
  const distinctLocks = [...new Map(allLocks.map((entry) => [String(entry.projectPath).toLowerCase(), entry])).values()];
  // THE MONITORED WINDOW IS THE ONLY WINDOW. The workbench follows the window
  // selected in the CODESYS panel ("当前监视窗口"); it must not quietly bind a
  // project that lives in a different window the plugin also happens to own.
  // When that window is gone or has no project, the caller gets a reason plus the
  // other windows as explicit candidates instead of a silent substitution.
  if (preferredWindowId) {
    const monitored = all.find((item) => String(item.id) === String(preferredWindowId)) || null;
    const otherWindows = titled.filter((item) => String(item.id) !== String(preferredWindowId));
    if (!monitored) {
      return {
        found: false,
        sourcePath: '',
        activeGui: false,
        detection: 'monitored-window-closed',
        monitoredWindowId: String(preferredWindowId),
        candidates: otherWindows.map((item) => ({ windowId: String(item.id || ''), pid: Number(item.pid || 0), title: String(item.title || ''), projectName: projectNameFromWindowTitle(item.title) })),
        openProjects: distinctLocks.slice(0, 8).map((entry) => ({ projectPath: path.resolve(entry.projectPath), name: path.basename(entry.projectPath), pid: Number(entry.pid) || 0, at: String(entry.stamp || '') })),
      };
    }
    const monitoredPid = Number(monitored.pid) || 0;
    const monitoredLocks = distinctLocks.filter((entry) => Number(entry.pid) === monitoredPid);
    for (const lock of monitoredLocks) {
      return { ...describeCodesysProject(monitored, path.resolve(lock.projectPath), 'monitored-window+project-lock'), lockOwnerPid: Number(lock.pid) };
    }
    const projectName = projectNameFromWindowTitle(monitored.title);
    const matching = existing.filter((value) => path.basename(value).toLowerCase() === projectName.toLowerCase());
    if (matching.length === 1) return describeCodesysProject(monitored, matching[0], 'monitored-window+title');
    return {
      found: false,
      sourcePath: '',
      activeGui: false,
      detection: 'monitored-window-no-project',
      monitoredWindowId: String(preferredWindowId),
      monitoredPid,
      candidates: otherWindows.map((item) => ({ windowId: String(item.id || ''), pid: Number(item.pid || 0), title: String(item.title || ''), projectName: projectNameFromWindowTitle(item.title) })),
      openProjects: distinctLocks.slice(0, 8).map((entry) => ({ projectPath: path.resolve(entry.projectPath), name: path.basename(entry.projectPath), pid: Number(entry.pid) || 0, at: String(entry.stamp || '') })),
    };
  }
  const locks = distinctLocks;
  const openProjectSummary = distinctLocks.slice(0, 8).map((entry) => ({ projectPath: path.resolve(entry.projectPath), name: path.basename(entry.projectPath), pid: Number(entry.pid) || 0, at: String(entry.stamp || '') }));

  // 1. Window PID ↔ lock owner PID: the definitive pairing.
  for (const window of ordered) {
    const lock = locks.find((entry) => Number(entry.pid) === Number(window.pid));
    if (lock) return { ...describeCodesysProject(window, path.resolve(lock.projectPath), 'project-lock+window-pid'), lockOwnerPid: Number(lock.pid) };
  }
  // 2. Window title ↔ recent-projects list (the original heuristic).
  for (const window of ordered) {
    const projectName = projectNameFromWindowTitle(window.title);
    const matching = existing.filter((value) => path.basename(value).toLowerCase() === projectName.toLowerCase());
    if (matching.length !== 1) continue;
    return describeCodesysProject(window, matching[0], 'window-title+codesys-options');
  }
  // 3. Exactly one open project, no window to pair it with.
  if (distinctLocks.length === 1) {
    const only = distinctLocks[0];
    const window = ordered.find((item) => Number(item.pid) === Number(only.pid)) || ordered[0] || null;
    return { ...describeCodesysProject(window, path.resolve(only.projectPath), 'project-lock'), lockOwnerPid: Number(only.pid) };
  }
  return {
    found: false,
    sourcePath: '',
    activeGui: false,
    detection: distinctLocks.length > 1 ? 'ambiguous-open-projects' : (titled.length ? 'no-matching-project-file' : 'no-project-window'),
    candidates: titled.map((item) => ({ windowId: String(item.id || ''), pid: Number(item.pid || 0), title: String(item.title || ''), projectName: projectNameFromWindowTitle(item.title) })),
    openProjects: openProjectSummary,
  };
}

function discoverCurrentCodesysProject(windows, preferredWindowId = '', options = {}) {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const roots = [path.join(programData, 'CODESYS', 'Options'), path.join(programData, 'CODESYS')];
  const projectPaths = recentCodesysProjectPaths(roots);
  // Open projects are found through their `.~u` markers, which live next to the
  // project — so the recent list doubles as the directory seed set.
  let openProjects = openProjectsFromLocks([...new Set(projectPaths.map((value) => path.dirname(value)))]);
  // The workbench only ever works with a CODESYS instance THIS plugin started
  // ("工作台只能绑定由当前插件打开的 CODESYS 窗口"). `monitor.listWindows()` is
  // already restricted to plugin-owned HWNDs; the marker scan must be too,
  // otherwise a project open in the user's OWN CODESYS instance would be offered
  // for binding. Filtering by the owned PIDs keeps both halves on the same scope.
  const ownedPids = Array.isArray(options.ownedPids) ? options.ownedPids.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0) : null;
  if (ownedPids) openProjects = openProjects.filter((entry) => ownedPids.includes(Number(entry.pid)));
  const result = resolveCurrentCodesysProject(windows, projectPaths, preferredWindowId, openProjects);
  if (ownedPids) {
    result.scope = { pluginOwnedPids: ownedPids, ownedWindows: (Array.isArray(windows) ? windows : []).length, openProjects: openProjects.length };
  }
  return result;
}

module.exports = { decodeOptionBuffer, decodeUlock, decodeXmlText, discoverCurrentCodesysProject, openProjectsFromLocks, projectNameFromWindowTitle, projectPathsFromOptions, recentCodesysProjectPaths, resolveCurrentCodesysProject, ULOCK_SUFFIX };
