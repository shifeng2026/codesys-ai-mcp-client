'use strict';

// Contract for task decomposition and multi-model dispatch.
//
// The user asked whether TaskHive needs its own orchestration layer and
// whether task splitting with per-task model routing should be built. The
// evidence says it already exists in the harness core, and that TaskHive must
// keep it available rather than shadow it with a second orchestration path
// (MASTER rule 4: one Agent lifecycle, owned by Harness/DSH).
//
// What the core ships, read from the slot that is actually launched:
//   * `@deepseek-ai/dsh-tool-subagent` — the model-facing delegation tool
//     ("Model-facing subagent delegation tool over the ctx.subagents seam").
//   * The cordis agent preset composes it twice: `subagent` over the in-process
//     `spawn` backend and `subagent_fork` over `fork`.
//   * `modelSelectionSettings: true` is what makes it MULTI-MODEL: it reads the
//     host's `subagent-model-selection` preference per new top-level session and
//     then exposes `provider` / `model` / `reasoning_effort` on the tool, plus a
//     shared `list_subagent_models` discovery tool. Child routes are recorded in
//     the session and inherited by grandchildren.
//   * `backgroundMode: continuable` plus `dsh-tool-subagent-control` gives
//     durable child agents the parent can message, interrupt and list.
//
// The one real limitation, from the same README: per-child model routing needs
// the subagent BACKEND to declare `agentOptions`. The in-process backends
// (spawn/fork) and the DSH SDK support it; ACP, Codex and Claude Code refuse it
// rather than ignoring it. The preset therefore keeps the codex/claude-code
// subagent providers disabled, and so does this contract.

const assert = require('assert');
const { registrationIndex } = require('./lib/source-anchors');
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const appRoot = join(__dirname, '..');
const read = (relative) => readFileSync(join(appRoot, relative), 'utf8');

// DSH 0.2.0-rc.1 dropped the `@deepseek-ai/dsh-agent-presets` package (and every
// agent.cordis.yml with it). The composition this install launches now ships in
// @deepseek-ai/dsh-web-app/presets/ (layered over @deepseek-ai/dsh-base).
const presetPath = join(
  'harness', 'runtime', 'slot', 'payload', 'node_modules', '.pnpm', 'node_modules',
  '@deepseek-ai', 'dsh-web-app', 'presets', 'cordis.patch.yml',
);
// T159：`harness/runtime/slot/payload` 只存在于真正的应用树里。`.repo-stage` 是镜像，
// 它没有 payload —— 所以先在本树找，找不到就回退到 `../resources/app`（同仓库的应用树）。
// 这样同一个测试文件在两棵树里都能跑，不必维护两份不同实现（两棵树分叉本身就是隐患）。
const presetRoots = [appRoot, join(appRoot, '..', 'resources', 'app')];
const presetRoot = presetRoots.find((candidate) => existsSync(join(candidate, presetPath)));
assert(presetRoot, 'the cordis agent preset must ship in the slot payload');
const preset = readFileSync(join(presetRoot, presetPath), 'utf8');

