const $ = (selector) => document.querySelector(selector);
const launchParams = new URL(location.href).searchParams;
const embeddedSurface = launchParams.get('embed') === '1';
const initialSurface = launchParams.get('surface') || 'chat';
let requestedSurface = initialSurface;
let surfaceRenderQueue = Promise.resolve();
if (embeddedSurface) document.documentElement.dataset.surfaceEmbed = 'true';
const surface = $('#surface');
const activity = $('#activity');
const title = { set textContent(value) { document.title = `TaskHive · ${value}`; } };
const badge = { set textContent(_value) {} };
const state = { windows: [], selectedWindow: null, capture: null, streamWindowId: null, codesysMediaStream: null, codesysVideoFrameRequest: null, codesysMetricsTimer: null, codesysStreamGeneration: 0, codesysFollowGeneration: 0, codesysSurfaceGeneration: 0, codesysStreamStartToken: 0, codesysStreamMetrics: null, codesysBlankSamples: 0, codesysFallbackStarting: false, codesysPreviewResizeObserver: null, codesysWindowFitTimer: null, codesysWindowFitSequence: 0, unsubscribeFrame: null, unsubscribeWebAiState: null, workspaceGeometry: null, codesysAiInputEnabled: false, codesysInputQueue: Promise.resolve(), codesysWheelDelta: 0, codesysWheelPoint: null, codesysWheelTimer: null, codesysNativeAttached: false, codesysNativeWindowId: '', codesysNativeResizeObserver: null, codesysNativeMoveTimer: null, codesysSurfaceInitialized: false };
let harnessFrame = null;
let pluginOverlay = null;
let pluginContent = null;
const sidebarState = { plugins: [], active: 'chat' };
const pluginLabels = {
  // 插件名与它注册的 surface id 都要给：侧栏按钮按插件 id 取名，顶栏标题按
  // surface id 取名（surfaceLabel(kind)），只改一处会出现"侧栏叫 A、顶栏叫 codesys"。
  'codesys-monitor': 'CODESYS 工作台',
  codesys: 'CODESYS 工作台',
  'web-ai': '浏览器',
  'knowledge-base': '知识库',
  knowledge: '知识库',
  experts: '专家',
  charts: '图表',
  'plugin-manager': '插件管理',
  packages: '插件管理',
};
const pluginGlyphs = { 'codesys-monitor': '▦', 'web-ai': '◉', 'knowledge-base': '▤', experts: '♟', 'plugin-manager': '◇' };
// 侧栏图标：CODESYS 工作台用"窗口 + 代码"的形状（原来只是一个显示器方块，和
// 浏览器/知识库的图标区分度太低）。
const CODESYS_WORKBENCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M2.5 8.5h19"/><path d="M9.6 12.3 7.5 14.2l2.1 1.9M14.4 12.3l2.1 1.9-2.1 1.9"/><path d="M8 21h8M12 17v4"/></svg>';
const sidebarIconMarkup = {
  'codesys-monitor': CODESYS_WORKBENCH_ICON,
  'web-ai': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.4 3.1 5.2 3.1 8.5S14.1 18.1 12 20.5C9.9 18.1 8.9 15.3 8.9 12S9.9 5.9 12 3.5z"/></svg>',
  'knowledge-base': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 0z"/><path d="M5 4.5v15M8 19.5h11M9 9h6M9 12h6"/></svg>',
  experts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3"/><path d="M3.8 19c.5-3.2 2.3-5 5.2-5s4.7 1.8 5.2 5"/><circle cx="17" cy="9" r="2.2"/><path d="M15.2 14.7c.6-.5 1.3-.7 2.2-.7 2.1 0 3.2 1.4 3.6 3.8"/></svg>',
  charts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
};

function annotateInteractiveControls(scope = document) {
  for (const control of scope.querySelectorAll('button,a,[role="button"],[role="tab"],select,input,textarea,summary')) {
    const fallback = String(control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.innerText || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (fallback && !control.getAttribute('title')) control.setAttribute('title', fallback);
    if (fallback && !control.getAttribute('aria-label') && !control.closest('label')) control.setAttribute('aria-label', fallback);
  }
}

const controlMetadataObserver = new MutationObserver((records) => {
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) annotateInteractiveControls(node.matches?.('button,a,[role="button"],[role="tab"],select,input,textarea,summary') ? node.parentElement || node : node);
});
controlMetadataObserver.observe(document.documentElement, { childList: true, subtree: true });
annotateInteractiveControls();

function surfaceLabel(kind) { return kind === 'chat' ? '主工作台' : (pluginLabels[kind] || kind); }

function setActiveNav(kind) {
  sidebarState.active = kind;
  document.querySelectorAll('[data-surface-nav]').forEach((node) => node.classList.toggle('active', node.dataset.surfaceNav === kind));
  const titleNode = $('#surface-title'); if (titleNode) titleNode.textContent = surfaceLabel(kind);
}

function sidebarButton(item) {
  const label = pluginLabels[item.id] || item.name || item.id;
  const glyph = pluginGlyphs[item.id] || '◇';
  const node = document.createElement('button');
  node.className = 'nav-item'; node.type = 'button'; node.draggable = true; node.dataset.surfaceNav = item.ui?.surface || item.id; node.dataset.pluginId = item.id;
  node.innerHTML = `<span class="nav-icon" aria-hidden="true">${sidebarIconMarkup[item.id] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>'}</span><span class="nav-label">${escapeHtml(label)}</span>`;
  node.title = `${label}（拖动调整顺序）`;
  node.addEventListener('click', () => { setActiveNav(node.dataset.surfaceNav); void selectSurface(node.dataset.surfaceNav); });
  node.addEventListener('dragstart', (event) => { event.dataTransfer?.setData('text/plain', item.id); node.classList.add('dragging'); });
  node.addEventListener('dragend', () => node.classList.remove('dragging'));
  node.addEventListener('dragover', (event) => event.preventDefault());
  node.addEventListener('drop', async (event) => {
    event.preventDefault(); const draggedId = event.dataTransfer?.getData('text/plain'); if (!draggedId || draggedId === item.id) return;
    const ordered = [...sidebarState.plugins]; const from = ordered.findIndex((entry) => entry.id === draggedId); const to = ordered.findIndex((entry) => entry.id === item.id); if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved); sidebarState.plugins = ordered; await Promise.all(ordered.map((entry, index) => window.taskhive.setPluginOrder({ id: entry.id, order: index }).catch(() => null))); renderSidebars();
  });
  return node;
}

async function renderSidebars() {
  const left = $('#left-plugin-nav'); const right = $('#right-plugin-nav'); if (!left || !right) return;
  let plugins = [];
  try { plugins = await window.taskhive.listPlugins(); } catch { plugins = []; }
  sidebarState.plugins = plugins.filter((item) => item.id !== 'plugin-manager' && item.installed !== false && item.state === 'enabled' && item.ui?.visible === true && item.ui?.kind !== 'tool/service-only' && item.ui?.kind !== 'settings-only' && Array.isArray(item.ui?.allowedPlacements) && item.ui.allowedPlacements.length).sort((a, b) => (Number(a.order) || 9999) - (Number(b.order) || 9999));
  left.innerHTML = ''; right.innerHTML = '';
  for (const item of sidebarState.plugins) (item.placement === 'right' ? right : left).appendChild(sidebarButton(item));
  const leftSettings = $('#left-settings'); const settingsShortcut = $('#settings-shortcut');
  [leftSettings, settingsShortcut].forEach((button) => { if (!button || button.dataset.bound) return; button.dataset.bound = '1'; button.addEventListener('click', () => { setActiveNav('settings'); void selectSurface('settings'); }); });
  const newTask = $('#new-task'); if (newTask && !newTask.dataset.bound) { newTask.dataset.bound = '1'; newTask.addEventListener('click', () => { setActiveNav('chat'); void selectSurface('chat'); }); }
  const collapse = $('#right-collapse'); if (collapse && !collapse.dataset.bound) { collapse.dataset.bound = '1'; collapse.addEventListener('click', () => { $('#right-sidebar')?.classList.toggle('collapsed'); collapse.textContent = $('#right-sidebar')?.classList.contains('collapsed') ? '‹' : '›'; }); }
  const terminalRun = $('#terminal-run'); const terminalStop = $('#terminal-stop'); const terminalInput = $('#terminal-input');
  if (terminalRun && !terminalRun.dataset.bound) {
    terminalRun.dataset.bound = '1'; let terminalTaskId = null;
    const stateNode = $('#terminal-state'); const output = $('#terminal-output');
    const appendOutput = (text) => { if (output) { output.textContent = `${output.textContent || ''}${text}`.slice(-12000); output.scrollTop = output.scrollHeight; } };
    window.taskhive.onTerminalData?.((value) => { if (terminalTaskId && value.taskId === terminalTaskId) appendOutput(value.text); });
    window.taskhive.onTerminalExit?.((value) => { if (terminalTaskId && value.taskId === terminalTaskId) { terminalTaskId = null; if (stateNode) stateNode.textContent = '就绪'; if (terminalStop) terminalStop.disabled = true; } });
    const run = async () => { const command = terminalInput?.value.trim(); if (!command || terminalTaskId) return; if (stateNode) stateNode.textContent = '执行中'; if (output) output.textContent = `$ ${command}\n`; try { const result = await window.taskhive.startTerminal(command); terminalTaskId = result.taskId; if (terminalStop) terminalStop.disabled = false; } catch (error) { appendOutput(`${error.message}\n`); if (stateNode) stateNode.textContent = '错误'; } };
    const stop = async () => { if (!terminalTaskId) return; const taskId = terminalTaskId; terminalTaskId = null; if (terminalStop) terminalStop.disabled = true; await window.taskhive.stopTerminal(taskId).catch(() => null); if (stateNode) stateNode.textContent = '已停止'; };
    terminalRun.addEventListener('click', run); terminalStop?.addEventListener('click', stop); terminalInput?.addEventListener('keydown', (event) => { if (event.key === 'Enter') void run(); });
  }
}

function log(message) {
  const item = document.createElement('li'); item.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  activity.prepend(item); while (activity.children.length > 5) activity.lastElementChild.remove();
}

function card(inner) { return `<section class="surface-card">${inner}</section>`; }

function applyWorkspaceGeometry() {
  if (!pluginOverlay || !state.workspaceGeometry) return;
  const value = state.workspaceGeometry;
  pluginOverlay.style.left = `${Math.max(0, Number(value.left) || 0)}px`;
  pluginOverlay.style.top = `${Math.max(0, Number(value.top) || 0)}px`;
  pluginOverlay.style.width = `${Math.max(0, Number(value.width) || 0)}px`;
  pluginOverlay.style.height = `${Math.max(0, Number(value.height) || 0)}px`;
}

async function ensureShell() {
  if (harnessFrame?.isConnected && pluginOverlay?.isConnected && pluginContent?.isConnected) return;
  if (embeddedSurface) {
    if (!pluginOverlay?.isConnected || !pluginContent?.isConnected) {
      surface.innerHTML = '<section id="plugin-overlay" class="plugin-overlay"><div id="plugin-content" class="plugin-content"></div></section>';
      pluginOverlay = $('#plugin-overlay');
      pluginContent = $('#plugin-content');
    }
    return;
  }
  const url = await window.taskhive.harnessUrl().catch(() => null);
  const host = url
    ? `<div class="harness-host"><iframe title="Harness DSH 工作台" src="${escapeHtml(url)}" allow="clipboard-read; clipboard-write"></iframe></div>`
    : '<div class="notice harness-unavailable">DSH Runtime 尚未就绪；当前仍可使用插件诊断和只读能力。</div>';
  surface.innerHTML = `<div class="harness-shell">${host}</div><section id="plugin-overlay" class="plugin-overlay" hidden><div id="plugin-content" class="plugin-content"></div></section>`;
  harnessFrame = surface.querySelector('iframe[title*="Harness"]');
  pluginOverlay = $('#plugin-overlay');
  pluginContent = $('#plugin-content');
  applyWorkspaceGeometry();
}

