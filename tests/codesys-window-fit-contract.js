'use strict';

// CODESYS 窗口 ↔ 插件区域 的契约。
//
// 用户的删除要求（2026-10）：删除 ModLens 插件与「AI 实时监视」能力，**保留**窗口枚举
// 与原生窗口托管。本文件的前身是 `codesys-window-fit-contract.js`，它断言的"把 CODESYS
// 窗口几何改写成插件画布比例"（codesys:fit-window / fitWindowToCanvas / win-window-monitor.ps1
// 的 fit 模式）已随监视能力删除，所以这里按**意图**改写：
//
//   * 真正被删除的能力 → 反向断言（不存在），这样"删干净"本身成为可执行检查；
//   * 真正被保留的能力 → 断言不变（枚举用的 list 模式、HWND 身份校验、原生托管的
//     attach/move/suspend/resume/detach 与它的几何跟随）。
//
// 文件名保留（而不是删掉再建一个），因为运行器按文件名报告结果，改名会让"哪一条契约
// 变了"这件事在报告里变成"少了一条、多了一条"。

const assert = require('assert');
const { isRegistered } = require('./lib/source-anchors');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// 断言"某个符号已经消失"时必须只看**代码**：删除说明写在注释里（用户要求把删除原因写在
// 代码旁），而注释里出现旧符号名不应该让这条契约失败。这个剥离器认得 `'` / `"` / 模板
// 字符串与转义，因此不会把字符串里出现的 `//`（例如 URL）误当成注释起点。
function codeOnly(source) {
  let out = '';
  let index = 0;
  let quote = '';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next ?? ''; index += 2; continue; }
      if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') { while (index < source.length && source[index] !== '\n') index += 1; continue; }
    if (char === '/' && next === '*') { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue; }
    if (char === "'" || char === '"' || char === '`') quote = char;
    out += char;
    index += 1;
  }
  return out;
}

// PowerShell uses `#`, and every comment in win-window-monitor.ps1 is a FULL-LINE comment,
// so dropping `#`-leading lines is exact here — and it cannot touch the here-string C# body
// (which contains no `#`). Keeping the stripper this narrow is deliberate: a general PS
// comment stripper would have to model here-strings to be correct, and a wrong one silently
// hides the thing the contract is looking for.
const psCode = (source) => source.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

const monitor = codeOnly(read('app/windows-monitor.js'));
const main = codeOnly(read('app/main.js'));
const preload = codeOnly(read('app/preload.js'));
const renderer = codeOnly(read('app/renderer/renderer.js'));
const css = codeOnly(read('app/renderer/ui-overrides.css'));
const powershell = psCode(read('app/win-window-monitor.ps1'));
const nativeHost = read('app/codesys-native-host.js');
const nativePowerShell = read('app/win-window-host.ps1');

