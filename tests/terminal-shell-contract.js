'use strict';

const assert = require('assert');
const path = require('path');
const { compareVersions, parseVersion, resolvePowerShell7, shellInvocation } = require('../app/terminal-shell');

assert.deepStrictEqual(parseVersion('7.6.5'), [7, 6, 5]);
assert.strictEqual(parseVersion('PowerShell 7.6.5'), null);
assert(compareVersions([7, 6, 5], [7, 5, 9]) > 0);

const env = {
  PATH: ['C:\\PowerShell-74', 'C:\\PowerShell-765'].join(path.delimiter),
  TASKHIVE_PWSH_BIN: 'C:\\PowerShell-73\\pwsh.exe',
};
const versions = new Map([
  [path.resolve('C:\\PowerShell-73\\pwsh.exe').toLowerCase(), '7.3.9'],
  [path.resolve('C:\\PowerShell-74\\pwsh.exe').toLowerCase(), '7.4.7'],
  [path.resolve('C:\\PowerShell-765\\pwsh.exe').toLowerCase(), '7.6.5'],
]);
const selected = resolvePowerShell7({
  platform: 'win32',
  env,
  exists: (candidate) => versions.has(path.resolve(candidate).toLowerCase()),
  run: (candidate) => ({ status: 0, stdout: versions.get(path.resolve(candidate).toLowerCase()) || '' }),
});
assert.strictEqual(selected.version, '7.6.5');
assert.strictEqual(selected.command.toLowerCase(), path.resolve('C:\\PowerShell-765\\pwsh.exe').toLowerCase());
assert.strictEqual(selected.edition, 'Core');
assert.strictEqual(selected.ready, true);

const invocation = shellInvocation(selected, "Write-Output 'ok'", 'win32');
assert.strictEqual(invocation.command, selected.command);
assert.deepStrictEqual(invocation.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
assert.strictEqual(invocation.args[4], "Write-Output 'ok'");
assert.strictEqual(invocation.windowsVerbatimArguments, false);

const fallback = resolvePowerShell7({ platform: 'win32', env: {}, exists: () => false, run: () => ({ status: 1, stdout: '' }) });
assert.deepStrictEqual(fallback, { command: 'powershell.exe', version: '5.1', edition: 'Desktop', ready: false });

console.log(`terminal shell contract passed (${selected.version})`);
