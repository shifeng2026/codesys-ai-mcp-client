const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MemoryStore {
  constructor(root) { this.file = path.join(root, 'knowledge', 'memory.json'); }
  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { version: 1, entries: [] }; } }
  write(value) { fs.writeFileSync(this.file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
  retain(input = {}) {
    const content = String(input.content || '').trim();
    if (!content) throw new Error('记忆内容不能为空');
    const state = this.read(); const now = new Date().toISOString();
    const entry = { id: `memory-${crypto.createHash('sha1').update(`${content}\n${now}`).digest('hex').slice(0, 16)}`, content, scope: String(input.scope || 'session'), confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))), source: String(input.source || 'user'), status: 'active', createdAt: now, updatedAt: now };
    state.entries.unshift(entry); this.write(state); return entry;
  }
  recall(query = '', limit = 8) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return this.read().entries.filter((entry) => entry.status === 'active').map((entry) => ({ ...entry, score: terms.filter((term) => entry.content.toLowerCase().includes(term)).length })).filter((entry) => !terms.length || entry.score).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(30, Number(limit) || 8)));
  }
  forget(id) { const state = this.read(); const entry = state.entries.find((item) => item.id === String(id)); if (!entry) throw new Error('记忆不存在'); entry.status = 'forgotten'; entry.updatedAt = new Date().toISOString(); this.write(state); return entry; }
  status() { const entries = this.read().entries; return { provider: 'taskhive-local-memory', state: 'ready', active: entries.filter((item) => item.status === 'active').length, forgotten: entries.filter((item) => item.status === 'forgotten').length, trust: 'low' }; }
}

module.exports = { MemoryStore };
