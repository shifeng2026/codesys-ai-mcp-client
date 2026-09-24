const fs = require('fs');
const path = require('path');

const DEFAULTS = Object.freeze([
  ['program', '程序本体', 'program', '.'],
  ['plugins', '插件目录', 'app', 'plugins'],
  ['models', '模型目录', 'app', 'models'],
  ['knowledge', '知识库目录', 'app', 'knowledge'],
  ['experts', '专家目录', 'app', 'experts'],
  ['videoModels', '视频模型', 'app', 'video-models'],
  ['workspaces', '工作区', 'app', 'workspaces'],
  ['profiles', '配置目录', 'app', 'profiles'],
]);

function validGitUrl(value) {
  const text = String(value || '').trim();
  return !text || /^(?:https?:\/\/|ssh:\/\/|git:\/\/|git@[^:]+:|file:\/\/).+/i.test(text);
}

class DirectoryStore {
  constructor(root, programRoot = root) {
    this.root = path.resolve(root);
    this.programRoot = path.resolve(programRoot);
    this.file = path.join(this.root, 'profiles', 'directories.json');
    if (!fs.existsSync(this.file)) this.write(this.defaults());
  }

  portablePath(scope, relativePath) {
    return path.resolve(scope === 'program' ? this.programRoot : this.root, relativePath);
  }

  defaults() {
    return {
      version: 2,
      entries: DEFAULTS.map(([id, name, portableScope, relativePath]) => ({
        id,
        name,
        path: this.portablePath(portableScope, relativePath),
        gitUrl: '',
        builtin: true,
        portable: true,
        portableScope,
        relativePath,
      })),
    };
  }

  normalizePortable(value) {
    if (!value || !Array.isArray(value.entries)) return this.defaults();
    if (Number(value.version || 1) < 2) {
      const defaults = new Map(this.defaults().entries.map((entry) => [entry.id, entry]));
      return {
        version: 2,
        entries: value.entries.map((entry) => entry.builtin === true && defaults.has(entry.id)
          ? { ...entry, ...defaults.get(entry.id), name: entry.name || defaults.get(entry.id).name, gitUrl: entry.gitUrl || '' }
          : entry),
      };
    }
    return {
      ...value,
      version: 2,
      entries: value.entries.map((entry) => entry.portable === true
        ? { ...entry, path: this.portablePath(entry.portableScope, entry.relativePath) }
        : entry),
    };
  }

  read() {
    try {
      return this.normalizePortable(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return this.defaults();
    }
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return this.normalizePortable(value);
  }

  validate(input, currentId = '') {
    const id = String(input.id || currentId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
    const name = String(input.name || '').trim().slice(0, 80);
    const rawPath = String(input.path || '').trim();
    if (!path.isAbsolute(rawPath)) throw new Error('目录路径必须是绝对路径');
    const target = path.resolve(rawPath);
    const gitUrl = String(input.gitUrl || '').trim();
    if (!id || !name) throw new Error('目录项需要有效 ID、名称和绝对路径');
    if (!validGitUrl(gitUrl)) throw new Error('Git 地址必须是 HTTPS、SSH、git@ 或 file URL');
    return { id, name, path: target, gitUrl };
  }

  upsert(input) {
    const state = this.read();
    const priorId = String(input.previousId || input.id || '');
    const normalized = this.validate(input, priorId);
    if (normalized.id !== priorId && state.entries.some((entry) => entry.id === normalized.id)) throw new Error('目录 ID 已存在');
    const index = state.entries.findIndex((entry) => entry.id === priorId);
    const prior = index >= 0 ? state.entries[index] : null;
    const pathChanged = prior && path.resolve(prior.path).toLowerCase() !== normalized.path.toLowerCase();
    const entry = {
      ...(prior || {}),
      ...normalized,
      builtin: prior?.builtin === true,
      portable: prior?.portable === true && !pathChanged,
      updatedAt: new Date().toISOString(),
    };
    if (!entry.portable) {
      delete entry.portableScope;
      delete entry.relativePath;
    }
    if (index >= 0) state.entries[index] = entry; else state.entries.push(entry);
    this.write(state);
    return this.read();
  }

  remove(id) {
    const state = this.read();
    const index = state.entries.findIndex((entry) => entry.id === String(id));
    if (index < 0) throw new Error('目录项不存在');
    state.entries.splice(index, 1);
    this.write(state);
    return this.read();
  }

  restore() {
    this.write(this.defaults());
    return this.read();
  }
}

module.exports = { DirectoryStore, DEFAULTS, validGitUrl };
