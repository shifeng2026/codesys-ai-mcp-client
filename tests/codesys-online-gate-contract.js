'use strict';

// CODESYS online gate contract.
//
// 12 项 PLC 在线能力里：9 项可实现（全部只能经工作台 + 显式授权到达），
// 3 项（debug / breakpoint / step）在本版本 ScriptEngine 里**没有任何 API**。
// 其中 write-variable / reset / force 额外要求逐字输入确认词。
//
// 这个合同同时钉住两件事：
//   * 9 项能力必须真的接通（bridge → IPC → 授权 → 引擎 → worker Python）；
//   * 3 项无 API 的能力不得出现任何可执行路径。

const assert = require('assert');
const { registrationIndex, isRegistered } = require('./lib/source-anchors');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');

// ── 分段耗时（T229）──────────────────────────────────────────────────────────
//
// 这一条契约**没有任何**定时器、子进程、流或未决 Promise：进程自启动 ~14 ms、
// beforeExit ~85 ms、整个脚本 ~113-143 ms（单跑与三棵树并行各 ≥3 轮实测）。所以它
// 只有两种失败形态，而且必须一眼可分：
//   * 断言不成立 ⇒ 毫秒级、立刻红；
//   * 环境停顿（并发负载下进程被换出/被杀毒过滤器挡在 I/O 里）⇒ 只有 runner 会报
//     `[TIMEOUT]`，契约自己一个字都留不下。
// 于是：**读源码这段唯一的真实 I/O 一完成就打印一行**（进程被杀也已经在日志里），
// 结尾再打印一次分段与重试次数。下一次读日志时，"停在哪一段"是直接可读的。
const gateStartedAt = Date.now();
const gateStages = [];
function gateStage (name) { gateStages.push(`${name}=${Date.now() - gateStartedAt}ms`); }
const sinceBootMs = () => Math.round(Date.now() - performance.timeOrigin);
let gateCompleted = false;
// 断言不成立时（这一条是同步脚本，没有 try/catch 可挂）也要留下"死在哪一段"。
// 退出钩子不是定时器，也不改任何断言；它只把分段写在失败现场。SIGKILL（runner 的
// 停顿处置）下钩子不会跑 —— 那种情形靠上面那行"就绪"自测行来定位。
process.on('exit', (code) => {
  if (gateCompleted) return;
  process.stderr.write(`[诊断] gate 契约未走完：exit=${code} · 进程自启动 ${sinceBootMs()}ms · 已分段 ${gateStages.join(' ') || '(none)'} · 读重试 ${readRetries} 次\n`);
});

// ── 源码读取：唯一的真实 I/O，按 T203 口径判定"读好了没有"─────────────────────
//
// 并发负载下（另一棵树正在跑 `bundle --write`、杀毒过滤器持有句柄）读一份大文件可能
// **暂时**拿不到：Windows 给的是 EBUSY/EPERM/EACCES 这类**可判定**的环境性错误。
// 只对这一类错误、以及"读到了但长度不足"（先建后写的半截文件）重试 2 次、退避
// 150/300 ms；内容不对（锚点缺失、断言不成立）一律**不**重试 —— 重试只覆盖
// "这次没读成"，绝不覆盖"读到了但不对"。
const READ_ATTEMPTS = 3;
const READ_BACKOFF_MS = 150;
const TRANSIENT_READ_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
let readRetries = 0;

function sleepSync (ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

// `minimumBytes` 是"完整读出来了"的下限：它只挡"建好了还没写"的空文件/半截，深层的
// 截断仍由各节自己的锚点断言去抓（那才是断言该管的事，不该拿来做就绪判定）。
function readWithRetry (relative, minimumBytes) {
  const absolute = path.resolve(appRoot, relative);
  let lastError = null;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      const text = fs.readFileSync(absolute, 'utf8');
      if (text.length >= minimumBytes) return text;
      lastError = new Error(`${relative}: read ${text.length} chars, expected at least ${minimumBytes} (not written completely yet)`);
    } catch (error) {
      if (!TRANSIENT_READ_CODES.has(String(error && error.code))) throw error;
      lastError = error;
    }
    if (attempt < READ_ATTEMPTS) { readRetries += 1; sleepSync(READ_BACKOFF_MS * attempt); }
  }
  throw new Error(`cannot read ${relative} after ${READ_ATTEMPTS} attempts (${readRetries} transient retry/retries so far): ${lastError && lastError.message}`);
}

const read = (relative) => readWithRetry(relative, 1024);

// plugin.json 的就绪判定按 T203 的完整口径：读得出 + **解析得出** + 字段齐（字段齐由
// 第 11 节的断言管）。解析不出来只当"还没写完"，退避后再读；三次都解析不出来就如实报错。
function readJson (relative) {
  const absolute = path.resolve(appRoot, relative);
  let lastError = null;
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (error) {
      const transient = TRANSIENT_READ_CODES.has(String(error && error.code));
      const torn = error instanceof SyntaxError;
      if (!transient && !torn) throw error;
      lastError = error;
    }
    if (attempt < READ_ATTEMPTS) { readRetries += 1; sleepSync(READ_BACKOFF_MS * attempt); }
  }
  throw new Error(`cannot parse ${relative} after ${READ_ATTEMPTS} attempts (${readRetries} transient retry/retries so far): ${lastError && lastError.message}`);
}

const authorization = require(path.resolve(appRoot, 'app/codesys-online-authorization.js'));
const engineModule = require(path.resolve(appRoot, 'plugins/installed/codesys-monitor/scriptengine.cjs'));
const sessionModule = require(path.resolve(appRoot, 'plugins/installed/codesys-monitor/online-session.cjs'));
gateStage('modules');

const mainSource = read('app/main.js');
const preloadSource = read('app/preload.js');
const clientSource = read('plugins/installed/taskhive-surfaces/dsh/client.js');
const engineSource = read('plugins/installed/codesys-monitor/scriptengine.cjs');
const pluginJson = readJson('plugins/installed/codesys-monitor/plugin.json');
gateStage('sources');
process.stdout.write(
  `[自测] gate 契约就绪：进程自启动 ${sinceBootMs()}ms · 模块加载+源码读取 ${Date.now() - gateStartedAt}ms（读重试 ${readRetries} 次）· ` +
  `main.js ${mainSource.length} / client.js ${clientSource.length} / scriptengine ${engineSource.length} 字符\n`,
);

