const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { repairPortableLinks } = require('./portable-links');

// This must run before loading TaskHive modules that may reach pnpm-managed
// dependencies. It makes both source and packaged launches survive a folder
// copy or rename without relying on the previous absolute junction targets.
repairPortableLinks(path.resolve(__dirname, '..'));

const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, clipboard, webContents, screen } = require('electron');
const { HarnessCore } = require('../harness/core');
const { PluginManager } = require('../plugins/manager');
const { CodesysWindowMonitor } = require('./windows-monitor');
const { RepositoryManager } = require('../repositories/manager');
const { statusAsync: claudeCodeStatusAsync } = require('./claude-code');
const { HarnessRuntime } = require('./harness-runtime');
const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs');
const { CodesysInputController } = require('./codesys-input');
const { CodesysNativeHost } = require('./codesys-native-host');
const { WebAiBridge } = require('./web-ai-bridge');
const { DirectoryStore } = require('./directory-store');
const { readJson, writeJson } = require('./atomic-json');
// T166：知识库导入/替换前的备份复用 plugins/ 与 repositories/ 共用的保留策略。
const { pruneBackups } = require('../plugins/catalog-shared');
const createProbes = require('./smoke/probes');
const { decideTrustedFrame, isAllowedWorkbenchNavigation: isAllowedWorkbenchNavigationUrl, isAppRendererFileUrl } = require('./ipc-trust');
const { generateDirectoryManifest, startDirectoryManifestWatcher } = require('./directory-manifest');
const { launchCodesysGui } = require('./codesys-launch');
const { CodesysWindowOwnership } = require('./codesys-window-ownership');
const { discoverCurrentCodesysProject } = require('./codesys-current-project');
const { CodesysLaunchedRegistry, classifyLaunchedInstance } = require('./codesys-launched-registry');
const { providerIdForModel, probePage, readAssistantState, stopGeneration, submitPrompt } = require('./web-ai-driver');
const { resolvePowerShell7, shellInvocation } = require('./terminal-shell');
const { buildCodesysPathAuthorization } = require('./codesys-path-authorization');
const { appendDiagnosticLog } = require('./diagnostic-log');
const {
  createOnlineAuthorizationStore,
  evaluateDownloadPreflight,
  evaluateAppActionPreflight,
  actionCapability,
} = require('./codesys-online-authorization');

app.setName('TaskHive');
if (process.platform === 'win32') app.setAppUserModelId('com.taskhive.desktop');
// Keep Chromium's disk cache from becoming a second, unbounded TaskHive data
// store. The cache is disposable; session logs and knowledge remain durable.
app.commandLine.appendSwitch('disk-cache-size', String(128 * 1024 * 1024));

const root = path.resolve(__dirname, '..');
// Single source of truth for the product version shown in messages and written
// to diagnostics. It previously drifted (a stale "1.1.1" literal survived while
// package.json said 1.1.0).
const APP_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.0.0'); } catch { return '0.0.0'; }
})();
const programRoot = app.isPackaged ? path.resolve(root, '..', '..') : root;
let runtimeRoot = root;
const isolatedSmokeRuntime = process.argv.includes('--smoke-isolated')
  ? String(process.env.TASKHIVE_RUNTIME_ROOT || '').trim()
  : '';
if (isolatedSmokeRuntime) app.setPath('userData', path.join(path.resolve(isolatedSmokeRuntime), 'electron-user-data'));
const { prepareStartupPaths, seedPortableProfile } = require('./startup-paths');
const startupPathLog = (message) => {
  try { appendDiagnosticLog(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} ${message}\n`); }
  catch { process.stderr.write(`${message}\n`); }
};
let startupPaths;
try {
  startupPaths = prepareStartupPaths(app, programRoot, { isolated: Boolean(isolatedSmokeRuntime), log: startupPathLog });
} catch (error) {
  startupPathLog(`startup-paths-error ${error.stack || error}`);
  dialog.showErrorBox('TaskHive 启动失败', `无法准备可写的用户目录：\n${error.message}`);
  app.exit(1);
}
const modelCatalogPath = path.join(root, 'profiles', 'model-catalog.json');
const browserPreferencesPath = path.join(root, 'profiles', 'browser-preferences.json');

// The catalog used to be written with a bare `writeFileSync` from seven separate
// call sites, which meant an interrupted save could truncate it and the next
// save would persist whatever was in memory. One helper, one atomic writer.
function saveModelCatalog() {
  writeJson(modelCatalogPath, modelCatalog);
  return modelCatalog;
}
const modelCatalog = {
  version: 2,
  directory: path.join(root, 'models'),
  defaultRoute: { providerId: 'codex-cli', modelId: 'gpt-5.5' },
  browserRoute: { providerId: 'web-ai', modelId: 'deepseek-web' },
  visibility: {},
  providers: [
    { id: 'codex-cli', name: 'Codex CLI', kind: 'codex-cli', state: 'ready', authentication: 'codex-login', custom: false, models: ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'] },
    // `deepseek-api` is deliberately absent. It shipped pointing at the public
    // api.deepseek.com while this install already talks to DeepSeek through its
    // own gateway route in the Harness settings document, so the picker showed
    // two near-identically named DeepSeek cards and users could not tell them
    // apart. See RETIRED_CATALOG_PROVIDER_IDS below for how an already-persisted
    // copy is dropped.
    // Anthropic's Messages API is not OpenAI-compatible, so it needs its own
    // adapter. `protocol: 'anthropic'` is what selects it; any user-added
    // endpoint can set the same field to get the Anthropic wire format.
    { id: 'anthropic-api', name: 'Anthropic API', kind: 'api', state: 'unconfigured', authentication: 'api-key', custom: false, protocol: 'anthropic', endpoint: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
    { id: 'ollama-local', name: 'Ollama 本地', kind: 'local', state: 'unconfigured', authentication: 'local-runtime', custom: false, models: ['qwen2.5-coder', 'deepseek-coder-v2'] },
    { id: 'claude-code', name: 'Claude Code', kind: 'cli', state: 'unconfigured', authentication: 'claude-login', custom: false, models: ['fable', 'opus', 'sonnet', 'haiku'] },
    { id: 'web-ai', name: '网页 AI', kind: 'web', state: 'unconfigured', authentication: 'user-managed-browser-session', custom: false, models: ['deepseek-web', 'kimi-web', 'doubao-web', 'yuanbao-web', 'qwen-web', 'chatgpt-web', 'claude-web', 'gemini-web'] },
    { id: 'video-local', name: '本地视频模型', kind: 'video', state: 'unconfigured', models: ['video-generation-local'] },
  ],
};
// `ensureLayout()` runs at module load, which is before the process-level error
// handlers are registered. A throw there killed the process with no window, no
// dialog and no log — for example when the install directory is read-only.
function reportBootstrapProblem(detail) {
  const line = `${new Date().toISOString()} bootstrap ${detail}\n`;
  try { appendDiagnosticLog(path.join(root, 'logs', 'errors.log'), line); } catch {
    try { process.stderr.write(line); } catch { /* nowhere left to report */ }
  }
}

const ensureLayout = () => {
  try {
    for (const relative of ['app', 'harness', 'plugins/installed', 'plugins/staging', 'plugins/backups', 'knowledge/repositories', 'knowledge/staging', 'knowledge/backups', 'knowledge/index', 'knowledge/reviews', 'models', 'video-models', 'workspaces', 'workspaces/harness-default', 'profiles', 'profiles/dsh', 'profiles/dsh/profiles/web', 'cache', 'logs']) fs.mkdirSync(path.join(root, relative), { recursive: true });
  } catch (error) {
    // Keep going with whatever exists: the app is still usable if the runtime
    // directories are already present and only later writes fail.
    reportBootstrapProblem(`layout unavailable: ${error.message}`);
  }
  // Provider ids that were shipped once and are withdrawn. A persisted catalog
  // is merged below, so dropping the seed entry alone would not be enough: an
  // install that already wrote `deepseek-api` to
  // `profiles/model-catalog.json` would keep showing it forever. Any stored copy
  // is filtered out on load, which also removes it from the next write.
  // 用户的删除要求（2026-10）：ModLens 插件整体删除，所以 `modlens-vision` 也要从
  // 已持久化的目录里摘掉 —— 否则 profiles/model-catalog.json 里那一行会永远留在模型
  // 选择器的「视觉」分组里，指着一个不再存在的插件。加在这里而不是只删种子项，正是因为
  // 合并逻辑在下面会把存盘目录覆盖进来。
  const RETIRED_CATALOG_PROVIDER_IDS = new Set(['deepseek-api', 'modlens-vision'])
  // A missing catalog is a first run; a damaged one is quarantined and recovered
  // from the last good generation, and either way the problem is reported. The
  // old code treated both cases as "first run" and then immediately re-saved,
  // which is how a corrupt file silently turned into a wiped catalog.
  const savedCatalog = readJson(modelCatalogPath, null, {
    label: '模型目录 profiles/model-catalog.json',
    onProblem: (message) => reportBootstrapProblem(message),
  });
  if (savedCatalog?.defaultRoute && Array.isArray(savedCatalog.providers)) {
    Object.assign(modelCatalog, { ...savedCatalog, providers: savedCatalog.providers.filter((provider) => !RETIRED_CATALOG_PROVIDER_IDS.has(provider?.id)) });
  }
  for (const provider of [
    { id: 'claude-code', name: 'Claude Code', kind: 'cli', state: 'unconfigured', models: ['fable', 'opus', 'sonnet', 'haiku'] },
    { id: 'anthropic-api', name: 'Anthropic API', kind: 'api', state: 'unconfigured', authentication: 'api-key', protocol: 'anthropic', endpoint: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
    { id: 'web-ai', name: '网页 AI', kind: 'web', state: 'unconfigured', models: ['deepseek-web', 'kimi-web', 'doubao-web', 'yuanbao-web', 'qwen-web', 'chatgpt-web', 'claude-web', 'gemini-web'] },
    { id: 'video-local', name: '本地视频模型', kind: 'video', state: 'unconfigured', models: ['video-generation-local'] },
  ]) if (!modelCatalog.providers.some((item) => item.id === provider.id)) modelCatalog.providers.push(provider);
  const claude = modelCatalog.providers.find((item) => item.id === 'claude-code');
  // Re-asserted every boot so a catalog edited by hand cannot drop a family the
  // CLI offers. Aliases, not pinned ids: `claude --model <alias>` resolves to the
  // current model of that family.
  if (claude) claude.models = ['fable', 'opus', 'sonnet', 'haiku'];
  const webAi = modelCatalog.providers.find((item) => item.id === 'web-ai');
  if (webAi) webAi.models = ['deepseek-web', 'kimi-web', 'doubao-web', 'yuanbao-web', 'qwen-web', 'chatgpt-web', 'claude-web', 'gemini-web'];
  const codex = modelCatalog.providers.find((item) => item.id === 'codex-cli');
  // Re-asserted every boot so a hand-edited catalog keeps exactly the routes the
  // Codex CLI's own picker offers (GPT-6 family, older 5.6 family, legacy 5.5).
  if (codex) { codex.state = 'ready'; codex.models = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']; }
  // Keep the built-in HTTP providers self-describing. Without this the settings
  // UI shows an empty address and readiness depends on a hardcoded fallback
  // instead of the stored configuration.
  for (const [id, defaults] of Object.entries({
    'deepseek-api': { protocol: 'openai', endpoint: 'https://api.deepseek.com', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    'anthropic-api': { protocol: 'anthropic', endpoint: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  })) {
    const provider = modelCatalog.providers.find((item) => item.id === id);
    if (!provider) continue;
    for (const [key, value] of Object.entries(defaults)) if (!provider[key]) provider[key] = value;
  }
  modelCatalog.version = 2;
  modelCatalog.visibility = modelCatalog.visibility && typeof modelCatalog.visibility === 'object' ? modelCatalog.visibility : {};
  modelCatalog.browserRoute = modelCatalog.browserRoute || { providerId: 'web-ai', modelId: 'deepseek-web' };
  for (const provider of modelCatalog.providers) {
    provider.custom = provider.custom === true;
    provider.authentication ||= provider.kind === 'web' ? 'user-managed-browser-session' : provider.kind === 'local' ? 'local-runtime' : provider.kind === 'api' ? 'api-key' : 'local-cli';
    for (const modelId of provider.models || []) {
      const key = `${provider.id}::${modelId}`;
      if (modelCatalog.visibility[key] === undefined) modelCatalog.visibility[key] = !['vision', 'video'].includes(provider.kind);
    }
  }
  if (modelCatalog.defaultRoute.providerId === 'codex-cli' && !codex?.models.includes(modelCatalog.defaultRoute.modelId)) modelCatalog.defaultRoute = { providerId: 'codex-cli', modelId: 'gpt-5.5' };
  try {
    saveModelCatalog();
  } catch (error) {
    // The in-memory catalog is authoritative for this session, so a read-only
    // install can still run; the write is only persistence.
    reportBootstrapProblem(`model-catalog not persisted: ${error.message}`);
  }
};

// A copied/renamed packaged client can inherit DSH storage from the previous
// install.  DSH treats the persisted workspace path as authoritative and
// calls opendir() on it; leaving the old release path here makes every
// workspace-dependent surface (including Terminal) fail with ENOENT.  Repair
// only the known generated default workspace entry and preserve a timestamped
// backup before changing user state.
//
// IMPORTANT: only repair a path that is genuinely gone. Sibling installs
// (TaskHive1.0.1 / 1.0.2 / 1.0.3) share `%APPDATA%\TaskHive`, so rewriting a
// path that still exists made every version stamp its own
// `resources\app\workspaces\harness-default` over the others on each launch —
// `workspace-path-repair.log` recorded 14 such rounds. That thrash is what
// breaks a harness upgrade: the profile's workspace identity changes under a
// running client. Leaving live paths alone stops it.
function repairPersistedDefaultWorkspacePaths(runtimeRootPath) {
  const desired = path.resolve(root, 'workspaces', 'harness-default');
  const dshRoot = path.resolve(runtimeRootPath, 'profiles', 'dsh');
  const files = [path.join(dshRoot, 'storages', 'workspace.json'), path.join(dshRoot, 'storages', 'session_projcache.json')];
  const staleDefault = /(?:[A-Za-z]:\\|\\\\)[^"\r\n]*\\resources\\app\\workspaces\\harness-default$/i;
  let keptLive = 0;
  const replace = (value) => {
    if (typeof value !== 'string' || !staleDefault.test(value)) return value;
    if (path.resolve(value).toLowerCase() === desired.toLowerCase()) return value;
    if (fs.existsSync(value)) { keptLive += 1; return value; }
    return desired;
  };
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') { for (const key of Object.keys(value)) value[key] = walk(value[key]); return value; }
    return replace(value);
  };
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      const original = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(original);
      const repaired = JSON.stringify(walk(parsed), null, 2) + '\n';
      if (repaired === original) continue;
      const backup = `${file}.taskhive-path-backup-${Date.now()}`;
      fs.copyFileSync(file, backup);
      fs.writeFileSync(file, repaired, 'utf8');
      fs.appendFileSync(path.join(root, 'logs', 'workspace-path-repair.log'), `${new Date().toISOString()} repaired=${file} backup=${backup} desired=${desired}\n`, 'utf8');
    } catch (error) {
      reportBootstrapProblem(`workspace-path-repair failed=${file} error=${error?.stack || error}`);
    }
  }
  if (keptLive) fs.appendFileSync(path.join(root, 'logs', 'workspace-path-repair.log'), `${new Date().toISOString()} kept-live-paths=${keptLive} (a sibling TaskHive install owns them; not rewriting)\n`, 'utf8');
  try { fs.mkdirSync(desired, { recursive: true }); } catch (error) { reportBootstrapProblem(`default workspace unavailable: ${error.message}`); }
}

// `%APPDATA%\TaskHive\runtime` is shared by every TaskHive install because the
// app name is identical, but the DSH home it contains is written by whichever
// version launches. Record the owning version so an upgrade (or a second
// install) is diagnosable instead of silently fighting over the same files.
function noteRuntimeOwner(runtimeRootPath) {
  const marker = path.join(runtimeRootPath, 'runtime-owner.json');
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch { /* first run */ }
  const current = {
    version: APP_VERSION,
    root,
    runtimeRoot: runtimeRootPath,
    dshVersion: harnessSlotVersion(),
    lastStartedAt: new Date().toISOString(),
  };
  try { fs.writeFileSync(marker, `${JSON.stringify(current, null, 2)}\n`, 'utf8'); } catch (error) { reportBootstrapProblem(`runtime-owner not persisted: ${error.message}`); }
  if (previous && String(previous.root || '').toLowerCase() !== String(root).toLowerCase()) {
    // Do not migrate or rewrite anything: the other install may still own live
    // sessions. Just make the situation visible in the log.
    fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} shared-runtime-warning otherInstall=${previous.root} otherVersion=${previous.version} thisVersion=${APP_VERSION}; run only one TaskHive install at a time\n`, 'utf8');
  }
  return { current, previous };
}

// The slot manifest and the slot payload are produced by different steps. When
// they disagree, whatever the manifest claims about gates, promotion or hashes
// is about a different tree than the one being launched — which is exactly how
// T040's "verified" runtime ended up shipping a manifest that declared itself
// blocked. Report every mismatch instead of trusting the manifest.
function assertHarnessSlotConsistency(runtimeRootPath) {
  const slotRoot = path.join(root, 'harness', 'runtime', 'slot');
  const problems = [];
  const payloadVersion = harnessSlotVersion(slotRoot);
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(slotRoot, 'manifest.json'), 'utf8')); } catch (error) { problems.push(`manifest unreadable: ${error.message}`); }
  if (!payloadVersion || payloadVersion === 'unknown') problems.push('payload DSH version is unreadable');
  if (manifest) {
    if (manifest.source?.version && payloadVersion && manifest.source.version !== payloadVersion) {
      problems.push(`manifest source.version=${manifest.source.version} but payload is ${payloadVersion}`);
    }
    if (!manifest.payload?.sha256) problems.push('manifest payload.sha256 is unset');
    if (!manifest.closure?.sha256) problems.push('manifest closure.sha256 is unset');
    if (manifest.sbom?.stale === true) problems.push('manifest SBOM is marked stale');
    if (manifest.gates?.electronSmoke !== 'passed') problems.push(`manifest electronSmoke gate is "${manifest.gates?.electronSmoke}"`);
  }
  if (!fs.existsSync(path.join(slotRoot, 'payload', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) problems.push('DSH bin.js is missing from the slot payload');
  const summary = { dshVersion: payloadVersion, runtimeRoot: runtimeRootPath, problems, at: new Date().toISOString() };
  try { fs.writeFileSync(path.join(root, 'logs', 'harness-slot-check.json'), JSON.stringify(summary, null, 2), 'utf8'); } catch { /* diagnostics only */ }
  if (problems.length) {
    harness?.append?.('harness.slot.inconsistent', summary);
    try {
      fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} harness-slot-consistency ${problems.join(' | ')}\n`, 'utf8');
      fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} harness-slot-version=${payloadVersion} problems=${problems.length}\n`, 'utf8');
    } catch { /* logging is best effort */ }
  }
  return summary;
}

// The DSH version is a property of the slot that is actually installed, not of
// the app source. Reading it here keeps diagnostics honest across upgrades and
// lets the startup check below detect a slot/manifest mismatch.
function harnessSlotVersion(slotRoot = path.join(root, 'harness', 'runtime', 'slot')) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(slotRoot, 'payload', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version || '');
  } catch {
    try { return String(JSON.parse(fs.readFileSync(path.join(slotRoot, 'package.json'), 'utf8')).version || ''); } catch { return ''; }
  }
}

// Upstream `dsh-session-persistence-jsonl` imports the POSIX-only `fs-ext`
// native addon at module scope. That addon is never built on Windows, so the
// Harness refuses to boot with
//   Cannot find module './build/Release/fs_ext.node'
// Its Windows lock path uses a native semaphore and never calls POSIX flock(),
// so the import is replaced with an explicit throw. That edit lives inside the
// pnpm store, which any `pnpm install` silently reverts — so it is re-applied
// on every launch, the same way repairPortableLinks() survives a folder copy.
const FS_EXT_IMPORT = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*["']fs-ext["']\s*;?[ \t]*$/m;
const FS_EXT_MARKER = 'POSIX flock is unavailable in this Windows TaskHive runtime';
function repairHarnessRuntimeFsExt(runtimeDir) {
  const pnpmRoot = path.join(runtimeDir, 'slot', 'payload', 'node_modules', '.pnpm');
  let entries = [];
  try { entries = fs.readdirSync(pnpmRoot, { withFileTypes: true }); } catch { return; }
  let repaired = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('@deepseek-ai+dsh-session-pe')) continue;
    const target = path.join(pnpmRoot, entry.name, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js');
    let source = '';
    try { source = fs.readFileSync(target, 'utf8'); } catch { continue; }
    if (source.includes(FS_EXT_MARKER)) continue;
    const match = source.match(FS_EXT_IMPORT);
    if (!match) continue;
    // Honour `flock as flockFn` aliases so the stub keeps the local binding name.
    const bindings = String(match[1] || '').split(',').map((part) => {
      const pieces = part.trim().split(/\s+as\s+/);
      return pieces[pieces.length - 1].trim();
    }).filter(Boolean);
    const names = bindings.length ? bindings : ['flock'];
    const stub = names.map((name) => `const ${name} = () => {\n\tthrow new Error(${JSON.stringify(FS_EXT_MARKER)});\n};`).join('\n');
    try {
      fs.writeFileSync(target, source.replace(FS_EXT_IMPORT, stub), 'utf8');
      repaired += 1;
    } catch (error) {
      reportBootstrapProblem(`harness fs-ext patch failed (${target}): ${error.message}`);
    }
  }
  if (repaired) reportBootstrapProblem(`harness fs-ext patch re-applied to ${repaired} file(s)`);
}

ensureLayout();
repairHarnessRuntimeFsExt(path.join(root, 'harness', 'runtime'));
const terminalShell = resolvePowerShell7();
process.env.DSH_SIDEBAR_SHELL = terminalShell.command;
process.env.TASKHIVE_TERMINAL_SHELL_VERSION = terminalShell.version;
let mainWindow;
let harness;
let pluginManager;
let monitor;
let codesysWindowOwnership;
let repositories;
let codesysScriptEngine;
let codesysInput;
let codesysNativeHost;
let codesysLastDetectedProject = null;
// CODESYS instances this app launched, remembered across restarts so an exit
// (or the next start after a crash) can close them instead of leaving them in
// the background forever.
let codesysLaunchedRegistry = null;
// Short-lived memo for codesys:current-project. Each probe spawns a PowerShell
// window enumeration plus a CODESYS options scan (measured: ~2 s, during which
// the main process is busy — that is what the operator feels as "点一下别的界面
// 就停顿刷新"). So the workbench's follow-up polls (focus, surface switch) must
// not repeat that work — while an explicit user refresh always probes fresh.
const CODESYS_CURRENT_PROJECT_TTL_MS = 45000;
let codesysCurrentProjectCache = { at: 0, key: '', value: null };
let codesysCurrentProjectInFlight = null;
// 主进程只在启动时加载代码：界面（插件 JS）刷新一次就是新的，但 `app/main.js`、
// `scriptengine.cjs`、`online-session.cjs` 改了必须**重启 TaskHive** 才生效。
// 现场因此连着踩了两次："界面已经是新的、引擎还是旧的"，表现是旧写法（例如固定名
// online-worker.py）的报错。这里在启动时记下这几个文件的 mtime，并开一个**新通道**
// 让界面自检：通道不存在 ⇒ 主进程比界面旧；文件 mtime 变了 ⇒ 引擎代码已经更新但
// 还没重启。两种情况都提示用户重启，而不是让人对着旧引擎的报错猜。
const CODESYS_ENGINE_FILES = [
  'app/main.js',
  'app/preload.js',
  'plugins/installed/codesys-monitor/scriptengine.cjs',
  'plugins/installed/codesys-monitor/online-session.cjs',
];
const codesysEngineLoadedAt = Date.now();
const codesysEngineLoadedMtimes = new Map();
for (const relative of CODESYS_ENGINE_FILES) {
  try { codesysEngineLoadedMtimes.set(relative, fs.statSync(path.join(root, relative)).mtimeMs); } catch { /* 文件缺失时按 0 处理 */ }
}
function codesysEngineFreshness() {
  const changed = [];
  for (const relative of CODESYS_ENGINE_FILES) {
    try {
      const current = fs.statSync(path.join(root, relative)).mtimeMs;
      if (current !== codesysEngineLoadedMtimes.get(relative)) changed.push(relative);
    } catch { /* 读不到就不算变化 */ }
  }
  return {
    ok: true,
    loadedAt: new Date(codesysEngineLoadedAt).toISOString(),
    loadedAtMs: codesysEngineLoadedAt,
    stale: changed.length > 0,
    changed,
    // 这个字段本身就是"主进程是新的"的证据：界面拿得到它，说明通道存在。
    engineFreshnessChannel: 'codesys-engine-freshness-v1',
  };
}
let directoryStore;
let harnessRuntime;
let webAiBridge;
let splashWindow;
const codesysFixtureWindows = [];
let pluginSurfaceView;
// T143：由 **DSH 客户端插件自渲染**的 surface 名单 —— 宿主不得再挂原生插件视图，
// 否则那层原生 WebContentsView 会盖住 DSH 视图（知识库"经常性空白"的根因）。
const DSH_RENDERED_SURFACES = new Set(['knowledge']);// Keep one embedded renderer alive for the lifetime of the desktop window.
// Surface switches are message-driven after the first load so CODESYS DOM,
// native-host state and the last monitor frame are not destroyed/recreated.
let pluginSurfaceLoaded = false;
let webAiView;
const webAiViews = new Map();
let activeWebAiViewId = null;
let webAiWindowSequence = 0;
let webAiAttached = false;
let webAiBridgeState = { state: 'idle', model: null, code: null };
let lastWebAiSubmitProbe = null;
let pluginSurfaceKind = null;
let pluginSurfaceBounds = null;
let lastSurfaceGeometry = null;
let pluginSurfaceAttached = false;
let codesysPreferredWindowId = '';
// T208：**用户显式选择过的那一个窗口**（主进程侧的唯一记录）。
//
// 只有 `codesys:preferred-window`（面板下拉的 `list.onchange`，用户真的点了一下）会写它，
// `automatic` 恒为 `false`；清空选择时一起置 `null`。它是"外部启动的窗口能不能绑进
// 「代码任务」工作台"的**唯一**授权凭据 —— 由主进程自己记、自己读，构造凭据时不看请求体里
// 的任何字段（T207 那种 per-request `explicitSelection: true` 只服务于原生托管，与此无关），
// 所以渲染层声明不出一个能用的凭据来。值形状：`{ windowId, source, automatic:false, at }`。
let codesysExplicitWindowSelection = null;
// Online (PLC) authorization for the workbench. It is the single authority for
// login/logout/download; `online-change`, variable writes, start/stop/reset,
// debugging, breakpoints, stepping and Force are not grantable at all.
const codesysOnlineAuthorization = createOnlineAuthorizationStore({
  auditPath: path.join(root, 'logs', 'codesys-online.jsonl'),
});
let codesysNativeLocalBounds = null;
// Tracks whether the operator has explicitly switched AI input on for a
// specific CODESYS window. The renderer's own flag is presentation only; this
// is the authoritative gate for `codesys:input-direct`, which auto-approves.
// T164：`codesysInputArm`（"AI 操作"武装状态）随遥控能力一起删除；输入门不再存在。
let codesysNativeMoveTimer = null;
let quitting = false;
let quitCleanupDone = false;
let closePromptInFlight = false;
// Both the desktop shell (`pluginSurfaceView`, which loads app/renderer) and
// the embedded Harness document (`mainWindow`) carry `preload.js`. Every
// privileged IPC handler must confirm the sender is one of those two frame
// trees; otherwise any page that ends up in a preload-bearing context keeps
// the `window.taskhive` bridge and can drive the terminal, the CODESYS native
// input path or the workspace services.
//
// Matching the WebContents alone is not enough. It accepts ANY frame of that
// WebContents and ANY document that happens to be loaded in it, so the check
// also pins the exact frame and origin:
//   * the top frame only — `preload.js` runs in the main frame (this app never
//     sets `nodeIntegrationInSubFrames`), so a privileged call arriving from a
//     child frame can only be a forged one. Electron documents `senderFrame` as
//     the check to make for exactly this reason;
//   * the Harness document must be the origin of THIS launch's runtime, not any
//     loopback port — a local process on another port must not inherit the
//     bridge;
//   * the shell document must be the app's own `app/renderer` file tree, not an
//     arbitrary `file://` path — otherwise a downloaded HTML file opened in the
//     shell window would inherit the terminal and credential APIs.
//
// The trust decision itself lives in `./ipc-trust` so it can be tested without
// booting Electron (see tests/ipc-trust-contract.js). This adapter answers only
// the part that genuinely needs the live Electron objects: which of my two
// preload-bearing windows sent this?
//
// The Harness origin is read live rather than cached at startup: a runtime
// restart (for example after a model credential changes) can move it to a new
// port, and a cached origin would then reject every legitimate call.
function senderWindowFor(event, { allowHarness = true, allowShell = true } = {}) {
  const sender = event?.sender;
  if (!sender) return 'unknown';
  if (allowShell && pluginSurfaceView && !pluginSurfaceView.webContents.isDestroyed() && sender === pluginSurfaceView.webContents) return 'shell';
  if (allowHarness && mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents) return 'harness';
  return 'unknown';
}

// T193：`isTrustedSender` 的判定结果**带上原因**（`decideTrustedFrame` 本来就返回 reason，
// 以前在这一层被 `.trusted` 丢掉），这样拒绝日志里能区分 unknown-window / not-top-frame /
// harness-origin-mismatch / shell-origin-not-app-renderer。
function trustedFrameDecision(event, options) {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed?.()) return { trusted: false, reason: 'sender-destroyed-or-missing' };
  const frame = event?.senderFrame || null;
  return decideTrustedFrame({
    senderWindow: senderWindowFor(event, options),
    frameUrl: frame ? String(frame.url || '') : '',
    isTopFrame: Boolean(frame && frame === sender.mainFrame),
    harnessRuntimeUrl: harnessRuntime?.url || '',
    rendererRoot: path.join(__dirname, 'renderer'),
  });
}

function isTrustedSender(event, options) {
  return trustedFrameDecision(event, options).trusted;
}

// A privileged call from an unexpected frame/origin is recorded before it is
// rejected, so "the UI did nothing" always leaves a trace to debug from.
//
// T193：拒绝**必须自带原因**。真机上 2604 条 `blocked-ipc` 只写了通道与帧，看不出到底是
// "isTrustedSender 不认这个窗口"还是"面板专属门说它不是面板"，于是"又拦错了"要重新做一遍
// 同样的排查。第三个参数 `reason` 由调用点给出，`extra` 带上判定用的原始事实（期望身份、
// 当时的 surface 标志、帧是不是顶层……），下次一眼就能看出是哪一道闸、为什么。
function reportUntrustedIpc(channel, event, reason, extra) {
  try {
    const frame = event?.senderFrame || null;
    const detail = {
      channel,
      sender: event?.sender?.id ?? null,
      frameUrl: frame ? String(frame.url || '') : '(no frame)',
      mainFrameUrl: (() => { try { return String(event?.sender?.mainFrame?.url || ''); } catch { return '(unavailable)'; } })(),
      harnessRuntimeUrl: harnessRuntime?.url || '(not running)',
      ...(reason ? { reason: String(reason) } : {}),
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
    fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} blocked-ipc ${JSON.stringify(detail)}\n`, 'utf8');
  } catch { /* diagnostics must never mask the rejection */ }
}

// Every privileged channel is registered through this wrapper, so the sender is
// verified once in one place instead of being repeated (or forgotten) per
// handler. `terminal:*`, `models:set-credential`, `plugins:install`,
// `repositories:install` and `settings:directory-save` used to run with no
// sender check at all.
//
// `ipcMain.handle`/`ipcMain.on` are captured here as bound references so the
// registration sites can be rewritten mechanically without these wrappers
// matching themselves.
const ipcMainHandle = ipcMain.handle.bind(ipcMain);
const ipcMainOn = ipcMain.on.bind(ipcMain);

// T166：**只有 TaskHive 自己的 CODESYS 面板会调用**的通道，在这里集中登记身份门。
//
// 为什么不是 `allowHarness: false`：那只能排除 harness 帧这一层，而**工作台（DSH 客户端插件）
// 本身就在 DSH 文档里** —— 其中 13 个通道只有它能用（如 `apply-and-build` 的"确认写入"），
// 给它们加 `allowHarness:false` 会把工作台弄坏。发送方身份判定精确得多：要求 sender 就是
// CODESYS 面板那个原生 surface，于是 DSH 文档里的**任何**代码（包括 AI 装/写的插件）都被排除。
//
// 名单的确定方式是**逐个查调用方**：preload 方法名在外壳 `renderer.js` 与 DSH 客户端
// bundle 里各出现几次。只在外壳出现的 → 登记在这里；两边都用的（`code-ai-request`、
// `workbench-open`）与只有 DSH 用的（13 个）**一律不动**。
const CODESYS_PANEL_ONLY_CHANNELS = new Set([
  'codesys:ai-chat',
  // T174：AI 对话改成"外壳面板渲染 + DSH 侧只做数据桥"之后新增的两个**数据**通道。它们只有
  // CODESYS 面板会调，所以和 `codesys:ai-chat` 一样登记在这里（让 DSH 文档里的任何代码都不能读
  // 主页会话快照或往主页会话里塞 prompt）。
  'codesys:ai-chat-prompt',
  'codesys:ai-chat-snapshot',
  // T175：抽屉里的**模型选择**。它同样只有外壳 CODESYS 面板会调（preload 方法
  // `codesysAiChatModel` 只出现在 app/renderer/renderer.js，DSH 客户端 bundle 里 0 次），却能
  // 读整份模型目录并改**主页那条会话**下一次请求用的模型 —— 正是该挡住 DSH 文档里其它代码的动作，
  // 所以按同一条身份门登记（判据：sender 必须是 CODESYS 原生 surface 那个 webContents）。
  'codesys:ai-chat-model',
  // T185：抽屉里回答**主页那条会话的「待回答」提问**。它同样只有外壳 CODESYS 面板会调
  // （preload 方法 `codesysAiChatAnswer` 只出现在 app/renderer/renderer.js，DSH 客户端 bundle 里
  // 0 次），却是**唯一**能替用户把一条 `ask_user_question` 交回去的通道 —— 也就是唯一需要
  // "只能由面板触发"这条身份门的地方：DSH 文档里的任何代码都不许自己把用户的提问答掉。
  // 通道本身**不自动调用任何东西**：只有外壳那个「提交回答」按钮的点击会走到这里。
  'codesys:ai-chat-answer',
  // A 段：抽屉消息流里的「确认写入工程」。理由同上面几条，而且更硬：它是**唯一**能把用户点击变成
  // 工程写入的通道（写入本体是工作台那个 `apply-and-build`）。preload 方法 `codesysAiChatApply`
  // 只出现在 app/renderer/renderer.js（DSH 客户端 bundle 里 0 次），所以 DSH 文档里的任何代码
  // ——包括 AI 自己装/写的插件——都不能凭一个消息或一次轮询就写用户的工程。
  'codesys:ai-chat-apply',
  'codesys:list-windows',
  'codesys:native-host-attach',
  'codesys:native-host-detach',
  'codesys:native-host-move',
  // T192：抽屉消息流里那枚「让 CODESYS 重新加载」。理由同上面几条，另外它还多一层：它是**唯一**
  // 会往用户正在运行的 CODESYS 里发一条命令的通道（PostMessage WM_COMMAND）。preload 方法
  // `codesysNativeHostReloadProject` 只出现在外壳 app/renderer/renderer.js（DSH 客户端 bundle
  // 里 0 次），所以 DSH 文档里的任何代码都不能凭一条消息去动用户的 IDE。
  'codesys:native-host-reload-project',
  'codesys:open-program',
  'codesys:scriptengine-configure',
  'codesys:scriptengine-probe',
  'codesys:scriptengine-status',
  // T199（②）：设置页「启动」页签里那个「启动时预打开 CODESYS 工程」开关的读/写通道。
  //
  // 判据与上面所有条目**完全相同**（"只有外壳 app/renderer 文档会调、却能让后台真的起一个
  // 约 700 MB 的 CODESYS"）：设置页就是外壳自己的 `app/renderer/index.html`（`showPluginSurface`
  // 载入 `pluginSurfaceView`），所以 `panelSenderDecision` 的文档身份判定天然放行它；而
  // DSH 文档里的任何代码（包括 AI 自己装/写的插件）都不能凭一条消息就把用户的后台代价开关
  // 改掉。preload 方法 `codesysPreopenPreference` / `saveCodesysPreopenPreference` 只出现在
  // 外壳 `app/renderer/renderer.js`（DSH 侧 0 个调用点，契约里有双向断言）。
  'settings:codesys-preopen',
  'settings:codesys-preopen-save',
]);

// T193：身份判定的落点 —— 从"当前 surface 恰好是 codesys"改成"调用来自**我们自己的外壳渲染文档**"。
//
// 真机证据（`C:\TaskHive\resources\app\logs\desktop.log`，2026-10-04 那一轮连续 2 小时）：
// `codesys:ai-chat-snapshot` 被拒 **2604** 次、约每 2 秒一条，`frameUrl` 全部是
// `file:///C:/TaskHive/resources/app/app/renderer/index.html?embed=1&surface=chat` —— 那是**面板自己**
// 的文档（`showPluginSurface` 用 `loadFile(renderer/index.html, {query:{embed:'1',surface:'chat'}})` 载入）。
// 同一份日志里这些调用的 `sender` 恒为 3；本轮实测：外壳视图 = 3，DSH harness 文档帧 = 2
// （从 DSH 帧调同一个通道会记下 `sender:2` + `http://127.0.0.1:<port>/`）。也就是说被拒的**就是面板**。
//
// 为什么旧判据会拒掉面板：`showPluginSurface()` 的顺序是"先把视图挂上去（面板立刻可见）→ 预热点火 →
// `await codesysNativeHost.resume(...)` → 才写 `pluginSurfaceKind = kind`"。真机上托管着 CODESYS 时
// resume 走 PowerShell 窗口过渡队列，而这一处 await **没有超时**；它一旦卡住（不抛错，所以
// errors.log 里连 `surface-open` 都没有），面板就一直可见而 `pluginSurfaceKind` 停在旧值/`null`，
// 于是抽屉里只剩"只能由 TaskHive 的 CODESYS 面板调用"，`blocked-ipc` 每 1.5 秒再涨一条。
//
// 门要保留的意义是 T166 那条：**DSH 文档里的任何代码（包括 AI 自己装/写的插件）都不能调这些通道**。
// 用**文档身份**判定比 surface 标志更精确、且不随时间漂移：
//   * 必须是外壳那个 WebContents（`pluginSurfaceView`，preload 只挂在它和主窗口上）；
//   * 必须是**顶层帧**（同 `isTrustedSender` 的口径：本应用不开 `nodeIntegrationInSubFrames`）；
//   * 帧 URL 必须落在 `app/renderer` 文档树里（复用 `isAppRendererFileUrl`：`..` 会被 resolve 掉）。
// 仍然被拒：DSH harness 文档帧（`http://127.0.0.1:<本次运行端口>/`）、任意子帧、任何被塞进外壳窗口
// 的其它 `file://` 文档、以及别的 WebContents。不给 harness 帧开口子的依据是实测事实：这 15 个通道
// 在 DSH 客户端 bundle 与 `dsh/src/**` 里各有 **0** 个调用点（契约里有双向断言钉住）。
//
// 返回值带 `reason`，`expected`/`surfaceKind` 是给拒绝日志看的原始事实。
function panelSenderDecision(event) {
  const sender = event?.sender;
  const surfaceKind = pluginSurfaceKind;
  if (!sender || !pluginSurfaceView || pluginSurfaceView.webContents.isDestroyed() || sender !== pluginSurfaceView.webContents) {
    return {
      allowed: false,
      reason: 'sender-not-shell-renderer-webcontents',
      expected: 'pluginSurfaceView.webContents（外壳插件视图）',
      surfaceKind,
    };
  }
  const frame = event?.senderFrame || null;
  if (!frame || frame !== sender.mainFrame) {
    return {
      allowed: false,
      reason: 'panel-call-not-top-frame',
      expected: '外壳插件视图的顶层帧（preload 不开 nodeIntegrationInSubFrames）',
      surfaceKind,
    };
  }
  const frameUrl = String(frame.url || '');
  if (!isAppRendererFileUrl(frameUrl, path.join(__dirname, 'renderer'))) {
    return {
      allowed: false,
      reason: 'shell-document-not-app-renderer',
      expected: 'file://<app>/app/renderer/** 里的文档',
      surfaceKind,
    };
  }
  // 合法宿主：外壳自己的文档。surface 标志只作为**事实**记下来（真机上它曾经滞后于可见性，
  // 那正是这一轮被拒的原因），不再作为放行条件 —— 抽屉就活在这个文档里，切走 surface 时它照样在轮询。
  return {
    allowed: true,
    reason: surfaceKind === 'codesys' ? 'shell-renderer-document' : `shell-renderer-document-surface-${surfaceKind || 'none'}`,
    expected: 'pluginSurfaceView.webContents 顶层 app/renderer 文档',
    surfaceKind,
  };
}

function isCodesysPanelSender(event) {
  return panelSenderDecision(event).allowed;
}

function handleTrusted(channel, handler, options) {
  ipcMainHandle(channel, (event, ...args) => {
    const trust = trustedFrameDecision(event, options);
    if (!trust.trusted) {
      reportUntrustedIpc(channel, event, `untrusted-sender:${trust.reason}`, { expected: '外壳 app/renderer 文档或本次运行的 harness 文档' });
      throw new Error(`IPC ${channel} 拒绝非受信任页面的调用`);
    }
    if (CODESYS_PANEL_ONLY_CHANNELS.has(channel)) {
      const panel = panelSenderDecision(event);
      if (!panel.allowed) {
        reportUntrustedIpc(channel, event, `not-codesys-panel-sender:${panel.reason}`, { expected: panel.expected, surfaceKind: panel.surfaceKind, allowedHosts: '外壳插件视图顶层 app/renderer 文档' });
        throw new Error(`IPC ${channel} 只能由 TaskHive 的 CODESYS 面板调用（拒绝原因 ${panel.reason}）`);
      }
    }
    return handler(event, ...args);
  });
}

// One console handler shared by both preload-bearing windows, so the shell and
// the workbench cannot drift apart again (they had two different
// implementations and only the main window was maintained).
//
// Electron 43.4.0 delivers BOTH shapes at once: the event object carries
// `level` (string), `message`, `lineNumber`, `sourceId` and `frame`, and the
// deprecated positional `level` (integer 0-3), `message`, `line` and `sourceId`
// follow it. Both are normalised here so the log line is identical either way.
//
// The listener deliberately declares no named parameters: Electron inspects
// `listener.length` and prints a deprecation warning for any listener that still
// asks for the positional arguments, so `(...args)` keeps this path quiet while
// staying correct on the event shape alone if the positional arguments are ever
// removed.
function normalizeConsoleMessage(args) {
  const [first, second, third, fourth, fifth] = args;
  const event = first && typeof first === 'object' ? first : {};
  // The modern signature is `(event, details)`; the deprecated one is
  // `(event, level, message, line, sourceId)`. Accept both, so the collector
  // cannot go quiet just because the host switched shape.
  const details = second && typeof second === 'object' ? second : event;
  const positional = typeof second === 'number' || typeof second === 'string' ? second : undefined;
  const rawLevel = typeof positional === 'string' && Number.isNaN(Number(positional))
    ? positional
    : (details.level ?? positional);
  // Blink's console levels are 0=verbose, 1=info, 2=warning, 3=error. The old
  // mapping collapsed EVERY numeric level >= 2 into 'warning', so a real console
  // ERROR (level 3) never reached recordSmokeRendererError — which is how
  // electron-smoke.json could report ok=true while the same minute's
  // renderer-console.log recorded `React error #130` (audit 2026-10-02).
  const numericLevel = Number(rawLevel);
  const level = typeof rawLevel === 'string' && Number.isNaN(numericLevel)
    ? rawLevel
    : (numericLevel >= 3 ? 'error' : (numericLevel === 2 ? 'warning' : 'info'));
  if (level !== 'warning' && level !== 'error') return null;
  return {
    level,
    message: String(details.message ?? third ?? '').slice(0, 2000),
    lineNumber: details.lineNumber ?? fourth ?? 0,
    sourceId: String(details.sourceId ?? fifth ?? ''),
  };
}

// Smoke runs must not report success while the renderer is throwing.
//
// Audit 2026-10-02: `electron-smoke.json` reported `ok=true` in the very minute
// `renderer-console.log` recorded `React error #130`, and the task list then
// recorded "未复现新的 React #130". The collector below makes renderer errors
// part of the pass criterion, so a green smoke means the UI actually rendered.
// `TASKHIVE_SMOKE_IGNORE_RENDERER_ERRORS` (regex, case-insensitive) exists as an
// explicit, reviewable escape hatch for known upstream noise.
const smokeRendererErrors = [];
const SMOKE_RENDERER_ERROR_LIMIT = 50;
function recordSmokeRendererError(details, label) {
  if (String(details.level) !== 'error') return;
  const ignore = process.env.TASKHIVE_SMOKE_IGNORE_RENDERER_ERRORS;
  if (ignore) {
    try { if (new RegExp(ignore, 'i').test(String(details.message))) return } catch { /* bad pattern: fail closed */ }
  }
  if (smokeRendererErrors.length < SMOKE_RENDERER_ERROR_LIMIT) {
    smokeRendererErrors.push({
      at: new Date().toISOString(),
      label,
      sourceId: details.sourceId,
      lineNumber: details.lineNumber,
      message: String(details.message).slice(0, 2000),
    });
  }
}

function attachRendererConsoleLogging(contents, label) {
  if (!contents) return;
  contents.on('console-message', (...args) => {
    const details = normalizeConsoleMessage(args);
    if (!details) return;
    recordSmokeRendererError(details, label);
    appendDiagnosticLog(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} ${label} level=${details.level} ${details.sourceId}:${details.lineNumber} ${details.message}\n`);
  });
}

// Renderer CRASHES were invisible. `console-message` only fires while a renderer
// is alive and logging; a renderer that dies (or hangs, or whose navigation
// fails) produced no console message at all, so `smokeRendererErrors` stayed
// empty and `--smoke-ui` could report ok=true over a blank window. Reported field
// symptom: "the panel opened blank" with a green smoke.
//
// Every long-lived webContents (main window, plugin surface, web-ai view, splash)
// now routes these lifecycle events through the SAME collector the console path
// uses, so they land in logs/renderer-console.log and in electron-smoke.json, and
// they honour the same TASKHIVE_SMOKE_IGNORE_RENDERER_ERRORS escape hatch.
//
// `did-fail-load` with code -3 (ERR_ABORTED) is deliberately NOT an error: normal
// surface switching aborts in-flight loads (see the `ERR_ABORTED` tolerance in
// showPluginSurface), and treating those as failures would make every smoke red
// for a non-event. It is still logged, so the abort is visible.
function recordRendererLifecycleFailure(label, kind, details) {
  const summary = `${kind} ${JSON.stringify(details)}`.slice(0, 2000);
  appendDiagnosticLog(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} ${label} ${summary}\n`);
  recordSmokeRendererError({ level: 'error', message: summary, sourceId: `renderer-lifecycle:${kind}`, lineNumber: 0 }, label);
  return { at: new Date().toISOString(), label, kind, details };
}

function attachRendererLifecycleLogging(contents, label) {
  if (!contents || contents.isDestroyed?.()) return;
  contents.on('render-process-gone', (_event, details) => {
    recordRendererLifecycleFailure(label, 'render-process-gone', { reason: details?.reason, exitCode: details?.exitCode });
  });
  contents.on('unresponsive', () => {
    recordRendererLifecycleFailure(label, 'unresponsive', {});
  });
  contents.on('responsive', () => {
    appendDiagnosticLog(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} ${label} responsive-restored\n`);
  });
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    const details = { code, description, url, isMainFrame: Boolean(isMainFrame) };
    if (Number(code) === -3) {
      appendDiagnosticLog(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} ${label} load-aborted ${JSON.stringify(details)}\n`);
      return;
    }
    recordRendererLifecycleFailure(label, 'did-fail-load', details);
  });
}

// Same contract for one-way channels, which were previously guarded only by a
// `event.sender` comparison.
function onTrusted(channel, handler, options) {
  ipcMainOn(channel, (event, ...args) => {
    const trust = trustedFrameDecision(event, options);
    if (!trust.trusted) {
      reportUntrustedIpc(channel, event, `untrusted-sender:${trust.reason}`);
      return;
    }
    return handler(event, ...args);
  });
}

// Online actions bind their authorization to the exact project bytes the
// operator saw when arming, so a save that happens afterwards invalidates it.
function codesysFileSha256(file) {
  try {
    return require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

// The CODESYS window title carries '*' while the editor holds unsaved changes.
// Downloading the saved file in that state would ship older code than the
// operator is looking at, so the title is part of the download pre-flight.
async function codesysMonitoredWindowTitle() {
  if (!codesysPreferredWindowId) return '';
  try {
    const target = await monitor.resolveWindow(codesysPreferredWindowId);
    return String(target?.title || '');
  } catch {
    return '';
  }
}

// Reject anything that is not this launch's Harness origin or the app's own
// renderer document. Called from `will-navigate` and `setWindowOpenHandler` so a
// preload-bearing window can never hand its bridge to another origin.
//
// The previous version allowed every `file://` URL and every `127.0.0.1:<port>`,
// which is exactly the condition the IPC trust check above is meant to close:
// any local file or any other local HTTP server would have been an acceptable
// navigation target for a window that carries `preload.js`.
function isAllowedWorkbenchNavigation(targetUrl, contents) {
  return isAllowedWorkbenchNavigationUrl(targetUrl, {
    kind: contents && pluginSurfaceView && contents === pluginSurfaceView.webContents ? 'shell' : 'harness',
    harnessRuntimeUrl: harnessRuntime?.url || '',
    rendererRoot: path.join(__dirname, 'renderer'),
  });
}

function guardWorkbenchNavigation(contents, label) {
  if (!contents) return;
  contents.on('will-navigate', (event, url) => {
    if (isAllowedWorkbenchNavigation(url, contents)) return;
    event.preventDefault();
    fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} blocked-navigation ${label} ${url}\n`, 'utf8');
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWorkbenchNavigation(url, contents)) return { action: 'allow' };
    fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} blocked-window-open ${label} ${url}\n`, 'utf8');
    return { action: 'deny' };
  });
}
let suspendedCloseSurface = null;
let suspendedSettingsSurface = null;
let shutdownPromise = null;
let directoryManifestWatcher = null;
const terminalTasks = new Map();
let modelHealthCache = null;
let modelHealthPromise = null;
const codesysExternalProgramLifecycle = Object.freeze({
  lifecycleOwner: 'user',
  persistsAcrossSurfaceSwitch: true,
  persistsAcrossSessionSwitch: true,
  // A launched instance survives surface/session switches and a crash, but
  // TaskHive closes the instances IT launched when it exits — unless the window
  // title marks unsaved changes, which always keeps them open. (Field report:
  // instances accumulated in the background across restarts.)
  persistsAfterTaskHiveExit: false,
  taskHiveMayCloseProgram: true,
  closePolicy: 'taskhive-closes-launched-instances-unless-unsaved',
});

const smokeLaunch = () => process.argv.some((arg) => ['--smoke', '--smoke-isolated', '--smoke-ui', '--smoke-splash', '--smoke-browser', '--smoke-web-login', '--smoke-web-ai-chat', '--smoke-model', '--smoke-terminal', '--smoke-codesys-native-host', '--smoke-cancel-generation', '--probe-runtime-integrations', '--probe-settings-plugin-windows', '--probe-dsh-tool-call', '--probe-dsh-codesys-scriptengine', '--probe-codesys-preopen-setting', '--probe-codesys-preopen-setting-on'].includes(arg));

// T159：smoke 期间**只检查本次启动新写入的** harness 日志片段。
// 背景（T156）：插件包名不一致时 DSH 只写一行 `… : failed to import`，客户端插件于是
// 整体不挂载；当时 `electron-smoke.json` 只有 `ok:false` 而**没有任何原因字段**，
// 真因埋在没人读的 harness-runtime.log 里。这里记下启动时的文件偏移，收尾时只看增量。
const smokeHarnessLogPath = path.join(root, 'logs', 'harness-runtime.log');
const smokeHarnessLogStart = (() => {
  if (!smokeLaunch()) return 0;
  try { return fs.statSync(smokeHarnessLogPath).size; } catch { return 0; }
})();

function readSmokeHarnessFailures() {
  if (!smokeLaunch()) return [];
  try {
    const size = fs.statSync(smokeHarnessLogPath).size;
    if (size <= smokeHarnessLogStart) return [];
    const descriptor = fs.openSync(smokeHarnessLogPath, 'r');
    try {
      const length = Math.min(size - smokeHarnessLogStart, 256 * 1024);
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, size - length);
      return buffer.toString('utf8').split('\n')
        .filter((line) => /failed to import|did not activate/.test(line))
        .map((line) => line.trim().slice(0, 240));
    } finally { fs.closeSync(descriptor); }
  } catch { return []; }
}

function codesysSmokeProjectPath() {
  const configured = String(process.env.TASKHIVE_CODESYS_TEST_PROJECT || '').trim();
  if (!configured || !smokeLaunch()) return '';
  const validationRoot = path.resolve(programRoot, '.taskhive-validation');
  if (!fs.existsSync(validationRoot)) throw new Error('CODESYS smoke 验证目录不存在');
  const candidate = path.resolve(configured);
  if (path.extname(candidate).toLowerCase() !== '.project' || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error('CODESYS smoke 工程必须是现有 .project 文件');
  const canonicalRoot = fs.realpathSync.native(validationRoot);
  const canonicalCandidate = fs.realpathSync.native(candidate);
  const relative = path.relative(canonicalRoot, canonicalCandidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error(`CODESYS smoke 工程必须位于 ${APP_VERSION} 的 .taskhive-validation 内`);
  return canonicalCandidate;
}

function isCodesysSmokeProject(value) {
  const configured = codesysSmokeProjectPath();
  return Boolean(configured && path.resolve(String(value || '')).toLowerCase() === configured.toLowerCase());
}

function startDirectoryManifestSync() {
  if (!app.isPackaged || smokeLaunch() || directoryManifestWatcher) return;
  directoryManifestWatcher = startDirectoryManifestWatcher(programRoot);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 520,
    height: 320,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    show: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    icon: path.join(root, 'app', 'assets', 'taskhive-icon-v3.ico'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const splashIcon = `data:image/png;base64,${fs.readFileSync(path.join(root, 'app', 'assets', 'taskhive-icon-v3-128.png')).toString('base64')}`;
  const splash = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>TaskHive</title><style>
  :root{font-family:Inter,"Microsoft YaHei",system-ui,sans-serif;color:#171717;background:#fff}*{box-sizing:border-box}body{margin:0;height:100vh;padding:34px 38px 28px;display:flex;flex-direction:column;background:#fff}.brand{display:flex;align-items:center;gap:13px;font-size:26px;font-weight:700;letter-spacing:-.02em}.brand img{width:44px;height:44px}.copy{margin-top:auto}.stage{font-size:15px;font-weight:600;min-height:22px}.detail{margin-top:5px;color:#767676;font-size:11px;min-height:17px}.track{height:3px;margin-top:20px;background:#ececec;overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,#7168f6,#3188eb);transition:width .25s ease}.status{margin-top:10px;color:#8a8a8a;font-size:11px}.status.fail{color:#991b1b}</style><div class="brand"><img src="${splashIcon}" alt="TaskHive"><span>TaskHive</span></div><div class="copy"><div id="stage" class="stage">正在准备启动</div><div id="detail" class="detail">正在初始化客户端</div><div class="track"><div id="fill" class="fill"></div></div><div id="status" class="status">请稍候…</div></div><script>window.setStage=(stage,progress,detail,failed)=>{document.getElementById('stage').textContent=stage||'';document.getElementById('detail').textContent=detail||'';document.getElementById('fill').style.width=Math.max(0,Math.min(100,Number(progress)||0))+'%';const s=document.getElementById('status');s.textContent=failed?'启动失败：'+(detail||'未知错误'):(Number(progress)>=100?'客户端即将就绪':'TaskHive 正在加载');s.className='status'+(failed?' fail':'')};</script></html>`;
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splash)}`);
  // The splash renderer ran with NO console forwarding and NO lifecycle
  // visibility: an error inside its inline `setStage` script (the first thing a
  // user sees) never reached logs/renderer-console.log. Same path as the main
  // window now.
  attachRendererConsoleLogging(splashWindow.webContents, 'splash');
  attachRendererLifecycleLogging(splashWindow.webContents, 'splash');
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createCodesysMediaFixture() {
  if (!process.argv.includes('--smoke-codesys-fixture') && !process.argv.includes('--smoke-codesys-native-host')) return;
  // Only explicit isolated smoke runs may expose the Electron fixture through
  // the Windows window monitor/native host allowlist. Production launches
  // never set this flag and therefore continue to accept CODESYS processes only.
  process.env.TASKHIVE_CODESYS_TEST_FIXTURE = '1';
  for (const [index, suffix] of ['A', 'B'].entries()) {
    const fixtureWindow = new BrowserWindow({ width: 960, height: 540, x: 40 + index * 28, y: 40 + index * 28, show: false, focusable: false, skipTaskbar: true, backgroundColor: '#f4f4f4', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const fixtureTitle = `CODESYS TaskHive Media Fixture ${suffix}`;
    fixtureWindow.setTitle(fixtureTitle);
    fixtureWindow.on('page-title-updated', (event) => { event.preventDefault(); if (!fixtureWindow.isDestroyed()) fixtureWindow.setTitle(fixtureTitle); });
    const fixture = `<!doctype html><meta charset="utf-8"><title>${fixtureTitle}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f5f5f5;font:16px system-ui}.stage{position:absolute;inset:0;background:linear-gradient(${index ? 220 : 120}deg,#f7f7f7,#d9d9d9,#fff);background-size:240% 240%;animation:shift .8s linear infinite}.rail{position:absolute;left:0;top:0;bottom:0;width:${index ? 210 : 180}px;background:#ececec;border-right:1px solid #bbb}.panel{position:absolute;left:${index ? 235 : 205}px;right:24px;top:28px;bottom:28px;border:1px solid #aaa;background:#fff}.cursor{position:absolute;width:36px;height:36px;border:2px solid #111;border-radius:50%;animation:move 1.2s ease-in-out infinite alternate}@keyframes shift{to{background-position:100% 100%}}@keyframes move{from{left:250px;top:70px}to{left:820px;top:430px}}</style><div class="stage"></div><div class="rail"></div><div class="panel"></div><div class="cursor"></div>`;
    codesysFixtureWindows.push(fixtureWindow);
    void fixtureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fixture)}`);
    fixtureWindow.once('ready-to-show', () => { if (!fixtureWindow.isDestroyed()) fixtureWindow.showInactive(); });
    fixtureWindow.on('closed', () => { const position = codesysFixtureWindows.indexOf(fixtureWindow); if (position >= 0) codesysFixtureWindows.splice(position, 1); });
  }
}

function codesysFixtureLifecycleSnapshot(stage) {
  const windows = codesysFixtureWindows.map((fixtureWindow) => {
    const destroyed = fixtureWindow.isDestroyed();
    let nativeHandle = '';
    if (!destroyed && process.platform === 'win32') {
      try {
        const bytes = fixtureWindow.getNativeWindowHandle();
        const value = bytes.length >= 8 ? bytes.readBigUInt64LE(0) : BigInt(bytes.readUInt32LE(0));
        nativeHandle = `0x${value.toString(16)}`;
      } catch { /* lifecycle evidence remains useful without a native handle */ }
    }
    return {
      browserWindowId: destroyed ? null : fixtureWindow.id,
      nativeHandle,
      processId: process.pid,
      title: destroyed ? '' : fixtureWindow.getTitle(),
      destroyed,
      visible: destroyed ? false : fixtureWindow.isVisible(),
    };
  });
  return { stage, windows, at: new Date().toISOString() };
}

function codesysFixtureIdentityStable(reference, candidate) {
  if (!reference?.windows?.length || reference.windows.length !== candidate?.windows?.length) return false;
  return reference.windows.every((before) => candidate.windows.some((after) => (
    before.browserWindowId === after.browserWindowId
    && before.nativeHandle === after.nativeHandle
    && before.processId === after.processId
    && before.title === after.title
    && after.destroyed === false
  )));
}

function updateSplash(stage, progress, detail, failed = false) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.executeJavaScript(`window.setStage(${JSON.stringify(stage)},${Number(progress) || 0},${JSON.stringify(detail || '')},${Boolean(failed)})`).catch(() => {});
}


function pluginEnabled(id) {
  const item = pluginManager?.readCatalog?.().plugins?.[id];
  return Boolean(item && item.state === 'enabled' && (item.installed === true || fs.existsSync(path.join(root, 'plugins', 'installed', id))));
}

// ---------------------------------------------------------------------------
// API credentials for catalog providers.
//
// The adapter (`taskhive-codex-model/dsh/index.js`) talks plain
// OpenAI-compatible `${endpoint}/chat/completions` for every catalog provider
// whose kind is `api`, and reads its credential from `process.env[apiKeyEnv]`.
// So supporting "add your own API endpoint" reduces to two things this process
// must own: persist `endpoint` + `apiKeyEnv` on the provider, and inject the key
// into the Harness child's environment. Neither the adapter nor DSH needs a
// change, and the key never travels to the renderer.
// ---------------------------------------------------------------------------
const apiCredentialPath = path.join(root, 'profiles', 'api-credentials.json');
// Batched Harness refresh after a model-catalog change; see scheduleModelCatalogRefresh.
let modelCatalogRefreshTimer = null;
let modelCatalogRefreshState = { at: null, state: 'idle' };

function readApiCredentials() {
  // Credentials are read through the recovering reader as well: a truncated file
  // used to be treated as "no credentials at all", which silently downgraded
  // every API provider to unconfigured instead of surfacing the damage.
  const parsed = readJson(apiCredentialPath, {}, {
    label: 'API 凭据 profiles/api-credentials.json',
    onProblem: (message) => reportBootstrapProblem(message),
  });
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeApiCredentials(value) {
  try {
    writeJson(apiCredentialPath, value);
    return true;
  } catch (error) {
    reportBootstrapProblem(`api-credentials not persisted: ${error.message}`);
    return false;
  }
}

// T151：PLC 在线"传输型确认"必须由**主进程**登记 —— 不能采信渲染层自报的 loginMode。
// 只有真正成功执行过 online-change / download 的动作会写这里；start/stop/reset/写变量/Force
// 只在同工程、12 小时内存在该确认时才放行，调用方无法再用一个字符串绕过。
const codesysTransferPath = path.join(root, 'profiles', 'codesys-transfer.json');
const CODESYS_TRANSFER_WINDOW_MS = 12 * 60 * 60 * 1000;

function readCodesysTransfer() {
  return readJson(codesysTransferPath, {}, { label: 'PLC 传输确认 profiles/codesys-transfer.json' });
}

function recordCodesysTransfer(projectPath) {
  const value = String(projectPath || '').trim();
  if (!value) return;
  const current = readCodesysTransfer();
  current[path.resolve(value)] = { at: new Date().toISOString(), atMs: Date.now() };
  try { writeJson(codesysTransferPath, current); } catch { /* 写失败只会导致下次拒绝，属安全方向 */ }
}

function codesysTransferConfirmed(projectPath) {
  const value = String(projectPath || '').trim();
  if (!value) return false;
  const entry = readCodesysTransfer()[path.resolve(value)];
  const at = Number(entry && entry.atMs);
  return Number.isFinite(at) && at > 0 && Date.now() - at < CODESYS_TRANSFER_WINDOW_MS;
}

// T154：知识库 AI 整理的**默认通道 = DeepSeek**（用户要求"知识库ai整理默认为 deepseek"）。
// 端点与模型取自 DSH 自己的配置（本安装的真实路由是 `llm-pi-ai.providers.deepseek.baseURL`，
// OpenAI 兼容），密钥取自 DSH 的凭据存储 `.credentials.yaml` 里的 `DEEPSEEK_API_KEY`。
// 两者任一缺失就返回 null —— 调用方退回"当前会话模型"，再退回本地规则。
function readDshProfileFile(name) {
  try { return fs.readFileSync(path.join(runtimeRoot, 'profiles', 'dsh', name), 'utf8'); } catch { return ''; }
}

// T157：CODESYS 作业目录**保留策略**。原先只增不删 —— 审计实测 100 个作业 / 570 MB，
// 最老的停在 8/31 且 9 天无人访问仍在盘上。策略保守：只在"超出保留份数**且**超过 14 天
// 未访问"时才删，避免删掉用户近期还要复用的作业上下文。
function pruneScriptEngineJobs(keep = 20, maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const jobsRoot = path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs');
  try {
    const now = Date.now();
    const entries = fs.readdirSync(jobsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(jobsRoot, entry.name);
        let at = 0;
        try { at = fs.statSync(full).mtimeMs; } catch { /* unreadable: keep it */ }
        return { full, at };
      })
      .sort((left, right) => right.at - left.at);
    const doomed = entries.filter((entry, index) => index >= keep && now - entry.at > maxAgeMs);
    for (const entry of doomed) {
      try { fs.rmSync(entry.full, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (doomed.length) appendDiagnosticLog(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} scriptengine-jobs pruned=${doomed.length} kept=${entries.length - doomed.length}\n`);
    return { total: entries.length, removed: doomed.length };
  } catch { return { total: 0, removed: 0 }; }
}

function resolveDeepseekRoute() {
  const settings = readDshProfileFile('settings.yaml') || readDshProfileFile('settings.yaml.imported');
  const baseURL = String((settings.match(/baseURL:\s*['"]?(\S+?)['"]?\s*$/m) || [])[1] || '').replace(/\/$/, '');
  const model = String((settings.match(/-\s*id:\s*['"]?(deepseek[\w.-]*)['"]?/) || [])[1] || '');
  const credentials = readDshProfileFile('.credentials.yaml');
  const apiKey = String((credentials.match(/DEEPSEEK_API_KEY:\s*['"]?([^'"\s]+)['"]?/) || [])[1] || '') || String(process.env.DEEPSEEK_API_KEY || '');
  if (!apiKey) return null;
  return { baseURL: baseURL || 'https://api.deepseek.com/v1', model: model || 'deepseek-chat', apiKey };
}

// Stable env var name for a provider: explicit `apiKeyEnv` wins, otherwise
// derive one (deepseek-api -> DEEPSEEK_API_KEY, my-gw -> MY_GW_API_KEY).
function apiKeyEnvName(provider) {
  const explicit = String(provider?.apiKeyEnv || '').trim();
  if (explicit) return explicit;
  const id = String(provider?.id || '').trim();
  if (id === 'deepseek-api') return 'DEEPSEEK_API_KEY';
  return id ? `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY` : '';
}

// Endpoint the adapter will actually use, mirroring its own fallbacks so the
// readiness state reported to the UI matches what a request would do.
function effectiveProviderEndpoint(provider) {
  const explicit = String(provider?.endpoint || '').trim();
  if (explicit) return explicit;
  if (provider?.id === 'ollama-local') return String(process.env.TASKHIVE_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434');
  if (provider?.id === 'deepseek-api') return 'https://api.deepseek.com';
  return '';
}

// Readiness for the config-driven providers. Everything else keeps the state
// its own subsystem (Codex CLI / Claude CLI / browser bridge) computed.
function resolveConfiguredState(provider) {
  if (!provider || !['api', 'local'].includes(provider.kind)) return provider?.state;
  const creds = readApiCredentials();
  const storedKey = String(creds[provider.id]?.apiKey || '').trim();
  const keyName = apiKeyEnvName(provider);
  const envKey = keyName ? String(process.env[keyName] || '').trim() : '';
  const endpoint = effectiveProviderEndpoint(provider);
  if (provider.kind === 'local') return endpoint ? 'ready' : 'unconfigured';
  // `api` needs both a reachable base URL and a credential.
  return endpoint && (storedKey || envKey) ? 'ready' : 'unconfigured';
}

// `protocol` decides which wire format the adapter uses. Only the two the
// plugin implements are accepted; anything else falls back to OpenAI-compatible
// so a typo cannot create a provider that silently never works.
function normalizeProtocol(value) {
  return String(value || '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

// The Harness child inherits these; this is the only channel the adapter reads.
function apiCredentialEnvironment() {
  const creds = readApiCredentials();
  const env = {};
  for (const provider of modelCatalog.providers || []) {
    const name = apiKeyEnvName(provider);
    const key = String(creds[provider.id]?.apiKey || '').trim();
    if (name && key) env[name] = key;
  }
  return env;
}

function maskApiKey(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

// Never hand the raw key to the renderer: only whether one exists and its mask.
function decorateProviderCredentials(catalog) {
  const creds = readApiCredentials();
  for (const provider of catalog.providers || []) {
    const key = String(creds[provider.id]?.apiKey || '');
    provider.apiKeyEnv = apiKeyEnvName(provider);
    provider.hasApiKey = Boolean(key) || Boolean(provider.apiKeyEnv && process.env[provider.apiKeyEnv]);
    provider.apiKeyMasked = maskApiKey(key);
    provider.endpoint = provider.endpoint || (provider.id === 'deepseek-api' ? 'https://api.deepseek.com' : provider.endpoint || '');
  }
  return catalog;
}

// Reload the workbench page against the CURRENT Harness URL.
//
// Only reached after a Harness restart (new port) or a plugin change, where the
// client has to be re-bootstrapped from scratch. Model-catalog edits no longer
// come through here: the Harness plugin watches `profiles/model-catalog.json`
// and republishes `llm/adapters-updated`, so a loaded client refetches the
// catalog in place (see scheduleModelCatalogRefresh).
function reloadWorkbench(reason) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const url = harnessWorkbenchUrl();
    if (!url) return false;
    // Mark the reload in flight. `models:list` reports this as `pending` so a
    // caller (and the model smoke probe) waits for the page to finish loading
    // instead of running executeJavaScript against a navigating frame, which
    // never settles.
    modelCatalogRefreshState = { at: new Date().toISOString(), state: 'reloading', phase: 'reloading' };
    const contents = mainWindow.webContents;
    contents.once('did-stop-loading', () => {
      modelCatalogRefreshState = { at: new Date().toISOString(), state: 'refreshed', phase: 'done' };
    });
    void contents.loadURL(url).catch((error) => {
      modelCatalogRefreshState = { at: new Date().toISOString(), state: 'failed', phase: 'done', message: error.message };
      reportBootstrapProblem(`workbench reload failed (${reason}): ${error.message}`);
    });
    return true;
  } catch (error) {
    reportBootstrapProblem(`workbench reload failed (${reason}): ${error?.message || error}`);
    return false;
  }
}

// Restart the Harness and re-point the window at the new port.
//
// A restart binds a NEW port, so without this the loaded page keeps talking to a
// dead server: its reconnect loop fails and it never notices the new URL. Used
// for changes the server must re-read at boot (the generated DSH patch, plugin
// adapters, the child process environment).
async function restartHarnessRuntime(reason) {
  writeDshPatch();
  const runtime = await harnessRuntime.restart();
  reloadWorkbench(reason);
  harness.append('harness.restarted', { reason, runtime: runtime.slotRoot, dsh: runtime.runtime });
  return runtime;
}

// Batched settle window for a model-catalog change.
//
// Nothing is driven from here any more. `profiles/model-catalog.json` is the
// only input, and the Harness plugin (`taskhive-codex-model`) watches it
// directly: a catalog edit makes it recompute its route set and call
// `AdapterRegistrationHandle.replace()`, which republishes the payload-free
// `llm/adapters-updated` owner event. Every loaded client answers that event by
// refetching `session.modelCatalog()` and re-rendering the composer model seat
// and the /model popup IN PLACE, so a visibility tick or a custom provider
// add/remove needs no page reload, no Harness restart, no port change and drops
// no view.
//
// What is left here is the observable contract the renderer and the model smoke
// probe already wait on: `refreshState.pending` stays true for one batched
// window (a burst of checkbox clicks collapses into one) covering the watcher
// debounce, the host round trip and the client re-render, then reports `done`.
// The window is deliberately generous, because the live event is the only
// completion signal left: nothing user-visible waits on this timer (the picker
// updates as soon as the event lands), so being late costs nothing while being
// early would let the smoke probe read the DOM before the client re-rendered.
function scheduleModelCatalogRefresh(delayMs = 1500) {
  if (modelCatalogRefreshTimer) clearTimeout(modelCatalogRefreshTimer);
  modelCatalogRefreshState = { at: new Date().toISOString(), state: 'refreshing', phase: 'refreshing', mode: 'live' };
  modelCatalogRefreshTimer = setTimeout(() => {
    modelCatalogRefreshTimer = null;
    modelCatalogRefreshState = { at: new Date().toISOString(), state: 'refreshed', phase: 'done', mode: 'live' };
  }, delayMs);
  return true;
}

// 用户的删除要求（2026-10）：ModLens 视觉桥整体删除，"AI 实时监视"也一并移除，因此
// 本机**没有任何视觉通道**。这里保留一个**显式降级**的常量（而不是把字段整个删掉），
// 让 models:list 的装饰逻辑能对界面说清"视觉未接入"，而不是留下一个悬空的能力标记
// 或让每个调用点各自猜测字段是否存在。
const NO_VISION_CHANNEL = Object.freeze({ state: 'unsupported', route: null, ready: false, readyProviders: [], providers: [] });

function modelHealthSnapshot() {
  if (modelHealthCache && modelHealthCache.expiresAt > Date.now()) return modelHealthCache.value;
  if (!modelHealthPromise) {
    modelHealthPromise = (async () => {
      let claude = { id: 'claude-code', installed: null, authenticated: false, state: 'checking', version: null, command: null };
      const [claudeResult] = await Promise.allSettled([claudeCodeStatusAsync()]);
      if (claudeResult.status === 'fulfilled') claude = claudeResult.value;
      modelHealthCache = { value: { claude, vision: NO_VISION_CHANNEL }, expiresAt: Date.now() + 60000 };
    })().catch(() => {}).finally(() => { modelHealthPromise = null; });
  }
  return { claude: { id: 'claude-code', installed: null, authenticated: false, state: 'checking', version: null, command: null }, vision: NO_VISION_CHANNEL };
}

function surfaceDescriptors() {
  const catalog = pluginManager?.readCatalog?.() || { plugins: {} };
  return Object.values(catalog.plugins || {}).sort((left, right) => (Number(left.order) || 9999) - (Number(right.order) || 9999))
    .filter((item) => item.id !== 'plugin-manager' && item.state === 'enabled' && (item.installed === true || fs.existsSync(path.join(root, 'plugins', 'installed', item.id))))
    .map((item) => {
      const ui = item.ui || {};
      return {
        id: ui.surface || item.id,
        title: item.name,
        kind: ui.kind || (Array.isArray(item.capabilities) && item.capabilities.includes('tool/service-only') ? 'tool/service-only' : 'surface'),
        visible: ui.visible === true && ui.kind !== 'tool/service-only' && ui.kind !== 'settings-only',
        placement: item.placement || ui.defaultPlacement || 'hidden',
        allowedPlacements: ui.allowedPlacements || [],
        pluginId: item.id,
      };
    })
    .filter((item, index, all) => item.visible && all.findIndex((candidate) => candidate.id === item.id) === index);
}

function harnessWorkbenchUrl() {
  if (!harnessRuntime?.url) return null;
  const workspacePath = path.join(root, 'workspaces', 'harness-default');
  const descriptors = surfaceDescriptors();
  const enabledSurfaces = descriptors.map((item) => item.id);
  let taskhiveIcon = '';
  try { taskhiveIcon = `data:image/png;base64,${fs.readFileSync(path.join(root, 'app', 'assets', 'taskhive-icon-v3-64.png')).toString('base64')}`; } catch { /* icon is validated by release smoke */ }
  const url = new URL(harnessRuntime.url);
  url.searchParams.set('taskhiveWorkspace', workspacePath);
  url.searchParams.set('taskhiveEnabledSurfaces', enabledSurfaces.join(','));
  url.searchParams.set('taskhiveSurfaceDescriptors', JSON.stringify(descriptors));
  url.searchParams.set('taskhiveIcon', taskhiveIcon);
  return url.toString();
}

function normalizeSurfaceBounds(input) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const content = mainWindow.getContentBounds();
  const x = Math.max(0, Math.round(Number(input?.left) || 0));
  const y = Math.max(0, Math.round(Number(input?.top) || 0));
  // T142：**停靠到右栏**时，几何就是右栏自己的盒子，不能再按"右栏保留宽度"去夹 ——
  // 否则 maxRight = left，宽度会被夹成 0（实测停靠几何 left=696/width=570 被夹成 0，
  // 原生面板于是留在中央区，用户看到"浏览器还是在中间"）。
  if (input?.docked === true) {
    return {
      x,
      y,
      width: Math.min(content.width - x, Math.max(1, Math.round(Number(input?.width) || 0))),
      height: Math.min(content.height - y, Math.max(1, Math.round(Number(input?.height) || 0))),
    };
  }
  const declaredRight = Number(input?.rightBoundary);
  // A cached DSH client can briefly publish its animated panel position as
  // the content boundary. Require an explicit collapsed marker to use the
  // narrow reserve; legacy messages keep the standard 380px right rail.
  const reportedReserve = Math.round(Number(input?.rightSidebarReserve) || 0);
  const rightReserve = input?.rightSidebarCollapsed === true
    ? Math.max(36, reportedReserve || 78)
    : Math.max(180, reportedReserve || 380);
  const maxRight = Number.isFinite(declaredRight) && declaredRight > x
    ? Math.min(content.width - rightReserve, Math.round(declaredRight))
    : content.width - rightReserve;
  const width = Math.min(maxRight - x, content.width - x, Math.max(0, Math.round(Number(input?.width) || 0)));
  const height = Math.min(content.height - y, Math.max(0, Math.round(Number(input?.height) || 0)));
  return width >= 320 && height >= 240 ? { x, y, width, height } : null;
}

const WEB_AI_PROVIDERS = Object.freeze({
  google: { name: 'Google', modelName: 'Google', url: 'https://www.google.com/' },
  deepseek: { name: 'DeepSeek', modelName: 'DeepSeek（网页）', url: process.env.TASKHIVE_WEB_AI_DEEPSEEK_URL || 'https://chat.deepseek.com/' },
  kimi: { name: 'Kimi', modelName: 'Kimi（网页）', url: 'https://kimi.moonshot.cn/' },
  doubao: { name: '豆包', modelName: '豆包（网页）', url: 'https://www.doubao.com/chat/' },
  yuanbao: { name: '腾讯元宝', modelName: '腾讯元宝（网页）', url: 'https://yuanbao.tencent.com/chat/' },
  qwen: { name: '通义千问', modelName: '通义千问（网页）', url: 'https://chat.qwen.ai/' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
});

function readBrowserPreferences() {
  const defaults = {
    homepage: WEB_AI_PROVIDERS.doubao.url,
    bookmarks: Object.entries(WEB_AI_PROVIDERS).map(([id, provider]) => ({ id: `builtin-${id}`, title: provider.name, url: provider.url, builtin: true })),
  };
  // Recovered through the atomic reader so a damaged file is quarantined and the
  // last good generation is used, instead of silently reverting to the built-in
  // homepage/bookmark set.
  const saved = readJson(browserPreferencesPath, null, {
    label: '浏览器偏好 profiles/browser-preferences.json',
    onProblem: (message) => reportBootstrapProblem(message),
  });
  if (!saved || typeof saved !== 'object') return defaults;
  return { homepage: normalizeWebAiUrl(saved.homepage || defaults.homepage), bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks : defaults.bookmarks };
}

function writeBrowserPreferences(value) {
  writeJson(browserPreferencesPath, value);
  return value;
}

const WEB_AI_TOOLBAR_HEIGHT = 78;

function webAiBounds(bounds) {
  if (!bounds) return null;
  return { x: bounds.x, y: bounds.y + WEB_AI_TOOLBAR_HEIGHT, width: bounds.width, height: Math.max(0, bounds.height - WEB_AI_TOOLBAR_HEIGHT) };
}

function webAiItemState(item) {
  const contents = item?.view?.webContents;
  const history = contents?.navigationHistory;
  return {
    id: item.id,
    providerId: item.providerId,
    providerName: WEB_AI_PROVIDERS[item.providerId]?.name || item.providerId || '网页',
    title: item.title || WEB_AI_PROVIDERS[item.providerId]?.name || '新标签页',
    url: contents && !contents.isDestroyed() ? contents.getURL() : '',
    loading: contents && !contents.isDestroyed() ? contents.isLoading() : false,
    canGoBack: Boolean(history?.canGoBack?.()),
    canGoForward: Boolean(history?.canGoForward?.()),
  };
}

function webAiWindowState() {
  return {
    activeId: activeWebAiViewId,
    windows: [...webAiViews.values()].map(webAiItemState),
    bridge: { ...webAiBridgeState },
  };
}

function setWebAiBridgeState(state, model = null, code = null) {
  webAiBridgeState = { state, model, code };
  emitWebAiState();
}

function emitWebAiState() {
  const payload = webAiWindowState();
  for (const contents of [mainWindow?.webContents, pluginSurfaceView?.webContents]) {
    if (contents && !contents.isDestroyed()) contents.send('web-ai:state', payload);
  }
}

function activateWebAiWindow(id) {
  const item = webAiViews.get(String(id || ''));
  if (!item) throw new Error('网页窗口不存在');
  if (webAiAttached && webAiView && webAiView !== item.view) {
    try { mainWindow.contentView.removeChildView(webAiView); } catch {}
    webAiAttached = false;
  }
  webAiView = item.view;
  activeWebAiViewId = item.id;
  if (!webAiAttached) { mainWindow.contentView.addChildView(webAiView); webAiAttached = true; }
  const bounds = webAiBounds(pluginSurfaceBounds);
  if (bounds) webAiView.setBounds(bounds);
  return item;
}

function createWebAiWindow(providerId) {
  const id = `web-${++webAiWindowSequence}`;
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:taskhive-web-ai' } });
  view.setBackgroundColor('#ffffff');
  view.webContents.setWindowOpenHandler(({ url }) => {
    void openWebAiWindow({ url, providerId, newWindow: true });
    return { action: 'deny' };
  });
  view.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const item = { id, providerId, title: WEB_AI_PROVIDERS[providerId]?.name || '新标签页', view };
  view.webContents.on('page-title-updated', (_event, nextTitle) => { item.title = String(nextTitle || item.title); emitWebAiState(); });
  for (const eventName of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'did-fail-load']) view.webContents.on(eventName, emitWebAiState);
  // The browser view is a second renderer inside the desktop window. It had the
  // web-ai state listeners but none of the logging the main window gets, so a
  // provider page that crashed or failed to load left no trace in
  // renderer-console.log and never touched smokeRendererErrors.
  attachRendererConsoleLogging(view.webContents, `web-ai:${providerId}`);
  attachRendererLifecycleLogging(view.webContents, `web-ai:${providerId}`);
  webAiViews.set(id, item);
  return item;
}

function normalizeWebAiUrl(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('请输入网页地址');
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅允许打开 HTTP 或 HTTPS 网页');
  return parsed.toString();
}

async function navigateWebAi(item, url, signal, options = {}) {
  if (options.attach !== false) activateWebAiWindow(item.id);
  const navigation = item.view.webContents.loadURL(normalizeWebAiUrl(url)).then(() => 'loaded').catch((error) => `error:${error.message}`);
  const navigationState = await Promise.race([navigation, delay(12000, signal).then(() => 'loading')]);
  emitWebAiState();
  return navigationState;
}

async function openWebAiWindow(input) {
  requirePluginEnabled('web-ai');
  const request = typeof input === 'string' ? { providerId: input } : (input || {});
  const providerId = String(request.providerId || 'google');
  const provider = WEB_AI_PROVIDERS[providerId] || { name: '网页', url: readBrowserPreferences().homepage };
  if (!provider) throw new Error('不支持的网页 AI provider');
  let item = request.newWindow === true || !activeWebAiViewId ? createWebAiWindow(providerId) : webAiViews.get(activeWebAiViewId);
  if (!item) item = createWebAiWindow(providerId);
  item.providerId = providerId;
  const navigationState = await navigateWebAi(item, request.url || provider.url);
  const state = webAiWindowState();
  return { ...state, activeId: item.id, providerId, providerName: provider.name, state: 'opened', navigationState, url: new URL(provider.url).origin, windowCount: state.windows.length, authentication: 'user-managed-browser-session' };
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const abort = () => done(Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 }));
    function done(error) {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      if (error) reject(error); else resolve();
    }
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

async function waitForWebAiComposer(item, model, deadline, signal, onShowLogin) {
  let loginSurfaceShown = pluginSurfaceKind === 'web-ai';
  const loginPromptAt = Date.now() + 1500;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 });
    const contents = item.view.webContents;
    if (contents.isDestroyed()) throw Object.assign(new Error('网页模型页面已关闭'), { code: 'PAGE_CLOSED' });
    if (!contents.isLoading()) {
      const state = await probePage(contents, { allowOffscreen: !webAiAttached }).catch(() => ({ ready: false }));
      if (state?.ready) return state;
    }
    if (!loginSurfaceShown && Date.now() >= loginPromptAt) {
      await showPluginSurface('web-ai');
      activateWebAiWindow(item.id);
      loginSurfaceShown = true;
      onShowLogin?.();
    }
    setWebAiBridgeState('waiting-login', model, 'AUTH_REQUIRED');
    await delay(500, signal);
  }
  throw Object.assign(new Error('等待网页登录超时，请完成登录后重试'), { code: 'AUTH_TIMEOUT', statusCode: 408 });
}

async function handleWebAiChat({ model, prompt, timeoutMs, signal }) {
  const providerId = providerIdForModel(model);
  if (!providerId || !WEB_AI_PROVIDERS[providerId]) throw Object.assign(new Error('不支持的网页模型'), { code: 'MODEL_NOT_FOUND', statusCode: 404 });
  const deadline = Date.now() + timeoutMs;
  let item = [...webAiViews.values()].find((candidate) => candidate.providerId === providerId && !candidate.view.webContents.isDestroyed());
  let loginSurfaceUsed = pluginSurfaceKind === 'web-ai';
  let loginSurfaceOpenedByBridge = false;
  let backgroundViewAttached = false;
  const abort = () => {
    setWebAiBridgeState('canceled', model, 'ABORTED');
    const contents = item?.view?.webContents;
    if (contents && !contents.isDestroyed()) void stopGeneration(contents).catch(() => {});
    if (pluginSurfaceKind === 'web-ai') hidePluginSurface('web-ai-bridge:abort');
  };
  signal?.addEventListener?.('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 });
    setWebAiBridgeState('opening', model);
    if (!item) {
      item = createWebAiWindow(providerId);
      await navigateWebAi(item, WEB_AI_PROVIDERS[providerId].url, signal, { attach: false });
    }
    if (!item) throw Object.assign(new Error('网页模型窗口创建失败'), { code: 'PAGE_UNAVAILABLE' });
    backgroundViewAttached ||= webAiAttached;
    await waitForWebAiComposer(item, model, deadline, signal, () => { loginSurfaceOpenedByBridge = true; });
    loginSurfaceUsed ||= pluginSurfaceKind === 'web-ai';
    setWebAiBridgeState('submitting', model);
    const submitted = await submitPrompt(item.view.webContents, prompt, { allowOffscreen: !webAiAttached });
    if (signal?.aborted) throw Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 });
    backgroundViewAttached ||= webAiAttached && !loginSurfaceUsed;
    lastWebAiSubmitProbe = { sent: submitted?.sent === true, method: submitted?.method || null, valueSet: submitted?.valueSet === true, pageAcknowledged: submitted?.pageAcknowledged === true, loginSurfaceUsed, loginSurfaceOpenedByBridge, backgroundHidden: !backgroundViewAttached };
    if (!submitted?.sent) throw Object.assign(new Error('网页模型输入框不可用，请重新登录'), { code: submitted?.code || 'COMPOSER_UNAVAILABLE', statusCode: 409 });
    if (pluginSurfaceKind === 'web-ai') hidePluginSurface('web-ai-bridge:generating');
    else hideWebAiView();
    const baseline = Array.isArray(submitted.baseline) ? submitted.baseline : [];
    let stableText = '';
    let stableCount = 0;
    setWebAiBridgeState('generating', model);
    while (Date.now() < deadline) {
      if (signal?.aborted) throw Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 });
      const state = await readAssistantState(item.view.webContents, { allowOffscreen: !webAiAttached }).catch(() => ({ texts: [], busy: true }));
      const candidates = Array.isArray(state.texts) ? state.texts : [];
      const text = candidates.slice(baseline.length).filter((value, index) => value !== baseline[index]).at(-1)
        || candidates.filter((value) => !baseline.includes(value)).at(-1)
        || '';
      if (text && text === stableText) stableCount += 1;
      else { stableText = text; stableCount = text ? 1 : 0; }
      if (stableText && stableCount >= 3 && !state.busy) {
        setWebAiBridgeState('completed', model);
        return { text: stableText };
      }
      await delay(500, signal);
    }
    setWebAiBridgeState('failed', model, 'RESPONSE_TIMEOUT');
    throw Object.assign(new Error('等待网页模型生成完成超时'), { code: 'RESPONSE_TIMEOUT', statusCode: 504 });
  } catch (error) {
    if (signal?.aborted || error?.code === 'ABORTED') {
      abort();
      throw Object.assign(new Error('网页模型请求已取消'), { code: 'ABORTED', statusCode: 499 });
    }
    setWebAiBridgeState('failed', model, String(error?.code || 'WEB_AI_FAILED'));
    throw error;
  } finally {
    signal?.removeEventListener?.('abort', abort);
  }
}

// T194 第 2 项：surface 切换的**归属**审计。真机上出现 `suspended`→0.7s→`resumed` 这种成对
// 抖动时，只读诊断能看到"被隐藏了"，看不到"是 `surface:open` 的哪个值、由哪条路径把它切走的"。
// 这里每个**真实**切换写一行（同值重复进入不写 —— 否则每一次 `surface:open` 都会刷一行），
// 并且把触发来源交给原生托管层写进它自己那行 `suspended` 里（noteSurfaceCause）。
let pendingSurfaceTrigger = 'unknown';

function auditPluginSurface(action, details = {}) {
  try {
    appendDiagnosticLog(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} plugin.surface.${action} ${JSON.stringify(details)}\n`);
  } catch { /* 审计绝不能成为 surface 切换的单点故障 */ }
}

function hidePluginSurface(trigger = 'unknown') {
  const previousKind = pluginSurfaceKind;
  const wasAttached = pluginSurfaceAttached === true;
  if (pluginSurfaceKind === 'codesys') {
    // T194：把触发来源交给原生托管层，让它写在那行 `suspended` 上。这行调用本身被契约
    // 逐字钉住（codesys-window-fit-contract.js 钉 `codesysNativeHost?.suspend('surface-hidden')`），
    // 所以线索走 noteSurfaceCause 而不是加参数。
    codesysNativeHost?.noteSurfaceCause?.({ kind: previousKind, trigger });
    void codesysNativeHost?.suspend('surface-hidden').catch((error) => fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} codesys-native-suspend ${error.message}\n`, 'utf8'));
  }
  if (previousKind || wasAttached) auditPluginSurface('hidden', { pluginSurfaceKind: previousKind, pluginSurfaceAttached: wasAttached, trigger, nativeHost: 'suspend:surface-hidden' });
  pluginSurfaceKind = null;
  hideWebAiView();
  if (!mainWindow || mainWindow.isDestroyed() || !pluginSurfaceView) return;
  if (!pluginSurfaceAttached) return;
  try { mainWindow.contentView.removeChildView(pluginSurfaceView); } catch { /* already detached */ }
  pluginSurfaceAttached = false;
}

function publishPluginSurfaceState(kind) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const surface = String(kind || 'chat');
  const pluginActive = Boolean(surface && surface !== 'chat' && surface !== 'settings');
  void mainWindow.webContents.executeJavaScript(`window.postMessage({source:'taskhive-desktop',type:'surface.state',surface:${JSON.stringify(surface)},pluginActive:${pluginActive}}, '*')`, true).catch(() => {});
}

function findCodesysInstaller() {
  const bases = [...new Set([process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean))];
  const relativeCandidates = [
    ['CODESYS', 'CODESYS Installer', 'CODESYS Installer.exe'],
    ['CODESYS', 'CODESYS Installer', 'CODESYSInstaller.exe'],
    ['CODESYS', 'CODESYS Installer.exe'],
  ];
  for (const base of bases) for (const parts of relativeCandidates) {
    const candidate = path.join(base, ...parts);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function verifyWindowsSignature(file) {
  if (process.platform !== 'win32' || !file || !fs.existsSync(file)) return Promise.resolve({ valid: false, status: 'Unavailable', signer: '' });
  const script = "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]; [pscustomobject]@{status=[string]$signature.Status; signer=[string]$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress";
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, file], { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (error) return resolve({ valid: false, status: 'VerificationFailed', signer: '' });
    try { const value = JSON.parse(String(stdout || '').trim()); resolve({ valid: value.status === 'Valid', status: value.status || 'Unknown', signer: value.signer || '' }); }
    catch { resolve({ valid: false, status: 'InvalidResult', signer: '' }); }
  }));
}

function hideWebAiView() {
  if (!webAiView || !webAiAttached || !mainWindow || mainWindow.isDestroyed()) return;
  try { mainWindow.contentView.removeChildView(webAiView); } catch {}
  webAiAttached = false;
}

function suspendChildViewsForClosePrompt() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const nativeStatus = codesysNativeHost?.status();
  const state = { pluginAttached: pluginSurfaceAttached, webAiAttached, resumeCodesysNative: pluginSurfaceKind === 'codesys' && nativeStatus?.attached === true && nativeStatus.suspended !== true };
  if (nativeStatus?.attached === true && nativeStatus.suspended !== true) void codesysNativeHost.suspend('close-prompt').catch(() => {});
  if (webAiAttached && webAiView) {
    try { mainWindow.contentView.removeChildView(webAiView); } catch {}
    webAiAttached = false;
  }
  if (pluginSurfaceAttached && pluginSurfaceView) {
    try { mainWindow.contentView.removeChildView(pluginSurfaceView); } catch {}
    pluginSurfaceAttached = false;
  }
  return state;
}

async function restoreChildViewsAfterClosePrompt(state) {
  if (!state || !mainWindow || mainWindow.isDestroyed()) return;
  if (state.pluginAttached && pluginSurfaceView && !pluginSurfaceAttached) {
    try { mainWindow.contentView.addChildView(pluginSurfaceView); pluginSurfaceAttached = true; } catch {}
  }
  if (state.webAiAttached && webAiView && !webAiAttached) {
    try { mainWindow.contentView.addChildView(webAiView); webAiAttached = true; } catch {}
  }
  if (state.resumeCodesysNative && pluginSurfaceKind === 'codesys') {
    const bounds = codesysNativeScreenBounds();
    if (bounds) await codesysNativeHost?.resume(bounds).catch(() => {});
  }
}

function shutdownApplication() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    directoryManifestWatcher?.close();
    directoryManifestWatcher = null;
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
    // 用户的删除要求（2026-10）：`monitor.stopAll()`（关闭全部实时画面流）随监视能力删除；
    // 窗口枚举本身没有需要收尾的后台任务。
    if (codesysNativeMoveTimer) clearTimeout(codesysNativeMoveTimer);
    codesysNativeMoveTimer = null;
    await codesysNativeHost?.detach('application-shutdown').catch(() => {});
    for (const fixtureWindow of [...codesysFixtureWindows]) if (!fixtureWindow.isDestroyed()) fixtureWindow.destroy();
    codesysFixtureWindows.length = 0;
    codesysInput?.revokeAll();
    // Drop any online authorization and detach the persistent online worker, so
    // TaskHive never exits leaving a live connection to a controller behind.
    codesysOnlineAuthorization.disarm('application-shutdown');
    try { await codesysScriptEngine?.stopOnlineSession('application-shutdown'); } catch { /* shutdown must continue */ }
    // Close the CODESYS instances this app launched (never one with unsaved
    // changes) so nothing is left running in the background after TaskHive exits.
    try {
      await closeLaunchedCodesysInstances('application-shutdown', codesysLaunchedRegistry?.pending() || []);
    } catch { /* shutdown must continue even if cleanup fails */ }
    codesysLaunchedRegistry?.markCleanExit();
    for (const task of terminalTasks.values()) {
      try {
        if (process.platform === 'win32' && task.child.pid) await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(task.child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
        else task.child.kill('SIGTERM');
      } catch {}
    }
    terminalTasks.clear();
    for (const item of webAiViews.values()) { try { item.view.webContents.close(); } catch {} }
    webAiViews.clear();
    webAiView = null;
    try { pluginSurfaceView?.webContents?.close(); } catch {}
    await harnessRuntime?.stop();
    await webAiBridge?.stop();
  })();
  return shutdownPromise;
}

// T183 第 2 项（预热）：把常驻 ScriptEngine 那 20–40 秒的启动**提前**到"用户刚切到 CODESYS
// 面板"这一刻，让它与用户选工程 / 绑工程重叠，而不是串在第一次读取前面。
//
// 三条纪律都落在这里：
//   · 后台：调用方不 await（见 showPluginSurface 的调用点），预热自己也排到 setImmediate 之后，
//     绝不在 surface 切换的同步路径上占用主进程；Windows 的启动路径根本不碰这个函数。
//   · 幂等 / 绝不双开：同一时刻只有一次预热尝试（这一个 in-flight promise），而引擎的
//     ensureOfflineWorker 自带等锁去重（offlineWorkerPending），两边合起来最多一个进程。
//   · 失败不影响任何功能：任何异常都在这里吃掉并记一条审计；读取/写入本来就有"单发进程"兜底，
//     预热起不来只是回到改前的速度。
// 「可取消」的形态就是这三条，而不是额外造一个 abort：预热**从不被任何人等待**（关停可以直接走，
// 常驻进程由引擎自己的退出钩子写停止文件收掉），重试受引擎熔断（offlineWorkerDisabledUntil）
// 约束，进程本身受空闲上限约束 —— 既不会一直重试，也不会永不退场。
let codesysOfflinePreheat = null;

// T196（A 项）：**提前预打开**。与上面的预热（只把常驻 ScriptEngine 拉起来）不同，它连
// "这个工程第一次被 CODESYS `projects.open`"那一笔也提前做掉 —— 真机 29,062 ms 里的大头
// 就是它（open 19.5–25 s + 首次 walk 3.5 s）。做法（见 scriptengine.cjs 的
// preopenProjectForRead）：建好绑定作业 → 在常驻 worker 里打开 → 把对象树写进按源内容
// 寻址的缓存（`cache/codesys-inspect/<源 sha>.json`）。之后"绑定 + 第一次真读"里绑定**接管**
// 那个作业（0 字节拷贝、0 次重开），读取直接命中缓存。
//
// 触发点按代码事实选了两处（互为补充；不新增任何 IPC 通道）：
//   ① 面板被摆到前台（下面 showPluginSurface 里与预热同一处）：整条链路上**最早**的一刻。
//      此刻还不知道工程路径，所以用**记住的上一次工程**（logs/codesys-last-project.json，
//      由"检测到工程"与"绑定成功"两处写入）。真机上"上次操作的工程"就是下一次要读的那一个；
//      猜错了的代价只是一次后台预打开（作业目录由既有保留策略回收，**绝不**写用户的工程）。
//   ② codesys:current-project 真的检测到工程：这是**最早确知路径**的一刻。
//      `current-project.detected` 之后紧接着就是 bind-project 与第一次 inspect（工作台
//      detectCurrentProject 里是连着的两步），所以这一刻发起已经是"提前"的极限。
// `codesys:list-windows` 只回窗口标题、`codesys:open-program` 只启动 GUI —— 两处都拿不到
// 工程路径（路径要等检测里的选项/锁文件扫描），所以不点火；它们的收益由②覆盖。
//
// 三条纪律（与预热同一套，逐条落在代码里）：
//   · 幂等：只有"同一条路径"的并发去重（codesysPreopenByPath），再加上引擎自己的两条跳过
//     规则（对象树缓存已热 / 已经为同一份内容预打开过），进程侧由 ensureOfflineWorker
//     等锁去重 —— 任何情况下都只会有一个 CODESYS worker、一次 `projects.open`；
//   · 不阻塞：调用方**绝不 await**（两处都是 `void` 点火），真正的工作排到 setImmediate 之后，
//     面板切换与检测回包一秒都不等它；
//   · 失败可见：成功 / 跳过 / 失败各一行 harness 审计；失败**只**影响这一次提速 ——
//     绑定与读取照旧（它们本来就有"自己建作业 + 自己开工程"的兜底）。
const codesysPreopenByPath = new Map();

function codesysLastProjectFile() {
  return path.join(root, 'logs', 'codesys-last-project.json');
}

// 记住"用户当前的工程"只是下一次开面板时的一次猜测：异步写、失败只记一行，
// 绝不进任何动作的关键路径。
function rememberCodesysProjectPath(projectPath) {
  const value = String(projectPath || '');
  if (!value) return;
  fs.promises.writeFile(codesysLastProjectFile(), `${JSON.stringify({ sourcePath: value, at: new Date().toISOString() })}\n`, 'utf8')
    .catch((error) => harness.append('codesys.preopen.remember.failed', { ok: false, error: String(error?.message || error).slice(0, 200) }));
}

function lastRememberedCodesysProjectPath() {
  try {
    const parsed = JSON.parse(fs.readFileSync(codesysLastProjectFile(), 'utf8'));
    const value = String(parsed?.sourcePath || '');
    // 只接受"现在依然存在的 .project"：记住的路径过期/被删掉时什么都不做。
    return value && path.extname(value).toLowerCase() === '.project' && fs.existsSync(value) ? value : '';
  } catch { return '' }
}

// 内层：点火一次预打开。**不 await、不抛** —— 任何异常都在这里吃掉并各记一行审计。
function preopenCodesysProject(reason, projectPath) {
  const value = String(projectPath || '');
  if (!value) return null;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    setImmediate(async () => {
      try {
        requirePluginEnabled('codesys-monitor');
        const result = await codesysScriptEngine.preopenProjectForRead(value, reason);
        // T200：这一行过去只写 preopened/skipped，而 `skipped` 取的还是 result.reason
        // —— 在预打开**真的失败**时那是触发点名（如 application-start），不是失败原因，
        // 于是"失败"和"按触发器名跳过"在审计里长得一模一样，正文则完全不存在。
        // 现在：skipped 用引擎自己的**结果**原因，error 用引擎带回来的**失败正文**
        // （成功路径 error 恒为空串、不加任何文字）。
        const preopenFailed = result?.preopened === false;
        harness.append('codesys.scriptengine.preopen', {
          reason, ok: result?.ok === true, preopened: result?.preopened === true,
          skipped: preopenFailed ? String(result?.skipped || result?.reason || '') : '',
          error: preopenFailed ? String(result?.error || '').slice(0, 400) : '',
          jobId: String(result?.jobId || ''), sourcePath: value,
          openMs: Number(result?.openMs) || 0, treeMs: Number(result?.treeMs) || 0,
          inspectCacheWritten: result?.inspectCacheWritten === true, ms: Date.now() - startedAt,
        });
        resolve(result);
      } catch (error) {
        harness.append('codesys.scriptengine.preopen.failed', { reason, ok: false, sourcePath: value, error: String(error?.message || error).slice(0, 300), ms: Date.now() - startedAt });
        resolve(null);
      }
    });
  });
}

// 外层：同一条路径绝不并发两次预打开（第二条加入在飞的那一个）。做完就放掉在飞标记，
// 于是"内容变了之后再开面板"还能再预打开一次（该不该真做事由引擎按源 sha 判断）。
function preopenCodesysProjectOnce(reason, projectPath) {
  const value = String(projectPath || '');
  if (!value) return null;
  let key = value.toLowerCase();
  try { key = path.resolve(value).toLowerCase() } catch { /* 非法路径就用原串当键 */ }
  const inFlight = codesysPreopenByPath.get(key);
  if (inFlight) return inFlight;
  const pending = preopenCodesysProject(reason, value);
  if (!pending) return null;
  codesysPreopenByPath.set(key, pending);
  void pending.catch(() => {}).then(() => { if (codesysPreopenByPath.get(key) === pending) codesysPreopenByPath.delete(key) });
  return pending;
}

// T199（②）：**三个触发点共用的一道门**。
//
// 为什么必须有它：probe / smoke 轮存在的目的是量"可比的启动路径与时序"，在它们里面点火既扰动
// 测量，又白起一个约 700 MB 的 CODESYS。T198 只给"应用启动"那一处加了门，于是触发点①
// （打开 CODESYS 面板）在探针里**真的点过火**，并在 `workspaces/codesys-scriptengine/jobs/`
// 留下过作业目录。
//
// 门只有这一处实现：调用方传自己的 mode，命中时这里留**一行**审计并返回 true，调用方立刻返回。
// 三个 mode 合起来就是"为什么这次没提速"的完整答案。
function preopenSmokeGateApplies(mode, reason) {
  if (!smokeLaunch()) return false;
  harness.append('codesys.scriptengine.preopen.skipped', { reason, ok: true, mode, skipped: 'smoke-or-probe-run' });
  return true;
}

// 触发点①：面板打开。连"读记住的路径"也排到 setImmediate 之后 —— surface 切换的同步路径上
// 一个字节都不多读，更不会等任何东西。
function preopenRememberedCodesysProject(reason) {
  setImmediate(() => {
    if (preopenSmokeGateApplies('codesys-surface-open', reason)) return;
    const remembered = lastRememberedCodesysProjectPath();
    if (remembered) preopenCodesysProjectOnce(reason, remembered);
  });
}

// T198（第①项）：**应用启动即点火**。上面两个触发点都排在"用户已经把 CODESYS 面板摆到前台 /
// 检测到工程"之后；真机上首次打开那 ~35 s 仍然落在用户操作**之后** —— 用户点"绑定并读取"到看见
// 结果之间的等待，取决于"预打开跑完了没有"（没跑完的那一支：中位 14,062 ms / max 38,924 ms）。
// 启动即点火把这段预打开挪到**用户操作之前**：应用一起来（窗口已建、启动路径已走完）就用
// `logs/codesys-last-project.json` 里记住的上一次工程把它点着，于是用户真去点的时候通常已经跑完
// （预打开跑完时：绑定 37 ms、缓存读 14 ms）。
//
// **诚实说明（不许说成"消除了 35 s"）**：总代价一个字节都没少 —— CODESYS `projects.open` 的
// ~20 s + worker 冷启动 ~13.5 s 照样要付，只是付款人从"等在那里的用户"换成"启动后的后台"。
// 代价是**每次启动**都会花约 38 s 的 CODESYS CPU/磁盘，并在空闲上限内常驻一个约 700 MB 的进程
// ——**即使这一次压根不用 CODESYS**。所以它必须可关，且默认值由用户拍板（本轮：默认开）。
//
// 开关（T199 ② 之后有两个来源，优先级**环境变量显式设置 > 界面设置 > 默认**）：
//   · 界面设置：设置页「启动」页签里的「启动时预打开 CODESYS 工程」，默认**开**，
//     持久化在应用自己的 userData 目录（见下面的 CODESYS_PREFERENCES_FILE 注释）；
//   · 环境变量 `TASKHIVE_CODESYS_PREOPEN_ON_START=0`（也接受 false / off / no，大小写不敏感）
//     —— 只在**显式**设置时生效，用来在自动化 / 排障时盖过界面。
// 关掉之后**一行都不点火**，只留一行 `codesys.scriptengine.preopen.skipped`。
//
// 纪律与前两个触发点逐条相同，另外两条：
//   · 没有记住的工程就**什么都不做**（不瞎开 ✗）：只用
//     `lastRememberedCodesysProjectPath()` 的答案，它要求路径现在仍存在且是 `.project`；
//   · smoke / probe 运行**跳过**：那些运行的目的是量"可比的启动路径与时序"，在它们里面点火既会
//     扰动测量，又会白白起一个 CODESYS 进程（探针自己的 `--probe-dsh-codesys-scriptengine`
//     有独立的、显式要求 opt-in 的入口）。
// 三种"没点火"（关掉 / smoke / 没记住）各留一行审计，于是"为什么这次没提速"在
// `logs/trajectory.jsonl` 里看得见，而不是静默。
const CODESYS_PREOPEN_ON_START_ENV = 'TASKHIVE_CODESYS_PREOPEN_ON_START';

// T199（②）：开关从"只有环境变量的隐藏旋钮"搬进**设置页**（见 app/renderer/renderer.js 的
// 「启动」页签），并**持久化**。用户不需要碰环境变量。
//
// 存在哪：应用自己的 `userData` 目录 —— 也就是 `startup-paths.js` 在启动时定下来的那个
// （打包后 = `<安装目录>\user-data`）。选它有两条硬理由：
//   · 它是**每台安装自己的可变状态**目录，`tools/check-tree-parity.js` 的 `user-data/**`
//     规则明确把它排除在外（"per-install mutable state"）。同一个开关因此可以在 dev / stage /
//     live 三棵树里各存一份而**不制造 DRIFT**；放进 `profiles/*.json` 就会：用户在这台机器上
//     把它关掉之后，live 树那个文件与另外两棵树的同名文件再也不可能字节相同。
//   · 读写的**机制**是既有的 `app/atomic-json.js`（readJson / writeJson：同目录临时文件 +
//     fsync + rename，保留一代 `.bak`，损坏时先隔离再从 `.bak` 恢复）——与 directories.json、
//     model-catalog.json、browser-preferences.json、codesys-transfer.json 完全同一条路径。
//     没有新造存储机制，也没有引入第二套配置读写代码。
const CODESYS_PREFERENCES_FILE = 'codesys-preferences.json';

function codesysPreferencesPath() {
  return path.join(app.getPath('userData'), CODESYS_PREFERENCES_FILE);
}

function readCodesysPreferences() {
  const value = readJson(codesysPreferencesPath(), {}, {
    label: `CODESYS 偏好 ${CODESYS_PREFERENCES_FILE}`,
    onProblem: (message) => reportBootstrapProblem(message),
  });
  return value && typeof value === 'object' ? value : {};
}

// 只按补丁改**已知字段**，其余原样保留；返回写盘之后的完整状态。
function writeCodesysPreferences(patch) {
  const next = { ...readCodesysPreferences(), ...patch, updatedAt: new Date().toISOString() };
  writeJson(codesysPreferencesPath(), next);
  return next;
}

// ── T231：抽屉里"上次选的模型 + 思考强度" ────────────────────────────────────────────────
//
// 用户报障原话：「还有一个事情，模型切换关闭程序打开之后为什么不会保存？」
//
// 为什么会丢（取证）：抽屉里那次切换是**会话级**的 —— `app/renderer/renderer.js` 的
// `codesysAiChatChangeModel` / `codesysAiChatChangeEffort` → 本文件 `codesys:ai-chat-model` 的
// `select` → 数据桥 shard 78 的 `setModel` → `directory.select({provider,model,reasoningEffort})` /
// `remote.session.selectModel({sessionId,…})`。DSH 把它写进**这条会话**的 `modelSelection` 投影；
// 重启之后建立的是**新会话**，投影是空的，于是回落到目录里的全局默认值 —— 这次选择从来没有被写进
// 任何**跨进程**的地方。所以"记住"必须落在主进程侧。
//
// 存在哪、为什么：**与 `preopenOnStart` 同一份文件、同一套读写**（`userData/codesys-preferences.json`
// + `app/atomic-json.js`）。不选渲染层那套 `localStorage`（抽屉宽度用的）有三条理由：
//   * 主进程这份对**渲染层重建 / 面板重新载入 / 换一个 surface 文档**都还在；localStorage 只活在那
//     一个渲染文档里；
//   * `user-data/**` 是三树比对（`tools/check-tree-parity.js`）明确排除的"每台安装自己的可变状态"，
//     所以它不会制造 DRIFT —— 换成 `profiles/*.json` 会；
//   * `tests/codesys-preopen-setting-contract.js` 已经把"这类偏好放 localStorage"的理由逐字否掉
//     （per-renderer、主进程看不见、profile 重置就没了）。同一份纪律，不另开一套存储。
const CODESYS_AI_MODEL_PREFERENCE_KEY = 'aiModelSelection';

// 归一：只有 `provider` + `model` 都非空才算一条可用的记忆；`reasoningEffort` 只在真有时才带上
// （空串 = "没选过等级"，与数据桥那一侧"根本不发这个字段"的口径一致，见 T202 / T186）。
function codesysAiModelPreferenceOf(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = String(value.provider || '').trim();
  const model = String(value.model || '').trim();
  if (!provider || !model) return null;
  const effort = String(value.reasoningEffort || '').trim();
  return { provider, model, ...(effort ? { reasoningEffort: effort } : {}) };
}

function readCodesysAiModelPreference() {
  return codesysAiModelPreferenceOf(readCodesysPreferences()[CODESYS_AI_MODEL_PREFERENCE_KEY]);
}

// 写入是**补丁式**的：`writeCodesysPreferences()` 先读回现有内容再合并，所以"启动时预打开"那个开关
// 与这条记忆互相不会把对方抹掉（两个字段住同一份文件）。
function writeCodesysAiModelPreference(selection) {
  const normalized = codesysAiModelPreferenceOf(selection);
  if (!normalized) return null;
  writeCodesysPreferences({ [CODESYS_AI_MODEL_PREFERENCE_KEY]: normalized });
  return normalized;
}

// 复合键 `provider/model` 拆回两半（`setModel` 的结果里没有 `selected` 时的兜底）。拆不开返回 null ——
// 宁可什么都不记，也不写半条记忆。
function codesysAiModelSelectionFromId(id) {
  const text = String(id || '');
  const slash = text.indexOf('/');
  if (slash <= 0 || slash === text.length - 1) return null;
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) };
}

// 一次成功的 `select` 该记下什么：provider/model 取 DSH 归一后的权威值（`value.selected`），退回刚
// 发出去的复合键；**强度只认这次请求显式带的那个** —— 数据桥在没带 `effort` 时会回报一个 provider
// 默认档（`value.effort`），照它存下来就等于替用户做了一个他没做的决定（T202 的口径：丢强度只留模型）。
function codesysAiModelRememberedFromSelect(value, id, effort) {
  const selected = value && value.selected && typeof value.selected === 'object' ? value.selected : null;
  const fallback = codesysAiModelSelectionFromId(id);
  const provider = String((selected && selected.provider) || (fallback && fallback.provider) || '');
  const model = String((selected && selected.model) || (fallback && fallback.model) || '');
  if (!provider || !model) return null;
  return codesysAiModelPreferenceOf({ provider, model, reasoningEffort: effort });
}

// 界面设置本身。缺省 = **开**（T198 用户拍板"做"，所以"默认值 = 当前行为"）。
function codesysPreopenOnStartSetting() {
  return readCodesysPreferences().preopenOnStart !== false;
}

// 环境变量是否被**显式**设置过（空字符串 / 未设置都算没设置）。
function codesysPreopenOnStartEnvRaw() {
  return String(process.env[CODESYS_PREOPEN_ON_START_ENV] ?? '').trim();
}

// 优先级：**环境变量显式设置 > 界面设置 > 默认（开）**。
// 环境变量存在的意义是"自动化 / 排障时盖过界面"，所以它只在**显式**给出时生效；
// 未设置（或空串）一律回落到界面设置，而界面设置的缺省是开。
function codesysPreopenOnStartEnabled() {
  const raw = codesysPreopenOnStartEnvRaw().toLowerCase();
  if (raw) return !['0', 'false', 'off', 'no'].includes(raw);
  return codesysPreopenOnStartSetting();
}

// 设置页上那**一行**代价说明（用户口径：这不是常驻噪音，是必要说明）。两句都是真机实测的
// 事实：关掉省什么（T198：每次启动约 38–67 s CODESYS CPU/磁盘 + 常驻约 669 MB，即使这一轮
// 压根不用 CODESYS），打开买到什么（预打开跑完时绑定 37 ms / 缓存读 14 ms）。
const CODESYS_PREOPEN_COST_NOTE = '关掉可省每次启动约 38–67 s 与约 670 MB 常驻；打开时你第一次「绑定并读取」通常已经跑完（绑定约 37 ms、缓存读约 14 ms）。';

function preopenRememberedCodesysProjectOnStart(reason = 'application-start') {
  // 点火本身排在 setImmediate 之后：`app.whenReady()` 的同步路径上只多一次函数调用 + 一次排程，
  // 读记住的路径、起进程、开工程一个都不在启动路径上。
  setImmediate(() => {
    try {
      if (!codesysPreopenOnStartEnabled()) {
        // 关掉有两个来源，分开记（否则"为什么这次没提速"在审计里看不出是用户关的还是
        // 自动化用环境变量盖掉的）：环境变量显式设置；或用户在设置页把开关关掉。
        if (codesysPreopenOnStartEnvRaw()) {
          harness.append('codesys.scriptengine.preopen.skipped', { reason, ok: true, mode: 'application-start', skipped: 'disabled-by-env', env: CODESYS_PREOPEN_ON_START_ENV });
        } else {
          harness.append('codesys.scriptengine.preopen.skipped', { reason, ok: true, mode: 'application-start', skipped: 'disabled-by-setting', source: 'settings-page' });
        }
        return;
      }
      if (preopenSmokeGateApplies('application-start', reason)) return;
      const remembered = lastRememberedCodesysProjectPath();
      if (!remembered) {
        harness.append('codesys.scriptengine.preopen.skipped', { reason, ok: true, mode: 'application-start', skipped: 'no-remembered-project' });
        return;
      }
      preopenCodesysProjectOnce(reason, remembered);
    } catch (error) {
      // 点火自己**不许**抛进任何路径：失败只等于"回到改前的速度"。
      try { harness.append('codesys.scriptengine.preopen.failed', { reason, ok: false, mode: 'application-start', error: String(error?.message || error).slice(0, 300) }); } catch { /* 审计也不许抛 */ }
    }
  });
}

function preheatCodesysOfflineWorker(reason) {
  if (codesysOfflinePreheat) return codesysOfflinePreheat;
  const startedAt = Date.now();
  codesysOfflinePreheat = new Promise((resolve) => {
    setImmediate(async () => {
      try {
        requirePluginEnabled('codesys-monitor');
        const worker = await codesysScriptEngine.ensureOfflineWorker(null);
        harness.append('codesys.scriptengine.preheat', { reason, ok: true, runToken: String(worker?.runToken || ''), ms: Date.now() - startedAt });
        resolve(worker);
      } catch (error) {
        harness.append('codesys.scriptengine.preheat.failed', { reason, ok: false, error: String(error?.message || error).slice(0, 300), ms: Date.now() - startedAt });
        resolve(null);
      } finally {
        // 放掉 in-flight 标记：进程死了 / 熔断过期之后，下一次切到面板要能重新预热。
        codesysOfflinePreheat = null;
      }
    });
  });
  return codesysOfflinePreheat;
}

async function showPluginSurface(kind) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // T143：**由 DSH 客户端插件自渲染的 surface 不挂原生视图**。knowledge 属于这一类
  //（见 T137：外壳把它映射成 renderChat）。之前宿主照样挂载那块 606×784 的原生
  // WebContentsView 盖在 DSH 之上 —— 它一旦没画出内容，用户看到的就是"知识库打开是空白"，
  // 而且出现与否取决于切换顺序，表现为**经常性**空白。
  if (DSH_RENDERED_SURFACES.has(String(kind || ''))) return hidePluginSurface(`show-plugin-surface:dsh-rendered:${String(kind || '')}`);
  const descriptor = surfaceDescriptors().find((item) => item.id === kind);
  if (!descriptor) return hidePluginSurface(`show-plugin-surface:no-descriptor:${String(kind || '')}`);
  if (kind !== 'web-ai') hideWebAiView();
  if (pluginSurfaceKind === 'codesys' && kind !== 'codesys') {
    // Do not hold the conversation surface hostage to PowerShell startup or
    // a slow CODESYS HWND transition. Queue the hide operation, but continue
    // switching after a short hand-off budget; the native host completes the
    // hide in the background and its transition queue serializes any resume.
    const suspend = codesysNativeHost?.suspend('plugin-switch').catch(() => {});
    if (suspend) await Promise.race([suspend, new Promise((resolve) => setTimeout(resolve, 350))]);
  }
  if (!pluginSurfaceView) {
    pluginSurfaceView = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    pluginSurfaceView.setBackgroundColor('#ffffff');
    // The shell carries the preload bridge; keep it pinned to app/renderer.
    guardWorkbenchNavigation(pluginSurfaceView.webContents, 'plugin-surface');
    attachRendererConsoleLogging(pluginSurfaceView.webContents, 'plugin-surface');
    attachRendererLifecycleLogging(pluginSurfaceView.webContents, 'plugin-surface');
  }
  // T193：**先把身份落笔，再让视图可见**。以前是先 `addChildView`（面板立刻可见）→ 预热 →
  // `await codesysNativeHost.resume(...)`（无超时）→ 才写 `pluginSurfaceKind`；那次 await 卡住时
  // 面板一直可见而 identity 停在旧值，面板专属通道被判成"不是面板"（真机 2604 条 blocked-ipc）。
  // `sameSurface` 在写之前取，保持原来"同一个 surface 再进来就早退"的语义不变。
  const sameSurface = pluginSurfaceKind === kind;
  const previousSurfaceKind = pluginSurfaceKind;
  if (!sameSurface) pluginSurfaceKind = kind;
  // T194 第 2 项：真实切换才写（同值重复进入不写），并带上触发来源与当时原生托管的可见性状态，
  // 这样下一次抖动可以直接对着两行日志（`plugin.surface.shown` / `plugin.surface.hidden`）
  // 说清"谁把面切走了"，而不是只能看到 `suspended`。
  if (!sameSurface) {
    const nativeState = codesysNativeHost?.status?.() || null;
    auditPluginSurface('shown', {
      pluginSurfaceKind: kind, previousPluginSurfaceKind: previousSurfaceKind, trigger: pendingSurfaceTrigger,
      attachedBefore: pluginSurfaceAttached === true, nativeAttached: nativeState?.attached === true,
      nativeSuspended: nativeState?.suspended === true, nativeWindowId: String(nativeState?.windowId || ''),
    });
  }
  if (!pluginSurfaceAttached) {
    mainWindow.contentView.addChildView(pluginSurfaceView);
    pluginSurfaceAttached = true;
  }
  if (pluginSurfaceBounds) pluginSurfaceView.setBounds(pluginSurfaceBounds);
  // T183 第 2 项（预热）：用户刚把 CODESYS 面板切到前台 —— 接下来极可能读工程，而"第一次读取"
  // 必须有常驻 ScriptEngine（现场实测冷启动 30,322 ms）。这里并发起预热（后台、幂等、失败不
  // 影响任何功能）。**触发点选它的理由是按代码事实**：`showPluginSurface('codesys')` 是唯一一处
  // "面板真的被摆到前台"的地方（surface:open → surfaceSwitchChain → 这里），比面板内任何一次 IPC
  // 都早；而面板里的 `codesys:current-project` 之后紧接着就是 bind-project 与第一次 inspect，
  // 那时才开始预热的话，30 秒的启动仍然会挡在第一次读取前面。
  if (kind === 'codesys') preheatCodesysOfflineWorker('codesys-surface-open');
  // T196（A 项）触发点①：面板刚被摆到前台，用户下一步极可能就是"绑定并读取"。此刻还不知道
  // 工程路径，所以用记住的上一次工程先把预打开点着（幂等、不阻塞、失败只记一行）。
  if (kind === 'codesys') preopenRememberedCodesysProject('codesys-surface-open');
  if (kind === 'codesys' && codesysNativeHost?.status().attached && codesysNativeHost.status().suspended) {
    const bounds = codesysNativeScreenBounds();
    // T193：这一处 await **必须有界**。resume 走 PowerShell / 窗口过渡队列，卡住时不抛错；
    // 上一条的对照是 1799 行给 suspend 的 350ms 预算 —— 同样的理由（"不要被一次窗口过渡拖住"），
    // 只是这里还多一层：它以前挡在"面板已经可见"与"identity 落笔"之间。超时后放行，让后续
    // 切换/渲染继续；native host 自己的过渡队列会把 resume 做完。
    if (bounds) {
      await Promise.race([
        codesysNativeHost.resume(bounds).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  }
  if (sameSurface) {
    if (!pluginSurfaceView.webContents.isLoading() && kind === 'web-ai' && activeWebAiViewId) activateWebAiWindow(activeWebAiViewId);
    return;
  }
  if (!pluginSurfaceLoaded) {
    try {
      await pluginSurfaceView.webContents.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { embed: '1', surface: 'chat' } });
      pluginSurfaceLoaded = true;
    } catch (error) {
      if (!/ERR_ABORTED\s*\(-3\)|ERR_ABORTED/i.test(String(error?.message || error))) throw error;
    }
  }
  // The renderer owns the surface composition. Reuse its DOM and ask it to
  // activate the requested surface instead of navigating the WebContentsView.
  if (pluginSurfaceLoaded) {
    await pluginSurfaceView.webContents.executeJavaScript(
      `window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:${JSON.stringify(kind)}}, '*')`,
      true,
    ).catch(() => {});
  }
  if (kind === 'web-ai' && activeWebAiViewId) activateWebAiWindow(activeWebAiViewId);
}

function codesysNativeScreenBounds(localBounds = codesysNativeLocalBounds) {
  if (!mainWindow || mainWindow.isDestroyed() || !pluginSurfaceBounds || !localBounds) return null;
  const content = mainWindow.getContentBounds();
  // T161：以上三者都在 **DIP 空间**（`getContentBounds()` 是 DIP，`pluginSurfaceBounds` 来自
  // 渲染层 CSS px，`localBounds` 来自 `getBoundingClientRect()`），而它最终直接进入
  // `SetWindowPos` —— **物理像素**，所以这里必须转换一次；100% 缩放下 `dipToScreenRect`
  // 是恒等变换，等于没改。
  // T187：这条转换**只在托管脚本是 per-monitor DPI aware 时才成立** —— 送出去的物理像素
  // 必须被按物理像素理解（见 win-window-host.ps1 的 DPI 说明）。修复前 powershell.exe 5.1
  // 默认是 DPI-UNAWARE，于是同一批数字被缩放**第二次**：实测 2026-10-04（本机 150%）
  // 请求 432,116,1476x1402 落到物理 648,174,2214x1631 —— 大了 1.5 倍、向右下偏移、超出屏幕
  // 底边，正是用户看到的"窗口位置不对、没在插件内部"。审计里它几乎看不出来，因为脚本回读
  // 时又除了 1.5，x/y/宽全部"相等"，只有高度撞上虚拟空间的 SM_CYMAXTRACK=1087 才漏出
  // maxDelta=315。脚本侧修好感知后，这里送出的四个数就是窗口**实际**落点（实测偏差 ≤1 px）。
  const dip = {
    x: Math.round(content.x + pluginSurfaceBounds.x + Number(localBounds.x || 0)),
    y: Math.round(content.y + pluginSurfaceBounds.y + Number(localBounds.y || 0)),
    width: Math.round(Number(localBounds.width || 0)),
    height: Math.round(Number(localBounds.height || 0)),
  };
  try {
    if (screen && typeof screen.dipToScreenRect === 'function') {
      const physical = screen.dipToScreenRect(mainWindow, dip);
      if (physical && Number(physical.width) > 0 && Number(physical.height) > 0) {
        return {
          x: Math.round(physical.x), y: Math.round(physical.y),
          width: Math.round(physical.width), height: Math.round(physical.height),
        };
      }
    }
  } catch { /* screen 不可用时走下面的手工换算 */ }
  // T187：出口单位必须**无条件**是物理像素（托管脚本现在按物理像素解释这四个数），所以
  // 兜底也不能再原样返回 DIP —— 那会重新变成"面板只有 2/3 大小"。用主窗口所在显示器的
  // scaleFactor 手工换算一次，与上面 `dipToScreenRect` 的结果一致（本机实测：
  // 288,77.33,984,934.67 DIP × 1.5 = 432,116,1476,1402，正是审计里那个请求）。
  const scaleFactor = Number(screen?.getDisplayNearestPoint?.({ x: dip.x, y: dip.y })?.scaleFactor) || 1;
  if (scaleFactor > 1) {
    return {
      x: Math.round(dip.x * scaleFactor), y: Math.round(dip.y * scaleFactor),
      width: Math.round(dip.width * scaleFactor), height: Math.round(dip.height * scaleFactor),
    };
  }
  return dip;
}

function scheduleCodesysNativeMove() {
  if (pluginSurfaceKind !== 'codesys' || !codesysNativeHost?.status().attached || codesysNativeHost.status().suspended || !codesysNativeLocalBounds) return;
  if (codesysNativeMoveTimer) clearTimeout(codesysNativeMoveTimer);
  codesysNativeMoveTimer = setTimeout(() => {
    codesysNativeMoveTimer = null;
    const bounds = codesysNativeScreenBounds();
    if (bounds) void codesysNativeHost.update(bounds).catch((error) => fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} codesys-native-move ${error.message}\n`, 'utf8'));
  }, 80);
}

function requirePluginEnabled(id) {
  if (!pluginEnabled(id)) throw new Error(`插件未启用：${id}`);
}

function processStillRunning(pid) {
  const value = Number(pid);
  if (!Number.isSafeInteger(value) || value <= 0) return false;
  try { process.kill(value, 0); return true; } catch { return false; }
}

// Process start time (epoch ms) for the PID-reuse guard. -1 when unknown.
function processStartTimeMs(pid) {
  const value = Number(pid);
  if (!Number.isSafeInteger(value) || value <= 0) return Promise.resolve(-1);
  const script = `try { [int64]((Get-Process -Id ${value} -ErrorAction Stop).StartTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } catch { -1 }`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (error) return resolve(-1);
    const parsed = Number(String(stdout || '').trim());
    resolve(Number.isFinite(parsed) ? parsed : -1);
  }));
}

// Close only the CODESYS instances THIS app launched that are safe to close.
// Unsaved work (the `*` title marker), an unverifiable PID or a recycled PID all
// keep the instance open — losing the user's editor is never acceptable.
async function closeLaunchedCodesysInstances(reason, records = []) {
  const closed = [];
  const kept = [];
  if (!records.length) return { closed, kept };
  let windows = [];
  try { windows = await monitor.listRawWindows(); } catch { windows = []; }
  for (const record of records) {
    const pid = Number(record?.pid) || 0;
    const window = windows.find((item) => Number(item.pid) === pid) || null;
    const running = processStillRunning(pid);
    const decision = classifyLaunchedInstance(record, {
      running,
      window,
      startedAtMs: running ? await processStartTimeMs(pid) : -1,
      reason,
    });
    if (decision.action === 'skip') continue;
    if (decision.action === 'keep') { kept.push({ pid, reason: decision.reason, title: String(window?.title || '') }); continue; }
    await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
    if (processStillRunning(pid)) kept.push({ pid, reason: 'kill-failed', title: String(window?.title || '') });
    else closed.push({ pid, title: String(window?.title || ''), reason });
  }
  try { fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} codesys-instances-cleanup reason=${reason} closed=${closed.length} kept=${kept.length} ${JSON.stringify({ closed, kept })}\n`, 'utf8'); } catch { /* logging is best effort */ }
  return { closed, kept };
}

function writeDshPatch() {
  const dshHome = harnessRuntime?.dshHome || path.join(runtimeRoot, 'profiles', 'dsh');
  const patchPath = path.join(dshHome, 'taskhive.patch.yml');
  const profileRoot = path.join(dshHome, 'profiles', 'web');
  const nodeModules = path.join(profileRoot, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  // Third-party DSH plugins are installed in their own repository folders.
  // Cordis resolves ESM peer imports from that folder first, so link the
  // bundled Harness packages into distill explicitly instead of relying on a
  // machine-global pnpm workspace. This keeps the copy/release self-contained.
  const ensureDistillPeers = () => {
    const distillDir = path.join(runtimeRoot, 'plugins', 'installed', 'distill');
    if (!fs.existsSync(path.join(distillDir, 'package.json'))) return;
    const pnpmRoot = path.join(runtimeRoot, 'harness', 'runtime', 'slot', 'payload', 'node_modules', '.pnpm');
    const scopeDir = path.join(distillDir, 'node_modules', '@deepseek-ai');
    fs.mkdirSync(scopeDir, { recursive: true });
    for (const name of ['schemastery', 'dsh-skill', 'dsh-tools', 'dsh-timeout']) {
      const packageDir = fs.readdirSync(pnpmRoot, { withFileTypes: true })
        .find((entry) => entry.isDirectory() && entry.name.startsWith(`@deepseek-ai+${name}@`));
      if (!packageDir) continue;
      const target = path.join(pnpmRoot, packageDir.name, 'node_modules', '@deepseek-ai', name);
      const link = path.join(scopeDir, name);
      let linked = false;
      try { linked = fs.realpathSync(link).toLowerCase() === fs.realpathSync(target).toLowerCase(); } catch { /* create below */ }
      if (linked) continue;
      try {
        const stat = fs.lstatSync(link);
        if (stat.isSymbolicLink()) fs.unlinkSync(link);
      } catch { /* absent */ }
      try { fs.symlinkSync(target, link, 'junction'); } catch (error) {
        fs.appendFileSync(path.join(runtimeRoot, 'logs', 'errors.log'), `${new Date().toISOString()} distill-peer ${name} ${error.message}\n`, 'utf8');
      }
    }
  };
  ensureDistillPeers();
  const packages = pluginManager?.dshPackages?.() || [];
  let bundledNames = new Set();
  try {
    const profile = JSON.parse(fs.readFileSync(path.join(profileRoot, 'package.json'), 'utf8'));
    bundledNames = new Set(profile?.dsh?.profile?.bundles || []);
  } catch { /* profile is created by the release layout or DSH */ }
  const linksPath = path.join(dshHome, 'plugin-links.json');
  let previousLinks = [];
  previousLinks = readJson(linksPath, { links: [] }, { label: '插件链接 profiles/dsh/plugin-links.json' })?.links || [];
  const activeNames = new Set(packages.map((item) => item.packageName));
  for (const packageName of previousLinks) {
    if (activeNames.has(packageName)) continue;
    const linkPath = path.join(nodeModules, ...packageName.split('/'));
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
    } catch { /* already absent */ }
  }
  for (const item of packages) {
    const linkPath = path.join(nodeModules, ...item.packageName.split('/'));
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    let linked = false;
    try { linked = fs.realpathSync(linkPath).toLowerCase() === fs.realpathSync(item.dir).toLowerCase(); } catch { /* create below */ }
    if (!linked) {
      try {
        if (fs.existsSync(linkPath) || fs.lstatSync(linkPath)) {
          const stat = fs.lstatSync(linkPath);
          if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
        }
      } catch { /* absent */ }
      try { fs.symlinkSync(item.dir, linkPath, 'junction'); } catch (error) {
        fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} plugin-link ${item.packageName} ${error.message}\n`, 'utf8');
      }
    }
  }
  writeJson(linksPath, { version: 1, links: [...activeNames].sort() });
  // A plugin's own `cordis.patch.yml` is only layered when the package is listed
  // in `dsh.profile.bundles`. Everything mounted through this generated `insert`
  // row lost its declared config: `dsh-mnemon` fell back to the plugin defaults
  // `routingGuidance: true` / `recallMode: "guided"` / `writebackMode: "guided"`,
  // which re-enabled the 30 s idle auto-review that its own patch disables.
  const declaredInsertConfig = (packageDir) => {
    let yaml = '';
    try { yaml = fs.readFileSync(path.join(packageDir, 'cordis.patch.yml'), 'utf8'); } catch { return []; }
    const lines = yaml.split(/\r?\n/);
    let inInsert = false;
    let inConfig = false;
    let configIndent = -1;
    const config = [];
    for (const line of lines) {
      if (/^\s*-\s*insert:\s*$/.test(line)) { inInsert = true; continue; }
      if (!inInsert) continue;
      const configMatch = line.match(/^(\s*)config:\s*$/);
      if (configMatch) { inConfig = true; configIndent = configMatch[1].length; continue; }
      if (!inConfig) continue;
      if (line.trim() === '') { config.push(line); continue; }
      if (line.match(/^\s*/)[0].length <= configIndent) break;
      config.push(line);
    }
    while (config.length && config[config.length - 1].trim() === '') config.pop();
    return config;
  };
  const inserts = packages
    .filter((item) => !bundledNames.has(item.packageName))
    .map((item) => {
      // Distill stays force-disabled by TaskHive policy (T019). Every other
      // plugin keeps the config it declares for itself.
      const config = item.packageName === '@loserfox/distill' ? ['        enabled: false'] : declaredInsertConfig(item.dir);
      const block = config.length ? `\n      config:\n${config.join('\n')}` : '';
      return `    - id: ${item.id}\n      name: '${item.packageName}'${block}`;
    });
  const patch = `# TaskHive1.0 model route\n- id: agent-default-model\n  config:\n    provider: ${modelCatalog.defaultRoute.providerId}\n    model: ${modelCatalog.defaultRoute.modelId}\n- id: llm-deepseek\n  disabled: true\n- id: web-search-deepseek\n  disabled: true\n${inserts.length ? `- insert:\n${inserts.join('\n')}\n` : '- insert: []\n'}`;
  // T149：落盘前的**最后一道断言** —— 只校验真正被插入 YAML 的两个值的字符集/换行。
  // （不要解析整份 patch 计数 `- id:`：合法的 `insert` 行本身就长这样，会误判。）
  const routeProvider = String((modelCatalog.defaultRoute && modelCatalog.defaultRoute.providerId) || '');
  const routeModel = String((modelCatalog.defaultRoute && modelCatalog.defaultRoute.modelId) || '');
  const providerOk = /^[a-z0-9._-]+$/i.test(routeProvider);
  const modelOk = /^[A-Za-z0-9._:\/@+-]*$/.test(routeModel);
  if (!providerOk || !modelOk || /[\r\n]/.test(`${routeProvider}${routeModel}`)) {
    const detail = `provider="${routeProvider}" model="${routeModel}"`;
    reportBootstrapProblem(`拒绝写入被污染的 DSH patch（${detail}）`);
    throw new Error(`模型路由包含非法字符，已拒绝写入 DSH 配置（${detail}）`);
  }
  fs.writeFileSync(patchPath, patch, 'utf8');
  return patchPath;
}

async function restartHarnessForPluginChange(result) {
  const runtime = await restartHarnessRuntime('plugin-change');
  return { ...result, runtime };
}

// T155：这些变量原先内联在 registerIpc() 里、被拆出的域函数引用，因此提升到模块作用域。
let surfaceSwitchChain = Promise.resolve();
let pendingSurfaceSwitch = '';

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerHarnessIpc() {
  handleTrusted('harness:status', () => ({ ...harness.status(), runtime: harnessRuntime?.status() || null, state: harnessRuntime?.status().state === 'ready' ? 'ready' : 'degraded' }));
  handleTrusted('harness:url', () => {
    return harnessWorkbenchUrl();
  });
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerSurfaceIpc() {
  onTrusted('surface:open', (event, kind) => {
    if (event.sender !== mainWindow?.webContents) return;
    const value = String(kind || '');
    pendingSurfaceSwitch = value;
    // T194 第 2 项：这条 IPC 的值就是"谁切的" —— 把它记成下一次 surface 切换的触发来源，
    // 它会出现在 `plugin.surface.shown` / `plugin.surface.hidden` 两行里，并通过
    // noteSurfaceCause 落到原生托管自己那行 `suspended` 上。
    pendingSurfaceTrigger = `surface:open:${value || 'chat'}`;
    publishPluginSurfaceState(value || 'chat');
    const dshRendered = !value || value === 'chat' || value === 'settings' || DSH_RENDERED_SURFACES.has(value);
    if (dshRendered) hidePluginSurface(`surface:open:${value || 'chat'}`);
    surfaceSwitchChain = surfaceSwitchChain.then(async () => {
      // 已被更新的请求取代 → 直接放弃，避免旧页面在最后时刻覆盖新页面。
      if (pendingSurfaceSwitch !== value || dshRendered) return;
      try {
        await showPluginSurface(value);
      } catch (error) {
        fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} surface-open ${value} ${error.stack || error}\n`, 'utf8');
      }
    }).catch(() => { /* 链上不保留异常，避免后续切换被卡住 */ });
  });
  onTrusted('surface:geometry', (event, input) => {
    if (event.sender !== mainWindow?.webContents) return;
    lastSurfaceGeometry = input && typeof input === 'object' ? structuredClone(input) : null;
    const bounds = normalizeSurfaceBounds(input);
    if (!bounds) return;
    pluginSurfaceBounds = bounds;
    if (pluginSurfaceView && pluginSurfaceAttached) pluginSurfaceView.setBounds(bounds);
    if (webAiView && webAiAttached) {
      const contentBounds = webAiBounds(bounds);
      if (contentBounds) webAiView.setBounds(contentBounds);
    }
    scheduleCodesysNativeMove();
  });
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerAppIpc() {
  onTrusted('app:close-confirmation-result', async (event, confirmed) => {
    if (event.sender !== mainWindow?.webContents || !closePromptInFlight) return;
    closePromptInFlight = false;
    if (confirmed === true) {
      quitting = true;
      await shutdownApplication();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      app.quit();
      return;
    }
    await restoreChildViewsAfterClosePrompt(suspendedCloseSurface);
    suspendedCloseSurface = null;
    mainWindow?.focus();
  });
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerModelIpc() {
  handleTrusted('models:list', async () => {
    const catalog = structuredClone(modelCatalog);
    // Health probes invoke local CLIs and drivers. Start them in the
    // background so opening the picker only reads the in-memory catalog.
    const health = modelHealthSnapshot();
    const codex = catalog.providers.find((item) => item.id === 'codex-cli');
    if (codex && !pluginEnabled('taskhive-codex-model')) codex.state = 'disabled';
    const claude = catalog.providers.find((item) => item.id === 'claude-code');
    if (claude) Object.assign(claude, health.claude);
    const vision = health.vision;
    const web = catalog.providers.find((item) => item.id === 'web-ai');
    if (web) Object.assign(web, { state: pluginEnabled('web-ai') ? 'ready' : 'disabled', capabilities: ['text', 'isolated-browser-session'], authentication: 'user-managed-browser-session', inputModalities: ['text'], vision: { state: 'unsupported', route: null, providers: [] } });
    const video = catalog.providers.find((item) => item.id === 'video-local');
    if (video) { const entries = fs.readdirSync(path.join(root, 'video-models'), { withFileTypes: true }).filter((entry) => entry.name.toLowerCase() !== 'readme.md'); Object.assign(video, { state: entries.length ? 'ready' : 'unconfigured', installedModels: entries.map((entry) => entry.name), capabilities: ['video-generation'] }); }
    // Config-driven providers (DeepSeek API, Ollama, every custom endpoint)
    // report readiness from their stored endpoint + credential instead of the
    // literal `unconfigured` baked into the catalog file, which previously made
    // them impossible to select even when fully configured.
    for (const provider of catalog.providers) provider.state = resolveConfiguredState(provider);
    decorateProviderCredentials(catalog);
    // 用户的删除要求（2026-10）：ModLens 已删除，所以这里不再给任何 provider 挂
    // `vision-via-modlens` 或把 inputModalities 提升为 `['text','image']`。改为**显式
    // 降级**：每个非网页 provider 都明确报告"视觉未接入"，界面因此可以说清事实，而
    // 不是继续显示一个已经不存在的能力。
    for (const provider of catalog.providers.filter((item) => !['video-local', 'web-ai'].includes(item.id))) {
      provider.capabilities = [...new Set([...(provider.capabilities || []), 'text'])];
      provider.vision = { ...vision, providers: [] };
      provider.inputModalities = ['text'];
    }
    catalog.visibleModels = catalog.providers.flatMap((provider) => (provider.models || []).filter((modelId) => catalog.visibility?.[`${provider.id}::${modelId}`] !== false).map((modelId) => ({ providerId: provider.id, providerName: provider.name, modelId, kind: provider.kind, state: provider.state, vision: provider.vision || null })));
    // Expose the catalog-refresh state so a caller (and the model smoke probe) can
    // tell whether a visibility change has reached the running client yet. Two
    // phases count as pending: the batched live-refresh window (`refreshing`) and
    // a workbench reload after a restart (`reloading`). Either way nobody may run
    // executeJavaScript against a client that has not re-rendered its model list.
    catalog.refreshState = { pending: Boolean(modelCatalogRefreshTimer) || modelCatalogRefreshState.phase === 'refreshing' || modelCatalogRefreshState.phase === 'reloading', ...modelCatalogRefreshState };
    return catalog;
  });
  handleTrusted('models:select', async (_event, input) => {
    const provider = modelCatalog.providers.find((item) => item.id === input?.providerId);
    const modelId = String(input?.modelId || '');
    if (!provider || !provider.models.includes(modelId)) throw new Error('模型不在受支持目录中');
    if (modelCatalog.visibility?.[`${provider.id}::${modelId}`] === false) throw new Error('模型已在设置中隐藏，不能作为默认路由');
    if (provider.id === 'codex-cli' && !pluginEnabled('taskhive-codex-model')) throw new Error('Codex 模型插件未启用');
    if (provider.id === 'claude-code') Object.assign(provider, await claudeCodeStatusAsync());
    if (provider.id === 'web-ai') provider.state = pluginEnabled('web-ai') ? 'ready' : 'disabled';
    // Recompute config-driven readiness (DeepSeek API / Ollama / any custom
    // endpoint) from the live credential store, so a freshly configured
    // endpoint is selectable without hand-editing the catalog file.
    if (['api', 'local'].includes(provider.kind)) provider.state = resolveConfiguredState(provider);
    if (provider.state !== 'ready') throw new Error(`${provider.name} 尚未完成认证或健康检查`);
    if (provider.id === 'web-ai') {
      modelCatalog.browserRoute = { providerId: provider.id, modelId };
      saveModelCatalog();
      harness.append('model.browser-route.changed', { providerId: provider.id, modelId, navigation: 'deferred-until-login-action' });
      return { catalog: structuredClone(modelCatalog), runtime: harnessRuntime.status(), requiresBrowserLogin: true };
    }
    modelCatalog.defaultRoute = { providerId: provider.id, modelId };
    saveModelCatalog();
    const runtime = await restartHarnessRuntime('model-route');
    harness.append('model.route.changed', { providerId: provider.id, modelId, runtime: runtime.slotRoot });
    return { catalog: structuredClone(modelCatalog), runtime };
  });
  handleTrusted('models:set-visible', (_event, input) => harness.runTool('models.set-visible', { providerId: input?.providerId, modelId: input?.modelId }, () => {
    const provider = modelCatalog.providers.find((item) => item.id === String(input?.providerId || ''));
    const modelId = String(input?.modelId || '');
    if (!provider?.models?.includes(modelId)) throw new Error('模型不存在');
    // Hiding is the mirror image of `models:select`, which refuses to make a
    // hidden model the default route. Nothing enforced the converse, so this
    // toggle could hide the model a turn is actually routed to and leave
    // `defaultRoute` pointing at an invisible route. The shipped catalog was
    // found in exactly that state (codex-cli/gpt-5.5 hidden while still the
    // default), which is the same "the composer model control vanished" family
    // as T049/T064. Refuse the edit rather than silently moving the user's route.
    if (input?.visible !== true && modelCatalog.defaultRoute?.providerId === provider.id && modelCatalog.defaultRoute?.modelId === modelId) {
      throw new Error('该模型是当前默认路由，不能隐藏：请先在输入框切换模型');
    }
    modelCatalog.visibility[`${provider.id}::${modelId}`] = input?.visible === true;
    saveModelCatalog();
    // The plugin watches this file, so writing it is the whole refresh: it
    // republishes the registry event and every loaded client re-reads the
    // catalog in place. Ticks are still batched so a burst of clicks settles
    // into one reported refresh instead of one per click.
    scheduleModelCatalogRefresh();
    return { providerId: provider.id, modelId, visible: input?.visible === true, refreshPending: true, lastRefresh: modelCatalogRefreshState };
  }));
  handleTrusted('models:add-custom', (_event, input) => harness.runTool('models.add-custom', { providerId: input?.providerId, modelId: input?.modelId }, () => {
    const providerId = String(input?.providerId || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    // T149：modelId 之前只 trim，随后会被**不加引号**拼进 DSH patch 的 YAML
    // （见 writeDshPatch 的 `model: ${...}`）。渲染层可借此注入 `\n- id: <插件>\n  disabled: false`
    // 之类顶层行，改写被强制禁用的插件配置 —— 属"渲染层 → 运行时插件配置"的越权写入。
    const modelId = String(input?.modelId || '').trim().replace(/[^A-Za-z0-9._:\/@+-]/g, '_');
    const name = String(input?.name || providerId).trim();
    const kind = ['api', 'local', 'cli'].includes(input?.kind) ? input.kind : 'api';
    if (!providerId || !modelId || !name) throw new Error('自定义模型需要 Provider ID、名称和 Model ID');
    if (modelCatalog.providers.some((item) => item.id === providerId)) throw new Error('Provider ID 已存在');
    if (kind === 'cli') throw new Error('自定义 CLI 提供方暂不支持：请使用 kind=api（OpenAI 兼容）或 kind=local（Ollama 兼容）');
    // `endpoint` + `apiKeyEnv` are what the adapter actually needs. Without them
    // a custom provider could be created but never make a request, so they are
    // required for api/local instead of being silently omitted.
    const endpoint = String(input?.endpoint || '').trim().replace(/\/+$/, '');
    if (kind === 'api' && !endpoint) throw new Error('API 兼容提供方需要填写服务地址（例如 https://api.example.com/v1）');
    if (endpoint && !/^https?:\/\//i.test(endpoint)) throw new Error('服务地址必须以 http:// 或 https:// 开头');
    const apiKeyEnv = String(input?.apiKeyEnv || '').trim() || `${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    const apiKey = String(input?.apiKey || '').trim();
    // `protocol: 'anthropic'` selects the Anthropic Messages adapter; anything
    // else uses the OpenAI-compatible chat-completions adapter.
    const protocol = String(input?.protocol || 'openai').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
    const entry = {
      id: providerId, name, kind, state: 'unconfigured',
      authentication: kind === 'local' ? 'local-runtime' : 'api-key',
      custom: true, models: [modelId],
    };
    if (endpoint) entry.endpoint = endpoint;
    if (kind === 'api') { entry.apiKeyEnv = apiKeyEnv; entry.protocol = protocol; }
    // Carry an optional model context limit so long-conversation budgeting stays
    // accurate for third-party endpoints.
    const contextWindow = Number.parseInt(input?.contextWindow, 10);
    if (Number.isFinite(contextWindow) && contextWindow > 0) entry.contextWindow = contextWindow;
    modelCatalog.providers.push(entry);
    if (apiKey) { const creds = readApiCredentials(); creds[providerId] = { ...(creds[providerId] || {}), apiKey }; writeApiCredentials(creds); }
    entry.state = resolveConfiguredState(entry);
    modelCatalog.visibility[`${providerId}::${modelId}`] = input?.visible !== false;
    saveModelCatalog();
    // The plugin registers a route for a newly declared api/local provider on its
    // own when the write lands, so no restart and no reload is needed here.
    scheduleModelCatalogRefresh();
    return { providerId, modelId, state: entry.state, endpoint: endpoint || null, apiKeyEnv: entry.apiKeyEnv || null, refreshPending: true };
  }));
  handleTrusted('models:set-credential', async (_event, input) => harness.runTool('models.set-credential', { providerId: input?.providerId }, async () => {
    const provider = modelCatalog.providers.find((item) => item.id === String(input?.providerId || ''));
    if (!provider) throw new Error('模型提供方不存在');
    if (!['api', 'local'].includes(provider.kind)) throw new Error(`${provider.name} 不使用 API 凭据`);
    const endpoint = input?.endpoint === undefined ? undefined : String(input.endpoint || '').trim().replace(/\/+$/, '');
    if (endpoint !== undefined) {
      if (endpoint && !/^https?:\/\//i.test(endpoint)) throw new Error('服务地址必须以 http:// 或 https:// 开头');
      if (endpoint) provider.endpoint = endpoint; else delete provider.endpoint;
    }
    if (provider.kind === 'api') provider.apiKeyEnv = String(input?.apiKeyEnv || '').trim() || apiKeyEnvName(provider);
    const creds = readApiCredentials();
    const next = String(input?.apiKey ?? '').trim();
    if (input?.apiKey !== undefined) {
      if (next) creds[provider.id] = { ...(creds[provider.id] || {}), apiKey: next };
      else delete creds[provider.id];
      writeApiCredentials(creds);
    }
    provider.state = resolveConfiguredState(provider);
    saveModelCatalog();
    // The Harness child only sees credentials through its environment, so it has
    // to be re-launched for a new key to take effect.
    const runtime = await restartHarnessRuntime('model-credential');
    harness.append('model.credential.updated', { providerId: provider.id, hasApiKey: Boolean(creds[provider.id]?.apiKey), endpoint: provider.endpoint || null, state: provider.state });
    return { providerId: provider.id, state: provider.state, hasApiKey: Boolean(creds[provider.id]?.apiKey), apiKeyMasked: maskApiKey(creds[provider.id]?.apiKey), endpoint: provider.endpoint || null, runtime };
  }));
  handleTrusted('models:remove-custom', (_event, providerId) => harness.runTool('models.remove-custom', { providerId }, () => {
    const index = modelCatalog.providers.findIndex((item) => item.id === String(providerId || '') && item.custom === true);
    if (index < 0) throw new Error('只能删除自定义模型提供方');
    const [removed] = modelCatalog.providers.splice(index, 1);
    for (const modelId of removed.models || []) delete modelCatalog.visibility[`${removed.id}::${modelId}`];
    const creds = readApiCredentials();
    if (creds[removed.id]) { delete creds[removed.id]; writeApiCredentials(creds); }
    saveModelCatalog();
    scheduleModelCatalogRefresh();
    return { providerId: removed.id, removed: true, refreshPending: true };
  }));
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerSettingsIpc() {
  handleTrusted('settings:directories', () => directoryStore.read());
  // T199（②）：设置页「启动」页签里的「启动时预打开 CODESYS 工程」。
  // 读回的值**不是**界面自己算的：`preopenOnStart` 是持久化的界面设置，`effective` 是把
  // 优先级（env 显式 > 界面 > 默认）算完之后**主进程真正会用的**那个值，`envOverride`
  // 说明环境变量是否正在盖过界面 —— 界面据此只说一行实话，而不是让用户以为开关生效了。
  handleTrusted('settings:codesys-preopen', () => ({
    preopenOnStart: codesysPreopenOnStartSetting(),
    persisted: typeof readCodesysPreferences().preopenOnStart === 'boolean',
    defaultValue: true,
    envOverride: Boolean(codesysPreopenOnStartEnvRaw()),
    envVariable: CODESYS_PREOPEN_ON_START_ENV,
    effective: codesysPreopenOnStartEnabled(),
    costNote: CODESYS_PREOPEN_COST_NOTE,
  }));
  handleTrusted('settings:codesys-preopen-save', (_event, input) => {
    if (typeof input?.preopenOnStart !== 'boolean') throw new Error('设置项「启动时预打开 CODESYS 工程」需要布尔值');
    return harness.runTool('settings.codesys-preopen-save', { preopenOnStart: input.preopenOnStart }, () => {
      writeCodesysPreferences({ preopenOnStart: input.preopenOnStart === true });
      const state = { preopenOnStart: codesysPreopenOnStartSetting(), effective: codesysPreopenOnStartEnabled() };
      // 设置变更留一行审计：下一次"为什么这次没提速 / 为什么起了 CODESYS"能直接对着这行看。
      harness.append('codesys.preopen.setting.changed', { ...state, source: 'settings-page' });
      return state;
    });
  });
  handleTrusted('settings:directory-save', (_event, input) => harness.runTool('settings.directory-save', { id: input?.id, previousId: input?.previousId }, () => directoryStore.upsert(input || {})));
  handleTrusted('settings:directory-remove', (_event, id) => harness.runTool('settings.directory-remove', { id }, () => directoryStore.remove(id)));
  handleTrusted('settings:directory-restore', () => harness.runTool('settings.directory-restore', {}, () => directoryStore.restore()));
  onTrusted('settings:visibility', (event, visible) => {
    if (event.sender !== mainWindow?.webContents) return;
    if (visible) {
      if (!suspendedSettingsSurface) suspendedSettingsSurface = suspendChildViewsForClosePrompt();
      return;
    }
    if (!closePromptInFlight) {
      void restoreChildViewsAfterClosePrompt(suspendedSettingsSurface);
      suspendedSettingsSurface = null;
    }
  });
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerPluginIpc() {
  handleTrusted('plugins:list', () => harness.runTool('plugins.list', {}, () => pluginManager.list()));
  handleTrusted('plugins:placement', (_event, input) => harness.runTool('plugins.placement', { id: input?.id, placement: input?.placement }, async () => {
    const result = pluginManager.setPlacement(input?.id, input?.placement);
    writeDshPatch();
    return { plugin: result, descriptors: surfaceDescriptors() };
  }));
  handleTrusted('plugins:order', (_event, input) => harness.runTool('plugins.order', { id: input?.id, order: input?.order }, async () => {
    const result = pluginManager.setOrder(input?.id, input?.order);
    writeDshPatch();
    return { plugin: result, descriptors: surfaceDescriptors() };
  }));
  handleTrusted('plugins:install', (_event, input) => harness.runTool('plugins.install', { source: input?.source }, async () => restartHarnessForPluginChange(await pluginManager.install(input || {}))));
  handleTrusted('plugins:uninstall', (_event, id) => harness.runTool('plugins.uninstall', { id }, async () => restartHarnessForPluginChange(pluginManager.uninstall(id))));
  handleTrusted('plugins:enable', (_event, id) => harness.runTool('plugins.enable', { id }, async () => restartHarnessForPluginChange(pluginManager.enable(id))));
  handleTrusted('plugins:disable', (_event, id) => harness.runTool('plugins.disable', { id }, async () => restartHarnessForPluginChange(pluginManager.disable(id))));
  handleTrusted('plugins:restore', (_event, id) => harness.runTool('plugins.restore', { id }, async () => restartHarnessForPluginChange(pluginManager.restore(id))));
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerRepositoryIpc() {
  handleTrusted('repositories:list', (_event, kind) => harness.runTool(`${kind}.list`, { kind }, () => repositories[kind].list()));
  handleTrusted('repositories:search', (_event, input) => harness.runTool(`${input?.kind}.search`, { kind: input?.kind, query: input?.query }, () => repositories[input.kind].search(input?.query)));
  handleTrusted('repositories:audit', (_event, kind) => harness.runTool(`${kind}.audit`, { kind }, () => repositories[kind].audit()));
  handleTrusted('repositories:install', (_event, input) => harness.runTool(`${input?.kind}.install`, { kind: input?.kind, source: input?.source }, () => repositories[input.kind].install(input.source)));
  handleTrusted('repositories:uninstall', (_event, input) => harness.runTool(`${input?.kind}.uninstall`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].uninstall(input.id)));
  handleTrusted('repositories:enable', (_event, input) => harness.runTool(`${input?.kind}.enable`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].enable(input.id)));
  handleTrusted('repositories:disable', (_event, input) => harness.runTool(`${input?.kind}.disable`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].disable(input.id)));
  handleTrusted('repositories:restore', (_event, input) => harness.runTool(`${input?.kind}.restore`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].restore(input.id)));
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
// T157：从 registerKnowledgeIpc() 里搬出的 AI 整理实现（原为 116 行的内联处理体）。
// 用当前会话模型，默认 DeepSeek：路由/凭据/分派细节见 T147/T148/T154 的记录。
async function classifyKnowledgeWithAi(input) {
  const cards = (repositories.knowledge.listCards('') || []).filter((card) => card.status === 'approved');
  if (!cards.length) return { ok: false, reason: '还没有已入库的卡片可整理' };
  const timeoutMs = Math.max(20000, Math.min(240000, Number(input && input.timeoutMs) || 120000));
  // T148：**用当前会话正在用的模型**，不再写死 codex。
  // `modelCatalog.defaultRoute` 就是模型设置里选中的路由（`models:select` 会改它，
  // 并同步进 Harness 的 `agent-default-model`），因此它 = 用户当前会话在用的 AI。
  // 然后按 provider 的 kind 分派：api（OpenAI/Anthropic 兼容）→ HTTP；codex-cli → codex exec；
  // cli（Claude Code）→ claude -p；local（Ollama）→ 本地 HTTP；web（网页 AI）→ 无法脚本调用。
  const route = {
    providerId: String((input && (input.providerId || input.provider)) || (modelCatalog.defaultRoute && modelCatalog.defaultRoute.providerId) || '').trim(),
    modelId: String((input && (input.modelId || input.model)) || (modelCatalog.defaultRoute && modelCatalog.defaultRoute.modelId) || '').trim(),
  };
  const provider = (modelCatalog.providers || []).find((item) => item.id === route.providerId) || null;
  // T154：默认 DeepSeek。显式指定 provider 时尊重调用方；否则优先用 DSH 配置里的 DeepSeek。
  const explicitProvider = Boolean(input && (input.providerId || input.provider));
  const deepseek = explicitProvider ? null : resolveDeepseekRoute();
  if (deepseek) {
    route.providerId = 'deepseek';
    route.modelId = deepseek.model;
  }
  const kind = deepseek ? 'deepseek' : (provider ? String(provider.kind || '').trim() : '');
  const label = deepseek ? 'DeepSeek' : (provider ? `${provider.name}${route.modelId ? ` · ${route.modelId}` : ''}` : (route.providerId || '未知模型'));
  const clean = (value, limit) => String(value || '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_>#|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit || 160);
  const lines = cards.map((card) => `- id=${card.id} | 标题：${clean(card.title, 60)} | 摘要：${clean(card.content, 180)}`).join('\n');
  const prompt = [
    '你是知识库整理助手。把下列已入库卡片归入「主题书」。',
    '规则：1) 每张卡片只归入一本书；2) 书名要具体、可复用（例如 自动化、Python、CODESYS、模型推理、插件开发、界面设计）；3) 书名不超过 8 个汉字或 2 个英文单词；4) 最多 8 本书；5) 只输出 JSON，不要任何解释或代码块标记。',
    '输出格式（严格）：{"books":{"书名":["卡片id","卡片id"]}}',
    '',
    lines
  ].join('\n');
  // 通用 CLI 运行器（codex / claude）：prompt 走 stdin，避免多行中文被引号/转义破坏。
  const runCli = (command, args) => new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn('cmd.exe', ['/c', command, ...args], {
      cwd: root, windowsHide: true, env: { ...process.env, NO_COLOR: '1' }
    });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      reject(new Error(`${label} 超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code === 0 && stdout.trim()) resolve(stdout);
      else reject(new Error((stderr || `${command} 退出码 ${code}`).toString().slice(0, 300)));
    });
    try { child.stdin.write(prompt); child.stdin.end(); } catch { /* close 事件会兜住 */ }
  });
  // HTTP 调用（带超时）：OpenAI 兼容 `${endpoint}/chat/completions` 或 Anthropic Messages。
  const postJson = async (url, headers, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  };
  const askModel = async () => {
    if (kind === 'deepseek') {
      // T154：DeepSeek（OpenAI 兼容 `${baseURL}/chat/completions`）。
      const data = await postJson(`${deepseek.baseURL}/chat/completions`,
        { 'content-type': 'application/json', authorization: `Bearer ${deepseek.apiKey}` },
        { model: deepseek.model, temperature: 0.2, stream: false, messages: [{ role: 'user', content: prompt }] });
      return (((data.choices || [])[0] || {}).message || {}).content || '';
    }
    if (kind === 'api') {
      const endpoint = String(effectiveProviderEndpoint(provider) || '').replace(/\/$/, '');
      const credentials = readApiCredentials();
      const apiKey = String((credentials[provider.id] && credentials[provider.id].apiKey) || process.env[apiKeyEnvName(provider)] || '').trim();
      if (!endpoint) throw new Error(`${label} 未配置端点`);
      if (!apiKey) throw new Error(`${label} 未配置 API Key`);
      if (String(provider.protocol || '') === 'anthropic') {
        const data = await postJson(`${endpoint}/v1/messages`,
          { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          { model: route.modelId, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] });
        return ((data.content || [])[0] || {}).text || '';
      }
      const data = await postJson(`${endpoint}/chat/completions`,
        { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        { model: route.modelId, temperature: 0.2, stream: false, messages: [{ role: 'user', content: prompt }] });
      return (((data.choices || [])[0] || {}).message || {}).content || '';
    }
    if (kind === 'codex-cli') {
      // `--skip-git-repo-check`：cwd 非 git 仓库时 codex 会直接拒绝；不传 `-m` 用其自身默认模型。
      return runCli('codex', ['exec', '--skip-git-repo-check', ...(route.modelId ? ['-m', route.modelId] : []), '-']);
    }
    if (kind === 'cli') return runCli('claude', ['-p', prompt]);
    if (kind === 'local') {
      const data = await postJson('http://127.0.0.1:11434/api/chat', { 'content-type': 'application/json' },
        { model: route.modelId, stream: false, messages: [{ role: 'user', content: prompt }] });
      return (data.message && data.message.content) || '';
    }
    throw new Error(`${label}（kind=${kind || 'unknown'}）暂不支持自动调用；请在模型设置里选择 API 或 CLI 模型`);
  };
  try {
    const output = await askModel();
    const match = output.match(/\{[\s\S]*"books"[\s\S]*\}/);
    if (!match) throw new Error('AI 未返回可解析的 JSON');
    const parsed = JSON.parse(match[0]);
    const byId = new Map(cards.map((card) => [String(card.id), card]));
    const applied = {};
    let moved = 0;
    for (const [book, ids] of Object.entries(parsed.books || {})) {
      const name = String(book || '').trim().slice(0, 40);
      if (!name || !Array.isArray(ids)) continue;
      for (const id of ids) {
        if (!byId.has(String(id))) continue;
        repositories.knowledge.setCardCategory(String(id), name);
        moved += 1;
      }
      applied[name] = (applied[name] || 0) + ids.filter((id) => byId.has(String(id))).length;
    }
    if (!moved) throw new Error('AI 返回的分书结果为空');
    harness.append('knowledge.ai.classify', { provider: route.providerId, kind, model: route.modelId, books: Object.keys(applied).length, cards: moved });
    return { ok: true, provider: route.providerId, kind, model: route.modelId, label, books: applied, cards: moved };
  } catch (error) {
    harness.append('knowledge.ai.classify.failed', { provider: route.providerId, kind, model: route.modelId, reason: String((error && error.message) || error).slice(0, 200) });
    return { ok: false, reason: String((error && error.message) || error), provider: route.providerId, kind, model: route.modelId, label };
  }
}
// ── T166 知识库导出 / 导入（单个可移植文件）—— 纯函数内核（自测切片区起点）────
// 用户口径（2026-10）：「知识库支持导出导入」。
// 这一块只依赖注入的 repositories / fs / path / pruneBackups，**不碰 electron**，
// 所以可以整段切出来在 Node 里用真实临时目录驱动（IPC 处理器只是"打开文件对话框 +
// 调这里"的薄壳）。不变式：
//   · 导出 = 一个 JSON 文件（schema + schemaVersion + exportedAt + 书 + 卡片 + 分类 +
//     书本元数据），默认扩展名 `.taskhive-kb.json`；目标路径只由主进程的保存对话框
//     决定，渲染层不传路径。
//   · 导入 = **先预检（只读解析 + 校验 + 摘要）再应用**。预检失败不写任何数据；应用
//     只接受预检产生的 token，所以渲染层也无法让主进程去读任意路径（沿 T158 的口径）。
//   · merge（默认）= 按稳定 id 合并：本机独有的卡片一张不丢；同 id 且内容不同的，
//     `updatedAt` 较新的一方胜出 —— 导入一份旧文件不会把本机较新的内容改回去。
//   · replace = 清空后导入，写入前先把现有 cards.json / books.json 备份进**既有的**
//     knowledge/backups（保留策略复用 plugins/catalog-shared.js 的 pruneBackups）。
//   · 任何失败路径都不留半截状态：两步写之间失败就用备份整份回滚。
const KB_BUNDLE_SCHEMA = 'taskhive.knowledge-bundle';
const KB_BUNDLE_VERSION = 1;
const KB_BUNDLE_MAX_BYTES = 64 * 1024 * 1024;
const KB_BUNDLE_IMPORT_TTL_MS = 30 * 60 * 1000;
let knowledgeImportPending = null;

// 卡片字段**白名单**：导入的文件不能往卡片里塞任意字段（也不会带进 __proto__ 之类）。
// 这是"导入一个 JSON"与"照着 JSON 合并"之间唯一的安全性差别。
function knowledgeCleanCard(input) {
  const card = input && typeof input === 'object' ? input : {};
  const text = (value, limit) => String(value == null ? '' : value).slice(0, limit);
  const clean = {
    id: text(card.id, 120),
    title: text(card.title, 300),
    content: text(card.content, 200000),
    type: text(card.type, 40) || 'question',
    tags: Array.isArray(card.tags) ? card.tags.slice(0, 20).map((tag) => text(tag, 40)) : [],
    source: text(card.source, 80),
    sourceSessionId: text(card.sourceSessionId, 120),
    sourceTaskId: text(card.sourceTaskId, 120),
    modelId: text(card.modelId, 120),
    evidenceHash: text(card.evidenceHash, 128),
    status: ['candidate', 'approved', 'rejected'].includes(String(card.status)) ? String(card.status) : 'candidate',
    revision: Number.isFinite(Number(card.revision)) ? Number(card.revision) : 0,
    createdAt: text(card.createdAt, 40),
    updatedAt: text(card.updatedAt, 40),
  };
  const category = text(card.category, 40).trim();
  if (category) clean.category = category;
  return clean;
}

function knowledgeCardSignature(card) {
  return JSON.stringify(knowledgeCleanCard(card));
}

function knowledgeCleanBook(input) {
  const book = input && typeof input === 'object' ? input : {};
  const color = String(book.color == null ? '' : book.color).trim().slice(0, 24);
  const clean = {};
  if (color) clean.color = color;
  return clean;
}

// ── T166b 按书导出 / 导入（用户口径 2026-10）───────────────────────────────
// 「导出应该是选择单本书导出…也可以选择多本」「导入也是导入单本书，可以选择导入多本」。
//
// 一本书 = 卡片的 category（`repositories/manager.js` 的 setBookMeta 改名时同步改 category）。
// 但渲染层还有一层**自动分类**（75-knowledge-view.js 的 kbCategoryOf：卡片没有 category 时
// 按关键词规则归入一本书）—— 这一层只存在于渲染层，主进程**不复制**这套规则，而是让渲染层把
// 结果随请求送进来：
//     { books: ['书名A', '书名B'], cards: ['卡id…'], bookIndex: { 卡id: '书名A' } }
// 三个字段都可以省略：省略 = 整库（老行为、老格式）。渲染层送来的卡 id 一律与本机存在的
// 卡片取交集 —— 参数再离谱也造不出本机没有的卡片，路径依旧只由文件对话框决定。
//
// 文件格式不变（schema/schemaVersion 仍是 v1）：只在"按书导出"时**多两个可选字段**
// （selection / bookIndex）。老版本 TaskHive 读到它们会照旧按 v1 全量导入，不会报错；
// 反过来，没有这两个字段的老包按"书 = category、没有 category 的归「未分类」"来分组，
// 仍然可以按书导入。
const KB_UNFILED_BOOK = '未分类';

function knowledgeBookKey(name) {
  return String(name == null ? '' : name).trim().slice(0, 40);
}

// 书 → 这个包里的卡片（保序）。书的来源有三处，缺一不可：bookIndex（导出端记录的归类）、
// 卡片自己的 category（老包只有这个）、books 元数据的键（可能是一本 0 张卡片的书）。
function knowledgeBookGroups(bundle) {
  const raw = bundle && bundle.bookIndex && typeof bundle.bookIndex === 'object' && !Array.isArray(bundle.bookIndex) ? bundle.bookIndex : null;
  const groups = new Map();
  const bucket = (name) => {
    const key = knowledgeBookKey(name) || KB_UNFILED_BOOK;
    if (!groups.has(key)) groups.set(key, []);
    return groups.get(key);
  };
  for (const card of (bundle && bundle.cards) || []) {
    const id = String((card && card.id) || '');
    const mapped = raw && id && Object.prototype.hasOwnProperty.call(raw, id) ? raw[id] : undefined;
    bucket(mapped === undefined ? (card && card.category) : mapped).push(card);
  }
  for (const name of Object.keys((bundle && bundle.books) || {})) bucket(name);
  return groups;
}

// 归一化的书本元数据（键按 knowledgeBookKey 收拢，切片时才查得到）。
function knowledgeNormalizedBooks(bundle) {
  const out = {};
  for (const [name, value] of Object.entries((bundle && bundle.books) || {})) {
    const key = knowledgeBookKey(name);
    if (key) out[key] = value;
  }
  return out;
}

// 按选中的书切出"一个小包"。apply 与 apply 前的摘要共用它 —— 预览说什么，写入就是什么。
function knowledgeSliceBundle(bundle, selectedBooks) {
  const wanted = new Set();
  for (const name of (Array.isArray(selectedBooks) ? selectedBooks : [])) wanted.add(knowledgeBookKey(name) || KB_UNFILED_BOOK);
  const meta = knowledgeNormalizedBooks(bundle);
  const cards = [];
  const books = {};
  const bookIndex = {};
  const names = [];
  for (const [name, list] of knowledgeBookGroups(bundle)) {
    if (!wanted.has(name)) continue;
    names.push(name);
    if (meta[name] !== undefined) books[name] = meta[name];
    for (const card of list) {
      cards.push(card);
      const id = String((card && card.id) || '');
      if (id) bookIndex[id] = name;
    }
  }
  return {
    schema: bundle.schema,
    schemaVersion: bundle.schemaVersion,
    exportedAt: bundle.exportedAt,
    selection: { scoped: true, books: names, cards: cards.length },
    books,
    bookIndex,
    cards,
  };
}

// 导出选择归一化：null = 整库；否则 { books, ids, bookIndex } 三个集合。
function knowledgeExportSelection(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!raw) return null;
  const hasBooks = Array.isArray(raw.books);
  const hasCards = Array.isArray(raw.cards);
  if (!hasBooks && !hasCards) return null;
  const books = new Set();
  for (const name of (hasBooks ? raw.books : [])) books.add(knowledgeBookKey(name) || KB_UNFILED_BOOK);
  const ids = new Set();
  for (const id of (hasCards ? raw.cards : [])) {
    const key = String(id == null ? '' : id).trim().slice(0, 120);
    if (key) ids.add(key);
  }
  const bookIndex = new Map();
  const map = raw.bookIndex && typeof raw.bookIndex === 'object' && !Array.isArray(raw.bookIndex) ? raw.bookIndex : null;
  if (map) {
    for (const [id, name] of Object.entries(map)) {
      const key = String(id == null ? '' : id).trim().slice(0, 120);
      if (key) bookIndex.set(key, knowledgeBookKey(name) || KB_UNFILED_BOOK);
    }
  }
  return { books, ids, bookIndex };
}

// 文件里的 bookIndex 先过一遍白名单清洗（id ≤120、书名 ≤40），脏字段不会进 pending。
function knowledgeCleanBookIndex(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [id, name] of Object.entries(input)) {
    const key = String(id == null ? '' : id).trim().slice(0, 120);
    if (!key) continue;
    out[key] = knowledgeBookKey(name) || KB_UNFILED_BOOK;
  }
  return out;
}

// 本机 → 可移植文件。`selection` 省略 = 整库（与 T166 的老输出**逐字同形**）。
function knowledgeBundleOf(selection) {
  const store = repositories.knowledge;
  const cards = store.cardsState();
  const books = store.booksState();
  const list = Array.isArray(cards.cards) ? cards.cards : [];
  const rawMeta = (books && books.books) || {};
  const chosen = knowledgeExportSelection(selection);
  if (!chosen) {
    return {
      schema: KB_BUNDLE_SCHEMA,
      schemaVersion: KB_BUNDLE_VERSION,
      app: 'TaskHive',
      exportedAt: new Date().toISOString(),
      counts: { cards: list.length, books: Object.keys(rawMeta).length },
      books: rawMeta,
      cards: list,
      revision: Number(cards.revision || 0),
    };
  }
  const meta = knowledgeNormalizedBooks({ books: rawMeta });
  const localBook = (card) => knowledgeBookKey(card && card.category) || KB_UNFILED_BOOK;
  const picked = list.filter((card) => {
    const id = String((card && card.id) || '');
    if (chosen.ids.has(id)) return true;
    return chosen.books.size > 0 && chosen.books.has(localBook(card));
  });
  const booksOut = {};
  const bookIndex = {};
  const names = new Set();
  for (const card of picked) {
    const id = String((card && card.id) || '');
    const name = chosen.bookIndex.get(id) || localBook(card);
    names.add(name);
    if (id) bookIndex[id] = name;
  }
  for (const name of names) if (meta[name] !== undefined) booksOut[name] = knowledgeCleanBook(meta[name]);
  return {
    schema: KB_BUNDLE_SCHEMA,
    schemaVersion: KB_BUNDLE_VERSION,
    app: 'TaskHive',
    exportedAt: new Date().toISOString(),
    counts: { cards: picked.length, books: Object.keys(booksOut).length },
    selection: { scoped: true, books: [...names], cards: picked.length },
    books: booksOut,
    bookIndex,
    cards: picked,
    revision: Number(cards.revision || 0),
  };
}

function knowledgeBundlePreview(bundle) {
  const bookNames = Object.keys(bundle.books || {});
  return {
    books: bookNames.slice(0, 6),
    bookCount: bookNames.length,
    cards: (bundle.cards || []).slice(0, 6).map((card) => card.title),
    cardCount: (bundle.cards || []).length,
  };
}

// 只读预检：解析 + 校验 schema/schemaVersion/结构。**不写任何数据**。
function knowledgeBundleInspect(text) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return { ok: false, error: '文件是空的（0 字节）', issues: [] };
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (error) { return { ok: false, error: `不是合法的 JSON：${error.message}`, issues: [] }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '文件内容不是一个知识库导出对象（顶层必须是 JSON 对象）', issues: [] };
  const issues = [];
  if (String(parsed.schema || '') !== KB_BUNDLE_SCHEMA) issues.push(`schema 必须是 "${KB_BUNDLE_SCHEMA}"，实际是 "${String(parsed.schema || '(缺失)')}"`);
  const version = Number(parsed.schemaVersion);
  if (!Number.isInteger(version) || version < 1) issues.push(`schemaVersion 必须是 ≥1 的整数，实际是 "${String(parsed.schemaVersion)}"`);
  else if (version > KB_BUNDLE_VERSION) issues.push(`文件由更新版本的 TaskHive 导出（schemaVersion=${version}，本机只支持到 ${KB_BUNDLE_VERSION}）`);
  if (!Array.isArray(parsed.cards)) issues.push('cards 必须是数组');
  if (parsed.books != null && (typeof parsed.books !== 'object' || Array.isArray(parsed.books))) issues.push('books 必须是对象（书名 → 元数据）');
  const list = Array.isArray(parsed.cards) ? parsed.cards : [];
  let problems = 0;
  list.forEach((card, index) => {
    const bad = (!card || typeof card !== 'object' || Array.isArray(card))
      ? '不是对象'
      : (!String(card.id || '').trim() ? '缺少 id' : (!String(card.title || '').trim() ? '缺少 title' : ''));
    if (!bad) return;
    problems += 1;
    if (issues.length < 8) issues.push(`cards[${index}] ${bad}`);
  });
  if (problems > issues.length) issues.push(`…另有 ${problems - issues.length} 处同类问题`);
  // T166b：bookIndex（卡片 id → 书名）是可选字段。老包没有它 —— 那不是错误，
  // 只是"按书导入"时只能按卡片自己的 category 分组（没有 category 的归「未分类」）。
  if (parsed.bookIndex != null && (typeof parsed.bookIndex !== 'object' || Array.isArray(parsed.bookIndex))) issues.push('bookIndex 必须是对象（卡片 id → 书名）');
  if (problems) return { ok: false, error: `文件结构不符合知识库导出格式（${problems} 处问题）`, issues: issues.slice(0, 9) };
  if (issues.length) return { ok: false, error: `文件结构不符合知识库导出格式（${issues.length} 处问题）`, issues: issues.slice(0, 9) };
  const bundle = {
    schema: KB_BUNDLE_SCHEMA,
    schemaVersion: version,
    exportedAt: String(parsed.exportedAt || ''),
    books: (parsed.books && typeof parsed.books === 'object') ? parsed.books : {},
    cards: list.map(knowledgeCleanCard).filter((card) => card.id && card.title),
  };
  const bookIndex = knowledgeCleanBookIndex(parsed.bookIndex);
  if (Object.keys(bookIndex).length) bundle.bookIndex = bookIndex;
  return {
    ok: true,
    bundle,
    summary: knowledgeBundleSummary(bundle),
    preview: knowledgeBundlePreview(bundle),
    // 按书的明细：渲染层据此渲染"选择要导入的书"多选列表，并把选中的书回传给 apply。
    books: knowledgeBookPreview(bundle),
    scoped: Boolean(parsed.selection || Object.keys(bookIndex).length),
  };
}

// 预检的"按书"明细：这本书在文件里有多少张卡片、本机已有几张、新增/更新/保留/相同各多少。
// 判定直接复用 knowledgeBundleSummary（与真正合并**同一套逻辑**），所以预览不可能与写入不一致。
function knowledgeBookPreview(bundle) {
  const store = repositories.knowledge;
  const local = store.cardsState();
  const localIds = new Set((Array.isArray(local.cards) ? local.cards : []).map((card) => String(card.id)));
  const meta = knowledgeNormalizedBooks(bundle);
  const localBooks = (store.booksState() || {}).books || {};
  const out = [];
  for (const [name, list] of knowledgeBookGroups(bundle)) {
    const sub = { cards: list, books: meta[name] === undefined ? {} : { [name]: meta[name] } };
    out.push({
      name,
      cards: list.length,
      localCards: list.filter((card) => localIds.has(String(card.id))).length,
      hasMeta: Boolean(localBooks[name]),
      summary: knowledgeBundleSummary(sub),
    });
  }
  return out;
}

// 同 id 且内容不同时谁胜出：updatedAt 较新者；完全相同的时间戳让**导入方**胜出
//（用户刚刚明确选了这个文件），导入方没有时间戳时不覆盖本机已有的。
function knowledgeIncomingWins(incoming, prior) {
  const left = String(incoming.updatedAt || '');
  const right = String(prior.updatedAt || '');
  if (left === right) return true;
  if (!left) return false;
  if (!right) return true;
  return left > right;
}

// 预检摘要：将新增/更新/保留多少书与卡片（预检与真正合并必须用同一套判定）。
function knowledgeBundleSummary(bundle) {
  const store = repositories.knowledge;
  const local = store.cardsState();
  const localBooks = (store.booksState() || {}).books || {};
  const localById = new Map((Array.isArray(local.cards) ? local.cards : []).map((card) => [String(card.id), card]));
  const cards = { total: (bundle.cards || []).length, added: 0, updated: 0, keptLocal: 0, identical: 0 };
  for (const card of bundle.cards || []) {
    const prior = localById.get(String(card.id));
    if (!prior) { cards.added += 1; continue; }
    if (knowledgeCardSignature(prior) === knowledgeCardSignature(card)) { cards.identical += 1; continue; }
    if (knowledgeIncomingWins(card, prior)) cards.updated += 1; else cards.keptLocal += 1;
  }
  const books = { total: 0, added: 0, updated: 0, identical: 0 };
  for (const [name, value] of Object.entries(bundle.books || {})) {
    const key = String(name).trim().slice(0, 40);
    if (!key) continue;
    books.total += 1;
    const prior = localBooks[key];
    if (!prior) { books.added += 1; continue; }
    if (JSON.stringify(knowledgeCleanBook(prior)) === JSON.stringify(knowledgeCleanBook(value))) books.identical += 1;
    else books.updated += 1;
  }
  return { cards, books, local: { cards: localById.size, books: Object.keys(localBooks).length } };
}

function knowledgeMergeInto(localCards, localBooks, bundle) {
  const out = (Array.isArray(localCards) ? localCards : []).map((card) => ({ ...card }));
  const index = new Map(out.map((card, at) => [String(card.id), at]));
  const counts = { total: 0, added: 0, updated: 0, keptLocal: 0, identical: 0 };
  for (const raw of bundle.cards || []) {
    const card = knowledgeCleanCard(raw);
    if (!card.id || !card.title) continue;
    counts.total += 1;
    const at = index.get(card.id);
    if (at === undefined) { index.set(card.id, out.length); out.push(card); counts.added += 1; continue; }
    const prior = out[at];
    if (knowledgeCardSignature(prior) === knowledgeCardSignature(card)) { counts.identical += 1; continue; }
    if (knowledgeIncomingWins(card, prior)) { out[at] = card; counts.updated += 1; continue; }
    counts.keptLocal += 1;
  }
  const books = { ...(localBooks || {}) };
  const bookCounts = { total: 0, added: 0, updated: 0, identical: 0 };
  for (const [name, value] of Object.entries(bundle.books || {})) {
    const key = String(name).trim().slice(0, 40);
    if (!key) continue;
    bookCounts.total += 1;
    const clean = knowledgeCleanBook(value);
    if (!books[key]) { books[key] = clean; bookCounts.added += 1; continue; }
    if (JSON.stringify(knowledgeCleanBook(books[key])) === JSON.stringify(clean)) { bookCounts.identical += 1; continue; }
    books[key] = { ...knowledgeCleanBook(books[key]), ...clean };
    bookCounts.updated += 1;
  }
  return { cards: out, books, counts, bookCounts };
}

// 备份到**既有**的 knowledge/backups（repositories/manager.js 的 this.backups）。
// 这里用"目录 + 拷贝"而不是 moveToBackup()：moveToBackup 产出的是**文件**，
// 而 catalog-shared.js 的 pruneBackups 只按目录做保留分组 —— 文件备份会永不回收。
// 目录名 `knowledge-before-import-<ts>` 正好匹配 pruneBackups 的 `-<digits>` 归组规则。
function knowledgeBackupStore(label) {
  const store = repositories.knowledge;
  const backupsDir = store.backups;
  const dir = path.join(backupsDir, `${label || 'knowledge-store'}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  let copied = 0;
  for (const file of [store.cardsPath, store.booksPath]) {
    if (!file || !fs.existsSync(file)) continue;
    fs.copyFileSync(file, path.join(dir, path.basename(file)));
    copied += 1;
  }
  if (!copied) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 空目录无需清理 */ }
    return '';
  }
  pruneBackups(backupsDir, 2);
  return dir;
}

function knowledgeRestoreBackup(dir) {
  if (!dir) return false;
  const store = repositories.knowledge;
  let restored = false;
  for (const file of [store.cardsPath, store.booksPath]) {
    if (!file) continue;
    const from = path.join(dir, path.basename(file));
    if (!fs.existsSync(from)) continue;
    try { fs.copyFileSync(from, file); restored = true; } catch { /* 尽力而为 */ }
  }
  return restored;
}

// 应用预检结果（merge | replace）。只认预检产生的 token。
// `selectedBooks`（T166b，可选）= 用户在预检面板里勾选的书名；省略 = 整份文件
//（等价于"全部书都勾上"，老调用方式因此原样可用）。选中哪几本就只导入哪几本 ——
// replace 的语义不变：清空本机后只写入**选中的那几本**（面板上会写明这一点）。
function knowledgeApplyImport(mode, token, selectedBooks) {
  const pending = knowledgeImportPending;
  if (!pending || !pending.bundle) throw new Error('没有待应用的导入预检：请先选择文件并等待预检完成');
  if (token && String(token) !== pending.token) throw new Error('导入预检已失效：请重新选择文件');
  if (Number(pending.expiresAt || 0) < Date.now()) {
    knowledgeImportPending = null;
    throw new Error(`导入预检已超过 ${Math.round(KB_BUNDLE_IMPORT_TTL_MS / 60000)} 分钟有效期：请重新选择文件`);
  }
  const scoped = Array.isArray(selectedBooks);
  const bundle = scoped ? knowledgeSliceBundle(pending.bundle, selectedBooks) : pending.bundle;
  if (scoped && !(bundle.cards || []).length && !Object.keys(bundle.books || {}).length) {
    // 预检还在（用户可以直接改勾选再来一次），所以这里**不**清 pending、更不写任何数据。
    throw new Error('没有勾选任何要导入的书：请在预检面板里至少勾选一本书（没有写入任何数据）');
  }
  const store = repositories.knowledge;
  const local = store.cardsState();
  const localBooks = store.booksState();
  const revision = Number(local.revision || 0) + 1;
  const replace = mode === 'replace';
  const merged = replace
    ? (() => {
      const cards = (bundle.cards || []).map(knowledgeCleanCard).filter((card) => card.id && card.title);
      const books = {};
      for (const [name, value] of Object.entries(bundle.books || {})) {
        const key = String(name).trim().slice(0, 40);
        if (key) books[key] = knowledgeCleanBook(value);
      }
      return {
        cards,
        books,
        counts: { total: cards.length, added: cards.length, updated: 0, keptLocal: 0, identical: 0 },
        bookCounts: { total: Object.keys(books).length, added: Object.keys(books).length, updated: 0, identical: 0 },
      };
    })()
    : knowledgeMergeInto((local.cards || []), (localBooks || {}).books, bundle);
  // 两种模式都先备份：replace 是硬要求（会清空），merge 会覆盖同 id 的卡片内容，
  // 备份成本是两份小 JSON，保留策略由 pruneBackups(2) 控住。
  const backup = knowledgeBackupStore('knowledge-before-import');
  try {
    store.saveCards({ version: 1, revision, cards: merged.cards });
    store.saveBooks({ version: 1, books: merged.books });
  } catch (error) {
    // 半截状态不可接受：cards 写成功而 books 写失败时，用备份把整份恢复回去。
    const rolledBack = backup ? knowledgeRestoreBackup(backup) : false;
    knowledgeImportPending = null;
    throw new Error(`导入失败${rolledBack ? '，已回滚到导入前状态' : '（未能自动回滚，请使用备份目录恢复）'}：${String((error && error.message) || error)}`);
  }
  knowledgeImportPending = null;
  return {
    ok: true,
    mode: replace ? 'replace' : 'merge',
    path: pending.path,
    backup,
    revision,
    cards: merged.counts,
    books: merged.bookCounts,
    selectedBooks: scoped ? (bundle.selection || {}).books || [] : null,
    snapshot: { cards: merged.cards.length, books: Object.keys(merged.books).length },
  };
}
// ── T166 区块结束 ──

function registerKnowledgeIpc() {
  handleTrusted('knowledge:cards', (_event, query) => harness.runTool('knowledge.cards', { query }, () => repositories.knowledge.listCards(query)));
  handleTrusted('knowledge:create-card', (_event, input) => harness.runTool('knowledge.card.create', { title: input?.title }, () => repositories.knowledge.createCard(input || {})));
  handleTrusted('knowledge:capture-conversation', (_event, input) => harness.runTool('knowledge.card.capture-conversation', { title: input?.title, sourceSessionId: input?.sourceSessionId, sourceTaskId: input?.sourceTaskId }, () => repositories.knowledge.createCard({ ...(input || {}), source: input?.source || 'conversation-task-area', type: input?.type || 'conversation' })));
  handleTrusted('knowledge:review-card', (_event, input) => harness.runTool('knowledge.card.review', { id: input?.id, decision: input?.decision }, () => repositories.knowledge.reviewCard(input?.id, input?.decision)));
  handleTrusted('knowledge:set-card-category', (_event, input) => harness.runTool('knowledge.card.category', { id: input?.id, category: input?.category }, () => repositories.knowledge.setCardCategory(input?.id, input?.category)));
  handleTrusted('knowledge:set-cards-category', (_event, input) => harness.runTool('knowledge.cards.category', { count: (input?.ids || []).length, category: input?.category }, () => repositories.knowledge.setCardsCategory(input?.ids, input?.category)));
  handleTrusted('knowledge:ai-classify', (_event, input) => classifyKnowledgeWithAi(input));
  handleTrusted('knowledge:books', () => repositories.knowledge.booksState());
  handleTrusted('knowledge:ai-route', () => {
    const route = modelCatalog.defaultRoute || {};
    const provider = (modelCatalog.providers || []).find((item) => item.id === route.providerId) || null;
    return {
      providerId: route.providerId || '',
      modelId: route.modelId || '',
      kind: provider ? String(provider.kind || '') : '',
      label: provider ? `${provider.name}${route.modelId ? ` · ${route.modelId}` : ''}` : (route.providerId || '未知模型'),
    };
  });
  handleTrusted('knowledge:set-book-meta', (_event, input) => harness.runTool('knowledge.book.meta', { from: input?.from, title: input?.title, color: input?.color }, () => repositories.knowledge.setBookMeta(input?.from, { title: input?.title, color: input?.color })));
  handleTrusted('knowledge:sync-status', () => harness.runTool('knowledge.sync.status', {}, () => repositories.knowledge.syncStatus()));
  handleTrusted('knowledge:repositories', () => {
    const base = path.join(root, 'knowledge');
    let catalog = null;
    try { catalog = JSON.parse(fs.readFileSync(path.join(base, 'catalog.json'), 'utf8')); } catch { catalog = null; }
    const repoRoot = path.join(base, 'repositories');
    let names = [];
    try {
      names = fs.readdirSync(repoRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch { names = []; }
    const repositoriesOut = [];
    for (const name of names) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, name, 'knowledge.json'), 'utf8'));
        repositoriesOut.push({
          id: manifest.id || name,
          name: manifest.name || name,
          version: manifest.version || '',
          description: manifest.description || '',
          license: manifest.license || '',
          source: manifest.source || '',
          entries: Array.isArray(manifest.entries) ? manifest.entries : [],
        });
      } catch { /* 缺失或损坏的清单直接跳过，不影响其它仓库 */ }
    }
    return { catalog, repositories: repositoriesOut };
  });
  handleTrusted('knowledge:sync', (_event, input) => harness.runTool('knowledge.sync', { mode: input?.mode, remotePath: input?.remotePath }, () => {
    // T158：`remotePath` 来自渲染层。旧实现只在 `repositories.knowledge.sync()` 里校验
    // "不等于本地 knowledge 目录"，于是渲染层可以指定**任意可写路径**（审计 S6：可在应用目录内
    // 建目录/写文件，并从外部目录合并卡片进本地库）。这里限制：应用安装目录内只允许写入
    // 明确的用户数据区（user-data / workspaces），其余必须在安装目录之外。
    const remote = String(input?.remotePath || '').trim();
    if (remote) {
      const resolved = path.resolve(remote).toLowerCase();
      const installRoot = `${path.resolve(programRoot).toLowerCase()}${path.sep}`;
      const allowedInside = ['user-data', 'workspaces'].some((name) => resolved.startsWith(`${path.join(root, name).toLowerCase()}${path.sep}`));
      if (resolved.startsWith(installRoot) && !allowedInside) {
        throw new Error('同步目录不能位于应用安装目录内：请选择应用之外的用户目录（或 user-data / workspaces）');
      }
    }
    return repositories.knowledge.sync(input || {});
  }));
  // T166：知识库导出 / 导入。**路径一律由主进程的文件对话框决定**，渲染层不传路径，
  // 只传合并/替换模式与预检 token —— 所以这两条通道无法被用来读写任意路径。
  // T166b：同三条通道按书导出 / 导入 —— 参数是"选了哪几本书"
  //（`{ books, cards, bookIndex }`；省略 = 整库），**没有新增任何通道**。
  handleTrusted('knowledge:export-bundle', (_event, input) => harness.runTool('knowledge.export', {
    books: Array.isArray(input?.books) ? input.books.length : 0,
    cards: Array.isArray(input?.cards) ? input.cards.length : 0,
  }, async () => {
    const scoped = Array.isArray(input?.books) || Array.isArray(input?.cards);
    if (scoped && !(input?.books || []).length && !(input?.cards || []).length) throw new Error('没有勾选任何书：请至少选一本书再导出');
    const bundle = knowledgeBundleOf(input);
    if (scoped && !bundle.cards.length && !Object.keys(bundle.books || {}).length) throw new Error('勾选的书里没有可以导出的卡片：请重新选择');
    const options = {
      title: scoped ? `导出知识库（选中的 ${bundle.counts.books} 本书）` : '导出知识库',
      defaultPath: `TaskHive-知识库-${bundle.selection ? `选中${bundle.counts.books}本-` : ''}${new Date().toISOString().slice(0, 10)}.taskhive-kb.json`,
      filters: [{ name: 'TaskHive 知识库文件', extensions: ['json'] }, { name: '全部文件', extensions: ['*'] }],
    };
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const picked = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { ok: true, canceled: true };
    const target = picked.filePath;
    // 原子写（atomic-json：同目录临时文件 + fsync + 原子改名），失败不会留下半截文件。
    writeJson(target, bundle);
    const bytes = fs.statSync(target).size;
    harness.append('knowledge.export', { cards: bundle.counts.cards, books: bundle.counts.books, bytes, scoped: Boolean(bundle.selection) });
    return {
      ok: true,
      canceled: false,
      path: target,
      bytes,
      schemaVersion: KB_BUNDLE_VERSION,
      exportedAt: bundle.exportedAt,
      counts: bundle.counts,
      scoped: Boolean(bundle.selection),
      books: Object.keys(bundle.books || {}),
    };
  }));
  handleTrusted('knowledge:import-inspect', () => harness.runTool('knowledge.import.inspect', {}, async () => {
    const options = {
      title: '选择要导入的知识库文件',
      properties: ['openFile'],
      filters: [{ name: 'TaskHive 知识库文件', extensions: ['json'] }, { name: '全部文件', extensions: ['*'] }],
    };
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths.length) return { ok: true, canceled: true };
    const file = picked.filePaths[0];
    const base = { path: file, name: path.basename(file) };
    let text = '';
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return { ...base, ok: false, error: '所选的不是一个文件', issues: [] };
      if (stat.size > KB_BUNDLE_MAX_BYTES) return { ...base, ok: false, error: `文件过大（${Math.round(stat.size / 1048576)} MB > ${KB_BUNDLE_MAX_BYTES / 1048576} MB），不是知识库导出文件`, issues: [] };
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      return { ...base, ok: false, error: `无法读取文件：${error.message}`, issues: [] };
    }
    const inspected = knowledgeBundleInspect(text);
    if (inspected.ok !== true) return { ...base, ok: false, error: inspected.error, issues: inspected.issues || [] };
    const token = `kb-import-${crypto.randomBytes(8).toString('hex')}`;
    knowledgeImportPending = { token, path: file, bundle: inspected.bundle, expiresAt: Date.now() + KB_BUNDLE_IMPORT_TTL_MS };
    harness.append('knowledge.import.inspect', {
      path: file,
      cards: inspected.bundle.cards.length,
      books: Object.keys(inspected.bundle.books || {}).length,
      summary: inspected.summary,
    });
    return {
      ...base,
      ok: true,
      token,
      schemaVersion: inspected.bundle.schemaVersion,
      exportedAt: inspected.bundle.exportedAt,
      summary: inspected.summary,
      preview: inspected.preview,
      // T166b：按书导入。`books` 是预检算出的每本书明细（含新增/更新/保留/相同），
      // 渲染层用它渲染多选列表，并把勾选的书名回传给 apply。
      books: inspected.books || [],
      scoped: inspected.scoped === true,
    };
  }));
  handleTrusted('knowledge:import-apply', (_event, input) => harness.runTool('knowledge.import.apply', {
    mode: input?.mode,
    books: Array.isArray(input?.books) ? input.books.length : 0,
  }, () => {
    const mode = input?.mode === 'replace' ? 'replace' : 'merge';
    const result = knowledgeApplyImport(mode, input?.token, Array.isArray(input?.books) ? input.books : null);
    harness.append('knowledge.import.apply', { mode, backup: result.backup || '', cards: result.cards, books: result.books, snapshot: result.snapshot, selected: result.selectedBooks });
    return result;
  }));
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerWebAiIpc() {
  handleTrusted('web-ai:open', (_event, input) => harness.runTool('web-ai.open', { providerId: typeof input === 'string' ? input : input?.providerId, newWindow: input?.newWindow === true }, () => openWebAiWindow(input)));
  handleTrusted('web-ai:auth-status', async (_event, modelId) => {
    const providerId = { 'deepseek-web': 'deepseek', 'kimi-web': 'kimi', 'doubao-web': 'doubao', 'yuanbao-web': 'yuanbao', 'qwen-web': 'qwen', 'chatgpt-web': 'chatgpt', 'claude-web': 'claude', 'gemini-web': 'gemini' }[String(modelId || '')] || 'deepseek';
    const provider = WEB_AI_PROVIDERS[providerId];
    const item = [...webAiViews.values()].find((entry) => entry.providerId === providerId);
    const cookies = item ? await item.view.webContents.session.cookies.get({ url: provider.url }).catch(() => []) : [];
    return { providerId, modelId, authenticated: cookies.length > 0, authentication: 'user-managed-browser-session', loginUrl: provider.url };
  });
  handleTrusted('web-ai:list', () => webAiWindowState());
  handleTrusted('web-ai:switch', (_event, id) => {
    const item = activateWebAiWindow(id);
    const state = webAiWindowState();
    return { ...state, providerId: item.providerId, providerName: WEB_AI_PROVIDERS[item.providerId]?.name || item.providerId };
  });
  handleTrusted('web-ai:navigate', async (_event, input) => {
    const item = webAiViews.get(String(input?.id || activeWebAiViewId || ''));
    if (!item) throw new Error('网页标签不存在');
    const navigationState = await navigateWebAi(item, input?.url);
    return { ...webAiWindowState(), navigationState };
  });
  handleTrusted('web-ai:command', (_event, input) => {
    const item = webAiViews.get(String(input?.id || activeWebAiViewId || ''));
    if (!item) throw new Error('网页标签不存在');
    const history = item.view.webContents.navigationHistory;
    const command = String(input?.command || '');
    if (command === 'back' && history?.canGoBack?.()) history.goBack();
    else if (command === 'forward' && history?.canGoForward?.()) history.goForward();
    else if (command === 'reload') item.view.webContents.reload();
    else if (command === 'stop') item.view.webContents.stop();
    else throw new Error('当前导航命令不可用');
    emitWebAiState();
    return webAiWindowState();
  });
  handleTrusted('web-ai:close', (_event, id) => {
    const targetId = String(id || activeWebAiViewId || '');
    const item = webAiViews.get(targetId);
    if (item) {
      if (activeWebAiViewId === targetId) hideWebAiView();
      try { item.view.webContents.close(); } catch {}
      webAiViews.delete(targetId);
    }
    activeWebAiViewId = null;
    webAiView = null;
    const next = [...webAiViews.values()].at(-1);
    if (next) activateWebAiWindow(next.id);
    return webAiWindowState();
  });
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerBrowserIpc() {
  handleTrusted('browser:preferences', () => readBrowserPreferences());
  handleTrusted('browser:set-homepage', (_event, homepage) => {
    const value = readBrowserPreferences();
    value.homepage = normalizeWebAiUrl(homepage);
    return writeBrowserPreferences(value);
  });
  handleTrusted('browser:add-bookmark', (_event, input) => {
    const value = readBrowserPreferences();
    const url = normalizeWebAiUrl(input?.url);
    const existing = value.bookmarks.find((item) => item.url === url);
    if (existing) return value;
    value.bookmarks.push({ id: `bookmark-${Date.now()}`, title: String(input?.title || new URL(url).hostname).trim().slice(0, 120), url, builtin: false });
    return writeBrowserPreferences(value);
  });
  handleTrusted('browser:remove-bookmark', (_event, id) => {
    const value = readBrowserPreferences();
    value.bookmarks = value.bookmarks.filter((item) => item.id !== String(id || '') || item.builtin === true);
    return writeBrowserPreferences(value);
  });
}

// T174：CODESYS AI 对话的**数据桥**调用器。
//
// 对话框界面已经搬出 DSH —— 它现在由外壳的 CODESYS 面板自己渲染（`app/renderer/renderer.js`
// 里那个右侧抽屉）。DSH 文档里只剩一个**纯数据**入口（客户端插件 shard 78）：
//   window.__TASKHIVE_CODESYS_AI_BRIDGE__ = { version, async snapshot(limit), async prompt(text) }
// 为什么不能整个搬走：**只有 DSH 文档里有 `sessions` 服务**，"主页那条会话"就在那里。
// 从这里开始，DSH 侧一行 UI 都不渲染，所以它改布局不会影响插件面板。
//
// 沿用 T173 的做法：对**全部框架**逐个尝试，并逐框架收集失败原因 —— 外壳状态行要能显示
// "哪个框架、哪一步"失败，绝不静默（用户报过"点了完全没反应、日志里一行都没有"）。
let codesysAiChatLastSnapshotFailure = '';
// T185：作答那条通道自己的去重位（见 `codesys:ai-chat-answer`）。与上面那条互不影响。
let codesysAiChatLastAnswerFailure = '';

function codesysAiChatFrames() {
  const frames = [];
  try {
    const mainFrame = mainWindow?.webContents?.mainFrame;
    if (mainFrame) frames.push(mainFrame);
    for (const child of (mainFrame?.framesInSubtree || [])) if (!frames.includes(child)) frames.push(child);
  } catch { /* 枚举失败时至少留一个主框架兜底 */ }
  if (!frames.length) {
    try { const fallback = mainWindow?.webContents?.mainFrame; if (fallback) frames.push(fallback); } catch { /* 主窗口不可用 */ }
  }
  return frames;
}

function codesysAiChatFrameLabel(frame, index) {
  let url = '';
  try { url = String(frame.url || ''); } catch { url = ''; }
  return `frame[${index}]${url ? ` ${url.slice(0, 96)}` : ''}`;
}

// 在全部框架里找数据桥并调用 `method`。返回 `{ reached, value, frame, frames, attempts, note }`：
//   * `reached: true`  → DSH 侧真的回答了（`value` 里可能是 `{ ok:false, reason }` 这种业务失败）；
//   * `reached: false` → 一个框架都没有入口；`attempts` 是逐框架的原因，`note` 是客户端自报阶段。
async function codesysAiChatBridgeCall(method, argument) {
  const frames = codesysAiChatFrames();
  const attempts = [];
  const source = `(async () => {
    const bridge = window.__TASKHIVE_CODESYS_AI_BRIDGE__;
    if (!bridge) return { reached: false, step: 'entry-absent' };
    if (typeof bridge.${method} !== 'function') return { reached: false, step: 'method-absent' };
    try { return { reached: true, value: await bridge.${method}(${JSON.stringify(argument)}) }; }
    catch (error) { return { reached: false, step: 'threw', detail: String((error && error.message) || error) }; }
  })()`;
  for (let index = 0; index < frames.length; index += 1) {
    const label = codesysAiChatFrameLabel(frames[index], index);
    try {
      const result = await frames[index].executeJavaScript(source, true);
      if (result && result.reached === true) return { reached: true, value: result.value, frame: label, frames: frames.length, attempts, note: '' };
      attempts.push(`${label}: ${(result && result.step) || 'no-result'}${result && result.detail ? ` (${String(result.detail).slice(0, 120)})` : ''}`);
    } catch (error) {
      attempts.push(`${label}: execute-error (${String((error && error.message) || error).slice(0, 120)})`);
    }
  }
  // 一个入口都没有：把客户端插件自己记的阶段捞回来（shard 78 写在 window 上），这样
  // "数据桥根本没装"与"装了但没会话"在面板状态行上是两句不同的话。
  let note = '';
  for (let index = 0; index < frames.length; index += 1) {
    try {
      const value = await frames[index].executeJavaScript('(() => { const s = window.__TASKHIVE_CODESYS_AI_STATUS__; return s ? (s.stage + (s.extra ? ":" + s.extra : "")) : ""; })()', true);
      if (value) { note = `${codesysAiChatFrameLabel(frames[index], index)} → ${String(value)}`; break; }
    } catch { /* 下一个框架 */ }
  }
  return { reached: false, value: null, frame: '', frames: frames.length, attempts, note };
}

// 数据桥缺失时的**具体原因**（外壳状态行直接显示这句话，不允许只写"未就绪"）。
function codesysAiChatBridgeMissingReason(result) {
  const tried = result.attempts && result.attempts.length ? result.attempts.join(' ｜ ') : '没有任何可用框架';
  const note = result.note
    ? `；客户端自报阶段：${result.note}`
    : '（客户端一行状态都没有，说明 shard 78 没有执行）';
  return `DSH 侧没有 CODESYS AI 数据桥（入口 window.__TASKHIVE_CODESYS_AI_BRIDGE__）：已尝试 ${result.frames} 个框架 → ${tried}${note}`;
}

// T194：自愈扫描可以看的 PID —— **只**允许"本插件自己启动的进程"：本次运行里领取过窗口的
// （内存 launchedPids）加上上一次运行启动、还没走完清理的（跨进程 logs/codesys-launched.json）。
// 用户自己开的 CODESYS 进程永远不在这个集合里，所以他的窗口绝不在自愈的管辖范围内。
function codesysReviveOwnedPids(extra = []) {
  const pids = [];
  for (const pid of codesysWindowOwnership?.snapshot().launchedPids || []) pids.push(Number(pid));
  for (const record of codesysLaunchedRegistry?.pending() || []) pids.push(Number(record?.pid));
  for (const pid of extra) pids.push(Number(pid));
  return [...new Set(pids.filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
}

// T194：检测链上的自愈。**不 await** —— 检测本身已经要 ~2s（枚举 + 选项扫描），不能让一次
// 窗口恢复把它拖得更长；原生托管层自带 30s 节流，所以这里每次调用都很便宜。
// 一旦真的恢复了窗口，就把 `codesys:current-project` 的 45s 记忆作废：否则"当时窗口还隐藏"
// 那个旧答案会继续被复用，界面照样显示"尚未发现 CODESYS 窗口"。
function scheduleCodesysNativeRevive(reason, options = {}) {
  if (!codesysNativeHost) return;
  const ownedPids = codesysReviveOwnedPids(options.ownedPids || []);
  void codesysNativeHost.revivePluginOwnedHiddenWindows(reason, { ownedPids, force: options.force === true })
    .then((outcome) => {
      // 只有"真的做了什么"才进 harness 流：节流/无事发生的结果留在原生托管自己的审计文件里，
      // 否则每 30 秒一条会把审计流刷成噪音。
      if (outcome?.revived?.length) {
        codesysCurrentProjectCache = { at: 0, key: '', value: null };
        harness.append('codesys.native-host.revive', { reason, ...outcome });
      } else if (outcome?.failed?.length) {
        harness.append('codesys.native-host.revive.failed', { reason, ...outcome });
      }
      return outcome;
    })
    .catch((error) => fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} codesys-native-revive ${reason} ${error?.message || error}\n`, 'utf8'));
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerCodesysIpc() {
  handleTrusted('codesys:list-windows', () => harness.runTool('codesys.list-windows', {}, () => { requirePluginEnabled('codesys-monitor'); scheduleCodesysNativeRevive('list-windows'); return monitor.listWindows({ maxAgeMs: 4000 }); }));
  handleTrusted('codesys:current-project', (_event, input) => harness.runTool('codesys.current-project', { preferredWindowId: codesysPreferredWindowId }, async () => {
    requirePluginEnabled('codesys-monitor');
    const force = input?.force === true;
    // T194：检测之前先让自愈跑一次（节流、不 await）：被 SW_HIDE 的窗口对可见性枚举是隐形的，
    // 不恢复的话这条检测链会一直答"没有 CODESYS 窗口"，用户永远看不到自己的 IDE。
    scheduleCodesysNativeRevive('detection');
    // Detection spawns a PowerShell window enumeration plus a CODESYS options
    // scan, and the workbench may ask again seconds later (surface switches,
    // window focus). Reuse a very recent answer unless the user explicitly
    // pressed "刷新当前工程", and de-duplicate concurrent probes so two callers
    // never start two enumerations.
    const cacheKey = String(codesysPreferredWindowId || '');
    if (!force && codesysCurrentProjectCache.value && codesysCurrentProjectCache.key === cacheKey && Date.now() - codesysCurrentProjectCache.at < CODESYS_CURRENT_PROJECT_TTL_MS) return codesysCurrentProjectCache.value;
    if (!force && codesysCurrentProjectInFlight) return codesysCurrentProjectInFlight;
    const probe = (async () => {
      const smokeProject = codesysSmokeProjectPath();
      // T207：**没有显式选择时，检测链只看本插件启动过的窗口。**
      //
      // `monitor.listWindows()` 从 T137 起会把用户自己启动的窗口也带回来（`owned:false`，
      // 面板下拉需要它 —— 那是"列出"）；而 `resolveCurrentCodesysProject` 的第 2 步会按
      // **窗口标题**把它和"最近工程"配对成"当前工程"，`describeCodesysProject` 还会对该工程
      // 做一次 `openSync(r+)` 写入探测。那等于"用户没点过就读取了外部窗口的工程"，正是用户
      // 口径里不许发生的事。用户在下拉里**显式选中过**的那一个（`codesysPreferredWindowId`，
      // 可以是外部窗口）照旧参与 —— 那是"你选择的"，不是"自动抓的"。
      //
      // `ownedPids`（`.~u` 锁的归属白名单）一个字没动：T199/T205 的边界不放大。
      const enumeratedWindows = await monitor.listWindows();
      const explicitWindowId = String(codesysPreferredWindowId || '');
      const scopedWindows = enumeratedWindows.filter((item) => item.owned !== false || (explicitWindowId && String(item.id) === explicitWindowId));
      let result = smokeProject ? { found: true, sourcePath: smokeProject, projectName: path.basename(smokeProject), windowId: codesysPreferredWindowId, pid: 0, title: `${path.basename(smokeProject)} - CODESYS TaskHive Fixture`, readOnly: false, activeGui: true, detection: 'isolated-smoke-project', writeAvailable: false, writeBlockReason: '隔离验收工程只用于读取验证' } : discoverCurrentCodesysProject(scopedWindows, codesysPreferredWindowId, { ownedPids: codesysWindowOwnership.snapshot().launchedPids });
      // EnumWindows omits a HWND while the native host is suspended during a
      // surface switch. Preserve the last verified project for the same
      // plugin-owned PID while that process is still alive, so a transient
      // hidden HWND cannot reset the workbench to "尚未打开程序".
      if (result.found) codesysLastDetectedProject = result;
      else if (codesysLastDetectedProject && codesysWindowOwnership.snapshot().launchedPids.includes(Number(codesysLastDetectedProject.pid)) && processStillRunning(codesysLastDetectedProject.pid)) {
        result = { ...codesysLastDetectedProject, detection: 'cached-plugin-owned-process' };
      } else if (codesysLastDetectedProject && !processStillRunning(codesysLastDetectedProject.pid)) {
        codesysLastDetectedProject = null;
      }
      harness.append('codesys.current-project.detected', { found: result.found, sourcePath: result.sourcePath || '', windowId: result.windowId || '', pid: result.pid || 0, detection: result.detection, readOnly: result.readOnly === true, writeAvailable: result.writeAvailable === true, forced: force === true, scope: result.scope || null, openProjects: Array.isArray(result.openProjects) ? result.openProjects.map((entry) => entry.name) : [] });
      codesysCurrentProjectCache = { at: Date.now(), key: cacheKey, value: result };
      return result;
    })();
    codesysCurrentProjectInFlight = probe;
    try {
      const detected = await probe;
      // T196（A 项）触发点②：这是**最早确知工程路径**的一刻（早于工作台紧接着的
      // bind-project 与第一次 inspect）。记住路径供"下一次开面板"提前点火，并立刻
      // 后台预打开它 —— 幂等、不阻塞（不 await）、失败只记一行。
      if (detected?.found && detected.sourcePath) {
        rememberCodesysProjectPath(detected.sourcePath);
        // T199（②）：与另外两个触发点**共用同一道门**（probe / smoke 轮不点火）。要量真实
        // 打开的探针有自己的显式 opt-in 入口。
        if (!preopenSmokeGateApplies('current-project-detected', 'current-project-detected')) {
          preopenCodesysProjectOnce('current-project-detected', detected.sourcePath);
        }
      }
      return detected;
    } finally { if (codesysCurrentProjectInFlight === probe) codesysCurrentProjectInFlight = null }
  }));
  handleTrusted('codesys:open-program', () => harness.runTool('codesys.open-program', {}, async () => {
    requirePluginEnabled('codesys-monitor');
    const doctor = codesysScriptEngine.doctor({ persist: true });
    const exePath = String(doctor.exePath || '').trim();
    if (!doctor.ready || !exePath || !fs.existsSync(exePath)) throw Object.assign(new Error('未找到可用的 CODESYS 程序，请先完成 ScriptEngine 环境检查'), { code: 'CODESYS_PROGRAM_NOT_READY' });
    // Snapshot every existing HWND before spawning. Even if Windows/CODESYS
    // reuses a process, a pre-existing manual window can never be claimed by
    // this launch registration.
    const baselineWindows = await monitor.listRawWindows();
    const launch = launchCodesysGui(doctor);
    codesysLaunchedRegistry?.record({ pid: launch.pid, exePath: doctor.exePath, profile: doctor.profile });
    const registration = codesysWindowOwnership.registerPid(launch.pid, {
      profile: launch.profile,
      baselineWindowIds: baselineWindows.map((item) => item.id),
    });
    const result = { opened: true, exePath: launch.exePath, pid: launch.pid, profile: launch.profile, culture: launch.culture, launchArgs: launch.args, mode: 'plugin-native-window', windowScope: 'current-taskhive-plugin-launches-only', registration, noDock: false, nativeHostMode: 'automatic-exact-hwnd', ...codesysExternalProgramLifecycle };
    harness.append('codesys.program.opened', result);
    return result;
  }));
  // 用户的删除要求（2026-10）：`codesys:fit-window` / `codesys:capture` /
  // `codesys:stream-source` / `codesys:stream-start` / `codesys:stream-stop` 与
  // `codesys:visual-status` / `codesys:visual-analyze` 一并删除 —— 它们只服务于
  // "AI 实时监视"（把 CODESYS 画面抓成帧/媒体流交给界面与 ModLens）。窗口枚举
  // （`codesys:list-windows`）与原生窗口托管（`codesys:attach-window` /
  // `codesys:move-window` / `codesys:native-host-detach` /
  // `codesys:preferred-window`）保持不变。
  handleTrusted('codesys:scriptengine-status', () => harness.runTool('codesys.scriptengine.doctor', {}, () => { requirePluginEnabled('codesys-monitor'); return codesysScriptEngine.doctor({ persist: true }); }));
  handleTrusted('codesys:scriptengine-configure', () => harness.runTool('codesys.scriptengine.configure', {}, async () => {
    requirePluginEnabled('codesys-monitor');
    const doctor = codesysScriptEngine.doctor({ persist: true });
    if (doctor.ready) return { opened: false, ready: true, mode: 'already-ready', doctor };
    const installerPath = findCodesysInstaller();
    if (installerPath) {
      const signature = await verifyWindowsSignature(installerPath);
      if (signature.valid) {
        const child = spawn(installerPath, [], { detached: true, windowsHide: false, stdio: 'ignore' });
        child.unref();
        return { opened: true, ready: false, mode: 'signed-local-installer', installerPath, signature, pid: child.pid || null, doctor };
      }
    }
    const officialUrl = 'https://www.codesys.com/download/';
    await shell.openExternal(officialUrl);
    return { opened: true, ready: false, mode: 'official-download-page', officialUrl, doctor };
  }));
  handleTrusted('codesys:scriptengine-probe', (_event, input) => harness.runTool('codesys.scriptengine.probe', {}, () => { requirePluginEnabled('codesys-monitor'); return codesysScriptEngine.execute('probe', input || {}); }));
  handleTrusted('codesys:scriptengine-action', (_event, input) => {
    const action = String(input?.action || '');
    const args = input?.input && typeof input.input === 'object' ? input.input : {};
    return harness.runTool(`codesys.scriptengine.${action}`, { jobId: args.jobId || '', objectName: args.objectName || '' }, () => {
      requirePluginEnabled('codesys-monitor');
      const pending = codesysScriptEngine.execute(action, args);
      if (action !== 'bind-project') return pending;
      // T196（A 项）：绑定成功 = "用户当前工程"的**权威答案**。记住它，下一次开面板就能在
      // 知道路径之前先把预打开点着（触发点①）。只是记住路径，不改绑定/写入的任何语义。
      return Promise.resolve(pending).then((result) => {
        if (result?.ok === true && result.sourcePath) rememberCodesysProjectPath(result.sourcePath);
        return result;
      });
    });
  });
  handleTrusted('codesys:online-status', () => harness.runTool('codesys.online.status', {}, async () => {
    requirePluginEnabled('codesys-monitor');
    const state = await codesysScriptEngine.onlineStatus();
    return {
      ...state,
      authorization: codesysOnlineAuthorization.snapshot(),
      grantableOnlineCapabilities: codesysOnlineAuthorization.grantable,
      deniedOnlineCapabilities: codesysOnlineAuthorization.denied,
      // 引擎新鲜度随状态一起回去：界面据此提示"重启才生效"，不用等一串旧写法的报错。
      runtime: codesysEngineFreshness(),
    };
  }));
  handleTrusted('codesys:engine-freshness', () => codesysEngineFreshness());
  handleTrusted('codesys:online-arm', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线授权只能由 TaskHive 界面开启');
    requirePluginEnabled('codesys-monitor');
    const requested = input && typeof input === 'object' ? input : {};
    const projectPath = String(requested.projectPath || '');
    if (!projectPath || path.extname(projectPath).toLowerCase() !== '.project' || !fs.existsSync(projectPath)) {
      throw Object.assign(new Error('请先绑定一个现有的 .project 工程，再开启在线授权'), { code: 'CODESYS_ONLINE_PROJECT_REQUIRED' });
    }
    const result = codesysOnlineAuthorization.arm({
      windowId: String(requested.windowId || codesysPreferredWindowId || ''),
      projectPath,
      projectSha256: codesysFileSha256(projectPath),
      capabilities: requested.capabilities,
    });
    if (!result.ok) throw Object.assign(new Error(result.reason), { code: result.code });
    return { ...result.grant, deniedOnlineCapabilities: codesysOnlineAuthorization.denied };
  });
  handleTrusted('codesys:online-disarm', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线授权只能由 TaskHive 界面解除');
    const reason = String(input?.reason || 'manual');
    const result = codesysOnlineAuthorization.disarm(reason);
    // An authorization that is gone must not leave a worker attached to a
    // controller, so dropping the grant also drops the session.
    void codesysScriptEngine.stopOnlineSession(`authorization-${reason}`).catch(() => {});
    return result;
  });
  handleTrusted('codesys:online-scan', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 设备扫描只能由 TaskHive 界面发起');
    requirePluginEnabled('codesys-monitor');
    const jobId = String(input?.jobId || '');
    if (!jobId) return { ok: false, reason: 'job-missing' };
    // Scanning must not depend on the background preparation having succeeded:
    // ensure the worker exists first (it only opens a project copy — no PLC
    // contact), then scan. prepareOnlineSession is a no-op when it already runs.
    // 两段时间分开报：启动/复用 CODESYS 在线进程耗时，和网关扫描本身的耗时。界面上
    // 要能告诉用户"这 20 秒花在启进程上，还是花在等网关广播"。
    const startedAt = Date.now();
    return codesysScriptEngine.prepareOnlineSession(jobId, 180000)
      .then((prepared) => {
        const prepareMs = Date.now() - startedAt;
        const scanStartedAt = Date.now();
        return codesysScriptEngine.onlineScanDevices({ useCache: input?.useCache === true })
          .then((result) => ({
            ...result,
            timings: {
              prepareMs,
              scanMs: Date.now() - scanStartedAt,
              totalMs: Date.now() - startedAt,
              sessionReused: prepared?.reused === true,
              workerStarted: prepared?.reused !== true,
            },
          }));
      })
      .then((result) => {
        codesysOnlineAuthorization.appendAudit({
          event: 'online-scan',
          mode: result?.mode || '',
          deviceCount: result?.deviceCount || 0,
          ok: result?.ok === true,
          prepareMs: result?.timings?.prepareMs || 0,
          scanMs: result?.timings?.scanMs || 0,
        });
        return result;
      });
  });
  handleTrusted('codesys:online-set-target', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线目标只能由 TaskHive 界面设置');
    requirePluginEnabled('codesys-monitor');
    const args = input && typeof input === 'object' ? input : {};
    const jobId = String(args.jobId || '');
    if (!jobId) return { ok: false, reason: 'job-missing' };
    // 准备失败也要把"绑定"记下来：绑定是这个作业的属性，不该因为在线进程这一次没
    // 起来就丢掉（起来的时候会自动应用，见 openOnlineSession）。
    return codesysScriptEngine.prepareOnlineSession(jobId, 180000)
      .catch((error) => ({ ok: false, ready: null, prepareError: String(error?.message || error) }))
      .then((prepared) => codesysScriptEngine.onlineSetTarget(args).then((result) => {
        if (result?.ok === true) codesysOnlineAuthorization.disarm('target-changed');
        codesysOnlineAuthorization.appendAudit({
          event: 'online-set-target',
          jobId,
          gatewayName: String(args.gatewayName || ''),
          gatewayGuid: String(args.gatewayGuid || ''),
          address: String(args.address || ''),
          ipAddress: String(args.ipAddress || ''),
          port: Number(args.port) || 0,
          targetMode: result?.targetMode || 'address',
          applied: result?.applied || '',
          deferred: result?.deferred === true,
          source: String(args.source || 'scan'),
          sessionReady: prepared?.ready?.ok === true,
          // 绑定的是"这次会话的目标"，写进的是作业元数据；工程文件一个字节都没动。
          saved: false,
          ok: result?.ok === true,
        });
        return result;
      }));
  });
  handleTrusted('codesys:online-release', (event) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线会话只能由 TaskHive 界面释放');
    const state = codesysScriptEngine.onlineState();
    return codesysScriptEngine.stopOnlineSession('released-by-operator').then((result) => {
      codesysOnlineAuthorization.appendAudit({
        event: 'online-session-released',
        jobId: state.jobId || '',
        pid: state.pid || 0,
        ok: result?.stopped === true,
      });
      return { ...result, releasedPid: state.pid || 0 };
    });
  });
  handleTrusted('codesys:online-prepare', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线会话只能由 TaskHive 界面准备');
    requirePluginEnabled('codesys-monitor');
    const jobId = String(input?.jobId || '');
    if (!jobId) return { ok: false, reason: 'job-missing' };
    if (codesysScriptEngine.onlineState().jobId && codesysScriptEngine.onlineState().jobId !== jobId) {
      codesysOnlineAuthorization.disarm('job-rebound');
    }
    return codesysScriptEngine.prepareOnlineSession(jobId, 180000);
  });
  handleTrusted('codesys:online-monitor', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线监视只能由 TaskHive 界面发起');
    const args = input && typeof input === 'object' ? input : {};
    const expressions = Array.isArray(args.expressions) ? args.expressions.slice(0, 120) : [];
    const jobId = String(args.jobId || '');
    if (!jobId) return { ok: false, reason: 'job-missing' };
    const monitorProjectPath = String(args.projectPath || '');
    // 在线变量是「登录」这项能力的直接结果：登录（Keep，只登录不传输）之后就能读。
    // 「download」保留为退路，免得此前只授权过下载的会话突然读不到值。
    const monitorAuthorization = codesysOnlineAuthorization.authorize({ capability: 'login', projectPath: monitorProjectPath });
    const authorization = monitorAuthorization.ok
      ? monitorAuthorization
      : codesysOnlineAuthorization.authorize({ capability: 'download', projectPath: monitorProjectPath });
    if (!authorization.ok) return { ok: false, reason: authorization.code, message: authorization.reason };
    if (codesysScriptEngine.onlineState().jobId !== jobId) return { ok: false, reason: 'session-not-bound' };
    return codesysScriptEngine.onlineMonitor(expressions, String(args.scope || ''));
  });
  handleTrusted('codesys:online-action', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线动作只能由 TaskHive 界面发起');
    const action = String(input?.action || '');
    const args = input?.input && typeof input.input === 'object' ? input.input : {};
    const capability = actionCapability(action);
    if (!capability) throw Object.assign(new Error(`不支持的在线动作：${action || '(empty)'}`), { code: 'CODESYS_ONLINE_ACTION_INVALID' });
    return harness.runTool(`codesys.online.${capability}`, { jobId: args.jobId || '' }, async () => {
      requirePluginEnabled('codesys-monitor');
      const authorization = codesysOnlineAuthorization.authorize({
        capability,
        projectPath: args.projectPath || '',
        windowId: args.windowId || '',
      });
      if (!authorization.ok) {
        codesysOnlineAuthorization.appendAudit({ event: 'online-refused', action, code: authorization.code, reason: authorization.reason });
        throw Object.assign(new Error(authorization.reason), { code: authorization.code, details: { deniedOnlineCapabilities: authorization.denied } });
      }
      if (capability === 'download') {
        const projectPath = String(args.projectPath || '');
        const preflight = evaluateDownloadPreflight({
          authorized: true,
          loggedIn: args.loggedIn === true,
          connected: args.connected === true,
          grantedProjectPath: authorization.grant.projectPath,
          projectPath,
          // The "file unchanged since the workbench read it" check is enforced
          // authoritatively inside the engine against the job's own recorded
          // sha, so it cannot be spoofed by the caller.
          windowTitle: await codesysMonitoredWindowTitle(),
          buildErrorCount: args.buildErrorCount,
        });
        if (!preflight.ok) {
          codesysOnlineAuthorization.appendAudit({
            event: 'online-download-refused',
            projectPath,
            reasons: preflight.errors.map((item) => item.code),
          });
          throw Object.assign(new Error(preflight.errors[0].message), { code: preflight.errors[0].code, details: preflight });
        }
      }
      // start / stop / reset / 写变量 / Force 全在应用层，必须先有一次"传输型"登录
      // （「下载」或「在线修改」）。只登录不传输（Keep）的会话只能读在线变量，
      // 不足以启停机械 —— 那时还没确认设备里跑的是哪一版程序。
      const APP_LAYER_CAPABILITIES = ['start', 'stop', 'reset', 'write-variable', 'force'];
      if (APP_LAYER_CAPABILITIES.includes(capability)) {
        // T151：这道锁的前提是"设备里跑的是哪一版程序"已经被确认，而确认只能来自
        // 本进程**真实执行过**的 online-change / download（持久化在 profiles/codesys-transfer.json）。
        // 旧实现只读渲染层自报的 `args.loginMode`，于是调用方传一个 'transfer' 就能绕过
        // —— 进而对真实控制器执行 start/stop/reset（会驱动机械）。
        if (!codesysTransferConfirmed(projectPath)) {
          codesysOnlineAuthorization.appendAudit({
            event: 'online-app-action-refused',
            action,
            capability,
            reasons: ['CODESYS_ONLINE_TRANSFER_REQUIRED'],
          });
          throw Object.assign(new Error('尚未确认设备上的程序版本：请先执行「下载」或「在线修改」，再执行该动作。'), {
            code: 'CODESYS_ONLINE_TRANSFER_REQUIRED'
          });
        }
        const preflight = evaluateAppActionPreflight({
          authorized: true,
          connected: args.connected === true,
          loggedIn: args.loggedIn === true,
          loginMode: String(args.loginMode || ''),
        });
        if (!preflight.ok) {
          codesysOnlineAuthorization.appendAudit({
            event: 'online-app-action-refused',
            action,
            capability,
            reasons: preflight.errors.map((item) => item.code),
          });
          throw Object.assign(new Error(preflight.errors[0].message), { code: preflight.errors[0].code, details: preflight });
        }
      }
      // 危险动作的第二道锁：逐字输入确认词。取消强制（online-unforce）故意不在此列。
      if (['online-write', 'online-force', 'online-reset'].includes(action)) {
        const gate = codesysOnlineAuthorization.confirmHardGate({ capability, phrase: args.phrase });
        if (!gate.ok) {
          codesysOnlineAuthorization.appendAudit({
            event: 'online-hard-gate-refused',
            action,
            capability,
            reason: gate.code,
          });
          throw Object.assign(new Error(gate.reason), { code: gate.code, details: { expected: gate.expected } });
        }
      }
      const result = await codesysScriptEngine.execute(action, { ...args, onlineAuthorization: true }).catch((error) => {
        // A failed online action used to leave NO audit trail at all, which made
        // "登录失败" impossible to diagnose after the fact. Record the refusal with
        // the target it was aimed at.
        codesysOnlineAuthorization.appendAudit({
          event: `online-${capability}-failed`,
          action,
          jobId: String(args.jobId || ''),
          projectPath: String(args.projectPath || ''),
          address: String(args.address || ''),
          code: String(error?.code || ''),
          message: String(error?.message || error).slice(0, 400),
          ok: false,
        });
        throw error;
      });
      codesysOnlineAuthorization.appendAudit({
        event: `online-${capability}`,
        action,
        jobId: String(args.jobId || ''),
        projectPath: String(args.projectPath || ''),
        target: result?.target ? {
          deviceName: result.target.deviceName,
          application: result.target.application,
          gateways: result.target.gateways,
        } : null,
        durationMs: result?.durationMs || 0,
        ok: result?.ok === true,
      });
      // T151：只有**真正成功**的传输型动作才登记"设备程序版本已确认"。
      if (result?.ok === true && (capability === 'download' || capability === 'online-change')) {
        recordCodesysTransfer(projectPath);
      }
      return result;
    });
  });
  handleTrusted('codesys:select-offline-file', async (_event, kind) => {
    requirePluginEnabled('codesys-monitor');
    const xml = kind === 'xml';
    const smokeProject = !xml ? codesysSmokeProjectPath() : '';
    if (smokeProject) return { canceled: false, path: smokeProject, testOverride: true };
    const selected = await dialog.showOpenDialog(mainWindow, { title: xml ? '选择 PLCopenXML 文件' : '选择 CODESYS 工程', properties: ['openFile'], filters: xml ? [{ name: 'PLCopenXML', extensions: ['xml'] }] : [{ name: 'CODESYS Project', extensions: ['project'] }] });
    return { canceled: selected.canceled, path: selected.filePaths[0] || '' };
  });
  handleTrusted('codesys:copy-project-path', (_event, sourcePath) => {
    const value = path.resolve(String(sourcePath || ''));
    if (!value || path.extname(value).toLowerCase() !== '.project' || !fs.existsSync(value)) throw new Error('当前 CODESYS 工程路径无效');
    if (isCodesysSmokeProject(value)) return { copied: true, path: value, testOverride: true };
    clipboard.writeText(value);
    return { copied: true, path: value };
  });
  handleTrusted('codesys:reveal-project', (_event, sourcePath) => {
    const value = path.resolve(String(sourcePath || ''));
    if (!value || path.extname(value).toLowerCase() !== '.project' || !fs.existsSync(value)) throw new Error('当前 CODESYS 工程路径无效');
    if (isCodesysSmokeProject(value)) return { revealed: true, path: value, testOverride: true };
    shell.showItemInFolder(value);
    return { revealed: true, path: value };
  });
  handleTrusted('codesys:native-host-status', () => ({ ...codesysNativeHost.status(), enabled: true, scope: 'current-taskhive-plugin-exact-hwnd-only' }));
  handleTrusted('codesys:native-host-attach', async (event, input) => harness.runTool('codesys.native-host.attach', { windowId: input?.windowId }, async () => {
    requirePluginEnabled('codesys-monitor');
    // T193：内联守卫与 `handleTrusted` 用**同一个**判定（以前这里重复写了一遍
    // `pluginSurfaceKind === 'codesys'`，于是"门已放宽但内联守卫还卡着"会让同一批通道半通半不通）。
    if (!isCodesysPanelSender(event)) throw new Error('CODESYS 原生托管只能从中央插件页面开启');
    // T207：**外部启动的窗口只有用户显式点选过才允许托管**。
    //
    // `explicitSelection` 只有面板下拉的 `list.onchange`（用户真的点了一下）会带；打开/切到
    // CODESYS 面、刷新窗口列表、跟随本插件启动的进程这三条自动路径都不带。所以外部窗口在这里
    // 就被挡住 —— 这正是用户实测「我外部有 CODESYS 窗口，一打开插件直接强制捕获过来了」的那一步
    // （真机 `desktop.log:3019` surface:open:codesys → 1.4 s 后 attach `0x200EEA` / pid 31548）。
    // 渲染层还有同一口径的第一道门（`attachSelectedCodesysNativeHost` 里的 `owned === false`
    // 检查），两处独立，任何一处单独失效都不会让自动路径抓到外部窗口。
    //
    // 判据用 `owned === false`（windows-monitor.js 的 T137 标注）：`owned` 缺失时按"非外部"
    // 处理，与面板选项文案、`refreshWindows()` 的自动选择判据保持同一口径。
    const attachWindowId = String(input?.windowId || '');
    const attachTarget = attachWindowId ? await monitor.resolveWindow(attachWindowId) : null;
    if (attachTarget && attachTarget.owned === false && input?.explicitSelection !== true) {
      throw Object.assign(new Error('外部启动的 CODESYS 窗口只有你先在窗口列表里点选它之后才能托管'), {
        code: 'CODESYS_EXTERNAL_WINDOW_NOT_SELECTED',
        windowId: attachWindowId,
        pid: Number(attachTarget.pid || 0),
        automatic: true,
      });
    }
    codesysNativeLocalBounds = input?.bounds || null;
    const bounds = codesysNativeScreenBounds();
    if (!bounds) throw new Error('CODESYS 原生托管区域尚未就绪');
    return codesysNativeHost.attach(input?.windowId, bounds, mainWindow);
  }));
  handleTrusted('codesys:native-host-move', async (event, bounds) => {
    if (!isCodesysPanelSender(event)) return codesysNativeHost.status();
    codesysNativeLocalBounds = bounds || null;
    const screenBounds = codesysNativeScreenBounds();
    return screenBounds && codesysNativeHost.status().attached ? codesysNativeHost.update(screenBounds) : codesysNativeHost.status();
  });
  handleTrusted('codesys:native-host-detach', (event) => {
    if (!isTrustedSender(event, { allowHarness: false })) return codesysNativeHost.status();
    codesysNativeLocalBounds = null;
    return harness.runTool('codesys.native-host.detach', {}, () => codesysNativeHost.detach('user'));
  });
  // T192：抽屉里那枚「让 CODESYS 重新加载」的**唯一**落点。
  //
  // 用户报障（原话）：「测试程序虽然写进去了，但是我每次都要重新启动 codesys 程序才会看到」。
  // 机制已确认：写入走离线隔离作业（ScriptEngine `--noUI`，见 scriptengine.cjs 的
  // `['--profile=…','--noUI','--runscript=…']`），改的是磁盘上的 .project；而用户眼前那个 GUI 早已
  // 把工程读进内存，**不会察觉文件被外部改**，所以只有重启（或关工程再开）才看得到。
  //
  // 这一条通道**不做任何重载以外的动作**：它只把"当前那个 CODESYS 窗口"交给原生托管层去读一次
  // 原生菜单栏，命中白名单标题才发一次 WM_COMMAND；没有入口就如实回报原因（含扫过的条数与顶级
  // 菜单名）。它**不**关工程、**不**关进程、**不**动几何/焦点，也**不**替用户保存或丢弃任何东西。
  handleTrusted('codesys:native-host-reload-project', async (event) => {
    // T193：与 `handleTrusted` 的面板门同一判定（见 `panelSenderDecision` 的说明）。
    if (!isCodesysPanelSender(event)) throw new Error('让 CODESYS 重新加载只能由 TaskHive 的 CODESYS 面板触发');
    requirePluginEnabled('codesys-monitor');
    // 目标优先级（都是"这台机器上已经被身份校验过的那个 CODESYS 窗口"）：
    //   ① 正在原生托管 → 托管 session 的句柄（它已经过 `-ExpectedPid` 复核）；
    //   ② 没托管 → 面板选定的监视窗口（`codesysPreferredWindowId`，同样只接受本插件拥有的窗口）；
    //   ③ 都没有 → 如实回报，不枚举全桌面、不猜、不打开新窗口。
    const nativeStatus = codesysNativeHost.status();
    if (nativeStatus?.attached === true && nativeStatus.windowId) return codesysNativeHost.reloadProject();
    if (!codesysPreferredWindowId) {
      return { ok: false, invoked: false, reason: 'no-window-selected', scanned: 0, caption: '', detail: '当前没有选中的 CODESYS 窗口：请先在面板里选中一个 CODESYS 窗口，再点「让 CODESYS 重新加载」。' };
    }
    let target = null;
    try { target = await monitor.resolveWindow(codesysPreferredWindowId); } catch { target = null; }
    if (!target) {
      return { ok: false, invoked: false, reason: 'window-not-found', scanned: 0, caption: '', detail: '选中的 CODESYS 窗口已经不在了：请在面板里重新选一次窗口。' };
    }
    return codesysNativeHost.reloadProject(target);
  });
  // T164/T173 的历史备注保留：`codesys:input-request` / `codesys:input-execute` / `codesys:input-arm`
  // / `codesys:input-direct`（"面板遥控"：把界面上的点击/键盘真实送进 CODESYS 窗口）已按用户要求
  // **整体移除**；历史上它从未被真正执行过（审计日志 148 条全是 `revoked-all`，
  // `codesys.input.direct` 0 次调用）。
  //
  // T174：用户的架构要求（原话）：「ai 对话不调用原生的右侧栏，而是直接在 codesys 插件里面做一个
  // 右侧栏，这样每次更新右侧栏就不需要重新适配」。于是 AI 对话改成下面这四个通道：
  //   * 界面（对话框本体）由外壳 CODESYS 面板自己渲染（app/renderer/renderer.js 的右侧抽屉），
  //     主进程**不再**跨框架找 DOM、**不再**渲染任何 UI；
  //   * `codesys:ai-chat` 只保留"打开/关闭面板"的开关语义，并顺便回报数据桥是否可达 + 一份快照；
  //     T184 起它**打开时**还顺手调数据桥的 `ensureWorkbench()`：把工作台页签打开并触发它既有的
  //     绑定流程（只绑定，不写入、不编译、不确认），这样 AI 一开口就能看到当前工程。
  //   * `codesys:ai-chat-snapshot` / `codesys:ai-chat-prompt` 是数据桥的消息入口，只搬数据；
  //   * T175 `codesys:ai-chat-model` 是数据桥的**模型**入口（`{action:'list'}` 读目录、
  //     `{action:'select', id}` 改**这条会话**用的模型），同样只搬数据。
  handleTrusted('codesys:ai-chat', async (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS AI 对话只能由 TaskHive 插件页面打开');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
    const open = input?.open !== false;
    // 打开面板时顺手取一份快照：外壳可以立刻画出内容，不必等第一次轮询；同时把"数据桥到底在不在"
    // 作为**数据**回报（T173 是靠"那个 DOM 全局函数返回 true 吗"来判断的，脆且说不清原因）。
    const probe = await codesysAiChatBridgeCall('snapshot', 1);
    if (!probe.reached) {
      const reason = codesysAiChatBridgeMissingReason(probe);
      harness.append('codesys.ai-chat.bridge-missing', { channel: 'codesys:ai-chat', frames: probe.frames, attempts: probe.attempts, note: probe.note, at: new Date().toISOString() });
      return { open, bridge: { reached: false, frames: probe.frames, frame: '', reason } };
    }
    if (probe.value && probe.value.ok === false) {
      harness.append('codesys.ai-chat.snapshot-rejected', { channel: 'codesys:ai-chat', reason: probe.value.reason, detail: probe.value.detail || '', frame: probe.frame, at: new Date().toISOString() });
    }
    // T184：用户要求"点 AI 对话时应当默认绑定工程"（原文：点「AI 对话」后让 AI 写入一个名为 test
    // 的程序，AI 回"代码工作台没有绑定工程"）。打开抽屉时顺手让 DSH 侧把工作台页签打开并触发它
    // **既有**的绑定流程（`codesys:current-project` → `bind-project`），这样 AI 调
    // `taskhive_codesys_workbench` 时已经能看到工程。**不新增通道**：走的是同一个数据桥调用器
    // （`codesysAiChatBridgeCall`），只是多调一个方法；**绑定不是写入** —— 不碰工程文件、不编译、
    // 不自动确认，`apply-and-build` 仍然只有工作台里的确认按钮会调。返回值原样交给外壳，
    // 由外壳在失败时写一行（成功全程静默）。
    let workbench = null;
    if (open) {
      const ensured = await codesysAiChatBridgeCall('ensureWorkbench', null);
      // 走到这里说明数据桥本身是通的（上面刚用 snapshot 探过），所以 `reached:false` 只可能是
      // 客户端插件还是旧 bundle（没有这个方法）。这一句必须说清是"要重启"，而不是"桥不在"。
      workbench = ensured.reached === true
        ? ensured.value
        : { ok: false, bound: false, started: false, reason: 'bridge-method-missing', detail: 'DSH 侧的数据桥没有 ensureWorkbench 方法（客户端插件还是旧 bundle）：请重启 TaskHive 后再点「AI 对话」，或先手动点面板上的「代码任务」绑定工程。' };
      if (workbench && workbench.ok !== true) {
        harness.append('codesys.ai-chat.workbench-unbound', { reason: workbench.reason || '', detail: workbench.detail || '', sessionId: workbench.sessionId || '', frame: probe.frame, at: new Date().toISOString() });
      }
    }
    return { open, bridge: { reached: true, frames: probe.frames, frame: probe.frame, reason: '', snapshot: probe.value || null, workbench } };
  });
  handleTrusted('codesys:ai-chat-snapshot', async (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS AI 对话快照只能由 TaskHive 的 CODESYS 面板读取');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
    const result = await codesysAiChatBridgeCall('snapshot', Number(input?.limit) || 40);
    if (!result.reached) {
      const reason = codesysAiChatBridgeMissingReason(result);
      // 失败每次都要看得见，但**同一条**失败不要每 1.5 秒写一遍审计流。
      if (codesysAiChatLastSnapshotFailure !== reason) {
        codesysAiChatLastSnapshotFailure = reason;
        harness.append('codesys.ai-chat.snapshot-failed', { reason: 'bridge-missing', frames: result.frames, attempts: result.attempts, note: result.note, at: new Date().toISOString() });
      }
      return { ok: false, reason: 'bridge-missing', detail: reason, frames: result.frames, frame: '' };
    }
    const value = result.value && typeof result.value === 'object' ? result.value : { ok: false, reason: 'bridge-empty', detail: '数据桥返回了空值' };
    if (value.ok === true) codesysAiChatLastSnapshotFailure = '';
    else if (codesysAiChatLastSnapshotFailure !== `${value.reason}|${value.detail || ''}`) {
      codesysAiChatLastSnapshotFailure = `${value.reason}|${value.detail || ''}`;
      harness.append('codesys.ai-chat.snapshot-failed', { reason: value.reason || 'unknown', detail: value.detail || '', frames: result.frames, frame: result.frame, at: new Date().toISOString() });
    }
    return { ...value, frames: result.frames, frame: result.frame };
  });
  handleTrusted('codesys:ai-chat-prompt', async (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS AI 对话发送只能由 TaskHive 的 CODESYS 面板调用');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
    const text = String(input?.text === undefined || input?.text === null ? '' : input.text);
    const result = await codesysAiChatBridgeCall('prompt', text);
    if (!result.reached) {
      const reason = codesysAiChatBridgeMissingReason(result);
      harness.append('codesys.ai-chat.prompt-failed', { reason: 'bridge-missing', frames: result.frames, attempts: result.attempts, note: result.note, at: new Date().toISOString() });
      return { ok: false, reason: 'bridge-missing', detail: reason, frames: result.frames, frame: '' };
    }
    const value = result.value && typeof result.value === 'object' ? result.value : { ok: false, reason: 'bridge-empty', detail: '数据桥返回了空值' };
    // 发送是用户动作，成功与失败都记一条（不像快照那样是 1.5 秒一次的轮询）。
    harness.append(value.ok === true ? 'codesys.ai-chat.prompt' : 'codesys.ai-chat.prompt-failed', {
      reason: value.reason || '', detail: value.detail || '', sessionId: value.sessionId || '', chars: text.trim().length, frame: result.frame, at: new Date().toISOString(),
    });
    return { ...value, frames: result.frames, frame: result.frame };
  });
  // T175：抽屉里的**模型选择**（用户原话：「会话调用的主会话的接口，可以选择模型」）。抽屉绑定的
  // 就是主页那条会话，所以"改模型"改的是**这条会话**用的模型 —— DSH 侧 `session/selectModel` 是
  // 会话级的（写进这条会话的 `modelSelection` 投影，"下一次请求"用它）。
  //
  // 一个通道两个动作，而不是再造一条只读通道：模型目录（`models`）与切换（`setModel`）在 DSH 侧
  // 是同一份数据（`modelDirectories` / `remote.session`），分开两条通道只会让身份门多一条死条目。
  //   * `{ action: 'list' }`        → 数据桥 `models()`（目录 + 当前模型）；
  //   * `{ action: 'select', id }`  → 数据桥 `setModel(id)`（`id` = `provider/model`）。
  // T186：`select` 多带一个**可选**的 `effort`（推理等级，取值只能是那个模型自己声明的档位，
  // 由 shard 78 校验）。等级与模型走**同一条**会话级写入 —— 不新开通道，也不新开动作：
  // 数据桥那一侧仍是 `setModel({ id, effort? })`。没有 `effort` 时载荷形状与改动前一模一样。
  handleTrusted('codesys:ai-chat-model', async (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS AI 对话的模型选择只能由 TaskHive 的 CODESYS 面板调用');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
    const action = String(input?.action || 'list');
    if (action === 'select') {
      const id = String(input?.id === undefined || input?.id === null ? '' : input.id);
      const effort = String(input?.effort === undefined || input?.effort === null ? '' : input.effort);
      // T231：`source` 只进审计 —— 用来区分"这一次是用户点的"与"启动后静默恢复上次的选择"
      // （`'restore'`）。它**不**交给数据桥：下面那句桥调用的载荷仍然只有 `{ id }` / `{ id, effort }`
      // 两个字面量，与改动前一模一样。
      const source = String(input?.source || '');
      // 只搬数据：`effort` 的原样透传，合法性（模型支持不支持这一档）全部由 shard 78 判定，
      // 主进程不解释、不补全、不猜，也绝不因此触发任何写入 / 编译 / 确认。
      const result = await codesysAiChatBridgeCall('setModel', effort ? { id, effort } : { id });
      if (!result.reached) {
        const reason = codesysAiChatBridgeMissingReason(result);
        harness.append('codesys.ai-chat.model-failed', { reason: 'bridge-missing', model: id, effort, frames: result.frames, attempts: result.attempts, note: result.note, at: new Date().toISOString() });
        return { ok: false, reason: 'bridge-missing', detail: reason, frames: result.frames, frame: '' };
      }
      const value = result.value && typeof result.value === 'object' ? result.value : { ok: false, reason: 'bridge-empty', detail: '数据桥返回了空值' };
      // T231：一次**成功的**会话级选择 = "这条会话当下选的就是它" ⇒ 记进主进程那份偏好，重启之后
      // 新会话据它恢复（用户报的"关闭程序打开之后不会保存"就是缺这一步）。
      // 写失败**不谎报**：审计行里就没有 `remembered` 字段，而这一句本身照旧只记录桥的真实结果。
      let remembered = null;
      if (value.ok === true) {
        try { remembered = writeCodesysAiModelPreference(codesysAiModelRememberedFromSelect(value, id, effort)); }
        catch (error) {
          remembered = null;
          try { harness.append('codesys.ai-chat.model-remember-failed', { model: id, effort, error: String(error?.message || error).slice(0, 200), at: new Date().toISOString() }); } catch { /* 审计也不许抛 */ }
        }
      }
      // 切换是用户动作：成功与失败都记一条（不像快照那样是 1.5 秒一次的轮询）。
      harness.append(value.ok === true ? 'codesys.ai-chat.model' : 'codesys.ai-chat.model-failed', {
        reason: value.reason || '', detail: value.detail || '', sessionId: value.sessionId || '', model: value.model || id, effort: value.effort || effort, frame: result.frame, at: new Date().toISOString(),
        ...(source ? { source } : {}),
        ...(remembered ? { remembered: `${remembered.provider}/${remembered.model}${remembered.reasoningEffort ? `@${remembered.reasoningEffort}` : ''}` } : {}),
      });
      return { ...value, frames: result.frames, frame: result.frame };
    }
    if (action !== 'list') throw new Error(`IPC codesys:ai-chat-model 不认识动作 ${action}（只支持 list / select）`);
    const result = await codesysAiChatBridgeCall('models', null);
    if (!result.reached) {
      const reason = codesysAiChatBridgeMissingReason(result);
      harness.append('codesys.ai-chat.models-failed', { reason: 'bridge-missing', frames: result.frames, attempts: result.attempts, note: result.note, at: new Date().toISOString() });
      return { ok: false, reason: 'bridge-missing', detail: reason, frames: result.frames, frame: '' };
    }
    const value = result.value && typeof result.value === 'object' ? result.value : { ok: false, reason: 'bridge-empty', detail: '数据桥返回了空值' };
    // 目录是"打开抽屉 / 目录过期 / 主页换了模型"时读的，不是每 1.5 秒一次，所以这里**不**做去重；
    // 只有失败才值得记（成功每次都会带 available 列表，记下来只会把审计流灌满）。
    if (value.ok !== true) {
      harness.append('codesys.ai-chat.models-failed', { reason: value.reason || 'unknown', detail: value.detail || '', frames: result.frames, frame: result.frame, at: new Date().toISOString() });
    }
    // T231：目录这一趟**顺便**把主进程记住的那条选择带回去（不新开通道、不新开动作）：外壳据此判断
    // "这条会话还没有显式选择时该不该恢复上次的模型/强度"。读的是主进程那份偏好文件，所以它跨渲染层
    // 重建、跨面板重新载入都还在；`null` = 从来没存过 ⇒ 外壳一个请求都不发（走目录默认值）。
    return { ...value, remembered: readCodesysAiModelPreference(), frames: result.frames, frame: result.frame };
  });
  // T185：抽屉里回答主页那条会话的**待回答**提问（用户报「有一个待回答，但抽屉不显示，于是一直卡住」）。
  //
  // 为什么必须是独立一条通道：这是本项目里**唯一**能替用户把一条 `ask_user_question` 交回去的动作。
  // 它挂在 `CODESYS_PANEL_ONLY_CHANNELS` 上（sender 必须是 CODESYS 面板那个 webContents），所以
  // DSH 文档里的任何代码 —— 包括 AI 自己装/写的插件 —— 都不能把用户的提问答掉。
  //
  // 安全语义（两条都要保持）：
  //   * **只有用户点击会走到这里**：本进程不做任何轮询/自动调用，`snapshot` 那条通道永远只读。
  //     真正发起 IPC 的只有 `app/renderer/renderer.js` 里「提交回答」按钮那一条委托分支。
  //   * **只搬数据**：`{ key, answers }` 原样交给数据桥的 `answer()`，答案的合法性（选项是否在
  //     问题给出的清单里、有没有漏答、key 是否还是当前那一条）全部由 DSH 侧的 shard 78 判定，
  //     主进程不解释、不补全、不猜。审批类请求在这一层也**没有**任何捷径。
  handleTrusted('codesys:ai-chat-answer', async (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS AI 对话的作答只能由 TaskHive 的 CODESYS 面板调用');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
    const key = String(input?.key === undefined || input?.key === null ? '' : input.key);
    const answers = Array.isArray(input?.answers) ? input.answers : [];
    const result = await codesysAiChatBridgeCall('answer', { key, answers });
    if (!result.reached) {
      const reason = codesysAiChatBridgeMissingReason(result);
      harness.append('codesys.ai-chat.answer-failed', { reason: 'bridge-missing', frames: result.frames, attempts: result.attempts, note: result.note, at: new Date().toISOString() });
      return { ok: false, reason: 'bridge-missing', detail: reason, frames: result.frames, frame: '' };
    }
    const value = result.value && typeof result.value === 'object' ? result.value : { ok: false, reason: 'bridge-empty', detail: '数据桥返回了空值' };
    // 作答是用户动作：成功与失败都记一条（不像快照那样是 1.5 秒一次的轮询）。这里只为
    // **同一条**失败去重（用户连点两次「提交回答」不该在审计流里留两行一模一样的），
    // 与 snapshot 那条去重位各自独立。
    const signature = `${value.reason || ''}|${value.detail || ''}`;
    if (value.ok === true) codesysAiChatLastAnswerFailure = '';
    else if (codesysAiChatLastAnswerFailure !== signature) {
      codesysAiChatLastAnswerFailure = signature;
      harness.append('codesys.ai-chat.answer-failed', {
        reason: value.reason || 'unknown', detail: value.detail || '', sessionId: value.sessionId || '', key: value.key || key, questions: answers.length, frame: result.frame, at: new Date().toISOString(),
      });
    }
    return { ...value, frames: result.frames, frame: result.frame };
  });
  // A 段：抽屉消息流里的「确认写入工程」（用户口径：「AI 对话就是唯一操作面，工作台只做能力提供」）。
  //
  // 这是**唯一**能把"用户在抽屉里点了一下"变成工程写入的 IPC 入口，而写入本体仍然是工作台那枚
  // 「确认写入」按钮调的**同一个** `apply-and-build`（经 DSH 侧 shard 78 → shard 50 的
  // `applyProposal`：同一条 sha 防护、同一条恢复快照、同一个 deferred build）。
  //   * 本进程不做任何轮询 / 自动调用；`snapshot` 那条通道永远只读，所以**没有点击时这里 0 次调用**；
  //   * `overwriteConfirmed` 只由抽屉里第二次显式点击（sha 防护挡下之后那枚「我已确认，继续写入」）
  //     带上来，主进程不解释、不补全、不猜。
  handleTrusted('codesys:ai-chat-apply', async (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS 的确认写入只能由 TaskHive 的 CODESYS 面板触发');
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口不可用');
    const payload = {
      sessionId: String(input?.sessionId === undefined || input?.sessionId === null ? '' : input.sessionId),
      proposalSignature: String(input?.proposalSignature === undefined || input?.proposalSignature === null ? '' : input.proposalSignature),
      overwriteConfirmed: input?.overwriteConfirmed === true,
    };
    const result = await codesysAiChatBridgeCall('apply', payload);
    if (!result.reached) {
      const reason = codesysAiChatBridgeMissingReason(result);
      harness.append('codesys.ai-chat.apply-failed', { reason: 'bridge-missing', frames: result.frames, attempts: result.attempts, note: result.note, at: new Date().toISOString() });
      return { ok: false, reason: 'bridge-missing', detail: reason, frames: result.frames, frame: '' };
    }
    const value = result.value && typeof result.value === 'object' ? result.value : { ok: false, reason: 'bridge-empty', detail: '数据桥返回了空值' };
    // 写入是用户动作：成功与失败都记一条（与 prompt / answer 同一条口径）。
    harness.append(value.ok === true ? 'codesys.ai-chat.apply' : 'codesys.ai-chat.apply-blocked', {
      reason: value.reason || '', detail: String(value.detail || '').slice(0, 300), sessionId: value.sessionId || payload.sessionId, written: Number(value.written || 0),
      deferredBuild: value.buildPending === true, overwriteConfirmed: payload.overwriteConfirmed, frame: result.frame, at: new Date().toISOString(),
    });
    return { ...value, frames: result.frames, frame: result.frame };
  });
  // ── T207：窗口选择器 = **用户的显式选择**。这条通道的口径与自动路径**不同** ──────────────
  //
  // 用户口径（原话）：「外部窗口也可以成为监视和读取到窗口，前提是由 codesys 插件选择外部
  // 窗口，不能是未经过选择就直接获取」。所以这条通道的判据是：
  //
  //   **外部启动的窗口（`owned:false`，windows-monitor.js 的 T137 标注）允许成为监视/读取
  //   目标 —— 但仅当用户在下拉里点选了它；永不自动。**
  //
  //   一句话口径（全仓统一）：**外部允许，但仅经显式选择；永不自动。**
  //
  // 这里没有、也不该有归属过滤：`monitor.resolveWindow` 只回答"这个句柄现在在不在可见枚举
  // 里"，**没有**归属过滤（见下面 `codesys:workbench-open` 的说明）。"自动路径只认本插件
  // 启动的 PID"由另外两处负责，与这条通道彼此独立：
  //   * `app/renderer/renderer.js` 的 `refreshWindows()`：外部窗口**永不被自动选中**；
  //   * T194 的 `codesysReviveOwnedPids()`：自愈扫描只认本插件启动过的 PID。
  //
  // 历史（T205 报告指出的矛盾）：这段注释以前写的是 "Validation goes through the
  // ownership-filtered resolver, so a window this plugin did not launch can never become the
  // monitored window"，而下面用的 `monitor.resolveWindow` 恰恰**不是**归属过滤版（归属过滤版
  // 是 `monitor.resolveOwnedWindow`）。那句话与代码不符，现在按用户口径改正，并让返回值把
  // "这是外部启动的窗口，是你选择的"如实标出来。
  handleTrusted('codesys:preferred-window', async (_event, input) => {
    requirePluginEnabled('codesys-monitor');
    const requestedWindowId = String(input?.windowId || '');
    if (!requestedWindowId) {
      codesysPreferredWindowId = '';
      codesysExplicitWindowSelection = null;
      codesysOnlineAuthorization.disarm('monitored-window-cleared');
      await codesysScriptEngine.stopOnlineSession('monitored-window-cleared').catch(() => {});
      await notifyMonitoredWindowChanged('');
      return { preferredWindowId: '' };
    }
    const target = await monitor.resolveWindow(requestedWindowId);
    if (!target) throw Object.assign(new Error('这个 CODESYS 窗口已经不在可见枚举里了：请点面板上的「刷新」重新枚举后重选'), { code: 'CODESYS_WINDOW_NOT_OWNED' });
    if (String(target.id) !== codesysPreferredWindowId) {
      // A different monitored window can mean a different project; the online
      // authorization must never silently follow the switch to another device.
      const revoked = codesysOnlineAuthorization.disarm('monitored-window-changed');
      if (revoked.disarmed) await codesysScriptEngine.stopOnlineSession('monitored-window-changed').catch(() => {});
    }
    codesysPreferredWindowId = String(target.id);
    // T208：这一下点击就是"用户的显式选择"，记在主进程这一侧 —— 与下面那条审计是同一时刻的
    // 同一件事，但审计是流水，这条是**当前有效**的那一个（`codesys:workbench-open` 据此放行
    // 外部窗口）。`automatic:false` + `source:'user-selection'` 是凭据的形状，改不得。
    codesysExplicitWindowSelection = { windowId: codesysPreferredWindowId, source: 'user-selection', automatic: false, at: new Date().toISOString() };
    // 「外部启动（你选择的）」这一档必须留一行审计：事后要能分清"这个外部窗口是用户点选的"
    // 与"自动抓的"（后者从 T207 起不可能发生）。`automatic:false` 就是那条分界线。
    const externalLaunch = target.owned === false;
    harness.append('codesys.monitored-window.selected', { windowId: codesysPreferredWindowId, pid: Number(target.pid || 0), title: String(target.title || ''), externalLaunch, pluginOwned: !externalLaunch, source: 'panel-window-selector', automatic: false, at: new Date().toISOString() });
    await notifyMonitoredWindowChanged(codesysPreferredWindowId);
    return { preferredWindowId: codesysPreferredWindowId, externalLaunch, pluginOwned: !externalLaunch };
  });
  // T199：工作台绑定按**本插件启动的 PID**判定，并在句柄被替换时重新解析该 PID 当前的顶层窗口。
  //
  // 现场（2026-10-08，用户报「点代码任务被拒」）：CODESYS 由面板启动、`registerPid` 已登记，
  // 但它在启动过程中把顶层窗口从 0x1204AC 换成了 0x1304AC（审计 `native-host-window-replaced`），
  // 而面板的下拉框此后**一次都没有重新枚举**（trajectory 里 01:15:37Z 之后再无
  // `codesys.list-windows`）—— 于是那 13 次点击交上来的都是已经销毁的旧句柄；
  // `monitor.resolveWindow` 只按句柄精确匹配（它**没有**归属过滤，`listWindows` 连外部窗口
  // 一起返回），于是回 null，报出的是"这个窗口不是本插件打开的"——一句与事实相反的原因。
  //
  // 归属依旧只认"本插件启动过的进程"（本次登记 ∪ 上一轮 `codesys-launched.json` 记录，即
  // T194 的 `codesysReviveOwnedPids`）。
  //
  // ── T208（用户裁决「乙」）────────────────────────────────────────────────────────────
  // 用户的裁决原话：「外部窗口也可以成为监视和读取的窗口，前提是由 codesys 插件选择外部窗口，
  // 不能是未经过选择就直接获取」。T207 已经把这条口径落到监视窗口 / 原生托管 / 检测读取三条链上；
  // 这一次把**「代码任务」的工作台绑定**也按同一口径放行：
  //
  //   放行 = ①本插件启动过的 PID（T199，上面那条）**或**②`requestedWindowId` **就是当前被用户
  //   显式选中的那个窗口**。②的凭据由主进程自己从 `codesysExplicitWindowSelection` 里构造，
  //   **完全不读 `input` 里的任何同名字段** —— 渲染层伪造不出来（这正是选"已记录的显式选择"
  //   而不是"让渲染层每次再声明一个 flag"的原因）。凭据的形状判据在
  //   `windows-monitor.js` 的 `resolveOwnedWindow` 里，缺一条就不算数：
  //   `automatic:false` + `source:'user-selection'` + 句柄逐字相同 + 该窗口此刻仍在枚举里。
  //   所以未选择的外部窗口、曾经选过但已经不是当前选择的窗口、`automatic:true` 的声明，
  //   一律拒绝。
  //
  // 写入面一个字都没动：绑定本身仍然只是"只读 + 隔离作业"那条链（DSH 侧 `bind-project` /
  // `inspect-project`），sha 三态守卫仍在写入动作**之前**，写入仍然只在用户点击那一条路上。
  // 这个处理器既不写工程、不重建基线，也不碰 scriptengine。
  handleTrusted('codesys:workbench-open', async (_event, input) => {
    const requestedWindowId = String(input?.windowId || '');
    // 绑上的那个句柄（T199 之后它**不一定**等于面板交上来的句柄：本插件启动的进程换过顶层
    // 窗口时，答案是它**当前**那个），以及"它是不是外部启动的"。
    let boundWindowId = '';
    let externalLaunch = false;
    if (requestedWindowId) {
      const attachedWindowId = String(codesysNativeHost?.status().windowId || '');
      // 授权凭据：**只**从主进程记录的"用户显式选择"里构造。请求体（`input`）里就算带了
      // `explicitSelection` 也一个字都不读 —— 那是渲染层可以随便声明的字段，不是证据。
      // 记录本身的形状也**逐条核过**（来源必须是那次显式选择、`automatic` 必须是 `false`、
      // 句柄必须与请求逐字相同），不满足就一个凭据都不构造 —— 换句话说不存在"规范化"这回事。
      const selection = codesysExplicitWindowSelection;
      const selectedThisWindow = Boolean(selection
        && selection.source === 'user-selection'
        && selection.automatic === false
        && String(selection.windowId || '')
        && String(selection.windowId) === requestedWindowId);
      const explicitSelection = selectedThisWindow
        ? { windowId: String(selection.windowId), source: selection.source, automatic: false }
        : null;
      const target = await monitor.resolveOwnedWindow(requestedWindowId, input?.pid, {
        launchedPids: codesysReviveOwnedPids(),
        preferredWindowId: attachedWindowId || codesysPreferredWindowId,
        explicitSelection,
      });
      if (!target) {
        const pid = Number(input?.pid) || 0;
        // 三种拒绝必须分开说，否则留下的又是一句与事实不符的原因：
        //   * 进程是本插件启动的、只是现在没有可用顶层窗口（最小化/正在切换）；
        //   * 这个句柄正是用户点选过的那个，但它现在已经不可用（关了 / 句柄被回收）——
        //     外部窗口没有可回查的 PID，只能请用户重新枚举后再点选；
        //   * 其余（外部启动且**不是**当前被显式选中的那一个）：给出"先在窗口列表里点选它"
        //     这一步，而不是旧文案里那句"改选本插件启动的窗口"（乙之后那句已经不准确了）。
        const pluginPid = pid > 0 && codesysWindowOwnership?.ownsPid(pid, codesysReviveOwnedPids()) === true;
        const detail = pluginPid
          ? `这个 CODESYS 进程（PID ${pid}）由本插件启动，但它现在没有可用的顶层窗口（最小化或正在切换）：请点面板上的「刷新」后重试`
          : (selectedThisWindow
            ? '你点选过的那个 CODESYS 窗口现在不可用了（已关闭、最小化，或句柄已被替换）：请点面板上的「刷新」重新枚举后重选'
            : '这个外部启动的 CODESYS 窗口不是你当前点选的监视窗口：请先在面板的窗口列表里点选它（点选后它就是当前监视/读取窗口），再点「代码任务」');
        throw Object.assign(new Error(detail), {
          code: 'CODESYS_WORKBENCH_WINDOW_NOT_OWNED',
          windowId: requestedWindowId,
          pid,
          reason: pluginPid
            ? 'plugin-pid-without-usable-window'
            : (selectedThisWindow ? 'selected-external-window-unavailable' : 'not-plugin-launched-window'),
        });
      }
      externalLaunch = target.owned === false;
      boundWindowId = String(target.id);
      codesysPreferredWindowId = String(target.id);
      if (externalLaunch) {
        // 绑上外部窗口时**留一行**（不常驻、不改中央面板）：工作台状态与审计里都能看出
        // "这是外部启动（你选择的）"，而不是本插件启动的。成功路径不加别的文字。
        harness.append('codesys.workbench.window-bound', { windowId: String(target.id), pid: Number(target.pid || 0), title: String(target.title || ''), externalLaunch: true, pluginOwned: false, source: 'user-selection', automatic: false, at: new Date().toISOString() });
      }
    }
    const frame = currentHarnessFrame();
    if (!frame) throw new Error('Harness 工作区尚未就绪');
    await frame.executeJavaScript(`window.postMessage({source:'taskhive-desktop',type:'codesys.workbench.open'}, '*')`, true);
    return { opened: true, owner: 'Harness/DSH', agentLoop: 'single', windowId: boundWindowId, externalLaunch };
  });
  handleTrusted('codesys:code-ai-request', (_event, input) => harness.runTool('codesys.code-ai.request', { prompt: String(input?.prompt || '').slice(0, 2000) }, async () => {
    requirePluginEnabled('codesys-monitor');
    const prompt = String(input?.prompt || '').trim();
    if (!prompt) throw new Error('请输入 CODESYS 代码修改要求');
    const scriptEngineJobId = String(input?.scriptEngineJobId || '').trim();
    const offlineProject = scriptEngineJobId ? codesysScriptEngine.diff({ jobId: scriptEngineJobId }) : null;
    const jobId = `codesys-code-${Date.now()}`;
    const jobRoot = scriptEngineJobId ? path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', scriptEngineJobId, 'harness-requests', jobId) : path.join(root, 'workspaces', 'codesys-scriptengine', jobId);
    fs.mkdirSync(jobRoot, { recursive: true });
    const doctor = await codesysScriptEngine.doctor({ persist: true });
    const projectSnapshot = input?.projectSnapshot && typeof input.projectSnapshot === 'object' ? input.projectSnapshot : null;
    const modelContext = input?.modelContext && typeof input.modelContext === 'object' ? input.modelContext : null;
    const contextPath = path.join(jobRoot, 'project-context.json');
    const modelContextPath = path.join(jobRoot, 'model-context.json');
    if (projectSnapshot) fs.writeFileSync(contextPath, `${JSON.stringify(projectSnapshot, null, 2)}\n`, 'utf8');
    if (modelContext) fs.writeFileSync(modelContextPath, `${JSON.stringify(modelContext)}\n`, 'utf8');
    const contextStats = input?.contextStats && typeof input.contextStats === 'object' ? {
      chars: Math.max(0, Number(input.contextStats.chars) || 0), approxTokens: Math.max(0, Number(input.contextStats.approxTokens) || 0),
      selectedCount: Math.max(0, Number(input.contextStats.selectedCount) || 0), totalCount: Math.max(0, Number(input.contextStats.totalCount) || 0),
    } : null;
    const rawSourceProjectPath = String(offlineProject?.sourcePath || input?.projectSnapshot?.projectPath || '').trim();
    const sourceProjectPath = rawSourceProjectPath ? path.resolve(rawSourceProjectPath) : '';
    const pathAuthorization = buildCodesysPathAuthorization({
      sourceProjectPath,
      jobRoot,
      scriptEngineJobRoot: scriptEngineJobId ? path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', scriptEngineJobId) : '',
    });
    const request = { jobId, prompt, scriptEngineJobId, contextPath, modelContextPath: modelContext ? modelContextPath : '', contextStats, state: offlineProject ? 'ready-for-harness-project-tools' : 'awaiting-project-binding', policy: doctor.policy, createdAt: new Date().toISOString(), sourceProjectModified: false, offlineProject, pathAuthorization, review: { status: '待审查', mode: '当前工程+自动恢复快照', writesSourceProjectAfterConfirmation: true }, workspace: { root: jobRoot, request: path.join(jobRoot, 'request.json'), surface: 'codesys-workbench' } };
    fs.writeFileSync(path.join(jobRoot, 'request.json'), `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    harness.append('codesys.code-ai.queued', request);
    const workspaceEvent = { ...request, status: '已提交到当前 Harness 会话', result: offlineProject ? '当前工程已绑定；等待 AI 生成差异并由用户确认' : '等待绑定当前工程', audit: { owner: 'Harness/DSH', tool: 'codesys.code-ai.request', safety: '写前恢复快照+显式差异确认；在线 PLC 动作禁止' } };
    harness.append('codesys.code-ai.workspace-visible', workspaceEvent);
    const harnessFrame = currentHarnessFrame();
    (harnessFrame || mainWindow?.webContents)?.executeJavaScript(`window.postMessage({source:'taskhive-desktop',type:'codesys.task',payload:${JSON.stringify(workspaceEvent)}}, '*')`, true).catch(() => {});
    return request;
  }));
}

// T155：由 registerIpc() 机械拆出的域注册函数（按通道前缀分组；处理器实现逐字未改动）。
function registerTerminalIpc() {
  handleTrusted('terminal:run', (_event, command) => harness.runTool('terminal.run', { command: String(command || '').slice(0, 2000) }, () => new Promise((resolve, reject) => {
    const value = String(command || '').trim();
    if (!value) return resolve({ ok: true, stdout: '', stderr: '' });
    const invocation = shellInvocation(terminalShell, value);
    execFile(invocation.command, invocation.args, { cwd: root, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const result = { ok: !error, code: error?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || '') };
      if (error && !result.stderr) result.stderr = error.message;
      resolve(result);
    });
  })));
  handleTrusted('terminal:start', (_event, command) => harness.runTool('terminal.start', { command: String(command || '').slice(0, 2000) }, () => {
    const value = String(command || '').trim();
    if (!value) throw new Error('终端命令不能为空');
    const invocation = shellInvocation(terminalShell, value);
    const child = spawn(invocation.command, invocation.args, { cwd: root, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments, stdio: ['pipe', 'pipe', 'pipe'] });
    const taskId = `terminal-${Date.now()}-${child.pid || Math.random().toString(16).slice(2)}`;
    const task = { taskId, child, startedAt: new Date().toISOString(), command: value, output: '' };
    terminalTasks.set(taskId, task);
    const forward = (stream, chunk) => { const text = String(chunk || ''); task.output = `${task.output}${text}`.slice(-1024 * 1024); mainWindow?.webContents.send('terminal:data', { taskId, stream, text }); };
    child.stdout.on('data', (chunk) => forward('stdout', chunk)); child.stderr.on('data', (chunk) => forward('stderr', chunk));
    child.on('close', (code, signal) => { terminalTasks.delete(taskId); mainWindow?.webContents.send('terminal:exit', { taskId, code, signal }); });
    child.on('error', (error) => { forward('stderr', error.message); terminalTasks.delete(taskId); mainWindow?.webContents.send('terminal:exit', { taskId, code: -1, error: error.message }); });
    return { taskId, pid: child.pid || null, state: 'running', startedAt: task.startedAt };
  }));
  handleTrusted('terminal:stop', (_event, taskId) => harness.runTool('terminal.stop', { taskId }, async () => {
    const task = terminalTasks.get(String(taskId || ''));
    if (!task) return { taskId, state: 'not-found' };
    if (process.platform === 'win32' && task.child.pid) await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(task.child.pid), '/T', '/F'], { windowsHide: true }, () => resolve())); else task.child.kill('SIGTERM');
    terminalTasks.delete(task.taskId);
    return { taskId: task.taskId, state: 'stopped' };
  }));
  handleTrusted('terminal:status', () => ({
    ...terminalShell,
    versionParts: undefined,
    sidebarShell: process.env.DSH_SIDEBAR_SHELL,
    surfaces: ['内置终端', '模型 terminal_* 工具'],
    modelProcessPolicy: 'CLI 直接子进程继承环境；模型终端工具使用 sidebarShell',
  }));
}

function registerIpc() {
  registerHarnessIpc();
  // T151：surface 切换必须**串行 + 最后一次请求胜出**。旧实现是 fire-and-forget
  // (`void showPluginSurface(...)`)，而 `showPluginSurface` 在设置 `pluginSurfaceKind`
  // 之后还有 `await loadFile` / `await executeJavaScript(postMessage)` —— 两次快速切换时
  // 最终显示谁由 await 完成顺序决定，可能与用户操作顺序相反（"经常性空白/显示错的页"同族）。
  registerSurfaceIpc();
  registerAppIpc();
  registerModelIpc();
  // Set or clear the credential/endpoint of an existing provider (used for the
  // built-in DeepSeek API entry as well as custom endpoints).
  registerSettingsIpc();
  registerPluginIpc();
  registerRepositoryIpc();
  registerKnowledgeIpc();
  // T141：知识库目录（"书"）由用户自己整理 —— 把卡片归到指定目录/清空。
  // T152：批量版本（改书名 / AI 归类都用它，避免逐卡整文件重写）。
  // T144：书本自定义（名字 / 颜色）。
  // T147：**用 AI 识别内容给"已入库"卡片分书**（例如「自动化」「Python」这类主题书）。
  // 走本机 codex CLI 的非交互模式（`codex exec`，prompt 经 stdin 传入，避免引号问题）。
  // 失败/超时**不抛错**，返回 { ok:false, reason }，由客户端回退到本地规则分类。
  // T148：把"当前会话模型路由"告诉界面，让用户能核对 AI 整理到底用的是哪个模型。
  // T127：知识库视图需要只读地列出仓库索引（catalog + repositories/*/knowledge.json）。
  // 只读目录文件，不执行任何仓库代码、不安装任何东西 —— 与 taskhive-open-source/README.md 一致。
  registerWebAiIpc();
  registerBrowserIpc();
  // T153：`maxAgeMs` 允许复用 ≤4 s 的窗口枚举快照。CODESYS follow 循环每秒调用一次本方法，
  // 每次都起一个 PowerShell（实测 662–1034 ms）—— 4 s 快照把它压到每 4 秒一次，
  // 而界面刷新的实时性几乎无损（需要实时时刷新按钮走 `codesys:current-project`）。
  registerCodesysIpc();
  // ── Online (PLC) actions ────────────────────────────────────────────────────
  // Only `login`, `logout` and `download` reach a controller, and only under an
  // authorization the operator armed from the workbench UI. `online-change`,
  // variable writes, start/stop/reset, debugging, breakpoints, stepping and Force
  // have no IPC entry point at all.
  // 独立通道：界面**只要调用成功**就证明主进程不旧（旧主进程没有这个 handler，
  // 调用会直接失败）。这是唯一能自证"跑着的引擎是不是磁盘上那一份"的办法。
  // Device discovery. This is CODESYS' "scan network": the gateway broadcasts and
  // reports controllers. No controller is contacted, nothing is written, and no
  // authorization is needed — it only replaces typing an IP by hand.
  // Retargeting the session. This writes ONLY to the throwaway project copy the
  // worker holds (it is never saved), so the operator's .project is untouched; it
  // does contact no controller. A successful change invalidates the armed
  // authorization, because that grant names a specific target.
  // Explicit release: stop the persistent CODESYS worker (≈700 MB) without
  // touching the authorization. Used by the workbench's 「释放在线会话」 button so
  // the operator is never stuck with a hidden process they cannot get rid of.
  // Preparing the online worker touches NO controller: it opens a copy of the
  // bound project and reads the target that a login would use. That is precisely
  // why it needs no authorization and can run as soon as a project is bound —
  // the operator has to be able to see WHERE a login goes before allowing one.
  // Online value monitoring. This is a READ, so it is deliberately NOT wrapped in
  // harness.runTool (it polls about once a second and would flood the trajectory);
  // it is still only served for a session the operator armed and that the worker
  // reports as logged in.
  // The CODESYS native input path is only ever driven by the TaskHive shell.
  // Without a sender check any script in a preload-bearing context could move
  // the operator's real mouse and type into the live CODESYS window.
  // The operator switching "AI 操作" on is the only thing that may auto-approve
  // native input. Record it in the main process so the direct path can verify
  // that a real user gesture armed this exact window.
  registerTerminalIpc();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 960, minHeight: 640,
    backgroundColor: '#f4f2ed',
    icon: path.join(root, 'app', 'assets', 'taskhive-icon-v3.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.on('page-title-updated', (event) => { event.preventDefault(); mainWindow?.setTitle('TaskHive'); });
  mainWindow.on('move', scheduleCodesysNativeMove);
  mainWindow.on('resize', scheduleCodesysNativeMove);
  mainWindow.on('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  });
  mainWindow.on('close', (event) => {
    if (quitting || smokeLaunch()) return;
    event.preventDefault();
    if (closePromptInFlight) return;
    closePromptInFlight = true;
    suspendedCloseSurface = suspendChildViewsForClosePrompt();
    mainWindow.webContents.send('app:close-confirmation', {
      title: '关闭 TaskHive？',
      detail: '关闭前会安全回收 Harness、终端、浏览器和插件任务。',
    });
  });
  // Correction to a wrong diagnosis that was recorded here: this used to claim
  // "Electron 30+ delivers this event as (event, details)" and that the
  // positional `level >= 2` test therefore never held, blaming that silence for
  // the 431-blank-window outage. Electron 43.4.0 does not behave that way — its
  // JS layer re-emits `(event, event._level, event.message, event.lineNumber,
  // event.sourceId)` after the event object (see
  // lib/browser/api/web-contents.ts), so the integer level was still valid and
  // renderer warnings/errors were in fact being recorded. The 431 outage needs
  // its own explanation; that wrong causal story is not left standing here.
  attachRendererConsoleLogging(mainWindow.webContents, 'main-window');
  // T151：同一个文件在 `attachRendererConsoleLogging` 里走带轮转的
  // `appendDiagnosticLog`，原来这里却用裸 appendFileSync 绕过上限 —— 现已统一收口。
  // 同一次挂载还接管了 render-process-gone / unresponsive / did-fail-load：
  // 主窗口渲染进程死掉时不再只有一行日志，而是进入 smokeRendererErrors。
  attachRendererLifecycleLogging(mainWindow.webContents, 'main-window');
  mainWindow.on('closed', () => {
    // T188：面板宿主窗口就是被托管 CODESYS 窗口的 **owner**（GWLP_HWNDPARENT）。宿主被销毁
    // 而 owner 关系还在时，Windows 会**连被拥有的窗口一起销毁** —— 那会直接关掉用户正在用的
    // CODESYS；而且看门狗会继续对着一个已经不存在的宿主重新托管。所以先停看门狗、再把窗口从
    // 宿主摘出来（detach 是无幂等的：没有 session 就是 no-op），最后才清面板状态。
    codesysNativeHost?.stopWatchdog?.();
    void codesysNativeHost?.detach('main-window-closed')?.catch(() => {});
    try { pluginSurfaceView?.webContents?.close(); } catch { /* already closed */ }
    pluginSurfaceView = null;
    pluginSurfaceKind = null;
    pluginSurfaceBounds = null;
    pluginSurfaceAttached = false;
    mainWindow = null;
  });
  const workbenchUrl = harnessWorkbenchUrl();
  if (!workbenchUrl) throw new Error('Harness workbench URL is unavailable');
  // This window carries the preload bridge and its URL contains the Harness
  // auth token, so it must never navigate away from the local runtime.
  guardWorkbenchNavigation(mainWindow.webContents, 'main-window');
  // The Harness host mints one `dsh-auth-<token>` cookie per launch and scopes it
  // to 127.0.0.1, which ignores ports. Nothing ever expired them, so every request
  // carried all of them; once the Cookie header crossed the host's 16KB request
  // header limit, EVERY navigation answered 431 with an empty body — a window that
  // renders nothing at all, with no renderer error to explain it. Drop the stale
  // ones before loading so only this launch's cookie is ever sent.
  const workbenchSession = mainWindow.webContents.session;
  workbenchSession.cookies.get({ url: 'http://127.0.0.1' })
    .then((cookies) => Promise.all(cookies
      .filter((cookie) => String(cookie.name || '').startsWith('dsh-auth-'))
      .map((cookie) => workbenchSession.cookies.remove('http://127.0.0.1', cookie.name).catch(() => undefined))))
    .catch((error) => reportBootstrapProblem(`stale harness cookie cleanup failed: ${error?.message || error}`))
    .then(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(workbenchUrl); });
  // A workbench that answers with an error document still finishes loading, so
  // nothing else notices a blank window. Measure what actually rendered and record
  // the cause in errors.log instead of leaving it unexplained (see
  // docs/KNOWN-ISSUES.md; `tools/inspect-workbench.mjs` does the same on demand).
  mainWindow.webContents.on('did-finish-load', () => { void diagnoseBlankWorkbench(); });
  if (process.env.TASKHIVE_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
}

let blankWorkbenchReported = false;

async function diagnoseBlankWorkbench() {
  try {
    const contents = mainWindow?.webContents;
    if (!contents || contents.isDestroyed() || blankWorkbenchReported) return;
    const state = await contents.executeJavaScript(`(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      return { bodyLength: (document.body && document.body.innerHTML || '').length, status: nav.responseStatus || 0, scripts: document.scripts.length };
    })()`, true);
    if (!state || Number(state.bodyLength) > 0) return;
    blankWorkbenchReported = true;
    const cookies = await contents.session.cookies.get({ url: 'http://127.0.0.1' }).catch(() => []);
    const auth = cookies.filter((cookie) => String(cookie.name || '').startsWith('dsh-auth-'));
    const authBytes = auth.reduce((sum, cookie) => sum + `${cookie.name}=${cookie.value}`.length + 2, 0);
    const cause = Number(state.status) === 431
      ? 'HTTP 431 request headers too large — stale dsh-auth-* cookies (see docs/KNOWN-ISSUES.md issue #1)'
      : `navigation status=${state.status} scripts=${state.scripts} — see docs/KNOWN-ISSUES.md`;
    reportBootstrapProblem(`workbench rendered an empty document: ${cause}. cookies=${cookies.length} dsh-auth=${auth.length} authHeaderBytes≈${authBytes}`);
  } catch { /* diagnosis must never break startup */ }
}

// Tell the workbench which CODESYS window is being monitored, so it re-detects
// instead of waiting for its next poll. Payload-free messages would be enough,
// but the id makes the audit trail readable.
async function notifyMonitoredWindowChanged(windowId) {
  const frame = currentHarnessFrame();
  if (!frame) return;
  await frame.executeJavaScript(`window.postMessage({source:'taskhive-desktop',type:'codesys.workbench.window',windowId:${JSON.stringify(String(windowId || ''))}}, '*')`, true).catch(() => {});
}

function currentHarnessFrame() {
  const mainFrame = mainWindow?.webContents?.mainFrame;
  if (!mainFrame) return null;
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(mainFrame.url || '')) return mainFrame;
  return (mainFrame.frames || []).find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url || '')) || null;
}

async function openSurfaceForProbe(kind, selector, timeoutMs = 15000, requestOpen = true) {
  // T138：knowledge 已改为**由 DSH 客户端插件自渲染**（不再有原生 surface，见 T137）。
  // 因此它的标记要在 DSH 工作台帧里找，而不是 `pluginSurfaceView`。
  // 先点一下 DSH 侧栏的知识库入口把面板选中，再轮询标记 —— 这样三处探针无需各自改写。
  if (kind === 'knowledge') {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = currentHarnessFrame();
      if (frame) {
        await frame.executeJavaScript(`(() => {
          const entry = [...document.querySelectorAll('button,[role="button"],[role="tab"]')]
            .find((node) => String(node.textContent || '').trim() === '知识库' && node.getBoundingClientRect().width > 0);
          if (entry) entry.click();
          return Boolean(entry);
        })()`, true).catch(() => false);
        const found = await frame.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, true).catch(() => false);
        if (found) return frame;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Plugin surface timeout: ${kind} ${selector || ''}`.trim());
  }
  if (requestOpen && (!pluginSurfaceAttached || pluginSurfaceKind !== kind)) await mainWindow.webContents.executeJavaScript(`window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:${JSON.stringify(kind)}}, '*')`, true);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pluginSurfaceAttached && pluginSurfaceKind === kind && pluginSurfaceView && !pluginSurfaceView.webContents.isDestroyed() && !pluginSurfaceView.webContents.isLoading()) {
      if (!selector || await pluginSurfaceView.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, true).catch(() => false)) return pluginSurfaceView.webContents;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Plugin surface timeout: ${kind} ${selector || ''}`.trim());
}

// T199（②）自测用：把外壳自己的渲染文档（app/renderer/index.html —— 设置页就渲染在里面）加载
// 起来并返回它的 webContents。
//
// 为什么不用 `showPluginSurface(...)`：`surfaceDescriptors()` 明确把 plugin-manager 排除在外
// （`item.id !== 'plugin-manager'`），所以 'packages' 这个 surface **根本没有描述符** ——
// showPluginSurface 会静默早退（这也解释了 `openSurfaceForProbe('packages', ...)` 为什么必然
// 超时）。剩下两个候选里，'knowledge' 由 DSH 自渲染（同样早退），'codesys' 会顺手点火 T183 的
// 常驻预热（约 700 MB）—— 对一次"设置页开关"的自测来说是纯噪声。
// 这里只做 showPluginSurface 里"把外壳文档加载起来"的那一步，而且要的正是这个文档：面板身份门
// 的判据就是"外壳 app/renderer 文档的顶层帧"，所以设置页调那两个新通道走的是**真实**那道门。
async function openShellRendererForProbe() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (!pluginSurfaceView) {
    pluginSurfaceView = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    pluginSurfaceView.setBackgroundColor('#ffffff');
    guardWorkbenchNavigation(pluginSurfaceView.webContents, 'plugin-surface');
  }
  await pluginSurfaceView.webContents.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { embed: '1', surface: 'chat' } });
  const ready = () => {
    const view = pluginSurfaceView;
    return Boolean(view && !view.webContents.isDestroyed() && !view.webContents.isLoading());
  };
  for (let attempt = 0; attempt < 120 && !ready(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 250));
  if (!ready()) throw new Error('外壳渲染文档没有就绪：设置页自测无法进行');
  const shell = pluginSurfaceView.webContents;
  // 左栏「设置」的事件是在 `renderSidebars()` 里绑的，而它排在启动 IIFE 的一次 await 之后：
  // 必须等到 `data-bound` 落了再点，否则点了个没有监听器的按钮。
  let bound = false;
  for (let attempt = 0; attempt < 120 && !bound; attempt += 1) {
    bound = await shell.executeJavaScript(`Boolean(document.querySelector('#left-settings') && document.querySelector('#left-settings').dataset.bound === '1')`, true).catch(() => false);
    if (!bound) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!bound) throw new Error('外壳渲染文档里没有绑定好的左侧栏「设置」入口');
  return shell;
}

// T199（②）自测：把「启动时预打开 CODESYS 工程」从"只有环境变量的隐藏旋钮"搬进设置页之后，
// 四件事必须**真的**成立，而且必须由**走用户那条路**的动作证明：
//   1. 设置页上真的有这一项，默认值 = 改动前的行为（开），并且代价说明那一行真的显示；
//   2. 在界面上关掉 → 持久化的偏好文件变成 false，主进程的判定跟着变成 false；
//      再打开 → 回到 true（反过来也证明勾选框不是装饰）；
//   3. 优先级 env 显式 > 界面 > 默认（三种组合逐一执行，不是读注释）；
//   4. probe / smoke 轮**三个触发点一个都不点火**，且各自留下一行
//      `preopen.skipped {skipped:"smoke-or-probe-run"}`。
//
// 「重启后保持」由它留下的状态 + 之后那两次**普通**启动的审计行证明（探针自己重启不了自己）：
// 探针默认把开关放在**关**上，于是紧接着的普通启动必须出现 `disabled-by-setting` 而不是点火；
// `--probe-codesys-preopen-setting-on` 那一轮放在**开**上，于是普通启动必须真的点火。
//
// 判据落在真实动作上：点外壳左栏的「设置」（与用户同一条路）→ 读它渲染出来的 DOM → 点那个
// 勾选框（preload → IPC → 主进程 → atomic-json 写盘）。不直接调用 handler，也不写任何
// "看起来对"的假数据。任何一条不成立：证据里 ok:false + 非零退出码 —— 探针不许撒谎。
async function runCodesysPreopenSettingProbe(leaveOn = false) {
  if (!smokeLaunch()) throw new Error('探针必须在 smoke/probe 运行里执行（smokeLaunch() 为假）');
  // 审计流是 harness 的那一条（`{at,type,payload}`），不是引擎自己的耗时表：
  // "没点火"那三种结局是 `harness.append(...)` 写出来的。
  const auditPath = path.join(root, 'logs', 'trajectory.jsonl');
  const readAudit = () => {
    try {
      return fs.readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch { return [] }
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 默认值要**真的**验：先把偏好文件挪开（原内容进证据），这样"界面默认开"才是被执行的。
  const preferencePath = codesysPreferencesPath();
  const previousPreference = fs.existsSync(preferencePath) ? fs.readFileSync(preferencePath, 'utf8') : null;
  if (previousPreference !== null) fs.rmSync(preferencePath, { force: true });

  const shell = await openShellRendererForProbe();
  const openSettings = () => shell.executeJavaScript(`(() => {
    const button = document.querySelector('#left-settings');
    if (!button) return false;
    button.click();
    return true;
  })()`, true);
  // 设置页是异步渲染的，而且外壳文档自己的启动 IIFE 可能还在跑：点一次没成功就再点一次
  // （下面那个 80 次轮询里每 10 次补一次点击）。绝不"点了就假定成功"。
  let opened = false;
  for (let attempt = 0; attempt < 60 && !opened; attempt += 1) {
    opened = await openSettings().catch(() => false);
    if (!opened) await wait(250);
  }
  if (!opened) throw new Error('外壳左栏没有「设置」入口，打不开设置页');

  const readToggle = () => shell.executeJavaScript(`(() => {
    const toggle = document.querySelector('#codesys-preopen-on-start');
    if (!toggle) return { found: false };
    const cost = document.querySelector('#codesys-preopen-cost');
    const status = document.querySelector('#codesys-preopen-status');
    return {
      found: true,
      checked: toggle.checked === true,
      startupTab: Boolean(document.querySelector('[data-settings-tab="startup"]')),
      startupPanel: Boolean(document.querySelector('[data-settings-panel="startup"]')),
      costNote: String(cost ? cost.textContent : '').trim(),
      statusText: String(status ? status.textContent : '').trim(),
      statusHidden: status ? status.hidden === true : true
    };
  })()`, true);

  let ui = { found: false, costNote: '' };
  // 等到**主进程那次读也回来了**为止：代价说明那一行与勾选框是同一段代码填的
  // （loadPreopenSetting），所以"代价行有字"就是"界面已经镜像了主进程的值"。
  // 只看元素存在是不够的 —— 那时勾选框还是 markup 的默认（未勾），会误判成"默认关"。
  for (let attempt = 0; attempt < 120 && !(ui.found === true && String(ui.costNote || '').trim()); attempt += 1) {
    ui = await readToggle().catch(() => ({ found: false, costNote: '' }));
    if (ui.found !== true || !String(ui.costNote || '').trim()) {
      // 每 10 次补点一下「设置」：外壳文档的启动 IIFE 可能比第一次点击晚一点点绑上事件。
      if (attempt % 10 === 9) await openSettings().catch(() => false);
      await wait(250);
    }
  }
  if (ui.found !== true) throw new Error('设置页里没有「启动时预打开 CODESYS 工程」这一项');
  if (!String(ui.costNote || '').trim()) throw new Error('设置页没有等到主进程返回的代价说明');
  const initialChecked = ui.checked === true;

  const clickToggle = async () => {
    const before = await readToggle();
    const want = before.checked !== true;
    await shell.executeJavaScript(`(() => { const toggle = document.querySelector('#codesys-preopen-on-start'); if (!toggle) return false; toggle.click(); return true; })()`, true);
    // 落盘才是这一次点击的真相：等到偏好文件里的值与点击后的期望一致（或超时）。
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await wait(250);
      if (readCodesysPreferences().preopenOnStart === want) break;
    }
    // 再等界面把它镜像出来（renderer 在保存之后才写状态行）。
    let after = await readToggle();
    for (let attempt = 0; attempt < 20 && after.checked !== want; attempt += 1) { await wait(250); after = await readToggle() }
    return after;
  };

  const checks = [];
  const record = (name, ok, detail) => { checks.push({ name, ok: ok === true, detail }) };

  record('settings-page-has-the-switch', ui.found === true && ui.startupTab === true && ui.startupPanel === true,
    { startupTab: ui.startupTab, startupPanel: ui.startupPanel });
  // 默认值 = 当前行为（开）：偏好文件刚被删掉，所以这里读到的就是纯默认。
  record('defaults-to-on-with-no-stored-value', initialChecked === true, { checked: initialChecked, storedFileBefore: previousPreference === null ? 'absent' : 'existed' });
  // 代价一行必须真的显示出来（用户要的那句"关掉可省…"；只在设置页里，不是常驻噪音）。
  record('shows-the-cost-line', ui.costNote.includes('670 MB') && ui.costNote.includes('38'),
    { costNote: ui.costNote.slice(0, 140) });

  // ② 界面关 → 文件 false + 主进程判定 false。
  const offUi = await clickToggle();
  const offStored = readCodesysPreferences();
  const offEffective = codesysPreopenOnStartEnabled();
  record('ui-off-persists-false', offUi.checked === false && offStored.preopenOnStart === false && offEffective === false,
    { uiChecked: offUi.checked, stored: offStored.preopenOnStart, effective: offEffective, status: offUi.statusText });

  // ② 界面开 → 文件 true + 主进程判定 true。
  const onUi = await clickToggle();
  const onStored = readCodesysPreferences();
  const onEffective = codesysPreopenOnStartEnabled();
  record('ui-on-persists-true', onUi.checked === true && onStored.preopenOnStart === true && onEffective === true,
    { uiChecked: onUi.checked, stored: onStored.preopenOnStart, effective: onEffective, status: onUi.statusText });

  // ③ 优先级：环境变量**显式**设置 > 界面设置 > 默认。
  //    先把界面置 false，再逐一组合 —— 三种组合都必须被执行到，不能只读注释。
  writeCodesysPreferences({ preopenOnStart: false });
  delete process.env[CODESYS_PREOPEN_ON_START_ENV];
  const precedenceUiOnly = codesysPreopenOnStartEnabled();
  process.env[CODESYS_PREOPEN_ON_START_ENV] = '1';
  const precedenceEnvOn = codesysPreopenOnStartEnabled();
  process.env[CODESYS_PREOPEN_ON_START_ENV] = '0';
  const precedenceEnvOff = codesysPreopenOnStartEnabled();
  delete process.env[CODESYS_PREOPEN_ON_START_ENV];
  record('precedence-env-explicit-beats-ui',
    precedenceUiOnly === false && precedenceEnvOn === true && precedenceEnvOff === false,
    { uiOffNoEnv: precedenceUiOnly, env1: precedenceEnvOn, env0: precedenceEnvOff });

  // ④ 点火门：probe / smoke 轮三个触发点一个都不许点火，每个各留一行 smoke-or-probe-run。
  //    先把开关放回**开**（上面的优先级表把它留在了关）：这样"没点火"必须由**这道门**解释，
  //    而不是被 disabled-by-setting 顺手挡掉 —— 否则这一条检查什么也没证明。
  writeCodesysPreferences({ preopenOnStart: true });
  const gateStart = readAudit().length;
  // 三个触发点各走**它自己**那条路：①② 是真实函数调用（② 用的是命中时的门判定，因为
  // `codesys:current-project` 的 handler 只能在收到 IPC 时执行），③ 是启动那个函数。
  preopenRememberedCodesysProject('codesys-surface-open');
  const triggerTwoGated = preopenSmokeGateApplies('current-project-detected', 'current-project-detected');
  preopenRememberedCodesysProjectOnStart('application-start');
  await wait(800);
  const gateRows = readAudit().slice(gateStart);
  const gateModes = gateRows
    .filter((line) => line.type === 'codesys.scriptengine.preopen.skipped' && line.payload?.skipped === 'smoke-or-probe-run')
    .map((line) => line.payload?.mode);
  // "点火"= 引擎真的被要求做一次预打开（成功行、失败行、以及它自己那条耗时行都算）。
  const gateIgnitions = gateRows.filter((line) => line.type === 'codesys.scriptengine.preopen'
    || line.type === 'codesys.scriptengine.preopen.failed'
    || (line.type === 'codesys.scriptengine.timing' && line.payload?.action === 'preopen-project')).length;
  record('probe-run-never-ignites', gateIgnitions === 0, { ignitions: gateIgnitions, skipModes: gateModes });
  record('probe-gate-skips-trigger-1', gateModes.includes('codesys-surface-open'), { skipModes: gateModes });
  record('probe-gate-skips-startup', gateModes.includes('application-start'), { skipModes: gateModes });
  record('probe-gate-skips-trigger-2', triggerTwoGated === true && gateModes.includes('current-project-detected'), { triggerTwoGated, skipModes: gateModes });

  // 探针留下的状态：默认放在**关**上（紧接着那两次普通启动必须"不点火"）；`-on` 那一轮放在
  // **开**上（紧接着的普通启动必须真的点火）。两种都由**界面上那一次点击**写盘。
  // 上面那两段直接写盘（优先级表 / 门）绕过了界面，所以这里先重开一次设置页让界面重新
  // 镜像主进程，再按**期望的状态**决定要不要点 —— 不能盲目点一下：盲目点等于"取反"，
  // 界面本来就对的时候反而会把它点错。
  await openSettings();
  await wait(500);
  let finalUi = await readToggle();
  for (let attempt = 0; attempt < 40 && !(finalUi.found === true && String(finalUi.costNote || '').trim()); attempt += 1) {
    await wait(250);
    finalUi = await readToggle();
  }
  const wantFinal = leaveOn === true;
  if ((finalUi.checked === true) !== wantFinal) finalUi = await clickToggle();
  const finalStored = readCodesysPreferences();
  const finalEffective = codesysPreopenOnStartEnabled();
  record(leaveOn ? 'leaves-setting-on' : 'leaves-setting-off',
    finalStored.preopenOnStart === leaveOn && finalEffective === leaveOn && finalUi.checked === leaveOn,
    { stored: finalStored.preopenOnStart, effective: finalEffective, uiChecked: finalUi.checked, status: finalUi.statusText });

  const evidence = {
    ok: checks.every((check) => check.ok === true),
    probe: 'codesys-preopen-setting',
    leaveOn: leaveOn === true,
    checks,
    failed: checks.filter((check) => check.ok !== true).map((check) => check.name),
    preferencePath,
    previousPreference,
    preferenceOnDisk: finalStored,
    costNote: ui.costNote,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'codesys-preopen-setting-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) {
    const error = new Error(`codesys-preopen-setting-probe-failed: ${evidence.failed.join(', ')}`);
    error.details = evidence;
    throw error;
  }
  return evidence;
}





// Runtime-only evidence probe. It intentionally inspects the real DSH frame
// instead of inferring Settings geometry from package names or CSS.


// T104：「点开侧栏入口是空白」以前只能靠用户发现 —— 现有探针只验证面板外壳里那几个
// 状态单元格（#scriptengine-status），没有任何一条验证**工作台标签**本身能不能渲染。
// （T164 删掉「AI 实时监视」后 `#vision-status` 已不存在，这条哨兵改指 ScriptEngine 状态。）
// 这个探针把"工作台渲染出来了吗"变成一条可执行检查，并且明确区分三种结果：
//   root 出现且有控件      → ok
//   命中崩溃兜底（T104）   → workbench-render-crash（并带上错误文本）
//   30 秒什么都没出现      → workbench-not-rendered（多半是插件 bundle 没执行）













function visibleConsoleWindows() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = "$names=@('powershell','pwsh','cmd','conhost','WindowsTerminal'); Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [pscustomobject]@{id=$_.Id;name=$_.ProcessName;handle=[int64]$_.MainWindowHandle;title=$_.MainWindowTitle} } | ConvertTo-Json -Compress";
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }, (_error, stdout) => {
    try { const value = JSON.parse(String(stdout || '[]').trim() || '[]'); resolve(Array.isArray(value) ? value : value ? [value] : []); } catch { resolve([]); }
  }));
}

function monitorVisibleConsoleWindows(durationMs = 1600) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const safeDuration = Math.max(300, Math.min(5000, Number(durationMs) || 1600));
  const script = `$names=@('powershell','pwsh','cmd','conhost','WindowsTerminal');$seen=@{};$until=[DateTime]::UtcNow.AddMilliseconds(${safeDuration});do{Get-Process -ErrorAction SilentlyContinue|Where-Object{$names -contains $_.ProcessName -and $_.MainWindowHandle -ne 0}|ForEach-Object{$seen[[string]$_.Id]=[pscustomobject]@{id=$_.Id;name=$_.ProcessName;handle=[int64]$_.MainWindowHandle;title=$_.MainWindowTitle}};Start-Sleep -Milliseconds 40}while([DateTime]::UtcNow -lt $until);@($seen.Values)|ConvertTo-Json -Compress`;
  return new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: safeDuration + 5000, maxBuffer: 1024 * 1024 }, (_error, stdout) => {
    try { const value = JSON.parse(String(stdout || '[]').trim() || '[]'); resolve(Array.isArray(value) ? value : value ? [value] : []); } catch { resolve([]); }
  }));
}






// The packaged smoke probes live in ./smoke/probes.js. Getter members keep the
// context live: mainWindow is created later and pluginSurfaceKind changes on
// every surface switch, so a captured value would go stale.
const probes = createProbes({
  BrowserWindow, codesysExternalProgramLifecycle, codesysFixtureIdentityStable, codesysFixtureLifecycleSnapshot, codesysSmokeProjectPath, crypto, currentHarnessFrame, dialog, execFile, fs, hideWebAiView, modelCatalog, monitorVisibleConsoleWindows, openSurfaceForProbe, path, root, showPluginSurface, visibleConsoleWindows, webAiBounds, webAiViews, webAiWindowState, webContents,
  get activeWebAiViewId() { return activeWebAiViewId; },
  set activeWebAiViewId(value) { activeWebAiViewId = value; },
  get codesysNativeHost() { return codesysNativeHost; },
  get harness() { return harness; },
  get lastSurfaceGeometry() { return lastSurfaceGeometry; },
  get mainWindow() { return mainWindow; },
  get monitor() { return monitor; },
  get pluginSurfaceAttached() { return pluginSurfaceAttached; },
  get pluginSurfaceBounds() { return pluginSurfaceBounds; },
  get pluginSurfaceKind() { return pluginSurfaceKind; },
  get pluginSurfaceView() { return pluginSurfaceView; },
  get repositories() { return repositories; },
  get runtimeRoot() { return runtimeRoot; },
  get splashWindow() { return splashWindow; },
  get webAiAttached() { return webAiAttached; },
  get webAiView() { return webAiView; },
  set webAiView(value) { webAiView = value; },
});
const { probeSplash, probeDeepDivingDisclosure, probeHarnessFrames, probeTaskHiveBranding, probeNativeSettings, probeCodesysWorkbenchProject, probeCodesysWorkbenchRender, exerciseTaskHiveSurface, probeHistorySessionSwitch, probeSessionDeletion, probePluginRightSidebar, probeSidebarPluginLabels, probeCodesysNativeHost, probeBrowserSurface, probeWebLoginGate, exercisePackageSurface, exerciseRepositorySurfaces, probeInteractiveMetadata, probeSettingsPluginWindowVisibility, exerciseChartSurface, probeDshToolCall, probeGenerationCancellation, probeRuntimeIntegrations } = probes;


// Two live instances would share-write resources/app/profiles (DSH home,
// model catalog, directory list) and each spawn its own Harness server. Smoke
// runs are exempt so parallel isolated QA runs stay possible.
if (!smokeLaunch() && !app.requestSingleInstanceLock()) {
  fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} second-instance-rejected\n`, 'utf8');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  seedPortableProfile(startupPaths, startupPathLog);
  if (process.argv.includes('--update-directory-manifest')) {
    generateDirectoryManifest(programRoot);
    app.exit(0);
    return;
  }
  runtimeRoot = process.env.TASKHIVE_RUNTIME_ROOT
    ? path.resolve(process.env.TASKHIVE_RUNTIME_ROOT)
    : (app.isPackaged ? path.join(app.getPath('userData'), 'runtime') : root);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  // Share the known-good default workspace with host plugins so a stale
  // persisted session cwd never falls back to an unrelated process cwd.
  process.env.TASKHIVE_DEFAULT_WORKSPACE = path.join(root, 'workspaces', 'harness-default');
  repairPersistedDefaultWorkspacePaths(runtimeRoot);
  noteRuntimeOwner(runtimeRoot);
  assertHarnessSlotConsistency(runtimeRoot);
  // T152：目录清单的整树扫描（本机 9420 目录 / 41977 文件 / 2219 ms + 233 MB exe 重哈希）
  // 原先在这里就 `schedule(2500)`，正好落在 DSH 冷启动（4.3–4.9 s，冷缓存可达数十秒）
  // 的窗口里，两者争抢同一批文件的磁盘读。挪到主窗口创建之后，让它与首屏渲染争用而不是
  // 与冷启动争用。
  createSplashWindow();
  createCodesysMediaFixture();
  if (process.argv.includes('--smoke-splash')) {
    let exitCode = 0;
    try {
      await probeSplash();
    } catch (error) {
      fs.writeFileSync(path.join(root, 'logs', 'splash-probe-error.json'), JSON.stringify({ ok: false, message: error.message, stack: error.stack, at: new Date().toISOString() }, null, 2), 'utf8');
      exitCode = 1;
    } finally {
      app.exit(exitCode);
    }
    return;
  }
  updateSplash('正在准备 TaskHive', 8, '初始化桌面客户端');
  harness = new HarnessCore(root);
  webAiBridge = new WebAiBridge(handleWebAiChat);
  await webAiBridge.start();
  const portableMnemon = path.join(root, 'plugins', 'runtimes', 'mnemon', '0.2.5', 'windows-x64', 'mnemon.exe');
  const mnemonEnvironment = fs.existsSync(portableMnemon)
    ? { MNEMON_CLI_PATH: portableMnemon, MNEMON_DATA_DIR: path.join(runtimeRoot, 'knowledge', 'mnemon-native') }
    : {};
  harnessRuntime = new HarnessRuntime(root, {
    dshHome: path.join(runtimeRoot, 'profiles', 'dsh'),
    environment: {
      ...webAiBridge.environment(),
      ...mnemonEnvironment,
      // API keys live only in the main process; the Harness child receives them
      // as environment variables, which is the channel the adapter reads.
      ...apiCredentialEnvironment(),
      DSH_SIDEBAR_SHELL: terminalShell.command,
      TASKHIVE_TERMINAL_SHELL_VERSION: terminalShell.version,
    },
  });
  pluginManager = new PluginManager(root);
  writeDshPatch();
  codesysWindowOwnership = new CodesysWindowOwnership({ allowFixtures: smokeLaunch() && process.env.TASKHIVE_CODESYS_TEST_FIXTURE === '1' });
  monitor = new CodesysWindowMonitor(root, { ownership: codesysWindowOwnership });
  codesysScriptEngine = new CodesysScriptEngine(root, {
    // T183 第 0 项（埋点接线）：引擎每个动作已经产出一条固定字段的耗时记录（它自己先 append
    // 一行到 `logs/codesys-timings.jsonl`），这里把**同一条记录原样**再送进 harness 审计流 ——
    // 一条记录一行、字段一个不改，于是"引擎耗时日志"和审计流说的是同一件事，不必拿两套口径
    // 去对。接线本身没有逻辑：harness.append 不抛，引擎那侧也把 sink 包在 try 里。
    timingSink: (record) => harness.append('codesys.scriptengine.timing', record),
  });
  codesysInput = new CodesysInputController(root, monitor);
  codesysNativeHost = new CodesysNativeHost(root, monitor);
  repositories = { knowledge: new RepositoryManager(root, 'knowledge') };
  directoryStore = new DirectoryStore(root, programRoot);
  codesysLaunchedRegistry = new CodesysLaunchedRegistry(root);
  // A previous session that died without running its exit cleanup leaves CODESYS
  // instances running in the background. Sweep them now, under the same safety
  // rules (never touch unsaved work, never touch a recycled PID).
  const leftoverCodesysInstances = codesysLaunchedRegistry.pending();
  if (leftoverCodesysInstances.length) {
    void closeLaunchedCodesysInstances('startup-sweep', leftoverCodesysInstances)
      // T194：被判 keep 的实例**不能**连记录一起被标记成"干净退出"。`keep` 最常见的原因
      // 就是 `no-window` —— 也就是"窗口被隐藏了，可见性枚举看不见它"，而那正是自愈要处理的
      // 那一个；markCleanExit() 会把这条记录抹掉，此后它既不会被退出清理关闭、也不会再被扫描到。
      .then((result) => { if (!(result?.kept || []).length) codesysLaunchedRegistry?.markCleanExit(); })
      .catch(() => {})
      // T194：自愈必须排在 sweep **之后**：反过来的话，刚被显示的窗口会被 sweep 当成"可见的
      // 遗留实例"直接关掉（用户会看到窗口闪一下就没了）。两件事的判据因此天然不重叠：
      // sweep 只关它看得见的窗口，自愈只显示隐藏的窗口。
      .then(() => scheduleCodesysNativeRevive('startup', { force: true, ownedPids: leftoverCodesysInstances.map((record) => Number(record?.pid)) }));
  } else {
    // T194：没有遗留实例也要试一次 —— 上一次运行"关了机/被杀"时窗口可能正被 SW_HIDE 藏着，
    // 而那条证据在跨进程的 logs/codesys-native-session.json 里（不依赖启动清理的名单）。
    scheduleCodesysNativeRevive('startup', { force: true });
  }
  registerIpc();
  updateSplash('正在启动核心服务', 28, '准备任务与工具运行环境');
  let runtimeReady = false;
  try {
    await harnessRuntime.start();
    harness.append('harness.runtime.ready', harnessRuntime.status());
    updateSplash('核心服务已就绪', 68, '任务运行环境已连接');
    runtimeReady = harnessRuntime.status().state === 'ready';
  } catch (error) {
    harness.append('harness.runtime.error', { message: error.message });
    fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} DSH runtime ${error.stack || error}\n`, 'utf8');
    updateSplash('核心服务启动失败', 68, error.message, true);
  }
  if (!runtimeReady) {
    // Previously execution continued to createWindow() and the "正在加载工作区"
    // update overwrote the failed splash state, so the operator saw a "ready"
    // splash over a blank window. Stop here and report the real cause instead.
    throw new Error(`Harness/DSH 运行时未能就绪（state=${harnessRuntime.status().state}）：详见 resources/app/logs/errors.log`);
  }
  updateSplash('正在加载 TaskHive 工作区', 86, '准备中央工作区与插件导航');
  createWindow();
  // T152：清单扫描放到主窗口创建之后（见上面的说明：不要在 DSH 冷启动窗口期扫全树）。
  startDirectoryManifestSync();
  // T157：CODESYS 作业目录保留策略（只增不删的慢速泄漏）。
  pruneScriptEngineJobs();
  fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} main-window-created smoke=${smokeLaunch()} argv=${JSON.stringify(process.argv)}\n`, 'utf8');
  // T198（第①项）：应用启动即点火预打开。位置理由：`createWindow()` 已经返回（它不 await 渲染），
  // 启动路径到这里已经走完，剩下只有收尾；点火自己排到 setImmediate 之后，所以这一行在同步路径上
  // 只做一次函数调用 + 一次排程。**绝不 await**：它换来的时间属于用户下一次操作，不属于启动。
  preopenRememberedCodesysProjectOnStart('application-start');
  updateSplash('TaskHive 即将就绪', 100, '正在显示客户端');
  if (process.argv.includes('--probe-runtime-integrations')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let exitCode = 0;
      try {
        await probeRuntimeIntegrations();
      } catch (error) {
        fs.writeFileSync(path.join(root, 'logs', 'runtime-integrations-probe-error.json'), JSON.stringify({ ok: false, message: error?.message || String(error), stack: error?.stack || null, at: new Date().toISOString() }, null, 2), 'utf8');
        exitCode = 1;
      } finally {
        await shutdownApplication();
        app.exit(exitCode);
      }
    });
  }
  if (process.argv.includes('--smoke-cancel-generation')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let exitCode = 0;
      try {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await probeGenerationCancellation();
      } catch (error) {
        fs.writeFileSync(path.join(root, 'logs', 'generation-cancellation-electron-error.json'), JSON.stringify({ ok: false, message: error.message, stack: error.stack, at: new Date().toISOString() }, null, 2), 'utf8');
        exitCode = 1;
      } finally {
        await shutdownApplication();
        app.exit(exitCode);
      }
    });
  }
  if (process.argv.includes('--smoke-web-ai-chat')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const startedAt = Date.now();
      const prompt = 'TASKHIVE_WEB_AI_MOCK_PROMPT';
      let result = null;
      let error = null;
      try {
        result = await handleWebAiChat({ model: 'deepseek-web', prompt, timeoutMs: 30000, signal: new AbortController().signal });
      } catch (caught) {
        error = { code: caught?.code || null, message: caught?.message || String(caught) };
      }
      const item = [...webAiViews.values()].find((candidate) => candidate.providerId === 'deepseek');
      const page = item && !item.view.webContents.isDestroyed()
        ? await item.view.webContents.executeJavaScript(`(() => ({ received: window.__receivedPrompt === ${JSON.stringify(prompt)}, completed: window.__mockCompleted === true }))()`, true).catch(() => ({ received: false, completed: false }))
        : { received: false, completed: false };
      const ok = !error && result?.text === 'TASKHIVE_WEB_AI_MOCK_REPLY' && page.received && page.completed && pluginSurfaceKind === null && !pluginSurfaceAttached && !webAiAttached && webAiBridgeState.state === 'completed';
      const evidence = {
        ok,
        owner: 'Harness/DSH',
        agentLoop: 'single',
        browserBridge: webAiBridge?.status(),
        submitted: page.received,
        generationCompleted: page.completed,
        responseMatched: result?.text === 'TASKHIVE_WEB_AI_MOCK_REPLY',
        conversationRestored: pluginSurfaceKind === null && !pluginSurfaceAttached && !webAiAttached,
        state: webAiBridgeState,
        submitProbe: lastWebAiSubmitProbe,
        elapsedMs: Date.now() - startedAt,
        error,
        at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(root, 'logs', 'web-ai-chat-bridge-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
      app.exit(ok ? 0 : 1);
    });
  }
  if (process.argv.includes('--probe-settings-plugin-windows')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let exitCode = 0;
      try {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        await probeSettingsPluginWindowVisibility();
      } catch (error) {
        fs.writeFileSync(path.join(root, 'logs', 'settings-plugin-window-visibility-probe-error.json'), JSON.stringify({ ok: false, message: error.message, stack: error.stack, at: new Date().toISOString() }, null, 2), 'utf8');
        exitCode = 1;
      } finally {
        await shutdownApplication();
        app.exit(exitCode);
      }
    });
  }
  if (process.argv.includes('--smoke-ui')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let smokeStage = 'wait-workbench';
      let exitCode = 0;
      const markSmokeStage = (stage) => {
        smokeStage = stage;
        fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} smoke-ui-stage ${stage}\n`, 'utf8');
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        // The workbench session probe mutates real sessions, so the plugin keeps
        // it disabled unless this isolated smoke run explicitly arms it.
        await mainWindow.webContents.executeJavaScript('window.__TASKHIVE_QA_PROBES__ = true', true).catch(() => {});
        const armQaProbesInFrame = () => { const frame = currentHarnessFrame(); if (frame) void frame.executeJavaScript('window.__TASKHIVE_QA_PROBES__ = true', true).catch(() => {}); };
        armQaProbesInFrame();
        markSmokeStage('probe-harness-frames');
        await probeHarnessFrames();
        markSmokeStage('probe-sidebar-plugin-labels');
        await probeSidebarPluginLabels(currentHarnessFrame());
        markSmokeStage('probe-plugin-right-sidebar');
        await probePluginRightSidebar(currentHarnessFrame());
        markSmokeStage('exercise-taskhive-surface');
        await exerciseTaskHiveSurface();
        markSmokeStage('probe-codesys-workbench-render');
        await probeCodesysWorkbenchRender(currentHarnessFrame());
        markSmokeStage('probe-history-session-switch');
        await probeHistorySessionSwitch(currentHarnessFrame());
        markSmokeStage('probe-session-deletion');
        await probeSessionDeletion(currentHarnessFrame());
        markSmokeStage('exercise-repository-surfaces');
        await exerciseRepositorySurfaces();
        if (process.argv.includes('--smoke-web-login')) await probeWebLoginGate(currentHarnessFrame());
        markSmokeStage('probe-interactive-metadata');
        await probeInteractiveMetadata();
        if (process.argv.includes('--smoke-browser')) await probeBrowserSurface();
        if (process.argv.includes('--probe-dsh-tool-call') || process.argv.includes('--probe-dsh-codesys-scriptengine')) await probeDshToolCall();
        await new Promise((resolve) => setTimeout(resolve, 1400));
        markSmokeStage('probe-final-branding');
        const finalBranding = await probeTaskHiveBranding(currentHarnessFrame());
        if (!finalBranding.ok) throw new Error(`final-branding-probe-failed: ${JSON.stringify(finalBranding)}`);
        markSmokeStage('capture-chat');
        const first = await Promise.race([
          mainWindow.webContents.capturePage(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('main capture timeout')), 8000)),
        ]);
        fs.writeFileSync(path.join(root, 'logs', 'ui-chat.png'), first.toPNG());
        markSmokeStage('capture-codesys');
        const codesysSurface = await openSurfaceForProbe('codesys', '#scriptengine-status');
        await codesysSurface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const text = document.querySelector('#scriptengine-status')?.textContent || ''; if (text && !text.includes('正在检查')) return resolve(text); if (Date.now() >= deadline) return resolve(text); setTimeout(check, 100); }; check(); })", true);
        if (process.argv.includes('--smoke-codesys-native-host')) {
          markSmokeStage('probe-codesys-native-host');
          await probeCodesysNativeHost(codesysSurface);
        }
        let codesysScreenshotError = null;
        try {
          const second = await Promise.race([
            codesysSurface.capturePage(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('CODESYS capture timeout')), 8000)),
          ]);
          fs.writeFileSync(path.join(root, 'logs', 'ui-codesys.png'), second.toPNG());
        } catch (error) {
          codesysScreenshotError = error.message;
        }
        const uiOk = smokeRendererErrors.length === 0;
        fs.writeFileSync(path.join(root, 'logs', 'electron-smoke.json'), JSON.stringify({ ok: uiOk, rendererErrors: smokeRendererErrors, harness: harness.status(), mainUrl: mainWindow.webContents.getURL(), pluginSurface: { kind: pluginSurfaceKind, bounds: pluginSurfaceBounds }, windowCount: BrowserWindow.getAllWindows().length, splashAlive: Boolean(splashWindow && !splashWindow.isDestroyed()), mainAlwaysOnTop: mainWindow.isAlwaysOnTop(), at: new Date().toISOString() }, null, 2), 'utf8');
        markSmokeStage('complete');
        if (codesysScreenshotError) fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} codesys-screenshot-unavailable ${codesysScreenshotError}\n`, 'utf8');
        if (!uiOk) {
          // Do not delete the failure evidence, and do not exit 0: a renderer
          // error during a smoke run means the UI did not fully render.
          throw new Error(`renderer errors during smoke: ${smokeRendererErrors.length} (first: ${String(smokeRendererErrors[0].message).slice(0, 200)})`);
        }
        try { fs.rmSync(path.join(root, 'logs', 'smoke-ui-error.json'), { force: true }); } catch { /* evidence cleanup is best effort */ }
      } catch (error) {
        // `error.message` alone produced an evidence file with no message at all
        // whenever something rejected with a non-Error, which made the failure
        // undiagnosable. Always record a stringified form and the error's own
        // enumerable fields.
        let detail = '';
        try { detail = typeof error === 'string' ? error : JSON.stringify(error, Object.getOwnPropertyNames(Object(error))) } catch { detail = String(error) }
        fs.writeFileSync(path.join(root, 'logs', 'smoke-ui-error.json'), JSON.stringify({ ok: false, stage: smokeStage, message: error?.message ?? String(error), detail, stack: error?.stack || '', at: new Date().toISOString() }, null, 2), 'utf8');
        exitCode = 1;
      } finally {
        if (process.argv.includes('--smoke')) { await shutdownApplication(); app.exit(exitCode); }
      }
    });
  }
  if (process.argv.includes('--smoke-model')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const result = await mainWindow.webContents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 30000;
        const wait = (predicate) => new Promise((resolve) => { const check = () => { if (predicate()) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); });
        const apiReady = await wait(() => Boolean(window.taskhive?.listModels));
        if (!apiReady) return { visible: false, options: [], reason: 'model-api-timeout' };
        const modelCatalogOpenedAt = performance.now();
        const catalog = await window.taskhive.listModels();
        const firstCatalogOpenMs = Math.round(performance.now() - modelCatalogOpenedAt);
        let verifiedCatalog = catalog;
        const healthDeadline = Date.now() + 20000;
        while (Date.now() < healthDeadline && verifiedCatalog.providers?.some((provider) => provider.id === 'claude-code' && provider.state === 'checking')) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          verifiedCatalog = await window.taskhive.listModels();
        }
        const webLabels = ['DeepSeek（网页）','Kimi（网页）','豆包（网页）','腾讯元宝（网页）','通义千问（网页）','ChatGPT（网页）','Claude（网页）','Gemini（网页）'];
        // Local (non-web) model labels the picker can offer. The deepseek-chat and
        // deepseek-reasoner labels used to be listed here because the retired
        // deepseek-api provider contributed them; leaving them would make the
        // probe demand labels that no longer exist.
        const localLabels = ['qwen2.5-coder','deepseek-coder-v2'];
        const readNativeModels = async () => {
          for (let index = 0; index < 3; index += 1) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 80)); }
          const modelTrigger = [...document.querySelectorAll('button,[role="button"]')].find((node) => /选择模型/.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || '')));
          modelTrigger?.click();
          await new Promise((resolve) => setTimeout(resolve, 300));
          const modelRow = [...document.querySelectorAll('button,[role="menuitem"]')].find((node) => String(node.innerText || '').trim().split(/\\r?\\n/)[0] === '模型');
          modelRow?.click();
          await new Promise((resolve) => setTimeout(resolve, 500));
          const pickerText = String(document.body?.innerText || '');
          const nativeWebModels = webLabels.filter((label) => pickerText.includes(label));
          const nativeLocalModels = localLabels.filter((label) => pickerText.includes(label));
          const nativeGptModels = ['GPT-6 Astra', 'GPT-6 Sol', 'GPT-6 Luna', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5'].filter((label) => pickerText.includes(label));
          const nativeClaudeModels = ['Claude Fable', 'Claude Opus', 'Claude Sonnet', 'Claude Haiku'].filter((label) => pickerText.includes(label));
          for (let index = 0; index < 2; index += 1) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 100)); }
          return { modelTrigger: Boolean(modelTrigger), modelRow: Boolean(modelRow), pickerText, nativeWebModels, nativeLocalModels, nativeGptModels, nativeClaudeModels };
        };
        const initialNative = await readNativeModels();
        // Expected picker counts, derived from the catalog the app just reported.
        // The visibility map is user-editable, so the invariant is "the picker
        // shows exactly the visible models", not a fixed number.
        let expected = { gpt: 0, web: 0, local: 0, claude: 0 };
        try {
          const cat = await window.taskhive.listModels();
          const visibleCount = (pid) => { const entry = cat.providers.find((item) => item.id === pid); return ((entry && entry.models) || []).filter((m) => cat.visibility[pid + '::' + m] !== false).length; };
          expected = { gpt: visibleCount('codex-cli'), web: visibleCount('web-ai'), local: visibleCount('ollama-local'), claude: visibleCount('claude-code') };
        } catch { /* leave zeros; the comparison below then reports a mismatch */ }
        // A visibility change now schedules a batched Harness refresh (DSH builds
        // its model registry at plugin boot, so without it the composer never saw
        // the change — the reported bug). The picker therefore only reflects the
        // toggle after that refresh lands, so wait for it instead of asserting
        // immediately.
        const waitForCatalogRefresh = async (timeoutMs = 25000) => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            let state = null;
            try { state = (await window.taskhive.listModels())?.refreshState || null } catch { state = null }
            if (state && state.pending !== true) return state;
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          return { pending: true, timedOut: true };
        };
        let hiddenNative = { nativeWebModels: [] };
        let restoredNative = { nativeWebModels: [] };
        let refreshStates = [];
        try {
          await window.taskhive.setModelVisible({ providerId: 'web-ai', modelId: 'gemini-web', visible: false });
          refreshStates.push(await waitForCatalogRefresh());
          hiddenNative = await readNativeModels();
        } finally {
          await window.taskhive.setModelVisible({ providerId: 'web-ai', modelId: 'gemini-web', visible: true });
          refreshStates.push(await waitForCatalogRefresh());
          restoredNative = await readNativeModels();
        }
        const nativeVisibilityRoundTrip = !hiddenNative.nativeWebModels.includes('Gemini（网页）') && restoredNative.nativeWebModels.includes('Gemini（网页）');
        const probeProviderId = 'taskhive-probe-model';
        let customRoundTrip = false;
        try {
          await window.taskhive.addCustomModel({ providerId: probeProviderId, name: 'TaskHive Probe', modelId: 'probe-model', kind: 'local', visible: true });
          await window.taskhive.setModelVisible({ providerId: probeProviderId, modelId: 'probe-model', visible: false });
          const withProbe = await window.taskhive.listModels();
          customRoundTrip = withProbe.providers.some((provider) => provider.id === probeProviderId) && withProbe.visibility[probeProviderId + '::probe-model'] === false;
        } finally {
          await window.taskhive.removeCustomModel(probeProviderId).catch(() => {});
        }
        const trigger = [...document.querySelectorAll('button,[role="button"]')].find((node) => /^(设置|settings)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
        trigger?.click();
        const dialogReady = await wait(() => Boolean(document.querySelector('[role="dialog"],[aria-modal="true"]')));
        const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
        const modelNavs = [...(dialog?.querySelectorAll('nav button,nav [role="button"]') || [])].filter((node) => /^(模型|models?)$/i.test(String(node.innerText || '').trim()));
        for (const modelNav of modelNavs) { modelNav.click(); await new Promise((resolve) => setTimeout(resolve, 250)); if (document.querySelector('[data-taskhive-model-settings="true"]')) break; }
        const modelSettingsVisible = dialogReady && Boolean(document.querySelector('[data-taskhive-model-settings="true"]'));
        const settingsText = String(dialog?.innerText || '').slice(0, 2000);
        let localUiRoundTrip = false;
        let hiddenNativeLocalModels = [];
        let restoredNativeLocalModels = [];
        let hiddenNativeLocalProbe = null;
        let restoredNativeLocalProbe = null;
        await wait(() => Boolean(document.querySelector('input[aria-label="qwen2.5-coder 在输入框显示"]')));
        const localCheckbox = document.querySelector('input[aria-label="qwen2.5-coder 在输入框显示"]');
        if (localCheckbox?.checked === true) {
          localCheckbox.click();
          await wait(() => localCheckbox.checked === false);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const close = [...(dialog?.querySelectorAll('button') || [])].find((node) => /^(关闭设置|关闭|close settings|close)$/i.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim()));
          close?.click();
          await wait(() => !document.querySelector('[role="dialog"],[aria-modal="true"]'));
          await new Promise((resolve) => setTimeout(resolve, 250));
          hiddenNativeLocalProbe = await readNativeModels();
          hiddenNativeLocalModels = hiddenNativeLocalProbe.nativeLocalModels;
          const settingsTrigger = [...document.querySelectorAll('button,[role="button"]')].find((node) => /^(设置|settings)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
          settingsTrigger?.click();
          await wait(() => Boolean(document.querySelector('[role="dialog"],[aria-modal="true"]')));
          const restoredDialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
          const restoredNavs = [...(restoredDialog?.querySelectorAll('nav button,nav [role="button"]') || [])].filter((node) => /^(模型|models?)$/i.test(String(node.innerText || '').trim()));
          for (const modelNav of restoredNavs) { modelNav.click(); await new Promise((resolve) => setTimeout(resolve, 250)); if (document.querySelector('input[aria-label="qwen2.5-coder 在输入框显示"]')) break; }
          const restoredCheckbox = document.querySelector('input[aria-label="qwen2.5-coder 在输入框显示"]');
          restoredCheckbox?.click();
          await wait(() => restoredCheckbox?.checked === true);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const restoredClose = [...(restoredDialog?.querySelectorAll('button') || [])].find((node) => /^(关闭设置|关闭|close settings|close)$/i.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim()));
          restoredClose?.click();
          await wait(() => !document.querySelector('[role="dialog"],[aria-modal="true"]'));
          await new Promise((resolve) => setTimeout(resolve, 250));
          restoredNativeLocalProbe = await readNativeModels();
          restoredNativeLocalModels = restoredNativeLocalProbe.nativeLocalModels;
          localUiRoundTrip = !hiddenNativeLocalModels.includes('qwen2.5-coder') && restoredNativeLocalModels.includes('qwen2.5-coder');
        }
        const options = (verifiedCatalog.providers || []).flatMap((provider) => (provider.models || []).map((modelId) => ({ providerId: provider.id, modelId, state: provider.state })));
        // 用户的删除要求（2026-10）：ModLens 已删除，nonWebVision（要求每个非网页
        // provider 都"视觉已就绪"）不再可能成立。改成**反向**断言：除了明确声明不接管
        // 视觉的网页 provider 之外，没有任何 provider 再声称自己具备图片输入，也没有
        // 任何 provider 挂着 vision-via-modlens 这类已删除的能力标记。
        const visionChannelRemoved = (verifiedCatalog.providers || []).filter((provider) => !['web-ai', 'video-local'].includes(provider.id)).every((provider) => provider.vision?.state === 'unsupported' && !(provider.capabilities || []).some((capability) => /^vision[-.]/.test(String(capability))) && !(provider.inputModalities || []).includes('image'));
        const webVisionBoundary = verifiedCatalog.providers.find((provider) => provider.id === 'web-ai')?.vision?.state === 'unsupported';
        return { visible: modelSettingsVisible, options, defaultRoute: verifiedCatalog.defaultRoute, firstCatalogOpenMs, expected, settingsText, pickerText: initialNative.pickerText.slice(-5000), nativeModelPicker: initialNative.modelTrigger, nativeModelPane: initialNative.modelRow, nativeWebModels: initialNative.nativeWebModels, nativeLocalModels: initialNative.nativeLocalModels, nativeGptModels: initialNative.nativeGptModels, nativeClaudeModels: initialNative.nativeClaudeModels, hiddenNativeWebModels: hiddenNative.nativeWebModels, restoredNativeWebModels: restoredNative.nativeWebModels, hiddenNativeLocalModels, restoredNativeLocalModels, hiddenNativeLocalProbe, restoredNativeLocalProbe, nativeVisibilityRoundTrip, localUiRoundTrip, separateWebSelector: Boolean(document.querySelector('[data-taskhive-web-model="true"]')), customRoundTrip, visionChannelRemoved, webVisionBoundary, hasCodex6: options.some((item) => item.providerId === 'codex-cli' && item.modelId === 'gpt-6-astra'), hasCodex55: options.some((item) => item.providerId === 'codex-cli' && item.modelId === 'gpt-5.5'), hasClaudeReady: options.some((item) => item.providerId === 'claude-code' && item.modelId === 'sonnet' && item.state === 'ready'), hasWebAiReady: options.some((item) => item.providerId === 'web-ai' && item.modelId === 'claude-web' && item.state === 'ready') };
      })()`, true);
      // The Codex model count is NOT pinned: `visibility` is user-editable, so
      // the composer legitimately shows 2 models on a default install and 5 once
      // the user reveals the unverified gpt-5.6-* routes. Assert the route the
      // build guarantees (GPT-6 Astra + GPT-5.5 appear) and that the count
      // matches the catalog the app itself reports, so a refresh regression is
      // still caught.
      // Compare the native picker against the catalog the app itself reported:
      // the invariant is "the picker lists exactly the visible models". Any fixed
      // number would be wrong for some legitimate user configuration.
      const expected = result.expected || { gpt: 0, web: 0, local: 0 };
      const visibleClaudeCount = expected.claude;
      const visibleCodexCount = expected.gpt;
      const visibleWebCount = expected.web;
      const visibleLocalCount = expected.local;
      fs.writeFileSync(path.join(root, 'logs', 'model-smoke.json'), JSON.stringify({ ok: result.visible && result.firstCatalogOpenMs <= 1500 && result.nativeModelPicker === true && result.nativeModelPane === true && visibleWebCount >= 1 && result.nativeWebModels?.length === visibleWebCount && result.nativeLocalModels?.length === visibleLocalCount && result.nativeGptModels?.length >= 2 && result.nativeGptModels?.length === visibleCodexCount && result.nativeClaudeModels?.length === visibleClaudeCount && result.nativeVisibilityRoundTrip === true && result.localUiRoundTrip === true && result.separateWebSelector === false && result.customRoundTrip === true && result.visionChannelRemoved === true && result.webVisionBoundary === true && result.hasCodex6 === true && result.hasCodex55 === true && result.hasClaudeReady === true && result.hasWebAiReady === true, visibleCodexCount, visibleWebCount, visibleLocalCount, result, at: new Date().toISOString() }, null, 2), 'utf8');
      app.quit();
    });
  }
  if (process.argv.includes('--smoke-terminal')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const before = await visibleConsoleWindows();
      const firstCommand = process.platform === 'win32'
        ? "Write-Output ('TASKHIVE_PS_VERSION=' + $PSVersionTable.PSVersion.ToString()); Start-Sleep -Seconds 20"
        : "printf 'TASKHIVE_SHELL_READY\\n'; sleep 20";
      const first = await mainWindow.webContents.executeJavaScript(`(async () => { window.__TASKHIVE_TERMINAL_EVENTS__ = []; window.__TASKHIVE_TERMINAL_OFF_DATA__ = window.taskhive.onTerminalData((value) => window.__TASKHIVE_TERMINAL_EVENTS__.push({ type: 'data', ...value })); window.__TASKHIVE_TERMINAL_OFF_EXIT__ = window.taskhive.onTerminalExit((value) => window.__TASKHIVE_TERMINAL_EVENTS__.push({ type: 'exit', ...value })); const status = await window.taskhive.terminalStatus(); const started = await window.taskhive.startTerminal(${JSON.stringify(firstCommand)}); return { status, started }; })()`, true);
      const started = first.started;
      await new Promise((resolve) => setTimeout(resolve, 900));
      const during = await visibleConsoleWindows();
      const terminalProcess = process.platform === 'win32' ? await new Promise((resolve) => execFile(terminalShell.command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${Number(started.pid) || 0} -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{id=$_.Id;name=$_.ProcessName;handle=[int64]$_.MainWindowHandle;title=$_.MainWindowTitle} } | ConvertTo-Json -Compress`], { windowsHide: true, timeout: 10000 }, (_error, stdout) => { try { resolve(JSON.parse(String(stdout || 'null').trim() || 'null')); } catch { resolve(null); } })) : null;
      const result = await mainWindow.webContents.executeJavaScript(`(async () => { const stopped = await window.taskhive.stopTerminal(${JSON.stringify(started.taskId)}); await new Promise((resolve) => setTimeout(resolve, 400)); window.__TASKHIVE_TERMINAL_OFF_DATA__?.(); window.__TASKHIVE_TERMINAL_OFF_EXIT__?.(); return { started: ${JSON.stringify(started)}, stopped, events: window.__TASKHIVE_TERMINAL_EVENTS__ || [] }; })()`, true);
      const secondCommand = process.platform === 'win32'
        ? "Write-Output 'SECOND_OUT'; [Console]::Error.WriteLine('SECOND_ERR'); exit 7"
        : `node -e "process.stdout.write('SECOND_OUT');process.stderr.write('SECOND_ERR');process.exit(7)"`;
      const second = await mainWindow.webContents.executeJavaScript(`(async () => {
        const events = [];
        const offData = window.taskhive.onTerminalData((value) => events.push({ type: 'data', ...value }));
        const offExit = window.taskhive.onTerminalExit((value) => events.push({ type: 'exit', ...value }));
        const started = await window.taskhive.startTerminal(${JSON.stringify(secondCommand)});
        const deadline = Date.now() + 12000;
        while (!events.some((event) => event.type === 'exit' && event.taskId === started.taskId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 80));
        offData(); offExit();
        const third = await window.taskhive.runTerminal(${JSON.stringify(process.platform === 'win32' ? "Write-Output ('THIRD_TASK_PS_VERSION=' + $PSVersionTable.PSVersion.ToString())" : "printf 'THIRD_TASK_OK\\n'")});
        return { started, events, third };
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = await visibleConsoleWindows();
      const baseline = new Set(before.map((item) => item.id));
      const newVisible = [...during, ...after].filter((item) => !baseline.has(item.id));
      const secondStdout = second.events.filter((event) => event.type === 'data' && event.stream === 'stdout').map((event) => event.text).join('');
      const secondStderr = second.events.filter((event) => event.type === 'data' && event.stream === 'stderr').map((event) => event.text).join('');
      const secondExit = second.events.find((event) => event.type === 'exit' && event.taskId === second.started?.taskId);
      const firstOutput = result.events.filter((event) => event.type === 'data' && event.stream === 'stdout').map((event) => event.text).join('');
      const versionVerified = process.platform !== 'win32' || (first.status?.ready === true && first.status?.version === terminalShell.version && first.status?.sidebarShell === terminalShell.command && firstOutput.includes(`TASKHIVE_PS_VERSION=${terminalShell.version}`) && String(second.third?.stdout || '').includes(`THIRD_TASK_PS_VERSION=${terminalShell.version}`));
      const ok = result.started?.state === 'running' && result.stopped?.state === 'stopped' && result.events.some((event) => event.type === 'data') && second.started?.taskId !== result.started?.taskId && secondStdout.includes('SECOND_OUT') && secondStderr.includes('SECOND_ERR') && secondExit?.code === 7 && second.third?.ok === true && versionVerified && Number(terminalProcess?.handle || 0) === 0 && newVisible.length === 0 && terminalTasks.size === 0;
      const evidence = { ok, shell: first.status, versionVerified, result: { ...result, firstOutput }, second: { ...second, stdout: secondStdout, stderr: secondStderr, exit: secondExit }, terminalProcess, visibleWindows: { before, during, after, newVisible }, activeTasksAfterStop: terminalTasks.size, at: new Date().toISOString() };
      fs.writeFileSync(path.join(root, 'logs', 'terminal-lifecycle-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
      fs.writeFileSync(path.join(root, 'logs', 'terminal-window-visibility-probe.json'), JSON.stringify({ ok, terminalProcess, visibleWindows: evidence.visibleWindows, at: evidence.at }, null, 2), 'utf8');
      app.quit();
    });
  }
  if (process.argv.includes('--smoke-close-confirm')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      mainWindow.close();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const first = await mainWindow.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector('[data-taskhive-close-confirm]');
        const cancel = dialog?.querySelector('[data-close-action="cancel"]');
        const confirm = dialog?.querySelector('[data-close-action="confirm"]');
        const style = dialog ? getComputedStyle(dialog) : null;
        const backdrop = dialog?.parentElement ? getComputedStyle(dialog.parentElement) : null;
        const result = { visible: Boolean(dialog), role: dialog?.getAttribute('role'), ariaModal: dialog?.getAttribute('aria-modal'), focusedCancel: document.activeElement === cancel, background: style?.backgroundColor, border: style?.borderTopColor, radius: style?.borderRadius, backdrop: backdrop?.backgroundColor, confirmText: confirm?.textContent?.trim(), cancelText: cancel?.textContent?.trim() };
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return result;
      })()`, true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const cancelled = await mainWindow.webContents.executeJavaScript(`!document.querySelector('[data-taskhive-close-confirm]')`, true);
      mainWindow.close();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const second = await mainWindow.webContents.executeJavaScript(`(() => { const button = document.querySelector('[data-taskhive-close-confirm] [data-close-action="confirm"]'); const visible = Boolean(button); return { visible, confirmAvailable: Boolean(button), pluginViewSuspended: ${!pluginSurfaceAttached}, webAiViewSuspended: ${!webAiAttached} }; })()`, true);
      const evidence = { ok: first.visible && first.role === 'dialog' && first.ariaModal === 'true' && first.focusedCancel && cancelled && second.visible && second.confirmAvailable, first, cancelled, second, at: new Date().toISOString() };
      fs.writeFileSync(path.join(root, 'logs', 'close-confirm-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
      await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-taskhive-close-confirm] [data-close-action="confirm"]')?.click()`, true);
    });
  }
  if (process.argv.includes('--probe-native-settings')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
      await probeNativeSettings();
      app.quit();
    });
  }
  // T199（②）：设置页那个「启动时预打开 CODESYS 工程」开关的自测。它自己带两个变体：
  //   `--probe-codesys-preopen-setting`     完整自测，最后把开关留在**关**上；
  //   `--probe-codesys-preopen-setting-on`  只把开关点**开**（留给紧接着的普通启动去点火）。
  // 两个都在 `smokeLaunch()` 名单里，所以它们本身一格都不点火（那正是被验的性质之一）。
  if (process.argv.includes('--probe-codesys-preopen-setting') || process.argv.includes('--probe-codesys-preopen-setting-on')) {
    mainWindow.webContents.once('did-finish-load', async () => {
      let exitCode = 0;
      try {
        await runCodesysPreopenSettingProbe(process.argv.includes('--probe-codesys-preopen-setting-on'));
      } catch (error) {
        fs.writeFileSync(path.join(root, 'logs', 'codesys-preopen-setting-probe-error.json'), JSON.stringify({ ok: false, message: error?.message || String(error), details: error?.details || null, stack: error?.stack || null, at: new Date().toISOString() }, null, 2), 'utf8');
        exitCode = 1;
      } finally {
        try { await harnessRuntime?.stop() } catch { /* already stopped */ }
        app.exit(exitCode);
      }
    });
  }
  if (process.argv.includes('--smoke') && !process.argv.includes('--smoke-ui')) {
    // Assert what the release gate actually cares about: the Harness is ready,
    // the main window exists and the splash has retired. The splash is destroyed
    // on `ready-to-show`, which depends on the local Harness page load, so a
    // fixed deadline would report a false failure. Poll until settled instead.
    const settleDeadline = Date.now() + 30000;
    const settle = async () => {
      const runtime = harnessRuntime?.status() || { state: 'missing' };
      const mainAlive = Boolean(mainWindow && !mainWindow.isDestroyed());
      const splashAlive = Boolean(splashWindow && !splashWindow.isDestroyed());
      const workbench = mainAlive && !mainWindow.webContents.isLoadingMainFrame()
        ? await mainWindow.webContents.executeJavaScript(`(async () => {
          try {
            if (!window.__DSH_BOOT_READY__?.promise) return { ready: false, error: 'DSH boot promise missing' };
            const booted = await Promise.race([window.__DSH_BOOT_READY__.promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
            const composer = document.querySelector('[role="textbox"][contenteditable="true"]');
            const composerVisible = Boolean(composer && composer.getBoundingClientRect().width > 0 && composer.getBoundingClientRect().height > 0);
            const skin = Boolean(document.querySelector('#taskhive-harness-skin'));
            return { ready: booted && window.__TASKHIVE_SURFACES_REGISTERED__ === true && skin && composerVisible, composerVisible, skin };
          } catch (error) { return { ready: false, error: error.message }; }
        })()`, true).catch(error => ({ ready: false, error: error.message }))
        : { ready: false, error: 'workbench still loading' };
      // T159：把"本次启动里 DSH 的插件挂载失败"算作失败，并把它写进结果，
      // 这样 `ok:false` 自带原因（否则只能靠人去翻 harness-runtime.log）。
      const pluginLoadFailures = readSmokeHarnessFailures();
      const ok = runtime.state === 'ready' && mainAlive && !splashAlive && workbench.ready && smokeRendererErrors.length === 0 && pluginLoadFailures.length === 0;
      if (!ok && Date.now() < settleDeadline && smokeRendererErrors.length === 0 && pluginLoadFailures.length === 0) { setTimeout(settle, 250); return; }
      fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} smoke-autoclose ok=${ok} rendererErrors=${smokeRendererErrors.length} pluginLoadFailures=${pluginLoadFailures.length}\n`, 'utf8');
      fs.writeFileSync(path.join(root, 'logs', 'electron-smoke.json'), JSON.stringify({ ok, rendererErrors: smokeRendererErrors, pluginLoadFailures, runtime, harness: harness.status(), mainAlive, splashAlive, workbench, windows: BrowserWindow.getAllWindows().length, at: new Date().toISOString() }, null, 2), 'utf8');
      // Stop the Harness before exiting. `app.exit()` skips `before-quit`, so
      // without this the DSH child survived the smoke run and held the shared
      // profile, which then made the *next* launch fail to start its own
      // runtime. Verified by the orphaned bin.js process it left behind.
      try { await harnessRuntime?.stop(); } catch { /* already stopped */ }
      app.exit(ok ? 0 : 1);
    };
    setTimeout(() => { void settle(); }, 1800);
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(fatalStartupFailure);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Utility/GPU/plugin child processes are not renderers, so `render-process-gone`
// never fires for them, yet a dead GPU process is exactly how "the window went
// black / the panel never painted" shows up. Same collector, same log file.
app.on('child-process-gone', (_event, details) => {
  const type = String(details?.type || 'unknown');
  const payload = { type, reason: details?.reason, exitCode: details?.exitCode, serviceName: details?.serviceName };
  appendDiagnosticLog(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} app child-process-gone ${JSON.stringify(payload)}\n`);
  // A clean exit during shutdown is routine; anything else (crashed, oom, aborted,
  // launch-failed) is the shape a black window / never-painted panel takes.
  const cleanExit = !details?.reason || ['clean-exit', 'killed'].includes(String(details.reason));
  if (!cleanExit) {
    recordSmokeRendererError({ level: 'error', message: `child-process-gone ${JSON.stringify(payload)}`.slice(0, 2000), sourceId: 'renderer-lifecycle:child-process-gone', lineNumber: 0 }, `app:${type}`);
  }
});

app.on('before-quit', (event) => {
  quitting = true;
  // The exit cleanup closes launched CODESYS instances, so it must actually
  // finish: hold the quit once, then let it through.
  if (quitCleanupDone) return;
  event.preventDefault();
  void shutdownApplication()
    .catch(() => {})
    .finally(() => { quitCleanupDone = true; app.quit(); });
});

// A rejection during startup used to be swallowed by the uncaughtException
// handler below, which left the splash window on screen forever with no main
// window and no message. Surface it instead of silently hanging.
function reportFatal(kind, error) {
  const detail = error?.stack || String(error || 'unknown error');
  try { fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} FATAL ${kind} ${detail}\n`, 'utf8'); } catch { /* logging must not mask the original failure */ }
  try {
    const { dialog } = require('electron');
    if (!smokeLaunch()) dialog.showErrorBox('TaskHive 启动失败', `TaskHive 无法继续运行：\n\n${error?.message || error}\n\n详细信息已写入 resources/app/logs/errors.log`);
  } catch { /* the dialog is best effort */ }
  quitting = true;
  app.exit(1);
}

function fatalStartupFailure(error) {
  reportFatal('startup', error);
}

// T154：**断管错误绝不能关闭客户端**。
// 实测 `logs/errors.log` 里有两次 `FATAL uncaughtException Error: EPIPE: broken pipe, write`
// （2026-10-02T17:02:51 / 17:18:12）—— 用户反馈的"删除会话会导致客户端关闭"就是这个机制：
// 会话删除后某个写端（stdout / 子进程 / 日志通道）消失，下一次写抛 EPIPE，
// 而这里把它当"主进程状态未知"的致命错误直接 `app.exit(1)`。
// 断管是**环境问题**（父终端退出、管道读端关闭），与主进程状态无关，因此只记录、不退出。
const BENIGN_UNCAUGHT_CODES = /^(EPIPE|EPROTO|ECONNRESET|ECONNABORTED|ERR_STREAM_DESTROYED|ERR_STREAM_WRITE_AFTER_END)$/;
function isBenignStreamFailure(error) {
  const code = String(error?.code || '');
  if (BENIGN_UNCAUGHT_CODES.test(code)) return true;
  return /broken pipe|write after end|stream destroyed|premature close/i.test(String(error?.message || ''));
}

process.on('unhandledRejection', (reason) => {
  if (isBenignStreamFailure(reason)) {
    appendDiagnosticLog(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} ignored-rejection ${reason?.code || ''} ${reason?.message || reason}\n`);
    return;
  }
  reportFatal('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  if (isBenignStreamFailure(error)) {
    appendDiagnosticLog(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} ignored-uncaught ${error?.code || ''} ${error?.message || error}\n`);
    return;
  }
  // Continuing after an uncaught exception leaves the main process in an
  // unknown state (stale windows, orphaned Harness child, half-applied writes).
  reportFatal('uncaughtException', error);
});

// T154：stdout/stderr 的读端（启动它的终端/管道）消失后，任何写入都会抛 EPIPE。
// 先兜住流级错误，不要让它冒泡成 uncaughtException（上面对 EPIPE 也有兜底）。
for (const stream of [process.stdout, process.stderr]) {
  try { stream.on('error', () => { /* 断管时静默丢弃：没有可写的地方了 */ }); } catch { /* 极端环境下忽略 */ }
}
