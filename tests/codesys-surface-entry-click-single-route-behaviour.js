'use strict'

// T197：**一次**左栏插件入口点击只许发出**一条** `surface.open`。
//
// 用户可观察后果（真机原文，`C:\TaskHive\resources\app\logs\desktop.log`）：
//   2026-10-05T04:36:32.329Z plugin.surface.shown  {"pluginSurfaceKind":"codesys","trigger":"surface:open:codesys"}
//   2026-10-05T04:36:32.339Z plugin.surface.hidden {"pluginSurfaceKind":"codesys","trigger":"surface:open:chat"}
// 10 ms 的间隔就是"同一次点击被两条 document 捕获监听器各路由了一遍"：`onSurfaceEntryClick`
// （80-*.js，先注册）按入口标题认出这是插件入口 → `openSurface('codesys')`；随后
// `installNativeNavigationBridge().onClick`（80-*.js，后注册）那条"左栏点击兜底"又把它当成
// 未识别的导航 → `openSurface('chat')` → 主进程 `hidePluginSurface()` 把刚挂上的原生插件面摘掉。
// 托管着 CODESYS 原生窗口时，这一对就是原生审计里的 `resumed`→`suspended` —— 真机实测
// 0.71–0.74 s（`logs/codesys-native-host-audit.jsonl` 2026-10-04T17:23:13 / 17:30:22 / 17:31:38，
// 三条 824 / 710 / 743 ms），而 DSH 随后又把面板重新激活，于是用户看到面板闪一下。
//
// 修法（在**正确的那一层**：把兜底收紧到"真的是导航意图"，而不是在托管层去抖）：
// `onSurfaceEntryClick` 在同一个事件对象上留 `__taskhiveSurfaceEntryId`，兜底认出这个标记就
// 不再重复路由。这条契约驱动**真实源码**（shipped 分片里的 `apply`），按真实事件顺序
// （document 捕获、按注册顺序）派发点击，断言：
//   ① 插件入口点击 → 只发出它自己那一条（`codesys`），不再补一条 `chat`；
//   ② 会话行点击 → 照旧发 `chat`（真正的导航一字不改）；
//   ③ 左栏其它按钮 → 照旧走兜底（兜底语义没有被整体删掉）；
//   ④ 第二个插件入口（知识库）→ 只发出 `knowledge`（不是只对 codesys 特判）。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const shardFile = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'src', '80-codesys-task-and-apply.js')
const source = fs.readFileSync(shardFile, 'utf8')

// `installNativeNavigationBridge` 定义在 `apply` **之前**（同一个模块工厂作用域），
// `onSurfaceEntryClick` 定义在 `apply` **里面** —— 两个都要，才能测它们的先后关系。
const sliceFrom = source.indexOf('    function installNativeNavigationBridge()')
const sliceTo = source.indexOf('    module.exports.apply')
assert(sliceFrom >= 0 && sliceTo > sliceFrom, 'shard 80 必须仍然同时含 installNativeNavigationBridge 与 apply')
const fragment = source.slice(sliceFrom, sliceTo)

const BUTTON_SELECTOR_FALLBACK = 'button,a,[role="button"],[role="treeitem"],[data-session-id],[data-workspace-id]'
const BUTTON_SELECTOR_ENTRY = 'button,[role="button"],[role="tab"]'
const SESSION_ROW_SELECTOR = '[role="treeitem"],[data-session-id],[data-workspace-id],[aria-current="page"],[aria-current="true"]'
const SIDEBAR_SELECTOR = '[data-pane="sidebar"],[class*="sidebarCol"]'

// 一个"点击落在哪个节点上"的替身：`closest()` 按**逐字选择器**回答真实代码问的那几串
// （mini-dom 的 StubNode.closest() 恒为 null，所以真实浏览器会给的节点必须自己提供）。
function clickButton ({ label, inSidebar = true, sessionRow = false }) {
  return {
    textContent: label,
    innerText: label,
    getAttribute: () => null,
    matches: (selector) => (sessionRow ? selector === SESSION_ROW_SELECTOR : false),
    closest: (selector) => {
      // shard 80 的 LeftSurfaceActions 定义还在但**不再挂载**（80:301-306），所以真机 DOM 里
      // 没有这个属性 —— 兜底那条早退对插件入口不成立，这正是 T197 成立的前提。
      if (selector === '[data-taskhive-sidebar-plugins]') return null
      if (selector === '[role="dialog"][aria-modal="true"]') return null
      if (selector === '[data-session-id],[data-workspace-id]') return sessionRow ? { id: 'sidebar-column' } : null
      if (selector === SIDEBAR_SELECTOR) return inSidebar ? { id: 'sidebar-column' } : null
      return null
    },
  }
}

