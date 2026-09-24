'use strict'

const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const sidebar = join(__dirname, '..', 'plugins', 'installed', 'better-sidebar')
for (const relative of ['src/prefs-shared.ts', 'src/config.ts', 'lib/client.js', 'lib/client-registry.js']) {
  const source = readFileSync(join(sidebar, relative), 'utf8')
  assert(!source.includes('bottomPanelAutoTerminal: true'), `${relative} keeps the legacy auto-terminal default`)
}
for (const relative of ['src/client/Sidebar.tsx', 'lib/client.js', 'lib/client-registry.js']) {
  const source = readFileSync(join(sidebar, relative), 'utf8')
  assert(!source.includes('bottomOpenedOnce: true'), `${relative} can still open a terminal on a layout change`)
}

console.log('sidebar terminal autostart contract passed')
