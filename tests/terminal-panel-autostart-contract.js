'use strict';

// Regression contract for "switching a surface must never pop up the terminal".
//
// 历史：底部面板原先由 bundled `better-sidebar` 插件承载（该插件已随 T132 移除，
// 面板现在是 DSH 0.2 原生面板）。因此针对 better-sidebar 各层 `bottomPanelAutoTerminal`
// 默认值的断言整段删除 —— 那些文件已不存在，保留它们只会让套件红着而失去信号。
//
// 仍然成立的**不变量**（对着当前客户端断言）：
//   · TaskHive 的 surface 切换只允许**收起**底部面板，绝不允许展开它；
//   · 唯一的终端打开入口是显式桥（`__TASKHIVE_OPEN_TERMINAL__` → selectPanel('taskhive:terminal')）；
//   · surface 切换路径不得出现终端 / 开新页签。

const assert = require('assert');
const { readFileSync } = require('fs');
const { join } = require('path');

const surfaces = readFileSync(join(__dirname, '..', 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js'), 'utf8');

// ── 1. TaskHive 客户端只能**收起**底部面板，且只允许有一处引用 ───────────────
//
// Collapsing is required for the user-visible guarantee: a plugin surface only
// CSS-hides the panel (`visibility: hidden`) and the sidebar persists
// `bottomOpen` per session, so a panel left open becomes visible again the
// moment the user switches back to chat — which is exactly the reported
// "a terminal pops up when switching interfaces". Closing it on surface entry
// removes anything to reveal.
const toggleUses = surfaces.match(/data-dsh-bottom-panel-toggle/g) || [];
assert.strictEqual(
  toggleUses.length,
  1,
  'the surfaces client may reference the bottom-panel toggle exactly once, to collapse it',
);
const closeStart = surfaces.indexOf('const closeBottomPanel = ()');
assert(closeStart !== -1, 'the surfaces client must define closeBottomPanel to retire the hidden panel');
const closeEnd = surfaces.indexOf('\n    }', closeStart);
assert(closeEnd > closeStart, 'could not bound the body of closeBottomPanel');
const closeBody = surfaces.slice(closeStart, closeEnd);
assert(closeBody.includes('data-dsh-bottom-panel-toggle'), 'the single toggle reference must live in the collapse helper');
assert(
  /bottomPanelHeight\(\)\s*<=\s*0\)\s*return false/.test(closeBody),
  'the collapse helper must be a no-op when the panel is already closed, so it can never act as a toggle',
);
assert(closeBody.includes('.click()'), 'the collapse helper must actually collapse the panel');
// Nothing anywhere in this file may open the panel or a terminal with it.
assert(!/bottomOpen\s*:\s*true/.test(surfaces), 'the surfaces client must not force the bottom panel open');
assert(!/expandBottomPanel/.test(surfaces), 'the surfaces client must not expand the bottom panel');

// ── 2. The TaskHive surface switch must never open a terminal tab ───────────
for (const name of ['setPluginSurfaceMode', 'openSurface']) {
  const start = surfaces.indexOf(`function ${name}(`);
  assert(start !== -1, `the TaskHive surfaces client must define ${name}`);
  const end = surfaces.indexOf('\n    }', start);
  assert(end > start, `could not bound the body of ${name}`);
  const body = surfaces.slice(start, end);
  assert(!/terminal/i.test(body), `${name} must not open a terminal on a surface switch`);
  assert(!/openTab/.test(body), `${name} must not open a tab on a surface switch`);
}

// The single terminal open left in the TaskHive client is the explicit bridge
// the desktop probe drives; it is unreachable from a surface switch and must
// keep working (the user's deliberate "open terminal" affordance).
//
// DSH 0.2.0-rc.1 removed better-sidebar's openTab({ type: 'terminal' }): the
// terminal is a registered panel now, so the one explicit open is
// selectPanel('taskhive:terminal') behind the same bridge. The tab route must be
// gone entirely — that is the same invariant, against the 0.2 mechanism.
const terminalBridgeOpens = surfaces.match(/selectPanel\('taskhive:terminal'\)/g) || [];
assert.strictEqual(terminalBridgeOpens.length, 1, 'only the explicit terminal bridge may open the terminal panel');
assert(!/openTab\(\{[^}]*type:\s*['"]terminal['"]/.test(surfaces), 'the 0.2 client must not open a terminal tab through openTab');
assert(surfaces.includes('__TASKHIVE_OPEN_TERMINAL__'), 'the explicit terminal bridge must keep working');

console.log('terminal panel autostart contract passed');
