import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

export const name = 'taskhive-surfaces'
export const inject = ['tools', 'subagents', 'llm', 'sessions', 'settings', 'permissionPresets']

const root = () => process.env.TASKHIVE_ROOT ? process.env.TASKHIVE_ROOT : process.cwd()
const require = createRequire(import.meta.url)
const allowedExtensions = new Set(['.md', '.txt', '.json'])
const AUTO_CONVERSATION_KNOWLEDGE = false
const EXPERT_CONTEXT_BUDGET = Object.freeze({ taskChars: 4000, upstreamChars: 4000, knowledgeChars: 3000, knowledgeResults: 3 })
// knowledge/cards.json is append-only in normal use; cap it so the file cannot
// grow without bound. Candidates still awaiting review (non-terminal status)
// outrank finished ones when the oldest cards are pruned.
const KNOWLEDGE_CARD_LIMIT = 500
const TERMINAL_CARD_STATUSES = Object.freeze(new Set(['rejected', 'archived', 'superseded', 'closed', 'withdrawn']))

// retainExpertCandidate is called once per successful stage, and runExpertTeam
// fans stages out with Promise.all, so two retained cards can be in flight at
// once. Serialise the whole read-modify-write here: an interleaved
// read-then-write would silently drop the other caller's card.
let knowledgeWriteQueue = Promise.resolve()

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function filesUnder(directory, result = [], depth = 0) {
  if (depth > 4 || !existsSync(directory)) return result
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, item.name)
    if (item.isDirectory()) filesUnder(file, result, depth + 1)
    else if (allowedExtensions.has(item.name.toLowerCase().slice(item.name.lastIndexOf('.')))) result.push(file)
  }
  return result
}

function enabledRepositoryIds(kind) {
  const catalog = readJson(join(root(), kind, 'catalog.json'), { repositories: {} })
  return new Set(Object.values(catalog.repositories || {}).filter((item) => item.state === 'enabled').map((item) => item.id))
}

function searchDocuments(kind, query, limit = 8) {
  const base = join(root(), kind === 'knowledge' ? 'knowledge' : 'experts', kind === 'knowledge' ? 'repositories' : 'installed')
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return { kind, query: '', hits: [], scannedFiles: 0 }
  const enabled = enabledRepositoryIds(kind)
  const files = [...enabled].flatMap((id) => filesUnder(join(base, id)))
  const terms = [...new Set(needle.split(/\s+/).filter((term) => term.length >= 2))]
  const ranked = []
  for (const file of files) {
    let text
    try { if (statSync(file).size > 1024 * 1024) continue; text = readFileSync(file, 'utf8') } catch { continue }
    const lowered = text.toLowerCase()
    const matched = terms.filter((term) => lowered.includes(term))
    if (!matched.length) continue
    const index = lowered.indexOf(matched[0])
    const start = Math.max(0, index - 120)
    ranked.push({ score: matched.length, file: relative(root(), file).replaceAll('\\', '/'), snippet: text.slice(start, index + matched[0].length + 240).replace(/\s+/g, ' ').trim() })
  }
  if (kind === 'knowledge') {
    const cards = readJson(join(root(), 'knowledge', 'cards.json'), { cards: [] }).cards || []
    for (const card of cards.filter((item) => item.status !== 'rejected')) {
      const text = `${card.title}\n${card.content}\n${(card.tags || []).join(' ')}`
      const lowered = text.toLowerCase()
      const matched = terms.filter((term) => lowered.includes(term))
      if (!matched.length) continue
      const index = lowered.indexOf(matched[0])
      ranked.push({ score: matched.length + (card.status === 'approved' ? 1 : 0), file: `knowledge/cards.json#${card.id}`, snippet: text.slice(Math.max(0, index - 120), index + matched[0].length + 240).replace(/\s+/g, ' ').trim(), status: card.status })
    }
  }
  const hits = ranked.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(20, Number(limit) || 8))).map(({ score, ...hit }) => ({ ...hit, matchedTerms: score }))
  return { kind, query: String(query || ''), hits, scannedFiles: files.length }
}

function repositoryAudit(kind) {
  const file = join(root(), kind, 'catalog.json')
  const catalog = readJson(file, { version: 1, repositories: {} })
  return { kind, version: catalog.version || 1, entries: Object.values(catalog.repositories || {}).map((item) => ({ id: item.id, name: item.name, version: item.version, state: item.state, manifestHash: item.manifestHash || null })) }
}

// Write a JSON document to a sibling temporary file and rename it over the
// target. rename is atomic within one volume, so a crash or a concurrent
// reader never observes a half-written cards.json — the truncated file a plain
// writeFileSync can leave behind reads back as the empty fallback and would
// silently discard the whole knowledge store.
function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
  } catch (error) {
    try { unlinkSync(temporary) } catch { /* the temporary may never have been created */ }
    throw error
  }
}

function cappedCards(cards, limit = KNOWLEDGE_CARD_LIMIT) {
  if (!Array.isArray(cards)) return []
  if (cards.length <= limit) return cards
  // cards are newest-first. Fill the quota with the newest non-terminal cards
  // first, then top up with the newest terminal ones, so an in-review candidate
  // is never pruned in favour of a rejected or archived card. Original order is
  // preserved.
  const kept = new Set()
  cards.forEach((card, index) => { if (kept.size < limit && !TERMINAL_CARD_STATUSES.has(String(card?.status || ''))) kept.add(index) })
  cards.forEach((_card, index) => { if (kept.size < limit) kept.add(index) })
  return cards.filter((_card, index) => kept.has(index))
}

function withKnowledgeLock(action) {
  const queued = knowledgeWriteQueue.then(action, action)
  // The queue must survive a failed write, and `queued` is handed to the
  // caller, so keep this internal chain fulfilled either way.
  knowledgeWriteQueue = queued.then(() => undefined, () => undefined)
  return queued
}

// Returns a promise for the retained card — the existing card when the same
// evidence was already stored, null when there is nothing to retain. Callers
// await it; the card they receive is unchanged.
async function retainExpertCandidate({ task, result, parentSessionId, modelId, source = 'harness-expert-run', type = 'expert-result', tags = ['专家', '待审核'], titlePrefix = '专家执行候选' }) {
  const content = String(result || '').trim().slice(0, 12000)
  if (!task || !content) return null
  return withKnowledgeLock(() => {
    const file = join(root(), 'knowledge', 'cards.json')
    const state = readJson(file, { version: 1, revision: 0, cards: [] })
    const evidenceHash = createHash('sha256').update(`${task}\n${content}`).digest('hex')
    const existing = (state.cards || []).find((card) => card.evidenceHash === evidenceHash)
    if (existing) return existing
    const now = new Date().toISOString()
    const revision = Number(state.revision || 0) + 1
    const card = { id: `card-${evidenceHash.slice(0, 16)}`, title: `${titlePrefix}：${String(task).replace(/\s+/g, ' ').slice(0, 60)}`, content, type, tags, source, sourceSessionId: String(parentSessionId || ''), sourceTaskId: createHash('sha1').update(String(task)).digest('hex').slice(0, 16), modelId: String(modelId || ''), evidenceHash, status: 'candidate', revision, createdAt: now, updatedAt: now }
    state.revision = revision
    state.cards = cappedCards([card, ...(state.cards || [])])
    writeJsonAtomic(file, state)
    return card
  })
}

function textFromEvent(event) {
  const values = []
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return
    if (typeof value === 'string') { if (value.trim().length >= 4) values.push(value.trim()); return }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    if (typeof value === 'object') for (const [key, item] of Object.entries(value)) if (!/token|cookie|api.?key|authorization/i.test(key)) visit(item, depth + 1)
  }
  visit(event?.data ?? event)
  return values.join('\n').slice(0, 10000)
}

function installConversationKnowledgeSink(ctx) {
  if (typeof ctx.on !== 'function') return () => {}
  const sessions = new Map()
  const timers = new Map()
  const completion = /response|assistant|completion|finish|stop/i
  const input = /request|user|prompt|message/i
  const dispose = ctx.on('session/event', (session, event) => {
    const sessionId = String(session?.id || '')
    if (!sessionId || !event?.type || /tool\/|request\/header/i.test(event.type)) return
    const text = textFromEvent(event)
    if (!text) return
    const state = sessions.get(sessionId) || { user: [], assistant: [], modelId: '' }
    if (input.test(event.type) && !completion.test(event.type)) state.user.push(text)
    if (completion.test(event.type)) state.assistant.push(text)
    state.user = state.user.slice(-8); state.assistant = state.assistant.slice(-8)
    sessions.set(sessionId, state)
    if (!completion.test(event.type)) return
    clearTimeout(timers.get(sessionId))
    timers.set(sessionId, setTimeout(() => {
      const current = sessions.get(sessionId)
      if (!current?.assistant.length) return
      const task = current.user.at(-1) || '对话任务'
      const result = current.assistant.at(-1)
      retainExpertCandidate({ task, result: `问题：${task}\n\n结论：${result}`, parentSessionId: sessionId, modelId: current.modelId, source: 'harness-conversation-auto-summary', type: 'conversation-summary', tags: ['对话沉淀', '待审核'], titlePrefix: '对话总结候选' })
        .catch((error) => console.error(`[taskhive-surfaces] conversation knowledge retention failed: ${error.message}`))
    }, 1200))
  })
  return () => { dispose?.(); for (const timer of timers.values()) clearTimeout(timer); sessions.clear(); timers.clear() }
}

