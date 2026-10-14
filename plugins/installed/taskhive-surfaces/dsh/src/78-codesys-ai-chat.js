// 78-codesys-ai-chat.js — T174/T175：CODESYS AI 对话的**极薄数据桥**（本文件不再渲染任何 UI）
//
// 用户的架构要求（原话）：
//   「我建议 ai 对话不调用原生的右侧栏，而是直接在 codesys 插件里面做一个右侧栏，这样每次
//     更新右侧栏就不需要重新适配」
//
// 改版前：本 shard 用 React 把对话框渲染进 **DSH 原生右栏**（`[class*="rightbarCol"]`），外壳靠
// 主进程 `executeJavaScript` 调 `window.__TASKHIVE_TOGGLE_CODESYS_AI__` 把它打开。用户实测
// "点了几次完全没出现" —— 跨框架全局函数 + 依赖宿主右栏 DOM + 宿主布局一变就塌，非常脆。
//
// 改版后（本文件就是全部 DSH 侧代码）：
//   * **界面**：完全由外壳的 CODESYS 插件面板自己渲染 —— 见 `app/renderer/renderer.js` 里的
//     右侧对话抽屉（宽面板并排、窄面板覆盖式）。本文件**不创建任何 DOM/React 节点**，
//     也**不再查询** `[class*="rightbarCol"]`。于是 DSH 怎么改布局都与这个界面无关。
//   * **数据**：只注册下面这一个全局入口，且只传数据、不渲染 UI：
//       window.__TASKHIVE_CODESYS_AI_BRIDGE__ = {
//         version,
//         async snapshot(limit),   // 主页那条会话的最近若干条消息 **+ 当前模型**
//         async prompt(text),      // 往主页那条会话里发一条 prompt
//         async models(),          // 这条会话可用的模型目录 + 当前模型（含每个模型的推理等级能力）
//         async setModel(input),   // 改**这条会话**用的模型 / 推理等级（`{ id, effort? }`，也接受老的裸 id 串）
//         async ensureWorkbench(), // T184：确保工作台绑到面板当前跟随的工程（只绑定，见文末 T184 段）
//         async answer(payload),   // T185：**用户点击后**替他把一条待回答的提问交回去（见下面 T185 段）
//       }
//     主进程对**全部框架**逐个调用它（见 app/main.js 的 codesys:ai-chat / -snapshot / -prompt /
//     -model / -answer 五个 handler），外壳只消费返回的数据。
//
// 为什么数据桥必须留在 DSH 文档里（唯一无法回避的约束）：**只有 DSH 文档里有 `sessions` 服务**，
// "主页那条会话"就在那里。绑定语义沿用 T164，**T176 修掉了"哪条会话"这一步**：
//   * 定位：`retainedBy.mainView > 0` 的那条会话（与 DSH 原生 UI 同一个判据，见下面 T176 那一段）；
//   * 读：那条会话的**消息视图**（T181 修掉了"读哪里"这一步 —— DSH 0.2 的会话快照没有 nodes，
//         真实消息在 uiSession 的 `hooks.chat` 里，见下面 T181 那一段；老形状仍然兼容）；
//   * 写：`sessions.binding(id).session.prompt([{ type: 'text', text }], 'queue')`。
//   * 模型：见下面 T175 那一段（`modelDirectories` / `remote.session.selectModel`）。
// 于是"在插件面板里说话 == 在主页说话"，同一条会话流，回复两边都可见（这是用户选定的行为）。
//
// 失败可观测（T173 的教训：绝不允许"点了完全没反应、日志里一行都没有"）：
//   * 每个失败分支都把 `{ ok: false, reason, detail }` 作为**数据**回传，外壳状态行直接显示；
//   * 最近一次阶段写进 `window.__TASKHIVE_CODESYS_AI_STATUS__`，主进程在找不到入口时会读它，
//     所以"哪个框架、哪一步失败"是明确的，而不是笼统的"未就绪"。

// 桥的版本号：主进程 / 外壳只把它当"入口在不在"的证据使用（不参与逻辑分支）。
const CODESYS_AI_BRIDGE_VERSION = 'T185';

// 单次快照最多回传多少条消息；上下限是为了让 1.5 秒一次的轮询不可能变成大 payload。
const CODESYS_AI_SNAPSHOT_DEFAULT = 40;
const CODESYS_AI_SNAPSHOT_MIN = 1;
const CODESYS_AI_SNAPSHOT_MAX = 200;

// 最近一次阶段。主进程在"哪个框架都没有入口"时会把它捞回去，所以它必须含**阶段名**与**细节**。
function codesysAiChatNote(stage, extra) {
  const note = { stage: String(stage || ''), extra: String(extra || ''), at: new Date().toISOString() };
  try { window.__TASKHIVE_CODESYS_AI_STATUS__ = note; } catch { /* 无 window：忽略 */ }
  return note;
}

// `sessions` 只能在 DSH 文档里拿到，而且 slot 恢复期间取服务会抛错，所以每次都从 ctx 现取。
function codesysAiChatSessions(ctx) {
  const sessions = getOptionalService(ctx, 'sessions');
  return { sessions, store: sessions && sessions.list ? sessions.list : null };
}

// T178：`uiSession` 与 `modelDirectories`/`remote` 一样**不在**本插件的 inject 列表里，所以旧的
// `getOptionalService`（就一句 `ctx?.[name]`，只沿 fiber 祖先链查）对它**恒返回 null** ——
// 会话判定链条里的 ① `uiSession.current` 一直是死代码，真正生效的只有 ② `retainedBy.mainView`。
// 这里改成"不要求 inject 的读法优先、旧写法兜底"，让文档里写的那条链真的可执行（顺序不变）。
function codesysAiChatOptionalService(ctx, name) {
  const found = codesysAiChatFindService(ctx, [name], null);
  return found.value || getOptionalService(ctx, name);
}

// ── T176：**主页正在看的那条会话到底是哪一条**（真因修复） ──────────────────────────────────
//
// T164 起这里读的是 `sessions.list.getSnapshot().current`。**DSH 0.2 删掉了这个字段**：
//   * `@deepseek-ai/dsh-api-session-controller/lib/client.js` 的 list store 初值只有
//     `{ ids, byId, phase, projectionsBySession }`（:3166-3171），每次 `projectList()` 也只写回
//     这四个键（:3570-3575）—— 所以 `current` 永远是 `undefined`；
//   * 于是 `codesysAiChatCurrentSessionId()` 恒为空串，`snapshot()` / `prompt()` / `models()`
//     一起返回 `{ ok:false, reason:'no-session' }`。用户在真机上看到的就是下拉里的
//     `模型目录不可用`（外壳把任何 `ok !== true` 都画成这一句），detail 是
//     "主页当前没有正在查看的会话：先在主页打开或新建一个会话" —— **即使他正开着一条会话**。
//     审计流里逐字可查：`logs/trajectory.jsonl` 的 `codesys.ai-chat.models-failed` /
//     `codesys.ai-chat.snapshot-failed`，`reason:"no-session"`。
//
// DSH 0.2 的权威判据是"**被主视图保留的那条会话**"（`retainedBy.mainView > 0`）：
//   * `@deepseek-ai/dsh-client-ui-session/lib/client.js` 的 `publishMain()` / `isMain()` 就是
//     `Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id`；
//   * `dsh-client-ui-layout` 的 DocumentTitle、`dsh-client-ui-cordis`、`dsh-client-ui-workspace`
//     的 `replaceMain(… { source: 'mainView' })`、`dsh-client-ui-open-in-app` 全是同一条判据；
//   * 本仓的 shard 80 已经按它修过一次（`80-codesys-task-and-apply.js` 的 `currentSessionId()`
//     与它上面那段 "DSH 0.2 removed `sessions.current` from the raw list projection" 注释）。
//     T176 只是把同一个判据接到数据桥上，不另造来源。
//
// 两条来源都用，顺序固定：
//   ① `ctx.uiSession.current` —— `@deepseek-ai/dsh-client-ui-session` 已经算好的主视图绑定，
//      值形如 `{ key: sessionId, hooks: { session }, props: { sessionId } }`，
//      `key === undefined` = 主页没在看会话（它的 absent 值）；
//   ② `sessions.list.getSnapshot().byId` 里 `retainedBy.mainView > 0` 的那一条（老写法兜底，
//      uiSession 没加载 / 正在换代时走这里）；
//   ③ 最后才看旧字段 `current` —— 只为向前兼容（万一哪天 DSH 又把它加回来），不再是唯一来源。
function codesysAiChatSessionListSnapshot(ctx) {
  const { store } = codesysAiChatSessions(ctx);
  try { return (store && store.getSnapshot && store.getSnapshot()) || null; } catch { return null; }
}

// 主视图绑定的会话 id；`''` = 主页没有正在查看的会话。
function codesysAiChatCurrentSessionId(ctx) {
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null;
    const key = binding && binding.key;
    if (typeof key === 'string' && key) return key;
  } catch { /* 服务正在换代：落到 ② */ }
  const snapshot = codesysAiChatSessionListSnapshot(ctx);
  const byId = snapshot && snapshot.byId;
  if (byId && typeof byId === 'object') {
    for (const row of Object.values(byId)) {
      if (!row) continue;
      const retained = Number((row.retainedBy && row.retainedBy.mainView) || 0);
      const id = row.id === undefined || row.id === null ? '' : String(row.id);
      if (retained > 0 && id) return id;
    }
  }
  const legacy = snapshot && snapshot.current;
  return typeof legacy === 'string' ? legacy : '';
}

// 把会话 id 解析成 binding。每一步失败都带自己的 reason，便于外壳区分"没会话"和"读不出来"。
function codesysAiChatBinding(ctx, sessionId) {
  const { sessions } = codesysAiChatSessions(ctx);
  if (!sessions || typeof sessions.binding !== 'function') {
    return { reason: 'no-sessions', detail: 'DSH 文档没有暴露 sessions.binding（服务未就绪）' };
  }
  let binding = null;
  try { binding = sessions.binding(sessionId); }
  catch (error) { return { reason: 'binding-threw', detail: String((error && error.message) || error) }; }
  const conversation = binding && binding.session ? binding.session : null;
  if (!conversation) return { reason: 'no-binding', detail: `会话 ${sessionId} 还没有可用的对话入口` };
  return { conversation };
}

// 主视图那条会话 = `{ sessionId, conversation }`，或者 `{ reason, detail }`（可读原因）。
// `snapshot()` / `prompt()` / `models()` / `setModel()` 全走这一个入口，所以"哪条会话"只有一份定义。
function codesysAiChatMainSession(ctx) {
  const { sessions, store } = codesysAiChatSessions(ctx);
  if (!sessions || !store) {
    return { reason: 'no-sessions', detail: '这个文档里没有 sessions 服务（只有 DSH 文档才有主页会话）' };
  }
  const sessionId = codesysAiChatCurrentSessionId(ctx);
  if (!sessionId) {
    const snapshot = codesysAiChatSessionListSnapshot(ctx);
    const rows = snapshot && snapshot.byId && typeof snapshot.byId === 'object' ? Object.keys(snapshot.byId).length : 0;
    return {
      reason: 'no-session',
      detail: rows
        ? `主页正在显示的不是一条会话（会话列表里有 ${rows} 条，但没有一条挂在主视图上）：先在主页点开或新建一条会话，再回到这里`
        : '主页当前没有会话：先在主页新建或打开一条会话，再回到这里',
    };
  }
  // ① `uiSession` 已经把会话对象算好了，直接用（它的判据与 DSH 原生 UI 完全同源）。
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null;
    const conversation = binding && binding.key === sessionId && binding.hooks ? binding.hooks.session : null;
    if (conversation) return { sessionId, conversation };
  } catch { /* 落到 ② */ }
  const resolved = codesysAiChatBinding(ctx, sessionId);
  if (resolved.reason) return { reason: resolved.reason, detail: resolved.detail, sessionId };
  return { sessionId, conversation: resolved.conversation };
}

// ── T175：模型（"选中的模型是**会话级**的"） ────────────────────────────────────────────────
//
// 用户原话：「会话调用的主会话的接口，可以选择模型」。抽屉绑定的就是主页那条会话，所以"改模型"
// 改的是**这条会话**用的模型。
//
// **真实接口**（逐个在 DSH 包里查过，不是猜的）：
//   * 主页 composer 的模型座位是客户端插件 `@deepseek-ai/dsh-client-ui-model-selection`
//     （`ModelSelect: the composer's named model seat (conversation.input.model)`）。它依赖的 cordis
//     服务是 **`modelDirectories`**（`class ModelDirectoryResolver extends Service { constructor(ctx)
//     { super(ctx, "modelDirectories") } }`），per-session 目录来自
//     `modelDirectories.directoryFor(sessionId)`：
//       - `await directory.load()`  → 快照 `{ current, routable, groups, failures, status }`，
//         其中 `current` 就是**这条会话**当前选中的 `{ provider, model, reasoningEffort? }`；
//       - `await directory.select({ provider, model, reasoningEffort? })` → `{ ok:true }` 或
//         `{ ok:false, error:{ code, message } }`（真包 `client.js:235-251`：`select()` 把
//         `selection.reasoningEffort` **原样**转发成 `sessions.selectModel` 的同名字段，
//         没传就整个字段都不发 —— 也就是"交给 provider 自己的默认档"）。
//   * 它底层走的是远端方法：`ctx.remote.session.modelCatalog()`（返回 `{ok,value:{default,
//     routableProviders,groups,failures}}` 信封）与 `ctx.remote.session.selectModel({ sessionId,
//     provider, model, reasoningEffort? })`（参数/结果 schema：`sessionId/provider/model/
//     reasoningEffort` → `{ selected: { provider, model, reasoningEffort? } }`）。
//   * **会话级**：`selectModel` 的实现是 `requireModel` → `llm.resolveCallConfig` →
//     `agents.selectForNextRequest(agent, selected)`，即装到"这条会话的下一次请求"上，并落在会话的
//     `modelSelection` 投影里（`binding.session.projections.faceOf('modelSelection').getSnapshot()`
//     → `{ lastUsed, next }`）；全局默认只是后台顺手存一份（`agentDefaultModel.saveSelection`）。
//     模型不存在时它会抛 `RemoteError('session/model-unavailable', ...)`。
//
// 所以这里两条路都接上：**优先**用与主页 composer 完全同一个服务（`modelDirectories`），
// 服务缺失时退回远端方法 `remote.session.modelCatalog/selectModel`。两条都是 DSH 真实存在的接口。
// ── T178：**注册名 + "没有 inject 声明时怎么取服务"**（"模型目录不可用"的第二个真因） ────────────
//
// 一、注册名到底是哪个（DSH 真包，逐条给证据，不是猜）：
//   * **`modelDirectories`** —— `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:365`
//     `super(ctx, "modelDirectories")`：这一句是**唯一**决定注册名的代码。
//     TaskHive 实际加载的是 0.2.0-rc.1（`resources/app/harness/runtime/slot/payload/` 下同包），
//     同一行仍在 `:365`（npm 上那份 0.1.7-rc.2 的同一行在 `:355`，名字相同）。
//   * 同包 `:1062` `ctx.inject(["commandUi", "modelDirectories"], …)`、`:1092`
//     `ctx.inject(["slots", "modelDirectories"], …)` —— DSH 自己的两个消费者也用这个名字；
//     `lib/types/client/service.d.ts:21` `modelDirectories: ModelDirectoryResolver;` 是同一条事实。
//   * 同文件 `:362` 的注释 "the service registers itself as models" 是**过期注释**（它下面两行就是
//     `super(ctx, "modelDirectories")`）。前一个执行者记下的那处"矛盾"就是它 —— **以代码为准**。
//
// 二、那为什么还是取不到（第二个真因，与注册名无关）：
//   * 本插件向 DSH 声明的 cordis 依赖只有 `['layout','workspaces','sessions','uiWorkspace','slots',
//     'sidebarRight','sidebarRightTabs']`（生成文件 `dsh/client.js` 末尾的 `module.exports.inject`）。
//     `sessions` 在列表里 → 会话判定一直可用；`modelDirectories` 与 `remote` **都不在**。
//   * cordis 4 的上下文代理对"没声明 inject 的服务"只沿 **fiber 祖先链**查各 fiber 的 store，
//     查不到就抛 `cannot get property "X" without inject`：
//     `@deepseek-ai/cordis/src/reflect.ts:136-171`（`:157` 查 `fiber.store?.[prop]`、`:163` 到根仍抛）。
//     `modelDirectories` / `remote` 由**兄弟插件**的 fiber 提供，不在祖先链上 → 必抛；
//     而旧的 `getOptionalService` 是 `catch { return null }` → 直接被吞成"两个服务都没有"。
//     审计流原文（`logs/trajectory.jsonl` 第 19044 行，用户重启之后）：
//       {"reason":"no-model-service","detail":"DSH 文档里既没有 modelDirectories.directoryFor，
//        也没有 remote.session.modelCatalog"}
//   * cordis 官方给了**不要求 inject** 的读法：`ctx.reflect.get(name, strict)`
//     （`@deepseek-ai/cordis/src/reflect.ts:225-235`，注释原文 "Read a service from the store
//     without the inject requirement"）。它查的是**全局 store**（同文件 `:237-243` 的 `_getImpl`，
//     `:239` `const impl = this.store[key]`），所以兄弟 fiber 提供的服务也能拿到；
//     `ctx.get(name)` 就是它（`:219` 把 `get` mixin 到 ctx 上），默认 `strict = true`
//     （只返回提供者 fiber 已激活的实现），`strict = false` 连未激活的也返回 —— 诊断用。
//     （同一条事实在编译产物 `@deepseek-ai/cordis/lib/index.js` 里是 `:755-765` 与 `:766-772`。）
//   * 顺便：这一层还能**枚举**已声明的属性名 —— `ctx.reflect.props`（`reflect.ts:211`；`provide()`
//     在 `:279-284` 写 `this.props[name]`、`:292-293` 同时写 `store[key]` 与 `fiber.store[name]`，
//     后者以**服务名**为键）。所以"正确名字是什么"可以自己报出来，不必再等下一轮去猜。
//
// 三条纪律：**候选名逐个试**、**形态校验过了才算命中**、**失败时把试过的东西全带进 detail**。
const CODESYS_AI_MODEL_SERVICE_NAMES = ['modelDirectories', 'models', 'modelSelection', 'modelDirectory'];
const CODESYS_AI_MODEL_SERVICE_HAS_DIRECTORY = (value) => Boolean(value) && typeof value === 'object' && typeof value.directoryFor === 'function';
const CODESYS_AI_REMOTE_SERVICE_NAMES = ['remote', 'remote.session'];
const CODESYS_AI_CENSUS_RELATED = /model|llm|provider|catalog|adapter|remote|session|reasoning/i;

