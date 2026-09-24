const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class ModLensExecutor {
  constructor(root, options = {}) {
    this.root = root;
    this.packageRoot = path.join(root, 'plugins', 'installed', 'modlens');
    this.cli = path.join(this.packageRoot, 'dist', 'main.js');
    this.execFile = options.execFile || execFileAsync;
    this.processExecPath = options.processExecPath || process.execPath;
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.spawn = options.spawn || spawn;
    this.codexRunner = options.codexRunner || null;
  }

  installed() {
    return fs.existsSync(this.cli);
  }

  nodeOptions(options = {}) {
    return { ...options, env: { ...this.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } };
  }

  codexInvocation() {
    const configured = String(this.env.TASKHIVE_CODEX_BIN || '').trim();
    const candidate = configured || (this.platform === 'win32' && this.env.APPDATA
      ? path.join(this.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      : '');
    if (candidate && fs.existsSync(candidate) && path.extname(candidate).toLowerCase() === '.js') {
      return { command: this.processExecPath, prefix: [candidate], options: this.nodeOptions({ windowsHide: true }) };
    }
    if (configured) return { command: configured, prefix: [], options: { windowsHide: true, env: { ...this.env } } };
    return { command: this.platform === 'win32' ? 'codex.cmd' : 'codex', prefix: [], options: { windowsHide: true, env: { ...this.env }, shell: this.platform === 'win32' } };
  }

  async codexFallbackStatus(report) {
    const decision = report?.reuse?.decisions?.codex;
    const probe = (report?.reuse?.probes || []).find((item) => item.harness === 'codex');
    if (decision !== 'granted') return { ready: false, reason: 'reuse-not-granted' };
    if (!probe?.cliFound) return { ready: false, reason: 'codex-cli-missing' };
    if (probe.loggedIn === false) return { ready: false, reason: 'codex-auth-required' };
    try {
      const invocation = this.codexInvocation();
      const output = await this.execFile(invocation.command, [...invocation.prefix, 'exec', '--help'], { ...invocation.options, timeout: 15000, maxBuffer: 1024 * 1024 });
      const supportsImage = /(?:^|\s)(?:-i,\s*)?--image(?:\s|$)/m.test(`${output.stdout || ''}\n${output.stderr || ''}`);
      return { ready: supportsImage, reason: supportsImage ? null : 'codex-image-flag-missing', source: 'codex-exec-help', cliFound: true, loggedIn: probe.loggedIn !== false };
    } catch {
      return { ready: false, reason: 'codex-capability-probe-failed' };
    }
  }

  async doctor() {
    if (!this.installed()) return { installed: false, ready: false, version: null, providers: [] };
    const version = (await this.execFile(this.processExecPath, [this.cli, '--version'], this.nodeOptions({ windowsHide: true, timeout: 15000 }))).stdout.trim();
    const output = await this.execFile(this.processExecPath, [this.cli, 'doctor', '--json'], this.nodeOptions({ windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }));
    const report = JSON.parse(output.stdout);
    const readyProviders = (report.providers || []).filter((provider) => provider.ready).map((provider) => provider.name);
    const codexFallback = await this.codexFallbackStatus(report);
    if (codexFallback.ready && !readyProviders.includes('codex-cli')) readyProviders.push('codex-cli');
    return { installed: true, ready: readyProviders.length > 0, version, readyProviders, codexFallback, report };
  }

  parseCodexOutput(stdout) {
    let answer = '';
    let usage = null;
    for (const line of String(stdout || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      const item = event.item || event.message || event.result;
      if (item && (item.type === 'agent_message' || item.type === 'assistant_message')) answer += String(item.text || item.message || '');
      if (event.type === 'turn.completed' || event.type === 'turn/completed') usage = event.usage || event.turn?.usage || null;
    }
    const raw = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!raw) throw new Error('codex-empty-vision-result');
    let result;
    try { result = JSON.parse(raw); } catch { result = { summary: raw, observations: [], visibleText: [], uncertainties: ['Codex 返回了非结构化文本。'] }; }
    return { result, usage };
  }

  safeCodexError(error) {
    const text = String(error?.stderr || error?.stdout || error?.message || error).toLowerCase();
    if (/login|auth|unauthorized|credential|not authenticated|sign in/.test(text)) return 'Codex CLI 未认证，无法复用视觉能力。';
    if (/rate|quota|limit/.test(text)) return 'Codex CLI 当前达到速率或额度限制。';
    if (/image|vision|modality/.test(text)) return '当前 Codex 模型拒绝图像输入。';
    return 'Codex CLI 视觉调用失败。';
  }

  async runCodex(args, timeout = 200000) {
    if (this.codexRunner) return this.codexRunner(args);
    const invocation = this.codexInvocation();
    return new Promise((resolve, reject) => {
      const child = this.spawn(invocation.command, [...invocation.prefix, ...args], {
        ...invocation.options,
        cwd: this.root,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill(); } catch {}
        const error = new Error('codex-vision-timeout');
        error.stderr = stderr;
        reject(error);
      }, timeout);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 8 * 1024 * 1024) stdout = stdout.slice(-8 * 1024 * 1024); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 1024 * 1024) stderr = stderr.slice(-1024 * 1024); });
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) return resolve({ stdout, stderr });
        const error = new Error(`codex-vision-exit-${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      });
      child.stdin.end();
    });
  }

  async analyzeWithCodex({ path: imagePath, prompt, sha256 }) {
    const instruction = [
      'You are the low-trust vision provider reused by ModLens inside TaskHive.',
      'Inspect only the attached image. Do not call shell tools, write files, control CODESYS, or perform PLC actions.',
      'Return exactly one compact JSON object with keys summary, observations, visibleText, uncertainties, and safety.',
      'observations, visibleText, and uncertainties must be arrays of strings; safety must be {"lowTrust":true,"readOnly":true}.',
      prompt ? `Focus requested by the user: ${String(prompt).slice(0, 2000)}` : '',
    ].filter(Boolean).join('\n');
    const args = ['exec', instruction, '--json', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-C', this.root, '--image', imagePath];
    const output = await this.runCodex(args);
    const parsed = this.parseCodexOutput(output.stdout);
    return {
      trust: 'low',
      status: 'analyzed',
      screenshotSha256: sha256 || null,
      provider: 'codex-cli',
      route: 'modlens-codex-reuse',
      result: parsed.result,
      meta: { transport: 'codex exec --image', ephemeral: true, sandbox: 'read-only', usage: parsed.usage },
      analyzedAt: new Date().toISOString(),
    };
  }

  async analyze({ path: imagePath, prompt, sha256 }) {
    if (!this.installed()) return { trust: 'low', status: 'missing', message: 'ModLens 未安装。', screenshotSha256: sha256 || null };
    if (!imagePath || !fs.existsSync(imagePath)) throw new Error('截图文件不存在');
    let status;
    try {
      status = await this.doctor();
    } catch (error) {
      return { trust: 'low', status: 'provider-unavailable', message: 'ModLens provider 检查失败。', screenshotSha256: sha256 || null, analyzedAt: new Date().toISOString() };
    }
    const nativeProviders = (status.report?.providers || []).filter((provider) => provider.ready);
    if (nativeProviders.length > 0) {
      const args = [this.cli, '-i', imagePath, '--timeout', '180000'];
      if (prompt) args.push('--prompt', String(prompt));
      try {
        const output = await this.execFile(this.processExecPath, args, this.nodeOptions({ windowsHide: true, timeout: 200000, maxBuffer: 8 * 1024 * 1024 }));
        const parsed = JSON.parse(output.stdout);
        return { trust: 'low', status: 'analyzed', screenshotSha256: sha256 || null, provider: parsed.provider || null, route: 'modlens-native', result: parsed.result, meta: parsed.meta, analyzedAt: new Date().toISOString() };
      } catch {
        // Continue to the explicitly granted Codex reuse route when available.
      }
    }
    if (status.codexFallback?.ready) {
      try { return await this.analyzeWithCodex({ path: imagePath, prompt, sha256 }); }
      catch (error) { return { trust: 'low', status: 'provider-unavailable', message: this.safeCodexError(error), screenshotSha256: sha256 || null, analyzedAt: new Date().toISOString() }; }
    }
    return { trust: 'low', status: 'provider-unavailable', message: '没有可用的 ModLens 视觉 provider。', screenshotSha256: sha256 || null, analyzedAt: new Date().toISOString() };
  }
}

module.exports = { ModLensExecutor };
