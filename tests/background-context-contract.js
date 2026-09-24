const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const app = join(__dirname, '..')
const distill = readFileSync(join(app, 'plugins', 'installed', 'distill', 'lib', 'index.js'), 'utf8')
const profile = readFileSync(join(app, 'profiles', 'dsh', 'taskhive.patch.yml'), 'utf8')
const mnemon = readFileSync(join(app, 'plugins', 'installed', 'dsh-mnemon', 'cordis.patch.yml'), 'utf8')
const surfaces = readFileSync(join(app, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js'), 'utf8')
const mainSource = readFileSync(join(app, 'app', 'main.js'), 'utf8')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

expect(distill.includes('enabled: z.boolean().default(false)'), 'distill must default to disabled')
expect(distill.includes('enabled: config.enabled ?? false'), 'distill fallback must default to disabled')
expect(/id: distill\s+name: '@loserfox\/distill'\s+config:\s+enabled: false/.test(profile), 'profile must explicitly disable distill')

// T020 previously looked satisfied because the plugin's own cordis.patch.yml
// declares the safe values — but that file is only layered for packages listed
// in `dsh.profile.bundles`, and dsh-mnemon is mounted through the generated
// insert row instead. Declaring the values is therefore not sufficient: the
// generated patch must actually carry them, or the plugin falls back to
// routingGuidance=true / recallMode="guided" / writebackMode="guided" and the
// 30 s idle auto-review runs again.
expect(mnemon.includes('routingGuidance: false'), 'mnemon must declare routing guidance disabled')
expect(mnemon.includes('recallMode: off'), 'mnemon must declare recall disabled')
expect(mnemon.includes('writebackMode: off'), 'mnemon must declare writeback disabled')
expect(mainSource.includes('const declaredInsertConfig = (packageDir) =>'), 'the generated patch must read each plugin declared insert config')
expect(mainSource.includes('const config = item.packageName === \'@loserfox/distill\' ? [\'        enabled: false\'] : declaredInsertConfig(item.dir)'), 'the insert row must merge the declared config instead of emitting it only for distill')
expect(mainSource.includes('const block = config.length ? `\\n      config:\\n${config.join(\'\\n\')}` : \'\''), 'the declared config must be written into the insert block')
// The shipped seed patch is what an unpackaged run boots from, and it is the
// artifact a reviewer reads. It must demonstrate the merge, not just the code.
expect(/id: dsh-mnemon\s+name: 'dsh-mnemon'\s+config:\s+routingGuidance: false/.test(profile), 'the shipped patch must carry the mnemon config, not only the plugin declaration')
expect(/id: dsh-mnemon[\s\S]*?recallMode: off/.test(profile), 'the shipped patch must disable mnemon recall')
expect(/id: dsh-mnemon[\s\S]*?writebackMode: off/.test(profile), 'the shipped patch must disable mnemon writeback')
expect(/id: dsh-mnemon[\s\S]*?policy: strict-v1/.test(profile), 'the shipped patch must keep the nested recallQuality block')
// The values that must survive the indentation-preserving extraction.
expect(/^\s+recallQuality:\s*$/m.test(mnemon), 'mnemon config includes a nested block that the extractor must keep')

expect(surfaces.includes('const AUTO_CONVERSATION_KNOWLEDGE = false'), 'automatic conversation knowledge must be disabled')
expect(surfaces.includes('if (AUTO_CONVERSATION_KNOWLEDGE) disposers.push(installConversationKnowledgeSink(ctx))'), 'automatic knowledge sink must be gated')
expect(surfaces.includes("const EXPERT_CONTEXT_BUDGET = Object.freeze({ taskChars: 4000, upstreamChars: 4000, knowledgeChars: 3000, knowledgeResults: 3 })"), 'expert context budgets must be bounded')
expect(surfaces.includes("searchDocuments('knowledge', task, EXPERT_CONTEXT_BUDGET.knowledgeResults)"), 'expert knowledge recall must use the bounded result count')

console.log('background context contract passed')
