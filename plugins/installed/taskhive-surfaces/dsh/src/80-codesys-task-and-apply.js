    function installNativeNavigationBridge() {
      let settingsVisible = false
      let settingsRequested = false
      const publishSettingsState = () => {
        const visible = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((node) => /设置|settings/i.test(String(node.innerText || '')) && node.getBoundingClientRect().width > 0)
        if (visible === settingsVisible) return
        settingsVisible = visible
        if (visible) settingsRequested = false
        setSettingsVisibility(visible)
      }
      const onClick = (event) => {
        const button = event.target?.closest?.('button,a,[role="button"],[role="treeitem"],[data-session-id],[data-workspace-id]')
        // T197：同一次点击若**已经**被 `onSurfaceEntryClick` 认领（它按入口标题匹配、并已
        // `openSurface(entry.id)` 打开了对应的插件面），这一趟就**不是**"回会话面"的导航。
        // 再补一个 `openSurface('chat')` 会把刚打开的插件面在 10 ms 内摘掉 —— 真机原文
        // （`C:\TaskHive\resources\app\logs\desktop.log`）：
        //   04:36:32.329 plugin.surface.shown  trigger=surface:open:codesys
        //   04:36:32.339 plugin.surface.hidden trigger=surface:open:chat
        // 托管着原生窗口时，这一对就是 `resumed`→`suspended`（真机 0.71–0.74 s 抖动）。
        // 两个监听器都在 document 捕获阶段、按注册顺序执行（`onSurfaceEntryClick` 在 :229
        // 先注册，本兜底在 :455 后注册），所以标记一定先落。真正的导航点击（会话行 / 新会话
        // / 工作区）没有这个标记，路由一字不改。
        if (event.__taskhiveSurfaceEntryId) return
        if (!button || button.closest('[data-taskhive-sidebar-plugins]')) return
        const label = String(button.innerText || button.getAttribute('aria-label') || '').trim()
        if (button.closest('[role="dialog"][aria-modal="true"]') && /^(关闭设置|关闭|close settings|close)$/i.test(label)) {
          setTimeout(() => {
            const stillVisible = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((node) => /设置|settings/i.test(String(node.innerText || '')) && node.getBoundingClientRect().width > 0)
            if (!stillVisible && (settingsVisible || settingsRequested)) {
              settingsVisible = false
              settingsRequested = false
              setSettingsVisibility(false)
            }
          }, 0)
          return
        }
        if (!button.closest('[data-pane="sidebar"],[class*="sidebarCol"]')) return
        if (/^(设置|settings)$/i.test(label)) {
          settingsRequested = true
          setSettingsVisibility(true)
          setTimeout(publishSettingsState, 50)
          return
        }
        if (button.matches('[role="treeitem"],[data-session-id],[data-workspace-id],[aria-current="page"],[aria-current="true"]') || button.closest('[data-session-id],[data-workspace-id]')) {
          // A plugin WebContentsView may still be attached while the native
          // session store finishes selecting the target. Route immediately to
          // the Harness conversation and let the store settle underneath.
          openSurface('chat')
          return
        }
        openSurface('chat')
      }
      const observer = new MutationObserver(publishSettingsState)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] })
      document.addEventListener('click', onClick, true)
      return () => { observer.disconnect(); document.removeEventListener('click', onClick, true); if (settingsVisible) setSettingsVisibility(false) }
    }

    function installCodesysTaskBridge(ctx) {
      const onMessage = (event) => {
        if ((event.source !== window && event.source !== window.parent) || event.data?.source !== 'taskhive-desktop') return
        if (event.data?.type === 'surface.state') {
          activePluginSurface = event.data.pluginActive === true ? String(event.data.surface || 'chat') : 'chat'
          setPluginSurfaceMode(activePluginSurface)
          return
        }
        if (event.data?.type !== 'codesys.task') {
          // The CODESYS panel switched its monitored window: the workbench only
          // ever follows that window, so re-detect against it immediately.
          if (event.data?.type === 'codesys.workbench.window') {
            void codesysWorkbenchControl.detect?.({ force: true, reason: 'monitored-window' })
          }
          return
        }
        const payload = event.data.payload || {}
        window.__TASKHIVE_LAST_CODESYS_TASK__ = payload
        window.dispatchEvent(new CustomEvent('taskhive:codesys-task', { detail: payload }))
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    }

    // T231（激活期可诊断 + 单点降级）：`apply` 的**外层**，只做两件事，都不改行为。
    //
    // ① 记下异常再**原样抛出**。为什么必须有这一层：2026-10-14 那次
    //    `taskhive-surfaces: failed` 的真异常文本**丢了** —— DSH 的启动审计
    //    （web frontend `GS()`）对 FAILED 的 fiber 只打印 `名字: failed`，cordis 也不把
    //    apply 的异常写进 console，而宿主（`app/main.js` 的 console-message 采集）只收
    //    warning/error ⇒ `renderer-console.log` 里只剩那句没有原因的总报。
    //    这里照旧向上抛（DSH 仍会把它报成 failed，语义不变），只是让**下一次**发生时
    //    日志里能直接看到「哪个文件、哪一行、什么异常」。
    function apply(ctx) {
      try {
        return applyActivation(ctx)
      } catch (error) {
        try {
          console.error('[taskhive-surfaces] activation threw (DSH reports this entry as failed)', error && (error.stack || error.message || error))
        } catch { /* 记日志失败不能盖掉原异常 */ }
        throw error
      }
    }

    function applyActivation(ctx) {
      // DSH 0.2 no longer ships the third-party better-sidebar plugin: the native
      // sidebar owns panel entries. A sidebar entry and its central panel share one
      // id (MainPanelId): the entry is declared through 'sidebar.panellist', the
      // panel through the keyed 'main' slot, and ctx.layout.selectPanel(id | null)
      // switches between them (null shows the Conversation). This replaces
      // better-sidebar's registerTab/openTab pair, which no longer resolves.
      if (!ctx.slots?.inject || !ctx.slots?.register) return
      const disposers = []
      const readOptionalService = (name) => {
        try { return ctx?.[name] || null } catch { return null }
      }
      const layout = ctx.layout
      const selectPanel = (panelId) => {
        if (!layout || typeof layout.selectPanel !== 'function') return false
        try { layout.selectPanel(panelId); return true } catch { return false }
      }
      // Host-only integration seam used by the desktop smoke probe. The native
      // sidebar's terminal is not a 'main' panel, so this stays best-effort: the
      // call is swallowed rather than thrown when the key is not registered.
      window.__TASKHIVE_OPEN_TERMINAL__ = () => selectPanel('taskhive:terminal')
      installTaskHiveSkin(ctx, () => selectPanel('taskhive:sessions'))
      // A panel reports its host surface when it mounts. That is the native
      // replacement for better-sidebar's per-tab onActivate hook, and it keeps
      // the host's surface.open / geometry messages flowing.
      const activating = (surfaceId, Component, placement) => function TaskHiveActivatedPanel() {
        React.useEffect(() => {
          // T139：只有**非右栏**的 surface 才取消"右栏停靠"（几何回到中央工作区）。
          // 右栏入口的主面板与右栏页签会同时挂载，若无条件置 false，
          // 页签刚设好的停靠会被主面板立刻清掉（实测 dock 一直是 false）。
          if (placement !== 'right') { try { window.__TASKHIVE_DOCK_RAIL__?.(false) } catch { /* 几何桥未就绪 */ } }
          // T137：知识库由**我们在 DSH 内**渲染（开源插件索引 + 对话沉淀卡片）。
          // 这里照常发 `surface.open knowledge`，由**外壳**把 knowledge 映射为
          // `renderChat()`（见 app/renderer/renderer.js 的 selectSurface：旧实现会
          // 走 renderRepositorySurface()，在 606×784、z-index 20 的 .plugin-overlay 上
          // 画旧版界面「问题/偏好/事实/…全是 0 张」，把新视图整个盖住）。
          // 客户端与外壳**两侧都要改**：只改一侧会留下"旧界面盖新界面"的隐患。
          window.__TASKHIVE_KNOWLEDGE_DSH_RENDERED__ = true
          openSurface(surfaceId)
        }, [])
        return h(Component)
      }
      // T136：入口位置**必须由宿主持久化的 placement 驱动**（左侧栏 / 右侧栏 / 隐藏）。
      //
      // 旧实现对所有 entry 无条件注册 `sidebar.panellist`，于是「本地插件」页把某个插件
      // 设成「右侧栏」后：左侧栏入口**不会消失**、右侧栏**也不会出现任何东西** ——
      // 位置下拉形同虚设（实测：web-ai 已存 right、左栏仍有「浏览器」，右栏为空）。
      //
      // 现在按 placement 分别注册：
      //   left   → `sidebar.panellist`（原生左栏入口）
      //   right  → `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`（右栏页签）
      //   hidden → 只保留 `main` 主面板（仍可被程序化打开，如会话删除失败的回退路径）
      // 并暴露 `window.__TASKHIVE_REFRESH_PLACEMENTS__`，让「本地插件」页改完位置后
      // **立即重注册**，无需刷新页面。
      // 注意：entry.id 与**插件 id** 不是一回事（entry `knowledge` ↔ 插件 `knowledge-base`，
      // entry `codesys` ↔ 插件 `codesys-monitor`），所以位置表一律按 `pluginId` 建键，
      // 否则宿主返回的 placement 永远匹配不上。
      const keyOf = (entry) => entry.pluginId || entry.id
      const placements = Object.fromEntries(entries.map((entry) => [keyOf(entry), entry.placement || 'left']))
      const loadPlacements = async () => {
        try {
          const list = await window.taskhive?.listPlugins?.()
          for (const item of Array.isArray(list) ? list : []) {
            if (item && item.id && item.entryConfigurable && item.placement) placements[item.id] = item.placement
          }
        } catch { /* 取不到就沿用声明值 */ }
      }
      const placementOf = (entry) => placements[keyOf(entry)] || entry.placement || 'left'
      let surfaceDisposers = []
      const registerMain = (entry, view) => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: entry.tabId }, activating(entry.id, view, placementOf(entry))))
      const registerLeftEntry = (entry) => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: entry.tabId, order: entry.order, label: () => entry.title,
      }, () => surfaceIcon(entry.id)))
      const registerRightEntry = (entry, view) => {
        const kind = entry.tabId
        const disposers = []
        disposers.push(ctx.sidebarRightTabs.register({
          id: kind, kind, keepMounted: true,
          title: () => entry.title,
          guide: [{ id: kind, order: entry.order || 20, title: () => entry.title, icon: () => surfaceIcon(entry.id) }],
        }))
        disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: kind,
          inject: (sessionId) => ({ ownerSessionId: sessionId }),
        }, function TaskHiveRightSurface() {
          // T139：**右栏插件在右栏里显示**。页签被激活（本面板可见）时自动：
          //   1) 打开原生 surface（浏览器 / IDE 的真实内容由宿主的原生面板承载）；
          //   2) 把几何切成"停靠右栏"，宿主就会把原生面板贴在右栏的盒子里。
          // 之前的「在中央打开」按钮已移除 —— 用户明确说："浏览器我都放在侧栏了，
          // 我为什么要在中央区打开"。想铺满中央区就把入口位置改成"左侧栏"。
          // 用 IntersectionObserver 而不是挂载即执行：本页签是 keepMounted 注册的，
          // 挂载 ≠ 可见（挂载即执行会在开机自动弹出原生界面，T137 踩过）。
          const ref = React.useRef(null)
          React.useEffect(() => {
            const node = ref.current
            if (!node) return undefined
            const activate = () => {
              try { window.__TASKHIVE_DOCK_RAIL__?.(true) } catch { /* 几何桥未就绪 */ }
              try { openSurface(entry.id) } catch { /* 宿主不可用 */ }
            }
            if (typeof IntersectionObserver !== 'function') { activate(); return undefined }
            const io = new IntersectionObserver((records) => {
              for (const record of records) if (record.isIntersecting && record.intersectionRatio > 0.15) activate()
            }, { threshold: [0.15] })
            io.observe(node)
            return () => io.disconnect()
          }, [])
          return h('div', { ref, 'data-taskhive-right-surface': entry.id, style: { display: 'grid', gap: '10px', padding: '12px' } },
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { style: { fontSize: '12px', opacity: 0.65 } }, `${entry.title} · 在右侧栏显示（如需铺满中央区，请在「设置 → 本地插件」把入口位置改为左侧栏）`)),
            h('div', { style: { minHeight: 0 } }, h(view)))
        })))
        return () => { for (const d of disposers) { try { d() } catch { /* 已释放 */ } } }
      }
      let placementQueue = Promise.resolve()
      const applyPlacements = () => {
        // T137：重注册必须**串行**。DSH 的 slot / sidebarRightTabs 释放是异步的，
        // 连续两次重注册（启动时立即注册 + 载入 placement 后再注册）会撞上
        // `sidebarRight: tab type id "taskhive:web-ai" is already registered`（实测报错）。
        placementQueue = placementQueue.then(async () => {
          for (const dispose of surfaceDisposers) { try { await dispose() } catch { /* 已释放 */ } }
          surfaceDisposers = []
          await new Promise((resolve) => setTimeout(resolve, 0))
          for (const entry of entries) {
            const view = entry.id === 'knowledge' ? KnowledgeView : surfaceView(entry.id, entry.title)
            surfaceDisposers.push(registerMain(entry, view))
            const placement = placementOf(entry)
            if (placement === 'left') surfaceDisposers.push(registerLeftEntry(entry))
            else if (placement === 'right') surfaceDisposers.push(registerRightEntry(entry, view))
          }
          window.__TASKHIVE_LEFT_SURFACE_IDS__ = entries.filter((entry) => placementOf(entry) === 'left').map((entry) => entry.id)
          window.__TASKHIVE_RIGHT_SURFACE_IDS__ = entries.filter((entry) => placementOf(entry) === 'right').map((entry) => entry.id)
          window.__TASKHIVE_PLACEMENTS__ = { ...placements }
        }).catch(() => {})
        return placementQueue
      }
      // T139b：**每次点击侧栏入口都要重新请求 surface**。
      // 之前只在主面板**挂载时**调 `openSurface`（`activating` 的 useEffect([])），
      // 于是"先开浏览器、再点知识库"时面板已挂载 → 不再发消息 → 外壳那层过期的
      // 浏览器原生 overlay 继续盖住 DSH 视图，用户看到的就是"知识库打开是空白"。
      // 这里在捕获阶段统一接管：任何点击到我们入口（左栏按钮 / 右栏页签）的事件都
      // 重新对齐几何（停靠 / 取消停靠）并重新打开对应 surface。
      const onSurfaceEntryClick = (event) => {
        const button = event.target && event.target.closest ? event.target.closest('button,[role="button"],[role="tab"]') : null
        if (!button) return
        if (button.closest('[data-taskhive-plugin-inventory]')) return
        const label = String(button.textContent || '').trim()
        if (!label) return
        const entry = entries.find((item) => String(item.title || '') === label)
        if (!entry) return
        try {
          if (placementOf(entry) === 'right') window.__TASKHIVE_DOCK_RAIL__?.(true)
          else window.__TASKHIVE_DOCK_RAIL__?.(false)
        } catch { /* 几何桥未就绪 */ }
        if (entry.id === 'knowledge') window.__TASKHIVE_KNOWLEDGE_DSH_RENDERED__ = true
        // T197：在**同一个事件对象**上留标记，供 `installNativeNavigationBridge()` 的左栏点击
        // 兜底（本文件 :11）识别"这一趟已经打开过自己的面"。只影响这一次派发，不需要复位。
        event.__taskhiveSurfaceEntryId = entry.id
        openSurface(entry.id)
      }
      document.addEventListener('click', onSurfaceEntryClick, true)
      disposers.push(() => document.removeEventListener('click', onSurfaceEntryClick, true))

      applyPlacements()
      window.__TASKHIVE_REFRESH_PLACEMENTS__ = async () => { await loadPlacements(); await applyPlacements(); return { ...placements } }
      void loadPlacements().then(() => applyPlacements())
      const workbenchKind = 'taskhive:codesys-workbench'
      if (entries.some((entry) => entry.id === 'codesys')) {
        // T231：这是**激活路径上唯一**的同步 tab-type 注册，也是 INV-10 覆盖不到的一处 ——
        // `applyPlacements()` 那条路径已按 INV-10「重注册必须串行 + 释放后留一个宏任务」写好，
        // 而这一行在 apply 里**同步**执行，排不进那个队列。DSH 的 `sidebarRightTabs` 会**拒绝**
        // 重复的 tab type id（`sidebarRight: tab type id "…" is already registered`，T136 实测踩过），
        // 而它的注销是**异步**的；DSH 客户端热更新会重新执行 apply（见 shard 79 的 T157 记录）。
        // 一旦撞上，这里**同步抛错** ⇒ cordis 把整条 fiber 标成 FAILED ⇒ DSH 报
        // `taskhive-surfaces: failed` ⇒ **整个客户端半片**（皮肤 / 左栏入口 / 设置页 / AI 数据桥 /
        // 工作台）一起消失。一次「页签 id 撞名」不该有这个量级的后果：把注册被拒降级为
        // **一行 error 日志 + 少一个页签**，apply 继续走完。正常路径（注册成功）逐字不变；
        // 不新增定时器、不改任何判定/安全语义（disposer 契约保持：被拒时返回空 disposer）。
        const registerWorkbenchTab = (definition) => {
          try {
            return ctx.sidebarRightTabs.register(definition)
          } catch (error) {
            console.error('[taskhive-surfaces] CODESYS workbench tab registration refused (same tab type id already registered; DSH release is asynchronous)', error && (error.message || error))
            return () => {}
          }
        }
        disposers.push(registerWorkbenchTab({
          id: workbenchKind, kind: workbenchKind, keepMounted: true,
          title: () => 'CODESYS 工作台',
          guide: [{ id: 'codesys-workbench', order: 8, title: () => 'CODESYS 工作台', icon: () => surfaceIcon('codesys') }],
        }))
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: workbenchKind,
          inject: (sessionId) => ({ ownerSessionId: sessionId }),
        }, function CodesysRightTab({ ownerSessionId, useTabInfo }) {
          const { tab } = useTabInfo()
          return h(CodesysWorkbenchBoundary, { ctx, ownerSessionId, tabVisible: tab.visible })
        }))
      }
      // T092: 会话记录维护标签。DSH 原生侧栏只能「归档会话」（记录与磁盘占用都保留）、
      // 没有任何删除 API，所以真删除需要一个自己的入口；这里用官方 registerTab，
      // 不去注入 DSH 的 React 菜单（那正是品牌反复失效的那类做法）。
      //
      // 收进 `hidden: true`（本次用户要求）—— 用户不需要侧栏多出一个「会话记录」标签。这个字段的
      // 含义是"**不在 ＋ 菜单里列出**"（见 better-sidebar 的 TabDescriptor.hidden 注释），
      // 并不等于禁用：`openTab('taskhive:sessions')` 依然可用，所以 T093 那条"标题不唯一
      // 时打开会话记录标签让用户手动处理"的退路不受影响；真正会拒绝 openTab 的是侧卡片
      // 偏好里的 tabsEnabled=false，和本字段无关。会话行「…」菜单里的「彻底删除」是
      // **独立入口**（直接走 sessionRecordsApi，不经过这个标签），照常可用。
      // T128 / INV-1：「会话记录」**不再作为独立入口**出现在侧栏或中央面板列表里。
      // 用户要求它归到「插件库 → 已安装」，与其它插件并列（catalog.json 里的 session-records）。
      // 这里只保留可被程序打开的主面板（删除失败时的回退路径 `openSessionRecordsTab()`
      // 仍然可用），不再向 `sidebar.panellist` 注册可见入口。
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'taskhive:sessions' }, () => h(SessionRecordsPanel, { ctx })))
      window.__TASKHIVE_SURFACE_IDS__ = entries.map((entry) => entry.id)
      window.__TASKHIVE_LEFT_SURFACE_IDS__ = entries.filter((entry) => entry.placement === 'left').map((entry) => entry.id)
      window.__TASKHIVE_RIGHT_SURFACE_IDS__ = entries.filter((entry) => entry.placement === 'right').map((entry) => entry.id)
      if (ctx.slots?.inject && ctx.slots?.register) {
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'taskhive-directories', order: 90
        }, () => h(DirectorySettingsItem)))
        // T130（2026-10-02）：用户要求删掉独立的「模型启用」，统一到原生「模型」页。
        // 原生页自身就是一个 `settings.section`（`@deepseek-ai/dsh-client-ui-settings-models`），
        // 且**没有**给外部留扩展插槽，所以这里优先尝试把 `ModelCatalogSection` 注入原生面板
        // （实现见 shard 82 `installNativeModelMerge`）；注入成功就**不再注册独立标签**。
        // 注入失败（宿主未暴露 react-dom/client，或找不到原生面板）时保留原标签兜底 ——
        // 这是刻意的：宁可有第二个入口，也不能让用户失去配置模型的能力。
        //
        // 历史备注保留：清单 T049 曾记录「原生 models 页一个提供方都不列」，并据此删过本 section；
        // 2026-10-02 用 CDP 复测该结论**已过期**（原生页现在列出 deepseek，带编辑/删除 +
        // 「添加模型提供商」），所以改为"能并则并、并不了才留兜底"。
        if (!installNativeModelMerge()) {
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            // Labelled "模型启用" rather than "模型" so it cannot be confused with
            // DSH's own `settings.section#models`. Only the id stays stable —
            // it is what other code and the probes address.
            name: 'settings.section', id: 'taskhive-model-catalog', order: 19, label: '模型启用'
          }, () => h(ModelCatalogSection)))
        }
        // T164/T173→T174：CODESYS AI 对话的**数据桥**（绑定**主页当前会话**；实现在 shard 78）。
        // T174 起 shard 78 **不再渲染任何 UI** —— 对话框界面由外壳的 CODESYS 面板自己渲染
        // （`app/renderer/renderer.js` 的右侧抽屉），这里注册的只是 `snapshot()` / `prompt(text)`
        // 两个纯数据入口，供主进程的 `codesys:ai-chat*` 通道调用。
        // **不依赖本函数的局部变量**（原先写成 `disposers.push(...)`，而 `disposers` 在这个位置
        // 可能不在作用域 → ReferenceError 被 catch 吞掉 → 入口从未建立，表现为"点了没反应"
        // 且一行日志都没有）。改由 shard 78 自己持有 disposer，并把结果写进 window 便于排查。
        try { installCodesysAiChat(ctx) } catch (error) { console.error('[taskhive] installCodesysAiChat 失败', error && error.message) }
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab', id: 'taskhive-plugin-inventory', order: 90, label: '本地插件'
        }, () => h(PluginInventoryTab)))
        // T120（2026-10-02）：这里曾再注册一个 `sidebar.footer.action`，用
        // LeftSurfaceActions 在侧栏底部重画一份 CODESYS / 浏览器 / 知识库。
        // 那和上面 `sidebar.panellist` 注册进原生侧栏的入口是**同一个功能的第二份入口**，
        // 也就是用户看到的"重复插件入口 / 唯一原生侧栏没做完"。
        // 现在只保留原生侧栏注册；LeftSurfaceActions 保留定义但不再挂载，
        // 以免 Shard 顺序和 `surfaceIcon` 依赖被牵动。
      }
      const workspaces = readOptionalService('workspaces')
      const sessions = readOptionalService('sessions')
      const uiWorkspace = readOptionalService('uiWorkspace')
      // DSH 0.2 keeps navigation out of the session catalog; the main-view
      // reference identifies the selected session, as in its native workspace UI.
      const currentSessionId = () => {
        const snapshot = sessions?.list?.getSnapshot?.()
        return snapshot?.current ?? Object.values(snapshot?.byId || {}).find((session) => (session.retainedBy?.mainView || 0) > 0)?.id
      }
      const openSession = (sessionId) => uiWorkspace?.openSession ? uiWorkspace.openSession(sessionId) : sessions.open(sessionId)
      // DSH 0.2 removed `sessions.current` from the raw list projection.  The
      // native conversation UI derives it from the session retained by
      // `mainView`; keep the smoke/read-only seam on that same source of truth
      // so probes do not mistake a valid workspace for a missing session.
      const sessionProbeSnapshot = () => {
        const snapshot = sessions?.list?.getSnapshot?.() || null
        if (!snapshot) return null
        return { ...snapshot, current: currentSessionId() || snapshot.current || null }
      }
      let workspaceAttempted = false
      let workspaceSetupPending = false
      const connectWorkspaceSession = async (workspaceId) => {
        if (!workspaceId || (!uiWorkspace?.openSession && typeof sessions?.open !== 'function')) throw new Error('Harness workspace/session services are unavailable')
        if (typeof uiWorkspace?.connectWorkspace === 'function') return uiWorkspace.connectWorkspace(workspaceId)
        if (typeof workspaces?.connectWorkspace === 'function') return workspaces.connectWorkspace(workspaceId)

        // Alpha.2 provides the raw workspace controller instead of the old
        // WorkspaceRuntime facade. Reuse a Host-listed blank session when
        // possible; otherwise create one through the official session API.
        const workspace = workspaces?.list?.getSnapshot?.()?.items?.find((item) => item.workspaceId === workspaceId)
        const sessionSnapshot = sessions?.list?.getSnapshot?.()
        const reusable = workspace && sessionSnapshot?.ids?.map((id) => sessionSnapshot.byId?.[id]).find((item) => item?.blank && item.cwd === workspace.path && workspace.sessionIds?.includes(item.id))
        if (reusable?.id) return reusable.id
        if (typeof sessions?.create !== 'function') throw new Error('Harness session creation service is unavailable')
        return sessions.create({ workspaceId })
      }
      // Narrow runtime probe seam. It uses the same Harness workspace/session
      // services as the native UI and is only invoked by the isolated Electron
      // regression probe. It never fabricates DOM session rows.
      //
      // The seam mutates real sessions (create/rename/archive), so it is gated
      // behind a flag the desktop main process sets only for `--smoke-ui`.
      // Without the gate any script running in the workbench page could archive
      // or rename the user's sessions.
      const requireQaProbes = () => {
        if (window.__TASKHIVE_QA_PROBES__ === true) return
        throw new Error('TaskHive QA session probe is disabled outside the isolated smoke run')
      }
      window.__TASKHIVE_SESSION_PROBE__ = {
        snapshot: () => ({
          workspaces: workspaces?.list?.getSnapshot?.() || null,
          sessions: sessionProbeSnapshot(),
        }),
        create: async () => {
          requireQaProbes()
          const workspaceSnapshot = workspaces?.list?.getSnapshot?.()
          const workspaceId = workspaceSnapshot?.items?.[0]?.workspaceId
          const sessionId = await connectWorkspaceSession(workspaceId)
          openSession(sessionId)
          return { sessionId, snapshot: sessionProbeSnapshot() }
        },
        makeHistorical: async (sessionId, text = 'TASKHIVE_HISTORY_SWITCH_PROBE') => {
          requireQaProbes()
          const face = sessions?.binding?.(sessionId)?.session
          if (!face || typeof face.prompt !== 'function' || typeof face.cancel !== 'function') {
            throw new Error('Harness session prompt/cancel face is unavailable')
          }
          const prompt = await face.prompt([{ type: 'text', text }], 'queue')
          const cancel = await face.cancel()
          return { prompt, cancel, snapshot: sessionProbeSnapshot() }
        },
        rename: async (sessionId, title) => {
          requireQaProbes()
          const face = sessions?.binding?.(sessionId)?.session
          if (!face || typeof face.rename !== 'function') throw new Error('Harness session rename face is unavailable')
          const result = await face.rename(title)
          if (result?.ok === false) throw new Error(result?.error?.message || 'Harness session rename was rejected')
          return { result, snapshot: sessionProbeSnapshot() }
        },
        archive: async (sessionId) => {
          requireQaProbes()
          if (!sessionId) throw new Error('Harness workspace archive service is unavailable')
          await archiveSessionFromContext(ctx, sessionId)
          return { snapshot: { workspaces: workspaces?.list?.getSnapshot?.() || null, sessions: sessionProbeSnapshot() } }
        },
        open: (sessionId) => {
          requireQaProbes()
          if (!sessionId) throw new Error('Harness session open service is unavailable')
          openSession(sessionId)
          return sessionProbeSnapshot()
        },
      }
      // Selecting Conversation mounts its session-scoped rightbar asynchronously.
      // Wait for the native binding instead of opening against the previous session.
      let workbenchOpenPending = false
      const flushWorkbenchOpen = () => {
        const current = currentSessionId()
        if (!workbenchOpenPending || !current || ctx.sidebarRight.mounted.getSnapshot() !== current) return
        ctx.sidebarRight.openTab(workbenchKind)
        workbenchOpenPending = false
      }
      const unsubscribeRightbar = ctx.sidebarRight.mounted.subscribe(flushWorkbenchOpen)
      disposers.push(unsubscribeRightbar)
      const openCodesysWorkbench = () => {
        workbenchOpenPending = true
        selectPanel(null)
        openSurface('chat')
        flushWorkbenchOpen()
        if (!currentSessionId()) void ensureHarnessWorkspace()
      }
      const onDesktopMessage = (event) => { if (event.source === window && event.data?.source === 'taskhive-desktop' && event.data?.type === 'codesys.workbench.open') openCodesysWorkbench() }
      window.addEventListener('message', onDesktopMessage)
      disposers.push(() => window.removeEventListener('message', onDesktopMessage))
      const ensureHarnessWorkspace = async () => {
        if (workspaceAttempted || workspaceSetupPending || !workspaces?.list || typeof workspaces.create !== 'function' || (!uiWorkspace?.openSession && typeof sessions?.open !== 'function')) return
        const snapshot = workspaces.list.getSnapshot?.()
        const sessionSnapshot = sessions.list?.getSnapshot?.()
        // DSH alpha.2 exposes the raw WorkspaceController projection. Its
        // ready state replaces the aggregate baselinesReady flag used by the
        // previous client-runtime facade.
        const workspaceReady = snapshot?.baselinesReady === true || (snapshot?.phase === 'ready' && snapshot?.state === 'idle')
        if (!workspaceReady || currentSessionId()) return
        workspaceSetupPending = true
        try {
          const workspacePath = await resolveHarnessWorkspacePath()
          if (!workspacePath) throw new Error('TaskHive default workspace path is unavailable')
          workspaceAttempted = true
          let workspaceId = snapshot.items[0]?.workspaceId
          if (!workspaceId) {
            const workspace = await workspaces.create({ path: workspacePath })
            workspaceId = workspace.workspaceId
          }
          const sessionId = await connectWorkspaceSession(workspaceId)
          openSession(sessionId)
        } catch (error) {
          workspaceAttempted = false
          console.warn('[taskhive-surfaces] default workspace unavailable', error)
        } finally {
          workspaceSetupPending = false
        }
      }
      const unsubscribeWorkspace = typeof workspaces?.list?.subscribe === 'function' ? workspaces.list.subscribe(() => void ensureHarnessWorkspace()) : () => {}
      const unsubscribeSessions = typeof sessions?.list?.subscribe === 'function' ? sessions.list.subscribe(() => {
        flushWorkbenchOpen()
        void ensureHarnessWorkspace()
      }) : () => {}
      const removeGeometryBridge = installWorkspaceGeometryBridge()
      const removeNativeNavigationBridge = installNativeNavigationBridge()
      const removeCodesysTaskBridge = installCodesysTaskBridge(ctx)
      const removeWebLoginCardBridge = installWebLoginCardBridge()
      void ensureHarnessWorkspace()
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          unsubscribeWorkspace()
          unsubscribeSessions()
          removeGeometryBridge()
          removeNativeNavigationBridge()
          removeCodesysTaskBridge()
          removeWebLoginCardBridge()
          // The skin owns a document-wide MutationObserver. It was previously
          // never released, so a plugin reload left it running forever.
          window.__TASKHIVE_SKIN_DISPOSE__?.()
          delete window.__TASKHIVE_SKIN_DISPOSE__
          window.__TASKHIVE_SURFACES_REGISTERED__ = false
          window.__TASKHIVE_SURFACE_IDS__ = []
          window.__TASKHIVE_LEFT_SURFACE_IDS__ = []
          window.__TASKHIVE_RIGHT_SURFACE_IDS__ = []
          window.__TASKHIVE_SURFACE_DESCRIPTORS__ = []
          delete window.__TASKHIVE_SESSION_PROBE__
          delete window.__TASKHIVE_OPEN_TERMINAL__
          disposers.forEach((dispose) => dispose())
        }, 'taskhive-surfaces: unregister tabs')
      }
      window.__TASKHIVE_SURFACES_REGISTERED__ = true
    }

    module.exports.apply = apply
      module.exports.inject = ['layout', 'workspaces', 'sessions', 'uiWorkspace', 'slots', 'sidebarRight', 'sidebarRightTabs']
    return module.exports
  },
})
