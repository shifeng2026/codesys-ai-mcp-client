'use strict'
// Contract: reasoning never enters a prompt.
//
// Why this needs a test rather than a comment: DSH's session projection replays
// assistant messages verbatim (`dsh-session` `deriveEventMessage` returns
// `event.data.message` unchanged), so every block in the session becomes input to
// the next turn. TaskHive's own adapters no longer emit reasoning blocks at all,
// but a route DSH serves natively (`llm-pi-ai`) persists the provider's thinking
// into the same history. Every TaskHive adapter rebuilds its prompt by flattening
// that history, and both flattening paths share one helper:
//   - `textForPrompt` -> `textOfBlock`, used by `promptFor` for the Codex,
//     Claude, catalog API, and Anthropic routes;
//   - the web-ai adapter's own message builder, which also maps `textOfBlock`.
// Because `PROMPT_BUDGET` caps the prompt in CHARACTERS, an accidentally
// replayed reasoning block does not merely make the request longer — it evicts
// real conversation from the window. So the isolation is asserted on both paths,
// while web-ai's status row (its only remaining reasoning-shaped output, and the
// only adapter that emits one) is asserted to survive.
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const PLUGIN = path.join(__dirname, '..', 'plugins', 'installed', 'taskhive-codex-model', 'dsh', 'index.js')

const REASONING = 'REASONING_MUST_NOT_BE_REPLAYED_7f3a'
const ANSWER = 'ANSWER_TEXT_VISIBLE_1b9c'
const USER_TEXT = 'USER_TURN_TEXT_5d2e'

function startBridge() {
  return new Promise((resolve) => {
    const captured = []
    const server = http.createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        captured.push({ authorization: request.headers.authorization, body })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, text: 'BRIDGE_REPLY_TEXT' }))
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, captured, port: server.address().port }))
  })
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-reasoning-'))
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  process.env.TASKHIVE_ROOT = root

  const bridge = await startBridge()
  process.env.TASKHIVE_WEB_AI_BRIDGE_URL = `http://127.0.0.1:${bridge.port}`
  process.env.TASKHIVE_WEB_AI_BRIDGE_TOKEN = 'test-token'

  const plugin = await import(pathToFileURL(PLUGIN).href)
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

  // An assistant turn as DSH replays it: the reasoning block an adapter emitted
  // for the Think row, followed by the visible answer.
  const history = [
    { role: 'assistant', content: [{ type: 'reasoning', text: REASONING }, { type: 'text', text: ANSWER }] },
    { role: 'user', content: [{ type: 'text', text: USER_TEXT }] },
  ]

  try {
    // 1. The shared helper itself.
    check('textOfBlock drops a reasoning block', plugin.textOfBlock({ type: 'reasoning', text: REASONING }) === '')
    check('textOfBlock still passes visible text through', plugin.textOfBlock({ type: 'text', text: ANSWER }) === ANSWER)
    check('textOfBlock still flattens a tool call',
      plugin.textOfBlock({ type: 'tool-call', name: 'read_file', arguments: '{"p":1}' }).includes('read_file'))
    check('textOfBlock still flattens a tool result',
      plugin.textOfBlock({ type: 'tool-result', content: [{ type: 'text', text: 'RESULT_MARK' }] }).includes('RESULT_MARK'))
    check('textOfBlock tolerates junk input',
      plugin.textOfBlock(null) === '' && plugin.textOfBlock('nope') === '' && plugin.textOfBlock({ type: 'image' }) === '')

    // 2. The CLI/API prompt path (Codex, Claude, catalog API, Anthropic).
    const prompt = plugin.promptFor({ system: 'SYS', messages: history })
    check('promptFor never replays reasoning', !prompt.includes(REASONING), prompt.slice(0, 200))
    check('promptFor still carries the visible assistant answer', prompt.includes(ANSWER))
    // Guards against "the whole assistant turn was dropped" passing the check above.
    check('promptFor still frames the assistant turn', prompt.includes('ASSISTANT:'))
    check('promptFor still carries the user turn', prompt.includes(USER_TEXT))

    // 3. The web-ai prompt path, end to end through its own message builder.
    const adapter = new plugin.WebAiAdapter()
    const chunks = []
    for await (const chunk of adapter.stream({ model: 'deepseek-web', system: 'SYS', messages: history })) chunks.push(chunk)

    const sent = bridge.captured[0]
    check('web-ai reached the bridge with its token', sent?.authorization === 'Bearer test-token', String(sent?.authorization))
    const sentBody = JSON.parse(sent?.body || '{}')
    check('web-ai never replays reasoning in its prompt', !String(sentBody.prompt || '').includes(REASONING), String(sentBody.prompt || '').slice(0, 200))
    check('web-ai still sends the visible assistant answer', String(sentBody.prompt || '').includes(ANSWER))
    check('web-ai still frames the assistant turn', String(sentBody.prompt || '').includes('ASSISTANT:'))

    // 4. The display half must survive the isolation half.
    check('web-ai still emits a reasoning block for the Think row',
      chunks.some((chunk) => chunk.type === 'block-start' && chunk.blockType === 'reasoning'))
    check('web-ai still streams reasoning deltas',
      chunks.some((chunk) => chunk.type === 'reasoning-delta' && String(chunk.text || '').length > 0))
    check('web-ai still emits the visible answer as a text block',
      chunks.some((chunk) => chunk.type === 'text-delta' && chunk.text === 'BRIDGE_REPLY_TEXT'))
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
  console.error(`reasoning context isolation contract failed: ${error?.stack || error}`)
  process.exitCode = 1
})
