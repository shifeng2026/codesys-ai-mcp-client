'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decodeOptionBuffer, decodeUlock, openProjectsFromLocks, projectNameFromWindowTitle, projectPathsFromOptions, resolveCurrentCodesysProject, ULOCK_SUFFIX } = require('../app/codesys-current-project');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-codesys-current-'));
const projectPath = path.join(tempRoot, 'down_door0731.project');
fs.writeFileSync(projectPath, 'fixture');

assert.strictEqual(projectNameFromWindowTitle('down_door0731.project [只读] - CODESYS '), 'down_door0731.project');
assert.deepStrictEqual(projectPathsFromOptions(`<Single Type="string">${projectPath.replace(/&/g, '&amp;')}</Single>`), [path.resolve(projectPath)]);
const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`<Single Type="string">${projectPath}</Single>`, 'utf16le')]);
assert.ok(decodeOptionBuffer(utf16).includes(projectPath));

const resolved = resolveCurrentCodesysProject([
  { id: '0x1', pid: 42, title: 'CODESYS ', usable: true },
  { id: '0x2', pid: 43, title: 'down_door0731.project [只读] - CODESYS ', usable: true },
], [projectPath], '0x2');
assert.strictEqual(resolved.found, true);
assert.strictEqual(resolved.sourcePath, path.resolve(projectPath));
assert.strictEqual(resolved.readOnly, true);
assert.strictEqual(resolved.writeAvailable, false);

assert.strictEqual(resolveCurrentCodesysProject([{ id: '0x3', title: 'CODESYS ', usable: true }], [projectPath]).found, false);

// ── The open-project marker (`<project>.~u`) ────────────────────────────────
// Field failure this pins down: the window title and the CODESYS "recent
// projects" list disagreed (a renamed/new project, or a window whose project was
// never written to the MRU), so auto-detection reported "ambiguous-project-path"
// and the workbench stayed empty with no way forward. The marker file names the
// PID that has the project open, which is a definitive pairing.
assert.strictEqual(ULOCK_SUFFIX, '.~u');
const lockOwner = decodeUlock(Buffer.from('29925\r\nPAYSON\r\n10016\r\n639250483397565874\r\n', 'utf8'));
assert.deepStrictEqual(lockOwner, { user: '29925', machine: 'PAYSON', pid: 10016, stamp: '639250483397565874' });

const lockDir = path.join(tempRoot, 'open');
fs.mkdirSync(lockDir, { recursive: true });
const lockedProject = path.join(lockDir, 'renamed - 调整阻尼测试.project');
fs.writeFileSync(lockedProject, 'fixture');
fs.writeFileSync(path.join(lockDir, 'renamed - 调整阻尼测试.~u'), '29925\r\nPAYSON\r\n10016\r\n639250483397565874\r\n');
const locks = openProjectsFromLocks([lockDir, path.join(tempRoot, 'missing-dir')]);
assert.strictEqual(locks.length, 1);
assert.strictEqual(locks[0].projectPath, path.resolve(lockedProject));
assert.strictEqual(locks[0].pid, 10016);

// A renamed project is not in the MRU list at all, yet the lock still identifies it.
const viaLock = resolveCurrentCodesysProject([
  { id: '0x9', pid: 10016, title: 'renamed - 调整阻尼测试.project* - CODESYS ', usable: true },
], [], '0x9', locks);
assert.strictEqual(viaLock.found, true);
assert.strictEqual(viaLock.sourcePath, path.resolve(lockedProject));
assert.strictEqual(viaLock.detection, 'monitored-window+project-lock');

// A minimized / native-host-suspended window (usable:false) still owns its project.
const viaSuspended = resolveCurrentCodesysProject([
  { id: '0xA', pid: 10016, title: 'renamed - 调整阻尼测试.project* - CODESYS ', usable: false },
], [], '', locks);
assert.strictEqual(viaSuspended.found, true, 'usability must not hide the open project');
assert.strictEqual(viaSuspended.detection, 'project-lock+window-pid');