function codesysPluginEnabled() {
  const catalog = readJson(join(root(), 'plugins', 'catalog.json'), { plugins: {} })
  const plugin = catalog.plugins?.['codesys-monitor']
  return Boolean(plugin && plugin.state === 'enabled' && plugin.state !== 'uninstalled')
}

function codesysScriptEngine() {
  const installedPath = join(root(), 'plugins', 'installed', 'codesys-monitor', 'scriptengine.cjs')
  const sourceFallback = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'codesys-monitor', 'scriptengine.cjs')
  const modulePath = existsSync(installedPath) ? installedPath : sourceFallback
  const { CodesysScriptEngine } = require(modulePath)
  return new CodesysScriptEngine(root())
}

function expertDispatch(args = {}) {
  const data = readJson(join(root(), 'experts', 'experts.json'), { teams: [], experts: [] })
  if (enabledRepositoryIds('experts').size === 0) return { status: 'disabled', reason: 'no-enabled-expert-repository', execution: 'harness-single-session-dispatch-plan', agentLoop: 'Harness/DSH', team: {}, safetyPolicy: { defaultActionLevel: 'L0', realDeviceWrite: false }, knowledgeEvidence: { query: String(args.task || ''), hits: [], scannedFiles: 0 }, task: String(args.task || ''), requiresHumanApproval: true }
  const team = data.teams.find((item) => item.id === (args.teamId || data.selectedTeamId)) || data.teams[0]
  if (!team) return { status: 'unavailable', reason: 'no-expert-team' }
  const requested = String(args.task || '').trim()
  const knowledge = requested ? searchDocuments('knowledge', requested.slice(0, EXPERT_CONTEXT_BUDGET.taskChars), EXPERT_CONTEXT_BUDGET.knowledgeResults) : { hits: [], scannedFiles: 0, query: '' }
  return {
    status: data.teamEnabled === false ? 'disabled' : 'ready',
    execution: 'harness-single-session-dispatch-plan',
    agentLoop: 'Harness/DSH',
    team: { id: team.id, name: team.name, members: team.members, stages: team.workflow?.stages || [] },
    safetyPolicy: team.workflow?.safetyPolicy || { defaultActionLevel: 'L0', realDeviceWrite: false, onlineChange: false, motion: false },
    knowledgeEvidence: knowledge,
    task: requested,
    requiresHumanApproval: true,
  }
}

function textFromBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n')
    .trim()
    .slice(0, 6000)
}

function currentAgentRoute(agent) {
  const events = Array.isArray(agent?.session?.events) ? agent.session.events : []
  const request = [...events].reverse().find((event) => event?.type === 'request/header')
  const config = request?.data?.header?.config || {}
  return {
    provider: String(agent?.options?.provider || config.provider || '').trim(),
    model: String(agent?.options?.model || config.model || '').trim(),
    reasoningEffort: String(agent?.options?.reasoningEffort || config.reasoningEffort || '').trim(),
  }
}

// Expert configs are hand-editable and long-lived, so they routinely carry a
// short provider name where the LLM registry registers a qualified id (the
// shipped team says `ollama` while the registry has `ollama-local`). Without
// this mapping a configured expert route fails to resolve, and the old code
// swallowed that failure and quietly ran the expert on the parent's model — so
// a "multi-model" team silently became N copies of one model.
const PROVIDER_ALIASES = Object.freeze({
  ollama: 'ollama-local',
  deepseek: 'deepseek-api',
  anthropic: 'anthropic-api',
  claude: 'claude-code',
  codex: 'codex-cli',
  openai: 'codex-cli',
  browser: 'web-ai',
  web: 'web-ai',
})

function registeredProviderIds(ctx) {
  try { return (ctx.llm?.listProviders?.() || []).map((provider) => String(provider.id || '')).filter(Boolean) } catch { return [] }
}

// Resolve a configured provider name to a registered id. Returns the original
// value when nothing matches, so the caller's error message names what the user
// actually wrote rather than a silently substituted guess.
function resolveRegisteredProviderId(ctx, requested) {
  const wanted = String(requested || '').trim()
  if (!wanted) return ''
  const registered = registeredProviderIds(ctx)
  if (!registered.length) return wanted
  if (registered.includes(wanted)) return wanted
  const aliased = PROVIDER_ALIASES[wanted.toLowerCase()]
  if (aliased && registered.includes(aliased)) return aliased
  return registered.find((id) => id.toLowerCase() === wanted.toLowerCase()) || wanted
}

// Effective route for one expert.
//
// `configured` is now the DEFAULT (it was opt-in through `routeMode`), because
// per-expert models are the entire point of an expert team: with the previous
// default every member inherited the parent route and the team was single-model
// by construction.
//
// A configured route that cannot be resolved still falls back to the parent so
// the run is not lost, but the fallback is reported instead of swallowed.
async function expertRoute(ctx, expert, mode, parent, signal, override = {}) {
  const requestedProvider = String(override.provider || (mode === 'configured' ? expert?.providerId : '') || '').trim()
  const requestedModel = String(override.model || (mode === 'configured' ? expert?.model : '') || '').trim()
  if (requestedProvider && requestedModel) {
    const providerId = resolveRegisteredProviderId(ctx, requestedProvider)
    try {
      await ctx.llm.resolveModelInfo(providerId, requestedModel, signal)
      return {
        provider: providerId,
        model: requestedModel,
        reasoningEffort: String(override.reasoningEffort || expert?.reasoningEffort || '').trim(),
        source: override.provider || override.model ? 'call-override' : 'expert-config',
        requestedProvider,
        requestedModel,
        fallbackReason: '',
      }
    } catch (error) {
      const registered = registeredProviderIds(ctx).join(', ') || '(none)'
      const reason = `专家配置路由不可用：${requestedProvider}/${requestedModel}（解析为 ${providerId}）：${String(error?.message || error).slice(0, 200)}；已注册提供方：${registered}`
      const inherited = currentAgentRoute(parent)
      if (!inherited.provider || !inherited.model) throw new Error(`${reason}；且当前 Harness 会话没有可继承的模型路由`)
      return { ...inherited, source: 'parent-session-fallback', requestedProvider, requestedModel, fallbackReason: reason }
    }
  }
  const inherited = currentAgentRoute(parent)
  if (!inherited.provider || !inherited.model) throw new Error('当前 Harness 会话没有可继承的模型路由；请为该专家配置 providerId 与 model')
  return { ...inherited, source: 'inherited', requestedProvider: '', requestedModel: '', fallbackReason: '' }
}

function expertPrompt(task, expert, stage, dependencyResults, safetyPolicy, knowledgeEvidence) {
  const evidence = dependencyResults.length
    ? dependencyResults.map((item) => `${item.stageId}: ${item.output || item.diagnostic || item.stopReason}`).join('\n')
    : '无上游子任务；以主任务和知识库证据为准。'
  return [
    `主任务：${task}`,
    `当前阶段：${stage.id}`,
    `专家职责：${expert.role || expert.name}`,
    `上游结果：\n${evidence.slice(0, EXPERT_CONTEXT_BUDGET.upstreamChars)}`,
    `安全上限：${JSON.stringify(safetyPolicy)}`,
    '只做分析、只读检索和方案输出；不得下载 PLC、写变量、启停、调试、Force 或绕过人工确认。',
    `已审核知识召回：${JSON.stringify(knowledgeEvidence || { hits: [] }).slice(0, EXPERT_CONTEXT_BUDGET.knowledgeChars)}`,
    `输出格式：${expert.outputFormat || '结论、证据、风险、下一步'}`,
  ].join('\n\n')
}

