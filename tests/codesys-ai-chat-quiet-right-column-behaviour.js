'use strict';

// T192 行为契约：**打开 AI 对话时右栏必须"看上去没变"，而能力一步不少。**
//
// 用户报障（原文）："打开ai对话的时候 codesys工作台会跳出来"。
//
// 真因**不在**本插件：`ctx.sidebarRight.openTab(kind)` → `place` → store 的 `openContent`，而
// `openContent` 干的**第一件事**就是 `planSetExpanded(state, true)`（右栏无条件展开），随后
// `planOpenContent` / `focusTab` 把页签顶到最前。`openTab` 的 placement 只认
// `paneId` / `preferNewPane` / `replaceTab` / `revealIfOpened` —— **没有** `activate:false`，
// 也**没有** `expand:false`。所以"打开但不激活"在 DSH 侧不存在（下面①段在真包可见的树上直接断言）。
//
// 另一条硬约束：工作台自己的 `detect` 只在页签**可见**时注册
// （`50-codesys-workbench.js:769-776`），而 `tab.visible` 要求"右栏展开 + 该页签是所在 pane 的
// activeTabId"（真包 :8983）—— 所以"不激活"就等于"绑不上"。
//
// 于是本轮的做法只能是：**照旧打开（能力一步不少），探测一发出就立刻还原**。这条契约用一台
// **按真包语义**做的假右栏（openTab 一定展开 + 一定激活；页签可见才注册 detect，注册后同一个
// commit 里就 force 探测一次）把它钉死：
//   ① 真包：`openContent` 第一条 op 仍然是 `planSetExpanded(state, true)`，且没有 `activate:false`；
//   ② 一次 ensureWorkbench 之后右栏回到调用前那一面（展开态 + 激活页签），全程不切用户的 surface；
//   ③ 还原**没有**削弱能力：探测真的在"页签可见"的那一刻发出过一次；"抓住的 detect"在页签重新
//      不可见之后依然可用 —— 第二次调用零右栏动作地再探一次（幂等）；
//   ④ 用户把工作台页签关掉之后"抓住的 detect"必须作废：下一次如实重新挂一遍（能力不许静默丢失）；
//   ⑤ 会话面没挂载那种时序（真机原文 `sidebarRight: no session surface is mounted`）下，快照要
//      等会话面真的挂上再取 —— 还原的是用户真实的那一面，不是缺省值；
//   ⑥ 右栏没有这几个读取方法（老 DSH / 探针桩）时**不猜**：不记快照就不还原，且绝不抛。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const dshRoot = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh');
const shard78Path = path.join(dshRoot, 'src', '78-codesys-ai-chat.js');
const shard78 = fs.readFileSync(shard78Path, 'utf8');

const WORKBENCH_KIND = 'taskhive:codesys-workbench';

// ── ① 真包证据 ─────────────────────────────────────────────────────────────────────────────
// 这一棵树里带着 DSH 的 client bundle 就直接读它；只镜像本仓文件的树（.repo-stage）里没有，
// 那就**打印一行说明**并跳过 —— 不静默，也不假装验过。
const sidebarRightPackage = path.join(
  appRoot, 'harness', 'runtime', 'slot', 'payload', 'node_modules', '.pnpm',
  '@deepseek-ai+dsh-client-ui-_2e598f4f16f6f32b57fda79d381e6412',
  'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar-right', 'lib', 'client.js',
);
if (fs.existsSync(sidebarRightPackage)) {
  const real = fs.readFileSync(sidebarRightPackage, 'utf8');
  assert(/openContent: \(d, sessionId, intent, settled\) => \{[\s\S]{0,400}?planSetExpanded\)\(state, true\)/.test(real),
    'DSH 的 openContent 必须仍然无条件 planSetExpanded(state, true)（T192 的前提；它一变，还原策略要重新评估）');
  assert(!/activate:\s*false/.test(real),
    'DSH 的 openTab 至今没有 activate:false —— 若哪天加了，就该改用它，而不是像现在这样"打开再还原"');
  const version = JSON.parse(fs.readFileSync(path.join(sidebarRightPackage, '..', '..', 'package.json'), 'utf8')).version;
  console.log(`[证据①] 真包 @deepseek-ai/dsh-client-ui-sidebar-right@${version}：openContent 第一条 op 就是 planSetExpanded(state, true)，且全包没有 activate:false`);
} else {
  console.log(`[证据①] 这一棵树没有 DSH 的 client bundle（${sidebarRightPackage}），真包那两条断言跳过；本契约其余部分不依赖它。`);
}

