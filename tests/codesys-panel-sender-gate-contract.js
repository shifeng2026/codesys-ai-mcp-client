'use strict';

// T166：**只允许外壳 CODESYS 面板调用的通道**必须有身份门，且名单不能悄悄变。
//
// 背景：这些通道原先只有 `isTrustedSender`（默认对 DSH 文档开放）。而 **DSH 文档里跑着工作台
// 客户端插件**，所以"给它们加 `allowHarness:false`"是错的 —— 那会把工作台自己弄坏（T151 踩过
// 同类）。正确做法是**发送方身份判定**：要求 sender 就是 CODESYS 面板那个原生 surface。
//
// 这条契约钉三件事：
//   1. 名单**精确**等于下面这 17 个（新增要显式改这里；减少说明有人删了门）；
//   2. **两边都用**的通道（`scriptengine-action` / `code-ai-request` / `workbench-open`）绝不能进名单
//      —— 工作台要靠它们工作；
//   3. 门真的接在 `handleTrusted` 里，并且判定是**可验证的文档身份**（外壳 WebContents + 顶层帧 +
//      `app/renderer` 文档树），不是"当前 surface 标志恰好是 codesys"。
//
// T185 变动（名单从 12 变成 13）：用户报「原会话（主页那条）有一个"待回答"，但 CODESYS 插件的
// AI 对话抽屉不显示这个待回答，于是一直卡住」。修法里新增 `codesys:ai-chat-answer` —— 它是本项目
// **唯一**能替用户把一条 `ask_user_question` 交回去的通道，也就是最需要"只能由面板触发"这条身份门
// 的地方：DSH 文档里的任何代码（包括 AI 自己装/写的插件）都不许把用户的提问答掉。
// 它同样"只有外壳面板会调"（preload 方法 `codesysAiChatAnswer` 只出现在 app/renderer/renderer.js，
// DSH 客户端 bundle 里 0 次），判据与上面三条完全相同。
//
// T174 变动（名单从 9 变成 11）：用户要求"AI 对话不调用原生右侧栏，改成 CODESYS 插件面板
// 自己做一个右侧栏"。于是对话框界面搬进外壳面板，DSH 文档里只剩两个**纯数据**入口，宿主侧新增
// `codesys:ai-chat-snapshot` / `codesys:ai-chat-prompt`（见 main.js 的 codesysAiChatBridgeCall）。
// 它们**只有**外壳 CODESYS 面板会调（`codesysAiChatSnapshot` / `codesysAiChatPrompt` 这两个 preload
// 方法只出现在 `app/renderer/renderer.js`，在 DSH 客户端 bundle 里 0 次），而且能直接读主页会话
// 快照、往主页会话里塞 prompt —— 正是最该挡住 DSH 文档里其它代码的两个通道，所以按同一条门登记。
//
// T175 变动（名单从 11 变成 12）：用户在真机上看到抽屉之后提出"会话调用的主会话的接口，可以选择
// 模型"。于是新增 `codesys:ai-chat-model`（`{action:'list'}` 读整份模型目录 / `{action:'select',id}`
// 改**这条会话**用的模型）。它同样是"只有外壳面板会调、却能读主页会话的模型目录并改主页那条会话
// 下一次请求用的模型"，判据与上面两条完全相同。
//
// T191 变动（名单从 13 变成 14）：用户口径「AI 对话就是唯一操作面，工作台只做能力提供」——工作台的
// 差异原文、「确认写入工程」与编译结果都搬进抽屉消息流。于是新增 `codesys:ai-chat-apply`：它是本项目
// **唯一**能把"用户在抽屉里点了一下"变成工程写入的通道（写入本体仍是工作台那枚按钮调的同一个
// `apply-and-build`，见 50-codesys-workbench.js 的 `applyProposal`）。preload 方法 `codesysAiChatApply`
// 只出现在外壳 `app/renderer/renderer.js`（DSH 客户端 bundle 里 0 次），而 DSH 文档里的任何代码都
// 不该能凭一条消息或一次轮询写用户工程 —— 所以它必须挂在这道"只能由面板触发"的身份门上。
//
// T192 变动（名单从 14 变成 15）：用户报「测试程序虽然写进去了，但是我每次都要重新启动 codesys 程序
// 才会看到」。写入走离线作业改的是磁盘上的 `.project`，而运行中的 GUI 把工程读在内存里不会自己读盘；
// CODESYS 3.5 又没有可编程的重载入口（脚本 API / 全量菜单定义 / 二进制字符串三重证据，见
// app/codesys-native-host.js 的 reloadProject 注释）。回落的「让 CODESYS 重新加载」是**唯一**会往用户
// 正在运行的 CODESYS 里发一条命令的通道（PostMessage WM_COMMAND），preload 方法
// `codesysNativeHostReloadProject` 只出现在外壳 `app/renderer/renderer.js`（DSH 客户端 bundle 里 0 次），
// 所以按同一条判据登记：DSH 文档里的任何代码都不许去动用户的 IDE。
//
// ── T193 变动（判据本身，名单不变）：把"当前 surface 恰好是 codesys"换成可验证的**文档身份** ──────
//
// 真机证据（`logs/desktop.log`，2026-10-04 那一轮连续约 2 小时）：`codesys:ai-chat-snapshot` 被拒
// **2604** 次、约每 2 秒一条，`frameUrl` 全部是
// `file:///<app>/resources/app/app/renderer/index.html?embed=1&surface=chat`
// —— 那是**面板自己**的文档（`showPluginSurface` 就是用它 `loadFile` 的），`sender` 恒为 3。
// 本轮实测：外壳视图的 webContents id = 3，DSH harness 文档帧 = 2（从 DSH 帧调同一个通道会记
// `sender:2` + `http://127.0.0.1:<port>/`）—— 所以被拒的确实是面板，而旧判据的
// `pluginSurfaceKind === 'codesys'` 才是那一半。根因：`showPluginSurface()` 先 `addChildView`
// （面板可见），之后 `await codesysNativeHost.resume(...)`（当时无超时）才写 `pluginSurfaceKind`；
// 那次 await 卡住时面板可见而 identity 停在旧值，抽屉里只剩"只能由 TaskHive 的 CODESYS 面板调用"。
//
// 修法（意图不变，判据更硬）：合法宿主 = **外壳那个 WebContents 的顶层 `app/renderer` 文档**。
// 仍然拒绝：DSH harness 文档帧、任意子帧、被塞进外壳窗口的其它 `file://` 文档、别的 WebContents。
// 下面的断言是**双向**的：合法宿主（含"surface 标志滞后"那一种）必须通过；四类非法宿主必须仍被拒。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const appDir = path.join(__dirname, '..', 'app');
const main = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
const { isAppRendererFileUrl } = require(path.join(appDir, 'ipc-trust'));

