import { RUNTIME_MEMORY_LAYER } from "./layers/runtime.js";
import { DOCUMENTS_MEMORY_LAYER } from "./layers/documents.js";
import { MEMORY_SPACES_LAYER } from "./layers/memory-spaces.js";
import { participationChannel } from "./kernel.js";
//#region packages/strategy-default-three-tier/src/index.ts
const BUILTIN_MEMORY_LAYERS = [
	RUNTIME_MEMORY_LAYER,
	DOCUMENTS_MEMORY_LAYER,
	MEMORY_SPACES_LAYER
];
const DEFAULT_LAYER_PARTICIPATION = Object.freeze({
	recall: "automatic",
	write: "automatic",
	projection: "automatic",
	maintenance: "automatic"
});
function topologyLayer(id) {
	return {
		id,
		enabled: true,
		participation: { ...DEFAULT_LAYER_PARTICIPATION },
		adapterIds: []
	};
}
const DEFAULT_THREE_TIER_TOPOLOGY = Object.freeze({
	id: "default-three-tier",
	strategyId: "default-three-tier",
	layers: Object.freeze([
		topologyLayer("runtime"),
		topologyLayer("documents"),
		topologyLayer("memory-spaces")
	])
});
function accepts(layer, request) {
	if (!layer.enabled) return false;
	const mode = layer.participation[participationChannel(request.capability)];
	if (mode === "off") return false;
	if (request.trigger !== "manual" && mode !== "automatic") return false;
	return true;
}
const DEFAULT_THREE_TIER_STRATEGY = {
	descriptor: {
		id: "default-three-tier",
		version: "1",
		label: "Default three-tier strategy",
		description: "Routes explicit operations to compatible enabled layers in stable topology order.",
		hooks: [
			"placement",
			"retrieval-planning",
			"projection",
			"maintenance"
		],
		deterministic: true
	},
	propose(request, context) {
		const candidates = request.candidateLayerIds === void 0 ? void 0 : new Set(request.candidateLayerIds);
		const adapters = request.adapterIds === void 0 ? void 0 : new Set(request.adapterIds);
		const descriptors = new Map(context.catalog.layers.map((layer) => [layer.id, layer]));
		const steps = [];
		for (const layer of context.topology.layers) {
			const descriptor = descriptors.get(layer.id);
			if (descriptor === void 0 || !descriptor.capabilities.includes(request.capability)) continue;
			if (candidates !== void 0 && !candidates.has(layer.id)) continue;
			if (!accepts(layer, request)) continue;
			const selectedAdapters = adapters === void 0 ? layer.adapterIds : layer.adapterIds.filter((id) => adapters.has(id));
			if (selectedAdapters.length === 0) steps.push({
				layerId: layer.id,
				capability: request.capability,
				...request.input === void 0 ? {} : { input: request.input }
			});
			else steps.push(...selectedAdapters.map((adapterId) => ({
				layerId: layer.id,
				adapterId,
				capability: request.capability,
				...request.input === void 0 ? {} : { input: request.input }
			})));
		}
		return {
			strategyId: this.descriptor.id,
			strategyVersion: this.descriptor.version,
			reason: steps.length === 0 ? `No enabled layer accepts ${request.capability} for a ${request.trigger} operation.` : `Selected ${steps.length} compatible step${steps.length === 1 ? "" : "s"} from the active three-tier topology.`,
			steps
		};
	}
};
function registerDefaultMemorySystem(catalog, layers = {}) {
	const disposers = [...BUILTIN_MEMORY_LAYERS.map((descriptor) => catalog.registerLayer({
		descriptor: {
			...descriptor,
			capabilities: [...descriptor.capabilities]
		},
		...layers[descriptor.id]
	})), catalog.registerStrategy(DEFAULT_THREE_TIER_STRATEGY)];
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
//#endregion
export { BUILTIN_MEMORY_LAYERS, DEFAULT_LAYER_PARTICIPATION, DEFAULT_THREE_TIER_STRATEGY, DEFAULT_THREE_TIER_TOPOLOGY, registerDefaultMemorySystem };
