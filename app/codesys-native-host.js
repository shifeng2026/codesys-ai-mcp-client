const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
// T153：审计日志走带轮转的实现（原先裸 appendFileSync，且每次调用都做一次 mkdirSync）。
const { appendDiagnosticLog } = require('./diagnostic-log');
// T194：脱管/挂起的会话记录必须**跨进程**活着（见 revivePluginOwnedHiddenWindows 的说明），
// 所以复用受管文件的原子写（临时文件 + fsync + rename，并保留一代 .bak）。
const { readJson, writeJson } = require('./atomic-json');
// T194：窗口身份判据与"是不是 CODESYS 主窗口"的口径必须和窗口所有权类**同一份**，
// 否则自愈扫描会认领所有权类根本不会认领的窗口（例如 CODESYS 的隐藏辅助窗口）。
const { looksLikeCodesysMainWindow } = require('./codesys-window-ownership');

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(__dirname, 'win-window-host.ps1');
// T194：可见性过滤的枚举（win-window-monitor.ps1 -Mode list）永远看不到被 SW_HIDE 的窗口，
// 所以自愈扫描走**同一个脚本**的 -IncludeHidden 分支（只对调用方给的 PID 开放）。
const MONITOR_SCRIPT = path.join(__dirname, 'win-window-monitor.ps1');

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

// T162：请求的矩形 vs 脚本**回读**的实际矩形，返回最大偏差（px）。
// 取不到实际值时返回 0（不误报）。用于把"静默贴错位置"变成可统计的事实：
// 最大化窗口会让 SetWindowPos 只改还原矩形，DPI 混算会让尺寸整体差一个缩放比。
function geometryMismatch(requested, actual, tolerance = 4) {
  if (!requested || !actual) return 0;
  const delta = Math.max(
    Math.abs(Number(actual.x) - Number(requested.x)),
    Math.abs(Number(actual.y) - Number(requested.y)),
    Math.abs(Number(actual.width) - Number(requested.width)),
    Math.abs(Number(actual.height) - Number(requested.height)),
  );
  return Number.isFinite(delta) && delta > tolerance ? Math.round(delta) : 0;
}

// T187：脚本会回报它实际拿到的 DPI 感知级别。**只有 2（per-monitor-v2）**才是
// `GetWindowRect`/`SetWindowPos` 说**物理像素**的模式 —— 也就是 main.js 经
// `screen.dipToScreenRect` 送过来的那个单位（实测：同一请求 432,116,1476x1402
// 在修复前落到物理 648,174,2214x1631，正好 1.5x 且右下偏移，跑到屏幕外）。
// 0/1 时脚本滞留在被虚拟化的 96-DPI 空间：系统按缩放比重放请求，脚本回读时又除回去，
// 于是 `geometryMismatch` **看不到**这次错位（x/y/宽完全"相等"，只有高度撞上该空间的
// SM_CYMAXTRACK=1087 才露出来 → 那条 maxDelta=315）。这是真失败，不是噪声，所以给它
// 独立的审计事件，而不是继续以 ok=true 静默通过。
function dpiCoordinateSpace(result) {
  const awareness = Number(result && result.dpiAwareness);
  return Number.isFinite(awareness) && awareness >= 2 ? 'physical' : 'virtualized';
}

// T188：**托管窗口的存活看门狗** —— 直接来自用户真机运行证据（2026-10-04 17:29，pid 29248）。
//
// 那次 `attach` 是成功的：审计记着 `coordinateSpace: "physical"`、`placementDelta: 0`、
// `bounds {764,275,1402x1084}`。但随后 CODESYS **替换掉了自己的顶层 HWND** —— 被托管句柄
// `0x1C0D32` 已不存在，同一 pid 的 CODESYS 窗口变成 `0x3C0C90`（仍是带 WS_CAPTION 的普通
// 顶层窗口），而审计里**只有 `attached`、一次 `detach` 都没有**。于是 `status().attached`
// 一直保持 true：插件面板里只剩下 DOM 占位符「真实 CODESYS 原生窗口」，真实窗口是面板之外
// 的另一个窗口 —— 用户看到的就是「托管窗口不在插件面板里面」。
//
// 旧实现只在 `updateNow` 里才发现身份变化，而 `updateNow` 必须有一次 move 被调度；窗口被
// 销毁本身不会触发 move/resize/surface:geometry，所以这个状态可以**永远静默**保持。
//
// 看门狗只做两件事，且都要留下审计：把「托管窗口已消失」变成一条事实，并**自动接管同一
// pid 的新主窗口**（CODESYS 在启动/包重载后重建顶层窗口是常态）；找不到可接管窗口时**退掉
// session**，让 `attached` 变成 false —— 可见的退化，而不是继续假报已托管。
const WATCHDOG_INTERVAL_MS = 5000;
const MAX_WINDOW_RECOVERIES = 3;

// T192：把 `-ReloadProject` 的**事实**翻成一行可读原因。失败一律可见、能落到界面上一句话里，
// 不允许出现"点了没反应"。三种结果各自对应一句不同的话（原因不同，下一步也不同）。
function reloadProjectDetail(result) {
  const value = result && typeof result === 'object' ? result : {};
  if (value.invoked === true) {
    return `已把「${String(value.caption || '重新加载')}」命令发给 CODESYS（菜单项 id ${Number(value.commandId || 0)}）。`;
  }
  const reason = String(value.reason || '');
  const scanned = Number(value.scanned || 0);
  const menus = String(value.topLevelMenus || '').split('|').filter(Boolean).join(' / ');
  if (reason === 'no-native-menubar') {
    return 'CODESYS 的菜单栏不是 Win32 原生菜单（GetMenu 返回空），所以无法在不展开菜单、不抢焦点的前提下枚举重载项。请在 CODESYS 里「文件 → 关闭工程」（弹「是否保存」选“不保存”）再「文件 → 打开工程」选同一份 .project。';
  }
  if (reason === 'no-reload-command') {
    return `CODESYS 的菜单里没有「重新加载工程」这一项（已扫过 ${scanned} 项${menus ? `，顶级菜单：${menus}` : ''}）。请在 CODESYS 里「文件 → 关闭工程」（弹「是否保存」选“不保存”）再「文件 → 打开工程」选同一份 .project。`;
  }
  return `没有可用的重载入口（${reason || 'unknown'}）。请在 CODESYS 里「文件 → 关闭工程」（弹「是否保存」选“不保存”）再「文件 → 打开工程」选同一份 .project。`;
}

function isCodesysLikeWindow(item) {
  if (/^codesys/i.test(String(item?.processName || ''))) return true;
  return item?.fixture === true && process.env.TASKHIVE_CODESYS_TEST_FIXTURE === '1';
}

