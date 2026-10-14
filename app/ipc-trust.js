'use strict';

// The trust decision for privileged IPC and for navigation of the two
// preload-bearing windows.
//
// This lives in its own module, free of Electron objects, so the security
// decision can be tested directly instead of only through a running app. The
// caller (app/main.js) is responsible for the Electron-specific part — mapping
// an IPC event to "which of my two windows sent this" — and this module answers
// the part that used to be missing entirely: is that window's CURRENT top frame
// actually the document it is supposed to be?
//
// Why that second question matters:
//   * `preload.js` runs in the top frame only (this app never enables
//     `nodeIntegrationInSubFrames`), so a privileged call from a child frame can
//     only be forged. Electron documents `senderFrame` as the check to make.
//   * matching the WebContents alone accepts ANY document loaded into that
//     window, and the navigation guard used to accept any `file://` URL and any
//     loopback port. Together that meant "open a local HTML file in the shell
//     window" would have inherited the terminal and credential APIs.

const path = require('path');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function parseUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch {
    return null;
  }
}

// The Harness document must be the server THIS launch started. The port is
// pinned exactly: a different local port is a different local process and must
// not inherit the bridge. The host may be any loopback spelling, because the
// runtime may address itself as `localhost` or `127.0.0.1` while still being the
// one server on that port — and no other process can hold that port.
function isHarnessUrl(candidateUrl, harnessRuntimeUrl) {
  const candidate = parseUrl(candidateUrl);
  const expected = parseUrl(harnessRuntimeUrl);
  if (!candidate || !expected) return false;
  if (!LOOPBACK_HOSTS.has(candidate.hostname) || !LOOPBACK_HOSTS.has(expected.hostname)) return false;
  return candidate.protocol === expected.protocol && candidate.port === expected.port;
}

// The shell document must be one of the app's own renderer files. `path.resolve`
// collapses `..`, so a URL such as
// `file:///C:/app/renderer/../../evil.html` resolves out of the renderer tree
// and is rejected rather than accepted for merely starting with `file://`.
function isAppRendererFileUrl(candidateUrl, rendererRoot) {
  let candidate;
  try {
    candidate = new URL(String(candidateUrl || ''));
  } catch {
    return false;
  }
  if (candidate.protocol !== 'file:') return false;
  let filePath;
  try {
    filePath = path.resolve(decodeURIComponent(candidate.pathname).replace(/^[/\\]/, ''));
  } catch {
    return false;
  }
  const root = `${path.resolve(rendererRoot)}${path.sep}`.toLowerCase();
  return `${filePath}${path.sep}`.toLowerCase().startsWith(root);
}

// Pure decision. `senderWindow` is 'shell', 'harness' or 'unknown'.
// Returns { trusted, reason } so the caller can log why a call was refused.
function decideTrustedFrame(options = {}) {
  const {
    senderWindow = 'unknown',
    frameUrl = '',
    isTopFrame = false,
    harnessRuntimeUrl = '',
    rendererRoot = '',
  } = options;

  if (senderWindow !== 'shell' && senderWindow !== 'harness') return { trusted: false, reason: 'unknown-window' };
  if (!isTopFrame) return { trusted: false, reason: 'not-top-frame' };
  if (senderWindow === 'shell') {
    return isAppRendererFileUrl(frameUrl, rendererRoot)
      ? { trusted: true, reason: 'shell-renderer-document' }
      : { trusted: false, reason: 'shell-origin-not-app-renderer' };
  }
  return isHarnessUrl(frameUrl, harnessRuntimeUrl)
    ? { trusted: true, reason: 'harness-runtime-origin' }
    : { trusted: false, reason: 'harness-origin-mismatch' };
}

// Navigation allow-list for a preload-bearing window. `kind` is 'shell' (the
// app's own renderer document) or 'harness' (the local runtime). DevTools and
// about: URLs are permitted for navigation but are deliberately NOT trusted for
// privileged IPC, which `decideTrustedFrame` above never accepts.
function isAllowedWorkbenchNavigation(candidateUrl, options = {}) {
  const value = String(candidateUrl || '');
  if (!value) return false;
  if (value.startsWith('devtools://')) return true;
  if (value.startsWith('about:')) return true;
  if (options.kind === 'shell') return isAppRendererFileUrl(value, options.rendererRoot);
  return isHarnessUrl(value, options.harnessRuntimeUrl);
}

module.exports = { decideTrustedFrame, isAllowedWorkbenchNavigation, isHarnessUrl, isAppRendererFileUrl, LOOPBACK_HOSTS };