const EXPECTED = [
  'codesys:ai-chat',
  'codesys:ai-chat-answer',
  'codesys:ai-chat-apply',
  'codesys:ai-chat-model',
  'codesys:ai-chat-prompt',
  'codesys:ai-chat-snapshot',
  'codesys:list-windows',
  'codesys:native-host-attach',
  'codesys:native-host-detach',
  'codesys:native-host-move',
  'codesys:native-host-reload-project',
  'codesys:open-program',
  'codesys:scriptengine-configure',
  'codesys:scriptengine-probe',
  'codesys:scriptengine-status',
  // T199 item 2 (list grew from 15 to 17): the "pre-open on start" switch moved out of the
  // environment variable and into the settings page. The two channels that read and write it
  // are called ONLY by the shell renderer document (`app/renderer/renderer.js`, loaded into
  // `pluginSurfaceView`), and they decide whether every future start spends ~38-67 s of
  // CODESYS CPU/disk and holds ~670 MB resident. Same criterion as every entry above: the
  // preload methods appear in the shell renderer and 0 times in the DSH bundle/sources, so
  // code inside the DSH document (including AI-installed plugins) must not be able to flip
  // the user's background-cost switch.
  'settings:codesys-preopen',
  'settings:codesys-preopen-save',
];

const setMatch = /CODESYS_PANEL_ONLY_CHANNELS = new Set\(\[([\s\S]*?)\]\)/.exec(main);
assert(setMatch, 'main.js 必须有 CODESYS_PANEL_ONLY_CHANNELS 名单');
const names = [...setMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepStrictEqual([...names].sort(), [...EXPECTED].sort(), '面板专属通道名单必须精确等于契约里的清单');

// 名单里的每个通道都必须真的注册着（否则是死条目）。
for (const name of names) {
  assert(main.includes(`handleTrusted('${name}'`), `名单里的 ${name} 没有对应的 handleTrusted 注册（死条目）`);
}

// 工作台要用的通道**绝不能**进名单。
for (const mustStayOpen of ['codesys:scriptengine-action', 'codesys:code-ai-request', 'codesys:workbench-open']) {
  assert(!names.includes(mustStayOpen), `${mustStayOpen} 是工作台在用的通道，不能加"仅面板"门（会让工作台失效）`);
}

// 门必须真的接在 `handleTrusted` 上，而不是只定义了个没人用的函数。
assert(/if \(CODESYS_PANEL_ONLY_CHANNELS\.has\(channel\)\) \{/.test(main),
  '身份门必须接在 handleTrusted 的调用路径上');
assert(/const panel = panelSenderDecision\(event\);\s*\n\s*if \(!panel\.allowed\) \{/.test(main),
  'handleTrusted 必须用 panelSenderDecision 的判定结果决定放行/拒绝');

// ── 双向断言①：判定函数必须**可执行地**放行合法宿主、拒绝四类非法宿主 ────────────────────────
// 从 main.js 里取出 `panelSenderDecision` 的函数源，在 vm 里用**真的** `isAppRendererFileUrl`
// （与 isTrustedSender 同一口径）跑起来 —— 这样"合法宿主能过 / 非法宿主仍被拒"是被执行验证的，
// 而不是只靠正则看代码长什么样。
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start > 0, `main.js 必须有 ${name} 的定义`);
  let depth = 0;
  let inString = '';
  let escaped = false;
  let index = source.indexOf('{', start);
  assert(index > start, `${name} 必须有函数体`);
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (inString) { if (char === inString) inString = ''; continue; }
    if (char === '"' || char === "'" || char === '`') { inString = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') { depth -= 1; if (depth === 0) { index += 1; break; } }
  }
  return source.slice(start, index);
}

const decisionSource = extractFunction(main, 'panelSenderDecision');
const sandbox = {
  path,
  isAppRendererFileUrl,
  __dirname: appDir,
  console,
  pluginSurfaceView: null,
  pluginSurfaceKind: null,
};
vm.createContext(sandbox);
vm.runInContext(`${decisionSource}\nglobalThis.__panelSenderDecision = panelSenderDecision;`, sandbox, { filename: 'main.js#panelSenderDecision' });
const decision = (event) => sandbox.__panelSenderDecision(event);

const rendererDocumentUrl = `${pathToFileURL(path.join(appDir, 'renderer', 'index.html')).href}?embed=1&surface=chat`;
const harnessDocumentUrl = 'http://127.0.0.1:54141/';

function shellEvent({ url = rendererDocumentUrl, topFrame = true, destroyed = false, sender = undefined } = {}) {
  const contents = { isDestroyed: () => destroyed, mainFrame: { url: topFrame ? url : harnessDocumentUrl } };
  sandbox.pluginSurfaceView = { webContents: contents };
  const frame = topFrame ? contents.mainFrame : { url };
  return { sender: sender === undefined ? contents : sender, senderFrame: frame };
}

// ① 合法宿主：外壳插件视图的顶层 app/renderer 文档 —— **包括 surface 标志滞后/为 null 的那一种**
//    （真机回归场景：面板可见而 `pluginSurfaceKind` 还没落笔）。
for (const surfaceKind of ['codesys', null, 'chat', 'settings', 'web-ai']) {
  sandbox.pluginSurfaceKind = surfaceKind;
  const verdict = decision(shellEvent());
  assert.strictEqual(verdict.allowed, true,
    `外壳面板自己的文档必须放行（surfaceKind=${String(surfaceKind)}）：${verdict.reason}`);
}
// ② 非法宿主 A：别的 WebContents（例如 DSH 主窗口 / 任意渲染器）。
sandbox.pluginSurfaceKind = 'codesys';
const otherWindow = { isDestroyed: () => false, mainFrame: { url: harnessDocumentUrl } };
let verdict = decision({ sender: otherWindow, senderFrame: otherWindow.mainFrame });
assert.strictEqual(verdict.allowed, false, '别的 WebContents 必须被拒');
assert.strictEqual(verdict.reason, 'sender-not-shell-renderer-webcontents');
// ③ 非法宿主 B：子帧（preload 不开 nodeIntegrationInSubFrames，子帧只可能是伪造的）。
verdict = decision(shellEvent({ topFrame: false }));
assert.strictEqual(verdict.allowed, false, '子帧必须被拒');
assert.strictEqual(verdict.reason, 'panel-call-not-top-frame');
// ④ 非法宿主 C：外壳视图里被塞进来的**非 app/renderer** 文档（harness 文档 / 任意本地 HTML）。
for (const url of [harnessDocumentUrl, 'file:///C:/Users/Public/evil.html', `${rendererDocumentUrl.replace('/renderer/', '/renderer/../../')}`, 'about:blank']) {
  verdict = decision(shellEvent({ url }));
  assert.strictEqual(verdict.allowed, false, `非 app/renderer 文档必须被拒：${url}`);
  assert.strictEqual(verdict.reason, 'shell-document-not-app-renderer');
}
// ⑤ 非法宿主 D：外壳视图已经销毁。
verdict = decision(shellEvent({ destroyed: true }));
assert.strictEqual(verdict.allowed, false, '外壳视图销毁后必须被拒');

// ── 双向断言②：15 个通道的 preload 方法在 DSH 侧（bundle + src/**）**一个调用点都没有** ────────
// 这是"不给 harness 帧开口子"的依据：合法宿主只有外壳面板一个。哪一天 DSH 侧真的开始调它们，
// 这条会红，提醒我们重新审视请求者身份（而不是把门放宽成 true）。
const preload = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
const preloadMethods = new Map();
for (const match of preload.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g)) {
  preloadMethods.set(match[2], match[1]);
}
const dshRoot = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh');
const dshFiles = [path.join(dshRoot, 'client.js')];
for (const entry of fs.readdirSync(path.join(dshRoot, 'src'))) {
  if (entry.endsWith('.js')) dshFiles.push(path.join(dshRoot, 'src', entry));
}
const dshSource = dshFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
for (const channel of names) {
  const method = preloadMethods.get(channel);
  assert(method, `preload 必须暴露面板专属通道 ${channel}（否则门后没有入口）`);
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(method), `${channel} 的 preload 方法名必须是合法标识符（实际 ${method}）`);
  assert(!dshSource.includes(`taskhive.${method}(`),
    `${method} 是面板专属通道 ${channel}，DSH 侧不该通过 preload 调它（否则这道门会拦住工作台）`);
}