// ── 假右栏：按真包语义实现（openContent 无条件展开 + 激活；页签可见才注册 detect）──────────────
function makeEnvironment(options = {}) {
  const calls = { openTab: [], focus: [], toggleExpanded: 0, detect: [], selectPanel: [], surface: [], preload: [], postMessage: [] };
  const control = { detect: null };
  const state = {
    mountedSession: options.mountedSession === undefined ? 'session-a' : options.mountedSession,
    expanded: options.expanded === true,
    tabs: (options.tabs || []).map((tab) => ({ ...tab })),
    activeTabId: String(options.activeTabId || ''),
  };
  const mountMode = options.mountMode || 'sync';
  const withSeatApi = options.withSeatApi !== false;
  const seatSubscribers = new Set();
  let syncQueued = false;

  // 座位（会话面）挂上来：真机遇上这一刻会通知 `sidebarRight.mounted` 的每一个订阅者。
  function mountSeat() {
    state.mountedSession = 'session-a';
    for (const callback of [...seatSubscribers]) {
      try { callback(); } catch { /* 一个订阅者坏掉不影响别的 */ }
    }
  }

  const workbenchTabId = () => (state.tabs.find((tab) => tab.kind === WORKBENCH_KIND) || {}).id || '';
  // 真包 :8983 的 visible：右栏展开 + 该页签是所在 pane 的 activeTabId。
  const workbenchVisible = () => state.expanded && state.activeTabId !== '' && state.activeTabId === workbenchTabId();

  // 工作台组件在 [tabVisible] effect 里注册 detect（一次 React commit 之后才跑 —— 这里用 setTimeout(0)
  // 模拟），紧接着同一个 commit 里那条"force 探测"effect 会立刻调它一次。所以"detect 非空"这个信号
  // 正是 shard 78 等的那个信号：**探测已经发出去了**。
  function syncDetectRegistration() {
    if (workbenchVisible()) {
      if (typeof control.detect !== 'function') {
        const detect = (detectOptions) => {
          calls.detect.push({ ...(detectOptions || {}), visible: workbenchVisible(), expanded: state.expanded, activeTabId: state.activeTabId });
        };
        control.detect = detect;
        // 真机 `50-codesys-workbench.js:777-782`：`if (tabVisible) { void detectCurrentProjectRef.current({ force: true }) }`
        // —— 组件自己那条 force 探测不带 reason（reason 只有 shard 78 走"复用 detect"那条路时才会带）。
        detect({ force: true });
      }
    } else if (typeof control.detect === 'function') {
      control.detect = null; // 组件 effect 的清理：页签不可见 → 注销
    }
  }
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    setTimeout(() => { syncQueued = false; syncDetectRegistration(); }, 0);
  }

  const sidebarRight = {
    openTab: (kind) => {
      // 真机语义：DSH 在没有会话面挂载时**拒绝**打开会话页签（日志原文照抄）。
      if (state.mountedSession === null) throw new Error('sidebarRight: no session surface is mounted');
      calls.openTab.push(kind);
      state.expanded = true; // 真包 :5269：无条件 planSetExpanded(state, true)
      let tab = state.tabs.find((item) => item.kind === kind);
      if (!tab) { tab = { id: options.newTabId || 'tab-workbench', kind }; state.tabs.push(tab); }
      state.activeTabId = tab.id; // 真包 :5287-5292：新建或已存在，都成为该 pane 的 activeTabId
      scheduleSync();
    },
    isExpanded: () => state.expanded,
    active: () => state.tabs.find((tab) => tab.id === state.activeTabId),
    focus: (tabId) => {
      calls.focus.push(tabId);
      if (!state.tabs.some((tab) => tab.id === tabId)) return;
      state.activeTabId = tabId;
      scheduleSync();
    },
    toggleExpanded: () => { calls.toggleExpanded += 1; state.expanded = !state.expanded; scheduleSync(); },
    tabsIn: (sessionId) => (String(sessionId) === String(state.mountedSession) ? state.tabs.map((tab) => ({ ...tab })) : []),
    // 真机的 `mounted` 是一个快照 observable：座位挂上来就通知每一个订阅者。
    mounted: { getSnapshot: () => state.mountedSession, subscribe: (callback) => { seatSubscribers.add(callback); return () => { seatSubscribers.delete(callback); }; } },
    // 测试专用：模拟用户在右栏里把工作台页签关掉（真机 = 页签的 × / closeIn）。
    closeTab: (tabId) => {
      state.tabs = state.tabs.filter((tab) => tab.id !== tabId);
      if (state.activeTabId === tabId) state.activeTabId = state.tabs.length ? state.tabs[0].id : '';
      scheduleSync();
    },
  };
  if (!withSeatApi) {
    // 老 DSH / 探针桩：只有 openTab，没有任何"看得见什么"的读取方法。
    delete sidebarRight.isExpanded;
    delete sidebarRight.active;
    delete sidebarRight.focus;
    delete sidebarRight.toggleExpanded;
    delete sidebarRight.mounted;
  }

  const window = {
    taskhive: new Proxy({}, { get: (_target, name) => (...args) => { calls.preload.push(String(name)); return Promise.resolve(null); } }),
    postMessage: (message) => { calls.postMessage.push(message); },
    __TASKHIVE_CODESYS_WORKBENCH__: { getState: () => null },
  };
  const layout = {
    selectPanel: (id) => {
      calls.selectPanel.push(id);
      if (id !== null) return;
      if (mountMode === 'sync') mountSeat();
      else if (mountMode === 'async') setTimeout(mountSeat, 0);
      // 'never'：会话面永远挂不起来。
    },
  };

  const context = vm.createContext({
    console,
    window,
    setTimeout,
    clearTimeout,
    Date,
    getOptionalService: (target, name) => (target ? target[name] : null),
    ensureRightSidebarOpen: () => true,
    codesysWorkbenchControl: control,
    layout,
  });
  vm.runInContext(shard78, context, { filename: shard78Path });
  vm.runInContext('globalThis.__ensure = codesysAiChatEnsureWorkbench; globalThis.__mount = codesysAiChatWorkbenchMount;', context);

  const sessions = {
    list: { getSnapshot: () => ({ ids: ['session-a'], byId: { 'session-a': { id: 'session-a', retainedBy: { mainView: 1 } } } }) },
    binding: (id) => (id === 'session-a' ? { session: { prompt: async () => null } } : null),
  };
  const makeCtx = () => ({ sessions, sidebarRight, layout, get: (name) => (name === 'sidebarRight' ? sidebarRight : name === 'layout' ? layout : name === 'sessions' ? sessions : null) });

  return {
    calls, control, state, sidebarRight,
    ensure: () => context.__ensure(makeCtx()),
    captured: () => context.__mount,
    tick: (ms) => new Promise((resolve) => setTimeout(resolve, ms === undefined ? 5 : ms)),
  };
}

