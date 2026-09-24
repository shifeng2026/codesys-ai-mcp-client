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
