'use strict';

// T159（防住 T156 那类故障）：**插件包名三处必须一致**。
//
// 实际故障：插件的 `cordis.patch.yml` 写 `name: '@taskhive/surfaces'`，而它的
// `package.json.name` 与 profile bundles 条目都是 `taskhive-surfaces` —— DSH 解析不到
// 那个名字，`harness-runtime.log` 只写一行
//   `taskhive-surfaces (@taskhive/surfaces): failed to import`
// 客户端插件于是**整体不挂载**：左侧栏没有「知识库 / CODESYS」入口、皮肤与面板全丢。
// 症状与包名毫无表面关联，靠人眼审查很难发现，所以必须由契约钉死。
//
// 另外：随包发布的种子（patch / plugin-links）不得引用**不存在**的插件包 —— 陈旧种子
// 曾长期 insert 已删除的 `dsh-mnemon` / `dsh-better-sidebar`，让"审查证据"与实际相反。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = path.join(__dirname, '..');
const installed = path.join(app, 'plugins', 'installed');

const readIfExists = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

// ── 1. 每个带 cordis.patch.yml 的插件：insert 的 name 必须等于它自己的包名 ──────
const pluginDirs = fs.readdirSync(installed, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const checked = [];
for (const name of pluginDirs) {
  const dir = path.join(installed, name);
  const manifestText = readIfExists(path.join(dir, 'package.json'));
  if (!manifestText) continue;
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { continue; }
  const patchPath = manifest?.dsh?.bundle?.patch;
  if (!patchPath) continue;                       // 非 DSH 插件：不适用
  const patchFile = path.join(dir, String(patchPath).replace(/^\.\//, ''));
  const patch = readIfExists(patchFile);
  assert(patch, `${name}: dsh.bundle.patch 指向的文件不存在（${patchPath}）—— DSH 挂载时会直接失败`);
  const declared = [...patch.matchAll(/^\s*name:\s*'?([^'\n\r]+?)'?\s*$/gm)].map((match) => match[1].trim());
  assert(declared.length > 0, `${name}: cordis.patch.yml 里没有 insert 的 name`);
  for (const declaredName of declared) {
    assert.strictEqual(
      declaredName,
      manifest.name,
      `${name}: cordis.patch.yml 里的 name "${declaredName}" 与 package.json.name "${manifest.name}" 不一致 —— `
      + 'DSH 会报 "failed to import"，客户端插件整体不挂载（T156 真实故障）',
    );
  }
  checked.push({ id: name, packageName: manifest.name, patch: path.relative(app, patchFile) });
}
assert(checked.length >= 3, `expected the DSH plugin set, found ${checked.length}`);

// ── 2. profile bundles 与种子不得引用不存在的包 ───────────────────────────────
const profileDir = path.join(app, 'profiles', 'dsh');
const profileManifestPath = path.join(profileDir, 'profiles', 'web', 'package.json');
const profileManifest = JSON.parse(fs.readFileSync(profileManifestPath, 'utf8'));
const bundled = profileManifest?.dsh?.profile?.bundles || [];
const known = new Set([...checked.map((item) => item.packageName), ...fs.readdirSync(path.join(profileDir, 'profiles', 'web', 'node_modules'), { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name)]);

for (const name of bundled) {
  if (/^@deepseek-ai\//.test(name)) continue;     // 上游 bundle
  assert(known.has(name), `profile bundles 引用了找不到的包：${name}`);
}

const seedPatch = fs.readFileSync(path.join(profileDir, 'taskhive.patch.yml'), 'utf8');
for (const name of [...seedPatch.matchAll(/^\s*name:\s*'?([^'\n\r]+?)'?\s*$/gm)].map((m) => m[1].trim())) {
  const local = path.join(installed, name);
  const scoped = path.join(profileDir, 'profiles', 'web', 'node_modules', name);
  assert(
    fs.existsSync(local) || fs.existsSync(scoped),
    `种子 patch 引用了不存在插件的包名：${name}（陈旧种子会让审查证据与实际相反）`,
  );
}

const links = JSON.parse(fs.readFileSync(path.join(profileDir, 'plugin-links.json'), 'utf8'));
for (const name of links.links || []) {
  assert(
    fs.existsSync(path.join(profileDir, 'profiles', 'web', 'node_modules', name)),
    `种子 plugin-links.json 引用了不存在的链接：${name}`,
  );
}

// ── 3. 已移除的插件不得再出现在任何种子里（INV-3）──────────────────────────────
for (const gone of ['dsh-mnemon', 'dsh-better-sidebar']) {
  assert(!seedPatch.includes(gone), `种子 patch 不得再引用已移除的插件：${gone}`);
  assert(!(links.links || []).includes(gone), `种子 plugin-links 不得再引用已移除的插件：${gone}`);
}

console.log(`plugin bundle identity contract passed (${checked.length} DSH plugins)`);