async function showPluginSurface(markup) {
  await ensureShell();
  pluginContent.innerHTML = markup;
  pluginContent.querySelectorAll('button,a,[role="button"],select,input,textarea,summary').forEach((control) => {
    const fallback = String(control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.innerText || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (fallback && !control.getAttribute('title')) control.setAttribute('title', fallback);
    if (fallback && !control.getAttribute('aria-label') && !control.closest('label')) control.setAttribute('aria-label', fallback);
  });
  applyWorkspaceGeometry();
  pluginOverlay.hidden = false;
}

async function renderChat() {
  if (embeddedSurface && initialSurface !== 'chat') return selectSurface(initialSurface);
  title.textContent = '主工作台'; badge.textContent = '';
  await ensureShell();
  pluginOverlay.hidden = true;
  pluginContent.innerHTML = '';
}

const codesysToolbarIcons = {
  refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.4-2.6L20 9M4 15l2.5 2.6A7 7 0 0 0 17.9 15"/>',
  start: '<path d="m9 7 8 5-8 5z"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  capture: '<path d="M4 8h4l1.5-2h5L16 8h4v10H4z"/><circle cx="12" cy="13" r="3"/>',
  vision: '<path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5z"/><circle cx="12" cy="12" r="2.5"/>',
  ai: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4"/>',
  native: '<rect x="3" y="4" width="18" height="14" rx="1"/><path d="M8 21h8M12 18v3M7 9h10M7 13h6"/>',
  script: '<path d="M7 3h8l3 3v15H7z"/><path d="M15 3v4h4M10 11h5M10 15h5"/>',
  probe: '<path d="M10 3h4M11 3v6l-5 8a2 2 0 0 0 1.7 3h8.6a2 2 0 0 0 1.7-3l-5-8V3"/><path d="M8.5 15h7"/>',
};

function codesysToolbarButton(id, label, icon, options = {}) {
  const pressed = options.pressed === undefined ? '' : ` aria-pressed="${options.pressed}"`;
  const disabled = options.disabled ? ' disabled' : '';
  return `<button class="${options.primary ? 'primary' : 'secondary'} codesys-icon-button${options.text ? ' has-text' : ''}${options.active ? ' active' : ''}" id="${id}" type="button" title="${label}" aria-label="${label}"${pressed}${disabled}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${codesysToolbarIcons[icon]}</svg>${options.text ? `<span>${escapeHtml(options.text)}</span>` : ''}</button>`;
}

async function renderCodesys() {
  await teardownCodesysSurface();
  state.codesysSurfaceGeneration += 1;
  state.codesysAiInputEnabled = false;
  title.textContent = 'CODESYS'; badge.textContent = '屏幕与离线检查';
  await showPluginSurface(`<section class="codesys-surface"><div class="codesys-head-row"><div class="codesys-toolbar" role="toolbar" aria-label="CODESYS 操作"><button class="codesys-toolbar-button" id="open-codesys-program" type="button" title="打开独立的 CODESYS 程序；切换插件或会话不会关闭；退出 TaskHive 时会自动关闭本插件启动的实例（工程有未保存改动时保留）">打开 CODESYS</button><select id="window-list" aria-label="CODESYS 窗口" title="选择由本插件打开、供 AI 监视和操作的 CODESYS 窗口"><option value="">正在枚举 CODESYS 窗口…</option></select><span class="codesys-toolbar-group">${codesysToolbarButton('refresh-windows', '刷新本插件打开的 CODESYS 窗口', 'refresh')}</span><span class="codesys-toolbar-group">${codesysToolbarButton('codesys-ai-toggle', 'AI 操作已关闭；点击后同时开启实时监视和 AI 输入', 'ai', { pressed: false, text: 'AI 操作' })}</span><span class="codesys-toolbar-group">${codesysToolbarButton('codesys-workbench', '打开 CODESYS 专用工作台', 'script', { text: '代码任务' })}</span></div><div class="codesys-monitor-strip" id="codesys-stream-status" aria-live="polite">AI 实时监视已关闭 · “打开 CODESYS”只启动可人工操作的原生窗口</div><div class="codesys-status-strip"><span id="vision-status">正在检查视觉路由…</span><span id="input-status">AI 操作已关闭 · 不监视画面、不发送输入</span><span class="codesys-scriptengine-cell"><span id="scriptengine-status">正在检查 ScriptEngine…</span><button class="codesys-status-action" id="scriptengine-configure" type="button" hidden>安装/配置</button><button class="codesys-status-action" id="scriptengine-recheck" type="button">重新检测</button></span></div></div><div class="codesys-output-tray"><div id="capture-result"></div><div id="scriptengine-result"></div></div><div id="stream-result" class="stream-panel codesys-stream"><div class="empty">先打开或选择 CODESYS；需要 AI 查看和操作时再开启“AI 操作”</div></div></section>`);
  $('#open-codesys-program').onclick = async () => {
    const status = $('#input-status');
    // Opening CODESYS is an explicit request to work with the new instance.
    // Once its HWND appears, show that exact window immediately instead of
    // leaving the large preview area dark until the user finds the play icon.
    const restartStream = false;
    try {
      status.textContent = '正在使用已验证的 CODESYS 配置启动…';
      const result = await window.taskhive.openCodesysProgram();
      status.textContent = `CODESYS 进程已启动 · PID ${Number(result.pid || 0)} · 正在等待对应窗口…`;
      const selected = await waitForLaunchedCodesysWindow(result.pid, restartStream);
      if (!$('#input-status')) return;
      if (selected) {
        await attachSelectedCodesysNativeHost();
      }
      status.textContent = selected
        ? `真实 CODESYS 已进入插件 · PID ${Number(selected.pid || 0)} · 鼠标键盘直接操作 · 任务栏隐藏 · 只有你手动关闭才会结束`
        : `外部 CODESYS 已启动 · ${result.profile} · 尚未发现新窗口，请稍后刷新窗口列表`;
      if (selected?.windowPhase === 'launch') void followLaunchedCodesysMainWindow(result.pid, selected.id);
    } catch (error) { if (status) status.textContent = `打开 CODESYS 失败：${error.message}`; }
  }; $('#refresh-windows').onclick = async () => { const selected = await refreshWindows(); if (selected?.fixture !== true) await attachSelectedCodesysNativeHost(); }; $('#codesys-ai-toggle').onclick = toggleCodesysAiInput; $('#codesys-workbench').onclick = async () => { await window.taskhive.openCodesysWorkbench({ windowId: state.selectedWindow?.id || '', pid: state.selectedWindow?.pid || 0, title: state.selectedWindow?.title || '' }); }; $('#scriptengine-recheck').onclick = refreshScriptEngineStatus; $('#scriptengine-configure').onclick = configureScriptEngine;
  state.codesysSurfaceInitialized = true;
  await Promise.all([refreshVisionStatus(), refreshScriptEngineStatus()]);
  const selected = await refreshWindows();
  if (selected?.fixture !== true) await attachSelectedCodesysNativeHost();
}

function stopCodesysMediaStream(reason = 'stopped') {
  state.codesysStreamGeneration += 1;
  // Ending the live view also ends the armed AI-input session. Without this the
  // main-process gate would stay armed after the operator stopped watching.
  void window.taskhive.armCodesysInput({ armed: false, windowId: '' }).catch(() => null);
  const video = $('#stream-result video.preview');
  if (video && state.codesysVideoFrameRequest !== null && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(state.codesysVideoFrameRequest);
  state.codesysVideoFrameRequest = null;
  if (state.codesysMetricsTimer) clearInterval(state.codesysMetricsTimer);
  state.codesysMetricsTimer = null;
  state.codesysPreviewResizeObserver?.disconnect();
  state.codesysPreviewResizeObserver = null;
  const stream = state.codesysMediaStream;
  state.codesysMediaStream = null;
  state.codesysBlankSamples = 0;
  for (const track of stream?.getTracks?.() || []) track.stop();
  if (video) { try { video.pause(); } catch {} video.srcObject = null; }
  const metrics = state.codesysStreamMetrics || { frames: 0, fps: 0, latencyMs: 0, droppedFrames: 0 };
  state.codesysStreamMetrics = { ...metrics, active: false, reason, stoppedAt: new Date().toISOString() };
  window.__TASKHIVE_CODESYS_STREAM__ = state.codesysStreamMetrics;
  return state.codesysStreamMetrics;
}

async function fitSelectedCodesysWindowToCanvas(expectedWindowId = '') {
  const panel = $('#stream-result');
  const selected = state.selectedWindow;
  const windowId = String(expectedWindowId || selected?.id || '');
  if (!panel || !selected || !windowId || String(selected.id) !== windowId) return null;
  const canvasWidth = Math.max(1, Math.floor(panel.clientWidth - 2));
  const canvasHeight = Math.max(1, Math.floor(panel.clientHeight - 2));
  if (canvasWidth < 320 || canvasHeight < 200) return null;
  const sequence = ++state.codesysWindowFitSequence;
  const result = await window.taskhive.fitCodesysWindow({ id: windowId, canvasWidth, canvasHeight });
  if (sequence !== state.codesysWindowFitSequence || String(state.selectedWindow?.id || '') !== windowId) return null;
  state.selectedWindow = { ...state.selectedWindow, left: result.left, top: result.top, width: result.width, height: result.height, minimized: false, usable: true, fittedToPluginCanvas: true };
  const index = state.windows.findIndex((item) => String(item.id) === windowId);
  if (index >= 0) state.windows[index] = state.selectedWindow;
  panel.dataset.canvasWidth = String(canvasWidth);
  panel.dataset.canvasHeight = String(canvasHeight);
  panel.dataset.fittedWindowWidth = String(result.width || 0);
  panel.dataset.fittedWindowHeight = String(result.height || 0);
  panel.dataset.windowFitRatioError = String(Math.abs(Number(result.windowRatio || 0) - Number(result.canvasRatio || 0)));
  return result;
}

function scheduleCodesysWindowFit(windowId = '', delayMs = 160) {
  if (state.codesysWindowFitTimer) clearTimeout(state.codesysWindowFitTimer);
  const expectedWindowId = String(windowId || state.selectedWindow?.id || '');
  if (!expectedWindowId) return;
  state.codesysWindowFitTimer = setTimeout(() => {
    state.codesysWindowFitTimer = null;
    void fitSelectedCodesysWindowToCanvas(expectedWindowId).catch((error) => {
      const status = $('#input-status');
      if (status) status.textContent = `CODESYS 窗口适配插件画布失败：${error.message}`;
    });
  }, Math.max(0, delayMs));
}

function syncCodesysPreviewGeometry(media, sourceWidth, sourceHeight) {
  const panel = $('#stream-result');
  const width = Math.max(1, Number(sourceWidth || media?.videoWidth || media?.naturalWidth || 0));
  const height = Math.max(1, Number(sourceHeight || media?.videoHeight || media?.naturalHeight || 0));
  if (!panel || !media || width <= 1 || height <= 1) return;
  media.style.width = '100%';
  media.style.height = '100%';
  media.style.aspectRatio = 'auto';
  media.dataset.sourceWidth = String(width);
  media.dataset.sourceHeight = String(height);
  media.dataset.fitMode = 'window-to-plugin-canvas';
}

function installCodesysPreviewGeometry(media, sourceWidth, sourceHeight) {
  state.codesysPreviewResizeObserver?.disconnect();
  syncCodesysPreviewGeometry(media, sourceWidth, sourceHeight);
  const panel = $('#stream-result');
  if (!panel || typeof ResizeObserver !== 'function') return;
  state.codesysPreviewResizeObserver = new ResizeObserver(() => {
    syncCodesysPreviewGeometry(media, Number(media.dataset.sourceWidth), Number(media.dataset.sourceHeight));
    if (state.codesysNativeAttached) {
      const bounds = codesysNativeBounds();
      if (bounds) void window.taskhive.moveCodesysNativeHost(bounds).catch(() => null);
    } else scheduleCodesysWindowFit(state.streamWindowId || state.selectedWindow?.id || '');
  });
  state.codesysPreviewResizeObserver.observe(panel);
}

function codesysVideoFrameLooksBlack(video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 18;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nearBlack = 0;
    const samples = pixels.length / 4;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] <= 8 && pixels[offset + 1] <= 8 && pixels[offset + 2] <= 8) nearBlack += 1;
    }
    return samples > 0 && nearBlack / samples >= 0.98;
  } catch { return false; }
}

async function startCodesysSnapshotFallback(windowId, options = {}) {
  if (state.codesysFallbackStarting || String(state.selectedWindow?.id || '') !== String(windowId || '')) return;
  state.codesysFallbackStarting = true;
  const panel = $('#stream-result');
  try {
    stopCodesysMediaStream('black-frame-fallback');
    try { state.unsubscribeFrame?.(); } catch {}
    state.unsubscribeFrame = window.taskhive.onCodesysFrame(renderOwnedStreamFrame);
    state.streamWindowId = String(windowId);
    const status = $('#codesys-stream-status');
    if (status) status.textContent = options.direct === true ? '正在连接 AI 实时监视 · 启动窗口结束后会自动接管同一插件进程的主 IDE…' : 'AI 实时监视检测到异常画面，正在切换到 Windows HWND 原生采集…';
    if (panel && !panel.querySelector('img.preview')) panel.innerHTML = '<div class="empty">正在连接 AI 实时监视…</div>';
    await window.taskhive.startCodesysStream({ id: windowId, intervalMs: 350, forceNative: true, followPid: options.followPid === true });
  } catch (error) {
    try { state.unsubscribeFrame?.(); } catch {}
    state.unsubscribeFrame = null;
    const status = $('#codesys-stream-status');
    if (status) status.textContent = `AI 实时监视启动失败：${error.message}`;
    if (panel) panel.innerHTML = '<div class="empty">AI 实时监视暂不可用</div>';
  } finally { state.codesysFallbackStarting = false; }
}

