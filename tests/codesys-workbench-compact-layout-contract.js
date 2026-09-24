'use strict';

// T081 — CODESYS 代码工作台的紧凑布局合同。
//
// 用户口径：
//   "提高代码项目树的占用比例，把当前工程功能块移到 codesys 代码工作台同一行…
//    缩小代码任务和工程写入功能块高度，可以改成一行显示，代码任务不需要保留
//    输入框，代码任务实际功能是和 ai 模型对接；空出来的区域都给代码编辑器"
//
// 这个合同锁住"省下来的高度真的给了编辑器"这件事：三行带（顶栏 / 工作区 /
// 命令条）+ 唯一的可伸缩行 + 被移除的四个功能区（当前工程卡片、代码任务输入框、
// 工程写入详情行、工程写入按钮行）。任何一个被重新加回来都会让断言失败。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(
  path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js'),
  'utf8',
);

// ── 1. 三行带结构 ──────────────────────────────────────────────────────────
assert(
  client.includes('grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr) auto auto!important'),
  'the workbench root must be a single-column, four-band grid whose only flexible row is the editor row',
);
assert(
  client.includes('[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor{grid-row:2;min-height:0!important;height:auto!important;display:grid!important;overflow:hidden!important}'),
  'the object tree + code editor must own row 2, the only flexible band',
);
// T082: the composer and the write panel are no longer two differently-styled boxes
// (a bare 30px button beside a bordered 38px card) — they are merged into ONE bar.
// T086: and that bar is now **write-only**; the AI entry moved to the header.
assert(
  client.includes('[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar{grid-row:3;box-sizing:border-box;display:flex!important;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;min-height:38px;padding:3px 8px!important;border:1px solid var(--th-line);border-radius:8px!important;background:var(--th-surface-2)}'),
  '工程写入 must keep its single bordered bar',
);
assert(
  !client.includes('>.taskhive-codesys-composer{grid-column:1') && !client.includes('>.taskhive-codesys-write-panel{grid-column:2'),
  'the two-box command row must be gone for good',
);
assert(
  client.includes("className: `taskhive-codesys-commandbar ${writeAvailable ? 'is-ready' : 'is-blocked'}`") &&
    client.includes("'data-codesys-commandbar': 'true'"),
  'the one bar must carry the ready/blocked state that the write panel used to own',
);
// T086: 用户反馈"代码任务和最后一行的 UI 有割裂感"——根因是同一盒里放了两个同款实心
// 主按钮，却分属 AI 入口与落盘写入两个域。修法：AI 入口搬到顶栏，底部条只剩写入。
assert(
  !client.includes('taskhive-codesys-command-sep'),
  'the group divider must be gone: the bar no longer holds two domains',
);
assert(
  client.includes("'aria-label': '工程写入状态', 'data-codesys-commandbar': 'true'"),
  'the bar must now describe only the write state',
);
const headerStart = client.indexOf("h('header', { className: 'taskhive-codesys-header' },");
const barStart = client.indexOf("h('section', {\n          className: `taskhive-codesys-commandbar");
assert(
  client.indexOf('h(CodesysTaskComposer, { jobId, busy, sessionId, selectedName') > headerStart &&
    (barStart < 0 || client.indexOf('h(CodesysTaskComposer, { jobId, busy, sessionId, selectedName') < barStart),
  'the AI entry must render inside the header, never inside the write bar',
);
assert(
  client.includes('grid-template-rows:auto auto minmax(360px,1fr)'),
  'the 1.0.2 base rule must stay present so the historic contract keeps passing',
);

