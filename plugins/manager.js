const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function safeId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

class PluginManager {
  constructor(root) {
    this.root = root;
    this.base = path.join(root, 'plugins');
    this.installed = path.join(this.base, 'installed');
    this.staging = path.join(this.base, 'staging');
    this.backups = path.join(this.base, 'backups');
    this.catalogPath = path.join(this.base, 'catalog.json');
    for (const dir of [this.installed, this.staging, this.backups]) fs.mkdirSync(dir, { recursive: true });
  }

  readCatalog() {
    try { return JSON.parse(fs.readFileSync(this.catalogPath, 'utf8')); } catch { return { version: 1, plugins: {} }; }
  }

  writeCatalog(catalog) {
    const temp = `${this.catalogPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(catalog, null, 2), 'utf8');
    fs.renameSync(temp, this.catalogPath);
  }

  manifestFrom(dir) {
    for (const name of ['plugin.json', 'dsh.plugin.json', 'package.json']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    throw new Error('插件缺少 plugin.json/dsh.plugin.json');
  }

  list() {
    const catalog = this.readCatalog();
    return Object.values(catalog.plugins).sort((left, right) => {
      const leftOrder = Number.isFinite(Number(left.order)) ? Number(left.order) : 9999;
      const rightOrder = Number.isFinite(Number(right.order)) ? Number(right.order) : 9999;
      return leftOrder - rightOrder || String(left.name || left.id).localeCompare(String(right.name || right.id));
    }).map((item) => {
      const installed = fs.existsSync(path.join(this.installed, item.id)) || item.installed === true;
      const ui = item.ui || { kind: 'tool/service-only', visible: false, allowedPlacements: [] };
      const allowedPlacements = Array.isArray(ui.allowedPlacements) ? ui.allowedPlacements : [];
      const source = String(item.source || 'local');
      const sourceKind = source.startsWith('bundled:') ? 'bundled' : /^(?:https?|ssh|git|file)[:/]|\.git$/i.test(source) ? 'git' : 'local';
      const type = ui.kind === 'surface' || ui.visible === true ? 'surface' : ui.kind === 'settings-only' ? 'settings' : 'background';
      const state = item.state || (installed ? 'enabled' : 'uninstalled');
      return {
        ...item,
        installed,
        state,
        sourceKind,
        type,
        health: !installed ? 'missing' : state === 'enabled' ? 'healthy' : state,
        placement: item.placement || ui.defaultPlacement || 'hidden',
        entryConfigurable: ui.visible === true && allowedPlacements.length > 0,
        ui,
      };
    });
  }

  setPlacement(id, placement) {
    const safe = safeId(id);
    const catalog = this.readCatalog();
    const item = catalog.plugins[safe];
    if (!item) throw new Error(`插件未注册：${safe}`);
    const ui = item.ui || {};
    const allowed = Array.isArray(ui.allowedPlacements) ? ui.allowedPlacements : [];
    if (ui.kind === 'tool/service-only' || ui.kind === 'settings-only' || allowed.length === 0) throw new Error(`插件没有可配置的界面入口：${safe}`);
    if (!allowed.includes(placement)) throw new Error(`无效入口位置：${placement}`);
    catalog.plugins[safe] = { ...item, placement, placementUpdatedAt: new Date().toISOString() };
    this.writeCatalog(catalog);
    return catalog.plugins[safe];
  }

  setOrder(id, order) {
    const safe = safeId(id);
    const catalog = this.readCatalog();
    const item = catalog.plugins[safe];
    if (!item) throw new Error(`鎻掍欢鏈敞鍐岋細${safe}`);
    const nextOrder = Number(order);
    if (!Number.isInteger(nextOrder) || nextOrder < 0 || nextOrder > 9999) throw new Error(`鏃犳晥鎻掍欢椤哄簭锛細${order}`);
    catalog.plugins[safe] = { ...item, order: nextOrder, orderUpdatedAt: new Date().toISOString() };
    this.writeCatalog(catalog);
    return catalog.plugins[safe];
  }

  dshPackages() {
    const catalog = this.readCatalog();
    return Object.values(catalog.plugins).flatMap((item) => {
      if (item.state === 'disabled' || item.state === 'uninstalled') return [];
      if (item.runtimeMount === false) return [];
      const dir = path.join(this.installed, item.id);
      if (!fs.existsSync(dir)) return [];
      try {
        const manifest = this.manifestFrom(dir);
        const packageName = String(manifest.name || '').trim();
        const patch = manifest.dsh?.bundle?.patch;
        if (!packageName || !patch || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(packageName)) return [];
        return [{ id: item.id, packageName, dir, version: manifest.version || item.version, patch }];
      } catch {
        return [];
      }
    });
  }

  updateState(id, state) {
    const safe = safeId(id);
    const catalog = this.readCatalog();
    const item = catalog.plugins[safe];
    if (!item || !fs.existsSync(path.join(this.installed, safe))) throw new Error(`插件未安装：${safe}`);
    if (item.protected) throw new Error(`系统组件不能停用：${safe}`);
    if (!['enabled', 'disabled'].includes(state)) throw new Error(`无效插件状态：${state}`);
    catalog.plugins[safe] = { ...item, state, ...(state === 'enabled' ? { enabledAt: new Date().toISOString() } : { disabledAt: new Date().toISOString() }) };
    this.writeCatalog(catalog);
    return catalog.plugins[safe];
  }

  enable(id) { return this.updateState(id, 'enabled'); }

  disable(id) { return this.updateState(id, 'disabled'); }

  restore(id) {
    const safe = safeId(id);
    const catalog = this.readCatalog();
    const item = catalog.plugins[safe];
    if (!item) throw new Error(`插件未注册：${safe}`);
    const backups = fs.existsSync(this.backups)
      ? fs.readdirSync(this.backups, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith(`${safe}-`) && !entry.name.endsWith('-displaced')).sort((a, b) => b.name.localeCompare(a.name))
      : [];
    const backup = backups[0] ? path.join(this.backups, backups[0].name) : null;
    if (!backup || !fs.existsSync(backup)) throw new Error(`没有可恢复的插件备份：${safe}`);
    const manifest = this.manifestFrom(backup);
    const target = path.join(this.installed, safe);
    if (fs.existsSync(target)) {
      const displaced = path.join(this.backups, `${safe}-${Date.now()}-displaced`);
      fs.renameSync(target, displaced);
    }
    fs.renameSync(backup, target);
    const digest = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    catalog.plugins[safe] = { ...item, id: safe, name: manifest.name || item.name, version: manifest.version || item.version, manifestHash: digest, state: 'enabled', restoredAt: new Date().toISOString(), backupRestored: backup };
    this.writeCatalog(catalog);
    return catalog.plugins[safe];
  }

  async stage(source, requestedId) {
    const id = safeId(requestedId || path.basename(String(source).replace(/[\\/]$/, '')).replace(/\.git$/, '')) || `plugin-${Date.now()}`;
    const dir = path.join(this.staging, `${id}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    if (/^(https?|ssh|git|file)[:/]/i.test(source) || /\.git$/i.test(source)) {
      await execFileAsync('git', ['clone', '--depth', '1', source, dir], { windowsHide: true, timeout: 120000 });
    } else {
      const resolved = path.resolve(source);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('本地插件目录不存在');
      fs.cpSync(resolved, dir, { recursive: true, force: true });
    }
    return dir;
  }