const GUIDE_TAB = { id: 'tab-guide', kind: 'guide' };
const WORKBENCH_TAB = { id: 'tab-workbench', kind: WORKBENCH_KIND };

async function main() {
  // ── ② 右栏折叠着、工作台页签从来没开过 ────────────────────────────────────────────────────
  {
    const env = makeEnvironment({ expanded: false, tabs: [], activeTabId: '' });
    const result = await env.ensure();
    assert.strictEqual(result.ok, true, '正常路径必须成功');
    assert.strictEqual(result.started, true, '把工作台挂起来了就要如实说 started:true');
    assert.deepStrictEqual(env.calls.openTab, [WORKBENCH_KIND], '能力那一步照旧：必须真的打开 shard 80 注册的那个页签');
    assert.strictEqual(env.calls.detect.length, 1, '页签可见期间，工作台自己的 force 探测必须真的发出一次（那就是绑定）');
    assert.strictEqual(env.calls.detect[0].visible, true, '探测必须是在"页签可见"的那一刻发出的（不可见就绑不上）');
    assert.strictEqual(env.calls.detect[0].force, true, '必须是 force（绕过 45 秒节流，读的是面板当前跟随的工程）');
    assert.strictEqual(env.calls.detect[0].reason, undefined, '这一枪是工作台自己那条"页签可见就 force 探测"发出的（不是 shard 78 代它发的）');
    assert.strictEqual(env.state.expanded, false, '用户原来是折叠的 → 调用结束后必须还是折叠的（这就是"右栏看上去没变"）');
    assert.strictEqual(env.calls.toggleExpanded, 1, '折叠是"折回去"一次，不是反复开关');
    assert.deepStrictEqual(env.calls.surface, [], '绝不 openSurface(\'chat\')（不把用户从 CODESYS 面板拽回会话面）');
    assert.deepStrictEqual(env.calls.selectPanel, [], '会话面本来就在：不该动主面板');
    assert.deepStrictEqual(env.calls.preload, [], '只绑定：不写入、不编译、不确认');
    assert.deepStrictEqual(env.calls.postMessage, [], '第一级成功就不许走兜底通路');
    console.log(`[自测②] 折叠 + 页签从未打开 → openTab=${JSON.stringify(env.calls.openTab)} · 探测=${env.calls.detect.length} 次（visible=${env.calls.detect[0].visible}）· 还原：展开 ${true} → ${env.state.expanded}（toggleExpanded ${env.calls.toggleExpanded} 次）· 切界面=${env.calls.surface.length} 次`);
  }

  // ── ③ 右栏展开着、看的是 guide 页签、工作台页签已经开着但在后台（真机最常见的报障形态）────
  {
    const env = makeEnvironment({ expanded: true, tabs: [GUIDE_TAB, WORKBENCH_TAB], activeTabId: 'tab-guide' });
    const result = await env.ensure();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.started, true);
    assert.deepStrictEqual(env.calls.openTab, [WORKBENCH_KIND], '页签已经开着也要 openTab —— 这正是把工作台顶到最前的那一步');
    assert.strictEqual(env.calls.detect.length, 1, '不激活就不可能有探测：这一条证明"必须先激活才能挂载"');
    assert.strictEqual(env.calls.detect[0].visible, true);
    assert.strictEqual(env.state.expanded, true, '本来展开着 → 结束时仍然展开（不许顺手折起来）');
    assert.strictEqual(env.calls.toggleExpanded, 0, '本来展开着就不该碰展开态');
    assert.strictEqual(env.state.activeTabId, 'tab-guide', '激活页签必须还原成用户原来那一个');
    assert.deepStrictEqual(env.calls.focus, ['tab-guide'], '还原用公开的 focus(tabId) 一次到位');
    console.log(`[自测③] 展开 + guide 在前 + 工作台在后台 → 探测=${env.calls.detect.length} 次 · 还原 focus=${JSON.stringify(env.calls.focus)} → 激活页签=${env.state.activeTabId} · 展开态=${env.state.expanded}（toggleExpanded ${env.calls.toggleExpanded} 次）`);

    // ── ④ 幂等：紧接着再调一次（真机=外壳连点 / 反复开关抽屉）────────────────────────────
    await env.tick();
    assert.strictEqual(env.control.detect, null, '页签已不可见 → 组件那条 effect 的清理会把注册的 detect 注销（真机语义）');
    env.calls.openTab.length = 0;
    env.calls.focus.length = 0;
    env.calls.toggleExpanded = 0;
    env.calls.detect.length = 0;
    const again = await env.ensure();
    assert.strictEqual(again.ok, true);
    assert.strictEqual(again.started, true, '第二次同样要如实说"绑定被触发了"');
    assert.strictEqual(again.via, 'already-mounted', '走的是"复用抓住的 detect"这条路（纯观测字段）');
    assert.deepStrictEqual(env.calls.openTab, [], '第二次**零右栏动作**：不许再 openTab（不许再闪一下）');
    assert.deepStrictEqual(env.calls.focus, [], '第二次不该再动激活页签');
    assert.strictEqual(env.calls.toggleExpanded, 0, '第二次不该再动展开态');
    assert.strictEqual(env.calls.detect.length, 1, '但能力一点没少：同一个探测函数被 force 调了一次');
    assert.strictEqual(env.calls.detect[0].force, true);
    assert.strictEqual(env.calls.detect[0].reason, 'ai-chat-open', '这一枪是 shard 78 代工作台发的（reason 仍是 ai-chat-open，审计流靠它区分来源）');
    console.log(`[自测④] 幂等（连点）→ via=${again.via} · openTab=${env.calls.openTab.length} 次 · focus=${env.calls.focus.length} 次 · toggleExpanded=${env.calls.toggleExpanded} 次 · 探测=${env.calls.detect.length} 次`);

    // ── ⑤ 用户把工作台页签关掉之后：抓住的 detect 必须作废，下一次重新挂一遍 ────────────────
    env.sidebarRight.closeTab('tab-workbench');
    await env.tick();
    env.calls.openTab.length = 0;
    env.calls.detect.length = 0;
    const reopened = await env.ensure();
    assert.strictEqual(reopened.ok, true);
    assert.notStrictEqual(reopened.via, 'already-mounted', '页签没了就不能再"复用抓住的 detect"（那是一个已经卸载的组件）');
    assert.deepStrictEqual(env.calls.openTab, [WORKBENCH_KIND], '页签被关掉之后必须老老实实重新挂一遍（能力不许静默丢失）');
    assert.strictEqual(env.calls.detect.length, 1, '重新挂起来之后探测照旧发出');
    assert.strictEqual(env.state.expanded, true, '用户自己展开过右栏 → 结束时仍然展开');
    console.log(`[自测⑤] 用户关掉工作台页签 → via=${reopened.via === undefined ? '(正常路径)' : reopened.via} · openTab=${JSON.stringify(env.calls.openTab)} · 探测=${env.calls.detect.length} 次`);
  }

  // ── ⑥ 真机故障时序：会话面没挂载（openTab 被拒）→ 只挂会话面，快照要在会话面挂上之后才取 ──
  {
    const env = makeEnvironment({ mountedSession: null, expanded: true, tabs: [GUIDE_TAB, WORKBENCH_TAB], activeTabId: 'tab-guide', mountMode: 'async' });
    const result = await env.ensure();
    assert.strictEqual(result.ok, true, '会话面没挂载时必须由最小扰动那一级接管');
    assert.strictEqual(result.via, 'session-panel');
    assert.deepStrictEqual(env.calls.selectPanel, [null], '只 selectPanel(null)：把会话面挂回主面板，右栏才有宿主');
    assert.deepStrictEqual(env.calls.surface, [], '绝不 openSurface(\'chat\')（不切用户的界面）');
    assert.strictEqual(env.calls.detect.length, 1, '会话面 ready 之后探测照旧发出');
    assert.strictEqual(env.calls.detect[0].visible, true);
    assert.strictEqual(env.state.expanded, true, '快照是"会话面挂上之后、openTab 之前"取的 → 用户那一面（展开）被如实还原');
    assert.strictEqual(env.state.activeTabId, 'tab-guide', '激活页签也必须还原（不能停在会话面挂载时的缺省值上猜）');
    assert.deepStrictEqual(env.calls.focus, ['tab-guide']);
    console.log(`[自测⑥] 会话面没挂载（真机时序，异步挂载）→ selectPanel=${JSON.stringify(env.calls.selectPanel)} · 切界面=${env.calls.surface.length} 次 · 探测=${env.calls.detect.length} 次 · 还原 focus=${JSON.stringify(env.calls.focus)} → 激活页签=${env.state.activeTabId} · 展开态=${env.state.expanded}`);
  }

  // ── ⑦ 右栏没有那些读取方法（老 DSH / 探针桩）→ 不猜、不还原、绝不抛 ───────────────────────
  {
    const env = makeEnvironment({ expanded: false, tabs: [], activeTabId: '', withSeatApi: false });
    const result = await env.ensure();
    assert.strictEqual(result.ok, true, '读不到用户的右栏状态时也要照常把能力挂上');
    assert.strictEqual(result.started, true);
    assert.deepStrictEqual(env.calls.openTab, [WORKBENCH_KIND]);
    assert.deepStrictEqual(env.calls.focus, [], '不知道用户原来在哪一页，就一个还原动作都不做（宁可不动也不猜）');
    assert.strictEqual(env.calls.toggleExpanded, 0, '不知道原来是展开还是折叠，就绝不碰它');
    console.log(`[自测⑦] 右栏没有 isExpanded/active/focus/mounted → openTab=${JSON.stringify(env.calls.openTab)} · 还原动作=${env.calls.focus.length + env.calls.toggleExpanded} 个（不猜）· ok=${result.ok} started=${result.started}`);
  }

  // ── ⑧ 用户切到别的 surface（右栏座位卸载）之后：抓住的 detect 也必须作废 ────────────────────
  {
    const env = makeEnvironment({ expanded: true, tabs: [GUIDE_TAB, WORKBENCH_TAB], activeTabId: 'tab-guide' });
    await env.ensure();
    await env.tick();
    assert.strictEqual(typeof env.captured().detect, 'function', '第一次安静挂载之后必须抓住那个探测函数');
    // 真机：切到别的 surface → 会话级的右栏座位卸载（`mounted` 变回 absent），组件随之卸载。
    env.state.mountedSession = null;
    env.calls.openTab.length = 0;
    env.calls.selectPanel.length = 0;
    env.calls.detect.length = 0;
    const afterSwitch = await env.ensure();
    assert.strictEqual(afterSwitch.ok, true);
    assert.notStrictEqual(afterSwitch.via, 'already-mounted', '座位都卸载了就不许再调那个闭包（它指向一个已经不画的组件）');
    assert.deepStrictEqual(env.calls.selectPanel, [null], '必须重新把会话面挂起来（这就是"重新挂一遍"那条最小扰动路径）');
    assert(env.calls.openTab.length >= 1, '页签必须重新打开：能力宁可多花一次挂载，也不许静默丢失');
    assert.strictEqual(env.calls.detect.length, 1, '重新挂起来之后探测照旧发出');
    assert.strictEqual(env.state.expanded, true, '用户自己展开过右栏 → 结束时仍然展开');
    assert.strictEqual(env.state.activeTabId, 'tab-guide', '激活页签照旧还原');
    console.log(`[自测⑧] 切走 surface（座位卸载）→ via=${afterSwitch.via} · selectPanel=${JSON.stringify(env.calls.selectPanel)} · openTab=${env.calls.openTab.length} 次 · 探测=${env.calls.detect.length} 次 · 还原后激活页签=${env.state.activeTabId} 展开态=${env.state.expanded}`);
  }

  // ── ⑨ 全程零写入（与 T184/T191 同一条纪律，这里再钉一次）────────────────────────────────
  const codeOnly = shard78.replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['apply-and-build', 'update-text', 'create-pou', 'rebuild', 'runCodesysScriptEngineAction']) {
    assert(!codeOnly.includes(forbidden), `shard 78 的绑定/还原链路上不该出现 ${forbidden}`);
  }
  assert(!/openSurface\(\s*'chat'\s*\)/.test(codeOnly),
    'shard 78 一次都不许自己 openSurface(\'chat\') —— 那一步会把用户从 CODESYS 面板拽回会话面（T191 拿掉的就是它）');
  console.log('[自测⑨] 只绑定、零写入：本轮新增的还原动作只用 DSH 公开的 active / isExpanded / focus / toggleExpanded / tabsIn；shard 78 里 apply-and-build / runCodesysScriptEngineAction / openSurface(\'chat\') 出现次数 = 0');

  console.log('codesys ai-chat quiet right column behaviour passed (openTab 必然展开+激活 → 探测一发出就还原：用户那一面不变，能力一步不少)');
}

main().catch((error) => {
  console.error(`codesys ai-chat quiet right column behaviour failed: ${error.message}`);
  process.exitCode = 1;
});