async function runExpertTeam(ctx, args = {}, exec) {
  exec.signal.throwIfAborted()
  const data = readJson(join(root(), 'experts', 'experts.json'), { teams: [], experts: [] })
  const team = data.teams.find((item) => item.id === (args.teamId || data.selectedTeamId)) || data.teams[0]
  const safetyPolicy = team?.workflow?.safetyPolicy || { defaultActionLevel: 'L0', realDeviceWrite: false, onlineChange: false, motion: false }
  const base = {
    status: 'unavailable',
    execution: 'harness-subagents',
    agentLoop: 'Harness/DSH',
    provider: 'spawn',
    team: team ? { id: team.id, name: team.name } : {},
    parentSessionId: String(exec.agent?.session?.id || ''),
    runs: [],
    failedCount: 0,
    safetyPolicy,
    requiresHumanApproval: true,
    reason: '',
  }
  if (enabledRepositoryIds('experts').size === 0) return { ...base, reason: 'no-enabled-expert-repository' }
  if (!team || data.teamEnabled === false) return { ...base, reason: 'expert-team-disabled' }
  if (!exec.agent) return { ...base, reason: 'parent-agent-required' }
  if (!ctx.subagents.list().includes('spawn')) return { ...base, reason: 'spawn-provider-unavailable' }
  const task = String(args.task || '').trim().slice(0, EXPERT_CONTEXT_BUDGET.taskChars)
  if (!task) return { ...base, reason: 'task-required' }
  const knowledgeEvidence = searchDocuments('knowledge', task, EXPERT_CONTEXT_BUDGET.knowledgeResults)

  const experts = new Map((data.experts || []).map((expert) => [expert.id, expert]))
  const captainId = team.primaryExpertId || team.members?.find((member) => member.teamRole === 'captain')?.expertId
  const stages = Array.isArray(team.workflow?.stages) ? team.workflow.stages : []
  const stageById = new Map(stages.map((stage) => [stage.id, stage]))
  const completed = new Set(stages.filter((stage) => stage.owner === captainId).map((stage) => stage.id))
  const pending = stages.filter((stage) => stage.owner !== captainId && stage.trigger !== 'failure-only')
  const resultsByStage = new Map()
  const runs = []
  // Follow-up multi-turn.
  //
  // One-shot delegation (`start`) disposes the child as soon as it settles, so
  // there is no way to ask it anything else. `startContinuable` establishes a
  // durable child with a stable id that stays addressable, and
  // `dsh-tool-subagent-control` (already mounted by the cordis agent preset)
  // exposes the model-facing `send_message` / `interrupt` / `list-agents` tools
  // over that registry — so hooking up follow-up is a matter of creating the
  // children continuably and reporting their ids.
  //
  // The trade-off, which is why this is opt-in rather than the default: per the
  // seam's contract `startContinuable` resolves at INBOX ACCEPTANCE, not at
  // completion, so it returns no output. The staged pipeline below feeds each
  // stage's output into the next stage's prompt, and that requires awaiting the
  // first turn. `continuable: true` therefore dispatches the team and returns
  // child ids for follow-up instead of a finished analysis.
  const wantsContinuable = args.continuable === true
  const canContinue = wantsContinuable && typeof ctx.subagents?.startContinuable === 'function'
  const continuableFallback = wantsContinuable && !canContinue
    ? '当前 ctx.subagents 不提供 startContinuable，已退回一次性委派'
    : ''
  const maxMembers = Math.max(1, Math.min(8, Number(args.maxMembers) || 6))
  // Default to each expert's own configured route. `inherited` remains available
  // for an explicit single-model run, but it must not be the default: it turned
  // every expert team into N copies of the parent model.
  const routeMode = args.routeMode === 'inherited' ? 'inherited' : 'configured'

  const executeStage = async (stage) => {
    const expert = experts.get(stage.owner)
    if (!expert) return { stageId: stage.id, expertId: stage.owner || '', name: stage.owner || stage.id, provider: '', model: '', routeSource: '', stopReason: 'error', output: '', diagnostic: 'expert-definition-missing' }
    const dependencies = (stage.dependsOn || []).map((id) => resultsByStage.get(id)).filter(Boolean)
    let route
    try { route = await expertRoute(ctx, expert, routeMode, exec.agent, exec.signal, { provider: args.provider, model: args.model, reasoningEffort: args.reasoningEffort }) } catch (error) {
      return { stageId: stage.id, expertId: expert.id, name: expert.name, provider: '', model: '', routeSource: '', stopReason: 'error', output: '', diagnostic: String(error.message || error).slice(0, 1000) }
    }
    let run
    const subagentRequest = {
      prompt: [{ type: 'text', text: expertPrompt(task, expert, stage, dependencies, safetyPolicy, knowledgeEvidence) }],
      parent: exec.agent,
      maxDepth: 1,
      toolFilter: { allow: ['taskhive_knowledge_search', 'taskhive_knowledge_audit', 'taskhive_codesys_scriptengine_doctor', 'taskhive_codesys_scriptengine_probe'] },
      persona: `${expert.systemPrompt || expert.role || expert.name}\n你是 Harness 派生的受限专家节点，不拥有独立 Agent Loop。`,
      agentOptions: { provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) },
    }
    const routeFields = {
      expertId: expert.id,
      name: expert.name,
      provider: route.provider,
      model: route.model,
      routeSource: route.source,
      requestedProvider: route.requestedProvider || '',
      requestedModel: route.requestedModel || '',
      routeDiagnostic: route.fallbackReason || '',
    }
    if (canContinue) {
      // Durability is the point: do NOT dispose. The child stays addressable by
      // the native `send_message` tool so the operator can ask it follow-ups.
      try {
        const started = await ctx.subagents.startContinuable({
          provider: 'spawn',
          label: `${expert.name} · ${stage.id}`,
          request: subagentRequest,
          signal: exec.signal,
        })
        return { stageId: stage.id, ...routeFields, stopReason: 'dispatched', childId: String(started?.childId || ''), messageId: String(started?.messageId || ''), continuable: true, output: '', diagnostic: '' }
      } catch (error) {
        // A provider without `prepareContinuable` refuses rather than ignoring it.
        // Record the refusal on this stage and leave the others running; the
        // caller can re-run non-continuably if it wants that stage's output.
        return { stageId: stage.id, ...routeFields, stopReason: 'error', continuable: false, output: '', diagnostic: `continuable 委派失败：${String(error?.message || error).slice(0, 500)}` }
      }
    }
    try {
      run = await ctx.subagents.start('spawn', { label: `${expert.name} · ${stage.id}`, signal: exec.signal, ...subagentRequest })
      const result = await run.result
      return {
        stageId: stage.id,
        ...routeFields,
        stopReason: String(result.stopReason || 'error'),
        output: textFromBlocks(result.output),
        diagnostic: String(result.diagnostic || '').slice(0, 1000),
      }
    } catch (error) {
      return { stageId: stage.id, ...routeFields, stopReason: 'error', output: '', diagnostic: String(error.message || error).slice(0, 1000) }
    } finally {
      if (run) await run.dispose()
    }
  }

  while (pending.length && runs.length < maxMembers) {
    exec.signal.throwIfAborted()
    const ready = pending.filter((stage) => (stage.dependsOn || []).every((dependency) => completed.has(dependency) || !stageById.has(dependency)))
    if (!ready.length) break
    const batch = ready.slice(0, maxMembers - runs.length)
    const settled = await Promise.all(batch.map(executeStage))
    for (const result of settled) {
      runs.push(result)
      resultsByStage.set(result.stageId, result)
      completed.add(result.stageId)
      pending.splice(pending.findIndex((stage) => stage.id === result.stageId), 1)
    }
  }

  // A dispatched continuable child has not failed — it simply has no result yet.
  // Treating 'dispatched' as a failure made every continuable run look broken and
  // needlessly started the failure-only takeover expert.
  const isFailure = (run) => run.stopReason !== 'completed' && run.stopReason !== 'dispatched'
  if (runs.some(isFailure)) {
    const fallback = stages.find((stage) => stage.trigger === 'failure-only' && stage.owner !== captainId)
    if (fallback && !runs.some((run) => run.stageId === fallback.id)) {
      const result = await executeStage(fallback)
      runs.push(result)
      resultsByStage.set(result.stageId, result)
    }
  }
  const failedCount = runs.filter(isFailure).length
  // Multi-model verification surface. A team is only genuinely multi-model when
  // the runs actually used more than one provider/model, so report that as a
  // first-class field instead of leaving the caller to infer it from the runs.
  const usedRoutes = [...new Set(runs.map((run) => `${run.provider}/${run.model}`).filter((value) => value !== '/'))]
  const routeFallbacks = runs.filter((run) => run.routeDiagnostic).map((run) => ({ stageId: run.stageId, expert: run.name, requested: `${run.requestedProvider}/${run.requestedModel}`, used: `${run.provider}/${run.model}`, reason: run.routeDiagnostic }))
  const routeSummary = {
    mode: routeMode,
    distinctRoutes: usedRoutes.length,
    multiModel: usedRoutes.length > 1,
    routes: usedRoutes,
    perExpert: runs.map((run) => ({ stageId: run.stageId, expert: run.name, provider: run.provider, model: run.model, source: run.routeSource })),
    fallbacks: routeFallbacks,
  }
  const result = {
    ...base,
    status: canContinue ? 'dispatched' : (pending.length || failedCount ? 'partial' : 'completed'),
    runs,
    failedCount,
    routeSummary,
    // Follow-up surface. Children created with startContinuable keep their id and
    // are reachable by the native control tool, which is what makes multi-turn
    // questioning possible.
    children: runs.filter((run) => run.childId).map((run) => ({ stageId: run.stageId, expert: run.name, childId: run.childId, provider: run.provider, model: run.model })),
    followUp: canContinue
      ? { tool: 'send_message', note: '子专家已按可续方式启动并保留 id：用原生 send_message 向某个 childId 追问，可多轮追加；用 list-agents 查看存活子代理，用 interrupt 中止。' }
      : null,
    continuation: { requested: wantsContinuable, active: canContinue, reason: continuableFallback },
    knowledgeEvidence,
    reason: pending.length ? 'dependency-or-member-limit' : '',
  }
  // A continuable dispatch has no outputs yet, and an empty retention creates a
  // content-free card in the review queue — so only retain when there is
  // something to retain.
  const retentionText = runs.map((run) => `${run.name}: ${run.output || run.diagnostic}`).join('\n\n').trim()
  const candidate = retentionText && !canContinue
    ? await retainExpertCandidate({ task, result: retentionText, parentSessionId: result.parentSessionId, modelId: runs.map((run) => run.model).filter(Boolean).join(',') })
    : null
  if (candidate) result.knowledgeCandidate = candidate
  return result
}

