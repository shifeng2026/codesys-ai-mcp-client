'use strict';

// Contract for task decomposition and multi-model dispatch.
//
// The user asked whether TaskHive needs its own expert/orchestration layer and
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
const { existsSync, readFileSync } = require('fs');
const { join } = require('path');

const appRoot = join(__dirname, '..');
const read = (relative) => readFileSync(join(appRoot, relative), 'utf8');

const presetPath = join(
  'harness', 'runtime', 'slot', 'payload', 'node_modules', '.pnpm', 'node_modules',
  '@deepseek-ai', 'dsh-agent-presets', 'presets', 'cordis', 'agent.cordis.yml',
);
assert(existsSync(join(appRoot, presetPath)), 'the cordis agent preset must ship in the slot payload');
const preset = read(presetPath);

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
assert(/scheduleModelCatalogRefresh\(\)/.test(main.slice(main.indexOf("ipcMain.handle('models:set-visible'"))), 'toggling visibility must refresh the Harness model registry');

// ── 6. The TaskHive experts surface must not be a second agent loop ───────
// Its run path already goes through `ctx.subagents.start('spawn', ...)` with the
// parent agent attached, so it is delegation on the native seam rather than a
// parallel loop. What it must also do is actually route each expert to its own
// model, and report it when it cannot.
const expertsManifest = JSON.parse(read(join('plugins', 'installed', 'experts', 'plugin.json')));
assert(expertsManifest.capabilities.includes('expert.agent-teams'), 'the experts surface keeps its configuration capabilities');
const surfacesIndex = read(join('plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js'));
assert(/ctx\.subagents\.start\('spawn'/.test(surfacesIndex), 'expert runs must delegate through the native subagent seam');
assert(/parent: exec\.agent/.test(surfacesIndex), 'child experts must be parented to the live agent');
assert(/agentOptions: \{ provider: route\.provider, model: route\.model/.test(surfacesIndex), 'each expert must pass its own provider/model as agentOptions');
assert(/toolFilter: \{ allow: \[/.test(surfacesIndex), 'child experts must stay inside a read-only tool scope');
assert(/maxDepth: 1/.test(surfacesIndex), 'child experts must not be able to recurse');
assert(/await run\.dispose\(\)/.test(surfacesIndex), 'child experts must be disposed after the run');
assert(!/new Agent\(|createAgent\(|runAgentLoop\(/.test(surfacesIndex), 'TaskHive must not create its own agent loop');

// ── 7. Multi-model must be the default and must not fail silently ─────────
// `routeMode` used to default to `inherited`, so a configured team ran every
// expert on the parent model; and an unresolvable configured route was swallowed
// by an empty catch, so a misconfigured expert silently became the parent model.
assert(/const routeMode = args\.routeMode === 'inherited' \? 'inherited' : 'configured'/.test(surfacesIndex), 'per-expert routing must be the default');
assert(surfacesIndex.includes('const PROVIDER_ALIASES = Object.freeze('), 'short provider names must be aliased to registered ids');
assert(/ollama: 'ollama-local'/.test(surfacesIndex), 'the shipped team says `ollama`; it must map to `ollama-local`');
assert(surfacesIndex.includes('const resolveRegisteredProviderId = (ctx, requested) =>') || surfacesIndex.includes('function resolveRegisteredProviderId(ctx, requested)'), 'provider ids must be resolved against the registry');
assert(/fallbackReason: reason/.test(surfacesIndex), 'a failed configured route must be reported, not swallowed');
assert(!/catch \{\}/.test(surfacesIndex.slice(surfacesIndex.indexOf('async function expertRoute'), surfacesIndex.indexOf('function expertPrompt'))), 'expertRoute must not swallow the resolution failure');
assert(/routeSummary,/.test(surfacesIndex), 'the run must report which models actually ran');
assert(/multiModel: usedRoutes\.length > 1/.test(surfacesIndex), 'the summary must state whether the team was genuinely multi-model');
assert(/routeSummary: \{ type: 'object' \}/.test(surfacesIndex), 'routeSummary must be in the tool output schema, which forbids extra properties');
assert(/provider: \{ type: 'string' \}, model: \{ type: 'string' \}, reasoningEffort: \{ type: 'string' \}/.test(surfacesIndex), 'the tool must accept a per-call route override');

// ── 8. The experts UI must be able to set a per-expert route ──────────────
// Only the create form had a model picker, so a seeded expert kept an unusable
// provider forever and there was no way to fix it from the UI.
const renderer = read(join('app', 'renderer', 'renderer.js'));
assert(renderer.includes('expertRouteSelect'), 'the expert cards must expose a route selector');
assert(/data-expert-model=/.test(renderer), 'each expert card must carry a route select');
assert(/window\.taskhive\.updateExpert\(\{ id: select\.dataset\.expertModel, providerId/.test(renderer), 'changing the route must persist through updateExpert');
assert(/不在可用模型目录/.test(renderer), 'an unusable configured route must be shown as invalid rather than rendered blank');

// ── 9. Follow-up multi-turn must go through startContinuable ─────────────
// One-shot delegation disposes the child at settlement, so it can never be
// asked anything else. The durable form is `startContinuable`, whose stable
// childId the native `send_message` / `list-agents` / `interrupt` control tools
// address — those tools are already mounted by the agent preset (asserted in
// section 1), so no extra TaskHive orchestrator is needed.
assert(/ctx\.subagents\.startContinuable\(/.test(surfacesIndex), 'the expert path must be able to start durable continuable children')
assert(/provider: 'spawn',\s*\n\s*label:/.test(surfacesIndex), 'startContinuable must name the provider and label')
assert(/request: subagentRequest,/.test(surfacesIndex), 'startContinuable must pass the same request shape as the one-shot path')
assert(/stopReason: 'dispatched'/.test(surfacesIndex), 'a continuable dispatch must report itself as dispatched, not completed')
assert(/childId: String\(started\?\.childId \|\| ''\)/.test(surfacesIndex), 'the durable child id must be captured')
assert(/children: runs\.filter\(\(run\) => run\.childId\)/.test(surfacesIndex), 'the run must return the child ids for follow-up')
assert(/tool: 'send_message'/.test(surfacesIndex), 'the follow-up path must name the native control tool')
assert(/querySelector|list-agents/.test(surfacesIndex) || /list-agents/.test(surfacesIndex), 'the follow-up guidance must mention discovering live children')
// Continuable children must NOT be disposed, or follow-up is impossible.
const continuableStart = surfacesIndex.indexOf('if (canContinue) {');
assert(continuableStart !== -1, 'the continuable branch must exist');
// Anchor on the one-shot call (`start(`, not `startContinuable(`) and take the
// nearest preceding `try {`, because the continuable branch has its own try.
const oneShotCall = surfacesIndex.indexOf('run = await ctx.subagents.start(');
assert(oneShotCall > continuableStart, 'the one-shot call must follow the continuable branch');
const oneShotTry = surfacesIndex.lastIndexOf('try {', oneShotCall);
const continuableBranch = surfacesIndex.slice(continuableStart, oneShotTry);
assert(continuableBranch.includes('startContinuable'), 'the continuable branch must use startContinuable')
assert(!/\.dispose\(\)/.test(continuableBranch), 'the continuable branch must not call dispose() on the child')
// A provider that refuses continuable creation must fall back, not silently fail.
assert(/return \{ stageId: stage.id, \.\.\.routeFields, stopReason: 'error', continuable: false/.test(surfacesIndex), 'a refused continuable start must be reported per stage')
assert(/continuableFallback/.test(surfacesIndex), 'an unavailable startContinuable must be recorded')
// No empty knowledge card when a dispatch has no outputs yet.
assert(/retentionText && !canContinue/.test(surfacesIndex), 'a continuable dispatch must not retain an empty candidate')
// Tool schema must admit the new fields, since it forbids extra properties.
for (const field of ['continuable', 'children', 'followUp', 'continuation']) {
  assert(surfacesIndex.includes(`${field}: { type:`) || surfacesIndex.includes(`${field}: { type: 'boolean' }`), `the tool schema must declare ${field}`)
}

// A dispatched child has not failed. Counting 'dispatched' as a failure made
// every continuable run look broken and needlessly started the failure-only
// takeover expert, so both the count and the fallback trigger must use the
// shared predicate.
assert(surfacesIndex.includes("const isFailure = (run) => run.stopReason !== 'completed' && run.stopReason !== 'dispatched'"), 'dispatched must not count as a failure')
assert(surfacesIndex.includes('const failedCount = runs.filter(isFailure).length'), 'failedCount must use the shared failure predicate')
assert(surfacesIndex.includes('if (runs.some(isFailure)) {'), 'the failure-only fallback stage must not trigger on dispatched children')
assert(!/runs\.some\(\(run\) => run\.stopReason !== 'completed'\)/.test(surfacesIndex), 'the old dispatched-counts-as-failure predicate must be gone')
// The refusal comment used to claim a one-shot fallback that never happens.
assert(!surfacesIndex.includes('so fall back to a one-shot run for this stage'), 'the refusal path must not claim a fallback it does not perform')

console.log('subagent delegation contract passed');