// ── 2. 当前工程并进顶栏 ────────────────────────────────────────────────────
const headerIndex = client.indexOf("h('header', { className: 'taskhive-codesys-header' },");
assert(headerIndex > 0, 'the workbench header must exist');
// T097: 顶栏切片用"下一个稳定标记"界定，而不是固定 4600 字符 —— 顶栏里加一个动作
// （编译图标 + 说明注释）就足以把徽章挤出那个固定窗口，让这条断言变成假失败。
const headerEnd = client.indexOf("h('div', { className: 'taskhive-codesys-editor', ref: editorRowRef },", headerIndex);
assert(headerEnd > headerIndex, 'the header slice must end at the editor row marker');
const headerSlice = client.slice(headerIndex, headerEnd);
assert(
  headerSlice.includes("h('section', { className: 'taskhive-codesys-project'"),
  'the 当前工程 block must live INSIDE the header row (T081), not in its own band',
);
// 本轮：用户要求删掉「离线工程 / 当前工程」徽章，并把标题统一为「工作台」。
assert(
  !headerSlice.includes('taskhive-codesys-header-badges') &&
    !client.includes('taskhive-codesys-offline-badge') &&
    !client.includes("'离线工程'") && !client.includes("'当前工程'") &&
    !client.includes('taskhive-codesys-title-long') && !client.includes('taskhive-codesys-title-short'),
  'the 离线工程 badge and the long/short title pair must be gone',
);
assert(
  client.includes("h('strong', null, '工作台')") &&
    client.includes('title: `CODESYS 工作台 · Harness 会话：${sessionId || \'未连接\'}`'),
  'the header title must read 工作台 (full name stays in the tooltip)',
);
assert(
  !client.includes('[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-project'),
  'no CSS may still target 当前工程 as a direct child of the workbench root',
);
assert(
  client.includes("'data-codesys-project-path': 'true'") &&
    client.includes("'data-codesys-detect-project': 'true'") &&
    client.includes("'data-codesys-select-project': 'true'") &&
    client.includes("'data-codesys-open-projects': 'true'") &&
    client.includes("'data-codesys-rollback': 'true'") &&
    client.includes("'data-codesys-compile': 'true'"),
  'every project control the desktop probes use must survive the move, and the new compile entry must exist',
);
// T097: 「复制当前工程绝对路径」与「在资源管理器定位当前工程」已按用户要求移除（路径本身
// 仍在只读输入框里可选中复制）。契约反过来钉住"不存在"，把它们加回来会立刻失败 --
// 桌面探针 probeCodesysWorkbenchProject 也改成断言不存在，两边必须一致。
assert(
  !client.includes("'data-codesys-copy-project-path': 'true'") &&
    !client.includes("'data-codesys-reveal-project': 'true'"),
  'the copy-path and reveal-in-explorer controls must stay removed',
);

// ── 3. AI 审核入口：一个命名命令，不是替用户编的话 ──────────────────────────
assert(
  !client.includes("className: 'taskhive-codesys-prompt'"),
  'the 代码任务 textarea must be gone: the request belongs in the Harness conversation',
);
assert(
  client.includes("className: 'taskhive-codesys-action taskhive-codesys-action-text taskhive-codesys-action-ai', type: 'submit', 'data-codesys-code-task': 'true'"),
  'the AI entry must be a header-level action button, styled apart from the project plumbing',
);
assert(
  client.includes("h('span', { className: 'taskhive-codesys-action-label' }, 'AI 审核')") &&
    client.includes("'aria-label': 'AI 审核当前打开的代码对象'"),
  'the button must be a named command (AI 审核), not a paraphrase of a user request',
);
assert(
  client.includes('审核工作台当前打开的对象「${target}」：给出可直接写入工程的完整代码') &&
    client.includes('审核工作台当前工程：挑出最值得修改的代码对象'),
  'the sent command must be a faithful restatement of the clicked action',
);
assert(
  client.includes("void onSubmitRef.current?.(reviewCommand, () => {})"),
  'the button must go through the existing Harness submit pipeline',
);
assert(
  !client.includes('用户要求：${taskPrompt}'),
  'the button must stop inventing a "用户要求" the user never said',
);
assert(
  client.includes("binding.session.prompt([{ type: 'text', text: instruction }], 'queue')"),
  'the AI hand-off itself must not regress',
);

