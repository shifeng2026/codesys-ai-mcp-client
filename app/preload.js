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
  // T199（②）：设置页「启动」页签里的后台代价开关（启动时预打开 CODESYS 工程）。它读写的是
  // 应用自己的 userData 里那份 codesys-preferences.json（走既有 atomic-json 读写路径）。
  // 两个方法在 DSH 侧（client.js + dsh/src/**）都是 0 个调用点 —— 只有外壳设置页在用，
  // 所以两个通道都登记在 main.js 的 CODESYS_PANEL_ONLY_CHANNELS 里（判据：sender 必须是
  // 外壳 app/renderer 文档的顶层帧）。
  codesysPreopenPreference: () => ipcRenderer.invoke('settings:codesys-preopen'),
  saveCodesysPreopenPreference: (input) => ipcRenderer.invoke('settings:codesys-preopen-save', input || {}),
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
  listKnowledgeRepositories: () => ipcRenderer.invoke('knowledge:repositories'),
  createKnowledgeCard: (input) => ipcRenderer.invoke('knowledge:create-card', input),
  captureKnowledgeFromConversation: (input) => ipcRenderer.invoke('knowledge:capture-conversation', input),
  reviewKnowledgeCard: (input) => ipcRenderer.invoke('knowledge:review-card', input),
  setKnowledgeCardCategory: (input) => ipcRenderer.invoke('knowledge:set-card-category', input),
  setKnowledgeCardsCategory: (input) => ipcRenderer.invoke('knowledge:set-cards-category', input),
  listKnowledgeBooks: () => ipcRenderer.invoke('knowledge:books'),
  aiClassifyKnowledge: (input) => ipcRenderer.invoke('knowledge:ai-classify', input || {}),
  knowledgeAiRoute: () => ipcRenderer.invoke('knowledge:ai-route'),
  setKnowledgeBookMeta: (input) => ipcRenderer.invoke('knowledge:set-book-meta', input),
  knowledgeSyncStatus: () => ipcRenderer.invoke('knowledge:sync-status'),
  knowledgeSync: (input) => ipcRenderer.invoke('knowledge:sync', input),
  // T166：知识库导出 / 导入（单个可移植文件）。路径由主进程对话框决定：
  // 导出返回落盘路径，导入先预检（返回摘要 + token）再应用（merge / replace）。
  knowledgeExportBundle: (input) => ipcRenderer.invoke('knowledge:export-bundle', input || {}),
  knowledgeImportInspect: (input) => ipcRenderer.invoke('knowledge:import-inspect', input || {}),
  knowledgeImportApply: (input) => ipcRenderer.invoke('knowledge:import-apply', input || {}),
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
  // 用户的删除要求（2026-10）：「AI 实时监视」通道整体删除 ——
  // codesys:fit-window / codesys:capture / codesys:stream-source /
  // codesys:stream-start / codesys:stream-stop 与 codesys:visual-status /
  // codesys:visual-analyze（ModLens）不再由主进程注册，所以这里也不再暴露，
  // 否则界面会拿到一个必定失败的孤儿通道。窗口枚举与原生窗口托管保持原样。
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
  // T164：requestCodesysInput 随"面板遥控"一起移除（主进程侧通道已删除，留着就是孤儿 invoke）。
  // T164：executeCodesysInput / executeCodesysInputDirect 随"面板遥控"一起移除。
  // T174：AI 对话的界面搬进外壳 CODESYS 面板自己渲染（不再往 DSH 原生右栏里塞 DOM），
  // 因此宿主侧只需要下面这几个：一个开关 + 三个**纯数据**入口（快照 / 发送 / 模型）。数据桥本体在
  // DSH 客户端插件 shard 78 —— 只有 DSH 文档里有 `sessions` 服务，"主页那条会话"在那里。
  toggleCodesysAiChat: (input) => ipcRenderer.invoke('codesys:ai-chat', input || {}),
  codesysAiChatSnapshot: (input) => ipcRenderer.invoke('codesys:ai-chat-snapshot', input || {}),
  codesysAiChatPrompt: (input) => ipcRenderer.invoke('codesys:ai-chat-prompt', input || {}),
  // T175：T174 的三个入口之外只多了这**一个**通道 —— 抽屉里的模型选择。两个动作共用它：
  // `{ action: 'list' }` 读模型目录 + 当前模型，`{ action: 'select', id }` 改**这条会话**用的模型
  // （`id` 形如 `provider/model`）。它读的是整份模型目录、写的是主页那条会话下一次请求的模型，
  // 所以和上面三个一样登记在 main.js 的 CODESYS_PANEL_ONLY_CHANNELS 里，只允许外壳面板调用。
  // T186：`select` 多带一个**可选**的 `effort`（推理等级）。**没有新通道**：本函数是 `input` 原样
  // 透传（`ipcRenderer.invoke(channel, input)`），所以 `{ action:'select', id, effort }` 不经改动
  // 就到达 main.js；等级与模型都是**会话级**写入，落在同一条 `codesys:ai-chat-model` 上。
  codesysAiChatModel: (input) => ipcRenderer.invoke('codesys:ai-chat-model', input || {}),
  // T185：抽屉里回答**主页那条会话的「待回答」提问**。用户报的现像是"原会话有一个待回答，但抽屉
  // 不显示，于是一直卡住" —— 这条通道就是"就地回答"那一步。入参 `{ key, answers }`：
  // `key` 是快照原样带回的 `pendingInteraction.key`（防答错一条），`answers` 是每个问题一条
  // `{ id, selected: [label…], custom? }`。**只有「提交回答」按钮的点击会调它**：没有任何轮询 /
  // 定时器 / 自动路径会走到这里，审批类请求也**不会**被它代答（数据桥直接把 approval 判成不可作答）。
  codesysAiChatAnswer: (input) => ipcRenderer.invoke('codesys:ai-chat-answer', input || {}),
  // A 段：抽屉消息流里那枚「确认写入工程」。入参 `{ sessionId, proposalSignature, overwriteConfirmed }`，
  // 全部由抽屉按快照里的数据原样带上（签名用来挡住"提案在两次点击之间被换掉"）。
  // ⚠️ **只有**那枚按钮（以及 sha 防护挡下之后那枚「我已确认，继续写入」）的显式点击会调它：
  // 本文件里没有第二处调用点，渲染层也没有任何轮询/自动路径会走到它。
  codesysAiChatApply: (input) => ipcRenderer.invoke('codesys:ai-chat-apply', input || {}),
  // T192：抽屉消息流里那枚「让 CODESYS 重新加载」。它不给参数 —— 目标是主进程自己认定的那个
  // CODESYS 窗口（托管中的句柄，否则面板选定的监视窗口），不让渲染层指定句柄。
  // ⚠️ 只有那枚按钮的显式点击会调它：没有轮询、没有定时器、写入成功也**不会**自动调。
  codesysNativeHostReloadProject: () => ipcRenderer.invoke('codesys:native-host-reload-project'),
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
