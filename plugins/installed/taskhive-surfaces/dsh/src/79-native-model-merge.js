// 82-native-model-merge.js — T130：把自建「模型启用」并入原生「模型」设置页
//
// 用户要求（原话）：「删除设置里面的模型启用，统一到原生设置模型，自己添加好配置，
// 如果不能配置请求我」。
//
// 实测事实（2026-10-02，CDP）：
//   · 原生 `模型` 页 = `@deepseek-ai/dsh-client-ui-settings-models` 注册的
//     `settings.section`（该包 lib/client.js:4059）。它**没有**给外部留扩展插槽，
//     所以「并入」只能靠在它的面板里挂载我们的 UI。
//   · 原生页当前列出 1 个提供商（deepseek，带 编辑/删除）+「添加模型提供商」，
//     即清单里 T049 那条「原生页一个提供方都不列」的历史结论**已经过期**。
//   · 自建页还额外提供：模型勾选启用（决定哪些进输入框目录）、CLI/本地/网页模型、
//     凭据保存 —— 原生页**不能**替代，因此不能只删不并。
//
// 做法：`require('react-dom/client').createRoot` 把 `ModelCatalogSection`
// （shard 60 定义，无 props、自包含）挂进原生面板末尾。
// 兜底：宿主不暴露 react-dom/client 或找不到面板时**返回 false**，由调用方保留原
// `settings.section` 标签 —— 宁可有第二个入口，也不能让用户失去配置模型的能力。
function installNativeModelMerge() {
  // 宿主对不同构建暴露的 React DOM 入口不同，逐个探测。
  let createRoot = null
  let legacyRender = null
  const probe = (name) => {
    try {
      const mod = require(name)
      return mod && typeof mod === 'object' ? mod : null
    } catch { return null }
  }
  for (const name of ['react-dom/client', 'react-dom']) {
    const mod = probe(name)
    if (!mod) continue
    if (!createRoot && typeof mod.createRoot === 'function') createRoot = mod.createRoot
    if (!legacyRender && typeof mod.render === 'function') legacyRender = mod.render
  }
  const canMount = typeof createRoot === 'function' || typeof legacyRender === 'function'
  if (!canMount) return false

  // 原生模型页的识别文本（来自其自身的说明文案）。
  const PANE_HINT = '填入各提供商的 API 密钥即可使用其模型'
  let container = null
  let root = null
  let scheduled = false
  let lastSync = 0

  const teardown = () => {
    try { if (root) root.unmount() } catch { /* 已卸载 */ }
    root = null
    if (container) { container.remove(); container = null }
  }

  // 找「包含原生说明文案、且尺寸最大」的那个容器：即原生模型面板本体。
  const findPane = () => {
    let best = null
    for (const node of document.querySelectorAll('section,[role="tabpanel"],article,div')) {
      const text = String(node.textContent || '')
      if (!text.includes(PANE_HINT)) continue
      const rect = node.getBoundingClientRect()
      if (rect.width < 320 || rect.height < 160) continue
      const area = rect.width * rect.height
      if (!best || area < best.area) best = { node, area }
    }
    return best ? best.node : null
  }

  const sync = () => {
    // T153：**先看容器**再决定是否扫全文档。原实现每次调度（上限约 3.3 次/秒）都先跑
    // `findPane()`：遍历文档里所有 section/tabpanel/article/div，对每个候选构造完整
    // `textContent` 并调用 `getBoundingClientRect()`（强制布局）。绝大多数调度发生时
    // 面板根本没变、容器还挂着 —— 这种情况下直接返回，不扫。
    if (container && container.isConnected && container.parentElement) return
    const pane = findPane()
    if (!pane) { if (container) teardown(); return }
    if (container && container.isConnected && container.parentElement === pane) return
    teardown()
    container = document.createElement('div')
    container.setAttribute('data-taskhive-model-catalog', 'merged')
    container.style.cssText = 'margin-top:18px;padding-top:14px;border-top:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.28))'
    pane.append(container)
    try {
      if (typeof createRoot === 'function') {
        root = createRoot(container)
        root.render(React.createElement(ModelCatalogSection))
      } else {
        // React 17 及以前的 legacy 入口：返回布尔，没有 unmount 方法。
        legacyRender(React.createElement(ModelCatalogSection), container)
        root = { unmount: () => { try { legacyRender(null, container) } catch { /* 容器已移除 */ } } }
      }
    } catch {
      teardown()
    }
  }

  // 面板随时可能被 React 重建，所以用观察器 + 节流同步；点击（切换设置标签）后补几次。
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      const now = Date.now()
      if (now - lastSync < 300) return
      lastSync = now
      try { sync() } catch { /* 同步失败不影响原生页 */ }
    }, 250)
  }
  // T157：**先卸掉上一次的观察器与监听**。本函数由插件 apply 调用，DSH 客户端热更新（HMR）
  // 会重新执行它 —— 旧实现每次都 new 一个 MutationObserver + 一个 document 捕获 click 监听
  // 且从不释放，重载几次就叠加几份全文档调度。返回契约不变（成功 true / 失败 false）。
  if (typeof installNativeModelMerge.__dispose === 'function') {
    try { installNativeModelMerge.__dispose() } catch { /* 上一次已失效 */ }
  }
  let observer = null
  const onClick = () => { schedule(); setTimeout(schedule, 900) }
  try {
    observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
  } catch { return false }
  document.addEventListener('click', onClick, true)
  installNativeModelMerge.__dispose = () => {
    try { if (observer) observer.disconnect() } catch { /* 已断开 */ }
    document.removeEventListener('click', onClick, true)
  }
  schedule()
  return true
}
