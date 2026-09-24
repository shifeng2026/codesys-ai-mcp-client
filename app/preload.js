const { contextBridge, ipcRenderer } = require('electron');

const CLOSE_DIALOG_ID = 'taskhive-close-confirm-root';

function dismissCloseConfirmation(confirmed, notify = true) {
  const root = document.getElementById(CLOSE_DIALOG_ID);
  if (!root) return;
  for (const item of root.__taskhiveBackgroundNodes || []) {
    item.node.inert = item.inert;
  }
  const previousFocus = root.__taskhivePreviousFocus;
  root.remove();
  if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  if (notify) ipcRenderer.send('app:close-confirmation-result', confirmed === true);
}

function showCloseConfirmation(input = {}) {
  dismissCloseConfirmation(false, false);
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const root = document.createElement('div');
  root.id = CLOSE_DIALOG_ID;
  root.dataset.taskhiveCloseConfirmOverlay = 'true';
  root.innerHTML = `<style>
    #${CLOSE_DIALOG_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:rgba(17,17,17,.24);backdrop-filter:blur(2px);font-family:Inter,"Microsoft YaHei",system-ui,sans-serif;color:var(--dsw-alias-label-primary,#171717)}
    #${CLOSE_DIALOG_ID} [data-taskhive-close-confirm]{width:min(420px,calc(100vw - 48px));overflow:hidden;border:1px solid var(--dsw-alias-border-subtle,rgba(23,23,23,.14));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 20px 56px rgba(0,0,0,.18)}
    #${CLOSE_DIALOG_ID} .taskhive-close-copy{padding:22px 22px 19px}
    #${CLOSE_DIALOG_ID} h2{margin:0;font:600 17px/1.35 Inter,"Microsoft YaHei",system-ui,sans-serif}
    #${CLOSE_DIALOG_ID} p{margin:9px 0 0;color:var(--dsw-alias-label-secondary,#666);font:400 13px/1.65 Inter,"Microsoft YaHei",system-ui,sans-serif}
    #${CLOSE_DIALOG_ID} .taskhive-close-actions{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-subtle,#e4e4e4);background:var(--dsw-alias-bg-layer-2,#fafafa)}
    #${CLOSE_DIALOG_ID} button{height:34px;padding:0 14px;border:1px solid var(--dsw-alias-border-subtle,#d4d4d4);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#242424);font:500 13px Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}
    #${CLOSE_DIALOG_ID} button:hover{border-color:#b8b8b8;background:var(--dsw-alias-bg-layer-3,#f1f1f1)}
    #${CLOSE_DIALOG_ID} button:focus-visible{outline:2px solid var(--dsw-alias-accent-primary,#171717);outline-offset:2px}
    #${CLOSE_DIALOG_ID} [data-close-action="confirm"]{border-color:var(--dsw-alias-accent-primary,#171717);background:var(--dsw-alias-accent-primary,#171717);color:#fff}
    #${CLOSE_DIALOG_ID} [data-close-action="confirm"]:hover{border-color:#000;background:#000}
    @media (prefers-reduced-motion:reduce){#${CLOSE_DIALOG_ID} button{transition:none}}
  </style><section data-taskhive-close-confirm role="dialog" aria-modal="true" aria-labelledby="taskhive-close-title" aria-describedby="taskhive-close-detail"><div class="taskhive-close-copy"><h2 id="taskhive-close-title"></h2><p id="taskhive-close-detail"></p></div><div class="taskhive-close-actions"><button data-close-action="cancel" type="button" title="取消关闭并继续使用 TaskHive" aria-label="取消关闭">取消</button><button data-close-action="confirm" type="button" title="安全回收任务并关闭客户端" aria-label="关闭客户端">关闭客户端</button></div></section>`;
  root.querySelector('#taskhive-close-title').textContent = String(input.title || '关闭 TaskHive？');
  root.querySelector('#taskhive-close-detail').textContent = String(input.detail || '关闭前会安全回收所有运行任务。');
  const cancel = root.querySelector('[data-close-action="cancel"]');
  const confirm = root.querySelector('[data-close-action="confirm"]');
  cancel.addEventListener('click', () => dismissCloseConfirmation(false));
  confirm.addEventListener('click', () => dismissCloseConfirmation(true));
  root.addEventListener('click', (event) => { if (event.target === root) dismissCloseConfirmation(false); });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); dismissCloseConfirmation(false); return; }
    if (event.key !== 'Tab') return;
    const target = document.activeElement === cancel && event.shiftKey ? confirm : document.activeElement === confirm && !event.shiftKey ? cancel : null;
    if (target) { event.preventDefault(); target.focus(); }
  });
  root.__taskhivePreviousFocus = previousFocus;
  root.__taskhiveBackgroundNodes = Array.from(document.body.children).map((node) => ({ node, inert: node.inert }));
  for (const item of root.__taskhiveBackgroundNodes) item.node.inert = true;
  document.body.appendChild(root);
  cancel.focus();
}

