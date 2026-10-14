    function installWebLoginCardBridge() {
      const providers = { 'deepseek-web': 'deepseek', 'kimi-web': 'kimi', 'doubao-web': 'doubao', 'yuanbao-web': 'yuanbao', 'qwen-web': 'qwen', 'chatgpt-web': 'chatgpt', 'claude-web': 'claude', 'gemini-web': 'gemini' }
      const processTextNode = (textNode) => {
        const match = String(textNode?.nodeValue || '').match(/\[\[TASKHIVE_WEB_LOGIN:([^\]]+)\]\]/)
        if (!match) return
        const modelId = match[1]
        textNode.nodeValue = String(textNode.nodeValue || '').replace(match[0], '').trimStart()
        const host = textNode.parentElement?.closest('[data-message-id],article,[class*="message"],[class*="turn"]') || textNode.parentElement
        if (!host || host.querySelector(`[data-taskhive-web-login="${modelId}"]`)) return
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.taskhiveWebLogin = modelId
        button.title = '在中央浏览器打开登录页'
        button.setAttribute('aria-label', `登录 ${modelId}`)
        button.textContent = '需要登录 · 打开浏览器'
        button.style.cssText = 'display:inline-flex;align-items:center;height:32px;margin:8px 0;padding:0 11px;border:1px solid var(--th-brand-strong);border-radius:6px;background:var(--th-brand);color:#fff;font:500 12px Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer'
        button.onclick = async () => { await window.taskhive?.openWebAi?.({ providerId: providers[modelId] || 'deepseek', newWindow: false }); openSurface('web-ai') }
        host.appendChild(button)
      }
      const scan = (root = document.body) => {
        if (root?.nodeType === Node.TEXT_NODE) return processTextNode(root)
        if (!root) return
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) processTextNode(walker.currentNode)
      }
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'characterData') {
            processTextNode(mutation.target)
            continue
          }
          for (const node of mutation.addedNodes) scan(node)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      scan()
      return () => observer.disconnect()
    }

    function LeftSurfaceActions({ wide }) {
      const [, refresh] = React.useState(0)
      const navRef = React.useRef(null)
      const showLabels = wide !== false
      const leftEntries = entries.filter((entry) => entry.placement === 'left')
      if (!leftEntries.length) return null
      return h('nav', {
        ref: navRef,
        'data-taskhive-sidebar-plugins': 'active',
        'data-plugin-labels-visible': showLabels ? 'true' : 'false',
        'aria-label': 'TaskHive 插件',
        style: { display: 'grid', width: showLabels ? '180px' : '31px', minWidth: showLabels ? '180px' : '31px', maxWidth: 'min(220px, 100%)', gap: '4px', padding: '6px 0', overflow: 'visible', zIndex: 2 }
      }, leftEntries.map((entry) => h('button', {
        key: entry.id,
        type: 'button',
        title: entry.title,
        'data-sidebar-plugin-id': entry.pluginId || entry.id,
        draggable: true,
        onDragStart: (event) => { event.dataTransfer?.setData('text/plain', entry.pluginId || entry.id) },
        onDragOver: (event) => event.preventDefault(),
        onDrop: async (event) => {
          event.preventDefault()
          const dragged = event.dataTransfer?.getData('text/plain')
          const target = entry.pluginId || entry.id
          if (!dragged || dragged === target) return
          const ordered = [...entries]
          const from = ordered.findIndex((item) => (item.pluginId || item.id) === dragged)
          const to = ordered.findIndex((item) => (item.pluginId || item.id) === target)
          if (from < 0 || to < 0) return
          const [moved] = ordered.splice(from, 1)
          ordered.splice(to, 0, moved)
          entries = ordered
          await Promise.all(ordered.map((item, index) => window.taskhive?.setPluginOrder?.({ id: item.pluginId || item.id, order: index })))
          refresh((value) => value + 1)
        },
        onClick: () => openSurface(entry.id),
        style: { appearance: 'none', border: '0', display: 'flex', alignItems: 'center', gap: showLabels ? '10px' : '0', width: showLabels ? '180px' : '31px', minWidth: 0, minHeight: '42px', marginLeft: '-3px', padding: '6px 9px', borderRadius: '9px', color: 'var(--dsw-alias-label-primary, #17211f)', background: 'transparent', font: 'inherit', cursor: 'pointer', textAlign: 'left', overflow: 'hidden' }
      }, surfaceIcon(entry.id), h('span', { 'data-plugin-label': entry.pluginId || entry.id, style: { display: showLabels ? 'block' : 'none', flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' } }, entry.title))))
    }

    function installWorkspaceGeometryBridge() {
      let frame = 0
      let pane = null
      let resize = null
      let lastGeometry = null
      let publishedGeometry = null
      let stableFrames = 0
      let lastSafeRightBoundary = null
      let lastSafeLeft = null
      const delayedPublishes = new Set()
      let boundNodes = []
      // T139：当前显示的原生插件是否"放在右栏"。为 true 时把宿主面板**停靠进右栏**，
      // 而不是铺满中央区 —— 用户原话：「浏览器我都放在侧栏了，我为什么要在中央区打开」。
      // 由 80-*.js 在右侧栏页签被激活时置 true、切回左栏/对话时置 false。
      let railDock = false

      // ── Geometry metrics: opt-in, zero-cost while off ──────────────────────
      //
      // The audit question is whether this bridge really costs anything during
      // streaming, so the numbers have to come out of the running renderer
      // instead of out of an assumption. While metrics are off every counter
      // below is a plain boolean read: no performance.now(), no allocation. It
      // is also local-only — nothing is ever posted to the parent, so the
      // `surface.geometry` contract is exactly what it was.
      //
      // Switch on / off (renderer console, or a CDP Runtime.evaluate probe):
      //   window.dispatchEvent(new Event('taskhive:geometry-metrics'))            // toggle
      //   window.dispatchEvent(new CustomEvent('taskhive:geometry-metrics', { detail: true }))
      // A workbench URL carrying `#taskhive-geometry-metrics` (the query string
      // is accepted too) switches it on at install time.
      // Read it:
      //   window.__taskhiveGeometryMetrics            // fresh snapshot object
      //   window.dispatchEvent(new Event('taskhive:geometry-metrics:report'))
      //     → one console.warn line, which the main process records in
      //       logs/renderer-console.log — the no-DevTools collection path.
      //
      // Counters (reset every time metrics are switched on):
      //   observerCallbacks        mutation-observer callbacks for observed nodes
      //   resizeCallbacks          ResizeObserver callbacks for geometry nodes
      //   publishCalls             publish() calls that scheduled a frame
      //   measurementFrames        frames that ran a full measurement pass
      //   measurementTotalMs       wall time inside those measurement passes
      //   measurementWorstMs       worst single measurement pass
      //   measurementAverageMs     measurementTotalMs / measurementFrames
      //   postedGeometryMessages   surface.geometry messages actually sent
      //   observedNodes            DOM nodes watched (was: the whole document)
      const metrics = { observerCallbacks: 0, resizeCallbacks: 0, publishCalls: 0, measurementFrames: 0, measurementMs: 0, worstMs: 0, posted: 0 }
      let metricsOn = /taskhive-geometry-metrics/i.test(`${window.location.hash || ''} ${window.location.search || ''}`)
      const previousMetrics = Object.getOwnPropertyDescriptor(window, '__taskhiveGeometryMetrics')
      const roundMs = (value) => Math.round(value * 1000) / 1000
      const metricsSnapshot = () => ({
        enabled: metricsOn,
        observerCallbacks: metrics.observerCallbacks,
        resizeCallbacks: metrics.resizeCallbacks,
        publishCalls: metrics.publishCalls,
        measurementFrames: metrics.measurementFrames,
        measurementTotalMs: roundMs(metrics.measurementMs),
        measurementWorstMs: roundMs(metrics.worstMs),
        measurementAverageMs: metrics.measurementFrames ? roundMs(metrics.measurementMs / metrics.measurementFrames) : 0,
        postedGeometryMessages: metrics.posted,
        observedNodes: boundNodes.length,
      })
      const setMetrics = (next) => {
        metricsOn = next === true
        // Reset on enable so one measurement run is a clean window.
        for (const key of Object.keys(metrics)) metrics[key] = 0
      }
      const onMetricsToggle = (event) => setMetrics(typeof event?.detail === 'boolean' ? event.detail : !metricsOn)
      const onMetricsReport = () => { console.warn(`[taskhive-surfaces] geometry metrics ${JSON.stringify(metricsSnapshot())}`) }
      window.addEventListener('taskhive:geometry-metrics', onMetricsToggle)
      window.addEventListener('taskhive:geometry-metrics:report', onMetricsReport)
      Object.defineProperty(window, '__taskhiveGeometryMetrics', { configurable: true, enumerable: false, get: metricsSnapshot })

      // ── What is observed, and why that cannot miss a geometry change ───────
      //
      // The previous observer watched the whole document subtree with
      // `childList + attributes`, so every token React inserted while streaming
      // scheduled a full layout-measurement pass. The published geometry is a
      // pure function of a small, known input set, and only that set's mutation
      // sources have to be watched:
      //
      //   1. window.innerWidth/innerHeight       → existing `window.resize` listener
      //   2. the rects of the conversation pane, the left sidebar, the right rail
      //      and the right-sidebar candidates    → one ResizeObserver per node (a
      //      box can only change size because of something inside it) plus an
      //      attribute observer per node (class/style can MOVE a box without
      //      resizing it: `panelHidden` slides the rail with a transform)
      //   3. the `--dsh-sidebar-width` / `--dsh-sidebar-height` custom properties,
      //      which better-sidebar writes into `document.documentElement.style`,
      //      and which the shell turns into `#root` margin / column margins
      //      → attribute observer on <html>
      //   4. `[data-dsh-right-sidebar-toggle]`'s aria-label/title, which decides
      //      `rightSidebarCollapsed`      → attribute observer on that button
      //      (the old filter never watched these two, so this is strictly more
      //      coverage, and the publishedGeometry dedupe still absorbs duplicates)
      //
      // A queried node can also be REPLACED by a re-render, leaving the node we
      // observe detached while an unobserved replacement takes its place. So
      // every ancestor of a queried node (up to <html>), plus <head> (stylesheet
      // insert/remove was the one whole-document signal that could move layout
      // with no attribute change anywhere) and #root, is watched with
      // `childList: true, subtree: false` — parent-level structure only. A
      // replacement necessarily mutates its parent's child list, that parent is
      // an observed ancestor, and the pass then re-resolves and rebinds. Content
      // inserted deep inside the conversation mutates descendants of the pane,
      // never a direct child of an observed ancestor, so it cannot notify this
      // bridge — and does not need to, because the pane's ResizeObserver already
      // covers anything that changes its box.
      //
      // Newly added structural elements are remembered (bounded to the most
      // recent 32) and walked as extra chain roots on the next rebind, so a
      // subtree that appears before anything geometry-relevant resolves inside
      // it still becomes observed level by level.
      const ATTR_FILTER = ['class', 'style', 'data-pane', 'data-dragging', 'data-sidebar-collapsed', 'data-dsh-sidebar-collapsed', 'data-details-collapsed', 'data-dsh-better-sidebar-panel', 'aria-label', 'title']
      const structuralSeeds = new Set()
      const rememberStructuralNode = (node) => {
        if (!node || node.nodeType !== 1) return
        structuralSeeds.add(node)
        while (structuralSeeds.size > 32) structuralSeeds.delete(structuralSeeds.values().next().value)
      }
      const targetObserver = new MutationObserver((records) => {
        if (metricsOn) metrics.observerCallbacks += 1
        for (const record of records) {
          if (record.type !== 'childList') continue
          for (const node of record.addedNodes) rememberStructuralNode(node)
        }
        publish()
      })
      const targetResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
        if (metricsOn) metrics.resizeCallbacks += 1
        publish()
      }) : null
      const syncObservers = (targets) => {
        const chain = []
        const structural = new Set()
        const seen = new Set()
        const push = (node, withChildren = false) => {
          if (!node) return
          if (withChildren) structural.add(node)
          if (seen.has(node)) return
          seen.add(node)
          chain.push(node)
        }
        for (const node of targets) push(node)
        for (const node of targets) {
          for (let ancestor = node?.parentElement; ancestor; ancestor = ancestor.parentElement) push(ancestor, true)
        }
        for (const node of structuralSeeds) push(node, true)
        push(document.documentElement, true)
        push(document.head, true)
        push(document.body, true)
        push(document.getElementById('root'), true)
        if (chain.length === boundNodes.length && chain.every((node, index) => node === boundNodes[index])) return
        boundNodes = chain
        // Rebind from scratch: detached panes/rails drop out with the old
        // observation set instead of being retained for the page's lifetime.
        targetObserver.disconnect()
        for (const node of chain) {
          targetObserver.observe(node, structural.has(node)
            ? { childList: true, subtree: false, attributes: true, attributeFilter: ATTR_FILTER }
            : { attributes: true, attributeFilter: ATTR_FILTER })
        }
        if (!targetResize) return
        targetResize.disconnect()
        for (const node of targets) if (node) targetResize.observe(node)
      }
      const recordMeasurement = (startedAt) => {
        if (!metricsOn) return
        const elapsed = performance.now() - startedAt
        metrics.measurementFrames += 1
        metrics.measurementMs += elapsed
        if (elapsed > metrics.worstMs) metrics.worstMs = elapsed
      }
      const publish = (force = false) => {
        if (metricsOn) metrics.publishCalls += 1
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          const next = document.querySelector('[data-pane="conversation"]') || document.querySelector('main')
          if (next !== pane) {
            resize?.disconnect()
            pane = next
            resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
              if (metricsOn) metrics.resizeCallbacks += 1
              publish()
            }) : null
            if (pane) resize?.observe(pane)
          }
          // Timed region: the measurement pass only. Reading boxes/styles below
          // is what can force a layout flush; the bookkeeping, observation
          // rebinding and posting that follow stay outside the measurement.
          const startedAt = metricsOn ? performance.now() : 0
          const viewport = { width: window.innerWidth, height: window.innerHeight }
          const rect = pane?.getBoundingClientRect?.()
          const sidebarNode = document.querySelector('[data-pane="sidebar"], aside, [class*="sidebarCol"]')
          const sidebar = sidebarNode?.getBoundingClientRect?.()
          const declaredPanelNode = document.querySelector('[data-dsh-better-sidebar-panel="right"]')
          const declaredPanel = declaredPanelNode?.getBoundingClientRect?.()
          const isDockedRightPanel = (value) => value
            && value.width >= 180
            && value.height >= viewport.height * 0.45
            && value.left >= viewport.width * 0.45
            && value.right >= viewport.width - 4
            && value.right <= viewport.width + 4
          const rightNodes = [
            // T139：补上 DSH 0.2 的**实际**右栏类名 `rightbarCol` —— 旧选择器只认
            // rightSidebar/sidebarRight，于是 `right` 永远是 undefined：侧栏打开时不
            // 给空间、收起时又白留 380px（用户反馈的两面都出在这里）。
            ...document.querySelectorAll('[data-pane="right-sidebar"], [data-taskhive-right-sidebar-plugins], [class*="rightbarCol"], [class*="rightSidebar"], [class*="sidebarRight"], [data-dsh-better-sidebar] > *'),
          ]
          const rightCandidates = rightNodes.map((node) => node.getBoundingClientRect?.()).filter(isDockedRightPanel)
          const right = isDockedRightPanel(declaredPanel) ? declaredPanel : rightCandidates.sort((a, b) => a.left - b.left)[0]
          const declaredRightWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width') || getComputedStyle(document.body).getPropertyValue('--dsh-sidebar-width') || '0') || 0
          // DSH rc.8 has used several conversation-pane markers. If the
          // marker resolves to a composer-sized node, derive the central
          // workbench from the actual left/right rails instead of publishing
          // a bottom strip as the desktop overlay.
          const validConversation = rect && rect.width > viewport.width * 0.45 && rect.height > viewport.height * 0.45
          // One invariant governs both edges: a published boundary may never cut
          // into a rail whose box is still measured. Both rails animate, so for a
          // frame or two the derived values disagree with the boxes — the
          // conversation marker can already span the window (rect.left 0) while
          // the left rail is still laid out, and the right toggle can already say
          // "expanded" while the right rail is still docked. Publishing such a
          // frame put the native overlay on top of a rail the user was looking at.
          // The rail's own rectangle is the authority, so it is a floor here
          // (and a ceiling on the right, below) whenever it is measurable. The
          // width guard keeps a broad `aside`/`sidebarCol` container from being
          // mistaken for the rail itself.
          const leftRailRight = sidebar && sidebar.width > 0 && sidebar.width <= viewport.width * 0.5
            ? Math.round(sidebar.right)
            : 0
          if (leftRailRight > 0) lastSafeLeft = leftRailRight
          let left = validConversation
            ? Math.max(rect.left, leftRailRight)
            : Math.max(leftRailRight || lastSafeLeft || 0, 0)
          // `data-dsh-sidebar-collapsed` is shared by DSH's left navigation
          // and cannot describe the right rail. Only the native right-rail
          // toggle may permit a narrow desktop surface bound.
          const rightToggle = document.querySelector('[data-dsh-right-sidebar-toggle]')
          const rightToggleLabel = String(rightToggle?.getAttribute('aria-label') || rightToggle?.getAttribute('title') || '')
          // T139：**右栏是否占位，以它自己的盒子为唯一权威**（用户口径："不应该是侧栏打开
          // 才让步空间吗"）。实测：收起时 `rightbarCol` 仍是 left=1266/width=0，而开关按钮的
          // aria-label/title 可能为空 —— 只信文案就会把收起的侧栏当成打开，白让 380~570px。
          // isDockedRightPanel 已要求"宽度≥180 且贴右边缘"，动画中间帧由下面的两帧稳定门槛吸收。
          const rightSidebarCollapsed = !right
          const toggleReserve = rightSidebarCollapsed ? 36 : 0
          if (!rightSidebarCollapsed && right) lastSafeRightBoundary = Math.round(right.left)
          // The right-side content can briefly move inside its rail while a
          // tab changes. Ignore these offscreen rectangles and keep the last
          // docked boundary so the native WebContentsView cannot cover the
          // right rail while the DOM settles.
          const minimumRightReserve = Math.max(180, declaredRightWidth || 380)
          const fallbackRightBoundary = lastSafeRightBoundary ?? Math.max(0, viewport.width - minimumRightReserve)
          // Same invariant on the right: while the rail is collapsed the surface
          // may use its space, but only once the rail has actually gone. If a
          // docked rectangle is still measured, the label is mid-transition and
          // the rail wins.
          const collapsedRightBoundary = viewport.width - toggleReserve
          const rightBoundary = rightSidebarCollapsed
            ? (right ? Math.min(Math.round(right.left), collapsedRightBoundary) : collapsedRightBoundary)
            : Math.min(viewport.width - minimumRightReserve, right?.left ?? fallbackRightBoundary)
          let rightEdge = validConversation ? Math.min(rect.right, rightBoundary) : rightBoundary
          let top = validConversation ? rect.top : 0
          let bottom = validConversation ? rect.bottom : viewport.height
          // T139/T142：**右栏插件停靠** —— 原生面板直接贴在右栏面板的盒子上（而不是铺满中央区），
          // 并显式打上 `docked:true`，让宿主 `normalizeSurfaceBounds()` 不要再用"右栏保留宽度"
          // 去夹这条几何（否则 left=696/width=570 会被夹成 width=0，面板又回到中央）。
          // 判定不依赖"谁点的入口"：只要**当前打开的 surface 在右栏**（或显式开关打开）就停靠，
          // 这样外壳里 `openSurface('web-ai')` 之类的路径也会自动停靠。
          const activeRightSurface = (window.__TASKHIVE_RIGHT_SURFACE_IDS__ || []).includes(window.__TASKHIVE_ACTIVE_SURFACE__)
          const dockRailNow = railDock || window.__TASKHIVE_RAIL_DOCK__ === true || activeRightSurface
          let docked = false
          if (dockRailNow && right && right.width >= 180) {
            left = Math.round(right.left)
            rightEdge = Math.round(right.right)
            top = Math.round(right.top)
            bottom = Math.round(right.bottom)
            docked = true
          }
          // Everything the geometry above was derived from, so the observers can
          // be (re)bound to exactly the nodes whose boxes and attributes matter.
          const targets = [pane, sidebarNode, declaredPanelNode, rightToggle, document.querySelector('[data-dsh-better-sidebar]'), ...rightNodes]
          recordMeasurement(startedAt)
          syncObservers(targets)
          if (rightEdge <= left || bottom <= top) return
          const geometry = {
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(rightEdge - left),
            height: Math.round(bottom - top),
            rightBoundary: Math.round(rightBoundary),
            rightSidebarReserve: Math.round(viewport.width - rightBoundary),
            rightSidebarCollapsed,
            // T142：显式告诉宿主"这条几何是右栏停靠盒"，宿主据此跳过右栏保留宽度的夹取。
            docked,
          }
          // Sidebar transitions briefly expose intermediate rectangles. Wait
          // for two identical animation frames before replacing the desktop
          // overlay bounds; this prevents a stale/wide column from covering
          // the right rail during a surface switch or resize.
          const same = lastGeometry && Object.keys(geometry).every((key) => geometry[key] === lastGeometry[key])
          stableFrames = same ? stableFrames + 1 : 1
          lastGeometry = geometry
          if (!force && stableFrames < 2) return
          if (publishedGeometry && Object.keys(geometry).every((key) => geometry[key] === publishedGeometry[key])) return
          publishedGeometry = geometry
          // 便于用 CDP 直接核对"实际发布了什么几何"（宿主原生面板就是按它定位的）。
          window.__TASKHIVE_LAST_GEOMETRY__ = geometry
          if (metricsOn) metrics.posted += 1
          window.parent.postMessage({ source: 'taskhive-dsh', type: 'surface.geometry', geometry }, '*')
        })
      }
      // The whole-document MutationObserver that used to sit here (`documentElement`
      // with `subtree: true`) is gone. `syncObservers` above owns every geometry
      // trigger now: the observed chain of the queried nodes, plus <html>/<head>/
      // <body>/#root for structure. See its comment for why that cannot miss a
      // geometry change while it does stop firing on ordinary chat content.
      // T139：右栏停靠开关。状态挂在 `window` 上而不是闭包里 —— DSH 的 client-hmr 会
      // 重新执行插件 apply，闭包标志会被新实例重置（实测调用后立刻读到 false）。
      window.__TASKHIVE_RAIL_DOCK__ = window.__TASKHIVE_RAIL_DOCK__ === true
      if (typeof window.__TASKHIVE_DOCK_RAIL__ !== 'function') {
        window.__TASKHIVE_DOCK_RAIL__ = (value) => {
          window.__TASKHIVE_RAIL_DOCK__ = value === true
          publish(true)
          return window.__TASKHIVE_RAIL_DOCK__
        }
      }
      const republishAfterRightRailTransition = (event) => {
        if (event?.type === 'click' && !event.target?.closest?.('[data-dsh-right-sidebar-toggle]')) return
        // DSH updates this control through aria state, which is outside the
        // mutation observer filter. Publish settled native rail geometry even
        // when the shared left-sidebar attribute does not change.
        for (const delay of [180, 520]) {
          const timer = setTimeout(() => { delayedPublishes.delete(timer); publish(true) }, delay)
          delayedPublishes.add(timer)
        }
      }
      document.addEventListener('click', republishAfterRightRailTransition, true)
      window.addEventListener('taskhive:right-sidebar-toggle', republishAfterRightRailTransition)
      window.addEventListener('resize', publish)
      publish()
      return () => {
        cancelAnimationFrame(frame)
        targetObserver.disconnect()
        targetResize?.disconnect()
        resize?.disconnect()
        for (const timer of delayedPublishes) clearTimeout(timer)
        document.removeEventListener('click', republishAfterRightRailTransition, true)
        window.removeEventListener('taskhive:right-sidebar-toggle', republishAfterRightRailTransition)
        window.removeEventListener('resize', publish)
        window.removeEventListener('taskhive:geometry-metrics', onMetricsToggle)
        window.removeEventListener('taskhive:geometry-metrics:report', onMetricsReport)
        // Retract the metrics accessor only while it is still the one installed
        // here: a later install owns it otherwise.
        if (Object.getOwnPropertyDescriptor(window, '__taskhiveGeometryMetrics')?.get === metricsSnapshot) {
          if (previousMetrics) Object.defineProperty(window, '__taskhiveGeometryMetrics', previousMetrics)
          else delete window.__taskhiveGeometryMetrics
        }
      }
    }