function updateCodesysStreamMetrics(video, panel, status, source, generation, now, metadata = {}) {
  if (generation !== state.codesysStreamGeneration || !state.codesysMediaStream) return;
  const metrics = state.codesysStreamMetrics;
  const reportedFrames = Number(metadata.presentedFrames || metadata.totalVideoFrames || 0);
  metrics.frames = reportedFrames > 0 ? Math.max(metrics.frames, reportedFrames) : metrics.frames + 1;
  if (!metrics.firstFrameAt) { metrics.firstFrameAt = now; metrics.firstFrameNumber = metrics.frames; }
  const elapsed = Math.max(1, now - metrics.firstFrameAt);
  metrics.fps = metrics.frames > metrics.firstFrameNumber ? ((metrics.frames - metrics.firstFrameNumber) * 1000) / elapsed : 0;
  metrics.latencyMs = metadata.expectedDisplayTime !== undefined
    ? Math.max(0, Math.round(now - Number(metadata.expectedDisplayTime)))
    : Math.max(0, Number(metadata.fallbackPollIntervalMs || 0));
  // Persistent MediaStream has no application frame queue to overrun. Keep
  // Chromium's compositor optimization counter as separate diagnostics: a
  // static desktop window can legitimately mark repeated frames as dropped.
  metrics.droppedFrames = 0;
  metrics.compositorDroppedFrames = Number(video.getVideoPlaybackQuality?.().droppedVideoFrames || 0);
  metrics.width = Number(video.videoWidth || source.width || 0);
  metrics.height = Number(video.videoHeight || source.height || 0);
  metrics.lastFrameAt = new Date().toISOString();
  panel.dataset.frameCount = String(metrics.frames);
  panel.dataset.fps = metrics.fps.toFixed(1);
  panel.dataset.latencyMs = String(metrics.latencyMs);
  panel.dataset.droppedFrames = String(metrics.droppedFrames);
  window.__TASKHIVE_CODESYS_STREAM__ = { ...metrics };
  if (!metrics.lastStatusAt || now - metrics.lastStatusAt >= 200 || metrics.frames <= 2) {
    metrics.lastStatusAt = now;
    status.textContent = `实时监视中 · 完整画面 ${metrics.width}×${metrics.height} · FPS ${metrics.fps.toFixed(1)} · 延迟 ${metrics.latencyMs}ms · 丢帧 ${metrics.droppedFrames} · 重连 0 · 连接正常 · 最后一帧 ${new Date().toLocaleTimeString()}`;
  }
  if (!metrics.lastBlankProbeAt || now - metrics.lastBlankProbeAt >= 500) {
    metrics.lastBlankProbeAt = now;
    const blank = codesysVideoFrameLooksBlack(video);
    state.codesysBlankSamples = blank ? state.codesysBlankSamples + 1 : 0;
    metrics.blankFrameSamples = state.codesysBlankSamples;
    if (state.codesysBlankSamples >= 3) void startCodesysSnapshotFallback(state.streamWindowId);
  }
  if (typeof video.requestVideoFrameCallback === 'function') state.codesysVideoFrameRequest = video.requestVideoFrameCallback((nextNow, nextMetadata) => updateCodesysStreamMetrics(video, panel, status, source, generation, nextNow, nextMetadata));
}

async function startStream(options = {}) {
  if (!state.selectedWindow) { log('请先选择 CODESYS 窗口'); return; }
  // Serialise overlapping starts. The AI toggle and the window picker can both
  // call startStream, and an unguarded overlap orphans the earlier
  // getUserMedia desktop stream because only state.codesysMediaStream is
  // stopped afterwards.
  const startToken = ++state.codesysStreamStartToken;
  const superseded = () => startToken !== state.codesysStreamStartToken;
  if (options.skipFit !== true && !state.codesysNativeAttached) {
    try { await fitSelectedCodesysWindowToCanvas(state.selectedWindow.id); }
    catch (error) { const fitStatus = $('#input-status'); if (fitStatus) fitStatus.textContent = `CODESYS 窗口适配插件画布失败：${error.message}`; }
  }
  if (superseded()) return;
  if (state.selectedWindow.usable === false) { const reason = state.selectedWindow.reason || '窗口未恢复'; const status = $('#codesys-stream-status'); if (status) status.textContent = `AI 实时监视未启动：当前窗口不可捕获完整画面（${reason}），请恢复 CODESYS 后刷新窗口`; const streamPanel = $('#stream-result'); if (streamPanel) streamPanel.innerHTML = '<div class="empty">请先恢复 CODESYS 原生窗口</div>'; log('CODESYS 窗口尚未恢复，未启动画面流'); return; }
  const panel = $('#stream-result');
  if (!panel) return;
  const previousStreamWindowId = state.streamWindowId;
  try { state.unsubscribeFrame?.(); } catch {}
  state.unsubscribeFrame = null;
  if (previousStreamWindowId) await window.taskhive.stopCodesysStream(previousStreamWindowId).catch(() => null);
  stopCodesysMediaStream('restart');
  if (state.selectedWindow.fixture !== true) {
    await startCodesysSnapshotFallback(state.selectedWindow.id, { direct: true, followPid: options.followPid === true });
    log('真实 CODESYS 已使用 Windows HWND 原生画面流，启动窗口结束后自动接管主 IDE');
    return;
  }
  try {
    const source = await window.taskhive.resolveCodesysStreamSource({ id: state.selectedWindow.id });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.sourceId, minFrameRate: 10, maxFrameRate: 15 } } });
    const generation = ++state.codesysStreamGeneration;
    state.streamWindowId = state.selectedWindow.id;
    state.codesysMediaStream = stream;
    state.codesysStreamMetrics = { active: true, transport: 'renderer-media-stream', sourceId: source.sourceId, frames: 0, fps: 0, latencyMs: 0, droppedFrames: 0, reconnects: 0, startedAt: new Date().toISOString() };
    window.__TASKHIVE_CODESYS_STREAM__ = { ...state.codesysStreamMetrics };
    panel.innerHTML = '<video class="preview" aria-label="CODESYS 实时画面" autoplay muted playsinline tabindex="0"></video>';
    const status = $('#codesys-stream-status');
    if (status) status.textContent = '正在连接 AI 持久实时监视…';
    const video = panel.querySelector('video.preview');
    video.title = state.codesysAiInputEnabled ? 'AI 操作已开启：点击、滚轮和键盘会直接映射到 CODESYS' : 'AI 操作已关闭：画面只读';
    bindCodesysPreview(video);
    video.srcObject = stream;
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('CODESYS 视频元数据等待超时')), 8000); video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); }; video.onerror = () => { clearTimeout(timeout); reject(new Error('CODESYS 视频流加载失败')); }; });
    await video.play();
    installCodesysPreviewGeometry(video, video.videoWidth || source.width, video.videoHeight || source.height);
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (generation !== state.codesysStreamGeneration) return; stopCodesysMediaStream('track-ended'); if (status) status.textContent = '实时监视已断开：CODESYS 窗口或采集源已关闭'; });
    if (typeof video.requestVideoFrameCallback === 'function') state.codesysVideoFrameRequest = video.requestVideoFrameCallback((now, metadata) => updateCodesysStreamMetrics(video, panel, status, source, generation, now, metadata));
    // Chromium can suppress requestVideoFrameCallback when Electron runs with
    // --disable-gpu even though decoded frames continue. Playback quality is an
    // independent, real decoded-frame counter and also acts as a watchdog.
    // Re-check the generation before installing it: stopCodesysMediaStream()
    // may have run during the awaits above, in which case it already cleared a
    // null handle and this interval would never be cleared again.
    if (generation !== state.codesysStreamGeneration || superseded()) return;
    state.codesysMetricsTimer = setInterval(() => {
      if (generation !== state.codesysStreamGeneration || !state.codesysMediaStream) return;
      const quality = video.getVideoPlaybackQuality?.();
      const totalVideoFrames = Number(quality?.totalVideoFrames || 0);
      if (totalVideoFrames > Number(state.codesysStreamMetrics?.frames || 0)) updateCodesysStreamMetrics(video, panel, status, source, generation, performance.now(), { totalVideoFrames, fallbackPollIntervalMs: 100 });
    }, 100);
    log('CODESYS 持久实时视频流已启动');
  } catch (error) {
    stopCodesysMediaStream('start-error');
    const status = $('#codesys-stream-status');
    if (status) status.textContent = `AI 实时监视启动失败：${error.message}`;
    if (panel && !panel.querySelector('img.preview')) panel.innerHTML = '<div class="empty">AI 实时监视暂不可用；正在保留原生 CODESYS 画面</div>';
    log('CODESYS 实时画面流启动失败');
  }
}

async function stopStream() {
  const streamWindowId = state.streamWindowId || state.selectedWindow?.id;
  const metrics = stopCodesysMediaStream('user-stop');
  try { state.unsubscribeFrame?.(); } catch {}
  state.unsubscribeFrame = null;
  state.streamWindowId = null;
  if (streamWindowId) { try { await window.taskhive.stopCodesysStream(streamWindowId); } catch {} }
  const status = $('#codesys-stream-status');
  if (status) status.textContent = `AI 实时监视已停止 · 帧数 ${metrics.frames || 0} · CODESYS 原生窗口继续运行`;
  log('CODESYS 实时画面流已停止');
}

async function teardownCodesysSurface() {
  // Leaving the surface must not destroy the user-owned CODESYS HWND. The
  // desktop host suspends it; when we return it is resumed at the same bounds.
  // Bumping the surface generation stops any in-flight follow loop, which
  // otherwise kept polling (and spawning a PowerShell per second) for 15 min
  // after the surface it belonged to had been re-rendered.
  state.codesysSurfaceGeneration += 1;
  state.codesysFollowGeneration += 1;
  state.codesysStreamStartToken += 1;
  const streamWindowId = state.streamWindowId;
  state.streamWindowId = null;
  if (state.codesysWheelTimer) clearTimeout(state.codesysWheelTimer);
  if (state.codesysNativeMoveTimer) clearTimeout(state.codesysNativeMoveTimer);
  if (state.codesysWindowFitTimer) clearTimeout(state.codesysWindowFitTimer);
  state.codesysWheelTimer = null;
  state.codesysNativeMoveTimer = null;
  state.codesysWindowFitTimer = null;
  state.codesysWindowFitSequence += 1;
  state.codesysWheelDelta = 0;
  state.codesysWheelPoint = null;
  state.codesysPreviewResizeObserver?.disconnect();
  state.codesysPreviewResizeObserver = null;
  state.codesysNativeResizeObserver?.disconnect();
  state.codesysNativeResizeObserver = null;
  // Keep the preview DOM and last good frame. Only the optional AI monitor
  // transport is stopped to avoid background capture work while hidden.
  const unsubscribe = state.unsubscribeFrame;
  state.unsubscribeFrame = null;
  try { unsubscribe?.(); } catch {}
  stopCodesysMediaStream('surface-switch');
  if (streamWindowId) {
    try { await window.taskhive.stopCodesysStream(streamWindowId); } catch {}
  }
}

function codesysNativeBounds(selected = state.selectedWindow) {
  const panel = $('#stream-result');
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  let width = Math.max(320, Math.round(rect.width));
  let height = Math.max(200, Math.round(rect.height));
  let x = Math.round(rect.x);
  let y = Math.round(rect.y);
  if (selected?.windowPhase === 'launch') {
    width = Math.min(width, Math.max(320, Math.round(Number(selected.width) || width)));
    height = Math.min(height, Math.max(200, Math.round(Number(selected.height) || height)));
    x += Math.max(0, Math.round((rect.width - width) / 2));
    y += Math.max(0, Math.round((rect.height - height) / 2));
  }
  return { x, y, width, height };
}

function syncCodesysNativeButton() { const button = $('#codesys-native-toggle'); if (!button) return; button.classList.toggle('active', state.codesysNativeAttached); button.setAttribute('aria-pressed', String(state.codesysNativeAttached)); button.title = state.codesysNativeAttached ? '停止托管并恢复 CODESYS 原始窗口样式和位置' : '在中央区域托管真实 CODESYS 窗口；鼠标、键盘和滚轮走原生通道'; }

function installCodesysNativeGeometryObserver() { state.codesysNativeResizeObserver?.disconnect(); const panel = $('#stream-result'); if (!panel) return; state.codesysNativeResizeObserver = new ResizeObserver(() => { if (!state.codesysNativeAttached) return; if (state.codesysNativeMoveTimer) clearTimeout(state.codesysNativeMoveTimer); state.codesysNativeMoveTimer = setTimeout(() => { const bounds = codesysNativeBounds(); if (bounds) void window.taskhive.moveCodesysNativeHost(bounds).catch(() => null); }, 120); }); state.codesysNativeResizeObserver.observe(panel); }

async function attachSelectedCodesysNativeHost(options = {}) {
  const selected = state.selectedWindow;
  const status = $('#input-status');
  const panel = $('#stream-result');
  if (!selected || selected.usable === false || !panel) return false;
  if (selected.fixture === true && options.allowFixture !== true) return false;
  const bounds = codesysNativeBounds(selected);
  if (!bounds) return false;
  if (state.codesysNativeAttached && String(state.codesysNativeWindowId) === String(selected.id)) {
    installCodesysNativeGeometryObserver();
    await window.taskhive.moveCodesysNativeHost(bounds);
    return true;
  }
  if (state.codesysNativeAttached) {
    await window.taskhive.detachCodesysNativeHost().catch(() => null);
    state.codesysNativeAttached = false;
    state.codesysNativeWindowId = '';
  }
  panel.classList.add('native-host-active');
  panel.innerHTML = '<div class="native-host-placeholder" aria-hidden="true">真实 CODESYS 原生窗口</div>';
  try {
    if (status) status.textContent = '正在把真实 CODESYS HWND 放入插件区域…';
    const result = await window.taskhive.attachCodesysNativeHost({ windowId: selected.id, bounds });
    state.codesysNativeAttached = result.attached === true;
    state.codesysNativeWindowId = state.codesysNativeAttached ? String(selected.id) : '';
    installCodesysNativeGeometryObserver();
    syncCodesysNativeButton();
    if (status) status.textContent = state.codesysNativeAttached
      ? `原生窗口已就位 · ${bounds.width}×${bounds.height} · 鼠标键盘直达 CODESYS · 任务栏隐藏`
      : '真实 CODESYS 原生窗口尚未就位';
    return state.codesysNativeAttached;
  } catch (error) {
    state.codesysNativeAttached = false;
    state.codesysNativeWindowId = '';
    panel.classList.remove('native-host-active');
    panel.innerHTML = `<div class="empty">原生窗口载入失败：${escapeHtml(error.message)}</div>`;
    if (status) status.textContent = `原生窗口载入失败：${error.message}`;
    return false;
  }
}

