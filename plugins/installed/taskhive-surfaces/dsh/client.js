// GENERATED FILE — DO NOT EDIT.
// Assembled from ./src/*.js (in filename order) by tools/build-client-bundle.js.
// The DSH client loader resolves modules from a static table, so this bundle has
// to stay one file: edit the fragments, then rebuild with --write.
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
    //
    // T162 修正：旧实现只把 `guid|name|声明长度|实现长度` 喂进哈希 —— 于是
    // `bStart`→`bStop`、`TRUE`→`FALS`、`Axis1`→`Axis2` 这类**等长替换**签名字节完全相同，
    // 而下游用签名决定"要不要重建 + 重新发布工程快照" → 模型读到的整工程代码会**永久停在
    // 写入前**（上面那句注释"即工程对象本身变了"与旧实现并不等价）。现在直接哈希**内容**。
    // 同时按 objects 数组身份 + sourcePath 做一层 memo：`objects` 只在重新 inspect 时换新
    // 引用，所以这层缓存不会掩盖变化，也不会让每次渲染都重算 100+ KB 文本。
    //
    // T165：这一层 memo 是**按数组身份**的，而且它有一个单槽 —— 所以它只对"引用稳定"的
    // 调用方成立。buildCodesysTree 的缓存键**故意不用它**：见下面的记忆化注释（实测它在这条
    // 路径上比它想省下的开销还贵，而且在原地改写同一数组时会返回陈旧值）。
    let objectsSignatureCache = { objects: null, sourcePath: '', value: '' }

    function codesysObjectsSignature(sourcePath, objects) {
      const list = Array.isArray(objects) ? objects : []
      const key = String(sourcePath || '')
      if (objectsSignatureCache.objects === list && objectsSignatureCache.sourcePath === key) return objectsSignatureCache.value
      let chars = 0
      let hash = 2166136261
      for (const item of list) {
        const declaration = String(item?.declaration || '')
        const implementation = String(item?.implementation || '')
        chars += declaration.length + implementation.length
        const seed = `${String(item?.guid || '')}|${String(item?.name || '')}|`
        for (let index = 0; index < seed.length; index += 1) {
          hash ^= seed.charCodeAt(index)
          hash = Math.imul(hash, 16777619)
        }
        for (const text of [declaration, implementation]) {
          for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index)
            hash = Math.imul(hash, 16777619)
          }
        }
      }
      const value = `${key}|${list.length}|${chars}|${(hash >>> 0).toString(36)}`
      objectsSignatureCache = { objects: list, sourcePath: key, value }
      return value
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

    // ── buildCodesysTree 记忆化 ────────────────────────────────────────────
    // T165：工作台**每次渲染**都调用 buildCodesysTree —— 它挂在
    //   `displayObjects = [...objects, ...pendingObjects]`（50-*.js）上，而那是一个
    // **每帧新建**的数组。于是"按数组身份缓存"这条路在真实渲染里**永远命中不了**，
    // 必须靠内容签名。
    //
    // 代价随嵌套深度爆炸而不是随对象数线性增长：两趟环检测（父子成环判定 + 断环）
    // 各是 O(n·depth)。实测 1500 对象：
    //   · 扁平/二叉树（depth≈3）：3.8 ms
    //   · 链式嵌套（depth≈n）  ：23.5 ms  ← 这就是"1500 对象约 23.5 ms"的来源
    // 而它会因为**每一次按键、每一次计时器 tick、每一次拖动分隔条**重跑。
    //
    // 键 = 关键字段签名（名称/GUID/类型/层级 + 决定 kind 的旗标 + 行渲染直接读的字段），
    // 按对象逐条比较。
    //
    // 为什么**不**把既有的 codesysObjectsSignature() 拼进这个键 —— 这是实测出来的，不是偏好：
    //   · 它对 `treeItems` 是**每帧必然未命中**的（treeItems 是每帧新建的数组，而它的 memo
    //     按数组身份判等），所以每帧真跑一次全工程文本哈希。实测 1500 对象 /106890 字符：
    //     **25.35 ms** —— 比它想省下的扁平构树（3.26 ms）贵 7 倍，连最坏情况的深度嵌套构树
    //     （24.10 ms）都不如。加上它会把整个缓存键从"净赚"变成"净亏"。
    //   · 它的 memo 按身份判等 ⇒ 同一数组**原地改写**时它返回陈旧值，而这个键必须能看见原地
    //     改写（见证据 (b)）。
    //   · `codesysKindOfObject()` 对 declaration 的依赖只有三条锚定正则（VAR_GLOBAL / TYPE /
    //     UNION），把**算出来的 kind** 记进签名是对这一依赖的**精确**表达：既不用哈希，也就
    //     没有碰撞。实测全量算 kind：1500 对象 0.58 ms。
    let codesysTreeCache = { fragments: null, value: null }
    // 命中/未命中是**可观测**的：测试与日后的排查都靠这两个数字判断缓存到底有没有生效，
    // 而不是靠"感觉快了"。
    const codesysTreeCacheCounters = { hits: 0, misses: 0, lastMissAtIndex: -1, lastMissReason: '' }
    function codesysTreeCacheStats() {
      const fragments = codesysTreeCache.fragments
      return {
        hits: codesysTreeCacheCounters.hits,
        misses: codesysTreeCacheCounters.misses,
        lastMissAtIndex: codesysTreeCacheCounters.lastMissAtIndex,
        lastMissReason: codesysTreeCacheCounters.lastMissReason,
        cachedNodes: codesysTreeCache.value ? codesysTreeCache.value.nodes.length : 0,
        cachedFragments: Array.isArray(fragments) ? fragments.length : 0,
      }
    }
    function resetCodesysTreeCache() {
      codesysTreeCache = { fragments: null, value: null }
      codesysTreeCacheCounters.hits = 0
      codesysTreeCacheCounters.misses = 0
      codesysTreeCacheCounters.lastMissAtIndex = -1
      codesysTreeCacheCounters.lastMissReason = ''
    }
    // 单个对象的签名片段：**恰好**覆盖树本身及其消费者从这个对象上读到的东西 ——
    // 树结构（guid/name/type 组成的 key、parentGuid、parentName、__pendingKey）、
    // 节点种类（kind，它包含 declaration 文本的影响），以及行渲染会直接读的
    // path / hasDeclaration / hasImplementation / hasLibraryManager。
    // 覆盖不全就会在"内容变了但片段没变"时把**旧 item 引用**继续交出去，所以这里宁可写全。
    //
    // 这里做的仍然是"字符串直接比较"，不是第二个哈希 —— 所以没有碰撞，只有精确的相等。
    //
    // 两个实测结论决定了这里的写法（1500 对象，bundle 自身的 vm 上下文）：
    //   · **不要**给每个字段套 String()。模板字面量本来就做 ToString，而显式 `String(x || '')`
    //     让 V8 走泛化转换：套 = 3.25 ms，不套 = 0.91 ms，而两者输出**逐字节相等**。
    //     3.6 倍差距，正是这条键从"净亏"变成"净赚"的原因。
    //   · kind **不能**用 WeakMap 按对象身份缓存：同一对象原地改 declaration 会换 kind，
    //     缓存会返回陈旧 kind，正好破坏下面证据 (c) 要证明的不变量。每次现算（0.6 ms/1500）。
    function codesysTreeItemSignature(item) {
      if (!item || typeof item !== 'object') {
        // 非对象条目照样要有稳定且不与其他形态冲突的片段（null / 字符串 / 数字不能同码）。
        return `\u0004${typeof item}\u0001${item === null ? 'null' : String(item)}`
      }
      const kind = codesysKindOfObject(item)
      const path = item.path === undefined ? '' : (Array.isArray(item.path) ? item.path.join('/') : item.path)
      return `${item.guid || ''}\u0001${item.name || ''}\u0001${item.type || ''}`
        + `\u0001${item.parentGuid || ''}\u0001${item.__parentName || item.parentName || ''}`
        + `\u0001${item.__pendingKey || ''}\u0001${item.hasDeclaration ? '1' : '0'}`
        + `\u0001${item.hasImplementation ? '1' : '0'}\u0001${item.hasLibraryManager ? '1' : '0'}`
        + `\u0001${kind.kind}\u0001${kind.category}\u0001${path}`
    }

    // Flat objects → the real parent/child tree. A node is linked by parentGuid
    // and, for an AI-created object that has no GUID yet, by its parentName.
    //
    // The signature deliberately keeps the original `(items)` arity: the tree is a
    // pure function of the rows — the bound project path is not one of its inputs.
    //
    // The hit test is the per-object fragment ARRAY, compared element by element.
    // Two alternatives were measured and rejected:
    //   · requiring `codesysTreeCache.items === list` as well: the workbench hands
    //     this function a fresh array every render
    //     (`displayObjects = [...objects, ...pendingObjects]`), so an identity check
    //     can never pass and every render pays the full build again — the exact
    //     thing this memo exists to stop.
    //   · concatenating all fragments into ONE 113 KB string per render and
    //     comparing that: measured 3.49 ms at 1500 objects, which made a shallow
    //     1500-object project a net LOSS (build 3.26 ms). Comparing fragments one
    //     by one avoids materialising the big string and stops at nothing to stop
    //     at only when something really changed.
    function buildCodesysTree(items) {
      const list = Array.isArray(items) ? items : []
      const previous = codesysTreeCache.fragments
      const fragments = new Array(list.length)
      let identical = Array.isArray(previous) && previous.length === list.length
      let firstDifference = -1
      for (let index = 0; index < list.length; index += 1) {
        const fragment = codesysTreeItemSignature(list[index])
        fragments[index] = fragment
        if (identical && fragment !== previous[index]) { identical = false; firstDifference = index }
      }
      if (identical && codesysTreeCache.value) {
        codesysTreeCacheCounters.hits += 1
        return codesysTreeCache.value
      }
      codesysTreeCacheCounters.misses += 1
      codesysTreeCacheCounters.lastMissAtIndex = firstDifference
      codesysTreeCacheCounters.lastMissReason = !Array.isArray(previous)
        ? 'no-cache'
        : (previous.length !== list.length ? `count ${previous.length}->${list.length}` : 'item-changed')
      codesysTreeCache = { fragments, value: null }
      const tree = buildCodesysTreeUncached(list)
      codesysTreeCache.value = tree
      return tree
    }

    // The unmemoized builder. Kept separate so the cache wrapper above stays a
    // pure key check and this stays exactly the original algorithm.
    function buildCodesysTreeUncached(list) {
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
    // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：代码编辑区那一枚
    // 「在线值 开/关」开关**整段删除**了 —— 按钮、它的 React 状态、它的禁用逻辑、它的
    // title 说明，以及这里的 localStorage 记忆键定义，一个都不留。
    // 于是 `taskhive.codesys.onlineValues.inline` 现在**没有任何代码读它、也没有任何代码写它**
    // （旧装机上残留的那一条记录是无副作用的死数据，谁都不看它）。
    // 值显不显示从此只有一个判据：**是不是已经登录到应用**（`onlineLoggedIn`）——
    // 见 50-codesys-workbench.js 的读值总闸与两段内联段落表。键与状态一起删掉，而不是"留着
    // 不读"，是这个意图的可执行形式：只要它还在，下一个人就可能把它接回去。
    // 本轮 B 项（**冻结**）。用户拍板的规则原话：
    //   「登录应该是这个逻辑，登录之后就不允许修改代码，只可以查看在线变量」
    //   「同意，ai写入和手动写入都禁止，编辑栏直接被冻结」
    // 于是：已登录到应用（`state.isLoggedIn === true`）时，写入工程这条通路**整体关闭** ——
    // 不是"按钮灰掉"而已：
    //   · 代码编辑栏 `readOnly`（打不进字、不产生草稿，光标仍在）；
    //   · 「确认写入」与「载入 AI 建议」禁用（AI 提案卡片照旧可看、可放弃）；
    //   · 引擎/宿主层也拒绝写类动作（`ONLINE_WRITE_FROZEN`，见
    //     plugins/installed/codesys-monitor/scriptengine.cjs），绕过界面也写不进去。
    // 未登录时一切照旧（可编辑、提案可确认写入）—— 既有 sha 三态守卫 / 写前快照 / 原子提交 /
    // per-job 互斥 / 用户点击语义一字不动。
    // 这一行是**唯一**的"原因 + 出路"文案（按钮 title、写入条详情行、状态行共用）；
    // 禁用与失败都不许静默。
    const CODESYS_ONLINE_WRITE_FROZEN_DETAIL = '在线状态下不允许写入工程；如需修改请先退出登录（面板在线区「退出登录」）。'
    // 本轮：`readStoredFlag` / `storeFlag` 这一对旗标读写函数随开关一起删除 ——
    // 它们唯一的调用点就是那枚「在线值」开关。布局比例那两个 helper（readStoredFraction /
    // storeFraction）照旧，与在线值无关。
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
      // T167: 引擎侧的最后一道防线 —— 它在**提交那一刻**再比一次源文件 sha256，不一致就
      // 拒绝提交（避免覆盖别处刚保存的内容）。旧代码没有映射这个 code，用户看到的是一整段
      // 原始 IPC 文本，于是"写入被安全拦下"读起来像"写入失败了"。工作台在写入前已经用
      // `diff` 拦过一次（见 applyProposal），这里是并发窗口内的兜底，必须说清楚。
      if (/CODESYS_SCRIPTENGINE_SOURCE_CHANGED_DURING_ACTION|写入期间已被外部保存/.test(raw)) {
        return '写入被安全拦下：工程文件在这几秒内被外部保存过，提交已停止以避免覆盖对方刚存下的内容。写前的恢复快照仍然保留。\n请在外部确认/保存后点「刷新」重新读取工程，再重新确认写入。'
      }
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
    // 一行声明里的**类型名**（`  MaxVel : UDINT;` → `UDINT`）。只取到第一个标识符，
    // 与 codesysMonitorVariables 完全同一条正则 —— 拆出来只为一处定义、两处用。
    function codesysMonitorVariableType(line) {
      if (!codesysMonitorExpressionForLine(line)) return ''
      const cleaned = String(line).replace(/\(\*.*?\*\)/g, ' ').trim()
      const match = cleaned.match(/^[A-Za-z_][A-Za-z0-9_]*\s*(?:AT\s+%[A-Za-z0-9.*]+\s*)?:\s*([A-Za-z_][A-Za-z0-9_.]*)/)
      return match ? match[1] : ''
    }
    function codesysMonitorVariables(declaration) {
      const out = []
      const seen = new Set()
      for (const line of String(declaration || '').split('\n')) {
        const name = codesysMonitorExpressionForLine(line)
        if (!name) continue
        const key = name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ name, type: codesysMonitorVariableType(line) })
      }
      return out
    }
    // ── 稳定槽（在线值就地显示的**版面**下限，与值本身无关）────────────────────────
    //
    // 用户报障原文：「现在在线值看不出来，应该和原生ide一样有背景色，而且在线值是不是刷新
    // 一下导致根本没法正常看」。后半句的成因是：值就地跟在变量后面，值一变宽（`0` 一个字 →
    // `2048576000` 十个字），它后面那一整段代码就被**左右推**一次；每 1.5 秒推一次，人就
    // 没法读了。修法：给每个值的位置留一个**只增不减**的槽（`min-width`），值在里面换不影响
    // 后面的代码。槽宽取三者的最大值：
    //   ① 这个变量的 IEC 类型能表示的最宽文本（这张表）—— 让**第一次**观测就是终态
    //      （`UDINT` 的十进制上限正好是 10 位，所以 `0` 与 `2048576000` 占同一个槽）；
    //   ② 这个变量历史上真的见过的最宽值（工作台里那张 onlineValueSlotRef）；
    //   ③ 这一次的值本身的字符数。
    // 类型给不出上限的（REAL/LREAL 是科学计数法、STRING 长度不定、TIME/DATE 是字面量、
    // FB 实例的成员摘要是拼出来的）记 0 —— 那条路径按"历史最宽值"办，允许**首次观测时扩
    // 一次**，之后稳定（契约里两条都断言）。
    //
    // 它只影响版面：不参与任何值、不进任何写入路径；`min-width` 只是下限，值比槽宽的时候
    // 盒子跟着长 —— 绝不裁切。表里每一个数字都是该类型十进制文本的**最大**宽度。
    const CODESYS_ONLINE_VALUE_SLOT_FLOOR = {
      BOOL: 5, // FALSE
      BIT: 1,
      BYTE: 3, // 255
      SINT: 4, // -128
      USINT: 3,
      WORD: 5, // 65535
      INT: 6, // -32768
      UINT: 5,
      DWORD: 10,
      DINT: 11, // -2147483648
      UDINT: 10, // 4294967295
      LWORD: 20,
      LINT: 20,
      ULINT: 20,
      LREAL: 0,
      REAL: 0,
      TIME: 0,
      LTIME: 0,
      DATE: 0,
      LDATE: 0,
      TOD: 0,
      LTOD: 0,
      DT: 0,
      LDT: 0,
      CHAR: 3, // 'a'
      WCHAR: 3,
      STRING: 0,
      WSTRING: 0,
    }
    function codesysOnlineValueSlotFloor(type) {
      const key = String(type || '').trim().toUpperCase()
      if (!key || !Object.prototype.hasOwnProperty.call(CODESYS_ONLINE_VALUE_SLOT_FLOOR, key)) return 0
      return CODESYS_ONLINE_VALUE_SLOT_FLOOR[key]
    }
    // 一个变量要读哪些表达式：简单类型读它自己；FB 实例读它该看的成员。
    function codesysMonitorExpressionsFor(variable) {
      const type = String(variable?.type || '')
      if (!type || CODESYS_MONITOR_SCALAR_TYPE.test(type)) return [variable.name]
      if (CODESYS_MONITOR_SKIP_TYPE.test(type)) return []
      const members = CODESYS_MONITOR_FB_MEMBERS[type] || CODESYS_MONITOR_FB_FALLBACK
      return members.map((member) => `${variable.name}.${member}`)
    }
    // 用户报障原文：「codesys工作台显示到在线值太抽象了根本没法看」。现场帧（真机
    // online-result-…-149.json）里 ScriptEngine 回报的是**带类型前缀的 IEC 字面量**：
    // `INT#0`、`UDINT#2048576000`、`UINT#0`、`''`。原生 CODESYS 的在线值列显示的是
    // **值本身**（`0`、`2048576000`）。这里只做**显示**上的去前缀 —— 值一个比特都不改：
    // 发给宿主的快照仍然是原始回报（50-codesys-workbench.js），所以"绝不编造"没有被触碰。
    const CODESYS_LITERAL_TYPE_PREFIX = /^(?:BOOL|BYTE|SINT|USINT|INT|UINT|WORD|DINT|UDINT|DWORD|LINT|ULINT|LWORD|REAL|LREAL|TIME|LTIME|DATE|LDATE|TOD|LTOD|DT|LDT|STRING|WSTRING|CHAR|WCHAR|BIT)#/i
    const CODESYS_LITERAL_TIME_PREFIX = /^(?:LTOD|LDT|LT|TOD|LD|DT|T|D)#/i
    function codesysDisplayValue(raw) {
      let text = String(raw ?? '').trim()
      if (!text) return ''
      for (let pass = 0; pass < 2; pass += 1) {
        if (CODESYS_LITERAL_TYPE_PREFIX.test(text)) { text = text.replace(CODESYS_LITERAL_TYPE_PREFIX, ''); continue }
        // `T#1s` / `D#2026-1-1` 只在**已经**剥掉类型前缀之后（pass===1）才继续剥，
        // 免得把一个恰好以 `T#` 开头的枚举值误伤。`16#FF` 一律原样保留 —— 进制前缀
        // 是值的一部分（它不在类型名单里，两次都不会命中）。
        if (pass === 1 && CODESYS_LITERAL_TIME_PREFIX.test(text)) { text = text.replace(CODESYS_LITERAL_TIME_PREFIX, ''); continue }
        break
      }
      return text
    }
    // FB 实例/实现区的摘要是「名字=值」用两个空格拼起来的（`iAxis=INT#0  MaxVel=UDINT#2048576000`、
    // `Busy=BOOL#FALSE`）。逐段去前缀，而且只在 `=` **之后**那一段上做 —— 变量名绝不能被碰。
    function codesysDisplaySummary(raw) {
      const text = String(raw ?? '')
      if (!text) return ''
      return text.split(/(\s{2})/).map((part) => {
        if (!part || /^\s{2}$/.test(part)) return part
        const index = part.indexOf('=')
        if (index < 0) return codesysDisplayValue(part)
        return `${part.slice(0, index + 1)}${codesysDisplayValue(part.slice(index + 1))}`
      }).join('')
    }
    // 用户报障原文（本轮）：「在线值依然显示的太难看了，为什么不可以把在线值直接替换代码
    // 编辑区到变量？？？而且显示不全？我滚动到时候底下很多都没有加载」。
    // 样式 A 的观感是 `IF xAxis 2048576000 > MaxVel 5000 AND fbMove6DOF.Busy — THEN`：
    // 值**就地**跟在**每一个**变量 token 后面，同一行、同一段流。所以这里把一行代码切成
    // [文字, 值, 文字, 值 …] 的段落表 —— 值是插在两个文字段**之间**的独立 span，不是行尾的
    // 另一列，也不是塞进 textarea 的字符（textarea 里一个字符都不许动，那是用户手打的草稿）。
    //
    // `resolve(lowerName)` 的三种返回值就是这个函数的全部语义：
    //   null                 这个词不是要标值的变量 ⇒ 什么都不插（空行/注释/语法行保持空白）；
    //   { unknown: true }    是变量、但面板没观测到值 ⇒ 淡色 `—`（不编造、无 raw、无 tooltip）；
    //   { display, raw }     有值 ⇒ 显示 display（只去掉 IEC 类型前缀），raw 是**原始回报**，
    //                        一字不改地放进数据属性与 title。
    //
    // token 认的是**整条点号路径**（`fbMove6DOF.Busy`，不是一个 `fbMove6DOF`）：
    //   · 值因此落在整条路径**后面**（`fbMove6DOF.Busy —`），不会插进点号中间去；
    //   · 面板真的读到过这个成员就显示这个成员的值（`fbMove6DOF.Done TRUE`），读不到就 `—`；
    //   · 老规矩保留：`x` 不命中 `struct.x`（整条 `struct.x` 才是一个 token），注释里的名字
    //     先被抹成空格，所以注释里的路径不是变量。
    const CODESYS_INLINE_IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g
    function codesysInlineValueSegments(line, resolve) {
      const text = String(line ?? '')
      if (!text || typeof resolve !== 'function') return [{ text }]
      const live = text.replace(/\(\*.*?\*\)/g, ' ').replace(/\/\/.*$/, '')
      const segments = []
      let cursor = 0
      CODESYS_INLINE_IDENTIFIER.lastIndex = 0
      let token = CODESYS_INLINE_IDENTIFIER.exec(text)
      while (token) {
        const start = token.index
        const end = start + token[0].length
        const inCode = live.slice(start, end) === token[0]
        const boundedLeft = start === 0 || !/[A-Za-z0-9_.]/.test(text[start - 1])
        const boundedRight = end >= text.length || !/[A-Za-z0-9_]/.test(text[end])
        const hit = inCode && boundedLeft && boundedRight ? resolve(token[0].toLowerCase()) : null
        if (hit) {
          if (end > cursor) segments.push({ text: text.slice(cursor, end) })
          segments.push({ value: hit })
          cursor = end
        }
        token = CODESYS_INLINE_IDENTIFIER.exec(text)
      }
      if (!segments.length) return [{ text }]
      if (cursor < text.length) segments.push({ text: text.slice(cursor) })
      return segments
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
    function iconPaths(id) {
      const paths = {
        codesys: [h('rect', { x: 3, y: 4, width: 18, height: 13, rx: 1 }), h('path', { d: 'M8 21h8M12 17v4' })],
        'web-ai': [h('circle', { cx: 12, cy: 12, r: 8.5 }), h('path', { d: 'M3.8 9h16.4M3.8 15h16.4M12 3.5c2.1 2.4 3.1 5.2 3.1 8.5S14.1 18.1 12 20.5C9.9 18.1 8.9 15.3 8.9 12S9.9 5.9 12 3.5z' })],
        knowledge: [h('path', { d: 'M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 0z' }), h('path', { d: 'M5 4.5v15M8 19.5h11M9 9h6M9 12h6' })],
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
/* 宽度足够：**有标签的**动作全部展开成文字。
   本轮用户口径原文：「工作台第一行的布局，在宽度合适的时候就应该显示字，但是现在宽度很大
   才会显示字」—— 上一版的 820px 是个"凭感觉留的大余量"，它和实测宽度之间留了一条 73px 的
   **死区**（747–820px：明明放得下全文字，却只显示图标）。现在门槛按**实测**取：
   tests/codesys-workbench-compact-layout-contract.js 里那套宽度模型算出全文字一行需要
   747px（标题 37.5 + 15 个文字动作 595 + 已登录徽章 48 + 15 个 4px 间距 60 + 6px 余量），
   所以门槛 = 747 + 13px 余量 = 760px：误差被那 13px 吸收，比 820px 提前 60px 出字。
   余量**钉在契约里**（≥ 实测值、≤ 实测值 + 30px），以后再想悄悄拉高门槛会直接红灯。
   :has() 让"有文字标签就显示文字、没有就保持图标"这条规则只写一次。 */
@container taskhive-codesys (min-width: 760px) {
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
/* 本轮（写入行抽屉化）：那一行只在需要时出现，出现时第一个子元素就是"把手"。
   把手必须**零额外宽度**（否则会让上面那条可伸缩的"原因"被挤小）：padding/border 归零，
   内部间距沿用命令条原本的 5px，所以 标题 + 状态词 的占宽与改动前逐像素相同。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-handle{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-handle:focus-visible{outline:2px solid var(--th-brand-line);outline-offset:2px;border-radius:4px}
/* 收起的细节必须真的藏住：UA 的 [hidden]{display:none} 会被作者 display 规则盖掉
   （细节块自己是 flex 列），所以这里显式钉一条 !important。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-drawer[hidden]{display:none!important}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-write-drawer>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
/* 未连接时读到的"工程里配置的目标"：虚线灰底，和绿色"已连接"药丸明确区分 ——
   它表示"登录会作用到这里"，不是"现在连着这里"。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-target-chip.is-project{border-style:dashed;color:var(--th-ink-3)}
/* 扫描设备行上的来源标注：缓存轮 / 实时广播 / 回退，三种可信度必须一眼分开。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-scan-source{flex:none;font-size:9px;line-height:1.4;white-space:nowrap;color:var(--th-ink-3)}
/* 共享连接提示：一行小字，只是提示；它不做任何决策。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-online-shared{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;line-height:1.3;color:var(--th-ink-3)}
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
  /* 本轮 A 项（用户报障原文：「现在在线值看不出来，应该和原生ide一样有背景色」）：
     在线值就地画在代码里，只有灰蓝的字**看不出来"这一段是值"**。所以给值一块克制的
     底色（原生 CODESYS 在线视图也是"值有自己的底色"）。两个令牌，不是散落的字面色：
       · --th-value-bg          真值的底色：浅蓝（品牌色的极淡版），与代码底色
                                （--th-surface = #fff）和代码墨色（--th-ink = #1b2233）都不同；
       · --th-value-unknown-bg  未知破折号的底色：更淡的中性灰 —— **不许比真值显眼**。
     只有浅色一种主题：这份皮肤是单套 :root 调色板（全仓没有 prefers-color-scheme /
     [data-theme] 的深色分支），所以这两个令牌只需一组值。将来若加深色主题，改这里即可。 */
  --th-value-bg:#e8eefc;
  --th-value-unknown-bg:#f2f3f7;
  --th-ok:#2f7d5b;
  --th-ok-tint:#eaf6f0;
  --th-ok-line:#c4e2d3;
  --th-warn:#a86a12;
  --th-warn-tint:#fdf6e8;
  --th-warn-line:#efdab3;
  --th-danger:#c0392b;
  /* 本轮（用户口径原文：「错误行标红/警告行标黄」）：编译明细按严重级别着色。
     四个令牌一组，**颜色不写散在业务代码里** —— 渲染层只挂 is-error / is-warning
     这两个既有 class，涂色全部由这里的令牌 + 下面三条规则决定：
       · --th-error-ink  错误行的字：比 --th-danger 更深一档（#8c2418 对 #c0392b），
                         因为现在它压在一块淡红底上，深字才够对比；
       · --th-error-bg   错误行的底：极淡的红（--th-danger 的淡版），不是荧光红；
       · --th-warn-ink   警告行的字：比 --th-warn 更深一档（#754700 对 #a86a12），
                         同样是为了压在淡琥珀底上够对比；
       · --th-warn-bg    警告行的底：极淡的琥珀（--th-warn-line 的淡版）。
     可读性：淡底 + 深字，两条对比都在 7:1 以上（实测 错误 7.82:1 / 警告 7.39:1，都按 WCAG
     相对亮度算）；左侧另有一道 3px 色条（用 box-shadow inset 画，不占盒子尺寸，所以
     行高/换行/滚动**一格都不动**）。色相：错误红 6.2°、警告琥珀 36.4°，一眼分得开。
     深色主题：这份皮肤是单套浅色 :root 调色板（见上面 --th-value-bg 的说明：全仓没有
     prefers-color-scheme / [data-theme] 的深色分支），所以只有浅色一组值。
     将来若加深色主题，改这四个令牌即可。 */
  --th-error-ink:#8c2418;
  --th-error-bg:#fdeeec;
  --th-warn-ink:#754700;
  --th-warn-bg:#fdf7e8;
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
/* T228 严重级别着色（用户口径原文：「错误行标红/警告行标黄」）：[Error] 行红、[Warning] 行
   黄，[Info] 行与口径说明行保持中性（不抢眼）。三条规则与上面三条**同一个选择器**
   （各单类），所以不吃 !important —— 谁最后写谁赢，is-error 与 is-warning 各自的那一条
   互不覆盖，is-info 不参与着色（仍是 --th-ink-2，与说明行、空报告行同一个颜色）。
   可读性：**淡底 + 深字**（--th-error-bg + --th-error-ink = 7.82:1；--th-warn-bg +
   --th-warn-ink = 7.39:1），不是高饱和荧光；左侧那道 3px 色条用 box-shadow inset 画 ——
   它不参与布局，所以**行高 / 内边距 / 换行 / 滚动行为一格都不动**（这三样这四条规则里
   一个字都没写），gutter 仍归容器的 padding 管，选中/复制出来的 textContent 逐字不变。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-error{background:var(--th-error-bg);color:var(--th-error-ink);box-shadow:inset 3px 0 0 var(--th-danger);border-radius:3px}
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.is-warning{background:var(--th-warn-bg);color:var(--th-warn-ink);box-shadow:inset 3px 0 0 var(--th-warn);border-radius:3px}
/* T227 明细视图：**全量平铺**（T225 的分组行 + 「展开查看全部 N 条」按钮已删除，所以
   \`.taskhive-codesys-compile-more\` 的三条规则也一并删掉 —— 没有那颗按钮了）。
   列表本身已经由 .taskhive-codesys-compile-body 的 max-height:180px / overflow:auto 兜住滚动；
   这里只给容器一个块级、可收缩的最小宽度。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-lines{display:block;min-width:0}
/* T226 口径说明：头部只有"错误 N · 警告 M"两个数，汇总与明细的差异（含载入上限）只在这里出现
   ——安静的一行，不抢注意力、没有徽章。T227：明细不再折叠，所以这几行**直接显示在明细列表上方**
   （不必先点开任何按钮；不需要解释时一行都不渲染）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-note{display:block;margin:0 0 3px;color:var(--th-ink-2);font-size:10px;white-space:pre-wrap;word-break:break-word}
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
/* 本轮（样式 A，用户报障原文：「在线值依然显示的太难看了，为什么不可以把在线值直接替换
   代码编辑区到变量？？？而且显示不全？我滚动到时候底下很多都没有加载」）：值不再占第三列，
   而是**就地**紧跟每一个变量 token（同一行、同一段流），所以这里再也没有 minmax(...) 固定
   值列、没有值列上的 overflow:hidden、没有省略号 —— 没有任何东西能裁掉一个值。
   镜像层与 textarea 共用同一套字体/行高/内边距，第 N 行永远对齐左边栏的第 N 行。
   ⚠ 盒子的 overflow 必须是 visible：这一层是靠在 syncScroll 里
   translate(-scrollLeft, -scrollTop) 跟随代码滚动的，而 overflow:hidden 会把**超出自身
   盒子**的内容就地裁掉 —— 平移就永远只能露出开头十几行，那正是"滚到底很多行没值"的成因。
   唯一的窗口裁剪交给上层 .taskhive-codesys-editor-surface 的 overflow:hidden。 */
/* ⚠ 这一层的文字颜色**必须是正文墨色**（--th-ink = #1b2233），不能是 transparent。
   用户报障原文：「开启在线值后会把原来的代码编辑区给覆盖掉，变成一片白和监控过来的值」。
   成因就是这里：打开开关时 textarea 的字被 .is-inline-mirrored 透明化（下面那条规则），
   而这一层又把**代码文字**也画成透明（color:transparent 由普通字符串段落继承），于是
   屏幕上只剩下那几个有自己颜色的值 span —— 代码整段消失，"一片白 + 值"。
   契约（本轮）：代码由**这一层**负责显示（正常前景色），只有值 span 用灰蓝（--th-ink-2）；
   这一段代码文字与 textarea 的对应行**逐字符相等**（值 span 之外一个字符都不差），
   字体/字号/行高/内边距/1px 边框抵消与 textarea 相同 ⇒ 第 N 行永远对齐第 N 行。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-online{position:absolute;top:0;right:0;bottom:0;left:0;box-sizing:border-box;border:1px solid transparent;padding:8px 10px;overflow:visible;pointer-events:none;user-select:none;color:var(--th-ink);background:transparent;white-space:pre;tab-size:2;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
/* ⚠ 这一层（和下面的底色层）都**故意不写** will-change:transform：它们的盒子只有一屏高，
   内容却有整份代码那么长（1000 行 ≈ 16000px）。overflow:visible 遇上 will-change 会让浏览器
   按内容尺寸建一张巨大的合成层（1000 行 × 700px × 4B ≈ 45MB，两个区 90MB），而一个
   scroll 同步的 transform 本来就不需要这个提示。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-line{display:block;box-sizing:border-box;height:15.95px}
/* 值：同字号，但有**克制的底色块**（--th-value-bg = #e8eefc）+ 左右各 3px 内边距 +
   2px 圆角 ⇒ 一眼就能看出"这一段是值"（原生 IDE 的在线值就是这个观感），不再是"只是一段
   更浅的灰蓝字"。底色令牌与代码墨色（--th-ink）、编辑区底色（--th-surface）都不同 ——
   契约里按令牌解析逐条比。
   ⚠ 值 span 仍然是同字号、同一段文字流里的一段（没有方框/边框/chip/括号）；内联元素的
   padding 不影响行高，所以镜像层每一行仍然是 15.95px，和 textarea 的行一一对应。
   ⚠ display:inline-block 是**必须**的：min-width 对非替换 inline 元素不生效，而每个值
   的稳定槽宽（min-width:calc(Nch + 6px)，由 50-codesys-workbench.js 逐值内联给出）正是
   "值一变不把后面的代码左右推"的全部依靠。inline-block 的基线就是它最后一行文字的基线，
   所以纵向对齐与行高都不变。
   ⚠ 只有**值自己有底色**：代码文字继承镜像层的 --th-ink（上面那条规则），值与代码既不同色
   也不同底 ⇒ "哪一段是值"永远看得出来（本轮契约：底色存在且 ≠ 背景、≠ 代码色）。
   ⚠ 这里一个能裁字的属性都没有（no overflow:hidden / text-overflow / white-space:nowrap）：
   min-width 只是下限，值比槽宽时盒子跟着长，长值永远完整可见。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-value{color:var(--th-ink-2);background:var(--th-value-bg);padding:0 3px;border-radius:2px;display:inline-block;box-sizing:border-box;font:inherit}
/* 未知（这里真的有变量、但面板还没观测到值）：压得更淡的一个破折号 + 更淡的中性底，
   不跟真值抢注意力（契约：未知的底色必须比真值的底色更淡）。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-inline-value.is-unknown{color:var(--th-ink-3);background:var(--th-value-unknown-bg);opacity:.6}
/* 值在镜像层里画，所以已登录（值就地显示）时 textarea 自己的字要让位（否则同一段代码被画两遍、
   内联值还会盖住后面的代码）。光标颜色单独保留 —— 光标仍然由 textarea 画。
   ⚠ 让位的**只有**"已登录、值正在显示"的那一种状态（.is-inline-mirrored 只在 showInline 时挂上）：
   未登录（或退出登录）这一层整个不渲染、这个类消失 ⇒ textarea 立刻恢复自己的正文颜色（原样）。
   代码文字的可见性因此有且只有两个来源：未登录 = textarea 自己画；已登录 = 镜像层画
   （--th-ink）。任何时候都**不存在**"两边都不画"的状态 —— 那就是用户看到的那片白。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-code-editor.is-inline-mirrored{color:transparent!important;caret-color:var(--th-ink)}
/* 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：那一枚「在线值 开/关」
   按钮**整段删除**了，所以它这一组四条样式规则（.taskhive-codesys-editor-online 的常态、
   [aria-pressed="true"]、.is-live 与 :disabled）也一起删除 —— 没有控件就没有样式。
   值显不显示只由登录状态决定；代码区里因此不再有任何"看不看值"的按钮。 */
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
/* ⚠ 这一层的 overflow 必须是 visible，与上面内联值镜像层同一个原因：它是靠 transform
   跟随代码滚动的，而 overflow:hidden 会把超出自身盒子的行就地裁掉，于是"改动行"的底色
   在十几行之后就再也没有了 —— 平移永远露不出被裁掉的内容。窗口裁剪由上层 surface 负责。 */
[data-taskhive-codesys-workbench="true"] .taskhive-codesys-editor-highlights{position:absolute;top:0;right:0;bottom:0;left:0;padding:8px 0;pointer-events:none;overflow:visible}
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
      // T128 / INV-2：用户要求与 1.0.3 形态一致——「归档会话」下面那一项就叫**「删除会话」**
      // （早前叫「彻底删除」）。位置与行为不变：克隆归档项插在其后，先删文件再归档。
      const SESSION_DELETE_LABEL = '删除会话'
      const sessionMenuDelete = { row: null, busy: false }
      const sessionSummariesById = () => {
        const byId = getOptionalService(ctx, 'sessions')?.list?.getSnapshot?.()?.byId
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
        const active = String(getOptionalService(ctx, 'sessions')?.list?.getSnapshot?.()?.current || '')
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
          try { await archiveSessionFromContext(ctx, resolved.id) } catch { /* 文件已删，归档失败只影响列表刷新 */ }
          await noticeDialog('已删除', `回收 ${formatSessionBytes(done.bytes)}。`)
        } finally { sessionMenuDelete.busy = false }
      }
      const injectSessionDeleteMenuItem = () => {
        // T128 实测根因（第三次，也是真正的原因）：DSH 0.2 的菜单项结构是
        //   <button role="menuitem"><span class="_itemLabel_…">归档会话</span><span>Ctrl+Alt+A</span></button>
        // 原锚点用 `/^归档会话$/` 全等匹配**节点文本**，且选择器列表
        // `[role="menuitem"],button,[role="button"],li,div` **不含 span**：
        //   · `[role="menuitem"]` 的 textContent 是「归档会话Ctrl+Alt+A」→ 全等不成立；
        //   · 纯文本的 `<span>` 又不在选择器里 → 永远匹配不到。
        // 实测证据：菜单打开后 `[data-taskhive-session-delete]` 始终不存在。
        // 改为按「以 归档会话 开头」匹配菜单项本身，再克隆整项插到它后面。
        const archiveItem = [...document.querySelectorAll('[role="menuitem"]')]
          .find((node) => /^(?:归档会话|Archive session)/i.test(String(node.textContent || '').trim()))
        if (!archiveItem) return false
        const list = archiveItem.parentElement
        if (!list || list.querySelector('[data-taskhive-session-delete="true"]')) return false
        const clone = archiveItem.cloneNode(true)
        clone.setAttribute('data-taskhive-session-delete', 'true')
        clone.removeAttribute('aria-keyshortcuts')
        // 标签：把克隆里那个纯文本「归档会话」换成「删除会话」，并清掉快捷键提示节点，
        // 保留图标与结构（结构与悬停行为自动与原生项一致）。
        const leafLabel = [...clone.querySelectorAll('*')].find((node) => node.children.length === 0 && /^(?:归档会话|Archive session)/i.test(String(node.textContent || '').trim()))
        if (leafLabel) leafLabel.textContent = SESSION_DELETE_LABEL
        else clone.textContent = SESSION_DELETE_LABEL
        for (const node of clone.querySelectorAll('*')) {
          if (node === leafLabel || node.children.length !== 0) continue
          const t = String(node.textContent || '').trim()
          if (/^(?:Ctrl|Alt|Shift|⌘|\+|[A-Z])/.test(t) || /Ctrl\+/.test(t)) node.textContent = ''
        }
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
        // T128 实测修正（第二次）：会话操作菜单是**点击之后**才渲染的，而 observer 的那一趟
        // 往往在菜单出现之前就结束了，所以只靠 scrub 里的条件永远赶不上。这里在点击会话行
        // 或它的操作按钮之后安排几次延迟注入，覆盖菜单渲染时机。注入函数幂等，重复调用安全。
        const label = String(event.target?.getAttribute?.('aria-label') || '')
        if (row || /操作|归档会话/.test(label)) {
          for (const delay of [0, 120, 400, 900]) {
            setTimeout(() => { try { injectSessionDeleteMenuItem() } catch { /* 注入失败不影响点击本身 */ } }, delay)
          }
        }
      }
      document.addEventListener('click', rememberSessionRow, true)

      const scrub = (root = document, isDocument = root === document) => {
        const dialogOpen = Boolean(document.querySelector('[aria-modal="true"]'))
        // T093: 会话行「…」菜单里的「彻底删除」。只在刚点过会话行之后才做，避免每次
        // scrub 都全文档查菜单。
        // T128 实测修正：原先只认 `sessionMenuDelete.row`，而点开菜单时 observer 的这一趟
        // 可能已经跑过，于是「删除会话」永远不会出现（CDP 实测：菜单里只有取消置顶/重命名/
        // 分叉会话/归档会话，`[data-taskhive-session-delete]` 不存在）。改为**只要会话操作
        // 菜单当前是打开的**就补注入一次；注入函数自身有幂等判断，重复调用无副作用。
        const sessionMenuOpen = Boolean(document.querySelector('[role="menu"]'))
        if (sessionMenuDelete.row || sessionMenuOpen) injectSessionDeleteMenuItem()
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

    // Surface chrome (Settings / 模型 / 知识库 tabs). These previously
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
          h('div', { style: surfaceStyles.row }, h('span', null, h('strong', null, provider.name), h('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary, #666)' } }, `${provider.state} · ${provider.authentication || '未声明认证'} · ${provider.vision?.state === 'ready' ? '视觉已就绪' : provider.kind === 'web' ? '网页模型不接管视觉' : '视觉未接入'}`)), provider.custom ? h('button', { type: 'button', style: surfaceStyles.button, title: '删除自定义模型提供方', onClick: () => remove(provider.id) }, '删除') : null),
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
      // T136：改完位置后立即让客户端重注册入口（左栏/右栏/隐藏），否则下拉"看起来生效、
      // 实际左栏入口还在、右栏也没有东西"。
      const place = async (item, placement) => { try { await window.taskhive.setPluginPlacement({ id: item.id, placement }); await window.__TASKHIVE_REFRESH_PLACEMENTS__?.(); await reload() } catch (error) { setMessage(error.message) } }
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

    // ── 知识库视图：T127 卡片 → T138 客户端级 → T141 书架/书本 ───────────────
    // 用户口径（2026-10-02，最新）：
    //   "知识库背景色依然为白色"
    //   "知识库要有分类可自己整理目录"
    //   "已经入库的自动整理成带目录的书本，书本自动分类，首页先展示书本"
    //
    // 设计：
    //   首页 = 书架，先展示**书本**（一本 = 一个目录/分类），每本书显示封面、章数、目录预览；
    //   点开一本书 → 目录（可跳转）+ 各章卡片；每张卡片都能"移动到…"别的书或新建目录；
    //   未指定目录的卡片按关键词**自动归入**一本书（kbCategoryOf）。
    //   背景保持白色（宿主主题是纯黑白，本视图只用书脊/指标/状态做点缀，不再铺暖色底）。
    //
    // 数据来源（只读 + 用户主动改目录）：knowledge/cards.json、knowledge/repositories/*/knowledge.json。
    // 边界：索引只做外链，不自动安装、不执行任何仓库代码。

    const KB_SPINES = ['#3b6fd4', '#c2694a', '#4f8a6b', '#8a6bbf', '#c9a227', '#2f7f8f', '#b8486b', '#5b6b7c']
    // T152：自动分类结果缓存（见 kbCategoryOf），避免每帧对每张卡重跑正则链。
    const kbCategoryCache = new Map()
    const kbSpineOf = (seed) => {      const text = String(seed || 'x')
      let hash = 0
      for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 9973
      return KB_SPINES[hash % KB_SPINES.length]
    }
    // 自动分类规则（先命中先归类）：让"已入库"的卡片自己整理成带名字的书。
    const KB_AUTO_RULES = [
      [/会话|对话|session|chat|标题|title/i, '会话与标题'],
      [/模型|推理|model|llm|gpt|deepseek|claude|codex/i, '模型与推理'],
      [/插件|目录|plugin|catalog|安装|install|仓库|repository/i, '插件与目录'],
      [/codesys|plc|workbench|工控|脚本|script/i, 'CODESYS 与工控'],
      [/浏览器|网页|browser|web|登录|login|标签页/i, '浏览器与网页'],
      [/记忆|知识|沉淀|memory|knowledge/i, '记忆与知识'],
      [/终端|命令|文件|terminal|shell|file|进程/i, '终端与文件'],
      [/界面|布局|主题|样式|layout|theme|css|skin/i, '界面与主题']
    ]
    const kbCategoryOf = (card) => {
      const explicit = String((card && card.category) || '').trim()
      if (explicit) return explicit
      // T152：分类要先跑 8 条正则 + 拼全文，而它每帧会被多张卡各调用 2–3 次。
      // 按 (id, updatedAt) 缓存结果 —— 内容不变就不重复跑正则。
      const key = `${(card && card.id) || ''}:${(card && card.updatedAt) || ''}`
      const cached = kbCategoryCache.get(key)
      if (cached) return cached
      const title = String((card && card.title) || '')
      const content = String((card && card.content) || '')
      const tags = ((card && card.tags) || []).map(String)
      const text = `${title} ${content} ${tags.join(' ')}`
      let name = ''
      for (const [re, rule] of KB_AUTO_RULES) { if (re.test(text)) { name = rule; break } }
      if (!name) {
        const label = tags.map((t) => t.trim()).find((t) => t && t.length <= 12 && /[\u4e00-\u9fa5]/.test(t))
        name = label || '未分类'
      }
      if (kbCategoryCache.size > 4000) kbCategoryCache.clear()
      kbCategoryCache.set(key, name)
      return name
    }

    // ── T142 标题/目录/内容"提纯" ────────────────────────────────────────────
    // 用户口径："目录、标题、知识库要自己生成提纯"。
    // 原始沉淀卡片往往是"对话总结候选：text Current runtime context. Thi…"这类脏标题，
    // 直接展示不可读。这里做确定性清洗：去代码围栏/URL/长哈希/角色前缀/markdown 记号，
    // 收拢空白，按句子边界截断 → 得到可直接当标题与目录项用的短文本。
    const KB_NOISE = [
      /```[\s\S]*?```/g,
      /`[^`]{0,200}`/g,
      /https?:\/\/\S+/g,
      /\b[0-9a-f]{16,}\b/gi,
      /\b(?:tool[_-]?call|tool[_-]?result|assistant|system|user)\b\s*[:：]?/gi,
      /^\s*[-*•]\s+/gm
    ]
    const kbCleanText = (input, limit) => {
      let text = String(input == null ? '' : input)
      for (const re of KB_NOISE) text = text.replace(re, ' ')
      text = text.replace(/[`*_>#|]+/g, ' ').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
      const max = limit || 160
      if (text.length <= max) return text
      const cut = text.slice(0, max)
      const boundary = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'), cut.lastIndexOf('. '), cut.lastIndexOf('，'))
      return `${(boundary > max * 0.5 ? cut.slice(0, boundary + 1) : cut).trim()}…`
    }
    // 标题提纯：剥掉"对话总结候选：/问题：/结论："这类机器前缀，再用正文兜底。
    const kbTitleOf = (card) => {
      const raw = String((card && card.title) || '')
        .replace(/^\s*(?:对话)?(?:总结)?候选\s*[:：]\s*/, '')
        .replace(/^\s*(?:问题|结论|标题|摘要|总结)\s*[:：]\s*/, '')
      const clean = kbCleanText(raw, 44)
      if (clean && clean.length >= 2) return clean
      const fallback = kbCleanText((card && card.content) || '', 44)
      return fallback || String((card && card.id) || '未命名')
    }
    const kbSummaryOf = (card) => kbCleanText((card && card.content) || '', 200)
    // T146：文档正文的"提纯"——保留段落结构（阅读要分段），只去掉代码围栏记号与多余空行。
    const kbDocBody = (card) => {
      let text = String((card && card.content) || '')
      text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      return text || '（无正文）'
    }
    const kbDocText = (name, items) => [`《${name}》`, '', ...items.flatMap((card, i) => [`${i + 1}. ${kbTitleOf(card)}`, '', kbDocBody(card), ''])].join('\n')

    // ── T166 目录树：从**既有**书籍数据推导"书 → 章 → 小节"层级 ───────────────
    // 用户口径（2026-10）：「知识库的目录点进去，目录和书签一样在左侧展开可以折叠，
    // 和真实的 word 一样」。层级完全从现有数据读出来 —— 不改数据结构、不要求重新导入：
    //   0 级 = 当前这本书，1 级 = 章（一张已入库卡片），2 级及以下 = 正文里可识别的小标题。
    // 小标题只认下面几种**明确记号**（避免把正文里的普通列表误认成小节）；
    // 认不出来就只有"章"这一级，正文一个字都不改（切块用的是提纯后的原文）。
    const KB_TOC_HEAD_PATTERNS = [
      [/^(#{2,6})\s+(.{1,80})$/, (m) => ({ depth: Math.min(m[1].length + 1, 4), text: m[2].trim() })],
      [/^(\d+(?:\.\d+)+)[.、]?\s+(.{1,80})$/, (m) => ({ depth: Math.min(m[1].split('.').length + 1, 4), text: `${m[1]} ${m[2].trim()}` })],
      [/^(第[一二三四五六七八九十百零〇\d]{1,4}[章节節])\s*[、.:：]?\s*(.{0,60})$/, (m) => ({ depth: 2, text: `${m[1]}${m[2] ? ` ${m[2].trim()}` : ''}` })],
      [/^([（(][一二三四五六七八九十百]{1,3}[）)]|[一二三四五六七八九十百]{1,3}[、.])\s*(.{2,60})$/, (m) => ({ depth: 3, text: `${m[1]} ${m[2].trim()}` })]
    ]
    const kbHeadingOf = (line) => {
      const text = String(line == null ? '' : line).trim()
      // 空行、超长行、以句读收尾的句子都不当标题 —— 宁可少一层，也不要把正文切碎。
      if (!text || text.length > 90 || /[。；;，,]$/.test(text)) return null
      for (const [re, build] of KB_TOC_HEAD_PATTERNS) {
        const match = text.match(re)
        if (match) return build(match)
      }
      return null
    }
    // 章节正文切块：小标题行**原样保留**（渲染成带锚点的小标题），其余行合并成正文块。
    const kbChapterBlocks = (card) => {
      const lines = kbDocBody(card).split('\n')
      const blocks = []
      let buffer = []
      const flush = () => { if (buffer.length) { blocks.push({ kind: 'text', text: buffer.join('\n') }); buffer = [] } }
      for (const line of lines) {
        const head = kbHeadingOf(line)
        if (!head) { buffer.push(line); continue }
        flush()
        blocks.push({ kind: 'head', text: head.text, depth: head.depth, anchorId: `kb-doc-${(card && card.id) || 'x'}-b${blocks.length}` })
      }
      flush()
      return blocks.length ? blocks : [{ kind: 'text', text: kbDocBody(card) }]
    }
    // 小标题按"记号深度"嵌套成树；绝对层级由父子关系决定（第一个小标题永远是 2 级）。
    const kbSectionsOf = (card) => {
      const roots = []
      const stack = []
      for (const block of kbChapterBlocks(card)) {
        if (block.kind !== 'head') continue
        const node = { key: block.anchorId, title: block.text, anchorId: block.anchorId, depth: block.depth, level: 2, children: [] }
        while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop()
        const parent = stack[stack.length - 1]
        if (parent) { node.level = Math.min(parent.level + 1, 4); parent.children.push(node) } else roots.push(node)
        stack.push(node)
      }
      return roots
    }
    // 一本书 → 目录树（根节点 = 这本书）。
    const kbTocOfBook = (name, items) => ({
      key: `book:${name}`,
      title: String(name || '未命名'),
      anchorId: '',
      level: 0,
      children: (items || []).map((card, index) => ({
        key: `ch:${card.id}`,
        title: `${index + 1}. ${kbTitleOf(card)}`,
        anchorId: `kb-doc-${card.id}`,
        level: 1,
        children: kbSectionsOf(card)
      }))
    })
    // 默认展开到二级：0/1 级默认展开（书 → 章 → 小节可见），更深的默认折叠。
    const kbTocNodeOpen = (node, openMap) => {
      const value = openMap ? openMap[node.key] : undefined
      return value === undefined ? node.level <= 1 : value === true
    }
    const kbVisibleToc = (root, openMap) => {
      const out = []
      const walk = (list) => {
        for (const node of list) {
          out.push(node)
          if (node.children && node.children.length && kbTocNodeOpen(node, openMap)) walk(node.children)
        }
      }
      if (root) walk([root])
      return out
    }
    const kbTocAnchors = (root) => {
      const out = []
      const walk = (list) => {
        for (const node of list) {
          if (!node) continue
          if (node.anchorId) out.push(node.anchorId)
          if (node.children && node.children.length) walk(node.children)
        }
      }
      if (root) walk([root])
      return out
    }
    // 从根到某个锚点的祖先 key 链（用于"高亮的小节必须可见"自动展开）。
    const kbTocPath = (root, anchorId) => {
      const found = []
      const walk = (list, trail) => {
        for (const node of list) {
          if (node.anchorId && node.anchorId === anchorId) { found.push(...trail); return true }
          if (node.children && node.children.length && walk(node.children, [...trail, node.key])) return true
        }
        return false
      }
      if (root) walk([root], [])
      return found
    }
    // 当前章节：最后一个"顶边已经越过阅读区顶部"的锚点；一个都没越过时取第一个。
    // 纯函数（只吃测量值），组件只负责把 getBoundingClientRect 的结果填进来。
    const kbActiveAnchor = (measured, offset) => {
      let active = ''
      for (const item of measured || []) {
        if (!item || !item.id || !Number.isFinite(Number(item.top))) continue
        if (Number(item.top) <= offset) active = item.id
      }
      if (active) return active
      const first = (measured || []).find((item) => item && item.id && Number.isFinite(Number(item.top)))
      return first ? first.id : ''
    }
    const kbScrollIntoAnchor = (id) => {
      if (!id || typeof document === 'undefined' || typeof document.getElementById !== 'function') return false
      const node = document.getElementById(id)
      if (node && typeof node.scrollIntoView === 'function') { node.scrollIntoView({ block: 'start', behavior: 'smooth' }); return true }
      return Boolean(node)
    }
    const kbIsNarrowScreen = () => {
      try { return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 900px)').matches === true } catch { return false }
    }
    const kbBytes = (value) => {
      const size = Number(value) || 0
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / (1024 * 1024)).toFixed(2)} MB`
    }
    // T166b：把"按书"的预检明细加成整份摘要。渲染层**只做加法** —— 每一行的数字都是主进程
    // 用与真正合并同一套判定算出来的（knowledgeBookPreview → knowledgeBundleSummary），
    // 所以勾选变化后预览与最终写入不可能不一致。
    const kbSumBookSummaries = (rows) => {
      const cards = { total: 0, added: 0, updated: 0, keptLocal: 0, identical: 0 }
      const books = { total: 0, added: 0, updated: 0, identical: 0 }
      for (const row of rows || []) {
        const summary = (row && row.summary) || {}
        for (const key of Object.keys(cards)) cards[key] += Number((summary.cards || {})[key] || 0)
        for (const key of Object.keys(books)) books[key] += Number((summary.books || {})[key] || 0)
      }
      return { cards, books }
    }

    const KNOWLEDGE_VIEW_CSS = `
[data-taskhive-knowledge]{
  --kb-ink:#1f2328; --kb-ink-2:#5c6470; --kb-ink-3:#8b919b;
  --kb-line:rgba(24,26,30,.14); --kb-line-2:rgba(24,26,30,.08);
  --kb-cell:#f7f8fa; --kb-r:14px; --kb-rs:10px;
  display:grid;gap:16px;padding:18px 20px 30px;
  font-family:Inter,"Microsoft YaHei",system-ui,sans-serif;
  color:var(--kb-ink);background:#fff;box-sizing:border-box;max-height:100%;overflow:auto;align-content:start;
}
[data-taskhive-knowledge] *{box-sizing:border-box}
[data-taskhive-knowledge] button,[data-taskhive-knowledge] input,[data-taskhive-knowledge] select{font:inherit}

/* ── 页头（白底 + 一条细线，不用色块） ─────────────────── */
[data-taskhive-knowledge] .tk-hero{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-brand{display:flex;gap:12px;align-items:center;min-width:0}
[data-taskhive-knowledge] .tk-brand-mark{width:42px;height:42px;flex:0 0 auto;border-radius:12px;display:grid;place-items:center;color:#fff;background:linear-gradient(150deg,#4f7fe0,#3b6fd4)}
[data-taskhive-knowledge] .tk-title{margin:0;font-size:18px;font-weight:680;color:var(--kb-ink)}
[data-taskhive-knowledge] .tk-sub{margin:3px 0 0;font-size:12.5px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-hero-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-search{display:flex;align-items:center;gap:7px;min-width:230px;flex:1 1 250px;max-width:340px;height:36px;padding:0 11px;border-radius:11px;border:1px solid var(--kb-line);background:#fff;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-search:focus-within{border-color:#3b6fd4;box-shadow:0 0 0 3px rgba(59,111,212,.14)}
[data-taskhive-knowledge] .tk-search input{flex:1 1 auto;min-width:0;border:0;outline:0;background:transparent;color:var(--kb-ink);font-size:13px}
[data-taskhive-knowledge] .tk-search input::placeholder{color:var(--kb-ink-3)}

/* ── 指标 ───────────────────────────────────────────────── */
[data-taskhive-knowledge] .tk-stats{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(136px,1fr))}
[data-taskhive-knowledge] .tk-stat{position:relative;display:grid;gap:2px;padding:12px 14px 12px 16px;border-radius:12px;border:1px solid var(--kb-line-2);background:#fff;text-align:left;cursor:pointer;overflow:hidden;transition:box-shadow .12s ease,border-color .12s ease}
[data-taskhive-knowledge] .tk-stat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tone,#3b6fd4)}
[data-taskhive-knowledge] .tk-stat:hover{box-shadow:0 6px 16px rgba(24,26,30,.08);border-color:var(--kb-line)}
[data-taskhive-knowledge] .tk-stat-n{font-size:21px;font-weight:680;line-height:1.1;font-variant-numeric:tabular-nums}
[data-taskhive-knowledge] .tk-stat-l{font-size:11.5px;color:var(--kb-ink-2)}

/* ── 工具栏 ─────────────────────────────────────────────── */
[data-taskhive-knowledge] .tk-controls{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:3px;border-radius:12px;background:var(--kb-cell);border:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-tab{appearance:none;display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:transparent;color:var(--kb-ink-2);font-size:12.5px;font-weight:560;padding:6px 12px;border-radius:9px;cursor:pointer}
[data-taskhive-knowledge] .tk-tab:hover{background:#fff;color:var(--kb-ink)}
[data-taskhive-knowledge] .tk-tab.is-on{background:#fff;color:var(--kb-ink);border-color:var(--kb-line);box-shadow:0 1px 3px rgba(24,26,30,.08)}
[data-taskhive-knowledge] .tk-tab-n{font-size:11px;color:var(--kb-ink-3);font-variant-numeric:tabular-nums}
[data-taskhive-knowledge] .tk-sort{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-select{height:32px;padding:0 9px;border-radius:9px;border:1px solid var(--kb-line);background:#fff;color:var(--kb-ink);font-size:12px}

/* ── 书架：书本封面 ─────────────────────────────────────── */
[data-taskhive-knowledge] .tk-covers{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(196px,1fr))}
[data-taskhive-knowledge] .tk-cover{appearance:none;position:relative;display:grid;grid-template-columns:22px minmax(0,1fr);text-align:left;padding:0;border-radius:4px 12px 12px 4px;
  border:1px solid var(--kb-line-2);background:#fff;cursor:pointer;overflow:hidden;box-shadow:0 3px 10px rgba(24,26,30,.07);transition:transform .16s ease,box-shadow .16s ease}
[data-taskhive-knowledge] .tk-cover:hover{transform:translateY(-4px);box-shadow:0 14px 26px -10px rgba(24,26,30,.30)}
[data-taskhive-knowledge] .tk-cover-spine{background:linear-gradient(180deg,rgba(0,0,0,0) 0%,rgba(0,0,0,.22) 100%),var(--spine,#3b6fd4)}
[data-taskhive-knowledge] .tk-cover-body{display:grid;gap:7px;padding:14px 14px 12px;min-width:0}
[data-taskhive-knowledge] .tk-cover-title{font-size:14.5px;font-weight:660;line-height:1.35;word-break:break-word}
[data-taskhive-knowledge] .tk-cover-meta{font-size:11px;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-cover-toc{margin:2px 0 0;padding:8px 0 0;list-style:none;display:grid;gap:4px;border-top:1px dashed var(--kb-line-2)}
[data-taskhive-knowledge] .tk-cover-toc li{font-size:11.5px;color:var(--kb-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-taskhive-knowledge] .tk-cover-more{font-size:11px;color:var(--kb-ink-3)}
/* T144：书本自定义（书名 / 颜色） */
[data-taskhive-knowledge] .tk-cover-wrap{position:relative;display:grid;align-content:start}
[data-taskhive-knowledge] .tk-cover-edit{position:absolute;top:8px;right:8px;width:26px;height:26px;display:grid;place-items:center;padding:0;
  border-radius:8px;border:1px solid var(--kb-line);background:#fff;color:var(--kb-ink-3);cursor:pointer;opacity:0;transition:opacity .14s ease,color .14s ease}
[data-taskhive-knowledge] .tk-cover-wrap:hover .tk-cover-edit,[data-taskhive-knowledge] .tk-cover-edit:focus{opacity:1}
[data-taskhive-knowledge] .tk-cover-edit:hover{color:var(--kb-ink);border-color:var(--kb-line)}
[data-taskhive-knowledge] .tk-bookedit{display:grid;gap:9px;padding:11px;margin-top:9px;border:1px solid var(--kb-line);border-radius:12px;background:#fff;box-shadow:0 10px 24px -12px rgba(24,26,30,.35)}
[data-taskhive-knowledge] .tk-swatches{display:flex;gap:6px;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-swatch{width:20px;height:20px;padding:0;border-radius:6px;border:2px solid transparent;background:var(--c,#3b6fd4);cursor:pointer}
[data-taskhive-knowledge] .tk-swatch.is-on{border-color:var(--kb-ink)}
[data-taskhive-knowledge] .tk-swatch:hover{transform:scale(1.08)}
/* T152：单一目录选择器（替代每卡一个 <select>） */
[data-taskhive-knowledge] .tk-picker{display:grid;gap:10px;padding:12px 14px;border:1px solid var(--kb-line);border-radius:12px;background:#fff;box-shadow:0 12px 28px -14px rgba(24,26,30,.35)}
[data-taskhive-knowledge] .tk-picker-head{display:flex;gap:8px;align-items:center;font-size:12.5px;font-weight:600}
[data-taskhive-knowledge] .tk-picker-list{display:flex;gap:6px;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-picker-new{display:flex;gap:6px;align-items:center}

/* ── 书本详情：目录 + 章节 ──────────────────────────────── */
[data-taskhive-knowledge] .tk-bookbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-booktitle{font-size:15px;font-weight:660}
[data-taskhive-knowledge] .tk-toc{display:grid;gap:0;border:1px solid var(--kb-line-2);border-radius:12px;overflow:hidden;background:#fff}
[data-taskhive-knowledge] .tk-toc-head{padding:9px 13px;font-size:12px;font-weight:620;color:var(--kb-ink-2);background:var(--kb-cell);border-bottom:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-toc-item{display:flex;gap:10px;align-items:baseline;width:100%;text-align:left;padding:8px 13px;border:0;border-bottom:1px solid var(--kb-line-2);background:#fff;cursor:pointer;color:var(--kb-ink)}
[data-taskhive-knowledge] .tk-toc-item:last-child{border-bottom:0}
[data-taskhive-knowledge] .tk-toc-item:hover{background:var(--kb-cell)}
[data-taskhive-knowledge] .tk-toc-num{flex:0 0 auto;font-size:11px;color:var(--kb-ink-3);font-variant-numeric:tabular-nums;min-width:18px}
[data-taskhive-knowledge] .tk-toc-text{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-knowledge] .tk-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));align-items:start}

/* ── 卡片（章节） ───────────────────────────────────────── */
[data-taskhive-knowledge] .tk-card{position:relative;display:grid;grid-template-columns:6px minmax(0,1fr);border-radius:12px;overflow:hidden;background:#fff;border:1px solid var(--kb-line-2);box-shadow:0 2px 6px rgba(24,26,30,.06);scroll-margin-top:12px;transition:box-shadow .14s ease,transform .14s ease}
[data-taskhive-knowledge] .tk-card:hover{transform:translateY(-2px);box-shadow:0 10px 22px -10px rgba(24,26,30,.28)}
[data-taskhive-knowledge] .tk-card:target{border-color:#3b6fd4}
[data-taskhive-knowledge] .tk-card-spine{background:var(--spine,#3b6fd4)}
[data-taskhive-knowledge] .tk-card-inner{display:grid;gap:8px;padding:12px 13px;min-width:0}
[data-taskhive-knowledge] .tk-card-top{display:flex;gap:8px;align-items:flex-start;justify-content:space-between}
[data-taskhive-knowledge] .tk-card-name{font-size:13.5px;font-weight:640;line-height:1.4;word-break:break-word;min-width:0}
[data-taskhive-knowledge] .tk-chip{flex:0 0 auto;font-size:10.5px;font-weight:560;padding:2px 8px;border-radius:999px;border:1px solid var(--kb-line);color:var(--kb-ink-2);background:#fff}
[data-taskhive-knowledge] .tk-chip.is-ok{border-color:rgba(34,150,94,.35);color:#1a7f4b}
[data-taskhive-knowledge] .tk-chip.is-warn{border-color:rgba(180,120,20,.35);color:#946310}
[data-taskhive-knowledge] .tk-chip.is-bad{border-color:rgba(179,38,30,.30);color:#a92b23}
[data-taskhive-knowledge] .tk-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-tag{font-size:10.5px;padding:1px 7px;border-radius:999px;background:var(--kb-cell);border:1px solid var(--kb-line-2);color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-use{font-size:12.5px;line-height:1.55;color:var(--kb-ink-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
[data-taskhive-knowledge] .tk-body{font-size:12.5px;line-height:1.6;color:var(--kb-ink-2);white-space:pre-wrap;word-break:break-word;max-height:230px;overflow:auto;padding:10px 11px;border-radius:9px;background:var(--kb-cell);border:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-btn{appearance:none;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--kb-line);background:#fff;color:var(--kb-ink);font-size:12px;font-weight:560;padding:5px 11px;border-radius:9px;cursor:pointer}
[data-taskhive-knowledge] .tk-btn:hover:not(:disabled){border-color:rgba(59,111,212,.45);box-shadow:0 2px 8px rgba(59,111,212,.14)}
[data-taskhive-knowledge] .tk-btn:disabled{opacity:.45;cursor:default}
[data-taskhive-knowledge] .tk-btn.is-primary{border-color:transparent;background:#3b6fd4;color:#fff}
[data-taskhive-knowledge] .tk-btn.is-primary:hover:not(:disabled){background:#2f5fc4}
[data-taskhive-knowledge] .tk-btn.is-quiet{border-color:transparent;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-btn.is-quiet:hover:not(:disabled){color:var(--kb-ink)}
[data-taskhive-knowledge] .tk-move{display:inline-flex;gap:5px;align-items:center}
[data-taskhive-knowledge] .tk-move-input{height:30px;width:120px;padding:0 8px;border-radius:8px;border:1px solid var(--kb-line);background:#fff;font-size:12px}
[data-taskhive-knowledge] .tk-link{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:580;color:#2f5fc4;text-decoration:none;padding:4px 7px;border-radius:8px}
[data-taskhive-knowledge] .tk-link:hover{background:rgba(59,111,212,.09)}

/* ── 索引书架 ───────────────────────────────────────────── */
[data-taskhive-knowledge] .tk-shelf{display:grid;gap:0}
[data-taskhive-knowledge] .tk-shelf-head{display:flex;align-items:center;gap:8px;padding:0 4px 9px;color:var(--kb-ink-2);font-size:12.5px;font-weight:640}
[data-taskhive-knowledge] .tk-shelf-dot{width:9px;height:9px;flex:0 0 auto;border-radius:3px;background:var(--shelf-tone,#3b6fd4)}
[data-taskhive-knowledge] .tk-shelf-count{font-weight:500;color:var(--kb-ink-3);font-size:11.5px}
[data-taskhive-knowledge] .tk-shelf-note{margin-left:auto;font-weight:500;font-size:11px;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-shelf-body{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(262px,1fr));padding:4px 10px 16px;align-items:stretch}
[data-taskhive-knowledge] .tk-shelf-board{height:10px;margin:0 2px 18px;border-radius:3px 3px 8px 8px;background:linear-gradient(180deg,#eef0f3 0%,#dfe3e8 100%);box-shadow:0 8px 14px -8px rgba(24,26,30,.30),inset 0 1px 0 rgba(255,255,255,.9)}

/* ── 状态 ───────────────────────────────────────────────── */
[data-taskhive-knowledge] .tk-empty{display:grid;gap:7px;justify-items:center;padding:30px 16px;border-radius:14px;border:1px dashed var(--kb-line);background:var(--kb-cell);color:var(--kb-ink-3);font-size:12.5px;text-align:center}
[data-taskhive-knowledge] .tk-empty strong{color:var(--kb-ink-2);font-weight:600}
[data-taskhive-knowledge] .tk-error{font-size:12.5px;line-height:1.5;white-space:pre-wrap;padding:11px 13px;border-radius:11px;border:1px solid rgba(179,38,30,.28);background:#fdf1f0;color:#a92b23}
[data-taskhive-knowledge] .tk-notice{justify-self:start;font-size:12px;color:#1a7f4b;background:#f0faf4;border:1px solid rgba(34,150,94,.28);border-radius:9px;padding:6px 10px}
[data-taskhive-knowledge] .tk-skel{height:104px;border-radius:12px;background:linear-gradient(100deg,#f4f5f7 30%,#fafbfc 50%,#f4f5f7 70%);background-size:200% 100%;animation:tk-shimmer 1.5s ease-in-out infinite}
@keyframes tk-shimmer{0%{background-position:150% 0}100%{background-position:-50% 0}}

/* ── T146 文档：点开"文档"后铺满整个插件面板，像 Word 一样阅读 ───────── */
[data-taskhive-knowledge] .tk-doc{display:flex;gap:12px;align-items:center;width:100%;text-align:left;padding:14px 16px;border-radius:12px;cursor:pointer;
  border:1px solid var(--kb-line);background:#fff;box-shadow:0 2px 8px rgba(24,26,30,.06);transition:box-shadow .14s ease,transform .14s ease}
[data-taskhive-knowledge] .tk-doc:hover{transform:translateY(-2px);box-shadow:0 12px 24px -10px rgba(24,26,30,.28)}
[data-taskhive-knowledge] .tk-doc-icon{width:38px;height:38px;flex:0 0 auto;border-radius:10px;display:grid;place-items:center;color:#fff;background:linear-gradient(150deg,#4f7fe0,#3b6fd4)}
[data-taskhive-knowledge] .tk-doc-body{display:grid;gap:3px;min-width:0}
[data-taskhive-knowledge] .tk-doc-name{font-size:14px;font-weight:640}
[data-taskhive-knowledge] .tk-doc-meta{font-size:11.5px;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-reader{display:grid;gap:14px}
[data-taskhive-knowledge] .tk-reader-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-reader-title{font-size:15px;font-weight:660}
[data-taskhive-knowledge] .tk-paper{width:100%;max-width:820px;margin:0 auto;background:#fff;border:1px solid var(--kb-line-2);border-radius:10px;
  padding:38px 44px 52px;box-shadow:0 10px 30px -18px rgba(24,26,30,.35)}
[data-taskhive-knowledge] .tk-paper-title{margin:0 0 6px;font-size:26px;line-height:1.3;font-weight:700;letter-spacing:.01em}
[data-taskhive-knowledge] .tk-paper-sub{margin:0 0 22px;padding-bottom:14px;border-bottom:2px solid var(--kb-line-2);font-size:12.5px;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-paper-toc{margin:0 0 26px;padding:14px 16px;border-radius:10px;background:var(--kb-cell);border:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-paper-toc h2{margin:0 0 8px;font-size:13px;font-weight:660;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-paper-toc ol{margin:0;padding-left:20px;display:grid;gap:5px}
[data-taskhive-knowledge] .tk-paper-toc li{font-size:13px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-paper-toc button{appearance:none;border:0;background:transparent;padding:0;color:#2f5fc4;font:inherit;font-size:13px;cursor:pointer;text-align:left}
[data-taskhive-knowledge] .tk-paper-toc button:hover{text-decoration:underline}
[data-taskhive-knowledge] .tk-chapter{margin:0 0 30px;padding-top:6px}
[data-taskhive-knowledge] .tk-chapter-title{margin:0 0 10px;font-size:18px;line-height:1.4;font-weight:680;padding-bottom:7px;border-bottom:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-chapter-body{font-size:14px;line-height:1.9;color:#2b3038;white-space:pre-wrap;word-break:break-word}
[data-taskhive-knowledge] .tk-chapter-meta{margin:0 0 8px;font-size:11.5px;color:var(--kb-ink-3)}

/* ── T166 阅读视图：Word 式左侧导航窗格（可折叠目录树）─────────────────────
   用户口径（2026-10）：「目录点进去目录和书签一样在左侧展开可以折叠，和真实的 word 一样」。
   宽度固定（不挤压正文）、目录区独立滚动（sticky + 自己的 overflow）、
   窄屏（<900px）收成抽屉并给显示/隐藏开关。配色全部复用上面的 --kb-* 变量。 */
[data-taskhive-knowledge] .tk-reader-layout{position:relative;display:grid;grid-template-columns:252px minmax(0,1fr);gap:18px;align-items:start}
/* T166b：目录收起时**网格只剩一列** —— 只把 .tk-nav 设成 display:none 的话，252px 那一列
   仍然占着位置，正文右侧会留下一道空白（用户口径：「隐藏目录之后正文占的ui是原来目录的位置，
   不是全屏」）。两条 .is-nav-off 规则的（0,3,0）特异性都高于基线的（0,1,0），所以宽屏、
   窄屏媒体查询里都稳定生效。 */
[data-taskhive-knowledge] .tk-reader-layout.is-nav-off{grid-template-columns:minmax(0,1fr)}
[data-taskhive-knowledge] .tk-reader-main{min-width:0}
[data-taskhive-knowledge] .tk-nav{display:grid;gap:8px;position:sticky;top:0;max-height:calc(100vh - 156px);overflow:auto;
  padding:10px 10px 12px;border:1px solid var(--kb-line-2);border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(24,26,30,.06)}
[data-taskhive-knowledge] .tk-nav-head{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:0 2px 8px;border-bottom:1px solid var(--kb-line-2);font-size:12px;font-weight:640;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-nav-list{display:grid;gap:1px}
[data-taskhive-knowledge] .tk-nav-row{display:flex;gap:2px;align-items:center;min-width:0;border-radius:8px;box-shadow:inset 2px 0 0 transparent}
[data-taskhive-knowledge] .tk-nav-row:hover{background:var(--kb-cell)}
[data-taskhive-knowledge] .tk-nav-row.is-active{background:rgba(59,111,212,.10);box-shadow:inset 2px 0 0 #3b6fd4}
[data-taskhive-knowledge] .tk-nav-row.is-active .tk-nav-text{color:#2f5fc4;font-weight:640}
[data-taskhive-knowledge] .tk-nav-twist{flex:0 0 auto;width:18px;height:24px;display:grid;place-items:center;padding:0;border:0;background:transparent;color:var(--kb-ink-3);border-radius:5px;cursor:pointer}
[data-taskhive-knowledge] .tk-nav-twist:hover{color:var(--kb-ink);background:rgba(24,26,30,.06)}
[data-taskhive-knowledge] .tk-nav-twist.is-leaf{cursor:default;opacity:.30}
[data-taskhive-knowledge] .tk-nav-twist.is-leaf:hover{background:transparent;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-nav-item{flex:1 1 auto;min-width:0;display:block;text-align:left;padding:5px 8px 5px 1px;border:0;background:transparent;color:var(--kb-ink);font-size:12.5px;line-height:1.45;cursor:pointer}
[data-taskhive-knowledge] .tk-nav-item:focus-visible{outline:2px solid rgba(59,111,212,.45);outline-offset:-2px;border-radius:6px}
[data-taskhive-knowledge] .tk-nav-text{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-knowledge] .tk-nav-row.lv0 .tk-nav-text{font-weight:680}
[data-taskhive-knowledge] .tk-nav-row.lv2 .tk-nav-item{font-size:12px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-nav-row.lv3 .tk-nav-item{font-size:11.5px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-nav-empty{padding:12px 8px;font-size:12px;color:var(--kb-ink-3);text-align:center}
/* 正文里被识别出来的小标题（锚点目标）与正文块（保持原有 pre-wrap 观感） */
[data-taskhive-knowledge] .tk-chapter-sub{margin:18px 0 7px;font-size:15.5px;line-height:1.5;font-weight:660;color:#23282f;scroll-margin-top:14px}
[data-taskhive-knowledge] .tk-chapter-sub:first-child{margin-top:2px}
[data-taskhive-knowledge] .tk-chapter-block{margin:0;white-space:pre-wrap}
/* 窄屏：目录默认收起；开关打开时以抽屉形式浮在正文上（不挤压正文宽度） */
@media (max-width:900px){
  [data-taskhive-knowledge] .tk-reader-layout{grid-template-columns:minmax(0,1fr)}
  [data-taskhive-knowledge] .tk-nav{display:none}
  [data-taskhive-knowledge] .tk-reader-layout.is-nav-on .tk-nav{display:grid;position:absolute;top:46px;left:0;z-index:6;width:min(280px,86vw);max-height:68vh;box-shadow:0 18px 42px -16px rgba(24,26,30,.45)}
}
[data-taskhive-knowledge] .tk-reader-layout.is-nav-off .tk-nav{display:none}
/* ── T166 导入预检面板（复用顶部既有操作区，不新开按钮区）──────────────── */
[data-taskhive-knowledge] .tk-importer{display:grid;gap:10px;padding:13px 15px;border:1px solid var(--kb-line);border-radius:12px;background:#fff;box-shadow:0 12px 28px -14px rgba(24,26,30,.35)}
[data-taskhive-knowledge] .tk-importer-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:13px;font-weight:640}
[data-taskhive-knowledge] .tk-importer-sub{font-size:11.5px;color:var(--kb-ink-3);word-break:break-all}
[data-taskhive-knowledge] .tk-import-grid{display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(148px,1fr))}
[data-taskhive-knowledge] .tk-import-cell{display:grid;gap:1px;padding:8px 10px;border-radius:9px;border:1px solid var(--kb-line-2);background:var(--kb-cell);font-size:11.5px;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-import-cell b{font-size:15px;color:var(--kb-ink);font-variant-numeric:tabular-nums}
[data-taskhive-knowledge] .tk-import-mode{display:grid;gap:7px;padding:10px 12px;border-radius:10px;background:var(--kb-cell);border:1px solid var(--kb-line-2)}
[data-taskhive-knowledge] .tk-radio{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--kb-ink);cursor:pointer}
[data-taskhive-knowledge] .tk-radio input{margin:2px 0 0}
[data-taskhive-knowledge] .tk-radio span{display:grid;gap:1px}
[data-taskhive-knowledge] .tk-radio em{font-style:normal;font-size:11.5px;color:var(--kb-ink-3)}
[data-taskhive-knowledge] .tk-warn{font-size:12.5px;line-height:1.55;padding:10px 12px;border-radius:10px;border:1px solid rgba(180,120,20,.35);background:#fff9ec;color:#8a5a12}
[data-taskhive-knowledge] .tk-preview-list{margin:0;padding-left:18px;display:grid;gap:3px;font-size:11.5px;color:var(--kb-ink-2)}
/* ── T166b 按书导出 / 导入：书的多选列表（全选 / 反选 / 搜索）───────────── */
[data-taskhive-knowledge] .tk-bookpick{display:grid;gap:8px}
[data-taskhive-knowledge] .tk-bookpick-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
[data-taskhive-knowledge] .tk-bookpick-title{font-size:12.5px;font-weight:620;color:var(--kb-ink-2)}
[data-taskhive-knowledge] .tk-bookpick-search{flex:1 1 160px;min-width:140px;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--kb-line);background:#fff;font-size:12px;color:var(--kb-ink)}
[data-taskhive-knowledge] .tk-bookpick-list{display:grid;gap:1px;max-height:188px;overflow:auto;padding:6px;border:1px solid var(--kb-line-2);border-radius:10px;background:var(--kb-cell)}
[data-taskhive-knowledge] .tk-bookpick-row{display:flex;gap:8px;align-items:center;padding:4px 7px;border-radius:8px;font-size:12.5px;cursor:pointer}
[data-taskhive-knowledge] .tk-bookpick-row:hover{background:#fff}
[data-taskhive-knowledge] .tk-bookpick-row input{margin:0;flex:0 0 auto}
[data-taskhive-knowledge] .tk-bookpick-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-taskhive-knowledge] .tk-bookpick-n{flex:0 0 auto;font-size:11px;color:var(--kb-ink-3);font-variant-numeric:tabular-nums}
[data-taskhive-knowledge] .tk-bookpick-empty{padding:10px;text-align:center;font-size:12px;color:var(--kb-ink-3)}
`

    function installKnowledgeViewStyle() {
      if (document.getElementById('taskhive-knowledge-style')) return
      const style = document.createElement('style')
      style.id = 'taskhive-knowledge-style'
      style.textContent = KNOWLEDGE_VIEW_CSS
      document.head.appendChild(style)
    }

    function kbIcon(paths, size) {
      const px = size || 14
      return h('svg', {
        width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false'
      }, paths.map((d, i) => h('path', { key: i, d })))
    }
    const KB_ICON = {
      search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-3.6-3.6'],
      refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
      copy: ['M9 9h9v11H9z', 'M6 15H4V4h11v2'],
      external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
      shelf: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
      books: ['M5 4h5v16H5z', 'M11 4h4v16h-4z', 'M16.5 5l3.5.9-3.5 13.1-3.5-1z'],
      back: ['M15 6l-6 6 6 6'],
      check: ['M5 13l4 4L19 7'],
      close: ['M6 6l12 12', 'M18 6L6 18'],
      chevron: ['M6 9l6 6 6-6'],
      up: ['M6 15l6-6 6 6'],
      inbox: ['M4 13h4l2 3h4l2-3h4', 'M4 13L7 5h10l3 8v6H4z'],
      move: ['M4 7h9', 'M4 12h9', 'M4 17h6', 'M17 12h4', 'M18 9l3 3-3 3'],
      pencil: ['M4 20h4l10-10-4-4L4 16z', 'M14 6l4 4'],
      doc: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h7', 'M10 17h5'],
      spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
      expand: ['M4 9V4h5', 'M20 15v5h-5', 'M15 4h5v5', 'M9 20H4v-5'],
      collapse: ['M9 4v5H4', 'M15 20v-5h5', 'M20 9h-5V4', 'M4 15h5v5'],
      // T166：目录树的"折叠时朝右"的箭头 + 导出 / 导入
      chevronRight: ['M9.5 6l5.5 6-5.5 6'],
      download: ['M12 4v11', 'M7.5 10.5L12 15l4.5-4.5', 'M4.5 20h15'],
      upload: ['M12 20V9', 'M7.5 13.5L12 9l4.5 4.5', 'M4.5 4h15']
    }

    function readKnowledgePayload(value) {
      if (!value) return null
      if (Array.isArray(value)) return value
      if (Array.isArray(value.cards)) return value.cards
      if (Array.isArray(value.repositories)) return value.repositories
      const text = (value.content || []).map((item) => item && item.text).filter(Boolean).join('')
      if (!text) return null
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) return parsed
        if (parsed && Array.isArray(parsed.cards)) return parsed.cards
        if (parsed && Array.isArray(parsed.repositories)) return parsed.repositories
        if (parsed && Array.isArray(parsed.entries)) return parsed.entries
      } catch { /* not JSON */ }
      return null
    }

    function kbStatus(status) {
      const value = String(status || '').toLowerCase()
      // 存储层通过后写的是 `approved`（见 repositories/manager.js reviewCard）。
      if (value === 'approved' || value === 'accepted' || value === '已入库') return { text: '已入库', tone: 'is-ok', spine: '#4f8a6b' }
      if (value === 'candidate' || value === 'pending' || value === '待审核') return { text: '待审核', tone: 'is-warn', spine: '#c9a227' }
      if (value === 'rejected' || value === '驳回') return { text: '已驳回', tone: 'is-bad', spine: '#b8486b' }
      return { text: value || '未知', tone: '', spine: '#5b6b7c' }
    }

    function KnowledgeView() {
      const [index, setIndex] = React.useState(null)
      const [cards, setCards] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [view, setView] = React.useState('shelf')       // shelf | book | review | index | all
      // T146：**打开某本书里的"文档"**时，文档铺满整个插件面板（不是给整个知识库加全屏开关）。
      const [docBook, setDocBook] = React.useState('')
      // T147：AI 整理书架（默认走 DeepSeek 识别内容 → 主题书）；不可用时回退本地规则。
      const [aiBusy, setAiBusy] = React.useState(false)
      const [activeBook, setActiveBook] = React.useState('')
      const [sort, setSort] = React.useState('updated')
      const [openId, setOpenId] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [editing, setEditing] = React.useState('')
      const [draft, setDraft] = React.useState('')
      // T152：只给"当前操作的那一张卡"渲染目录选择器，替代"每张卡一个含全部书名的 <select>"
      //（200 卡 × 20 书 = 4000 个 option，且每次击键全量重建）。
      const [movingCard, setMovingCard] = React.useState('')
      // T152：渲染上限 —— 大库不再一次性渲染全部卡片（点"显示更多"再加载 60 张）。
      const [limit, setLimit] = React.useState(60)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      // T144：书本自定义（名字 / 颜色）—— 元数据存 knowledge/books.json。
      const [booksMeta, setBooksMeta] = React.useState({})
      const [editingBook, setEditingBook] = React.useState('')
      const [bookDraft, setBookDraft] = React.useState({ title: '', color: '' })
      // T166：Word 式目录窗格（左侧可折叠树）。navOverride=null 表示"跟随屏宽默认"
      //（宽屏显示、窄屏隐藏），用户点开关后固定为显式值。
      const [narrow, setNarrow] = React.useState(() => kbIsNarrowScreen())
      const [navOverride, setNavOverride] = React.useState(null)
      const [tocOpen, setTocOpen] = React.useState({})
      const [activeAnchor, setActiveAnchor] = React.useState('')
      // T166：知识库导出 / 导入（导出直接写文件；导入先预检 → 合并 / 替换）。
      const [exportBusy, setExportBusy] = React.useState(false)
      const [importBusy, setImportBusy] = React.useState('')
      const [importPlan, setImportPlan] = React.useState(null)
      const [importMode, setImportMode] = React.useState('merge')
      const [importStep, setImportStep] = React.useState('preview')
      // T166b：按书导出 / 导入（用户口径 2026-10：「导出应该是选择单本书导出…也可以选择多本」）。
      // 单选就是多选里的一个特例，所以只有一套"书的多选"状态。sel = { 书名: true }。
      const [exportPick, setExportPick] = React.useState(null)          // { q, sel } | null
      const [importPick, setImportPick] = React.useState({ q: '', sel: {} })
      const rootRef = React.useRef(null)

      React.useEffect(() => { installKnowledgeViewStyle() }, [])

      // T143：**一变得可见就重新声明"我在显示知识库"**。宿主据此收起任何遗留的原生面板
      //（浏览器 / CODESYS / 旧知识库层），否则那些原生视图会盖住 DSH 视图，用户看到
      // "知识库打开是空白"——而且出现与否取决于切换顺序，表现为"经常性"。
      // 用 IntersectionObserver 而不是挂载即执行：面板可能早已挂载（重复点击不重跑 effect）。
      React.useEffect(() => {
        const node = rootRef.current
        if (!node || typeof IntersectionObserver !== 'function') return undefined
        const io = new IntersectionObserver((records) => {
          for (const record of records) {
            if (record.isIntersecting && record.intersectionRatio > 0.15) {
              try { openSurface('knowledge') } catch { /* 宿主不可用 */ }
            }
          }
        }, { threshold: [0.15] })
        io.observe(node)
        return () => io.disconnect()
      }, [])

      // T166：窄屏（<900px）时目录默认收起，由阅读栏的开关按需展开（抽屉）。
      React.useEffect(() => {
        const update = () => setNarrow(kbIsNarrowScreen())
        update()
        let query = null
        try { query = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 900px)') : null } catch { query = null }
        const listener = () => update()
        if (query && typeof query.addEventListener === 'function') {
          query.addEventListener('change', listener)
          return () => query.removeEventListener('change', listener)
        }
        if (typeof window.addEventListener === 'function') {
          window.addEventListener('resize', listener)
          return () => window.removeEventListener('resize', listener)
        }
        return undefined
      }, [])

      const load = React.useCallback(async () => {
        const api = window.taskhive || {}
        try {
          const [repoValue, cardValue] = await Promise.all([
            typeof api.listKnowledgeRepositories === 'function' ? api.listKnowledgeRepositories() : null,
            typeof api.listKnowledgeCards === 'function' ? api.listKnowledgeCards() : null
          ])
          const repos = readKnowledgePayload(repoValue) || []
          const entries = repos.flatMap((repo) => (repo && Array.isArray(repo.entries)
            ? repo.entries.map((entry) => ({ ...entry, repository: repo.name || repo.id }))
            : []))
          setIndex(entries)
          setCards(readKnowledgePayload(cardValue) || [])
          if (typeof api.listKnowledgeBooks === 'function') {
            const bookValue = await api.listKnowledgeBooks()
            setBooksMeta((bookValue && bookValue.books) || {})
          }
          setError('')
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }, [])

      React.useEffect(() => { void load() }, [load])

      // T141 修复：宿主只接受 `approve` / `reject`（见 repositories/manager.js:54）。
      // 之前传 'accept' → 抛「审核结果必须是 approve 或 reject」= 用户看到的"通过无效报错"。
      const review = async (id, decision) => {
        const api = window.taskhive || {}
        if (typeof api.reviewKnowledgeCard !== 'function') return
        setBusy(id)
        setNotice('')
        try {
          await api.reviewKnowledgeCard({ id, decision: decision === 'approve' ? 'approve' : 'reject' })
          await load()
          setNotice(decision === 'approve' ? '已通过，自动归入书本' : '已驳回')
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy('')
        }
      }

      // 用户自己整理目录：把卡片移动到指定目录（或新建目录）。
      const setCategory = async (card, category) => {
        const api = window.taskhive || {}
        if (typeof api.setKnowledgeCardCategory !== 'function' && typeof api.setKnowledgeCardsCategory !== 'function') { setError('当前宿主不支持修改目录'); return }
        setBusy(`cat:${card.id}`)
        try {
          if (typeof api.setKnowledgeCardsCategory === 'function') await api.setKnowledgeCardsCategory({ ids: [card.id], category })
          else await api.setKnowledgeCardCategory({ id: card.id, category })
          await load()
          setNotice(category ? `已移动到《${category}》` : '已恢复自动分类')
          setEditing('')
          setDraft('')
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy('')
        }
      }

      // T144：书本自定义 —— 颜色取 booksMeta（用户设过就用用户的），否则按名字哈希取色。
      const spineOfBook = (name) => (booksMeta[name] && booksMeta[name].color) || kbSpineOf(name)
      const startEditBook = (name, event) => {
        if (event && event.stopPropagation) event.stopPropagation()
        setEditingBook(name)
        setBookDraft({ title: name, color: (booksMeta[name] && booksMeta[name].color) || '' })
      }
      const saveBook = async (from) => {
        const api = window.taskhive || {}
        const title = String(bookDraft.title || '').trim() || from
        const color = String(bookDraft.color || '').trim()
        setBusy(`book:${from}`)
        setNotice('')
        try {
          // 改名：把这本书里的每张卡片都显式指到新目录（**一次批量 IPC**，不再逐卡整文件重写）。
          if (title !== from) {
            const items = booksMap.get(from) || []
            if (items.length && typeof api.setKnowledgeCardsCategory === 'function') {
              await api.setKnowledgeCardsCategory({ ids: items.map((card) => card.id), category: title })
            } else if (typeof api.setKnowledgeCardCategory === 'function') {
              for (const card of items) await api.setKnowledgeCardCategory({ id: card.id, category: title })
            }
          }
          if (typeof api.setKnowledgeBookMeta === 'function') await api.setKnowledgeBookMeta({ from, title, color })
          await load()
          setNotice(`已更新《${title}》`)
          setEditingBook('')
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy('')
        }
      }
      const bookEditor = (name) => h('div', { className: 'tk-bookedit', onClick: (event) => event.stopPropagation() },
        h('input', {
          className: 'tk-move-input', style: { width: '100%' }, value: bookDraft.title, autoFocus: true,
          'aria-label': '书本名', placeholder: '书本名',
          onChange: (event) => setBookDraft({ ...bookDraft, title: event.target.value }),
          onKeyDown: (event) => { if (event.key === 'Enter') void saveBook(name); if (event.key === 'Escape') setEditingBook('') }
        }),
        h('div', { className: 'tk-swatches' }, KB_SPINES.map((color) => h('button', {
          key: color, type: 'button', className: `tk-swatch${bookDraft.color === color ? ' is-on' : ''}`,
          style: { '--c': color }, 'aria-label': `颜色 ${color}`, title: color,
          onClick: () => setBookDraft({ ...bookDraft, color })
        }))),
        h('div', { className: 'tk-actions' },
          h('button', { className: 'tk-btn is-primary', type: 'button', disabled: busy === `book:${name}`, onClick: () => void saveBook(name) }, busy === `book:${name}` ? '保存中…' : '保存'),
          h('button', { className: 'tk-btn is-quiet', type: 'button', onClick: () => setEditingBook('') }, '取消')))

      // T147：AI 整理书架 —— 调宿主 `knowledge:ai-classify`（本机 codex CLI 识别内容分书）；
      // AI 失败/超时时**回退到本地关键词规则**，保证这个功能总能产出结果。
      const aiClassify = async () => {
        const api = window.taskhive || {}
        setAiBusy(true)
        setError('')
        setNotice('AI 正在识别内容并整理书本…')
        try {
          if (typeof api.aiClassifyKnowledge === 'function') {
            const result = await api.aiClassifyKnowledge({})
            if (result && result.ok) {
              await load()
              const names = Object.keys(result.books || {})
              setNotice(`AI 已按主题整理成 ${names.length} 本书：${names.join('、')}`)
              return
            }
            const approved = allCards.filter((card) => kbStatus(card.status).text === '已入库')
            if (typeof api.setKnowledgeCardsCategory === 'function') {
              // 按本地规则分组后**一次性批量写**，避免逐卡整文件重写。
              const groups = new Map()
              for (const card of approved) {
                const name = kbCategoryOf(card)
                if (!groups.has(name)) groups.set(name, [])
                groups.get(name).push(card.id)
              }
              for (const [name, ids] of groups) await api.setKnowledgeCardsCategory({ ids, category: name })
            } else if (typeof api.setKnowledgeCardCategory === 'function') {
              for (const card of approved) await api.setKnowledgeCardCategory({ id: card.id, category: kbCategoryOf(card) })
            }
            await load()
            setNotice(`AI 不可用（${(result && result.reason) || '未知原因'}），已用本地规则整理 ${approved.length} 张卡片`)
            return
          }
          throw new Error('当前宿主不支持 AI 整理')
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setAiBusy(false)
        }
      }

      // T166 导出：主进程打开保存对话框并把**一个可移植文件**写出去；渲染层不传路径。
      // T166b：`names` = 勾选的书名（省略 = 整库，保持老调用可用）。自动分类规则只存在于
      // 渲染层，所以"卡片 id + 卡片→书"的索引随请求一起送进主进程，主进程只做归一化与
      // 本机存在性校验 —— 它不复制这套规则，也永远不会写出本机不存在的卡片。
      const exportBundle = async (names) => {
        const api = window.taskhive || {}
        if (typeof api.knowledgeExportBundle !== 'function') { setError('当前主程序不支持导出知识库：请更新到 1.1.0 后重启 TaskHive'); return }
        const groups = exportBooksOf()
        const scoped = Array.isArray(names)
        const picked = scoped ? groups.filter((group) => names.includes(group.name)) : groups
        if (scoped && !picked.length) { setError('没有勾选任何书：请至少勾选一本再导出'); return }
        const cards = []
        const bookIndex = {}
        for (const group of picked) {
          for (const id of group.ids) { cards.push(id); bookIndex[id] = group.name }
        }
        setExportBusy(true)
        setError('')
        setNotice('')
        try {
          const result = await api.knowledgeExportBundle(scoped ? { books: picked.map((group) => group.name), cards, bookIndex } : {})
          if (!result) { setError('导出失败：主程序没有返回结果（可能是主进程版本过旧）'); return }
          if (result.canceled) { setNotice('已取消导出'); return }
          if (result.ok !== true) { setError(`导出失败：${result.error || '未知原因'}`); return }
          const counts = result.counts || {}
          setExportPick(null)
          setNotice(`已导出 ${counts.cards || 0} 张卡片 / ${counts.books || 0} 本书${scoped ? `（选中的 ${picked.length} 本）` : ''} → ${result.path}（${kbBytes(result.bytes)}）`)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setExportBusy(false)
        }
      }

      // T166b：打开"按书导出"面板。默认**全选** —— 与原来的一键整库导出等价，只是多了一次
      // 明确的确认；要导一本就只留一本勾着（单选是多选的特例）。
      const openExportPick = () => {
        const groups = exportBooksOf()
        if (!groups.length) { setError('知识库里还没有卡片可以导出'); return }
        const sel = {}
        for (const group of groups) sel[group.name] = true
        setError('')
        setNotice('')
        setExportPick({ q: '', sel })
      }

      // T166 导入第一步：**只预检，不写数据**（选文件 → 解析 → 校验 → 摘要预览）。
      const startImport = async () => {
        const api = window.taskhive || {}
        if (typeof api.knowledgeImportInspect !== 'function') { setError('当前主程序不支持导入知识库：请更新到 1.1.0 后重启 TaskHive'); return }
        setImportBusy('inspect')
        setError('')
        setNotice('')
        try {
          const result = await api.knowledgeImportInspect({})
          if (!result) { setError('导入预检失败：主程序没有返回结果（可能是主进程版本过旧）'); return }
          if (result.canceled) return
          if (result.ok !== true) {
            setImportPlan({ ok: false, name: result.name || '', path: result.path || '', error: result.error || '文件不可导入', issues: result.issues || [] })
            setImportStep('preview')
            setImportPick({ q: '', sel: {} })
            return
          }
          setImportPlan({ ...result, ok: true })
          setImportMode('merge')
          setImportStep('preview')
          // T166b：默认全选文件里的书（＝老行为"整份导入"），用户可以只留想导入的那几本。
          const rows = Array.isArray(result.books) ? result.books : []
          const sel = {}
          for (const row of rows) sel[row.name] = true
          setImportPick({ q: '', sel })
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setImportBusy('')
        }
      }

      // T166 导入第二步：应用（merge = 按 id 合并；replace = 先备份再整份替换）。
      // T166b：只把**勾选的书**送进主进程（不勾就不写、apply 直接拒绝）。
      const applyImport = async (mode) => {
        const api = window.taskhive || {}
        if (!importPlan || importPlan.ok !== true) return
        if (typeof api.knowledgeImportApply !== 'function') { setError('当前主程序不支持导入知识库：请更新到 1.1.0 后重启 TaskHive'); return }
        const rows = Array.isArray(importPlan.books) ? importPlan.books : []
        const sel = importPick.sel || {}
        const selected = rows.length ? rows.filter((row) => sel[row.name]).map((row) => row.name) : null
        if (rows.length && !selected.length) { setError('没有勾选任何要导入的书：请至少勾选一本（没有写入任何数据）'); return }
        setImportBusy(mode)
        setError('')
        setNotice('')
        try {
          const payload = selected ? { mode, token: importPlan.token, books: selected } : { mode, token: importPlan.token }
          const result = await api.knowledgeImportApply(payload)
          if (!result || result.ok !== true) { setError(`导入失败：${(result && result.error) || '未知原因'}`); return }
          const cards = result.cards || {}
          const books = result.books || {}
          setImportPlan(null)
          setImportStep('preview')
          setImportPick({ q: '', sel: {} })
          await load()
          const scope = selected ? `（选中的 ${selected.length} 本）` : ''
          setNotice(mode === 'replace'
            ? `已替换导入${scope}：${cards.added || 0} 张卡片 / ${books.added || 0} 本书${result.backup ? `；替换前的数据已备份到 ${result.backup}` : ''}`
            : `已合并导入${scope}：新增 ${cards.added || 0} 张、更新 ${cards.updated || 0} 张、保留本地较新 ${cards.keptLocal || 0} 张（共 ${result.snapshot ? result.snapshot.cards : ''} 张）`)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setImportBusy('')
        }
      }

      const copy = async (card) => {        try {
          await navigator.clipboard.writeText(String(card.content || card.title || ''))
          setNotice('已复制到剪贴板')
          setBusy(`copy:${card.id}`)
          setTimeout(() => setBusy(''), 1200)
        } catch {
          setNotice('复制失败（剪贴板不可用）')
        }
      }

      const kw = query.trim().toLowerCase()
      const hit = (...parts) => !kw || parts.some((part) => String(part || '').toLowerCase().includes(kw))
      const allCards = cards || []
      const allIndex = index || []
      const approved = allCards.filter((card) => kbStatus(card.status).text === '已入库')
      const candidates = allCards.filter((card) => kbStatus(card.status).text === '待审核')
      const rejected = allCards.filter((card) => kbStatus(card.status).text === '已驳回')

      const sortList = (list, nameOf, dateOf) => {
        const out = [...list]
        if (sort === 'name') return out.sort((a, b) => String(nameOf(a) || '').localeCompare(String(nameOf(b) || ''), 'zh-Hans-CN'))
        return out.sort((a, b) => String(dateOf(b) || '').localeCompare(String(dateOf(a) || '')))
      }
      const matchedCards = sortList(allCards.filter((card) => hit(card.title, card.content, (card.tags || []).join(' '), card.status, kbCategoryOf(card))), (card) => card.title, (card) => card.updatedAt || card.createdAt)
      const indexShown = sortList(allIndex.filter((entry) => hit(entry.name, entry.taskhiveUse, entry.category, entry.license, entry.repository)), (entry) => entry.name, (entry) => entry.collectedAt)

      // 书本 = 目录：已入库卡片自动分类（用户指定的目录优先）。
      const booksMap = new Map()
      for (const card of sortList(approved, (c) => c.title, (c) => c.updatedAt || c.createdAt)) {
        const name = kbCategoryOf(card)
        if (!booksMap.has(name)) booksMap.set(name, [])
        booksMap.get(name).push(card)
      }
      const books = [...booksMap.entries()].filter(([name, items]) => hit(name) || items.some((card) => hit(card.title, card.content, (card.tags || []).join(' '))))
      const bookNames = [...booksMap.keys()]

      // T166b：导出/导入的"书"就是渲染层已经算好的 kbCategoryOf(card)。导出列表覆盖**全部**
      // 卡片（含待审核 / 已驳回），所以"全选"与原来的整库导出完全等价，一张卡片都不会漏。
      // 用函数而不是每帧都算：只有打开导出面板或点导出时才需要这张表。
      const exportBooksOf = () => {
        const map = new Map()
        for (const card of allCards) {
          const name = kbCategoryOf(card)
          if (!map.has(name)) map.set(name, [])
          map.get(name).push(card)
        }
        return [...map.entries()]
          .map(([name, items]) => ({ name, cards: items.length, ids: items.map((card) => card.id) }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
      }

      // ── T166 阅读视图的目录树 + 随滚动高亮 ──────────────────────────────────
      // 这两个 hook **必须无条件调用**（阅读视图的判断在下面才发生），所以 docBook 为空
      // 时只是算出一棵空树。useMemo 的依赖用"卡片 id + 更新时间"拼出的签名，
      // 避免滚动引起的高亮重渲染去反复解析全部正文（大库下这是真实的卡顿来源）。
      const docCards = docBook ? (booksMap.get(docBook) || []) : []
      const docSignature = docCards.map((card) => `${card.id}:${card.updatedAt || card.createdAt || ''}`).join('|')
      const docToc = React.useMemo(() => kbTocOfBook(docBook, docCards), [docBook, docSignature])
      const docAnchors = React.useMemo(() => kbTocAnchors(docToc), [docToc])

      // 随阅读滚动高亮当前章节：滚动事件不冒泡，用**捕获阶段**的 document 监听
      //（本视图的滚动容器是视图根节点，捕获对任何滚动容器都有效）。
      React.useEffect(() => {
        if (!docBook || !docAnchors.length) return undefined
        const measure = () => {
          const root = rootRef.current
          const base = root && typeof root.getBoundingClientRect === 'function' ? Number(root.getBoundingClientRect().top) || 0 : 0
          const measured = docAnchors.map((anchorId) => {
            const node = typeof document.getElementById === 'function' ? document.getElementById(anchorId) : null
            const rect = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null
            return { id: anchorId, top: rect ? Number(rect.top) : Infinity }
          })
          const next = kbActiveAnchor(measured, base + 96)
          setActiveAnchor((prev) => (prev === next ? prev : next))
        }
        measure()
        document.addEventListener('scroll', measure, true)
        return () => document.removeEventListener('scroll', measure, true)
      }, [docBook, docAnchors])

      // 高亮的小节必须可见：把它的祖先分支自动展开（否则用户看不到当前读到哪儿）。
      React.useEffect(() => {
        if (!activeAnchor) return
        const trail = kbTocPath(docToc, activeAnchor)
        if (!trail.length) return
        setTocOpen((prev) => {
          let changed = false
          const next = { ...prev }
          for (const key of trail) if (next[key] !== true) { next[key] = true; changed = true }
          return changed ? next : prev
        })
      }, [activeAnchor, docToc])

      const tabs = [
        { key: 'shelf', label: '书架', n: booksMap.size },
        { key: 'review', label: '待审核', n: candidates.length },
        { key: 'index', label: '开源索引', n: allIndex.length },
        { key: 'all', label: '全部卡片', n: allCards.length }
      ]
      const stats = [
        { key: 'shelf', n: booksMap.size, l: '本书（自动分类）', tone: '#3b6fd4' },
        { key: 'all', n: approved.length, l: '已入库章节', tone: '#4f8a6b' },
        { key: 'review', n: candidates.length, l: '待审核候选', tone: '#c9a227' },
        { key: 'index', n: allIndex.length, l: '开源索引条目', tone: '#8a6bbf' }
      ]

      // T152：大库分页渲染，避免一次挂上成百上千张卡。
      // **必须定义在使用点之前**：`bookDetail` 是立即执行的 IIFE，曾经把这段放在
      // 文件末尾导致 `Cannot access 'page' before initialization`（TDZ），
      // 整个知识库视图渲染失败 → 用户看到"空白"。
      const page = (list, render) => {
        const shown = list.slice(0, limit)
        return h('div', { style: { display: 'grid', gap: '14px' } },
          h('div', { className: 'tk-grid' }, shown.map(render)),
          list.length > shown.length
            ? h('button', { className: 'tk-btn', type: 'button', onClick: () => setLimit(limit + 60) }, `显示更多（还有 ${list.length - shown.length} 张）`)
            : null)
      }

      const cardNode = (card, index0) => {
        const status = kbStatus(card.status)
        const open = openId === card.id
        const isCandidate = status.text === '待审核'
        const category = kbCategoryOf(card)
        const explicit = Boolean(String(card.category || '').trim())
        return h('article', { className: 'tk-card', key: card.id, id: `kb-ch-${card.id}`, 'data-knowledge-card': card.id, style: { '--spine': status.text === '已入库' ? spineOfBook(category) : status.spine } },
          h('div', { className: 'tk-card-spine' }),
          h('div', { className: 'tk-card-inner' },
            h('div', { className: 'tk-card-top' },
              h('div', { className: 'tk-card-name' }, typeof index0 === 'number' ? `${index0 + 1}. ${kbTitleOf(card)}` : kbTitleOf(card)),
              h('span', { className: `tk-chip ${status.tone}` }, status.text)),
            h('div', { className: 'tk-meta' },
              h('span', { className: 'tk-tag', title: explicit ? '已手动指定目录' : '自动分类' }, `${category}${explicit ? '' : ' · 自动'}`),
              (card.tags || []).slice(0, 3).map((tag, i) => h('span', { className: 'tk-tag', key: `t${i}` }, String(tag))),
              card.updatedAt ? h('span', null, String(card.updatedAt).slice(0, 10)) : null),
            open
              ? h('div', { className: 'tk-body' }, String(card.content || '（无正文）'))
              : h('div', { className: 'tk-use' }, kbSummaryOf(card)),
            h('div', { className: 'tk-actions' },
              h('button', { className: 'tk-btn', type: 'button', onClick: () => setOpenId(open ? '' : card.id), 'aria-expanded': open ? 'true' : 'false' },
                kbIcon([open ? KB_ICON.up[0] : KB_ICON.chevron[0]]), open ? '收起' : '展开'),
              h('button', { className: 'tk-btn is-quiet', type: 'button', onClick: () => copy(card), disabled: busy === `copy:${card.id}` }, kbIcon(KB_ICON.copy), busy === `copy:${card.id}` ? '已复制' : '复制'),
              isCandidate ? h('button', { className: 'tk-btn is-primary', type: 'button', disabled: busy === card.id, onClick: () => review(card.id, 'approve') }, kbIcon(KB_ICON.check), busy === card.id ? '处理中…' : '通过') : null,
              isCandidate ? h('button', { className: 'tk-btn', type: 'button', disabled: busy === card.id, onClick: () => review(card.id, 'reject') }, kbIcon(KB_ICON.close), '驳回') : null,
              h('button', {
                className: `tk-btn${movingCard === card.id ? ' is-primary' : ''}`, type: 'button',
                onClick: () => { setMovingCard(movingCard === card.id ? '' : card.id); setDraft('') },
                title: `移动到其他目录 / 新建目录（当前：${category}${explicit ? '' : ' · 自动'}）`,
                'aria-label': `把「${kbTitleOf(card)}」移动到其他目录`
              }, kbIcon(KB_ICON.move, 13), '目录'))
        ))
      }

      const indexNode = (entry) => h('article', { className: 'tk-card', key: `${entry.repository || ''}:${entry.id || entry.name}`, style: { '--spine': kbSpineOf(entry.category || entry.name) } },
        h('div', { className: 'tk-card-spine' }),
        h('div', { className: 'tk-card-inner' },
          h('div', { className: 'tk-card-top' },
            h('div', { className: 'tk-card-name' }, String(entry.name || entry.id || '未命名')),
            h('span', { className: 'tk-chip' }, entry.install === 'reference-only' || !entry.install ? '仅索引' : String(entry.install))),
          h('div', { className: 'tk-meta' },
            entry.license ? h('span', { className: 'tk-tag' }, String(entry.license)) : null,
            entry.category ? h('span', { className: 'tk-tag' }, String(entry.category)) : null,
            entry.repository ? h('span', { style: { color: 'var(--kb-ink-3)' } }, String(entry.repository)) : null),
          h('div', { className: 'tk-use' }, String(entry.taskhiveUse || '')),
          h('div', { className: 'tk-actions' },
            entry.url ? h('a', { className: 'tk-link', href: String(entry.url), target: '_blank', rel: 'noreferrer noopener' }, kbIcon(KB_ICON.external, 13), '打开仓库') : null)))

      const shelf = (title, items, renderItem, note, opts) => h('section', { className: 'tk-shelf', key: title },
        h('header', { className: 'tk-shelf-head' },
          h('span', { className: 'tk-shelf-dot', style: { '--shelf-tone': (opts && opts.tone) || '#3b6fd4' } }),
          h('span', null, title),
          h('span', { className: 'tk-shelf-count' }, `${items.length} 本`),
          note ? h('span', { className: 'tk-shelf-note' }, note) : null),
        h('div', { className: 'tk-shelf-body', id: opts && opts.bodyId }, items.map(renderItem)),
        h('div', { className: 'tk-shelf-board' }))

      const empty = (title, hint) => h('div', { className: 'tk-empty' }, kbIcon(KB_ICON.inbox, 22), h('strong', null, title), h('span', null, hint))
      const skeleton = h('div', { className: 'tk-covers' }, [0, 1, 2, 3].map((i) => h('div', { className: 'tk-skel', key: i })))

      // 首页：书本封面（书名、章数、目录预览）
      const coverNode = ([name, items]) => h('div', { className: 'tk-cover-wrap', key: name, style: { '--spine': spineOfBook(name) } },
        h('button', {
          className: 'tk-cover', type: 'button', 'data-book': name,
          onClick: () => { setActiveBook(name); setView('book'); setOpenId('') }
        },
          h('span', { className: 'tk-cover-spine' }),
          h('span', { className: 'tk-cover-body' },
            h('span', { className: 'tk-cover-title' }, name),
            h('span', { className: 'tk-cover-meta' }, `${items.length} 章 · 最近 ${String((items[0] && (items[0].updatedAt || items[0].createdAt)) || '').slice(0, 10) || '—'}`),
            h('ol', { className: 'tk-cover-toc' }, items.slice(0, 3).map((card, i) => h('li', { key: card.id }, `${i + 1}. ${kbTitleOf(card).slice(0, 26)}`))),
            items.length > 3 ? h('span', { className: 'tk-cover-more' }, `…共 ${items.length} 章`) : null)),
        h('button', {
          className: 'tk-cover-edit', type: 'button', title: '自定义书名 / 颜色', 'aria-label': `自定义《${name}》的书名与颜色`,
          onClick: (event) => startEditBook(name, event)
        }, kbIcon(KB_ICON.pencil, 13)),
        editingBook === name ? bookEditor(name) : null)

      const shelfView = cards === null ? skeleton : (books.length
        ? h('div', { className: 'tk-covers' }, books.map(coverNode))
        : empty('书架还空着', kw ? '换个关键词，或去「待审核」把候选卡片通过入库' : '在对话里把结论「沉淀」成卡片，通过后会自动分类成书'))

      const bookDetail = (() => {
        const items = (booksMap.get(activeBook) || [])
        if (!items.length) return empty('这本书没有章节', '去「书架」选其他书')
        return h('div', { style: { display: 'grid', gap: '14px' } },
          h('div', { className: 'tk-bookbar' },
            h('button', { className: 'tk-btn', type: 'button', onClick: () => setView('shelf') }, kbIcon(KB_ICON.back, 14), '书架'),
            h('span', { className: 'tk-booktitle' }, `《${activeBook}》`),
            h('button', { className: 'tk-btn', type: 'button', onClick: (event) => startEditBook(activeBook, event) }, kbIcon(KB_ICON.pencil, 13), '改名 / 换色'),
            h('span', { className: 'tk-chip' }, `${items.length} 章`),
            h('span', { className: 'tk-shelf-note' }, '每章可单独移动到其他目录')),
          h('button', { className: 'tk-doc', type: 'button', onClick: () => setDocBook(activeBook) },
            h('span', { className: 'tk-doc-icon' }, kbIcon(KB_ICON.doc, 20)),
            h('span', { className: 'tk-doc-body' },
              h('span', { className: 'tk-doc-name' }, `${activeBook}.doc`),
              h('span', { className: 'tk-doc-meta' }, `${items.length} 章 · 由知识库自动整理 · 点击后铺满整个面板阅读`))),
          h('div', { className: 'tk-toc' },
            h('div', { className: 'tk-toc-head' }, '目录'),
            items.map((card, i) => h('button', {
              className: 'tk-toc-item', key: card.id, type: 'button',
              onClick: () => {
                const node = document.getElementById(`kb-ch-${card.id}`)
                if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' })
                setOpenId(card.id)
              }
            },
              h('span', { className: 'tk-toc-num' }, String(i + 1)),
              h('span', { className: 'tk-toc-text' }, kbTitleOf(card))))),
          page(items, (card, i) => cardNode(card, i)))
      })()

      const reviewView = candidates.length
        ? page(sortList(candidates, (c) => c.title, (c) => c.updatedAt || c.createdAt), (card) => cardNode(card))
        : empty('没有待审核的候选', '在对话里点「沉淀」生成候选卡片后会出现在这里')

      const indexShelves = new Map()
      for (const entry of indexShown) {
        const key = entry.category || '未分类'
        if (!indexShelves.has(key)) indexShelves.set(key, [])
        indexShelves.get(key).push(entry)
      }
      const indexView = index === null ? skeleton : ([...indexShelves.entries()].length
        ? [...indexShelves.entries()].map(([category, items], i) => shelf(`开源索引 · ${category}`, items, indexNode, i === 0 ? '只读 · reference-only' : null, { tone: kbSpineOf(category), bodyId: i === 0 ? 'knowledge-category-grid' : undefined }))
        : empty('没有匹配的索引条目', '索引只做外链展示，不会自动安装任何仓库代码'))

      const allView = cards === null ? skeleton : (matchedCards.length
        ? page(matchedCards, (card) => cardNode(card))
        : empty('没有匹配的卡片', '换个关键词试试'))

      // T146：点开"文档" → **文档铺满整个插件面板**（不显示书架/工具栏，纯粹阅读）。
      // T166：左侧加一条 Word 式的**导航窗格**（书的目录树，可逐级展开/折叠、点击跳转、
      // 随滚动高亮当前章节）；窄屏默认收起，阅读栏上有显示/隐藏开关。
      if (docBook) {
        const docItems = booksMap.get(docBook) || []
        const copyDoc = async () => {
          try { await navigator.clipboard.writeText(kbDocText(docBook, docItems)); setNotice('已复制文档全文') }
          catch { setNotice('复制失败（剪贴板不可用）') }
        }
        const navVisible = navOverride === null ? !narrow : navOverride === true
        const tocNodes = kbVisibleToc(docToc, tocOpen)
        const tocNav = h('nav', {
          className: 'tk-nav', id: 'kb-doc-nav', 'aria-label': `《${docBook}》目录`, role: 'tree'
        },
          h('div', { className: 'tk-nav-head' },
            h('span', null, '目录'),
            h('span', { className: 'tk-chip' }, `${docItems.length} 章`)),
          tocNodes.map((node) => {
            const open = kbTocNodeOpen(node, tocOpen)
            const hasKids = Boolean(node.children && node.children.length)
            const active = Boolean(node.anchorId) && node.anchorId === activeAnchor
            return h('div', {
              key: node.key,
              className: `tk-nav-row lv${node.level}${active ? ' is-active' : ''}`,
              role: 'treeitem',
              'aria-level': String(node.level + 1),
              'aria-expanded': hasKids ? (open ? 'true' : 'false') : undefined,
              'data-kb-toc': node.key,
              style: { paddingLeft: `${node.level * 12}px` }
            },
              hasKids
                ? h('button', {
                  className: 'tk-nav-twist', type: 'button', tabIndex: -1,
                  'aria-label': `${open ? '折叠' : '展开'}「${node.title}」`,
                  'data-kb-toc-twist': node.key,
                  onClick: () => setTocOpen((prev) => ({ ...prev, [node.key]: !kbTocNodeOpen(node, prev) }))
                }, kbIcon(open ? KB_ICON.chevron : KB_ICON.chevronRight, 12))
                : h('span', { className: 'tk-nav-twist is-leaf', 'aria-hidden': 'true' }, kbIcon(KB_ICON.chevron, 10)),
              h('button', {
                className: 'tk-nav-item', type: 'button', 'data-kb-toc-item': node.key,
                title: node.title,
                onClick: () => {
                  if (!node.anchorId) return
                  setActiveAnchor(node.anchorId)
                  kbScrollIntoAnchor(node.anchorId)
                }
              }, h('span', { className: 'tk-nav-text' }, node.title)))
          }))
        return h('section', { ref: rootRef, 'data-taskhive-knowledge': 'active', 'data-kb-doc': docBook },
          h('div', { className: 'tk-reader' },
            h('header', { className: 'tk-reader-bar' },
              h('button', { className: 'tk-btn', type: 'button', onClick: () => { setDocBook(''); setNotice('') } }, kbIcon(KB_ICON.back, 14), '返回书架'),
              h('span', { className: 'tk-reader-title' }, `《${docBook}》`),
              h('span', { className: 'tk-chip' }, `${docItems.length} 章`),
              h('button', {
                className: 'tk-btn', type: 'button', id: 'kb-doc-nav-toggle',
                'aria-controls': 'kb-doc-nav', 'aria-expanded': navVisible ? 'true' : 'false',
                title: '显示 / 隐藏左侧目录（窄屏默认收起）',
                onClick: () => setNavOverride(!navVisible)
              }, kbIcon(navVisible ? KB_ICON.collapse : KB_ICON.shelf, 13), navVisible ? '隐藏目录' : '显示目录'),
              h('button', { className: 'tk-btn is-quiet', type: 'button', onClick: copyDoc }, kbIcon(KB_ICON.copy, 13), '复制全文')),
            notice ? h('div', { className: 'tk-notice', role: 'status' }, notice) : null,
            h('div', { className: `tk-reader-layout${navVisible ? ' is-nav-on' : ' is-nav-off'}` },
              tocNav,
              h('div', { className: 'tk-reader-main' },
                h('article', { className: 'tk-paper' },
                  h('h1', { className: 'tk-paper-title' }, docBook),
                  h('p', { className: 'tk-paper-sub' }, `${docItems.length} 章 · 由知识库自动整理 · ${new Date().toISOString().slice(0, 10)}`),
                  h('nav', { className: 'tk-paper-toc' },
                    h('h2', null, '目录'),
                    h('ol', null, docItems.map((card, i) => h('li', { key: card.id },
                      h('button', {
                        type: 'button',
                        onClick: () => { const anchor = `kb-doc-${card.id}`; setActiveAnchor(anchor); kbScrollIntoAnchor(anchor) }
                      }, `${i + 1}. ${kbTitleOf(card)}`))))),
                  docItems.map((card, i) => {
                    const blocks = kbChapterBlocks(card)
                    return h('section', { className: 'tk-chapter', id: `kb-doc-${card.id}`, key: card.id },
                      h('h2', { className: 'tk-chapter-title' }, `${i + 1}. ${kbTitleOf(card)}`),
                      h('p', { className: 'tk-chapter-meta' }, `${kbCategoryOf(card)} · ${String(card.updatedAt || card.createdAt || '').slice(0, 10)}`),
                      h('div', { className: 'tk-chapter-body' }, blocks.map((block, j) => (block.kind === 'head'
                        ? h('h3', { className: 'tk-chapter-sub', id: block.anchorId, key: `h${j}` }, block.text)
                        : h('div', { className: 'tk-chapter-block', key: `b${j}` }, block.text)))))
                  }))))))
      }

      // T152：目录选择器只渲染**当前这一张**卡的候选（原先每卡一个 <select>，option 数 = 卡数 × 书数）。
      const movePicker = (() => {
        if (!movingCard) return null
        const card = (cards || []).find((item) => item.id === movingCard)
        if (!card) return null
        return h('div', { className: 'tk-picker', role: 'dialog', 'aria-label': '选择目录' },
          h('div', { className: 'tk-picker-head' }, `把「${kbTitleOf(card)}」移到：`, h('span', { className: 'tk-chip' }, kbCategoryOf(card))),
          h('div', { className: 'tk-picker-list' },
            h('button', { className: 'tk-btn is-quiet', type: 'button', disabled: busy === `cat:${card.id}`, onClick: () => { void setCategory(card, ''); setMovingCard('') } }, '自动分类'),
            bookNames.map((name) => h('button', {
              key: name, className: 'tk-btn', type: 'button', disabled: busy === `cat:${card.id}`,
              onClick: () => { void setCategory(card, name); setMovingCard('') }
            }, name))),
          h('div', { className: 'tk-picker-new' },
            h('input', {
              className: 'tk-move-input', value: draft, placeholder: '新建目录名', 'aria-label': '新建目录名',
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => { if (event.key === 'Enter' && draft.trim()) { void setCategory(card, draft.trim()); setMovingCard('') } }
            }),
            h('button', { className: 'tk-btn is-primary', type: 'button', disabled: !draft.trim(), onClick: () => { void setCategory(card, draft.trim()); setMovingCard('') } }, '新建并移动')),
          h('button', { className: 'tk-btn is-quiet', type: 'button', onClick: () => setMovingCard('') }, '取消'))
      })()

      // T166b：书的多选列表（导出与导入共用同一段渲染）。全选 / 反选 / 选中搜索结果 / 清空
      // 都只改"勾了哪些书"，真正的判定（新增/更新/保留/相同）全部来自主进程的预检明细。
      const bookPickList = (rows, sel, setSel, q, setQ, label, note) => {
        const needle = String(q || '').trim().toLowerCase()
        const shown = (rows || []).filter((row) => !needle || String(row.name).toLowerCase().includes(needle))
        const chosen = (rows || []).filter((row) => sel[row.name])
        const chosenCards = chosen.reduce((sum, row) => sum + Number(row.cards || 0), 0)
        const markAll = (value) => setSel((prev) => { const next = { ...prev }; for (const row of rows || []) next[row.name] = value; return next })
        return h('div', { className: 'tk-bookpick' },
          h('div', { className: 'tk-bookpick-head' },
            h('span', { className: 'tk-bookpick-title' }, label),
            h('span', { className: 'tk-chip' }, `已选 ${chosen.length} / ${(rows || []).length} 本`),
            h('span', { className: 'tk-chip' }, `${chosenCards} 张卡片`)),
          h('div', { className: 'tk-bookpick-head' },
            h('input', {
              className: 'tk-bookpick-search', type: 'search', value: q || '', placeholder: '搜索书名', 'aria-label': '搜索书名',
              onChange: (event) => setQ(event.target.value)
            }),
            h('button', { className: 'tk-btn', type: 'button', 'data-kb-book-all': 'true', onClick: () => markAll(true) }, '全选'),
            h('button', { className: 'tk-btn', type: 'button', onClick: () => setSel((prev) => { const next = {}; for (const row of rows || []) next[row.name] = !prev[row.name]; return next }) }, '反选'),
            h('button', { className: 'tk-btn', type: 'button', onClick: () => setSel((prev) => { const next = { ...prev }; for (const row of shown) next[row.name] = true; return next }) }, '选中搜索结果'),
            h('button', { className: 'tk-btn', type: 'button', onClick: () => setSel({}) }, '清空')),
          shown.length
            ? h('div', { className: 'tk-bookpick-list', role: 'group', 'aria-label': label },
              shown.map((row) => h('label', { className: 'tk-bookpick-row', key: row.name },
                h('input', {
                  type: 'checkbox', checked: Boolean(sel[row.name]), 'data-kb-book': row.name,
                  // 函数式更新：连点两下不会因为闭包里的旧 sel 丢掉第一下
                  onChange: () => setSel((prev) => ({ ...prev, [row.name]: !prev[row.name] }))
                }),
                h('span', { className: 'tk-bookpick-name', title: String(row.name) }, String(row.name)),
                h('span', { className: 'tk-bookpick-n' }, note ? note(row) : `${row.cards} 张`))))
            : h('div', { className: 'tk-bookpick-empty' }, '没有匹配的书名'))
      }

      // T166：导入预检面板（**先预检再写**；替换模式必须二次确认）。只在选了文件之后出现，
      // 入口就是顶部既有操作区的「导入」，不新开按钮区。
      // T166b：面板里多一个"选择要导入的书"多选列表 —— 勾几本就导入几本；上面的
      // 新增/更新/保留/相同 + 书数都是**只对勾选的书**求和（主进程算，渲染层只做加法）。
      const importPanel = (() => {
        if (!importPlan) return null
        if (importPlan.ok !== true) {
          return h('div', { className: 'tk-importer', role: 'dialog', 'aria-label': '导入预检失败' },
            h('div', { className: 'tk-importer-head' }, kbIcon(KB_ICON.close, 14), '这个文件不能导入 —— 没有写入任何数据'),
            h('div', { className: 'tk-importer-sub' }, `${importPlan.name || ''}${importPlan.path ? ` · ${importPlan.path}` : ''}`),
            h('div', { className: 'tk-error' }, [importPlan.error, ...(importPlan.issues || [])].filter(Boolean).join('\n')),
            h('div', { className: 'tk-actions' },
              h('button', { className: 'tk-btn', type: 'button', onClick: () => { setImportPlan(null); setImportPick({ q: '', sel: {} }) } }, '关闭'),
              h('button', { className: 'tk-btn', type: 'button', disabled: importBusy === 'inspect', onClick: () => { void startImport() } }, '重新选择文件')))
        }
        const whole = importPlan.summary || { cards: {}, books: {}, local: {} }
        const local = whole.local || {}
        const rows = Array.isArray(importPlan.books) ? importPlan.books : []
        const sel = importPick.sel || {}
        const pickedRows = rows.filter((row) => sel[row.name])
        const summed = kbSumBookSummaries(pickedRows)
        // 老主进程不返回 books 明细时退回整份摘要（并把 books 参数留空 = 整份导入）。
        const cards = rows.length ? summed.cards : (whole.cards || {})
        const books = rows.length ? summed.books : (whole.books || {})
        const pickedCards = pickedRows.reduce((sum, row) => sum + Number(row.cards || 0), 0)
        const nothingPicked = rows.length > 0 && pickedRows.length === 0
        const cell = (n, label) => h('div', { className: 'tk-import-cell', key: label }, h('b', null, String(n || 0)), h('span', null, label))
        return h('div', { className: 'tk-importer', role: 'dialog', 'aria-label': '导入预检' },
          h('div', { className: 'tk-importer-head' },
            kbIcon(KB_ICON.doc, 14),
            `导入预检：${importPlan.name || '知识库文件'}`,
            h('span', { className: 'tk-chip' }, `schema v${importPlan.schemaVersion || 1}`),
            h('span', { className: 'tk-chip' }, `${(whole.cards || {}).total || 0} 张卡片 / ${(whole.books || {}).total || 0} 本书`),
            importPlan.scoped ? h('span', { className: 'tk-chip' }, '按书导出') : null),
          h('div', { className: 'tk-importer-sub' },
            `${importPlan.exportedAt ? `导出时间 ${String(importPlan.exportedAt).replace('T', ' ').slice(0, 19)} · ` : ''}本机现有 ${local.cards || 0} 张卡片 / ${local.books || 0} 本书`),
          rows.length
            ? bookPickList(
              rows, sel,
              (next) => setImportPick((prev) => ({ ...prev, sel: typeof next === 'function' ? next(prev.sel || {}) : next })),
              importPick.q,
              (value) => setImportPick((prev) => ({ ...prev, q: value })),
              '选择要导入的书（勾几本就导入几本）',
              (row) => `${row.cards} 张${row.localCards ? ` · 本机已有 ${row.localCards}` : ''}`)
            : null,
          h('div', { className: 'tk-import-grid' },
            cell(cards.added, '将新增卡片'),
            cell(cards.updated, '将更新（文件较新）'),
            cell(cards.keptLocal, '保留本机较新'),
            cell(cards.identical, '完全相同'),
            cell(books.added, '将新增书'),
            cell(books.updated, '将更新书籍元数据')),
          h('div', { className: 'tk-import-mode' },
            h('label', { className: 'tk-radio' },
              h('input', { type: 'radio', name: 'kb-import-mode', value: 'merge', checked: importMode === 'merge', onChange: () => { setImportMode('merge'); setImportStep('preview') } }),
              h('span', null, '合并（默认）', h('em', null, '按稳定 id 合并：同名书合并，本机独有的卡片一张不丢'))),
            h('label', { className: 'tk-radio' },
              h('input', { type: 'radio', name: 'kb-import-mode', value: 'replace', checked: importMode === 'replace', onChange: () => { setImportMode('replace'); setImportStep('preview') } }),
              h('span', null, '替换', h('em', null, `清空本机现有 ${local.cards || 0} 张卡片 / ${local.books || 0} 本书后再导入（导入前自动备份）`)))),
          importStep === 'replace'
            ? h('div', { className: 'tk-warn' },
              `替换会清空本机现有的 ${local.cards || 0} 张卡片与 ${local.books || 0} 本书，只保留这个文件里**选中的 ${pickedRows.length} 本书**（${pickedCards} 张卡片）。主程序会先把现有 cards.json / books.json 备份到 knowledge/backups 再写入。确认要替换吗？`)
            : null,
          nothingPicked
            ? h('div', { className: 'tk-error' }, '没有勾选任何书：至少勾选一本；现在不会写入任何数据')
            : null,
          h('div', { className: 'tk-actions' },
            importStep === 'replace'
              ? h('button', { className: 'tk-btn is-primary', type: 'button', disabled: importBusy === 'replace' || nothingPicked, onClick: () => { void applyImport('replace') } }, importBusy === 'replace' ? '替换中…' : `确认替换并导入 ${pickedRows.length} 本`)
              : (importMode === 'replace'
                ? h('button', { className: 'tk-btn', type: 'button', disabled: nothingPicked, onClick: () => setImportStep('replace') }, '替换导入…（需二次确认）')
                : h('button', { className: 'tk-btn is-primary', type: 'button', disabled: importBusy === 'merge' || nothingPicked, onClick: () => { void applyImport('merge') } }, importBusy === 'merge' ? '合并中…' : `合并导入 ${pickedRows.length} 本`)),
            importStep === 'replace'
              ? h('button', { className: 'tk-btn', type: 'button', onClick: () => setImportStep('preview') }, '返回')
              : null,
            h('button', { className: 'tk-btn is-quiet', type: 'button', onClick: () => { setImportPlan(null); setImportStep('preview'); setImportPick({ q: '', sel: {} }) } }, '取消')))
      })()

      // T166b：导出前先选书（默认全选 = 原来的一键整库导出）。同一个既有操作区、同一种面板，
      // 不新开按钮区；导出一本就是"只勾一本"。
      const exportPanel = (() => {
        if (!exportPick) return null
        const rows = exportBooksOf()
        const sel = exportPick.sel || {}
        const picked = rows.filter((row) => sel[row.name])
        return h('div', { className: 'tk-importer', role: 'dialog', 'aria-label': '选择要导出的书' },
          h('div', { className: 'tk-importer-head' },
            kbIcon(KB_ICON.download, 14),
            '选择要导出的书',
            h('span', { className: 'tk-chip' }, '只勾一本＝单本导出')),
          bookPickList(
            rows, sel,
            (next) => setExportPick((prev) => ({ ...(prev || {}), sel: typeof next === 'function' ? next((prev || {}).sel || {}) : next })),
            exportPick.q,
            (value) => setExportPick((prev) => ({ ...(prev || {}), q: value })),
            '导出哪些书'),
          h('div', { className: 'tk-actions' },
            h('button', {
              className: 'tk-btn is-primary', type: 'button', disabled: exportBusy || !picked.length,
              onClick: () => { void exportBundle(picked.map((row) => row.name)) }
            }, exportBusy ? '导出中…' : `导出选中的 ${picked.length} 本`),
            h('button', { className: 'tk-btn is-quiet', type: 'button', onClick: () => setExportPick(null) }, '取消')))
      })()

      // T152：大库分页渲染助手见上方 `page()`（必须在使用点之前定义）。

      return h('section', { ref: rootRef, 'data-taskhive-knowledge': 'active', 'data-kb-doc': '' },
        h('header', { className: 'tk-hero' },
          h('div', { className: 'tk-brand' },
            h('span', { className: 'tk-brand-mark' }, kbIcon(KB_ICON.books, 22)),
            h('div', null,
              h('h2', { className: 'tk-title' }, '知识库'),
              h('p', { className: 'tk-sub' }, '已入库内容自动成书 · 可自己整理目录 · 开源插件索引'))),
          h('div', { className: 'tk-hero-actions' },
            h('label', { className: 'tk-search' },
              kbIcon(KB_ICON.search, 14),
              h('input', {
                type: 'search', value: query, 'aria-label': '搜索知识库',
                placeholder: '搜索书名 / 标题 / 正文 / 标签 / 用途 / 仓库',
                onChange: (event) => setQuery(event.target.value)
              })),
            h('button', {
              className: 'tk-btn is-primary', type: 'button', disabled: aiBusy,
              onClick: () => { void aiClassify() },
              title: '让 AI 识别已入库内容，按主题自动整理成书'
            }, kbIcon(KB_ICON.spark, 14), aiBusy ? 'AI 识别中…' : 'AI 整理书架'),
            // T166：导出 / 导入（同一个既有操作区，不新开按钮区）。
            // T166b：导出先选书（可多选，只勾一本就是单本导出；默认全选＝原来的整库导出）。
            h('button', {
              className: 'tk-btn', type: 'button', disabled: exportBusy, id: 'kb-export',
              onClick: () => { openExportPick() },
              title: '选择要导出的书（可多选；全选即导出整库）'
            }, kbIcon(KB_ICON.download, 13), exportBusy ? '导出中…' : '导出'),
            h('button', {
              className: 'tk-btn', type: 'button', disabled: importBusy === 'inspect', id: 'kb-import',
              onClick: () => { void startImport() },
              title: '从 .taskhive-kb.json 文件导入（先预检、按书勾选，再合并或替换）'
            }, kbIcon(KB_ICON.upload, 13), importBusy === 'inspect' ? '预检中…' : '导入'),
            h('button', { className: 'tk-btn', type: 'button', onClick: () => { void load() }, title: '重新读取知识库' }, kbIcon(KB_ICON.refresh), '刷新'))),

        h('div', { className: 'tk-stats' }, stats.map((stat) => h('button', {
          className: 'tk-stat', key: stat.key, type: 'button', style: { '--tone': stat.tone },
          onClick: () => setView(stat.key === 'shelf' ? 'shelf' : stat.key === 'index' ? 'index' : stat.key === 'review' ? 'review' : 'all'),
          title: `查看：${stat.l}`
        },
          h('span', { className: 'tk-stat-n' }, String(stat.n)),
          h('span', { className: 'tk-stat-l' }, stat.l)))),

        error ? h('div', { className: 'tk-error' }, error) : null,
        notice ? h('div', { className: 'tk-notice', role: 'status' }, notice) : null,

        h('div', { className: 'tk-controls' },
          h('div', { className: 'tk-tabs', role: 'tablist' }, tabs.map((tab) => h('button', {
            className: `tk-tab${(view === tab.key || (tab.key === 'shelf' && view === 'book')) ? ' is-on' : ''}`,
            key: tab.key, type: 'button', role: 'tab',
            'aria-selected': (view === tab.key || (tab.key === 'shelf' && view === 'book')) ? 'true' : 'false',
            onClick: () => setView(tab.key)
          }, tab.label, h('span', { className: 'tk-tab-n' }, String(tab.n))))),
          h('label', { className: 'tk-sort' }, '排序',
            h('select', { className: 'tk-select', value: sort, onChange: (event) => setSort(event.target.value), 'aria-label': '排序方式' },
              h('option', { value: 'updated' }, '最近更新'),
              h('option', { value: 'name' }, '名称')))),
        movePicker,
        exportPanel,
        importPanel,

        view === 'shelf' ? shelfView : null,
        view === 'book' ? bookDetail : null,
        view === 'review' ? reviewView : null,
        view === 'index' ? indexView : null,
        view === 'all' ? allView : null,

        rejected.length && view === 'all' ? h('p', { className: 'tk-shelf-note' }, `另有 ${rejected.length} 张已驳回卡片不参与成书`) : null)
    }
// 78-codesys-ai-chat.js — T174/T175：CODESYS AI 对话的**极薄数据桥**（本文件不再渲染任何 UI）
//
// 用户的架构要求（原话）：
//   「我建议 ai 对话不调用原生的右侧栏，而是直接在 codesys 插件里面做一个右侧栏，这样每次
//     更新右侧栏就不需要重新适配」
//
// 改版前：本 shard 用 React 把对话框渲染进 **DSH 原生右栏**（`[class*="rightbarCol"]`），外壳靠
// 主进程 `executeJavaScript` 调 `window.__TASKHIVE_TOGGLE_CODESYS_AI__` 把它打开。用户实测
// "点了几次完全没出现" —— 跨框架全局函数 + 依赖宿主右栏 DOM + 宿主布局一变就塌，非常脆。
//
// 改版后（本文件就是全部 DSH 侧代码）：
//   * **界面**：完全由外壳的 CODESYS 插件面板自己渲染 —— 见 `app/renderer/renderer.js` 里的
//     右侧对话抽屉（宽面板并排、窄面板覆盖式）。本文件**不创建任何 DOM/React 节点**，
//     也**不再查询** `[class*="rightbarCol"]`。于是 DSH 怎么改布局都与这个界面无关。
//   * **数据**：只注册下面这一个全局入口，且只传数据、不渲染 UI：
//       window.__TASKHIVE_CODESYS_AI_BRIDGE__ = {
//         version,
//         async snapshot(limit),   // 主页那条会话的最近若干条消息 **+ 当前模型**
//         async prompt(text),      // 往主页那条会话里发一条 prompt
//         async models(),          // 这条会话可用的模型目录 + 当前模型（含每个模型的推理等级能力）
//         async setModel(input),   // 改**这条会话**用的模型 / 推理等级（`{ id, effort? }`，也接受老的裸 id 串）
//         async ensureWorkbench(), // T184：确保工作台绑到面板当前跟随的工程（只绑定，见文末 T184 段）
//         async answer(payload),   // T185：**用户点击后**替他把一条待回答的提问交回去（见下面 T185 段）
//       }
//     主进程对**全部框架**逐个调用它（见 app/main.js 的 codesys:ai-chat / -snapshot / -prompt /
//     -model / -answer 五个 handler），外壳只消费返回的数据。
//
// 为什么数据桥必须留在 DSH 文档里（唯一无法回避的约束）：**只有 DSH 文档里有 `sessions` 服务**，
// "主页那条会话"就在那里。绑定语义沿用 T164，**T176 修掉了"哪条会话"这一步**：
//   * 定位：`retainedBy.mainView > 0` 的那条会话（与 DSH 原生 UI 同一个判据，见下面 T176 那一段）；
//   * 读：那条会话的**消息视图**（T181 修掉了"读哪里"这一步 —— DSH 0.2 的会话快照没有 nodes，
//         真实消息在 uiSession 的 `hooks.chat` 里，见下面 T181 那一段；老形状仍然兼容）；
//   * 写：`sessions.binding(id).session.prompt([{ type: 'text', text }], 'queue')`。
//   * 模型：见下面 T175 那一段（`modelDirectories` / `remote.session.selectModel`）。
// 于是"在插件面板里说话 == 在主页说话"，同一条会话流，回复两边都可见（这是用户选定的行为）。
//
// 失败可观测（T173 的教训：绝不允许"点了完全没反应、日志里一行都没有"）：
//   * 每个失败分支都把 `{ ok: false, reason, detail }` 作为**数据**回传，外壳状态行直接显示；
//   * 最近一次阶段写进 `window.__TASKHIVE_CODESYS_AI_STATUS__`，主进程在找不到入口时会读它，
//     所以"哪个框架、哪一步失败"是明确的，而不是笼统的"未就绪"。

// 桥的版本号：主进程 / 外壳只把它当"入口在不在"的证据使用（不参与逻辑分支）。
const CODESYS_AI_BRIDGE_VERSION = 'T185';

// 单次快照最多回传多少条消息；上下限是为了让 1.5 秒一次的轮询不可能变成大 payload。
const CODESYS_AI_SNAPSHOT_DEFAULT = 40;
const CODESYS_AI_SNAPSHOT_MIN = 1;
const CODESYS_AI_SNAPSHOT_MAX = 200;

// 最近一次阶段。主进程在"哪个框架都没有入口"时会把它捞回去，所以它必须含**阶段名**与**细节**。
function codesysAiChatNote(stage, extra) {
  const note = { stage: String(stage || ''), extra: String(extra || ''), at: new Date().toISOString() };
  try { window.__TASKHIVE_CODESYS_AI_STATUS__ = note; } catch { /* 无 window：忽略 */ }
  return note;
}

// `sessions` 只能在 DSH 文档里拿到，而且 slot 恢复期间取服务会抛错，所以每次都从 ctx 现取。
function codesysAiChatSessions(ctx) {
  const sessions = getOptionalService(ctx, 'sessions');
  return { sessions, store: sessions && sessions.list ? sessions.list : null };
}

// T178：`uiSession` 与 `modelDirectories`/`remote` 一样**不在**本插件的 inject 列表里，所以旧的
// `getOptionalService`（就一句 `ctx?.[name]`，只沿 fiber 祖先链查）对它**恒返回 null** ——
// 会话判定链条里的 ① `uiSession.current` 一直是死代码，真正生效的只有 ② `retainedBy.mainView`。
// 这里改成"不要求 inject 的读法优先、旧写法兜底"，让文档里写的那条链真的可执行（顺序不变）。
function codesysAiChatOptionalService(ctx, name) {
  const found = codesysAiChatFindService(ctx, [name], null);
  return found.value || getOptionalService(ctx, name);
}

// ── T176：**主页正在看的那条会话到底是哪一条**（真因修复） ──────────────────────────────────
//
// T164 起这里读的是 `sessions.list.getSnapshot().current`。**DSH 0.2 删掉了这个字段**：
//   * `@deepseek-ai/dsh-api-session-controller/lib/client.js` 的 list store 初值只有
//     `{ ids, byId, phase, projectionsBySession }`（:3166-3171），每次 `projectList()` 也只写回
//     这四个键（:3570-3575）—— 所以 `current` 永远是 `undefined`；
//   * 于是 `codesysAiChatCurrentSessionId()` 恒为空串，`snapshot()` / `prompt()` / `models()`
//     一起返回 `{ ok:false, reason:'no-session' }`。用户在真机上看到的就是下拉里的
//     `模型目录不可用`（外壳把任何 `ok !== true` 都画成这一句），detail 是
//     "主页当前没有正在查看的会话：先在主页打开或新建一个会话" —— **即使他正开着一条会话**。
//     审计流里逐字可查：`logs/trajectory.jsonl` 的 `codesys.ai-chat.models-failed` /
//     `codesys.ai-chat.snapshot-failed`，`reason:"no-session"`。
//
// DSH 0.2 的权威判据是"**被主视图保留的那条会话**"（`retainedBy.mainView > 0`）：
//   * `@deepseek-ai/dsh-client-ui-session/lib/client.js` 的 `publishMain()` / `isMain()` 就是
//     `Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id`；
//   * `dsh-client-ui-layout` 的 DocumentTitle、`dsh-client-ui-cordis`、`dsh-client-ui-workspace`
//     的 `replaceMain(… { source: 'mainView' })`、`dsh-client-ui-open-in-app` 全是同一条判据；
//   * 本仓的 shard 80 已经按它修过一次（`80-codesys-task-and-apply.js` 的 `currentSessionId()`
//     与它上面那段 "DSH 0.2 removed `sessions.current` from the raw list projection" 注释）。
//     T176 只是把同一个判据接到数据桥上，不另造来源。
//
// 两条来源都用，顺序固定：
//   ① `ctx.uiSession.current` —— `@deepseek-ai/dsh-client-ui-session` 已经算好的主视图绑定，
//      值形如 `{ key: sessionId, hooks: { session }, props: { sessionId } }`，
//      `key === undefined` = 主页没在看会话（它的 absent 值）；
//   ② `sessions.list.getSnapshot().byId` 里 `retainedBy.mainView > 0` 的那一条（老写法兜底，
//      uiSession 没加载 / 正在换代时走这里）；
//   ③ 最后才看旧字段 `current` —— 只为向前兼容（万一哪天 DSH 又把它加回来），不再是唯一来源。
function codesysAiChatSessionListSnapshot(ctx) {
  const { store } = codesysAiChatSessions(ctx);
  try { return (store && store.getSnapshot && store.getSnapshot()) || null; } catch { return null; }
}

// 主视图绑定的会话 id；`''` = 主页没有正在查看的会话。
function codesysAiChatCurrentSessionId(ctx) {
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null;
    const key = binding && binding.key;
    if (typeof key === 'string' && key) return key;
  } catch { /* 服务正在换代：落到 ② */ }
  const snapshot = codesysAiChatSessionListSnapshot(ctx);
  const byId = snapshot && snapshot.byId;
  if (byId && typeof byId === 'object') {
    for (const row of Object.values(byId)) {
      if (!row) continue;
      const retained = Number((row.retainedBy && row.retainedBy.mainView) || 0);
      const id = row.id === undefined || row.id === null ? '' : String(row.id);
      if (retained > 0 && id) return id;
    }
  }
  const legacy = snapshot && snapshot.current;
  return typeof legacy === 'string' ? legacy : '';
}

// 把会话 id 解析成 binding。每一步失败都带自己的 reason，便于外壳区分"没会话"和"读不出来"。
function codesysAiChatBinding(ctx, sessionId) {
  const { sessions } = codesysAiChatSessions(ctx);
  if (!sessions || typeof sessions.binding !== 'function') {
    return { reason: 'no-sessions', detail: 'DSH 文档没有暴露 sessions.binding（服务未就绪）' };
  }
  let binding = null;
  try { binding = sessions.binding(sessionId); }
  catch (error) { return { reason: 'binding-threw', detail: String((error && error.message) || error) }; }
  const conversation = binding && binding.session ? binding.session : null;
  if (!conversation) return { reason: 'no-binding', detail: `会话 ${sessionId} 还没有可用的对话入口` };
  return { conversation };
}

// 主视图那条会话 = `{ sessionId, conversation }`，或者 `{ reason, detail }`（可读原因）。
// `snapshot()` / `prompt()` / `models()` / `setModel()` 全走这一个入口，所以"哪条会话"只有一份定义。
function codesysAiChatMainSession(ctx) {
  const { sessions, store } = codesysAiChatSessions(ctx);
  if (!sessions || !store) {
    return { reason: 'no-sessions', detail: '这个文档里没有 sessions 服务（只有 DSH 文档才有主页会话）' };
  }
  const sessionId = codesysAiChatCurrentSessionId(ctx);
  if (!sessionId) {
    const snapshot = codesysAiChatSessionListSnapshot(ctx);
    const rows = snapshot && snapshot.byId && typeof snapshot.byId === 'object' ? Object.keys(snapshot.byId).length : 0;
    return {
      reason: 'no-session',
      detail: rows
        ? `主页正在显示的不是一条会话（会话列表里有 ${rows} 条，但没有一条挂在主视图上）：先在主页点开或新建一条会话，再回到这里`
        : '主页当前没有会话：先在主页新建或打开一条会话，再回到这里',
    };
  }
  // ① `uiSession` 已经把会话对象算好了，直接用（它的判据与 DSH 原生 UI 完全同源）。
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null;
    const conversation = binding && binding.key === sessionId && binding.hooks ? binding.hooks.session : null;
    if (conversation) return { sessionId, conversation };
  } catch { /* 落到 ② */ }
  const resolved = codesysAiChatBinding(ctx, sessionId);
  if (resolved.reason) return { reason: resolved.reason, detail: resolved.detail, sessionId };
  return { sessionId, conversation: resolved.conversation };
}

// ── T175：模型（"选中的模型是**会话级**的"） ────────────────────────────────────────────────
//
// 用户原话：「会话调用的主会话的接口，可以选择模型」。抽屉绑定的就是主页那条会话，所以"改模型"
// 改的是**这条会话**用的模型。
//
// **真实接口**（逐个在 DSH 包里查过，不是猜的）：
//   * 主页 composer 的模型座位是客户端插件 `@deepseek-ai/dsh-client-ui-model-selection`
//     （`ModelSelect: the composer's named model seat (conversation.input.model)`）。它依赖的 cordis
//     服务是 **`modelDirectories`**（`class ModelDirectoryResolver extends Service { constructor(ctx)
//     { super(ctx, "modelDirectories") } }`），per-session 目录来自
//     `modelDirectories.directoryFor(sessionId)`：
//       - `await directory.load()`  → 快照 `{ current, routable, groups, failures, status }`，
//         其中 `current` 就是**这条会话**当前选中的 `{ provider, model, reasoningEffort? }`；
//       - `await directory.select({ provider, model, reasoningEffort? })` → `{ ok:true }` 或
//         `{ ok:false, error:{ code, message } }`（真包 `client.js:235-251`：`select()` 把
//         `selection.reasoningEffort` **原样**转发成 `sessions.selectModel` 的同名字段，
//         没传就整个字段都不发 —— 也就是"交给 provider 自己的默认档"）。
//   * 它底层走的是远端方法：`ctx.remote.session.modelCatalog()`（返回 `{ok,value:{default,
//     routableProviders,groups,failures}}` 信封）与 `ctx.remote.session.selectModel({ sessionId,
//     provider, model, reasoningEffort? })`（参数/结果 schema：`sessionId/provider/model/
//     reasoningEffort` → `{ selected: { provider, model, reasoningEffort? } }`）。
//   * **会话级**：`selectModel` 的实现是 `requireModel` → `llm.resolveCallConfig` →
//     `agents.selectForNextRequest(agent, selected)`，即装到"这条会话的下一次请求"上，并落在会话的
//     `modelSelection` 投影里（`binding.session.projections.faceOf('modelSelection').getSnapshot()`
//     → `{ lastUsed, next }`）；全局默认只是后台顺手存一份（`agentDefaultModel.saveSelection`）。
//     模型不存在时它会抛 `RemoteError('session/model-unavailable', ...)`。
//
// 所以这里两条路都接上：**优先**用与主页 composer 完全同一个服务（`modelDirectories`），
// 服务缺失时退回远端方法 `remote.session.modelCatalog/selectModel`。两条都是 DSH 真实存在的接口。
// ── T178：**注册名 + "没有 inject 声明时怎么取服务"**（"模型目录不可用"的第二个真因） ────────────
//
// 一、注册名到底是哪个（DSH 真包，逐条给证据，不是猜）：
//   * **`modelDirectories`** —— `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:365`
//     `super(ctx, "modelDirectories")`：这一句是**唯一**决定注册名的代码。
//     TaskHive 实际加载的是 0.2.0-rc.1（`resources/app/harness/runtime/slot/payload/` 下同包），
//     同一行仍在 `:365`（npm 上那份 0.1.7-rc.2 的同一行在 `:355`，名字相同）。
//   * 同包 `:1062` `ctx.inject(["commandUi", "modelDirectories"], …)`、`:1092`
//     `ctx.inject(["slots", "modelDirectories"], …)` —— DSH 自己的两个消费者也用这个名字；
//     `lib/types/client/service.d.ts:21` `modelDirectories: ModelDirectoryResolver;` 是同一条事实。
//   * 同文件 `:362` 的注释 "the service registers itself as models" 是**过期注释**（它下面两行就是
//     `super(ctx, "modelDirectories")`）。前一个执行者记下的那处"矛盾"就是它 —— **以代码为准**。
//
// 二、那为什么还是取不到（第二个真因，与注册名无关）：
//   * 本插件向 DSH 声明的 cordis 依赖只有 `['layout','workspaces','sessions','uiWorkspace','slots',
//     'sidebarRight','sidebarRightTabs']`（生成文件 `dsh/client.js` 末尾的 `module.exports.inject`）。
//     `sessions` 在列表里 → 会话判定一直可用；`modelDirectories` 与 `remote` **都不在**。
//   * cordis 4 的上下文代理对"没声明 inject 的服务"只沿 **fiber 祖先链**查各 fiber 的 store，
//     查不到就抛 `cannot get property "X" without inject`：
//     `@deepseek-ai/cordis/src/reflect.ts:136-171`（`:157` 查 `fiber.store?.[prop]`、`:163` 到根仍抛）。
//     `modelDirectories` / `remote` 由**兄弟插件**的 fiber 提供，不在祖先链上 → 必抛；
//     而旧的 `getOptionalService` 是 `catch { return null }` → 直接被吞成"两个服务都没有"。
//     审计流原文（`logs/trajectory.jsonl` 第 19044 行，用户重启之后）：
//       {"reason":"no-model-service","detail":"DSH 文档里既没有 modelDirectories.directoryFor，
//        也没有 remote.session.modelCatalog"}
//   * cordis 官方给了**不要求 inject** 的读法：`ctx.reflect.get(name, strict)`
//     （`@deepseek-ai/cordis/src/reflect.ts:225-235`，注释原文 "Read a service from the store
//     without the inject requirement"）。它查的是**全局 store**（同文件 `:237-243` 的 `_getImpl`，
//     `:239` `const impl = this.store[key]`），所以兄弟 fiber 提供的服务也能拿到；
//     `ctx.get(name)` 就是它（`:219` 把 `get` mixin 到 ctx 上），默认 `strict = true`
//     （只返回提供者 fiber 已激活的实现），`strict = false` 连未激活的也返回 —— 诊断用。
//     （同一条事实在编译产物 `@deepseek-ai/cordis/lib/index.js` 里是 `:755-765` 与 `:766-772`。）
//   * 顺便：这一层还能**枚举**已声明的属性名 —— `ctx.reflect.props`（`reflect.ts:211`；`provide()`
//     在 `:279-284` 写 `this.props[name]`、`:292-293` 同时写 `store[key]` 与 `fiber.store[name]`，
//     后者以**服务名**为键）。所以"正确名字是什么"可以自己报出来，不必再等下一轮去猜。
//
// 三条纪律：**候选名逐个试**、**形态校验过了才算命中**、**失败时把试过的东西全带进 detail**。
const CODESYS_AI_MODEL_SERVICE_NAMES = ['modelDirectories', 'models', 'modelSelection', 'modelDirectory'];
const CODESYS_AI_MODEL_SERVICE_HAS_DIRECTORY = (value) => Boolean(value) && typeof value === 'object' && typeof value.directoryFor === 'function';
const CODESYS_AI_REMOTE_SERVICE_NAMES = ['remote', 'remote.session'];
const CODESYS_AI_CENSUS_RELATED = /model|llm|provider|catalog|adapter|remote|session|reasoning/i;

// 四条读法，**从最宽到最窄**：前三条是 cordis 的"不要求 inject"读法，最后一条是旧写法
// （只有该服务真的进了本插件 inject 才会命中）。每条都单独 try —— 命中不了也不能让调用方炸掉。
const CODESYS_AI_SERVICE_READERS = [
  ['ctx.get', (ctx, name) => (ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined)],
  ['ctx.reflect.get', (ctx, name) => (ctx && ctx.reflect && typeof ctx.reflect.get === 'function' ? ctx.reflect.get(name, false) : undefined)],
  ['ctx.root.get', (ctx, name) => (ctx && ctx.root && typeof ctx.root.get === 'function' ? ctx.root.get(name) : undefined)],
  ['ctx[name]', (ctx, name) => (ctx ? ctx[name] : undefined)],
];

// 按候选名逐个试，命中第一个**形态也对**的。返回值里带上"试过哪些名字 + 每条读法的结果" ——
// 这就是失败自诊断的原料（detail 会把它整段回传，下一条日志直接给出真名）。永不抛。
function codesysAiChatFindService(ctx, names, shape) {
  const tried = [];
  for (const name of names) {
    for (const entry of CODESYS_AI_SERVICE_READERS) {
      const label = entry[0];
      const read = entry[1];
      let value = undefined;
      let result = '';
      try { value = read(ctx, name); }
      catch (error) { result = 'throw(' + String((error && error.message) || error) + ')'; }
      if (result === '') {
        if (value === undefined) result = 'undefined';
        else if (value === null) result = 'null';
        else result = typeof value;
      }
      tried.push(name + '@' + label + '=' + result);
      if (value && (!shape || shape(value))) return { value, name, via: label, tried };
    }
  }
  return { value: null, name: '', via: '', tried };
}

// 这个上下文里**实际能看到**的服务名/属性名。cordis 允许枚举（见上面第二段末两条），两条来源都取；
// 取不到就返回空数组，绝不抛。
function codesysAiChatVisibleServices(ctx) {
  const names = [];
  const push = (value) => {
    if (!value || typeof value !== 'object') return;
    try { for (const key of Object.keys(value)) names.push(String(key)); } catch { /* 枚举不了就跳过 */ }
  };
  try { if (ctx && ctx.reflect) push(ctx.reflect.props); } catch { /* 忽略 */ }
  try {
    let fiber = ctx ? ctx.fiber : null;
    for (let depth = 0; fiber && depth < 16; depth += 1) {
      push(fiber.store);
      const parent = fiber.parent ? fiber.parent.fiber : null;
      if (!parent || parent === fiber) break;
      fiber = parent;
    }
  } catch { /* 忽略 */ }
  return Array.from(new Set(names)).sort();
}

// 失败时的自诊断正文：① 上一次尝试的可读原因（如果有）；② **试过的名字与每条读法的结果**；
// ③ 这个上下文里真实可见的 model 相关服务名；④ 可见服务总数与前若干个名字
// （万一 ③ 因为命名不同而空手，④ 里仍然能看到真名）。
function codesysAiChatModelServiceDetail(ctx, attempts, reason) {
  const visible = codesysAiChatVisibleServices(ctx);
  const related = visible.filter((name) => CODESYS_AI_CENSUS_RELATED.test(name));
  const shown = visible.length > 60 ? visible.slice(0, 60).join(', ') + '，…(共 ' + String(visible.length) + ' 个)' : visible.join(', ');
  const parts = [];
  if (reason) parts.push('上一次尝试的原因：' + reason);
  parts.push('试过的服务名与读法：' + (attempts.length ? attempts.join(' | ') : '(无)'));
  parts.push('可见的 model 相关服务：' + (related.length ? related.join(', ') : '(一个都没有)'));
  parts.push('可见服务共 ' + String(visible.length) + ' 个' + (visible.length ? '：' + shown : ''));
  return '读不到模型服务。' + parts.join('；');
}

const CODESYS_AI_MODEL_SELECTION_KEY = 'modelSelection';

// id → 显示名。只为 `snapshot()` 能**同步**带上一个好读的模型名（快照是 1.5 秒轮询，不能联网）。
const CODESYS_AI_MODEL_LABELS = new Map();

function codesysAiChatModelSelectionId(selection) {
  if (!selection || !selection.provider || !selection.model) return '';
  return `${String(selection.provider)}/${String(selection.model)}`;
}

function codesysAiChatNormalizeSelection(selection) {
  if (!selection || !selection.provider || !selection.model) return null;
  return {
    provider: String(selection.provider),
    model: String(selection.model),
    ...(selection.reasoningEffort ? { reasoningEffort: String(selection.reasoningEffort) } : {}),
  };
}

// 会话级的"当前模型"：**同步**读会话的 `modelSelection` 投影。主页一改模型，投影就变，
// 所以 1.5 秒的快照轮询天然会把它带出去（不需要额外订阅）。
// `conversation` 可传入（调用方已经从 `codesysAiChatMainSession()` 拿到），省一次 binding 解析。
function codesysAiChatProjectedModel(ctx, sessionId, conversation) {
  let target = conversation || null;
  if (!target) {
    const resolved = codesysAiChatBinding(ctx, sessionId);
    if (resolved.reason) return null;
    target = resolved.conversation;
  }
  try {
    const projection = target.projections && target.projections.faceOf
      ? target.projections.faceOf(CODESYS_AI_MODEL_SELECTION_KEY)
      : null;
    const view = projection && projection.getSnapshot ? projection.getSnapshot() : null;
    // `view.next` = `pending ?? lastUsed`（就是"这条会话下一次请求会用哪个模型"）。
    return codesysAiChatNormalizeSelection(view && view.next);
  } catch { return null; }
}

// 与主页 composer 同一个服务。T178：**先按候选名找、再做形态校验**，并把失败原因留在返回值里 ——
// 老实现失败时静默返回 null，于是"服务没找到"和"directoryFor 抛了"在日志里长得一模一样。
function codesysAiChatModelDirectory(ctx, sessionId) {
  const found = codesysAiChatFindService(ctx, CODESYS_AI_MODEL_SERVICE_NAMES, CODESYS_AI_MODEL_SERVICE_HAS_DIRECTORY);
  if (!found.value) return { directory: null, tried: found.tried, source: '', error: '' };
  try {
    const directory = found.value.directoryFor(sessionId);
    if (!directory) return { directory: null, tried: found.tried, source: found.name, error: found.name + '.directoryFor(' + String(sessionId) + ') 返回了空值' };
    return { directory, tried: found.tried, source: found.name, error: '' };
  } catch (error) {
    return { directory: null, tried: found.tried, source: found.name, error: found.name + '.directoryFor(' + String(sessionId) + ') 抛出：' + String((error && error.message) || error) };
  }
}

// 远端会话面（`ctx.remote.session`）。读法同上：候选名 + 形态校验。`remote.session` 在 DSH 里是
// **独立的服务名**（model-selection 的 static inject 就写了它），所以两条都试。字段读取也各自 try ——
// cordis 的 accessor 是可能抛的。
function codesysAiChatRemoteSession(ctx) {
  const found = codesysAiChatFindService(ctx, CODESYS_AI_REMOTE_SERVICE_NAMES, (value) => Boolean(value) && typeof value === 'object');
  if (!found.value) return { value: null, tried: found.tried };
  let inner = null;
  try { inner = found.value.session || null; } catch { inner = null; }
  if (inner && typeof inner === 'object') return { value: inner, tried: found.tried };
  return { value: found.value, tried: found.tried };
}

// 远端信封 `{ ok, value } | { ok:false, error }` → 统一的失败原因。
function codesysAiChatRemoteFailure(response, fallbackReason) {
  const error = response && response.error ? response.error : null;
  const detail = [error && error.code, error && error.message].filter(Boolean).join(': ');
  return { reason: fallbackReason, detail: detail || '远端拒绝了这次调用' };
}

// ── T186：推理等级（`reasoningEffort`）的**能力面** ─────────────────────────────────────────
//
// 等级**只能**来自模型描述符自己声明的 `reasoning`，本文件与外壳都**不自造枚举**。
//
// 真包证据（逐个字段读过，不是猜的）：
//   * 模型描述符就长在目录的 `groups[].models[]` 里，`reasoning` 是其中一个可选字段：
//     `@deepseek-ai/dsh-llm-deepseek/lib/index.js:503-524` 的 `modelInfo()` 返回
//     `{ …, reasoning: { efforts: [{ id, name, description }…], defaultEffort } }`
//     （`defaults.thinking === 'disabled'` 时 `efforts` 只有 `off` 一档，`:517-523`）；
//     等级 id 的取值域同文件 `:452-456`：`off` / `low` / `high` / `max`
//     （`REASONING_EFFORTS` 的 `name` 就是 "Off"/"Low"/"High"/"Max"，`:456-477`）。
//   * 客户端把这**同一个** `reasoning` 存进 `reasoning` Map：
//     `@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:121` 原文
//     `for (const group of response.value.groups) for (const model of group.models) this.reasoning.set(JSON.stringify([group.id, model.id]), model.reasoning)`。
//   * 原生 UI **是否画推理等级**的判据就是"`reasoning` 存不存在"：同文件 `:782`
//     `reasoning !== void 0 && (… effort cell …)`（`reasoning` 取自 `:521`
//     `currentChoice?.model.reasoning`）。所以本文件用**同一个**判据：`reasoning` 不是对象就没有等级，
//     外壳那边就直接**不显示**这个控件（不是画一个禁用的空壳 —— "别给不可选项"）。
//   * 当前生效档位：`:522` `state.current?.reasoningEffort ?? reasoning?.defaultEffort`；
//     档位清单：`:524-532`（`defaultEffort` 未定义时**多一条** "Default" = 不发这个字段）。
//   * **host 侧就是按这份清单拒收的**（所以本文件那两道校验与 host 同口径）：
//     `@deepseek-ai/dsh-llm/lib/index.js:2168-2188` 的 `resolveCallWithInfo()` ——
//     `reasoning === undefined && requested !== undefined` → 抛 `UNSUPPORTED_REASONING_EFFORT`（`:2177-2178`）；
//     否则 `effective = requested ?? reasoning.defaultEffort`（`:2180`）且
//     `!reasoning.efforts.some((effort) => effort.id === effective)` → 同样抛（`:2182`）。
//   * 它最后怎么上线（**以本机真包为准**）：`@deepseek-ai/dsh-llm-deepseek/lib/index.js:1694-1708`
//     把这一档折成 `thinking: { type: effort === 'off' ? 'disabled' : 'enabled' }` 与
//     `output_config: { effort }`（`off` 时整段 `output_config` 都不发）。
//     ⚠️ 本轮**没有**在本机真包里找到 `reasoning_effort` 这个 snake_case 字面量
//     （`Select-String -Pattern reasoning_effort` 只命中 `REASONING_EFFORT` 常量名）——
//     所以这里按实际读到的 `output_config.effort` 记录，不照抄未复现的写法。
//
// 返回 `null` = 这个模型不支持推理等级（外壳据此隐藏控件）；否则
// `{ defaultEffort, efforts: [{ id, name }] }` —— `name` 是 provider 自己给的可读名（"Off"/"Low"…）。
function codesysAiChatReasoningCapability(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const efforts = [];
  for (const level of Array.isArray(raw.efforts) ? raw.efforts : []) {
    if (!level || typeof level !== 'object') continue;
    const id = String(level.id === undefined || level.id === null ? '' : level.id);
    if (!id) continue;
    efforts.push({ id, name: String(level.name || id) });
  }
  const defaultEffort = raw.defaultEffort === undefined || raw.defaultEffort === null ? '' : String(raw.defaultEffort);
  return { defaultEffort, efforts };
}

// 把 `{ id, effort? }` 与老的"裸 id 串"归一成同一个请求形状。`effort` 空串 = "不动等级"
// （切换模型时**不**替用户猜一档：DSH 原生 UI 的模型那一格也是只发 provider/model，
// `client.js:850-855` 的 `choose()` → `:246-251`，`reasoningEffort` 整个字段都不发）。
function codesysAiChatModelRequest(input) {
  const value = input && typeof input === 'object' ? input : { id: input };
  return {
    id: String(value.id === undefined || value.id === null ? '' : value.id).trim(),
    effort: String(value.effort === undefined || value.effort === null ? '' : value.effort).trim(),
  };
}

// 读目录 + 当前模型。返回：
//   * `ok:false` 只在**真的读不到目录**时出现（reason 是下面那几个名字之一，detail 一定是可读的原因）；
//   * `ok:true` 时：`current` / `available`（可路由，`id` 用 `provider/model` 复合键）/
//     `blocked`（provider 级不可用，外壳按它画**禁用**条目）/ `hasSession`。
// T176 的两条改变（都是用户报的"模型目录不可用"的直接成因）：
//   ① 会话与目录**解耦**：`remote.session.modelCatalog()` 是 host 侧
//      `buildModelCatalog(ctx, defaultSelection)`，注释原文就是 "Build the browser model catalog
//      **without requiring a Session**"。所以即使主视图没在看会话，也照样能列出模型目录 ——
//      以前一没会话就把整个目录判成"不可用"，是过度耦合。
//   ② provider 级不可用**显式回传**（`failures` → `blocked`）：`buildModelCatalog` 把每个 provider
//      的 `listProviders/listModels` 失败收集成 `failures:[{id,name,message}]`，只有成功且有模型的
//      provider 才进 `groups`。不可用的 provider 必须"标注 + 禁止选中"，而不是等用户点了才失败。
// T186：每个模型自己的**推理等级能力**（`reasoning`）也跟着目录一起回传（只在支持时才有这个字段）。
async function codesysAiChatModels(ctx) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  }
  const { sessions, store } = codesysAiChatSessions(ctx);
  if (!sessions || !store) {
    codesysAiChatNote('models.no-sessions', '');
    return { ok: false, reason: 'no-sessions', detail: '这个文档里没有 sessions 服务（只有 DSH 文档才有主页会话）' };
  }
  // 会话**不是**读目录的前提（见上面 ①）：拿不到就带着可读原因继续读目录。
  const main = codesysAiChatMainSession(ctx);
  const sessionId = main.sessionId || '';
  const sessionDetail = main.reason ? String(main.detail || '') : '';

  let groups = [];
  let failures = [];
  let current = null;
  let routable = null;
  let routableProviders = [];
  let source = '';
  let catalogError = '';

  // T178：目录读取改成"候选名 + 形态校验"，并把失败原因（服务没找到 / directoryFor 抛了）留在
  // 返回值里；远端会话面也在**这里**先取一次，这样"两个都没读到"时 detail 能同时带上两边的尝试记录。
  const directoryRead = sessionId
    ? codesysAiChatModelDirectory(ctx, sessionId)
    : { directory: null, tried: [], error: '' };
  const directory = directoryRead.directory;
  if (directory) {
    try {
      const state = (await directory.load()) || {};
      groups = Array.isArray(state.groups) ? state.groups : [];
      failures = Array.isArray(state.failures) ? state.failures : [];
      current = codesysAiChatNormalizeSelection(state.current);
      routable = state.routable === undefined ? null : state.routable === true;
      // `ModelDirectory.syncInputs()` 在 catalog 载入失败时会把 `error`（"code: message"）放在快照上。
      if (state.error) catalogError = String(state.error);
      source = directoryRead.source || CODESYS_AI_MODEL_SERVICE_NAMES[0];
    } catch (error) {
      catalogError = String((error && error.message) || error);
      codesysAiChatNote('models.directory-failed', catalogError);
    }
  } else if (directoryRead.error) {
    catalogError = directoryRead.error;
    codesysAiChatNote('models.directory-unavailable', catalogError);
  }
  const remoteRead = codesysAiChatRemoteSession(ctx);
  const sessionRemote = remoteRead.value;

  if (!groups.length) {
    if (!sessionRemote || typeof sessionRemote.modelCatalog !== 'function') {
      const detail = codesysAiChatModelServiceDetail(ctx, remoteRead.tried.concat(directoryRead.tried), catalogError);
      codesysAiChatNote('models.no-service', detail);
      return { ok: false, reason: 'no-model-service', detail, sessionId };
    }
    try {
      const response = await sessionRemote.modelCatalog();
      if (response && response.ok === false) {
        const failure = codesysAiChatRemoteFailure(response, 'model-catalog-failed');
        codesysAiChatNote('models.catalog-rejected', failure.detail);
        return { ok: false, reason: failure.reason, detail: failure.detail, sessionId };
      }
      const value = (response && response.value) || null;
      groups = Array.isArray(value && value.groups) ? value.groups : [];
      failures = Array.isArray(value && value.failures) ? value.failures : [];
      routableProviders = Array.isArray(value && value.routableProviders) ? value.routableProviders.map((item) => String(item)) : [];
      if (!current) current = codesysAiChatNormalizeSelection(value && value.default);
      source = 'remote.session.modelCatalog';
      catalogError = '';
    } catch (error) {
      const detail = String((error && error.message) || error);
      codesysAiChatNote('models.catalog-threw', detail);
      return { ok: false, reason: 'model-catalog-threw', detail, sessionId };
    }
  }

  // 投影是"这条会话"的权威值；目录里的 default 只是全局默认。投影读得到就用它。
  if (sessionId) {
    const projected = codesysAiChatProjectedModel(ctx, sessionId, main.conversation);
    if (projected) current = projected;
  }

  const available = [];
  for (const group of groups) {
    if (!group) continue;
    const providerId = String(group.id || '');
    if (!providerId) continue;
    const providerName = String(group.name || providerId);
    const models = Array.isArray(group.models) ? group.models : [];
    for (const model of models) {
      if (!model) continue;
      const modelId = String(model.id || '');
      if (!modelId) continue;
      const name = String(model.name || modelId);
      const id = `${providerId}/${modelId}`;
      const label = `${providerName} · ${name}`;
      CODESYS_AI_MODEL_LABELS.set(id, label);
      // 推理等级能力跟着目录一起回传（**只在支持时**才有这个字段）：外壳据此决定画不画那个控件，
      // 并且等级清单直接用 provider 自己给的名字，不自造枚举（见上面 codesysAiChatReasoningCapability）。
      const reasoning = codesysAiChatReasoningCapability(model.reasoning);
      available.push({ id, label, provider: providerId, model: modelId, name, providerName, description: String(model.description || ''), routable: true, ...(reasoning ? { reasoning } : {}) });
    }
  }

  // provider 级不可用：`failures` 里的 provider 一定不在 `groups` 里（host 侧互斥），所以只要原样
  // 标出来就够，不需要再和 `routableProviders` 求差集。名字/原因都保留，外壳直接显示。
  const routableSet = new Set(available.map((item) => item.provider));
  const blocked = failures
    .map((item) => ({
      id: String((item && item.id) || ''),
      name: String((item && (item.name || item.id)) || ''),
      message: String((item && item.message) || '提供方当前不可用'),
    }))
    .filter((item) => item.id && !routableSet.has(item.id));

  const currentId = codesysAiChatModelSelectionId(current);
  const currentRow = available.find((item) => item.id === currentId) || null;
  const currentBlocked = current ? blocked.find((item) => item.id === current.provider) : null;
  const summary = currentId
    ? (currentRow
      ? { ...currentRow, ...(current?.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}), routable: routable === null ? true : routable }
      : {
        id: currentId,
        label: CODESYS_AI_MODEL_LABELS.get(currentId) || `${currentId}（不在可用目录里）`,
        provider: current.provider,
        model: current.model,
        name: current.model,
        ...(current?.reasoningEffort ? { reasoningEffort: current.reasoningEffort } : {}),
        // 不在目录里 ⇒ 我们**没有**这个模型的等级能力（`reasoning` 只随目录来）。这里刻意不编造：
        // 外壳拿不到 `reasoning` 就不画那个控件（画不出"可验证的档位"）。
        routable: false,
        unavailable: true,
        unavailableReason: currentBlocked ? currentBlocked.message : '这条会话当前选中的模型不在可用目录里',
      })
    : null;
  if (summary && !CODESYS_AI_MODEL_LABELS.has(currentId)) CODESYS_AI_MODEL_LABELS.set(currentId, summary.label);

  codesysAiChatNote('models.ok', `session=${sessionId || '(none)'} source=${source} available=${available.length} blocked=${blocked.length} current=${currentId || '(none)'}`);
  return {
    ok: true,
    sessionId,
    hasSession: Boolean(sessionId),
    sessionDetail,
    source,
    current: summary,
    available,
    blocked,
    routableProviders,
    catalogError,
    failures: failures.map((item) => ({ id: String((item && item.id) || ''), name: String((item && item.name) || ''), message: String((item && item.message) || '') })),
  };
}

// 改**这条会话**用的模型 / 推理等级。`input` 是 `{ id, effort? }`（`id` = `models()` 里的复合键
// `provider/model`），也接受老的裸 id 串（`effort` 就当成"不动等级"）。
// T176：`provider/model` **分开传**（`directory.select({ provider, model })` /
// `remote.session.selectModel({ sessionId, provider, model })`）—— DSH 的 schema 就是三个独立字段，
// 拼接串只在**我们自己**的 UI 里当复合键用，绝不发给 DSH。这里在发请求前就把"不可路由的 provider"
// 挡掉（`blocked`），否则用户只会收到一句 `model-unavailable`。
// 推理等级走**同一条会话级**写入：两处 select 都带上 `reasoningEffort`（参数名与真包
// `client.js:246-251` 一字不差），所以它落在"这条会话的下一次请求"上，与主页 composer 的
// 推理等级是同一份数据。**没有**任何写入 / 编译 / 确认会被这一步触发。
async function codesysAiChatSetModel(ctx, input) {
  const request = codesysAiChatModelRequest(input);
  const wanted = request.id;
  const effort = request.effort;
  if (!wanted) return { ok: false, reason: 'empty-model', detail: '没有指定要切换到哪个模型' };
  const catalog = await codesysAiChatModels(ctx);
  if (catalog.ok !== true) return { ok: false, reason: catalog.reason, detail: catalog.detail, sessionId: catalog.sessionId || '' };
  // "改这条会话的模型"必须**有**这条会话：目录可以读，但选择要有落点。
  if (catalog.hasSession !== true) {
    const detail = catalog.sessionDetail || '主页没有正在查看的会话：先在主页点开或新建一条会话，再切换模型';
    codesysAiChatNote('model.no-session', detail);
    return { ok: false, reason: 'no-session', detail, sessionId: '' };
  }
  const blocked = (catalog.blocked || []).find((item) => item.id && (wanted === item.id || wanted.startsWith(`${item.id}/`)));
  if (blocked) {
    const detail = `提供方 ${blocked.name || blocked.id} 当前不可路由：${blocked.message}`;
    codesysAiChatNote('model.provider-unavailable', detail);
    return { ok: false, reason: 'provider-unavailable', detail, sessionId: catalog.sessionId, model: wanted };
  }
  const target = (catalog.available || []).find((item) => item.id === wanted);
  if (!target) {
    const detail = `模型 ${wanted} 不在可用目录里（当前可用 ${(catalog.available || []).length} 个）`;
    codesysAiChatNote('model.unknown', detail);
    return { ok: false, reason: 'unknown-model', detail, sessionId: catalog.sessionId, model: wanted };
  }

  // 等级必须是**这个模型自己声明过的**那一档。两道防御（外壳已经不会画不可选项，但下拉是可被
  // 脚本改的）：① 模型没有 `reasoning` 就不接受任何等级；② 等级不在 `efforts` 里也不发。
  // 两处都给一句话可读原因 —— 绝不静默地"按别的档位"发出去。
  const reasoning = target.reasoning || null;
  if (effort && !reasoning) {
    const detail = `模型 ${target.name || target.model} 不支持推理等级，不能把等级设成 ${effort}`;
    codesysAiChatNote('model.effort-unsupported', detail);
    return { ok: false, reason: 'effort-unsupported', detail, sessionId: catalog.sessionId, model: wanted, effort };
  }
  if (effort && !(reasoning.efforts || []).some((level) => level.id === effort)) {
    const detail = `推理等级 ${effort} 不在 ${target.name || target.model} 声明的档位里（可用：${(reasoning.efforts || []).map((level) => level.id).join(', ') || '无'}）`;
    codesysAiChatNote('model.effort-unknown', detail);
    return { ok: false, reason: 'unknown-effort', detail, sessionId: catalog.sessionId, model: wanted, effort };
  }

  const directoryRead = codesysAiChatModelDirectory(ctx, catalog.sessionId);
  const directory = directoryRead.directory;
  const remoteRead = codesysAiChatRemoteSession(ctx);
  const sessionRemote = remoteRead.value;
  let outcome = null;
  if (directory && typeof directory.select === 'function') {
    try { outcome = await directory.select({ provider: target.provider, model: target.model, ...(effort ? { reasoningEffort: effort } : {}) }); }
    catch (error) { outcome = { ok: false, error: { code: 'model-select-threw', message: String((error && error.message) || error) } }; }
  } else if (sessionRemote && typeof sessionRemote.selectModel === 'function') {
    try { outcome = await sessionRemote.selectModel({ sessionId: catalog.sessionId, provider: target.provider, model: target.model, ...(effort ? { reasoningEffort: effort } : {}) }); }
    catch (error) { outcome = { ok: false, error: { code: 'model-select-threw', message: String((error && error.message) || error) } }; }
  } else {
    const detail = codesysAiChatModelServiceDetail(ctx, remoteRead.tried.concat(directoryRead.tried), directoryRead.error);
    codesysAiChatNote('model.no-service', detail);
    return { ok: false, reason: 'no-model-service', detail, sessionId: catalog.sessionId };
  }

  if (!outcome || outcome.ok !== true) {
    const failure = codesysAiChatRemoteFailure(outcome, 'model-unavailable');
    codesysAiChatNote('model.failed', `${wanted}${effort ? `@${effort}` : ''} → ${failure.detail}`);
    return { ok: false, reason: failure.reason, detail: failure.detail, sessionId: catalog.sessionId, model: wanted };
  }
  const selected = codesysAiChatNormalizeSelection(outcome.value && outcome.value.selected) || { provider: target.provider, model: target.model };
  // 会话级投影是"下一次请求真的会用哪个"的权威值。刚写完可能还没回流，所以 `verified` 是
  // `true`（已回流且一致）/ `false`（回流了但不是我们要的那个）/ `null`（还没回流，稍后轮询会带出来）。
  const main = codesysAiChatMainSession(ctx);
  const projected = main.sessionId === catalog.sessionId ? codesysAiChatProjectedModel(ctx, catalog.sessionId, main.conversation) : null;
  const projectedId = codesysAiChatModelSelectionId(projected);
  const projectedEffort = projected && projected.reasoningEffort ? String(projected.reasoningEffort) : '';
  // 没要求改等级（`effort === ''`）时判据与改动前**一字不差**（只看模型 id）；要求改等级时，只有
  // 投影里的等级也一致才算 verified —— "已生效"绝不谎报。
  const verified = projectedId ? (projectedId === wanted && (!effort || projectedEffort === effort)) : null;
  // 投影还没回流时，用我们**刚写下去**的那个等级兜底，座位立刻显示用户选的那一档（不回退成旧值）。
  const effectiveEffort = selected.reasoningEffort ? String(selected.reasoningEffort) : effort;
  codesysAiChatNote('model.ok', `session=${catalog.sessionId} model=${wanted}${effort ? ` effort=${effort}` : ''} verified=${verified === null ? 'pending' : verified}`);
  return {
    ok: true,
    sessionId: catalog.sessionId,
    model: wanted,
    effort: effort || effectiveEffort || '',
    label: target.label,
    selected,
    verified,
    // 立即把显示名记下来：紧接着的一次 `snapshot()` 就能同步显示新模型，不必等目录重拉。
    // `target` 里带着 `reasoning`（等级能力），所以外壳切完立刻就能画对等级座位。
    current: { ...target, ...(effectiveEffort ? { reasoningEffort: effectiveEffort } : {}) },
  };
}

// 快照里带上的模型摘要：**纯同步**（投影 + 已缓存的显示名），所以能安全地每 1.5 秒调用一次。
function codesysAiChatModelSummary(ctx, sessionId, conversation) {
  const selection = codesysAiChatProjectedModel(ctx, sessionId, conversation);
  const id = codesysAiChatModelSelectionId(selection);
  if (!id) return null;
  return {
    id,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    label: CODESYS_AI_MODEL_LABELS.get(id) || id,
  };
}

// ── T181：**消息到底在哪**（用户报的"抽屉里没有输出"的真因） ────────────────────────────────
//
// 老代码读 `sessions.binding(id).session.getSnapshot().nodes`，再用 `codesysText(node.blocks)` 抽文本。
// 在 DSH 0.2 里这条路径**不存在**：
//   * `@deepseek-ai/dsh-api-session-controller/lib/client.js:3477-3489` 的 `binding(id)` 返回
//     `{ sessionId, session, eventSource, ctx }`，`session` 就是 Session 实例本身；
//   * 它的会话快照是 `buildSnapshot()`（同文件 `:2273-2297`），字段只有 sessionId /
//     pendingSubmissions / running / subagent / removed / openState / openError / hasMore /
//     loadingOlder / promptError / blank / lastAgentError / promptAttempted / awaitingFirstTurn
//     —— **没有 nodes**。
//   于是 `snapshot.nodes` 恒为 undefined → messages 恒为 [] → 桥返回 `{ ok:true, total:0,
//   messages:[] }`：**成功、但空**。主进程只在 `ok !== true` 时才写 trajectory，所以审计流里
//   "重启之后一行错误都没有"，而抽屉里一条消息都没有 —— 两个现象同源。
//
// 真实的消息视图由客户端 UI 会话组装，服务名 `uiConversation`
// （`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:3028` 的 `super(ctx, "uiConversation")`），
// `@deepseek-ai/dsh-client-ui-chat` 为它注册了 target 名 `chat` 的视图：
//   * `dsh-client-ui-chat/lib/client.js:8878-8887` 的 ChatSnapshotBuilder.snapshot() 返回
//     `{ order, nodes, locations, navigation, timeline, legacy }`：order 是**已排序的可见节点 key**
//     （`:8810` 的 orderedVisibleChatNodes(...)），`nodes.get(key)` 取节点。
//   * `:7262-7273` 的 chatNode() 节点形如
//     `{ key, kind, id, target, anchorSeq, location, visibility, data }`。
//   * 用户消息：`:9346` 的 `{ kind: "user", seq, time, content, source }` —— content 是 **wire** 块，
//     文本块是 `{ type: "text", text }`；`:9339` 的 `kind: "steering"` 同形。
//   * 助手消息：`:7733` 的 `chatNode(context, "assistant-step", …, data, …)`，data 形如
//     `{ status, turn, step, blocks, time, usage?, finalNode? }`，块是 **Chat** 形
//     （`:7381-7390` 的 `{ kind: "text", text }`）。
//   * 正规入口：`:12319-12351` 把 `target("chat")` 用 `ctx.uiSession.provide({ hooks: ["chat"],
//     resolve })` 挂到 uiSession 绑定上；`dsh-client-ui-session/lib/client.js:378-397` 的
//     `materialize()` 把每个描述符声明的 hook 合进同一个 `hooks` 对象。所以
//     `uiSession.current.getSnapshot().hooks.chat` 就是那个 `{ getSnapshot, subscribe }` 快照源 ——
//     与主页会话读的**同一个** target（原生 UI 也在这里读，见 `:12450-12456`）。
//
// 三条路都认，顺序固定：① hooks.chat（DSH 0.2 真形状）→ ② uiConversation 服务的
// `binding(id).target('chat')`（同一个 target 的另一条取法，hooks.chat 缺失时）→ ③ 老形状
// `conversation.getSnapshot().nodes`（**向前兼容**，块名 kind / type 两种都认）。
// 会话判定**一条都没回退**：见上面 T176 段（retainedBy.mainView 仍是主判据，
// `sessions.list…current` 只是最后兜底）。
const CODESYS_AI_TEXT_BLOCK_KIND = 'text';

// 一个内容块是不是文本块。DSH 里两种写法都真实存在 —— wire 形的 `{ type: 'text' }`（用户消息的
// content）与 Chat 形的 `{ kind: 'text' }`（助手消息的 blocks）。两种都认；reasoning / tool-call /
// image 一律不进抽屉（与改动前"只取文本"的行为一个字不差）。
function codesysAiChatBlockText(block) {
  if (!block || typeof block !== 'object') return '';
  const kind = block.kind === undefined || block.kind === null ? block.type : block.kind;
  if (kind !== CODESYS_AI_TEXT_BLOCK_KIND) return '';
  return typeof block.text === 'string' ? block.text : '';
}

// 块数组 → 一段文本。多个文本块之间补一个换行，首尾 trim（等价于 shard 10 的 codesysText，
// 但**同时**认 kind 与 type 两种块名）。
function codesysAiChatBlocksText(blocks) {
  if (!Array.isArray(blocks)) return '';
  let text = '';
  for (const block of blocks) {
    const piece = codesysAiChatBlockText(block);
    if (!piece) continue;
    text += (text ? '\n' : '') + piece;
  }
  return text.trim();
}

// 一个会话节点 → 一条抽屉消息；返回 null = 这个节点不是用户/助手消息（工具调用、通知、分组行等）。
// 角色名取自 DSH 0.2 的真实 kind：用户 user（`dsh-client-ui-chat:9346`）与 steering（`:9339`），
// 助手 assistant-step（`:7733`）；assistant 是同一族的旧名字，一起认。
// 正文：助手在 data.blocks、用户在 data.content；老形状两者都放在节点自己的 blocks 上。
// 节点没有包 data（老形状）时直接在节点上找字段，所以新旧两种形状都能读。
function codesysAiChatMessageOfNode(node) {
  if (!node || typeof node !== 'object') return null;
  const kind = String(node.kind || '');
  const role = kind === 'user' || kind === 'steering'
    ? 'user'
    : (kind === 'assistant' || kind === 'assistant-step' ? 'assistant' : '');
  if (!role) return null;
  const data = node.data && typeof node.data === 'object' ? node.data : node;
  let text = codesysAiChatBlocksText(data.blocks);
  if (!text) text = codesysAiChatBlocksText(data.content);
  if (!text && typeof data.text === 'string') text = data.text.trim();
  if (!text) return null;
  const raw = data.seq === undefined || data.seq === null ? node.seq : data.seq;
  const seq = Number(raw === undefined || raw === null ? node.anchorSeq : raw);
  return { role, seq: Number.isFinite(seq) ? seq : 0, text };
}

// ② 用到的物化动作：`target()` 的 subscribe 会顺带 `activate(target)`
// （`dsh-client-ui-conversation/lib/client.js:2944-2949`），而**没被激活过**的视图快照是
// undefined（同文件 `:2102-2106` 的 `snapshot()` 读 `views.get(target)?.snapshot`）。所以这里
// 订阅一次再立刻退订，只为让视图物化；拿走监听器，不留引用。
function codesysAiChatMaterializeChatSource(source) {
  if (!source || typeof source.subscribe !== 'function') return;
  let off = null;
  try { off = source.subscribe(() => {}); } catch { off = null; }
  if (typeof off === 'function') { try { off(); } catch { /* 退订失败不影响读取 */ } }
}

// ① hooks.chat（真形状）→ ② uiConversation.binding(id).target('chat')（同一 target 的另一条取法）。
// 两条都是"不要求 inject"的读法（见上面 T178 段：modelDirectories/remote 已经证明这条路走得通），
// 失败一律吞掉并落到下一条，绝不抛。
function codesysAiChatChatSource(ctx, sessionId) {
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const binding = uiSession && uiSession.current && uiSession.current.getSnapshot ? uiSession.current.getSnapshot() : null;
    const chat = binding && binding.hooks ? binding.hooks.chat : null;
    if (chat && typeof chat.getSnapshot === 'function') return chat;
  } catch { /* 落到 ② */ }
  const uiConversation = codesysAiChatOptionalService(ctx, 'uiConversation');
  try {
    const conversation = uiConversation && typeof uiConversation.binding === 'function' ? uiConversation.binding(sessionId) : null;
    const target = conversation && typeof conversation.target === 'function' ? conversation.target('chat') : null;
    if (target && typeof target.getSnapshot === 'function') return target;
  } catch { /* 落到 ③ */ }
  return null;
}

// 读一次 chat 视图快照。**视图没被主界面激活过时快照是 undefined**（见上面 T181 段），这时才做一次
// "订阅→退订"把它物化，然后重读。已经物化过的轮询不会去碰监听器（每 1.5 秒加一次是无谓的开销）。
function codesysAiChatChatView(source) {
  const read = () => {
    try { return source && source.getSnapshot ? source.getSnapshot() : null; } catch { return null; }
  };
  let view = read();
  if (!view || !view.nodes) {
    codesysAiChatMaterializeChatSource(source);
    view = read();
  }
  return view && view.nodes ? view : null;
}

// ①/② 的快照 → 消息。只走 order 里列出的节点（order 已经是"可见且有序"的那一份，hidden 的
// 节点留在 store 里但不在 order 中，所以不会画出已经撤回的内容）。
function codesysAiChatMessagesFromChatView(view) {
  const messages = [];
  if (!view || typeof view !== 'object') return messages;
  const store = view.nodes;
  if (!store || typeof store !== 'object') return messages;
  const read = typeof store.get === 'function'
    ? (key) => store.get(key)
    : (typeof store.source === 'function' ? (key) => store.source(key) : null);
  if (!read) return messages;
  const order = Array.isArray(view.order) ? view.order : [];
  for (const key of order) {
    let node = null;
    try { node = read(key); } catch { node = null; }
    const message = codesysAiChatMessageOfNode(node);
    if (message) messages.push(message);
  }
  return messages;
}

// ③ 老形状（向前兼容）：conversation.getSnapshot().nodes。**这条是唯一会抛的路径**，所以它把
// 失败原因原样回传，调用方照旧返回 snapshot-threw —— 原来那条失败语义一个字没变。
function codesysAiChatMessagesFromSessionSnapshot(conversation) {
  let snapshot = null;
  try { snapshot = conversation && conversation.getSnapshot ? conversation.getSnapshot() : null; }
  catch (error) { return { messages: [], error: String((error && error.message) || error) }; }
  const nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
  const messages = [];
  for (const node of nodes) {
    const message = codesysAiChatMessageOfNode(node);
    if (message) messages.push(message);
  }
  return { messages, error: '' };
}

// ── T183：**"会话正在运行 / 正在思考"从哪读**（用户原话：「现在有输出，但是没有显示在思考」） ──
//
// 主界面在模型生成期间画两样东西（逐个在 DSH 真包里查过，不是猜的）：
//   * **会话状态**：`@deepseek-ai/dsh-api-session-controller/lib/client.js` 的 `buildSnapshot()`
//     （`:2273-2297`）里有 `running`（`:2278`）与 `pendingSubmissions`（`:2277`）；`running` 由
//     host 的 `api-session/status` 事件经 `handleSessionStatus`（`:2886-2895`）→`handleRunning`
//     （`:1963-1972`）写进会话实例。主界面会话读的就是它
//     （`@deepseek-ai/dsh-client-ui-conversation/lib/client.js:15376` 的 `useSession((s) => s.running)`，
//     同包 `:17224` / `:17838` 也是同一份）。
//   * **助手节点**：`@deepseek-ai/dsh-client-ui-chat/lib/client.js` 的 assistant-step 节点
//     `data.status` 取值是 **running / settled / interrupted**（`:7653`：
//     `settled?.interrupted === true ? "interrupted" : settled === void 0 ? "running" : "settled"`），
//     它决定主界面画不画"进行中"（`:6056` `streaming: data.status === "running"`、`:8616`）；
//     块 `kind` 的枚举里**有 reasoning**（`:7387-7390` 建块、`:7528-7534` 流式累积），
//     主界面把它折成一行标题为 `message.think` = **"思考"** 的折叠行（`:5549` + `:5897`），
//     展开才看全文（`lcKema_thinkBody`，`:5793`）。没有工具在跑时的实时行标题是
//     `message.stepProcess.thinking` = **"正在分析请求"**（`:5415` + `:2257`/`:2262`）。
//
// 所以这里只回传三层**事实**（外壳照主界面口径画，不另造文案）：
//   `running`（会话正在运行）· `pending`（本地待受理条数）· `awaitingFirstTurn`
//   · `reasoning`（**正在跑的**那个 assistant-step 里 reasoning 块的全文，没有就是空串）。
// 全是同步只读，所以 1.5 秒 / 运行态 600ms 的轮询都安全。
const CODESYS_AI_REASONING_BLOCK_KIND = 'reasoning';
const CODESYS_AI_ASSISTANT_STEP_KINDS = ['assistant-step', 'assistant'];
const CODESYS_AI_ASSISTANT_RUNNING_STATUS = 'running';

// 三条来源，顺序固定（都失败就按"没在跑"）：
//   ① 会话自己的 `getSnapshot().running` —— 与主界面会话**同一个事实**（首选）；
//   ② 会话列表行的 `running` —— `@deepseek-ai/dsh-client-ui-session/lib/client.js:322-330` 的
//      `reconcileStatus()` 就是从它同步到 sessionStatus 的（列表快照仍然带着这个字段）；
//   ③ `uiSession.sessionStatus` 那张 Map（同包 `:342-357`）里 `{ running, pendingInteraction,
//      completionUnread }` —— 会话实例换代 / 列表还没就绪时走这里。
// `pending` 与 `awaitingFirstTurn` 只在 ① 读得到时有值（其余来源没有这两项），外壳用它们让
// "刚发出去还没进入 running"的那一刻也能立刻显示进行中。
function codesysAiChatRunningFacts(ctx, sessionId, conversation) {
  let snapshot = null;
  try { snapshot = conversation && conversation.getSnapshot ? conversation.getSnapshot() : null; } catch { snapshot = null; }
  const pending = snapshot && Array.isArray(snapshot.pendingSubmissions) ? snapshot.pendingSubmissions.length : 0;
  const awaitingFirstTurn = Boolean(snapshot && snapshot.awaitingFirstTurn === true);
  if (snapshot && typeof snapshot.running === 'boolean') {
    return { running: snapshot.running, pending, awaitingFirstTurn, via: 'session' };
  }
  const list = codesysAiChatSessionListSnapshot(ctx);
  const row = list && list.byId && typeof list.byId === 'object' ? list.byId[sessionId] : null;
  if (row && typeof row.running === 'boolean') {
    return { running: row.running, pending, awaitingFirstTurn, via: 'list' };
  }
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const source = uiSession && uiSession.sessionStatus ? uiSession.sessionStatus : null;
    const status = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null;
    const entry = status && typeof status.get === 'function' ? status.get(sessionId) : null;
    if (entry && typeof entry.running === 'boolean') {
      return { running: entry.running, pending, awaitingFirstTurn, via: 'sessionStatus' };
    }
  } catch { /* 读不到就落到下面那条"没在跑" */ }
  return { running: false, pending, awaitingFirstTurn, via: '' };
}

// 正在跑的那个 assistant-step 里 reasoning 块的**全文**（没有就空串）。与主界面 `:10610-10625`
// 的 `liveReasoningDetail()` 看的是同一处（最后一个 `status === "running"` 的 assistant-step 的
// 最后一个 reasoning 块），只是主界面取"最后一段落的第一行"当实时摘要、全文留给展开，
// 拆分点放在外壳那一侧（那里才是观感）。
// 只按 `order` 走（与消息同一条可见性判据：撤回/隐藏的节点不在 order 里）。
function codesysAiChatReasoningOfChatView(view) {
  if (!view || !view.nodes || typeof view.nodes !== 'object') return '';
  const read = typeof view.nodes.get === 'function'
    ? (key) => view.nodes.get(key)
    : (typeof view.nodes.source === 'function' ? (key) => view.nodes.source(key) : null);
  if (!read) return '';
  const order = Array.isArray(view.order) ? view.order : [];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    let node = null;
    try { node = read(order[index]); } catch { node = null; }
    if (!node || typeof node !== 'object') continue;
    if (!CODESYS_AI_ASSISTANT_STEP_KINDS.includes(String(node.kind || ''))) continue;
    const data = node.data && typeof node.data === 'object' ? node.data : node;
    if (String(data.status || '') !== CODESYS_AI_ASSISTANT_RUNNING_STATUS) continue;
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex];
      if (!block || typeof block !== 'object') continue;
      if (String(block.kind || '') !== CODESYS_AI_REASONING_BLOCK_KIND) continue;
      const text = typeof block.text === 'string' ? block.text : '';
      if (text.trim()) return text;
    }
  }
  return '';
}

// ── T185：**"待回答"是什么、它在哪、抽屉怎么才能把它显示出来并就地回答** ────────────────────
//
// 报障（用户原文）：「原会话（主页那条）有一个"待回答"，但 CODESYS 插件的 AI 对话抽屉不显示
// 这个待回答，于是一直卡住」。
//
// 一、**"待回答"在 DSH 里的真实形状**（逐个在 0.2.0-rc.1 真包里查过，不是猜的；真包在
// `resources/app/harness/runtime/slot/payload/node_modules/.pnpm/node_modules/@deepseek-ai/`，
// 运行中的 `dsh/lib/bin.js` 就是这个 payload）：
//   * **文案**：`@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1410` 的
//     `t("status.compact.answer")` = **"待回答"**（词条在 `:3967`），完整那一句是
//     `t("status.waitingAnswer")` = "等待回答"（`:3964`）。它会画在**侧栏会话行**上，条件是
//     `node.pendingInteraction === "question"`（`:1406-1411`，分类见 `:440-447` 的
//     `visiblePendingKind()`，取值 `approval` / `plan-review` / `question`）。
//   * **数据**：`@deepseek-ai/dsh-client-ui-session/lib/client.js` 的 `UiSession`
//     （`super(ctx, "uiSession")`，`:164`）暴露 `sessionStatus`（`:148-156`），
//     `publishStatus()`（`:342-357`）为**每个会话**发布
//     `{ running, pendingInteraction, completionUnread }`。
//     `pendingInteraction` 就是下面这个对象本身：
//     `@deepseek-ai/dsh-client-ui-user-questions/lib/client.js:61-154` 的 `PendingQuestion` ——
//     字段 `{ sessionId, kind, key, questions }`，方法 `answer(answer)` / `cancel()` /
//     `delegate()` / `abort()`。`kind` 是 `"question"` 或 `"plan-review"`（`:87`，由
//     `planReviewOf(questions)` 决定）。
//   * **问题条目的形状**（`@deepseek-ai/dsh-tool-ask-user/lib/index.js:18-65` 的
//     `ask_user_question` 参数体，逐字段对应）：
//     `{ id, question, header?, options?: [{ label, description? }], multiSelect? }`。
//   * **作答的值**（同一个 tool 的 `output.schema`，`:66-90`）：
//     `{ answers: [{ id, selected: [label…], custom? }] }`；`PendingQuestion.answer()` 直接把它
//     resolve 给宿主 waterfall（`:108-114`），**不需要新造任何协议**。
//
// 二、**为什么抽屉会"卡住"**（两个现象同一个根因）：
//   本文件以前的 `snapshot()` 只回 `running` / `pending`（= `pendingSubmissions` 的**本地提交回显**
//   条数，见 `@deepseek-ai/dsh-api-session-controller/lib/client.js:2277`）/ `awaitingFirstTurn` /
//   `reasoning` —— **一个字都没提 pendingInteraction**。而"待回答"期间 `running` 仍然是 `true`
//   （回合没结束，agent 正阻塞在这个工具里），于是外壳照 T183 的口径画出「正在分析请求」，却永远
//   等不到它变化，也永远看不到那条问题。用户看到的就是"一直在转、什么都不显示"。
//
// 三、**修法**：`snapshot()` 多回一份**纯数据**的 `pendingInteraction`（下面是它的规范化形状），
//   外加一个**只在用户显式点击时**才会被调用的 `answer(payload)`。两条纪律：
//   * **绝不自动作答**：`snapshot()` / 任何轮询路径**只读**，一次都不会碰 `answer`；`answer` 只在
//     外壳那条 IPC（`codesys:ai-chat-answer`）里被调用，而那条通道只由"提交回答"按钮触发。
//   * **审批不代答**：`kind === 'approval'`（权限确认）在抽屉里**只提示、不给按钮** ——
//     代用户批准权限正是最不该由插件一键完成的事，它的 `notAnswerableReason` 会原样显示。
const CODESYS_AI_PENDING_KIND_QUESTION = 'question';
const CODESYS_AI_PENDING_KIND_PLAN_REVIEW = 'plan-review';
const CODESYS_AI_PENDING_KIND_APPROVAL = 'approval';

// 主视图那条会话现在挂着的那一个待处理交互（`PendingQuestion` 实例本身），没有就是 null。
// 两条来源，顺序固定：① `uiSession.sessionStatus`（DSH 原生侧栏读的**同一个** root hook，首选）→
// ② `uiSession.pendingSnapshot`（UiSession 自己的 Map，`dsh-client-ui-session/lib/client.js:139`；
// 只是兜底，字段名万一下一轮改了还有一条路）。两条都纯粹只读，所以 1.5 秒轮询安全。
function codesysAiChatPendingWait(ctx, sessionId) {
  const uiSession = codesysAiChatOptionalService(ctx, 'uiSession');
  try {
    const source = uiSession && uiSession.sessionStatus ? uiSession.sessionStatus : null;
    const status = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : null;
    const entry = status && typeof status.get === 'function' ? status.get(sessionId) : null;
    const interaction = entry ? entry.pendingInteraction : null;
    if (interaction && typeof interaction === 'object') return interaction;
  } catch { /* 服务正在换代：落到 ② */ }
  try {
    const map = uiSession ? uiSession.pendingSnapshot : null;
    const interaction = map && typeof map.get === 'function' ? map.get(sessionId) : null;
    if (interaction && typeof interaction === 'object') return interaction;
  } catch { /* 读不到就按"没有待回答" */ }
  return null;
}

// 一个问题条目 → 纯数据。字段名与 `ask_user_question` 的 schema 逐字对应（见上面第一段），
// 一个额外的字都没有；没有 `id` 的条目丢掉（没有 `id` 就无法把答案对回去，画出来只会骗人）。
function codesysAiChatPendingQuestion(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id === undefined || item.id === null ? '' : item.id);
  if (!id) return null;
  const options = [];
  if (Array.isArray(item.options)) {
    for (const option of item.options) {
      if (!option || typeof option !== 'object') continue;
      const label = String(option.label === undefined || option.label === null ? '' : option.label);
      if (!label) continue;
      options.push({ label, description: String(option.description || '') });
    }
  }
  return {
    id,
    header: String(item.header || ''),
    question: String(item.question || ''),
    options,
    multiSelect: item.multiSelect === true,
  };
}

// `PendingQuestion` → 外壳能直接画的**纯数据**。下面每一条都是事实，没有一句是外壳自己编的文案：
//   * `kind`      question / plan-review / approval；
//   * `label` / `compactLabel` —— DSH 自己那两个词条（`status.waitingAnswer` / `status.compact.answer`
//     的同义值，见上面第一段），所以"待回答"这四个字不是我造的；
//   * `key`       `PendingQuestion.key`（`question:<n>`）。外壳把它原样回传，`answer()` 会拿它做
//                 "我答的是不是刚才那一条"的判据（避免用户答完之前问题换了、答案却落到新问题上）；
//   * `questions` 规范化后的问题列表；
//   * `answerable` 只有"真的有 `answer()` 方法 + 至少一个问题 + 不是审批"才是 true；
//   * `notAnswerableReason` 不可就地作答时**必须**给一句可读原因（绝不允许只有按钮不给理由）。
function codesysAiChatPendingInteraction(ctx, sessionId) {
  const wait = codesysAiChatPendingWait(ctx, sessionId);
  if (!wait) return null;
  const rawKind = String(wait.kind || '');
  const kind = rawKind === CODESYS_AI_PENDING_KIND_PLAN_REVIEW
    ? CODESYS_AI_PENDING_KIND_PLAN_REVIEW
    : (rawKind === CODESYS_AI_PENDING_KIND_APPROVAL ? CODESYS_AI_PENDING_KIND_APPROVAL : CODESYS_AI_PENDING_KIND_QUESTION);
  const questions = [];
  if (Array.isArray(wait.questions)) {
    for (const item of wait.questions) {
      const question = codesysAiChatPendingQuestion(item);
      if (question) questions.push(question);
    }
  }
  const hasAnswer = typeof wait.answer === 'function';
  const answerable = kind !== CODESYS_AI_PENDING_KIND_APPROVAL && hasAnswer && questions.length > 0;
  let notAnswerableReason = '';
  if (!answerable) {
    if (kind === CODESYS_AI_PENDING_KIND_APPROVAL) {
      notAnswerableReason = '这是一条权限审批请求。代你批准权限是插件最不该做的事，所以这里只提示、不给按钮：请在主页会话里处理它。';
    } else if (!hasAnswer) {
      notAnswerableReason = '这条待回答的请求没有可就地提交的作答接口（DSH 版本可能不同）：请在主页会话里回答它。';
    } else {
      notAnswerableReason = '这条待回答的请求没有带回可显示的问题内容：请在主页会话里查看并回答它。';
    }
  }
  return {
    kind,
    key: String(wait.key || ''),
    sessionId: String(wait.sessionId || sessionId || ''),
    label: kind === CODESYS_AI_PENDING_KIND_PLAN_REVIEW ? '计划待审' : (kind === CODESYS_AI_PENDING_KIND_APPROVAL ? '等待审批' : '等待回答'),
    compactLabel: kind === CODESYS_AI_PENDING_KIND_PLAN_REVIEW ? '计划待审' : (kind === CODESYS_AI_PENDING_KIND_APPROVAL ? '待审批' : '待回答'),
    questions,
    answerable,
    notAnswerableReason,
  };
}

// ── T185：**就地回答**（只在用户显式点击后被调用，见上面第三条纪律） ──────────────────────────
//
// `payload` = `{ key, answers }`：
//   * `key`     外壳从 `snapshot().pendingInteraction.key` 原样带回来的那一个（用来防"答错一条"）；
//   * `answers` 每个问题一条 `{ id, selected: [label…], custom? }`。
//
// 编码与 DSH 自己那条 composer **逐字一致**（`dsh-client-ui-user-questions/lib/client.js:541-552`
// 的 `submitDrafts()`）：跳过的问题发 `selected: []`；既没有选选项又没有自定义文本 = **不完整**，
// 直接拒绝并给出可读原因（绝不发一个半成品给宿主）；给了自定义文本且**不是**多选时，
// `selected` 清空（DSH 就是这么编码的）。另外只接受**问题自己列出来的**选项标签 —— 绝不让插件
// 凭空构造一个宿主不认识的标签。
//
// 失败一律回 `{ ok:false, reason, detail }` 数据（T173 的教训：失败必须可读），成功回
// `{ ok:true, key, answered }`。**任何**情况下都不会替用户"猜"一个答案。
async function codesysAiChatAnswer(ctx, payload) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  }
  const input = payload && typeof payload === 'object' ? payload : {};
  const wantedKey = String(input.key === undefined || input.key === null ? '' : input.key);
  const answers = Array.isArray(input.answers) ? input.answers : [];
  if (!answers.length) {
    return { ok: false, reason: 'empty-answer', detail: '没有可提交的作答内容：请先选择一个选项或填写自定义答案。' };
  }
  const main = codesysAiChatMainSession(ctx);
  if (main.reason) {
    codesysAiChatNote(`answer.${main.reason}`, main.detail);
    return { ok: false, reason: main.reason, detail: main.detail, sessionId: main.sessionId || '' };
  }
  const sessionId = main.sessionId;
  const wait = codesysAiChatPendingWait(ctx, sessionId);
  const pending = wait ? codesysAiChatPendingInteraction(ctx, sessionId) : null;
  if (!pending) {
    const detail = '主页那条会话现在没有待回答的请求（可能已经在主页回答过了）：先刷新一下再看。';
    codesysAiChatNote('answer.no-pending', detail);
    return { ok: false, reason: 'no-pending', detail, sessionId };
  }
  if (pending.answerable !== true) {
    codesysAiChatNote('answer.not-answerable', pending.notAnswerableReason);
    return { ok: false, reason: 'not-answerable', detail: pending.notAnswerableReason, sessionId, key: pending.key };
  }
  if (wantedKey && wantedKey !== pending.key) {
    const detail = `待回答的已经不是刚才那一条了（现在是 ${pending.key}）：请按刷新后显示的新问题作答。`;
    codesysAiChatNote('answer.stale-pending', detail);
    return { ok: false, reason: 'stale-pending', detail, sessionId, key: pending.key };
  }
  const normalized = [];
  for (const question of pending.questions) {
    const row = answers.find((item) => item && String(item.id) === question.id);
    const title = String(question.header || '').trim() || question.question || question.id;
    if (!row) {
      const detail = `问题「${title}」还没有作答。`;
      codesysAiChatNote('answer.incomplete', detail);
      return { ok: false, reason: 'incomplete-answer', detail, sessionId, key: pending.key };
    }
    const selected = Array.isArray(row.selected) ? row.selected.map((label) => String(label)).filter(Boolean) : [];
    const custom = String(row.custom === undefined || row.custom === null ? '' : row.custom).trim();
    if (!selected.length && !custom) {
      const detail = `问题「${title}」还没有作答：请选择一个选项或填写自定义答案。`;
      codesysAiChatNote('answer.incomplete', detail);
      return { ok: false, reason: 'incomplete-answer', detail, sessionId, key: pending.key };
    }
    const allowed = new Set(question.options.map((option) => option.label));
    const unknown = selected.filter((label) => !allowed.has(label));
    if (unknown.length) {
      const detail = `选项「${unknown.join('、')}」不在问题「${title}」给出的选项里：请重新选择。`;
      codesysAiChatNote('answer.unknown-option', detail);
      return { ok: false, reason: 'unknown-option', detail, sessionId, key: pending.key };
    }
    // 与 DSH 的 `submitDrafts()` 同一套编码（见上面那段）：单选 + 自定义文本时 `selected` 清空。
    normalized.push({
      id: question.id,
      selected: custom === '' || question.multiSelect === true ? selected : [],
      ...(custom === '' ? {} : { custom }),
    });
  }
  try {
    await wait.answer({ answers: normalized });
  } catch (error) {
    const detail = String((error && error.message) || error);
    codesysAiChatNote('answer.failed', detail);
    return { ok: false, reason: 'answer-threw', detail, sessionId, key: pending.key };
  }
  codesysAiChatNote('answer.ok', `session=${sessionId} key=${pending.key} questions=${normalized.length}`);
  return { ok: true, sessionId, key: pending.key, answered: normalized.length };
}

// 读会话快照 → 外壳要显示的最近若干条消息 + 当前模型 + **进行中**那一组事实。
// **只读**，没有任何副作用，所以可以 1.5 秒（运行态 600ms）轮询。
async function codesysAiChatSnapshot(ctx, limit) {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  }
  const main = codesysAiChatMainSession(ctx);
  if (main.reason) {
    codesysAiChatNote(`snapshot.${main.reason}`, main.detail);
    return { ok: false, reason: main.reason, detail: main.detail, sessionId: main.sessionId || '' };
  }
  const sessionId = main.sessionId;
  const conversation = main.conversation;
  // ① / ②：DSH 0.2 的真实消息视图（见上面 T181 段）。
  const chatSource = codesysAiChatChatSource(ctx, sessionId);
  // T183：视图对象**留一份**——消息与"正在跑的 reasoning 块"读的是同一个快照，不重复取。
  const chatView = chatSource ? codesysAiChatChatView(chatSource) : null;
  let messages = [];
  let source = '';
  if (chatView) {
    messages = codesysAiChatMessagesFromChatView(chatView);
    if (messages.length) source = 'chat';
  }
  // ③：老形状兜底（也顺手保留原来的 snapshot-threw 失败语义）。
  let legacyError = '';
  if (!messages.length) {
    const legacy = codesysAiChatMessagesFromSessionSnapshot(conversation);
    legacyError = legacy.error;
    if (legacy.messages.length) { messages = legacy.messages; source = 'session-nodes'; }
  }
  // 三条路都没读到消息、而且**老形状那一步真的抛了**、并且连 chat 视图都取不到 —— 这才是
  // "读不出来"（不是"会话是空的"）。原来只有这一条失败分支，现在原样保留。
  if (!messages.length && legacyError && !chatSource) {
    codesysAiChatNote('snapshot.threw', legacyError);
    return { ok: false, reason: 'snapshot-threw', detail: legacyError, sessionId };
  }
  const wanted = Math.min(Math.max(Number(limit) || CODESYS_AI_SNAPSHOT_DEFAULT, CODESYS_AI_SNAPSHOT_MIN), CODESYS_AI_SNAPSHOT_MAX);
  const recent = messages.length > wanted ? messages.slice(messages.length - wanted) : messages;
  // T175：快照顺便带**当前模型**（同步读，不联网），外壳每 1.5 秒就能发现"主页把模型改了"。
  const model = codesysAiChatModelSummary(ctx, sessionId, conversation);
  // T183：**进行中**那一组事实（见上面 T183 段）。外壳据此画主界面那两样表现：
  // 运行中没有推理文本 → 实时行"正在分析请求"；有推理文本 → 标题"思考"的折叠行。
  const activity = codesysAiChatRunningFacts(ctx, sessionId, conversation);
  const reasoning = codesysAiChatReasoningOfChatView(chatView);
  // T185：**待回答**（见上面 T185 段）。它和 T183 那一组是**两件事**：`running` 说的是"回合还在跑"，
  // 而"待回答"说的是"这一回合正卡在等人回答上"。两条都回传，怎么画由外壳决定（观感只在一处）——
  // 这一条命令式地要求外壳：有 pendingInteraction 时**不许**再画「正在分析请求」。
  // 纯同步只读（`sessionStatus.getSnapshot()` 是一张现成的 Map），所以 1.5 秒轮询安全。
  const pendingInteraction = codesysAiChatPendingInteraction(ctx, sessionId);
  // ── 能力面（用户口径：「AI 对话就是唯一操作面，工作台只做能力提供」） ─────────────────────
  //
  // 工作台（shard 50）把"当前提案差异 / 写入闸门 / 编译结果"作为**纯数据**发布在
  // `window.__TASKHIVE_CODESYS_CAPABILITIES__`（只读投影 + `apply()`，见 50-codesys-workbench.js）。
  // 这里只**读**它并随快照回传，所以差异原文、编译结果都出现在抽屉的消息流里，不必让用户去工作台。
  // 判据：能力面自报的会话必须**就是**这条主页会话；不是（或没自报）一律当作"这一条会话没有工作台"，
  // 免得把别的会话的工程/提案当成这一条的。
  const capabilities = codesysAiChatCapabilities(sessionId);
  // `source` 让"消息是从哪条路读到的"在自报阶段里可查（chat = DSH 0.2 真形状 /
  // session-nodes = 老形状兜底 / (none) = 三条都空 —— 会话真的是空的）。
  codesysAiChatNote('snapshot.ok', `session=${sessionId} messages=${messages.length} source=${source || '(none)'} model=${(model && model.id) || '(none)'} running=${activity.running ? 1 : 0} pending=${activity.pending} reasoning=${reasoning.length} pendingInteraction=${pendingInteraction ? `${pendingInteraction.kind}:${pendingInteraction.key}` : '(none)'} capabilities=${capabilities ? `${capabilities.proposal ? capabilities.proposal.changeCount : 0}/${(capabilities.build && capabilities.build.state) || 'idle'}` : '(none)'}`);
  return {
    ok: true,
    sessionId,
    total: messages.length,
    truncated: recent.length < messages.length,
    messages: recent,
    model,
    // 进行中：主界面画的就是这几件事（见 T183 段），多一个字都不加。
    running: activity.running,
    runningVia: activity.via,
    pending: activity.pending,
    awaitingFirstTurn: activity.awaitingFirstTurn,
    reasoning,
    // T185：**待回答**（纯数据，`null` = 没有）。外壳据它画"等待回答"那一段，并**代替不了**用户：
    // 要回答问题必须走 `answer(payload)`，而那只在用户点「提交回答」时才会被调用。
    pendingInteraction,
    // A 段：工作台能力面（纯数据，`null` = 这条会话没有可读的工作台）。外壳据它把**差异原文**、
    // 「确认写入工程」与**编译结果**画进消息流；写入只能由那枚按钮的点击发起（`apply(payload)`）。
    capabilities,
  };
}

// 往**主页同一条会话**里发一条 prompt。成功/失败都返回数据（绝不静默）。
async function codesysAiChatPrompt(ctx, text) {
  const value = String(text === undefined || text === null ? '' : text).trim();
  if (!value) return { ok: false, reason: 'empty-text', detail: '没有可发送的文本' };
  const main = codesysAiChatMainSession(ctx);
  if (main.reason) {
    codesysAiChatNote(`prompt.${main.reason}`, main.detail);
    return { ok: false, reason: main.reason, detail: main.detail, sessionId: main.sessionId || '' };
  }
  const sessionId = main.sessionId;
  const conversation = main.conversation;
  if (typeof conversation.prompt !== 'function') {
    codesysAiChatNote('prompt.no-prompt', '');
    return { ok: false, reason: 'no-prompt', detail: `会话 ${sessionId} 没有 prompt 入口`, sessionId };
  }
  // T184：发送前再兜一次"工作台已绑定当前工程"。抽屉打开时已经触发过一次，这里是**幂等**的
  // 安全网：用户可能在抽屉打开后立刻发送（那一次绑定还没走完），或者那次触发时右栏还没挂起来。
  // 同样**不 await 绑定完成**，只把结果作为数据回传 —— 外壳只在失败时写一行，成功全程静默。
  let workbench = null;
  try { workbench = await codesysAiChatEnsureWorkbench(ctx); }
  catch (error) { workbench = { ok: false, bound: false, started: false, reason: 'workbench-ensure-threw', detail: String((error && error.message) || error), sessionId: String(sessionId || '') }; }
  let accepted = null;
  try { accepted = await conversation.prompt([{ type: 'text', text: value }], 'queue'); }
  catch (error) {
    const detail = String((error && error.message) || error);
    codesysAiChatNote('prompt.threw', detail);
    return { ok: false, reason: 'prompt-threw', detail, sessionId };
  }
  if (accepted && accepted.error) {
    const detail = String(accepted.error.message || accepted.error);
    codesysAiChatNote('prompt.rejected', detail);
    return { ok: false, reason: 'rejected', detail, sessionId };
  }
  codesysAiChatNote('prompt.ok', `session=${sessionId} chars=${value.length}`);
  // T184：把"发送前那次确保绑定"的结果原样带上（数据，供外壳只在失败时写一行）。
  return { ok: true, sessionId, chars: value.length, workbench };
}

// ── B 段：左侧栏「收起/展开」是**外壳 chrome**，不是导航 —— 不许把用户从插件面拽回会话面 ──────
//
// 用户报障（原文）：「插件打开的情况下点击收起左侧栏，插件会不可见（界面上只剩「CODESYS／点击此
// 标签会在中央 Harness 工作区打开插件」这类文字）」。
//
// 真因（逐行可查，全部在代码事实上）：
//   ① `80-codesys-task-and-apply.js:26-41` 的 `installNativeNavigationBridge().onClick` 是 document
//      捕获阶段的一个**兜底**：任何落在左栏（`button.closest('[data-pane="sidebar"],[class*="sidebarCol"]')`）
//      且不是「设置 / 会话 / 工作区」行上的点击，最后都会走到 `openSurface('chat')`（:40）。
//      左栏的收起按钮就在这一列里（DSH 布局：`dsh-client-ui-layout` 的 `*_sidebarCol` 是左栏那一列，
//      侧栏根节点与它的 toggle 都在其中），它的可读名字是「收起侧边栏 / 展开侧边栏」
//      （`dsh-client-ui-sidebar` 的 `toggle.collapse` / `toggle.open`），所以它命中的正是这条兜底。
//   ② `openSurface('chat')` → postMessage → preload → IPC `surface:open` = 'chat'
//      → `main.js:2011` 判定 `dshRendered` → `main.js:2012` `hidePluginSurface()`
//      → `main.js:1542` `removeChildView(pluginSurfaceView)`：**原生插件面被摘下来**。
//   ③ 为什么点插件入口不会这样：那条路上 `onSurfaceEntryClick`（80:229）先开插件面，随后 DSH 自己
//      的 React 把主面板挂载 → `activating()` 的 `useEffect` 再 `openSurface('codesys')`（80:110）
//      把面重新打开。而收起按钮**不挂载任何主面板**（主面板是 keepMounted，那个 effect 不会再跑），
//      于是那一条 'chat' 之后再没有任何人把插件面要回来 —— 用户看到的就是插件消失、露出主面板里
//      那句占位文字（「CODESYS／点击此标签会在中央 Harness 工作区打开插件」，00-core-and-surfaces.js:145）。
//
// 修法（最小且精确）：在**同一个文档**里、比 80 那条兜底**更早**注册一个 `window` 捕获阶段监听器，
// 只在"这是一次左栏 chrome 点击（收起/展开侧边栏）**且**当前打开的 surface 是插件面"时，把这一趟
// 里紧随其后的 `openSurface('chat')` **吞掉**。吞掉的不是用户意图：用户点的是"收起左栏"，
// 没有任何一步表达"回到会话面"。窗口只覆盖这一次点击的同步派发（`setTimeout(0)` 摘除），
// 所以真正的导航点击（会话行 / 新会话 / 插件入口）一字不改。
//
// 为什么在 shard 78 里、而不是改 80：本轮写作用域不允许改 shard 80 / 70（布局桥）。这里只**复用**
// 00-core 既有的 `openSurface()` 与 `setPluginSurfaceMode()`，不新增通道、不新增 DOM、不改任何几何。
const CODESYS_SIDEBAR_CHROME_LABEL = /收起(?:左侧)?侧边栏|展开(?:左侧)?侧边栏|收起左侧栏|展开左侧栏|collapse\s+(?:the\s+)?sidebar|expand\s+(?:the\s+)?sidebar/i
// 会被原生 WebContentsView 承载的 surface（DSH 自渲染的那几个不算：chat / settings / knowledge）。
const CODESYS_SIDEBAR_CHROME_RENDERED = new Set(['chat', 'settings', 'knowledge'])

function installSidebarChromeSurfaceGuard() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  // 同一个文档里只装一次（client-hmr 会重跑 apply，闭包标志会被新实例重置，所以状态挂 window）。
  const previous = window.__TASKHIVE_SIDEBAR_CHROME_GUARD__
  if (previous && previous.installed === true && typeof previous.dispose === 'function') return previous.dispose
  const state = { installed: true, armed: false, swallowed: 0, lastLabel: '', dispose: null }
  const isSidebarChromeClick = (event) => {
    const target = event?.target
    if (!target || typeof target.closest !== 'function') return ''
    const button = target.closest('button,[role="button"],[role="tab"]')
    if (!button) return ''
    const label = String(button.getAttribute?.('aria-label') || button.getAttribute?.('title') || button.textContent || '').trim()
    if (!label || !CODESYS_SIDEBAR_CHROME_LABEL.test(label)) return ''
    return label
  }
  const activePluginSurface = () => {
    const active = String(window.__TASKHIVE_ACTIVE_SURFACE__ || 'chat')
    return active && !CODESYS_SIDEBAR_CHROME_RENDERED.has(active) ? active : ''
  }
  const onCapture = (event) => {
    const label = isSidebarChromeClick(event)
    if (!label) return
    state.lastLabel = label
    // 只有"插件面正开着"时才需要保护；否则这一趟的 chat 请求要么本来就是用户意图，要么是空操作。
    if (!activePluginSurface()) return
    state.armed = true
    setTimeout(() => { state.armed = false }, 0)
  }
  window.addEventListener('click', onCapture, true)
  // 复用 00-core 既有的 openSurface：只在这一个窗口里吞掉 `chat`，其余调用原样转发。
  const baseOpenSurface = openSurface
  if (typeof baseOpenSurface === 'function') {
    const guarded = function openSurfaceGuardedBySidebarChrome(kind) {
      const next = String(kind || 'chat')
      if (state.armed && next === 'chat' && activePluginSurface()) {
        state.swallowed += 1
        codesysAiChatNote('sidebar-chrome.kept-surface', `label=${state.lastLabel} surface=${activePluginSurface()}`)
        return
      }
      return baseOpenSurface(next)
    }
    openSurface = guarded
    state.dispose = () => {
      window.removeEventListener('click', onCapture, true)
      if (openSurface === guarded) openSurface = baseOpenSurface
      if (window.__TASKHIVE_SIDEBAR_CHROME_GUARD__ === state) delete window.__TASKHIVE_SIDEBAR_CHROME_GUARD__
    }
  } else {
    state.dispose = () => {
      window.removeEventListener('click', onCapture, true)
      if (window.__TASKHIVE_SIDEBAR_CHROME_GUARD__ === state) delete window.__TASKHIVE_SIDEBAR_CHROME_GUARD__
    }
  }
  window.__TASKHIVE_SIDEBAR_CHROME_GUARD__ = state
  return state.dispose
}

// ── A 段：工作台能力面（只读读法 + 写入入口） ─────────────────────────────────────────────
//
// 工作台的发布形态（见 `50-codesys-workbench.js` 的抽屉能力面那一段）：
//   window.__TASKHIVE_CODESYS_CAPABILITIES__ = { version, sessionId(), signature(), read(), apply(input) }
// 这里**只读** `read()`，并把结果原样交给外壳；`apply(input)` 只被 `bridge.apply()` 调，而
// `bridge.apply()` 只被主进程的 `codesys:ai-chat-apply` 通道调 —— 那条通道又只有外壳抽屉里
// 「确认写入工程」那一次点击会发起。**没有任何轮询 / 定时器 / 自动路径会走到 apply()。**
// 会话判等：能力面自报的会话必须与这条主页会话相同；自报为空视为"还没准备好"，同样不采用。
function codesysAiChatCapabilities(sessionId) {
  if (typeof window === 'undefined') return null;
  try {
    const seam = window.__TASKHIVE_CODESYS_CAPABILITIES__;
    if (!seam || typeof seam.read !== 'function') return null;
    const reported = typeof seam.sessionId === 'function' ? String(seam.sessionId() || '') : '';
    if (!reported || reported !== String(sessionId || '')) return null;
    const value = seam.read();
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch (error) {
    codesysAiChatNote('capabilities.threw', String((error && error.message) || error));
    return null;
  }
}

// 把抽屉里那一次点击交给工作台**既有的**写入函数（`applyProposal` → `apply-and-build`）。
// 这一层不解释、不补全、不重试：`apply()` 返回什么就回传什么（成功 / 被 sha 防护挡下 / 失败）。
// 唯一的"本地"判据是会话判等（不是这条会话的工作台就不许写），其余全部由工作台自己判定。
async function codesysAiChatApply(input) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' };
  const seam = window.__TASKHIVE_CODESYS_CAPABILITIES__;
  if (!seam || typeof seam.apply !== 'function') {
    return { ok: false, reason: 'no-capabilities', detail: 'DSH 侧没有工作台能力面（入口 window.__TASKHIVE_CODESYS_CAPABILITIES__）：工作台组件还没挂载。请先点面板上的「代码任务」或「AI 对话」把工作台挂起来。' };
  }
  if (typeof seam.sessionId === 'function') {
    const reported = String(seam.sessionId() || '');
    const expected = String(input?.sessionId || '');
    if (reported && expected && reported !== expected) {
      return { ok: false, reason: 'foreign-session', detail: '这条工作台属于另一条会话：请不要在这里写入。' };
    }
  }
  const startedAt = Date.now();
  const value = await seam.apply({
    proposalSignature: String(input?.proposalSignature || ''),
    overwriteConfirmed: input?.overwriteConfirmed === true,
  });
  const outcome = value && typeof value === 'object' ? value : { ok: false, reason: 'apply-empty', detail: '工作台没有回报写入结果' };
  codesysAiChatNote(outcome.ok === true ? 'apply.ok' : 'apply.blocked', `reason=${outcome.reason || ''} written=${outcome.written || 0} ms=${Date.now() - startedAt}`);
  return outcome;
}

// ── 本轮：**放弃**（用户原话「确认写入旁边加入一个放弃选项」「放弃写入也包括手写改动」）──────────
//
// 为什么走 postMessage 而不是再加一条 IPC 通道：这条动作**不写工程**（它只能*减少*待写入内容：
// 作废 AI 提案 + 手写草稿），而外壳 → DSH 已经有一条现成的通路 —— `app/renderer/renderer.js` 把
// `{source:'taskhive-desktop'}` 消息 postMessage 进本框架（`codesys.task` 走的就是它）。于是这里
// 只需要一个监听器 + 一次回信，主进程 / preload / 通道清单（CODESYS_PANEL_ONLY_CHANNELS）一个字都不用改。
//
// 安全语义与 apply 完全一致：
//   * **没有用户点击 ⇒ 这里 0 次调用**：没有任何轮询 / 定时器 / 自动路径会发这条消息；
//   * 身份判据照 shard 80 既有的 desktop 消息写法：`event.source` 只认本窗口或它的父窗口（外壳），
//     DSH 文档里的别的东西发不出这条消息；
//   * 交给工作台能力面的 `discard()`：作废提案与手写草稿、按磁盘最新内容重读编辑器，
//     **不写工程、不编译、不推进写入基线**。
const CODESYS_AI_CHAT_DISCARD_MESSAGE = 'codesys.proposal.discard'
const CODESYS_AI_CHAT_DISCARD_REPLY = 'codesys.proposal.discarded'

// 把结果回给外壳（`window.parent`）。**永不抛**：回信失败不能让那一次放弃在抽屉里永远"在途"。
function codesysAiChatDiscardReply(input, value) {
  if (typeof window === 'undefined' || !window.parent || typeof window.parent.postMessage !== 'function') return
  try {
    window.parent.postMessage({
      source: 'taskhive-dsh',
      type: CODESYS_AI_CHAT_DISCARD_REPLY,
      nonce: String(input?.nonce || ''),
      sessionId: String(input?.sessionId || ''),
      ok: value?.ok === true,
      reason: String(value?.reason || ''),
      detail: String(value?.detail || ''),
      // 外壳那一行"已放弃此提案与 N 处手写改动"里的 N 就是它（工作台自己数出来的，不是猜的）。
      droppedDrafts: Number(value?.droppedDrafts || 0),
      hadProposal: value?.hadProposal === true,
    }, '*')
  } catch (error) {
    codesysAiChatNote('discard.reply-failed', String((error && error.message) || error))
  }
}

// 把外壳那一次点击交给工作台**既有的**清状态函数（`discardProposal`）。这一层不解释、不补全：
// `discard()` 返回什么就回传什么。唯一的"本地"判据是会话判等（不是这条会话的工作台就不许放弃）。
async function codesysAiChatDiscard(input) {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window', detail: '数据桥没有运行在浏览器文档里' }
  const seam = window.__TASKHIVE_CODESYS_CAPABILITIES__
  if (!seam || typeof seam.discard !== 'function') {
    return { ok: false, reason: 'no-capabilities', detail: 'DSH 侧没有工作台能力面（入口 window.__TASKHIVE_CODESYS_CAPABILITIES__）：工作台组件还没挂载。请先点面板上的「代码任务」或「AI 对话」把工作台挂起来。' }
  }
  if (typeof seam.sessionId === 'function') {
    const reported = String(seam.sessionId() || '')
    const expected = String(input?.sessionId || '')
    if (reported && expected && reported !== expected) {
      return { ok: false, reason: 'foreign-session', detail: '这条工作台属于另一条会话：请不要在这里放弃。' }
    }
  }
  const startedAt = Date.now()
  const value = await seam.discard({ proposalSignature: String(input?.proposalSignature || '') })
  const outcome = value && typeof value === 'object' ? value : { ok: false, reason: 'discard-empty', detail: '工作台没有回报放弃结果' }
  codesysAiChatNote(outcome.ok === true ? 'discard.ok' : 'discard.blocked', `reason=${outcome.reason || ''} drafts=${Number(outcome.droppedDrafts || 0)} ms=${Date.now() - startedAt}`)
  return outcome
}

// 「放弃」唯一的入口（安装一次，随数据桥卸载一起摘掉）。判据与 shard 80 的 desktop 消息一字不差：
// `source === 'taskhive-desktop'` + `event.source` 只认自己或父窗口。
function installCodesysAiChatDiscardListener() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  const onMessage = (event) => {
    if (event?.data?.source !== 'taskhive-desktop' || event?.data?.type !== CODESYS_AI_CHAT_DISCARD_MESSAGE) return
    if (event.source !== window && event.source !== window.parent) return
    const input = event.data
    Promise.resolve()
      .then(() => codesysAiChatDiscard(input))
      .then((value) => codesysAiChatDiscardReply(input, value))
      .catch((error) => codesysAiChatDiscardReply(input, { ok: false, reason: 'discard-crashed', detail: String((error && error.message) || error) }))
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

// ── T184：点开「AI 对话」= 默认把工作台绑到 CODESYS 面板当前跟随的那个工程 ──────────────────
//
// 报障（用户原文）：点「AI 对话」后让 AI"写入一个名为 test 的程序"，AI 回"无法写入，因为代码
// 工作台没有绑定工程"；用户要求"点击 AI 对话时应当默认绑定工程"。
//
// 真因**不是**模型也不是提案链路：工作台的绑定与状态发布只发生在**它自己的 React 组件**里
// （`50-codesys-workbench.js` 的 `CodesysWorkbench`）—— 组件挂载且页签可见时才会
// `detectCurrentProject({ force: true })`（`codesys:current-project` → `bind-project`
// → `inspect-project`），随后才把 `projectPath` 发布给宿主（`index.js` 的
// `publishWorkbenchState`）。而"点开 AI 对话抽屉"这条路上**从来没有**任何一步去打开那个页签或
// 触发探测，所以只要用户这一轮没点过面板上的「代码任务」，`taskhive_codesys_workbench` 读到的
// 就是空状态 → "尚未打开或尚未绑定工程"。
//
// 修法：**不新造绑定机制**，只把"工作台该出现了"这一个动作接到抽屉打开上（两条都走既有流程）：
//   * 工作台页签已在（`codesysWorkbenchControl.detect` 已由组件注册）→ 直接调它，走组件既有的
//     `detectCurrentProject({ force: true })`；
//   * 页签不在 → `ctx.sidebarRight.openTab(CODESYS_AI_CHAT_WORKBENCH_TAB)`（shard 80 注册的
//     **同一个**页签）把组件挂起来（右栏折叠时先用既有的 `ensureRightSidebarOpen()` 展开）；它
//     挂载 / 变为可见时自己会 force 探测并绑定（`50-codesys-workbench.js` 的 `[sessionId,
//     tabVisible]` effect）。**T192：DSH 的 openTab 一定会把页签展开并顶到最前（真包证据见下面
//     T192 段），所以这一步之后立刻把右栏还原成用户原来的样子** —— 用户报障"打开 AI 对话时
//     CODESYS 工作台跳出来"说的就是这一步，而还原不会削弱绑定能力（同样见 T192 段）；
//   * 页签**开不了**（用户停在 CODESYS 插件面板时 DSH 的会话面没有挂载，真机日志原文
//     `sidebarRight: no session surface is mounted`）→ 投递外壳「代码任务」通路的那条消息
//     （见下面 ③b）：由 shard 80 既有的 `openCodesysWorkbench()` 先 `openSurface('chat')` 把会话面
//     挂起来、再在右栏 ready 之后开同一个页签。目标是"点「AI 对话」就能绑上"，**不要求**用户
//     先手动点一次「代码任务」（那只是两级都失败时的一句话兜底）。
//
// 安全语义（务必保持）：两条路都**只绑定** —— `bind-project` 只把工程复制进隔离作业再读树，
// 不写工程文件、不编译、不确认；`apply-and-build` 仍然只有工作台里的「确认写入工程」按钮会调。
// 这里也**不 await 绑定完成**：真机上绑定要等 ScriptEngine（界面口径是"几十秒"），抽屉打开不能
// 等它。绑定失败 / 面板没有工程时的**一行可读原因由工作台自己的状态行**给出
// （`detectCurrentProject` 的失败分支本来就 `setStatus` 一行，不静默）；本函数只负责"连工作台都
// 打不开"这一类失败，那一种必须回传给外壳显示。
const CODESYS_AI_CHAT_WORKBENCH_TAB = 'taskhive:codesys-workbench'

// 只读地看一眼"本会话的工作台是否已经绑定了工程"。seam 是工作台自己发布的镜像
// （`window.__TASKHIVE_CODESYS_WORKBENCH__`，见 40-session-records-panel.js），按**会话判等**，
// 所以永远不会把别的会话的工程当成这一条会话的。取不到一律当"没绑定"，继续走绑定流程。
function codesysAiChatWorkbenchState(sessionId) {
  try {
    const seam = window.__TASKHIVE_CODESYS_WORKBENCH__
    const state = seam && typeof seam.getState === 'function' ? seam.getState() : null
    if (!state || typeof state !== 'object') return null
    if (String(state.sessionId || '') !== String(sessionId || '')) return null
    return state
  } catch { return null }
}

// ── T192：右栏"安静挂载" —— 能力照旧挂上，但用户眼前的右栏看上去没变 ─────────────────────────
//
// 用户报障（原文）："打开ai对话的时候 codesys工作台会跳出来"。
//
// 真因**不在**本插件，而在 DSH 的 `sidebarRight.openTab` 自己（权威包
// `@deepseek-ai/dsh-client-ui-sidebar-right@0.2.0-rc.1` 的 `lib/client.js`，就是真机装的那一份）：
//   * `openTab(kind, options)`（:6412）→ `placeTab`（:6467）→ `place`（:6478）→ store 的
//     `openContent`（:5266）；而 `openContent` 干的**第一件事**就是 `planSetExpanded(state, true)`
//     （:5269）—— 无条件把右栏展开；
//   * 接着要么 `planOpenContent` 造一个新页签（新页签必然成为该 pane 的 activeTabId），要么对
//     **已经存在**的页签直接 `focusTab`（:5287-5292）—— 两种情况都把工作台顶到最前；
//   * `openTab` 的 placement 只认 `paneId` / `preferNewPane` / `replaceTab` / `revealIfOpened`
//     （:6480-6491）。**没有** `activate:false`，也**没有** `expand:false`；`revealIfOpened`
//     只决定"已经开着的页签要不要再显示一遍"，与要不要展开无关。
//     结论：DSH 侧**不存在**"打开但不激活"，这条 API 也没有 `setExpanded`（只有 `toggleExpanded`
//     与 `isExpanded`，:6534/:6538）。
//
// 而且"必须先激活"是硬约束，不是我们的选择：工作台自己的 `detect` 只在页签**可见**时注册
// （`50-codesys-workbench.js:769-776`），而 `tab.visible` 的真包定义是
//   `active && (pane.host === "float" || layout.expanded && (title || pane.activeTabId === tabId))`
// （真包 `:8983`）。折叠着、或只是后台页签时 `visible` 为假 → `detect` 为 null → 连"触发一次绑定"
// 都做不到。所以"完全不动右栏"在 DSH 侧做不到（已如实报告，见本轮交付说明）。
//
// 本轮做的是**最小扰动**：让 DSH 那一步照常发生，然后**趁用户还没看见**把右栏还原回去。
// 用的全是 DSH **公开**的 sidebarRight 面（同一份真包）：
//   * 开之前读用户原来的样子 —— `active()`（:6524，当前激活页签的记录）与 `isExpanded()`（:6534）；
//     会话面没挂载时这两个只会给缺省值，所以先看 `mounted.getSnapshot()`（:6336 的
//     ISidebarRight.mounted）—— 那时**不记快照**，宁可不动也不猜（否则会把用户本来就展开的右栏折起来）；
//   * `openTab`（原样，能力一步不少）；
//   * 等"页签真的可见了"：判据是 `codesysWorkbenchControl.detect` 由 null 变成函数 —— 同一个 React
//     commit 里"注册 detect"那条 effect（`50:769`）先跑、紧接着"force 探测"那条（`50:777`）才跑，
//     所以看到它非空就等于**探测已经发出去了**；
//   * 立刻还原：`focus(原来那个页签)`（:6550）+ 原来折叠着就 `toggleExpanded()`（:6538）折回去。
//
// 为什么还原之后能力不缩水（三条都能在真机上验）：
//   * 工作台页签注册时带 `keepMounted: true`（`80-codesys-task-and-apply.js:238`），DSH 的座位在右栏
//     折叠时**照样渲染面板与页签体**（真包 `:5839` 只在 `surface === undefined` 时返回 null，
//     `:5470` 的文档也写明"折叠时 docked content 仍然挂着"），所以组件**不会卸载**；
//   * 探测是一条异步链（`50:661` 起），链上**没有任何** visibility 判据 —— 一旦发出就与本函数无关地
//     跑完（`bindSourceProject` → `inspect-project` → `projectPath`）；
//   * 状态回传也不依赖可见性：`publishCodesysState`（`50:574`）里那条 900ms 合并发送（`50:586-590`）
//     无条件发出；宿主侧 `projectBound` 的判据是 `Boolean(state.projectPath)`（`index.js:590`），
//     与 `visible` 无关；
//   * **还原之前抓住的那个 detect 会留给下一次抽屉打开用**（`codesysAiChatWorkbenchMounted`）：它是个
//     闭包 `(options) => detectCurrentProjectRef.current?.(options)`，指向组件里的同一个探测函数，
//     所以连点 / 反复开关抽屉既不重新挂载，也不产生任何右栏动作（幂等）。
//
// 代价（不藏，与上面的"做不到"一起报告）：DSH 那一步"展开 + 顶到最前"是无条件的，我们只能在
// **下一帧绘制之前**折回去（等待用 setTimeout(0) 轮询，真机常态是 0-2 个宏任务就还原），所以最坏
// 情况是**一帧**的闪现，而不是"跳出来停在那儿"。另外 `workbenchVisible`
// （`workbenchIntersecting && tabVisible`，`50:346`）会随页签一起变回假，工作台自己那条"等 CODESYS
// 里出现工程"的后台重试节奏会停（`50:859-879` 明写在 `visibleRef.current` 上）—— 这不是本函数能
// 回避的（它要的正是"用户看不见"）；补偿是下一次抽屉打开会再用抓住的 detect 探一次，用户在 CODESYS
// 面板里点开工程之后打开抽屉 / 点工作台页签都会重新探测。
const CODESYS_AI_CHAT_WORKBENCH_VISIBLE_TIMEOUT_MS = 400
const codesysAiChatWorkbenchMount = { sessionId: '', detect: null, sidebarRight: null }

// 右栏"用户看得见的那一面"的快照。取不到（没有会话面 / 这一版 DSH 没有 mounted）一律返回 null ——
// 调用方据此**不还原**：宁可让右栏多停一会儿，也不要把用户自己的状态改成我们猜的样子。
function codesysAiChatRightColumnSnapshot(sidebarRight) {
  if (!sidebarRight) return null
  let mountedSession
  try {
    const mounted = sidebarRight.mounted
    mountedSession = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : undefined
  } catch { return null }
  // undefined / null / '' = 会话面没挂载：active() / isExpanded() 这时给的是缺省值，不是用户的界面。
  if (mountedSession === undefined || mountedSession === null || mountedSession === '') return null
  let expanded = null
  try { expanded = typeof sidebarRight.isExpanded === 'function' ? sidebarRight.isExpanded() === true : null } catch { expanded = null }
  let activeTabId = ''
  try {
    const active = typeof sidebarRight.active === 'function' ? sidebarRight.active() : null
    activeTabId = active && active.id ? String(active.id) : ''
  } catch { activeTabId = '' }
  if (expanded === null && !activeTabId) return null
  return { expanded, activeTabId, sessionId: String(mountedSession) }
}

// 还原成快照那一刻的样子。永不抛：这一步失败只是"右栏多停一会儿"，不该把 ensureWorkbench 变成失败。
function codesysAiChatRestoreRightColumn(sidebarRight, before) {
  if (!sidebarRight || !before) return { restored: false, detail: 'no-snapshot' }
  const done = []
  try {
    if (before.activeTabId && typeof sidebarRight.focus === 'function') {
      const active = typeof sidebarRight.active === 'function' ? sidebarRight.active() : null
      const currentId = active && active.id ? String(active.id) : ''
      if (currentId !== before.activeTabId) { sidebarRight.focus(before.activeTabId); done.push(`focus=${before.activeTabId}`) }
    }
  } catch (error) { done.push(`focus-failed=${String((error && error.message) || error)}`) }
  try {
    if (before.expanded === false
      && typeof sidebarRight.isExpanded === 'function' && typeof sidebarRight.toggleExpanded === 'function'
      && sidebarRight.isExpanded() === true) {
      sidebarRight.toggleExpanded()
      done.push('collapsed')
    }
  } catch (error) { done.push(`collapse-failed=${String((error && error.message) || error)}`) }
  return { restored: done.length > 0, detail: done.join('+') }
}

function codesysAiChatWorkbenchDetectReady() {
  try { return Boolean(codesysWorkbenchControl && typeof codesysWorkbenchControl.detect === 'function') } catch { return false }
}

// 等一下"工作台页签真的可见"（判据见上面长注释）。有界：超时就如实返回 visible:false，由调用方
// 照常还原并把原因写进审计流 —— 绝不无限等，也绝不静默。
async function codesysAiChatWaitForWorkbenchVisible() {
  if (codesysAiChatWorkbenchDetectReady()) return { visible: true, waited: 0, detail: '' }
  // shard 10 的 `codesysWorkbenchControl` 对象本身都取不到时，没有任何组件会把 detect 注册进来，
  // 也就没有可等的信号 —— 直接如实回报。真机的 bundle 里它一定在（shard 10 顶层就建了它），
  // 这一步只让契约 / 探针环境不必白等。
  let observable = false
  try { observable = Boolean(codesysWorkbenchControl) && typeof codesysWorkbenchControl === 'object' } catch { observable = false }
  if (!observable) return { visible: false, waited: 0, detail: '当前 bundle 里没有工作台控制对象（codesysWorkbenchControl），无法确认页签是否已经可见' }
  const timerFactory = typeof setTimeout === 'function' ? setTimeout : null
  if (!timerFactory) return { visible: false, waited: 0, detail: '当前文档没有 setTimeout，无法等工作台页签变为可见' }
  const startedAt = Date.now()
  while (Date.now() - startedAt < CODESYS_AI_CHAT_WORKBENCH_VISIBLE_TIMEOUT_MS) {
    // setTimeout(0)：一有机会就检查，尽量赶在下一帧绘制之前还原（不产生可见的展开）。
    await new Promise((resolve) => { timerFactory(resolve, 0) })
    if (codesysAiChatWorkbenchDetectReady()) return { visible: true, waited: Date.now() - startedAt, detail: '' }
  }
  const waited = Date.now() - startedAt
  return { visible: false, waited, detail: `等了 ${waited}ms 工作台页签仍未变为可见（它自己的 detect 没有注册）` }
}

// 还原之前把工作台自己的探测函数留下来 —— 它由组件注册（`50:773`），是个指向组件内部
// `detectCurrentProjectRef` 的闭包，页签不再可见之后依然可用（组件带 keepMounted，不会卸载）。
function codesysAiChatRememberWorkbenchDetect(sessionId, sidebarRight) {
  const control = codesysWorkbenchControl
  if (!control || typeof control.detect !== 'function') return false
  codesysAiChatWorkbenchMount.sessionId = String(sessionId || '')
  codesysAiChatWorkbenchMount.detect = control.detect
  codesysAiChatWorkbenchMount.sidebarRight = sidebarRight || null
  return true
}

// 上一次抓住的探测函数还算数吗？两条判据，都是"组件还活着"的可执行证据（真包 :6374 / :6336）：
//   ① 右栏座位**还挂在这个会话上** —— 用户切到别的 surface 时座位会卸载，那时抓住的闭包指向一个
//      已经不画的组件，不能再调它（`mounted.getSnapshot()` 是公开面）；会话也对不上就更不能；
//   ② 工作台页签**还在这个会话的右栏布局里** —— 用户把页签关掉时组件会真的卸载。
// 任一条不成立就丢掉它，让下一次抽屉打开老老实实重新挂一遍：能力宁可多花一次挂载，也不许静默丢失。
function codesysAiChatWorkbenchMounted(sessionId) {
  const mount = codesysAiChatWorkbenchMount
  if (!mount || typeof mount.detect !== 'function') return false
  if (String(mount.sessionId || '') !== String(sessionId || '')) return false
  const sidebarRight = mount.sidebarRight
  let mountedSession
  try {
    const mounted = sidebarRight && sidebarRight.mounted
    mountedSession = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot() : undefined
  } catch { return false }
  if (mountedSession === undefined || mountedSession === null || mountedSession === '') return false
  if (String(mountedSession) !== String(sessionId || '')) return false
  try {
    if (sidebarRight && typeof sidebarRight.tabsIn === 'function') {
      const tabs = sidebarRight.tabsIn(String(sessionId || ''))
      if (Array.isArray(tabs) && !tabs.some((tab) => tab && String(tab.kind || '') === CODESYS_AI_CHAT_WORKBENCH_TAB)) return false
    }
  } catch { /* 取不到布局就保守地当它还在：代价最多是多触发一次只读探测，而不是丢掉能力 */ }
  return true
}

// 抽屉打开（或发送第一条消息前）调用一次。返回的**全是数据**：
//   { ok, bound, started, reason, detail, sessionId, projectPath, projectName, via }
// 只有"连工作台都打不开（右栏页签与「代码任务」通路两级都失败）/ 没有可用的主页会话"才 ok:false
// —— 那是外壳状态行必须写的一行。
// 已经绑定 → ok:true/bound:true（一次往返都不产生）。触发成功 → ok:true/started:true
// `via` 是**纯观测**字段（外壳不据此分支），四档：
//   ''                 = 第一级：右栏页签已在（`control.detect` 当下就注册着，页签本来就可见）；
//   'already-mounted'  = T192：复用上次安静挂载时抓住的 detect（这一次**零右栏动作**，幂等）；
//   'session-panel'    = ③b 最小扰动：挂会话面 + 开页签（不切用户的 surface）；
//   'code-task'        = ③c 最后兜底：外壳「代码任务」通路（那一条会切界面）。
async function codesysAiChatEnsureWorkbench(ctx) {
  const main = codesysAiChatMainSession(ctx)
  if (main.reason) {
    return { ok: false, bound: false, started: false, reason: main.reason, detail: main.detail || '', sessionId: String(main.sessionId || '') }
  }
  const sessionId = String(main.sessionId || '')
  const published = codesysAiChatWorkbenchState(sessionId)
  if (published && String(published.projectPath || '')) {
    codesysAiChatNote('workbench.already-bound', `session=${sessionId} project=${String(published.projectName || published.projectPath || '')}`)
    return {
      ok: true, bound: true, started: false, reason: '', detail: '', sessionId,
      projectPath: String(published.projectPath || ''), projectName: String(published.projectName || ''),
    }
  }
  // ① 工作台已经挂起来过：直接触发它自己的探测/绑定流程（force 会绕过 45 秒节流）。
  const control = codesysWorkbenchControl
  if (control && typeof control.detect === 'function') {
    try { void control.detect({ force: true, reason: 'ai-chat-open' }) }
    catch (error) {
      const detail = String((error && error.message) || error)
      codesysAiChatNote('workbench.detect-threw', detail)
      return { ok: false, bound: false, started: false, reason: 'workbench-detect-threw', detail: `触发工作台绑定当前工程失败：${detail}；请点面板上的「代码任务」手动绑定工程。`, sessionId }
    }
    codesysAiChatNote('workbench.detect-started', `session=${sessionId}`)
    return { ok: true, bound: false, started: true, reason: '', detail: '', sessionId }
  }
  // ①b T192：页签**当下**不可见（上一轮我们已经把右栏还原成了用户原来的样子），但它的探测函数在
  // 还原之前就被抓住了 —— 复用那一个。这一条路上**一次右栏动作都不产生**，所以"连点 / 反复开关抽屉"
  // 不会再让它闪一下（幂等），而 capability 一步不少（同一个探测函数、同样的 force）。
  if (codesysAiChatWorkbenchMounted(sessionId)) {
    try { void codesysAiChatWorkbenchMount.detect({ force: true, reason: 'ai-chat-open' }) }
    catch (error) {
      const detail = String((error && error.message) || error)
      codesysAiChatNote('workbench.detect-captured-threw', detail)
      return { ok: false, bound: false, started: false, reason: 'workbench-detect-threw', detail: `触发工作台绑定当前工程失败：${detail}；请点面板上的「代码任务」手动绑定工程。`, sessionId }
    }
    codesysAiChatNote('workbench.detect-captured', `session=${sessionId}；用的是上次安静挂载时抓住的 detect（右栏零动作）`)
    return { ok: true, bound: false, started: true, via: 'already-mounted', reason: '', detail: '', sessionId }
  }
  // ② 工作台页签还没开过：打开它（同一个页签），组件挂载时自己会 force 探测并绑定 —— 真正把这个
  // 页签"摆到用户面前"的其实是 DSH 自己（openTab 无条件展开 + 顶到最前，证据见下面 T192 段），
  // 所以这一步必须配一次还原。
  //
  // ③ 第一级（既有主路径）：右栏页签。失败**不再直接判死**，先把可读原因收下来，交给③b 兜底。
  const sidebarRight = codesysAiChatOptionalService(ctx, 'sidebarRight')
  // T192：**先记下用户原来那一面**再动手。右栏折叠着时页签挂不起来（而"组件挂载 / 可见"正是它自己
  // 探测并绑定的前提），所以先复用 shard 00 既有的 `ensureRightSidebarOpen()` —— 进入任何插件 surface
  // 时 `openSurface()` 本来就调过它，这里只是补一次；不新增机制、不建 DOM、不查选择器。
  // （真包 0.2.0-rc.1 的客户端 bundle 里已经没有 `[data-dsh-right-sidebar-toggle]` 这个属性，这一步在
  // 真机上多半是空操作；真正把右栏展开的是 DSH 自己的 `openContent` —— 两种来源都由下面的还原覆盖。）
  const before = codesysAiChatRightColumnSnapshot(sidebarRight)
  try { ensureRightSidebarOpen() } catch { /* 展开失败不影响下面的判定：openTab 的失败会带可读原因回传 */ }
  let tabFailure = ''
  let tabReason = ''
  if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
    tabReason = 'workbench-tab-service-missing'
    tabFailure = 'DSH 没有提供右栏页签服务（sidebarRight.openTab），无法在打开 AI 对话时打开「CODESYS 工作台」'
  } else {
    try { sidebarRight.openTab(CODESYS_AI_CHAT_WORKBENCH_TAB) }
    catch (error) {
      tabReason = 'workbench-tab-open-failed'
      tabFailure = `打开「CODESYS 工作台」页签失败：${String((error && error.message) || error)}`
    }
  }
  if (!tabFailure) {
    // T192：DSH 已经把工作台页签展开并顶到最前了。先等它自己的 force 探测真的发出去（判据见文件里
    // T192 段：`codesysWorkbenchControl.detect` 被组件注册 = 页签可见且那条探测 effect 已经跑），
    // 然后**马上**把右栏还原成用户原来的样子。探测是一条异步链，还原不会打断它。
    const visible = await codesysAiChatWaitForWorkbenchVisible()
    codesysAiChatRememberWorkbenchDetect(sessionId, sidebarRight)
    const restored = codesysAiChatRestoreRightColumn(sidebarRight, before)
    codesysAiChatNote('workbench.tab-opened', `session=${sessionId} visible=${visible.visible ? 'yes' : 'no'} waited=${visible.waited}ms restored=${restored.detail || 'nothing'}`
      + (visible.detail ? `；${visible.detail}` : ''))
    return { ok: true, bound: false, started: true, reason: '', detail: '', sessionId }
  }
  // ③b 第二级（**最小扰动**，T191）：只把**会话面**挂回主面板，**不切用户的 surface**。
  //
  // 为什么必须挂会话面：DSH 的右栏（工作台页签的宿主）是**会话级**的 —— 会话面没挂载时
  // `sidebarRight.openTab` 必然被拒（真机日志原文 `sidebarRight: no session surface is mounted`），
  // 而工作台组件正是"能力面"的持有者（差异数据 / 写入函数都在它里面）。挂载会话面的动作就是
  // `layout.selectPanel(null)`（null = 显示 Conversation），这一步无法回避。
  //
  // 但**可以且必须**省掉 `openSurface('chat')`：那一步才会让宿主把原生插件面摘下来、把用户从
  // CODESYS 面板拽回会话面。用户的中央视图照旧由原生插件面盖着（几何里右栏是保留区，所以右栏
  // 与它并存可见），只有 DSH 底下那一层主面板从"插件的占位面板"换成"会话面"。
  const minimal = await codesysAiChatMountWorkbenchWithoutDragging(ctx)
  if (minimal.ok) {
    // T192：这一级同样"先挂上再还原"（快照是 selectPanel 之后、真正 openTab 之前取的，见 ③b 里那一段）。
    const visible = await codesysAiChatWaitForWorkbenchVisible()
    codesysAiChatRememberWorkbenchDetect(sessionId, sidebarRight)
    const restored = codesysAiChatRestoreRightColumn(sidebarRight, minimal.before)
    codesysAiChatNote('workbench.mounted-without-drag', `session=${sessionId} visible=${visible.visible ? 'yes' : 'no'} waited=${visible.waited}ms restored=${restored.detail || 'nothing'}；右栏页签先失败：${tabFailure}`)
    return { ok: true, bound: false, started: true, via: 'session-panel', reason: '', detail: '', sessionId }
  }
  // ③c 第三级（最后兜底，既有通路）：连会话面都挂不起来（没有 layout 服务）→ 外壳「代码任务」那条。
  // 这一条会切界面（它自己做 `openSurface('chat')`），所以只在③b 根本没得试的时候才走，并且
  // 在返回值里用 `via:'code-task'` 与可读 detail 说明"为什么这一趟动了用户的界面"。
  //
  // 真机报障原文（审计流 codesys.ai-chat.workbench-unbound）：
  //   {"reason":"workbench-tab-open-failed","detail":"打开「CODESYS 工作台」页签失败：
  //    sidebarRight: no session surface is mounted；请手动点面板上的「代码任务」绑定工程。"}
  // 用户的要求是"点「AI 对话」就该绑上"，所以这里不把用户推回去手动点；投递的仍是外壳那条**一模一样**
  // 的消息（main.js:3797 → shard 80 的 onDesktopMessage → openCodesysWorkbench）。
  const fallback = codesysAiChatOpenWorkbenchViaCodeTask()
  if (fallback.ok) {
    codesysAiChatNote('workbench.opened-via-code-task', `session=${sessionId}；最小扰动那一级失败：${minimal.detail}`)
    return { ok: true, bound: false, started: true, via: 'code-task', reason: '', detail: '', sessionId }
  }
  // ④ 三级都失败：把**每一级**的可读原因一起回传（绝不静默），下一步具体到"点面板上的「代码任务」"。
  const detail = `${tabFailure}；最小扰动那一级也没能挂起会话面（${minimal.detail}）；改用外壳既有的「代码任务」通路也没能打开工作台（${fallback.detail}）：请手动点面板上的「代码任务」绑定工程。`
  codesysAiChatNote('workbench.code-task-failed', detail)
  return { ok: false, bound: false, started: false, reason: tabReason, detail, sessionId }
}

// ③b 的实现：`selectPanel(null)` 把会话面挂回主面板（右栏因此可用），然后开工作台页签。
// 四条纪律：
//   * **绝不调 openSurface('chat')**（那是"把用户拽回会话面"的那一步，也正是本轮要拿掉的）；
//   * 会话面的挂载是**异步**的，所以先订阅 `sidebarRight.mounted` 再 selectPanel，并在有限时间内重试
//     （绝不无限等：工作台挂不上只是"能力面暂不可用"，不能把抽屉打开这件事卡住）；
//   * 任何异常都吞成 `{ ok:false, detail }`，由调用方决定下一级；
//   * T192：把"真正 openTab 之前的那一瞬"的右栏快照（`before`）一起回传 —— 调用方探测一发出就
//     按它还原（用户报障"打开 AI 对话时工作台跳出来"）。
const CODESYS_AI_WORKBENCH_MOUNT_TIMEOUT_MS = 400

async function codesysAiChatMountWorkbenchWithoutDragging(ctx) {
  const layout = codesysAiChatOptionalService(ctx, 'layout')
  if (!layout || typeof layout.selectPanel !== 'function') {
    return { ok: false, detail: 'DSH 没有提供布局服务（layout.selectPanel），无法在不切走用户视图的前提下挂起会话面' }
  }
  const sidebarRight = codesysAiChatOptionalService(ctx, 'sidebarRight')
  if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
    return { ok: false, detail: 'DSH 没有提供右栏页签服务（sidebarRight.openTab）' }
  }
  let lastError = ''
  // T192：还原用的快照必须**在真正 openTab 的那一刻**取 —— 会话面这时才刚被 `selectPanel(null)`
  // 挂起来，"右栏是不是挂在会话上"到这一刻才有意义（没挂上时 active() / isExpanded() 返回的是
  // 缺省值，拿它去还原会把用户本来就展开的右栏折起来）。快照取不到时调用方就不还原。
  const tryOpen = () => {
    const before = codesysAiChatRightColumnSnapshot(sidebarRight)
    try { sidebarRight.openTab(CODESYS_AI_CHAT_WORKBENCH_TAB); return { ok: true, before } }
    catch (error) { lastError = String((error && error.message) || error); return { ok: false, before: null } }
  }
  return await new Promise((resolve) => {
    let settled = false
    let unsubscribe = null
    let timer = null
    // 定时器只在真的存在时才用（浏览器一定有；某些契约/探针的沙箱里没有，那时就不等，直接如实回报）。
    const timerFactory = typeof setTimeout === 'function' ? setTimeout : null
    const clearTimer = typeof clearTimeout === 'function' ? clearTimeout : null
    const finish = (value) => {
      if (settled) return
      settled = true
      try { if (typeof unsubscribe === 'function') unsubscribe() } catch { /* 已释放 */ }
      if (timer && clearTimer) clearTimer(timer)
      resolve(value)
    }
    const finishOpen = (fallbackDetail) => {
      const opened = tryOpen()
      finish(opened.ok
        ? { ok: true, before: opened.before }
        : { ok: false, detail: lastError || fallbackDetail })
    }
    // 订阅必须在 selectPanel **之前**：同步挂载的那一种时序会在 selectPanel 内立刻通知。
    // `settled` 那道闸是必须的：右栏的订阅可能在一次挂载里通知多次，重复 openTab 会让 DSH 抛
    // "already registered"（而且 attempted 计数也会骗人）。
    try { unsubscribe = sidebarRight.mounted?.subscribe?.(() => { if (settled) return; finishOpen('会话面没有在预期时间内挂起来，右栏页签打不开') }) } catch { /* 没有订阅能力就用重试 */ }
    if (timerFactory) timer = timerFactory(() => finishOpen('会话面没有在预期时间内挂起来，右栏页签打不开'), CODESYS_AI_WORKBENCH_MOUNT_TIMEOUT_MS)
    try { layout.selectPanel(null) } catch (error) {
      finish({ ok: false, detail: `layout.selectPanel(null) 抛错：${String((error && error.message) || error)}` })
    }
    // 没有定时器可用时不能挂着一个永不 settle 的 Promise：立刻按当前状态回报一次。
    if (!timerFactory) finishOpen('会话面还没有挂起来，右栏页签打不开')
  })
}

// 兜底投递的那一条消息：source/type 与 main.js:3797（外壳「代码任务」按钮最终走的那一句）
// **逐字相同** —— 同一条通路、同一个接收者（shard 80 的 onDesktopMessage），不另造消息名。
// 浏览器语义：窗口发给自己的消息，`event.source === window`，正是 shard 80 那句判据要的形态。
// 返回 `{ ok, detail }`，**永不抛**（调用方要把两级失败都写进同一条可读原因）。
function codesysAiChatOpenWorkbenchViaCodeTask() {
  try {
    if (typeof window === 'undefined' || typeof window.postMessage !== 'function') {
      return { ok: false, detail: '当前 DSH 文档没有 window.postMessage' }
    }
    window.postMessage({ source: 'taskhive-desktop', type: 'codesys.workbench.open' }, '*')
    return { ok: true, detail: '' }
  } catch (error) {
    return { ok: false, detail: String((error && error.message) || error) }
  }
}

// 安装数据桥。这是 shard 78 的**唯一**职责：注册 prompt/snapshot 两个数据入口 + T175 的
// models/setModel 两个模型入口（T186：`setModel` 同时承担**推理等级**，两者都是会话级写入）
// + T184 的 ensureWorkbench（打开抽屉时确保工作台已绑定工程）
// + T185 的 answer（用户点「提交回答」时把答案交回去）。
// 注意这里刻意不返回 `disposers.push(...)` 给 shard 80 —— T173 踩过"disposers 不在作用域 →
// ReferenceError 被 catch 吞掉 → 入口从未建立"，所以由本函数自己持有 disposer 并原地返回。
function installCodesysAiChat(ctx) {
  if (typeof window === 'undefined') { codesysAiChatNote('install-skipped', 'no-window'); return () => {}; }
  // B 段：左栏 chrome（收起/展开侧边栏）不许把用户从插件面拽回会话面。装在这里是因为 shard 80 的
  // `apply()` 会先调本函数、再装它自己那条"左栏点击兜底"（80:297 在 80:455 之前），所以我们的
  // 捕获监听器一定比那条兜底先跑。返回值由本函数持有（shard 80 的 disposers 在下面这段之前
  // 可能不在作用域 —— T173 踩过，所以这里原地持有，不 push 给别人）。
  const removeSidebarChromeGuard = installSidebarChromeSurfaceGuard();
  // 本轮：「放弃」的消息入口（见上面那一段）。与 chrome 守卫同一个持有方式：disposer 由本函数
  // 原地拿着，不 push 给 shard 80（T173 踩过"不在作用域 → 入口从未建立"）。
  const removeDiscardListener = installCodesysAiChatDiscardListener();
  const bridge = {
    version: CODESYS_AI_BRIDGE_VERSION,
    async snapshot(limit) {
      try { return await codesysAiChatSnapshot(ctx, limit); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('snapshot.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    async prompt(text) {
      try { return await codesysAiChatPrompt(ctx, text); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('prompt.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    async models() {
      try { return await codesysAiChatModels(ctx); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('models.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    // `input` = `{ id, effort? }`（也接受老的裸 id 串）。两个字段都只是**数据**：`id` 是
    // `provider/model` 复合键，`effort` 是模型自己声明过的推理等级 id。等级与模型走**同一条**
    // 会话级写入（见 `codesysAiChatSetModel`），本函数不写工程、不编译、不确认。
    async setModel(input) {
      try { return await codesysAiChatSetModel(ctx, input); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('model.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    // T184：抽屉打开时（真机上由 app/main.js 的 codesys:ai-chat 处理器调用）确保工作台已经绑定
    // 到 CODESYS 面板当前跟随的那个工程。只触发既有绑定流程，不写工程、不编译、不确认。
    async ensureWorkbench() {
      try { return await codesysAiChatEnsureWorkbench(ctx); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('workbench.crashed', detail);
        return { ok: false, bound: false, started: false, reason: 'bridge-crashed', detail };
      }
    },
    // T185：**就地回答**那条待回答的提问。真机上只由 app/main.js 的 `codesys:ai-chat-answer`
    // 处理器调用，而那条通道只有外壳的「提交回答」按钮会触发 —— 所以"没有用户点击"时这里 0 次调用。
    async answer(payload) {
      try { return await codesysAiChatAnswer(ctx, payload); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('answer.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
    // A 段：**确认写入工程**（工作台能力面那条写入通路）。真实调用链只有一条：
    //   抽屉消息流里那枚「确认写入工程」按钮的点击 → preload `codesysAiChatApply`
    //   → IPC `codesys:ai-chat-apply`（面板专属门）→ 主进程 → 这里 → 工作台 `apply()`
    //   → **工作台那枚按钮调的同一个 `applyProposal`**（同一条 sha 防护、同一个 `apply-and-build`）。
    // 所以快照轮询 / 定时器 / 自动路径**永远不会**走到这里：没有点击 = 这里 0 次调用。
    async apply(input) {
      try { return await codesysAiChatApply(input); }
      catch (error) {
        const detail = String((error && error.message) || error);
        codesysAiChatNote('apply.crashed', detail);
        return { ok: false, reason: 'bridge-crashed', detail };
      }
    },
  };
  window.__TASKHIVE_CODESYS_AI_BRIDGE__ = bridge;
  codesysAiChatNote('installed', `version=${CODESYS_AI_BRIDGE_VERSION} session=${codesysAiChatCurrentSessionId(ctx) || '(none)'}`);
  return () => {
    try { removeSidebarChromeGuard(); } catch { /* 已经摘掉 */ }
    try { removeDiscardListener(); } catch { /* 已经摘掉 */ }
    try { if (window.__TASKHIVE_CODESYS_AI_BRIDGE__ === bridge) delete window.__TASKHIVE_CODESYS_AI_BRIDGE__; }
    catch { /* 删不掉就留着，下一次安装会覆盖 */ }
  };
}
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
