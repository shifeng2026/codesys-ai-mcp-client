'use strict'
// Contract: TaskHive's brand scrubbers may only remove VENDOR chrome — never a UI
// control, and never a model name.
//
// The bug this pins down: the composer's model seat renders the selected model's
// own name, so choosing a DeepSeek model puts the vendor's name inside the model
// selector. The scrubbers matched on that text alone, so they hid the selector
// and dropped a TaskHive wordmark in its place — "after switching the model to
// deepseek the input-box model picker disappeared and became taskhive".
//
// Three separate mechanisms could each do it, and all three are asserted here:
//   1. `replaceComposerBrand` used to replace the tagline's PARENT innerHTML; the
//      tagline shares its row with the composer controls, so the model seat was
//      deleted along with it.
//   2. The generic vendor finder matched any node whose text merely contained
//      "deepseek" (case-insensitive) and then hid that node's parent.
//   3. The residual-label scrubber hid any node whose text was exactly
//      "deepseek" / "harness".
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const CLIENT = join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js')
const source = readFileSync(CLIENT, 'utf8')

const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
const slice = (start, end) => {
  const from = source.indexOf(start)
  if (from < 0) return ''
  const to = source.indexOf(end, from)
  return source.slice(from, to < 0 ? source.length : to)
}

// ── 1. The exemption list itself ────────────────────────────────────────────
const exemptMatch = /\n\s*const BRAND_SCRUB_EXEMPT = '([^']*)'/.exec(source)
const exempt = exemptMatch ? exemptMatch[1] : ''
check('a brand-scrub exemption list exists', Boolean(exempt), JSON.stringify(exemptMatch?.[0]?.slice(0, 80)))
check('the exemption covers interactive controls',
  exempt.includes('button') && exempt.includes('[role="button"]') && exempt.includes('[aria-haspopup]'),
  exempt)
check('the exemption covers the model seat and its popups',
  /data-slot\*="model"/.test(exempt) && exempt.includes('[role="listbox"]') && exempt.includes('[role="menu"]'),
  exempt)

// ── 2. The vendor matcher must not accept a model name ──────────────────────
const vendorLiteral = /const VENDOR_BRAND_TEXT = (\/.*?\/[a-z]*)\n/.exec(source)?.[1]
let vendor = null
try { vendor = vendorLiteral ? new Function(`return ${vendorLiteral}`)() : null } catch { vendor = null }
check('the vendor matcher is a literal regex', vendor instanceof RegExp, String(vendorLiteral))
if (vendor) {
  check('the vendor matcher accepts the vendor chrome words',
    vendor.test('DeepSeek Harness') && vendor.test('DeepSeek') && vendor.test('deepseek'),
    String(vendor))
  check('the vendor matcher rejects every model name shape',
    !vendor.test('DeepSeek V4 Flash') && !vendor.test('DeepSeek Chat') && !vendor.test('deepseek-reasoner')
      && !vendor.test('DeepSeek Coder V2') && !vendor.test('deepseek-v4-flash'),
    String(vendor))
}

// ── 3. replaceComposerBrand must never replace a container ──────────────────
const composerBrand = slice('const replaceComposerBrand = (candidates) => {', '// Keep the native Harness reasoning disclosure')
check('replaceComposerBrand was found', composerBrand.length > 0)
check('replaceComposerBrand no longer writes into the tagline container',
  !/container\.innerHTML/.test(composerBrand) && !/const container =/.test(composerBrand),
  composerBrand.slice(0, 200))
check('replaceComposerBrand rewrites only the matched node',
  /original\.innerHTML = brandWordmarkMarkup/.test(composerBrand) && /original\.dataset\.taskhiveComposerBrand = 'true'/.test(composerBrand))

// ── 4. Both scrubbers must consult the exemption ────────────────────────────
const residual = slice('const hideResidualBrandText = (root) => {', 'const backfillAccessibleNames')
check('the residual scrubber was found', residual.length > 0)
check('the bare "deepseek"/"harness" rule is guarded by the exemption',
  /\^\(deepseek\|harness\)\$\/i\.test\(text\) && !node\.closest\(BRAND_SCRUB_EXEMPT\)/.test(residual),
  residual.split('\n').filter((line) => line.includes('deepseek|harness')).join(' | '))