// ── 4. 工程写入压成一行 ────────────────────────────────────────────────────
assert(
  !client.includes("className: 'taskhive-codesys-write-actions'"),
  'the 工程写入 action row must be gone; the controls are direct children of the one-line panel',
);
const writeIndex = client.indexOf("'data-codesys-write-panel': 'true'");
assert(writeIndex > 0, 'the one command bar must keep the write-panel marker for probes');
const writeSlice = client.slice(writeIndex, writeIndex + 2600);
assert(
  writeSlice.includes("'data-codesys-write-state': 'true'") &&
    writeSlice.includes("'data-codesys-write-reason': 'true'") &&
    writeSlice.includes("'data-codesys-confirm-write': 'true'"),
  'the write state, reason and confirm controls must all survive',
);
// T085: the bar's 「重新检测」 was the same call as the header's 「刷新」, so it is gone
// for good; the freed width must go to the flexible reason text, and the header refresh
// (the only remaining detection entry) must advertise the full scope in its tooltip.
assert(
  !client.includes("'data-codesys-write-recheck'") && !client.includes('taskhive-codesys-write-recheck'),
  'the duplicated 重新检测 button and its CSS must stay removed',
);
assert(
  client.includes('重新检测当前 CODESYS 窗口中的工程、ScriptEngine 与写入权限'),
  'the remaining header refresh must advertise that it also re-checks ScriptEngine and write permission',
);
assert(
  client.includes('[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-detail{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'),
  'the blocking reason must keep the flexible slot that the removed button freed',
);
assert(
  !writeSlice.includes("h('div', { className: 'taskhive-codesys-write-heading' }"),
  'the write heading must be a bare label, not a nested row',
);
// T083: the labels are shortened so the one bar fits a 400px sidebar; the full
// meaning stays in each control's title.
assert(
  client.includes("'已核对'") && !client.includes("'已核对差异'") && !client.includes("'我已查看项目树标记和逐行代码差异'"),
  'the review gate label must be shortened to 已核对 (full sentence stays in its title)',
);
assert(
  client.includes("'确认写入'") && !client.includes("'确认写入工程（离线编译）'"),
  'the confirm button label must be shortened to 确认写入 (offline-compile note stays in its title)',
);
assert(
  client.includes("h('span', { className: 'taskhive-codesys-action-label' }, 'AI 审核')"),
  'the AI entry label must be the short named command AI 审核 (T086)',
);
assert(
  client.includes("'创建恢复快照后写入当前工程并执行离线编译'"),
  'the shortened confirm button must keep the full action in its title',
);
assert(
  client.includes("const writeStateLabel = writeAvailable") &&
    client.includes("? (effectiveChanges.length ? '可写入' : '等待 AI 改动')") &&
    client.includes(": '不可写入'"),
  'the write state must collapse to a short status word',
);
assert(
  client.includes(": (writeBlockReason || activeProject?.writeBlockReason || '请先绑定可写工程')"),
  'the blocking REASON must move into the flexible detail span, not the fixed-width state word',
);
assert(
  client.includes("'data-codesys-review-accepted': 'true'"),
  'the review gate must stay a real, probeable checkbox',
);
assert(
  client.includes('.taskhive-codesys-review{flex:0 0 auto;display:inline-flex'),
  'the review gate must be laid out inline inside the command row',
);
assert(
  client.includes('title: writeStateDetail, \'data-codesys-write-reason\': \'true\''),
  'the full write reason must move to a tooltip instead of a dedicated line',
);

// ── 5. 顶栏与命令条在窄栏里换行而不是溢出 ──────────────────────────────────
assert(
  client.includes('[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header{display:flex!important;flex-wrap:wrap;align-items:center;justify-content:flex-start'),
  'the header must wrap instead of overflowing a 280px sidebar',
);
assert(
  client.includes('[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar{grid-row:3;box-sizing:border-box;display:flex!important;flex-wrap:wrap'),
  'the single command bar must wrap its controls instead of overflowing',
);
assert(
  client.includes('[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy small{display:none}'),
  'the duplicate Harness session label must not consume header width (the link chip says it)',
);

