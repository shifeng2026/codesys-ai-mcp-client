const fs = require('fs');
const path = require('path');

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
    fs.appendFileSync(this.logPath, `${JSON.stringify({
      at: new Date().toISOString(), type, payload,
    })}\n`, 'utf8');
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
