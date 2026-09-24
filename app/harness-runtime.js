const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function probe(url) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

// Read the installed DSH version from the slot payload. Falls back to the slot's
// own package.json, then to 'unknown' — never to a hardcoded literal.
function readSlotVersion(slotRoot) {
  const candidates = [
    path.join(slotRoot, 'payload', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    path.join(slotRoot, 'payload', 'package.json'),
    path.join(slotRoot, 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const version = JSON.parse(fs.readFileSync(candidate, 'utf8')).version;
      if (version) return String(version);
    } catch { /* try the next candidate */ }
  }
  return 'unknown';
}

class HarnessRuntime {
  constructor(root, options = {}) {
    this.root = root;
    this.process = null;
    this.starting = null;
    this.port = null;
    this.url = null;
    this.authUrl = null;
    this.authUrlResolve = null;
    this.startedAt = null;
    this.environment = options.environment && typeof options.environment === 'object' ? { ...options.environment } : {};
    const ownedSlot = path.join(root, 'harness', 'runtime', 'slot');
    this.slotRoot = process.env.TASKHIVE_DSH_SLOT
      ? path.resolve(process.env.TASKHIVE_DSH_SLOT)
      : ownedSlot;
    this.dshHome = options.dshHome ? path.resolve(options.dshHome) : path.join(root, 'profiles', 'dsh');
    const ownedPatch = path.join(this.dshHome, 'taskhive.patch.yml');
    this.patchPath = process.env.TASKHIVE_DSH_PATCH
      ? path.resolve(process.env.TASKHIVE_DSH_PATCH)
      : ownedPatch;
    this.binPath = path.join(this.slotRoot, 'payload', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    // The runtime version is a property of the installed slot. Hardcoding it
    // made every diagnostic lie after an upgrade, so it is read from the slot
    // that will actually be launched.
    this.runtimeVersion = readSlotVersion(this.slotRoot);
    this.seedProfileHome();
  }

  seedProfileHome() {
    const source = path.join(this.root, 'profiles', 'dsh', 'profiles', 'web');
    const destination = path.join(this.dshHome, 'profiles', 'web');
    fs.mkdirSync(destination, { recursive: true });
    if (!fs.existsSync(source) || path.resolve(source).toLowerCase() === path.resolve(destination).toLowerCase()) return;
    for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
      const from = path.join(source, name);
      const to = path.join(destination, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to);
    }
  }

  status() {
    return {
      owner: 'Harness/DSH',
      agentLoop: 'single',
      state: this.process && this.process.exitCode === null ? 'ready' : 'stopped',
      url: this.url,
      authUrl: this.authUrl,
      port: this.port,
      runtime: this.runtimeVersion,
      slotRoot: this.slotRoot,
      startedAt: this.startedAt,
    };
  }

  async start() {
    if (this.process && this.process.exitCode === null) return this.status();
    // Serialise concurrent starts. The previous guard was a check-then-await
    // race: two callers both passed it because `await reservePort()` happens
    // before `this.process` is assigned, so a second DSH server was spawned and
    // the first one leaked.
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async launch() {
    // The deadline has to cover a COLD start, not an average one. Measured on
    // this install (resources/app/logs/harness-runtime.log, 118 successful
    // readies): warm launches settle at ~4.2-4.6 s, while the first launch after
    // an idle gap is I/O-bound on the 244 MB / 31,767-file payload and takes
    // 44-86 s. The slow starts carry no child output at all, so they are cold
    // file-cache reads, not plugin-tree retries — every retry failure this log
    // has ever recorded also printed its stack between `launch` and `ready`.
    // At the old 90 s value the observed worst case (86.05 s) left under 4 % of
    // margin, and exceeding it produced the fatal
    //   Harness/DSH 运行时未能就绪（state=stopped）
    // recorded in errors.log. Doubling the default keeps the guard while making
    // it a real guard; TASKHIVE_DSH_START_TIMEOUT_MS still overrides it.
    const configuredTimeout = Number.parseInt(process.env.TASKHIVE_DSH_START_TIMEOUT_MS || '', 10);
    const readinessTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
      ? configuredTimeout
      : 180000;
    const launchStartedAt = Date.now();
    fs.appendFileSync(path.join(this.root, 'logs', 'harness-runtime.log'), `${new Date().toISOString()} launch slot=${this.slotRoot} bin=${this.binPath} electron=${process.execPath}\n`, 'utf8');
    if (!fs.existsSync(this.binPath)) throw new Error(`DSH runtime missing: ${this.binPath}`);
    this.port = await reservePort();
    fs.mkdirSync(this.dshHome, { recursive: true });
    // All Harness sessions use unrestricted file access. Feature-specific
    // safety gates (notably CODESYS offline-only writes) remain enforced by
    // their own bridges.
    const env = { ...process.env, ...this.environment, DSH_HOME: this.dshHome, TASKHIVE_ROOT: this.root, DSH_PERMISSION_MODE: 'danger-full-access' };
    // This line used to strip every `DEEPSEEK_*` key out of `env` — after
    // `this.environment` had already been merged in. That silently discarded the
    // credentials `main.js` passes through `apiCredentialEnvironment()` (see its
    // caller: "API keys live only in the main process; the Harness child receives
    // them as environment variables, which is the channel the adapter reads").
    // The child only ever appeared to work because `dsh-credentials-local`
    // resolves `env` first and then falls back to the on-disk `.credentials.yaml`
    // (`lib/index.js` `resolve(ref)`), so a file-sourced key masked the loss.
    // Credentials the user stores from the native Models page land as `env`
    // sources and are marked non-writable, so that channel MUST stay intact.
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    // `--expose-internals` is LOAD-BEARING, not a convenience flag: the DSH
    // profile boots its plugin tree through a resolver that depends on Node
    // internals. Without it every `insert` entry fails with
    //   Cannot find package '<plugin>' imported from cordis-plugin-loader
    // which aborts the whole `cordis:include` stage and the Harness process
    // exits, leaving the workbench page unloadable. Verified by removing it:
    // the smoke went from ok:true to a fatal plugin-tree failure. Do not drop
    // this flag without re-running `TaskHive.exe --smoke`.
    // Hold the child in a local binding as well as on the instance. `stop()` is
    // allowed to run while this launch is still waiting for readiness (the model
    // catalog refresh does exactly that), and it nulls `this.process`; reading
    // the child through the local binding keeps the readiness loop from
    // dereferencing null, and the superseded check below reports it honestly.
    const child = spawn(process.execPath, ['--expose-internals', this.binPath, '--profile', 'web', '--patch', this.patchPath, '--host', '127.0.0.1', '--port', String(this.port), '--no-open'], {
      cwd: this.dshHome,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process = child;
    // Without an 'error' listener a spawn failure (missing binary, EACCES on a
    // locked exec path) emits an unhandled 'error' event that kills the host.
    child.on('error', (error) => {
      fs.appendFileSync(path.join(this.root, 'logs', 'errors.log'), `${new Date().toISOString()} DSH spawn error ${error.stack || error}\n`, 'utf8');
    });
    const log = (chunk) => {
      const text = chunk.toString();
      fs.appendFileSync(path.join(this.root, 'logs', 'harness-runtime.log'), text, 'utf8');
      const match = text.match(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/);
      if (match) {
        this.authUrl = match[1].trim();
        this.url = this.authUrl;
        this.authUrlResolve?.(this.authUrl);
        this.authUrlResolve = null;
      }
    };
    child.stdout.on('data', log); child.stderr.on('data', log);
    this.startedAt = new Date().toISOString();
    this.url = `http://127.0.0.1:${this.port}/`;
    this.authUrl = null;
    const authUrlPromise = new Promise((resolve) => { this.authUrlResolve = resolve; });
    const deadline = launchStartedAt + readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (this.process !== child) throw new Error('DSH launch was superseded by a restart');
      if (child.exitCode !== null) throw new Error(`DSH exited before readiness (${child.exitCode})`);
      if (await probe(this.url)) {
        // DSH alpha releases print the authenticated URL just after the HTTP
        // listener becomes ready. Do not let Electron load the unauthenticated
        // root page, which renders only "authentication required".
        if (!this.authUrl) {
          await Promise.race([
            authUrlPromise,
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
        }
        fs.appendFileSync(path.join(this.root, 'logs', 'harness-runtime.log'), `${new Date().toISOString()} ready elapsedMs=${Date.now() - launchStartedAt} url=${this.url}\n`, 'utf8');
        return this.status();
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.stop();
    throw new Error(`DSH web runtime did not become ready within ${readinessTimeoutMs}ms`);
  }

  async stop() {
    // Clear the advertised URL as well: leaving it set made
    // harnessWorkbenchUrl() return a dead address after a failed start, so the
    // window loaded a blank page instead of reporting the failure.
    const clearAddress = () => { this.url = null; this.authUrl = null; this.port = null; };
    if (!this.process || this.process.exitCode !== null) { this.process = null; clearAddress(); return; }
    const pid = this.process.pid;
    if (process.platform === 'win32') {
      try { await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); } catch { /* process may have exited */ }
    } else this.process.kill('SIGTERM');
    this.process = null;
    clearAddress();
  }

  async restart() {
    // Wait for an in-flight start before stopping. Without this, `stop()` nulled
    // `this.process` while the readiness loop was still reading it, which
    // surfaced as "Cannot read properties of null (reading 'exitCode')" whenever
    // a model-catalog refresh landed during startup.
    if (this.starting) { try { await this.starting } catch { /* the original caller reports its own failure */ } }
    await this.stop();
    return this.start();
  }
}

module.exports = { HarnessRuntime };
