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
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.resolve(appRoot, relative), 'utf8');

const authorization = require(path.resolve(appRoot, 'app/codesys-online-authorization.js'));
const engineModule = require(path.resolve(appRoot, 'plugins/installed/codesys-monitor/scriptengine.cjs'));
const sessionModule = require(path.resolve(appRoot, 'plugins/installed/codesys-monitor/online-session.cjs'));

const mainSource = read('app/main.js');
const preloadSource = read('app/preload.js');
const clientSource = read('plugins/installed/taskhive-surfaces/dsh/client.js');
const engineSource = read('plugins/installed/codesys-monitor/scriptengine.cjs');
const pluginJson = JSON.parse(read('plugins/installed/codesys-monitor/plugin.json'));

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
  assert.deepStrictEqual(armed.grant.capabilities, ONLINE, 'arming grants all nine');
  assert.strictEqual(store.snapshot().projectName, 'Line.project');
  assert.strictEqual(
    store.authorize({ capability: 'force', projectPath: 'c:/PLC/line.PROJECT', windowId: 'win-1' }).ok,
    true,
    'project comparison must be case-insensitive on Windows',
  );
  assert.strictEqual(
    store.authorize({ capability: 'reset', projectPath: 'C:/plc/Other.project' }).code,
    'CODESYS_ONLINE_PROJECT_MISMATCH',
  );
  assert.strictEqual(
    store.authorize({ capability: 'stop', projectPath: 'C:/plc/Line.project', windowId: 'win-2' }).code,
    'CODESYS_ONLINE_WINDOW_MISMATCH',
  );
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
  const auditPath = path.join(os.tmpdir(), `taskhive-online-audit-${process.pid}.jsonl`);
  try { fs.unlinkSync(auditPath); } catch { /* fresh */ }
  const store = authorization.createOnlineAuthorizationStore({ auditPath });
  store.arm({ projectPath: 'C:/plc/A.project', windowId: 'w' });
  store.confirmHardGate({ capability: 'force', phrase: 'x' });
  store.confirmHardGate({ capability: 'force', phrase: '强制变量' });
  store.disarm('done');
  const lines = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepStrictEqual(lines.map((item) => item.event), ['online-arm', 'online-hard-gate-confirmed', 'online-disarm']);
  assert(lines.every((item) => typeof item.at === 'string'), 'every audit entry must carry a timestamp');
  try { fs.unlinkSync(auditPath); } catch { /* best effort */ }
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

// ── 7. 主进程接线 ──────────────────────────────────────────────────────────
for (const channel of ['codesys:online-status', 'codesys:online-arm', 'codesys:online-disarm', 'codesys:online-scan', 'codesys:online-set-target', 'codesys:online-monitor', 'codesys:online-action']) {
  assert(mainSource.includes(`ipcMain.handle('${channel}'`), `${channel} must be registered`);
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

  const scanStart = mainSource.indexOf("ipcMain.handle('codesys:online-scan'");
  const scanEnd = mainSource.indexOf("ipcMain.handle('codesys:online-prepare'", scanStart);
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
  // 声明区自己标明在线值这档是活的/还是在等第一笔值。
  assert(clientSource.includes("'data-editor-online': valueByLine ? 'live' : 'idle',"),
    'the declaration section must show whether online values are live');
  assert(clientSource.includes('.taskhive-codesys-editor-online'),
    'the online-value marker must be styled');
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
  // 简单变量排在成员前面，60/90 条上限先保住它们。
  assert(clientSource.includes('const expressions = [...simple, ...members].slice(0, 90)'),
    'scalars must be requested before member probes so a cap never drops the easy values');
  // 值列：一个 map 存 "名字 -> 值"，声明区按行映射，实现区按"这一行引用了谁"映射。
  assert(clientSource.includes('const onlineValueByName = React.useMemo('),
    'values must be indexed by expression name once');
  assert(clientSource.includes('const onlineValueByLineImpl = React.useMemo('),
    'the implementation section must show values too');
  assert(clientSource.includes("const valueByLine = section.id === 'declaration' ? onlineValueByLine : (section.id === 'implementation' ? onlineValueByLineImpl : null)"),
    'both editor sections must be wired to their own per-line values');
  assert(clientSource.includes('parts.push(`${key.slice(lower.length + 1)}=${value}`)'),
    'an FB line must summarise its members (member=value)');
  assert(clientSource.includes('has-online-values'), 'the value column must still switch on per section');
  // 实现区更宽的值列。
  assert(clientSource.includes('[data-editor-section="implementation"].has-online-values'),
    'the implementation value column needs its own width');
}

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
  assert(mainSource.includes("ipcMain.handle('codesys:engine-freshness'"),
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

// ── 12. 常驻会话不得长生不老 ───────────────────────────────────────────────
// 客户端每 10 秒一次的 status 轮询曾经每次都续期 worker 的空闲计时器，导致那个
// 约 700 MB 的 CODESYS --noUI 进程永不退出（现场同时堆了 3 个实例）。修复：
// status 是纯读取，不续期；空闲上限也从 30 分钟降到 10 分钟。
{
  const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { resultPrefix: 'r-' });
  assert(script.includes("if command != 'status':\n                last_command_at = time.time()"),
    'a status poll must NOT renew the idle timer');
  assert(script.includes('MAX_IDLE_SECONDS = 600'), 'the idle ceiling must be ten minutes, not thirty');
  assert(mainSource.includes("ipcMain.handle('codesys:online-release'") &&
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

process.stdout.write('codesys online gate contract tests passed\n');
