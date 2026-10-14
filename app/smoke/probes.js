'use strict';

// The packaged smoke probes, extracted from app/main.js so the main process keeps
// startup, IPC, window-management and configuration responsibilities and the
// probes live in one place.
//
// Mechanical extraction: the bodies below are the originals, except that module
// state which changes at runtime is read through `ctx` (built with getters in
// main.js, so a probe always sees the current value). Nothing here runs on the
// normal path — every entry point is reached only from --smoke*/--probe*.

module.exports = function createProbes(ctx) {
  const { BrowserWindow, codesysExternalProgramLifecycle, codesysFixtureIdentityStable, codesysFixtureLifecycleSnapshot, codesysSmokeProjectPath, crypto, currentHarnessFrame, dialog, execFile, fs, hideWebAiView, modelCatalog, monitorVisibleConsoleWindows, openSurfaceForProbe, path, root, showPluginSurface, visibleConsoleWindows, webAiBounds, webAiViews, webAiWindowState, webContents } = ctx;

// ── Probe honesty ────────────────────────────────────────────────────────────
//
// A probe that computes `ok` and then returns it without acting on it can never
// fail: it writes `ok:false` into its evidence JSON while `--smoke-ui` still
// exits 0 and every "probe evidence ok=true" claim in the release notes is
// unfalsifiable. Audit 2026-10-02 found five of them — `probeNativeSettings`,
// `probeHistorySessionSwitch`, `probePluginRightSidebar` and
// `exerciseRepositorySurfaces` (all reachable from `--smoke-ui`) plus the
// workspace-geometry evidence inside `exerciseTaskHiveSurface` (whose `ok` went
// into workspace-geometry-probe.json and nowhere else). `exerciseChartSurface`
// had the same shape but is currently unreferenced.
//
// Every probe that produces an `ok` routes it through here, so "the evidence
// says false" and "the run fails" are one event. The static guard in
// tests/smoke-probe-honesty-contract.js keeps a future probe from skipping it.
//
// `skipped: true` is the only other allowed outcome, and it is deliberately
// explicit: a probe whose anchor cannot exist in this run must say so with a
// `skipReason` instead of reporting a green result it never verified. Skipping
// never fails the run; it also never claims success.
function enforceProbeResult(name, evidence) {
  if (evidence && evidence.ok === true) return evidence;
  if (evidence && evidence.skipped === true) return evidence;
  const error = new Error(`${name}-failed`);
  error.details = evidence;
  throw error;
}

async function probeSplash() {
  if (!ctx.splashWindow || ctx.splashWindow.isDestroyed()) throw new Error('splash-window-unavailable');
  if (ctx.splashWindow.webContents.isLoading()) await new Promise((resolve) => ctx.splashWindow.webContents.once('did-finish-load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await ctx.splashWindow.webContents.executeJavaScript(`(() => {
    const image = document.querySelector('.brand img');
    const bodyStyle = getComputedStyle(document.body);
    const fullSizeLayers = [...document.body.children].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
    }).length;
    return {
      title: document.title,
      background: bodyStyle.backgroundColor,
      iconLoaded: Boolean(image?.complete && image.naturalWidth > 0),
      iconWidth: image?.naturalWidth || 0,
      iconEmbedded: Boolean(image?.src.startsWith('data:image/png;base64,')),
      fullSizeLayers,
      bodyChildren: document.body.children.length,
    };
  })()`, true);
  let screenshotError = null;
  try {
    const screenshot = await ctx.splashWindow.capturePage();
    fs.writeFileSync(path.join(root, 'logs', 'ui-splash.png'), screenshot.toPNG());
  } catch (error) {
    screenshotError = error.message;
  }
  const evidence = {
    ok: state.title === 'TaskHive' && state.background === 'rgb(255, 255, 255)' && state.iconLoaded && state.iconEmbedded && state.fullSizeLayers === 0,
    ...state,
    bounds: ctx.splashWindow.getBounds(),
    windowCount: BrowserWindow.getAllWindows().length,
    screenshotError,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'splash-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error('splash-probe-failed');
}

async function probeDeepDivingDisclosure(frame) {
  // `[data-taskhive-deep-diving]` / `[data-taskhive-public-reasoning]` were
  // deleted with the shell-overlay UI; they exist in no shipped bundle today.
  // Asserting "the deleted node is absent" can therefore never fail — it is the
  // same class of lie as a probe that ignores its own `ok`. What is still a real
  // check is: WHILE the native reasoning disclosure is on screen, no TaskHive
  // overlay may hijack it. When this run has no native disclosure at all (a
  // fresh headless session renders no `[data-variant="think"]`), the probe is
  // honestly SKIPPED with a reason instead of reported green.
  const result = await frame.executeJavaScript(`(() => ({
    nativeDisclosurePresent: Boolean(document.querySelector('[data-variant="think"]')),
    nativeDisclosureAnchors: document.querySelectorAll('[data-variant="think"]').length,
    removedOverlaySelectors: ['[data-taskhive-deep-diving]', '[data-taskhive-public-reasoning]'],
    taskHiveDisclosureOverlayPresent: Boolean(document.querySelector('[data-taskhive-deep-diving],[data-taskhive-public-reasoning]')),
  }))()`, true);
  const skipped = result.taskHiveDisclosureOverlayPresent !== true && result.nativeDisclosurePresent !== true;
  const evidence = {
    ok: skipped ? false : result.taskHiveDisclosureOverlayPresent !== true,
    skipped,
    skipReason: skipped
      ? 'no-native-reasoning-disclosure-in-this-run: the TaskHive overlay selectors were removed with the shell-overlay UI, so their absence is not a pass'
      : null,
    ...result,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'deep-diving-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return enforceProbeResult('deep-diving-disclosure-probe', evidence);
}

async function probeHarnessFrames() {
  const mainFrame = ctx.mainWindow?.webContents?.mainFrame;
  const frames = mainFrame ? [mainFrame, ...(mainFrame.frames || [])] : [];
  const evidence = [];
  const frameErrors = [];
  let probedFrames = 0;
  for (const frame of frames) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(frame.url || '')) continue;
    try {
      const result = await frame.executeJavaScript(`(() => {
        const text = document.body?.innerText || '';
        const buttons = [...document.querySelectorAll('button')].map((node) => ({ text: (node.innerText || node.getAttribute('aria-label') || '').trim(), disabled: node.disabled === true }));
        const disclaimer = buttons.find((button) => /^(继续|continue)$/i.test(button.text));
        const layoutCandidates = [...document.querySelectorAll('body *')].map((node) => {
          const rect = node.getBoundingClientRect();
          return { tag: node.tagName, id: node.id, className: String(node.className || '').slice(0, 120), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), text: String(node.innerText || '').trim().slice(0, 80) };
        }).filter((item) => item.width >= 240 && item.width <= 520 && item.height >= 500 && item.x <= 20).slice(0, 20);
        const brandCandidates = [...document.querySelectorAll('body *')].filter((node) => /deepseek|harness/i.test(String(node.innerText || node.textContent || ''))).slice(0, 12).map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return { tag: node.tagName, cls: String(node.className || '').slice(0,120), text: String(node.innerText || node.textContent || '').trim().slice(0,100), display: style.display, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; });
        return { url: location.href, bodyTextLength: text.length, buttons, layoutCandidates, taskhiveSkin: Boolean(document.querySelector('#taskhive-harness-skin')), taskhiveBrand: Boolean(document.querySelector('[data-taskhive-workbench-brand]')), brandCandidates, visiblePreviewText: [...document.querySelectorAll('body *')].some((node) => node.getClientRects().length > 0 && String(node.textContent || '').trim() === '预览版'), visibleModeText: [...document.querySelectorAll('body *')].some((node) => node.getClientRects().length > 0 && String(node.textContent || '').trim() === '标准模式'), taskhiveSurfacesRegistered: window.__TASKHIVE_SURFACES_REGISTERED__ === true, taskhiveSurfaceIds: window.__TASKHIVE_SURFACE_IDS__ || [], disclaimerButtonPresent: Boolean(disclaimer), internalNoticeRemoved: window.__TASKHIVE_INTERNAL_NOTICE_REMOVED__ === true, betterSidebar: Boolean(document.querySelector('[class*="sidebar"], [data-testid*="sidebar"], aside')) };
      })()`, true);
      evidence.push(result);
      probedFrames += 1;
      // A fresh DSH profile has no active session, so Better Sidebar's
      // session-scoped tabs are intentionally not visible yet. Create an
      // isolated session through the real DSH UI, then probe the resulting
      // tab strip without launching another agent loop.
      const created = await frame.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')].find((node) => /^(新会话|new session)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`, true);
      if (created) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await frame.executeJavaScript(`(() => {
          const button = [...document.querySelectorAll('button')].find((node) => /^(选择工作区|select workspace)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
          if (!button || button.disabled) return false;
          button.click();
          return true;
        })()`, true);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const ready = await frame.executeJavaScript(`(() => (window.__TASKHIVE_SURFACE_IDS__ || []).includes('codesys') || Boolean(document.querySelector('[data-sidebar-plugin-id="codesys-monitor"]')) || [...document.querySelectorAll('button')].some((node) => /CODESYS/i.test((node.innerText || '').trim())))()`, true);
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const afterSession = await frame.executeJavaScript(`(() => {
          const text = document.body?.innerText || '';
          const buttons = [...document.querySelectorAll('button')].map((node) => ({ text: (node.innerText || node.getAttribute('aria-label') || '').trim(), disabled: node.disabled === true }));
          const inputs = [...document.querySelectorAll('input, [role="dialog"], [role="menu"]')].map((node) => ({ tag: node.tagName, type: node.getAttribute('type'), placeholder: node.getAttribute('placeholder'), text: (node.innerText || '').trim().slice(0, 400) }));
          const taskhiveButtons = buttons.filter((button) => /CODESYS|插件管理|知识库|TaskHive/i.test(button.text));
          return { bodyText: text.slice(0, 1200), bodyTextLength: text.length, buttons, inputs, taskhiveButtons, taskhiveSurfaceIds: window.__TASKHIVE_SURFACE_IDS__ || [], bodyHasCodySys: /CODESYS/i.test(text), sessionProbe: window.__TASKHIVE_SESSION_PROBE__?.snapshot?.() || null };
        })()`, true);
        evidence.push({ sessionCreated: true, ...afterSession });
      } else {
        evidence.push({ sessionCreated: false });
      }
      await probeDeepDivingDisclosure(frame);
    } catch (error) {
      const failure = { url: frame.url, error: String(error?.stack || error) };
      frameErrors.push(failure);
      evidence.push(failure);
    }
  }
  // An error raised while probing a frame used to be pushed into the evidence
  // array and then dropped on the floor (main.js discards this probe's return
  // value), so a DSH frame that rejected every `executeJavaScript` — exactly
  // what a broken bundle looks like — produced "no failures" and a green smoke.
  const report = {
    ok: probedFrames > 0 && frameErrors.length === 0,
    inspectedFrames: probedFrames,
    errorCount: frameErrors.length,
    errors: frameErrors,
    frames: evidence,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'dsh-frame-probe.json'), JSON.stringify(report, null, 2), 'utf8');
  return enforceProbeResult('dsh-frame-probe', report);
}

