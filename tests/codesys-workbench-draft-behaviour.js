'use strict'

// Scenario: 切换对象后草稿保留 (an unsaved draft must survive switching to
// another object and back).
//
// The workbench keeps ONE editor per section, so selecting another object
// reloads the textareas. The regression this guards (KNOWN-ISSUES #10) was that
// the editor's two strings were the only storage: selecting another object
// overwrote them, the previous object's hand-written edit was gone forever, and
// the object tree still showed its amber "待写入" badge — the UI claimed N
// pending writes while the write set contained none of them.
//
// This renders the REAL `CodesysWorkbench` component (see `workbench-driver`)
// and interacts with it the way a user does: click a tree row, type in the code
// editor textarea. The assertions are what the user can see — the editor text
// and the tree row's change state.

const assert = require('node:assert')
const { createWorkbenchDriver } = require('./lib/workbench-driver')

const PLC_DECLARATION = [
  'PROGRAM PLC_PRG',
  'VAR',
  '  x : INT;',
  'END_VAR',
].join('\n')
const PLC_IMPLEMENTATION = 'x := x + 1;'
const GVL_DECLARATION = [
  'VAR_GLOBAL',
  '  y : INT;',
  'END_VAR',
].join('\n')

const OBJECTS = [
  {
    name: 'PLC_PRG',
    guid: 'guid-plc-prg',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration: PLC_DECLARATION,
    implementation: PLC_IMPLEMENTATION,
    path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
  },
  {
    name: 'GVL_Data',
    guid: 'guid-gvl-data',
    type: 'GVL',
    hasDeclaration: true,
    hasImplementation: false,
    declaration: GVL_DECLARATION,
    implementation: '',
    path: ['Device', 'PLC Logic', 'Application', 'GVL_Data'],
  },
]

const EDITED_DECLARATION = [
  'PROGRAM PLC_PRG',
  'VAR',
  '  x : INT;',
  '  unsavedDraft : BOOL;',
  'END_VAR',
].join('\n')
const EDITED_IMPLEMENTATION = 'x := x + 1;\nunsavedDraft := TRUE;'

async function main () {
  const driver = createWorkbenchDriver({ objects: OBJECTS })
  await driver.settle()

  // The project detection → bind → inspect chain really ran, so there is a
  // workbench with a tree and an editor to switch between.
  assert.deepStrictEqual(driver.treeRowNames(), ['PLC_PRG', 'GVL_Data'],
    'the workbench must render the project tree from the inspection payload')
  assert.strictEqual(driver.treeSelected('PLC_PRG'), 'true', 'the first code object must be selected')
  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION,
    'the editor must start from the object text the project reported')
  assert.strictEqual(driver.editorValue('implementation'), PLC_IMPLEMENTATION)
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), '', 'an untouched object carries no change state')

  // ── the user edits PLC_PRG ────────────────────────────────────────────────
  driver.typeInEditor('declaration', EDITED_DECLARATION)
  driver.typeInEditor('implementation', EDITED_IMPLEMENTATION)
  assert.strictEqual(driver.editorValue('declaration'), EDITED_DECLARATION)
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), 'manual',
    'an object that differs from disk must be marked as a pending manual change')

  // ── switch to another object ──────────────────────────────────────────────
  driver.clickTreeRow('GVL_Data')
  assert.strictEqual(driver.editorValue('declaration'), GVL_DECLARATION,
    'selecting another object must load that object text, not the previous draft')
  assert.deepStrictEqual(driver.editorSections(), ['declaration'],
    'a GVL has no implementation section, so the editor must not offer one')
  assert.strictEqual(driver.treeChangeState('GVL_Data'), '',
    'the newly selected object must not inherit the previous object change state')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), 'manual',
    'the pending change marker must stay on the object that was edited')

  // ── and back: the draft must be there ─────────────────────────────────────
  driver.clickTreeRow('PLC_PRG')
  assert.strictEqual(driver.editorValue('declaration'), EDITED_DECLARATION,
    'switching back must restore the unsaved draft, not the text from disk')
  assert.strictEqual(driver.editorValue('implementation'), EDITED_IMPLEMENTATION,
    'the implementation draft must survive independently of the declaration')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), 'manual')

  // A second round trip must not lose it either (the first switch is the one
  // that stores the draft; a later one must read it back, not consume it).
  driver.clickTreeRow('GVL_Data')
  assert.strictEqual(driver.editorValue('declaration'), GVL_DECLARATION,
    'the untouched object must still show its own text on a later visit')
  driver.clickTreeRow('PLC_PRG')
  assert.strictEqual(driver.editorValue('declaration'), EDITED_DECLARATION,
    'the draft must still be there after a second switch away and back')
  assert.strictEqual(driver.editorValue('implementation'), EDITED_IMPLEMENTATION)

  // ── a draft that is reverted must stop being a draft ──────────────────────
  // Typing the object's disk text back is "no change", so the marker (and the
  // stored draft that would be restored on the next visit) must clear.
  driver.typeInEditor('declaration', PLC_DECLARATION)
  driver.typeInEditor('implementation', PLC_IMPLEMENTATION)
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), '',
    'reverting the text to the disk content must clear the pending change')
  driver.clickTreeRow('GVL_Data')
  driver.clickTreeRow('PLC_PRG')
  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION,
    'a reverted draft must not spring back on the next visit')
  assert.strictEqual(driver.editorValue('implementation'), PLC_IMPLEMENTATION)

  driver.unmount()
  console.log('codesys workbench draft behaviour test passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