// 四条读法，**从最宽到最窄**：前三条是 cordis 的"不要求 inject"读法，最后一条是旧写法
// （只有该服务真的进了本插件 inject 才会命中）。每条都单独 try —— 命中不了也不能让调用方炸掉。
const CODESYS_AI_SERVICE_READERS = [
  ['ctx.get', (ctx, name) => (ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined)],
  ['ctx.reflect.get', (ctx, name) => (ctx && ctx.reflect && typeof ctx.reflect.get === 'function' ? ctx.reflect.get(name, false) : undefined)],
  ['ctx.root.get', (ctx, name) => (ctx && ctx.root && typeof ctx.root.get === 'function' ? ctx.root.get(name) : undefined)],
  ['ctx[name]', (ctx, name) => (ctx ? ctx[name] : undefined)],
];

// 按候选名逐个试，命中第一个**形态也对**的。返回值里带上"试过哪些名字 + 每条读法的结果" ——
// 这就是失败自诊断的原料（detail 会把它整段回传，下一条日志直接给出真名）。永不抛。
function codesysAiChatFindService(ctx, names, shape) {
  const tried = [];
  for (const name of names) {
    for (const entry of CODESYS_AI_SERVICE_READERS) {
      const label = entry[0];
      const read = entry[1];
      let value = undefined;
      let result = '';
      try { value = read(ctx, name); }
      catch (error) { result = 'throw(' + String((error && error.message) || error) + ')'; }
      if (result === '') {
        if (value === undefined) result = 'undefined';
        else if (value === null) result = 'null';
        else result = typeof value;
      }
      tried.push(name + '@' + label + '=' + result);
      if (value && (!shape || shape(value))) return { value, name, via: label, tried };
    }
  }
  return { value: null, name: '', via: '', tried };
}

// 这个上下文里**实际能看到**的服务名/属性名。cordis 允许枚举（见上面第二段末两条），两条来源都取；
// 取不到就返回空数组，绝不抛。
function codesysAiChatVisibleServices(ctx) {
  const names = [];
  const push = (value) => {
    if (!value || typeof value !== 'object') return;
    try { for (const key of Object.keys(value)) names.push(String(key)); } catch { /* 枚举不了就跳过 */ }
  };
  try { if (ctx && ctx.reflect) push(ctx.reflect.props); } catch { /* 忽略 */ }
  try {
    let fiber = ctx ? ctx.fiber : null;
    for (let depth = 0; fiber && depth < 16; depth += 1) {
      push(fiber.store);
      const parent = fiber.parent ? fiber.parent.fiber : null;
      if (!parent || parent === fiber) break;
      fiber = parent;
    }
  } catch { /* 忽略 */ }
  return Array.from(new Set(names)).sort();
}

// 失败时的自诊断正文：① 上一次尝试的可读原因（如果有）；② **试过的名字与每条读法的结果**；
// ③ 这个上下文里真实可见的 model 相关服务名；④ 可见服务总数与前若干个名字
// （万一 ③ 因为命名不同而空手，④ 里仍然能看到真名）。
function codesysAiChatModelServiceDetail(ctx, attempts, reason) {
  const visible = codesysAiChatVisibleServices(ctx);
  const related = visible.filter((name) => CODESYS_AI_CENSUS_RELATED.test(name));
  const shown = visible.length > 60 ? visible.slice(0, 60).join(', ') + '，…(共 ' + String(visible.length) + ' 个)' : visible.join(', ');
  const parts = [];
  if (reason) parts.push('上一次尝试的原因：' + reason);
  parts.push('试过的服务名与读法：' + (attempts.length ? attempts.join(' | ') : '(无)'));
  parts.push('可见的 model 相关服务：' + (related.length ? related.join(', ') : '(一个都没有)'));
  parts.push('可见服务共 ' + String(visible.length) + ' 个' + (visible.length ? '：' + shown : ''));
  return '读不到模型服务。' + parts.join('；');
}

const CODESYS_AI_MODEL_SELECTION_KEY = 'modelSelection';

// id → 显示名。只为 `snapshot()` 能**同步**带上一个好读的模型名（快照是 1.5 秒轮询，不能联网）。
const CODESYS_AI_MODEL_LABELS = new Map();

function codesysAiChatModelSelectionId(selection) {
  if (!selection || !selection.provider || !selection.model) return '';
  return `${String(selection.provider)}/${String(selection.model)}`;
}

function codesysAiChatNormalizeSelection(selection) {
  if (!selection || !selection.provider || !selection.model) return null;
  return {
    provider: String(selection.provider),
    model: String(selection.model),
    ...(selection.reasoningEffort ? { reasoningEffort: String(selection.reasoningEffort) } : {}),
  };
}

// 会话级的"当前模型"：**同步**读会话的 `modelSelection` 投影。主页一改模型，投影就变，
// 所以 1.5 秒的快照轮询天然会把它带出去（不需要额外订阅）。
// `conversation` 可传入（调用方已经从 `codesysAiChatMainSession()` 拿到），省一次 binding 解析。
function codesysAiChatProjectedModel(ctx, sessionId, conversation) {
  let target = conversation || null;
  if (!target) {
    const resolved = codesysAiChatBinding(ctx, sessionId);
    if (resolved.reason) return null;
    target = resolved.conversation;
  }
  try {
    const projection = target.projections && target.projections.faceOf
      ? target.projections.faceOf(CODESYS_AI_MODEL_SELECTION_KEY)
      : null;
    const view = projection && projection.getSnapshot ? projection.getSnapshot() : null;
    // `view.next` = `pending ?? lastUsed`（就是"这条会话下一次请求会用哪个模型"）。
    return codesysAiChatNormalizeSelection(view && view.next);
  } catch { return null; }
}

// 与主页 composer 同一个服务。T178：**先按候选名找、再做形态校验**，并把失败原因留在返回值里 ——
// 老实现失败时静默返回 null，于是"服务没找到"和"directoryFor 抛了"在日志里长得一模一样。
function codesysAiChatModelDirectory(ctx, sessionId) {
  const found = codesysAiChatFindService(ctx, CODESYS_AI_MODEL_SERVICE_NAMES, CODESYS_AI_MODEL_SERVICE_HAS_DIRECTORY);
  if (!found.value) return { directory: null, tried: found.tried, source: '', error: '' };
  try {
    const directory = found.value.directoryFor(sessionId);
    if (!directory) return { directory: null, tried: found.tried, source: found.name, error: found.name + '.directoryFor(' + String(sessionId) + ') 返回了空值' };
    return { directory, tried: found.tried, source: found.name, error: '' };
  } catch (error) {
    return { directory: null, tried: found.tried, source: found.name, error: found.name + '.directoryFor(' + String(sessionId) + ') 抛出：' + String((error && error.message) || error) };
  }
}

// 远端会话面（`ctx.remote.session`）。读法同上：候选名 + 形态校验。`remote.session` 在 DSH 里是
// **独立的服务名**（model-selection 的 static inject 就写了它），所以两条都试。字段读取也各自 try ——
// cordis 的 accessor 是可能抛的。
function codesysAiChatRemoteSession(ctx) {
  const found = codesysAiChatFindService(ctx, CODESYS_AI_REMOTE_SERVICE_NAMES, (value) => Boolean(value) && typeof value === 'object');
  if (!found.value) return { value: null, tried: found.tried };
  let inner = null;
  try { inner = found.value.session || null; } catch { inner = null; }
  if (inner && typeof inner === 'object') return { value: inner, tried: found.tried };
  return { value: found.value, tried: found.tried };
}

// 远端信封 `{ ok, value } | { ok:false, error }` → 统一的失败原因。
function codesysAiChatRemoteFailure(response, fallbackReason) {
  const error = response && response.error ? response.error : null;
  const detail = [error && error.code, error && error.message].filter(Boolean).join(': ');
  return { reason: fallbackReason, detail: detail || '远端拒绝了这次调用' };
}

// ── T186：推理等级（`reasoningEffort`）的**能力面** ─────────────────────────────────────────
//
// 等级**只能**来自模型描述符自己声明的 `reasoning`，本文件与外壳都**不自造枚举**。
//
// 真包证据（逐个字段读过，不是猜的）：
//   * 模型描述符就长在目录的 `groups[].models[]` 里，`reasoning` 是其中一个可选字段：
//     `@deepseek-ai/dsh-llm-deepseek/lib/index.js:503-524` 的 `modelInfo()` 返回
//     `{ …, reasoning: { efforts: [{ id, name, description }…], defaultEffort } }`
//     （`defaults.thinking === 'disabled'` 时 `efforts` 只有 `off` 一档，`:517-523`）；
//     等级 id 的取值域同文件 `:452-456`：`off` / `low` / `high` / `max`
//     （`REASONING_EFFORTS` 的 `name` 就是 "Off"/"Low"/"High"/"Max"，`:456-477`）。
//   * 客户端把这**同一个** `reasoning` 存进 `reasoning` Map：
//     `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:121` 原文
//     `for (const group of response.value.groups) for (const model of group.models) this.reasoning.set(JSON.stringify([group.id, model.id]), model.reasoning)`。
//   * 原生 UI **是否画推理等级**的判据就是"`reasoning` 存不存在"：同文件 `:782`
//     `reasoning !== void 0 && (… effort cell …)`（`reasoning` 取自 `:521`
//     `currentChoice?.model.reasoning`）。所以本文件用**同一个**判据：`reasoning` 不是对象就没有等级，
//     外壳那边就直接**不显示**这个控件（不是画一个禁用的空壳 —— "别给不可选项"）。
//   * 当前生效档位：`:522` `state.current?.reasoningEffort ?? reasoning?.defaultEffort`；
//     档位清单：`:524-532`（`defaultEffort` 未定义时**多一条** "Default" = 不发这个字段）。
//   * **host 侧就是按这份清单拒收的**（所以本文件那两道校验与 host 同口径）：
//     `@deepseek-ai/dsh-llm/lib/index.js:2168-2188` 的 `resolveCallWithInfo()` ——
//     `reasoning === undefined && requested !== undefined` → 抛 `UNSUPPORTED_REASONING_EFFORT`（`:2177-2178`）；
//     否则 `effective = requested ?? reasoning.defaultEffort`（`:2180`）且
//     `!reasoning.efforts.some((effort) => effort.id === effective)` → 同样抛（`:2182`）。
//   * 它最后怎么上线（**以本机真包为准**）：`@deepseek-ai/dsh-llm-deepseek/lib/index.js:1694-1708`
//     把这一档折成 `thinking: { type: effort === 'off' ? 'disabled' : 'enabled' }` 与
//     `output_config: { effort }`（`off` 时整段 `output_config` 都不发）。
//     ⚠️ 本轮**没有**在本机真包里找到 `reasoning_effort` 这个 snake_case 字面量
//     （`Select-String -Pattern reasoning_effort` 只命中 `REASONING_EFFORT` 常量名）——
//     所以这里按实际读到的 `output_config.effort` 记录，不照抄未复现的写法。
//
// 返回 `null` = 这个模型不支持推理等级（外壳据此隐藏控件）；否则
// `{ defaultEffort, efforts: [{ id, name }] }` —— `name` 是 provider 自己给的可读名（"Off"/"Low"…）。
function codesysAiChatReasoningCapability(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const efforts = [];
  for (const level of Array.isArray(raw.efforts) ? raw.efforts : []) {
    if (!level || typeof level !== 'object') continue;
    const id = String(level.id === undefined || level.id === null ? '' : level.id);
    if (!id) continue;
    efforts.push({ id, name: String(level.name || id) });
  }
  const defaultEffort = raw.defaultEffort === undefined || raw.defaultEffort === null ? '' : String(raw.defaultEffort);
  return { defaultEffort, efforts };
}

// 把 `{ id, effort? }` 与老的"裸 id 串"归一成同一个请求形状。`effort` 空串 = "不动等级"
// （切换模型时**不**替用户猜一档：DSH 原生 UI 的模型那一格也是只发 provider/model，
// `client.js:850-855` 的 `choose()` → `:246-251`，`reasoningEffort` 整个字段都不发）。
function codesysAiChatModelRequest(input) {
  const value = input && typeof input === 'object' ? input : { id: input };
  return {
    id: String(value.id === undefined || value.id === null ? '' : value.id).trim(),
    effort: String(value.effort === undefined || value.effort === null ? '' : value.effort).trim(),
  };
}