// ── T194：被隐藏但还活着的插件所属 CODESYS 窗口的自愈 ─────────────────────────────
//
// 为什么需要它（真机证据 2026-10-04，本机）：`hidePluginSurface()` → `suspend('surface-hidden')`
// → `ShowWindowAsync(SW_HIDE)`。SW_HIDE 动的是**窗口自己**的 WS_VISIBLE 位，所以那条
// `{"event":"suspended","windowId":"0x2D709C4","pid":38816}` 之后：
//   · hwnd 仍然存在（rect 288,77,1188x1012 在屏内），但 `win-window-monitor.ps1 -Mode list`
//     只枚举 IsWindowVisible 的窗口 ⇒ 面板枚举、`codesys:current-project` 检测、启动清理
//     三条链**永远看不到它**（清理对它答 `no-window` → keep：既不关，也不显示）；
//   · 它是 WS_EX_TOOLWINDOW 且被隐藏 ⇒ 任务栏与 Alt+Tab 里也没有它；
//   · 而解释这条状态的 `session.suspended` **只在内存里**。
// 于是只要那次挂起没有配套的 resume（进程被杀、崩溃、或 surface 一直没切回来），
// 就再没有任何代码或用户动作能把它拿回来。这个函数补的就是这一半。
//
// 判据从严（**宁可什么都不做**，绝不为了"看起来修好了"去显示不属于插件的窗口）：
//   ① PID 必须是本插件自己启动的（内存 launchedPids 或跨进程 logs/codesys-launched.json），
//      或者这个句柄正是内存 session 自己那一个；
//   ② 进程必须像 CODESYS（脚本侧 `-ExpectedPid` + 进程名复核，两处独立）；
//   ③ 窗口存在但 `WS_VISIBLE=false` —— 只认**样式位**：IsWindowVisible 在"宿主窗口被最小化"
//      时也会变 false（T188 实测），拿它当判据就会去动用户自己最小化的窗口；
//   ④ 不是最小化（IsIconic=false），矩形 ≥320×200，标题符合 CODESYS 主窗口口径
//      （与 codesys-window-ownership 同一份判据，用来排除 CODESYS 的隐藏辅助窗口）；
//   ⑤ 当前 session 处于"surface 主动挂起"时**排除它自己**（那是预期状态，不是故障）；
//   ⑥ 合规候选不唯一时**放弃**并记原因（不猜）。
// 恢复动作 = `ShowWindowAsync(SW_SHOWNA)` + `SetWindowPos(SWP_NOACTIVATE|SWP_SHOWWINDOW)`，
// 与既有 `-Mode resume` 同一套：不抢焦点、不改样式/owner、不发明几何（用窗口自己的矩形）。
const WS_VISIBLE = 0x10000000;
const MIN_REVIVE_WIDTH = 320;
const MIN_REVIVE_HEIGHT = 200;
// 幂等护栏：ShowWindowAsync 是异步投递的，紧接着的第二次扫描可能仍读到旧的样式位。
// 同一窗口在这个窗口期内不再重复发 ShowWindow（审计记 `recently-revived`）。
const REVIVE_REPEAT_GUARD_MS = 30000;
// 检测链上的扫描每次要起一个 PowerShell 枚举（实测 600–1000ms），所以按节流跑：
// 启动那次 force；检测/attach 那次最多每 30 秒一次（节流不写审计，状态在 status().revive 里）。
const REVIVE_THROTTLE_MS = 30000;
// T194 第 3 项：resume→suspend 抖动窗口。真机审计：17:30:21.916 resumed → 17:30:22.626
// suspended（710ms）、17:31:37.665 → 17:31:38.408（743ms）。
const SUSPEND_FLAP_WINDOW_MS = 1000;
// 逐窗口写 `native-host-revive-skipped` 的原因白名单：只留"值得单独一条"的。数量最多的
// `window-frame-too-small`（一个 CODESYS 进程常年带着若干 0x0 的隐藏辅助窗口）内联在
// `native-host-revive-scan` 一行里，避免把审计写成噪音。
const AUDITED_REVIVE_SKIP_REASONS = new Set(['window-minimized', 'title-not-codesys-main-window']);

function windowStyleVisible(style) {
  return (Number(style) & WS_VISIBLE) !== 0;
}