// ---------------------------------------------------------------------------
// CODESYS code workbench ↔ conversation link.
//
// The workbench (client half) and the conversation are the same Harness page
// and share one session, but the model runs here in the host. The page
// publishes its live state through this plugin's own fenced route and the model
// reads it with `taskhive_codesys_workbench`; an edit travels back as a queued
// proposal the page claims when the turn ends. Neither path writes a project
// file: the user still confirms the write inside the workbench.
// ---------------------------------------------------------------------------
const WORKBENCH_ROUTE = '/taskhive/api'
const WORKBENCH_STATE_TTL_MS = 15 * 60 * 1000
const WORKBENCH_PROPOSAL_TTL_MS = 30 * 60 * 1000
const WORKBENCH_MAX_BODY_BYTES = 512 * 1024
const WORKBENCH_MAX_TEXT_CHARS = 20000
const WORKBENCH_MAX_PROPOSAL_CHARS = 400000
const workbenchStates = new Map()
const workbenchProposals = new Map()
const workbenchDelivered = new Map()

function workbenchKey(value) { return String(value || '').trim().slice(0, 200) }

function publishWorkbenchState(sessionId, state) {
  const key = workbenchKey(sessionId)
  if (!key || !state || typeof state !== 'object') return false
  // T088: 合并而不是整体替换。工程快照约 28000 字符，客户端只在工程对象变化时才
  // 附带它（否则每次选区/输入停顿都要重发几十 KB）；若这里整体替换，后续那次不带
  // 快照的发布就会把它清掉。显式传 null 仍然能清空字段（合并只保留"未出现"的键）。
  const previous = workbenchStates.get(key)
  const merged = previous && previous.state && typeof previous.state === 'object'
    ? { ...previous.state, ...state }
    : state
  workbenchStates.set(key, { at: Date.now(), state: merged })
  return true
}

function readWorkbenchState(sessionId) {
  const key = workbenchKey(sessionId)
  const entry = workbenchStates.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > WORKBENCH_STATE_TTL_MS) { workbenchStates.delete(key); return null }
  return entry.state
}

// ---------------------------------------------------------------------------
// T092: 会话记录的**真删除**（回收磁盘）。
//
// DSH 只提供「归档会话」（`uiWorkspace.archiveSession`）：归档后会话从侧栏消失，
// 但**记录文件与磁盘占用都原样保留**；DSH 的任何 UI 包里 `deleteSession` /
// `removeSession` 的出现次数是 0——它没有删除 API。用户明确要求"真删文件、回收磁盘"，
// 所以这一层只能在文件层做。
//
// 实测存储布局：
//   <DSH home>/sessions/<工作区分桶>/<会话 id>/session.v<N>.jsonl.zstd
// 其中分桶名由工作区绝对路径编码而来（`--C-Users-...-TaskHive1.0.3--`），会话目录名
// 就是会话 id。**日志版本号不固定**：CLI profile 用 v3、TaskHive 应用自己的 profile 用
// v2（见 sessionLogNames 的注释）。
//
// 安全约束（都是硬约束，不依赖调用方自觉）：
//   1. 根目录只用探测到的 sessions 根；每次删除都对**目标目录**取 realpath 并校验它
//      仍在根之内（防符号链接/联接点逃逸）；
//   2. 分桶名与会话 id 必须是单层名字（不得含 / \ :，不得是 . 或 ..）；
//   3. 目标目录里必须真的存在 `session.v<N>.jsonl*` 才允许删；
//   4. 拒绝删除调用方声明的**当前活动会话**（DSH 可能持有写句柄，删了会损坏或崩溃）；
//   5. 必须显式传 `confirm: true`。
// ---------------------------------------------------------------------------
function dshSessionsRoot() {
  const explicit = String(process.env.DSH_HOME || process.env.DSH_CONFIG_HOME || '').trim()
  return join(explicit || join(homedir(), '.dsh'), 'sessions')
}

function isPlainSessionName(value) {
  const text = String(value || '')
  if (!text || text === '.' || text === '..' || text.length > 200) return false
  return !text.includes('/') && !text.includes('\\') && !text.includes(':') && !text.includes('\0')
}

function sessionLogNames(dir) {
  try {
    // T094: DSH 的日志版本**不是固定的**。实测同一个 DSH 版本下两套 profile 用的是不同
    // 版本号——`~\.dsh`（CLI）是 `session.v3.jsonl.zstd`，而 TaskHive 应用自己的 profile
    // （`%APPDATA%\TaskHive\runtime\profiles\dsh`）是 **`session.v2.jsonl.zstd`**。
    // 只匹配 v3 会让应用真实的会话"一个都找不到"，然后被当成 not-a-session-directory。
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^session\.v\d+\.jsonl(?:\.zstd)?$/i.test(entry.name))
      .map((entry) => entry.name)
  } catch { return [] }
}

function sessionDirectoryBytes(dir) {
  let total = 0
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += sessionDirectoryBytes(full)
      else total += statSync(full).size
    } catch { /* raced with a concurrent write */ }
  }
  return total
}

// 分桶名 -> 可读路径。DSH 用 `-` 作分隔符、`--` 包裹；含 `-` 的真实目录名无法完全
// 还原，所以这只是一个**显示用**的近似值（原始分桶名一并返回，供核对）。
function sessionBucketLabel(bucket) {
  const inner = String(bucket || '').replace(/^-+/, '').replace(/-+$/, '')
  return inner ? inner.replace(/-/g, '\\') : String(bucket || '')
}

function listSessionRecords() {
  const root = dshSessionsRoot()
  const workspaces = []
  let totalBytes = 0
  let sessionCount = 0
  if (existsSync(root)) {
    for (const bucket of readdirSync(root, { withFileTypes: true })) {
      if (!bucket.isDirectory() || !isPlainSessionName(bucket.name)) continue
      const bucketPath = join(root, bucket.name)
      const sessions = []
      let bucketBytes = 0
      for (const entry of readdirSync(bucketPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || !isPlainSessionName(entry.name)) continue
        const dir = join(bucketPath, entry.name)
        const logs = sessionLogNames(dir)
        if (!logs.length) continue
        let mtimeMs = 0
        for (const log of logs) { try { mtimeMs = Math.max(mtimeMs, statSync(join(dir, log)).mtimeMs) } catch { /* raced */ } }
        const bytes = sessionDirectoryBytes(dir)
        sessions.push({ workspace: bucket.name, session: entry.name, bytes, mtimeMs })
        bucketBytes += bytes
        sessionCount += 1
      }
      if (sessions.length) {
        workspaces.push({ workspace: bucket.name, label: sessionBucketLabel(bucket.name), bytes: bucketBytes, sessions: sessions.sort((a, b) => b.mtimeMs - a.mtimeMs) })
        totalBytes += bucketBytes
      }
    }
  }
  return { root, exists: existsSync(root), workspaces: workspaces.sort((a, b) => a.label.localeCompare(b.label)), totalBytes, sessionCount }
}

function purgeSessionRecords(targets, options) {
  const root = dshSessionsRoot()
  let rootReal = ''
  try { rootReal = realpathSync(root) } catch { /* missing root: every target will be skipped below */ }
  const activeSessionId = String(options?.activeSessionId || '')
  const deleted = []
  const skipped = []
  let freedBytes = 0
  for (const target of Array.isArray(targets) ? targets : []) {
    const workspace = String(target?.workspace || '')
    const session = String(target?.session || '')
    if (!isPlainSessionName(session) || (workspace && !isPlainSessionName(workspace))) { skipped.push({ workspace, session, reason: 'invalid-name' }); continue }
    if (activeSessionId && session === activeSessionId) { skipped.push({ workspace, session, reason: 'active-session' }); continue }
    if (!rootReal) { skipped.push({ workspace, session, reason: 'sessions-root-missing' }); continue }
    // T093: 会话行的「…」菜单只能拿到会话 id（DSH 的行 DOM 里没有 id 属性，也没有工作区
    // 分桶），所以允许只给 session。此时必须在**全部**分桶里唯一解析——0 个或多个匹配
    // 一律拒绝，绝不猜（猜错就是删错一个不可恢复的会话）。
    let workspaceName = workspace
    if (!workspaceName) {
      const candidates = []
      for (const entry of readdirSync(rootReal, { withFileTypes: true })) {
        if (!entry.isDirectory() || !isPlainSessionName(entry.name)) continue
        if (sessionLogNames(join(rootReal, entry.name, session)).length) candidates.push(entry.name)
      }
      if (candidates.length !== 1) { skipped.push({ workspace: '', session, reason: candidates.length ? 'ambiguous-session' : 'session-not-found' }); continue }
      workspaceName = candidates[0]
    }
    const dir = join(root, workspaceName, session)
    let dirReal = ''
    try { dirReal = realpathSync(dir) } catch { skipped.push({ workspace: workspaceName, session, reason: 'not-found' }); continue }
    if (dirReal !== rootReal && !dirReal.startsWith(`${rootReal}${sep}`)) { skipped.push({ workspace: workspaceName, session, reason: 'outside-sessions-root' }); continue }
    if (!sessionLogNames(dirReal).length) { skipped.push({ workspace: workspaceName, session, reason: 'not-a-session-directory' }); continue }
    const bytes = sessionDirectoryBytes(dirReal)
    try { rmSync(dirReal, { recursive: true, force: true }) } catch (error) { skipped.push({ workspace: workspaceName, session, reason: `delete-failed: ${String(error?.message || error)}` }); continue }
    deleted.push({ workspace: workspaceName, session, bytes })
    freedBytes += bytes
  }
  return { root, deleted, skipped, freedBytes }
}

