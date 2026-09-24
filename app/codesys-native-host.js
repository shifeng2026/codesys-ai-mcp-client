const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, 'win-window-host.ps1');

function normalizeBounds(input) {
  const value = {
    x: Math.round(Number(input?.x)),
    y: Math.round(Number(input?.y)),
    width: Math.round(Number(input?.width)),
    height: Math.round(Number(input?.height)),
  };
  if (![value.x, value.y, value.width, value.height].every(Number.isFinite) || value.width < 320 || value.height < 200) {
    const error = new Error('CODESYS 原生托管区域无效');
    error.code = 'CODESYS_NATIVE_HOST_BOUNDS_INVALID';
    throw error;
  }
  return value;
}

function windowHandleHex(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('TaskHive 主窗口不可用');
  const value = browserWindow.getNativeWindowHandle();
  if (!Buffer.isBuffer(value) || value.length < 4) throw new Error('无法读取 TaskHive 原生窗口句柄');
  const numeric = value.length >= 8 ? value.readBigUInt64LE(0) : BigInt(value.readUInt32LE(0));
  return `0x${numeric.toString(16).toUpperCase()}`;
}

class CodesysNativeHost {
  constructor(root, monitor, options = {}) {
    this.root = path.resolve(root);
    this.monitor = monitor;
    this.runProcess = options.runProcess || execFileAsync;
    this.session = null;
    this.transition = Promise.resolve();
    this.auditPath = path.join(this.root, 'logs', 'codesys-native-host-audit.jsonl');
  }

  audit(event, details = {}) {
    fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
    fs.appendFileSync(this.auditPath, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, 'utf8');
  }

  async invoke(args) {
    const result = await this.runProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const stdout = String(result?.stdout || '').trim();
    const stderr = String(result?.stderr || '').trim();
    if (!stdout && stderr) throw new Error(stderr);
    return stdout ? JSON.parse(stdout) : {};
  }

  status() {
    return this.session
      ? { attached: true, suspended: this.session.suspended === true, mode: 'owned-native-host', windowId: this.session.window.id, pid: this.session.window.pid, bounds: this.session.bounds, taskbarHidden: this.session.taskbarHidden === true, actualOwner: this.session.actualOwner || '', actualExStyle: Number(this.session.actualExStyle || 0), aiMonitor: 'independent-read-only-media-stream', humanInput: 'native-hwnd-direct' }
      : { attached: false, suspended: false, mode: 'idle', windowId: '', pid: null, bounds: null, taskbarHidden: false, aiMonitor: 'independent-read-only-media-stream', humanInput: 'native-hwnd-direct' };
  }

  enqueue(operation) {
    const next = this.transition.catch(() => null).then(operation);
    this.transition = next.catch(() => null);
    return next;
  }

  attach(windowId, bounds, hostWindow) {
    return this.enqueue(() => this.attachNow(windowId, bounds, hostWindow));
  }

  async attachNow(windowId, bounds, hostWindow) {
    const targetBounds = normalizeBounds(bounds);
    const candidates = await this.monitor.listWindows();
    const target = candidates.find((item) => String(item.id) === String(windowId));
    if (!target || target.usable === false) throw Object.assign(new Error('CODESYS 窗口不可用于原生托管'), { code: 'CODESYS_NATIVE_HOST_WINDOW_INVALID' });
    if (!/^codesys/i.test(String(target.processName || '')) && !(process.env.TASKHIVE_CODESYS_TEST_FIXTURE === '1' && target.fixture === true)) {
      throw Object.assign(new Error('原生托管只允许经过复核的 CODESYS 窗口'), { code: 'CODESYS_NATIVE_HOST_PROCESS_DENIED' });
    }
    if (this.session && String(this.session.window.id) !== String(target.id)) await this.detachNow('switch-window');
    if (this.session) return this.session.suspended === true ? this.resumeNow(targetBounds) : this.updateNow(targetBounds);
    const result = await this.invoke([
      '-Mode', 'attach', '-WindowId', String(target.id), '-ExpectedPid', String(target.pid),
      '-HostWindowId', windowHandleHex(hostWindow), '-Left', String(targetBounds.x), '-Top', String(targetBounds.y),
      '-Width', String(targetBounds.width), '-Height', String(targetBounds.height),
      ...(target.fixture === true ? ['-AllowFixture'] : []),
    ]);
    this.session = { window: target, bounds: targetBounds, restore: result.restore || {}, hostWindowId: result.hostWindowId || '', taskbarHidden: result.taskbarHidden === true, actualOwner: result.actualOwner || '', actualExStyle: Number(result.actualExStyle || 0), suspended: false };
    this.audit('attached', { windowId: target.id, pid: target.pid, bounds: targetBounds, mode: 'owned-native-host', taskbarHidden: result.taskbarHidden === true, actualOwner: result.actualOwner || '', actualExStyle: Number(result.actualExStyle || 0), inputSent: false });
    return { ...this.status(), identityVerified: result.identityVerified === true, styleCaptured: result.styleCaptured === true, taskbarHidden: result.taskbarHidden === true, actualOwner: result.actualOwner || '', actualExStyle: Number(result.actualExStyle || 0) };
  }

