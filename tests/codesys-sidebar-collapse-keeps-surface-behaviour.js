'use strict'

// T191（B 段）：收起左侧栏**不许**把用户从插件面拽回会话面。
//
// 用户报障（原文）：「插件打开的情况下点击收起左侧栏，插件会不可见（界面上只剩「CODESYS／点击此标签
// 会在中央 Harness 工作区打开插件」这类文字）」。
//
// 真因（这条测试就是把它变成可执行判据）：
//   * `80-codesys-task-and-apply.js` 的 `installNativeNavigationBridge().onClick` 是 document 捕获
//     阶段的一条**兜底**：任何落在左栏（`button.closest('[data-pane="sidebar"],[class*="sidebarCol"]')`）
//     且不是"设置 / 会话 / 工作区"行上的点击，最后都会 `openSurface('chat')`；
//   * 左栏的"收起侧边栏 / 展开侧边栏"按钮就在那一列里（DSH `dsh-client-ui-layout` 的 `*_sidebarCol`），
//     于是它也被这条兜底当成导航 —— `openSurface('chat')` → IPC `surface:open`='chat' →
//     主进程 `hidePluginSurface()` → **原生插件面被摘下来**（`main.js`），露出主面板里那句占位文字；
//   * 点插件入口不会这样，是因为随后 DSH 会把主面板挂载、`activating()` 的 effect 再 `openSurface('codesys')`
//     把面要回来；收起按钮**不挂载任何主面板**，所以那一条 'chat' 之后再没有人把面要回来。
//
// 这条契约驱动**真实源码**（shipped bundle 里的 78 + 80 两个安装函数），不是副本：先装 shard 78 的
// 左栏 chrome 守卫，再装 shard 80 的那条兜底（与 `apply()` 里的真实顺序一致：80:297 在 80:455 之前），
// 然后按真实事件顺序派发点击（window 捕获 → document 捕获），断言：
//   ① 收起/展开侧边栏的点击**不会**发出 `surface.open chat`，插件面仍是当前 surface；
//   ② 会话行的点击照旧发 `chat`（真正的导航一字不改）；
//   ③ 当前 surface 是 chat 时那次点击照旧发（没有插件面要保护，也就不做多余的事）；
//   ④ 守卫只在**这一次点击**的派发窗口里生效：下一次独立点击照旧是导航。

const assert = require('node:assert')
const path = require('node:path')
const { createScene, createTaskhiveStub } = require('./lib/mini-dom')
const { loadPluginClient, loadRendererScript } = require('./lib/load-source')

const clientFile = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js')
const rendererFile = path.join(__dirname, '..', 'app', 'renderer', 'renderer.js')

const SIDEBAR_SELECTOR = '[data-pane="sidebar"],[class*="sidebarCol"]'
const BUTTON_SELECTOR = 'button,a,[role="button"],[role="treeitem"],[data-session-id],[data-workspace-id]'
// shard 78 的守卫用的是它自己那一串（它只关心"这是不是一个按钮"）。
const GUARD_BUTTON_SELECTOR = 'button,[role="button"],[role="tab"]'

// 一个"点击落在哪个节点上"的替身：`closest()` 按**逐字选择器**回答，正是真实代码问的那几串。
// mini-dom 的 StubNode.closest() 恒为 null，所以真实浏览器会给的节点必须由场景自己提供。
function clickTarget ({ label = '', innerText = '', inSidebar = true, sessionRow = false, treeItem = false }) {
  const sidebarColumn = { id: 'sidebar-column' }
  const button = {
    innerText,
    getAttribute: (name) => (name === 'aria-label' ? label : null),
    matches: (selector) => (sessionRow ? selector === '[role="treeitem"],[data-session-id],[data-workspace-id],[aria-current="page"],[aria-current="true"]' : treeItem),
    closest: (selector) => {
      if (selector === SIDEBAR_SELECTOR) return inSidebar ? sidebarColumn : null
      if (selector === '[data-taskhive-sidebar-plugins]') return null
      if (selector === '[role="dialog"][aria-modal="true"]') return null
      if (selector === '[data-session-id],[data-workspace-id]') return sessionRow ? sidebarColumn : null
      return null
    },
  }
  return { target: { closest: (selector) => ((selector === BUTTON_SELECTOR || selector === GUARD_BUTTON_SELECTOR) ? button : null) }, button }
}

function postedSurfaceOpens (scene) {
  return scene.posted
    .filter((entry) => entry.channel === 'parent' && entry.message?.source === 'taskhive-dsh' && entry.message?.type === 'surface.open')
    .map((entry) => entry.message.surface)
}

