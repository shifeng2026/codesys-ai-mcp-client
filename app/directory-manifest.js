const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const JSON_NAME = 'TaskHive目录清单.json';
const MARKDOWN_NAME = 'TaskHive目录清单.md';
const TEMP_NAME = /^TaskHive目录清单\..+\.tmp$/u;
// 高变更目录：profiles、logs、cache、workspaces 与 _qa_runtime_* 会被持续写入，
// 它们的事件不允许触发整树重扫，否则主线程会被反复冻结。
// T149：白名单漏掉了**应用自己的 userData**（打包后 = `<install>\user-data`）。
// Chromium/DSH 持续在写 `user-data\Network\Cookies`、`GPUCache\data_1`、
// `Local Storage\leveldb\*.log`、`Partitions\*\IndexedDB\*`、`runtime\**` 等；
// 本机实测活跃会话下整树重扫 = 9420 目录 / 41977 文件 / 2219 ms + 233 MB exe 重哈希，
// 会近乎背靠背常驻并与 DSH 冷启动争用同一块磁盘。
const VOLATILE_PATH = /(?:^|\/)(?:profiles|logs|cache|workspaces|user-data|plugin-data|sessions|storages|_qa_runtime_[^/]*)(?:\/|$)/i;

const executableHashCache = new Map();

const PURPOSES = Object.freeze({
  'TaskHive.exe': '程序启动入口',
  resources: 'TaskHive 应用、Harness、插件和运行依赖',
  locales: 'Electron 界面语言资源',
  'release-manifest.json': '正式客户端版本、哈希和可复制状态',
  [JSON_NAME]: '机器可读目录清单',
  [MARKDOWN_NAME]: '用户可读目录清单',
  'update-directory-manifest.cmd': '手动刷新目录清单',
});

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex').toUpperCase();
}

// TaskHive.exe 约 225 MB，逐次刷新都同步重算哈希会冻结界面。
// 只在（路径、大小、修改时间）任一变化时重算；每次显式执行
// --update-directory-manifest 都是全新进程，缓存为空，输出依旧完整。
function cachedFileHash(file) {
  let stats;
  try { stats = fs.statSync(file); } catch { return null; }
  const identity = `${stats.size}:${stats.mtimeMs}`;
  const cached = executableHashCache.get(file);
  if (cached && cached.identity === identity) return cached.sha256;
  let sha256;
  try { sha256 = hashFile(file); } catch { return null; }
  executableHashCache.set(file, { identity, sha256 });
  return sha256;
}

// 目录项是否为重解析点（Windows junction、符号链接）。某些 Windows 环境下
// lstat 不把 junction 标记为链接，此时跟随一次符号链接确认目标类型。
function describeEntry(entry, absolute) {
  let stats = null;
  try { stats = fs.lstatSync(absolute); } catch { /* 条目可能在扫描期间消失 */ }
  let link = entry.isSymbolicLink() || Boolean(stats && stats.isSymbolicLink());
  if (!link && stats && !stats.isDirectory() && !entry.isFile()) {
    try { link = fs.statSync(absolute).isDirectory(); } catch { link = false; }
  }
  return { link, size: stats ? stats.size : 0 };
}

// 顶层项目自身类型：优先使用目录项信息，链接按目标类型归类，条目消失时回退。
function entryType(entry, absolute, fallback) {
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  try { return fs.statSync(absolute).isDirectory() ? 'directory' : 'file'; } catch { return fallback || 'unknown'; }
}

function scan(root) {
  const directories = [];
  const components = new Map();
  let fileCount = 0;
  let linkCount = 0;
  let totalBytes = 0;
  const stack = [{ directory: root, relative: '' }];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (TEMP_NAME.test(entry.name)) continue;
      const relative = path.join(current.relative, entry.name);
      const absolute = path.join(current.directory, entry.name);
      const top = relative.split(path.sep)[0];
      if (!components.has(top)) components.set(top, { name: top, type: 'unknown', files: 0, directories: 0, links: 0, bytes: 0 });
      const component = components.get(top);
      if (!current.relative) component.type = entryType(entry, absolute, component.type);
      const described = describeEntry(entry, absolute);
      if (described.link) {
        // 目录联接/符号链接单独统计：既不算文件也不算文件夹，且不递归进入。
        linkCount += 1;
        component.links += 1;
      } else if (entry.isDirectory()) {
        directories.push(relative.replaceAll('\\', '/'));
        component.directories += 1;
        stack.push({ directory: absolute, relative });
      } else {
        fileCount += 1;
        totalBytes += described.size;
        component.files += 1;
        component.bytes += described.size;
      }
    }
  }
  return { directories: directories.sort(), components: [...components.values()], fileCount, linkCount, totalBytes };
}

// 顶层项目类型：扫描后条目可能已消失，此时回退到扫描期间记录的目录项类型。
function resolveEntryType(root, component) {
  try {
    return fs.statSync(path.join(root, component.name)).isDirectory() ? 'directory' : 'file';
  } catch {
    return component.type || 'unknown';
  }
}

