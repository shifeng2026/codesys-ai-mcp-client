const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_BACKUPS = 2;

// T153：已确认存在的目录不再重复 `mkdirSync`。这个函数在 `console-message`、
// CODESYS 输入审计、DSH 子进程 stdout 等**高频路径**上被调用，而目录在首次写入后
// 就不再变化 —— 每次调用多做一次系统调用是纯浪费。
const knownDirs = new Set();

function appendDiagnosticLog(file, line, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? Math.floor(options.maxBytes)
    : DEFAULT_MAX_BYTES;
  const backups = Number.isInteger(options.backups) && options.backups >= 0
    ? options.backups
    : DEFAULT_BACKUPS;
  const value = String(line ?? '');
  if (!value) return;

  try {
    const dir = path.dirname(file);
    if (!knownDirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      knownDirs.add(dir);
    }
    let currentBytes = 0;
    try { currentBytes = fs.statSync(file).size; } catch { /* first write */ }
    if (currentBytes + Buffer.byteLength(value, 'utf8') > maxBytes && currentBytes > 0) {
      for (let index = backups; index >= 1; index -= 1) {
        const source = index === 1 ? file : `${file}.${index - 1}`;
        const target = `${file}.${index}`;
        try { fs.rmSync(target, { force: true }); } catch { /* best effort */ }
        try { fs.renameSync(source, target); } catch { /* missing backup */ }
      }
    }
    fs.appendFileSync(file, value, 'utf8');
  } catch (error) {
    // T151：**可观测性写入绝不能成为单点故障**。旧实现让这里抛错，而调用点
    // (`main.js` 的 `console-message` 回调等) 没有 try/catch，未捕获异常会走
    // uncaughtException → reportFatal → `app.exit(1)`：磁盘满/日志被锁时，
    // 一条渲染层 console error 就能把整个客户端带崩。这里退化为 stderr。
    try { process.stderr.write(`[diagnostic-log] ${file}: ${(error && error.message) || error}\n`); } catch { /* 彻底放弃 */ }
  }
}

module.exports = { appendDiagnosticLog, DEFAULT_MAX_BYTES, DEFAULT_BACKUPS };