async function probeTaskHiveBranding(frame) {
  const result = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const brandButton = document.querySelector('[data-taskhive-workbench-brand="true"]');
    const composerBrand = document.querySelector('[data-taskhive-composer-brand="true"]');
    const permissionDuplicate = [...document.querySelectorAll('button,[role="button"],a')].find((node) => /^(?:Workspace\\s+Write|Read\\s+Only|Full\\s+access)$/i.test(String(node.textContent || '').trim()) && !node.closest('[role="dialog"]'));
    const visibleControls = [...document.querySelectorAll('button,a,[role="button"],select,input,textarea,summary')].filter(visible);
    const before = {
      permissionDuplicateVisible: visible(permissionDuplicate),
      permissionDuplicateMarked: permissionDuplicate?.dataset.taskhiveComposerPermission === 'true',
      brandButtonTaskHiveIcon: Boolean(brandButton?.querySelector('[data-taskhive-brand-icon="true"]')),
      brandButtonText: String(brandButton?.textContent || '').trim(),
      composerBrandVisible: visible(composerBrand),
      composerBrandText: String(composerBrand?.textContent || '').trim(),
      composerBrandTaskHiveIcon: Boolean(composerBrand?.querySelector('[data-taskhive-brand-icon="true"]')),
      tooltipCoverage: { controls: visibleControls.length, missing: visibleControls.filter((node) => !String(node.getAttribute('title') || '').trim()).length },
    };
    // Textual dump of the sidebar brand region. The skin has to target the real
    // markup, and the hashed DSH class names are not readable from source, so
    // record what is actually rendered instead of guessing again.
    const describe = (node) => node ? {
      tag: node.tagName,
      cls: String(node.className || '').slice(0, 90),
      slot: node.getAttribute('data-slot') || '',
      aria: String(node.getAttribute('aria-label') || '').slice(0, 60),
      title: String(node.getAttribute('title') || '').slice(0, 60),
      text: String(node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90),
      html: String(node.innerHTML || '').replace(/\\s+/g, ' ').slice(0, 220),
      w: Math.round(node.getBoundingClientRect().width),
      h: Math.round(node.getBoundingClientRect().height),
    } : null;
    const markNode = document.querySelector('[data-slot="sidebar.brand.mark"]');
    const sidebarRoot = document.querySelector('[data-pane="sidebar"], aside, [class*="sidebarCol"]');
    const sidebarBrandCandidates = [...(sidebarRoot?.querySelectorAll('button,[role="button"],a,span,div') || [])]
      .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 90 && r.left < 300; })
      .slice(0, 14)
      .map(describe);
    const deepSeekTextNodes = [...document.querySelectorAll('body *')]
      .filter((node) => node.children.length === 0 && /deepseek/i.test(String(node.textContent || '')))
      .slice(0, 10)
      .map((node) => ({ text: String(node.textContent || '').trim().slice(0, 70), parent: describe(node.parentElement), visible: visible(node) }));
    const brandAudit = { markNode: describe(markNode), brandButton: describe(document.querySelector('[data-taskhive-workbench-brand="true"]')), sidebarBrandCandidates, deepSeekTextNodes };
    // Normalise to the expanded state first, then toggle, so the audit captures
    // both layouts regardless of how the previous probe left the sidebar.
    const sidebarRootEl = () => document.querySelector('[class*="hHd-"][class*="root"], [data-pane="sidebar"], aside');
    const toggleButton = () => [...document.querySelectorAll('button')].find((node) => /hHd-.*toggle|sidebar.*toggle/i.test(String(node.className || ''))) || null;
    const isCollapsed = () => Boolean(document.querySelector('[class*="_collapsed"]'));
    const railMark = () => document.querySelector('[data-slot="sidebar.brand.mark"]');
    const logoRow = () => {
      const mark = railMark();
      return mark?.closest('[class*="logoRow"]') || document.querySelector('[class*="logoRow"]') || mark?.parentElement || null;
    };
    const captureSidebar = () => ({
      collapsed: isCollapsed(),
      sidebarClass: String(sidebarRootEl()?.className || '').slice(0, 120),
      toggleAria: String(toggleButton()?.getAttribute('aria-label') || ''),
      toggleTitle: String(toggleButton()?.getAttribute('title') || ''),
      logoRow: describe(logoRow()),
      railMark: describe(railMark()),
      // The mark is the TaskHive program icon, i.e. an <img>, so capture the
      // element itself rather than an <svg> (which is only the pre-icon
      // placeholder).
      brandMark: String(railMark()?.querySelector('[data-taskhive-brand-mark="true"]')?.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 200),
      brandMarkTag: String(railMark()?.querySelector('[data-taskhive-brand-mark="true"]')?.tagName || ''),
      brandMarkSrc: String(railMark()?.querySelector('[data-taskhive-brand-mark="true"]')?.getAttribute('src') || '').slice(0, 22),
      railSvg: String(railMark()?.querySelector('svg')?.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 160),
      logoRowText: String(logoRow()?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    });
    if (isCollapsed()) { toggleButton()?.click(); await wait(450); }
    // The skin re-applies after React commits, so poll for the mark instead of
    // reading once: a single read races the re-render and reports the vendor
    // logo that React just restored.
    const waitForBrand = async (timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const el = document.querySelector('[data-slot="sidebar.brand.mark"] [data-taskhive-brand-mark="true"]');
        const mark = document.querySelector('[data-slot="sidebar.brand.name"] [data-taskhive-brand-wordmark="true"]');
        if (el && el.tagName === 'IMG' && mark) return true;
        await wait(120);
      }
      return false;
    };
    brandAudit.brandSettledExpanded = await waitForBrand();
    brandAudit.expandedSidebar = captureSidebar();
    if (!isCollapsed()) { toggleButton()?.click(); await wait(450); }
    brandAudit.brandSettledCollapsed = await waitForBrand();
    brandAudit.collapsedSidebar = captureSidebar();
    const collapseControl = toggleButton();
    let collapsed = { exercised: Boolean(collapseControl), width: 0, sidebarRailIcon: false, taskhiveTextHidden: false, ariaLabel: '' };
    if (collapseControl) {
      const rect = collapseControl.getBoundingClientRect();
      collapsed = {
        exercised: true,
        width: Math.round(rect?.width || 0),
        sidebarRailIcon: Boolean(railMark()?.querySelector('[data-taskhive-sidebar-rail-icon="true"]')),
        taskhiveTextHidden: !/deepseek/i.test(String(logoRow()?.textContent || '')),
        ariaLabel: collapseControl.getAttribute('aria-label') || '',
      };
      // Leave the sidebar expanded again for the remaining probes.
      if (isCollapsed()) { collapseControl.click(); await wait(450); }
    }
    const visibleDeepSeek = [...document.querySelectorAll('body *')].some((node) => visible(node) && node.children.length === 0 && /^(DeepSeek|DeepSeek Harness|Harness)$/i.test(String(node.textContent || '').trim()));
    // The sidebar mark must be the TaskHive program icon. DSH ships a vendor
    // logo in this slot and a plain panel glyph is not the app's identity, so
    // assert the real icon: an <img data-taskhive-brand-mark> whose src is the
    // host-supplied data URL.
    const markEl = document.querySelector('[data-slot="sidebar.brand.mark"] [data-taskhive-brand-mark="true"]');
    // NOTE: this is inside a template literal, so regex escapes must be doubled.
    // A single backslash-slash is dropped by the template and emits a regex that
    // ends early, producing a syntax error at this exact line.
    const brandMarkIsProgramIcon = Boolean(markEl && markEl.tagName === 'IMG' && /^data:image\\//.test(String(markEl.getAttribute('src') || '')));
    const foreignRailIcons = [...document.querySelectorAll('[data-slot="sidebar.brand.mark"] img,[data-slot="sidebar.brand.mark"] svg')].filter((icon) => visible(icon) && !icon.hasAttribute('data-taskhive-brand-mark')).length;
    // The wordmark is an SVG, not text, so it is checked structurally: the slot
    // must carry our span and must not still hold a vendor glyph SVG.
    const nameSlot = document.querySelector('[data-slot="sidebar.brand.name"]');
    const wordmarkReplaced = Boolean(nameSlot?.querySelector('[data-taskhive-brand-wordmark="true"]'));
    const foreignWordmark = Boolean(nameSlot?.querySelector('svg'));
    const visibleInternalNotice = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some((node) => visible(node) && /(内测|测试版本|预览版|免责声明|preview|beta|DeepSeek\\s+Harness)/i.test(String(node.textContent || '')));
    // Theme evidence: the injected TaskHive tokens must resolve, and the old
    // forced monochrome block must be gone. A grayscale surface was the visible
    // complaint, so assert the accent actually reaches the DOM.
    const themeProbe = {
      brandToken: getComputedStyle(document.documentElement).getPropertyValue('--th-brand').trim(),
      brandTint: getComputedStyle(document.documentElement).getPropertyValue('--th-brand-tint').trim(),
      inkToken: getComputedStyle(document.documentElement).getPropertyValue('--th-ink').trim(),
      forcedMonochromeRules: [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((rule) => String(rule.cssText || '')) } catch { return [] } }).filter((text) => /#cfcfcf!important|background:#f7f7f7!important/.test(text)).length,
    };
    const primarySurface = [...document.querySelectorAll('textarea,[contenteditable="true"],[data-conversation-scroll],[data-taskhive-sidebar-plugins]')].some(visible);
    return {
      before, collapsed, primarySurface, brandAudit, themeProbe,
      restored: wordmarkReplaced,
      railGlyphApplied: brandMarkIsProgramIcon,
      brandMarkIsProgramIcon,
      brandMarkSrcPrefix: String(markEl?.getAttribute('src') || '').slice(0, 22),
      wordmarkReplaced, foreignWordmark,
      visibleDeepSeek, foreignRailIcons, visibleInternalNotice,
      internalNoticeRemoved: window.__TASKHIVE_INTERNAL_NOTICE_REMOVED__ === true,
    };
  })()`, true);
  const evidence = {
    // `collapsed.sidebarRailIcon` is reported as evidence but deliberately not
    // part of `ok`: alpha.2 does not change the sidebar width in a headless
    // smoke run, so the collapsed branch cannot be exercised reliably here.
    // Criteria are derived from the markup DSH 0.1.3-alpha.2 actually renders,
    // dumped from the live frame:
    //   * the vendor logo lives in [data-slot="sidebar.brand.mark"] and the
    //     vendor wordmark in [data-slot="sidebar.brand.name"] as an SVG of glyph
    //     outlines, so text-only checks can never see it;
    //   * there is no composer brand and no `_brand` button with text, so the
    //     old criteria for those are gone rather than silently skipped.
    ok: result.railGlyphApplied === true
      && result.brandMarkIsProgramIcon === true
      && String(result.brandMarkSrcPrefix || '').startsWith('data:image/')
      && result.wordmarkReplaced === true
      && result.foreignRailIcons === 0
      && result.foreignWordmark === false
      && result.visibleDeepSeek === false
      && result.visibleInternalNotice === false
      && result.primarySurface === true
      && result.brandAudit?.collapsedSidebar?.brandMarkTag === 'IMG'
      && result.brandAudit?.collapsedSidebar?.brandMarkSrc === 'data:image/png;base64,'
      && result.brandAudit?.expandedSidebar?.brandMarkTag === 'IMG'
      && result.themeProbe?.brandToken === '#4f6ef2'
      && result.themeProbe?.forcedMonochromeRules === 0,
    theme: 'taskhive-1.0.2',
    ...result,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'ui-branding-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  // main.js checks `ok` at the end of --smoke-ui, but the same probe is also
  // called mid-sequence from exerciseTaskHiveSurface where the result was only
  // recorded. Enforcing it here makes both call sites fail on the same evidence.
  return enforceProbeResult('ui-branding-probe', evidence);
}

async function probeNativeSettings() {
  const beforeWindows = BrowserWindow.getAllWindows().map((win) => ({ id: win.id, title: win.getTitle(), bounds: win.getBounds(), url: win.webContents.getURL() }));
  let frame = null;
  for (let attempt = 0; attempt < 80 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) {
    // No DSH frame means the workbench never rendered, so nothing about the
    // native settings surface was verified. Recorded as an explicit skip (with
    // the reason) rather than as a quiet "status: runtime-unverified" object a
    // caller can ignore.
    const evidence = { skipped: true, ok: false, skipReason: 'dsh-frame-not-found', status: 'runtime-unverified', reason: 'dsh-frame-not-found', beforeWindows, afterWindows: BrowserWindow.getAllWindows().map((win) => ({ id: win.id, title: win.getTitle(), bounds: win.getBounds(), url: win.webContents.getURL() })), at: new Date().toISOString() };
    fs.writeFileSync(path.join(root, 'logs', 'native-settings-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
    return enforceProbeResult('native-settings-probe', evidence);
  }
  const controls = await frame.executeJavaScript(`(() => [...document.querySelectorAll('button,[role="button"],a')].map((node, index) => ({ index, tag: node.tagName, text: (node.innerText || '').trim().slice(0, 100), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), testid: node.getAttribute('data-testid'), cls: String(node.className || '').slice(0, 140), href: node.getAttribute('href'), disabled: node.disabled === true })).slice(0, 120))()`, true);
  const composerPermission = await frame.executeJavaScript(`(() => {
    const node = [...document.querySelectorAll('button,[role="button"]')].find((item) => !item.closest('[role="dialog"],[aria-modal="true"]') && /访问模式，当前：|^(Workspace Write|Read Only|Danger Full Access|Full access)$/i.test(String(item.getAttribute('aria-label') || item.innerText || '').trim()));
    if (!node) return { found: false, visible: false, marked: false, text: '' };
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return { found: true, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', marked: node.dataset.taskhiveComposerPermission === 'true', text: String(node.innerText || '').trim() };
  })()`, true);
  const clicked = await frame.executeJavaScript(`(() => { const nodes = [...document.querySelectorAll('button,[role="button"],a')]; const node = nodes.find((item) => item.getAttribute('aria-haspopup') === 'dialog') || nodes.find((item) => /^(settings|设置|设定|preferences?)$/i.test((item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim())) || nodes.find((item) => /settings|preferences|设置/i.test([item.innerText, item.getAttribute('aria-label'), item.getAttribute('title'), item.getAttribute('data-testid')].join(' '))); if (!node) return { clicked: false }; node.click(); return { clicked: true, text: (node.innerText || '').trim(), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), testid: node.getAttribute('data-testid'), ariaHasPopup: node.getAttribute('aria-haspopup') }; })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const native = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const dialog = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find(visible);
    if (!dialog) return { dialog: null, reason: 'settings-dialog-not-found' };
    const rect = dialog.getBoundingClientRect();
    const navButtons = [...dialog.querySelectorAll('nav button,nav [role="button"]')];
    const tabs = navButtons.map((node, index) => ({ index, text: String(node.innerText || '').trim(), visible: visible(node), display: getComputedStyle(node).display }));
    const generalButton = navButtons.find((node) => /^(通用设置|General)$/i.test(String(node.innerText || '').trim()));
    generalButton?.click();
    await wait(350);
    const generalText = String(dialog.innerText || '');
    const readDirectoryState = () => {
      const directories = document.querySelector('[data-taskhive-settings-directories="true"]');
      const list = directories?.querySelector('[data-directory-list="true"]');
      const listRect = list?.getBoundingClientRect();
      const rows = [...(directories?.querySelectorAll('[data-directory-row]') || [])].map((row) => {
        const rowRect = row.getBoundingClientRect();
        const inputs = [...row.querySelectorAll('input')].map((input) => {
          const inputRect = input.getBoundingClientRect();
          return { aria: input.getAttribute('aria-label') || '', x: Math.round(inputRect.x), y: Math.round(inputRect.y), width: Math.round(inputRect.width), height: Math.round(inputRect.height) };
        });
        const actions = row.querySelector('[data-directory-actions="true"]')?.getBoundingClientRect();
        return { id: row.getAttribute('data-directory-row'), x: Math.round(rowRect.x), y: Math.round(rowRect.y), width: Math.round(rowRect.width), height: Math.round(rowRect.height), inputs, actions: actions ? { x: Math.round(actions.x), y: Math.round(actions.y), width: Math.round(actions.width), height: Math.round(actions.height) } : null };
      });
      return {
        visible: visible(directories),
        expanded: directories?.open === true,
        count: directories?.querySelectorAll('code').length || 0,
        rowCount: rows.length,
        text: String(directories?.innerText || ''),
        list: listRect ? { x: Math.round(listRect.x), y: Math.round(listRect.y), width: Math.round(listRect.width), height: Math.round(listRect.height), clientWidth: list.clientWidth, scrollWidth: list.scrollWidth } : null,
        rows,
        horizontalOverflow: Boolean(list && list.scrollWidth > list.clientWidth + 1),
      };
    };
    const directoryDetails = document.querySelector('[data-taskhive-settings-directories="true"]');
    if (directoryDetails) directoryDetails.open = true;
    directoryDetails?.scrollIntoView({ block: 'start' });
    await wait(400);
    let directoryState = readDirectoryState();
    const permissionTrigger = [...dialog.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && (/访问模式|权限模式/.test([node.getAttribute('aria-label'), node.getAttribute('title')].join(' ')) || /^(Workspace Write|Read Only|Danger Full Access|只读|工作区写入|完整访问)$/i.test(String(node.innerText || '').trim())));
    permissionTrigger?.click();
    await wait(250);
    const permissionText = [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="radio"],button')].filter(visible).map((node) => String(node.innerText || node.getAttribute('aria-label') || '').trim()).filter((text) => /(Read.?Only|Workspace.?Write|(?:Danger.?)?Full.?Access|只读|工作区写入|完整访问)/i.test(text));
    permissionTrigger?.click();
    await wait(150);
    const inspectTab = async (label) => {
      const candidates = navButtons.filter((node) => new RegExp('^' + label + '$', 'i').test(String(node.innerText || '').trim()));
      const results = [];
      for (const node of candidates) {
        node.click();
        await wait(300);
        if (/插件|Plugins?/i.test(label)) {
          const inventoryTab = [...dialog.querySelectorAll('button,[role="button"]')].find((candidate) => visible(candidate) && /^(本地插件|Local Plugins?)$/i.test(String(candidate.innerText || '').trim()));
          inventoryTab?.click();
          for (let attempt = 0; attempt < 80 && !document.querySelector('[data-taskhive-plugin-inventory="true"] [data-plugin-row]'); attempt += 1) await wait(100);
        }
        const inventoryRows = [...document.querySelectorAll('[data-taskhive-plugin-inventory="true"] [data-plugin-row]')].map((row) => ({
          id: row.getAttribute('data-plugin-row'), source: row.getAttribute('data-plugin-source'), type: row.getAttribute('data-plugin-type'), health: row.getAttribute('data-plugin-health'),
          placement: row.querySelector('select')?.value || null,
          disabledActions: [...row.querySelectorAll('button')].filter((button) => button.disabled).length,
          text: String(row.innerText || '').replace(/\s+/g, ' ').trim(),
        }));
        results.push({
          visible: visible(node),
          modelCatalog: Boolean(document.querySelector('[data-taskhive-model-settings="true"]')),
          pluginInventory: Boolean(document.querySelector('[data-taskhive-plugin-inventory="true"]')),
          inventoryRows,
          text: String(dialog.innerText || '').slice(0, 1800),
        });
      }
      return results;
    };
    const modelTabs = await inspectTab('模型|Models?');
    const pluginTabs = await inspectTab('插件|Plugins?');
    let permissionPriority = { requested: ${process.argv.includes('--probe-permission-priority') ? 'true' : 'false'} };
    if (permissionPriority.requested) {
      generalButton?.click();
      await wait(300);
      const trigger = [...dialog.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && (/访问模式|权限模式/.test([node.getAttribute('aria-label'), node.getAttribute('title')].join(' ')) || /^(Workspace Write|Read Only|Danger Full Access|Full access|只读|工作区写入|完整访问)$/i.test(String(node.innerText || '').trim())));
      const initial = String(trigger?.innerText || '').trim();
      trigger?.click();
      await wait(250);
      const fullOption = [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="radio"],button')].find((node) => visible(node) && /^(Danger Full Access|Full access|完整访问)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
      fullOption?.click();
      await wait(300);
      const riskDialog = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find((node) => visible(node) && /Full access|完整访问/i.test(String(node.innerText || '')) && node !== dialog);
      const acknowledgement = riskDialog?.querySelector('input[type="checkbox"],[role="checkbox"]');
      acknowledgement?.click();
      await wait(120);
      const confirmFullAccess = [...(riskDialog?.querySelectorAll('button') || [])].find((node) => /启用 Full access|Enable Full access|确认启用/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
      confirmFullAccess?.click();
      await wait(900);
      const selectedDefault = String(trigger?.innerText || '').trim();
      const close = [...dialog.querySelectorAll('button')].find((node) => /^(关闭设置|关闭|close settings|close)$/i.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim()));
      close?.click();
      await wait(500);
      const currentAccess = [...document.querySelectorAll('button,[role="button"]')].find((node) => !node.closest('[role="dialog"]') && /访问模式，当前：|^(Workspace Write|Read Only|Danger Full Access|Full access)$/i.test(String(node.getAttribute('aria-label') || node.innerText || '').trim()));
      const currentSession = String(currentAccess?.innerText || '').trim();
      const newSessionButton = [...document.querySelectorAll('button,[role="button"]')].find((node) => !node.closest('[role="dialog"]') && /^(新会话|new session)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
      newSessionButton?.click();
      await wait(700);
      const newSessionAccess = [...document.querySelectorAll('button,[role="button"]')].find((node) => !node.closest('[role="dialog"]') && /访问模式，当前：|^(Workspace Write|Read Only|Danger Full Access|Full access)$/i.test(String(node.getAttribute('aria-label') || node.innerText || '').trim()));
      const nextSession = String(newSessionAccess?.innerText || '').trim();
      permissionPriority = {
        requested: true,
        initial,
        selectedDefault,
        confirmation: { shown: Boolean(riskDialog), acknowledged: Boolean(acknowledgement), confirmed: Boolean(confirmFullAccess) },
        currentSession,
        nextSession,
        newSessionClicked: Boolean(newSessionButton),
        currentSessionSynced: /Full access|Danger Full Access|完整访问/i.test(currentSession),
        newSessionInherited: /Full access|Danger Full Access|完整访问/i.test(nextSession),
      };
    }
    if (!permissionPriority.requested) {
      generalButton?.click();
      await wait(300);
      const currentDirectories = document.querySelector('[data-taskhive-settings-directories="true"]');
      if (currentDirectories) currentDirectories.open = true;
      currentDirectories?.scrollIntoView({ block: 'start' });
      await wait(400);
      directoryState = readDirectoryState();
    }
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      dialog: { role: dialog.getAttribute('role'), ariaModal: dialog.getAttribute('aria-modal'), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      tabs,
      general: {
        presetModeVisible: /标准模式|预设模式/i.test(generalText),
        workspaceWriteVisible: /Workspace\\s+Write/i.test(generalText),
        permissionTrigger: Boolean(permissionTrigger),
        permissionOptions: [...new Set(permissionText)],
      },
      directories: directoryState,
      modelTabs,
      pluginTabs,
      permissionPriority,
      agentPresetTabVisible: tabs.some((item) => item.visible && /^Agent 预设$/i.test(item.text)),
      bodyText: String(document.body?.innerText || '').slice(-2200),
    };
  })()`, true);
  let directoryScreenshot = null;
  let directoryScreenshotError = null;
  if (!process.argv.includes('--probe-permission-priority') && native.directories?.expanded === true) {
    try {
      const image = await ctx.mainWindow.webContents.capturePage();
      directoryScreenshot = path.join('logs', 'directory-settings-ui.png');
      fs.writeFileSync(path.join(root, directoryScreenshot), image.toPNG());
    } catch (error) {
      directoryScreenshotError = error.message;
    }
  }
  const afterWindows = BrowserWindow.getAllWindows().map((win) => ({ id: win.id, title: win.getTitle(), bounds: win.getBounds(), url: win.webContents.getURL() }));
  const modelCatalogVisible = native.modelTabs?.some((item) => item.modelCatalog === true);
  const pluginInventoryVisible = native.pluginTabs?.some((item) => item.pluginInventory === true);
  const inventoryRows = native.pluginTabs?.flatMap((item) => item.inventoryRows || []) || [];
  const pluginMetadataComplete = inventoryRows.length >= 10 && inventoryRows.every((item) => item.source && item.type && item.health && /入口：/.test(item.text));
  const backgroundEntryBoundary = inventoryRows.filter((item) => item.type !== 'surface').every((item) => item.placement === null && /无侧栏界面/.test(item.text));
  const protectedBoundary = inventoryRows.filter((item) => /taskhive-surfaces|better-sidebar|dsh-genui|taskhive-codex-model/.test(item.id || '')).every((item) => item.disabledActions >= 2);
  const permissionModes = native.general?.permissionOptions || [];
  const permissionPriorityOk = !process.argv.includes('--probe-permission-priority') || (native.permissionPriority?.currentSessionSynced === true && native.permissionPriority?.newSessionInherited === true);
  const composerPermissionHidden = composerPermission.found === false || (composerPermission.visible === false && composerPermission.marked === true);
  const directoryLayoutOk = native.directories?.visible === true
    && native.directories?.expanded === true
    && native.directories?.count >= 8
    && native.directories?.rowCount >= 9
    && native.directories?.horizontalOverflow === false
    && native.directories?.rows?.every((row) => row.width <= (native.directories.list?.clientWidth || 0) + 1 && row.inputs.length >= (row.id === 'new' ? 4 : 3) && row.actions?.width > 0);
  const ok = native.dialog?.ariaModal === 'true' && native.general?.presetModeVisible === true && native.general?.workspaceWriteVisible === true && permissionModes.length >= 3 && composerPermissionHidden && directoryLayoutOk && modelCatalogVisible && pluginInventoryVisible && native.agentPresetTabVisible === false && pluginMetadataComplete && backgroundEntryBoundary && protectedBoundary && permissionPriorityOk && afterWindows.length === beforeWindows.length;
  const evidence = { status: ok ? 'verified' : 'failed', ok, beforeWindows, afterWindows, windowCountChanged: afterWindows.length !== beforeWindows.length, composerPermission, composerPermissionHidden, pluginMetadataComplete, backgroundEntryBoundary, protectedBoundary, directoryLayoutOk, directoryScreenshot, directoryScreenshotError, controls, clicked, native, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'native-settings-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'logs', 'directory-settings-ui-probe.json'), JSON.stringify({ ok: directoryLayoutOk && Boolean(directoryScreenshot) && !directoryScreenshotError, directoryLayoutOk, directoryScreenshot, directoryScreenshotError, directories: native.directories, dialog: native.dialog, at: evidence.at }, null, 2), 'utf8');
  if (process.argv.includes('--probe-permission-priority')) fs.writeFileSync(path.join(root, 'logs', 'permission-priority-probe.json'), JSON.stringify({ ok: permissionPriorityOk, modes: permissionModes, ...native.permissionPriority, pluginOverride: false, owner: 'Harness/DSH', at: evidence.at }, null, 2), 'utf8');
  // `ok` above was computed and then thrown away: the probe only returned it and
  // both of its call sites ignored the value, so a settings dialog that failed
  // every criterion still produced no failure anywhere.
  return enforceProbeResult('native-settings-probe', evidence);
}

async function probeCodesysWorkbenchProject(frame) {
  const projectPath = codesysSmokeProjectPath();
  if (!projectPath) return { ok: false, skipped: true, reason: 'smoke-project-not-configured' };
  const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const beforeSha256 = sha256(projectPath);
  const opened = await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const button = workbench?.querySelector('[data-codesys-select-project="true"]');
    const detect = workbench?.querySelector('[data-codesys-detect-project="true"]');
    const status = workbench?.querySelector('[data-codesys-workbench-status="true"]')?.textContent || '';
    if (/正在检测|正在识别|正在绑定/.test(status)) return { clicked: false, auto: true, status };
    if (detect && !detect.disabled) { detect.click(); return { clicked: true, auto: true, status }; }
    if (button && !button.disabled) { button.click(); return { clicked: true, auto: false, status }; }
    return { clicked: false, auto: true, status };
  })()`, true);
  const loaded = await frame.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 60000;
    const check = () => {
      const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
      const status = workbench?.querySelector('[data-codesys-workbench-status="true"]')?.textContent || '';
      const sourcePath = workbench?.querySelector('[data-codesys-project-path="true"]')?.value || '';
      const objectCount = workbench?.querySelectorAll('[data-codesys-project-tree="true"] [role="treeitem"]').length || 0;
      if (/工程读取失败/.test(status) || (/已完整读取/.test(status) && sourcePath && objectCount > 0) || Date.now() >= deadline) return resolve({ status, sourcePath, objectCount, timedOut: Date.now() >= deadline });
      setTimeout(check, 100);
    };
    check();
  })`, true);
  await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const selected = workbench?.querySelector('[data-codesys-object-has-code="true"][aria-selected="true"]');
    const firstCode = workbench?.querySelector('[data-codesys-object-has-code="true"]');
    if (!selected && firstCode) firstCode.click();
    return Boolean(selected || firstCode);
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const snapshot = await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const pathInput = workbench?.querySelector('[data-codesys-project-path="true"]');
    const treeRows = [...(workbench?.querySelectorAll('[data-codesys-project-tree="true"] [role="treeitem"]') || [])].map((node) => ({
      name: node.getAttribute('data-codesys-object-name') || '',
      guid: node.getAttribute('data-codesys-object-guid') || '',
      type: node.getAttribute('data-codesys-object-type') || '',
      kind: node.getAttribute('data-node-kind') || '',
      category: node.getAttribute('data-node-category') || '',
      depth: Number(node.getAttribute('data-node-depth') || 0),
      children: Number(node.getAttribute('data-node-children') || 0),
      expanded: node.getAttribute('aria-expanded') || '',
      hasCode: node.getAttribute('data-codesys-object-has-code') === 'true',
      libraryManager: node.getAttribute('data-codesys-object-library-manager') === 'true',
      selected: node.getAttribute('aria-selected') === 'true',
      title: node.getAttribute('title') || '',
    }));
    // Group rows (device / Plc Logic / application / folder) are real treeitem
    // nodes without a project GUID, so the GUID assertions read object rows only.
    const objectItems = treeRows.filter((item) => item.guid);
    const grouped = {};
    for (const item of objectItems) (grouped[item.name] ||= []).push(item.guid);
    const duplicateNameGuidGroups = Object.fromEntries(Object.entries(grouped).filter(([, guids]) => guids.length > 1));
    const editor = workbench?.querySelector('[data-codesys-code-editor="true"]');
    // CODESYS keeps the declaration and the implementation in two independently
    // numbered edit areas; the probe reads both so the line numbers can be
    // checked against each section instead of one concatenated buffer.
    const declarationEditor = workbench?.querySelector('[data-editor-part="declaration"]');
    const implementationEditor = workbench?.querySelector('[data-editor-part="implementation"]');
    const editorSections = [...(workbench?.querySelectorAll('[data-editor-section]') || [])].map((node) => ({
      id: node.getAttribute('data-editor-section') || '',
      lines: (node.querySelector('textarea')?.value || '').split('\n').length,
      gutterLines: node.querySelectorAll('.taskhive-codesys-line-gutter span').length,
      firstGutterNumber: node.querySelector('.taskhive-codesys-line-gutter span')?.textContent || '',
      changedLines: node.getAttribute('data-section-changed-lines') || '',
    }));
    const meta = workbench?.querySelector('[data-codesys-code-diff="true"]');
    const preview = workbench?.querySelector('[data-codesys-preview-guid]');
    const copy = workbench?.querySelector('[data-codesys-copy-project-path="true"]');
    const reveal = workbench?.querySelector('[data-codesys-reveal-project="true"]');
    const api = window.__TASKHIVE_CODESYS_WORKBENCH__;
    // Exercise the pure classification/hierarchy seam on synthetic CODESYS data
    // (the same object-type GUIDs the engine reports). The rendered DOM alone
    // cannot prove the logic, and it must keep working without a real project.
    const KINDS = { device: '225bfe47-7336-4dbc-9419-4105a7c831fa', plcLogic: '40b404f9-e5dc-42c6-907f-c89f4a517386', application: '639b491f-5557-464c-af91-1471bac9f549', libraryManager: 'adb5cb65-8e1d-4a00-b70a-375ea27582f3', pou: '6f9dac99-8de1-4efc-8465-68ac443b7d08' };
    const synthetic = [
      { name: 'Device', guid: 'g-dev', type: KINDS.device },
      { name: 'Plc Logic', guid: 'g-plc', type: KINDS.plcLogic, parentGuid: 'g-dev' },
      { name: 'Application', guid: 'g-app', type: KINDS.application, parentGuid: 'g-plc', isApplication: true },
      { name: 'Library Manager', guid: 'g-lib', type: KINDS.libraryManager, parentGuid: 'g-app' },
      { name: 'PLC_PRG', guid: 'g-pou', type: KINDS.pou, parentGuid: 'g-app', hasDeclaration: true, hasImplementation: true },
    ];
    const seam = api ? {
      version: api.version,
      kinds: synthetic.map((item) => api.kindOf(item).kind),
      tree: api.buildTree(synthetic),
      codeOnly: api.filterKeys(synthetic, 'code').length,
      deviceOnly: api.filterKeys(synthetic, 'device').length,
    } : null;
    const editorValue = editor?.value || '';
    return {
      sourcePath: pathInput?.value || '',
      sourceTitle: pathInput?.getAttribute('title') || '',
      jobId: workbench?.getAttribute('data-codesys-job-id') || '',
      treeRows,
      treeKinds: [...new Set(treeRows.map((item) => item.kind).filter(Boolean))],
      treeMaxDepth: treeRows.reduce((max, item) => Math.max(max, item.depth), 0),
      treeGroups: treeRows.filter((item) => item.children > 0).length,
      treeCollapsed: treeRows.filter((item) => item.expanded === 'false').length,
      objectItems,
      duplicateNameGuidGroups,
      uniqueGuidCount: new Set(objectItems.map((item) => item.guid)).size,
      editor: { present: Boolean(editor), chars: editorValue.length, text: editorValue.slice(0, 4000), changedLines: meta?.getAttribute('data-changed-lines') || '', highlightRows: workbench?.querySelectorAll('[data-codesys-editor-highlights] .taskhive-codesys-highlight-row').length || 0, sections: editorSections, declaration: declarationEditor?.value || '', implementation: implementationEditor?.value || '' },
      hierarchy: (api && api.getState && api.getState()?.hierarchy) || null,
      seam,
      preview: { name: preview?.getAttribute('data-codesys-preview-name') || '', guid: preview?.getAttribute('data-codesys-preview-guid') || '' },
      codeText: editorValue,
      diffRows: 0,
      syntaxHighlightTokens: 0,
      status: workbench?.querySelector('[data-codesys-workbench-status="true"]')?.textContent || '',
      pathActions: { copyPresent: Boolean(copy), revealPresent: Boolean(reveal) },
      absolutePath: /^[A-Za-z]:[\\/]/.test(pathInput?.value || ''),
    };
  })()`, true);
  // Expand/collapse and the code/device filter must actually work in the DOM,
  // not merely exist as attributes.
  const treeToggle = await frame.executeJavaScript(`new Promise((resolve) => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const tree = workbench?.querySelector('[data-codesys-project-tree="true"]');
    const rows = () => [...(tree?.querySelectorAll('[role="treeitem"]') || [])];
    const group = rows().find((node) => Number(node.getAttribute('data-node-children') || 0) > 0);
    if (!tree || !group) return resolve({ ok: false, reason: 'no-group-row' });
    const before = rows().length;
    const expandedBefore = group.getAttribute('aria-expanded');
    group.querySelector('[data-twisty]')?.click();
    setTimeout(() => {
      const after = rows().length;
      const expandedAfter = group.getAttribute('aria-expanded');
      group.querySelector('[data-twisty]')?.click();
      setTimeout(() => resolve({ ok: expandedBefore !== expandedAfter && after !== before && rows().length === before, group: group.getAttribute('data-codesys-object-name') || '', before, after, restored: rows().length, expandedBefore, expandedAfter }), 150);
    }, 150);
  })`, true);
  const treeFilterProbe = await frame.executeJavaScript(`new Promise((resolve) => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const tree = workbench?.querySelector('[data-codesys-project-tree="true"]');
    const codeButton = workbench?.querySelector('[data-codesys-tree-filter="code"]');
    const allButton = workbench?.querySelector('[data-codesys-tree-filter="all"]');
    const rows = () => [...(tree?.querySelectorAll('[role="treeitem"]') || [])];
    if (!tree || !codeButton || !allButton) return resolve({ ok: false, reason: 'no-filter-controls' });
    const codeBefore = rows().filter((node) => node.getAttribute('data-node-category') === 'code').length;
    const allBefore = rows().length;
    codeButton.click();
    setTimeout(() => {
      const codeAfter = rows().filter((node) => node.getAttribute('data-node-category') === 'code').length;
      const allAfter = rows().length;
      window.__TASKHIVE_TREE_FILTER_EVIDENCE__ = { codeBefore, codeAfter, allBefore, allAfter };
      allButton.click();
      setTimeout(() => resolve({ ok: codeBefore > 0 && codeAfter === codeBefore && allAfter > 0 && allAfter < allBefore && rows().length === allBefore, codeBefore, codeAfter, allBefore, allAfter, restored: rows().length === allBefore }), 150);
    }, 150);
  })`, true);
  // T097: 「复制当前工程绝对路径」与「在资源管理器定位当前工程」已按用户要求移除，所以这里
  // 不再点它们，而是**断言它们不存在**（被重新加回来会立刻让探针失败）。路径本身仍在
  // 只读输入框里可选中复制，所以同时断言那个输入框还在。
  const pathRemoval = await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    return {
      copyPresent: Boolean(workbench?.querySelector('[data-codesys-copy-project-path="true"]')),
      revealPresent: Boolean(workbench?.querySelector('[data-codesys-reveal-project="true"]')),
      pathInputReadable: Boolean(workbench?.querySelector('[data-codesys-project-path="true"]')),
    };
  })()`, true);
  const pathRemovalVerified = pathRemoval.copyPresent === false && pathRemoval.revealPresent === false && pathRemoval.pathInputReadable === true;
  let screenshot = null;
  let screenshotError = null;
  try {
    screenshot = path.join('logs', 'codesys-workbench-project.png');
    fs.writeFileSync(path.join(root, screenshot), (await ctx.mainWindow.webContents.capturePage()).toPNG());
  } catch (error) { screenshotError = String(error?.message || error); }
  const afterSha256 = sha256(projectPath);
  const jobsRoot = path.resolve(root, 'workspaces', 'codesys-scriptengine', 'jobs');
  const jobDir = path.resolve(jobsRoot, snapshot.jobId || '.');
  const relativeJob = path.relative(jobsRoot, jobDir);
  const cleanupAllowed = /^direct-[A-Za-z0-9-]+$/.test(snapshot.jobId || '') && relativeJob && !relativeJob.startsWith(`..${path.sep}`) && relativeJob !== '..' && !path.isAbsolute(relativeJob);
  let cleanedJob = false;
  if (cleanupAllowed && fs.existsSync(jobDir)) { fs.rmSync(jobDir, { recursive: true, force: true }); cleanedJob = !fs.existsSync(jobDir); }
  const expectedPath = projectPath.toLowerCase();
  const absolutePathVerified = path.isAbsolute(snapshot.sourcePath);
  const duplicateGuidVerified = Object.values(snapshot.duplicateNameGuidGroups || {}).some((guids) => guids.length >= 2 && new Set(guids.filter(Boolean)).size === guids.length);
  // The tree must be a real multi-level CODESYS tree whenever the engine could
  // report parent links; on a build whose walk found none, every object is an
  // ungrouped root and only the flat expectations apply (recorded honestly).
  const hierarchyGrouped = Number(snapshot.hierarchy?.grouped || 0);
  const treeStructureVerified = snapshot.treeKinds.length >= 2 && (hierarchyGrouped > 0 ? snapshot.treeMaxDepth >= 1 && snapshot.treeGroups >= 1 : true);
  const treeInteractionVerified = hierarchyGrouped > 0 ? (treeToggle.ok === true && treeFilterProbe.ok === true) : true;
  const seamVerified = Boolean(snapshot.seam)
    && snapshot.seam.tree.maxDepth === 3
    && snapshot.seam.tree.roots === 1
    && snapshot.seam.kinds.join(',') === 'device,plc-logic,application,library-manager,pou'
    && snapshot.seam.codeOnly === 1
    && snapshot.seam.deviceOnly === 4;
  // CODESYS numbers the declaration and the implementation independently, each
  // from line 1. The line numbers used to be continuous across one concatenated
  // textarea, so the implementation's numbering was offset by the declaration.
  const editorSections = Array.isArray(snapshot.editor.sections) ? snapshot.editor.sections : [];
  const sectionNumberingVerified = editorSections.length >= 1
    && editorSections.every((section) => section.firstGutterNumber === '1' && section.gutterLines === section.lines && section.lines >= 1);
  const evidence = {
    ok: (opened.clicked === true || opened.auto === true) && loaded.timedOut !== true && /已完整读取/.test(snapshot.status) && snapshot.sourcePath.toLowerCase() === expectedPath && snapshot.sourceTitle.toLowerCase() === expectedPath && absolutePathVerified && snapshot.objectItems.length >= 2 && snapshot.uniqueGuidCount === snapshot.objectItems.length && duplicateGuidVerified && snapshot.objectItems.some((item) => item.hasCode && item.guid) && snapshot.objectItems.some((item) => item.libraryManager) && snapshot.preview.guid && /PROGRAM\s+PLC_PRG/i.test(String(snapshot.editor.declaration || '')) && snapshot.editor.chars > 0 && sectionNumberingVerified && snapshot.editor.highlightRows >= snapshot.editor.text.split('\n').length && snapshot.pathActions.copyPresent === false && snapshot.pathActions.revealPresent === false && pathRemovalVerified && treeStructureVerified && treeInteractionVerified && seamVerified && beforeSha256 === afterSha256 && cleanedJob && Boolean(screenshot) && !screenshotError,
    projectPath, beforeSha256, afterSha256, sourceProjectModified: beforeSha256 !== afterSha256, absolutePathVerified, opened, loaded, snapshot, duplicateGuidVerified, treeStructureVerified, treeInteractionVerified, seamVerified, editorSections, sectionNumberingVerified, treeToggle, treeFilterProbe, pathRemoval, cleanup: { allowed: cleanupAllowed, cleanedJob, jobId: snapshot.jobId }, screenshot, screenshotError, at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'codesys-workbench-project-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw Object.assign(new Error('codesys-workbench-project-probe-failed'), { details: evidence });
  return evidence;
}

async function probeCodesysWorkbenchRender(frame) {
  const evidence = { ok: false, at: new Date().toISOString() };
  try {
    if (!frame) throw new Error('harness frame unavailable');
    // 走插件自己的桌面→插件消息入口（和 CODESYS 面板上那颗「打开工作台」同一条路径）。
    evidence.opened = await frame.executeJavaScript(`(() => {
      if (document.querySelector('[data-taskhive-codesys-workbench="true"]')) return { already: true };
      window.postMessage({ source: 'taskhive-desktop', type: 'codesys.workbench.open' }, '*');
      return { already: false, posted: true };
    })()`, true);
    const state = await frame.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 30000;
      const read = () => {
        const crash = document.querySelector('[data-taskhive-codesys-crash="true"]');
        const root = document.querySelector('[data-taskhive-codesys-workbench="true"]');
        const controls = root ? root.querySelectorAll('[data-codesys-detect-project="true"],[data-codesys-online-login="true"],[data-codesys-project-tree="true"]').length : 0;
        return {
          crash: Boolean(crash),
          crashText: crash ? String(crash.innerText || '').slice(0, 400) : '',
          root: Boolean(root),
          controls,
          // 刚启动的实例**不应该**出现"引擎是旧版本，请重启"的告警：出现就说明
          // 界面拿不到 codesys:engine-freshness 通道（主进程与界面不匹配）。
          engineStale: Boolean(document.querySelector('[data-codesys-engine-stale]')),
          engineStaleReason: document.querySelector('[data-codesys-engine-stale]')?.getAttribute('data-codesys-engine-stale') || '',
          tabTitles: [...document.querySelectorAll('[role="tab"],button')].map((node) => String(node.innerText || '').trim()).filter((text) => /CODESYS/.test(text)).slice(0, 6),
        };
      };
      const check = () => {
        const value = read();
        if (value.crash || (value.root && value.controls > 0) || Date.now() >= deadline) {
          return resolve({ ...value, timedOut: Date.now() >= deadline && !value.crash && !(value.root && value.controls > 0) });
        }
        setTimeout(check, 150);
      };
      check();
    })`, true);
    evidence.state = state;
    evidence.ok = state.root === true && state.controls > 0 && state.crash === false && state.engineStale === false;
    if (!evidence.ok) {
      if (state.crash) evidence.reason = 'workbench-render-crash';
      else if (state.engineStale) evidence.reason = `engine-stale-warning-visible(${state.engineStaleReason})`;
      else evidence.reason = 'workbench-not-rendered';
    }
  } catch (error) {
    evidence.reason = String(error?.message || error);
  }
  try {
    fs.writeFileSync(path.join(root, 'logs', 'codesys-workbench-render-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  } catch { /* evidence write is best effort */ }
  if (!evidence.ok) throw new Error(`codesys-workbench-render-probe-failed: ${JSON.stringify(evidence)}`);
  return evidence;
}

async function exerciseTaskHiveSurface() {  let frame = null;
  for (let attempt = 0; attempt < 60 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) return { clicked: false, reason: 'dsh-frame-not-found' };
  const clicked = await frame.executeJavaScript(`(() => {
    const button = document.querySelector('[data-sidebar-plugin-id="codesys-monitor"]') || [...document.querySelectorAll('button')].find((node) => /CODESYS/i.test((node.innerText || '').trim()));
    if (!button) return false;
    button.click();
    return true;
  })()`, true);
  let surface = await openSurfaceForProbe('codesys', '#scriptengine-status', 15000, !clicked);
  await surface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const script = document.querySelector('#scriptengine-status')?.textContent || ''; if (script && !script.includes('正在检查')) return resolve({script}); if (Date.now() >= deadline) return resolve({script}); setTimeout(check, 100); }; check(); })", true);
  const codesys = await surface.executeJavaScript(`({
    surface: Boolean(document.querySelector('#scriptengine-status')),
    scriptEngineStatus: document.querySelector('#scriptengine-status')?.textContent || '',
    scriptEngineReady: /ScriptEngine 可修改代码/.test(document.querySelector('#scriptengine-status')?.textContent || ''),
    scriptEngineConfigureButton: Boolean(document.querySelector('#scriptengine-configure')),
    scriptEngineRecheckButton: Boolean(document.querySelector('#scriptengine-recheck')),
    toolbar: (() => {
      const node = document.querySelector('.codesys-toolbar');
      const buttons = [...(node?.querySelectorAll('button') || [])];
      const style = node ? getComputedStyle(node) : null;
      const rows = buttons.map((item) => Math.round(item.getBoundingClientRect().y));
       return {
         ids: buttons.map((item) => item.id),
         text: buttons.map((item) => item.textContent.trim()),
         appearances: buttons.map((item) => ({ id: item.id, backgroundColor: getComputedStyle(item).backgroundColor, color: getComputedStyle(item).color })),
         blackFilledButtonIds: buttons.filter((item) => { const color = getComputedStyle(item).backgroundColor; const values = color.slice(color.indexOf('(') + 1, color.lastIndexOf(')')).split(',').map(Number); return values.length >= 3 && Number(values[3] ?? 1) > 0 && Math.max(values[0], values[1], values[2]) < 40; }).map((item) => item.id),
         oneRow: rows.length > 0 && new Set(rows).size === 1,
        fontFamily: style?.fontFamily || '',
        height: Math.round(node?.getBoundingClientRect().height || 0),
        groups: node?.querySelectorAll('.codesys-toolbar-group').length || 0,
      };
    })(),
    approvedInput: {
      clickButton: !document.querySelector('#approve-click'),
      clickDisabledByDefault: !document.querySelector('#approve-click'),
      aiToggle: Boolean(document.querySelector('#codesys-ai-toggle')),
      aiEnabledByDefault: document.querySelector('#codesys-ai-toggle')?.getAttribute('aria-pressed') === 'true',
      safeKeys: [...document.querySelectorAll('[data-safe-key]')].map((node) => node.getAttribute('data-safe-key')),
      status: document.querySelector('#input-status')?.textContent || '',
      executionRequestedBySmoke: false
    },
    codeAi: {
      toolbarEntry: Boolean(document.querySelector('#codesys-workbench')),
      formRemoved: !document.querySelector('#codesys-ai-form'),
      inputRemoved: !document.querySelector('#codesys-ai-input'),
    },
    externalProgram: {
      buttonText: document.querySelector('#open-codesys-program')?.textContent?.trim() || '',
      title: document.querySelector('#open-codesys-program')?.getAttribute('title') || '',
      nativeToggleRemoved: !document.querySelector('#codesys-native-toggle'),
      windowSelector: Boolean(document.querySelector('#window-list')),
      options: [...(document.querySelector('#window-list')?.options || [])].map((option) => String(option.textContent || '').trim()),
    },
    tooltipCoverage: (() => { const controls = [...document.querySelectorAll('button,select,input')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }); const missing = controls.filter((node) => !node.getAttribute('title') && !node.getAttribute('aria-label')); return { controls: controls.length, missing: missing.length }; })(),
    title: document.title,
    iframe: Boolean(document.querySelector('iframe')),
    embeddedSurface: document.documentElement.hasAttribute('data-surface-embed'),
    returnButtonRemoved: !document.querySelector('.back-to-harness')
  })`, true);
  codesys.externalProgram.lifecycle = codesysExternalProgramLifecycle;
  // The label must state the real policy: a launched instance survives surface
  // and session switches, but TaskHive closes it on exit unless the project has
  // unsaved changes.
  codesys.externalProgram.launchedProgramClosePolicyLabel = /切换插件或会话不会关闭.+退出 TaskHive 时会自动关闭.+未保存改动时保留/.test(codesys.externalProgram.title);
  if (!codesys.externalProgram.launchedProgramClosePolicyLabel) throw Object.assign(new Error('codesys-program-lifecycle-label-regression'), { details: codesys.externalProgram });
  await surface.executeJavaScript("document.querySelector('#codesys-workbench')?.click()", true);
  codesys.workbench = await frame.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 12000;
    const check = () => {
      const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
      if (!workbench && Date.now() < deadline) return setTimeout(check, 100);
      const rect = workbench?.getBoundingClientRect();
      const buttons = [...(workbench?.querySelectorAll('button') || [])];
      const textarea = workbench?.querySelector('textarea');
      resolve({
        visible: Boolean(workbench && rect && rect.width > 0 && rect.height > 0),
        rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        title: workbench?.querySelector('strong')?.textContent || '',
        buttons: buttons.map((node) => ({ text: String(node.textContent || '').trim(), title: node.getAttribute('title') || '', disabled: node.disabled === true, backgroundColor: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color })),
        blackFilledButtons: buttons.filter((node) => { const color = getComputedStyle(node).backgroundColor; const values = color.slice(color.indexOf('(') + 1, color.lastIndexOf(')')).split(',').map(Number); return values.length >= 3 && Number(values[3] ?? 1) > 0 && Math.max(values[0], values[1], values[2]) < 40; }).map((node) => String(node.textContent || '').trim()),
        textarea: Boolean(textarea),
        textareaLabel: textarea?.getAttribute('aria-label') || '',
        lowFrequencyButtonsRemoved: !buttons.some((node) => /(?:新建|创建).*(?:POU|GVL|DUT)|XML|隔离副本/.test(String(node.textContent || ''))),
        // T084: 复制 / 定位 / 回退在窄侧栏下只剩图标，textContent 为空，所以这个诊断
        // 改读 aria-label 与 title，否则它会静默漏掉这几颗按钮。（本段位于模板字符串
        // 内，禁止再嵌反引号 —— 会提前结束外层模板。）
        pathButtons: buttons.filter((node) => /选择工程|重新选择|复制|资源管理器|回退|刷新/.test(String(node.textContent || '') + ' ' + String(node.getAttribute('aria-label') || '') + ' ' + String(node.getAttribute('title') || ''))).map((node) => String(node.getAttribute('aria-label') || node.textContent || '').trim()),
      });
    };
    check();
  })`, true);
  codesys.workbench.centralSurfaceStillAttached = ctx.pluginSurfaceAttached && ctx.pluginSurfaceKind === 'codesys';
  codesys.workbench.centralBounds = ctx.pluginSurfaceBounds;
  codesys.workbench.rightSidebarPreserved = Boolean(codesys.workbench.visible && ctx.pluginSurfaceBounds && ctx.pluginSurfaceBounds.x + ctx.pluginSurfaceBounds.width <= codesys.workbench.rect.x + 2);
  codesys.workbench.noBlackButtons = codesys.toolbar.blackFilledButtonIds.length === 0 && codesys.workbench.blackFilledButtons.length === 0;
  if (!codesys.workbench.noBlackButtons) throw Object.assign(new Error('codesys-black-button-style-regression'), { details: { toolbar: codesys.toolbar.blackFilledButtonIds, workbench: codesys.workbench.blackFilledButtons } });
  // The geometry verdict that used to live only in workspace-geometry-probe.json.
  const workspaceGeometryOk = codesys.workbench.visible === true && codesys.workbench.centralSurfaceStillAttached === true && codesys.workbench.rightSidebarPreserved === true;
  fs.writeFileSync(path.join(root, 'logs', 'workspace-geometry-probe.json'), JSON.stringify({
    ok: workspaceGeometryOk,
    central: { kind: ctx.pluginSurfaceKind, attached: ctx.pluginSurfaceAttached, bounds: ctx.pluginSurfaceBounds },
    rightSidebar: codesys.workbench,
    at: new Date().toISOString(),
  }, null, 2), 'utf8');
  if (codesysSmokeProjectPath()) codesys.workbench.projectProbe = await probeCodesysWorkbenchProject(frame);
  const codeAiRequest = await surface.executeJavaScript("window.taskhive.requestCodesysCodeAi({ prompt: '仅创建验收隔离作业，不打开或修改当前工程' })", true);
  const generatedJobRoot = path.resolve(root, 'workspaces', 'codesys-scriptengine', String(codeAiRequest.jobId || ''));
  const allowedJobRoot = path.resolve(root, 'workspaces', 'codesys-scriptengine') + path.sep;
  const requestPath = path.join(generatedJobRoot, 'request.json');
  codesys.codeAi.jobProbe = {
    jobId: codeAiRequest.jobId,
    state: codeAiRequest.state,
    sourceProjectModified: codeAiRequest.sourceProjectModified,
    requestWritten: generatedJobRoot.startsWith(allowedJobRoot) && fs.existsSync(requestPath),
    workspaceVisibleEvent: Boolean(codeAiRequest.workspace?.surface === 'codesys-workbench' && codeAiRequest.review?.writesSourceProjectAfterConfirmation === true),
    remainsInCodesysWorkbench: codeAiRequest.workspace?.surface === 'codesys-workbench',
  };
  await new Promise((resolve) => setTimeout(resolve, 500));
  codesys.codeAi.jobProbe.harnessWorkspaceVisible = await frame.executeJavaScript(`(() => {
    const id = ${JSON.stringify(codeAiRequest.jobId)};
    const values = [...document.querySelectorAll('textarea,input,[contenteditable="true"]')].map((node) => String(node.value || node.textContent || node.innerText || ''));
    return values.some((value) => value.includes(id)) || String(document.body?.innerText || '').includes(id);
  })()`, true).catch(() => false);
  codesys.codeAi.jobProbe.bridgeSeen = await frame.executeJavaScript(`(() => ({ seen: Boolean(window.__TASKHIVE_LAST_CODESYS_TASK__), id: window.__TASKHIVE_LAST_CODESYS_TASK__?.jobId || '', error: window.__TASKHIVE_LAST_CODESYS_TASK_ERROR__ || '' }))()`, true).catch((error) => ({ seen: false, error: String(error.message || error) }));
  if (generatedJobRoot.startsWith(allowedJobRoot) && fs.existsSync(requestPath)) fs.rmSync(generatedJobRoot, { recursive: true, force: true });
  codesys.host = { attached: ctx.pluginSurfaceAttached, kind: ctx.pluginSurfaceKind, bounds: ctx.pluginSurfaceBounds };
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  for (let attempt = 0; attempt < 30 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const returned = !ctx.pluginSurfaceAttached;
  const branding = await probeTaskHiveBranding(frame);
  await showPluginSurface('knowledge');
  const settingsOrigin = { kind: ctx.pluginSurfaceKind, attached: ctx.pluginSurfaceAttached };
  const settingsClicked = await frame.executeJavaScript(`(() => { const nodes = [...document.querySelectorAll('button,[role="button"],a')]; const node = nodes.find((item) => item.getAttribute('aria-haspopup') === 'dialog') || nodes.find((item) => /^(settings|设置)$/i.test((item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim())); if (!node) return false; node.click(); return true; })()`, true);
  await frame.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { if (document.querySelector('[role=\\\"dialog\\\"],[aria-modal=\\\"true\\\"]')) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
  for (let attempt = 0; attempt < 30 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const settings = await frame.executeJavaScript(`(() => {
    const rectOf = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), centerX: Math.round(r.x + r.width / 2) }; };
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
    const nodes = [...document.querySelectorAll('button,[role="button"],a')];
    const settingsButton = nodes.find((item) => item.getAttribute('aria-haspopup') === 'dialog') || nodes.find((item) => /^(settings|设置)$/i.test((item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim()));
    const settingsIcon = settingsButton?.querySelector('svg,img,[data-icon]');
    const pluginIcons = [...document.querySelectorAll('[data-taskhive-plugin-icon]')];
    const settingsRect = rectOf(settingsButton); const settingsIconRect = rectOf(settingsIcon); const pluginRects = pluginIcons.map(rectOf).filter(Boolean);
    return { ready: Boolean(dialog), clicked: ${settingsClicked ? 'true' : 'false'}, dialog: rectOf(dialog), settingsRect, settingsIconRect, pluginRects, sameColumn: Boolean(settingsIconRect && pluginRects.length && pluginRects.every((rect) => Math.abs(rect.centerX - settingsIconRect.centerX) <= 3)), presetModeVisible: /标准模式|预设模式|Agent 预设/i.test(String(dialog?.innerText || '')), workspaceWriteInDialog: /Workspace\\s+Write/i.test(String(dialog?.innerText || '')), directories: document.querySelector('[data-taskhive-settings-directories="true"]')?.querySelectorAll('code').length || 0, sidebarPluginManager: Boolean(document.querySelector('[data-sidebar-plugin-id="plugin-manager"]')) };
  })()`, true);
  settings.origin = settingsOrigin;
  settings.childViewSuspended = ctx.pluginSurfaceAttached === false;
  settings.closeAttempt = await frame.executeJavaScript(`(() => {
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
    if (!dialog) return { dialogFound: false, clicked: false };
    const buttons = [...dialog.querySelectorAll('button')];
    const exact = (node) => [node.innerText,node.getAttribute('aria-label'),node.getAttribute('title')].some((value) => /^(关闭设置|关闭|close settings|close)$/i.test(String(value || '').trim()));
    const close = buttons.find(exact);
    if (close) { const result = { dialogFound: true, clicked: true, text: String(close.innerText || '').trim(), aria: close.getAttribute('aria-label') || '', title: close.getAttribute('title') || '' }; close.click(); return result; }
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    return { dialogFound: true, clicked: false, escape: true };
  })()`, true);
  const dialogClosed = await frame.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 5000; const check = () => { const dialog = document.querySelector('[role=\"dialog\"],[aria-modal=\"true\"]'); if (!dialog || dialog.getBoundingClientRect().width === 0) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
  settings.dialogClosed = dialogClosed;
  for (let attempt = 0; attempt < 40 && !ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  settings.restoredSurface = ctx.pluginSurfaceAttached === true && ctx.pluginSurfaceKind === 'knowledge';
  const workspaceClicked = await frame.executeJavaScript(`(() => { const node = [...document.querySelectorAll('button,[role="button"]')].find((item) => /工作区/.test(String(item.getAttribute('aria-label') || item.innerText || '')) && !item.closest('[role="dialog"]') && !item.closest('[data-taskhive-sidebar-plugins]')); if (!node) return false; node.click(); return true; })()`, true);
  for (let attempt = 0; attempt < 40 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  settings.workspaceClicked = workspaceClicked;
  settings.workspaceReturnsChat = workspaceClicked && ctx.pluginSurfaceAttached === false;
  settings.sessionSwitch = await frame.executeJavaScript(`(() => {
      const candidates = [...document.querySelectorAll('button,[role="button"],a')].filter((node) => {
      if (node.closest('[role="dialog"],[data-taskhive-sidebar-plugins]')) return false;
      const text = String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
      return Boolean(node.matches('[data-session-id],[data-testid*="session"],[data-workspace-session]')) || /^(新会话|会话|session|workspace)/i.test(text);
      });
    const candidateLabels = candidates.map((item) => String(item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim());
    const node = candidates.find((item) => { const text = String(item.innerText || item.getAttribute('aria-label') || '').trim(); return !/^(新会话|添加工作区|设置|settings|Workspace Write)$/i.test(text); }) || candidates.find((item) => !/^Workspace Write$/i.test(String(item.innerText || '').trim())) || candidates[0];
    if (!node) return { clicked: false, candidates: candidates.length };
    node.click();
    return { clicked: true, candidates: candidates.length, candidateLabels, label: String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim() };
  })()`, true).catch(() => ({ clicked: false, candidates: 0 }));
  for (let attempt = 0; attempt < 40 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  settings.sessionSwitch.returnsChat = settings.sessionSwitch.clicked && ctx.pluginSurfaceAttached === false;
  // `ok` is exactly the verdict this probe already computed for
  // workspace-geometry-probe.json. It used to be written to that file and never
  // acted on, which is how "surface did not come back / right sidebar covered by
  // the panel" could ship with a green --smoke-ui. `returned` and
  // `settings.restoredSurface` stay pure evidence here on purpose: they are
  // observations about the switch sequence, not the geometry contract this entry
  // point owns, and widening `ok` would turn unrelated flakes red.
  const evidence = { ok: workspaceGeometryOk, clicked, codesys, returned, branding, settings, menuBarVisible: ctx.mainWindow.isMenuBarVisible(), mainUrl: ctx.mainWindow.webContents.getURL(), pluginSurfaceAttached: ctx.pluginSurfaceAttached, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'ui-surface-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return enforceProbeResult('ui-surface-probe', evidence);
}

async function probeHistorySessionSwitch(frame) {
  if (process.argv.includes('--smoke-codesys-fixture')) await showPluginSurface('codesys');
  const codesysLifecycleBefore = codesysFixtureLifecycleSnapshot('codesys-visible-before-switches');
  const created = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const api = window.__TASKHIVE_SESSION_PROBE__;
    if (!api?.create || !api?.makeHistorical || !api?.snapshot) return { ok: false, reason: 'session-probe-unavailable' };
    const before = api.snapshot();
    const currentId = String(before?.sessions?.current || '');
    if (!currentId) return { ok: false, reason: 'current-session-unavailable', before };
    const historical = (before?.sessions?.ids || []).find((id) => before?.sessions?.byId?.[id]?.blank === false);
    if (historical) {
      let activeId = currentId;
      if (historical === activeId) {
        const alternate = (before?.sessions?.ids || []).find((id) => id !== historical);
        if (alternate) { api.open(alternate); activeId = alternate; await wait(500); }
      }
      if (historical !== activeId) return { ok: true, reusedHistorical: true, before, targetId: historical, next: { sessionId: activeId }, afterCreate: api.snapshot() };
    }
    const targetId = currentId;
    const seeded = await api.makeHistorical(targetId, 'TASKHIVE_HISTORY_SWITCH_PROBE: create one cancellable isolated history row.');
    for (let attempt = 0; attempt < 50 && api.snapshot()?.sessions?.byId?.[targetId]?.blank !== false; attempt += 1) await wait(100);
    const next = await api.create();
    await wait(900);
    return { ok: true, reusedHistorical: false, before, targetId, seeded, next, afterCreate: api.snapshot() };
  })()`, true).catch((error) => ({ ok: false, reason: String(error?.message || error) }));

  await showPluginSurface('knowledge');
  const codesysLifecycleAfterPluginSwitch = codesysFixtureLifecycleSnapshot('after-plugin-switch');
  const targetId = String(created?.targetId || '');
  const currentBeforeClick = String(created?.afterCreate?.sessions?.current || '');
  const clicked = await frame.executeJavaScript(`(() => {
    const api = window.__TASKHIVE_SESSION_PROBE__;
    const sidebar = document.querySelector('[data-pane="sidebar"],[class*="sidebarCol"]') || document.body;
    const visible = (node) => { const rect = node.getBoundingClientRect?.(); const style = getComputedStyle(node); return rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const nodes = [...sidebar.querySelectorAll('[data-session-id],[data-workspace-session],[role="treeitem"],button,a,[role="button"]')].filter(visible);
    const rows = nodes.map((node, index) => ({
      index,
      text: String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim(),
      ariaCurrent: node.getAttribute('aria-current'),
      ariaSelected: node.getAttribute('aria-selected'),
      sessionId: node.getAttribute('data-session-id') || node.getAttribute('data-workspace-session') || '',
      title: node.getAttribute('title') || '',
      html: node.outerHTML.slice(0, 900),
    }));
    const targetId = ${JSON.stringify(targetId)};
    let node = nodes.find((candidate) => targetId && candidate.outerHTML.includes(targetId));
    if (!node) node = nodes.find((candidate) => {
      const text = String(candidate.innerText || candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '').trim();
      const current = candidate.getAttribute('aria-current') === 'page' || candidate.getAttribute('aria-current') === 'true' || candidate.getAttribute('aria-selected') === 'true';
      const labels = [text, candidate.getAttribute('aria-label'), candidate.getAttribute('title'), candidate.className].join(' ');
      const sessionRow = /sessionRow/i.test(String(candidate.className || '')) || (candidate.matches('[role="treeitem"]') && candidate.getAttribute('aria-expanded') === null);
      if (sessionRow) return !current;
      const control = /newSession|新建会话|添加工作区|搜索会话|视图选项|工作区.*操作|设置|CODESYS|浏览器|知识库|TaskHive/i.test(labels);
      return !current && !control && /session/i.test(labels);
    });
    if (!node) return { clicked: false, rows, before: api?.snapshot?.() || null };
    const chosen = rows[nodes.indexOf(node)];
    node.click();
    return { clicked: true, chosen, rows, before: api?.snapshot?.() || null };
  })()`, true).catch((error) => ({ clicked: false, error: String(error?.message || error), rows: [] }));
  for (let attempt = 0; attempt < 50 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await frame.executeJavaScript(`(() => ({ snapshot: window.__TASKHIVE_SESSION_PROBE__?.snapshot?.() || null, bodyText: String(document.body?.innerText || '').slice(0, 1400) }))()`, true);
  const codesysLifecycleAfterSessionSwitch = codesysFixtureLifecycleSnapshot('after-session-switch');
  const pluginSurfaceDetachedAfterSessionSwitch = ctx.pluginSurfaceAttached === false;
  if (process.argv.includes('--smoke-codesys-fixture')) await showPluginSurface('codesys');
  const codesysLifecycleAfterReturn = codesysFixtureLifecycleSnapshot('after-return-to-codesys');
  const returnedToCodesys = ctx.pluginSurfaceAttached === true && ctx.pluginSurfaceKind === 'codesys';
  const currentAfterClick = String(after?.snapshot?.sessions?.current || '');
  const evidence = {
    ok: created.ok === true && clicked.clicked === true && pluginSurfaceDetachedAfterSessionSwitch && currentAfterClick && currentAfterClick !== currentBeforeClick && (!targetId || currentAfterClick === targetId),
    created,
    clicked,
    targetId,
    currentBeforeClick,
    currentAfterClick,
    pluginSurfaceDetached: pluginSurfaceDetachedAfterSessionSwitch,
    targetConversationVisible: currentAfterClick === targetId,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'history-session-switch-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (process.argv.includes('--smoke-codesys-fixture')) {
    const lifecycleEvidence = {
      ok: evidence.ok === true
        && returnedToCodesys
        && codesysLifecycleBefore.windows.length >= 2
        && codesysLifecycleBefore.windows.every((item) => Boolean(item.nativeHandle) && item.destroyed === false)
        && codesysFixtureIdentityStable(codesysLifecycleBefore, codesysLifecycleAfterPluginSwitch)
        && codesysFixtureIdentityStable(codesysLifecycleBefore, codesysLifecycleAfterSessionSwitch)
        && codesysFixtureIdentityStable(codesysLifecycleBefore, codesysLifecycleAfterReturn),
      contract: codesysExternalProgramLifecycle,
      before: codesysLifecycleBefore,
      afterPluginSwitch: codesysLifecycleAfterPluginSwitch,
      afterSessionSwitch: codesysLifecycleAfterSessionSwitch,
      afterReturnToCodesys: codesysLifecycleAfterReturn,
      pluginSwitchVerified: true,
      sessionSwitchVerified: evidence.ok === true,
      returnedToCodesys,
      closeOperationsRequested: 0,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(root, 'logs', 'codesys-program-lifecycle-probe.json'), JSON.stringify(lifecycleEvidence, null, 2), 'utf8');
    if (!lifecycleEvidence.ok) throw Object.assign(new Error('codesys-program-lifecycle-probe-failed'), { details: lifecycleEvidence });
  }
  // Without the --smoke-codesys-fixture gate above, this probe's own `ok` was
  // never read by anyone: a session switch that never happened still looked like
  // a pass in history-session-switch-probe.json.
  return enforceProbeResult('history-session-switch-probe', evidence);
}

