'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if ((left?.[index] || 0) !== (right?.[index] || 0)) return (left?.[index] || 0) - (right?.[index] || 0);
  }
  return 0;
}

function candidatePaths(env = process.env) {
  const values = [];
  if (env.TASKHIVE_PWSH_BIN) values.push(env.TASKHIVE_PWSH_BIN);
  for (const entry of String(env.PATH || '').split(path.delimiter)) if (entry.trim()) values.push(path.join(entry.trim(), 'pwsh.exe'));
  for (const base of [env.ProgramW6432, env.ProgramFiles, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps')].filter(Boolean)) {
    if (/WindowsApps$/i.test(base)) values.push(path.join(base, 'pwsh.exe'));
    else {
      const root = path.join(base, 'PowerShell');
      try { for (const item of fs.readdirSync(root, { withFileTypes: true })) if (item.isDirectory()) values.push(path.join(root, item.name, 'pwsh.exe')); } catch {}
    }
  }
  return [...new Map(values.map((value) => [path.resolve(String(value)).toLowerCase(), path.resolve(String(value))])).values()];
}

function probe(candidate, run = spawnSync, exists = fs.existsSync) {
  // Microsoft Store installations can expose pwsh.exe through PATH while
  // denying an Electron process direct stat access to WindowsApps. Absolute
  // candidates must exist; the bare PATH candidate is validated by actually
  // launching it and checking that it reports PowerShell Core 7.x.
  if (path.isAbsolute(candidate) && !exists(candidate)) return null;
  try {
    const result = run(candidate, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const version = parseVersion(result?.stdout);
    if (result?.status !== 0 || version?.[0] !== 7) return null;
    return { command: candidate, version: version.join('.'), versionParts: version, edition: 'Core', ready: true };
  } catch { return null; }
}

function resolvePowerShell7(options = {}) {
  if ((options.platform || process.platform) !== 'win32') return { command: options.env?.SHELL || process.env.SHELL || '/bin/bash', version: '', edition: 'posix', ready: true };
  const candidates = [...candidatePaths(options.env || process.env), 'pwsh.exe'];
  const matches = candidates.map((candidate) => probe(candidate, options.run || spawnSync, options.exists || fs.existsSync)).filter(Boolean);
  matches.sort((left, right) => compareVersions(right.versionParts, left.versionParts));
  return matches[0] || { command: 'powershell.exe', version: '5.1', edition: 'Desktop', ready: false };
}

function shellInvocation(shell, command, platform = process.platform) {
  const value = String(command || '');
  if (platform === 'win32') {
    return {
      command: shell.command,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', value],
      windowsVerbatimArguments: false,
    };
  }
  return { command: shell.command, args: ['-lc', value], windowsVerbatimArguments: false };
}

module.exports = { candidatePaths, compareVersions, parseVersion, probe, resolvePowerShell7, shellInvocation };