// 本仓惯例：**删除原因写在注释里**（"这一枚开关为什么删掉"必须留在源码里给下一个人看），
// 所以"某个符号已经彻底消失"这类断言只能看**代码**，不能看注释 —— 否则一段解释性的注释
// 会把红线判成回归。这个剥离器认得 `'` / `"` / 模板字符串与转义（与
// client-bundle-integrity-contract.js 里的那一份同一口径）：JS 注释整体丢掉，字符串字面量
// 保留（写在字符串里的旧文案仍然是活的代码，必须被抓住）。
// 之后再剥一层块注释：样式表是**模板字符串**里的 CSS 文本，`codeOnly` 把它当字符串原样保留，
// 所以那里面（真实存在的）CSS 注释要单独去掉 —— 删掉原因同样写在那些注释里。
function codeOnly(source) {
  let out = '';
  let index = 0;
  let quote = '';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next ?? ''; index += 2; continue; }
      if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') { while (index < source.length && source[index] !== '\n') index += 1; continue; }
    if (char === '/' && next === '*') { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue; }
    if (char === "'" || char === '"' || char === '`') quote = char;
    out += char;
    index += 1;
  }
  return out;
}
const clientCode = codeOnly(clientSource).replace(/\/\*[\s\S]*?\*\//g, ' ');

const ONLINE = ['login', 'logout', 'download', 'online-change', 'write-variable', 'start', 'stop', 'reset', 'force'];
const UNSUPPORTED = ['debug', 'breakpoint', 'step'];
const HARD_GATED = ['write-variable', 'reset', 'force'];
const ACTIONS = [
  'online-login', 'online-logout', 'online-download', 'online-change',
  'online-start', 'online-stop', 'online-reset', 'online-write', 'online-force', 'online-unforce',
];

// ── 1. 能力模型 ────────────────────────────────────────────────────────────
assert.deepStrictEqual([...authorization.ONLINE_CAPABILITIES], ONLINE, 'nine capabilities must be grantable');
assert.deepStrictEqual([...authorization.UNSUPPORTED_ONLINE_CAPABILITIES], UNSUPPORTED, 'debug / breakpoint / step have no API in SP20');
assert.deepStrictEqual([...authorization.HARD_GATED_ONLINE_CAPABILITIES], HARD_GATED, 'write-variable / reset / force need a typed phrase');
assert.deepStrictEqual([...engineModule.ONLINE_ACTIONS], ACTIONS, 'the engine must expose exactly ten online actions');
assert.deepStrictEqual([...engineModule.UNSUPPORTED_ONLINE_CAPABILITIES], UNSUPPORTED);
assert.deepStrictEqual(
  [...engineModule.PLC_ONLINE_CAPABILITIES],
  ['login', 'logout', 'download', 'online-change', 'write-variable', 'start', 'stop', 'reset', 'debug', 'breakpoint', 'step', 'force'],
  'the full PLC-online capability list must stay 12 entries for audit',
);
// 两份能力表必须一致，否则"授权了什么"和"执行了什么"会漂移。
assert.deepStrictEqual(
  { ...engineModule.ONLINE_ACTION_CAPABILITY },
  { ...authorization.ONLINE_ACTION_CAPABILITY },
  'the engine and the authorization store must agree on the action -> capability table',
);
for (const action of ACTIONS) {
  const capability = authorization.actionCapability(action);
  assert(ONLINE.includes(capability), `${action} must map to a grantable capability (got "${capability}")`);
}
// 无 API 的三项：不能是动作名、不能是能力、不能有命令映射。
for (const impossible of UNSUPPORTED) {
  assert(!engineModule.ONLINE_ACTIONS.includes(impossible), `${impossible} must not be an action`);
  assert(!ONLINE.includes(impossible), `${impossible} must not be a capability`);
  assert.strictEqual(authorization.actionCapability(impossible), '', `${impossible} must not map to anything`);
}
// 取消强制没有自己的确认词档位，但复用的是 force 能力。
assert.strictEqual(authorization.actionCapability('online-unforce'), 'force');

// ── 2. 授权存储 ────────────────────────────────────────────────────────────
{
  const store = authorization.createOnlineAuthorizationStore({});
  assert.strictEqual(store.authorize({ capability: 'start' }).code, 'CODESYS_ONLINE_NOT_ARMED');

  const armed = store.arm({ projectPath: 'C:/plc/Line.project', windowId: 'win-1', projectSha256: 'aaa' });
  assert.strictEqual(armed.ok, true);
  // T151：**开授权默认只授予最小安全集合**（login/logout/download）。start/stop/reset/
  // write-variable/force 属危险动作，必须显式授予，并且还要过第三节的硬门控。
  // 旧断言"arming grants all nine"正是被收紧掉的行为。
  assert.deepStrictEqual(
    armed.grant.capabilities,
    ['login', 'logout', 'download'],
    'arming grants only the safe default subset',
  );
  assert.strictEqual(store.snapshot().projectName, 'Line.project');
  // 项目比较在 Windows 上大小写不敏感 —— 用**已授予**的能力验证，
  // 若换成 force 会先撞上"未授予"，测的就不是这里了。
  assert.strictEqual(
    store.authorize({ capability: 'login', projectPath: 'c:/PLC/line.PROJECT', windowId: 'win-1' }).ok,
    true,
    'project comparison must be case-insensitive on Windows',
  );
  assert.strictEqual(
    store.authorize({ capability: 'login', projectPath: 'C:/plc/Other.project' }).code,
    'CODESYS_ONLINE_PROJECT_MISMATCH',
  );
  assert.strictEqual(
    store.authorize({ capability: 'login', projectPath: 'C:/plc/Line.project', windowId: 'win-2' }).code,
    'CODESYS_ONLINE_WINDOW_MISMATCH',
  );
  // 危险能力不在默认授权里：即使工程/窗口都对，也必须被拒。
  for (const danger of ['force', 'reset', 'stop', 'start', 'write-variable', 'online-change']) {
    assert.strictEqual(
      store.authorize({ capability: danger, projectPath: 'C:/plc/Line.project', windowId: 'win-1' }).code,
      'CODESYS_ONLINE_CAPABILITY_NOT_GRANTED',
      `${danger} must not be part of the default grant`,
    );
  }
  // 无 API 的三项即使已授权也必须被拒。
  for (const impossible of UNSUPPORTED) {
    const attempt = store.authorize({ capability: impossible, projectPath: 'C:/plc/Line.project', windowId: 'win-1' });
    assert.strictEqual(attempt.ok, false, `${impossible} must be refused while armed`);
    assert.strictEqual(attempt.code, 'CODESYS_ONLINE_CAPABILITY_DENIED');
  }
  const badArm = store.arm({ projectPath: 'C:/plc/Line.project', capabilities: ['login', 'breakpoint'] });
  assert.strictEqual(badArm.ok, false, 'arming an impossible capability must fail');
  assert.strictEqual(badArm.code, 'CODESYS_ONLINE_CAPABILITY_NOT_GRANTABLE');
  assert.strictEqual(store.arm({ projectPath: '' }).ok, false, 'arming without a project must fail');
  assert.strictEqual(store.disarm('test').disarmed, true);
  assert.strictEqual(store.snapshot(), null);
}
// 收窄的授权必须保持收窄。
{
  const store = authorization.createOnlineAuthorizationStore({});
  store.arm({ projectPath: 'C:/plc/A.project', capabilities: ['login'] });
  assert.strictEqual(store.authorize({ capability: 'login' }).ok, true);
  assert.strictEqual(store.authorize({ capability: 'force' }).code, 'CODESYS_ONLINE_CAPABILITY_NOT_GRANTED');
}
// 审计是追加式 JSONL。
{
  const os = require('os');
  // 审计文件是这一条契约唯一写进**共享全局资源**（`os.tmpdir()`）的东西，文件名必须
  // 每次运行都唯一：runner 的预算是硬杀（SIGKILL），被杀的那一次**不会**执行到下面的
  // 清理，于是 pid 命名的文件会留在 %TEMP%；Windows 的 pid 回收很快，后续任何一次
  // 同名运行都会追加到那份残留上，`deepStrictEqual(event 序列)` 就会因为一个纯粹的
  // 环境原因变红。加一枚随机令牌，让"上次残留"与"这次"不可能撞名（T229）。
  const auditPath = path.join(os.tmpdir(), `taskhive-online-audit-${process.pid}-${crypto.randomBytes(6).toString('hex')}.jsonl`);
  try { fs.unlinkSync(auditPath); } catch { /* fresh: the token makes this path ours alone */ }
  try {
    const store = authorization.createOnlineAuthorizationStore({ auditPath });
    store.arm({ projectPath: 'C:/plc/A.project', windowId: 'w' });
    store.confirmHardGate({ capability: 'force', phrase: 'x' });
    store.confirmHardGate({ capability: 'force', phrase: '强制变量' });
    store.disarm('done');
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepStrictEqual(lines.map((item) => item.event), ['online-arm', 'online-hard-gate-confirmed', 'online-disarm']);
    assert(lines.every((item) => typeof item.at === 'string'), 'every audit entry must carry a timestamp');
  } finally {
    // `finally`：断言失败时也把文件收掉（失败保留的是**契约自己的**临时目录，
    // 不该是在共享 %TEMP% 里留一块无主的垃圾）。
    try { fs.unlinkSync(auditPath); } catch { /* best effort */ }
  }
}

// ── 3. 硬门控（危险动作的第二道锁）────────────────────────────────────────
{
  const store = authorization.createOnlineAuthorizationStore({});
  store.arm({ projectPath: 'C:/plc/A.project' });
  for (const capability of HARD_GATED) {
    const missing = store.confirmHardGate({ capability });
    assert.strictEqual(missing.ok, false, `${capability} must require a phrase`);
    assert.strictEqual(missing.code, 'CODESYS_ONLINE_HARD_GATE_PHRASE_MISMATCH');
    assert.strictEqual(missing.expected, authorization.HARD_GATE_PHRASE[capability]);
    assert.strictEqual(store.confirmHardGate({ capability, phrase: '试试' }).ok, false, 'a wrong phrase must be refused');
    assert.strictEqual(store.confirmHardGate({ capability, phrase: authorization.HARD_GATE_PHRASE[capability] }).ok, true);
  }
  for (const capability of ['login', 'logout', 'download', 'online-change', 'start', 'stop']) {
    const gate = store.confirmHardGate({ capability });
    assert.strictEqual(gate.ok, true, `${capability} must not need a phrase`);
    assert.strictEqual(gate.required, false);
  }
  assert.strictEqual(store.confirmHardGate({ capability: 'breakpoint' }).ok, false, 'an impossible capability cannot pass the gate');
  // 决定"哪些动作要确认词"的名单必须精确：取消强制故意不在里面。
  assert(
    mainSource.includes('// 危险动作的第二道锁') && mainSource.includes('// 危险动作的第二道锁：逐字输入确认词'),
    'the IPC must document why the hard gate exists',
  );
  assert(
    mainSource.includes("if (['online-write', 'online-force', 'online-reset'].includes(action)) {") &&
      !mainSource.includes("['online-write', 'online-force', 'online-reset', 'online-unforce']"),
    'exactly write / force / reset are hard gated — unforcing is the safe direction',
  );
}

gateStage('s1-3-capabilities');
// ── 4. 预检 ────────────────────────────────────────────────────────────────
{
  const base = {
    authorized: true, connected: true,
    grantedProjectPath: 'C:/plc/A.project', projectPath: 'C:/plc/A.project',
    windowTitle: 'A.project - CODESYS',
  };
  assert.strictEqual(authorization.evaluateDownloadPreflight(base).ok, true);
  assert.strictEqual(authorization.evaluateDownloadPreflight({ ...base, connected: false }).ok, false);
  assert.strictEqual(authorization.evaluateDownloadPreflight({ ...base, authorized: false }).errors[0].code, 'CODESYS_ONLINE_NOT_AUTHORIZED');
  assert.strictEqual(authorization.evaluateDownloadPreflight({ ...base, projectPath: 'C:/plc/B.project' }).errors[0].code, 'CODESYS_ONLINE_PROJECT_MISMATCH');
  assert.strictEqual(authorization.evaluateDownloadPreflight({ ...base, windowTitle: 'A.project* - CODESYS' }).errors[0].code, 'CODESYS_ONLINE_UNSAVED_CHANGES');
  assert.strictEqual(authorization.evaluateDownloadPreflight({ ...base, buildErrorCount: 3 }).warnings[0].code, 'CODESYS_ONLINE_BUILD_ERRORS');

  // 应用层动作必须先「下载」把应用登录起来。
  const app = authorization.evaluateAppActionPreflight({ authorized: true, connected: true, loggedIn: false });
  assert.strictEqual(app.ok, false);
  assert.strictEqual(app.errors[0].code, 'CODESYS_ONLINE_NOT_LOGGED_IN');
  assert(/先点「下载」/.test(app.errors[0].message), 'the refusal must say how to become logged in');
  assert.strictEqual(authorization.evaluateAppActionPreflight({ authorized: true, connected: true, loggedIn: true }).ok, true);
  assert.strictEqual(
    authorization.evaluateAppActionPreflight({ authorized: true, connected: false, loggedIn: true }).errors[0].code,
    'CODESYS_ONLINE_DEVICE_NOT_CONNECTED',
  );
  // 「登录」= connect + login(Keep)：只登录、不传输。它够读在线变量，但**不够**启停
  // 机械 —— 那时设备里跑的是哪一版程序还没确认过。所以应用层动作只认 transfer 登录。
  const monitorOnly = authorization.evaluateAppActionPreflight({ authorized: true, connected: true, loggedIn: true, loginMode: 'keep' });
  assert.strictEqual(monitorOnly.ok, false, 'a Keep-login session must not reach app-layer actions');
  assert.strictEqual(monitorOnly.errors[0].code, 'CODESYS_ONLINE_MONITOR_ONLY_LOGIN');
  assert(/先点「下载」/.test(monitorOnly.errors[0].message), 'the refusal must name the action that fixes it');
  assert.strictEqual(
    authorization.evaluateAppActionPreflight({ authorized: true, connected: true, loggedIn: true, loginMode: 'transfer' }).ok,
    true,
    'a download / online-change login must allow app-layer actions',
  );
}

// ── 5. worker Python ───────────────────────────────────────────────────────
{
  const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { maxIdleSeconds: 60, resultPrefix: 'r-' });
  for (const fn of ['do_login', 'do_logout', 'do_download', 'do_monitor', 'do_set_target', 'do_scan',
    'do_online_change', 'do_start', 'do_stop', 'do_reset', 'do_write', 'do_force', 'do_unforce', 'require_logged_in']) {
    assert(script.includes(`def ${fn}`), `the worker must implement ${fn}`);
  }
  for (const command of ['online-change', 'start', 'stop', 'reset', 'write-variable', 'force', 'unforce']) {
    assert(sessionModule.ONLINE_COMMANDS.includes(command), `${command} must be an allowed worker command`);
  }
  // 下载 = Never（不尝试在线修改）；在线修改 = Try。
  assert(script.includes('application.login(OnlineChangeOption.Never, False)'), 'download must use Never');
  assert(script.includes('application.login(OnlineChangeOption.Try, False)'), 'online-change must use Try');
  assert(!script.includes('OnlineChangeOption.Force'), 'OnlineChangeOption.Force must never be used');
  // 「登录」必须真的登录到应用，而且只能用 Keep：官方文档 "Try to login. Do not
  // online update. Do not download. Keep as it is." —— 既不下载也不在线修改。
  // 用 Never 会让点一次「登录」就强制完整下载（Never 的定义就是 full download
  // is forced），那是把机械停掉的破坏性动作；用 Try 会在线改代码。两者都不允许。
  {
    const loginBody = script.slice(script.indexOf('def do_login'), script.indexOf('def do_logout'));
    assert(loginBody.includes('.login(OnlineChangeOption.Keep, False)'),
      'login must log into the application with Keep (login only, no transfer)');
    assert(!loginBody.includes('OnlineChangeOption.Never') && !loginBody.includes('OnlineChangeOption.Try'),
      'login must never download or online-change');
    assert(loginBody.includes("state['loginMode'] = 'keep'"), 'login must record how the session got logged in');
    // is_logged_in 是在线变量能读值的前提：登录必须让它变真，否则界面登录了却读不到值。
    assert(loginBody.includes('online_application().login('), 'login must go through the online application');
  }
  // 登录模式必须能被界面看见（否则界面无法区分"只登录"和"下载过的登录"）。
  {
    const connectionBody = script.slice(script.indexOf('def connection_state'), script.indexOf('def do_login'));
    assert(connectionBody.includes("value['loginMode'] = state.get('loginMode', '')"), 'status must report the login mode');
  }
  // 危险的应用层动作只认传输型登录：Keep 登录能读值，但不能启停机械。
  {
    const requireBody = script.slice(script.indexOf('def require_logged_in'), script.indexOf('def do_online_change'));
    assert(requireBody.includes("state.get('loginMode') != 'transfer'"),
      'app-layer actions must refuse a login that never transferred anything');
    assert(requireBody.includes('application.is_logged_in'), 'app-layer actions must still require an application login');
  }
  // 下载 / 在线修改必须把自己标成 transfer，否则刚下载完反而不能启停。
  {
    const downloadBody = script.slice(script.indexOf('def do_download'), script.indexOf('def do_set_target'));
    const changeBody = script.slice(script.indexOf('def do_online_change'), script.indexOf('def do_start'));
    assert(downloadBody.includes("state['loginMode'] = 'transfer'"), 'download must mark the session as transfer');
    assert(changeBody.includes("state['loginMode'] = 'transfer'"), 'online-change must mark the session as transfer');
    const logoutBody = script.slice(script.indexOf('def do_logout'), script.indexOf('def do_download'));
    assert(logoutBody.includes("state['loginMode'] = ''"), 'logout must clear the login mode');
  }
  // 在线变量的逐条回退必须有上限与时间预算：串行命令队列被一次 monitor 占满，
  // 界面上就是"登录之后卡顿"。
  {
    const monitorBody = script.slice(script.indexOf('def do_monitor'), script.indexOf('def do_status'));
    assert(script.includes('MONITOR_PER_EXPRESSION_MAX = 24') && script.includes('MONITOR_PER_EXPRESSION_BUDGET_SECONDS = 4.0'),
      'the per-expression fallback needs a hard cap and a time budget');
    assert(monitorBody.includes('MONITOR_PER_EXPRESSION_MAX') && monitorBody.includes('MONITOR_PER_EXPRESSION_BUDGET_SECONDS'),
      'monitor must apply that cap and budget');
    assert(!monitorBody.includes('while True'), 'monitor must never loop unboundedly');
  }
  // 变量名解析：实测（GCAN-PLC-521C，2026-09-21）Program 的局部量只有写成
  // "实例名.变量" 才读得到（permit 报"无效的表达式"、Jog.permit = FALSE），而 GVL 的
  // 全局量裸名与限定名都能读。所以必须先试限定名、失败退回裸名，并把成功的写法记住。
  {
    const monitorBody = script.slice(script.indexOf('def do_monitor'), script.indexOf('def do_status'));
    assert(script.includes('def preferred_expression') && script.includes('def expression_candidates'),
      'the worker must resolve both "bare" and "instance-qualified" spellings');
    assert(monitorBody.includes('expression_candidates(expression, scope)'),
      'monitor must fall back to the other spelling before giving up on a name');
    assert(monitorBody.includes('remember_expression(item, preferred[index])'),
      'a successful batch read must be remembered for the next poll');
    assert(script.includes("scope + '.' + expression"), 'qualification must be instance-name based');
    // 写入与强制走同一条解析路径，否则会"看着成功、其实什么都没写"。
    const writeBody = script.slice(script.indexOf('def do_write'), script.indexOf('def do_force'));
    const forceBody2 = script.slice(script.indexOf('def do_force'), script.indexOf('def do_unforce'));
    assert(writeBody.includes('prepare_assignments(application, args)') && forceBody2.includes('prepare_assignments(application, args)'),
      'write and force must resolve the expression before preparing a value');
    assert(script.includes('def prepare_assignments'), 'the resolution helper must exist');
    assert(script.includes("raise Exception('无法定位变量 '"), 'an unresolvable name must be reported, not silently skipped');
  }
  // 写入与强制是两条不同的路径。
  const writeBody = script.slice(script.indexOf('def do_write'), script.indexOf('def do_force'));
  assert(writeBody.includes('write_prepared_values()'), 'write must apply without forcing');
  assert(!writeBody.includes('force_prepared_values'), 'write must not force');
  const forceBody = script.slice(script.indexOf('def do_force'), script.indexOf('def do_unforce'));
  assert(forceBody.includes('force_prepared_values()'), 'force must call force_prepared_values');
  const unforceBody = script.slice(script.indexOf('def do_unforce'), script.indexOf('def do_monitor'));
  assert(unforceBody.includes('unforce_all_values()'), 'unforce must clear the forces');
  // 复位：三种选项 + force_kill。
  assert(script.includes("'warm': ResetOption.Warm") && script.includes("'cold': ResetOption.Cold") && script.includes("'original': ResetOption.Original"));
  assert(script.includes('application.reset(options[option], force_kill)'), 'reset must pass both arguments');
  // 应用层动作统一走 require_logged_in。
  for (const fn of ['do_start', 'do_stop', 'do_reset', 'do_write', 'do_force', 'do_unforce']) {
    const body = script.slice(script.indexOf(`def ${fn}`));
    assert(body.slice(0, 400).includes('require_logged_in()'), `${fn} must require an application login`);
  }
  // 目标读取与扫描保持不变。
  assert(script.includes('def read_target') && script.includes('get_device_identification'));
  assert(script.includes('perform_network_scan') && script.includes('get_cached_network_scan_result'));
  // 工程副本永不保存。
  assert(!script.includes('project.save()'), 'the online worker must never save the project copy');
}

