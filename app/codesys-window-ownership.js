'use strict';

function normalizedPid(value) {
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}

function normalizedWindowId(value) {
  const text = String(value || '').trim();
  return text ? text.toUpperCase() : '';
}

function windowArea(item) {
  return Math.max(0, Number(item?.width) || 0) * Math.max(0, Number(item?.height) || 0);
}

function looksLikeCodesysMainWindow(item) {
  return item?.fixture === true || /codesys/i.test(String(item?.title || ''));
}

function claimedWindowPhase(item, reason) {
  if (item?.fixture === true) return 'main';
  const title = String(item?.title || '').trim();
  const launchSized = Number(item?.width) < 900 && Number(item?.height) < 600;
  const genericLaunchTitle = /^codesys(?:\s|$)/i.test(title) && !/[-–—]/.test(title);
  return reason === 'launch-hwnd' && launchSized && genericLaunchTitle ? 'launch' : 'main';
}

class CodesysWindowOwnership {
  constructor(options = {}) {
    this.allowFixtures = options.allowFixtures === true;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    // A full CODESYS installation can keep its splash HWND alive for several
    // minutes while packages and the last project are loaded. Keep discovery
    // open long enough for that same launched PID to publish its real IDE
    // HWND; the baseline HWND exclusion still prevents claiming a window that
    // existed before the user pressed "Open CODESYS".
    this.discoveryWindowMs = Math.max(1000, Number(options.discoveryWindowMs) || 15 * 60 * 1000);
    this.settleWindowMs = Math.max(500, Number(options.settleWindowMs) || 8000);
    this.launchedPids = new Map();
  }

  registrationView(registration) {
    return {
      pid: registration.pid,
      registeredAt: registration.registeredAt,
      profile: registration.profile,
      state: registration.frozen ? 'frozen' : 'discovering',
      ownedWindowIds: [...registration.windowIds],
      excludedWindowIds: [...registration.excludedWindowIds],
      discoveryUntil: new Date(registration.discoveryUntilMs).toISOString(),
      windowTransitions: registration.windowTransitions,
    };
  }

  registerPid(value, metadata = {}) {
    const pid = normalizedPid(value);
    if (!pid) throw Object.assign(new Error('CODESYS 启动后未返回可登记的进程 PID'), { code: 'CODESYS_LAUNCH_PID_INVALID' });
    const registeredAtMs = this.now();
    const registration = {
      pid,
      registeredAt: new Date(registeredAtMs).toISOString(),
      registeredAtMs,
      profile: String(metadata.profile || ''),
      discoveryUntilMs: registeredAtMs + this.discoveryWindowMs,
      excludedWindowIds: new Set((metadata.baselineWindowIds || []).map(normalizedWindowId).filter(Boolean)),
      retiredWindowIds: new Set(),
      windowIds: new Set(),
      windowPhases: new Map(),
      firstClaimAtMs: 0,
      lastClaimAtMs: 0,
      windowTransitions: 0,
      frozen: false,
    };
    this.launchedPids.set(pid, registration);
    return this.registrationView(registration);
  }

  claimWindow(registration, item, reason) {
    const id = normalizedWindowId(item?.id);
    if (!id || registration.windowIds.has(id)) return false;
    registration.windowIds.add(id);
    registration.windowPhases.set(id, claimedWindowPhase(item, reason));
    const claimedAt = this.now();
    if (!registration.firstClaimAtMs) registration.firstClaimAtMs = claimedAt;
    else registration.windowTransitions += 1;
    registration.lastClaimAtMs = claimedAt;
    registration.lastClaimReason = reason;
    return true;
  }

