const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { repairPortableLinks } = require('./portable-links');

// This must run before loading TaskHive modules that may reach pnpm-managed
// dependencies. It makes both source and packaged launches survive a folder
// copy or rename without relying on the previous absolute junction targets.
repairPortableLinks(path.resolve(__dirname, '..'));

const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell, clipboard, webContents } = require('electron');
const { HarnessCore } = require('../harness/core');
const { PluginManager } = require('../plugins/manager');
const { CodesysWindowMonitor } = require('./windows-monitor');
const { RepositoryManager } = require('../repositories/manager');
const { ModLensExecutor } = require('./modlens');
const { statusAsync: claudeCodeStatusAsync } = require('./claude-code');
const { HarnessRuntime } = require('./harness-runtime');
const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs');
const { CodesysInputController } = require('./codesys-input');
const { CodesysNativeHost } = require('./codesys-native-host');
const { ExpertConfigStore } = require('../experts/config-store');
const { WebAiBridge } = require('./web-ai-bridge');
const { DirectoryStore } = require('./directory-store');
const { generateDirectoryManifest, startDirectoryManifestWatcher } = require('./directory-manifest');
const { launchCodesysGui } = require('./codesys-launch');
const { CodesysWindowOwnership } = require('./codesys-window-ownership');
const { discoverCurrentCodesysProject } = require('./codesys-current-project');
const { CodesysLaunchedRegistry, classifyLaunchedInstance } = require('./codesys-launched-registry');
const { providerIdForModel, probePage, readAssistantState, stopGeneration, submitPrompt } = require('./web-ai-driver');
const { resolvePowerShell7, shellInvocation } = require('./terminal-shell');
const { buildCodesysPathAuthorization } = require('./codesys-path-authorization');
const {
  createOnlineAuthorizationStore,
  evaluateDownloadPreflight,
  evaluateAppActionPreflight,
  actionCapability,
} = require('./codesys-online-authorization');

