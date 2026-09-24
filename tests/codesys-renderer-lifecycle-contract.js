'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../app/renderer/renderer.js'), 'utf8');
const refreshStart = source.indexOf('async function refreshWindows(options = {})');
const refreshEnd = source.indexOf('\nasync function waitForLaunchedCodesysWindow', refreshStart);
const refreshSource = source.slice(refreshStart, refreshEnd);

assert(refreshStart >= 0 && refreshEnd > refreshStart);
assert(refreshSource.includes('if (!list) return null;'));
assert(refreshSource.includes('if (!list.isConnected) return null;'));
assert(refreshSource.includes("if (list.isConnected) list.innerHTML = '<option value=\"\">窗口枚举失败</option>'"));
console.log('codesys renderer lifecycle contract tests passed');