// 读目录 + 当前模型。返回：
//   * `ok:false` 只在**真的读不到目录**时出现（reason 是下面那几个名字之一，detail 一定是可读的原因）；
//   * `ok:true` 时：`current` / `available`（可路由，`id` 用 `provider/model` 复合键）/
//     `blocked`（provider 级不可用，外壳按它画**禁用**条目）/ `hasSession`。
// T176 的两条改变（都是用户报的"模型目录不可用"的直接成因）：
//   ① 会话与目录**解耦**：`remote.session.modelCatalog()` 是 host 侧
//      `buildModelCatalog(ctx, defaultSelection)`，注释原文就是 "Build the browser model catalog
//      **without requiring a Session**"。所以即使主视图没在看会话，也照样能列出模型目录 ——
//      以前一没会话就把整个目录判成"不可用"，是过度耦合。
//   ② provider 级不可用**显式回传**（`failures` → `blocked`）：`buildModelCatalog` 把每个 provider
//      的 `listProviders/listModels` 失败收集成 `failures:[{id,name,message}]`，只有成功且有模型的
//      provider 才进 `groups`。不可用的 provider 必须"标注 + 禁止选中"，而不是等用户点了才失败。
// T186：每个模型自己的**推理等级能力**（`reasoning`）也跟着目录一起回传（只在支持时才有这个字段）。
async function codesysAiChatModels(ctx) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  }
  const { sessions, store } = codesysAiChatSessions(ctx);
  if (!sessions || !store) {
    codesysAiChatNote('models.no-sessions', '');
    return { ok: false, reason: 'no-sessions', detail: '这个文档里没有 sessions 服务（只有 DSH 文档才有主页会话）' };
  }
  // 会话**不是**读目录的前提（见上面 ①）：拿不到就带着可读原因继续读目录。
  const main = codesysAiChatMainSession(ctx);
  const sessionId = main.sessionId || '';
  const sessionDetail = main.reason ? String(main.detail || '') : '';

  let groups = [];
  let failures = [];
  let current = null;
  let routable = null;
  let routableProviders = [];
  let source = '';
  let catalogError = '';

  // T178：目录读取改成"候选名 + 形态校验"，并把失败原因（服务没找到 / directoryFor 抛了）留在
  // 返回值里；远端会话面也在**这里**先取一次，这样"两个都没读到"时 detail 能同时带上两边的尝试记录。
  const directoryRead = sessionId
    ? codesysAiChatModelDirectory(ctx, sessionId)
    : { directory: null, tried: [], error: '' };
  const directory = directoryRead.directory;
  if (directory) {
    try {
      const state = (await directory.load()) || {};
      groups = Array.isArray(state.groups) ? state.groups : [];
      failures = Array.isArray(state.failures) ? state.failures : [];
      current = codesysAiChatNormalizeSelection(state.current);
      routable = state.routable === undefined ? null : state.routable === true;
      // `ModelDirectory.syncInputs()` 在 catalog 载入失败时会把 `error`（"code: message"）放在快照上。
      if (state.error) catalogError = String(state.error);
      source = directoryRead.source || CODESYS_AI_MODEL_SERVICE_NAMES[0];
    } catch (error) {
      catalogError = String((error && error.message) || error);
      codesysAiChatNote('models.directory-failed', catalogError);
    }
  } else if (directoryRead.error) {
    catalogError = directoryRead.error;
    codesysAiChatNote('models.directory-unavailable', catalogError);
  }
  const remoteRead = codesysAiChatRemoteSession(ctx);
  const sessionRemote = remoteRead.value;

  if (!groups.length) {
    if (!sessionRemote || typeof sessionRemote.modelCatalog !== 'function') {
      const detail = codesysAiChatModelServiceDetail(ctx, remoteRead.tried.concat(directoryRead.tried), catalogError);
      codesysAiChatNote('models.no-service', detail);
      return { ok: false, reason: 'no-model-service', detail, sessionId };
    }
    try {
      const response = await sessionRemote.modelCatalog();
      if (response && response.ok === false) {
        const failure = codesysAiChatRemoteFailure(response, 'model-catalog-failed');
        codesysAiChatNote('models.catalog-rejected', failure.detail);
        return { ok: false, reason: failure.reason, detail: failure.detail, sessionId };
      }
      const value = (response && response.value) || null;
      groups = Array.isArray(value && value.groups) ? value.groups : [];
      failures = Array.isArray(value && value.failures) ? value.failures : [];
      routableProviders = Array.isArray(value && value.routableProviders) ? value.routableProviders.map((item) => String(item)) : [];
      if (!current) current = codesysAiChatNormalizeSelection(value && value.default);
      source = 'remote.session.modelCatalog';
      catalogError = '';
    } catch (error) {
      const detail = String((error && error.message) || error);
      codesysAiChatNote('models.catalog-threw', detail);
      return { ok: false, reason: 'model-catalog-threw', detail, sessionId };
    }
  }

  // 投影是"这条会话"的权威值；目录里的 default 只是全局默认。投影读得到就用它。
  if (sessionId) {
    const projected = codesysAiChatProjectedModel(ctx, sessionId, main.conversation);
    if (projected) current = projected;
  }

  const available = [];
  for (const group of groups) {
    if (!group) continue;
    const providerId = String(group.id || '');
    if (!providerId) continue;
    const providerName = String(group.name || providerId);
    const models = Array.isArray(group.models) ? group.models : [];
    for (const model of models) {
      if (!model) continue;
      const modelId = String(model.id || '');
      if (!modelId) continue;
      const name = String(model.name || modelId);
      const id = `${providerId}/${modelId}`;
      const label = `${providerName} · ${name}`;
      CODESYS_AI_MODEL_LABELS.set(id, label);
      // 推理等级能力跟着目录一起回传（**只在支持时**才有这个字段）：外壳据此决定画不画那个控件，
      // 并且等级清单直接用 provider 自己给的名字，不自造枚举（见上面 codesysAiChatReasoningCapability）。
      const reasoning = codesysAiChatReasoningCapability(model.reasoning);
      available.push({ id, label, provider: providerId, model: modelId, name, providerName, description: String(model.description || ''), routable: true, ...(reasoning ? { reasoning } : {}) });
    }
  }

  // provider 级不可用：`failures` 里的 provider 一定不在 `groups` 里（host 侧互斥），所以只要原样
  // 标出来就够，不需要再和 `routableProviders` 求差集。名字/原因都保留，外壳直接显示。
  const routableSet = new Set(available.map((item) => item.provider));
  const blocked = failures
    .map((item) => ({
      id: String((item && item.id) || ''),
      name: String((item && (item.name || item.id)) || ''),
      message: String((item && item.message) || '提供方当前不可用'),
    }))
    .filter((item) => item.id && !routableSet.has(item.id));

  const currentId = codesysAiChatModelSelectionId(current);
  const currentRow = available.find((item) => item.id === currentId) || null;
  const currentBlocked = current ? blocked.find((item) => item.id === current.provider) : null;
  const summary = currentId
    ? (currentRow
      ? { ...currentRow, ...(current?.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}), routable: routable === null ? true : routable }
      : {
        id: currentId,
        label: CODESYS_AI_MODEL_LABELS.get(currentId) || `${currentId}（不在可用目录里）`,
        provider: current.provider,
        model: current.model,
        name: current.model,
        ...(current?.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}),
        // 不在目录里 ⇒ 我们**没有**这个模型的等级能力（`reasoning` 只随目录来）。这里刻意不编造：
        // 外壳拿不到 `reasoning` 就不画那个控件（画不出"可验证的档位"）。
        routable: false,
        unavailable: true,
        unavailableReason: currentBlocked ? currentBlocked.message : '这条会话当前选中的模型不在可用目录里',
      })
    : null;
  if (summary && !CODESYS_AI_MODEL_LABELS.has(currentId)) CODESYS_AI_MODEL_LABELS.set(currentId, summary.label);

  codesysAiChatNote('models.ok', `session=${sessionId || '(none)'} source=${source} available=${available.length} blocked=${blocked.length} current=${currentId || '(none)'}`);
  return {
    ok: true,
    sessionId,
    hasSession: Boolean(sessionId),
    sessionDetail,
    source,
    current: summary,
    available,
    blocked,
    routableProviders,
    catalogError,
    failures: failures.map((item) => ({ id: String((item && item.id) || ''), name: String((item && item.name) || ''), message: String((item && item.message) || '') })),
  };
}

// 改**这条会话**用的模型 / 推理等级。`input` 是 `{ id, effort? }`（`id` = `models()` 里的复合键
// `provider/model`），也接受老的裸 id 串（`effort` 就当成"不动等级"）。
// T176：`provider/model` **分开传**（`directory.select({ provider, model })` /
// `remote.session.selectModel({ sessionId, provider, model })`）—— DSH 的 schema 就是三个独立字段，
// 拼接串只在**我们自己**的 UI 里当复合键用，绝不发给 DSH。这里在发请求前就把"不可路由的 provider"
// 挡掉（`blocked`），否则用户只会收到一句 `model-unavailable`。
// 推理等级走**同一条会话级**写入：两处 select 都带上 `reasoningEffort`（参数名与真包
// `client.js:246-251` 一字不差），所以它落在"这条会话的下一次请求"上，与主页 composer 的
// 推理等级是同一份数据。**没有**任何写入 / 编译 / 确认会被这一步触发。
async function codesysAiChatSetModel(ctx, input) {
  const request = codesysAiChatModelRequest(input);
  const wanted = request.id;
  const effort = request.effort;
  if (!wanted) return { ok: false, reason: 'empty-model', detail: '没有指定要切换到哪个模型' };
  const catalog = await codesysAiChatModels(ctx);
  if (catalog.ok !== true) return { ok: false, reason: catalog.reason, detail: catalog.detail, sessionId: catalog.sessionId || '' };
  // "改这条会话的模型"必须**有**这条会话：目录可以读，但选择要有落点。
  if (catalog.hasSession !== true) {
    const detail = catalog.sessionDetail || '主页没有正在查看的会话：先在主页点开或新建一条会话，再切换模型';
    codesysAiChatNote('model.no-session', detail);
    return { ok: false, reason: 'no-session', detail, sessionId: '' };
  }
  const blocked = (catalog.blocked || []).find((item) => item.id && (wanted === item.id || wanted.startsWith(`${item.id}/`)));
  if (blocked) {
    const detail = `提供方 ${blocked.name || blocked.id} 当前不可路由：${blocked.message}`;
    codesysAiChatNote('model.provider-unavailable', detail);
    return { ok: false, reason: 'provider-unavailable', detail, sessionId: catalog.sessionId, model: wanted };
  }
  const target = (catalog.available || []).find((item) => item.id === wanted);
  if (!target) {
    const detail = `模型 ${wanted} 不在可用目录里（当前可用 ${(catalog.available || []).length} 个）`;
    codesysAiChatNote('model.unknown', detail);
    return { ok: false, reason: 'unknown-model', detail, sessionId: catalog.sessionId, model: wanted };
  }

  // 等级必须是**这个模型自己声明过的**那一档。两道防御（外壳已经不会画不可选项，但下拉是可被
  // 脚本改的）：① 模型没有 `reasoning` 就不接受任何等级；② 等级不在 `efforts` 里也不发。
  // 两处都给一句话可读原因 —— 绝不静默地"按别的档位"发出去。
  const reasoning = target.reasoning || null;
  if (effort && !reasoning) {
    const detail = `模型 ${target.name || target.model} 不支持推理等级，不能把等级设成 ${effort}`;
    codesysAiChatNote('model.effort-unsupported', detail);
    return { ok: false, reason: 'effort-unsupported', detail, sessionId: catalog.sessionId, model: wanted, effort };
  }
  if (effort && !(reasoning.efforts || []).some((level) => level.id === effort)) {
    const detail = `推理等级 ${effort} 不在 ${target.name || target.model} 声明的档位里（可用：${(reasoning.efforts || []).map((level) => level.id).join(', ') || '无'}）`;
    codesysAiChatNote('model.effort-unknown', detail);
    return { ok: false, reason: 'unknown-effort', detail, sessionId: catalog.sessionId, model: wanted, effort };
  }

  const directoryRead = codesysAiChatModelDirectory(ctx, catalog.sessionId);
  const directory = directoryRead.directory;
  const remoteRead = codesysAiChatRemoteSession(ctx);
  const sessionRemote = remoteRead.value;
  let outcome = null;
  if (directory && typeof directory.select === 'function') {
    try { outcome = await directory.select({ provider: target.provider, model: target.model, ...(effort ? { reasoningEffort: effort } : {}) }); }
    catch (error) { outcome = { ok: false, error: { code: 'model-select-threw', message: String((error && error.message) || error) } }; }
  } else if (sessionRemote && typeof sessionRemote.selectModel === 'function') {
    try { outcome = await sessionRemote.selectModel({ sessionId: catalog.sessionId, provider: target.provider, model: target.model, ...(effort ? { reasoningEffort: effort } : {}) }); }
    catch (error) { outcome = { ok: false, error: { code: 'model-select-threw', message: String((error && error.message) || error) } }; }
  } else {
    const detail = codesysAiChatModelServiceDetail(ctx, remoteRead.tried.concat(directoryRead.tried), directoryRead.error);
    codesysAiChatNote('model.no-service', detail);
    return { ok: false, reason: 'no-model-service', detail, sessionId: catalog.sessionId };
  }

  if (!outcome || outcome.ok !== true) {
    const failure = codesysAiChatRemoteFailure(outcome, 'model-unavailable');
    codesysAiChatNote('model.failed', `${wanted}${effort ? `@${effort}` : ''} → ${failure.detail}`);
    return { ok: false, reason: failure.reason, detail: failure.detail, sessionId: catalog.sessionId, model: wanted };
  }
  const selected = codesysAiChatNormalizeSelection(outcome.value && outcome.value.selected) || { provider: target.provider, model: target.model };
  // 会话级投影是"下一次请求真的会用哪个"的权威值。刚写完可能还没回流，所以 `verified` 是
  // `true`（已回流且一致）/ `false`（回流了但不是我们要的那个）/ `null`（还没回流，稍后轮询会带出来）。
  const main = codesysAiChatMainSession(ctx);
  const projected = main.sessionId === catalog.sessionId ? codesysAiChatProjectedModel(ctx, catalog.sessionId, main.conversation) : null;
  const projectedId = codesysAiChatModelSelectionId(projected);
  const projectedEffort = projected && projected.reasoningEffort ? String(projected.reasoningEffort) : '';
  // 没要求改等级（`effort === ''`）时判据与改动前**一字不差**（只看模型 id）；要求改等级时，只有
  // 投影里的等级也一致才算 verified —— "已生效"绝不谎报。
  const verified = projectedId ? (projectedId === wanted && (!effort || projectedEffort === effort)) : null;
  // 投影还没回流时，用我们**刚写下去**的那个等级兜底，座位立刻显示用户选的那一档（不回退成旧值）。
  const effectiveEffort = selected.reasoningEffort ? String(selected.reasoningEffort) : effort;
  codesysAiChatNote('model.ok', `session=${catalog.sessionId} model=${wanted}${effort ? ` effort=${effort}` : ''} verified=${verified === null ? 'pending' : verified}`);
  return {
    ok: true,
    sessionId: catalog.sessionId,
    model: wanted,
    effort: effort || effectiveEffort || '',
    label: target.label,
    selected,
    verified,
    // 立即把显示名记下来：紧接着的一次 `snapshot()` 就能同步显示新模型，不必等目录重拉。
    // `target` 里带着 `reasoning`（等级能力），所以外壳切完立刻就能画对等级座位。
    current: { ...target, ...(effectiveEffort ? { reasoningEffort: effectiveEffort } : {}) },
  };
}

// 快照里带上的模型摘要：**纯同步**（投影 + 已缓存的显示名），所以能安全地每 1.5 秒调用一次。
function codesysAiChatModelSummary(ctx, sessionId, conversation) {
  const selection = codesysAiChatProjectedModel(ctx, sessionId, conversation);
  const id = codesysAiChatModelSelectionId(selection);
  if (!id) return null;
  return {
    id,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    label: CODESYS_AI_MODEL_LABELS.get(id) || id,
  };
}

// ── T181：**消息到底在哪**（用户报的"抽屉里没有输出"的真因） ────────────────────────────────
//
// 老代码读 `sessions.binding(id).session.getSnapshot().nodes`，再用 `codesysText(node.blocks)` 抽文本。
// 在 DSH 0.2 里这条路径**不存在**：
//   * `@deepseek-ai/dsh-api-session-controller/lib/client.js:3477-3489` 的 `binding(id)` 返回
//     `{ sessionId, session, eventSource, ctx }`，`session` 就是 Session 实例本身；
//   * 它的会话快照是 `buildSnapshot()`（同文件 `:2273-2297`），字段只有 sessionId /
//     pendingSubmissions / running / subagent / removed / openState / openError / hasMore /
//     loadingOlder / promptError / blank / lastAgentError / promptAttempted / awaitingFirstTurn
//     —— **没有 nodes**。
//   于是 `snapshot.nodes` 恒为 undefined → messages 恒为 [] → 桥返回 `{ ok:true, total:0,
//   messages:[] }`：**成功、但空**。主进程只在 `ok !== true` 时才写 trajectory，所以审计流里
//   "重启之后一行错误都没有"，而抽屉里一条消息都没有 —— 两个现象同源。
//
// 真实的消息视图由客户端 UI 会话组装，服务名 `uiConversation`
// （`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:3028` 的 `super(ctx, "uiConversation")`），
// `@deepseek-ai/dsh-client-ui-chat` 为它注册了 target 名 `chat` 的视图：
//   * `dsh-client-ui-chat/lib/client.js:8878-8887` 的 ChatSnapshotBuilder.snapshot() 返回
//     `{ order, nodes, locations, navigation, timeline, legacy }`：order 是**已排序的可见节点 key**
//     （`:8810` 的 orderedVisibleChatNodes(...)），`nodes.get(key)` 取节点。
//   * `:7262-7273` 的 chatNode() 节点形如
//     `{ key, kind, id, target, anchorSeq, location, visibility, data }`。
//   * 用户消息：`:9346` 的 `{ kind: "user", seq, time, content, source }` —— content 是 **wire** 块，
//     文本块是 `{ type: "text", text }`；`:9339` 的 `kind: "steering"` 同形。
//   * 助手消息：`:7733` 的 `chatNode(context, "assistant-step", …, data, …)`，data 形如
//     `{ status, turn, step, blocks, time, usage?, finalNode? }`，块是 **Chat** 形
//     （`:7381-7390` 的 `{ kind: "text", text }`）。
//   * 正规入口：`:12319-12351` 把 `target("chat")` 用 `ctx.uiSession.provide({ hooks: ["chat"],
//     resolve })` 挂到 uiSession 绑定上；`dsh-client-ui-session/lib/client.js:378-397` 的
//     `materialize()` 把每个描述符声明的 hook 合进同一个 `hooks` 对象。所以
//     `uiSession.current.getSnapshot().hooks.chat` 就是那个 `{ getSnapshot, subscribe }` 快照源 ——
//     与主页会话读的**同一个** target（原生 UI 也在这里读，见 `:12450-12456`）。
//
// 三条路都认，顺序固定：① hooks.chat（DSH 0.2 真形状）→ ② uiConversation 服务的
// `binding(id).target('chat')`（同一个 target 的另一条取法，hooks.chat 缺失时）→ ③ 老形状
// `conversation.getSnapshot().nodes`（**向前兼容**，块名 kind / type 两种都认）。
// 会话判定**一条都没回退**：见上面 T176 段（retainedBy.mainView 仍是主判据，
// `sessions.list…current` 只是最后兜底）。
const CODESYS_AI_TEXT_BLOCK_KIND = 'text';

