#!/usr/bin/env node
// 30-second workbench triage.
//
// Answers "the TaskHive window shows nothing" without guessing: it asks the
// running window what its document actually contains, how the navigation ended,
// how many Harness auth cookies are loaded, and whether the renderer logged any
// error. See docs/KNOWN-ISSUES.md for the incident this exists to catch.
//
// Usage:
//   1. Start TaskHive with a debugging port:  TaskHive.exe --remote-debugging-port=9222
//   2. Run:                                    node tools/inspect-workbench.mjs [port]
//
// Verdicts:
//   WORKBENCH OK                 the document rendered; a blank screen is a
//                                layout/plugin-surface problem, not this one.
//   WORKBENCH EMPTY (status 431) stale dsh-auth-* cookies pushed the request
//                                headers past the host's limit — the known issue.
//   WORKBENCH EMPTY (other)      the navigation returned an error document or a
//                                stub; read the printed navigation status.
import process from 'node:process';

const port = Number(process.argv[2] || 9222);
const base = `http://127.0.0.1:${port}`;

const STATE_PROBE = `(() => {
  const loader = window.__ModuleLoader__;
  const nav = performance.getEntriesByType('navigation')[0] || {};
  return {
    href: location.href.slice(0, 100),
    readyState: document.readyState,
    navStatus: nav.responseStatus,
    navType: nav.type,
    bodyTextLength: (document.body && document.body.innerText || '').length,
    bodyHtmlLength: (document.body && document.body.innerHTML || '').length,
    scriptCount: document.scripts.length,
    moduleLoader: loader ? loader.mode : null,
    taskhiveSurfaces: window.__TASKHIVE_SURFACES_REGISTERED__ === true,
    taskhiveSkin: Boolean(document.querySelector('#taskhive-harness-skin')),
  };
})()`;

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const console_ = [];
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((done) => {
      const current = ++id;
      pending.set(current, done);
      socket.send(JSON.stringify({ id: current, method, params }));
    });
    socket.addEventListener('message', (message) => {
      let payload;
      try { payload = JSON.parse(message.data); } catch { return; }
      if (payload.id !== undefined && pending.has(payload.id)) {
        pending.get(payload.id)(payload);
        pending.delete(payload.id);
        return;
      }
      if (payload.method === 'Runtime.consoleAPICalled') console_.push(`console.${payload.params.type}: ${payload.params.args.map((arg) => String(arg.value ?? arg.description ?? arg.type)).join(' ').slice(0, 600)}`);
      if (payload.method === 'Runtime.exceptionThrown') console_.push(`uncaught: ${String(payload.params.exceptionDetails.exception?.description || payload.params.exceptionDetails.text).slice(0, 900)}`);
      if (payload.method === 'Log.entryAdded' && payload.params.entry.level === 'error') console_.push(`log.error: ${payload.params.entry.text.slice(0, 900)}`);
    });
    socket.addEventListener('error', (error) => reject(new Error(`CDP connect failed: ${error?.message || error}`)));
    socket.addEventListener('open', () => resolve({ send, console: console_, close: () => socket.close() }));
  });
}

let targets;
try {
  targets = await (await fetch(`${base}/json`)).json();
} catch (error) {
  console.error(`Cannot reach ${base} — start TaskHive with --remote-debugging-port=${port} first.`);
  console.error(String(error?.message || error));
  process.exit(2);
}

const pages = targets.filter((target) => target.type === 'page');
if (pages.length === 0) {
  console.error('No page target: the window did not open. Check logs/errors.log and logs/harness-runtime.log.');
  process.exit(2);
}

let worst = 0;
for (const target of pages) {
  console.log(`\n=== page: ${String(target.url).slice(0, 110)}`);
  const session = await connect(target.webSocketDebuggerUrl);
  await session.send('Runtime.enable');
  await session.send('Log.enable').catch(() => {});
  await session.send('Storage.enable').catch(() => {});
  const state = (await session.send('Runtime.evaluate', { expression: STATE_PROBE, returnByValue: true })).result?.result?.value;
  const cookies = (await session.send('Storage.getCookies', {})).result?.cookies || [];
  const auth = cookies.filter((cookie) => String(cookie.name || '').startsWith('dsh-auth-'));
  const authBytes = auth.reduce((sum, cookie) => sum + `${cookie.name}=${cookie.value}`.length + 2, 0);
  await new Promise((resolve) => setTimeout(resolve, 2500));

  console.log(`  navigation : status=${state?.navStatus} type=${state?.navType} readyState=${state?.readyState}`);
  console.log(`  document   : bodyText=${state?.bodyTextLength} bodyHtml=${state?.bodyHtmlLength} scripts=${state?.scriptCount} moduleLoader=${state?.moduleLoader}`);
  console.log(`  taskhive   : surfaces=${state?.taskhiveSurfaces} skin=${state?.taskhiveSkin}`);
  console.log(`  cookies    : total=${cookies.length} dsh-auth=${auth.length} authHeaderBytes≈${authBytes}`);
  if (session.console.length > 0) {
    console.log(`  renderer errors (${session.console.length}):`);
    for (const line of session.console.slice(0, 10)) console.log(`    ${line}`);
  }

  const rendered = Number(state?.bodyHtmlLength || 0) > 0;
  if (rendered) {
    console.log('  VERDICT    : WORKBENCH OK — the document rendered. A blank screen is now a layout/plugin-surface problem, not the known 431 issue.');
  } else if (Number(state?.navStatus) === 431) {
    console.log('  VERDICT    : WORKBENCH EMPTY (status 431) — stale dsh-auth-* cookies exceeded the host request-header limit. See docs/KNOWN-ISSUES.md issue #1.');
    worst = Math.max(worst, 1);
  } else {
    console.log(`  VERDICT    : WORKBENCH EMPTY (navigation status=${state?.navStatus ?? 'unknown'}, scripts=${state?.scriptCount}) — check logs/errors.log for the startup self-diagnosis.`);
    worst = Math.max(worst, 1);
  }
  session.close();
}

process.exit(worst);
