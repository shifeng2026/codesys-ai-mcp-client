'use strict'
// Contract: the CLI routes never surface the model's thinking.
//
// TaskHive's adapters render exactly three things: the answer text, a tool-call
// block, and (web-ai only) a status row. Codex `exec --json` and Claude Code's
// streamed transcript both carry reasoning items, and the adapters read the same
// event stream that carries the answer — so this contract drives the REAL
// spawn/parse/emit path with a fake CLI that emits thinking and asserts it is
// ignored end to end:
//   1. No `reasoning` block is emitted, whatever the CLI sends.
//   2. The answer lands at block index 0, and thinking never leaks into it.
//   3. A CLI that REJECTS the streamed-JSON flags is retried once in the plain
//      envelope, while an unrelated failure (rate limit) is NOT retried — the
//      fallback has to stay narrow, or every failure would be double-charged.
//   4. A timed-out attempt is retried once (this install's gateway answers a
//      trivial prompt in 46s / 52s / 79s and sometimes past the cap), and the
//      abandoned attempt is killed before the retry starts.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PLUGIN = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js')

const CODEX_ANSWER = 'CODEX_ANSWER_MARK_7d21'
// Sent by the fake CLI as a cumulative pair (AB, then ABCDEF) so a leak into the
// answer would be visible as well as a doubled block.
const CODEX_REASONING = 'ABCDEF'
const CLAUDE_ANSWER = 'CLAUDE_ANSWER_MARK_3e94'
const CLAUDE_THINKING = 'CLAUDE_THINK_MARK_6b12'
const RETRY_ANSWER = 'RETRY_ANSWER_MARK_44c1'

const CODE_CLI = `'use strict'
const fs = require('node:fs')
const path = require('node:path')
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
process.stdin.on('data', () => {})
process.stdin.on('end', async () => {
  fs.appendFileSync(path.join(__dirname, 'count.log'), 'codex\\n')
  // Record the real argv so the test can assert what the adapter passed through.
  fs.appendFileSync(path.join(__dirname, 'args.log'), JSON.stringify(process.argv.slice(2)) + '\\n')
  // Thinking items are sent FIRST and in quantity: if any route still maps them,
  // they would take block index 0 and push the answer to index 1.
  emit({ type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'AB' } })
  emit({ type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: '${CODEX_REASONING}' } })
  emit({ type: 'item.completed', item: { id: 'r2', type: 'reasoning_summary', text: 'SUMMARY_TEXT' } })
  emit({ type: 'reasoning_delta', delta: 'DELTA_TEXT' })
  emit({ type: 'item.completed', item: { id: 'a1', type: 'agent_message', text: JSON.stringify({ type: 'final', text: '${CODEX_ANSWER}' }) } })
  // input/cached numbers copied verbatim from a real Codex CLI run.
  emit({ type: 'turn.completed', usage: { input_tokens: 13834, cached_input_tokens: 13056, cache_write_input_tokens: 0, output_tokens: 500, reasoning_output_tokens: 250 } })
})
`

const SLOW_CLI = `'use strict'
const fs = require('node:fs')
const path = require('node:path')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = path.join(__dirname, 'retry.log')
const runs = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0
fs.appendFileSync(log, runs + 1 + '\\n')
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
process.stdin.on('data', () => {})
process.stdin.on('end', async () => {
  // The FIRST attempt deliberately outlives the shortened request timeout; the
  // retry answers immediately. If the abandoned child were not killed it would
  // still be sleeping when this process is killed, so the run count is the proof.
  if (runs === 0) await wait(30000)
  emit({ type: 'item.completed', item: { id: 'a1', type: 'agent_message', text: JSON.stringify({ type: 'final', text: '${RETRY_ANSWER}' }) } })
  emit({ type: 'turn.completed', usage: { input_tokens: 11, cached_input_tokens: 0, output_tokens: 7 } })
})
`

const CLAUDE_CLI = `'use strict'
const fs = require('node:fs')
const path = require('node:path')
const mode = String(process.env.FAKE_CLAUDE_MODE || 'stream')
const streamed = process.argv.includes('stream-json')
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(__dirname, 'count.log'), 'claude:' + (streamed ? 'stream' : 'json') + '\\n')
  if (mode === 'rate-limited') {
    process.stderr.write('API error: rate limit exceeded\\n')
    process.exitCode = 1
    return
  }
  if (mode === 'reject-then-json' && streamed) {
    process.stderr.write("error: unknown option '--verbose'\\n")
    process.exitCode = 1
    return
  }
  if (streamed) {
    const content = mode === 'nothink' ? [] : [{ type: 'thinking', thinking: '${CLAUDE_THINKING}' }]
    content.push({ type: 'text', text: 'assistant text block that is not the answer' })
    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'sonnet' }) + '\\n')
    process.stdout.write(JSON.stringify({ type: 'assistant', message: { content } }) + '\\n')
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify({ type: 'final', text: '${CLAUDE_ANSWER}' }), usage: { input_tokens: 10, output_tokens: 20 } }) + '\\n')
    return
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify({ type: 'final', text: '${CLAUDE_ANSWER}' }), usage: { input_tokens: 10, output_tokens: 20 } }) + '\\n')
})
`