// 一个内容块是不是文本块。DSH 里两种写法都真实存在 —— wire 形的 `{ type: 'text' }`（用户消息的
// content）与 Chat 形的 `{ kind: 'text' }`（助手消息的 blocks）。两种都认；reasoning / tool-call /
// image 一律不进抽屉（与改动前"只取文本"的行为一个字不差）。
function codesysAiChatBlockText(block) {
  if (!block || typeof block !== 'object') return '';
  const kind = block.kind === undefined || block.kind === null ? block.type : block.kind;
  if (kind !== CODESYS_AI_TEXT_BLOCK_KIND) return '';
  return typeof block.text === 'string' ? block.text : '';
}

// 块数组 → 一段文本。多个文本块之间补一个换行，首尾 trim（等价于 shard 10 的 codesysText，
// 但**同时**认 kind 与 type 两种块名）。
function codesysAiChatBlocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  let text = '';
  for (const block of blocks) {
    const piece = codesysAiChatBlockText(block);
    if (!piece) continue;
    text += (text ? '\n' : '') + piece;
  }
  return text.trim();
}

// 一个会话节点 → 一条抽屉消息；返回 null = 这个节点不是用户/助手消息（工具调用、通知、分组行等）。
// 角色名取自 DSH 0.2 的真实 kind：用户 user（`dsh-client-ui-chat:9346`）与 steering（`:9339`），
// 助手 assistant-step（`:7733`）；assistant 是同一族的旧名字，一起认。
// 正文：助手在 data.blocks、用户在 data.content；老形状两者都放在节点自己的 blocks 上。
// 节点没有包 data（老形状）时直接在节点上找字段，所以新旧两种形状都能读。
function codesysAiChatMessageOfNode(node) {
  if (!node || typeof node !== 'object') return null;
  const kind = String(node.kind || '');
  const role = kind === 'user' || kind === 'steering'
    ? 'user'
    : (kind === 'assistant' || kind === 'assistant-step' ? 'assistant' : '');
  if (!role) return null;
  const data = node.data && typeof node.data === 'object' ? node.data : node;
  let text = codesysAiChatBlocksText(data.blocks);
  if (!text) text = codesysAiChatBlocksText(data.content);
  if (!text && typeof data.text === 'string') text = data.text.trim();
  if (!text) return null;
  const raw = data.seq === undefined || data.seq === null ? node.seq : data.seq;
  const seq = Number(raw === undefined || raw === null ? node.anchorSeq : raw);
  return { role, seq: Number.isFinite(seq) ? seq : 0, text };
}

// ② 用到的物化动作：`target()` 的 subscribe 会顺带 `activate(target)`
// （`dsh-client-ui-conversation/lib/client.js:2944-2949`），而**没被激活过**的视图快照是
// undefined（同文件 `:2102-2106` 的 `snapshot()` 读 `views.get(target)?.snapshot`）。所以这里
// 订阅一次再立刻退订，只为让视图物化；拿走监听器，不留引用。
function codesysAiChatMaterializeChatSource(source) {
  if (!source || typeof source.subscribe !== 'function') return;
  let off = null;
  try { off = source.subscribe(() => {}); } catch { off = null; }
  if (typeof off === 'function') { try { off(); } catch { /* 退订失败不影响读取 */ } }
}

// ① hooks.chat（真形状）→ ② uiConversation.binding(id).target('chat')（同一 target 的另一条取法）。
// 两条都是"不要求 inject"的读法（见上面 T178 段：modelDirectories/remote 已经证明这条路走得通），
// 失败一律吞掉并落到下一条，绝不抛。
function codesysAiChatChatSource(ctx, sessionId) {
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null;
    const chat = binding && binding.hooks ? binding.hooks.chat : null;
    if (chat && typeof chat.getSnapshot === 'function') return chat;
  } catch { /* 落到 ② */ }
  const uiConversation = codesysAiChatOptionalService(ctx, 'uiConversation');
  try {
    const conversation = uiConversation && typeof uiConversation.binding === 'function' ? uiConversation.binding(sessionId) : null;
    const target = conversation && typeof conversation.target === 'function' ? conversation.target('chat') : null;
    if (target && typeof target.getSnapshot === 'function') return target;
  } catch { /* 落到 ③ */ }
  return null;
}

// 读一次 chat 视图快照。**视图没被主界面激活过时快照是 undefined**（见上面 T181 段），这时才做一次
// "订阅→退订"把它物化，然后重读。已经物化过的轮询不会去碰监听器（每 1.5 秒加一次是无谓的开销）。
function codesysAiChatChatView(source) {
  const read = () => {
    try { return source && source.getSnapshot ? source.getSnapshot() : null; } catch { return null; }
  };
  let view = read();
  if (!view || !view.nodes) {
    codesysAiChatMaterializeChatSource(source);
    view = read();
  }
  return view && view.nodes ? view : null;
}

// ①/② 的快照 → 消息。只走 order 里列出的节点（order 已经是"可见且有序"的那一份，hidden 的
// 节点留在 store 里但不在 order 中，所以不会画出已经撤回的内容）。
function codesysAiChatMessagesFromChatView(view) {
  const messages = [];
  if (!view || typeof view !== 'object') return messages;
  const store = view.nodes;
  if (!store || typeof store !== 'object') return messages;
  const read = typeof store.get === 'function'
    ? (key) => store.get(key)
    : (typeof store.source === 'function' ? (key) => store.source(key) : null);
  if (!read) return messages;
  const order = Array.isArray(view.order) ? view.order : [];
  for (const key of order) {
    let node = null;
    try { node = read(key); } catch { node = null; }
    const message = codesysAiChatMessageOfNode(node);
    if (message) messages.push(message);
  }
  return messages;
}

// ③ 老形状（向前兼容）：conversation.getSnapshot().nodes。**这条是唯一会抛的路径**，所以它把
// 失败原因原样回传，调用方照旧返回 snapshot-threw —— 原来那条失败语义一个字没变。
function codesysAiChatMessagesFromSessionSnapshot(conversation) {
  let snapshot = null;
  try { snapshot = conversation && conversation.getSnapshot ? conversation.getSnapshot() : null; }
  catch (error) { return { messages: [], error: String((error && error.message) || error) }; }
  const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const messages = [];
  for (const node of nodes) {
    const message = codesysAiChatMessageOfNode(node);
    if (message) messages.push(message);
  }
  return { messages, error: '' };
}

// ── T183：**"会话正在运行 / 正在思考"从哪读**（用户原话：「现在有输出，但是没有显示在思考」） ──
//
// 主界面在模型生成期间画两样东西（逐个在 DSH 真包里查过，不是猜的）：
//   * **会话状态**：`@deepseek-ai/dsh-api-session-controller/lib/client.js` 的 `buildSnapshot()`
//     （`:2273-2297`）里有 `running`（`:2278`）与 `pendingSubmissions`（`:2277`）；`running` 由
//     host 的 `api-session/status` 事件经 `handleSessionStatus`（`:2886-2895`）→`handleRunning`
//     （`:1963-1972`）写进会话实例。主界面会话读的就是它
//     （`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:15376` 的 `useSession((s) => s.running)`，
//     同包 `:17224` / `:17838` 也是同一份）。
//   * **助手节点**：`@deepseek-ai/dsh-client-ui-chat/lib/client.js` 的 assistant-step 节点
//     `data.status` 取值是 **running / settled / interrupted**（`:7653`：
//     `settled?.interrupted === true ? "interrupted" : settled === void 0 ? "running" : "settled"`），
//     它决定主界面画不画"进行中"（`:6056` `streaming: data.status === "running"`、`:8616`）；
//     块 `kind` 的枚举里**有 reasoning**（`:7387-7390` 建块、`:7528-7534` 流式累积），
//     主界面把它折成一行标题为 `message.think` = **"思考"** 的折叠行（`:5549` + `:5897`），
//     展开才看全文（`lcKema_thinkBody`，`:5793`）。没有工具在跑时的实时行标题是
//     `message.stepProcess.thinking` = **"正在分析请求"**（`:5415` + `:2257`/`:2262`）。
//
// 所以这里只回传三层**事实**（外壳照主界面口径画，不另造文案）：
//   `running`（会话正在运行）· `pending`（本地待受理条数）· `awaitingFirstTurn`
//   · `reasoning`（**正在跑的**那个 assistant-step 里 reasoning 块的全文，没有就是空串）。
// 全是同步只读，所以 1.5 秒 / 运行态 600ms 的轮询都安全。
const CODESYS_AI_REASONING_BLOCK_KIND = 'reasoning';
const CODESYS_AI_ASSISTANT_STEP_KINDS = ['assistant-step', 'assistant'];
const CODESYS_AI_ASSISTANT_RUNNING_STATUS = 'running';

// 三条来源，顺序固定（都失败就按"没在跑"）：
//   ① 会话自己的 `getSnapshot().running` —— 与主界面会话**同一个事实**（首选）；
//   ② 会话列表行的 `running` —— `@deepseek-ai/dsh-client-ui-session/lib/client.js:322-330` 的
//      `reconcileStatus()` 就是从它同步到 sessionStatus 的（列表快照仍然带着这个字段）；
//   ③ `uiSession.sessionStatus` 那张 Map（同包 `:342-357`）里 `{ running, pendingInteraction,
//      completionUnread }` —— 会话实例换代 / 列表还没就绪时走这里。
// `pending` 与 `awaitingFirstTurn` 只在 ① 读得到时有值（其余来源没有这两项），外壳用它们让
// "刚发出去还没进入 running"的那一刻也能立刻显示进行中。
function codesysAiChatRunningFacts(ctx, sessionId, conversation) {
  let snapshot = null;
  try { snapshot = conversation && conversation.getSnapshot ? conversation.getSnapshot() : null; } catch { snapshot = null; }
  const pending = snapshot && Array.isArray(snapshot.pendingSubmissions) ? snapshot.pendingSubmissions.length : 0;
  const awaitingFirstTurn = Boolean(snapshot && snapshot.awaitingFirstTurn === true);
  if (snapshot && typeof snapshot.running === 'boolean') {
    return { running: snapshot.running, pending, awaitingFirstTurn, via: 'session' };
  }
  const list = codesysAiChatSessionListSnapshot(ctx);
  const row = list && list.byId && typeof list.byId === 'object' ? list.byId[sessionId] : null;
  if (row && typeof row.running === 'boolean') {
    return { running: row.running, pending, awaitingFirstTurn, via: 'list' };
  }
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const source = uiSession && uiSession.sessionStatus ? uiSession.sessionStatus : null;
    const status = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null;
    const entry = status && typeof status.get === 'function' ? status.get(sessionId) : null;
    if (entry && typeof entry.running === 'boolean') {
      return { running: entry.running, pending, awaitingFirstTurn, via: 'sessionStatus' };
    }
  } catch { /* 读不到就落到下面那条"没在跑" */ }
  return { running: false, pending, awaitingFirstTurn, via: '' };
}

// 正在跑的那个 assistant-step 里 reasoning 块的**全文**（没有就空串）。与主界面 `:10610-10625`
// 的 `liveReasoningDetail()` 看的是同一处（最后一个 `status === "running"` 的 assistant-step 的
// 最后一个 reasoning 块），只是主界面取"最后一段落的第一行"当实时摘要、全文留给展开，
// 拆分点放在外壳那一侧（那里才是观感）。
// 只按 `order` 走（与消息同一条可见性判据：撤回/隐藏的节点不在 order 里）。
function codesysAiChatReasoningOfChatView(view) {
  if (!view || !view.nodes || typeof view.nodes !== 'object') return '';
  const read = typeof view.nodes.get === 'function'
    ? (key) => view.nodes.get(key)
    : (typeof view.nodes.source === 'function' ? (key) => view.nodes.source(key) : null);
  if (!read) return '';
  const order = Array.isArray(view.order) ? view.order : [];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    let node = null;
    try { node = read(order[index]); } catch { node = null; }
    if (!node || typeof node !== 'object') continue;
    if (!CODESYS_AI_ASSISTANT_STEP_KINDS.includes(String(node.kind || ''))) continue;
    const data = node.data && typeof node.data === 'object' ? node.data : node;
    if (String(data.status || '') !== CODESYS_AI_ASSISTANT_RUNNING_STATUS) continue;
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (!block || typeof block !== 'object') continue;
      if (String(block.kind || '') !== CODESYS_AI_REASONING_BLOCK_KIND) continue;
      const text = typeof block.text === 'string' ? block.text : '';
      if (text.trim()) return text;
    }
  }
  return '';
}

// ── T185：**"待回答"是什么、它在哪、抽屉怎么才能把它显示出来并就地回答** ────────────────────
//
// 报障（用户原文）：「原会话（主页那条）有一个"待回答"，但 CODESYS 插件的 AI 对话抽屉不显示
// 这个待回答，于是一直卡住」。
//
// 一、**"待回答"在 DSH 里的真实形状**（逐个在 0.2.0-rc.1 真包里查过，不是猜的；真包在
// `resources/app/harness/runtime/slot/payload/node_modules/.pnpm/node_modules/@deepseek-ai/`，
// 运行中的 `dsh/lib/bin.js` 就是这个 payload）：
//   * **文案**：`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1410` 的
//     `t("status.compact.answer")` = **"待回答"**（词条在 `:3967`），完整那一句是
//     `t("status.waitingAnswer")` = "等待回答"（`:3964`）。它会画在**侧栏会话行**上，条件是
//     `node.pendingInteraction === "question"`（`:1406-1411`，分类见 `:440-447` 的
//     `visiblePendingKind()`，取值 `approval` / `plan-review` / `question`）。
//   * **数据**：`@deepseek-ai/dsh-client-ui-session/lib/client.js` 的 `UiSession`
//     （`super(ctx, "uiSession")`，`:164`）暴露 `sessionStatus`（`:148-156`），
//     `publishStatus()`（`:342-357`）为**每个会话**发布
//     `{ running, pendingInteraction, completionUnread }`。
//     `pendingInteraction` 就是下面这个对象本身：
//     `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:61-154` 的 `PendingQuestion` ——
//     字段 `{ sessionId, kind, key, questions }`，方法 `answer(answer)` / `cancel()` /
//     `delegate()` / `abort()`。`kind` 是 `"question"` 或 `"plan-review"`（`:87`，由
//     `planReviewOf(questions)` 决定）。
//   * **问题条目的形状**（`@deepseek-ai/dsh-tool-ask-user/lib/index.js:18-65` 的
//     `ask_user_question` 参数体，逐字段对应）：
//     `{ id, question, header?, options?: [{ label, description? }], multiSelect? }`。
//   * **作答的值**（同一个 tool 的 `output.schema`，`:66-90`）：
//     `{ answers: [{ id, selected: [label…], custom? }] }`；`PendingQuestion.answer()` 直接把它
//     resolve 给宿主 waterfall（`:108-114`），**不需要新造任何协议**。
//
// 二、**为什么抽屉会"卡住"**（两个现象同一个根因）：
//   本文件以前的 `snapshot()` 只回 `running` / `pending`（= `pendingSubmissions` 的**本地提交回显**
//   条数，见 `@deepseek-ai/dsh-api-session-controller/lib/client.js:2277`）/ `awaitingFirstTurn` /
//   `reasoning` —— **一个字都没提 pendingInteraction**。而"待回答"期间 `running` 仍然是 `true`
//   （回合没结束，agent 正阻塞在这个工具里），于是外壳照 T183 的口径画出「正在分析请求」，却永远
//   等不到它变化，也永远看不到那条问题。用户看到的就是"一直在转、什么都不显示"。
//
// 三、**修法**：`snapshot()` 多回一份**纯数据**的 `pendingInteraction`（下面是它的规范化形状），
//   外加一个**只在用户显式点击时**才会被调用的 `answer(payload)`。两条纪律：
//   * **绝不自动作答**：`snapshot()` / 任何轮询路径**只读**，一次都不会碰 `answer`；`answer` 只在
//     外壳那条 IPC（`codesys:ai-chat-answer`）里被调用，而那条通道只由"提交回答"按钮触发。
//   * **审批不代答**：`kind === 'approval'`（权限确认）在抽屉里**只提示、不给按钮** ——
//     代用户批准权限正是最不该由插件一键完成的事，它的 `notAnswerableReason` 会原样显示。
const CODESYS_AI_PENDING_KIND_QUESTION = 'question';
const CODESYS_AI_PENDING_KIND_PLAN_REVIEW = 'plan-review';
const CODESYS_AI_PENDING_KIND_APPROVAL = 'approval';

// 主视图那条会话现在挂着的那一个待处理交互（`PendingQuestion` 实例本身），没有就是 null。
// 两条来源，顺序固定：① `uiSession.sessionStatus`（DSH 原生侧栏读的**同一个** root hook，首选）→
// ② `uiSession.pendingSnapshot`（UiSession 自己的 Map，`dsh-client-ui-session/lib/client.js:139`；
// 只是兜底，字段名万一下一轮改了还有一条路）。两条都纯粹只读，所以 1.5 秒轮询安全。
function codesysAiChatPendingWait(ctx, sessionId) {
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const source = uiSession && uiSession.sessionStatus ? uiSession.sessionStatus : null;
    const status = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null;
    const entry = status && typeof status.get === 'function' ? status.get(sessionId) : null;
    const interaction = entry ? entry.pendingInteraction : null;
    if (interaction && typeof interaction === 'object') return interaction;
  } catch { /* 服务正在换代：落到 ② */ }
  try {
    const map = uiSession ? uiSession.pendingSnapshot : null;
    const interaction = map && typeof map.get === 'function' ? map.get(sessionId) : null;
    if (interaction && typeof interaction === 'object') return interaction;
  } catch { /* 读不到就按"没有待回答" */ }
  return null;
}

