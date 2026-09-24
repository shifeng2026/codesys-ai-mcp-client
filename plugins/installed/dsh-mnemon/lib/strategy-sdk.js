//#region packages/strategy-sdk/src/index.ts
const MEMORY_STRATEGY_PLUGIN_API_VERSION = "dsh-mnemon/v1alpha1";
/** Define an immutable, declarative strategy package; the Kernel remains authoritative. */
function defineMemoryStrategyPlugin(plugin) {
	if (plugin.manifest.apiVersion !== "dsh-mnemon/v1alpha1") throw new Error(`unsupported memory strategy plugin API: ${plugin.manifest.apiVersion}`);
	if (plugin.manifest.kind !== "MemoryStrategyPlugin") throw new Error("memory strategy plugin kind must be MemoryStrategyPlugin");
	if (plugin.manifest.metadata.id !== plugin.strategy.descriptor.id || plugin.manifest.metadata.version !== plugin.strategy.descriptor.version) throw new Error("memory strategy plugin manifest does not match its strategy identity");
	if (!Number.isInteger(plugin.manifest.permissions.maxSteps) || plugin.manifest.permissions.maxSteps < 1 || plugin.manifest.permissions.maxSteps > 100) throw new Error("memory strategy plugin maxSteps must be an integer within 1..100");
	const manifest = Object.freeze({
		...plugin.manifest,
		metadata: Object.freeze({ ...plugin.manifest.metadata }),
		permissions: Object.freeze({
			...plugin.manifest.permissions,
			layerIds: Object.freeze([...new Set(plugin.manifest.permissions.layerIds)]),
			adapterIds: Object.freeze([...new Set(plugin.manifest.permissions.adapterIds)]),
			capabilities: Object.freeze([...new Set(plugin.manifest.permissions.capabilities)])
		})
	});
	const allowedLayers = new Set(manifest.permissions.layerIds);
	const allowedAdapters = new Set(manifest.permissions.adapterIds);
	const allowedCapabilities = new Set(manifest.permissions.capabilities);
	const propose = plugin.strategy.propose.bind(plugin.strategy);
	const strategy = Object.freeze({
		descriptor: Object.freeze({
			...plugin.strategy.descriptor,
			hooks: Object.freeze([...plugin.strategy.descriptor.hooks])
		}),
		async propose(request, context) {
			if (!allowedCapabilities.has(request.capability)) throw new Error(`memory strategy plugin is not permitted to use ${request.capability}`);
			const proposal = await propose(request, context);
			if (proposal.steps.length > manifest.permissions.maxSteps) throw new Error(`memory strategy plugin proposed ${proposal.steps.length} steps; manifest allows ${manifest.permissions.maxSteps}`);
			for (const step of proposal.steps) {
				if (!allowedLayers.has(step.layerId)) throw new Error(`memory strategy plugin is not permitted to use layer ${step.layerId}`);
				if (!allowedCapabilities.has(step.capability)) throw new Error(`memory strategy plugin is not permitted to use ${step.capability}`);
				if (step.adapterId !== void 0 && !allowedAdapters.has(step.adapterId)) throw new Error(`memory strategy plugin is not permitted to use adapter ${step.adapterId}`);
			}
			return proposal;
		}
	});
	return Object.freeze({
		manifest,
		strategy
	});
}
/** Deterministic replay primitive for generated and hand-written strategies. */
async function replayMemoryStrategy(strategy, cases) {
	for (const replay of cases) {
		const proposal = await strategy.propose(replay.request, replay.descriptor);
		await replay.assert(proposal);
	}
}
function defineMemoryStrategy(strategy) {
	return strategy;
}
//#endregion
export { MEMORY_STRATEGY_PLUGIN_API_VERSION, defineMemoryStrategy, defineMemoryStrategyPlugin, replayMemoryStrategy };