// ── 6. 省下来的高度真的给了编辑器 ──────────────────────────────────────────
assert(
  client.includes('readStoredFraction(CODESYS_LAYOUT_KEYS.tree, 0.52)'),
  'the tree default share must rise from 0.42 to 0.52',
);
assert(
  client.includes('var(--th-tree-fr,0.52fr)'),
  'the CSS fallback for the tree share must match the JS default',
);
assert(
  client.includes("'--th-tree-fr': `${treeFraction}fr`"),
  'the CSS variable wiring must be unchanged',
);
assert(
  client.includes('.taskhive-codesys-legend{display:flex;flex-wrap:nowrap'),
  'the colour legend must be a single line so the tree keeps its height',
);
assert(
  client.includes('max-height:64px;overflow:auto'),
  'assistant/proposal text must be capped instead of pushing the editor',
);
// T082: the bottom is ONE small-text row, not two (status + safety).
assert(
  client.includes("h('footer', { className: 'taskhive-codesys-statusrow' }"),
  'status and safety must share one footer row',
);
assert(
  client.includes("className: 'taskhive-codesys-safety', tabIndex: 0, title: safetyText, 'aria-label': safetyText, 'data-codesys-safety': 'true' }, 'ⓘ 安全边界'"),
  'the safety statement must survive as a focusable ⓘ whose tooltip carries the full text',
);
assert(
  client.includes('[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-statusrow{display:flex!important;align-items:center;gap:6px;min-width:0}'),
  'the one small-text row must be a single flex line',
);
assert(
  !client.includes('>.taskhive-codesys-status,') && !client.includes('>.taskhive-codesys-safety{'),
  'status and safety must no longer be separate top-level bands',
);
// T082: the 全展开/全折叠 buttons were removed by user request.
assert(
  !client.includes("'data-codesys-tree-expand'"),
  'the 全展开/全折叠 buttons must stay removed',
);
assert(
  client.includes("'aria-label': '项目树过滤'"),
  'the tree toolbar is now filters only',
);

// ── 7. T084 顶栏真的落在一行 ────────────────────────────────────────────────
// 用户报告："第一行的ui为什么乱了，现在变成两行了"。根因：T081 把「当前工程」搬进
// 顶栏后，内容是 标题 + 字段名 + 路径 + 5 个文字按钮 + 2 个徽章 ≈ 730px，而默认
// 侧栏可用约 384px —— 任何宽度都折行。修法：低频操作图标化 + 缩短文案 + 窄栏隐藏
// 次要信息，并用容器查询分档。
assert(
  client.includes('container-type:inline-size;container-name:taskhive-codesys'),
  'the workbench root must be a container so the header can react to its OWN width, not the window',
);
assert(
  client.includes('@container taskhive-codesys (max-width: 619px)') &&
    client.includes('@container taskhive-codesys (max-width: 379px)') &&
    client.includes('@container taskhive-codesys (max-width: 339px)'),
  'all three narrow-header tiers must exist',
);
assert(
  client.includes('@container taskhive-codesys (min-width: 620px)'),
  'a wide panel must keep a roomier path field',
);

const ALL_ACTION_LABELS = ['刷新', '选择工程', 'AI 审核', '编译', '回退',
  '登录', '断开', '下载', '在线修改', '启动', '停止', '复位', '写值', 'Force', '取消强制'];
