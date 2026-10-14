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
// 用户的删除要求（2026-10）：「AI 实时监视」整体移除，因此这里不再保留任何画面流状态
// （capture / streamWindowId / codesysMediaStream / codesysVideoFrameRequest /
// codesysMetricsTimer / codesysStreamGeneration / codesysStreamStartToken /
// codesysStreamMetrics / codesysBlankSamples / codesysFallbackStarting /
// codesysPreviewResizeObserver / codesysWindowFitTimer / codesysWindowFitSequence /
// unsubscribeFrame / codesysAiInputEnabled）。
// 保留 `codesysNativeResizeObserver` / `codesysNativeMoveTimer` —— 它们服务的是**原生
// 窗口托管**（让真实 HWND 的几何跟随插件区域），不是监视。
const state = { windows: [], selectedWindow: null, codesysFollowGeneration: 0, codesysSurfaceGeneration: 0, unsubscribeWebAiState: null, workspaceGeometry: null, codesysInputQueue: Promise.resolve(), codesysWheelDelta: 0, codesysWheelPoint: null, codesysWheelTimer: null, codesysNativeAttached: false, codesysNativeWindowId: '', codesysNativeResizeObserver: null, codesysNativeMoveTimer: null, codesysSurfaceInitialized: false,
  // T174：AI 对话栏是**插件面板自己的**右侧抽屉（不再挂 DSH 原生右栏），这几个字段就是它的
  // 全部状态：是否打开、轮询定时器、是否正在发送、上次画过的内容签名、数据桥是否连上。
  // T175 追加三组：① 抽屉宽度（`null` = 没拖过，交给 CSS 的默认宽度）；② 模型目录缓存与
  // "正在切模型"；③ 拖动状态（起点 x / 起点宽度）。`codesysAiChatResizeListener` 是 window 上
  // 那个"面板变窄后重新夹紧宽度"的监听器，只注册一次，随 surface 拆除一起摘掉。
  codesysAiChatOpen: false, codesysAiChatTimer: null, codesysAiChatSending: false, codesysAiChatSignature: '', codesysAiChatBridgeOk: null,
  codesysAiChatWidth: null, codesysAiChatResizing: false, codesysAiChatResizeStart: null, codesysAiChatResizeListener: null,
  codesysAiChatModels: null, codesysAiChatModelsAt: 0, codesysAiChatModelBusy: false, codesysAiChatModelPending: false, codesysAiChatModel: null,
  // T179：模型座位改成一枚按钮 + 一层浮层菜单。`codesysAiChatModelMenuOpen` = 浮层是否画着，
  // `codesysAiChatModelMenuActive` = 键盘高亮的那一条（`provider/model` 复合键），
  // `codesysAiChatModelMenuOutside` = document 上那个"点外面就关"的监听器（只注册一次，
  // 随 surface 拆除摘掉，否则每次重画面板都会叠一层）。
  // T182：这里**不再有** `codesysAiChatModelFlashTimer`。用户原话「模型切换也不要有提示说切换好了」——
  // 成功路径一个字都不写（座位上的短名就是确认），"4 秒后自毁的确认行"连同它的定时器一起删除，
  // 不留死字段、不留死计时器。说明行只剩失败 / 麻烦时的那一行（见 `codesysAiChatSetModelNote`）。
  codesysAiChatModelMenuOpen: false, codesysAiChatModelMenuActive: '', codesysAiChatModelMenuOutside: null,
  // T186：**推理等级座位**（用户原话「思考强度也要能选」）。它是与模型座位**同款**的第二枚胶囊 +
  // 第二层浮层（同一套键盘 / 外部点击 / 高亮语义，见下面的座位内核 `CODESYS_AI_SEAT_LIST`），
  // 所以这里只需要它自己的"浮层开着没有 / 高亮哪一条"两个字段 —— 切换在途的状态与模型**共用**
  // `codesysAiChatModelBusy`（两者都是同一条会话级写入，同一时刻只允许一个在途，避免两个座位
  // 各发一次 `selectModel` 互相盖掉）。`hidden` 由 `codesysAiChatRenderEffortOptions()` 按
  // "这个模型到底支不支持推理等级"决定 —— 不支持就**不显示**这个控件。
  codesysAiChatEffortMenuOpen: false, codesysAiChatEffortMenuActive: '',
  // T231：**"上次选的模型 / 思考强度"跨重启记住**（用户报障原话：「还有一个事情，模型切换关闭程序
  // 打开之后为什么不会保存？」）。四个字段各管一件事，一个定时器都不新增：
  //   * `codesysAiChatSessionId` / `codesysAiChatSessionSelection` —— 快照里那条会话的**事实**：
  //     `selection === null` = 这条会话**还没有显式选过**模型（投影里 `next` 为空，它现在跑的是目录里
  //     的全局默认值）。恢复只认这两个字段 —— 会话现值优先，绝不覆盖用户当下的选择；
  //   * `codesysAiChatModelRestoredFor` —— 已经为**哪条会话**做过一次恢复决策（一条会话只决策一次，
  //     所以这既不是连续监视，也不会每 1.5 秒重发一次）；`codesysAiChatModelRestoreBusy` = 那一次
  //     恢复在途；
  //   * `codesysAiChatModelPickedSession` —— 用户在这条会话里**显式**换过（抽屉座位 / 主界面 composer），
  //     恢复必须让位（`'*'` = 换的时候还不知道会话 id，按最保守处理）。
  codesysAiChatSessionId: '', codesysAiChatSessionSelection: null,
  codesysAiChatModelRestoredFor: '', codesysAiChatModelRestoreBusy: false, codesysAiChatModelPickedSession: '',
  // T180：状态提示不再是抽屉里的一行常驻节点，而是**消息流尾**的一次性行 —— 这两个字段就是它的
  // 全部状态（空串 = 这一行不存在）。`codesysAiChatSetStatus()` 写它们，`codesysAiChatApplySnapshot()`
  // 重画消息流时读它们，两条路径共用一套说法。
  codesysAiChatNotice: '', codesysAiChatNoticeTitle: '',
  // T176：消息里的"复制"按钮不能把整条消息塞进 `data-` 属性（转义面 + 体积都不可控），所以按本次
  // 渲染的下标存放在这两个数组里；代码块单独一份，这样"复制这段代码"与"复制这条消息"互不干扰。
  codesysAiChatCopyTexts: [], codesysAiChatCodeTexts: [],
  // T183：**进行中**的表现（用户原话：「现在有输出，但是没有显示在思考」）。三个字段：
  //   * `codesysAiChatRunning` —— 数据桥回报的"会话正在运行"（决定轮询节奏：运行态 600ms）；
  //   * `codesysAiChatReasoningOpen` —— 那一行"思考"是否被用户展开过（跨重画保留；
  //     生成结束就归零，所以下一次生成仍然从折叠态开始）；
  //   * `codesysAiChatPullPending` —— "同一时刻只允许一个在途请求"的那道闸。
  codesysAiChatRunning: false, codesysAiChatReasoningOpen: false, codesysAiChatPullPending: false,
  // T185：**待回答**（用户报「原会话有一个待回答，但抽屉不显示，于是一直卡住」）。四个字段：
  //   * `codesysAiChatPending` —— 数据桥回报的那份**纯数据**待回答（`null` = 没有）。它只由
  //     `codesysAiChatApplySnapshot()` 从快照写，界面照它画；
  //   * `codesysAiChatAnswers` —— 用户在这个抽屉里**正在填**的草稿，按问题 id 存
  //     `{ selected: [label…], custom: '' }`。跨重画保留（消息区每几百毫秒可能整体重画），
  //     所以"填到一半被重画擦掉"不会发生。它**只是草稿** —— 不点「提交回答」就不会变成答案；
  //   * `codesysAiChatAnswerBusy` —— 那一次 IPC 在途（按钮转"提交中…"并禁用，防连点）；
  //   * `codesysAiChatAnswerBlocked` —— 上一次提交失败的原因（可读一句话），画在那一段里。
  // 这四个字段都**不会**在任何没有用户点击的路径上产生一次 `codesysAiChatAnswer` 调用。
  codesysAiChatPending: null, codesysAiChatAnswers: {}, codesysAiChatAnswerBusy: false, codesysAiChatAnswerBlocked: '',
  // T185：上一次**成功应用**的那份快照。勾选项 / 敲字之后要靠它重画那一段（`codesysAiChatRepaint()`），
  // 所以不另造渲染路径，也不把消息列表复制第二份。
  codesysAiChatLastResult: null,
  // A 段（用户口径：「AI 对话就是唯一操作面，工作台只做能力提供」）：**工作台能力面**在抽屉里的那一组
  // 状态。数据全部来自快照里的 `capabilities`（工作台自己发布的只读投影），界面只负责画：
  //   * `codesysAiChatCapabilities` —— 最新一份能力面（`null` = 这条会话没有可读的工作台）；
  //   * `codesysAiChatWriteBusy` —— 那一次写入 IPC 在途（按钮转"写入中…"并禁用，防连点）；
  //   * `codesysAiChatWriteBlocked` —— 上一次写入失败 / 被 sha 防护挡下的**可读一句话**（画在同一段里）；
  //   * `codesysAiChatWriteSignature` —— 上面那句失败属于哪一份提案（提案一换就作废，免得留在屏幕上骗人）；
  //   * `codesysAiChatWriteOverride` —— 上一次被挡住的是"需要显式覆盖确认"（T170 三态里的后两态），
  //     于是多出**第二枚**必须用户点的按钮「我已确认，继续写入」（不点永远不会带 overwriteConfirmed）。
  // ⚠️ 这五个字段**不会**在任何没有用户点击的路径上产生一次 `codesysAiChatApply` 调用。
  //
  // T192：**写入成功之后**那一段「让 CODESYS 重新加载」的唯一状态。`null` = 还没有成功写入过。
  //   * `state` —— `'idle'`（刚写完，按钮还没点）/ `'busy'`（那一次 IPC 在途）/ `'ok'`（命令已发出）
  //     / `'failed'`（没有可用入口或调用失败，原因在 `detail`）；
  //   * `detail` —— 一行可读的**事实**（成功是"已把命令发给 CODESYS"，失败是"没有哪一项、请按什么步骤"）；
  //   * `written` —— 这次写入的对象数（画在标题条上，不另写一句话）。
  // ⚠️ 它同样**不会**在任何没有用户点击的路径上产生一次 `codesysNativeHostReloadProject` 调用：
  // 写入成功只是把这段画出来，动作永远要那枚按钮被点一次。
  codesysAiChatCapabilities: null, codesysAiChatWriteBusy: false, codesysAiChatWriteBlocked: '', codesysAiChatWriteSignature: '', codesysAiChatWriteOverride: false,
  // 本轮：**放弃**（用户原话「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」）的状态。
  // 它不新增 IPC 通道：一条 postMessage 交给 DSH 侧的数据桥（见 `codesysAiChatDiscardProposal`），
  // 由工作台用既有的清状态函数把提案 + 手写草稿一起作废并按磁盘最新内容退回编辑器。
  //   * `codesysAiChatDiscardBusy` —— 那一次放弃在途（按钮转"放弃中…"并禁用，防连点）；
  //   * `codesysAiChatDiscardSignature` / `codesysAiChatDiscardCount` —— 这次要放弃的那份提案签名，
  //     以及它上面记着的手写改动处数（快照原样带回的 `capabilities.draftCount`）—— 回信丢了也能把
  //     那一行写准（**绝不静默丢掉用户的字**）；
  //   * `codesysAiChatDiscardAt` / `codesysAiChatDiscardNonce` —— 起始时刻与本次标识：回信按 nonce
  //     对上号；没有回信时由 1.5 秒的快照当那个时钟（**不新增定时器**）。
  // ⚠️ 这五个字段**不会**在任何路径上产生一次 `codesysAiChatApply` 调用（放弃不写工程）。
  codesysAiChatDiscardBusy: false, codesysAiChatDiscardSignature: '', codesysAiChatDiscardCount: 0, codesysAiChatDiscardAt: 0, codesysAiChatDiscardNonce: '',
  codesysAiChatReload: null };
