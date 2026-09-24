const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { desktopCapturer } = require('electron');
const { bitmapLooksBlack, desktopSourceId, pngDimensions } = require('./codesys-capture-contract');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, 'win-window-monitor.ps1');

function thumbnailLooksBlack(thumbnail) {
  if (!thumbnail || thumbnail.isEmpty()) return true;
  const size = thumbnail.getSize();
  return !size.width || !size.height || bitmapLooksBlack(thumbnail.toBitmap());
}

class CodesysWindowMonitor {
  constructor(root, options = {}) {
    this.root = root;
    this.ownership = options.ownership || null;
    this.captureDir = path.join(root, 'cache', 'screen-vision');
    fs.mkdirSync(this.captureDir, { recursive: true });
    this.streams = new Map();
    this.windowCache = new Map();
    this.windowCacheAt = 0;
  }

  async invoke(args) {
    const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (stderr && !stdout) throw new Error(stderr.trim());
    return stdout.trim();
  }

  async listRawWindows() {
    const output = await this.invoke(['-Mode', 'list']);
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async listWindows() {
    const enumerated = await this.listRawWindows();
    const windows = this.ownership ? this.ownership.filterWindows(enumerated) : enumerated;
    const identity = new Map(windows.map((item) => [String(item.id), item]));
    // Windows recycles HWND values the moment the owning window is destroyed, so a
    // handle that was CODESYS a moment ago can already belong to an unrelated
    // process. Drop every cached entry whose handle now resolves to a different PID
    // (or to no window at all) instead of keeping it around to be reused.
    for (const [id, cached] of this.windowCache) {
      const current = identity.get(id);
      if (!current || Number(current.pid) !== Number(cached.pid)) this.windowCache.delete(id);
    }
    for (const [id, item] of identity) this.windowCache.set(id, item);
    this.windowCacheAt = Date.now();
    return windows;
  }

  cachedWindow(windowId) {
    const key = String(windowId || '');
    const cached = this.windowCache.get(key) || null;
    // A handle with no recorded owning PID cannot be identity-checked, so it must
    // never be reused: Windows may have recycled it to another process.
    if (cached && !(Number(cached.pid) > 0)) { this.invalidateWindow(key); return null; }
    return cached;
  }

  // Drop a cached window once its handle is known to belong to another process (or
  // to no window at all). Expiring the enumeration timestamp forces the next
  // resolveWindow to re-enumerate instead of reusing a recycled HWND.
  invalidateWindow(windowId) {
    const key = String(windowId || '');
    const dropped = this.windowCache.get(key) || null;
    if (dropped) this.windowCache.delete(key);
    this.windowCacheAt = 0;
    return dropped;
  }

  async resolveWindow(windowId) {
    const cached = this.cachedWindow(windowId);
    if (cached && Date.now() - this.windowCacheAt < 5000) return cached;
    return (await this.listWindows()).find((item) => String(item.id) === String(windowId)) || null;
  }

  async resolveDesktopSource(windowId) {
    if (!windowId) throw new Error('缺少窗口 ID');
    const target = await this.resolveWindow(windowId);
    if (!target || target.usable === false) throw new Error('CODESYS window is unavailable or minimized');
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      // Source resolution does not need a bitmap. Avoiding a thumbnail makes this
      // one-time lookup cheap and leaves all subsequent frames on Chromium's
      // persistent desktop media pipeline.
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    const expectedSourceId = desktopSourceId(target.id);
    // CODESYS commonly gives every instance the same title. A title fallback
    // can therefore bind a newly launched PID to an older, overlapping HWND.
    // The HWND-derived Chromium source ID is the only unambiguous identity.
    const enumeratedSource = sources.find((item) => item.id === expectedSourceId);
    // Chromium occasionally omits an otherwise valid visible HWND from a
    // single getSources result. The Windows window contract has already
    // validated the HWND/process/title; getUserMedia remains the final source
    // validity check, so a deterministic window source ID is a safe fallback.
    const source = enumeratedSource || { id: expectedSourceId, name: target.title };
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceEnumerated: Boolean(enumeratedSource),
      expectedSourceId,
      windowId: String(target.id),
      title: target.title,
      processName: target.processName,
      pid: target.pid,
      width: Number(target.width) || 0,
      height: Number(target.height) || 0,
      state: 'ready',
      resolvedAt: new Date().toISOString(),
    };
  }