async function toggleCodesysNativeHost() { const status = $('#input-status'); const panel = $('#stream-result'); if (state.codesysNativeAttached) { try { const result = await window.taskhive.detachCodesysNativeHost(); state.codesysNativeAttached = false; state.codesysNativeWindowId = ''; state.codesysNativeResizeObserver?.disconnect(); state.codesysNativeResizeObserver = null; panel?.classList.remove('native-host-active'); syncCodesysNativeButton(); if (status) status.textContent = result.restored ? '原生窗口已从插件区域取出 · CODESYS 仍保持运行' : '原生操作已关闭'; } catch (error) { if (status) status.textContent = `原生操作停止失败：${error.message}`; } return; } await attachSelectedCodesysNativeHost({ allowFixture: true }); }

function codesysRelativePoint(image, event) { const rect = image.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) }; }

function queueCodesysAction(action) { state.codesysInputQueue = state.codesysInputQueue.catch(() => null).then(() => executeDirectCodesysAction(action)); return state.codesysInputQueue; }

function bindCodesysPreview(image) {
  if (!image || image.dataset.inputBound === 'true') return;
  image.dataset.inputBound = 'true';
  image.onclick = (event) => { if (!state.codesysAiInputEnabled) return; image.focus({ preventScroll: true }); const point = codesysRelativePoint(image, event); image.style.setProperty('--codesys-input-x', `${point.x * 100}%`); image.style.setProperty('--codesys-input-y', `${point.y * 100}%`); image.classList.remove('input-feedback'); requestAnimationFrame(() => image.classList.add('input-feedback')); const status = $('#input-status'); if (status) status.textContent = `AI 点击已接收 · ${(point.x * 100).toFixed(1)}%, ${(point.y * 100).toFixed(1)}% · 正在复核目标窗口`; void queueCodesysAction({ type: 'mouse.click', ...point }); };
  image.addEventListener('wheel', (event) => { if (!state.codesysAiInputEnabled || !event.deltaY) return; event.preventDefault(); state.codesysWheelPoint = codesysRelativePoint(image, event); const step = Math.max(1, Math.min(5, Math.ceil(Math.abs(event.deltaY) / 100))) * 120; state.codesysWheelDelta = Math.max(-1200, Math.min(1200, state.codesysWheelDelta + (event.deltaY > 0 ? -step : step))); const status = $('#input-status'); if (status) status.textContent = `AI 滚轮已接收 · ${state.codesysWheelDelta > 0 ? '向上' : '向下'} · 正在合并连续滚动`; if (state.codesysWheelTimer) clearTimeout(state.codesysWheelTimer); state.codesysWheelTimer = setTimeout(() => { const action = { type: 'mouse.wheel', ...state.codesysWheelPoint, delta: state.codesysWheelDelta }; state.codesysWheelTimer = null; state.codesysWheelDelta = 0; state.codesysWheelPoint = null; void queueCodesysAction(action); }, 45); }, { passive: false });
  image.onkeydown = (event) => { if (!state.codesysAiInputEnabled) return; if (['Tab','Escape','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key)) { event.preventDefault(); void queueCodesysAction({ type: 'keyboard.key', key: event.key }); } else if (event.key.length === 1) { event.preventDefault(); void queueCodesysAction({ type: 'keyboard.text', text: event.key }); } };
}

function adoptOwnedStreamWindow(frame) {
  const stream = frame?.stream || {};
  const target = stream.target;
  const nextId = String(stream.windowId || '');
  if (!nextId || !target || target.pluginOwned !== true || String(target.id || '') !== nextId) return;
  state.streamWindowId = nextId;
  if (String(state.selectedWindow?.id || '') === nextId) return;
  const next = { ...target, id: nextId };
  const existingIndex = state.windows.findIndex((item) => String(item.id) === nextId);
  if (existingIndex >= 0) state.windows[existingIndex] = next;
  else state.windows.push(next);
  state.selectedWindow = next;
  if (state.codesysNativeAttached && String(state.codesysNativeWindowId) !== nextId) void attachSelectedCodesysNativeHost();
  const list = $('#window-list');
  if (list) {
    list.innerHTML = state.windows.map((item, index) => `<option value="${index}"${String(item.id) === nextId ? ' selected' : ''}>${escapeHtml(item.title)} · PID ${Number(item.pid || 0)} · ${item.width}×${item.height}${item.usable === false ? ' · 等待恢复' : ''}</option>`).join('');
  }
  const inputStatus = $('#input-status');
  if (inputStatus) inputStatus.textContent = `已从启动窗口接管同一插件进程的主 IDE · PID ${Number(next.pid || 0)} · ${next.width}×${next.height}`;
  scheduleCodesysWindowFit(nextId, 0);
}

function renderOwnedStreamFrame(frame) {
  adoptOwnedStreamWindow(frame);
  renderStreamFrame(frame);
  const image = $('#stream-result img.preview');
  const status = $('#codesys-stream-status');
  if (!image || !status || !frame?.dataUrl) return;
  const originalOnload = image.onload;
  image.onload = () => {
    originalOnload?.();
    const width = Number(image.naturalWidth || frame.width || 0);
    const height = Number(image.naturalHeight || frame.height || 0);
    const rect = image.getBoundingClientRect();
    const sourceToDisplay = `源 ${width}×${height} → 显示 ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    if (!status.textContent.includes('源 ')) status.textContent += ` · ${sourceToDisplay}`;
    state.codesysStreamMetrics = { ...(state.codesysStreamMetrics || {}), displayedWidth: Math.round(rect.width), displayedHeight: Math.round(rect.height) };
    window.__TASKHIVE_CODESYS_STREAM__ = { ...state.codesysStreamMetrics };
  };
}

function renderStreamFrame(frame) { const panel = $('#stream-result'); const status = $('#codesys-stream-status'); if (!panel || !status) return; const stream = frame?.stream || {}; const windowPhase = stream.target?.windowPhase === 'launch' ? 'launch' : 'main'; panel.dataset.frameCount = String(stream.frames || 0); panel.dataset.fps = Number(stream.fps || 0).toFixed(1); panel.dataset.latencyMs = String(Number(stream.latencyMs || 0)); panel.dataset.droppedFrames = String(Number(stream.droppedFrames || 0)); panel.dataset.windowPhase = windowPhase; state.codesysStreamMetrics = { active: stream.connected !== false, transport: frame?.captureTransport || 'windows-printwindow', sourceId: String(stream.windowId || state.streamWindowId || ''), windowPhase, frames: Number(stream.frames || 0), fps: Number(stream.fps || 0), latencyMs: Number(stream.latencyMs || 0), droppedFrames: Number(stream.droppedFrames || 0), reconnects: Number(stream.reconnects || 0), width: Number(frame?.width || 0), height: Number(frame?.height || 0), lastFrameAt: stream.lastFrameAt || frame?.capturedAt || null }; window.__TASKHIVE_CODESYS_STREAM__ = { ...state.codesysStreamMetrics }; let image = panel.querySelector('img.preview'); if (!image) { panel.innerHTML = '<img class="preview" alt="CODESYS 实时画面" tabindex="0">'; image = panel.querySelector('img.preview'); bindCodesysPreview(image); } image.classList.toggle('launch-window', windowPhase === 'launch'); if (!frame?.dataUrl) { status.textContent = `AI 实时监视${stream.connected ? '重连中' : '已断开'}：${stream.error || '等待下一帧'}`; return; } state.capture = frame; const fps = Number(stream.fps || 0).toFixed(1); const latency = Number(stream.latencyMs || 0); const dropped = Number(stream.droppedFrames || 0); const reconnects = Number(stream.reconnects || 0); const lastFrame = stream.lastFrameAt ? new Date(stream.lastFrameAt).toLocaleTimeString() : new Date().toLocaleTimeString(); const completeness = frame.completeFrame === false ? `仅窗口边框 ${frame.width}×${frame.height}，请恢复 CODESYS 窗口` : `完整画面 ${frame.width}×${frame.height}`; const transport = frame.captureTransport === 'windows-printwindow' ? ' · Windows HWND 原生画面' : ''; const phaseLabel = windowPhase === 'launch' ? '启动小窗居中' : completeness; status.textContent = `AI 实时监视中 · ${phaseLabel}${transport} · FPS ${fps} · 延迟 ${latency}ms · 丢帧 ${dropped} · 重连 ${reconnects} · 连接正常 · 最后一帧 ${lastFrame}`; image.title = state.codesysAiInputEnabled ? 'AI 操作已开启：点击、滚轮和键盘会直接映射到 CODESYS' : 'AI 操作已关闭：画面只读'; image.onload = () => { const width = Number(image.naturalWidth || frame.width || 0); const height = Number(image.naturalHeight || frame.height || 0); state.codesysStreamMetrics.width = width; state.codesysStreamMetrics.height = height; state.codesysStreamMetrics.reportedWidth = Number(frame.width || 0); state.codesysStreamMetrics.reportedHeight = Number(frame.height || 0); state.codesysStreamMetrics.dimensionsMatch = width === Number(frame.width || 0) && height === Number(frame.height || 0); window.__TASKHIVE_CODESYS_STREAM__ = { ...state.codesysStreamMetrics }; if (!state.codesysPreviewResizeObserver) installCodesysPreviewGeometry(image, width, height); else syncCodesysPreviewGeometry(image, width, height); }; image.src = frame.dataUrl; }

async function toggleCodesysAiInput() {
  const button = $('#codesys-ai-toggle');
  const inputStatus = $('#input-status');
  const streamStatus = $('#codesys-stream-status');
  if (!state.codesysAiInputEnabled && (!state.selectedWindow || state.selectedWindow.usable === false)) {
    if (inputStatus) inputStatus.textContent = 'AI 操作未开启 · 请先打开、选择并恢复一个可用的 CODESYS 窗口';
    return;
  }
  state.codesysAiInputEnabled = !state.codesysAiInputEnabled;
  button.classList.toggle('active', state.codesysAiInputEnabled);
  button.setAttribute('aria-pressed', String(state.codesysAiInputEnabled));
  button.setAttribute('aria-label', state.codesysAiInputEnabled ? 'AI 操作已开启；点击后同时停止实时监视和 AI 输入' : 'AI 操作已关闭；点击后同时开启实时监视和 AI 输入');
  button.title = button.getAttribute('aria-label');
  // The main process owns the authoritative input gate. This explicit user
  // gesture is what arms it for one specific window.
  await window.taskhive.armCodesysInput({
    armed: state.codesysAiInputEnabled,
    windowId: state.codesysAiInputEnabled ? (state.streamWindowId || state.selectedWindow?.id || '') : '',
  }).catch(() => null);
  if (state.codesysAiInputEnabled) {
    if (inputStatus) inputStatus.textContent = 'AI 操作正在开启 · 同时启动实时监视和 AI 输入';
    if (streamStatus) streamStatus.textContent = '正在启动 AI 实时监视…';
    await startStream();
  } else {
    await stopStream();
    if (inputStatus) inputStatus.textContent = 'AI 操作已关闭 · 不监视画面、不发送输入 · CODESYS 原生窗口继续运行';
  }
  const image = $('#stream-result .preview');
  if (image) image.title = state.codesysAiInputEnabled ? 'AI 操作已开启：点击、滚轮和键盘会直接映射到 CODESYS' : 'AI 操作已关闭：画面只读';
}

async function executeDirectCodesysAction(action) { if (!state.codesysAiInputEnabled || !state.selectedWindow) return; const status = $('#input-status'); const label = action.type === 'mouse.click' ? '点击' : action.type === 'mouse.wheel' ? '滚轮' : action.type === 'keyboard.text' ? '文本输入' : '按键'; try { const result = await window.taskhive.executeCodesysInputDirect({ windowId: state.streamWindowId || state.selectedWindow.id, action }); if (status) status.textContent = `AI ${label}已执行 · ${result.durationMs}ms · 后台目标复核完成 · 客户端焦点未切换`; } catch (error) { if (status) status.textContent = `AI ${label}未执行：${error.message}`; } }
async function submitCodesysCodeAi(event) { event.preventDefault(); const input = $('#codesys-ai-input'); const status = $('#scriptengine-result'); if (!input || !status) return; const prompt = input.value.trim(); if (!prompt) return; status.innerHTML = '<div class="notice">正在通过 Harness 创建 ScriptEngine 隔离代码作业并回传工作区…</div>'; try { const result = await window.taskhive.requestCodesysCodeAi({ prompt }); if (!status.isConnected) return; status.innerHTML = `<div class="notice">任务已传到 Harness 工作区 · ${escapeHtml(result.jobId)} · ${escapeHtml(result.state)} · 当前工程未修改</div>`; input.value = ''; window.postMessage({ source: 'taskhive-dsh', type: 'surface.open', surface: 'chat' }, '*'); } catch (error) { if (status.isConnected) status.innerHTML = `<div class="notice">代码任务创建失败：${escapeHtml(error.message)}</div>`; } }

async function refreshVisionStatus() {
  const target = $('#vision-status'); if (!target) return;
  try { const result = await window.taskhive.visualStatus(); target.textContent = result.ready ? `ModLens ${result.version} 已就绪：${result.readyProviders.join(', ')}` : `ModLens ${result.version || ''} 已安装，但没有可用视觉 provider。`; } catch (error) { target.textContent = `ModLens 检查失败：${error.message}`; }
}

async function refreshScriptEngineStatus() {
  const target = $('#scriptengine-status'); if (!target) return;
  const configure = $('#scriptengine-configure');
  try {
    const result = await window.taskhive.codesysScriptEngineStatus();
    const missing = (result.missing || []).map((item) => item.label || item.id).filter(Boolean);
    target.textContent = result.ready ? `ScriptEngine 可修改代码 · CODESYS ${result.version}` : `ScriptEngine 未就绪 · 缺少：${missing.join('、') || result.state}`;
    if (configure) configure.hidden = result.ready;
  } catch (error) { target.textContent = `ScriptEngine 检查失败：${error.message}`; if (configure) configure.hidden = false; }
}

async function configureScriptEngine() {
  const target = $('#scriptengine-status'); const button = $('#scriptengine-configure');
  if (!target || !button) return;
  button.disabled = true; target.textContent = '正在打开可信的 ScriptEngine 配置入口…';
  try {
    const result = await window.taskhive.configureCodesysScriptEngine();
    target.textContent = result.ready ? 'ScriptEngine 已经就绪，可修改代码' : result.mode === 'signed-local-installer' ? '已打开本机签名有效的 CODESYS Installer；安装完成后点击重新检测' : '已打开 CODESYS 官方下载/组件管理页面；安装完成后点击重新检测';
  } catch (error) { target.textContent = `ScriptEngine 配置入口打开失败：${error.message}`; }
  finally { button.disabled = false; }
}

async function probeScriptEngine() {
  const button = $('#scriptengine-probe'); const target = $('#scriptengine-result'); if (!button || !target) return;
  button.disabled = true; target.innerHTML = '<div class="notice">正在启动隔离的 CODESYS --noUI 探针；不会打开或修改当前工程…</div>';
  try {
    const result = await window.taskhive.probeCodesysScriptEngine({ timeoutMs: 45000 });
    target.innerHTML = `<div class="notice">真实探针通过 · ${escapeHtml(result.profile)} · ${result.durationMs}ms</div><div class="code">${escapeHtml(JSON.stringify(result.payload, null, 2))}</div>`;
    log('CODESYS ScriptEngine 安全探针通过');
  } catch (error) {
    target.innerHTML = `<div class="notice">ScriptEngine 探针失败：${escapeHtml(error.message)}</div>`;
    log('CODESYS ScriptEngine 安全探针失败');
  } finally { button.disabled = false; }
}


function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function refreshWindows(options = {}) {
  const list = $('#window-list');
  if (!list) return null;
  list.innerHTML = '<option value="">正在枚举窗口…</option>';
  try { state.windows = await window.taskhive.listCodesysWindows(); } catch (error) { if (list.isConnected) list.innerHTML = '<option value="">窗口枚举失败</option>'; log(`窗口枚举失败：${error.message}`); return null; }
  if (!list.isConnected) return null;
  if (!state.windows.length) { state.selectedWindow = null; list.innerHTML = '<option value="">尚未发现由本插件打开的 CODESYS 窗口</option>'; return; }
  const previousId = state.selectedWindow?.id;
  const preferredPid = Number(options.preferredPid || 0);
  const preferred = state.windows
    .filter((item) => preferredPid > 0 && Number(item.pid) === preferredPid)
    .sort((left, right) => (right.windowPhase === 'main') - (left.windowPhase === 'main') || (Number(right.width) * Number(right.height)) - (Number(left.width) * Number(left.height)))[0];
  state.selectedWindow = preferred || state.windows.find((item) => String(item.id) === String(previousId)) || state.windows.find((item) => item.usable !== false) || state.windows[0];
  const selectionChanged = String(previousId || '') !== String(state.selectedWindow?.id || '');
  if (selectionChanged && previousId) {
    stopCodesysMediaStream('window-refresh-switch');
    try { state.unsubscribeFrame?.(); } catch {}
    state.unsubscribeFrame = null;
    await window.taskhive.stopCodesysStream(previousId).catch(() => null);
    state.streamWindowId = null;
  }
  list.innerHTML = state.windows.map((item, index) => `<option value="${index}"${item === state.selectedWindow ? ' selected' : ''}>${escapeHtml(item.title)} · PID ${Number(item.pid || 0)} · ${item.width}×${item.height}${item.usable === false ? ' · 等待恢复' : ''}</option>`).join('');
  list.onchange = async () => { const previous = state.selectedWindow?.id; const next = state.windows[Number(list.value)] || null; if (String(previous || '') !== String(next?.id || '')) { const activeStreamWindowId = state.streamWindowId; stopCodesysMediaStream('window-switch'); try { state.unsubscribeFrame?.(); } catch {} state.unsubscribeFrame = null; state.streamWindowId = null; if (activeStreamWindowId) await window.taskhive.stopCodesysStream(activeStreamWindowId).catch(() => null); } state.selectedWindow = next;
    // The panel's selection IS the workbench's monitored window: publish it so
    // the code workbench re-detects against this window instead of any other
    // window the plugin happens to own.
    void window.taskhive.setCodesysPreferredWindow?.({ windowId: next?.id || '', pid: next?.pid || 0 }).catch(() => null);
    if (state.codesysNativeAttached && String(previous) !== String(state.selectedWindow?.id || '')) { await window.taskhive.detachCodesysNativeHost().catch(() => null); state.codesysNativeAttached = false; state.codesysNativeWindowId = ''; syncCodesysNativeButton(); } const status = $('#input-status'); if (state.selectedWindow) { if (state.selectedWindow.fixture === true) { if (status) status.textContent = `已选择隔离测试窗口 · ${state.selectedWindow.title}`; } else await attachSelectedCodesysNativeHost(); if (state.codesysAiInputEnabled && state.selectedWindow.usable !== false) await startStream({ skipFit: state.codesysNativeAttached }); log(`已选择 ${state.selectedWindow.title}`); } };
  if (options.restartStream && state.selectedWindow) {
    try { await fitSelectedCodesysWindowToCanvas(state.selectedWindow.id); }
    catch (error) { const status = $('#input-status'); if (status) status.textContent = `CODESYS 窗口适配插件画布失败：${error.message}`; }
    if (state.selectedWindow.usable !== false) await startStream({ followPid: options.followPid === true, skipFit: true });
  }
  return state.selectedWindow;
}

async function waitForLaunchedCodesysWindow(pid, restartStream) {
  for (let attempt = 0; attempt < 24 && $('#window-list'); attempt += 1) {
    const selected = await refreshWindows({ preferredPid: pid, restartStream, followPid: true });
    if (selected && Number(selected.pid) === Number(pid)) return selected;
    await delay(500);
  }
  return null;
}

async function followLaunchedCodesysMainWindow(pid, launchWindowId) {
  // CODESYS may spend several minutes in its splash window on a cold start.
  // Follow the exact plugin-launched PID until its main IDE HWND appears.
  //
  // Every stop condition is now an explicit token instead of a DOM id that
  // renderCodesys() recreates: a superseded loop, a torn-down surface, an AI
  // session taking over or a dead PID all end the follow immediately.
  const followGeneration = ++state.codesysFollowGeneration;
  const stillCurrent = () => followGeneration === state.codesysFollowGeneration
    && !state.codesysAiInputEnabled
    && Boolean(document.getElementById('window-list'));
  let consecutiveMisses = 0;
  for (let attempt = 0; attempt < 900; attempt += 1) {
    if (!stillCurrent()) return null;
    await delay(1000);
    if (!stillCurrent()) return null;
    let selected = null;
    try { selected = await refreshWindows({ preferredPid: pid }); }
    catch {
      // The splash HWND can disappear one enumeration before the main HWND is
      // created. Treat that short gap as a transition, not as a failed follow.
      consecutiveMisses += 1;
      if (consecutiveMisses >= 90) return null;
      continue;
    }
    if (!stillCurrent()) return null;
    if (!selected || Number(selected.pid) !== Number(pid)) {
      // A plugin-launched process that stays invisible for 90 s is gone; stop
      // instead of polling for the remaining 13 minutes.
      consecutiveMisses += 1;
      if (consecutiveMisses >= 90) return null;
      continue;
    }
    consecutiveMisses = 0;
    if (selected.windowPhase === 'main' || String(selected.id) !== String(launchWindowId)) {
      await attachSelectedCodesysNativeHost();
      const status = $('#input-status');
      if (status) status.textContent = `主 IDE 原生窗口已进入插件 · PID ${Number(pid)} · 鼠标键盘可直接操作 · AI 实时监视保持关闭`;
      return selected;
    }
  }
  return null;
}

async function captureWindow(options = {}) {
  if (!state.selectedWindow) { log('请先选择 CODESYS 窗口'); return; }
  try { state.capture = await window.taskhive.captureCodesys(state.selectedWindow.id); if (!options.silent) { const captureResult = $('#capture-result'); if (captureResult) captureResult.innerHTML = `<div class="notice">截图已保存 · SHA-256 ${state.capture.sha256}</div>`; } const panel = $('#stream-result'); if (panel) panel.innerHTML = `<img class="preview${state.selectedWindow.windowPhase === 'launch' ? ' launch-window' : ''}" src="${state.capture.dataUrl}" alt="CODESYS 截图预览" tabindex="0">`; const image = panel?.querySelector('img.preview'); bindCodesysPreview(image); if (image) image.onload = () => installCodesysPreviewGeometry(image, image.naturalWidth || state.capture.width, image.naturalHeight || state.capture.height); if (!options.silent) log('截图预览已刷新'); } catch (error) { const message = `CODESYS 画面读取失败：${error.message}`; const panel = $('#stream-result'); const status = $('#input-status'); if (panel) panel.innerHTML = `<div class="empty">${escapeHtml(message)}<br>请点击刷新；CODESYS 原生程序不会被关闭</div>`; if (status) status.textContent = message; if (!options.silent) { const captureResult = $('#capture-result'); if (captureResult) captureResult.innerHTML = `<div class="notice">${escapeHtml(message)}</div>`; } }
}

async function analyzeCapture() {
  if (!state.capture) { log('请先截取窗口'); return; }
  if (state.capture.completeFrame === false) { log('当前截图不是完整窗口画面，未提交 ModLens 分析'); return; }
  const result = await window.taskhive.analyzeCapture(state.capture); const evidence = result.result ? JSON.stringify(result.result, null, 2) : result.message; $('#capture-result').insertAdjacentHTML('beforeend', `<div class="notice spaced">ModLens（低信任）状态：${escapeHtml(result.status)}<br>截图哈希：${result.screenshotSha256 || '无'}</div><div class="code">${escapeHtml(evidence || '')}</div>`); log(`ModLens 分析：${result.status}`);
}

async function renderPackages() {
  title.textContent = '插件管理'; badge.textContent = '安装与生命周期';
  await showPluginSurface(card(`<h2>插件与仓库</h2><p>支持远程 Git 和本地目录；安装前暂存校验，卸载先备份。</p><div class="toolbar"><select id="repository-kind"><option value="plugins">插件</option><option value="knowledge">知识库</option><option value="experts">专家</option></select><input id="plugin-source" placeholder="Git 地址或本地目录"><button class="primary" id="install-plugin">安装</button></div><div id="plugin-list" class="grid"></div>`));
  const lifecycleMarkup = (kind, item) => {
    if (kind === 'plugins' && item.protected) return '<span class="badge">系统组件</span>';
    if (item.state === 'uninstalled' || !item.installed) return `<button class="secondary" data-restore="${escapeHtml(item.id)}">恢复备份</button>`;
    const next = item.state === 'disabled' ? 'enabled' : 'disabled';
    return `<span class="row-actions"><button class="secondary" data-toggle="${escapeHtml(item.id)}" data-next-state="${next}">${next === 'enabled' ? '启用' : '停用'}</button><button class="danger" data-uninstall="${escapeHtml(item.id)}">卸载</button></span>`;
  };
  const reload = async () => {
    const kind = $('#repository-kind').value;
    const items = kind === 'plugins' ? await window.taskhive.listPlugins() : await window.taskhive.listRepositories(kind);
    const list = $('#plugin-list');
    list.innerHTML = items.length ? items.map((item) => `<div class="plugin-row"><span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.id)} · v${escapeHtml(item.version || '-')} · ${escapeHtml(item.state || 'unknown')}</small></span>${lifecycleMarkup(kind, item)}</div>`).join('') : '<div class="empty">暂无已注册条目</div>';
    list.querySelectorAll('[data-toggle]').forEach((node) => { node.onclick = async () => { try {
      const id = node.dataset.toggle; const next = node.dataset.nextState; const input = { kind, id };
      if (kind === 'plugins') await (next === 'enabled' ? window.taskhive.enablePlugin(id) : window.taskhive.disablePlugin(id));
      else await (next === 'enabled' ? window.taskhive.enableRepository(input) : window.taskhive.disableRepository(input));
      log(`${next === 'enabled' ? '已启用' : '已停用'}${kind === 'plugins' ? '插件' : '仓库'}：${id}${kind === 'plugins' ? '（Harness 已重载）' : ''}`); await reload();
    } catch (error) { log(`状态更新失败：${error.message}`); } }; });
    list.querySelectorAll('[data-restore]').forEach((node) => { node.onclick = async () => { try {
      const id = node.dataset.restore;
      if (kind === 'plugins') await window.taskhive.restorePlugin(id); else await window.taskhive.restoreRepository({ kind, id });
      log(`已恢复备份：${id}`); await reload();
    } catch (error) { log(`恢复失败：${error.message}`); } }; });
    list.querySelectorAll('[data-uninstall]').forEach((node) => { node.onclick = async () => { try {
      const id = node.dataset.uninstall;
      if (kind === 'plugins') await window.taskhive.uninstallPlugin(id); else await window.taskhive.uninstallRepository({ kind, id });
      log(`已备份并卸载：${id}`); await reload();
    } catch (error) { log(`卸载失败：${error.message}`); } }; });
  };
  $('#repository-kind').onchange = reload;
  $('#install-plugin').onclick = async () => { const source = $('#plugin-source').value.trim(); const kind = $('#repository-kind').value; if (!source) return; try { if (kind === 'plugins') await window.taskhive.installPlugin({ source }); else await window.taskhive.installRepository({ kind, source }); log(`已安装${kind}仓库：${source}`); $('#plugin-source').value = ''; await reload(); } catch (error) { log(`安装失败：${error.message}`); } };
  await reload();
}

async function renderSettings() {
  title.textContent = '设置'; badge.textContent = '模型目录';
  const catalog = await window.taskhive.listModels();
  const plugins = await window.taskhive.listPlugins();
  const options = catalog.providers.flatMap((provider) => provider.models.map((model) => `<option value="${provider.id}::${model}" ${(catalog.browserRoute?.providerId === provider.id && catalog.browserRoute?.modelId === model) || (catalog.defaultRoute.providerId === provider.id && catalog.defaultRoute.modelId === model) ? 'selected' : ''} ${provider.state !== 'ready' ? 'disabled' : ''}>${escapeHtml(provider.name)} · ${escapeHtml(model)}${provider.state !== 'ready' ? '（未配置）' : ''}</option>`)).join('');
  const providerHealth = catalog.providers.map((provider) => `<div class="meta-row"><strong>${escapeHtml(provider.name)}</strong><span>${escapeHtml(provider.state || 'unknown')}${provider.version ? ` · ${escapeHtml(provider.version)}` : ''}${provider.command ? ` · ${escapeHtml(provider.command)}` : ''}</span></div>`).join('');
  const placementRows = plugins.filter((item) => item.installed && item.ui?.visible === true && Array.isArray(item.ui?.allowedPlacements) && item.ui.allowedPlacements.length).map((item) => `<label class="plugin-placement-row"><span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.description || item.id)}</small></span><select data-plugin-placement="${escapeHtml(item.id)}"><option value="left" ${item.placement === 'left' ? 'selected' : ''}>左侧栏</option><option value="right" ${item.placement === 'right' ? 'selected' : ''}>右侧栏</option><option value="hidden" ${item.placement === 'hidden' ? 'selected' : ''}>隐藏</option></select></label>`).join('');
  await showPluginSurface(card(`<div class="settings-tabs" role="tablist" aria-label="设置分类"><button class="settings-tab active" data-settings-tab="models" type="button">模型</button><button class="settings-tab" data-settings-tab="plugins" type="button">插件</button><button class="settings-tab" data-settings-tab="directories" type="button">目录与同步</button></div><section data-settings-panel="models"><details open><summary>模型目录 / Harness Route</summary><h2>多模型切换</h2><p>模型属于独立目录 <code>${escapeHtml(catalog.directory || 'models')}</code>；切换会更新 DSH route 并重启同一个 Harness Runtime，不会创建第二个 Agent Loop。</p><div class="toolbar"><select id="model-select">${options}</select><button class="primary" id="model-apply">应用模型</button></div><div id="model-status" class="notice">当前路由：${escapeHtml(catalog.defaultRoute.providerId)} · ${escapeHtml(catalog.defaultRoute.modelId)}</div><hr><div class="eyebrow">模型和认证健康</div><div>${providerHealth}</div><hr><div class="eyebrow">认证边界</div><p>DeepSeek API、本地 Ollama、Claude Code 和 Web AI 只有在完成显式认证/健康检查后才会启用；当前未配置项不会伪装成可用。</p></details></section><section data-settings-panel="plugins" hidden><details open><summary>插件管理</summary><p>所有插件在这里安装、启用、停用、卸载和恢复；后台插件不会伪造侧栏入口。</p><div class="toolbar"><input id="settings-plugin-source" placeholder="Git URL 或本地插件目录"><button class="primary" id="settings-plugin-install">安装插件</button></div><div id="settings-plugin-status" class="notice">正在读取插件状态…</div><div id="settings-plugin-list" class="grid"></div></details><details open><summary>插件入口位置</summary><p>入口位置只改变侧栏按钮位置，插件内容仍在中央工作区打开。后台插件和系统插件不显示此设置。</p><div class="plugin-placement-list">${placementRows || '<div class="empty">暂无可配置界面的已安装插件。</div>'}</div><div id="placement-status" class="notice">设置会保存到本地 catalog，并在下次 Harness 会话生效。</div></details></section><section data-settings-panel="directories" hidden><details open><summary>目录与 Git</summary><p>插件、知识库、专家、模型和工作区保持独立目录；具体路径和 Git 同步由对应仓库管理。</p><div class="meta-row"><strong>程序本体</strong><span>app/</span></div><div class="meta-row"><strong>Harness 内核</strong><span>harness/</span></div><div class="meta-row"><strong>插件</strong><span>plugins/</span></div><div class="meta-row"><strong>知识库</strong><span>knowledge/</span></div><div class="meta-row"><strong>专家</strong><span>experts/</span></div><div class="meta-row"><strong>模型</strong><span>models/</span></div></details></section>`));
  document.querySelectorAll('[data-settings-tab]').forEach((tab) => { tab.onclick = () => { document.querySelectorAll('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === tab)); document.querySelectorAll('[data-settings-panel]').forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== tab.dataset.settingsTab; }); }; });
  $('#model-apply').onclick = async () => { const [providerId, modelId] = $('#model-select').value.split('::'); const button = $('#model-apply'); button.disabled = true; $('#model-status').textContent = providerId === 'web-ai' ? '正在打开中央浏览器模型…' : '正在重启 DSH Runtime…'; try { const result = await window.taskhive.selectModel({ providerId, modelId }); $('#model-status').textContent = providerId === 'web-ai' ? `已打开网页模型：${modelId}` : `已切换：${providerId} · ${modelId}；DSH ${result.runtime.state}`; log(`模型已切换到 ${modelId}`); } catch (error) { $('#model-status').textContent = `模型切换失败：${error.message}`; } finally { button.disabled = false; } };
  document.querySelectorAll('[data-plugin-placement]').forEach((select) => { select.onchange = async () => { const id = select.dataset.pluginPlacement; try { await window.taskhive.setPluginPlacement({ id, placement: select.value }); $('#placement-status').textContent = `${id} 入口已设置为${select.value === 'left' ? '左侧栏' : select.value === 'right' ? '右侧栏' : '隐藏'}；重新打开 Harness 后生效。`; log(`插件入口位置已更新：${id}=${select.value}`); } catch (error) { $('#placement-status').textContent = `入口位置保存失败：${error.message}`; } }; });
  const pluginStatus = $('#settings-plugin-status'); const pluginList = $('#settings-plugin-list');
  const loadPluginSettings = async () => { const items = await window.taskhive.listPlugins(); pluginList.innerHTML = items.length ? items.map((item) => { const protectedItem = item.protected === true; const next = item.state === 'enabled' ? 'disabled' : 'enabled'; const action = protectedItem ? '<span class="badge">系统组件</span>' : `<span class="row-actions"><button class="secondary" data-plugin-toggle="${escapeHtml(item.id)}" data-next="${next}">${next === 'enabled' ? '启用' : '停用'}</button>${item.installed ? `<button class="danger" data-plugin-uninstall="${escapeHtml(item.id)}">卸载</button>` : `<button class="secondary" data-plugin-restore="${escapeHtml(item.id)}">恢复</button>`}</span>`; return `<div class="plugin-row"><span class="plugin-row-head"><span class="nav-icon" aria-hidden="true">${sidebarIconMarkup[item.id] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>'}</span><span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.id)} · v${escapeHtml(item.version || '-')} · ${escapeHtml(item.state || 'unknown')} · ${escapeHtml(item.source || 'local')}</small></span></span>${action}</div>`; }).join('') : '<div class="empty">暂无插件。</div>'; pluginList.querySelectorAll('[data-plugin-toggle]').forEach((button) => { button.onclick = async () => { try { const id = button.dataset.pluginToggle; const next = button.dataset.next; if (next === 'enabled') await window.taskhive.enablePlugin(id); else await window.taskhive.disablePlugin(id); pluginStatus.textContent = `${id} 已${next === 'enabled' ? '启用' : '停用'}，Harness 已重新加载。`; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `插件状态更新失败：${error.message}`; } }; }); pluginList.querySelectorAll('[data-plugin-uninstall]').forEach((button) => { button.onclick = async () => { try { await window.taskhive.uninstallPlugin(button.dataset.pluginUninstall); pluginStatus.textContent = '插件已备份并卸载。'; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `卸载失败：${error.message}`; } }; }); pluginList.querySelectorAll('[data-plugin-restore]').forEach((button) => { button.onclick = async () => { try { await window.taskhive.restorePlugin(button.dataset.pluginRestore); pluginStatus.textContent = '插件已从备份恢复。'; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `恢复失败：${error.message}`; } }; }); };
  $('#settings-plugin-install').onclick = async () => { const source = $('#settings-plugin-source').value.trim(); if (!source) { pluginStatus.textContent = '请输入 Git 地址或本地插件目录。'; return; } try { await window.taskhive.installPlugin({ source }); $('#settings-plugin-source').value = ''; pluginStatus.textContent = '插件安装完成，Harness 已重新加载。'; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `安装失败：${error.message}`; } };
  await loadPluginSettings();
}

async function renderRepositorySurface(kind) {
  const isKnowledge = kind === 'knowledge';
  const heading = isKnowledge ? '知识库' : '专家';
  const description = isKnowledge
    ? '本地/Git 文档导入、隔离索引、全文搜索与审核状态；检索结果只作为 Harness 上下文。'
    : '专家角色包由 Harness Agent Teams 调度，不拥有第二个 Agent Loop；支持本地/Git 安装与审计。';
  title.textContent = heading; badge.textContent = isKnowledge ? '卡片与审核' : '团队与运行';
  const knowledgeMarkup = isKnowledge ? `<section class="knowledge-workbench"><div class="knowledge-create-row"><input id="knowledge-card-title" placeholder="知识卡标题" aria-label="知识卡标题"><select id="knowledge-card-type" aria-label="知识类型" title="选择知识卡分类"><option value="question">问题</option><option value="preference">偏好</option><option value="fact">事实</option><option value="decision">决策</option><option value="process">流程</option><option value="experience">经验</option><option value="conversation">对话沉淀</option></select><textarea id="knowledge-card-content" rows="2" placeholder="记录问题、证据、结论或验证步骤" aria-label="知识卡内容"></textarea><button class="primary" id="knowledge-card-create" title="先保存为待审核知识卡">沉淀候选</button></div><div class="knowledge-sync-row"><input id="knowledge-remote-path" placeholder="共享文件夹或 Git 工作副本目录" aria-label="知识库同步目录" title="填写多客户端共同访问的共享目录或已检出的 Git 工作副本"><button class="secondary" id="knowledge-sync" title="双向合并远程知识卡并报告冲突">远程同步</button></div><div id="knowledge-sync-status" class="notice">正在读取同步状态…</div><div id="knowledge-category-grid" class="knowledge-category-grid" aria-label="知识分类统计"></div><div id="knowledge-card-grid" class="knowledge-tree"></div></section>` : '';
  const expertMarkup = !isKnowledge ? `<section class="expert-workbench"><div class="expert-mode-row"><span class="expert-mode active" data-expert-mode="team" title="按 Agent Teams 团队协作：每个阶段的专家在各自配置的模型上执行">团队协作</span><small class="expert-mode-hint">开关在输入框的「专家」按钮上；这里只配置团队与阶段</small></div><div class="expert-columns"><section class="expert-column"><strong>团队与阶段</strong><label>团队<select id="expert-team" aria-label="专家团队"></select></label><div id="expert-stage-list" class="expert-stage-list" aria-label="Agent Teams 团队阶段"></div><div id="expert-config-status" class="notice">正在读取专家配置…</div></section><section class="expert-column"><strong>专家目录</strong><div id="expert-card-list" class="expert-card-list"></div></section><section class="expert-column expert-create-column"><strong>创建专家</strong><input id="expert-name-new" placeholder="专家名称" aria-label="专家名称"><input id="expert-role-new" placeholder="专业角色" aria-label="专家专业角色"><select id="expert-model-new" aria-label="专家模型"></select><label>调用知识库<select id="expert-knowledge-new" multiple aria-label="专家可调用的知识库"></select></label><select id="expert-permission-new" aria-label="专家权限"><option value="read-only">只读</option><option value="workspace-write">工作区写入</option><option value="full-access">完整访问</option></select><button class="primary" id="expert-create" title="创建由 Harness Agent Teams 调度的专家">创建专家</button><div id="expert-editor-status" class="notice">专家配置保存到独立专家目录。</div></section></div></section>` : '';
  await showPluginSurface(card(`${knowledgeMarkup}${expertMarkup}<details class="repository-details"><summary>${isKnowledge ? '仓库、检索与审计' : '专家仓库、检索与审计'}</summary><div class="toolbar"><input id="repo-query" placeholder="${isKnowledge ? '搜索知识卡或远程文档' : '搜索专家名称或描述'}" aria-label="仓库搜索"><button class="primary" id="repo-search" title="搜索已启用仓库">搜索</button><button class="secondary" id="repo-audit" title="审计来源、版本和摘要">审计</button></div><div id="repo-status" class="notice">正在读取隔离仓库目录…</div><div id="repo-results" class="grid"></div></details>`));
  const results = $('#repo-results'); const status = $('#repo-status');
  const renderCards = async () => {
    if (!isKnowledge) return;
    const cards = await window.taskhive.listKnowledgeCards($('#repo-query')?.value || '');
    const labels = { question: '问题', preference: '偏好', fact: '事实', decision: '决策', process: '流程', experience: '经验', conversation: '对话沉淀' };
    const grouped = Object.entries(labels).map(([type, label]) => ({ type, label, cards: cards.filter((item) => item.type === type) })).filter((group) => group.cards.length);
    const categoryGrid = $('#knowledge-category-grid');
    categoryGrid.innerHTML = Object.entries(labels).map(([type, label]) => { const items = cards.filter((item) => item.type === type); const approved = items.filter((item) => item.status === 'approved').length; return `<button class="knowledge-book" type="button" data-knowledge-type="${type}" title="展开${label}知识目录"><span class="knowledge-book-icon" aria-hidden="true">▯</span><strong>${label}</strong><small>${items.length} 张 · 已审核 ${approved}</small></button>`; }).join('');
    const grid = $('#knowledge-card-grid');
    grid.innerHTML = grouped.length ? grouped.map((group) => `<details class="knowledge-type-group" data-knowledge-group="${group.type}"><summary><span class="knowledge-book-icon" aria-hidden="true">▯</span><strong>${group.label}</strong><span>${group.cards.length}</span></summary>${['candidate','approved','rejected'].map((statusName) => { const statusCards = group.cards.filter((item) => item.status === statusName); if (!statusCards.length) return ''; return `<details class="knowledge-status-group"><summary>${statusName === 'candidate' ? '待审核' : statusName === 'approved' ? '已审核' : '已驳回'} · ${statusCards.length}</summary><div class="knowledge-card-grid">${statusCards.map((item) => `<article class="knowledge-card" data-card-id="${escapeHtml(item.id)}"><div class="knowledge-card-head"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.content)}</p><small>${escapeHtml(item.source)} · rev ${item.revision}</small>${item.status === 'candidate' ? '<div class="row-actions"><button class="secondary" data-card-approve title="审核通过此知识卡">审核通过</button><button class="danger" data-card-reject title="驳回此知识卡">驳回</button></div>' : ''}</article>`).join('')}</div></details>`; }).join('')}</details>`).join('') : '<div class="empty">暂无知识卡；可先沉淀一个有意义的问题。</div>';
    categoryGrid.querySelectorAll('[data-knowledge-type]').forEach((button) => { button.onclick = () => { const details = grid.querySelector(`[data-knowledge-group="${button.dataset.knowledgeType}"]`); if (details) { details.open = true; details.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }; });
    grid.querySelectorAll('[data-card-approve],[data-card-reject]').forEach((button) => { button.onclick = async () => { const article = button.closest('[data-card-id]'); const decision = button.hasAttribute('data-card-approve') ? 'approve' : 'reject'; try { await window.taskhive.reviewKnowledgeCard({ id: article.dataset.cardId, decision }); await renderCards(); } catch (error) { status.textContent = `知识卡片审核失败：${error.message}`; } }; });
  };
  const renderSyncStatus = async () => { if (!isKnowledge) return; try { const value = await window.taskhive.knowledgeSyncStatus(); $('#knowledge-remote-path').value = value.remotePath || ''; $('#knowledge-sync-status').textContent = `同步状态：${value.state} · 模式 ${value.mode} · revision ${value.revision} · 候选 ${value.pending} · 客户端 ${value.clients} · 冲突 ${value.conflicts}`; } catch (error) { $('#knowledge-sync-status').textContent = `同步状态读取失败：${error.message}`; } };
  const renderList = async () => {
    const items = await window.taskhive.listRepositories(kind);
    results.innerHTML = items.length ? items.map((item) => `<div class="plugin-row"><span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.id)} · v${escapeHtml(item.version || '-')} · ${escapeHtml(item.state || 'unknown')}</small></span><span>${item.installed ? '已安装' : '未安装'}</span></div>`).join('') : '<div class="empty">暂无已注册仓库；可在插件管理中从 Git/本地来源安装。</div>';
    status.textContent = `已读取 ${items.length} 个${heading}仓库；目录与索引均位于 1.0 隔离路径。`;
  };
  $('#repo-search').onclick = async () => { const query = $('#repo-query').value.trim(); if (isKnowledge) await renderCards(); if (!query) return renderList(); const hits = await window.taskhive.searchRepository({ kind, query }); results.innerHTML = hits.length ? hits.map((hit) => `<div class="plugin-row"><span><strong>${escapeHtml(hit.name)} · ${escapeHtml(hit.file)}</strong><small>${escapeHtml(hit.snippet)}</small></span></div>`).join('') : '<div class="empty">没有匹配结果。</div>'; status.textContent = `搜索完成：${hits.length} 条结果；结果不会自动写回 Harness 会话。`; };
  $('#repo-audit').onclick = async () => { const audit = await window.taskhive.auditRepository(kind); results.innerHTML = audit.length ? audit.map((item) => `<div class="plugin-row"><span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.source || 'local')} · ${escapeHtml(item.manifestHash || 'no-hash')}</small></span><span>${escapeHtml(item.state)}</span></div>`).join('') : '<div class="empty">暂无可审计仓库。</div>'; status.textContent = '审计完成：manifest、来源、版本和状态已显示。'; };
  if (isKnowledge) {
    $('#knowledge-card-create').onclick = async () => { const titleValue = $('#knowledge-card-title').value.trim(); const contentValue = $('#knowledge-card-content').value.trim(); try { await window.taskhive.createKnowledgeCard({ title: titleValue, content: contentValue, type: $('#knowledge-card-type').value, source: 'user-question' }); $('#knowledge-card-title').value = ''; $('#knowledge-card-content').value = ''; await renderCards(); await renderSyncStatus(); } catch (error) { $('#knowledge-sync-status').textContent = `卡片创建失败：${error.message}`; } };
    $('#knowledge-sync').onclick = async () => { const remotePath = $('#knowledge-remote-path').value.trim(); if (!remotePath) { $('#knowledge-sync-status').textContent = '请先填写共享文件夹或 Git 工作副本目录。'; return; } try { await window.taskhive.knowledgeSync({ mode: 'shared-folder-or-git', remotePath }); await renderSyncStatus(); await renderCards(); } catch (error) { $('#knowledge-sync-status').textContent = `同步失败：${error.message}`; } };
  }
  if (!isKnowledge) {
    const modelCatalog = await window.taskhive.listModels();
    const knowledgeLibraries = await window.taskhive.listRepositories('knowledge');
    const expertModelOptions = modelCatalog.providers.filter((provider) => provider.state === 'ready').flatMap((provider) => provider.models.map((model) => `<option value="${escapeHtml(provider.id)}::${escapeHtml(model)}">${escapeHtml(provider.name)} · ${escapeHtml(model)}</option>`)).join('');
    // Multi-model routing is per expert, so every expert needs an editable route.
    // Previously only the "create expert" form had a model picker, which meant a
    // seeded or imported expert kept an unusable provider forever (the shipped
    // team still says `ollama` while the registry registers `ollama-local`).
    const expertRouteOptions = modelCatalog.providers.filter((provider) => provider.state === 'ready').flatMap((provider) => provider.models.map((model) => ({ value: `${provider.id}::${model}`, label: `${provider.name} · ${model}` })));
    const expertRouteSelect = (current) => {
      const value = String(current || '');
      const known = expertRouteOptions.some((route) => route.value === value);
      // Show an unrecognised configured value explicitly instead of rendering an
      // empty select, so the mismatch is visible and fixable.
      const invalid = value && !known ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)} ⚠ 不在可用模型目录</option>` : '';
      return `<option value=""${value ? '' : ' selected'}>继承当前 Harness 模型</option>${invalid}${expertRouteOptions.map((route) => `<option value="${escapeHtml(route.value)}"${route.value === value ? ' selected' : ''}>${escapeHtml(route.label)}</option>`).join('')}`;
    };
    let expertConfig = await window.taskhive.expertStatus();
    const teamSelect = $('#expert-team'); const configStatus = $('#expert-config-status');
    const renderExpertConfig = () => {
      teamSelect.innerHTML = expertConfig.teams.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === expertConfig.selectedTeamId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
      // Team-only: the unit of execution is the selected team's stage pipeline, so
      // the surface reports the pipeline rather than a per-expert pick (the old
      // "具体专家" select wrote activeExpertId, which no run path ever read).
      const selectedTeam = expertConfig.teams.find((item) => item.id === teamSelect.value) || expertConfig.teams.find((item) => item.id === expertConfig.selectedTeamId);
      const stageCount = selectedTeam?.workflowStages?.length || 0;
      configStatus.textContent = `当前团队：${expertConfig.selectedTeamName || '未选择'}；按该团队的 ${stageCount} 个阶段流水线执行（每个阶段的专家在各自配置的模型上运行）。模型与知识库绑定读取专家定义。`;
      $('#expert-stage-list').innerHTML = (selectedTeam?.workflowStages || []).map((stage, index) => `<div class="expert-stage" data-expert-stage="${escapeHtml(stage.id)}"><strong>${index + 1}. ${escapeHtml(stage.id)}</strong><small>${stage.dependsOn.length ? `依赖：${escapeHtml(stage.dependsOn.join(', '))}` : '起始阶段'}${stage.trigger ? ` · ${escapeHtml(stage.trigger)}` : ''}</small></div>`).join('') || '<small>该团队未配置阶段流水线。</small>';
      $('#expert-card-list').innerHTML = expertConfig.experts.map((item) => `<article class="expert-summary-card" data-expert-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.role || '专家')}</span><small>${escapeHtml(item.providerId || '继承')} · ${escapeHtml(item.model || '当前模型')} · ${escapeHtml(item.permissions || 'read-only')}</small><small>知识库：${escapeHtml((item.knowledgeLibraryIds || []).join(', ') || '未绑定')}</small><label class="expert-route"><span>模型路由</span><select data-expert-model="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 模型路由" title="为该专家指定 provider/model；运行团队时每个专家按此路由并行执行">${expertRouteSelect(item.providerId && item.model ? `${item.providerId}::${item.model}` : '')}</select></label>${String(item.id || '').startsWith('expert-') ? `<button class="secondary" data-expert-remove="${escapeHtml(item.id)}" title="删除这个自定义专家">删除</button>` : ''}</article>`).join('');
      $('#expert-card-list').querySelectorAll('[data-expert-model]').forEach((select) => {
        select.onchange = async () => {
          const [providerId, model] = String(select.value || '').split('::');
          try {
            expertConfig = await window.taskhive.updateExpert({ id: select.dataset.expertModel, providerId: providerId || '', model: model || '' });
            $('#expert-editor-status').textContent = providerId ? `已保存 ${providerId}/${model}：团队运行时会用该模型执行这个专家。` : '已改为继承当前 Harness 模型。';
            renderExpertConfig();
          } catch (error) { $('#expert-editor-status').textContent = `模型路由保存失败：${error.message}`; }
        };
      });
      $('#expert-card-list').querySelectorAll('[data-expert-remove]').forEach((button) => { button.onclick = async () => { try { expertConfig = await window.taskhive.removeExpert(button.dataset.expertRemove); $('#expert-editor-status').textContent = '自定义专家已删除。'; renderExpertConfig(); } catch (error) { $('#expert-editor-status').textContent = `删除失败：${error.message}`; } }; });
      // Expert mode is team-only: the mode switch that could disable this select is
      // gone, so the team is always the unit of execution.
      teamSelect.disabled = expertConfig.teams.length === 0;
    };
    teamSelect.onchange = async () => { try { expertConfig = await window.taskhive.setExpertSelection({ teamId: teamSelect.value, expertId: '' }); renderExpertConfig(); } catch (error) { configStatus.textContent = `专家团队保存失败：${error.message}`; } };
    renderExpertConfig();
    $('#expert-model-new').innerHTML = `<option value="">继承当前 Harness 模型</option>${expertModelOptions}`;
    $('#expert-knowledge-new').innerHTML = knowledgeLibraries.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)} · ${escapeHtml(item.state || 'unknown')}</option>`).join('');
    $('#expert-create').onclick = async () => { const name = $('#expert-name-new').value.trim(); if (!name) return; const [providerId = '', model = ''] = $('#expert-model-new').value.split('::'); const knowledgeLibraryIds = [...$('#expert-knowledge-new').selectedOptions].map((item) => item.value).filter(Boolean); try { expertConfig = await window.taskhive.createExpert({ name, role: $('#expert-role-new').value.trim(), providerId, model, knowledgeLibraryIds, permissions: $('#expert-permission-new').value }); $('#expert-editor-status').textContent = `已创建专家：${name}`; $('#expert-name-new').value = ''; $('#expert-role-new').value = ''; $('#expert-model-new').value = ''; for (const option of $('#expert-knowledge-new').options) option.selected = false; renderExpertConfig(); } catch (error) { $('#expert-editor-status').textContent = `创建失败：${error.message}`; } };
  }
  await renderList();
  await renderCards();
  await renderSyncStatus();
}