// 事件路径当前是否为已存在的目录；条目已消失时按“非目录”处理（删除仍需刷新）。
function isExistingDirectory(absolute) {
  try { return fs.statSync(absolute).isDirectory(); } catch { return false; }
}

function generateDirectoryManifest(programRoot, options = {}) {
  const root = path.resolve(programRoot);
  const state = scan(root);
  const executable = path.join(root, 'TaskHive.exe');
  const generatedAt = new Date().toISOString();
  const components = state.components
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .map((component) => ({
      name: component.name,
      type: resolveEntryType(root, component),
      relativePath: component.name,
      purpose: PURPOSES[component.name] || 'Electron 程序运行文件',
      required: true,
      fileCount: component.files,
      directoryCount: component.directories,
      linkCount: component.links,
      bytes: component.bytes,
    }));
  let executableInfo = null;
  try {
    const executableStats = fs.statSync(executable);
    if (executableStats.isFile()) {
      // T159：**复用上一次的哈希**。`TaskHive.exe` 实测 244 MB，重算一次要读满整份文件；
      // 而刷新是每 11–122 秒发生一次（worker 每次都是新线程、模块级缓存是冷的），
      // 于是空闲时每天产生 200–500 GB 读放大。这里按（大小 + mtime）判定身份：
      // 调用方（主线程刷新路径）会把上一次清单里的 executable 身份传进来，命中即不读文件。
      const seeded = options.executable;
      const reusable = seeded && Number(seeded.length) === executableStats.size
        && Number(seeded.mtimeMs) === executableStats.mtimeMs && typeof seeded.sha256 === 'string' && seeded.sha256;
      const sha256 = reusable ? seeded.sha256 : cachedFileHash(executable);
      executableInfo = {
        relativePath: 'TaskHive.exe',
        length: executableStats.size,
        mtimeMs: executableStats.mtimeMs,
        sha256,
      };
    }
  } catch { executableInfo = null; }
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    root,
    executable: executableInfo,
    totals: {
      files: state.fileCount,
      directories: state.directories.length,
      links: state.linkCount,
      reparsePoints: state.linkCount,
      bytes: state.totalBytes,
    },
    components,
    directories: state.directories,
    synchronization: {
      automatic: true,
      mode: '启动时刷新；运行期间监控程序文件变化以及文件和目录的新增、删除及重命名',
      manualCommand: 'update-directory-manifest.cmd',
    },
  };
  const jsonPath = path.join(root, JSON_NAME);
  const markdownPath = path.join(root, MARKDOWN_NAME);
  const jsonTemp = `${jsonPath}.${process.pid}.tmp`;
  const markdownTemp = `${markdownPath}.${process.pid}.tmp`;
  // T159：清单每轮刷新都会重写，而这份 JSON 实测约 1.18 MB（美化缩进）。
  // 两处优化：① 紧凑输出（人读的形态在 .md 里，JSON 是给机器读的）；
  // ② **内容未变就跳过写盘** —— 避免"只为改一个 generatedAt 而重写 1 MB"。
  const compactJson = `${JSON.stringify(manifest)}\n`;
  // 比对时必须归一化三处**每轮都在变**的部分，否则"内容未变就跳过"永远不成立：
  //   ① generatedAt（时间戳）；
  //   ② 清单**自身**那两个条目的 bytes —— 本次写入会改变它们的大小（实测自引用 churn：
  //      首轮 0.8 KB → 次轮 1.2 KB 就是它引起的）；
  //   ③ totals.bytes（包含上面两个文件）。
  const stableOf = (value) => {
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.generatedAt;
    if (copy.totals) delete copy.totals.bytes;
    for (const component of copy.components || []) {
      if (component.relativePath === JSON_NAME || component.relativePath === MARKDOWN_NAME) delete component.bytes;
    }
    return JSON.stringify(copy);
  };
  let previousStable = '';
  try { previousStable = stableOf(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))); } catch { /* 首次生成 */ }
  if (previousStable !== stableOf(manifest)) {
    fs.writeFileSync(jsonTemp, compactJson, 'utf8');
    fs.renameSync(jsonTemp, jsonPath);
  } else {
    try { fs.rmSync(jsonTemp, { force: true }); } catch { /* 可能不存在 */ }
  }
  const rows = components.map((component) => {
    const mb = (component.bytes / 1024 / 1024).toFixed(2);
    return `| \`${component.relativePath}\` | ${component.type} | ${component.fileCount} | ${component.linkCount} | ${mb} MB | ${component.purpose} |`;
  });
  const markdown = [
    '# TaskHive 目录清单',
    '',
    `> 自动生成时间：${generatedAt}`,
    '',
    `> 程序总目录：\`${root}\``,
    '',
    '本清单由 TaskHive 自动维护。程序启动时会刷新；运行期间新增、删除或重命名文件/文件夹后也会自动同步。',
    '',
    '| 根目录项目 | 类型 | 文件数 | 链接数 | 大小 | 用途 |',
    '|---|---:|---:|---:|---:|---|',
    ...rows,
    '',
    '## 汇总',
    '',
    `- 文件：${manifest.totals.files}`,
    `- 文件夹：${manifest.totals.directories}`,
    `- 总大小：${(manifest.totals.bytes / 1024 / 1024).toFixed(2)} MB`,
    `- 链接/联接点：${manifest.totals.reparsePoints}`,
    `- 合计（文件 + 文件夹 + 链接）：${manifest.totals.files + manifest.totals.directories + manifest.totals.reparsePoints}`,
    '',
    `完整子目录列表保存在同目录的 \`${JSON_NAME}\`。`,
    '',
  ].join('\n');
  fs.writeFileSync(markdownTemp, markdown, 'utf8');
  fs.renameSync(markdownTemp, markdownPath);
  return manifest;
}