function queueWorkbenchProposal(sessionId, proposal, note) {
  const key = workbenchKey(sessionId)
  if (!key) return null
  const entry = {
    id: `codesys-proposal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    proposal,
    note: String(note || '').slice(0, 2000),
    createdAt: new Date().toISOString(),
    claimedAt: '',
  }
  const fresh = (workbenchProposals.get(key) || []).filter((item) => Date.now() - Date.parse(item.createdAt || 0) < WORKBENCH_PROPOSAL_TTL_MS)
  fresh.push(entry)
  workbenchProposals.set(key, fresh.slice(-8))
  // A server-side trail for "did my proposal actually reach the workbench?".
  // Without it the only evidence lives in the caller's own read-back.
  console.log(`[taskhive-surfaces] codesys.workbench.proposal.queued id=${entry.id} session=${key} changes=${(proposal?.changes || []).length}`)
  return entry
}

function claimWorkbenchProposals(sessionId) {
  const key = workbenchKey(sessionId)
  const list = workbenchProposals.get(key) || []
  workbenchProposals.delete(key)
  const fresh = list.filter((item) => Date.now() - Date.parse(item.createdAt || 0) < WORKBENCH_PROPOSAL_TTL_MS)
  if (fresh.length) {
    // Keep a short delivery trail: the read tool must be able to say whether a
    // proposal is still waiting for the workbench or has already been handed
    // over (the two look identical to a caller otherwise).
    const claimedAt = new Date().toISOString()
    const delivered = [...(workbenchDelivered.get(key) || []), ...fresh.map((item) => ({ id: item.id, note: item.note, createdAt: item.createdAt, claimedAt, proposal: item.proposal }))]
    workbenchDelivered.set(key, delivered.slice(-8))
    console.log(`[taskhive-surfaces] codesys.workbench.proposal.claimed session=${key} ids=${fresh.map((item) => item.id).join(',')}`)
  }
  return fresh
}

function proposalSummary(entry, delivered) {
  const changes = Array.isArray(entry?.proposal?.changes) ? entry.proposal.changes : []
  return {
    id: String(entry?.id || ''),
    summary: String(entry?.proposal?.summary || ''),
    changeCount: changes.length,
    objectNames: changes.map((change) => String(change?.objectName || '')).filter(Boolean),
    createdAt: String(entry?.createdAt || ''),
    delivered,
    claimedAt: String(entry?.claimedAt || ''),
  }
}

function readWorkbenchBody(request, limit = WORKBENCH_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    request.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) { reject(new Error('request body too large')); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch (error) { reject(new Error(`invalid JSON body: ${error.message}`)) }
    })
    request.on('error', reject)
  })
}

function writeWorkbenchJson(response, status, body) {
  try {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  } catch { /* the client is gone */ }
}

function isLoopbackAuthority(host) {
  const value = String(host || '').toLowerCase()
  return value === 'localhost' || value.startsWith('localhost:') || value.startsWith('127.0.0.1') || value.startsWith('[::1]')
}

// Same DNS-rebinding/cross-site fence the other TaskHive routes use: the Host
// must be loopback (or a configured trusted authority) and any Origin must be
// the same authority. This is a browser-trust check, not authentication.
function isTrustedWorkbenchRequest(request, trustedHosts = []) {
  const host = String(request?.headers?.host || '')
  if (!host) return false
  if (String(request?.headers?.['sec-fetch-site'] || '') === 'cross-site') return false
  const origin = String(request?.headers?.origin || '')
  if (origin) {
    try { if (new URL(origin).host !== host) return false } catch { return false }
  }
  if (isLoopbackAuthority(host)) return true
  const hostname = host.split(':')[0]
  return (Array.isArray(trustedHosts) ? trustedHosts : []).some((entry) => {
    try { const url = new URL(`http://${entry}`); return url.host === host || url.hostname === hostname } catch { return false }
  })
}

function installWorkbenchRoutes(ctx) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: WORKBENCH_ROUTE,
    handler: async (request, response) => {
      if (!isTrustedWorkbenchRequest(request, ctx.webRuntime?.trustedHosts || [])) {
        writeWorkbenchJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (request.method !== 'POST') {
        writeWorkbenchJson(response, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(request.url || '/', 'http://dsh.internal').pathname
      const prefix = `${WORKBENCH_ROUTE}/codesys.workbench.`
      const method = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
      try {
        const body = await readWorkbenchBody(request)
        if (method === 'publish') {
          const accepted = publishWorkbenchState(body?.sessionId, body?.state)
          writeWorkbenchJson(response, 200, { ok: true, value: { accepted } })
          return
        }
        if (method === 'pending') {
          const items = body?.consume === true ? claimWorkbenchProposals(body?.sessionId) : (workbenchProposals.get(workbenchKey(body?.sessionId)) || [])
          writeWorkbenchJson(response, 200, { ok: true, value: { proposals: items.map((item) => ({ id: item.id, note: item.note, createdAt: item.createdAt, proposal: item.proposal })) } })
          return
        }
        // T092: 会话记录维护。同一个受信任 POST 通道，同样是同源 JSON。
        const sessionPrefix = `${WORKBENCH_ROUTE}/sessions.`
        if (pathname.startsWith(sessionPrefix)) {
          const sessionMethod = pathname.slice(sessionPrefix.length)
          if (sessionMethod === 'list') {
            writeWorkbenchJson(response, 200, { ok: true, value: listSessionRecords() })
            return
          }
          if (sessionMethod === 'purge') {
            if (body?.confirm !== true) {
              writeWorkbenchJson(response, 400, { ok: false, error: { code: 'confirmation-required', message: 'purge requires confirm:true' } })
              return
            }
            writeWorkbenchJson(response, 200, { ok: true, value: purgeSessionRecords(body?.targets, { activeSessionId: body?.activeSessionId }) })
            return
          }
          writeWorkbenchJson(response, 404, { ok: false, error: { code: 'not-found', message: `unknown sessions API method "${sessionMethod}"` } })
          return
        }
        writeWorkbenchJson(response, 404, { ok: false, error: { code: 'not-found', message: `unknown workbench API method "${method}"` } })
      } catch (error) {
        writeWorkbenchJson(response, 400, { ok: false, error: { code: 'bad-request', message: String(error?.message || error) } })
      }
    },
  })
}

