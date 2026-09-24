'use strict';

const assert = require('assert');
const { bitmapLooksBlack, desktopSourceId, pngDimensions, windowHandleValue } = require('../app/codesys-capture-contract');

assert.strictEqual(windowHandleValue('0x714AC'), 0x714AC);
assert.strictEqual(windowHandleValue('463214'), 463214);
assert.strictEqual(desktopSourceId('0x714AC'), `window:${0x714AC}:0`);

const black = Buffer.alloc(400 * 4, 0);
assert.strictEqual(bitmapLooksBlack(black), true);

const codesysLike = Buffer.alloc(400 * 4, 0);
for (let pixel = 0; pixel < 80; pixel += 1) {
  const offset = pixel * 4;
  codesysLike[offset] = 238;
  codesysLike[offset + 1] = 238;
  codesysLike[offset + 2] = 238;
  codesysLike[offset + 3] = 255;
}
assert.strictEqual(bitmapLooksBlack(codesysLike), false);

const png = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
png.write('IHDR', 12, 'ascii');
png.writeUInt32BE(1920, 16);
png.writeUInt32BE(1080, 20);
assert.deepStrictEqual(pngDimensions(png), { width: 1920, height: 1080 });
assert.strictEqual(pngDimensions(Buffer.from('not-a-png')), null);

process.stdout.write('codesys capture contract tests passed\n');
