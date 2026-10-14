'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js'), 'utf8');
const host = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/index.js'), 'utf8');
const engine = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/codesys-monitor/scriptengine.cjs'), 'utf8');
// T228：编译明细的严重级别着色在**样式表**里（碎片 60-…，不在 client bundle 里），
// 所以这里单独读它。着色规则只许引用主题令牌。
const skin = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/src/60-skin-and-embedded-surfaces.js'), 'utf8');

assert(client.includes('buildCodesysTaskSnapshot'));
assert(client.includes('buildCodesysTaskSnapshot'));
assert(client.includes('modelContext: snapshot'));
assert(client.includes('<taskhive-codesys-context path="${request.modelContextPath}" />'));
assert(client.includes("binding.session.prompt([{ type: 'text', text: instruction }], 'queue')"));
// One confirmed write must be ONE CODESYS process. Measured on a real 62-object
// project before the merge: apply-changes 34-36 s + build 45-47 s +
// inspect-project 32-34 s = ~115 s per write, with `scriptEngineProcess` at 99.9 %
// of EVERY call (34,387 / 34,411 ms) — the cost was three CODESYS startups, not the
// edits. So the contract pins the single-process shape, and pins the fallback
// that keeps a degraded composite from leaving pre-write code on screen.
//
// T183 第 4 项改了那一行的**形状**（`includeTree:false` + `deferBuild:true`：同一个进程里
// apply+save+提交回源之后立刻回报，45–60 秒的编译排到后台），所以这条断言从"钉一个字符串
// 字面量"改成按**意图**钉住原来的四件事（语义一条都不删弱）：
//   ① 确认写入仍是**一次**复合调用（不是 apply + build + inspect 三次 CODESYS 启动）；
//   ② 写入前的 sha 防护（T167）还在，而且仍在写入之前；
//   ③ 写入失败仍然可见（同一句状态文案 + "写前恢复快照已保留"）；
//   ④ 编译结果一定回报：延迟路径用只读 `build-status` 收，默认路径仍从复合回报里收。
// 客户端那一半的行为由 tests/codesys-deferred-build-poll-behaviour.js 真跑组件来钉。
assert(
  client.includes("run('apply-and-build', { jobId, changes, confirmed: true, includeTree: false, deferBuild: true })"),
  'the confirmed write must run as one composite action that lands and commits first, with the compile deferred',
);
assert(
  client.includes('const deferredBuildId = String(writeResult?.buildId || \'\')') && client.includes('if (deferredBuildId) {'),
  'the deferred path may only be taken when the engine really handed back a build id',
);
assert(
  client.includes("run('build-status', { jobId: active.jobId, buildId: active.buildId })"),
  'the deferred compile must be collected through the read-only build-status action',
);
assert(
  !/run\('build-status',[^)]*confirmed/.test(client),
  'build-status is READ-ONLY: it must never be sent with confirmed:true (build is not MUTATING)',
);
// 本轮口径改动把写入那条路径的 payload 取值改成 `writeResult?.payload`（多了可选链）：
// 桥不可用时 `writeResult` 可能是 undefined，非可选取值会抛进同一个 catch，把一次**成功**的
// 写入报成"写入或编译失败"。意图（写入路径把同一个 payload 喂给同一个面板）一字未改，
// 所以这里按意图匹配两种写法，而不是钉死一个字符。
assert(
  client.includes("summarizeCompilePayload(status, 'build')")
    && /summarizeCompilePayload\(writeResult\??\.payload, 'build'\)/.test(client),
  'the compile output must feed the same panel on BOTH paths (deferred poll and the default one-IPC composite)',
);
assert(
  client.includes('已落盘并提交回源工程'),
  'the landed result must get its own status line before the compile has finished',
);
assert(
  client.includes('单次 ScriptEngine 完成写入+离线编译'),
  'the default path (no build id in the answer) must keep its original single-IPC wording and behaviour',
);
assert(
  client.includes('const guard = await checkSourceUnchanged(jobId)'),
  'the T167 "project changed externally" sha guard must still run before a confirmed write',
);
assert(
  client.includes('写入或编译失败：${error.message}；写前恢复快照已保留'),
  'a write failure must stay visible, with the recovery snapshot advertised',
);
assert(
  !client.includes("run('build', { jobId })"),
  'the separate build call must stay gone — it was a second CODESYS startup inside the same write',
);
assert(
  client.includes('const treeReady = writeResult?.payload?.complete === true && writeResult?.payload?.textTruncated === false'),
  'the composite tree must be validated before it is applied',
);
assert(
  client.includes('await inspect(jobId)'),
  'a separate read must remain as the fallback when the composite tree is incomplete',
);
assert(
  engine.includes("'apply-changes', 'apply-and-build'"),
  'apply-and-build must be a MUTATING action so it keeps the confirmation gate, recovery snapshot and commit-back',
);
assert(
  engine.includes("elif action == 'apply-and-build':"),
  'the composite branch must exist in the generated Python',
);
assert(
  engine.includes('def collect_project_tree(project, result, inspect_started):') &&
  engine.includes('def apply_project_changes(project, changes):') &&
  engine.includes('def run_project_build(project, action):'),
  'the three in-process steps must be shared helpers, so the composite and the standalone actions cannot drift',
);
// T086/T087: 这条消息 = 命令 + 上下文引用 + 一句"必须先读取"的硬指令。T018 的隔离
// 保证（完整快照只留本地、对话里只放临时路径）由宿主系统提示声明，所以它必须出现在
// 宿主那一段里，而不是每点一次按钮复述一遍 schema。
assert(client.includes('const instruction = `${taskPrompt}\\n本次工程上下文'), 'the click message must be the command, a read order, and the context reference');
assert(client.includes('请先读取它再动手，不要凭猜测回答'), 'the message must ORDER the model to read the snapshot (T087 fixes the T086 blind-review hole)');
assert(!client.includes('你正在处理 TaskHive CODESYS 专属代码任务'), 'the pipeline lecture must stay out of the per-click message');
assert(!client.includes('{"operation":"update-text","objectGuid":"从快照原样复制的现有 GUID"'), 'the JSON schema must not be restated per click');
assert(host.includes('必须先读取它再回答'), 'the host prompt section must make the snapshot read mandatory');
assert(host.includes('不要把它写进对话历史、记忆或知识库'), 'the host prompt section must own the temp-context convention (T018)');
assert(host.includes('本会话已启用全本地路径访问，可直接按绝对路径读取'), 'the host prompt section must state the snapshot lives outside the workspace and is readable');
assert(host.includes('交付方式二选一'), 'the host prompt section must own the delivery contract');
assert(host.includes('create-pou/create-gvl/create-dut'), 'the host prompt section must own the operation enum');
// T087: the snapshot must carry EVERY code object (capped by size), not a prompt-matched
// shortlist of 6. The old scoring meant "review the whole project" could only ever see a
// fraction of it, and re-wording the request could miss the very object being asked about.
assert(client.includes("selection: 'all-code-objects'"), 'the snapshot must declare that it holds all code objects');
assert(!client.includes("'prompt-matched'") && !client.includes("'largest-code-objects'"), 'prompt scoring must no longer SELECT the snapshot contents');
assert(client.includes('const codeObjects = all.filter((item) => item.hasDeclaration || item.hasImplementation)'), 'the snapshot must start from every code object');
assert(client.includes('...codeObjects.filter((item) => named.has(String(item?.name || \'\'))),'), 'a named object must only be ORDERED first (so it survives truncation), not used to filter');
assert(client.includes('...codeObjects.filter((item) => !named.has(String(item?.name || \'\'))),'), 'every other code object must still be included');
assert(client.includes('compact.textTruncated = true') && client.includes('compact.includedCount = compact.objects.length'), 'a truncated snapshot must say so instead of silently dropping objects');
assert(client.includes('namedObjectCount: named.size') && client.includes('codeObjectCount: codeObjects.length'), 'the snapshot must report its own scope');
assert(client.includes('objects: ordered, index: metadata'), 'the metadata index for ALL objects must survive truncation');