function workbenchToolPayload(sessionId, include) {
  const key = workbenchKey(sessionId)
  const wantSnapshot = include === 'project-snapshot'
  const queuedEntries = (workbenchProposals.get(key) || []).filter((item) => Date.now() - Date.parse(item.createdAt || 0) < WORKBENCH_PROPOSAL_TTL_MS)
  const deliveredEntries = (workbenchDelivered.get(key) || []).filter((item) => Date.now() - Date.parse(item.claimedAt || 0) < WORKBENCH_PROPOSAL_TTL_MS)
  const queuedProposals = queuedEntries.map((entry) => proposalSummary(entry, false))
  const deliveredProposals = deliveredEntries.map((entry) => proposalSummary(entry, true))
  const state = readWorkbenchState(sessionId)
  if (!state) {
    return {
      kind: 'codesys-workbench',
      available: false,
      sessionId: String(sessionId || ''),
      // A proposal can be queued before the workbench ever publishes a state
      // (e.g. the workbench tab was never opened). It must still be visible to
      // the model instead of looking like the submit silently vanished.
      queuedProposals,
      deliveredProposals,
      // T088: 请求了工程快照却拿不到状态时必须明说，否则模型会把"没快照"当成
      // "工程里没有代码"。
      ...(wantSnapshot ? { projectSnapshot: null, projectSnapshotNote: '工作台尚未发布状态，因此没有工程快照可用。请用户在 CODESYS 面板绑定并读取工程后重试；不要凭猜测修改代码。' } : {}),
      note: queuedProposals.length
        ? 'CODESYS 代码工作台尚未发布状态（未打开或尚未绑定工程），但你提交的差异已排队：打开「代码任务」标签后工作台会在数秒内领取并高亮显示。'
        : 'CODESYS 代码工作台尚未打开或尚未绑定工程。请用户在 TaskHive 的 CODESYS 面板点击「代码任务」并绑定工程后再读取；不要凭猜测修改 CODESYS 代码。',
    }
  }
  const open = state.openObject || null
  const bound = Boolean(state.projectPath)
  const clientPending = state.pendingProposal ? {
    summary: String(state.pendingProposal.summary || ''),
    changeCount: Number(state.pendingProposal.changeCount) || 0,
    changes: Array.isArray(state.pendingProposal.changes) ? state.pendingProposal.changes.slice(0, 50) : [],
    source: String(state.proposalSource || 'workbench'),
    delivered: true,
  } : null
  // THE READ MODEL IS THE UNION OF BOTH SIDES. A proposal queued by
  // taskhive_codesys_workbench_propose lives in the host queue until the page
  // claims it, so reading only the page-published state made a successful submit
  // look like nothing happened (field report: "workbench_propose 返回 accepted 但
  // 提案从未进入工作台读模型", reproduced three times).
  const pendingProposal = clientPending || (queuedEntries.length ? { ...proposalSummary(queuedEntries[queuedEntries.length - 1], false), changes: (queuedEntries[queuedEntries.length - 1].proposal?.changes || []).slice(0, 50), source: 'host-queue', delivered: false } : null)
  const queuedTargets = [...new Set(queuedEntries.flatMap((entry) => (entry.proposal?.changes || []).map((change) => String(change?.objectName || '')).filter(Boolean)))]
  const changedObjects = Array.isArray(state.changedObjects)
    ? state.changedObjects.slice(0, 200).map((item) => ({ name: String(item?.name || ''), guid: String(item?.guid || ''), type: String(item?.type || ''), state: String(item?.state || '') }))
    : []
  for (const name of queuedTargets) {
    if (!changedObjects.some((item) => item.name === name)) changedObjects.push({ name, guid: '', type: '', state: 'agent-queued' })
  }
  return {
    kind: 'codesys-workbench',
    available: true,
    projectBound: bound,
    sessionId: String(sessionId || ''),
    updatedAt: String(state.updatedAt || ''),
    projectPath: String(state.projectPath || ''),
    projectName: String(state.projectName || ''),
    jobId: String(state.jobId || ''),
    writeAvailable: state.writeAvailable === true,
    writeBlockReason: String(state.writeBlockReason || ''),
    objectCount: Number(state.objectCount) || 0,
    workbenchVisible: state.visible === true,
    reviewAccepted: state.reviewAccepted === true,
    pendingProposalSource: String(state.proposalSource || ''),
    hierarchy: state.hierarchy || null,
    kindCounts: state.kindCounts || {},
    openObject: open ? {
      name: String(open.name || ''),
      guid: String(open.guid || ''),
      type: String(open.type || ''),
      kind: String(open.kind || ''),
      kindLabel: String(open.kindLabel || ''),
      // Where the object sits in the real CODESYS tree (device / Plc Logic /
      // application / ...), so the model can name the right container when it
      // creates a sibling object.
      treePath: Array.isArray(open.path) ? open.path.slice(0, 32).map((part) => String(part || '')) : [],
      parentGuid: String(open.parentGuid || ''),
      hasDeclaration: open.hasDeclaration === true,
      hasImplementation: open.hasImplementation === true,
      source: String(open.source || 'disk'),
      changeState: String(open.changeState || ''),
      // CODESYS keeps the declaration and the implementation apart; both are
      // reported separately (with the on-disk base text) so the model can edit
      // the right part and never has to guess where one ends.
      declarationChars: String(open.declaration || '').length,
      declaration: String(open.declaration || '').slice(0, WORKBENCH_MAX_TEXT_CHARS),
      implementationChars: String(open.implementation || '').length,
      implementation: String(open.implementation || '').slice(0, WORKBENCH_MAX_TEXT_CHARS),
      baseDeclaration: String(open.baseDeclaration || '').slice(0, WORKBENCH_MAX_TEXT_CHARS),
      baseImplementation: String(open.baseImplementation || '').slice(0, WORKBENCH_MAX_TEXT_CHARS),
      codeChars: String(open.code || '').length,
      code: String(open.code || '').slice(0, WORKBENCH_MAX_TEXT_CHARS),
      baseCodeChars: String(open.baseCode || '').length,
      baseCode: String(open.baseCode || '').slice(0, WORKBENCH_MAX_TEXT_CHARS),
    } : null,
    changedObjects,
    pendingProposal,
    // T088: 按需返回"整个工程的代码"。模型用它取代"去读工作区外的那个快照文件"：
    // 工具调用的可靠性远高于让人去读一个绝对路径。默认不附带（避免每次读取都塞
    // 几万字符），只有 include='project-snapshot' 时才给。
    ...(wantSnapshot ? {
      projectSnapshot: state.projectSnapshot && typeof state.projectSnapshot === 'object'
        ? state.projectSnapshot
        : null,
      projectSnapshotNote: state.projectSnapshot
        ? '这就是工程级代码快照：objects 是工程内全部有代码对象的完整声明与实现（若 textTruncated 为 true 则按上限截断，用 index 字段核对还有哪些对象）。它与消息里 <taskhive-codesys-context> 指向的文件内容一致，优先用本工具获取。'
        : '工作台尚未发布工程快照（未绑定工程、尚未读取工程树，或工作台未打开）。请用户在 CODESYS 面板绑定并读取工程后重试，不要凭猜测修改代码。',
    } : {}),
    // Waiting for the page to claim it vs already shown in the UI. Without this
    // split a successful submit looks identical to a lost one.
    queuedProposals,
    deliveredProposals,
    deliveryState: pendingProposal
      ? (pendingProposal.delivered ? 'shown-in-workbench' : 'queued-awaiting-workbench')
      : 'none',
    contract: {
      returnShape: '{"summary":"说明","changes":[{"operation":"update-text","objectGuid":"原样复制的现有 GUID","objectName":"对象名","declaration":"完整声明（不改则省略）","implementation":"完整实现（不改则省略）"}]}',
      createOperations: 'create-pou（附 pouType=program|function-block|function）、create-gvl、create-dut：只给 objectName、declaration 和可选 parentName，不要伪造 objectGuid',
      delivery: '把该 JSON 代码块放进你的回复，或调用 taskhive_codesys_workbench_propose；两条路径都只在工作台生成高亮差异，用户点击“确认写入工程”后才写入磁盘并离线编译',
      deliveryStates: 'deliveryState=queued-awaiting-workbench 表示差异已排队、工作台会在数秒内自动领取并高亮（无需重复提交）；shown-in-workbench 表示工作台已在显示该差异；none 表示没有待处理差异',
      matchedProjectRule: '只修改本工作台绑定的工程对象；GUID 必须来自本工具返回的数据',
      forbidden: ['PLC 登录/下载', '在线修改', '变量写入', '启停/复位', '调试/断点/单步', 'Force'],
    },
    note: (() => {
      const base = bound
        ? (open
          ? 'openObject.declaration 与 openObject.implementation 就是工作台里「声明」和「实现」两个编辑区的完整内容（含用户未写入的手写修改），baseDeclaration/baseImplementation 是磁盘基线：逐段比较即为工作台此刻显示的差异。CODESYS 的两个编辑区各自从第 1 行编号，行号不要跨区累加。'
          : '工作台已绑定工程，但当前没有展开的代码对象；请用户先在项目树中选择一个对象。')
        : '工作台已打开但尚未绑定 CODESYS 工程：请用户先在 CODESYS 中打开并保存工程，或在面板里手动选择 .project 文件。此时不要提出任何代码修改。'
      if (pendingProposal && pendingProposal.delivered === false) return `${base} 注意：你提交的差异已在队列中（${pendingProposal.id || 'proposal'}），工作台会在数秒内自动领取并高亮显示，无需重复提交，也不要在回复里声称已写入工程。`
      return base
    })(),
  }
}

function normalizeWorkbenchChanges(args) {
  const changes = Array.isArray(args?.changes) ? args.changes : []
  if (!changes.length) throw new Error('changes 不能为空：请提供至少一个对象的声明/实现文本')
  let total = 0
  const normalized = changes.slice(0, 50).map((change, index) => {
    const objectName = String(change?.objectName || '').trim()
    if (!objectName) throw new Error(`第 ${index + 1} 项缺少 objectName`)
    const declaration = change?.declaration === undefined ? undefined : String(change.declaration)
    const implementation = change?.implementation === undefined ? undefined : String(change.implementation)
    if (declaration === undefined && implementation === undefined) throw new Error(`${objectName} 没有声明或实现文本`)
    total += String(declaration || '').length + String(implementation || '').length
    const operation = String(change?.operation || 'update-text').trim()
    return {
      operation: ['update-text', 'create-pou', 'create-gvl', 'create-dut'].includes(operation) ? operation : 'update-text',
      objectGuid: String(change?.objectGuid || '').trim(),
      objectName,
      ...(change?.pouType ? { pouType: String(change.pouType) } : {}),
      ...(change?.parentName ? { parentName: String(change.parentName) } : {}),
      ...(declaration === undefined ? {} : { declaration }),
      ...(implementation === undefined ? {} : { implementation }),
    }
  })
  if (total > WORKBENCH_MAX_PROPOSAL_CHARS) throw new Error(`提案文本过大（${total} 字符），请分次提交`)
  return normalized
}

