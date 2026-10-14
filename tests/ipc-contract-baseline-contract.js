'use strict';

// T159：**IPC 契约基线进了发行树，并且有了守护者**。
//
// 背景：`tools/ipc-contract.js` 是 T155 拆分 `registerIpc()` 时造的安全网，它抓出过
// "同一个域函数被调用两次 → Electron 抛 second handler → 应用起不来"。但它此前：
//   · 基线只存在于 `.repo-stage`，在发行树里 `--check` 直接 exit 2 跑不动；
//   · 全仓没有任何调用者（无 npm script、无测试、发布脚本也不跑它）。
// 于是这条最重要的不变式（INV-26）实际上零核对。这里直接调用模块（不 spawn 子进程，
// 本会话沙箱下 piped spawn 会 EPERM），把通道集合与基线逐字比对。
//
// 注意：**注册顺序**不再要求与基线一致 —— T155 把 98 个注册按域前缀分组搬进 12 个域函数，
// 源码顺序因此变成"按域聚合"，这是有意的；不变式只要求集合相同、且域函数各自只被调用一次。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const toolsDir = path.join(__dirname, '..', 'tools');
const baselinePath = path.join(toolsDir, 'ipc-contract-baseline.json');
assert(fs.existsSync(baselinePath), 'tools/ipc-contract-baseline.json 必须随发行包一起提供（否则 --check 在发行树跑不动）');

const { snapshot } = require(path.join(toolsDir, 'ipc-contract.js'));
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const current = snapshot();

// ── 1. 通道集合必须与基线完全一致（增删都要显式更新基线）─────────────────────
const missing = baseline.channels.filter((name) => !current.channels.includes(name));
const added = current.channels.filter((name) => !baseline.channels.includes(name));
assert.deepStrictEqual(missing, [], `有通道从主进程注册里消失了：${missing.join(', ')}（preload 会调用到不存在的方法）`);
assert.deepStrictEqual(added, [], `有通道未登记进基线：${added.join(', ')}（请在确认后运行 node tools/ipc-contract.js --write）`);

// ── 2. 每个域函数只能被调用一次 ───────────────────────────────────────────────
// 重复调用 = 该域全部处理器被注册两次 = Electron 直接抛 "Attempted to register a second
// handler"，**应用起不来**（T155 真实踩过）。
assert.deepStrictEqual(
  current.duplicateCoordinatorCalls,
  [],
  `registerIpc() 重复调用了域函数：${current.duplicateCoordinatorCalls.join(', ')}`,
);
assert.strictEqual(current.duplicateCoordinatorCalls.length, 0);

// ── 3. preload 不得暴露没有主进程处理器的通道（否则调用必然挂起/报错）─────────
assert.deepStrictEqual(current.invokeWithoutHandler, [], `preload 暴露了没有 handler 的通道：${current.invokeWithoutHandler.join(', ')}`);
assert.deepStrictEqual(current.sendWithoutHandler, [], `preload 发送了没有监听的通道：${current.sendWithoutHandler.join(', ')}`);

// ── 4. 规模哨兵：注册数不能悄悄缩水 ─────────────────────────────────────────
assert.strictEqual(
  current.counts.registrations,
  baseline.counts.registrations,
  `注册数从 ${baseline.counts.registrations} 变成了 ${current.counts.registrations}`,
);
// 用户的删除要求（2026-10）：删除 ModLens 与「AI 实时监视」后，注册数从 95 变成 88
// （codesys:fit-window / capture / stream-source / stream-start / stream-stop /
// visual-status / visual-analyze 七个通道随能力一起移除）。下限因此下移，但**下半句
// 才是真正的哨兵**：它必须与基线逐字相等 —— 上面那条 strictEqual 才是防缩水的地方，
// 这里只防御"数量级异常"（比如 registerIpc() 整体没跑）。
assert(current.counts.registrations >= 88, '注册数量级异常');

console.log(`ipc contract baseline passed (${current.counts.registrations} registrations / ${current.channels.length} channels)`);
