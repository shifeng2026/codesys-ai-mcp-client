'use strict';

// T184：**点「AI 对话」= 默认绑定工程**。
//
// 用户报障（原文）：点「AI 对话」后让 AI"写入一个名为 test 的程序"，AI 回"无法写入，因为代码
// 工作台没有绑定工程"；用户要求"点击 AI 对话时应当默认绑定工程"。
//
// 真因（可执行的那一条）：工作台的绑定与状态发布只发生在**它自己的 React 组件**里
// （`50-codesys-workbench.js` 的 `CodesysWorkbench`：挂载且页签可见 → `detectCurrentProject(
// { force: true })` → `bind-project` → 发布 `projectPath`）。抽屉打开这条路上原先没有任何一步
// 去打开那个页签或触发探测，所以只要用户这一轮没点过面板上的「代码任务」，
// `taskhive_codesys_workbench` 读到的就是空状态。
//
// 这条契约钉四件事：
//   1. 抽屉打开（`codesys:ai-chat`，open=true）必须顺手调用数据桥的 `ensureWorkbench()`，
//      而且**不新增 IPC 通道**（走同一个 `codesysAiChatBridgeCall`）；
//   2. `ensureWorkbench()` 只复用既有流程，按顺序**逐级回落**，每一级的失败都记可读原因：
//      ① 已绑定 → 直接 `bound:true`（零往返）；② 工作台页签已在 → `codesysWorkbenchControl.detect`
//      （工作台自己的 `codesys:current-project` → `bind-project` 流程）；③ 页签不在 →
//      `sidebarRight.openTab` 打开**同一个**页签 id（与 shard 80 的字面量逐字相同）；
//      ④ T186 兜底：页签开不了时（真机日志原文 `sidebarRight: no session surface is mounted`
//      —— 用户停在 CODESYS 面板、DSH 的会话面没挂载）改用外壳**既有**的「代码任务」通路，即
//      投递 `{source:'taskhive-desktop',type:'codesys.workbench.open'}`（与 main.js:3797 逐字相同），
//      由 shard 80 既有的 `openCodesysWorkbench()` 先 `openSurface('chat')` 把会话面挂起来再开页签；
//   3. 它**不写入、不编译、不确认** —— 全程只可能出现 `detect` / `openTab` / 那一条 postMessage
//      三种动作，`window.taskhive` 上的任何工程动作一次都不许发生（下面用真跑的 stub 证明）；
//   4. 取不到会话 / 两级都打不开时**不静默**：返回可读的 `{ ok:false, reason, detail }`，detail 里
//      同时有右栏页签那一级的原始原因与"点面板上的「代码任务」"，外壳只在失败时写一行。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const appRoot = path.resolve(__dirname, '..');
const dshRoot = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh');
const shard78Path = path.join(dshRoot, 'src', '78-codesys-ai-chat.js');
const shard78 = fs.readFileSync(shard78Path, 'utf8');
const shard80 = fs.readFileSync(path.join(dshRoot, 'src', '80-codesys-task-and-apply.js'), 'utf8');
const hostSource = fs.readFileSync(path.join(dshRoot, 'index.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(appRoot, 'app', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(appRoot, 'app', 'renderer', 'renderer.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(appRoot, 'app', 'preload.js'), 'utf8');

// ── 1. 抽屉打开时必须真的触发它，而且不新增通道 ────────────────────────────────────────────
assert(/const ensured = await codesysAiChatBridgeCall\('ensureWorkbench', null\)/.test(mainSource),
  'main.js 必须在打开 AI 对话抽屉时调用数据桥的 ensureWorkbench（否则"点 AI 对话默认绑定工程"无从发生）');
assert(/if \(open\) \{[\s\S]{0,120}?codesysAiChatBridgeCall\('ensureWorkbench'/.test(mainSource),
  'ensureWorkbench 只能在 open=true（打开抽屉）时调用，关闭抽屉不该触发绑定');
assert(/return \{ open, bridge: \{ reached: true, frames: probe\.frames, frame: probe\.frame, reason: '', snapshot: probe\.value \|\| null, workbench \} \}/.test(mainSource),
  'ensureWorkbench 的结果必须原样回报给外壳（外壳只在失败时写一行）');
// 不新增通道：数据桥调用器 + 现有 handleTrusted 名单一个字都不动。
assert(!/handleTrusted\('codesys:ai-chat-ensure/.test(mainSource), '不得为这件事新增 IPC 通道');
const panelOnly = /CODESYS_PANEL_ONLY_CHANNELS = new Set\(\[([\s\S]*?)\]\)/.exec(mainSource);
assert(panelOnly, 'main.js 必须有 CODESYS_PANEL_ONLY_CHANNELS 名单');
// 判据只针对**本特性**：它不许带来任何新通道。整份名单的条数由
// `codesys-panel-sender-gate-contract.js` 独占钉住（两个契约各管一件事，改动互不牵连）。
for (const forbidden of ['codesys:ai-chat-ensure', 'codesys:ai-chat-workbench', 'codesys:ai-chat-bind']) {
  assert(!panelOnly[1].includes(forbidden), `T184 不得为"打开抽屉即绑定"新增 IPC 通道（出现了 ${forbidden}）`);
}
// preload 也不该多出方法。
assert(!/ensureWorkbench/.test(preloadSource), '绑定走的不是新的 preload 方法，preload.js 不该出现 ensureWorkbench');

// 外壳：失败才写一行，成功静默。
assert(/workbenchFailure = `工作台未能绑定当前工程：\$\{String\(workbench\.detail \|\| workbench\.reason \|\| '原因未知'\)\}`/.test(rendererSource),
  '外壳必须把"工作台没绑上"的可读原因收下来（失败才一行）');
assert(/if \(workbenchFailure\) \{/.test(rendererSource), '外壳必须只在有失败原因时才写那一行');
assert(/const workbench = result\.workbench \|\| null;[\s\S]{0,220}?workbench\.ok !== true/.test(rendererSource),
  '发送第一条消息前那一次确保绑定的失败也必须可见（否则用户只看到 AI 说"没有绑定工程"）');

// ── 2. shard 78 只复用既有绑定流程 ────────────────────────────────────────────────────────
assert(/const CODESYS_AI_CHAT_WORKBENCH_TAB = 'taskhive:codesys-workbench'/.test(shard78),
  'shard 78 必须用与 shard 80 相同的页签 id 打开工作台');
const shard80Kind = /const workbenchKind = '([^']+)'/.exec(shard80);
assert(shard80Kind, 'shard 80 必须仍然用 workbenchKind 注册工作台页签');
assert.strictEqual(shard80Kind[1], 'taskhive:codesys-workbench',
  'shard 80 注册的工作台页签 id 变了：shard 78 的常量必须同步（否则打开的是一个不存在的页签）');
assert(/if \(control && typeof control\.detect === 'function'\) \{/.test(shard78) && /void control\.detect\(\{ force: true, reason: 'ai-chat-open' \}\)/.test(shard78),
  'shard 78 必须复用工作台自己的 detect（codesys:current-project → bind-project），而不是另造绑定');
assert(/sidebarRight\.openTab\(CODESYS_AI_CHAT_WORKBENCH_TAB\)/.test(shard78),
  '页签不在时必须用 ctx.sidebarRight.openTab 打开已注册的那个页签');
assert(/try \{ ensureRightSidebarOpen\(\) \} catch/.test(shard78),
  '右栏折叠时页签挂不起来：必须先复用 shard 00 既有的 ensureRightSidebarOpen() 展开右栏');
assert(/async ensureWorkbench\(\) \{/.test(shard78), '数据桥必须提供 ensureWorkbench 入口');
// T186：右栏页签失败之后的兜底必须是**外壳既有的那一条**消息 —— 与 main.js:3797 投递的 payload
// 逐字相同（source/type 都一样），否则接收者（shard 80 的 onDesktopMessage）收不到。
assert(/window\.postMessage\(\{ source: 'taskhive-desktop', type: 'codesys\.workbench\.open' \}, '\*'\)/.test(shard78),
  'T186 兜底必须投递外壳「代码任务」通路那条消息（与 main.js:3797 的 payload 逐字相同）');
assert(/window\.postMessage\(\{source:'taskhive-desktop',type:'codesys\.workbench\.open'\}, '\*'\)/.test(mainSource),
  'main.js 的 codesys:workbench-open 处理器必须仍是那一条消息（shard 78 的兜底复用它的接收者，不另造消息）');
assert(/const fallback = codesysAiChatOpenWorkbenchViaCodeTask\(\)/.test(shard78) && /if \(fallback\.ok\) \{/.test(shard78),
  'openTab 失败后必须真的走一次兜底并如实回报（started:true），不许在原地判死');
// T191：右栏页签失败之后先走**最小扰动**那一级（只 `selectPanel(null)` 挂起会话面，**不**动用户的
// surface），最后才回到外壳那条会切界面的「代码任务」通路。三级都失败时必须把三级的可读原因写进
// 同一行（用户才看得出为什么"点了还是没绑上"）。
assert(/const minimal = await codesysAiChatMountWorkbenchWithoutDragging\(ctx\)/.test(shard78)
  && /if \(minimal\.ok\) \{/.test(shard78),
  'T191：右栏页签失败后必须先试"最小扰动"那一级（挂会话面但不切用户的 surface）');
assert(/\$\{tabFailure\}；最小扰动那一级也没能挂起会话面/.test(shard78)
  && /改用外壳既有的「代码任务」通路也没能打开工作台/.test(shard78),
  '三级都失败时必须把右栏、最小扰动、兜底每一级的可读原因一起写进同一行');
// 只绑定，不写入/不编译/不确认：这些动作在 shard 78 的**代码**里一次都不许出现。删除原因写在
// 注释里是本仓惯例，所以判据必须只看代码（与 client-bundle-integrity-contract 同一个剥离器）。
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
const shard78Code = codeOnly(shard78);
for (const forbidden of ['runCodesysScriptEngineAction', 'apply-and-build', 'update-text', 'create-pou', 'rebuild']) {
  assert(!shard78Code.includes(forbidden), `shard 78 只能触发绑定，代码里不该出现 ${forbidden}`);
}
assert(!/taskhive\.(currentCodesysProject|runCodesysScriptEngineAction)/.test(shard78Code),
  '绑定必须由工作台自己的 detect 走（它才有 jobId / 草稿守卫 / 状态发布），shard 78 不直接调 preload 的工程动作');

// ── 3. 真跑一遍 ensureWorkbench（stub 环境，不碰真工程、不启动任何进程）────────────────────
function loadEnsure() {
  const calls = { preload: [], openTab: [], detect: [], rightbarOpen: 0, postMessage: [] };
  let control = null;
  let sidebarRight = { openTab: (kind) => { calls.openTab.push(kind); } };
  let sessions = null;
  // T186：`window` **默认没有 postMessage** —— 于是"两级都失败"那条路可以像修前一样被钉住；
  // 需要验证兜底通路时由用例自己装上一个记录器（③b/③c）。
  const context = vm.createContext({
    console,
    window: { taskhive: new Proxy({}, { get: (_target, name) => (...args) => { calls.preload.push(String(name)); return Promise.resolve(null); } }) },
    getOptionalService: (ctx, name) => (ctx ? ctx[name] : null),
    // shard 00 的同名函数（本 shard 只调用它，不复制它的实现）。
    ensureRightSidebarOpen: () => { calls.rightbarOpen += 1; return true; },
    codesysWorkbenchControl: null,
    __calls: calls,
  });
  context.__set = (next) => {
    if (next.control !== undefined) { control = next.control; context.codesysWorkbenchControl = next.control; }
    if (next.sidebarRight !== undefined) sidebarRight = next.sidebarRight;
    if (next.sessions !== undefined) sessions = next.sessions;
  };
  vm.runInContext(shard78, context, { filename: shard78Path });
  vm.runInContext('globalThis.__ensure = codesysAiChatEnsureWorkbench; globalThis.__state = codesysAiChatWorkbenchState;', context);
  const makeCtx = () => {
    const services = { sessions, sidebarRight };
    return { get: (name) => services[name], sessions, sidebarRight };
  };
  return { context, calls, makeCtx };
}

function sessionService(sessionIds) {
  const byId = {};
  for (const id of sessionIds) byId[id] = { id, retainedBy: { mainView: 1 } };
  return {
    list: { getSnapshot: () => ({ ids: sessionIds, byId }) },
    binding: (id) => (sessionIds.includes(id) ? { session: { prompt: async () => null } } : null),
  };
}

async function main() {
  const harness = loadEnsure();
  const { context, calls } = harness;

  // T186 兜底通路的记录器：**一开始就装上**，这样"已绑定 / 正常路径不产生任何打开动作"才是
  // 可证否的断言（否则 window 上根本没有 postMessage，那几条断言是空的）。③ 段按用例需要把它
  // 换成"没有"或"抛错"，用来分别钉住"两级都失败"的两种形态。
  const CODE_TASK_MESSAGE = { source: 'taskhive-desktop', type: 'codesys.workbench.open' };
  const recordPostMessage = (message, targetOrigin) => { calls.postMessage.push({ message, targetOrigin }); };
  context.window.postMessage = recordPostMessage;

  // ①「面板已跟随工程 A、工作台未绑定」→ 页签已在（control 已注册）时走工作台既有流程。
  context.window.__TASKHIVE_CODESYS_WORKBENCH__ = { getState: () => null };
  let detectArgs = [];
  context.__set({ sessions: sessionService(['session-a']), control: { detect: (options) => { detectArgs.push(options); return Promise.resolve(); } } });
  const started = await context.__ensure(harness.makeCtx());
  assert.strictEqual(started.ok, true, '已经挂起来的工作台必须能触发绑定');
  assert.strictEqual(started.bound, false);
  assert.strictEqual(started.started, true, '触发了绑定流程就要如实说 started');
  assert.strictEqual(started.sessionId, 'session-a');
  assert.deepStrictEqual(detectArgs.map((options) => JSON.stringify(options)), [JSON.stringify({ force: true, reason: 'ai-chat-open' })],
    '必须 force 一次工作台自己的探测（force 才会绕过 45 秒节流去读面板当前跟随的工程）');
  assert.deepStrictEqual(calls.openTab, [], '页签已经在时不该再去打开它');
  assert.deepStrictEqual(calls.postMessage, [], '页签已经在（第一级成功）时不该再投递兜底消息');
  assert.deepStrictEqual(calls.preload, [], '只绑定：这一步不许碰 window.taskhive 上的任何工程动作');
  console.log(`[自测①] 工作台页签已在、未绑定 → ensureWorkbench=${JSON.stringify({ ok: started.ok, bound: started.bound, started: started.started, sessionId: started.sessionId })} · detect 参数=${detectArgs.map((options) => JSON.stringify(options)).join('|')} · 兜底消息=${calls.postMessage.length} 次 · window.taskhive 调用=${calls.preload.length} 次`);

  // ①b 工作台已经绑定过 → 直接确认，不再触发（也不产生任何调用）。
  context.window.__TASKHIVE_CODESYS_WORKBENCH__ = { getState: () => ({ sessionId: 'session-a', projectPath: 'C:\\plc\\door.project', projectName: 'door.project' }) };
  detectArgs = [];
  const already = await context.__ensure(harness.makeCtx());
  assert.strictEqual(already.ok, true);
  assert.strictEqual(already.bound, true, '已经绑定就必须回报 bound=true（AI 工具这时已经能读到工程）');
  assert.strictEqual(already.projectPath, 'C:\\plc\\door.project');
  assert.deepStrictEqual(detectArgs, [], '已绑定就不该再触发一次探测');
  assert.deepStrictEqual(calls.openTab, []);
  assert.deepStrictEqual(calls.postMessage, [], 'T186 依赖顺序：已绑定时连兜底消息都不许投递（一次打开动作都没有）');
  console.log(`[自测①b] 工作台已绑定 → ensureWorkbench=${JSON.stringify({ ok: already.ok, bound: already.bound, projectPath: already.projectPath })} · 再触发探测=${detectArgs.length} 次 · 兜底消息=${calls.postMessage.length} 次`);

  // 会话隔离：别的会话的已绑定状态不算"本会话已绑定"。
  context.window.__TASKHIVE_CODESYS_WORKBENCH__ = { getState: () => ({ sessionId: 'session-other', projectPath: 'C:\\plc\\other.project' }) };
  detectArgs = [];
  const otherSession = await context.__ensure(harness.makeCtx());
  assert.deepStrictEqual(otherSession.bound, false, '工作台状态绝不能跨会话借用');
  assert.deepStrictEqual(detectArgs.map((options) => JSON.stringify(options)), [JSON.stringify({ force: true, reason: 'ai-chat-open' })]);

  // ②「工作台页签还没开过」→ 打开同一个页签，由组件挂载时自己 force 探测并绑定。
  context.window.__TASKHIVE_CODESYS_WORKBENCH__ = { getState: () => null };
  context.__set({ control: null });
  calls.openTab.length = 0;
  calls.rightbarOpen = 0;
  const byTab = await context.__ensure(harness.makeCtx());
  assert.strictEqual(byTab.ok, true);
  assert.strictEqual(byTab.started, true);
  assert.strictEqual(calls.rightbarOpen, 1, '打开页签之前必须先把右栏展开（否则页签挂不起来，也就不会有组件去绑定）');
  assert.deepStrictEqual(calls.openTab, ['taskhive:codesys-workbench'],
    '必须打开 shard 80 注册的那个页签（组件挂载时自己会 force 探测并绑定）');
  assert.deepStrictEqual(calls.postMessage, [], '第一级（右栏页签）成功时不许走兜底，正常路径不回归');
  assert.deepStrictEqual(calls.preload, [], '只绑定：这一步同样不许碰 window.taskhive');
  console.log(`[自测①c] 工作台页签从未打开 → ensureRightSidebarOpen=${calls.rightbarOpen} 次 · openTab=${calls.openTab.join('|')} · 兜底消息=${calls.postMessage.length} 次 · window.taskhive 调用=${calls.preload.length} 次 · ensureWorkbench=${JSON.stringify({ ok: byTab.ok, started: byTab.started })}`);

  // ②b 面板没有可用窗口/工程时不能静默：工作台自己的探测会写一行（这里钉住那一行的存在），
  //     而"连工作台都打不开"的两种失败必须由 ensureWorkbench 自己回话。
  const noProject = fs.readFileSync(path.join(dshRoot, 'src', '50-codesys-workbench.js'), 'utf8');
  assert(/setStatus\(`没有自动识别到唯一的 \.project 工程（\$\{String\(detected\?\.detection \|\| '未找到'\)\}）：请用「当前工程」一行的『刷新』或『选择工程』。`\)/.test(noProject),
    '面板没有跟随工程时，工作台必须自己写一行可读原因（那正是 ensureWorkbench 触发出来的那条路）');

  // ③ 右栏页签打不开，而且**这个文档里连 postMessage 都没有**（兜底那一级也不可用）→ 两级都失败：
  //    必须 ok:false 且带可读 detail（绝不静默）。这一段就是"最后一级真的失败"的形态。
  context.window.postMessage = undefined;
  calls.postMessage.length = 0;
  context.__set({ sidebarRight: null });
  const noTabService = await context.__ensure(harness.makeCtx());
  assert.strictEqual(noTabService.ok, false, '打不开工作台页签必须报失败，不能假装成功');
  assert(/sidebarRight\.openTab/.test(noTabService.detail) && /代码任务/.test(noTabService.detail),
    '失败原因必须可读，并给出用户能做的下一步（点面板上的「代码任务」）');
  assert(/没有 window\.postMessage/.test(noTabService.detail),
    '两级都失败时，兜底那一级的失败原因也必须写进同一行（不然用户不知道为什么"点了还是没绑上"）');

  context.__set({ sidebarRight: { openTab: () => { throw new Error('tab type not registered') } } });
  const openTabThrew = await context.__ensure(harness.makeCtx());
  assert.strictEqual(openTabThrew.ok, false);
  assert.strictEqual(openTabThrew.reason, 'workbench-tab-open-failed');
  assert(/tab type not registered/.test(openTabThrew.detail) && /代码任务/.test(openTabThrew.detail),
    '打开页签抛错时必须把原始原因与下一步一起回传');
  assert(/没有 window\.postMessage/.test(openTabThrew.detail) && /请手动点面板上的「代码任务」绑定工程/.test(openTabThrew.detail),
    '两级都失败时的文案必须具体到"点面板上的「代码任务」"');

  // ③b T186 真机复现：用户停在 CODESYS 插件面板，右栏**没有会话面**，`openTab` 抛 DSH 原文
  //     `sidebarRight: no session surface is mounted`。兜底必须接管：投递外壳「代码任务」通路那条
  //     消息（与 main.js:3797 逐字相同），并如实回报 started:true（不得停在 ok:false）。
  context.window.postMessage = recordPostMessage;
  calls.postMessage.length = 0;
  calls.openTab.length = 0;
  context.__set({ sessions: sessionService(['session-a']), control: null, sidebarRight: { openTab: () => { throw new Error('sidebarRight: no session surface is mounted') } } });
  const viaCodeTask = await context.__ensure(harness.makeCtx());
  assert.strictEqual(viaCodeTask.ok, true, '右栏没有会话面时，兜底通路必须接管（不得停在 ok:false）');
  assert.strictEqual(viaCodeTask.bound, false);
  assert.strictEqual(viaCodeTask.started, true, '兜底把工作台打开了就必须如实说 started:true');
  assert.strictEqual(viaCodeTask.via, 'code-task', '兜底成功要能看出来走的是「代码任务」通路（纯观测字段）');
  assert.deepStrictEqual(calls.postMessage.map((entry) => JSON.stringify(entry.message)), [JSON.stringify(CODE_TASK_MESSAGE)],
    '兜底必须投递外壳「代码任务」通路那条消息（source/type 与 main.js:3797 逐字相同）');
  assert.deepStrictEqual(calls.postMessage.map((entry) => entry.targetOrigin), ['*'], '投递目标必须与 main.js:3797 一致（*）');
  assert.deepStrictEqual(calls.preload, [], '兜底同样不许碰 window.taskhive（只绑定，不写入/不编译/不确认）');
  console.log(`[自测②] 右栏没有会话面（真机原文 sidebarRight: no session surface is mounted）→ 兜底投递 ${JSON.stringify(calls.postMessage.map((entry) => entry.message))} → ensureWorkbench=${JSON.stringify({ ok: viaCodeTask.ok, started: viaCodeTask.started, via: viaCodeTask.via })}`);

  // ③b' 右栏页签服务整个缺失时同样要能落到底（那一级不需要 sidebarRight）。
  calls.postMessage.length = 0;
  context.__set({ sidebarRight: null, control: null });
  const viaCodeTaskNoService = await context.__ensure(harness.makeCtx());
  assert.strictEqual(viaCodeTaskNoService.ok, true, '没有右栏页签服务时也必须由兜底接管');
  assert.strictEqual(viaCodeTaskNoService.via, 'code-task');
  assert.deepStrictEqual(calls.postMessage.map((entry) => JSON.stringify(entry.message)), [JSON.stringify(CODE_TASK_MESSAGE)]);

  // ③c 兜底也失败（postMessage 抛错）→ 两级原因都在同一行里，且仍然给出可执行的下一步。
  context.window.postMessage = () => { throw new Error('postMessage blocked') };
  context.__set({ sidebarRight: { openTab: () => { throw new Error('sidebarRight: no session surface is mounted') } } });
  const bothFailed = await context.__ensure(harness.makeCtx());
  assert.strictEqual(bothFailed.ok, false);
  assert.strictEqual(bothFailed.reason, 'workbench-tab-open-failed');
  assert(/no session surface is mounted/.test(bothFailed.detail) && /postMessage blocked/.test(bothFailed.detail),
    '两级失败时原始原因（右栏那一级 + 兜底那一级）必须都在同一行里');
  assert(/请手动点面板上的「代码任务」绑定工程/.test(bothFailed.detail), '两级失败时下一步必须具体到"点面板上的「代码任务」"');

  context.__set({ sidebarRight: { openTab: () => {} }, sessions: sessionService([]) });
  const noSession = await context.__ensure(harness.makeCtx());
  assert.strictEqual(noSession.ok, false);
  assert.strictEqual(noSession.reason, 'no-session');
  assert(/会话/.test(noSession.detail), '没有主页会话时必须说清是哪一件事没成');
  console.log(`[自测③] 打不开工作台 / 没有会话（四种失败都不静默）：
        无右栏服务（两级皆失败） → ${JSON.stringify({ ok: noTabService.ok, reason: noTabService.reason, detail: noTabService.detail })}
        openTab 抛错（两级皆失败）→ ${JSON.stringify({ ok: openTabThrew.ok, reason: openTabThrew.reason, detail: openTabThrew.detail })}
        兜底也抛错（两级皆失败） → ${JSON.stringify({ ok: bothFailed.ok, reason: bothFailed.reason, detail: bothFailed.detail })}
        没有主会话              → ${JSON.stringify({ ok: noSession.ok, reason: noSession.reason, detail: noSession.detail })}`);

  // ④ 全程零写入：整个 ensureWorkbench 只出现过 detect / openTab / 那一条 postMessage 三种动作。
  assert.deepStrictEqual(calls.preload, [], 'ensureWorkbench 一次都没有碰 window.taskhive（不写入、不编译、不确认）');
  assert(!/apply-and-build|runCodesysScriptEngineAction/.test(shard78Code),
    'shard 78 的绑定链路上不许出现写入/编译动作（apply-and-build 仍然只有工作台的确认按钮会调）');
  assert(!/codesys:workbench-open/.test(shard78Code),
    'T186 兜底不得新增或直接调用 IPC 通道：它投递的是外壳「代码任务」通路的那一条 window message');
  console.log('[自测④] 只绑定、零写入：整个 ensureWorkbench 期间 window.taskhive 调用 = ' + calls.preload.length
    + ' 次（只出现 detect / openTab / 一条 postMessage 三种动作，IPC 通道 0 个）；shard 78 的代码里 runCodesysScriptEngineAction / apply-and-build / update-text / create-pou / rebuild 出现次数 = 0');

  // ── 4. 绑定之后 AI 的工具确实能读到那个工程（用真的宿主插件跑一遍）────────────────────────
  const consoleLines = [];
  const originalLog = console.log;
  console.log = (...args) => { consoleLines.push(args.map(String).join(' ')); };
  let plugin;
  try {
    plugin = await import(pathToFileURL(path.join(dshRoot, 'index.js')).href);
  } finally {
    console.log = originalLog;
  }
  const tools = new Map();
  const routes = [];
  const context2 = {
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    inject: (deps, callback) => {
      callback({
        webServer: { register: (route) => { routes.push(route); return () => {}; } },
        webRuntime: { trustedHosts: [] },
        systemPrompt: { section: () => () => {} },
      });
      return () => {};
    },
    on: () => () => {},
    sessions: { list: () => [] },
    permissionPresets: { set() {}, names: ['danger-full-access'] },
  };
  plugin.apply(context2);
  const readTool = tools.get('taskhive_codesys_workbench');
  assert(readTool, 'taskhive_codesys_workbench 必须仍注册着');
  const exec = { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-a' } } };

  const before = await readTool.execute({}, exec);
  assert.strictEqual(before.available, false, '没打开工作台时必须如实说不存在');
  assert(before.nextStep && /taskhive_codesys_workbench/.test(before.nextStep) && /AI 对话/.test(before.nextStep),
    '未绑定的返回里必须给出可执行的下一步（重试本工具 / 打开「代码任务」），而不是只报"没有绑定"');

  // 工作台绑定后会发布状态（与 50-codesys-workbench.js 同一形状），这里按同一条路发布。
  const publish = {
    writeHead() {},
    end() {},
  };
  const payload = Buffer.from(JSON.stringify({
    sessionId: 'session-a',
    state: {
      sessionId: 'session-a', projectPath: 'C:\\plc\\door.project', projectName: 'door.project', jobId: 'job-17',
      writeAvailable: true, objectCount: 3, visible: true, updatedAt: new Date().toISOString(),
      openObject: null, changedObjects: [], pendingProposal: null,
    },
  }));
  const request = {
    url: '/taskhive/api/codesys.workbench.publish',
    method: 'POST',
    headers: { host: '127.0.0.1:55134', 'content-type': 'application/json' },
    on(event, handler) {
      if (event === 'data') setImmediate(() => handler(payload));
      if (event === 'end') setImmediate(() => handler());
      return this;
    },
    destroy() {},
  };
  await routes[0].handler(request, publish);
  const after = await readTool.execute({}, exec);
  assert.strictEqual(after.available, true, '绑定并发布之后 AI 必须能读到工作台');
  assert.strictEqual(after.projectBound, true, '① 面板跟随工程 A、绑定成功后：AI 工具必须看到 projectBound=true');
  assert.strictEqual(after.projectPath, 'C:\\plc\\door.project');
  assert.strictEqual(after.nextStep, '', '已绑定时不该再有"下一步"提示');
  assert(!/尚未绑定/.test(after.note), '已绑定时不该再说尚未绑定');

  // 另一种失败面：工作台开着但没绑上任何工程 —— 同样是可执行的下一步。
  const unboundPayload = Buffer.from(JSON.stringify({ sessionId: 'session-b', state: { sessionId: 'session-b', projectPath: '', jobId: '', openObject: null, changedObjects: [] } }));
  await routes[0].handler({
    url: '/taskhive/api/codesys.workbench.publish', method: 'POST',
    headers: { host: '127.0.0.1:55134', 'content-type': 'application/json' },
    on(event, handler) { if (event === 'data') setImmediate(() => handler(unboundPayload)); if (event === 'end') setImmediate(() => handler()); return this; },
    destroy() {},
  }, { writeHead() {}, end() {} });
  const unbound = await readTool.execute({}, { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-b' } } });
  assert.strictEqual(unbound.projectBound, false);
  assert(/尚未绑定/.test(unbound.note), '未绑定必须如实说（外壳与模型都靠这句话）');
  assert(unbound.nextStep && /代码任务/.test(unbound.nextStep), '未绑定必须给出可执行的下一步');

  // 提案工具在未绑定时也必须给同一条下一步，而不是一句"没有绑定"。
  const proposeTool = tools.get('taskhive_codesys_workbench_propose');
  await assert.rejects(
    async () => proposeTool.execute({ summary: 'x', changes: [{ objectName: 'test', operation: 'create-pou', declaration: 'PROGRAM test\nEND_PROGRAM' }] }, { signal: { throwIfAborted() {} }, agent: { session: { id: 'session-c' } } }),
    (error) => /尚未绑定工程/.test(error.message) && /AI 对话/.test(error.message) && /确认写入工程/.test(error.message),
    '未绑定时提交差异必须失败得可执行：说清没绑定 + 下一步 + 写入仍然要用户确认',
  );

  console.log('[自测①②] host 侧：绑定并发布之前 taskhive_codesys_workbench = ' + JSON.stringify({ available: before.available, projectBound: before.projectBound })
    + ' · nextStep=' + JSON.stringify(before.nextStep.slice(0, 60)) + '…');
  console.log('[自测①] host 侧：绑定并发布之后 taskhive_codesys_workbench = ' + JSON.stringify({ available: after.available, projectBound: after.projectBound, projectPath: after.projectPath, nextStep: after.nextStep })
    + '   ← AI 调工具时已经能看到那个工程');
  console.log('[自测②] host 侧：工作台开着但没绑上 = ' + JSON.stringify({ projectBound: unbound.projectBound, note: unbound.note.slice(0, 40) + '…', nextStep: unbound.nextStep.slice(0, 40) + '…' }));

  console.log('codesys ai-chat default binding contract passed (ensureWorkbench → bind only, actionable when unbound)');
}

main().catch((error) => {
  console.error(`codesys ai-chat default binding contract failed: ${error.message}`);
  process.exitCode = 1;
});
