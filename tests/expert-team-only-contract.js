'use strict'
// Contract: the expert surface is TEAM-ONLY.
//
// The old UI offered a 团队/个人 switch. It was decorative: the only thing the
// switch did was `teamSelect.disabled = expertMode === 'individual'`, and the
// value it let you pick (`activeExpertId`) is written to experts.json and read
// back only to preselect a dropdown — no execution path consumes it. The run tool
// (`taskhive_expert_run` -> `runExpertTeam`) always walks the selected team's
// workflow stages and runs each stage's owner expert. So the UI promised a mode
// the runtime never implemented; it is now removed and the team is the unit.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const app = join(__dirname, '..')
const renderer = readFileSync(join(app, 'app', 'renderer', 'renderer.js'), 'utf8')
const main = readFileSync(join(app, 'app', 'main.js'), 'utf8')
const hostPlugin = readFileSync(join(app, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js'), 'utf8')

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

check('the individual mode is gone from the expert surface',
  !renderer.includes('data-expert-mode="individual"') && !/>个人</.test(renderer))
check('exactly one mode indicator remains, and it is the team',
  (renderer.match(/data-expert-mode=/g) || []).length === 1 && renderer.includes('data-expert-mode="team"'),
  String((renderer.match(/data-expert-mode=/g) || []).length))
check('the mode indicator is a label, not a clickable tab',
  /<span class="expert-mode active" data-expert-mode="team"/.test(renderer) && !/data-expert-mode[^>]*role="tab"/.test(renderer))
check('no expertMode state survives',
  !/\bexpertMode\b/.test(renderer))
check('the team select is no longer disabled by a mode switch',
  !/teamSelect\.disabled = expertMode/.test(renderer) && /teamSelect\.disabled = expertConfig\.teams\.length === 0/.test(renderer))
check('the smoke probe expects a single mode',
  main.includes('expertControls?.modes === 1') && !main.includes('expertControls?.modes === 2'))
// The per-expert pick is the same decorative individual concept as the removed
// mode, so it goes with it: the team's stage pipeline is the unit of execution.
check('the per-expert pick is gone from the surface',
  !renderer.includes('expert-active') && !renderer.includes('fillExpertOptions'),
  /expert-active/.test(renderer) ? 'renderer still renders #expert-active' : 'fillExpertOptions still defined')
check('nothing still waits for or asserts the removed pick',
  !main.includes('#expert-active') && !main.includes('expertControls?.active'),
  'the smoke probe still references #expert-active')
check('the surface reports the team pipeline instead of a per-expert pick',
  renderer.includes('个阶段流水线执行'))
check('the team select still clears any stored per-expert pick',
  renderer.includes("setExpertSelection({ teamId: teamSelect.value, expertId: '' })"))
// Why team-only is the honest UI: the run path never reads the individual pick.
check('the expert run walks team stages (each stage owner expert)',
  hostPlugin.includes('stage.owner') && hostPlugin.includes('runExpertTeam'))
check('no execution path consumes activeExpertId',
  !/activeExpertId/.test(hostPlugin) && !/activeExpertId/.test(main),
  'the per-expert pick is configuration-only, which is what made the mode decorative')

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  <- ${item.detail}`}`)
const failed = checks.filter((item) => !item.ok)
console.log(failed.length ? `${failed.length}/${checks.length} checks failed` : `all ${checks.length} checks passed`)
process.exitCode = failed.length ? 1 : 0