// ── 1. Native delegation is composed, with multi-model selection on ────────
assert(/dsh-tool-subagent'/.test(preset), 'the preset must mount the subagent delegation tool');
assert(/provider:\s*spawn/.test(preset), 'a spawn-backend delegate must exist');
assert(/provider:\s*fork/.test(preset), 'a fork-backend delegate must exist');
assert(/toolName:\s*subagent\b/.test(preset), 'the spawn delegate must be the `subagent` tool');
assert(/toolName:\s*subagent_fork/.test(preset), 'the fork delegate must be `subagent_fork`');
assert(/modelSelectionSettings:\s*true/.test(preset), 'per-subagent provider/model selection must be enabled; this is what makes dispatch multi-model');
assert(/backgroundMode:\s*continuable/.test(preset), 'delegation must stay continuable so children can be messaged');
assert(/dsh-tool-subagent-control/.test(preset), 'the continuable-subagent control tools must be mounted');
assert(/list-agents/.test(preset), 'the list-agents tool must be mounted');

// ── 2. The optional CLI subagent backends stay disabled ────────────────────
// They refuse `agentOptions`, so they could not honour a per-child model route.
for (const provider of ['codex', 'claude-code']) {
  const block = preset.slice(preset.indexOf(`provider: ${provider}`) - 200, preset.indexOf(`provider: ${provider}`) + 400);
  assert(preset.includes(`provider: ${provider}`), `the ${provider} subagent provider must be declared (as an opt-in)`);
  assert(/disabled:\s*true/.test(block), `the ${provider} subagent provider must stay disabled: it refuses per-child model routing`);
}

// ── 3. TaskHive must not shadow or disable the native path ────────────────
const main = read(join('app', 'main.js'));
const patchStart = main.indexOf('const patch = `# TaskHive1.0 model route');
assert(patchStart !== -1, 'the generated DSH patch must be present');
const patchTemplate = main.slice(patchStart, main.indexOf('fs.writeFileSync(patchPath', patchStart));
assert(!/subagent|delegation/.test(patchTemplate), 'the generated patch must not disable or re-route the native delegation group');
assert(/agent-default-model/.test(patchTemplate), 'the patch still owns the default model route');
// The only entries TaskHive disables are the ones it replaces. The template
// literal escapes its newlines, so match a literal `\n` as well as a real one.
const disabledIds = [...patchTemplate.matchAll(/- id:\s*([\w.-]+)(?:\\n|\s*\n)\s*disabled:\s*true/g)].map((match) => match[1]).sort();
assert.deepStrictEqual(disabledIds, ['llm-deepseek', 'web-search-deepseek'], `only the superseded DeepSeek plugin rows may be disabled, got ${JSON.stringify(disabledIds)}`);

// ── 4. Multi-model dispatch needs routable models to exist ────────────────
// A child can only be routed to a provider/model that is registered and
// visible, so the catalog must declare and expose more than one route.
const catalog = JSON.parse(read(join('profiles', 'model-catalog.json')));
const visibleRoutes = [];
for (const provider of catalog.providers) {
  for (const modelId of provider.models || []) {
    if (catalog.visibility[`${provider.id}::${modelId}`] !== false) visibleRoutes.push(`${provider.id}/${modelId}`);
  }
}
assert(visibleRoutes.length >= 2, 'at least two visible routes are required for multi-model dispatch to be meaningful');
assert(visibleRoutes.some((route) => route.startsWith('codex-cli/')), 'the Codex CLI route must be visible');
assert(visibleRoutes.some((route) => route.startsWith('claude-code/')), 'the Claude route must be visible');

// ── 5. A visibility change must actually reach the running Harness ────────
// Otherwise the model never appears in the composer and cannot be routed to.
assert(main.includes('function scheduleModelCatalogRefresh('), 'the catalog refresh helper must exist');
assert(/scheduleModelCatalogRefresh\(\)/.test(main.slice(registrationIndex(main, 'models:set-visible'))), 'toggling visibility must refresh the Harness model registry');

// ── 6. TaskHive ships no orchestration layer of its own ───────────────────
// The 专家团队 (experts) layer was deleted outright: TaskHive now relies on the
// native delegation path asserted in sections 1-5 above, and on the DSH-native
// Agent Teams tools the agent preset already mounts. This section keeps a second
// orchestration path from creeping back — it is the property the original
// section 6 protected, now stated as an absence.
assert(!existsSync(join(appRoot, 'plugins', 'installed', 'experts')), 'the TaskHive experts plugin must not come back');
assert(!existsSync(join(appRoot, 'experts')), 'the TaskHive experts data directory must not come back');
const pluginCatalog = JSON.parse(read(join('plugins', 'catalog.json')));
assert(!pluginCatalog.plugins.experts, 'the plugin catalog must not declare an experts plugin');
assert(!pluginCatalog.plugins['dsh-agent-teams'], 'the inert dsh-agent-teams descriptor must not be declared either');
assert(!(pluginCatalog.plugins['taskhive-surfaces'].capabilities || []).includes('expert.run'), 'taskhive-surfaces must not advertise an expert capability');
const surfacesIndex = read(join('plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js'));
assert(!/taskhive_expert_/.test(surfacesIndex), 'taskhive-surfaces must not register expert tools');
assert(!/runExpertTeam|expertDispatch/.test(surfacesIndex), 'taskhive-surfaces must not carry an expert dispatch path');
assert(!/new Agent\(|createAgent\(|runAgentLoop\(/.test(surfacesIndex), 'TaskHive must not create its own agent loop');
const hostMain = read(join('app', 'main.js'));
assert(!/experts:status|ExpertConfigStore|publishExpertStatus/.test(hostMain), 'the host main process must not carry experts IPC');
const hostPreload = read(join('app', 'preload.js'));
assert(!/experts:|onExpertStatus/.test(hostPreload), 'the preload bridge must not expose experts IPC');
const hostRenderer = read(join('app', 'renderer', 'renderer.js'));
assert(!/'experts'/.test(hostRenderer) && !/expertStatus|updateExpert|expertRouteSelect/.test(hostRenderer), 'the host renderer must not carry an experts surface');

console.log('subagent delegation contract passed');