// 一个问题条目 → 纯数据。字段名与 `ask_user_question` 的 schema 逐字对应（见上面第一段），
// 一个额外的字都没有；没有 `id` 的条目丢掉（没有 `id` 就无法把答案对回去，画出来只会骗人）。
function codesysAiChatPendingQuestion(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id === undefined || item.id === null ? '' : item.id);
  if (!id) return null;
  const options = [];
  if (Array.isArray(item.options)) {
    for (const option of item.options) {
      if (!option || typeof option !== 'object') continue;
      const label = String(option.label === undefined || option.label === null ? '' : option.label);
      if (!label) continue;
      options.push({ label, description: String(option.description || '') });
    }
  }
  return {
    id,
    header: String(item.header || ''),
    question: String(item.question || ''),
    options,
    multiSelect: item.multiSelect === true,
  };
}

// `PendingQuestion` → 外壳能直接画的**纯数据**。下面每一条都是事实，没有一句是外壳自己编的文案：
//   * `kind`      question / plan-review / approval；
//   * `label` / `compactLabel` —— DSH 自己那两个词条（`status.waitingAnswer` / `status.compact.answer`
//     的同义值，见上面第一段），所以"待回答"这四个字不是我造的；
//   * `key`       `PendingQuestion.key`（`question:<n>`）。外壳把它原样回传，`answer()` 会拿它做
//                 "我答的是不是刚才那一条"的判据（避免用户答完之前问题换了、答案却落到新问题上）；
//   * `questions` 规范化后的问题列表；
//   * `answerable` 只有"真的有 `answer()` 方法 + 至少一个问题 + 不是审批"才是 true；
//   * `notAnswerableReason` 不可就地作答时**必须**给一句可读原因（绝不允许只有按钮不给理由）。
function codesysAiChatPendingInteraction(ctx, sessionId) {
  const wait = codesysAiChatPendingWait(ctx, sessionId);
  if (!wait) return null;
  const rawKind = String(wait.kind || '');
  const kind = rawKind === CODESYS_AI_PENDING_KIND_PLAN_REVIEW
    ? CODESYS_AI_PENDING_KIND_PLAN_REVIEW
    : (rawKind === CODESYS_AI_PENDING_KIND_APPROVAL ? CODESYS_AI_PENDING_KIND_APPROVAL : CODESYS_AI_PENDING_KIND_QUESTION);
  const questions = [];
  if (Array.isArray(wait.questions)) {
    for (const item of wait.questions) {
      const question = codesysAiChatPendingQuestion(item);
      if (question) questions.push(question);
    }
  }
  const hasAnswer = typeof wait.answer === 'function';
  const answerable = kind !== CODESYS_AI_PENDING_KIND_APPROVAL && hasAnswer && questions.length > 0;
  let notAnswerableReason = '';
  if (!answerable) {
    if (kind === CODESYS_AI_PENDING_KIND_APPROVAL) {
      notAnswerableReason = '这是一条权限审批请求。代你批准权限是插件最不该做的事，所以这里只提示、不给按钮：请在主页会话里处理它。';
    } else if (!hasAnswer) {
      notAnswerableReason = '这条待回答的请求没有可就地提交的作答接口（DSH 版本可能不同）：请在主页会话里回答它。';
    } else {
      notAnswerableReason = '这条待回答的请求没有带回可显示的问题内容：请在主页会话里查看并回答它。';
    }
  }
  return {
    kind,
    key: String(wait.key || ''),
    sessionId: String(wait.sessionId || sessionId || ''),
    label: kind === CODESYS_AI_PENDING_KIND_PLAN_REVIEW ? '计划待审' : (kind === CODESYS_AI_PENDING_KIND_APPROVAL ? '等待审批' : '等待回答'),
    compactLabel: kind === CODESYS_AI_PENDING_KIND_PLAN_REVIEW ? '计划待审' : (kind === CODESYS_AI_PENDING_KIND_APPROVAL ? '待审批' : '待回答'),
    questions,
    answerable,
    notAnswerableReason,
  };
}

// ── T185：**就地回答**（只在用户显式点击后被调用，见上面第三条纪律） ──────────────────────────
//
// `payload` = `{ key, answers }`：
//   * `key`     外壳从 `snapshot().pendingInteraction.key` 原样带回来的那一个（用来防"答错一条"）；
//   * `answers` 每个问题一条 `{ id, selected: [label…], custom? }`。
//
// 编码与 DSH 自己那条 composer **逐字一致**（`dsh-client-ui-user-questions/lib/client.js:541-552`
// 的 `submitDrafts()`）：跳过的问题发 `selected: []`；既没有选选项又没有自定义文本 = **不完整**，
// 直接拒绝并给出可读原因（绝不发一个半成品给宿主）；给了自定义文本且**不是**多选时，
// `selected` 清空（DSH 就是这么编码的）。另外只接受**问题自己列出来的**选项标签 —— 绝不让插件
// 凭空构造一个宿主不认识的标签。
//
// 失败一律回 `{ ok:false, reason, detail }` 数据（T173 的教训：失败必须可读），成功回
// `{ ok:true, key, answered }`。**任何**情况下都不会替用户"猜"一个答案。
async function codesysAiChatAnswer(ctx, payload) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  }
  const input = payload && typeof payload === 'object' ? payload : {};
  const wantedKey = String(input.key === undefined || input.key === null ? '' : input.key);
  const answers = Array.isArray(input.answers) ? input.answers : [];
  if (!answers.length) {
    return { ok: false, reason: 'empty-answer', detail: '没有可提交的作答内容：请先选择一个选项或填写自定义答案。' };
  }
  const main = codesysAiChatMainSession(ctx);
  if (main.reason) {
    codesysAiChatNote(`answer.${main.reason}`, main.detail);
    return { ok: false, reason: main.reason, detail: main.detail, sessionId: main.sessionId || '' };
  }
  const sessionId = main.sessionId;
  const wait = codesysAiChatPendingWait(ctx, sessionId);
  const pending = wait ? codesysAiChatPendingInteraction(ctx, sessionId) : null;
  if (!pending) {
    const detail = '主页那条会话现在没有待回答的请求（可能已经在主页回答过了）：先刷新一下再看。';
    codesysAiChatNote('answer.no-pending', detail);
    return { ok: false, reason: 'no-pending', detail, sessionId };
  }
  if (pending.answerable !== true) {
    codesysAiChatNote('answer.not-answerable', pending.notAnswerableReason);
    return { ok: false, reason: 'not-answerable', detail: pending.notAnswerableReason, sessionId, key: pending.key };
  }
  if (wantedKey && wantedKey !== pending.key) {
    const detail = `待回答的已经不是刚才那一条了（现在是 ${pending.key}）：请按刷新后显示的新问题作答。`;
    codesysAiChatNote('answer.stale-pending', detail);
    return { ok: false, reason: 'stale-pending', detail, sessionId, key: pending.key };
  }
  const normalized = [];
  for (const question of pending.questions) {
    const row = answers.find((item) => item && String(item.id) === question.id);
    const title = String(question.header || '').trim() || question.question || question.id;
    if (!row) {
      const detail = `问题「${title}」还没有作答。`;
      codesysAiChatNote('answer.incomplete', detail);
      return { ok: false, reason: 'incomplete-answer', detail, sessionId, key: pending.key };
    }
    const selected = Array.isArray(row.selected) ? row.selected.map((label) => String(label)).filter(Boolean) : [];
    const custom = String(row.custom === undefined || row.custom === null ? '' : row.custom).trim();
    if (!selected.length && !custom) {
      const detail = `问题「${title}」还没有作答：请选择一个选项或填写自定义答案。`;
      codesysAiChatNote('answer.incomplete', detail);
      return { ok: false, reason: 'incomplete-answer', detail, sessionId, key: pending.key };
    }
    const allowed = new Set(question.options.map((option) => option.label));
    const unknown = selected.filter((label) => !allowed.has(label));
    if (unknown.length) {
      const detail = `选项「${unknown.join('、')}」不在问题「${title}」给出的选项里：请重新选择。`;
      codesysAiChatNote('answer.unknown-option', detail);
      return { ok: false, reason: 'unknown-option', detail, sessionId, key: pending.key };
    }
    // 与 DSH 的 `submitDrafts()` 同一套编码（见上面那段）：单选 + 自定义文本时 `selected` 清空。
    normalized.push({
      id: question.id,
      selected: custom === '' || question.multiSelect === true ? selected : [],
      ...(custom === '' ? {} : { custom }),
    });
  }
  try {
    await wait.answer({ answers: normalized });
  } catch (error) {
    const detail = String((error && error.message) || error);
    codesysAiChatNote('answer.failed', detail);
    return { ok: false, reason: 'answer-threw', detail, sessionId, key: pending.key };
  }
  codesysAiChatNote('answer.ok', `session=${sessionId} key=${pending.key} questions=${normalized.length}`);
  return { ok: true, sessionId, key: pending.key, answered: normalized.length };
}

// 读会话快照 → 外壳要显示的最近若干条消息 + 当前模型 + **进行中**那一组事实。
// **只读**，没有任何副作用，所以可以 1.5 秒（运行态 600ms）轮询。
async function codesysAiChatSnapshot(ctx, limit) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  }
  const main = codesysAiChatMainSession(ctx);
  if (main.reason) {
    codesysAiChatNote(`snapshot.${main.reason}`, main.detail);
    return { ok: false, reason: main.reason, detail: main.detail, sessionId: main.sessionId || '' };
  }
  const sessionId = main.sessionId;
  const conversation = main.conversation;
  // ① / ②：DSH 0.2 的真实消息视图（见上面 T181 段）。
  const chatSource = codesysAiChatChatSource(ctx, sessionId);
  // T183：视图对象**留一份**——消息与"正在跑的 reasoning 块"读的是同一个快照，不重复取。
  const chatView = chatSource ? codesysAiChatChatView(chatSource) : null;
  let messages = [];
  let source = '';
  if (chatView) {
    messages = codesysAiChatMessagesFromChatView(chatView);
    if (messages.length) source = 'chat';
  }
  // ③：老形状兜底（也顺手保留原来的 snapshot-threw 失败语义）。
  let legacyError = '';
  if (!messages.length) {
    const legacy = codesysAiChatMessagesFromSessionSnapshot(conversation);
    legacyError = legacy.error;
    if (legacy.messages.length) { messages = legacy.messages; source = 'session-nodes'; }
  }
  // 三条路都没读到消息、而且**老形状那一步真的抛了**、并且连 chat 视图都取不到 —— 这才是
  // "读不出来"（不是"会话是空的"）。原来只有这一条失败分支，现在原样保留。
  if (!messages.length && legacyError && !chatSource) {
    codesysAiChatNote('snapshot.threw', legacyError);
    return { ok: false, reason: 'snapshot-threw', detail: legacyError, sessionId };
  }
  const wanted = Math.min(Math.max(Number(limit) || CODESYS_AI_SNAPSHOT_DEFAULT, CODESYS_AI_SNAPSHOT_MIN), CODESYS_AI_SNAPSHOT_MAX);
  const recent = messages.length > wanted ? messages.slice(messages.length - wanted) : messages;
  // T175：快照顺便带**当前模型**（同步读，不联网），外壳每 1.5 秒就能发现"主页把模型改了"。
  const model = codesysAiChatModelSummary(ctx, sessionId, conversation);
  // T183：**进行中**那一组事实（见上面 T183 段）。外壳据此画主界面那两样表现：
  // 运行中没有推理文本 → 实时行"正在分析请求"；有推理文本 → 标题"思考"的折叠行。
  const activity = codesysAiChatRunningFacts(ctx, sessionId, conversation);
  const reasoning = codesysAiChatReasoningOfChatView(chatView);
  // T185：**待回答**（见上面 T185 段）。它和 T183 那一组是**两件事**：`running` 说的是"回合还在跑"，
  // 而"待回答"说的是"这一回合正卡在等人回答上"。两条都回传，怎么画由外壳决定（观感只在一处）——
  // 这一条命令式地要求外壳：有 pendingInteraction 时**不许**再画「正在分析请求」。
  // 纯同步只读（`sessionStatus.getSnapshot()` 是一张现成的 Map），所以 1.5 秒轮询安全。
  const pendingInteraction = codesysAiChatPendingInteraction(ctx, sessionId);
  // ── 能力面（用户口径：「AI 对话就是唯一操作面，工作台只做能力提供」） ─────────────────────
  //
  // 工作台（shard 50）把"当前提案差异 / 写入闸门 / 编译结果"作为**纯数据**发布在
  // `window.__TASKHIVE_CODESYS_CAPABILITIES__`（只读投影 + `apply()`，见 50-codesys-workbench.js）。
  // 这里只**读**它并随快照回传，所以差异原文、编译结果都出现在抽屉的消息流里，不必让用户去工作台。
  // 判据：能力面自报的会话必须**就是**这条主页会话；不是（或没自报）一律当作"这一条会话没有工作台"，
  // 免得把别的会话的工程/提案当成这一条的。
  const capabilities = codesysAiChatCapabilities(sessionId);
  // `source` 让"消息是从哪条路读到的"在自报阶段里可查（chat = DSH 0.2 真形状 /
  // session-nodes = 老形状兜底 / (none) = 三条都空 —— 会话真的是空的）。
  codesysAiChatNote('snapshot.ok', `session=${sessionId} messages=${messages.length} source=${source || '(none)'} model=${(model && model.id) || '(none)'} running=${activity.running ? 1 : 0} pending=${activity.pending} reasoning=${reasoning.length} pendingInteraction=${pendingInteraction ? `${pendingInteraction.kind}:${pendingInteraction.key}` : '(none)'} capabilities=${capabilities ? `${capabilities.proposal ? capabilities.proposal.changeCount : 0}/${(capabilities.build && capabilities.build.state) || 'idle'}` : '(none)'}`);
  return {
    ok: true,
    sessionId,
    total: messages.length,
    truncated: recent.length < messages.length,
    messages: recent,
    model,
    // 进行中：主界面画的就是这几件事（见 T183 段），多一个字都不加。
    running: activity.running,
    runningVia: activity.via,
    pending: activity.pending,
    awaitingFirstTurn: activity.awaitingFirstTurn,
    reasoning,
    // T185：**待回答**（纯数据，`null` = 没有）。外壳据它画"等待回答"那一段，并**代替不了**用户：
    // 要回答问题必须走 `answer(payload)`，而那只在用户点「提交回答」时才会被调用。
    pendingInteraction,
    // A 段：工作台能力面（纯数据，`null` = 这条会话没有可读的工作台）。外壳据它把**差异原文**、
    // 「确认写入工程」与**编译结果**画进消息流；写入只能由那枚按钮的点击发起（`apply(payload)`）。
    capabilities,
  };
}

// 往**主页同一条会话**里发一条 prompt。成功/失败都返回数据（绝不静默）。
async function codesysAiChatPrompt(ctx, text) {
  const value = String(text === undefined || text === null ? '' : text).trim();
  if (!value) return { ok: false, reason: 'empty-text', detail: '没有可发送的文本' };
  const main = codesysAiChatMainSession(ctx);
  if (main.reason) {
    codesysAiChatNote(`prompt.${main.reason}`, main.detail);
    return { ok: false, reason: main.reason, detail: main.detail, sessionId: main.sessionId || '' };
  }
  const sessionId = main.sessionId;
  const conversation = main.conversation;
  if (typeof conversation.prompt !== 'function') {
    codesysAiChatNote('prompt.no-prompt', '');
    return { ok: false, reason: 'no-prompt', detail: `会话 ${sessionId} 没有 prompt 入口`, sessionId };
  }
  // T184：发送前再兜一次"工作台已绑定当前工程"。抽屉打开时已经触发过一次，这里是**幂等**的
  // 安全网：用户可能在抽屉打开后立刻发送（那一次绑定还没走完），或者那次触发时右栏还没挂起来。
  // 同样**不 await 绑定完成**，只把结果作为数据回传 —— 外壳只在失败时写一行，成功全程静默。
  let workbench = null;
  try { workbench = await codesysAiChatEnsureWorkbench(ctx); }
  catch (error) { workbench = { ok: false, bound: false, started: false, reason: 'workbench-ensure-threw', detail: String((error && error.message) || error), sessionId: String(sessionId || '') }; }
  let accepted = null;
  try { accepted = await conversation.prompt([{ type: 'text', text: value }], 'queue'); }
  catch (error) {
    const detail = String((error && error.message) || error);
    codesysAiChatNote('prompt.threw', detail);
    return { ok: false, reason: 'prompt-threw', detail, sessionId };
  }
  if (accepted && accepted.error) {
    const detail = String(accepted.error.message || accepted.error);
    codesysAiChatNote('prompt.rejected', detail);
    return { ok: false, reason: 'rejected', detail, sessionId };
  }
  codesysAiChatNote('prompt.ok', `session=${sessionId} chars=${value.length}`);
  // T184：把"发送前那次确保绑定"的结果原样带上（数据，供外壳只在失败时写一行）。
  return { ok: true, sessionId, chars: value.length, workbench };
}

