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
