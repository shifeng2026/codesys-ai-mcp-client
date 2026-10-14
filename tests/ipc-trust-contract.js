'use strict';

// Behaviour tests for the privileged-IPC trust decision and the navigation
// allow-list. These call the real decision function with real URLs, because the
// thing being asserted is a security property of URL handling and frame
// identity — a source-text assertion could not prove any of it.
//
// The cases marked REGRESSION are the ones the previous implementation got
// wrong: it matched the WebContents only (accepting any frame and any document
// loaded into it) and its navigation guard allowed every `file://` URL and every
// loopback port.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const { decideTrustedFrame, isAllowedWorkbenchNavigation, isHarnessUrl, isAppRendererFileUrl } = require('../app/ipc-trust');

const rendererRoot = path.resolve('C:/TaskHiveTest/resources/app/app/renderer');
const rendererIndex = pathToFileURL(path.join(rendererRoot, 'index.html')).href;
const rendererNested = pathToFileURL(path.join(rendererRoot, 'panels', 'codesys.html')).href;
const outsideRenderer = pathToFileURL(path.resolve('C:/TaskHiveTest/downloads/evil.html')).href;
const traversal = `${pathToFileURL(path.join(rendererRoot, 'index.html')).href}/../../evil.html`;
const encodedTraversal = `${pathToFileURL(path.join(rendererRoot, 'index.html')).href}/%2e%2e/%2e%2e/evil.html`;
const harnessUrl = 'http://127.0.0.1:43119/?token=abc';
const harnessLocalhost = 'http://localhost:43119/app';

let checks = 0;
function test(name, fn) {
  checks += 1;
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
  }
}

const trust = (overrides) => decideTrustedFrame({
  senderWindow: 'shell',
  frameUrl: rendererIndex,
  isTopFrame: true,
  harnessRuntimeUrl: harnessUrl,
  rendererRoot,
  ...overrides,
});

test('a shell page that is the app renderer top frame is trusted', () => {
  assert.strictEqual(trust({}).trusted, true);
});

test('the shell trust is not given to a child frame', () => {
  const result = trust({ isTopFrame: false });
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(result.reason, 'not-top-frame');
});

test('REGRESSION: an arbitrary file:// document in the shell window is refused', () => {
  const result = trust({ frameUrl: outsideRenderer });
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(result.reason, 'shell-origin-not-app-renderer');
});

test('REGRESSION: a file:// path escaping the renderer tree is refused', () => {
  assert.strictEqual(trust({ frameUrl: traversal }).trusted, false, 'plain ../ traversal');
  assert.strictEqual(trust({ frameUrl: encodedTraversal }).trusted, false, 'percent-encoded traversal');
});

test('a nested renderer document is still trusted', () => {
  assert.strictEqual(trust({ frameUrl: rendererNested }).trusted, true);
});

test('a loopback HTTP page is not trusted for the shell window', () => {
  assert.strictEqual(trust({ frameUrl: 'http://127.0.0.1:8080/local.html' }).trusted, false);
});

test('a missing or unparseable frame URL is refused', () => {
  assert.strictEqual(trust({ frameUrl: '' }).trusted, false);
  assert.strictEqual(trust({ frameUrl: 'not a url' }).trusted, false);
});

test('the Harness runtime origin itself is trusted', () => {
  const result = trust({ senderWindow: 'harness', frameUrl: 'http://127.0.0.1:43119/session/1' });
  assert.strictEqual(result.trusted, true);
  assert.strictEqual(result.reason, 'harness-runtime-origin');
});

test('the same port addressed as localhost is trusted', () => {
  assert.strictEqual(trust({ senderWindow: 'harness', frameUrl: harnessLocalhost }).trusted, true);
});

test('REGRESSION: another loopback port is refused for the Harness window', () => {
  const result = trust({ senderWindow: 'harness', frameUrl: 'http://127.0.0.1:8080/' });
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(result.reason, 'harness-origin-mismatch', 'a different local port is a different local process');
});

test('a portless loopback URL does not match a ported runtime', () => {
  assert.strictEqual(trust({ senderWindow: 'harness', frameUrl: 'http://127.0.0.1/' }).trusted, false);
});

test('a remote origin is refused even with a matching port', () => {
  assert.strictEqual(trust({ senderWindow: 'harness', frameUrl: 'https://example.com:43119/' }).trusted, false);
});

test('an unrecognised sender window is refused', () => {
  const result = trust({ senderWindow: 'unknown' });
  assert.strictEqual(result.trusted, false);
  assert.strictEqual(result.reason, 'unknown-window');
});

test('with no running Harness nothing is trusted', () => {
  assert.strictEqual(trust({ senderWindow: 'harness', frameUrl: harnessUrl, harnessRuntimeUrl: '' }).trusted, false);
});

test('navigation: devtools and about URLs are still permitted', () => {
  assert.strictEqual(isAllowedWorkbenchNavigation('devtools://devtools/bundled/x.html', { kind: 'harness', harnessRuntimeUrl: harnessUrl, rendererRoot }), true);
  assert.strictEqual(isAllowedWorkbenchNavigation('about:blank', { kind: 'shell', harnessRuntimeUrl: harnessUrl, rendererRoot }), true);
});

test('REGRESSION: navigation can no longer reach an arbitrary file:// or port', () => {
  assert.strictEqual(isAllowedWorkbenchNavigation(outsideRenderer, { kind: 'harness', harnessRuntimeUrl: harnessUrl, rendererRoot }), false);
  assert.strictEqual(isAllowedWorkbenchNavigation(outsideRenderer, { kind: 'shell', harnessRuntimeUrl: harnessUrl, rendererRoot }), false);
  assert.strictEqual(isAllowedWorkbenchNavigation('http://127.0.0.1:8080/', { kind: 'harness', harnessRuntimeUrl: harnessUrl, rendererRoot }), false);
  assert.strictEqual(isAllowedWorkbenchNavigation('', { kind: 'harness', harnessRuntimeUrl: harnessUrl, rendererRoot }), false);
});

test('navigation still allows the app renderer and this Harness origin', () => {
  assert.strictEqual(isAllowedWorkbenchNavigation(rendererIndex, { kind: 'shell', harnessRuntimeUrl: harnessUrl, rendererRoot }), true);
  assert.strictEqual(isAllowedWorkbenchNavigation('http://127.0.0.1:43119/', { kind: 'harness', harnessRuntimeUrl: harnessUrl, rendererRoot }), true);
});

test('the exported URL predicates agree with the decision function', () => {
  assert.strictEqual(isAppRendererFileUrl(rendererIndex, rendererRoot), true);
  assert.strictEqual(isAppRendererFileUrl(outsideRenderer, rendererRoot), false);
  assert.strictEqual(isHarnessUrl('http://localhost:43119/x', harnessUrl), true);
  assert.strictEqual(isHarnessUrl('http://127.0.0.1:1/x', harnessUrl), false);
});

console.log(`ipc-trust contract tests passed (${checks} checks)`);