// ── T174/T175：新登记的通道必须真的是"只有外壳在用"，判据与 T166 登记名单时相同 ──────────
const dshBundle = fs.readFileSync(path.join(dshRoot, 'client.js'), 'utf8');
const dshAiChat = fs.readFileSync(path.join(dshRoot, 'src', '78-codesys-ai-chat.js'), 'utf8');
const shellRenderer = fs.readFileSync(path.join(appDir, 'renderer', 'renderer.js'), 'utf8');
for (const method of ['codesysAiChatSnapshot', 'codesysAiChatPrompt', 'codesysAiChatModel', 'codesysAiChatAnswer', 'codesysAiChatApply', 'codesysNativeHostReloadProject']) {
  // 只查**调用形态**（`taskhive.<method>(`）：shard 78 里有同名的内部函数（数据桥自己那一侧），
  // 那是注册方而不是调用方 —— 判据必须落在"谁通过 preload 发起 IPC"上。
  assert(!dshBundle.includes(`taskhive.${method}`), `${method} 只在 CODESYS 面板里用，DSH 客户端 bundle 不该通过 preload 调它`);
  assert(!dshAiChat.includes(`taskhive.${method}`), `${method} 只在 CODESYS 面板里用（shard 78 是数据桥，不是调用方）`);
  assert(shellRenderer.includes(`taskhive.${method}`), `外壳 CODESYS 面板必须真的调用 ${method}`);
}
// 数据桥的注册者只能有一个：DSH 侧 shard 78（它才有 sessions 服务）。
assert(dshAiChat.includes('__TASKHIVE_CODESYS_AI_BRIDGE__'), 'shard 78 必须仍然是数据桥入口的注册者');
assert(!/__TASKHIVE_CODESYS_AI_BRIDGE__\s*=/.test(shellRenderer), '数据桥入口是 DSH 文档里的东西，外壳不该自己造一个');