let harnessFrame = null;
let pluginOverlay = null;
let pluginContent = null;
const sidebarState = { plugins: [], active: 'chat' };
const pluginLabels = {
  // 插件名与它注册的 surface id 都要给：侧栏按钮按插件 id 取名，顶栏标题按
  // surface id 取名（surfaceLabel(kind)），只改一处会出现"侧栏叫 A、顶栏叫 codesys"。
  'codesys-monitor': 'CODESYS',
  codesys: 'CODESYS',
  'web-ai': '浏览器',
  'knowledge-base': '知识库',
  knowledge: '知识库',
  charts: '图表',
  'plugin-manager': '插件管理',
  packages: '插件管理',
};
const pluginGlyphs = { 'codesys-monitor': '▦', 'web-ai': '◉', 'knowledge-base': '▤', 'plugin-manager': '◇' };
// 侧栏图标：CODESYS 工作台用"窗口 + 代码"的形状（原来只是一个显示器方块，和
// 浏览器/知识库的图标区分度太低）。
const CODESYS_WORKBENCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M2.5 8.5h19"/><path d="M9.6 12.3 7.5 14.2l2.1 1.9M14.4 12.3l2.1 1.9-2.1 1.9"/><path d="M8 21h8M12 17v4"/></svg>';
const sidebarIconMarkup = {
  'codesys-monitor': CODESYS_WORKBENCH_ICON,
  'web-ai': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5"/><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.4 3.1 5.2 3.1 8.5S14.1 18.1 12 20.5C9.9 18.1 8.9 15.3 8.9 12S9.9 5.9 12 3.5z"/></svg>',
  'knowledge-base': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 0z"/><path d="M5 4.5v15M8 19.5h11M9 9h6M9 12h6"/></svg>',
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
  // DSH's native sidebar.panellist is the only plugin navigation. The host
  // shell used to render the same plugin descriptors a second time here,
  // producing duplicate CODESYS/browser/knowledge buttons and two competing
  // routes to the same surface. Keep this hook for lifecycle callers, but do
  // not create a parallel sidebar in the host shell.
  sidebarState.plugins = [];
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

// T181（用户原话：「依然会出现两个按钮，不需要看到」）：T180 留在会话输出区的那两枚快捷项
// **整体删除** —— 模板表里的 `label`、markup 生成函数、消息流里的两个落点、事件委托里那一段，
// 以及 `ui-overrides.css` 里对应的三条 CSS 规则全部拿掉。用户要的是界面上**一个入口都没有**，
// 所以这次不留任何替代入口：不换成别的常驻行，也不新增任何文字提示。
//
// 保留下来的只有**能力**本身：`codesysAiChatInsertTemplate` 仍然能把一段预设文本填进输入框。
// 它是**内部函数**，没有任何界面节点会调它（输入框上方没有、`#codesys-ai-thread` 里也没有）。
// 那两枚按钮的**文字标签**一并删除 —— 它们只是纯展示字段，删掉之后本文件里再没有那两个标签，
// 自测可以用一条裸 grep 证明它们 0 次出现。
const codesysAiChatTemplates = [
  { id: 'propose', text: '请针对下面这个需求给出改动建议（用工作台提案格式，先不要写入）：\n' },
  { id: 'offline', text: '在隔离的 ScriptEngine 作业里完成下面这件事，把结果回传工作区，**不要改我当前的工程**：\n' },
];

function codesysAiChatDrawerMarkup() {
  // T175：把手放**左边缘**（`role="separator"` 是 WAI-ARIA 对"可拖动的分隔条"的写法）。抽屉在
  // 右侧，所以向左拖 = 变宽；键盘 ←/→ 同方向微调，Shift 加大步长，双击恢复默认宽度。
  //
  // T176（用户原话：「而且现在会话整体ui太粗糙了没有质感，应该和主界面会话一样」「框底下切换吗？」）：
  // 结构按 DSH 主界面会话重排 —— 消息区在上、**输入卡片在下**，模型选择器与发送按钮同处输入卡片的
  // 底行（与 `@deepseek-ai/dsh-client-ui-conversation` 的 `skeleton/InputBar` 里
  // `.uV2eYG_card` → `.uV2eYG_row`（tools/…/trailing）同一个位置关系），不再挂在抽屉顶部。
  // 那一大段说明文字也从界面上撤掉；T180 撤掉了常驻模板行，T181 又撤掉了最后那两枚流内快捷项，
  // 所以现在键盘/指针下**一个模板入口都没有**，空会话时消息区自己会说明「发一条消息开始」。
  //
  // T179（用户原话：「输入框里面显示一个 ai，选择栏还有一个 ai 显示重复，而且选择 ai 的界面太丑了」）：
  // ① **重复**：模型短名原来同时写在两处 —— `#codesys-ai-model-note`（说明行，`renderer.js` 的
  //    `codesysAiChatRefreshModels()` 写 `codesysAiChatModelOptionLabel(current)`）与
  //    `#codesys-ai-model`（原生 `<select>` 的闭合显示项，同一个短名）。两行紧挨着、字面完全相同，
  //    模型目录读取失败时更糟：同一句失败原因在说明行与下拉里各写一遍。现在说明行**只在有问题时**
  //    才写字（默认空 → CSS `:empty` 不占位），模型短名只剩座位上那一处。
  // ② **太丑**：原生 `<select>`（+ `<optgroup>`）的外观与主界面完全不搭。这里把模型座位换成
  //    主界面 DSH 的写法：一枚 28px 高的按钮（短名 + chevron）+ 一层浮层菜单（provider 分组、
  //    当前项勾选、`blocked` 禁用并写明原因），结构与样式逐条抄
  //    `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect`（见 `ui-overrides.css` 的 T179 段）。
  // T180：模板行与状态行这两个常驻节点**整体删除**；T181 再把流内那两枚快捷项也删掉（见文件开头
  // T181 段）。用户原话："这些放到会话输出区去提示，不要一直显示在上面"、"已连接数据桥直接显示在
  // 会话输出区就好了"、"依然会出现两个按钮，不需要看到"。所以输入框（`.codesys-ai-compose`）**之前**
  // 只剩三样东西：拖拽把手（`position:absolute`，不占行）、标题行、消息流本身。
  // 状态提示仍然只走流尾的一次性行（`codesysAiChatSetStatus()` / `.codesys-ai-notice`，为空时
  // **整行不存在**）—— 它不是按钮，也没有新增任何入口。
  return `<aside id="codesys-ai-drawer" class="codesys-ai-drawer" hidden aria-label="CODESYS AI 对话（与主页同一条会话）">
<div id="codesys-ai-resizer" class="codesys-ai-resizer" role="separator" aria-orientation="vertical" aria-controls="codesys-ai-drawer" aria-label="拖动调节 AI 对话栏宽度" aria-valuemin="280" aria-valuemax="380" aria-valuenow="360" tabindex="0" title="拖动调节宽度 · ←/→ 微调 · 双击恢复默认宽度"></div>
<div class="codesys-ai-head"><strong>CODESYS AI 对话</strong><button id="codesys-ai-close" class="codesys-ai-close" type="button" title="收起 AI 对话栏" aria-label="收起 AI 对话栏">×</button></div>
<div id="codesys-ai-thread" class="codesys-ai-thread" role="log" aria-live="polite"><div class="codesys-ai-empty">正在读取会话…</div></div>
<div class="codesys-ai-compose">
<textarea id="codesys-ai-draft" class="codesys-ai-draft" rows="3" placeholder="例如：把 POU1 里的 bStart 改成按钮触发，先出提案不要写入" aria-label="发往主页当前会话的消息"></textarea>
<div id="codesys-ai-model-note" class="codesys-ai-model-note" role="status"></div>
<div class="codesys-ai-inputrow"><button id="codesys-ai-model" class="codesys-ai-model-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="codesys-ai-model-menu" aria-label="这条会话使用的模型" title="这条会话使用的模型（会话级，立即生效）"><span id="codesys-ai-model-name" class="codesys-ai-model-trigger-label">正在读取模型目录…</span><svg class="codesys-ai-model-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true" stroke-width="1"><path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor"/></svg></button><div id="codesys-ai-effort-seat" class="codesys-ai-effort-seat" hidden><button id="codesys-ai-effort" class="codesys-ai-model-trigger codesys-ai-effort-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="codesys-ai-effort-menu" aria-label="这条会话的推理等级" title="这条会话的推理等级（会话级，立即生效）"><span id="codesys-ai-effort-name" class="codesys-ai-model-trigger-label"></span><svg class="codesys-ai-model-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true" stroke-width="1"><path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor"/></svg></button><div id="codesys-ai-effort-menu" class="codesys-ai-model-menu codesys-ai-effort-menu" role="menu" aria-label="这条会话的推理等级" hidden></div></div><button id="codesys-ai-send" class="codesys-ai-send" type="button" title="发送到主页同一条会话（Ctrl+Enter）">发送</button><div id="codesys-ai-model-menu" class="codesys-ai-model-menu" role="menu" aria-label="这条会话使用的模型" hidden></div></div>
</div>
</aside>`;
}

// T199：「代码任务」按钮**只**把当前选中的窗口交给宿主，本身不启动任何外部程序
// （宿主 `codesys:workbench-open` 只做 `postMessage` 打开面板内的工作台页签）。
//
// 现场（2026-10-08 用户报「点代码任务报错」）：`#window-list` 为了让人能托管
// "你自己启动的 CODESYS"，会把非本插件启动的窗口也列出来（选项末尾标「外部启动」，
// 见 refreshWindows()）；而宿主只接受**本插件启动**的窗口，于是"选中一个外部窗口
// 再点代码任务"必然被拒：`CODESYS_WORKBENCH_WINDOW_NOT_OWNED`
// → 报错原文「工作台只能绑定由当前插件打开的 CODESYS 窗口」。
// 这里把那次拒绝收成**面板内的一行可读原因 + 下一步**，不再让它落成 renderer 控制台
// 里的 `Uncaught (in promise)`（用户看到的"报错"）。
//
// T208（用户裁决「乙」："外部窗口也可以成为监视和读取的窗口，前提是由 codesys 插件选择外部
// 窗口，不能是未经过选择就直接获取"）：宿主的判据已经是"本插件启动的 PID **或**你在窗口列表里
// 显式点选过的那个窗口"，所以这一条通路**不需要、也不许**改变它交上去的东西 —— 它照旧只交
// `{ windowId, pid, title }`，放行与否由宿主按**它自己记着的那条显式选择**判定（渲染层声明
// 不出授权来）。拒绝因此只发生在"这个外部窗口不是你当前点选的监视窗口"这一种情况下，下一步
// 就是去列表里点选它。
async function openCodesysWorkbenchFromPanel() {
  const status = $('#input-status');
  const selected = state.selectedWindow;
  try {
    await window.taskhive.openCodesysWorkbench({
      windowId: selected?.id || '',
      pid: selected?.pid || 0,
      title: selected?.title || '',
    });
  } catch (error) {
    // Electron 把 IPC 拒绝包成 "Error invoking remote method '…': Error: <原因>"，
    // 面板上只留宿主那一句原始原因。
    const reason = String((error && error.message) || error || '原因未知')
      .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
    const nextStep = selected && selected.owned === false
      ? '；下拉里当前选的是你自己启动的窗口（选项末尾「外部启动」），但它还不是你在窗口列表里点选过的那个监视窗口：请先在窗口列表里点选它（点选后它就是当前监视/读取窗口），或点「打开 CODESYS」用本插件启动的窗口'
      : '；请先点「打开 CODESYS」（或刷新窗口列表后重选）再点「代码任务」';
    const line = `代码任务工作台没能打开：${reason}${nextStep}`;
    if (status) { status.textContent = line; status.title = line; }
    log(line);
  }
}

async function renderCodesys() {
  await teardownCodesysSurface();
  state.codesysSurfaceGeneration += 1;
  title.textContent = 'CODESYS'; badge.textContent = '原生窗口与离线检查';
  await showPluginSurface(`<section class="codesys-surface"><div class="codesys-head-row"><div class="codesys-toolbar" role="toolbar" aria-label="CODESYS 操作"><button class="codesys-toolbar-button" id="open-codesys-program" type="button" title="打开独立的 CODESYS 程序；切换插件或会话不会关闭；退出 TaskHive 时会自动关闭本插件启动的实例（工程有未保存改动时保留）">打开 CODESYS</button><select id="window-list" aria-label="CODESYS 窗口" title="选择要托管的 CODESYS 窗口（枚举本插件启动的窗口，以及你自己启动的窗口；外部启动的带「外部启动」标记，**只有你在这里点选后**才会成为监视/托管目标）"><option value="">正在枚举 CODESYS 窗口…</option></select><span class="codesys-toolbar-group">${codesysToolbarButton('refresh-windows', '重新枚举窗口列表：只列出窗口（外部启动的带「外部启动」标记），不托管、不改你的视图；要托管请在列表里点选它', 'refresh')}</span><span class="codesys-toolbar-group">${codesysToolbarButton('codesys-ai-toggle', '打开面板内的 AI 对话栏（与主页同一条会话，CODESYS 工作台接口默认可用）', 'ai', { pressed: false, text: 'AI 对话' })}</span><span class="codesys-toolbar-group">${codesysToolbarButton('codesys-workbench', '打开 CODESYS 专用工作台', 'script', { text: '代码任务' })}</span></div><div class="codesys-status-strip"><span id="input-status"></span><span class="codesys-scriptengine-cell"><span id="scriptengine-status">正在检查 ScriptEngine…</span><button class="codesys-status-action" id="scriptengine-configure" type="button" hidden>安装/配置</button><button class="codesys-status-action" id="scriptengine-recheck" type="button">重新检测</button></span></div></div><div class="codesys-output-tray"><div id="scriptengine-result"></div></div><div class="codesys-body"><div class="codesys-stage"><div id="stream-result" class="stream-panel codesys-stream"><div class="empty">先打开或选择 CODESYS；真实原生窗口会托管在这里</div></div></div>${codesysAiChatDrawerMarkup()}</div></section>`);
  $('#open-codesys-program').onclick = async () => {
    const status = $('#input-status');
    // Opening CODESYS is an explicit request to work with the new instance.
    // Once its HWND appears, host that exact window immediately instead of
    // leaving the plugin panel empty until the user finds it in the picker.
    //
    // 用户的删除要求（2026-10）：原来这里还会顺带启动「AI 实时监视」画面流
    // （`startStream()` 与 `waitForLaunchedCodesysWindow` 的 `restartStream` 参数）。
    // 监视能力已整体删除，所以这一步只剩"把真实窗口托管进插件区域"。
    try {
      status.textContent = '正在使用已验证的 CODESYS 配置启动…';
      const result = await window.taskhive.openCodesysProgram();
      status.textContent = `CODESYS 进程已启动 · PID ${Number(result.pid || 0)} · 正在等待对应窗口…`;
      const selected = await waitForLaunchedCodesysWindow(result.pid);
      if (!$('#input-status')) return;
      if (selected) {
        await attachSelectedCodesysNativeHost();
      }
      status.textContent = selected
        ? `真实 CODESYS 已进入插件 · PID ${Number(selected.pid || 0)} · 鼠标键盘直接操作 · 任务栏隐藏 · 只有你手动关闭才会结束`
        : `外部 CODESYS 已启动 · ${result.profile} · 尚未发现新窗口，请稍后刷新窗口列表`;
      if (selected?.windowPhase === 'launch') void followLaunchedCodesysMainWindow(result.pid, selected.id);
    } catch (error) { if (status) status.textContent = `打开 CODESYS 失败：${error.message}`; }
  }; $('#refresh-windows').onclick = async () => { await refreshWindows(); }; $('#codesys-ai-toggle').onclick = openCodesysAiChat; $('#codesys-workbench').onclick = openCodesysWorkbenchFromPanel; $('#scriptengine-recheck').onclick = refreshScriptEngineStatus; $('#scriptengine-configure').onclick = configureScriptEngine;
  // T174：AI 对话栏的控件全部绑在**面板自己**的 DOM 上（不再有"往 DSH 右栏找容器"这一步）。
  bindCodesysAiChatUi();
  state.codesysSurfaceInitialized = true;
  await refreshScriptEngineStatus();
  // T207：打开 / 切到 CODESYS 面**只枚举窗口**（外部启动的窗口在列表里带「外部启动」标记）。
  //
  // 这里以前还有一句无条件的 `await attachSelectedCodesysNativeHost()` —— 用户实测
  // 「我外部有 CODESYS 窗口，一打开插件直接强制捕获过来了」就是这一步：`refreshWindows()`
  // 在没有本插件窗口时会自动挑中列表里的外部窗口，紧接着就被托管进面板（真机
  // `desktop.log:3019` surface:open:codesys → 1.4 s 后 `codesys:native-host-attach
  // {windowId:"0x200EEA"}`，pid 31548 并不是本插件启动的）。
  //
  // 托管现在**只有**两条路：① 用户在窗口列表里显式点选（`list.onchange`，外部窗口允许）；
  // ② 本插件自己启动的进程（「打开 CODESYS」→ `waitForLaunchedCodesysWindow` /
  // `followLaunchedCodesysMainWindow`，只按登记的 PID 跟随）。刷新列表本身也不再托管。
  await refreshWindows();
}


async function teardownCodesysSurface() {
  // Leaving the surface must not destroy the user-owned CODESYS HWND. The
  // native host suspends it; when we return it is resumed at the same bounds.
  // Bumping the surface generation stops any in-flight follow loop, which
  // otherwise kept polling (and spawning a PowerShell per second) for 15 min
  // after the surface it belonged to had been re-rendered.
  state.codesysSurfaceGeneration += 1;
  state.codesysFollowGeneration += 1;
  // T174：离开 CODESYS surface 时必须停掉 AI 对话栏的轮询（它按 1.5s 调一次 IPC），
  // 否则切走之后还会一直对着一个不存在的面板拉快照。
  codesysAiChatStopPolling();
  // T175：拖动中途切走 surface 时，window 上的 pointermove/pointerup 监听器不能留在那儿
  // （它们指向已经不在的抽屉）。`codesysAiChatResizeEnd()` 就是那条清理路径。
  codesysAiChatResizeEnd();
  if (state.codesysAiChatResizeListener) {
    window.removeEventListener('resize', state.codesysAiChatResizeListener);
    state.codesysAiChatResizeListener = null;
  }
  state.codesysAiChatOpen = false;
  state.codesysAiChatBridgeOk = null;
  state.codesysAiChatSignature = '';
  // A 段：能力面在切走 surface 时归零（下一次打开会从新快照重新读）。
  state.codesysAiChatCapabilities = null;
  state.codesysAiChatWriteBusy = false;
  state.codesysAiChatWriteBlocked = '';
  state.codesysAiChatWriteSignature = '';
  state.codesysAiChatWriteOverride = false;
  state.codesysAiChatModels = null;
  state.codesysAiChatModelsAt = 0;
  state.codesysAiChatModel = null;
  state.codesysAiChatModelBusy = false;
  // T179：抽屉要离开 DOM 了，挂在 document 上的"点外面关闭"与浮层状态必须一起收走 —— 否则切走
  // surface 之后每点一下页面都会去关一个已经不存在的菜单（而且监听器会随每次重画叠加）。
  state.codesysAiChatModelMenuOpen = false;
  state.codesysAiChatModelMenuActive = '';
  // T186：推理等级座位的浮层状态一并归零（它随面板重画重新 `hidden`，见抽屉 markup）。
  state.codesysAiChatEffortMenuOpen = false;
  state.codesysAiChatEffortMenuActive = '';
  if (state.codesysAiChatModelMenuOutside) {
    document.removeEventListener('click', state.codesysAiChatModelMenuOutside, true);
    state.codesysAiChatModelMenuOutside = null;
  }
  state.codesysAiChatCopyTexts = [];
  state.codesysAiChatCodeTexts = [];
  if (state.codesysWheelTimer) clearTimeout(state.codesysWheelTimer);
  if (state.codesysNativeMoveTimer) clearTimeout(state.codesysNativeMoveTimer);
  state.codesysWheelTimer = null;
  state.codesysNativeMoveTimer = null;
  state.codesysWheelDelta = 0;
  state.codesysWheelPoint = null;
  // `codesysNativeResizeObserver` is the NATIVE HOST's geometry follower, not a
  // monitoring helper: the real HWND has to keep tracking the plugin panel, so it
  // is only disconnected here and re-installed by attachSelectedCodesysNativeHost().
  //
  // 用户的删除要求（2026-10）：这里原先还会拆掉监视侧的东西
  // （`codesysPreviewResizeObserver` / `codesysWindowFitTimer` / `unsubscribeFrame` /
  // `stopCodesysMediaStream` / `codesys:stream-stop`）。监视能力整体删除后不再需要。
  state.codesysNativeResizeObserver?.disconnect();
  state.codesysNativeResizeObserver = null;
}

function codesysNativeBounds(selected = state.selectedWindow) {
  const panel = $('#stream-result');
  if (!panel) return null;
  const rect = panel.getBoundingClientRect();
  // T174：窄面板下 AI 对话栏是**覆盖式抽屉**，而真实 CODESYS HWND 是独立顶层窗口 ——
  // 它会盖在插件画布之上。抽屉打开时把 HWND 的可用宽度收到抽屉左侧，否则"对话栏明明开着
  // 却被 CODESYS 窗口盖住"，又是一次"点了没反应"。宽面板是并排布局（抽屉不压舞台），不收缩。
  const overlay = codesysAiChatOverlayRect();
  let width = Math.max(320, Math.round(overlay ? rect.width - overlay.width : rect.width));
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

// 抽屉打开且处于"覆盖式"布局时，把它实际占掉的宽度交出去（null = 不遮挡舞台）。
// 判据用 CSS 的同一条件（max-width: 900px），这样布局与几何计算不会各说一套。
function codesysAiChatOverlayRect() {
  const drawer = $('#codesys-ai-drawer');
  if (!drawer || drawer.hidden || !state.codesysAiChatOpen) return null;
  let narrow = false;
  try { narrow = window.matchMedia('(max-width: 900px)').matches; }
  catch { narrow = document.documentElement.clientWidth <= 900; }
  if (!narrow) return null;
  const rect = drawer.getBoundingClientRect();
  return rect.width > 0 ? { width: rect.width } : null;
}

// 抽屉开/关会改变 HWND 的可用宽度，但 #stream-result 自己的矩形没变 —— ResizeObserver 不会响，
// 所以这里显式把原生窗口挪到新的可用区域。没托管时什么都不做。
async function codesysAiChatSyncNativeBounds() {
  if (!state.codesysNativeAttached) return;
  const bounds = codesysNativeBounds();
  if (bounds) await window.taskhive.moveCodesysNativeHost(bounds).catch(() => null);
}

function syncCodesysNativeButton() { const button = $('#codesys-native-toggle'); if (!button) return; button.classList.toggle('active', state.codesysNativeAttached); button.setAttribute('aria-pressed', String(state.codesysNativeAttached)); button.title = state.codesysNativeAttached ? '停止托管并恢复 CODESYS 原始窗口样式和位置' : '在中央区域托管真实 CODESYS 窗口；鼠标、键盘和滚轮走原生通道'; }

function installCodesysNativeGeometryObserver() { state.codesysNativeResizeObserver?.disconnect(); const panel = $('#stream-result'); if (!panel) return; state.codesysNativeResizeObserver = new ResizeObserver(() => { if (!state.codesysNativeAttached) return; if (state.codesysNativeMoveTimer) clearTimeout(state.codesysNativeMoveTimer); state.codesysNativeMoveTimer = setTimeout(() => { const bounds = codesysNativeBounds(); if (bounds) void window.taskhive.moveCodesysNativeHost(bounds).catch(() => null); }, 120); }); state.codesysNativeResizeObserver.observe(panel); }

async function attachSelectedCodesysNativeHost(options = {}) {
  const selected = state.selectedWindow;
  const status = $('#input-status');
  const panel = $('#stream-result');
  if (!selected || selected.usable === false || !panel) return false;
  if (selected.fixture === true && options.allowFixture !== true) return false;
  // T207：**外部启动的窗口只有用户显式点选过才允许托管**。自动路径（打开/切到 CODESYS 面、
  // 刷新列表、跟随本插件启动的进程）一律不带 `explicitSelection`，所以外部窗口在这里就被挡住 ——
  // 这正是用户实测「外面已有 CODESYS 窗口，一打开插件就被强行抓过来」的那一步。宿主侧
  // （`codesys:native-host-attach`）还有同一口径的第二道门，两处独立。
  if (selected.owned === false && options.explicitSelection !== true) return false;
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
    const result = await window.taskhive.attachCodesysNativeHost({ windowId: selected.id, bounds, explicitSelection: options.explicitSelection === true });
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






// ── T174：面板自己的 AI 对话右侧抽屉 ────────────────────────────────────────────────
//
// 用户的架构要求（原话）：「ai 对话不调用原生的右侧栏，而是直接在 codesys 插件里面做一个
// 右侧栏，这样每次更新右侧栏就不需要重新适配」。
//
// 所以对话界面**完全**长在 CODESYS 面板里：
//   * 宽面板 → 并排的右侧栏（CSS 给 320–380px 的宽度）；
//   * 窄面板（≤900px）→ 覆盖式抽屉，并且 codesysNativeBounds() 会把真实 HWND 收到抽屉左侧，
//     不让它盖住对话栏。
// 收发消息只走一条极薄数据桥：外壳 → IPC（codesys:ai-chat-snapshot / codesys:ai-chat-prompt）
// → 主进程 → DSH 某一帧里的 window.__TASKHIVE_CODESYS_AI_BRIDGE__（只传数据、不渲染 UI）。
// 这样 DSH 改布局不会影响这个界面。
const CODESYS_AI_POLL_MS = 1500; // 不小于 1s：避免变成高频 IPC
// T183：会话**正在运行**时临时提速到 600ms —— 用户要的是"思考中"及时出现、生成结束立刻消失。
// 只在运行态生效，一结束就回到 1500ms（见 `codesysAiChatPollDelay()`）；轮询改成自调度的
// `setTimeout` + 在途闸（`state.codesysAiChatPullPending`），所以提速也不会堆 IPC。
const CODESYS_AI_POLL_ACTIVE_MS = 600;

// ── T175：抽屉宽度（用户原话：「会话不应该是死比列，应该可以调节宽度」） ─────────────────────
//
// 宽度规则（三条来自用户要求）：最小 280px；最大不超过面板宽度的 70%（留出正文可见）；
// 拖动**实时生效**（内联宽度直接写 DOM，不需要重开面板）。`null` = "没拖过"，此时**不写内联宽度**，
// 交给 CSS 原有的 `clamp(320px,36%,380px)`（宽面板并排）/ `clamp(240px, calc(100% - 320px), 360px)`
// （窄面板覆盖式）—— 这样"没动过把手"的面板行为与 T174 逐字一致，既有窄面板行为不受影响。
const CODESYS_AI_DRAWER_WIDTH_KEY = 'taskhive.codesysAiDrawerWidth';
const CODESYS_AI_DRAWER_MIN_WIDTH = 280;
const CODESYS_AI_DRAWER_MAX_RATIO = 0.7;
const CODESYS_AI_DRAWER_STEP = 16; // ←/→ 的一次微调；按住 Shift 放大 4 倍
// 原生窗口避让沿用既有那条 120ms 去抖（`state.codesysNativeMoveTimer`，ResizeObserver 用的是同一条），
// 不另造几何：拖动中每帧只写 DOM 宽度，真实 HWND 由 `codesysAiChatSyncNativeBounds()` 复用
// `codesysNativeBounds()` + `codesysAiChatOverlayRect()` 重新放置。

// 抽屉能取的宽度区间。上限永远不小于下限 —— 极端窄的面板下"70%"可能小于 280px，那时下限优先，
// 否则用户会被锁死在一个比最小宽度还小的值上（可用性 > 比例）。
function codesysAiChatDrawerWidthBounds() {
  const drawer = $('#codesys-ai-drawer');
  const container = drawer?.parentElement || null;
  const raw = container ? Number(container.getBoundingClientRect().width) || 0 : 0;
  const doc = Number(document.documentElement?.clientWidth) || 0;
  const available = raw > 0 ? raw : doc;
  return {
    min: CODESYS_AI_DRAWER_MIN_WIDTH,
    max: Math.max(CODESYS_AI_DRAWER_MIN_WIDTH, Math.round(available * CODESYS_AI_DRAWER_MAX_RATIO)),
    available: Math.round(available),
  };
}

function codesysAiChatClampWidth(px) {
  const value = Number(px);
  if (!Number.isFinite(value) || value <= 0) return null;
  const bounds = codesysAiChatDrawerWidthBounds();
  return Math.min(Math.max(Math.round(value), bounds.min), bounds.max);
}

function codesysAiChatReadStoredWidth() {
  try {
    const raw = window.localStorage?.getItem?.(CODESYS_AI_DRAWER_WIDTH_KEY);
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; } // 隐私模式 / 存储被禁用：退回默认宽度，不影响对话
}

function codesysAiChatPersistWidth(px) {
  try {
    if (px === null || px === undefined) window.localStorage?.removeItem?.(CODESYS_AI_DRAWER_WIDTH_KEY);
    else window.localStorage?.setItem?.(CODESYS_AI_DRAWER_WIDTH_KEY, String(Math.round(Number(px))));
  } catch { /* 写不进去就只在本次会话里生效 */ }
}

function codesysAiChatSyncResizerAria() {
  const resizer = $('#codesys-ai-resizer');
  const drawer = $('#codesys-ai-drawer');
  if (!resizer || !drawer) return;
  const bounds = codesysAiChatDrawerWidthBounds();
  const measured = Math.round(Number(drawer.getBoundingClientRect?.().width) || 0);
  const now = state.codesysAiChatWidth !== null
    ? state.codesysAiChatWidth
    : (measured > 0 ? measured : bounds.min);
  resizer.setAttribute('aria-valuemin', String(bounds.min));
  resizer.setAttribute('aria-valuemax', String(bounds.max));
  resizer.setAttribute('aria-valuenow', String(now));
  resizer.setAttribute('title', `拖动调节宽度（当前 ${now}px，可调 ${bounds.min}–${bounds.max}px）· ←/→ 微调 · 双击恢复默认宽度`);
}

// 把宽度写进 DOM。`px === null` = 恢复默认（清掉内联宽度，让 CSS 的 clamp 生效）。
function codesysAiChatApplyDrawerWidth(px, options = {}) {
  const drawer = $('#codesys-ai-drawer');
  if (!drawer) return null;
  const clamped = codesysAiChatClampWidth(px);
  try {
    if (clamped === null) drawer.style.removeProperty('width');
    else drawer.style.setProperty('width', `${clamped}px`);
  } catch { /* 样式写不进去：仍然记住状态，下一次打开会重试 */ }
  state.codesysAiChatWidth = clamped;
  if (options.persist === true) codesysAiChatPersistWidth(clamped);
  codesysAiChatSyncResizerAria();
  return clamped;
}

// 拖动起点宽度：优先用"用户拖过的值"，否则量当前 CSS 宽度（就是默认宽度）。
function codesysAiChatDrawerCurrentWidth() {
  const drawer = $('#codesys-ai-drawer');
  const measured = Math.round(Number(drawer?.getBoundingClientRect?.().width) || 0);
  if (state.codesysAiChatWidth !== null) return state.codesysAiChatWidth;
  return measured > 0 ? measured : CODESYS_AI_DRAWER_MIN_WIDTH;
}

// 拖动中 / 键盘微调后：把真实 CODESYS HWND 重新放回"抽屉左侧的可用区域"。
// **复用既有调用**（`codesysAiChatSyncNativeBounds()` → `codesysNativeBounds()`），只加一条去抖。
function codesysAiChatSyncNativeAfterResize(delayMs) {
  if (!state.codesysNativeAttached) return;
  if (state.codesysNativeMoveTimer) clearTimeout(state.codesysNativeMoveTimer);
  state.codesysNativeMoveTimer = setTimeout(() => {
    state.codesysNativeMoveTimer = null;
    void codesysAiChatSyncNativeBounds();
  }, Number(delayMs) || 0);
}

function codesysAiChatResizeEnd() {
  if (!state.codesysAiChatResizing && !state.codesysAiChatResizeStart) return;
  state.codesysAiChatResizing = false;
  state.codesysAiChatResizeStart = null;
  document.body?.classList?.remove?.('codesys-ai-resizing');
  window.removeEventListener('pointermove', codesysAiChatResizeMove);
  window.removeEventListener('pointerup', codesysAiChatResizeEnd);
  window.removeEventListener('pointercancel', codesysAiChatResizeEnd);
  // 松手才落盘：拖动中每帧写 localStorage 是没必要的磁盘抖动。
  codesysAiChatPersistWidth(state.codesysAiChatWidth);
  codesysAiChatSyncResizerAria();
  codesysAiChatSyncNativeAfterResize(0);
}

// 抽屉在右侧、把手在左边缘：鼠标**向左**拖 = 变宽，所以位移取 `起点 x - 当前 x`。
function codesysAiChatResizeMove(event) {
  if (!state.codesysAiChatResizing || !state.codesysAiChatResizeStart) return;
  const x = Number(event?.clientX);
  const delta = state.codesysAiChatResizeStart.x - (Number.isFinite(x) ? x : state.codesysAiChatResizeStart.x);
  const next = codesysAiChatApplyDrawerWidth(state.codesysAiChatResizeStart.width + delta);
  if (next === null) return;
  event?.preventDefault?.();
  // 实时生效：宽度已经写进 DOM；真实 HWND 是独立顶层窗口，不会跟着重排，所以要显式挪。
  codesysAiChatSyncNativeAfterResize(120);
}

function codesysAiChatResizeStart(event) {
  const drawer = $('#codesys-ai-drawer');
  if (!drawer || drawer.hidden) return;
  state.codesysAiChatResizing = true;
  state.codesysAiChatResizeStart = { x: Number(event?.clientX) || 0, width: codesysAiChatDrawerCurrentWidth() };
  document.body?.classList?.add?.('codesys-ai-resizing');
  try { event?.currentTarget?.setPointerCapture?.(event?.pointerId); } catch { /* 没有指针捕获也靠 window 监听 */ }
  event?.preventDefault?.();
  window.addEventListener('pointermove', codesysAiChatResizeMove);
  window.addEventListener('pointerup', codesysAiChatResizeEnd);
  window.addEventListener('pointercancel', codesysAiChatResizeEnd);
}

function codesysAiChatResizeKeydown(event) {
  const key = String(event?.key || '');
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
  event.preventDefault?.();
  const step = event?.shiftKey ? CODESYS_AI_DRAWER_STEP * 4 : CODESYS_AI_DRAWER_STEP;
  const current = state.codesysAiChatWidth !== null ? state.codesysAiChatWidth : codesysAiChatDrawerCurrentWidth();
  const next = codesysAiChatApplyDrawerWidth(current + (key === 'ArrowLeft' ? step : -step));
  if (next === null) return;
  codesysAiChatPersistWidth(next);
  codesysAiChatSyncNativeAfterResize(120);
}

// 双击把手 = 恢复默认宽度（把持久化的值删掉，CSS 的 clamp 重新生效）。
function codesysAiChatResetDrawerWidth() {
  codesysAiChatApplyDrawerWidth(null, { persist: true });
  // T180：成功不再说话（宽度肉眼可见地变了，再写一行就是用户讨厌的"那么多文字提示"）；
  // 流内那一行留给真正需要读的失败。
  codesysAiChatSetStatus('');
  codesysAiChatSyncNativeAfterResize(0);
}

// 面板自己变窄/变宽之后重新夹紧：70% 的上限是跟着容器算的，容器一变旧值就可能越界。
function codesysAiChatReclampDrawerWidth() {
  if (state.codesysAiChatWidth !== null) codesysAiChatApplyDrawerWidth(state.codesysAiChatWidth);
  else codesysAiChatSyncResizerAria();
}

function codesysAiChatReasonText(result) {
  const reason = String((result && result.reason) || 'unknown');
  const detail = String((result && result.detail) || '').trim();
  // T176：值为**空串**的条目 = "这个 reason 的 detail 本身就是一句完整可读的话"，直接用 detail，
  // 不再拼成"没有会话：主页当前没有会话：先在主页…"这种复读。这几种失败都是数据桥自己写的
  // 完整句子（见 shard 78 的 codesysAiChatMainSession / codesysAiChatModels）。
  const known = {
    'bridge-missing': 'DSH 侧没有 CODESYS AI 数据桥',
    'bridge-empty': '数据桥返回了空值',
    'bridge-crashed': '数据桥内部异常',
    'no-sessions': '',
    'no-window': '',
    'no-session': '',
    'no-binding': '',
    'binding-threw': '读取会话入口失败',
    'snapshot-threw': '读取会话快照失败',
    'empty-text': '没有可发送的文本',
    'no-prompt': '这个会话没有 prompt 入口',
    'rejected': 'Harness 拒绝了这条消息',
    'prompt-threw': '发送这条消息时出错',
    // T175：模型（读目录 / 切换）的失败原因。写完这句，外壳状态行就不会只剩一个裸英文 reason。
    'no-model-service': '',
    'model-catalog-failed': '',
    'model-catalog-threw': '',
    'empty-model': '没有指定要切换到哪个模型',
    // T176：不可路由的 provider 在列表里就被标注 + 禁用了，真走到这里一定有 provider 自报的原因。
    'provider-unavailable': '',
    // 说明行写的是"目标模型不在可用目录里 + 目录有几个"，所以这里只做一句不带复读的定性。
    'unknown-model': '',
    'model-unavailable': '这条会话用不了这个模型',
    'model-select-threw': '切换模型时出错',
    // T186：推理等级那两道校验的失败原因。`''` = 数据桥自己那句 detail 已经是完整可读的话
    // （"模型 X 不支持推理等级…" / "推理等级 ultra 不在 … 声明的档位里（可用：…）"），
    // 直接用 detail，免得说明行变成"effort-unsupported：…"这种半英文。
    'effort-unsupported': '',
    'unknown-effort': '',
    // T185：待回答那条链路的失败原因。`''` = 数据桥自己那句 detail 已经是完整可读的话，直接用它
    // （与上面几条同一约定）；其余几条补一句定性，免得状态行只剩一个裸英文 reason。
    // ⚠️ 这里**没有**"自动".* 之类的东西：作答只可能来自用户的点击，失败也就不可能来自轮询。
    'empty-answer': '',
    'no-pending': '',
    'not-answerable': '',
    'stale-pending': '',
    'incomplete-answer': '',
    'unknown-option': '',
    'answer-threw': '提交回答时出错',
    // A 段：工作台能力面（差异 / 确认写入 / 编译）那条链路的失败原因。`''` = 数据桥或工作台自己那句
    // detail 已经是完整可读的话，直接用它（与上面几条同一约定）。
    // ⚠️ 这里**没有**"自动".* 之类的东西：写入只可能来自用户在抽屉里的点击。
    'no-capabilities': '',
    'foreign-session': '',
    'stale-proposal': '',
    'not-writable': '当前工程不可写入',
    'review-required': '还没有逐项审查这次改动',
    'invalid-proposal': '当前提案不可写入',
    'no-job': '工作台还没有绑定工程',
    'no-proposal': '当前没有待写入的改动',
    'workbench-busy': '工作台正忙',
    'source-changed': '已阻止写入：工程在外部被修改过',
    'unverifiable': '已阻止写入：无法确认工程未被外部修改',
    'write-failed': '写入或编译失败',
    'apply-empty': '工作台没有回报写入结果',
    'apply-threw': '',
  };
  const label = Object.prototype.hasOwnProperty.call(known, reason) ? known[reason] : reason;
  if (!label) return detail || reason;
  // `detail` 常常已经以同一句话开头（主进程与 shard 78 都会写"DSH 侧没有 CODESYS AI 数据桥…"），
  // 那种情况直接用它，免得状态行出现"DSH 侧没有数据桥：DSH 侧没有数据桥（入口 …）"这种复读。
  if (detail && detail.startsWith(label)) return detail;
  return `${label}${detail ? `：${detail}` : ''}`;
}

// ── T180：状态提示 = 会话输出区里的一次性行（不再有"输入框上方那一行"） ──────────────────────
//
// 用户原话："已连接数据桥直接显示在会话输出区就好了，不要一直显示在输入框上面"。
// 那一个常驻状态节点**从 markup 里删掉**（连同它的 CSS；本轮结束时它的 class 名在本文件与
// `ui-overrides.css` 里都是 0 次出现），这一族提示改走消息流内的一行 `.codesys-ai-notice`：
//   * `message` 为空 → 这一行**整个不存在**（没有节点就没有占位、没有底色、没有边框）；
//   * 非空 → 流尾出现**一行**可读文字，整句同时进 `title`；
//   * 成功路径一律写空串 = 静默，所以"已连接数据桥 / 发送成功 / 复制成功"都不再提示；
//   * 真正需要用户看见的失败（数据桥不可用 / 打开失败 / 读取失败 / 发送失败 / 写剪贴板被拒）仍然
//     可见 —— 一行、可读、就在消息流里，详细原因继续进 `title`。
const CODESYS_AI_NOTICE_ID = 'codesys-ai-notice';
// 抽屉 markup 里消息流的**初始行**（一次快照都没读到之前那一句）。`codesysAiChatApplySnapshot(null)`
// 用它判断"这句还没下文的占位是不是该让位给失败提示"。
const CODESYS_AI_THREAD_PLACEHOLDER = '<div class="codesys-ai-empty">正在读取会话…</div>';
// 从 `innerHTML` 里摘掉上一次那一行的正则。属性顺序容错（浏览器回读 `innerHTML` 时保持作者顺序，
// 但不能假设）；正文是 `escapeHtml()` 转义过的，所以里面不会出现裸的 `</div>`。
const CODESYS_AI_NOTICE_STRIP_RE = /<div[^>]*id="codesys-ai-notice"[^>]*>[\s\S]*?<\/div>/;

// 流内那一行的 markup。`applySnapshot` 每次重画消息流时把它接在最后，所以"重画"不会把它擦掉，
// 也不会同时存在两份。
function codesysAiChatNoticeMarkup() {
  const text = String(state.codesysAiChatNotice || '');
  if (!text) return '';
  const title = String(state.codesysAiChatNoticeTitle || text);
  return `<div id="${CODESYS_AI_NOTICE_ID}" class="codesys-ai-notice" role="status" title="${escapeHtml(title)}">${escapeHtml(text)}</div>`;
}

// 就地补/撤那一行。为什么要"就地"而不是等下一次快照：发送失败 / 打开失败这些路径后面**没有**快照，
// 等 1.5 秒的轮询才出现，就是用户说的"点了没反应"。
// ⚠️ 只在**结果真的变了**时才写 `innerHTML`：`codesysAiChatCopyText()` 会先写提示再翻按钮文字，
// 无谓的一写会把那个按钮节点从文档里拆下来（它随后的 `isConnected` 守卫就什么也不做了）。
// 摘除也走字符串（而不是 `node.remove()`）：`innerHTML` 是两条路径（真实 DOM / mini-DOM）唯一
// 共有的一份说法，用字符串摘除才不会在 mini-DOM 里留下第二份同 id 的节点。
function codesysAiChatSyncNotice() {
  const thread = $('#codesys-ai-thread');
  if (!thread) return;
  const current = String(thread.innerHTML || '');
  const next = `${current.replace(CODESYS_AI_NOTICE_STRIP_RE, '')}${codesysAiChatNoticeMarkup()}`;
  if (next !== current) thread.innerHTML = next;
  thread.scrollTop = thread.scrollHeight;
}

function codesysAiChatSetStatus(message, title) {
  const text = String(message || '');
  const nextTitle = title === undefined ? text : String(title || '');
  const changed = text !== String(state.codesysAiChatNotice || '') || nextTitle !== String(state.codesysAiChatNoticeTitle || '');
  state.codesysAiChatNotice = text;
  state.codesysAiChatNoticeTitle = nextTitle;
  if (!changed) return;
  // 内容签名里带着这一行（见 `codesysAiChatApplySnapshot`），所以"内容没变就不重画"那条捷径
  // 必须为它让路：先失效，再就地补一次。
  state.codesysAiChatSignature = '';
  codesysAiChatSyncNotice();
}

// ── T175：模型选择器（**会话级**） ─────────────────────────────────────────────────────────
//
// 用户原话：「会话调用的主会话的接口，可以选择模型」。抽屉绑定的就是主页那条会话，所以这里改的是
// **这条会话**用的模型（DSH 的 `session/selectModel` 是会话级的，主页 composer 用的是同一个服务）。
// 数据流：外壳 → IPC `codesys:ai-chat-model` → 主进程 → DSH 文档里的数据桥 `models()` / `setModel(id)`。
const CODESYS_AI_MODEL_REFRESH_MS = 15000; // 目录本身很少变；1.5 秒的轮询只负责"当前模型"

// T176：模型说明行兼作失败反馈（role=status）。
// T179：它现在**只在有麻烦时**才写字（目录读取失败 / 没有会话 / 提供方不可用 / 切换失败）——
// 模型短名画在座位上，这里再写一遍就是用户报的"显示重复"。整句同时写进 `title`：这一行在窄抽屉里
// 会被省略号截断，但用户把鼠标放上去必须能看到完整原因（"不许只说不可用"）。
// T182：**成功切换一个字都不写**（用户原话「模型切换也不要有提示说切换好了」）。所以这里没有"确认行"
// 也没有"4 秒自毁"：成功的反馈就是触发器上已经更新的模型短名，失败 / 麻烦才在这一行留一句可读原因。
function codesysAiChatSetModelNote(message, title) {
  const node = $('#codesys-ai-model-note');
  if (!node) return;
  const text = String(message || '');
  node.textContent = text;
  node.title = title === undefined ? text : String(title || '');
}

// T179：模型座位（原来的原生 `<select>` + `<optgroup>`，用户原话「选择 ai 的界面太丑了」）换成
// 主界面 DSH 的写法 —— 一枚按钮 + 一层浮层菜单。结构逐条抄
// `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect`（`lib/client.js`）：
//   trigger（`.trigger`：28px 高、模型名 + chevron，`aria-haspopup=menu`）
//   → menu（`.menu` = `MenuSurface` 的磨砂卡片）
//   → group（`role=group` + `.groupTitle` 的 provider 名，即原来 `<optgroup>` 的分组信息）
//   → option（`role=menuitemradio` + `.optionCopy`/`.modelName` 在左、`.check` 勾选在右）。
// 数据一个字都没改：仍然是 `state.codesysAiChatModels` 的 `available` / `blocked` / `current`
// （数据桥 `codesys:ai-chat-model` 原样返回），所以这里只换渲染，不动桥。
const CODESYS_AI_MODEL_TRIGGER_EMPTY = '选择模型';
const CODESYS_AI_MODEL_TRIGGER_LOADING = '正在读取模型目录…';
// 勾选图标 = DSH `IconCheckOutlineRegular` 的 artwork（`dsh-client-ui-primitives`，16 视窗 / 1px 描边）。
const CODESYS_AI_MODEL_CHECK_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" stroke-width="1"><path d="M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4" stroke="currentColor"/></svg>';

// 只有"正在切"或"目录空"时才禁用座位 —— 失败一次就永久禁掉会让用户无法重试。
// （函数名里的 `Select` 是历史：T179 之前这里是一枚原生 `<select>`，现在是一枚按钮；名字保留是
//  因为它有 7 个调用点、改名只会让 diff 变吵，行为一个字都没变。）
// T186：**两个座位一起**同步 —— 推理等级与模型走的是同一条会话级写入，所以"正在切"时两边都禁用
// （否则用户在模型切换在途时再点等级，就是两个 `selectModel` 抢同一个会话）。
function codesysAiChatSyncModelSelectDisabled() {
  const trigger = $('#codesys-ai-model');
  if (!trigger) return;
  const options = Array.isArray(state.codesysAiChatModels?.available) ? state.codesysAiChatModels.available : [];
  trigger.disabled = state.codesysAiChatModelBusy === true || options.length === 0;
  // 禁用（正在切 / 没得选）时浮层必须收起来，否则会留下一个点不动的空菜单。
  if (trigger.disabled) codesysAiChatModelMenuClose({ focus: false });
  // 推理等级座位：只在"正在切"时禁用（它的可选项来自**当前模型**的能力，与目录条数无关 ——
  // 目录为空时它本来就被 `codesysAiChatRenderEffortOptions()` 收起来了）。
  const effort = $('#codesys-ai-effort');
  if (effort) effort.disabled = state.codesysAiChatModelBusy === true;
  if (effort && effort.disabled) codesysAiChatEffortMenuClose({ focus: false });
}

// 座位上的可见文本 = **模型短名**，完整那一句（"这条会话使用的模型：X"，或失败原因）写进
// `title` 与 `aria-label`：窄抽屉里字会被省略号截断，但悬停 / 读屏拿到的是全文。
// T179 的第一条纪律：模型短名**只在这一个地方画**（说明行不再重复它，见 codesysAiChatRenderModelOptions）。
function codesysAiChatSetModelTriggerLabel(text, title) {
  const nameNode = $('#codesys-ai-model-name');
  const trigger = $('#codesys-ai-model');
  const value = String(text === undefined || text === null ? '' : text);
  if (nameNode) nameNode.textContent = value;
  if (!trigger) return;
  const full = title === undefined ? value : String(title || '');
  trigger.title = full;
  trigger.setAttribute('aria-label', full ? `这条会话使用的模型：${full}` : '这条会话使用的模型');
}

// 一条模型在座位 / 菜单里显示的文本：**短名**（模型名），provider 名由分组标题承担 —— 与主界面
// composer 的模型座位一致（那边显示的就是模型名，不是"提供方 · 模型"）。
function codesysAiChatModelOptionLabel(item) {
  return String((item && (item.name || item.model)) || (item && item.id) || '');
}

// ── T186：座位内核 —— **一枚触发器 + 一层浮层**，模型与推理等级共用同一套语义 ────────────────────
//
// 为什么做成一个内核而不是把 T179 那套再抄一遍：两个座位的**交互**（打开 / 关闭 / ↑↓ 循环 /
// 回车选中 / Esc 回座位 / Tab 关掉 / 点外面关闭 / 键盘高亮 = 指针 hover 的同一档底色）必须一字不差，
// 抄第二份就是"以后修一个忘一个"的起点。所以下面按一个**座位描述符**参数化，模型座位那一组函数
// （`codesysAiChatModelMenuOpen()` 等，7 个调用点）保留原名、原签名，只是变成三行转发 ——
// 调用点、绑定、断言一个都不用动。
//
// 与主界面 `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect` 对齐的语义（真包行号）：
//   * 打开时高亮**当前项**（`:557` 的 `menuRef…querySelector('[aria-checked="true"]')`）；
//   * ↑↓ 移动真焦点（`:888-890` 的注释与 `moveFocus` `:620-625`）：键盘所在的那一行拿到指针
//     hover 的同一档填充；
//   * Esc 关闭并把焦点还给触发器（`:627-631` 的 `close(true)`）；
//   * 点浮层外面关闭（`:541-549` 的 `closeOutside`，`mousedown` + `contains` 两个判据）；
//   * `mousedown` 的默认行为压掉，点菜单不把焦点从座位上抢走（`:719-721`）。
// 差别只有一条（T179 起就有）：抽屉里没有 portal 机制，所以浮层贴底行向上弹，不走视口定位。

// 一个座位的 DOM 与状态寻址。`choose` 是"选中一条之后做什么"，各座位自己给。
// ⚠️ `emptyIsValue`：模型复合键绝不会是空串（空 = 没选中），但推理等级的"Default"档**就是**
// 空串（= 不发 `reasoningEffort` 这个字段，交给 provider 自己的默认档）。所以"空串算不算一个值"
// 必须按座位声明，否则回车选 "Default" 会被当成"没高亮"而静默失效。
function codesysAiChatSeat(config) {
  return {
    id: String(config.id || ''),
    optionSelector: config.optionSelector,
    dataAttribute: config.dataAttribute,
    openKey: config.openKey,
    activeKey: config.activeKey,
    emptyIsValue: config.emptyIsValue === true,
    choose: config.choose,
    onDisabled: config.onDisabled || null,
    trigger: () => $(config.triggerSelector),
    menu: () => $(config.menuSelector),
  };
}

// 浮层里已经画出来的选项节点。真实浏览器里它们由 `menu.innerHTML` 生成再查回来；
// 查不到（mini-DOM / 宿主不支持）就当没有 —— 渲染本身不依赖这次的查找结果。
function codesysAiChatSeatOptionNodes(seat) {
  const menu = seat.menu();
  if (!menu || typeof menu.querySelectorAll !== 'function') return [];
  try { return Array.from(menu.querySelectorAll(seat.optionSelector) || []); } catch { return []; }
}

// 一条选项在 `data-*` 上的值。`''` 是**合法值**（Default 档），所以这里不能拿 `||` 兜掉。
function codesysAiChatSeatOptionValue(seat, node) {
  const raw = node?.getAttribute?.(`data-${seat.dataAttribute}`);
  if (raw !== null && raw !== undefined) return String(raw);
  const viaDataset = node?.dataset?.[seat.dataAttribute];
  return viaDataset === undefined || viaDataset === null ? '' : String(viaDataset);
}

function codesysAiChatSeatIsOpen(seat) {
  const menu = seat.menu();
  return state[seat.openKey] === true && Boolean(menu) && menu.hidden === false;
}

// 键盘高亮画成选项上的 `data-active`（CSS 用主界面 `.item:focus-visible` 的同一档
// `--dsw-alias-interactive-bg-hover`），与指针 hover 共用一套观感。
function codesysAiChatSeatSyncActive(seat) {
  const active = String(state[seat.activeKey] || '');
  for (const node of codesysAiChatSeatOptionNodes(seat)) {
    node.setAttribute('data-active', codesysAiChatSeatOptionValue(seat, node) === active ? 'true' : 'false');
  }
}

function codesysAiChatSeatFocusActive(seat) {
  const active = String(state[seat.activeKey] || '');
  const node = codesysAiChatSeatOptionNodes(seat).find((item) => codesysAiChatSeatOptionValue(seat, item) === active);
  // 真焦点落在选项上（主界面 ModelSelect 的原话："Arrow navigation moves real focus, so the row
  // the keyboard is on carries the same fill the pointer gets"）。宿主不支持 focus 就只留 data-active。
  try { node?.focus?.(); } catch { /* 焦点拿不到不影响键盘导航 */ }
}

// 打开浮层。`options.focus === true`（键盘路径）时把真焦点交给当前项；鼠标路径不动焦点。
// 两个座位**互斥**：打开一个就把另一个收起来（主界面同一时刻也只有一个菜单）。
function codesysAiChatSeatOpen(seat, options = {}) {
  const menu = seat.menu();
  const trigger = seat.trigger();
  if (!menu || !trigger || trigger.disabled === true) return false;
  // 没有可选项（目录没读到 / 全是 blocked / 这个模型没有档位）时不弹一个空壳：
  // 原因由说明行那一行承担。
  if (!String(menu.innerHTML || '').trim()) return false;
  for (const other of CODESYS_AI_SEAT_LIST) {
    if (other !== seat) codesysAiChatSeatClose(other, { focus: false });
  }
  state[seat.openKey] = true;
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  const nodes = codesysAiChatSeatOptionNodes(seat);
  const usable = nodes.filter((node) => node.getAttribute?.('aria-disabled') !== 'true');
  const current = usable.find((node) => node.getAttribute?.('aria-selected') === 'true');
  const first = usable[0] || null;
  // 打开就落在**当前项**上（没有就用第一条可选项）：与主界面模型座位一致。
  state[seat.activeKey] = (current || first) ? codesysAiChatSeatOptionValue(seat, current || first) : '';
  codesysAiChatSeatSyncActive(seat);
  if (options.focus === true) codesysAiChatSeatFocusActive(seat);
  return true;
}

// 关闭浮层。`options.focus` 默认 true：把焦点还给座位按钮（键盘用户不会掉进虚空）。
function codesysAiChatSeatClose(seat, options = {}) {
  const menu = seat.menu();
  const trigger = seat.trigger();
  const wasOpen = state[seat.openKey] === true;
  state[seat.openKey] = false;
  state[seat.activeKey] = '';
  if (menu) {
    menu.hidden = true;
    for (const node of codesysAiChatSeatOptionNodes(seat)) node.setAttribute('data-active', 'false');
  }
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (wasOpen && options.focus !== false) { try { trigger?.focus?.(); } catch { /* 没焦点就算了 */ } }
  return wasOpen;
}

// ↑↓ 移动：只在**可选中**的项之间走（blocked 项被跳过 —— 它们选不中，但原因照旧画在菜单里），
// 到底了就绕回另一端（与主界面菜单的循环一致）。
function codesysAiChatSeatMove(seat, step) {
  const nodes = codesysAiChatSeatOptionNodes(seat).filter((node) => node.getAttribute?.('aria-disabled') !== 'true');
  if (!nodes.length) return '';
  const ids = nodes.map((node) => codesysAiChatSeatOptionValue(seat, node));
  const at = ids.indexOf(String(state[seat.activeKey] || ''));
  const next = at < 0 ? (step > 0 ? 0 : ids.length - 1) : (at + step + ids.length) % ids.length;
  state[seat.activeKey] = ids[next];
  codesysAiChatSeatSyncActive(seat);
  codesysAiChatSeatFocusActive(seat);
  return ids[next];
}

// 浮层内的指针事件。点击用**委托**（选项是 innerHTML 生成的，逐个挂监听会随每次重画泄漏），
// 并且照抄主界面把 `mousedown` 的默认行为压掉：点菜单不该把焦点从座位上抢走。
function codesysAiChatSeatClick(seat, event) {
  const option = event?.target?.closest?.(seat.optionSelector);
  if (!option) return;
  const disabled = option.getAttribute?.('aria-disabled') === 'true';
  const value = codesysAiChatSeatOptionValue(seat, option);
  // `aria-disabled` 的行交给座位自己的兜底（模型座位：给一行原因；等级座位：本来就没有禁用项）。
  if (disabled && seat.onDisabled && seat.onDisabled(option, value) === true) return;
  seat.choose(value);
}

function codesysAiChatSeatMouseDown(seat, event) {
  if (event?.target?.closest?.(seat.optionSelector)) event.preventDefault?.();
}

// 键盘：座位 / 浮层内的按键都从这里走（`keydown` 绑在抽屉上，事件会冒泡上来）。
//   ↑↓ = 打开（关闭态）或在可选项之间移动；回车 / 空格 = 选中高亮那条；Esc = 关闭并回到座位。
function codesysAiChatSeatKeydown(seat, event) {
  const key = String(event?.key || '');
  const target = event?.target || null;
  const trigger = seat.trigger();
  const menu = seat.menu();
  const onTrigger = Boolean(trigger) && target === trigger;
  const inMenu = Boolean(menu) && (target === menu || menu.contains?.(target) === true);
  if (!onTrigger && !inMenu) return;
  if (!codesysAiChatSeatIsOpen(seat)) {
    if (onTrigger && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ')) {
      event.preventDefault?.();
      if (codesysAiChatSeatOpen(seat, { focus: true })) {
        // ArrowUp 打开时落在**最后**一条（菜单从下往上翻的直觉），其余落在当前项。
        if (key === 'ArrowUp') {
          state[seat.activeKey] = '';
          codesysAiChatSeatMove(seat, -1);
        }
      }
    }
    return;
  }
  if (key === 'Escape') { event.preventDefault?.(); codesysAiChatSeatClose(seat); return; }
  if (key === 'ArrowDown') { event.preventDefault?.(); codesysAiChatSeatMove(seat, 1); return; }
  if (key === 'ArrowUp') { event.preventDefault?.(); codesysAiChatSeatMove(seat, -1); return; }
  if (key === 'Tab') { codesysAiChatSeatClose(seat, { focus: false }); return; }
  if (key === 'Enter' || key === ' ') {
    event.preventDefault?.();
    const active = String(state[seat.activeKey] || '');
    // 空串对模型座位 = "没高亮"，对等级座位 = "Default 那一档"（见 `emptyIsValue`）。
    if (active || seat.emptyIsValue === true) seat.choose(active);
  }
}

// 点浮层外面关闭（主界面菜单的 dismiss 行为）。监听器挂在 document 上，只在 bind 时注册一次。
function codesysAiChatSeatOutsideClick(seat, event) {
  if (!codesysAiChatSeatIsOpen(seat)) return;
  const target = event?.target || null;
  const menu = seat.menu();
  const trigger = seat.trigger();
  if (menu?.contains?.(target) === true || trigger?.contains?.(target) === true || target === trigger) return;
  codesysAiChatSeatClose(seat, { focus: false });
}

// ── 模型座位（T179 起的那一枚）─────────────────────────────────────────────────────────────
function codesysAiChatModelOptionNodes() { return codesysAiChatSeatOptionNodes(CODESYS_AI_SEAT_MODEL); }
function codesysAiChatModelMenuIsOpen() { return codesysAiChatSeatIsOpen(CODESYS_AI_SEAT_MODEL); }
function codesysAiChatModelMenuSyncActive() { return codesysAiChatSeatSyncActive(CODESYS_AI_SEAT_MODEL); }
function codesysAiChatModelMenuFocusActive() { return codesysAiChatSeatFocusActive(CODESYS_AI_SEAT_MODEL); }
function codesysAiChatModelMenuOpen(options = {}) { return codesysAiChatSeatOpen(CODESYS_AI_SEAT_MODEL, options); }
function codesysAiChatModelMenuClose(options = {}) { return codesysAiChatSeatClose(CODESYS_AI_SEAT_MODEL, options); }
function codesysAiChatModelMenuMove(step) { return codesysAiChatSeatMove(CODESYS_AI_SEAT_MODEL, step); }
function codesysAiChatModelMenuClick(event) { return codesysAiChatSeatClick(CODESYS_AI_SEAT_MODEL, event); }
function codesysAiChatModelMenuMouseDown(event) { return codesysAiChatSeatMouseDown(CODESYS_AI_SEAT_MODEL, event); }
function codesysAiChatModelMenuKeydown(event) { return codesysAiChatSeatKeydown(CODESYS_AI_SEAT_MODEL, event); }
function codesysAiChatModelMenuOutsideClick(event) { return codesysAiChatSeatOutsideClick(CODESYS_AI_SEAT_MODEL, event); }

// 指针 / 回车选中一条。**blocked 的项也走这里**：`codesysAiChatChangeModel()` 里那道防御会给出
// 一行可读原因并且**不发 IPC**（"先让用户选、切完才失败"这条路必须堵死），所以这里不另写一套判断。
function codesysAiChatModelMenuChoose(id) {
  const value = String(id || '');
  if (!value) return;
  codesysAiChatModelMenuClose({ focus: false });
  void codesysAiChatChangeModel(value);
}

// ── 推理等级座位（T186）──────────────────────────────────────────────────────────────────
//
// 等级**只**来自数据桥回传的 `reasoning`（= 模型描述符自己声明的那份，见 shard 78 的
// `codesysAiChatReasoningCapability`），本文件**不自造枚举**：外面给什么档位就画什么档位，
// 一个都没有就不画这个控件（`codesysAiChatRenderEffortOptions` 的 `hidden`）。
// "Default"（provider 默认档）这一条与主界面一字不差：只有当 provider **没有**声明
// `defaultEffort` 时才多出来（`client.js:524-532`），选中它就是**不发** `reasoningEffort`。
const CODESYS_AI_EFFORT_DEFAULT_LABEL = 'Default';

// 这个模型到底支不支持推理等级，以及有哪些档位。判据与主界面相同：`reasoning` 存在即支持
// （`client.js:782` 的 `reasoning !== void 0`）。`null` = 不支持 ⇒ 外壳不显示这个控件。
// 优先读"当前模型"那一行，读不到再按 id 回目录里找（两条路都是数据桥给的同一份数据）。
function codesysAiChatEffortCapability() {
  const catalog = state.codesysAiChatModels;
  if (!catalog) return null;
  const current = catalog.current || null;
  const id = String((current && current.id) || '');
  const row = id && Array.isArray(catalog.available) ? catalog.available.find((item) => item.id === id) : null;
  const raw = (current && current.reasoning) || (row && row.reasoning) || null;
  return codesysAiChatReasoningCapabilityOf(raw);
}

// 数据桥已经归一过一次，但这一份经过 IPC 的 JSON 往返；这里再夹紧一次，坏数据一律当"不支持"
// （宁可少画一个控件，也不画一个点不动的空壳）。
function codesysAiChatReasoningCapabilityOf(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const efforts = [];
  for (const level of Array.isArray(raw.efforts) ? raw.efforts : []) {
    if (!level || typeof level !== 'object') continue;
    const id = String(level.id === undefined || level.id === null ? '' : level.id);
    if (!id) continue;
    efforts.push({ id, name: String(level.name || id) });
  }
  return { defaultEffort: raw.defaultEffort === undefined || raw.defaultEffort === null ? '' : String(raw.defaultEffort), efforts };
}

// 浮层里画哪几条。与主界面 `client.js:524-532` 的 `effortChoices` 逐条对应：`defaultEffort` 未声明时
// 才多一条 "Default"（空串 = 不发字段），其余就是 provider 自己给的 `efforts`（名字原样，不改写）。
function codesysAiChatEffortLevels(capability) {
  const levels = [];
  if (!capability.defaultEffort) levels.push({ id: '', key: 'provider-default', label: CODESYS_AI_EFFORT_DEFAULT_LABEL });
  for (const level of capability.efforts || []) levels.push({ id: level.id, key: `effort:${level.id}`, label: level.name });
  return levels;
}

// 当前生效档位 = `current.reasoningEffort ?? reasoning.defaultEffort`（`client.js:522`）。
// 空串 = provider 默认档（不发这个字段）。
function codesysAiChatEffortSelectedValue(capability) {
  const current = state.codesysAiChatModels?.current || null;
  const explicit = current && current.reasoningEffort ? String(current.reasoningEffort) : '';
  if (explicit) return explicit;
  return capability && capability.defaultEffort ? String(capability.defaultEffort) : '';
}

// 座位上的**短名** = 这一档的可读名（`client.js:523`：`efforts.find(id)?.name ?? id`），
// 找不到（或就是默认档）时写 "Default"。模型名**不**在这里重复 —— T179 的纪律：
// 模型短名只在模型座位上画一处。
function codesysAiChatEffortLabel(capability, selected) {
  const level = (capability.efforts || []).find((item) => item.id === selected);
  return level ? level.name : CODESYS_AI_EFFORT_DEFAULT_LABEL;
}

// 座位的可见文本 = 等级短名；完整那一句写进 `title` / `aria-label`（与模型座位同口径）。
function codesysAiChatSetEffortTriggerLabel(text, title) {
  const nameNode = $('#codesys-ai-effort-name');
  const trigger = $('#codesys-ai-effort');
  const value = String(text === undefined || text === null ? '' : text);
  if (nameNode) nameNode.textContent = value;
  if (!trigger) return;
  const full = title === undefined ? value : String(title || '');
  trigger.title = full;
  trigger.setAttribute('aria-label', full ? `这条会话的推理等级：${full}` : '这条会话的推理等级');
}

function codesysAiChatEffortOptionNodes() { return codesysAiChatSeatOptionNodes(CODESYS_AI_SEAT_EFFORT); }
function codesysAiChatEffortMenuIsOpen() { return codesysAiChatSeatIsOpen(CODESYS_AI_SEAT_EFFORT); }
function codesysAiChatEffortMenuSyncActive() { return codesysAiChatSeatSyncActive(CODESYS_AI_SEAT_EFFORT); }
function codesysAiChatEffortMenuOpen(options = {}) { return codesysAiChatSeatOpen(CODESYS_AI_SEAT_EFFORT, options); }
function codesysAiChatEffortMenuClose(options = {}) { return codesysAiChatSeatClose(CODESYS_AI_SEAT_EFFORT, options); }

// 选中一档。空串 = "Default"（provider 默认档），是**合法**选择，所以这里**不**像模型座位那样
// 把空串当"没选"挡掉。
function codesysAiChatEffortMenuChoose(id) {
  const value = String(id === undefined || id === null ? '' : id);
  codesysAiChatEffortMenuClose({ focus: false });
  void codesysAiChatChangeEffort(value);
}

function codesysAiChatEffortMenuClick(event) { return codesysAiChatSeatClick(CODESYS_AI_SEAT_EFFORT, event); }
function codesysAiChatEffortMenuMouseDown(event) { return codesysAiChatSeatMouseDown(CODESYS_AI_SEAT_EFFORT, event); }
function codesysAiChatEffortMenuKeydown(event) { return codesysAiChatSeatKeydown(CODESYS_AI_SEAT_EFFORT, event); }
function codesysAiChatEffortMenuOutsideClick(event) { return codesysAiChatSeatOutsideClick(CODESYS_AI_SEAT_EFFORT, event); }

// 把当前的等级能力画进座位 + 浮层。**由 `codesysAiChatRenderModelOptions()` 每次重画后调用**，
// 所以"目录刷新 / 主页换了模型 / 切换成功"这三条路都会让这个座位跟着变，不需要各自的调用点。
//
// 模型不支持推理等级 ⇒ 整个控件 `hidden`（不是画一个禁用的空壳）：这正是 DSH 原生 UI 的判据
// （`client.js:782` 只在 `reasoning !== undefined` 时才画那一格），也满足"别给不可选项"。
function codesysAiChatRenderEffortOptions() {
  const seatNode = $('#codesys-ai-effort-seat');
  const trigger = $('#codesys-ai-effort');
  const menu = $('#codesys-ai-effort-menu');
  if (!seatNode || !trigger || !menu) return;
  const capability = codesysAiChatEffortCapability();
  if (!capability || !(capability.efforts || []).length) {
    // 一个档位都没有（provider 只给了个空的 `reasoning`）也没有可选项：同样不显示。
    const hadOptions = !seatNode.hidden || String(menu.innerHTML || '').trim() !== '';
    if (state.codesysAiChatEffortMenuOpen === true) codesysAiChatEffortMenuClose({ focus: false });
    seatNode.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.disabled = false;
    menu.hidden = true;
    if (hadOptions) menu.innerHTML = '';
    state.codesysAiChatEffortMenuActive = '';
    codesysAiChatSetEffortTriggerLabel('', '');
    return;
  }
  const levels = codesysAiChatEffortLevels(capability);
  const selected = codesysAiChatEffortSelectedValue(capability);
  let index = 0;
  const parts = levels.map((level) => {
    const optionId = `codesys-ai-effort-option-${index}`;
    index += 1;
    const on = String(level.id) === selected;
    return `<div class="codesys-ai-model-option" id="${optionId}" role="menuitemradio" tabindex="-1" data-ai-effort="${escapeHtml(level.id)}" aria-selected="${on ? 'true' : 'false'}"><span class="codesys-ai-model-option-copy"><span class="codesys-ai-model-option-name">${escapeHtml(level.label)}</span></span><span class="codesys-ai-model-check">${on ? CODESYS_AI_MODEL_CHECK_ICON : ''}</span></div>`;
  });
  menu.innerHTML = parts.join('');
  seatNode.hidden = false;
  const label = codesysAiChatEffortLabel(capability, selected);
  codesysAiChatSetEffortTriggerLabel(label, label);
  // 目录重画后高亮那条可能已经不在了（模型换了档位）：让 SyncActive 重新挑一条。
  if (!codesysAiChatEffortOptionNodes().some((node) => codesysAiChatSeatOptionValue(CODESYS_AI_SEAT_EFFORT, node) === String(state.codesysAiChatEffortMenuActive || ''))) {
    state.codesysAiChatEffortMenuActive = '';
  }
  codesysAiChatEffortMenuSyncActive();
}

// 把指定模型的推理等级改到 `effort`（空串 = Default / 交给 provider 默认档）。
//
// 用户口径（T182 / T186）：**成功完全静默**（座位上的短名就是确认，说明行一个字都不写）；
// 失败写**一行**可读原因，写在既有那一条说明行上（T179 纪律：说明行只有一处）。
// 安全面：这一条走的是与"切模型"**同一条**会话级写入（`codesys:ai-chat-model` 的 `select` +
// `effort`），落在会话的 `modelSelection` 投影上；它不写工程、不编译、不确认，也不轮询。
async function codesysAiChatChangeEffort(effort) {
  if (state.codesysAiChatModelBusy) return;
  const catalog = state.codesysAiChatModels;
  const current = catalog && catalog.current ? catalog.current : null;
  const modelId = String((current && current.id) || '');
  if (!modelId) { codesysAiChatSetModelNote('先给这条会话选一个模型，再改推理等级'); return; }
  const capability = codesysAiChatEffortCapability();
  if (!capability || !(capability.efforts || []).length) {
    codesysAiChatSetModelNote(`模型 ${codesysAiChatModelOptionLabel(current)} 不支持推理等级`);
    return;
  }
  const value = String(effort === undefined || effort === null ? '' : effort);
  // 下拉是可被脚本改的：档位不在模型声明的清单里就**不发**请求，只给一行原因。
  if (value && !(capability.efforts || []).some((level) => level.id === value)) {
    codesysAiChatSetModelNote(`推理等级 ${value} 不在这个模型声明的档位里`);
    return;
  }
  // 已经是这一档：什么都不发（与主界面 `chooseEffort()` 的"选当前档就关菜单"一致）。
  if (value === codesysAiChatEffortSelectedValue(capability)) return;
  // T231：改等级也是**显式**的会话级选择（同一条写入）⇒ 同样让"恢复上次选择"让位。
  state.codesysAiChatModelPickedSession = String(state.codesysAiChatSessionId || '*');
  state.codesysAiChatModelBusy = true;
  codesysAiChatSyncModelSelectDisabled();
  try {
    const result = await window.taskhive.codesysAiChatModel({ action: 'select', id: modelId, effort: value });
    if (result && result.ok === true) {
      // 成功：先把上一次可能残留的失败那一行收掉（清空不是提示，是把界面恢复安静）。
      codesysAiChatSetModelNote('');
      const next = await codesysAiChatRefreshModels({ force: true });
      // 目录可能拉不动 / 投影还没回流：至少把"当前档位"就地改成刚写下去的那一个，
      // 座位绝不能停在一个旧档位上。
      codesysAiChatApplyEffortNow(modelId, value);
      if (!next) codesysAiChatSyncEffortFromResult(result);
      await codesysAiChatPullSnapshot();
    } else {
      const text = codesysAiChatReasonText(result);
      const next = await codesysAiChatRefreshModels({ force: true });
      if (next) codesysAiChatRenderModelOptions(next);
      codesysAiChatSetModelNote(`切换失败：${text}`);
    }
  } catch (error) {
    const text = String(error.message || error);
    const next = await codesysAiChatRefreshModels({ force: true });
    if (next) codesysAiChatRenderModelOptions(next);
    codesysAiChatSetModelNote(`切换失败（IPC codesys:ai-chat-model）：${text}`);
  } finally {
    state.codesysAiChatModelBusy = false;
    codesysAiChatSyncModelSelectDisabled();
  }
}

// 就地改"当前档位"：`effort` 空串 = 把字段**删掉**（= provider 默认档），不是留一个空串字段
// （留空串会让 `reasoningEffort ?? defaultEffort` 这一路读到一个假值）。
function codesysAiChatApplyEffortNow(modelId, effort) {
  const catalog = state.codesysAiChatModels;
  if (!catalog || !catalog.current) return;
  const next = { ...catalog.current };
  if (modelId) next.id = String(modelId);
  if (effort) next.reasoningEffort = String(effort);
  else delete next.reasoningEffort;
  catalog.current = next;
  state.codesysAiChatModel = next;
  codesysAiChatRenderModelOptions(catalog);
}

// 切成功后目录可能拉不动（比如那一瞬间桥断了）：用数据桥回报的 `current` 再校一次座位。
function codesysAiChatSyncEffortFromResult(result) {
  if (!result) return;
  const catalog = state.codesysAiChatModels;
  const payload = result.current && result.current.reasoning !== undefined ? result.current : null;
  if (catalog && payload) {
    catalog.current = { ...payload };
    state.codesysAiChatModel = catalog.current;
    codesysAiChatRenderModelOptions(catalog);
    return;
  }
  codesysAiChatApplyEffortNow(String(result.model || ''), String(result.effort || ''));
}

// 两个座位的清单。顺序 = Tab / 事件遍历顺序，模型在前（它是"哪个模型"这个前提）。
// 两个座位共用 T179 那枚勾选图标字面量（`CODESYS_AI_MODEL_CHECK_ICON`），不新增任何图形。
const CODESYS_AI_SEAT_MODEL = codesysAiChatSeat({
  id: 'model',
  triggerSelector: '#codesys-ai-model',
  menuSelector: '#codesys-ai-model-menu',
  optionSelector: '.codesys-ai-model-option',
  dataAttribute: 'ai-model',
  openKey: 'codesysAiChatModelMenuOpen',
  activeKey: 'codesysAiChatModelMenuActive',
  emptyIsValue: false,
  choose: (value) => { codesysAiChatModelMenuChoose(value); },
  // 兜底：blocked 行**永远**只给一行原因、绝不发请求。正常路径（有 `id`）交给
  // `codesysAiChatChangeModel()` 里那道防御去判，两处绝不会给出不同的说法；万一哪天数据桥不回
  // `id`，这里也必须说话，不能变成"点了没反应"。
  onDisabled: (option, value) => {
    if (value) return false;
    const reason = String(option.getAttribute?.('data-blocked-reason') || option.textContent || '这条提供方当前不可路由');
    codesysAiChatSetModelNote(`不能选择：${reason}`);
    return true;
  },
});

const CODESYS_AI_SEAT_EFFORT = codesysAiChatSeat({
  id: 'effort',
  triggerSelector: '#codesys-ai-effort',
  menuSelector: '#codesys-ai-effort-menu',
  optionSelector: '.codesys-ai-model-option',
  dataAttribute: 'ai-effort',
  openKey: 'codesysAiChatEffortMenuOpen',
  activeKey: 'codesysAiChatEffortMenuActive',
  emptyIsValue: true,
  choose: (value) => { codesysAiChatEffortMenuChoose(value); },
  onDisabled: null,
});

const CODESYS_AI_SEAT_LIST = [CODESYS_AI_SEAT_MODEL, CODESYS_AI_SEAT_EFFORT];


// 把目录画进座位 + 浮层（value = `provider/model`）。三条与上一轮完全一致，只是载体从
// `<option>` 变成按钮：
//   * 可路由的 provider 各占一组，组标题是 provider 名（= 原来 `<optgroup>` 的分组信息）；
//   * `blocked`（host 侧 `modelCatalog.failures`）单独一组，每一条都 `aria-disabled` 且写明
//     provider 自报的原因：键盘跳过、指针点上去只得到原因，`codesysAiChatChangeModel()` 里还有
//     一道防御，所以"先让用户选，切完才失败"这条路被彻底堵掉；
//   * 当前模型不在目录里（已下线 / 目录过期 / provider 挂了）时仍然显示它，但标成"当前 · 不可用"，
//     绝不假装它可用。
//
// T179 的第二条纪律（用户原话「显示重复」）：**这个函数不再写说明行**。模型短名画在座位上，
// 说明行只在真有麻烦时由调用方写一行（目录读取失败 / 没有会话 / 提供方不可用 / 切换失败）。
function codesysAiChatRenderModelOptions(result) {
  const menu = $('#codesys-ai-model-menu');
  const trigger = $('#codesys-ai-model');
  if (!menu || !trigger) return;
  const available = Array.isArray(result?.available) ? result.available : [];
  const blocked = Array.isArray(result?.blocked) ? result.blocked : [];
  const current = result && result.current ? result.current : null;
  const currentId = String(current?.id || '');
  const groups = new Map();
  for (const item of available) {
    const key = String(item.providerName || item.provider || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const parts = [];
  let index = 0;
  const option = (item, extra) => {
    const id = `codesys-ai-model-option-${index}`;
    index += 1;
    return `<div class="codesys-ai-model-option" id="${id}" role="menuitemradio" tabindex="-1" data-ai-model="${escapeHtml(item.id)}" aria-selected="${item.id === currentId ? 'true' : 'false'}"${extra}><span class="codesys-ai-model-option-copy"><span class="codesys-ai-model-option-name">${escapeHtml(item.label)}</span></span><span class="codesys-ai-model-check">${item.id === currentId ? CODESYS_AI_MODEL_CHECK_ICON : ''}</span></div>`;
  };
  // 当前模型不在可用目录里：先画它（标"当前 · 不可用"），否则用户会以为"座位空着 = 没选过"。
  if (currentId && !available.some((item) => item.id === currentId)) {
    parts.push(`<div class="codesys-ai-model-group" role="group"><div class="codesys-ai-model-group-title">当前</div>${option({ id: currentId, label: `${codesysAiChatModelOptionLabel(current)}（当前 · 不可用）` }, ' aria-disabled="true"')}</div>`);
  }
  for (const [providerName, rows] of groups) {
    const headingId = `codesys-ai-model-group-${parts.length}`;
    const items = rows.map((item) => option({ id: item.id, label: codesysAiChatModelOptionLabel(item) }, '')).join('');
    parts.push(`<div class="codesys-ai-model-group" role="group" aria-labelledby="${headingId}"><div class="codesys-ai-model-group-title" id="${headingId}">${escapeHtml(providerName)}</div>${items}</div>`);
  }
  if (blocked.length) {
    const headingId = `codesys-ai-model-group-${parts.length}`;
    const items = blocked.map((item) => option({ id: String(item.id || ''), label: `${item.name || item.id}：${item.message}` }, ` aria-disabled="true" data-blocked-reason="${escapeHtml(String(item.message || '这条提供方当前不可路由'))}"`)).join('');
    parts.push(`<div class="codesys-ai-model-group" role="group" aria-labelledby="${headingId}"><div class="codesys-ai-model-group-title" id="${headingId}">不可用（不能选中）</div>${items}</div>`);
  }
  menu.innerHTML = parts.join('');
  if (!parts.length) menu.innerHTML = '<div class="codesys-ai-model-group-title">没有可用的模型</div>';
  // 座位上的短名 = 当前模型；目录里没有它时也用它的名字（后面注明不可用）。没得选的时候写
  // `选择模型` 这个中性占位，**不写失败原因** —— 原因只出现一次，在说明行里。
  const currentLabel = current ? codesysAiChatModelOptionLabel(current) : '';
  const fallbackLabel = available.length ? codesysAiChatModelOptionLabel(available[0]) : '';
  const seatLabel = currentLabel || fallbackLabel || CODESYS_AI_MODEL_TRIGGER_EMPTY;
  codesysAiChatSetModelTriggerLabel(seatLabel, currentLabel || (available.length ? `可选 ${available.length} 个模型 · 这条会话还没有选中模型` : CODESYS_AI_MODEL_TRIGGER_EMPTY));
  // 目录重画后高亮那条可能已经不在了（模型下线 / 切换完成）：让 SyncActive 重新挑一条。
  if (!codesysAiChatModelOptionNodes().some((node) => String(node.dataset?.aiModel || '') === String(state.codesysAiChatModelMenuActive || ''))) {
    state.codesysAiChatModelMenuActive = '';
  }
  codesysAiChatModelMenuSyncActive();
  // T186：推理等级座位**跟着模型座位一起重画** —— 目录刷新 / 主页换模型 / 切换成功这三条路都会
  // 走到这里，所以等级座位（等级清单、当前档位、要不要显示）不需要各自再挂一个调用点。
  codesysAiChatRenderEffortOptions();
  codesysAiChatSyncModelSelectDisabled();
}

// 拉模型目录。只在**打开抽屉 / 目录过期 / 主页换了模型**时拉，不跟着 1.5 秒快照轮询（目录很重，
// 快照只带当前模型那一个 id+label）。
async function codesysAiChatRefreshModels(options = {}) {
  const trigger = $('#codesys-ai-model');
  if (!trigger) return null;
  const now = Date.now();
  if (options.force !== true && state.codesysAiChatModels && now - state.codesysAiChatModelsAt < CODESYS_AI_MODEL_REFRESH_MS) return state.codesysAiChatModels;
  state.codesysAiChatModelPending = true;
  // 第一次拉目录时座位上还写着"正在读取模型目录…"；已经有目录了就保持当前短名，不做无谓的跳动。
  // 顺手把座位禁掉：这一趟 IPC 回来之前菜单里什么都没有，可点就是"点了没反应"。
  if (!state.codesysAiChatModels) {
    codesysAiChatSetModelTriggerLabel(CODESYS_AI_MODEL_TRIGGER_LOADING, CODESYS_AI_MODEL_TRIGGER_LOADING);
    codesysAiChatSyncModelSelectDisabled();
  }
  try {
    const result = await window.taskhive.codesysAiChatModel({ action: 'list' });
    state.codesysAiChatModelsAt = Date.now();
    if (!result || result.ok !== true) {
      // T176/T179：失败**不再**压成"模型目录不可用"这一句（用户报的就是它），也**不再**把同一句
      // 原因同时写进说明行与下拉文本（那是"显示重复"的另一半）。可见的那一份 = 说明行；座位只留
      // 一个中性占位 + `title` 全文，用户能照着修，座位也保持可重试（见 SyncModelSelectDisabled）。
      state.codesysAiChatModels = null;
      const text = codesysAiChatReasonText(result);
      codesysAiChatSetModelTriggerLabel(CODESYS_AI_MODEL_TRIGGER_EMPTY, text);
      codesysAiChatSyncModelSelectDisabled();
      // T186：目录没了 ⇒ 这个模型的等级能力也**不可验证**了，所以等级座位跟着收起来
      // （宁可少画一个控件，也不留一份可能已经过期的档位清单在屏幕上当"可选项"）。
      codesysAiChatRenderEffortOptions();
      // 桥**整体**不通（`bridge-*`）时，消息区已经写着同一句原因了（`codesysAiChatApplySnapshot`）——
      // 说明行不再复读；座位上的 `title` 里仍是全文。其余失败（目录读不出来 / 服务异常）说明行照写一行。
      const bridgeLevel = /^bridge-/.test(String(result?.reason || ''));
      codesysAiChatSetModelNote(bridgeLevel ? '' : `读取模型失败：${text}`, text);
      return null;
    }
    state.codesysAiChatModels = result;
    codesysAiChatRenderModelOptions(result);
    // 说明行**只在真有麻烦时**才写字：模型短名已经画在座位上，这里再写一遍就是用户报的"显示重复"。
    // 每一段都是数据桥真报上来的事实，没有任何一句是"不可用"这种空话（T176）。
    const current = result.current || null;
    const count = Array.isArray(result.available) ? result.available.length : 0;
    const notes = [];
    if (!current) notes.push(count ? `可选 ${count} 个模型 · 这条会话还没有选中模型` : '没有可用的模型');
    if (current && current.unavailable) notes.push(`${codesysAiChatModelOptionLabel(current)} 这条会话用不了：${current.unavailableReason || '不在可用目录里'}`);
    if (result.hasSession !== true) notes.push(result.sessionDetail || '主页没有正在查看的会话：现在只读目录，切换模型要先打开一条会话');
    // T179：`blocked` 的条数**不再**写进这一行 —— 浮层里已经有"不可用（不能选中）"那一组把
    // provider 名和原因逐条列出来，再在说明行里报一次数量就是我们正在删的那种重复。
    if (result.catalogError) notes.push(`目录告警：${result.catalogError}`);
    const fullNote = notes.join(' · ');
    codesysAiChatSetModelNote(fullNote, fullNote);
    return result;
  } catch (error) {
    state.codesysAiChatModels = null;
    codesysAiChatSetModelTriggerLabel(CODESYS_AI_MODEL_TRIGGER_EMPTY, 'IPC codesys:ai-chat-model 不可用');
    codesysAiChatSyncModelSelectDisabled();
    // T186：同上面那条失败路径 —— 读不到目录就没有可验证的档位，等级座位收起来。
    codesysAiChatRenderEffortOptions();
    codesysAiChatSetModelNote(`读取模型失败（IPC codesys:ai-chat-model）：${error.message}`);
    return null;
  } finally {
    state.codesysAiChatModelPending = false;
  }
}

// 切成功后目录可能拉不动（比如那一瞬间桥断了）：至少把"当前"就地改掉，座位不会停在一个旧值上。
function codesysAiChatSyncModelFromResult(result) {
  const catalog = state.codesysAiChatModels;
  if (!catalog || !result) return;
  catalog.current = result.current || { id: result.model, label: result.label || result.model };
  state.codesysAiChatModel = catalog.current;
  codesysAiChatRenderModelOptions(catalog);
}

// 切换**这条会话**的模型。失败在面板上说清楚（T173 的教训：不许静默 —— 那是针对**失败**的）。
// T182：**成功完全静默**（用户原话「模型切换也不要有提示说切换好了」）：说明行一个字都不写，
// 确认由触发器上已经更新的模型短名承担；连"正在切换…"也不再写了 —— 用户要的是界面安静，
// 切换期间座位本来就是禁用态（`codesysAiChatSyncModelSelectDisabled`），再写一句就是又一次打扰。
// T176：`id` 只在本界面里是 `provider/model` 复合键；不可路由的 provider 在列表里就被禁用了，
// 这里再挡一道（下拉是可被脚本改的，防御不能只靠 `disabled`）。
async function codesysAiChatChangeModel(id) {
  const value = String(id || '');
  if (!value) { codesysAiChatSetModelNote('先选一个模型'); return; }
  if (state.codesysAiChatModelBusy) return;
  const blocked = Array.isArray(state.codesysAiChatModels?.blocked)
    ? state.codesysAiChatModels.blocked.find((item) => item.id && (value === item.id || value.startsWith(`${item.id}/`)))
    : null;
  if (blocked) {
    // blocked 的提供方**一个请求都不发**（这就是防御的位置），只留一行可读原因 ——
    // T179：原因只写说明行这一处，不再同时写进状态行（同一句话写两遍就是用户报的"显示重复"）。
    const text = `提供方 ${blocked.name || blocked.id} 当前不可路由：${blocked.message}`;
    codesysAiChatSetModelNote(`不能选择：${text}`);
    return;
  }
  // T231：用户**显式**在这条会话里换了模型 ⇒ "恢复上次选择"必须让位（不覆盖当下的选择）：
  // 投影回流可能晚一拍（那一拍里 `codesysAiChatSessionSelection` 还是空的），所以这里在**发请求之前**
  // 就打标记，恢复路径据此跳过。
  state.codesysAiChatModelPickedSession = String(state.codesysAiChatSessionId || '*');
  state.codesysAiChatModelBusy = true;
  codesysAiChatSyncModelSelectDisabled();
  try {
    const result = await window.taskhive.codesysAiChatModel({ action: 'select', id: value });
    if (result && result.ok === true) {
      const label = String(result.label || (result.current && result.current.label) || value);
      // T182：成功**不写任何提示**。先把上一次可能残留的失败 / 麻烦那一行收掉（清空不是提示，
      // 是把界面恢复安静 —— 不清的话"切换失败：…"会一直挂在那里）；随后目录刷新若报出**真实的**
      // 麻烦（目录告警 / 主页没有会话 / 当前模型不可用），它照旧留在这一行上：那是麻烦，不是确认。
      codesysAiChatSetModelNote('');
      const catalog = await codesysAiChatRefreshModels({ force: true });
      // 先把"当前"记成刚切过去的模型，紧接着那次快照才不会又被当成"主页改了模型"。
      state.codesysAiChatModel = (catalog && catalog.current) || result.current || { id: value, label };
      if (!catalog) codesysAiChatSyncModelFromResult(result);
      // `verified` 仍然不许谎报（T179 的纪律没变）：投影还没回流时，下一次 1.5 秒快照会把真实值带出来，
      // 座位上的短名也以数据桥回报的 current 为准。成功的可见反馈 = 座位上已经更新的模型短名。
      await codesysAiChatPullSnapshot();
    } else {
      const text = codesysAiChatReasonText(result);
      // 回到数据桥报的**真实**当前值：座位绝不能停在一个没生效的模型上。
      // 顺序很重要：refresh 会写自己的说明行，所以"切换失败"必须**最后**写，否则会被它盖掉。
      const catalog = await codesysAiChatRefreshModels({ force: true });
      if (catalog) codesysAiChatRenderModelOptions(catalog);
      codesysAiChatSetModelNote(`切换失败：${text}`);
    }
  } catch (error) {
    const text = String(error.message || error);
    const catalog = await codesysAiChatRefreshModels({ force: true });
    if (catalog) codesysAiChatRenderModelOptions(catalog);
    codesysAiChatSetModelNote(`切换失败（IPC codesys:ai-chat-model）：${text}`);
  } finally {
    state.codesysAiChatModelBusy = false;
    codesysAiChatSyncModelSelectDisabled();
  }
}

// 主页改了模型要跟着变：快照每 1.5 秒带一次**当前模型**（数据桥同步读会话的 modelSelection 投影，
// 不联网）。只有"确实变了"才动界面，否则每 1.5 秒都会把用户的"已切换…"提示盖掉。
function codesysAiChatSyncModelFromSnapshot(result) {
  const model = result && result.model ? result.model : null;
  if (!model || !model.id) return null;
  const previous = state.codesysAiChatModel;
  if (previous && previous.id === model.id) return model; // 没变：不覆盖说明行、不重画座位
  state.codesysAiChatModel = model;
  const catalog = state.codesysAiChatModels;
  const known = catalog && Array.isArray(catalog.available) ? catalog.available.find((item) => item.id === model.id) : null;
  if (catalog && known) {
    catalog.current = { ...known, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) };
    codesysAiChatRenderModelOptions(catalog);
    // T179：这里**不写**说明行。主页换模型 → 座位上的短名跟着变，那就是可见反馈；
    // 原来的 `codesysAiChatSetModelNote(followed, …)` 会在座位旁边再写一遍同一个短名（用户报的重复）。
    return model;
  }
  // 主页换到了目录里没有的模型（或目录还没拉过）：补拉一次目录。5 秒冷却 + 单飞，绝不会变成
  // "每 1.5 秒拉一次大目录"。
  if (!state.codesysAiChatModelPending && Date.now() - state.codesysAiChatModelsAt > 5000) {
    void codesysAiChatRefreshModels({ force: true });
  }
  return model;
}

// ── T231：把"上次选过的模型 / 思考强度"在**新会话**里静默恢复一次 ─────────────────────────────
//
// 用户报障原话：「还有一个事情，模型切换关闭程序打开之后为什么不会保存？」
// 取证事实：抽屉那次选择是**会话级**的（shard 78 的 `setModel` → `directory.select` /
// `remote.session.selectModel`，落在这条会话的 `modelSelection` 投影上）。重启之后建立的是新会话，
// 投影是空的 ⇒ DSH 回落到目录里的全局默认值 —— 这次选择从来没有被写进任何跨进程的地方。
// 所以"记住"落在主进程那份偏好文件里（与"启动时预打开"**同一份**，走既有 `atomic-json` 读写 ——
// 渲染层不认识它的路径与文件名，只走 IPC，见 `tests/codesys-preopen-setting-contract.js` 的纪律），
// 由 `codesys:ai-chat-model` 的 `list` 一并带回（`catalog.remembered`）；
// 这里只负责**应用**，走的是与用户点击**完全相同**的那一条通道 / 动作。
//
// 三条纪律（与用户口径一致）：
//   ① **会话现值优先**：只有"这条会话还没有显式选择"（`codesysAiChatSessionSelection === null`）
//      且用户本次运行没在这条会话里显式换过时，才应用一次；否则一个请求都不发（绝不 clobber）。
//   ② **成功零文字**（T182 的安静口径）：唯一可见反馈是座位上已经更新的模型短名；成功与失败都
//      **不写**说明行 —— 失败原因进主进程审计（`codesys.ai-chat.model-failed`），界面保持安静。
//   ③ 存的东西**不可用**就退回默认：模型不在目录里 / provider 变了 ⇒ 照发一次，让数据桥按既有校验
//      拒绝（会话因此仍是默认值），审计里留下一行真话（不谎报成功）；等级不在该模型声明的档位里 ⇒
//      **丢强度只留模型**（与 T202 的两道防御同一口径）。
function codesysAiChatRememberedSelection(catalog) {
  const raw = catalog && catalog.remembered ? catalog.remembered : null;
  const provider = String((raw && raw.provider) || '');
  const model = String((raw && raw.model) || '');
  if (!provider || !model) return null;
  return { provider, model, reasoningEffort: String((raw && raw.reasoningEffort) || '') };
}

// 记忆里的强度只有**这个模型自己声明过**才带上（T202：模型没有 `reasoning` 就不接受任何等级；
// 等级不在 `efforts` 里也不发）。模型不在目录里 ⇒ 连可验证的档位都没有 ⇒ 只留模型。
function codesysAiChatRememberedEffort(remembered, row) {
  const effort = String((remembered && remembered.reasoningEffort) || '');
  if (!effort) return '';
  const efforts = row && row.reasoning && Array.isArray(row.reasoning.efforts) ? row.reasoning.efforts : [];
  return efforts.some((level) => level && String(level.id) === effort) ? effort : '';
}

// 成功与失败都**不写**一个字（见上面纪律 ②③）：`catch` 只吞掉"桥不可达"，记忆原样留着，
// 下一次建立会话时再试；失败原因由主进程那行审计承担。返回 `null` 只为调用处方便 `void`。
async function codesysAiChatRestoreRememberedModel() {
  const sessionId = String(state.codesysAiChatSessionId || '');
  if (!sessionId) return null;
  // 一条会话只做**一次**决策，做完就记下来（`bindCodesysAiChatUi()` 不重置它，所以收起再打开抽屉
  // 也不会重发一次）—— 既不是连续监视，也不新增任何定时器。
  if (state.codesysAiChatModelRestoredFor === sessionId) return null;
  if (state.codesysAiChatModelRestoreBusy === true || state.codesysAiChatModelBusy === true) return null;
  // 目录还没到（或读失败）时**不消费**这次机会：下一次快照再判 —— 少了目录就既读不到记忆，
  // 也没法验证等级。
  const catalog = state.codesysAiChatModels;
  if (!catalog || catalog.ok !== true) return null;
  // 用户在这条会话里显式换过 ⇒ 让位（抽屉座位与主界面 composer 都会走到
  // `codesysAiChatChangeModel` / `codesysAiChatChangeEffort`，两处都打这个标记）。
  const picked = String(state.codesysAiChatModelPickedSession || '');
  if (picked === '*' || picked === sessionId) return null;
  state.codesysAiChatModelRestoredFor = sessionId;
  const remembered = codesysAiChatRememberedSelection(catalog);
  if (!remembered) return null; // 没存过 ⇒ 走默认，**一个请求都不发**
  const chosen = state.codesysAiChatSessionSelection;
  if (chosen && chosen.id) return null; // 这条会话已经显式选过 ⇒ 会话现值优先，不覆盖
  const wanted = `${remembered.provider}/${remembered.model}`;
  const row = (Array.isArray(catalog.available) ? catalog.available : []).find((item) => item.id === wanted) || null;
  const effort = codesysAiChatRememberedEffort(remembered, row);
  state.codesysAiChatModelRestoreBusy = true;
  try {
    // 与用户点击走**同一条**通道 / 同一个动作（`codesys:ai-chat-model` 的 `select`）：`source` 只用于
    // 主进程审计（"这一次是恢复，不是用户点的"），不新增通道、不新增动作。
    await window.taskhive.codesysAiChatModel({ action: 'select', id: wanted, effort, source: 'restore' });
  } catch { /* 桥不可达：本次不恢复，界面一个字都不写 */ }
  finally { state.codesysAiChatModelRestoreBusy = false; }
  return null;
}

function syncCodesysAiChatButton() {
  const button = $('#codesys-ai-toggle');
  if (!button) return;
  button.classList.toggle('active', state.codesysAiChatOpen);
  button.setAttribute('aria-pressed', String(state.codesysAiChatOpen));
  button.title = state.codesysAiChatOpen
    ? '收起面板内的 AI 对话栏'
    : '打开面板内的 AI 对话栏（与主页同一条会话，CODESYS 工作台接口默认可用）';
}

// ── T176：消息流的"主界面观感" ─────────────────────────────────────────────────────────────
//
// 用户原话：「现在会话整体ui太粗糙了没有质感，应该和主界面会话一样」。所以 DOM 与观感都对着
// `@deepseek-ai/dsh-client-ui-chat` 抄：
//   * 用户消息 = 右对齐气泡（`MessageItem.module.css` 的 `.userRow` / `.bubble`：
//     `background: var(--dsw-specific-bubble)`（= `--dsw-static-deepseek-50` #edf3fe）、
//     `border-radius: var(--dsw-radius-xl)`（20px）、`padding: 10px 16px`、14px/22px、`pre-wrap`）；
//   * 助手消息 = 左侧**无气泡**正文（`AssistantMarkdown.module.css` 的 `.root`：14px/24px、
//     `--dsw-alias-label-primary`），下面挂一条 hover 才出现的操作条
//     （`MessageIconActions.module.css` 的 `.actions` / `.action`：28×28、`--dsw-radius-sm`、
//     `--dsw-alias-label-tertiary`、hover 时 `--dsw-alias-interactive-bg-hover`）；
//   * 角色只用**对齐 + 气泡**区分（主界面就是这样，没有可见的角色字），`codesys-ai-role` 保留在
//     DOM 里但走 `.sr-only`，读屏仍然能听出谁说的话；
//   * ``` 围栏 → 主界面的 `.md-code-block`：banner 行放语言名 + 复制按钮，正文用代码字体
//     （`--ds-font-family-code`），底色 `--dsw-alias-markdown-code-block`（#f9fafb）。
//
// 安全面：`codesysText()` 给的是**纯文本**，所以这里先 `escapeHtml()` 再套标签 —— 生产出来的
// 一定是转义过的文本，代码围栏的切分也只发生在转义后的字符串上（不会把用户内容变成标记）。
// 内联代码的识别：`` `x` `` → `<code>`。
// ⚠️ 这里刻意用 `new RegExp` + **单引号字符串**写，而不是正则字面量：本仓有两份契约用同一个
// `codeOnly()` 剥离器（`tests/codesys-window-fit-contract.js` 与
// `tests/client-bundle-integrity-contract.js`），它把成对的 `` ` `` 当模板字符串 —— 正则字面量里的
// 裸反引号是**奇数个**，会让剥离器从那一刻起把后面的注释也当代码，于是"删除说明写在注释里"的负向
// 断言会误报（`stopCodesysMediaStream` 就是这么被误判的）。行为完全等价，源码里也不再出现裸反引号。
const CODESYS_AI_INLINE_CODE_RE = new RegExp('`([^`\\n]+)`', 'g');

function codesysAiChatInlineCodeMarkup(escapedPiece) {
  return escapedPiece.replace(CODESYS_AI_INLINE_CODE_RE, '<code class="codesys-ai-inline-code">$1</code>');
}

// 纯文本 → 正文 + 代码块。围栏是三个反引号；围栏内第一行如果是单个词就当语言名。
function codesysAiChatTextMarkup(text) {
  const source = String(text || '');
  const parts = source.split('```');
  const html = [];
  for (let index = 0; index < parts.length; index += 1) {
    const chunk = parts[index];
    if (index % 2 === 1) {
      const lines = chunk.replace(/^\n/, '').split('\n');
      const first = String(lines[0] || '').trim();
      const isLanguage = Boolean(first) && !/\s/.test(first);
      const body = (isLanguage ? lines.slice(1) : lines).join('\n').replace(/\n$/, '');
      const codeId = state.codesysAiChatCodeTexts.push(body) - 1;
      html.push(`<div class="codesys-ai-code"><div class="codesys-ai-code-head"><span class="codesys-ai-code-lang">${escapeHtml(isLanguage ? first : '')}</span><button class="codesys-ai-code-copy" type="button" data-ai-copy-code="${codeId}" title="复制这段代码" aria-label="复制这段代码">复制</button></div><pre class="codesys-ai-code-body"><code>${escapeHtml(body)}</code></pre></div>`);
      continue;
    }
    if (!chunk) continue;
    // 围栏两侧各会留下一个换行：进代码块前的那一行、出代码块后的那一行，都要吃掉，
    // 否则正文里会多出一个空行（主界面的 markdown 解析不会这样）。
    let piece = chunk;
    if (index > 0) piece = piece.replace(/^\n/, '');
    if (index < parts.length - 1) piece = piece.replace(/\n$/, '');
    if (!piece) continue;
    html.push(`<div class="codesys-ai-plain">${codesysAiChatInlineCodeMarkup(escapeHtml(piece))}</div>`);
  }
  return html.length ? html.join('') : '<div class="codesys-ai-plain"></div>';
}

// 复制到剪贴板。`navigator.clipboard` 在 file:// 下可用，但被策略/焦点挡住时还有 textarea 兜底
// —— "复制"按钮点了没反应是最典型的"没有质感"。
async function codesysAiChatCopyText(text, node) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; }
  catch { ok = codesysAiChatCopyFallback(text); }
  // T180：复制**成功**不再写流内提示 —— 按钮自己已经翻成"已复制"（下面那段），再写一行就是复读。
  // 失败必须留下：写剪贴板被策略挡住是用户唯一能采取行动的线索，那一行进消息流。
  if (!ok) codesysAiChatSetStatus('复制失败：这个环境不允许写剪贴板，请手动选中复制');
  else codesysAiChatSetStatus('');
  if (!node || !node.isConnected) return;
  const previous = node.textContent;
  node.textContent = ok ? '已复制' : '复制失败';
  node.classList.toggle('copied', ok);
  window.setTimeout(() => {
    if (!node.isConnected) return;
    node.textContent = previous;
    node.classList.remove('copied');
  }, 1200);
}

function codesysAiChatCopyFallback(text) {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok === true;
  } catch { return false; }
}

// ── T183：抽屉里的"正在思考 / 进行中"（照抄主界面，不加一个字） ────────────────────────────
//
// 用户原话：「现在有输出，但是没有显示在思考」＋ 他此前反复要求「界面安静」。所以这里**只**画主界面
// 在生成期间画的那两样东西，文案也逐字用主界面自己的词条（`@deepseek-ai/dsh-client-ui-chat`）：
//   * 没有推理文本时 = 实时行，标题是 `message.stepProcess.thinking` = **"正在分析请求"**
//     （`lib/client.js:5415`；由 `ProcessGroupHeader` 在 `data.summary.running` 为空时取默认
//     activity `thinking`，`:2257`/`:2262`），图标是 `IconThinkOutlineRegular`（同文件 `:2196`）。
//   * 有推理文本时 = 折叠行，标题是 `message.think` = **"思考"**（`:5549` + `ReasoningRow` 的
//     `title: t("message.think")`，`:5897`），右侧跟一抹流式摘要（主界面在流式期间取"最后一段的
//     第一行"，`:5853` 的 `latestCompletedParagraphFirstLine`），展开才看全文（`:5868-5875` 的
//     `.thinkBody`）。
// 两个标题、一个摘要、一层折叠 —— 全是主界面已有的东西，所以"界面上多了字"这件事有依据。
// 结束（`running` 变回 false）时整块**消失**：不写"已完成"、不留任何常驻文案（用户要的就是安静）。
const CODESYS_AI_LIVE_THINK_ICON = '<svg class="codesys-ai-live-glyph" viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" stroke-width="1"><path d="M10.7554 5.24466C13.9891 8.4783 15.3769 12.3333 13.8552 13.8551C12.3335 15.3768 8.4785 13.989 5.24478 10.7553C2.01111 7.52165 0.623307 3.66664 2.14504 2.14491C3.66676 0.623189 7.52178 2.01099 10.7554 5.24466Z" stroke="currentColor"/><path d="M10.7554 10.7553C7.52178 13.989 3.66676 15.3768 2.14504 13.8551C0.623307 12.3333 2.01111 8.4783 5.24478 5.24466C8.4785 2.01099 12.3335 0.623189 13.8552 2.14491C15.3769 3.66664 13.9891 7.52165 10.7554 10.7553Z" stroke="currentColor"/><path d="M8.9587 8.00025C8.9587 8.52835 8.5306 8.95655 8.0024 8.95655C7.47429 8.95655 7.04614 8.52835 7.04614 8.00025C7.04614 7.47209 7.47429 7.04395 8.0024 7.04395C8.5306 7.04395 8.9587 7.47209 8.9587 8.00025Z" fill="currentColor"/></svg>';
const CODESYS_AI_LIVE_CHEVRON_ICON = '<svg class="codesys-ai-live-chevron-glyph" viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" stroke-width="1"><path d="M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" stroke="currentColor"/></svg>';
// 主界面 `ReasoningRow` 在运行态给读屏看的那一句（`t("row.running")` = "运行中"，`:5596` + `:5888`），
// 视觉上不出现（`.sr-only`），所以它不是"多出来的字"。
const CODESYS_AI_LIVE_RUNNING_LABEL = '运行中';

// 折叠摘要：**逐字照抄**主界面 `latestCompletedParagraphFirstLine()`
// （`@deepseek-ai/dsh-client-ui-chat/lib/client.js:5821-5836`）—— 流式期间显示"最后一个
// **已完成**段落的第一行"，所以第一段还没换行时它返回空串；主界面那时也不画摘要
// （`:5855` 的 `preview` + `.lcKema_root:not([data-preview])` 把 separator/summary 藏起来）。
// `**` 的剥离与主界面同一处（`:5854` 的 `summaryText.replaceAll("**", "")`），放在调用方。
function codesysAiChatReasoningPreview(text) {
  const source = String(text || '');
  let summary = '';
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  for (;;) {
    const nextParagraph = separator.exec(source);
    const paragraphEnd = nextParagraph === null ? source.length : nextParagraph.index + nextParagraph[0].indexOf('\n');
    const newline = source.indexOf('\n', paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = source.slice(paragraphStart, newline).trim();
      if (candidate !== '') summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

// 生成期间那一行。两种形态，各自**逐字**对应主界面的一行：
//   * 还没有推理文本 → 主界面实时行的默认 activity：`message.stepProcess.thinking`「正在分析请求」
//     （不可展开 —— 这时候没有任何细节可看，做成按钮只会"点了没反应"）；
//   * 有推理文本 → 主界面 `ReasoningRow`：标题「思考」+（有已完成段落时）13px 流式摘要，
//     点一下展开看推理全文。
// 返回空串 = 这一行根本不存在（生成结束就是这种情况）。
function codesysAiChatLiveMarkup(reasoning) {
  const text = String(reasoning || '');
  const running = `<span class="sr-only">${CODESYS_AI_LIVE_RUNNING_LABEL}</span>`;
  if (!text.trim()) {
    return `<div class="codesys-ai-live" data-activity="thinking" aria-live="off"><div class="codesys-ai-live-row">${running}<span class="codesys-ai-live-leading" aria-hidden="true">${CODESYS_AI_LIVE_THINK_ICON}</span><span class="codesys-ai-live-title" data-streaming="1">正在分析请求</span></div></div>`;
  }
  const open = state.codesysAiChatReasoningOpen === true;
  const preview = codesysAiChatReasoningPreview(text).replace(/\*\*/g, '');
  const leading = `<span class="codesys-ai-live-leading" aria-hidden="true"><span class="codesys-ai-live-icon">${CODESYS_AI_LIVE_THINK_ICON}</span><span class="codesys-ai-live-chevron">${CODESYS_AI_LIVE_CHEVRON_ICON}</span></span>`;
  const summary = preview
    ? `<span class="codesys-ai-live-sep" aria-hidden="true"></span><span class="codesys-ai-live-summary" data-streaming="1">${escapeHtml(preview)}</span>`
    : '';
  return `<div class="codesys-ai-live" data-activity="thinking"${preview ? ' data-preview="1"' : ''} aria-live="off"><button class="codesys-ai-live-row" type="button" data-ai-live-toggle="1" aria-expanded="${open}" aria-controls="codesys-ai-live-body" title="思考 · 点击${open ? '收起' : '展开'}细节">${running}${leading}<span class="codesys-ai-live-title">思考</span>${summary}</button><div class="codesys-ai-live-body" id="codesys-ai-live-body"${open ? '' : ' hidden'}>${escapeHtml(text)}</div></div>`;
}

// ── T185：抽屉里的**待回答**（用户报「原会话有一个待回答，但抽屉不显示，于是一直卡住」） ─────────
//
// 数据侧（见 `plugins/installed/taskhive-surfaces/dsh/src/78-codesys-ai-chat.js` 的 T185 段）已经
// 把 DSH 里那条悬而未决的 `ask_user_question` 规范化成**纯数据**回传：
//   `pendingInteraction = { kind, key, sessionId, label, compactLabel, questions, answerable,
//                           notAnswerableReason }`
// 这里只做两件事，且**一个字都不新造**：
//   ① 把状态与**问题原文**画出来 —— 用户说的"待回答"就是 DSH 侧栏会话行上那四个字
//      （`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1410` 的 `status.compact.answer`），
//      完整那句是 `status.waitingAnswer` = "等待回答"（`:1394-1411`）；两个词条都由数据桥原样带回，
//      这里只是照抄。**绝不允许**出现"什么都不显示地卡住"。
//   ② 让用户**就地回答**：选项按钮 + 自定义输入 + 一枚「提交回答」。选项与问题的形状就是
//      `ask_user_question` 的 schema（`options:[{label,description}]` / `multiSelect`），
//      提交出去的值是 DSH 自己的 `{ answers:[{id,selected,custom?}] }`。
//
// ⚠️ 安全（本轮最硬的一条）：**提交只可能由那枚按钮的点击触发**。`codesysAiChatApplySnapshot()`
// 只读地画这一段（连草稿都不写），轮询也不会碰作答通道；数据桥把 `kind === 'approval'`（权限审批）
// 直接判成不可作答，所以抽屉**永远**不会替用户批准任何东西。
const CODESYS_AI_PENDING_HOME_ACTION = '在主页会话里回答';

// 用户在这个抽屉里"正在填"的草稿。按问题 id 存，跨重画保留（消息区每几百毫秒可能整体重画，
// 草稿要是跟着重画丢掉，"填到一半被擦掉"就是下一个报障）。**它只是草稿** —— 没有点击就没有答案。
function codesysAiChatAnswerDraft(questionId) {
  const id = String(questionId || '');
  const store = state.codesysAiChatAnswers || (state.codesysAiChatAnswers = {});
  const current = store[id];
  if (current && Array.isArray(current.selected)) return current;
  const draft = { selected: [], custom: '' };
  store[id] = draft;
  return draft;
}

// 一段草稿的"内容签名"，进消息流的整体签名（见 `codesysAiChatApplySnapshot`）：勾选项或敲进去的
// 字变了就必须重画，否则用户点了选项、界面却停在旧的高亮上。
function codesysAiChatAnswerDraftSignature(pending) {
  const questions = Array.isArray(pending?.questions) ? pending.questions : [];
  return questions.map((question) => {
    const draft = state.codesysAiChatAnswers?.[question.id];
    if (!draft) return `${question.id}:`;
    // 分隔符写明成转义（不用空串）：`['ab']` 与 `['a','b']` 的签名必须不同，
    // 否则"改成两项"这一类改动不会触发重画。
    return `${question.id}:${(draft.selected || []).join('\u0001')}:${String(draft.custom || '').length}`;
  }).join('|');
}

// 一个问题里一枚选项按钮。`role` 跟着 `multiSelect` 走（单选=radio、多选=checkbox），
// 所以读屏拿到的语义与 DSH 自己的 `QuestionFlow`（`dsh-client-ui-user-questions/lib/client.js:654-676`）
// 一致；`title` 里是 asker 写的 `description`（那是它的自然位置，不额外占行）。
function codesysAiChatAnswerOptionMarkup(question, option) {
  const on = codesysAiChatAnswerDraft(question.id).selected.includes(option.label);
  const role = question.multiSelect === true ? 'checkbox' : 'radio';
  const description = String(option.description || '');
  return `<button class="codesys-ai-answer-option" type="button" role="${role}" aria-checked="${on ? 'true' : 'false'}" data-ai-answer-option="${escapeHtml(question.id)}" data-ai-answer-label="${escapeHtml(option.label)}"${description ? ` title="${escapeHtml(description)}"` : ''}>${escapeHtml(option.label)}</button>`;
}

// 一个问题的整段：可选标题 + 问题原文 + 选项 + 自定义输入。
// 问题原文走 `codesysAiChatTextMarkup()`（与消息正文同一套渲染：纯文本先转义，再套代码块/内联码），
// 所以 AI 写在问题里的 ``` 代码块在这边也读得出来 —— 与主界面 composer 里看到的是同一份内容。
function codesysAiChatAnswerQuestionMarkup(question) {
  const draft = codesysAiChatAnswerDraft(question.id);
  const label = String(question.header || '').trim() || question.question || question.id;
  const head = question.header ? `<div class="codesys-ai-pending-head">${escapeHtml(question.header)}</div>` : '';
  const options = (question.options || []).map((option) => codesysAiChatAnswerOptionMarkup(question, option)).join('');
  // 没有选项时**不**画一个空容器（空容器会在窄抽屉里占一行高度，还会让人以为"没得选"是坏了）。
  const optionBox = options ? `<div class="codesys-ai-pending-options" role="${question.multiSelect === true ? 'group' : 'radiogroup'}" aria-label="${escapeHtml(label)}">${options}</div>` : '';
  return `<div class="codesys-ai-pending-question" data-ai-answer-question="${escapeHtml(question.id)}">${head}<div class="codesys-ai-pending-text">${codesysAiChatTextMarkup(question.question)}</div>${optionBox}<input class="codesys-ai-answer-custom" type="text" data-ai-answer-custom="${escapeHtml(question.id)}" value="${escapeHtml(draft.custom || '')}" placeholder="${options ? '或直接输入答案' : '输入答案'}" aria-label="问题「${escapeHtml(label)}」的自定义答案"></div>`;
}

// 待回答那一整段。三种形态由**数据**决定，不是这里猜的：
//   * `answerable === true`  → 状态行 + 问题（可交互）+ 提交按钮；
//   * `answerable !== true`  → 状态行 + 问题原文（**只读**）+ 一句可读原因 + 「在主页会话里回答」。
//     审批（`approval`）走的就是这一支：抽屉只提示、不给任何可提交的按钮；
//   * 一次提交失败的原因（`codesysAiChatAnswerBlocked`）画在同一段的脚注行里 —— 失败必须可见。
function codesysAiChatPendingMarkup(pending) {
  if (!pending || typeof pending !== 'object') return '';
  const questions = Array.isArray(pending.questions) ? pending.questions : [];
  const answerable = pending.answerable === true;
  const label = String(pending.label || '等待回答');
  const compact = String(pending.compactLabel || label);
  const bodies = questions.length
    ? questions.map((question) => (answerable
      ? codesysAiChatAnswerQuestionMarkup(question)
      // 只读形态：同一份问题原文照画（用户至少能读到问的是什么），但**没有任何**可提交的控件。
      : `<div class="codesys-ai-pending-question" data-ai-answer-question="${escapeHtml(question.id)}">${question.header ? `<div class="codesys-ai-pending-head">${escapeHtml(question.header)}</div>` : ''}<div class="codesys-ai-pending-text">${codesysAiChatTextMarkup(question.question)}</div></div>`)).join('')
    : '';
  const reason = answerable ? '' : String(pending.notAnswerableReason || '这条待回答的请求不能在这个抽屉里作答：请在主页会话里处理。');
  const blocked = String(state.codesysAiChatAnswerBlocked || '');
  const busy = state.codesysAiChatAnswerBusy === true;
  const foot = answerable
    ? `<div class="codesys-ai-pending-foot"><div class="codesys-ai-pending-note" role="status" title="${escapeHtml(blocked)}">${escapeHtml(blocked)}</div><button class="codesys-ai-answer-submit" type="button" data-ai-answer-submit="1"${busy ? ' disabled' : ''}>${busy ? '提交中…' : '提交回答'}</button></div>`
    : `<div class="codesys-ai-pending-foot"><div class="codesys-ai-pending-note" role="status" title="${escapeHtml(reason)}">${escapeHtml(reason)}</div><button class="codesys-ai-answer-home" type="button" data-ai-answer-open-home="1" title="切到主页的 DSH 会话，在那条提问上作答">${CODESYS_AI_PENDING_HOME_ACTION}</button></div>`;
  // `role="group"` + `aria-label` 用的是 DSH 自己那句完整状态词（`status.waitingAnswer`），
  // 视觉上那四个字是 `compactLabel`（= `status.compact.answer`）。两处都不是新文案。
  return `<div class="codesys-ai-pending" data-ai-pending-key="${escapeHtml(String(pending.key || ''))}" role="group" aria-label="${escapeHtml(label)}"><div class="codesys-ai-pending-strip"><span class="codesys-ai-pending-dot" aria-hidden="true"></span><span class="codesys-ai-pending-label">${escapeHtml(compact)}</span><span class="codesys-ai-pending-count">${questions.length > 1 ? `${questions.length} 个问题` : ''}</span></div>${bodies}${foot}</div>`;
}

// ── A 段：工作台能力面画进消息流（差异原文 / 「确认写入工程」 / 编译结果） ─────────────────────
//
// 用户原话：「AI 对话只是调用工作台的能力，不是转到工作台操作，代码输出等都应该出现在 AI 输出框，
// 确认写入等应该为对话输出框提示」。所以这一族节点全部落在**消息流里**（`#codesys-ai-thread`），
// 与消息、进行中那一行、"待回答"那一段同一处，不再要求用户去工作台看差异、去工作台点确认。
//
// 数据来源只有一个：快照里的 `capabilities`（工作台 `50-codesys-workbench.js` 发布的只读投影）。
// 口径与工作台的差异视图**一致**：同一个 `codesysChangedLineNumbers()` 算"哪几行变了"，
// 再把那些行的前后文本各带一份（`50-*.js` 的 `codesysCapabilitySection`）。这里只做显示，一个字都不改。

// 一条改动里的某一段（声明 / 实现）：`- 行号 | 旧文本` / `+ 行号 | 新文本`。
// 新增对象（create-*）只有 `+` 行 —— 与工作台里"待新增"的样子一致。
function codesysAiChatPatchMarkup(section) {
  if (!section) return '';
  const lines = Array.isArray(section.lines) ? section.lines : [];
  if (!lines.length) return '';
  const body = lines.map((row) => {
    const marker = row?.kind === '-' ? '-' : '+';
    return `<span class="codesys-ai-patch-line" data-ai-patch-kind="${marker}">${marker} ${escapeHtml(String(Number(row?.line) || 0))} | ${escapeHtml(String(row?.text === undefined || row?.text === null ? '' : row.text))}</span>`;
  }).join('\n');
  const more = section.truncated === true ? `\n<span class="codesys-ai-patch-more">…还有改动行没有列出（工作台里有完整差异）</span>` : '';
  return `${body}${more}`;
}

// 一个对象一段：对象名 + 操作 + 声明/实现两段的差异原文。
const CODESYS_AI_OPERATION_LABEL = { 'create-pou': '新增 POU', 'create-gvl': '新增 GVL', 'create-dut': '新增 DUT', 'update-text': '修改代码' };

function codesysAiChatProposalChangeMarkup(change) {
  if (!change || typeof change !== 'object') return '';
  const name = String(change.objectName || '(未命名对象)');
  const operation = String(change.operation || 'update-text');
  const label = CODESYS_AI_OPERATION_LABEL[operation] || operation;
  const sections = [
    change.declaration ? `<div class="codesys-ai-proposal-section"><span class="codesys-ai-proposal-section-name">声明</span><pre class="codesys-ai-proposal-patch">${codesysAiChatPatchMarkup(change.declaration)}</pre></div>` : '',
    change.implementation ? `<div class="codesys-ai-proposal-section"><span class="codesys-ai-proposal-section-name">实现</span><pre class="codesys-ai-proposal-patch">${codesysAiChatPatchMarkup(change.implementation)}</pre></div>` : '',
  ].join('');
  return `<div class="codesys-ai-proposal-object" data-ai-proposal-object="${escapeHtml(name)}" data-ai-proposal-operation="${escapeHtml(operation)}"><div class="codesys-ai-proposal-object-head"><span class="codesys-ai-proposal-object-name">${escapeHtml(name)}</span><span class="codesys-ai-proposal-object-op">${escapeHtml(label)}${change.exists === true ? '' : ' · 工程里还没有'}</span></div>${sections}</div>`;
}

// 编译结果那一段（进度 / 终态 / 诊断）。`state` 是工作台自己写的那些状态词，这里只翻译成一句话：
//   writing    —— 正在写入工程（创建恢复快照 + 落盘，可能 30 秒以上）
//   running    —— 已落盘，后台离线编译中
//   done       —— 编译完成（错误/警告计数 + 有内容时的诊断列表）
//   failed     —— 编译失败（可读原因）
//   unavailable—— 拿不到后台编译结果（引擎丢了作业等），不假装通过
const CODESYS_AI_BUILD_HEADLINE = {
  writing: (state) => `正在写入工程${Number(state.written || 0) ? ` · ${Number(state.written)} 个对象` : ''}（创建恢复快照 → 写入 → 提交回源工程）…`,
  running: (state) => `已写入 ${Number(state.written || 0)} 个对象并提交回源工程 · 后台离线编译中，结果自动回报…`,
  done: (state) => {
    const duration = Number(state.durationMs || 0) ? `（${(Number(state.durationMs) / 1000).toFixed(1)} 秒）` : '';
    // 计数口径：工作台（`compileCountLabel`，唯一定义处）把数字一起投影过来 —— 头部只有错误与
    // 警告两个数（`未知` 原样照印），口径说明与"汇总 / 明细差几条"留在工作台抽屉里，这里只照印，
    // 并且**不再显示**「信息 N」这一档（用户口径："我只看编译结果"）。
    // 没有那两个数字时退回计数值，但 `null/undefined` 是"未知"而**不是 0**（T200）。
    const countLabel = (label, value) => {
      const text = String(label ?? '');
      if (text) return text;
      if (value === null || value === undefined || value === '') return '未知';
      const number = Number(value);
      return Number.isFinite(number) ? String(number) : '未知';
    };
    return `离线编译完成${duration} · 错误 ${countLabel(state.errorLabel, state.errorCount)} · 警告 ${countLabel(state.warningLabel, state.warningCount)}`;
  },
  failed: (state) => `编译失败：${String(state.error || '后台编译失败')}`,
  unavailable: (state) => `拿不到后台编译结果：${String(state.error || '引擎没有回报状态')} · 可点工作台的「编译」重来一次`,
};

function codesysAiChatBuildMarkup(build) {
  if (!build || typeof build !== 'object') return '';
  const state = String(build.state || 'idle');
  const headline = CODESYS_AI_BUILD_HEADLINE[state];
  // `idle` = 没有可说的（成功且无诊断时这一整段就**不存在**，不占一行）。
  if (!headline) return '';
  const messages = Array.isArray(build.messages) ? build.messages : [];
  const omitted = Number(build.omitted || 0);
  const severityRank = { error: 0, warning: 1, info: 2 };
  const ordered = [...messages].sort((left, right) => (severityRank[String(left?.severity || 'info')] ?? 3) - (severityRank[String(right?.severity || 'info')] ?? 3));
  // 诊断只在**真有内容**时列出来（错误/警告优先，最多 12 条）；成功且干净时只有那一行结论。
  const list = ordered.slice(0, 12).map((item) => `<span class="codesys-ai-build-line" data-ai-build-severity="${escapeHtml(String(item?.severity || 'info'))}">[${escapeHtml(String(item?.severity || 'info'))}] ${escapeHtml(String(item?.text || ''))}</span>`).join('\n');
  const more = (ordered.length > 12 || omitted) ? `\n<span class="codesys-ai-build-more">…还有 ${Math.max(0, ordered.length - 12) + omitted} 条诊断没有列出（工作台里有完整编译输出）</span>` : '';
  const body = list ? `<pre class="codesys-ai-build-messages">${list}${more}</pre>` : '';
  return `<div class="codesys-ai-build" data-ai-build-state="${escapeHtml(state)}" role="status"><div class="codesys-ai-build-head">${escapeHtml(headline(build))}</div>${body}</div>`;
}

// 提案那一段 + 「确认写入工程」。**写入只能由这里那枚按钮的点击发起**（见 `codesysAiChatConfirmWrite`）：
//   * 闸门由工作台的数据决定（`gate`：可写 / 已绑定 / 没有校验错误 / 不在忙），不满足时按钮禁用，
//     并把工作台给的原因原样画在按钮左边（用户不需要猜为什么点不动）；
//   * sha 防护挡下之后（T170 三态里的后两态）多出**第二枚**按钮「我已确认，继续写入」——
//     同样必须用户点一次，`overwriteConfirmed` 绝不自动带上；
//   * 失败 / 被挡下的原因画在这一段的脚注行里（`codesysAiChatWriteBlocked`），成功一个字都不写。
function codesysAiChatProposalMarkup(capabilities) {
  const proposal = capabilities && typeof capabilities === 'object' ? capabilities.proposal : null;
  if (!proposal || typeof proposal !== 'object') return '';
  const gate = capabilities.gate && typeof capabilities.gate === 'object' ? capabilities.gate : {};
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  const signature = String(proposal.signature || '');
  const blocked = String(state.codesysAiChatWriteBlocked || '');
  const busy = state.codesysAiChatWriteBusy === true;
  const overrideOffered = state.codesysAiChatWriteOverride === true && String(state.codesysAiChatWriteSignature || '') === signature;
  // 与工作台那枚按钮同一条闸门（差额只有"逐项审查"那一项：差异原文就在这段里，那一次点击就是审查）。
  // 本轮 B 项（冻结）：闸门多了一条 `onlineWriteFrozen` —— 已登录到应用时工作台编辑栏只读，
  // 这枚「确认写入工程」也必须**禁用**（原因 + 出路由 blockReason 带过来，见 title）。
  const ready = gate.busy !== true && gate.onlineWriteFrozen !== true && gate.writeAvailable === true && String(gate.jobId || '') !== '' && changes.length > 0 && !(Array.isArray(gate.errors) && gate.errors.length);
  const reason = ready ? '' : (String(capabilities.blockReason || '') || (gate.onlineWriteFrozen === true ? String(gate.frozenDetail || '') : '') || '当前提案不可写入');
  const source = String(proposal.source || '');
  const sourceLabel = source === 'workbench' ? ' · 来自代码任务' : (source === 'chat' ? ' · 来自对话' : '');
  const objects = changes.map((change) => codesysAiChatProposalChangeMarkup(change)).join('');
  const omitted = Number(proposal.omittedChanges || 0);
  const omittedLine = omitted ? `<div class="codesys-ai-proposal-more">…还有 ${omitted} 个对象没有列出（工作台里有完整差异）</div>` : '';
  const summary = String(proposal.summary || '').trim();
  const errors = Array.isArray(gate.errors) ? gate.errors.filter(Boolean) : [];
  const errorBlock = errors.length ? `<div class="codesys-ai-proposal-error" role="alert">${escapeHtml(errors.join('\n'))}</div>` : '';
  const overrideButton = overrideOffered
    ? `<button class="codesys-ai-write-override" type="button" data-ai-confirm-write-override="1"${busy ? ' disabled' : ''} title="工程在外部被改过（或无法确认没被改过）：这一枚按钮表示覆盖刚才那次阻止">我已确认，继续写入</button>`
    : '';
  // 「确认写入工程」是**唯一**会调用 `codesysAiChatApply` 的控件（另一枚只在 sha 防护挡下后才出现）。
  const confirm = `<button class="codesys-ai-write-confirm" type="button" data-ai-confirm-write="1"${busy || !ready ? ' disabled' : ''} title="${escapeHtml(reason || '创建恢复快照后写入当前工程并执行离线编译')}">${busy ? '写入中…' : '确认写入工程'}</button>`;
  // 本轮：**放弃**（用户原话「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」）。
  // 就排在「确认写入工程」左边、同一行里，但**不受写入闸门约束**：放弃只减少待写入内容
  // （提案 + 手写草稿）并让编辑器退回磁盘上的最新版本，一个字节都不写工程 —— 所以工程不可写时
  // 它照样可用（只读工程里也常常有一份想丢掉的提案），只有"工作台正忙 / 上一次放弃还在途"才禁用。
  // 没有待放弃内容时这一段本身就不存在，因此这枚按钮也不会出现（与工作台那枚同一条口径）。
  // 范围写在 title 里：放弃**包含**工作台里的手写改动，且会回到磁盘上的最新版本。
  const discardBusy = state.codesysAiChatDiscardBusy === true;
  const discard = `<button class="codesys-ai-write-discard" type="button" data-ai-discard-proposal="1"${busy || discardBusy ? ' disabled' : ''} title="${escapeHtml(busy || discardBusy ? '工作台正在执行另一项操作：等它结束再放弃' : '放弃当前提案与工作台里的手写改动，回到磁盘上的最新版本')}">${discardBusy ? '放弃中…' : '放弃'}</button>`;
  return `<div class="codesys-ai-proposal" data-ai-proposal="1" data-ai-proposal-signature="${escapeHtml(signature)}" role="group" aria-label="待确认的工程改动">`
    + `<div class="codesys-ai-proposal-strip"><span class="codesys-ai-proposal-dot" aria-hidden="true"></span><span class="codesys-ai-proposal-label">待确认改动</span><span class="codesys-ai-proposal-count">${changes.length ? `${changes.length} 个对象${sourceLabel}` : ''}</span></div>`
    + (summary ? `<div class="codesys-ai-proposal-summary">${escapeHtml(summary)}</div>` : '')
    + objects + omittedLine + errorBlock
    + `<div class="codesys-ai-proposal-foot"><div class="codesys-ai-proposal-note" role="status" title="${escapeHtml(blocked || reason)}">${escapeHtml(blocked || reason)}</div>${overrideButton}${discard}${confirm}</div>`
    + '</div>';
}

// T192：**写入成功之后**那一段。用户报障原话：「测试程序虽然写进去了，但是我每次都要重新启动
// codesys 程序才会看到」。机制已确认：写入走离线隔离作业（`--noUI` ScriptEngine）改磁盘上的
// `.project`，而用户眼前那个 GUI 早把工程读进内存、不会察觉文件被外部改。
//
// 调研结论（三处本机原文证据，见 `codesys-native-host.js` 的 `reloadProject` 注释）：
// CODESYS V3.5 **没有**任何可编程的重载入口 —— 脚本 API 没有 reload、全量菜单定义（709 条）里
// File/Project 都没有"重新加载工程"、二进制里也没有这样的命令标题。所以这里**不假装自动重载**：
//   * 只画一行"为什么不能自动"（就在按钮旁边），和一枚按钮；
//   * 按钮点一次 = 让主进程去读那个 CODESYS 窗口的**原生菜单栏**，只有标题精确命中白名单才发一次
//     WM_COMMAND；没有入口就把**具体原因 + 最短步骤**写成一行回来；
//   * 不点就什么都不会发生（没有轮询、没有定时器、没有自动调用）。
function codesysAiChatReloadMarkup() {
  const reload = state.codesysAiChatReload;
  if (!reload || typeof reload !== 'object') return '';
  const busy = reload.state === 'busy';
  const written = Number(reload.written || 0);
  const detail = String(reload.detail || '');
  const outcome = reload.state === 'ok' || reload.state === 'failed'
    ? `<div class="codesys-ai-proposal-summary" role="status">${escapeHtml(detail)}</div>`
    : '';
  const whyNotAutomatic = '运行中的 CODESYS 把工程读在内存里、不会自己读盘，而 CODESYS 3.5 没有可编程的重载入口：只能点这一下让它自己重载。';
  return '<div class="codesys-ai-proposal" data-ai-reload="1" role="group" aria-label="写入后让 CODESYS 重新加载">'
    + '<div class="codesys-ai-proposal-strip"><span class="codesys-ai-proposal-dot" aria-hidden="true"></span><span class="codesys-ai-proposal-label">已写入工程</span>'
    + `<span class="codesys-ai-proposal-count">${written ? `${written} 个对象 · 已提交回源工程` : '已提交回源工程'}</span></div>`
    + outcome
    + `<div class="codesys-ai-proposal-foot"><div class="codesys-ai-proposal-note" title="${escapeHtml(whyNotAutomatic)}">${escapeHtml(whyNotAutomatic)}</div>`
    + `<button class="codesys-ai-write-confirm" type="button" data-ai-reload-project="1"${busy ? ' disabled' : ''} title="让运行中的 CODESYS 自己重载一次；没有入口时会给出原因与最短步骤">${busy ? '正在让 CODESYS 重新加载…' : '让 CODESYS 重新加载'}</button></div>`
    + '</div>';
}

// ⚠️ 这是整个渲染层里**唯一**会走到 `codesysNativeHostReloadProject` 的落点（那枚按钮的点击）。
// 幂等：`busy` 时直接返回（连点不会叠出第二次 IPC）；不阻塞界面（await 一次 IPC，按钮就地转文字）；
// 失败可见：任何非 ok 的结果都把 `detail`（含"已扫过 N 项"这类事实）写进上面那一行。
async function codesysAiChatReloadProject() {
  if (state.codesysAiChatReload?.state === 'busy') return;
  // `signature` / `written` 必须一路保留：前者是"这一段属于哪一份提案"的判据（丢了它，一次带着
  // 同一份提案的陈旧轮询就会把这一段擦掉），后者是标题条上那个事实。
  const base = { written: Number(state.codesysAiChatReload?.written || 0), signature: String(state.codesysAiChatReload?.signature || '') };
  state.codesysAiChatReload = { ...base, state: 'busy', detail: '' };
  codesysAiChatRepaint();
  try {
    const result = await window.taskhive.codesysNativeHostReloadProject();
    const ok = result && result.ok === true;
    state.codesysAiChatReload = {
      ...base,
      state: ok ? 'ok' : 'failed',
      detail: String(result?.detail || (ok ? '已让 CODESYS 重新加载。' : '没有可用的重载入口。')),
    };
  } catch (error) {
    state.codesysAiChatReload = { ...base, state: 'failed', detail: `让 CODESYS 重新加载失败（IPC codesys:native-host-reload-project）：${error.message}` };
  } finally {
    codesysAiChatRepaint();
  }
}

// 拿"上一次成功应用的那份快照"重画一次。草稿一变（勾选项 / 敲字）就调它 —— 不额外再造一条
// 渲染路径：签名里带着草稿，所以 `codesysAiChatApplySnapshot()` 自然会重画这一整块。
function codesysAiChatRepaint() {  const last = state.codesysAiChatLastResult;
  if (last) codesysAiChatApplySnapshot(last);
}

// **用户点击「提交回答」之后**才会走到这里（这是本轮唯一向 `codesys:ai-chat-answer` 发 IPC 的地方）。
// 本地先挡一道"漏答"（DSH 侧还会再挡一次，两边给出同一句话），然后把草稿编码成 DSH 自己的答案
// 形状交出去。任何失败都写进这一段的脚注行 —— 可读，且不静默。
async function codesysAiChatSubmitAnswer() {
  const pending = state.codesysAiChatPending;
  if (!pending || pending.answerable !== true) return;
  if (state.codesysAiChatAnswerBusy === true) return;
  const answers = [];
  for (const question of Array.isArray(pending.questions) ? pending.questions : []) {
    const draft = codesysAiChatAnswerDraft(question.id);
    const custom = String(draft.custom || '').trim();
    if (!draft.selected.length && !custom) {
      const label = String(question.header || '').trim() || question.question || question.id;
      state.codesysAiChatAnswerBlocked = `问题「${label}」还没有作答：请选择一个选项或填写自定义答案。`;
      codesysAiChatRepaint();
      return;
    }
    answers.push({ id: question.id, selected: draft.selected.slice(), ...(custom ? { custom } : {}) });
  }
  state.codesysAiChatAnswerBusy = true;
  state.codesysAiChatAnswerBlocked = '';
  codesysAiChatRepaint();
  try {
    const result = await window.taskhive.codesysAiChatAnswer({ key: String(pending.key || ''), answers });
    if (result && result.ok === true) {
      // 成功**不写提示**：提问那一段会随下一次快照整段消失，AI 接下来说的话就是最好的确认。
      // 刷新的那一次 IPC 交给 `finally`（成功与失败都要拉一次快照，这里不再拉第二遍）。
      state.codesysAiChatAnswers = {};
      state.codesysAiChatAnswerBlocked = '';
      return;
    }
    state.codesysAiChatAnswerBlocked = `提交回答失败：${codesysAiChatReasonText(result)}`;
  } catch (error) {
    state.codesysAiChatAnswerBlocked = `提交回答失败（IPC codesys:ai-chat-answer）：${error.message}`;
  } finally {
    state.codesysAiChatAnswerBusy = false;
    // 失败之后也拉一次快照：`no-pending` / `stale-pending` 这两类失败的真实状态就在下一次快照里
    // （问题已经换了、或者已经在主页答掉了），只写一句话会让界面停在过期的那一段上。
    await codesysAiChatPullSnapshot().catch(() => null);
    codesysAiChatRepaint();
  }
}

// ── A 段：**确认写入工程**（这是本文件里唯一一处调用 `codesysAiChatApply` 的地方） ──────────────
//
// 安全语义（三条都是可执行的，不是注释）：
//   * **只有用户点击**会走到这里：唯一的调用点是 `#codesys-ai-thread` 上那条事件委托里
//     `[data-ai-confirm-write]` / `[data-ai-confirm-write-override]` 两个分支，而这两个节点只由
//     `codesysAiChatProposalMarkup()` 画出来。轮询（1.5 秒 / 运行态 600ms）**只读快照**，从不调它；
//   * **不越权**：带上的是快照原样回报的 `proposalSignature`（提案一换就成了 stale-proposal，被挡下）
//     和这一次点击的语义（`overwriteConfirmed` 只由第二枚按钮带 `true`）；
//   * **失败必须可见**：任何非 ok 的结果都把可读原因写进这一段的脚注行，绝不静默。
async function codesysAiChatConfirmWrite(overwriteConfirmed) {
  const capabilities = state.codesysAiChatCapabilities;
  const proposal = capabilities && typeof capabilities === 'object' ? capabilities.proposal : null;
  if (!proposal || typeof proposal !== 'object') return;
  if (state.codesysAiChatWriteBusy === true) return;
  state.codesysAiChatWriteBusy = true;
  state.codesysAiChatWriteBlocked = '';
  codesysAiChatRepaint();
  try {
    const result = await window.taskhive.codesysAiChatApply({
      sessionId: String(capabilities.sessionId || ''),
      proposalSignature: String(proposal.signature || ''),
      overwriteConfirmed: overwriteConfirmed === true,
    });
    if (result && result.ok === true) {
      // 成功**不写状态栏提示**（差异随下一次快照消失，接着由编译那一段说话），但 T192 起要在消息流里
      // 留下**一段**事实 + 一枚按钮：写入只改了磁盘上的 .project，运行中的 CODESYS 不会自己读盘。
      // 这一行不是"成功提示"，是"下一步在哪" —— 用户报障就是卡在这里（每次都要重启 CODESYS）。
      state.codesysAiChatWriteOverride = false;
      state.codesysAiChatWriteSignature = '';
      // `signature` 记下"这次写入属于哪一份提案"：写完之后工作台的提案要等它下一次发布才会消失，
      // 中间那一两次轮询可能**还带着同一份提案**回来（那一段会重画）。如果按"有提案就清"处理，
      // 用户刚得到的按钮会被一次陈旧轮询擦掉 —— 所以只有**换了另一份提案**才撤掉这一段。
      state.codesysAiChatReload = { state: 'idle', detail: '', written: Number(result.written || 0), signature: String(proposal.signature || '') };
      return;
    }
    state.codesysAiChatWriteOverride = result?.needsOverwriteConfirmation === true;
    state.codesysAiChatWriteSignature = String(proposal.signature || '');
    state.codesysAiChatWriteBlocked = result?.needsOverwriteConfirmation === true
      ? `已阻止写入：${String(result.detail || '无法确认工程未被外部修改')}`
      : `写入失败：${codesysAiChatReasonText(result)}`;
  } catch (error) {
    state.codesysAiChatWriteOverride = false;
    state.codesysAiChatWriteSignature = String(proposal.signature || '');
    state.codesysAiChatWriteBlocked = `写入失败（IPC codesys:ai-chat-apply）：${error.message}`;
  } finally {
    state.codesysAiChatWriteBusy = false;
    // 不管成功还是失败都拉一次快照：成功之后差异消失、编译那一段接上；失败之后真实状态也在快照里。
    await codesysAiChatPullSnapshot().catch(() => null);
    codesysAiChatRepaint();
  }
}

// ── 本轮：**放弃**（「确认写入工程」旁边那一枚）────────────────────────────────────────────────
//
// 用户原话：「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」。语义 = 作废**当前 AI 提案**
// 并且作废**用户在编辑器里手打、还没写入的改动**，编辑器退回磁盘上的最新版本，回到"等待 AI 改动"的空态。
//
// 数据流（**不新增任何 IPC 通道、不写工程**）：外壳 → 一条 postMessage 进 DSH 那个 Harness 框架
// （`codesys.task` 走的就是这条既有通路）→ 数据桥 shard 78 的 `codesys.proposal.discard` →
// 工作台能力面的 `discard()` → 工作台那枚「放弃」按钮调的**同一个** `discardProposal()`。
// 结果由 DSH 用 `codesys.proposal.discarded` 回信（下面 `codesysAiChatDiscardSettled`）。
//
// ⚠️ 这里**没有**任何 `codesysAiChatApply` / `codesys:ai-chat-*` 写入通道的调用点：放弃只会减少
// 待写入内容，能不能放弃、丢了多少处手写，全部由工作台自己判定并报回来。
function codesysAiChatHarnessFrame() {
  // 首选 `ensureShell()` 记下的那个 iframe；取不到就按**同一个 title** 在文档里再查一次 ——
  // 两个入口指向同一个节点（真实 DOM 里 `#surface` 就在 document 里），所以这不是第二条通路。
  if (harnessFrame?.contentWindow) return harnessFrame;
  try { return document.querySelector('iframe[title*="Harness"]') || null; } catch { return null; }
}

function codesysAiChatDiscardProposal() {
  const capabilities = state.codesysAiChatCapabilities;
  const proposal = capabilities && typeof capabilities === 'object' ? capabilities.proposal : null;
  // 本轮（用户原话「点击放弃没有反映」）：这两条以前都是**裸 `return`** —— 用户点下去之后
  // 界面上一个字都不变，看起来就是按钮坏了。现在两种都写一行可读原因（落在消息流尾部，
  // 与其它失败同一处）。"没有待放弃的提案"照实说，不谎称失败、也不装作做了什么。
  if (!proposal || typeof proposal !== 'object') {
    codesysAiChatSetStatus('放弃没有生效：快照里已经没有待放弃的提案了（可能刚刚已被放弃，或工作台还没把提案同步过来）：请先看一眼工作台里的当前差异');
    return;
  }
  // 幂等：写入在途、或上一次放弃还在途时直接返回（连点不会叠出第二条消息）。
  // 但"直接返回"也必须让用户看得见 —— 否则这一下点击就是全静默的。
  if (state.codesysAiChatWriteBusy === true || state.codesysAiChatDiscardBusy === true) {
    codesysAiChatSetStatus(state.codesysAiChatWriteBusy === true
      ? '放弃没有生效：工作台正在写入（「确认写入工程」还没结束）：等它结束之后再点一次「放弃」'
      : '放弃没有生效：上一次「放弃」还在途、工作台还没有回信：等它结束或稍后再点一次');
    return;
  }
  const frame = codesysAiChatHarnessFrame();
  if (!frame?.contentWindow || typeof frame.contentWindow.postMessage !== 'function') {
    // 失败必须可见、可读、具体（不静默）：说清是"找不到工作台窗口"以及最短下一步。
    codesysAiChatSetStatus('放弃失败：面板里找不到 DSH 工作台窗口（它还没挂起来）：请先点面板上的「代码任务」或「AI 对话」把工作台挂上，再点一次「放弃」');
    return;
  }
  const nonce = `discard-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  state.codesysAiChatDiscardBusy = true;
  state.codesysAiChatDiscardSignature = String(proposal.signature || '');
  // 手写处数取自**快照原样带回**的值（工作台的 `countUnsavedDrafts()`，与 T166 守卫同一个判据）。
  state.codesysAiChatDiscardCount = Math.max(0, Number(capabilities.draftCount || 0));
  state.codesysAiChatDiscardAt = Date.now();
  state.codesysAiChatDiscardNonce = nonce;
  codesysAiChatRepaint();
  try {
    frame.contentWindow.postMessage({
      source: 'taskhive-desktop',
      type: 'codesys.proposal.discard',
      nonce,
      sessionId: String(capabilities.sessionId || ''),
      proposalSignature: String(proposal.signature || ''),
    }, '*');
  } catch (error) {
    state.codesysAiChatDiscardBusy = false;
    codesysAiChatSetStatus(`放弃失败：无法把这条请求交给 DSH 工作台（${error.message}）`);
    codesysAiChatRepaint();
  }
}

// 工作台把结果回信（shard 78 的 `codesys.proposal.discarded`）。**一行说清丢了什么**：
// 有手写 ⇒ `已放弃此提案与 N 处手写改动`；无手写 ⇒ `已放弃此提案`（绝不静默丢用户的字）。
// 失败同样只写一行可读原因。收尾后拉一次**只读**快照：那一段随之消失，回到"等待 AI 改动"的空态。
function codesysAiChatDiscardSettled(payload) {
  if (state.codesysAiChatDiscardBusy !== true) return;
  if (String(payload?.nonce || '') !== String(state.codesysAiChatDiscardNonce || '')) return;
  state.codesysAiChatDiscardBusy = false;
  const dropped = Math.max(0, Number(payload?.droppedDrafts === undefined || payload?.droppedDrafts === null ? state.codesysAiChatDiscardCount : payload.droppedDrafts) || 0);
  if (payload?.ok === true) {
    codesysAiChatSetStatus(dropped > 0 ? `已放弃此提案与 ${dropped} 处手写改动` : '已放弃此提案');
    // 这一段所说的失败/覆盖确认属于刚被放弃的那份提案 —— 一起作废（与"换了一份提案就归零"同一条纪律）。
    state.codesysAiChatWriteBlocked = '';
    state.codesysAiChatWriteOverride = false;
    state.codesysAiChatWriteSignature = '';
  } else {
    codesysAiChatSetStatus(`放弃失败：${String(payload?.detail || payload?.reason || '工作台没有回报原因')}`);
  }
  codesysAiChatRepaint();
  void codesysAiChatPullSnapshot().catch(() => null);
}

// 「在主页会话里回答」：把外壳切到 DSH 的 chat 面（`selectSurface('chat')` → `renderChat()`），
// 也就是把**主页那条会话**连同它自己的 composer 摆到用户面前 —— 那是 DSH 原生、有完整作答能力的
// 地方。用的就是本项目既有的那条 postMessage 协议（`submitCodesysCodeAi` 用的同一条），不新增通道。
// 为什么审批类只能走这条退路：代用户批准权限不该由插件一键完成（见数据桥的 T185 段）。
function codesysAiChatOpenHomeAnswer() {
  window.postMessage({ source: 'taskhive-dsh', type: 'surface.open', surface: 'chat' }, '*');
}

// 用快照画消息流。**任何** ok !== true 的结果都会把具体原因写进消息流，
// 不允许出现"面板空着但什么都不说"。
function codesysAiChatApplySnapshot(result) {
  const thread = $('#codesys-ai-thread');
  // T184：标题里的会话徽章已按用户要求删除（"不要显示同一会话几条，直接隐藏"）——
  // 不再有任何 badge 节点与赋值，界面只在出问题时于消息流里说一句话。
  if (!thread) return false;
  if (!result) {
    state.codesysAiChatRunning = false;
    // T180：数据桥整个读不到。消息流里那句初始的"正在读取会话…"此时已经是一句假话
    // （它永远不会再有下文），而这一族提示又没有自己的一行状态栏了 —— 所以**只在还没读到过
    // 任何东西时**把那一句换成流尾的那一行提示（有具体原因就只留它，没有就留一句中性占位）。
    // 已经读到过内容时不碰消息流：一次瞬时失败不该把用户正在看的对话清空。
    // 比较前先把上一行提示摘掉：`SetStatus()` 可能已经把它补在占位后面了（两条路径的先后
    // 顺序都允许）。
    const body = String(thread.innerHTML || '').replace(CODESYS_AI_NOTICE_STRIP_RE, '').trim();
    if (body === '' || body === CODESYS_AI_THREAD_PLACEHOLDER) {
      thread.innerHTML = codesysAiChatNoticeMarkup() || '<div class="codesys-ai-empty">数据桥不可用</div>';
    }
    return false;
  }
  if (result.ok !== true) {
    state.codesysAiChatRunning = false;
    state.codesysAiChatReasoningOpen = false;
    const text = codesysAiChatReasonText(result);
    // T179：原因**只写一处** —— 消息区（用户正看着的地方）。
    // T180：不再往那个已经删掉的常驻状态节点写；流尾的一次性提示行也清掉，
    // 免得"读不到会话"这一句在流里出现两遍。
    // T181：这一条流里原来还带着两枚快捷项，现在**一个按钮都没有** —— 只剩原因那一行。
    codesysAiChatSetStatus('');
    thread.innerHTML = `<div class="codesys-ai-empty">${escapeHtml(text)}</div>`;
    state.codesysAiChatSignature = '';
    return false;
  }
  const messages = Array.isArray(result.messages) ? result.messages : [];
  // T184：这里原来往标题徽章写"同一会话 · N 条"，按用户要求整块删除（不显示条数、不换别的方式）。
  // 内容没变就不重画：既不打断滚动位置，也避免每 1.5 秒重建一遍 DOM。
  // T175：模型先同步 —— 它是**另一条**信息（主页只改模型、不动消息时内容签名是同一个），
  // 所以必须放在这条"内容没变就 return"的前面。
  codesysAiChatSyncModelFromSnapshot(result);
  // T231：这一帧同时给出"哪条会话"与"它**显式**选中了什么"（`snapshot.model` 是会话投影里的
  // `next`：为空就是**没设过** —— 见 shard 78 的 `codesysAiChatModelSummary`，它不掺目录默认值）。
  // 恢复上次选择**只**在这里取事实，所以：会话已有显式选择 ⇒ 一个请求都不发（不 clobber）；
  // 没有 ⇒ 静默应用一次（见 `codesysAiChatRestoreRememberedModel`）。这一步自己**不**发请求：
  // 真正会发 IPC 的只有下面那一个函数，而且每条会话最多一次。
  state.codesysAiChatSessionId = String(result.sessionId || '');
  state.codesysAiChatSessionSelection = (result.model && result.model.id)
    ? { id: String(result.model.id), reasoningEffort: String(result.model.reasoningEffort || '') }
    : null;
  void codesysAiChatRestoreRememberedModel().catch(() => null);
  // T185：**待回答**（数据桥回传的纯数据，`null` = 没有）。这一段必须先落地再算签名 ——
  // 它决定下面那一行「正在分析请求」画不画，也决定这一块的草稿要不要保留。
  // 换了另一条待回答（`key` 变了）时把草稿与上一次的失败原因一起归零，否则上一个问题的选项会
  // 高亮在新问题上（那是最容易骗到用户的一种脏状态）。
  const pending = result.pendingInteraction && typeof result.pendingInteraction === 'object' ? result.pendingInteraction : null;
  if (String(pending?.key || '') !== String(state.codesysAiChatPending?.key || '')) {
    state.codesysAiChatAnswers = {};
    state.codesysAiChatAnswerBlocked = '';
    state.codesysAiChatAnswerBusy = false;
  }
  state.codesysAiChatPending = pending;
  // A 段：**工作台能力面**（差异原文 / 写入闸门 / 编译结果；`null` = 这条会话没有可读的工作台）。
  // 换了一份提案（签名变了）时把上一次的写入失败原因与"等待覆盖确认"一起归零 —— 那句失败属于上一份
  // 提案，留在新提案上就是骗人（与 T185 换问题时清草稿同一条纪律）。
  const capabilities = result.capabilities && typeof result.capabilities === 'object' ? result.capabilities : null;
  const capabilitySignature = String(capabilities?.proposal?.signature || '');
  if (capabilitySignature !== String(state.codesysAiChatWriteSignature || '')) {
    state.codesysAiChatWriteBlocked = '';
    state.codesysAiChatWriteOverride = false;
    state.codesysAiChatWriteSignature = '';
  }
  // T192：**换了另一份提案**才把上一段「已写入工程 / 让 CODESYS 重新加载」撤掉（它属于上一次写入，
  // 留在新提案旁边就是骗人 —— 与上面清写入失败原因同一条纪律）。注意判据是"**不同**签名"而不是
  // "有签名"：写入成功后工作台的提案要等下一次发布才消失，中间一两次轮询会带着**同一份**提案回来，
  // 那一段要重画而不能被擦掉（否则用户刚得到的按钮会凭空消失）。
  if (capabilitySignature && state.codesysAiChatReload && capabilitySignature !== String(state.codesysAiChatReload.signature || '')) state.codesysAiChatReload = null;
  state.codesysAiChatCapabilities = capabilities;
  // 本轮：**放弃在途**的收尾兜底 —— 工作台那边的清状态是同步的，所以"快照里已经没有待确认提案"
  // 就证明它生效了（回信丢了也能收尾）；反过来，隔了 3 秒还挂着**同一份**签名就是没生效
  // （工作台没挂载 / 还没重载到带这条通路的版本 / 它正忙）。判据只读时间戳与快照，
  // **不新增定时器** —— 1.5 秒的轮询本身就是那个时钟。
  if (state.codesysAiChatDiscardBusy === true) {
    const pendingSignature = String(capabilities?.proposal?.signature || '');
    const sameProposal = Boolean(capabilities?.proposal) && pendingSignature === String(state.codesysAiChatDiscardSignature || '');
    if (!sameProposal) {
      const dropped = Math.max(0, Number(state.codesysAiChatDiscardCount || 0));
      state.codesysAiChatDiscardBusy = false;
      codesysAiChatSetStatus(dropped > 0 ? `已放弃此提案与 ${dropped} 处手写改动` : '已放弃此提案');
    } else if (Date.now() - Number(state.codesysAiChatDiscardAt || 0) > 3000) {
      state.codesysAiChatDiscardBusy = false;
      codesysAiChatSetStatus('放弃没有生效：工作台里这份提案还在（可能工作台没有挂载或正在忙）：请稍后再点一次「放弃」');
    }
  }
  // T183：**进行中**那一组事实（数据桥只回报事实，观感在这里）。两条判据取"或"：
  //   * `result.running` —— 会话自己的 `getSnapshot().running`（主界面会话读的同一个字段）；
  //   * `result.pending > 0` —— 刚发出去、host 的 `api-session/status` 还没到的这一小段。
  // 结束（两条都为假）时立刻把它归零：轮询节奏回到 1500ms，那一行也随下一次重画消失。
  //
  // T185：**待回答期间"正在运行"是真的，但"正在分析请求"是假的** —— 回合确实还在跑（`running` 仍为
  // true，agent 阻塞在这个提问里），所以轮询该提速照旧提速（不谎报）；但那一刻模型已经不在生成了，
  // 用户看到的必须换成"等待你的回答"那一段。所以这里只把**那一行**（以及推理全文）压掉，
  // `state.codesysAiChatRunning` 仍按事实写。
  const busy = result.running === true || Number(result.pending || 0) > 0;
  const running = busy && !pending;
  state.codesysAiChatRunning = busy;
  if (!running) state.codesysAiChatReasoningOpen = false;
  const reasoning = running && typeof result.reasoning === 'string' ? result.reasoning : '';
  // T180：流内那一行提示也算内容 —— 它变化时必须重画（否则"发送失败"会一直停在屏幕上，
  // 直到下一条消息改变签名为止）。
  const notice = String(state.codesysAiChatNotice || '');
  // T183：进行中的那两件事也进签名（否则"思考中"出现/消失时不会重画）。折叠时只按**摘要**长度
  // 比对 —— 推理正文每几百毫秒都在长，但折叠状态下屏幕上看得见的只有那一行摘要，按全文比对会
  // 造成无谓的整段重建（滚动位置也会跟着跳）；展开时按全文比对，正文照旧实时更新。
  // `hasReason` 单独进签名：它决定那一行是从「正在分析请求」换成「思考」（两种摘要都可能为空）。
  // T185：待回答那一块也进签名（它出现/消失要重画；草稿一勾一敲也要重画）。
  const liveReason = state.codesysAiChatReasoningOpen ? reasoning.length : codesysAiChatReasoningPreview(reasoning).length;
  const pendingSignature = pending
    ? `${pending.kind}:${pending.key}:${pending.answerable === true ? 1 : 0}:${(pending.questions || []).map((item) => item.id).join(',')}:${codesysAiChatAnswerDraftSignature(pending)}:${state.codesysAiChatAnswerBusy === true ? 1 : 0}:${String(state.codesysAiChatAnswerBlocked || '').length}`
    : '';
  // A 段：能力面也进签名 —— 差异 / 闸门 / 写入在途 / 编译进度与终态都必须重画（否则"确认写入"之后
  // 界面上还停在旧差异上，编译错误也不会出现）。这里只比对**数据**，不比整份快照对象。
  const build = capabilities && capabilities.build && typeof capabilities.build === 'object' ? capabilities.build : null;
  const capabilityPart = capabilities
    ? `cap:${capabilitySignature}:${Number(capabilities.proposal?.changeCount || 0)}:${String(capabilities.blockReason || '').length}:${capabilities.gate?.writeAvailable === true ? 1 : 0}:${capabilities.gate?.onlineWriteFrozen === true ? 1 : 0}:${capabilities.gate?.busy === true ? 1 : 0}:${state.codesysAiChatWriteBusy === true ? 1 : 0}:${state.codesysAiChatWriteOverride === true ? 1 : 0}:${String(state.codesysAiChatWriteBlocked || '').length}:${state.codesysAiChatDiscardBusy === true ? 1 : 0}:${String(build?.state || '')}:${String(build?.updatedAt || '')}:${Number(build?.errorCount || 0)}:${Number(build?.warningCount || 0)}:${(build?.messages || []).length}`
    : 'cap:(none)';
  const signature = `${result.sessionId}|${Number(result.total || messages.length)}|${messages.map((message) => `${message.role}:${Number(message.seq || 0)}:${String(message.text || '').length}`).join(',')}|${notice}|run:${running ? 1 : 0}|hasReason:${reasoning ? 1 : 0}|live:${liveReason}|open:${state.codesysAiChatReasoningOpen ? 1 : 0}|pending:${pendingSignature}|${capabilityPart}|reload:${state.codesysAiChatReload ? `${state.codesysAiChatReload.state}:${Number(state.codesysAiChatReload.written || 0)}:${String(state.codesysAiChatReload.detail || '').length}` : 'none'}`;
  if (signature === state.codesysAiChatSignature) return true;
  state.codesysAiChatSignature = signature;
  // T185：留住这一份结果 —— 草稿一变（勾选项 / 敲字）就靠 `codesysAiChatRepaint()` 用它重画，
  // 不必再造第二条渲染路径。
  state.codesysAiChatLastResult = result;
  state.codesysAiChatCodeTexts = [];
  state.codesysAiChatCopyTexts = messages.map((message) => String(message.text || ''));
  // T181：每一条消息只画它自己的正文与 hover 操作条（操作条里只剩「复制」一枚）——
  // 不再有任何快捷项落点，也没有"最后一条助手消息"这类位置判断。
  const list = messages.length
    ? messages.map((message, index) => {
      const isUser = message.role === 'user';
      const body = codesysAiChatTextMarkup(message.text);
      const role = `<span class="codesys-ai-role sr-only">${isUser ? '你' : 'AI'}</span>`;
      if (isUser) return `<div class="codesys-ai-msg codesys-ai-user">${role}<div class="codesys-ai-text">${body}</div></div>`;
      return `<div class="codesys-ai-msg codesys-ai-assistant">${role}<div class="codesys-ai-text">${body}</div><div class="codesys-ai-actions"><button class="codesys-ai-copy" type="button" data-ai-copy="${index}" title="复制这条消息" aria-label="复制这条消息">复制</button></div></div>`;
    }).join('')
    // 没有消息时那句中性占位；运行中（或正在等用户回答）则不写它
    //（"发一条消息开始"与"正在分析请求"/"待回答"同时出现是自相矛盾）。
    : (busy ? '' : '<div class="codesys-ai-empty">发一条消息开始</div>');
  // T183：进行中那一行接在消息之后（主界面的实时行也落在当前回合的位置上）。
  // T185：**待回答**那一段接在同一个位置（它就是这一回合当前卡住的地方），而且它与那一行互斥 ——
  // 见上面 `running` 的算法。
  // A 段：**能力面**接在同一处 —— 差异原文与「确认写入工程」、以及写入/编译那一段。
  // 顺序固定：差异（要用户确认的东西）在编译结果（刚才那次动作的结果）之前。
  thread.innerHTML = list
    + (running ? codesysAiChatLiveMarkup(reasoning) : '')
    + codesysAiChatPendingMarkup(pending)
    + codesysAiChatProposalMarkup(capabilities)
    // T192：写入成功之后那一段（事实 + 「让 CODESYS 重新加载」）。它排在差异之后、编译结果之前 ——
    // 用户刚点完写入，下一步就是"让 CODESYS 看到它"，然后才是编译/下载那一段。
    + codesysAiChatReloadMarkup()
    + codesysAiChatBuildMarkup(build);
  // 流尾的一次性提示行（与上面那段标记同一个 `state`，所以重画之后它照旧在，且只有一份）。
  thread.insertAdjacentHTML('beforeend', codesysAiChatNoticeMarkup());
  thread.scrollTop = thread.scrollHeight;
  return true;
}

function codesysAiChatStopPolling() {
  if (state.codesysAiChatTimer) clearTimeout(state.codesysAiChatTimer);
  state.codesysAiChatTimer = null;
}

// 这一趟与下一趟之间等多久：运行态 600ms（"思考中"要及时出现/消失），其余 1500ms。
function codesysAiChatPollDelay() {
  return state.codesysAiChatRunning === true ? CODESYS_AI_POLL_ACTIVE_MS : CODESYS_AI_POLL_MS;
}

// T183：轮询从 `setInterval` 改成**自调度**（`setTimeout`，等这一趟回来再排下一趟）。两个好处：
//   ① 运行态可以临时提速到 600ms，`running` 一回到 false 就自动回到 1500ms；
//   ② 同一时刻**只会有一个在途请求**（`codesysAiChatPullPending` 再挡一道），所以提速也不会
//      把 IPC 堆起来。`delayMs` 省略时按当前节奏取。
function codesysAiChatSchedulePoll(delayMs) {
  codesysAiChatStopPolling();
  if (!state.codesysAiChatOpen) return;
  const wait = Number.isFinite(Number(delayMs)) ? Number(delayMs) : codesysAiChatPollDelay();
  state.codesysAiChatTimer = window.setTimeout(() => {
    state.codesysAiChatTimer = null;
    // 不管这一趟成功还是失败，都要把下一趟排上（`codesysAiChatPullSnapshot` 内部已经把所有
    // 失败都消化成"数据"了，这里再兜一次只是为了让轮询永远不会因为一次意外而停摆）。
    void codesysAiChatPullSnapshot().then(() => { codesysAiChatSchedulePoll(); }, () => { codesysAiChatSchedulePoll(); });
  }, wait);
}

function codesysAiChatStartPolling() {
  codesysAiChatSchedulePoll(CODESYS_AI_POLL_MS);
}

// 拉一次快照。失败时把**具体原因**写进状态行（这是"点了没反应"的解药）。
// T183：进门先看那道闸 —— 定时器 / 手动调用（发送后、打开抽屉时）可能同时到达，
// 同一时刻只允许一个在途请求。
async function codesysAiChatPullSnapshot() {
  if (!state.codesysAiChatOpen) return;
  if (state.codesysAiChatPullPending === true) return;
  state.codesysAiChatPullPending = true;
  try {
    const result = await window.taskhive.codesysAiChatSnapshot({ limit: 40 });
    const ok = codesysAiChatApplySnapshot(result);
    if (ok) {
      // 用户要求「对话界面不要那么多文字提示」：连上成功不再说话，只把打开时那句"正在…"清空；
      // 之后也不覆盖发送结果之类更重要的状态。
      if (state.codesysAiChatBridgeOk !== true) codesysAiChatSetStatus('');
      state.codesysAiChatBridgeOk = true;
    } else {
      state.codesysAiChatBridgeOk = false; // 原因已由 applySnapshot 写进状态行
    }
  } catch (error) {
    state.codesysAiChatBridgeOk = false;
    // T180：顺序要紧 —— 先把原因写进 `state`（`applySnapshot(null)` 会用它把消息流里那句
    // 没有下文的"正在读取会话…"换成这一行），再让 `applySnapshot(null)` 决定消息流怎么画。
    codesysAiChatSetStatus(`读取会话失败（IPC codesys:ai-chat-snapshot）：${error.message}`);
    codesysAiChatApplySnapshot(null);
  } finally {
    state.codesysAiChatPullPending = false;
  }
}

// T181：预设文本的**插入能力**保留为内部函数（用户原话只要求"不需要看到"那两枚按钮，没有要求
// 删掉这个能力本身）：把模板文本填进输入框，已有内容时另起一行，绝不覆盖用户已经写好的字。
// ⚠️ 它是内部函数 —— 界面上**没有任何**节点会调它（那两枚按钮、模板表里的标签、事件委托里那一段
// 都已经删除），所以它不会在界面上产生任何入口。
function codesysAiChatInsertTemplate(id) {
  const template = codesysAiChatTemplates.find((item) => item.id === String(id || ''));
  const input = $('#codesys-ai-draft');
  if (!template || !input) return;
  input.value = input.value.trim() ? `${input.value}\n${template.text}` : template.text;
  input.focus();
}

async function sendCodesysAiChat() {
  const input = $('#codesys-ai-draft');
  const button = $('#codesys-ai-send');
  if (!input || state.codesysAiChatSending) return;
  const text = String(input.value || '').trim();
  if (!text) { codesysAiChatSetStatus('先写点内容再发送'); return; }
  state.codesysAiChatSending = true;
  if (button) { button.disabled = true; button.textContent = '发送中…'; }
  // T180：不再写"正在发送…" —— 发送按钮自己的文字已经翻成"发送中…"，流里再写一行就是复读。
  codesysAiChatSetStatus('');
  try {
    const result = await window.taskhive.codesysAiChatPrompt({ text });
    if (result && result.ok === true) {
      input.value = '';
      // 发送成功不写提示：消息本身已经出现在列表里，再写一句就是噪音（用户要求少文字提示）。
      // T184 唯一的例外：发送前那一次"确保工作台已绑定当前工程"**失败**时必须说话 —— 否则
      // 用户会看到 AI 回一句"没有绑定工程"，却不知道为什么。
      const workbench = result.workbench || null;
      codesysAiChatSetStatus(workbench && workbench.ok !== true
        ? `工作台未能绑定当前工程：${String(workbench.detail || workbench.reason || '原因未知')}`
        : '');
      // T183：这一趟拿到的是"刚受理、host 还没报 running"的那一帧，紧接着按**运行态**的节奏
      // （600ms）再排一趟，"思考中"最多 600ms 后就出现 —— 不必等满 1.5 秒。状态**不谎报**：
      // `codesysAiChatRunning` 仍然只由数据桥回报的事实写（见 `codesysAiChatApplySnapshot`）。
      codesysAiChatSchedulePoll(CODESYS_AI_POLL_ACTIVE_MS);
      await codesysAiChatPullSnapshot();
    } else {
      codesysAiChatSetStatus(`发送失败：${codesysAiChatReasonText(result)}`);
    }
  } catch (error) {
    codesysAiChatSetStatus(`发送失败（IPC codesys:ai-chat-prompt）：${error.message}`);
  } finally {
    state.codesysAiChatSending = false;
    // T176：按钮文字跟主界面 composer 一样只写动作（快捷键在 title 里），不再把「（Ctrl+Enter）」
    // 塞进按钮 —— 那是输入框右下角最挤的位置。
    if (button) { button.disabled = false; button.textContent = '发送'; }
  }
}

async function closeCodesysAiChat(message) {
  const drawer = $('#codesys-ai-drawer');
  state.codesysAiChatOpen = false;
  codesysAiChatStopPolling();
  // T183：抽屉收起 → 进行中状态与折叠态一起归零（下一次打开从干净的一态开始；
  // `codesysAiChatPullPending` 不归零 —— 那一趟在途请求回来时会自己清掉）。
  state.codesysAiChatRunning = false;
  state.codesysAiChatReasoningOpen = false;
  // T179：抽屉收起时浮层不能留在屏幕上（它挂在输入卡片里，抽屉一藏就会变成一个孤儿节点）。
  codesysAiChatModelMenuClose({ focus: false });
  if (drawer) drawer.hidden = true;
  syncCodesysAiChatButton();
  // T180：收起不再往流里写"AI 对话栏已收起" —— 抽屉已经藏了，下一次打开时那一行会变成一条没人
  // 认领的常驻提示（正是用户要求删掉的那种东西）。收起就是静默的。
  codesysAiChatSetStatus('');
  const status = $('#input-status');
  // 收起不再在状态条上留字（用户要求「对话界面不要那么多文字提示」）：空串 + CSS `:empty` 直接收起那一格。
  if (status) status.textContent = '';
  // 旧开关仍然回传"关"，但结果不重要 —— 界面已经收起，失败也不会留在屏幕上骗人。
  void window.taskhive.toggleCodesysAiChat({ open: false }).catch(() => null);
  await codesysAiChatSyncNativeBounds();
}

// 工具栏「AI 对话」按钮 = 开关（函数名沿用，契约与 onclick 绑定不变）。
async function openCodesysAiChat() {
  const drawer = $('#codesys-ai-drawer');
  if (!drawer) return;
  if (state.codesysAiChatOpen && !drawer.hidden) { await closeCodesysAiChat(); return; }
  state.codesysAiChatOpen = true;
  drawer.hidden = false;
  syncCodesysAiChatButton();
  // T175：打开时套用上次拖出来的宽度（`null` = 没拖过，CSS 默认宽度原样生效）。
  codesysAiChatApplyDrawerWidth(state.codesysAiChatWidth);
  // T180：不再写"正在读取会话…" —— 抽屉 markup 里消息流的初始行本来就是这一句，写两遍就是复读。
  // 成功路径全程静默（连上数据桥不再提示），失败才在流尾留一行。
  codesysAiChatSetStatus('');
  const inputStatus = $('#input-status');
  await codesysAiChatSyncNativeBounds();
  // 开关通道自己就失败时**不要**开始轮询：两个通道的身份门与前提完全一样（面板专属 +
  // allowHarness:false），能失败一次就会失败每一次 —— 那样每 1.5 秒的失败会把上面这条
  // 根因覆盖掉，正好又变成"看不清为什么"。修好后用户再点一次即可重试。
  let openFailed = false;
  // T184：打开抽屉时主进程会顺手让 DSH 侧把「CODESYS 工作台」页签打开并触发它**既有**的绑定流程
  // （`codesys:current-project` → `bind-project`），这就是用户要的"点 AI 对话默认绑定工程"。
  // 只在**失败**时写一行（用户要求界面安静）；成功（含"正在绑定"）全程静默，进度由工作台自己的
  // 状态行讲。绑定不是写入：不碰工程文件、不编译、不自动确认。
  let workbenchFailure = '';
  try {
    const result = await window.taskhive.toggleCodesysAiChat({ open: true });
    const bridge = (result && result.bridge) || null;
    if (bridge && bridge.reached === true) {
      state.codesysAiChatBridgeOk = true;
      // 连上 + 与主页同一条会话 + 1.5s 刷新：这三件事不再写进界面（数据桥不可用时才说话）。
      if (codesysAiChatApplySnapshot(bridge.snapshot)) codesysAiChatSetStatus('');
      const workbench = bridge.workbench || null;
      if (workbench && workbench.ok !== true) {
        workbenchFailure = `工作台未能绑定当前工程：${String(workbench.detail || workbench.reason || '原因未知')}`;
      }
    } else {
      state.codesysAiChatBridgeOk = false;
      const reason = (bridge && bridge.reason) || '主进程没有回报数据桥状态';
      // T180：失败**仍然必须可见** —— 一行、可读，进消息流尾（`title` 里是全文 reason）。
      // 先写 `state` 再 `applySnapshot(null)`：后者要把那句没有下文的占位换成这一行。
      codesysAiChatSetStatus(`数据桥不可用：${reason}`, reason);
      codesysAiChatApplySnapshot(null);
      // 失败才说话：一行短原因，详细 reason 进 `title`（`#input-status` 在状态条最左边，位置很贵）。
      if (inputStatus) { inputStatus.textContent = `数据桥不可用：${reason}`; inputStatus.title = reason; }
    }
  } catch (error) {
    openFailed = true;
    state.codesysAiChatBridgeOk = false;
    codesysAiChatSetStatus(`AI 对话栏打开失败（IPC codesys:ai-chat）：${error.message} · 已停止自动刷新，修好后请重新点一次「AI 对话」`);
    codesysAiChatApplySnapshot(null);
    if (inputStatus) inputStatus.textContent = `AI 对话栏打开失败：${error.message}`;
  }
  // T175：模型目录只在这几个时刻拉（打开抽屉 / 目录过期 / 主页换了模型），不跟 1.5 秒轮询。
  // 放在 openFailed 的提前返回**之前**：桥不通时这一句也会失败，而它的失败信息正是用户要看的
  // "为什么没有模型可选"（不会因为提前 return 而留下一个空的、什么都不说的下拉）。
  await codesysAiChatRefreshModels({ force: true });
  if (openFailed) return;
  // T184：只在失败时写这一行（进消息流尾；`#input-status` 位置很贵，写短原因，全文进 title）。
  // 放在轮询之前：`codesysAiChatPullSnapshot` 在桥通的情况下不会清掉这一行（它只在桥不通时改写）。
  if (workbenchFailure) {
    codesysAiChatSetStatus(workbenchFailure);
    if (inputStatus) { inputStatus.textContent = workbenchFailure; inputStatus.title = workbenchFailure; }
  }
  codesysAiChatStartPolling();
  await codesysAiChatPullSnapshot();
}

// 控件全部绑在面板自己的 DOM 上：没有一步依赖 DSH 的右栏容器。
function bindCodesysAiChatUi() {
  const drawer = $('#codesys-ai-drawer');
  if (!drawer) return;
  codesysAiChatStopPolling();
  codesysAiChatResizeEnd(); // 上一次遗留的拖动监听器（如果有）先摘干净
  state.codesysAiChatOpen = false;
  state.codesysAiChatSending = false;
  state.codesysAiChatBridgeOk = null;
  state.codesysAiChatSignature = '';
  // 本轮：**放弃**的在途状态跟着这套 DOM 一起归零（新 markup 里那枚按钮默认可用）。
  state.codesysAiChatDiscardBusy = false;
  state.codesysAiChatDiscardSignature = '';
  state.codesysAiChatDiscardCount = 0;
  state.codesysAiChatDiscardAt = 0;
  state.codesysAiChatDiscardNonce = '';
  state.codesysAiChatModels = null;
  state.codesysAiChatModelsAt = 0;
  state.codesysAiChatModel = null;
  state.codesysAiChatModelBusy = false;
  // T179：浮层状态跟着重画归零（新的 DOM 里浮层默认 `hidden`）。
  // T182：成功确认的自毁定时器已经整体删除，所以这里不再有 `clearTimeout`。
  state.codesysAiChatModelMenuOpen = false;
  state.codesysAiChatModelMenuActive = '';
  // T186：等级座位同样归零（新 markup 里它默认 `hidden`，等 `codesysAiChatRenderModelOptions()`
  // 按新的当前模型决定要不要显示）。
  state.codesysAiChatEffortMenuOpen = false;
  state.codesysAiChatEffortMenuActive = '';
  state.codesysAiChatCopyTexts = [];
  state.codesysAiChatCodeTexts = [];
  // T180：流内那一行一次性提示也归零（新 markup 里消息流只有"正在读取会话…"）。
  state.codesysAiChatNotice = '';
  state.codesysAiChatNoticeTitle = '';
  // T183：进行中的两个字段跟着归零（新的面板还没有任何一轮生成）。
  state.codesysAiChatRunning = false;
  state.codesysAiChatReasoningOpen = false;
  // T185：待回答那一块也归零（新的面板还没读到任何快照；草稿与失败原因都不该跨面板残留）。
  state.codesysAiChatPending = null;
  state.codesysAiChatAnswers = {};
  state.codesysAiChatAnswerBusy = false;
  state.codesysAiChatAnswerBlocked = '';
  // A 段：能力面那一组也归零（新面板还没读到任何快照；差异 / 写入失败 / 编译结果都不该跨面板残留）。
  state.codesysAiChatCapabilities = null;
  state.codesysAiChatWriteBusy = false;
  state.codesysAiChatWriteBlocked = '';
  state.codesysAiChatWriteSignature = '';
  state.codesysAiChatWriteOverride = false;
  state.codesysAiChatLastResult = null;
  drawer.hidden = true;
  // T179：浮层按 markup 的默认状态收起来 —— 状态与 DOM 只能有一套说法，否则会出现"state 说关着、
  // 菜单还画在屏幕上"（下一次 `aria-expanded=false` 的座位点一下才发现不对）。
  codesysAiChatModelMenuClose({ focus: false });
  syncCodesysAiChatButton();
  // T175：宽度沿用 localStorage 里的值（没存过就是"默认宽度"，交给 CSS）。绑定发生在面板渲染时，
  // 抽屉还是 hidden，所以这里只把值和 aria 摆好，几何计算要等真正打开（那时才有布局）。
  codesysAiChatApplyDrawerWidth(codesysAiChatReadStoredWidth());
  $('#codesys-ai-close')?.addEventListener('click', () => { void closeCodesysAiChat('AI 对话栏已收起'); });
  // T180：模板 chip 的点击**只走下面 `#codesys-ai-thread` 上那一个委托监听器** —— 两枚 chip 现在
  // 全部由 `codesysAiChatApplySnapshot()` 生成在消息流里，而消息流每 1.5 秒可能整体重画
  // `innerHTML`，在 bind 时逐个挂监听会随第一次重画全部失效（"点了没反应"的老毛病）。
  // T175①：左边缘把手 —— 鼠标拖动调宽（pointerdown → window 上的 move/up），键盘 ←/→ 微调，
  // 双击恢复默认宽度。三个事件各自都只调用上面那几个函数，几何只有一套。
  const resizer = $('#codesys-ai-resizer');
  resizer?.addEventListener('pointerdown', codesysAiChatResizeStart);
  resizer?.addEventListener('keydown', codesysAiChatResizeKeydown);
  resizer?.addEventListener('dblclick', (event) => { event.preventDefault?.(); codesysAiChatResetDrawerWidth(); });
  // 面板自己变窄/变宽时重新夹紧（70% 上限跟着容器算）。监听器只注册一次，随 surface 拆除摘掉。
  if (!state.codesysAiChatResizeListener) {
    state.codesysAiChatResizeListener = () => { codesysAiChatReclampDrawerWidth(); };
    window.addEventListener('resize', state.codesysAiChatResizeListener);
  }
  // T175②/T179/T186：**两个座位**（模型 + 推理等级）。两个都住在输入卡片底行
  // （`#codesys-ai-model` / `#codesys-ai-effort` 都在 `#codesys-ai-draft` 之后、与
  // `#codesys-ai-send` 同一行）。它们共用下面这一个循环里的同一套语义：
  //   * `click` 开关浮层（`aria-expanded` 跟着变；打开一个会收掉另一个，见 `codesysAiChatSeatOpen`）；
  //   * 菜单里的选项是 `innerHTML` 生成的，所以点击 / `mousedown` 都走**事件委托**，只绑一次；
  //   * 键盘（↑↓ / 回车 / Esc）绑在抽屉上，两个座位的按键都会冒泡上来，各自由描述符判定；
  //   * "点外面关闭"绑在 document 上（`state.codesysAiChatModelMenuOutside` 只注册一次，随 surface 摘掉）。
  // T186：这里从"模型一座"扩成"座位清单"（`CODESYS_AI_SEAT_LIST`），所以推理等级座位**不需要**
  // 第二套监听器 —— 它的打开 / 选择 / 键盘 / 点外面关闭全部由同一个内核承担。
  for (const seat of CODESYS_AI_SEAT_LIST) {
    seat.trigger()?.addEventListener('click', () => {
      if (codesysAiChatSeatIsOpen(seat)) codesysAiChatSeatClose(seat);
      else codesysAiChatSeatOpen(seat);
    });
    const menu = seat.menu();
    menu?.addEventListener('click', (event) => codesysAiChatSeatClick(seat, event));
    menu?.addEventListener('mousedown', (event) => codesysAiChatSeatMouseDown(seat, event));
  }
  drawer.addEventListener('keydown', (event) => {
    for (const seat of CODESYS_AI_SEAT_LIST) codesysAiChatSeatKeydown(seat, event);
  });
  if (!state.codesysAiChatModelMenuOutside) {
    state.codesysAiChatModelMenuOutside = (event) => {
      for (const seat of CODESYS_AI_SEAT_LIST) codesysAiChatSeatOutsideClick(seat, event);
    };
    document.addEventListener('click', state.codesysAiChatModelMenuOutside, true);
  }
  $('#codesys-ai-send')?.addEventListener('click', () => { void sendCodesysAiChat(); });
  $('#codesys-ai-draft')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void sendCodesysAiChat(); }
  });
  // T176：复制按钮走**事件委托**——消息区每 1.5 秒可能整体重画 innerHTML，逐个绑定会在下次重画时
  // 全部失效（"点了没反应"的老毛病）。绑定在 #codesys-ai-thread 上只需要一次。
  // T181：委托里原来还有一段处理模板按钮的分支，随那两枚按钮一起删除 —— 现在消息流里只有
  // 「复制」这一类带 `data-ai-copy*` 的节点。
  // T183：这一行"思考"的展开/收起也走同一条委托（它同样是每几百毫秒就可能被重画的节点）：
  // 只翻 `state.codesysAiChatReasoningOpen` 并就地改 DOM；下一次重画的签名里带着这个开关，
  // 所以重画之后**仍然保持**用户选的那一态（这正是"可折叠"必须做到的事）。
  $('#codesys-ai-thread')?.addEventListener('click', (event) => {
    // T185：**待回答**那一段的四个落点（都在这一个委托里，理由与 T183 的"思考"展开完全相同：
    // 消息区每 1.5 秒 / 运行态 600ms 就可能整体重画，逐个绑定会随第一次重画全部失效）。
    //   * `[data-ai-answer-option]` —— 勾选一枚选项（单选替换、多选增删）；
    //   * `[data-ai-answer-custom]` 不是按钮，走下面 `input` 那条委托；
    //   * `[data-ai-answer-submit]` —— **唯一**会调用 `codesys:ai-chat-answer` 的地方；
    //   * `[data-ai-answer-open-home]` —— 退路：切回主页 DSH 会话（审批类只有这一条路）。
    const option = event.target?.closest?.('[data-ai-answer-option]');
    if (option) {
      const questionId = String(option.getAttribute?.('data-ai-answer-option') || '');
      const label = String(option.getAttribute?.('data-ai-answer-label') || '');
      const question = (state.codesysAiChatPending?.questions || []).find((item) => item.id === questionId);
      if (question && label) {
        const draft = codesysAiChatAnswerDraft(questionId);
        draft.selected = question.multiSelect === true
          ? (draft.selected.includes(label) ? draft.selected.filter((item) => item !== label) : [...draft.selected, label])
          : [label];
        // 单选选了选项就把自定义文本清掉（与 DSH 自己的 `choose()` 一字不差：`custom: ""`）。
        if (question.multiSelect !== true) draft.custom = '';
        // 上一次的失败原因已经过期（用户正在重答），就地清掉 —— 不留一句已经不成立的话。
        state.codesysAiChatAnswerBlocked = '';
        codesysAiChatRepaint();
      }
      return;
    }
    const submit = event.target?.closest?.('[data-ai-answer-submit]');
    if (submit && submit.disabled !== true) { void codesysAiChatSubmitAnswer(); return; }
    const home = event.target?.closest?.('[data-ai-answer-open-home]');
    if (home) { codesysAiChatOpenHomeAnswer(); return; }
    // A 段：能力面那两枚按钮 —— 「确认写入工程」与（sha 防护挡下之后的）「我已确认，继续写入」。
    // ⚠️ 它们是**整个渲染层里唯一**会走到 `codesysAiChatApply` 的落点：没有这一下点击，
    // `codesys:ai-chat-apply` 一次都不会被调用（轮询只读快照）。
    const confirmWrite = event.target?.closest?.('[data-ai-confirm-write]');
    if (confirmWrite && confirmWrite.disabled !== true) { void codesysAiChatConfirmWrite(false); return; }
    const overrideWrite = event.target?.closest?.('[data-ai-confirm-write-override]');
    if (overrideWrite && overrideWrite.disabled !== true) { void codesysAiChatConfirmWrite(true); return; }
    // 本轮：与「确认写入工程」并排的那枚「放弃」。它是**唯一**会走到 `codesysAiChatDiscardProposal`
    // 的落点（同样走委托，理由同上：节点每次重画都会重建），而且它不写工程、不新增通道 ——
    // 作废提案 + 手写草稿、编辑器退回磁盘最新版本这件事由 DSH 侧的工作台做。
    const discardProposal = event.target?.closest?.('[data-ai-discard-proposal]');
    if (discardProposal && discardProposal.disabled !== true) { codesysAiChatDiscardProposal(); return; }
    // T192：写入成功之后那枚「让 CODESYS 重新加载」——**唯一**会走到
    // `codesysNativeHostReloadProject` 的落点（同样走委托，因为它也是被重画出来的节点）。
    const reloadProject = event.target?.closest?.('[data-ai-reload-project]');
    if (reloadProject && reloadProject.disabled !== true) { void codesysAiChatReloadProject(); return; }
    const live = event.target?.closest?.('[data-ai-live-toggle]');
    if (live) {
      const open = state.codesysAiChatReasoningOpen !== true;
      state.codesysAiChatReasoningOpen = open;
      live.setAttribute('aria-expanded', String(open));
      const box = live.closest?.('.codesys-ai-live');
      const panel = box ? box.querySelector('.codesys-ai-live-body') : null;
      if (panel) panel.hidden = !open;
      return;
    }
    const node = event.target?.closest?.('[data-ai-copy], [data-ai-copy-code]');
    if (!node) return;
    const codeIndex = node.getAttribute('data-ai-copy-code');
    const text = codeIndex !== null && codeIndex !== undefined
      ? state.codesysAiChatCodeTexts[Number(codeIndex)]
      : state.codesysAiChatCopyTexts[Number(node.getAttribute('data-ai-copy'))];
    if (text === undefined || text === null) return;
    void codesysAiChatCopyText(String(text), node);
  });
  // T185：自定义答案的输入框也走**委托**（同一条理由：它是重画出来的节点）。
  // ⚠️ 这里**只写草稿**：敲字绝不会发 IPC，作答永远要那枚「提交回答」被点一次。
  // 不做整段重画（重画会把用户正在打字的输入框换掉、光标也丢），只把草稿记下来 ——
  // 高亮态由草稿与重画共同决定，下一次别的重画自然会带上正确的值。
  $('#codesys-ai-thread')?.addEventListener('input', (event) => {
    const input = event.target?.closest?.('[data-ai-answer-custom]');
    if (!input) return;
    const questionId = String(input.getAttribute?.('data-ai-answer-custom') || '');
    if (!questionId) return;
    const draft = codesysAiChatAnswerDraft(questionId);
    draft.custom = String(input.value === undefined || input.value === null ? '' : input.value);
    // 输入内容变了就作废"还没有作答"那类提示（它已经不成立了）。
    if (state.codesysAiChatAnswerBlocked) state.codesysAiChatAnswerBlocked = '';
    // 签名要跟着变，否则用户敲完字点提交时用的还是旧草稿的那份渲染状态。
    state.codesysAiChatSignature = '';
  });
}

