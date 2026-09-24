'use strict'

// Contract for the TaskHive workbench skin.
//
// Two properties must hold at the same time:
//   1. The 1.0.2 TaskHive theme is actually installed (brand button, collapsed
//      rail mark, composer brand, public reasoning disclosure, accessible
//      names, composer/permission dedup).
//   2. The T029/T037 performance work is NOT undone by it. The skin must stay
//      incremental and must never scan `document.body *` or force layout on
//      every mutation.
//
// A previous revision of this file asserted the opposite of (1) because T034
// had stripped the theme. Restoring the theme required re-deriving the whole
// contract, so both halves are asserted explicitly here.

const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const source = readFileSync(join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js'), 'utf8')

// --- 1. restored TaskHive theme ------------------------------------------
assert(source.includes("let taskhiveBrandIcon = String(params.get('taskhiveIcon') || '')"), 'brand icon must be read from the host URL')
assert(source.includes('const resolveTaskhiveBrandIcon = async () =>'), 'alpha.2 strips taskhiveIcon, so it must be re-resolved through the bridge')
// The sidebar brand is reconciled against the markup DSH 0.1.3-alpha.2 actually
// renders (dumped from the live frame): a `logoRow` whose
// `[data-slot="sidebar.brand.mark"]` holds the vendor logo, re-parented between
// `brandMark` (expanded) and `railMark` (collapsed). There is no text in the row
// and no `button[class*="_brand"]` to rewrite.
assert(source.includes('const SIDEBAR_MARK_SELECTOR = \'[data-slot="sidebar.brand.mark"]\''), 'the sidebar mark selector must target the real slot')
assert(source.includes('const ensureSidebarBrandMark = () =>'), 'the vendor glyph must be replaced')
assert(source.includes('const ensureSidebarGlyph = () => ensureSidebarBrandMark()'), 'the old entry point must delegate to the brand mark')
assert(source.includes('const rebrandSidebarText = () =>'), 'any vendor brand text must be replaced')
assert(source.includes('const reconcileSidebarBrand = () =>'), 'brand reconciliation must be a single idempotent step')
// The mark beside the "TaskHive" wordmark is the app's identity, so it must be
// the TaskHive PROGRAM ICON — not the vendor logo and not a generic panel glyph.
assert(source.includes('data-taskhive-brand-mark="true"'), 'the brand mark must carry its own marker')
assert(/const brandMarkMarkup = \(\) => \(taskhiveBrandIcon/.test(source), 'the mark must render the host-supplied program icon')
assert(source.includes('<img data-taskhive-brand-mark="true" src="${taskhiveBrandIcon}"'), 'the mark must be an img using the host icon data URL')
assert(/brandMarkSvg = '<svg data-taskhive-brand-mark="true"/.test(source), 'a marked placeholder must exist until the icon resolves')
// React owns the vendor node; deleting it aborts the client mount and blanks the
// sidebar, so the vendor glyph is hidden in place instead.
assert(/child\.style\?\.setProperty\('display', 'none', 'important'\)/.test(source), 'the vendor glyph must be hidden, not removed')
assert(!/mark\.innerHTML = brandMarkMarkup\(\)/.test(source), 'the mark must not be replaced via innerHTML')
// React re-renders the brand on every collapse/expand, so reconciliation must
// also run synchronously from the observer rather than only on the idle scrub.
assert(source.includes('if (brandTouched(node)) reconcileSidebarBrand()'), 'the observer must reconcile the brand synchronously')
assert(source.includes('const brandTouched = (node) =>'), 'brand mutations must be detected')
assert(source.includes("node.textContent = 'TaskHive'"), 'vendor brand text must be replaced with TaskHive')
// The one-shot document scan missed the brand entirely, which is why the vendor
// logo and name stayed visible. Reconciliation must run on every pass.
const scrubStart = source.indexOf('const scrub = (root = document')
const scrubHead = source.slice(scrubStart, source.indexOf('for (const button of nodesWithin', scrubStart))
assert(scrubHead.includes('reconcileSidebarBrand()'), 'reconcileSidebarBrand must be called on every scrub pass')
assert(!/if \(isDocument\) \{[\s\S]{0,120}reconcileSidebarBrand/.test(scrubHead), 'brand reconciliation must not be gated on the one-shot document scan')
assert(source.includes('const brandRetries = ['), 'delayed retries must cover a sidebar that mounts without an observed mutation')
assert(source.includes('const replaceComposerBrand = (candidates) =>'), 'composer brand must be replaced')
assert(source.includes('const hideComposerDuplicate = (button, text, dialogOpen) =>'), 'composer access-mode duplicates must be hidden')
assert(source.includes('const dismissInternalPreviewNotice = () =>'), 'internal preview notice must be dismissed')
assert(source.includes('const syncDeepDivingDisclosures = (root = document) =>'), 'reasoning disclosure presentation must be controlled')
assert(source.includes('const backfillAccessibleNames = (root) =>'), 'accessible-name backfill must be restored')
assert(source.includes('window.__TASKHIVE_SYNC_DEEP_DIVING__'), 'the reasoning hook is part of the 1.0.2 public seam')
// The reasoning row's expansion belongs to the USER. The seam used to force it open
// while the model was thinking; because React re-creates the row as reasoning
// streams, no node-scoped "already handled" marker survives a re-render, so the
// drive reopened the row after every manual collapse ("once opened it cannot be
// folded back"). It must not click the row at all, and the retry bookkeeping that
// existed only for that drive must stay gone.
const syncDisclosureBody = source.slice(source.indexOf('const syncDeepDivingDisclosures = (root = document) =>'), source.indexOf('const RESIDUAL_LABEL'))
assert(syncDisclosureBody.length > 0, 'the reasoning disclosure seam must remain present')
assert(!/\.click\(\)/.test(syncDisclosureBody), 'the reasoning disclosure seam must never click the row: its expansion is the user\'s')
assert(!source.includes('deepDivingAttempts'), 'the force-expand retry bookkeeping must stay removed')

// --- 2. T029/T037 performance properties must still hold ------------------
assert(!source.includes('setInterval(scrub'), 'the 1.0.2 full-page 250 ms scrub interval must NOT be restored')
assert(!source.includes("document.querySelectorAll('body *')"), 'the skin must never scan every body descendant')
assert(!source.includes('new MutationObserver(scrub)'), 'the observer must not call the whole-page scrub directly')
assert(source.includes('const pendingRoots = new Set()'), 'incremental pending-root queue must exist')
assert(source.includes('const nodesWithin = (root, selector) =>'), 'root-scoped query helper must exist')
assert(source.includes('const scheduleScrub = (root = document, initial = false) =>'), 'incremental scheduler must exist')
assert(source.includes('typeof requestIdleCallback === \'function\''), 'scrub must be idle-scheduled, not interval-driven')
assert(source.includes('scheduleScrub(document, true)'), 'the initial document scan must still happen once')
assert(source.includes('scheduleScrub(brandRoot)'), 'scrub must be scheduled for the matched subtree, not the document')

const skinObserver = source.slice(source.indexOf('const relevantSelector ='), source.indexOf('window.__TASKHIVE_SKIN_DISPOSE__'))
assert(!skinObserver.includes('characterData: true'), 'the skin observer must not watch characterData')
assert(!skinObserver.includes('scheduleScrub(document)'), 'an added image must NOT escalate to a whole-document scrub')
assert(skinObserver.includes('scheduleScrub(node.parentElement || node)'), 'image cleanup must stay local to the added subtree')

// The residual-brand helper reads innerText and geometry, so it must gate on
// the cheap textContent value first. This is what keeps the restored skin from
// re-introducing the streaming jank.
const residualHelper = source.slice(source.indexOf('const hideResidualBrandText = (root) =>'), source.indexOf('const backfillAccessibleNames = (root) =>'))
assert(residualHelper.includes('const raw = String(node.textContent || \'\')'), 'residual-brand scan must gate on textContent')
assert(residualHelper.includes('!RESIDUAL_LABEL.test(raw)') , 'the cheap gate must reject non-matching nodes before layout reads')
assert(residualHelper.indexOf('!RESIDUAL_LABEL.test(raw)') < residualHelper.indexOf('node.getBoundingClientRect()'), 'the cheap gate must run before any geometry read')

// --- 3. web-login bridge stays incremental -------------------------------
assert(source.includes('const processTextNode = (textNode) =>'))
assert(source.includes("if (mutation.type === 'characterData')"))

// --- 4. observer callback signatures (the `force` parameter bug) ----------
assert(!source.includes('new MutationObserver(publish)'), 'passing `publish` directly makes the mutation array the `force` argument')
assert(source.includes('new MutationObserver(() => publish())'), 'geometry observer must wrap publish')
assert(!source.includes('new ResizeObserver(publish)'), 'passing `publish` directly makes the entry list the `force` argument')
assert(source.includes('new ResizeObserver(() => publish())'), 'resize observer must wrap publish')
assert(source.includes('if (!force && stableFrames < 2) return'), 'the two-frame stabilisation guard must be intact')

// --- 5. one bilingual source of truth for the right rail ------------------
assert(source.includes('const RIGHT_SIDEBAR_COLLAPSED = /展开(?:右侧)?侧边栏|expand\\s+(?:right\\s+)?sidebar/i'), 'collapse detection must be bilingual and shared')
assert(!source.includes('const rightSidebarCollapsed = /展开(?:右侧)?侧边栏/.test(rightToggleLabel)'), 'the Chinese-only duplicate regex must be gone')
assert.equal(source.match(/RIGHT_SIDEBAR_COLLAPSED\.test\(/g)?.length, 2, 'both collapse checks must use the shared constant')

// --- 6. the skin observer is actually released ----------------------------
assert(source.includes('window.__TASKHIVE_SKIN_DISPOSE__?.()'), 'the skin disposer must be called from the plugin effect teardown')
assert(source.includes('delete window.__TASKHIVE_SKIN_DISPOSE__'), 'the disposer seam must be cleaned up')

// --- 7. QA session probe is gated -----------------------------------------
assert(source.includes('const requireQaProbes = () =>'), 'the mutating session probe must be gated')
assert.equal(source.match(/requireQaProbes\(\)/g)?.length, 5, 'every mutating probe method must call the gate')

// --- 8. right-rail geometry contract retained from T041 -------------------
assert(source.includes("const rightToggle = document.querySelector('[data-dsh-right-sidebar-toggle]')"))
assert(source.includes("window.dispatchEvent(new Event('taskhive:right-sidebar-toggle'))"))
assert(source.includes('let publishedGeometry = null'))
assert(source.includes('const minimumRightReserve = Math.max(180, declaredRightWidth || 380)'))
assert(source.includes('rightSidebarReserve: Math.round(viewport.width - rightBoundary)'))
assert(source.includes("document.addEventListener('click', republishAfterRightRailTransition, true)"))
assert(source.includes("window.addEventListener('taskhive:right-sidebar-toggle', republishAfterRightRailTransition)"))
assert(source.includes('for (const delay of [180, 520])'))
assert(source.includes('const isDockedRightPanel = (value) => value'))
assert(source.includes('let lastSafeRightBoundary = null'))
assert(source.includes('const fallbackRightBoundary = lastSafeRightBoundary'))

// --- 9. layout overrides that T041/T033 removed must stay removed ---------
assert(!source.includes('data-taskhive-sidebar-recovery-toggle="true"'))
assert(!source.includes('taskhiveSidebarToggleState'))
assert(!source.includes("setTimeout(ensureRightSidebarOpen, 120)"))
assert(!source.includes("setTimeout(ensureRightSidebarOpen, 360)"))
assert(!source.includes("document.querySelector('[data-dsh-bottom-panel-toggle]')?.click()"))

// --- 10. TaskHive theme replaces the forced monochrome ---------------------
// The plugin used to force black/white/gray with !important, which made
// TaskHive's own surfaces look like a grayscale wireframe next to the
// blue-accented shell. The palette is derived from the brand icon gradient
// (#7168F6 -> #3188EB) and the shell accent (#3569e8).
assert(source.includes('--th-brand:#4f6ef2'), 'the TaskHive brand token must be defined')
assert(source.includes('--th-brand-tint:#eef2fe'), 'the brand tint must be defined')
assert(source.includes('--th-ink:#1b2233'), 'the ink token must be defined')
assert(!source.includes('#cfcfcf!important'), 'the forced monochrome border must be gone')
assert(!source.includes('background:#f7f7f7!important'), 'the forced monochrome background must be gone')
assert(source.includes('TaskHive theme'), 'the CSS must document the TaskHive theme block that replaced the monochrome policy')
// The historical quote is kept for context, so assert the *policy* is gone by
// checking that no rule still follows it — the forced-rule assertions above do
// that. Here just confirm the block is no longer described as intentional.
assert(!/Harness palette is black\/white\/gray only; these declarations intentionally/.test(source), 'the monochrome policy must no longer be stated as intentional')
assert(source.includes('color:var(--th-ok)!important'), 'a ready write panel must read as success')
assert(source.includes('color:var(--th-warn)!important'), 'a blocked write panel must read as warning')
assert(source.includes('border-left-color:var(--th-brand)!important'), 'changed files must use the brand accent, not gray')
assert(/button: \{ height: '30px'[^}]*background: 'var\(--th-brand-tint\)'/.test(source), 'surface buttons must use the brand tint')

// --- 11. the desktop branding probe must validate the restored theme ------
// T034's probe asserted "zero TaskHive overlay nodes", which is now exactly
// backwards: the restored theme is supposed to inject a TaskHive brand. Keep
// the probe aligned with the theme so it cannot silently re-invert.
const mainSource = readFileSync(join(__dirname, '..', 'app', 'main.js'), 'utf8')
const brandingProbe = mainSource.slice(mainSource.indexOf('async function probeTaskHiveBranding'), mainSource.indexOf('async function probeNativeSettings'))
assert(brandingProbe.includes("theme: 'taskhive-1.0.2'"), 'the branding probe must record which theme it validated')
assert(brandingProbe.includes('brandButtonTaskHiveIcon'), 'the probe must check the TaskHive sidebar brand icon')
assert(brandingProbe.includes('composerBrandTaskHiveIcon'), 'the probe must check the TaskHive composer brand icon')
assert(brandingProbe.includes('foreignRailIcons'), 'the probe must check that no foreign rail glyph remains')
assert(brandingProbe.includes('visibleInternalNotice'), 'the probe must check the internal preview notice is gone')
assert(!brandingProbe.includes('taskHiveOverlayNodes === 0'), 'the probe must not require zero TaskHive overlay nodes')

// --- 12. T091: the sidebar brand must survive React dropping our nodes -------
// Field report: "左侧栏把 taskhive 图标和文字丢失了，再次打开就会恢复". Root cause:
// when React re-renders the brand region it removes the nodes WE injected and reuses
// the vendor node it owns — which still carries our `display:none !important` — so the
// slot goes BLANK. That childList mutation carries ONLY `removedNodes`, and the observer
// loop only inspected `addedNodes`, so reconcileSidebarBrand() was never called again.
assert(source.includes('for (const node of mutation.removedNodes)'), 'the skin observer must react to removedNodes, not only addedNodes')
assert(source.includes('const isOurBrandNode = (node) =>'), 'removal handling must recognise our own brand nodes')
assert(source.includes('[data-taskhive-brand-mark],[data-taskhive-brand-wordmark],[data-taskhive-brand-text],[data-taskhive-brand-icon]'), 'isOurBrandNode must know every injected brand marker')
assert(source.includes('if (!isOurBrandNode(node) && !brandTouched(node)) continue'), 'the removal branch must also catch removals inside a brand region')
assert(source.includes("window.addEventListener('resize', onBrandResize)"), 'a sidebar collapse/expand is a layout change: re-assert the brand on resize')
assert(source.includes("window.removeEventListener('resize', onBrandResize)"), 'the resize listener must be disposed with the skin')
assert(!/removedNodes[\s\S]{0,400}scheduleScrub\(document\)/.test(source), 'the removal branch must NOT escalate to a whole-document scrub (T029/T037 regression)')
assert(source.includes('const marks = document.querySelectorAll(SIDEBAR_MARK_SELECTOR)'), 'every brand-mark slot must be branded, not just the first')
assert(source.includes('const slots = document.querySelectorAll(SIDEBAR_NAME_SELECTOR)'), 'every wordmark slot must be branded, not just the first')

console.log('skin performance contract passed')
