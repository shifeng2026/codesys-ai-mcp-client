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