// 扫描路径的判据（纯函数，可离线单测）：输入 win-window-monitor.ps1 -IncludeHidden 的一项。
function reviveCandidateDecision(item, options = {}) {
  const allowedPids = options.allowedPids instanceof Set ? options.allowedPids : new Set();
  const excluded = options.excludedWindowIds instanceof Set ? options.excludedWindowIds : new Set();
  const id = String(item?.id || '').toUpperCase();
  if (!id) return { eligible: false, reason: 'no-window-id' };
  if (excluded.has(id)) return { eligible: false, reason: 'session-suspended-by-surface' };
  const pid = Number(item?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { eligible: false, reason: 'no-pid' };
  if (!allowedPids.has(pid)) return { eligible: false, reason: 'not-plugin-launched-pid' };
  if (!isCodesysLikeWindow(item)) return { eligible: false, reason: 'not-codesys-process' };
  if (item.iconic === true) return { eligible: false, reason: 'window-minimized' };
  if (item.styleVisible !== false) return { eligible: false, reason: item.styleVisible === true ? 'style-visible' : 'style-unknown' };
  if (Number(item.width) < MIN_REVIVE_WIDTH || Number(item.height) < MIN_REVIVE_HEIGHT) return { eligible: false, reason: 'window-frame-too-small' };
  if (!looksLikeCodesysMainWindow(item)) return { eligible: false, reason: 'title-not-codesys-main-window' };
  return { eligible: true, reason: '' };
}

// 会话记录路径的判据（纯函数）：这里不需要枚举，身份是**我们自己写下的那个句柄**，
// 再被 `-Probe` 复核一次（存在 / 同 pid / 样式位 / 是否最小化 / 矩形）。
function reviveProbeDecision(probe, options = {}) {
  if (!probe || probe.mode !== 'probe') return { eligible: false, reason: 'probe-unavailable', processVerified: false };
  if (probe.exists !== true) return { eligible: false, reason: 'window-gone', processVerified: false };
  const pid = Number(probe.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { eligible: false, reason: 'no-pid', processVerified: false };
  if (Number(options.expectedPid) > 0 && pid !== Number(options.expectedPid)) return { eligible: false, reason: 'pid-mismatch', processVerified: false };
  const processName = String(probe.processName || '');
  const processVerified = /^codesys/i.test(processName) || (options.allowFixture === true && !processName);
  // 进程名读不到（旧版脚本/权限）时不因此放行:记录里已经有"我们亲手隐藏了它"这条证据，
  // 但审计会带上 processVerified=false，让读者知道这一层没有复核到。
  if (processName && !processVerified && options.allowFixture !== true) return { eligible: false, reason: 'not-codesys-process', processVerified };
  if (probe.iconic === true) return { eligible: false, reason: 'window-minimized', processVerified };
  const style = Number(probe.style);
  if (!Number.isFinite(style)) return { eligible: false, reason: 'style-unknown', processVerified };
  if (windowStyleVisible(style)) return { eligible: false, reason: 'style-visible', processVerified };
  const rect = probe.rect || null;
  if (!rect || Number(rect.width) < MIN_REVIVE_WIDTH || Number(rect.height) < MIN_REVIVE_HEIGHT) return { eligible: false, reason: 'window-frame-too-small', processVerified };
  return { eligible: true, reason: '', processVerified };
}

// 每个"没动作"的原因都给一句人话：失败/放弃**必须有一行可读原因**，不许静默。
const REVIVE_REASON_TEXT = {
  'no-window-id': '没有窗口句柄',
  'no-pid': '没有进程 PID',
  'not-plugin-launched-pid': '该进程不是本插件启动的',
  'not-codesys-process': '该窗口的进程不是 CODESYS',
  'window-minimized': '窗口是最小化的（用户自己的状态，不碰）',
  'style-visible': '窗口已经可见（无需处理）',
  'style-unknown': '读不到窗口的样式位',
  'window-frame-too-small': '窗口矩形过小（不像 IDE 主窗口）',
  'title-not-codesys-main-window': '标题不符合 CODESYS 主窗口口径',
  'session-suspended-by-surface': '该窗口正被当前 surface 主动挂起（预期状态）',
  'window-gone': '记录的窗口已经不存在',
  'pid-mismatch': '该句柄已经属于另一个进程',
  'probe-unavailable': '探活没有得到脚本应答',
  'cannot-read-bounds': '读不到窗口矩形',
  'show-not-applied': '显示请求没有生效（WS_VISIBLE 仍为 false）',
  'shown-without-placement': '窗口已显示但没有接受几何写入',
  'revive-not-applied': '恢复显示未生效',
  'recently-revived': '刚刚恢复过（幂等护栏内不重复 ShowWindow）',
  'ambiguous-candidates': '发现多于一个合规的隐藏窗口，无法安全判定是哪一个，放弃',
  'throttled': '自愈扫描在节流窗口内',
  'no-plugin-launched-pid': '没有可扫描的插件所属 PID',
  'scan-failed': '隐藏窗口扫描失败',
  'revive-failed': '恢复显示调用失败',
};

function reviveReasonText(reason) {
  const key = String(reason || '');
  return REVIVE_REASON_TEXT[key] || key || '未知原因';
}

// 失败原因必须是**一行**：execFile 的 message 带着整条命令行 + 多行 stderr（PowerShell 的
// 报错块还会带本地化的位置信息），直接塞进审计会把"一行可读原因"变成一坨。
function oneLineError(error) {
  const text = String(error?.stderr || error?.message || error || '').replace(/\r/g, '\n');
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const meaningful = lines.find((line) => !/^Command failed:/i.test(line)) || lines[0] || 'unknown';
  return meaningful.length > 300 ? `${meaningful.slice(0, 300)}...` : meaningful;
}

// 一次自愈的**一行**结论（纯函数，可离线单测）。
function reviveOutcomeDetail(outcome) {
  const value = outcome || {};
  if (value.attempted === false) return `未做自愈扫描：${reviveReasonText(value.reason)}。`;
  const revived = value.revived || [];
  if (revived.length) {
    return `已恢复显示 ${revived.length} 个被隐藏的 CODESYS 窗口（${revived.map((entry) => `${entry.windowId} pid ${entry.pid}，来源 ${entry.source}`).join('；')}）；没有抢焦点、没有改样式/位置。`;
  }
  const failed = value.failed || [];
  if (failed.length) {
    return `自愈失败：${failed.map((entry) => `${entry.windowId || '(scan)'}：${entry.detail || reviveReasonText(entry.reason)}`).join('；')}`;
  }
  const skipped = value.skipped || [];
  if (skipped.length) {
    return `自愈没有动作：${skipped.map((entry) => `${entry.windowId || '(scan)'}：${reviveReasonText(entry.reason)}`).join('；')}`;
  }
  return `未发现被隐藏的插件所属 CODESYS 窗口（这次扫描看到 ${Number(value.scanned) || 0} 个窗口）。`;
}

class CodesysNativeHost {
  constructor(root, monitor, options = {}) {
    this.root = path.resolve(root);
    this.monitor = monitor;
    this.runProcess = options.runProcess || execFileAsync;
    this.session = null;
    this.transition = Promise.resolve();
    this.auditPath = path.join(this.root, 'logs', 'codesys-native-host-audit.jsonl');
    // T188：宿主 HWND 在首次 attach 时解析一次。窗口被替换后重新 attach 的调用方是看门狗，
    // 它手里没有 BrowserWindow，所以复用这里记下的句柄；带 BrowserWindow 的正常调用永远优先。
    this.hostWindowHex = '';
    this.watchdogTimer = null;
    // 生产间隔 5 s；测试注入更短的间隔以离线验证行为，不引入 sleep。
    this.watchdogIntervalMs = Math.max(20, Number(options.watchdogIntervalMs) || WATCHDOG_INTERVAL_MS);
    this.watchdogBusy = false;
    // T194：跨进程的会话记录。挂起这件事的**唯一持久证据**就是它 —— 进程内的
    // `session.suspended` 活不过一次重启，而 SW_HIDE 留下的样式位活得比进程还久。
    this.sessionPath = path.join(this.root, 'logs', 'codesys-native-session.json');
    // 0 必须被当成"关掉护栏"的真值（`Number(0) || fallback` 会把 0 变成 fallback，测试就失去了
    // "换一个护栏为 0 的宿主再恢复一次"这条证据）。
    const guardMs = Number(options.reviveGuardMs);
    this.reviveGuardMs = Number.isFinite(guardMs) && guardMs >= 0 ? Math.floor(guardMs) : REVIVE_REPEAT_GUARD_MS;
    const throttleMs = Number(options.reviveThrottleMs);
    this.reviveThrottleMs = Number.isFinite(throttleMs) && throttleMs >= 0 ? Math.floor(throttleMs) : REVIVE_THROTTLE_MS;
    this.revivedWindows = new Map();
    this.reviveLastAtMs = 0;
    this.reviveStats = { attempts: 0, revived: 0, skipped: 0, failed: 0, throttled: 0 };
    // T194 第 3 项：抖动测量与"谁触发的挂起"这条线索。
    this.lastResumeAtMs = 0;
    this.flaps = 0;
    this.surfaceCause = null;
  }

  audit(event, details = {}) {
    // T153：不再每次 `mkdirSync`（路径在构造期就存在），并且带轮转（4MB × 1）。
    appendDiagnosticLog(this.auditPath, `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, { maxBytes: 4 * 1024 * 1024, backups: 1 });
  }

  // T194：主进程在切走 surface 之前把"是谁触发的"放在这里，`suspendNow` 会把它写进
  // `suspended` 那一行审计 —— 只读诊断当时看得到 `reason:"surface-hidden"`，却看不到
  // 是 `surface:open` 的哪个值把它切走的。做成"有时效的一次性线索"而不是 `suspend()` 的
  // 第二个参数，是因为既有调用点被契约逐字钉住（`codesys-window-fit-contract.js` 钉
  // `codesysNativeHost?.suspend('surface-hidden')`，加参数会让那条断言失效）。
  noteSurfaceCause(details = {}) {
    this.surfaceCause = { at: Date.now(), pluginSurfaceKind: String(details.kind || ''), trigger: String(details.trigger || '') };
  }

  takeSurfaceCause(maxAgeMs = 5000) {
    const cause = this.surfaceCause;
    this.surfaceCause = null;
    if (!cause) return null;
    return Date.now() - Number(cause.at || 0) <= maxAgeMs ? cause : null;
  }

  async invokeScript(script, args) {
    const result = await this.runProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const stdout = String(result?.stdout || '').trim();
    const stderr = String(result?.stderr || '').trim();
    if (!stdout && stderr) throw new Error(stderr);
    return stdout ? JSON.parse(stdout) : {};
  }

  invoke(args) {
    return this.invokeScript(SCRIPT, args);
  }

  status() {
    const watchdog = this.watchdogTimer !== null;
    const revive = {
      lastAt: this.reviveLastAtMs ? new Date(this.reviveLastAtMs).toISOString() : '',
      revived: this.reviveStats.revived,
      skipped: this.reviveStats.skipped,
      failed: this.reviveStats.failed,
      throttled: this.reviveStats.throttled,
      flips: this.flaps,
    };
    return this.session
      ? { attached: true, suspended: this.session.suspended === true, mode: 'owned-native-host', windowId: this.session.window.id, pid: this.session.window.pid, bounds: this.session.bounds, taskbarHidden: this.session.taskbarHidden === true, actualOwner: this.session.actualOwner || '', actualExStyle: Number(this.session.actualExStyle || 0), lost: this.session.lost === true, windowRecoveries: Number(this.session.recoveries || 0), watchdog, revive, aiMonitor: 'independent-read-only-media-stream', humanInput: 'native-hwnd-direct' }
      : { attached: false, suspended: false, mode: 'idle', windowId: '', pid: null, bounds: null, taskbarHidden: false, lost: false, windowRecoveries: 0, watchdog, revive, aiMonitor: 'independent-read-only-media-stream', humanInput: 'native-hwnd-direct' };
  }

  enqueue(operation) {
    const next = this.transition.catch(() => null).then(operation);
    this.transition = next.catch(() => null);
    return next;
  }

  // T188：看门狗只在"已托管且未挂起"时有意义。挂起态（surface 切走）下表窗口是被
  // `SW_HIDE` 主动藏起来的，枚举看不见它是**预期**，不是窗口消失 —— 绝不能据此判定脱管。
  startWatchdog() {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => { void this.watchdogTick(); }, this.watchdogIntervalMs);
    // 计时器不得把进程钉住（应用退出路径只保证 detach，不保证计时器被清）。
    if (typeof this.watchdogTimer.unref === 'function') this.watchdogTimer.unref();
  }

  stopWatchdog() {
    if (!this.watchdogTimer) return;
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  // T188：`stop()` 是"父窗口销毁 / 进程退出"这类收尾的统一入口：先停看门狗再脱管，
  // 否则看门狗可能在脱管途中把窗口重新托管回去。
  async stop(reason = 'stop') {
    this.stopWatchdog();
    return this.detach(reason);
  }

  // ── T194：跨进程的会话记录 ───────────────────────────────────────────────────
  //
  // 写：attach / suspend / resume / detach 各一次（不含 move —— 拖动是高频路径，
  // 不该为了一条记录去写盘）。读：只被自愈扫描用。记录里的 `suspended` 是**我们亲手
  // 隐藏了哪个句柄**的唯一持久证据；窗口被销毁 / pid 被回收都由 `-Probe` 的复核挡住。
  readSessionRecord() {
    const value = readJson(this.sessionPath, null, { label: 'CODESYS 原生托管会话 logs/codesys-native-session.json' });
    if (!value || typeof value !== 'object') return null;
    const windowId = String(value.windowId || '');
    if (!windowId) return null;
    return { ...value, windowId, pid: Number(value.pid) || 0 };
  }

  persistSession(patch, event) {
    const record = { version: 1, at: new Date().toISOString(), atMs: Date.now(), ...patch };
    try {
      writeJson(this.sessionPath, record);
      return true;
    } catch (error) {
      // "写不进去"必须可见：这条记录缺失意味着下次启动少一条恢复线索。
      this.audit(event || 'native-host-session-record-failed', { error: String(error?.message || error), windowId: String(record.windowId || ''), inputSent: false });
      return false;
    }
  }

  // 审计一件事：这些窗口的**当前**状态（存在 / 可见 / 最小化 / 矩形）只作为证据写在
  // 同一条里，不做任何推断。
  async probeWindow(windowId, pid, fixture) {
    return this.invoke(['-Probe', '-WindowId', String(windowId), '-ExpectedPid', String(pid), ...(fixture === true ? ['-AllowFixture'] : [])]);
  }

  // T194：只对调用方给出的 PID 做**隐藏窗口**枚举（win-window-monitor.ps1 -IncludeHidden）。
  // 没有 allow-list 就什么也不枚举（脚本侧同样拒答）——"全桌面的隐藏窗口"正是绝不能碰的那一群。
  async listHiddenWindowsForPids(pids = []) {
    const list = [...new Set(pids.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0))];
    if (!list.length) return [];
    const result = await this.runProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', MONITOR_SCRIPT, '-Mode', 'list', '-IncludeHidden', '-PluginPids', list.join(',')], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const stdout = String(result?.stdout || '').trim();
    const stderr = String(result?.stderr || '').trim();
    if (!stdout) {
      if (stderr) throw new Error(stderr);
      return [];
    }
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  // 真正把窗口显示回来。**只**在判据已经通过之后调用；脚本侧还会用 `-ExpectedPid`
  // 再复核一次身份。任何失败都留一条 `native-host-revive-failed` 与一行可读原因。
  async reviveWindowNow(item, source, outcome) {
    const windowId = String(item?.id || item?.windowId || '');
    const pid = Number(item?.pid);
    const key = windowId.toUpperCase();
    const guard = this.revivedWindows.get(key);
    if (guard && Date.now() - Number(guard.at || 0) < this.reviveGuardMs) {
      this.reviveStats.skipped += 1;
      this.audit('native-host-revive-skipped', { windowId, pid, source, reason: 'recently-revived', sinceMs: Date.now() - Number(guard.at || 0), inputSent: false });
      outcome.skipped.push({ windowId, pid, source, reason: 'recently-revived' });
      return false;
    }
    try {
      const result = await this.invoke(['-Revive', '-WindowId', windowId, '-ExpectedPid', String(pid), ...(item?.fixture === true ? ['-AllowFixture'] : [])]);
      const revived = result && result.revived === true;
      if (revived) {
        this.revivedWindows.set(key, { at: Date.now(), pid });
        this.reviveStats.revived += 1;
        this.audit('native-host-revive-suspended', {
          windowId, pid, source, reason: String(result.reason || ''), bounds: result.bounds || null,
          styleVisibleBefore: result.styleVisibleBefore === true, visibleBefore: result.visibleBefore === true,
          styleVisibleAfter: result.styleVisibleAfter === true, visibleAfter: result.visibleAfter === true,
          processVerified: item?.processVerified !== false, focused: false, inputSent: false,
        });
        outcome.revived.push({ windowId, pid, source, bounds: result.bounds || null });
        return true;
      }
      const reason = String(result?.reason || 'revive-not-applied');
      this.reviveStats.skipped += 1;
      this.audit('native-host-revive-skipped', {
        windowId, pid, source, reason,
        styleVisibleBefore: result?.styleVisibleBefore === true, visibleBefore: result?.visibleBefore === true,
        iconicBefore: result?.iconicBefore === true, inputSent: false,
      });
      outcome.skipped.push({ windowId, pid, source, reason });
      return false;
    } catch (error) {
      const message = oneLineError(error);
      this.reviveStats.failed += 1;
      this.audit('native-host-revive-failed', { windowId, pid, source, error: message, inputSent: false });
      outcome.failed.push({ windowId, pid, source, reason: 'revive-failed', detail: `${reviveReasonText('revive-failed')}：${message}` });
      return false;
    }
  }

  // T194 的入口。`reason` 只用于审计/可读结论；`ownedPids` 由调用方给出
  // （内存 launchedPids + 跨进程 logs/codesys-launched.json），`force` 绕过节流（启动那次）。
  //
  // 三条路径，按"证据强度"从高到低：
  //   (a) 会话记录里 `suspended:true` 的那个句柄 —— 我们亲手隐藏的，`-Probe` 复核后恢复；
  //   (b) 插件所属 PID 的隐藏窗口扫描 —— 处理"记录没了但窗口还在被隐藏"的情况；
  //   (c) 都不成立 → 什么都不做（并在有隐藏窗口时留下原因）。
  revivePluginOwnedHiddenWindows(reason = 'startup', options = {}) {
    if (options.force !== true && this.reviveLastAtMs && Date.now() - this.reviveLastAtMs < this.reviveThrottleMs) {
      this.reviveStats.throttled += 1;
      return Promise.resolve({ attempted: false, reason: 'throttled', why: `距上次扫描 ${Date.now() - this.reviveLastAtMs}ms（节流 ${this.reviveThrottleMs}ms）`, scanned: 0, revived: [], skipped: [], failed: [], detail: reviveOutcomeDetail({ attempted: false, reason: 'throttled' }) });
    }
    this.reviveLastAtMs = Date.now();
    this.reviveStats.attempts += 1;
    return this.enqueue(() => this.reviveNow(reason, options));
  }

  async reviveNow(reason, options = {}) {
    const outcome = { reason, attempted: true, scanned: 0, revived: [], skipped: [], failed: [], record: null };
    const allowedPids = new Set();
    const addPid = (value) => { const pid = Number(value); if (Number.isSafeInteger(pid) && pid > 0) allowedPids.add(pid); };
    for (const value of options.ownedPids || []) addPid(value);
    if (this.session?.window?.pid) addPid(this.session.window.pid);
    // 当前 session 正在被 surface 主动挂起时，它自己**不是候选**（预期状态，不是故障）。
    const liveSuspendedWindowId = this.session && this.session.suspended === true ? String(this.session.window.id).toUpperCase() : '';
    const excluded = new Set(liveSuspendedWindowId ? [liveSuspendedWindowId] : []);

    // ── (a) 会话记录：我们自己写下的"我把它隐藏了" ──────────────────────────────
    const record = this.readSessionRecord();
    if (record) {
      const ageMs = Number(record.atMs) ? Math.max(0, Date.now() - Number(record.atMs)) : -1;
      outcome.record = { windowId: record.windowId, pid: record.pid, suspended: record.suspended === true, reason: String(record.reason || ''), ageMs };
      if (record.suspended !== true) {
        // 记录说"没挂起"：它不该驱动任何显示动作（窗口可见与否由 surface 决定）。
      } else if (String(record.windowId).toUpperCase() === liveSuspendedWindowId) {
        outcome.skipped.push({ windowId: record.windowId, pid: record.pid, source: 'session-record', reason: 'session-suspended-by-surface' });
      } else {
        this.audit('native-host-revive-scan', { reason, source: 'session-record', windowId: record.windowId, pid: record.pid, suspended: true, ageMs, inputSent: false });
        let probe = null;
        try { probe = await this.probeWindow(record.windowId, record.pid, false); } catch { probe = null; }
        const decision = reviveProbeDecision(probe, { expectedPid: record.pid });
        if (decision.eligible) {
          const revived = await this.reviveWindowNow({ id: record.windowId, pid: record.pid, processVerified: decision.processVerified !== false }, 'session-record', outcome);
          // 显示成功了就把记录落成"未挂起"：下一次启动不再重复问同一个句柄。
          // 只在**没有活动 session** 时写 —— 有 session 时这条记录归那个 session 所有，
          // 由它的 suspend/resume/detach 更新（见 persistSession 的每个调用点）。
          if (revived && !this.session) this.persistSession({ windowId: record.windowId, pid: record.pid, suspended: false, reason: 'revived' });
        } else if (decision.reason === 'window-gone') {
          // 句柄已经不存在 = 没有东西需要显示。清掉记录（否则每次启动都会重新问一遍），
          // 并且记一条：这条记录曾经存在但窗口已经不在了，这是事实，不是失败。
          this.audit('native-host-revive-record-stale', { windowId: record.windowId, pid: record.pid, ageMs, reason: decision.reason, inputSent: false });
          this.persistSession({ windowId: '', pid: 0, suspended: false, reason: 'record-stale' });
          outcome.skipped.push({ windowId: record.windowId, pid: record.pid, source: 'session-record', reason: decision.reason });
        } else {
          this.audit('native-host-revive-skipped', { windowId: record.windowId, pid: record.pid, source: 'session-record', reason: decision.reason, ageMs, inputSent: false });
          outcome.skipped.push({ windowId: record.windowId, pid: record.pid, source: 'session-record', reason: decision.reason });
        }
      }
    }

    // ── (b) 插件所属 PID 的隐藏窗口扫描 ────────────────────────────────────────
    if (!allowedPids.size) {
      if (!outcome.revived.length && !outcome.skipped.length) outcome.skipped.push({ windowId: '', pid: 0, source: 'owned-hidden-scan', reason: 'no-plugin-launched-pid' });
      outcome.detail = reviveOutcomeDetail(outcome);
      return outcome;
    }
    let hidden = [];
    try {
      hidden = await this.listHiddenWindowsForPids([...allowedPids]);
    } catch (error) {
      const message = oneLineError(error);
      this.reviveStats.failed += 1;
      this.audit('native-host-revive-failed', { source: 'owned-hidden-scan', reason: 'scan-failed', pids: [...allowedPids], error: message, inputSent: false });
      outcome.failed.push({ windowId: '', pid: 0, source: 'owned-hidden-scan', reason: 'scan-failed', detail: `${reviveReasonText('scan-failed')}：${message}` });
      outcome.detail = reviveOutcomeDetail(outcome);
      return outcome;
    }
    outcome.scanned = hidden.length;
    const candidates = [];
    const declined = [];
    for (const item of hidden) {
      const decision = reviveCandidateDecision(item, { allowedPids, excludedWindowIds: excluded });
      if (decision.eligible) candidates.push(item);
      // 只记"有一扇隐藏的、属于我们的窗口，但没动它"这几种原因：可见窗口 / 别人的进程 /
      // 过小的辅助窗口都是这条扫描的正常人口（一个 CODESYS 进程常年带着若干 0x0 的隐藏
      // 辅助窗口），记下来只会变成噪音。
      else if (item.styleVisible === false && !['not-plugin-launched-pid', 'style-visible', 'style-unknown'].includes(decision.reason)) {
        declined.push({ windowId: String(item.id || ''), pid: Number(item.pid) || 0, reason: decision.reason });
      }
    }
    if (!candidates.length && !declined.length) {
      outcome.detail = reviveOutcomeDetail(outcome);
      return outcome;
    }
    // 有候选 → 留一条扫描事实（低噪音：只在"确实存在被隐藏的插件窗口"时写），
    // 被拒的窗口全部内联在这一条里。
    this.audit('native-host-revive-scan', {
      reason, source: 'owned-hidden-scan', pids: [...allowedPids], scanned: hidden.length,
      candidates: candidates.map((item) => String(item.id || '')), declined, inputSent: false,
    });
    for (const entry of declined) {
      // 逐窗口的 `-skipped` 只留给**值得单独一条**的原因（最小化 / 标题不像主窗口）：
      // 数量最多的 `window-frame-too-small` 已经在上面的扫描行里逐条列出了。
      if (!AUDITED_REVIVE_SKIP_REASONS.has(entry.reason)) continue;
      this.audit('native-host-revive-skipped', { windowId: entry.windowId, pid: entry.pid, source: 'owned-hidden-scan', reason: entry.reason, inputSent: false });
    }
    for (const entry of declined) outcome.skipped.push({ ...entry, source: 'owned-hidden-scan' });
    if (candidates.length > 1) {
      // 合规候选不唯一：无法证明"该显示的是哪一个"，所以一个都不显示（不猜）。
      this.reviveStats.skipped += 1;
      this.audit('native-host-revive-skipped', { source: 'owned-hidden-scan', reason: 'ambiguous-candidates', candidates: candidates.map((item) => String(item.id || '')), inputSent: false });
      outcome.skipped.push({ windowId: '', pid: 0, source: 'owned-hidden-scan', reason: 'ambiguous-candidates' });
      outcome.detail = reviveOutcomeDetail(outcome);
      return outcome;
    }
    if (candidates.length === 1) await this.reviveWindowNow(candidates[0], 'owned-hidden-scan', outcome);
    outcome.detail = reviveOutcomeDetail(outcome);
    return outcome;
  }

  // 托管句柄是否还活着，以及同一 pid 有没有可接管的新主窗口。
  //
  // T188：探活走脚本的 `-Probe`，**不依赖可见性、不改动任何窗口**。不能用
  // `win-window-monitor.ps1 -Mode list` 代替：它只枚举 `IsWindowVisible` 的窗口，而
  // "宿主窗口被最小化"会把被托管的 owned 窗口一起隐藏（本机实测：宿主最小化后
  // `IsWindowVisible(target)` 翻成 False，但 HWND 仍然活着、`GetWindowRect` 仍可读）。
  // 用枚举判活会在每次最小化 TaskHive 时误判脱管，恢复路径甚至会把 CODESYS 窗口重新
  // 拉到已经最小化的外壳之上。
  async probeHostedWindow() {
    const session = this.session;
    if (!session) return null;
    return this.invoke([
      '-Probe', '-WindowId', String(session.window.id), '-ExpectedPid', String(session.window.pid),
      ...(session.window.fixture === true ? ['-AllowFixture'] : []),
    ]);
  }

  // T192：**让运行中的 CODESYS 重新加载** —— 唯一一个诚实的入口探测。
  //
  // 为什么只有一个"尝试"而不是一个可靠的自动重载：CODESYS V3.5 **没有**任何可编程的重载入口。
  // 三条独立证据（都是本机安装里的原文，不是推测）：
  //   ① 脚本 API：`ScriptLib\Stubs\scriptengine\*.pyi` 里 `ScriptProjects` 只有
  //      create/open/open_archive/get_by_path/primary/all/convert，`ScriptProject` 只有
  //      close/save/save_as/dirty；整个目录 `reload` 只命中 `ScriptDeviceUserManagement.reload_from_program`
  //      （用户管理，与工程无关）。
  //   ② 菜单定义：`CODESYS\Settings\Standard (CODESYS V3.5 SP20 Patch 4).opt.menu` 是**全量**菜单
  //      （709 条命令、25 个顶级菜单）；其中唯一带 reload 的命令是 `73d6ea58-...`
  //      "Try To Reload Library"（Libraries 菜单）。File / Project 菜单里**没有**工程重载项。
  //   ③ 二进制字符串：整个 `Common` + `PlugIns` 里没有任何 "Reload Project" 之类的命令标题。
  //   ④ **真机实测（2026-10-04 23:0x，用户当时正开着自己的工程）**：对正在运行的
  //      `FiveDofPlatform0921.project - CODESYS`（hwnd 0xA80CEE / pid 35876）与另一个 CODESYS 窗口
  //      （0x7C0CFA / pid 40308）做**只读**探测，`GetMenu(hwnd)` 两次都返回 **0**、顶级菜单数 0 ——
  //      CODESYS 的菜单栏是它自己画的，不是 Win32 原生菜单。也就是说这条 -ReloadProject 在 SP20 上
  //      **必然**答 `no-native-menubar`（夹具里那一支已实测），按钮因此是一个"诚实的报告者"而不是
  //      一个能用的重载：它给出原因 + 最短步骤，绝不假装成功。
  // 因此能做的只有：读目标窗口的 **原生 Win32 菜单栏**，仅当某一项的标题**精确等于**白名单里的
  // 重载标题时才 PostMessage(WM_COMMAND)。没有菜单栏 / 没有这一项 → 如实回报原因（含扫过的条数与
  // 顶级菜单名），由外壳把"最短步骤"写给用户。**绝不**去点空菜单、绝不抢焦点、绝不关工程或关进程。
  //
  // 幂等：走 `enqueue`（与 attach/move/detach 同一条串行链），并且在途时直接复用同一个 Promise
  // —— 连点不会叠出两次 WM_COMMAND。不阻塞：一次 PowerShell 往返（≤15s 超时），不 await 别的东西。
  // `target` 省略时用托管 session 的窗口；主进程在"未托管"时传入面板选定的监视窗口。
  reloadProject(target = null) {
    if (this.pendingReload) return this.pendingReload;
    const source = target || (this.session ? this.session.window : null);
    if (!source || !Number(source.pid)) {
      return Promise.resolve({ ok: false, invoked: false, reason: 'no-hosted-window', scanned: 0, caption: '', detail: '当前没有可用的 CODESYS 窗口：请先在面板里选中/托管一个 CODESYS 窗口。' });
    }
    if (this.reloadBusy) {
      return Promise.resolve({ ok: false, invoked: false, reason: 'reload-in-flight', scanned: 0, caption: '', detail: '上一次「让 CODESYS 重新加载」还在进行中：请等它返回。' });
    }
    this.reloadBusy = true;
    const windowId = String(source.id);
    const pid = Number(source.pid);
    const fixture = source.fixture === true;
    this.pendingReload = this.enqueue(async () => this.reloadProjectNow(windowId, pid, fixture))
      .finally(() => { this.pendingReload = null; this.reloadBusy = false; });
    return this.pendingReload;
  }

  async reloadProjectNow(windowId, pid, fixture) {
    try {
      const result = await this.invoke([
        '-ReloadProject', '-WindowId', String(windowId), '-ExpectedPid', String(pid),
        ...(fixture === true ? ['-AllowFixture'] : []),
      ]);
      const invoked = result && result.invoked === true;
      this.audit(invoked ? 'native-host-reload-invoked' : 'native-host-reload-unavailable', {
        windowId, pid, reason: String((result && result.reason) || ''), scanned: Number((result && result.scanned) || 0),
        commandId: Number((result && result.commandId) || 0), caption: String((result && result.caption) || ''),
        topLevelMenus: String((result && result.topLevelMenus) || ''), inputSent: invoked,
      });
      return {
        ok: invoked === true,
        invoked,
        reason: String((result && result.reason) || (invoked ? '' : 'reload-not-invoked')),
        detail: reloadProjectDetail(result),
        windowId, pid,
        scanned: Number((result && result.scanned) || 0),
        caption: String((result && result.caption) || ''),
      };
    } catch (error) {
      const message = String(error?.message || error);
      this.audit('native-host-reload-failed', { windowId, pid, error: message, inputSent: false });
      return { ok: false, invoked: false, reason: 'reload-failed', detail: `让 CODESYS 重新加载失败：${message}`, windowId, pid, scanned: 0, caption: '' };
    }
  }

  async inspectHostedWindow() {
    const session = this.session;
    if (!session) return { alive: false, reason: 'no-session', replacement: null };
    let probe = null;
    try { probe = await this.probeHostedWindow(); } catch { probe = null; }
    // 探活本身失败（超时、脚本异常）时**绝不能**判定脱管：把一次 PowerShell 抖动升级成
    // "窗口已丢失"会退掉一条健康的 session。只有拿到真正的 probe 应答才算数。
    if (!probe || probe.mode !== 'probe') return { alive: true, reason: 'probe-unavailable', replacement: null, probe: null };
    const exists = probe.exists === true;
    if (exists && Number(probe.pid) === Number(session.window.pid)) return { alive: true, reason: 'present', replacement: null, probe };
    // 只有确认句柄真的没了（或已被回收给别的进程）才去枚举候选窗口 —— 枚举是可见性过滤的，
    // 只在"确实需要找替代窗口"时才有意义。
    const windows = await this.monitor.listWindows();
    const replacement = windows
      .filter((item) => Number(item.pid) === Number(session.window.pid))
      .filter((item) => String(item.id) !== String(session.window.id))
      .filter((item) => item.usable !== false)
      .filter(isCodesysLikeWindow)
      .sort((left, right) => (Number(right.width) * Number(right.height)) - (Number(left.width) * Number(left.height)))[0] || null;
    return { alive: false, reason: exists ? 'pid-changed' : 'hwnd-destroyed', replacement, probe };
  }

  async watchdogTick() {
    const session = this.session;
    if (!session || session.suspended === true || this.watchdogBusy) return;
    this.watchdogBusy = true;
    try {
      const inspected = await this.inspectHostedWindow();
      // 枚举期间用户可能已经脱管/重新托管：只处理"还是同一个 session"的情况。
      if (this.session !== session) return;
      if (inspected.alive) { session.lost = false; return; }
      session.lost = true;
      const recoveries = Number(session.recoveries || 0);
      this.audit('native-host-window-lost', {
        windowId: session.window.id, pid: session.window.pid, reason: inspected.reason,
        bounds: session.bounds, recoveries, replacementId: inspected.replacement?.id || '', inputSent: false,
      });
      if (!inspected.replacement || recoveries >= MAX_WINDOW_RECOVERIES) {
        // 没有可接管窗口（或接管次数用尽）：退掉 session，让 status().attached 变 false。
        // 继续假报 attached 才是真正的失败模式 —— 面板会一直显示占位符而真实窗口在别处。
        this.session = null;
        this.stopWatchdog();
        this.audit('native-host-window-lost-unrecovered', {
          windowId: session.window.id, pid: session.window.pid, reason: inspected.reason,
          recoveries, exhausted: recoveries >= MAX_WINDOW_RECOVERIES, inputSent: false,
        });
        return;
      }
      const previousId = session.window.id;
      const bounds = session.bounds;
      const pid = session.window.pid;
      // 旧句柄已不存在：没有东西可还原，直接退休这条 session（等同 detach 的 alreadyGone 语义）。
      this.session = null;
      try {
        await this.attachNow(inspected.replacement.id, bounds, null);
        if (this.session) this.session.recoveries = recoveries + 1;
        this.audit('native-host-window-replaced', {
          windowId: previousId, replacementId: inspected.replacement.id, pid, bounds,
          recoveries: recoveries + 1, inputSent: false,
        });
      } catch (error) {
        // 接管失败：session 已经退休，别让看门狗空转（没有 session 的 tick 会立刻返回）。
        if (!this.session) this.stopWatchdog();
        this.audit('native-host-window-recovery-failed', {
          windowId: previousId, replacementId: inspected.replacement.id, pid,
          error: String(error?.message || error), inputSent: false,
        });
      }
    } catch (error) {
      this.audit('native-host-watchdog-failed', { error: String(error?.message || error), inputSent: false });
    } finally {
      this.watchdogBusy = false;
    }
  }

  // T194：attach 路径上的定点自愈。只认**本插件拥有**的窗口（`pluginOwned`，来自
  // codesys-window-ownership 的领取记录），pid 只从既有缓存里取（不猜、不枚举全桌面），
  // 然后 `-Probe` 复核身份与隐藏状态，通过才显示，再重新枚举一次让 attach 继续。
  // 失败/放弃都留一行可读原因，并且**不**改变 attach 的原有失败语义。
  async reviveTargetedWindow(windowId) {
    const cached = this.monitor.cachedWindow(String(windowId)) || null;
    if (!cached || cached.pluginOwned !== true) return null;
    const pid = Number(cached.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    const outcome = { reason: 'attach-target', attempted: true, scanned: 1, revived: [], skipped: [], failed: [] };
    let probe = null;
    try { probe = await this.probeWindow(windowId, pid, cached.fixture === true); } catch { probe = null; }
    const decision = reviveProbeDecision(probe, { expectedPid: pid });
    if (!decision.eligible) {
      this.audit('native-host-revive-skipped', { windowId: String(windowId), pid, source: 'attach-target', reason: decision.reason, inputSent: false });
      return null;
    }
    const revived = await this.reviveWindowNow({ id: String(windowId), pid, processVerified: decision.processVerified !== false }, 'attach-target', outcome);
    if (!revived) return null;
    const refreshed = await this.monitor.listWindows({ maxAgeMs: 0 });
    return refreshed.find((item) => String(item.id) === String(windowId) && item.usable !== false) || null;
  }

  attach(windowId, bounds, hostWindow) {
    return this.enqueue(() => this.attachNow(windowId, bounds, hostWindow));
  }

  async attachNow(windowId, bounds, hostWindow) {
    const targetBounds = normalizeBounds(bounds);
    // T162：允许复用"刚出炉"的窗口快照（默认 2 s）。UI 流程是"刷新列表 → 用户选中 →
    // attach"，两者相隔通常不到 4 s，而全量枚举实测要 686–825 ms（占 attach 端到端
    // 1202 ms 的一半以上）。权威校验在 PowerShell 侧的 `-ExpectedPid`，与 T153 为
    // `updateNow` 采用的同一论证。
    const candidates = await this.monitor.listWindows({ maxAgeMs: 2000 });
    // T194：目标不在**可见**枚举里，但它可能只是被隐藏了 —— 枚举只认 IsWindowVisible，
    // 所以"我们刚把它挂起（或它被外部隐藏）"会让 attach 答"窗口不可用"。缓存里还有它的
    // pid（来自上一次可见枚举），而且只有**本插件拥有**的窗口才允许走这一步：用户自己开的
    // 窗口绝不在这里被显示（他们的隐藏窗口根本无法被选中，也就不会走到 attach）。
    const target = candidates.find((item) => String(item.id) === String(windowId)) || await this.reviveTargetedWindow(windowId);
    if (!target || target.usable === false) throw Object.assign(new Error('CODESYS 窗口不可用于原生托管'), { code: 'CODESYS_NATIVE_HOST_WINDOW_INVALID' });
    if (!/^codesys/i.test(String(target.processName || '')) && !(process.env.TASKHIVE_CODESYS_TEST_FIXTURE === '1' && target.fixture === true)) {
      throw Object.assign(new Error('原生托管只允许经过复核的 CODESYS 窗口'), { code: 'CODESYS_NATIVE_HOST_PROCESS_DENIED' });
    }
    if (this.session && String(this.session.window.id) !== String(target.id)) await this.detachNow('switch-window');
    if (this.session) return this.session.suspended === true ? this.resumeNow(targetBounds) : this.updateNow(targetBounds);
    // T188：看门狗在窗口被 CODESYS 替换后要重新 attach，而它手里没有 BrowserWindow，所以
    // 复用首次解析出的宿主句柄。带 BrowserWindow 的正常调用方永远优先（它的句柄才是当前的）。
    const hostWindowId = hostWindow ? windowHandleHex(hostWindow) : String(this.hostWindowHex || '');
    if (!hostWindowId || hostWindowId === '0x0') throw new Error('TaskHive 主窗口不可用');
    const result = await this.invoke([
      '-Mode', 'attach', '-WindowId', String(target.id), '-ExpectedPid', String(target.pid),
      '-HostWindowId', hostWindowId, '-Left', String(targetBounds.x), '-Top', String(targetBounds.y),
      '-Width', String(targetBounds.width), '-Height', String(targetBounds.height),
      ...(target.fixture === true ? ['-AllowFixture'] : []),
    ]);
    this.hostWindowHex = String(result.hostWindowId || hostWindowId);
    this.session = { window: target, bounds: targetBounds, restore: result.restore || {}, hostWindowId: result.hostWindowId || '', taskbarHidden: result.taskbarHidden === true, actualOwner: result.actualOwner || '', actualExStyle: Number(result.actualExStyle || 0), suspended: false, lost: false, recoveries: 0 };
    this.startWatchdog();
    // T194：把"哪个句柄现在归我们托管（且未挂起）"落到跨进程记录里。
    this.persistSession({ windowId: target.id, pid: target.pid, bounds: targetBounds, suspended: false, reason: 'attached' });
    // T162：托管是否**真的**落在面板矩形里。只记录不抛（不同 DPI 感知模式下可能有系统性
    // 差异，先观测再决定），但有了这条数据就能判断"面板空白"是几何失败还是别的原因。
    const placementDelta = geometryMismatch(targetBounds, result.actualBounds);
    if (placementDelta) this.audit('attach-geometry-mismatch', { windowId: target.id, pid: target.pid, requested: targetBounds, actual: result.actualBounds || null, maxDelta: placementDelta });
    this.session.placementDelta = placementDelta;
    // T187：几何比对只在"双方单位一致"时才有意义。脚本没拿到 per-monitor 感知时，
    // placementDelta 会被虚拟化抵消成 0，这里单独记一条，让那种情况永远不静默。
    const coordinateSpace = dpiCoordinateSpace(result);
    this.session.coordinateSpace = coordinateSpace;
    if (coordinateSpace !== 'physical') this.audit('native-host-coordinate-space-degraded', { windowId: target.id, pid: target.pid, requested: targetBounds, dpiAwareness: Number(result.dpiAwareness), coordinateSpace, placementDelta });
    this.audit('attached', { windowId: target.id, pid: target.pid, bounds: targetBounds, mode: 'owned-native-host', taskbarHidden: result.taskbarHidden === true, actualOwner: result.actualOwner || '', actualExStyle: Number(result.actualExStyle || 0), inputSent: false, placementDelta, coordinateSpace });
    return { ...this.status(), identityVerified: result.identityVerified === true, styleCaptured: result.styleCaptured === true, taskbarHidden: result.taskbarHidden === true, actualOwner: result.actualOwner || '', actualExStyle: Number(result.actualExStyle || 0), actualBounds: result.actualBounds || null, placementDelta, coordinateSpace };
  }

  update(bounds) {
    // T153：**合并**语义 —— 拖动窗口时 `'resize'` 以 ~60Hz 触发，旧实现把每一次都接到
    // transition 链尾（每次 1.3–1.9 s），队列线性增长且松手后原生窗口还在追赶几秒前的
    // 旧几何。这里只保留**最新** bounds：链上始终只有一个循环，取到最新值就继续。
    this.pendingBounds = normalizeBounds(bounds);
    if (this.pendingUpdate) return this.pendingUpdate;
    this.pendingUpdate = this.enqueue(async () => {
      while (this.pendingBounds) {
        const next = this.pendingBounds;
        this.pendingBounds = null;
        await this.updateNow(next);
      }
    }).finally(() => { this.pendingUpdate = null; });
    return this.pendingUpdate;
  }

  // T160：`updateNow` 只做**计时与抽样审计**，实现体一字未改（见 updateNowUnmeasured）。
  async updateNow(bounds) {
    const startedAt = Date.now();
    try {
      return await this.updateNowUnmeasured(bounds);
    } finally {
      this.recordMove(Date.now() - startedAt);
    }
  }

  // move/update 此前**完全不计数**（审计里只有 attach/suspend/resume/detach），于是
  // "要不要给移动做常驻 PowerShell worker（可把 1.3–1.9 s 压到几十毫秒）"这个决定
  // 一直**没有数据可依**，只能靠体感。这里只累计计数与耗时，并且**抽样**写审计：
  // 每 50 次、或单次超过 400 ms 时写一条 —— 一个正常工作日就能得到
  // "每天多少次移动 / 平均与最大耗时 / 多少比例超过 400ms"，再决定值不值得上 worker。
  recordMove(elapsedMs) {
    const stats = this.moveStats || (this.moveStats = { count: 0, totalMs: 0, maxMs: 0, slow: 0, mismatch: 0 });
    stats.count += 1;
    stats.totalMs += elapsedMs;
    if (elapsedMs > stats.maxMs) stats.maxMs = elapsedMs;
    if (elapsedMs > 400) stats.slow += 1;
    if (stats.count % 50 === 0 || elapsedMs > 400) {
      this.audit('moved', {
        count: stats.count,
        ms: elapsedMs,
        avgMs: Math.round(stats.totalMs / stats.count),
        maxMs: stats.maxMs,
        slow: stats.slow,
      });
    }
  }

  async updateNowUnmeasured(bounds) {
    if (!this.session) return this.status();
    const targetBounds = normalizeBounds(bounds);
    if (this.session.suspended === true) {
      this.session.bounds = targetBounds;
      return this.status();
    }
    // T153：优先用**内存缓存**校验身份（`cachedWindow`，纯内存 + 5 s TTL），
    // 只在缓存未命中时才重新枚举全部窗口 —— 原先每次 move 都跑一次完整
    // PowerShell 枚举（实测 626–1034 ms），只为了拿一个 pid。
    // 真正的权威校验是下面 `-ExpectedPid`（脚本内部比对），所以缓存陈旧不会放行错误窗口。
    let current = this.monitor.cachedWindow(this.session.window.id);
    if (!current) current = (await this.monitor.listWindows()).find((item) => String(item.id) === String(this.session.window.id));
    const sessionPid = Number(this.session.window.pid);
    const currentPid = Number(current && current.pid);
    if (!current || (currentPid > 0 && currentPid !== sessionPid)) {
      await this.detachNow('identity-changed').catch(() => {});
      throw Object.assign(new Error('CODESYS 窗口身份已变化，已停止原生托管'), { code: 'CODESYS_NATIVE_HOST_IDENTITY_CHANGED' });
    }
    const result = await this.invoke(['-Mode', 'move', '-WindowId', String(this.session.window.id), '-ExpectedPid', String(sessionPid), '-Left', String(targetBounds.x), '-Top', String(targetBounds.y), '-Width', String(targetBounds.width), '-Height', String(targetBounds.height), ...(current.fixture === true ? ['-AllowFixture'] : [])]);
    // T187：单位口径必须先立住 —— 见 dpiCoordinateSpace 的说明。脚本失去 per-monitor
    // 感知时，下面的 moveDelta 恒为 0，只有这条记录能说明窗口其实没落在面板里。
    const coordinateSpace = dpiCoordinateSpace(result);
    if (coordinateSpace !== this.session.coordinateSpace) {
      this.session.coordinateSpace = coordinateSpace;
      if (coordinateSpace !== 'physical') this.audit('native-host-coordinate-space-degraded', { windowId: this.session.window.id, pid: sessionPid, requested: targetBounds, dpiAwareness: Number(result && result.dpiAwareness), coordinateSpace });
    }
    // T162：移动同样回读。抽样审计（只在超差时写一条）——否则每次拖动都会写日志。
    const moveDelta = geometryMismatch(targetBounds, result && result.actualBounds);
    if (moveDelta) {
      this.moveStats = this.moveStats || { count: 0, totalMs: 0, maxMs: 0, slow: 0, mismatch: 0 };
      this.moveStats.mismatch = (this.moveStats.mismatch || 0) + 1;
      this.audit('move-geometry-mismatch', { windowId: this.session.window.id, pid: sessionPid, requested: targetBounds, actual: (result && result.actualBounds) || null, maxDelta: moveDelta });
    }
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
    // T194 第 2 项：把"是谁触发的这次挂起"写进**这一行**审计。只读诊断当时看到的是
    // `reason:"surface-hidden"`，看不出是 `surface:open` 的哪个值把它切走的。
    const cause = this.takeSurfaceCause();
    // T194 第 3 项：resume→suspend 抖动测量。策略是"照做 + 记录"，理由写在下面那条审计里。
    const gapMs = this.lastResumeAtMs ? Date.now() - this.lastResumeAtMs : 0;
    const flap = gapMs > 0 && gapMs < SUSPEND_FLAP_WINDOW_MS;
    if (flap) this.flaps += 1;
    this.audit('suspended', {
      windowId: session.window.id, pid: session.window.pid, reason, bounds: session.bounds, restored: false, inputSent: false,
      ...(cause ? { pluginSurfaceKind: cause.pluginSurfaceKind, surfaceTrigger: cause.trigger } : {}),
      ...(flap ? { resumeToSuspendMs: gapMs, flap: true } : {}),
    });
    if (flap) {
      this.audit('native-host-suspend-after-resume', {
        windowId: session.window.id, pid: session.window.pid, reason, resumeToSuspendMs: gapMs, flapIndex: this.flaps,
        policy: 'suspend-performed',
        why: 'the end state is self-consistent (surface hidden => window hidden), so withholding the hide would leave a real window over the wrong surface; the trigger cannot be told apart from a genuine navigation at this layer, so it is recorded (surfaceTrigger on the suspended line) instead of suppressed',
        inputSent: false,
      });
    }
    // T194：**跨进程**记录"哪一个句柄被我们隐藏了、当时在哪"。这是重启后唯一还活着的证据。
    this.persistSession({ windowId: session.window.id, pid: session.window.pid, bounds: session.bounds, suspended: true, reason });
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
    this.lastResumeAtMs = Date.now();
    this.audit('resumed', { windowId: session.window.id, pid: session.window.pid, bounds: targetBounds, restored: false, inputSent: false });
    this.persistSession({ windowId: session.window.id, pid: session.window.pid, bounds: targetBounds, suspended: false, reason: 'resumed' });
    return this.status();
  }

  detach(reason = 'user') {
    return this.enqueue(() => this.detachNow(reason));
  }

  async detachNow(reason = 'user') {
    const session = this.session;
    // T188：先停看门狗。否则脱管过程中（一次 PowerShell 往返 600ms+）看门狗可能判定
    // "句柄已消失"并把同一个窗口重新 attach 回去，用户点"停止托管"却看到窗口又被托管。
    this.stopWatchdog();
    // T161：**先不清 session**。旧实现在 invoke 之前就 `this.session = null`，于是脱管一旦
    // 失败（窗口已销毁、脚本超时被杀、样式只还原了一半），第二次点"停止托管"会直接命中
    // `if (!session) return` —— 返回 `{attached:false}`、UI 显示"已从插件区域取出"，而窗口
    // 其实还停在改造状态，用户以为还原了。日志实证出现过 detach `ok=true` 但耗时 **0 ms**
    // 的记录（起一次 PowerShell 至少要 ~600 ms，0 ms 只能是这条静默 no-op）。
    if (!session) return this.status();
    try {
      const restore = session.restore || {};
      await this.invoke([
        '-Mode', 'detach', '-WindowId', String(session.window.id), '-ExpectedPid', String(session.window.pid),
        // T161：**必须写回"原始"exStyle**，否则脱管后窗口会永久带着 WS_EX_TOOLWINDOW ——
        // 表现为真实 CODESYS 从任务栏与 Alt-Tab 里消失（只有 TaskHive 还能找回来）。
        // 日志实证：attach 记录 `actualExStyle: 65929`(0x10189)，去掉 TOOLWINDOW(0x80) 才是
        // 原值 65801(0x10109)；脚本早就把原值放在 `originalExStyle` 里返回，但这里传的是
        // 被改造过的 `exStyle`，等于把保险丝接到了自己的另一端。
        '-RestoreStyle', String(restore.style ?? 0),
        '-RestoreExStyle', String(restore.originalExStyle ?? restore.exStyle ?? 0),
        '-RestoreOwner', String(restore.owner || '0x0'), '-Left', String(restore.left ?? session.window.left ?? 0),
        '-Top', String(restore.top ?? session.window.top ?? 0), '-Width', String(restore.width ?? session.window.width ?? 800),
        '-Height', String(restore.height ?? session.window.height ?? 600), ...(session.window.fixture === true ? ['-AllowFixture'] : []),
      ]);
      this.audit('detached', { windowId: session.window.id, pid: session.window.pid, reason, restored: true, inputSent: false });
      this.session = null;
      // T194：脱管之后这个句柄不再归我们（可见性已经由 detach 的 SWP_SHOWWINDOW 还原），
      // 记录必须一起失效，否则下一次启动会拿着一条过期记录去问一个不该我们管的窗口。
      this.persistSession({ windowId: '', pid: 0, suspended: false, reason: `detached:${reason}` });
      return { ...this.status(), restored: true, reason };
    } catch (error) {
      const message = String(error.message || error);
      // T186：脱管的目标 HWND 可能在"该还原"之前就消失（用户关掉了 CODESYS，或 CODESYS
      // 删掉并重建了自己的主窗口）。此时**没有东西需要还原**，"退休这条 session"本身就是
      // 正确结果。旧实现一律 throw，于是 attachNow 里的 switch-window 脱管也跟着抛，新窗口
      // 的 attach 根本没跑 —— 面板显示「原生窗口载入失败」。日志实证（2026-10-04 那次用户
      // 运行）：0x40D1C 已不存在（pid 5460 已退出），06:33:51.557Z 对 0x70EAC 的 attach
      // 带着这条脱管错误一起失败。
      if (/Target HWND no longer exists|Target HWND PID changed/.test(message)) {
        this.audit('detached', { windowId: session.window.id, pid: session.window.pid, reason, restored: false, alreadyGone: true, inputSent: false });
        this.session = null;
        this.persistSession({ windowId: '', pid: 0, suspended: false, reason: `detached-already-gone:${reason}` });
        return { ...this.status(), restored: false, alreadyGone: true, reason };
      }
      this.audit('detach-failed', { windowId: session.window.id, pid: session.window.pid, reason, error: message, inputSent: false });
      throw error;
    }
  }
}

module.exports = { CodesysNativeHost, normalizeBounds, windowHandleHex, geometryMismatch, dpiCoordinateSpace, reloadProjectDetail };
// T194：自愈的判据与"一行结论"是纯函数，单独导出以便离线单测（上面那一行是契约钉住的
// 字面量，不动它）。
module.exports.reviveCandidateDecision = reviveCandidateDecision;
module.exports.reviveProbeDecision = reviveProbeDecision;
module.exports.reviveOutcomeDetail = reviveOutcomeDetail;
module.exports.reviveReasonText = reviveReasonText;
module.exports.windowStyleVisible = windowStyleVisible;