// 整树扫描约十秒（真实安装约 14 万条目），同步执行会把 Electron 主线程冻结。
// 因此自动/定时刷新一律交给 worker 线程；只有显式
// `--update-directory-manifest` 仍使用同步实现，因为命令行必须在退出前写完。
function refreshDirectoryManifestAsync(programRoot) {
  let Worker = null;
  try { ({ Worker } = require('node:worker_threads')); } catch { Worker = null; }
  if (!Worker) {
    try { return Promise.resolve(generateDirectoryManifest(programRoot)); } catch (error) { return Promise.reject(error); }
  }
  return new Promise((resolve, reject) => {
    // T159：把上一次清单里的 exe 身份传给 worker，让它在（大小 + mtime）未变时**跳过 244 MB
    // 的重新哈希**。worker 每次刷新都是新线程（模块级缓存在它里面必然是冷的），所以这层复用
    // 必须由主线程读取上一次的清单来提供。
    let seededExecutable = null;
    try {
      const previous = JSON.parse(fs.readFileSync(path.join(root, JSON_NAME), 'utf8'));
      if (previous && previous.executable) seededExecutable = previous.executable;
    } catch { /* 首次生成或清单损坏：退化为完整扫描 */ }
    let worker;
    try {
      worker = new Worker(path.join(__dirname, 'directory-manifest-worker.js'), {
        workerData: { programRoot: path.resolve(programRoot), executable: seededExecutable },
      });
    } catch (error) {
      // A worker that cannot even be constructed must not break the inventory.
      try { resolve(generateDirectoryManifest(programRoot, { executable: seededExecutable })); } catch { reject(error); }
      return;
    }
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      callback(value);
    };
    worker.once('message', (message) => {
      if (message && message.ok) finish(resolve, message);
      else finish(reject, new Error((message && message.error) || 'directory manifest worker failed'));
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => { if (!settled && code !== 0) finish(reject, new Error(`directory manifest worker exited with code ${code}`)); });
  });
}

function startDirectoryManifestWatcher(programRoot) {
  const root = path.resolve(programRoot);
  let timer = null;
  let closed = false;
  let running = false;
  let pending = false;
  // T159：**最小刷新间隔**。实测空闲时重扫间隔只有 11–122 秒，而单次扫描要读 234 MiB +
  // 3.17 s CPU；清单内容绝大多数时候与上一次完全相同（逐字节只差 generatedAt）。
  // 60 秒冷却把"事件风暴"折成最多每分钟一次，配合写入端的"内容未变就不写盘"。
  const MIN_INTERVAL_MS = 60000;
  let lastRefreshAt = 0;
  const refresh = () => {
    if (closed) return;
    running = true;
    lastRefreshAt = Date.now();
    void refreshDirectoryManifestAsync(root)
      .catch(() => { /* best-effort inventory must not block TaskHive */ })
      .finally(() => {
        running = false;
        if (pending && !closed) {
          pending = false;
          schedule(1500);
        }
      });
  };
  function schedule(delay) {
    if (closed) return;
    if (running) { pending = true; return; }
    const since = Date.now() - lastRefreshAt;
    const wait = Math.max(delay, since < MIN_INTERVAL_MS ? MIN_INTERVAL_MS - since : 0);
    clearTimeout(timer);
    timer = setTimeout(refresh, wait);
  }
  schedule(2500);
  const watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
    const normalizedName = String(filename || '').replaceAll('\\', '/');
    if (normalizedName.includes('TaskHive目录清单')) return;
    if (VOLATILE_PATH.test(normalizedName)) return;
    // Windows 递归监控还会为深层写入额外上报祖先目录的 change 事件
    // （例如 profiles 下的写入会上报 resources），单看事件路径无法判定来源。
    // 目录自身的 mtime 变化不携带清单信息：新增、删除、重命名由子条目的
    // rename 事件上报，文件写入由文件自身的 change 事件上报。
    // T159：**rename 也必须按同样规则过滤** —— 只过滤 change 时，被 VOLATILE_PATH 排除的
    // user-data/** 深层写入仍会经祖先目录的 rename 上报绕过过滤，触发整树重扫。
    if ((eventType === 'change' || eventType === 'rename') && isExistingDirectory(path.join(root, normalizedName))) return;
    schedule(1500);
  });
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      watcher.close();
    },
  };
}

module.exports = {
  JSON_NAME,
  MARKDOWN_NAME,
  generateDirectoryManifest,
  refreshDirectoryManifestAsync,
  startDirectoryManifestWatcher,
};