  async install({ source, requestedId }) {
    if (!source) throw new Error('缺少插件来源');
    const staged = await this.stage(source, requestedId);
    const manifest = this.manifestFrom(staged);
    const id = safeId(manifest.id || String(manifest.name || '').split('/').pop());
    if (!id || !manifest.name || !manifest.version) throw new Error('插件 manifest 必须包含 id/name/version');
    const target = path.join(this.installed, id);
    const catalog = this.readCatalog();
    if (catalog.plugins[id]?.protected) throw new Error(`系统组件不能被普通安装覆盖：${id}`);
    if (fs.existsSync(target)) {
      const backup = path.join(this.backups, `${id}-${Date.now()}`);
      fs.renameSync(target, backup);
    }
    fs.renameSync(staged, target);
    const digest = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    catalog.plugins[id] = {
      id, name: manifest.name, version: manifest.version, source, manifestHash: digest, state: 'enabled', installedAt: new Date().toISOString(),
      order: Number.isInteger(Number(catalog.plugins[id]?.order)) ? Number(catalog.plugins[id].order) : Object.keys(catalog.plugins).length,
      capabilities: manifest.capabilities || [], ui: manifest.ui || { kind: 'tool/service-only', visible: false, allowedPlacements: [] }, description: manifest.description || '',
    };
    this.writeCatalog(catalog);
    return catalog.plugins[id];
  }

  uninstall(id) {
    const safe = safeId(id);
    const catalog = this.readCatalog();
    if (catalog.plugins[safe]?.protected) throw new Error(`系统组件不能卸载：${safe}`);
    const target = path.join(this.installed, safe);
    if (!fs.existsSync(target)) throw new Error(`插件未安装：${safe}`);
    const backup = path.join(this.backups, `${safe}-${Date.now()}`);
    fs.renameSync(target, backup);
    if (catalog.plugins[safe]) catalog.plugins[safe] = { ...catalog.plugins[safe], state: 'uninstalled', backup, uninstalledAt: new Date().toISOString() };
    this.writeCatalog(catalog);
    return catalog.plugins[safe] || { id: safe, state: 'uninstalled', backup };
  }
}

module.exports = { PluginManager };
