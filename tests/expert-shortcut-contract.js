'use strict'
// Contract: the composer's expert control is the ONE expert switch, and it is live.
//
// History this pins down: the control started as a switch while the expert plugin
// carried a second copy of the same switch (`#expert-enabled`), which is why the
// two could show different states and why clicking the composer button did not
// open the plugin. The plugin's copy is gone: it configures teams and stages, the
// composer button turns expert collaboration on and off, and the host pushes every
// change so neither view can go stale.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const app = join(__dirname, '..')
const client = readFileSync(join(app, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js'), 'utf8')
const preload = readFileSync(join(app, 'app', 'preload.js'), 'utf8')
const main = readFileSync(join(app, 'app', 'main.js'), 'utf8')
const renderer = readFileSync(join(app, 'app', 'renderer', 'renderer.js'), 'utf8')
const uiOverrides = readFileSync(join(app, 'app', 'renderer', 'ui-overrides.css'), 'utf8')

const slice = (start, end) => {
  const from = client.indexOf(start)
  if (from < 0) return ''
  const to = client.indexOf(end, from)
  return client.slice(from, to < 0 ? client.length : to)
}
const toggle = slice('function ExpertToggle() {', 'function WebModelSelect()')

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

check('the composer expert control was found', toggle.length > 0)
check('it is a switch again (toggles the shared state)',
  toggle.includes('setExpertEnabled(!enabled)') && !toggle.includes("openSurface('experts')"),
  toggle.includes("openSurface('experts')") ? 'still opens the surface' : toggle.slice(0, 160))
check('it reports itself as a pressed/unpressed toggle',
  toggle.includes("'aria-pressed': enabled === true") && !toggle.includes("'aria-haspopup'"))
check('it keeps reporting the live state',
  toggle.includes("'data-enabled':") && /专家协作\$\{enabled \? '已开启' : '已关闭'\}/.test(toggle))
check('it stays subscribable so anything else can keep it honest',
  toggle.includes('window.taskhive?.onExpertStatus?.(apply)') && /return \(\) => \{ disposed = true; try \{ unsubscribe\?\.\(\) \}/.test(toggle))
check('preload exposes the expert status subscription',
  preload.includes("ipcRenderer.on('experts:changed'") && /onExpertStatus:/.test(preload))
check('every expert mutation is published to all windows',
  /const publishExpertStatus = \(status\) => \{[\s\S]{0,400}?webContents\.getAllWebContents\(\)/.test(main)
    && (main.match(/publishExpertStatus\(expertConfig\./g) || []).length === 5,
  String((main.match(/publishExpertStatus\(expertConfig\./g) || []).length))

// The plugin must NOT carry a second switch.
check('the expert surface has no on/off switch',
  !renderer.includes('expert-enabled') && !renderer.includes('enabledButton'),
  /expert-enabled/.test(renderer) ? 'renderer still renders #expert-enabled' : 'enabledButton still referenced')
check('no dead styling for the removed switch',
  !uiOverrides.includes('#expert-enabled'))
check('the smoke probe asserts the toggle round trip',
  main.includes('result.toggled?.enabled !== result.initial?.enabled') && main.includes('result.restored?.enabled === result.initial?.enabled')
    && !main.includes('result.opened === true'))
check('the repository probe asserts the plugin has no switch',
  main.includes('expertControls?.enabledSwitchInPlugin === false'))

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  <- ${item.detail}`}`)
const failed = checks.filter((item) => !item.ok)
console.log(failed.length ? `${failed.length}/${checks.length} checks failed` : `all ${checks.length} checks passed`)
process.exitCode = failed.length ? 1 : 0