app.setName('TaskHive');
if (process.platform === 'win32') app.setAppUserModelId('com.taskhive.desktop');

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
const modelCatalogPath = path.join(root, 'profiles', 'model-catalog.json');
const browserPreferencesPath = path.join(root, 'profiles', 'browser-preferences.json');
const modelCatalog = {
  version: 2,
  directory: path.join(root, 'models'),
  defaultRoute: { providerId: 'codex-cli', modelId: 'gpt-5.5' },
  browserRoute: { providerId: 'web-ai', modelId: 'deepseek-web' },
  visibility: {},
  providers: [
    { id: 'codex-cli', name: 'Codex CLI', kind: 'codex-cli', state: 'ready', authentication: 'codex-login', custom: false, models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'] },
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
    { id: 'claude-code', name: 'Claude Code', kind: 'cli', state: 'unconfigured', authentication: 'claude-login', custom: false, models: ['opus', 'sonnet', 'haiku'] },
    { id: 'web-ai', name: '网页 AI', kind: 'web', state: 'unconfigured', authentication: 'user-managed-browser-session', custom: false, models: ['deepseek-web', 'kimi-web', 'doubao-web', 'yuanbao-web', 'qwen-web', 'chatgpt-web', 'claude-web', 'gemini-web'] },
    { id: 'modlens-vision', name: 'ModLens 视觉', kind: 'vision', state: 'unconfigured', models: ['codex-vision-bridge'] },
    { id: 'video-local', name: '本地视频模型', kind: 'video', state: 'unconfigured', models: ['video-generation-local'] },
  ],
};
// `ensureLayout()` runs at module load, which is before the process-level error
// handlers are registered. A throw there killed the process with no window, no
// dialog and no log — for example when the install directory is read-only.
function reportBootstrapProblem(detail) {
  const line = `${new Date().toISOString()} bootstrap ${detail}\n`;
  try { fs.appendFileSync(path.join(root, 'logs', 'errors.log'), line, 'utf8'); } catch {
    try { process.stderr.write(line); } catch { /* nowhere left to report */ }
  }
}

const ensureLayout = () => {
  try {
    for (const relative of ['app', 'harness', 'plugins/installed', 'plugins/staging', 'plugins/backups', 'knowledge/repositories', 'knowledge/staging', 'knowledge/backups', 'knowledge/index', 'knowledge/reviews', 'experts/installed', 'experts/staging', 'experts/backups', 'models', 'video-models', 'workspaces', 'workspaces/harness-default', 'profiles', 'profiles/dsh', 'profiles/dsh/profiles/web', 'cache', 'logs']) fs.mkdirSync(path.join(root, relative), { recursive: true });
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
  const RETIRED_CATALOG_PROVIDER_IDS = new Set(['deepseek-api'])
  try {
    const saved = JSON.parse(fs.readFileSync(modelCatalogPath, 'utf8'));
    if (saved?.defaultRoute && Array.isArray(saved.providers)) {
      Object.assign(modelCatalog, { ...saved, providers: saved.providers.filter((provider) => !RETIRED_CATALOG_PROVIDER_IDS.has(provider?.id)) });
    }
  } catch { /* first run */ }
  for (const provider of [
    { id: 'claude-code', name: 'Claude Code', kind: 'cli', state: 'unconfigured', models: ['opus', 'sonnet', 'haiku'] },
    { id: 'anthropic-api', name: 'Anthropic API', kind: 'api', state: 'unconfigured', authentication: 'api-key', protocol: 'anthropic', endpoint: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
    { id: 'web-ai', name: '网页 AI', kind: 'web', state: 'unconfigured', models: ['deepseek-web', 'kimi-web', 'doubao-web', 'yuanbao-web', 'qwen-web', 'chatgpt-web', 'claude-web', 'gemini-web'] },
    { id: 'modlens-vision', name: 'ModLens 视觉', kind: 'vision', state: 'unconfigured', models: ['codex-vision-bridge'] },
    { id: 'video-local', name: '本地视频模型', kind: 'video', state: 'unconfigured', models: ['video-generation-local'] },
  ]) if (!modelCatalog.providers.some((item) => item.id === provider.id)) modelCatalog.providers.push(provider);
  const claude = modelCatalog.providers.find((item) => item.id === 'claude-code');
  if (claude) claude.models = ['opus', 'sonnet', 'haiku'];
  const webAi = modelCatalog.providers.find((item) => item.id === 'web-ai');
  if (webAi) webAi.models = ['deepseek-web', 'kimi-web', 'doubao-web', 'yuanbao-web', 'qwen-web', 'chatgpt-web', 'claude-web', 'gemini-web'];
  const codex = modelCatalog.providers.find((item) => item.id === 'codex-cli');
  if (codex) { codex.state = 'ready'; codex.models = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']; }
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
    fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
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
let modlens;
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
let expertConfig;
let directoryStore;
let harnessRuntime;
let webAiBridge;
let splashWindow;
const codesysFixtureWindows = [];
let pluginSurfaceView;
// Keep one embedded renderer alive for the lifetime of the desktop window.
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
let codesysInputArm = { armed: false, windowId: '' };
let codesysNativeMoveTimer = null;
let quitting = false;
let quitCleanupDone = false;
let closePromptInFlight = false;
const HARNESS_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+(\/|$)/;

// Both the desktop shell (`pluginSurfaceView`, which loads app/renderer) and
// the embedded Harness document (`mainWindow`) carry `preload.js`. Every
// privileged IPC handler must confirm the sender is one of those two frame
// trees; otherwise any page that ends up in a preload-bearing context keeps
// the `window.taskhive` bridge and can drive the terminal, the CODESYS native
// input path or the workspace services.
function isTrustedSender(event, { allowHarness = true, allowShell = true } = {}) {
  const sender = event?.sender;
  if (!sender) return false;
  if (allowShell && pluginSurfaceView && !pluginSurfaceView.webContents.isDestroyed() && sender === pluginSurfaceView.webContents) return true;
  if (allowHarness && mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents) return true;
  return false;
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

// Reject anything that is not the TaskHive shell / local Harness runtime. Called
// from `will-navigate` and `setWindowOpenHandler` so a preload-bearing window can
// never hand its bridge to a remote origin.
function isAllowedWorkbenchNavigation(targetUrl) {
  const value = String(targetUrl || '');
  if (!value) return false;
  if (value.startsWith('file://')) return true;
  if (value.startsWith('devtools://')) return true;
  if (value.startsWith('about:')) return true;
  return HARNESS_ORIGIN.test(value);
}

function guardWorkbenchNavigation(contents, label) {
  if (!contents) return;
  contents.on('will-navigate', (event, url) => {
    if (isAllowedWorkbenchNavigation(url)) return;
    event.preventDefault();
    fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} blocked-navigation ${label} ${url}\n`, 'utf8');
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWorkbenchNavigation(url)) return { action: 'allow' };
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

const smokeLaunch = () => process.argv.some((arg) => ['--smoke', '--smoke-isolated', '--smoke-ui', '--smoke-splash', '--smoke-browser', '--smoke-web-login', '--smoke-web-ai-chat', '--smoke-model', '--smoke-terminal', '--smoke-codesys-stream', '--smoke-codesys-native-host', '--smoke-cancel-generation', '--probe-runtime-integrations', '--probe-settings-plugin-windows', '--probe-dsh-tool-call', '--probe-dsh-expert-run', '--probe-dsh-codesys-scriptengine'].includes(arg));

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

async function probeSplash() {
  if (!splashWindow || splashWindow.isDestroyed()) throw new Error('splash-window-unavailable');
  if (splashWindow.webContents.isLoading()) await new Promise((resolve) => splashWindow.webContents.once('did-finish-load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await splashWindow.webContents.executeJavaScript(`(() => {
    const image = document.querySelector('.brand img');
    const bodyStyle = getComputedStyle(document.body);
    const fullSizeLayers = [...document.body.children].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
    }).length;
    return {
      title: document.title,
      background: bodyStyle.backgroundColor,
      iconLoaded: Boolean(image?.complete && image.naturalWidth > 0),
      iconWidth: image?.naturalWidth || 0,
      iconEmbedded: Boolean(image?.src.startsWith('data:image/png;base64,')),
      fullSizeLayers,
      bodyChildren: document.body.children.length,
    };
  })()`, true);
  let screenshotError = null;
  try {
    const screenshot = await splashWindow.capturePage();
    fs.writeFileSync(path.join(root, 'logs', 'ui-splash.png'), screenshot.toPNG());
  } catch (error) {
    screenshotError = error.message;
  }
  const evidence = {
    ok: state.title === 'TaskHive' && state.background === 'rgb(255, 255, 255)' && state.iconLoaded && state.iconEmbedded && state.fullSizeLayers === 0,
    ...state,
    bounds: splashWindow.getBounds(),
    windowCount: BrowserWindow.getAllWindows().length,
    screenshotError,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'splash-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error('splash-probe-failed');
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
  try {
    const parsed = JSON.parse(fs.readFileSync(apiCredentialPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeApiCredentials(value) {
  try {
    fs.mkdirSync(path.dirname(apiCredentialPath), { recursive: true });
    fs.writeFileSync(apiCredentialPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return true;
  } catch (error) {
    reportBootstrapProblem(`api-credentials not persisted: ${error.message}`);
    return false;
  }
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

function modelHealthSnapshot() {
  if (modelHealthCache && modelHealthCache.expiresAt > Date.now()) return modelHealthCache.value;
  if (!modelHealthPromise) {
    modelHealthPromise = (async () => {
      let claude = { id: 'claude-code', installed: null, authenticated: false, state: 'checking', version: null, command: null };
      let vision = { ready: false, readyProviders: [] };
      const [claudeResult, visionResult] = await Promise.allSettled([
        claudeCodeStatusAsync(),
        pluginEnabled('modlens') ? modlens.doctor() : Promise.resolve(vision),
      ]);
      if (claudeResult.status === 'fulfilled') claude = claudeResult.value;
      if (visionResult.status === 'fulfilled') vision = visionResult.value;
      modelHealthCache = { value: { claude, vision }, expiresAt: Date.now() + 60000 };
    })().catch(() => {}).finally(() => { modelHealthPromise = null; });
  }
  return { claude: { id: 'claude-code', installed: null, authenticated: false, state: 'checking', version: null, command: null }, vision: { ready: false, readyProviders: [] } };
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
  try {
    const saved = JSON.parse(fs.readFileSync(browserPreferencesPath, 'utf8'));
    return { homepage: normalizeWebAiUrl(saved.homepage || defaults.homepage), bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks : defaults.bookmarks };
  } catch { return defaults; }
}

function writeBrowserPreferences(value) {
  fs.writeFileSync(browserPreferencesPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
    if (pluginSurfaceKind === 'web-ai') hidePluginSurface();
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
    if (pluginSurfaceKind === 'web-ai') hidePluginSurface();
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

function hidePluginSurface() {
  if (pluginSurfaceKind === 'codesys') {
    void codesysNativeHost?.suspend('surface-hidden').catch((error) => fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} codesys-native-suspend ${error.message}\n`, 'utf8'));
  }
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
    monitor?.stopAll();
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

async function showPluginSurface(kind) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const descriptor = surfaceDescriptors().find((item) => item.id === kind);
  if (!descriptor) return hidePluginSurface();
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
    pluginSurfaceView.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) fs.appendFileSync(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} surface level=${level} ${sourceId}:${line} ${message}\n`, 'utf8');
    });
  }
  if (!pluginSurfaceAttached) {
    mainWindow.contentView.addChildView(pluginSurfaceView);
    pluginSurfaceAttached = true;
  }
  if (pluginSurfaceBounds) pluginSurfaceView.setBounds(pluginSurfaceBounds);
  if (kind === 'codesys' && codesysNativeHost?.status().attached && codesysNativeHost.status().suspended) {
    const bounds = codesysNativeScreenBounds();
    if (bounds) await codesysNativeHost.resume(bounds);
  }
  if (pluginSurfaceKind === kind) {
    if (!pluginSurfaceView.webContents.isLoading() && kind === 'web-ai' && activeWebAiViewId) activateWebAiWindow(activeWebAiViewId);
    return;
  }
  pluginSurfaceKind = kind;
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
  return {
    x: Math.round(content.x + pluginSurfaceBounds.x + Number(localBounds.x || 0)),
    y: Math.round(content.y + pluginSurfaceBounds.y + Number(localBounds.y || 0)),
    width: Math.round(Number(localBounds.width || 0)),
    height: Math.round(Number(localBounds.height || 0)),
  };
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
  try { previousLinks = JSON.parse(fs.readFileSync(linksPath, 'utf8')).links || []; } catch { /* first run */ }
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
  fs.writeFileSync(linksPath, `${JSON.stringify({ version: 1, links: [...activeNames].sort() }, null, 2)}\n`, 'utf8');
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
  fs.writeFileSync(patchPath, patch, 'utf8');
  return patchPath;
}

async function restartHarnessForPluginChange(result) {
  const runtime = await restartHarnessRuntime('plugin-change');
  return { ...result, runtime };
}

function registerIpc() {
  ipcMain.handle('harness:status', () => ({ ...harness.status(), runtime: harnessRuntime?.status() || null, state: harnessRuntime?.status().state === 'ready' ? 'ready' : 'degraded' }));
  ipcMain.handle('harness:url', () => {
    return harnessWorkbenchUrl();
  });
  ipcMain.on('surface:open', (event, kind) => {
    if (event.sender !== mainWindow?.webContents) return;
    const value = String(kind || '');
    publishPluginSurfaceState(value || 'chat');
    if (!value || value === 'chat' || value === 'settings') hidePluginSurface();
    else void showPluginSurface(value).catch((error) => fs.appendFileSync(path.join(root, 'logs', 'errors.log'), `${new Date().toISOString()} surface-open ${value} ${error.stack || error}\n`, 'utf8'));
  });
  ipcMain.on('surface:geometry', (event, input) => {
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
  ipcMain.on('app:close-confirmation-result', async (event, confirmed) => {
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
  ipcMain.handle('models:list', async () => {
    const catalog = structuredClone(modelCatalog);
    // Health probes invoke local CLIs and drivers. Start them in the
    // background so opening the picker only reads the in-memory catalog.
    const health = modelHealthSnapshot();
    const codex = catalog.providers.find((item) => item.id === 'codex-cli');
    if (codex && !pluginEnabled('taskhive-codex-model')) codex.state = 'disabled';
    const claude = catalog.providers.find((item) => item.id === 'claude-code');
    if (claude) Object.assign(claude, health.claude);
    const vision = health.vision;
    const visionProvider = catalog.providers.find((item) => item.id === 'modlens-vision');
    if (visionProvider) Object.assign(visionProvider, { state: vision.ready ? 'ready' : 'unconfigured', readyProviders: vision.readyProviders || [], version: vision.version || null });
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
    for (const provider of catalog.providers.filter((item) => !['modlens-vision', 'video-local', 'web-ai'].includes(item.id))) {
      provider.capabilities = [...new Set([...(provider.capabilities || []), 'text', ...(vision.ready ? ['vision-via-modlens'] : [])])];
      provider.vision = { state: vision.ready ? 'ready' : 'unconfigured', route: vision.ready ? 'modlens' : null, providers: vision.readyProviders || [] };
      provider.inputModalities = vision.ready ? ['text', 'image'] : ['text'];
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
  ipcMain.handle('models:select', async (_event, input) => {
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
      fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
      harness.append('model.browser-route.changed', { providerId: provider.id, modelId, navigation: 'deferred-until-login-action' });
      return { catalog: structuredClone(modelCatalog), runtime: harnessRuntime.status(), requiresBrowserLogin: true };
    }
    modelCatalog.defaultRoute = { providerId: provider.id, modelId };
    fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
    const runtime = await restartHarnessRuntime('model-route');
    harness.append('model.route.changed', { providerId: provider.id, modelId, runtime: runtime.slotRoot });
    return { catalog: structuredClone(modelCatalog), runtime };
  });
  ipcMain.handle('models:set-visible', (_event, input) => harness.runTool('models.set-visible', { providerId: input?.providerId, modelId: input?.modelId }, () => {
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
    fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
    // The plugin watches this file, so writing it is the whole refresh: it
    // republishes the registry event and every loaded client re-reads the
    // catalog in place. Ticks are still batched so a burst of clicks settles
    // into one reported refresh instead of one per click.
    scheduleModelCatalogRefresh();
    return { providerId: provider.id, modelId, visible: input?.visible === true, refreshPending: true, lastRefresh: modelCatalogRefreshState };
  }));
  ipcMain.handle('models:add-custom', (_event, input) => harness.runTool('models.add-custom', { providerId: input?.providerId, modelId: input?.modelId }, () => {
    const providerId = String(input?.providerId || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    const modelId = String(input?.modelId || '').trim();
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
    fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
    // The plugin registers a route for a newly declared api/local provider on its
    // own when the write lands, so no restart and no reload is needed here.
    scheduleModelCatalogRefresh();
    return { providerId, modelId, state: entry.state, endpoint: endpoint || null, apiKeyEnv: entry.apiKeyEnv || null, refreshPending: true };
  }));
  // Set or clear the credential/endpoint of an existing provider (used for the
  // built-in DeepSeek API entry as well as custom endpoints).
  ipcMain.handle('models:set-credential', async (_event, input) => harness.runTool('models.set-credential', { providerId: input?.providerId }, async () => {
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
    fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
    // The Harness child only sees credentials through its environment, so it has
    // to be re-launched for a new key to take effect.
    const runtime = await restartHarnessRuntime('model-credential');
    harness.append('model.credential.updated', { providerId: provider.id, hasApiKey: Boolean(creds[provider.id]?.apiKey), endpoint: provider.endpoint || null, state: provider.state });
    return { providerId: provider.id, state: provider.state, hasApiKey: Boolean(creds[provider.id]?.apiKey), apiKeyMasked: maskApiKey(creds[provider.id]?.apiKey), endpoint: provider.endpoint || null, runtime };
  }));
  ipcMain.handle('models:remove-custom', (_event, providerId) => harness.runTool('models.remove-custom', { providerId }, () => {
    const index = modelCatalog.providers.findIndex((item) => item.id === String(providerId || '') && item.custom === true);
    if (index < 0) throw new Error('只能删除自定义模型提供方');
    const [removed] = modelCatalog.providers.splice(index, 1);
    for (const modelId of removed.models || []) delete modelCatalog.visibility[`${removed.id}::${modelId}`];
    const creds = readApiCredentials();
    if (creds[removed.id]) { delete creds[removed.id]; writeApiCredentials(creds); }
    fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`, 'utf8');
    scheduleModelCatalogRefresh();
    return { providerId: removed.id, removed: true, refreshPending: true };
  }));
  ipcMain.handle('settings:directories', () => directoryStore.read());
  ipcMain.handle('settings:directory-save', (_event, input) => harness.runTool('settings.directory-save', { id: input?.id, previousId: input?.previousId }, () => directoryStore.upsert(input || {})));
  ipcMain.handle('settings:directory-remove', (_event, id) => harness.runTool('settings.directory-remove', { id }, () => directoryStore.remove(id)));
  ipcMain.handle('settings:directory-restore', () => harness.runTool('settings.directory-restore', {}, () => directoryStore.restore()));
  ipcMain.on('settings:visibility', (event, visible) => {
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
  ipcMain.handle('plugins:list', () => harness.runTool('plugins.list', {}, () => pluginManager.list()));
  ipcMain.handle('plugins:placement', (_event, input) => harness.runTool('plugins.placement', { id: input?.id, placement: input?.placement }, async () => {
    const result = pluginManager.setPlacement(input?.id, input?.placement);
    writeDshPatch();
    return { plugin: result, descriptors: surfaceDescriptors() };
  }));
  ipcMain.handle('plugins:order', (_event, input) => harness.runTool('plugins.order', { id: input?.id, order: input?.order }, async () => {
    const result = pluginManager.setOrder(input?.id, input?.order);
    writeDshPatch();
    return { plugin: result, descriptors: surfaceDescriptors() };
  }));
  ipcMain.handle('plugins:install', (_event, input) => harness.runTool('plugins.install', { source: input?.source }, async () => restartHarnessForPluginChange(await pluginManager.install(input || {}))));
  ipcMain.handle('plugins:uninstall', (_event, id) => harness.runTool('plugins.uninstall', { id }, async () => restartHarnessForPluginChange(pluginManager.uninstall(id))));
  ipcMain.handle('plugins:enable', (_event, id) => harness.runTool('plugins.enable', { id }, async () => restartHarnessForPluginChange(pluginManager.enable(id))));
  ipcMain.handle('plugins:disable', (_event, id) => harness.runTool('plugins.disable', { id }, async () => restartHarnessForPluginChange(pluginManager.disable(id))));
  ipcMain.handle('plugins:restore', (_event, id) => harness.runTool('plugins.restore', { id }, async () => restartHarnessForPluginChange(pluginManager.restore(id))));
  ipcMain.handle('repositories:list', (_event, kind) => harness.runTool(`${kind}.list`, { kind }, () => repositories[kind].list()));
  ipcMain.handle('repositories:search', (_event, input) => harness.runTool(`${input?.kind}.search`, { kind: input?.kind, query: input?.query }, () => repositories[input.kind].search(input?.query)));
  ipcMain.handle('repositories:audit', (_event, kind) => harness.runTool(`${kind}.audit`, { kind }, () => repositories[kind].audit()));
  ipcMain.handle('repositories:install', (_event, input) => harness.runTool(`${input?.kind}.install`, { kind: input?.kind, source: input?.source }, () => repositories[input.kind].install(input.source)));
  ipcMain.handle('repositories:uninstall', (_event, input) => harness.runTool(`${input?.kind}.uninstall`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].uninstall(input.id)));
  ipcMain.handle('repositories:enable', (_event, input) => harness.runTool(`${input?.kind}.enable`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].enable(input.id)));
  ipcMain.handle('repositories:disable', (_event, input) => harness.runTool(`${input?.kind}.disable`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].disable(input.id)));
  ipcMain.handle('repositories:restore', (_event, input) => harness.runTool(`${input?.kind}.restore`, { kind: input?.kind, id: input?.id }, () => repositories[input.kind].restore(input.id)));
  ipcMain.handle('knowledge:cards', (_event, query) => harness.runTool('knowledge.cards', { query }, () => repositories.knowledge.listCards(query)));
  ipcMain.handle('knowledge:create-card', (_event, input) => harness.runTool('knowledge.card.create', { title: input?.title }, () => repositories.knowledge.createCard(input || {})));
  ipcMain.handle('knowledge:capture-conversation', (_event, input) => harness.runTool('knowledge.card.capture-conversation', { title: input?.title, sourceSessionId: input?.sourceSessionId, sourceTaskId: input?.sourceTaskId }, () => repositories.knowledge.createCard({ ...(input || {}), source: input?.source || 'conversation-task-area', type: input?.type || 'conversation' })));
  ipcMain.handle('knowledge:review-card', (_event, input) => harness.runTool('knowledge.card.review', { id: input?.id, decision: input?.decision }, () => repositories.knowledge.reviewCard(input?.id, input?.decision)));
  ipcMain.handle('knowledge:sync-status', () => harness.runTool('knowledge.sync.status', {}, () => repositories.knowledge.syncStatus()));
  ipcMain.handle('knowledge:sync', (_event, input) => harness.runTool('knowledge.sync', { mode: input?.mode, remotePath: input?.remotePath }, () => repositories.knowledge.sync(input || {})));
  // One expert switch, several views (the composer control and the plugin
  // surface). Every mutation is pushed so a view that is already mounted cannot
  // keep showing a stale state — that staleness is what looked like the two
  // controls "conflicting".
  const publishExpertStatus = (status) => {
    for (const contents of webContents.getAllWebContents()) {
      try { contents.send('experts:changed', status); } catch { /* window already gone */ }
    }
    return status;
  };
  ipcMain.handle('experts:status', () => harness.runTool('experts.status', {}, () => expertConfig.status()));
  ipcMain.handle('experts:set-enabled', (_event, input) => harness.runTool('experts.set-enabled', { enabled: input?.enabled }, () => publishExpertStatus(expertConfig.setEnabled(input?.enabled))));
  ipcMain.handle('experts:set-selection', (_event, input) => harness.runTool('experts.set-selection', { teamId: input?.teamId, expertId: input?.expertId }, () => publishExpertStatus(expertConfig.setSelection(input || {}))));
  ipcMain.handle('experts:create', (_event, input) => harness.runTool('experts.create', { name: input?.name }, () => publishExpertStatus(expertConfig.createExpert(input || {}))));
  ipcMain.handle('experts:update', (_event, input) => harness.runTool('experts.update', { id: input?.id }, () => publishExpertStatus(expertConfig.updateExpert(input || {}))));
  ipcMain.handle('experts:remove', (_event, id) => harness.runTool('experts.remove', { id }, () => publishExpertStatus(expertConfig.removeExpert(id))));
  ipcMain.handle('web-ai:open', (_event, input) => harness.runTool('web-ai.open', { providerId: typeof input === 'string' ? input : input?.providerId, newWindow: input?.newWindow === true }, () => openWebAiWindow(input)));
  ipcMain.handle('web-ai:auth-status', async (_event, modelId) => {
    const providerId = { 'deepseek-web': 'deepseek', 'kimi-web': 'kimi', 'doubao-web': 'doubao', 'yuanbao-web': 'yuanbao', 'qwen-web': 'qwen', 'chatgpt-web': 'chatgpt', 'claude-web': 'claude', 'gemini-web': 'gemini' }[String(modelId || '')] || 'deepseek';
    const provider = WEB_AI_PROVIDERS[providerId];
    const item = [...webAiViews.values()].find((entry) => entry.providerId === providerId);
    const cookies = item ? await item.view.webContents.session.cookies.get({ url: provider.url }).catch(() => []) : [];
    return { providerId, modelId, authenticated: cookies.length > 0, authentication: 'user-managed-browser-session', loginUrl: provider.url };
  });
  ipcMain.handle('browser:preferences', () => readBrowserPreferences());
  ipcMain.handle('browser:set-homepage', (_event, homepage) => {
    const value = readBrowserPreferences();
    value.homepage = normalizeWebAiUrl(homepage);
    return writeBrowserPreferences(value);
  });
  ipcMain.handle('browser:add-bookmark', (_event, input) => {
    const value = readBrowserPreferences();
    const url = normalizeWebAiUrl(input?.url);
    const existing = value.bookmarks.find((item) => item.url === url);
    if (existing) return value;
    value.bookmarks.push({ id: `bookmark-${Date.now()}`, title: String(input?.title || new URL(url).hostname).trim().slice(0, 120), url, builtin: false });
    return writeBrowserPreferences(value);
  });
  ipcMain.handle('browser:remove-bookmark', (_event, id) => {
    const value = readBrowserPreferences();
    value.bookmarks = value.bookmarks.filter((item) => item.id !== String(id || '') || item.builtin === true);
    return writeBrowserPreferences(value);
  });
  ipcMain.handle('web-ai:list', () => webAiWindowState());
  ipcMain.handle('web-ai:switch', (_event, id) => {
    const item = activateWebAiWindow(id);
    const state = webAiWindowState();
    return { ...state, providerId: item.providerId, providerName: WEB_AI_PROVIDERS[item.providerId]?.name || item.providerId };
  });
  ipcMain.handle('web-ai:navigate', async (_event, input) => {
    const item = webAiViews.get(String(input?.id || activeWebAiViewId || ''));
    if (!item) throw new Error('网页标签不存在');
    const navigationState = await navigateWebAi(item, input?.url);
    return { ...webAiWindowState(), navigationState };
  });
  ipcMain.handle('web-ai:command', (_event, input) => {
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
  ipcMain.handle('web-ai:close', (_event, id) => {
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
  ipcMain.handle('codesys:list-windows', () => harness.runTool('codesys.list-windows', {}, () => { requirePluginEnabled('codesys-monitor'); return monitor.listWindows(); }));
  ipcMain.handle('codesys:current-project', (_event, input) => harness.runTool('codesys.current-project', { preferredWindowId: codesysPreferredWindowId }, async () => {
    requirePluginEnabled('codesys-monitor');
    const force = input?.force === true;
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
      let result = smokeProject ? { found: true, sourcePath: smokeProject, projectName: path.basename(smokeProject), windowId: codesysPreferredWindowId, pid: 0, title: `${path.basename(smokeProject)} - CODESYS TaskHive Fixture`, readOnly: false, activeGui: true, detection: 'isolated-smoke-project', writeAvailable: false, writeBlockReason: '隔离验收工程只用于读取验证' } : discoverCurrentCodesysProject(await monitor.listWindows(), codesysPreferredWindowId, { ownedPids: codesysWindowOwnership.snapshot().launchedPids });
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
    try { return await probe } finally { if (codesysCurrentProjectInFlight === probe) codesysCurrentProjectInFlight = null }
  }));
  ipcMain.handle('codesys:open-program', () => harness.runTool('codesys.open-program', {}, async () => {
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
  ipcMain.handle('codesys:fit-window', (_event, input) => harness.runTool('codesys.fit-window', { id: input?.id, canvasWidth: input?.canvasWidth, canvasHeight: input?.canvasHeight }, async () => {
    requirePluginEnabled('codesys-monitor');
    const result = await monitor.fitWindowToCanvas(input?.id, input || {});
    harness.append('codesys.window.fitted-to-plugin-canvas', result);
    return result;
  }));
  ipcMain.handle('codesys:capture', (_event, id) => harness.runTool('codesys.capture', { id }, () => { requirePluginEnabled('codesys-monitor'); return monitor.capture(id); }));
  ipcMain.handle('codesys:stream-source', (_event, input) => harness.runTool('codesys.stream-source', { id: input?.id }, async () => {
    requirePluginEnabled('codesys-monitor');
    codesysInput.ensureWorker();
    const source = await monitor.resolveDesktopSource(input?.id);
    harness.append('codesys.stream.source-resolved', { windowId: source.windowId, width: source.width, height: source.height, transport: 'renderer-media-stream' });
    return source;
  }));
  ipcMain.handle('codesys:stream-start', (_event, input) => harness.runTool('codesys.stream-start', { id: input?.id }, () => { requirePluginEnabled('codesys-monitor'); codesysInput.ensureWorker(); return monitor.startStream(input?.id, input || {}, (frame) => { harness.append('codesys.stream.frame', { stream: frame.stream }); if (pluginSurfaceAttached && pluginSurfaceKind === 'codesys') pluginSurfaceView?.webContents.send('codesys:frame', frame); }); }));
  ipcMain.handle('codesys:stream-stop', (_event, id) => harness.runTool('codesys.stream-stop', { id }, () => {
    // Stopping the live view ends the armed AI-input session with it, so a
    // stale arm cannot authorise input against a window that is no longer shown.
    if (codesysInputArm.armed) codesysInputArm = { armed: false, windowId: '' };
    return monitor.stopStream(id);
  }));
  ipcMain.handle('codesys:visual-status', () => harness.runTool('modlens.doctor', {}, () => pluginEnabled('modlens') ? modlens.doctor() : { installed: false, ready: false, state: 'disabled', readyProviders: [], message: 'ModLens 插件未启用' }));
  ipcMain.handle('codesys:visual-analyze', (_event, capture) => harness.runTool('modlens.analyze', { sha256: capture?.sha256 }, () => { requirePluginEnabled('modlens'); return modlens.analyze(capture || {}); }));
  ipcMain.handle('codesys:scriptengine-status', () => harness.runTool('codesys.scriptengine.doctor', {}, () => { requirePluginEnabled('codesys-monitor'); return codesysScriptEngine.doctor({ persist: true }); }));
  ipcMain.handle('codesys:scriptengine-configure', () => harness.runTool('codesys.scriptengine.configure', {}, async () => {
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
  ipcMain.handle('codesys:scriptengine-probe', (_event, input) => harness.runTool('codesys.scriptengine.probe', {}, () => { requirePluginEnabled('codesys-monitor'); return codesysScriptEngine.execute('probe', input || {}); }));
  ipcMain.handle('codesys:scriptengine-action', (_event, input) => {
    const action = String(input?.action || '');
    const args = input?.input && typeof input.input === 'object' ? input.input : {};
    return harness.runTool(`codesys.scriptengine.${action}`, { jobId: args.jobId || '', objectName: args.objectName || '' }, () => { requirePluginEnabled('codesys-monitor'); return codesysScriptEngine.execute(action, args); });
  });
  // ── Online (PLC) actions ────────────────────────────────────────────────────
  // Only `login`, `logout` and `download` reach a controller, and only under an
  // authorization the operator armed from the workbench UI. `online-change`,
  // variable writes, start/stop/reset, debugging, breakpoints, stepping and Force
  // have no IPC entry point at all.
  ipcMain.handle('codesys:online-status', () => harness.runTool('codesys.online.status', {}, async () => {
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
  // 独立通道：界面**只要调用成功**就证明主进程不旧（旧主进程没有这个 handler，
  // 调用会直接失败）。这是唯一能自证"跑着的引擎是不是磁盘上那一份"的办法。
  ipcMain.handle('codesys:engine-freshness', () => codesysEngineFreshness());
  ipcMain.handle('codesys:online-arm', (event, input) => {
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
  ipcMain.handle('codesys:online-disarm', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线授权只能由 TaskHive 界面解除');
    const reason = String(input?.reason || 'manual');
    const result = codesysOnlineAuthorization.disarm(reason);
    // An authorization that is gone must not leave a worker attached to a
    // controller, so dropping the grant also drops the session.
    void codesysScriptEngine.stopOnlineSession(`authorization-${reason}`).catch(() => {});
    return result;
  });
  // Device discovery. This is CODESYS' "scan network": the gateway broadcasts and
  // reports controllers. No controller is contacted, nothing is written, and no
  // authorization is needed — it only replaces typing an IP by hand.
  ipcMain.handle('codesys:online-scan', (event, input) => {
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
  // Retargeting the session. This writes ONLY to the throwaway project copy the
  // worker holds (it is never saved), so the operator's .project is untouched; it
  // does contact no controller. A successful change invalidates the armed
  // authorization, because that grant names a specific target.
  ipcMain.handle('codesys:online-set-target', (event, input) => {
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
  // Explicit release: stop the persistent CODESYS worker (≈700 MB) without
  // touching the authorization. Used by the workbench's 「释放在线会话」 button so
  // the operator is never stuck with a hidden process they cannot get rid of.
  ipcMain.handle('codesys:online-release', (event) => {
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
  // Preparing the online worker touches NO controller: it opens a copy of the
  // bound project and reads the target that a login would use. That is precisely
  // why it needs no authorization and can run as soon as a project is bound —
  // the operator has to be able to see WHERE a login goes before allowing one.
  ipcMain.handle('codesys:online-prepare', (event, input) => {
    if (!isTrustedSender(event)) throw new Error('CODESYS 在线会话只能由 TaskHive 界面准备');
    requirePluginEnabled('codesys-monitor');
    const jobId = String(input?.jobId || '');
    if (!jobId) return { ok: false, reason: 'job-missing' };
    if (codesysScriptEngine.onlineState().jobId && codesysScriptEngine.onlineState().jobId !== jobId) {
      codesysOnlineAuthorization.disarm('job-rebound');
    }
    return codesysScriptEngine.prepareOnlineSession(jobId, 180000);
  });
  // Online value monitoring. This is a READ, so it is deliberately NOT wrapped in
  // harness.runTool (it polls about once a second and would flood the trajectory);
  // it is still only served for a session the operator armed and that the worker
  // reports as logged in.
  ipcMain.handle('codesys:online-monitor', (event, input) => {
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
  ipcMain.handle('codesys:online-action', (event, input) => {
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
      return result;
    });
  });
  ipcMain.handle('codesys:select-offline-file', async (_event, kind) => {
    requirePluginEnabled('codesys-monitor');
    const xml = kind === 'xml';
    const smokeProject = !xml ? codesysSmokeProjectPath() : '';
    if (smokeProject) return { canceled: false, path: smokeProject, testOverride: true };
    const selected = await dialog.showOpenDialog(mainWindow, { title: xml ? '选择 PLCopenXML 文件' : '选择 CODESYS 工程', properties: ['openFile'], filters: xml ? [{ name: 'PLCopenXML', extensions: ['xml'] }] : [{ name: 'CODESYS Project', extensions: ['project'] }] });
    return { canceled: selected.canceled, path: selected.filePaths[0] || '' };
  });
  ipcMain.handle('codesys:copy-project-path', (_event, sourcePath) => {
    const value = path.resolve(String(sourcePath || ''));
    if (!value || path.extname(value).toLowerCase() !== '.project' || !fs.existsSync(value)) throw new Error('当前 CODESYS 工程路径无效');
    if (isCodesysSmokeProject(value)) return { copied: true, path: value, testOverride: true };
    clipboard.writeText(value);
    return { copied: true, path: value };
  });
  ipcMain.handle('codesys:reveal-project', (_event, sourcePath) => {
    const value = path.resolve(String(sourcePath || ''));
    if (!value || path.extname(value).toLowerCase() !== '.project' || !fs.existsSync(value)) throw new Error('当前 CODESYS 工程路径无效');
    if (isCodesysSmokeProject(value)) return { revealed: true, path: value, testOverride: true };
    shell.showItemInFolder(value);
    return { revealed: true, path: value };
  });
  ipcMain.handle('codesys:native-host-status', () => ({ ...codesysNativeHost.status(), enabled: true, scope: 'current-taskhive-plugin-exact-hwnd-only' }));
  ipcMain.handle('codesys:native-host-attach', async (event, input) => harness.runTool('codesys.native-host.attach', { windowId: input?.windowId }, async () => {
    requirePluginEnabled('codesys-monitor');
    if (event.sender !== pluginSurfaceView?.webContents || pluginSurfaceKind !== 'codesys') throw new Error('CODESYS 原生托管只能从中央插件页面开启');
    codesysNativeLocalBounds = input?.bounds || null;
    const bounds = codesysNativeScreenBounds();
    if (!bounds) throw new Error('CODESYS 原生托管区域尚未就绪');
    return codesysNativeHost.attach(input?.windowId, bounds, mainWindow);
  }));
  ipcMain.handle('codesys:native-host-move', async (event, bounds) => {
    if (event.sender !== pluginSurfaceView?.webContents || pluginSurfaceKind !== 'codesys') return codesysNativeHost.status();
    codesysNativeLocalBounds = bounds || null;
    const screenBounds = codesysNativeScreenBounds();
    return screenBounds && codesysNativeHost.status().attached ? codesysNativeHost.update(screenBounds) : codesysNativeHost.status();
  });
  ipcMain.handle('codesys:native-host-detach', (event) => {
    if (!isTrustedSender(event, { allowHarness: false })) return codesysNativeHost.status();
    codesysNativeLocalBounds = null;
    return harness.runTool('codesys.native-host.detach', {}, () => codesysNativeHost.detach('user'));
  });
  // The CODESYS native input path is only ever driven by the TaskHive shell.
  // Without a sender check any script in a preload-bearing context could move
  // the operator's real mouse and type into the live CODESYS window.
  ipcMain.handle('codesys:input-request', (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS 输入请求只能由 TaskHive 插件页面发起');
    return harness.runTool('codesys.input.request', { type: input?.action?.type }, () => { requirePluginEnabled('codesys-monitor'); return codesysInput.request(input || {}); });
  });
  ipcMain.handle('codesys:input-execute', (event, approvalId) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS 输入执行只能由 TaskHive 插件页面发起');
    return harness.runTool('codesys.input.execute', { approvalId }, () => { requirePluginEnabled('codesys-monitor'); return codesysInput.execute(approvalId); });
  });
  // The operator switching "AI 操作" on is the only thing that may auto-approve
  // native input. Record it in the main process so the direct path can verify
  // that a real user gesture armed this exact window.
  ipcMain.handle('codesys:input-arm', (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS 输入授权只能由 TaskHive 插件页面设置');
    codesysInputArm = { armed: input?.armed === true, windowId: String(input?.windowId || '') };
    harness.append('codesys.input.arm', { ...codesysInputArm, at: new Date().toISOString() });
    return { ...codesysInputArm };
  });
  ipcMain.handle('codesys:input-direct', (event, input) => {
    if (!isTrustedSender(event, { allowHarness: false })) throw new Error('CODESYS 直接输入只能由 TaskHive 插件页面发起');
    return harness.runTool('codesys.input.direct', { type: input?.action?.type }, async () => {
      requirePluginEnabled('codesys-monitor');
      const windowId = String(input?.windowId || '');
      if (!codesysInputArm.armed || !windowId || windowId !== codesysInputArm.windowId) {
        throw Object.assign(new Error('AI 操作未开启：请先在 CODESYS 面板显式打开“AI 操作”并选中目标窗口'), { code: 'CODESYS_INPUT_NOT_ARMED' });
      }
      // The approval is granted by the main process because a real user gesture
      // armed this window; it is never taken from caller-supplied data.
      const approval = await codesysInput.request({ ...(input || {}), windowId, initiator: 'ai-operation-direct' });
      return codesysInput.execute(approval.approvalId);
    });
  });
  ipcMain.handle('codesys:preferred-window', async (_event, input) => {
    // The CODESYS panel's window selector defines the ONE window the workbench
    // follows. Validation goes through the ownership-filtered resolver, so a
    // window this plugin did not launch can never become the monitored window.
    requirePluginEnabled('codesys-monitor');
    const requestedWindowId = String(input?.windowId || '');
    if (!requestedWindowId) {
      codesysPreferredWindowId = '';
      codesysOnlineAuthorization.disarm('monitored-window-cleared');
      await codesysScriptEngine.stopOnlineSession('monitored-window-cleared').catch(() => {});
      await notifyMonitoredWindowChanged('');
      return { preferredWindowId: '' };
    }
    const target = await monitor.resolveWindow(requestedWindowId);
    if (!target) throw Object.assign(new Error('只能把本插件打开的 CODESYS 窗口设为监视窗口'), { code: 'CODESYS_WINDOW_NOT_OWNED' });
    if (String(target.id) !== codesysPreferredWindowId) {
      // A different monitored window can mean a different project; the online
      // authorization must never silently follow the switch to another device.
      const revoked = codesysOnlineAuthorization.disarm('monitored-window-changed');
      if (revoked.disarmed) await codesysScriptEngine.stopOnlineSession('monitored-window-changed').catch(() => {});
    }
    codesysPreferredWindowId = String(target.id);
    await notifyMonitoredWindowChanged(codesysPreferredWindowId);
    return { preferredWindowId: codesysPreferredWindowId };
  });
  ipcMain.handle('codesys:workbench-open', async (_event, input) => {
    const requestedWindowId = String(input?.windowId || '');
    if (requestedWindowId) {
      const target = await monitor.resolveWindow(requestedWindowId);
      if (!target) throw Object.assign(new Error('工作台只能绑定由当前插件打开的 CODESYS 窗口'), { code: 'CODESYS_WORKBENCH_WINDOW_NOT_OWNED' });
      codesysPreferredWindowId = String(target.id);
    }
    const frame = currentHarnessFrame();
    if (!frame) throw new Error('Harness 工作区尚未就绪');
    await frame.executeJavaScript(`window.postMessage({source:'taskhive-desktop',type:'codesys.workbench.open'}, '*')`, true);
    return { opened: true, owner: 'Harness/DSH', agentLoop: 'single' };
  });
  ipcMain.handle('codesys:code-ai-request', (_event, input) => harness.runTool('codesys.code-ai.request', { prompt: String(input?.prompt || '').slice(0, 2000) }, async () => {
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
  ipcMain.handle('terminal:run', (_event, command) => harness.runTool('terminal.run', { command: String(command || '').slice(0, 2000) }, () => new Promise((resolve, reject) => {
    const value = String(command || '').trim();
    if (!value) return resolve({ ok: true, stdout: '', stderr: '' });
    const invocation = shellInvocation(terminalShell, value);
    execFile(invocation.command, invocation.args, { cwd: root, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const result = { ok: !error, code: error?.code ?? 0, stdout: String(stdout || ''), stderr: String(stderr || '') };
      if (error && !result.stderr) result.stderr = error.message;
      resolve(result);
    });
  })));
  ipcMain.handle('terminal:start', (_event, command) => harness.runTool('terminal.start', { command: String(command || '').slice(0, 2000) }, () => {
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
  ipcMain.handle('terminal:stop', (_event, taskId) => harness.runTool('terminal.stop', { taskId }, async () => {
    const task = terminalTasks.get(String(taskId || ''));
    if (!task) return { taskId, state: 'not-found' };
    if (process.platform === 'win32' && task.child.pid) await new Promise((resolve) => execFile('taskkill.exe', ['/PID', String(task.child.pid), '/T', '/F'], { windowsHide: true }, () => resolve())); else task.child.kill('SIGTERM');
    terminalTasks.delete(task.taskId);
    return { taskId: task.taskId, state: 'stopped' };
  }));
  ipcMain.handle('terminal:status', () => ({
    ...terminalShell,
    versionParts: undefined,
    sidebarShell: process.env.DSH_SIDEBAR_SHELL,
    surfaces: ['内置终端', '模型 terminal_* 工具'],
    modelProcessPolicy: 'CLI 直接子进程继承环境；模型终端工具使用 sidebarShell',
  }));
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
  // Electron 30+ delivers this event as (event, details); the old positional
  // (level, message, line, sourceId) signature reads `level` as an object there,
  // so the `level >= 2` test never held and renderer errors were never recorded.
  // That silence is what made the 431-blank-window outage hard to see.
  mainWindow.webContents.on('console-message', (...args) => {
    const details = args.length >= 2 && args[1] && typeof args[1] === 'object'
      ? args[1]
      : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    const level = typeof details.level === 'string' ? details.level : (Number(details.level) >= 2 ? 'warning' : 'info');
    if (level !== 'warning' && level !== 'error') return;
    fs.appendFileSync(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} level=${level} ${String(details.sourceId || '')}:${details.lineNumber} ${String(details.message || '').slice(0, 2000)}\n`, 'utf8');
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    fs.appendFileSync(path.join(root, 'logs', 'renderer-console.log'), `${new Date().toISOString()} load-failed ${code} ${description} ${url}\n`, 'utf8');
  });
  mainWindow.on('closed', () => {
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

async function probeDeepDivingDisclosure(frame) {
  const result = await frame.executeJavaScript(`(() => ({
    nativeDisclosurePresent: Boolean(document.querySelector('[data-variant="think"]')),
    taskHiveDisclosureOverlayPresent: Boolean(document.querySelector('[data-taskhive-deep-diving],[data-taskhive-public-reasoning]')),
  }))()`, true);
  const evidence = { ok: result.taskHiveDisclosureOverlayPresent === false, ...result, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'deep-diving-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error(`Deep diving disclosure probe failed: ${JSON.stringify(evidence)}`);
  return evidence;
}

async function probeHarnessFrames() {
  const mainFrame = mainWindow?.webContents?.mainFrame;
  const frames = mainFrame ? [mainFrame, ...(mainFrame.frames || [])] : [];
  const evidence = [];
  for (const frame of frames) {
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(frame.url || '')) continue;
    try {
      const result = await frame.executeJavaScript(`(() => {
        const text = document.body?.innerText || '';
        const buttons = [...document.querySelectorAll('button')].map((node) => ({ text: (node.innerText || node.getAttribute('aria-label') || '').trim(), disabled: node.disabled === true }));
        const disclaimer = buttons.find((button) => /^(继续|continue)$/i.test(button.text));
        const layoutCandidates = [...document.querySelectorAll('body *')].map((node) => {
          const rect = node.getBoundingClientRect();
          return { tag: node.tagName, id: node.id, className: String(node.className || '').slice(0, 120), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), text: String(node.innerText || '').trim().slice(0, 80) };
        }).filter((item) => item.width >= 240 && item.width <= 520 && item.height >= 500 && item.x <= 20).slice(0, 20);
        const brandCandidates = [...document.querySelectorAll('body *')].filter((node) => /deepseek|harness/i.test(String(node.innerText || node.textContent || ''))).slice(0, 12).map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return { tag: node.tagName, cls: String(node.className || '').slice(0,120), text: String(node.innerText || node.textContent || '').trim().slice(0,100), display: style.display, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; });
        return { url: location.href, bodyTextLength: text.length, buttons, layoutCandidates, taskhiveSkin: Boolean(document.querySelector('#taskhive-harness-skin')), taskhiveBrand: Boolean(document.querySelector('[data-taskhive-workbench-brand]')), brandCandidates, visiblePreviewText: [...document.querySelectorAll('body *')].some((node) => node.getClientRects().length > 0 && String(node.textContent || '').trim() === '预览版'), visibleModeText: [...document.querySelectorAll('body *')].some((node) => node.getClientRects().length > 0 && String(node.textContent || '').trim() === '标准模式'), taskhiveSurfacesRegistered: window.__TASKHIVE_SURFACES_REGISTERED__ === true, taskhiveSurfaceIds: window.__TASKHIVE_SURFACE_IDS__ || [], disclaimerButtonPresent: Boolean(disclaimer), internalNoticeRemoved: window.__TASKHIVE_INTERNAL_NOTICE_REMOVED__ === true, betterSidebar: Boolean(document.querySelector('[class*="sidebar"], [data-testid*="sidebar"], aside')) };
      })()`, true);
      evidence.push(result);
      // A fresh DSH profile has no active session, so Better Sidebar's
      // session-scoped tabs are intentionally not visible yet. Create an
      // isolated session through the real DSH UI, then probe the resulting
      // tab strip without launching another agent loop.
      const created = await frame.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')].find((node) => /^(新会话|new session)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`, true);
      if (created) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await frame.executeJavaScript(`(() => {
          const button = [...document.querySelectorAll('button')].find((node) => /^(选择工作区|select workspace)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
          if (!button || button.disabled) return false;
          button.click();
          return true;
        })()`, true);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const ready = await frame.executeJavaScript(`(() => (window.__TASKHIVE_SURFACE_IDS__ || []).includes('codesys') || Boolean(document.querySelector('[data-sidebar-plugin-id="codesys-monitor"]')) || [...document.querySelectorAll('button')].some((node) => /CODESYS/i.test((node.innerText || '').trim())))()`, true);
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const afterSession = await frame.executeJavaScript(`(() => {
          const text = document.body?.innerText || '';
          const buttons = [...document.querySelectorAll('button')].map((node) => ({ text: (node.innerText || node.getAttribute('aria-label') || '').trim(), disabled: node.disabled === true }));
          const inputs = [...document.querySelectorAll('input, [role="dialog"], [role="menu"]')].map((node) => ({ tag: node.tagName, type: node.getAttribute('type'), placeholder: node.getAttribute('placeholder'), text: (node.innerText || '').trim().slice(0, 400) }));
          const taskhiveButtons = buttons.filter((button) => /CODESYS|插件管理|知识库|专家|TaskHive/i.test(button.text));
          return { bodyText: text.slice(0, 1200), bodyTextLength: text.length, buttons, inputs, taskhiveButtons, taskhiveSurfaceIds: window.__TASKHIVE_SURFACE_IDS__ || [], bodyHasCodySys: /CODESYS/i.test(text), sessionProbe: window.__TASKHIVE_SESSION_PROBE__?.snapshot?.() || null };
        })()`, true);
        evidence.push({ sessionCreated: true, ...afterSession });
      } else {
        evidence.push({ sessionCreated: false });
      }
      await probeExpertShortcut(frame);
      await probeDeepDivingDisclosure(frame);
    } catch (error) {
      evidence.push({ url: frame.url, error: String(error?.stack || error) });
    }
  }
  fs.writeFileSync(path.join(root, 'logs', 'dsh-frame-probe.json'), JSON.stringify({ at: new Date().toISOString(), frames: evidence }, null, 2), 'utf8');
  return evidence;
}

async function probeExpertShortcut(frame) {
  const original = expertConfig.status();
  let result = { visible: false, reason: 'not-run' };
  try {
    const initialProbe = await frame.executeJavaScript(`(async () => {
      const deadline = Date.now() + 15000;
      let button = null;
      while (Date.now() < deadline) {
        button = document.querySelector('[data-taskhive-expert-toggle="true"]');
        if (button && !button.disabled) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!button) return { visible: false, reason: 'expert-toggle-not-found' };
      const snapshot = () => ({
        text: (button.innerText || '').trim(),
        enabled: button.getAttribute('data-enabled') === 'true',
        pressed: button.getAttribute('aria-pressed'),
        disabled: button.disabled === true,
        hasLineIcon: Boolean(button.querySelector('svg[fill="none"]')),
        visible: (() => { const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })(),
        geometry: (() => {
          const rect = button.getBoundingClientRect();
          const candidates = [...document.querySelectorAll('button')].filter((node) => {
            if (node === button) return false;
            const candidate = node.getBoundingClientRect();
            return candidate.width > 0 && candidate.height > 0 && candidate.right <= rect.left + 1 && Math.abs((candidate.top + candidate.bottom) / 2 - (rect.top + rect.bottom) / 2) <= 12;
          }).map((node) => {
            const candidate = node.getBoundingClientRect();
            return { node, candidate, gap: rect.left - candidate.right };
          }).sort((left, right) => left.gap - right.gap);
          const adjacent = candidates[0];
          return {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            adjacentLeftControl: adjacent ? {
              text: String(adjacent.node.innerText || '').trim(),
              label: String(adjacent.node.getAttribute('aria-label') || adjacent.node.getAttribute('title') || '').trim(),
              gap: adjacent.gap,
              width: adjacent.candidate.width,
              height: adjacent.candidate.height,
            } : null,
          };
        })(),
        style: (() => {
          const computed = getComputedStyle(button);
          return {
            borderStyle: computed.borderStyle,
            borderWidth: computed.borderWidth,
            backgroundColor: computed.backgroundColor,
            paddingLeft: computed.paddingLeft,
            paddingRight: computed.paddingRight,
            gap: computed.gap,
            cursor: computed.cursor,
          };
        })(),
      });
      const initial = snapshot();
      return { visible: initial.visible, buttonCenter: { x: Math.round(initial.geometry.x + initial.geometry.width / 2), y: Math.round(initial.geometry.y + initial.geometry.height / 2) }, initial };
    })()`, true);
    if (!initialProbe.visible) {
      result = initialProbe;
    } else {
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: initialProbe.buttonCenter.x, y: initialProbe.buttonCenter.y });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const hover = await frame.executeJavaScript(`(() => {
        const button = document.querySelector('[data-taskhive-expert-toggle="true"]');
        const computed = button ? getComputedStyle(button) : null;
        return { matches: Boolean(button?.matches(':hover')), backgroundColor: computed?.backgroundColor || '', cursor: computed?.cursor || '' };
      })()`, true);
      let hoverScreenshot = '';
      try {
        const image = await mainWindow.webContents.capturePage();
        hoverScreenshot = path.join('logs', 'ui-expert-shortcut-hover.png');
        fs.writeFileSync(path.join(root, hoverScreenshot), image.toPNG());
      } catch (error) {
        hoverScreenshot = `capture-failed: ${error.message}`;
      }
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      result = await frame.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const button = document.querySelector('[data-taskhive-expert-toggle="true"]');
      const snapshot = () => ({
        text: (button.innerText || '').trim(),
        enabled: button.getAttribute('data-enabled') === 'true',
        pressed: button.getAttribute('aria-pressed'),
        popup: button.getAttribute('aria-haspopup'),
        disabled: button.disabled === true,
        hasLineIcon: Boolean(button.querySelector('svg[fill="none"]')),
        visible: (() => { const rect = button.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })(),
        backgroundColor: getComputedStyle(button).backgroundColor,
      });
      const initial = snapshot();
      // This control IS the only expert switch (the plugin surface configures
      // teams and stages but carries no second copy), so the probe proves the
      // round trip: click flips it, click flips it back.
      button.click();
      for (let attempt = 0; attempt < 100 && snapshot().enabled === initial.enabled; attempt += 1) await wait(50);
      const toggled = snapshot();
      button.click();
      for (let attempt = 0; attempt < 100 && snapshot().enabled !== initial.enabled; attempt += 1) await wait(50);
      const restored = snapshot();
      button.focus();
      const focusStyle = getComputedStyle(button);
      const focus = { matches: button.matches(':focus-visible'), outlineStyle: focusStyle.outlineStyle, outlineWidth: focusStyle.outlineWidth };
      button.blur();
      return { visible: initial.visible, textOnlyExpert: initial.text === '专家', initial, toggled, restored, focus };
    })()`, true);
      result = { ...result, initial: { ...initialProbe.initial, ...result.initial }, hover, hoverScreenshot };
    }
  } finally {
    expertConfig.setEnabled(original.enabled);
  }
  const transparentBackgrounds = new Set(['rgba(0, 0, 0, 0)', 'transparent']);
  // Measured on alpha.2: the composer card spaces EVERY control 16px apart
  // (BUTTON→BUTTON, BUTTON→完全权限, 完全权限→专家). The old `<= 8` cap predated that
  // layout, so the check is "shares the row with the host's own spacing", not a
  // tighter gap this control could not have without fighting the host.
  const adjacentGap = Number(result.initial?.geometry?.adjacentLeftControl?.gap);
  const hoverChannels = String(result.hover?.backgroundColor || '').match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
  const hoverIsDark = hoverChannels.length === 3 && hoverChannels.every((channel) => channel < 250);
  const evidence = {
    ok: result.visible === true
      && result.textOnlyExpert === true
      && result.initial?.hasLineIcon === true
      && ['none', 'hidden'].includes(result.initial?.style?.borderStyle)
      && result.initial?.style?.borderWidth === '0px'
      && result.initial?.geometry?.height === 28
      && Number.isFinite(adjacentGap) && adjacentGap > 0 && adjacentGap <= 20
      && result.hover?.matches === true
      && !transparentBackgrounds.has(result.hover?.backgroundColor)
      && hoverIsDark
      && result.hover?.cursor === 'pointer'
      && result.focus?.matches === true
      && result.focus?.outlineStyle !== 'none'
      && result.toggled?.enabled !== result.initial?.enabled
      && result.toggled?.pressed === String(result.toggled?.enabled)
      && result.restored?.enabled === result.initial?.enabled,
    inputSlot: 'conversation.input.left',
    order: -100,
    ...result,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'expert-shortcut-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeTaskHiveBranding(frame) {
  const result = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const brandButton = document.querySelector('[data-taskhive-workbench-brand="true"]');
    const composerBrand = document.querySelector('[data-taskhive-composer-brand="true"]');
    const permissionDuplicate = [...document.querySelectorAll('button,[role="button"],a')].find((node) => /^(?:Workspace\\s+Write|Read\\s+Only|Full\\s+access)$/i.test(String(node.textContent || '').trim()) && !node.closest('[role="dialog"]'));
    const visibleControls = [...document.querySelectorAll('button,a,[role="button"],select,input,textarea,summary')].filter(visible);
    const before = {
      permissionDuplicateVisible: visible(permissionDuplicate),
      permissionDuplicateMarked: permissionDuplicate?.dataset.taskhiveComposerPermission === 'true',
      brandButtonTaskHiveIcon: Boolean(brandButton?.querySelector('[data-taskhive-brand-icon="true"]')),
      brandButtonText: String(brandButton?.textContent || '').trim(),
      composerBrandVisible: visible(composerBrand),
      composerBrandText: String(composerBrand?.textContent || '').trim(),
      composerBrandTaskHiveIcon: Boolean(composerBrand?.querySelector('[data-taskhive-brand-icon="true"]')),
      tooltipCoverage: { controls: visibleControls.length, missing: visibleControls.filter((node) => !String(node.getAttribute('title') || '').trim()).length },
    };
    // Textual dump of the sidebar brand region. The skin has to target the real
    // markup, and the hashed DSH class names are not readable from source, so
    // record what is actually rendered instead of guessing again.
    const describe = (node) => node ? {
      tag: node.tagName,
      cls: String(node.className || '').slice(0, 90),
      slot: node.getAttribute('data-slot') || '',
      aria: String(node.getAttribute('aria-label') || '').slice(0, 60),
      title: String(node.getAttribute('title') || '').slice(0, 60),
      text: String(node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 90),
      html: String(node.innerHTML || '').replace(/\\s+/g, ' ').slice(0, 220),
      w: Math.round(node.getBoundingClientRect().width),
      h: Math.round(node.getBoundingClientRect().height),
    } : null;
    const markNode = document.querySelector('[data-slot="sidebar.brand.mark"]');
    const sidebarRoot = document.querySelector('[data-pane="sidebar"], aside, [class*="sidebarCol"]');
    const sidebarBrandCandidates = [...(sidebarRoot?.querySelectorAll('button,[role="button"],a,span,div') || [])]
      .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 90 && r.left < 300; })
      .slice(0, 14)
      .map(describe);
    const deepSeekTextNodes = [...document.querySelectorAll('body *')]
      .filter((node) => node.children.length === 0 && /deepseek/i.test(String(node.textContent || '')))
      .slice(0, 10)
      .map((node) => ({ text: String(node.textContent || '').trim().slice(0, 70), parent: describe(node.parentElement), visible: visible(node) }));
    const brandAudit = { markNode: describe(markNode), brandButton: describe(document.querySelector('[data-taskhive-workbench-brand="true"]')), sidebarBrandCandidates, deepSeekTextNodes };
    // Normalise to the expanded state first, then toggle, so the audit captures
    // both layouts regardless of how the previous probe left the sidebar.
    const sidebarRootEl = () => document.querySelector('[class*="hHd-"][class*="root"], [data-pane="sidebar"], aside');
    const toggleButton = () => [...document.querySelectorAll('button')].find((node) => /hHd-.*toggle|sidebar.*toggle/i.test(String(node.className || ''))) || null;
    const isCollapsed = () => Boolean(document.querySelector('[class*="_collapsed"]'));
    const railMark = () => document.querySelector('[data-slot="sidebar.brand.mark"]');
    const logoRow = () => {
      const mark = railMark();
      return mark?.closest('[class*="logoRow"]') || document.querySelector('[class*="logoRow"]') || mark?.parentElement || null;
    };
    const captureSidebar = () => ({
      collapsed: isCollapsed(),
      sidebarClass: String(sidebarRootEl()?.className || '').slice(0, 120),
      toggleAria: String(toggleButton()?.getAttribute('aria-label') || ''),
      toggleTitle: String(toggleButton()?.getAttribute('title') || ''),
      logoRow: describe(logoRow()),
      railMark: describe(railMark()),
      // The mark is the TaskHive program icon, i.e. an <img>, so capture the
      // element itself rather than an <svg> (which is only the pre-icon
      // placeholder).
      brandMark: String(railMark()?.querySelector('[data-taskhive-brand-mark="true"]')?.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 200),
      brandMarkTag: String(railMark()?.querySelector('[data-taskhive-brand-mark="true"]')?.tagName || ''),
      brandMarkSrc: String(railMark()?.querySelector('[data-taskhive-brand-mark="true"]')?.getAttribute('src') || '').slice(0, 22),
      railSvg: String(railMark()?.querySelector('svg')?.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 160),
      logoRowText: String(logoRow()?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
    });
    if (isCollapsed()) { toggleButton()?.click(); await wait(450); }
    // The skin re-applies after React commits, so poll for the mark instead of
    // reading once: a single read races the re-render and reports the vendor
    // logo that React just restored.
    const waitForBrand = async (timeoutMs = 4000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const el = document.querySelector('[data-slot="sidebar.brand.mark"] [data-taskhive-brand-mark="true"]');
        const mark = document.querySelector('[data-slot="sidebar.brand.name"] [data-taskhive-brand-wordmark="true"]');
        if (el && el.tagName === 'IMG' && mark) return true;
        await wait(120);
      }
      return false;
    };
    brandAudit.brandSettledExpanded = await waitForBrand();
    brandAudit.expandedSidebar = captureSidebar();
    if (!isCollapsed()) { toggleButton()?.click(); await wait(450); }
    brandAudit.brandSettledCollapsed = await waitForBrand();
    brandAudit.collapsedSidebar = captureSidebar();
    const collapseControl = toggleButton();
    let collapsed = { exercised: Boolean(collapseControl), width: 0, sidebarRailIcon: false, taskhiveTextHidden: false, ariaLabel: '' };
    if (collapseControl) {
      const rect = collapseControl.getBoundingClientRect();
      collapsed = {
        exercised: true,
        width: Math.round(rect?.width || 0),
        sidebarRailIcon: Boolean(railMark()?.querySelector('[data-taskhive-sidebar-rail-icon="true"]')),
        taskhiveTextHidden: !/deepseek/i.test(String(logoRow()?.textContent || '')),
        ariaLabel: collapseControl.getAttribute('aria-label') || '',
      };
      // Leave the sidebar expanded again for the remaining probes.
      if (isCollapsed()) { collapseControl.click(); await wait(450); }
    }
    const visibleDeepSeek = [...document.querySelectorAll('body *')].some((node) => visible(node) && node.children.length === 0 && /^(DeepSeek|DeepSeek Harness|Harness)$/i.test(String(node.textContent || '').trim()));
    // The sidebar mark must be the TaskHive program icon. DSH ships a vendor
    // logo in this slot and a plain panel glyph is not the app's identity, so
    // assert the real icon: an <img data-taskhive-brand-mark> whose src is the
    // host-supplied data URL.
    const markEl = document.querySelector('[data-slot="sidebar.brand.mark"] [data-taskhive-brand-mark="true"]');
    // NOTE: this is inside a template literal, so regex escapes must be doubled.
    // A single backslash-slash is dropped by the template and emits a regex that
    // ends early, producing a syntax error at this exact line.
    const brandMarkIsProgramIcon = Boolean(markEl && markEl.tagName === 'IMG' && /^data:image\\//.test(String(markEl.getAttribute('src') || '')));
    const foreignRailIcons = [...document.querySelectorAll('[data-slot="sidebar.brand.mark"] img,[data-slot="sidebar.brand.mark"] svg')].filter((icon) => visible(icon) && !icon.hasAttribute('data-taskhive-brand-mark')).length;
    // The wordmark is an SVG, not text, so it is checked structurally: the slot
    // must carry our span and must not still hold a vendor glyph SVG.
    const nameSlot = document.querySelector('[data-slot="sidebar.brand.name"]');
    const wordmarkReplaced = Boolean(nameSlot?.querySelector('[data-taskhive-brand-wordmark="true"]'));
    const foreignWordmark = Boolean(nameSlot?.querySelector('svg'));
    const visibleInternalNotice = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some((node) => visible(node) && /(内测|测试版本|预览版|免责声明|preview|beta|DeepSeek\\s+Harness)/i.test(String(node.textContent || '')));
    // Theme evidence: the injected TaskHive tokens must resolve, and the old
    // forced monochrome block must be gone. A grayscale surface was the visible
    // complaint, so assert the accent actually reaches the DOM.
    const themeProbe = {
      brandToken: getComputedStyle(document.documentElement).getPropertyValue('--th-brand').trim(),
      brandTint: getComputedStyle(document.documentElement).getPropertyValue('--th-brand-tint').trim(),
      inkToken: getComputedStyle(document.documentElement).getPropertyValue('--th-ink').trim(),
      forcedMonochromeRules: [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((rule) => String(rule.cssText || '')) } catch { return [] } }).filter((text) => /#cfcfcf!important|background:#f7f7f7!important/.test(text)).length,
    };
    const primarySurface = [...document.querySelectorAll('textarea,[contenteditable="true"],[data-conversation-scroll],[data-taskhive-sidebar-plugins]')].some(visible);
    return {
      before, collapsed, primarySurface, brandAudit, themeProbe,
      restored: wordmarkReplaced,
      railGlyphApplied: brandMarkIsProgramIcon,
      brandMarkIsProgramIcon,
      brandMarkSrcPrefix: String(markEl?.getAttribute('src') || '').slice(0, 22),
      wordmarkReplaced, foreignWordmark,
      visibleDeepSeek, foreignRailIcons, visibleInternalNotice,
      internalNoticeRemoved: window.__TASKHIVE_INTERNAL_NOTICE_REMOVED__ === true,
    };
  })()`, true);
  const evidence = {
    // `collapsed.sidebarRailIcon` is reported as evidence but deliberately not
    // part of `ok`: alpha.2 does not change the sidebar width in a headless
    // smoke run, so the collapsed branch cannot be exercised reliably here.
    // Criteria are derived from the markup DSH 0.1.3-alpha.2 actually renders,
    // dumped from the live frame:
    //   * the vendor logo lives in [data-slot="sidebar.brand.mark"] and the
    //     vendor wordmark in [data-slot="sidebar.brand.name"] as an SVG of glyph
    //     outlines, so text-only checks can never see it;
    //   * there is no composer brand and no `_brand` button with text, so the
    //     old criteria for those are gone rather than silently skipped.
    ok: result.railGlyphApplied === true
      && result.brandMarkIsProgramIcon === true
      && String(result.brandMarkSrcPrefix || '').startsWith('data:image/')
      && result.wordmarkReplaced === true
      && result.foreignRailIcons === 0
      && result.foreignWordmark === false
      && result.visibleDeepSeek === false
      && result.visibleInternalNotice === false
      && result.primarySurface === true
      && result.brandAudit?.collapsedSidebar?.brandMarkTag === 'IMG'
      && result.brandAudit?.collapsedSidebar?.brandMarkSrc === 'data:image/png;base64,'
      && result.brandAudit?.expandedSidebar?.brandMarkTag === 'IMG'
      && result.themeProbe?.brandToken === '#4f6ef2'
      && result.themeProbe?.forcedMonochromeRules === 0,
    theme: 'taskhive-1.0.2',
    ...result,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'ui-branding-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

// Runtime-only evidence probe. It intentionally inspects the real DSH frame
// instead of inferring Settings geometry from package names or CSS.
async function probeNativeSettings() {
  const beforeWindows = BrowserWindow.getAllWindows().map((win) => ({ id: win.id, title: win.getTitle(), bounds: win.getBounds(), url: win.webContents.getURL() }));
  let frame = null;
  for (let attempt = 0; attempt < 80 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) {
    const evidence = { status: 'runtime-unverified', reason: 'dsh-frame-not-found', beforeWindows, afterWindows: BrowserWindow.getAllWindows().map((win) => ({ id: win.id, title: win.getTitle(), bounds: win.getBounds(), url: win.webContents.getURL() })), at: new Date().toISOString() };
    fs.writeFileSync(path.join(root, 'logs', 'native-settings-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
    return evidence;
  }
  const controls = await frame.executeJavaScript(`(() => [...document.querySelectorAll('button,[role="button"],a')].map((node, index) => ({ index, tag: node.tagName, text: (node.innerText || '').trim().slice(0, 100), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), testid: node.getAttribute('data-testid'), cls: String(node.className || '').slice(0, 140), href: node.getAttribute('href'), disabled: node.disabled === true })).slice(0, 120))()`, true);
  const composerPermission = await frame.executeJavaScript(`(() => {
    const node = [...document.querySelectorAll('button,[role="button"]')].find((item) => !item.closest('[role="dialog"],[aria-modal="true"]') && /访问模式，当前：|^(Workspace Write|Read Only|Danger Full Access|Full access)$/i.test(String(item.getAttribute('aria-label') || item.innerText || '').trim()));
    if (!node) return { found: false, visible: false, marked: false, text: '' };
    const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
    return { found: true, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', marked: node.dataset.taskhiveComposerPermission === 'true', text: String(node.innerText || '').trim() };
  })()`, true);
  const clicked = await frame.executeJavaScript(`(() => { const nodes = [...document.querySelectorAll('button,[role="button"],a')]; const node = nodes.find((item) => item.getAttribute('aria-haspopup') === 'dialog') || nodes.find((item) => /^(settings|设置|设定|preferences?)$/i.test((item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim())) || nodes.find((item) => /settings|preferences|设置/i.test([item.innerText, item.getAttribute('aria-label'), item.getAttribute('title'), item.getAttribute('data-testid')].join(' '))); if (!node) return { clicked: false }; node.click(); return { clicked: true, text: (node.innerText || '').trim(), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), testid: node.getAttribute('data-testid'), ariaHasPopup: node.getAttribute('aria-haspopup') }; })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const native = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const dialog = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find(visible);
    if (!dialog) return { dialog: null, reason: 'settings-dialog-not-found' };
    const rect = dialog.getBoundingClientRect();
    const navButtons = [...dialog.querySelectorAll('nav button,nav [role="button"]')];
    const tabs = navButtons.map((node, index) => ({ index, text: String(node.innerText || '').trim(), visible: visible(node), display: getComputedStyle(node).display }));
    const generalButton = navButtons.find((node) => /^(通用设置|General)$/i.test(String(node.innerText || '').trim()));
    generalButton?.click();
    await wait(350);
    const generalText = String(dialog.innerText || '');
    const readDirectoryState = () => {
      const directories = document.querySelector('[data-taskhive-settings-directories="true"]');
      const list = directories?.querySelector('[data-directory-list="true"]');
      const listRect = list?.getBoundingClientRect();
      const rows = [...(directories?.querySelectorAll('[data-directory-row]') || [])].map((row) => {
        const rowRect = row.getBoundingClientRect();
        const inputs = [...row.querySelectorAll('input')].map((input) => {
          const inputRect = input.getBoundingClientRect();
          return { aria: input.getAttribute('aria-label') || '', x: Math.round(inputRect.x), y: Math.round(inputRect.y), width: Math.round(inputRect.width), height: Math.round(inputRect.height) };
        });
        const actions = row.querySelector('[data-directory-actions="true"]')?.getBoundingClientRect();
        return { id: row.getAttribute('data-directory-row'), x: Math.round(rowRect.x), y: Math.round(rowRect.y), width: Math.round(rowRect.width), height: Math.round(rowRect.height), inputs, actions: actions ? { x: Math.round(actions.x), y: Math.round(actions.y), width: Math.round(actions.width), height: Math.round(actions.height) } : null };
      });
      return {
        visible: visible(directories),
        expanded: directories?.open === true,
        count: directories?.querySelectorAll('code').length || 0,
        rowCount: rows.length,
        text: String(directories?.innerText || ''),
        list: listRect ? { x: Math.round(listRect.x), y: Math.round(listRect.y), width: Math.round(listRect.width), height: Math.round(listRect.height), clientWidth: list.clientWidth, scrollWidth: list.scrollWidth } : null,
        rows,
        horizontalOverflow: Boolean(list && list.scrollWidth > list.clientWidth + 1),
      };
    };
    const directoryDetails = document.querySelector('[data-taskhive-settings-directories="true"]');
    if (directoryDetails) directoryDetails.open = true;
    directoryDetails?.scrollIntoView({ block: 'start' });
    await wait(400);
    let directoryState = readDirectoryState();
    const permissionTrigger = [...dialog.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && (/访问模式|权限模式/.test([node.getAttribute('aria-label'), node.getAttribute('title')].join(' ')) || /^(Workspace Write|Read Only|Danger Full Access|只读|工作区写入|完整访问)$/i.test(String(node.innerText || '').trim())));
    permissionTrigger?.click();
    await wait(250);
    const permissionText = [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="radio"],button')].filter(visible).map((node) => String(node.innerText || node.getAttribute('aria-label') || '').trim()).filter((text) => /(Read.?Only|Workspace.?Write|(?:Danger.?)?Full.?Access|只读|工作区写入|完整访问)/i.test(text));
    permissionTrigger?.click();
    await wait(150);
    const inspectTab = async (label) => {
      const candidates = navButtons.filter((node) => new RegExp('^' + label + '$', 'i').test(String(node.innerText || '').trim()));
      const results = [];
      for (const node of candidates) {
        node.click();
        await wait(300);
        if (/插件|Plugins?/i.test(label)) {
          const inventoryTab = [...dialog.querySelectorAll('button,[role="button"]')].find((candidate) => visible(candidate) && /^(本地插件|Local Plugins?)$/i.test(String(candidate.innerText || '').trim()));
          inventoryTab?.click();
          for (let attempt = 0; attempt < 80 && !document.querySelector('[data-taskhive-plugin-inventory="true"] [data-plugin-row]'); attempt += 1) await wait(100);
        }
        const inventoryRows = [...document.querySelectorAll('[data-taskhive-plugin-inventory="true"] [data-plugin-row]')].map((row) => ({
          id: row.getAttribute('data-plugin-row'), source: row.getAttribute('data-plugin-source'), type: row.getAttribute('data-plugin-type'), health: row.getAttribute('data-plugin-health'),
          placement: row.querySelector('select')?.value || null,
          disabledActions: [...row.querySelectorAll('button')].filter((button) => button.disabled).length,
          text: String(row.innerText || '').replace(/\s+/g, ' ').trim(),
        }));
        results.push({
          visible: visible(node),
          modelCatalog: Boolean(document.querySelector('[data-taskhive-model-settings="true"]')),
          pluginInventory: Boolean(document.querySelector('[data-taskhive-plugin-inventory="true"]')),
          inventoryRows,
          text: String(dialog.innerText || '').slice(0, 1800),
        });
      }
      return results;
    };
    const modelTabs = await inspectTab('模型|Models?');
    const pluginTabs = await inspectTab('插件|Plugins?');
    let permissionPriority = { requested: ${process.argv.includes('--probe-permission-priority') ? 'true' : 'false'} };
    if (permissionPriority.requested) {
      generalButton?.click();
      await wait(300);
      const trigger = [...dialog.querySelectorAll('button,[role="button"]')].find((node) => visible(node) && (/访问模式|权限模式/.test([node.getAttribute('aria-label'), node.getAttribute('title')].join(' ')) || /^(Workspace Write|Read Only|Danger Full Access|Full access|只读|工作区写入|完整访问)$/i.test(String(node.innerText || '').trim())));
      const initial = String(trigger?.innerText || '').trim();
      trigger?.click();
      await wait(250);
      const fullOption = [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="radio"],button')].find((node) => visible(node) && /^(Danger Full Access|Full access|完整访问)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
      fullOption?.click();
      await wait(300);
      const riskDialog = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].find((node) => visible(node) && /Full access|完整访问/i.test(String(node.innerText || '')) && node !== dialog);
      const acknowledgement = riskDialog?.querySelector('input[type="checkbox"],[role="checkbox"]');
      acknowledgement?.click();
      await wait(120);
      const confirmFullAccess = [...(riskDialog?.querySelectorAll('button') || [])].find((node) => /启用 Full access|Enable Full access|确认启用/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
      confirmFullAccess?.click();
      await wait(900);
      const selectedDefault = String(trigger?.innerText || '').trim();
      const close = [...dialog.querySelectorAll('button')].find((node) => /^(关闭设置|关闭|close settings|close)$/i.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim()));
      close?.click();
      await wait(500);
      const currentAccess = [...document.querySelectorAll('button,[role="button"]')].find((node) => !node.closest('[role="dialog"]') && /访问模式，当前：|^(Workspace Write|Read Only|Danger Full Access|Full access)$/i.test(String(node.getAttribute('aria-label') || node.innerText || '').trim()));
      const currentSession = String(currentAccess?.innerText || '').trim();
      const newSessionButton = [...document.querySelectorAll('button,[role="button"]')].find((node) => !node.closest('[role="dialog"]') && /^(新会话|new session)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
      newSessionButton?.click();
      await wait(700);
      const newSessionAccess = [...document.querySelectorAll('button,[role="button"]')].find((node) => !node.closest('[role="dialog"]') && /访问模式，当前：|^(Workspace Write|Read Only|Danger Full Access|Full access)$/i.test(String(node.getAttribute('aria-label') || node.innerText || '').trim()));
      const nextSession = String(newSessionAccess?.innerText || '').trim();
      permissionPriority = {
        requested: true,
        initial,
        selectedDefault,
        confirmation: { shown: Boolean(riskDialog), acknowledged: Boolean(acknowledgement), confirmed: Boolean(confirmFullAccess) },
        currentSession,
        nextSession,
        newSessionClicked: Boolean(newSessionButton),
        currentSessionSynced: /Full access|Danger Full Access|完整访问/i.test(currentSession),
        newSessionInherited: /Full access|Danger Full Access|完整访问/i.test(nextSession),
      };
    }
    if (!permissionPriority.requested) {
      generalButton?.click();
      await wait(300);
      const currentDirectories = document.querySelector('[data-taskhive-settings-directories="true"]');
      if (currentDirectories) currentDirectories.open = true;
      currentDirectories?.scrollIntoView({ block: 'start' });
      await wait(400);
      directoryState = readDirectoryState();
    }
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      dialog: { role: dialog.getAttribute('role'), ariaModal: dialog.getAttribute('aria-modal'), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      tabs,
      general: {
        presetModeVisible: /标准模式|预设模式/i.test(generalText),
        workspaceWriteVisible: /Workspace\\s+Write/i.test(generalText),
        permissionTrigger: Boolean(permissionTrigger),
        permissionOptions: [...new Set(permissionText)],
      },
      directories: directoryState,
      modelTabs,
      pluginTabs,
      permissionPriority,
      agentPresetTabVisible: tabs.some((item) => item.visible && /^Agent 预设$/i.test(item.text)),
      bodyText: String(document.body?.innerText || '').slice(-2200),
    };
  })()`, true);
  let directoryScreenshot = null;
  let directoryScreenshotError = null;
  if (!process.argv.includes('--probe-permission-priority') && native.directories?.expanded === true) {
    try {
      const image = await mainWindow.webContents.capturePage();
      directoryScreenshot = path.join('logs', 'directory-settings-ui.png');
      fs.writeFileSync(path.join(root, directoryScreenshot), image.toPNG());
    } catch (error) {
      directoryScreenshotError = error.message;
    }
  }
  const afterWindows = BrowserWindow.getAllWindows().map((win) => ({ id: win.id, title: win.getTitle(), bounds: win.getBounds(), url: win.webContents.getURL() }));
  const modelCatalogVisible = native.modelTabs?.some((item) => item.modelCatalog === true);
  const pluginInventoryVisible = native.pluginTabs?.some((item) => item.pluginInventory === true);
  const inventoryRows = native.pluginTabs?.flatMap((item) => item.inventoryRows || []) || [];
  const pluginMetadataComplete = inventoryRows.length >= 10 && inventoryRows.every((item) => item.source && item.type && item.health && /入口：/.test(item.text));
  const backgroundEntryBoundary = inventoryRows.filter((item) => item.type !== 'surface').every((item) => item.placement === null && /无侧栏界面/.test(item.text));
  const protectedBoundary = inventoryRows.filter((item) => /taskhive-surfaces|better-sidebar|dsh-genui|dsh-agent-teams|taskhive-codex-model/.test(item.id || '')).every((item) => item.disabledActions >= 2);
  const permissionModes = native.general?.permissionOptions || [];
  const permissionPriorityOk = !process.argv.includes('--probe-permission-priority') || (native.permissionPriority?.currentSessionSynced === true && native.permissionPriority?.newSessionInherited === true);
  const composerPermissionHidden = composerPermission.found === false || (composerPermission.visible === false && composerPermission.marked === true);
  const directoryLayoutOk = native.directories?.visible === true
    && native.directories?.expanded === true
    && native.directories?.count >= 8
    && native.directories?.rowCount >= 9
    && native.directories?.horizontalOverflow === false
    && native.directories?.rows?.every((row) => row.width <= (native.directories.list?.clientWidth || 0) + 1 && row.inputs.length >= (row.id === 'new' ? 4 : 3) && row.actions?.width > 0);
  const ok = native.dialog?.ariaModal === 'true' && native.general?.presetModeVisible === true && native.general?.workspaceWriteVisible === true && permissionModes.length >= 3 && composerPermissionHidden && directoryLayoutOk && modelCatalogVisible && pluginInventoryVisible && native.agentPresetTabVisible === false && pluginMetadataComplete && backgroundEntryBoundary && protectedBoundary && permissionPriorityOk && afterWindows.length === beforeWindows.length;
  const evidence = { status: ok ? 'verified' : 'failed', ok, beforeWindows, afterWindows, windowCountChanged: afterWindows.length !== beforeWindows.length, composerPermission, composerPermissionHidden, pluginMetadataComplete, backgroundEntryBoundary, protectedBoundary, directoryLayoutOk, directoryScreenshot, directoryScreenshotError, controls, clicked, native, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'native-settings-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'logs', 'directory-settings-ui-probe.json'), JSON.stringify({ ok: directoryLayoutOk && Boolean(directoryScreenshot) && !directoryScreenshotError, directoryLayoutOk, directoryScreenshot, directoryScreenshotError, directories: native.directories, dialog: native.dialog, at: evidence.at }, null, 2), 'utf8');
  if (process.argv.includes('--probe-permission-priority')) fs.writeFileSync(path.join(root, 'logs', 'permission-priority-probe.json'), JSON.stringify({ ok: permissionPriorityOk, modes: permissionModes, ...native.permissionPriority, pluginOverride: false, owner: 'Harness/DSH', at: evidence.at }, null, 2), 'utf8');
  return evidence;
}

async function probeCodesysWorkbenchProject(frame) {
  const projectPath = codesysSmokeProjectPath();
  if (!projectPath) return { ok: false, skipped: true, reason: 'smoke-project-not-configured' };
  const sha256 = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const beforeSha256 = sha256(projectPath);
  const opened = await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const button = workbench?.querySelector('[data-codesys-select-project="true"]');
    const detect = workbench?.querySelector('[data-codesys-detect-project="true"]');
    const status = workbench?.querySelector('[data-codesys-workbench-status="true"]')?.textContent || '';
    if (/正在检测|正在识别|正在绑定/.test(status)) return { clicked: false, auto: true, status };
    if (detect && !detect.disabled) { detect.click(); return { clicked: true, auto: true, status }; }
    if (button && !button.disabled) { button.click(); return { clicked: true, auto: false, status }; }
    return { clicked: false, auto: true, status };
  })()`, true);
  const loaded = await frame.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 60000;
    const check = () => {
      const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
      const status = workbench?.querySelector('[data-codesys-workbench-status="true"]')?.textContent || '';
      const sourcePath = workbench?.querySelector('[data-codesys-project-path="true"]')?.value || '';
      const objectCount = workbench?.querySelectorAll('[data-codesys-project-tree="true"] [role="treeitem"]').length || 0;
      if (/工程读取失败/.test(status) || (/已完整读取/.test(status) && sourcePath && objectCount > 0) || Date.now() >= deadline) return resolve({ status, sourcePath, objectCount, timedOut: Date.now() >= deadline });
      setTimeout(check, 100);
    };
    check();
  })`, true);
  await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const selected = workbench?.querySelector('[data-codesys-object-has-code="true"][aria-selected="true"]');
    const firstCode = workbench?.querySelector('[data-codesys-object-has-code="true"]');
    if (!selected && firstCode) firstCode.click();
    return Boolean(selected || firstCode);
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const snapshot = await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const pathInput = workbench?.querySelector('[data-codesys-project-path="true"]');
    const treeRows = [...(workbench?.querySelectorAll('[data-codesys-project-tree="true"] [role="treeitem"]') || [])].map((node) => ({
      name: node.getAttribute('data-codesys-object-name') || '',
      guid: node.getAttribute('data-codesys-object-guid') || '',
      type: node.getAttribute('data-codesys-object-type') || '',
      kind: node.getAttribute('data-node-kind') || '',
      category: node.getAttribute('data-node-category') || '',
      depth: Number(node.getAttribute('data-node-depth') || 0),
      children: Number(node.getAttribute('data-node-children') || 0),
      expanded: node.getAttribute('aria-expanded') || '',
      hasCode: node.getAttribute('data-codesys-object-has-code') === 'true',
      libraryManager: node.getAttribute('data-codesys-object-library-manager') === 'true',
      selected: node.getAttribute('aria-selected') === 'true',
      title: node.getAttribute('title') || '',
    }));
    // Group rows (device / Plc Logic / application / folder) are real treeitem
    // nodes without a project GUID, so the GUID assertions read object rows only.
    const objectItems = treeRows.filter((item) => item.guid);
    const grouped = {};
    for (const item of objectItems) (grouped[item.name] ||= []).push(item.guid);
    const duplicateNameGuidGroups = Object.fromEntries(Object.entries(grouped).filter(([, guids]) => guids.length > 1));
    const editor = workbench?.querySelector('[data-codesys-code-editor="true"]');
    // CODESYS keeps the declaration and the implementation in two independently
    // numbered edit areas; the probe reads both so the line numbers can be
    // checked against each section instead of one concatenated buffer.
    const declarationEditor = workbench?.querySelector('[data-editor-part="declaration"]');
    const implementationEditor = workbench?.querySelector('[data-editor-part="implementation"]');
    const editorSections = [...(workbench?.querySelectorAll('[data-editor-section]') || [])].map((node) => ({
      id: node.getAttribute('data-editor-section') || '',
      lines: (node.querySelector('textarea')?.value || '').split('\n').length,
      gutterLines: node.querySelectorAll('.taskhive-codesys-line-gutter span').length,
      firstGutterNumber: node.querySelector('.taskhive-codesys-line-gutter span')?.textContent || '',
      changedLines: node.getAttribute('data-section-changed-lines') || '',
    }));
    const meta = workbench?.querySelector('[data-codesys-code-diff="true"]');
    const preview = workbench?.querySelector('[data-codesys-preview-guid]');
    const copy = workbench?.querySelector('[data-codesys-copy-project-path="true"]');
    const reveal = workbench?.querySelector('[data-codesys-reveal-project="true"]');
    const api = window.__TASKHIVE_CODESYS_WORKBENCH__;
    // Exercise the pure classification/hierarchy seam on synthetic CODESYS data
    // (the same object-type GUIDs the engine reports). The rendered DOM alone
    // cannot prove the logic, and it must keep working without a real project.
    const KINDS = { device: '225bfe47-7336-4dbc-9419-4105a7c831fa', plcLogic: '40b404f9-e5dc-42c6-907f-c89f4a517386', application: '639b491f-5557-464c-af91-1471bac9f549', libraryManager: 'adb5cb65-8e1d-4a00-b70a-375ea27582f3', pou: '6f9dac99-8de1-4efc-8465-68ac443b7d08' };
    const synthetic = [
      { name: 'Device', guid: 'g-dev', type: KINDS.device },
      { name: 'Plc Logic', guid: 'g-plc', type: KINDS.plcLogic, parentGuid: 'g-dev' },
      { name: 'Application', guid: 'g-app', type: KINDS.application, parentGuid: 'g-plc', isApplication: true },
      { name: 'Library Manager', guid: 'g-lib', type: KINDS.libraryManager, parentGuid: 'g-app' },
      { name: 'PLC_PRG', guid: 'g-pou', type: KINDS.pou, parentGuid: 'g-app', hasDeclaration: true, hasImplementation: true },
    ];
    const seam = api ? {
      version: api.version,
      kinds: synthetic.map((item) => api.kindOf(item).kind),
      tree: api.buildTree(synthetic),
      codeOnly: api.filterKeys(synthetic, 'code').length,
      deviceOnly: api.filterKeys(synthetic, 'device').length,
    } : null;
    const editorValue = editor?.value || '';
    return {
      sourcePath: pathInput?.value || '',
      sourceTitle: pathInput?.getAttribute('title') || '',
      jobId: workbench?.getAttribute('data-codesys-job-id') || '',
      treeRows,
      treeKinds: [...new Set(treeRows.map((item) => item.kind).filter(Boolean))],
      treeMaxDepth: treeRows.reduce((max, item) => Math.max(max, item.depth), 0),
      treeGroups: treeRows.filter((item) => item.children > 0).length,
      treeCollapsed: treeRows.filter((item) => item.expanded === 'false').length,
      objectItems,
      duplicateNameGuidGroups,
      uniqueGuidCount: new Set(objectItems.map((item) => item.guid)).size,
      editor: { present: Boolean(editor), chars: editorValue.length, text: editorValue.slice(0, 4000), changedLines: meta?.getAttribute('data-changed-lines') || '', highlightRows: workbench?.querySelectorAll('[data-codesys-editor-highlights] .taskhive-codesys-highlight-row').length || 0, sections: editorSections, declaration: declarationEditor?.value || '', implementation: implementationEditor?.value || '' },
      hierarchy: (api && api.getState && api.getState()?.hierarchy) || null,
      seam,
      preview: { name: preview?.getAttribute('data-codesys-preview-name') || '', guid: preview?.getAttribute('data-codesys-preview-guid') || '' },
      codeText: editorValue,
      diffRows: 0,
      syntaxHighlightTokens: 0,
      status: workbench?.querySelector('[data-codesys-workbench-status="true"]')?.textContent || '',
      pathActions: { copyPresent: Boolean(copy), revealPresent: Boolean(reveal) },
      absolutePath: /^[A-Za-z]:[\\/]/.test(pathInput?.value || ''),
    };
  })()`, true);
  // Expand/collapse and the code/device filter must actually work in the DOM,
  // not merely exist as attributes.
  const treeToggle = await frame.executeJavaScript(`new Promise((resolve) => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const tree = workbench?.querySelector('[data-codesys-project-tree="true"]');
    const rows = () => [...(tree?.querySelectorAll('[role="treeitem"]') || [])];
    const group = rows().find((node) => Number(node.getAttribute('data-node-children') || 0) > 0);
    if (!tree || !group) return resolve({ ok: false, reason: 'no-group-row' });
    const before = rows().length;
    const expandedBefore = group.getAttribute('aria-expanded');
    group.querySelector('[data-twisty]')?.click();
    setTimeout(() => {
      const after = rows().length;
      const expandedAfter = group.getAttribute('aria-expanded');
      group.querySelector('[data-twisty]')?.click();
      setTimeout(() => resolve({ ok: expandedBefore !== expandedAfter && after !== before && rows().length === before, group: group.getAttribute('data-codesys-object-name') || '', before, after, restored: rows().length, expandedBefore, expandedAfter }), 150);
    }, 150);
  })`, true);
  const treeFilterProbe = await frame.executeJavaScript(`new Promise((resolve) => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    const tree = workbench?.querySelector('[data-codesys-project-tree="true"]');
    const codeButton = workbench?.querySelector('[data-codesys-tree-filter="code"]');
    const allButton = workbench?.querySelector('[data-codesys-tree-filter="all"]');
    const rows = () => [...(tree?.querySelectorAll('[role="treeitem"]') || [])];
    if (!tree || !codeButton || !allButton) return resolve({ ok: false, reason: 'no-filter-controls' });
    const codeBefore = rows().filter((node) => node.getAttribute('data-node-category') === 'code').length;
    const allBefore = rows().length;
    codeButton.click();
    setTimeout(() => {
      const codeAfter = rows().filter((node) => node.getAttribute('data-node-category') === 'code').length;
      const allAfter = rows().length;
      window.__TASKHIVE_TREE_FILTER_EVIDENCE__ = { codeBefore, codeAfter, allBefore, allAfter };
      allButton.click();
      setTimeout(() => resolve({ ok: codeBefore > 0 && codeAfter === codeBefore && allAfter > 0 && allAfter < allBefore && rows().length === allBefore, codeBefore, codeAfter, allBefore, allAfter, restored: rows().length === allBefore }), 150);
    }, 150);
  })`, true);
  // T097: 「复制当前工程绝对路径」与「在资源管理器定位当前工程」已按用户要求移除，所以这里
  // 不再点它们，而是**断言它们不存在**（被重新加回来会立刻让探针失败）。路径本身仍在
  // 只读输入框里可选中复制，所以同时断言那个输入框还在。
  const pathRemoval = await frame.executeJavaScript(`(() => {
    const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
    return {
      copyPresent: Boolean(workbench?.querySelector('[data-codesys-copy-project-path="true"]')),
      revealPresent: Boolean(workbench?.querySelector('[data-codesys-reveal-project="true"]')),
      pathInputReadable: Boolean(workbench?.querySelector('[data-codesys-project-path="true"]')),
    };
  })()`, true);
  const pathRemovalVerified = pathRemoval.copyPresent === false && pathRemoval.revealPresent === false && pathRemoval.pathInputReadable === true;
  let screenshot = null;
  let screenshotError = null;
  try {
    screenshot = path.join('logs', 'codesys-workbench-project.png');
    fs.writeFileSync(path.join(root, screenshot), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) { screenshotError = String(error?.message || error); }
  const afterSha256 = sha256(projectPath);
  const jobsRoot = path.resolve(root, 'workspaces', 'codesys-scriptengine', 'jobs');
  const jobDir = path.resolve(jobsRoot, snapshot.jobId || '.');
  const relativeJob = path.relative(jobsRoot, jobDir);
  const cleanupAllowed = /^direct-[A-Za-z0-9-]+$/.test(snapshot.jobId || '') && relativeJob && !relativeJob.startsWith(`..${path.sep}`) && relativeJob !== '..' && !path.isAbsolute(relativeJob);
  let cleanedJob = false;
  if (cleanupAllowed && fs.existsSync(jobDir)) { fs.rmSync(jobDir, { recursive: true, force: true }); cleanedJob = !fs.existsSync(jobDir); }
  const expectedPath = projectPath.toLowerCase();
  const absolutePathVerified = path.isAbsolute(snapshot.sourcePath);
  const duplicateGuidVerified = Object.values(snapshot.duplicateNameGuidGroups || {}).some((guids) => guids.length >= 2 && new Set(guids.filter(Boolean)).size === guids.length);
  // The tree must be a real multi-level CODESYS tree whenever the engine could
  // report parent links; on a build whose walk found none, every object is an
  // ungrouped root and only the flat expectations apply (recorded honestly).
  const hierarchyGrouped = Number(snapshot.hierarchy?.grouped || 0);
  const treeStructureVerified = snapshot.treeKinds.length >= 2 && (hierarchyGrouped > 0 ? snapshot.treeMaxDepth >= 1 && snapshot.treeGroups >= 1 : true);
  const treeInteractionVerified = hierarchyGrouped > 0 ? (treeToggle.ok === true && treeFilterProbe.ok === true) : true;
  const seamVerified = Boolean(snapshot.seam)
    && snapshot.seam.tree.maxDepth === 3
    && snapshot.seam.tree.roots === 1
    && snapshot.seam.kinds.join(',') === 'device,plc-logic,application,library-manager,pou'
    && snapshot.seam.codeOnly === 1
    && snapshot.seam.deviceOnly === 4;
  // CODESYS numbers the declaration and the implementation independently, each
  // from line 1. The line numbers used to be continuous across one concatenated
  // textarea, so the implementation's numbering was offset by the declaration.
  const editorSections = Array.isArray(snapshot.editor.sections) ? snapshot.editor.sections : [];
  const sectionNumberingVerified = editorSections.length >= 1
    && editorSections.every((section) => section.firstGutterNumber === '1' && section.gutterLines === section.lines && section.lines >= 1);
  const evidence = {
    ok: (opened.clicked === true || opened.auto === true) && loaded.timedOut !== true && /已完整读取/.test(snapshot.status) && snapshot.sourcePath.toLowerCase() === expectedPath && snapshot.sourceTitle.toLowerCase() === expectedPath && absolutePathVerified && snapshot.objectItems.length >= 2 && snapshot.uniqueGuidCount === snapshot.objectItems.length && duplicateGuidVerified && snapshot.objectItems.some((item) => item.hasCode && item.guid) && snapshot.objectItems.some((item) => item.libraryManager) && snapshot.preview.guid && /PROGRAM\s+PLC_PRG/i.test(String(snapshot.editor.declaration || '')) && snapshot.editor.chars > 0 && sectionNumberingVerified && snapshot.editor.highlightRows >= snapshot.editor.text.split('\n').length && snapshot.pathActions.copyPresent === false && snapshot.pathActions.revealPresent === false && pathRemovalVerified && treeStructureVerified && treeInteractionVerified && seamVerified && beforeSha256 === afterSha256 && cleanedJob && Boolean(screenshot) && !screenshotError,
    projectPath, beforeSha256, afterSha256, sourceProjectModified: beforeSha256 !== afterSha256, absolutePathVerified, opened, loaded, snapshot, duplicateGuidVerified, treeStructureVerified, treeInteractionVerified, seamVerified, editorSections, sectionNumberingVerified, treeToggle, treeFilterProbe, pathRemoval, cleanup: { allowed: cleanupAllowed, cleanedJob, jobId: snapshot.jobId }, screenshot, screenshotError, at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'codesys-workbench-project-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw Object.assign(new Error('codesys-workbench-project-probe-failed'), { details: evidence });
  return evidence;
}

// T104：「点开侧栏入口是空白」以前只能靠用户发现 —— 现有探针只验证屏幕监视面板
// （#vision-status），没有任何一条验证**工作台标签**本身能不能渲染。
// 这个探针把"工作台渲染出来了吗"变成一条可执行检查，并且明确区分三种结果：
//   root 出现且有控件      → ok
//   命中崩溃兜底（T104）   → workbench-render-crash（并带上错误文本）
//   30 秒什么都没出现      → workbench-not-rendered（多半是插件 bundle 没执行）
async function probeCodesysWorkbenchRender(frame) {
  const evidence = { ok: false, at: new Date().toISOString() };
  try {
    if (!frame) throw new Error('harness frame unavailable');
    // 走插件自己的桌面→插件消息入口（和 CODESYS 面板上那颗「打开工作台」同一条路径）。
    evidence.opened = await frame.executeJavaScript(`(() => {
      if (document.querySelector('[data-taskhive-codesys-workbench="true"]')) return { already: true };
      window.postMessage({ source: 'taskhive-desktop', type: 'codesys.workbench.open' }, '*');
      return { already: false, posted: true };
    })()`, true);
    const state = await frame.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 30000;
      const read = () => {
        const crash = document.querySelector('[data-taskhive-codesys-crash="true"]');
        const root = document.querySelector('[data-taskhive-codesys-workbench="true"]');
        const controls = root ? root.querySelectorAll('[data-codesys-detect-project="true"],[data-codesys-online-login="true"],[data-codesys-project-tree="true"]').length : 0;
        return {
          crash: Boolean(crash),
          crashText: crash ? String(crash.innerText || '').slice(0, 400) : '',
          root: Boolean(root),
          controls,
          // 刚启动的实例**不应该**出现"引擎是旧版本，请重启"的告警：出现就说明
          // 界面拿不到 codesys:engine-freshness 通道（主进程与界面不匹配）。
          engineStale: Boolean(document.querySelector('[data-codesys-engine-stale]')),
          engineStaleReason: document.querySelector('[data-codesys-engine-stale]')?.getAttribute('data-codesys-engine-stale') || '',
          tabTitles: [...document.querySelectorAll('[role="tab"],button')].map((node) => String(node.innerText || '').trim()).filter((text) => /CODESYS/.test(text)).slice(0, 6),
        };
      };
      const check = () => {
        const value = read();
        if (value.crash || (value.root && value.controls > 0) || Date.now() >= deadline) {
          return resolve({ ...value, timedOut: Date.now() >= deadline && !value.crash && !(value.root && value.controls > 0) });
        }
        setTimeout(check, 150);
      };
      check();
    })`, true);
    evidence.state = state;
    evidence.ok = state.root === true && state.controls > 0 && state.crash === false && state.engineStale === false;
    if (!evidence.ok) {
      if (state.crash) evidence.reason = 'workbench-render-crash';
      else if (state.engineStale) evidence.reason = `engine-stale-warning-visible(${state.engineStaleReason})`;
      else evidence.reason = 'workbench-not-rendered';
    }
  } catch (error) {
    evidence.reason = String(error?.message || error);
  }
  try {
    fs.writeFileSync(path.join(root, 'logs', 'codesys-workbench-render-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  } catch { /* evidence write is best effort */ }
  if (!evidence.ok) throw new Error(`codesys-workbench-render-probe-failed: ${JSON.stringify(evidence)}`);
  return evidence;
}

async function exerciseTaskHiveSurface() {  let frame = null;
  for (let attempt = 0; attempt < 60 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) return { clicked: false, reason: 'dsh-frame-not-found' };
  const clicked = await frame.executeJavaScript(`(() => {
    const button = document.querySelector('[data-sidebar-plugin-id="codesys-monitor"]') || [...document.querySelectorAll('button')].find((node) => /CODESYS/i.test((node.innerText || '').trim()));
    if (!button) return false;
    button.click();
    return true;
  })()`, true);
  let surface = await openSurfaceForProbe('codesys', '#vision-status', 15000, !clicked);
  await surface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const vision = document.querySelector('#vision-status')?.textContent || ''; const script = document.querySelector('#scriptengine-status')?.textContent || ''; if (vision && script && !vision.includes('正在检查') && !script.includes('正在检查')) return resolve({vision,script}); if (Date.now() >= deadline) return resolve({vision,script}); setTimeout(check, 100); }; check(); })", true);
  const codesys = await surface.executeJavaScript(`({
    surface: Boolean(document.querySelector('#vision-status')),
    visionStatus: document.querySelector('#vision-status')?.textContent || '',
    visionReady: /ModLens.+已就绪.+codex-cli/i.test(document.querySelector('#vision-status')?.textContent || ''),
    scriptEngineStatus: document.querySelector('#scriptengine-status')?.textContent || '',
    scriptEngineReady: /ScriptEngine 可修改代码/.test(document.querySelector('#scriptengine-status')?.textContent || ''),
    scriptEngineConfigureButton: Boolean(document.querySelector('#scriptengine-configure')),
    scriptEngineRecheckButton: Boolean(document.querySelector('#scriptengine-recheck')),
    toolbar: (() => {
      const node = document.querySelector('.codesys-toolbar');
      const buttons = [...(node?.querySelectorAll('button') || [])];
      const style = node ? getComputedStyle(node) : null;
      const rows = buttons.map((item) => Math.round(item.getBoundingClientRect().y));
       return {
         ids: buttons.map((item) => item.id),
         text: buttons.map((item) => item.textContent.trim()),
         appearances: buttons.map((item) => ({ id: item.id, backgroundColor: getComputedStyle(item).backgroundColor, color: getComputedStyle(item).color })),
         blackFilledButtonIds: buttons.filter((item) => { const color = getComputedStyle(item).backgroundColor; const values = color.slice(color.indexOf('(') + 1, color.lastIndexOf(')')).split(',').map(Number); return values.length >= 3 && Number(values[3] ?? 1) > 0 && Math.max(values[0], values[1], values[2]) < 40; }).map((item) => item.id),
         oneRow: rows.length > 0 && new Set(rows).size === 1,
        fontFamily: style?.fontFamily || '',
        height: Math.round(node?.getBoundingClientRect().height || 0),
        groups: node?.querySelectorAll('.codesys-toolbar-group').length || 0,
      };
    })(),
    approvedInput: {
      clickButton: !document.querySelector('#approve-click'),
      clickDisabledByDefault: !document.querySelector('#approve-click'),
      aiToggle: Boolean(document.querySelector('#codesys-ai-toggle')),
      aiEnabledByDefault: document.querySelector('#codesys-ai-toggle')?.getAttribute('aria-pressed') === 'true',
      previewKeyboardFocus: document.querySelector('#stream-result .preview')?.getAttribute('tabindex') === '0' || !document.querySelector('#stream-result .preview'),
      safeKeys: [...document.querySelectorAll('[data-safe-key]')].map((node) => node.getAttribute('data-safe-key')),
      status: document.querySelector('#input-status')?.textContent || '',
      executionRequestedBySmoke: false
    },
    codeAi: {
      toolbarEntry: Boolean(document.querySelector('#codesys-workbench')),
      formRemoved: !document.querySelector('#codesys-ai-form'),
      inputRemoved: !document.querySelector('#codesys-ai-input'),
    },
    externalProgram: {
      buttonText: document.querySelector('#open-codesys-program')?.textContent?.trim() || '',
      title: document.querySelector('#open-codesys-program')?.getAttribute('title') || '',
      nativeToggleRemoved: !document.querySelector('#codesys-native-toggle'),
      windowSelector: Boolean(document.querySelector('#window-list')),
      options: [...(document.querySelector('#window-list')?.options || [])].map((option) => String(option.textContent || '').trim()),
    },
    tooltipCoverage: (() => { const controls = [...document.querySelectorAll('button,select,input')].filter((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }); const missing = controls.filter((node) => !node.getAttribute('title') && !node.getAttribute('aria-label')); return { controls: controls.length, missing: missing.length }; })(),
    title: document.title,
    iframe: Boolean(document.querySelector('iframe')),
    embeddedSurface: document.documentElement.hasAttribute('data-surface-embed'),
    returnButtonRemoved: !document.querySelector('.back-to-harness')
  })`, true);
  codesys.externalProgram.lifecycle = codesysExternalProgramLifecycle;
  // The label must state the real policy: a launched instance survives surface
  // and session switches, but TaskHive closes it on exit unless the project has
  // unsaved changes.
  codesys.externalProgram.launchedProgramClosePolicyLabel = /切换插件或会话不会关闭.+退出 TaskHive 时会自动关闭.+未保存改动时保留/.test(codesys.externalProgram.title);
  if (!codesys.externalProgram.launchedProgramClosePolicyLabel) throw Object.assign(new Error('codesys-program-lifecycle-label-regression'), { details: codesys.externalProgram });
  await surface.executeJavaScript("document.querySelector('#codesys-workbench')?.click()", true);
  codesys.workbench = await frame.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 12000;
    const check = () => {
      const workbench = document.querySelector('[data-taskhive-codesys-workbench="true"]');
      if (!workbench && Date.now() < deadline) return setTimeout(check, 100);
      const rect = workbench?.getBoundingClientRect();
      const buttons = [...(workbench?.querySelectorAll('button') || [])];
      const textarea = workbench?.querySelector('textarea');
      resolve({
        visible: Boolean(workbench && rect && rect.width > 0 && rect.height > 0),
        rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        title: workbench?.querySelector('strong')?.textContent || '',
        buttons: buttons.map((node) => ({ text: String(node.textContent || '').trim(), title: node.getAttribute('title') || '', disabled: node.disabled === true, backgroundColor: getComputedStyle(node).backgroundColor, color: getComputedStyle(node).color })),
        blackFilledButtons: buttons.filter((node) => { const color = getComputedStyle(node).backgroundColor; const values = color.slice(color.indexOf('(') + 1, color.lastIndexOf(')')).split(',').map(Number); return values.length >= 3 && Number(values[3] ?? 1) > 0 && Math.max(values[0], values[1], values[2]) < 40; }).map((node) => String(node.textContent || '').trim()),
        textarea: Boolean(textarea),
        textareaLabel: textarea?.getAttribute('aria-label') || '',
        lowFrequencyButtonsRemoved: !buttons.some((node) => /(?:新建|创建).*(?:POU|GVL|DUT)|XML|隔离副本/.test(String(node.textContent || ''))),
        // T084: 复制 / 定位 / 回退在窄侧栏下只剩图标，textContent 为空，所以这个诊断
        // 改读 aria-label 与 title，否则它会静默漏掉这几颗按钮。（本段位于模板字符串
        // 内，禁止再嵌反引号 —— 会提前结束外层模板。）
        pathButtons: buttons.filter((node) => /选择工程|重新选择|复制|资源管理器|回退|刷新/.test(String(node.textContent || '') + ' ' + String(node.getAttribute('aria-label') || '') + ' ' + String(node.getAttribute('title') || ''))).map((node) => String(node.getAttribute('aria-label') || node.textContent || '').trim()),
      });
    };
    check();
  })`, true);
  codesys.workbench.centralSurfaceStillAttached = pluginSurfaceAttached && pluginSurfaceKind === 'codesys';
  codesys.workbench.centralBounds = pluginSurfaceBounds;
  codesys.workbench.rightSidebarPreserved = Boolean(codesys.workbench.visible && pluginSurfaceBounds && pluginSurfaceBounds.x + pluginSurfaceBounds.width <= codesys.workbench.rect.x + 2);
  codesys.workbench.noBlackButtons = codesys.toolbar.blackFilledButtonIds.length === 0 && codesys.workbench.blackFilledButtons.length === 0;
  if (!codesys.workbench.noBlackButtons) throw Object.assign(new Error('codesys-black-button-style-regression'), { details: { toolbar: codesys.toolbar.blackFilledButtonIds, workbench: codesys.workbench.blackFilledButtons } });
  fs.writeFileSync(path.join(root, 'logs', 'workspace-geometry-probe.json'), JSON.stringify({
    ok: codesys.workbench.visible && codesys.workbench.centralSurfaceStillAttached && codesys.workbench.rightSidebarPreserved,
    central: { kind: pluginSurfaceKind, attached: pluginSurfaceAttached, bounds: pluginSurfaceBounds },
    rightSidebar: codesys.workbench,
    at: new Date().toISOString(),
  }, null, 2), 'utf8');
  if (codesysSmokeProjectPath()) codesys.workbench.projectProbe = await probeCodesysWorkbenchProject(frame);
  const codeAiRequest = await surface.executeJavaScript("window.taskhive.requestCodesysCodeAi({ prompt: '仅创建验收隔离作业，不打开或修改当前工程' })", true);
  const generatedJobRoot = path.resolve(root, 'workspaces', 'codesys-scriptengine', String(codeAiRequest.jobId || ''));
  const allowedJobRoot = path.resolve(root, 'workspaces', 'codesys-scriptengine') + path.sep;
  const requestPath = path.join(generatedJobRoot, 'request.json');
  codesys.codeAi.jobProbe = {
    jobId: codeAiRequest.jobId,
    state: codeAiRequest.state,
    sourceProjectModified: codeAiRequest.sourceProjectModified,
    requestWritten: generatedJobRoot.startsWith(allowedJobRoot) && fs.existsSync(requestPath),
    workspaceVisibleEvent: Boolean(codeAiRequest.workspace?.surface === 'codesys-workbench' && codeAiRequest.review?.writesSourceProjectAfterConfirmation === true),
    remainsInCodesysWorkbench: codeAiRequest.workspace?.surface === 'codesys-workbench',
  };
  await new Promise((resolve) => setTimeout(resolve, 500));
  codesys.codeAi.jobProbe.harnessWorkspaceVisible = await frame.executeJavaScript(`(() => {
    const id = ${JSON.stringify(codeAiRequest.jobId)};
    const values = [...document.querySelectorAll('textarea,input,[contenteditable="true"]')].map((node) => String(node.value || node.textContent || node.innerText || ''));
    return values.some((value) => value.includes(id)) || String(document.body?.innerText || '').includes(id);
  })()`, true).catch(() => false);
  codesys.codeAi.jobProbe.bridgeSeen = await frame.executeJavaScript(`(() => ({ seen: Boolean(window.__TASKHIVE_LAST_CODESYS_TASK__), id: window.__TASKHIVE_LAST_CODESYS_TASK__?.jobId || '', error: window.__TASKHIVE_LAST_CODESYS_TASK_ERROR__ || '' }))()`, true).catch((error) => ({ seen: false, error: String(error.message || error) }));
  if (generatedJobRoot.startsWith(allowedJobRoot) && fs.existsSync(requestPath)) fs.rmSync(generatedJobRoot, { recursive: true, force: true });
  if (process.argv.includes('--smoke-codesys-stream')) {
    await showPluginSurface('codesys');
    await new Promise((resolve) => setTimeout(resolve, 250));
    surface = await openSurfaceForProbe('codesys', '#vision-status', 15000, false);
  }
  codesys.host = { attached: pluginSurfaceAttached, kind: pluginSurfaceKind, bounds: pluginSurfaceBounds };
  if (process.argv.includes('--smoke-codesys-stream')) {
    codesys.streamProbe = await probeCodesysStreamSurface(surface);
    if (codesys.streamProbe.ok !== true) throw Object.assign(new Error('codesys-stream-probe-failed'), { details: codesys.streamProbe });
  }
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  for (let attempt = 0; attempt < 30 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const returned = !pluginSurfaceAttached;
  const branding = await probeTaskHiveBranding(frame);
  await showPluginSurface('knowledge');
  const settingsOrigin = { kind: pluginSurfaceKind, attached: pluginSurfaceAttached };
  const settingsClicked = await frame.executeJavaScript(`(() => { const nodes = [...document.querySelectorAll('button,[role="button"],a')]; const node = nodes.find((item) => item.getAttribute('aria-haspopup') === 'dialog') || nodes.find((item) => /^(settings|设置)$/i.test((item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim())); if (!node) return false; node.click(); return true; })()`, true);
  await frame.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { if (document.querySelector('[role=\\\"dialog\\\"],[aria-modal=\\\"true\\\"]')) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
  for (let attempt = 0; attempt < 30 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const settings = await frame.executeJavaScript(`(() => {
    const rectOf = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), centerX: Math.round(r.x + r.width / 2) }; };
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
    const nodes = [...document.querySelectorAll('button,[role="button"],a')];
    const settingsButton = nodes.find((item) => item.getAttribute('aria-haspopup') === 'dialog') || nodes.find((item) => /^(settings|设置)$/i.test((item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim()));
    const settingsIcon = settingsButton?.querySelector('svg,img,[data-icon]');
    const pluginIcons = [...document.querySelectorAll('[data-taskhive-plugin-icon]')];
    const settingsRect = rectOf(settingsButton); const settingsIconRect = rectOf(settingsIcon); const pluginRects = pluginIcons.map(rectOf).filter(Boolean);
    return { ready: Boolean(dialog), clicked: ${settingsClicked ? 'true' : 'false'}, dialog: rectOf(dialog), settingsRect, settingsIconRect, pluginRects, sameColumn: Boolean(settingsIconRect && pluginRects.length && pluginRects.every((rect) => Math.abs(rect.centerX - settingsIconRect.centerX) <= 3)), presetModeVisible: /标准模式|预设模式|Agent 预设/i.test(String(dialog?.innerText || '')), workspaceWriteInDialog: /Workspace\\s+Write/i.test(String(dialog?.innerText || '')), directories: document.querySelector('[data-taskhive-settings-directories="true"]')?.querySelectorAll('code').length || 0, sidebarPluginManager: Boolean(document.querySelector('[data-sidebar-plugin-id="plugin-manager"]')) };
  })()`, true);
  settings.origin = settingsOrigin;
  settings.childViewSuspended = pluginSurfaceAttached === false;
  settings.closeAttempt = await frame.executeJavaScript(`(() => {
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
    if (!dialog) return { dialogFound: false, clicked: false };
    const buttons = [...dialog.querySelectorAll('button')];
    const exact = (node) => [node.innerText,node.getAttribute('aria-label'),node.getAttribute('title')].some((value) => /^(关闭设置|关闭|close settings|close)$/i.test(String(value || '').trim()));
    const close = buttons.find(exact);
    if (close) { const result = { dialogFound: true, clicked: true, text: String(close.innerText || '').trim(), aria: close.getAttribute('aria-label') || '', title: close.getAttribute('title') || '' }; close.click(); return result; }
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
    return { dialogFound: true, clicked: false, escape: true };
  })()`, true);
  const dialogClosed = await frame.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 5000; const check = () => { const dialog = document.querySelector('[role=\"dialog\"],[aria-modal=\"true\"]'); if (!dialog || dialog.getBoundingClientRect().width === 0) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
  settings.dialogClosed = dialogClosed;
  for (let attempt = 0; attempt < 40 && !pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  settings.restoredSurface = pluginSurfaceAttached === true && pluginSurfaceKind === 'knowledge';
  const workspaceClicked = await frame.executeJavaScript(`(() => { const node = [...document.querySelectorAll('button,[role="button"]')].find((item) => /工作区/.test(String(item.getAttribute('aria-label') || item.innerText || '')) && !item.closest('[role="dialog"]') && !item.closest('[data-taskhive-sidebar-plugins]')); if (!node) return false; node.click(); return true; })()`, true);
  for (let attempt = 0; attempt < 40 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  settings.workspaceClicked = workspaceClicked;
  settings.workspaceReturnsChat = workspaceClicked && pluginSurfaceAttached === false;
  settings.sessionSwitch = await frame.executeJavaScript(`(() => {
      const candidates = [...document.querySelectorAll('button,[role="button"],a')].filter((node) => {
      if (node.closest('[role="dialog"],[data-taskhive-sidebar-plugins]')) return false;
      const text = String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
      return Boolean(node.matches('[data-session-id],[data-testid*="session"],[data-workspace-session]')) || /^(新会话|会话|session|workspace)/i.test(text);
      });
    const candidateLabels = candidates.map((item) => String(item.innerText || item.getAttribute('aria-label') || item.getAttribute('title') || '').trim());
    const node = candidates.find((item) => { const text = String(item.innerText || item.getAttribute('aria-label') || '').trim(); return !/^(新会话|添加工作区|设置|settings|Workspace Write)$/i.test(text); }) || candidates.find((item) => !/^Workspace Write$/i.test(String(item.innerText || '').trim())) || candidates[0];
    if (!node) return { clicked: false, candidates: candidates.length };
    node.click();
    return { clicked: true, candidates: candidates.length, candidateLabels, label: String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim() };
  })()`, true).catch(() => ({ clicked: false, candidates: 0 }));
  for (let attempt = 0; attempt < 40 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  settings.sessionSwitch.returnsChat = settings.sessionSwitch.clicked && pluginSurfaceAttached === false;
  const evidence = { clicked, codesys, returned, branding, settings, menuBarVisible: mainWindow.isMenuBarVisible(), mainUrl: mainWindow.webContents.getURL(), pluginSurfaceAttached, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'ui-surface-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeHistorySessionSwitch(frame) {
  if (process.argv.includes('--smoke-codesys-fixture')) await showPluginSurface('codesys');
  const codesysLifecycleBefore = codesysFixtureLifecycleSnapshot('codesys-visible-before-switches');
  const created = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const api = window.__TASKHIVE_SESSION_PROBE__;
    if (!api?.create || !api?.makeHistorical || !api?.snapshot) return { ok: false, reason: 'session-probe-unavailable' };
    const before = api.snapshot();
    const currentId = String(before?.sessions?.current || '');
    if (!currentId) return { ok: false, reason: 'current-session-unavailable', before };
    const historical = (before?.sessions?.ids || []).find((id) => before?.sessions?.byId?.[id]?.blank === false);
    if (historical) {
      let activeId = currentId;
      if (historical === activeId) {
        const alternate = (before?.sessions?.ids || []).find((id) => id !== historical);
        if (alternate) { api.open(alternate); activeId = alternate; await wait(500); }
      }
      if (historical !== activeId) return { ok: true, reusedHistorical: true, before, targetId: historical, next: { sessionId: activeId }, afterCreate: api.snapshot() };
    }
    const targetId = currentId;
    const seeded = await api.makeHistorical(targetId, 'TASKHIVE_HISTORY_SWITCH_PROBE: create one cancellable isolated history row.');
    for (let attempt = 0; attempt < 50 && api.snapshot()?.sessions?.byId?.[targetId]?.blank !== false; attempt += 1) await wait(100);
    const next = await api.create();
    await wait(900);
    return { ok: true, reusedHistorical: false, before, targetId, seeded, next, afterCreate: api.snapshot() };
  })()`, true).catch((error) => ({ ok: false, reason: String(error?.message || error) }));

  await showPluginSurface('knowledge');
  const codesysLifecycleAfterPluginSwitch = codesysFixtureLifecycleSnapshot('after-plugin-switch');
  const targetId = String(created?.targetId || '');
  const currentBeforeClick = String(created?.afterCreate?.sessions?.current || '');
  const clicked = await frame.executeJavaScript(`(() => {
    const api = window.__TASKHIVE_SESSION_PROBE__;
    const sidebar = document.querySelector('[data-pane="sidebar"],[class*="sidebarCol"]') || document.body;
    const visible = (node) => { const rect = node.getBoundingClientRect?.(); const style = getComputedStyle(node); return rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const nodes = [...sidebar.querySelectorAll('[data-session-id],[data-workspace-session],[role="treeitem"],button,a,[role="button"]')].filter(visible);
    const rows = nodes.map((node, index) => ({
      index,
      text: String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim(),
      ariaCurrent: node.getAttribute('aria-current'),
      ariaSelected: node.getAttribute('aria-selected'),
      sessionId: node.getAttribute('data-session-id') || node.getAttribute('data-workspace-session') || '',
      title: node.getAttribute('title') || '',
      html: node.outerHTML.slice(0, 900),
    }));
    const targetId = ${JSON.stringify(targetId)};
    let node = nodes.find((candidate) => targetId && candidate.outerHTML.includes(targetId));
    if (!node) node = nodes.find((candidate) => {
      const text = String(candidate.innerText || candidate.getAttribute('aria-label') || candidate.getAttribute('title') || '').trim();
      const current = candidate.getAttribute('aria-current') === 'page' || candidate.getAttribute('aria-current') === 'true' || candidate.getAttribute('aria-selected') === 'true';
      const labels = [text, candidate.getAttribute('aria-label'), candidate.getAttribute('title'), candidate.className].join(' ');
      const sessionRow = /sessionRow/i.test(String(candidate.className || '')) || (candidate.matches('[role="treeitem"]') && candidate.getAttribute('aria-expanded') === null);
      if (sessionRow) return !current;
      const control = /newSession|新建会话|添加工作区|搜索会话|视图选项|工作区.*操作|设置|CODESYS|浏览器|知识库|专家|TaskHive/i.test(labels);
      return !current && !control && /session/i.test(labels);
    });
    if (!node) return { clicked: false, rows, before: api?.snapshot?.() || null };
    const chosen = rows[nodes.indexOf(node)];
    node.click();
    return { clicked: true, chosen, rows, before: api?.snapshot?.() || null };
  })()`, true).catch((error) => ({ clicked: false, error: String(error?.message || error), rows: [] }));
  for (let attempt = 0; attempt < 50 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await frame.executeJavaScript(`(() => ({ snapshot: window.__TASKHIVE_SESSION_PROBE__?.snapshot?.() || null, bodyText: String(document.body?.innerText || '').slice(0, 1400) }))()`, true);
  const codesysLifecycleAfterSessionSwitch = codesysFixtureLifecycleSnapshot('after-session-switch');
  const pluginSurfaceDetachedAfterSessionSwitch = pluginSurfaceAttached === false;
  if (process.argv.includes('--smoke-codesys-fixture')) await showPluginSurface('codesys');
  const codesysLifecycleAfterReturn = codesysFixtureLifecycleSnapshot('after-return-to-codesys');
  const returnedToCodesys = pluginSurfaceAttached === true && pluginSurfaceKind === 'codesys';
  const currentAfterClick = String(after?.snapshot?.sessions?.current || '');
  const evidence = {
    ok: created.ok === true && clicked.clicked === true && pluginSurfaceDetachedAfterSessionSwitch && currentAfterClick && currentAfterClick !== currentBeforeClick && (!targetId || currentAfterClick === targetId),
    created,
    clicked,
    targetId,
    currentBeforeClick,
    currentAfterClick,
    pluginSurfaceDetached: pluginSurfaceDetachedAfterSessionSwitch,
    targetConversationVisible: currentAfterClick === targetId,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'history-session-switch-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (process.argv.includes('--smoke-codesys-fixture')) {
    const lifecycleEvidence = {
      ok: evidence.ok === true
        && returnedToCodesys
        && codesysLifecycleBefore.windows.length >= 2
        && codesysLifecycleBefore.windows.every((item) => Boolean(item.nativeHandle) && item.destroyed === false)
        && codesysFixtureIdentityStable(codesysLifecycleBefore, codesysLifecycleAfterPluginSwitch)
        && codesysFixtureIdentityStable(codesysLifecycleBefore, codesysLifecycleAfterSessionSwitch)
        && codesysFixtureIdentityStable(codesysLifecycleBefore, codesysLifecycleAfterReturn),
      contract: codesysExternalProgramLifecycle,
      before: codesysLifecycleBefore,
      afterPluginSwitch: codesysLifecycleAfterPluginSwitch,
      afterSessionSwitch: codesysLifecycleAfterSessionSwitch,
      afterReturnToCodesys: codesysLifecycleAfterReturn,
      pluginSwitchVerified: true,
      sessionSwitchVerified: evidence.ok === true,
      returnedToCodesys,
      closeOperationsRequested: 0,
      at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(root, 'logs', 'codesys-program-lifecycle-probe.json'), JSON.stringify(lifecycleEvidence, null, 2), 'utf8');
    if (!lifecycleEvidence.ok) throw Object.assign(new Error('codesys-program-lifecycle-probe-failed'), { details: lifecycleEvidence });
  }
  return evidence;
}

async function probeSessionDeletion(frame) {
  const setup = await frame.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const api = window.__TASKHIVE_SESSION_PROBE__;
    if (!api?.snapshot || !api?.create || !api?.makeHistorical || !api?.rename || !api?.archive) return { ok: false, reason: 'session-probe-unavailable' };
    const before = api.snapshot();
    const targetId = String(before?.sessions?.current || '');
    if (!targetId) return { ok: false, reason: 'current-session-unavailable', before };
    if (before?.sessions?.byId?.[targetId]?.blank !== false) await api.makeHistorical(targetId, 'TASKHIVE_DELETE_SESSION_PROBE: disposable isolated session.');
    for (let attempt = 0; attempt < 50 && api.snapshot()?.sessions?.byId?.[targetId]?.blank !== false; attempt += 1) await wait(100);
    const targetTitle = 'TASKHIVE_ARCHIVE_' + targetId.slice(-8);
    await api.rename(targetId, targetTitle);
    const next = await api.create();
    for (let attempt = 0; attempt < 50 && String(api.snapshot()?.sessions?.current || '') === targetId; attempt += 1) await wait(100);
    const nextId = String(api.snapshot()?.sessions?.current || next || '');
    if (nextId && api.makeHistorical) {
      await api.makeHistorical(nextId, 'TASKHIVE_DELETE_SESSION_PROBE: current session protection marker.');
      for (let attempt = 0; attempt < 50 && api.snapshot()?.sessions?.byId?.[nextId]?.blank !== false; attempt += 1) await wait(100);
    }
    // The previous history-switch probe may still be completing its synthetic
    // turn. Product code correctly hides deletion for a running session, so
    // the smoke must wait for that target to settle instead of weakening the
    // runtime protection or racing the menu.
    for (let attempt = 0; attempt < 150 && api.snapshot()?.sessions?.byId?.[targetId]?.running === true; attempt += 1) await wait(100);
    const afterCreate = api.snapshot();
    const targetReady = afterCreate?.sessions?.byId?.[targetId]?.running !== true;
    return { ok: targetReady, targetReady, targetId, targetTitle, next, before, afterCreate };
  })()`, true).catch((error) => ({ ok: false, reason: String(error?.message || error) }));
  const targetId = String(setup?.targetId || '');
  const targetTitle = String(setup?.targetTitle || '');
  const currentId = String(setup?.afterCreate?.sessions?.current || '');
  const sessionList = await frame.executeJavaScript(`new Promise((resolve) => {
    const visible = (node) => { const rect = node?.getBoundingClientRect?.(); const style = node ? getComputedStyle(node) : null; return Boolean(rect && style && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'); };
    // DSH alpha.2 session rows are divs with a hashed sessionRow class rather
    // than ARIA tree items. Keep this scoped to concrete session-row markers
    // so CODESYS project tree rows cannot satisfy the archive probe.
    const findRows = () => [...document.querySelectorAll('[data-session-id],[data-workspace-session],[class*="sessionRow"]')].filter(visible);
    const expand = [...document.querySelectorAll('button,[role="button"]')].find((node) => {
      const rect = node.getBoundingClientRect();
      const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || '').trim();
      return rect.x < 340 && rect.y < 180 && /打开.*侧边栏|展开.*侧边栏|expand.*sidebar/i.test(label);
    });
    const before = findRows().length;
    if (before === 0) expand?.click();
    const deadline = Date.now() + 8000;
    const check = () => {
      const rows = findRows();
      const row = rows.find((node) => String(node.textContent || '').includes(${JSON.stringify(targetTitle)}));
      if (row || Date.now() >= deadline) resolve({ before, expanded: Boolean(expand), rows: rows.length, targetRowFound: Boolean(row), selector: '[data-session-id],[data-workspace-session],[class*="sessionRow"]' });
      else setTimeout(check, 100);
    };
    check();
  })`, true).catch((error) => ({ before: 0, expanded: false, rows: 0, targetRowFound: false, error: String(error?.message || error) }));
  const archiveRequest = await frame.executeJavaScript(`(async () => {
    const api = window.__TASKHIVE_SESSION_PROBE__;
    const targetId = ${JSON.stringify(targetId)};
    const targetTitle = ${JSON.stringify(targetTitle)};
    const row = [...document.querySelectorAll('[data-session-id],[data-workspace-session],[class*="sessionRow"]')].find((node) => String(node.textContent || '').includes(targetTitle));
    if (!row) return { requested: false, rowFound: false, reason: 'target-row-not-found' };
    await api.archive(targetId);
    return { requested: true, rowFound: true, route: 'uiWorkspace.archiveSession' };
  })()`, true).catch((error) => ({ requested: false, rowFound: false, error: String(error?.message || error) }));
  let screenshot = null;
  let screenshotError = null;
  try {
    screenshot = path.join('logs', 'session-archive-menu.png');
    fs.writeFileSync(path.join(root, screenshot), (await mainWindow.webContents.capturePage()).toPNG());
  } catch (error) { screenshotError = String(error?.message || error); }
  const after = await frame.executeJavaScript(`new Promise((resolve) => {
    const targetId = ${JSON.stringify(targetId)};
    const targetTitle = ${JSON.stringify(targetTitle)};
    const deadline = Date.now() + 8000;
    const check = () => {
      const row = [...document.querySelectorAll('[data-session-id],[data-workspace-session],[class*="sessionRow"]')].find((node) => String(node.textContent || '').includes(targetTitle));
      const snapshot = window.__TASKHIVE_SESSION_PROBE__?.snapshot?.() || null;
      const archived = Boolean(snapshot?.workspaces?.archivedSessionIds?.includes(targetId));
      if ((!row && archived) || Date.now() >= deadline) return resolve({ rowHidden: !row, archived, snapshot });
      setTimeout(check, 100);
    };
    check();
  })`, true).catch((error) => ({ rowHidden: false, archived: false, error: String(error?.message || error) }));
  const evidence = {
    // Alpha.2 retains archived sessions in the controller's accounting index.
    // The product contract is the archive-set echo plus removal from visible rows.
    ok: setup.ok === true && targetId && targetTitle && currentId && targetId !== currentId && sessionList.targetRowFound === true && archiveRequest.requested === true && after.rowHidden === true && after.archived === true && String(after?.snapshot?.sessions?.current || '') === currentId && Boolean(screenshot) && !screenshotError,
    setup, sessionList, archiveRequest, after, screenshot, screenshotError, at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'session-delete-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw Object.assign(new Error('session-delete-probe-failed'), { details: evidence });
  return evidence;
}

async function probePluginRightSidebar(frame) {
  const cases = [
    ['codesys', 'codesys-monitor', '#vision-status'],
    ['web-ai', 'web-ai', '#web-ai-address'],
    ['knowledge', 'knowledge-base', '#knowledge-category-grid'],
    ['experts', 'experts', '#expert-model-new'],
  ];
  const results = [];
  for (const [kind, pluginId, marker] of cases) {
    await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
    for (let attempt = 0; attempt < 30 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await frame.executeJavaScript(`(() => {
      if (!document.body.hasAttribute('data-dsh-sidebar-collapsed')) {
        const toggle = [...document.querySelectorAll('button,[role="button"]')].filter((node) => /收起侧边栏|折叠侧边栏|collapse\\s+(?:right\\s+)?sidebar/i.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
        toggle?.click();
      }
    })()`, true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const click = await frame.executeJavaScript(`(() => {
      const button = document.querySelector('[data-sidebar-plugin-id=${JSON.stringify(pluginId)}]');
      if (!button) return { clicked: false };
      button.click();
      return { clicked: true, text: String(button.innerText || '').trim() };
    })()`, true);
    // Use the same ownership and renderer-readiness contract as the real
    // CODESYS smoke. The surface state message arrives before a cold embedded
    // renderer completes navigation, so a hand-rolled short poll is a false
    // negative for otherwise usable plugin pages.
    let surface = null;
    let surfaceReadyError = null;
    try {
      surface = await openSurfaceForProbe(kind, marker, 30000, true);
    } catch (error) {
      surfaceReadyError = String(error?.message || error);
      surface = pluginSurfaceView && !pluginSurfaceView.webContents.isDestroyed() ? pluginSurfaceView.webContents : null;
    }
    const layout = await frame.executeJavaScript(`(() => {
      const viewport = { width: innerWidth, height: innerHeight };
      const width = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width') || '0') || 0;
      const candidates = [...document.querySelectorAll('[data-pane="right-sidebar"],[class*="rightSidebar"],[data-dsh-better-sidebar] > *')].map((node) => {
        const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
        return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: style.display, visibility: style.visibility };
      }).filter((rect) => rect.width >= 180 && rect.height >= viewport.height * .45 && rect.x < viewport.width);
      const toggleNode = [...document.querySelectorAll('button,[role="button"]')].filter((node) => /收起侧边栏|折叠侧边栏|collapse\s+(?:right\s+)?sidebar/i.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
      const toggleRect = toggleNode?.getBoundingClientRect();
      const topRightControls = [...document.querySelectorAll('button,[role="button"]')].map((node) => { const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return { node, rect, style }; }).filter(({ rect, style }) => rect.width > 0 && rect.height > 0 && rect.x > viewport.width * .62 && rect.y < 90 && style.display !== 'none' && style.visibility !== 'hidden').map(({ node, rect }) => ({ x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height),text:String(node.innerText||'').trim(),ariaLabel:node.getAttribute('aria-label')||'',title:node.getAttribute('title')||'',className:String(node.className||''),html:node.outerHTML.slice(0,700) }));
      return { viewport, collapsed: document.body.hasAttribute('data-dsh-sidebar-collapsed'), declaredWidth: width, candidates, topRightControls, toggle: toggleRect ? { visible: toggleRect.width > 0 && toggleRect.height > 0, x: Math.round(toggleRect.x), y: Math.round(toggleRect.y), width: Math.round(toggleRect.width), height: Math.round(toggleRect.height), label: toggleNode.getAttribute('aria-label') || toggleNode.getAttribute('title') || '' } : null };
    })()`, true);
    const interactive = surface ? await surface.executeJavaScript(`(() => ({ marker: Boolean(document.querySelector(${JSON.stringify(marker)})), controls: [...document.querySelectorAll('button,input,textarea,select')].filter((node) => { const rect=node.getBoundingClientRect(); return rect.width>0&&rect.height>0&&!node.disabled; }).length }))()`, true).catch(() => ({ marker: false, controls: 0 })) : { marker: false, controls: 0 };
    const bounds = pluginSurfaceBounds ? { ...pluginSurfaceBounds } : null;
    const rawGeometry = lastSurfaceGeometry ? { ...lastSurfaceGeometry } : null;
    const shellUi = await frame.executeJavaScript(`new Promise((resolve) => {
      const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
      const rectOf = (node) => { if (!node) return null; const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right), bottom: Math.round(rect.bottom) }; };
      const panel = document.querySelector('[data-dsh-better-sidebar-panel="right"]');
      const plus = document.querySelector('[data-dsh-sidebar-new-tab]');
      const bottomToggles = [...document.querySelectorAll('[data-dsh-bottom-panel-toggle]')];
      const rightToggles = [...document.querySelectorAll('[data-dsh-right-sidebar-toggle]')];
      plus?.focus(); plus?.click();
      setTimeout(() => {
        const menu = [...document.body.children].find((node) => node.getAttribute?.('role') === 'menu' && visible(node));
        const panelRect = panel?.getBoundingClientRect(); const menuRect = menu?.getBoundingClientRect();
        resolve({
          pluginSurfaceActive: document.body.hasAttribute('data-taskhive-plugin-surface-active'),
          bottomToggleVisibleCount: bottomToggles.filter(visible).length,
          rightToggleVisibleCount: rightToggles.filter(visible).length,
          rightToggle: (() => { const node = rightToggles.find(visible); return node ? { ariaLabel: node.getAttribute('aria-label') || '', title: node.getAttribute('title') || '', rect: rectOf(node) } : null; })(),
          bottomPanelVisibleCount: [...document.querySelectorAll('[class*="bottomPanel"]')].filter(visible).length,
          panelRect: rectOf(panel),
          plusRect: rectOf(plus),
          menuRect: rectOf(menu),
          menuOpen: visible(menu),
          menuWithinPanel: Boolean(panelRect && menuRect && menuRect.left >= panelRect.left - 1 && menuRect.right <= panelRect.right + 1 && menuRect.top >= panelRect.top - 1 && menuRect.bottom <= panelRect.bottom + 1),
          menuItems: [...(menu?.querySelectorAll('[role="menuitem"],button') || [])].filter(visible).map((node) => String(node.textContent || node.getAttribute('aria-label') || '').trim()),
        });
      }, 300);
    })`, true);
    shellUi.menuNotCoveredByPlugin = Boolean(bounds && shellUi.menuRect && shellUi.menuRect.x >= bounds.x + bounds.width - 1);
    let menuScreenshot = null;
    let menuScreenshotError = null;
    try {
      menuScreenshot = path.join('logs', `plugin-right-sidebar-menu-${kind}.png`);
      fs.writeFileSync(path.join(root, menuScreenshot), (await mainWindow.webContents.capturePage()).toPNG());
    } catch (error) { menuScreenshotError = String(error?.message || error); }
    await frame.executeJavaScript("{const target=document.activeElement||document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));target.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowDown',code:'ArrowDown',bubbles:true}));}", true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    shellUi.keyboardFocusInMenu = await frame.executeJavaScript(`(() => Boolean(document.activeElement?.closest?.('[role="menu"]')))()`, true).catch(() => false);
    await frame.executeJavaScript("{const target=document.activeElement||document.body;target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));target.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',bubbles:true}));}", true);
    await new Promise((resolve) => setTimeout(resolve, 180));
    shellUi.escapeClosed = await frame.executeJavaScript(`(() => ![...document.body.children].some((node) => { if (node.getAttribute?.('role') !== 'menu') return false; const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden'; }))()`, true).catch(() => false);
    shellUi.menuScreenshot = menuScreenshot;
    shellUi.menuScreenshotError = menuScreenshotError;
    const collapseAction = await frame.executeJavaScript(`(() => { const node = [...document.querySelectorAll('button,[role="button"]')].filter((item) => /收起侧边栏|折叠侧边栏|collapse\s+(?:right\s+)?sidebar/i.test(String(item.getAttribute('aria-label') || item.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]; const rect=node?.getBoundingClientRect(); node?.click(); return { clicked:Boolean(node), rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null }; })()`, true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const collapsedBounds = pluginSurfaceBounds ? { ...pluginSurfaceBounds } : null;
    let toggleScreenshot = null;
    let toggleScreenshotError = null;
    try {
      toggleScreenshot = path.join('logs', `plugin-right-sidebar-toggle-${kind}.png`);
      fs.writeFileSync(path.join(root, toggleScreenshot), (await mainWindow.webContents.capturePage()).toPNG());
    } catch (error) {
      toggleScreenshotError = String(error?.message || error);
    }
    const expandAction = await frame.executeJavaScript(`(() => { const node = [...document.querySelectorAll('button,[role="button"]')].filter((item) => /展开侧边栏|expand\s+(?:right\s+)?sidebar/i.test(String(item.getAttribute('aria-label') || item.getAttribute('title') || ''))).sort((a,b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0]; const rect=node?.getBoundingClientRect(); const style=node?getComputedStyle(node):null; const result={clicked:Boolean(node),visible:Boolean(rect&&rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden'),label:node?.getAttribute('aria-label')||node?.getAttribute('title')||'',rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null}; node?.click(); return result; })()`, true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const restoredState = await frame.executeJavaScript(`(() => ({ collapsed: document.body.hasAttribute('data-dsh-sidebar-collapsed'), toggleVisible: [...document.querySelectorAll('button,[role="button"]')].some((node) => { const rect=node.getBoundingClientRect(); return /收起侧边栏|折叠侧边栏|collapse\s+(?:right\s+)?sidebar/i.test(String(node.getAttribute('aria-label')||node.getAttribute('title')||'')) && rect.x > innerWidth * .65 && rect.width>0 && rect.height>0; }) }))()`, true);
    const restoredBounds = pluginSurfaceBounds ? { ...pluginSurfaceBounds } : null;
    const toggleNotCovered = Boolean(collapsedBounds && expandAction.rect && collapsedBounds.x + collapsedBounds.width <= expandAction.rect.x + 1);
    const result = { kind, click, attached: pluginSurfaceAttached && pluginSurfaceKind === kind, surfaceReadyError, bounds, rawGeometry, layout, interactive, shellUi, collapseAction, collapsedBounds, toggleScreenshot, toggleScreenshotError, expandAction, restoredState, restoredBounds, toggleNotCovered };
    await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
    for (let attempt = 0; attempt < 30 && pluginSurfaceAttached; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise((resolve) => setTimeout(resolve, 180));
    result.chatRestored = await frame.executeJavaScript(`(() => { const visible=(node)=>{const r=node.getBoundingClientRect();const s=getComputedStyle(node);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'}; return { pluginSurfaceActive: document.body.hasAttribute('data-taskhive-plugin-surface-active'), bottomToggleVisibleCount:[...document.querySelectorAll('[data-dsh-bottom-panel-toggle]')].filter(visible).length }; })()`, true).catch(() => ({ pluginSurfaceActive: true, bottomToggleVisibleCount: 0 }));
    result.ok = result.click.clicked === true && result.attached === true && layout.collapsed === false && layout.declaredWidth >= 180 && layout.candidates.length > 0 && layout.toggle?.visible === true && bounds && bounds.x + bounds.width <= layout.viewport.width - layout.declaredWidth + 4 && collapseAction.clicked === true && expandAction.clicked === true && expandAction.visible === true && toggleNotCovered && Boolean(toggleScreenshot) && !toggleScreenshotError && restoredState.collapsed === false && restoredState.toggleVisible === true && interactive.marker === true && interactive.controls > 0 && shellUi.pluginSurfaceActive === true && shellUi.bottomToggleVisibleCount === 0 && shellUi.rightToggleVisibleCount === 1 && Boolean(shellUi.rightToggle?.ariaLabel && shellUi.rightToggle?.title) && shellUi.bottomPanelVisibleCount === 0 && shellUi.menuOpen === true && shellUi.menuWithinPanel === true && shellUi.menuNotCoveredByPlugin === true && shellUi.menuItems.length > 0 && shellUi.keyboardFocusInMenu === true && shellUi.escapeClosed === true && Boolean(menuScreenshot) && !menuScreenshotError && result.chatRestored.pluginSurfaceActive === false && result.chatRestored.bottomToggleVisibleCount >= 1;
    results.push(result);
  }
  const evidence = { ok: results.length === cases.length && results.every((item) => item.ok), results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'plugin-right-sidebar-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeSidebarPluginLabels(frame) {
  const snapshot = () => frame.executeJavaScript(`(() => {
    const visible = (node) => { if (!node) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const nav = document.querySelector('[data-taskhive-sidebar-plugins]');
    const rect = nav?.getBoundingClientRect();
    const labels = [...(nav?.querySelectorAll('[data-plugin-label]') || [])].map((label) => {
      const labelRect = label.getBoundingClientRect();
      return { id: label.getAttribute('data-plugin-label'), text: String(label.textContent || '').trim(), title: label.closest('button')?.getAttribute('title') || '', visible: visible(label), width: Math.round(labelRect.width), clientWidth: label.clientWidth, scrollWidth: label.scrollWidth, fullyVisible: visible(label) && label.scrollWidth <= label.clientWidth + 1 };
    });
    return { nav: rect ? { width: Math.round(rect.width), x: Math.round(rect.x), labelsVisible: nav.getAttribute('data-plugin-labels-visible') } : null, labels };
  })()`, true);
  const clickLeftSidebarControl = (mode) => frame.executeJavaScript(`(() => {
    const nav = document.querySelector('[data-taskhive-sidebar-plugins]');
    const navRect = nav?.getBoundingClientRect();
    const controls = [...document.querySelectorAll('button,[role="button"]')].map((node) => {
      const rect = node.getBoundingClientRect();
      const label = String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim();
      return { node, rect, label };
    }).filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.x < 340 && rect.y < 180);
    const pattern = ${JSON.stringify(mode)} === 'expand' ? /expand|展开.*侧|打开.*侧/i : /collapse|收起.*侧|折叠.*侧/i;
    const candidates = controls.filter(({ label }) => pattern.test(label));
    const chosen = candidates.sort((a, b) => {
      const aDistance = navRect ? Math.abs(a.rect.x - navRect.x) : a.rect.x;
      const bDistance = navRect ? Math.abs(b.rect.x - navRect.x) : b.rect.x;
      return aDistance - bDistance || a.rect.y - b.rect.y;
    })[0];
    chosen?.node.click();
    return {
      clicked: Boolean(chosen),
      label: chosen?.label || '',
      rect: chosen ? { x: Math.round(chosen.rect.x), y: Math.round(chosen.rect.y), width: Math.round(chosen.rect.width), height: Math.round(chosen.rect.height) } : null,
      candidates: candidates.map(({ rect, label }) => ({ label, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) })),
    };
  })()`, true);
  const waitForNavWidth = async (predicate, attempts = 20) => {
    let value = await snapshot();
    for (let attempt = 0; attempt < attempts && !predicate(value.nav?.width || 0); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      value = await snapshot();
    }
    return value;
  };
  const initial = await snapshot();
  let layoutDebug = null;
  try {
    layoutDebug = await frame.executeJavaScript(`(() => {
      const nav = document.querySelector('[data-taskhive-sidebar-plugins]');
      const chain = [];
      let node = nav;
      for (let index = 0; node && index < 6; index += 1, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        chain.push({ tag: node.tagName, id: node.id, className: String(node.className || ''), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, display: style.display, position: style.position, overflow: style.overflow, data: [...node.attributes].filter((item) => item.name.startsWith('data-')).map((item) => [item.name, item.value]) });
      }
      return { body: { className: document.body.className, collapsed: document.body.hasAttribute('data-dsh-sidebar-collapsed') }, chain };
    })()`, true);
  } catch {}
  const expandedBy = initial.nav?.width >= 96 ? { clicked: false, alreadyExpanded: true } : await clickLeftSidebarControl('expand');
  const wide = await waitForNavWidth((width) => width >= 96);
  const collapsedBy = { clicked: false, skipped: true, reason: 'isolated-recovery-probe' };
  const narrow = { nav: null, labels: [], skipped: true };
  const restoredBy = { clicked: false, skipped: true, reason: 'isolated-recovery-probe' };
  const restored = wide;
  let screenshot = null;
  let screenshotError = null;
  try { screenshot = path.join('logs', 'sidebar-plugin-labels.png'); fs.writeFileSync(path.join(root, screenshot), (await mainWindow.webContents.capturePage()).toPNG()); } catch (error) { screenshotError = error.message; }
  // 期望的侧栏文案从 plugins/catalog.json 读，而不是硬编码 —— T102 把插件改名为
  // 「CODESYS 工作台」时，正是这行硬编码的 'CODESYS' 让整条 smoke 变红。
  const codesysExpectedLabel = (() => {
    try {
      const catalog = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'catalog.json'), 'utf8'));
      return String(catalog.plugins?.['codesys-monitor']?.name || 'CODESYS');
    } catch { return 'CODESYS'; }
  })();
  const codesys = wide.labels.find((item) => item.id === 'codesys-monitor' || item.text === codesysExpectedLabel);
  const ok = wide.nav?.width >= 96 && (expandedBy.alreadyExpanded === true || expandedBy.clicked === true) && wide.labels.length >= 4 && wide.labels.every((item) => item.text && item.title === item.text && item.fullyVisible) && codesys?.text === codesysExpectedLabel && codesys.fullyVisible === true && restored.labels.every((item) => item.fullyVisible);
  const evidence = { ok, expectedCodesysLabel: codesysExpectedLabel, initial, expandedBy, layoutDebug, wide, collapsedBy, narrow, restoredBy, restored, screenshot, screenshotError, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'sidebar-plugin-labels-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!ok) throw new Error('sidebar-plugin-labels-probe-failed');
  return evidence;
}

async function probeCodesysNativeHost(surface) {
  const deadline = Date.now() + 15000;
  let fixture = null;
  while (!fixture && Date.now() < deadline) {
    fixture = (await monitor.listWindows()).find((item) => item.fixture === true && /TaskHive Media Fixture/.test(item.title || ''));
    if (!fixture) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!fixture) throw new Error('codesys-native-host-fixture-unavailable');
  const original = { left: fixture.left, top: fixture.top, width: fixture.width, height: fixture.height, pid: fixture.pid, windowId: fixture.id };
  const opened = await surface.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 12000;
    const run = async () => {
      const list = document.querySelector('#window-list');
      const option = [...(list?.options || [])].find((node) => /TaskHive Media Fixture/.test(node.textContent || ''));
      if (!option) { if (Date.now() >= deadline) return resolve({ok:false,reason:'fixture-option-missing'}); return setTimeout(run,100); }
      list.value = option.value; list.dispatchEvent(new Event('change', {bubbles:true}));
      await new Promise((done) => setTimeout(done,150));
      await window.toggleCodesysNativeHost?.();
      const waitAttached = async () => {
        const native = await window.taskhive.codesysNativeHostStatus();
        if (native?.attached === true) { const ai = document.querySelector('#codesys-ai-toggle'); if (ai?.getAttribute('aria-pressed') !== 'true') ai?.click(); return resolve({ok:true,native}); }
        if (Date.now() >= deadline) return resolve({ok:false,reason:document.querySelector('#input-status')?.textContent || 'attach-timeout'});
        setTimeout(waitAttached,100);
      };
      waitAttached();
    }; run();
  })`, true);
  if (!opened?.ok) throw new Error(`codesys-native-host-open-failed:${opened?.reason || 'unknown'}`);
  const stream = await surface.executeJavaScript(`new Promise((resolve) => { const deadline=Date.now()+15000; const tick=()=>{ const panel=document.querySelector('#stream-result'); const runtime=window.__TASKHIVE_CODESYS_STREAM__||{}; if(Number(panel?.dataset.frameCount||runtime.frames||0)>=15) return resolve({ok:true,frames:Number(panel?.dataset.frameCount||runtime.frames||0),fps:Number(runtime.fps||0),width:Number(runtime.width||0),height:Number(runtime.height||0),active:runtime.active===true}); if(Date.now()>=deadline) return resolve({ok:false,frames:Number(panel?.dataset.frameCount||runtime.frames||0),status:panel?.innerText||''}); setTimeout(tick,100);};tick();})`, true);
  const hosted = codesysNativeHost.status();
  const hostedFrame = await monitor.capture(fixture.id, { forceNative: true });
  const docked = (await monitor.listWindows()).find((item) => String(item.id) === String(fixture.id));
  await showPluginSurface('knowledge');
  const suspended = codesysNativeHost.status();
  const heldPluginGeometry = suspended.attached === true && suspended.suspended === true && JSON.stringify(suspended.bounds) === JSON.stringify(hosted.bounds);
  await showPluginSurface('codesys');
  const resumeDeadline = Date.now() + 10000;
  while (codesysNativeHost.status().suspended === true && Date.now() < resumeDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
  const resumed = codesysNativeHost.status();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const resumedWindow = (await monitor.listWindows()).find((item) => String(item.id) === String(fixture.id));
  const resumedGeometry = Boolean(resumedWindow && docked && resumedWindow.left === docked.left && resumedWindow.top === docked.top && resumedWindow.width === docked.width && resumedWindow.height === docked.height);
  const activeSurface = pluginSurfaceView?.webContents;
  const closed = await activeSurface.executeJavaScript(`new Promise(async (resolve) => { const result=await window.taskhive.detachCodesysNativeHost(); const deadline=Date.now()+10000; const tick=async()=>{const native=await window.taskhive.codesysNativeHostStatus(); if(native?.attached===false){const ai=document.querySelector('#codesys-ai-toggle');if(ai?.getAttribute('aria-pressed')==='true')ai.click();return resolve({ok:true,status:document.querySelector('#input-status')?.textContent||'',native,result});} if(Date.now()>=deadline)return resolve({ok:false,status:document.querySelector('#input-status')?.textContent||'',native,result});setTimeout(tick,100)};tick();})`, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const restoredWindow = (await monitor.listWindows()).find((item) => String(item.id) === String(fixture.id));
  const restoredGeometry = Boolean(restoredWindow && restoredWindow.left === original.left && restoredWindow.top === original.top && restoredWindow.width === original.width && restoredWindow.height === original.height);
  const detached = codesysNativeHost.status();
  const evidence = {
    ok: opened.ok && stream.ok && hosted.attached === true && hosted.suspended === false && hosted.mode === 'owned-native-host' && hosted.taskbarHidden === true && Boolean(hosted.actualOwner) && (Number(hosted.actualExStyle) & 0x80) !== 0 && (Number(hosted.actualExStyle) & 0x40000) === 0 && hostedFrame.completeFrame === true && docked?.width >= 320 && docked?.height >= 200 && heldPluginGeometry && resumed.attached === true && resumed.suspended === false && resumedGeometry && closed.ok && detached.attached === false && restoredGeometry,
    fixture: true,
    identity: { windowId: fixture.id, pid: fixture.pid, processName: fixture.processName, rechecked: true },
    original,
    docked: docked ? { left: docked.left, top: docked.top, width: docked.width, height: docked.height } : null,
    pageSwitch: { suspended, heldPluginGeometry, resumed, resumedGeometry, resumedWindow: resumedWindow ? { left: resumedWindow.left, top: resumedWindow.top, width: resumedWindow.width, height: resumedWindow.height } : null, desktopGeometryRestoredDuringSwitch: !heldPluginGeometry },
    restored: restoredWindow ? { left: restoredWindow.left, top: restoredWindow.top, width: restoredWindow.width, height: restoredWindow.height } : null,
    restoredGeometry,
    hosted,
    hostedFrame: { path: hostedFrame.path, width: hostedFrame.width, height: hostedFrame.height, completeFrame: hostedFrame.completeFrame, captureTransport: hostedFrame.captureTransport },
    detached,
    stream,
    channels: { human: 'native-hwnd-direct', ai: 'independent-read-only-media-stream', sharedWindowIdentity: true },
    safety: { realCodesysInputSent: false, plcActionExecuted: false, styleAndOwnerRestored: closed.ok, subprocessWindowsHidden: true },
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'codesys-native-host-electron-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw Object.assign(new Error('codesys-native-host-electron-probe-failed'), { details: evidence });
  return evidence;
}

async function probeCodesysStreamSurface(surface) {
  const taskHiveWindowFocusedBefore = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
  const selected = await surface.executeJavaScript(`new Promise((resolve) => {
    const deadline = Date.now() + 12000;
    const fixtureOnly = ${process.argv.includes('--smoke-codesys-fixture') ? 'true' : 'false'};
    let lastRefreshAt = 0;
    const selectReadyWindow = () => {
      const list = document.querySelector('#window-list');
      const usable = [...(list?.options || [])].filter((node) => String(node.value || '') !== '' && !/等待恢复/.test(node.textContent || ''));
      const fixtures = usable.filter((node) => /TaskHive Media Fixture/.test(node.textContent || ''));
      const option = fixtureOnly ? fixtures[0] : usable[0];
      if (!list || !option || (fixtureOnly && fixtures.length < 2)) {
        if (Date.now() >= deadline) return resolve(false);
        if (Date.now() - lastRefreshAt >= 700) { document.querySelector('#refresh-windows')?.click(); lastRefreshAt = Date.now(); }
        return setTimeout(selectReadyWindow, 100);
      }
      list.value = option.value;
      list.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => { const ai = document.querySelector('#codesys-ai-toggle'); if (ai?.getAttribute('aria-pressed') !== 'true') ai?.click(); resolve({ ok: true, label: option.textContent || '', value: option.value, fixture: /TaskHive Media Fixture/.test(option.textContent || ''), fixtureCount: fixtures.length, available: usable.map((node) => ({ value: node.value, label: node.textContent || '', fixture: /TaskHive Media Fixture/.test(node.textContent || '') })) }); }, 250);
    };
    selectReadyWindow();
  })`, true);
  if (!selected?.ok) return { ok: false, reason: 'no-usable-window-option' };
  const observed = await surface.executeJavaScript(`new Promise((resolve) => {
    const target = document.querySelector('#stream-result');
    let updates = 0; let timer = null; const deadline = Date.now() + 15000;
    const finish = () => {
      clearInterval(timer);
      const video = target?.querySelector('video.preview');
      const preview = video || target?.querySelector('img.preview');
      const videoRect = preview?.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const runtime = window.__TASKHIVE_CODESYS_STREAM__ || {};
      resolve({
        updates,
        frameCount: Number(target?.dataset.frameCount || runtime.frames || 0),
        text: target?.innerText || '',
        video: Boolean(preview),
        videoReadyState: Number(video?.readyState || (preview?.complete ? 4 : 0)),
        videoSize: { width: Number(video?.videoWidth || preview?.naturalWidth || runtime.width || 0), height: Number(video?.videoHeight || preview?.naturalHeight || runtime.height || 0) },
        displayedSize: { width: Number(videoRect?.width || 0), height: Number(videoRect?.height || 0) },
        panelSize: { width: Number(targetRect?.width || 0), height: Number(targetRect?.height || 0) },
        runtime,
        windowFit: { canvasWidth: Number(target?.dataset.canvasWidth || 0), canvasHeight: Number(target?.dataset.canvasHeight || 0), windowWidth: Number(target?.dataset.fittedWindowWidth || 0), windowHeight: Number(target?.dataset.fittedWindowHeight || 0), ratioError: Number(target?.dataset.windowFitRatioError || 1) },
        surfaceDocumentFocused: document.hasFocus(),
      });
    };
    const observer = new MutationObserver(() => { updates += 1; });
    if (target) observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-frame-count','data-fps','data-latency-ms','data-dropped-frames'] });
    timer = setInterval(() => {
      const count = Number(target?.dataset.frameCount || 0);
      const fps = Number(target?.dataset.fps || 0);
      if ((count >= 20 && fps >= 8) || Date.now() >= deadline) { observer.disconnect(); finish(); }
    }, 100);
  })`, true);
  let switched = { required: false, ok: true };
  if (process.argv.includes('--smoke-codesys-fixture')) {
    switched = await surface.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 18000;
      const list = document.querySelector('#window-list');
      const currentValue = String(list?.value || '');
      const next = [...(list?.options || [])].find((node) => node.value !== currentValue && /TaskHive Media Fixture/.test(node.textContent || '') && !/等待恢复/.test(node.textContent || ''));
      const previousRuntime = { ...(window.__TASKHIVE_CODESYS_STREAM__ || {}) };
      if (!list || !next) return resolve({ required: true, ok: false, reason: 'second-fixture-option-missing', currentValue });
      const nextLabel = next.textContent || '';
      const nextTitle = nextLabel.split(' · PID ')[0].trim();
      list.value = next.value;
      list.dispatchEvent(new Event('change', { bubbles: true }));
      let oldStopped = false;
      const waitForSelection = () => {
        const runtime = window.__TASKHIVE_CODESYS_STREAM__ || {};
        const inputStatus = document.querySelector('#input-status')?.textContent || '';
        const oldVideo = document.querySelector('#stream-result video.preview');
        if (runtime.active === false && String(runtime.reason || '').includes('window-switch') && inputStatus.includes(nextTitle)) {
          oldStopped = !oldVideo?.srcObject || (oldVideo.srcObject?.getTracks?.().filter((track) => track.readyState === 'live').length || 0) === 0;
          return waitForSecondStream();
        }
        if (Date.now() >= deadline) return resolve({ required: true, ok: false, reason: 'old-stream-not-reclaimed', runtime, inputStatus, nextLabel });
        setTimeout(waitForSelection, 100);
      };
      const waitForSecondStream = () => {
        const runtime = window.__TASKHIVE_CODESYS_STREAM__ || {};
        const video = document.querySelector('#stream-result video.preview');
        const sourceChanged = Boolean(runtime.sourceId && previousRuntime.sourceId && runtime.sourceId !== previousRuntime.sourceId);
        if (runtime.active === true && Number(runtime.frames || 0) >= 15 && sourceChanged) { const panel = document.querySelector('#stream-result'); const rect = video?.getBoundingClientRect(); const panelRect = panel?.getBoundingClientRect(); return resolve({ required: true, ok: oldStopped, oldStopped, sourceChanged, previousSourceId: previousRuntime.sourceId || '', nextSourceId: runtime.sourceId || '', previousLabel: ${JSON.stringify(selected?.label || '')}, nextLabel, value: next.value, frames: Number(runtime.frames || 0), video: Boolean(video), videoReadyState: Number(video?.readyState || 0), videoSize: { width: Number(video?.videoWidth || runtime.width || 0), height: Number(video?.videoHeight || runtime.height || 0) }, displayedSize: { width: Number(rect?.width || 0), height: Number(rect?.height || 0) }, panelSize: { width: Number(panelRect?.width || 0), height: Number(panelRect?.height || 0) }, windowFit: { canvasWidth: Number(panel?.dataset.canvasWidth || 0), canvasHeight: Number(panel?.dataset.canvasHeight || 0), windowWidth: Number(panel?.dataset.fittedWindowWidth || 0), windowHeight: Number(panel?.dataset.fittedWindowHeight || 0), ratioError: Number(panel?.dataset.windowFitRatioError || 1) }, runtime }); }
        if (Date.now() >= deadline) return resolve({ required: true, ok: false, reason: 'second-stream-timeout', oldStopped, sourceChanged, previousSourceId: previousRuntime.sourceId || '', nextSourceId: runtime.sourceId || '', nextLabel, runtime });
        setTimeout(waitForSecondStream, 100);
      };
      waitForSelection();
    })`, true);
  }
  try {
    const screenshot = await Promise.race([surface.capturePage(), new Promise((_, reject) => setTimeout(() => reject(new Error('CODESYS stream screenshot timeout')), 8000))]);
    fs.writeFileSync(path.join(root, 'logs', 'ui-codesys-stream.png'), screenshot.toPNG());
  } catch (error) { fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} codesys-stream-screenshot-unavailable ${error.message}\n`, 'utf8'); }
  await surface.executeJavaScript("(() => { const ai=document.querySelector('#codesys-ai-toggle'); if(ai?.getAttribute('aria-pressed')==='true') ai.click(); })()", true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const stopped = await surface.executeJavaScript(`(() => {
    const runtime = window.__TASKHIVE_CODESYS_STREAM__ || {};
    const video = document.querySelector('#stream-result video.preview');
    return { active: runtime.active, reason: runtime.reason || '', srcObjectCleared: !video?.srcObject, liveTracks: video?.srcObject?.getTracks?.().filter((track) => track.readyState === 'live').length || 0 };
  })()`, true);
  const activeObservation = switched.required ? switched : observed;
  const metrics = {
    fps: Number(activeObservation.runtime?.fps || observed.text.match(/FPS\s+([\d.]+)/)?.[1] || 0),
    latencyMs: Number(activeObservation.runtime?.latencyMs ?? observed.text.match(/延迟\s+(\d+)ms/)?.[1] ?? 0),
    droppedFrames: Number(activeObservation.runtime?.droppedFrames ?? observed.text.match(/丢帧\s+(\d+)/)?.[1] ?? 0),
  };
  const taskHiveWindowFocused = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
  const focusStatePreserved = taskHiveWindowFocused === taskHiveWindowFocusedBefore;
  const fullFrame = Number(activeObservation.videoSize?.width || 0) >= 320 && Number(activeObservation.videoSize?.height || 0) >= 200;
  const activeTransport = String(activeObservation.runtime?.transport || observed.runtime?.transport || 'renderer-media-stream');
  const nativeTransport = activeTransport === 'windows-printwindow';
  const sourceAspect = Number(activeObservation.videoSize?.width || 0) / Math.max(1, Number(activeObservation.videoSize?.height || 0));
  const displayedAspect = Number(activeObservation.displayedSize?.width || 0) / Math.max(1, Number(activeObservation.displayedSize?.height || 0));
  const aspectRatioPreserved = sourceAspect > 0 && Math.abs(sourceAspect - displayedAspect) <= 0.01 && Number(activeObservation.displayedSize?.width || 0) <= Number(activeObservation.panelSize?.width || 0) + 1 && Number(activeObservation.displayedSize?.height || 0) <= Number(activeObservation.panelSize?.height || 0) + 1;
  const previewFillsAvailableAxis = Math.abs(Number(activeObservation.displayedSize?.width || 0) - Number(activeObservation.panelSize?.width || 0)) <= 4 || Math.abs(Number(activeObservation.displayedSize?.height || 0) - Number(activeObservation.panelSize?.height || 0)) <= 4;
  const previewFillsCanvas = Math.abs(Number(activeObservation.displayedSize?.width || 0) - Number(activeObservation.panelSize?.width || 0)) <= 4 && Math.abs(Number(activeObservation.displayedSize?.height || 0) - Number(activeObservation.panelSize?.height || 0)) <= 4;
  const windowFitVerified = Number(activeObservation.windowFit?.canvasWidth || 0) >= 320 && Number(activeObservation.windowFit?.canvasHeight || 0) >= 200 && Number(activeObservation.windowFit?.windowWidth || 0) >= 320 && Number(activeObservation.windowFit?.windowHeight || 0) >= 200 && Number(activeObservation.windowFit?.ratioError ?? 1) <= 0.002;
  const dimensionMetadataMatches = !nativeTransport || (activeObservation.runtime?.dimensionsMatch === true && Number(activeObservation.runtime?.reportedWidth || 0) === Number(activeObservation.videoSize?.width || 0) && Number(activeObservation.runtime?.reportedHeight || 0) === Number(activeObservation.videoSize?.height || 0));
  const frameCount = Number(activeObservation.frameCount || activeObservation.frames || 0);
  const droppedFrameBudget = Math.max(2, Math.ceil(frameCount * 0.15));
  const fixtureSwitchVerified = switched.required !== true || (Number(selected?.fixtureCount || 0) >= 2 && switched.ok === true && switched.oldStopped === true && switched.sourceChanged === true && switched.video === true && switched.videoReadyState >= 2);
  const minimumFrames = nativeTransport ? 3 : 20;
  const minimumFps = nativeTransport ? 0.5 : 8;
  const evidence = { ok: observed.frameCount >= minimumFrames && observed.video && observed.videoReadyState >= 2 && fixtureSwitchVerified && focusStatePreserved && fullFrame && aspectRatioPreserved && previewFillsAvailableAxis && previewFillsCanvas && windowFitVerified && dimensionMetadataMatches && metrics.fps >= minimumFps && (nativeTransport || metrics.latencyMs < 150) && metrics.droppedFrames <= droppedFrameBudget && stopped.active === false && stopped.liveTracks === 0, selected: true, selectedWindow: selected, fixture: selected.fixture === true, fixtureSwitchVerified, switched, ...observed, taskHiveWindowFocusedBefore, taskHiveWindowFocused, focusStatePreserved, metrics, droppedFrameBudget, minimumFrames, minimumFps, fullFrame, sourceAspect, displayedAspect, aspectRatioPreserved, previewFillsAvailableAxis, previewFillsCanvas, windowFitVerified, dimensionMetadataMatches, captureTransport: activeTransport, inputTransport: 'persistent-hidden-postmessage-worker', focusTransferRequested: false, stopped, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'codesys-ui-stream-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeBrowserSurface() {
  const surface = await openSurfaceForProbe('web-ai', '#web-ai-new-window');
  const result = await surface.executeJavaScript(`(async () => {
    const wait = (predicate, timeout = 60000) => new Promise((resolve) => { const deadline = Date.now() + timeout; const check = () => { if (predicate()) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); });
    const first = await wait(() => document.querySelectorAll('[data-web-tab]').length === 1);
    const initialPreferences = await window.taskhive.browserPreferences();
    const initialBookmarks = [...(document.querySelector('#web-ai-bookmarks')?.options || [])].map((node) => node.textContent.trim());
    const addedPreferences = await window.taskhive.addBrowserBookmark({ title: 'TaskHive Probe', url: 'https://example.com/taskhive-probe' });
    const probeBookmark = addedPreferences.bookmarks.find((item) => item.title === 'TaskHive Probe');
    if (probeBookmark) await window.taskhive.removeBrowserBookmark(probeBookmark.id);
    const restoredPreferences = await window.taskhive.browserPreferences();
    document.querySelector('#web-ai-new-window')?.click();
    const second = await wait(() => document.querySelectorAll('[data-web-tab]').length === 2);
    const tabsRow = document.querySelector('.browser-tabs-row')?.getBoundingClientRect();
    const navRow = document.querySelector('.browser-nav-row')?.getBoundingClientRect();
    return {
      first,
      second,
      tabs: document.querySelectorAll('[data-web-tab]').length,
      standardChrome: Boolean(tabsRow && navRow && tabsRow.bottom <= navRow.top + 1),
      addressBar: Boolean(document.querySelector('#web-ai-address')),
      navigationControls: ['#web-ai-back','#web-ai-forward','#web-ai-reload'].every((selector) => document.querySelector(selector)),
      homepageControl: Boolean(document.querySelector('#web-ai-home')),
      bookmarkControls: ['#web-ai-bookmarks','#web-ai-bookmark-current','#web-ai-open-bookmark','#web-ai-remove-bookmark','#web-ai-set-home'].every((selector) => document.querySelector(selector)),
      initialPreferences,
      initialBookmarks,
      bookmarkRoundTrip: Boolean(probeBookmark) && !restoredPreferences.bookmarks.some((item) => item.id === probeBookmark.id),
      titleVisible: Boolean(document.querySelector('h1,h2')),
    };
  })()`, true);
  const state = webAiWindowState();
  const bounds = webAiView?.getBounds() || null;
  const expected = webAiBounds(pluginSurfaceBounds);
  const retainedId = state.activeId;
  await showPluginSurface('codesys');
  const detachedOnSwitch = webAiAttached === false;
  await showPluginSurface('web-ai');
  const reattachedOnReturn = webAiAttached === true && activeWebAiViewId === retainedId;
  let screenshotError = null;
  try {
    const chrome = await pluginSurfaceView.webContents.capturePage();
    fs.writeFileSync(path.join(root, 'logs', 'ui-browser-chrome.png'), chrome.toPNG());
    const page = await webAiView.webContents.capturePage();
    fs.writeFileSync(path.join(root, 'logs', 'ui-browser-page.png'), page.toPNG());
  } catch (error) { screenshotError = error.message; }
  const requiredBookmarks = ['Google', 'DeepSeek', 'Kimi', '豆包', '腾讯元宝', '通义千问', 'ChatGPT', 'Claude', 'Gemini'];
  const evidence = { ok: result.first === true && result.second === true && result.standardChrome === true && result.addressBar === true && result.navigationControls === true && result.homepageControl === true && result.bookmarkControls === true && result.bookmarkRoundTrip === true && result.tabs === 2 && result.titleVisible === false && /^https:\/\/www\.doubao\.com\/chat\/?$/i.test(result.initialPreferences?.homepage || '') && requiredBookmarks.every((name) => result.initialBookmarks.includes(name)) && state.windows.length === 2 && state.windows.every((item) => item.providerId === 'doubao') && bounds?.y === expected?.y && bounds?.height === expected?.height && detachedOnSwitch && reattachedOnReturn, ...result, state, bounds, expected, detachedOnSwitch, reattachedOnReturn, screenshotError, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'browser-ui-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  hideWebAiView();
  for (const item of webAiViews.values()) { try { item.view.webContents.close(); } catch {} }
  webAiViews.clear(); activeWebAiViewId = null; webAiView = null;
  if (!evidence.ok) throw new Error('browser-ui-probe-failed');
  return evidence;
}

async function probeWebLoginGate(frame) {
  const before = webAiWindowState();
  const bridge = await frame.executeJavaScript(`(async () => {
    const host = document.createElement('article');
    host.id = 'taskhive-web-login-probe';
    host.dataset.messageId = 'taskhive-web-login-probe';
    host.textContent = '[[TASKHIVE_WEB_LOGIN:deepseek-web]] 请完成登录';
    document.body.appendChild(host);
    const deadline = Date.now() + 5000;
    let button = null;
    while (Date.now() < deadline) {
      button = host.querySelector('[data-taskhive-web-login="deepseek-web"]');
      if (button) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = { converted: Boolean(button), markerRemoved: !host.textContent.includes('TASKHIVE_WEB_LOGIN'), buttonText: String(button?.textContent || '').trim(), title: button?.getAttribute('title') || '', ariaLabel: button?.getAttribute('aria-label') || '' };
    button?.click();
    return result;
  })()`, true);
  for (let attempt = 0; attempt < 140 && webAiViews.size === before.windows.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  const opened = webAiWindowState();
  const routed = opened.windows.some((item) => item.providerId === 'deepseek');
  await frame.executeJavaScript("document.querySelector('#taskhive-web-login-probe')?.remove()", true).catch(() => {});
  hideWebAiView();
  for (const item of webAiViews.values()) { try { item.view.webContents.close(); } catch {} }
  webAiViews.clear();
  activeWebAiViewId = null;
  webAiView = null;
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  // A login request must also work when the Browser surface already owns a
  // homepage tab. Reusing that tab and routing it to the requested provider is
  // the normal user flow, so zero pre-existing tabs is not an acceptance gate.
  const evidence = { ok: bridge.converted === true && bridge.markerRemoved === true && bridge.buttonText === '需要登录 · 打开浏览器' && routed, before, bridge, opened, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'web-ai-login-gate-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error('web-ai-login-gate-probe-failed');
  return evidence;
}

async function exercisePackageSurface() {
  const surface = await openSurfaceForProbe('packages', '#plugin-list .plugin-row');
  const result = await surface.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('#plugin-list .plugin-row')];
    return {
      visible: Boolean(document.querySelector('#plugin-list')),
      rows: rows.length,
      toggleButtons: document.querySelectorAll('[data-toggle]').length,
      uninstallButtons: document.querySelectorAll('[data-uninstall]').length,
      restoreButtons: document.querySelectorAll('[data-restore]').length,
      protectedComponents: [...document.querySelectorAll('#plugin-list .badge')].filter((node) => /系统组件/.test(node.textContent || '')).length,
      installButton: Boolean(document.querySelector('#install-plugin')),
      sourceInput: Boolean(document.querySelector('#plugin-source'))
    };
  })()`, true);
  const screenshot = await surface.capturePage();
  fs.writeFileSync(path.join(root, 'logs', 'ui-packages.png'), screenshot.toPNG());
  const interaction = await surface.executeJavaScript(`(() => {
    const kind = document.querySelector('#repository-kind');
    if (!kind) return { kindChanged: false };
    kind.value = 'knowledge';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    return { kindChanged: kind.value === 'knowledge' };
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const repositoryResult = await surface.executeJavaScript(`({
    repositoryRows: document.querySelectorAll('#plugin-list .plugin-row').length,
    repositoryToggleButtons: document.querySelectorAll('#plugin-list [data-toggle]').length,
    repositoryUninstallButtons: document.querySelectorAll('#plugin-list [data-uninstall]').length,
    repositoryRestoreButtons: document.querySelectorAll('#plugin-list [data-restore]').length
  })`, true);
  fs.writeFileSync(path.join(root, 'logs', 'plugin-ui-probe.json'), JSON.stringify({ ...result, ...interaction, ...repositoryResult, at: new Date().toISOString() }, null, 2), 'utf8');
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return result;
}

async function exerciseRepositorySurfaces() {
  const probe = async (kind, query) => {
    const surface = await openSurfaceForProbe(kind, kind === 'experts' ? '#expert-team' : '#repo-results .plugin-row');
    if (kind === 'experts') await surface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const status = document.querySelector('#expert-config-status')?.textContent || ''; const models = document.querySelector('#expert-model-new')?.options?.length || 0; if (document.querySelector('#expert-team') && models >= 2 && status && !status.includes('正在读取')) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
    const listed = await surface.executeJavaScript(`({
      rows: document.querySelectorAll('#repo-results .plugin-row').length,
      text: document.querySelector('#repo-results')?.innerText || '',
      status: document.querySelector('#repo-status')?.textContent || '',
      knowledgeControls: ${kind === 'knowledge' ? "{ workbench: Boolean(document.querySelector('.knowledge-workbench')), books: document.querySelectorAll('.knowledge-book').length, tree: Boolean(document.querySelector('.knowledge-tree')), create: Boolean(document.querySelector('#knowledge-card-create')), sync: Boolean(document.querySelector('#knowledge-sync')), syncStatus: document.querySelector('#knowledge-sync-status')?.textContent || '' }" : 'null'},
      expertControls: ${kind === 'experts' ? "{ enabledSwitchInPlugin: Boolean(document.querySelector('#expert-enabled')), modes: document.querySelectorAll('[data-expert-mode]').length, columns: document.querySelectorAll('.expert-column').length, team: Boolean(document.querySelector('#expert-team')), teamStages: document.querySelectorAll('[data-expert-stage]').length, modelSelect: Boolean(document.querySelector('#expert-model-new')), modelOptions: [...(document.querySelector('#expert-model-new')?.options || [])].map((item) => item.value), knowledgeInput: Boolean(document.querySelector('#expert-knowledge-new')), knowledgeOptions: [...(document.querySelector('#expert-knowledge-new')?.options || [])].map((item) => item.value), permissionOptions: [...(document.querySelector('#expert-permission-new')?.options || [])].map((item) => item.value), create: Boolean(document.querySelector('#expert-create')), status: document.querySelector('#expert-config-status')?.textContent || '' }" : 'null'}
    })`, true);
    let expertRoundTrip = null;
    if (kind === 'experts') {
      expertRoundTrip = await surface.executeJavaScript(`(async () => {
        const name = '验收临时专家-' + Date.now();
        const input = document.querySelector('#expert-name-new');
        const create = document.querySelector('#expert-create');
        if (!input || !create) return { ok: false, reason: 'create-controls-missing' };
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        create.click();
        const deadline = Date.now() + 10000;
        let card = null;
        while (Date.now() < deadline) {
          card = [...document.querySelectorAll('[data-expert-id]')].find((node) => node.textContent.includes(name));
          if (card) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const id = card?.getAttribute('data-expert-id') || '';
        if (!id) return { ok: false, reason: 'created-card-missing', name };
        await window.taskhive.removeExpert(id);
        const after = await window.taskhive.expertStatus();
        return { ok: !after.experts.some((item) => item.id === id), name, id, created: true, removed: true };
      })()`, true);
    }
    await surface.executeJavaScript(`(() => {
      const input = document.querySelector('#repo-query');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, ${JSON.stringify(query)});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(query)} }));
      document.querySelector('#repo-search')?.click();
      return true;
    })()`, true);
    await surface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const text = document.querySelector('#repo-status')?.textContent || ''; if (/搜索完成/.test(text)) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
    const searched = await surface.executeJavaScript(`({ rows: document.querySelectorAll('#repo-results .plugin-row').length, text: document.querySelector('#repo-results')?.innerText || '', status: document.querySelector('#repo-status')?.textContent || '' })`, true);
    await surface.executeJavaScript("document.querySelector('#repo-audit')?.click()", true);
    await surface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const text = document.querySelector('#repo-status')?.textContent || ''; if (/审计完成/.test(text)) return resolve(true); if (Date.now() >= deadline) return resolve(false); setTimeout(check, 100); }; check(); })", true);
    const audited = await surface.executeJavaScript(`({ rows: document.querySelectorAll('#repo-results .plugin-row').length, text: document.querySelector('#repo-results')?.innerText || '', status: document.querySelector('#repo-status')?.textContent || '' })`, true);
    let screenshotError = null;
    try {
      const screenshot = await surface.capturePage();
      fs.writeFileSync(path.join(root, 'logs', `ui-${kind}.png`), screenshot.toPNG());
    } catch (error) {
      screenshotError = error.message;
    }
    return { listed, expertRoundTrip, searched, audited, screenshotError };
  };
  const knowledge = await probe('knowledge', 'CODESYS');
  const syncStatePath = path.join(root, 'knowledge', 'sync-state.json');
  const previousSyncState = fs.existsSync(syncStatePath) ? fs.readFileSync(syncStatePath, 'utf8') : null;
  const syncProbePath = path.join(root, 'cache', `knowledge-sync-probe-${process.pid}`);
  try {
    const syncResult = await repositories.knowledge.sync({ mode: 'shared-folder-or-git', remotePath: syncProbePath });
    const sharedFile = path.join(syncProbePath, 'taskhive-knowledge-cards.json');
    const shared = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
    knowledge.syncRoundTrip = { ok: syncResult.state === 'synchronized' && Array.isArray(shared.cards) && shared.revision >= 0, state: syncResult.state, clients: syncResult.clients, conflicts: syncResult.conflicts, remoteFile: path.basename(sharedFile) };
  } catch (error) {
    knowledge.syncRoundTrip = { ok: false, error: error.message };
  } finally {
    fs.rmSync(syncProbePath, { recursive: true, force: true });
    if (previousSyncState === null) fs.rmSync(syncStatePath, { force: true }); else fs.writeFileSync(syncStatePath, previousSyncState, 'utf8');
  }
  const experts = await probe('experts', 'Harness');
  const knowledgeOk = knowledge.listed?.knowledgeControls?.workbench === true && knowledge.listed.knowledgeControls.books >= 7 && knowledge.listed.knowledgeControls.tree === true && knowledge.listed.knowledgeControls.create === true && knowledge.listed.knowledgeControls.sync === true && knowledge.syncRoundTrip?.ok === true && knowledge.searched?.rows >= 1 && knowledge.audited?.rows >= 1;
  const expertControls = experts.listed?.expertControls;
  const expertsOk = expertControls?.enabledSwitchInPlugin === false && expertControls?.modes === 1 && expertControls?.columns >= 3 && expertControls?.team === true && expertControls?.teamStages >= 1 && expertControls?.modelSelect === true && expertControls?.modelOptions?.length >= 2 && expertControls?.knowledgeInput === true && expertControls?.knowledgeOptions?.length >= 1 && expertControls?.permissionOptions?.length === 3 && expertControls?.create === true && !/正在读取/.test(expertControls?.status || '') && experts.expertRoundTrip?.ok === true && experts.searched?.rows >= 1 && experts.audited?.rows >= 1;
  const evidence = { ok: knowledgeOk && expertsOk, knowledgeOk, expertsOk, knowledge, experts, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'repository-ui-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return evidence;
}

async function probeInteractiveMetadata() {
  const consoleBefore = await visibleConsoleWindows();
  const inspect = async (webContents, name, requireMetadata) => webContents.executeJavaScript(`(() => {
    const visible = (node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const controls = [...document.querySelectorAll('button,a,[role="button"],[role="tab"],select,input,textarea,summary')].filter(visible);
    const rows = controls.map((node, index) => ({ index, tag: node.tagName, text: String(node.innerText || node.value || node.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 70), title: node.getAttribute('title') || '', aria: node.getAttribute('aria-label') || '' }));
    return { name: ${JSON.stringify(name)}, requireMetadata: ${JSON.stringify(requireMetadata)}, controls: rows.length, missing: rows.filter((item) => !item.title && !item.aria) };
  })()`, true);
  const reports = [];
  const frame = currentHarnessFrame();
  if (frame) reports.push(await inspect(frame, 'Harness 工作台', false));
  const surfaces = [
    ['codesys', '#vision-status'], ['web-ai', '#web-ai-address'], ['knowledge', '#knowledge-category-grid'], ['experts', '#expert-model-new'],
  ];
  for (const [kind, selector] of surfaces) {
    const view = await openSurfaceForProbe(kind, selector, 15000);
    await view.executeJavaScript("new Promise((resolve) => setTimeout(resolve, 250))", true);
    reports.push(await inspect(view, kind, true));
  }
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  const consoleAfter = await visibleConsoleWindows();
  const baseline = new Set(consoleBefore.map((item) => item.id));
  const newConsoleWindows = consoleAfter.filter((item) => !baseline.has(item.id));
  const frameDescriptors = frame ? await frame.executeJavaScript(`(() => ({
    descriptors: window.__TASKHIVE_SURFACE_DESCRIPTORS__ || [],
    left: [...document.querySelectorAll('[data-taskhive-sidebar-plugins] [data-sidebar-plugin-id]')].map((node) => node.getAttribute('data-sidebar-plugin-id')),
    right: [...document.querySelectorAll('[data-taskhive-right-sidebar-plugins] [data-sidebar-plugin-id]')].map((node) => node.getAttribute('data-sidebar-plugin-id')),
  }))()`, true) : { descriptors: [], left: [], right: [] };
  const chartsHidden = !frameDescriptors.descriptors.some((item) => item.id === 'charts') && !frameDescriptors.left.includes('charts') && !frameDescriptors.right.includes('charts');
  const evidence = { ok: reports.length === 5 && reports.every((item) => item.controls > 0 && (item.requireMetadata === false || item.missing.length === 0)) && newConsoleWindows.length === 0 && chartsHidden, reports, frameDescriptors, chartsHidden, consoleBefore, consoleAfter, newConsoleWindows, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'interactive-metadata-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error('interactive-metadata-probe-failed');
  return evidence;
}

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

async function probeSettingsPluginWindowVisibility() {
  const frame = currentHarnessFrame();
  if (!frame) throw new Error('dsh-frame-not-found');
  const baseline = await visibleConsoleWindows();
  const baselineIds = new Set(baseline.map((item) => item.id));
  const phases = [];
  const sample = async (name, action) => {
    const monitoring = monitorVisibleConsoleWindows(1800);
    await new Promise((resolve) => setTimeout(resolve, 80));
    let actionResult = null;
    let actionError = null;
    try { actionResult = await action(); } catch (error) { actionError = error.message; }
    const observed = await monitoring;
    const newVisible = observed.filter((item) => !baselineIds.has(item.id));
    phases.push({ name, actionResult, actionError, observed, newVisible });
  };
  await sample('settings', async () => frame.executeJavaScript(`(async () => {
    const text = (node) => String(node?.innerText || node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || '').trim();
    const trigger = [...document.querySelectorAll('button,[role="button"],a')].find((node) => /^(设置|settings)$/i.test(text(node)));
    trigger?.click();
    const deadline = Date.now() + 5000;
    while (!document.querySelector('[role="dialog"],[aria-modal="true"]') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return { clicked: Boolean(trigger), dialog: Boolean(document.querySelector('[role="dialog"],[aria-modal="true"]')) };
  })()`, true));
  await frame.executeJavaScript(`(() => { const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]'); const close = [...(dialog?.querySelectorAll('button') || [])].find((node) => /^(关闭设置|关闭|close settings|close)$/i.test(String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim())); close?.click(); return Boolean(close); })()`, true);
  const surfaces = [['codesys', '#vision-status'], ['experts', '#expert-model-new'], ['knowledge', '#knowledge-category-grid'], ['web-ai', '#web-ai-address']];
  for (const [kind, selector] of surfaces) await sample(kind, async () => { await openSurfaceForProbe(kind, selector, 15000); return { opened: pluginSurfaceKind === kind }; });
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  const after = await visibleConsoleWindows();
  const newAfter = after.filter((item) => !baselineIds.has(item.id));
  const ok = phases.length === 5 && phases.every((phase) => !phase.actionError && phase.newVisible.length === 0) && newAfter.length === 0;
  const evidence = { ok, samplingIntervalMs: 40, baseline, phases, after, newAfter, at: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'logs', 'settings-plugin-window-visibility-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!ok) throw new Error('settings-plugin-window-visibility-probe-failed');
  return evidence;
}

async function exerciseChartSurface() {
  const surface = await openSurfaceForProbe('charts', '#chart-output svg');
  const result = await surface.executeJavaScript(`(() => ({ visible: Boolean(document.querySelector('#chart-output svg')), kind: document.querySelector('#chart-kind')?.value || '', svgLength: document.querySelector('#chart-output')?.innerHTML.length || 0, exportSvg: Boolean(document.querySelector('#chart-svg')), exportJson: Boolean(document.querySelector('#chart-json')), status: document.querySelector('#chart-status')?.textContent || '' }))()`, true);
  fs.writeFileSync(path.join(root, 'logs', 'chart-ui-probe.json'), JSON.stringify({ ok: result.visible && result.svgLength > 200 && result.exportSvg && result.exportJson, ...result, at: new Date().toISOString() }, null, 2), 'utf8');
  await mainWindow.webContents.executeJavaScript("window.postMessage({source:'taskhive-dsh',type:'surface.open',surface:'chat'}, '*')", true);
  return result;
}

async function probeModLensVision() {
  const imagePath = path.join(root, 'app', 'assets', 'taskhive-icon-v3-256.png');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
  const result = await harness.runTool('modlens.analyze', { sha256, probe: 'packaged-icon' }, () => modlens.analyze({
    path: imagePath,
    prompt: 'Describe the TaskHive icon and its dominant colors.',
    sha256,
  }));
  const evidence = {
    at: new Date().toISOString(),
    owner: 'Harness/DSH',
    agentLoop: 'single',
    status: result.status,
    provider: result.provider || null,
    route: result.route || null,
    trust: result.trust,
    screenshotSha256: result.screenshotSha256,
    result: result.result || null,
    meta: result.meta || null,
  };
  fs.writeFileSync(path.join(root, 'logs', 'vision-smoke.json'), JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeDshToolCall() {
  const expertProbe = process.argv.includes('--probe-dsh-expert-run');
  const scriptEngineProbe = process.argv.includes('--probe-dsh-codesys-scriptengine');
  const toolName = expertProbe ? 'taskhive_expert_run' : scriptEngineProbe ? 'taskhive_codesys_scriptengine_doctor' : 'taskhive_knowledge_search';
  const evidence = { at: new Date().toISOString(), status: 'gated', owner: 'Harness/DSH', agentLoop: 'single', tool: toolName };
  const outputPath = path.join(root, 'logs', expertProbe ? 'dsh-expert-run-probe.json' : scriptEngineProbe ? 'dsh-codesys-scriptengine-probe.json' : 'dsh-tool-call-probe.json');
  if (process.env.TASKHIVE_LIVE_TOOL_CALL !== '1') {
    evidence.reason = 'live-probe-disabled';
    evidence.requiredOptIn = 'TASKHIVE_LIVE_TOOL_CALL=1';
    fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
    return evidence;
  }
  let frame = null;
  for (let attempt = 0; attempt < 60 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) { evidence.status = 'runtime-unverified'; evidence.reason = 'dsh-frame-not-found'; fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8'); return evidence; }
  const prompt = expertProbe
    ? 'Call the TaskHive tool taskhive_expert_run with task "Assess the safety boundary of read-only CODESYS screen monitoring", routeMode inherited, and maxMembers 2. Wait for the real Harness subagents and report only the returned team result.'
    : scriptEngineProbe
      ? 'Call the TaskHive tool taskhive_codesys_scriptengine_doctor now. Do not call the probe tool and do not perform any project or PLC action. Report only the returned ScriptEngine status and offline safety policy.'
      : 'Call the TaskHive tool taskhive_knowledge_search with query CODESYS safety. Wait for the tool result and report only the returned evidence.';
  const submitted = await frame.executeJavaScript(`(async () => {
    const value = ${JSON.stringify(prompt)};
    const toolName = ${JSON.stringify(toolName)};
    const beforeText = document.body?.innerText || '';
    const countTool = (text) => String(text).split(toolName).length - 1;
    const baselineToolCount = countTool(beforeText);
    const deadline = Date.now() + 30000;
    let input = null; let send = null;
    for (let modelAttempt = 0; modelAttempt < 20; modelAttempt += 1) {
      const modelButton = [...document.querySelectorAll('button')].find((node) => /(选择模型|選擇模型|select model)/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
      if (modelButton && !modelButton.disabled) {
        modelButton.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const option = [...document.querySelectorAll('button, [role="option"], [role="menuitem"]')].find((node) => /gpt-5\.5/i.test((node.innerText || node.getAttribute('aria-label') || '').trim()));
        if (option) { option.click(); await new Promise((resolve) => setTimeout(resolve, 600)); break; }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    while (Date.now() < deadline) { input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]'); send = [...document.querySelectorAll('button')].find((node) => /^(发送消息|send message)$/i.test((node.innerText || node.getAttribute('aria-label') || '').trim())); if (input && send) break; await new Promise((resolve) => setTimeout(resolve, 250)); }
    const candidates = [...document.querySelectorAll('textarea, input, [contenteditable], [role="textbox"], button')].map((node) => ({ tag: node.tagName, role: node.getAttribute('role'), aria: node.getAttribute('aria-label'), placeholder: node.getAttribute('placeholder'), contenteditable: node.getAttribute('contenteditable'), disabled: node.disabled === true, text: (node.innerText || '').trim().slice(0, 80) })).slice(-80);
    if (!input) return { submitted: false, reason: 'composer-not-found', candidates };
    if (!send) return { submitted: false, reason: 'send-button-not-found', candidates };
    if (input.matches('textarea')) { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, value); }
    else { input.textContent = value; }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    for (let sendAttempt = 0; sendAttempt < 40 && send.disabled; sendAttempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    if (send.disabled) return { submitted: false, reason: 'send-disabled-after-input', candidates };
    send.click();
    return { submitted: true, baselineToolCount };
  })()`, true);
  evidence.submitted = submitted;
  if (!submitted?.submitted) { evidence.status = 'runtime-unverified'; fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8'); return evidence; }
  const deadline = Date.now() + Math.max(10000, Number(process.env.TASKHIVE_LIVE_TOOL_CALL_TIMEOUT_MS) || (expertProbe ? 240000 : scriptEngineProbe ? 120000 : 90000));
  let last = null;
  while (Date.now() < deadline) {
    last = await frame.executeJavaScript(`(() => { const text = document.body?.innerText || ''; const toolName = ${JSON.stringify(toolName)}; const toolCount = text.split(toolName).length - 1; const tool = toolCount > ${Number(submitted?.baselineToolCount || 0) + 1}; const markerPattern = new RegExp(${JSON.stringify(expertProbe ? 'harness-subagents|parentSessionId|routeSource' : scriptEngineProbe ? 'offline-allowlist|ScriptEngine\\.plugin|CODESYS V3\\.5 SP20 Patch 4' : 'Read-only monitoring only|matchedTerms|scannedFiles|guide\\.md')}, 'ig'); const resultMatches = [...text.matchAll(markerPattern)].slice(-8).map((match) => text.slice(Math.max(0, match.index - 100), match.index + match[0].length + 180)); const resultMarker = resultMatches.length > 0; const result = tool && resultMarker; return { tool, result, resultMarker, resultMatches, toolCount, tail: text.slice(-2200) }; })()`, true);
    if (last?.tool && last?.result) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  evidence.observation = last;
  evidence.status = last?.tool && last?.result ? 'verified' : 'runtime-unverified';
  evidence.reason = evidence.status === 'verified' ? null : 'tool-call-or-result-not-observed-before-timeout';
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
  return evidence;
}

async function probeGenerationCancellation() {
  const evidence = { ok: false, owner: 'Harness/DSH', agentLoop: 'single', at: new Date().toISOString() };
  const outputPath = path.join(root, 'logs', 'generation-cancellation-electron-probe.json');
  let frame = null;
  for (let attempt = 0; attempt < 120 && !frame; attempt += 1) {
    frame = currentHarnessFrame();
    if (!frame) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!frame) throw new Error('Harness frame not found for cancellation probe');
  const submitted = await frame.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textOf = (node) => String(node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || '').trim();
    const expertToggle = document.querySelector('[data-taskhive-expert-toggle][data-enabled="true"]');
    if (expertToggle) { expertToggle.click(); await sleep(200); }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const modelButton = [...document.querySelectorAll('button')].find((node) => /(选择模型|選擇模型|select model)/i.test(textOf(node)));
      if (modelButton && !modelButton.disabled) {
        modelButton.click(); await sleep(200);
        const option = [...document.querySelectorAll('button,[role="option"],[role="menuitem"]')].find((node) => /gpt-5\.5/i.test(textOf(node)));
        if (option) { option.click(); await sleep(500); break; }
      }
      await sleep(150);
    }
    const deadline = Date.now() + 20000;
    let input = null; let send = null;
    while (Date.now() < deadline) {
      input = document.querySelector('textarea,[contenteditable="true"],[role="textbox"]');
      send = [...document.querySelectorAll('button')].find((node) => /^(发送消息|send message)$/i.test(textOf(node)));
      if (input && send && !send.disabled) break;
      await sleep(100);
    }
    if (!input || !send) return { ok: false, reason: 'composer-unavailable' };
    const value = 'HANG_CURRENT_TURN';
    if (input.matches('textarea')) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value); else input.textContent = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    await sleep(100);
    send.click();
    return { ok: true };
  })()`, true);
  evidence.firstSubmitted = submitted?.ok === true;
  if (!evidence.firstSubmitted) throw new Error(`Cancellation probe could not submit first turn: ${submitted?.reason || 'unknown'}`);

  const pidFile = String(process.env.TASKHIVE_FIXTURE_PID_FILE || '');
  const pidDeadline = Date.now() + 20000;
  let fixturePids = null;
  while (!fixturePids && Date.now() < pidDeadline) {
    if (pidFile && fs.existsSync(pidFile)) {
      try {
        const raw = fs.readFileSync(pidFile, 'utf8').trim();
        if (raw.startsWith('{') && raw.endsWith('}')) {
          const parsed = JSON.parse(raw);
          if (Number(parsed?.worker) > 0 && Number(parsed?.descendant) > 0) fixturePids = parsed;
        }
      } catch { /* writer may be between truncate and flush; retry boundedly */ }
    }
    if (!fixturePids) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!fixturePids) throw new Error('Cancellation fixture did not publish complete process identities');
  evidence.fixturePids = fixturePids;
  const stopStarted = Date.now();
  const stopped = await frame.executeJavaScript(`(async () => {
    const deadline = Date.now() + 15000;
    const textOf = (node) => [node?.innerText, node?.textContent, node?.getAttribute?.('aria-label'), node?.getAttribute?.('title')].filter(Boolean).join(' ').trim();
    while (Date.now() < deadline) {
      const button = [...document.querySelectorAll('button,[role="button"]')].find((node) => /(停止生成|停止回答|stop generation|stop response|cancel generation)/i.test(textOf(node)));
      if (button && !button.disabled) { button.click(); return { clicked: true, label: textOf(button).slice(0, 120) }; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { clicked: false, buttons: [...document.querySelectorAll('button,[role="button"]')].map((node) => ({ label: textOf(node).slice(0, 120), disabled: Boolean(node.disabled), aria: node.getAttribute('aria-label') })).slice(-60), bodyTail: String(document.body?.innerText || '').slice(-1600) };
  })()`, true);
  evidence.stopControl = stopped;
  if (!stopped?.clicked) throw new Error(`Harness stop-generation control not found: ${JSON.stringify(stopped)}`);

  const recoveryDeadline = Date.now() + 15000;
  let recovered = null;
  while (Date.now() < recoveryDeadline) {
    recovered = await frame.executeJavaScript(`(() => {
      const textOf = (node) => [node?.innerText, node?.textContent, node?.getAttribute?.('aria-label'), node?.getAttribute?.('title')].filter(Boolean).join(' ').trim();
      const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 20; };
      const input = [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter(visible).sort((left, right) => {
        const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect(); return (b.width * b.height) - (a.width * a.height);
      })[0] || null;
      const send = [...document.querySelectorAll('button')].find((node) => /^(发送消息|send message)$/i.test(textOf(node)));
      const stop = [...document.querySelectorAll('button,[role="button"]')].find((node) => /(停止生成|停止回答|stop generation|stop response|cancel generation)/i.test(textOf(node)) && !node.disabled);
      const thoughts = [...document.querySelectorAll('[data-variant="think"]')].map((node) => ({ state: node.getAttribute('data-state'), expanded: node.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') || null }));
      const inputEnabled = Boolean(input && !input.disabled && input.getAttribute('aria-disabled') !== 'true' && input.getAttribute('contenteditable') !== 'false');
      return { inputReady: Boolean(input), inputEnabled, sendReady: Boolean(send && !send.disabled), stopGone: !stop, thoughts, bodyTail: String(document.body?.innerText || '').slice(-1200) };
    })()`, true);
    if (recovered?.inputEnabled && recovered?.stopGone && recovered.thoughts.every((item) => item.state !== 'running' && item.expanded !== 'true')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  evidence.stopElapsedMs = Date.now() - stopStarted;
  evidence.recovered = recovered;
  const pidAlive = (pid) => new Promise((resolve) => {
    const numeric = Number(pid);
    if (!Number.isInteger(numeric) || numeric <= 0) { resolve(false); return; }
    const target = String(numeric);
    execFile('tasklist.exe', ['/FI', `PID eq ${target}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (_error, stdout) => {
      const listed = String(stdout || '').split(/\r?\n/).some((line) => {
        const fields = line.match(/"([^"]*)"/g)?.map((value) => value.slice(1, -1)) || [];
        return fields[1] === target;
      });
      if (listed || !_error) { resolve(listed); return; }
      try { process.kill(numeric, 0); resolve(true); } catch { resolve(false); }
    });
  });
  const processDeadline = Date.now() + 7000;
  let workerAlive = true; let descendantAlive = true;
  while (Date.now() < processDeadline) {
    [workerAlive, descendantAlive] = await Promise.all([pidAlive(fixturePids.worker), pidAlive(fixturePids.descendant)]);
    if (!workerAlive && !descendantAlive) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  evidence.processTreeExited = !workerAlive && !descendantAlive;

  const second = await frame.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const textOf = (node) => [node?.innerText, node?.textContent, node?.getAttribute?.('aria-label'), node?.getAttribute?.('title')].filter(Boolean).join(' ').trim();
    const visible = (node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8; };
    const input = [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter((node) => visible(node) && node.getBoundingClientRect().width > 40 && node.getBoundingClientRect().height > 20).sort((left, right) => {
      const a = left.getBoundingClientRect(); const b = right.getBoundingClientRect(); return (b.width * b.height) - (a.width * a.height);
    })[0] || null;
    const findSend = () => [...document.querySelectorAll('button')].filter(visible).find((node) => /(发送消息|send message)/i.test(textOf(node)) && !/(停止|stop)/i.test(textOf(node)));
    let send = findSend();
    if (!input) return { submitted: false, reason: 'composer-unavailable' };
    const value = 'SECOND_REQUEST';
    if (input.matches('textarea')) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, value); else input.textContent = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 40 && (!send || send.disabled); attempt += 1) {
      await sleep(50);
      send = findSend() || send;
    }
    if (!send || send.disabled) return { submitted: false, reason: send ? 'send-disabled' : 'send-missing', inputDisabled: Boolean(input.disabled), inputValue: String(input.value ?? input.textContent ?? '').slice(0, 80), inputOuter: input.outerHTML.slice(0, 1200), inputParent: input.parentElement?.parentElement?.outerHTML?.slice(0, 5000) || null, inputs: [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].filter(visible).map((node) => ({ tag: node.tagName, placeholder: node.getAttribute('placeholder'), aria: node.getAttribute('aria-label'), role: node.getAttribute('role'), value: String(node.value ?? node.textContent ?? '').slice(0, 80), outer: node.outerHTML.slice(0, 600) })), buttons: [...document.querySelectorAll('button')].filter(visible).map((node) => ({ label: textOf(node).slice(0, 80), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), disabled: Boolean(node.disabled), outer: node.outerHTML.slice(0, 600) })).slice(-40) };
    send.click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const body = String(document.body?.innerText || '');
      if (body.includes('SECOND_OK')) return { submitted: true, answered: true };
      await sleep(100);
    }
    return { submitted: true, answered: false };
  })()`, true);
  evidence.secondRequest = second;
  evidence.ok = evidence.firstSubmitted && stopped.clicked && evidence.stopElapsedMs < 15000
    && recovered?.inputEnabled && recovered?.stopGone
    && recovered.thoughts.every((item) => item.state !== 'running' && item.expanded !== 'true')
    && evidence.processTreeExited && second?.submitted && second?.answered;
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error(`Generation cancellation probe failed: ${JSON.stringify(evidence)}`);
  return evidence;
}

async function probeRuntimeIntegrations() {
  const frameDeadline = Date.now() + 30000;
  let frame = currentHarnessFrame();
  while (!frame && Date.now() < frameDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    frame = currentHarnessFrame();
  }
  if (!frame) throw new Error('Harness frame unavailable for runtime integration probe');
  const prepared = await frame.executeJavaScript(`(async () => {
    const deadline = Date.now() + 25000;
    while (!document.querySelector('[data-dsh-better-sidebar]') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    const labels = () => [...document.querySelectorAll('button,[role="button"]')].map((node) => ({ node, label: String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim() }));
    const bottom = labels().find((item) => /展开底部面板|expand bottom panel/i.test(item.label));
    bottom?.node.click();
    const terminalCard = [...document.querySelectorAll('button')].find((node) => /^(终端|terminal)$/i.test(String(node.innerText || node.getAttribute('aria-label') || '').trim()));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (typeof window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__ === 'function') window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__();
    else if (typeof window.__TASKHIVE_OPEN_TERMINAL__ === 'function') window.__TASKHIVE_OPEN_TERMINAL__();
    else terminalCard?.click();
    const terminalDeadline = Date.now() + 15000;
    while (!document.querySelector('.xterm') && Date.now() < terminalDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
    const helper = document.querySelector('.xterm-helper-textarea');
    helper?.focus();
    return {
      sidebarMounted: Boolean(document.querySelector('[data-dsh-better-sidebar]')),
      moduleBridge: Boolean(globalThis.__DSH_MODULES__),
      moduleImport: typeof globalThis.__DSH_MODULES__?.import === 'function',
      bottomToggleFound: Boolean(bottom),
      terminalCardFound: Boolean(terminalCard) || typeof window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__ === 'function' || typeof window.__TASKHIVE_OPEN_TERMINAL__ === 'function',
      terminalBridge: typeof window.__DSH_BETTER_SIDEBAR_OPEN_TERMINAL__ === 'function',
      xtermMounted: Boolean(document.querySelector('.xterm')),
      helperFocused: document.activeElement === helper,
      chunkError: String(document.body?.innerText || '').includes('client module system unavailable'),
    };
  })()`, true);
  // Use the mounted terminal's real WebSocket/PTY path.  Synthetic DOM
  // KeyboardEvents on xterm's helper textarea are intentionally ignored by
  // browsers and do not reach the pty; the narrow diagnostics hook installed
  // by TerminalView sends the exact bytes that xterm's onData handler sends.
  const terminalInputSent = await frame.executeJavaScript(`(async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const send = globalThis.__DSH_TERMINAL_TEST_SEND__;
      if (typeof send === 'function' && send('echo TASKHIVE_SIDEBAR_TERMINAL_OK\\r')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  })()`, true);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const terminal = await frame.executeJavaScript(`(() => ({
    text: String(globalThis.__DSH_TERMINAL_TEST_TEXT__ || document.querySelector('.xterm-rows')?.innerText || document.querySelector('.xterm-screen')?.innerText || document.querySelector('.xterm')?.innerText || '').slice(-4000),
    chunkError: String(document.body?.innerText || '').includes('client module system unavailable'),
    visibleError: [...document.querySelectorAll('body *')].some((node) => /\\[dsh-better-sidebar\\].*error/i.test(String(node.textContent || '')) && node.getBoundingClientRect().width > 0),
  }))()`, true);
  const memory = await frame.executeJavaScript(`(async () => {
    const entry = [...document.querySelectorAll('button,[role="button"]')].find((node) => /记忆系统|memory system/i.test(String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').trim()));
    entry?.click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const text = String(document.body?.innerText || '');
      if (!/检查中|checking/i.test(text) && (/已连接|connected|CLI:/i.test(text) || /未找到 Mnemon CLI|Mnemon CLI.*not found/i.test(text))) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const text = String(document.body?.innerText || '');
    return {
      entryFound: Boolean(entry),
      commandMissing: /未找到 Mnemon CLI|Mnemon CLI.*not found/i.test(text),
      checking: /检查中|checking/i.test(text),
      connected: /已连接|connected|CLI:/i.test(text),
      text: text.slice(-8000),
    };
  })()`, true);
  const mnemonCli = path.join(root, 'plugins', 'runtimes', 'mnemon', '0.2.5', 'windows-x64', 'mnemon.exe');
  const evidence = {
    ok: prepared.sidebarMounted && prepared.moduleBridge && prepared.moduleImport && prepared.terminalCardFound && prepared.xtermMounted && !terminal.chunkError && !terminal.visibleError && /TASKHIVE_SIDEBAR_TERMINAL_OK/.test(terminal.text) && memory.entryFound && !memory.commandMissing && !memory.checking,
    prepared,
    terminal,
    terminalInputSent,
    memory,
    mnemon: { cliPath: mnemonCli, commandFound: fs.existsSync(mnemonCli), dataDir: path.join(runtimeRoot, 'knowledge', 'mnemon-native') },
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(root, 'logs', 'runtime-integrations-probe.json'), JSON.stringify(evidence, null, 2), 'utf8');
  if (!evidence.ok) throw new Error(`Runtime integrations probe failed: ${JSON.stringify({ prepared, terminal, memory })}`);
  return evidence;
}

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
  startDirectoryManifestSync();
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
  codesysScriptEngine = new CodesysScriptEngine(root);
  codesysInput = new CodesysInputController(root, monitor);
  codesysNativeHost = new CodesysNativeHost(root, monitor);
  repositories = { knowledge: new RepositoryManager(root, 'knowledge'), experts: new RepositoryManager(root, 'experts') };
  expertConfig = new ExpertConfigStore(root);
  directoryStore = new DirectoryStore(root, programRoot);
  codesysLaunchedRegistry = new CodesysLaunchedRegistry(root);
  // A previous session that died without running its exit cleanup leaves CODESYS
  // instances running in the background. Sweep them now, under the same safety
  // rules (never touch unsaved work, never touch a recycled PID).
  const leftoverCodesysInstances = codesysLaunchedRegistry.pending();
  if (leftoverCodesysInstances.length) {
    void closeLaunchedCodesysInstances('startup-sweep', leftoverCodesysInstances)
      .then(() => codesysLaunchedRegistry?.markCleanExit())
      .catch(() => {});
  }
  modlens = new ModLensExecutor(root);
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
  fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} main-window-created smoke=${smokeLaunch()} argv=${JSON.stringify(process.argv)}\n`, 'utf8');
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
        if (process.argv.includes('--smoke-vision')) await probeModLensVision();
        if (process.argv.includes('--probe-dsh-tool-call') || process.argv.includes('--probe-dsh-expert-run') || process.argv.includes('--probe-dsh-codesys-scriptengine')) await probeDshToolCall();
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
        const codesysSurface = await openSurfaceForProbe('codesys', '#vision-status');
        await codesysSurface.executeJavaScript("new Promise((resolve) => { const deadline = Date.now() + 15000; const check = () => { const text = document.querySelector('#vision-status')?.textContent || ''; if (text && !text.includes('正在检查')) return resolve(text); if (Date.now() >= deadline) return resolve(text); setTimeout(check, 100); }; check(); })", true);
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
        fs.writeFileSync(path.join(root, 'logs', 'electron-smoke.json'), JSON.stringify({ ok: true, harness: harness.status(), mainUrl: mainWindow.webContents.getURL(), pluginSurface: { kind: pluginSurfaceKind, bounds: pluginSurfaceBounds }, windowCount: BrowserWindow.getAllWindows().length, splashAlive: Boolean(splashWindow && !splashWindow.isDestroyed()), mainAlwaysOnTop: mainWindow.isAlwaysOnTop(), at: new Date().toISOString() }, null, 2), 'utf8');
        markSmokeStage('complete');
        if (codesysScreenshotError) fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} codesys-screenshot-unavailable ${codesysScreenshotError}\n`, 'utf8');
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
          const nativeGptModels = ['GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5'].filter((label) => pickerText.includes(label));
          const nativeClaudeModels = ['Claude Opus', 'Claude Sonnet', 'Claude Haiku'].filter((label) => pickerText.includes(label));
          for (let index = 0; index < 2; index += 1) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 100)); }
          return { modelTrigger: Boolean(modelTrigger), modelRow: Boolean(modelRow), pickerText, nativeWebModels, nativeLocalModels, nativeGptModels, nativeClaudeModels };
        };
        const initialNative = await readNativeModels();
        // Expected picker counts, derived from the catalog the app just reported.
        // The visibility map is user-editable, so the invariant is "the picker
        // shows exactly the visible models", not a fixed number.
        let expected = { gpt: 0, web: 0, local: 0 };
        try {
          const cat = await window.taskhive.listModels();
          const visibleCount = (pid) => { const entry = cat.providers.find((item) => item.id === pid); return ((entry && entry.models) || []).filter((m) => cat.visibility[pid + '::' + m] !== false).length; };
          expected = { gpt: visibleCount('codex-cli'), web: visibleCount('web-ai'), local: visibleCount('ollama-local') };
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
        const nonWebVision = (verifiedCatalog.providers || []).filter((provider) => !['web-ai','modlens-vision','video-local'].includes(provider.id)).every((provider) => provider.vision?.state === 'ready' && provider.inputModalities?.includes('image'));
        const webVisionBoundary = verifiedCatalog.providers.find((provider) => provider.id === 'web-ai')?.vision?.state === 'unsupported';
        return { visible: modelSettingsVisible, options, defaultRoute: verifiedCatalog.defaultRoute, firstCatalogOpenMs, expected, settingsText, pickerText: initialNative.pickerText.slice(-5000), nativeModelPicker: initialNative.modelTrigger, nativeModelPane: initialNative.modelRow, nativeWebModels: initialNative.nativeWebModels, nativeLocalModels: initialNative.nativeLocalModels, nativeGptModels: initialNative.nativeGptModels, nativeClaudeModels: initialNative.nativeClaudeModels, hiddenNativeWebModels: hiddenNative.nativeWebModels, restoredNativeWebModels: restoredNative.nativeWebModels, hiddenNativeLocalModels, restoredNativeLocalModels, hiddenNativeLocalProbe, restoredNativeLocalProbe, nativeVisibilityRoundTrip, localUiRoundTrip, separateWebSelector: Boolean(document.querySelector('[data-taskhive-web-model="true"]')), customRoundTrip, nonWebVision, webVisionBoundary, hasCodex6: options.some((item) => item.providerId === 'codex-cli' && item.modelId === 'gpt-6-astra'), hasCodex55: options.some((item) => item.providerId === 'codex-cli' && item.modelId === 'gpt-5.5'), hasClaudeReady: options.some((item) => item.providerId === 'claude-code' && item.modelId === 'sonnet' && item.state === 'ready'), hasWebAiReady: options.some((item) => item.providerId === 'web-ai' && item.modelId === 'claude-web' && item.state === 'ready') };
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
      const visibleCodexCount = expected.gpt;
      const visibleWebCount = expected.web;
      const visibleLocalCount = expected.local;
      fs.writeFileSync(path.join(root, 'logs', 'model-smoke.json'), JSON.stringify({ ok: result.visible && result.firstCatalogOpenMs <= 1500 && result.nativeModelPicker === true && result.nativeModelPane === true && visibleWebCount >= 1 && result.nativeWebModels?.length === visibleWebCount && result.nativeLocalModels?.length === visibleLocalCount && result.nativeGptModels?.length >= 2 && result.nativeGptModels?.length === visibleCodexCount && result.nativeClaudeModels?.length === 3 && result.nativeVisibilityRoundTrip === true && result.localUiRoundTrip === true && result.separateWebSelector === false && result.customRoundTrip === true && result.nonWebVision === true && result.webVisionBoundary === true && result.hasCodex6 === true && result.hasCodex55 === true && result.hasClaudeReady === true && result.hasWebAiReady === true, visibleCodexCount, visibleWebCount, visibleLocalCount, result, at: new Date().toISOString() }, null, 2), 'utf8');
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
      const ok = runtime.state === 'ready' && mainAlive && !splashAlive;
      if (!ok && Date.now() < settleDeadline) { setTimeout(settle, 250); return; }
      fs.appendFileSync(path.join(root, 'logs', 'desktop.log'), `${new Date().toISOString()} smoke-autoclose ok=${ok}\n`, 'utf8');
      fs.writeFileSync(path.join(root, 'logs', 'electron-smoke.json'), JSON.stringify({ ok, runtime, harness: harness.status(), mainAlive, splashAlive, windows: BrowserWindow.getAllWindows().length, at: new Date().toISOString() }, null, 2), 'utf8');
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

process.on('unhandledRejection', (reason) => {
  reportFatal('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  // Continuing after an uncaught exception leaves the main process in an
  // unknown state (stale windows, orphaned Harness child, half-applied writes).
  reportFatal('uncaughtException', error);
});
