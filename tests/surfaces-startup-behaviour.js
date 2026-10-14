'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../plugins/installed/taskhive-surfaces/dsh/src/80-codesys-task-and-apply.js'), 'utf8');
const applySource = source.slice(source.indexOf('    function apply(ctx)'), source.indexOf('    module.exports.apply'));
const selected = [];
const registered = [];
const tabTypes = [];
const openedTabs = [];
const surfaces = [];
let mountedSession = 'session-a';
let rightbarChanged;
let tabTypeRemoved = false;
let rightbarUnsubscribed = false;
const handlers = {};
let disposed;
let sessionsChanged;
const window = { addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener: (name) => { delete handlers[name]; } };
// 分片在 apply 期间会登记一个文档级捕获 click 监听（用于会话行「…」菜单定位）。
// 测试上下文必须提供 document，否则失败原因是 ReferenceError 而不是被测行为。
const document = { addEventListener: () => {}, removeEventListener: () => {} };
const noop = () => {};
// T197：本测试只把 shard 80 单独放进 vm，而 `apply()` 会调用 **shard 78** 定义的
// `installCodesysAiChat`（生产里两片被 tools/build-client-bundle.js 拼进同一个模块作用域，
// 函数声明提升，所以它一定在作用域里）。这里缺桩时抛的是 ReferenceError，被 shard 80 的
// `catch` 吞掉后只打印一行 `[taskhive] installCodesysAiChat 失败 installCodesysAiChat is not
// defined` —— 契约仍然 PASS，但输出读起来像生产故障。补桩 + 断言不再出现那一行，
// 让这条自测测的是"注册路径"，而不是 vm 缺件。
const consoleProblems = [];
const recordingConsole = {
  ...console,
  error: (...args) => consoleProblems.push(args.map((value) => String(value)).join(' ')),
  warn: (...args) => consoleProblems.push(args.map((value) => String(value)).join(' ')),
};
const context = {
  window, document, React: { useEffect: noop }, h: (type, props) => ({ type, props }),
  entries: [{ id: 'codesys', tabId: 'taskhive:codesys', title: 'CODESYS', placement: 'right' }],
  installTaskHiveSkin: noop, openSurface: (id) => surfaces.push(id), surfaceView: () => noop, surfaceIcon: noop,
  CodesysWorkbenchBoundary: noop, SessionRecordsPanel: noop, DirectorySettingsItem: noop,
  ModelCatalogSection: noop, PluginInventoryTab: noop, LeftSurfaceActions: noop,
  installWorkspaceGeometryBridge: () => noop, installNativeNavigationBridge: () => noop,
  installCodesysTaskBridge: () => noop, installWebLoginCardBridge: () => noop,
  // 本分片（80-*）的 apply 会调用 79-* 定义的模型并入；单独加载某个分片时它不在作用域里，
  // 必须给桩。返回 true = 并入成功（生产路径），返回 false 会额外注册一个独立标签。
  installNativeModelMerge: () => true,
  // 同一个理由：`installCodesysAiChat` 由 shard 78 定义（生产里在同一作用域）。
  installCodesysAiChat: () => noop,
  console: recordingConsole,
};
vm.createContext(context);
vm.runInContext(`${applySource}; globalThis.apply = apply`, context);
context.apply({
  slots: { inject: (_name, callback) => callback(), register: (descriptor, component) => { registered.push({ ...descriptor, component }); } },
  layout: { selectPanel: (id) => { selected.push(id); } },
  sessions: { list: { getSnapshot: () => ({ byId: { 'session-a': { id: 'session-a', retainedBy: { mainView: 1 } } } }), subscribe: (callback) => { sessionsChanged = callback; return noop; } } },
  sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => { tabTypeRemoved = true; }; } },
  sidebarRight: {
    openTab: (kind) => openedTabs.push(kind),
    mounted: { getSnapshot: () => mountedSession, subscribe: (callback) => { rightbarChanged = callback; return () => { rightbarUnsubscribed = true; }; } },
  },
  effect: (callback) => { disposed = callback(); },
});
assert.equal(window.__TASKHIVE_SURFACES_REGISTERED__, true);
assert.deepEqual(consoleProblems.filter((line) => /installCodesysAiChat/.test(line)), [],
  'shard 80 不许在启动路径上抛出/吞掉 installCodesysAiChat 的 ReferenceError（vm 缺桩已补齐）');
const workbenchBody = registered.find(entry => entry.name === 'sidebar.right.pane.tab' && entry.key === 'taskhive:codesys-workbench');
assert(workbenchBody, 'code workbench must occupy the native rightbar');
assert(!registered.some(entry => entry.name === 'main' && entry.key === 'taskhive:codesys-workbench'));
assert(!registered.some(entry => entry.name === 'sidebar.panellist' && entry.id === 'taskhive:codesys-workbench'));
assert.equal(tabTypes[0].kind, 'taskhive:codesys-workbench');
assert.equal(tabTypes[0].keepMounted, true, 'tab changes must preserve editor drafts');
const owner = workbenchBody.inject('session-b');
const rendered = workbenchBody.component({ ...owner, useTabInfo: () => ({ tab: { visible: false } }) });
assert.equal(rendered.props.ownerSessionId, 'session-b', 'background tabs must keep their owning session');
assert.equal(rendered.props.tabVisible, false);
assert.doesNotThrow(() => sessionsChanged());
handlers.message({ source: window, data: { source: 'taskhive-desktop', type: 'codesys.workbench.open' } });
assert.deepEqual(selected, [null], 'desktop navigation must keep Conversation in the center');
assert.deepEqual(surfaces, ['chat'], 'desktop plugin overlay must release the conversation');
assert.deepEqual(openedTabs, ['taskhive:codesys-workbench']);
mountedSession = 'session-b';
handlers.message({ source: window, data: { source: 'taskhive-desktop', type: 'codesys.workbench.open' } });
assert.equal(openedTabs.length, 1, 'do not open against a stale session binding');
mountedSession = 'session-a';
rightbarChanged();
assert.equal(openedTabs.length, 2, 'pending open resumes after the owning session mounts');
assert.doesNotThrow(() => disposed());
assert.equal(window.__TASKHIVE_SURFACES_REGISTERED__, false);
assert.equal(handlers.message, undefined);
assert.equal(tabTypeRemoved, true);
assert.equal(rightbarUnsubscribed, true);
// 意图：**注册失败时 apply 必须抛出，且不得报告 ready**。
// 注意 partial ctx 必须把右栏路径上会先被触碰的服务也备齐（`sidebarRightTabs`），
// 否则先抛的是 TypeError，测的就不是"注册失败"这条路了。
assert.throws(() => context.apply({
  slots: { inject: () => { throw new Error('registration failed'); }, register: () => {} },
  sidebarRightTabs: { register: () => noop },
}), /registration failed/);
assert.equal(window.__TASKHIVE_SURFACES_REGISTERED__, false, 'failed initialization must not report ready');
console.log('surfaces startup: rightbar registration, session ownership, queued desktop navigation and disposal passed');