// ── 1. 窗口枚举：保留的部分逐条在场 ────────────────────────────────────────────
for (const method of ['async listRawWindows()', 'async listWindows(options = {})', 'pruneCaptures(keep = 20', 'cachedWindow(windowId)', 'invalidateWindow(windowId)', 'async resolveWindow(windowId)', 'async resolveDesktopSource(windowId)']) {
  assert(monitor.includes(method), `窗口枚举/身份方法必须保留：${method}`);
}
// 监视能力删除后，同一模块里那些只服务画面的方法必须消失。
for (const removed of ['fitWindowToCanvas', 'captureNative', 'async capture(', 'startStream', 'stopStream', 'stopAll']) {
  assert(!monitor.includes(removed), `只服务监视的方法必须删除：${removed}`);
}
assert(!monitor.includes('this.streams'), '画面流状态表（streams）必须删除');
assert(!/require\('crypto'\)/.test(monitor), '只有旧画面捕获用得上的 crypto 必须一并删除');
assert(monitor.includes("require('./codesys-capture-contract')"), '窗口→桌面源身份映射仍需 codesys-capture-contract');
// ── 2. win-window-monitor.ps1 只剩 list 模式 ──────────────────────────────────
assert(powershell.includes("ValidateSet('list')"), 'list 模式必须保留');
assert(!powershell.includes("'capture'") && !powershell.includes("'fit'"), 'capture / fit 模式必须删除');
assert(!powershell.includes('PrintWindow'), 'PrintWindow 抓帧必须删除');
assert(!powershell.includes('SetWindowPos'), '把窗口改写进插件画布的 SetWindowPos 必须删除');
assert(!powershell.includes('-OutputPath') && !powershell.includes('-ExpectedPid'), 'capture / fit 专用参数必须删除');
// 枚举本身仍然只认验证过的 CODESYS 进程，并给出可用的窗口身份字段。
assert(powershell.includes("$processName -match '(?i)^codesys'"), 'list 模式仍只枚举 CODESYS 进程');
assert(powershell.includes('usable = (-not $minimized) -and $width -ge 320 -and $height -ge 200'), 'list 模式仍标注窗口是否可用');
// 这个脚本没有 BOM，PS 5.1 按 ANSI 读；注释必须保持 ASCII，否则解析会坏在 param 块上。
// eslint-disable-next-line no-control-regex
assert(!/[^\x00-\x7F]/.test(powershell), 'win-window-monitor.ps1 必须整体是 ASCII（无 BOM 时非 ASCII 注释会破坏 PS 5.1 解析）');
// T187：枚举脚本报告的矩形必须与原生托管脚本同单位。默认 powershell.exe 5.1 是
// DPI-UNAWARE，会把 2560x1600@150% 的桌面报成 1707x1067 并把每个矩形除以 1.5（实测），
// 而这些矩形正是脱管时写回去的还原几何，所以两个脚本都必须在读第一个矩形之前切到
// per-monitor-v2（DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4）。
assert(powershell.includes('[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);'), 'win-window-monitor.ps1 必须声明 SetProcessDpiAwarenessContext');
assert(powershell.includes('[TaskHiveWin]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))'), 'win-window-monitor.ps1 必须切到 per-monitor DPI 感知（否则矩形是虚拟化的 96-DPI 数字）');