function writeCli(root, name, body) {
  const js = path.join(root, `${name}.js`)
  const cmd = path.join(root, `${name}.cmd`)
  fs.writeFileSync(js, body, 'utf8')
  fs.writeFileSync(cmd, `@echo off\r\nnode "%~dp0${name}.js" %*\r\n`, 'utf8')
  return cmd
}

const drain = async (iterable) => {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}
const blockIndexOf = (chunks, type) => chunks.find((chunk) => chunk.type === 'block-start' && chunk.blockType === type)?.index
const textOf = (chunks, type) => chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block?.type === type).map((chunk) => chunk.block.text).join('')
const usageOf = (chunks) => chunks.find((chunk) => chunk.type === 'usage')?.usage

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-cli-routes-'))
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  const countLog = path.join(root, 'count.log')
  const claudeRuns = () => (fs.existsSync(countLog) ? fs.readFileSync(countLog, 'utf8').split('\n').filter((line) => line.startsWith('claude:')) : [])
  const codexRuns = () => (fs.existsSync(countLog) ? fs.readFileSync(countLog, 'utf8').split('\n').filter((line) => line === 'codex') : [])

  process.env.TASKHIVE_ROOT = root
  process.env.TASKHIVE_CODEX_BIN = writeCli(root, 'fake-codex', CODE_CLI)
  process.env.TASKHIVE_CLAUDE_BIN = writeCli(root, 'fake-claude', CLAUDE_CLI)

  const plugin = await import(pathToFileURL(PLUGIN).href)
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'current question' }] }]

  try {
    // ── Codex CLI ───────────────────────────────────────────────────────────
    const codex = new plugin.CodexCliAdapter({})
    const argsLogPath = path.join(root, 'args.log')
    const codexArgs = () => (fs.existsSync(argsLogPath) ? fs.readFileSync(argsLogPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])
    const codexChunks = await drain(codex.stream({ model: 'gpt-5.5', messages, system: 'SYS', reasoningEffort: 'high' }))
    check('the Codex route shows no Think row even though the CLI sent reasoning',
      blockIndexOf(codexChunks, 'reasoning') === undefined, JSON.stringify(codexChunks.filter((chunk) => chunk.type === 'block-start')))
    check('the Codex answer keeps block index 0', blockIndexOf(codexChunks, 'text') === 0, String(blockIndexOf(codexChunks, 'text')))
    check('Codex reasoning never leaks into the answer', textOf(codexChunks, 'text') === CODEX_ANSWER, textOf(codexChunks, 'text'))
    check('no reasoning delta is emitted on the Codex route',
      codexChunks.every((chunk) => chunk.type !== 'reasoning-delta'), JSON.stringify(codexChunks.filter((chunk) => chunk.type === 'reasoning-delta')))
    check('the Codex route reports reasoning tokens', usageOf(codexChunks)?.reasoningTokens === 250, JSON.stringify(usageOf(codexChunks)))
    check('the Codex route ran once', codexRuns().length === 1, String(codexRuns().length))

    // ── Codex CLI: the picked effort must reach the CLI ─────────────────────
    check('the selected reasoning effort is passed to the CLI',
      codexArgs()[0]?.join(' ').includes('model_reasoning_effort=high'), JSON.stringify(codexArgs()[0]))
    await drain(codex.stream({ model: 'gpt-5.5', messages, system: 'SYS' }))
    check('no effort flag is invented when the caller picks none',
      !codexArgs()[1]?.join(' ').includes('model_reasoning_effort'), JSON.stringify(codexArgs()[1]))

    // ── Codex CLI: provider usage buckets ──────────────────────────────────
    const codexUsage = usageOf(codexChunks)
    check('the cached subset is split out of the input total',
      codexUsage.inputTokens === 778 && codexUsage.cacheReadTokens === 13056 && codexUsage.outputTokens === 500,
      JSON.stringify(codexUsage))
    check('splitting the buckets does not change the total',
      codexUsage.inputTokens + codexUsage.cacheReadTokens + (codexUsage.cacheWriteTokens || 0) + codexUsage.outputTokens === 13834 + 500,
      String(codexUsage.inputTokens + codexUsage.cacheReadTokens + codexUsage.outputTokens))

    // ── Codex CLI: the request timeout must fit a slow gateway ──────────────
    // Measured against this install's gateway: a trivial prompt took 46s / 52s / 79s
    // and repeatedly exceeded 100-150s, so the old 120s cap failed ordinary turns.
    check('the CLI request timeout leaves room for a slow gateway',
      Number.isFinite(plugin.MODEL_REQUEST_TIMEOUT_MS) && plugin.MODEL_REQUEST_TIMEOUT_MS >= 300000,
      String(plugin.MODEL_REQUEST_TIMEOUT_MS))
    check('the CLI request timeout is overridable per install',
      fs.readFileSync(PLUGIN, 'utf8').includes('TASKHIVE_MODEL_TIMEOUT_MS'))

    // ── Codex CLI: a timed-out attempt is retried, and the dead one is killed ─
    // A separate module instance (cache-busted import) so the shortened timeout is
    // read from the environment instead of affecting the runs above.
    process.env.TASKHIVE_MODEL_TIMEOUT_MS = '1500'
    process.env.TASKHIVE_MODEL_ATTEMPTS = '2'
    process.env.TASKHIVE_CODEX_BIN = writeCli(root, 'slow-codex', SLOW_CLI)
    const retryPlugin = await import(`${pathToFileURL(PLUGIN).href}?retry=1`)
    const retryLog = path.join(root, 'retry.log')
    const retryRuns = () => (fs.existsSync(retryLog) ? fs.readFileSync(retryLog, 'utf8').split('\n').filter(Boolean) : [])
    const retryStartedAt = Date.now()
    let retryError = null
    let retryChunks = []
    try {
      retryChunks = await drain(new retryPlugin.CodexCliAdapter({}).stream({ model: 'gpt-5.5', messages, system: 'SYS' }))
    } catch (error) { retryError = error }
    const retryElapsed = Date.now() - retryStartedAt
    check('a timed-out Codex attempt is retried instead of failing the turn',
      retryError === null && textOf(retryChunks, 'text') === RETRY_ANSWER,
      `${retryError?.code || 'ok'}/${textOf(retryChunks, 'text')}`)
    check('the retry is a second CLI run', retryRuns().length === 2, retryRuns().join(','))
    check('the abandoned attempt is killed, not waited out',
      retryElapsed < 20000, `${retryElapsed}ms`)
    check('the retried route still shows no Think row', blockIndexOf(retryChunks, 'reasoning') === undefined)
    delete process.env.TASKHIVE_MODEL_TIMEOUT_MS
    delete process.env.TASKHIVE_MODEL_ATTEMPTS
    process.env.TASKHIVE_CODEX_BIN = writeCli(root, 'fake-codex', CODE_CLI)

    // ── Claude Code: the streamed transcript ────────────────────────────────
    process.env.FAKE_CLAUDE_MODE = 'stream'
    const claude = new plugin.ClaudeCodeAdapter({})
    const claudeChunks = await drain(claude.stream({ model: 'sonnet', messages, system: 'SYS' }))
    check('the Claude route shows no Think row even though the transcript carried thinking',
      blockIndexOf(claudeChunks, 'reasoning') === undefined, JSON.stringify(claudeChunks.filter((chunk) => chunk.type === 'block-start')))
    check('the Claude answer comes from the result event', textOf(claudeChunks, 'text') === CLAUDE_ANSWER, textOf(claudeChunks, 'text'))
    check('the Claude answer keeps block index 0', blockIndexOf(claudeChunks, 'text') === 0, String(blockIndexOf(claudeChunks, 'text')))
    check('the Claude route asked for the streamed transcript', claudeRuns()[0] === 'claude:stream', claudeRuns()[0])

    // A transcript without thinking folds the same way.
    process.env.FAKE_CLAUDE_MODE = 'nothink'
    const claudeNoThink = await drain(claude.stream({ model: 'sonnet', messages, system: 'SYS' }))
    check('a thinking-free Claude transcript emits no Think row', blockIndexOf(claudeNoThink, 'reasoning') === undefined)
    check('a thinking-free Claude transcript keeps the answer at index 0', blockIndexOf(claudeNoThink, 'text') === 0, String(blockIndexOf(claudeNoThink, 'text')))

    // ── Claude Code: flag rejection falls back, real failures do not ────────
    process.env.FAKE_CLAUDE_MODE = 'reject-then-json'
    const before = claudeRuns().length
    const fellBack = await drain(claude.stream({ model: 'sonnet', messages, system: 'SYS' }))
    const fallbackRuns = claudeRuns().slice(before)
    check('a rejected flag set is retried in the plain envelope',
      fallbackRuns.length === 2 && fallbackRuns[0] === 'claude:stream' && fallbackRuns[1] === 'claude:json', fallbackRuns.join(','))
    check('the fallback still answers', textOf(fellBack, 'text') === CLAUDE_ANSWER, textOf(fellBack, 'text'))
    check('the fallback has no reasoning to show', blockIndexOf(fellBack, 'reasoning') === undefined)

    process.env.FAKE_CLAUDE_MODE = 'rate-limited'
    const beforeLimit = claudeRuns().length
    let limitError = null
    try { await drain(claude.stream({ model: 'sonnet', messages, system: 'SYS' })) } catch (error) { limitError = error }
    check('an unrelated Claude failure is classified, not retried',
      limitError?.code === 'RATE_LIMIT' && claudeRuns().length - beforeLimit === 1, `${limitError?.code}/${claudeRuns().length - beforeLimit}`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  <- ${item.detail}`}`)
  const failed = checks.filter((item) => !item.ok)
  console.log(failed.length ? `${failed.length}/${checks.length} checks failed` : `all ${checks.length} checks passed`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch((error) => {
  console.error(`CLI routes contract failed: ${error?.stack || error}`)
  process.exitCode = 1
})