// ── 6. 引擎与策略 ──────────────────────────────────────────────────────────
{
  const policy = new engineModule.CodesysScriptEngine(path.resolve(appRoot, '..')).policy();
  assert.deepStrictEqual(policy.onlineActions, ACTIONS);
  assert.deepStrictEqual(policy.unsupportedOnlineCapabilities, UNSUPPORTED);
  assert.deepStrictEqual(policy.onlineHardGateRequired, HARD_GATED);
  assert.strictEqual(policy.onlineAuthorizationRequired, true);
  assert.strictEqual(policy.plcOnlineChange, 'authorized-only');
  assert.strictEqual(policy.variableWrite, 'authorized-with-confirmation-phrase');
  assert.strictEqual(policy.force, 'authorized-with-confirmation-phrase');
  assert.strictEqual(policy.debugBreakpointStep, 'unsupported-by-this-scriptengine-version');
  assert.strictEqual(policy.arbitraryScript, false, 'arbitrary Python must stay impossible');
  // 动作 → worker 命令的映射必须覆盖全部动作，且不能凭空多出命令。
  const commandMap = engineModule.ONLINE_ACTION_COMMAND;
  assert.deepStrictEqual(Object.keys(commandMap).sort(), [...ACTIONS].sort(), 'every action needs a worker command');
  for (const command of Object.values(commandMap)) {
    assert(sessionModule.ONLINE_COMMANDS.includes(command), `${command} must be a real worker command`);
  }
}
{
  const engine = new engineModule.CodesysScriptEngine(path.resolve(appRoot, '..'));
  engine.execute('online-force', { jobId: 'direct-1' })
    .then(() => { throw new Error('an unauthorized online action must not resolve'); })
    .catch((error) => { assert.strictEqual(error.code, 'CODESYS_ONLINE_NOT_ARMED'); });
}

gateStage('s4-6-precheck-engine');
// ── 7. 主进程接线 ──────────────────────────────────────────────────────────
for (const channel of ['codesys:online-status', 'codesys:online-arm', 'codesys:online-disarm', 'codesys:online-scan', 'codesys:online-set-target', 'codesys:online-monitor', 'codesys:online-action']) {
  assert(isRegistered(mainSource, channel), `${channel} must be registered`);
}
for (const bridge of ['codesysOnlineStatus', 'prepareCodesysOnline', 'setCodesysOnlineTarget', 'scanCodesysOnlineDevices', 'armCodesysOnline', 'disarmCodesysOnline', 'runCodesysOnlineAction', 'monitorCodesysOnline']) {
  assert(preloadSource.includes(`${bridge}:`), `preload must expose ${bridge}`);
}
assert(
  mainSource.includes("if (!isTrustedSender(event)) throw new Error('CODESYS 在线动作只能由 TaskHive 界面发起')"),
  'the online action IPC must verify the sender',
);
assert(
  mainSource.includes('const capability = actionCapability(action);') &&
    mainSource.includes("if (!capability) throw Object.assign(new Error(`不支持的在线动作：${action || '(empty)'}`)"),
  'the IPC must resolve the capability from the action name table, never from caller input',
);
assert(
  mainSource.includes("const APP_LAYER_CAPABILITIES = ['start', 'stop', 'reset', 'write-variable', 'force'];") &&
    mainSource.includes('evaluateAppActionPreflight({'),
  'app-layer actions must be pre-flighted',
);
assert(
  mainSource.includes("event: `online-${capability}`") &&
    mainSource.includes("event: `online-${capability}-failed`") &&
    mainSource.includes("event: 'online-app-action-refused'") &&
    mainSource.includes("event: 'online-hard-gate-refused'") &&
    mainSource.includes("event: 'online-download-refused'"),
  'every online action, refusal and failure must be audited',
);
assert(
  !/ipcMain\.handle\('codesys:online-(?:debug|breakpoint|step)'/.test(mainSource),
  'the three API-less capabilities must have no IPC entry point at all',
);
// 引擎自己也要拦"工程在读取后又被改过"的下载。
assert(
  engineSource.includes("if (job.currentSha256 && currentSha !== job.currentSha256)") &&
    engineSource.includes("code: 'CODESYS_ONLINE_PROJECT_CHANGED'"),
  'the engine must refuse a download when the project file changed after the last read',
);

// ── 8. 目标确认与扫描 ──────────────────────────────────────────────────────
{
  const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { maxIdleSeconds: 60, resultPrefix: 'r-' });
  assert(script.includes('def read_target') && script.includes('def device_object_of'));
  for (const reader of ['get_device_object', 'get_address', 'get_gateway', 'get_device_identification']) {
    assert(script.includes(reader), `the target reader must use ${reader}`);
  }
  assert(script.includes('def read_communication_settings') && script.includes("('ipAddressAndPort', 'scanned_ip_address_and_port')"));
  assert(script.indexOf('target = read_target(device)') < script.indexOf('def do_login'), 'the target must be read before any login path');
  assert(!script.includes('set_gateway_and_address') || script.indexOf('set_gateway_and_address') > script.indexOf('def do_set_target'),
    'set_gateway_and_address must live only inside set-target');
  assert(script.includes("'saved': False"), 'set-target must report that nothing was persisted');
  assert(script.includes('get_simulation_mode'), 'the worker must report simulation mode');

  assert(
    mainSource.includes("`设备 IP / 端口：${onlineIpLabel}`") ||
      clientSource.includes('`设备 IP / 端口：${onlineIpLabel}`'),
    'the workbench must separate the device IP from the gateway node address',
  );
  assert(clientSource.includes('未配置 IP（经网关节点地址 ${onlineAddress}）'), 'a gateway-routed device must say so instead of showing a fake IP');
  assert(clientSource.includes('const onlineScannedName = String(onlineCommSettings?.scannedDeviceName || \'\')'), 'the picker must prefer the scanned device name');

  const scanStart = registrationIndex(mainSource, 'codesys:online-scan');
  const scanEnd = registrationIndex(mainSource, 'codesys:online-prepare', scanStart);
  const scanSlice = mainSource.slice(scanStart, scanEnd);
  assert(scanSlice.includes("reason: 'job-missing'"), 'the scan handler must require a job id');
  assert(scanSlice.indexOf('prepareOnlineSession(jobId, 180000)') < scanSlice.indexOf('onlineScanDevices('),
    'the scan must ensure the online worker exists before asking the gateway');
  assert(mainSource.includes("event: 'online-scan'"), 'scans must be audited');
  assert(clientSource.includes('window.taskhive?.scanCodesysOnlineDevices?.({ useCache: useCache === true, jobId })'),
    'the workbench must pass the job id to the scanner');
  // T101：扫描从居中弹窗改为**底部面板**（用户口径："改成和编译一样的底部弹出"），
  // 并且要显示扫描耗时与 CODESYS 进程启动耗时。
  assert(clientSource.includes("'data-codesys-scan-panel': 'true'") &&
    clientSource.includes("'data-codesys-scan-list': 'true'") &&
    clientSource.includes("'data-codesys-scan-status': 'true'") &&
    clientSource.includes("'data-codesys-scan-device': 'true'") &&
    clientSource.includes("'data-codesys-scan-address': String(device.address || '')"),
    'scanning must render as a workbench panel with selectable device rows');
  assert(!clientSource.includes('data-codesys-scan-dialog'),
    'the centred scan modal must stay removed (the operator asked for a bottom panel like 编译输出)');
  assert(clientSource.includes("className: `taskhive-codesys-compile taskhive-codesys-scan${scanBusy ? ' is-busy' : ''}`"),
    'the scan panel must reuse the compile panel shell (same bottom-docked look)');
  assert(clientSource.includes('正在扫描网络…') && clientSource.includes('正在准备在线会话并读取网关上次记录的设备…'));
  assert(clientSource.includes('await runScan(true)') && clientSource.includes('await runScan(false)'),
    'the panel must show the last recorded devices first, then the live result');
  // 计时：扫描已用秒数 + 进程/缓存/实时/合计四段分解。
  assert(clientSource.includes("'data-codesys-scan-timing': 'true'"), 'the panel must show a timing figure');
  assert(clientSource.includes('const [scanSeconds, setScanSeconds] = React.useState(0)') &&
    clientSource.includes('setInterval(() => setScanSeconds('),
    'the panel must tick the elapsed seconds while scanning');
  assert(clientSource.includes('function codesysFormatMs(ms)'), 'durations need one shared formatter');
  assert(clientSource.includes('`进程 ${codesysFormatMs(scanReport.prepareMs)}`') &&
    clientSource.includes("'进程 复用（未重启）'"),
    'the panel must report how long the CODESYS worker start took (or that it was reused)');
  assert(clientSource.includes('`缓存 ${codesysFormatMs(scanReport.cacheMs)}`') &&
    clientSource.includes('`实时 ${codesysFormatMs(scanReport.liveMs)}`') &&
    clientSource.includes('`合计 ${codesysFormatMs(scanReport.totalMs)}`'),
    'the panel must break the scan down into the cached round, the live round and the total');
  // 宿主必须真的把两段耗时算出来。
  assert(mainSource.includes('const startedAt = Date.now();') &&
    mainSource.includes('prepareMs') && mainSource.includes('scanMs') && mainSource.includes('sessionReused'),
    'the host must measure the worker start and the scan separately');
  assert(mainSource.includes('prepareMs: result?.timings?.prepareMs || 0'),
    'the scan audit must record the measured durations');
}