assert(
  ALL_ACTION_LABELS.every((label) => client.includes(`h('span', { className: 'taskhive-codesys-action-label' }, '${label}')`)),
  'every one of the 15 fixed first-row functions must carry a text label',
);
// 「扫描设备」是第 16 个入口，但它的文案会变（绑定设备后变成「已绑定」），
// 所以单独断言：它同样必须带文字标签（窄栏才允许退化成一个图标）。
assert(
  client.includes("h('span', { className: 'taskhive-codesys-action-label' }, onlineBound ? onlineBoundLabel : '扫描设备')"),
  'the scan entry must keep its text label (it becomes 已绑定 after binding a device)',
);
// 用户要求：所有功能都在第一行，且**没有**任何一个因状态而不渲染。
const firstRowStart = client.indexOf("h('div', { className: 'taskhive-codesys-project-actions' }");
const firstRowEnd = client.indexOf('className: `taskhive-codesys-commandbar', firstRowStart);
const firstRow = client.slice(firstRowStart, firstRowEnd);
assert(firstRowStart > 0 && firstRowEnd > firstRowStart, 'the first row must exist');
assert(
  !firstRow.includes('onlineConnected ? null :'),
  'no first-row control may be hidden while connected',
);
for (const marker of ['data-codesys-detect-project', 'data-codesys-select-project', 'data-codesys-compile', 'data-codesys-rollback',
  'data-codesys-online-scan-open', 'data-codesys-online-login', 'data-codesys-online-logout', 'data-codesys-online-download',
  'data-codesys-online-change', 'data-codesys-online-start', 'data-codesys-online-stop', 'data-codesys-online-reset',
  'data-codesys-online-write', 'data-codesys-online-force', 'data-codesys-online-unforce']) {
  assert(firstRow.includes(marker), `${marker} must live in the first row`);
}
// 默认只显示图标；容器够宽（≥820px）才把带标签的动作展开成文字。
assert(
  client.includes(".taskhive-codesys-project-actions .taskhive-codesys-action-label{display:none}") &&
    client.includes('.taskhive-codesys-project-actions .taskhive-codesys-action-icononly{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:26px;min-height:26px;padding:0}'),
  'the default must be icon-only',
);
assert(
  client.includes('@container taskhive-codesys (min-width: 820px)') &&
    client.includes('.taskhive-codesys-action:has(.taskhive-codesys-action-label){width:auto;padding:0 6px}') &&
    client.includes('.taskhive-codesys-action:has(.taskhive-codesys-action-label) .taskhive-codesys-action-icon{display:none}'),
  'a wide container must expand every labelled action into text',
);
// Icon-only buttons have no accessible text, so every one of them needs an aria-label.
// 「扫描设备」的 aria-label 会随绑定状态变（绑定后读作"已绑定 X，点此重新扫描"），
// 所以它单独计一次；其余 15 个仍是固定文案。
const actionCount = (client.match(/taskhive-codesys-action taskhive-codesys-action-(?:icononly|text)/g) || []).length;
const actionLabels = (client.match(/'aria-label': '(?:刷新当前工程|选择 \.project 文件|一键回退到绑定基线|AI 审核当前打开的代码对象|离线编译当前工程（Shift 点击为全量重建）|断开 PLC 连接|下载到 PLC|在线修改|启动应用|停止应用|复位设备（需确认词）|在线写变量（需确认词）|强制变量（需确认词）|取消全部强制)'/g) || []).length;
// 两个入口的 aria-label 会随状态变，所以各单独计一次：
//   · 「扫描设备」绑定后读作"已绑定 X，点此重新扫描"；
//   · 「登录」未绑定时读作"需先绑定设备"（T107：绑定是登录的前置条件）。
const scanAriaLabels = (client.match(/'aria-label': onlineBound \? `已绑定 \$\{onlineTargetSummary\}，点此重新扫描` : '扫描 PLC 设备'/g) || []).length;
const loginAriaLabels = (client.match(/'aria-label': onlineBound \? '登录到 PLC（只连接，不下载）' : '登录到 PLC（需先绑定设备）'/g) || []).length;
const statefulLabels = scanAriaLabels + loginAriaLabels;
assert(
  actionCount === 16 && actionLabels + statefulLabels === 16,
  `each of the 16 header actions needs its own aria-label (buttons ${actionCount}, labels ${actionLabels + statefulLabels})`,
);
assert(
  client.includes('function codesysActionIcon(id)') &&
    ['refresh', 'select', 'copy', 'reveal', 'rollback', 'review', 'onlineLogin', 'onlineLogout', 'onlineDownload', 'onlineScan',
      'onlineChange', 'onlineStart', 'onlineStop', 'onlineReset', 'onlineWrite', 'onlineForce', 'onlineUnforce']
      .every((id) => client.includes(`      ${id}: [`)),
  'every action needs a distinct inline icon',
);
assert(
  !client.includes("className: 'taskhive-codesys-field-label'"),
  'the redundant 当前工程 field label must not be rendered (its section already has aria-label)',
);
assert(
  client.includes("[data-taskhive-codesys-workbench=\"true\"] .taskhive-codesys-project-actions .taskhive-codesys-action:has(.taskhive-codesys-action-label) .taskhive-codesys-action-icon{display:none}"),
  'a text action must not also paint its icon at full width',
);
assert(
  client.includes("[data-taskhive-codesys-workbench=\"true\"] .taskhive-codesys-header-copy strong{display:block;font-size:12.5px"),
  'the header title must stay on the compact 12.5px scale',
);
assert(
  !client.includes('title: `CODESYS 代码工作台 · Harness 会话：${sessionId || \'未连接\'}`'),
  'the old 代码工作台 title must be gone',
);
assert(
  !client.includes('taskhive-codesys-offline-badge'),
  'the 离线工程 badge must be gone entirely (not merely hidden)',
);
// The desktop diagnostic read button textContent, which is empty for icon-only
// buttons; it must read aria-label/title instead or it silently loses them.
const main = fs.readFileSync(path.resolve(__dirname, '../app/main.js'), 'utf8');
assert(
  main.includes("node.getAttribute('aria-label') || ''"),
  'the desktop pathButtons diagnostic must read aria-label so icon-only buttons stay visible to it',
);

