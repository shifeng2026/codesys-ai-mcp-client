'use strict';

// CODESYS 在线会话的启动并发契约。
//
// 现场报错：
//   扫描失败：Error invoking remote method 'codesys:online-scan':
//   Error: EBUSY: resource busy or locked, open
//   '...\jobs\direct-...\online\online-worker.py'
//
// 根因是"确保会话存在"这件事没有在途合并：一次启动要 20–40 秒，而绑定工程后读目标的
// 后台准备、扫描按钮、登录按钮都会走到这里；`this.onlineSession` 又是在 start()
// 完成之后才赋值，于是这段窗口里第二次调用会再起一个 CODESYS，去写同一个目录里的
// **固定文件名** online-worker.py —— 而第一个 CODESYS 正把它开着。
//
// 这个契约钉住三件事：
//   1. 同一个 job 的并发 prepare 只会启动一个 worker；
//   2. 目录里的脚本 / 命令 / 就绪 / 进度 / 停止 / 结果（以及那份工程副本）都带运行令牌；
//   3. 启动期间被要求停止时，那个刚起来的会话会被收掉，而不是偷偷留在后台。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const appRoot = path.resolve(__dirname, '..');
const sessionModule = require(path.resolve(appRoot, 'plugins/installed/codesys-monitor/online-session.cjs'));
const { CodesysScriptEngine } = require(path.resolve(appRoot, 'plugins/installed/codesys-monitor/scriptengine.cjs'));
const engineSource = fs.readFileSync(path.resolve(appRoot, 'plugins/installed/codesys-monitor/scriptengine.cjs'), 'utf8');
const sessionSource = fs.readFileSync(path.resolve(appRoot, 'plugins/installed/codesys-monitor/online-session.cjs'), 'utf8');

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const roots = [];

// 一台"假 CODESYS"：它不执行任何东西，只按真实 worker 的约定**应答命令**（读命令文件、
// 写结果文件）并一直活着直到被 kill。这样会话生命周期、绑定回填这些都是真的，只有 PLC
// 和 CODESYS 是假的。
function makeFakeSpawner(pending = []) {
  const spawner = (exePath, args) => {
    const child = new EventEmitter();
    child.pid = 9000 + pending.length;
    child.exitCode = null;
    child.killed = false;
    child.commands = [];
    child.lastSeq = 0;
    const runscript = args.find((item) => item.startsWith('--runscript=')) || '';
    const scriptPath = runscript.replace(/^--runscript="?/, '').replace(/"$/, '');
    const workDir = path.dirname(scriptPath);
    const text = fs.readFileSync(scriptPath, 'utf8');
    const token = /RUN_TOKEN = "([^"]*)"/.exec(text)[1];
    const commandPath = path.join(workDir, `online-command${token}.json`);
    const timer = setInterval(() => {
      let payload = null;
      try { payload = JSON.parse(fs.readFileSync(commandPath, 'utf8')); } catch { return; }
      const seq = Number(payload?.seq) || 0;
      if (!seq || seq <= child.lastSeq) return;
      child.lastSeq = seq;
      child.commands.push(payload);
      const value = payload.command === 'set-target'
        ? { applied: 'address', requested: payload.args || {}, target: { address: payload.args?.address || '', deviceName: 'FakePLC' } }
        : { ok: true };
      try {
        fs.writeFileSync(path.join(workDir, `online-result${token}-${seq}.json`),
          JSON.stringify({ seq, ok: true, command: payload.command, value }), 'utf8');
      } catch { /* 目录被清理时忽略 */ }
    }, 15);
    const stopTimer = () => clearInterval(timer);
    child.kill = () => { stopTimer(); child.killed = true; child.exitCode = 0; child.emit('exit', 0, null); };
    pending.push({ scriptPath, token, child, workDir });
    setTimeout(() => {
      try {
        fs.writeFileSync(path.join(workDir, `online-ready${token}.json`), JSON.stringify({ ok: true, pid: child.pid }), 'utf8');
      } catch { /* 目录被清理时忽略 */ }
    }, 20);
    return child;
  };
  spawner.pending = pending;
  return spawner;
}

// 真的 CodesysScriptEngine，只把 CODESYS 安装探测换成假的；作业读写是真的（要验证
// "绑定跟着作业走"）。
function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-online-'));
  roots.push(root);
  const jobId = 'direct-1789962559760-4e86cd12';
  const jobDir = path.join(root, 'jobs', jobId);
  fs.mkdirSync(path.join(jobDir, 'snapshots'), { recursive: true });
  const projectPath = path.join(root, 'source.project');
  fs.writeFileSync(projectPath, 'fake project', 'utf8');
  const jobFile = path.join(jobDir, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify({ jobId, projectPath, currentSha256: '' }), 'utf8');

  const pending = [];
  const engine = new CodesysScriptEngine(root, { spawnProcess: makeFakeSpawner(pending), onlineLog: () => {} });
  engine.doctor = () => ({ ready: true, exePath: 'CODESYS.exe', profile: 'test-profile' });
  engine.jobPath = () => jobDir;
  const readJobFile = () => JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  engine.readJob = () => ({ job: readJobFile() });
  engine.writeJob = (file, job) => { fs.writeFileSync(file, JSON.stringify(job), 'utf8'); };
  return { engine, root, jobId, jobDir, jobFile, projectPath, pending };
}

