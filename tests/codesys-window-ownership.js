'use strict';

const assert = require('assert');
const { CodesysWindowOwnership } = require('../app/codesys-window-ownership');

const external = { id: '0x100', pid: 9100, title: 'manual.project - CODESYS', width: 1723, height: 1035, usable: true };
const splash = { id: '0x200', pid: 9200, title: 'CODESYS', width: 648, height: 485, usable: true };
const ide = { id: '0x201', pid: 9200, title: 'plugin.project - CODESYS', width: 1723, height: 1035, usable: true };
const dialog = { id: '0x202', pid: 9200, title: 'Library Manager', width: 1100, height: 800, usable: true };
const laterManual = { id: '0x203', pid: 9200, title: 'later-manual.project - CODESYS', width: 2200, height: 1300, usable: true };
const fixture = { id: '0x300', pid: 9300, title: 'CODESYS TaskHive Media Fixture A', width: 960, height: 540, usable: true, fixture: true };

let now = 100000;
const ownership = new CodesysWindowOwnership({ now: () => now, discoveryWindowMs: 60000, settleWindowMs: 8000 });
const registration = ownership.registerPid(9200, { profile: 'CODESYS V3.5 SP20 Patch 4', baselineWindowIds: [external.id] });
assert.strictEqual(registration.state, 'discovering');
assert.deepStrictEqual(ownership.filterWindows([external, splash]).map((item) => item.id), [splash.id]);

now += 1000;
const transition = ownership.filterWindows([external, splash, ide, dialog]);
assert.deepStrictEqual(transition.map((item) => item.id), [splash.id, ide.id]);
assert(transition.every((item) => item.pluginOwned === true && item.ownership === 'taskhive-plugin-launch-hwnd'));
assert.strictEqual(transition.find((item) => item.id === splash.id).windowPhase, 'launch');
assert.strictEqual(transition.find((item) => item.id === ide.id).windowPhase, 'main');
assert.strictEqual(ownership.primaryWindow(transition, 9200, splash.id).id, ide.id);
assert.strictEqual(ownership.ownsWindow(dialog), false);

now += 9000;
ownership.filterWindows([external, ide, dialog]);
assert.strictEqual(ownership.snapshot().registrations[0].state, 'frozen');
assert.deepStrictEqual(ownership.filterWindows([external, ide, dialog, laterManual]).map((item) => item.id), [ide.id]);
assert.strictEqual(ownership.ownsWindow(laterManual), false);
assert.throws(() => ownership.assertWindow(external), (error) => error.code === 'CODESYS_WINDOW_NOT_PLUGIN_OWNED');
assert.throws(() => ownership.assertWindow(laterManual), (error) => error.code === 'CODESYS_WINDOW_NOT_PLUGIN_OWNED');
assert.throws(() => ownership.registerPid(0), (error) => error.code === 'CODESYS_LAUNCH_PID_INVALID');

let replacementNow = 200000;
const replacementOwnership = new CodesysWindowOwnership({ now: () => replacementNow, discoveryWindowMs: 60000 });
replacementOwnership.registerPid(9400);
const shortSplash = { ...splash, id: '0x400', pid: 9400 };
const equalSizeMain = { ...splash, id: '0x401', pid: 9400, title: 'new.project - CODESYS' };
assert.deepStrictEqual(replacementOwnership.filterWindows([shortSplash]).map((item) => item.id), [shortSplash.id]);
replacementNow += 1000;
assert.deepStrictEqual(replacementOwnership.filterWindows([]), []);
replacementNow += 1000;
assert.deepStrictEqual(replacementOwnership.filterWindows([equalSizeMain]).map((item) => item.id), [equalSizeMain.id]);
assert.strictEqual(replacementOwnership.ownsWindow(shortSplash), false);

const reusedPidOwnership = new CodesysWindowOwnership({ now: () => 300000 });
reusedPidOwnership.registerPid(9500, { baselineWindowIds: ['0x500'] });
const preExistingSamePid = { ...ide, id: '0x500', pid: 9500 };
const launchedSamePid = { ...ide, id: '0x501', pid: 9500 };
assert.deepStrictEqual(reusedPidOwnership.filterWindows([preExistingSamePid, launchedSamePid]).map((item) => item.id), [launchedSamePid.id]);
assert.strictEqual(reusedPidOwnership.ownsWindow(preExistingSamePid), false);

let slowNow = 400000;
const slowOwnership = new CodesysWindowOwnership({ now: () => slowNow });
slowOwnership.registerPid(9600);
const slowSplash = { ...splash, id: '0x600', pid: 9600 };
const slowMain = { ...ide, id: '0x601', pid: 9600 };
assert.deepStrictEqual(slowOwnership.filterWindows([slowSplash]).map((item) => item.id), [slowSplash.id]);
slowNow += 7 * 60 * 1000;
assert.deepStrictEqual(slowOwnership.filterWindows([slowMain]).map((item) => item.id), [slowMain.id]);
assert.strictEqual(slowOwnership.filterWindows([slowMain])[0].windowPhase, 'main');

let promotedNow = 900000;
const promotedOwnership = new CodesysWindowOwnership({ now: () => promotedNow });
promotedOwnership.registerPid(9700);
const reusedSplashHwnd = { ...splash, id: '0x700', pid: 9700 };
assert.strictEqual(promotedOwnership.filterWindows([reusedSplashHwnd])[0].windowPhase, 'launch');
promotedNow += 3000;
const resizedSameHwnd = { ...reusedSplashHwnd, width: 1700, height: 1000 };
assert.strictEqual(promotedOwnership.filterWindows([resizedSameHwnd])[0].windowPhase, 'main');

const testOwnership = new CodesysWindowOwnership({ allowFixtures: true });
assert.deepStrictEqual(testOwnership.filterWindows([external, fixture]).map((item) => item.id), [fixture.id]);
assert.strictEqual(testOwnership.assertWindow(fixture).ownership, 'isolated-smoke-fixture');

process.stdout.write('codesys HWND ownership contract tests passed\n');
