'use strict';

// Integrity of the generated DSH client bundle.
//
// `dsh/client.js` is generated: the editable source is `dsh/src/*.js`, and those
// fragments are verbatim, contiguous slices of the bundle (splitting them out was
// verified to reassemble byte for byte, with only the generated-file banner added).
// A build step is unavoidable because the DSH client loader resolves modules from a
// static table — a second client file fails with "missed the module table ... no
// registered package factory" — so the bundle cannot be split at runtime.
//
// The hazard this guards is specific and likely: someone edits `dsh/client.js`
// directly (it is the file that actually runs), and the next `--write` silently
// discards that work. Failing here is the cheap way to find out.

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const dshDir = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh');
const srcDir = path.join(dshDir, 'src');
const bundlePath = path.join(dshDir, 'client.js');

assert(fs.existsSync(bundlePath), 'dsh/client.js must exist');
assert(fs.existsSync(srcDir), 'dsh/src/ must exist (the bundle is generated from it)');

const entries = fs.readdirSync(srcDir, { withFileTypes: true });
const stray = entries.filter((entry) => !entry.isFile() || !entry.name.endsWith('.js'));
assert.deepStrictEqual(stray.map((entry) => entry.name), [], 'dsh/src/ must contain only .js fragments');

const fragmentNames = entries.map((entry) => entry.name).sort();
// T159：**片段集必须精确固定**。旧断言的 `>= 8` 抓不住"某个片段被删掉"——
// `tools/build-client-bundle.js --check` 只比较"当前存在的片段"与 bundle，所以
// 删掉 75-knowledge-view.js 后 `--write` + `--check` 会双双通过（INV-23 记录的那次事故
// 就是这样把知识库视图整份删掉的）。这里把名单与最小行数都钉住。
const EXPECTED_FRAGMENTS = [
  '00-core-and-surfaces.js',
  '10-codesys-proposal-and-tree.js',
  '20-codesys-and-session-apis.js',
  '30-dialogs-and-panels.js',
  '40-session-records-panel.js',
  '50-codesys-workbench.js',
  '60-skin-and-embedded-surfaces.js',
  '70-layout-and-navigation-bridges.js',
  '75-knowledge-view.js',
  '78-codesys-ai-chat.js',
  '79-native-model-merge.js',
  '80-codesys-task-and-apply.js',
];
assert.deepStrictEqual(
  fragmentNames,
  EXPECTED_FRAGMENTS,
  'dsh/src/ 的片段集必须与清单完全一致（缺失/新增都要在这里显式更新，否则 --check 抓不到片段被删）',
);
assert.strictEqual(fragmentNames[0], '00-core-and-surfaces.js', 'the numeric prefixes define the assembly order; the core fragment must come first');

const fragments = fragmentNames.map((name) => {
  const text = fs.readFileSync(path.join(srcDir, name), 'utf8');
  assert(text.trim().length > 0, `fragment ${name} is empty`);
  return { name, text };
});

// 每个承重片段的**最小体量**：明显缩水说明它被截断或替换成了占位内容。
const MIN_LINES = {
  '00-core-and-surfaces.js': 100,
  '50-codesys-workbench.js': 1000,
  '75-knowledge-view.js': 700,
  '78-codesys-ai-chat.js': 200,
  '80-codesys-task-and-apply.js': 400,
};
for (const [name, minLines] of Object.entries(MIN_LINES)) {
  const fragment = fragments.find((item) => item.name === name);
  const lines = fragment.text.split('\n').length;
  assert(lines >= minLines, `fragment ${name} looks truncated (${lines} lines < ${minLines})`);
}
// 知识库视图必须真的在包里（它是最容易被"重新生成"整份吃掉的那一个）。
const knowledge = fragments.find((item) => item.name === '75-knowledge-view.js');
assert(/data-taskhive-knowledge|tk-cover/.test(knowledge.text), 'the knowledge view fragment must still contain the knowledge surface markers');