function createHarness (activeSurface) {
  const scene = createScene({ viewport: { width: 1200, height: 800 } })
  scene.window.__TASKHIVE_ACTIVE_SURFACE__ = activeSurface
  const loaded = loadPluginClient(clientFile, {
    scene,
    exports: ['installSidebarChromeSurfaceGuard', 'installNativeNavigationBridge'],
  })
  assert.strictEqual(typeof loaded.api.installSidebarChromeSurfaceGuard, 'function',
    'shard 78 必须导出左栏 chrome 守卫（本轮 B 段的修法）')
  assert.strictEqual(typeof loaded.api.installNativeNavigationBridge, 'function',
    'shard 80 的左栏兜底必须还在（守卫是**对着它**设计的，不是替代它）')
  // 真实安装顺序：78（80:297 调 installCodesysAiChat → 装守卫）在 80 的兜底（80:455）之前。
  const disposeGuard = loaded.api.installSidebarChromeSurfaceGuard()
  loaded.api.installNativeNavigationBridge()
  return { scene, disposeGuard }
}

// 真实事件顺序：window 捕获阶段（守卫）先跑，然后 document 捕获阶段（shard 80 的兜底）。
function click (scene, target) {
  scene.fire('window', 'click', { target })
  scene.fire('document', 'click', { target })
}

// ── ⑦ DOM / 几何证据：收起左栏之后的几何照旧落在插件容器上，容器没有被藏起来 ───────────────────
//
// 「插件不可见」的可执行形态有两种，这一条钉的是**界面侧**那一种：中央那个原生 WebContentsView 宿主
// （外壳 renderer 的 `#plugin-overlay`）必须仍在、而且几何非零。T191 之前它会被 `surface.open chat`
// 那条消息触发 `renderChat()` → `pluginOverlay.hidden = true`；这里把两种形态都跑一遍：
//   * 收到**收起左栏**时发布的几何 → 容器拿到非零的 left/width/height（没有被塌成 0）；
//   * 收到 `surface.open chat`（旧行为那一条）→ 容器被藏起来（这就是"插件不可见"）。
// 于是"插件为什么还在"这件事是可证否的：不是容器不会藏，而是那条消息不再被发出来（① 已钉）。
async function domGeometryChecks () {
  const scene = createScene({
    viewport: { width: 1200, height: 800 },
    nodes: {
      '#surface': {}, '#activity': {}, '#plugin-overlay': {}, '#plugin-content': {},
      '#left-plugin-nav': {}, '#right-plugin-nav': {}, '#harness-state': {},
    },
    taskhive: createTaskhiveStub({ harnessStatus: async () => ({ runtime: { state: 'ready' } }), listPlugins: async () => [], harnessUrl: async () => null }),
  })
  const loaded = loadRendererScript(rendererFile, {
    scene,
    exports: ['ensureShell', 'applyWorkspaceGeometry', 'renderChat', 'state'],
  })
  const flush = async () => { for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve)) }
  await loaded.api.ensureShell()
  await flush()
  const overlay = scene.node('#plugin-overlay')
  assert(overlay, 'mini-DOM 场景必须声明 #plugin-overlay（中央插件视图的宿主）')
  // 模拟"插件面正开着"：真实路径是 `showPluginSurface()` 末尾那句 `pluginOverlay.hidden = false`
  // （renderer.js）。这里直接摆好前提，再只喂"收起左栏之后 DSH 发布的那一份几何"。
  overlay.hidden = false
  const collapsed = { left: 46, top: 0, width: 1154, height: 800, rightBoundary: 1164, rightSidebarReserve: 36, rightSidebarCollapsed: true }
  scene.window.dispatchEvent({ type: 'message', data: { source: 'taskhive-dsh', type: 'surface.geometry', geometry: collapsed } })
  await flush()
  const style = overlay.style
  assert.strictEqual(style.left, '46px', '收起左栏后的几何必须原样落到插件容器上（left）')
  assert.strictEqual(style.width, '1154px', '收起左栏后的几何必须原样落到插件容器上（width，非零 = 没塌）')
  assert.strictEqual(style.height, '800px', '高度必须非零（"塌成 0 高"这条故障形态在这里被证否）')
  assert.strictEqual(overlay.hidden, false, '几何消息本身**不会**藏起插件容器（藏它的只有 renderChat()）')
  console.log(`[自测④] 收起左栏后的几何 → #plugin-overlay inline style: left=${style.left} top=${style.top} width=${style.width} height=${style.height} · hidden=${overlay.hidden} · 容器仍在、几何非零（由插件容器承载）`)
  // 对照：旧行为收到的那一条消息确实会把容器藏起来（所以修的是"不再发那一条"）。
  await loaded.api.renderChat()
  await flush()
  assert.strictEqual(overlay.hidden, true, '对照：surface.open chat → renderChat() 必须真的把插件容器藏起来（否则上面那条断言是空的）')
  console.log(`[自测④b] 对照（旧行为）：surface.open chat → renderChat() → #plugin-overlay hidden=${overlay.hidden}（这就是用户看到的"插件不可见"）`)
}