// T164：`executeDirectCodesysAction` / `queueCodesysAction` / `codesysRelativePoint` 一并删除 ——
// 它们只服务于"面板遥控"（把预览图上的点击/键盘送进 CODESYS），而该能力已按用户要求整体移除。
async function submitCodesysCodeAi(event) { event.preventDefault(); const input = $('#codesys-ai-input'); const status = $('#scriptengine-result'); if (!input || !status) return; const prompt = input.value.trim(); if (!prompt) return; status.innerHTML = '<div class="notice">正在通过 Harness 创建 ScriptEngine 隔离作业并回传工作区…</div>'; try { const result = await window.taskhive.requestCodesysCodeAi({ prompt }); if (!status.isConnected) return; status.innerHTML = `<div class="notice">任务已传到 Harness 工作区 · ${escapeHtml(result.jobId)} · ${escapeHtml(result.state)} · 当前工程未修改</div>`; input.value = ''; window.postMessage({ source: 'taskhive-dsh', type: 'surface.open', surface: 'chat' }, '*'); } catch (error) { if (status.isConnected) status.innerHTML = `<div class="notice">代码任务创建失败：${escapeHtml(error.message)}</div>`; } }


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
  if (!state.windows.length) { state.selectedWindow = null; list.innerHTML = '<option value="">尚未发现 CODESYS 窗口（可用「打开 CODESYS」启动，或自行启动后点此刷新）</option>'; return; }
  const previousId = state.selectedWindow?.id;
  const preferredPid = Number(options.preferredPid || 0);
  // T207：**外部启动的窗口永远不被自动选中**。只有本插件启动过的窗口（`owned !== false`，
  // 见 `windows-monitor.js` 的 T137 标注）才允许在没有点击的情况下成为当前选择；外部窗口
  // 必须在列表里被用户显式点一次（`list.onchange`）。判据与下面选项文案（`item.owned === false`
  // → 「外部启动」）是同一口径；`owned` 缺失（老的宿主载荷 / 测试桩）按"允许"处理。
  const autoSelectable = state.windows.filter((item) => item.owned !== false);
  const preferred = autoSelectable
    .filter((item) => preferredPid > 0 && Number(item.pid) === preferredPid)
    .sort((left, right) => (right.windowPhase === 'main') - (left.windowPhase === 'main') || (Number(right.width) * Number(right.height)) - (Number(left.width) * Number(left.height)))[0];
  state.selectedWindow = preferred || autoSelectable.find((item) => String(item.id) === String(previousId)) || autoSelectable.find((item) => item.usable !== false) || autoSelectable[0] || null;
  // 用户的删除要求（2026-10）：这里原先会在选中窗口变化时停掉上一个窗口的实时画面流
  // （`stopCodesysMediaStream` + `codesys:stream-stop` + `unsubscribeFrame`），并支持
  // 一个 `restartStream` 开关重新拉起监视。监视能力已整体删除，窗口枚举与选择现在只负责
  // 把原生托管指向正确的 HWND，没有任何流需要收尾。
  // T207：枚举里只有外部窗口、没有任何本插件启动的窗口时，`value=""` 的占位项就是
  // "还没有选中任何窗口"的**如实**显示 —— 不能靠浏览器默认选中第一项，把一个用户没点过的
  // 外部窗口装作已经选好了。
  list.innerHTML = (state.selectedWindow ? '' : '<option value="" selected>尚未选择 CODESYS 窗口（外部启动的窗口由你显式点选）</option>')
    + state.windows.map((item, index) => `<option value="${index}"${item === state.selectedWindow ? ' selected' : ''}>${escapeHtml(item.title)} · PID ${Number(item.pid || 0)} · ${item.width}×${item.height}${item.owned === false ? ' · 外部启动' : ''}${item.usable === false ? ` · 等待恢复${item.reason ? `（${escapeHtml(String(item.reason))}）` : ''}` : ''}</option>`).join('');
  list.onchange = async () => { if (String(list.value) === '') return; const previous = state.selectedWindow?.id; const next = state.windows[Number(list.value)] || null; state.selectedWindow = next;
    // The panel's selection IS the workbench's monitored window: publish it so
    // the code workbench re-detects against this window instead of any other
    // window the plugin happens to own.
    //
    // T207：这一下点击就是"用户的显式选择"，也是**唯一**能让外部启动的窗口成为监视/托管
    // 目标的入口。必须先 await 完这条 IPC 再托管：宿主按"这个句柄是否就是当前显式选中的
    // 监视窗口"复核，顺序反了会把用户自己的正常选择误拒。
    await window.taskhive.setCodesysPreferredWindow?.({ windowId: next?.id || '', pid: next?.pid || 0 }).catch(() => null);
    if (state.codesysNativeAttached && String(previous) !== String(state.selectedWindow?.id || '')) { await window.taskhive.detachCodesysNativeHost().catch(() => null); state.codesysNativeAttached = false; state.codesysNativeWindowId = ''; syncCodesysNativeButton(); } const status = $('#input-status'); if (state.selectedWindow) { if (state.selectedWindow.fixture === true) { if (status) status.textContent = `已选择隔离测试窗口 · ${state.selectedWindow.title}`; } else { const attached = await attachSelectedCodesysNativeHost({ explicitSelection: true }); if (status && state.selectedWindow.owned === false) status.textContent = attached ? `已托管外部启动的 CODESYS 窗口（你选择的）· ${state.selectedWindow.title} · 任务栏隐藏 · 不抢焦点、不改中央面板` : `外部启动的 CODESYS 窗口没能托管 · ${state.selectedWindow.title}`; } log(`已选择 ${state.selectedWindow.title}`); } };
  return state.selectedWindow;
}