// T174：AI 对话的**界面**搬进外壳 CODESYS 面板（用户原话：「ai 对话不调用原生的右侧栏，而是
// 直接在 codesys 插件里面做一个右侧栏，这样每次更新右侧栏就不需要重新适配」）。于是 shard 78
// 必须退化成**纯数据桥**：不建 DOM、不 import React、不查 DSH 的右栏容器。这几条断言就是
// "以后 DSH 改布局也不会再影响这个界面"的可执行版本。
//
// 与 codesys-window-fit-contract.js 同一个道理：删除原因写在注释里（本仓惯例），所以"某个符号
// 已经消失"这类断言必须只看**代码**。下面这个剥离器认得 `'`/`"`/模板字符串与转义。
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

const aiChat = fragments.find((item) => item.name === '78-codesys-ai-chat.js');
const aiChatCode = codeOnly(aiChat.text);
assert(/__TASKHIVE_CODESYS_AI_BRIDGE__/.test(aiChatCode), 'shard 78 必须注册数据桥入口 window.__TASKHIVE_CODESYS_AI_BRIDGE__');
assert(/async snapshot\(/.test(aiChatCode) && /async prompt\(/.test(aiChatCode), 'shard 78 的数据桥必须同时提供 snapshot 与 prompt');
// T175：用户在真机上看到抽屉之后要求"会话调用的主会话的接口，可以选择模型"。模型也必须走同一条
// 纯数据桥（shard 78 只读会话的 `modelSelection` 投影 + `modelDirectories`/`remote.session`），
// 界面照旧**只在**外壳面板里。
assert(/async models\(/.test(aiChatCode) && /async setModel\(/.test(aiChatCode), 'shard 78 的数据桥必须提供 models() 与 setModel(id)');
assert(/modelDirectories/.test(aiChatCode), 'shard 78 必须用 DSH 真实的模型服务 modelDirectories（与主页 composer 同一个服务）');
// T176：**"哪条会话"必须按 DSH 0.2 的判据来取**。DSH 0.2 的 `sessions.list` 快照只有
// `{ ids, byId, phase, projectionsBySession }`（见 `dsh-api-session-controller/lib/client.js`
// 的 list store 初值与 `projectList()`），`current` 字段已被删除；旧代码读它 → 恒为空串 →
// `models()`/`snapshot()`/`prompt()` 一起返回 `no-session`，用户在真机上看到的就是下拉里的
// `模型目录不可用`（本轮修复的原始报错，审计流 `logs/trajectory.jsonl` 有原文）。
// 判据与 DSH 原生 UI 一致：`retainedBy.mainView > 0` 的那条（`dsh-client-ui-session` 的
// `publishMain()`、`dsh-client-ui-workspace` 的 `replaceMain(… { source: 'mainView' })`），
// 本仓的 shard 80 也已按它修过。这条断言把"退回读 current"变成一次红灯。
assert(/retainedBy/.test(aiChatCode) && /mainView/.test(aiChatCode),
  'shard 78 必须用 retainedBy.mainView 判据定位主视图会话（DSH 0.2 已删除 sessions.list.current）');
assert(!/getSnapshot\?\.\(\)\?\.current|getSnapshot\(\)\.current/.test(aiChatCode),
  'shard 78 不得再把 sessions.list 快照的 current 当作"当前会话"的唯一来源（DSH 0.2 没有这个字段）');
// provider 级不可用必须回传出来（外壳按它画禁用条目），否则"标注 + 禁止选中"无从实现。
assert(/blocked/.test(aiChatCode), 'shard 78 必须把 modelCatalog.failures 作为 blocked 回传给外壳（不可路由的 provider 要被标注并禁止选中）');
assert(!/rightbarCol/.test(aiChatCode), 'shard 78 不得再查询 DSH 右栏容器（界面已搬进 CODESYS 面板）');
for (const forbidden of ['createRoot', 'React.useState', 'React.useEffect', 'createElement', 'document.createElement', 'document.querySelector', 'document.querySelectorAll', 'document.body', 'appendChild', '.remove()']) {
  assert(!aiChatCode.includes(forbidden), `shard 78 不得再渲染任何 UI：出现了 ${forbidden}`);
}
// 只查**赋值形态**：删除原因写在注释里（本仓的惯例），注释里出现旧名字不算回归。
assert(!/__TASKHIVE_(TOGGLE|OPEN)_CODESYS_AI__\s*=/.test(aiChatCode),
  'shard 78 的旧"跨框架打开对话框"全局函数必须删除（它们是"点了没反应"的那条脆弱路径）');
// 反向：外壳必须自己渲染对话栏并走数据桥，而且不得再去 DSH 文档里找右栏。
const shellRenderer = fs.readFileSync(path.join(appRoot, 'app', 'renderer', 'renderer.js'), 'utf8');
assert(shellRenderer.includes('codesys-ai-drawer'), '外壳 CODESYS 面板必须自己渲染 AI 对话栏（#codesys-ai-drawer）');
assert(shellRenderer.includes('codesysAiChatSnapshot') && shellRenderer.includes('codesysAiChatPrompt'), '外壳必须通过 preload 的两个数据桥方法收发消息');
assert(!shellRenderer.includes('rightbarCol'), '外壳不得去找 DSH 的右栏容器');
// T175 的两条可执行要求：① 抽屉宽度可拖动（左边缘 role=separator 的把手 + localStorage 持久化）；
// ② 抽屉里能选模型（外壳调 preload 的 codesysAiChatModel，界面元素 #codesys-ai-model）。
assert(shellRenderer.includes('codesys-ai-resizer') && shellRenderer.includes('role="separator"') && shellRenderer.includes('aria-orientation="vertical"'),
  '外壳抽屉必须有可拖动的左边缘把手（role=separator + aria-orientation=vertical）');
assert(shellRenderer.includes('taskhive.codesysAiDrawerWidth'), '抽屉宽度必须持久化到 localStorage');
assert(shellRenderer.includes('codesys-ai-model') && shellRenderer.includes('taskhive.codesysAiChatModel'),
  '外壳抽屉必须有模型选择器，并走 preload 的 codesysAiChatModel 通道');
// T176②：模型选择器必须在**输入框底下**（用户原话：「框底下切换吗？」）。位置关系与主界面
// composer 一致：`@deepseek-ai/dsh-client-ui-conversation` 的 `skeleton/InputBar` 把模型座位放在
// `.uV2eYG_card` 的**底行** `.uV2eYG_row`（tools/…/trailing）里，输入区在它上面。
const composeStart = shellRenderer.indexOf('class="codesys-ai-compose"');
const composeEnd = composeStart < 0 ? -1 : shellRenderer.indexOf('</aside>', composeStart);
const composeShell = composeStart >= 0 && composeEnd > composeStart ? shellRenderer.slice(composeStart, composeEnd) : '';
assert(composeShell, '外壳抽屉必须有输入卡片 .codesys-ai-compose');
assert(composeShell.includes('id="codesys-ai-draft"') && composeShell.includes('id="codesys-ai-model"') && composeShell.includes('id="codesys-ai-send"'),
  '输入卡片里必须同时有输入框、模型选择器与发送按钮');
assert(composeShell.indexOf('id="codesys-ai-draft"') < composeShell.indexOf('id="codesys-ai-model"'),
  '模型选择器必须出现在输入框（#codesys-ai-draft）**之后** —— 用户要的是"框底下切换"');
assert(composeShell.includes('class="codesys-ai-inputrow"') && composeShell.indexOf('class="codesys-ai-inputrow"') < composeShell.indexOf('id="codesys-ai-send"'),
  '模型选择器必须与发送按钮同处底行（.codesys-ai-inputrow）');
assert(composeShell.indexOf('id="codesys-ai-model"') < composeShell.indexOf('id="codesys-ai-send"'),
  '底行里模型选择器在左、发送按钮在右（与主界面 .uV2eYG_row 的 space-between 一致）');
// ── T186：思考强度（推理等级 / `reasoningEffort`）─────────────────────────────────────────────
//
// 用户要求（本轮）：抽屉里能选思考强度；UI 与既有模型选择**同款**；等级**不自造枚举**，从模型描述符
// 的 `reasoning` 能力取（真包 `dsh-client-ui-model-selection/lib/client.js:121/522/524-532/782`）；
// 模型不支持时**不显示**该控件；`reasoningEffort` 必须走**会话级**；成功路径零新增常驻文字。
// 这几条就是它们的可执行版本 —— 三条一起把"等级是猜的 / 控件是空的 / 又开了一条通道"变成红灯。
assert(/async setModel\(/.test(aiChatCode),
  'shard 78 的数据桥必须继续提供 setModel（T186 起它的入参是 `{ id, effort? }`，也接受老的裸 id 串）');
assert(/reasoningEffort: effort/.test(aiChatCode),
  'shard 78 必须把 reasoningEffort **真的**带进 select / selectModel（会话级写入，不许只在注释里说）');
assert(/codesysAiChatReasoningCapability\(model\.reasoning\)/.test(aiChatCode),
  'shard 78 必须把模型自己的 reasoning 能力（defaultEffort / efforts）随目录回传给外壳 —— 等级不许自造');
assert(/\.some\(\(level\) => level\.id === effort\)/.test(aiChatCode),
  'shard 78 必须在发请求前校验档位确实在那个模型声明的清单里（与 host 侧 dsh-llm/lib/index.js:2182 同口径）');
assert(!/CODESYS_AI_(EFFORT|REASONING)_LEVELS|'low', 'high', 'max'|"low", "high", "max"/.test(aiChatCode),
  'shard 78 不得自造一份推理等级枚举（清单只能来自模型描述符）');
// 外壳那一侧：控件与模型座位**同款**（复用同一套 class，所以 168px / 256px 两条几何只有一处定义），
// 并且"不支持就不显示"必须是**真的**在写 `hidden`。
assert(shellRenderer.includes('id="codesys-ai-effort"') && shellRenderer.includes('codesys-ai-effort-seat'),
  '外壳抽屉必须有推理等级座位（#codesys-ai-effort + 它的座位外壳）');
assert(/class="codesys-ai-model-trigger codesys-ai-effort-trigger"/.test(shellRenderer)
  && /class="codesys-ai-model-menu codesys-ai-effort-menu"/.test(shellRenderer),
  '推理等级控件必须复用模型座位那套 class（同款观感，且几何只有一处定义）');
assert(composeShell.indexOf('id="codesys-ai-model"') < composeShell.indexOf('id="codesys-ai-effort"')
  && composeShell.indexOf('id="codesys-ai-effort"') < composeShell.indexOf('id="codesys-ai-send"'),
  '底行顺序必须是 模型 → 推理等级 → 发送（既有元素一个不少，等级夹在中间）');
assert(/seatNode\.hidden = true/.test(shellRenderer) && /id="codesys-ai-effort-seat" class="codesys-ai-effort-seat" hidden/.test(shellRenderer),
  '不支持推理等级的模型必须**不显示**这个控件（markup 默认 hidden + 渲染时写 hidden=true）');
assert(shellRenderer.includes("codesysAiChatModel({ action: 'select', id: modelId, effort: value })"),
  '外壳必须把 effort 交给**既有**通道的 select 动作（写入只在用户点击时发生）');
assert(!/codesys-ai-(template|quick|chip)/.test(shellRenderer),
  '推理等级是**选择器**不是模板入口：.codesys-ai-* 里不得出现模板/快捷按钮记号（T180/T181 的 0 命中）');
const preloadSource = fs.readFileSync(path.join(appRoot, 'app', 'preload.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(appRoot, 'app', 'main.js'), 'utf8');
assert(preloadSource.includes("codesysAiChatModel: (input) => ipcRenderer.invoke('codesys:ai-chat-model', input || {})"),
  'preload 的模型通道必须是 input 原样透传（所以 effort 不需要新通道）');
assert(!preloadSource.includes("'codesys:ai-chat-effort'") && !mainSource.includes("'codesys:ai-chat-effort'"),
  '不得为推理等级新增 IPC 通道（复用 codesys:ai-chat-model 的 select 动作）');
assert(/codesysAiChatBridgeCall\('setModel', effort \? \{ id, effort \} : \{ id \}\)/.test(mainSource),
  'main.js 必须把 effort 原样交给数据桥的 setModel（没有 effort 时载荷形状与改动前一模一样）');
// T176③：监视舞台与对话栏**在同一行内等高**（用户原话：「监视区域 ui 高度和会话高度没有对齐很难看」）。
// `align-items: stretch` + 两栏 `height: 100%` + `min-height: 0` 是可执行的那一条；另外托盘必须待在
// `.codesys-body` **外面** —— 它一旦回到监视舞台上方，就会把舞台的顶边压低、两栏再也不等高了。
const overrides = fs.readFileSync(path.join(appRoot, 'app', 'renderer', 'ui-overrides.css'), 'utf8');
assert(/\.codesys-body \{[^}]*align-items: stretch/.test(overrides), '.codesys-body 必须是 align-items:stretch 的同一行');
assert(!/\.codesys-body \{[^}]*flex-wrap/.test(overrides), '.codesys-body 不能换行（换行就不再是"同一行内等高"）');
assert(/\.codesys-stage \{[^}]*height: 100%[^}]*min-height: 0[^}]*\}|\.codesys-stage \{[^}]*min-height: 0[^}]*height: 100%[^}]*\}/.test(overrides), '监视舞台必须是 height:100% + min-height:0');
assert(/\.codesys-ai-drawer \{[^}]*height: 100%[^}]*min-height: 0[^}]*\}|\.codesys-ai-drawer \{[^}]*min-height: 0[^}]*height: 100%[^}]*\}/.test(overrides), '对话栏必须是 height:100% + min-height:0');
// T186：T180 的两条几何一条都不许动。推理等级座位**复用**模型座位那套 class，所以这两条仍然只有
// 一处定义 —— 这条断言同时钉住"以后的等级改动不会顺手把模型胶囊/浮层的封顶改掉"。
assert(/\.codesys-ai-model-trigger \{[^}]*max-width: 168px/.test(overrides), '模型胶囊必须仍然是 max-width: 168px（T180）');
assert(/\.codesys-ai-model-menu \{[^}]*max-width: 256px/.test(overrides), '浮层必须仍然是 max-width: 256px（T180）');
// 两个座位的浮层都要在 `[hidden]` 时真的消失（作者样式的 display 会盖掉 UA 的 [hidden]）。
assert(/\.codesys-ai-effort-seat\[hidden\] \{[^}]*display: none/.test(overrides), '等级座位外壳必须在 [hidden] 时 display:none（"不支持就不显示"的可执行那一半）');
assert(/@media \(max-width: 900px\) \{[\s\S]{0,900}?\.codesys-ai-drawer \{ position: absolute; top: 0; right: 0; bottom: 0;[\s\S]{0,200}?height: auto;/.test(overrides),
  '覆盖式抽屉必须用 top/bottom 铺满同一条纵向带，并把 height 收回 auto（否则 height:100% 与 inset 打架）');
const bodyStart = shellRenderer.indexOf('class="codesys-body"');
const trayIndex = shellRenderer.indexOf('class="codesys-output-tray"');
assert(trayIndex >= 0 && bodyStart > trayIndex, '输出托盘必须在 .codesys-body **之前**：留在监视舞台上方会把它的上边缘压低，两栏就不等高了');
// T176④：原生 HWND 的几何逻辑一个字都没动 —— 舞台仍然是 #stream-result，门口那两个函数仍在。
assert(/function codesysNativeBounds\(selected = state\.selectedWindow\) \{[\s\S]{0,260}?const panel = \$\('#stream-result'\)/.test(shellRenderer),
  'codesysNativeBounds() 必须继续从 #stream-result 的矩形算真实 HWND 的几何');
assert(/function codesysAiChatOverlayRect\(\) \{[\s\S]{0,320}?matchMedia\('\(max-width: 900px\)'\)/.test(shellRenderer),
  'codesysAiChatOverlayRect() 的覆盖式判据必须仍是同一条 CSS 条件（max-width: 900px）');

// The bundle must be exactly: banner + fragments, in filename order.
const bundle = fs.readFileSync(bundlePath, 'utf8');
const joined = fragments.map((fragment) => fragment.text).join('');
assert(bundle.endsWith(joined), 'dsh/client.js must end with the concatenated dsh/src fragments — regenerate with tools/build-client-bundle.js');

const banner = bundle.slice(0, bundle.length - joined.length);
assert(/GENERATED FILE/.test(banner), 'the generated banner must be present so the file is not mistaken for source');
assert(/build-client-bundle\.js/.test(banner), 'the banner must name the tool that regenerates the bundle');

// The largest responsibility must stay its own fragment: that is the whole point of
// the split (a workbench change should not touch the skin or the layout bridge).
const workbench = fragments.find((fragment) => /workbench/.test(fragment.name));
assert(workbench, 'the codesys workbench must remain a named fragment');
const workbenchLines = workbench.text.split('\n').length;
assert(workbenchLines > 1000, `the workbench fragment looks wrong (${workbenchLines} lines)`);
// Match the DEFINITION, not a call site: `apply(ctx)` in the tail fragment mentions
// the bridge by name, which is not where it lives.
const layoutDefinition = /function installWorkspaceGeometryBridge\b/;
assert(!layoutDefinition.test(workbench.text), 'the layout bridge must not be defined inside the workbench fragment');
const layoutOwners = fragments.filter((fragment) => layoutDefinition.test(fragment.text));
assert.strictEqual(layoutOwners.length, 1, 'the layout bridge must be defined in exactly one fragment');
assert(
  /bridge|layout/.test(layoutOwners[0].name),
  `the layout bridge must have its own responsibility fragment, but it is defined in ${layoutOwners[0].name}`,
);

// Finally, run the build tool's own check (end to end, including its banner text).
const tool = path.join(appRoot, 'tools', 'build-client-bundle.js');
assert(fs.existsSync(tool), 'tools/build-client-bundle.js must exist');
const result = spawnSync(process.execPath, [tool, '--check'], { stdio: 'inherit', cwd: appRoot });
assert.strictEqual(result.status, 0, 'tools/build-client-bundle.js --check must agree that the bundle matches the fragments');

// ── T199: the concurrent `--write` guard is real, not a documented convention ──────────────
//
// The hazard: `--write` reads dsh/src/*.js, concatenates and overwrites dsh/client.js holding
// nothing in between, so two writers that started from different fragment states race and the
// loser's fragment edit never reaches the bundle. Serial dispatch was the only defence, which
// is a human protocol. These assertions exercise the guard through the real CLI, because the
// guard is only worth having if the process actually refuses.
//
// The lock path is derived from the resolved bundle path by the tool itself; the same
// derivation is repeated here on purpose, so a contract failure is what tells us the two
// drifted apart. It lives in the OS temp directory: `dsh/` is compared byte for byte across
// the three trees, so a lock file left behind there would surface as TREE-ONLY parity drift.
const lockPath = path.join(
  os.tmpdir(),
  `taskhive-client-bundle-${crypto.createHash('sha1').update(bundlePath).digest('hex').slice(0, 12)}.lock`,
);
const shaOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const bundleShaBeforeGuards = shaOf(bundlePath);
const quiet = { stdio: ['ignore', 'pipe', 'pipe'], cwd: appRoot, encoding: 'utf8' };

// The tool re-reads the lock body after an exclusive create, so tests must not leave one behind
// even if an assertion throws. The callback observes lock presence itself, because this cleanup
// deletes the file on the way out.
const withLock = (body, run) => {
  fs.writeFileSync(lockPath, body);
  try {
    return run();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* already reclaimed by the guard */ }
  }
};

// (1) A holder that is provably alive on this machine must make `--write` refuse, and must not
//     touch the bundle. `process.pid` is this contract's own live process — the strongest
//     available stand-in for "another writer is mid-build".
const liveHeld = JSON.stringify({ pid: process.pid, host: os.hostname(), atMs: Date.now(), at: new Date().toISOString(), bundle: bundlePath });
const liveRun = withLock(liveHeld, () => {
  const spawned = spawnSync(process.execPath, [tool, '--write'], quiet);
  return { spawned, lockKept: fs.existsSync(lockPath) };
});
assert.notStrictEqual(liveRun.spawned.status, 0, 'a --write while another live holder owns the lock must fail, not write');
assert(/refusing to --write/.test(liveRun.spawned.stderr), `the refusal must name itself on stderr, got: ${liveRun.spawned.stderr}`);
assert(/still running/.test(liveRun.spawned.stderr), 'the refusal must report that the holder process is alive (case-insensitive host match)');
assert.strictEqual(shaOf(bundlePath), bundleShaBeforeGuards, 'a refused --write must leave dsh/client.js byte-identical');
assert(liveRun.lockKept, 'a refused --write must not delete the holder\'s lock');

// (2) A lock whose body is not readable yet (the exclusive create and the body write are two
//     steps, so a reader can catch it empty) must count as HELD, not as stale. Treating it as
//     stale would reopen the very race the lock closes.
const tornRun = withLock('', () => {
  const spawned = spawnSync(process.execPath, [tool, '--write'], quiet);
  return { spawned, lockKept: fs.existsSync(lockPath) };
});
assert.notStrictEqual(tornRun.spawned.status, 0, 'an unreadable/empty lock body must be treated as held, not reclaimed');
assert(/refusing to --write/.test(tornRun.spawned.stderr), 'the torn-lock refusal must name itself on stderr');
assert.strictEqual(shaOf(bundlePath), bundleShaBeforeGuards, 'a torn-lock refusal must leave dsh/client.js byte-identical');
assert(tornRun.lockKept, 'a torn-lock refusal must not delete a lock it did not prove stale');

// (3) A lock whose holder is gone AND which is older than the staleness window must be
//     reclaimed, so a killed writer can never wedge the build permanently. The write that
//     follows is a byte-identical no-op here (the fragments are settled), which also proves
//     the guard does not perturb the generated output.
const staleAt = Date.now() - (5 * 60 * 1000) - 60_000;
const staleHeld = JSON.stringify({ pid: 0x7ffffff0, host: os.hostname(), atMs: staleAt, at: new Date(staleAt).toISOString(), bundle: bundlePath });
const reclaimed = withLock(staleHeld, () => spawnSync(process.execPath, [tool, '--write'], quiet));
assert.strictEqual(reclaimed.status, 0, `a stale lock must be reclaimed so the build can proceed, got: ${reclaimed.stderr}`);
assert(/reclaimed a stale lock/.test(reclaimed.stderr), 'reclaiming a stale lock must be announced, not silent');
assert.strictEqual(shaOf(bundlePath), bundleShaBeforeGuards, 'reclaiming a stale lock must still produce byte-identical output');
assert(!fs.existsSync(lockPath), 'a successful --write must release its own lock (no lock may outlive the build)');

// (4) The other two guards cannot be driven deterministically from outside the process (both
//     windows are sub-millisecond), so their WIRING is asserted instead of faked: the source
//     must re-read the fragments after taking the lock, and re-read the bundle before writing.
//     This is a weaker claim than (1)-(3) and is labelled as one on purpose.
const toolSource = fs.readFileSync(tool, 'utf8');
assert(/const again = fragments\(\);/.test(toolSource),
  'the --write path must re-read dsh/src/*.js after acquiring the lock (lost-update guard)');
assert(/fingerprint\(again\) !== fingerprint\(parts\)/.test(toolSource),
  'the re-read fragments must be compared against the fragments this build assembled');
assert(/onDisk !== built && onDisk !== startBundle/.test(toolSource),
  'the --write path must re-read dsh/client.js before writing (direct-edit guard)');

console.log(`client bundle integrity contract passed (${fragments.length} fragments, ${joined.split('\n').length - 1} lines assembled byte-exactly; T199 write guard: refuse=ok torn=held stale=reclaimed)`);