async function probeSessionDeletion(frame) {
  const setup = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const api = window.__TASKHIVE_SESSION_PROBE__;
    if (!api?.snapshot || !api?.create || !api?.makeHistorical || !api?.rename || !api?.archive) return { ok: false, reason: 'session-probe-unavailable' };
    const before = api.snapshot();
    const targetId = String(before?.sessions?.current || '');
    if (!targetId) return { ok: false, reason: 'current-session-unavailable', before };
    if (before?.sessions?.byId?.[targetId]?.blank !== false) await api.makeHistorical(targetId, 'TASKHIVE_DELETE_SESSION_PROBE: disposable isolated session.');
    for (let attempt = 0; attempt < 50 && api.snapshot()?.sessions?.byId?.[targetId]?.blank !== false; attempt += 1) await wait(100);
    const targetTitle = 'TASKHIVE_ARCHIVE_' + targetId.slice(-8);
    await api.rename(targetId, targetTitle);
    const next = await api.create();
    for (let attempt = 0; attempt < 50 && String(api.snapshot()?.sessions?.current || '') === targetId; attempt += 1) await wait(100);
    const nextId = String(api.snapshot()?.sessions?.current || next || '');
    if (nextId && api.makeHistorical) {
      await api.makeHistorical(nextId, 'TASKHIVE_DELETE_SESSION_PROBE: current session protection marker.');
      for (let attempt = 0; attempt < 50 && api.snapshot()?.sessions?.byId?.[nextId]?.blank !== false; attempt += 1) await wait(100);
    }
    // The previous history-switch probe may still be completing its synthetic
    // turn. Product code correctly hides deletion for a running session, so
    // the smoke must wait for that target to settle instead of weakening the
    // runtime protection or racing the menu.
    for (let attempt = 0; attempt < 150 && api.snapshot()?.sessions?.byId?.[targetId]?.running === true; attempt += 1) await wait(100);
    const afterCreate = api.snapshot();
    const targetReady = afterCreate?.sessions?.byId?.[targetId]?.running !== true;
    return { ok: targetReady, targetReady, targetId, targetTitle, next, before, afterCreate };
  })()`, true).catch((error) => ({ ok: false, reason: String(error?.message || error) }));
  const targetId = String(setup?.targetId || '');
  const targetTitle = String(setup?.targetTitle || '');
  const currentId = String(setup?.afterCreate?.sessions?.current || '');
  const sessionList = await frame.executeJavaScript(`new Promise((resolve) => {
    const visible = (node) => { const rect = node?.getBoundingClientRect?.(); const style = node ? getComputedStyle(node) : null; return Boolean(rect && style && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'); };
    // DSH alpha.2 session rows are divs with a hashed sessionRow class rather
    // than ARIA tree items. Keep this scoped to concrete session-row markers
    // so CODESYS project tree rows cannot satisfy the archive probe.
    const findRows = () => [...document.querySelectorAll('[data-session-id],[data-workspace-session],[class*="sessionRow"]')].filter(visible);
    const expand = [...document.querySelectorAll('button,[role="button"]')].find((node) => {
      const rect = node.getBoundingClientRect();
      const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
      return rect.x < 340 && rect.y < 180 && /打开.*侧边栏|展开.*侧边栏|expand.*sidebar/i.test(label);
    });
    const before = findRows().length;
    if (before === 0) expand?.click();
    const deadline = Date.now() + 8000;
    const check = () => {
      const rows = findRows();
      const row = rows.find((node) => String(node.textContent || '').includes(${JSON.stringify(targetTitle)}));
      if (row || Date.now() >= deadline) resolve({ before, expanded: Boolean(expand), rows: rows.length, targetRowFound: Boolean(row), selector: '[data-session-id],[data-workspace-session],[class*="sessionRow"]' });
      else setTimeout(check, 100);
    };
    check();
  })`, true).catch((error) => ({ before: 0, expanded: false, rows: 0, targetRowFound: false, error: String(error?.message || error) }));
  const archiveRequest = await frame.executeJavaScript(`(async () => {
    const api = window.__TASKHIVE_SESSION_PROBE__;
    const targetId = ${JSON.stringify(targetId)};
    const targetTitle = ${JSON.stringify(targetTitle)};
    const row = [...document.querySelectorAll('[data-session-id],[data-workspace-session],[class*="sessionRow"]')].find((node) => String(node.textContent || '').includes(targetTitle));
    if (!row) return { requested: false, rowFound: false, reason: 'target-row-not-found' };
    await api.archive(targetId);
    return { requested: true, rowFound: true, route: 'uiWorkspace.archiveSession' };
  })()`, true).catch((error) => ({ requested: false, rowFound: false, error: String(error?.message || error) }));
  let screenshot = null;
  let screenshotError = null;
  try {
    screenshot = path.join('logs', 'session-archive-menu.png');
    fs.writeFileSync(path.join(root, screenshot), (await ctx.mainWindow.webContents.capturePage()).toPNG());
  } catch (error) { screenshotError = String(error?.message || error); }
  const after = await frame.executeJavaScript(`new Promise((resolve) => {
    const targetId = ${JSON.stringify(targetId)};
    const targetTitle = ${JSON.stringify(targetTitle)};
    const deadline = Date.now() + 8000;
    const check = () => {
      const row = [...document.querySelectorAll('[data-session-id],[data-workspace-session],[class*="sessionRow"]')].find((node) => String(node.textContent || '').includes(targetTitle));
      const snapshot = window.__TASKHIVE_SESSION_PROBE__?.snapshot?.() || null;
      const archived = Boolean(snapshot?.workspaces?.archivedSessionIds?.includes(targetId));
      if ((!row && archived) || Date.now() >= deadline) return resolve({ rowHidden: !row, archived, snapshot });
      setTimeout(check, 100);
    };
    check();
  })`, true).catch((error) => ({ rowHidden: false, archived: false, error: String(error?.message || error) }));
  const evidence = {
    // Alpha.2 retains archived sessions in the controller's accounting index.
    // The product contract is the archive-set echo plus removal from visible rows.
    ok: setup.ok === true && targetId && targetTitle && currentId && targetId !== currentId && sessionList.targetRowFound === true && archiveRequest.requested === true && after.rowHidden === true && after.archived === true && String(after?.snapshot?.sessions?.current || '') === currentId && Boolean(screenshot) && !screenshotError,
    setup, sessionList, archiveRequest, after, screenshot, screenshotError, at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'session-delete-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw Object.assign(new Error('session-delete-probe-failed'), { details: evidence });
  return evidence;
}

async function probePluginRightSidebar(frame) {
  // T137/T138: the knowledge/repository surface is rendered by the DSH client
  // plugin, so `#knowledge-category-grid` is only mounted while the DSH "开源索引"
  // tab is active (the default tab is 书架). Waiting for it here meant a 30 s
  // timeout on every run, `surfaceReadyError` was recorded, and then the case's
  // `ok:false` was ignored — the exact "probe that cannot fail" pattern this file
  // now forbids. `[data-taskhive-knowledge]` is the section the view always renders.
  //
  // Mirrors `DSH_RENDERED_SURFACES` in app/main.js: for those kinds the host
  // deliberately does NOT attach the native pluginSurfaceView (T143), so any
  // assertion about `pluginSurfaceAttached`/`pluginSurfaceBounds` is unsatisfiable
  // by design and must not be used as the pass criterion.
  const DSH_RENDERED_SURFACE_KINDS = new Set(['knowledge']);
  const cases = [
    ['codesys', 'codesys-monitor', '#scriptengine-status'],
    ['web-ai', 'web-ai', '#web-ai-address'],
    ['knowledge', 'knowledge-base', '[data-taskhive-knowledge]'],
  ];
  const results = [];
  for (const [kind, pluginId, marker] of cases) {
    await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
    for (let attempt = 0; attempt < 30 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    if (kind === 'workbench') {
      await frame.executeJavaScript(`(() => {
        if (!document.body.hasAttribute('data-dsh-sidebar-collapsed')) {
          const toggle = [...document.querySelectorAll('button,[role="button"]')].filter((node) => /收起侧边栏|折叠侧边栏|collapse\\s+(?:right\\s+)?sidebar/i.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
          toggle?.click();
        }
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const click = await frame.executeJavaScript(`(() => {
      const button = document.querySelector('[data-sidebar-plugin-id=${JSON.stringify(pluginId)}]');
      if (!button) return { clicked: false };
      button.click();
      return { clicked: true, text: String(button.innerText || '').trim() };
    })()`, true);
    // Use the same ownership and renderer-readiness contract as the real
    // CODESYS smoke. The surface state message arrives before a cold embedded
    // renderer completes navigation, so a hand-rolled short poll is a false
    // negative for otherwise usable plugin pages.
    let surface = null;
    let surfaceReadyError = null;
    try {
      surface = await openSurfaceForProbe(kind, marker, 30000, true);
    } catch (error) {
      surfaceReadyError = String(error?.message || error);
      surface = ctx.pluginSurfaceView && !ctx.pluginSurfaceView.webContents.isDestroyed() ? ctx.pluginSurfaceView.webContents : null;
    }
    const layout = await frame.executeJavaScript(`(() => {
      const viewport = { width: innerWidth, height: innerHeight };
      const width = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width') || '0') || 0;
      const candidates = [...document.querySelectorAll('[data-pane="right-sidebar"],[class*="rightSidebar"],[data-dsh-better-sidebar] > *')].map((node) => {
        const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: style.display, visibility: style.visibility };
      }).filter((rect) => rect.width >= 180 && rect.height >= viewport.height * .45 && rect.x < viewport.width);
      const toggleNode = [...document.querySelectorAll('button,[role="button"]')].filter((node) => /收起侧边栏|折叠侧边栏|collapse\s+(?:right\s+)?sidebar/i.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
      const toggleRect = toggleNode?.getBoundingClientRect();
      const topRightControls = [...document.querySelectorAll('button,[role="button"]')].map((node) => { const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return { node, rect, style }; }).filter(({ rect, style }) => rect.width > 0 && rect.height > 0 && rect.x > viewport.width * .62 && rect.y < 90 && style.display !== 'none' && style.visibility !== 'hidden').map(({ node, rect }) => ({ x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height),text:String(node.innerText||'').trim(),ariaLabel:node.getAttribute('aria-label')||'',title:node.getAttribute('title')||'',className:String(node.className||''),html:node.outerHTML.slice(0,700) }));
      return { viewport, collapsed: document.body.hasAttribute('data-dsh-sidebar-collapsed'), declaredWidth: width, candidates, topRightControls, toggle: toggleRect ? { visible: toggleRect.width > 0 && toggleRect.height > 0, x: Math.round(toggleRect.x), y: Math.round(toggleRect.y), width: Math.round(toggleRect.width), height: Math.round(toggleRect.height), label: toggleNode.getAttribute('aria-label') || toggleNode.getAttribute('title') || '' } : null };
    })()`, true);
    const interactive = surface ? await surface.executeJavaScript(`(() => ({ marker: Boolean(document.querySelector(${JSON.stringify(marker)})), controls: [...document.querySelectorAll('button,input,textarea,select')].filter((node) => { const rect=node.getBoundingClientRect(); return rect.width>0&&rect.height>0&&!node.disabled; }).length }))()`, true).catch(() => ({ marker: false, controls: 0 })) : { marker: false, controls: 0 };
    const bounds = ctx.pluginSurfaceBounds ? { ...ctx.pluginSurfaceBounds } : null;
    const rawGeometry = ctx.lastSurfaceGeometry ? { ...ctx.lastSurfaceGeometry } : null;
    if (kind !== 'workbench') {
      const leftLayout = await frame.executeJavaScript(`(() => {
        const viewport = { width: innerWidth, height: innerHeight };
        const button = document.querySelector('[data-sidebar-plugin-id=${JSON.stringify(pluginId)}]');
        const buttonRect = button?.getBoundingClientRect();
        const sidebars = [...document.querySelectorAll('[data-pane="sidebar"], aside, [class*="sidebarCol"], [class*="hHd-"][class*="root"]')]
          .map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: style.display, visibility: style.visibility }; })
          .filter((rect) => rect.width >= 40 && rect.width <= 360 && rect.height >= viewport.height * .65 && rect.x <= 60 && rect.display !== 'none' && rect.visibility !== 'hidden');
        return {
          viewport,
          architecture: 'native-left-sidebar',
          pluginButton: buttonRect ? { visible: buttonRect.width > 0 && buttonRect.height > 0, x: Math.round(buttonRect.x), y: Math.round(buttonRect.y), width: Math.round(buttonRect.width), height: Math.round(buttonRect.height) } : null,
          sidebars,
          rightSidebarProbeSkipped: true,
        };
      })()`, true);
      // `leftLayout.viewport` comes from the frame; a malformed answer used to
      // throw a bare TypeError here, which reads as a harness crash rather than
      // "this surface failed its geometry check". Missing width ⇒ 0 ⇒ not fitting.
      const leftViewportWidth = Number(leftLayout?.viewport?.width || 0);
      const leftBoundsFit = Boolean(bounds && bounds.x >= 0 && bounds.width > 400 && bounds.x + bounds.width <= leftViewportWidth + 2);
      const dshRendered = DSH_RENDERED_SURFACE_KINDS.has(kind);
      // Two different architectures live in this loop. A shell-overlay surface
      // must be attached as `pluginSurfaceView` and its bounds must fit left of
      // the DSH sidebar; a DSH-rendered surface must have NO native overlay at
      // all (T143) and is verified inside the DSH frame instead.
      const overlayOk = click.clicked === true && ctx.pluginSurfaceAttached === true && ctx.pluginSurfaceKind === kind && interactive.marker === true && interactive.controls > 0 && leftBoundsFit && Boolean(leftLayout.pluginButton?.visible) && leftLayout.sidebars.length > 0;
      const dshRenderedOk = click.clicked === true && ctx.pluginSurfaceAttached === false && ctx.pluginSurfaceKind === null && surfaceReadyError === null && interactive.marker === true && interactive.controls > 0 && Boolean(leftLayout.pluginButton?.visible) && leftLayout.sidebars.length > 0;
      const result = { kind, architecture: dshRendered ? 'dsh-client-rendered' : 'native-left-sidebar', dshRendered, ghostOverlayAttached: dshRendered ? ctx.pluginSurfaceAttached === true : ctx.pluginSurfaceAttached === true && ctx.pluginSurfaceKind !== kind, click, attached: dshRendered ? ctx.pluginSurfaceAttached === false : (ctx.pluginSurfaceAttached && ctx.pluginSurfaceKind === kind), surfaceReadyError, bounds, rawGeometry, layout: leftLayout, interactive, ok: dshRendered ? dshRenderedOk : overlayOk };
      await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
      for (let attempt = 0; attempt < 30 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      await new Promise((resolve) => setTimeout(resolve, 180));
      result.chatRestored = await frame.executeJavaScript(`(() => ({ pluginSurfaceActive: document.body.hasAttribute('data-taskhive-plugin-surface-active'), leftSidebarVisible: Boolean([...document.querySelectorAll('[data-pane="sidebar"], aside, [class*="sidebarCol"], [class*="hHd-"][class*="root"]')].find((node) => { const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return rect.width >= 40 && rect.height >= innerHeight * .65 && style.display !== 'none' && style.visibility !== 'hidden'; })) }))()`, true).catch(() => ({ pluginSurfaceActive: true, leftSidebarVisible: false }));
      result.ok = result.ok && result.chatRestored.pluginSurfaceActive === false && result.chatRestored.leftSidebarVisible === true;
      results.push(result);
      continue;
    }
    const shellUi = await frame.executeJavaScript(`new Promise((resolve) => {
      const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
      const rectOf = (node) => { if (!node) return null; const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right), bottom: Math.round(rect.bottom) }; };
      const panel = document.querySelector('[data-dsh-better-sidebar-panel="right"]');
      const plus = document.querySelector('[data-dsh-sidebar-new-tab]');
      const bottomToggles = [...document.querySelectorAll('[data-dsh-bottom-panel-toggle]')];
      const rightToggles = [...document.querySelectorAll('[data-dsh-right-sidebar-toggle]')];
      plus?.focus(); plus?.click();
      setTimeout(() => {
        const menu = [...document.body.children].find((node) => node.getAttribute?.('role') === 'menu' && visible(node));
        const panelRect = panel?.getBoundingClientRect(); const menuRect = menu?.getBoundingClientRect();
        resolve({
          pluginSurfaceActive: document.body.hasAttribute('data-taskhive-plugin-surface-active'),
          bottomToggleVisibleCount: bottomToggles.filter(visible).length,
          rightToggleVisibleCount: rightToggles.filter(visible).length,
          rightToggle: (() => { const node = rightToggles.find(visible); return node ? { ariaLabel: node.getAttribute('aria-label') || '', title: node.getAttribute('title') || '', rect: rectOf(node) } : null; })(),
          bottomPanelVisibleCount: [...document.querySelectorAll('[class*="bottomPanel"]')].filter(visible).length,
          panelRect: rectOf(panel),
          plusRect: rectOf(plus),
          menuRect: rectOf(menu),
          menuOpen: visible(menu),
          menuWithinPanel: Boolean(panelRect && menuRect && menuRect.left >= panelRect.left - 1 && menuRect.right <= panelRect.right + 1 && menuRect.top >= panelRect.top - 1 && menuRect.bottom <= panelRect.bottom + 1),
          menuItems: [...(menu?.querySelectorAll('[role="menuitem"],button') || [])].filter(visible).map((node) => String(node.textContent || node.getAttribute('aria-label') || '').trim()),
        });
      }, 300);
    })`, true);
    shellUi.menuNotCoveredByPlugin = Boolean(bounds && shellUi.menuRect && shellUi.menuRect.x >= bounds.x + bounds.width - 1);
    let menuScreenshot = null;
    let menuScreenshotError = null;
    try {
      menuScreenshot = path.join('logs', `plugin-right-sidebar-menu-${kind}.png`);
      fs.writeFileSync(path.join(root, menuScreenshot), (await ctx.mainWindow.webContents.capturePage()).toPNG());
    } catch (error) { menuScreenshotError = String(error?.message || error); }
    await frame.executeJavaScript("{const target=document.activeElement||document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));target.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));}", true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    shellUi.keyboardFocusInMenu = await frame.executeJavaScript(`(() => Boolean(document.activeElement?.closest?.('[role="menu"]')))()`, true).catch(() => false);
    await frame.executeJavaScript("{const target=document.activeElement||document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));target.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',bubbles:true}));}", true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    shellUi.escapeClosed = await frame.executeJavaScript(`(() => ![...document.body.children].some((node) => { if (node.getAttribute?.('role') !== 'menu') return false; const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden'; }))()`, true).catch(() => false);
    shellUi.menuScreenshot = menuScreenshot;
    shellUi.menuScreenshotError = menuScreenshotError;
    const collapseAction = await frame.executeJavaScript(`(() => { const node = [...document.querySelectorAll('button,[role="button"]')].filter((item) => /收起侧边栏|折叠侧边栏|collapse\s+(?:right\s+)?sidebar/i.test(String(item.getAttribute('aria-label') || item.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]; const rect=node?.getBoundingClientRect(); node?.click(); return { clicked:Boolean(node), rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null }; })()`, true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const collapsedBounds = ctx.pluginSurfaceBounds ? { ...ctx.pluginSurfaceBounds } : null;
    let toggleScreenshot = null;
    let toggleScreenshotError = null;
    try {
      toggleScreenshot = path.join('logs', `plugin-right-sidebar-toggle-${kind}.png`);
      fs.writeFileSync(path.join(root, toggleScreenshot), (await ctx.mainWindow.webContents.capturePage()).toPNG());
    } catch (error) {
      toggleScreenshotError = String(error?.message || error);
    }
    const expandAction = await frame.executeJavaScript(`(() => { const node = [...document.querySelectorAll('button,[role="button"]')].filter((item) => /展开侧边栏|expand\s+(?:right\s+)?sidebar/i.test(String(item.getAttribute('aria-label') || item.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]; const rect=node?.getBoundingClientRect(); const style=node?getComputedStyle(node):null; const result={clicked:Boolean(node),visible:Boolean(rect&&rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'),label:node?.getAttribute('aria-label')||node?.getAttribute('title')||'',rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null}; node?.click(); return result; })()`, true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const restoredState = await frame.executeJavaScript(`(() => ({ collapsed: document.body.hasAttribute('data-dsh-sidebar-collapsed'), toggleVisible: [...document.querySelectorAll('button,[role="button"]')].some((node) => { const rect=node.getBoundingClientRect(); return /收起侧边栏|折叠侧边栏|collapse\s+(?:right\s+)?sidebar/i.test(String(node.getAttribute('aria-label')||node.getAttribute('title')||'')) && rect.x > innerWidth * .65 && rect.width>0 && rect.height>0; }) }))()`, true);
    const restoredBounds = ctx.pluginSurfaceBounds ? { ...ctx.pluginSurfaceBounds } : null;
    const toggleNotCovered = Boolean(collapsedBounds && expandAction.rect && collapsedBounds.x + collapsedBounds.width <= expandAction.rect.x + 1);
    const result = { kind, click, attached: ctx.pluginSurfaceAttached && ctx.pluginSurfaceKind === kind, surfaceReadyError, bounds, rawGeometry, layout, interactive, shellUi, collapseAction, collapsedBounds, toggleScreenshot, toggleScreenshotError, expandAction, restoredState, restoredBounds, toggleNotCovered };
    await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
    for (let attempt = 0; attempt < 30 && ctx.pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise((resolve) => setTimeout(resolve, 180));
    result.chatRestored = await frame.executeJavaScript(`(() => { const visible=(node)=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'}; return { pluginSurfaceActive: document.body.hasAttribute('data-taskhive-plugin-surface-active'), bottomToggleVisibleCount:[...document.querySelectorAll('[data-dsh-bottom-panel-toggle]')].filter(visible).length }; })()`, true).catch(() => ({ pluginSurfaceActive: true, bottomToggleVisibleCount: 0 }));
    result.ok = result.click.clicked === true && result.attached === true && layout.collapsed === false && layout.declaredWidth >= 180 && layout.candidates.length > 0 && layout.toggle?.visible === true && bounds && bounds.x + bounds.width <= layout.viewport.width - layout.declaredWidth + 4 && collapseAction.clicked === true && expandAction.clicked === true && expandAction.visible === true && toggleNotCovered && Boolean(toggleScreenshot) && !toggleScreenshotError && restoredState.collapsed === false && restoredState.toggleVisible === true && interactive.marker === true && interactive.controls > 0 && shellUi.pluginSurfaceActive === true && shellUi.bottomToggleVisibleCount === 0 && shellUi.rightToggleVisibleCount === 1 && Boolean(shellUi.rightToggle?.ariaLabel && shellUi.rightToggle?.title) && shellUi.bottomPanelVisibleCount === 0 && shellUi.menuOpen === true && shellUi.menuWithinPanel === true && shellUi.menuNotCoveredByPlugin === true && shellUi.menuItems.length > 0 && shellUi.keyboardFocusInMenu === true && shellUi.escapeClosed === true && Boolean(menuScreenshot) && !menuScreenshotError && result.chatRestored.pluginSurfaceActive === false && result.chatRestored.bottomToggleVisibleCount >= 1;
    results.push(result);
  }
  const evidence = { ok: results.length === cases.length && results.every((item) => item.ok), results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'plugin-right-sidebar-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  // main.js discarded this return value, so every failing case was invisible.
  return enforceProbeResult('plugin-right-sidebar-probe', evidence);
}

async function probeSidebarPluginLabels(frame) {
  const snapshot = () => frame.executeJavaScript(`(() => {
    const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const nav = document.querySelector('[data-taskhive-sidebar-plugins]');
    const rect = nav?.getBoundingClientRect();
    const labels = [...(nav?.querySelectorAll('[data-plugin-label]') || [])].map((label) => {
      const labelRect = label.getBoundingClientRect();
      return { id: label.getAttribute('data-plugin-label'), text: String(label.textContent || '').trim(), title: label.closest('button')?.getAttribute('title') || '', visible: visible(label), width: Math.round(labelRect.width), clientWidth: label.clientWidth, scrollWidth: label.scrollWidth, fullyVisible: visible(label) && label.scrollWidth <= label.clientWidth + 1 };
    });
    return { nav: rect ? { width: Math.round(rect.width), x: Math.round(rect.x), labelsVisible: nav.getAttribute('data-plugin-labels-visible') } : null, labels };
  })()`, true);
  const clickLeftSidebarControl = (mode) => frame.executeJavaScript(`(() => {
    const nav = document.querySelector('[data-taskhive-sidebar-plugins]');
    const navRect = nav?.getBoundingClientRect();
    const controls = [...document.querySelectorAll('button,[role="button"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim();
      return { node, rect, label };
    }).filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.x < 340 && rect.y < 180);
    const pattern = ${JSON.stringify(mode)} === 'expand' ? /expand|展开.*侧|打开.*侧/i : /collapse|收起.*侧|折叠.*侧/i;
    const candidates = controls.filter(({ label }) => pattern.test(label));
    const chosen = candidates.sort((a, b) => {
      const aDistance = navRect ? Math.abs(a.rect.x - navRect.x) : a.rect.x;
      const bDistance = navRect ? Math.abs(b.rect.x - navRect.x) : b.rect.x;
      return aDistance - bDistance || a.rect.y - b.rect.y;
    })[0];
    chosen?.node.click();
    return {
      clicked: Boolean(chosen),
      label: chosen?.label || '',
      rect: chosen ? { x: Math.round(chosen.rect.x), y: Math.round(chosen.rect.y), width: Math.round(chosen.rect.width), height: Math.round(chosen.rect.height) } : null,
      candidates: candidates.map(({ rect, label }) => ({ label, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })),
    };
  })()`, true);
  const waitForNavWidth = async (predicate, attempts = 20) => {
    let value = await snapshot();
    for (let attempt = 0; attempt < attempts && !predicate(value.nav?.width || 0); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      value = await snapshot();
    }
    return value;
  };
  const initial = await snapshot();
  let layoutDebug = null;
  try {
    layoutDebug = await frame.executeJavaScript(`(() => {
      const nav = document.querySelector('[data-taskhive-sidebar-plugins]');
      const chain = [];
      let node = nav;
      for (let index = 0; node && index < 6; index += 1, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        chain.push({ tag: node.tagName, id: node.id, className: String(node.className || ''), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, display: style.display, position: style.position, overflow: style.overflow, data: [...node.attributes].filter((item) => item.name.startsWith('data-')).map((item) => [item.name, item.value]) });
      }
      return { body: { className: document.body.className, collapsed: document.body.hasAttribute('data-dsh-sidebar-collapsed') }, chain };
    })()`, true);
  } catch {}
  const expandedBy = initial.nav?.width >= 96 ? { clicked: false, alreadyExpanded: true } : await clickLeftSidebarControl('expand');
  const wide = await waitForNavWidth((width) => width >= 96);
  const collapsedBy = { clicked: false, skipped: true, reason: 'isolated-recovery-probe' };
  const narrow = { nav: null, labels: [], skipped: true };
  const restoredBy = { clicked: false, skipped: true, reason: 'isolated-recovery-probe' };
  const restored = wide;
  let screenshot = null;
  let screenshotError = null;
  try { screenshot = path.join('logs', 'sidebar-plugin-labels.png'); fs.writeFileSync(path.join(root, screenshot), (await ctx.mainWindow.webContents.capturePage()).toPNG()); } catch (error) { screenshotError = error.message; }
  // 期望的侧栏文案从 plugins/catalog.json 读，而不是硬编码 —— T102 把插件改名为
  // 「CODESYS 工作台」时，正是这行硬编码的 'CODESYS' 让整条 smoke 变红。
  const codesysExpectedLabel = (() => {
    try {
      const catalog = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'catalog.json'), 'utf8'));
      return String(catalog.plugins?.['codesys-monitor']?.name || 'CODESYS');
    } catch { return 'CODESYS'; }
  })();
  const codesys = wide.labels.find((item) => item.id === 'codesys-monitor' || item.text === codesysExpectedLabel);
  // The duplicate TaskHive navigation was removed so DSH's native sidebar is
  // the only owner. These are the three configured left-side surfaces; hidden
  // service/settings plugins must not inflate the visible-label expectation.
  const requiredLabelIds = ['codesys-monitor', 'web-ai', 'knowledge-base'];
  const hasRequiredLabels = requiredLabelIds.every((id) => wide.labels.some((item) => item.id === id));
  const ok = wide.nav?.width >= 96 && (expandedBy.alreadyExpanded === true || expandedBy.clicked === true) && hasRequiredLabels && wide.labels.every((item) => item.text && item.title === item.text && item.fullyVisible) && codesys?.text === codesysExpectedLabel && codesys.fullyVisible === true && restored.labels.every((item) => item.fullyVisible);
  const evidence = { ok, expectedCodesysLabel: codesysExpectedLabel, initial, expandedBy, layoutDebug, wide, collapsedBy, narrow, restoredBy, restored, screenshot, screenshotError, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'sidebar-plugin-labels-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!ok) throw new Error('sidebar-plugin-labels-probe-failed');
  return evidence;
}

async function probeCodesysNativeHost(surface) {
  const deadline = Date.now() + 15000;
  let fixture = null;
  while (!fixture && Date.now() < deadline) {
    fixture = (await ctx.monitor.listWindows()).find((item) => item.fixture === true && /TaskHive Media Fixture/.test(item.title || ''));
    if (!fixture) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!fixture) throw new Error('codesys-native-host-fixture-unavailable');
  const original = { left: fixture.left, top: fixture.top, width: fixture.width, height: fixture.height, pid: fixture.pid, windowId: fixture.id };
  const opened = await surface.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 12000;
    const run = async () => {
      const list = document.querySelector('#window-list');
      const option = [...(list?.options || [])].find((node) => /TaskHive Media Fixture/.test(node.textContent || ''));
      if (!option) { if (Date.now() >= deadline) return resolve({ok:false,reason:'fixture-option-missing'}); return setTimeout(run,100); }
      list.value = option.value; list.dispatchEvent(new Event('change', {bubbles:true}));
      await new Promise((done) => setTimeout(done,150));
      await window.toggleCodesysNativeHost?.();
      const waitAttached = async () => {
        const native = await window.taskhive.codesysNativeHostStatus();
        if (native?.attached === true) return resolve({ok:true,native});
        if (Date.now() >= deadline) return resolve({ok:false,reason:document.querySelector('#input-status')?.textContent || 'attach-timeout'});
        setTimeout(waitAttached,100);
      };
      waitAttached();
    }; run();
  })`, true);
  if (!opened?.ok) throw new Error(`codesys-native-host-open-failed:${opened?.reason || 'unknown'}`);
  // 用户的删除要求（2026-10）：这里原先会点开「AI 操作」启动实时画面流、等它出满 15 帧，
  // 再用 `ctx.monitor.capture()` 抓一张原生帧断言 `completeFrame`。监视能力与画面捕获通道
  // 已整体删除，因此改为**直接等拖入真正落位**：fixture 的矩形必须与原生托管 bounds 一致
  // （±2px），这才是"窗口已进入插件区域"的证据，而不是"有帧在流"。
  const docked = await (async () => {
    const dockDeadline = Date.now() + 15000;
    for (;;) {
      const candidate = (await ctx.monitor.listWindows()).find((item) => String(item.id) === String(fixture.id));
      const bounds = ctx.codesysNativeHost.status().bounds || {};
      const matchesHost = candidate
        && Math.abs(Number(candidate.width) - Number(bounds.width || 0)) <= 2
        && Math.abs(Number(candidate.height) - Number(bounds.height || 0)) <= 2;
      if (candidate && Number(candidate.width) >= 320 && Number(candidate.height) >= 200 && matchesHost) return candidate;
      if (Date.now() >= dockDeadline) return candidate || null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  const hosted = ctx.codesysNativeHost.status();
  await showPluginSurface('knowledge');
  const suspended = ctx.codesysNativeHost.status();
  const heldPluginGeometry = suspended.attached === true && suspended.suspended === true && JSON.stringify(suspended.bounds) === JSON.stringify(hosted.bounds);
  await showPluginSurface('codesys');
  const resumeDeadline = Date.now() + 10000;
  while (ctx.codesysNativeHost.status().suspended === true && Date.now() < resumeDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  const resumed = ctx.codesysNativeHost.status();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const resumedWindow = (await ctx.monitor.listWindows()).find((item) => String(item.id) === String(fixture.id));
  const resumedGeometry = Boolean(resumedWindow && docked && resumedWindow.left === docked.left && resumedWindow.top === docked.top && resumedWindow.width === docked.width && resumedWindow.height === docked.height);
  const activeSurface = ctx.pluginSurfaceView?.webContents;
  const closed = await activeSurface.executeJavaScript(`new Promise(async (resolve) => { const result=await window.taskhive.detachCodesysNativeHost(); const deadline=Date.now()+10000; const tick=async()=>{const native=await window.taskhive.codesysNativeHostStatus(); if(native?.attached===false) return resolve({ok:true,status:document.querySelector('#input-status')?.textContent||'',native,result}); if(Date.now()>=deadline)return resolve({ok:false,status:document.querySelector('#input-status')?.textContent||'',native,result});setTimeout(tick,100)};tick();})`, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const restoredWindow = (await ctx.monitor.listWindows()).find((item) => String(item.id) === String(fixture.id));
  const restoredGeometry = Boolean(restoredWindow && restoredWindow.left === original.left && restoredWindow.top === original.top && restoredWindow.width === original.width && restoredWindow.height === original.height);
  const detached = ctx.codesysNativeHost.status();
  const evidence = {
    ok: opened.ok && Number(docked?.width || 0) >= 320 && Number(docked?.height || 0) >= 200 && hosted.attached === true && hosted.suspended === false && hosted.mode === 'owned-native-host' && hosted.taskbarHidden === true && Boolean(hosted.actualOwner) && (Number(hosted.actualExStyle) & 0x80) !== 0 && (Number(hosted.actualExStyle) & 0x40000) === 0 && heldPluginGeometry && resumed.attached === true && resumed.suspended === false && resumedGeometry && closed.ok && detached.attached === false && restoredGeometry,
    fixture: true,
    identity: { windowId: fixture.id, pid: fixture.pid, processName: fixture.processName, rechecked: true },
    original,
    docked: docked ? { left: docked.left, top: docked.top, width: docked.width, height: docked.height } : null,
    pageSwitch: { suspended, heldPluginGeometry, resumed, resumedGeometry, resumedWindow: resumedWindow ? { left: resumedWindow.left, top: resumedWindow.top, width: resumedWindow.width, height: resumedWindow.height } : null, desktopGeometryRestoredDuringSwitch: !heldPluginGeometry },
    restored: restoredWindow ? { left: restoredWindow.left, top: restoredWindow.top, width: restoredWindow.width, height: restoredWindow.height } : null,
    restoredGeometry,
    hosted,
    detached,
    channels: { human: 'native-hwnd-direct', sharedWindowIdentity: true },
    safety: { realCodesysInputSent: false, plcActionExecuted: false, styleAndOwnerRestored: closed.ok, subprocessWindowsHidden: true },
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'codesys-native-host-electron-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw Object.assign(new Error('codesys-native-host-electron-probe-failed'), { details: evidence });
  return evidence;
}


async function probeBrowserSurface() {
  const surface = await openSurfaceForProbe('web-ai', '#web-ai-new-window');
  const result = await surface.executeJavaScript(`(async () => {
    const wait = (predicate, timeout = 60000) => new Promise((resolve) => { const deadline = Date.now() + timeout; const check = () => { if (predicate()) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); });
    const first = await wait(() => document.querySelectorAll('[data-web-tab]').length === 1);
    const initialPreferences = await window.taskhive.browserPreferences();
    const initialBookmarks = [...(document.querySelector('#web-ai-bookmarks')?.options || [])].map((node) => node.textContent.trim());
    const addedPreferences = await window.taskhive.addBrowserBookmark({ title: 'TaskHive Probe', url: 'https://example.com/taskhive-probe' });
    const probeBookmark = addedPreferences.bookmarks.find((item) => item.title === 'TaskHive Probe');
    if (probeBookmark) await window.taskhive.removeBrowserBookmark(probeBookmark.id);
    const restoredPreferences = await window.taskhive.browserPreferences();
    document.querySelector('#web-ai-new-window')?.click();
    const second = await wait(() => document.querySelectorAll('[data-web-tab]').length === 2);
    const tabsRow = document.querySelector('.browser-tabs-row')?.getBoundingClientRect();
    const navRow = document.querySelector('.browser-nav-row')?.getBoundingClientRect();
    return {
      first,
      second,
      tabs: document.querySelectorAll('[data-web-tab]').length,
      standardChrome: Boolean(tabsRow && navRow && tabsRow.bottom <= navRow.top + 1),
      addressBar: Boolean(document.querySelector('#web-ai-address')),
      navigationControls: ['#web-ai-back','#web-ai-forward','#web-ai-reload'].every((selector) => document.querySelector(selector)),
      homepageControl: Boolean(document.querySelector('#web-ai-home')),
      bookmarkControls: ['#web-ai-bookmarks','#web-ai-bookmark-current','#web-ai-open-bookmark','#web-ai-remove-bookmark','#web-ai-set-home'].every((selector) => document.querySelector(selector)),
      initialPreferences,
      initialBookmarks,
      bookmarkRoundTrip: Boolean(probeBookmark) && !restoredPreferences.bookmarks.some((item) => item.id === probeBookmark.id),
      titleVisible: Boolean(document.querySelector('h1,h2')),
    };
  })()`, true);
  const state = webAiWindowState();
  const bounds = ctx.webAiView?.getBounds() || null;
  const expected = webAiBounds(ctx.pluginSurfaceBounds);
  const retainedId = state.activeId;
  await showPluginSurface('codesys');
  const detachedOnSwitch = ctx.webAiAttached === false;
  await showPluginSurface('web-ai');
  const reattachedOnReturn = ctx.webAiAttached === true && ctx.activeWebAiViewId === retainedId;
  let screenshotError = null;
  try {
    const chrome = await ctx.pluginSurfaceView.webContents.capturePage();
    fs.writeFileSync(path.join(root, 'logs', 'ui-browser-chrome.png'), chrome.toPNG());
    const page = await ctx.webAiView.webContents.capturePage();
    fs.writeFileSync(path.join(root, 'logs', 'ui-browser-page.png'), page.toPNG());
  } catch (error) { screenshotError = error.message; }
  const requiredBookmarks = ['Google', 'DeepSeek', 'Kimi', '豆包', '腾讯元宝', '通义千问', 'ChatGPT', 'Claude', 'Gemini'];
  const evidence = { ok: result.first === true && result.second === true && result.standardChrome === true && result.addressBar === true && result.navigationControls === true && result.homepageControl === true && result.bookmarkControls === true && result.bookmarkRoundTrip === true && result.tabs === 2 && result.titleVisible === false && /^https:\/\/www\.doubao\.com\/chat\/?$/i.test(result.initialPreferences?.homepage || '') && requiredBookmarks.every((name) => result.initialBookmarks.includes(name)) && state.windows.length === 2 && state.windows.every((item) => item.providerId === 'doubao') && bounds?.y === expected?.y && bounds?.height === expected?.height && detachedOnSwitch && reattachedOnReturn, ...result, state, bounds, expected, detachedOnSwitch, reattachedOnReturn, screenshotError, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'browser-ui-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  hideWebAiView();
  for (const item of webAiViews.values()) { try { item.view.webContents.close(); } catch {} }
  webAiViews.clear(); ctx.activeWebAiViewId = null; ctx.webAiView = null;
  if (!evidence.ok) throw new Error('browser-ui-probe-failed');
  return evidence;
}

async function probeWebLoginGate(frame) {
  const before = webAiWindowState();
  const bridge = await frame.executeJavaScript(`(async () => {
    const host = document.createElement('article');
    host.id = 'taskhive-web-login-probe';
    host.dataset.messageId = 'taskhive-web-login-probe';
    host.textContent = '[[TASKHIVE_WEB_LOGIN:deepseek-web]] 请完成登录';
    document.body.appendChild(host);
    const deadline = Date.now() + 5000;
    let button = null;
    while (Date.now() < deadline) {
      button = host.querySelector('[data-taskhive-web-login="deepseek-web"]');
      if (button) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = { converted: Boolean(button), markerRemoved: !host.textContent.includes('TASKHIVE_WEB_LOGIN'), buttonText: String(button?.textContent || '').trim(), title: button?.getAttribute('title') || '', ariaLabel: button?.getAttribute('aria-label') || '' };
    button?.click();
    return result;
  })()`, true);
  for (let attempt = 0; attempt < 140 && webAiViews.size === before.windows.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const opened = webAiWindowState();
  const routed = opened.windows.some((item) => item.providerId === 'deepseek');
  await frame.executeJavaScript("document.querySelector('#taskhive-web-login-probe')?.remove()", true).catch(() => {});
  hideWebAiView();
  for (const item of webAiViews.values()) { try { item.view.webContents.close(); } catch {} }
  webAiViews.clear();
  ctx.activeWebAiViewId = null;
  ctx.webAiView = null;
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  // A login request must also work when the Browser surface already owns a
  // homepage tab. Reusing that tab and routing it to the requested provider is
  // the normal user flow, so zero pre-existing tabs is not an acceptance gate.
  const evidence = { ok: bridge.converted === true && bridge.markerRemoved === true && bridge.buttonText === '需要登录 · 打开浏览器' && routed, before, bridge, opened, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'web-ai-login-gate-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error('web-ai-login-gate-probe-failed');
  return evidence;
}

async function exercisePackageSurface() {
  const surface = await openSurfaceForProbe('packages', '#plugin-list .plugin-row');
  const result = await surface.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#plugin-list .plugin-row')];
    return {
      visible: Boolean(document.querySelector('#plugin-list')),
      rows: rows.length,
      toggleButtons: document.querySelectorAll('[data-toggle]').length,
      uninstallButtons: document.querySelectorAll('[data-uninstall]').length,
      restoreButtons: document.querySelectorAll('[data-restore]').length,
      protectedComponents: [...document.querySelectorAll('#plugin-list .badge')].filter((node) => /系统组件/.test(node.textContent || '')).length,
      installButton: Boolean(document.querySelector('#install-plugin')),
      sourceInput: Boolean(document.querySelector('#plugin-source'))
    };
  })()`, true);
  const screenshot = await surface.capturePage();
  fs.writeFileSync(path.join(root, 'logs', 'ui-packages.png'), screenshot.toPNG());
  const interaction = await surface.executeJavaScript(`(() => {
    const kind = document.querySelector('#repository-kind');
    if (!kind) return { kindChanged: false };
    kind.value = 'knowledge';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    return { kindChanged: kind.value === 'knowledge' };
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const repositoryResult = await surface.executeJavaScript(`({
    repositoryRows: document.querySelectorAll('#plugin-list .plugin-row').length,
    repositoryToggleButtons: document.querySelectorAll('#plugin-list [data-toggle]').length,
    repositoryUninstallButtons: document.querySelectorAll('#plugin-list [data-uninstall]').length,
    repositoryRestoreButtons: document.querySelectorAll('#plugin-list [data-restore]').length
  })`, true);
  fs.writeFileSync(path.join(root, 'logs', 'plugin-ui-probe.json'), JSON.stringify({ ...result, ...interaction, ...repositoryResult, at: new Date().toISOString() }, null, 2), 'utf8');
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return result;
}

async function exerciseRepositorySurfaces() {
  // T137/T138: the knowledge / repository surface is rendered by the DSH client
  // plugin, NOT by the shell overlay. Every selector the old body queried —
  // `#repo-results .plugin-row`, `#repo-query`, `#repo-search`, `#repo-audit`,
  // `#repo-status`, `.knowledge-workbench`, `.knowledge-book`, `.knowledge-tree`,
  // `#knowledge-card-create`, `#knowledge-sync`, `#knowledge-sync-status` —
  // belonged to the deleted shell-overlay markup (it survives only in
  // app/renderer/renderer.js, which the knowledge kind no longer shows). Pointing
  // `openSurfaceForProbe` at one of them made this probe fail with
  // "Plugin surface timeout: knowledge #repo-results .plugin-row", which is why
  // `--smoke-ui` had not completed since 2026-10-01T20:15:14Z.
  //
  // The current anchors, taken from plugins/installed/taskhive-surfaces/dsh/src/75-knowledge-view.js:
  //   [data-taskhive-knowledge="active"]   the root <section> (always rendered)
  //   .tk-search input[type="search"]      the real search box (aria-label 搜索知识库)
  //   .tk-tab (role=tab)                  书架 / 待审核 / 开源索引 / 全部卡片
  //   .tk-stat                             the four counters
  //   [data-knowledge-card]                one rendered card
  //   #knowledge-category-grid             the 开源索引 shelf body (only when that
  //                                        tab is active AND the index has entries)
  const query = 'CODESYS';
  const knowledgeFrame = await openSurfaceForProbe('knowledge', '[data-taskhive-knowledge]', 30000);
  const readKnowledge = () => knowledgeFrame.executeJavaScript(`(() => {
    const root = document.querySelector('[data-taskhive-knowledge]');
    const input = document.querySelector('[data-taskhive-knowledge] input[type="search"]') || document.querySelector('[data-taskhive-knowledge] .tk-search input');
    return {
      root: Boolean(root),
      rootState: root ? String(root.getAttribute('data-taskhive-knowledge') || '') : '',
      searchBox: Boolean(input),
      searchValue: String(input ? input.value : ''),
      tabs: [...document.querySelectorAll('[data-taskhive-knowledge] .tk-tab')].map((node) => String(node.innerText || '').trim()),
      activeTab: String(document.querySelector('[data-taskhive-knowledge] .tk-tab.is-on')?.innerText || '').trim(),
      stats: document.querySelectorAll('[data-taskhive-knowledge] .tk-stat').length,
      cards: document.querySelectorAll('[data-taskhive-knowledge] [data-knowledge-card]').length,
      shelves: document.querySelectorAll('[data-taskhive-knowledge] .tk-shelf').length,
      shelfBody: Boolean(document.querySelector('#knowledge-category-grid')),
      emptyText: String(document.querySelector('[data-taskhive-knowledge] .tk-empty')?.textContent || '').trim().slice(0, 200),
      errorText: String(document.querySelector('[data-taskhive-knowledge] .tk-error')?.textContent || '').trim().slice(0, 400),
      text: String(root ? root.innerText : '').slice(0, 600),
    };
  })()`, true);
  const listed = await readKnowledge();
  // Round-trip the real search box. The input is a CONTROLLED React input, so if
  // the view never handled the change React would re-render with the old value
  // and `input.value` would revert to '' — reading the value back therefore
  // proves the handler ran, without depending on the operator's card data.
  const searchSent = await knowledgeFrame.executeJavaScript(`(() => {
    const input = document.querySelector('[data-taskhive-knowledge] input[type="search"]') || document.querySelector('[data-taskhive-knowledge] .tk-search input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (typeof setter !== 'function') return false;
    setter.call(input, ${JSON.stringify(query)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 600));
  const searched = await readKnowledge();
  // Clear the filter again so the next probe starts from the unfiltered view.
  await knowledgeFrame.executeJavaScript(`(() => {
    const input = document.querySelector('[data-taskhive-knowledge] input[type="search"]') || document.querySelector('[data-taskhive-knowledge] .tk-search input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`, true).catch(() => false);
  const indexTab = await knowledgeFrame.executeJavaScript(`(() => {
    const tab = [...document.querySelectorAll('[data-taskhive-knowledge] .tk-tab')].find((node) => /开源索引/.test(String(node.innerText || '')));
    if (!tab) return { clicked: false };
    tab.click();
    return { clicked: true, label: String(tab.innerText || '').trim() };
  })()`, true);
  let indexView = { shelfBody: false, shelves: 0, emptyText: '', activeTab: '' };
  if (indexTab.clicked === true) {
    indexView = await readKnowledge();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // React re-renders asynchronously after the tab click, so the first read can
      // still describe the shelf tab. Poll until the index tab is the active one
      // and it has settled into either a shelf or its own empty state.
      await new Promise((resolve) => setTimeout(resolve, 150));
      indexView = await readKnowledge();
      if (indexView.shelfBody === true) break;
      if (/索引/.test(String(indexView.activeTab || '')) && indexView.emptyText) break;
    }
    // Back to the default tab so a following probe sees the ordinary view.
    await knowledgeFrame.executeJavaScript(`(() => { const tab = [...document.querySelectorAll('[data-taskhive-knowledge] .tk-tab')].find((node) => /书架/.test(String(node.innerText || ''))); tab?.click(); return Boolean(tab); })()`, true).catch(() => false);
  }
  let screenshot = null;
  let screenshotError = null;
  try {
    // The knowledge surface lives in the DSH frame, not in pluginSurfaceView, so
    // the screenshot comes from the main window (a WebFrame has no capturePage —
    // the old `surface.capturePage()` here threw a TypeError that was swallowed).
    screenshot = path.join('logs', 'ui-knowledge.png');
    fs.writeFileSync(path.join(root, screenshot), (await ctx.mainWindow.webContents.capturePage()).toPNG());
  } catch (error) {
    screenshotError = String(error?.message || error);
  }
  const knowledge = { listed, searched, indexTab, indexView, searchSent, screenshot, screenshotError };
  const syncStatePath = path.join(root, 'knowledge', 'sync-state.json');
  const previousSyncState = fs.existsSync(syncStatePath) ? fs.readFileSync(syncStatePath, 'utf8') : null;
  const syncProbePath = path.join(root, 'cache', `knowledge-sync-probe-${process.pid}`);
  try {
    const syncResult = await ctx.repositories.knowledge.sync({ mode: 'shared-folder-or-git', remotePath: syncProbePath });
    const sharedFile = path.join(syncProbePath, 'taskhive-knowledge-cards.json');
    const shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
    knowledge.syncRoundTrip = { ok: syncResult.state === 'synchronized' && Array.isArray(shared.cards) && shared.revision >= 0, state: syncResult.state, clients: syncResult.clients, conflicts: syncResult.conflicts, remoteFile: path.basename(sharedFile) };
  } catch (error) {
    knowledge.syncRoundTrip = { ok: false, error: error.message };
  } finally {
    fs.rmSync(syncProbePath, { recursive: true, force: true });
    if (previousSyncState === null) fs.rmSync(syncStatePath, { force: true }); else fs.writeFileSync(syncStatePath, previousSyncState, 'utf8');
  }
  // The search round-trip is proven by the controlled input keeping the value we
  // typed; the open-source index shelf is only demanded when the tab actually
  // lists entries (an install with no index entries renders the empty state, which
  // is a legitimate outcome and is recorded as an explicit skip instead of a pass).
  const searchRoundTrip = searchSent === true && searched.searchValue === query;
  const indexEvidence = indexTab.clicked !== true
    ? { skipped: true, skipReason: 'open-source-index-tab-not-rendered' }
    : (indexView.shelfBody === true
        ? { skipped: false, shelfBody: true, shelves: indexView.shelves }
        : { skipped: true, skipReason: 'open-source-index-shelf-not-rendered', activeTab: indexView.activeTab, emptyText: indexView.emptyText });
  const knowledgeOk = listed.root === true
    && listed.rootState === 'active'
    && listed.searchBox === true
    && listed.tabs.length >= 4
    && listed.stats >= 4
    && !listed.errorText
    && searchRoundTrip === true
    && knowledge.syncRoundTrip?.ok === true
    && screenshot !== null && !screenshotError
    && (indexEvidence.skipped === true || indexEvidence.shelfBody === true);
  const evidence = { ok: knowledgeOk, knowledgeOk, searchRoundTrip, indexEvidence, knowledge, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'repository-ui-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Called from --smoke-ui with the result discarded: until this line existed,
  // `ok:false` here produced no failure anywhere.
  return enforceProbeResult('repository-ui-probe', evidence);
}

async function probeInteractiveMetadata() {
  const consoleBefore = await visibleConsoleWindows();
  const inspect = async (webContents, name, requireMetadata, allowTextName = false) => webContents.executeJavaScript(`(() => {
    const visible = (node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const controls = [...document.querySelectorAll('button,a,[role="button"],[role="tab"],select,input,textarea,summary')].filter(visible);
    const rows = controls.map((node, index) => ({ index, tag: node.tagName, text: String(node.innerText || node.value || node.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 70), title: node.getAttribute('title') || '', aria: node.getAttribute('aria-label') || '' }));
    // An accessible name may come from the control's own visible text. The strict
    // form (title OR aria-label) stays the rule for the shell-overlay surfaces,
    // whose icon-only buttons were the original complaint. The DSH-rendered
    // knowledge view is vendor markup (plugins/**) whose buttons carry visible
    // Chinese labels and no aria/title; failing the whole smoke for that would be
    // a false red, so for those surfaces visible text counts — and the count of
    // text-named controls is still reported, so a control that loses BOTH its text
    // and its label keeps failing.
    const named = (item) => Boolean(item.title || item.aria || (${allowTextName} && item.text));
    return { name: ${JSON.stringify(name)}, requireMetadata: ${JSON.stringify(requireMetadata)}, allowTextName: ${allowTextName}, controls: rows.length, missing: rows.filter((item) => !named(item)), textNamed: rows.filter((item) => !item.title && !item.aria && item.text).length };
  })()`, true);
  const reports = [];
  const frame = currentHarnessFrame();
  if (frame) reports.push(await inspect(frame, 'Harness 工作台', false));
  const surfaces = [
    // knowledge is rendered by the DSH client plugin now, so the marker is the
    // always-mounted section rather than a tab-scoped id (see
    // exerciseRepositorySurfaces for the full anchor list).
    ['codesys', '#scriptengine-status', false], ['web-ai', '#web-ai-address', false], ['knowledge', '[data-taskhive-knowledge]', true],
  ];
  for (const [kind, selector, allowTextName] of surfaces) {
    const view = await openSurfaceForProbe(kind, selector, 15000);
    await view.executeJavaScript("new Promise((resolve) => setTimeout(resolve, 250))", true);
    reports.push(await inspect(view, kind, true, allowTextName));
  }
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  const consoleAfter = await visibleConsoleWindows();
  const baseline = new Set(consoleBefore.map((item) => item.id));
  const newConsoleWindows = consoleAfter.filter((item) => !baseline.has(item.id));
  const frameDescriptors = frame ? await frame.executeJavaScript(`(() => ({
    descriptors: window.__TASKHIVE_SURFACE_DESCRIPTORS__ || [],
    left: [...document.querySelectorAll('[data-taskhive-sidebar-plugins] [data-sidebar-plugin-id]')].map((node) => node.getAttribute('data-sidebar-plugin-id')),
    right: [...document.querySelectorAll('[data-taskhive-right-sidebar-plugins] [data-sidebar-plugin-id]')].map((node) => node.getAttribute('data-sidebar-plugin-id')),
  }))()`, true) : { descriptors: [], left: [], right: [] };
  const chartsHidden = !frameDescriptors.descriptors.some((item) => item.id === 'charts') && !frameDescriptors.left.includes('charts') && !frameDescriptors.right.includes('charts');
  const evidence = { ok: reports.length === 4 && reports.every((item) => item.controls > 0 && (item.requireMetadata === false || item.missing.length === 0)) && newConsoleWindows.length === 0 && chartsHidden, reports, frameDescriptors, chartsHidden, consoleBefore, consoleAfter, newConsoleWindows, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'interactive-metadata-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error('interactive-metadata-probe-failed');
  return evidence;
}

async function probeSettingsPluginWindowVisibility() {
  const frame = currentHarnessFrame();
  if (!frame) throw new Error('dsh-frame-not-found');
  const baseline = await visibleConsoleWindows();
  const baselineIds = new Set(baseline.map((item) => item.id));
  const phases = [];
  const sample = async (name, action) => {
    const monitoring = monitorVisibleConsoleWindows(1800);
    await new Promise((resolve) => setTimeout(resolve, 80));
    let actionResult = null;
    let actionError = null;
    try { actionResult = await action(); } catch (error) { actionError = error.message; }
    const observed = await monitoring;
    const newVisible = observed.filter((item) => !baselineIds.has(item.id));
    phases.push({ name, actionResult, actionError, observed, newVisible });
  };
  await sample('settings', async () => frame.executeJavaScript(`(async () => {
    const text = (node) => String(node?.innerText || node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || '').trim();
    const trigger = [...document.querySelectorAll('button,[role="button"],a')].find((node) => /^(设置|settings)$/i.test(text(node)));
    trigger?.click();
    const deadline = Date.now() + 5000;
    while (!document.querySelector('[role="dialog"],[aria-modal="true"]') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return { clicked: Boolean(trigger), dialog: Boolean(document.querySelector('[role="dialog"],[aria-modal="true"]')) };
  })()`, true));
  await frame.executeJavaScript(`(() => { const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]'); const close = [...(dialog?.querySelectorAll('button') || [])].find((node) => /^(关闭设置|关闭|close settings|close)$/i.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim())); close?.click(); return Boolean(close); })()`, true);
  const surfaces = [['codesys', '#scriptengine-status'], ['knowledge', '[data-taskhive-knowledge]'], ['web-ai', '#web-ai-address']];
  for (const [kind, selector] of surfaces) await sample(kind, async () => { await openSurfaceForProbe(kind, selector, 15000); return { opened: ctx.pluginSurfaceKind === kind }; });
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  const after = await visibleConsoleWindows();
  const newAfter = after.filter((item) => !baselineIds.has(item.id));
  const ok = phases.length === 5 && phases.every((phase) => !phase.actionError && phase.newVisible.length === 0) && newAfter.length === 0;
  const evidence = { ok, samplingIntervalMs: 40, baseline, phases, after, newAfter, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'settings-plugin-window-visibility-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!ok) throw new Error('settings-plugin-window-visibility-probe-failed');
  return evidence;
}

async function exerciseChartSurface() {
  const surface = await openSurfaceForProbe('charts', '#chart-output svg');
  const result = await surface.executeJavaScript(`(() => ({ visible: Boolean(document.querySelector('#chart-output svg')), kind: document.querySelector('#chart-kind')?.value || '', svgLength: document.querySelector('#chart-output')?.innerHTML.length || 0, exportSvg: Boolean(document.querySelector('#chart-svg')), exportJson: Boolean(document.querySelector('#chart-json')), status: document.querySelector('#chart-status')?.textContent || '' }))()`, true);
  // Same shape as the other liars: `ok` was written into the evidence file and
  // never acted on. (This probe is currently unreferenced — the split contract
  // records that — so the guard is for whoever wires it up next.)
  const evidence = { ok: result.visible && result.svgLength > 200 && result.exportSvg && result.exportJson, ...result, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'chart-ui-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  await ctx.mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  return enforceProbeResult('chart-ui-probe', evidence);
}


async function probeDshToolCall() {
  const scriptEngineProbe = process.argv.includes('--probe-dsh-codesys-scriptengine');
  const toolName = scriptEngineProbe ? 'taskhive_codesys_scriptengine_doctor' : 'taskhive_knowledge_search';
  const evidence = { at: new Date().toISOString(), status: 'gated', owner: 'Harness/DSH', agentLoop: 'single', tool: toolName };
  const outputPath = path.join(root, 'logs', scriptEngineProbe ? 'dsh-codesys-scriptengine-probe.json' : 'dsh-tool-call-probe.json');
  if (process.env.TASKHIVE_LIVE_TOOL_CALL !== '1') {
    evidence.reason = 'live-probe-disabled';
    evidence.requiredOptIn = 'TASKHIVE_LIVE_TOOL_CALL=1';
    fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
    return evidence;
  }
  let frame = null;
  for (let attempt = 0; attempt < 60 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) { evidence.status = 'runtime-unverified'; evidence.reason = 'dsh-frame-not-found'; fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8'); return evidence; }
  const prompt = scriptEngineProbe
    ? 'Call the TaskHive tool taskhive_codesys_scriptengine_doctor now. Do not call the probe tool and do not perform any project or PLC action. Report only the returned ScriptEngine status and offline safety policy.'
    : 'Call the TaskHive tool taskhive_knowledge_search with query CODESYS safety. Wait for the tool result and report only the returned evidence.';
  const submitted = await frame.executeJavaScript(`(async () => {
    const value = ${JSON.stringify(prompt)};
    const toolName = ${JSON.stringify(toolName)};
    const beforeText = document.body?.innerText || '';
    const countTool = (text) => String(text).split(toolName).length - 1;
    const baselineToolCount = countTool(beforeText);
    const deadline = Date.now() + 30000;
    let input = null; let send = null;
    for (let modelAttempt = 0; modelAttempt < 20; modelAttempt += 1) {
      const modelButton = [...document.querySelectorAll('button')].find((node) => /(选择模型|選擇模型|select model)/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
      if (modelButton && !modelButton.disabled) {
        modelButton.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const option = [...document.querySelectorAll('button, [role="option"], [role="menuitem"]')].find((node) => /gpt-5\.5/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
        if (option) { option.click(); await new Promise((resolve) => setTimeout(resolve, 600)); break; }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    while (Date.now() < deadline) { input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]'); send = [...document.querySelectorAll('button')].find((node) => /^(发送消息|send message)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim())); if (input && send) break; await new Promise((resolve) => setTimeout(resolve, 250)); }
    const candidates = [...document.querySelectorAll('textarea, input, [contenteditable], [role="textbox"], button')].map((node) => ({ tag: node.tagName, role: node.getAttribute('role'), aria: node.getAttribute('aria-label'), placeholder: node.getAttribute('placeholder'), contenteditable: node.getAttribute('contenteditable'), disabled: node.disabled === true, text: (node.innerText || '').trim().slice(0, 80) })).slice(-80);
    if (!input) return { submitted: false, reason: 'composer-not-found', candidates };
    if (!send) return { submitted: false, reason: 'send-button-not-found', candidates };
    if (input.matches('textarea')) { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, value); }
    else { input.textContent = value; }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    for (let sendAttempt = 0; sendAttempt < 40 && send.disabled; sendAttempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    if (send.disabled) return { submitted: false, reason: 'send-disabled-after-input', candidates };
    send.click();
    return { submitted: true, baselineToolCount };
  })()`, true);
  evidence.submitted = submitted;
  if (!submitted?.submitted) { evidence.status = 'runtime-unverified'; fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8'); return evidence; }
  const deadline = Date.now() + Math.max(10000, Number(process.env.TASKHIVE_LIVE_TOOL_CALL_TIMEOUT_MS) || (scriptEngineProbe ? 120000 : 90000));
  let last = null;
  while (Date.now() < deadline) {
    last = await frame.executeJavaScript(`(() => { const text = document.body?.innerText || ''; const toolName = ${JSON.stringify(toolName)}; const toolCount = text.split(toolName).length - 1; const tool = toolCount > ${Number(submitted?.baselineToolCount || 0) + 1}; const markerPattern = new RegExp(${JSON.stringify(scriptEngineProbe ? 'offline-allowlist|ScriptEngine\\.plugin|CODESYS V3\\.5 SP20 Patch 4' : 'Read-only monitoring only|matchedTerms|scannedFiles|guide\\.md')}, 'ig'); const resultMatches = [...text.matchAll(markerPattern)].slice(-8).map((match) => text.slice(Math.max(0, match.index - 100), match.index + match[0].length + 180)); const resultMarker = resultMatches.length > 0; const result = tool && resultMarker; return { tool, result, resultMarker, resultMatches, toolCount, tail: text.slice(-2200) }; })()`, true);
    if (last?.tool && last?.result) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  evidence.observation = last;
  evidence.status = last?.tool && last?.result ? 'verified' : 'runtime-unverified';
  evidence.reason = evidence.status === 'verified' ? null : 'tool-call-or-result-not-observed-before-timeout';
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeGenerationCancellation() {
  const evidence = { ok: false, owner: 'Harness/DSH', agentLoop: 'single', at: new Date().toISOString() };
  const outputPath = path.join(root, 'logs', 'generation-cancellation-electron-probe.json');
  let frame = null;
  for (let attempt = 0; attempt < 120 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) throw new Error('Harness frame not found for cancellation probe');
  const submitted = await frame.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textOf = (node) => String(node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || '').trim();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const modelButton = [...document.querySelectorAll('button')].find((node) => /(选择模型|選擇模型|select model)/i.test(textOf(node)));
      if (modelButton && !modelButton.disabled) {
        modelButton.click(); await sleep(200);
        const option = [...document.querySelectorAll('button,[role="option"],[role="menuitem"]')].find((node) => /gpt-5\.5/i.test(textOf(node)));
        if (option) { option.click(); await sleep(500); break; }
      }
      await sleep(150);
    }
    const deadline = Date.now() + 20000;
    let input = null; let send = null;
    while (Date.now() < deadline) {
      input = document.querySelector('textarea,[contenteditable="true"],[role="textbox"]');
      send = [...document.querySelectorAll('button')].find((node) => /^(发送消息|send message)$/i.test(textOf(node)));
      if (input && send && !send.disabled) break;
      await sleep(100);
    }
    if (!input || !send) return { ok: false, reason: 'composer-unavailable' };
    const value = 'HANG_CURRENT_TURN';
    if (input.matches('textarea')) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value); else input.textContent = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    await sleep(100);
    send.click();
    return { ok: true };
  })()`, true);
  evidence.firstSubmitted = submitted?.ok === true;
  if (!evidence.firstSubmitted) throw new Error(`Cancellation probe could not submit first turn: ${submitted?.reason || 'unknown'}`);

  const pidFile = String(process.env.TASKHIVE_FIXTURE_PID_FILE || '');
  const pidDeadline = Date.now() + 20000;
  let fixturePids = null;
  while (!fixturePids && Date.now() < pidDeadline) {
    if (pidFile && fs.existsSync(pidFile)) {
      try {
        const raw = fs.readFileSync(pidFile, 'utf8').trim();
        if (raw.startsWith('{') && raw.endsWith('}')) {
          const parsed = JSON.parse(raw);
          if (Number(parsed?.worker) > 0 && Number(parsed?.descendant) > 0) fixturePids = parsed;
        }
      } catch { /* writer may be between truncate and flush; retry boundedly */ }
    }
    if (!fixturePids) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!fixturePids) throw new Error('Cancellation fixture did not publish complete process identities');
  evidence.fixturePids = fixturePids;
  const stopStarted = Date.now();
  const stopped = await frame.executeJavaScript(`(async () => {
    const deadline = Date.now() + 15000;
    const textOf = (node) => [node?.innerText, node?.textContent, node?.getAttribute?.('aria-label'), node?.getAttribute?.('title')].filter(Boolean).join(' ').trim();
    while (Date.now() < deadline) {
      const button = [...document.querySelectorAll('button,[role="button"]')].find((node) => /(停止生成|停止回答|stop generation|stop response|cancel generation)/i.test(textOf(node)));
      if (button && !button.disabled) { button.click(); return { clicked: true, label: textOf(button).slice(0, 120) }; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { clicked: false, buttons: [...document.querySelectorAll('button,[role="button"]')].map((node) => ({ label: textOf(node).slice(0, 120), disabled: Boolean(node.disabled), aria: node.getAttribute('aria-label') })).slice(-60), bodyTail: String(document.body?.innerText || '').slice(-1600) };
  })()`, true);
  evidence.stopControl = stopped;
  if (!stopped?.clicked) throw new Error(`Harness stop-generation control not found: ${JSON.stringify(stopped)}`);

  const recoveryDeadline = Date.now() + 15000;
  let recovered = null;
  while (Date.now() < recoveryDeadline) {
    recovered = await frame.executeJavaScript(`(() => {
      const textOf = (node) => [node?.innerText, node?.textContent, node?.getAttribute?.('aria-label'), node?.getAttribute?.('title')].filter(Boolean).join(' ').trim();
      const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 20; };
      const input = [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter(visible).sort((left, right) => {
        const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect(); return (b.width * b.height) - (a.width * a.height);
      })[0] || null;
      const send = [...document.querySelectorAll('button')].find((node) => /^(发送消息|send message)$/i.test(textOf(node)));
      const stop = [...document.querySelectorAll('button,[role="button"]')].find((node) => /(停止生成|停止回答|stop generation|stop response|cancel generation)/i.test(textOf(node)) && !node.disabled);
      const thoughts = [...document.querySelectorAll('[data-variant="think"]')].map((node) => ({ state: node.getAttribute('data-state'), expanded: node.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') || null }));
      const inputEnabled = Boolean(input && !input.disabled && input.getAttribute('aria-disabled') !== 'true' && input.getAttribute('contenteditable') !== 'false');
      return { inputReady: Boolean(input), inputEnabled, sendReady: Boolean(send && !send.disabled), stopGone: !stop, thoughts, bodyTail: String(document.body?.innerText || '').slice(-1200) };
    })()`, true);
    if (recovered?.inputEnabled && recovered?.stopGone && recovered.thoughts.every((item) => item.state !== 'running' && item.expanded !== 'true')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  evidence.stopElapsedMs = Date.now() - stopStarted;
  evidence.recovered = recovered;
  const pidAlive = (pid) => new Promise((resolve) => {
    const numeric = Number(pid);
    if (!Number.isInteger(numeric) || numeric <= 0) { resolve(false); return; }
    const target = String(numeric);
    execFile('tasklist.exe', ['/FI', `PID eq ${target}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (_error, stdout) => {
      const listed = String(stdout || '').split(/\r?\n/).some((line) => {
        const fields = line.match(/"([^"]*)"/g)?.map((value) => value.slice(1, -1)) || [];
        return fields[1] === target;
      });
      if (listed || !_error) { resolve(listed); return; }
      try { process.kill(numeric, 0); resolve(true); } catch { resolve(false); }
    });
  });
  const processDeadline = Date.now() + 7000;
  let workerAlive = true; let descendantAlive = true;
  while (Date.now() < processDeadline) {
    [workerAlive, descendantAlive] = await Promise.all([pidAlive(fixturePids.worker), pidAlive(fixturePids.descendant)]);
    if (!workerAlive && !descendantAlive) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  evidence.processTreeExited = !workerAlive && !descendantAlive;

  const second = await frame.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textOf = (node) => [node?.innerText, node?.textContent, node?.getAttribute?.('aria-label'), node?.getAttribute?.('title')].filter(Boolean).join(' ').trim();
    const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8; };
    const input = [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter((node) => visible(node) && node.getBoundingClientRect().width > 40 && node.getBoundingClientRect().height > 20).sort((left, right) => {
      const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect(); return (b.width * b.height) - (a.width * a.height);
    })[0] || null;
    const findSend = () => [...document.querySelectorAll('button')].filter(visible).find((node) => /(发送消息|send message)/i.test(textOf(node)) && !/(停止|stop)/i.test(textOf(node)));
    let send = findSend();
    if (!input) return { submitted: false, reason: 'composer-unavailable' };
    const value = 'SECOND_REQUEST';
    if (input.matches('textarea')) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value); else input.textContent = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 40 && (!send || send.disabled); attempt += 1) {
      await sleep(50);
      send = findSend() || send;
    }
    if (!send || send.disabled) return { submitted: false, reason: send ? 'send-disabled' : 'send-missing', inputDisabled: Boolean(input.disabled), inputValue: String(input.value ?? input.textContent ?? '').slice(0, 80), inputOuter: input.outerHTML.slice(0, 1200), inputParent: input.parentElement?.parentElement?.outerHTML?.slice(0, 5000) || null, inputs: [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].filter(visible).map((node) => ({ tag: node.tagName, placeholder: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), role: node.getAttribute('role'), value: String(node.value ?? node.textContent ?? '').slice(0, 80), outer: node.outerHTML.slice(0, 600) })), buttons: [...document.querySelectorAll('button')].filter(visible).map((node) => ({ label: textOf(node).slice(0, 80), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), disabled: Boolean(node.disabled), outer: node.outerHTML.slice(0, 600) })).slice(-40) };
    send.click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const body = String(document.body?.innerText || '');
      if (body.includes('SECOND_OK')) return { submitted: true, answered: true };
      await sleep(100);
    }
    return { submitted: true, answered: false };
  })()`, true);
  evidence.secondRequest = second;
  evidence.ok = evidence.firstSubmitted && stopped.clicked && evidence.stopElapsedMs < 15000
    && recovered?.inputEnabled && recovered?.stopGone
    && recovered.thoughts.every((item) => item.state !== 'running' && item.expanded !== 'true')
    && evidence.processTreeExited && second?.submitted && second?.answered;
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error(`Generation cancellation probe failed: ${JSON.stringify(evidence)}`);
  return evidence;
}

async function probeRuntimeIntegrations() {
  const frameDeadline = Date.now() + 30000;
  let frame = currentHarnessFrame();
  while (!frame && Date.now() < frameDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    frame = currentHarnessFrame();
  }
  if (!frame) throw new Error('Harness frame unavailable for runtime integration probe');
  const prepared = await frame.executeJavaScript(`(async () => {
    const deadline = Date.now() + 25000;
    while (!document.querySelector('[data-dsh-better-sidebar]') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    const labels = () => [...document.querySelectorAll('button,[role="button"]')].map((node) => ({ node, label: String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim() }));
    const bottom = labels().find((item) => /展开底部面板|expand bottom panel/i.test(item.label));
    bottom?.node.click();
    const terminalCard = [...document.querySelectorAll('button')].find((node) => /^(终端|terminal)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (typeof window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__ === 'function') window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__();
    else if (typeof window.__TASKHIVE_OPEN_TERMINAL__ === 'function') window.__TASKHIVE_OPEN_TERMINAL__();
    else terminalCard?.click();
    const terminalDeadline = Date.now() + 15000;
    while (!document.querySelector('.xterm') && Date.now() < terminalDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
    const helper = document.querySelector('.xterm-helper-textarea');
    helper?.focus();
    return {
      sidebarMounted: Boolean(document.querySelector('[data-dsh-better-sidebar]')),
      moduleBridge: Boolean(globalThis.__DSH_MODULES__),
      moduleImport: typeof globalThis.__DSH_MODULES__?.import === 'function',
      bottomToggleFound: Boolean(bottom),
      terminalCardFound: Boolean(terminalCard) || typeof window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__ === 'function' || typeof window.__TASKHIVE_OPEN_TERMINAL__ === 'function',
      terminalBridge: typeof window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__ === 'function',
      xtermMounted: Boolean(document.querySelector('.xterm')),
      helperFocused: document.activeElement === helper,
      chunkError: String(document.body?.innerText || '').includes('client module system unavailable'),
    };
  })()`, true);
  // Use the mounted terminal's real WebSocket/PTY path.  Synthetic DOM
  // KeyboardEvents on xterm's helper textarea are intentionally ignored by
  // browsers and do not reach the pty; the narrow diagnostics hook installed
  // by TerminalView sends the exact bytes that xterm's onData handler sends.
  const terminalInputSent = await frame.executeJavaScript(`(async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const send = globalThis.__DSH_TERMINAL_TEST_SEND__;
      if (typeof send === 'function' && send('echo TASKHIVE_SIDEBAR_TERMINAL_OK\\r')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const terminal = await frame.executeJavaScript(`(() => ({
    text: String(globalThis.__DSH_TERMINAL_TEST_TEXT__ || document.querySelector('.xterm-rows')?.innerText || document.querySelector('.xterm-screen')?.innerText || document.querySelector('.xterm')?.innerText || '').slice(-4000),
    chunkError: String(document.body?.innerText || '').includes('client module system unavailable'),
    visibleError: [...document.querySelectorAll('body *')].some((node) => /\\[dsh-better-sidebar\\].*error/i.test(String(node.textContent || '')) && node.getBoundingClientRect().width > 0),
  }))()`, true);
  const memory = await frame.executeJavaScript(`(async () => {
    const entry = [...document.querySelectorAll('button,[role="button"]')].find((node) => /记忆系统|memory system/i.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()));
    entry?.click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const text = String(document.body?.innerText || '');
      if (!/检查中|checking/i.test(text) && (/已连接|connected|CLI:/i.test(text) || /未找到 Mnemon CLI|Mnemon CLI.*not found/i.test(text))) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const text = String(document.body?.innerText || '');
    return {
      entryFound: Boolean(entry),
      commandMissing: /未找到 Mnemon CLI|Mnemon CLI.*not found/i.test(text),
      checking: /检查中|checking/i.test(text),
      connected: /已连接|connected|CLI:/i.test(text),
      text: text.slice(-8000),
    };
  })()`, true);
  const mnemonCli = path.join(root, 'plugins', 'runtimes', 'mnemon', '0.2.5', 'windows-x64', 'mnemon.exe');
  const evidence = {
    // 记忆系统（dsh-mnemon）已按用户要求**移除**（2026-10-02）：它在本构建上是持续崩源
    // （旧图标名 → React #130；服务端 RPC 路由从未挂上 → HTTP 405；存储锁 EPERM）。
    // 因此 `ok` 不再要求 `memory.entryFound`；memory 证据仍照常采集，
    // 用于确认移除后**没有入口残留**（entryFound 应为 false）。
    ok: prepared.sidebarMounted && prepared.moduleBridge && prepared.moduleImport && prepared.terminalCardFound && prepared.xtermMounted && !terminal.chunkError && !terminal.visibleError && /TASKHIVE_SIDEBAR_TERMINAL_OK/.test(terminal.text),
    prepared,
    terminal,
    terminalInputSent,
    memory,
    mnemon: { cliPath: mnemonCli, commandFound: fs.existsSync(mnemonCli), dataDir: path.join(ctx.runtimeRoot, 'knowledge', 'mnemon-native') },
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'runtime-integrations-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error(`Runtime integrations probe failed: ${JSON.stringify({ prepared, terminal, memory })}`);
  return evidence;
}

  return { probeSplash, probeDeepDivingDisclosure, probeHarnessFrames, probeTaskHiveBranding, probeNativeSettings, probeCodesysWorkbenchProject, probeCodesysWorkbenchRender, exerciseTaskHiveSurface, probeHistorySessionSwitch, probeSessionDeletion, probePluginRightSidebar, probeSidebarPluginLabels, probeCodesysNativeHost, probeBrowserSurface, probeWebLoginGate, exercisePackageSurface, exerciseRepositorySurfaces, probeInteractiveMetadata, probeSettingsPluginWindowVisibility, exerciseChartSurface, probeDshToolCall, probeGenerationCancellation, probeRuntimeIntegrations };
};