// ── 8. 顶栏宽度预算（把"一行"变成可测量的断言）─────────────────────────────
// 宽度模型：CJK = 1em，Latin/数字/空格 ≈ 0.55em。按钮宽度 = 文字宽 + 12px 内边距
// + 2px 边框；纯图标按钮固定 26px；顶栏内边距合计 16px（工作台左右各 8px）。
function textWidthPx(text, em) {
  let units = 0;
  for (const ch of String(text)) units += /[\u2E80-\uFFEF]/.test(ch) ? 1 : 0.55;
  return units * em;
}
const actionPx = (label, em = 10) => (label === null ? 26 : Math.ceil(textWidthPx(label, em)) + 14);
const chipPx = (label, em = 9) => Math.ceil(textWidthPx(label, em)) + 18;
// 在线组的两种形态（都只在绑定工程后出现）：
//   未连接 —— [登录][断开][下载] 三个 26px 图标（1/2/3 永远在，只置灰），无状态文字；
//   已连接 —— 第一行切换成在线控制带：绿色标识 + 10 个在线动作（1/2/3 + 在线修改/
//              启动/停止/复位/写值/Force/取消强制），离线管道收起。
// 用户要求：**所有功能都在第一行**；宽度够时全部显示文字，不够时全部缩成图标。
// 第一行 = 标题 + 16 个动作 + 绿色"已登录"标识。默认任何宽度都是 26px 图标；
// 容器 ≥820px 时有标签的动作展开成文字。
const ICON_PX = 26;
const GAP_PX = 4;
const TITLE_PX = textWidthPx('工作台', 12.5);
const BADGE_PX = chipPx('已登录', 10);
const iconRowPx = TITLE_PX + ALL_ACTION_LABELS.length * ICON_PX + (ALL_ACTION_LABELS.length - 1) * GAP_PX + 6;
const textRowPx = TITLE_PX + ALL_ACTION_LABELS.reduce((sum, label) => sum + actionPx(label), 0)
  + BADGE_PX + ALL_ACTION_LABELS.length * GAP_PX + 6;
