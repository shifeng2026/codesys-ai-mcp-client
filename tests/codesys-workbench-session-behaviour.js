'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../plugins/installed/taskhive-surfaces/dsh/src/40-session-records-panel.js'), 'utf8');
const delivery = source.slice(source.indexOf('    const codesysStateKeepAlive'), source.indexOf('    function scheduleCodesysStateKeepAlive'));
const sent = [];
let complete;
const context = vm.createContext({ codesysWorkbenchApi: (_method, payload) => {
  sent.push(payload);
  return new Promise(resolve => { complete = resolve; });
} });
vm.runInContext(`${delivery}; globalThis.delivery = { state: codesysStateKeepAlive, send: sendCodesysState }`, context);
const { state, send } = context.delivery;

async function main() {
  const pendingB = { sessionId: 'session-b', signature: 'same-project', snapshot: { code: 'B' } };
  state.pendingSnapshot = pendingB;
  const sendingA = send('session-a', { openObject: { code: 'A' } });
  assert.equal(sent[0].state.projectSnapshot, undefined, 'session A must not receive B project code');
  complete({ accepted: true });
  await sendingA;
  assert.equal(state.pendingSnapshot, pendingB, 'A acknowledgement must not consume B snapshot');
  assert.equal(state.publishedSessionId, '');

  const sendingB = send('session-b', { openObject: { code: 'B' } });
  assert.equal(sent[1].state.projectSnapshot, pendingB.snapshot);
  complete({ accepted: false });
  await sendingB;
  assert.equal(state.pendingSnapshot, pendingB, 'rejected delivery must remain pending');
  const retry = send('session-b', {});
  complete({ accepted: true });
  await retry;
  assert.equal(state.publishedSessionId, 'session-b');
  assert.equal(state.publishedSignature, 'same-project');
  assert.equal(state.pendingSnapshot, null);

  state.pendingSnapshot = pendingB;
  const stale = send('session-b', {});
  const newer = { sessionId: 'session-a', signature: 'new-project', snapshot: { code: 'A2' } };
  state.pendingSnapshot = newer;
  complete({ accepted: true });
  await stale;
  assert.equal(state.pendingSnapshot, newer, 'late acknowledgement must not consume a newer session snapshot');
  console.log('codesys workbench session delivery: ownership, rejection/retry and late acknowledgement passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