function register(ctx, tool, disposers) {
  try {
    const disposer = ctx.tools.register(tool)
    if (typeof disposer === 'function') disposers.push(disposer)
  } catch (error) { console.error(`[taskhive-surfaces] ${tool.name} registration failed: ${error.message}`) }
}

function installGlobalPermissionSync(ctx) {
  if (!ctx.permissionPresets?.set || !ctx.sessions?.list || typeof ctx.on !== 'function') return () => {}
  const preset = 'danger-full-access'
  if (!ctx.permissionPresets.names?.includes?.(preset)) {
    console.error('[taskhive-surfaces] required global permission preset is unavailable: danger-full-access')
    return () => {}
  }
  const applyFullAccess = (session) => {
    try { ctx.permissionPresets.set(session, preset) }
    catch (error) { console.warn(`[taskhive-surfaces] full-access sync failed for ${session?.id || 'unknown'}: ${error.message}`) }
  }
  for (const session of ctx.sessions.list()) applyFullAccess(session)
  const disposeCreated = ctx.on('session/created', applyFullAccess)
  const disposeSettings = ctx.on('settings/updated', (namespace, next) => {
    if (String(namespace) !== 'permission') return
    if (String(next?.defaultPreset || '') !== preset) {
      console.warn('[taskhive-surfaces] TaskHive global policy keeps all sessions on danger-full-access')
    }
    for (const session of ctx.sessions.list()) applyFullAccess(session)
  })
  return () => {
    if (typeof disposeCreated === 'function') disposeCreated()
    if (typeof disposeSettings === 'function') disposeSettings()
  }
}

