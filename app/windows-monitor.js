const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { desktopCapturer } = require('electron');
const { desktopSourceId } = require('./codesys-capture-contract');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, 'win-window-monitor.ps1');

// 用户的删除要求（2026-10）：去掉"AI 实时监视"能力。本模块过去同时承担**窗口枚举/身份**
// 与**画面捕获/实时流**两件事，现在只保留前者 —— 原生窗口托管（codesys-native-host.js、
// codesys-input.js、codesys-current-project.js）依赖的正是这一半：
//   listRawWindows / listWindows / cachedWindow / invalidateWindow / resolveWindow /
//   resolveDesktopSource / pruneCaptures
// 已删除：fitWindowToCanvas / captureNative / capture / startStream / stopStream / stopAll
// 与 `streams` 状态（连同 `win-window-monitor.ps1` 的 `capture`/`fit` 模式）。
class CodesysWindowMonitor {
  constructor(root, options = {}) {
    this.root = root;
    this.ownership = options.ownership || null;
    this.captureDir = path.join(root, 'cache', 'screen-vision');
    fs.mkdirSync(this.captureDir, { recursive: true });
    // T153：启动时裁一次历史遗留截图（原先这些 PNG 永久累积，每张约 1.6 MB）。
    this.pruneCaptures();
    this.windowCache = new Map();
    this.windowCacheAt = 0;
    this.lastList = null;
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

  async listWindows(options = {}) {
    // T153：允许复用"刚出炉的快照"。CODESYS follow 循环**每秒**调一次本方法，
    // 每次都起一个 PowerShell 进程（实测 662–1034 ms）。允许 ≤4 s 的快照后，
    // 每秒一次变成每 4 秒一次；需要绝对实时的调用方传 `maxAgeMs: 0`（默认）。
    const maxAgeMs = Number(options.maxAgeMs) || 0;
    if (maxAgeMs > 0 && this.lastList && Date.now() - this.lastList.at <= maxAgeMs) return this.lastList.windows;
    const enumerated = await this.listRawWindows();
    const owned = this.ownership ? this.ownership.filterWindows(enumerated) : enumerated;
    // T137：面板必须能看到**用户自己启动的** CODESYS。此前这里只返回本插件启动的窗口，
    // 于是外部启动的 CODESYS（典型：停在「选择配置文件」对话框、尺寸 394×127）被整条丢弃，
    // 面板只能显示"尚未发现由本插件打开的 CODESYS 窗口" —— 用户看到的就是"显示不对"。
    // 外部窗口带 `owned:false` 交给界面标注；`usable:false` + `reason` 已能表达
    // "尺寸过小/最小化"，界面据此显示「等待恢复」。
    const ownedIds = new Set(owned.map((item) => String(item.id)));
    const windows = owned.map((item) => ({ ...item, owned: true }))
      .concat(enumerated.filter((item) => !ownedIds.has(String(item.id))).map((item) => ({ ...item, owned: false })));
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
    this.lastList = { at: this.windowCacheAt, windows };
    return windows;
  }

  // T153：截图缓存原先**永不裁剪**（每张约 1.6 MB，持久化路径默认开启）。
  // 保留最近 20 张 / 7 天，其余删除。监视能力删除后这里只清理历史遗留文件。
  pruneCaptures(keep = 20, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    try {
      const files = fs.readdirSync(this.captureDir)
        .filter((name) => name.endsWith('.png'))
        .map((name) => {
          const full = path.join(this.captureDir, name);
          let at = 0;
          try { at = fs.statSync(full).mtimeMs; } catch { /* skip */ }
          return { full, at };
        })
        .sort((left, right) => right.at - left.at);
      const now = Date.now();
      for (const entry of files.slice(keep)) {
        if (now - entry.at < maxAgeMs && files.length <= keep * 2) continue;
        try { fs.rmSync(entry.full, { force: true }); } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
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

  // T199：工作台绑定唯一采用的是**这个方法**，不是 `resolveWindow`。
  //
  // `resolveWindow` 回答的是"这个句柄现在在不在可见枚举里"，而那不是稳定身份：CODESYS 启动时
  // 会销毁并重建自己的顶层窗口（实测 `0x1204AC → 0x1304AC`，启动后 71 s，见审计
  // `native-host-window-replaced`），而面板的下拉框只在刷新时重新枚举 —— 它手里可能还握着
  // 已销毁的旧句柄。此时旧代码给出的是"这个窗口不是本插件打开的"，而事实恰好相反：本插件
  // 启动了那个进程，只是它的句柄换了。用户看到的就是"面板明明检测到并绑定成功，点代码任务
  // 却被拒"。
  //
  // 稳定的身份是**本插件启动的 PID**（与原生托管看门狗 T188 同一条判据）。所以：记住的句柄
  // 解析不出窗口时，改用它所属 PID 的**当前**顶层窗口，而不是拒绝。人口一点没放大 —— 只有
  // 本插件启动过的 PID（本次登记或上一轮 `codesys-launched.json` 记录）能答出来。
  //
  // T208 之后，"外部启动的 CODESYS 依旧绑不上"这句话要加一个**唯一的**例外：调用方显式传入
  // `options.explicitSelection`（用户真的点选过的那个窗口，见下面的判据）。不传的调用方 ——
  // 也就是本仓其余所有调用点 —— 看到的判据与 T199 逐字相同。
  async resolveOwnedWindow(windowId, requestedPid = 0, options = {}) {
    const wanted = String(windowId || '');
    const windows = await this.listWindows();
    const exact = windows.find((item) => String(item.id) === wanted) || null;
    // 精确命中**且归属成立**才算数：`listWindows` 为了面板下拉会把外部窗口也带回来
    // （T137，`owned:false`），所以这里必须显式过一遍 `ownsWindow`。
    if (exact && (!this.ownership || this.ownership.ownsWindow(exact))) return exact;
    // T208：**唯一**一条能把"外部启动"的窗口交给工作台的额外授权，而且只能由调用方
    // **显式传入**一个形状严格的凭据：
    //
    //     options.explicitSelection = { windowId, source: 'user-selection', automatic: false }
    //
    // 由"用户真的在下拉里点过一下"这件事产生 —— 主进程自己记着那条选择（`main.js` 的
    // `codesysExplicitWindowSelection`），并**只**从那条记录里构造凭据；请求体里的任何
    // 同名字段都不参与，所以渲染层伪造不出来。这里的四条判据缺一不可：
    //   * `automatic === false`  —— 自动路径（进面、刷新、跟随本插件启动的进程、自愈）永远不带；
    //   * `source === 'user-selection'` —— 换个来源（例如某个"内部调用"）一律不算；
    //   * `windowId` 与本次请求的句柄**逐字相同** —— 拿别的窗口（含"我曾经选过的那一个"）的
    //     凭据来指另一个句柄，不算数；
    //   * `exact` 必须仍然命中**这一次**枚举，且 `owned === false` —— 窗口被关掉、句柄被回收、
    //     或它根本不是外部启动的窗口时，凭据作废。
    // 形状不合法就当没传，继续往下走归属判定（也就是拒绝）。**默认行为一个字没松**：不传
    // `explicitSelection` 的调用方依旧只认"本插件启动过的 PID"。
    const explicit = options.explicitSelection;
    if (exact && exact.owned === false && explicit
      && explicit.automatic === false && explicit.source === 'user-selection'
      && String(explicit.windowId || '') === wanted) return exact;
    if (!this.ownership) return exact;
    const pid = this.ownership.ownedPidForWindow(wanted, requestedPid, options.launchedPids);
    if (!pid) return null;
    const preferred = String(options.preferredWindowId || '');
    return this.ownership.primaryWindow(windows, pid, preferred)
      || this.ownership.windowForOwnedPid(windows, pid, preferred);
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
}

module.exports = { CodesysWindowMonitor };
