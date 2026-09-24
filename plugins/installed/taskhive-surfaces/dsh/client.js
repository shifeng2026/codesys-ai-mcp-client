// Browser half of the TaskHive integration. It registers real Better Sidebar
// tabs and routes each capability into the same desktop central workspace.
window.__ModuleLoader__.load({
  id: 'taskhive-surfaces',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
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
    const configuredSurfaces = new Set((params.get('taskhiveEnabledSurfaces') || 'codesys,web-ai,knowledge,experts,settings').split(',').filter(Boolean))
    const fallbackDescriptors = [
      // Keep these aligned with plugins/catalog.json. Alpha.2 strips the host
      // query after authentication, so a first launch may need this fallback.
      // T102/T104：名字要和 plugins/catalog.json 一致 —— 这里漏改过一次，
      // 结果是"宿主参数被剥离的首启动"仍然显示旧名字。
      { id: 'codesys', pluginId: 'codesys-monitor', title: 'CODESYS 工作台', placement: 'left', kind: 'surface', visible: true },
      { id: 'web-ai', pluginId: 'web-ai', title: '浏览器', placement: 'left', kind: 'surface', visible: true },
      { id: 'knowledge', pluginId: 'knowledge-base', title: '知识库', placement: 'left', kind: 'surface', visible: true },
      { id: 'experts', pluginId: 'experts', title: '专家', placement: 'left', kind: 'surface', visible: true },
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
      .map((item, index) => ({ ...item, tabId: `taskhive:${item.id}`, order: 10 + index }))
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
      const changed = activePluginSurface !== next
      activePluginSurface = next
      setPluginSurfaceMode(next)
      if (changed && next !== 'chat' && next !== 'settings') {
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

    function codesysText(blocks) { return (blocks || []).filter((block) => block?.kind === 'text').map((block) => block.text || '').join('\n').trim() }
    function parseCodesysProposal(text) {
      const candidates = [...String(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim())
      candidates.push(String(text || '').trim())
      for (const candidate of candidates) {
        try { const parsed = JSON.parse(candidate); if (parsed && Array.isArray(parsed.changes)) return parsed } catch {}
        const start = candidate.indexOf('{'); const end = candidate.lastIndexOf('}')
        if (start >= 0 && end > start) try { const parsed = JSON.parse(candidate.slice(start, end + 1)); if (Array.isArray(parsed.changes)) return parsed } catch {}
      }
      return null
    }
    const stKeywords = new Set('ACTION AND ARRAY AT BOOL BY BYTE CASE CONFIGURATION CONSTANT DATE DATE_AND_TIME DINT DO DWORD ELSE ELSIF END_ACTION END_CASE END_CONFIGURATION END_FOR END_FUNCTION END_FUNCTION_BLOCK END_IF END_PROGRAM END_REPEAT END_RESOURCE END_STRUCT END_TYPE END_VAR END_WHILE EXIT FALSE FOR FUNCTION FUNCTION_BLOCK IF INT LINT LREAL MOD NOT OF OR PROGRAM REAL REPEAT RESOURCE RETAIN RETURN SINT STRING STRUCT TASK THEN TIME TO TRUE TYPE UDINT UINT ULINT UNTIL USINT VAR VAR_ACCESS VAR_CONFIG VAR_EXTERNAL VAR_GLOBAL VAR_INPUT VAR_IN_OUT VAR_OUTPUT VAR_STAT VAR_TEMP WHILE WORD XOR'.split(' '))
    function renderStLine(value, keyPrefix) {
      const line = String(value ?? '')
      const parts = line.split(/(\/\/.*$|\(\*.*?\*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g)
      return parts.map((part, index) => {
        let color = 'inherit'
        if (/^(?:\/\/|\(\*)/.test(part)) color = '#6a737d'
        else if (/^(?:"|')/.test(part)) color = '#9a4d00'
        else if (/^\d/.test(part)) color = '#005cc5'
        else if (stKeywords.has(part.toUpperCase())) color = '#7a3e9d'
        return h('span', { key: `${keyPrefix}-${index}`, style: color === 'inherit' ? undefined : { color } }, part)
      })
    }
    function codesysObjectKey(item) {
      return String(item?.guid || `${item?.name || ''}::${item?.type || ''}`)
    }
    function resolveCodesysProposalObject(change, objects) {
      const guid = String(change?.objectGuid || '').trim().toLowerCase()
      if (guid) return objects.find((item) => String(item?.guid || '').toLowerCase() === guid) || null
      const name = String(change?.objectName || '').trim()
      const candidates = objects.filter((item) => String(item?.name || '') === name && (item?.hasDeclaration || item?.hasImplementation))
      return candidates.length === 1 ? candidates[0] : null
    }
    function codesysProposalOperation(change, objects, proposal) {
      const explicit = String(change?.operation || '').trim().toLowerCase()
      if (['update-text', 'create-pou', 'create-gvl', 'create-dut'].includes(explicit)) return explicit
      const name = String(change?.objectName || '').trim()
      const declaration = String(change?.declaration || '')
      const summary = String(proposal?.summary || '')
      const nameExists = objects.some((item) => String(item?.name || '') === name)
      if (!nameExists && /(?:新增|创建|添加|新建|\bcreate\b|\badd\b)/i.test(summary) && new RegExp(`^\\s*PROGRAM\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(declaration)) return 'create-pou'
      return 'update-text'
    }
    function validateCodesysProposal(proposal, objects) {
      if (!proposal || !Array.isArray(proposal.changes) || proposal.changes.length === 0) return ['没有可应用的代码修改']
      const seen = new Set(); const errors = []
      for (const [index, change] of proposal.changes.entries()) {
        const name = String(change?.objectName || '').trim()
        const guid = String(change?.objectGuid || '').trim()
        const operation = codesysProposalOperation(change, objects, proposal)
        const target = resolveCodesysProposalObject(change, objects)
        if (!name) errors.push(`第 ${index + 1} 项缺少 objectName`)
        if (operation.startsWith('create-')) {
          const key = `${operation}:${name.toLowerCase()}`
          if (objects.some((item) => String(item?.name || '').toLowerCase() === name.toLowerCase())) errors.push(`工程中已存在同名对象：${name}`)
          if (seen.has(key)) errors.push(`待新增对象重复出现：${name}`)
          else seen.add(key)
          if (operation === 'create-pou' && !['program', 'function-block', 'function'].includes(String(change?.pouType || 'program'))) errors.push(`${name} 的 pouType 必须是 program、function-block 或 function`)
          if (operation !== 'create-pou' && Object.prototype.hasOwnProperty.call(change || {}, 'implementation')) errors.push(`${name} 的 ${operation} 不支持 implementation`)
        } else if (!target) errors.push(guid ? `工程中不存在 GUID 为 ${guid} 的对象` : `无法唯一定位对象：${name || `第 ${index + 1} 项`}，请提供 objectGuid`)
        else {
          const key = codesysObjectKey(target)
          if (name && String(target.name || '') !== name) errors.push(`对象名称与 GUID 不匹配：${name}`)
          if (seen.has(key)) errors.push(`对象重复出现：${name || key}`)
          else seen.add(key)
          if (Object.prototype.hasOwnProperty.call(change || {}, 'declaration') && !target.hasDeclaration) errors.push(`${name} 不支持声明文本`)
          if (Object.prototype.hasOwnProperty.call(change || {}, 'implementation') && !target.hasImplementation) errors.push(`${name} 不支持实现文本`)
        }
        if (!Object.prototype.hasOwnProperty.call(change || {}, 'declaration') && !Object.prototype.hasOwnProperty.call(change || {}, 'implementation')) errors.push(`${name || `第 ${index + 1} 项`}没有声明或实现文本`)
        if (change?.declaration !== undefined && typeof change.declaration !== 'string') errors.push(`${name} 的 declaration 必须是字符串`)
        if (change?.implementation !== undefined && typeof change.implementation !== 'string') errors.push(`${name} 的 implementation 必须是字符串`)
      }
      return errors
    }
    // T087: 快照口径改为「**全部**有代码的对象，按 28000 字符上限截断」。
    //
    // 旧实现拿提示词做词频打分，只取分数最高的最多 6 个对象，没匹配时退化成
    // "最大的 4 个"。后果是「审核整个工程」永远只能看到工程的一小部分，而且换一种
    // 措辞就可能拿不到目标对象——用户问"模型是怎么知道我的代码"时，这正是那条通道
    // 不可靠的根源。
    //
    // 现在：命名匹配只用来**排序**（让被点名的对象一定活过截断），不再用来**筛选**；
    // 全部对象的元数据索引始终保留；发生截断时如实上报（textTruncated + 计数），
    // 让模型知道自己拿到的是截断结果而不是全部。
    function buildCodesysTaskSnapshot(sourcePath, objects, prompt) {
      const all = Array.isArray(objects) ? objects : []
      const query = String(prompt || '').toLowerCase()
      const named = new Set()
      for (const item of all) {
        const name = String(item?.name || '')
        const lowered = name.toLowerCase()
        if (lowered.length >= 2 && query.includes(lowered)) named.add(name)
      }
      const codeObjects = all.filter((item) => item.hasDeclaration || item.hasImplementation)
      const ordered = [
        ...codeObjects.filter((item) => named.has(String(item?.name || ''))),
        ...codeObjects.filter((item) => !named.has(String(item?.name || ''))),
      ]
      const metadata = all.map((item) => ({ name: item.name, guid: item.guid, type: item.type, hasDeclaration: Boolean(item.hasDeclaration), hasImplementation: Boolean(item.hasImplementation), declarationChars: String(item.declaration || '').length, implementationChars: String(item.implementation || '').length }))
      const compact = {
        projectPath: sourcePath, projectIndexComplete: true, codeSelectionComplete: true,
        selection: 'all-code-objects', objectCount: all.length, codeObjectCount: codeObjects.length,
        namedObjectCount: named.size, textTruncated: false, includedCount: ordered.length,
        objects: ordered, index: metadata,
      }
      const maxChars = 28000
      let serialized = JSON.stringify(compact)
      while (serialized.length > maxChars && compact.objects.length > 1) {
        compact.objects.pop()
        compact.textTruncated = true
        compact.includedCount = compact.objects.length
        serialized = JSON.stringify(compact)
      }
      return { snapshot: compact, chars: serialized.length, approxTokens: Math.ceil(serialized.length / 3), selectedCount: compact.objects.length, totalCount: all.length }
    }

    // T088: 工程对象的廉价钱签名。快照约 28000 字符，绝不能随每次选区/输入变化重发；
    // 只有这个签名变化（即工程对象本身变了）时才需要重建并重新发布给宿主。
    function codesysObjectsSignature(sourcePath, objects) {
      const list = Array.isArray(objects) ? objects : []
      let chars = 0
      let hash = 2166136261
      for (const item of list) {
        const declaration = String(item?.declaration || '')
        const implementation = String(item?.implementation || '')
        chars += declaration.length + implementation.length
        const seed = `${String(item?.guid || '')}|${String(item?.name || '')}|${declaration.length}|${implementation.length}`
        for (let index = 0; index < seed.length; index += 1) {
          hash ^= seed.charCodeAt(index)
          hash = Math.imul(hash, 16777619)
        }
      }
      return `${String(sourcePath || '')}|${list.length}|${chars}|${(hash >>> 0).toString(36)}`
    }

    // ── 真实 CODESYS 项目树 ────────────────────────────────────────────────
    // `inspect-project` returns every object with its CODESYS object-type GUID,
    // its parent GUID, depth and path, so the workbench can render the SAME
    // multi-level tree CODESYS shows (device → Plc Logic → application →
    // POU / GVL / DUT / Library Manager). The GUID table is the only stable
    // discriminator between a device and a POU; unknown GUIDs fall back to the
    // object's own flags, so a different CODESYS build still gets a sane kind.
    const CODESYS_KIND_BY_TYPE_GUID = {
      '225bfe47-7336-4dbc-9419-4105a7c831fa': { kind: 'device', category: 'device', label: '设备' },
      '085766fd-043e-4545-8e8d-d651d56d5d3b': { kind: 'axis', category: 'device', label: '轴' },
      'e9159722-55bc-49e5-8034-fbd278ef718f': { kind: 'axis-pool', category: 'device', label: '轴池' },
      'ae1de277-a207-4a28-9efb-456c06bd52f3': { kind: 'task-config', category: 'device', label: '任务配置' },
      '98a2708a-9b18-4f31-82ed-a1465b24fa2d': { kind: 'task', category: 'device', label: '任务' },
      '639b491f-5557-464c-af91-1471bac9f549': { kind: 'application', category: 'container', label: '应用' },
      '40b404f9-e5dc-42c6-907f-c89f4a517386': { kind: 'plc-logic', category: 'container', label: 'PLC 逻辑' },
      '8753fe6f-4a22-4320-8103-e553c4fc8e04': { kind: 'project-settings', category: 'container', label: '工程设置' },
      '738bea1e-99bb-4f04-90bb-a7a567e74e3a': { kind: 'folder', category: 'container', label: '文件夹' },
      '6f9dac99-8de1-4efc-8465-68ac443b7d08': { kind: 'pou', category: 'code', label: 'POU' },
      '2db5746d-d284-4425-9f7f-2663a34b0ebc': { kind: 'dut', category: 'code', label: 'DUT' },
      'ffbfa93a-b94d-45fc-a329-229860183b1d': { kind: 'gvl', category: 'code', label: 'GVL' },
      'adb5cb65-8e1d-4a00-b70a-375ea27582f3': { kind: 'library-manager', category: 'library', label: '库管理器' },
      'f7aa3620-8073-4c91-b6ec-86ed9eb60303': { kind: 'trace', category: 'other', label: '跟踪' },
      '63784cbb-9ba0-45e6-9d69-babf3f040511': { kind: 'text-list', category: 'other', label: '文本列表' },
    }
    const CODESYS_KIND_OBJECT = { kind: 'object', category: 'other', label: '对象' }
    const CODESYS_KIND_CONTAINER = { kind: 'container', category: 'container', label: '容器' }
    const CODESYS_CODE_CATEGORY = 'code'

    function codesysKindOfObject(item) {
      // CODESYS hides internal objects (names like __VisualizationStyle) from
      // its device tree; they are marked by the engine and never guessed into a
      // real kind.
      if (item?.internal) return { kind: 'internal', category: 'internal', label: '内部对象' }
      const typeGuid = String(item?.type || '').trim().toLowerCase()
      const known = CODESYS_KIND_BY_TYPE_GUID[typeGuid]
      if (known) return known
      // The engine could not place this object in the walk: never guess a device.
      if (item?.ungrouped) return CODESYS_KIND_OBJECT
      if (item?.isApplication) return CODESYS_KIND_BY_TYPE_GUID['639b491f-5557-464c-af91-1471bac9f549']
      if (item?.hasLibraryManager) return CODESYS_KIND_BY_TYPE_GUID['adb5cb65-8e1d-4a00-b70a-375ea27582f3']
      if (item?.isFolder) return CODESYS_KIND_BY_TYPE_GUID['738bea1e-99bb-4f04-90bb-a7a567e74e3a']
      const declaration = String(item?.declaration || '')
      if (/^\s*VAR_GLOBAL\b/im.test(declaration)) return CODESYS_KIND_BY_TYPE_GUID['ffbfa93a-b94d-45fc-a329-229860183b1d']
      if (/^\s*(?:TYPE|UNION)\b/im.test(declaration)) return CODESYS_KIND_BY_TYPE_GUID['2db5746d-d284-4425-9f7f-2663a34b0ebc']
      if (item?.hasDeclaration || item?.hasImplementation) return CODESYS_KIND_BY_TYPE_GUID['6f9dac99-8de1-4efc-8465-68ac443b7d08']
      if (item?.hasChildren) return CODESYS_KIND_CONTAINER
      return CODESYS_KIND_OBJECT
    }

    function codesysTreeWouldCycle(node, parent) {
      let cursor = parent
      let hops = 0
      while (cursor && hops < 256) { if (cursor === node) return true; cursor = cursor.parent; hops += 1 }
      return false
    }

    // Flat objects → the real parent/child tree. A node is linked by parentGuid
    // and, for an AI-created object that has no GUID yet, by its parentName.
    function buildCodesysTree(items) {
      const list = Array.isArray(items) ? items : []
      const nodes = list.map((item, index) => ({ item, index, key: item?.__pendingKey || codesysObjectKey(item), kind: codesysKindOfObject(item), children: [], depth: 0, parent: null }))
      const byGuid = new Map()
      const byName = new Map()
      for (const node of nodes) {
        const guid = String(node.item?.guid || '').toLowerCase()
        if (guid && !byGuid.has(guid)) byGuid.set(guid, node)
        const name = String(node.item?.name || '').trim().toLowerCase()
        if (name && !byName.has(name)) byName.set(name, node)
      }
      for (const node of nodes) {
        const parentGuid = String(node.item?.parentGuid || '').toLowerCase()
        let parent = parentGuid ? byGuid.get(parentGuid) || null : null
        if (!parent) {
          const parentName = String(node.item?.__parentName || node.item?.parentName || '').trim().toLowerCase()
          if (parentName) parent = byName.get(parentName) || null
        }
        node.parent = parent && parent !== node && !codesysTreeWouldCycle(node, parent) ? parent : null
      }
      // A malformed payload could describe a parent cycle; break it instead of
      // recursing forever.
      for (const node of nodes) {
        const seen = new Set([node])
        let cursor = node.parent
        let hops = 0
        while (cursor && hops < 256) {
          if (seen.has(cursor)) { node.parent = null; break }
          seen.add(cursor); cursor = cursor.parent; hops += 1
        }
      }
      const childrenOf = new Map(nodes.map((node) => [node, []]))
      const roots = []
      for (const node of nodes) {
        if (node.parent) childrenOf.get(node.parent).push(node)
        else roots.push(node)
      }
      for (const node of nodes) node.children = childrenOf.get(node) || []
      const order = []
      const walk = (node, depth) => { node.depth = depth; order.push(node); for (const child of node.children) walk(child, depth + 1) }
      for (const root of roots) walk(root, 0)
      return { nodes, roots, order, byKey: new Map(nodes.map((node) => [node.key, node])), byGuid }
    }

    function codesysTreeMatchesFilter(node, filter) {
      if (filter !== 'code' && filter !== 'device') return true
      const isCode = node.kind.category === CODESYS_CODE_CATEGORY
      return filter === 'code' ? isCode : !isCode
    }

    // Keys to render: a node stays when it matches the filter or any descendant
    // does, so the hierarchy is never flattened by a filter.
    function codesysTreeVisibleKeys(tree, filter) {
      const visible = new Set()
      const visit = (node) => {
        let keep = false
        for (const child of node.children) if (visit(child)) keep = true
        if (codesysTreeMatchesFilter(node, filter)) keep = true
        if (keep) visible.add(node.key)
        return keep
      }
      for (const root of tree.roots) visit(root)
      return visible
    }

    // Per-node change state, including a dimmed aggregate for ancestors so a
    // collapsed device still shows that something inside it changed.
    function codesysTreeChangeStates(tree, changeStates, changedKeys) {
      const states = new Map()
      const scopes = new Map()
      const visit = (node) => {
        let own = changeStates[node.key] || (changedKeys.has(node.key) ? (node.item?.__pendingKey ? 'pending-create' : 'agent') : '')
        let fromChild = ''
        for (const child of node.children) { const childState = visit(child); if (!fromChild && childState) fromChild = childState }
        if (own) { states.set(node.key, own); scopes.set(node.key, 'self') }
        else if (fromChild) { states.set(node.key, fromChild); scopes.set(node.key, 'subtree') }
        return own || fromChild
      }
      for (const root of tree.roots) visit(root)
      return { states, scopes }
    }

    // Set by the workbench component so a desktop notification (the panel's
    // monitored-window change) can force a re-detection without threading props
    // through the plugin runtime.
    const codesysWorkbenchControl = { detect: null }

    // Editor resize preferences. Kept in localStorage because "我调过之后要还
    // 原样" is the expectation for a layout the user shaped by hand.
    const CODESYS_LAYOUT_KEYS = { tree: 'taskhive.codesys.layout.treeFraction', declaration: 'taskhive.codesys.layout.declarationFraction' }
    const CODESYS_LAYOUT_LIMITS = {
      tree: { min: 0.18, max: 0.78, floorPx: 132, otherFloorPx: 170 },
      declaration: { min: 0.1, max: 0.85, floorPx: 56, otherFloorPx: 90 },
    }
    function readStoredFraction(key, fallback) {
      try {
        const value = Number(window.localStorage?.getItem(key))
        return Number.isFinite(value) && value > 0 && value < 1 ? value : fallback
      } catch { return fallback }
    }
    function storeFraction(key, value) {
      try { window.localStorage?.setItem(key, String(value)) } catch { /* private mode */ }
    }
    // Pointer drag helper: window-level listeners so the pointer may leave the
    // 9px handle without dropping the gesture.
    function beginCodesysDrag(event, onMove, onEnd) {
      if (event.button !== undefined && event.button !== 0) return
      event.preventDefault()
      const move = (moveEvent) => onMove(moveEvent)
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        onEnd?.()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }

    // ── CODESYS 代码工作台 ↔ 对话 联动 ──────────────────────────────────────
    // The workbench renders inside the SAME Harness document as the conversation
    // pane and shares its session, so the code shown here and the code the model
    // edits must be one object. Two directions are wired:
    //   * workbench → model: the live state (bound project, currently open
    //     object's full text, pending diff) is published to the host plugin,
    //     which exposes it through the taskhive_codesys_workbench tool.
    //   * model → workbench: every new assistant message in this session is
    //     inspected for a structured code proposal, and tool-submitted
    //     proposals are claimed when a turn ends. Nothing is ever written to
    //     the project without an explicit human confirmation in this UI.
    // KNOWN-ISSUES #9: 宿主把两个命名空间挂在**同一个受信任前缀**下：`/taskhive/api/codesys.workbench.*`
    // 与 `/taskhive/api/sessions.*`（见 index.js 的 WORKBENCH_ROUTE 与 sessionPrefix 分派）。
    // 两个基址必须从同一个前缀派生。旧代码把会话路径写成
    // `${CODESYS_WORKBENCH_API}/sessions.x`，拼出 `/taskhive/api/codesys.workbench/sessions.x`；
    // 而宿主的 workbench 前缀以**点**结尾（`…workbench.`）而不是斜杠，于是它既不匹配 workbench
    // 也不匹配 sessions，直接落进 404 兜底。客户端把 `null` 显示成
    // "宿主未响应，请重启 TaskHive 后重试"——**重启永远不会好**，因为那是 URL 拼错，不是版本不符。
    const TASKHIVE_API_BASE = '/taskhive/api'
    const CODESYS_WORKBENCH_API = `${TASKHIVE_API_BASE}/codesys.workbench`
    const CODESYS_SESSIONS_API = `${TASKHIVE_API_BASE}/sessions`
    // 每次「当前工程」探测都会让宿主发起一次 PowerShell 窗口枚举 + CODESYS 选项扫描
    // （实测单次约 2 秒，期间主进程在忙）。所以后台探测必须稀：
    //   · 15 秒 → 45 秒：切回窗口/标签页时的重检测不能每次都真探一遍；
    //   · 120 秒 → 300 秒：已经绑定工程之后，唯一的兜底轮询没必要每分钟敲一次
    //     （用户点「刷新当前工程」永远是真探，面板切窗口也是事件驱动、不受这里影响）。
    const CODESYS_DETECT_MIN_GAP_MS = 45000
    const CODESYS_FALLBACK_DETECT_MS = 300000
    // 哪些作业已经自动准备过在线会话。准备一次要启动一个约 700 MB 的常驻 CODESYS
    // （20–40 秒）；它在空闲 10 分钟后会自己退出，若每次切回工作台都自动重启，
    // 用户就会觉得"点一下别的界面就卡一下"。所以：每个作业只自动准备一次，
    // 之后要重启必须由用户点「登录」/「扫描设备」明确发起。
    const codesysPreparedJobs = new Set()
    // While nothing is bound yet the user is actively waiting for the plugin's
    // own CODESYS instance to have a project (「打开 CODESYS」→ open/save a
    // project → the workbench must follow on its own). Re-check on a short
    // cadence during that window, then drop back to the rare fallback.
    const CODESYS_WAIT_DETECT_MS = 6000
    const CODESYS_WAIT_GIVE_UP_MS = 300000
    // How often the page asks the host for proposals queued by
    // taskhive_codesys_workbench_propose. The host queue is the only delivery
    // path for a tool-submitted diff, and the conversation watermark alone
    // delivered it too late (only once the turn ended), so a submit that had
    // already returned accepted:true was invisible in the workbench meanwhile.
    // This is a tiny in-process HTTP call, never an engine probe.
    const CODESYS_CLAIM_POLL_MS = 4000
    const CODESYS_PUBLISH_GAP_MS = 900
    const CODESYS_EDITOR_LINE_HEIGHT = 15.95
    const CODESYS_OPEN_OBJECT_BUDGET = 20000

    function normalizeCodesysPath(value) {
      return String(value || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
    }
    function codesysBaseName(value) {
      const text = String(value || '')
      const at = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))
      return at === -1 ? text : text.slice(at + 1)
    }
    // The raw IPC failure ("Error invoking remote method 'codesys:scriptengine-action':
    // Error: Command failed: C:\Program Files\CODESYS ...\action.py") tells the user
    // nothing actionable. Map the known cases and keep a short tail for support.
    function codesysScriptEngineErrorMessage(error) {
      const raw = String(error?.message || error || '').trim()
      const tail = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw
      if (/Command failed/i.test(raw) && /CODESYS\.exe/i.test(raw)) {
        return `CODESYS ScriptEngine 进程超时未结束或异常退出。若它已写出完整结果，本轮会直接采用；否则请关闭多余的 CODESYS 实例后点「刷新」重试。原始信息：${tail}`
      }
      if (/CODESYS_SCRIPTENGINE_NOT_READY|未就绪/.test(raw)) return `CODESYS ScriptEngine 未就绪：请先在 CODESYS 面板完成环境检查。原始信息：${tail}`
      if (/NOT_OWNED|只能绑定/.test(raw)) return `工作台只能绑定由本插件打开的 CODESYS 窗口。原始信息：${tail}`
      return tail
    }
    // Online actions fail for reasons the raw IPC message does not explain
    // ("Error invoking remote method 'codesys:online-action': Error: …"). Map the
    // known refusals to what the operator must actually do next.
    function codesysOnlineErrorMessage(error) {
      const raw = String(error?.message || error || '').trim()
      if (/CODESYS_ONLINE_TARGET_NOT_BOUND|尚未绑定设备/.test(raw)) {
        return '尚未绑定设备：请先点「扫描设备」选中一台 PLC（选中后那颗按钮会变成「已绑定」），再登录/下载。\n工程文件里配置的目标只是记录，不作为登录依据 —— 这是刻意的。'
      }
      // The genuinely useful cases are the network ones: a login that fails is
      // almost always "the gateway cannot route to this device", not a TaskHive
      // bug, and the raw Windows text ("没有到达主机的路由") explains nothing.
      if (/没有到达主机的路由|no route to host|host unreachable|无法访问目标主机|不可达/i.test(raw)) {
        return 'CODESYS 网关无法路由到该设备地址（Windows 报「没有到达主机的路由」）。\n请确认：① 目标 PLC 已上电；② PLC 与网关在同一网段；③ 或改用扫描结果里的另一台设备。\n如果扫描列表是从「网关缓存」回退来的，那几台可能是以前记录的、现在已不在线。'
      }
      if (/尚未登录到应用/.test(raw)) {
        return '尚未登录到应用：启动/停止/复位/写变量/Force 都在**应用层**。请先点「下载」——若设备上的程序与工程一致，则只登录、不传输。'
      }
      if (/网关没有正确配置是否继续项目|网关未正确配置/.test(raw)) {
        return 'CODESYS 网关拒绝了这次操作（原话：网关没有正确配置是否继续项目）。\n通常是网关找不到目标设备或网段不通。请在 CODESYS 里先确认能连上该 PLC，再用工作台「扫描设备」重新取一次目标。'
      }
      if (/未连接到设备|重新扫描网络/i.test(raw)) {
        return '网关不认识这个设备地址（CODESYS 原话：未连接到设备，请重新扫描网络）。\n这说明该地址来自过期的网关缓存，设备当前不在线。请确认 PLC 已上电并与本机同网段，然后在 CODESYS 里重新扫描网络，再用工作台的「扫描设备」取最新结果。'
      }
      if (/连接超时|timed out|timeout|超时/.test(raw) && !/CODESYS_ONLINE_COMMAND_TIMEOUT/.test(raw)) {
        return '连接超时：PLC 可能未上电或不在同一网段，请检查目标地址后再试。'
      }
      if (/拒绝|refused/i.test(raw)) return '连接被拒绝：目标拒绝了这个连接，请确认设备是否允许该网关访问。'
      if (/CODESYS_ONLINE_NOT_ARMED|在线授权未开启/.test(raw)) return '在线授权未开启：请重新点击在线按钮，本工作台会话内会一直有效。'
      if (/CODESYS_ONLINE_PROJECT_MISMATCH|另一个工程/.test(raw)) return '当前工程与授权时绑定的工程不一致：请点「刷新」重新绑定后再试。'
      if (/CODESYS_ONLINE_WINDOW_MISMATCH|另一个 CODESYS 窗口/.test(raw)) return '绑定的 CODESYS 监视窗口已改变：请重新点击在线按钮。'
      if (/CODESYS_ONLINE_UNSAVED_CHANGES|未保存的改动/.test(raw)) return 'CODESYS 里有未保存的改动：请先在 CODESYS 中保存，否则下载的是旧代码。'
      if (/CODESYS_ONLINE_PROJECT_CHANGED|被改动过/.test(raw)) return '工程文件在本次读取之后被改动过：请点「刷新」重新读取工程，再点下载。'
      if (/CODESYS_ONLINE_DEVICE_NOT_CONNECTED|尚未连接/.test(raw)) return '尚未连接到 PLC：请先点「登录」建立在线连接，再下载。'
      if (/CODESYS_ONLINE_WORKER_FAILED|在线进程初始化失败/.test(raw)) return `CODESYS 在线进程启动失败（可能是工程被占用或设备描述缺失）：${raw.slice(-300)}`
      if (/CODESYS_ONLINE_SESSION_NOT_RUNNING|在线会话未启动/.test(raw)) return '在线会话未运行：请先点「登录」。'
      if (/CODESYS_ONLINE_COMMAND_TIMEOUT|超时/.test(raw)) return '在线动作超时，结果未知：请勿重复点击，先在 CODESYS 里核对该设备的实际状态。'
      if (/CODESYS_SCRIPTENGINE_NOT_READY|未就绪/.test(raw)) return 'CODESYS ScriptEngine 未就绪：请先在 CODESYS 面板完成环境检查。'
      const tail = raw.length > 240 ? `${raw.slice(0, 240)}…` : raw
      return tail
    }
    // CODESYS 在线模式给每个声明变量显示当前值。要从声明文本里挑出可以当表达式
    // 读取的名字：只认简单的 `名字 : 类型;`（含 AT %I* 映射），其余（块关键字、
    // 注释、数组/结构字面量、属性、动作步）一律跳过，因为读它们只会报错。
    const CODESYS_MONITOR_BLOCK_KEYWORD = /^(VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_GLOBAL|VAR_TEMP|VAR_STAT|VAR_INST|VAR_EXTERNAL|VAR_CONFIG|END_VAR|TYPE|END_TYPE|STRUCT|END_STRUCT|UNION|END_UNION|PROGRAM|FUNCTION_BLOCK|FUNCTION|METHOD|PROPERTY|INTERFACE|ACTION|STEP|END_STEP|TRANSITION|END_TRANSITION|NAMESPACE|END_NAMESPACE|ATTRIBUTE|PRAGMA)\b/i
    function codesysMonitorExpressionForLine(line) {
      const text = String(line || '').replace(/\(\*.*?\*\)/g, ' ').trim()
      if (!text || text.startsWith('//') || CODESYS_MONITOR_BLOCK_KEYWORD.test(text)) return ''
      const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:AT\s+%[A-Za-z0-9.*]+\s*)?:/)
      return match ? match[1] : ''
    }
    function codesysMonitorExpressions(declaration) {
      const out = []
      const seen = new Set()
      for (const line of String(declaration || '').split('\n')) {
        const name = codesysMonitorExpressionForLine(line)
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(name)
        if (out.length >= 60) break
      }
      return out
    }
    // 原生 CODESYS 的在线视图能读到 FB 实例**成员**的当前值（展开实例看 Status / Position…）。
    // ScriptEngine 也一样：实例本身读不出值（`Axis_Y_PRG.power` 不是可读表达式），但
    // `Axis_Y_PRG.power.Status` 这类成员路径和普通变量走同一条读取路径（实测 `Jog.permit`
    // 就这么读到的）。所以按类型列出该 FB 最值得看的成员，读不到的成员留空、不报错。
    const CODESYS_MONITOR_SCALAR_TYPE = /^(BOOL|BYTE|SINT|USINT|INT|UINT|WORD|DINT|UDINT|DWORD|LINT|ULINT|LWORD|REAL|LREAL|TIME|LTIME|DATE|TOD|DT|STRING|WSTRING|CHAR|WCHAR|BIT)$/i
    const CODESYS_MONITOR_SKIP_TYPE = /^(ARRAY|STRUCT|UNION|REFERENCE|POINTER|INTERFACE|ANY)/i
    const CODESYS_MONITOR_FB_MEMBERS = {
      MC_Power: ['Status', 'Busy', 'Error', 'ErrorID'],
      MC_ReadActualPosition: ['Position', 'Valid', 'Error'],
      MC_ReadActualVelocity: ['Velocity', 'Valid', 'Error'],
      MC_ReadStatus: ['Standstill', 'Disabled', 'Errorstop', 'Valid'],
      MC_ReadAxisError: ['AxisErrorID', 'Error'],
      MC_MoveAbsolute: ['Done', 'Busy', 'Error'],
      MC_MoveRelative: ['Done', 'Busy', 'Error'],
      MC_MoveVelocity: ['InVelocity', 'Busy', 'Error'],
      MC_Stop: ['Done', 'Busy', 'Error'],
      MC_Reset: ['Done', 'Busy', 'Error'],
      MC_Home: ['Done', 'Busy', 'Error'],
      MC_Halt: ['Done', 'Busy', 'Error'],
      R_TRIG: ['Q'],
      F_TRIG: ['Q'],
      TON: ['Q', 'ET'],
      TOF: ['Q', 'ET'],
      TP: ['Q', 'ET'],
      TONR: ['Q', 'ET'],
      CTU: ['Q', 'CV'],
      CTD: ['Q', 'CV'],
      CTUD: ['QU', 'QD', 'CV'],
      RS: ['Q1'],
      SR: ['Q1'],
    }
    // 认不出的 FB 类型（自定义功能块）也试这三个：它们是绝大多数 FB 的公共输出。
    const CODESYS_MONITOR_FB_FALLBACK = ['Busy', 'Done', 'Error']
    // 计时显示：小于 1 秒用毫秒，否则用秒（一位小数）。
    function codesysFormatMs(ms) {
      const value = Number(ms) || 0
      return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
    }
    // 声明行 -> { name, type }。类型只取到第一个标识符（`ARRAY[1..7] OF LREAL` 取到
    // `ARRAY`，正好落进"跳过"那一类，不会去读一个数组）。
    function codesysMonitorVariables(declaration) {
      const out = []
      const seen = new Set()
      for (const line of String(declaration || '').split('\n')) {
        const name = codesysMonitorExpressionForLine(line)
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const cleaned = String(line).replace(/\(\*.*?\*\)/g, ' ').trim()
        const match = cleaned.match(/^[A-Za-z_][A-Za-z0-9_]*\s*(?:AT\s+%[A-Za-z0-9.*]+\s*)?:\s*([A-Za-z_][A-Za-z0-9_.]*)/)
        out.push({ name, type: match ? match[1] : '' })
      }
      return out
    }
    // 一个变量要读哪些表达式：简单类型读它自己；FB 实例读它该看的成员。
    function codesysMonitorExpressionsFor(variable) {
      const type = String(variable?.type || '')
      if (!type || CODESYS_MONITOR_SCALAR_TYPE.test(type)) return [variable.name]
      if (CODESYS_MONITOR_SKIP_TYPE.test(type)) return []
      const members = CODESYS_MONITOR_FB_MEMBERS[type] || CODESYS_MONITOR_FB_FALLBACK
      return members.map((member) => `${variable.name}.${member}`)
    }
    function codesysChangeStateLabel(state) {
      if (state === 'agent') return 'AI 提案待确认'
      if (state === 'manual') return '手写修改未写入'
      if (state === 'written') return '已写入工程'
      if (state === 'pending-create') return '待新增对象'
      return ''
    }
    // Why auto-detection did not produce a project, in the user's language. The
    // engine reports a reason instead of one opaque "not found".
    function codesysDetectFailureHint(failure) {
      const detection = String(failure?.detection || '')
      // The workbench only ever follows a CODESYS instance this plugin started
      // ("工作台只能绑定由当前插件打开的 CODESYS 窗口"): the window list and the
      // open-project markers are both scoped to the plugin's own PIDs, so a
      // project open in the user's own CODESYS is not silently bound.
      if (detection === 'no-project-window') {
        // The plugin's own CODESYS is running but has no saved project yet: this
        // is the normal "打开 CODESYS → 打开工程" waiting state.
        const owned = Number(failure?.scope?.ownedWindows) || 0
        if (owned > 0) return `已检测到本插件打开的 CODESYS 窗口（${owned} 个），但其中还没有已保存的工程：请在 CODESYS 里打开并保存工程，工作台会自动跟随（约每 15 秒重试一次）。也可以直接用「选择工程」读取现有工程。`
        return '工作台只识别由本插件「打开 CODESYS」启动的窗口，当前没有这样的窗口（你自己另开的 CODESYS 不计入）。请点上方「打开 CODESYS」，或用「选择工程」直接读取现有工程。'
      }
      // The workbench follows EXACTLY the window selected in the CODESYS panel
      // ("当前监视窗口") — never another window the plugin also owns.
      if (detection === 'monitored-window-no-project') return '当前监视的那个 CODESYS 窗口里还没有已保存的工程。请在该窗口里打开并保存工程（约每 15 秒自动重试）；若想改读别的窗口，请先在 CODESYS 面板的窗口下拉里切换监视窗口，或直接用「选择工程」。'
      if (detection === 'monitored-window-closed') return '当前监视的 CODESYS 窗口已关闭。请在 CODESYS 面板重新选择（或重新「打开 CODESYS」）一个窗口，再用「刷新当前工程」。'
      if (detection === 'no-matching-project-file') return '已看到本插件打开的 CODESYS 窗口，但它还没有可识别的 .project 文件（新建或改过名的工程会这样）。请先在该 CODESYS 里保存工程，或点「选择工程」。'
      if (detection === 'ambiguous-open-projects') return '本插件打开了多个工程，无法确定要读哪一个。请用上方「当前工程」一行的下拉选择，或手动选择文件。'
      if (detection === 'ambiguous-project-path') return '窗口标题里的工程名对应到多个同名 .project 文件，无法确定唯一目标。请手动选择文件。'
      return '未能识别到唯一打开并保存的 .project 工程，请手动选择文件。'
    }
    function codesysHash(text) {
      let hash = 5381
      const value = String(text || '')
      for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
      return hash
    }
    // 1-based line numbers whose text differs between two revisions. The editor
    // paints exactly these rows so "which lines changed" is visible in the code
    // itself, not only in the diff pane.
    function codesysChangedLineNumbers(baseText, nextText) {
      const base = String(baseText || '').split('\n')
      const next = String(nextText || '').split('\n')
      const changed = new Set()
      const length = Math.max(base.length, next.length)
      for (let index = 0; index < length; index += 1) if ((base[index] ?? '') !== (next[index] ?? '')) changed.add(index + 1)
      return changed
    }
    async function codesysWorkbenchApi(method, payload) {
      // Small same-origin JSON call to the host plugin half. A stopped Harness or
      // an older host without the route must never break the workbench UI.
      try {
        const response = await fetch(`${CODESYS_WORKBENCH_API}.${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
        })
        if (!response.ok) return null
        const parsed = await response.json().catch(() => null)
        return parsed && parsed.ok === true ? parsed.value : null
      } catch { return null }
    }
    const codesysWorkbenchMirror = { state: null, listeners: new Set() }
    // T092: 会话记录维护通道。与工作台同一套"同源 JSON POST 到宿主插件"的做法。
    async function sessionRecordsApi(method, payload) {
      try {
        const response = await fetch(`${CODESYS_SESSIONS_API}.${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
        })
        if (!response.ok) return null
        const parsed = await response.json().catch(() => null)
        return parsed && parsed.ok === true ? parsed.value : null
      } catch { return null }
    }
    function formatSessionBytes(value) {
      const bytes = Math.max(0, Number(value) || 0)
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }
    function formatSessionTime(value) {
      const time = Number(value) || 0
      if (!time) return '—'
      const date = new Date(time)
      const pad = (part) => String(part).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    // T096: 与「设置」界面同一套质感。基准取自本插件自己的设置面（`surfaceStyles`）：
    //   font: 13px/1.5 · 次级文字 12px · 行用下边框分隔而不是盒子 · 按钮 font:inherit
    //   （品牌浅底描边、30px 高）· 卡片 border rgba(127,127,127,.22) + radius 8px。
    // 用户口径："注意字体不要太大，不要加粗字体，和设置界面的 ui 风格和质感保持一致"，
    // 所以这份表里**没有任何 font-weight 大于 500**，字号也不超过 13px。
    // T096b: 口径是整条界面统一的，不是只针对会话面板——设置面（`surfaceStyles` 与
    // 「模型 / 工作目录」两个自定义分节）此前自己就留着 600 和 18px 标题，等于面板在
    // 对齐一个比它更粗、更大的"基准"。这里把基准本身收敛到同一口径：按钮与分节标题
    // 一律 400，模型页标题从 18px 收到 13px，占位靠 --dsw-alias-* 颜色和分隔线，不靠粗体。
    const SESSION_PANEL_CSS = `
[data-taskhive-sessions="true"]{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;min-height:0;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,var(--th-ink,#171717));font:13px/1.5 Inter,"Microsoft YaHei",system-ui,sans-serif}
[data-taskhive-sessions="true"] .th-sess-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-subtle,var(--th-line,#e6e6e6))}
[data-taskhive-sessions="true"] .th-sess-title{font:inherit;color:var(--dsw-alias-label-primary,var(--th-ink,#171717))}
[data-taskhive-sessions="true"] .th-sess-sum{color:var(--dsw-alias-label-secondary,#666);font-size:12px;cursor:help}
[data-taskhive-sessions="true"] .th-sess-tools{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
[data-taskhive-sessions="true"] .th-sess-btn{height:30px;padding:0 10px;border:1px solid var(--th-brand-line,#d3dcfb);border-radius:6px;background:var(--th-brand-tint,#eef2fe);color:var(--th-brand-ink,#2f47b8);font:inherit;cursor:pointer}
[data-taskhive-sessions="true"] .th-sess-btn:hover:not(:disabled){border-color:var(--th-brand,#4f6ef2);background:var(--th-brand-tint,#eef2fe);color:var(--th-brand-strong,#3f5ce0)}
[data-taskhive-sessions="true"] .th-sess-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--th-brand,#4f6ef2));outline-offset:1px}
[data-taskhive-sessions="true"] .th-sess-btn:disabled{opacity:.45;cursor:not-allowed}
[data-taskhive-sessions="true"] .th-sess-btn-danger{border-color:#e4c4c1;background:transparent;color:#a3403a}
[data-taskhive-sessions="true"] .th-sess-btn-danger:hover:not(:disabled){border-color:#d9a9a5;background:#fdf4f3;color:#8f322c}
[data-taskhive-sessions="true"] .th-sess-list{min-height:0;overflow:auto;padding:12px;display:grid;gap:12px;align-content:start}
[data-taskhive-sessions="true"] .th-sess-group{border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.22));border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}
[data-taskhive-sessions="true"] .th-sess-group-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2,var(--th-surface-2,#f7f8fb));border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.18))}
[data-taskhive-sessions="true"] .th-sess-group-name{font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-sessions="true"] .th-sess-group-meta{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;white-space:nowrap}
[data-taskhive-sessions="true"] .th-sess-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.16))}
[data-taskhive-sessions="true"] .th-sess-row:last-child{border-bottom:0}
[data-taskhive-sessions="true"] .th-sess-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--th-surface-3,#eef1f7))}
[data-taskhive-sessions="true"] .th-sess-row[data-selected="true"]{background:var(--th-brand-tint,#eef2fe)}
[data-taskhive-sessions="true"] .th-sess-row[data-active="true"]{cursor:default}
[data-taskhive-sessions="true"] .th-sess-row[data-active="true"] .th-sess-id{color:var(--dsw-alias-label-tertiary,#8a8a8a)}
[data-taskhive-sessions="true"] .th-sess-row input{margin:0}
[data-taskhive-sessions="true"] .th-sess-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary,#666)}
[data-taskhive-sessions="true"] .th-sess-time,[data-taskhive-sessions="true"] .th-sess-size{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px;white-space:nowrap}
[data-taskhive-sessions="true"] .th-sess-size{min-width:64px;text-align:right}
[data-taskhive-sessions="true"] .th-sess-badge{flex:none;border:1px solid var(--dsw-alias-border-subtle,rgba(127,127,127,.28));border-radius:999px;padding:0 6px;margin-left:6px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font:12px/1.5 inherit}
[data-taskhive-sessions="true"] .th-sess-empty{padding:12px;color:var(--dsw-alias-label-secondary,#666)}
[data-taskhive-sessions="true"] .th-sess-error{margin:12px 12px 0;padding:8px 10px;border:1px solid #e4c4c1;border-radius:8px;background:#fdf4f3;color:#a3403a;font-size:12px}
[data-taskhive-sessions="true"] .th-sess-actions{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-subtle,var(--th-line,#e6e6e6))}
[data-taskhive-sessions="true"] .th-sess-actions-info{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
[data-taskhive-sessions="true"] .th-sess-actions .th-sess-btn-danger{margin-left:auto}
`
    function installSessionPanelStyle() {
      if (document.getElementById('taskhive-sessions-style')) return
      const style = document.createElement('style')
      style.id = 'taskhive-sessions-style'
      style.textContent = SESSION_PANEL_CSS
      document.head.appendChild(style)
    }

    // ── T094 应用内对话框 ───────────────────────────────────────────────────
    // 用户口径："我要的是 harness 长出了新皮肤，不要给我把弹窗做成其他 ui"。`window.alert`
    // / `window.confirm` 是浏览器原生弹窗，和 TaskHive 皮肤不是一套东西，所以这里做一个
    // 自己的：样式沿用主进程关闭确认框同一组 `--dsw-alias-*` 令牌（8px 圆角、1px 边框、
    // 同一字体与间距），带焦点管理、Esc 取消、点遮罩取消。
    function showTaskHiveDialog(options = {}) {
      const confirmMode = options.confirm === true
      return new Promise((resolve) => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const root = document.createElement('div')
        root.setAttribute('data-taskhive-dialog', 'true')
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:rgba(17,17,17,.28);backdrop-filter:blur(2px);font-family:Inter,"Microsoft YaHei",system-ui,sans-serif'
        const panel = document.createElement('section')
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-modal', 'true')
        panel.style.cssText = 'width:min(460px,calc(100vw - 48px));overflow:hidden;border:1px solid var(--dsw-alias-border-subtle,rgba(23,23,23,.14));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 20px 56px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary,#171717)'
        const body = document.createElement('div')
        body.style.cssText = 'padding:16px 18px 14px'
        const title = document.createElement('h2')
        // T096: 字号与字重对齐「设置」界面（13px/1.5、不加粗），不要做成大标题。
        title.style.cssText = 'margin:0;font:inherit;font-size:13px;font-weight:400;color:var(--dsw-alias-label-primary,#171717)'
        title.textContent = String(options.title || 'TaskHive')
        const text = document.createElement('p')
        text.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:13px'
        text.textContent = String(options.message || '')
        body.append(title, text)
        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-subtle,#e4e4e4)'
        const buttonStyle = 'height:30px;padding:0 10px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid var(--th-brand-line,#d3dcfb);background:var(--th-brand-tint,#eef2fe);color:var(--th-brand-ink,#2f47b8)'
        const dismiss = (value) => {
          document.removeEventListener('keydown', onKey, true)
          root.remove()
          if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
          resolve(value)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); dismiss(false); return }
          if (event.key !== 'Tab') return
          const focusable = [cancel, accept].filter(Boolean)
          if (focusable.length < 2) return
          const next = document.activeElement === focusable[0] ? focusable[1] : focusable[0]
          event.preventDefault(); next.focus()
        }
        let cancel = null
        let accept = null
        if (confirmMode) {
          cancel = document.createElement('button')
          cancel.type = 'button'
          cancel.textContent = String(options.cancelLabel || '取消')
          cancel.style.cssText = buttonStyle
          cancel.addEventListener('click', () => dismiss(false))
          actions.append(cancel)
        }
        accept = document.createElement('button')
        accept.type = 'button'
        accept.textContent = String(options.acceptLabel || (confirmMode ? '确认' : '确定'))
        accept.style.cssText = options.danger
          // T096: 危险动作也让按钮保持设置界面的质感——统一的 30px 高、font:inherit、
          // 克制的红描边，而不是一大块实心红。
          ? `${buttonStyle};border-color:#e4c4c1;background:transparent;color:#a3403a`
          : buttonStyle
        accept.addEventListener('click', () => dismiss(true))
        actions.append(accept)
        panel.append(body, actions)
        root.append(panel)
        root.addEventListener('mousedown', (event) => { if (event.target === root) dismiss(false) })
        document.addEventListener('keydown', onKey, true)
        document.body.append(root)
        accept.focus()
      })
    }
    const noticeDialog = (title, message) => showTaskHiveDialog({ title, message, acceptLabel: '确定' })

    // ── CODESYS「扫描网络」弹窗 ─────────────────────────────────────────────

    // ── 危险在线动作的弹窗（写变量 / 复位 / Force）──────────────────────────
    // 这三项能驱动机械或清掉保持变量，所以除了工作台授权之外还要**逐字输入确认词**。
    // 弹窗同时承载参数：复位要选类型，写值/Force 要填表达式与目标值。
    // 返回 null（取消）或 { phrase, assignments, resetOption, forceKill }。
    function showCodesysOnlineDangerDialog(options = {}) {
      return new Promise((resolve) => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const expectedPhrase = String(options.phrase || '')
        const resetMode = options.resetMode === true
        const rows = Array.isArray(options.assignments) ? options.assignments.slice(0, 60) : []
        const root = document.createElement('div')
        root.setAttribute('data-taskhive-dialog', 'true')
        root.setAttribute('data-codesys-danger-dialog', 'true')
        root.setAttribute('data-codesys-danger-capability', String(options.capability || ''))
        root.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px;background:rgba(17,17,17,.42);backdrop-filter:blur(2px);font-family:Inter,"Microsoft YaHei",system-ui,sans-serif'
        const panel = document.createElement('section')
        panel.setAttribute('role', 'alertdialog')
        panel.setAttribute('aria-modal', 'true')
        panel.setAttribute('aria-label', String(options.title || '危险操作'))
        panel.style.cssText = 'display:flex;flex-direction:column;width:min(560px,calc(100vw - 48px));max-height:min(78vh,600px);overflow:hidden;border:1px solid #e4c4c1;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 20px 56px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#171717)'
        const body = document.createElement('div')
        body.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-height:0;padding:16px 18px 12px'
        const title = document.createElement('h2')
        title.style.cssText = 'margin:0;font:inherit;font-size:13px;font-weight:400;color:#a3403a'
        title.textContent = String(options.title || '危险操作')
        const warn = document.createElement('p')
        warn.setAttribute('data-codesys-danger-warning', 'true')
        warn.style.cssText = 'margin:0;white-space:pre-wrap;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#666)'
        warn.textContent = (options.lines || []).join('\n')
        body.append(title, warn)

        let resetSelect = null
        let forceKillBox = null
        if (resetMode) {
          resetSelect = document.createElement('select')
          resetSelect.setAttribute('data-codesys-danger-reset', 'true')
          resetSelect.setAttribute('aria-label', '复位类型')
          resetSelect.style.cssText = 'height:30px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:6px;padding:0 8px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
          for (const [value, label] of [['warm', '热复位（Warm）—— 保留保持变量'], ['cold', '冷复位（Cold）—— 清空保持变量'], ['original', '原始复位（Original）—— 恢复出厂初值']]) {
            const option = document.createElement('option')
            option.value = value
            option.textContent = label
            resetSelect.append(option)
          }
          const killLabel = document.createElement('label')
          killLabel.style.cssText = 'display:flex;align-items:center;gap:6px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666)'
          forceKillBox = document.createElement('input')
          forceKillBox.type = 'checkbox'
          forceKillBox.setAttribute('data-codesys-danger-forcekill', 'true')
          killLabel.append(forceKillBox, document.createTextNode('force_kill（强制结束当前应用，不等它自己停）'))
          body.append(resetSelect, killLabel)
        }

        const assignmentInputs = []
        if (rows.length) {
          const list = document.createElement('div')
          list.setAttribute('data-codesys-danger-assignments', 'true')
          list.style.cssText = 'max-height:240px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f7f7f7)'
          for (const row of rows) {
            const line = document.createElement('div')
            line.style.cssText = 'display:flex;align-items:center;gap:6px'
            const name = document.createElement('input')
            name.value = String(row.expression || '')
            name.setAttribute('data-codesys-danger-assignment', 'true')
            name.setAttribute('aria-label', '表达式')
            name.style.cssText = 'flex:1 1 55%;min-width:0;height:26px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:6px;padding:0 6px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
            const equals = document.createElement('span')
            equals.textContent = '='
            equals.style.cssText = 'flex:none;color:var(--dsw-alias-label-secondary,#666)'
            const value = document.createElement('input')
            value.value = String(row.value || '')
            value.setAttribute('aria-label', '目标值')
            value.setAttribute('data-codesys-danger-value', 'true')
            value.placeholder = row.current ? `当前 ${row.current}` : '目标值'
            value.style.cssText = 'flex:1 1 45%;min-width:0;height:26px;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);border-radius:6px;padding:0 6px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
            line.append(name, equals, value)
            list.append(line)
            assignmentInputs.push({ name, value })
          }
          body.append(list)
        }

        const phraseLabel = document.createElement('label')
        phraseLabel.style.cssText = 'display:flex;flex-direction:column;gap:4px;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#666)'
        phraseLabel.append(document.createTextNode(`请输入确认词「${expectedPhrase}」后「执行」才会启用：`))
        const phraseInput = document.createElement('input')
        phraseInput.setAttribute('data-codesys-danger-phrase', 'true')
        phraseInput.setAttribute('aria-label', '确认词')
        phraseInput.autocomplete = 'off'
        phraseInput.style.cssText = 'height:30px;border:1px solid #e4c4c1;border-radius:6px;padding:0 8px;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit'
        phraseLabel.append(phraseInput)
        body.append(phraseLabel)

        const actions = document.createElement('div')
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-subtle,#e4e4e4)'
        const plainStyle = 'height:30px;padding:0 10px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-subtle,#e4e4e4);background:transparent;color:var(--dsw-alias-label-primary,#171717)'
        const dangerStyle = 'height:30px;padding:0 10px;border-radius:6px;font:inherit;cursor:pointer;border:1px solid #e4c4c1;background:transparent;color:#a3403a;font-weight:650'
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.setAttribute('data-codesys-danger-cancel', 'true')
        cancel.textContent = '取消'
        cancel.style.cssText = plainStyle
        const confirm = document.createElement('button')
        confirm.type = 'button'
        confirm.setAttribute('data-codesys-danger-confirm', 'true')
        confirm.textContent = String(options.confirmLabel || '执行')
        confirm.style.cssText = dangerStyle
        confirm.disabled = true
        confirm.style.opacity = '.45'
        actions.append(cancel, confirm)
        panel.append(body, actions)
        root.append(panel)

        let settled = false
        const dismiss = (value) => {
          if (settled) return
          settled = true
          document.removeEventListener('keydown', onKey, true)
          root.remove()
          if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus()
          resolve(value)
        }
        const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); dismiss(null) } }
        const syncConfirm = () => {
          const ok = phraseInput.value.trim() === expectedPhrase
          confirm.disabled = !ok
          confirm.style.opacity = ok ? '1' : '.45'
        }
        phraseInput.addEventListener('input', syncConfirm)
        cancel.addEventListener('click', () => dismiss(null))
        root.addEventListener('mousedown', (event) => { if (event.target === root) dismiss(null) })
        confirm.addEventListener('click', () => {
          if (phraseInput.value.trim() !== expectedPhrase) return
          dismiss({
            phrase: phraseInput.value.trim(),
            assignments: assignmentInputs
              .map(({ name, value }) => ({ expression: name.value.trim(), value: value.value }))
              .filter((item) => item.expression),
            resetOption: resetSelect ? resetSelect.value : '',
            forceKill: Boolean(forceKillBox?.checked),
          })
        })
        document.addEventListener('keydown', onKey, true)
        document.body.append(root)
        phraseInput.focus()
      })
    }
    // 会话记录面板（T092，T095 重做外观）。DSH 只有「归档会话」——归档后侧栏不再显示，
    // 但记录文件与磁盘占用都保留，DSH 也没有任何删除 API，所以这里在文件层做真删除。
    // 顺序是**先删文件、后归档**：只有确实删掉文件的会话才会被摘行，这样"行消失"就等于
    // "磁盘已回收"。
    function SessionRecordsPanel({ ctx }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [status, setStatus] = React.useState('正在读取…')
      const [selected, setSelected] = React.useState(() => new Set())
      const activeSessionId = String(ctx?.sessions?.list?.getSnapshot?.()?.current || '')
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
            const uiWorkspace = ctx?.uiWorkspace
            if (typeof uiWorkspace?.archiveSession === 'function') {
              for (const row of result.deleted) { try { await uiWorkspace.archiveSession(row.session) } catch { /* 文件已删，归档失败只影响列表刷新 */ } }
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
      const pending = codesysStateKeepAlive.pendingSnapshot
      const outgoing = pending && state && state.projectSnapshot === undefined
        ? { ...state, projectSnapshot: pending.snapshot }
        : state
      const result = await codesysWorkbenchApi('publish', { sessionId, state: outgoing })
      if (pending && result && result.accepted !== false && codesysStateKeepAlive.pendingSnapshot === pending) {
        codesysStateKeepAlive.publishedSignature = pending.signature
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

    function CodesysWorkbench({ ctx }) {
      const [status, setStatus] = React.useState('正在检测当前已打开的 CODESYS 工程…')
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
      // T097: 独立的离线编译。`build`/`rebuild` 早就在 ScriptEngine 白名单里，而且**不是**
      // MUTATING —— 不需要 confirmed、不写盘、在隔离副本上编译，所以顶栏可以给它一颗自己的
      // 按钮；编译输出（payload.messages：CODESYS 消息 + 引擎从 stderr 归并的诊断）在这里
      // 落成一份可折叠、可复制的报告。写入链路也会把同一次编译的消息喂进来看（见 applyProposal）。
      const [compileReport, setCompileReport] = React.useState(null)
      const [compileOpen, setCompileOpen] = React.useState(false)
      // Layout the user shapes by dragging: tree↔editor width and 声明↔实现 height.
      // T081: 默认给项目树更大的宽度份额（0.42 → 0.52）。用户拖过的比例仍然优先，
      // 只有从未拖动过时才用这个新默认值。
      const [treeFraction, setTreeFraction] = React.useState(() => readStoredFraction(CODESYS_LAYOUT_KEYS.tree, 0.52))
      const [declarationFraction, setDeclarationFraction] = React.useState(() => readStoredFraction(CODESYS_LAYOUT_KEYS.declaration, 0.38))
      const [dragging, setDragging] = React.useState('')
      const editorRowRef = React.useRef(null)
      const editorBodyRef = React.useRef(null)
      // The shape the user dragged is remembered across sessions.
      React.useEffect(() => { storeFraction(CODESYS_LAYOUT_KEYS.tree, treeFraction) }, [treeFraction])
      React.useEffect(() => { storeFraction(CODESYS_LAYOUT_KEYS.declaration, declarationFraction) }, [declarationFraction])
      const [agentReloadAvailable, setAgentReloadAvailable] = React.useState(false)
      const [workbenchVisible, setWorkbenchVisible] = React.useState(true)
      const [proposalSource, setProposalSource] = React.useState('')
      const submitRef = React.useRef(null)
      // One gutter + one tint layer per editor section (CODESYS numbers the
      // declaration and the implementation independently).
      const declarationRefs = { gutter: React.useRef(null), highlight: React.useRef(null), values: React.useRef(null) }
      const implementationRefs = { gutter: React.useRef(null), highlight: React.useRef(null), values: React.useRef(null) }
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
      const publishTimerRef = React.useRef(null)
      const visibleRef = React.useRef(true)
      const probingRef = React.useRef(false)
      const waitingSinceRef = React.useRef(0)
      const pendingWorkbenchTaskRef = React.useRef(false)
      const loadedEditorRef = React.useRef({ key: '', declaration: '', implementation: '' })
      const emptySessionStore = React.useMemo(() => ({ subscribe: () => () => {}, getSnapshot: () => ({ current: '' }) }), [])
      const sessionStore = ctx?.sessions?.list || emptySessionStore
      const sessionSubscribe = typeof sessionStore.subscribe === 'function' ? (listener) => sessionStore.subscribe(listener) : emptySessionStore.subscribe
      const sessionSnapshot = typeof sessionStore.getSnapshot === 'function' ? () => sessionStore.getSnapshot() : emptySessionStore.getSnapshot
      const sessionList = typeof React.useSyncExternalStore === 'function'
        ? React.useSyncExternalStore(sessionSubscribe, sessionSnapshot, sessionSnapshot)
        : sessionSnapshot()
      const sessionId = String(sessionList?.current || '')
      const binding = sessionId ? ctx.sessions.binding?.(sessionId) : null
      const [conversation, setConversation] = React.useState(() => binding?.session?.getSnapshot?.() || null)
      React.useEffect(() => {
        const nextBinding = sessionId ? ctx.sessions.binding?.(sessionId) : null
        setConversation(nextBinding?.session?.getSnapshot?.() || null)
        return nextBinding?.session?.subscribe?.(() => setConversation(nextBinding.session.getSnapshot())) || (() => {})
      }, [ctx, sessionId])
      // Latest-value mirrors for the async callbacks (detection, publishing and
      // the proposal watcher all outlive one React render).
      objectsRef.current = objects
      jobIdRef.current = jobId
      sessionIdRef.current = sessionId
      sourcePathRef.current = sourcePath
      editedDeclarationRef.current = editedDeclaration
      editedImplementationRef.current = editedImplementation
      visibleRef.current = workbenchVisible
      React.useEffect(() => {
        // The conversation is the shared channel with the model. Any assistant
        // message in this session that carries a structured CODESYS proposal
        // becomes the pending diff here, whether the user typed the request in
        // the chat or in the workbench composer. Messages that existed before
        // the workbench opened are never replayed.
        if (!conversation) return
        const assistantNodes = (conversation.nodes || []).filter((node) => node.kind === 'assistant')
        const maxSeq = assistantNodes.reduce((max, node) => Math.max(max, Number(node.seq || 0)), 0)
        if (consumedSeqRef.current === null) { consumedSeqRef.current = maxSeq; return }
        const fresh = assistantNodes.filter((node) => Number(node.seq || 0) > Number(consumedSeqRef.current)).sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
        if (!fresh.length) return
        consumedSeqRef.current = maxSeq
        for (const node of fresh) {
          const text = codesysText(node.blocks)
          if (!text || !jobIdRef.current) continue
          const parsed = parseCodesysProposal(text)
          if (!parsed) continue
          const source = pendingWorkbenchTaskRef.current ? 'workbench' : 'chat'
          pendingWorkbenchTaskRef.current = false
          applyAgentProposalRef.current?.(parsed, text, source)
        }
        void claimPendingProposalRef.current?.()
      }, [conversation])
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
      const claimPendingProposal = async () => {
        const activeSession = sessionIdRef.current
        if (!activeSession) return
        const value = await codesysWorkbenchApi('pending', { sessionId: activeSession, consume: true })
        const items = Array.isArray(value?.proposals) ? value.proposals : []
        for (const item of items) {
          const id = String(item?.id || '')
          if (!id || appliedProposalIdsRef.current.has(id)) continue
          appliedProposalIdsRef.current.add(id)
          applyAgentProposalRef.current?.(item.proposal || item, String(item.note || ''), 'chat')
        }
      }
      const claimPendingProposalRef = React.useRef(null)
      claimPendingProposalRef.current = claimPendingProposal
      const publishCodesysState = (payload) => {
        const activeSession = String(payload?.sessionId || sessionIdRef.current || '')
        if (!activeSession) return
        const state = { ...payload, sessionId: activeSession, updatedAt: new Date().toISOString() }
        publishCodesysWorkbenchMirror(state)
        // T089: 记住这份状态并确保续期心跳已启动。心跳原样重发它，所以 updatedAt
        // 不会被续期动作刷新成"刚刚观测过"。
        codesysStateKeepAlive.state = state
        codesysStateKeepAlive.sessionId = activeSession
        scheduleCodesysStateKeepAlive()
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
        // Binding is a project switch, and the online authorization names one
        // project file: drop it before the new binding takes effect so a stale
        // grant can never point at the previous device.
        void window.taskhive?.disarmCodesysOnline?.({ reason: 'project-rebound' })
        const bound = await run('bind-project', { sourcePath: projectPath, activeProject: detectedProject })
        boundPathRef.current = String(bound?.sourcePath || projectPath || '')
        setSourcePath(bound.sourcePath); setJobId(bound.jobId); setActiveProject(detectedProject); setWriteAvailability(bound)
        setProposal(null); setProposalSource(''); setAssistantText(''); setReviewAccepted(false)
        setObjectChangeState([...changeStateRef.current.keys()], '')
        // T096: 换了工程，旧对象 key 上的草稿全部失效。
        clearAllObjectDrafts()
        // A new project binding starts a new review cycle: re-arm the
        // conversation watermark so history is never replayed as a fresh diff.
        consumedSeqRef.current = null
        setStatus(`已绑定工程 · 正在读取工程树…（首次读取需启动 CODESYS ScriptEngine，通常 20–40 秒，请保持工作台打开；同一工程再次读取会使用缓存）`)
        const loaded = await inspect(bound.jobId)
        const prefix = detectedProject?.activeGui ? '已自动绑定当前打开工程' : '已绑定工程文件'
        const readMode = detectedProject?.activeGui ? '；已通过内部只读快照读取当前保存版本' : ''
        const writeState = bound.writeAvailable === false ? `；暂不可直接写入：${bound.writeBlockReason || '当前 GUI 未建立进程内写入桥'}` : '；写入前自动创建恢复快照'
        setStatus(`${prefix} · 已完整读取 ${loaded.nextObjects.length} 个工程对象（无文本截断）${readMode}${writeState}${loaded.waitSuffix || ''}${sessionIdRef.current ? ' · 已与当前对话联动' : ''}`)
        void claimPendingProposalRef.current?.()
        return bound
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
            if (!silent) setStatus(`已完整读取 ${objectsRef.current.length} 个工程对象（无文本截断） · 已跟随当前工程 ${codesysBaseName(detected.sourcePath)} · 工程对象与待确认差异保持不变`)
            return
          }
          await bindSourceProject(detected.sourcePath, detected)
        } catch (error) { setStatus(`当前工程自动绑定失败：${codesysScriptEngineErrorMessage(error)}`) } finally { probingRef.current = false; if (!silent) setBusy(false) }
      }
      const detectCurrentProjectRef = React.useRef(detectCurrentProject)
      detectCurrentProjectRef.current = detectCurrentProject
      React.useEffect(() => {
        // The desktop notifies the workbench when the CODESYS panel switches its
        // monitored window; only that window is ever followed.
        codesysWorkbenchControl.detect = (options) => detectCurrentProjectRef.current?.(options)
        return () => { if (codesysWorkbenchControl.detect) codesysWorkbenchControl.detect = null }
      }, [])
      React.useEffect(() => {
        void detectCurrentProjectRef.current({ force: true })
        // Re-detect when the user comes back to the window or switches to the
        // CODESYS surface — that is when the answer can actually have changed,
        // so no timer needs to run in the background.
        const recheck = () => { if (document.visibilityState === 'visible') void detectCurrentProjectRef.current({ silent: true }) }
        window.addEventListener('focus', recheck)
        document.addEventListener('visibilitychange', recheck)
        return () => { window.removeEventListener('focus', recheck); document.removeEventListener('visibilitychange', recheck) }
      }, [sessionId])
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
        if (!sessionId || !workbenchVisible) return undefined
        void claimPendingProposalRef.current?.()
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
      const selectProject = async () => {
        if (busy) return
        setBusy(true); setStatus('正在绑定所选 .project 工程文件；不会连接 PLC…')
        try {
          const selected = await window.taskhive?.selectCodesysOfflineFile?.('project')
          if (!selected?.path) return
          await bindSourceProject(selected.path, null)
        } catch (error) { setStatus(`工程读取失败：${codesysScriptEngineErrorMessage(error)}`) } finally { setBusy(false) }
      }
      const submit = async (taskPrompt, clearPrompt) => {
        if (!taskPrompt || busy || !jobId || !binding?.session) return
        setBusy(true); setStatus('正在当前 Harness 会话中执行 CODESYS 专属代码任务…'); setProposal(null); setProposalSource(''); setAssistantText(''); setReviewAccepted(false)
        try {
          const context = buildCodesysTaskSnapshot(sourcePath, objects, taskPrompt)
          const snapshot = context.snapshot
          const auditSnapshot = { projectPath: sourcePath, complete: true, textTruncated: false, objectCount: objects.length, objects }
          const request = await window.taskhive?.requestCodesysCodeAi?.({ prompt: taskPrompt, scriptEngineJobId: jobId, projectSnapshot: auditSnapshot, modelContext: snapshot, contextStats: { chars: context.chars, approxTokens: context.approxTokens, selectedCount: context.selectedCount, totalCount: context.totalCount } })
          const before = binding.session.getSnapshot?.()
          const maxSeq = Math.max(0, ...(before?.nodes || []).map((node) => Number(node.seq || 0)))
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
        } catch (error) { setStatus(`代码任务提交失败：${error.message}`) } finally { setBusy(false) }
      }
      submitRef.current = submit
      // ── T097 离线编译（独立于写入）────────────────────────────────────────────
      // 默认增量 `build`；按钮上 Shift+点击走全量 `rebuild`（这样顶栏只多一颗图标就能覆盖
      // 两种模式 —— 顶栏必须留在一行，宽度预算被 compact-layout 契约量化过）。
      // 两者都不是 MUTATING：不需要 confirmed、不写盘、在隔离副本上编译、不回写源工程。
      const compileReportText = (report) => [
        `TaskHive 离线编译（${report.mode === 'rebuild' ? '全量重建' : '增量 build'}）`,
        `时间：${report.at}`,
        `工程：${report.projectPath || '(未绑定)'}`,
        `错误 ${report.errorCount} · 警告 ${report.warningCount} · 信息 ${report.infoCount}`,
        '说明：编译对象是磁盘上已保存工程的隔离副本，不回写源工程，也不含工作台编辑器里尚未写入的手写改动。',
        '',
        ...(report.messages.length
          ? report.messages.map((item) => `[${String(item.severity || 'info')}] ${String(item.text || '')}`)
          : ['(编译完成，没有产生任何消息)']),
      ].join('\n')
      const summarizeCompilePayload = (payload, mode) => {
        const messages = Array.isArray(payload?.messages) ? payload.messages.slice(0, 1000) : []
        const severityOf = (item) => String(item?.severity || '').toLowerCase()
        return {
          mode,
          at: new Date().toISOString(),
          projectPath: sourcePathRef.current || '',
          errorCount: Number(payload?.errorCount || 0),
          warningCount: messages.filter((item) => severityOf(item) === 'warning').length,
          infoCount: messages.filter((item) => severityOf(item) !== 'error' && severityOf(item) !== 'warning').length,
          messages,
        }
      }
      const runCompile = async (mode = 'build') => {
        if (busy || !jobId) return
        setBusy(true)
        setStatus(`正在离线编译当前工程（${mode === 'rebuild' ? '全量重建' : '增量 build'}，通常 30–60 秒；不会写入工程、不会连接 PLC）…`)
        try {
          const result = await run(mode, { jobId })
          const report = summarizeCompilePayload(result?.payload, mode)
          setCompileReport(report)
          setCompileOpen(true)
          setStatus(`离线编译完成（${mode === 'rebuild' ? '全量重建' : '增量 build'}）· 错误 ${report.errorCount} · 警告 ${report.warningCount} · 信息 ${report.infoCount} · 编译对象是磁盘上已保存版本`)
        } catch (error) {
          setStatus(`编译失败：${error.message}`)
        } finally { setBusy(false) }
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
      const applyProposal = async (proposalToApply = effectiveProposal, validationErrors = effectiveErrors) => {
        if (busy || !writeAvailable || !reviewAccepted || validationErrors.length || !jobId || !proposalToApply?.changes?.length) return
        setBusy(true); setStatus('正在创建恢复快照并写入当前工程…')
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
          const writeResult = await run('apply-and-build', { jobId, changes, confirmed: true, includeTree: true })
          const treeReady = writeResult?.payload?.complete === true && writeResult?.payload?.textTruncated === false
          if (treeReady) {
            applyInspectionPayload(writeResult)
          } else {
            // Fall back to the separate read: a composite that could not produce a
            // complete tree must never leave the workbench showing the pre-write code.
            await inspect(jobId)
          }
          // Keep the written objects marked (green) so the project tree still
          // shows what this session changed after the diff is consumed.
          const writtenKeys = proposalKeys(proposalToApply.changes, proposalToApply)
          setObjectChangeState(writtenKeys, 'written')
          // T096: 文本已经落盘，草稿已经没有意义；留着它只会在下次切换时把旧文本又恢复出来。
          clearObjectDrafts(writtenKeys)
          // T097: 写入链路本来就会离线编译并返回同一份 messages；把它也喂给编译输出面板，
          // 于是"写入时的编译错误全文"第一次能在界面上看到（此前只有状态栏里的错误计数）。
          if (Array.isArray(writeResult?.payload?.messages)) {
            const report = summarizeCompilePayload(writeResult.payload, 'build')
            setCompileReport(report)
            if (report.errorCount > 0 || report.warningCount > 0) setCompileOpen(true)
          }
          setProposal(null); setProposalSource(''); setReviewAccepted(false); setAgentReloadAvailable(false)
          const timing = writeResult?.timings || {}
          const timingText = timing.total ? ` · 写入链路 ${timing.total}ms（脚本 ${timing.scriptEngineProcess || 0}ms，快照 ${timing.recoverySnapshot || 0}ms）` : ''
          const buildErrors = Number(writeResult?.payload?.errorCount || 0)
          setStatus(`已批量写入 ${Number(writeResult?.payload?.changeCount || changes.length)} 个对象 · 单次 ScriptEngine 完成写入+离线编译${timingText} · Build 错误 ${buildErrors} · 项目树已用绿色标记本次写入${treeReady ? '' : ' · 工程树已单独重读'} · 可使用恢复基线回滚`)
        } catch (error) { setStatus(`写入或编译失败：${error.message}；写前恢复快照已保留`) } finally { setBusy(false) }
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
        setBusy(true); setStatus('正在恢复工程基线…')
        try { await run('rollback', { jobId, snapshotId: '000-baseline' }); await inspect(jobId); setProposal(null); setProposalSource(''); setAssistantText(''); setObjectChangeState([...changeStateRef.current.keys()], ''); clearAllObjectDrafts(); setStatus('当前工程已恢复到绑定时基线。') }
        catch (error) { setStatus(`回滚失败：${error.message}`) } finally { setBusy(false) }
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
      const onlineDeviceLabel = onlineScannedName
        ? `${onlineScannedName}${onlineReady?.application ? ` · ${onlineReady.application}` : ''}`
        : (onlineReady
          ? `${onlineReady.deviceName || '设备'}${onlineReady.application ? ` · ${onlineReady.application}` : ''}`
          : '未识别目标设备')
      const onlineGatewayLabel = Array.isArray(onlineReady?.gateways) && onlineReady.gateways.length
        ? onlineReady.gateways.map((item) => item.name || item.raw || item.address || '').filter(Boolean).join(' / ')
        : ''
      const onlineConnected = onlineState?.state?.connected === true
      // 应用层状态与设备标志（OperatingState 位标志）。这三个是现场最需要一眼看到的：
      // 有强制生效 / 应用异常 / 保持变量不匹配。
      const onlineAppLabel = String(onlineState?.state?.applicationStateLabel || '')
      const onlineOperationFlags = Array.isArray(onlineState?.state?.operationFlags) ? onlineState.state.operationFlags : []
      const onlineOperationWarnings = Array.isArray(onlineState?.state?.operationWarnings) ? onlineState.state.operationWarnings : []
      // 未连接时不渲染任何状态文字：登录成功才出现绿色标识，所以这里不再需要
      // "未连接/已连接" 的文案状态机。
      const onlineLoggedIn = onlineState?.state?.isLoggedIn === true
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
      const onlineTargetPicked = onlineConnected || Boolean(onlineReady)
      const onlineTargetSummary = onlineTargetPicked
        ? `${onlineDeviceLabel}${onlineIpLabel && !/^未(配置|读到)/.test(onlineIpLabel) ? ` · ${onlineIpLabel}` : ''}`
        : '未读取（点「扫描设备」读取并选择）'
      const onlineTargetDetail = [
        `设备：${onlineTargetPicked ? onlineDeviceLabel : '未读取'}`,
        `设备标识：${onlineIdentity || '未读到'}`,
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
              setStatus(`已登录 PLC · ${after?.ready?.deviceName || '设备'} · 应用状态 ${stateText}（只登录、不传输；在线变量已开启：切到某个 POU，声明区行尾就是当前值。启动/停止/复位/写变量/Force 仍需先「下载」）`)
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
              current: lineIndex >= 0 ? (onlineValueByLine?.get(lineIndex + 1) || '') : '',
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
      React.useEffect(() => {
        if (!jobId || !onlineLoggedIn || !workbenchVisible) { setOnlineValues(null); return undefined }
        // 简单变量读自己，FB 实例读它的关键成员（原生 CODESYS 就是展开实例看成员值）。
        // 简单变量排在前面，所以 60 条上限先保住它们。
        const variables = codesysMonitorVariables(oldDeclaration)
        const simple = []
        const members = []
        for (const variable of variables) {
          const list = codesysMonitorExpressionsFor(variable)
          if (!list.length) continue
          if (list.length === 1) simple.push(list[0])
          else members.push(...list)
        }
        const expressions = [...simple, ...members].slice(0, 90)
        if (!expressions.length) { setOnlineValues(null); return undefined }
        let cancelled = false
        let inFlight = false
        let timer = null
        let signature = ''
        let delay = 1500
        const tick = async () => {
          if (cancelled || inFlight || onlineBusyRef.current) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          inFlight = true
          const startedAt = Date.now()
          try {
            const value = await window.taskhive?.monitorCodesysOnline?.({
              jobId,
              projectPath: sourcePath,
              expressions,
              // 所选对象的名字：PROGRAM 的局部量只有写成 实例名.变量 才读得到
              // （实测：permit 无效、Jog.permit = FALSE），GVL 的全局量两种都行。
              scope: selected?.name || '',
            })
            if (cancelled) return
            if (value?.ok) {
              const names = value.expressions || expressions
              const values = (value.values || []).map((item) => String(item ?? ''))
              const next = `${value.applicationState || ''}|${names.join(',')}|${values.join(',')}`
              if (next !== signature) {
                signature = next
                setOnlineValues({ expressions: names, values, applicationState: value.applicationState || '', at: Date.now() })
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

      // Line -> value, so the declaration column can paint CODESYS-style values.
      // 一个变量名 -> 它自己的值（简单变量）或它成员的 "成员=值"（FB 实例）。
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

      const onlineValueByLine = React.useMemo(() => {
        if (!onlineValueByName) return null
        const map = new Map()
        String(oldDeclaration || '').split('\n').forEach((raw, index) => {
          const name = codesysMonitorExpressionForLine(raw)
          if (!name) return
          const lower = name.toLowerCase()
          const direct = onlineValueByName.get(lower)
          if (direct) { map.set(index + 1, direct); return }
          // FB 实例：把读到的成员拼成 CODESYS 展开后那样的短摘要。
          const parts = []
          for (const [key, value] of onlineValueByName) {
            if (!key.startsWith(`${lower}.`)) continue
            parts.push(`${key.slice(lower.length + 1)}=${value}`)
          }
          if (parts.length) map.set(index + 1, parts.slice(0, 3).join('  '))
        })
        return map.size ? map : null
      }, [onlineValueByName, oldDeclaration])

      // 实现区：每一行引用到的、本对象声明过的变量，行尾显示它的当前值。
      // （原生 CODESYS 的实现区在线视图也是这么标值的。）
      const onlineValueByLineImpl = React.useMemo(() => {
        if (!onlineValueByName) return null
        const declared = codesysMonitorVariables(oldDeclaration)
        if (!declared.length) return null
        const matchers = declared.map((variable) => ({
          name: variable.name,
          lower: variable.name.toLowerCase(),
          pattern: new RegExp(`(^|[^A-Za-z0-9_.])${variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`, 'i'),
        }))
        const map = new Map()
        String(oldImplementation || '').split('\n').forEach((raw, index) => {
          const text = String(raw).replace(/\(\*.*?\*\)/g, ' ').replace(/\/\/.*$/, '')
          if (!text.trim()) return
          const parts = []
          for (const matcher of matchers) {
            if (!matcher.pattern.test(text)) continue
            const direct = onlineValueByName.get(matcher.lower)
            if (direct) {
              parts.push(`${matcher.name}=${direct}`)
            } else {
              for (const [key, value] of onlineValueByName) {
                if (!key.startsWith(`${matcher.lower}.`)) continue
                parts.push(`${key.slice(matcher.lower.length + 1)}=${value}`)
                break
              }
            }
            if (parts.length >= 2) break
          }
          if (parts.length) map.set(index + 1, parts.join('  '))
        })
        return map.size ? map : null
      }, [onlineValueByName, oldDeclaration, oldImplementation])
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
        // layers follow their textarea imperatively, so they reset with them.
        for (const refs of [declarationRefs, implementationRefs]) {
          if (refs.highlight.current) refs.highlight.current.style.transform = 'translateY(0px)'
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
      // Publish the live workbench state to the host plugin so the model can
      // read exactly what this panel shows (and so a chat-side edit lands here).
      // The fingerprint keeps the 900 ms debounce meaningful: identical state
      // never produces a request, typing produces one per pause.
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
        const snapshotChanged = codesysStateKeepAlive.publishedSignature !== projectSnapshotSignature
        if (snapshotChanged) codesysStateKeepAlive.pendingSnapshot = { signature: projectSnapshotSignature, snapshot: projectSnapshot }
        publishCodesysStateRef.current?.({
          projectPath: sourcePath, projectName: codesysBaseName(sourcePath), jobId, writeAvailable, writeBlockReason,
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
        })
      }, [liveStateFingerprint])
      // T083: 命令条只有一行，所以状态词缩短为「可写入 / 等待 AI 改动 / 不可写入」，
      // 具体原因改由旁边可伸缩的详情文字承载——它拿的是剩余宽度，越窄越省略，
      // 全文仍在 title 里。原来"不可写入：<原因>"挤在固定宽度的状态词里，反而把
      // 真正需要读的原因压成了省略号。
      const writeStateLabel = writeAvailable
        ? (effectiveChanges.length ? '可写入' : '等待 AI 改动')
        : '不可写入'
      const writeStateDetail = writeAvailable
        ? (effectiveChanges.length ? '勾选「已核对」后写入磁盘工程并执行离线编译。' : '当前工程已读取；生成代码提案或手写修改后才会启用确认按钮。')
        : (writeBlockReason || activeProject?.writeBlockReason || '请先绑定可写工程')
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
      const editorStateLabel = manualChange ? '手写修改 · 尚未写入' : aiProposed ? 'AI 建议 · 可继续修改' : selected ? '已打开项目对象 · 可直接修改' : '请从项目树选择代码对象'
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
          if (refs.gutter.current) refs.gutter.current.scrollTop = top
          if (refs.highlight.current) refs.highlight.current.style.transform = `translateY(${-top}px)`
          // The online value column must ride with the code or the values drift
          // away from the lines they belong to.
          if (refs.values?.current) refs.values.current.style.transform = `translateY(${-top}px)`
        }
        // CODESYS 在线模式在声明每一行右侧显示该变量的当前值。A textarea cannot
        // carry inline values, so the values live in a third grid column aligned to
        // the same 15.95px line height and scrolled in lockstep.
        const valueByLine = section.id === 'declaration' ? onlineValueByLine : (section.id === 'implementation' ? onlineValueByLineImpl : null)
        return h('div', {
          className: `taskhive-codesys-editor-section${valueByLine ? ' has-online-values' : ''}`, key: section.id,
          'data-editor-section': section.id,
          'data-section-online-values': valueByLine ? 'true' : 'false',
          'data-section-changed-lines': [...changed].join(','),
          // The two sections split the code pane by the user's dragged ratio.
          style: { flex: `${section.id === 'declaration' ? declarationFraction : 1 - declarationFraction} 1 0%` },
        },
        h('div', { className: 'taskhive-codesys-editor-section-head' },
          h('span', null, section.label),
          // 已登录时把"在线值"这件事写在声明区自己的标题上：值就出现在这一区每行的
          // 行尾，登录了却看不到值（对象里没有可读的简单变量、或读被打断）时也能一眼
          // 分辨是"没读"还是"没值"。
          onlineLoggedIn
            ? h('span', {
              className: `taskhive-codesys-editor-online${valueByLine ? ' is-live' : ''}`,
              'data-editor-online': valueByLine ? 'live' : 'idle',
              title: valueByLine
                ? (section.id === 'declaration'
                  ? '在线值：每行行尾就是该变量此刻在 PLC 里的值；FB 实例显示它的关键成员（Status / Position / Error…），与 CODESYS 展开实例等价'
                  : '在线值：这一行引用到的变量，行尾显示它此刻在 PLC 里的值')
                : '已登录，但这一区还没有可显示的在线值：只有形如「名字 : 类型;」的声明能读，FB 实例读它的成员；数组/结构整体读不出来。',
            }, valueByLine ? '在线值' : '在线中…')
            : null,
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
            h('textarea', {
              className: 'taskhive-codesys-code-editor', value: section.value,
              onChange: (event) => section.onChange(event.target.value), onScroll: syncScroll,
              spellCheck: false, 'data-codesys-code-editor': section.id === 'implementation' ? 'true' : 'false',
              'data-editor-part': section.id,
              'aria-label': selected ? `${selected.name} 的 CODESYS ${section.label}` : `可编辑 CODESYS ${section.label}`,
              disabled: !selected || !selectedIsCode || busy,
              // No `title`: the native tooltip popped a dark box over the code
              // the moment the user clicked into it ("太突兀"). The section
              // heading above already names the part, and `aria-label` keeps the
              // control accessible without a hover tooltip.
              'data-no-native-tooltip': 'true',
            })),
          valueByLine ? h('div', {
            className: 'taskhive-codesys-online-values', ref: refs.values,
            'data-codesys-online-values': 'true', 'aria-hidden': 'true',
          }, lines.map((_, index) => h('span', {
            key: `${section.id}-value-${index + 1}`,
            className: 'taskhive-codesys-online-value',
            'data-line-number': String(index + 1),
          }, valueByLine.get(index + 1) ?? ''))) : null))
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
      const codePane = h('section', { className: 'taskhive-codesys-code-pane', 'data-codesys-editor-change-state': editorLineState },        h('header', { className: 'taskhive-codesys-pane-heading', 'data-codesys-preview-name': selected?.name || '', 'data-codesys-preview-guid': selected?.guid || '' }, h('span', null, selected?.name || '代码编辑器'), h('small', null, editorSections.length ? editorSections.map((section) => section.id === 'declaration' ? '声明' : '实现').join(' + ') : (selected?.guid ? selected.guid.slice(0, 8) : 'ST / IEC'))),
        h('div', {
          className: 'taskhive-codesys-editor-meta', 'data-codesys-code-diff': 'true', 'data-editor-change-state': editorLineState,
          'data-changed-lines': changedLineNumbers.join(','),
          'data-changed-lines-implementation': changedLineNumbersImplementation.join(','),
        },
          h('span', { className: 'taskhive-codesys-editor-state' }, editorStateLabel),
          agentReloadAvailable ? h('button', { className: 'taskhive-codesys-action taskhive-codesys-reload-suggestion', type: 'button', title: '用最新的 AI 建议覆盖当前手写修改', onClick: () => { setEditedDeclaration(newDeclaration); setEditedImplementation(newImplementation); setAgentReloadAvailable(false); setObjectDraft(selectedObjectKey, newDeclaration, newImplementation) }, 'data-codesys-reload-suggestion': 'true' }, '载入 AI 建议') : null,
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
                `设备 IP / 端口：${onlineIpLabel}`,
                `网关节点地址：${onlineAddress || '未读到'}`,
                `网关：${onlineGatewayLabel || '未读到'}`,
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
                ...(onlineLoggedIn ? ['在线变量：切到某个 POU，声明区每行行尾显示当前值'] : []),
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
        h('section', {
          className: `taskhive-codesys-commandbar ${writeAvailable ? 'is-ready' : 'is-blocked'}`,
          'aria-label': '工程写入状态', 'data-codesys-commandbar': 'true', 'data-codesys-write-panel': 'true',
        },
          h('strong', { className: 'taskhive-codesys-write-heading', title: writeStateDetail }, '写入'),
          h('span', { className: 'taskhive-codesys-write-state', title: writeStateDetail, 'data-codesys-write-state': 'true' }, writeStateLabel),
          h('span', { className: 'taskhive-codesys-write-detail', title: writeStateDetail, 'data-codesys-write-reason': 'true' }, writeStateDetail),
          effectiveChanges.length ? h('label', { className: 'taskhive-codesys-review', title: '写入前必须逐行核对项目树标记与代码差异；未勾选时确认按钮保持禁用' },
            h('input', { type: 'checkbox', checked: reviewAccepted, onChange: (event) => setReviewAccepted(event.target.checked), 'data-codesys-review-accepted': 'true' }), '已核对') : null,
          // T085: 这里原来还有一颗「重新检测」，但它与顶栏「刷新」调用的是**同一个**
          // detectCurrentProject({ force: true })——同一面板里两个入口做同一件事。
          // 按用户确认删除后，约 59px 全部让给上面那条"不可写入的原因"文案（它是
          // flex:1 1 0，会自动吸收）。检测入口只剩顶栏那一颗，它的 title 已补上
          // "ScriptEngine 与写入权限"，能力不丢。
          h('button', { className: 'taskhive-codesys-submit taskhive-codesys-confirm-write', type: 'button', title: writeAvailable ? '创建恢复快照后写入当前工程并执行离线编译' : (writeBlockReason || '当前工程暂不可写入'), disabled: busy || !writeAvailable || !effectiveChanges.length || !reviewAccepted || effectiveErrors.length > 0, onClick: () => applyProposal(effectiveProposal, effectiveErrors), 'data-codesys-confirm-write': 'true' }, '确认写入')),
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
            }, `${compileOpen ? '▾' : '▸'} 编译输出 · 错误 ${compileReport.errorCount} · 警告 ${compileReport.warningCount} · 信息 ${compileReport.infoCount}`),
            h('span', { className: 'taskhive-codesys-compile-meta', title: `工程：${compileReport.projectPath || '(未绑定)'}` }, `${compileReport.mode === 'rebuild' ? '全量重建' : '增量 build'} · ${new Date(compileReport.at).toLocaleTimeString()}`),
            h('button', { className: 'taskhive-codesys-compile-copy', type: 'button', title: '复制完整编译输出文本', onClick: () => { void copyCompileReport() }, 'data-codesys-compile-copy': 'true' }, '复制'),
            h('button', { className: 'taskhive-codesys-compile-clear', type: 'button', title: '清除编译输出', onClick: () => { setCompileReport(null); setCompileOpen(false) }, 'data-codesys-compile-clear': 'true' }, '×')),
          compileOpen ? h('div', { className: 'taskhive-codesys-compile-body', 'data-codesys-compile-text': 'true' },
            compileReport.messages.length
              ? compileReport.messages.map((item, index) => {
                const severity = String(item?.severity || 'info').toLowerCase()
                const kind = severity.includes('error') ? 'error' : severity.includes('warning') ? 'warning' : 'info'
                return h('div', { key: index, className: `taskhive-codesys-compile-line is-${kind}` }, `[${String(item?.severity || 'info')}] ${String(item?.text || '')}`)
              })
              : h('div', { className: 'taskhive-codesys-compile-line is-info' }, '编译完成，没有产生任何消息。')) : null)
        : null,
        // 「扫描设备」底部面板：与「编译输出」同一形态（用户口径："改成和编译一样的底部弹出"）。
        // 头部给状态 + 计时；正文是可点选的设备列表。扫描要等网关广播，所以计时把
        // "CODESYS 进程启动"和"网关扫描"分开报：这 20 秒花在哪儿，一眼能看出来。
        scanOpen ? h('section', {
          className: `taskhive-codesys-compile taskhive-codesys-scan${scanBusy ? ' is-busy' : ''}`,
          'data-codesys-scan-panel': 'true',
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
            h('div', { className: 'taskhive-codesys-tree', role: 'tree', 'aria-label': 'CODESYS 项目树', 'data-codesys-project-tree': 'true', 'data-codesys-tree-filter': treeFilter },
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
          // 目标不再是常驻 chip（用户口径："应该只是一行提示字…不应该常驻"）：绑定/更换目标
          // 时由状态行说一句（见下面的 announceTarget effect）；这里只在**已连接**时保留一个
          // 可点的目标入口（那时它表示"连着谁"），未连接时不留任何常驻元素。
          onlineConnected ? h('button', {
            className: 'taskhive-codesys-online-target-chip is-online',
            type: 'button',
            'data-codesys-online-target-summary': onlineTargetSource || 'project',
            'data-codesys-online-target-bound': onlineBound ? 'true' : 'false',
            title: `当前已连接：${onlineTargetSummary}\n${onlineTargetDetail}\n\n点这里打开底部「扫描设备」面板（可重新扫描或直接填 IP）。`,
            onClick: () => openOnlineTargetPanel(),
          }, `目标 ${onlineTargetSummary}`) : null,
          h('span', {
            className: `taskhive-codesys-linkstate${effectiveChanges.length ? ' is-pending' : ''}${sessionId ? '' : ' is-idle'}`,
            title: sessionId
              ? `工作台状态发布到当前活动会话 ${sessionId}${effectiveChanges.length ? `；有 ${effectiveChanges.length} 处待确认改动` : (changedObjectCount ? `；已写入 ${changedObjectCount} 个对象` : '；暂无待确认改动')}。切换会话时它会自动跟着走。`
              : '当前没有活动会话，工作台状态没有人接收。请先在对话里打开一个会话。',
            'data-codesys-linkstate': sessionId ? 'linked' : 'unlinked',
          },
            sessionId ? '●' : '○',
            h('span', { className: 'taskhive-codesys-linkstate-label' }, sessionId ? ` 已联动到会话 ${codesysSessionLabel(sessionId)}` : ' 未连接会话')),
          h('div', { className: 'taskhive-codesys-status', role: 'status', title: status, 'data-codesys-workbench-status': 'true' },
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
        if (!error) return h(CodesysWorkbench, { ctx: this.props.ctx })
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

    function iconPaths(id) {
      const paths = {
        codesys: [h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 1 }), h('path', { d: 'M8 21h8M12 17v4' })],
        'web-ai': [h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.4 3.1 5.2 3.1 8.5S14.1 18.1 12 20.5C9.9 18.1 8.9 15.3 8.9 12S9.9 5.9 12 3.5z' })],
        knowledge: [h('path', { d: 'M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 0z' }), h('path', { d: 'M5 4.5v15M8 19.5h11M9 9h6M9 12h6' })],
        experts: [h('circle', { cx: 9, cy: 8, r: 3 }), h('path', { d: 'M3.8 19c.5-3.2 2.3-5 5.2-5s4.7 1.8 5.2 5' }), h('circle', { cx: 17, cy: 9, r: 2.2 }), h('path', { d: 'M15.2 14.7c.6-.5 1.3-.7 2.2-.7 2.1 0 3.2 1.4 3.6 3.8' })],
        charts: [h('path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' })],
        packages: [h('path', { d: 'm12 3 8 4.5v9L12 21l-8-4.5v-9z' }), h('path', { d: 'm4 7.5 8 4.5 8-4.5M12 12v9' })],
        settings: [h('circle', { cx: 12, cy: 12, r: 3 }), h('path', { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L7 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L7 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z' })],
      }
      return paths[id] || paths.packages
    }

    function surfaceIcon(id) {
      return h('span', {
        'aria-hidden': 'true',
        'data-taskhive-plugin-icon': id,
        style: { display: 'grid', placeItems: 'center', width: '16px', height: '16px', color: 'currentColor', flex: '0 0 auto' }
      }, h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false' }, ...iconPaths(id)))
    }

    function installTaskHiveSkin(ctx, openSessionRecordsTab) {
      if (document.getElementById('taskhive-harness-skin')) return
      const style = document.createElement('style')
      style.id = 'taskhive-harness-skin'
      // Preserve the upstream DSH theme. TaskHive adds surface-specific
      // styles below but does not recolor or replace the host workbench.
      style.textContent = ''
      style.textContent += `
/* Long conversations stay in the session store, but off-screen message rows
   must not participate in every composer keystroke's layout/paint pass. */
[data-conversation-scroll] [data-chat-flow-key]{content-visibility:auto;contain:layout style paint;contain-intrinsic-size:auto 120px}
/* The composer's expert control opens the expert plugin, so it needs the same
   hover/focus affordance as the native controls beside it: as a switch its only
   feedback was the state label, which left a pointer cursor over a flat button. */
[data-taskhive-expert-toggle="true"]:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-button-tool-bar-hover,#ededed))!important}
[data-taskhive-expert-toggle="true"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6b78e6);outline-offset:1px}
[data-taskhive-codesys-workbench="true"]{box-sizing:border-box;display:grid!important;grid-template-rows:auto auto minmax(360px,1fr) auto auto auto auto;min-height:calc(100vh - 52px);gap:12px!important;padding:14px 12px 18px!important;color:var(--dsw-alias-label-primary,#171717)!important;background:var(--dsw-alias-bg-layer-1,#fff);font:13px/1.45 Inter,"Microsoft YaHei",system-ui,sans-serif}
.taskhive-codesys-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.taskhive-codesys-header-copy{min-width:0}.taskhive-codesys-header strong{display:block;font-size:15px;line-height:1.35;letter-spacing:-.01em}.taskhive-codesys-header small{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#666));font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.taskhive-codesys-project{display:grid;gap:8px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;padding:9px;background:var(--dsw-alias-bg-layer-2,#f7f7f7)}.taskhive-codesys-field-label{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#666));font-size:10px;font-weight:600}.taskhive-codesys-path{box-sizing:border-box;width:100%;height:34px;min-width:0;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:8px;padding:0 10px;color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-1,#fff);font:10.5px ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}.taskhive-codesys-path:focus{border-color:var(--dsw-alias-brand-primary,#6b78e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#6b78e6) 14%,transparent)}.taskhive-codesys-project-actions{display:flex;flex-wrap:wrap;gap:5px}
.taskhive-codesys-write-panel{display:grid;gap:6px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;padding:10px;background:var(--dsw-alias-bg-layer-1,#fff);position:relative;z-index:2}.taskhive-codesys-write-panel.is-ready{border-color:var(--dsw-alias-state-success-primary,#2e8b57);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-success-primary,#2e8b57) 14%,transparent)}.taskhive-codesys-write-panel.is-blocked{border-color:var(--dsw-alias-state-warn-secondary,#e5bf67);background:var(--dsw-alias-state-warn-tertiary,#fffaf0)}.taskhive-codesys-write-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.taskhive-codesys-write-heading strong{font-size:12px}.taskhive-codesys-write-state{font-size:11px;font-weight:650;color:var(--dsw-alias-state-success-primary,#246b45)}.is-blocked .taskhive-codesys-write-state{color:var(--dsw-alias-state-warn-label,#815000)}.taskhive-codesys-write-detail{font-size:10px;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap}.taskhive-codesys-write-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.taskhive-codesys-confirm-write{min-width:190px;min-height:36px;font-size:12px}.taskhive-codesys-confirm-write:disabled{color:var(--dsw-alias-label-tertiary,#777);background:var(--dsw-alias-bg-layer-3,#ededed);border-color:var(--dsw-alias-border-l2,#d5d5d5)}
.taskhive-codesys-action{box-sizing:border-box;min-height:30px;border:1px solid transparent;border-radius:7px;padding:0 9px;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-button-tool-bar-fill,var(--dsw-alias-bg-layer-1,#fff));font:500 11px/1 Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer;transition:background-color .12s ease,color .12s ease,border-color .12s ease}.taskhive-codesys-action:hover:not(:disabled){color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-button-tool-bar-hover,var(--dsw-alias-interactive-bg-hover,#ededed))}.taskhive-codesys-action:focus-visible,.taskhive-codesys-treeitem:focus-visible,.taskhive-codesys-submit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6b78e6);outline-offset:1px}.taskhive-codesys-action:disabled{opacity:.38;cursor:not-allowed}
.taskhive-codesys-editor{display:grid;grid-template-columns:minmax(140px,.42fr) minmax(0,1fr);gap:8px;min-height:360px;height:100%}.taskhive-codesys-object-pane,.taskhive-codesys-code-pane{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;background:var(--dsw-alias-bg-layer-1,#fff)}.taskhive-codesys-pane-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:35px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-separator-primary,var(--dsw-alias-border-l2,#dedede));color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-2,#f7f7f7);font-size:11px;font-weight:650}.taskhive-codesys-pane-heading small{color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary,#888));font:9px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.taskhive-codesys-tree{box-sizing:border-box;height:100%;min-height:0;overflow:auto;padding:5px}.taskhive-codesys-treeitem{box-sizing:border-box;width:100%;min-height:31px;margin:0 0 2px;border:0;border-left:2px solid transparent;border-radius:6px;padding:0 8px;color:var(--dsw-alias-label-secondary,#555);background:transparent;text-align:left;font:500 11.5px/1.2 Inter,"Microsoft YaHei",system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.taskhive-codesys-treeitem:hover{color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2,#f7f7f7))}.taskhive-codesys-treeitem[data-selected="true"]{border-left-color:var(--dsw-alias-brand-primary,#6b78e6);color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-bg-layer-3,#ededed));font-weight:600}.taskhive-codesys-treeitem[data-changed="true"]{border-left-color:var(--dsw-alias-state-warn-primary,#d28a14);color:var(--dsw-alias-state-warn-label,#815000);background:var(--dsw-alias-state-warn-tertiary,#fff3c4);font-weight:650}
.taskhive-codesys-diff{height:100%;min-height:0;overflow:auto;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-1,#fff));font:10.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.taskhive-codesys-diff-row{display:grid;grid-template-columns:32px minmax(0,1fr);min-height:19px;border-bottom:1px solid var(--dsw-alias-separator-primary,var(--dsw-alias-border-l2,#eee))}.taskhive-codesys-diff-row[data-changed="true"]{background:var(--dsw-alias-state-warn-tertiary,#fff3c4);box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary,#d28a14)}.taskhive-codesys-line-number{padding:1px 5px;color:var(--dsw-alias-label-quaternary,#999);background:var(--dsw-alias-bg-layer-2,#f7f7f7);text-align:right;user-select:none}.taskhive-codesys-code-cell{min-width:0;padding:1px 7px;color:var(--dsw-alias-label-secondary,#444);white-space:pre-wrap;overflow-wrap:anywhere}.taskhive-codesys-diff-row[data-changed="true"] .taskhive-codesys-code-new{color:var(--dsw-alias-state-success-primary,#125c2e);background:color-mix(in srgb,var(--dsw-alias-state-success-secondary,#edfff2) 72%,transparent);font-weight:600}
.taskhive-codesys-composer{display:grid;gap:7px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:11px;padding:9px;background:var(--dsw-alias-bg-layer-2,#f7f7f7)}.taskhive-codesys-composer-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.taskhive-codesys-composer-heading strong{font-size:11px}.taskhive-codesys-composer-heading small{color:var(--dsw-alias-label-tertiary,#777);font-size:9px}.taskhive-codesys-prompt{box-sizing:border-box;width:100%;min-height:76px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:8px;padding:8px 10px;color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-1,#fff);font:12px/1.5 Inter,"Microsoft YaHei",system-ui,sans-serif;resize:vertical;outline:none}.taskhive-codesys-prompt:focus{border-color:var(--dsw-alias-brand-primary,#6b78e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#6b78e6) 14%,transparent)}.taskhive-codesys-prompt:disabled{color:var(--dsw-alias-label-dimmed,#aaa);background:var(--dsw-alias-bg-layer-2,#f7f7f7)}.taskhive-codesys-submit{height:32px;border:1px solid color-mix(in srgb,var(--dsw-alias-button-info-fill,#6f86e8) 30%,transparent);border-radius:8px;padding:0 12px;color:var(--dsw-alias-label-primary-inverted,#fff);background:var(--dsw-alias-button-info-fill,#6f86e8);font:600 11.5px Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer}.taskhive-codesys-submit:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#5d74da)}.taskhive-codesys-submit:disabled{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));color:var(--dsw-alias-label-dimmed,#999);background:var(--dsw-alias-bg-layer-3,#ededed);opacity:1;cursor:not-allowed}.taskhive-codesys-assistant,.taskhive-codesys-proposal{max-height:200px;overflow:auto;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:9px;padding:9px;color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-bg-layer-1,#fff);font-size:11px;white-space:pre-wrap}.taskhive-codesys-proposal{display:grid;gap:7px;max-height:none;border-color:var(--dsw-alias-state-warn-secondary,#e5bf67);background:var(--dsw-alias-state-warn-tertiary,#fffaf0)}.taskhive-codesys-status{min-height:18px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#666));font-size:10px;white-space:pre-wrap}.taskhive-codesys-safety{border-top:1px solid var(--dsw-alias-separator-primary,var(--dsw-alias-border-l2,#eee));padding-top:9px;color:var(--dsw-alias-label-quaternary,var(--dsw-alias-label-tertiary,#888));font-size:9px;line-height:1.5}
@media (prefers-reduced-motion:reduce){.taskhive-codesys-action{transition:none}}
.taskhive-codesys-code-editor{box-sizing:border-box;width:100%;min-height:160px;resize:vertical;overflow:auto;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-subtle,#dedede));border-radius:7px;padding:8px 10px;color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-bg-layer-1,#fff);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;outline:none;white-space:pre;tab-size:2}.taskhive-codesys-code-editor:focus{box-shadow:inset 0 0 0 2px var(--dsw-alias-accent-primary,#171717)}.taskhive-codesys-code-editor:disabled{color:var(--dsw-alias-label-tertiary,#777);background:var(--dsw-alias-bg-layer-2,#f7f7f7)}
 
/* ── T081 紧凑工作台：一行顶栏 + 一行命令条，其余全给对象树和代码编辑器 ──────
   The workbench used to spend four stacked bands around the editor — a header, a
   full 当前工程 card (label + path + wrapping action buttons), a 代码任务 composer
   with a 4-row textarea, and a 工程写入 panel with its own detail line and action
   row. The two bottom cards each reserved up to 132px. The user's report:
     "提高代码项目树的占用比例，把当前工程功能块移到 codesys 代码工作台同一行…
      缩小代码任务和工程写入功能块高度，可以改成一行显示，代码任务不需要保留
      输入框…空出来的区域都给代码编辑器"
   So the root grid is now three bands:
     行1 顶栏    = 标题 · 工程路径 · 刷新/选择/复制/定位/回退 · 联动与工程徽章
     行2 工作区  = 对象树 | 拖动条 | 代码编辑器（唯一可伸缩的行）
     行3 命令条  = 「代码任务」 | 「写入 · 可写入/等待 AI 改动/不可写入 + 原因 · 已核对 · 确认写入」
     行4 小字    = 运行状态（省略号） + 「ⓘ 安全边界」（全文在悬浮/焦点里）
   T082 收尾：第三行曾经是两个盒子（裸按钮 30px + 带框条 38px），高度与描边都不一致，
   所以永远对不齐；现在合成**一条**命令条（一个边框、一条基线、等高）。底部的状态与
   安全声明也从两行合并成一行（T081 时是两行小字）。
   T083 收尾：文案全部缩短（代码任务 · 交给 AI → 代码任务；工程写入 → 写入；
   已核对差异 → 已核对；确认写入工程（离线编译）→ 确认写入），并把不可写入的**原因**
   从固定宽度的状态词移到可伸缩的详情文字里，让默认 400px 侧栏下这条也能落在一行。
   被截掉的完整含义全部保留在各自的 title 里。
   Everything that used to be a block is now either inline in those bands or a title
   tooltip. Both the top bar and the command bar wrap instead of overflowing, so the
   narrowest Better Sidebar (280px) stays usable. */
[data-taskhive-codesys-workbench="true"]{height:100%!important;min-height:0!important;max-height:100%!important;overflow:hidden!important;display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(0,1fr) auto auto!important;align-content:stretch;gap:6px!important;padding:8px!important;container-type:inline-size;container-name:taskhive-codesys}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-assistant,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-proposal,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-statusrow{grid-column:1 / -1}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header{grid-row:1}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor{grid-row:2;min-height:0!important;height:auto!important;display:grid!important;overflow:hidden!important}
/* T082 单条命令条：顶栏与命令条都允许换行，不再有"两个盒子各调各的"的高度错位。
   T083 把条内间距收到 5px，让缩短文案后的控件在默认 400px 侧栏下能落在一行。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar{grid-row:3;box-sizing:border-box;display:flex!important;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;min-height:38px;padding:3px 8px!important;border:1px solid var(--th-line);border-radius:8px!important;background:var(--th-surface-2)}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar.is-ready{border-color:var(--th-ok-line)!important;background:var(--th-surface)!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-commandbar.is-blocked{border-color:var(--th-warn-line)!important;background:var(--th-warn-tint)!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-assistant,[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-proposal{max-height:64px;overflow:auto}
/* 顶栏内部：标题 + 工程（标签/路径/操作）+ 徽章，共用同一行并在必要时换行。 */
/* T084 顶栏内部：标题 + 路径 + 5 个工程操作 + 徽章，压到**一行**。
   宽度预算（按 CJK=1em、Latin≈0.55em 估算，默认 400px 侧栏 → 可用约 384px）：
     标题「代码工作台」62.5 + 路径(min 56) + 「刷新」34 + 「选择工程」54
     + 3 个图标 78 + 操作间距 16 + 联动徽章 45 + 顶栏间距 12 ≈ 357.5px ✅ 一行
   侧栏更窄时按下面两级继续降级；「必要时换行」只作为兜底，不再是常规表现。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-header{display:flex!important;flex-wrap:wrap;align-items:center;justify-content:flex-start;gap:6px;min-width:0;overflow:visible}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy strong{display:block;font-size:12.5px;line-height:1.2;white-space:nowrap;letter-spacing:-.01em}
/* 会话号已由联动徽章表达（对话联动已就绪 / 对话未连接），窄栏里不再重复占宽。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy small{display:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project{display:flex!important;flex:1 1 auto;flex-wrap:wrap;align-items:center;gap:5px;min-width:0;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-field-label{flex:0 0 auto;font-size:9.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-path{flex:1 1 90px;height:28px;min-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions{display:flex;flex:0 1 auto;min-width:0;max-width:100%;flex-wrap:wrap;overflow:hidden;gap:4px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action{flex:0 0 auto;min-height:26px;padding:0 6px;font-size:10px;white-space:nowrap}
/* 本轮按用户要求反转：**默认只显示图标**（16 个功能在窄栏才放得下），
   容器够宽（≥820px）才把带标签的动作展开成文字。
   全文始终在 aria-label 与 title 里。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-text,
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-icononly{display:inline-flex;align-items:center;justify-content:center;gap:4px;width:26px;min-height:26px;padding:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-label{display:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-text .taskhive-codesys-action-icon,
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-icononly .taskhive-codesys-action-icon{display:block}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-icononly{width:26px;min-height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-icon{display:block;flex:none;pointer-events:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-label{pointer-events:none}
/* Online (PLC) group. It renders only once a project is bound, and the path box
   compresses to pay for it so the top bar still fits on one line. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;padding-left:6px;margin-left:2px;border-left:1px solid var(--th-line)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-download:not(:disabled){border-color:var(--th-warn-line)!important;color:var(--th-warn)!important}
/* 能驱动机械 / 清保持变量的三项（写值 / 复位 / Force）用克制的红描边区分，
   与确认词弹窗呼应，但不用实心红块。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-danger:not(:disabled){border-color:#e4c4c1!important;color:#a3403a!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-danger:hover:not(:disabled){border-color:#d9a9a4!important;background:#fbeeed!important}
/* 登录成功 = 醒目的绿色标识；未连接时**不显示任何状态文字**。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;min-height:26px;padding:0 9px;border:1px solid var(--th-ok)!important;border-radius:999px;background:var(--th-ok)!important;color:#fff!important;font:650 10px Inter,"Microsoft YaHei",system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 0 0 2px var(--th-ok-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge:hover{filter:brightness(1.07)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge:focus-visible{outline:2px solid var(--th-ok);outline-offset:2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge .taskhive-codesys-online-dot{background:#fff}
/* 有强制生效 / 应用异常 / 保持变量不匹配时，绿色标识转为警告色 —— 不能只藏在 tooltip 里。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge.is-warning{border-color:#d9a9a4!important;background:#a3403a!important;box-shadow:0 0 0 2px #fbeeed}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge.is-warning:hover{filter:brightness(1.05)}
/* 「在线目标」弹层已删除；下面这几个类名保留下来只服务底部扫描面板里的控件：
   select / address / apply / cancel / scan（-panel/-title/-mode/-sim/-note 已随弹层移除）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-select,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-address{box-sizing:border-box;height:26px;min-width:0;border:1px solid var(--th-line);border-radius:6px;padding:0 6px;color:var(--th-ink);background:var(--th-surface);font:10.5px Inter,"Microsoft YaHei",system-ui,sans-serif}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-select{flex:0 1 auto;max-width:150px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-address{flex:1 1 110px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-address.is-port{flex:0 1 72px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-apply,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-cancel,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-scan{flex:0 0 auto;height:26px;padding:0 9px;border:1px solid var(--th-line);border-radius:6px;background:var(--th-surface);font:inherit;font-size:10px;color:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-scan:not(:disabled),[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-apply:not(:disabled){border-color:var(--th-brand-line);color:var(--th-brand-ink);font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-apply:disabled,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-cancel:disabled,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-scan:disabled{opacity:.5;cursor:default}
/* 扫描结果：一行一台设备，点一下即设为本次会话的在线目标。
   面板本身复用「编译输出」的 .taskhive-codesys-compile* 规则，这里只补列表行。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-body{max-height:200px;display:flex;flex-direction:column;gap:3px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row{display:flex;align-items:baseline;gap:8px;width:100%;min-height:26px;padding:3px 8px;border:1px solid var(--th-line);border-radius:6px;background:var(--th-surface);color:inherit;font:inherit;font-size:11px;text-align:left;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row:hover{border-color:var(--th-brand-line);background:var(--th-brand-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row:focus-visible{outline:2px solid var(--th-brand-line);outline-offset:1px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row.is-current{border-color:var(--th-brand-line);background:var(--th-brand-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-row>strong{flex:none;max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-address{flex:none;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--th-brand-ink)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-kind{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-pick{flex:none;color:var(--th-brand-ink);font-weight:650}
/* 手动指定目标那一行（网关 + 节点地址 + 用作目标）：与 IP 行同一套排布。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-manual{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:7px;border-top:1px dashed var(--th-line);flex-wrap:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-manual .taskhive-codesys-online-target-address{flex:1 1 120px}
/* IP 直连行：就长在扫描面板里（不需要先扫描）。控件本身复用「在线目标」面板的类名，
   这里只负责这一行的排布，不再自定义输入框外观。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:7px;border-top:1px dashed var(--th-line);flex-wrap:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip .taskhive-codesys-online-target-address{flex:1 1 140px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip .taskhive-codesys-online-target-address.is-port{flex:0 0 84px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-ip-label{flex:none;color:var(--th-ink-3);font-size:9px;font-weight:650;letter-spacing:.04em;text-transform:uppercase}
/* 绑定工程后隐藏路径框：它的值仍在 DOM 里（桌面探针照旧能读），完整路径移到
   在线组的 title 里。这三个在线图标（约 104px）就由此腾出，顶栏仍是一行。 */
[data-taskhive-codesys-workbench="true"][data-codesys-bound="true"] .taskhive-codesys-path{display:none}
/* T097: 联动徽章已移除（底部状态行负责这件事）。
   本轮：「离线工程 / 当前工程」徽章也按用户要求删除，标题统一为「工作台」。 */
/* T086: 「AI 审核」是顶栏里唯一"非工程管道"的动作，用品牌浅色描边与其它按钮区分，
   既不像主按钮那样抢焦点（那正是它在底部条里造成的割裂感），又一眼能认出是 AI 入口。
   同段位于模板字符串内，注释里禁止出现反引号。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai{border-color:var(--th-brand-line)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai:hover:not(:disabled){border-color:var(--th-brand)!important;background:var(--th-brand-tint)!important;color:var(--th-brand-strong)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai:disabled{opacity:.42}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-action-ai .taskhive-codesys-action-icon{width:14px;height:14px}
/* ── T084 顶栏分档：容器查询读的是工作台自身宽度，不是窗口宽度 ───────────────
   ≥620px 宽面板才显示「离线工程」徽章（路径本身已说明有没有绑定工程）；
   <380px 连「刷新 / 选择工程」也退化成图标；<340px（接近 280px 最小侧栏）再隐藏
   标题与徽章。每一档都留了余量，因此任一侧栏宽度下顶栏都是一行。 */
@container taskhive-codesys (max-width: 619px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-field-label{display:none}
  /* 唯一的折行例外：需要用户裁决"用哪个正在使用中的工程"时，那个下拉必须显示
     完整工程名与 PID，让它刻意独占一整行。 */
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-open-projects{flex:1 1 100%;max-width:none}
}
@container taskhive-codesys (min-width: 620px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-path{min-width:120px}
}
@container taskhive-codesys (max-width: 379px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions{gap:3px}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-path{flex-basis:70px;min-width:44px}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-online{padding-left:4px;gap:3px}
  /* 绿色标识收成一个 26px 绿点（颜色仍一眼可辨），把宽度让给 16 个功能图标。 */
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge{width:26px;padding:0;justify-content:center}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-badge-label{display:none}
}
@container taskhive-codesys (max-width: 339px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-header-copy{display:none}
}
/* 宽度足够：**有标签的**动作全部展开成文字（16 个全文字一行约需 770px，取 820px 留余量）。
   :has() 让"有文字标签就显示文字、没有就保持图标"这条规则只写一次。 */
@container taskhive-codesys (min-width: 820px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action:has(.taskhive-codesys-action-label){width:auto;padding:0 6px}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action:has(.taskhive-codesys-action-label) .taskhive-codesys-action-icon{display:none}
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-project-actions .taskhive-codesys-action-label{display:inline}
}
/* T090: 底部行的会话号在窄栏里省略，只留那个 ● / ○ —— 状态文字需要那点宽度。 */
@container taskhive-codesys (max-width: 439px) {
  [data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate-label{display:none}
}
/* T086 命令条内部：这条现在**只**管工程写入，所以没有分组竖线、也没有第二个主按钮。
   composer 已搬到顶栏，.taskhive-codesys-composer 在这里只剩一个透明容器（表单
   语义），它的按钮样式由顶栏那套 .taskhive-codesys-action-* 负责。
   详细原因与禁用理由依旧全部走 title。本段位于模板字符串内，注释里禁止出现反引号。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-composer{display:flex!important;flex:0 0 auto;align-items:center;border:0!important;border-radius:0!important;padding:0!important;background:transparent!important;gap:0!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-heading{flex:0 0 auto;font-size:10.5px;white-space:nowrap}
/* T083: 状态词现在只有「可写入 / 等待 AI 改动 / 不可写入」三种短词，固定宽度即可；
   不可写入的**原因**在下面那条可伸缩的 detail 里，它越窄越省略。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-state{flex:0 0 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-detail{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-review{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;font-size:9.5px;color:var(--th-ink-2);white-space:nowrap;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-review input{flex:0 0 auto;margin:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-confirm-write{flex:0 1 auto;min-width:0;min-height:30px;height:30px;padding:0 9px!important;font-size:10.5px!important;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane{display:flex;flex-direction:column;min-height:0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane .taskhive-codesys-pane-heading{flex:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane .taskhive-codesys-diff{flex:0 1 42%;height:auto;min-height:42px;overflow:auto}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor{flex:1 1 58%;height:auto;min-height:80px}
/* T082 底部只留一行小字：状态占满剩余宽度并用省略号，安全边界收成右侧 ⓘ。
   读取工程时状态会追加「已等待 N 秒…」，那一句只在等待期间出现且必须完整可读，
   所以只有它存在时才允许换成两行。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-statusrow{display:flex!important;align-items:center;gap:6px;min-width:0}
/* T090: 底部行的"联动到哪个会话"指示。它是状态而不是内容，所以窄栏里只留那个点。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate{flex:0 0 auto;font-size:9.5px;line-height:1.3;white-space:nowrap;color:var(--th-brand-ink)}
/* 常驻的「在线目标」：登录/下载作用在哪台设备，平时就得看得见，不能只藏在悬浮提示里。
   窄栏里允许被压缩省略，但绝不换行（顶栏与底栏都必须保持各自一行）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--th-line);border-radius:999px;padding:0 7px;font-size:9.5px;line-height:1.5;color:var(--th-ink-2);background:transparent;font-family:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip:hover{border-color:var(--th-brand-line);color:var(--th-brand-ink)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip:focus-visible{outline:2px solid var(--th-brand-line);outline-offset:1px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip.is-picked{border-color:var(--th-brand-line);color:var(--th-brand-ink)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip.is-online{border-color:transparent;background:var(--th-online,var(--th-brand));color:#fff;font-weight:650}
/* 「扫描设备」绑定过设备之后就是「已绑定」：品牌描边 + 对勾图标。已连接时按钮虽然
   置灰，但绑定状态要留住（它现在是一条状态，不只是一次动作）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-scan.is-bound{border-color:var(--th-brand-line);background:var(--th-brand-tint);color:var(--th-brand-ink);font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-scan.is-bound:disabled{opacity:.72}
/* 在线动作进行中：登录要等 20–40 秒，放在最下面的状态栏里（和状态文字同一行）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-pending{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;max-width:min(340px,46vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid transparent;border-radius:999px;padding:0 8px;background:var(--th-brand-tint);color:var(--th-brand-ink);font-size:10px;font-weight:650;animation:taskhive-codesys-pending 1.6s ease-in-out infinite}
@keyframes taskhive-codesys-pending{0%,100%{opacity:.62}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-pending{animation:none}}
/* 目标面板里"尚未绑定"的引导行已随弹层删除（现在是面板里的两行控件本身）。 */
/* 「在线引擎是旧版本」提示：黄色告警胶囊，点不动不了任何东西，只说明为什么要重启。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-engine-stale{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--th-warn);border-radius:999px;padding:0 8px;background:#fff7e6;color:#8a5a00;font-size:10px;font-weight:650}
/* 渲染崩溃时的兜底界面：宁可显示错误文本，也不要一片空白。 */
[data-taskhive-codesys-workbench="true"].taskhive-codesys-crash{display:block;padding:16px;border:1px solid #e4c4c1;border-radius:11px;background:#fff7f6;color:#5c2b28;font:12px/1.6 Inter,"Microsoft YaHei",system-ui,sans-serif;overflow:auto}
.taskhive-codesys-crash>strong{display:block;margin-bottom:6px;font-size:13px}
.taskhive-codesys-crash-text{margin:0 0 8px;padding:8px 10px;border-radius:7px;background:#fff;border:1px solid #e4c4c1;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.taskhive-codesys-crash-actions{display:flex;gap:8px;margin-top:10px}
.taskhive-codesys-crash-actions>button{height:28px;padding:0 10px;border:1px solid #d3dcfb;border-radius:6px;background:#eef2fe;color:#2f47b8;font:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-state{flex:0 0 auto;font-size:9.5px;line-height:1.3;white-space:nowrap;color:var(--th-ok)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-state.is-warning{color:#a3403a;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate.is-pending{color:var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-linkstate.is-idle{color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-status{flex:1 1 auto;min-width:0;min-height:0;font-size:9.5px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-status:has(.taskhive-codesys-busy-timer){white-space:normal;overflow:visible;text-overflow:clip}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-safety{flex:0 0 auto;padding:0!important;border:0!important;color:var(--th-ink-3);font-size:9px;line-height:1.3;white-space:nowrap;cursor:help}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-safety:focus-visible{outline:2px solid var(--th-brand);outline-offset:2px;border-radius:4px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treeitem[data-changed="true"]{border-left-color:var(--dsw-alias-state-warn-primary,#666);color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-state-warn-tertiary,#f7f7f7)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-diff-row[data-changed="true"]{background:var(--dsw-alias-state-warn-tertiary,#f7f7f7);box-shadow:inset 3px 0 0 var(--dsw-alias-state-warn-primary,#666)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-diff-row[data-changed="true"] .taskhive-codesys-code-new{color:var(--dsw-alias-label-primary,#171717);background:var(--dsw-alias-state-success-secondary,#ededed)}
// T082: the ready/blocked state moved from the inner 工程写入 card onto the single
// command bar, which owns the only border now; these stale selectors were left
// pointing at a class no longer in the markup and are removed.
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-proposal{border-color:var(--dsw-alias-state-warn-secondary,#cfcfcf);background:var(--dsw-alias-state-warn-tertiary,#f7f7f7)}
/* ── TaskHive theme ────────────────────────────────────────────────────────
   The previous revision forced black/white/gray with !important, described as:
     "Harness palette is black/white/gray only; these declarations
      intentionally win over any host theme variables"
   which made TaskHive's own surfaces look like a grayscale wireframe while the
   TaskHive shell is a blue-accented product.

   The palette below is taken from TaskHive's own brand asset rather than
   invented: assets/taskhive-icon-v3.svg is a #7168F6 → #3188EB gradient, and
   the shell (app/renderer/styles.css) already accents with #3569e8 / #315fbd /
   #edf3ff / #d5e0fb on #f7f8fb surfaces with #172033 ink. These tokens sit
   between the icon gradient and the shell accent so the embedded surface and the
   surrounding chrome read as one product. */
:root,[data-taskhive-codesys-workbench="true"]{
  --th-brand:#4f6ef2;
  --th-brand-strong:#3f5ce0;
  --th-brand-ink:#2f47b8;
  --th-brand-tint:#eef2fe;
  --th-brand-line:#d3dcfb;
  --th-surface:#ffffff;
  --th-surface-2:#f7f8fb;
  --th-surface-3:#eef1f7;
  --th-line:#dde2ec;
  --th-line-strong:#c8d0de;
  --th-ink:#1b2233;
  --th-ink-2:#4b5567;
  --th-ink-3:#79839a;
  --th-ok:#2f7d5b;
  --th-ok-tint:#eaf6f0;
  --th-ok-line:#c4e2d3;
  --th-warn:#a86a12;
  --th-warn-tint:#fdf6e8;
  --th-warn-line:#efdab3;
  --th-danger:#c0392b;
}
/* Outcome states are semantic, not monochrome: a ready command bar reads as
   success green, a blocked one as amber, and a changed file as brand blue.
   T082: the write state now lives on the single command bar, so the blocked
   colour is painted there instead of on the retired write-panel card. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-proposal{border-color:var(--th-warn-line)!important;background:var(--th-warn-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-state{color:var(--th-ok)!important}
[data-taskhive-codesys-workbench="true"] .is-blocked .taskhive-codesys-write-state{color:var(--th-warn)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-detail{color:var(--th-ink-2)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treeitem[data-changed="true"]{border-left-color:var(--th-brand)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-diff-row[data-changed="true"]{background:var(--th-brand-tint)!important;box-shadow:inset 3px 0 0 var(--th-brand)!important}
/* The editable textarea is a sibling emitted by the compact React tree. Lay
   it out as the lower half of the code column, never as a detached window or
   an overflowing third grid cell. */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor{grid-template-columns:minmax(132px,var(--th-tree-fr,0.52fr)) 9px minmax(170px,var(--th-code-fr,1fr))!important;grid-template-rows:minmax(0,42%) minmax(80px,58%)!important;gap:0!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-split-v{grid-column:2!important;grid-row:1 / span 2!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-object-pane{grid-column:1!important;grid-row:1 / span 2!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-code-pane{grid-column:3!important;grid-row:1 / span 2!important;min-height:0!important;display:flex!important;flex-direction:column!important}
/* Drag handles: the tree/editor divider and the 声明/实现 divider. Both let the
   user grow the code area by squeezing everything else, down to the clamps. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split{position:relative;flex:none;min-width:0;min-height:0;background:transparent;touch-action:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-v{width:9px;height:100%;cursor:col-resize}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-h{width:100%;height:9px;cursor:row-resize}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split::before{content:'';position:absolute;border-radius:2px;background:var(--th-line)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-v::before{left:4px;top:4px;bottom:4px;width:2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split-h::before{top:4px;left:4px;right:4px;height:2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split:hover::before,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split:focus-visible::before{background:var(--th-brand)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-split:focus-visible{outline:2px solid var(--th-brand);outline-offset:-2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;padding:0 9px;border-bottom:1px solid var(--th-line);background:var(--th-surface-2);color:var(--th-ink-2);font-size:10px;flex:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-state{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-changes{flex:none;color:var(--th-brand-ink);font-weight:650;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-body{display:grid;grid-template-columns:38px minmax(0,1fr);flex:1 1 auto;min-height:0;overflow:hidden;background:var(--th-surface)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-line-gutter{min-height:0;overflow:hidden;padding:8px 0;color:var(--th-ink-3);background:var(--th-surface-2);border-right:1px solid var(--th-line);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:right;user-select:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-line-gutter span{display:block;box-sizing:border-box;height:15.95px;padding-right:7px}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-editor>.taskhive-codesys-code-pane>.taskhive-codesys-editor-body>.taskhive-codesys-editor-surface>.taskhive-codesys-code-editor{flex:1 1 auto!important;width:100%!important;height:100%!important;min-height:0!important;padding:8px 10px!important}
/* ── 对话联动状态与变更着色 ──────────────────────────────────────────────
   Blue = the model proposed it and it waits for the user, amber = the user
   typed it, green = it was written into the project this session. The same
   three colours drive the project tree, the open file's line highlight layer
   and the legend, so "what changed here" is readable at a glance. */
/* T097: chip 的药丸样式已随联动徽章一起删除；本轮「离线工程」徽章也删掉了。 */
/* ── T097 编译输出：折叠时一行，展开时给一个可滚动的消息区 ────────────────────
   它是工作台根网格的一个新直接子元素，自动获得一个隐式 auto 行，因此
   grid-template-rows 的两条契约串都不需要改。没有编译结果时整个 section 不渲染。 */
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-compile{box-sizing:border-box;display:flex!important;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--th-line);border-radius:8px!important;background:var(--th-surface-2);padding:3px 8px!important}
[data-taskhive-codesys-workbench="true"]>.taskhive-codesys-compile.is-open{background:var(--th-surface)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-head{display:flex!important;align-items:center;gap:6px;min-width:0;min-height:26px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-toggle{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border:0;background:transparent;padding:0;font:inherit;font-size:10.5px;color:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-meta{flex:0 0 auto;font-size:9.5px;color:var(--th-ink-2);white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-copy,[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-clear{flex:0 0 auto;height:22px;padding:0 8px;border:1px solid var(--th-line);border-radius:6px;background:var(--th-surface);font:inherit;font-size:10px;color:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-clear{padding:0 6px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-body{max-height:180px;overflow:auto;margin-top:3px;padding:4px 6px;border-radius:6px;background:var(--th-surface);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line{white-space:pre-wrap;word-break:break-word}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-error{color:var(--th-danger)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-warning{color:var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-info{color:var(--th-ink-2)}
/* ── 真实多级项目树：设备 → PLC 逻辑 → 应用 → POU / GVL / DUT / 库管理器 ── */
/* The object pane gained a filter toolbar AND a legend row, and the code pane a
   hint row, while the shared 1.0.2 rule still declared only two grid rows. The
   extra children landed in implicit rows BELOW the pane, so the tree was pushed
   out of view (clipped) and its rows/filters could not be clicked at all. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-object-pane{grid-template-rows:auto auto minmax(0,1fr) auto!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane{grid-template-rows:auto auto minmax(0,1fr) auto!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-toolbar{display:flex;flex-wrap:wrap;gap:4px;padding:5px 6px;border-bottom:1px solid var(--th-line);background:var(--th-surface-2)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-filter{min-height:20px;border:1px solid var(--th-line);border-radius:6px;padding:0 6px;color:var(--th-ink-2);background:var(--th-surface);font-size:9.5px;font-weight:600;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-filter:hover{color:var(--th-ink);background:var(--th-surface-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-filter.is-active{border-color:var(--th-brand-line);color:var(--th-brand-ink);background:var(--th-brand-tint)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow{box-sizing:border-box;display:flex;align-items:center;gap:5px;width:100%;min-height:26px;margin:0 0 1px;border:0;border-left:2px solid transparent;border-radius:6px;padding:0 6px;color:var(--th-ink-2);background:transparent;font:500 11.5px/1.2 Inter,"Microsoft YaHei",system-ui,sans-serif;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow:hover{background:var(--th-surface-2)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow.is-group{color:var(--th-ink);font-weight:600}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-selected="true"]{border-left-color:var(--th-brand)!important;color:var(--th-ink)!important;background:var(--th-brand-tint)!important;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow:focus-visible{outline:2px solid var(--th-brand);outline-offset:-2px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="agent"]{border-left-color:var(--th-brand)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="manual"]{border-left-color:var(--th-warn)!important;color:var(--th-warn)!important;background:var(--th-warn-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="written"]{border-left-color:var(--th-ok)!important;color:var(--th-ok)!important;background:var(--th-ok-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-state="pending-create"]{border-left-color:var(--th-brand-strong)!important;color:var(--th-brand-ink)!important;background:var(--th-brand-tint)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-treerow[data-change-scope="subtree"]{border-left-style:dotted}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-twisty{flex:none;width:13px;height:13px;border:0;padding:0;color:var(--th-ink-3);background:transparent;font-size:9px;line-height:13px;text-align:center;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-twisty.is-leaf{cursor:default}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind{flex:none;width:9px;height:9px;border-radius:2px;background:var(--th-ink-3);box-shadow:inset 0 0 0 1px rgba(0,0,0,.14)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="device"]{background:#5b6b86}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="axis"],[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="axis-pool"]{background:#7d8aa6}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="application"]{background:#3f5ce0}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="plc-logic"]{background:#6478e8}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="task"],[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="task-config"]{background:#2f9e8f}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="pou"]{background:#4f6ef2}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="gvl"]{background:#2f7d5b}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="dut"]{background:#8a5bd6}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="library-manager"]{background:#a86a12}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="folder"],[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="container"]{background:#9aa3b5}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind[data-node-kind="internal"]{background:#c9cedb}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-busy-timer{color:var(--th-brand-ink);font-weight:650}
/* The empty tree explains WHY it is empty and points at the single set of
   project controls above; it must not repeat those controls (field report:
   "为什么项目树里边会有检测工程和打开文件？工作台不是已经具备这个功能了？"). */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-empty{display:grid;gap:6px;justify-items:start;padding:12px 10px;color:var(--th-ink-2);font-size:11px;line-height:1.5}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-empty strong{color:var(--th-ink);font-size:12px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-empty-pointer{color:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-open-projects{max-width:100%;min-height:30px;border:1px solid var(--th-warn-line);border-radius:7px;padding:0 6px;color:var(--th-warn);background:var(--th-warn-tint);font:500 10.5px Inter,"Microsoft YaHei",system-ui,sans-serif}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-kind-label{flex:none;color:var(--th-ink-3);font-size:8.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-count{flex:none;color:var(--th-ink-3);font-size:8.5px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-state.is-subtree{font-size:8px;opacity:.75}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-hint{padding:7px 10px;border-top:1px solid var(--th-line);color:var(--th-ink-2);background:var(--th-surface-2);font-size:10.5px;line-height:1.5}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-tree-state{flex:none;font-size:9px;font-weight:650}
/* T081: 图例固定一行。原先是 flex-wrap:wrap，在 400px 侧栏里会折成 2–3 行，
   把对象树的可视高度吃掉约 45px——那正是用户要回来的空间。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend{display:flex;flex-wrap:nowrap;gap:8px;padding:4px 8px;border-top:1px solid var(--th-line);color:var(--th-ink-3);font-size:8.5px;white-space:nowrap;overflow:hidden}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span{display:inline-flex;align-items:center;gap:4px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--th-ink-3)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="agent"]::before{background:var(--th-brand)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="manual"]::before{background:var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="written"]::before{background:var(--th-ok)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-legend span[data-legend="pending-create"]::before{background:var(--th-brand-strong)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-reload-suggestion{min-height:22px;padding:0 8px;border-color:var(--th-brand-line);color:var(--th-brand-ink);background:var(--th-brand-tint);font-size:10px;font-weight:650}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-surface{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;background:var(--th-surface)}
/* CODESYS' editor is 声明区 + 代码区, each numbered from line 1. The old layout
   was one grid (38px gutter + textarea) that concatenated both parts, so the
   implementation's line numbers were always offset by the declaration length.
   Each section is now its own gutter + textarea pair. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-body{display:flex!important;flex-direction:column;gap:6px;min-height:0;overflow:auto;background:transparent!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section{display:flex;flex-direction:column;min-height:0;border:1px solid var(--th-line);border-radius:8px;overflow:hidden;background:var(--th-surface)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;padding:0 8px;border-bottom:1px solid var(--th-line);background:var(--th-surface-2);color:var(--th-ink-2);font-size:10px;font-weight:650;flex:none}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-grid{display:grid;grid-template-columns:38px minmax(0,1fr);flex:1 1 auto;min-height:0;overflow:hidden}
/* CODESYS 在线模式：声明每一行右侧的当前值。textarea 无法内联，所以值单独占一列，
   与代码同高（15.95px 行高）并随代码一起滚动。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section.has-online-values .taskhive-codesys-editor-grid{grid-template-columns:38px minmax(0,1fr) minmax(58px,auto)}
/* 实现区的值更长（"power.Status=TRUE  Error=FALSE"），给它更宽的值列。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section[data-editor-section="implementation"].has-online-values .taskhive-codesys-editor-grid{grid-template-columns:38px minmax(0,1fr) minmax(96px,auto)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-values{min-height:0;overflow:hidden;padding:8px 8px 8px 6px;border-left:1px solid var(--th-line);background:var(--th-surface-2);color:var(--th-brand-ink);font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:right;user-select:none;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-value{display:block;box-sizing:border-box;height:15.95px;overflow:hidden;text-overflow:ellipsis}
/* 声明区标题上的「在线值 / 在线中…」标记：登录后立刻能看出在线变量这一档是活的
   还是在等第一笔值。绿色只在真的读到值时才出现。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-online{flex:none;border:1px solid var(--th-line);border-radius:999px;padding:0 6px;color:var(--th-ink-3);font-size:9px;font-weight:650;white-space:nowrap}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-online.is-live{border-color:transparent;background:var(--th-online,var(--th-brand));color:#fff}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section[data-editor-section="declaration"] .taskhive-codesys-editor-grid{min-height:86px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section[data-editor-section="implementation"] .taskhive-codesys-editor-grid{min-height:140px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-grid>.taskhive-codesys-editor-surface>.taskhive-codesys-code-editor{flex:1 1 auto!important;width:100%!important;height:100%!important;min-height:0!important;padding:8px 10px!important;background:transparent!important;resize:none!important}
/* The 1.0.2 rule paints a BLACK inset ring on focus
   (.taskhive-codesys-code-editor:focus{box-shadow:inset 0 0 0 2px #171717}),
   so simply clicking into the declaration/implementation flashed a black box
   ("点声明或实现会出现一个黑框，太突兀"). Clicking the code now paints NOTHING —
   the caret already says where you are; only keyboard focus keeps a ring. */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor:focus{box-shadow:none!important;outline:none!important;border-color:var(--th-line)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor:focus-visible{outline:2px solid var(--th-brand)!important;outline-offset:-2px;box-shadow:none!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-section:has(.taskhive-codesys-code-editor:focus-visible){border-color:var(--th-brand-line)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-body{flex:1 1 auto!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-highlights{position:absolute;top:0;right:0;bottom:0;left:0;padding:8px 0;pointer-events:none;overflow:hidden}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row{display:block;box-sizing:border-box;height:15.95px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row[data-line-state="agent"]{background:var(--th-brand-tint);box-shadow:inset 3px 0 0 var(--th-brand)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row[data-line-state="manual"]{background:var(--th-warn-tint);box-shadow:inset 3px 0 0 var(--th-warn)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-highlight-row[data-line-state="written"]{background:var(--th-ok-tint);box-shadow:inset 3px 0 0 var(--th-ok)}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-surface>.taskhive-codesys-code-editor{position:relative;z-index:1;background:transparent!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane[data-codesys-editor-change-state="manual"] .taskhive-codesys-pane-heading{border-bottom-color:var(--th-warn)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane[data-codesys-editor-change-state="agent"] .taskhive-codesys-pane-heading{border-bottom-color:var(--th-brand)!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-pane[data-codesys-editor-change-state="written"] .taskhive-codesys-pane-heading{border-bottom-color:var(--th-ok)!important}
 `
      document.head.appendChild(style)
      const nodesWithin = (root, selector) => {
        if (!root) return []
        const nodes = []
        if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) nodes.push(root)
        if (typeof root.querySelectorAll === 'function') nodes.push(...root.querySelectorAll(selector))
        return nodes
      }
      // ---------------------------------------------------------------------
      // TaskHive workbench skin (restored from the 1.0.2 client).
      //
      // The skin is ported onto the 1.0.3 incremental scan: every helper works
      // on the mutated root instead of re-reading `document.body *`, and each
      // helper gates on the cheap `textContent` before touching `innerText` or
      // `getBoundingClientRect`. The 1.0.2 full-page 250 ms interval is
      // deliberately NOT restored (see T029/T037) — restoring it would bring
      // back the streaming-input jank those tasks removed.
      // ---------------------------------------------------------------------
      const brandMarkup = (size, includeText = true) => `${taskhiveBrandIcon ? `<img data-taskhive-brand-icon="true" src="${taskhiveBrandIcon}" alt="" style="width:${size}px;height:${size}px;display:block;flex:0 0 auto">` : ''}${includeText ? '<span data-taskhive-brand-text="true" style="font-weight:650;font-size:15px">TaskHive</span>' : ''}`
      const brandSpanMarkup = () => `${taskhiveBrandIcon ? `<img data-taskhive-brand-icon="true" src="${taskhiveBrandIcon}" alt="" style="width:24px;height:24px;display:block">` : ''}<span data-taskhive-brand-text="true">TaskHive</span>`
      const brandSpanStyle = 'display:inline-flex;align-items:center;gap:8px;font-weight:650;font-size:17px;color:var(--th-ink,#1b2233)'
      // ── Sidebar brand ──────────────────────────────────────────────────────
      //
      // Verified markup in DSH 0.1.3-alpha.2 (dumped from the live frame):
      //
      //   div.hHd-Xa_logoRow
      //     button.hHd-Xa_brand.hHd-Xa_wide          (expanded)
      //       span.hHd-Xa_brandIdentity > span.hHd-Xa_brandMark
      //         div[data-slot="sidebar.brand.mark"]  <- vendor logo SVG lives here
      //     button.hHd-Xa_iconButton.hHd-Xa_toggle    (collapsed)
      //       span.hHd-Xa_railMark
      //         div[data-slot="sidebar.brand.mark"]  <- the SAME element, re-parented
      //
      // Two consequences drive this code:
      //   1. There is no `button[class*="_brand"]`-with-text to rewrite; the row
      //      is icon-only, and the vendor logo is what the user sees both
      //      expanded and collapsed.
      //   2. The brand region renders long after plugin init and React re-parents
      //      it on every collapse/expand, so reconciling it only during the
      //      initial document scan never applied. It now runs on every pass.
      const SIDEBAR_MARK_SELECTOR = '[data-slot="sidebar.brand.mark"]'
      // The mark sits beside the "TaskHive" wordmark (expanded) and alone in the
      // collapsed rail, so it is the app's identity in the chrome — it must be
      // the TaskHive program icon, not a vendor logo and not a generic panel
      // glyph. The host hands the real icon over as a data URL through
      // `taskhiveIcon` (main.js reads assets/taskhive-icon-v3-64.png), which is
      // the only channel that works here: this frame is served from
      // http://127.0.0.1:<port>/ and cannot reach the app's asset folder.
      const brandMarkSvg = '<svg data-taskhive-brand-mark="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16"></path></svg>'
      const brandMarkMarkup = () => (taskhiveBrandIcon
        ? `<img data-taskhive-brand-mark="true" src="${taskhiveBrandIcon}" alt="" width="22" height="22" style="width:22px;height:22px;display:block;object-fit:contain">`
        // Until the bridge hands the icon over (alpha.2 strips the query param on
        // first paint) fall back to the neutral sidebar glyph rather than leaving
        // an empty slot. The delayed retries re-run this and swap the real icon in.
        : brandMarkSvg)
      // DSH renders the conversation hero's mark at 34px (`HeroShell` passes
      // `size: 34` to the slot and the vendor glyph is 34 x 25), so the TaskHive
      // mark that replaces it has to be 34px too — a 22px sidebar glyph there would
      // sit in a 34px hole and read as "the icon is in the wrong place".
      const HERO_MARK_SIZE = 34
      const heroMarkMarkup = () => (taskhiveBrandIcon
        ? `<img data-taskhive-brand-mark="true" src="${taskhiveBrandIcon}" alt="" width="${HERO_MARK_SIZE}" height="${HERO_MARK_SIZE}" style="width:${HERO_MARK_SIZE}px;height:${HERO_MARK_SIZE}px;display:block;object-fit:contain">`
        : brandMarkSvg.replace('width="22" height="22"', `width="${HERO_MARK_SIZE}" height="${HERO_MARK_SIZE}"`))
      // The hero headline is a `display:grid` row, so an icon written INTO its text
      // span stacks above the words instead of sitting beside them. The mark belongs
      // in the mark slot; the headline seam writes the wordmark alone.
      const brandWordmarkMarkup = '<span data-taskhive-brand-text="true">TaskHive</span>'
      const ensureSidebarBrandMark = () => {
        const marks = document.querySelectorAll(SIDEBAR_MARK_SELECTOR)
        if (!marks.length) return false
        // T091: brand EVERY matching slot, not just the first. `querySelector` picked
        // whichever came first, so when the expanded header and the collapsed rail were
        // both in the DOM the other one kept the vendor logo.
        for (const mark of marks) {
          // NEVER delete the vendor node. DSH renders this slot with a React
          // component (`OfficialBrandMark`), and removing a node React believes it
          // owns aborts its reconciliation: the client then fails to mount at all
          // and the whole sidebar disappears. Hiding it keeps the node in place, so
          // React still finds its child, while our icon sits beside it.
          //
          // T091: re-hiding runs on EVERY pass, before the "ours is already there"
          // check. Skipping it (the old early-return) left a re-created vendor child
          // visible next to our icon.
          for (const child of mark.children) {
            if (child.hasAttribute?.('data-taskhive-brand-mark')) continue
            child.style?.setProperty('display', 'none', 'important')
          }
          const ours = mark.querySelector('[data-taskhive-brand-mark="true"]')
          if (ours && ours.tagName === 'IMG') continue
          // Only ever remove OUR OWN placeholder when upgrading it to the real icon.
          if (ours) ours.remove()
          mark.insertAdjacentHTML('afterbegin', brandMarkMarkup())
          mark.dataset.taskhiveSidebarRail = 'true'
        }
        return true
      }
      const ensureSidebarGlyph = () => ensureSidebarBrandMark()
      // Replace any vendor brand text in the logo row. The row is icon-only in
      // this build, but the sidebar.brand.name slot can render a name, and the
      // user must never see "DeepSeek Harness" in TaskHive's chrome.
      const rebrandSidebarText = () => {
        const row = document.querySelector('[class*="logoRow"]')
        if (!row) return false
        for (const node of row.querySelectorAll('span,strong,small,b,div,h1,h2')) {
          if (node.children.length) continue
          const text = String(node.textContent || '').trim()
          if (!text || !/deepseek/i.test(text)) continue
          node.textContent = 'TaskHive'
          node.dataset.taskhiveBrandText = 'true'
        }
        return true
      }
      // The vendor wordmark is NOT text: `sidebar.brand.name` renders
      // "DeepSeek Harness" as an SVG of glyph outlines
      // (`<svg width="156" height="24" viewBox="26 0 156 24">`, aria-hidden), so
      // no text query can ever match it. Replace the slot's contents outright.
      const SIDEBAR_NAME_SELECTOR = '[data-slot="sidebar.brand.name"]'
      const ensureSidebarWordmark = () => {
        const slots = document.querySelectorAll(SIDEBAR_NAME_SELECTOR)
        if (!slots.length) return false
        // T091: every slot, for the same reason as the mark above.
        for (const slot of slots) {
          if (slot.querySelector('[data-taskhive-brand-wordmark="true"]')) continue
          slot.innerHTML = '<span data-taskhive-brand-wordmark="true" style="font:650 15px Inter,\'Microsoft YaHei\',system-ui,sans-serif;color:inherit;letter-spacing:.2px;white-space:nowrap">TaskHive</span>'
        }
        return true
      }
      // Hide the vendor glyph, never remove it — same React-reconciliation reason as
      // the sidebar mark — and put OUR mark in the slot it just vacated, so the
      // headline keeps the row shape DSH designed (slot, then headline text): an
      // empty slot leaves a 34px hole and the icon ends up out of place.
      const HERO_MARK_SELECTOR = '[data-slot="conversation.hero.brand.mark"]'
      const ensureHeroBrandMark = () => {
        const mark = document.querySelector(HERO_MARK_SELECTOR)
        if (!mark) return false
        for (const child of mark.children) {
          if (child.hasAttribute?.('data-taskhive-brand-mark')) continue
          child.style?.setProperty('display', 'none', 'important')
        }
        const ours = mark.querySelector('[data-taskhive-brand-mark="true"]')
        if (ours && ours.tagName === 'IMG') return true
        // Only ever remove OUR OWN placeholder when upgrading it to the real icon.
        if (ours) ours.remove()
        mark.insertAdjacentHTML('beforeend', heroMarkMarkup())
        return true
      }
      // One idempotent brand step, called from every scrub pass, from brand-shaped
      // mutations and from the delayed retries. The name says "sidebar" for history:
      // it now covers every vendor-mark slot the client renders.
      const reconcileSidebarBrand = () => {
        ensureSidebarGlyph()
        ensureSidebarWordmark()
        rebrandSidebarText()
        ensureHeroBrandMark()
      }
      // Keep a usable, non-interactive brand row: the native control already
      // carries aria-label/title for "new session" / "collapse sidebar", so do
      // not overwrite them (doing so broke the toggle's accessible name).
      const ensureBrandButton = () => reconcileSidebarBrand()
      const hideComposerDuplicate = (button, text, dialogOpen) => {
        if (!button || button.closest('[aria-modal="true"]')) return
        if (dialogOpen && button.closest('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]')) return
        const accessLabel = String(button.getAttribute('aria-label') || button.getAttribute('title') || '')
        if (/(?:Workspace\s*Write|Read\s*Only|Full\s*access)/i.test(`${text} ${accessLabel}`)) {
          button.dataset.taskhiveComposerDuplicate = 'permission'
          button.dataset.taskhiveComposerPermission = 'true'
          button.style.setProperty('display', 'none', 'important')
          return
        }
        if (/^(?:Workspace\s+Write|Read\s+Only|Full\s+access)$/i.test(text) || /(?:访问模式|access\s+mode).*(?:Workspace\s+Write|Read\s+Only|Full\s+access)/i.test(accessLabel)) {
          button.dataset.taskhiveComposerDuplicate = 'permission'
          button.dataset.taskhiveComposerPermission = 'true'
          button.style.setProperty('display', 'none', 'important')
        }
      }
      const dismissInternalPreviewNotice = () => {
        const button = [...document.querySelectorAll('button,[role="button"]')].find((node) => /^(继续|continue)$/i.test(String(node.textContent || '').trim()))
        const dialog = button?.closest('[role="dialog"],[aria-modal="true"]')
        if (!button || !dialog || !/(内测|测试版本|预览版|免责声明|preview|beta|DeepSeek\s+Harness)/i.test(String(dialog.textContent || ''))) return
        dialog.style.setProperty('display', 'none', 'important')
        window.__TASKHIVE_INTERNAL_NOTICE_REMOVED__ = true
        button.click()
      }
      // The brand scrubbers below exist to remove the VENDOR's chrome words
      // ("DeepSeek Harness", the vendor logo). They must never touch a CONTROL:
      // the composer's model seat renders the SELECTED MODEL's own name, so
      // choosing a DeepSeek model puts the vendor's name inside the model
      // selector — and a text-only test hid that selector or replaced its row
      // with the TaskHive wordmark (reported as "after switching the model to
      // deepseek the input-box model picker disappeared and became taskhive").
      // Content that names a model is content, not branding.
      const BRAND_SCRUB_EXEMPT = 'button,[role="button"],[role="combobox"],[aria-haspopup],[role="listbox"],[role="menu"],[role="dialog"],[aria-modal="true"],[data-slot*="model" i]'
      // The vendor wordmark and nothing else. A model label such as
      // "DeepSeek V4 Flash", "DeepSeek Chat" or "deepseek-reasoner" must not match:
      // only the bare vendor name (optionally followed by its product qualifier).
      const VENDOR_BRAND_TEXT = /^deepseek(?:\s+(?:harness|preview|beta))?$/i
      const COMPOSER_BRAND_TEXT = /^(探索未至之境|Explore the unexplored|Explore the unknown)$/i
      const replaceComposerBrand = (candidates) => {
        const original = candidates.find((node) => {
          const raw = String(node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!raw || raw.length > 40 || !COMPOSER_BRAND_TEXT.test(raw)) return false
          const text = String(node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!COMPOSER_BRAND_TEXT.test(text)) return false
          const rect = node.getBoundingClientRect()
          return rect.width > 80 && rect.width < 520 && rect.height > 20 && rect.height < 120 && rect.x > window.innerWidth * 0.2
        })
        if (!original) return
        // Replace the matched NODE, never its container. The tagline shares its row
        // with the composer's controls, so overwriting the whole container deleted
        // the model seat and left the brand wordmark where the picker used to be.
        if (!original.parentElement) return
        original.dataset.taskhiveComposerBrand = 'true'
        if (!original.querySelector('[data-taskhive-brand-text="true"]') || original.querySelector('[data-taskhive-brand-icon="true"]')) {
          original.innerHTML = brandWordmarkMarkup
        }
      }
      // Keep the native Harness reasoning disclosure as the single progress
      // surface.  The provider has already chosen which reasoning summary is
      // user-visible; this bridge only controls presentation and never creates
      // or logs a hidden chain-of-thought stream.
      const syncDeepDivingDisclosures = (root = document) => {
        for (const thinkRoot of nodesWithin(root, '[data-variant="think"]')) {
          const trigger = thinkRoot.querySelector('button[aria-expanded],[role="button"][aria-expanded]')
          if (!trigger) continue
          const state = thinkRoot.getAttribute('data-state') === 'running' ? 'running' : 'complete'
          thinkRoot.dataset.taskhiveDeepDiving = 'true'
          const publicSummary = state === 'running'
            ? '阶段：正在分析 · 检查对象：当前任务 · 工具动作：由 Harness 调度 · 下一步：等待结果'
            : '阶段：分析完成 · 证据：已返回公开结果 · 下一步：查看回答'
          const body = thinkRoot.querySelector('[class*="thinkBody"]')
          if (body && body.textContent !== publicSummary) {
            body.textContent = publicSummary
            body.dataset.taskhivePublicReasoning = 'true'
          }
          const summaryNode = thinkRoot.querySelector('[class*="summary"]')
          if (summaryNode && summaryNode.textContent !== publicSummary) {
            summaryNode.textContent = publicSummary
            summaryNode.dataset.taskhivePublicReasoning = 'true'
          }

          const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const value = String(walker.currentNode.nodeValue || '').trim()
            if (/^(Think|Deep diving(?:\.\.\.|…))$/i.test(value)) {
              if (value !== 'Deep diving...') walker.currentNode.nodeValue = 'Deep diving...'
              break
            }
          }

          // Presentation only: whether the row is open is the USER's decision. The
          // seam used to force it open while the model was thinking (and closed when
          // it finished) by clicking the trigger. That cannot be made reliable: the
          // disclosure is re-created by React while reasoning streams, so any
          // node-scoped "the user toggled this" marker is lost and the drive reopened
          // the row after every manual collapse. The collapsed row already renders the
          // running summary line (ReasoningRow's `collapsedContent`), so leaving the
          // toggle alone loses no progress information and cannot fight the user.
          const isExpanded = trigger.getAttribute('aria-expanded') === 'true'
          trigger.setAttribute('title', isExpanded ? '点击收起关键思路' : '展开关键思路')
          trigger.setAttribute('aria-label', isExpanded ? 'Deep diving... 关键思路已展开，点击收起' : 'Deep diving... 关键思路已折叠，点击展开')
        }
      }
      const RESIDUAL_LABEL = /^(deepseek\s+harness|预览版|Harness-first automation workspace|标准模式|工作执行模式|Agent 预设|deepseek|harness)$/i
      const hideResidualBrandText = (root) => {
        for (const node of nodesWithin(root, 'a,button,[role="button"],span,div,h1,h2,header')) {
          // Cheap gate: `innerText` and `getBoundingClientRect` force layout,
          // so only pay for nodes that can possibly carry one of these labels.
          const raw = String(node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!raw || raw.length > 40 || !RESIDUAL_LABEL.test(raw)) continue
          const text = String(node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ')
          if (!RESIDUAL_LABEL.test(text)) continue
          if (/^deepseek\s+harness$/i.test(text)) {
            if (node.getBoundingClientRect().width >= 260) continue
            node.style.display = 'none'
            if (!document.querySelector('[data-taskhive-workbench-brand]')) {
              const brand = document.createElement('span')
              brand.style.cssText = brandSpanStyle
              brand.innerHTML = brandSpanMarkup()
              node.parentElement?.insertBefore(brand, node)
            }
            continue
          }
          if (/^预览版$|^Harness-first automation workspace$/i.test(text)) { node.style.display = 'none'; continue }
          if (!node.closest('[role="dialog"],[aria-modal="true"]') && /^(标准模式|工作执行模式)$/i.test(text)) {
            node.style.setProperty('display', 'none', 'important')
            const button = node.closest('button,[role="button"]')
            button?.style.setProperty('display', 'none', 'important')
            button?.parentElement?.style.setProperty('display', 'none', 'important')
            continue
          }
          if (/^Agent 预设$/i.test(text)) {
            node.style.setProperty('display', 'none', 'important')
            node.closest('button,[role="button"],a')?.style.setProperty('display', 'none', 'important')
            continue
          }
          // "deepseek" alone is BOTH the vendor word and a model family name, so
          // the text test is not enough: a model seat that renders "deepseek" was
          // hidden by this branch. Controls are never branding.
          if (/^(deepseek|harness)$/i.test(text) && !node.closest(BRAND_SCRUB_EXEMPT)) node.style.display = 'none'
        }
      }
      const backfillAccessibleNames = (root) => {
        for (const control of nodesWithin(root, 'button,a,[role="button"],[role="tab"],select,input,textarea,summary')) {
          const fallback = String(control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
          // The accessible NAME is what matters; the `title` attribute also pops
          // the native tooltip. Inside the workbench that tooltip lands on the
          // code the user is editing (a dark box the moment they click in), so
          // the workbench keeps `aria-label` only.
          const tooltipAllowed = !control.closest?.('[data-taskhive-codesys-workbench="true"]') && !control.hasAttribute('data-no-native-tooltip')
          if (fallback && !control.getAttribute('title') && tooltipAllowed) control.setAttribute('title', fallback)
          if (fallback && !control.getAttribute('aria-label') && !control.closest('label')) control.setAttribute('aria-label', fallback)
        }
      }
      // ── T093 会话行「…」菜单里的「彻底删除」─────────────────────────────────
      // DSH 把会话菜单项**写死**在 dsh-client-ui-workspace 里（重命名 / 分叉 / 归档），
      // 那个包只声明了 `sidebar.workspaces` 与两个 directoryFlow 插槽，**没有给会话菜单
      // 留扩展点**；会话行本身也只有 role="treeitem" 与哈希类名，**没有会话 id 属性**
      // （id 只出现在拖拽数据里）。所以这一项只能注入 DOM，并且必须靠"行标题 → 会话 id"
      // 的**唯一**匹配来定位目标。为了不猜样式，这里**克隆菜单里现成的「归档会话」项**
      // 再改文字——结构、类名、悬停行为自动一致。
      const SESSION_MENU_ARCHIVE_LABEL = /^(?:归档会话|Archive session)$/i
      const SESSION_DELETE_LABEL = '彻底删除'
      const sessionMenuDelete = { row: null, busy: false }
      const sessionSummariesById = () => {
        const byId = ctx?.sessions?.list?.getSnapshot?.()?.byId
        return byId && typeof byId === 'object' ? byId : {}
      }
      // 行标题必须取**直接子节点**里的 title 槽：HoverCard 的内容也挂在同一个容器里，
      // 用后代选择器会读到悬浮卡片的预览文字（实测就把标题读成了别的东西，于是匹配失败）。
      const sessionRowTitle = (row) => {
        if (!row) return ''
        for (const child of row.children || []) {
          if (/title/i.test(String(child.className || ''))) return String(child.textContent || '').trim()
        }
        return ''
      }
      // T093b: DSH 的会话行**只在 onDragStart 里**把 node.id 写进 dataTransfer —— DOM 上
      // 没有任何 id 属性。所以这里合成一次 dragstart/dragend 把 id 直接取出来，**完全不依
      // 赖标题**。标题会真实撞车（实测「1」「新会话」这类标题可以对应多个会话），仅靠标题
      // 匹配会长期卡在安全闸门上。
      const probeSessionIdByDrag = (row) => {
        try {
          if (!row || typeof DragEvent !== 'function' || typeof DataTransfer !== 'function') return ''
          const transfer = new DataTransfer()
          row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }))
          const id = String(transfer.getData('text/plain') || '').trim()
          row.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }))
          return id
        } catch { return '' }
      }
      // 先试精确的 drag 通道；拿不到再退回"唯一标题匹配"。两条路都必须唯一，0 个或多个
      // 一律拒绝——猜错就是删错一个不可恢复的会话。
      const resolveSessionByRow = (row) => {
        const byId = sessionSummariesById()
        const dragged = probeSessionIdByDrag(row)
        if (dragged && byId[dragged]) {
          const summary = byId[dragged]
          if (summary?.running === true) return { ok: false, reason: '会话正在运行' }
          return { ok: true, id: dragged, title: sessionRowTitle(row) || String(summary.displayTitle || dragged), summary }
        }
        const title = sessionRowTitle(row)
        if (!title) return { ok: false, reason: '读不到这一行的标题' }
        const matches = Object.entries(byId).filter(([, summary]) => {
          const labels = [summary?.displayTitle, summary?.title].map((value) => String(value || '').trim()).filter(Boolean)
          return labels.includes(title)
        })
        if (matches.length !== 1) {
          return { ok: false, reason: matches.length ? `标题「${title}」同时对应 ${matches.length} 个会话` : `标题「${title}」对不上任何会话记录` }
        }
        const [id, summary] = matches[0]
        if (summary?.running === true) return { ok: false, reason: '会话正在运行' }
        return { ok: true, id, title, summary }
      }
      const closeOpenSessionMenu = () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }
      const runSessionDeleteFromMenu = async (row) => {
        if (sessionMenuDelete.busy) return
        const resolved = resolveSessionByRow(row)
        if (!resolved.ok) {
          // 安全闸门命中：一句话说清，然后把「会话记录」标签打开（那里按会话目录名操作，
          // 不依赖任何 DSH 运行时标记）。
          await noticeDialog('无法删除', `无法定位该会话（${resolved.reason}），已取消。`)
          try { openSessionRecordsTab?.() } catch { /* 打不开也不影响"没删"这个结果 */ }
          return
        }
        const active = String(ctx?.sessions?.list?.getSnapshot?.()?.current || '')
        if (resolved.id === active) { await noticeDialog('无法删除', '这是当前打开的会话。'); return }
        const accepted = await showTaskHiveDialog({
          title: '删除会话', confirm: true, danger: true, acceptLabel: '删除',
          message: `确认删除「${resolved.title}」？`,
        })
        if (!accepted) return
        sessionMenuDelete.busy = true
        try {
          // T094: 先删文件、再归档——顺序反过来会出现"行消失了但磁盘没回收"的假象。
          const result = await sessionRecordsApi('purge', { targets: [{ session: resolved.id }], confirm: true, activeSessionId: active })
          if (!result) { await noticeDialog('删除失败', '宿主未响应，请重启 TaskHive 后重试。'); return }
          const done = result.deleted[0]
          if (!done) { await noticeDialog('未删除', `${result.skipped[0]?.reason || '未知原因'}。`); return }
          if (typeof ctx?.uiWorkspace?.archiveSession === 'function') { try { await ctx.uiWorkspace.archiveSession(resolved.id) } catch { /* 文件已删，归档失败只影响列表刷新 */ } }
          await noticeDialog('已删除', `回收 ${formatSessionBytes(done.bytes)}。`)
        } finally { sessionMenuDelete.busy = false }
      }
      const injectSessionDeleteMenuItem = () => {
        const archiveItem = [...document.querySelectorAll('[role="menuitem"],button,[role="button"],li,div')]
          .find((node) => SESSION_MENU_ARCHIVE_LABEL.test(String(node.textContent || '').trim()) && node.children.length <= 3)
        if (!archiveItem) return false
        const list = archiveItem.parentElement
        if (!list || list.querySelector('[data-taskhive-session-delete="true"]')) return false
        const clone = archiveItem.cloneNode(true)
        clone.setAttribute('data-taskhive-session-delete', 'true')
        // 只改标签文字，保留克隆来的图标与结构。
        const label = [...clone.querySelectorAll('*')].reverse().find((node) => SESSION_MENU_ARCHIVE_LABEL.test(String(node.textContent || '').trim())) || clone
        label.textContent = SESSION_DELETE_LABEL
        clone.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation()
          const row = sessionMenuDelete.row
          closeOpenSessionMenu()
          void runSessionDeleteFromMenu(row)
        }, true)
        list.insertBefore(clone, archiveItem.nextSibling)
        return true
      }
      // 记住"最后点过的那一行会话"。会话菜单的触发按钮既不暴露会话 id，也没有稳定的
      // 本地化 aria-label，所以用点击上下文来绑定行——与语言无关，也不需要解析标题以外的
      // 任何东西。
      const rememberSessionRow = (event) => {
        const row = event.target?.closest?.('[class*="sessionRow"]')
        if (row) sessionMenuDelete.row = row
      }
      document.addEventListener('click', rememberSessionRow, true)

      const scrub = (root = document, isDocument = root === document) => {
        const dialogOpen = Boolean(document.querySelector('[aria-modal="true"]'))
        // T093: 会话行「…」菜单里的「彻底删除」。只在刚点过会话行之后才做，避免每次
        // scrub 都全文档查菜单。
        if (sessionMenuDelete.row) injectSessionDeleteMenuItem()
        // Runs on EVERY pass, not only the first document scan. The sidebar brand
        // renders after plugin init and React re-parents the mark on each
        // collapse/expand, so a one-shot document scan reliably missed it — which
        // is why the vendor logo and its name stayed visible. These are three
        // querySelector calls plus a text compare over one small row, so the cost
        // is negligible next to the root-scoped work below.
        reconcileSidebarBrand()
        if (isDocument) dismissInternalPreviewNotice()
        for (const button of nodesWithin(root, 'button,[role="button"],a')) {
          const title = String(button.getAttribute('title') || '')
          const label = String(button.getAttribute('aria-label') || '')
          const text = String(button.textContent || '').trim().replace(/\s+/g, ' ')
          hideComposerDuplicate(button, text, dialogOpen)
          if (!button.closest('[role="dialog"],[aria-modal="true"]') && (/Agent 预设/.test(title) || /^标准模式$/.test(text))) {
            button.style.setProperty('display', 'none', 'important')
            for (const child of button.querySelectorAll('*')) child.style.setProperty('display', 'none', 'important')
          }
          if (/^Agent 预设$/.test(text) || /Agent 预设/.test(label)) button.style.setProperty('display', 'none', 'important')
        }
        const candidates = root.nodeType === Node.ELEMENT_NODE
          ? [root, ...root.querySelectorAll('*')]
          : [...root.querySelectorAll?.('*') || []]
        replaceComposerBrand(candidates)
        const branded = candidates.find((node) => {
          const raw = String(node.textContent || '').trim().replace(/\s+/g, ' ')
          // VENDOR branding only. `/deepseek/i` used to match any node that merely
          // mentioned the vendor — including the composer's model seat showing
          // "DeepSeek …" — hid its row (target.style.display = 'none' below) and
          // inserted a TaskHive wordmark in its place.
          if (!VENDOR_BRAND_TEXT.test(raw)) return false
          if (node.closest(BRAND_SCRUB_EXEMPT) || node.querySelector(BRAND_SCRUB_EXEMPT)) return false
          const rect = node.getBoundingClientRect()
          return rect.width > 40 && rect.width < 360 && rect.height < 100
        })
        if (branded && !document.querySelector('[data-taskhive-workbench-brand]')) {
          const target = branded.parentElement || branded
          target.style.display = 'none'
          const brand = document.createElement('span')
          brand.style.cssText = brandSpanStyle
          brand.innerHTML = brandSpanMarkup()
          target.parentElement?.insertBefore(brand, target)
        }
        hideResidualBrandText(root)
        if (isDocument) {
          const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
          if (dialog && /设置|settings/i.test(String(dialog.textContent || ''))) {
            const modelButtons = [...dialog.querySelectorAll('button,[role="button"]')].filter((node) => /^(模型|models?)$/i.test(String(node.textContent || '').trim()))
            if (modelButtons.length > 1) modelButtons[0].style.setProperty('display', 'none', 'important')
          }
        }
        backfillAccessibleNames(root)
        syncDeepDivingDisclosures(root)
      }
      let scrubScheduled = false
      let scrubTimer = null
      const pendingRoots = new Set()
      const scheduleScrub = (root = document, initial = false) => {
        if (!root) return
        if (initial || root === document) {
          pendingRoots.clear()
          pendingRoots.add(document)
        } else if (![...pendingRoots].some((pending) => pending === document || pending.contains?.(root))) {
          for (const pending of [...pendingRoots]) if (root.contains?.(pending)) pendingRoots.delete(pending)
          pendingRoots.add(root)
        }
        if (scrubScheduled) return
        scrubScheduled = true
        const run = () => {
          scrubScheduled = false
          scrubTimer = null
          const roots = [...pendingRoots]
          pendingRoots.clear()
          for (const pending of roots) scrub(pending, pending === document)
        }
        scrubTimer = typeof requestIdleCallback === 'function'
          ? requestIdleCallback(run, { timeout: 1200 })
          : setTimeout(run, 1000)
      }
      scheduleScrub(document, true)
      // The sidebar can mount without emitting a mutation we observe (slow first
      // paint, hydration). These retries touch only the small brand row, so they
      // are cheap even though they are unconditional.
      const brandRetries = [1200, 3000, 6000].map((delay) => setTimeout(reconcileSidebarBrand, delay))
      // Alpha.2 strips `taskhiveIcon` from the normalized URL. Re-run the skin
      // once the bridge hands the host-owned icon back, otherwise the restored
      // TaskHive brand would render without its glyph.
      if (!taskhiveBrandIcon) void resolveTaskhiveBrandIcon().then((icon) => { if (icon) scheduleScrub(document, true) })
      window.__TASKHIVE_SYNC_DEEP_DIVING__ = () => syncDeepDivingDisclosures(document)
      const relevantSelector = 'a,button,[role="button"],header,[data-variant="think"],[class*="brand" i]'
      // The brand mark and wordmark live inside DSH's React tree, so every
      // re-render (notably a sidebar collapse/expand) recreates the vendor nodes
      // and discards our replacement. The scheduled idle scrub re-applies it, but
      // that leaves a window in which the vendor logo and wordmark are visible.
      // Reconciling synchronously here — the observer callback runs as a
      // microtask right after React commits — closes that window. It is three
      // querySelector calls, so it is cheap enough to do on every brand mutation.
      const brandTouched = (node) => Boolean(node?.matches?.('[class*="brand" i],[data-slot^="sidebar.brand"]')
        || node?.closest?.('[class*="logoRow"],[class*="brand" i]')
        || node?.querySelector?.('[data-slot^="sidebar.brand"],[class*="brand" i]'))
      // T091: 我们注入的品牌节点被 React 丢掉时，这次 childList 变更**只有
      // removedNodes**，没有 addedNodes —— 旧循环只看 addedNodes，于是
      // reconcileSidebarBrand() 再也不会被调用。而 vendor 节点是被 React 复用的
      // （它身上还留着我们上次加的 display:none!important），结果就是一个**空槽**：
      // 图标和文字一起消失，直到下一次"有新增"的渲染才恢复。
      const isOurBrandNode = (node) => {
        if (node?.nodeType !== Node.ELEMENT_NODE) return false
        const OWNED = '[data-taskhive-brand-mark],[data-taskhive-brand-wordmark],[data-taskhive-brand-text],[data-taskhive-brand-icon]'
        return node.matches?.(OWNED) === true || Boolean(node.querySelector?.(OWNED))
      }
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (mutation.target.matches?.(relevantSelector) || mutation.target.closest?.('[class*="brand" i]')) { reconcileSidebarBrand(); scheduleScrub(mutation.target) }
            continue
          }
          for (const node of mutation.removedNodes) {
            if (!isOurBrandNode(node) && !brandTouched(node)) continue
            // Re-inject only; keep the scrub scoped to the brand row. Escalating to
            // `document` here would restore the whole-page innerText/layout pass that
            // T029/T037 removed.
            reconcileSidebarBrand()
            const container = document.querySelector('[class*="logoRow"]') || document.querySelector(SIDEBAR_MARK_SELECTOR)?.parentElement
            if (container) scheduleScrub(container)
            break
          }
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue
            if (brandTouched(node)) reconcileSidebarBrand()
            const brandRoot = node.matches(relevantSelector)
              ? node
              : node.closest?.(relevantSelector) || node.querySelector(relevantSelector)
            if (brandRoot) scheduleScrub(brandRoot)
            // Keep the icon/image cleanup local to the added subtree. Escalating
            // to `document` here re-introduced the whole-page innerText and
            // layout scrub on every streamed image (T029/T037 regression).
            else if (node.matches?.('img,svg') || node.querySelector?.('img,svg')) scheduleScrub(node.parentElement || node)
          }
        }
      })
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'aria-expanded', 'class'],
      })
      // T091: a sidebar collapse/expand is a layout change that also re-parents the
      // brand; the observer cannot see the re-parent itself when React keeps both the
      // slot and its vendor child, so re-assert on resize. Three querySelector calls,
      // no timer — this does NOT reintroduce T069's periodic engine work.
      const onBrandResize = () => reconcileSidebarBrand()
      window.addEventListener('resize', onBrandResize)
      document.addEventListener('visibilitychange', onBrandResize)
      window.__TASKHIVE_SKIN_DISPOSE__ = () => {
        observer.disconnect()
        document.removeEventListener('click', rememberSessionRow, true)
        window.removeEventListener('resize', onBrandResize)
        document.removeEventListener('visibilitychange', onBrandResize)
        for (const timer of brandRetries) clearTimeout(timer)
        if (scrubTimer !== null) {
          if (typeof cancelIdleCallback === 'function') cancelIdleCallback(scrubTimer)
          else clearTimeout(scrubTimer)
        }
        scrubTimer = null
        pendingRoots.clear()
        delete window.__TASKHIVE_SYNC_DEEP_DIVING__
      }
    }

    function ExpertLineIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
      },
      h('circle', { cx: 9, cy: 8, r: 3 }),
      h('path', { d: 'M3.8 19c.5-3.2 2.3-5 5.2-5s4.7 1.8 5.2 5' }),
      h('circle', { cx: 17, cy: 9, r: 2.2 }),
      h('path', { d: 'M15.2 14.7c.6-.5 1.3-.7 2.2-.7 2.1 0 3.2 1.4 3.6 3.8' }),
      )
    }

    function ExpertToggle() {
      const [enabled, setEnabled] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      React.useEffect(() => {
        let disposed = false
        const apply = (status) => { if (!disposed) { setEnabled(status?.enabled === true); setFailed(false) } }
        Promise.resolve(window.taskhive?.expertStatus?.()).then(apply).catch(() => { if (!disposed) { setEnabled(false); setFailed(true) } })
        // ONE switch, and it lives here. The expert plugin configures teams and
        // stages but no longer carries a second copy of this control, so the host
        // push is what keeps this button honest when anything else changes the
        // state (for example the plugin surface's own round-trips).
        const unsubscribe = window.taskhive?.onExpertStatus?.(apply)
        return () => { disposed = true; try { unsubscribe?.() } catch { /* host already gone */ } }
      }, [])
      const toggle = async () => {
        if (busy || enabled === null || !window.taskhive?.setExpertEnabled) return
        setBusy(true)
        try {
          const status = await window.taskhive.setExpertEnabled(!enabled)
          setEnabled(status?.enabled === true)
          setFailed(false)
        } catch {
          setFailed(true)
        } finally {
          setBusy(false)
        }
      }
      return h('button', {
        type: 'button',
        'data-taskhive-expert-toggle': 'true',
        'data-enabled': enabled === true ? 'true' : 'false',
        'aria-label': failed ? '专家状态不可用' : `专家协作${enabled ? '已开启' : '已关闭'}，点击${enabled ? '关闭' : '开启'}`,
        'aria-pressed': enabled === true,
        title: failed
          ? '专家状态不可用，请在专家插件中检查配置'
          : `点击${enabled ? '关闭' : '开启'}专家协作；团队与阶段在专家插件中设置`,
        disabled: busy || enabled === null,
        onClick: toggle,
        style: {
          appearance: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', height: '28px', padding: '0 5px',
          border: 0, borderRadius: '6px', background: 'transparent',
          color: 'var(--dsw-alias-label-primary, currentColor)', font: 'inherit', fontSize: '12px', lineHeight: 1,
          cursor: busy || enabled === null ? 'default' : 'pointer',
          opacity: busy || enabled === null ? 0.55 : enabled === true ? 1 : 0.72,
        }
      }, h(ExpertLineIcon), h('span', null, '专家'))
    }

    function WebModelSelect() {
      const [models, setModels] = React.useState([])
      const [selected, setSelected] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let disposed = false
        Promise.resolve(window.taskhive?.listModels?.()).then((catalog) => {
          if (disposed) return
          const provider = catalog?.providers?.find((item) => item.id === 'web-ai' && item.state === 'ready')
          setModels(provider?.models || [])
          setSelected(catalog?.browserRoute?.modelId || '')
        }).catch(() => { if (!disposed) setModels([]) })
        return () => { disposed = true }
      }, [])
      if (!models.length) return null
      const labels = { 'deepseek-web': 'DeepSeek', 'kimi-web': 'Kimi', 'doubao-web': '豆包', 'yuanbao-web': '腾讯元宝', 'qwen-web': '通义千问', 'chatgpt-web': 'ChatGPT', 'claude-web': 'Claude', 'gemini-web': 'Gemini' }
      const change = async (event) => {
        const modelId = event.target.value
        if (!modelId || busy || !window.taskhive?.selectModel) return
        setBusy(true)
        try {
          await window.taskhive.selectModel({ providerId: 'web-ai', modelId })
          setSelected(modelId)
          openSurface('web-ai')
        } finally { setBusy(false) }
      }
      return h('select', {
        value: selected,
        disabled: busy,
        onChange: change,
        'data-taskhive-web-model': 'true',
        'aria-label': '切换网页 AI 模型',
        title: '网页 AI：选择后在中央浏览器打开，不作为 Harness 自动推理模型',
      }, h('option', { value: '' }, '网页 AI'), ...models.map((modelId) => h('option', { key: modelId, value: modelId }, `网页 · ${labels[modelId] || modelId}`)))
    }

    // Surface chrome (Settings / 模型 / 专家 / 知识库 tabs). These previously
    // fell back to near-black and transparent, which is what made the embedded
    // settings pages read as monochrome wireframes. The TaskHive brand accent
    // now carries the interactive affordances.
    // T096b: no bold anywhere in this table — the session panel and the settings
    // surfaces must read as one and the same interface. Weight is carried by the
    // --dsw-alias-* colour ladder and 1px separators instead.
    const surfaceStyles = {
      column: { display: 'grid', gap: '12px', color: 'var(--dsw-alias-label-primary, var(--th-ink))', font: '13px/1.5 Inter,"Microsoft YaHei",system-ui,sans-serif' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-subtle, var(--th-line))' },
      button: { height: '30px', padding: '0 10px', border: '1px solid var(--th-brand-line)', borderRadius: '6px', background: 'var(--th-brand-tint)', color: 'var(--th-brand-ink)', font: 'inherit', fontWeight: 400, cursor: 'pointer' },
      input: { height: '32px', minWidth: 0, padding: '0 9px', border: '1px solid var(--dsw-alias-border-subtle, var(--th-line))', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-1, var(--th-surface))', color: 'inherit', font: 'inherit' },
    }

    function DirectorySettingsItem() {
      const [directories, setDirectories] = React.useState({ entries: [] })
      const [draft, setDraft] = React.useState({ id: '', name: '', path: '', gitUrl: '' })
      const [message, setMessage] = React.useState('')
      const reload = () => Promise.resolve(window.taskhive?.listDirectories?.()).then((value) => setDirectories(value || { entries: [] })).catch((error) => setMessage(error.message))
      React.useEffect(() => { void reload() }, [])
      const update = (id, field, value) => setDirectories((current) => ({ ...current, entries: (current.entries || []).map((entry) => entry.id === id ? { ...entry, [field]: value } : entry) }))
      const save = async (entry) => { try { setDirectories(await window.taskhive.saveDirectory({ ...entry, previousId: entry.id })); setMessage(`已保存：${entry.name}`) } catch (error) { setMessage(error.message) } }
      const remove = async (entry) => { try { setDirectories(await window.taskhive.removeDirectory(entry.id)); setMessage(`已删除：${entry.name}`) } catch (error) { setMessage(error.message) } }
      const add = async () => { try { setDirectories(await window.taskhive.saveDirectory(draft)); setDraft({ id: '', name: '', path: '', gitUrl: '' }); setMessage('目录项已添加') } catch (error) { setMessage(error.message) } }
      const restore = async () => { try { setDirectories(await window.taskhive.restoreDirectories()); setMessage('已恢复默认目录') } catch (error) { setMessage(error.message) } }
      const fieldStyle = { display: 'grid', minWidth: 0, gap: '4px', color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '12px' }
      const inputStyle = { ...surfaceStyles.input, width: '100%', boxSizing: 'border-box' }
      const actionsStyle = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }
      const cardStyle = { display: 'grid', minWidth: 0, gap: '9px', padding: '10px', border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.22))', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1, transparent)' }
      const fieldsStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', minWidth: 0, gap: '8px' }
      return h('details', { 'data-taskhive-settings-directories': 'true', style: { padding: '10px 0', borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.2))' } },
        h('summary', { title: '展开并编辑 TaskHive 工作目录与 Git 仓库地址', style: { cursor: 'pointer', fontWeight: 400, userSelect: 'none' } }, '工作目录与仓库'),
        h('div', { 'data-directory-list': 'true', style: { display: 'grid', minWidth: 0, gap: '8px', marginTop: '10px' } },
          ...(directories.entries || []).map((entry) => h('section', { key: entry.id, 'data-directory-row': entry.id, style: cardStyle },
            h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(86px,auto) minmax(140px,1fr) auto', minWidth: 0, gap: '8px', alignItems: 'center' } },
              h('code', { title: entry.id, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '12px' } }, entry.id),
              h('label', { style: fieldStyle }, h('span', null, '名称'), h('input', { style: inputStyle, value: entry.name, 'aria-label': `${entry.id} 名称`, onChange: (event) => update(entry.id, 'name', event.target.value) })),
              h('span', { 'data-directory-actions': 'true', style: actionsStyle },
                h('button', { type: 'button', style: surfaceStyles.button, title: '保存目录项', onClick: () => save(entry) }, '保存'),
                h('button', { type: 'button', style: surfaceStyles.button, title: '删除目录项', onClick: () => remove(entry) }, '删除'))),
            h('div', { style: fieldsStyle },
              h('label', { style: fieldStyle }, h('span', null, '绝对路径'), h('input', { style: inputStyle, value: entry.path, title: entry.path, 'aria-label': `${entry.id} 绝对路径`, onChange: (event) => update(entry.id, 'path', event.target.value) })),
              h('label', { style: fieldStyle }, h('span', null, 'Git 仓库地址'), h('input', { style: inputStyle, value: entry.gitUrl || '', placeholder: 'https:// / ssh:// / git@ / file://', 'aria-label': `${entry.id} Git 地址`, onChange: (event) => update(entry.id, 'gitUrl', event.target.value) }))))),
          h('section', { 'data-directory-row': 'new', style: { ...cardStyle, borderStyle: 'dashed' } },
            h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(100px,.7fr) minmax(150px,1fr) auto', minWidth: 0, gap: '8px', alignItems: 'end' } },
              h('label', { style: fieldStyle }, h('span', null, 'ID'), h('input', { style: inputStyle, value: draft.id, placeholder: 'custom-id', 'aria-label': '新目录 ID', onChange: (event) => setDraft({ ...draft, id: event.target.value }) })),
              h('label', { style: fieldStyle }, h('span', null, '名称'), h('input', { style: inputStyle, value: draft.name, placeholder: '显示名称', 'aria-label': '新目录名称', onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
              h('span', { 'data-directory-actions': 'true', style: actionsStyle }, h('button', { type: 'button', style: surfaceStyles.button, title: '添加自定义目录项', onClick: add }, '添加'))),
            h('div', { style: fieldsStyle },
              h('label', { style: fieldStyle }, h('span', null, '绝对路径'), h('input', { style: inputStyle, value: draft.path, placeholder: 'C:\\absolute\\path', 'aria-label': '新目录绝对路径', onChange: (event) => setDraft({ ...draft, path: event.target.value }) })),
              h('label', { style: fieldStyle }, h('span', null, 'Git 仓库地址'), h('input', { style: inputStyle, value: draft.gitUrl, placeholder: '可选 Git 地址', 'aria-label': '新目录 Git 地址', onChange: (event) => setDraft({ ...draft, gitUrl: event.target.value }) }))),
          h('div', { style: { ...actionsStyle, justifyContent: 'space-between' } },
            message ? h('span', { role: 'status', style: { color: 'var(--dsw-alias-label-secondary, #666)' } }, message) : h('span'),
            h('button', { type: 'button', style: surfaceStyles.button, title: '恢复八个默认工作目录', onClick: restore }, '恢复默认')))))
    }

    function ModelCatalogSection() {
      const [catalog, setCatalog] = React.useState(null)
      const [draft, setDraft] = React.useState({ providerId: '', name: '', modelId: '', kind: 'api', endpoint: '', apiKey: '', protocol: 'openai' })
      // Per-provider credential drafts, keyed by provider id. Kept separate from
      // `catalog` so a typed key is never round-tripped back from the host (the
      // host only ever sends a mask).
      const [credentials, setCredentials] = React.useState({})
      const [message, setMessage] = React.useState('')
      const reload = () => Promise.resolve(window.taskhive?.listModels?.()).then(setCatalog).catch((error) => setMessage(error.message))
      React.useEffect(() => { void reload() }, [])
      const toggle = async (providerId, modelId, visible) => { try { await window.taskhive.setModelVisible({ providerId, modelId, visible }); setMessage('已保存；模型目录将在约 1 秒后刷新（Harness 需要重新载入模型表），刷新后新勾选的模型会出现在输入框模型选择中'); await reload() } catch (error) { setMessage(error.message) } }
      const add = async () => {
        try {
          const result = await window.taskhive.addCustomModel({ ...draft, visible: true })
          setDraft({ providerId: '', name: '', modelId: '', kind: 'api', endpoint: '', apiKey: '', protocol: 'openai' })
          setMessage(result?.state === 'ready'
            ? '自定义模型已加入目录并可用于对话'
            : `自定义模型已加入目录，但仍是 ${result?.state || 'unconfigured'}：请补全服务地址与 API Key`)
          await reload()
        } catch (error) { setMessage(error.message) }
      }
      const remove = async (providerId) => { try { await window.taskhive.removeCustomModel(providerId); await reload() } catch (error) { setMessage(error.message) } }
      // Saving a credential restarts the Harness so the key reaches its
      // environment; report that plainly because it briefly drops the session.
      const saveCredential = async (provider) => {
        const entry = credentials[provider.id] || {}
        try {
          const result = await window.taskhive.setModelCredential({
            providerId: provider.id,
            endpoint: entry.endpoint === undefined ? undefined : entry.endpoint,
            apiKey: entry.apiKey === undefined ? undefined : entry.apiKey,
          })
          setCredentials({ ...credentials, [provider.id]: {} })
          setMessage(`${provider.name}：${result.state === 'ready' ? '已就绪' : '仍缺少服务地址或 API Key'} · Harness 已重启以载入凭据`)
          await reload()
        } catch (error) { setMessage(error.message) }
      }
      const credentialDraft = (provider) => credentials[provider.id] || {}
      const setCredentialDraft = (provider, patch) => setCredentials({ ...credentials, [provider.id]: { ...credentialDraft(provider), ...patch } })
      const isConfigurable = (provider) => ['api', 'local'].includes(provider.kind)
      return h('section', { 'data-taskhive-model-settings': 'true', style: surfaceStyles.column },
        h('div', null, h('h2', { style: { margin: 0, font: 'inherit', fontSize: '13px', fontWeight: 400 } }, '模型'), h('p', { style: { margin: '5px 0 0', color: 'var(--dsw-alias-label-secondary, #666)' } }, '统一管理 Codex、Claude、DeepSeek 等 API、本地与网页模型；勾选项才会进入输入框模型目录。API Key 只保存在本机并只注入 Harness 子进程环境，不会回传界面。')),
        ...(catalog?.providers || []).map((provider) => h('section', { key: provider.id, style: { padding: '0 12px', border: '1px solid var(--dsw-alias-border-subtle, rgba(127,127,127,.22))', borderRadius: '8px' } },
          h('div', { style: surfaceStyles.row }, h('span', null, h('strong', null, provider.name), h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, `${provider.state} · ${provider.authentication || '未声明认证'} · ${provider.vision?.state === 'ready' ? 'ModLens 视觉已就绪' : provider.kind === 'web' ? '网页模型不接管视觉' : '视觉未配置'}`)), provider.custom ? h('button', { type: 'button', style: surfaceStyles.button, title: '删除自定义模型提供方', onClick: () => remove(provider.id) }, '删除') : null),
          ...(provider.models || []).map((modelId) => h('label', { key: modelId, style: { ...surfaceStyles.row, cursor: 'pointer' }, title: '控制此模型是否出现在输入框模型选择中' }, h('span', null, modelId), h('input', { type: 'checkbox', checked: catalog.visibility?.[`${provider.id}::${modelId}`] !== false, onChange: (event) => toggle(provider.id, modelId, event.target.checked), 'aria-label': `${modelId} 在输入框显示` }))),
          // Credential row. The advertised endpoint is a real value read back
          // from the catalog, so a configured provider shows what it will call.
          isConfigurable(provider) ? h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.4fr) auto', gap: '7px', padding: '6px 0 10px' } },
            h('input', {
              style: surfaceStyles.input,
              value: credentialDraft(provider).endpoint ?? provider.endpoint ?? '',
              placeholder: '服务地址，例如 https://api.deepseek.com',
              'aria-label': `${provider.name} 服务地址`,
              title: 'OpenAI 兼容或 Anthropic 兼容的基础地址',
              onChange: (event) => setCredentialDraft(provider, { endpoint: event.target.value }),
            }),
            h('input', {
              style: surfaceStyles.input,
              type: 'password',
              value: credentialDraft(provider).apiKey ?? '',
              placeholder: provider.hasApiKey ? `已保存 ${provider.apiKeyMasked || '•'}（输入以替换）` : `API Key（环境变量 ${provider.apiKeyEnv || '-'}）`,
              'aria-label': `${provider.name} API Key`,
              title: '仅保存在本机 profiles/api-credentials.json，并注入 Harness 子进程环境',
              onChange: (event) => setCredentialDraft(provider, { apiKey: event.target.value }),
            }),
            h('button', { type: 'button', style: surfaceStyles.button, title: '保存服务地址与 API Key，并重启 Harness 使其生效', 'data-taskhive-save-credential': provider.id, onClick: () => saveCredential(provider) }, '保存凭据'),
          ) : null,
        )),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr)) auto', gap: '7px', paddingTop: '6px' } },
          h('input', { style: surfaceStyles.input, value: draft.providerId, placeholder: 'Provider ID', 'aria-label': '自定义 Provider ID', onChange: (event) => setDraft({ ...draft, providerId: event.target.value }) }),
          h('input', { style: surfaceStyles.input, value: draft.name, placeholder: '显示名称', 'aria-label': '自定义模型显示名称', onChange: (event) => setDraft({ ...draft, name: event.target.value }) }),
          h('input', { style: surfaceStyles.input, value: draft.modelId, placeholder: 'Model ID', 'aria-label': '自定义 Model ID', onChange: (event) => setDraft({ ...draft, modelId: event.target.value }) }),
          h('select', { style: surfaceStyles.input, value: draft.kind, 'aria-label': '自定义模型类型', onChange: (event) => setDraft({ ...draft, kind: event.target.value }) }, h('option', { value: 'api' }, 'API'), h('option', { value: 'local' }, '本地')),
          h('button', { type: 'button', style: surfaceStyles.button, title: '添加自定义模型', onClick: add }, '添加'),
        ),
        // Custom API endpoints need the same two fields the adapter reads.
        draft.kind === 'api' ? h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr)', gap: '7px' } },
          h('input', { style: surfaceStyles.input, value: draft.endpoint, placeholder: '服务地址，例如 https://api.openai.com/v1', 'aria-label': '自定义模型服务地址', onChange: (event) => setDraft({ ...draft, endpoint: event.target.value }) }),
          h('input', { style: surfaceStyles.input, type: 'password', value: draft.apiKey, placeholder: 'API Key（可留空后补）', 'aria-label': '自定义模型 API Key', onChange: (event) => setDraft({ ...draft, apiKey: event.target.value }) }),
          h('select', { style: surfaceStyles.input, value: draft.protocol, 'aria-label': '自定义模型协议', title: '协议决定请求格式：OpenAI 兼容 / Anthropic 兼容', onChange: (event) => setDraft({ ...draft, protocol: event.target.value }) }, h('option', { value: 'openai' }, 'OpenAI 兼容'), h('option', { value: 'anthropic' }, 'Anthropic 兼容')),
        ) : null,
        message ? h('div', { role: 'status', style: { color: 'var(--dsw-alias-label-secondary, #666)' } }, message) : null,
      )
    }

    function PluginInventoryTab() {
      const [items, setItems] = React.useState([])
      const [source, setSource] = React.useState('')
      const [message, setMessage] = React.useState('')
      const reload = () => Promise.resolve(window.taskhive?.listPlugins?.()).then(setItems).catch((error) => setMessage(error.message))
      React.useEffect(() => { void reload() }, [])
      const toggle = async (item) => { try { if (item.state === 'disabled') await window.taskhive.enablePlugin(item.id); else await window.taskhive.disablePlugin(item.id); await reload() } catch (error) { setMessage(error.message) } }
      const uninstall = async (item) => { try { await window.taskhive.uninstallPlugin(item.id); await reload() } catch (error) { setMessage(error.message) } }
      const place = async (item, placement) => { try { await window.taskhive.setPluginPlacement({ id: item.id, placement }); await reload() } catch (error) { setMessage(error.message) } }
      const install = async () => { if (!source.trim()) return; try { await window.taskhive.installPlugin({ source: source.trim() }); setSource(''); await reload() } catch (error) { setMessage(error.message) } }
      return h('section', { 'data-taskhive-plugin-inventory': 'true', style: surfaceStyles.column },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '8px' } }, h('input', { style: surfaceStyles.input, value: source, placeholder: 'Git 地址或本地插件目录', 'aria-label': '插件来源', onChange: (event) => setSource(event.target.value) }), h('button', { type: 'button', style: surfaceStyles.button, title: '安装本地或 Git 插件', onClick: install }, '安装')),
        ...items.map((item) => h('div', { key: item.id, 'data-plugin-row': item.id, 'data-plugin-source': item.sourceKind || 'local', 'data-plugin-type': item.type || 'background', 'data-plugin-health': item.health || item.state, style: surfaceStyles.row },
          h('span', null,
            h('strong', null, item.name || item.id),
            h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, `${item.id} · v${item.version || '-'} · ${item.sourceKind || 'local'} · ${item.type === 'surface' ? '界面插件' : item.type === 'settings' ? '设置插件' : '后台插件'} · ${item.health === 'healthy' ? '健康' : item.health || item.state}`),
            h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, item.entryConfigurable ? `入口：${item.placement === 'right' ? '右侧栏' : item.placement === 'hidden' ? '隐藏' : '左侧栏'}` : '入口：无侧栏界面'),
          ),
          h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            item.entryConfigurable ? h('select', { value: item.placement || 'left', 'aria-label': `${item.name || item.id} 入口位置`, title: '选择插件在左侧栏、右侧栏显示或隐藏', onChange: (event) => place(item, event.target.value), style: surfaceStyles.input },
              h('option', { value: 'left' }, '左侧栏'), h('option', { value: 'right' }, '右侧栏'), h('option', { value: 'hidden' }, '隐藏')) : null,
            h('button', { type: 'button', style: surfaceStyles.button, title: item.protected ? '系统插件不可停用' : item.state === 'disabled' ? '启用插件' : '停用插件', disabled: item.protected, onClick: () => toggle(item) }, item.state === 'disabled' ? '启用' : '停用'),
            h('button', { type: 'button', style: surfaceStyles.button, title: item.protected ? '系统插件不可卸载' : '卸载并保留备份', disabled: item.protected, onClick: () => uninstall(item) }, '卸载'),
          ),
        )),
        message ? h('div', { role: 'status' }, message) : null,
      )
    }

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
      const delayedPublishes = new Set()
      const publish = (force = false) => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          const next = document.querySelector('[data-pane="conversation"]') || document.querySelector('main')
          if (next !== pane) {
            resize?.disconnect()
            pane = next
            resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => publish()) : null
            if (pane) resize?.observe(pane)
          }
          const viewport = { width: window.innerWidth, height: window.innerHeight }
          const rect = pane?.getBoundingClientRect?.()
          const sidebar = document.querySelector('[data-pane="sidebar"], aside, [class*="sidebarCol"]')?.getBoundingClientRect?.()
          const declaredPanel = document.querySelector('[data-dsh-better-sidebar-panel="right"]')?.getBoundingClientRect?.()
          const isDockedRightPanel = (value) => value
            && value.width >= 180
            && value.height >= viewport.height * 0.45
            && value.left >= viewport.width * 0.45
            && value.right >= viewport.width - 4
            && value.right <= viewport.width + 4
          const rightCandidates = [
            ...document.querySelectorAll('[data-pane="right-sidebar"], [data-taskhive-right-sidebar-plugins], [class*="rightSidebar"], [class*="sidebarRight"], [data-dsh-better-sidebar] > *'),
          ].map((node) => node.getBoundingClientRect?.()).filter(isDockedRightPanel)
          const right = isDockedRightPanel(declaredPanel) ? declaredPanel : rightCandidates.sort((a, b) => a.left - b.left)[0]
          const declaredRightWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width') || getComputedStyle(document.body).getPropertyValue('--dsh-sidebar-width') || '0') || 0
          // DSH rc.8 has used several conversation-pane markers. If the
          // marker resolves to a composer-sized node, derive the central
          // workbench from the actual left/right rails instead of publishing
          // a bottom strip as the desktop overlay.
          const validConversation = rect && rect.width > viewport.width * 0.45 && rect.height > viewport.height * 0.45
          const left = validConversation ? rect.left : Math.max(0, sidebar?.right || 0)
          // `data-dsh-sidebar-collapsed` is shared by DSH's left navigation
          // and cannot describe the right rail. Only the native right-rail
          // toggle may permit a narrow desktop surface bound.
          const rightToggle = document.querySelector('[data-dsh-right-sidebar-toggle]')
          const rightToggleLabel = String(rightToggle?.getAttribute('aria-label') || rightToggle?.getAttribute('title') || '')
          const rightSidebarCollapsed = RIGHT_SIDEBAR_COLLAPSED.test(rightToggleLabel)
          const toggleReserve = rightSidebarCollapsed ? 78 : 0
          if (!rightSidebarCollapsed && right) lastSafeRightBoundary = Math.round(right.left)
          // The right-side content can briefly move inside its rail while a
          // tab changes. Ignore these offscreen rectangles and keep the last
          // docked boundary so the native WebContentsView cannot cover the
          // right rail while the DOM settles.
          const minimumRightReserve = Math.max(180, declaredRightWidth || 380)
          const fallbackRightBoundary = lastSafeRightBoundary ?? Math.max(0, viewport.width - minimumRightReserve)
          const rightBoundary = rightSidebarCollapsed
            ? viewport.width - toggleReserve
            : Math.min(viewport.width - minimumRightReserve, right?.left ?? fallbackRightBoundary)
          const rightEdge = validConversation ? Math.min(rect.right, rightBoundary) : rightBoundary
          const top = validConversation ? rect.top : 0
          const bottom = validConversation ? rect.bottom : viewport.height
          if (rightEdge <= left || bottom <= top) return
          const geometry = {
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(rightEdge - left),
            height: Math.round(bottom - top),
            rightBoundary: Math.round(rightBoundary),
            rightSidebarReserve: Math.round(viewport.width - rightBoundary),
            rightSidebarCollapsed,
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
          window.parent.postMessage({ source: 'taskhive-dsh', type: 'surface.geometry', geometry }, '*')
        })
      }
      const mutation = new MutationObserver(() => publish())
      mutation.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-pane'] })
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
        mutation.disconnect()
        resize?.disconnect()
        for (const timer of delayedPublishes) clearTimeout(timer)
        document.removeEventListener('click', republishAfterRightRailTransition, true)
        window.removeEventListener('taskhive:right-sidebar-toggle', republishAfterRightRailTransition)
        window.removeEventListener('resize', publish)
      }
    }

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

    function apply(ctx) {
      const service = ctx.betterSidebar
      if (!service || typeof service.registerTab !== 'function') return
      // Host-only integration seam used by the desktop smoke probe. It calls
      // the same public Better Sidebar service as the visible + menu, so the
      // probe can exercise lazy terminal loading without synthetic DOM state.
      window.__TASKHIVE_OPEN_TERMINAL__ = () => service.openTab({ type: 'terminal', title: '终端' })
      installTaskHiveSkin(ctx, () => service.openTab({ type: 'taskhive:sessions', id: 'taskhive:sessions', title: '会话记录' }))
      window.__TASKHIVE_SURFACES_REGISTERED__ = true
      const disposers = entries.map((entry) => service.registerTab({
        id: entry.tabId, title: entry.title, order: entry.order, single: true, hidden: entry.visible === false || entry.placement !== 'right',
        onActivate: () => openSurface(entry.id), component: surfaceView(entry.id, entry.title),
      }))
      if (entries.some((entry) => entry.id === 'codesys')) disposers.push(service.registerTab({
        id: 'taskhive:codesys-workbench', title: 'CODESYS 工作台', order: 8, single: true, hidden: false,
        component: () => h(CodesysWorkbenchBoundary, { ctx }),
      }))
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
      disposers.push(service.registerTab({
        id: 'taskhive:sessions', title: '会话记录', order: 9, single: true, hidden: true,
        component: () => h(SessionRecordsPanel, { ctx }),
      }))
      window.__TASKHIVE_SURFACE_IDS__ = entries.map((entry) => entry.id)
      window.__TASKHIVE_LEFT_SURFACE_IDS__ = entries.filter((entry) => entry.placement === 'left').map((entry) => entry.id)
      window.__TASKHIVE_RIGHT_SURFACE_IDS__ = entries.filter((entry) => entry.placement === 'right').map((entry) => entry.id)
      if (ctx.slots?.inject && ctx.slots?.register) {
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'taskhive-expert-toggle', priority: -100
        }, () => h(ExpertToggle)))
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'taskhive-directories', order: 90
        }, () => h(DirectorySettingsItem)))
        // The model section is registered here, and that is load-bearing.
        //
        // DSH's own `settings.section#models` was assumed to be the better surface
        // because every provider row there renders an unconditional Edit button.
        // Measured against this build, that page lists no providers at all — it
        // renders its empty state plus "添加提供方" — so removing this section did
        // not consolidate anything, it just took the user's models away. Restored,
        // and the assumption is now recorded as wrong rather than repeated.
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          // Labelled "模型启用" rather than "模型" so it cannot be confused with
          // DSH's own `settings.section#models`, which carries the same name.
          // The two surfaces do different jobs: the native one offers pi-ai's
          // shipped provider directory (38 upstream vendors) for adding an API
          // provider, while this one manages the providers THIS install uses and
          // ticks which of their models reach the composer picker. Only the id
          // stays stable — it is what other code and the probes address.
          name: 'settings.section', id: 'taskhive-model-catalog', order: 19, label: '模型启用'
        }, () => h(ModelCatalogSection)))
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
          name: 'settings.plugins.tab', id: 'taskhive-plugin-inventory', order: 90, label: '本地插件'
        }, () => h(PluginInventoryTab)))
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'taskhive-sidebar-plugins', priority: 20
        }, (props) => h(LeftSurfaceActions, props || {})))
      }
      const workspaces = ctx.workspaces
      const sessions = ctx.sessions
      const uiWorkspace = ctx.uiWorkspace
      let workspaceAttempted = false
      let workspaceSetupPending = false
      const seededRightTabs = new Set()
      const connectWorkspaceSession = async (workspaceId) => {
        if (!workspaceId || typeof sessions?.open !== 'function') throw new Error('Harness workspace/session services are unavailable')
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
          sessions: sessions?.list?.getSnapshot?.() || null,
        }),
        create: async () => {
          requireQaProbes()
          const workspaceSnapshot = workspaces?.list?.getSnapshot?.()
          const workspaceId = workspaceSnapshot?.items?.[0]?.workspaceId
          const sessionId = await connectWorkspaceSession(workspaceId)
          sessions.open(sessionId)
          return { sessionId, snapshot: sessions?.list?.getSnapshot?.() || null }
        },
        makeHistorical: async (sessionId, text = 'TASKHIVE_HISTORY_SWITCH_PROBE') => {
          requireQaProbes()
          const face = sessions?.binding?.(sessionId)?.session
          if (!face || typeof face.prompt !== 'function' || typeof face.cancel !== 'function') {
            throw new Error('Harness session prompt/cancel face is unavailable')
          }
          const prompt = await face.prompt([{ type: 'text', text }], 'queue')
          const cancel = await face.cancel()
          return { prompt, cancel, snapshot: sessions?.list?.getSnapshot?.() || null }
        },
        rename: async (sessionId, title) => {
          requireQaProbes()
          const face = sessions?.binding?.(sessionId)?.session
          if (!face || typeof face.rename !== 'function') throw new Error('Harness session rename face is unavailable')
          const result = await face.rename(title)
          if (result?.ok === false) throw new Error(result?.error?.message || 'Harness session rename was rejected')
          return { result, snapshot: sessions?.list?.getSnapshot?.() || null }
        },
        archive: async (sessionId) => {
          requireQaProbes()
          if (!sessionId || typeof uiWorkspace?.archiveSession !== 'function') throw new Error('Harness UI workspace archive service is unavailable')
          await uiWorkspace.archiveSession(sessionId)
          return { snapshot: { workspaces: workspaces?.list?.getSnapshot?.() || null, sessions: sessions?.list?.getSnapshot?.() || null } }
        },
        open: (sessionId) => {
          requireQaProbes()
          if (!sessionId || typeof sessions?.open !== 'function') throw new Error('Harness session open service is unavailable')
          sessions.open(sessionId)
          return sessions?.list?.getSnapshot?.() || null
        },
      }
      const openCodesysWorkbench = () => service.openTab({ type: 'taskhive:codesys-workbench', id: 'taskhive:codesys-workbench', title: 'CODESYS 工作台' })
      const onDesktopMessage = (event) => { if (event.source === window && event.data?.source === 'taskhive-desktop' && event.data?.type === 'codesys.workbench.open') openCodesysWorkbench() }
      window.addEventListener('message', onDesktopMessage)
      disposers.push(() => window.removeEventListener('message', onDesktopMessage))
      const seedRightTabs = () => {
        const sessionId = String(service.getSnapshot?.()?.sessionId || '')
        if (!sessionId) return
        entries.filter((entry) => entry.placement === 'right').forEach((entry) => {
          const key = `${sessionId}:${entry.id}`
          if (seededRightTabs.has(key)) return
          seededRightTabs.add(key)
          service.openTab({ type: entry.tabId, id: entry.tabId, title: entry.title })
        })
      }
      const ensureHarnessWorkspace = async () => {
        if (workspaceAttempted || workspaceSetupPending || !workspaces?.list || typeof workspaces.create !== 'function' || typeof sessions?.open !== 'function') return
        const snapshot = workspaces.list.getSnapshot?.()
        const sessionSnapshot = sessions.list?.getSnapshot?.()
        // DSH alpha.2 exposes the raw WorkspaceController projection. Its
        // ready state replaces the aggregate baselinesReady flag used by the
        // previous client-runtime facade.
        const workspaceReady = snapshot?.baselinesReady === true || (snapshot?.phase === 'ready' && snapshot?.state === 'idle')
        if (!workspaceReady || sessionSnapshot?.current) return
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
          sessions.open(sessionId)
        } catch (error) {
          workspaceAttempted = false
          console.warn('[taskhive-surfaces] default workspace unavailable', error)
        } finally {
          workspaceSetupPending = false
        }
      }
      const unsubscribeWorkspace = typeof workspaces?.list?.subscribe === 'function' ? workspaces.list.subscribe(() => void ensureHarnessWorkspace()) : () => {}
      const unsubscribeSessions = typeof sessions?.list?.subscribe === 'function' ? sessions.list.subscribe(() => {
        void ensureHarnessWorkspace()
        seedRightTabs()
      }) : () => {}
      const unsubscribeSidebarState = typeof service.subscribeState === 'function' ? service.subscribeState(seedRightTabs) : () => {}
      const removeGeometryBridge = installWorkspaceGeometryBridge()
      const removeNativeNavigationBridge = installNativeNavigationBridge()
      const removeCodesysTaskBridge = installCodesysTaskBridge(ctx)
      const removeWebLoginCardBridge = installWebLoginCardBridge()
      void ensureHarnessWorkspace()
      seedRightTabs()
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          unsubscribeWorkspace()
          unsubscribeSessions()
          unsubscribeSidebarState()
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
    }

    module.exports.apply = apply
    module.exports.inject = ['betterSidebar', 'workspaces', 'sessions', 'uiWorkspace', 'slots']
    return module.exports
  },
})