  observeWindows(items) {
    const windows = Array.isArray(items) ? items : [];
    const now = this.now();
    for (const registration of this.launchedPids.values()) {
      const candidates = windows.filter((item) => normalizedPid(item?.pid) === registration.pid && normalizedWindowId(item?.id));
      const liveIds = new Set(candidates.map((item) => normalizedWindowId(item.id)));
      for (const id of [...registration.windowIds]) {
        // Native hosting hides the CODESYS HWND when switching back to the
        // conversation. The monitor enumerates visible windows only, so an
        // absent id after discovery is not proof that the HWND was destroyed.
        // Retain settled ownership and recognize the same window on resume.
        if (!liveIds.has(id) && !registration.frozen) {
          registration.windowIds.delete(id);
          registration.retiredWindowIds.add(id);
        }
      }
      const claimable = candidates.filter((item) => {
        const id = normalizedWindowId(item.id);
        return item.usable !== false
          && looksLikeCodesysMainWindow(item)
          && !registration.windowIds.has(id)
          && !registration.excludedWindowIds.has(id)
          && !registration.retiredWindowIds.has(id);
      });
      const liveOwned = candidates.filter((item) => registration.windowIds.has(normalizedWindowId(item.id)));
      // Some CODESYS builds reuse the splash HWND and resize it into the main
      // IDE instead of creating a replacement HWND. Promote that owned handle
      // as soon as it reaches a normal workbench size.
      for (const item of liveOwned) {
        const id = normalizedWindowId(item.id);
        if (registration.windowPhases.get(id) === 'launch'
          && Number(item.width) >= 900 && Number(item.height) >= 600) {
          registration.windowPhases.set(id, 'main');
          registration.lastClaimAtMs = now;
          registration.lastClaimReason = 'launch-hwnd-promoted-to-main';
        }
      }
      // A CODESYS IDE can replace its top-level HWND long after the initial
      // discovery window (package reloads, shell restarts, or a delayed IDE
      // restore). The PID is still the launch-owned identity, so reclaim a
      // new HWND even after the registration was frozen; this prevents the
      // workbench from later reporting "尚未打开程序" forever.
      if (!liveOwned.length && claimable.length) {
        const initialOrReplacement = [...claimable].sort((left, right) => windowArea(right) - windowArea(left))[0];
        this.claimWindow(registration, initialOrReplacement, registration.firstClaimAtMs ? 'same-pid-hwnd-replacement-after-freeze' : 'launch-hwnd');
      } else if (!registration.frozen && now <= registration.discoveryUntilMs && liveOwned.length && claimable.length) {
          const largestOwnedArea = Math.max(...liveOwned.map(windowArea));
          const upgrade = [...claimable]
            .filter((item) => windowArea(item) > largestOwnedArea * 1.15)
            .sort((left, right) => windowArea(right) - windowArea(left))[0];
          if (upgrade) this.claimWindow(registration, upgrade, 'larger-main-hwnd-replacement');
        }
 
      const ownedAfterClaim = candidates.filter((item) => registration.windowIds.has(normalizedWindowId(item.id)));
      const hasLoadedSize = ownedAfterClaim.some((item) => {
        const id = normalizedWindowId(item.id);
        return registration.windowPhases.get(id) === 'main'
          && Number(item.width) >= 900 && Number(item.height) >= 600;
      });
      if (now > registration.discoveryUntilMs
        || (hasLoadedSize && registration.lastClaimAtMs && now - registration.lastClaimAtMs >= this.settleWindowMs)) {
        registration.frozen = true;
      }
    }
  }

  ownsWindow(item) {
    if (!item || typeof item !== 'object') return false;
    if (this.allowFixtures && item.fixture === true) return true;
    const registration = this.launchedPids.get(normalizedPid(item.pid));
    return Boolean(registration?.windowIds.has(normalizedWindowId(item.id)));
  }

  // T199：窗口句柄不是稳定的身份，**启动它的 PID 才是**。
  //
  // 现场（2026-10-08）：CODESYS 是从面板启动的（`registerPid` 已登记），但它在启动过程中销毁并
  // 重建了自己的顶层窗口 —— 审计逐字可查 `native-host-window-lost reason=hwnd-destroyed
  // replacementId=0x1304AC` + `native-host-window-replaced`（0x1204AC → 0x1304AC，启动后 71 s，
  // 与 10-04/10-05 每一次会话同一形态）。面板的下拉框只在刷新时才重新枚举，于是它手里那个
  // 旧句柄成了"最后一次见过的窗口"，而 `resolveWindow` 只按句柄精确匹配 → 拒绝。
  //
  // 判据与 T194 的 `codesysReviveOwnedPids`（main.js）**同一份**：本次运行登记过的 PID，加上
  // 上一次运行写进 `logs/codesys-launched.json`、还没走完清理的 PID。用户自己开的 CODESYS
  // 永远不在这两个集合里，所以外部窗口依旧绑不上 —— 安全意图不放大。
  ownsPid(value, extraPids = []) {
    const pid = normalizedPid(value);
    if (!pid) return false;
    if (this.launchedPids.has(pid)) return true;
    return (Array.isArray(extraPids) ? extraPids : []).some((item) => normalizedPid(item) === pid);
  }

