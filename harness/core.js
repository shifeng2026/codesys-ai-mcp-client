const fs = require('fs');
const path = require('path');
// T151：trajectory 原本用裸 appendFileSync **完全没有轮转**（实测 2.78 MB / 18412 行，
// 每会话约 132 KB/天且只增不减；每次工具调用写 2 行）。改走已有的带轮转实现。
const { appendDiagnosticLog } = require('../app/diagnostic-log');

class HarnessCore {
  constructor(root) {
    this.root = root;
    this.startedAt = new Date().toISOString();
    this.logPath = path.join(root, 'logs', 'trajectory.jsonl');
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    this.state = 'ready';
    this.append('harness.started', { agentLoop: 'single', owner: 'harness' });
  }

  append(type, payload = {}) {
    // 4 MB × 2 份轮转；写失败绝不抛（由 appendDiagnosticLog 内部兜底）。
    appendDiagnosticLog(this.logPath, `${JSON.stringify({
      at: new Date().toISOString(), type, payload,
    })}\n`, { maxBytes: 4 * 1024 * 1024, backups: 2 });
  }

  status() {
    return {
      state: this.state,
      owner: 'Harness/DSH',
      agentLoop: 'single',
      startedAt: this.startedAt,
      root: this.root,
    };
  }

  async runTool(name, payload, handler) {
    this.append('tool.request', { name, payload });
    try {
      const result = await handler();
      this.append('tool.result', { name, ok: true });
      return result;
    } catch (error) {
      this.append('tool.result', { name, ok: false, error: error.message });
      throw error;
    }
  }
}

module.exports = { HarnessCore };