async function renderSimple(kind) {
  const data = {
    'web-ai': ['浏览器', '网页 AI 浏览器', '网页登录由用户管理，TaskHive 不读取密码或 Cookie。'],
    settings: ['设置', '沿用旧版设置入口和输入逻辑。', '当前 MVP 使用隔离 profile，不读取旧版 Token 或 Cookie。']
  }[kind] || [kind, '插件界面尚未装配。', '该能力当前标记为 runtime-unverified。'];
  title.textContent = data[0]; badge.textContent = '统一工作区';
  await showPluginSurface(card(`<div class="eyebrow">${data[0]}</div><h2>${data[1]}</h2><p>${data[2]}</p><div class="notice">认证、模型和插件状态均通过 Harness profile 管理。</div>`));
}

async function renderCharts() {
  title.textContent = '图表'; badge.textContent = '';
  await showPluginSurface(card(`<h2>图表</h2><p>输入结构化 JSON，在本地生成黑白 SVG；数据不会发送到远程服务。</p><div class="toolbar"><select id="chart-kind"><option value="bar">柱状图</option><option value="line">折线图</option><option value="pie">饼图</option><option value="state">状态流</option><option value="sequence">时序图</option><option value="register">寄存器图</option></select><button class="primary" id="chart-render">生成</button><button class="secondary" id="chart-svg">导出 SVG</button><button class="secondary" id="chart-json">导出 JSON</button></div><textarea id="chart-data" rows="7">{"labels":["A","B","C"],"values":[12,28,19]}</textarea><div id="chart-output" class="chart-output"></div><div id="chart-status" class="notice">等待结构化数据。</div>`));
  let currentSvg = ''; let currentData = null;
  const render = () => { try { currentData = JSON.parse($('#chart-data').value); const labels = Array.isArray(currentData.labels) ? currentData.labels.map(String) : []; const values = Array.isArray(currentData.values) ? currentData.values.map(Number) : []; if (!labels.length || labels.length !== values.length || values.some((value) => !Number.isFinite(value))) throw new Error('labels 与 values 必须为等长数组'); const width = 760; const height = 360; const max = Math.max(1, ...values.map(Math.abs)); const points = values.map((value, index) => ({ x: 60 + index * ((width - 100) / Math.max(1, values.length - 1)), y: height - 50 - Math.abs(value) / max * 250, value, label: labels[index] })); const kind = $('#chart-kind').value; const bars = points.map((point, index) => `<g><rect x="${45 + index * ((width - 80) / values.length)}" y="${point.y}" width="${Math.max(12, (width - 100) / values.length - 14)}" height="${height - 50 - point.y}" fill="#171717"/><text x="${point.x}" y="${height - 24}" text-anchor="middle">${escapeHtml(point.label)}</text><text x="${point.x}" y="${point.y - 8}" text-anchor="middle">${point.value}</text></g>`).join(''); const line = `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="#171717" stroke-width="2"/>${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#fff" stroke="#171717"/><text x="${point.x}" y="${point.y - 10}" text-anchor="middle">${point.value}</text><text x="${point.x}" y="${height - 24}" text-anchor="middle">${escapeHtml(point.label)}</text>`).join('')}`; const flow = points.map((point, index) => `<g><rect x="${35 + index * ((width - 70) / values.length)}" y="135" width="${Math.max(70, (width - 100) / values.length - 16)}" height="64" rx="4" fill="#fff" stroke="#171717"/><text x="${point.x}" y="160" text-anchor="middle">${escapeHtml(point.label)}</text><text x="${point.x}" y="182" text-anchor="middle">${point.value}</text>${index < points.length - 1 ? `<path d="M${point.x + 35} 167H${points[index + 1].x - 35}" stroke="#171717" marker-end="url(#a)"/>` : ''}</g>`).join(''); currentSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><defs><marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#171717"/></marker></defs><rect width="100%" height="100%" fill="#fff"/><g font-family="system-ui" font-size="12" fill="#171717"><path d="M40 20V310H730" fill="none" stroke="#777"/>${kind === 'line' || kind === 'sequence' ? line : kind === 'state' || kind === 'register' ? flow : bars}</g></svg>`; $('#chart-output').innerHTML = currentSvg; $('#chart-status').textContent = `已生成${$('#chart-kind').selectedOptions[0].textContent}；可导出 SVG 或 JSON。`; } catch (error) { $('#chart-status').textContent = `生成失败：${error.message}`; } };
  const download = (name, type, text) => { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([text], { type })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); };
  $('#chart-render').onclick = render; $('#chart-svg').onclick = () => currentSvg && download('taskhive-chart.svg', 'image/svg+xml', currentSvg); $('#chart-json').onclick = () => currentData && download('taskhive-chart.json', 'application/json', JSON.stringify(currentData, null, 2)); render();
}