function dispatchOneClick (target) {
  const surfaces = []
  const docClickHandlers = []
  const noop = () => {}
  const context = {
    window: { addEventListener: noop, removeEventListener: noop },
    document: {
      body: {},
      // 只记 document 捕获阶段的 click —— 真实机器上两条路由都注册在这里（80:229 / 80:455）。
      addEventListener: (name, fn, capture) => { if (name === 'click' && capture === true) docClickHandlers.push(fn) },
      removeEventListener: noop,
      querySelectorAll: () => [],
    },
    MutationObserver: class { observe () {} disconnect () {} },
    React: { useEffect: noop },
    h: (type, props) => ({ type, props }),
    entries: [
      { id: 'codesys', tabId: 'taskhive:codesys', title: 'CODESYS', placement: 'right' },
      { id: 'knowledge', tabId: 'taskhive:knowledge', title: '知识库', placement: 'right' },
    ],
    installTaskHiveSkin: noop,
    openSurface: (id) => surfaces.push(id),
    surfaceView: () => noop,
    surfaceIcon: noop,
    KnowledgeView: noop,
    CodesysWorkbenchBoundary: noop, SessionRecordsPanel: noop, DirectorySettingsItem: noop,
    ModelCatalogSection: noop, PluginInventoryTab: noop, LeftSurfaceActions: noop,
    installWorkspaceGeometryBridge: () => noop,
    installCodesysTaskBridge: () => noop,
    installWebLoginCardBridge: () => noop,
    installNativeModelMerge: () => true,
    installCodesysAiChat: () => noop,
    console,
  }
  vm.createContext(context)
  vm.runInContext(`${fragment}; globalThis.apply = apply`, context)
  context.apply({
    slots: { inject: (_name, callback) => callback(), register: noop },
    layout: { selectPanel: noop },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => noop } },
    sidebarRightTabs: { register: () => noop },
    sidebarRight: { openTab: noop, mounted: { getSnapshot: () => '', subscribe: () => noop } },
    effect: () => noop,
  })
  assert.equal(docClickHandlers.length, 2,
    'shard 80 必须仍然在 document 捕获阶段注册**两条** click 监听器（入口认领 + 左栏兜底）；少一条说明路由结构变了')
  // 按注册顺序逐个调用 —— 这正是真实浏览器对"同一节点同一阶段"的语义，也是这两条的顺序。
  const event = { target: { closest: (selector) => ((selector === BUTTON_SELECTOR_FALLBACK || selector === BUTTON_SELECTOR_ENTRY) ? target : null) } }
  for (const handler of docClickHandlers) handler(event)
  return { surfaces, marker: event.__taskhiveSurfaceEntryId ?? null }
}

// ① 插件入口：只开自己那一个面（真机 :329→:339 那一对）
{
  const { surfaces, marker } = dispatchOneClick(clickButton({ label: 'CODESYS' }))
  assert.deepEqual(surfaces, ['codesys'],
    '点左栏 CODESYS 入口只许发出 surface.open codesys —— 多出来的那一条 chat 会让主进程摘掉刚挂上的原生插件面（原生审计里就是 0.71–0.74 s 的 resume→suspend 抖动）')
  assert.equal(marker, 'codesys', '入口点击必须在同一个事件对象上留下认领标记（兜底据此跳过）')
}

// ② 会话行：真正的导航一字不改
{
  const { surfaces } = dispatchOneClick(clickButton({ label: '会话 2026-10-04', sessionRow: true }))
  assert.deepEqual(surfaces, ['chat'], '点会话行必须照旧把用户带到会话面（收紧兜底不许把真正的导航也吞掉）')
}

// ③ 左栏其它按钮：兜底语义没有被整体删掉
{
  const { surfaces, marker } = dispatchOneClick(clickButton({ label: '刷新' }))
  assert.deepEqual(surfaces, ['chat'], '左栏里未被认领的按钮照旧走兜底（修的是"同一次点击重复路由"，不是删除兜底）')
  assert.equal(marker, null, '没有被入口认领的点击不该留下标记')
}

// ④ 第二个插件入口：不是只对 codesys 特判
{
  const { surfaces, marker } = dispatchOneClick(clickButton({ label: '知识库' }))
  assert.deepEqual(surfaces, ['knowledge'], '第二个插件入口同样只许开自己那一个面')
  assert.equal(marker, 'knowledge', '认领标记带的是入口 id（不是写死的 codesys）')
}

// ⑤ 源码锚点：两处接线必须在场（行为断言之外的静态冗余，位置漂移时给出可读失败）
assert(source.includes('if (event.__taskhiveSurfaceEntryId) return'),
  '左栏兜底必须仍然包含 T197 的认领标记早退')
assert(source.includes('event.__taskhiveSurfaceEntryId = entry.id'),
  'onSurfaceEntryClick 必须仍然在打开 surface 之前留下认领标记')

console.log('codesys surface entry click single route: 入口点击只发一条 surface.open，会话行/其它按钮/第二入口照旧')