// ── T088：工程快照改为「工具调用」取，而不是"请去读那个文件" ────────────────
assert(client.includes('function codesysObjectsSignature(sourcePath, objects)'), 'the client needs a cheap objects signature so the 28k snapshot is not re-sent on every selection/keystroke');
assert(client.includes('const projectSnapshotSignature = codesysObjectsSignature(sourcePath, objects)'), 'the signature must be derived per render');
assert(client.includes('[projectSnapshotSignature],'), 'the snapshot must only be rebuilt when the objects signature changes');
// KNOWN-ISSUES #8: 这两条以前断言的是**实现字符串**，结果把一个真实缺陷一起锁死了：签名变化的那次
// 发布只要被 900 ms 合并式防抖挤掉（同一窗口内后一次覆盖前一次），快照就再也不会被附带
// ——因为"已发布签名"在构造时就被推进了——而宿主的 publishWorkbenchState 是字段合并，
// "字段缺席"会保留那个**从来没被写入过**的 null，于是工程级快照永久读不到，只有随选区
// 发布的 openObject 正常。契约改为断言**不变量**而不是字符串形状。
assert(client.includes('const snapshotChanged = codesysStateKeepAlive.publishedSignature !== projectSnapshotSignature'), 'the signature comparison must be against the host-CONFIRMED signature, not against the intended one');
assert(!client.includes('publishedSnapshotRef'), 'the intent-time marker that swallowed the snapshot must stay gone');
assert(client.includes('if (snapshotChanged) codesysStateKeepAlive.pendingSnapshot = { sessionId: activeSession, signature: projectSnapshotSignature, snapshot: projectSnapshot }'), 'a changed signature must queue a session-owned pending snapshot for delivery');
assert(client.includes('...(codesysStateKeepAlive.pendingSnapshot'), 'every publish must keep carrying the snapshot while it is still unconfirmed');
assert(client.includes('codesysStateKeepAlive.publishedSignature = pending.signature'), 'the published marker may only advance after the host confirms');
assert(client.includes('result.accepted !== false'), 'the host acknowledgement is what clears the pending snapshot');
assert(client.includes('const outgoing = pending && state && state.projectSnapshot === undefined'), 'the send path must merge the pending snapshot into whatever payload actually goes out');
// T089 fix: an omitted field is NOT a cleared field — the host merges. If a rebind made the
// snapshot null and we skipped the field, the PREVIOUS project's code would survive and be
// served to the model as if it were the current project.
assert(!client.includes('const sendSnapshot = Boolean(projectSnapshot)'), 'null snapshots must still be published so a rebind cannot leave the previous project in place');
assert(host.includes('function workbenchToolPayload(sessionId, include)') && host.includes("const wantSnapshot = include === 'project-snapshot'"), 'the read tool must accept include=project-snapshot');
assert(host.includes('workbenchToolPayload(exec.agent?.session?.id, args?.include)'), 'the tool must forward the include argument');
assert(host.includes("enum: ['state', 'project-snapshot']"), 'the include parameter must be a declared enum, not free text');
assert(host.includes('projectSnapshotNote'), 'a missing snapshot must be explained instead of silently absent');
// The publish route must MERGE: the snapshot rides along only when it changed, so a
// later publish without the field must not wipe it.
assert(host.includes('const merged = previous && previous.state && typeof previous.state === \'object\''), 'publishWorkbenchState must merge so an omitted snapshot survives');
assert(host.includes('? { ...previous.state, ...state }'), 'the merge must spread the previous state under the new one');
assert(host.includes('include:"project-snapshot"'), 'the system prompt must advertise the tool path as the preferred way to get project-wide code');
assert(client.includes('projectSnapshotSignature,'), 'a new inspect must change the fingerprint so the snapshot is republished');
// T199 item 3: the same fingerprint must also carry the ONLINE session state, or the read-only
// online tool would keep returning the connection state from whenever the user last edited
// something. The online SIGNATURE never contains the variable values -- including those would
// turn the 1.5 s value poll into a continuous push, which is the feature the operator deleted.
assert(client.includes("        onlineStateSignature,\n"),
  'a change in the online session state must also change the fingerprint');