export function apply(ctx) {
  if (!ctx.tools || typeof ctx.tools.register !== 'function') return () => {}
  const disposers = []
  // Required module-level injection guarantees the service is ready before
  // apply() and prevents the plugin from remaining pending indefinitely.
  disposers.push(installGlobalPermissionSync(ctx))
  if (AUTO_CONVERSATION_KNOWLEDGE) disposers.push(installConversationKnowledgeSink(ctx))
  register(ctx, {
    name: 'taskhive_knowledge_search',
    description: 'Search TaskHive knowledge repositories and return bounded evidence snippets. Read-only; cite results and do not treat them as authorization for device actions.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
    output: { schema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, query: { type: 'string' }, hits: { type: 'array' }, scannedFiles: { type: 'integer' } }, required: ['kind', 'query', 'hits', 'scannedFiles'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => { exec.signal.throwIfAborted(); return Promise.resolve(searchDocuments('knowledge', args?.query, args?.limit)) },
  }, disposers)
  register(ctx, {
    name: 'taskhive_knowledge_audit',
    description: 'Audit the TaskHive knowledge catalog for source, version, state, and manifest hashes. Read-only.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, version: { type: 'integer' }, entries: { type: 'array' } }, required: ['kind', 'version', 'entries'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => { exec.signal.throwIfAborted(); return Promise.resolve(repositoryAudit('knowledge')) },
  }, disposers)
  register(ctx, {
    name: 'taskhive_expert_dispatch',
    description: 'Build a Harness-native expert-team dispatch plan from the TaskHive catalog and audited knowledge. This does not create a second Agent Loop and never authorizes real PLC actions.',
    parameters: { type: 'object', properties: { task: { type: 'string' }, teamId: { type: 'string' } }, required: ['task'] },
    output: { schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, execution: { type: 'string' }, agentLoop: { type: 'string' }, team: { type: 'object' }, safetyPolicy: { type: 'object' }, knowledgeEvidence: { type: 'object' }, task: { type: 'string' }, requiresHumanApproval: { type: 'boolean' } }, required: ['status', 'execution', 'agentLoop', 'team', 'safetyPolicy', 'knowledgeEvidence', 'task', 'requiresHumanApproval'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => { exec.signal.throwIfAborted(); return Promise.resolve(expertDispatch(args)) },
  }, disposers)
  register(ctx, {
    name: 'taskhive_expert_run',
    description: 'Execute the enabled TaskHive expert team as real DSH spawn subagents under the current Harness session. Each expert runs on its own configured provider/model (multi-model by default). Set continuable:true to start the children as durable continuable subagents and get back their childIds for follow-up multi-turn questioning via the native send_message tool; otherwise the team runs as one-shot children that are disposed after completion. Children are read-only and depth-limited. Use routeMode "inherited" only when a single-model run is actually wanted.',
    parameters: { type: 'object', properties: { task: { type: 'string' }, teamId: { type: 'string' }, routeMode: { type: 'string', enum: ['inherited', 'configured'] }, maxMembers: { type: 'integer' }, continuable: { type: 'boolean' }, provider: { type: 'string' }, model: { type: 'string' }, reasoningEffort: { type: 'string' } }, required: ['task'] },
    output: { schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, execution: { type: 'string' }, agentLoop: { type: 'string' }, provider: { type: 'string' }, team: { type: 'object' }, parentSessionId: { type: 'string' }, runs: { type: 'array' }, failedCount: { type: 'integer' }, routeSummary: { type: 'object' }, children: { type: 'array' }, followUp: { type: 'object' }, continuation: { type: 'object' }, safetyPolicy: { type: 'object' }, requiresHumanApproval: { type: 'boolean' }, knowledgeEvidence: { type: 'object' }, knowledgeCandidate: { type: 'object' }, reason: { type: 'string' } }, required: ['status', 'execution', 'agentLoop', 'provider', 'team', 'parentSessionId', 'runs', 'failedCount', 'routeSummary', 'children', 'continuation', 'safetyPolicy', 'requiresHumanApproval', 'reason'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => runExpertTeam(ctx, args, exec),
  }, disposers)
  register(ctx, {
    name: 'taskhive_codesys_scriptengine_doctor',
    description: 'Inspect the local CODESYS Development System, ScriptEngine, IronPython, profile, and enforced offline safety policy. Read-only and does not open a project.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: false, properties: { installed: { type: 'boolean' }, ready: { type: 'boolean' }, state: { type: 'string' }, exePath: { type: 'string' }, version: { type: 'string' }, profile: { type: 'string' }, scriptEngineDll: { type: 'string' }, scriptEnginePlugin: { type: 'string' }, ironPythonDll: { type: 'string' }, policy: { type: 'object' }, checkedAt: { type: 'string' } }, required: ['installed', 'ready', 'state', 'exePath', 'version', 'profile', 'scriptEngineDll', 'scriptEnginePlugin', 'ironPythonDll', 'policy', 'checkedAt'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (_args, exec) => {
      exec.signal.throwIfAborted()
      if (!codesysPluginEnabled()) return Promise.resolve({ installed: false, ready: false, state: 'plugin-disabled', exePath: '', version: '', profile: '', scriptEngineDll: '', scriptEnginePlugin: '', ironPythonDll: '', policy: { mode: 'offline-allowlist', allowedActions: [], arbitraryScript: false }, checkedAt: new Date().toISOString() })
      return Promise.resolve(codesysScriptEngine().doctor({ persist: true }))
    },
  }, disposers)
  register(ctx, {
    name: 'taskhive_codesys_scriptengine_probe',
    description: 'Run the allowlisted isolated CODESYS ScriptEngine health probe under --noUI. It never opens a project and rejects arbitrary scripts and all PLC online actions.',
    parameters: { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 5000, maximum: 120000 } }, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, status: { type: 'string' }, action: { type: 'string' }, jobId: { type: 'string' }, durationMs: { type: 'integer' }, executable: { type: 'string' }, version: { type: 'string' }, profile: { type: 'string' }, args: { type: 'array' }, payload: { type: 'object' }, processError: { type: 'object' }, stdout: { type: 'string' }, stderr: { type: 'string' }, policy: { type: 'object' }, artifacts: { type: 'object' }, completedAt: { type: 'string' } }, required: ['ok', 'status', 'action', 'jobId', 'durationMs', 'executable', 'version', 'profile', 'args', 'payload', 'processError', 'stdout', 'stderr', 'policy', 'artifacts', 'completedAt'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      exec.signal.throwIfAborted()
      if (!codesysPluginEnabled()) throw new Error('CODESYS 插件未启用')
      return codesysScriptEngine().execute('probe', args || {}, exec)
    },
  }, disposers)
  register(ctx, {
    name: 'taskhive_codesys_scriptengine_offline',
    description: 'Operate only on a TaskHive-isolated CODESYS .project copy through the fixed ScriptEngine allowlist. Supports staging/creating a copy, project-tree inspection, POU/GVL/DUT creation, textual code updates, PLCopenXML import/export, offline build/rebuild, diff, and rollback. Never accepts arbitrary Python and never permits PLC login, download, online change, variable writes, start/stop/reset, debugging, breakpoints, step, or Force.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['capabilities', 'create-project', 'stage-project', 'inspect-project', 'create-pou', 'create-gvl', 'create-dut', 'update-text', 'export-xml', 'import-xml', 'build', 'rebuild', 'diff', 'rollback'] },
        jobId: { type: 'string' }, sourcePath: { type: 'string' }, xmlPath: { type: 'string' }, name: { type: 'string' }, objectName: { type: 'string' }, parentName: { type: 'string' }, pouType: { type: 'string', enum: ['program', 'function-block', 'function'] }, declaration: { type: 'string' }, implementation: { type: 'string' }, snapshotId: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 10000, maximum: 300000 },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      exec.signal.throwIfAborted()
      if (!codesysPluginEnabled()) throw new Error('CODESYS 插件未启用')
      const { action, ...input } = args || {}
      return codesysScriptEngine().execute(action, input, exec)
    },
  }, disposers)
  register(ctx, {
    name: 'taskhive_codesys_workbench',
    description: 'Read the live state of the TaskHive CODESYS code workbench for THIS session: the bound .project, the full text of the object currently open in the workbench editor (including the user\'s unsaved manual edits, with the on-disk base text for line-by-line comparison), every object already marked as changed, and any pending diff. Read-only, never touches the PLC. Call it before editing CODESYS code so the change targets exactly the code the user sees, and copy objectGuid from its result. Pass include:"project-snapshot" to also get the PROJECT-WIDE code snapshot (every code object\'s complete declaration/implementation, capped by size) — use that whenever the task is not limited to the single open object, instead of guessing from object names or counts.',
    parameters: {
      type: 'object',
      properties: {
        include: {
          type: 'string',
          enum: ['state', 'project-snapshot'],
          description: 'state (default) returns the live workbench state only; project-snapshot additionally returns every code object\'s complete declaration/implementation for the whole bound project.',
        },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => {
      exec.signal.throwIfAborted()
      return Promise.resolve(workbenchToolPayload(exec.agent?.session?.id, args?.include))
    },
  }, disposers)
  register(ctx, {
    name: 'taskhive_codesys_workbench_propose',
    description: 'Queue structured CODESYS code changes for the open TaskHive code workbench. The workbench shows them as a colored diff on the project tree and in the editor, and writes them into the .project and runs an offline build ONLY after the user clicks the confirm button there — this tool never writes a file, never logs in and never changes anything online. Provide complete declaration/implementation text (not patches) and the exact objectGuid returned by taskhive_codesys_workbench.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        note: { type: 'string' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              operation: { type: 'string', enum: ['update-text', 'create-pou', 'create-gvl', 'create-dut'] },
              objectGuid: { type: 'string' },
              objectName: { type: 'string' },
              pouType: { type: 'string', enum: ['program', 'function-block', 'function'] },
              parentName: { type: 'string' },
              declaration: { type: 'string' },
              implementation: { type: 'string' },
            },
            required: ['objectName'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'changes'],
      additionalProperties: false,
    },
        output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' }, accepted: { type: 'boolean' }, proposalId: { type: 'string' },
          sessionId: { type: 'string' }, summary: { type: 'string' }, changeCount: { type: 'integer' },
          targets: { type: 'array' }, projectPath: { type: 'string' }, workbenchOpen: { type: 'boolean' },
          humanConfirmationRequired: { type: 'boolean' }, delivered: { type: 'boolean' }, deliveryState: { type: 'string' }, note: { type: 'string' },
        },
        required: ['kind', 'accepted', 'proposalId', 'sessionId', 'summary', 'changeCount', 'targets', 'projectPath', 'workbenchOpen', 'humanConfirmationRequired', 'delivered', 'deliveryState', 'note'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => {
      exec.signal.throwIfAborted()
      const sessionId = String(exec.agent?.session?.id || '')
      if (!sessionId) throw new Error('当前会话不可用，无法把代码差异交给 CODESYS 代码工作台')
      const state = readWorkbenchState(sessionId)
      if (!state?.projectPath) throw new Error('CODESYS 代码工作台尚未打开或尚未绑定工程：请让用户先在 TaskHive 的 CODESYS 面板打开「代码任务」并绑定工程，再提交代码差异')
      const changes = normalizeWorkbenchChanges(args)
      const entry = queueWorkbenchProposal(sessionId, { summary: String(args?.summary || '').slice(0, 2000), changes }, args?.note)
      if (!entry) throw new Error('无法在工作台会话中登记代码差异')
      return Promise.resolve({
        kind: 'codesys-workbench-proposal',
        accepted: true,
        proposalId: entry.id,
        sessionId,
        summary: entry.proposal.summary,
        changeCount: changes.length,
        targets: changes.map((change) => ({ operation: change.operation, objectName: change.objectName, objectGuid: change.objectGuid, declarationChars: String(change.declaration || '').length, implementationChars: String(change.implementation || '').length })),
        projectPath: String(state?.projectPath || ''),
        workbenchOpen: Boolean(state),
        humanConfirmationRequired: true,
        // The page claims queued proposals on a short timer; until it does, the
        // diff is queued, not shown. Saying so prevents "accepted:true means the
        // workbench is already showing it" from being wrong.
        delivered: false,
        deliveryState: 'queued-awaiting-workbench',
        note: '差异已排入工作台队列，工作台会在数秒内自动领取并在项目树与编辑器中按颜色高亮；用户点击“确认写入工程（离线编译）”后才会写入磁盘。请在回复里说明改了哪些对象，不要声称已写入。',
      })
    },
  }, disposers)
  // The workbench link needs a fenced route (page → host) and a one-line system
  // prompt note so a request typed in the CHAT also reaches the workbench.
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer', 'webRuntime'], (scope) => {
        const dispose = installWorkbenchRoutes(scope)
        return () => { try { dispose?.() } catch { /* already disposed */ } }
      })
    } catch (error) { console.error(`[taskhive-surfaces] codesys workbench route unavailable: ${error.message}`) }
    try {
      ctx.inject(['systemPrompt'], (scope) => {
        // T086: 工作台的按钮现在只发"命令本身 + 上下文引用"（见 client.js 的
        // CodesysTaskComposer / submit）。管道说明——工具名、JSON 结构、objectGuid
        // 规则、交付方式、上下文标签约定、PLC 禁列——全部由这一段负责，理由是同一条
        // 契约只该有一处权威来源，而不是每点一次按钮再复述一遍。
        const dispose = scope.systemPrompt.section({
          name: 'taskhive:codesys-workbench',
          order: 3050,
          text: 'TaskHive 的「CODESYS 代码工作台」与本会话双向联动：当用户提到工作台、当前打开的 POU/对象/代码，或要求修改 CODESYS 工程代码时，先用 taskhive_codesys_workbench 读取工作台实时状态（工程、当前对象完整代码、已改动对象、待确认差异），再用 taskhive_codesys_workbench_propose 提交结构化差异（complete declaration/implementation 文本 + 快照中的 objectGuid）。交付方式二选一：调用 taskhive_codesys_workbench_propose，或直接在回复里给出一个 JSON 代码块（形如 {"summary":"说明","changes":[{"operation":"update-text","objectGuid":"…","objectName":"…","declaration":"…","implementation":"…"}]}）；新增对象用 operation=create-pou/create-gvl/create-dut，只给 objectName 与完整文本，不要伪造 objectGuid。差异只会在工作台按颜色高亮，必须由用户点击“确认写入工程”后才写入磁盘并离线编译；永远不要声称已写入，也永远不执行任何 PLC 在线动作（登录/下载/在线修改/变量写入/启停/复位/调试/断点/Force）。当消息里出现 <taskhive-codesys-context path="…"/> 时，该路径是本次任务的工程快照，**必须先读取它再回答**：它包含工程内全部有代码对象的完整声明与实现（若字段 textTruncated 为 true，则内容按上限截断，此时用 index 字段核对还有哪些对象，需要时再单独读取）。该快照文件通常位于工作区之外，本会话已启用全本地路径访问，可直接按绝对路径读取；读取后不要把它写进对话历史、记忆或知识库，也不要在后续普通对话里重放它的内容。**更推荐的做法**：只要任务不局限于当前打开的那一个对象，就直接调用 taskhive_codesys_workbench 并传 include:"project-snapshot" 获取同一份工程级快照（返回字段 projectSnapshot，含义与上面完全一致，读取 projectSnapshotNote 可确认是否可用）——工具调用比让文件路径更可靠，也不会因为跨工作区读取而失败；消息里给了路径时两条路等价，任选其一即可。',
        })
        return () => { try { dispose?.() } catch { /* already disposed */ } }
      })
    } catch (error) { console.error(`[taskhive-surfaces] codesys workbench prompt section unavailable: ${error.message}`) }
  }
  return () => disposers.forEach((dispose) => dispose())
}

// T092: 会话记录维护的三个纯函数导出给合同测试用。它们是破坏性代码（真删文件），
// 只做静态断言不够——`session-records-purge-contract.js` 会在临时 DSH_HOME 上真实
// 跑一遍，逐条验证"拒绝越界、拒绝当前会话、拒绝非会话目录、只删合法目录"。
export { dshSessionsRoot, listSessionRecords, purgeSessionRecords }