// ── B 段：左侧栏「收起/展开」是**外壳 chrome**，不是导航 —— 不许把用户从插件面拽回会话面 ──────
//
// 用户报障（原文）：「插件打开的情况下点击收起左侧栏，插件会不可见（界面上只剩「CODESYS／点击此
// 标签会在中央 Harness 工作区打开插件」这类文字）」。
//
// 真因（逐行可查，全部在代码事实上）：
//   ① `80-codesys-task-and-apply.js:26-41` 的 `installNativeNavigationBridge().onClick` 是 document
//      捕获阶段的一个**兜底**：任何落在左栏（`button.closest('[data-pane="sidebar"],[class*="sidebarCol"]')`）
//      且不是「设置 / 会话 / 工作区」行上的点击，最后都会走到 `openSurface('chat')`（:40）。
//      左栏的收起按钮就在这一列里（DSH 布局：`dsh-client-ui-layout` 的 `*_sidebarCol` 是左栏那一列，
//      侧栏根节点与它的 toggle 都在其中），它的可读名字是「收起侧边栏 / 展开侧边栏」
//      （`dsh-client-ui-sidebar` 的 `toggle.collapse` / `toggle.open`），所以它命中的正是这条兜底。
//   ② `openSurface('chat')` → postMessage → preload → IPC `surface:open` = 'chat'
//      → `main.js:2011` 判定 `dshRendered` → `main.js:2012` `hidePluginSurface()`
//      → `main.js:1542` `removeChildView(pluginSurfaceView)`：**原生插件面被摘下来**。
//   ③ 为什么点插件入口不会这样：那条路上 `onSurfaceEntryClick`（80:229）先开插件面，随后 DSH 自己
//      的 React 把主面板挂载 → `activating()` 的 `useEffect` 再 `openSurface('codesys')`（80:110）
//      把面重新打开。而收起按钮**不挂载任何主面板**（主面板是 keepMounted，那个 effect 不会再跑），
//      于是那一条 'chat' 之后再没有任何人把插件面要回来 —— 用户看到的就是插件消失、露出主面板里
//      那句占位文字（「CODESYS／点击此标签会在中央 Harness 工作区打开插件」，00-core-and-surfaces.js:145）。
//
// 修法（最小且精确）：在**同一个文档**里、比 80 那条兜底**更早**注册一个 `window` 捕获阶段监听器，
// 只在"这是一次左栏 chrome 点击（收起/展开侧边栏）**且**当前打开的 surface 是插件面"时，把这一趟
// 里紧随其后的 `openSurface('chat')` **吞掉**。吞掉的不是用户意图：用户点的是"收起左栏"，
// 没有任何一步表达"回到会话面"。窗口只覆盖这一次点击的同步派发（`setTimeout(0)` 摘除），
// 所以真正的导航点击（会话行 / 新会话 / 插件入口）一字不改。
//
// 为什么在 shard 78 里、而不是改 80：本轮写作用域不允许改 shard 80 / 70（布局桥）。这里只**复用**
// 00-core 既有的 `openSurface()` 与 `setPluginSurfaceMode()`，不新增通道、不新增 DOM、不改任何几何。
const CODESYS_SIDEBAR_CHROME_LABEL = /收起(?:左侧)?侧边栏|展开(?:左侧)?侧边栏|收起左侧栏|展开左侧栏|collapse\s+(?:the\s+)?sidebar|expand\s+(?:the\s+)?sidebar/i
// 会被原生 WebContentsView 承载的 surface（DSH 自渲染的那几个不算：chat / settings / knowledge）。
const CODESYS_SIDEBAR_CHROME_RENDERED = new Set(['chat', 'settings', 'knowledge'])

function installSidebarChromeSurfaceGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  // 同一个文档里只装一次（client-hmr 会重跑 apply，闭包标志会被新实例重置，所以状态挂 window）。
  const previous = window.__TASKHIVE_SIDEBAR_CHROME_GUARD__
  if (previous && previous.installed === true && typeof previous.dispose === 'function') return previous.dispose
  const state = { installed: true, armed: false, swallowed: 0, lastLabel: '', dispose: null }
  const isSidebarChromeClick = (event) => {
    const target = event?.target
    if (!target || typeof target.closest !== 'function') return ''
    const button = target.closest('button,[role="button"],[role="tab"]')
    if (!button) return ''
    const label = String(button.getAttribute?.('aria-label') || button.getAttribute?.('title') || button.textContent || '').trim()
    if (!label || !CODESYS_SIDEBAR_CHROME_LABEL.test(label)) return ''
    return label
  }
  const activePluginSurface = () => {
    const active = String(window.__TASKHIVE_ACTIVE_SURFACE__ || 'chat')
    return active && !CODESYS_SIDEBAR_CHROME_RENDERED.has(active) ? active : ''
  }
  const onCapture = (event) => {
    const label = isSidebarChromeClick(event)
    if (!label) return
    state.lastLabel = label
    // 只有"插件面正开着"时才需要保护；否则这一趟的 chat 请求要么本来就是用户意图，要么是空操作。
    if (!activePluginSurface()) return
    state.armed = true
    setTimeout(() => { state.armed = false }, 0)
  }
  window.addEventListener('click', onCapture, true)
  // 复用 00-core 既有的 openSurface：只在这一个窗口里吞掉 `chat`，其余调用原样转发。
  const baseOpenSurface = openSurface
  if (typeof baseOpenSurface === 'function') {
    const guarded = function openSurfaceGuardedBySidebarChrome(kind) {
      const next = String(kind || 'chat')
      if (state.armed && next === 'chat' && activePluginSurface()) {
        state.swallowed += 1
        codesysAiChatNote('sidebar-chrome.kept-surface', `label=${state.lastLabel} surface=${activePluginSurface()}`)
        return
      }
      return baseOpenSurface(next)
    }
    openSurface = guarded
    state.dispose = () => {
      window.removeEventListener('click', onCapture, true)
      if (openSurface === guarded) openSurface = baseOpenSurface
      if (window.__TASKHIVE_SIDEBAR_CHROME_GUARD__ === state) delete window.__TASKHIVE_SIDEBAR_CHROME_GUARD__
    }
  } else {
    state.dispose = () => {
      window.removeEventListener('click', onCapture, true)
      if (window.__TASKHIVE_SIDEBAR_CHROME_GUARD__ === state) delete window.__TASKHIVE_SIDEBAR_CHROME_GUARD__
    }
  }
  window.__TASKHIVE_SIDEBAR_CHROME_GUARD__ = state
  return state.dispose
}

// ── A 段：工作台能力面（只读读法 + 写入入口） ─────────────────────────────────────────────
//
// 工作台的发布形态（见 `50-codesys-workbench.js` 的抽屉能力面那一段）：
//   window.__TASKHIVE_CODESYS_CAPABILITIES__ = { version, sessionId(), signature(), read(), apply(input) }
// 这里**只读** `read()`，并把结果原样交给外壳；`apply(input)` 只被 `bridge.apply()` 调，而
// `bridge.apply()` 只被主进程的 `codesys:ai-chat-apply` 通道调 —— 那条通道又只有外壳抽屉里
// 「确认写入工程」那一次点击会发起。**没有任何轮询 / 定时器 / 自动路径会走到 apply()。**
// 会话判等：能力面自报的会话必须与这条主页会话相同；自报为空视为"还没准备好"，同样不采用。
function codesysAiChatCapabilities(sessionId) {
  if (typeof window === 'undefined') return null;
  try {
    const seam = window.__TASKHIVE_CODESYS_CAPABILITIES__;
    if (!seam || typeof seam.read !== 'function') return null;
    const reported = typeof seam.sessionId === 'function' ? String(seam.sessionId() || '') : '';
    if (!reported || reported !== String(sessionId || '')) return null;
    const value = seam.read();
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch (error) {
    codesysAiChatNote('capabilities.threw', String((error && error.message) || error));
    return null;
  }
}

// 把抽屉里那一次点击交给工作台**既有的**写入函数（`applyProposal` → `apply-and-build`）。
// 这一层不解释、不补全、不重试：`apply()` 返回什么就回传什么（成功 / 被 sha 防护挡下 / 失败）。
// 唯一的"本地"判据是会话判等（不是这条会话的工作台就不许写），其余全部由工作台自己判定。
async function codesysAiChatApply(input) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  const seam = window.__TASKHIVE_CODESYS_CAPABILITIES__;
  if (!seam || typeof seam.apply !== 'function') {
    return { ok: false, reason: 'no-capabilities', detail: 'DSH 侧没有工作台能力面（入口 window.__TASKHIVE_CODESYS_CAPABILITIES__）：工作台组件还没挂载。请先点面板上的「代码任务」或「AI 对话」把工作台挂起来。' };
  }
  if (typeof seam.sessionId === 'function') {
    const reported = String(seam.sessionId() || '');
    const expected = String(input?.sessionId || '');
    if (reported && expected && reported !== expected) {
      return { ok: false, reason: 'foreign-session', detail: '这条工作台属于另一条会话：请不要在这里写入。' };
    }
  }
  const startedAt = Date.now();
  const value = await seam.apply({
    proposalSignature: String(input?.proposalSignature || ''),
    overwriteConfirmed: input?.overwriteConfirmed === true,
  });
  const outcome = value && typeof value === 'object' ? value : { ok: false, reason: 'apply-empty', detail: '工作台没有回报写入结果' };
  codesysAiChatNote(outcome.ok === true ? 'apply.ok' : 'apply.blocked', `reason=${outcome.reason || ''} written=${outcome.written || 0} ms=${Date.now() - startedAt}`);
  return outcome;
}

// ── 本轮：**放弃**（用户原话「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」）──────────
//
// 为什么走 postMessage 而不是再加一条 IPC 通道：这条动作**不写工程**（它只能*减少*待写入内容：
// 作废 AI 提案 + 手写草稿），而外壳 → DSH 已经有一条现成的通路 —— `app/renderer/renderer.js` 把
// `{source:'taskhive-desktop'}` 消息 postMessage 进本框架（`codesys.task` 走的就是它）。于是这里
// 只需要一个监听器 + 一次回信，主进程 / preload / 通道清单（CODESYS_PANEL_ONLY_CHANNELS）一个字都不用改。
//
// 安全语义与 apply 完全一致：
//   * **没有用户点击 ⇒ 这里 0 次调用**：没有任何轮询 / 定时器 / 自动路径会发这条消息；
//   * 身份判据照 shard 80 既有的 desktop 消息写法：`event.source` 只认本窗口或它的父窗口（外壳），
//     DSH 文档里的别的东西发不出这条消息；
//   * 交给工作台能力面的 `discard()`：作废提案与手写草稿、按磁盘最新内容重读编辑器，
//     **不写工程、不编译、不推进写入基线**。
const CODESYS_AI_CHAT_DISCARD_MESSAGE = 'codesys.proposal.discard'
const CODESYS_AI_CHAT_DISCARD_REPLY = 'codesys.proposal.discarded'

// 把结果回给外壳（`window.parent`）。**永不抛**：回信失败不能让那一次放弃在抽屉里永远"在途"。
function codesysAiChatDiscardReply(input, value) {
  if (typeof window === 'undefined' || !window.parent || typeof window.parent.postMessage !== 'function') return
  try {
    window.parent.postMessage({
      source: 'taskhive-dsh',
      type: CODESYS_AI_CHAT_DISCARD_REPLY,
      nonce: String(input?.nonce || ''),
      sessionId: String(input?.sessionId || ''),
      ok: value?.ok === true,
      reason: String(value?.reason || ''),
      detail: String(value?.detail || ''),
      // 外壳那一行"已放弃此提案与 N 处手写改动"里的 N 就是它（工作台自己数出来的，不是猜的）。
      droppedDrafts: Number(value?.droppedDrafts || 0),
      hadProposal: value?.hadProposal === true,
    }, '*')
  } catch (error) {
    codesysAiChatNote('discard.reply-failed', String((error && error.message) || error))
  }
}

// 把外壳那一次点击交给工作台**既有的**清状态函数（`discardProposal`）。这一层不解释、不补全：
// `discard()` 返回什么就回传什么。唯一的"本地"判据是会话判等（不是这条会话的工作台就不许放弃）。
async function codesysAiChatDiscard(input) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' }
  const seam = window.__TASKHIVE_CODESYS_CAPABILITIES__
  if (!seam || typeof seam.discard !== 'function') {
    return { ok: false, reason: 'no-capabilities', detail: 'DSH 侧没有工作台能力面（入口 window.__TASKHIVE_CODESYS_CAPABILITIES__）：工作台组件还没挂载。请先点面板上的「代码任务」或「AI 对话」把工作台挂起来。' }
  }
  if (typeof seam.sessionId === 'function') {
    const reported = String(seam.sessionId() || '')
    const expected = String(input?.sessionId || '')
    if (reported && expected && reported !== expected) {
      return { ok: false, reason: 'foreign-session', detail: '这条工作台属于另一条会话：请不要在这里放弃。' }
    }
  }
  const startedAt = Date.now()
  const value = await seam.discard({ proposalSignature: String(input?.proposalSignature || '') })
  const outcome = value && typeof value === 'object' ? value : { ok: false, reason: 'discard-empty', detail: '工作台没有回报放弃结果' }
  codesysAiChatNote(outcome.ok === true ? 'discard.ok' : 'discard.blocked', `reason=${outcome.reason || ''} drafts=${Number(outcome.droppedDrafts || 0)} ms=${Date.now() - startedAt}`)
  return outcome
}