// 本轮 B 项：指纹的最后一项是**值的观测时刻**（不是值本身），并且只在**已登录到应用**时
// 才带上 —— 未登录恒为 'ov:off'。见 codesys-ai-online-readonly-contract.js：
// 值变了而在线状态没变时，旧指纹根本不发布，宿主手里永远停在打开 POU 那一刻（常常是空的），
// 那正是"对话读不到在线变量"的来源。这里钉住它必须**在**指纹里，且不得放进 onlineStateSignature。
// 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：这个分量原来的判据是
// 「用户自己把那枚开关打开」；开关已整段删除，所以判据按**意图**换成更强的一条 —— 它由
// **登录状态**把总闸（未登录恒为常量 'ov:off'，一个字节都不多发）。
assert(client.includes("        onlineLoggedIn && onlineValues ? `ov:${String(onlineValues.at || 0)}` : 'ov:off',\n      ].join('|')"),
  'the observed-value stamp must be the fingerprint tail, gated by the login state alone'
  + ' (so the host can read the values the panel actually observed while logged in)');
assert(!/onlineStateSignature = \[[\s\S]{0,900}?onlineValues/.test(client),
  'the online signature must not include the online variable VALUES (that would be a push stream, not a state change)');

// ── T089：状态续期心跳（只续期，不探测）───────────────────────────────────────
// 宿主状态 15 分钟过期，而 T069 禁止的是"昂贵的定时工程探测"。心跳必须只重发已持有
// 的状态：不重新读工程、不启动 ScriptEngine、不改动 UI。
assert(client.includes('const CODESYS_STATE_KEEPALIVE_MS = 5 * 60 * 1000'), 'the keep-alive cadence must be 5 minutes');
assert(/const codesysStateKeepAlive = \{[\s\S]{0,500}?state: null,[\s\S]{0,300}?sessionId: ''/.test(client), 'the keep-alive must hold the last published state at plugin level (so it survives the workbench tab closing)');
assert(client.includes("publishedSignature: ''") && client.includes('pendingSnapshot: null'), 'the plugin-level store must also carry the snapshot delivery markers, so neither a remount nor the heartbeat can lose them');
assert(
  client.indexOf('const codesysStateKeepAlive') < client.indexOf('function CodesysWorkbench({ ctx,'),
  'the keep-alive store must be declared OUTSIDE the workbench component',
);
assert(client.includes('void sendCodesysState(sessionId, state)'), 'the heartbeat must republish the stored state through the single send path, so an unconfirmed snapshot rides along');
assert(client.includes('void sendCodesysState(activeSession, state)'), 'the debounced publish must use that same single send path');
assert(
  client.includes('codesysStateKeepAlive.state = state') &&
    client.includes('codesysStateKeepAlive.sessionId = activeSession') &&
    client.includes('scheduleCodesysStateKeepAlive()'),
  'publishCodesysState must arm/refresh the heartbeat',
);
assert(client.includes('if (codesysStateKeepAlive.timer) return'), 'only one heartbeat may exist');
{
  // The heartbeat body must never touch detection or the engine.
  const start = client.indexOf('function scheduleCodesysStateKeepAlive()');
  const body = client.slice(start, client.indexOf('}, CODESYS_STATE_KEEPALIVE_MS)', start));
  assert(body.length > 0, 'the heartbeat body must be locatable');
  for (const forbidden of ['detectCurrentProject', 'scriptengine', 'ScriptEngine', 'inspect(']) {
    assert(!body.includes(forbidden), `the heartbeat must not ${forbidden} — T069 removed periodic ENGINE work`);
  }
  assert(!/setInterval\([^)]*,\s*15000\s*\)/.test(client), 'the removed 15-second poll must stay removed');
  assert(!/setInterval\([^)]*detectCurrentProjectRef/.test(client), 'no interval may drive detection');
}
assert(client.includes("'data-pending-create': item.__pendingKey ? 'true' : 'false'"));
assert(client.includes("'data-changed': proposed && row.changed ? 'true' : 'false'"));
assert(client.includes('grid-template-columns:32px minmax(0,1fr)'));
assert(!client.includes('grid-template-columns:32px minmax(0,1fr) minmax(0,1fr)'));
assert(client.includes('grid-template-rows:auto auto minmax(360px,1fr)'));
assert(client.includes('.taskhive-codesys-tree{box-sizing:border-box;height:100%;min-height:0'));
assert(client.includes('.taskhive-codesys-diff{height:100%;min-height:0'));
assert(!client.includes('height:244px'));
assert(!client.includes('当前代码 → AI 建议'));

// ── T096：编辑器草稿必须按对象存储（切换对象不得丢失待写入）────────────────────
// 现场：改 A → 切到 B → A 的手写内容消失；树里 A 仍是琥珀色（changeStates 还在），而
// effectiveChanges 里没有它 —— 界面说 N 处待写入，确认写入只写其中一部分，A 的徽章永远
// 不会变绿。根因：编辑器的草稿只有两份**全局**字符串，切换时被下一个对象的文本覆盖，
// 而且没有任何地方保存过它。
assert(
  client.includes('const [drafts, setDrafts] = React.useState({})')
    && client.includes('const draftsRef = React.useRef(new Map())'),
  'each object needs its own editor draft; a pair of global strings loses the previous object on switch',
);
assert(
  client.includes('const setObjectDraft = (key, declaration, implementation) =>')
    && client.includes('const clearObjectDrafts = (keys) =>')
    && client.includes('const clearAllObjectDrafts = () =>'),
  'the draft store needs set/clear helpers, mirroring setObjectChangeState',
);
assert(
  client.includes('const previousKey = loadedEditorRef.current.key'),
  'the reload effect must know which object it is switching away from',
);
assert(
  client.includes('if (previousKey && !sameObject && (declarationTyped || implementationTyped)) {'),
  'the outgoing draft must be SAVED before the next object is loaded',
);
assert(
  client.includes('const draft = draftsRef.current.get(selectedKey)')
    && client.includes('const loadDeclaration = draft ? draft.declaration : newDeclaration')
    && client.includes('const loadImplementation = draft ? draft.implementation : newImplementation'),
  'loading an object must prefer its own draft over the AI suggestion / disk text',
);
assert(
  !client.includes('setEditedDeclaration((current) => (current === newDeclaration ? current : newDeclaration))'),
  'the old shape — overwrite the editor with the next object and save nothing — must stay gone',
);
// 写入集合必须覆盖**全部草稿**，否则"待写入计数 = 实际写入集合"这条不变量不成立。
assert(
  client.includes('for (const [key, draft] of Object.entries(drafts))')
    && client.includes('const manualGuids = new Set('),
  'the write set must be built from every draft, not only from the selected object',
);
assert(
  client.includes('...(declaration !== undefined && item.hasDeclaration ? { declaration } : {})')
    && client.includes('...(implementation !== undefined && item.hasImplementation ? { implementation } : {})'),
  'a draft must only send the sections the object actually has (a GVL has no textual_implementation)',
);
// 草稿生命周期：写入成功清、AI 建议按钮同步、回滚/重绑清空、读取刷新清孤儿、改回原文清除。
assert(client.includes('clearObjectDrafts(writtenKeys)'), 'a successful write must drop the drafts it just wrote');
assert(client.includes('setObjectDraft(selectedObjectKey, newDeclaration, newImplementation)'), 'the AI-suggestion button must update the draft too');
assert(client.includes('clearAllObjectDrafts()'), 'rollback and re-binding must clear every draft');
assert(client.includes('clearObjectDrafts(staleDraftKeys)'), 'a read refresh must prune drafts whose object no longer exists');
assert(
  client.includes('if (loadedEditorRef.current.key === selectedObjectKey) clearObjectDrafts([selectedObjectKey])'),
  'reverting to the base text must drop that draft — and only when the editor really holds this object',
);

// ── T097：独立的离线编译入口 + 编译输出文本 ──────────────────────────────────
assert(
  client.includes("'data-codesys-compile': 'true'"),
  'the workbench header must carry a standalone compile control',
);
assert(
  client.includes("void runCompile(event?.shiftKey ? 'rebuild' : 'build')"),
  'the compile control must default to the incremental build and use Shift+click for a full rebuild',
);
assert(
  client.includes('const result = await run(mode, { jobId })'),
  'compiling must call the ScriptEngine build/rebuild actions',
);
assert(
  !/run\(mode, \{ jobId, confirmed/.test(client),
  'compiling must never send confirmed:true — build is not MUTATING and must not write anything',
);
assert(
  client.includes('const summarizeCompilePayload = (payload, mode) => {')
    && client.includes('messages.slice(0, 1000)'),
  'the compile report must carry the engine message list (severity + text), not just a count',
);
assert(
  client.includes("'data-codesys-compile-output': 'true'")
    && client.includes("'data-codesys-compile-text': 'true'")
    && client.includes("'data-codesys-compile-copy': 'true'"),
  'the compile output must be rendered as selectable text and be copyable',
);
assert(
  /summarizeCompilePayload\(writeResult\??\.payload, 'build'\)/.test(client),
  'the write path already compiles — it must feed those messages into the same output panel',
);

// ── 编译计数口径（本轮）：**以编译器自己的总结行为准**，不是"我们显示了几条" ──────────────
//
// 现场报障：面板标题写「错误 0 · 警告 7 · 信息 5」，正文最后一行却是编译器自己的总结
//   [Info] 编译: Text: C0: 编译完成 -- 0错误,28警告
// 旧实现 `warningCount: messages.filter(...).length` 数的是正文条目数（编译器只显示了前 7 条），
// 于是把总数少报成 7。下面这几条把"口径"钉住；只加强，不删弱 —— 上面 T097 那两条断言原样保留。
assert(
  client.includes('const compileCountLabel = (count, report, dimension) => {')
    && client.includes('const compileCountText = (report) =>'),
  '计数的呈现必须有**唯一一处**定义（标题 / 状态行 / 复制文本共用），否则三个地方会各报一个数',
);
// ① 面板标题必须走那个唯一文案函数（不是自己再拼一次 errorCount/warningCount）。
assert(
  client.includes("编译输出 · ${compileCountText(compileReport)}"),
  '面板标题必须用 compileCountText，这样"总结 28 / 正文 7 条"的口径不会被某一条路径绕过',
);
// ② T226：头部（标题 / 离线与后台编译状态行 / 写入状态行 / 复制文本共用的 `compileCountText`）
//    **只报两个数**：`错误 N · 警告 M` —— 不带「（已显示 N 条）」这类括注，也不再有「信息 N」
//    这一档（用户口径："把这个显示去除…我只看编译结果"）。口径本身一个字都没丢：
//    汇总与明细的差异、载入上限，全部挪进抽屉（`compileCountNotes` → `data-codesys-compile-note`）。
assert(
  client.includes("const compileCountText = (report) => `错误 ${compileCountLabel(report.errorCount, report, 'error')} · 警告 ${compileCountLabel(report.warningCount, report, 'warning')}`"),
  '头部文案必须逐字是"错误 N · 警告 M"两个数（没有第三档）',
);
assert(
  !/const compileCountText = \(report\) => `[^`]*（/.test(client)
    && !/const compileCountText = \(report\) => `[^`]*信息/.test(client),
  '头部文案里不许带「（已显示 N 条）」这类括注，也不许再有「信息 N」这一档',
);
assert(
  client.includes('const compileCountNotes = (report) =>')
    && client.includes("'data-codesys-compile-note': 'true'"),
  '汇总与明细的差异（含"明细多出来的不计入编译器汇总"）必须仍有一行说明，而且只画在抽屉里',
);
// ③ 只有正文、没有总结行 ⇒ 计数＝正文条目数，并注明口径（这一句同样只在抽屉里）。
assert(
  client.includes('未解析出编译器汇总行') && client.includes('按已显示条目计'),
  '只有正文时必须注明"按已显示条目计"；连总结行都没解析出来时（含其它语言/形态）如实说"未解析出汇总行"，'
    + '**不**猜是哪种语言',
);
// ④ 两者都解析不出 ⇒ **未知**（不是 0）。旧的 `Number(payload?.errorCount || 0)` 会把"没解析出总结行"
//    显示成"错误 0"，正是 T200 修过的假成功，那段写法必须**不再存在**。
assert(
  client.includes("if (count === null || count === undefined) return '未知'"),
  '解析不出计数时必须显示"未知"，绝不能退化成 0（T200）',
);
assert(
  !client.includes('errorCount: Number(payload?.errorCount || 0)'),
  '`Number(payload?.errorCount || 0)` 必须删除：它把"未知"压成"0 错误"',
);
assert(
  !client.includes("warningCount: messages.filter((item) => severityOf(item) === 'warning').length"),
  '`warningCount: messages.filter(...).length` 必须删除：它把"编译器只显示了前 N 条"当成总数（本轮报障的根因）',
);
// ⑤ 生产端（引擎）必须把两对数字都过桥，否则界面只能退回数正文条数。
assert(
  engine.includes('function applyCompileResultToPayload(payload, compile) {')
    && engine.includes('payload.summaryWarningCount = compile.summaryWarningCount;')
    && engine.includes('payload.detailWarningCount = compile.detailWarningCount;')
    && engine.includes('payload.warningCountSource = compile.warningCountSource;'),
  '引擎必须把 summary/detail 两套计数与 source 一起过桥（`applyCompileResultToPayload` 是唯一一处）',
);
assert(
  engine.includes('summaryWarningCount: summaryWarnings,')
    && engine.includes('countsDiffer: Boolean(summary)'),
  '结构化编译结果必须显式带上"总结行的数字"与"两者不一致"这个事实',
);
// ⑥ 后台编译（build-status）也必须带上同一套口径字段，否则那条路径又会退回数正文条数。
assert(
  /summaryWarningCount: payload\.summaryWarningCount === undefined \? null : payload\.summaryWarningCount/.test(engine),
  'build-status 那条路径必须把口径字段一起带回（后台编译的计数口径与前台同一条）',
);
// ⑦ 抽屉那一侧照印工作台给的口径文案，并且 `null` 是"未知"而不是 0。
const shellRenderer = fs.readFileSync(path.resolve(__dirname, '../app/renderer/renderer.js'), 'utf8');
assert(
  shellRenderer.includes('state.errorLabel') && shellRenderer.includes('state.warningLabel'),
  'AI 抽屉的编译终态必须照印工作台带过来的口径文案（同一个数在哪儿看都是同一个）',
);
assert(
  shellRenderer.includes("if (value === null || value === undefined || value === '') return '未知';"),
  '抽屉里的计数也必须是"未知"而不是 0（与工作台同一条 T200 规则）',
);

// T104：工作台必须有**真正的**错误边界。以前 CodesysWorkbenchBoundary 只有 render()，
// 一旦渲染抛异常 React 就把整块卸掉 —— 用户看到的就是"点开是空白"，而且没有任何线索。
assert(
  client.includes('static getDerivedStateFromError(error)') && client.includes('componentDidCatch(error, info)'),
  'the workbench boundary must catch render errors (a silent blank is not an error report)',
);
assert(
  client.includes("'data-taskhive-codesys-crash': 'true'") && client.includes('CODESYS 工作台渲染失败（这是崩溃，不是空白）'),
  'a crashed workbench must render a readable, copyable message instead of blank space',
);
assert(
  client.includes('void navigator.clipboard?.writeText(text)'),
  'the crash text must be copyable so it can be reported',
);
assert(
  client.includes('.taskhive-codesys-crash{'),
  'the crash view must be styled (otherwise it is just unstyled text in a blank pane)',
);

// T228：用户口径原文「错误行标红/警告行标黄」。这里按**意图**钉住三件事（判据与颜色取值由
// codesys-compile-detail-completeness-contract.js 逐条算，这里只保证这三条规则还在、还只引用令牌、
// 还没有被 !important 抢走、还没有反过来给 Info 行加底色）：
//   ① 错误行 / 警告行各有一条着色规则（红 / 黄），两条**不同的**令牌；
//   ② Info 行仍只有字色、没有底色、没有色条 —— 它和口径说明行保持中性，不抢眼；
//   ③ 着色规则不吃 !important（整行可读性不许被强盖），也不许内联涂色。
const severityRule = (role) => {
  // 级联里谁最后写谁赢：同一个选择器有两条规则（旧的单色那条 + 本轮的着色那条），
  // 取**最后**一条才是用户真正看到的颜色。
  const marker = `[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.${role}{`;
  const at = skin.lastIndexOf(marker);
  assert(at > 0, `编译明细的 ${role} 行必须有样式规则（${marker}）`);
  const end = skin.indexOf('}', at);
  assert(end > at, `${role} 行的样式规则必须闭合`);
  return skin.slice(at + marker.length, end);
};
const errorRule = severityRule('is-error');
const warningRule = severityRule('is-warning');
const infoRule = severityRule('is-info');
assert(/background:var\(--th-error-bg\)/.test(errorRule) && /color:var\(--th-error-ink\)/.test(errorRule),
  `错误行必须"标红"：底色走 --th-error-bg、字色走 --th-error-ink（得到 ${errorRule}）`);
assert(/background:var\(--th-warn-bg\)/.test(warningRule) && /color:var\(--th-warn-ink\)/.test(warningRule),
  `警告行必须"标黄"：底色走 --th-warn-bg、字色走 --th-warn-ink（得到 ${warningRule}）`);
assert(errorRule.includes('var(--th-error-ink)') && warningRule.includes('var(--th-warn-ink)'),
  '错误与警告不许共用一个颜色令牌（共用了就等于没分级）');
assert(!/background|box-shadow/.test(infoRule) && /color:var\(--th-ink-2\)/.test(infoRule),
  `Info 行必须保持中性：只有中性字色，不许有底色或色条（得到 ${infoRule}）`);
assert(!errorRule.includes('!important') && !warningRule.includes('!important'),
  '着色规则不许用 !important 强盖整行可读性');
for (const rule of [errorRule, warningRule]) {
  assert(!/(?:^|;)(?:font|font-size|line-height|padding|height|border-width)[^:]*:/.test(rule),
    `着色只加底与色条，不许改字号/行高/内边距（得到 ${rule}）`);
}
assert(!/[#][0-9a-fA-F]{3,8}/.test(`${errorRule}${warningRule}`),
  '着色规则里不许出现颜色字面值：颜色只许来自主题令牌（别把颜色写散在业务代码里）');
assert(!/taskhive-codesys-compile-note\.is-(?:error|warning)/.test(skin),
  '口径说明行不许被当成错误/警告涂色（它保持中性）');

process.stdout.write('codesys workbench direct-context and single-column proposal contract tests passed\n');