  async fitWindowToCanvas(windowId, options = {}) {
    const target = await this.resolveWindow(windowId);
    if (!target) throw Object.assign(new Error('CODESYS window is unavailable or not opened by this plugin'), { code: 'CODESYS_WINDOW_FIT_TARGET_INVALID' });
    this.ownership?.assertWindow(target);
    const canvasWidth = Math.round(Number(options.canvasWidth));
    const canvasHeight = Math.round(Number(options.canvasHeight));
    if (canvasWidth < 320 || canvasHeight < 200) throw Object.assign(new Error('CODESYS 插件画布尺寸不足'), { code: 'CODESYS_WINDOW_FIT_CANVAS_INVALID' });
    const output = await this.invoke([
      '-Mode', 'fit', '-WindowId', String(target.id), '-ExpectedPid', String(target.pid),
      '-CanvasWidth', String(canvasWidth), '-CanvasHeight', String(canvasHeight),
      ...(target.windowPhase === 'launch' ? ['-PreserveSize'] : []),
      ...(target.fixture !== true ? ['-HideTaskbar'] : []),
      ...(target.fixture === true ? ['-AllowFixture'] : []),
    ]);
    const fitted = JSON.parse(output);
    this.windowCacheAt = 0;
    return { ...fitted, pluginOwned: true, ownership: target.ownership, windowPhase: target.windowPhase || 'main', sourceWindowId: String(target.id) };
  }

  async captureNative(target, options = {}, reason = 'chromium-frame-unavailable') {
    const persist = options.persist !== false;
    // The PID always comes from the window record that enumeration validated, never
    // from an unvalidated caller string: PowerShell re-checks it so a recycled HWND
    // can never be captured and shipped to the AI as "the CODESYS screen".
    const expectedPid = Number(target?.pid);
    if (!(expectedPid > 0)) throw Object.assign(new Error('CODESYS window identity is unavailable'), { code: 'CODESYS_WINDOW_IDENTITY_INVALID' });
    const file = path.join(this.captureDir, `codesys-native-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`);
    try {
      await this.invoke([
        '-Mode', 'capture', '-WindowId', String(target.id), '-ExpectedPid', String(expectedPid), '-OutputPath', file,
        ...(target.fixture === true ? ['-AllowFixture'] : []),
      ]);
    } catch (error) {
      // An identity failure proves this cached handle is no longer the window it was
      // enumerated as (exited process or recycled HWND), so drop it from the cache.
      if (/PID identity changed|verified CODESYS processes|window process is unavailable|window handle is invalid/i.test(String(error?.message || ''))) {
        this.invalidateWindow(target.id);
      }
      throw error;
    }
    const buffer = fs.readFileSync(file);
    const size = pngDimensions(buffer);
    if (!size) throw new Error('Windows HWND capture did not return a valid PNG frame');
    if (!persist) {
      try { fs.unlinkSync(file); } catch { /* diagnostic cache cleanup is best effort */ }
    }
    return {
      path: persist ? file : null,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      capturedAt: new Date().toISOString(),
      width: size.width,
      height: size.height,
      completeFrame: size.width >= 320 && size.height >= 200,
      captureTransport: 'windows-printwindow',
      captureFallbackReason: reason,
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    };
  }

