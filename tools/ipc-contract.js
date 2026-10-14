'use strict';

// 维护性重构（T155）的安全网：把"主进程注册的 IPC 通道"与"preload 暴露的通道"各自抽出来比对比。
//
// 为什么需要它：`registerIpc()` 是 1000+ 行的单函数、内含 97 个处理器。拆分它本身是**纯机械**
// 操作，但很容易在搬运过程中漏掉一个处理器、或把 `onTrusted` 改成 `handleTrusted`、或改错通道名。
// 这个契约让"拆前/拆后"的集合可逐字比较，并且能发现"preload 暴露了但主进程没注册"的孤儿通道。
//
// 用法：
//   node tools/ipc-contract.js            # 打印/比较（--check 需要基线文件）
//   node tools/ipc-contract.js --write    # 写出基线 tools/ipc-contract-baseline.json
//   node tools/ipc-contract.js --check    # 与基线比较，不一致则非零退出

const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const mainPath = path.join(appRoot, 'app', 'main.js');
const preloadPath = path.join(appRoot, 'app', 'preload.js');
const baselinePath = path.join(__dirname, 'ipc-contract-baseline.json');

// 括号配平扫描：从 `handleTrusted(` / `onTrusted(` 的 `(` 开始找到它的 `)`。
// 直接按行/正则抓通道名会漏掉多行处理器，也容易把字符串里的括号算错。
function extractRegistrations(source) {
  const results = [];
  const opener = /(handleTrusted|onTrusted)\(/g;
  let match;
  while ((match = opener.exec(source))) {
    const kind = match[1];
    // 排除**函数定义**：`function handleTrusted(channel, handler, options) {` 也匹配
    // `(handleTrusted)\(`。不排除的话扫描器会把整个函数体当成一次注册，一次吞掉几十个真注册
    //（本机实测：把 98 个注册压成 49 个）。
    const lookbehind = source.slice(Math.max(0, match.index - 12), match.index);
    if (/function\s+$/.test(lookbehind)) continue;
    let depth = 1;
    let index = opener.lastIndex;
    let inString = '';
    let escaped = false;
    for (; index < source.length && depth > 0; index += 1) {
      const char = source[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (inString) { if (char === inString) inString = ''; continue; }
      if (char === '"' || char === "'" || char === '`') { inString = char; continue; }
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
    }
    const call = source.slice(match.index, index);
    const line = source.slice(0, match.index).split('\n').length;
    const channel = (call.match(/\(\s*(['"`])([^'"`]+)\1/) || [])[2] || '';
    const suffix = (call.match(/\}\s*,\s*(\{[^}]*\})\s*\)\s*$/) || [])[1] || '';
    results.push({ kind, channel, line, suffix });
  }
  return results;
}

function extractPreloadChannels(source) {
  const invokes = new Set();
  const sends = new Set();
  for (const match of source.matchAll(/ipcRenderer\.invoke\(\s*(['"`])([^'"`]+)\1/g)) invokes.add(match[2]);
  for (const match of source.matchAll(/ipcRenderer\.send\(\s*(['"`])([^'"`]+)\1/g)) sends.add(match[2]);
  return { invokes, sends };
}

function snapshot() {
  const main = fs.readFileSync(mainPath, 'utf8');
  const preload = fs.readFileSync(preloadPath, 'utf8');
  const registrations = extractRegistrations(main);
  const { invokes, sends } = extractPreloadChannels(preload);
  // T155：拆出域函数后，`registerIpc()` 里若**重复调用**同一个域函数，该域的所有处理器会被
  // Electron 注册两次并抛 "Attempted to register a second handler for X"（本轮真实踩过）。
  // 静态扫描 body 里的 `registerXxxIpc();`，重复即视为缺陷。
  const coordinatorBody = main.slice(
    main.indexOf('function registerIpc() {'),
    main.indexOf('\nfunction ', main.indexOf('function registerIpc() {') + 10) > 0
      ? main.indexOf('\nfunction ', main.indexOf('function registerIpc() {') + 10)
      : main.length
  );
  const coordinatorCalls = [...coordinatorBody.matchAll(/^\s*(register\w+Ipc)\(\);/gm)].map((m) => m[1]);
  const duplicateCoordinatorCalls = [...new Set(coordinatorCalls.filter((name, i) => coordinatorCalls.indexOf(name) !== i))];
  const registered = registrations.map((item) => item.channel).filter(Boolean);
  const handleChannels = registrations.filter((item) => item.kind === 'handleTrusted').map((item) => item.channel);
  const onChannels = registrations.filter((item) => item.kind === 'onTrusted').map((item) => item.channel);
  return {
    counts: {
      registrations: registrations.length,
      handleTrusted: handleChannels.length,
      onTrusted: onChannels.length,
      preloadInvoke: invokes.size,
      preloadSend: sends.size,
    },
    channels: [...registered].sort(),
    order: registered,
    handleOnly: [...handleChannels].sort(),
    onOnly: [...onChannels].sort(),
    preloadInvokes: [...invokes].sort(),
    preloadSends: [...sends].sort(),
    // preload 暴露但主进程没注册（真孤儿）；主进程注册但 preload 没暴露（可能只有内部调用方）。
    invokeWithoutHandler: [...invokes].filter((name) => !handleChannels.includes(name)).sort(),
    handlerWithoutInvoke: [...handleChannels].filter((name) => !invokes.has(name)).sort(),
    sendWithoutHandler: [...sends].filter((name) => !onChannels.includes(name)).sort(),
    coordinatorCalls,
    duplicateCoordinatorCalls,
  };
}

function main() {
  const outcome = snapshot();
  const mode = process.argv.includes('--write') ? 'write' : (process.argv.includes('--check') ? 'check' : 'show');
  if (mode === 'write') {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
    console.log(`ipc-contract: 基线已写入（${outcome.counts.registrations} 个注册 / ${outcome.channels.length} 个通道）`);
    return 0;
  }
  if (mode === 'check') {
    let baseline;
    try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); }
    catch { console.error('ipc-contract: 缺少基线，请先 --write'); return 2; }
    const problems = [];
    if (outcome.duplicateCoordinatorCalls.length) {
      problems.push(`registerIpc() 重复调用域函数（会导致重复注册）：${outcome.duplicateCoordinatorCalls.join(', ')}`);
    }
    const missing = baseline.channels.filter((name) => !outcome.channels.includes(name));
    const added = outcome.channels.filter((name) => !baseline.channels.includes(name));
    if (missing.length) problems.push(`丢失通道（${missing.length}）：${missing.join(', ')}`);
    if (added.length) problems.push(`新增通道（${added.length}）：${added.join(', ')}`);
    for (const key of ['handleOnly', 'onOnly']) {
      const lost = baseline[key].filter((name) => !outcome[key].includes(name));
      const gained = outcome[key].filter((name) => !baseline[key].includes(name));
      if (lost.length) problems.push(`${key} 减少：${lost.join(', ')}`);
      if (gained.length) problems.push(`${key} 增加：${gained.join(', ')}`);
    }
    if (baseline.order.length === outcome.order.length && baseline.order.join('|') === outcome.order.join('|')) {
      console.log('ipc-contract: 通道集合与**注册顺序**均与基线一致');
    } else if (!problems.length) {
      console.log('ipc-contract: 通道集合一致（顺序有变化）');
    }
    if (problems.length) {
      for (const line of problems) console.error(`  ✗ ${line}`);
      return 1;
    }
    return 0;
  }
  console.log(JSON.stringify(outcome, null, 2));
  return 0;
}

module.exports = { extractRegistrations, extractPreloadChannels, snapshot };

if (require.main === module) process.exit(main());
