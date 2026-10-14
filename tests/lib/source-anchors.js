'use strict';

// Locating privileged IPC registrations in app/main.js.
//
// Every privileged channel is registered through `handleTrusted(channel, handler)`
// — which is `ipcMain.handle` bound to the sender-trust check — and the one-way
// channels through `onTrusted(channel, handler)`.
//
// Contracts that assert "this channel is registered" must accept the wrapper.
// Before this helper they searched for the raw `ipcMain.handle('channel'` text,
// so hardening every channel with a sender check made six contracts report a
// missing channel even though each one was registered (and now registered more
// strictly than before). Locating the registration instead of one spelling of it
// keeps those contracts meaningful: they still fail if a channel really is gone.

const WRAPPERS = ['handleTrusted', 'onTrusted', 'ipcMain.handle', 'ipcMain.on'];

// Offset of a channel's registration, so a caller can slice the handler body out
// of the source exactly as it did with a raw `indexOf`. Accepts `fromIndex` to
// support "the registration after this one" lookups.
function registrationIndex(source, channel, fromIndex = 0) {
  let best = -1;
  for (const wrapper of WRAPPERS) {
    const at = source.indexOf(`${wrapper}('${channel}'`, fromIndex);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

function isRegistered(source, channel) {
  return registrationIndex(source, channel) >= 0;
}

module.exports = { registrationIndex, isRegistered, WRAPPERS };