// Exactly one open project, but no window to pair it with.
const viaSingleLock = resolveCurrentCodesysProject([{ id: '0xB', pid: 777, title: 'CODESYS ', usable: true }], [], '', locks);
assert.strictEqual(viaSingleLock.found, true);
assert.strictEqual(viaSingleLock.detection, 'project-lock');

// Two open projects and no usable pairing: report the reason AND the candidates
// so the workbench can offer them instead of a dead end.
const secondDir = path.join(tempRoot, 'open2');
fs.mkdirSync(secondDir, { recursive: true });
const secondProject = path.join(secondDir, 'other.project');
fs.writeFileSync(secondProject, 'fixture');
fs.writeFileSync(path.join(secondDir, 'other.~u'), '29925\r\nPAYSON\r\n33120\r\n639250483405331044\r\n');
const twoLocks = openProjectsFromLocks([lockDir, secondDir]);
const ambiguous = resolveCurrentCodesysProject([{ id: '0xC', pid: 999, title: 'CODESYS ', usable: true }], [], '', twoLocks);
assert.strictEqual(ambiguous.found, false);
assert.strictEqual(ambiguous.detection, 'ambiguous-open-projects');
assert.strictEqual(ambiguous.openProjects.length, 2);
assert.deepStrictEqual(ambiguous.openProjects.map((entry) => entry.pid).sort(), [10016, 33120]);

// A window with a project title but no matching file is its own reason.
const noFile = resolveCurrentCodesysProject([{ id: '0xD', pid: 5, title: 'ghost.project - CODESYS ', usable: true }], [], '', []);
assert.strictEqual(noFile.found, false);
assert.strictEqual(noFile.detection, 'no-matching-project-file');
assert.strictEqual(noFile.candidates.length, 1);

// ── Ownership scope ─────────────────────────────────────────────────────────
// The workbench contract is "只能绑定由当前插件打开的 CODESYS 窗口". The window
// list (`monitor.listWindows()`) is filtered to plugin-owned HWNDs, and the
// open-project marker scan must use the SAME scope: a project that is open in the
// user's own, separately started CODESYS must never be offered or auto-bound.
const { discoverCurrentCodesysProject } = require('../app/codesys-current-project');
const scopeRoot = path.join(tempRoot, 'scope');

function makeScope(name, entries) {
  const dir = path.join(scopeRoot, name);
  const programData = path.join(dir, 'ProgramData');
  const optionDir = path.join(programData, 'CODESYS', 'Options');
  fs.mkdirSync(optionDir, { recursive: true });
  const files = {};
  const lines = [];
  for (const entry of entries) {
    const file = path.join(dir, `${entry.name}.project`);
    files[entry.name] = file;
    fs.writeFileSync(file, 'fixture');
    fs.writeFileSync(path.join(dir, `${entry.name}.~u`), `29925\r\nPAYSON\r\n${entry.pid}\r\n639250483397565874\r\n`);
    lines.push(`<Single Type="string">${file}</Single>`);
  }
  fs.writeFileSync(path.join(optionDir, 'recent.opt'), lines.join('\n'), 'utf8');
  return { programData, files };
}

function withScope(scope, run) {
  const previous = process.env.ProgramData;
  process.env.ProgramData = scope.programData;
  try { return run(); } finally { process.env.ProgramData = previous; }
}

// The plugin owns PID 4242; a second CODESYS (PID 9999) was opened by the user.
const mixed = makeScope('mixed', [{ name: 'owned', pid: 4242 }, { name: 'foreign', pid: 9999 }]);
const ownedOnly = withScope(mixed, () => discoverCurrentCodesysProject([{ id: '0xE', pid: 4242, title: 'owned.project* - CODESYS ', usable: true }], '0xE', { ownedPids: [4242] }));
assert.strictEqual(ownedOnly.found, true, 'the plugin-owned instance must still resolve');
assert.strictEqual(ownedOnly.sourcePath, path.resolve(mixed.files.owned));
assert.strictEqual(ownedOnly.detection, 'monitored-window+project-lock');
assert.deepStrictEqual(ownedOnly.scope, { pluginOwnedPids: [4242], ownedWindows: 1, openProjects: 1 }, 'the foreign lock must be filtered out of the scope');
// Same data without the ownership scope: both projects are visible (the option is
// opt-in, so the plain resolution stays unchanged).
const unscoped = withScope(mixed, () => discoverCurrentCodesysProject([], '', {}));
assert.strictEqual(unscoped.scope, undefined, 'an unscoped call must not invent a scope');
assert.strictEqual(unscoped.openProjects.length, 2, 'without a scope both markers are reported');

