'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const client = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js'), 'utf8');
const host = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/index.js'), 'utf8');
const engine = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/codesys-monitor/scriptengine.cjs'), 'utf8');

assert(client.includes('buildCodesysTaskSnapshot'));
assert(client.includes('buildCodesysTaskSnapshot'));
assert(client.includes('modelContext: snapshot'));
assert(client.includes('<taskhive-codesys-context path="${request.modelContextPath}" />'));
assert(client.includes("binding.session.prompt([{ type: 'text', text: instruction }], 'queue')"));
// One confirmed write must be ONE CODESYS process. Measured on a real 62-object
// project before the merge: apply-changes 34-36 s + build 45-47 s +
// inspect-project 32-34 s = ~115 s per write, with `scriptEngineProcess` at 99.9 %
// of EVERY call (34,387 / 34,411 ms) — the cost was three CODESYS startups, not the
// edits. So the contract now pins the single-process shape, and pins the fallback
// that keeps a degraded composite from leaving pre-write code on screen.
assert(
  client.includes("run('apply-and-build', { jobId, changes, confirmed: true, includeTree: true })"),
  'the confirmed write must run as one composite action (apply + save + build + tree)',
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
assert(client.includes('if (snapshotChanged) codesysStateKeepAlive.pendingSnapshot = { signature: projectSnapshotSignature, snapshot: projectSnapshot }'), 'a changed signature must queue a pending snapshot for delivery');
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
assert(client.includes('projectSnapshotSignature,\n      ].join(\'|\')'), 'a new inspect must change the fingerprint so the snapshot is republished');

// ── T089：状态续期心跳（只续期，不探测）───────────────────────────────────────
// 宿主状态 15 分钟过期，而 T069 禁止的是"昂贵的定时工程探测"。心跳必须只重发已持有
// 的状态：不重新读工程、不启动 ScriptEngine、不改动 UI。
assert(client.includes('const CODESYS_STATE_KEEPALIVE_MS = 5 * 60 * 1000'), 'the keep-alive cadence must be 5 minutes');
assert(/const codesysStateKeepAlive = \{[\s\S]{0,500}?state: null,[\s\S]{0,300}?sessionId: ''/.test(client), 'the keep-alive must hold the last published state at plugin level (so it survives the workbench tab closing)');
assert(client.includes("publishedSignature: ''") && client.includes('pendingSnapshot: null'), 'the plugin-level store must also carry the snapshot delivery markers, so neither a remount nor the heartbeat can lose them');
assert(
  client.indexOf('const codesysStateKeepAlive') < client.indexOf('function CodesysWorkbench({ ctx })'),
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
  client.includes("summarizeCompilePayload(writeResult.payload, 'build')"),
  'the write path already compiles — it must feed those messages into the same output panel',
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

process.stdout.write('codesys workbench direct-context and single-column proposal contract tests passed\n');
