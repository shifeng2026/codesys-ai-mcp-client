const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
// T149：与主进程其余小 JSON 一致 —— 原子写入 + 读取损坏时隔离/回退，而不是静默清空。
const { readJson, writeJson } = require('../app/atomic-json');
const execFileAsync = promisify(execFile);

// T155：safeId 与备份保留策略改为与 plugins/manager.js **共享同一实现**（原先两文件各写一份，已漂移）。
const { safeId, moveToBackup } = require('../plugins/catalog-shared');
const configFor = {
  knowledge: { root: 'knowledge/repositories', staging: 'knowledge/staging', backups: 'knowledge/backups', manifest: ['knowledge.json', 'package.json'] },
};

class RepositoryManager {
  constructor(root, kind) {
    if (!configFor[kind]) throw new Error(`不支持的仓库类型：${kind}`);
    this.root = root; this.kind = kind; this.config = configFor[kind];
    this.base = path.join(root, this.config.root); this.staging = path.join(root, this.config.staging); this.backups = path.join(root, this.config.backups); this.catalogPath = path.join(root, this.kind, 'catalog.json');
    this.cardsPath = kind === 'knowledge' ? path.join(root, 'knowledge', 'cards.json') : null;
    this.booksPath = kind === 'knowledge' ? path.join(root, 'knowledge', 'books.json') : null;
    this.syncPath = kind === 'knowledge' ? path.join(root, 'knowledge', 'sync-state.json') : null;
    for (const dir of [this.base, this.staging, this.backups]) fs.mkdirSync(dir, { recursive: true });
  }
  catalog() { return readJson(this.catalogPath, { version: 1, repositories: {} }, { label: '知识库目录 catalog.json' }); }
  save(value) { writeJson(this.catalogPath, value); }
  // T149：知识卡片/书本/目录一律走**原子写入**（atomic-json）。
  // 旧实现是裸 `writeFileSync` 覆盖 + 读取失败静默回退空对象 —— 磁盘满/进程被杀
  // 时一次半截写就会让下次读取拿到空库，紧接着的保存把空库写回，**整库卡片会丢**。
  cardsState() { if (!this.cardsPath) throw new Error('仅知识库支持知识卡片'); return readJson(this.cardsPath, { version: 1, revision: 0, cards: [] }, { label: '知识卡片 knowledge/cards.json' }); }
  saveCards(value) { writeJson(this.cardsPath, value); }
  // T152：**批量**改目录 —— 一次读 + 一次写。原先改书名要"每张卡一次 IPC、每次整文件
  // 读-解析-序列化-写"，50 张卡就是 50 次同步全文件重写（还各写一条 trajectory）。
  setCardsCategory(ids, category) {
    const state = this.cardsState();
    const wanted = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id)));
    if (!wanted.size) return { changed: 0 };
    const next = String(category == null ? '' : category).trim().slice(0, 40);
    const now = new Date().toISOString();
    let changed = 0;
    for (const card of state.cards || []) {
      if (!wanted.has(String(card.id))) continue;
      if (next) card.category = next; else delete card.category;
      card.updatedAt = now;
      changed += 1;
    }
    if (!changed) return { changed: 0 };
    state.revision += 1;
    for (const card of state.cards || []) if (wanted.has(String(card.id))) card.revision = state.revision;
    this.saveCards(state);
    return { changed, revision: state.revision };
  }
  listCards(query = '') {
    const state = this.cardsState(); const needle = String(query || '').trim().toLowerCase();
    return (state.cards || []).filter((card) => !needle || `${card.title} ${card.content} ${(card.tags || []).join(' ')}`.toLowerCase().includes(needle)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  createCard(input = {}) {
    const state = this.cardsState(); const title = String(input.title || '').trim(); const content = String(input.content || '').trim();
    if (!title || !content) throw new Error('知识卡片需要标题和内容');
    const now = new Date().toISOString(); const id = `card-${crypto.createHash('sha1').update(`${title}\n${content}\n${now}`).digest('hex').slice(0, 16)}`;
    const card = {
      id,
      title,
      content,
      type: String(input.type || 'question'),
      tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 20) : [],
      source: String(input.source || 'user'),
      sourceSessionId: String(input.sourceSessionId || input.sessionId || ''),
      sourceTaskId: String(input.sourceTaskId || input.taskId || ''),
      modelId: String(input.modelId || input.model || ''),
      evidenceHash: String(input.evidenceHash || crypto.createHash('sha256').update(`${title}\n${content}`).digest('hex')),
      status: 'candidate',
      revision: state.revision + 1,
      createdAt: now,
      updatedAt: now,
    };
    state.revision += 1; state.cards = [card, ...(state.cards || [])]; this.saveCards(state); return card;
  }
  reviewCard(id, decision) {
    const state = this.cardsState(); const card = (state.cards || []).find((item) => item.id === id); if (!card) throw new Error(`知识卡片不存在：${id}`);
    const next = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : null; if (!next) throw new Error('审核结果必须是 approve 或 reject');
    state.revision += 1; card.status = next; card.revision = state.revision; card.updatedAt = new Date().toISOString(); this.saveCards(state); return card;
  }
  // T141：用户可**自己整理目录** —— 把卡片归到某本"书（目录）"，或清空让它回到自动分类。
  setCardCategory(id, category) {
    const state = this.cardsState(); const card = (state.cards || []).find((item) => item.id === id);
    if (!card) throw new Error(`知识卡片不存在：${id}`);
    const next = String(category == null ? '' : category).trim().slice(0, 40);
    state.revision += 1;
    if (next) card.category = next; else delete card.category;
    card.revision = state.revision; card.updatedAt = new Date().toISOString();
    this.saveCards(state); return card;
  }
  // T144：书本元数据（自定义**名字 / 颜色**）。存在 knowledge/books.json：
  //   { version:1, books: { "自动化": { color:"#3b6fd4" }, ... } }
  // 重命名时同时把**显式指定**该目录的卡片一起改名（自动分类的卡片由客户端按自身规则改名，
  // 客户端才知道自动分类结果，避免在宿主里重复一份规则）。
  booksState() {
    if (!this.booksPath) throw new Error('仅知识库支持书本');
    return readJson(this.booksPath, { version: 1, books: {} }, { label: '知识书本 knowledge/books.json' });
  }
  saveBooks(value) { writeJson(this.booksPath, value); }
  setBookMeta(from, patch = {}) {
    const source = String(from == null ? '' : from).trim().slice(0, 40);
    const title = String(patch.title == null ? '' : patch.title).trim().slice(0, 40);
    const color = String(patch.color == null ? '' : patch.color).trim().slice(0, 24);
    const target = title || source;
    if (!target) throw new Error('书本名不能为空');
    if (title && title !== source) {
      const state = this.cardsState(); let touched = 0;
      for (const card of state.cards || []) {
        if (String(card.category || '') === source) { card.category = title; touched += 1; }
      }
      if (touched) { state.revision += 1; this.saveCards(state); }
    }
    const books = this.booksState();
    books.books = books.books || {};
    if (books.books[source] && target !== source) { books.books[target] = books.books[source]; delete books.books[source]; }
    if (color) books.books[target] = { ...(books.books[target] || {}), color };
    else if (books.books[target]) { delete books.books[target].color; if (!Object.keys(books.books[target]).length) delete books.books[target]; }
    this.saveBooks(books);
    return { title: target, color: (books.books[target] && books.books[target].color) || '' };
  }
  syncStatus() {
    if (!this.syncPath) throw new Error('仅知识库支持同步');
    let value; try { value = JSON.parse(fs.readFileSync(this.syncPath, 'utf8')); } catch { value = { mode: 'local-git-ready', state: 'ready', clients: 1, lastSyncAt: null, pending: 0, conflicts: 0 }; }
    const cards = this.cardsState(); return { ...value, revision: cards.revision || 0, pending: (cards.cards || []).filter((card) => card.status === 'candidate').length };
  }
  async sync(input = {}) {
    if (!this.syncPath) throw new Error('仅知识库支持同步');
    const current = this.syncStatus();
    const remoteInput = String(input.remotePath || current.remotePath || '').trim();
    if (!remoteInput) {
      const next = { ...current, mode: input.mode || current.mode || 'local-git-ready', state: 'configuration-required', lastSyncAt: null };
      fs.writeFileSync(this.syncPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      return next;
    }
    const remotePath = path.resolve(remoteInput);
    if (remotePath === path.resolve(path.join(this.root, 'knowledge'))) throw new Error('同步目录不能是当前客户端知识库目录');
    fs.mkdirSync(remotePath, { recursive: true });
    const remoteFile = path.join(remotePath, 'taskhive-knowledge-cards.json');
    let remote = { version: 1, revision: 0, cards: [], clients: [] };
    try { remote = JSON.parse(fs.readFileSync(remoteFile, 'utf8')); } catch {}
    const local = this.cardsState(); const merged = new Map(); let conflicts = 0;
    const accept = (card, origin) => {
      const prior = merged.get(card.id);
      if (!prior) { merged.set(card.id, { card: { ...card }, origin }); return; }
      const changed = String(prior.card.evidenceHash || '') !== String(card.evidenceHash || '') || String(prior.card.content || '') !== String(card.content || '');
      if (changed && prior.origin !== origin) conflicts += 1;
      const priorRevision = Number(prior.card.revision || 0); const revision = Number(card.revision || 0);
      if (revision > priorRevision || (revision === priorRevision && String(card.updatedAt || '') > String(prior.card.updatedAt || ''))) merged.set(card.id, { card: { ...card }, origin });
    };
    for (const card of local.cards || []) accept(card, 'local');
    for (const card of remote.cards || []) accept(card, 'remote');
    const cards = [...merged.values()].map((item) => item.card).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const revision = Math.max(Number(local.revision || 0), Number(remote.revision || 0), ...cards.map((card) => Number(card.revision || 0)));
    const clientId = crypto.createHash('sha256').update(path.resolve(this.root)).digest('hex').slice(0, 16);
    const clients = [...new Set([...(remote.clients || []).map(String), clientId])];
    const shared = { version: 1, revision, cards, clients, updatedAt: new Date().toISOString() };
    const tempRemote = `${remoteFile}.tmp-${process.pid}`;
    fs.writeFileSync(tempRemote, `${JSON.stringify(shared, null, 2)}\n`, 'utf8'); fs.renameSync(tempRemote, remoteFile);
    this.saveCards({ version: 1, revision, cards });
    const next = { ...current, mode: input.mode || 'shared-folder-or-git', state: 'synchronized', remotePath, clients: clients.length, lastSyncAt: shared.updatedAt, conflicts, revision, pending: cards.filter((card) => card.status === 'candidate').length };
    fs.writeFileSync(this.syncPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8'); return next;
  }
  manifest(dir) { for (const name of this.config.manifest) { const file = path.join(dir, name); if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } throw new Error(`${this.kind} 仓库缺少 manifest`); }
  list() { const catalog = this.catalog(); return Object.values(catalog.repositories).map((item) => ({ ...item, installed: fs.existsSync(path.join(this.base, item.id)) })); }
  updateState(id, state) {
    const safe = safeId(id); const catalog = this.catalog(); const item = catalog.repositories[safe];
    if (!item || !fs.existsSync(path.join(this.base, safe))) throw new Error(`${this.kind} 未安装：${safe}`);
    if (!['enabled', 'disabled'].includes(state)) throw new Error(`无效仓库状态：${state}`);
    catalog.repositories[safe] = { ...item, state, ...(state === 'enabled' ? { enabledAt: new Date().toISOString() } : { disabledAt: new Date().toISOString() }) };
    this.save(catalog); return catalog.repositories[safe];
  }
  enable(id) { return this.updateState(id, 'enabled'); }
  disable(id) { return this.updateState(id, 'disabled'); }
  restore(id) {
    const safe = safeId(id); const catalog = this.catalog(); const item = catalog.repositories[safe];
    if (!item) throw new Error(`${this.kind} 未注册：${safe}`);
    const backups = fs.existsSync(this.backups)
      ? fs.readdirSync(this.backups, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith(`${safe}-`) && !entry.name.endsWith('-displaced')).sort((left, right) => right.name.localeCompare(left.name))
      : [];
    const backup = backups[0] ? path.join(this.backups, backups[0].name) : null;
    if (!backup) throw new Error(`没有可恢复的 ${this.kind} 备份：${safe}`);
    const manifest = this.manifest(backup); const manifestId = safeId(manifest.id);
    if (manifestId !== safe || !manifest.name || !manifest.version) throw new Error(`${this.kind} 备份 manifest 与目录不匹配`);
    const target = path.join(this.base, safe);
    if (fs.existsSync(target)) moveToBackup(target, this.backups, safe, { displaced: true });
    fs.renameSync(backup, target);
    catalog.repositories[safe] = { ...item, name: manifest.name, version: manifest.version, manifestHash: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), state: 'enabled', restoredAt: new Date().toISOString() };
    delete catalog.repositories[safe].backup;
    this.save(catalog); return catalog.repositories[safe];
  }
  search(query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const hits = [];
    for (const item of this.list().filter((entry) => entry.installed && entry.state === 'enabled')) {
      const dir = path.join(this.base, item.id);
      const files = [];
      const walk = (current) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          if (entry.isDirectory()) walk(full); else if (/\.(md|txt|json|ya?ml|st|exp|library)$/i.test(entry.name)) files.push(full);
        }
      };
      walk(dir);
      for (const file of files) {
        let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const index = text.toLowerCase().indexOf(needle); if (index < 0) continue;
        hits.push({ id: item.id, name: item.name, file: path.relative(dir, file), snippet: text.slice(Math.max(0, index - 120), Math.min(text.length, index + needle.length + 240)) });
        if (hits.length >= 50) return hits;
      }
    }
    return hits;
  }
  audit() {
    return this.list().map((item) => ({ id: item.id, name: item.name, version: item.version, state: item.state || (item.installed ? 'enabled' : 'uninstalled'), installed: item.installed, manifestHash: item.manifestHash, source: item.source }));
  }
  async install(source) {
    if (!source) throw new Error('缺少仓库来源');
    const idHint = safeId(path.basename(String(source).replace(/[\\/]$/, '')).replace(/\.git$/, '')) || `${this.kind}-${Date.now()}`;
    const staged = path.join(this.staging, `${idHint}-${Date.now()}`); fs.mkdirSync(staged, { recursive: true });
    if (/^(https?|ssh|git|file)[:/]/i.test(source) || /\.git$/i.test(source)) await execFileAsync('git', ['clone', '--depth', '1', source, staged], { windowsHide: true, timeout: 120000 });
    else { const local = path.resolve(source); if (!fs.existsSync(local) || !fs.statSync(local).isDirectory()) throw new Error('本地仓库目录不存在'); fs.cpSync(local, staged, { recursive: true, force: true }); }
    const manifest = this.manifest(staged); const id = safeId(manifest.id); if (!id || !manifest.name || !manifest.version) throw new Error('manifest 必须包含 id/name/version');
    const target = path.join(this.base, id); if (fs.existsSync(target)) moveToBackup(target, this.backups, id); fs.renameSync(staged, target);
    const catalog = this.catalog(); const item = { id, name: manifest.name, version: manifest.version, source, manifestHash: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), state: 'enabled', installedAt: new Date().toISOString() }; catalog.repositories[id] = item; this.save(catalog); return item;
  }
  uninstall(id) { const safe = safeId(id); const target = path.join(this.base, safe); if (!fs.existsSync(target)) throw new Error(`${this.kind} 未安装：${safe}`); const backup = moveToBackup(target, this.backups, safe); const catalog = this.catalog(); if (catalog.repositories[safe]) catalog.repositories[safe] = { ...catalog.repositories[safe], state: 'uninstalled', backup, uninstalledAt: new Date().toISOString() }; this.save(catalog); return catalog.repositories[safe] || { id: safe, state: 'uninstalled', backup }; }
}

module.exports = { RepositoryManager };