// ── 3. 主进程：删掉的通道不再注册，保留的通道逐条在场 ────────────────────────
for (const gone of ['codesys:fit-window', 'codesys:capture', 'codesys:stream-source', 'codesys:stream-start', 'codesys:stream-stop', 'codesys:visual-status', 'codesys:visual-analyze']) {
  assert(!isRegistered(main, gone), `已删除的能力不得再注册通道：${gone}`);
}
assert(!/require\(['"]\.\/modlens['"]\)/.test(main), '主进程不得再 require ./modlens');
assert(!main.includes('ModLensExecutor'), '主进程不得再实例化 ModLens 执行器');
assert(main.includes("'modlens-vision'"), 'modlens-vision 必须留在 RETIRED_CATALOG_PROVIDER_IDS 里（清掉已持久化的目录项）');
assert(isRegistered(main, 'codesys:list-windows'), '窗口枚举通道必须保留');
for (const kept of ['codesys:native-host-attach', 'codesys:native-host-move', 'codesys:native-host-detach', 'codesys:preferred-window', 'codesys:native-host-status']) {
  assert(isRegistered(main, kept), `原生窗口托管通道必须保留：${kept}`);
}
for (const kept of ['codesys:workbench-open', 'codesys:code-ai-request', 'codesys:scriptengine-status', 'codesys:ai-chat']) {
  assert(isRegistered(main, kept), `工作台/脚本引擎/AI 对话通道必须保留：${kept}`);
}
assert(main.includes("mode: 'plugin-native-window'") && main.includes("nativeHostMode: 'automatic-exact-hwnd'"));
assert(main.includes("scope: 'current-taskhive-plugin-exact-hwnd-only'"));
assert(!main.includes('production-native-docking-disabled'));
// T193：原生托管通道仍然核对"调用来自 CODESYS 面板"，但判据从"当前 surface 恰好是 codesys"
// 换成 panelSenderDecision（外壳 WebContents 顶层 app/renderer 文档）—— 见
// codesys-panel-sender-gate-contract.js 的双向断言。这里只钉"那一刻仍然做了面板身份核对"。
assert((main.match(/if \(!isCodesysPanelSender\(event\)\)/g) || []).length >= 3,
  '原生托管通道（attach / move / reload-project）必须仍然核对"调用来自 CODESYS 面板"');
assert(main.includes("codesysNativeHost?.suspend('surface-hidden')"));
assert(main.includes("codesysNativeHost?.suspend('plugin-switch')"));
assert(!main.includes("detach('surface-hidden')") && !main.includes("detach('plugin-switch')") && !main.includes("detach('close-prompt')"));
assert(main.includes("detach('application-shutdown')") && main.includes("codesysNativeHost.detach('user')"));
// T193：面板重新可见时仍然要 resume，但那次 await 必须**有界**（真机上一处无超时的 resume
// 曾把"面板可见"与"identity 落笔"卡在一起，抽屉随后被自己的身份门拒了 2604 次）。
assert(/Promise\.race\(\[\s*\n?\s*codesysNativeHost\.resume\(bounds\)\.catch\(\(\) => \{\}\)/.test(main),
  '面板重新可见时必须 resume，而且必须在 Promise.race 里带超时');
// preload 侧：删掉的 API 不得再暴露，否则界面能拿到一个必定失败的孤儿通道。
for (const gone of ['fitCodesysWindow', 'captureCodesys', 'resolveCodesysStreamSource', 'startCodesysStream', 'stopCodesysStream', 'onCodesysFrame', 'visualStatus', 'analyzeCapture']) {
  assert(!preload.includes(gone), `preload 不得再暴露已删除的 API：${gone}`);
}
for (const kept of ['listCodesysWindows', 'attachCodesysNativeHost', 'moveCodesysNativeHost', 'detachCodesysNativeHost', 'codesysNativeHostStatus']) {
  assert(preload.includes(kept), `preload 必须保留：${kept}`);
}

// ── 4. 原生托管实现：attach/move/suspend/resume/detach 与几何跟随 ────────────
assert(renderer.includes('原生窗口载入失败'));
assert(renderer.includes('class="codesys-head-row"'));
assert(renderer.includes('await attachSelectedCodesysNativeHost()'));
assert(renderer.includes('followLaunchedCodesysMainWindow'));
assert(renderer.includes('attempt < 900'));
assert(renderer.includes("panel.classList.add('native-host-active')"));
assert(renderer.includes('鼠标键盘直达 CODESYS'));
assert(renderer.includes("codesysToolbarButton('codesys-ai-toggle'"));
assert(renderer.includes('installCodesysNativeGeometryObserver'));
assert(renderer.includes('codesysNativeResizeObserver'));
assert(renderer.includes('function codesysNativeBounds('));
// 用户要求保留的 T164 成果：「AI 对话」按钮与它的通道。
assert(renderer.includes('openCodesysAiChat'));
// 监视侧的外壳代码必须消失。
for (const gone of ['fitSelectedCodesysWindowToCanvas', 'stopCodesysMediaStream', 'renderStreamFrame', 'bindCodesysPreview', 'adoptOwnedStreamWindow', 'updateCodesysStreamMetrics', 'startCodesysSnapshotFallback', 'scheduleCodesysWindowFit', 'syncCodesysPreviewGeometry', 'installCodesysPreviewGeometry', 'refreshVisionStatus', 'captureWindow', 'analyzeCapture']) {
  assert(!renderer.includes(gone), `外壳必须删除只服务监视的函数：${gone}`);
}
assert(!renderer.includes('codesys-monitor-strip'), '「AI 实时监视」状态条必须删除');
assert(!renderer.includes('id="vision-status"') && !renderer.includes('#vision-status'), '#vision-status 必须删除');
assert(!renderer.includes("codesysToolbarButton('start-stream'"));
assert(!renderer.includes("codesysToolbarButton('stop-stream'"));
assert(!renderer.includes('__TASKHIVE_CODESYS_STREAM__'), '画面流运行时指标必须删除');
assert(!renderer.includes('state.codesysMediaStream') && !renderer.includes('state.unsubscribeFrame'), '画面流状态必须删除');
// #stream-result 是**原生托管的舞台**：它保留，因为 codesysNativeBounds() 用它算 HWND 几何。
assert(renderer.includes('id="stream-result"'), '#stream-result 作为原生托管舞台必须保留');
assert(css.includes('.codesys-stream') && css.includes('background: #fff'));
assert(!css.includes('.codesys-stream > .notice'));
assert(css.includes('.codesys-stream.native-host-active') && css.includes('.codesys-native-host-placeholder'));
assert(!css.includes('.preview'), '预览图样式必须删除（监视画面已不存在）');
assert(!css.includes('codesys-monitor-strip') && !css.includes('vision-status'));
assert(css.includes('.codesys-head-row') && css.includes('overflow: visible'));
assert(css.includes('scrollbar-width: none') && css.includes('white-space: nowrap'));
assert(css.includes('@media (max-width: 1120px)') && css.includes('@media (max-width: 820px)'));
assert(css.includes('.codesys-status-action'));

// ── 5. win-window-host.ps1：原生托管的 PowerShell 侧 ────────────────────────
assert(nativeHost.includes('const candidates = await this.monitor.listWindows({ maxAgeMs: 2000 })'));
assert(nativeHost.includes('const target = candidates.find(') && nativeHost.includes('target.usable === false'));
assert(nativeHost.includes("mode: 'owned-native-host'") && nativeHost.includes("humanInput: 'native-hwnd-direct'"));
assert(nativePowerShell.includes('$WS_EX_TOOLWINDOW') && nativePowerShell.includes('$WS_EX_APPWINDOW'));
assert(nativePowerShell.includes('$taskbarHidden = (($actualExStyle -band $WS_EX_TOOLWINDOW) -ne 0)'));
assert(nativePowerShell.includes("ValidateSet('attach', 'move', 'suspend', 'resume', 'detach')"));
assert(nativePowerShell.includes("if ($Mode -eq 'suspend')") && nativePowerShell.includes('$SW_HIDE = 0'));
assert(nativePowerShell.includes("if ($Mode -eq 'resume')") && nativePowerShell.includes('$SW_SHOWNA = 8'));
assert(nativeHost.includes('suspended: this.session.suspended === true'));
assert(nativeHost.includes("suspend(reason = 'surface-switch')") && nativeHost.includes('resume(bounds)'));
assert(nativeHost.includes("this.audit('suspended'") && nativeHost.includes("this.audit('resumed'"));
// T187：几何容差就是"窗口是否落在插件面板内"的判据，必须钉在 4 px，不许被放宽。
assert(nativeHost.includes('function geometryMismatch(requested, actual, tolerance = 4)'), 'geometryMismatch 的容差必须保持 4 px');
// T187：脚本必须自己切到 per-monitor DPI 感知，并按物理像素回报。main.js 经
// screen.dipToScreenRect 送出的是物理像素；脚本若停留在 DPI-UNAWARE 的虚拟化空间，
// 同一批数字会被 Windows 再缩一次（实测 150% 下 1.5x 且右下偏移），而脚本的回读又会把
// 缩放除回去，使 geometryMismatch 恒为 0 —— 静默贴错位置。
assert(nativePowerShell.includes('[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);'), 'win-window-host.ps1 必须声明 SetProcessDpiAwarenessContext');
assert(nativePowerShell.includes('[TaskHiveNativeHost]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))'), 'win-window-host.ps1 必须在读写任何矩形之前切到 per-monitor-v2 DPI 感知');
assert(nativePowerShell.includes("$coordinateSpace = if ($dpiAwareness -ge 2) { 'physical' } else { 'virtualized' }"), 'win-window-host.ps1 必须按实际感知级别报告坐标口径');
for (const mode of ["styleCaptured = $true", "ok=$true; mode='owned-native-dock'; identityVerified=$true; dpiAwareness"]) {
  assert(nativePowerShell.includes(mode), `每个模式的结果都必须带上坐标口径：${mode}`);
}
assert(nativePowerShell.includes('dpiAwareness=$dpiAwareness; coordinateSpace=$coordinateSpace'), 'move/suspend/resume/detach 的结果同样要带坐标口径');
// eslint-disable-next-line no-control-regex
assert(!/[^\x00-\x7F]/.test(nativePowerShell), 'win-window-host.ps1 必须整体是 ASCII（无 BOM 时非 ASCII 注释会破坏 PS 5.1 解析）');
// 退化口径不能静默：脚本报 virtualized 时必须留下独立审计事件。
assert(nativeHost.includes('function dpiCoordinateSpace(result)') && nativeHost.includes("awareness >= 2 ? 'physical' : 'virtualized'"), 'dpiCoordinateSpace 必须把非 per-monitor 感知判为 virtualized');
assert(nativeHost.includes("this.audit('native-host-coordinate-space-degraded'"), 'virtualized 口径必须留下审计事件');
// T192：导出清单里多了 `reloadProjectDetail`（"让 CODESYS 重新加载"那一行可读原因的纯函数）。
// 这一条仍然是**逐字**比对整个导出清单 —— 上面四个成员一个都不许被顺手删掉。
assert(nativeHost.includes('module.exports = { CodesysNativeHost, normalizeBounds, windowHandleHex, geometryMismatch, dpiCoordinateSpace, reloadProjectDetail }'), 'dpiCoordinateSpace 必须导出（可单测）');
// T187：几何判据本身也单测 —— 这里 require 真实模块（只依赖 fs/path，不需要 Electron）。
const { geometryMismatch, dpiCoordinateSpace } = require(path.join(root, 'app', 'codesys-native-host'));
// T187：`codesysNativeScreenBounds` 的出口必须**无条件**是物理像素 —— 托管脚本按物理像素
// 解释这四个数。dipToScreenRect 走不通时的兜底也必须换算（scaleFactor），不能原样返回 DIP。
assert(main.includes("const physical = screen.dipToScreenRect(mainWindow, dip)"), 'DIP→物理必须先走 screen.dipToScreenRect');
assert(main.includes('screen?.getDisplayNearestPoint?.({ x: dip.x, y: dip.y })?.scaleFactor'), '取不到 dipToScreenRect 时必须按显示器 scaleFactor 手工换算，不得回落成 DIP');
assert(main.includes('width: Math.round(dip.width * scaleFactor), height: Math.round(dip.height * scaleFactor)'), '兜底换算必须真的按 scaleFactor 缩放四个数');
// T187：把 codesysNativeScreenBounds 的**真实函数体**取出来，用替身喂进 DIP 几何，直接验行为。
// 这台机器实测 dpr=1.5（monitor dpi 144）；下面的 DIP 输入就是审计里那个请求的来源。
{
  const mainLf = main.replace(/\r\n/g, '\n');
  const from = mainLf.indexOf('function codesysNativeScreenBounds(');
  assert(from > 0, 'codesysNativeScreenBounds 必须存在');
  const to = mainLf.indexOf('\n}\n', from);
  assert(to > from, '必须能切出完整的 codesysNativeScreenBounds 函数体');
  const source = mainLf.slice(from, to + 3);
  const load = (screenStub) => new Function(
    'screen', 'mainWindow', 'pluginSurfaceBounds', 'codesysNativeLocalBounds',
    `${source}\nreturn codesysNativeScreenBounds();`,
  )(
    screenStub,
    { isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 2560, height: 1528 }) },
    { x: 288, y: 77.33333333333333 },
    { x: 0, y: 0, width: 984, height: 934.6666666666666 },
  );
  // 1) 正常路径：dipToScreenRect 的物理值原样返回。
  assert.deepStrictEqual(
    load({ dipToScreenRect: () => ({ x: 432, y: 116, width: 1476, height: 1402 }) }),
    { x: 432, y: 116, width: 1476, height: 1402 },
    'dipToScreenRect 可用时必须原样返回物理像素',
  );
  // 2) 兜底路径：dipToScreenRect 抛异常时按显示器 scaleFactor 换算 —— 仍然是物理像素，且与
  //    1) 只差 1 px。差 1 px 的原因是 DIP 高度先被 Math.round(934.6667)=935，935*1.5=1402.5
  //    是半整数（Math.round 进位得 1403，Electron 侧那次得到 1402）；4 px 容差内，无害。
  const fallback = load({ dipToScreenRect: () => { throw new Error('no display'); }, getDisplayNearestPoint: () => ({ scaleFactor: 1.5 }) });
  assert.deepStrictEqual(fallback, { x: 432, y: 116, width: 1476, height: 1403 }, '兜底必须仍是物理像素（150% 下 288,77,984,935 DIP -> 432,116,1476,1403）');
  assert.strictEqual(
    geometryMismatch({ x: 432, y: 116, width: 1476, height: 1402 }, fallback), 0,
    '兜底与主路径的 1 px 差必须在 4 px 容差内（否则又会写出 move-geometry-mismatch）',
  );
  // 3) 100% 缩放：scaleFactor=1 时是恒等变换。
  assert.deepStrictEqual(
    load({ getDisplayNearestPoint: () => ({ scaleFactor: 1 }) }),
    { x: 288, y: 77, width: 984, height: 935 },
    '100% 缩放下必须恒等（只有 Math.round）',
  );
}
// T187：把实测数字变成可执行断言。前半段就是用户日志里那一行（requested 432,116,1476x1402
// vs actual 432,116,1476x1087, maxDelta=315）；后半段是修复后同一请求的实测回读。
const regression = { x: 432, y: 116, width: 1476, height: 1402 };
assert.strictEqual(geometryMismatch(regression, { x: 432, y: 116, width: 1476, height: 1087 }), 315, '必须认出日志里那次 315 px 的高度截断');
assert.strictEqual(geometryMismatch(regression, { x: 648, y: 174, width: 2214, height: 1631 }), 738, '必须认出 DPI-UNAWARE 那次 1.5x + 右下偏移（实测物理矩形）');
assert.strictEqual(geometryMismatch(regression, { x: 432, y: 116, width: 1476, height: 1403 }), 0, '修复后的实测回读（差 1 px）必须在 4 px 容差内');
assert.strictEqual(geometryMismatch(regression, { x: 432, y: 116, width: 1476, height: 1087 }, 400), 0, '容差参数必须真的生效');
assert.strictEqual(geometryMismatch(null, null), 0, '取不到回读值时不误报');
assert.strictEqual(dpiCoordinateSpace({ dpiAwareness: 2 }), 'physical', 'per-monitor-v2 才是物理像素口径');
assert.strictEqual(dpiCoordinateSpace({ dpiAwareness: 0 }), 'virtualized', 'DPI-UNAWARE（修复前 powershell.exe 5.1 的默认值）必须判为 virtualized');
assert.strictEqual(dpiCoordinateSpace({}), 'virtualized', '脚本没回报感知级别时按未知处理，不得当成物理口径');

process.stdout.write('codesys native window host contract tests passed\n');