  update(bounds) {
    return this.enqueue(() => this.updateNow(bounds));
  }

  async updateNow(bounds) {
    if (!this.session) return this.status();
    const targetBounds = normalizeBounds(bounds);
    if (this.session.suspended === true) {
      this.session.bounds = targetBounds;
      return this.status();
    }
    const current = (await this.monitor.listWindows()).find((item) => String(item.id) === String(this.session.window.id));
    if (!current || Number(current.pid) !== Number(this.session.window.pid)) {
      await this.detachNow('identity-changed').catch(() => {});
      throw Object.assign(new Error('CODESYS 窗口身份已变化，已停止原生托管'), { code: 'CODESYS_NATIVE_HOST_IDENTITY_CHANGED' });
    }
    await this.invoke(['-Mode', 'move', '-WindowId', String(current.id), '-ExpectedPid', String(current.pid), '-Left', String(targetBounds.x), '-Top', String(targetBounds.y), '-Width', String(targetBounds.width), '-Height', String(targetBounds.height), ...(current.fixture === true ? ['-AllowFixture'] : [])]);
    this.session.bounds = targetBounds;
    return this.status();
  }

  suspend(reason = 'surface-switch') {
    return this.enqueue(() => this.suspendNow(reason));
  }

  async suspendNow(reason = 'surface-switch') {
    if (!this.session || this.session.suspended === true) return this.status();
    const session = this.session;
    await this.invoke(['-Mode', 'suspend', '-WindowId', String(session.window.id), '-ExpectedPid', String(session.window.pid), ...(session.window.fixture === true ? ['-AllowFixture'] : [])]);
    session.suspended = true;
    this.audit('suspended', { windowId: session.window.id, pid: session.window.pid, reason, bounds: session.bounds, restored: false, inputSent: false });
    return this.status();
  }

  resume(bounds) {
    return this.enqueue(() => this.resumeNow(bounds));
  }

  async resumeNow(bounds) {
    if (!this.session) return this.status();
    const targetBounds = normalizeBounds(bounds || this.session.bounds);
    const session = this.session;
    await this.invoke(['-Mode', 'resume', '-WindowId', String(session.window.id), '-ExpectedPid', String(session.window.pid), '-Left', String(targetBounds.x), '-Top', String(targetBounds.y), '-Width', String(targetBounds.width), '-Height', String(targetBounds.height), ...(session.window.fixture === true ? ['-AllowFixture'] : [])]);
    session.bounds = targetBounds;
    session.suspended = false;
    this.audit('resumed', { windowId: session.window.id, pid: session.window.pid, bounds: targetBounds, restored: false, inputSent: false });
    return this.status();
  }

  detach(reason = 'user') {
    return this.enqueue(() => this.detachNow(reason));
  }

  async detachNow(reason = 'user') {
    const session = this.session;
    this.session = null;
    if (!session) return this.status();
    try {
      const restore = session.restore || {};
      await this.invoke([
        '-Mode', 'detach', '-WindowId', String(session.window.id), '-ExpectedPid', String(session.window.pid),
        '-RestoreStyle', String(restore.style ?? 0), '-RestoreExStyle', String(restore.exStyle ?? 0),
        '-RestoreOwner', String(restore.owner || '0x0'), '-Left', String(restore.left ?? session.window.left ?? 0),
        '-Top', String(restore.top ?? session.window.top ?? 0), '-Width', String(restore.width ?? session.window.width ?? 800),
        '-Height', String(restore.height ?? session.window.height ?? 600), ...(session.window.fixture === true ? ['-AllowFixture'] : []),
      ]);
      this.audit('detached', { windowId: session.window.id, pid: session.window.pid, reason, restored: true, inputSent: false });
      return { ...this.status(), restored: true, reason };
    } catch (error) {
      this.audit('detach-failed', { windowId: session.window.id, pid: session.window.pid, reason, error: String(error.message || error), inputSent: false });
      throw error;
    }
  }
}

module.exports = { CodesysNativeHost, normalizeBounds, windowHandleHex };
