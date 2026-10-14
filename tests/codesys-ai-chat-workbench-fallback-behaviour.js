'use strict';

// T186/T191 行为契约：**点「AI 对话」的自动绑定不再依赖右栏页签，而且不许拽走用户当前的视图**。
//
// 用户报障（重启后仍然复现，审计流 `codesys.ai-chat.workbench-unbound` 原文）：
//   {"reason":"workbench-tab-open-failed",
//    "detail":"打开「CODESYS 工作台」页签失败：sidebarRight: no session surface is mounted；
//             请手动点面板上的「代码任务」绑定工程。"}
// 真因：用户停在 CODESYS 插件面板时，DSH 的**会话面没有挂载** —— 而会话面的右栏正是工作台页签的
// 宿主，所以 shard 78 那条 `ctx.sidebarRight.openTab(...)` 必被 DSH 拒绝。用户的要求是"点「AI 对话」
// 就该绑上"，不许再要求他先手动点一次。
//
// T191 追加（用户口径「AI 对话就是唯一操作面，工作台只做能力提供」）：修好绑定之后**不许顺带把用户
// 从 CODESYS 面板拽回会话面**。原兜底走的是外壳「代码任务」通路，那条路会 `selectPanel(null)` +
// `openSurface('chat')` —— 后者正是"摘下原生插件面、把用户拉到会话面"的那一步。现在分级：
//   ① 右栏已在（正常路径）→ 直接开页签；
//   ② 会话面没挂载（真机复现）→ **只** `layout.selectPanel(null)`（挂起会话面，右栏因此可用）
//      + 等 `mounted` ready 再 `openTab`；**绝不** `openSurface('chat')`（用户的中央视图不动）；
//   ③ 连会话面都挂不起来（没有 layout 服务）→ 才回到外壳既有的「代码任务」通路（它自己切界面，
//      返回值用 via:'code-task' 如实标注）。
//
// 这个契约**真跑两个分片**（不是读源码猜）：shard 80 的 apply(ctx) 注册那条消息处理器，shard 78 的
// `ensureWorkbench`（真机上由 main.js 经数据桥调用）与它在**同一个 window** 里对跑。断言：
//   ① 会话面已在（正常路径）→ 直接开页签，**不投递任何消息**、不碰用户界面；
//   ② 会话面没挂载（真机复现）→ 只挂会话面（selectPanel(null)）就打开工作台页签，
//      **surfaces 里一个 'chat' 都没有**（这就是"不拽用户视图"的可执行判据）；
//   ③ layout 与兜底都被堵死 → 一行可读原因（含"点面板上的「代码任务」"）；
//   ④ 全程 window.taskhive 0 次调用（只绑定：不写入、不编译、不确认）。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const dshRoot = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh');
const shard80Source = fs.readFileSync(path.join(dshRoot, 'src', '80-codesys-task-and-apply.js'), 'utf8');
const shard78Source = fs.readFileSync(path.join(dshRoot, 'src', '78-codesys-ai-chat.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(appRoot, 'app', 'main.js'), 'utf8');

// 投递的那条消息必须就是外壳「代码任务」通路那一条（同一条通路、同一个接收者）。
const DESKTOP_WORKBENCH_OPEN = { source: 'taskhive-desktop', type: 'codesys.workbench.open' };
assert(mainSource.includes(`window.postMessage({source:'taskhive-desktop',type:'codesys.workbench.open'}, '*')`),
  'main.js 的 codesys:workbench-open 处理器必须仍然投递这条消息（shard 78 的兜底复用它，不另造消息）');
assert(shard78Source.includes(`window.postMessage({ source: 'taskhive-desktop', type: 'codesys.workbench.open' }, '*')`),
  'shard 78 的兜底必须投递同一条消息（source/type 逐字相同，否则接收者认不出来）');

// ── 组装两个分片共用的那个 window / ctx ────────────────────────────────────────────────────
const handlers = {};
const selected = [];      // layout.selectPanel 的调用
const surfaces = [];      // openSurface 的调用
const attempted = [];     // 每一次 openTab 尝试（含被 DSH 拒绝的那一次）
const opened = [];        // 真正打开成功的页签
const registered = [];
const tabTypes = [];
const preload = [];       // window.taskhive 上的任何调用（必须 0 次）
const disposers = [];
let mountedSession = 'session-a';   // 右栏当前宿主的是哪条会话（null = 没有会话面挂载 —— 真机故障态）
let rightbarChanged = null;
let mountOnOpenSurface = false;     // openSurface('chat') 是否**同步**把会话面挂起来（真机是异步的）
// T191：会话面的挂载方式。真机上 `layout.selectPanel(null)` 挂起会话面是**异步**的：
//   'async'  → selectPanel(null) 之后一个任务把会话面挂起来并通知右栏订阅者（真机默认时序）
//   'sync'   → selectPanel(null) 内同步挂起并通知（另一种真机时序）
//   'never'  → 会话面永远挂不起来（用来钉"连会话面都挂不起来"那一级的可读原因）
let mountMode = 'async';
let rightbarUnsubscribed = false;

const sessions = {
  list: { getSnapshot: () => ({ ids: ['session-a'], byId: { 'session-a': { id: 'session-a', retainedBy: { mainView: 1 } } } }), subscribe: () => () => {} },
  binding: (id) => (id === 'session-a' ? { session: { prompt: async () => null } } : null),
  open: async () => 'session-a',
};

const window = {
  addEventListener: (name, fn) => { handlers[name] = fn; },
  removeEventListener: (name) => { delete handlers[name]; },
  // 浏览器语义：窗口发给自己的消息，`event.source === window` —— 正是 shard 80 那句判据要的形态。
  // 真机的派发是一个排队任务，这里同步派发；被测的可观察结果（谁被调用、开了哪个页签）完全一致。
  postMessage: (message) => {
    const handler = handlers.message;
    if (handler) handler({ source: window, data: message });
  },
  taskhive: new Proxy({}, { get: (_target, name) => (...args) => { preload.push(String(name)); return Promise.resolve(null); } }),
};

const noop = () => {};
const context = {
  window,
  document: { addEventListener: noop, removeEventListener: noop },
  console,
  // 真机有的定时器：shard 78 的"等右栏 ready"那一级用它（上限几百毫秒，绝不无限等）。
  setTimeout,
  clearTimeout,
  React: { useEffect: noop, useState: noop, useRef: noop, useCallback: noop, useMemo: noop },
  h: (type, props) => ({ type, props }),
  entries: [{ id: 'codesys', tabId: 'taskhive:codesys', title: 'CODESYS', placement: 'right' }],
  installTaskHiveSkin: noop,
  openSurface: (id) => { surfaces.push(id); if (mountOnOpenSurface && id === 'chat') mountedSession = 'session-a'; },
  surfaceView: () => noop,
  surfaceIcon: noop,
  CodesysWorkbenchBoundary: noop,
  SessionRecordsPanel: noop,
  DirectorySettingsItem: noop,
  ModelCatalogSection: noop,
  PluginInventoryTab: noop,
  LeftSurfaceActions: noop,
  installWorkspaceGeometryBridge: () => noop,
  installNativeNavigationBridge: () => noop,
  installCodesysTaskBridge: () => noop,
  installWebLoginCardBridge: () => noop,
  // shard 80 会调用 79-* 的模型并入；单独加载时它不在作用域里，必须给桩（true = 并入成功）。
  installNativeModelMerge: () => true,
  // shard 78 读服务用的旧写法（新写法是 ctx.get，见下）。
  getOptionalService: (target, name) => (target ? target[name] : null),
  ensureRightSidebarOpen: () => true,
  codesysWorkbenchControl: null,
};
vm.createContext(context);

const applySource = shard80Source.slice(shard80Source.indexOf('    function apply(ctx)'), shard80Source.indexOf('    module.exports.apply'));
// T191：会话面的挂载由 `layout.selectPanel(null)` 触发（真机语义），而且通常是**异步**的 —— 右栏
// 因此要等 `mounted` 变化。这里把它做成真的：按 `mountMode` 决定怎么挂、什么时候通知订阅者。
const rightbarSubscribers = new Set();
// 第一个订阅者是 shard 80 在 apply 时注册的那一个（工作台还没卸载就不该被释放）。T191 起 shard 78
// 会为自己的"等右栏 ready"再订阅一次、并且**成功后就该摘掉自己那一个** —— 所以这个标记只跟第一个。
let firstRightbarSubscriber = null;
const mountSession = () => {
  mountedSession = 'session-a';
  // 通知**每一个**订阅者（真机语义）。`rightbarChanged` 只是最后一个订阅者，别重复通知它 —— 重复
  // 通知会掩盖"重复 openTab"这类真缺陷（attempted 的计数立刻就骗人了）。
  for (const callback of [...rightbarSubscribers]) { try { callback() } catch { /* 一个订阅者坏掉不影响别的 */ } }
};
const ctx = {
  slots: { inject: (_name, callback) => callback(), register: (descriptor, component) => { registered.push({ ...descriptor, component }); return () => {} } },
  layout: {
    selectPanel: (id) => {
      selected.push(id);
      if (id !== null) return;
      if (mountMode === 'sync') mountSession();
      else if (mountMode === 'async') setTimeout(mountSession, 0);
      // 'never'：会话面永远挂不起来（用来钉"连会话面都挂不起来"那一级的可读原因）。
    },
  },
  sessions,
  sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => {} } },
  sidebarRight: {
    openTab: (kind) => {
      attempted.push(kind);
      // 真机语义：DSH 在没有会话面挂载时**拒绝**打开会话面的页签（日志原文照抄）。
      if (mountedSession === null) throw new Error('sidebarRight: no session surface is mounted');
      opened.push(kind);
    },
    mounted: {
      getSnapshot: () => mountedSession,
      // 真机的订阅者可以有很多个（shard 80 的 pending 逻辑 + shard 78 的等待逻辑各一个）。
      subscribe: (callback) => {
        if (!firstRightbarSubscriber) firstRightbarSubscriber = callback;
        rightbarSubscribers.add(callback);
        rightbarChanged = callback;
        return () => {
          rightbarSubscribers.delete(callback);
          if (callback === firstRightbarSubscriber) rightbarUnsubscribed = true;
        };
      },
    },
  },
  effect: (callback) => { disposers.push(callback()); },
  workspaces: null,
  uiWorkspace: null,
};
ctx.get = (name) => (ctx[name] === undefined ? null : ctx[name]);

