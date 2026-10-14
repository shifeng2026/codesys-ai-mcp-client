// 后台上下文契约：**不允许自动跑**的后台行为必须保持关闭。
//
// 历史：本文件最初同时守护 distill（自动复盘）与 dsh-mnemon（记忆系统的自动召回/写回）。
// 用户后来明确要求把记忆系统**整体移除**（T135），所以 mnemon 相关断言已按 INV-3 反转：
// 不再检查它的抑制配置，而是检查它**彻底不存在**，且任何种子/生成产物都不得再引用它 ——
// 陈旧种子曾让"审查证据"与实际相反（patch 里还在 insert 一个已删除的插件）。
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const app = join(__dirname, '..')
const distill = readFileSync(join(app, 'plugins', 'installed', 'distill', 'lib', 'index.js'), 'utf8')
const profile = readFileSync(join(app, 'profiles', 'dsh', 'taskhive.patch.yml'), 'utf8')
const surfaces = readFileSync(join(app, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js'), 'utf8')
const mainSource = readFileSync(join(app, 'app', 'main.js'), 'utf8')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

// ── distill：自动复盘默认关闭（T019）────────────────────────────────────────
expect(distill.includes('enabled: z.boolean().default(false)'), 'distill must default to disabled')
expect(distill.includes('enabled: config.enabled ?? false'), 'distill fallback must default to disabled')
expect(/id: distill\s+name: '@loserfox\/distill'\s+config:\s+enabled: false/.test(profile), 'profile must explicitly disable distill')

// ── 记忆系统已整体移除（T135 / INV-3）───────────────────────────────────────
expect(!existsSync(join(app, 'plugins', 'installed', 'dsh-mnemon')), 'the memory plugin must stay removed')
expect(!/dsh-mnemon/.test(profile), 'the shipped patch must not insert the removed memory plugin')
expect(!/better-sidebar/.test(profile), 'the shipped patch must not insert the removed sidebar plugin')

// ── "沿用插件自己声明的 insert 配置"这一机制必须保留 ─────────────────────────
expect(mainSource.includes('const declaredInsertConfig = (packageDir) =>'), 'the generated patch must read each plugin declared insert config')
expect(mainSource.includes("const config = item.packageName === '@loserfox/distill' ? ['        enabled: false'] : declaredInsertConfig(item.dir)"), 'the insert row must merge the declared config instead of emitting it only for distill')
expect(mainSource.includes('const block = config.length ? `\\n      config:\\n${config.join(\'\\n\')}` : \'\''), 'the declared config must be written into the insert block')

// ── 对话知识自动入库仍然关闭（真正写 cards.json 的是外壳 repositories/manager.js）──
expect(surfaces.includes('const AUTO_CONVERSATION_KNOWLEDGE = false'), 'automatic conversation knowledge must be disabled')
expect(surfaces.includes('if (AUTO_CONVERSATION_KNOWLEDGE) disposers.push(installConversationKnowledgeSink(ctx))'), 'automatic knowledge sink must be gated')
console.log('background context contract passed')