// ── 双向断言③：内联守卫必须与门同一判定，且**没有任何一处**再靠 surface 标志判身份 ──────────
assert(!main.includes('event.sender !== pluginSurfaceView?.webContents'),
  '不许再有"只看 webContents 相等就放行/拒绝"的内联守卫：身份判定只能走 panelSenderDecision');
const inlineGuardCount = (main.match(/if \(!isCodesysPanelSender\(event\)\)/g) || []).length;
assert(inlineGuardCount >= 3,
  `原生托管那三条通道（attach / move / reload-project）的内联守卫必须复用同一判定（实际 ${inlineGuardCount} 处）`);
assert(/if \(!isCodesysPanelSender\(event\)\) throw new Error\('CODESYS 原生托管只能从中央插件页面开启'\)/.test(main),
  'native-host-attach 的内联守卫必须复用 isCodesysPanelSender');
assert(/if \(!isCodesysPanelSender\(event\)\) throw new Error\('让 CODESYS 重新加载只能由 TaskHive 的 CODESYS 面板触发'\)/.test(main),
  'native-host-reload-project 的内联守卫必须复用 isCodesysPanelSender');

// ── 双向断言④：根因（"先可见、后落笔 identity"）必须被钉住 ─────────────────────────────────
// 拒绝也要自带原因：下一次"又拦错了"必须一眼能看出是第几道闸、期望身份是什么。
assert(/function reportUntrustedIpc\(channel, event, reason, extra\)/.test(main),
  'reportUntrustedIpc 必须能记下拒绝原因');
