const assert = require('assert');
const path = require('path');
const { buildCodesysGuiLaunch, launchCodesysGui } = require('../app/codesys-launch');

const exePath = 'C:\\Program Files\\CODESYS 3.5.20.40\\CODESYS\\Common\\CODESYS.exe';
const launch = buildCodesysGuiLaunch({ exePath, profile: 'CODESYS V3.5 SP20 Patch 4' }, { platform: 'win32' });

assert.strictEqual(launch.exePath, path.resolve(exePath));
assert.deepStrictEqual(launch.args, ['--profile="CODESYS V3.5 SP20 Patch 4"', '--culture="zh-CN"']);
assert.strictEqual(launch.options.cwd, path.dirname(path.resolve(exePath)));
assert.strictEqual(launch.options.detached, true);
assert.strictEqual(launch.options.windowsHide, false);
assert.strictEqual(launch.options.windowsVerbatimArguments, true);
assert.strictEqual(launch.options.stdio, 'ignore');
assert.throws(() => buildCodesysGuiLaunch({ exePath, profile: '' }, { platform: 'win32' }), /缺少 CODESYS profile/);
assert.throws(() => buildCodesysGuiLaunch({ exePath, profile: 'bad"profile' }, { platform: 'win32' }), /无效字符/);

let spawnCall = null;
let unrefCalled = false;
const started = launchCodesysGui({ exePath, profile: launch.profile }, {
  platform: 'win32',
  spawnProcess(executable, args, options) {
    spawnCall = { executable, args, options };
    return { pid: 43210, unref() { unrefCalled = true; } };
  },
});
assert.strictEqual(started.pid, 43210);
assert.strictEqual(unrefCalled, true);
assert.strictEqual(spawnCall.executable, launch.exePath);
assert.deepStrictEqual(spawnCall.args, launch.args);
assert.deepStrictEqual(spawnCall.options, launch.options);

console.log(JSON.stringify({ ok: true, profile: launch.profile, culture: launch.culture, args: launch.args, cwd: launch.options.cwd, spawnInjected: true, unrefCalled }));