async function main() {
  // ── 1. 同一个 job 的并发 prepare 只启动一次 ───────────────────────────────
  {
    const { engine, pending } = createHarness();
    const startedAt = Date.now();
    const results = await Promise.all([
      engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000),
      engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000),
      engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000),
    ]);
    assert.strictEqual(pending.length, 1,
      `three concurrent prepares must start exactly one CODESYS (started ${pending.length})`);
    for (const result of results) {
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.ready.pid, pending[0].child.pid, 'every caller must get the same worker');
    }
    // 会话已经在跑之后再问，仍然不能重启。
    const after = await engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000);
    assert.strictEqual(after.reused, true, 'a prepare after the session is up must reuse it');
    assert.strictEqual(pending.length, 1, 'reuse must not spawn a second CODESYS');
    // 三个并发调用共享同一个进程：总耗时应接近一次启动，而不是三次串联。
    assert(Date.now() - startedAt < 4000, 'the concurrent prepares must share one startup');
    await engine.stopOnlineSession('test');
  }

  // ── 2. 每个运行一个令牌：脚本与交换文件都不再是固定名字 ────────────────────
  {
    const script = sessionModule.buildOnlineWorkerScript('C:/tmp/w', 'C:/tmp/p.project', { runToken: '-deadbeefcafe' });
    assert(script.includes('RUN_TOKEN = "-deadbeefcafe"'), 'the worker must receive the run token');
    for (const marker of [
      "os.path.join(WORK, 'online-command' + RUN_TOKEN + '.json')",
      "os.path.join(WORK, 'online-ready' + RUN_TOKEN + '.json')",
      "os.path.join(WORK, 'online-progress' + RUN_TOKEN + '.json')",
      "os.path.join(WORK, 'online-stop' + RUN_TOKEN)",
    ]) {
      assert(script.includes(marker), `every exchange file must carry the token: ${marker}`);
    }
    assert(!/os\.path\.join\(WORK, 'online-(command|ready|progress|stop)'\)/.test(script),
      'no exchange file may keep a fixed name (a lingering worker would then execute our commands twice)');
  }

  // ── 3. 前一个会话的脚本"还开着"时，新会话必须完全不碰它 ────────────────────
  {
    const { engine, jobDir, pending } = createHarness();
    await engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000);
    const firstScript = pending[0].scriptPath;
    await engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000);
    assert.strictEqual(pending.length, 1, 'an idle-but-running session must be reused, not restarted');
    // 真正换绑（会话被停掉）之后再来一次：脚本名必须不同，否则就会 EBUSY。
    await engine.stopOnlineSession('rebind');
    await engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000);
    assert.strictEqual(pending.length, 2, 'a stopped session must be replaced');
    assert.notStrictEqual(pending[0].scriptPath, pending[1].scriptPath,
      'the two runs must not share a script filename — that fixed name is what caused EBUSY');
    assert.notStrictEqual(
      path.join(path.dirname(pending[0].scriptPath), `online-command${pending[0].token}.json`),
      path.join(path.dirname(pending[1].scriptPath), `online-command${pending[1].token}.json`),
      'command files must be per-run',
    );
    const projectCopies = fs.readdirSync(path.join(jobDir, 'snapshots')).filter((name) => name.endsWith('.project'));
    assert.strictEqual(projectCopies.length, 1,
      `only the current run's project copy may remain (found ${projectCopies.join(', ')})`);
    await engine.stopOnlineSession('test');
  }

  // ── 4. 启动期间被要求停止：收掉刚起来的会话，不留在后台 ────────────────────
  {
    const { engine, pending } = createHarness();
    const started = engine.prepareOnlineSession('direct-1789962559760-4e86cd12', 5000);
    await delay(5);
    await engine.stopOnlineSession('released-by-operator');
    await assert.rejects(started, (error) => error.code === 'CODESYS_ONLINE_START_SUPERSEDED',
      'a start that finished after a stop request must be discarded, not adopted');
    assert.strictEqual(engine.onlineSession, null, 'the discarded session must not be adopted');
    assert.strictEqual(pending.length, 1, 'the discarded session must have been spawned once');
    assert.strictEqual(pending[0].child.killed, true, 'the discarded session must actually be killed');
  }

  // ── 5. 绑定过的目标跟着作业走：进程重启后仍然是"已绑定" ──────────────────
  // 用户口径：「扫描设备绑定过设备之后应该把扫描设备变成已绑定，而不是登录的时候再
  // 弹出一个已连接单独提示」。所以绑定必须是**作业级状态**，不能只活在一次会话里。
  {
    const { engine, jobId, jobFile, pending } = createHarness();
    // 没有绑定过设备：登录/下载/在线修改必须先被拒绝（用户口径：「我都没有绑定设备
    // 为什么可以登录？明显不合理」——工程文件里配着目标不等于用户选过设备）。
    for (const action of ['online-login', 'online-download', 'online-change']) {
      await assert.rejects(
        engine.runOnlineAction(action, { jobId, onlineAuthorization: true }),
        (error) => error.code === 'CODESYS_ONLINE_TARGET_NOT_BOUND',
        `${action} must refuse before any device is bound`,
      );
    }
    assert.strictEqual(pending.length, 0, 'a refused action must not even start the online worker');

    // 没有会话时绑定：不能拒绝，要记下来。
    const deferred = await engine.onlineSetTarget({
      jobId, gatewayGuid: 'gw-1', gatewayName: 'Gateway', address: '0301.603A', source: 'scan',
    });
    assert.strictEqual(deferred.ok, true, 'binding without a running session must succeed');
    assert.strictEqual(deferred.deferred, true, 'it must be reported as deferred, not applied');
    assert.strictEqual(deferred.persisted, true, 'the binding must be persisted');
    const saved = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    assert.strictEqual(saved.onlineTargetOverride.address, '0301.603A', 'the job must remember the bound device');
    assert.strictEqual(saved.onlineTargetOverride.source, 'scan', 'the job must remember where the target came from');
    assert.strictEqual(fs.existsSync(path.join(path.dirname(jobFile), 'online', 'online-command.json')), false,
      'binding must not need a worker to exist');

    // 起一个会话：绑定必须被重新应用到新进程，并回填到 ready（界面据此显示"已绑定"）。
    const prepared = await engine.prepareOnlineSession(jobId, 5000);
    assert.strictEqual(prepared.ready.targetSource, 'scan', 'a fresh worker must report the bound target');
    assert.strictEqual(prepared.ready.boundTarget.address, '0301.603A', 'the ready payload must carry the bound target');
    assert.strictEqual(prepared.ready.target.address, '0301.603A', 'the worker must actually be retargeted');
    const applied = pending[0].child.commands.filter((command) => command.command === 'set-target');
    assert.strictEqual(applied.length, 1, 'the bound target must be applied exactly once to the new worker');
    assert.strictEqual(applied[0].args.address, '0301.603A');

    // 会话在跑时再绑定一次：立刻应用，并且同样落盘。
    const appliedNow = await engine.onlineSetTarget({ jobId, gatewayName: 'Gateway', address: '0301.9999', source: 'manual' });
    assert.strictEqual(appliedNow.appliedNow, true, 'with a live session the binding applies immediately');
    assert.strictEqual(appliedNow.running, true);
    // worker 自己回的 `applied`（name/address/ip）要给审计留着，不能被布尔标志盖掉。
    assert.strictEqual(appliedNow.applied, 'address', 'the worker\u2019s own "applied" wording must survive');
    const savedAgain = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    assert.strictEqual(savedAgain.onlineTargetOverride.address, '0301.9999');
    assert.strictEqual(savedAgain.onlineTargetOverride.source, 'manual');
    await engine.stopOnlineSession('test');

    // 新进程：必须换成最新那次绑定（不是第一次的）。
    await engine.prepareOnlineSession(jobId, 5000);
    assert.strictEqual(pending[1].child.commands.filter((command) => command.command === 'set-target')[0].args.address, '0301.9999',
      'a restarted worker must get the latest binding');
    await engine.stopOnlineSession('test');
  }

  // ── 6. 源码级：三个入口都必须走 ensureOnlineSession ────────────────────────
  {
    assert(engineSource.includes('async ensureOnlineSession(job, timeoutMs)'),
      'the engine must own a single "make sure a session exists" entry point');
    assert(engineSource.includes('const ensured = await this.ensureOnlineSession(job, timeoutMs)'),
      'prepareOnlineSession must go through it');
    assert(engineSource.includes('const opened = await this.ensureOnlineSession(job, input.timeoutMs)'),
      'runOnlineAction must go through it too — otherwise a login and a scan still race');
    assert(!/await this\.stopOnlineSession\('rebind'\);\s*\n\s*const opened = await this\.openOnlineSession\(/.test(engineSource),
      'the raw stop-then-open sequence must not come back');
    // 占坑必须在任何 await 之前，否则并发调用会一起穿过检查。
    assert(/const pending = \(async \(\) => \{[\s\S]{0,200}?\)\(\);\s*\n\s*this\.onlineSessionPending = pending;/.test(engineSource),
      'the in-flight slot must be claimed synchronously, before any await');
    assert(engineSource.includes("session.stop('superseded-start')"),
      'a superseded start must be stopped, not left running');
    assert(/child\.kill\(\)[\s\S]{0,700}?child\.once\?\.\('exit'/.test(sessionSource),
      'stop() must wait for the kill to land before a new session writes into the same folder');
  }

  console.log('codesys online session concurrency contract tests passed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const root of roots) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    // 假 CODESYS 的轮询计时器可能还活着（有的会话故意不 stop），显式退出，别让测试挂住。
    process.exit(process.exitCode || 0);
  });