  // 这个窗口属于哪个"本插件启动的 PID"？问这个问题时记住的句柄往往**已经不存在**了，所以先
  // 从登记里**记得的**句柄（含已退役的）回查 PID；回查不到才用调用方随请求带来的 PID，且那
  // 个 PID 必须自己就属于本插件（登记过 / 上一轮记录过）。任意外部 PID 在这里永远答不出来。
  ownedPidForWindow(windowId, requestedPid = 0, extraPids = []) {
    const id = normalizedWindowId(windowId);
    if (id) {
      for (const registration of this.launchedPids.values()) {
        if (registration.windowIds.has(id) || registration.retiredWindowIds.has(id)) return registration.pid;
      }
    }
    const pid = normalizedPid(requestedPid);
    if (!pid) return 0;
    if (this.launchedPids.has(pid)) return pid;
    return (Array.isArray(extraPids) ? extraPids : []).some((item) => normalizedPid(item) === pid) ? pid : 0;
  }

  // 选出该 PID **现在**的顶层窗口（句柄换了就用新的那个）。与 `primaryWindow` 同一条选择规则，
  // 唯一的差别是不经过 `ownsWindow` 过滤：上一轮运行记录下来的 PID 这一轮没有登记可查，而
  // "它是不是本插件的进程"已经由 `ownedPidForWindow` 判过，这里只负责挑窗口。
  windowForOwnedPid(items, pid, preferredWindowId = '') {
    const expected = normalizedPid(pid);
    if (!expected) return null;
    const candidates = (Array.isArray(items) ? items : [])
      .filter((item) => normalizedPid(item?.pid) === expected && item?.usable !== false);
    if (!candidates.length) return null;
    const current = candidates.find((item) => normalizedWindowId(item.id) === normalizedWindowId(preferredWindowId)) || null;
    const largest = [...candidates].sort((left, right) => windowArea(right) - windowArea(left))[0];
    if (!current) return largest;
    return windowArea(largest) > windowArea(current) * 1.15 ? largest : current;
  }

  decorate(item) {
    const registration = this.launchedPids.get(normalizedPid(item?.pid));
    const windowPhase = item?.fixture === true ? 'main' : registration?.windowPhases.get(normalizedWindowId(item?.id)) || 'main';
    return { ...item, pluginOwned: true, ownership: item.fixture === true ? 'isolated-smoke-fixture' : 'taskhive-plugin-launch-hwnd', windowPhase };
  }

  filterWindows(items) {
    const windows = Array.isArray(items) ? items : [];
    this.observeWindows(windows);
    return windows.filter((item) => this.ownsWindow(item)).map((item) => this.decorate(item));
  }

  assertWindow(item) {
    if (!this.ownsWindow(item)) {
      throw Object.assign(new Error('该 CODESYS 窗口不是由当前 TaskHive 插件本次启动并领取，已拒绝访问'), {
        code: 'CODESYS_WINDOW_NOT_PLUGIN_OWNED',
        windowId: String(item?.id || ''),
        pid: normalizedPid(item?.pid) || null,
      });
    }
    return this.decorate(item);
  }

  primaryWindow(items, pid, currentWindowId = '') {
    const expectedPid = normalizedPid(pid);
    const candidates = this.filterWindows(items).filter((item) => normalizedPid(item.pid) === expectedPid && item.usable !== false);
    if (!candidates.length) return null;
    const current = candidates.find((item) => normalizedWindowId(item.id) === normalizedWindowId(currentWindowId)) || null;
    const largest = [...candidates].sort((left, right) => windowArea(right) - windowArea(left))[0];
    if (!current) return largest;
    return windowArea(largest) > windowArea(current) * 1.15 ? largest : current;
  }

  snapshot() {
    return {
      registrations: [...this.launchedPids.values()].map((registration) => this.registrationView(registration)),
      launchedPids: [...this.launchedPids.keys()],
      allowFixtures: this.allowFixtures,
    };
  }
}

module.exports = { CodesysWindowOwnership, normalizedPid, normalizedWindowId, windowArea, looksLikeCodesysMainWindow, claimedWindowPhase };
