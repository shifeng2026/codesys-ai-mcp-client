#!/usr/bin/env node
// 30-second triage for "the composer's model picker disappeared / turned into
// TaskHive" (and for any other suspected collateral damage from the TaskHive
// brand scrubbers). See docs/KNOWN-ISSUES.md issue #5.
//
// Usage:
//   1. Start TaskHive with a debugging port:  TaskHive.exe --remote-debugging-port=9222
//   2. Run:                                    node tools/inspect-branding.mjs [port]
//
// It answers one question: did a brand scrubber touch something that is not
// branding? It prints, for every page:
//   - the model controls it can see (a model seat that is missing entirely is
//     itself the answer),
//   - every injected TaskHive brand node and what surrounds it,
//   - every node the generic vendor finder WOULD match right now, with the
//     verdict the current matcher reaches,
//   - every DeepSeek-labelled node that is currently hidden.
import process from 'node:process'

const port = Number(process.argv[2] || 9222)
const base = `http://127.0.0.1:${port}`

const PROBE = `(() => {
  const txt = (node) => String((node && (node.innerText || node.textContent)) || '').trim().replace(/\\s+/g, ' ')
  const box = (node) => { const r = node.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } }
  const describe = (node) => node ? {
    tag: node.tagName,
    cls: String(node.className || '').slice(0, 60),
    slot: node.getAttribute('data-slot') || '',
    text: txt(node).slice(0, 70),
    box: box(node),
    display: getComputedStyle(node).display,
    inlineDisplay: node.style.display || '',
  } : null
  const all = [...document.querySelectorAll('body *')]
  const hiddenAncestor = (node) => {
    let parent = node
    while (parent && parent !== document.body) {
      if (getComputedStyle(parent).display === 'none') return describe(parent)
      parent = parent.parentElement
    }
    return null
  }
  const modelish = /(模型|model|deepseek|gpt-|claude|qwen|kimi|ollama|sonnet|opus|haiku)/i
  return {
    href: location.href.slice(0, 90),
    // 1. The composer's model seat. If nothing here names a model, the picker is
    //    gone — compare against the model this window reports below.
    modelControls: [...document.querySelectorAll('button,[role="button"],[role="combobox"],[aria-haspopup]')]
      .filter((node) => modelish.test(txt(node)) || modelish.test(String(node.getAttribute('aria-label') || '')) || modelish.test(String(node.getAttribute('title') || '')))
      .slice(0, 12)
      .map((node) => ({ ...describe(node), aria: String(node.getAttribute('aria-label') || '').slice(0, 70), hiddenAncestor: hiddenAncestor(node) })),
    // 2. What the seam injected.
    injectedBrand: [...document.querySelectorAll('[data-taskhive-brand-text="true"],[data-taskhive-brand-wordmark="true"],[data-taskhive-brand-mark="true"],[data-taskhive-composer-brand="true"]')]
      .map((node) => ({ ...describe(node), parent: describe(node.parentElement), kind: Object.keys(node.dataset || {}).join(',') })),
    // 3. The generic vendor finder, evaluated live. These flags mirror the shipped
    //    predicate; anything matched here is about to be hidden and replaced.
    vendorCandidates: all
      .filter((node) => /deepseek/i.test(String(node.textContent || '')))
      .slice(0, 12)
      .map((node) => {
        const raw = txt(node)
        const rect = node.getBoundingClientRect()
        return { ...describe(node), exact: /^deepseek(?:\\s+(?:harness|preview|beta))?$/i.test(raw),
          inSizeWindow: rect.width > 40 && rect.width < 360 && rect.height < 100,
          inControl: Boolean(node.closest('button,[role="button"],[role="combobox"],[aria-haspopup],[role="listbox"],[role="menu"],[data-slot*="model" i]')) }
      }),
    // 4. DeepSeek-labelled nodes that are hidden right now.
    hiddenDeepSeek: all
      .filter((node) => node.children.length === 0 && /deepseek/i.test(String(node.textContent || '')) && hiddenAncestor(node))
      .slice(0, 12)
      .map((node) => ({ text: txt(node).slice(0, 70), hiddenAncestor: hiddenAncestor(node) })),
    // 5. The composer brand target, so "TaskHive" sitting where the picker was is visible.
    composerBrand: describe(document.querySelector('[data-taskhive-composer-brand="true"]')),
    // 6. The conversation hero row: the vendor glyph and the headline share one
    //    div.headline, so a vendor mark that is visible here is the "DeepSeek icon
    //    in the conversation title" symptom (issue #5, regression note).
    heroMark: (() => {
      const slot = document.querySelector('[data-slot="conversation.hero.brand.mark"]')
      if (!slot) return null
      const headline = slot.closest('[class*="headline" i]')
      return {
        slotVisible: getComputedStyle(slot).display !== 'none',
        children: [...slot.children].map((child) => ({
          tag: child.tagName,
          ours: child.hasAttribute?.('data-taskhive-brand-mark') === true,
          visible: getComputedStyle(child).display !== 'none',
        })),
        headlineText: txt(headline).slice(0, 80),
        headlineHtml: String(headline?.innerHTML || '').replace(/\\s+/g, ' ').slice(0, 200),
      }
    })(),
  }
})()`

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    let id = 0
    const pending = new Map()
    const send = (method, params = {}) => new Promise((done) => {
      const current = ++id
      pending.set(current, done)
      socket.send(JSON.stringify({ id: current, method, params }))
    })
    socket.addEventListener('message', (message) => {
      let payload
      try { payload = JSON.parse(message.data) } catch { return }
      if (payload.id !== undefined && pending.has(payload.id)) { pending.get(payload.id)(payload); pending.delete(payload.id) }
    })
    socket.addEventListener('error', (error) => reject(new Error(`CDP connect failed: ${error?.message || error}`)))
    socket.addEventListener('open', () => resolve({ send, close: () => socket.close() }))
  })
}

