'use strict'
// Contract: the flattened prompt budget must protect the NEWEST turn, and the
// assembled prompt must never exceed its total.
//
// The bug this pins down: each section spent its own cap independently, and their
// sum exceeded `totalChars` (tools 7000 + system 8000 + summary 4500 + recent
// 28000 > 44000). The closing clip was head-preserving, so it cut the prompt's
// TAIL — which is the user's current question. web-ai had the mirror image: one
// `.slice(-64000)` over a prompt whose HEAD is the system section, so an overflow
// dropped the system prompt instead of the oldest turns.
//
// Both are asserted as behaviour, not as source text: an overflowing prompt must
// still contain the current question (TaskHive routes) / the system section
// (web-ai), must keep the mandatory guard+protocol, and must stay within budget.
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PLUGIN = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js')
const TOTAL = 44000
const WEB_TOTAL = 64000

const CURRENT_QUESTION = 'CURRENT_QUESTION_SENTINEL_4a17'
const DROP_OLDEST_RECENT = 'DROP_ME_OLDEST_RECENT_9c02'
const OLDEST_RECENT_TAIL = 'OLDEST_RECENT_TAIL_MUST_BE_CLIPPED_7f11'
const GUARD = 'You are a subordinate model invoked by DeepSeek Harness/DSH.'
const PROTOCOL_MARK = /return exactly one JSON object/i

const pad = (length, marker = '') => `${marker}${'x'.repeat(Math.max(0, length - marker.length))}`
const tools = Array.from({ length: 24 }, (_, index) => ({
  name: `tool_${index}`,
  description: pad(320, `desc_${index}_`),
  parameters: { type: 'object', properties: { a: { type: 'string', description: pad(200) } } },
}))

