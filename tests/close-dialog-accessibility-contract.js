'use strict'

const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const source = readFileSync(join(__dirname, '..', 'app', 'preload.js'), 'utf8')

assert(source.includes('root.__taskhivePreviousFocus = previousFocus'))
assert(source.includes('root.__taskhiveBackgroundNodes'))
assert(source.includes('item.node.inert = true'))
assert(source.includes('previousFocus?.isConnected'))

console.log('close dialog accessibility contract passed')
