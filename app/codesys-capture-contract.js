'use strict';

function windowHandleValue(windowId) {
  const text = String(windowId || '').trim();
  return /^0x/i.test(text) ? Number.parseInt(text.slice(2), 16) : Number(text);
}

function desktopSourceId(windowId) {
  return `window:${windowHandleValue(windowId)}:0`;
}

function bitmapLooksBlack(bitmap, threshold = {}) {
  if (!bitmap || bitmap.length < 4) return true;
  const channelLimit = Number(threshold.channelLimit ?? 8);
  const ratioLimit = Number(threshold.ratioLimit ?? 0.98);
  const pixelCount = Math.floor(bitmap.length / 4);
  const step = Math.max(1, Math.floor(pixelCount / 256));
  let sampled = 0;
  let nearBlack = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    sampled += 1;
    if ((bitmap[offset] || 0) <= channelLimit && (bitmap[offset + 1] || 0) <= channelLimit && (bitmap[offset + 2] || 0) <= channelLimit) nearBlack += 1;
  }
  return sampled > 0 && nearBlack / sampled >= ratioLimit;
}

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

module.exports = { bitmapLooksBlack, desktopSourceId, pngDimensions, windowHandleValue };