let targets
try {
  targets = await (await fetch(`${base}/json`)).json()
} catch (error) {
  console.error(`Cannot reach ${base} — start TaskHive with --remote-debugging-port=${port} first.`)
  console.error(String(error?.message || error))
  process.exit(2)
}

const pages = targets.filter((target) => target.type === 'page')
if (pages.length === 0) {
  console.error('No page target: the window did not open. Check logs/errors.log first (issue #1).')
  process.exit(2)
}

for (const target of pages) {
  console.log(`\n=== page: ${String(target.url).slice(0, 110)}`)
  const session = await connect(target.webSocketDebuggerUrl)
  await session.send('Runtime.enable')
  const payload = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  if (payload.result?.exceptionDetails) {
    console.log('probe error: ' + JSON.stringify(payload.result.exceptionDetails).slice(0, 600))
    session.close()
    continue
  }
  const state = payload.result?.result?.value || {}
  console.log(`  model controls (${state.modelControls?.length || 0}):`)
  for (const node of state.modelControls || []) {
    console.log(`    ${node.tag}.${node.cls} ${JSON.stringify(node.box)} ${JSON.stringify(node.text)}${node.hiddenAncestor ? `   HIDDEN BY ${node.hiddenAncestor.tag}.${node.hiddenAncestor.cls}` : ''}`)
  }
  console.log(`  injected brand nodes (${state.injectedBrand?.length || 0}):`)
  for (const node of state.injectedBrand || []) console.log(`    ${node.kind} in ${node.parent?.tag}.${node.parent?.cls} parentText=${JSON.stringify(node.parent?.text?.slice(0, 60))}`)
  console.log(`  composer brand seat: ${JSON.stringify(state.composerBrand)}`)
  if (state.heroMark) {
    console.log(`  conversation hero row: ${JSON.stringify(state.heroMark.headlineText)}`)
    console.log(`    slot ${state.heroMark.slotVisible ? 'visible' : 'hidden'}; children: ${(state.heroMark.children || []).map((child) => `${child.tag}${child.ours ? '(ours)' : ''}=${child.visible ? 'visible' : 'hidden'}`).join(', ') || 'none'}`)
    console.log(`    headline html: ${state.heroMark.headlineHtml}`)
  }
  console.log(`  nodes the vendor finder sees (${state.vendorCandidates?.length || 0}):`)
  for (const node of state.vendorCandidates || []) console.log(`    ${node.tag}.${node.cls} ${JSON.stringify(node.box)} exact=${node.exact} size=${node.inSizeWindow} inControl=${node.inControl} text=${JSON.stringify(node.text)}`)
  console.log(`  hidden DeepSeek nodes (${state.hiddenDeepSeek?.length || 0}):`)
  for (const node of state.hiddenDeepSeek || []) console.log(`    ${JSON.stringify(node.text)} hidden by ${node.hiddenAncestor.tag}.${node.hiddenAncestor.cls} (inline=${node.hiddenAncestor.inlineDisplay})`)

  const picker = (state.modelControls || []).find((node) => !node.hiddenAncestor)
  const eatenByVendorFinder = (state.vendorCandidates || []).find((node) => node.exact === false && node.inSizeWindow && !node.inControl)
  const heroVendorVisible = (state.heroMark?.children || []).some((child) => !child.ours && child.visible)
  if (!picker) {
    console.log('  VERDICT    : NO VISIBLE MODEL CONTROL — the picker is gone. Check `injected brand nodes` and issue #5.')
  } else if (eatenByVendorFinder) {
    console.log(`  VERDICT    : VENDOR FINDER RISK — ${eatenByVendorFinder.tag}.${eatenByVendorFinder.cls} still matches a non-exact DeepSeek label inside the size window. See issue #5.`)
  } else if (heroVendorVisible) {
    console.log('  VERDICT    : HERO VENDOR MARK VISIBLE — the conversation headline still renders the vendor glyph. `reconcileSidebarBrand()` must hide it (see issue #5 regression note).')
  } else {
    console.log('  VERDICT    : MODEL PICKER VISIBLE, hero mark handled, and no non-brand node matches the vendor finder.')
  }
  session.close()
}
