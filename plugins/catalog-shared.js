'use strict';

// T155：`plugins/manager.js` 与 `repositories/manager.js` 的**共享实现**。
//
// 两个 manager 原先各自复制了一份 `safeId`、各自一套 JSON 持久化、各自一套"搬进 backups
// 但永不清理"的备份逻辑（实测三处 `path.join(this.backups, ...)` 只有列举没有删除）。
// 这里抽出四件真正共享的事，其余（各自的状态机/清单校验）保留在各自文件里。
//
// 注意 `require('../app/atomic-json')`：本文件位于 `resources/app/plugins/`。

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../app/atomic-json');

// 与两个 manager 原先的实现逐字一致（lower-case、非白名单字符转 '-'、去掉首尾 '-'、截断 80）。
function safeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// 统一走 atomic-json：带 `.bak` 代际、写失败不破坏原文件、解析损坏时隔离为 `.corrupt-<ts>`。
// 旧实现（plugins/manager.js）用**固定名** `${catalogPath}.tmp` + rename：并发/崩溃会互相覆盖
// 临时文件；repositories/manager.js 更是裸 `writeFileSync` 覆盖。
function readJsonFile(file, fallback, label) {
  return readJson(file, fallback, { label });
}

function writeJsonFile(file, value) {
  writeJson(file, value);
}

// 备份保留策略：每个 id 只保留最近 `keep` 份 `${id}-<ts>`。
// 原先 install/restore/uninstall 都把整个目录 rename 进 backups，**没有任何删除路径** ——
// 一次插件覆盖安装就是几十到上百 MB，且永久累积。
function pruneBackups(backupsDir, keep = 2) {
  try {
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(backupsDir, entry.name);
        let at = 0;
        try { at = fs.statSync(full).mtimeMs; } catch { /* skip */ }
        return { name: entry.name, full, at };
      });
    const byId = new Map();
    for (const entry of entries) {
      const id = entry.name.replace(/-\d+(-displaced)?$/, '');
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(entry);
    }
    for (const list of byId.values()) {
      list.sort((left, right) => right.at - left.at);
      for (const entry of list.slice(keep)) {
        try { fs.rmSync(entry.full, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    }
  } catch { /* best effort: 备份清理失败不能影响主流程 */ }
}

// 把 target 移入备份目录（原名或 `${name}-<ts>`），返回备份路径（target 不存在时返回 ''）。
function moveToBackup(target, backupsDir, name, options = {}) {
  if (!fs.existsSync(target)) return '';
  const suffix = options.displaced ? '-displaced' : '';
  const backup = path.join(backupsDir, `${name}-${Date.now()}${suffix}`);
  fs.renameSync(target, backup);
  pruneBackups(backupsDir, Number.isInteger(options.keep) ? options.keep : 2);
  return backup;
}

module.exports = { safeId, readJsonFile, writeJsonFile, pruneBackups, moveToBackup };