// ── 9. 界面：1/2/3 常驻 + 在线控制带 + 硬门控弹窗 ─────────────────────────
{
  for (const marker of ["'data-codesys-online-login': 'true'", "'data-codesys-online-logout': 'true'", "'data-codesys-online-download': 'true'"]) {
    assert(clientSource.includes(marker), `${marker} must exist`);
  }
  // 1/2/3 不得因状态而不渲染：三个按钮都必须是无条件调用。
  assert(!clientSource.includes("onlineConnected ? null : h('button', {\n              className: 'taskhive-codesys-action taskhive-codesys-action-icononly', type: 'button',\n              title: onlineConnected"),
    'login must always render');
  assert(clientSource.includes("disabled: onlineBusy || busy || !onlineReady || onlineConnected"), 'login disables itself instead of disappearing');
  assert(clientSource.includes("disabled: onlineBusy || !onlineConnected"), 'logout disables itself instead of disappearing');
  assert(clientSource.includes("disabled: onlineBusy || busy || !onlineConnected"), 'download disables itself instead of disappearing');
  // 其余 6 项在线动作 + 取消强制。
  for (const marker of ['data-codesys-online-change', 'data-codesys-online-start', 'data-codesys-online-stop',
    'data-codesys-online-reset', 'data-codesys-online-write', 'data-codesys-online-force', 'data-codesys-online-unforce']) {
    assert(clientSource.includes(`'${marker}': 'true'`), `the workbench must expose ${marker}`);
  }
  // 三个无 API 的能力不得有任何控件。
  for (const marker of ['data-codesys-online-debug', 'data-codesys-online-breakpoint', 'data-codesys-online-step']) {
    assert(!clientSource.includes(marker), `${marker} must not exist`);
  }
  // 危险动作走弹窗 + 确认词。
  assert(clientSource.includes('function showCodesysOnlineDangerDialog(options = {})') &&
    clientSource.includes("root.setAttribute('data-codesys-danger-dialog', 'true')") &&
    clientSource.includes("phraseInput.setAttribute('data-codesys-danger-phrase', 'true')") &&
    clientSource.includes("confirm.setAttribute('data-codesys-danger-confirm', 'true')"),
    'dangerous actions must go through a confirmation-phrase dialog');
  assert(clientSource.includes("const CODESYS_HARD_GATE_PHRASE = { 'write-variable': '写入变量', reset: '复位设备', force: '强制变量' }") &&
    JSON.stringify(authorization.HARD_GATE_PHRASE) === JSON.stringify({ 'write-variable': '写入变量', reset: '复位设备', force: '强制变量' }),
    'the workbench and the host must use the exact same confirmation phrases');
  assert(clientSource.includes('phrase: options.phrase || undefined,'),
    'the typed phrase must be forwarded to the host');
  assert(clientSource.includes("capabilities: ['login', 'logout', 'download', 'online-change', 'write-variable', 'start', 'stop', 'reset', 'force'],"),
    'arming must request all nine capabilities');
}

gateStage('s7-9-ipc-ui');
// ── 9b. 在线变量：登录就能读到值，而且轮询不能把界面拖卡 ────────────────────
// 现场症状："现在登录上了，但是不显示在线变量状态" + "有延迟卡顿"。根因是「登录」
// 只连设备、不登录应用（is_logged_in 一直 false，取值那段代码从没跑过）。这一段把
// 两件事都钉住：登录必须真的登录（Keep），轮询必须便宜。
{
  // 界面把登录模式交给宿主判定（应用层动作要用它）。
  assert(clientSource.includes("loginMode: current?.state?.loginMode || '',"),
    'the workbench must forward the login mode with every online action');
  // 危险动作在界面侧就先挡住 Keep 会话，而不是等宿主拒绝。
  assert(clientSource.includes("if (onlineState?.state?.loginMode !== 'transfer') {"),
    'the workbench must refuse app-layer actions on a monitor-only login');
  assert(clientSource.includes('当前是「只登录、不传输」的在线监视会话'),
    'the refusal must explain the difference between the two logins');
  // 登录成功后必须说清"在线变量已开启"，否则用户以为登录没生效。
  assert(clientSource.includes('在线变量已开启'), 'a successful login must say that online values are live now');
  // 轮询的三条纪律：单飞、值没变不重绘、慢读退避。
  assert(clientSource.includes('if (cancelled || inFlight || onlineBusyRef.current) return'),
    'only one monitor request may be in flight at a time');
  assert(clientSource.includes('if (next !== signature) {'),
    'unchanged values must not trigger a re-render (that was the visible stutter)');
  assert(clientSource.includes('delay = elapsed > 1200 ? Math.min(6000, Math.max(1500, elapsed * 2)) : 1500'),
    'a slow read must back the poll off instead of piling requests up');
  assert(clientSource.includes("document.visibilityState === 'hidden'"),
    'a hidden page must not poll the controller');
  assert(!clientSource.includes('const timer = setInterval(tick, 1500)'),
    'the fixed 1500ms interval must stay gone (it is what queued requests up)');
  // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）—— T215/T216/T218 在这里
  // 钉的那几条"开关"判据按**意图**整体改写（只加强，不删弱）。判据逐条对应：
  //   · 原来要求"一个默认关、带 localStorage 记忆、未登录 disabled、有 is-live 绿灯与两段
  //     title 说明的开关"；现在要求它**一点痕迹都不留** —— 按钮/marker 属性/React 状态/
  //     记忆键/读写函数/绿灯/disabled/title 文案/样式规则全部不许存在（"不存在开关"比
  //     "开关是关的"更强：没有任何东西需要用户点）；
  //   · 原来要求"关着的时候不读"；现在要求"**未登录**时一句都不读、一个值都不画"，
  //     而已登录**不用点任何东西**就一直读、一直画 —— 登录状态是唯一的判据。
  // 就地只有值本身这一点没变：原来那颗「在线值 / 在线中…」文字徽章仍然必须不在。
  assert(!clientCode.includes('data-codesys-online-values-toggle'),
    'the 「在线值」 switch must be GONE from the code (its marker attribute with it)');
  assert(!clientCode.includes('inlineOnlineValues'),
    'and its remembered React state must be gone too: nothing may gate the values on a flag');
  assert(!clientCode.includes('taskhive.codesys.onlineValues.inline'),
    'the switch\'s localStorage key must not be read (nor written) by any code any more');
  assert(!clientCode.includes('readStoredFlag') && !clientCode.includes('storeFlag'),
    'the flag read/write helpers existed only for that switch, so they must be gone with it');
  assert(!clientCode.includes('valueByLineAny') && !clientCode.includes('data-editor-online'),
    'the switch\'s live light and its data-editor-online attribute must be gone (no control, no state)');
  assert(!clientCode.includes('在线值 开') && !clientCode.includes('在线值 关'),
    'neither of the switch\'s two labels may survive anywhere in the code');
  assert(!clientCode.includes('taskhive-codesys-editor-online'),
    'and the switch\'s stylesheet rules must have been deleted with the control');
  assert(!clientCode.includes('在线中…'),
    'the extra "在线值 / 在线中…" badge must stay gone (in place the operator sees the value itself)');
  // 新判据（**值跟随登录状态**）：读值只有一个总闸 —— 已经登录到应用；未登录连读都不读。
  assert(clientSource.includes('if (!jobId || !onlineLoggedIn || !workbenchVisible) { setOnlineValues(null); return undefined }'),
    'the ONLY gate on reading values must be the login state (+ a bound job + a visible workbench):'
    + ' not logged in ⇒ not a single read');
  assert(clientSource.includes('const inlineByLine = onlineLoggedIn\n'),
    'the in-place mirror must be driven by the login state alone (logged in ⇒ always painted,'
    + ' no click required)');
  assert(clientSource.includes('const showInline = Boolean(inlineByLine)\n'),
    'and every section must keep painting unconditionally once that is true');
  assert(clientSource.includes('if (!onlineLoggedIn) return null'),
    'and both full-line segment maps must be empty while not logged in (nothing painted, nothing left over)');
  // 本轮 A 项：未知（面板还没观测到这个变量）只给一个克制的占位符，绝不编造；有值时
  // 就地只画值本身（IEC 类型前缀只是显示上去掉，原始回报留在属性里）。
  // 本轮（样式 A）用户拍板「读不到值时显示淡色 —」，占位符从中点改成破折号。
  assert(clientSource.includes("const CODESYS_ONLINE_VALUE_UNKNOWN = '—'"),
    'an unreadable variable must get one restrained dash, not an invented value');
  assert(!clientSource.includes("const CODESYS_ONLINE_VALUE_UNKNOWN = '·'"),
    'the previous middle-dot placeholder must stay retired');
  assert(clientSource.includes("'data-online-value-raw': segment.value.raw,"),
    'the raw observed string must stay on the element (the display-only prefix strip loses nothing)');
  assert(clientSource.includes("'data-online-value-unknown': 'true',"),
    'the placeholder must be identifiable from the DOM');
  assert(!/data-online-value-unknown[\s\S]{0,200}?title:/.test(clientSource),
    'the placeholder must NOT grow a tooltip (the code area stays quiet about a non-observation)');
  // 读在线值是「登录」能力的直接结果；下载只是退路（老会话只授权过下载）。
  assert(mainSource.includes("authorize({ capability: 'login', projectPath: monitorProjectPath })"),
    'monitoring must be authorized by the login capability');
  assert(mainSource.includes("authorize({ capability: 'download', projectPath: monitorProjectPath })"),
    'a download-only grant must keep working as a fallback');
  // 宿主也必须自己判一次登录模式，不能只信界面传来的 loggedIn。
  assert(mainSource.includes("loginMode: String(args.loginMode || ''),"),
    'the host must check the login mode itself');
  // 变量名解析必须一路传到 worker：界面带上所选对象的名字，宿主原样转交。
  assert(clientSource.includes("scope: selected?.name || '',"),
    'the workbench must send the selected object as the expression scope');
  assert(mainSource.includes("codesysScriptEngine.onlineMonitor(expressions, String(args.scope || ''))"),
    'the host must forward the scope to the engine');
  assert(engineSource.includes("async onlineMonitor(expressions, scope = '')") &&
    engineSource.includes("this.onlineSession.send('monitor', { expressions: list, scope: String(scope || '') }"),
    'the engine must put the scope into the monitor command');
}