async function startBridge() {
  return new Promise((resolve) => {
    const captured = []
    const server = http.createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        captured.push(body)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, text: 'BRIDGE_REPLY' }))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }))
  })
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-budget-'))
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  process.env.TASKHIVE_ROOT = root

  const bridge = await startBridge()
  process.env.TASKHIVE_WEB_AI_BRIDGE_URL = `http://127.0.0.1:${bridge.port}`
  process.env.TASKHIVE_WEB_AI_BRIDGE_TOKEN = 'test-token'

  const plugin = await import(pathToFileURL(PLUGIN).href)
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

  try {
    // ── clippedTail invariants ──────────────────────────────────────────────
    const tail = plugin.clippedTail(`HEAD_MARK${'y'.repeat(3000)}TAIL_MARK`, 1000)
    check('clippedTail keeps the newest end', tail.includes('TAIL_MARK') && !tail.includes('HEAD_MARK'), tail.slice(0, 40))
    check('clippedTail respects its limit', tail.length <= 1000, String(tail.length))
    check('clippedTail leaves short text untouched', plugin.clippedTail('short', 1000) === 'short')
    const tiny = plugin.clippedTail('z'.repeat(500), 10)
    check('clippedTail stays within a limit smaller than its notice', tiny.length <= 10, `${tiny.length}:${tiny}`)

    // ── TaskHive routes: the current question survives an overflowing prompt ─
    const older = Array.from({ length: 4 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: pad(800, `older_${index}_`) }] }))
    const recent = Array.from({ length: 7 }, (_, index) => ({
      role: index % 2 ? 'user' : 'assistant',
      // The oldest message of the window keeps a marker at EACH end: the budget
      // clips its tail, so only the tail marker proves the cap actually bit.
      content: [{ type: 'text', text: index === 0 ? `${DROP_OLDEST_RECENT}_${'x'.repeat(3800)}${OLDEST_RECENT_TAIL}` : pad(3900, `recent_${index}_`) }],
    }))
    // The sentinel sits at the very END of the newest message, which is exactly
    // what a head-preserving clip of the assembled prompt used to destroy.
    const question = { role: 'user', content: [{ type: 'text', text: pad(900, 'pasted_context_') + CURRENT_QUESTION }] }
    const messages = [...older, ...recent, question]

    const prompt = plugin.promptFor({ system: pad(20000, 'SYS_'), messages, tools })
    check('an overflowing prompt still carries the current question', prompt.includes(CURRENT_QUESTION), `len=${prompt.length}`)
    check('an overflowing prompt still carries the guard', prompt.includes(GUARD))
    check('an overflowing prompt still carries the protocol instruction', PROTOCOL_MARK.test(prompt))
    check('the assembled prompt never exceeds totalChars', prompt.length <= TOTAL, String(prompt.length))
    check('the window budget was actually applied', prompt.includes(DROP_OLDEST_RECENT) && !prompt.includes(OLDEST_RECENT_TAIL))

    // A huge ModLens block: `modlensContextFor` has no bound of its own, so the
    // vision section is capped like every other one. It must not be able to push
    // the system prompt or the user's current question out of the prompt.
    const visionHead = 'VISION_HEAD_MARK_a1'
    const visionTail = 'VISION_TAIL_MARK_b2'
    const bigVision = `${visionHead}${'v'.repeat(120000)}${visionTail}`
    const stressed = plugin.promptFor({ system: pad(20000, 'SYS_MARKER_STRESSED_'), messages, tools }, bigVision)
    check('a huge vision block stays within totalChars', stressed.length <= TOTAL, String(stressed.length))
    check('a huge vision block is truncated to its own budget', stressed.includes(visionHead) && !stressed.includes(visionTail))
    check('a huge vision block cannot displace the guard', stressed.includes(GUARD))
    check('a huge vision block cannot displace the protocol instruction', PROTOCOL_MARK.test(stressed))
    check('a huge vision block cannot displace the system prompt', stressed.includes('SYS_MARKER_STRESSED_'))
    check('a huge vision block cannot displace the current question', stressed.includes(CURRENT_QUESTION))

    // ── T090: a CODESYS task turn is REPLACED by the inlined snapshot ───────
    // Two defects pinned here:
    //   (a) the replacement dropped the user's own words, so the model got the
    //       project snapshot but no idea what was asked (not even the object name);
    //   (b) the file guard was `stat.size > 64 * 1024` BYTES while the client caps
    //       the snapshot at 28000 CHARACTERS — CJK is 3 bytes/char in UTF-8, so a
    //       Chinese-commented project produced a 60–84KB file, the reader returned
    //       '', and `if (!content) continue` dropped the ENTIRE current turn.
    const CODESYS_COMMAND_SENTINEL = 'CODESYS_COMMAND_SENTINEL_7b31'
    const jobRoot = path.join(root, 'workspaces', 'codesys-scriptengine', 'job-t090')
    fs.mkdirSync(jobRoot, { recursive: true })
    const snapshotFile = path.join(jobRoot, 'model-context.json')
    const codesysMessage = {
      role: 'user',
      content: [{ type: 'text', text: `审核工作台当前工程：${CODESYS_COMMAND_SENTINEL}\n<taskhive-codesys-context path="${snapshotFile}" />` }],
    }
    const codesysMessages = [...older, ...recent, codesysMessage]
    const codesysSystem = pad(20000, 'SYS_')

    // CJK-heavy but legal: ~24000 characters, ~72KB on disk (> the old 64KB byte cap).
    const cjkSnapshot = { projectPath: 'C:\\demo.project', selection: 'all-code-objects', objects: [{ name: 'PRG_1_SENTINEL', declaration: `(${'中文注释块'.repeat(4800)})` }] }
    fs.writeFileSync(snapshotFile, JSON.stringify(cjkSnapshot), 'utf8')
    const cjkBytes = fs.statSync(snapshotFile).size
    const codesysPrompt = plugin.promptFor({ system: codesysSystem, messages: codesysMessages, tools })
    check('a CODESYS task turn keeps the user command', codesysPrompt.includes(CODESYS_COMMAND_SENTINEL), `len=${codesysPrompt.length}`)
    check('a CODESYS task turn inlines the project snapshot', codesysPrompt.includes('CODESYS TEMPORARY TASK CONTEXT') && codesysPrompt.includes('PRG_1_SENTINEL'))
    check('a CJK-heavy snapshot is not rejected for its byte size', cjkBytes > 64 * 1024 && codesysPrompt.includes('PRG_1_SENTINEL'), `bytes=${cjkBytes}`)
    check('the CODESYS prompt stays within totalChars', codesysPrompt.length <= TOTAL, String(codesysPrompt.length))

    // Over-limit snapshot: the snapshot may be dropped, the user's command may not.
    fs.writeFileSync(snapshotFile, JSON.stringify({ objects: [{ name: 'HUGE', declaration: 'x'.repeat(60000) }] }), 'utf8')
    const overLimitPrompt = plugin.promptFor({ system: codesysSystem, messages: codesysMessages, tools })
    check('an over-limit snapshot still keeps the user command', overLimitPrompt.includes(CODESYS_COMMAND_SENTINEL), `len=${overLimitPrompt.length}`)
    check('an unreadable snapshot never empties the turn', !/USER REQUEST:\s*\n/.test(overLimitPrompt))

    // ── web-ai: the system section survives its own overflow ────────────────
    const webMessages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: [{ type: 'text', text: pad(4000, index === 29 ? 'WEB_NEWEST_' : `web_${index}_`) }],
    }))
    const adapter = new plugin.WebAiAdapter()
    for await (const _chunk of adapter.stream({ model: 'deepseek-web', system: 'SYS_MARKER_WEB_5e81', messages: webMessages })) { /* drain */ }
    const sent = JSON.parse(bridge.captured.at(-1) || '{}')
    const webPrompt = String(sent.prompt || '')
    check('web-ai keeps the system section under overflow', webPrompt.includes('SYS_MARKER_WEB_5e81'), `len=${webPrompt.length}`)
    check('web-ai keeps the newest turn under overflow', webPrompt.includes('WEB_NEWEST_'))
    check('web-ai drops the oldest turns instead', !webPrompt.includes('web_0_'))
    check('the web prompt never exceeds its total', webPrompt.length <= WEB_TOTAL, String(webPrompt.length))
  } finally {
    bridge.server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }

  for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  <- ${item.detail}`}`)
  const failed = checks.filter((item) => !item.ok)
  console.log(failed.length ? `${failed.length}/${checks.length} checks failed` : `all ${checks.length} checks passed`)
  process.exitCode = failed.length ? 1 : 0
}

main().catch((error) => {
  console.error(`prompt budget contract failed: ${error?.stack || error}`)
  process.exitCode = 1
})