const scrub = slice('const scrub = (root = document, isDocument = root === document) => {', 'let scrubScheduled = false')
check('the universal scrub pass was found', scrub.length > 0)
check('the vendor finder uses the strict vendor matcher, not /deepseek/i',
  /VENDOR_BRAND_TEXT\.test\(raw\)/.test(scrub) && !/\/deepseek\/i\.test\(raw\)/.test(scrub))
check('the vendor finder skips controls and nodes containing controls',
  /node\.closest\(BRAND_SCRUB_EXEMPT\) \|\| node\.querySelector\(BRAND_SCRUB_EXEMPT\)/.test(scrub))

// ── 5. The sidebar text rebrand stays scoped to the sidebar logo row ────────
const sidebarRebrand = slice('const rebrandSidebarText = () => {', 'const SIDEBAR_NAME_SELECTOR')
check('the sidebar text rebrand is scoped to the logo row',
  sidebarRebrand.includes("document.querySelector('[class*=\"logoRow\"]')") && !sidebarRebrand.includes('querySelectorAll(\'*\')'),
  sidebarRebrand.slice(0, 160))

// ── 6. The conversation hero's mark: our icon in the vendor's slot ──────────
// T064 stopped the headline seam from wiping the hero row. That row also held the
// vendor glyph (`conversation.hero.brand.mark`), so the glyph came back — and the
// first repair only HID it, which left a 34px hole and pushed the brand icon into
// the headline text span, where the grid row stacks it above the words. The slot
// now gets the TaskHive mark, at the size DSH renders it.
const heroSelector = /const HERO_MARK_SELECTOR = '([^']*)'/.exec(source)?.[1] || ''
check('the conversation hero mark slot is targeted by name',
  heroSelector === '[data-slot="conversation.hero.brand.mark"]', JSON.stringify(heroSelector))

const heroMark = slice('const ensureHeroBrandMark = () => {', 'const reconcileSidebarBrand')
check('ensureHeroBrandMark was found', heroMark.length > 0)
check('the hero vendor glyph is hidden, never removed',
  /display', 'none', 'important'/.test(heroMark) && !/child\.remove\(\)/.test(heroMark) && !/mark\.remove\(\)/.test(heroMark),
  heroMark.slice(0, 240))
check('only our own placeholder is ever removed',
  /if \(ours\) ours\.remove\(\)/.test(heroMark), heroMark.slice(0, 240))
check('the TaskHive mark is written into the vendor slot',
  heroMark.includes("insertAdjacentHTML('beforeend', heroMarkMarkup())"), heroMark.slice(0, 240))

const heroSize = /const HERO_MARK_SIZE = (\d+)/.exec(source)?.[1]
check('the hero mark uses the size DSH renders in that slot (34px)',
  heroSize === '34', String(heroSize))
check('the hero mark swaps the neutral glyph in at the same size',
  /const heroMarkMarkup = \(\) => \(taskhiveBrandIcon/.test(source) && /brandMarkSvg\.replace\('width="22" height="22"'/.test(source))

const brandStep = slice('const reconcileSidebarBrand = () => {', 'const ensureBrandButton')
check('the brand step covers the hero mark on every call',
  brandStep.includes('ensureHeroBrandMark()'),
  brandStep.split('\n').map((line) => line.trim()).filter(Boolean).join(' | '))

// The headline seam must stay text-only: `div.headline` is a grid row, so an icon
// inside the text span stacks above the words instead of sitting beside them.
check('replaceComposerBrand writes the wordmark without a second icon',
  /original\.innerHTML = brandWordmarkMarkup/.test(composerBrand) && !/brandSpanMarkup\(\)/.test(composerBrand),
  composerBrand.slice(-260))

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  <- ${item.detail}`}`)
const failed = checks.filter((item) => !item.ok)
console.log(failed.length ? `${failed.length}/${checks.length} checks failed` : `all ${checks.length} checks passed`)
process.exitCode = failed.length ? 1 : 0