// ── 9c. 现场三个问题的契约：停顿、目标可见、别偷偷重启 ──────────────────────
// 用户口径：「为什么在线功能不稳定，我点击其他界面会停顿刷新」「为什么不先通过扫描
// 设备绑定设备再登录」「下载登录我怎么知道我登录哪个设备」。
// 实测：宿主每次「当前工程」探测 = PowerShell 窗口枚举 + CODESYS 选项扫描 ≈ 2 秒，
// 而工作台在切回窗口/标签页时都会重新探测一次 —— 那就是"点别的界面就停顿刷新"。
{
  // 探测必须稀：后台兜底 5 分钟、交互重检测 45 秒节流、宿主缓存 45 秒。
  assert(clientSource.includes('const CODESYS_DETECT_MIN_GAP_MS = 45000'),
    'a focus recheck must not re-probe more often than every 45s');
  assert(clientSource.includes('const CODESYS_FALLBACK_DETECT_MS = 300000'),
    'the background fallback probe must be rare (the probe costs ~2s of main-process time)');
  assert(mainSource.includes('const CODESYS_CURRENT_PROJECT_TTL_MS = 45000'),
    'the host must memoize the expensive probe for 45s');
  assert(clientSource.includes('onClick: () => detectCurrentProject({ force: true })'),
    'an explicit 刷新当前工程 must still probe fresh');
  // 常驻在线进程不得被自动拉起：每个作业只准备一次，之后再启动要用户明确点。
  assert(clientSource.includes('const codesysPreparedJobs = new Set()'),
    'the workbench must remember which projects it already prepared');
  assert(clientSource.includes('if (codesysPreparedJobs.has(jobId)) {'),
    'coming back to the workbench must not silently start a 700 MB CODESYS again');
  assert(clientSource.includes('在线进程当前没有运行（空闲 10 分钟会自动释放，这是刻意的）'),
    'an idle-released session must be explained, not silently restarted');
  // 目标信息：**不做常驻 chip**（T111 用户口径："应该只是一行提示字…不应该常驻"）。
  // 绑定/更换时由状态行播报一次；只有**已连接**时才保留一个可点的目标入口。
  assert(clientSource.includes("'data-codesys-online-target-summary': onlineTargetSource || 'project'"),
    'the connected-state target entry must still expose which target it is');
  assert(clientSource.includes('在线目标：${onlineTargetSummary} · ${onlineTargetSourceLabel}（登录/下载都会作用到它'),
    'binding or changing the target must be announced as one status line');
  assert(clientSource.includes("targetAnnouncedRef.current === key"),
    'the announcement must fire once per target, not on every render');
  assert(!clientSource.includes("'目标 未选择 · 点这里选择'"),
    'the permanent "not chosen" chip must stay removed');
  assert(clientSource.includes("'已绑定（本次扫描选择）'") && clientSource.includes("'工程配置'"),
    'the workbench must still say whether the target is the project default or the bound device');
  assert(clientSource.includes("setOnlineTargetSource('scan')"),
    'picking a device from the scan panel must be recorded as the target source');
  // T103：绑定状态写在「扫描设备」按钮上，登录不再弹一次性的"连哪台设备"确认框。
  assert(clientSource.includes("const onlineBound = onlineTargetSource === 'scan' || onlineTargetSource === 'manual'"),
    'the workbench must derive a single "bound" state');
  assert(clientSource.includes("'data-codesys-online-bound': onlineBound ? 'true' : 'false'"),
    'the scan button must expose the bound state');
  assert(clientSource.includes("onlineBound ? '已绑定' : '扫描设备'"),
    'the scan button must relabel itself once a device is bound');
  assert(clientSource.includes("codesysActionIcon(onlineBound ? 'onlineBound' : 'onlineScan')"),
    'the bound state must also change the icon (the sidebar can be icon-only)');
  assert(clientSource.includes('.taskhive-codesys-online-scan.is-bound'),
    'the bound state must be styled');
  assert(!clientSource.includes("await confirmOnlineTarget('登录到这台设备？'"),
    'login must not pop a separate device confirmation any more (the bound state is the indicator)');
  assert(clientSource.includes('const confirmOnlineTarget = (title, extra) =>'),
    'the download confirmation stays');
  assert(/await confirmOnlineTarget\(\s*'把当前工程下载到这台设备？'/.test(clientSource),
    'a download must still confirm which device receives the program');
}

// ── 9d. 在线值与原生 CODESYS 对齐：FB 实例读成员 + 实现区也标值 ──────────────
// 用户口径：「为什么在线不是显示在视图（和原生 codesys 一样，代码编辑器显示在线变量和
// 代码的值等等），是不能实现吗？」现场截图里只有 `stopExecute : BOOL;` 行尾有值 —— 因为
// 9 行 `xxx : MC_xxx;` 是 FB 实例，发实例名本身读不出东西；实现区则完全没接在线值。
{
  // 声明行解析必须能拿到类型（含缩进、含 AT %I* 映射）。
  assert(clientSource.includes('function codesysMonitorVariables(declaration)'),
    'the workbench must know each declaration variable\'s type');
  assert(clientSource.includes("const cleaned = String(line).replace(/\\(\\*.*?\\*\\)/g, ' ').trim()"),
    'the type regex must tolerate the leading indentation every real declaration has');
  assert(clientSource.includes('function codesysMonitorExpressionsFor(variable)'),
    'there must be one place that decides what to read per variable');
  // 简单变量读自己；FB 实例读关键成员；数组/结构整体不读。
  assert(clientSource.includes("CODESYS_MONITOR_SCALAR_TYPE.test(type)"),
    'a scalar must be read directly');
  assert(clientSource.includes('CODESYS_MONITOR_SKIP_TYPE.test(type)'),
    'an array/struct must not be read as a whole value');
  assert(clientSource.includes('CODESYS_MONITOR_FB_MEMBERS[type] || CODESYS_MONITOR_FB_FALLBACK'),
    'a function block must be read through its members');
  for (const type of ['MC_Power', 'MC_ReadActualPosition', 'MC_ReadStatus', 'MC_MoveAbsolute', 'MC_Stop', 'MC_Reset', 'TON', 'CTU']) {
    assert(clientSource.includes(`${type}: [`), `${type} needs a member list (that is what CODESYS shows when expanded)`);
  }
  // 简单变量排在成员前面（分批时它们落在最前面的批次里）。
  assert(clientSource.includes('const expressions = [...new Set([...simple, ...members])]'),
    'the read set must be the WHOLE monitorable set, in the simple-then-members order');
  // ── 本轮（用户规则原文：「上限去除」）：**不存在** 90 条截断 ─────────────────────
  // 旧断言要求工作台里**存在** `[...simple, ...members].slice(0, 90)`，也就是把那个上限本身
  // 钉住。按**意图**换成下面这组更强的断言：截断必须消失（两个读值出口都不许再截条数），
  // 而且"真正的边界"必须被如实处理 —— 引擎/在线工作进程单次 `monitor` 各夹在 120 条
  //（护住串行命令队列与 20 s 的 IPC 超时），所以客户端必须**跨既有节拍分批轮转**，
  // 而不是把整份清单塞给引擎、让第 120 条之后无声地丢掉（那只是把 90 换成 120）。
  // 这两条断言必须是"代码里不存在"，所以看 `clientCode`（剥掉注释的那一份，见文件头约定）：
  // 删除原因写在注释里是本仓惯例，一段解释"那个上限为什么删掉"的注释不能把红线判成回归。
  assert(!clientCode.includes('slice(0, 90)'),
    'the 90-expression read cap must be gone: every monitorable declaration/member expression has to'
    + ' enter the read set, so nothing past the 90th is permanently stuck on the placeholder');
  // 两个出口：读值清单（工作台发给引擎）与只读快照（工作台发给宿主）。两个都不许截条数。
  assert(!/onlineValues\.expressions\.slice\(/.test(clientCode),
    'the read-only snapshot handed to the host must not truncate the expression list either');
  assert(clientSource.includes('? onlineValues.expressions.map((name, index) => ({ expression: String(name || \'\'),')
    || /onlineValues\.expressions\.map\(\(name, index\) => \(\{ expression: String\(name \|\| ''\)/.test(clientSource),
    'the snapshot must map the WHOLE observed expression list (the per-value 120-CHARACTER truncation'
    + ' is a different thing: it protects the snapshot from one huge string, it is not a count cap)');
  // 真边界：120 条（两处），并且客户端必须**分批**而不是把整份清单一次交出去。
  // 这份 worker 脚本在本块里单独拼一份：上一处 `script` 是另一个块作用域里的，这里看不到它。
  const monitorWorkerScript = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { maxIdleSeconds: 60, resultPrefix: 'r-' });
  assert(engineSource.includes('.slice(0, 120)'),
    'the engine still owns the real per-call cap (120 expressions in one monitor command)');
  assert(monitorWorkerScript.includes('if len(expressions) >= 120:') && monitorWorkerScript.includes('break'),
    'the online worker must still stop at the same 120 hard cap (defence in depth, serial command queue)');
  assert(clientSource.includes('const size = batchSize > 0 ? batchSize : expressions.length'),
    'the client must send ONE batch per tick, not the whole set');
  assert(clientSource.includes("const start = cursor % expressions.length")
    && clientSource.includes('const batch = expressions.slice(start, start + size)'),
    'the batch must rotate through the read set across the EXISTING ticks (no new timer): it is driven'
    + ' by cursor over expressions, so every expression is eventually read');
  assert(clientSource.includes('if (!batchSize && names.length > 0 && names.length < batch.length) batchSize = names.length'),
    'the batch size must be calibrated from the engine\'s own echo instead of a number duplicated in the'
    + ' client, so raising the engine cap needs no client change');
  assert(clientSource.includes('cursor = (start + Math.max(1, filled)) % expressions.length'),
    'the cursor may only advance past expressions the engine actually READ — otherwise the expressions'
    + ' beyond the engine cap would never be requested (the same defect with a different number)');
  // 第二重真边界：批量读失败时 worker 逐条回退，而逐条回退有自己的上限与时间预算
  //（MONITOR_PER_EXPRESSION_MAX = 24 / 4 s）。真机帧（AXIS_X_PRG，27 条）里最后 3 条就是被
  // 它标成"本轮未读取"的：**值回带空串、`expressions` 照旧回带整份清单**。客户端必须
  // 按引擎自报的未读清单（`errors[].expression`）把这一拍"没读"的和"读到了空值"分开：
  //   · 没读 ⇒ 保留面板上一次观测到的值（绝不能拿空串把它抹掉，否则那些变量会在 `—`
  //     和真值之间来回闪），也不推进游标 —— 起点因此会挪，下一拍它们就落到引擎真能读的位置；
  //   · 读了 ⇒ 返回什么存什么（空串也是真实的值，例如内容为空的 STRING）。
  assert(clientSource.includes('const unread = new Set(')
    && /value\.errors[\s\S]{0,200}?\.map\(\(item\) => String\(item\?\.expression \|\| ''\)\)/.test(clientSource),
    'the client must read the engine-reported unread list (value.errors[].expression)');
  assert(clientSource.includes('if (unread.has(name)) continue')
    && clientSource.includes("observed.set(name, String(values[index] ?? ''))"),
    'a read the engine did NOT perform may never overwrite the value the panel already observed');
  assert(clientSource.includes('cursor = (start + Math.max(1, filled)) % expressions.length'),
    'the cursor may only advance past expressions the engine actually READ — otherwise the expressions'
    + ' the engine skipped would never be requested again (the same defect with a different cap)');
  assert(clientSource.includes("const ordered = expressions.map((name) => (observed.has(name) ? observed.get(name) : ''))"),
    'observed values must accumulate across batches by expression name (a later batch must not wipe'
    + ' the values an earlier batch already read)');
  // 仍然单飞：分批不得变成并发请求。
  assert(clientSource.includes('if (cancelled || inFlight || onlineBusyRef.current) return'),
    'batching must keep the single-flight guard: one monitor request in the air at a time');
  // 值列：一个 map 存 "名字 -> 值"，声明区按行映射，实现区按"这一行引用了谁"映射。
  assert(clientSource.includes('const onlineValueByName = React.useMemo('),
    'values must be indexed by expression name once');
  assert(clientSource.includes('const onlineInlineByLine = React.useMemo('),
    'the declaration section must turn the whole code into per-line inline segments (once)');
  assert(clientSource.includes('const onlineInlineByLineImpl = React.useMemo('),
    'the implementation section must show values too');
  assert(clientSource.includes('const inlineByLine = onlineLoggedIn\n'),
    'both editor sections must be wired to their own full-line segment map, driven by the login state'
    + ' (the 「在线值」 switch is gone, so a login alone must bring the values up)');
  // 本轮（**冻结**，用户拍板「编辑栏直接被冻结」）按**意图**更新了这一条：
  // T216 曾经要求"光标所在的那一段不画值"（内联值会让镜像层的字符整体右移，而 textarea 的
  // 光标是按自己的文字排布的）。现在已登录就冻结编辑栏（只读），"边看值边打字"不可能发生，
  // 而那段让位恰恰会让「代码 + 值」在光标进去时消失一半。所以判据改成：
  //   · 让位逻辑（以及它的 focusedSection 状态）必须**消失**；
  //   · 已登录（值显示中）时，两段都必须无条件地画（代码与值同时可见）。
  // 两条都比原来更强：原来只要求"存在一个带 focusedSection 的表达式"，现在要求它不存在。
  assert(!clientSource.includes("const [focusedSection, setFocusedSection] = React.useState('')"),
    'the T216 caret-position stand-down state must stay deleted: a frozen (read-only) editor never'
    + ' needs it, and standing down is what hid half of the code again while online values were on');
  assert(!clientSource.includes('focusedSection !== section.id'),
    'the caret must no longer decide whether the mirror paints (code + values must always be together)');
  assert(clientSource.includes('const showInline = Boolean(inlineByLine)\n'),
    'while logged in the mirror must paint unconditionally — the code text is drawn THERE');
  assert(clientSource.includes('parts.push(`${key.slice(lower.length + 1)}=${value}`)') ||
    clientSource.includes('member = `${key.slice(lower.length + 1)}=${value}`'),
    'an FB line must summarise its members (member=value)');
  assert(clientSource.includes("codesysInlineValueSegments(raw,"),
    'every line must be cut into [text, value, text, value …] so the value sits INSIDE the code flow');
  assert(clientSource.includes('function codesysInlineValueSegments(line, resolve)'),
    'that segmentation must live in one reusable pure helper');
  // 本轮（样式 A）用户报障原文：「在线值依然显示的太难看了，为什么不可以把在线值直接替换代码
  // 编辑区到变量？？？而且显示不全？我滚动到时候底下很多都没有加载」。三件事：值就地跟在变量
  // 后面；镜像层不许有任何能裁掉它的盒子（而且它自己必须 overflow:visible，否则 translate 跟随
  // 滚动时只有开头十几行看得见）；段落表一次覆盖整份代码的所有行。
  assert(!clientSource.includes('has-online-values'),
    'the retired third value column must not come back (values live in the code flow now)');
  assert(!clientSource.includes('taskhive-codesys-online-values'),
    'and neither may its element or class name');
  assert(clientSource.includes('className: \'taskhive-codesys-inline-online\', ref: refs.inline,'),
    'the in-place mirror layer must be its own element, tracked for scroll sync');
  assert(clientSource.includes("transform = `translate(${-left}px, ${-top}px)`"),
    'the mirror must follow BOTH scroll axes or an inline value drifts away from its variable');
  // 本轮（A 项：修"一片白"）—— 镜像层必须**自己把代码文字画出来**，而且用正文墨色。
  // 用户报障原文：「开启在线值后会把原来的代码编辑区给覆盖掉，变成一片白和监控过来的值」。
  // 成因：开关打开时 textarea 的字被 .is-inline-mirrored 透明化（下面那条），而镜像层又把
  // **代码文字**也画成 transparent ⇒ 屏幕上只剩那几个有自己颜色的值 span。
  // 判据按**意图**钉住（只加强）：
  //   ① 镜像层仍是 inert / 不可选中 / overflow:visible（原有两条意图一条不删）；
  //   ② 它的 color 是正文墨色：非 transparent、且**不等于背景色**（--th-surface），
  //      否则"画出来了"在屏幕上仍然等于没画；
  //   ③ 值 span 是另一种颜色（灰蓝 --th-ink-2），否则分不出哪一段是值。
  assert(clientSource.includes('overflow:visible;pointer-events:none;user-select:none;color:var(--th-ink)'),
    'the mirror must stay an inert, unselectable, overflow:visible annotation layer AND paint the'
    + ' code text itself in the normal ink colour (the textarea goes transparent while it is on)');
  assert(!/taskhive-codesys-inline-online\{[^}]*color:transparent/.test(clientSource),
    'the mirror layer must never paint the code text transparent again — that is exactly the'
    + ' "blank screen with only the values" defect the operator reported');
  {
    // 主题令牌就在同一个片段里定义（各一次），所以可以当真解析出来比较，而不是比字面量。
    const token = (name) => (clientSource.match(new RegExp(`${name}:(#[0-9a-fA-F]{3,8})`)) || [])[1] || '';
    const ink = token('--th-ink');
    const ink2 = token('--th-ink-2');
    const surface = token('--th-surface');
    assert(ink && ink2 && surface, 'the ink / value-ink / surface tokens must all be defined');
    assert(ink.toLowerCase() !== surface.toLowerCase(),
      `the code colour must differ from the editor background (ink ${ink} vs surface ${surface})`);
    assert(ink2.toLowerCase() !== ink.toLowerCase(),
      `the value colour must differ from the code colour, or "which part is the value" is invisible (${ink2} vs ${ink})`);
    assert(clientSource.includes('.taskhive-codesys-inline-value{color:var(--th-ink-2)'),
      'only the value span may use the dimmed grey-blue; the code text keeps the normal ink');
    // 本轮 A 项（用户报障原文：「现在在线值看不出来，应该和原生ide一样有背景色」）：
    // 只给一段灰蓝的字**看不出来"这一段是值"**，所以值必须有一块克制的**底色**（原生 IDE
    // 的在线值就是这个观感）。判据全部按意图钉住，且只加强：
    //   ① 底色 = 令牌（不许散落字面色），且 ≠ 背景（--th-surface）、≠ 代码墨色、≠ 值字色；
    //   ② 2px 圆角 + 左右各 3px 内边距（"一小块值"而不是"一条底色带"）；
    //   ③ display:inline-block —— min-width 对非替换 inline 元素不生效，而每个值的稳定槽
    //      （本轮 B 项：值一变不把后面的代码左右推）正是靠 min-width；
    //   ④ 未知的底色必须比真值更淡（不许比真值显眼）；
    //   ⑤ 这一条规则里一个能裁字的属性都没有（长值完整可见的原判据在别处继续生效）。
    {
      const cssRuleOf = (selector) => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return (clientSource.match(new RegExp(`${escaped}\\{([^}]*)\\}`)) || [])[1] || ''
      }
      const valueRule = cssRuleOf('.taskhive-codesys-inline-value')
      const unknownRule = cssRuleOf('.taskhive-codesys-inline-value.is-unknown')
      const bgTokenOf = (rule) => (String(rule).match(/background:var\((--[a-z0-9-]+)\)/) || [])[1] || ''
      const hexOf = (name) => token(name).toLowerCase()
      const spread = (hex) => {
        const raw = String(hex || '').replace('#', '')
        const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw
        const channel = (at) => parseInt(full.slice(at, at + 2), 16) || 0
        return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
      }
      const valueBgToken = bgTokenOf(valueRule)
      const unknownBgToken = bgTokenOf(unknownRule)
      const valueBg = hexOf(valueBgToken)
      const unknownBg = hexOf(unknownBgToken)
      assert(valueBgToken && valueBg,
        '① 值必须有底色，而且底色只能是主题令牌（用户报障原文「在线值看不出来，应该和原生ide一样有背景色」）')
      assert(!/(^|;)background:#/.test(valueRule) && !/(^|;)background:rgb/.test(valueRule),
        '① 底色不许硬编码字面色，必须走令牌（否则换个主题就散架）')
      assert(valueBg !== surface.toLowerCase() && valueBg !== ink.toLowerCase() && valueBg !== ink2.toLowerCase(),
        `① 值的底色必须同时 ≠ 编辑区底色 / 代码墨色 / 值字色（底色 ${valueBg}、背景 ${surface}、墨色 ${ink}、值字色 ${ink2}）`)
      assert(/padding:0 3px/.test(valueRule) && /border-radius:2px/.test(valueRule),
        '② 值要有小水平内边距 + 2px 圆角')
      assert(/display:inline-block/.test(valueRule),
        '③ 值必须是 inline-block：min-width 对非替换 inline 元素不生效，稳定槽是"值一变不推代码"的全部依靠')
      assert(unknownBg && spread(unknownBg) > spread(valueBg),
        `④ 未知的底色必须比真值更淡，不许比真值显眼（未知 ${unknownBg} vs 真值 ${valueBg}）`)
      assert(!/overflow:hidden|text-overflow|white-space:nowrap/.test(valueRule) && !/overflow:hidden|text-overflow|white-space:nowrap/.test(unknownRule),
        '⑤ 值/未知这两条规则都不许出现能裁字的属性（min-width 只是下限，长值仍然完整可见）')
    }
    // 本轮 B 项（用户报障原文：「而且在线值是不是刷新一下导致根本没法正常看」）：
    // 值的位置必须有一个**只增不减的稳定槽**（min-width），否则值一变宽（`0` → `2048576000`）
    // 就会把它后面的整段代码推一次 —— 每 1.5 秒推一次，人就读不了。三件东西必须同时在：
    //   · 类型/历史最宽值算出的槽（codesysOnlineValueSlotFloor + onlineValueSlotRef）；
    //   · 逐值内联的 min-width（onlineValueSlotStyle）与可检查的 data-online-value-slot；
    //   · 值没变的行复用同一个元素对象（inlineLineCacheRef）—— 只更新变化了的 span。
    assert(clientSource.includes('function codesysOnlineValueSlotFloor(type)') &&
      clientSource.includes('const onlineValueSlotRef = React.useRef(new Map())'),
      'the per-value stable slot must be computed from the declared IEC type and the widest value seen')
    assert(clientSource.includes('const onlineValueSlotStyle = (slot) =>') &&
      clientSource.includes("'data-online-value-slot': slot,"),
      'and every value span must carry its inline min-width plus the inspectable slot attribute')
    assert(clientSource.includes('const inlineLineCacheRef = React.useRef(new Map())') &&
      clientSource.includes('if (cached && cached.signature === signature) return cached.element'),
      'a line whose value did not change must return the very same element object (React then skips the subtree)')
  }
  assert(clientSource.includes('color:transparent!important;caret-color:var(--th-ink)'),
    'with the mirror visible the textarea keeps the caret but not a second copy of the code text');
  // 未登录（或退出登录）时**只有**这一条让位规则能藏字：它挂在 .is-inline-mirrored 上，而那个类
  // 只在 showInline（已登录、值显示中）时挂上 ⇒ 未登录那一刻 textarea 的文字必然恢复可见（原样）。
  assert(!/taskhive-codesys-code-editor\s*\{[^}]*color:transparent/.test(clientSource),
    'the code editor may only go transparent through the .is-inline-mirrored rule (never as its base'
    + ' style), so logging out always brings the text back');
  assert(!clientSource.includes('minmax(72px') && !clientSource.includes('minmax(96px') && !clientSource.includes('minmax(58px'),
    'no fixed/min value-column width may survive anywhere (that is what clipped a long value)');
  assert(!/taskhive-codesys-inline-value[^{]*\{[^}]*overflow:hidden/.test(clientSource),
    'the value span must never carry overflow:hidden');
  assert(!/taskhive-codesys-inline-value[^{]*\{[^}]*text-overflow:ellipsis/.test(clientSource),
    'and never text-overflow:ellipsis (a value is shown whole or not at all)');
  assert(clientSource.includes("className: 'taskhive-codesys-editor-highlights', ref: refs.highlight, 'aria-hidden': 'true'") &&
    clientSource.includes('.taskhive-codesys-editor-highlights{position:absolute;top:0;right:0;bottom:0;left:0;padding:8px 0;pointer-events:none;overflow:visible'),
    'the line-tint layer carried the same clip bug and must stay overflow:visible too');
  // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：原来这里钉的是
  // 「未登录时开关 disabled」。开关不存在了，这条按**意图**换成更强的一条：**未登录不读不画**
  // —— 未登录时读值的 effect 直接不跑（连定时器都不建），两段段落表恒为 null，
  // 而编辑栏保持可编辑（`disabled: !onlineLoggedIn` 这种"灰掉的控件"也不许回来）。
  assert(!clientCode.includes('disabled: !onlineLoggedIn'),
    'no control may be disabled by the login state any more (there is no online-value switch to grey out)');
  assert(!clientCode.includes('setInlineOnlineValues'),
    'and nothing may exist that could switch the values on or off by hand');
  assert(clientCode.includes('if (!jobId || !onlineLoggedIn || !workbenchVisible)'),
    'not logged in, the read path must not run at all (not a single read, not a single value painted)');
}

gateStage('s9e-9h-online-session');
// ── 9e. 在线会话必须活过"切屏"，动作必须有可见提示 ─────────────────────────
// 用户口径：「登录过程没有登录提示，在线数据掉线，难不成因为我切屏掉线？」
// 实测就是：工作台组件一卸载（切标签/切界面）就 disarmCodesysOnline('workbench-closed')，
// 而宿主收到 disarm 会 stopOnlineSession() —— 连接被杀，"掉线"由此而来。
{
  assert(!clientSource.includes("disarmCodesysOnline?.({ reason: 'workbench-closed' })"),
    'unmounting the workbench must NOT drop the online session (this is what disconnected the PLC on every tab switch)');
  assert(!/React\.useEffect\(\(\) => \(\) => \{[^}]{0,120}disarmCodesysOnline/.test(clientSource),
    'no unmount cleanup may disarm the session');
  assert(clientSource.includes("disarmCodesysOnline?.({ reason: 'project-rebound' })"),
    'switching projects must still drop the grant (the grant names one project)');
  assert(mainSource.includes("event: 'online-disarm'") === false && mainSource.includes("stopOnlineSession(`authorization-${reason}`)"),
    'an explicit disarm still stops the worker — only the workbench-closed path is gone');
  // 登录要等 20–40 秒：必须有可见的进行中提示 + 秒数。
  assert(clientSource.includes("'data-codesys-online-pending': 'true'"),
    'a running online action must show a visible pending indicator');
  assert(clientSource.includes('const CODESYS_ONLINE_PENDING_LABEL = {'),
    'the pending indicator must name the action (login / download / …)');
  assert(clientSource.includes('setOnlineBusySeconds(Math.round((Date.now() - startedAt) / 1000))'),
    'the pending indicator must tick elapsed seconds so a 40s login never looks frozen');
  assert(clientSource.includes('.taskhive-codesys-online-pending{'),
    'the pending indicator must be styled');
}

// ── 9f. 「新界面 + 旧引擎」必须自证，不能靠用户对着旧报错猜 ─────────────────
// 现场：插件 JS 刷新一次就是新的，而 app/main.js、scriptengine.cjs、online-session.cjs
// 只在 TaskHive 启动时加载。用户因此连着踩了两次 —— 界面是新功能，引擎还是旧写法
// （固定名 online-worker.py 的 EBUSY 就是旧引擎写出来的）。
{
  assert(mainSource.includes('const CODESYS_ENGINE_FILES = ['),
    'the host must know which files only take effect after a restart');
  for (const file of ['app/main.js', 'app/preload.js', 'scriptengine.cjs', 'online-session.cjs']) {
    assert(mainSource.includes(file), `the engine freshness list must cover ${file}`);
  }
  assert(mainSource.includes('function codesysEngineFreshness()') && mainSource.includes('stale: changed.length > 0'),
    'the host must compare loaded vs current mtimes');
  assert(isRegistered(mainSource, 'codesys:engine-freshness'),
    'a NEW channel is the only way the UI can prove the main process is not old');
  assert(mainSource.includes('runtime: codesysEngineFreshness(),'),
    'the online status payload must carry the freshness so the workbench can warn');
  assert(preloadSource.includes('codesysEngineFreshness: () => ipcRenderer.invoke('),
    'preload must expose the freshness bridge');
  assert(clientSource.includes("reason: 'channel-missing'"),
    'a missing channel (old main process) must be treated as stale, not swallowed');
  assert(clientSource.includes("'data-codesys-engine-stale': ['channel-missing', 'no-bridge'].includes("),
    'the workbench must expose why it believes the engine is old');
  assert(clientSource.includes('请重启 TaskHive：在线引擎是旧版本'),
    'the workbench must say the fix out loud (restart), not just log it');
  assert(clientSource.includes('.taskhive-codesys-engine-stale{'), 'the warning must be styled');
  // 扫描：成功的这一轮必须清掉上一轮的错误（缓存轮失败 + 实时轮成功 = 现场截图那个中间态）。
  assert(clientSource.includes("phase: 'done',\n              // 成功的这一轮必须清掉上一轮的错误"),
    'a successful scan round must clear the previous round\'s error text');
}

// ── 9g. 绑定是登录/下载的前置条件（点的时候提示，不做常驻告警）────────────────
// 用户口径两句话合成一条规则：
//   「我都没有绑定设备 为什么可以登录？明显不合理」      → 绑定必须是前置条件；
//   「不应该为常驻提示信息，应该是点击在线功能状态栏提示一下」→ 不常驻告警，
//     按钮保持可点，点了在状态栏说明；绑定成功后再提示一次。
{
  assert(engineSource.includes("const REQUIRES_BOUND_TARGET = ['online-login', 'online-download', 'online-change'];"),
    'login / download / online-change must require a bound target');
  assert(engineSource.includes("if (REQUIRES_BOUND_TARGET.includes(action) && !job.onlineTargetOverride)"),
    'the engine must refuse those actions while no device is bound (the UI check alone is not enough)');
  assert(engineSource.includes("code: 'CODESYS_ONLINE_TARGET_NOT_BOUND'"),
    'the refusal needs its own code so the UI can explain it');
  // 按钮**不再因为未绑定而禁用**（禁用等于点了没反应，也就没有"点一下给个提示"）。
  assert(clientSource.includes('disabled: onlineBusy || busy || !onlineReady || onlineConnected,'),
    'the login button must stay clickable while nothing is bound (so it can explain itself)');
  assert(!clientSource.includes('disabled: onlineBusy || busy || !onlineReady || onlineConnected || !onlineBound'),
    'the login button must not be disabled by the binding gate any more');
  assert(!clientSource.includes('disabled: onlineBusy || busy || !onlineConnected || !onlineBound'),
    'the download button must not be disabled by the binding gate any more');
  // 点下去 → 状态栏说明（这就是"点击在线功能状态栏提示一下"）。
  assert(/if \(!onlineBound\) \{\s*setStatus\('尚未绑定设备：请先点「扫描设备」选中一台 PLC/.test(clientSource),
    'clicking login while unbound must explain itself in the status bar');
  assert(/if \(!onlineBound\) \{\s*setStatus\('尚未绑定设备：请先点「扫描设备」选中一台 PLC，再点「下载」/.test(clientSource),
    'clicking download while unbound must explain itself in the status bar');
  // 目标 chip：如实显示"未选择"，但**不是**常驻告警。
  assert(clientSource.includes("'data-codesys-online-target-bound': onlineBound ? 'true' : 'false'"),
    'the target chip must expose the bound state for probes');
  assert(!clientSource.includes(": '目标 未选择 · 点这里选择'"),
    'the unbound state must not render a permanent chip at all (status line only)');
  assert(!clientSource.includes('.taskhive-codesys-online-target-chip.is-unbound{'),
    'the permanent yellow unbound warning must stay removed');
  // 未绑定时点它打开**目标面板**（不是直接跳扫描）：面板里同时有「扫描设备…」和
  // 「IP 直连」两条路，只跳扫描会把 IP 直连挡在门外（用户口径：「怎么通过 ip 直连？」）。
  // T112：目标相关操作**只有一处** —— 底部「扫描设备」面板（弹层已整体删除）。
  assert(clientSource.includes('const openOnlineTargetPanel = () => {') &&
    clientSource.includes('void openScanDialog()'),
    'the target entry point must open the bottom scan panel');
  assert(!clientSource.includes('setOnlineTargetOpen('),
    'the removed popover must not leave its toggle behind');
  assert(!clientSource.includes('onlineTargetPanelNode'),
    'the removed popover node must not be referenced any more');
  assert(clientSource.includes("'data-codesys-scan-manual': 'true'") &&
    clientSource.includes("'data-codesys-scan-gateway': 'true'") &&
    clientSource.includes("'data-codesys-scan-address': 'true'") &&
    clientSource.includes("'data-codesys-scan-address-apply': 'true'"),
    'the gateway / node-address / apply controls must have moved into the scan panel');
  assert(clientSource.includes("'data-codesys-scan-release': 'true'"),
    'the "release online session" control must have moved into the scan panel');
  assert(clientSource.includes('正在读取可用网关（会启动一次在线进程'),
    'opening the panel without gateway enumeration must fetch gateways first');
  // T110：IP 直连**不再是独立弹层**，它就在底部「扫描设备」面板里，而且不必先扫描。
  assert(clientSource.includes("'data-codesys-scan-ip-row': 'true'") &&
    clientSource.includes("'data-codesys-scan-ip': 'true'") &&
    clientSource.includes("'data-codesys-scan-ip-port': 'true'") &&
    clientSource.includes("'data-codesys-scan-ip-apply': 'true'"),
    'the IP direct-connect row must live inside the scan panel');
  assert(clientSource.includes('const applyDirectIp = async () => {'),
    'there must be one place that binds a typed IP');
  assert(clientSource.includes("source: 'ip'"),
    'an IP binding must be recorded with its own source so the UI can say so');
  assert(!clientSource.includes("h('option', { value: 'ip' }, 'IP 直连')"),
    'the separate IP mode in the target popover must be gone (one entry point only)');
  assert(!clientSource.includes("'data-codesys-online-target-ip': 'true'"),
    'the popover must not keep its own IP field');
  // 弹层里那个"指路按钮"也随弹层一起没了：现在根本没有第二处入口。
  assert(!clientSource.includes("'data-codesys-online-target-ip-entry': 'true'") &&
    !clientSource.includes('扫描设备 / 填 IP…'),
    'the temporary pointer button must be gone too (the popover itself is deleted)');
  assert(clientSource.includes('直接填 PLC 的 IP，例如 192.168.31.58（不必先扫描）'),
    'the IP input must say that scanning is not required');
  assert(clientSource.includes('.taskhive-codesys-scan-ip{'),
    'the in-panel IP row must be styled');
  // 绑定成功后的那句提示（扫描选中 / 手动应用两条路都必须有）。
  assert(clientSource.includes('已绑定 ${picked.device.name || \'\'} ${draft.address}'),
    'a successful scan-pick binding must confirm in the status bar');
  assert(clientSource.includes('已绑定在线目标 ${address}'),
    'a successful manual binding must confirm in the status bar');
  // 进行中提示放在**最下面的状态栏**。
  assert(clientSource.includes("className: 'taskhive-codesys-status', role: 'status'"),
    'the bottom status row must still exist');
  assert(/taskhive-codesys-status[\s\S]{0,900}?data-codesys-online-pending/.test(clientSource),
    'the online pending indicator must live in the bottom status bar, not the header row');
  assert(clientSource.includes('CODESYS_ONLINE_TARGET_NOT_BOUND'),
    'the workbench must map that refusal to a readable message');
}

// ── 9h. 本轮 B 项（**冻结**）：已登录到应用时，写入工程这条通路整体关闭 ──────────
// 用户拍板的规则原话：
//   「登录应该是这个逻辑，登录之后就不允许修改代码，只可以查看在线变量」
//   「同意，ai写入和手动写入都禁止，编辑栏直接被冻结」
// 两层都要有，缺一不可（一次都不得只靠"按钮灰掉"）：
//   · UI 层：编辑栏 readOnly 且不产生草稿；「确认写入」与「载入 AI 建议」禁用并写出一行
//     原因 + 出路（不许静默）；AI 提案照旧可看、可放弃（放弃本来就不写工程）；
//   · 引擎/宿主层：写类动作在已登录时被**引擎**拒绝（ONLINE_WRITE_FROZEN + 可读原因），
//     绕过界面（抽屉 / 探针 / 直接 IPC）也写不进去；
//   · 未登录时语义完全不变（sha 三态守卫 / 写前快照 / 原子提交 / per-job 互斥 / 用户点击）。
{
  // ── UI 层（形状；行为由 codesys-inline-online-values-behaviour.js 真跑组件钉住）──
  assert(clientSource.includes("const CODESYS_ONLINE_WRITE_FROZEN_DETAIL = '在线状态下不允许写入工程；如需修改请先退出登录（面板在线区「退出登录」）。'"),
    'there must be exactly ONE readable reason + way out (a disabled control may never be silent)');
  assert(clientSource.includes('const onlineWriteFrozen = onlineLoggedIn'),
    'the freeze must key on the application login (state.isLoggedIn), not on "connected"');
  assert(clientSource.includes('readOnly: onlineWriteFrozen,'),
    'the code editor must become read-only while logged in (manual writing forbidden)');
  assert(clientSource.includes('onChange: (event) => { if (onlineWriteFrozen) return; section.onChange(event.target.value) },'),
    'the editor must refuse the input itself, so no typing path can produce a draft');
  assert(clientSource.includes("'data-editor-readonly': onlineWriteFrozen ? 'true' : 'false',"),
    'the editor must expose the frozen state so a probe can see it');
  assert(clientSource.includes("'data-codesys-write-frozen': onlineWriteFrozen ? 'true' : 'false',"),
    'the confirm control must expose the frozen state too');
  assert(clientSource.includes('disabled: onlineWriteFrozen || busy || !writeAvailable || !effectiveChanges.length || !reviewAccepted || effectiveErrors.length > 0,'),
    'the confirmed write must be DISABLED while frozen, not merely refused after the click');
  assert(clientSource.includes("title: onlineWriteFrozen\n              ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL"),
    'the disabled write button must explain WHY and name the way out (never advertise a write)');
  assert(clientSource.includes('disabled: onlineWriteFrozen,') && clientSource.includes('title: onlineWriteFrozen ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL'),
    'loading an AI suggestion INTO the editor is an AI write too: it must be disabled with the reason');
  assert(clientSource.includes("return notReady('online-write-frozen', CODESYS_ONLINE_WRITE_FROZEN_DETAIL)"),
    'the write function itself must refuse while frozen (the chat drawer calls the same function)');
  assert(clientSource.includes('const capabilityBlockReason = capabilityGate.onlineWriteFrozen') &&
    clientSource.includes('onlineWriteFrozen: onlineWriteFrozen === true,') &&
    clientSource.includes('frozenDetail: onlineWriteFrozen ? CODESYS_ONLINE_WRITE_FROZEN_DETAIL : \'\','),
    'the drawer shares this gate, so the frozen state and its reason must be published to it');
  // 放弃**不在**冻结范围内：它一个字节都不写工程（既有语义一字不改）。
  assert(/disabled: busy,\s+onClick: \(\) => \{ void discardProposal\(\) \},/.test(clientSource),
    'discarding a proposal must stay available while frozen (it writes nothing)');
  // 本轮（写入行抽屉化）按**意图**只把那个词说得更准：冻结那一档从「已冻结」改成
  // 「在线已冻结」（仍然包含原来的词，只是点明是哪一种冻结），原有三个短词逐个保留。
  assert(clientSource.includes('const writeStateLabel = onlineWriteFrozen') &&
    clientSource.includes("? '在线已冻结'") &&
    clientSource.includes('已冻结') &&
    clientSource.includes("? (effectiveChanges.length ? '可写入' : '等待 AI 改动')") &&
    clientSource.includes(": '不可写入'"),
    'the one-line write bar must say 在线已冻结 while logged in and keep every previous state word');
  // 面板自己的在线操作（登录/退出/下载/启停）保持原样 —— 冻结只管"写工程"。
  assert(clientSource.includes("'data-codesys-online-logout': 'true'"), 'the panel logout control must stay (it is the way OUT of the freeze)');

  // ── 引擎/宿主层：静态形状 ────────────────────────────────────────────────────
  assert(engineSource.includes("const ONLINE_WRITE_FROZEN_ACTIONS = new Set([...MUTATING_ACTIONS, 'rollback'])"),
    'the engine must freeze every mutating action AND rollback (it overwrites the project too)');
  assert(engineSource.includes('await this.assertOnlineWriteAllowed(normalized);'),
    'the engine entry point (the only write path) must run the freeze gate before dispatching');
  assert(engineSource.includes("code: ONLINE_WRITE_FROZEN_CODE"),
    'a refused write must carry a structured code, not just a message');
  assert(engineSource.includes('async onlineWriteFreeze()') && engineSource.includes("const status = await this.onlineStatus();"),
    'the verdict must come from the online process itself (status.isLoggedIn), so the UI cannot fake it');
  // 「真跑一次」的拒绝与放行在 tests/codesys-online-write-freeze-contract.js：那一条驱动真实的
  // 工作台组件与真实的引擎（进程接缝可数），断言"已登录 0 次写入 + 可读原因 + 退出登录后照旧"。
}

gateStage('s10-11b-ui-shapes');
// ── 11b. IP 直连（set_gateway_and_ip_address）──────────────────────────────
// API 有 8 个重载，含纯字符串版；**没有 getter**，所以设完读不回来 —— 这一点必须
// 在代码与界面上都如实说明，不能假装能确认。
{
  const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { resultPrefix: 'r-' });
  const body = script.slice(script.indexOf('def do_set_target'), script.indexOf('def do_scan'));
  assert(body.includes('set_gateway_and_ip_address'), 'the worker must be able to retarget by IP');
  assert(
    body.includes("set_gateway_and_ip_address(gateway_name, ip_address)"),
    'the plain-string overload must be used (no System.Net.IPAddress construction needed)',
  );
  assert(body.includes("'targetMode': 'ip' if ip_address else 'address'"), 'the target mode must be reported');
  assert(body.includes("'readBackLimited': bool(ip_address)"), 'IP mode must admit that it cannot be read back');
  assert(
    !body.includes('IPAddress.Parse') && !body.includes('import System'),
    'the worker must not need .NET IPAddress construction',
  );
  assert(
    mainSource.includes("ipAddress: String(args.ipAddress || ''),") &&
      mainSource.includes("targetMode: result?.targetMode || 'address',"),
    'the audit record must capture the IP and the addressing mode',
  );
  assert(
    // T110：IP 直连从"目标弹层里的寻址方式开关"搬到了「扫描设备」底部面板里的一行 ——
    // 能力不变（IP 必填、端口可选），位置改了；两处入口会互相打架，所以只保留一处。
    clientSource.includes("'data-codesys-scan-ip': 'true'") &&
      clientSource.includes("'data-codesys-scan-ip-port': 'true'") &&
      clientSource.includes("'data-codesys-scan-ip-apply': 'true'"),
    'IP direct connect must offer an IP and an optional port field (now inside the scan panel)',
  );
  assert(
    clientSource.includes("if (!/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(ipAddress))"),
    'the IP must be validated before it is applied',
  );
  assert(
    clientSource.includes('IP 模式没有读回接口，能否连上只能靠「登录」验证') &&
      clientSource.includes('IP 模式没有读回接口，能不能连上只能靠随后点「登录」验证'),
    'the UI must say that IP mode cannot be verified from the workbench',
  );
}

// ── 11c. 更丰富的在线状态（OperatingState 位标志解码）──────────────────────
// ApplicationState 是单值枚举，OperatingState 是位标志。后者才是现场最需要的：
// 有没有 Force 生效、是不是做过在线修改、retain 是否不匹配、开机程序是否有效。
{
  const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { resultPrefix: 'r-' });
  assert(script.includes('def decode_states'), 'the worker must decode the device states');
  assert(script.includes('APPLICATION_STATE_LABELS') && script.includes('OPERATING_STATE_FLAGS'),
    'both the application state and the operating-state flag table must exist');
  for (const label of ['运行中（RUN）', '已停止（STOP）', '停在断点', '单周期']) {
    assert(script.includes(label), `the application state table must include ${label}`);
  }
  for (const label of ['有强制生效', '应用异常', '保持变量不匹配', '做过在线修改', '开机程序有效', '正在下载']) {
    assert(script.includes(label), `the flag table must include ${label}`);
  }
  assert(script.includes("OPERATING_STATE_WARNINGS = ('有强制生效', '应用异常', '保持变量不匹配')"),
    'the three warning flags must be called out separately');
  assert(script.includes('value.update(decode_states(application))'),
    'connection_state must merge the decoded states');

  assert(
    clientSource.includes('const onlineOperationFlags = Array.isArray(onlineState?.state?.operationFlags)') &&
      clientSource.includes('const onlineOperationWarnings = Array.isArray(onlineState?.state?.operationWarnings)'),
    'the workbench must read the decoded flags',
  );
  assert(
    clientSource.includes('`应用状态：${onlineAppLabel || \'（未登录，读不到）\'}`') &&
      clientSource.includes('`设备标志：${onlineOperationFlags.join(\' · \')}`'),
    'the tooltip must show the application state and the device flags',
  );
  assert(
    clientSource.includes("'data-codesys-online-state-text': 'true'") &&
      clientSource.includes('`⚠️ PLC ${onlineAppLabel || \'\'} · ${onlineOperationWarnings.join(\' · \')}`'),
    'a warning flag must be visible in the bottom status row, not only on hover',
  );
}

gateStage('s12-session-ceiling');
// ── 12. 常驻会话不得长生不老 ───────────────────────────────────────────────
// 客户端每 10 秒一次的 status 轮询曾经每次都续期 worker 的空闲计时器，导致那个
// 约 700 MB 的 CODESYS --noUI 进程永不退出（现场同时堆了 3 个实例）。修复：
// status 是纯读取，不续期；空闲上限也从 30 分钟降到 10 分钟。
{
  const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { resultPrefix: 'r-' });
  assert(script.includes("if command != 'status':\n                last_command_at = time.time()"),
    'a status poll must NOT renew the idle timer');
  assert(script.includes('MAX_IDLE_SECONDS = 600'), 'the idle ceiling must be ten minutes, not thirty');
  assert(isRegistered(mainSource, 'codesys:online-release') &&
    mainSource.includes("if (!isTrustedSender(event)) throw new Error('CODESYS 在线会话只能由 TaskHive 界面释放')") &&
    mainSource.includes("event: 'online-session-released'"),
    'there must be an explicit, audited way to release the worker');
  assert(preloadSource.includes('releaseCodesysOnline:'), 'preload must expose the release bridge');
  // 释放控件仍在，但跟着「在线目标」弹层的删除搬到了扫描面板头部（T112）。
  assert(clientSource.includes("'data-codesys-scan-release': 'true'") &&
    clientSource.includes('const releaseOnlineSession = async () => {'),
    'the workbench must offer a release control (now inside the scan panel)');
  assert(!clientSource.includes("'data-codesys-online-release': 'true'"),
    'the old popover-hosted release control must be gone');
  // 状态探测也走常驻在线进程的串行命令队列，和在线变量读值抢队列：所以已连接时
  // 8 秒一次（原来是 5 秒），未连接时 60 秒一次，页面不可见时一次都不发。
  assert(clientSource.includes('const timer = setInterval(tick, onlineConnected ? 8000 : 60000)'),
    'the status poll must be slow while nothing is connected');
  assert(/if \(cancelled \|\| onlineBusyRef\.current\) return\s+if \(typeof document/.test(clientSource) &&
    clientSource.includes("document.visibilityState === 'hidden'"),
    'the status poll must skip hidden pages');
}

  // ── 13. 模型侧仍然禁止一切在线动作 ─────────────────────────────────────────
const pathAuthorization = require(path.resolve(appRoot, 'app/codesys-path-authorization.js'));
assert.strictEqual(
  pathAuthorization.buildCodesysPathAuthorization({ sourceProjectPath: 'C:/plc/A.project' }).onlinePlcActions,
  'prohibited',
  'from the model-facing path authorization, every PLC online action stays prohibited',
);
assert(clientSource.includes('plcOnlineActionsForbidden: true'),
  'the state published to the harness session must keep advertising the model-side online prohibition');

// ── 11. 插件清单 ───────────────────────────────────────────────────────────
assert.strictEqual(pluginJson.scriptEngine.onlineActions.enabled, true);
assert.strictEqual(pluginJson.scriptEngine.onlineActions.requiresWorkbenchAuthorization, true);
assert.deepStrictEqual(pluginJson.scriptEngine.onlineActions.grantable, ONLINE);
assert.deepStrictEqual(pluginJson.scriptEngine.onlineActions.hardGated, HARD_GATED);
assert.deepStrictEqual(pluginJson.scriptEngine.onlineActions.unsupported, UNSUPPORTED);
assert(pluginJson.capabilities.includes('codesys.online.authorized'));

gateStage('s11-plugin-manifest');
gateCompleted = true;
process.stdout.write(
  `codesys online gate contract tests passed (总 ${Date.now() - gateStartedAt}ms · 分段 ${gateStages.join(' ')} · ` +
  `读重试 ${readRetries} 次 · 源码共 ${mainSource.length + preloadSource.length + clientSource.length + engineSource.length} 字符)\n`,
);