ipcRenderer.on('app:close-confirmation', (_event, input) => showCloseConfirmation(input));

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'taskhive-dsh') return;
  if (event.data.type === 'surface.open') ipcRenderer.send('surface:open', String(event.data.surface || ''));
  if (event.data.type === 'surface.geometry') ipcRenderer.send('surface:geometry', event.data.geometry || null);
  if (event.data.type === 'settings.visibility') ipcRenderer.send('settings:visibility', event.data.visible === true);
});

contextBridge.exposeInMainWorld('taskhive', {
  harnessStatus: () => ipcRenderer.invoke('harness:status'),
  harnessUrl: () => ipcRenderer.invoke('harness:url'),
  listModels: () => ipcRenderer.invoke('models:list'),
  selectModel: (input) => ipcRenderer.invoke('models:select', input),
  setModelVisible: (input) => ipcRenderer.invoke('models:set-visible', input),
  addCustomModel: (input) => ipcRenderer.invoke('models:add-custom', input),
  setModelCredential: (input) => ipcRenderer.invoke('models:set-credential', input || {}),
  removeCustomModel: (providerId) => ipcRenderer.invoke('models:remove-custom', providerId),
  listDirectories: () => ipcRenderer.invoke('settings:directories'),
  saveDirectory: (input) => ipcRenderer.invoke('settings:directory-save', input || {}),
  removeDirectory: (id) => ipcRenderer.invoke('settings:directory-remove', id),
  restoreDirectories: () => ipcRenderer.invoke('settings:directory-restore'),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPluginPlacement: (input) => ipcRenderer.invoke('plugins:placement', input),
  setPluginOrder: (input) => ipcRenderer.invoke('plugins:order', input),
  installPlugin: (input) => ipcRenderer.invoke('plugins:install', input),
  uninstallPlugin: (id) => ipcRenderer.invoke('plugins:uninstall', id),
  enablePlugin: (id) => ipcRenderer.invoke('plugins:enable', id),
  disablePlugin: (id) => ipcRenderer.invoke('plugins:disable', id),
  restorePlugin: (id) => ipcRenderer.invoke('plugins:restore', id),
  listRepositories: (kind) => ipcRenderer.invoke('repositories:list', kind),
  searchRepository: (input) => ipcRenderer.invoke('repositories:search', input),
  auditRepository: (kind) => ipcRenderer.invoke('repositories:audit', kind),
  installRepository: (input) => ipcRenderer.invoke('repositories:install', input),
  uninstallRepository: (input) => ipcRenderer.invoke('repositories:uninstall', input),
  enableRepository: (input) => ipcRenderer.invoke('repositories:enable', input),
  disableRepository: (input) => ipcRenderer.invoke('repositories:disable', input),
  restoreRepository: (input) => ipcRenderer.invoke('repositories:restore', input),
  listKnowledgeCards: (query) => ipcRenderer.invoke('knowledge:cards', query),
  createKnowledgeCard: (input) => ipcRenderer.invoke('knowledge:create-card', input),
  captureKnowledgeFromConversation: (input) => ipcRenderer.invoke('knowledge:capture-conversation', input),
  reviewKnowledgeCard: (input) => ipcRenderer.invoke('knowledge:review-card', input),
  knowledgeSyncStatus: () => ipcRenderer.invoke('knowledge:sync-status'),
  knowledgeSync: (input) => ipcRenderer.invoke('knowledge:sync', input),
  expertStatus: () => ipcRenderer.invoke('experts:status'),
  setExpertEnabled: (enabled) => ipcRenderer.invoke('experts:set-enabled', { enabled }),
  setExpertSelection: (input) => ipcRenderer.invoke('experts:set-selection', input || {}),
  createExpert: (input) => ipcRenderer.invoke('experts:create', input || {}),
  updateExpert: (input) => ipcRenderer.invoke('experts:update', input || {}),
  removeExpert: (id) => ipcRenderer.invoke('experts:remove', id),
  // The composer's expert control and the expert plugin are two views of one
  // switch, so the host pushes every change instead of each view caching it.
  onExpertStatus: (callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on('experts:changed', listener); return () => ipcRenderer.removeListener('experts:changed', listener); },
  openWebAi: (input) => ipcRenderer.invoke('web-ai:open', input),
  webAiAuthStatus: (modelId) => ipcRenderer.invoke('web-ai:auth-status', modelId),
  browserPreferences: () => ipcRenderer.invoke('browser:preferences'),
  setBrowserHomepage: (homepage) => ipcRenderer.invoke('browser:set-homepage', homepage),
  addBrowserBookmark: (input) => ipcRenderer.invoke('browser:add-bookmark', input),
  removeBrowserBookmark: (id) => ipcRenderer.invoke('browser:remove-bookmark', id),
  listWebAiWindows: () => ipcRenderer.invoke('web-ai:list'),
  switchWebAiWindow: (id) => ipcRenderer.invoke('web-ai:switch', id),
  closeWebAiWindow: (id) => ipcRenderer.invoke('web-ai:close', id),
  navigateWebAi: (input) => ipcRenderer.invoke('web-ai:navigate', input || {}),
  commandWebAi: (input) => ipcRenderer.invoke('web-ai:command', input || {}),
  onWebAiState: (callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on('web-ai:state', listener); return () => ipcRenderer.removeListener('web-ai:state', listener); },
  listCodesysWindows: () => ipcRenderer.invoke('codesys:list-windows'),
  currentCodesysProject: (input) => ipcRenderer.invoke('codesys:current-project', input || {}),
  openCodesysProgram: () => ipcRenderer.invoke('codesys:open-program'),
  fitCodesysWindow: (input) => ipcRenderer.invoke('codesys:fit-window', input || {}),
  captureCodesys: (id) => ipcRenderer.invoke('codesys:capture', id),
  resolveCodesysStreamSource: (input) => ipcRenderer.invoke('codesys:stream-source', input || {}),
  startCodesysStream: (input) => ipcRenderer.invoke('codesys:stream-start', input),
  stopCodesysStream: (id) => ipcRenderer.invoke('codesys:stream-stop', id),
  onCodesysFrame: (callback) => { const listener = (_event, frame) => callback(frame); ipcRenderer.on('codesys:frame', listener); return () => ipcRenderer.removeListener('codesys:frame', listener); },
  visualStatus: () => ipcRenderer.invoke('codesys:visual-status'),
  analyzeCapture: (capture) => ipcRenderer.invoke('codesys:visual-analyze', capture),
  codesysScriptEngineStatus: () => ipcRenderer.invoke('codesys:scriptengine-status'),
  configureCodesysScriptEngine: () => ipcRenderer.invoke('codesys:scriptengine-configure'),
  probeCodesysScriptEngine: (input) => ipcRenderer.invoke('codesys:scriptengine-probe', input || {}),
  runCodesysScriptEngineAction: (action, input) => ipcRenderer.invoke('codesys:scriptengine-action', { action, input: input || {} }),
  codesysOnlineStatus: () => ipcRenderer.invoke('codesys:online-status'),
  // 主进程新旧自检：这个通道不存在（调用抛错）就说明跑着的主进程比界面旧。
  codesysEngineFreshness: () => ipcRenderer.invoke('codesys:engine-freshness'),
  prepareCodesysOnline: (input) => ipcRenderer.invoke('codesys:online-prepare', input || {}),
  setCodesysOnlineTarget: (input) => ipcRenderer.invoke('codesys:online-set-target', input || {}),
  scanCodesysOnlineDevices: (input) => ipcRenderer.invoke('codesys:online-scan', input || {}),
  releaseCodesysOnline: () => ipcRenderer.invoke('codesys:online-release'),
  armCodesysOnline: (input) => ipcRenderer.invoke('codesys:online-arm', input || {}),
  disarmCodesysOnline: (input) => ipcRenderer.invoke('codesys:online-disarm', input || {}),
  runCodesysOnlineAction: (action, input) => ipcRenderer.invoke('codesys:online-action', { action, input: input || {} }),
  monitorCodesysOnline: (input) => ipcRenderer.invoke('codesys:online-monitor', input || {}),
  selectCodesysOfflineFile: (kind) => ipcRenderer.invoke('codesys:select-offline-file', kind || 'project'),
  copyCodesysProjectPath: (sourcePath) => ipcRenderer.invoke('codesys:copy-project-path', sourcePath),
  revealCodesysProject: (sourcePath) => ipcRenderer.invoke('codesys:reveal-project', sourcePath),
  codesysNativeHostStatus: () => ipcRenderer.invoke('codesys:native-host-status'),
  attachCodesysNativeHost: (input) => ipcRenderer.invoke('codesys:native-host-attach', input || {}),
  moveCodesysNativeHost: (bounds) => ipcRenderer.invoke('codesys:native-host-move', bounds || {}),
  detachCodesysNativeHost: () => ipcRenderer.invoke('codesys:native-host-detach'),
  requestCodesysInput: (input) => ipcRenderer.invoke('codesys:input-request', input || {}),
  executeCodesysInput: (approvalId) => ipcRenderer.invoke('codesys:input-execute', approvalId),
  executeCodesysInputDirect: (input) => ipcRenderer.invoke('codesys:input-direct', input || {}),
  armCodesysInput: (input) => ipcRenderer.invoke('codesys:input-arm', input || {}),
  openCodesysWorkbench: (input) => ipcRenderer.invoke('codesys:workbench-open', input || {}),
  setCodesysPreferredWindow: (input) => ipcRenderer.invoke('codesys:preferred-window', input || {}),
  requestCodesysCodeAi: (input) => ipcRenderer.invoke('codesys:code-ai-request', input || {}),
  runTerminal: (command) => ipcRenderer.invoke('terminal:run', command),
  startTerminal: (command) => ipcRenderer.invoke('terminal:start', command),
  stopTerminal: (taskId) => ipcRenderer.invoke('terminal:stop', taskId),
  terminalStatus: () => ipcRenderer.invoke('terminal:status'),
  onTerminalData: (callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on('terminal:data', listener); return () => ipcRenderer.removeListener('terminal:data', listener); },
  onTerminalExit: (callback) => { const listener = (_event, value) => callback(value); ipcRenderer.on('terminal:exit', listener); return () => ipcRenderer.removeListener('terminal:exit', listener); },
});