assert(/\.\.\.\(reason \? \{ reason: String\(reason\) \} : \{\}\)/.test(main), '拒绝日志必须带 reason 字段');
assert(/not-codesys-panel-sender:\$\{panel\.reason\}/.test(main), '面板门的拒绝必须写明 panelSenderDecision 给的原因');
assert(/expected: panel\.expected, surfaceKind: panel\.surfaceKind/.test(main), '面板门的拒绝必须带上期望身份与当时的 surface 标志');

const surfaceFn = extractFunction(main, 'showPluginSurface');
const kindAssignAt = surfaceFn.indexOf('pluginSurfaceKind = kind;');
const attachAt = surfaceFn.indexOf('addChildView(pluginSurfaceView)');
assert(kindAssignAt > 0 && attachAt > 0, 'showPluginSurface 必须同时有 identity 落笔与视图挂载');
assert(kindAssignAt < attachAt,
  'showPluginSurface 必须**先记 pluginSurfaceKind、再让视图可见**（真机上两者分叉就是 2604 条 blocked-ipc 的根因）');
assert(/Promise\.race\(\[\s*\n?\s*codesysNativeHost\.resume\(bounds\)\.catch\(\(\) => \{\}\)/.test(surfaceFn),
  'showPluginSurface 里那句 resume 必须有界（不能再让一次窗口过渡卡住整条 surface 链）');

console.log(`codesys panel sender gate contract passed (${names.length} channels; 双向：合法宿主放行 / harness 帧·子帧·外部文档·别的 WebContents 仍被拒)`);