// 先加载 shard 78（apply 会在内部调用它的 installCodesysAiChat），再跑 shard 80 的 apply。
vm.runInContext(shard78Source, context, { filename: path.join(dshRoot, 'src', '78-codesys-ai-chat.js') });
vm.runInContext(`${applySource}; globalThis.apply = apply`, context);
context.apply(ctx);

assert(window.__TASKHIVE_CODESYS_AI_BRIDGE__, 'shard 80 的 apply 必须把 shard 78 的数据桥装起来（真机入口就是它）');
assert(typeof window.__TASKHIVE_CODESYS_AI_BRIDGE__.ensureWorkbench === 'function', '数据桥必须有 ensureWorkbench 入口');
assert(handlers.message, 'shard 80 必须注册 codesys.workbench.open 的消息处理器（外壳「代码任务」通路的接收者）');
assert.strictEqual(tabTypes[0].kind, 'taskhive:codesys-workbench', '工作台页签 id 必须仍是外壳那条通路要开的同一个');

const ensure = () => window.__TASKHIVE_CODESYS_AI_BRIDGE__.ensureWorkbench();
const reset = () => { selected.length = 0; surfaces.length = 0; attempted.length = 0; opened.length = 0; preload.length = 0; };

async function main() {
  // ① 正常路径（会话面已在）：直接开页签，不投递任何消息 —— 修完不许回归。
  reset();
  mountedSession = 'session-a';
  const normal = await ensure();
  assert.strictEqual(normal.ok, true);
  assert.strictEqual(normal.started, true, '会话面已在时必须照旧直接打开工作台页签');
  assert.strictEqual(normal.via, undefined, '正常路径不许走兜底');
  assert.deepStrictEqual(opened, ['taskhive:codesys-workbench'], '正常路径必须真的打开工作台页签');
  assert.deepStrictEqual(surfaces, [], '正常路径不该惊动外壳的 surface 导航（不切界面）');
  assert.deepStrictEqual(selected, []);
  assert.deepStrictEqual(preload, [], '只绑定：不许碰 window.taskhive');
  console.log(`[自测⑤] 正常路径（会话面已在）→ ensureWorkbench=${JSON.stringify({ ok: normal.ok, started: normal.started })} · 打开页签=${opened.join('|')} · 切界面=${surfaces.length} 次 · 兜底消息=0 次 · window.taskhive=${preload.length} 次`);

  // ② 真机复现：会话面**没有挂载**（用户停在 CODESYS 插件面板）→ 右栏 openTab 抛
  //    `sidebarRight: no session surface is mounted` → T191 的最小扰动那一级接管：**只**挂会话面，
  //    不切用户的 surface，右栏一 ready 就打开工作台页签。
  reset();
  mountedSession = null;
  mountMode = 'async';          // 真机时序：selectPanel(null) 之后会话面才挂起来
  const viaFallback = await ensure();
  assert.strictEqual(viaFallback.ok, true, '右栏没有会话面时必须由下一级接管（不得停在 ok:false）');
  assert.strictEqual(viaFallback.bound, false);
  assert.strictEqual(viaFallback.started, true, '把工作台挂起来了就必须如实说 started:true');
  assert.strictEqual(viaFallback.via, 'session-panel', 'T191：这一级走的是"只挂会话面、不动用户视图"（via 是纯观测字段）');
  // 两次尝试都应指向同一个页签：被拒的那一次（真机日志原文）+ 会话面 ready 之后成功的那一次。
  // 只允许两次（多出来的 = 重复 openTab，DSH 会抛 already registered）。
  assert(attempted.every((kind) => kind === 'taskhive:codesys-workbench'), '每一次尝试都必须开同一个（外壳注册的）工作台页签');
  assert.strictEqual(attempted.length, 2, `第一级应恰好尝试两次（被拒一次 + 会话面 ready 后成功一次），实际 ${attempted.length} 次`);
  // 兜底把会话面挂回主面板：T191 起**只** selectPanel(null)，绝不 openSurface('chat')。
  assert.deepStrictEqual(selected, [null], '最小扰动那一级必须只 selectPanel(null)（把会话面挂回主面板，右栏才有宿主）');
  assert.deepStrictEqual(surfaces, [], 'T191：这一级**绝不** openSurface(\'chat\') —— 那一步会把用户从 CODESYS 面板拽回会话面');
  // 会话面异步挂起来之后，78 自己的订阅把页签补上 —— 这就是"工作台真的挂上了"。
  assert.deepStrictEqual(opened, ['taskhive:codesys-workbench'], '会话面 ready 之后必须打开工作台页签（组件挂载即 force 探测并绑定）');
  assert.deepStrictEqual(preload, [], '这一级同样不许碰 window.taskhive（只绑定，不写入/不编译/不确认）');
  console.log(`[自测①] 会话面没挂载（真机复现）→ 第一级 openTab 被拒（${attempted.join('|')}）→ 最小扰动：selectPanel(${JSON.stringify(selected)}) · openSurface(${JSON.stringify(surfaces)})（应为空 = 没拽用户）→ 会话面 ready 后真正打开的页签=${JSON.stringify(opened)} → ensureWorkbench=${JSON.stringify({ ok: viaFallback.ok, started: viaFallback.started, via: viaFallback.via })} · window.taskhive=${preload.length} 次`);

  // ②b 会话面**同步**挂起来（另一种真机时序）：同一次调用里就该把页签开完，同样不切用户的视图。
  reset();
  mountedSession = null;
  mountMode = 'sync';
  const viaFallbackSync = await ensure();
  assert.strictEqual(viaFallbackSync.ok, true);
  assert.strictEqual(viaFallbackSync.via, 'session-panel');
  assert.deepStrictEqual(opened, ['taskhive:codesys-workbench'], '会话面同步挂起时，同一次调用内就要把页签开完');
  assert.deepStrictEqual(surfaces, [], '同步时序同样不许 openSurface(\'chat\')');
  console.log(`[自测①b] 会话面同步挂起 → 同一次调用内打开页签=${JSON.stringify(opened)} · 切用户界面=${surfaces.length} 次 · ensureWorkbench=${JSON.stringify({ ok: viaFallbackSync.ok, started: viaFallbackSync.started, via: viaFallbackSync.via })}`);
  mountMode = 'async';

  // ③ 三级都被堵死（这个文档没有 postMessage、会话面也永远挂不起来）→ 一行可读原因，
  //    且具体到"点面板上的「代码任务」"。
  reset();
  mountedSession = null;
  mountMode = 'never';
  context.window.postMessage = undefined;
  const blocked = await ensure();
  context.window.postMessage = window.postMessage;
  mountMode = 'async';
  assert.strictEqual(blocked.ok, false, '三级都失败必须报失败，不能假装成功');
  assert.strictEqual(blocked.reason, 'workbench-tab-open-failed');
  assert(/no session surface is mounted/.test(blocked.detail), '第一级的原始原因必须保留（日志里能查到根因）');
  assert(/最小扰动那一级也没能挂起会话面/.test(blocked.detail), 'T191 那一级的失败原因也必须写进同一行');
  assert(/没有 window\.postMessage/.test(blocked.detail), '兜底那一级的失败原因也必须写进同一行');
  assert(/请手动点面板上的「代码任务」绑定工程/.test(blocked.detail), '下一步必须具体到"点面板上的「代码任务」"');
  assert.deepStrictEqual(surfaces, [], '三级都失败时不该发生任何 surface 切换');
  console.log(`[自测②] 三级都被堵死 → ${JSON.stringify({ ok: blocked.ok, reason: blocked.reason, detail: blocked.detail })}`);

  // ④ 全程零写入：上面所有用例都没有碰过 window.taskhive，也没有写入/编译类动作。
  assert.deepStrictEqual(preload, [], 'ensureWorkbench 全程一次都没有碰 window.taskhive');
  for (const forbidden of ['apply-and-build', 'update-text', 'create-pou', 'rebuild', 'runCodesysScriptEngineAction']) {
    assert(!shard78Source.replace(/^\s*\/\/.*$/gm, '').includes(forbidden), `shard 78 的绑定链路上不该出现 ${forbidden}`);
  }
  assert(!/ipcRenderer|ipcMain/.test(shard78Source), 'shard 78 不得直接碰 IPC（兜底投递的是外壳那条 window message）');
  assert.strictEqual(rightbarUnsubscribed, false, '工作台还没卸载：订阅不该被提前释放');
  console.log(`[自测④] 只绑定、零写入：window.taskhive 调用 = ${preload.length} 次 · 两分片全程只出现 layout.selectPanel / openSurface / openTab / 一条 postMessage`);

  // 收尾：disposers 必须能跑（apply 的清理路径不许因为这次改动坏掉）。
  for (const dispose of disposers) assert.doesNotThrow(() => dispose());
  console.log('codesys ai-chat workbench fallback behaviour passed (openTab refused → 最小扰动挂会话面（不切用户视图）→ 最后才回到 shell 代码任务通路)');
}

main().catch((error) => {
  console.error(`codesys ai-chat workbench fallback behaviour failed: ${error.message}`);
  process.exitCode = 1;
});
