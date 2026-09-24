'use strict'

// 插件身份契约：CODESYS 工作台这个名字和它的图标，必须在**所有**显示插件身份的地方
// 同时存在。用户口径：「把插件名字改成 codesys 工作台，并且加入图标」。
//
// 这一条容易只改一半：侧栏按钮的名字取自插件 id（codesys-monitor），而顶栏标题取自
// surface id（codesys）—— 只改一处就会出现「侧栏叫 CODESYS 工作台、顶栏还写着 codesys」。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.resolve(appRoot, relative), 'utf8')

const EXPECTED_NAME = 'CODESYS 工作台'
const catalog = JSON.parse(read('plugins/catalog.json'))
const manifest = JSON.parse(read('plugins/installed/codesys-monitor/plugin.json'))
const renderer = read('app/renderer/renderer.js')
const overrides = read('app/renderer/ui-overrides.css')

// ── 1. 目录与清单里的名字 ────────────────────────────────────────────────────
const entry = catalog.plugins['codesys-monitor']
assert(entry, 'the catalog must still carry the codesys-monitor entry')
assert.strictEqual(entry.name, EXPECTED_NAME, 'the catalog name is what every UI reads')
assert.strictEqual(manifest.name, EXPECTED_NAME, 'the plugin manifest must agree with the catalog')

// ── 2. 侧栏按钮 + 顶栏标题 + 设置列表都用同一个名字 ─────────────────────────
assert(
  renderer.includes(`'codesys-monitor': '${EXPECTED_NAME}'`),
  'the sidebar button label (plugin id) must use the new name',
)
assert(
  renderer.includes(`codesys: '${EXPECTED_NAME}'`),
  'the top-bar title (surface id) must use the new name too — otherwise it shows the raw "codesys"',
)
// 顶栏标题就是 surfaceLabel(kind)，它查的是 pluginLabels[surface id]。
assert(
  renderer.includes("function surfaceLabel(kind) { return kind === 'chat' ? '主工作台' : (pluginLabels[kind] || kind); }"),
  'surfaceLabel must keep resolving through pluginLabels',
)

// ── 3. 图标：存在、是真正的 SVG、并且真的被渲染 ─────────────────────────────
const iconMatch = /const CODESYS_WORKBENCH_ICON = '([^']+)'/.exec(renderer)
assert(iconMatch, 'the workbench icon must be a named constant (so sidebar and lists share it)')
const icon = iconMatch[1]
assert(icon.startsWith('<svg') && icon.includes('viewBox="0 0 24 24"'), 'the icon must be an inline svg')
assert(icon.includes('<rect') && icon.includes('<path'), 'the icon must draw a real shape, not a placeholder dot')
assert(icon.includes('stroke="currentColor"'), 'the icon must inherit the sidebar colour')
assert(
  renderer.includes("'codesys-monitor': CODESYS_WORKBENCH_ICON"),
  'the sidebar must use that icon for the plugin',
)
assert(
  renderer.includes("${sidebarIconMarkup[item.id] ||"),
  'the settings plugin list must render the same icon (no "sidebar has an icon, the list does not")',
)
assert(
  renderer.includes('<span class="plugin-row-head">'),
  'the plugin row needs a wrapper so the icon and the two text lines sit together',
)
assert(
  overrides.includes('.plugin-row-head {') && overrides.includes('.nav-icon svg {'),
  'the plugin-row icon layout must actually be styled (and the shared svg sizing must still apply)',
)

// ── 4. 兜底描述表：宿主参数被剥离时必须用同一个名字 ─────────────────────────
// DSH alpha.2 在认证后会剥掉 host query，首启动会退回这份兜底表；漏改这里就会出现
// 「侧栏叫 CODESYS 工作台、首启动标签还叫 CODESYS」。
const client = read('plugins/installed/taskhive-surfaces/dsh/client.js')
assert(
  client.includes("{ id: 'codesys', pluginId: 'codesys-monitor', title: 'CODESYS 工作台'"),
  'the fallback surface descriptor (used when the host query is stripped) must use the new name',
)
assert(
  !/title: 'CODESYS'/.test(client),
  'no surface label may still say plain "CODESYS"',
)
assert(
  client.includes("title: 'CODESYS 工作台', order: 8"),
  'the workbench tab title must match the plugin name instead of "专用工作台"',
)

console.log('plugin identity contract tests passed')