async function waitForLaunchedCodesysWindow(pid) {
  for (let attempt = 0; attempt < 24 && $('#window-list'); attempt += 1) {
    const selected = await refreshWindows({ preferredPid: pid });
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
      if (status) status.textContent = `主 IDE 原生窗口已进入插件 · PID ${Number(pid)} · 鼠标键盘可直接操作 · 画面只走原生窗口，不再有实时监视`;
      return selected;
    }
  }
  return null;
}


async function renderPackages() {
  title.textContent = '插件管理'; badge.textContent = '安装与生命周期';
  await showPluginSurface(card(`<h2>插件与仓库</h2><p>支持远程 Git 和本地目录；安装前暂存校验，卸载先备份。</p><div class="toolbar"><select id="repository-kind"><option value="plugins">插件</option><option value="knowledge">知识库</option></select><input id="plugin-source" placeholder="Git 地址或本地目录"><button class="primary" id="install-plugin">安装</button></div><div id="plugin-list" class="grid"></div>`));
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
  await showPluginSurface(card(`<div class="settings-tabs" role="tablist" aria-label="设置分类"><button class="settings-tab active" data-settings-tab="models" type="button">模型</button><button class="settings-tab" data-settings-tab="plugins" type="button">插件</button><button class="settings-tab" data-settings-tab="directories" type="button">目录与同步</button><button class="settings-tab" data-settings-tab="startup" type="button">启动</button></div><section data-settings-panel="models"><details open><summary>模型目录 / Harness Route</summary><h2>多模型切换</h2><p>模型属于独立目录 <code>${escapeHtml(catalog.directory || 'models')}</code>；切换会更新 DSH route 并重启同一个 Harness Runtime，不会创建第二个 Agent Loop。</p><div class="toolbar"><select id="model-select">${options}</select><button class="primary" id="model-apply">应用模型</button></div><div id="model-status" class="notice">当前路由：${escapeHtml(catalog.defaultRoute.providerId)} · ${escapeHtml(catalog.defaultRoute.modelId)}</div><hr><div class="eyebrow">模型和认证健康</div><div>${providerHealth}</div><hr><div class="eyebrow">认证边界</div><p>DeepSeek API、本地 Ollama、Claude Code 和 Web AI 只有在完成显式认证/健康检查后才会启用；当前未配置项不会伪装成可用。</p></details></section><section data-settings-panel="plugins" hidden><details open><summary>插件管理</summary><p>所有插件在这里安装、启用、停用、卸载和恢复；后台插件不会伪造侧栏入口。</p><div class="toolbar"><input id="settings-plugin-source" placeholder="Git URL 或本地插件目录"><button class="primary" id="settings-plugin-install">安装插件</button></div><div id="settings-plugin-status" class="notice">正在读取插件状态…</div><div id="settings-plugin-list" class="grid"></div></details><details open><summary>插件入口位置</summary><p>入口位置只改变侧栏按钮位置，插件内容仍在中央工作区打开。后台插件和系统插件不显示此设置。</p><div class="plugin-placement-list">${placementRows || '<div class="empty">暂无可配置界面的已安装插件。</div>'}</div><div id="placement-status" class="notice">设置会保存到本地 catalog，并在下次 Harness 会话生效。</div></details></section><section data-settings-panel="directories" hidden><details open><summary>目录与 Git</summary><p>插件、知识库、模型和工作区保持独立目录；具体路径和 Git 同步由对应仓库管理。</p><div class="meta-row"><strong>程序本体</strong><span>app/</span></div><div class="meta-row"><strong>Harness 内核</strong><span>harness/</span></div><div class="meta-row"><strong>插件</strong><span>plugins/</span></div><div class="meta-row"><strong>知识库</strong><span>knowledge/</span></div><div class="meta-row"><strong>模型</strong><span>models/</span></div></details></section><section data-settings-panel="startup" hidden><details open><summary>启动与后台代价</summary><p>下面这个开关决定 TaskHive 启动时是否<b>提前做重活</b>。关掉不会少任何一个功能，只是把这份重活推迟到你真的用到它的那一刻。</p><label class="settings-toggle" for="codesys-preopen-on-start"><input type="checkbox" id="codesys-preopen-on-start"><span><strong>启动时预打开 CODESYS 工程</strong><small>用上次用过的那一个工程在后台先点着 CODESYS，好让你第一次「绑定并读取」不用等它。</small></span></label><p class="notice" id="codesys-preopen-cost"></p><div id="codesys-preopen-status" class="notice" hidden></div></details></section>`));
  document.querySelectorAll('[data-settings-tab]').forEach((tab) => { tab.onclick = () => { document.querySelectorAll('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === tab)); document.querySelectorAll('[data-settings-panel]').forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== tab.dataset.settingsTab; }); }; });
  // T199（②）：「启动时预打开 CODESYS 工程」。这一项此前**只**能靠环境变量
  // `TASKHIVE_CODESYS_PREOPEN_ON_START` 控制，用户看不到也改不了；代价是每次启动约 38–67 s
  // 的 CODESYS CPU/磁盘与常驻约 670 MB —— **即使整轮不用 CODESYS**。现在它是界面上的一项，
  // 默认值 = 改动前的行为（开），状态持久化在主进程（见 main.js 的 CODESYS_PREFERENCES_FILE）。
  //
  // 谁说了算：**主进程**。这里的勾选框只是镜像它，而且 `effective` 才是启动时真正会用的值 ——
  // 环境变量显式设置时会盖过界面（优先级 env 显式 > 界面 > 默认）。那种情况下只说**一行**实话，
  // 不让用户以为勾选框生效了。安静原则：读成功且没有环境变量覆盖时，状态行整行**不出现**。
  const preopenToggle = $('#codesys-preopen-on-start');
  const preopenStatus = $('#codesys-preopen-status');
  const showPreopenStatus = (text) => { preopenStatus.hidden = false; preopenStatus.textContent = text; };
  const hidePreopenStatus = () => { preopenStatus.hidden = true; preopenStatus.textContent = ''; };
  const loadPreopenSetting = async () => {
    try {
      const value = await window.taskhive.codesysPreopenPreference();
      preopenToggle.checked = value?.preopenOnStart === true;
      $('#codesys-preopen-cost').textContent = String(value?.costNote || '');
      if (value?.envOverride) {
        showPreopenStatus(`环境变量 ${value.envVariable || 'TASKHIVE_CODESYS_PREOPEN_ON_START'} 已被显式设置，它正在盖过这里的开关（优先级：环境变量 > 界面设置 > 默认开）。`);
      } else {
        hidePreopenStatus();
      }
    } catch (error) {
      showPreopenStatus(`读取设置失败：${error.message}`);
    }
  };
  preopenToggle.onchange = async () => {
    const next = preopenToggle.checked;
    preopenToggle.disabled = true;
    try {
      const value = await window.taskhive.saveCodesysPreopenPreference({ preopenOnStart: next });
      const effective = value?.effective === true;
      if (effective !== next) {
        showPreopenStatus(`已保存，但环境变量正在盖过它：启动时实际是${effective ? '开' : '关'}。`);
      } else {
        showPreopenStatus('已保存，下次启动生效。');
      }
      log(`启动时预打开 CODESYS 工程已设置为 ${next ? '开' : '关'}`);
    } catch (error) {
      preopenToggle.checked = !next;
      showPreopenStatus(`保存失败：${error.message}`);
    } finally {
      preopenToggle.disabled = false;
    }
  };
  await loadPreopenSetting();
  $('#model-apply').onclick = async () => { const [providerId, modelId] = $('#model-select').value.split('::'); const button = $('#model-apply'); button.disabled = true; $('#model-status').textContent = providerId === 'web-ai' ? '正在打开中央浏览器模型…' : '正在重启 DSH Runtime…'; try { const result = await window.taskhive.selectModel({ providerId, modelId }); $('#model-status').textContent = providerId === 'web-ai' ? `已打开网页模型：${modelId}` : `已切换：${providerId} · ${modelId}；DSH ${result.runtime.state}`; log(`模型已切换到 ${modelId}`); } catch (error) { $('#model-status').textContent = `模型切换失败：${error.message}`; } finally { button.disabled = false; } };
  document.querySelectorAll('[data-plugin-placement]').forEach((select) => { select.onchange = async () => { const id = select.dataset.pluginPlacement; try { await window.taskhive.setPluginPlacement({ id, placement: select.value }); $('#placement-status').textContent = `${id} 入口已设置为${select.value === 'left' ? '左侧栏' : select.value === 'right' ? '右侧栏' : '隐藏'}；重新打开 Harness 后生效。`; log(`插件入口位置已更新：${id}=${select.value}`); } catch (error) { $('#placement-status').textContent = `入口位置保存失败：${error.message}`; } }; });
  const pluginStatus = $('#settings-plugin-status'); const pluginList = $('#settings-plugin-list');
  const loadPluginSettings = async () => { const items = await window.taskhive.listPlugins(); pluginList.innerHTML = items.length ? items.map((item) => { const protectedItem = item.protected === true; const next = item.state === 'enabled' ? 'disabled' : 'enabled'; const action = protectedItem ? '<span class="badge">系统组件</span>' : `<span class="row-actions"><button class="secondary" data-plugin-toggle="${escapeHtml(item.id)}" data-next="${next}">${next === 'enabled' ? '启用' : '停用'}</button>${item.installed ? `<button class="danger" data-plugin-uninstall="${escapeHtml(item.id)}">卸载</button>` : `<button class="secondary" data-plugin-restore="${escapeHtml(item.id)}">恢复</button>`}</span>`; return `<div class="plugin-row"><span class="plugin-row-head"><span class="nav-icon" aria-hidden="true">${sidebarIconMarkup[item.id] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/></svg>'}</span><span><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.id)} · v${escapeHtml(item.version || '-')} · ${escapeHtml(item.state || 'unknown')} · ${escapeHtml(item.source || 'local')}</small></span></span>${action}</div>`; }).join('') : '<div class="empty">暂无插件。</div>'; pluginList.querySelectorAll('[data-plugin-toggle]').forEach((button) => { button.onclick = async () => { try { const id = button.dataset.pluginToggle; const next = button.dataset.next; if (next === 'enabled') await window.taskhive.enablePlugin(id); else await window.taskhive.disablePlugin(id); pluginStatus.textContent = `${id} 已${next === 'enabled' ? '启用' : '停用'}，Harness 已重新加载。`; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `插件状态更新失败：${error.message}`; } }; }); pluginList.querySelectorAll('[data-plugin-uninstall]').forEach((button) => { button.onclick = async () => { try { await window.taskhive.uninstallPlugin(button.dataset.pluginUninstall); pluginStatus.textContent = '插件已备份并卸载。'; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `卸载失败：${error.message}`; } }; }); pluginList.querySelectorAll('[data-plugin-restore]').forEach((button) => { button.onclick = async () => { try { await window.taskhive.restorePlugin(button.dataset.pluginRestore); pluginStatus.textContent = '插件已从备份恢复。'; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `恢复失败：${error.message}`; } }; }); };
  $('#settings-plugin-install').onclick = async () => { const source = $('#settings-plugin-source').value.trim(); if (!source) { pluginStatus.textContent = '请输入 Git 地址或本地插件目录。'; return; } try { await window.taskhive.installPlugin({ source }); $('#settings-plugin-source').value = ''; pluginStatus.textContent = '插件安装完成，Harness 已重新加载。'; await loadPluginSettings(); await renderSidebars(); } catch (error) { pluginStatus.textContent = `安装失败：${error.message}`; } };
  await loadPluginSettings();
}

async function renderRepositorySurface(kind) {
  const isKnowledge = kind === 'knowledge';
  const heading = '知识库';
  const description = '本地/Git 文档导入、隔离索引、全文搜索与审核状态；检索结果只作为 Harness 上下文。';
  title.textContent = heading; badge.textContent = '卡片与审核';
  const knowledgeMarkup = `<section class="knowledge-workbench"><div class="knowledge-create-row"><input id="knowledge-card-title" placeholder="知识卡标题" aria-label="知识卡标题"><select id="knowledge-card-type" aria-label="知识类型" title="选择知识卡分类"><option value="question">问题</option><option value="preference">偏好</option><option value="fact">事实</option><option value="decision">决策</option><option value="process">流程</option><option value="experience">经验</option><option value="conversation">对话沉淀</option></select><textarea id="knowledge-card-content" rows="2" placeholder="记录问题、证据、结论或验证步骤" aria-label="知识卡内容"></textarea><button class="primary" id="knowledge-card-create" title="先保存为待审核知识卡">沉淀候选</button></div><div class="knowledge-sync-row"><input id="knowledge-remote-path" placeholder="共享文件夹或 Git 工作副本目录" aria-label="知识库同步目录" title="填写多客户端共同访问的共享目录或已检出的 Git 工作副本"><button class="secondary" id="knowledge-sync" title="双向合并远程知识卡并报告冲突">远程同步</button></div><div id="knowledge-sync-status" class="notice">正在读取同步状态…</div><div id="knowledge-category-grid" class="knowledge-category-grid" aria-label="知识分类统计"></div><div id="knowledge-card-grid" class="knowledge-tree"></div></section>`;
  await showPluginSurface(card(`${knowledgeMarkup}<details class="repository-details"><summary>仓库、检索与审计</summary><div class="toolbar"><input id="repo-query" placeholder="搜索知识卡或远程文档" aria-label="仓库搜索"><button class="primary" id="repo-search" title="搜索已启用仓库">搜索</button><button class="secondary" id="repo-audit" title="审计来源、版本和摘要">审计</button></div><div id="repo-status" class="notice">正在读取隔离仓库目录…</div><div id="repo-results" class="grid"></div></details>`));
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
    else if (kind === 'knowledge') await renderChat(); // T137：知识库改由 DSH 客户端插件自渲染
                                                      // （开源插件索引 + 对话沉淀卡片）。旧实现走
                                                      // renderRepositorySurface()，会在 606×784、z-index 20
                                                      // 的 .plugin-overlay 上盖一层旧版界面（问题/偏好/事实/
                                                      // 决策/流程/经验 全是「0 张」），把新视图整个遮住 ——
                                                      // 用户看到的就是"知识库显示不对"。回到 chat 即露出 DSH 视图。
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
  if (event.data?.type === 'surface.open') {
    // T143：knowledge 由 DSH 客户端插件渲染 —— 收到请求就**立即**收起原生 overlay，
    // 不等异步 render（否则切换顺序稍慢就会留一层空白/过期原生画面盖住 DSH 视图）。
    if (event.data.surface === 'knowledge' && pluginOverlay) { pluginOverlay.hidden = true; pluginContent.innerHTML = ''; }
    void selectSurface(event.data.surface);
    return;
  }
  // 本轮：工作台回报那一次「放弃」的结果（见 `codesysAiChatDiscardSettled`）。这条回信是**唯一**
  // 把"丢了多少处手写改动"带回来的地方；它不给任何写入能力，只决定消息流尾那一行写什么。
  if (event.data?.type === 'codesys.proposal.discarded') { codesysAiChatDiscardSettled(event.data); return; }
});

  (async () => { try { const status = await window.taskhive.harnessStatus(); document.documentElement.dataset.harnessState = status.runtime?.state || status.state || 'unknown'; const node = $('#harness-state'); if (node) node.textContent = status.runtime?.state === 'ready' ? '已就绪' : '需检查'; } catch { document.documentElement.dataset.harnessState = 'error'; const node = $('#harness-state'); if (node) node.textContent = '需检查'; } await renderSidebars(); await selectSurface(requestedSurface); })();