function main () {
  // ── ① 收起侧边栏：插件面必须留下（不发出 surface.open chat）────────────────────────────────
  {
    const { scene } = createHarness('codesys')
    const { target } = clickTarget({ label: '收起侧边栏' })
    click(scene, target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), [],
      '点「收起侧边栏」不许发出任何 surface.open —— 那一条 chat 会让宿主摘下原生插件面（用户报的"插件不可见"）')
    assert.strictEqual(scene.window.__TASKHIVE_ACTIVE_SURFACE__, 'codesys',
      '当前 surface 必须还是插件面（插件视图没有被要求切走）')
    assert.strictEqual(scene.window.__TASKHIVE_SIDEBAR_CHROME_GUARD__.swallowed, 1,
      '被吞掉的正是那一条 chat（计数是这一点的证据，而不是"什么都没发生"）')
    // 展开同理（同一个控件，label 换成"展开侧边栏"）。
    const expanded = clickTarget({ label: '展开侧边栏' })
    click(scene, expanded.target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), [], '点「展开侧边栏」同样不许发出 surface.open')
  }

  // ── ② 会话行：真正的导航一字不改（照旧切到会话面）─────────────────────────────────────────
  {
    const { scene } = createHarness('codesys')
    const { target } = clickTarget({ label: '会话 2026-10-04', sessionRow: true })
    click(scene, target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), ['chat'],
      '点会话行必须照旧把用户带到会话面（守卫不许把真正的导航也吞掉）')
    assert.strictEqual(scene.window.__TASKHIVE_ACTIVE_SURFACE__, 'chat', 'surface 跟着导航走')
  }

  // ── ③ 当前已经在会话面：这次点击不做任何多余的事（没有插件面要保护）────────────────────────
  {
    const { scene } = createHarness('chat')
    const { target } = clickTarget({ label: '收起侧边栏' })
    click(scene, target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), ['chat'], '已经在会话面时，兜底那条 chat 照旧走（无副作用）')
    assert.strictEqual(scene.window.__TASKHIVE_SIDEBAR_CHROME_GUARD__.swallowed, 0, '没有插件面时不该记"吞掉过"')
  }

  // ── ④ 别的插件面（浏览器 / 知识库按 DSH 自渲染处理，这里用 web-ai 代表原生面）也受保护 ────────
  {
    const { scene } = createHarness('web-ai')
    const { target } = clickTarget({ label: '收起侧边栏' })
    click(scene, target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), [], '任何原生插件面都不该被"收起左栏"这一下切走')
    assert.strictEqual(scene.window.__TASKHIVE_ACTIVE_SURFACE__, 'web-ai')
  }

  // ── ⑤ 守卫只覆盖这一次点击的派发窗口：之后独立的导航点击照旧 ────────────────────────────────
  {
    const { scene } = createHarness('codesys')
    const collapse = clickTarget({ label: '收起侧边栏' })
    click(scene, collapse.target)
    scene.flushTimers()   // 派发窗口结束（`setTimeout(..., 0)` 摘除守卫）
    const session = clickTarget({ label: '会话 2026-10-04', sessionRow: true })
    click(scene, session.target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), ['chat'],
      '收起左栏之后，用户点会话行仍然要能回到会话面（守卫不是"禁止切到 chat"）')
  }

  // ── ⑥ 卸载守卫后行为回到原样（不留下持久副作用）────────────────────────────────────────────
  {
    const { scene, disposeGuard } = createHarness('codesys')
    disposeGuard()
    const { target } = clickTarget({ label: '收起侧边栏' })
    click(scene, target)
    assert.deepStrictEqual(postedSurfaceOpens(scene), ['chat'], '摘下守卫之后，兜底那条 chat 照旧发出（证明吞掉的确实是守卫做的）')
  }

  console.log('codesys sidebar collapse keeps surface behaviour passed')

  return domGeometryChecks().then(() => {
    console.log('codesys sidebar collapse dom/geometry evidence passed')
  })
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