async function renderWebAi() {
  title.textContent = '浏览器'; badge.textContent = '';
  state.unsubscribeWebAiState?.();
  let preferences = await window.taskhive.browserPreferences();
  await showPluginSurface(`<section class="browser-surface"><div class="browser-chrome"><div class="browser-tabs-row"><div id="web-ai-tabs" class="browser-tabs" role="tablist" aria-label="浏览器标签页"></div><button class="browser-icon-button" id="web-ai-new-window" type="button" aria-label="新建标签页" title="新建豆包标签页">＋</button><span id="web-ai-status" class="browser-status">网页登录由各站点管理</span></div><div class="browser-nav-row" role="toolbar" aria-label="浏览器导航"><button class="browser-icon-button" id="web-ai-back" type="button" aria-label="后退" title="后退" disabled>←</button><button class="browser-icon-button" id="web-ai-forward" type="button" aria-label="前进" title="前进" disabled>→</button><button class="browser-icon-button" id="web-ai-reload" type="button" aria-label="刷新网页" title="刷新网页" disabled>↻</button><button class="browser-icon-button" id="web-ai-home" type="button" aria-label="打开主页" title="打开自定义主页">⌂</button><form id="web-ai-address-form" class="browser-address-form"><span class="browser-security-mark" aria-hidden="true">⌾</span><input id="web-ai-address" aria-label="网页地址" autocomplete="off" spellcheck="false" placeholder="输入网址"><button class="browser-address-action" id="web-ai-bookmark-current" type="button" aria-label="收藏当前页面" title="收藏当前页面">☆</button></form><select id="web-ai-bookmarks" aria-label="收藏夹" title="收藏夹"></select><button class="browser-icon-button" id="web-ai-open-bookmark" type="button" aria-label="打开收藏页面" title="打开所选收藏">↗</button><button class="browser-icon-button" id="web-ai-remove-bookmark" type="button" aria-label="删除收藏" title="删除所选自定义收藏">×</button><button class="browser-icon-button" id="web-ai-set-home" type="button" aria-label="设为主页" title="将当前页面设为浏览器主页">◎</button></div></div><div class="browser-empty">正在打开豆包…</div></section>`);
  let browserState = { activeId: null, windows: [] };
  const activeTab = () => browserState.windows.find((item) => item.id === browserState.activeId) || null;
  const renderState = (next) => {
    if (!next || !$('#web-ai-tabs')) return;
    browserState = next;
    const tabs = $('#web-ai-tabs');
    tabs.innerHTML = next.windows.map((item) => `<button class="browser-tab ${item.id === next.activeId ? 'active' : ''}" type="button" role="tab" aria-selected="${item.id === next.activeId}" data-web-tab="${escapeHtml(item.id)}"><span class="browser-tab-title">${escapeHtml(item.title || item.providerName || '新标签页')}</span>${item.loading ? '<span class="browser-tab-loading" aria-label="正在加载"></span>' : ''}<span class="browser-tab-close" data-web-close="${escapeHtml(item.id)}" role="button" aria-label="关闭标签页">×</span></button>`).join('');
    const active = activeTab();
    $('#web-ai-address').value = active?.url || '';
    $('#web-ai-back').disabled = !active?.canGoBack;
    $('#web-ai-forward').disabled = !active?.canGoForward;
    $('#web-ai-reload').disabled = !active;
    const bridgeText = {
      opening: ' · 正在打开模型',
      'waiting-login': ' · 请在页面完成登录',
      submitting: ' · 正在提交问题',
      generating: ' · 已返回对话，正在生成',
      completed: ' · 回复已回传对话',
      failed: ` · 请求失败${next.bridge?.code ? `（${next.bridge.code}）` : ''}`,
    }[next.bridge?.state] || '';
    $('#web-ai-status').textContent = active ? `${active.providerName} · ${next.windows.length} 个标签页${active.loading ? ' · 正在加载' : ''}${bridgeText}` : `暂无标签页${bridgeText}`;
    tabs.querySelectorAll('[data-web-tab]').forEach((button) => { button.onclick = async (event) => { const closeId = event.target?.dataset?.webClose; if (closeId) { event.stopPropagation(); renderState(await window.taskhive.closeWebAiWindow(closeId)); return; } renderState(await window.taskhive.switchWebAiWindow(button.dataset.webTab)); }; });
  };
  const refresh = async () => renderState(await window.taskhive.listWebAiWindows());
  const openUrl = async (url, newWindow = false) => { $('#web-ai-status').textContent = '正在打开网页…'; try { renderState(await window.taskhive.openWebAi({ providerId: 'doubao', url, newWindow })); } catch (error) { $('#web-ai-status').textContent = `打开失败：${error.message}`; } };
  const renderBookmarks = () => {
    const select = $('#web-ai-bookmarks');
    select.innerHTML = preferences.bookmarks.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('');
    $('#web-ai-remove-bookmark').disabled = !preferences.bookmarks.length || preferences.bookmarks.find((item) => item.id === select.value)?.builtin === true;
  };
  state.unsubscribeWebAiState = window.taskhive.onWebAiState?.(renderState) || null;
  renderBookmarks();
  $('#web-ai-new-window').onclick = () => openUrl(preferences.homepage, true);
  $('#web-ai-home').onclick = () => openUrl(preferences.homepage, false);
  $('#web-ai-open-bookmark').onclick = () => { const item = preferences.bookmarks.find((entry) => entry.id === $('#web-ai-bookmarks').value); if (item) void openUrl(item.url, false); };
  $('#web-ai-bookmarks').onchange = () => { const item = preferences.bookmarks.find((entry) => entry.id === $('#web-ai-bookmarks').value); $('#web-ai-remove-bookmark').disabled = !item || item.builtin === true; };
  $('#web-ai-bookmark-current').onclick = async () => { const active = activeTab(); if (!active?.url) return; preferences = await window.taskhive.addBrowserBookmark({ title: active.title || active.providerName, url: active.url }); renderBookmarks(); $('#web-ai-status').textContent = '当前页面已加入收藏夹'; };
  $('#web-ai-remove-bookmark').onclick = async () => { const id = $('#web-ai-bookmarks').value; if (!id) return; preferences = await window.taskhive.removeBrowserBookmark(id); renderBookmarks(); $('#web-ai-status').textContent = '自定义收藏已删除'; };
  $('#web-ai-set-home').onclick = async () => { const active = activeTab(); if (!active?.url) return; preferences = await window.taskhive.setBrowserHomepage(active.url); $('#web-ai-status').textContent = '当前页面已设为浏览器主页'; };
  $('#web-ai-back').onclick = async () => renderState(await window.taskhive.commandWebAi({ id: browserState.activeId, command: 'back' }));
  $('#web-ai-forward').onclick = async () => renderState(await window.taskhive.commandWebAi({ id: browserState.activeId, command: 'forward' }));
  $('#web-ai-reload').onclick = async () => renderState(await window.taskhive.commandWebAi({ id: browserState.activeId, command: activeTab()?.loading ? 'stop' : 'reload' }));
  $('#web-ai-address-form').onsubmit = async (event) => { event.preventDefault(); if (!browserState.activeId) return; $('#web-ai-status').textContent = '正在打开网页…'; try { renderState(await window.taskhive.navigateWebAi({ id: browserState.activeId, url: $('#web-ai-address').value })); } catch (error) { $('#web-ai-status').textContent = `地址无法打开：${error.message}`; } };
  const existing = await window.taskhive.listWebAiWindows();
  if (existing.windows.length) renderState(existing); else await openUrl(preferences.homepage, true);
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }

