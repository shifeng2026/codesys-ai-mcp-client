    // ── T182：工作台从会话里读消息的取法（与 shard 78 的 T181 同源，判据必须一模一样） ────────────
    //
    // 症状（与 shard 78 那次是同一个真因）：工作台原来读
    // sessions.binding(id).session.getSnapshot().nodes，再用 codesysText(node.blocks) 抽文本。
    // DSH 0.2 里 Session 的会话快照（buildSnapshot()，dsh-api-session-controller/lib/client.js
    // 的 :2273-2297）字段只有 sessionId / pendingSubmissions / running / subagent / removed /
    // openState / openError / hasMore / loadingOlder / promptError / blank / lastAgentError /
    // promptAttempted / awaitingFirstTurn —— **没有 nodes**。于是 nodes 恒为 undefined →
    // 消息恒为空 → 工作台的「从会话里自动捕获改动提案」在真机上是**静默失效**的：模型明明回了提案，
    // 工作台既不报错也不亮琥珀色徽章（成功、但空），只有 pending 队列那条路还能把提案送进来。
    //
    // 真实消息在 chat 视图里（dsh-client-ui-chat/lib/client.js 的 :8878-8887
    // ChatSnapshotBuilder.snapshot() = { order, nodes, locations, ... }，order 是已排序的可见节点 key，
    // nodes.get(key) 取节点）：
    //   * 用户消息 :9346 = { kind: 'user', seq, content }，content 是 wire 形的文本块
    //     { type: 'text', text }；引导消息 :9339 = { kind: 'steering', ... } 同形；
    //   * 助手消息 :7733 = chatNode(..., 'assistant-step', ..., data, ...)，块在 data.blocks 里，
    //     是 Chat 形的 { kind: 'text', text }。
    // 三条取法与 shard 78 完全一致，顺序也一致（它 T181 那段注释是同一份判据的全文）：
    //   ① uiSession.current.getSnapshot().hooks.chat（DSH 0.2 真形状；dsh-client-ui-session 的
    //      materialize() 把 target('chat') 合进 hooks）；
    //   ② uiConversation.binding(id).target('chat')（同一个 target 的另一条取法，hooks.chat 缺失时）；
    //   ③ 老形状 conversation.getSnapshot().nodes（**向前兼容**，角色名与块名两种都认）。
    // 会话判定一条都没回退：retainedBy.mainView > 0 仍是主判据，sessions.list 的 current 只是兜底
    // （见 shard 78 的 T176 段）。
    //
    // 为什么不把这段抽成一份共用工具：本轮写作用域**不允许**改 shard 10 与 shard 78（78 是刚修好的
    // 那一份，回退风险与收益不成比例），所以这里按同一套判据**同构实现**一份，名字统一带
    // codesysWorkbench 前缀以免与 shard 78 的 codesysAiChat* 撞名。两份之间只允许注释里这段差异说明；
    // 以后若允许改 shard 10，就把 codesysWorkbenchSessionMessages 整段搬过去当唯一实现。
    const CODESYS_WORKBENCH_TEXT_BLOCK_KIND = 'text'

    // 一个内容块是不是文本块：wire 形 { type: 'text' } 与 Chat 形 { kind: 'text' } 两种都真实存在
    // （用户消息的 content 是前者、助手消息的 blocks 是后者）。reasoning / tool-call / image 一律不进
    // ——与改动前"只取文本"的行为一个字不差。
    function codesysWorkbenchTextBlock(block) {
      if (!block || typeof block !== 'object') return ''
      const kind = block.kind === undefined || block.kind === null ? block.type : block.kind
      if (kind !== CODESYS_WORKBENCH_TEXT_BLOCK_KIND) return ''
      return typeof block.text === 'string' ? block.text : ''
    }

    // 块数组 → 一段文本；多个文本块之间补一个换行，首尾 trim（等价于 shard 10 的 codesysText，
    // 但**同时**认 kind 与 type 两种块名）。
    function codesysWorkbenchBlocksText(blocks) {
      if (!Array.isArray(blocks)) return ''
      let text = ''
      for (const block of blocks) {
        const piece = codesysWorkbenchTextBlock(block)
        if (!piece) continue
        text += (text ? '\n' : '') + piece
      }
      return text.trim()
    }

    // 一个会话节点 → 一条消息；null = 这个节点不是用户/助手消息（工具调用、通知、分组行等）。
    // 角色：user 与 steering 都算用户；assistant-step 是 DSH 0.2 的名字，assistant 是老名字，一起认。
    // 正文：助手在 data.blocks、用户在 data.content；老形状两者都直接放在节点自己的 blocks 上，
    // 节点没有包 data 时就在节点上找字段 —— 新旧两种形状都能读。
    function codesysWorkbenchMessageOfNode(node) {
      if (!node || typeof node !== 'object') return null
      const kind = String(node.kind || '')
      const role = kind === 'user' || kind === 'steering'
        ? 'user'
        : (kind === 'assistant' || kind === 'assistant-step' ? 'assistant' : '')
      if (!role) return null
      const data = node.data && typeof node.data === 'object' ? node.data : node
      let text = codesysWorkbenchBlocksText(data.blocks)
      if (!text) text = codesysWorkbenchBlocksText(data.content)
      if (!text && typeof data.text === 'string') text = data.text.trim()
      if (!text) return null
      const raw = data.seq === undefined || data.seq === null ? node.seq : data.seq
      const seq = Number(raw === undefined || raw === null ? node.anchorSeq : raw)
      return { role, seq: Number.isFinite(seq) ? seq : 0, text }
    }

    // ② 用到的物化动作：target() 的 subscribe 会顺带 activate(target)
    // （dsh-client-ui-conversation/lib/client.js 的 :2944-2949），而**没被激活过**的视图快照是
    // undefined（同文件 :2102-2106 的 snapshot() 读 views.get(target)?.snapshot）。所以这里订阅一次
    // 再立刻退订，只为让视图物化；拿走监听器，不留引用。
    function codesysWorkbenchMaterializeChatSource(source) {
      if (!source || typeof source.subscribe !== 'function') return
      let off = null
      try { off = source.subscribe(() => {}) } catch { off = null }
      if (typeof off === 'function') { try { off() } catch { /* 退订失败不影响读取 */ } }
    }

    // ① hooks.chat（真形状）→ ② uiConversation.binding(id).target('chat')（同一个 target 的另一条取法）。
    // 两条都是"不要求 inject"的读法（shard 78 的 modelDirectories/remote 已经证明这条路走得通），
    // 失败一律吞掉并落到下一条，绝不抛。
    function codesysWorkbenchChatSource(ctx, sessionId) {
      const uiSession = getOptionalService(ctx, 'uiSession')
      try {
        const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null
        const chat = binding && binding.hooks ? binding.hooks.chat : null
        if (chat && typeof chat.getSnapshot === 'function') return chat
      } catch { /* 落到 ② */ }
      const uiConversation = getOptionalService(ctx, 'uiConversation')
      try {
        const conversation = uiConversation && typeof uiConversation.binding === 'function' ? uiConversation.binding(sessionId) : null
        const target = conversation && typeof conversation.target === 'function' ? conversation.target('chat') : null
        if (target && typeof target.getSnapshot === 'function') return target
      } catch { /* 落到 ③ */ }
      return null
    }

    // 读一次 chat 视图快照。视图没被激活过时快照是 undefined（见上面 T182 段），这时才做一次
    // "订阅→退订"把它物化，然后重读；已经物化过的轮询不会去碰监听器。
    function codesysWorkbenchChatView(source) {
      const read = () => {
        try { return source && source.getSnapshot ? source.getSnapshot() : null } catch { return null }
      }
      let view = read()
      if (!view || !view.nodes) {
        codesysWorkbenchMaterializeChatSource(source)
        view = read()
      }
      return view && view.nodes ? view : null
    }

    // ①/② 的快照 → 消息。只走 order 里列出的节点（order 已经是"可见且有序"的那一份，hidden 的节点
    // 留在 store 里但不在 order 中，所以不会把已经撤回的内容当成新提案）。
    function codesysWorkbenchMessagesFromChatView(view) {
      const messages = []
      if (!view || typeof view !== 'object') return messages
      const store = view.nodes
      if (!store || typeof store !== 'object') return messages
      const read = typeof store.get === 'function'
        ? (key) => store.get(key)
        : (typeof store.source === 'function' ? (key) => store.source(key) : null)
      if (!read) return messages
      const order = Array.isArray(view.order) ? view.order : []
      for (const key of order) {
        let node = null
        try { node = read(key) } catch { node = null }
        const message = codesysWorkbenchMessageOfNode(node)
        if (message) messages.push(message)
      }
      return messages
    }

    // ③ 老形状（向前兼容）：conversation.getSnapshot().nodes。失败一律吞掉 —— 工作台对"读不出来"的
    // 语义就是"当没有"，不像 shard 78 的界面接口那样要把 snapshot-threw 报上去。
    //
    // 这里比 shard 78 多容忍一种输入：**既认会话实例（有 getSnapshot），也认会话快照本身**。
    // 原因很实在：shard 78 的 main.conversation 是 Session 实例，而 shard 50 的 `conversation`
    // 这个 state 存的**就是** `binding.session.getSnapshot()` 的返回值（老代码直接读
    // `conversation.nodes`）。同一个取法要能同时吃这两种形状，否则第三条路在工作台里恒为空 ——
    // 那等于把"向前兼容"写成了一句空话。
    // T183 第 5 项：待处理提案的**兜底**领取间隔。
    // 改前是"每 4 秒无条件 IPC 问一次宿主"（CODESYS_CLAIM_POLL_MS）；现在真正的触发源是
    // 事件（新助手消息 / 会话快照变化 / 回到窗口 / 切到本界面 / 刚绑定工程），这颗 4 秒
    // 心跳只在超过这个间隔时才真发一次请求。30 秒是权衡：足够让"事件源断掉"的情形在
    // 半分钟内自愈，又把挂着工作台时的宿主往返从 900 次/小时降到 120 次/小时。
    const CODESYS_CLAIM_FALLBACK_MS = 30000

    function codesysWorkbenchSnapshotOf(source) {
      if (!source || typeof source !== 'object') return null
      if (typeof source.getSnapshot === 'function') {
        try { return source.getSnapshot() } catch { return null }
      }
      return source
    }

    function codesysWorkbenchMessagesFromLegacySnapshot(source) {
      const snapshot = codesysWorkbenchSnapshotOf(source)
      const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
      const messages = []
      for (const node of nodes) {
        const message = codesysWorkbenchMessageOfNode(node)
        if (message) messages.push(message)
      }
      return messages
    }

    // 统一入口：① / ② / ③ 依次尝试，返回 { messages, channel }。channel 只用于自报与排错
    // （'chat' = DSH 0.2 真形状 / 'session-nodes' = 老形状兜底 / '' = 三条都空 = 会话真的是空的）。
    // `legacy` 既可以是会话实例，也可以是会话快照本身（见 ③ 的说明）；null / undefined 一律安全。
    function codesysWorkbenchSessionMessages(ctx, sessionId, legacy) {
      const source = codesysWorkbenchChatSource(ctx, sessionId)
      if (source) {
        const messages = codesysWorkbenchMessagesFromChatView(codesysWorkbenchChatView(source))
        if (messages.length) return { messages, channel: 'chat' }
      }
      const messages = codesysWorkbenchMessagesFromLegacySnapshot(legacy)
      if (messages.length) return { messages, channel: 'session-nodes' }
      return { messages, channel: '' }
    }

    // ── 能力面（用户口径：「AI 对话就是唯一操作面，工作台只做能力提供」） ──────────────────────
    //
    // 工作台此后是**能力提供方**：它把"当前提案 / 写入闸门 / 编译结果"作为**纯数据**发布出去，
    // 由外壳的 AI 对话抽屉在消息流里显示与确认。这里只做两件事，且都不新增写入路径：
    //   * `read()`  —— 只读投影（提案差异、写入闸门、后台编译进度/终态），口径与工作台自己看到的一致；
    //   * `apply()` —— 调**工作台那枚「确认写入」按钮调的同一个函数**（`applyProposal`），
    //                 不另造写入实现、不绕过 sha 防护、不自动确认。
    // 数据全部有上限（一行条数 / 字符数），因为它要随 1.5 秒一次的快照过 IPC。
    const CODESYS_CAPABILITY_LINE_BUDGET = 24        // 每段最多几条差异行
    const CODESYS_CAPABILITY_LINE_CHARS = 240        // 每条差异行的字符上限
    const CODESYS_CAPABILITY_MESSAGE_BUDGET = 40     // 编译消息条数上限
    const CODESYS_CAPABILITY_MESSAGE_CHARS = 400     // 每条编译消息的字符上限
    const CODESYS_CAPABILITY_OBJECT_BUDGET = 24      // 提案里最多几个对象

    function codesysCapabilityClipLine(text) {
      const value = String(text === undefined || text === null ? '' : text)
      return value.length > CODESYS_CAPABILITY_LINE_CHARS ? `${value.slice(0, CODESYS_CAPABILITY_LINE_CHARS)}…` : value
    }

    // 一段文本的差异：**口径与工作台的差异视图相同** —— 同一个 `codesysChangedLineNumbers()`
    // （dsh/src/10-codesys-proposal-and-tree.js）算"哪几行变了"，再把那些行的前后文本各取一份。
    // 新增对象（create-*）的 base 是空串，于是每一行都是 `+`，这正是工作台里"待新增"的样子。
    function codesysCapabilitySection(baseText, nextText) {
      // 空基线 = "工程里还没有这个对象"：`''.split('\n')` 会造出一行空文本，于是新对象的第一行会被
      // 画成一条 `- 1 | `（删掉一行空白）—— 那是噪音，也不真实。基线为空时按"零行"处理。
      const baseSource = String(baseText === undefined || baseText === null ? '' : baseText)
      const base = baseSource === '' ? [] : baseSource.split('\n')
      const next = String(nextText === undefined || nextText === null ? '' : nextText).split('\n')
      const changed = [...codesysChangedLineNumbers(baseText, nextText)].sort((left, right) => left - right)
      const lines = []
      let truncated = false
      for (const number of changed) {
        if (lines.length >= CODESYS_CAPABILITY_LINE_BUDGET) { truncated = true; break }
        const before = base[number - 1]
        const after = next[number - 1]
        if (before !== undefined && before !== after) lines.push({ kind: '-', line: number, text: codesysCapabilityClipLine(before) })
        if (after !== undefined && after !== before) lines.push({ kind: '+', line: number, text: codesysCapabilityClipLine(after) })
      }
      return { changedLines: changed.length, lines, truncated: truncated || lines.length >= CODESYS_CAPABILITY_LINE_BUDGET }
    }

    // 一条提案改动 → 抽屉能直接画的数据：对象名 / 操作 / 声明与实现两段的差异。
    function codesysCapabilityChange(change, objects, proposal) {
      const operation = codesysProposalOperation(change, objects, proposal)
      const target = resolveCodesysProposalObject(change, objects)
      const hasDeclaration = Object.prototype.hasOwnProperty.call(change || {}, 'declaration')
      const hasImplementation = Object.prototype.hasOwnProperty.call(change || {}, 'implementation')
      const baseDeclaration = target ? String(target.declaration || '') : ''
      const baseImplementation = target ? String(target.implementation || '') : ''
      return {
        objectName: String(change?.objectName || ''),
        objectGuid: String(change?.objectGuid || (target && target.guid) || ''),
        operation,
        exists: Boolean(target),
        declaration: hasDeclaration ? codesysCapabilitySection(baseDeclaration, String(change.declaration || '')) : null,
        implementation: hasImplementation ? codesysCapabilitySection(baseImplementation, String(change.implementation || '')) : null,
      }
    }

    // 编译消息 → 抽屉里那几行（条数与每条长度都有上限，超出的部分如实计数而不是静默丢掉）。
    function codesysCapabilityMessages(messages) {
      const list = Array.isArray(messages) ? messages : []
      const kept = list.slice(0, CODESYS_CAPABILITY_MESSAGE_BUDGET).map((item) => ({
        severity: String(item?.severity || 'info'),
        text: codesysCapabilityClipLine(String(item?.text || '')).slice(0, CODESYS_CAPABILITY_MESSAGE_CHARS),
      }))
      return { kept, omitted: Math.max(0, list.length - kept.length) }
    }

    function CodesysWorkbench({ ctx, ownerSessionId, tabVisible = true }) {
      const [status, setStatusState] = React.useState('正在检测当前已打开的 CODESYS 工程…')
      // T208: the bottom row is ONE line of small text whose full content lives in `title` —
      // the CSS ellipsis only cuts what is DRAWN, never the string, so a long project name is
      // never sliced in code. A binding sentence has a second thing worth hovering (WHERE that
      // project is), so the path travels beside the text instead of being concatenated into it.
      // Every plain `setStatus` clears it, so a path can never outlive the sentence that named
      // the project it belongs to.
      const [statusProjectPath, setStatusProjectPath] = React.useState('')
      const setStatus = (text) => { setStatusState(text); setStatusProjectPath('') }
      const setStatusWithProject = (text, projectPath) => {
        setStatusState(text)
        setStatusProjectPath(String(projectPath || ''))
      }
      const [busy, setBusy] = React.useState(false)
      const [sourcePath, setSourcePath] = React.useState('')
      const [jobId, setJobId] = React.useState('')
      // Online (PLC) state. `online` mirrors the host's authoritative
      // authorization + session state; the page never decides on its own whether
      // an online action is allowed.
      const [onlineState, setOnlineState] = React.useState(null)
      const [onlineBusy, setOnlineBusy] = React.useState(false)
      // 正在执行哪个在线动作（按钮全灰 + 底部一行小字太不显眼，见顶部的待办徽标）。
      const [onlinePending, setOnlinePending] = React.useState('')
      const [onlineBusySeconds, setOnlineBusySeconds] = React.useState(0)
      // The poll interval must not fire while a long online action (a download can
      // take minutes) is in flight: the worker serves one command at a time, so a
      // status probe would queue behind it and time out, flipping the UI to
      // "未连接" in the middle of a successful transfer.
      const onlineBusyRef = React.useRef(false)
      // Target picker: opens from the online chip. The picker only ever writes to
      // the throwaway project copy the worker holds, never to the .project file.
      // 目标操作只有一个入口：底部「扫描设备」面板。所以这里不再有弹层开关状态。
      // （曾经的 onlineTargetOpen / openOnlineTargetPicker 随弹层一起删除。）
      // 目标是谁定的：'' = 用工程里配置的目标；'scan' = 本次扫描选中的设备；
      // 'manual' = 本次手动填的地址/IP。界面上必须写出来，否则"我登录/下载的是哪台
      // 设备"只能靠猜。这里只记"这一次会话里选的"；在线进程重启后由宿主把绑定过的
      // 目标回填进 ready.targetSource（见 openOnlineSession），所以「已绑定」不会
      // 因为进程空闲退出就凭空消失。
      const [onlineTargetSourceState, setOnlineTargetSource] = React.useState('')
      const [targetDraft, setTargetDraft] = React.useState({ gatewayName: '', gatewayGuid: '', address: '', ipAddress: '', port: '' })
      // IP 直连的输入框现在长在「扫描设备」面板里（不需要先扫描，填完直接用）。
      // 目标面板那边只剩"网关 + 节点地址"，不再有寻址方式开关 —— 两处入口会互相打架。
      const [ipDraft, setIpDraft] = React.useState({ ipAddress: '', port: '' })
      const [targetBusy, setTargetBusy] = React.useState(false)
      // CODESYS' own "scan network": the gateway discovers controllers and we list
      // them, so the operator picks a real device instead of typing an address.
      // 扫描结果放在底部面板里（和「编译输出」同一形态），不再用居中弹窗：扫描要等
      // 网关广播，用户应该能一边看计时一边看代码。
      const [scanBusy, setScanBusy] = React.useState(false)
      const [scanOpen, setScanOpen] = React.useState(false)
      const [scanReport, setScanReport] = React.useState(null)
      // 扫描期间每秒走一格：用户要看到"扫描了多久"，而不是一个不动的"正在扫描…"。
      const [scanSeconds, setScanSeconds] = React.useState(0)
      const [objects, setObjects] = React.useState([])
      const [selectedKey, setSelectedKey] = React.useState('')
      const [assistantText, setAssistantText] = React.useState('')
      const [proposal, setProposal] = React.useState(null)
      const [reviewAccepted, setReviewAccepted] = React.useState(false)
      const [requestSeq, setRequestSeq] = React.useState(0)
      const [activeProject, setActiveProject] = React.useState(null)
      const [writeAvailable, setWriteAvailable] = React.useState(false)
      const [writeBlockReason, setWriteBlockReason] = React.useState('尚未检测当前工程')
      const [editedDeclaration, setEditedDeclaration] = React.useState('')
      const [editedImplementation, setEditedImplementation] = React.useState('')
      const [changeStates, setChangeStates] = React.useState({})
      // T096: 每个对象的**编辑器草稿**（key 与 changeStates 完全相同）。修这个 bug 之前只有
      // `editedDeclaration` / `editedImplementation` 两份**全局**字符串，切换对象时被下一个
      // 对象的文本直接覆盖，而且没有任何地方保存过它 —— 于是"改了 A → 切到 B"就永久丢弃 A 的
      // 修改，可 changeStates 里的琥珀色徽章还在、effectiveChanges 里却没有它：界面说 N 处
      // 待写入，确认写入只写其中一部分，剩下的徽章永远不会消失。
      const [drafts, setDrafts] = React.useState({})
      const [collapsedKeys, setCollapsedKeys] = React.useState(() => new Set())
      const [treeFilter, setTreeFilter] = React.useState('all')
      const [showInternal, setShowInternal] = React.useState(false)
      const [detectFailure, setDetectFailure] = React.useState(null)
      const [busySeconds, setBusySeconds] = React.useState(0)
      // T166: 一次「探测到了另一个工程」的挂起记录。写入/构建期间探测不得重绑、不得清草稿，
      // 所以结果先挂在这里，等 busy 结束再按需应用（见下面 [busy] 的 effect）。
      const [rebindNotice, setRebindNotice] = React.useState(null)
      // T097: 独立的离线编译。`build`/`rebuild` 早就在 ScriptEngine 白名单里，而且**不是**
      // MUTATING —— 不需要 confirmed、不写盘、在隔离副本上编译，所以顶栏可以给它一颗自己的
      // 按钮；编译输出（payload.messages：CODESYS 消息 + 引擎从 stderr 归并的诊断）在这里
      // 落成一份可复制的报告。写入链路也会把同一次编译的消息喂进来看（见 applyProposal）。
      // （头部那颗开关收起的只是**整个面板**；面板里的明细自 T227 起永远全量平铺，不再折叠。）
      const [compileReport, setCompileReport] = React.useState(null)
      const [compileOpen, setCompileOpen] = React.useState(false)
      // T227（用户口径原文：「编译输出信息不要折叠形式的，改成全部展开」）：这里曾经有一个
      // `compileAllOpen` —— T225 的明细默认按唯一文本分组，靠一枚「展开查看全部 N 条」按钮
      // 才切到逐条原文。**整条折叠机制已删除**：明细现在永远全量平铺（每条消息各占一行、
      // 含 `[Info]` 行、重复的逐条列出、顺序与原始一致），所以不存在"展开态"这种状态。
      // 删掉的不只是这行 state：分组用的 `compileMessageGroups`、切换它的 `useEffect`、
      // 那枚按钮本身、以及 `.taskhive-codesys-compile-more` 的样式一起删（见下面两处）。
      // 展示层仍然不参与任何判定、不触发任何 IPC（MUTATING 仍然是 0）。
      // 本轮（写入行抽屉化）：用户口径原文「把「写入 · 等待 AI 改动」那一行改成抽屉式，
      // 只在需要时出现」。所以"这一行要不要出现"必须是一个**渲染派生值**，而"上一次写入
      // 到底成没成"必须被记住 —— `busy` 结束之后，失败那件事仍然要能点开看到原因。
      // 三个都是**展示层**状态：不参与任何闸门判断，不进写入 / 编译 / 冻结逻辑，
      // 也不触发任何 IPC（MUTATING 仍然是 0）。
      const [writePhase, setWritePhase] = React.useState('idle')
      const [writeFailureDetail, setWriteFailureDetail] = React.useState('')
      const [writeDrawerOpen, setWriteDrawerOpen] = React.useState(false)
      // Layout the user shapes by dragging: tree↔editor width and 声明↔实现 height.
      // T081: 默认给项目树更大的宽度份额（0.42 → 0.52）。用户拖过的比例仍然优先，
      // 只有从未拖动过时才用这个新默认值。
      const [treeFraction, setTreeFraction] = React.useState(() => readStoredFraction(CODESYS_LAYOUT_KEYS.tree, 0.52))
      const [declarationFraction, setDeclarationFraction] = React.useState(() => readStoredFraction(CODESYS_LAYOUT_KEYS.declaration, 0.38))
      const [dragging, setDragging] = React.useState('')
      // 本轮（冻结）删除 T216 的妥协：以前这里有一个 `focusedSection` —— "光标落在哪一段，
      // 那一段就回到原始排版，镜像层不画、textarea 的字重新可见"，理由是内联值会让镜像层
      // 的字符位置整体右移，而 textarea 的光标是按它自己的文字排布算的。
      // 现在**已登录就冻结编辑栏（只读）**，根本不存在"一边看值一边打字/点光标"的场景，
      // 那段让位逻辑与冻结语义直接冲突（它会让"代码 + 值"在光标进去时消失一半），所以连同
      // 状态、onFocus/onBlur 一起删除：开着在线值时，屏幕上永远同时是「代码 + 值」。
      const editorRowRef = React.useRef(null)
      const editorBodyRef = React.useRef(null)
      // The shape the user dragged is remembered across sessions.
      React.useEffect(() => { storeFraction(CODESYS_LAYOUT_KEYS.tree, treeFraction) }, [treeFraction])
      React.useEffect(() => { storeFraction(CODESYS_LAYOUT_KEYS.declaration, declarationFraction) }, [declarationFraction])
      // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：原来的
      // `const [inlineOnlineValues, setInlineOnlineValues] = React.useState(…)` 与它那条
      // 「把选择写回 localStorage」的 effect **整段删除**了（连同开关按钮、禁用逻辑、title
      // 说明，见 renderEditorSection 上方的 codePane）。
      // 现在"要不要读值、要不要画值"只有一个判据：**已经登录到应用**（`onlineLoggedIn`，
      // 由宿主回报的 state.isLoggedIn 决定）。所以：
      //   · 已登录 ⇒ 一直显示（不用点任何东西），读值沿用下面那段既有节拍；
      //   · 未登录 ⇒ 连读都不读、一个值都不画，编辑栏保持可编辑（退出登录立刻恢复）。
      // 键 `taskhive.codesys.onlineValues.inline` 已随开关删除，不再被任何代码读取。
      const [agentReloadAvailable, setAgentReloadAvailable] = React.useState(false)
      const [workbenchIntersecting, setWorkbenchVisible] = React.useState(true)
      const workbenchVisible = workbenchIntersecting && tabVisible
      const [proposalSource, setProposalSource] = React.useState('')
      const submitRef = React.useRef(null)
      // One gutter + one tint layer (and, this round, one inline value mirror) per editor
      // section (CODESYS numbers the declaration and the implementation independently).
      const declarationRefs = { gutter: React.useRef(null), highlight: React.useRef(null), inline: React.useRef(null) }
      const implementationRefs = { gutter: React.useRef(null), highlight: React.useRef(null), inline: React.useRef(null) }
      // 本轮 B 项（用户报障原文：「而且在线值是不是刷新一下导致根本没法正常看」）——
      // 值刷新**不许**把代码推来推去，也不许在用户正读的时候换掉画面。三样东西：
      //   · onlineValueSlotRef：变量名（小写）-> 它历史上见过的最宽值的字符数，**只增不减**。
      //     它算出的稳定槽宽就是值 span 的 min-width ⇒ 值一变，后面的代码一个像素都不动。
      //   · inlineLineCacheRef：`区|行号` -> { signature, element }。值没变的那一行直接返回
      //     上一次那个**同一个**元素对象（Object.is 相同）⇒ React 整行跳过、一个字符都不重画。
      //   · lastUserActivityRef：用户最后一次滚动/选中的时刻（毫秒）。读数时若还在
      //     CODESYS_ONLINE_VALUE_ACTIVITY_PAUSE_MS 之内，这个节拍直接跳过 —— 用户正在读、
      //     正在选的时候值不换；停下约 1 秒后自己恢复。节拍仍是既有的 1.5 s，**不新增定时器**。
      const onlineValueSlotRef = React.useRef(new Map())
      const inlineLineCacheRef = React.useRef(new Map())
      const lastUserActivityRef = React.useRef(0)
      const rootRef = React.useRef(null)
      const objectsRef = React.useRef([])
      const sessionIdRef = React.useRef('')
      const jobIdRef = React.useRef('')
      const sourcePathRef = React.useRef('')
      const boundPathRef = React.useRef('')
      const editedDeclarationRef = React.useRef('')
      const editedImplementationRef = React.useRef('')
      const consumedSeqRef = React.useRef(null)
      const appliedProposalIdsRef = React.useRef(new Set())
      const lastAppliedSignatureRef = React.useRef('')
      const changeStateRef = React.useRef(new Map())
      const draftsRef = React.useRef(new Map())
      const lastDetectAtRef = React.useRef(0)
      // T183 第 5 项：提案领取从"每 4 秒问一次宿主"改成事件驱动 + 低频兜底。
      //   · lastClaimAtRef = 上一次**真的发了 IPC** 的时刻（纯内存比较，不产生往返）；
      //   · CODESYS_CLAIM_FALLBACK_MS = 兜底间隔。心跳本身留着（契约钉住了它的字面量），
      //     但它绝大多数时候只做一次时间戳比较，不再去敲宿主。
      const lastClaimAtRef = React.useRef(0)
      const claimInFlightRef = React.useRef(false)
      // T167: 「本会话最后一次已知的工程文件 sha256」——写入前的未保存改动防线就是它。
      // 复用工程里既有的 sha256 机制，不另造一套：
      //   · bind-project 已经回报 baselineSha256（绑定那一刻的磁盘 sha）；
      //   · apply-and-build / rollback 已经回报 currentSha256（提交之后的磁盘 sha）；
      //   · `diff` 动作（非 MUTATING、不启动 ScriptEngine，只重算文件 sha）回报当前磁盘 sha。
      // 特意**不**用引擎侧 job.currentSha256：它在每个动作后都会被刷新（读一次工程就跟着变），
      // 所以它回答不了"自从我们上次写入之后，磁盘有没有被别人动过"。
      const lastWriteBaselineRef = React.useRef('')
      // T204: 读取侧的"已经播报过的磁盘 sha"水位线。
      // 与 lastWriteBaselineRef **必须分开**：那个是写入守卫的基线，推进它就等于
      // 允许用户拿旧的 objects 覆盖别人刚存下的内容（T167 的现场故障）。这里只用来
      // 避免同一件外部保存被反复播报。
      const lastObservedDiskShaRef = React.useRef('')
      // 本轮（用户报障原文：「残留到代码任务会自动加载到我新打开到程序里面」）：
      // **绑定身份**的第二半 —— 绑定那一刻的源 sha256（`bind-project` 回报的 `baselineSha256`）。
      // 它与上面两个 ref 都是**三件不同的事**，绝不能合并：
      //   · `lastWriteBaselineRef` 会被每次成功写入 / 回滚**推进**（写守卫要的是"我方最近写过的内容"）；
      //   · `lastObservedDiskShaRef` 是"已经播报过的磁盘 sha"水位线（T204）；
      //   · 这一份**只由绑定决定、之后一个字都不动**，所以它才是"这份待确认提案当初是给哪个
      //     工程、哪一版字节生成的"的答案。宿主的待领取提案队列按 sessionId 排队，只按会话
      //     判等就会让上一个工程的提案在新工程里被领走；领取时用 `(工程路径, 这个 sha)` 判等。
      const bindingShaRef = React.useRef('')
      // 一次只允许一次重读在飞：自调度定时器与 focus 事件会自然重叠。
      const sourceRecheckInFlightRef = React.useRef(false)
      // T204: 「磁盘上的工程被外部保存过吗」的检查间隔。
      // 判据是引擎既有的 `diff` 动作：不在 MUTATING_ACTIONS 里、不启动 ScriptEngine、
      // 不触碰 PLC/在线授权，只对 .project 重算一次 sha256（现场 0.63 MB 实测毫秒级）。
      // 30 秒与提案兜底领取（CODESYS_CLAIM_FALLBACK_MS）同档：既不是"连续监视"
      // （用户点名的 1.5 秒级），又能在"两块屏、用户盯着工作台不切窗口"时自愈。
      // 真正的即时路径是 focus / visibilitychange 事件，不是这颗定时器。
      const CODESYS_SOURCE_RECHECK_MS = 30000
      // 检测与刷新都要看"现在有没有待确认提案"（它是渲染派生值，异步回调里读不到）。
      const proposalRef = React.useRef(null)
      const publishTimerRef = React.useRef(null)
      const visibleRef = React.useRef(true)
      const probingRef = React.useRef(false)
      // T166: 「有冲突的工作正在进行」的同步判据 —— 一个计数器，不是布尔。
      //
      // 为什么不能用 `busy`：**探测自己**在非静默时也会 setBusy(true)（"正在识别当前
      // CODESYS 窗口…"）。如果守卫读 `busy`，那么探测在 await 之后总会看到自己被置起的
      // busy，于是①首次绑定会被永久挂起（还没有任何绑定可保护，却被自己挡住），
      // ②用户点「刷新」换到另一个工程时也会被自己挡住 —— 刷新就不刷新了。
      // 所以守卫只认**这些**操作：读取/绑定、写入+编译、离线编译、回退、AI 任务提交。
      // 用计数器而不是布尔：多个操作可能重叠（例如切换工程期间点编译），布尔会被先结束的
      // 那个提前清零。配对一律走 try/finally，异常路径也会归还。
      const conflictingWorkRef = React.useRef(0)
      const beginConflictingWork = () => {
        conflictingWorkRef.current += 1
        return () => { conflictingWorkRef.current = Math.max(0, conflictingWorkRef.current - 1) }
      }
      // T166: busy 期间探测到的「另一个工程」在这里挂起，等忙完再决定要不要换绑。
      const pendingDetectionRef = React.useRef(null)
      const waitingSinceRef = React.useRef(0)
      const pendingWorkbenchTaskRef = React.useRef(false)
      const loadedEditorRef = React.useRef({ key: '', declaration: '', implementation: '' })
      const emptySessionStore = React.useMemo(() => ({ subscribe: () => () => {}, getSnapshot: () => ({ current: '' }) }), [])
      const sessions = getOptionalService(ctx, 'sessions')
      const sessionStore = sessions?.list || emptySessionStore
      const sessionSubscribe = typeof sessionStore.subscribe === 'function' ? (listener) => sessionStore.subscribe(listener) : emptySessionStore.subscribe
      const sessionSnapshot = typeof sessionStore.getSnapshot === 'function' ? () => sessionStore.getSnapshot() : emptySessionStore.getSnapshot
      const sessionList = typeof React.useSyncExternalStore === 'function'
        ? React.useSyncExternalStore(sessionSubscribe, sessionSnapshot, sessionSnapshot)
        : sessionSnapshot()
      // Retained rightbar tabs belong to their original session, even in the background.
      const sessionId = String(ownerSessionId ?? sessionList?.current ?? '')
      const binding = sessionId ? sessions?.binding?.(sessionId) : null
      const [conversation, setConversation] = React.useState(() => binding?.session?.getSnapshot?.() || null)
      // T182：`conversation` 现在只是**第三条路（老形状）的输入 + 会话换绑的信号**。DSH 0.2 的 Session
      // 快照里没有 nodes（见文件开头 T182 段），消息要订阅 chat 视图才收得到：
      //   * 老形状仍然照旧订阅 Session 快照 —— 向前兼容那一份不能少；
      //   * chat 视图自己也订阅一次：这一条才是"助手刚写完一条消息"真正的事件源。订阅动作顺带
      //     `activate(target)`（同 T182 段的说明），所以哪怕没有监听器可挂，也要先订阅一次把视图物化，
      //     然后靠 chatRevision 触发一次重读 —— 否则 DSH 0.2 下要等别的东西激活视图才可能取到消息。
      const [chatRevision, setChatRevision] = React.useState(0)
      React.useEffect(() => {
        const nextBinding = sessionId ? sessions?.binding?.(sessionId) : null
        setConversation(nextBinding?.session?.getSnapshot?.() || null)
        return nextBinding?.session?.subscribe?.(() => setConversation(nextBinding.session.getSnapshot())) || (() => {})
      }, [ctx, sessionId])
      React.useEffect(() => {
        setChatRevision((value) => value + 1)
        const source = codesysWorkbenchChatSource(ctx, sessionId)
        if (!source || typeof source.subscribe !== 'function') return undefined
        let off = null
        try { off = source.subscribe(() => setChatRevision((value) => value + 1)) } catch { off = null }
        return () => { if (typeof off === 'function') { try { off() } catch { /* 退订失败不影响读取 */ } } }
      }, [ctx, sessionId])
      // Latest-value mirrors for the async callbacks (detection, publishing and
      // the proposal watcher all outlive one React render).
      objectsRef.current = objects
      jobIdRef.current = jobId
      sessionIdRef.current = sessionId
      sourcePathRef.current = sourcePath
      editedDeclarationRef.current = editedDeclaration
      editedImplementationRef.current = editedImplementation
      proposalRef.current = proposal
      visibleRef.current = workbenchVisible
      React.useEffect(() => {
        // The conversation is the shared channel with the model. Any assistant
        // message in this session that carries a structured CODESYS proposal
        // becomes the pending diff here, whether the user typed the request in
        // the chat or in the workbench composer. Messages that existed before
        // the workbench opened are never replayed.
        //
        // T182：消息**不再**从 `conversation.nodes` 直读（DSH 0.2 下它恒为空，见文件开头 T182 段），
        // 而是走 shard 78 同一套三路取法：① hooks.chat → ② uiConversation target('chat') → ③ 老形状
        // nodes；角色名（user / steering / assistant / assistant-step）与块名（kind / type）都两种都认。
        // `chatRevision` 是 chat 视图的订阅回执：助手写一条新消息 → 视图通知 → 这里重读 → 提案落地。
        if (!conversation && !sessionId) return
        const messages = codesysWorkbenchSessionMessages(ctx, sessionId, conversation).messages
        const assistantMessages = messages.filter((message) => message.role === 'assistant')
        const maxSeq = assistantMessages.reduce((max, message) => Math.max(max, Number(message.seq || 0)), 0)
        if (consumedSeqRef.current === null) { consumedSeqRef.current = maxSeq; return }
        const fresh = assistantMessages.filter((message) => Number(message.seq || 0) > Number(consumedSeqRef.current)).sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
        if (!fresh.length) return
        consumedSeqRef.current = maxSeq
        for (const message of fresh) {
          const text = message.text
          if (!text || !jobIdRef.current) continue
          const parsed = parseCodesysProposal(text)
          if (!parsed) continue
          const source = pendingWorkbenchTaskRef.current ? 'workbench' : 'chat'
          pendingWorkbenchTaskRef.current = false
          applyAgentProposalRef.current?.(parsed, text, source)
        }
        void claimPendingProposalRef.current?.({ force: true })
      }, [conversation, chatRevision])
      const setWriteAvailability = (value) => {
        const available = value?.writeAvailable !== false
        const reason = available ? '' : (value?.writeBlockReason || '当前工程暂不可跨进程写入')
        // Only touch state when the value really changed: a silent poll that
        // re-reports the same project must not re-render (and must never clear a
        // pending diff the user is reviewing).
        setWriteAvailable((current) => (current === available ? current : available))
        setWriteBlockReason((current) => (current === reason ? current : reason))
      }
      const setObjectChangeState = (keys, state) => {
        const next = new Map(changeStateRef.current)
        for (const key of keys) { if (!key) continue; if (state) next.set(key, state); else next.delete(key) }
        changeStateRef.current = next
        setChangeStates(Object.fromEntries(next))
      }
      // T096: 草稿的 key 必须与 changeStates 用**同一个表达式**，否则徽章与草稿会错位。
      // GUID 优先 ⇒ 读取刷新之后 key 依然稳定。
      const draftKeyOf = (item) => (item ? (item.__pendingKey || codesysObjectKey(item)) : '')
      const setObjectDraft = (key, declaration, implementation) => {
        if (!key) return
        const next = new Map(draftsRef.current)
        next.set(key, { declaration: String(declaration ?? ''), implementation: String(implementation ?? '') })
        draftsRef.current = next
        setDrafts(Object.fromEntries(next))
      }
      const clearObjectDrafts = (keys) => {
        const next = new Map(draftsRef.current)
        let changed = false
        for (const key of keys || []) { if (key && next.delete(key)) changed = true }
        if (!changed) return
        draftsRef.current = next
        setDrafts(Object.fromEntries(next))
      }
      const clearAllObjectDrafts = () => { draftsRef.current = new Map(); setDrafts({}) }
      // T166: 「有多少处未写入的修改」的**唯一**判据，用于"绝不无声丢弃草稿"的守卫与提示。
      // 必须同时算上两处，缺一个就会漏报：
      //   · draftsRef —— 切走别的对象时存下来的草稿；
      //   · 当前编辑器里**还没切走过**的这段文本（它只在切换时才进 draftsRef）。
      const countUnsavedDrafts = () => {
        const keys = new Set(draftsRef.current.keys())
        const editorKey = loadedEditorRef.current.key
        const typed = editedDeclarationRef.current !== loadedEditorRef.current.declaration
          || editedImplementationRef.current !== loadedEditorRef.current.implementation
        if (editorKey && typed) keys.add(editorKey)
        return keys.size
      }
      const proposalKeys = (changes, proposalValue) => (changes || []).map((change) => {
        const operation = codesysProposalOperation(change, objectsRef.current, proposalValue)
        const target = resolveCodesysProposalObject(change, objectsRef.current)
        return target ? codesysObjectKey(target) : `pending:${operation}:${String(change?.objectName || '').toLowerCase()}`
      })
      const applyAgentProposal = (parsed, text, source) => {
        const changes = Array.isArray(parsed?.changes) ? parsed.changes : []
        // The same diff can arrive twice (queued by the tool AND repeated in the
        // reply); applying it once avoids a visible double reset of the review
        // checkbox and the editor.
        const signature = String(codesysHash(JSON.stringify(changes)))
        if (changes.length && signature === lastAppliedSignatureRef.current) return false
        lastAppliedSignatureRef.current = signature
        const errors = validateCodesysProposal(parsed, objectsRef.current)
        setAssistantText(String(text || '').slice(0, 4000))
        setProposal(parsed)
        setProposalSource(source === 'workbench' ? 'workbench' : 'chat')
        setReviewAccepted(false)
        setAgentReloadAvailable(false)
        if (changes.length) setObjectChangeState(proposalKeys(changes, parsed), 'agent')
        setStatus(errors.length
          ? `已生成 ${changes.length} 处修改，但当前提案不可写入：${errors[0]}`
          : `${source === 'workbench' ? '代码任务' : '对话'}已生成 ${changes.length} 处代码修改：已在项目树和编辑器中高亮，逐项审查后确认写入。`)
        return true
      }
      const applyAgentProposalRef = React.useRef(null)
      applyAgentProposalRef.current = applyAgentProposal
      const claimPendingProposal = async (options = {}) => {
        const activeSession = sessionIdRef.current
        if (!activeSession) return
        // 两处节流（都是**纯内存**判断，一次网络往返都不产生）：
        //   · force（事件驱动：新消息落地、用户回到界面、刚绑定工程）立刻发；
        //   · 不带 force 的（4 秒心跳）只有距上次真的发过 IPC 超过兜底间隔才发。
        const now = Date.now()
        if (options.force !== true && now - lastClaimAtRef.current < CODESYS_CLAIM_FALLBACK_MS) return
        // 同一时刻只允许一个在途请求：迟到的回包会把已经消费掉的提案再放一遍。
        if (claimInFlightRef.current) return
        lastClaimAtRef.current = now
        claimInFlightRef.current = true
        try {
          const value = await codesysWorkbenchApi('pending', { sessionId: activeSession, consume: true })
          const items = Array.isArray(value?.proposals) ? value.proposals : []
          // 本轮（用户报障原文：「残留到代码任务会自动加载到我新打开到程序里面」）：
          // 宿主的待领取队列**只按 sessionId 排队**，所以上一个工程留下的待确认提案会在用户新
          // 打开另一个工程、工作台刚绑上时（`bindSourceProject` 的事件式领取）被一起领走 ——
          // 它于是被画在新工程头上。判据必须是**工程身份**：`(工程路径, 绑定源 sha256)` 两个都
          // 得对上（空值不判，见下）。对不上的那份**不显示**，并且**写一行**说清它为什么不再
          // 适用 —— 绝不静默丢掉、也绝不把它当成新工程的提案。同一批只说一次（它是解释，不是常驻提示）。
          const currentProjectPath = normalizeCodesysPath(boundPathRef.current || sourcePathRef.current || '')
          const currentBindingSha = String(bindingShaRef.current || '')
          let staleProjectProposals = 0
          let unboundProposals = 0
          for (const item of items) {
            const id = String(item?.id || '')
            if (!id || appliedProposalIdsRef.current.has(id)) continue
            appliedProposalIdsRef.current.add(id)
            // 工作台**还没有绑定任何工程**时，任何待确认提案都无处可放：它的 sha 防护、编辑器退回、
            // 写入闸门全都以 jobId 为前提。真机上这条确实会走到 —— 挂载/回到界面时的那次事件式
            // 领取排在 `detect → bind → inspect` **之前**（真机与驱动都实测到这一顺序），所以
            // 上一个工程留下的提案会先落进一个还没有工程的编辑器，随后绑定清掉了提案状态却**不会**
            // 把用户眼前那段 AI 代码收回磁盘版本。判据直接用 `jobIdRef`（异步回调里读渲染值一直都是
            // 走 ref 的那个写法）。
            if (!jobIdRef.current) { unboundProposals += 1; continue }
            // 空值一律不判：老宿主不发这两个字段，或工作台还没拿到绑定 sha —— 那时保持既有行为
            // （按会话判等就显示），绝不因为"身份未知"而把用户真正在等的提案吞掉。
            const itemProjectPath = normalizeCodesysPath(item?.projectPath || '')
            const itemSourceSha = String(item?.sourceSha256 || '')
            const differentProject = Boolean(itemProjectPath && currentProjectPath && itemProjectPath !== currentProjectPath)
            const differentSource = Boolean(itemSourceSha && currentBindingSha && itemSourceSha !== currentBindingSha)
            if (differentProject || differentSource) { staleProjectProposals += 1; continue }
            applyAgentProposalRef.current?.(item.proposal || item, String(item.note || ''), 'chat')
          }
          if (staleProjectProposals > 0) {
            setStatus('已切换工程，此前的提案不再适用；如需继续请让 AI 重新生成')
          } else if (unboundProposals > 0) {
            setStatus('工作台还没有绑定工程，此前的提案不再适用；如需继续请让 AI 重新生成')
          }
        } finally {
          claimInFlightRef.current = false
        }
      }
      const claimPendingProposalRef = React.useRef(null)
      claimPendingProposalRef.current = claimPendingProposal
      const publishCodesysState = (payload) => {
        const activeSession = String(payload?.sessionId || sessionIdRef.current || '')
        if (!activeSession) return
        const state = { ...payload, sessionId: activeSession, updatedAt: new Date().toISOString() }
        if (visibleRef.current || codesysStateKeepAlive.sessionId === activeSession) {
          publishCodesysWorkbenchMirror(state)
          // T089: 记住这份状态并确保续期心跳已启动。心跳原样重发它，所以 updatedAt
          // 不会被续期动作刷新成"刚刚观测过"。
          codesysStateKeepAlive.state = state
          codesysStateKeepAlive.sessionId = activeSession
          scheduleCodesysStateKeepAlive()
        }
        if (publishTimerRef.current) clearTimeout(publishTimerRef.current)
        publishTimerRef.current = setTimeout(() => {
          publishTimerRef.current = null
          void sendCodesysState(activeSession, state)
        }, CODESYS_PUBLISH_GAP_MS)
      }
      const publishCodesysStateRef = React.useRef(null)
      publishCodesysStateRef.current = publishCodesysState
      // T088 / KNOWN-ISSUES #8: 工程快照的发送状态不在组件里，而在插件层的 codesysStateKeepAlive
      // （publishedSignature / pendingSnapshot）。"已送达"只能由宿主的确认来推进，
      // 而且必须与 5 分钟续期心跳共享同一份判断，因此不能放在组件 ref 里。
      const run = async (action, input = {}) => {
        const result = await window.taskhive?.runCodesysScriptEngineAction?.(action, input)
        return result
      }
      // Shared by inspect() AND by the composite write (`apply-and-build`), which
      // returns this same payload shape from its own CODESYS process. Strict on
      // purpose: an incomplete tree is refused instead of quietly building a partial
      // context. Callers that must not fail after a successful write check
      // `complete/textTruncated` themselves before calling this.
      const applyInspectionPayload = (result) => {
        const nextObjects = result?.payload?.objects || []
        if (result?.payload?.complete !== true || result?.payload?.textTruncated !== false) throw new Error('ScriptEngine 未返回完整工程代码，已拒绝创建不完整上下文')
        // Report WHERE the wait went: the engine measures the in-process phases,
        // the evidence measures the process, and a cached read explains itself.
        const cached = result?.artifacts?.cached === true
        const cacheSource = String(result?.artifacts?.cacheSource || (cached ? 'memory' : ''))
        const payloadMs = Number(result?.payload?.timings?.totalMs) || 0
        const processMs = Number(result?.timings?.scriptEngineProcess) || 0
        const wait = cached
          ? ` · 已使用缓存${cacheSource === 'disk' ? '（跳过 ScriptEngine 启动）' : ''}`
          : (processMs ? ` · 读取耗时 ${(processMs / 1000).toFixed(1)} 秒（其中工程树 ${(payloadMs / 1000).toFixed(1)} 秒）` : '')
        const warning = result?.warnings?.length ? ` · 注意：${String(result.warnings[0]?.message || '').slice(0, 160)}` : ''
        const elapsed = result?.status === 'verified-with-process-warning' ? ' · CODESYS 进程被结束但结果完整' : ''
        setObjects(nextObjects)
        // T096: 读取刷新之后丢掉"对象已不存在"的草稿（GUID 未变则保留，key 是 GUID）。
        const liveObjectKeys = new Set(nextObjects.map((item) => codesysObjectKey(item)))
        const staleDraftKeys = [...draftsRef.current.keys()].filter((key) => !key.startsWith('pending:') && !liveObjectKeys.has(key))
        if (staleDraftKeys.length) clearObjectDrafts(staleDraftKeys)
        setSelectedKey((current) => nextObjects.some((item) => codesysObjectKey(item) === current) ? current : codesysObjectKey(nextObjects.find((item) => item.hasDeclaration || item.hasImplementation) || nextObjects[0] || {}))
        return { result, nextObjects, waitSuffix: `${wait}${elapsed}${warning}` }
      }
      const inspect = async (activeJob = jobId) => applyInspectionPayload(await run('inspect-project', { jobId: activeJob }))
      const bindSourceProject = async (projectPath, detectedProject = null) => {
        const endConflictingWork = beginConflictingWork()
        try {
          // Binding is a project switch, and the online authorization names one
          // project file: drop it before the new binding takes effect so a stale
          // grant can never point at the previous device.
          void window.taskhive?.disarmCodesysOnline?.({ reason: 'project-rebound' })
          // T208: name the project for the WHOLE bind, not only after it. `bind-project` below is
          // the tens-of-seconds half (it starts the ScriptEngine) and it is the line the user
          // actually watches, so a generic "所选 .project 工程文件" said nothing about WHICH project
          // was being bound. The name is always the real basename of the path being bound; when no
          // path is available the sentence stays generic rather than inventing one.
          const bindingPath = String(projectPath || '')
          const bindingName = codesysBaseName(bindingPath)
          setStatusWithProject(
            bindingName ? `正在绑定 ${bindingName}；不会连接 PLC…` : '正在绑定所选 .project 工程文件；不会连接 PLC…',
            bindingPath,
          )
          const bound = await run('bind-project', { sourcePath: projectPath, activeProject: detectedProject })
          const boundFullPath = String(bound?.sourcePath || projectPath || '')
          const boundName = codesysBaseName(boundFullPath)
          const boundLabel = boundName ? `已绑定 ${boundName}` : '已绑定工程'
          boundPathRef.current = boundFullPath
          // 本轮：jobId 也**同步**落到 ref 上。`bindSourceProject` 末尾那次事件式领取（就是用户
          // 新打开另一个程序时走的那条）就在几行之后，而 `jobIdRef` 平时是在渲染里从 `jobId` 状态
          // 跟过来的 —— 领取的回包完全可能先于那一次渲染落地，于是"已经绑好了"这件事在判据里还是
          // 空的（驱动与真机都实测到这一顺序）。绑定这一侧是权威：绑定成功的那一刻就写进 ref，
          // 后面每次渲染仍会把同一个值再写一遍（幂等）。
          // T167: 绑定即建立"本次会话的写入基线"。之后每次成功写入/回滚都会推进它。
          lastWriteBaselineRef.current = String(bound?.baselineSha256 || bound?.currentSha256 || '')
          // 本轮：**绑定身份**（只由绑定决定，写入不推进它）。
          bindingShaRef.current = String(bound?.baselineSha256 || bound?.currentSha256 || '')
          jobIdRef.current = String(bound?.jobId || '')
          setSourcePath(bound.sourcePath); setJobId(bound.jobId); setActiveProject(detectedProject); setWriteAvailability(bound)
          setProposal(null); setProposalSource(''); setAssistantText(''); setReviewAccepted(false)
          setObjectChangeState([...changeStateRef.current.keys()], '')
          // T183 第 4 项：换绑工程 ⇒ 上一个作业的后台编译结果与当前界面无关，停表。
          stopDeferredBuildWatch()
          // T096: 换了工程，旧对象 key 上的草稿全部失效。
          clearAllObjectDrafts()
          // A new project binding starts a new review cycle: re-arm the
          // conversation watermark so history is never replayed as a fresh diff.
          consumedSeqRef.current = null
          setStatusWithProject(`${boundLabel} · 正在读取工程树…（首次读取需启动 CODESYS ScriptEngine，通常 20–40 秒，请保持工作台打开；同一工程再次读取会使用缓存）`, boundFullPath)
          const loaded = await inspect(bound.jobId)
          const prefix = detectedProject?.activeGui
            ? (boundName ? `已自动绑定当前打开工程 ${boundName}` : '已自动绑定当前打开工程')
            : boundLabel
          const readMode = detectedProject?.activeGui ? '；已通过内部只读快照读取当前保存版本' : ''
          const writeState = bound.writeAvailable === false ? `；暂不可直接写入：${bound.writeBlockReason || '当前 GUI 未建立进程内写入桥'}` : '；写入前自动创建恢复快照'
          setStatusWithProject(`${prefix} · 已完整读取 ${loaded.nextObjects.length} 个工程对象（无文本截断）${readMode}${writeState}${loaded.waitSuffix || ''}${sessionIdRef.current ? ' · 已与当前对话联动' : ''}`, boundFullPath)
          // 刚绑定/刚读完 = 事件，不是心跳：立刻领取一次，不等兜底间隔。
          void claimPendingProposalRef.current?.({ force: true })
          return bound
        } finally { endConflictingWork() }
      }
      const detectCurrentProject = async (rawOptions = {}) => {
        // Called with explicit options, or straight from onClick with a React
        // event (which must not be mistaken for options).
        const options = rawOptions && typeof rawOptions === 'object' && !rawOptions.nativeEvent ? rawOptions : {}
        const { silent = false, force = false } = options
        // An in-flight probe guard that does not depend on a React state update
        // landing first: a silent recheck must never start a second PowerShell
        // enumeration while the first one is still running. An explicit refresh
        // is a user decision and may queue behind it.
        if (probingRef.current && !force) return
        const now = Date.now()
        // Background re-detection is throttled and event-driven; the explicit
        // "刷新当前工程" button always forces a fresh probe.
        if (!force && now - lastDetectAtRef.current < CODESYS_DETECT_MIN_GAP_MS) return
        lastDetectAtRef.current = now
        probingRef.current = true
        // T166: `busy` 是**布尔**，不是计数器 —— 所以真正出问题的是**清除**它的那一侧：
        // 一个非静默探测的 finally 会把"正在写入/构建"的 busy 一并清掉，于是 115 秒的写入
        // 中途界面看起来空闲、写入按钮重新可点（读一次工程约 2 秒、写入约 115 秒，两者重叠
        // 是常态）。修法只针对清除侧：
        //   · `setBusy(true)` 在别处已经持有 busy 时是**幂等**的（值没变，不会重渲染、不会
        //     闪烁），所以置起那一侧保持原样即可 —— 契约也正是靠这行字面量钉住"后台探测
        //     永不切换 busy"（silent 时这一整行都不执行）。
        //   · 只有**没有别的冲突工作**时，探测才拥有 busy 的开关权；有冲突工作时由那个操作
        //     自己负责收尾。（冲突操作之间本来就互斥：它们开头都有 `if (busy …) return`。）
        const ownsBusy = !silent && conflictingWorkRef.current === 0
        if (!silent) { setBusy(true); setStatus('正在识别当前 CODESYS 窗口和已打开工程…') }
        try {
          const detected = await window.taskhive?.currentCodesysProject?.({ force: force === true })
          if (!detected?.found || !detected?.sourcePath) {
            // Do not erase a verified binding on one transient probe miss: the
            // desktop host retains a plugin-owned process cache while a
            // native-hosted HWND is hidden during surface switching.
            if (jobIdRef.current && sourcePathRef.current) {
              if (!silent) setStatus('本次未识别到当前 CODESYS 工程；已保留先前绑定的工程，可稍后点「刷新」。')
              return
            }
            setActiveProject(null); setWriteAvailability({ writeAvailable: false, writeBlockReason: '未检测到当前打开并保存的 .project 工程' })
            waitingSinceRef.current = waitingSinceRef.current || Date.now()
            setDetectFailure({ detection: String(detected?.detection || ''), candidates: detected?.candidates || [], openProjects: detected?.openProjects || [], scope: detected?.scope || null })
            setStatus(`没有自动识别到唯一的 .project 工程（${String(detected?.detection || '未找到')}）：请用「当前工程」一行的『刷新』或『选择工程』。`)
            return
          }
          setDetectFailure(null)
          waitingSinceRef.current = 0
          // Same project: refresh identity/write permission only. Re-reading the
          // whole project tree here was the source of the 15-second "refresh":
          // it wiped the pending diff and the editor content mid-edit.
          const sameProject = jobIdRef.current && normalizeCodesysPath(detected.sourcePath) === normalizeCodesysPath(boundPathRef.current || sourcePathRef.current)
          if (sameProject) {
            setActiveProject((current) => (current?.sourcePath === detected.sourcePath && current?.writeAvailable === detected.writeAvailable ? current : detected))
            setWriteAvailability(detected)
            // A user-triggered refresh must still read as a completed read (and
            // must report the same wording the first bind used); a background
            // probe stays completely silent.
            //
            // T204: 「刷新」是用户显式问的一句"磁盘上的工程变了吗？"，必须**真的答一次**。
            // 以前这一支只报一句"已完整读取 N 个工程对象（无文本截断）"，却一次都没读 ——
            // 源 sha 变了也照报，这正是本轮的报障。现在同工程也走一次既有的 sha 判据：
            // 变了 ⇒ recheckSourceOnDisk 重读并自己写那一行；没变 ⇒ 下面这句才成立。
            const refreshed = force === true && await recheckSourceOnDiskRef.current?.({ explicit: true }) === true
            if (!silent && !refreshed) setStatus(`已确认磁盘上的工程未变化（sha256 比对） · 当前 ${objectsRef.current.length} 个工程对象（无文本截断） · 已跟随当前工程 ${codesysBaseName(detected.sourcePath)} · 工程对象与待确认差异保持不变`)
            return
          }
          // T166: 探测到了**另一个**工程 —— 这才是危险的那一步。
          //
          // 绑定一个别的工程 = 清空待确认差异 + `clearAllObjectDrafts()`，也就是把用户正在
          // 编辑的草稿整片丢掉。旧代码在这里无条件 `await bindSourceProject(...)`，于是：
          //   · 写入/构建期间（一次 115 秒）任何一次后台探测都能把工作台换到另一个工程，
          //     写入还在往旧 jobId 上落盘，界面却已经变成新工程的空树；
          //   · 用户手打的草稿在被清掉时没有任何提示。
          //
          // 现在的规则：**busy 期间一次都不重绑、不清草稿**，探测结果先挂起；只要有未写入
          // 的草稿，换绑也不再是自动的，而是显式提示 + 由用户决定。
          const unsavedDraftCount = countUnsavedDrafts()
          const hasBinding = Boolean(jobIdRef.current)
          const conflicting = conflictingWorkRef.current > 0
          if (hasBinding && (conflicting || unsavedDraftCount > 0)) {
            pendingDetectionRef.current = { detected, unsavedDraftCount, at: Date.now() }
            if (conflicting) {
              if (!silent) setStatus(`检测到另一个 CODESYS 工程（${codesysBaseName(detected.sourcePath)}），但工作台正在读取/写入/构建：已挂起这次换绑，未清除任何草稿。`)
            } else {
              setRebindNotice({ detected, unsavedDraftCount })
              setStatus(`检测到另一个 CODESYS 工程（${codesysBaseName(detected.sourcePath)}）· 当前有 ${unsavedDraftCount} 处未写入修改：草稿已保留，未自动换绑；请在提示里选择「切换」或「保留当前工程」。`)
            }
            return
          }
          await bindSourceProject(detected.sourcePath, detected)
        } catch (error) { setStatus(`当前工程自动绑定失败：${codesysScriptEngineErrorMessage(error)}`) } finally { probingRef.current = false; if (ownsBusy) setBusy(false) }
      }
      const detectCurrentProjectRef = React.useRef(detectCurrentProject)
      detectCurrentProjectRef.current = detectCurrentProject
      // T166: busy 结束之后再处理挂起的那次探测 —— 这是"探测结果先挂起，等 busy 结束再按需
      // 应用"的落地处。三条路径都在这里收口：
      //   · 没有挂起结果（无探测/结果已被处理）→ 什么都不做；
      //   · 挂起的结果与当前绑定**相同** → 只刷新身份与写入权限，不换绑、不动草稿；
      //   · 挂起的结果与当前绑定**不同** → 保留草稿，把它变成一条可见提示，由用户决定。
      // 这里绝不调用 bindSourceProject：只有用户点「切换」才会换绑。
      React.useEffect(() => {
        if (busy) return
        const pending = pendingDetectionRef.current
        if (!pending) return
        pendingDetectionRef.current = null
        const detected = pending.detected
        const sameProject = jobIdRef.current && normalizeCodesysPath(detected?.sourcePath) === normalizeCodesysPath(boundPathRef.current || sourcePathRef.current)
        if (sameProject) {
          setActiveProject((current) => (current?.sourcePath === detected.sourcePath && current?.writeAvailable === detected.writeAvailable ? current : detected))
          setWriteAvailability(detected)
          setStatus(`已跟随当前工程 ${codesysBaseName(detected.sourcePath)} · 工程对象与待确认差异保持不变`)
          return
        }
        setRebindNotice({ detected, unsavedDraftCount: countUnsavedDrafts() })
        setStatus(`检测到另一个 CODESYS 工程（${codesysBaseName(detected?.sourcePath || '')}）· 草稿已保留，未自动换绑；请在工具条下方的提示里选择「切换」或「保留当前工程」。`)
      }, [busy])
      React.useEffect(() => {
        // The desktop notifies the workbench when the CODESYS panel switches its
        // monitored window; only that window is ever followed.
        if (!tabVisible) return undefined
        const detect = (options) => detectCurrentProjectRef.current?.(options)
        codesysWorkbenchControl.detect = detect
        return () => { if (codesysWorkbenchControl.detect === detect) codesysWorkbenchControl.detect = null }
      }, [tabVisible])
      React.useEffect(() => {
        if (tabVisible) {
          void detectCurrentProjectRef.current({ force: true })
          // 切到 CODESYS 界面 = 用户正在看结果，这时候该把队列里的提案取回来。
          void claimPendingProposalRef.current?.({ force: true })
        }
        // Re-detect when the user comes back to the window or switches to the
        // CODESYS surface — that is when the answer can actually have changed,
        // so no timer needs to run in the background.
        //
        // T183 第 5 项：这两个事件同时是"领取待处理提案"的事件源 —— 它们成对出现的
        // 语义就是"用户回来了，把结果给我"。与重检测共用同一对监听器，不额外挂监听。
        const recheck = () => {
          if (document.visibilityState === 'visible' && visibleRef.current) {
            void detectCurrentProjectRef.current({ silent: true })
            // T204：回到窗口/切回本界面，是"用户刚从 CODESYS 那边回来"最强的信号 ——
            // 顺手问一次磁盘变没变（一次 sha256 比对），变了就重读。
            // 复用这对既有监听器，**不新增监听器**（与 T183 第 5 项同一条纪律）。
            void recheckSourceOnDiskRef.current?.()
            void claimPendingProposalRef.current?.({ force: true })
            // T183 第 4 项：被"页面切走"暂停的延迟编译轮询在这里续上 —— 共用同一个事件源，
            // 不新增监听器（它在不可见时连定时器都不留）。
            deferredBuildPollRef.current?.()
          }
        }
        window.addEventListener('focus', recheck)
        document.addEventListener('visibilitychange', recheck)
        return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck) }
      }, [sessionId, tabVisible])
      React.useEffect(() => {
        const node = rootRef.current
        if (!node || typeof IntersectionObserver !== 'function') return undefined
        // Only a workbench the user can actually see keeps a background timer
        // alive; a hidden tab (or a closed right panel) costs nothing.
        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) setWorkbenchVisible(Boolean(entry.isIntersecting) && entry.intersectionRatio > 0)
        }, { threshold: [0, 0.01] })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])
      React.useEffect(() => {
        if (!busy) { setBusySeconds(0); return undefined }
        const startedAt = Date.now()
        setBusySeconds(0)
        // Reading a project launches the CODESYS ScriptEngine (measured ~32 s on
        // a real 66-object project). A plain elapsed counter is the difference
        // between "it is working" and "it is frozen" — it only renders, it never
        // probes anything.
        const timer = setInterval(() => setBusySeconds(Math.round((Date.now() - startedAt) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [busy])
      // 扫描计时：同样只渲染、不探测。每一轮（缓存 / 实时）重置，所以"已用 N 秒"
      // 说的永远是**当前这一轮**等了多久。
      React.useEffect(() => {
        if (!scanBusy) { setScanSeconds(0); return undefined }
        const startedAt = Number(scanReport?.startedAt) || Date.now()
        setScanSeconds(Math.round((Date.now() - startedAt) / 1000))
        const timer = setInterval(() => setScanSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [scanBusy, scanReport?.startedAt])
      // 在线动作计时：登录要等 20–40 秒，必须让操作者看到"还在走"而不是卡住。
      React.useEffect(() => {
        if (!onlineBusy) { setOnlineBusySeconds(0); return undefined }
        const startedAt = Date.now()
        setOnlineBusySeconds(0)
        const timer = setInterval(() => setOnlineBusySeconds(Math.round((Date.now() - startedAt) / 1000)), 1000)
        return () => clearInterval(timer)
      }, [onlineBusy])
      React.useEffect(() => {
        // Claim queued proposals while the workbench is on screen: delivery must
        // not wait for the end of the turn that submitted them.
        //
        // T183 第 5 项：**主路径已经换成事件驱动**（见下面 chat 视图订阅 / 会话订阅 /
        // focus·visibilitychange 三处 `{ force: true }`），这颗 4 秒心跳退化成兜底：
        // 它只在内存里比一次时间戳，真的发 IPC 要等距上次超过 CODESYS_CLAIM_FALLBACK_MS。
        // 心跳**故意不删**：事件源万一没接上（宿主旧版本、视图没物化），提案仍然会在
        // 30 秒内被取走，而不是永久卡在队列里。契约 codesys-workbench-link-contract.js
        // 钉住的 `}, CODESYS_CLAIM_POLL_MS)` 字面量因此原样保留，断言强度不变。
        if (!sessionId || !workbenchVisible) return undefined
        void claimPendingProposalRef.current?.({ force: true })
        const timer = setInterval(() => {
          if (document.visibilityState !== 'visible' || !visibleRef.current) return
          void claimPendingProposalRef.current?.()
        }, CODESYS_CLAIM_POLL_MS)
        return () => clearInterval(timer)
      }, [sessionId, workbenchVisible])
      React.useEffect(() => {
        if (!visibleRef.current) return undefined
        // Self-scheduling silent re-detection. While nothing is bound yet the
        // user is waiting for the plugin's own CODESYS to have a project, so the
        // cadence is short (throttled by CODESYS_DETECT_MIN_GAP_MS); once bound —
        // or after the give-up window — only the rare fallback remains. It never
        // touches `busy` or the status line.
        let cancelled = false
        let timer = null
        const schedule = () => {
          if (cancelled) return
          const waiting = !jobIdRef.current && waitingSinceRef.current > 0 && Date.now() - waitingSinceRef.current < CODESYS_WAIT_GIVE_UP_MS
          timer = setTimeout(() => {
            if (cancelled) return
            if (document.visibilityState === 'visible' && visibleRef.current) void detectCurrentProjectRef.current({ silent: true })
            schedule()
          }, waiting ? CODESYS_WAIT_DETECT_MS : CODESYS_FALLBACK_DETECT_MS)
        }
        schedule()
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
      }, [sessionId, workbenchVisible])
      React.useEffect(() => {
        // T204: 「磁盘上的工程被外部保存过吗」的**低频兜底**检查。
        // 即时路径是 focus / visibilitychange（见上面的 recheck）；这一颗是给"用户盯着
        // 工作台、根本不切窗口"（双屏，或改动在另一台机器的共享目录里）准备的。
        //
        // 只在工作台**可见**时留一颗定时器：不可见时连定时器都没有（与既有探测、延迟
        // 编译轮询同一条纪律）。间隔 30 秒是刻意选的"长"：判据成本只有一次 sha256
        // （现场 0.63 MB 实测毫秒级，1.4 MB 也在 2–4 ms 量级）+ 一次本机 IPC，
        // 而它做的是**纯文件状态**检查 —— 不启动 ScriptEngine、不连接 PLC、
        // 不碰在线授权、不写任何东西。这不是"连续监视"（用户点名的 1.5 秒级）。
        if (!workbenchVisible) return undefined
        let cancelled = false
        let timer = null
        const tick = () => {
          if (cancelled) return
          if (document.visibilityState === 'visible' && visibleRef.current) void recheckSourceOnDiskRef.current?.()
          timer = setTimeout(tick, CODESYS_SOURCE_RECHECK_MS)
        }
        timer = setTimeout(tick, CODESYS_SOURCE_RECHECK_MS)
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
      }, [workbenchVisible])
      const selectProject = async () => {
        if (busy) return
        // T208: no project has been chosen yet, so say exactly that. The old wording claimed a
        // bind ("正在绑定所选 .project 工程文件") while the picker was still open — a name cannot be
        // shown before there is a path, and a generic placeholder must not pretend otherwise.
        setBusy(true); setStatus('正在选择 .project 工程文件；不会连接 PLC…')
        try {
          const selected = await window.taskhive?.selectCodesysOfflineFile?.('project')
          if (!selected?.path) { setStatus('尚未选择工程文件；不会连接 PLC…'); return }
          // The path is known now; `bindSourceProject` names it in the bottom row for the whole
          // bind, so this route needs no second sentence of its own.
          await bindSourceProject(String(selected.path), null)
        } catch (error) { setStatus(`工程读取失败：${codesysScriptEngineErrorMessage(error)}`) } finally { setBusy(false) }
      }
      const submit = async (taskPrompt, clearPrompt) => {
        if (!taskPrompt || busy || !jobId || !binding?.session) return
        const endConflictingWork = beginConflictingWork()
        setBusy(true); setStatus('正在当前 Harness 会话中执行 CODESYS 专属代码任务…'); setProposal(null); setProposalSource(''); setAssistantText(''); setReviewAccepted(false)
        try {
          const context = buildCodesysTaskSnapshot(sourcePath, objects, taskPrompt)
          const snapshot = context.snapshot
          const auditSnapshot = { projectPath: sourcePath, complete: true, textTruncated: false, objectCount: objects.length, objects }
          const request = await window.taskhive?.requestCodesysCodeAi?.({ prompt: taskPrompt, scriptEngineJobId: jobId, projectSnapshot: auditSnapshot, modelContext: snapshot, contextStats: { chars: context.chars, approxTokens: context.approxTokens, selectedCount: context.selectedCount, totalCount: context.totalCount } })
          // T182：水位线必须用**同一个**取法。老写法 `before?.nodes` 在 DSH 0.2 下恒为 undefined →
          // maxSeq 恒为 0 → 「本条任务之前的历史」与「本次任务的结果」分不开，提交后第一条旧消息
          // 就可能被当成新提案（也正因为这条路径同时失效，真机上才只看到"什么都没发生"）。
          const before = codesysWorkbenchSessionMessages(ctx, sessionId, binding?.session?.getSnapshot?.() || null).messages
          const maxSeq = before.reduce((max, message) => Math.max(max, Number(message.seq || 0)), 0)
          // T087: 消息 = 命令 + 上下文引用 + **一句硬的读取指令**。
          //
          // T086 我把指令删得太干净，只剩一个路径标签，而系统提示里是"按需读取即可"
          // 这种软话。后果：审核**当前打开的对象**时读工具就能拿到代码，没问题；但
          // 审核**整个工程**时读工具只给层级与计数，模型可能不读快照就"盲审"。用户
          // 一句"没有代码任务模型是怎么知道我的代码"正好戳中这里。
          //
          // 所以补回这一句，但仍不复述那套 schema 讲稿（工具名/JSON 结构/操作枚举/
          // PLC 禁列/上下文标签约定仍由宿主系统提示与工具描述承担）。
          const instruction = `${taskPrompt}\n本次工程上下文（含工程内全部有代码对象的声明与实现）在下面的路径里，请先读取它再动手，不要凭猜测回答：\n<taskhive-codesys-context path="${request.modelContextPath}" />`
          const accepted = await binding.session.prompt([{ type: 'text', text: instruction }], 'queue')
          if (accepted?.error) throw new Error(accepted.error.message || 'Harness 拒绝代码任务')
          setRequestSeq(maxSeq); pendingWorkbenchTaskRef.current = true; clearPrompt?.(); setStatus(`任务 ${request.jobId} 已附带 ${context.selectedCount}/${context.totalCount} 个相关对象（约 ${context.approxTokens} tokens）；等待 AI 结果，工作台保持打开。`)
        } catch (error) { setStatus(`代码任务提交失败：${error.message}`) } finally { setBusy(false); endConflictingWork() }
      }
      submitRef.current = submit
      // ── T097 离线编译（独立于写入）────────────────────────────────────────────
      // 默认增量 `build`；按钮上 Shift+点击走全量 `rebuild`（这样顶栏只多一颗图标就能覆盖
      // 两种模式 —— 顶栏必须留在一行，宽度预算被 compact-layout 契约量化过）。
      // 两者都不是 MUTATING：不需要 confirmed、不写盘、在隔离副本上编译、不回写源工程。
      // ── 编译计数口径 ────────────────────────────────────────────────────────────
      // 现场报障：面板标题写「错误 0 · 警告 7 · 信息 5」，可正文最后一行是编译器自己的总结
      //    [Info] 编译: Text: C0: 编译完成 -- 0错误,28警告
      // 28 和 7 差在哪：编译器只把前 7 条警告打进了正文，**总数**只在总结行里。老实现
      // `warningCount: messages.filter(...).length` 数的是"我们显示出来的行数"，于是把总数 7 条化。
      // 现在的规则（唯一一处定义，标题 / 状态行 / 复制文本 / AI 抽屉全部走它）：
      //   · **以编译器自己的总结行为准**（`payload.warningCount` / `errorCount` 就是引擎解析总结行得到的）；
      //   · 头部（面板标题 / 离线与后台编译状态行 / 写入状态行 / 「复制」文本 / AI 抽屉那一行）
      //     **只报两个数**：`错误 N · 警告 M` —— 不带「（已显示 N 条）」这类括注，也不再有
      //     「信息 N」这一档（用户口径："把这个显示去除…我只看编译结果"）；
      //   · 汇总与明细的差异、只载入了一部分明细这类话，**一律只留在抽屉里**（`compileCountNotes`），
      //     头部一个字都不提；
      //   · 总结行说 0 而正文有 Warning/Error ⇒ 头部报**正文那个大数**，绝不单独报 0（T200）；
      //   · 都解析不出 ⇒ **未知**（不是 0）。
      // 唯一禁止的事：把"显示出来的条数"当成总数少报，或让 0 冒充"不知道"。
      const summarizeCompilePayload = (payload, mode) => {
        const messages = Array.isArray(payload?.messages) ? payload.messages.slice(0, 1000) : []
        const severityOf = (item) => String(item?.severity || '').toLowerCase()
        // 计数只有三种来源，缺一个就是"未知"——**绝不是 0**。老写法 `Number(payload?.errorCount || 0)`
        // 会把"解析不出总结行"显示成"错误 0"（T200 修过的假成功），这里不再走那条路。
        const engineCount = (value) => {
          if (value === null || value === undefined || value === '') return null
          const number = Number(value)
          return Number.isFinite(number) && number >= 0 ? number : null
        }
        // T225：列表本身有 1000 条上限（保护界面）。上限**不许**悄悄吞掉条数——引擎那份总数
        // （`compile.messageCount` / 后台那条路径的 `messageCount`）与真正载入的条数一起留下，
        // 明细列表**上方**那行说明据此如实写"共 M 条，超出上限的未载入"，而不是把 1000 冒充成"全部"
        // （T227：这句话原来挂在展开按钮的文案里，不点开就看不见）。
        const messagesTotal = [payload?.compile?.messageCount, payload?.messageCount]
          .map(engineCount)
          .filter((value) => value !== null)
          .reduce((max, value) => Math.max(max, value), messages.length)
        const detailErrorCount = messages.filter((item) => severityOf(item) === 'error').length
        const detailWarningCount = messages.filter((item) => severityOf(item) === 'warning').length
        const detailInfoCount = messages.filter((item) => severityOf(item) !== 'error' && severityOf(item) !== 'warning').length
        // 引擎/编译器给的那个数（以 CODESYS 自己的总结行为准）。
        const engineErrors = engineCount(payload?.errorCount)
        const engineWarnings = engineCount(payload?.warningCount)
        // 正文条目数是"至少这么多"的硬证据：总结行少报时取大的那个（绝不把已经显示出来的
        // 错误/警告报小），也绝不用它去覆盖总结行报得更多的那些（正文只显示了前 N 条）。
        const errorCount = engineErrors === null ? (detailErrorCount || null) : Math.max(engineErrors, detailErrorCount)
        const warningCount = engineWarnings === null ? (detailWarningCount || null) : Math.max(engineWarnings, detailWarningCount)
        return {
          mode,
          at: new Date().toISOString(),
          projectPath: sourcePathRef.current || '',
          errorCount,
          warningCount,
          // 信息行没有总结行维度（总结行只有 `N错误,M警告`），所以它如实等于"显示出来的信息行数"。
          infoCount: detailInfoCount,
          // 总结行原话里的数字 / 正文条目数 / 各自的来源：三者一起才能把"28（已显示 7 条）"如实
          // 说出来，而不是拿其中一个冒充总数。
          summaryErrorCount: engineCount(payload?.summaryErrorCount),
          summaryWarningCount: engineCount(payload?.summaryWarningCount),
          detailErrorCount,
          detailWarningCount,
          errorCountSource: String(payload?.errorCountSource || ''),
          warningCountSource: String(payload?.warningCountSource || ''),
          compileSummary: String(payload?.compileSummary || ''),
          messages,
          // T225：引擎那份消息总数 vs 真正载入的条数（上限 1000）。两者不等时，明细列表**上方**
          // 那行说明要说清楚（T227：原来这句话写在展开按钮的文案里，不点开就看不见）。
          messagesTotal,
          messagesOmitted: Math.max(0, messagesTotal - messages.length),
        }
      }
      // ── T227 编译明细的呈现：全量平铺（T225 的分组 + 展开按钮已删除）──────────────────
      // 引擎那一半（`mergeDiagnosticOccurrences`）不再按文本去重，所以 `messages` 里是一条
      // 不少的全部出现；这一半**一个字节都不再合并**：明细就是 `messages` 本身，按原顺序逐条画。
      //   · 删掉了 `compileMessageGroups`（按 (severity, text) 合成一行 + ×出现次数）；
      //   · 删掉了它配套的那个「换一份新报告就回到默认收起」的 `useEffect`（不是定时器）；
      //   · 删掉了「展开查看全部 N 条」按钮与逐条/分组的二选一。
      // 理由（用户口径）：折叠形式让"到底收到几条"变得要点一下才看得见，而重复次数本身不是
      // 需要被压缩的信息 —— 重复的逐条列出来，×9 这种汇总数就不再是唯一的证据。
      // 计数口径一个字都没改：头部与说明仍走唯一的 `compileCountLabel` / `compileCountNotes`。
      const compileSeverityKind = (severity) => {
        const value = String(severity || '').toLowerCase()
        return value.includes('error') ? 'error' : value.includes('warning') ? 'warning' : 'info'
      }
      const compileCountLabel = (count, report, dimension) => {
        if (count === null || count === undefined) return '未知'
        const summaryCount = dimension === 'error' ? report.summaryErrorCount : report.summaryWarningCount
        const detailCount = dimension === 'error' ? report.detailErrorCount : report.detailWarningCount
        // 头部只报**一个数**，两处"取哪个数"的例外方向原样保留：
        //   · 警告维度下正文**多于**汇总 ⇒ 仍以编译器汇总当头（真机那 1 条设备层警告不在编译器
        //     口径内，T225：总数 28 不许变成 29；多出来的只写进抽屉说明）；
        //   · 其余方向取 `count`（= max(汇总, 正文)）⇒ "汇总说 0、正文却有错误"时报正文那个大数，
        //     绝不把失败报小（T200 方向不放宽）。
        if (summaryCount !== null && summaryCount !== undefined && summaryCount !== detailCount) {
          if (summaryCount > detailCount) return String(count)
          if (dimension === 'warning' && summaryCount > 0) return String(summaryCount)
        }
        return String(count)
      }
      // T226：口径说明（汇总 / 明细 / 载入上限）**只落在抽屉里**，逐维如实写出需要解释的那几件
      // 事实。头部那两个数与这里的每一句都出自同一份 report，不另算一遍、不猜。
      const compileCountNotes = (report) => {
        const notes = []
        const noteFor = (label, dimension) => {
          const summaryCount = dimension === 'error' ? report.summaryErrorCount : report.summaryWarningCount
          const detailCount = dimension === 'error' ? report.detailErrorCount : report.detailWarningCount
          const count = dimension === 'error' ? report.errorCount : report.warningCount
          if (count === null || count === undefined) {
            notes.push(`${label}：未解析出编译器汇总行，也没有可数的正文明细，头部写「未知」，绝不按 0 计`)
            return
          }
          if (summaryCount === null || summaryCount === undefined) {
            // 只有正文、没有可用的汇总数：计数就是正文条目数，如实注明口径（不猜是哪种语言）。
            notes.push(`${label}：未解析出编译器汇总行，头部 ${count} 按已显示条目计`)
            return
          }
          if (summaryCount === detailCount) return
          if (summaryCount > detailCount) {
            // 汇总比明细多：总数仍以编译器为准，明细如实写出（真机那次 28 与 8）。
            notes.push(`${label}：编译器汇总 ${summaryCount} 条，本次明细只有 ${detailCount} 条`)
            return
          }
          if (dimension === 'warning' && summaryCount > 0) {
            // 正文多于汇总：多出来的条目不在编译器汇总的口径里（真机样本是 1 条设备层警告）。
            notes.push(`${label}：明细另有 ${detailCount - summaryCount} 条警告不在编译器汇总口径内，不计入编译器汇总；明细 ${detailCount} 条，编译器汇总 ${summaryCount} 条，头部 ${summaryCount} 以编译器为准`)
            return
          }
          // 汇总说 0、正文却有内容：这是 T200 的"硬证据"方向，头部取正文那个大数。
          notes.push(`${label}：正文有 ${detailCount} 条，而编译器汇总只报 ${summaryCount} 条，头部取正文的 ${count}，绝不把失败报小`)
        }
        noteFor('错误', 'error')
        noteFor('警告', 'warning')
        if (report.messagesOmitted > 0) {
          // T227：明细不再折叠，这句话**直接显示在明细列表上方**（原来它挂在展开按钮的文案里，
          // 不点开就看不见）。口径不变：绝不把载入的条数冒充「全部」。
          notes.push(`明细上限：本次只载入 ${report.messages.length} 条，编译器那份共 ${report.messagesTotal} 条，超出上限的 ${report.messagesOmitted} 条未载入，不把 ${report.messages.length} 冒充「全部」`)
        }
        return notes
      }
      const compileCountText = (report) => `错误 ${compileCountLabel(report.errorCount, report, 'error')} · 警告 ${compileCountLabel(report.warningCount, report, 'warning')}`
      const compileReportText = (report) => [
        `TaskHive 离线编译（${report.mode === 'rebuild' ? '全量重建' : '增量 build'}）`,
        `时间：${report.at}`,
        `工程：${report.projectPath || '(未绑定)'}`,
        compileCountText(report),
        '说明：编译对象是磁盘上已保存工程的隔离副本，不回写源工程，也不含工作台编辑器里尚未写入的手写改动。',
        '',
        ...(report.messages.length
          ? report.messages.map((item) => `[${String(item.severity || 'info')}] ${String(item.text || '')}`)
          : ['(编译完成，没有产生任何消息)']),
      ].join('\n')
      const capabilityStateRef = React.useRef(null)
      const capabilityBuildRef = React.useRef({ state: 'idle' })
      const capabilitySeamRef = React.useRef(null)
      // 写入 / 编译两条路径写进这里。`scope` 只是给抽屉一句话用的（写入 vs 编译），不参与判定。
      const recordCapabilityBuild = (value) => {
        capabilityBuildRef.current = { ...(capabilityBuildRef.current || {}), ...value, scope: 'build', updatedAt: new Date().toISOString() }
      }
      const runCompile = async (mode = 'build') => {
        if (busy || !jobId) return
        const endConflictingWork = beginConflictingWork()
        setBusy(true)
        setStatus(`正在离线编译当前工程（${mode === 'rebuild' ? '全量重建' : '增量 build'}，通常 30–60 秒；不会写入工程、不会连接 PLC）…`)
        recordCapabilityBuild({ state: 'running', mode, jobId, buildId: '', written: 0, startedAt: new Date().toISOString(), errorCount: 0, warningCount: 0, infoCount: 0, messages: [], omitted: 0, error: '' })
        try {
          const result = await run(mode, { jobId })
          const report = summarizeCompilePayload(result?.payload, mode)
          const messages = codesysCapabilityMessages(report.messages)
          recordCapabilityBuild({ state: 'done', mode, jobId, buildId: '', durationMs: Number(result?.timings?.scriptEngineProcess) || 0, errorCount: report.errorCount, warningCount: report.warningCount, infoCount: report.infoCount, errorLabel: compileCountLabel(report.errorCount, report, 'error'), warningLabel: compileCountLabel(report.warningCount, report, 'warning'), messages: messages.kept, omitted: messages.omitted, error: '' })
          setCompileReport(report)
          setCompileOpen(true)
          setStatus(`离线编译完成（${mode === 'rebuild' ? '全量重建' : '增量 build'}）· ${compileCountText(report)} · 编译对象是磁盘上已保存版本`)
        } catch (error) {
          recordCapabilityBuild({ state: 'failed', mode, jobId, buildId: '', errorCount: 0, warningCount: 0, infoCount: 0, messages: [], omitted: 0, error: String(error?.message || error).slice(0, 300) })
          setStatus(`编译失败：${error.message}`)
        } finally { setBusy(false); endConflictingWork() }
      }
      const copyCompileReport = async () => {
        if (!compileReport) return
        try {
          await navigator.clipboard.writeText(compileReportText(compileReport))
          setStatus('已复制编译输出文本')
        } catch (error) {
          setStatus(`复制编译输出失败：${error?.message || error}`)
        }
      }
      // ── T183 第 4 项（客户端一半）：延迟编译的只读收取 ───────────────────────────
      // `apply-and-build` 带 `deferBuild:true` 时，引擎在 apply+save+**提交回源工程**之后
      // 立刻回报（`buildPending:true` + `buildId`），编译排到作业锁释放之后在后台跑。于是
      // "已落盘"可以秒级上屏，而这 45–60 秒的编译由这里用**只读**动作 `build-status` 收回来
      // （它不在 MUTATING_ACTIONS 里：不启动 ScriptEngine、不写盘、不碰工程）。
      //
      // 四条纪律都是可执行的，不是注释：
      //   · 同一时刻只有一个在途请求 —— `active.inFlight` 既是守卫，也是"上一轮没回来就不再发"；
      //   · 工作台不可见 / 页面切走 ⇒ **暂停**（连定时器都不留），回到可见时补一次；
      //   · 拿到终态（done / failed）、`unknown` 或读取出错 ⇒ 立刻停表，不再有任何定时器；
      //   · 退出/卸载、换绑工程、回滚、以及**新的写入开始**时清理（`stopDeferredBuildWatch`）。
      // 默认路径（引擎没回 `buildId`）一行都不走这里：那时编译结果就在同一次回报里。
      const CODESYS_DEFERRED_BUILD_POLL_MS = 1000
      const deferredBuildRef = React.useRef(null)
      const deferredBuildPollRef = React.useRef(null)
      const stopDeferredBuildWatch = () => {
        const active = deferredBuildRef.current
        if (!active) return
        // 先摘引用再清定时器：任何已经飞出去的回包回来时 `deferredBuildRef.current !== active`，
        // 一律被丢弃（新的写入不会让旧 buildId 的报告盖掉自己的状态）。
        deferredBuildRef.current = null
        if (active.timer) clearTimeout(active.timer)
        active.timer = null
        // 停表 = 这一份后台编译的报告不再描述当前界面（换绑工程 / 回滚 / 新写入 / 卸载），
        // 所以抽屉里那行"后台编译中…"必须跟着消失 —— 否则它会一直挂在那儿骗人。
        if (capabilityBuildRef.current?.state === 'running') recordCapabilityBuild({ state: 'idle', buildId: '', error: '' })
      }
      const readDeferredBuildOnce = async () => {
        const active = deferredBuildRef.current
        if (!active || active.inFlight) return
        if (!visibleRef.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
        active.inFlight = true
        active.requests += 1
        let status = null
        let failure = ''
        try {
          status = await run('build-status', { jobId: active.jobId, buildId: active.buildId })
        } catch (error) {
          failure = String(error?.message || error).slice(0, 300)
        } finally { active.inFlight = false }
        // 期间停过表（新写入 / 换绑 / 回滚 / 卸载）⇒ 这一份回包与当前界面无关，直接丢。
        if (deferredBuildRef.current !== active) return
        const state = String(status?.state || '')
        if (failure) {
          stopDeferredBuildWatch()
          recordCapabilityBuild({ state: 'unavailable', mode: 'build', jobId: active.jobId, buildId: active.buildId, written: active.written, error: failure })
          setStatus(`已写入 ${active.written} 个对象并提交回源工程，但读取后台编译结果失败：${failure} · 工程已落盘，恢复基线仍可用`)
          return
        }
        if (state === 'done') {
          const report = summarizeCompilePayload(status, 'build')
          const durationMs = Number(status?.durationMs) || 0
          const messages = codesysCapabilityMessages(report.messages)
          stopDeferredBuildWatch()
          recordCapabilityBuild({ state: 'done', mode: 'build', jobId: active.jobId, buildId: active.buildId, written: active.written, durationMs, errorCount: report.errorCount, warningCount: report.warningCount, infoCount: report.infoCount, errorLabel: compileCountLabel(report.errorCount, report, 'error'), warningLabel: compileCountLabel(report.warningCount, report, 'warning'), messages: messages.kept, omitted: messages.omitted, error: '' })
          setCompileReport(report)
          if (report.errorCount > 0 || report.warningCount > 0) setCompileOpen(true)
          setStatus(`已批量写入 ${active.written} 个对象并提交回源工程 · 后台编译完成${durationMs ? `（${(durationMs / 1000).toFixed(1)} 秒）` : ''} · Build ${compileCountText(report)} · 可使用恢复基线回滚`)
          return
        }
        if (state === 'failed') {
          const message = String(status?.error || '后台编译失败').slice(0, 300)
          stopDeferredBuildWatch()
          recordCapabilityBuild({ state: 'failed', mode: 'build', jobId: active.jobId, buildId: active.buildId, written: active.written, errorCount: 0, warningCount: 0, infoCount: 0, messages: [], omitted: 0, error: message })
          setStatus(`已写入 ${active.written} 个对象并提交回源工程，但后台编译失败：${message} · 工程已落盘，恢复基线仍可用`)
          return
        }
        if (!status || status?.ok === false || !state || state === 'unknown') {
          // 引擎丢了这份后台任务（作业被清理、进程重启）⇒ 如实说"拿不到结果"，不假装编译通过。
          stopDeferredBuildWatch()
          recordCapabilityBuild({ state: 'unavailable', mode: 'build', jobId: active.jobId, buildId: active.buildId, written: active.written, error: `拿不到后台编译结果（${state || 'no-status'}）` })
          setStatus(`已写入 ${active.written} 个对象并提交回源工程，但拿不到后台编译结果（${state || 'no-status'}） · 可点「编译」重来一次，恢复基线仍可用`)
          return
        }
        // state === 'running'：1 秒后再看一次，且始终只有一个在途请求。
        recordCapabilityBuild({ state: 'running', mode: 'build', jobId: active.jobId, buildId: active.buildId, written: active.written, requests: active.requests })
        active.timer = setTimeout(() => { active.timer = null; deferredBuildPollRef.current?.() }, CODESYS_DEFERRED_BUILD_POLL_MS)
      }
      // 恢复/续跑的唯一入口：**已经有一个定时器在跑就绝不抢跑**（每个 1 秒周期最多一个请求）；
      // 被"不可见"暂停过的那一轮 `timer` 是 null，所以回到可见时这里正好接上。
      const deferredBuildPoll = () => {
        const active = deferredBuildRef.current
        if (!active || active.timer) return
        void readDeferredBuildOnce()
      }
      deferredBuildPollRef.current = deferredBuildPoll
      const watchDeferredBuild = (activeJob, buildId, written) => {
        stopDeferredBuildWatch()
        const active = { jobId: activeJob, buildId: String(buildId), written: Number(written) || 0, startedAt: Date.now(), requests: 0, inFlight: false, timer: null }
        deferredBuildRef.current = active
        // 抽屉里的进度行：写入已落盘、编译在后台跑 —— 这一句必须真的反映"现在在编译"。
        recordCapabilityBuild({ state: 'running', mode: 'build', jobId: activeJob, buildId: String(buildId), written: active.written, startedAt: new Date(active.startedAt).toISOString(), errorCount: 0, warningCount: 0, infoCount: 0, messages: [], omitted: 0, error: '' })
        deferredBuildPoll()
      }
      React.useEffect(() => {
        // 恢复：切回本界面 / 页面重新可见时补一次。发请求的永远只有 readDeferredBuildOnce 一处。
        if (workbenchVisible && deferredBuildRef.current) deferredBuildPollRef.current?.()
      }, [workbenchVisible, tabVisible])
      React.useEffect(() => () => { stopDeferredBuildWatch() }, [])
      // T167: 写入前的「未保存改动」检查。
      //
      // 现场故障：用户在外部（CODESYS 自己的 GUI 或别的编辑器）里 Ctrl+S，磁盘上的 .project
      // 被写成了新内容，而工作台手里的 objects 仍是旧文本。此时点「确认写入」会拿着**旧基线**
      // 去覆盖，把对方刚存下的改动静默回滚掉 —— 也可能覆盖 TaskHive 自己刚写入的内容。
      //
      // 判据：磁盘当前 sha256 是否等于"本会话最后一次已知的 sha256"。不等就是被外部动过。
      // 探测本身走引擎既有的 `diff` 动作：它不在 MUTATING_ACTIONS 里，不启动 ScriptEngine，
      // 只对 .project 重算一次 sha256（毫秒级），所以放在写入确认之后、真正写入之前是廉价的。
      //
      // 返回值刻意做成"三种结果"而不是布尔：能证明没变 / 能证明变了 / **没法证明**。
      // 第三种（diff 不可用、job 丢失、没有基线）不能当成"没变"放行 —— 那正是这条防线要防的
      // 情形 —— 但也不能把用户永久挡在门外，所以它同样走"显式确认后继续"的路径。
      const checkSourceUnchanged = async (activeJob) => {
        const baseline = String(lastWriteBaselineRef.current || '')
        try {
          const result = await run('diff', { jobId: activeJob })
          const current = String(result?.currentSha256 || '')
          if (!current) return { ok: false, reason: 'no-hash', baseline, current }
          if (!baseline) {
            // First write of this session and the host reported no bind baseline:
            // adopt what is on disk now so the NEXT write has something to compare.
            lastWriteBaselineRef.current = current
            return { ok: true, current, adopted: true }
          }
          if (current !== baseline) return { ok: false, reason: 'changed', baseline, current }
          return { ok: true, current }
        } catch (error) {
          return { ok: false, reason: 'unverifiable', baseline, message: String(error?.message || error).slice(0, 300) }
        }
      }
      // T204 / 本轮：把编辑器（声明 + 实现两段）对齐到**刚读到的那份文本**。
      // 编辑器显示的是 state 里的字符串，不是 objects 里的，所以"读了新树"必须显式写回去 ——
      // 否则"树更新了、代码没更新"这个抱怨只解决一半，旧文本还会被当成一处手写修改一直挂着。
      // 两处共用（只有这一处实现）：
      //   · `recheckSourceOnDisk()` —— 磁盘被外部保存过、且工作台里没有手打内容时的自动重读；
      //   · `discardProposal()` —— 用户点「放弃」之后按磁盘最新内容退回编辑器。
      // 找不到这个对象（key 已失效）时返回 false，由调用方决定怎么说话。
      const alignEditorToDisk = (loaded) => {
        const editorKey = String(loadedEditorRef.current.key || '')
        const target = loaded.nextObjects.find((item) => codesysObjectKey(item) === editorKey)
        if (!target) return false
        const declaration = String(target.declaration ?? '')
        const implementation = String(target.implementation ?? '')
        loadedEditorRef.current = { key: editorKey, declaration, implementation }
        setEditedDeclaration((value) => (value === declaration ? value : declaration))
        setEditedImplementation((value) => (value === implementation ? value : implementation))
        return true
      }
      // T204: 源文件在外部被保存 ⇒ 工作台手里的 objects 与编辑器文本都是旧的。
      //
      // 本轮现场（用户原话「我在 codesys 里面改动程序，代码工作台里面的代码没有更新」）：
      // 在原生 CODESYS IDE 里改代码并保存，工作台仍然显示旧代码。根因**不在引擎侧** ——
      // 工作副本与对象树缓存都是按源 sha 失效的（`scriptengine.cjs` 的
      // `ensureWorkProject` / `inspectCacheKey` / `readInspectDiskCache`，由
      // codesys-scriptengine-project-reuse-contract.js 与 codesys-preopen-early-contract.js
      // 各自钉住），新 sha 一定读到新树。根因是**工作台从来不去重读**：
      // `detectCurrentProject` 的"同一个工程"分支只刷新身份与写入权限，连用户点「刷新」
      // 也走那一支 —— 于是源 sha 变了，没有任何一条路径会去读。
      //
      // 这里把写入守卫**同一个**三态判据（`checkSourceUnchanged` → `diff`：不启动
      // ScriptEngine、不碰 PLC/在线，只对 .project 重算一次 sha256）用在读取侧：
      //   · 能证明没变   ⇒ 一颗字都不说（"界面安静"对成功一视同仁）；
      //   · 没法证明     ⇒ 也不猜、不报假消息（第三态绝不当成"没变"，也绝不当成"变了"）；
      //   · 能证明变了   ⇒ 重读并刷新工作台。
      // 绝不自动写入 / 自动确认 / 自动编译。
      const recheckSourceOnDisk = async (options = {}) => {
        const activeJob = String(jobIdRef.current || '')
        if (!activeJob) return false
        // T166：读取/写入/构建期间与用户操作互斥 —— 绝不在别人做事的时候插一次重读，
        // 也绝不在一次重读还在飞的时候再排一次（定时器与 focus 事件会重叠）。
        // 后台编译也一样让路：那一轮是我们自己刚写完的工程，这时候去重读既没有必要
        // （基线就是刚写下的 sha），又会和编译终态抢同一条状态行。
        if (conflictingWorkRef.current > 0 || sourceRecheckInFlightRef.current || deferredBuildRef.current) return false
        sourceRecheckInFlightRef.current = true
        let guard
        try {
          guard = await checkSourceUnchanged(activeJob)
        } catch (error) {
          return false
        } finally {
          sourceRecheckInFlightRef.current = false
        }
        if (guard.ok !== false || guard.reason !== 'changed') return false
        const previous = String(guard.baseline || '')
        const current = String(guard.current || '')
        // 同一件外部保存只播报一次（否则每 30 秒重复一行，那才是噪音）。
        if (current && current === lastObservedDiskShaRef.current) return false
        lastObservedDiskShaRef.current = current
        const short = (value) => String(value || '').slice(0, 8)
        const pendingProposal = Boolean(proposalRef.current?.changes?.length)
        // T166 红线：工作台里有**用户手打**且尚未写入的东西时，绝不自动重读把它盖掉
        // （重读会换掉编辑器里的文本，那就是"无声丢弃草稿"）。把决定留给用户，并且
        // **不推进写入基线** —— 这样他点「确认写入」时那道 sha 三态守卫照旧拦下他，
        // 绝不可能出现"拿旧文本静默回滚掉别人刚保存的内容"。
        const unsavedDrafts = countUnsavedDrafts()
        if (unsavedDrafts > 0) {
          setStatus(`磁盘上的工程已在 CODESYS 里更新（sha 前 8 位 ${short(previous)}→${short(current)}），但工作台里有 ${unsavedDrafts} 处未写入的修改：未自动重读，请先处理这些修改。`)
          return false
        }
        const endConflictingWork = beginConflictingWork()
        try {
          // 作废过期提案：它基于旧文本，写回去就是回滚别人刚保存的内容。
          if (pendingProposal) {
            setObjectChangeState(proposalKeys(proposalRef.current.changes, proposalRef.current), '')
            setProposal(null); setProposalSource(''); setAssistantText(''); setReviewAccepted(false); setAgentReloadAvailable(false)
          }
          const loaded = await inspect(activeJob)
          // 重读成功 ⇒ 磁盘上的内容已经成为本次会话的新基线（与 bind-project 的语义一致）：
          // 从此写入守卫比较的就是它。
          lastWriteBaselineRef.current = current
          // 编辑器显示的是 state 里的文本，不是 objects 里的。没有手打内容时把它对齐到刚
          // 读到的字节 —— 口径与「放弃」共用同一个 `alignEditorToDisk()`。
          alignEditorToDisk(loaded)
          setStatus(`工程已在 CODESYS 里更新（sha 前 8 位 ${short(previous)}→${short(current)}），已重新读取 ${loaded.nextObjects.length} 个工程对象${pendingProposal ? '；此前提案已作废' : ''}`)
          return true
        } catch (error) {
          // 失败绝不能被说成"已更新"：磁盘确实变了，但工作台没能重读。
          if (options.explicit) setStatus(`磁盘上的工程已在 CODESYS 里更新（sha 前 8 位 ${short(previous)}→${short(current)}），但重新读取失败：${codesysScriptEngineErrorMessage(error)}`)
          return false
        } finally { endConflictingWork() }
      }
      const recheckSourceOnDiskRef = React.useRef(null)
      recheckSourceOnDiskRef.current = recheckSourceOnDisk
      const applyProposal = async (proposalToApply = effectiveProposal, validationErrors = effectiveErrors, options = {}) => {
        // `options.fromChat` = 这一趟是**外壳 AI 对话抽屉**里那一次显式点击发起的（见下面
        // `capabilityApply`）。它只改两处：①"逐项审查"这条闸门由那次点击自带（`reviewAcknowledged`，
        // 差异原文就在抽屉消息流里）；②sha 防护被挡下时**不去弹工作台的对话框**，而是把三态结果
        // 作为**数据**回传，由抽屉写一行可读原因并给出第二次显式确认。写入本身一字未改。
        const fromChat = options.fromChat === true
        const notReady = (reason, detail) => (fromChat ? { ok: false, reason, detail } : undefined)
        // 本轮 B 项（冻结）：已登录到应用时，**任何**写入入口都在这里被拦住 —— 包括外壳
        // AI 对话抽屉那条 `capabilityApply`（它调的也是这个函数）。界面上的按钮已经禁用
        // （见命令条），这一条是"程序化点进来也写不了"的第二道门；第三道门在引擎里
        // （`apply-and-build` 会被 ONLINE_WRITE_FROZEN 拒绝，绕过界面也写不进去）。
        // 文案就是那唯一一行"原因 + 出路"，本地路径同时写进状态行 —— 禁止不许静默。
        if (onlineWriteFrozen) {
          if (!fromChat) setStatus(`已阻止写入：${CODESYS_ONLINE_WRITE_FROZEN_DETAIL}`)
          return notReady('online-write-frozen', CODESYS_ONLINE_WRITE_FROZEN_DETAIL)
        }
        if (busy) return notReady('workbench-busy', '工作台正在执行另一项操作：等它结束再点「确认写入工程」。')
        if (!writeAvailable) return notReady('not-writable', String(writeBlockReason || '当前工程不可写入：请先绑定一个可写工程'))
        if (!reviewAccepted && options.reviewAcknowledged !== true) return notReady('review-required', '还没有勾选「已核对」：请先逐项审查这次改动。')
        if (validationErrors.length) return notReady('invalid-proposal', `当前提案不可写入：${String(validationErrors[0] || '')}`)
        if (!jobId) return notReady('no-job', '工作台还没有绑定工程（没有可写入的作业）：请先点面板上的「刷新」或「选择工程」。')
        if (!proposalToApply?.changes?.length) return notReady('no-proposal', '当前没有待写入的改动。')
        // The explicit "我已确认，继续写入" path skips the gate exactly once.
        if (options.overwriteConfirmed !== true) {
          const guard = await checkSourceUnchanged(jobId)
          if (!guard.ok) {
            const changed = guard.reason === 'changed'
            const detail = changed
              ? `磁盘上的工程文件与本次会话最后一次写入时不一致（基线 sha256 ${String(guard.baseline).slice(0, 16)}… / 磁盘 sha256 ${String(guard.current).slice(0, 16)}…）：说明它在这之后被外部（CODESYS 或别的编辑器）保存过，直接写入会把对方的改动回滚掉。`
              : `${guard.reason === 'no-hash' ? '宿主没有回报工程文件的 sha256' : `无法读取工程文件的当前 sha256：${guard.message || ''}`}：现在写入无法确认工程有没有被外部改过。`
            if (fromChat) {
              // 抽屉里**不弹对话框**：把三态结果原样回传，由抽屉写一行原因 + 第二次显式点击
              // （同一个 `options.overwriteConfirmed = true` 通路，防护一字不放宽）。
              return { ok: false, reason: changed ? 'source-changed' : 'unverifiable', detail, needsOverwriteConfirmation: true, baseline: String(guard.baseline || ''), current: String(guard.current || '') }
            }
            const accepted = await showTaskHiveDialog({
              title: changed ? '工程在外部被修改' : '无法确认工程未被外部修改',
              confirm: true,
              danger: true,
              acceptLabel: '我已确认，继续写入',
              message: changed
                ? `磁盘上的工程文件与本次会话最后一次写入时不一致，说明它在这之后被外部（CODESYS 或别的编辑器）保存过。\n\n直接写入会把对方的改动回滚掉。请先在外部保存/确认，或选择「我已确认，继续写入」来覆盖。\n\n基线 sha256：${String(guard.baseline).slice(0, 16)}…\n磁盘 sha256：${String(guard.current).slice(0, 16)}…`
                : `${guard.reason === 'no-hash' ? '宿主没有回报工程文件的 sha256。' : `无法读取工程文件的当前 sha256：${guard.message || ''}`}\n\n这可能是宿主版本或 job 状态的问题：现在写入无法确认工程有没有被外部改过。\n建议先点「刷新」重新读取工程。若你确认磁盘内容就是你想覆盖的，可以选「我已确认，继续写入」。`,
            })
            if (!accepted) {
              setStatus(changed
                ? '已阻止写入：工程在外部被修改过（基线 sha256 与磁盘不一致）。请在外部保存后点「刷新」重读工程，或再次点「确认写入」并选择「我已确认，继续写入」。'
                : '已阻止写入：无法确认工程未被外部修改。请先点「刷新」重读工程，或再次点「确认写入」并选择「我已确认，继续写入」。')
              return { ok: false, reason: changed ? 'source-changed' : 'unverifiable', detail, cancelled: true }
            }
            return applyProposal(proposalToApply, validationErrors, { ...options, overwriteConfirmed: true })
          }
        }
        const endConflictingWork = beginConflictingWork()
        setBusy(true); setStatus('正在创建恢复快照并写入当前工程…')
        // 展示层（抽屉）：这一趟写着呢 —— 把手那一行此刻读作「写入 · 写入中」。
        setWritePhase('writing')
        // 抽屉里的写入进度行：这一趟可能 30 秒以上（创建恢复快照 + 写入 + 落盘），必须看得见。
        recordCapabilityBuild({ state: 'writing', mode: 'write', jobId, buildId: '', written: 0, startedAt: new Date().toISOString(), errorCount: 0, warningCount: 0, infoCount: 0, messages: [], omitted: 0, error: '' })
        try {
          const changes = proposalToApply.changes.map((change) => {
            const operation = codesysProposalOperation(change, objects, proposalToApply)
            if (operation.startsWith('create-')) return { ...change, operation, objectName: String(change.objectName || ''), confirmed: true }
            const target = resolveCodesysProposalObject(change, objects)
            if (!target) throw new Error(`无法唯一定位对象：${String(change.objectName || '')}`)
            return { ...change, operation: 'update-text', objectGuid: String(target.guid || ''), objectName: String(target.name || ''), confirmed: true }
          })
          // ONE confirmed write = ONE CODESYS process. Measured before this change on
          // a real 62-object project: apply-changes 34-36 s + build 45-47 s +
          // inspect-project 32-34 s = ~115 s, and scriptEngineProcess was 99.9 % of
          // every one of those calls — the cost was three CODESYS startups, not the
          // edits. The composite also returns the post-write tree, so the workbench
          // no longer pays a third launch just to refresh itself.
          //
          // T183 第 4 项（客户端一半）：`deferBuild:true` ⇒ 引擎在 apply+save+提交回源工程
          // 之后**立刻**回报（buildPending + buildId），那 45–60 秒的编译排到后台（见
          // watchDeferredBuild 的 1 秒只读轮询）。用户点「确认写入」后看到的第一句话因此是
          // "已落盘"，而不是等编译完。`includeTree:false`：这一次回报里不夹带工程树（不编译
          // 也就不必读树），树由下面既有的 inspect 兜底路径重读一次 —— 安全网一字未动。
          const writeResult = await run('apply-and-build', { jobId, changes, confirmed: true, includeTree: false, deferBuild: true })
          // T167: 写入成功之后，磁盘上的内容就是 TaskHive 的产物 —— 基线随之推进。
          // 不推进的话下一次写入会把"TaskHive 自己刚写的内容"误判成外部改动。
          if (writeResult?.ok === true && writeResult?.currentSha256) lastWriteBaselineRef.current = String(writeResult.currentSha256)
          // Keep the written objects marked (green) so the project tree still
          // shows what this session changed after the diff is consumed.
          const writtenKeys = proposalKeys(proposalToApply.changes, proposalToApply)
          setObjectChangeState(writtenKeys, 'written')
          // T096: 文本已经落盘，草稿已经没有意义；留着它只会在下次切换时把旧文本又恢复出来。
          clearObjectDrafts(writtenKeys)
          setProposal(null); setProposalSource(''); setReviewAccepted(false); setAgentReloadAvailable(false)
          const timing = writeResult?.timings || {}
          const timingText = timing.total ? ` · 写入链路 ${timing.total}ms（脚本 ${timing.scriptEngineProcess || 0}ms，快照 ${timing.recoverySnapshot || 0}ms）` : ''
          const writtenCount = Number(writeResult?.payload?.changeCount || changes.length)
          const deferredBuildId = String(writeResult?.buildId || '')
          if (deferredBuildId) {
            // ① 「已落盘/已提交」先上屏：这是秒级可见的那一句。
            setStatus(`已批量写入 ${writtenCount} 个对象 · 已落盘并提交回源工程${timingText} · 项目树已用绿色标记本次写入 · 后台编译中，结果自动回报`)
            // ② 后台编译结果用只读轮询收；③ 树重读。两者都在**写入成功之后**，所以它们各自的
            // 失败绝不能被报成"写入失败"（那条 catch 说的是写盘没成，语义完全不同）。
            watchDeferredBuild(jobId, deferredBuildId, writtenCount)
            try { await inspect(jobId) } catch (error) {
              setStatus(`已批量写入 ${writtenCount} 个对象并提交回源工程，但工程树重读失败：${String(error?.message || error).slice(0, 200)} · 请点「刷新」重读；恢复基线仍可用`)
            }
          } else {
            // 默认路径（引擎/宿主没有回 buildId）语义一字不改：编译结果就在这一次回报里。
            const treeReady = writeResult?.payload?.complete === true && writeResult?.payload?.textTruncated === false
            if (treeReady) {
              applyInspectionPayload(writeResult)
            } else {
              // Fall back to the separate read: a composite that could not produce a
              // complete tree must never leave the workbench showing the pre-write code.
              await inspect(jobId)
            }
            // T097: 写入链路本来就会离线编译并返回同一份 messages；把它也喂给编译输出面板，
            // 于是"写入时的编译错误全文"第一次能在界面上看到（此前只有状态栏里的错误计数）。
            // 计数口径与编译面板**共用同一处**（`summarizeCompilePayload` + `compileCountLabel`）：
            // 写入这一趟的编译也是编译，同样不许把"已经显示出来的条数"当成总数。
            const report = summarizeCompilePayload(writeResult?.payload, 'build')
            if (Array.isArray(writeResult?.payload?.messages)) {
              const messages = codesysCapabilityMessages(report.messages)
              recordCapabilityBuild({ state: 'done', mode: 'build', jobId, buildId: '', written: writtenCount, errorCount: report.errorCount, warningCount: report.warningCount, infoCount: report.infoCount, errorLabel: compileCountLabel(report.errorCount, report, 'error'), warningLabel: compileCountLabel(report.warningCount, report, 'warning'), messages: messages.kept, omitted: messages.omitted, error: '' })
              setCompileReport(report)
              if (report.errorCount > 0 || report.warningCount > 0) setCompileOpen(true)
            } else {
              // 连 messages 都没有的回报：计数取自引擎的结构化字段（解析不出就是"未知"，不是 0），
              // 并且**不**伪造一个空的编译面板出来。
              recordCapabilityBuild({ state: 'done', mode: 'build', jobId, buildId: '', written: writtenCount, durationMs: Number(timing.total) || 0, errorCount: report.errorCount, warningCount: report.warningCount, infoCount: report.infoCount, errorLabel: compileCountLabel(report.errorCount, report, 'error'), warningLabel: compileCountLabel(report.warningCount, report, 'warning'), messages: [], omitted: 0, error: '' })
            }
            setStatus(`已批量写入 ${writtenCount} 个对象 · 单次 ScriptEngine 完成写入+离线编译${timingText} · Build ${compileCountText(report)} · 项目树已用绿色标记本次写入${treeReady ? '' : ' · 工程树已单独重读'} · 可使用恢复基线回滚`)
          }
          // 展示层（抽屉）：写入成功 ⇒ 收起"上次失败"那件事（空闲时那一行也就整个消失）。
          setWritePhase('idle'); setWriteFailureDetail('')
          return {
            ok: true,
            sessionId: String(sessionIdRef.current || ''),
            projectPath: String(sourcePathRef.current || ''),
            written: writtenCount,
            deferredBuild: Boolean(deferredBuildId),
            buildId: deferredBuildId,
            // 只有"编译已经在这一趟里完成"时才回传计数；后台编译的计数由 build-status 那条路填。
            buildPending: Boolean(deferredBuildId),
            timings: { total: Number(timing.total) || 0, scriptEngineProcess: Number(timing.scriptEngineProcess) || 0, recoverySnapshot: Number(timing.recoverySnapshot) || 0 },
          }
        } catch (error) {
          const detail = String(error?.message || error).slice(0, 300)
          recordCapabilityBuild({ state: 'failed', mode: 'write', jobId, buildId: '', errorCount: 0, warningCount: 0, infoCount: 0, messages: [], omitted: 0, error: detail })
          // 引擎层的在线冻结（ONLINE_WRITE_FROZEN）不是"写坏了"：它一个字节都没写、也没有
          // 创建任何快照，所以**不许**套用下面那句"写前恢复快照已保留"（那句话会给用户一个
          // 假的事实）。如实回报那唯一一行原因 + 出路。界面自己的门（applyProposal 开头）
          // 通常先拦住；这一条是界面状态滞后时（比如刚在别处登录）的最后一道留痕。
          if (detail.includes('ONLINE_WRITE_FROZEN') || detail.includes('在线状态下不允许写入工程')) {
            setStatus(`已阻止写入：${CODESYS_ONLINE_WRITE_FROZEN_DETAIL}`)
            // 冻结不是"上次写入失败"（一个字节都没写）⇒ 展示层回到 idle，冻结由冻结档自己说。
            setWritePhase('idle'); setWriteFailureDetail('')
            return { ok: false, reason: 'online-write-frozen', detail: CODESYS_ONLINE_WRITE_FROZEN_DETAIL }
          }
          setStatus(`写入或编译失败：${error.message}；写前恢复快照已保留`)
          // 展示层（抽屉）：这次写入/编译失败了 —— 把手那一行改读「写入 · 上次写入失败」，
          // 原因原文留着，供用户点开看（关掉提示、收起抽屉都不会丢）。
          setWritePhase('failed'); setWriteFailureDetail(detail)
          return { ok: false, reason: 'write-failed', detail: `${detail}；写前恢复快照已保留` }
        } finally { setBusy(false); endConflictingWork() }
      }
      // ── 本轮：**放弃**（「确认写入」旁边那一枚；抽屉那枚走的是同一个函数）────────────────────
      //
      // 用户原话：「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」。
      // 它只做"减少待写入内容"这一件事，**一个字节都不写工程**：
      //   ① 作废 AI 提案与审查状态（提案 / 提案来源 / AI 说明 / 已核对 / 提案徽章）；
      //   ② 作废**用户手打**、还没写入的草稿（`clearAllObjectDrafts()` 覆盖"切走别的对象时
      //      存下来的"，选中项在编辑器里的实时文本由 ③ 的对齐一起退回）；
      //   ③ 编辑器与工程树退回**磁盘上的最新版本**：走既有只读 `inspect-project`（就是
      //      `recheckSourceOnDisk` 用的那条读法，按源 sha 失效缓存 —— 磁盘没变时命中缓存是廉价的），
      //      再用同一个 `alignEditorToDisk()` 把编辑器两段写回刚读到的字节。
      //      绝不 `apply-and-build` / `apply-changes` / `build` / `rollback`：放弃不写、不编译、不回滚。
      //   ④ 回到「等待 AI 改动」的空态（`writeStateLabel` 由 `effectiveChanges.length` 决定）。
      //
      // ⚠️ 安全语义一个字没动：**不推进** `lastWriteBaselineRef`（写入基线只能由真正的写入推进），
      //    所以放弃之后点「确认写入」，那条 sha 三态守卫照旧在 `apply-and-build` **之前**拦人。
      // 绿色 `written` 标记是"已经落盘"的事实，与放弃无关（T183 的口径），只清 agent / manual 两种。
      const discardProposal = async (options = {}) => {
        if (busy) return { ok: false, reason: 'workbench-busy', detail: '工作台正在执行另一项操作：等它结束再放弃。' }
        const hadProposal = Boolean(proposalRef.current?.changes?.length)
        const droppedDrafts = countUnsavedDrafts()
        if (!hadProposal && droppedDrafts === 0) {
          return { ok: false, reason: 'nothing-to-discard', detail: '工作台里没有待确认的提案，也没有手写改动：没有可以放弃的内容。' }
        }
        const endConflictingWork = beginConflictingWork()
        setBusy(true)
        // 展示层（抽屉）：放弃是"这件事已经结束"——上一次写入失败那条记录随待写入内容一起
        // 收起（详情里的失败原文不必永远挂在界面上）；放弃本身照旧一个字节都不写工程。
        setWritePhase('idle'); setWriteFailureDetail('')
        try {
          // ① 提案与审查状态 —— 与"作废过期提案"（`recheckSourceOnDisk`）用同一组写法定。
          if (hadProposal) setObjectChangeState(proposalKeys(proposalRef.current.changes, proposalRef.current), '')
          setProposal(null); setProposalSource(''); setAssistantText(''); setReviewAccepted(false); setAgentReloadAvailable(false)
          // ② 手写草稿（只有"待写入"的两种标记）。
          const pendingMarks = [...changeStateRef.current.entries()]
            .filter(([, value]) => value === 'agent' || value === 'manual')
            .map(([key]) => key)
          if (pendingMarks.length) setObjectChangeState(pendingMarks, '')
          clearAllObjectDrafts()
          // ③ 退回磁盘上的最新版本（只读重读；没有 jobId 就没有可读的工程，也就不可能有提案/草稿）。
          // 本轮：「放弃」有**两个**入口 —— 工作台那枚按钮（走当前渲染的闭包）与抽屉那枚
          // （走**安装时**那个能力面 seam，见下面 `React.useEffect(…, [])`）。后者的闭包是第一次
          // 渲染的，那时 `jobId` 还是空串，于是"退回磁盘最新版本"这一步会被整段跳过：提案与草稿
          // 清了，编辑器却还停在被放弃的那份 AI 文本上 —— 用户看到的就是"点了放弃，代码还在"。
          // 判据改成 ref（本组件里"异步回调读不到渲染值"一直都是走 ref 的同一个写法）。
          let editorReloaded = false
          const activeDiscardJob = String(jobIdRef.current || '')
          if (activeDiscardJob) {
            const loaded = await inspect(activeDiscardJob)
            editorReloaded = alignEditorToDisk(loaded)
          }
          // ④ 一行说清丢了什么（**绝不静默丢掉用户的字**）：有手写就报处数，没有就只说提案。
          setStatus(droppedDrafts > 0 ? `已放弃此提案与 ${droppedDrafts} 处手写改动` : '已放弃此提案')
          return {
            ok: true,
            sessionId: String(sessionIdRef.current || ''),
            hadProposal,
            droppedDrafts,
            editorReloaded,
            // 抽屉那一次点击（`options.fromChat`）用不到这个字段，留着是为了让两个面回报同一形状。
            source: options.fromChat === true ? 'chat' : 'workbench',
          }
        } catch (error) {
          const detail = String(error?.message || error).slice(0, 300)
          setStatus(`放弃失败：${detail}`)
          return { ok: false, reason: 'discard-failed', detail }
        } finally { setBusy(false); endConflictingWork() }
      }
      const rollback = async () => {
        if (busy || !jobId) return
        const accepted = await showTaskHiveDialog({
          title: '恢复到绑定基线',
          confirm: true,
          danger: true,
          acceptLabel: '恢复',
          message: '确认恢复到本次绑定时的基线？',
        })
        if (!accepted) return
        const endConflictingWork = beginConflictingWork()
        setBusy(true); setStatus('正在恢复工程基线…')
        try {
          // T183 第 4 项：回滚会改写工程内容 ⇒ 后台编译（它描述的是回滚**之前**的磁盘内容）
          // 的报告不再描述当前工程，停表。
          stopDeferredBuildWatch()
          // T167: 回滚同样改写了工程文件，基线必须跟着走 —— 否则回滚之后的第一次写入
          // 会把"我们刚回滚出来的版本"当成外部改动拦下来。
          const rolled = await run('rollback', { jobId, snapshotId: '000-baseline' })
          if (rolled?.currentSha256) lastWriteBaselineRef.current = String(rolled.currentSha256)
          await inspect(jobId); setProposal(null); setProposalSource(''); setAssistantText(''); setObjectChangeState([...changeStateRef.current.keys()], ''); clearAllObjectDrafts(); setStatus('当前工程已恢复到绑定时基线。')
        }
        catch (error) { setStatus(`回滚失败：${error.message}`) } finally { setBusy(false); endConflictingWork() }
      }
      // ── Online (PLC) actions ───────────────────────────────────────────────
      // The host owns both the authorization and the connection. These helpers
      // only report state and forward the operator's click; every refusal — the
      // download pre-flight included — is decided by the host.
      const onlineReady = onlineState?.ready || null
      const onlineTargetInfo = onlineReady?.target || null
      const onlineAddress = String(onlineTargetInfo?.address || '')
      const onlineDeviceId = String(onlineTargetInfo?.deviceIdentification || '')
      const onlineDeviceIdVersion = String(onlineTargetInfo?.deviceIdentificationVersion || '')
      const onlineIdentity = onlineDeviceId
        ? `${onlineDeviceId}${onlineDeviceIdVersion ? ` v${onlineDeviceIdVersion}` : ''}`
        : ''
      // A device left in simulation mode logs into a simulated controller, not the
      // machine. Saying so is the difference between "connected" and "connected to
      // the real thing".
      const onlineSimulationRaw = String(onlineTargetInfo?.simulationMode || '')
      const onlineSimulation = /^(true|1)$/i.test(onlineSimulationRaw)
      const onlineSimulationLabel = !onlineSimulationRaw
        ? '未读到'
        : (onlineSimulation ? '仿真（登录的是仿真 PLC，不是真机）' : '真实设备')
      const onlineGatewayChoices = Array.isArray(onlineReady?.gateways)
        ? onlineReady.gateways.filter((item) => item && (item.name || item.guid))
        : []
      // CODESYS 的「通信设置」：唯一能拿到真实 IP:端口的地方。经网关按节点地址
      // 连接的设备这里会是空的——那就如实说明，而不是显示一个假的 IP。
      const onlineCommSettings = onlineTargetInfo?.communicationSettings || null
      const onlineScannedName = String(onlineCommSettings?.scannedDeviceName || '')
      const onlineIpAndPort = String(onlineCommSettings?.ipAddressAndPort || '')
      const onlineIpLabel = onlineIpAndPort
        || (onlineAddress ? `未配置 IP（经网关节点地址 ${onlineAddress}）` : '未读到')
      // 型号 / 厂商：CODESYS「通信设置」里对**这台设备**的描述（scanned_target_type /
      // scanned_target_vendor）。它在登录前就能读到，因此是"登录会连到哪台机器"的一部分。
      // 读不到就留空，由调用处显示「未读到」—— 绝不在这里编一个型号出来。
      const onlineScannedType = String(onlineCommSettings?.scannedTargetType || '')
      const onlineScannedVendor = String(onlineCommSettings?.scannedTargetVendor || '')
      const onlineModelLabel = [onlineScannedType, onlineScannedVendor].filter(Boolean).join(' · ')
      const onlineDeviceLabel = onlineScannedName
        ? `${onlineScannedName}${onlineReady?.application ? ` · ${onlineReady.application}` : ''}`
        : (onlineReady
          ? `${onlineReady.deviceName || '设备'}${onlineReady.application ? ` · ${onlineReady.application}` : ''}`
          : '未识别目标设备')
      const onlineGatewayLabel = Array.isArray(onlineReady?.gateways) && onlineReady.gateways.length
        ? onlineReady.gateways.map((item) => item.name || item.raw || item.address || '').filter(Boolean).join(' / ')
        : ''
      const onlineConnected = onlineState?.state?.connected === true
      // 网关的"共享连接"弱信号：另有客户端（很可能就是 CODESYS IDE）持有这台设备的共享
      // 连接。它**只驱动一行提示**，不参与任何判断 —— 不改目标、不自动登录、不释放会话。
      const onlineSharedConnected = onlineState?.state?.sharedConnected === true
      // 应用层状态与设备标志（OperatingState 位标志）。这三个是现场最需要一眼看到的：
      // 有强制生效 / 应用异常 / 保持变量不匹配。
      const onlineAppLabel = String(onlineState?.state?.applicationStateLabel || '')
      const onlineOperationFlags = Array.isArray(onlineState?.state?.operationFlags) ? onlineState.state.operationFlags : []
      const onlineOperationWarnings = Array.isArray(onlineState?.state?.operationWarnings) ? onlineState.state.operationWarnings : []
      // 未连接时不渲染任何状态文字：登录成功才出现绿色标识，所以这里不再需要
      // "未连接/已连接" 的文案状态机。
      const onlineLoggedIn = onlineState?.state?.isLoggedIn === true
      // 本轮 B 项（冻结）：**已登录到应用** ⇒ 工作台的写入通路整体关闭（编辑栏只读、
      // 不产生草稿、确认写入与载入 AI 建议禁用，引擎层也会拒绝 ONLINE_WRITE_FROZEN）。
      // 判据只取宿主回报的应用层登录位（`state.isLoggedIn`），不看 `connected`：
      // 只是连上设备（未登录应用）时一切照旧 —— 那是"没登录"，不是"只读在线"。
      const onlineWriteFrozen = onlineLoggedIn
      // 「我登录/下载的是哪台设备」必须随时看得见。绑定过的目标由宿主写进作业元数据，
      // 在线进程重启后会回填到 ready.targetSource —— 所以这里的"已绑定"是持久的，
      // 不是"这次会话里点过一下"。
      const onlineTargetSource = onlineTargetSourceState || String(onlineReady?.targetSource || '')
      const onlineBound = onlineTargetSource === 'scan' || onlineTargetSource === 'manual' || onlineTargetSource === 'ip'
      const onlineBoundLabel = onlineReady?.boundTargetError
        ? '绑定未生效'
        : (onlineBound ? '已绑定' : '扫描设备')
      const onlineTargetSourceLabel = onlineBound
        ? (onlineTargetSource === 'ip'
          ? '已绑定（IP 直连）'
          : (onlineTargetSource === 'manual' ? '已绑定（本次手动填写）' : '已绑定（本次扫描选择）'))
        : '工程配置'
      // 来源标注：工程里配置的目标必须写明"取自工程配置"，否则用户分不清"这是工程里
      // 写的那台"和"这是我这一次点着绑的那台"。绑定过时不再重复标注（「扫描设备」按钮
      // 自己就写着"已绑定"，chip 上再写一遍是废话）。
      const onlineTargetSourceNote = onlineBound ? '' : '取自工程配置'
      const onlineTargetPicked = onlineConnected || Boolean(onlineReady)
      // 目标"读到了吗"：只有真的从工程副本里读出了东西（路由地址 / 设备识别 / 设备名 /
      // 网关）才算。未扫描、未登录时 `ready.target` 就是**工程里配置的目标**，所以这条
      // 让界面在用户还没做任何在线动作前就能显示"登录会作用到哪台设备"。
      // 读不到时什么都不显示：不复活"未选择"占位 chip，也不编一台设备出来。
      const onlineProjectTargetRead = Boolean(onlineReady
        && (onlineAddress || onlineIdentity || onlineScannedName || onlineReady.deviceName || onlineGatewayChoices.length))
      const onlineTargetKnown = onlineBound || onlineProjectTargetRead
      const onlineTargetSummary = onlineTargetPicked
        ? `${onlineDeviceLabel}${onlineIpLabel && !/^未(配置|读到)/.test(onlineIpLabel) ? ` · ${onlineIpLabel}` : ''}`
        : '未读取（点「扫描设备」读取并选择）'
      const onlineTargetDetail = [
        `设备：${onlineTargetPicked ? onlineDeviceLabel : '未读取'}`,
        `设备标识：${onlineIdentity || '未读到'}`,
        `型号 / 厂商：${onlineModelLabel || '未读到'}`,
        `设备 IP / 端口：${onlineIpLabel}`,
        `网关节点地址：${onlineAddress || '未读到'}`,
        `网关：${onlineGatewayLabel || '未读到'}`,
        `目标来源：${onlineTargetSourceLabel}`,
        ...(onlineReady?.boundTargetError ? [`⚠️ 绑定未能应用到在线进程：${onlineReady.boundTargetError}`] : []),
      ].join('\n')
      // 扫描面板的两行摘要：状态一句话，计时一行（进程 / 缓存轮 / 实时轮 / 合计）。
      const scanPhaseText = scanBusy
        ? (scanReport?.phase === 'cache' ? '正在读网关上次记录…' : '正在实时广播…')
        : (scanReport?.error ? '扫描失败' : (scanReport ? `发现 ${Number(scanReport.deviceCount || 0)} 台` : '尚未扫描'))
      const scanTimingText = scanBusy
        ? `已用 ${scanSeconds} 秒${scanReport?.phase === 'cache' && !scanReport?.prepareMs ? '（含启动 CODESYS 在线进程）' : ''}`
        : [
          scanReport?.sessionReused ? '进程 复用（未重启）' : (scanReport?.prepareMs ? `进程 ${codesysFormatMs(scanReport.prepareMs)}` : ''),
          scanReport?.cacheMs ? `缓存 ${codesysFormatMs(scanReport.cacheMs)}` : '',
          scanReport?.liveMs ? `实时 ${codesysFormatMs(scanReport.liveMs)}` : '',
          scanReport?.totalMs ? `合计 ${codesysFormatMs(scanReport.totalMs)}` : '',
        ].filter(Boolean).join(' · ')
      // 扫描两级：先 `scan{useCache:true}` 吃网关**上次扫描留下的记录**（很可能就是
      // CODESYS IDE 那次扫的），用户要新鲜结果再跑实时广播。每一轮的结果都带 `source`：
      //   'cache'          = 网关上次记录（近零成本，不广播）
      //   'live'           = 本次实时广播
      //   'cache-fallback' = 实时广播回空，退回网关记录（诚实标注，不是 live）
      // 必须写在设备行上：同样是"发现了这台设备"，来自缓存还是来自广播，可信度不一样。
      const scanSourceOf = (gateway) => String(gateway?.source || (scanReport?.mode === 'cached' ? 'cache' : 'live'))
      const scanSourceLabel = (source) => (source === 'cache'
        ? '网关上次记录'
        : (source === 'cache-fallback' ? '实时广播为空 · 回退网关记录' : '实时广播'))
      const scanSourceTitle = (source) => (source === 'cache'
        ? 'source: cache —— 网关上次扫描留下的记录，本次没有广播'
        : (source === 'cache-fallback'
          ? 'source: cache-fallback —— 本次实时广播没有回任何设备，这里显示的是网关上次记录'
          : 'source: live —— 本次实时广播发现的设备'))
      // 设备行：点一下就把该设备设为本次会话的在线目标。
      const scanRows = (() => {
        const found = []
        for (const gateway of (scanReport?.gateways || [])) {
          for (const device of (gateway.devices || [])) found.push({ gateway, device })
        }
        if (!found.length) {
          return [h('div', { key: 'empty', className: 'taskhive-codesys-compile-line is-info', 'data-codesys-scan-empty': 'true' },
            '没有发现设备。请确认 PLC 与本机在同一网段、CODESYS 网关服务正在运行；也可以点「上次记录」看看网关记过什么。')]
        }
        return found.map(({ gateway, device }, index) => h('button', {
          key: `${device.address || index}`,
          className: `taskhive-codesys-scan-row${String(device.address || '') && String(device.address) === String(onlineAddress || '') ? ' is-current' : ''}`,
          type: 'button',
          'data-codesys-scan-device': 'true',
          'data-codesys-scan-address': String(device.address || ''),
          title: `用作本次会话的在线目标：${device.name || '(未命名)'} @ ${device.address || '—'}\n只改工程副本的内存值：不写工程文件、不连接设备。`,
          onClick: () => { void applyScannedDevice({ device, gateway }) },
        },
        h('strong', null, device.name || '(未命名设备)'),
        h('span', { className: 'taskhive-codesys-scan-address' }, device.address || '—'),
        h('span', { className: 'taskhive-codesys-scan-kind' }, [device.vendor, device.type].filter(Boolean).join(' ') || '未知型号'),
        h('span', {
          className: 'taskhive-codesys-scan-source',
          'data-codesys-scan-source': scanSourceOf(gateway),
          title: scanSourceTitle(scanSourceOf(gateway)),
        }, scanSourceLabel(scanSourceOf(gateway))),
        h('span', { className: 'taskhive-codesys-scan-pick' }, '用作目标')))
      })()
      // 连接与传输都会真的作用到一台机器上，所以都要先把设备摆到眼前再动手。
      const confirmOnlineTarget = (title, extra) => showTaskHiveDialog({
        confirm: true,
        title,
        message: `${onlineTargetDetail}\n\n${extra}`,
        acceptLabel: '继续',
      })
      // 绑定 / 更换目标时用状态行说一句（用户口径：「应该只是一行提示字…不应该常驻」）。
      // 同一个目标只播报一次；目标没了（解除绑定/换工程）就重置，下次绑定还会再说。
      const targetAnnouncedRef = React.useRef('')
      React.useEffect(() => {
        if (!onlineBound) { targetAnnouncedRef.current = ''; return }
        const key = `${onlineTargetSource}|${onlineTargetSummary}`
        if (targetAnnouncedRef.current === key) return
        targetAnnouncedRef.current = key
        setStatus(`在线目标：${onlineTargetSummary} · ${onlineTargetSourceLabel}（登录/下载都会作用到它；要更换请点「扫描设备」）`)
      }, [onlineBound, onlineTargetSource, onlineTargetSourceLabel, onlineTargetSummary])
      const refreshOnline = async () => {
        try {
          const value = await window.taskhive?.codesysOnlineStatus?.()
          if (value) setOnlineState(value)
          return value
        } catch {
          return null
        }
      }

      // 所有在线动作的唯一出口。options 承载危险动作的参数（确认词 / 写值对 / 复位类型）。
      // 待办文案同时进"底部状态行"和"顶部待办徽标"：登录要等 20–40 秒，只把按钮变灰
      // 等于没有提示（现场口径：登录过程没有登录提示）。
      const CODESYS_ONLINE_PENDING_LABEL = {
        'online-login': '正在连接 PLC（首次会启动常驻在线进程，约 20–40 秒）',
        'online-logout': '正在断开 PLC',
        'online-download': '正在下载到 PLC（会停止设备上运行的应用，可能持续数分钟）',
        'online-change': '正在执行在线修改（不中断运行改代码；失败会自动改为完整下载）',
        'online-start': '正在启动应用（机械可能立即动作）',
        'online-stop': '正在停止应用',
        'online-reset': '正在复位设备',
        'online-write': '正在写入变量值',
        'online-force': '正在强制变量',
        'online-unforce': '正在取消全部强制',
      }
      const runOnline = async (action, options = {}) => {
        if (onlineBusy || !jobId) return
        setOnlineBusy(true)
        onlineBusyRef.current = true
        const ONLINE_PENDING_LABEL = {
          'online-login': '正在连接 PLC…（首次会启动常驻在线进程，约 20–40 秒）',
          'online-logout': '正在断开 PLC…',
          'online-download': '正在下载到 PLC…（会停止设备上运行的应用，可能持续数分钟）',
          'online-change': '正在执行在线修改…（不中断运行改代码；失败会自动改为完整下载）',
          'online-start': '正在启动应用…（机械可能立即动作）',
          'online-stop': '正在停止应用…',
          'online-reset': '正在复位设备…',
          'online-write': '正在写入变量值…',
          'online-force': '正在强制变量…',
          'online-unforce': '正在取消全部强制…',
        }
        setOnlinePending(CODESYS_ONLINE_PENDING_LABEL[action] || '正在执行在线动作')
        setStatus(ONLINE_PENDING_LABEL[action] || '正在执行在线动作…')
        try {
          let current = onlineState
          // One click is the gesture: the first online action also arms the
          // session-bound authorization, so a separate switch would only add a
          // step the operator already approved the removal of.
          if (!current?.authorization) {
            await window.taskhive?.armCodesysOnline?.({
              projectPath: sourcePath,
              windowId: activeProject?.windowId || '',
              capabilities: ['login', 'logout', 'download', 'online-change', 'write-variable', 'start', 'stop', 'reset', 'force'],
            })
            current = await refreshOnline()
          }
          const value = await window.taskhive?.runCodesysOnlineAction?.(action, {
            jobId,
            projectPath: sourcePath,
            windowId: activeProject?.windowId || '',
            connected: current?.state?.connected === true,
            loggedIn: current?.state?.isLoggedIn === true,
            // 'keep'（只登录、不传输）与 'transfer'（下载 / 在线修改建立的登录）在
            // 应用层动作上待遇不同，见 codesys-online-authorization.js。
            loginMode: current?.state?.loginMode || '',
            assignments: Array.isArray(options.assignments) ? options.assignments : undefined,
            // 写入 / 强制也要按所选对象解析变量（PROGRAM 局部量要写 实例名.变量），
            // 否则"看着成功、其实一个都没写进去"。
            scope: selected?.name || '',
            resetOption: options.resetOption || undefined,
            forceKill: options.forceKill === true,
            phrase: options.phrase || undefined,
            buildErrorCount: compileReport?.errorCount,
          })
          const after = await refreshOnline()
          const stateText = after?.state?.applicationState || '未知'
          if (action === 'online-login') {
            // 「登录」= 连接 + 只登录不传输（Keep）。登录成功就意味着在线变量能读值了，
            // 所以这里必须把"能看到值"说出来；而应用层动作（启停/复位/写变量/Force）
            // 仍然要「下载」——那一步才确认设备上跑的就是当前工程。
            const loginPayload = value?.payload || {}
            const appLoggedIn = loginPayload.isLoggedIn === true || after?.state?.isLoggedIn === true
            if (appLoggedIn) {
              setStatus(`已登录 PLC · ${after?.ready?.deviceName || '设备'} · 应用状态 ${stateText}（只登录、不传输；在线变量已开启，随登录自动显示：切到某个 POU，声明区/实现区里每个变量后面就是它此刻的当前值。启动/停止/复位/写变量/Force 仍需先「下载」）`)
            } else {
              const reason = loginPayload.applicationLoginError
                ? codesysOnlineErrorMessage(loginPayload.applicationLoginError)
                : '设备上没有可登录的应用'
              setStatus(`已连接 PLC · ${after?.ready?.deviceName || '设备'} · 应用状态 ${stateText}，但应用层登录未成功：${reason}。在线变量需要应用登录，请点「下载」把当前工程送到设备后再看。`)
            }
          } else if (action === 'online-logout') {
            setStatus('已断开 PLC，在线会话与授权已结束。')
          } else if (action === 'online-download') {
            setStatus(`下载完成 · 目标 ${value?.target?.deviceName || '设备'} · 应用状态 ${stateText} · 登录状态 ${after?.state?.isLoggedIn ? '已登录' : '未登录'}`)
          } else if (action === 'online-change') {
            setStatus(`在线修改完成 · 应用状态 ${stateText}`)
          } else if (action === 'online-start') {
            setStatus(`已启动应用 · ${
              value?.before || '?'} → ${value?.after || stateText}`)
          } else if (action === 'online-stop') {
            setStatus(`已停止应用 · ${value?.before || '?'} → ${value?.after || stateText}`)
          } else if (action === 'online-reset') {
            setStatus(`已复位（${value?.resetOption || 'warm'}）· 应用状态 ${value?.after || stateText}`)
          } else if (action === 'online-write') {
            setStatus(`已写入 ${Number(value?.count || 0)} 个变量（写入 ≠ 强制，程序下一周期会覆盖）`)
          } else if (action === 'online-force') {
            setStatus(`已强制 ${Number(value?.count || 0)} 个变量 · 当前强制中：${(value?.forcedExpressions || []).join(', ') || '（无法读取）'}。⚠️ 强制会覆盖程序输出，用完请点「取消强制」。`)
          } else if (action === 'online-unforce') {
            setStatus(`已取消全部强制（原有 ${Number(value?.count || 0)} 个）`)
          } else {
            setStatus('在线动作已完成。')
          }
        } catch (error) {
          setStatus(`在线动作失败：${codesysOnlineErrorMessage(error)}`)
          await refreshOnline()
        } finally {
          onlineBusyRef.current = false
          setOnlineBusy(false)
          setOnlinePending('')
        }
      }

      // 危险动作：先弹窗拿确认词与参数，再执行。
      const runDangerousOnline = async (action, capability, copy) => {
        if (onlineBusy || !jobId) return
        // 只登录不传输（Keep）的会话够看在线值，但不够启停机械：那时连"设备里跑的
        // 是哪一版程序"都没确认过。所以这里要求传输型登录（下载 / 在线修改）。
        if (onlineState?.state?.isLoggedIn !== true) {
          setStatus('尚未登录到应用：请先点「登录」（只登录、不传输）。')
          return
        }
        if (onlineState?.state?.loginMode !== 'transfer') {
          setStatus('当前是「只登录、不传输」的在线监视会话：启动/停止/复位/写变量/Force 需要先点「下载」或「在线修改」，以确认设备上的程序就是当前工程。')
          return
        }
        let assignmentRows = []
        if (capability === 'write-variable' || capability === 'force') {
          const lines = String(selected?.declaration || '').split('\n')
          assignmentRows = codesysMonitorExpressions(selected?.declaration).map((name) => {
            const lineIndex = lines.findIndex((line) => codesysMonitorExpressionForLine(line) === name)
            return {
              expression: name,
              value: '',
              // 与上一轮同义：只是把"面板上一次读到的值"预填进对话框，原始回报不做任何显示层
              // 加工（去 IEC 前缀是代码区**显示**规则）。行号在这里不再参与，值按变量名取。
              current: (lineIndex >= 0 ? onlineValueByName?.get(name.toLowerCase()) : '') || '',
            }
          })
        }
        const picked = await showCodesysOnlineDangerDialog({
          capability,
          title: copy.title,
          lines: copy.lines,
          confirmLabel: copy.confirmLabel,
          phrase: copy.phrase,
          resetMode: action === 'online-reset',
          assignments: assignmentRows,
        })
        if (!picked) return
        await runOnline(action, picked)
      }

      // Retarget this session. The picker writes to the throwaway project copy the
      // worker holds — the .project file is never saved, so the operator's
      // configuration is untouched. The host also revokes the armed authorization
      // on success, because the grant names a target.
      const applyOnlineTarget = async () => {
        if (targetBusy || !jobId) return
        const address = String(targetDraft.address || '').trim()
        if (!address) {
          setStatus('请填写设备节点地址后再应用（IP 直连请在「扫描设备」面板里填 IP）。')
          return
        }
        if (!targetDraft.gatewayName && !targetDraft.gatewayGuid) { setStatus('请选择网关后再应用。'); return }
        setTargetBusy(true)
        try {
          const result = await window.taskhive?.setCodesysOnlineTarget?.({
            jobId,
            gatewayName: targetDraft.gatewayName,
            gatewayGuid: targetDraft.gatewayGuid,
            address,
            ipAddress: '',
            port: 0,
            source: 'manual',
          })
          if (result?.ok) {
            setOnlineTargetSource('manual')
            await refreshOnline()
            setStatus(`已绑定在线目标 ${address}（仅本次会话；工程文件未改动）。请重新点「登录」。`)
          } else {
            setStatus(`设置目标失败：${codesysOnlineErrorMessage(result?.message || result?.reason || '未知原因')}`)
          }
        } catch (error) {
          setStatus(`设置目标失败：${codesysOnlineErrorMessage(error)}`)
        } finally {
          setTargetBusy(false)
        }
      }

      // 释放常驻在线会话：结束那个约 700 MB 的 CODESYS 进程，但保留授权。
      const releaseOnlineSession = async () => {
        if (targetBusy) return
        setTargetBusy(true)
        try {
          const result = await window.taskhive?.releaseCodesysOnline?.()
          await refreshOnline()
          setStatus(result?.releasedPid
            ? `已释放在线会话（结束 CODESYS 进程 PID ${result.releasedPid}）。下次「登录」会重新启动它，约 20–40 秒。`
            : '已释放在线会话。')
        } catch (error) {
          setStatus(`释放在线会话失败：${codesysOnlineErrorMessage(error)}`)
        } finally {
          setTargetBusy(false)
        }
      }

      // 打开目标面板 = 打开底部「扫描设备」面板（唯一的入口），并把当前目标预填进
      // 手动绑定那一行。没枚举到网关时先拉一次，否则手动绑定会因为"请选择网关"失败。
      const openOnlineTargetPanel = () => {
        setTargetDraft((draft) => ({
          ...draft,
          gatewayName: draft.gatewayName || onlineGatewayLabel || String(onlineGatewayChoices[0]?.name || ''),
          gatewayGuid: draft.gatewayGuid || String(onlineTargetInfo?.gatewayGuid || onlineGatewayChoices[0]?.guid || ''),
          address: draft.address || onlineAddress,
        }))
        void openScanDialog()
        if (!onlineGatewayChoices.length && jobId) {
          void (async () => {
            setStatus('正在读取可用网关（会启动一次在线进程，约 20–40 秒；只读工程副本，不连接 PLC）…')
            try {
              await window.taskhive?.prepareCodesysOnline?.({ jobId })
              await refreshOnline()
              setStatus('已读到可用网关。选好网关与地址后点「用作目标」即可绑定。')
            } catch (error) {
              setStatus(`读取可用网关失败：${codesysOnlineErrorMessage(error)}（也可以点「上次记录」让扫描面板顺带把网关读出来）`)
            }
          })()
        }
      }

      // 「扫描设备」= 底部面板（和「编译输出」同一形态，用户口径："改成和编译一样的底部弹出"）。
      // 两轮：先用网关上次记录秒回一版，再跑实时广播替换。两轮的耗时、以及启动/复用
      // CODESYS 在线进程的耗时，都记进 scanReport 显示出来。
      const runScan = async (useCache) => {
        if (!jobId) return
        const startedAt = Date.now()
        setScanBusy(true)
        setScanReport((current) => ({
          ...(current || {}),
          phase: useCache ? 'cache' : 'live',
          startedAt,
          cacheMs: useCache ? 0 : (current?.cacheMs || 0),
          error: '',
        }))
        try {
          const result = await window.taskhive?.scanCodesysOnlineDevices?.({ useCache: useCache === true, jobId })
          const elapsed = Date.now() - startedAt
          if (result?.ok) {
            setScanReport((current) => ({
              ...(current || {}),
              phase: 'done',
              // 成功的这一轮必须清掉上一轮的错误：缓存轮失败、实时轮成功时，
              // 面板不能继续挂着"扫描失败"（现场截图就是这个中间态）。
              error: '',
              startedAt,
              gateways: result.gateways || [],
              deviceCount: result.deviceCount || 0,
              mode: result.mode || '',
              cacheMs: useCache ? elapsed : (current?.cacheMs || 0),
              liveMs: useCache ? (current?.liveMs || 0) : elapsed,
              prepareMs: result.timings?.prepareMs ?? current?.prepareMs ?? 0,
              scanMs: result.timings?.scanMs ?? 0,
              totalMs: result.timings?.totalMs ?? 0,
              sessionReused: result.timings?.sessionReused === true,
            }))
          } else {
            setScanReport((current) => ({
              ...(current || {}),
              phase: 'error',
              startedAt,
              error: codesysOnlineErrorMessage(result?.message || result?.reason || '扫描失败'),
            }))
          }
        } catch (error) {
          setScanReport((current) => ({ ...(current || {}), phase: 'error', startedAt, error: codesysOnlineErrorMessage(error) }))
        } finally {
          setScanBusy(false)
        }
      }

      // 打开面板并跑一轮：先缓存（秒回）再实时广播。
      const openScanDialog = async () => {
        if (scanBusy || !jobId) return
        setScanOpen(true)
        setScanReport({ phase: 'cache', startedAt: Date.now(), gateways: [], deviceCount: 0, error: '' })
        await runScan(true)
        await runScan(false)
      }

      // IP 直连：填了 IP 直接绑定，**不需要先扫描**（用户口径：「ip 直连不需要是不要扫描设备，
      // 直接输入 ip 进行连接 plc」）。网关沿用扫描结果 / 在线进程已读到的那个；一个都还没有时
      // 先自动跑一次「上次记录」（只读网关列表，不广播、不连接设备）再绑定。
      const applyDirectIp = async () => {
        if (targetBusy || !jobId) return
        const ipAddress = String(ipDraft.ipAddress || '').trim()
        const port = Number(ipDraft.port) || 0
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress)) {
          setStatus('请填写合法的 IPv4 地址（形如 192.168.31.58）。')
          return
        }
        if (onlineConnected) {
          setStatus('已连接状态下不能更改目标，请先「断开」。')
          return
        }
        setTargetBusy(true)
        try {
          let gatewayName = String(scanReport?.gateways?.[0]?.gatewayName || onlineGatewayLabel || '').trim()
          let gatewayGuid = String(scanReport?.gateways?.[0]?.gatewayGuid || onlineTargetInfo?.gatewayGuid || '').trim()
          if (!gatewayName && !gatewayGuid) {
            // 还没读到任何网关：静默补一次缓存轮（秒回），只为拿到网关。
            setStatus('正在读取可用网关（只读网关列表，不广播、不连接设备）…')
            const cached = await window.taskhive?.scanCodesysOnlineDevices?.({ useCache: true, jobId })
            gatewayName = String(cached?.gateways?.[0]?.gatewayName || '').trim()
            gatewayGuid = String(cached?.gateways?.[0]?.gatewayGuid || '').trim()
          }
          if (!gatewayName && !gatewayGuid) {
            setStatus('没有读到可用网关，无法建立 IP 直连路由：请先点「上次记录」或「重新扫描」把网关读出来（只读网关，不连接设备）。')
            return
          }
          setStatus(`正在把 ${ipAddress}${port ? `:${port}` : ''} 绑定为在线目标…`)
          const bound = await window.taskhive?.setCodesysOnlineTarget?.({
            jobId, gatewayName, gatewayGuid, ipAddress, port, source: 'ip',
          })
          setOnlineTargetSource('ip')
          await refreshOnline()
          setStatus(bound?.deferred === true
            ? `已绑定 IP 直连目标 ${ipAddress}${port ? `:${port}` : ''}（在线进程未运行，点「登录」时自动应用；工程文件未改动）。注意：IP 模式没有读回接口，能否连上只能靠「登录」验证。`
            : `已绑定 IP 直连目标 ${ipAddress}${port ? `:${port}` : ''}（仅本次会话，工程文件未改动）。请点「登录」。注意：IP 模式没有读回接口，能否连上只能靠「登录」验证。`)
        } catch (error) {
          setStatus(`绑定 IP 直连目标失败：${codesysOnlineErrorMessage(error)}`)
        } finally {
          setTargetBusy(false)
        }
      }

      // 面板里选中一台设备 = 写成本次会话的在线目标（只改工程副本的内存值）。
      const applyScannedDevice = async (picked) => {
        if (!picked?.device) return
        const draft = {
          gatewayName: String(picked.gateway?.gatewayName || onlineGatewayLabel || ''),
          gatewayGuid: String(picked.gateway?.gatewayGuid || ''),
          address: String(picked.device.address || ''),
        }
        setTargetDraft(draft)
        setStatus(`已选择 ${picked.device.name || picked.device.address} · 正在绑定为在线目标…`)
        try {
          const bound = await window.taskhive?.setCodesysOnlineTarget?.({ jobId, ...draft, source: 'scan' })
          setOnlineTargetSource('scan')
          await refreshOnline()
          setStatus(bound?.deferred === true
            ? `已绑定 ${picked.device.name || ''} ${draft.address}（本次扫描选择；在线进程未运行，点「登录」时自动应用；工程文件未改动）。`
            : `已绑定 ${picked.device.name || ''} ${draft.address}（本次扫描选择；仅本次会话，工程文件未改动）。请点「登录」。`)
        } catch (error) {
          setStatus(`绑定在线目标失败：${codesysOnlineErrorMessage(error)}`)
        }
      }

      // Online status is polled slowly and re-read whenever the bound project
      // changes. The host owns the truth; this only mirrors it, and it never
      // probes the engine.
      // 轮询节奏：已连接时 8 秒（要看 PLC 状态），未连接时 60 秒（只需知道会话是否还在）。
      // 常驻 CODESYS 进程约 700 MB，所以没必要时不要每 10 秒去敲它一次。
      // 每一次状态探测都要穿过 IPC → 引擎 → 常驻在线进程的**串行命令队列**，而那个
      // 队列同时也在跑在线变量读值：探测太密就是"登录之后卡顿"的来源之一。所以这里
      // 放慢到 8 秒，并且页面不可见时完全不问。
      React.useEffect(() => {
        if (!jobId) { setOnlineState(null); return undefined }
        let cancelled = false
        const tick = () => {
          if (cancelled || onlineBusyRef.current) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          void refreshOnline()
        }
        tick()
        const timer = setInterval(tick, onlineConnected ? 8000 : 60000)
        return () => { cancelled = true; clearInterval(timer) }
      }, [jobId, sourcePath, onlineConnected])

      // Read the configured target as soon as a project is bound, so the operator
      // can SEE which controller a login would reach BEFORE being allowed to
      // connect. Preparing starts a CODESYS process but performs no PLC action.
      // 每个作业只自动做这一次：常驻在线进程空闲 10 分钟会自己退出（这是刻意的，
      // 不能靠轮询把它留活），而"切回工作台 → 又悄悄起一个 700 MB 的 CODESYS"正是
      // 卡顿的来源。退出之后由用户点「登录」/「扫描设备」明确重启。
      React.useEffect(() => {
        if (!jobId || !sourcePath) return undefined
        let cancelled = false
        void (async () => {
          if (codesysPreparedJobs.has(jobId)) {
            const value = await refreshOnline()
            if (!cancelled && value && value.running !== true) {
              setStatus('在线进程当前没有运行（空闲 10 分钟会自动释放，这是刻意的）。要重新启动它请点「登录」或「扫描设备」，首次约 20–40 秒。')
            }
            return
          }
          codesysPreparedJobs.add(jobId)
          try {
            await window.taskhive?.prepareCodesysOnline?.({ jobId })
          } catch (error) {
            // 不再静默吞掉：准备失败时如实说明，并指出点「扫描设备」或「登录」会自动重试。
            if (!cancelled) setStatus(`在线会话准备失败：${codesysOnlineErrorMessage(error)}（点「扫描设备」或「登录」会自动重试）`)
          }
          if (!cancelled) await refreshOnline()
        })()
        return () => { cancelled = true }
      }, [jobId, sourcePath])

      // 这里**故意不再**解绑在线会话（历史上有一句
      // `React.useEffect(() => () => disarmCodesysOnline({reason:'workbench-closed'}), [])`）。
      //
      // 旧策略是"授权不能活得比它所属的界面久"：组件一卸载就 disarm，而宿主收到
      // disarm 会 stopOnlineSession() —— 于是**只要切一下标签/界面，PLC 连接就断了**
      // （现场口径：「在线数据掉线，难不成因为我切屏掉线？」—— 是的，就是这条）。
      // 它把最主要的用法（登着看在线值、来回切着改代码）直接弄坏了。
      //
      // 现在的边界：
      //   · 授权仍然绑定**工程 + CODESYS 窗口**：切工程(project-rebound)、关 CODESYS
      //     窗口、点「断开」或「释放在线会话」都会立刻失效；
      //   · 危险动作（下载/启停/复位/写值/Force）本来就要逐条确认与逐字确认词，
      //     不靠"关掉界面"兜底；
      //   · 没人用的会话由常驻进程自己的空闲上限收掉（10 分钟没有任何命令就退出），
      //     不会因为切了屏就一直占着 PLC 与那约 700 MB 内存。

      // 主进程新旧自检。界面（插件 JS）刷新一次就是新的，但 app/main.js、
      // scriptengine.cjs、online-session.cjs 只在 TaskHive 启动时加载 —— 现场连着两次
      // 踩"新界面 + 旧引擎"（表现是旧写法的报错，例如固定名 online-worker.py 的 EBUSY）。
      // 判据：新通道 codesys:engine-freshness 调用成功 ⇒ 主进程不旧；成功但 stale ⇒
      // 引擎文件在启动后被改过。两种情况都直接告诉用户"重启 TaskHive 才生效"。
      const [engineFreshness, setEngineFreshness] = React.useState(null)
      React.useEffect(() => {
        let cancelled = false
        void (async () => {
          try {
            const value = await window.taskhive?.codesysEngineFreshness?.()
            if (cancelled) return
            if (!value || value.ok !== true) { setEngineFreshness({ stale: true, reason: 'no-bridge' }); return }
            setEngineFreshness({ stale: value.stale === true, changed: value.changed || [], loadedAt: value.loadedAt || '' })
          } catch {
            // 通道不存在 = 主进程是旧的（这正是要提示的情形）。
            if (!cancelled) setEngineFreshness({ stale: true, reason: 'channel-missing' })
          }
        })()
        return () => { cancelled = true }
      }, [jobId])

      // ── Online value monitoring (state only) ───────────────────────────────
      // Only meaningful once the application is logged in — and in this design the
      // only thing that logs the application in is a confirmed download. So the
      // values always describe the code the operator just transferred, never a
      // guess at what might be running.
      // The effect and the line mapping live further down, after `oldDeclaration`
      // exists: a dependency array is evaluated during render, so referencing it
      // here would hit its temporal dead zone.
      const [onlineValues, setOnlineValues] = React.useState(null)

      const aiChanges = proposal?.changes || []
      const pendingObjects = aiChanges.filter((change) => codesysProposalOperation(change, objects, proposal).startsWith('create-')).map((change) => ({ name: String(change.objectName || ''), type: `${codesysProposalOperation(change, objects, proposal)} · 待新增`, guid: '', hasDeclaration: true, hasImplementation: codesysProposalOperation(change, objects, proposal) === 'create-pou', __proposalChange: change, __parentName: String(change.parentName || ''), __pendingKey: `pending:${codesysProposalOperation(change, objects, proposal)}:${String(change.objectName || '').toLowerCase()}` }))
      const displayObjects = [...objects, ...pendingObjects]
      const selected = displayObjects.find((item) => (item.__pendingKey || codesysObjectKey(item)) === selectedKey) || null
      const aiProposed = selected?.__pendingKey ? selected.__proposalChange : aiChanges.find((item) => resolveCodesysProposalObject(item, objects) === selected) || null
      // CODESYS' ST editor keeps the DECLARATION and the IMPLEMENTATION apart,
      // each with its own line numbering starting at 1. One concatenated
      // textarea could only number them continuously (so the implementation's
      // line numbers never matched CODESYS) and it forced the manual edit to be
      // split on the first blank line — which silently moved text into the wrong
      // section whenever a declaration contained a blank line.
      const oldDeclaration = String(selected?.declaration || '')
      const oldImplementation = String(selected?.implementation || '')

      // ── Online value monitoring (engine) ───────────────────────────────────
      // Declared HERE, after `oldDeclaration`: a hook dependency array is evaluated
      // during render, so referencing it any earlier hits the temporal dead zone.
      //
      // 只登录、不传输（Keep）也算"已登录"，所以点「登录」就能看到在线值 —— 这正是
      // 这一段存在的意义（此前登录只连设备，isLoggedIn 一直是 false，于是这里从头
      // 到尾没跑过，界面上就是"登录上了却一个在线值都没有"）。
      //
      // 轮询必须便宜，否则它会把常驻在线进程的命令队列占满，体感就是"一登录就卡"：
      //   · 同一时刻只允许一个请求在飞（读得慢时不再叠加请求）；
      //   · 值没变就不 setState（否则每 1.5 秒整棵编辑区重渲染一次）；
      //   · 读得慢就自动退避（1.5s → 最多 6s），页面不可见时完全不读。
      // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：这一段的总闸从
      // 「开关打开」改成**登录状态本身** —— 已登录到应用就一直读（值因此不用点任何东西就
      // 出现在每个变量后面）；未登录则一句都不读、一个值都不画，编辑栏照旧可编辑。
      // 读的节拍仍是面板既有的那一条（1.5s、慢读退避到 6s、值没变不重绘、页面不可见不读），
      // **没有新增定时器**；登录后停止/退出登录，这个 effect 立刻拆掉定时器并清空值。
      React.useEffect(() => {
        if (!jobId || !onlineLoggedIn || !workbenchVisible) { setOnlineValues(null); return undefined }
        // 简单变量读自己，FB 实例读它的关键成员（原生 CODESYS 就是展开实例看成员值）。
        // 简单变量排在前面（分批时它们落在最前面的批次里）。
        const variables = codesysMonitorVariables(oldDeclaration)
        const simple = []
        const members = []
        for (const variable of variables) {
          const list = codesysMonitorExpressionsFor(variable)
          if (!list.length) continue
          if (list.length === 1) simple.push(list[0])
          else members.push(...list)
        }
        // 用户规则原文：「上限去除」。这里**没有**任何条数截断 —— 所有可监视的声明/成员
        // 表达式都进读数集，第 90 个之后一样读、一样在它自己的位置显示值（旧写法是
        // `[...simple, ...members].slice(0, 90)`，于是第 90 个之后永远只剩占位符 `—`）。
        //
        // 真正的边界不在客户端而在下游：一次 `monitor` 能带多少条表达式由引擎定
        //（`scriptengine.cjs` 的 `onlineMonitor` 与在线工作进程的 `do_monitor` 都夹在
        //  120 条 —— 它护住的是**串行**的命令队列和 20 s 的 IPC 超时，不该被绕过）。
        // 所以这里**跨节拍分批**：一个节拍只发一批，批次大小由引擎的第一次回执自己定
        //（`value.expressions` 就是它真正收下的那一份）—— 客户端不再写死一个数字，
        // 引擎侧的上限改了这里自动跟上。节拍仍然是既有的那一条 1.5 s（慢读退避到 6 s），
        // 仍然单飞，**不新增任何定时器**；值按"表达式 → 值"累积，一批一批补齐。
        const expressions = [...new Set([...simple, ...members])]
        if (!expressions.length) { setOnlineValues(null); return undefined }
        let cancelled = false
        let inFlight = false
        let timer = null
        let signature = ''
        let delay = 1500
        // 分批状态（见上面「上限去除」那一节）：`cursor` 是下一批的起点；`batchSize = 0`
        // 表示"引擎还没告诉过我们它一次能收多少"—— 第一次先整批发出去，由回执校准。
        let cursor = 0
        let batchSize = 0
        // 表达式 → 已观测到的值。跨批次累积，所以后面的批次不会把前面读到的抹掉。
        const observed = new Map()
        const tick = async () => {
          if (cancelled || inFlight || onlineBusyRef.current) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          // 用户正在滚动/选择：这一个节拍不读、不 setState ⇒ 画面在中途不变（读起来不被打断）。
          // 时间戳由 textarea 自己的 onScroll / onSelect 写（用户真的做了那个动作才会写），
          // 停下约 1 秒后的下一个节拍自然恢复。这里**没有**新增任何定时器。
          if (Date.now() - lastUserActivityRef.current < CODESYS_ONLINE_VALUE_ACTIVITY_PAUSE_MS) return
          // 这一拍读哪一批：引擎报过上限就按那个条数切，没报过就先整批发一次（它自己会
          // 截到它的上限，并如实把收下的那一份回带回来）。
          const size = batchSize > 0 ? batchSize : expressions.length
          const start = cursor % expressions.length
          const batch = expressions.slice(start, start + size)
          if (!batch.length) return
          inFlight = true
          const startedAt = Date.now()
          try {
            const value = await window.taskhive?.monitorCodesysOnline?.({
              jobId,
              projectPath: sourcePath,
              expressions: batch,
              // 所选对象的名字：PROGRAM 的局部量只有写成 实例名.变量 才读得到
              // （实测：permit 无效、Jog.permit = FALSE），GVL 的全局量两种都行。
              scope: selected?.name || '',
            })
            if (cancelled) return
            if (value?.ok) {
              // 引擎如实回带它**真正收下**的那一份表达式（可能因它自己的上限比我们发的短）。
              const names = value.expressions || batch
              const values = (value.values || []).map((item) => String(item ?? ''))
              // 第一次发现"它收下的比我们发的少"⇒ 那就是它一次的上限，用它当批次大小。
              // 只校准一次，而且不写死数字：引擎侧改了上限这里自动跟上。
              if (!batchSize && names.length > 0 && names.length < batch.length) batchSize = names.length
              // 引擎自报的"这一拍没读"清单（`errors[].expression`）。真机证据（POU `AXIS_X_PRG`
              // 的 online-result 帧）：批量读失败后 worker 逐条回退，而逐条回退有自己的上限与
              // 时间预算（`MONITOR_PER_EXPRESSION_MAX = 24` / 4 s）—— 那一帧 27 条里最后的
              // `ePowerErrorDiag.Busy/Done/Error` 就是这样被标出来的：**值回带空串、`errors[]`
              // 里如实记一条**，而 `expressions` 照旧回带整份清单。
              //
              // 所以"回带的空串"有两种完全不同的含义，必须分开处理（否则就是把已经读到的好值
              // 抹掉：界面上那些变量会在 `—` 和真值之间来回闪）：
              //   · 它在 `errors` 里 ⇒ 这一拍**没读**，保留面板上一次观测到的值（T199 的口径：
              //     快照给的是"面板上一次读到的结果"，不是"这一拍没读到"）；也不推进游标，
              //     下一拍换一个起点，它就会落到引擎这一拍真能读的靠前位置 —— 于是最终都读得到。
              //   · 它不在 `errors` 里 ⇒ 这一拍**读了**，返回什么就存什么（空串也是真实的值，
              //     例如一个内容为空的 STRING），一个比特都不改。
              const unread = new Set(
                (Array.isArray(value.errors) ? value.errors : [])
                  .map((item) => String(item?.expression || ''))
                  .filter(Boolean),
              )
              let filled = 0
              for (let index = 0; index < names.length; index += 1) {
                const name = String(names[index] || '')
                if (unread.has(name)) continue
                observed.set(name, String(values[index] ?? ''))
                filled += 1
              }
              cursor = (start + Math.max(1, filled)) % expressions.length
              // 进指纹、进快照的都是**整份读数集**：已经观测到的带值，还没轮到的如实留空
              //（界面上就是那一个淡色 `—`，下一拍轮到它就有值了）。这里的空串只有一个含义：
              // "这一条还没轮到"，它不是编出来的值 —— 引擎真的回报空串时它本来也长这样。
              const ordered = expressions.map((name) => (observed.has(name) ? observed.get(name) : ''))
              const next = `${value.applicationState || ''}|${expressions.join(',')}|${ordered.join(',')}`
              if (next !== signature) {
                signature = next
                setOnlineValues({ expressions, values: ordered, applicationState: value.applicationState || '', at: Date.now() })
              }
            } else if (signature !== 'off') {
              signature = 'off'
              setOnlineValues(null)
            }
          } catch {
            // A failed read must never disturb editing; drop back to no-values.
            if (!cancelled && signature !== 'off') { signature = 'off'; setOnlineValues(null) }
          } finally {
            inFlight = false
            // 读一次花了多久，下一次就至少等同样久：慢的在线连接只会越读越慢，
            // 固定间隔会把请求堆起来，反而把界面拖卡。
            const elapsed = Date.now() - startedAt
            delay = elapsed > 1200 ? Math.min(6000, Math.max(1500, elapsed * 2)) : 1500
          }
        }
        const schedule = () => {
          if (cancelled) return
          timer = setTimeout(() => { void tick().then(schedule) }, delay)
        }
        void tick().then(schedule)
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
      }, [jobId, sourcePath, onlineLoggedIn, workbenchVisible, oldDeclaration, selected?.name || ''])

      // ── 本轮修正（"消掉登录时那一次右推"）：**等到首笔读数到达再一起画** ─────────────
      // 病灶（T219 遗留取舍）：登录瞬间镜像层先按每种类型的下限画 `—`；`floor=0` 的类型
      // （STRING/WSTRING/REAL/LREAL/TIME/DATE…）与 FB 成员摘要**给不出宽度上限**，槽宽只剩
      // `—` 的 1 个字，首笔真值比它宽时 `onlineValueSlotRef` 扩一次 ⇒ 那一刻它后面的代码
      // **右移一次**（"登录时那一次右推"）。
      // 修法：首笔读数到达之前**一个值都不画**（连 `—` 也不画，见下面两张段落表的总闸）。
      // 于是每个位置**第一次**画出来时，槽宽就已经是真实值定下来的终态 —— 第一次写进
      // onlineValueSlotRef 的就是它，"只增不缩"因此不会在登录时被触发；`floor>0` 的整数型
      // 照旧先用类型上限（它们本来就不会推）。
      // 它是**闩**而不是开关：拿到过读数之后，某一拍读失败只把值换成 `—`，镜像层绝不整层
      // 消失（整层消失会把代码整段抽回去、下一拍再推出来 —— 那比原来更糟）；退出登录 /
      // 工作台不可见 ⇒ 复位。判据只用既有的两个信号（登录状态 + 读数批次），
      // **不新增定时器、不新增读取、不新增开关**。
      const [onlineValuesSeen, setOnlineValuesSeen] = React.useState(false)
      React.useEffect(() => {
        if (!onlineLoggedIn || !workbenchVisible) { setOnlineValuesSeen(false); return }
        if (onlineValues) setOnlineValuesSeen(true)
      }, [onlineLoggedIn, workbenchVisible, onlineValues])
      // 画值总闸：首笔读数**已经到达**（`onlineValues` 非空即到达；闩住之后一直为真）。
      const onlinePaintReady = onlineValuesSeen || onlineValues !== null

      // Line -> value, so the declaration column can paint CODESYS-style values.
      // 一个变量名 -> 它自己的值（简单变量）或它成员的 "成员=值"（FB 实例）。
      // （本轮起不再有"值列"：这张表只用来给**就地**的段落表查值，见下面两张段落表。）
      const onlineValueByName = React.useMemo(() => {
        if (!onlineValues) return null
        const map = new Map()
        const names = onlineValues.expressions || []
        const values = onlineValues.values || []
        names.forEach((name, index) => {
          const value = String(values[index] ?? '')
          if (!value) return
          map.set(String(name || '').toLowerCase(), value)
        })
        return map.size ? map : null
      }, [onlineValues])

      // 本轮（样式 A）占位符：一个破折号，且**只**出现在"这里真的有变量、但面板还没观测到
      // 值"的位置；空行/注释/语法行保持空白，所以"未知"不会刷屏。（上一轮是一个中点 `·`。）
      const CODESYS_ONLINE_VALUE_UNKNOWN = '—'

      // 值 span 左右各 3px 内边距（60-skin-and-embedded-surfaces.js 那条规则里），所以稳定槽
      // 的 `min-width` 要在 N 个字符宽之外再加这 6px（配合 box-sizing:border-box）。
      // 两个数字必须一致：行为契约会把这里解析出来和样式里的 padding 对一遍。
      const CODESYS_ONLINE_VALUE_SLOT_PADDING = 6
      // 用户滚动/选中之后暂停读数的时间：约 1 秒（既有的 1.5 s 节拍上不加定时器）。
      const CODESYS_ONLINE_VALUE_ACTIVITY_PAUSE_MS = 1000
      // 用户真的动了编辑区（滚动 / 选中）时记一个时刻。只写这一个时间戳：它不触发任何
      // 重渲染、不产生任何 IPC、不新增定时器 —— 读数节拍自己会看它（见 tick）。
      const noteCodesysUserActivity = () => { lastUserActivityRef.current = Date.now() }
      // 槽宽 -> 内联样式。`ch` 在等宽字体里就是"一个字符的宽度"，而这一层的字体被钉死成
      // ui-monospace/Consolas（60-skin… 的 .taskhive-codesys-inline-online），所以 N·ch 就是
      // N 个字符宽。`min-width` 只是**下限**：值比槽宽时盒子照旧跟着长，绝不裁切。
      const onlineValueSlotStyle = (slot) => ({ boxSizing: 'border-box', minWidth: `calc(${Math.max(1, Number(slot) || 1)}ch + ${CODESYS_ONLINE_VALUE_SLOT_PADDING}px)` })

      // 一个变量此刻就地显示什么：优先它自己的值，其次它成员的「成员=值」摘要（FB 实例，
      // 最多三个成员 —— 与上一轮声明区显示的宽度一致，没有变弱），都没有就是这个变量
      // "读不到" ⇒ 淡色 `—`。`lower` 可以是整条点号路径：面板真的读到过这个成员就直接用它
      // 自己的值，读不到才退回实例的成员摘要。显示只去 IEC 类型前缀（`UDINT#2048576000`
      // → `2048576000`），**原始回报**一字不改地随 `raw` 走到数据属性与 title 上。
      //
      // 本轮 B 项：返回值多了一个 `slot`（这个值占多少个字符宽的稳定槽）。
      //   slot = max(该变量 IEC 类型的最大文本宽度, 历史上见过的最宽值, 这一次的值) —— 只增不减。
      // 于是值一变只可能在"真的见到更宽的值"时扩一次，之后的每一次刷新都落在同一个槽里，
      // 它后面的代码不再被左右推；未知的 `—` 也用同一个槽（"读到/读不到"切换同样不跳）。
      // 槽宽只进 onlineValueSlotRef（纯版面缓存），不进 onlineValues、不进任何上报/写入。
      const codesysOnlineInlineValue = React.useCallback((lower, declaredType) => {
        const slotFor = (text) => {
          const slots = onlineValueSlotRef.current
          const previous = Number(slots.get(lower)) || 0
          const wanted = Math.max(previous, codesysOnlineValueSlotFloor(declaredType), String(text || '').length)
          if (wanted !== previous) slots.set(lower, wanted)
          return wanted
        }
        const direct = onlineValueByName?.get(lower)
        if (direct) {
          const display = codesysDisplayValue(direct)
          return { display, raw: direct, slot: slotFor(display) }
        }
        const parts = []
        for (const [key, value] of onlineValueByName || []) {
          if (!key.startsWith(`${lower}.`)) continue
          parts.push(`${key.slice(lower.length + 1)}=${value}`)
          if (parts.length >= 3) break
        }
        const member = parts.join('  ')
        if (member) {
          const display = codesysDisplaySummary(member)
          return { display, raw: member, slot: slotFor(display) }
        }
        // 未知：占位符也走同一个槽（这个变量以前读到过多宽的值，这里就留多宽）。
        return { unknown: true, slot: slotFor(CODESYS_ONLINE_VALUE_UNKNOWN) }
      }, [onlineValueByName])


      // 声明区：按**当前正在渲染的文本**逐行解析（不是磁盘上的旧文本），所以用户手打草稿时
      // 值与行仍然对得上；并且**一次性覆盖整份代码的所有行**（不是只算"渲染出来的行"），
      // 每行一次廉价的行解析（O(行数)，1003 行实测 0.8 ms）。渲染只从这张"行 → 段落"表取，
      // 所以滚到底最后一行和第一行一样有值。
      //
      // 值**就地**跟在变量 token 后面（同一行、同一段流）：`  MaxVel 2048576000 : UDINT;`。
      // 本轮：判据只剩 `onlineLoggedIn`（未登录 ⇒ 这张表恒为 null ⇒ 一个值都不画）。
      const onlineInlineByLine = React.useMemo(() => {
        if (!onlineLoggedIn) return null
        // 本轮修正：**首笔读数到达之前一个值都不画**（理由见 onlinePaintReady）。
        // 这一条就是"登录时不再右推"本身：没有"先占 1 个字的 `—`、首笔真值再扩槽"这一步。
        if (!onlinePaintReady) return null
        const map = new Map()
        String(editedDeclaration || '').split('\n').forEach((raw, index) => {
          const name = codesysMonitorExpressionForLine(raw)
          if (!name) { map.set(index + 1, [{ text: raw }]); return }
          const lower = name.toLowerCase()
          // 这一行自己声明的类型：它就是该值的稳定槽下限（见 codesysOnlineValueSlotFloor）。
          const declaredType = codesysMonitorVariableType(raw)
          map.set(index + 1, codesysInlineValueSegments(raw, (token) => (token === lower ? codesysOnlineInlineValue(lower, declaredType) : null)))
        })
        return map
      }, [onlineLoggedIn, onlinePaintReady, editedDeclaration, codesysOnlineInlineValue])

      // 实现区：每一行引用到的、本对象声明过的变量，**每一个出现的位置**后面就紧跟它的当前值
      // （原生 CODESYS 的实现区在线视图也是这么标值的）。与上一轮相同的两条语义：
      //   · 仍然只认**整词/整条路径**边界（`i` 不命中 `iAxis`，`x` 不命中 `struct.x`：
      //     `struct.x` 整条才是一个 token）；
      //   · 仍然优先取变量自己的值，取不到退回它成员的 `成员=值`，再取不到就是未知。
      // 与上一轮不同的是：① **不再每行截断到 2 个** —— 用户要的就是"每个变量都跟"，而且值
      // 不再挤在列里，多标几个不会把版面挤窄；② `fbMove6DOF.Busy` 这种整条路径就地标在
      // **路径后面**（读不到那个成员就 `—`），不会把值插进点号中间。
      // 段落表同样**一次性覆盖整份代码的所有行**（空行/注释行原样成段，不插值）。
      const onlineInlineByLineImpl = React.useMemo(() => {
        if (!onlineLoggedIn) return null
        // 同上：实现区与声明区共用同一道总闸（两区必须同时出现，否则半个画面）。
        if (!onlinePaintReady) return null
        const declared = codesysMonitorVariables(oldDeclaration)
        if (!declared.length) return null
        // 名字（小写）-> 那个变量声明的 IEC 类型：稳定槽的**下限**就来自它（简单变量）。
        const declaredByLower = new Map(declared.map((variable) => [variable.name.toLowerCase(), String(variable.type || '')]))
        const map = new Map()
        String(editedImplementation || '').split('\n').forEach((raw, index) => {
          map.set(index + 1, codesysInlineValueSegments(raw, (token) => {
            // 整条路径（`a.b`）只有在它的头（`a`）是本对象声明过的变量时才算数。
            const head = token.split('.')[0]
            if (!declaredByLower.has(head)) return null
            // 点号路径的**成员**类型没有声明可查（FB 实例的成员是"名字=值"摘要拼出来的），
            // 所以只有整条 token 就是那个变量本身时才把类型交给槽宽计算。
            return codesysOnlineInlineValue(token, token === head ? declaredByLower.get(head) : '')
          }))
        })
        return map
      }, [onlineLoggedIn, onlinePaintReady, oldDeclaration, editedImplementation, codesysOnlineInlineValue])

      const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
      const newDeclaration = hasOwn(aiProposed, 'declaration') ? String(aiProposed.declaration ?? '') : oldDeclaration
      const newImplementation = hasOwn(aiProposed, 'implementation') ? String(aiProposed.implementation ?? '') : oldImplementation
      const selectedObjectKey = selected ? (selected.__pendingKey || codesysObjectKey(selected)) : ''
      const selectedChangeState = selectedObjectKey ? (changeStates[selectedObjectKey] || '') : ''
      // `loadedEditorRef` is the editor's own baseline: which object is loaded
      // and which text was put into each section. Comparing against it (never
      // against the previous render's selection) is what tells "the user typed
      // here" apart from "another object was selected".
      React.useEffect(() => {
        const previousKey = loadedEditorRef.current.key
        const sameObject = previousKey === selectedKey
        const declarationTyped = editedDeclarationRef.current !== loadedEditorRef.current.declaration
        const implementationTyped = editedImplementationRef.current !== loadedEditorRef.current.implementation
        if (sameObject && (declarationTyped || implementationTyped)) { setAgentReloadAvailable(true); return }
        // T096: 切走之前先把上一份草稿**存起来**。旧代码在这里直接
        // `setEditedDeclaration(newDeclaration)`，把上一份草稿覆盖掉且不留副本 —— 这正是
        // "切换对象丢失待写入"的根因。只在确实改过时才存：declarationTyped /
        // implementationTyped 已经是"用户在这个对象上打过字"的判据（只是显示 AI 文本不算）。
        if (previousKey && !sameObject && (declarationTyped || implementationTyped)) {
          setObjectDraft(previousKey, editedDeclarationRef.current, editedImplementationRef.current)
        }
        // 载入新对象：有草稿用草稿，没有才用 AI 建议 / 磁盘文本。
        const draft = draftsRef.current.get(selectedKey)
        const loadDeclaration = draft ? draft.declaration : newDeclaration
        const loadImplementation = draft ? draft.implementation : newImplementation
        loadedEditorRef.current = { key: selectedKey, declaration: loadDeclaration, implementation: loadImplementation }
        // 草稿与 AI 建议不一致时保留"载入 AI 建议"入口（它会同时更新草稿）。
        setAgentReloadAvailable(Boolean(aiProposed && (loadDeclaration !== newDeclaration || loadImplementation !== newImplementation)))
        setEditedDeclaration((current) => (current === loadDeclaration ? current : loadDeclaration))
        setEditedImplementation((current) => (current === loadImplementation ? current : loadImplementation))
        // A freshly loaded object starts at the top of each section; the tint
        // layers (and the inline value mirror) follow their textarea imperatively,
        // so they reset with them.
        for (const refs of [declarationRefs, implementationRefs]) {
          if (refs.highlight.current) refs.highlight.current.style.transform = 'translateY(0px)'
          if (refs.inline.current) refs.inline.current.style.transform = 'translate(0px, 0px)'
          if (refs.gutter.current) refs.gutter.current.scrollTop = 0
        }
      }, [selectedKey, proposal])
      // A proposal whose text is still exactly what the editor holds is an AI
      // change, not a manual one: it keeps its blue "AI 提案" identity.
      const editorMatchesProposal = Boolean(aiProposed && editedDeclaration === newDeclaration && editedImplementation === newImplementation)
      const declarationManual = Boolean(selected?.hasDeclaration && editedDeclaration !== oldDeclaration)
      const implementationManual = Boolean(selected?.hasImplementation && editedImplementation !== oldImplementation)
      const manualEdit = Boolean(selected && (declarationManual || implementationManual) && !editorMatchesProposal)
      React.useEffect(() => {
        // Keep the project-tree colour honest while the user types: the open
        // object turns amber the moment it differs from disk, and goes back to
        // its AI/written state when the text matches again.
        if (!selectedObjectKey) return
        const current = changeStateRef.current.get(selectedObjectKey) || ''
        if (manualEdit && current !== 'written') { if (current !== 'manual') setObjectChangeState([selectedObjectKey], 'manual') }
        else if (!manualEdit && current === 'manual') {
          setObjectChangeState([selectedObjectKey], aiProposed ? 'agent' : '')
          // T096: 改回原文（或改用 AI 文本）时把草稿一并清掉 —— 否则"改回原样"仍显示待写入，
          // 而且那份草稿会在下一次切换时又被恢复出来。loadedEditorRef 的守卫是必须的：切换
          // 对象的那一帧编辑器里还是**上一个对象**的文本，manualEdit 的判定不代表本对象。
          if (loadedEditorRef.current.key === selectedObjectKey) clearObjectDrafts([selectedObjectKey])
        }
      }, [selectedObjectKey, manualEdit, proposal])
      // The manual change is built from the two sections directly — no string
      // splitting, so a blank line inside the declaration can never move text
      // into the implementation (or the other way round).
      const manualChange = manualEdit && selected?.guid ? {
        operation: 'update-text',
        objectGuid: selected.guid,
        objectName: selected.name,
        ...(selected.hasDeclaration && declarationManual ? { declaration: editedDeclaration } : {}),
        ...(selected.hasImplementation && implementationManual ? { implementation: editedImplementation } : {}),
      } : null
      // T096: 手写改动必须来自**全部草稿**，不能只来自当前选中的对象。旧写法只用 manualChange
      // （选中项）拼 effectiveChanges，于是"改 A → 切到 B → 确认写入"只会写 B，而 A 的琥珀色
      // 徽章仍在（changedObjectCount 查的是 changeStates）—— 计数与实际写入集合不一致，
      // A 也永远不会被标成已写入。
      const draftChanges = []
      for (const [key, draft] of Object.entries(drafts)) {
        if (!key || key === selectedObjectKey) continue // 选中项以编辑器里的实时文本为准
        const item = displayObjects.find((entry) => draftKeyOf(entry) === key)
        if (!item?.guid) continue
        const baseDeclaration = String(item.declaration ?? '')
        const baseImplementation = String(item.implementation ?? '')
        const declaration = draft.declaration !== baseDeclaration ? draft.declaration : undefined
        const implementation = draft.implementation !== baseImplementation ? draft.implementation : undefined
        if (declaration === undefined && implementation === undefined) continue
        draftChanges.push({
          operation: 'update-text', objectGuid: item.guid, objectName: item.name,
          // 只发这个对象**确实拥有**的那一段：给 GVL 发空 implementation 会让 CODESYS 抛
          // 'ScriptObject' object has no attribute 'textual_implementation'。
          ...(declaration !== undefined && item.hasDeclaration ? { declaration } : {}),
          ...(implementation !== undefined && item.hasImplementation ? { implementation } : {}),
        })
      }
      const manualChanges = [...draftChanges, ...(manualChange ? [manualChange] : [])]
      const manualGuids = new Set(manualChanges.map((change) => String(change.objectGuid || '').toLowerCase()).filter(Boolean))
      const effectiveChanges = [
        // 同一个对象上手写优先于 AI 建议（与旧行为一致），区别只是现在覆盖全部草稿。
        ...aiChanges.filter((item) => {
          const target = resolveCodesysProposalObject(item, objects)
          return !target || !manualGuids.has(String(target.guid || '').toLowerCase())
        }),
        ...manualChanges,
      ]
      const effectiveProposal = effectiveChanges.length ? { summary: proposal?.summary || '用户手写代码修改', changes: effectiveChanges } : null
      const effectiveForSelected = manualChange || aiProposed
      const displayProposal = effectiveForSelected ? effectiveForSelected : null
      const changedKeys = new Set([...effectiveChanges.map((item) => resolveCodesysProposalObject(item, objects)).filter(Boolean).map(codesysObjectKey), ...pendingObjects.map((item) => item.__pendingKey)])
      const changedObjectCount = displayObjects.filter((item) => { const key = item.__pendingKey || codesysObjectKey(item); return Boolean(changeStates[key]) || changedKeys.has(key) }).length
      // CODESYS hides internal objects (__*) and the engine marks a project-level
      // duplicate of an application-owned object the same way.
      const internalObjects = displayObjects.filter((item) => item.internal)
      const treeItems = showInternal ? displayObjects : displayObjects.filter((item) => !item.internal)
      // The real CODESYS hierarchy, painted from parentGuid/parentName.
      const objectTree = buildCodesysTree(treeItems)
      // T165: 缓存命中/未命中要**看得见**，不是只在测试里能读。它挂到项目树容器上
      // （`data-codesys-tree-cache="hits/misses"`），于是"这次渲染到底重建了没有"可以直接
      // 从 DOM 上读出来，不必靠"感觉变快了"。
      const treeCacheStats = codesysTreeCacheStats()
      const treeCacheLabel = `${treeCacheStats.hits}/${treeCacheStats.misses}`
      const treeChangeState = codesysTreeChangeStates(objectTree, changeStates, changedKeys)
      const treeVisibleKeys = codesysTreeVisibleKeys(objectTree, treeFilter)
      const treeMaxDepth = objectTree.order.reduce((max, node) => Math.max(max, node.depth), 0)
      const toggleTreeKey = (key) => setCollapsedKeys((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
      // Reveal the selected object ONLY when the selection changes. Running this
      // on every render re-expanded a branch the user had just collapsed, which
      // made the tree impossible to fold back.
      const revealedSelectionRef = React.useRef('')
      React.useEffect(() => {
        if (!selectedKey || revealedSelectionRef.current === selectedKey) return
        revealedSelectionRef.current = selectedKey
        setCollapsedKeys((current) => {
          if (!current.size) return current
          let next = null
          let cursor = objectTree.byKey.get(selectedKey)?.parent || null
          while (cursor) {
            if (current.has(cursor.key)) { next = next || new Set(current); next.delete(cursor.key) }
            cursor = cursor.parent
          }
          return next || current
        })
      }, [selectedKey, objectTree])
      const treeRows = []
      const pushTreeRows = (nodes, depth) => {
        for (const node of nodes) {
          if (!treeVisibleKeys.has(node.key)) continue
          const item = node.item
          const kind = node.kind
          const hasChildren = node.children.length > 0
          const expanded = hasChildren && !(treeFilter === 'all' && collapsedKeys.has(node.key))
          const state = treeChangeState.states.get(node.key) || ''
          const scope = treeChangeState.scopes.get(node.key) || ''
          const stateLabel = codesysChangeStateLabel(state)
          const rowTitle = item.__pendingKey
            ? `${item.name} · ${kind.label} · 待新增`
            : `${item.name} · ${kind.label} · ${item.guid || '无 GUID'}${item.path ? `\n路径：${item.path.join(' / ')}` : ''}${stateLabel ? `\n${stateLabel}` : ''}`
          treeRows.push(h('div', {
            key: node.key,
            className: `taskhive-codesys-treerow${item.__pendingKey ? ' is-pending' : ''}${hasChildren ? ' is-group' : ''}`,
            role: 'treeitem',
            tabIndex: 0,
            'aria-level': String(depth + 1),
            'aria-selected': node.key === selectedKey ? 'true' : 'false',
            ...(hasChildren ? { 'aria-expanded': expanded ? 'true' : 'false' } : {}),
            onClick: () => setSelectedKey(node.key),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedKey(node.key); return }
              if (!hasChildren) return
              if (event.key === 'ArrowRight' && !expanded) { event.preventDefault(); toggleTreeKey(node.key) }
              if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); toggleTreeKey(node.key) }
            },
            'data-selected': node.key === selectedKey ? 'true' : 'false',
            'data-changed': changedKeys.has(node.key) ? 'true' : 'false',
            'data-change-state': state,
            'data-change-scope': scope,
            'data-node-kind': kind.kind,
            'data-node-category': kind.category,
            'data-node-depth': String(depth),
            'data-node-children': String(node.children.length),
            'data-pending-create': item.__pendingKey ? 'true' : 'false',
            'data-codesys-object-guid': item.guid || '',
            'data-codesys-object-name': item.name || '',
            'data-codesys-object-type': item.type || '',
            'data-codesys-object-has-code': item.hasDeclaration || item.hasImplementation ? 'true' : 'false',
            'data-codesys-object-library-manager': item.hasLibraryManager ? 'true' : 'false',
            title: rowTitle,
            style: { paddingLeft: `${3 + depth * 12}px` },
          },
            hasChildren
              ? h('button', {
                className: 'taskhive-codesys-twisty', type: 'button', tabIndex: -1,
                'aria-label': expanded ? `${item.name}：折叠` : `${item.name}：展开`,
                'data-twisty': expanded ? 'open' : 'closed',
                onClick: (event) => { event.stopPropagation(); toggleTreeKey(node.key) },
              }, expanded ? '▾' : '▸')
              : h('span', { className: 'taskhive-codesys-twisty is-leaf', 'aria-hidden': 'true' }),
            h('span', { className: 'taskhive-codesys-tree-kind', 'data-node-kind': kind.kind, 'aria-hidden': 'true' }),
            h('span', { className: 'taskhive-codesys-tree-label' }, `${item.name}${item.__pendingKey ? '（待新增）' : ''}`),
            kind.category !== CODESYS_CODE_CATEGORY ? h('span', { className: 'taskhive-codesys-tree-kind-label' }, kind.label) : null,
            hasChildren ? h('span', { className: 'taskhive-codesys-tree-count', title: `${node.children.length} 个子节点` }, String(node.children.length)) : null,
            stateLabel
              ? (scope === 'subtree'
                ? h('span', { className: 'taskhive-codesys-tree-state is-subtree', title: `子项包含${stateLabel}` }, '●')
                : h('span', { className: 'taskhive-codesys-tree-state' }, stateLabel))
              : null))
          if (expanded) pushTreeRows(node.children, depth + 1)
        }
      }
      pushTreeRows(objectTree.roots, 0)
      const selectedKind = selected ? codesysKindOfObject(selected) : null
      const selectedIsCode = Boolean(selected && (selected.hasDeclaration || selected.hasImplementation))
      const effectiveErrors = validateCodesysProposal(effectiveProposal, objects)
      // T088: 工程快照（"整个工程的代码"）只在工程对象变化时重建。它随实时状态发布
      // 给宿主，模型改用工具调用 taskhive_codesys_workbench({include:'project-snapshot'})
      // 取它——工具调用比"请去读这个文件"可靠得多，也不会因为模型不敢读工作区外的
      // 绝对路径而失败。甲补的那句文件路径指令保留为兼容退路。
      const projectSnapshotSignature = codesysObjectsSignature(sourcePath, objects)
      const projectSnapshot = React.useMemo(
        () => (Array.isArray(objects) && objects.some((item) => item?.hasDeclaration || item?.hasImplementation)
          ? buildCodesysTaskSnapshot(sourcePath, objects, '').snapshot
          : null),
        [projectSnapshotSignature],
      )
      // ── 抽屉能力面：只读投影 + **复用既有写入函数**的唯一入口 ────────────────────────────
      //
      // 渲染派生值（提案 / 闸门 / 绑定）每次渲染刷新进 `capabilityStateRef`；编译进度与终态由
      // `recordCapabilityBuild()` 从几条**异步**路径写进 `capabilityBuildRef`（渲染不覆盖它）。
      // `read()` 只做投影，`apply()` 只调 `applyProposal` —— 与工作台那枚「确认写入」按钮**同一个
      // 函数、同一条 sha 防护、同一个 `apply-and-build`**，不新增写入实现。
      const capabilitySignature = String(codesysHash(JSON.stringify(effectiveProposal?.changes || [])))
      const capabilityGate = {
        busy: busy === true,
        writeAvailable: writeAvailable === true,
        writeBlockReason: String(writeBlockReason || activeProject?.writeBlockReason || ''),
        jobId: String(jobId || ''),
        changeCount: effectiveChanges.length,
        errors: effectiveErrors.slice(0, 8).map((item) => String(item || '')),
        // 本轮 B 项（冻结）：抽屉那枚「确认写入工程」与工作台那枚共用**这一条**闸门，
        // 所以"已登录到应用 ⇒ 不许写"必须在这里也如实报出去 —— 抽屉据此把按钮禁用并
        // 显示原因 + 出路（用户口径：禁止不许静默）。
        onlineWriteFrozen: onlineWriteFrozen === true,
        frozenDetail: onlineWriteFrozen ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL : '',
      }
      const capabilityBlockReason = capabilityGate.onlineWriteFrozen
        ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL
        : (capabilityGate.errors.length
          ? capabilityGate.errors[0]
          : (!capabilityGate.writeAvailable
            ? (capabilityGate.writeBlockReason || '当前工程不可写入：请先绑定一个可写工程')
            : (!capabilityGate.jobId
              ? '工作台还没有绑定工程（没有可写入的作业）：请先点面板上的「刷新」或「选择工程」'
              : (!capabilityGate.changeCount ? '当前没有待写入的改动' : ''))))
      capabilityStateRef.current = {
        sessionId: String(sessionId || ''),
        projectPath: String(sourcePath || ''),
        projectName: String(codesysBaseName(sourcePath) || ''),
        ownerSessionId: String(ownerSessionId || ''),
        signature: capabilitySignature,
        gate: capabilityGate,
        blockReason: capabilityBlockReason,
        proposalValue: effectiveProposal || null,
        proposal: effectiveProposal
          ? {
            summary: String(effectiveProposal.summary || ''),
            source: String(proposalSource || ''),
            signature: capabilitySignature,
            changeCount: effectiveChanges.length,
            // 上限只作用在**投影**上（对象数），改动本身一个字都不动 —— 写入用的是
            // `proposalValue`（完整的 effectiveProposal），与工作台按钮手上的那份同一个对象。
            changes: effectiveChanges.slice(0, CODESYS_CAPABILITY_OBJECT_BUDGET)
              .map((change) => codesysCapabilityChange(change, objects, effectiveProposal)),
            omittedChanges: Math.max(0, effectiveChanges.length - CODESYS_CAPABILITY_OBJECT_BUDGET),
          }
          : null,
      }
      // 只读投影：抽屉拿到的就是这些字段（全部有上限，且**不含**任何可写句柄）。
      const capabilityRead = () => {
        const state = capabilityStateRef.current || {}
        const build = capabilityBuildRef.current || { state: 'idle' }
        return {
          ok: true,
          sessionId: String(state.sessionId || ''),
          projectPath: String(state.projectPath || ''),
          projectName: String(state.projectName || ''),
          gate: { ...(state.gate || {}) },
          blockReason: String(state.blockReason || ''),
          proposal: state.proposal || null,
          // 本轮：「放弃」要说清丢了什么，所以工作台把"有多少处手写、还没写入的改动"也一并报出来
          // （与 T166「绝不无声丢弃草稿」的守卫用的是**同一个** `countUnsavedDrafts()`）。
          // 纯数字、只读；抽屉拿它把那一行写准（回复丢失时也写不准不了）。
          draftCount: countUnsavedDrafts(),
          build: { ...build },
        }
      }
      const capabilityApply = async (input = {}) => {
        const state = capabilityStateRef.current || {}
        const proposal = state.proposalValue || null
        // 本轮 B 项（冻结）：已登录到应用 ⇒ 抽屉这条 AI 写入入口**先**被拦住。它排在
        // "正忙 / 没有提案"之前是刻意的：冻结比那两条更根本 —— 现在就算手里有提案也不许写，
        // 抽屉据此写出可读原因（而不是让用户以为"只是暂时没有改动"）。
        if (onlineWriteFrozen) {
          return { ok: false, reason: 'online-write-frozen', detail: CODESYS_ONLINE_WRITE_FROZEN_DETAIL }
        }
        if (state.gate?.busy === true) return { ok: false, reason: 'workbench-busy', detail: '工作台正在执行另一项操作：等它结束再点「确认写入工程」。' }
        if (!proposal || !Array.isArray(proposal.changes) || !proposal.changes.length) {
          return { ok: false, reason: 'no-proposal', detail: '工作台当前没有待写入的提案：先让 AI 给出改动，或在工作台里手写修改。' }
        }
        // 防串位：抽屉显示的那一份提案必须**还是**当前这一份。签名与工作台自己那份同源
        // （同一串 changes 的 codesysHash），所以"提案在两次点击之间被换掉"会被挡在这里。
        const expected = String(input?.proposalSignature || '')
        if (expected && expected !== String(state.signature || '')) {
          return { ok: false, reason: 'stale-proposal', detail: '待写入的提案已经变了（工作台现在那份与抽屉显示的那份不同）：看一眼最新的差异再点「确认写入工程」。' }
        }
        // 逐项审查这条闸门由**抽屉在这里的那一次显式点击**满足（`reviewAcknowledged`）——
        // 差异原文就在抽屉消息流里，所以"看过再点"这件事没有降低要求，也没有把用户赶去工作台。
        return await applyProposal(proposal, state.gate?.errors || [], {
          fromChat: true,
          reviewAcknowledged: true,
          overwriteConfirmed: input?.overwriteConfirmed === true,
        })
      }
      // 本轮：抽屉那枚「放弃」的落点。与 `capabilityApply` 同一层：只做会话/繁忙/串位判定，
      // 然后交给工作台那枚按钮调的**同一个** `discardProposal()` —— 不新增第二条清状态实现。
      // 它不写工程、不编译；"能放弃什么"全部由工作台自己判定。
      const capabilityDiscard = async (input = {}) => {
        const state = capabilityStateRef.current || {}
        if (state.gate?.busy === true) return { ok: false, reason: 'workbench-busy', detail: '工作台正在执行另一项操作：等它结束再放弃。' }
        const expected = String(input?.proposalSignature || '')
        if (expected && expected !== String(state.signature || '')) {
          return { ok: false, reason: 'stale-proposal', detail: '要放弃的提案已经变了（工作台现在那份与抽屉显示的那份不同）：看一眼最新的差异再点「放弃」。' }
        }
        return await discardProposal({ fromChat: true })
      }
      // 本轮：能力面必须**转派到当前这一次渲染的实现**，不能在安装那一刻把 `capabilityApply` /
      // `capabilityDiscard` 的闭包扣死。
      // 现场（用户原话「点击放弃没有反映」）：seam 是 `React.useEffect(…, [])` 装一次的，所以它
      // 一直拿着**第一次渲染**那两个函数；而 `discardProposal` / `applyProposal` 读的 `jobId`、
      // `busy`、`effectiveProposal` 都是渲染值 —— 第一次渲染时 `jobId` 还是空串，于是抽屉那枚
      // 「放弃」走到的是"没有工程可重读"的分支：提案清了、编辑器却没退回磁盘。两个函数经 ref 取，
      // 与 `applyAgentProposalRef` / `claimPendingProposalRef` 是同一个写法（本组件既有的约定）。
      const capabilityApplyRef = React.useRef(null)
      const capabilityDiscardRef = React.useRef(null)
      capabilityApplyRef.current = capabilityApply
      capabilityDiscardRef.current = capabilityDiscard
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const seam = {
          version: 1,
          sessionId: () => String(sessionIdRef.current || ''),
          signature: () => String(capabilityStateRef.current?.signature || ''),
          read: () => capabilityRead(),
          apply: (input) => capabilityApplyRef.current(input),
          // 本轮：**放弃**（「确认写入」旁边那一枚）。与 `apply` 并列的第二条能力，
          // 但它只能**减少**待写入内容（提案 + 手写草稿），绝不写工程。
          discard: (input) => capabilityDiscardRef.current(input),
        }
        window.__TASKHIVE_CODESYS_CAPABILITIES__ = seam
        capabilitySeamRef.current = seam
        return () => {
          // 只摘自己装的那一个：后挂载的组件（另一个页签实例）装过之后，卸载不能把它删掉。
          if (typeof window !== 'undefined' && window.__TASKHIVE_CODESYS_CAPABILITIES__ === seam) delete window.__TASKHIVE_CODESYS_CAPABILITIES__
          if (capabilitySeamRef.current === seam) capabilitySeamRef.current = null
        }
      }, [])
      // Publish the live workbench state to the host plugin so the model can
      // read exactly what this panel shows (and so a chat-side edit lands here).
      // The fingerprint keeps the 900 ms debounce meaningful: identical state
      // never produces a request, typing produces one per pause.
      // T199（③）：在线会话状态的**指纹**。只含慢变字段（见下面 onlineStateSignature 的说明）。
      const onlineStateSignature = [
        onlineState?.running === true ? 'run' : 'stop',
        onlineConnected ? 'connected' : 'disconnected',
        onlineLoggedIn ? 'logged-in' : 'not-logged-in',
        String(onlineState?.state?.loginMode || ''),
        String(onlineState?.state?.applicationState || ''),
        String(onlineState?.state?.applicationStateLabel || ''),
        String(onlineReady?.deviceName || ''),
        String(onlineAddress || ''),
        onlineBound ? 'bound' : 'unbound',
        // 本轮（B 项）：网关的"另有客户端连着"弱信号也要触发一次发布，否则它翻了 host 也不知道。
        onlineSharedConnected ? 'shared' : 'solo',
        String(onlineState?.lastError || '').slice(0, 80),
        Array.isArray(onlineState?.authorization?.capabilities) ? onlineState.authorization.capabilities.join('+') : 'no-grant',
        Array.isArray(onlineState?.deniedOnlineCapabilities) ? onlineState.deniedOnlineCapabilities.join('+') : '',
      ].join('|')
      const liveStateFingerprint = [
        sessionId, jobId, sourcePath, writeAvailable ? 'w' : 'b', selectedKey, String(selected?.guid || ''),
        proposalSource, reviewAccepted ? 'yes' : 'no', String(assistantText.length),
        workbenchVisible ? 'vis' : 'hid',
        Object.entries(changeStates).map(([key, value]) => `${key}=${value}`).join(','),
        String(codesysHash(editedDeclaration)), String(codesysHash(editedImplementation)),
        String(codesysHash(oldDeclaration)), String(codesysHash(oldImplementation)), String(effectiveChanges.length),
        // T088: 工程对象变化也必须触发一次发布（否则读工具拿到的快照会一直停留在
        // 上一次 inspect 的结果）。
        projectSnapshotSignature,
        // T199（③）：**在线会话状态**的变化也要触发一次发布，否则宿主那个只读工具
        // （taskhive_codesys_online）会一直读到上一次的连接状态。
        // 这里刻意只放**慢变**的状态（连接/登录/应用状态/目标/错误/已授权能力），
        // **不放在线变量的值**：读值每 1.5 秒就换一次，把它放进指纹等于制造一条持续
        // 推送流 —— 那正是用户删掉的"实时监视"。值只是搭这一次发布顺带送出的、
        // "面板上一次读到的结果"（带观测时间），谁也没为它增加一次发送。
        onlineStateSignature,
        // 本轮 B 项（用户报障原文：「而且对话依然读取不到在线变量」）：
        // 上面那条纪律让 `onlineStateSignature` 里没有值，但**发布本身**也被指纹挡住了：
        // 值变了而在线状态没变时就没有发布 —— 宿主手里于是永远停在"打开 POU 那一刻"的
        // 那一批值（常常还是空的，因为第一笔值 1.5 秒后才回来）。这正是"对话读不到在线
        // 变量"的直接来源（真机帧：18:03 面板已观测到 startMove=FALSE / iAxis=INT#0 /
        // MaxVel=UDINT#2048576000，宿主却读不到）。
        //
        // 解法不新增任何东西：把**值的观测时刻**（不是值本身）放进指纹。只有**已登录到应用**、
        // 面板真的读到了值、并且这一批值和上一批不同时，这个分量才变 —— 于是宿主拿到的是
        // **最新观测**，而未登录时 onlineValues 恒为 null，这里恒为一个常量，一个字节都不会多发。
        onlineLoggedIn && onlineValues ? `ov:${String(onlineValues.at || 0)}` : 'ov:off',
      ].join('|')
      React.useEffect(() => {
        const activeSession = sessionIdRef.current
        if (!activeSession) return
        // T088/T089: 签名一变就必须把 projectSnapshot 字段**一并发出**，哪怕它是
        // null。宿主侧 publishWorkbenchState 是字段合并，"不发送"会保留上一个工程的
        // 快照——换绑工程后模型就会拿到别的工程的代码。这是 T088 引入的真实缺陷。
        // KNOWN-ISSUES #8: 与**已被宿主确认**的签名比较，而不是与"上一次打算发送的"签名比较。
        // 旧写法在这一行就把标记推进了，于是只要这次发布被 900 ms 防抖挤掉，快照就再也
        // 不会被附带（因为签名再没变过）——工程级快照永久停在 null，而随选区发布的
        // openObject 一切正常。确认改由 sendCodesysState 在收到宿主 accepted 之后推进。
        const snapshotChanged = codesysStateKeepAlive.publishedSignature !== projectSnapshotSignature || codesysStateKeepAlive.publishedSessionId !== activeSession
        if (snapshotChanged) codesysStateKeepAlive.pendingSnapshot = { sessionId: activeSession, signature: projectSnapshotSignature, snapshot: projectSnapshot }
        publishCodesysStateRef.current?.({
          projectPath: sourcePath, projectName: codesysBaseName(sourcePath), jobId, writeAvailable, writeBlockReason,
          // 本轮：**绑定身份**（工程路径 + 绑定源 sha256）随活状态一起发布 —— 宿主在模型交来
          // 一份代码差异、把它排进待领取队列时，用它记住"这份提案是给哪个工程、哪一版源文件的"。
          // 只读字段，不参与任何写判定。
          sourceSha256: String(bindingShaRef.current || ''),
          objectCount: displayObjects.length, visible: visibleRef.current, reviewAccepted, proposalSource,
          hierarchy: { roots: objectTree.roots.length, grouped: displayObjects.filter((item) => String(item?.parentGuid || '').trim()).length, maxDepth: treeMaxDepth },
          kindCounts: objectTree.order.reduce((counts, node) => { counts[node.kind.kind] = (counts[node.kind.kind] || 0) + 1; return counts }, {}),
          // KNOWN-ISSUES #8: 只要还有**未被确认送达**的快照就继续附带（而不是只在签名变化的那一次
          // 渲染附带）。值为 null 时也要显式发送——见 T089：换绑工程后必须让宿主收到
          // null，否则上一个工程的代码会被当成当前工程返回给模型。
          ...(codesysStateKeepAlive.pendingSnapshot
            ? { projectSnapshot: codesysStateKeepAlive.pendingSnapshot.snapshot }
            : {}),
          openObject: selected ? {
            name: selected.name || '', guid: selected.guid || '', type: selected.type || '',
            kind: selectedKind?.kind || '', kindLabel: selectedKind?.label || '',
            path: Array.isArray(selected.path) ? selected.path.map(String) : [],
            parentGuid: String(selected.parentGuid || ''),
            hasDeclaration: Boolean(selected.hasDeclaration), hasImplementation: Boolean(selected.hasImplementation),
            source: manualChange ? 'manual-edit' : (aiProposed ? 'agent-proposal' : 'disk'),
            changeState: selectedChangeState,
            // The two CODESYS editor parts are reported separately, exactly as
            // the object model holds them; `code`/`baseCode` stay as a combined
            // view for anything that reads a single text.
            declaration: String(editedDeclaration || '').slice(0, CODESYS_OPEN_OBJECT_BUDGET),
            implementation: String(editedImplementation || '').slice(0, CODESYS_OPEN_OBJECT_BUDGET),
            baseDeclaration: String(oldDeclaration || '').slice(0, CODESYS_OPEN_OBJECT_BUDGET),
            baseImplementation: String(oldImplementation || '').slice(0, CODESYS_OPEN_OBJECT_BUDGET),
            code: `${editedDeclaration || ''}${editedImplementation ? `\n\n${editedImplementation}` : ''}`.slice(0, CODESYS_OPEN_OBJECT_BUDGET),
            baseCode: `${oldDeclaration || ''}${oldImplementation ? `\n\n${oldImplementation}` : ''}`.slice(0, CODESYS_OPEN_OBJECT_BUDGET),
          } : null,
          changedObjects: displayObjects
            .map((item) => ({ item, key: item.__pendingKey || codesysObjectKey(item) }))
            .filter((entry) => changeStates[entry.key])
            .map((entry) => ({ name: entry.item.name || '', guid: entry.item.guid || '', type: entry.item.type || '', state: changeStates[entry.key] })),
          pendingProposal: effectiveProposal ? {
            summary: String(effectiveProposal.summary || ''),
            changeCount: effectiveChanges.length,
            changes: effectiveChanges.map((change) => ({
              objectName: String(change?.objectName || ''),
              operation: codesysProposalOperation(change, objects, effectiveProposal),
              declarationChars: String(change?.declaration || '').length,
              implementationChars: String(change?.implementation || '').length,
            })),
          } : null,
          safety: { writesProjectAfterHumanConfirmation: true, plcOnlineActionsForbidden: true },
          // T199（③）：**只读**的在线状态，搭这同一条发布送去宿主（宿主的 publishWorkbenchState
          // 把它单独存一份，工作台工具逐字段构造返回值，所以它的返回形状一个字段都没变）。
          // 模型按需调用 taskhive_codesys_online 读一次；这里**没有**新的定时器、没有新的路由、
          // 没有新的 IPC 通道，也没有任何设备访问 —— 送的全是面板此刻已经知道的东西。
          // 变量值只是"面板上一次读到的结果"，带观测时间；值本身不进指纹（否则就是持续的推送流）。
          online: {
            readOnly: true,
            running: onlineState?.running === true,
            connected: onlineConnected,
            loggedIn: onlineLoggedIn,
            loginMode: String(onlineState?.state?.loginMode || ''),
            applicationState: String(onlineState?.state?.applicationState || onlineState?.state?.applicationStateLabel || ''),
            deviceName: String(onlineReady?.deviceName || ''),
            bound: onlineBound,
            // 本轮（B 项）：网关的"共享连接"弱信号随只读快照一起给宿主 —— 用户在原生 IDE 里
            // 登录之后，这是我方唯一能看到的、与那次登录有关的**弱**证据。它只用来写一行
            // 如实提示（"可能有别的客户端连着"），**不参与任何判断**：不改目标、不自动登录、
            // 不释放会话、不作为 connected/loggedIn 的替代。
            sharedConnected: onlineSharedConnected,
            target: { summary: onlineTargetSummary, source: onlineTargetSource, address: onlineAddress },
            authorization: {
              armed: Boolean(onlineState?.authorization),
              capabilities: Array.isArray(onlineState?.authorization?.capabilities) ? onlineState.authorization.capabilities.map((item) => String(item || '')) : [],
              projectName: String(onlineState?.authorization?.projectName || ''),
              targetSummary: onlineState?.authorization?.target ? String(onlineState.authorization.target.address || onlineState.authorization.target.gatewayName || '') : '',
            },
            deniedCapabilities: Array.isArray(onlineState?.deniedOnlineCapabilities) ? onlineState.deniedOnlineCapabilities.map((item) => String(item || '')) : [],
            // 用户规则原文：「上限去除」—— 这里**不再**只送前 90 条：工作台观测到多少条就
            // 如实送多少条（引擎一次 120 条的上限由上面读值段的跨节拍分批消化，不靠截断这里）。
            // 每个值仍然只**截长度**（120 字符）而不是截条数：那条防的是单个超长字符串把只读
            // 快照撑爆，与"第 90 个之后没有值"不是一回事。
            values: Array.isArray(onlineValues?.expressions)
              ? onlineValues.expressions.map((name, index) => ({ expression: String(name || ''), value: String(onlineValues.values?.[index] ?? '').slice(0, 120) }))
              : [],
            valuesObservedAt: onlineValues?.at ? new Date(onlineValues.at).toISOString() : '',
            observedAt: new Date().toISOString(),
          },
        })
      }, [liveStateFingerprint])
      // T083: 命令条只有一行，所以状态词缩短为「可写入 / 等待 AI 改动 / 不可写入」，
      // 具体原因改由旁边可伸缩的详情文字承载——它拿的是剩余宽度，越窄越省略，
      // 全文仍在 title 里。原来"不可写入：<原因>"挤在固定宽度的状态词里，反而把
      // 真正需要读的原因压成了省略号。
      // 本轮 B 项（冻结）：已登录到应用 ⇒ 状态词是「在线已冻结」，详情文字是那唯一一行
      // "原因 + 出路"。它不是"工程不可写"（那是 writeAvailable 的事），而是"现在不允许写"，
      // 所以两者分开：冻结优先，且**必须**说清怎么解开（退出登录）。
      // 本轮（抽屉）按意图只把那个词说得更准：仍然**包含**原来的「已冻结」，再点明这是哪一种
      // 冻结（在线）。语义一个字没动（判据仍是 onlineWriteFrozen = state.isLoggedIn）。
      const writeStateLabel = onlineWriteFrozen
        ? '在线已冻结'
        : (writeAvailable
          ? (effectiveChanges.length ? '可写入' : '等待 AI 改动')
          : '不可写入')
      const writeStateDetail = onlineWriteFrozen
        ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL
        : (writeAvailable
          ? (effectiveChanges.length ? '勾选「已核对」后写入磁盘工程并执行离线编译。' : '当前工程已读取；生成代码提案或手写修改后才会启用确认按钮。')
          : (writeBlockReason || activeProject?.writeBlockReason || '请先绑定可写工程'))
      // ── 本轮（写入行抽屉化）──────────────────────────────────────────────────────────
      // 用户口径原文：「把「写入 · 等待 AI 改动」那一行改成抽屉式，只在需要时出现」——
      //   ① 空闲时这一行**根本不存在**（DOM 里零文字、零高度），不再常驻说一句"等待 AI 改动"；
      //   ② 只有四件事之一为真时才出现一个**紧凑把手**：有待确认提案（AI 提案或手写草稿）/
      //      正在写入 / 在线已冻结（T217）/ 上次写入或编译失败；
      //   ③ 把手默认**收起**，点它才展开细节（提案状态 / 冻结原因 / 上次写入结果），再点收起；
      //      绝不自动展开抢注意力；④「确认写入 / 放弃」仍留在这一行里（位置与行为不变）。
      //
      // 判据全部是**渲染派生值**：不写工程、不改闸门、不加定时器、不发起任何 IPC
      // （MUTATING 仍然是 0）。写入仍然只在用户点击「确认写入」之后发生，冻结语义一字未动。
      const writeLastFailed = writePhase === 'failed'
      const writeInFlight = writePhase === 'writing'
      const writeCompileFailed = Number(compileReport?.errorCount || 0) > 0
      const writeDrawerNeeded = effectiveChanges.length > 0 || writeInFlight || onlineWriteFrozen || writeLastFailed || writeCompileFailed
      // 抽屉只在"需要"的时候允许展开：不需要时立刻回到收起状态（`useEffect` 不是定时器，
      // 它只把上一次的展开状态清掉），这样"消失 → 再出现"之间也永远是从收起开始的。
      const writeDrawerExpanded = writeDrawerOpen && writeDrawerNeeded
      React.useEffect(() => {
        if (!writeDrawerNeeded && writeDrawerOpen) setWriteDrawerOpen(false)
      }, [writeDrawerNeeded, writeDrawerOpen])
      // 把手的**一行**文案：只说此刻最该说的一件事（正在写入 > 冻结 > 上次写入失败 >
      // 待确认项数 > 上次编译失败 > 原有状态词）。"可写入"在有提案时被**更具体**的
      // 「N 项待确认」取代；"不可写入"照旧逐字保留（工程不可写时它才是该说的那件事），
      // 它也是这条表达式最后的兜底词（空闲时整条行根本不渲染，所以"等待 AI 改动"不再上屏）。
      const writeHandleLabel = writeInFlight
        ? '写入中'
        : onlineWriteFrozen
          ? '在线已冻结'
          : writeLastFailed
            ? '上次写入失败'
            : (effectiveChanges.length && writeAvailable
              ? `${effectiveChanges.length} 项待确认`
              : (writeCompileFailed ? '上次编译失败' : writeStateLabel))
      const writeDrawerProposalLine = effectiveChanges.length
        ? `提案状态：待写入 ${effectiveChanges.length} 个对象${manualChange ? '（含手写修改）' : ''}${proposalSource === 'chat' ? ' · 来自对话' : proposalSource === 'workbench' ? ' · 来自代码任务' : ''}${effectiveErrors.length ? ` · 当前提案不可写入：${String(effectiveErrors[0] || '')}` : ''}`
        : '提案状态：没有待确认的提案或手写改动。'
      const writeDrawerFreezeLine = onlineWriteFrozen ? `冻结原因：${CODESYS_ONLINE_WRITE_FROZEN_DETAIL}` : ''
      const writeDrawerLastLine = writeInFlight
        ? `上次写入：正在创建恢复快照并写入当前工程…（已等待 ${busySeconds} 秒）`
        : (writeLastFailed
          ? `上次写入：写入或编译失败 —— ${writeFailureDetail || '原因见底部状态行'}；写前恢复快照已保留`
          : '上次写入：没有失败记录。')
      const writeDrawerCompileLine = writeCompileFailed ? `上次编译：${compileCountText(compileReport)}` : ''
      const displayDeclaration = displayProposal ? (hasOwn(displayProposal, 'declaration') ? String(displayProposal.declaration ?? '') : oldDeclaration) : oldDeclaration
      const displayImplementation = displayProposal ? (hasOwn(displayProposal, 'implementation') ? String(displayProposal.implementation ?? '') : oldImplementation) : oldImplementation
      const proposed = displayProposal
      const declarationDiff = (() => { const base = String(oldDeclaration).split('\n'); const next = String(displayDeclaration).split('\n'); const length = Math.max(base.length, next.length); return Array.from({ length }, (_, index) => ({ index: index + 1, changed: (base[index] ?? '') !== (next[index] ?? '') })) })()
      const implementationDiff = (() => { const base = String(oldImplementation).split('\n'); const next = String(displayImplementation).split('\n'); const length = Math.max(base.length, next.length); return Array.from({ length }, (_, index) => ({ index: index + 1, changed: (base[index] ?? '') !== (next[index] ?? '') })) })()
      // Compatibility marker for the existing UI contract; changed lines are
      // now summarized in the editor meta row instead of duplicated.
      const legacyDiffContract = "'data-changed': proposed && row.changed ? 'true' : 'false'"
      const changedLineNumbers = declarationDiff.filter((row) => row.changed).map((row) => row.index)
      const changedLineNumbersImplementation = implementationDiff.filter((row) => row.changed).map((row) => row.index)
      // 本轮 B 项（冻结）：已登录到应用时这一行**不许**再说"可直接修改" —— 那是冻结前的
      // 提示，照着做只会得到一个打不进字的编辑栏。改成如实说明当前是只读，以及怎么解开。
      const editorStateLabel = onlineWriteFrozen
        ? (aiProposed ? 'AI 建议 · 只读（在线冻结，可查看/可放弃）' : '在线冻结 · 只读（如需修改请先退出登录）')
        : (manualChange ? '手写修改 · 尚未写入' : aiProposed ? 'AI 建议 · 可继续修改' : selected ? '已打开项目对象 · 可直接修改' : '请从项目树选择代码对象')
      const changedSummary = [
        changedLineNumbers.length ? `声明 ${changedLineNumbers.length} 行` : '',
        changedLineNumbersImplementation.length ? `实现 ${changedLineNumbersImplementation.length} 行` : '',
      ].filter(Boolean).join(' · ')
      // Which colour the changed rows of the OPEN file carry: the user's own
      // unsaved edit wins over the AI proposal, and an already written object is
      // shown green so the session's footprint stays visible.
      const editorLineState = manualEdit ? 'manual' : (aiProposed ? 'agent' : (selectedChangeState === 'written' ? 'written' : ''))
      // One section per CODESYS editor part, each with its own line numbers, its
      // own changed-line tint and its own scroll sync.
      const renderEditorSection = (section, refs) => {
        const lines = String(section.value || '').split('\n')
        const changed = codesysChangedLineNumbers(section.base, section.value)
        const syncScroll = (event) => {
          const top = event.currentTarget.scrollTop
          const left = event.currentTarget.scrollLeft
          if (refs.gutter.current) refs.gutter.current.scrollTop = top
          if (refs.highlight.current) refs.highlight.current.style.transform = `translateY(${-top}px)`
          // 本轮（样式 A）：值就地画在代码里，所以它必须**逐像素**跟着代码走 —— 纵向、
          // 横向都要跟，否则长行一横向滚动值就和它所属的变量错位。
          if (refs.inline?.current) refs.inline.current.style.transform = `translate(${-left}px, ${-top}px)`
          // 本轮 B 项：用户**正在**滚动 ⇒ 记下时刻，下一次读数节拍让路（画面不在他读的
          // 中途换值）。只写一个时间戳，滚动同步本身一个字都没改。
          noteCodesysUserActivity()
        }
        // 本轮（样式 A，用户报障原文：「为什么不可以把在线值直接替换代码编辑区到变量？
        // 而且显示不全？我滚动到时候底下很多都没有加载」）：值不再占第三列，而是**就地**
        // 紧跟在每一个变量 token 后面（同一行、同一段流），所以既没有固定列宽也没有任何
        // `overflow:hidden`/省略号能裁掉它 —— 它和它所属的变量在同一段文字里，一起换行、
        // 一起滚动。
        //
        // 镜像层与 textarea 共用同一套字体/行高/内边距，第 N 行永远对齐左边栏的第 N 行。
        // ⚠ 上一轮那一层独立值列是 `overflow:hidden` 的，而它是靠 `translateY(-scrollTop)`
        // 跟随滚动的：`overflow:hidden` 会把**超出自身盒子**的内容就地裁掉，于是平移永远
        // 只能露出开头那十几行 —— 这就是"滚到底很多行没有值"的真正原因（值映射其实一直是
        // 全量的）。本轮改为 `overflow:visible`，让整份镜像都在盒子里，由上层 surface 的
        // `overflow:hidden` 做唯一的窗口裁剪。
        //
        // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：判据从
        // 「开关打开 且 已登录」简化成**只有登录状态** —— 已登录就渲染（值不用点任何东西
        // 就出现在每个变量后面）；未登录的那一刻镜像层整个不渲染、`is-inline-mirrored`
        // 消失 ⇒ 版面与原文**完全恢复**，编辑栏也可编辑
        // （值从来没有写进 textarea，所以不可能留下残留；用户手打的草稿一个字都不动）。
        //
        // 本轮（冻结）删掉了 T216 那条妥协（"光标所在的那一段不画值"）：那段逻辑是"光标所在的
        // 那一段不画值"（因为内联值会把字符往右推、与 textarea 按原文字算的光标错开）。
        // 已登录时编辑栏只读冻结，"边看值边打字"不可能发生 —— 让位只会让用户看到
        // 「一片白 + 值」的半个画面。于是已登录就永远画：代码与值同时可见。
        const inlineByLine = onlineLoggedIn
          ? (section.id === 'declaration' ? onlineInlineByLine : (section.id === 'implementation' ? onlineInlineByLineImpl : null))
          : null
        const showInline = Boolean(inlineByLine)

        // 本轮 B 项（用户报障原文：「在线值是不是刷新一下导致根本没法正常看」）——
        // **值没变的行，连元素对象都不新建**。每一行按"这一行的全部段落"算一个签名
        // （文字原样 + 值的显示/原始回报/槽宽），签名没变就直接返回上一次那一个元素对象。
        // React 对 `Object.is(prevElement, nextElement)` 的子元素会整棵子树跳过协调，
        // 所以那些行一个字符、一个属性、一次 DOM 写入都不会发生 —— 这就是"只更新变化了的
        // span"（React key 保证位置，元素复用保证不重建；两者都在，缺一不可）。
        //
        // 签名里带上 `slot`：只有"真的见到更宽的值"那一行（和它出现的每一处）会换新元素，
        // 其余行照旧复用。缓存大小由当前代码行数界定，换了对象/删了行就把多出来的丢掉。
        const renderInlineLine = (line) => {
          const segments = inlineByLine.get(line) || [{ text: lines[line - 1] }]
          const signature = segments.map((segment) => (segment.value
            ? `v\u0000${segment.value.unknown ? '?' : segment.value.display}\u0000${segment.value.raw || ''}\u0000${segment.value.slot}`
            : `t\u0000${segment.text}`)).join('\u0001')
          const cache = inlineLineCacheRef.current
          const cacheKey = `${section.id}\u0000${line}`
          const cached = cache.get(cacheKey)
          if (cached && cached.signature === signature) return cached.element
          const element = h('span', {
            key: `${section.id}-inline-${line}`,
            className: 'taskhive-codesys-inline-line',
            'data-line-number': String(line),
          }, segments.map((segment, part) => {
            if (!segment.value) return segment.text
            const key = `${section.id}-inline-${line}-${part}`
            // 稳定槽：值在这个宽度里换，后面的代码一个像素都不动（min-width 只是下限，
            // 值比槽宽时盒子照旧跟着长 —— 绝不裁切）。
            const style = onlineValueSlotStyle(segment.value.slot)
            const slot = String(Math.max(1, Number(segment.value.slot) || 1))
            // 未知：一个克制的淡色占位符，而不是编一个值（无 raw、无 tooltip）。
            if (segment.value.unknown) {
              return h('span', {
                key, className: 'taskhive-codesys-inline-value is-unknown',
                'data-line-number': String(line), 'data-online-value-unknown': 'true',
                style, 'data-online-value-slot': slot,
              }, CODESYS_ONLINE_VALUE_UNKNOWN)
            }
            // 有值：就地只有值本身（显示上去掉 IEC 类型前缀），原始回报原样放在
            // 数据属性与 title 里 —— 观测到的字符串一个比特都没有被改动。
            return h('span', {
              key, className: 'taskhive-codesys-inline-value',
              'data-line-number': String(line),
              'data-online-value-raw': segment.value.raw,
              'data-online-value-slot': slot,
              title: segment.value.raw,
              style,
            }, segment.value.display)
          }))
          cache.set(cacheKey, { signature, element })
          return element
        }
        // 段落表变短了（换了对象 / 删了行）⇒ 丢掉这一区多出来的缓存条目，
        // 缓存大小永远由"当前有多少行"界定，不随会话时长增长。
        if (inlineLineCacheRef.current.size > lines.length) {
          const prefix = `${section.id}\u0000`
          for (const key of [...inlineLineCacheRef.current.keys()]) {
            if (key.startsWith(prefix) && Number(key.slice(prefix.length)) > lines.length) inlineLineCacheRef.current.delete(key)
          }
        }
        return h('div', {
          className: `taskhive-codesys-editor-section${showInline ? ' is-inline-online' : ''}`, key: section.id,
          'data-editor-section': section.id,
          'data-section-online-values': showInline ? 'true' : 'false',
          'data-section-changed-lines': [...changed].join(','),
          // The two sections split the code pane by the user's dragged ratio.
          style: { flex: `${section.id === 'declaration' ? declarationFraction : 1 - declarationFraction} 1 0%` },
        },
        h('div', { className: 'taskhive-codesys-editor-section-head' },
          h('span', null, section.label),
          changed.size ? h('span', { className: 'taskhive-codesys-editor-changes' }, `改动 ${changed.size} 行`) : h('span', { className: 'taskhive-codesys-editor-changes' }, `${lines.length} 行`)),
        h('div', { className: 'taskhive-codesys-editor-grid' },
          h('div', { className: 'taskhive-codesys-line-gutter', ref: refs.gutter, 'aria-hidden': 'true' }, lines.map((_, index) => h('span', { key: `${section.id}-line-${index + 1}` }, index + 1))),
          h('div', { className: 'taskhive-codesys-editor-surface' },
            h('div', { className: 'taskhive-codesys-editor-highlights', ref: refs.highlight, 'aria-hidden': 'true' },
              lines.map((_, index) => h('span', {
                key: `${section.id}-hl-${index + 1}`,
                className: 'taskhive-codesys-highlight-row',
                'data-line-number': String(index + 1),
                'data-line-state': changed.has(index + 1) ? (editorLineState || 'agent') : '',
              }))),
            // 内联镜像层：整份代码的**每一行**都从这里画（`onlineInlineByLine*` 在 memo 里
            // 一次性覆盖了所有行），滚动只是平移这一层，不从"当前可见行"重算任何东西。
            // 它是纯注释层：`aria-hidden` + `pointer-events:none` + `user-select:none`，
            // 永远不接收输入、永远不会进 textarea、永远不会覆盖用户手打的草稿。
            showInline ? h('div', {
              className: 'taskhive-codesys-inline-online', ref: refs.inline,
              'data-codesys-inline-online': section.id, 'aria-hidden': 'true',
            }, lines.map((_, index) => renderInlineLine(index + 1))) : null,
            h('textarea', {
              className: `taskhive-codesys-code-editor${showInline ? ' is-inline-mirrored' : ''}`, value: section.value,
              // 本轮 B 项（冻结）：已登录到应用 ⇒ 编辑栏**只读**。`readOnly`（不是 disabled）
              // 是刻意的：光标还在、还能选中/滚动/复制，只是打不进字；不会掉进 disabled 的
              // 灰底只读样式，也就不会把"冻结"画成"坏了"。
              readOnly: onlineWriteFrozen,
              // onChange 自己也拦一次：`readOnly` 是浏览器那道门，这一条是代码这道门 ——
              // 程序化写入（测试/别的组件/未来新增的入口）同样不改内容、不产生草稿。
              onChange: (event) => { if (onlineWriteFrozen) return; section.onChange(event.target.value) },
              onScroll: syncScroll,
              // 本轮 B 项：用户正在**选中**文字时同样让路（读值节拍跳过这一拍）。
              // 只写一个时间戳：不动内容、不动选区、不产生任何 IPC。
              onSelect: noteCodesysUserActivity,
              spellCheck: false, 'data-codesys-code-editor': section.id === 'implementation' ? 'true' : 'false',
              'data-editor-part': section.id,
              'data-editor-readonly': onlineWriteFrozen ? 'true' : 'false',
              'aria-readonly': onlineWriteFrozen ? 'true' : 'false',
              'aria-label': selected
                ? `${selected.name} 的 CODESYS ${section.label}${onlineWriteFrozen ? '（在线状态：只读冻结，退出登录后可编辑）' : ''}`
                : `可编辑 CODESYS ${section.label}`,
              // T166: `busy` 不再禁用编辑器。
              //
              // 读工程 20–40 秒、构建 30–60 秒、写工程约 115 秒 —— 旧写法让它 `disabled`，
              // 于是这近两分钟里用户**连看一眼自己写的代码都做不到**（不能选中、不能滚动
              // 定位、不能改一个字符）。但"正忙"真正冲突的只有**提交动作**（写入/构建/回退/
              // 刷新/换绑）。文本编辑与查看跟后台那个 CODESYS 进程没有共享状态：
              // 编辑器改的是 `editedDeclaration/Implementation` 与草稿 Map，写盘用的是点击
              // 那一刻捕获的 `effectiveProposal`。
              //
              // 忙时输入的安全性由两条既有规则兜住：① `applyProposal` 开头的 `if (busy …) return`
              // 让重复提交是空操作；② 写入结束后 `applyInspectionPayload` 刷新 `objects`，
              // 编辑器里"与旧文本不同"的内容会被 [selectedKey, proposal] 那个 effect 当作
              // **手写改动**保留下来（而不是被新磁盘文本覆盖），并按任务 2 的规则标成待写入。
              disabled: !selected || !selectedIsCode,
              // No `title`: the native tooltip popped a dark box over the code
              // the moment the user clicked into it ("太突兀"). The section
              // heading above already names the part, and `aria-label` keeps the
              // control accessible without a hover tooltip.
              'data-no-native-tooltip': 'true',
            }))))
      }
      const editorSections = selected && selectedIsCode ? [
        ...(selected.hasDeclaration ? [{ id: 'declaration', label: '声明（Declaration）', base: oldDeclaration, value: editedDeclaration, onChange: setEditedDeclaration }] : []),
        ...(selected.hasImplementation ? [{ id: 'implementation', label: '实现（Implementation）', base: oldImplementation, value: editedImplementation, onChange: setEditedImplementation }] : []),
      ] : []
      const nudgeTreeSplit = (delta) => {
        const rect = editorRowRef.current?.getBoundingClientRect()
        const limits = CODESYS_LAYOUT_LIMITS.tree
        const minRatio = rect ? Math.max(limits.min, limits.floorPx / rect.width) : limits.min
        const maxRatio = rect ? Math.min(limits.max, 1 - limits.otherFloorPx / rect.width) : limits.max
        setTreeFraction((current) => Math.max(minRatio, Math.min(Math.max(minRatio, maxRatio), current + delta)))
      }
      const nudgeDeclarationSplit = (delta) => {
        const rect = editorBodyRef.current?.getBoundingClientRect()
        const limits = CODESYS_LAYOUT_LIMITS.declaration
        const minRatio = rect ? Math.max(limits.min, limits.floorPx / rect.height) : limits.min
        const maxRatio = rect ? Math.min(limits.max, 1 - limits.otherFloorPx / rect.height) : limits.max
        setDeclarationFraction((current) => Math.max(minRatio, Math.min(Math.max(minRatio, maxRatio), current + delta)))
      }
      const moveTreeSplit = (event) => {
        const rect = editorRowRef.current?.getBoundingClientRect()
        if (!rect || rect.width < 320) return
        const limits = CODESYS_LAYOUT_LIMITS.tree
        const minRatio = Math.max(limits.min, limits.floorPx / rect.width)
        const maxRatio = Math.min(limits.max, 1 - limits.otherFloorPx / rect.width)
        const raw = (event.clientX - rect.left) / rect.width
        setTreeFraction(Math.max(minRatio, Math.min(Math.max(minRatio, maxRatio), raw)))
      }
      const moveDeclarationSplit = (event) => {
        const rect = editorBodyRef.current?.getBoundingClientRect()
        if (!rect || rect.height < 160) return
        const limits = CODESYS_LAYOUT_LIMITS.declaration
        const minRatio = Math.max(limits.min, limits.floorPx / rect.height)
        const maxRatio = Math.min(limits.max, 1 - limits.otherFloorPx / rect.height)
        const raw = (event.clientY - rect.top) / rect.height
        setDeclarationFraction(Math.max(minRatio, Math.min(Math.max(minRatio, maxRatio), raw)))
      }
      // Drag handles are the only way to shape the layout, and the shape is kept.
      const treeSplitter = h('div', {
        className: `taskhive-codesys-split taskhive-codesys-split-v${dragging === 'tree' ? ' is-dragging' : ''}`,
        role: 'separator', 'aria-orientation': 'vertical', tabIndex: 0,
        'aria-label': '调整项目树与代码编辑器的宽度', 'aria-valuenow': String(Math.round(treeFraction * 100)),
        'data-codesys-split': 'tree',
        onPointerDown: (event) => { setDragging('tree'); beginCodesysDrag(event, moveTreeSplit, () => setDragging('')) },
        onDoubleClick: () => setTreeFraction(0.42),
        onKeyDown: (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          nudgeTreeSplit(event.key === 'ArrowRight' ? 0.04 : -0.04)
        },
      })
      // No `title` on the handles: the workbench deliberately shows no hover
      // prompts over the editing surfaces (the cursor and the line are the cue).
      const declarationSplitter = h('div', {
        className: `taskhive-codesys-split taskhive-codesys-split-h${dragging === 'declaration' ? ' is-dragging' : ''}`,
        role: 'separator', 'aria-orientation': 'horizontal', tabIndex: 0,
        'aria-label': '调整声明与实现编辑区的高度', 'aria-valuenow': String(Math.round(declarationFraction * 100)),
        'data-codesys-split': 'declaration',
        onPointerDown: (event) => { setDragging('declaration'); beginCodesysDrag(event, moveDeclarationSplit, () => setDragging('')) },
        onDoubleClick: () => setDeclarationFraction(0.38),
        onKeyDown: (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          nudgeDeclarationSplit(event.key === 'ArrowDown' ? 0.05 : -0.05)
        },
      })
      // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：这一排原来那枚
      // 「在线值 开/关」按钮、它旁边的绿灯、它的 aria-pressed/disabled 与两段 title 说明
      // **整段删除**了。值的可见性不再是一个界面状态，而是登录状态的直接结果：
      // 已登录 ⇒ 每个变量**出现的地方**（声明区与实现区、同一行有几个就标几个）都紧跟它
      // 此刻在 PLC 里的值；未登录 ⇒ 既不读也不画。删掉按钮而不是把它画成"永远按下"，
      // 是因为"没有开关"才是用户要的：没有任何东西需要他点。
      // 它从来只改"看不看值"，不触发任何写入/编译/确认 —— 这条语义一个字都没变。
      const codePane = h('section', { className: 'taskhive-codesys-code-pane', 'data-codesys-editor-change-state': editorLineState },        h('header', { className: 'taskhive-codesys-pane-heading', 'data-codesys-preview-name': selected?.name || '', 'data-codesys-preview-guid': selected?.guid || '' }, h('span', null, selected?.name || '代码编辑器'), h('small', null, editorSections.length ? editorSections.map((section) => section.id === 'declaration' ? '声明' : '实现').join(' + ') : (selected?.guid ? selected.guid.slice(0, 8) : 'ST / IEC'))),
        h('div', {
          className: 'taskhive-codesys-editor-meta', 'data-codesys-code-diff': 'true', 'data-editor-change-state': editorLineState,
          'data-changed-lines': changedLineNumbers.join(','),
          'data-changed-lines-implementation': changedLineNumbersImplementation.join(','),
        },
          h('span', { className: 'taskhive-codesys-editor-state' }, editorStateLabel),
          // 本轮 B 项（冻结）：「载入 AI 建议」把 AI 文本**写进编辑栏** —— 已登录时编辑栏
          // 是冻结的，所以这条入口也必须关掉（否则它会把冻结的编辑栏内容换掉，等于绕过冻结）。
          // 按钮**保留可见**（不是静默消失），禁用原因与出路写在 title 里。
          agentReloadAvailable ? h('button', {
            className: 'taskhive-codesys-action taskhive-codesys-reload-suggestion', type: 'button',
            title: onlineWriteFrozen ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL : '用最新的 AI 建议覆盖当前手写修改',
            disabled: onlineWriteFrozen,
            onClick: () => {
              if (onlineWriteFrozen) return
              setEditedDeclaration(newDeclaration); setEditedImplementation(newImplementation); setAgentReloadAvailable(false); setObjectDraft(selectedObjectKey, newDeclaration, newImplementation)
            },
            'data-codesys-reload-suggestion': 'true',
          }, '载入 AI 建议') : null,
          changedSummary ? h('span', { className: 'taskhive-codesys-editor-changes', title: `声明改动行：${changedLineNumbers.join(', ') || '无'}；实现改动行：${changedLineNumbersImplementation.join(', ') || '无'}` }, changedSummary) : h('span', { className: 'taskhive-codesys-editor-changes' }, '无待写入差异')),
        h('div', { className: 'taskhive-codesys-editor-body', ref: editorBodyRef }, editorSections.length
          ? editorSections.flatMap((section, index) => (index === 0 && editorSections.length > 1
            ? [renderEditorSection(section, declarationRefs), declarationSplitter]
            : [renderEditorSection(section, section.id === 'declaration' ? declarationRefs : implementationRefs)]))
          : null),
        selected && !selectedIsCode ? h('div', { className: 'taskhive-codesys-editor-hint', 'data-codesys-editor-hint': 'true' }, `${selected.name} 是${selectedKind?.label || '容器'}节点${selectedKind?.category === 'device' ? '（设备/硬件）' : ''}，没有可直接编辑的 ST 代码或声明。请在它的子节点（POU / GVL / DUT）上继续展开并选择。`) : null
      )
      // T097: 顶栏的「对话联动」徽章已按用户要求**移除** —— 底部状态行本来就显示
      // 「● 已联动到会话 xxx / ○ 未连接会话」（带待确认着色），顶栏不必重复同一件事。
      // 省下的宽度正是新增「编译」图标按钮（以及后续动作）的预算来源。

      // 这里曾经有一个「在线目标」弹层（网关 + 节点地址 + 应用 + 释放会话 + 扫描按钮）。
      // 它已被**整个删除**：目标相关的操作现在只有一处 —— 底部的「扫描设备」面板
      // （用户口径：「为什么这个依然存在，这个不是已经转移到底下了吗」）。
      // 弹层里的每一件东西都有新家：
      //   网关下拉 / 节点地址 / 应用  → 面板里的"手动指定"一行
      //   释放在线会话                → 面板头部
      //   仿真与设备 IP 备注          → 面板状态行

      const safetyText = `${activeProject?.activeGui ? '已自动绑定当前 CODESYS 工程；读取的是磁盘上的当前保存版本。' : '写入前自动保存恢复快照。'}在线仅允许登录/断开/下载（需在工作台显式授权，且只作用于绑定的工程与监视窗口）。永久禁止：在线修改、变量写入、启停/复位、调试、断点、单步与 Force。`
      return h('section', { ref: rootRef, className: 'taskhive-codesys-workbench', 'data-taskhive-codesys-workbench': 'true', 'data-codesys-job-id': jobId, 'data-codesys-bound': jobId ? 'true' : 'false', 'data-codesys-visible': workbenchVisible ? 'true' : 'false', 'data-codesys-link': sessionId ? 'ready' : 'idle', style: { overflow: 'auto', '--th-tree-fr': `${treeFraction}fr`, '--th-code-fr': `${1 - treeFraction}fr`, cursor: dragging ? (dragging === 'tree' ? 'col-resize' : 'row-resize') : undefined, userSelect: dragging ? 'none' : undefined } },
        // T081: 「当前工程」不再独占一个功能区，收进顶栏。
        // T084: 并且真的压到一行——低频操作只留图标，「当前工程」字段名与
        // 「离线工程」徽章在窄栏里隐藏（路径本身已经说明有没有绑定工程）。
        // T086: 「AI 审核」入口也搬到这一排；窄栏里标题缩成「工作台」、联动徽章缩成
        // 小圆点，把这排的宽度让给功能而不是文字。
        h('header', { className: 'taskhive-codesys-header' },
          h('div', { className: 'taskhive-codesys-header-copy', title: `CODESYS 工作台 · Harness 会话：${sessionId || '未连接'}` },
            h('strong', null, '工作台'),
            h('small', null, `Harness 会话：${sessionId || '未连接'}`)),
          h('section', { className: 'taskhive-codesys-project', 'aria-label': '当前 CODESYS 工程' },
          h('input', { className: 'taskhive-codesys-path', value: sourcePath, readOnly: true, placeholder: '自动识别当前打开的 .project 工程', title: sourcePath || '当前工程路径', 'aria-label': '当前 CODESYS 工程绝对路径', 'data-codesys-project-path': 'true' }),
          h('div', { className: 'taskhive-codesys-project-actions' },
            // 用户要求：**所有功能都放在第一行**，不再区分"离线管道 / 在线控制带"两种形态，
            // 任何控件都不因状态而消失（只置灰）。宽度够时显示文字，不够时全部退成图标。
            h('button', { className: 'taskhive-codesys-action taskhive-codesys-action-text', type: 'button', title: '重新检测当前 CODESYS 窗口中的工程、ScriptEngine 与写入权限；这是工作台唯一的检测入口（T085 起命令条不再重复一颗）', 'aria-label': '刷新当前工程', disabled: busy, onClick: () => detectCurrentProject({ force: true }), 'data-codesys-detect-project': 'true' }, codesysActionIcon('refresh'), h('span', { className: 'taskhive-codesys-action-label' }, '刷新')),
            // T097b: 用户要求「选择工程」在**绑定工程之后依然保留** —— 这样才能不重启工作台
            // 就换到另一个工程。原来它只在"未绑定 或 空树"时渲染，一旦读取成功就再也点不到。
            // 一直渲染不会增加顶栏宽度压力：宽度预算模型本来就按"它总是存在"计算。
            h('button', { className: 'taskhive-codesys-action taskhive-codesys-action-text', type: 'button', title: '选择一个现有 .project 工程文件（安装目录不是工程）。绑定工程后仍然可用，方便切换到别的工程', 'aria-label': '选择 .project 文件', disabled: busy, onClick: selectProject, 'data-codesys-select-project': 'true' }, codesysActionIcon('select'), h('span', { className: 'taskhive-codesys-action-label' }, '选择工程')),
            // Ambiguity is a PROJECT-selection problem, so its resolution lives
            // here with the other project actions — never inside the tree pane.
            detectFailure?.openProjects?.length ? h('select', {
              className: 'taskhive-codesys-open-projects', disabled: busy, value: '',
              'aria-label': '检测到正在使用中的工程', 'data-codesys-open-projects': 'true',
              title: detectFailure.openProjects.map((entry) => entry.projectPath).join('\n'),
              onChange: (event) => {
                const target = String(event.target.value || '');
                if (!target) return;
                setDetectFailure(null);
                void bindSourceProject(target, null).catch((error) => setStatus(`工程读取失败：${error.message}`));
              },
            },
            h('option', { value: '' }, `检测到 ${detectFailure.openProjects.length} 个正在使用中的工程…`),
            detectFailure.openProjects.map((entry) => h('option', { key: entry.projectPath, value: entry.projectPath }, `${entry.name}${entry.pid ? ` · PID ${entry.pid}` : ''}`))) : null,
            // T086: AI 审核入口搬到顶栏，与其它工作台级动作同排。底部条因此只剩
            // 「写入」一件事，不再出现"两个同款实心主按钮分属两个域"的割裂感。
            h(CodesysTaskComposer, { jobId, busy, sessionId, selectedName: selected?.name || '', onSubmitRef: submitRef }),
            // T097: 独立的「编译」入口。**宽档显示「编译」字样**方便辨识，窄栏（<380px 容器）
            // 由现成的 `-action-text` 容器查询自动退化成 26px 纯图标 —— 和「刷新 / 选择工程」
            // 完全同一套机制，不需要新规则。顶栏仍必须留在一行：宽度预算由 compact-layout
            // 契约量化（去掉联动徽章与另两颗按钮之后，文字版也过）。
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-text', type: 'button',
              title: jobId
                ? '离线编译当前工程（增量 build，约 30–60 秒）。只编译磁盘上已保存工程的隔离副本：不写入工程、不连接 PLC。按住 Shift 点击 = 全量重建 rebuild。'
                : '尚未绑定工程，无法编译。请先用「刷新」或「选择工程」绑定一个 .project。',
              'aria-label': '离线编译当前工程（Shift 点击为全量重建）',
              disabled: busy || !jobId,
              onClick: (event) => { void runCompile(event?.shiftKey ? 'rebuild' : 'build') },
              'data-codesys-compile': 'true',
            }, codesysActionIcon('build'), h('span', { className: 'taskhive-codesys-action-label' }, '编译')),
            // T097: 「复制当前工程绝对路径」与「在资源管理器定位当前工程」已按用户要求移除
            // （不需要这两项功能；路径本身就在左边那个只读输入框里，可以直接选中复制）。
            // 这两颗图标腾出的 52px 也让顶栏的宽度预算宽松了很多。
            // ⚠️ 桌面探针 probeCodesysWorkbenchProject 原会点这两颗按钮并把结果算进 ok；
            // 同步改成"断言它们不存在"，否则 --smoke-ui 会直接失败。
            h('button', { className: 'taskhive-codesys-action taskhive-codesys-action-text', type: 'button', title: writeAvailable ? '一键恢复到本次绑定时的代码基线；每次重新绑定工程会建立新的基线' : (activeProject?.writeBlockReason || '当前工程暂不可跨进程写入'), 'aria-label': '一键回退到绑定基线', disabled: busy || !jobId || !writeAvailable, onClick: rollback, 'data-codesys-rollback': 'true' }, codesysActionIcon('rollback'), h('span', { className: 'taskhive-codesys-action-label' }, '回退')),
            // Online (PLC) controls. Rendered only once a project is bound, so the
            // top bar keeps its one-line budget while no online action is possible.
            // 登录 = connect only; 断开 = end session + authorization; 下载 = transfer.
            jobId ? h('span', {
              className: 'taskhive-codesys-online', 'data-codesys-online': 'true',
              'data-codesys-online-state': onlineConnected ? 'logged-in' : 'idle',
              title: [
                `在线目标（来自工程里该设备的通信设置，登录前即可核对）：`,
                `设备：${onlineDeviceLabel}`,
                `设备标识：${onlineIdentity || '未读到'}`,
                `型号 / 厂商：${onlineModelLabel || '未读到'}`,
                `设备 IP / 端口：${onlineIpLabel}`,
                `网关节点地址：${onlineAddress || '未读到'}`,
                `网关：${onlineGatewayLabel || '未读到'}`,
                `目标来源：${onlineTargetSourceLabel}`,
                `仿真模式：${onlineSimulationLabel}`,
                `应用状态：${onlineAppLabel || '（未登录，读不到）'}`,
                ...(onlineOperationFlags.length ? [`设备标志：${onlineOperationFlags.join(' · ')}`] : []),
                ...(onlineOperationWarnings.length ? [`⚠️ 注意：${onlineOperationWarnings.join(' · ')}`] : []),
                `工程：${sourcePath || '(未绑定)'}`,
                ...(Array.isArray(onlineTargetInfo?.targetErrors) && onlineTargetInfo.targetErrors.length ? [`读取告警：${onlineTargetInfo.targetErrors.join(' | ')}`] : []),
                '「扫描设备」可直接搜索网络中的 PLC（不会写入工程文件）',
                '永久禁止：在线修改、变量写入、启停/复位、调试、断点、单步、Force',
              ].join('\n'),
            },
            // 未连接时不显示任何状态文字；一旦登录成功，就是一个醒目的绿色标识。
            onlineConnected ? h('button', {
              className: `taskhive-codesys-online-badge${onlineOperationWarnings.length ? ' is-warning' : ''}`, type: 'button',
              'data-codesys-online-badge': 'true',
              'data-codesys-online-warning': onlineOperationWarnings.length ? 'on' : 'off',
              'aria-label': `已登录 ${onlineAddress || 'PLC'}${onlineLoggedIn ? '（在线变量已开启）' : ''}，点此打开扫描面板`,
              title: [
                '已登录到 PLC',
                `设备：${onlineDeviceLabel}`,
                `地址：${onlineAddress || '未读到'}`,
                `应用状态：${onlineAppLabel || '未知'}`,
                `登录方式：${onlineLoggedIn
                  ? (onlineState?.state?.loginMode === 'transfer'
                    ? '下载 / 在线修改建立的登录（设备上的程序已确认是当前工程）'
                    : '只登录、不传输（Keep）：够读在线变量，启停/复位/写变量/Force 仍需先「下载」')
                  : '已连接，但尚未登录到应用（读不到在线值：请点「登录」或「下载」）'}`,
                ...(onlineLoggedIn ? ['在线变量：切到某个 POU，声明区/实现区里每个变量后面就显示它此刻的当前值（登录后自动显示）'] : []),
                ...(onlineOperationFlags.length ? [`设备标志：${onlineOperationFlags.join(' · ')}`] : []),
                ...(onlineOperationWarnings.length ? ['', `⚠️ ${onlineOperationWarnings.join(' · ')}`, '请先处理这些再离开。'] : []),
                '点此可更改目标（不会写入工程文件）',
              ].join('\n'),
              onClick: () => openOnlineTargetPanel(),
            },
            h('span', { className: 'taskhive-codesys-online-dot is-logged-in', 'aria-hidden': 'true' }),
            h('span', { className: 'taskhive-codesys-online-badge-label' }, onlineLoggedIn ? '在线' : '已连接')) : null,
            // 引擎比磁盘旧：在线功能会按**旧代码**执行（例如旧的文件命名、旧的登录语义），
            // 报错会非常难懂。直接在这一排说清楚，并给出唯一解法。
            engineFreshness?.stale ? h('span', {
              className: 'taskhive-codesys-engine-stale',
              'data-codesys-engine-stale': ['channel-missing', 'no-bridge'].includes(engineFreshness.reason) ? 'channel-missing' : 'files-changed',
              role: 'status',
              title: [
                'TaskHive 主进程仍是启动时加载的那份代码，而磁盘上的在线引擎已经更新。',
                engineFreshness.reason === 'channel-missing'
                  ? '（连"引擎自检"通道都还不存在 —— 说明主进程比当前界面旧。）'
                  : `（启动后被改过的文件：${(engineFreshness.changed || []).join('、') || '未知'}）`,
                '',
                '在线功能会继续按旧引擎运行：登录语义、文件命名、并发保护都可能是旧的。',
                '解法：完全退出并重新启动 TaskHive（刷新页面不够）。',
              ].join('\n'),
            }, '⚠️ 请重启 TaskHive：在线引擎是旧版本') : null,
            // 「扫描设备」= 绑定入口：**选过设备之后它自己变成「已绑定」**（用户口径：
            // "扫描设备绑定过设备之后应该把扫描设备变成已绑定，而不是登录的时候再弹出
            // 一个已连接单独提示"）。绑定状态来自作业元数据，在线进程重启也不会丢。
            // 宽度足够时显示文字（≥620px），窄栏由容器查询退化成 26px 图标；
            // 已绑定时连图标一起换成对勾，窄栏也看得出状态。
            h('button', {
              className: `taskhive-codesys-action taskhive-codesys-action-text taskhive-codesys-online-scan${onlineBound ? ' is-bound' : ''}`, type: 'button',
              title: onlineConnected
                ? `已绑定并已连接：${onlineTargetSummary}\n要更换设备请先「断开」，再点这里重新扫描。`
                : (onlineBound
                  ? `已绑定在线目标：\n${onlineTargetDetail}\n\n点这里重新扫描并更换设备（只改工程副本的内存值，不写工程文件）。`
                  : '扫描网络中的 PLC 设备（CODESYS 网关广播发现，不连接任何设备）。\n点开后是工作台底部的扫描面板：先列出网关上次记录的设备，再跑实时广播。'),
              'aria-label': onlineBound ? `已绑定 ${onlineTargetSummary}，点此重新扫描` : '扫描 PLC 设备',
              'data-codesys-online-bound': onlineBound ? 'true' : 'false',
              disabled: scanBusy || onlineConnected || !jobId,
              onClick: () => { void openScanDialog() },
              'data-codesys-online-scan-open': 'true',
            }, codesysActionIcon(onlineBound ? 'onlineBound' : 'onlineScan'), h('span', { className: 'taskhive-codesys-action-label' }, onlineBound ? onlineBoundLabel : '扫描设备')),
            // 1/2/3（登录 / 断开 / 下载）**永远都在**，只按状态置灰 —— 用户要求这三个
            // 按键不得因状态而不渲染（此前"连上后登录消失、未连时断开/下载消失"）。
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',
              title: onlineConnected
                ? '已连接到 PLC（如需重新连接请先「断开」）'
                : (!onlineReady
                  ? '正在读取在线进程里的目标设备（约 20–40 秒，不连接 PLC）…'
                  : `登录/连接到 PLC —— 只建立连接并登录应用，绝不传输程序。\n${onlineTargetDetail}`),
              'aria-label': onlineBound ? '登录到 PLC（只连接，不下载）' : '登录到 PLC（需先绑定设备）',
              // 未绑定时**不禁用**：按钮仍然可点，点了就在状态栏说明该先绑定。用户口径：
              // "不应该为常驻提示信息，应该是点击在线功能状态栏提示一下就可以"。
              // 引擎侧仍会拒绝（CODESYS_ONLINE_TARGET_NOT_BOUND），这里只是把话说在前面。
              disabled: onlineBusy || busy || !onlineReady || onlineConnected,
              // 登录不再弹"连哪台设备"的确认框：设备就写在「已绑定」那颗按钮上，
              // 登录时状态行也会再说一遍。
              onClick: () => {
                if (!onlineBound) {
                  setStatus('尚未绑定设备：请先点「扫描设备」选中一台 PLC（选中后那颗按钮会变成「已绑定」），再点「登录」。工程文件里配置的目标只是记录，不作为登录依据。')
                  return
                }
                void runOnline('online-login')
              },
              'data-codesys-online-login': 'true',
            }, codesysActionIcon('onlineLogin'), h('span', { className: 'taskhive-codesys-action-label' }, '登录')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',
              title: onlineConnected ? '断开与 PLC 的连接，并结束本次在线会话与授权' : '尚未连接：无需断开',
              'aria-label': '断开 PLC 连接',
              disabled: onlineBusy || !onlineConnected,
              onClick: () => { void runOnline('online-logout') },
              'data-codesys-online-logout': 'true',
            }, codesysActionIcon('onlineLogout'), h('span', { className: 'taskhive-codesys-action-label' }, '断开')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly taskhive-codesys-online-download', type: 'button',
              title: onlineConnected
                ? `下载到 PLC —— 把磁盘上已保存的工程传输到设备并登录。会停止设备上正在运行的应用，且不会自动重新启动。\n${onlineTargetDetail}\n若设备上的程序与工程一致，则只登录、不传输。`
                : '尚未连接：请先点「登录」。',
              'aria-label': '下载到 PLC',
              // 未绑定时同样不禁用：点下去在状态栏说明原因（引擎会拒绝，界面先说清楚）。
              disabled: onlineBusy || busy || !onlineConnected,
              // 下载是唯一会把程序写进设备的动作：点下去之前必须看到"传到哪台设备"。
              onClick: () => {
                if (!onlineBound) {
                  setStatus('尚未绑定设备：请先点「扫描设备」选中一台 PLC，再点「下载」。')
                  return
                }
                void (async () => {
                  const ok = await confirmOnlineTarget(
                    '把当前工程下载到这台设备？',
                    '会把磁盘上已保存的工程传给设备，并停止设备上正在运行的应用（不会自动重启）。\n下载 ≠ 写入工程文件：你自己的 .project 不会被改动。',
                  )
                  if (ok) await runOnline('online-download')
                })()
              },
              'data-codesys-online-download': 'true',
            }, codesysActionIcon('onlineDownload'), h('span', { className: 'taskhive-codesys-action-label' }, '下载')),
            // 功能 4/6/7/8/5/12 + 取消强制：**始终渲染**，未登录时置灰。
            // 用户要求所有功能都在第一行，不再因状态隐藏。
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',
              title: '在线修改（Online Change）—— 不中断运行修改程序。失败时 CODESYS 会自动改为完整下载（会停机）。\n要求：已点「下载」登录过应用。',
              'aria-label': '在线修改',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runOnline('online-change') },
              'data-codesys-online-change': 'true',
            }, codesysActionIcon('onlineChange'), h('span', { className: 'taskhive-codesys-action-label' }, '在线修改')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly taskhive-codesys-online-danger', type: 'button',
              title: '启动应用（Start）—— 程序开始执行，机械可能立即动作。',
              'aria-label': '启动应用',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runOnline('online-start') },
              'data-codesys-online-start': 'true',
            }, codesysActionIcon('onlineStart'), h('span', { className: 'taskhive-codesys-action-label' }, '启动')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',
              title: '停止应用（Stop）—— 程序停止，设备会停在当前位置。',
              'aria-label': '停止应用',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runOnline('online-stop') },
              'data-codesys-online-stop': 'true',
            }, codesysActionIcon('onlineStop'), h('span', { className: 'taskhive-codesys-action-label' }, '停止')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly taskhive-codesys-online-danger', type: 'button',
              title: `复位设备（Reset）—— 热/冷/原始复位。冷复位会清空保持变量。\n执行前需要输入确认词「${CODESYS_HARD_GATE_PHRASE.reset}」。`,
              'aria-label': '复位设备（需确认词）',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runDangerousOnline('online-reset', 'reset', {
                title: '复位设备（危险）',
                lines: [
                  '复位会重启控制器上的应用；冷复位（Cold）会清空保持变量，原始复位（Original）会恢复初值。',
                  '如果设备正在运行、或机械停在受力位置，复位可能造成意外动作。',
                ],
                confirmLabel: '复位',
                phrase: CODESYS_HARD_GATE_PHRASE.reset,
              }) },
              'data-codesys-online-reset': 'true',
            }, codesysActionIcon('onlineReset'), h('span', { className: 'taskhive-codesys-action-label' }, '复位')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly taskhive-codesys-online-danger', type: 'button',
              title: `在线写变量（Write）—— 写一次值。程序下一周期会覆盖它，所以不等于强制。\n写设定点可能让轴立刻动作。执行前需要输入确认词「${CODESYS_HARD_GATE_PHRASE['write-variable']}」。`,
              'aria-label': '在线写变量（需确认词）',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runDangerousOnline('online-write', 'write-variable', {
                title: '在线写变量（危险）',
                lines: [
                  '逐条填写「表达式 = 目标值」。写完之后**不会**保持不变——程序下一周期会用自己的值覆盖它。',
                  '如果写的是设定点/使能/命令字，机械可能立刻动作。',
                ],
                confirmLabel: '写入',
                phrase: CODESYS_HARD_GATE_PHRASE['write-variable'],
              }) },
              'data-codesys-online-write': 'true',
            }, codesysActionIcon('onlineWrite'), h('span', { className: 'taskhive-codesys-action-label' }, '写值')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly taskhive-codesys-online-danger', type: 'button',
              title: `强制变量（Force）—— 最危险的一项：强制值会**覆盖程序输出**，程序自己算什么都不算数。\n执行前需要输入确认词「${CODESYS_HARD_GATE_PHRASE.force}」；用完请立刻点「取消强制」。`,
              'aria-label': '强制变量（需确认词）',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runDangerousOnline('online-force', 'force', {
                title: '强制变量（Force · 最危险）',
                lines: [
                  '强制会**覆盖程序输出**：即使程序把输出算成 FALSE，强制 TRUE 就是 TRUE。',
                  '这是最容易撞机的一项。用完请立刻点「取消强制」，不要把它留在设备上过夜。',
                ],
                confirmLabel: '强制',
                phrase: CODESYS_HARD_GATE_PHRASE.force,
              }) },
              'data-codesys-online-force': 'true',
            }, codesysActionIcon('onlineForce'), h('span', { className: 'taskhive-codesys-action-label' }, 'Force')),
            h('button', {
              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',
              title: '取消全部强制（Unforce）—— 安全方向，不需要确认词。\n从设备上摘掉所有 Force，让程序重新掌控输出。',
              'aria-label': '取消全部强制',
              disabled: onlineBusy || busy || !onlineState?.state?.isLoggedIn,
              onClick: () => { void runOnline('online-unforce') },
              'data-codesys-online-unforce': 'true',
            }, codesysActionIcon('onlineUnforce'), h('span', { className: 'taskhive-codesys-action-label' }, '取消强制'))) : null)),
          // 「在线目标」弹层已整体删除：目标相关的操作现在只有底部「扫描设备」面板一处。
          ),
        // T086: 这条现在是纯粹的「工程写入」条。AI 审核入口已搬到顶栏，所以这里
        // 不再有"两个同款实心主按钮分属两个域"的割裂感，也不需要 1px 分组竖线。
        // 条内唯一的主按钮是「确认写入」；省下的宽度自动归给可伸缩的"原因"文案。
        // 本轮（抽屉化）：整段变成条件渲染，空闲时一个节点都不出现（详见把手与细节处的注释）。
        writeDrawerNeeded ? h('section', {
          className: `taskhive-codesys-commandbar ${writeAvailable ? 'is-ready' : 'is-blocked'}${writeDrawerExpanded ? ' is-open' : ''}`,
          'aria-label': '工程写入状态', 'data-codesys-commandbar': 'true', 'data-codesys-write-panel': 'true',
          'data-codesys-write-drawer': writeDrawerExpanded ? 'open' : 'closed',
        },
          // 紧凑把手：一行、克制（`写入 · <此刻最该说的一件事>`）。点它展开细节，再点收起。
          h('button', {
            className: 'taskhive-codesys-write-handle', type: 'button',
            'aria-expanded': writeDrawerExpanded ? 'true' : 'false',
            'aria-controls': 'taskhive-codesys-write-drawer-body',
            'aria-label': `写入 · ${writeHandleLabel}`,
            title: `${writeDrawerExpanded ? '收起' : '展开'}写入细节（提案状态 / 冻结原因 / 上次写入结果）\n${writeStateDetail}`,
            onClick: () => setWriteDrawerOpen((current) => !current),
            'data-codesys-write-handle': 'true',
          },
            h('strong', { className: 'taskhive-codesys-write-heading' }, '写入'),
            h('span', { className: 'taskhive-codesys-write-state', title: writeStateDetail, 'data-codesys-write-state': 'true' }, writeHandleLabel)),
          h('span', { className: 'taskhive-codesys-write-detail', title: writeStateDetail, 'data-codesys-write-reason': 'true' }, writeStateDetail),
          effectiveChanges.length ? h('label', { className: 'taskhive-codesys-review', title: '写入前必须逐行核对项目树标记与代码差异；未勾选时确认按钮保持禁用' },
            h('input', { type: 'checkbox', checked: reviewAccepted, onChange: (event) => setReviewAccepted(event.target.checked), 'data-codesys-review-accepted': 'true' }), '已核对') : null,
          // T085: 这里原来还有一颗「重新检测」，但它与顶栏「刷新」调用的是**同一个**
          // detectCurrentProject({ force: true })——同一面板里两个入口做同一件事。
          // 按用户确认删除后，约 59px 全部让给上面那条"不可写入的原因"文案（它是
          // flex:1 1 0，会自动吸收）。检测入口只剩顶栏那一颗，它的 title 已补上
          // "ScriptEngine 与写入权限"，能力不丢。
          // 本轮 B 项（冻结）：已登录到应用时这枚按钮**禁用**，title 就是那唯一一行
          // "原因 + 出路"。它不是"工程不可写"，所以 title 也必须换掉（否则用户会照着
          // "创建恢复快照后写入…"的提示反复点一个不会响应的按钮）。
          // 禁用只是"看得见"的那一半：`applyProposal` 自己也拦（抽屉那条路），引擎也会拒绝。
          h('button', {
            className: 'taskhive-codesys-submit taskhive-codesys-confirm-write', type: 'button',
            title: onlineWriteFrozen
              ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL
              : (writeAvailable ? '创建恢复快照后写入当前工程并执行离线编译' : (writeBlockReason || '当前工程暂不可写入')),
            disabled: onlineWriteFrozen || busy || !writeAvailable || !effectiveChanges.length || !reviewAccepted || effectiveErrors.length > 0,
            onClick: () => { void applyProposal(effectiveProposal, effectiveErrors) },
            'data-codesys-confirm-write': 'true',
            'data-codesys-write-frozen': onlineWriteFrozen ? 'true' : 'false',
          }, '确认写入'),
          // 本轮：**放弃** —— 用户原话「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」。
          // 与「确认写入」并排（就在它右边），但**不受写入闸门约束**：放弃只减少待写入内容
          // （AI 提案 + 手写草稿）并把编辑器退回磁盘上的最新版本，一个字节都不写工程 ——
          // 所以工程不可写时它照样可用（只读工程里也常常有一份想丢掉的提案）。
          // 只有"工作台正忙"才禁用（原因进 title）；**没有待放弃内容时整枚按钮不出现**
          // （与抽屉那枚同一条口径：提案或手写草稿至少有一个才画它）。
          (effectiveChanges.length > 0 || countUnsavedDrafts() > 0) ? h('button', {
            className: 'taskhive-codesys-action taskhive-codesys-discard-proposal', type: 'button',
            title: busy ? '工作台正在执行另一项操作：等它结束再放弃' : '放弃当前提案与工作台里的手写改动，回到磁盘上的最新版本',
            'aria-label': '放弃当前提案与工作台里的手写改动，回到磁盘上的最新版本',
            disabled: busy,
            onClick: () => { void discardProposal() },
            'data-codesys-discard-proposal': 'true',
          }, '放弃') : null,
          // T166: 探测到「另一个工程」时的可见提示。任务 2 的要求是**绝不无声丢弃草稿**：
          // 后台探测发现换绑目标、而当前有未写入修改（或工作台正忙）时，换绑不再是自动的
          // —— 这里把"换到哪个工程 / 会丢多少处修改"摆出来，由用户决定。
          //
          // 位置与样式说明：CSS 片段（60-*.js）不在本次改动范围内，而工作台根网格给
          // header / editor / commandbar 都写了**显式 grid-row**，插一个新的顶层子元素会被
          // 自动排到后面的行（跑到编辑器下面）。所以提示作为命令条的最后一个子元素渲染，并
          // 用行内 `flexBasis:100%` 让它在同一个 flex 行里换行独占一行 —— 不需要新 CSS。
          rebindNotice ? h('span', {
            className: 'taskhive-codesys-rebind-notice', role: 'alert',
            'data-codesys-rebind-notice': 'true',
            'data-codesys-rebind-unsaved': String(rebindNotice.unsavedDraftCount || 0),
            style: { flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '4px', padding: '4px 8px', borderRadius: '6px', background: 'var(--th-warn-tint, #3a3000)', border: '1px solid var(--th-warn-line, #8a6d00)', color: 'inherit', fontSize: '12px' },
          },
            h('span', null, `检测到另一个 CODESYS 工程「${codesysBaseName(rebindNotice.detected?.sourcePath || '')}」`),
            h('span', null, rebindNotice.unsavedDraftCount > 0
              ? `当前有 ${rebindNotice.unsavedDraftCount} 处未写入的修改，已保留；换绑会丢弃它们。`
              : '当前没有未写入的修改。'),
            h('button', {
              className: 'taskhive-codesys-action', type: 'button',
              title: '切换到探测到的那个工程（会丢弃上面列出的未写入修改）',
              'data-codesys-rebind-switch': 'true',
              onClick: () => {
                const target = rebindNotice.detected
                setRebindNotice(null)
                pendingDetectionRef.current = null
                if (!target?.sourcePath) return
                void bindSourceProject(target.sourcePath, target).catch((error) => setStatus(`工程读取失败：${codesysScriptEngineErrorMessage(error)}`))
              },
            }, '切换工程（丢弃修改）'),
            h('button', {
              className: 'taskhive-codesys-action', type: 'button',
              title: '保留当前工程与全部草稿；这次探测结果被忽略，直到下一次探测',
              'data-codesys-rebind-keep': 'true',
              onClick: () => {
                setRebindNotice(null)
                pendingDetectionRef.current = null
                setStatus('已保留当前工程与未写入的修改；这次检测到的另一个工程被忽略。')
              },
            }, '保留当前工程')) : null,
          // 抽屉的**细节**：默认收起（`hidden` + `data-codesys-write-drawer-body` 同步，
          // `aria-expanded` 在把手上），只有用户点开才可见。它只说明三件事：
          // 提案状态 / 冻结原因 / 上次写入结果（外加一条：上次编译失败时的计数）。
          // 换行独占一行用的是既有的行内 `flexBasis:100%` 做法（与上面 rebind 提示同一套）。
          //
          // 本轮（写入行抽屉化）用户口径原文：「把「写入 · 等待 AI 改动」那一行改成抽屉式，
          // 只在需要时出现」——① 空闲时这一行**根本不存在**（DOM 里零文字、零高度），不再
          // 常驻说一句"等待 AI 改动"；② 只有四件事之一为真时才出现这个把手：有待确认提案
          // （AI 提案或手写草稿）/ 正在写入 / 在线已冻结（T217）/ 上次写入或编译失败；
          // ③ 把手默认**收起**，点它才展开，再点收起，绝不自动展开抢注意力；
          // ④「确认写入 / 放弃」仍留在这一行里（位置与行为不变，冻结时禁用 + 同一行原因）。
          // 判据全是**渲染派生值**：不写工程、不改闸门、不加定时器、不发起任何 IPC
          // （MUTATING 仍然是 0）；写入仍然只在用户点击「确认写入」之后发生，冻结语义一字未动。
          h('div', {
            id: 'taskhive-codesys-write-drawer-body',
            className: 'taskhive-codesys-write-drawer',
            hidden: !writeDrawerExpanded,
            'data-codesys-write-drawer-body': writeDrawerExpanded ? 'open' : 'closed',
            style: { flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed var(--th-line)', fontSize: '9.5px', lineHeight: '1.45', color: 'var(--th-ink-2)' },
          },
            h('span', { 'data-codesys-drawer-proposal': 'true' }, writeDrawerProposalLine),
            writeDrawerFreezeLine ? h('span', { 'data-codesys-drawer-frozen': 'true' }, writeDrawerFreezeLine) : null,
            h('span', { 'data-codesys-drawer-lastwrite': 'true' }, writeDrawerLastLine),
            writeDrawerCompileLine ? h('span', { 'data-codesys-drawer-compile': 'true' }, writeDrawerCompileLine) : null))
          : null,
        // T097: 编译输出。紧挨产生它的动作（命令条）放，作为工作台根网格的一个新直接子元素
        // —— 它会自动获得一个隐式 auto 行，所以被契约断言的两条 grid-template-rows 都不用改。
        // 没有编译结果时完全不渲染，不占高度。
        compileReport ? h('section', {
          className: `taskhive-codesys-compile${compileOpen ? ' is-open' : ''}`,
          'aria-label': '编译输出', 'data-codesys-compile-output': 'true',
        },
          h('div', { className: 'taskhive-codesys-compile-head' },
            h('button', {
              className: 'taskhive-codesys-compile-toggle', type: 'button',
              'aria-expanded': compileOpen ? 'true' : 'false',
              title: compileOpen ? '收起编译输出' : '展开编译输出（完整消息文本，可复制）',
              onClick: () => setCompileOpen((current) => !current),
              'data-codesys-compile-toggle': 'true',
            }, `${compileOpen ? '▾' : '▸'} 编译输出 · ${compileCountText(compileReport)}`),
            h('span', { className: 'taskhive-codesys-compile-meta', title: `工程：${compileReport.projectPath || '(未绑定)'}` }, `${compileReport.mode === 'rebuild' ? '全量重建' : '增量 build'} · ${new Date(compileReport.at).toLocaleTimeString()}`),
            h('button', { className: 'taskhive-codesys-compile-copy', type: 'button', title: '复制完整编译输出文本', onClick: () => { void copyCompileReport() }, 'data-codesys-compile-copy': 'true' }, '复制'),
            h('button', { className: 'taskhive-codesys-compile-clear', type: 'button', title: '清除编译输出', onClick: () => { setCompileReport(null); setCompileOpen(false) }, 'data-codesys-compile-clear': 'true' }, '×')),
          compileOpen ? h('div', { className: 'taskhive-codesys-compile-body', 'data-codesys-compile-text': 'true' },
            // T226：口径说明**只在这里**。头部只有"错误 N · 警告 M"两个数；"汇总 28 / 明细 29"
            // 这类差异、以及超过 1000 条上限时哪一部分没载入，都用这里的一行如实说出来。
            // T227：明细不再折叠 ⇒ 这些说明**直接显示在明细列表上方**（不需要点任何按钮），
            // 而且只在真的需要解释时才出现（明细与汇总相等时 `compileCountNotes` 返回空数组）。
            ...compileCountNotes(compileReport).map((note, index) => h('div', {
              key: `note-${index}`,
              className: 'taskhive-codesys-compile-note',
              'data-codesys-compile-note': 'true',
            }, note)),
            compileReport.messages.length
              // T227：明细**全量平铺**，没有折叠、没有分组、没有「展开查看全部 N 条」。每一条
              // 消息各占一行：**按原始顺序**、**重复的逐条列**（不按文本去重、不合成 ×N）、
              // **`[Info]` 行一条不少**（如「开始构建应用程序」「代码典型化...」以及编译器自己的
              // 总结行「编译完成 -- 0错误,28警告」）。行文本与「复制」出来的文本逐字一致 ——
              // 不加工、不缩写、不猜语言，所以"屏幕上看到几行"就等于"收到了几条"。
              // 行数 = `messages.length`；`messagesTotal` 更大时由上面那行上限说明如实交代。
              ? h('div', { className: 'taskhive-codesys-compile-lines', 'data-codesys-compile-lines': 'true' },
                ...compileReport.messages.map((item, index) => h('div', {
                  key: `line-${index}`,
                  className: `taskhive-codesys-compile-line is-${compileSeverityKind(item?.severity)}`,
                  'data-codesys-compile-line': 'true',
                  'data-codesys-compile-index': String(index),
                }, `[${String(item?.severity || 'info')}] ${String(item?.text || '')}`)))
              : h('div', { className: 'taskhive-codesys-compile-line is-info' }, '编译完成，没有产生任何消息。'))
          : null)
        : null,
        // 「扫描设备」底部面板：与「编译输出」同一形态（用户口径："改成和编译一样的底部弹出"）。
        // 头部给状态 + 计时；正文是可点选的设备列表。扫描要等网关广播，所以计时把
        // "CODESYS 进程启动"和"网关扫描"分开报：这 20 秒花在哪儿，一眼能看出来。
        scanOpen ? h('section', {
          className: `taskhive-codesys-compile taskhive-codesys-scan${scanBusy ? ' is-busy' : ''}`,
          'data-codesys-scan-panel': 'true',
          // 面板当前显示的是哪一轮的结果（cached = 网关上次记录 / live = 实时广播）。
          // 设备行上还有每台设备各自的 source（含 cache-fallback）。
          'data-codesys-scan-mode': String(scanReport?.mode || (scanBusy && scanReport?.phase === 'cache' ? 'cached' : '')),
        },
          h('div', { className: 'taskhive-codesys-compile-head' },
            h('button', {
              className: 'taskhive-codesys-compile-toggle', type: 'button',
              'aria-expanded': 'true',
              title: '收起扫描面板（扫描本身不受影响）',
              onClick: () => setScanOpen(false),
              'data-codesys-scan-collapse': 'true',
            }, `▾ 扫描设备 · ${scanPhaseText}`),
            h('span', {
              className: 'taskhive-codesys-compile-meta',
              'data-codesys-scan-timing': 'true',
              title: [
                '计时分解：',
                `CODESYS 在线进程：${scanReport?.sessionReused ? '复用了已运行的进程（未重启）' : (scanReport?.prepareMs ? codesysFormatMs(scanReport.prepareMs) : '尚未完成')}`,
                `网关上次记录（缓存轮）：${scanReport?.cacheMs ? codesysFormatMs(scanReport.cacheMs) : '—'}`,
                `实时广播（live 轮）：${scanReport?.liveMs ? codesysFormatMs(scanReport.liveMs) : '—'}`,
                `合计：${scanBusy ? `进行中，已用 ${scanSeconds} 秒` : (scanReport?.totalMs ? codesysFormatMs(scanReport.totalMs) : '—')}`,
              ].join('\n'),
            }, scanTimingText),
            h('button', {
              className: 'taskhive-codesys-compile-copy', type: 'button',
              title: '重新跑实时广播（网关会重新发现设备，通常 5–30 秒）',
              disabled: scanBusy || !jobId,
              onClick: () => { void runScan(false) },
              'data-codesys-scan-rescan': 'true',
            }, '重新扫描'),
            h('button', {
              className: 'taskhive-codesys-compile-copy', type: 'button',
              title: '只读网关上次记录的结果（秒回，不广播）',
              disabled: scanBusy || !jobId,
              onClick: () => { void runScan(true) },
              'data-codesys-scan-cache': 'true',
            }, '上次记录'),
            // 常驻会话会一直占着一个 CODESYS 进程（约 700 MB）：释放入口从被删掉的
            // 「在线目标」弹层搬到这里（面板头部的右侧）。
            h('button', {
              className: 'taskhive-codesys-compile-copy', type: 'button',
              disabled: targetBusy || !onlineState?.running,
              title: onlineState?.running
                ? `释放在线会话：结束常驻的 CODESYS 进程${onlineState?.pid ? `（PID ${onlineState.pid}）` : ''}，腾出内存。下次登录会重新启动它（约 20–40 秒）。`
                : '当前没有常驻在线会话',
              onClick: () => { void releaseOnlineSession() },
              'data-codesys-scan-release': 'true',
            }, onlineState?.running ? '释放会话' : '无会话'),
            h('button', {
              className: 'taskhive-codesys-compile-clear', type: 'button',
              title: '关闭扫描面板', onClick: () => { setScanOpen(false); setScanReport(null) },
              'data-codesys-scan-close': 'true',
            }, '×')),
          h('div', { className: 'taskhive-codesys-compile-body taskhive-codesys-scan-body', 'data-codesys-scan-list': 'true' },
            h('div', {
              className: 'taskhive-codesys-compile-line is-info',
              'data-codesys-scan-status': 'true',
            }, scanBusy
              ? `${scanReport?.phase === 'cache' ? '正在准备在线会话并读取网关上次记录的设备…' : '正在扫描网络…'} 已用 ${scanSeconds} 秒${scanReport?.phase === 'cache' && !scanReport?.prepareMs ? '（首次要启动 CODESYS 在线进程，约 20–40 秒；只读工程副本，不连接任何设备）' : '（网关正在广播发现设备，不连接任何设备）'}`
              : (scanReport?.error
                ? `扫描失败：${scanReport.error}`
                : `扫描完成 · 发现 ${Number(scanReport?.deviceCount || 0)} 台设备 · ${scanReport?.mode === 'cached' ? '来自网关上次记录' : '来自实时广播'}${onlineSimulation ? ` · 仿真：${onlineSimulationLabel}` : ''}`)),
            ...(scanBusy ? [] : scanRows),
            // 手动指定目标（原「在线目标」弹层迁移到这里）：网关 + 节点地址。
            // 从列表里点一台设备是最常用的路径；这一行是"知道节点地址、不想扫描"时的入口。
            h('div', { className: 'taskhive-codesys-scan-manual', 'data-codesys-scan-manual': 'true' },
              h('select', {
                className: 'taskhive-codesys-online-target-select', 'data-codesys-scan-gateway': 'true',
                'aria-label': '网关', title: '本机网关：扫描与手动绑定都用它；与工程里配置的不一致时登录会连不上',
                disabled: targetBusy || onlineConnected, value: targetDraft.gatewayName,
                onChange: (event) => {
                  const name = String(event.target.value || '')
                  const choice = onlineGatewayChoices.find((item) => String(item.name || '') === name)
                  setTargetDraft((draft) => ({ ...draft, gatewayName: name, gatewayGuid: String(choice?.guid || '') }))
                },
              },
              ...(onlineGatewayChoices.length
                ? onlineGatewayChoices.map((item, index) => h('option', { key: `gw-${index}`, value: String(item.name || '') }, `${item.name || '(未命名网关)'}${item.guid ? ` · ${String(item.guid).slice(0, 8)}` : ''}`))
                : [h('option', { key: 'gw-none', value: '' }, '（未枚举到网关）')])),
              h('input', {
                className: 'taskhive-codesys-online-target-address', 'data-codesys-scan-address': 'true',
                'aria-label': '设备节点地址', disabled: targetBusy || onlineConnected,
                value: targetDraft.address,
                placeholder: `节点地址（当前：${onlineAddress || '未读到'}）`,
                onChange: (event) => setTargetDraft((draft) => ({ ...draft, address: event.target.value })),
                'data-no-native-tooltip': 'true',
              }),
              h('button', {
                className: 'taskhive-codesys-online-target-apply', type: 'button',
                disabled: targetBusy || onlineConnected || !jobId,
                title: onlineConnected
                  ? '已连接状态下不能更改目标，请先「断开」'
                  : '用上面这个网关 + 节点地址绑成在线目标（不写工程文件）。',
                onClick: () => { void applyOnlineTarget() },
                'data-codesys-scan-address-apply': 'true',
              }, targetBusy ? '应用中…' : '用作目标')),
            // IP 直连**就在这个面板里**（用户口径：「ip 直连不应该是独立窗口，应该融合到
            // 扫描设备的窗口」），而且**不需要先扫描**：填了 IP 直接「用作目标」即可。
            // 网关沿用扫描结果/在线进程已读到的那一个（CODESYS 的 IP 直连也是经网关的
            // 直连路由）；一个都还没读到时，会自动先跑一次"上次记录"把网关读出来。
            h('div', { className: 'taskhive-codesys-scan-ip', 'data-codesys-scan-ip-row': 'true' },
              h('span', { className: 'taskhive-codesys-scan-ip-label' }, 'IP 直连'),
              // 复用「在线目标」面板里那两个输入框/按钮的**同一组类名**：皮肤、高度、圆角、
              // 焦点环全部一致，不再是一排"裸 HTML 控件"（用户口径：方框区域太丑，不是皮肤 UI 风格）。
              h('input', {
                className: 'taskhive-codesys-online-target-address', 'data-codesys-scan-ip': 'true',
                'aria-label': 'PLC 的 IPv4 地址', disabled: targetBusy || onlineConnected,
                value: ipDraft.ipAddress, placeholder: '直接填 PLC 的 IP，例如 192.168.31.58（不必先扫描）',
                onChange: (event) => setIpDraft((draft) => ({ ...draft, ipAddress: event.target.value })),
                'data-no-native-tooltip': 'true',
              }),
              h('input', {
                className: 'taskhive-codesys-online-target-address is-port', 'data-codesys-scan-ip-port': 'true',
                'aria-label': '端口（可选）', disabled: targetBusy || onlineConnected,
                value: ipDraft.port, placeholder: '端口',
                onChange: (event) => setIpDraft((draft) => ({ ...draft, port: event.target.value.replace(/[^0-9]/g, '') })),
                'data-no-native-tooltip': 'true',
              }),
              h('button', {
                className: 'taskhive-codesys-online-target-apply', type: 'button',
                disabled: targetBusy || onlineConnected || !jobId,
                title: onlineConnected
                  ? '已连接状态下不能更改目标，请先「断开」'
                  : '把这个 IP 绑成在线目标（IP 直连）：不需要先扫描，也不写工程文件。\n注意：IP 模式没有读回接口，能不能连上只能靠随后点「登录」验证。',
                onClick: () => { void applyDirectIp() },
                'data-codesys-scan-ip-apply': 'true',
              }, targetBusy ? '应用中…' : '用作目标')))) : null,
        h('div', { className: 'taskhive-codesys-editor', ref: editorRowRef },
          h('section', { className: 'taskhive-codesys-object-pane' },
            h('header', { className: 'taskhive-codesys-pane-heading' }, h('span', null, '项目对象'), h('small', null, displayObjects.length ? `${displayObjects.length} 项 · ${treeMaxDepth + 1} 层${changedObjectCount ? ` · 已修改 ${changedObjectCount}` : ''}${!showInternal && internalObjects.length ? ` · 隐藏内部 ${internalObjects.length}` : ''}` : '未读取')),
            h('div', { className: 'taskhive-codesys-tree-toolbar', role: 'group', 'aria-label': '项目树过滤' },
              ...[['all', '全部'], ['code', '仅代码'], ['device', '设备·容器']].map(([value, label]) => h('button', {
                key: value, className: `taskhive-codesys-filter${treeFilter === value ? ' is-active' : ''}`, type: 'button',
                'aria-pressed': treeFilter === value ? 'true' : 'false', 'data-codesys-tree-filter': value,
                title: value === 'all' ? '显示完整项目树' : value === 'code' ? '只显示 POU / GVL / DUT 等代码对象（保留其完整层级）' : '只显示设备、容器、库管理器等非代码节点',
                onClick: () => setTreeFilter(value),
              }, label)),
              // T082: 「全展开 / 全折叠」已按用户要求删除（"这个区域的全按键删除，
              // 都不需要"）。树的默认状态本来就是全展开，逐节点仍可用 twisty 折叠；
              // 选中对象时也会自动展开并露出它所在的层级。这样工具栏在默认 400px
              // 侧栏下回到一行，把约 20px 还给对象树。
              internalObjects.length ? h('button', {
                className: `taskhive-codesys-filter${showInternal ? ' is-active' : ''}`, type: 'button',
                'aria-pressed': showInternal ? 'true' : 'false', 'data-codesys-tree-internal': showInternal ? 'on' : 'off',
                title: '显示/隐藏 CODESYS 内部对象（__ 开头）与工程级重复对象；真实 CODESYS 默认不显示它们',
                onClick: () => setShowInternal((current) => !current),
              }, `内部 ${internalObjects.length}`) : null),
            h('div', { className: 'taskhive-codesys-tree', role: 'tree', 'aria-label': 'CODESYS 项目树', 'data-codesys-project-tree': 'true', 'data-codesys-tree-filter': treeFilter, 'data-codesys-tree-cache': treeCacheLabel },
              treeRows.length
                ? treeRows
                : (displayObjects.length
                  ? h('small', { className: 'taskhive-codesys-status' }, '当前过滤条件下没有可显示的对象')
                  : h('div', { className: 'taskhive-codesys-empty', 'data-codesys-tree-empty': 'true' },
                    h('strong', null, '尚未读取工程树'),
                    h('small', null, detectFailure ? codesysDetectFailureHint(detectFailure) : (busy ? '正在读取当前工程…（首次需启动 CODESYS ScriptEngine，约 20–40 秒）' : '等待绑定当前 CODESYS 工程。')),
                    // The actions live ONCE, in the 当前工程 row above: repeating
                    // them here duplicated the workbench's own controls. This pane
                    // only points at them.
                    h('small', { className: 'taskhive-codesys-empty-pointer' }, '用上方「当前工程」一行的『刷新』或『选择工程』。')))),
            h('div', { className: 'taskhive-codesys-legend', 'aria-label': '颜色图例' },
              h('span', { 'data-legend': 'agent' }, 'AI 提案待确认'),
              h('span', { 'data-legend': 'manual' }, '手写未写入'),
              h('span', { 'data-legend': 'written' }, '已写入工程'),
              h('span', { 'data-legend': 'pending-create' }, '待新增'))),
          treeSplitter,
          codePane),
        assistantText ? h('div', { className: 'taskhive-codesys-assistant' }, assistantText) : null,
        // T081: 核对勾选框移入「工程写入」那一行，提案区只留结论与阻塞原因。
        effectiveChanges.length ? h('section', { className: 'taskhive-codesys-proposal' },
          h('strong', null, `待应用：${effectiveChanges.length} 个对象${manualChange ? '（含手写修改）' : ''}${proposalSource === 'chat' ? ' · 来自对话' : proposalSource === 'workbench' ? ' · 来自代码任务' : ''}`),
          effectiveErrors.length ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-label-primary,#171717)', whiteSpace: 'pre-wrap', fontSize: '11px' } }, `当前提案不可写入：\n${effectiveErrors.join('\n')}`) : null) : null,
        // T082: 底栏只留一行小字。左边是运行状态（单行省略号，完整内容在 title），
        // 右边是安全边界的 ⓘ（全文在悬浮/键盘焦点里）。原来是 status + safety 两行。
        // T090: 再加上「联动到哪个会话」——T084 把顶栏的会话号藏起来之后，用户没有
        // 任何地方能确认联动是否正常，只能靠"模型读不到"来发现，反馈回路太差。
        h('footer', { className: 'taskhive-codesys-statusrow' },
          // 在线状态就放在底部状态行：不用悬停也能看到 PLC 处在什么状态。
          onlineConnected ? h('span', {
            className: `taskhive-codesys-online-state${onlineOperationWarnings.length ? ' is-warning' : ''}`,
            'data-codesys-online-state-text': 'true',
            title: [
              `应用状态：${onlineAppLabel || '未知'}`,
              ...(onlineOperationFlags.length ? [`设备标志：${onlineOperationFlags.join(' · ')}`] : []),
              ...(onlineOperationWarnings.length ? [`⚠️ ${onlineOperationWarnings.join(' · ')}`] : []),
            ].join('\n'),
          }, onlineOperationWarnings.length
            ? `⚠️ PLC ${onlineAppLabel || ''} · ${onlineOperationWarnings.join(' · ')}`
            : `PLC ${onlineAppLabel || ''}${onlineOperationFlags.length ? ` · ${onlineOperationFlags.slice(0, 2).join(' · ')}` : ''}`) : null,
          // 目标 chip：过去只在**已连接**时出现（T111 用户口径："应该只是一行提示字…不应该
          // 常驻"，针对的是当时那个"未选择"占位 chip）。现在只要**真的读到了目标**就出现 ——
          // 包括"未扫描、未登录"时从工程里读到的那台：用户口径是"能读到在线数据吧"，而
          // "登录会作用到哪台设备"正是最该先看到的那条数据。读不到时仍然什么都不显示
          // （不复活"未选择"占位，也不编一台设备）。
          onlineTargetKnown ? h('button', {
            className: `taskhive-codesys-online-target-chip${onlineConnected ? ' is-online' : ' is-project'}`,
            type: 'button',
            'data-codesys-online-target-summary': onlineTargetSource || 'project',
            'data-codesys-online-target-bound': onlineBound ? 'true' : 'false',
            'data-codesys-online-target-source': onlineBound ? 'bound' : 'project',
            title: `${onlineConnected ? '当前已连接' : '工程里配置的目标'}：${onlineTargetSummary}\n${onlineTargetDetail}\n\n点这里打开底部「扫描设备」面板（可重新扫描或直接填 IP）。`,
            onClick: () => openOnlineTargetPanel(),
          }, `目标 ${onlineTargetSummary}${onlineTargetSourceNote ? ` · ${onlineTargetSourceNote}` : ''}`) : null,
          // 共享连接**只作提示** ✗：网关报告"另有客户端已连"（很可能就是 CODESYS IDE 自己
          // 在线）。工作台据此**不做任何决定** —— 不自动登录、不切目标、不释放会话，也绝不
          // 去断别人的连接；文案也不承诺"可以和 IDE 共存"（共存尚未在真机上验证过）。
          !onlineConnected && onlineSharedConnected ? h('span', {
            className: 'taskhive-codesys-online-shared',
            'data-codesys-online-shared': 'true',
            role: 'status',
            title: [
              'CODESYS 网关报告：另有客户端持有这台设备的共享连接，可能是 CODESYS IDE 正在在线。',
              '这只是一条提示，不是决策依据：工作台不会因此自动登录、不会切换目标、也不会断开任何人的连接。',
              '在线会话仍以原生 CODESYS IDE 为主；工作台的在线能力处于验证/开发阶段。',
            ].join('\n'),
          }, '另有客户端持有共享连接（可能是 CODESYS IDE）') : null,
          h('span', {
            className: `taskhive-codesys-linkstate${effectiveChanges.length ? ' is-pending' : ''}${sessionId ? '' : ' is-idle'}`,
            title: sessionId
              ? `工作台状态发布到当前活动会话 ${sessionId}${effectiveChanges.length ? `；有 ${effectiveChanges.length} 处待确认改动` : (changedObjectCount ? `；已写入 ${changedObjectCount} 个对象` : '；暂无待确认改动')}。切换会话时它会自动跟着走。`
              : '当前没有活动会话，工作台状态没有人接收。请先在对话里打开一个会话。',
            'data-codesys-linkstate': sessionId ? 'linked' : 'unlinked',
          },
            sessionId ? '●' : '○',
            h('span', { className: 'taskhive-codesys-linkstate-label' }, sessionId ? ` 已联动到会话 ${codesysSessionLabel(sessionId)}` : ' 未连接会话')),
          h('div', { className: 'taskhive-codesys-status', role: 'status', title: statusProjectPath ? `${status}\n${statusProjectPath}` : status, 'data-codesys-workbench-status': 'true' },
            status,
            busy ? h('span', { className: 'taskhive-codesys-busy-timer', 'data-codesys-busy-seconds': String(busySeconds) }, ` · 已等待 ${busySeconds} 秒（首次读取需启动 CODESYS ScriptEngine，约 20–40 秒，请保持工作台打开）`) : null,
            // 在线动作进行中（登录要等 20–40 秒）：**放在最下面的状态栏**（用户口径：
            // "提示登录字样应该在最下面的状态提示栏"），和状态文字同一处，不再占顶栏宽度。
            onlineBusy ? h('span', {
              className: 'taskhive-codesys-online-pending',
              'data-codesys-online-pending': 'true',
              role: 'status',
              'aria-live': 'polite',
              title: `${onlinePending || '正在执行在线动作'}（已等待 ${onlineBusySeconds} 秒）\n期间工作台不会发起其他在线请求。`,
            }, `⏳ ${onlinePending || '正在执行在线动作'} · ${onlineBusySeconds}s`) : null),
          h('span', { className: 'taskhive-codesys-safety', tabIndex: 0, title: safetyText, 'aria-label': safetyText, 'data-codesys-safety': 'true' }, 'ⓘ 安全边界')))
    }

    // 真正的错误边界：以前这里只有一个 render()，没有 componentDidCatch —— 一旦工作台
    // 渲染抛异常，React 会把整块卸掉，用户看到的**就是一片空白**，没有任何线索。
    // 现在把异常本身画出来（可复制），"空白"从此有话说。
    class CodesysWorkbenchBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error, info) {
        try { console.error('[taskhive-codesys] workbench render failed', error, info) } catch { /* console may be gone */ }
      }
      render() {
        const error = this.state.error
        if (!error) return h(CodesysWorkbench, { ctx: this.props.ctx, ownerSessionId: this.props.ownerSessionId, tabVisible: this.props.tabVisible })
        const text = `${error?.name || 'Error'}: ${String(error?.message || error)}`
        return h('section', {
          className: 'taskhive-codesys-workbench taskhive-codesys-crash',
          'data-taskhive-codesys-crash': 'true',
          role: 'alert',
        },
        h('strong', null, 'CODESYS 工作台渲染失败（这是崩溃，不是空白）'),
        h('p', { className: 'taskhive-codesys-crash-text' }, text),
        h('p', null, '把这段文字发我即可定位；下面可以一键复制。渲染失败不会影响 CODESYS 本身，也不会动工程文件。'),
        h('div', { className: 'taskhive-codesys-crash-actions' },
          h('button', {
            type: 'button',
            onClick: () => { try { void navigator.clipboard?.writeText(text) } catch { /* clipboard may be unavailable */ } },
          }, '复制错误'),
          h('button', { type: 'button', onClick: () => this.setState({ error: null }) }, '重试渲染')))
      }
    }
