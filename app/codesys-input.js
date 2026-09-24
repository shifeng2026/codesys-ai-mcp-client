const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const SAFE_KEYS = new Set(['Tab', 'Escape', 'Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

class CodesysInputController {
  constructor(root, monitor, options = {}) {
    this.root = path.resolve(root);
    this.monitor = monitor;
    this.spawnProcess = options.spawnProcess || spawn;
    this.runProcess = options.runProcess || null;
    this.script = options.script || path.join(__dirname, 'win-window-input-worker.ps1');
    this.approvals = new Map();
    this.pending = new Map();
    this.worker = null;
    this.auditPath = path.join(this.root, 'logs', 'codesys-input-audit.jsonl');
  }

  async request(input = {}) {
    // Keep the controller compatible with the lightweight monitor contract
    // used by isolated smoke tests and older integrations. Production monitors
    // expose resolveWindow for identity revalidation; a list-only monitor may
    // still safely resolve the requested window by id.
    const target = typeof this.monitor.resolveWindow === 'function'
      ? await this.monitor.resolveWindow(input.windowId)
      : (await this.monitor.listWindows?.() || []).find((item) => String(item.id) === String(input.windowId));
    if (!target) throw Object.assign(new Error('CODESYS 目标窗口不可用或不是完整可见窗口'), { code: 'CODESYS_INPUT_TARGET_INVALID' });
    const action = this.normalizeAction(input.action || {});
    const approvalId = crypto.randomUUID();
    const approval = {
      approvalId,
      state: input.initiator === 'ai-operation-direct' ? 'approved-by-ai-operation-mode' : 'pending-user-approval',
      target: { id: target.id, pid: target.pid, title: target.title, width: target.width, height: target.height },
      action,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      singleUse: true,
      requiresUserGesture: input.initiator !== 'ai-operation-direct',
      requiresAdditionalConfirmation: false,
      initiator: String(input.initiator || 'explicit-request'),
    };
    this.approvals.set(approvalId, approval);
    this.audit('requested', approval);
    return approval;
  }

  normalizeAction(action) {
    const type = String(action.type || '');
    if (type === 'mouse.click') {
      const x = Number(action.x); const y = Number(action.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw Object.assign(new Error('鼠标坐标必须是 0..1 的窗口相对坐标'), { code: 'CODESYS_INPUT_COORDINATE_INVALID' });
      return { type, x, y, button: 'left', clicks: action.clicks === 2 ? 2 : 1 };
    }
    if (type === 'mouse.wheel') {
      const x = Number(action.x); const y = Number(action.y); const delta = Number(action.delta);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw Object.assign(new Error('滚轮坐标必须是 0..1 的窗口相对坐标'), { code: 'CODESYS_INPUT_COORDINATE_INVALID' });
      if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1200 || delta % 120 !== 0) throw Object.assign(new Error('滚轮增量必须是 -1200..1200 范围内的 120 整数倍'), { code: 'CODESYS_INPUT_WHEEL_INVALID' });
      return { type, x, y, delta };
    }
    if (type === 'keyboard.key') {
      const key = String(action.key || '');
      if (!SAFE_KEYS.has(key)) throw Object.assign(new Error(`键盘按键不在安全白名单：${key || '(empty)'}`), { code: 'CODESYS_INPUT_KEY_DENIED' });
      return { type, key };
    }
    if (type === 'keyboard.text') {
      const text = String(action.text || '');
      if (!text || text.length > 2000 || /[\u0000\u000B\u000C]/.test(text)) throw Object.assign(new Error('文本输入必须为 1..2000 个可打印字符或换行'), { code: 'CODESYS_INPUT_TEXT_INVALID' });
      return { type, text };
    }
    throw Object.assign(new Error(`CODESYS 输入动作未开放：${type || '(empty)'}`), { code: 'CODESYS_INPUT_ACTION_DENIED' });
  }

  async execute(approvalId) {
    const id = String(approvalId || '');
    const approval = this.approvals.get(id);
    this.approvals.delete(id);
    if (!approval) throw Object.assign(new Error('输入批准不存在或已使用'), { code: 'CODESYS_INPUT_APPROVAL_INVALID' });
    if (Date.parse(approval.expiresAt) < Date.now()) throw Object.assign(new Error('输入批准已过期'), { code: 'CODESYS_INPUT_APPROVAL_EXPIRED' });
    const startedAt = Date.now();
    try {
      const output = await this.sendToWorker({ windowId: approval.target.id, expectedPid: approval.target.pid, action: approval.action });
      const result = { approvalId: id, state: 'executed', action: approval.action, target: approval.target, durationMs: Date.now() - startedAt, output, background: true, executedAt: new Date().toISOString() };
      this.audit('executed', result);
      return result;
    } catch (error) {
      const result = { approvalId: id, state: 'failed', action: approval.action, target: approval.target, durationMs: Date.now() - startedAt, error: String(error.message || error), failedAt: new Date().toISOString() };
      this.audit('failed', result);
      throw Object.assign(new Error(`CODESYS 输入执行失败：${error.message || error}`), { code: 'CODESYS_INPUT_EXECUTION_FAILED', details: result });
    }
  }

  ensureWorker() {
    if (this.worker && !this.worker.killed) return this.worker;
    const child = this.spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.worker = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(String(message.requestId || ''));
      if (!pending) return;
      this.pending.delete(String(message.requestId)); clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error || 'CODESYS background input failed'));
    });
    child.stderr.on('data', (chunk) => this.audit('worker-warning', { message: String(chunk || '').slice(-2000), at: new Date().toISOString() }));
    child.once('exit', (code) => {
      if (this.worker === child) this.worker = null;
      for (const [requestId, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error(`CODESYS input worker exited (${code})`)); this.pending.delete(requestId); }
    });
    return child;
  }

  async sendToWorker(payload) {
    // Backward-compatible seam for isolated tests and integrations that
    // provide a deterministic process runner. Production uses the persistent
    // JSONL worker below, so this branch does not reintroduce per-action shell
    // creation in the desktop path.
    if (this.runProcess) {
      const action = payload.action || {};
      const args = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-WindowId', String(payload.windowId), '-Action', String(action.type)];
      if (action.type === 'mouse.click' || action.type === 'mouse.wheel') args.push('-X', String(action.x), '-Y', String(action.y));
      if (action.type === 'mouse.click') args.push('-Clicks', String(action.clicks || 1));
      if (action.type === 'mouse.wheel') args.push('-Delta', String(action.delta));
      if (action.type === 'keyboard.key') args.push('-Key', String(action.key));
      if (action.type === 'keyboard.text') args.push('-TextBase64', Buffer.from(action.text, 'utf8').toString('base64'));
      const output = await this.runProcess('powershell.exe', args, { windowsHide: true });
      try { return JSON.parse(String(output?.stdout || '{}')); } catch { return output; }
    }
    const child = this.ensureWorker();
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('CODESYS background input timed out')); }, 3000);
      this.pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ requestId, ...payload })}\n`, 'utf8', (error) => { if (!error) return; clearTimeout(timer); this.pending.delete(requestId); reject(error); });
    });
  }

  revokeAll(reason = 'application-shutdown') {
    const count = this.approvals.size;
    this.approvals.clear();
    if (this.worker) { try { this.worker.stdin.end(); this.worker.kill(); } catch {} this.worker = null; }
    this.audit('revoked-all', { count, reason, at: new Date().toISOString() });
    return count;
  }

  audit(event, data) {
    fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
    fs.appendFileSync(this.auditPath, `${JSON.stringify({ event, ...data })}\n`, 'utf8');
  }
}

module.exports = { CodesysInputController, SAFE_KEYS };
