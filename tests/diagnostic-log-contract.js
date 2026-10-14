const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir } = require('./lib/temp-dir');
const { appendDiagnosticLog } = require('../app/diagnostic-log');

// T198：临时目录走共享出口（tests/lib/temp-dir.js）—— 成功时进程退出自动回收，失败时保留取证，
// 于是"建了目录但断言在第 12 行就炸了"也不会再漏一个 %TEMP% 目录。
const root = createTempDir('taskhive-diagnostic-log-');
const file = path.join(root, 'logs', 'renderer-console.log');
const line = 'x'.repeat(80);
for (let index = 0; index < 40; index += 1) appendDiagnosticLog(file, `${index}:${line}\n`, { maxBytes: 512, backups: 2 });

assert.ok(fs.existsSync(file));
assert.ok(fs.existsSync(`${file}.1`), 'rotation must preserve the previous generation');
assert.ok(fs.statSync(file).size <= 512 + Buffer.byteLength(`${39}:${line}\n`), 'active log stays bounded after rotation');
assert.ok(fs.statSync(`${file}.1`).size > 0, 'rotated log must contain diagnostics');
assert.ok(!fs.existsSync(`${file}.3`), 'rotation must keep the configured number of backups');
fs.rmSync(root, { recursive: true, force: true });
console.log('diagnostic log rotation contract passed');