// 展开阈值必须真的放得下全文字版；图标版必须能在 620px 面板里一行放下。
assert(textRowPx <= 820, `全文字一行需要约 ${Math.round(textRowPx)}px，超过 820px 的展开阈值`);
assert(iconRowPx <= 620, `全图标一行需要约 ${Math.round(iconRowPx)}px，620px 面板放不下`);
process.stdout.write(`first row width: 全图标 ${Math.round(iconRowPx)}px（一行下限）, 全文字 ${Math.round(textRowPx)}px（≥820px 展开）\n`);
// T097: 顶栏的「对话联动」徽章已按用户要求移除 —— 底部状态行本来就显示
// 「● 已联动到会话 xxx / ○ 未连接会话」（含待确认着色），顶栏不必重复一遍。
// 契约反过来要求：顶栏不得再有该徽章，而底部的联动信息必须**仍然在**。
assert(
  !client.includes('taskhive-codesys-link-chip')
    && !client.includes('taskhive-codesys-chip-long')
    && !client.includes('taskhive-codesys-chip-short'),
  'the header must no longer carry a link chip (the bottom status row owns the linkage)',
);
assert(
  client.includes("h('footer', { className: 'taskhive-codesys-statusrow' }")
    && client.includes("'data-codesys-linkstate': sessionId ? 'linked' : 'unlinked'")
    && client.includes('taskhive-codesys-linkstate-label'),
  'removing the header chip must NOT remove the bottom linkage status',
);
// 唯一允许顶栏出现第二行的状态：需要用户裁决"用哪个正在使用中的工程"。必须是
// 刻意独占整行，而不是随机折行。
assert(
  client.includes('.taskhive-codesys-project-actions .taskhive-codesys-open-projects{flex:1 1 100%;max-width:none}'),
  'the ambiguous-project picker must take a deliberate full row, not wrap randomly',
);

// ── 9. 命令条宽度预算：省下的宽度必须落在"原因"上 ──────────────────────────
// T085 删掉了与顶栏「刷新」重复的「重新检测」；T086 又把 AI 入口整块移到顶栏。
// 两次省下的宽度都必须归给可伸缩的"原因"文案，否则写入受阻时用户看不到原因。
{
  // 容器约 384px（默认 400px 侧栏）；命令条自身内边距 16px + 边框 2px。
  const barAvailable = 384 - 16 - 2;
  const barItems = [
    textWidthPx('写入', 10.5),
    textWidthPx('不可写入', 10),
    // 可伸缩的"原因"文案占位 0，其余是固定项
    Math.ceil(textWidthPx('已核对', 9.5)) + 13 + 4, // 勾选框 + 间距 + 文案
    actionPx('确认写入', 10.5),
  ];
  const barFixed = barItems.reduce((sum, px) => sum + px, 0);
  const barGaps = 5 * 4; // 5 个子元素（含可伸缩的原因）之间 4 个 5px 间距
  const reasonRoom = barAvailable - barFixed - barGaps;
  assert(
    !client.includes('taskhive-codesys-code-task') || client.indexOf('h(CodesysTaskComposer') < client.indexOf('taskhive-codesys-commandbar'),
    'the AI entry must not be back inside the write bar',
  );
  assert(
    reasonRoom >= 150,
    `"不可写入的原因"只有约 ${Math.round(reasonRoom)}px，不足 150px（AI 入口移出后应约 178px）`,
  );
  assert(
    !client.includes("'data-codesys-write-recheck'"),
    'the removed duplicate must not creep back into the bar',
  );
  process.stdout.write(`command bar reason room: ${Math.round(reasonRoom)}px\n`);
}

// T090: the bottom line must say WHICH session the workbench is publishing to. T084 hid
// the header's session label, which left the user no way to confirm the linkage except
// "the model could not read it".
assert(
  client.includes("'data-codesys-linkstate': sessionId ? 'linked' : 'unlinked'") &&
    client.includes('className: `taskhive-codesys-linkstate'),
  'the bottom status row must show the session link state',
);
assert(
  client.includes('已联动到会话 ${codesysSessionLabel(sessionId)}') && client.includes("' 未连接会话'"),
  'the indicator must name the linked session and say so when there is none',
);
assert(
  client.includes('function codesysSessionLabel(value)'),
  'a long session id must be shortened for the one-line status row',
);
assert(
  client.includes('[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate{flex:0 0 auto'),
  'the link indicator must not steal width from the status text',
);
assert(
  client.includes('@container taskhive-codesys (max-width: 439px)') &&
    client.includes('.taskhive-codesys-linkstate-label{display:none}'),
  'in a narrow panel only the ● / ○ dot may remain',
);
assert(
  client.includes("h('footer', { className: 'taskhive-codesys-statusrow' }"),
  'status, link state and safety must still share ONE footer row',
);