// 「放弃」唯一的入口（安装一次，随数据桥卸载一起摘掉）。判据与 shard 80 的 desktop 消息一字不差：
// `source === 'taskhive-desktop'` + `event.source` 只认自己或父窗口。
function installCodesysAiChatDiscardListener() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const onMessage = (event) => {
    if (event?.data?.source !== 'taskhive-desktop' || event?.data?.type !== CODESYS_AI_CHAT_DISCARD_MESSAGE) return
    if (event.source !== window && event.source !== window.parent) return
    const input = event.data
    Promise.resolve()
      .then(() => codesysAiChatDiscard(input))
      .then((value) => codesysAiChatDiscardReply(input, value))
      .catch((error) => codesysAiChatDiscardReply(input, { ok: false, reason: 'discard-crashed', detail: String((error && error.message) || error) }))
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

// ── T184：点开「AI 对话」= 默认把工作台绑到 CODESYS 面板当前跟随的那个工程 ──────────────────
//
// 报障（用户原文）：点「AI 对话」后让 AI"写入一个名为 test 的程序"，AI 回"无法写入，因为代码
// 工作台没有绑定工程"；用户要求"点击 AI 对话时应当默认绑定工程"。
//
// 真因**不是**模型也不是提案链路：工作台的绑定与状态发布只发生在**它自己的 React 组件**里
// （`50-codesys-workbench.js` 的 `CodesysWorkbench`）—— 组件挂载且页签可见时才会
// `detectCurrentProject({ force: true })`（`codesys:current-project` → `bind-project`
// → `inspect-project`），随后才把 `projectPath` 发布给宿主（`index.js` 的
// `publishWorkbenchState`）。而"点开 AI 对话抽屉"这条路上**从来没有**任何一步去打开那个页签或
// 触发探测，所以只要用户这一轮没点过面板上的「代码任务」，`taskhive_codesys_workbench` 读到的
// 就是空状态 → "尚未打开或尚未绑定工程"。
//
// 修法：**不新造绑定机制**，只把"工作台该出现了"这一个动作接到抽屉打开上（两条都走既有流程）：
//   * 工作台页签已在（`codesysWorkbenchControl.detect` 已由组件注册）→ 直接调它，走组件既有的
//     `detectCurrentProject({ force: true })`；
//   * 页签不在 → `ctx.sidebarRight.openTab(CODESYS_AI_CHAT_WORKBENCH_TAB)`（shard 80 注册的
//     **同一个**页签）把组件挂起来（右栏折叠时先用既有的 `ensureRightSidebarOpen()` 展开）；它
//     挂载 / 变为可见时自己会 force 探测并绑定（`50-codesys-workbench.js` 的 `[sessionId,
//     tabVisible]` effect）。**T192：DSH 的 openTab 一定会把页签展开并顶到最前（真包证据见下面
//     T192 段），所以这一步之后立刻把右栏还原成用户原来的样子** —— 用户报障"打开 AI 对话时
//     CODESYS 工作台跳出来"说的就是这一步，而还原不会削弱绑定能力（同样见 T192 段）；
//   * 页签**开不了**（用户停在 CODESYS 插件面板时 DSH 的会话面没有挂载，真机日志原文
//     `sidebarRight: no session surface is mounted`）→ 投递外壳「代码任务」通路的那条消息
//     （见下面 ③b）：由 shard 80 既有的 `openCodesysWorkbench()` 先 `openSurface('chat')` 把会话面
//     挂起来、再在右栏 ready 之后开同一个页签。目标是"点「AI 对话」就能绑上"，**不要求**用户
//     先手动点一次「代码任务」（那只是两级都失败时的一句话兜底）。
//
// 安全语义（务必保持）：两条路都**只绑定** —— `bind-project` 只把工程复制进隔离作业再读树，
// 不写工程文件、不编译、不确认；`apply-and-build` 仍然只有工作台里的「确认写入工程」按钮会调。
// 这里也**不 await 绑定完成**：真机上绑定要等 ScriptEngine（界面口径是"几十秒"），抽屉打开不能
// 等它。绑定失败 / 面板没有工程时的**一行可读原因由工作台自己的状态行**给出
// （`detectCurrentProject` 的失败分支本来就 `setStatus` 一行，不静默）；本函数只负责"连工作台都
// 打不开"这一类失败，那一种必须回传给外壳显示。
const CODESYS_AI_CHAT_WORKBENCH_TAB = 'taskhive:codesys-workbench'

// 只读地看一眼"本会话的工作台是否已经绑定了工程"。seam 是工作台自己发布的镜像
// （`window.__TASKHIVE_CODESYS_WORKBENCH__`，见 40-session-records-panel.js），按**会话判等**，
// 所以永远不会把别的会话的工程当成这一条会话的。取不到一律当"没绑定"，继续走绑定流程。
function codesysAiChatWorkbenchState(sessionId) {
  try {
    const seam = window.__TASKHIVE_CODESYS_WORKBENCH__
    const state = seam && typeof seam.getState === 'function' ? seam.getState() : null
    if (!state || typeof state !== 'object') return null
    if (String(state.sessionId || '') !== String(sessionId || '')) return null
    return state
  } catch { return null }
}

// ── T192：右栏"安静挂载" —— 能力照旧挂上，但用户眼前的右栏看上去没变 ─────────────────────────
//
// 用户报障（原文）："打开ai对话的时候 codesys工作台会跳出来"。
//
// 真因**不在**本插件，而在 DSH 的 `sidebarRight.openTab` 自己（权威包
// `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.0-rc.1` 的 `lib/client.js`，就是真机装的那一份）：
//   * `openTab(kind, options)`（:6412）→ `placeTab`（:6467）→ `place`（:6478）→ store 的
//     `openContent`（:5266）；而 `openContent` 干的**第一件事**就是 `planSetExpanded(state, true)`
//     （:5269）—— 无条件把右栏展开；
//   * 接着要么 `planOpenContent` 造一个新页签（新页签必然成为该 pane 的 activeTabId），要么对
//     **已经存在**的页签直接 `focusTab`（:5287-5292）—— 两种情况都把工作台顶到最前；
//   * `openTab` 的 placement 只认 `paneId` / `preferNewPane` / `replaceTab` / `revealIfOpened`
//     （:6480-6491）。**没有** `activate:false`，也**没有** `expand:false`；`revealIfOpened`
//     只决定"已经开着的页签要不要再显示一遍"，与要不要展开无关。
//     结论：DSH 侧**不存在**"打开但不激活"，这条 API 也没有 `setExpanded`（只有 `toggleExpanded`
//     与 `isExpanded`，:6534/:6538）。
//
// 而且"必须先激活"是硬约束，不是我们的选择：工作台自己的 `detect` 只在页签**可见**时注册
// （`50-codesys-workbench.js:769-776`），而 `tab.visible` 的真包定义是
//   `active && (pane.host === "float" || layout.expanded && (title || pane.activeTabId === tabId))`
// （真包 `:8983`）。折叠着、或只是后台页签时 `visible` 为假 → `detect` 为 null → 连"触发一次绑定"
// 都做不到。所以"完全不动右栏"在 DSH 侧做不到（已如实报告，见本轮交付说明）。
//
// 本轮做的是**最小扰动**：让 DSH 那一步照常发生，然后**趁用户还没看见**把右栏还原回去。
// 用的全是 DSH **公开**的 sidebarRight 面（同一份真包）：
//   * 开之前读用户原来的样子 —— `active()`（:6524，当前激活页签的记录）与 `isExpanded()`（:6534）；
//     会话面没挂载时这两个只会给缺省值，所以先看 `mounted.getSnapshot()`（:6336 的
//     ISidebarRight.mounted）—— 那时**不记快照**，宁可不动也不猜（否则会把用户本来就展开的右栏折起来）；
//   * `openTab`（原样，能力一步不少）；
//   * 等"页签真的可见了"：判据是 `codesysWorkbenchControl.detect` 由 null 变成函数 —— 同一个 React
//     commit 里"注册 detect"那条 effect（`50:769`）先跑、紧接着"force 探测"那条（`50:777`）才跑，
//     所以看到它非空就等于**探测已经发出去了**；
//   * 立刻还原：`focus(原来那个页签)`（:6550）+ 原来折叠着就 `toggleExpanded()`（:6538）折回去。
//
// 为什么还原之后能力不缩水（三条都能在真机上验）：
//   * 工作台页签注册时带 `keepMounted: true`（`80-codesys-task-and-apply.js:238`），DSH 的座位在右栏
//     折叠时**照样渲染面板与页签体**（真包 `:5839` 只在 `surface === undefined` 时返回 null，
//     `:5470` 的文档也写明"折叠时 docked content 仍然挂着"），所以组件**不会卸载**；
//   * 探测是一条异步链（`50:661` 起），链上**没有任何** visibility 判据 —— 一旦发出就与本函数无关地
//     跑完（`bindSourceProject` → `inspect-project` → `projectPath`）；
//   * 状态回传也不依赖可见性：`publishCodesysState`（`50:574`）里那条 900ms 合并发送（`50:586-590`）
//     无条件发出；宿主侧 `projectBound` 的判据是 `Boolean(state.projectPath)`（`index.js:590`），
//     与 `visible` 无关；
//   * **还原之前抓住的那个 detect 会留给下一次抽屉打开用**（`codesysAiChatWorkbenchMounted`）：它是个
//     闭包 `(options) => detectCurrentProjectRef.current?.(options)`，指向组件里的同一个探测函数，
//     所以连点 / 反复开关抽屉既不重新挂载，也不产生任何右栏动作（幂等）。
//
// 代价（不藏，与上面的"做不到"一起报告）：DSH 那一步"展开 + 顶到最前"是无条件的，我们只能在
// **下一帧绘制之前**折回去（等待用 setTimeout(0) 轮询，真机常态是 0-2 个宏任务就还原），所以最坏
// 情况是**一帧**的闪现，而不是"跳出来停在那儿"。另外 `workbenchVisible`
// （`workbenchIntersecting && tabVisible`，`50:346`）会随页签一起变回假，工作台自己那条"等 CODESYS
// 里出现工程"的后台重试节奏会停（`50:859-879` 明写在 `visibleRef.current` 上）—— 这不是本函数能
// 回避的（它要的正是"用户看不见"）；补偿是下一次抽屉打开会再用抓住的 detect 探一次，用户在 CODESYS
// 面板里点开工程之后打开抽屉 / 点工作台页签都会重新探测。
const CODESYS_AI_CHAT_WORKBENCH_VISIBLE_TIMEOUT_MS = 400
const codesysAiChatWorkbenchMount = { sessionId: '', detect: null, sidebarRight: null }

// 右栏"用户看得见的那一面"的快照。取不到（没有会话面 / 这一版 DSH 没有 mounted）一律返回 null ——
// 调用方据此**不还原**：宁可让右栏多停一会儿，也不要把用户自己的状态改成我们猜的样子。
function codesysAiChatRightColumnSnapshot(sidebarRight) {
  if (!sidebarRight) return null
  let mountedSession
  try {
    const mounted = sidebarRight.mounted
    mountedSession = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : undefined
  } catch { return null }
  // undefined / null / '' = 会话面没挂载：active() / isExpanded() 这时给的是缺省值，不是用户的界面。
  if (mountedSession === undefined || mountedSession === null || mountedSession === '') return null
  let expanded = null
  try { expanded = typeof sidebarRight.isExpanded === 'function' ? sidebarRight.isExpanded() === true : null } catch { expanded = null }
  let activeTabId = ''
  try {
    const active = typeof sidebarRight.active === 'function' ? sidebarRight.active() : null
    activeTabId = active && active.id ? String(active.id) : ''
  } catch { activeTabId = '' }
  if (expanded === null && !activeTabId) return null
  return { expanded, activeTabId, sessionId: String(mountedSession) }
}

// 还原成快照那一刻的样子。永不抛：这一步失败只是"右栏多停一会儿"，不该把 ensureWorkbench 变成失败。
function codesysAiChatRestoreRightColumn(sidebarRight, before) {
  if (!sidebarRight || !before) return { restored: false, detail: 'no-snapshot' }
  const done = []
  try {
    if (before.activeTabId && typeof sidebarRight.focus === 'function') {
      const active = typeof sidebarRight.active === 'function' ? sidebarRight.active() : null
      const currentId = active && active.id ? String(active.id) : ''
      if (currentId !== before.activeTabId) { sidebarRight.focus(before.activeTabId); done.push(`focus=${before.activeTabId}`) }
    }
  } catch (error) { done.push(`focus-failed=${String((error && error.message) || error)}`) }
  try {
    if (before.expanded === false
      && typeof sidebarRight.isExpanded === 'function' && typeof sidebarRight.toggleExpanded === 'function'
      && sidebarRight.isExpanded() === true) {
      sidebarRight.toggleExpanded()
      done.push('collapsed')
    }
  } catch (error) { done.push(`collapse-failed=${String((error && error.message) || error)}`) }
  return { restored: done.length > 0, detail: done.join('+') }
}

function codesysAiChatWorkbenchDetectReady() {
  try { return Boolean(codesysWorkbenchControl && typeof codesysWorkbenchControl.detect === 'function') } catch { return false }
}

// 等一下"工作台页签真的可见"（判据见上面长注释）。有界：超时就如实返回 visible:false，由调用方
// 照常还原并把原因写进审计流 —— 绝不无限等，也绝不静默。
async function codesysAiChatWaitForWorkbenchVisible() {
  if (codesysAiChatWorkbenchDetectReady()) return { visible: true, waited: 0, detail: '' }
  // shard 10 的 `codesysWorkbenchControl` 对象本身都取不到时，没有任何组件会把 detect 注册进来，
  // 也就没有可等的信号 —— 直接如实回报。真机的 bundle 里它一定在（shard 10 顶层就建了它），
  // 这一步只让契约 / 探针环境不必白等。
  let observable = false
  try { observable = Boolean(codesysWorkbenchControl) && typeof codesysWorkbenchControl === 'object' } catch { observable = false }
  if (!observable) return { visible: false, waited: 0, detail: '当前 bundle 里没有工作台控制对象（codesysWorkbenchControl），无法确认页签是否已经可见' }
  const timerFactory = typeof setTimeout === 'function' ? setTimeout : null
  if (!timerFactory) return { visible: false, waited: 0, detail: '当前文档没有 setTimeout，无法等工作台页签变为可见' }
  const startedAt = Date.now()
  while (Date.now() - startedAt < CODESYS_AI_CHAT_WORKBENCH_VISIBLE_TIMEOUT_MS) {
    // setTimeout(0)：一有机会就检查，尽量赶在下一帧绘制之前还原（不产生可见的展开）。
    await new Promise((resolve) => { timerFactory(resolve, 0) })
    if (codesysAiChatWorkbenchDetectReady()) return { visible: true, waited: Date.now() - startedAt, detail: '' }
  }
  const waited = Date.now() - startedAt
  return { visible: false, waited, detail: `等了 ${waited}ms 工作台页签仍未变为可见（它自己的 detect 没有注册）` }
}

// 还原之前把工作台自己的探测函数留下来 —— 它由组件注册（`50:773`），是个指向组件内部
// `detectCurrentProjectRef` 的闭包，页签不再可见之后依然可用（组件带 keepMounted，不会卸载）。
function codesysAiChatRememberWorkbenchDetect(sessionId, sidebarRight) {
  const control = codesysWorkbenchControl
  if (!control || typeof control.detect !== 'function') return false
  codesysAiChatWorkbenchMount.sessionId = String(sessionId || '')
  codesysAiChatWorkbenchMount.detect = control.detect
  codesysAiChatWorkbenchMount.sidebarRight = sidebarRight || null
  return true
}

// 上一次抓住的探测函数还算数吗？两条判据，都是"组件还活着"的可执行证据（真包 :6374 / :6336）：
//   ① 右栏座位**还挂在这个会话上** —— 用户切到别的 surface 时座位会卸载，那时抓住的闭包指向一个
//      已经不画的组件，不能再调它（`mounted.getSnapshot()` 是公开面）；会话也对不上就更不能；
//   ② 工作台页签**还在这个会话的右栏布局里** —— 用户把页签关掉时组件会真的卸载。
// 任一条不成立就丢掉它，让下一次抽屉打开老老实实重新挂一遍：能力宁可多花一次挂载，也不许静默丢失。
function codesysAiChatWorkbenchMounted(sessionId) {
  const mount = codesysAiChatWorkbenchMount
  if (!mount || typeof mount.detect !== 'function') return false
  if (String(mount.sessionId || '') !== String(sessionId || '')) return false
  const sidebarRight = mount.sidebarRight
  let mountedSession
  try {
    const mounted = sidebarRight && sidebarRight.mounted
    mountedSession = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : undefined
  } catch { return false }
  if (mountedSession === undefined || mountedSession === null || mountedSession === '') return false
  if (String(mountedSession) !== String(sessionId || '')) return false
  try {
    if (sidebarRight && typeof sidebarRight.tabsIn === 'function') {
      const tabs = sidebarRight.tabsIn(String(sessionId || ''))
      if (Array.isArray(tabs) && !tabs.some((tab) => tab && String(tab.kind || '') === CODESYS_AI_CHAT_WORKBENCH_TAB)) return false
    }
  } catch { /* 取不到布局就保守地当它还在：代价最多是多触发一次只读探测，而不是丢掉能力 */ }
  return true
}

// 抽屉打开（或发送第一条消息前）调用一次。返回的**全是数据**：
//   { ok, bound, started, reason, detail, sessionId, projectPath, projectName, via }
// 只有"连工作台都打不开（右栏页签与「代码任务」通路两级都失败）/ 没有可用的主页会话"才 ok:false
// —— 那是外壳状态行必须写的一行。
// 已经绑定 → ok:true/bound:true（一次往返都不产生）。触发成功 → ok:true/started:true
// `via` 是**纯观测**字段（外壳不据此分支），四档：
//   ''                 = 第一级：右栏页签已在（`control.detect` 当下就注册着，页签本来就可见）；
//   'already-mounted'  = T192：复用上次安静挂载时抓住的 detect（这一次**零右栏动作**，幂等）；
//   'session-panel'    = ③b 最小扰动：挂会话面 + 开页签（不切用户的 surface）；
//   'code-task'        = ③c 最后兜底：外壳「代码任务」通路（那一条会切界面）。
async function codesysAiChatEnsureWorkbench(ctx) {
  const main = codesysAiChatMainSession(ctx)
  if (main.reason) {
    return { ok: false, bound: false, started: false, reason: main.reason, detail: main.detail || '', sessionId: String(main.sessionId || '') }
  }
  const sessionId = String(main.sessionId || '')
  const published = codesysAiChatWorkbenchState(sessionId)
  if (published && String(published.projectPath || '')) {
    codesysAiChatNote('workbench.already-bound', `session=${sessionId} project=${String(published.projectName || published.projectPath || '')}`)
    return {
      ok: true, bound: true, started: false, reason: '', detail: '', sessionId,
      projectPath: String(published.projectPath || ''), projectName: String(published.projectName || ''),
    }
  }
  // ① 工作台已经挂起来过：直接触发它自己的探测/绑定流程（force 会绕过 45 秒节流）。
  const control = codesysWorkbenchControl
  if (control && typeof control.detect === 'function') {
    try { void control.detect({ force: true, reason: 'ai-chat-open' }) }
    catch (error) {
      const detail = String((error && error.message) || error)
      codesysAiChatNote('workbench.detect-threw', detail)
      return { ok: false, bound: false, started: false, reason: 'workbench-detect-threw', detail: `触发工作台绑定当前工程失败：${detail}；请点面板上的「代码任务」手动绑定工程。`, sessionId }
    }
    codesysAiChatNote('workbench.detect-started', `session=${sessionId}`)
    return { ok: true, bound: false, started: true, reason: '', detail: '', sessionId }
  }
  // ①b T192：页签**当下**不可见（上一轮我们已经把右栏还原成了用户原来的样子），但它的探测函数在
  // 还原之前就被抓住了 —— 复用那一个。这一条路上**一次右栏动作都不产生**，所以"连点 / 反复开关抽屉"
  // 不会再让它闪一下（幂等），而 capability 一步不少（同一个探测函数、同样的 force）。
  if (codesysAiChatWorkbenchMounted(sessionId)) {
    try { void codesysAiChatWorkbenchMount.detect({ force: true, reason: 'ai-chat-open' }) }
    catch (error) {
      const detail = String((error && error.message) || error)
      codesysAiChatNote('workbench.detect-captured-threw', detail)
      return { ok: false, bound: false, started: false, reason: 'workbench-detect-threw', detail: `触发工作台绑定当前工程失败：${detail}；请点面板上的「代码任务」手动绑定工程。`, sessionId }
    }
    codesysAiChatNote('workbench.detect-captured', `session=${sessionId}；用的是上次安静挂载时抓住的 detect（右栏零动作）`)
    return { ok: true, bound: false, started: true, via: 'already-mounted', reason: '', detail: '', sessionId }
  }
  // ② 工作台页签还没开过：打开它（同一个页签），组件挂载时自己会 force 探测并绑定 —— 真正把这个
  // 页签"摆到用户面前"的其实是 DSH 自己（openTab 无条件展开 + 顶到最前，证据见下面 T192 段），
  // 所以这一步必须配一次还原。
  //
  // ③ 第一级（既有主路径）：右栏页签。失败**不再直接判死**，先把可读原因收下来，交给③b 兜底。
  const sidebarRight = codesysAiChatOptionalService(ctx, 'sidebarRight')
  // T192：**先记下用户原来那一面**再动手。右栏折叠着时页签挂不起来（而"组件挂载 / 可见"正是它自己
  // 探测并绑定的前提），所以先复用 shard 00 既有的 `ensureRightSidebarOpen()` —— 进入任何插件 surface
  // 时 `openSurface()` 本来就调过它，这里只是补一次；不新增机制、不建 DOM、不查选择器。
  // （真包 0.2.0-rc.1 的客户端 bundle 里已经没有 `[data-dsh-right-sidebar-toggle]` 这个属性，这一步在
  // 真机上多半是空操作；真正把右栏展开的是 DSH 自己的 `openContent` —— 两种来源都由下面的还原覆盖。）
  const before = codesysAiChatRightColumnSnapshot(sidebarRight)
  try { ensureRightSidebarOpen() } catch { /* 展开失败不影响下面的判定：openTab 的失败会带可读原因回传 */ }
  let tabFailure = ''
  let tabReason = ''
  if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
    tabReason = 'workbench-tab-service-missing'
    tabFailure = 'DSH 没有提供右栏页签服务（sidebarRight.openTab），无法在打开 AI 对话时打开「CODESYS 工作台」'
  } else {
    try { sidebarRight.openTab(CODESYS_AI_CHAT_WORKBENCH_TAB) }
    catch (error) {
      tabReason = 'workbench-tab-open-failed'
      tabFailure = `打开「CODESYS 工作台」页签失败：${String((error && error.message) || error)}`
    }
  }
  if (!tabFailure) {
    // T192：DSH 已经把工作台页签展开并顶到最前了。先等它自己的 force 探测真的发出去（判据见文件里
    // T192 段：`codesysWorkbenchControl.detect` 被组件注册 = 页签可见且那条探测 effect 已经跑），
    // 然后**马上**把右栏还原成用户原来的样子。探测是一条异步链，还原不会打断它。
    const visible = await codesysAiChatWaitForWorkbenchVisible()
    codesysAiChatRememberWorkbenchDetect(sessionId, sidebarRight)
    const restored = codesysAiChatRestoreRightColumn(sidebarRight, before)
    codesysAiChatNote('workbench.tab-opened', `session=${sessionId} visible=${visible.visible ? 'yes' : 'no'} waited=${visible.waited}ms restored=${restored.detail || 'nothing'}`
      + (visible.detail ? `；${visible.detail}` : ''))
    return { ok: true, bound: false, started: true, reason: '', detail: '', sessionId }
  }
  // ③b 第二级（**最小扰动**，T191）：只把**会话面**挂回主面板，**不切用户的 surface**。
  //
  // 为什么必须挂会话面：DSH 的右栏（工作台页签的宿主）是**会话级**的 —— 会话面没挂载时
  // `sidebarRight.openTab` 必然被拒（真机日志原文 `sidebarRight: no session surface is mounted`），
  // 而工作台组件正是"能力面"的持有者（差异数据 / 写入函数都在它里面）。挂载会话面的动作就是
  // `layout.selectPanel(null)`（null = 显示 Conversation），这一步无法回避。
  //
  // 但**可以且必须**省掉 `openSurface('chat')`：那一步才会让宿主把原生插件面摘下来、把用户从
  // CODESYS 面板拽回会话面。用户的中央视图照旧由原生插件面盖着（几何里右栏是保留区，所以右栏
  // 与它并存可见），只有 DSH 底下那一层主面板从"插件的占位面板"换成"会话面"。
  const minimal = await codesysAiChatMountWorkbenchWithoutDragging(ctx)
  if (minimal.ok) {
    // T192：这一级同样"先挂上再还原"（快照是 selectPanel 之后、真正 openTab 之前取的，见 ③b 里那一段）。
    const visible = await codesysAiChatWaitForWorkbenchVisible()
    codesysAiChatRememberWorkbenchDetect(sessionId, sidebarRight)
    const restored = codesysAiChatRestoreRightColumn(sidebarRight, minimal.before)
    codesysAiChatNote('workbench.mounted-without-drag', `session=${sessionId} visible=${visible.visible ? 'yes' : 'no'} waited=${visible.waited}ms restored=${restored.detail || 'nothing'}；右栏页签先失败：${tabFailure}`)
    return { ok: true, bound: false, started: true, via: 'session-panel', reason: '', detail: '', sessionId }
  }
  // ③c 第三级（最后兜底，既有通路）：连会话面都挂不起来（没有 layout 服务）→ 外壳「代码任务」那条。
  // 这一条会切界面（它自己做 `openSurface('chat')`），所以只在③b 根本没得试的时候才走，并且
  // 在返回值里用 `via:'code-task'` 与可读 detail 说明"为什么这一趟动了用户的界面"。
  //
  // 真机报障原文（审计流 codesys.ai-chat.workbench-unbound）：
  //   {"reason":"workbench-tab-open-failed","detail":"打开「CODESYS 工作台」页签失败：
  //    sidebarRight: no session surface is mounted；请手动点面板上的「代码任务」绑定工程。"}
  // 用户的要求是"点「AI 对话」就该绑上"，所以这里不把用户推回去手动点；投递的仍是外壳那条**一模一样**
  // 的消息（main.js:3797 → shard 80 的 onDesktopMessage → openCodesysWorkbench）。
  const fallback = codesysAiChatOpenWorkbenchViaCodeTask()
  if (fallback.ok) {
    codesysAiChatNote('workbench.opened-via-code-task', `session=${sessionId}；最小扰动那一级失败：${minimal.detail}`)
    return { ok: true, bound: false, started: true, via: 'code-task', reason: '', detail: '', sessionId }
  }
  // ④ 三级都失败：把**每一级**的可读原因一起回传（绝不静默），下一步具体到"点面板上的「代码任务」"。
  const detail = `${tabFailure}；最小扰动那一级也没能挂起会话面（${minimal.detail}）；改用外壳既有的「代码任务」通路也没能打开工作台（${fallback.detail}）：请手动点面板上的「代码任务」绑定工程。`
  codesysAiChatNote('workbench.code-task-failed', detail)
  return { ok: false, bound: false, started: false, reason: tabReason, detail, sessionId }
}

