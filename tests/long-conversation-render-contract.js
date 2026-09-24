'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js');
const source = fs.readFileSync(file, 'utf8');
assert(source.includes('[data-conversation-scroll] [data-chat-flow-key]'));
assert(source.includes('content-visibility:auto'));
assert(source.includes('contain:layout style paint'));
assert(source.includes('contain-intrinsic-size:auto 120px'));
console.log('long conversation render contract tests passed');