  async capture(windowId, options = {}) {
    const captureStartedAt = Date.now();
    if (!windowId) throw new Error('缺少窗口 ID');
    const target = await this.resolveWindow(windowId);
    if (!target || target.usable === false) throw new Error('CODESYS window is unavailable or minimized');
    if (options.forceNative === true) return this.captureNative(target, options, 'real-codesys-native-stream');
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: Math.max(320, Number(target.width) || 1280), height: Math.max(200, Number(target.height) || 720) },
      fetchWindowIcons: false,
    });
    const source = sources.find((item) => item.id === desktopSourceId(target.id));
    if (!source || source.thumbnail.isEmpty()) return this.captureNative(target, options, 'chromium-source-unavailable');
    if (thumbnailLooksBlack(source.thumbnail)) return this.captureNative(target, options, 'chromium-frame-black');
    const size = source.thumbnail.getSize();
    const persist = options.persist !== false;
    const buffer = persist ? source.thumbnail.toPNG() : source.thumbnail.toJPEG(82);
    const width = size.width;
    const height = size.height;
    let file = null;
    if (persist) {
      file = path.join(this.captureDir, `codesys-${Date.now()}.png`);
      fs.writeFileSync(file, buffer);
    }
    return {
      path: file,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      capturedAt: new Date().toISOString(),
      width,
      height,
      completeFrame: width >= 320 && height >= 200,
      captureTransport: 'electron-desktop-capturer',
      captureDurationMs: Date.now() - captureStartedAt,
      dataUrl: `data:image/${persist ? 'png' : 'jpeg'};base64,${buffer.toString('base64')}`,
    };
  }

  async startStream(windowId, options = {}, onFrame) {
    if (!windowId) throw new Error('缺少窗口 ID');
    const initialTarget = await this.resolveWindow(windowId);
    if (!initialTarget || initialTarget.usable === false) throw Object.assign(new Error('CODESYS window is unavailable, minimized, or not opened by this plugin'), { code: 'CODESYS_STREAM_TARGET_INVALID' });
    this.stopStream(windowId);
    const intervalMs = Math.max(80, Math.min(2000, Number(options.intervalMs) || 125));
    const stream = { key: String(windowId), windowId: String(windowId), target: initialTarget, selector: { title: initialTarget.title || null, processName: initialTarget.processName || 'CODESYS', pid: Number(initialTarget.pid) || null, followPidUntil: options.followPid === true ? Date.now() + 60000 : 0 }, intervalMs, busy: false, frames: 0, droppedFrames: 0, completeFrames: 0, reconnects: 0, windowTransitions: 0, lastFollowCheckAt: 0, startedAt: Date.now(), timer: null, connected: true, lastFrameAt: null, lastError: null };
    const tick = async () => {
      const tickStartedAt = Date.now();
      if (stream.busy) { stream.droppedFrames += 1; return; }
      stream.busy = true;
      try {
        if (stream.selector.followPidUntil > Date.now() && Date.now() - stream.lastFollowCheckAt >= 900 && stream.selector.pid) {
          stream.lastFollowCheckAt = Date.now();
          const candidates = await this.listWindows();
          const primary = this.ownership?.primaryWindow(candidates, stream.selector.pid, stream.windowId)
            || candidates.find((item) => item.usable !== false && Number(item.pid) === Number(stream.selector.pid) && String(item.id) === String(stream.windowId));
          if (primary) {
            stream.target = primary;
            if (String(primary.id) !== String(stream.windowId)) {
              stream.windowId = String(primary.id);
              stream.windowTransitions += 1;
            }
          }
        }
        const frame = await this.capture(stream.windowId, { persist: false, forceNative: options.forceNative === true });
        if (frame.completeFrame === false) throw new Error(`incomplete-frame:${frame.width || 0}x${frame.height || 0}`);
        stream.frames += 1;
        if (frame.completeFrame === true) stream.completeFrames += 1;
        stream.connected = true;
        stream.lastError = null;
        stream.lastFrameAt = Date.now();
        onFrame?.({ ...frame, stream: { windowId: stream.windowId, target: stream.target, frames: stream.frames, completeFrames: stream.completeFrames, droppedFrames: stream.droppedFrames, reconnects: stream.reconnects, windowTransitions: stream.windowTransitions, fps: stream.frames / Math.max(1, (Date.now() - stream.startedAt) / 1000), connected: true, latencyMs: Math.max(0, Date.now() - tickStartedAt), captureDurationMs: frame.captureDurationMs, lastFrameAt: frame.capturedAt } });
      } catch (error) {
        stream.connected = false;
        stream.lastError = error.message;
        let reconnected = false;
        try {
          const candidates = await this.listWindows();
          const found = stream.selector.pid
            ? (this.ownership?.primaryWindow(candidates, stream.selector.pid, stream.windowId) || candidates.find((item) => item.usable !== false && Number(item.pid) === Number(stream.selector.pid)))
            : candidates.find((item) => item.usable !== false && ((stream.selector.title && item.title === stream.selector.title) || item.processName === stream.selector.processName));
          if (found) { stream.windowId = String(found.id); stream.target = found; reconnected = true; stream.reconnects += 1; stream.connected = true; }
        } catch { /* keep disconnected state */ }
        onFrame?.({ stream: { windowId: stream.windowId, target: stream.target, error: error.message, connected: stream.connected, reconnected, reconnects: stream.reconnects, windowTransitions: stream.windowTransitions, frames: stream.frames, completeFrames: stream.completeFrames, droppedFrames: stream.droppedFrames, lastFrameAt: stream.lastFrameAt ? new Date(stream.lastFrameAt).toISOString() : null } });
      } finally {
        stream.busy = false;
        if (this.streams.get(stream.key) === stream) stream.timer = setTimeout(() => void tick(), Math.max(0, intervalMs - (Date.now() - tickStartedAt)));
      }
    };
    this.streams.set(String(windowId), stream);
    await tick();
    return { windowId: stream.windowId, intervalMs, state: 'streaming', connected: stream.connected, frames: stream.frames, completeFrames: stream.completeFrames, droppedFrames: stream.droppedFrames, reconnects: stream.reconnects };
  }

  stopStream(windowId) {
    const key = String(windowId || '');
    const stream = this.streams.get(key) || [...this.streams.values()].find((candidate) => candidate.windowId === key || candidate.key === key);
    if (!stream) return { windowId: key, state: 'idle' };
    clearTimeout(stream.timer);
    this.streams.delete(stream.key);
    return { windowId: stream.windowId, state: 'stopped', frames: stream.frames, completeFrames: stream.completeFrames, droppedFrames: stream.droppedFrames, reconnects: stream.reconnects, lastError: stream.lastError };
  }

  stopAll() { for (const key of this.streams.keys()) this.stopStream(key); }
}

module.exports = { CodesysWindowMonitor };