// ③b 的实现：`selectPanel(null)` 把会话面挂回主面板（右栏因此可用），然后开工作台页签。
// 四条纪律：
//   * **绝不调 openSurface('chat')**（那是"把用户拽回会话面"的那一步，也正是本轮要拿掉的）；
//   * 会话面的挂载是**异步**的，所以先订阅 `sidebarRight.mounted` 再 selectPanel，并在有限时间内重试
//     （绝不无限等：工作台挂不上只是"能力面暂不可用"，不能把抽屉打开这件事卡住）；
//   * 任何异常都吞成 `{ ok:false, detail }`，由调用方决定下一级；
//   * T192：把"真正 openTab 之前的那一瞬"的右栏快照（`before`）一起回传 —— 调用方探测一发出就
//     按它还原（用户报障"打开 AI 对话时工作台跳出来"）。
const CODESYS_AI_WORKBENCH_MOUNT_TIMEOUT_MS = 400

async function codesysAiChatMountWorkbenchWithoutDragging(ctx) {
  const layout = codesysAiChatOptionalService(ctx, 'layout')
  if (!layout || typeof layout.selectPanel !== 'function') {
    return { ok: false, detail: 'DSH 没有提供布局服务（layout.selectPanel），无法在不切走用户视图的前提下挂起会话面' }
  }
  const sidebarRight = codesysAiChatOptionalService(ctx, 'sidebarRight')
  if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
    return { ok: false, detail: 'DSH 没有提供右栏页签服务（sidebarRight.openTab）' }
  }
  let lastError = ''
  // T192：还原用的快照必须**在真正 openTab 的那一刻**取 —— 会话面这时才刚被 `selectPanel(null)`
  // 挂起来，"右栏是不是挂在会话上"到这一刻才有意义（没挂上时 active() / isExpanded() 返回的是
  // 缺省值，拿它去还原会把用户本来就展开的右栏折起来）。快照取不到时调用方就不还原。
  const tryOpen = () => {
    const before = codesysAiChatRightColumnSnapshot(sidebarRight)
    try { sidebarRight.openTab(CODESYS_AI_CHAT_WORKBENCH_TAB); return { ok: true, before } }
    catch (error) { lastError = String((error && error.message) || error); return { ok: false, before: null } }
  }
  return await new Promise((resolve) => {
    let settled = false
    let unsubscribe = null
    let timer = null
    // 定时器只在真的存在时才用（浏览器一定有；某些契约/探针的沙箱里没有，那时就不等，直接如实回报）。
    const timerFactory = typeof setTimeout === 'function' ? setTimeout : null
    const clearTimer = typeof clearTimeout === 'function' ? clearTimeout : null
    const finish = (value) => {
      if (settled) return
      settled = true
      try { if (typeof unsubscribe === 'function') unsubscribe() } catch { /* 已释放 */ }
      if (timer && clearTimer) clearTimer(timer)
      resolve(value)
    }
    const finishOpen = (fallbackDetail) => {
      const opened = tryOpen()
      finish(opened.ok
        ? { ok: true, before: opened.before }
        : { ok: false, detail: lastError || fallbackDetail })
    }
    // 订阅必须在 selectPanel **之前**：同步挂载的那一种时序会在 selectPanel 内立刻通知。
    // `settled` 那道闸是必须的：右栏的订阅可能在一次挂载里通知多次，重复 openTab 会让 DSH 抛
    // "already registered"（而且 attempted 计数也会骗人）。
    try { unsubscribe = sidebarRight.mounted?.subscribe?.(() => { if (settled) return; finishOpen('会话面没有在预期时间内挂起来，右栏页签打不开') }) } catch { /* 没有订阅能力就用重试 */ }
    if (timerFactory) timer = timerFactory(() => finishOpen('会话面没有在预期时间内挂起来，右栏页签打不开'), CODESYS_AI_WORKBENCH_MOUNT_TIMEOUT_MS)
    try { layout.selectPanel(null) } catch (error) {
      finish({ ok: false, detail: `layout.selectPanel(null) 抛错：${String((error && error.message) || error)}` })
    }
    // 没有定时器可用时不能挂着一个永不 settle 的 Promise：立刻按当前状态回报一次。
    if (!timerFactory) finishOpen('会话面还没有挂起来，右栏页签打不开')
  })
}

// 兜底投递的那一条消息：source/type 与 main.js:3797（外壳「代码任务」按钮最终走的那一句）
// **逐字相同** —— 同一条通路、同一个接收者（shard 80 的 onDesktopMessage），不另造消息名。
// 浏览器语义：窗口发给自己的消息，`event.source === window`，正是 shard 80 那句判据要的形态。
// 返回 `{ ok, detail }`，**永不抛**（调用方要把两级失败都写进同一条可读原因）。
function codesysAiChatOpenWorkbenchViaCodeTask() {
  try {
    if (typeof window === 'undefined' || typeof window.postMessage !== 'function') {
      return { ok: false, detail: '当前 DSH 文档没有 window.postMessage' }
    }
    window.postMessage({ source: 'taskhive-desktop', type: 'codesys.workbench.open' }, '*')
    return { ok: true, detail: '' }
  } catch (error) {
    return { ok: false, detail: String((error && error.message) || error) }
  }
}

// 安装数据桥。这是 shard 78 的**唯一**职责：注册 prompt/snapshot 两个数据入口 + T175 的
// models/setModel 两个模型入口（T186：`setModel` 同时承担**推理等级**，两者都是会话级写入）
// + T184 的 ensureWorkbench（打开抽屉时确保工作台已绑定工程）
// + T185 的 answer（用户点「提交回答」时把答案交回去）。
// 注意这里刻意不返回 `disposers.push(...)` 给 shard 80 —— T173 踩过"disposers 不在作用域 →
// ReferenceError 被 catch 吞掉 → 入口从未建立"，所以由本函数自己持有 disposer 并原地返回。
function installCodesysAiChat(ctx) {
  if (typeof window === 'undefined') { codesysAiChatNote('install-skipped', 'no-window'); return () => {}; }
  // B 段：左栏 chrome（收起/展开侧边栏）不许把用户从插件面拽回会话面。装在这里是因为 shard 80 的
  // `apply()` 会先调本函数、再装它自己那条"左栏点击兜底"（80:297 在 80:455 之前），所以我们的
  // 捕获监听器一定比那条兜底先跑。返回值由本函数持有（shard 80 的 disposers 在下面这段之前
  // 可能不在作用域 —— T173 踩过，所以这里原地持有，不 push 给别人）。
  const removeSidebarChromeGuard = installSidebarChromeSurfaceGuard();
  // 本轮：「放弃」的消息入口（见上面那一段）。与 chrome 守卫同一个持有方式：disposer 由本函数
  // 原地拿着，不 push 给 shard 80（T173 踩过"不在作用域 → 入口从未建立"）。
  const removeDiscardListener = installCodesysAiChatDiscardListener();
  const bridge = {
    version: CODESYS_AI_BRIDGE_VERSION,
    async snapshot(limit) {
      try { return await codesysAiChatSnapshot(ctx, limit); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('snapshot.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    async prompt(text) {
      try { return await codesysAiChatPrompt(ctx, text); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('prompt.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    async models() {
      try { return await codesysAiChatModels(ctx); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('models.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    // `input` = `{ id, effort? }`（也接受老的裸 id 串）。两个字段都只是**数据**：`id` 是
    // `provider/model` 复合键，`effort` 是模型自己声明过的推理等级 id。等级与模型走**同一条**
    // 会话级写入（见 `codesysAiChatSetModel`），本函数不写工程、不编译、不确认。
    async setModel(input) {
      try { return await codesysAiChatSetModel(ctx, input); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('model.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    // T184：抽屉打开时（真机上由 app/main.js 的 codesys:ai-chat 处理器调用）确保工作台已经绑定
    // 到 CODESYS 面板当前跟随的那个工程。只触发既有绑定流程，不写工程、不编译、不确认。
    async ensureWorkbench() {
      try { return await codesysAiChatEnsureWorkbench(ctx); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('workbench.crashed', detail);
        return { ok: false, bound: false, started: false, reason: 'bridge-crashed', detail };
      }
    },
    // T185：**就地回答**那条待回答的提问。真机上只由 app/main.js 的 `codesys:ai-chat-answer`
    // 处理器调用，而那条通道只有外壳的「提交回答」按钮会触发 —— 所以"没有用户点击"时这里 0 次调用。
    async answer(payload) {
      try { return await codesysAiChatAnswer(ctx, payload); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('answer.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    // A 段：**确认写入工程**（工作台能力面那条写入通路）。真实调用链只有一条：
    //   抽屉消息流里那枚「确认写入工程」按钮的点击 → preload `codesysAiChatApply`
    //   → IPC `codesys:ai-chat-apply`（面板专属门）→ 主进程 → 这里 → 工作台 `apply()`
    //   → **工作台那枚按钮调的同一个 `applyProposal`**（同一条 sha 防护、同一个 `apply-and-build`）。
    // 所以快照轮询 / 定时器 / 自动路径**永远不会**走到这里：没有点击 = 这里 0 次调用。
    async apply(input) {
      try { return await codesysAiChatApply(input); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('apply.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
  };
  window.__TASKHIVE_CODESYS_AI_BRIDGE__ = bridge;
  codesysAiChatNote('installed', `version=${CODESYS_AI_BRIDGE_VERSION} session=${codesysAiChatCurrentSessionId(ctx) || '(none)'}`);
  return () => {
    try { removeSidebarChromeGuard(); } catch { /* 已经摘掉 */ }
    try { removeDiscardListener(); } catch { /* 已经摘掉 */ }
    try { if (window.__TASKHIVE_CODESYS_AI_BRIDGE__ === bridge) delete window.__TASKHIVE_CODESYS_AI_BRIDGE__; }
    catch { /* 删不掉就留着，下一次安装会覆盖 */ }
  };
}