// ── 8b. 在线（PLC）功能的界面契约 ──────────────────────────────────────────
// 功能 1/2/3：登录 / 断开 / 下载，外加「扫描设备」。约定：
//   * 未连接时不显示任何状态文字；
//   * 登录成功后是一个醒目的绿色标识；
//   * 「扫描设备」是独立按钮，不是藏在面板里的二级入口。
assert(
  client.includes("'data-codesys-online': 'true'") &&
    client.includes("'data-codesys-online-login': 'true'") &&
    client.includes("'data-codesys-online-logout': 'true'") &&
    client.includes("'data-codesys-online-download': 'true'") &&
    client.includes("'data-codesys-online-scan-open': 'true'"),
  'the header must expose scan / login / logout / download',
);
assert(
  !client.includes('taskhive-codesys-online-label') && !client.includes('onlineStateText'),
  'no "未连接/已连接" status text may be rendered',
);
assert(
  client.includes("'data-codesys-online-badge': 'true'") &&
    client.includes("'data-codesys-online-state': onlineConnected ? 'logged-in' : 'idle'") &&
    client.includes("background:var(--th-ok)!important;color:#fff!important"),
  'a successful login must show a prominent green badge',
);
assert(
  client.includes("onlineConnected ? h('button', {\n              className: `taskhive-codesys-online-badge${onlineOperationWarnings.length ? ' is-warning' : ''}`"),
  'the green badge must only exist while connected',
);
// 有强制生效 / 应用异常 / 保持变量不匹配时，标识转为警告色并给出文字提示。
assert(
  client.includes("'data-codesys-online-warning': onlineOperationWarnings.length ? 'on' : 'off'") &&
    client.includes('.taskhive-codesys-online-badge.is-warning{') &&
    client.includes("'data-codesys-online-state-text': 'true'") &&
    client.includes('PLC ${onlineAppLabel || \'\'}'),
  'warning flags (force active / exception / retain mismatch) must be visible, not hidden in a tooltip',
);
// 用户要求：1/2/3（登录 / 断开 / 下载）三个按键**不得因状态而不渲染**，只置灰。
assert(
  !client.includes("onlineConnected ? null : h('button', {\n              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',\n              title: onlineConnected") &&
    client.includes("disabled: onlineBusy || busy || !onlineReady || onlineConnected") &&
    client.includes("disabled: onlineBusy || !onlineConnected") &&
    client.includes("disabled: onlineBusy || busy || !onlineConnected"),
  'login / logout / download must always render and only disable themselves',
);
assert(
  client.includes("'data-codesys-bound': jobId ? 'true' : 'false'"),
  'the root must expose the bound state so the layout rules can key off it',
);
assert(
  // T101：扫描从居中弹窗改成**底部面板**（和「编译输出」同一形态），
  // 所以这里改成钉住"扫描按钮打开的是工作台内的面板"。
  client.includes("const openScanDialog = async () => {") &&
    client.includes("setScanOpen(true)") &&
    client.includes("'data-codesys-scan-panel': 'true'"),
  'the scan button must open the bottom scan panel',
);
// 只有 debug / 断点 / 单步这三项（本版本 ScriptEngine 没有任何 API）不得有控件；
// 其余 9 项都已按用户要求实现并放进第一行。
assert(
  !client.includes("'data-codesys-online-debug'") && !client.includes("'data-codesys-online-breakpoint'") &&
    !client.includes("'data-codesys-online-step'"),
  'debug / breakpoint / step must have no control at all (no API exists in this ScriptEngine version)',
);
assert(
  ["'data-codesys-online-change'", "'data-codesys-online-start'", "'data-codesys-online-stop'",
    "'data-codesys-online-reset'", "'data-codesys-online-write'", "'data-codesys-online-force'",
    "'data-codesys-online-unforce'"].every((marker) => client.includes(marker)),
  'all nine implementable online capabilities must have a control',
);

process.stdout.write(`codesys workbench compact-layout contract tests passed\nheader first row: 全图标 ${Math.round(iconRowPx)}px（一行下限）· 全文字 ${Math.round(textRowPx)}px（≥820px 展开）\n`);
