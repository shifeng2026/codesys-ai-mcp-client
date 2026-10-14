    // DSH alpha.2 keeps archiveSession on the host side. Use the local facade
    // when available, otherwise call the trusted host route; workspaceRegistry
    // is intentionally not injected into this browser plugin.
    async function archiveSessionFromContext(ctx, sessionId) {
      const uiWorkspace = getOptionalService(ctx, 'uiWorkspace')
      if (typeof uiWorkspace?.archiveSession === 'function') return uiWorkspace.archiveSession(sessionId)
      const result = await sessionRecordsApi('archive', { sessionId })
      if (!result) throw new Error('Harness workspace archive service is unavailable')
      return result
    }

    function SessionRecordsPanel({ ctx }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [status, setStatus] = React.useState('正在读取…')
      const [selected, setSelected] = React.useState(() => new Set())
      const activeSessionId = String(getOptionalService(ctx, 'sessions')?.list?.getSnapshot?.()?.current || '')
      const load = React.useCallback(async () => {
        installSessionPanelStyle()
        setStatus('正在读取…')
        const value = await sessionRecordsApi('list')
        if (!value) { setError('读不到会话记录：宿主插件可能还是旧版本，请重启 TaskHive。'); setStatus('读取失败'); return }
        setData(value)
        setError('')
        setStatus(`${value.sessionCount} 个会话 · ${formatSessionBytes(value.totalBytes)}`)
      }, [])
      React.useEffect(() => { void load() }, [load])
      const rows = React.useMemo(
        () => (data?.workspaces || []).flatMap((group) => group.sessions.map((row) => ({ ...row, key: `${group.workspace}/${row.session}` }))),
        [data],
      )
      const selectedRows = rows.filter((row) => selected.has(row.key))
      const selectedBytes = selectedRows.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0)
      const toggle = (key) => setSelected((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key); else next.add(key)
        return next
      })
      const setAll = (on) => setSelected(on ? new Set(rows.filter((row) => row.session !== activeSessionId).map((row) => row.key)) : new Set())
      const remove = async () => {
        if (busy || !selectedRows.length) return
        const accepted = await showTaskHiveDialog({
          title: '删除会话记录',
          confirm: true,
          danger: true,
          acceptLabel: '删除',
          message: `确认删除选中的 ${selectedRows.length} 个会话？`,
        })
        if (!accepted) return
        setBusy(true); setError(''); setStatus('正在删除…')
        try {
          const result = await sessionRecordsApi('purge', {
            targets: selectedRows.map((row) => ({ workspace: row.workspace, session: row.session })),
            confirm: true,
            activeSessionId,
          })
          if (!result) { setError('删除失败：宿主未响应，请重启 TaskHive 后重试。'); setStatus('删除失败'); return }
          setSelected(new Set())
          if (result.deleted.length) {
            for (const row of result.deleted) {
              try { await archiveSessionFromContext(ctx, row.session) } catch { /* 文件已删，归档失败只影响列表刷新 */ }
            }
          }
          setStatus(`已删除 ${result.deleted.length} 个 · 回收 ${formatSessionBytes(result.freedBytes)}${result.skipped.length ? ` · 跳过 ${result.skipped.length}` : ''}`)
          await load()
        } finally { setBusy(false) }
      }
      return h('div', { 'data-taskhive-sessions': 'true' },
        h('header', { className: 'th-sess-head' },
          h('span', { className: 'th-sess-title' }, '会话记录'),
          h('span', { className: 'th-sess-sum', title: data?.root || '' }, status),
          h('div', { className: 'th-sess-tools' },
            h('button', { className: 'th-sess-btn', type: 'button', disabled: busy, onClick: () => void load() }, '刷新'),
            h('button', { className: 'th-sess-btn', type: 'button', disabled: busy || !rows.length, onClick: () => setAll(true) }, '全选'),
            h('button', { className: 'th-sess-btn', type: 'button', disabled: busy || !selected.size, onClick: () => setAll(false) }, '取消选择'))),
        h('div', { className: 'th-sess-list' },
          error ? h('div', { className: 'th-sess-error', role: 'alert' }, error) : null,
          ...(data?.workspaces || []).map((group) => h('section', { className: 'th-sess-group', key: group.workspace },
            h('div', { className: 'th-sess-group-head' },
              h('span', { className: 'th-sess-group-name', title: group.label }, group.label),
              h('span', { className: 'th-sess-group-meta' }, `${group.sessions.length} 个 · ${formatSessionBytes(group.bytes)}`)),
            group.sessions.map((row) => {
              const key = `${group.workspace}/${row.session}`
              const isActive = row.session === activeSessionId
              const checked = selected.has(key)
              return h('label', {
                className: 'th-sess-row', key, title: isActive ? '当前打开的会话不能删除' : row.session,
                'data-selected': checked ? 'true' : 'false', 'data-active': isActive ? 'true' : 'false',
              },
                h('input', { type: 'checkbox', checked, disabled: busy || isActive, onChange: () => toggle(key) }),
                h('span', { className: 'th-sess-id' }, row.session, isActive ? h('span', { className: 'th-sess-badge' }, '当前') : null),
                h('span', { className: 'th-sess-time' }, formatSessionTime(row.mtimeMs)),
                h('span', { className: 'th-sess-size' }, formatSessionBytes(row.bytes)))
            }))),
          !rows.length && !error ? h('div', { className: 'th-sess-empty' }, '没有读到会话记录。') : null),
        h('footer', { className: 'th-sess-actions' },
          h('span', { className: 'th-sess-actions-info' }, selectedRows.length ? `已选 ${selectedRows.length} 个 · ${formatSessionBytes(selectedBytes)}` : '未选择'),
          h('button', {
            className: 'th-sess-btn th-sess-btn-danger', type: 'button', disabled: busy || !selectedRows.length,
            onClick: () => void remove(),
          }, '彻底删除')))
    }

    function publishCodesysWorkbenchMirror(state) {
      codesysWorkbenchMirror.state = state
      for (const listener of [...codesysWorkbenchMirror.listeners]) { try { listener(state) } catch { /* one bad listener must not break publishing */ } }
    }

    // T090: 会话标识的短形式。会话 id 通常很长，底部行只留前 8 位，全文在 title 里。
    function codesysSessionLabel(value) {
      const text = String(value || '')
      return text.length > 10 ? `${text.slice(0, 8)}…` : text
    }

    // ── T089 状态续期心跳 ────────────────────────────────────────────────────
    // 宿主侧的工作台状态在**最后一次发布后 15 分钟**过期（index.js 的
    // WORKBENCH_STATE_TTL_MS），而状态由工作台这一侧发布。用户把对话放久了再问，
    // 模型第一次就会读不到工程。
    //
    // T069 禁止的是**昂贵的定时工程探测**（detectCurrentProject → 启动 ScriptEngine，
    // 并让控件反复禁用/闪烁）。这里每 5 分钟只做一件事：把工作台**已经持有的那份
    // 状态**原样再 POST 一次——不重新读工程、不启动 ScriptEngine、不改动任何 UI 状态、
    // 也不重新生成快照。定时器挂在插件层而不是组件里，所以工作台标签被关掉之后依然
    // 续期（那正是用户在对话里提问的时刻）。
    const CODESYS_STATE_KEEPALIVE_MS = 5 * 60 * 1000
    const codesysStateKeepAlive = {
      state: null,
      sessionId: '',
      timer: null,
      // KNOWN-ISSUES #8: 工程快照记的是**送达**，不是"打算发送"。
      //   publishedSignature —— 已被宿主确认接收的快照签名
      //   pendingSnapshot    —— 已构造但尚未被确认接收的 { signature, snapshot }
      // 放在插件层而不是组件里的两个原因：发送有两个入口（900 ms 防抖发送与 5 分钟
      // 续期心跳），且工作台标签重挂载不应该让"已送达"的判断丢失。
      publishedSignature: '',
      publishedSessionId: '',
      pendingSnapshot: null,
    }

    // KNOWN-ISSUES #8: 发往宿主的**唯一出口**，两个调用者都必须走这里。
    //
    // 发送是 900 ms 合并式防抖（同一窗口内后一次覆盖前一次），所以"构造了带快照的
    // payload"完全不等于"它真的发出去了"：只要 900 ms 内还有一次发布，前一次就被丢掉。
    // 旧实现把"已发布签名"在构造的那一刻就推进了，于是被挤掉的那一次永远不会补发——
    // 宿主的 publishWorkbenchState 是字段合并，"字段缺席"会保留旧值，而旧值从来没被
    // 写入过，所以 projectSnapshot 会永久停在 null（工程级快照永远读不到，而随每次
    // 选区发布的 openObject 一切正常）。
    //
    // 现在：在**实际发送的那一刻**把 pending 快照并进 payload，并且只有收到宿主确认
    // （response.value.accepted !== false）才清除它。因此"被后一次挤掉"和"整包被拒
    // （例如超过宿主 512 KB 上限）"两种情况都会由下一次发布或心跳自愈。
    async function sendCodesysState(sessionId, state) {
      const candidate = codesysStateKeepAlive.pendingSnapshot
      const pending = candidate?.sessionId === sessionId ? candidate : null
      const outgoing = pending && state && state.projectSnapshot === undefined
        ? { ...state, projectSnapshot: pending.snapshot }
        : state
      const result = await codesysWorkbenchApi('publish', { sessionId, state: outgoing })
      if (pending && result && result.accepted !== false && codesysStateKeepAlive.pendingSnapshot === pending) {
        codesysStateKeepAlive.publishedSignature = pending.signature
        codesysStateKeepAlive.publishedSessionId = sessionId
        codesysStateKeepAlive.pendingSnapshot = null
      }
      return result
    }
    function scheduleCodesysStateKeepAlive() {
      if (codesysStateKeepAlive.timer) return
      codesysStateKeepAlive.timer = setInterval(() => {
        const { state, sessionId } = codesysStateKeepAlive
        if (!state || !sessionId) return
        void sendCodesysState(sessionId, state)
      }, CODESYS_STATE_KEEPALIVE_MS)
    }
    if (typeof window !== 'undefined') {
      // Read-only seam: another client plugin (or a probe) can read exactly what
      // the workbench shows without scraping its DOM. The pure tree helpers are
      // exposed too, so a probe can verify the hierarchy logic on real data.
      window.__TASKHIVE_CODESYS_WORKBENCH__ = {
        version: 2,
        getState: () => codesysWorkbenchMirror.state,
        subscribe: (listener) => { codesysWorkbenchMirror.listeners.add(listener); return () => codesysWorkbenchMirror.listeners.delete(listener) },
        kindOf: (item) => codesysKindOfObject(item || {}),
        buildTree: (items) => {
          const tree = buildCodesysTree(items)
          return {
            roots: tree.roots.length,
            nodes: tree.nodes.length,
            maxDepth: tree.order.reduce((max, node) => Math.max(max, node.depth), 0),
            rows: tree.order.map((node) => ({ key: node.key, name: String(node.item?.name || ''), depth: node.depth, kind: node.kind.kind, category: node.kind.category, children: node.children.length })),
          }
        },
        filterKeys: (items, filter) => [...codesysTreeVisibleKeys(buildCodesysTree(items), filter)],
      }
    }

    // T086: 「代码任务」改成一次**命名命令**，而不是一段替用户编出来的请求。
    //
    // 之前它发出的是我拼的「用户要求：审查……」，还附了整份管道说明（读哪个临时
    // 文件、调哪个工具、返回什么 JSON、禁止什么）。用户指出两件事：那只是"告诉 AI
    // 要调用什么工具、读取什么文件"，而不是一次代码审核；而且我的"用户要求"是凭空
    // 生成的，用户从没说过那句话。
    //
    // 现在：按钮就叫它真正做的事（`AI 审核`），文案是这次点击的**忠实复述**，管道
    // 说明全部删掉——工具名、JSON 结构、objectGuid 规则、PLC 禁列、上下文标签约定
    // 本来就已经写在宿主的系统提示与工具描述里（`index.js` 的
    // `taskhive:codesys-workbench` 段），不该每点一次再讲一遍。消息里只留：命令本身
    // + （工程级快照时）一句上下文路径引用，以保持 T018「完整快照只留本地」的约定。
    const CodesysTaskComposer = React.memo(function CodesysTaskComposer({ jobId, busy, sessionId, selectedName, onSubmitRef }) {
      const target = String(selectedName || '').trim()
      const reviewCommand = target
        ? `审核工作台当前打开的对象「${target}」：给出可直接写入工程的完整代码；不需要修改的地方请说明原因。`
        : '审核工作台当前工程：挑出最值得修改的代码对象，并给出可直接写入工程的完整代码。'
      const disabled = busy || !jobId || !sessionId
      const submitDraft = (event) => {
        event.preventDefault()
        if (disabled) return
        void onSubmitRef.current?.(reviewCommand, () => {})
      }
      return h('form', { className: 'taskhive-codesys-composer', onSubmit: submitDraft },
        h('button', {
          className: 'taskhive-codesys-action taskhive-codesys-action-text taskhive-codesys-action-ai', type: 'submit', 'data-codesys-code-task': 'true',
          'aria-label': 'AI 审核当前打开的代码对象',
          title: disabled
            ? (busy ? '正在读取工程，稍后可再次发送' : '请先绑定 CODESYS 工程，并确认 Harness 会话已连接')
            : `在当前 Harness 会话里让 AI 审核，并给出可直接写入工程的修改：${reviewCommand}`,
          disabled,
        }, codesysActionIcon('review'), h('span', { className: 'taskhive-codesys-action-label' }, 'AI 审核')))
      }, (previous, next) => previous.jobId === next.jobId && previous.busy === next.busy && previous.sessionId === next.sessionId && previous.selectedName === next.selectedName)

    // ── T084 顶栏图标 ────────────────────────────────────────────────────────
    // 顶栏必须真的落在一行。原来它装了 标题 + 「当前工程」字段名 + 路径 + 5 个文字
    // 按钮 + 2 个徽章 ≈ 730px，而默认侧栏只有 400px（可用约 384px）——所以
    // **任何**侧栏宽度下它都会折行，这是 T081 只把「当前工程」搬上来、没把它压下去
    // 的欠账。低频操作（复制 / 在资源管理器定位 / 回退基线）改用 15px 图标，全文
    // 留在 aria-label 与 title 里；高频的「刷新 / 选择工程」保留文字，侧栏再窄时
    // 才退化成图标。分档用容器查询读工作台自身宽度，不依赖窗口尺寸。
    const CODESYS_ACTION_ICONS = {
      refresh: [h('path', { d: 'M20.4 12a8.4 8.4 0 1 1-2.5-6' }), h('path', { d: 'M20.4 4.4v5h-5' })],
      select: [h('path', { d: 'M3.6 6.6h4.8l2 2h10v10.8H3.6z' }), h('path', { d: 'M3.6 6.6V4.2h4.8l2 2' }), h('path', { d: 'M12 12.6v4.6M9.7 14.9h4.6' })],
      copy: [h('rect', { x: '9', y: '9', width: '11', height: '11', rx: '2' }), h('path', { d: 'M5.6 15.4V6.1a1.5 1.5 0 0 1 1.5-1.5h7.3' })],
      reveal: [h('path', { d: 'M3.6 6.6h4.8l2 2h10v10.8H3.6z' }), h('circle', { cx: '12.5', cy: '14.6', r: '2.6' })],
      rollback: [h('path', { d: 'M3.6 12a8.4 8.4 0 1 0 2.5-6' }), h('path', { d: 'M3.6 4.4v5h5' })],
      // T086: AI 审核入口（四角星 + 小星，与上面 5 个"工程管道"图标形状明显不同）
      review: [h('path', { d: 'M11.4 3.4l1.6 4.3 4.3 1.6-4.3 1.6-1.6 4.3-1.6-4.3L5.5 9.3l4.3-1.6z' }), h('path', { d: 'M17.8 15.1l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z' })],
      // T097: 编译入口（锤子形状，与圆形箭头／文件夹／四角星都不撞形）。顶栏必须留在
      // 一行，而这条宽度预算被 codesys-workbench-compact-layout-contract 量化过，所以它
      // 只能做成 26px 纯图标；完整说明放 title。
      build: [h('path', { d: 'M13.9 3.6l6.5 6.5-2.2 2.2-6.5-6.5z' }), h('path', { d: 'M11.7 5.8 4.4 13.1a1.9 1.9 0 0 0 0 2.7l1.8 1.8a1.9 1.9 0 0 0 2.7 0l7.3-7.3' })],
      // Online (PLC) actions. These are the only controls in the workbench that
      // reach real hardware, so each icon is deliberately distinct from the
      // offline "project pipeline" shapes above.
      onlineLogin: [h('path', { d: 'M9 3.6v5' }), h('path', { d: 'M15 3.6v5' }), h('path', { d: 'M6.6 8.6h10.8v3.2a5.4 5.4 0 0 1-10.8 0z' }), h('path', { d: 'M12 17.2v3.2' })],
      onlineLogout: [h('path', { d: 'M9 3.6v5' }), h('path', { d: 'M15 3.6v5' }), h('path', { d: 'M6.6 8.6h10.8v3.2a5.4 5.4 0 0 1-10.8 0z' }), h('path', { d: 'M9.4 18.6h5.2' })],
      onlineDownload: [h('path', { d: 'M12 3.8v9.4' }), h('path', { d: 'M8.2 9.6 12 13.4l3.8-3.8' }), h('path', { d: 'M4.6 16.4v2.2a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-2.2' })],
      // 扫描设备：雷达 + 放大镜的合成形，和上面所有图标都不撞形。
      onlineScan: [h('circle', { cx: '11', cy: '11', r: '6.2' }), h('path', { d: 'M15.6 15.6 20.4 20.4' }), h('path', { d: 'M8.4 11h5.2M11 8.4v5.2' })],
      // 已绑定：扫描图标换成对勾 —— 窄栏只剩图标时，也要一眼看出"这台设备绑定好了"。
      onlineBound: [h('circle', { cx: '12', cy: '12', r: '8.4' }), h('path', { d: 'M8.2 12.4 11 15.2 16 9.8' })],
      // 功能 4/6/7/8/5/12：在线修改 / 启动 / 停止 / 复位 / 写变量 / Force + 取消强制。
      onlineChange: [h('path', { d: 'M4.4 8.4h11.2' }), h('path', { d: 'M12.6 5.2 15.8 8.4l-3.2 3.2' }), h('path', { d: 'M19.6 15.6H8.4' }), h('path', { d: 'M11.4 12.4 8.2 15.6l3.2 3.2' })],
      onlineStart: [h('path', { d: 'M7.4 4.6 19 12 7.4 19.4z' })],
      onlineStop: [h('rect', { x: '6.2', y: '6.2', width: '11.6', height: '11.6', rx: '1.4' })],
      onlineReset: [h('path', { d: 'M19.4 12a7.4 7.4 0 1 1-2.2-5.2' }), h('path', { d: 'M19.4 4.6v5h-5' }), h('circle', { cx: '12', cy: '12', r: '2.4' })],
      onlineWrite: [h('path', { d: 'M4.6 19.4h14.8' }), h('path', { d: 'M14.4 4.6 19.4 9.6 10.4 18.6H5.4v-5z' })],
      onlineForce: [h('path', { d: 'M12 3.6 5.4 12h4.2v8.4h4.8V12h4.2z' })],
      onlineUnforce: [h('path', { d: 'M12 3.6 5.4 12h4.2v8.4h4.8V12h4.2z' }), h('path', { d: 'M4.2 4.2 19.8 19.8' })],
    }
    // 与 app/codesys-online-authorization.js 的 HARD_GATE_PHRASE 必须**逐字一致**，
    // 否则用户照着界面输也会被主机拒绝。有合同断言锁住这两份表。
    const CODESYS_HARD_GATE_PHRASE = { 'write-variable': '写入变量', reset: '复位设备', force: '强制变量' }

    function codesysActionIcon(id) {
      return h('svg', {
        className: 'taskhive-codesys-action-icon', viewBox: '0 0 24 24', width: 15, height: 15,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        focusable: 'false', 'aria-hidden': 'true',
      }, ...(CODESYS_ACTION_ICONS[id] || []))
    }