function selectSurface(kind) {
  requestedSurface = kind;
  surfaceRenderQueue = surfaceRenderQueue.catch(() => {}).then(async () => {
    // The embedded renderer starts by preparing chat. A first plugin-open can
    // arrive during that async initialization; serialize requests so the
    // initial chat render cannot overwrite the user's later CODESYS request.
    if (kind !== requestedSurface) return;
    setActiveNav(kind);
    if (kind !== 'codesys') await teardownCodesysSurface();
    if (kind !== 'web-ai') { state.unsubscribeWebAiState?.(); state.unsubscribeWebAiState = null; }
    if (kind === 'chat') await renderChat();
    else if (kind === 'codesys') await renderCodesys();
    else if (kind === 'packages') await renderPackages();
    else if (kind === 'knowledge' || kind === 'experts') await renderRepositorySurface(kind);
    else if (kind === 'charts') await renderCharts();
    else if (kind === 'web-ai') await renderWebAi();
    else if (kind === 'settings') await renderSettings();
    else await renderSimple(kind);
    log(`切换到${document.title}`);
  });
  return surfaceRenderQueue;
}

window.addEventListener('message', (event) => {
  if (event.data?.source === 'taskhive-main' && event.data?.type === 'codesys.task') {
    harnessFrame?.contentWindow?.postMessage({ source: 'taskhive-desktop', type: 'codesys.task', payload: event.data.payload || {} }, '*');
    return;
  }
  if (event.data?.source !== 'taskhive-dsh') return;
  if (event.data?.type === 'surface.geometry') {
    state.workspaceGeometry = event.data.geometry || null;
    applyWorkspaceGeometry();
    return;
  }
  if (event.data?.type === 'surface.open') void selectSurface(event.data.surface);
});

  (async () => { try { const status = await window.taskhive.harnessStatus(); document.documentElement.dataset.harnessState = status.runtime?.state || status.state || 'unknown'; const node = $('#harness-state'); if (node) node.textContent = status.runtime?.state === 'ready' ? '已就绪' : '需检查'; } catch { document.documentElement.dataset.harnessState = 'error'; const node = $('#harness-state'); if (node) node.textContent = '需检查'; } await renderSidebars(); await selectSurface(requestedSurface); })();