// Only a foreign project is open: nothing may be bound and nothing offered.
const foreignOnlyScope = makeScope('foreign-only', [{ name: 'foreign', pid: 9999 }]);
const foreignOnly = withScope(foreignOnlyScope, () => discoverCurrentCodesysProject([], '', { ownedPids: [4242] }));
assert.strictEqual(foreignOnly.found, false, 'a project opened outside TaskHive must not be auto-bound');
assert.strictEqual(foreignOnly.detection, 'no-project-window');
assert.deepStrictEqual(foreignOnly.openProjects, [], 'a foreign instance must never be offered');
assert.strictEqual(foreignOnly.scope.openProjects, 0);

// ── The monitored window is the ONLY window ─────────────────────────────────
// The panel's window selector defines "当前监视窗口". A project living in a
// DIFFERENT window the plugin also owns must never be bound silently — the user
// asked for exactly this: "工作台的逻辑应该只检测当前 codesys 监视窗口".
// Monitored window (pid 4242) is owned but has no project; the other owned
// window (pid 4343) has one.
const idleMonitored = makeScope('idle-monitored', [{ name: 'second', pid: 4343 }]);
const monitoredWithoutProject = withScope(idleMonitored, () => discoverCurrentCodesysProject(
  [{ id: '0xF', pid: 4242, title: 'CODESYS ', usable: true }, { id: '0x10', pid: 4343, title: 'second.project* - CODESYS ', usable: true }],
  '0xF',
  { ownedPids: [4242, 4343] },
));
assert.strictEqual(monitoredWithoutProject.found, false, 'another owned window must not be substituted');
assert.strictEqual(monitoredWithoutProject.detection, 'monitored-window-no-project');
assert.strictEqual(monitoredWithoutProject.monitoredPid, 4242);
assert.deepStrictEqual(monitoredWithoutProject.candidates.map((item) => item.windowId), ['0x10'], 'the other window is only offered as an explicit candidate');
assert.deepStrictEqual(monitoredWithoutProject.openProjects.map((entry) => entry.name), ['second.project'], 'the other project is only offered explicitly');
// Both windows hold a project: the monitored one decides.
const bothOpen = makeScope('both-open', [{ name: 'first', pid: 4242 }, { name: 'second', pid: 4343 }]);
const monitoredWithProject = withScope(bothOpen, () => discoverCurrentCodesysProject(
  [{ id: '0xF', pid: 4242, title: 'first.project* - CODESYS ', usable: true }, { id: '0x10', pid: 4343, title: 'second.project* - CODESYS ', usable: true }],
  '0xF',
  { ownedPids: [4242, 4343] },
));
assert.strictEqual(monitoredWithProject.found, true);
assert.strictEqual(monitoredWithProject.sourcePath, path.resolve(bothOpen.files.first), 'the monitored window decides which project is bound');
// A monitored window that no longer exists is its own reason.
const monitoredClosed = withScope(bothOpen, () => discoverCurrentCodesysProject(
  [{ id: '0x10', pid: 4343, title: 'second.project* - CODESYS ', usable: true }],
  '0xF',
  { ownedPids: [4242, 4343] },
));
assert.strictEqual(monitoredClosed.found, false);
assert.strictEqual(monitoredClosed.detection, 'monitored-window-closed');
assert.strictEqual(monitoredClosed.monitoredWindowId, '0xF');

fs.rmSync(tempRoot, { recursive: true, force: true });
process.stdout.write('codesys current project tests passed\n');
