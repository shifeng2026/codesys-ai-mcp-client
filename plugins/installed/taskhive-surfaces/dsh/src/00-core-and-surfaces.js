// Browser half of the TaskHive integration. It registers real Better Sidebar
// tabs and routes each capability into the same desktop central workspace.
window.__ModuleLoader__.load({
  id: 'taskhive-surfaces',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    // DSH service getters throw while a slot is being restored or while its
    // context is inactive. Plugin panels are allowed to render during that
    // window, so read optional services without turning a transient state into
    // a React render failure.
    function getOptionalService(ctx, name) {
      try { return ctx?.[name] || null } catch { return null }
    }
    const params = new URL(location.href).searchParams
    // DSH alpha.2 removes auth and host query parameters after its initial
    // navigation. The Electron bridge retains the host-owned workbench URL.
    let workspacePathResolution = null
    const resolveHarnessWorkspacePath = async () => {
      const direct = String(params.get('taskhiveWorkspace') || '').trim()
      if (direct) return direct
      if (!workspacePathResolution) {
        workspacePathResolution = Promise.resolve(window.taskhive?.harnessUrl?.())
          .then((url) => String(new URL(String(url || ''), location.href).searchParams.get('taskhiveWorkspace') || '').trim())
          .catch(() => '')
      }
      return workspacePathResolution
    }
    // The TaskHive workbench skin needs the host-owned brand icon. Alpha.2
    // strips `taskhiveIcon` during URL normalization just like the workspace
    // path, so recover it from the bridge with the same fallback contract.
    let taskhiveBrandIcon = String(params.get('taskhiveIcon') || '')
    const resolveTaskhiveBrandIcon = async () => {
      if (taskhiveBrandIcon) return taskhiveBrandIcon
      try {
        const url = await window.taskhive?.harnessUrl?.()
        taskhiveBrandIcon = String(new URL(String(url || ''), location.href).searchParams.get('taskhiveIcon') || '')
      } catch { /* the bridge is unavailable in a plain browser preview */ }
      return taskhiveBrandIcon
    }
    const configuredSurfaces = new Set((params.get('taskhiveEnabledSurfaces') || 'codesys,web-ai,knowledge,settings').split(',').filter(Boolean))
    const fallbackDescriptors = [
      // Keep these aligned with plugins/catalog.json. Alpha.2 strips the host
      // query after authentication, so a first launch may need this fallback.
      // T102/T104：名字要和 plugins/catalog.json 一致 —— 这里漏改过一次，
      // 结果是"宿主参数被剥离的首启动"仍然显示旧名字。
      { id: 'codesys', pluginId: 'codesys-monitor', title: 'CODESYS', placement: 'left', kind: 'surface', visible: true },
      { id: 'web-ai', pluginId: 'web-ai', title: '浏览器', placement: 'left', kind: 'surface', visible: true },
      { id: 'knowledge', pluginId: 'knowledge-base', title: '知识库', placement: 'left', kind: 'surface', visible: true },
    ]
    let descriptors = fallbackDescriptors
    try {
      const parsed = JSON.parse(params.get('taskhiveSurfaceDescriptors') || '[]')
      if (Array.isArray(parsed) && parsed.length) descriptors = parsed
    } catch {}
    // DSH alpha.2 can preserve the enabled-surface list while eliding one or
    // more host descriptors during its authenticated URL normalization. Keep
    // every enabled built-in surface reachable instead of silently dropping it.
    for (const fallback of fallbackDescriptors) {
      if (configuredSurfaces.has(fallback.id) && !descriptors.some((item) => item?.id === fallback.id)) descriptors.push(fallback)
    }
    let entries = descriptors
      .filter((item) => configuredSurfaces.has(item.id) && item.visible !== false && item.kind !== 'tool/service-only' && item.kind !== 'settings-only')
      .map((item, index) => ({ ...item, title: item.id === 'codesys' ? 'CODESYS' : item.title, tabId: `taskhive:${item.id}`, order: 10 + index }))
    window.__TASKHIVE_SURFACE_IDS__ = []
    window.__TASKHIVE_SURFACE_DESCRIPTORS__ = entries

    // Single bilingual source of truth for the right-rail collapsed state. The
    // geometry bridge previously matched Chinese only, so on an English DSH UI
    // `rightSidebarCollapsed` was always false and the native surface reserve
    // was computed from the wrong branch.
    const RIGHT_SIDEBAR_COLLAPSED = /展开(?:右侧)?侧边栏|expand\s+(?:right\s+)?sidebar/i

    function ensureRightSidebarOpen() {
      const rightToggle = document.querySelector('[data-dsh-right-sidebar-toggle]')
      const rightToggleLabel = String(rightToggle?.getAttribute('aria-label') || rightToggle?.getAttribute('title') || '').trim()
      const rightSidebarCollapsed = RIGHT_SIDEBAR_COLLAPSED.test(rightToggleLabel)
      const visiblePanel = [...document.querySelectorAll('[data-dsh-better-sidebar] > *, [data-pane="right-sidebar"], [class*="rightSidebar"]')].some((node) => {
        const rect = node.getBoundingClientRect?.()
        const style = getComputedStyle(node)
        return !rightSidebarCollapsed && rect && rect.width >= 180 && rect.height >= window.innerHeight * 0.45 && rect.left < window.innerWidth - 8 && rect.right >= window.innerWidth - 8 && style.visibility !== 'hidden' && style.display !== 'none'
      })
      if (visiblePanel) return true
      const toggle = rightSidebarCollapsed ? rightToggle : null
      toggle?.click()
      if (toggle) window.dispatchEvent(new Event('taskhive:right-sidebar-toggle'))
      return Boolean(toggle)
    }

    let activePluginSurface = 'chat'

    // True when the sidebar bottom panel (which hosts terminals) is expanded.
    // better-sidebar publishes its height through this CSS variable, which this
    // client already reads for geometry, so it is a stable semantic signal —
    // unlike its hashed class names.
    const bottomPanelHeight = () => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-height') || '0') || 0

    // Closing the bottom panel for real, not just CSS-hiding it.
    //
    // `body[data-taskhive-plugin-surface-active]` only sets the panel's
    // `visibility: hidden`. The sidebar persists `bottomOpen` per session and
    // restores it, so a terminal that was open before becomes visible again the
    // instant the user switches back to chat — which reads as "a terminal pops
    // up when switching interfaces". Collapsing it on surface entry means there
    // is nothing left to reveal.
    const closeBottomPanel = () => {
      if (bottomPanelHeight() <= 0) return false
      const toggle = document.querySelector('[data-dsh-bottom-panel-toggle]')
      if (!toggle) return false
      toggle.click()
      return true
    }

    function setPluginSurfaceMode(kind) {
      const value = String(kind || 'chat')
      const active = value !== 'chat' && value !== 'settings'
      document.body.toggleAttribute('data-taskhive-plugin-surface-active', active)
      if (active) requestAnimationFrame(() => { closeBottomPanel() })
    }

    function openSurface(kind) {
      const next = String(kind || 'chat')
      // T142：记录"当前 surface"，供几何桥判断它是否在右栏 → 自动停靠（不依赖谁触发的打开）。
      window.__TASKHIVE_ACTIVE_SURFACE__ = next
      // T139：回到对话（或任何非右栏 surface）时取消"右栏停靠"，几何回到中央工作区。
      if (next === 'chat') { try { window.__TASKHIVE_DOCK_RAIL__?.(false) } catch { /* 几何桥未就绪 */ } }
      const changed = activePluginSurface !== next
      activePluginSurface = next
      setPluginSurfaceMode(next)
      if (changed && next !== 'chat' && next !== 'settings' && next !== 'knowledge') {
        ensureRightSidebarOpen()
      }
      window.parent.postMessage({ source: 'taskhive-dsh', type: 'surface.open', surface: next }, '*')
    }

    function setSettingsVisibility(visible) {
      window.parent.postMessage({ source: 'taskhive-dsh', type: 'settings.visibility', visible: visible === true }, '*')
    }

    function surfaceView(kind, title) {
      return function SurfaceView() {
        return h('div', { style: { display: 'grid', gap: '8px', padding: '12px', color: 'var(--dsw-alias-label-primary, #17211f)' } },
          h('strong', null, title),
          h('span', { style: { opacity: 0.72 } }, '点击此标签会在中央 Harness 工作区打开插件'),
        )
      }
    }
