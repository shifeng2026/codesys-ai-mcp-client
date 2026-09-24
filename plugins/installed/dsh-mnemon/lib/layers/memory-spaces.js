const MEMORY_SPACES_LAYER = Object.freeze({
	id: "memory-spaces",
	label: "Memory Spaces",
	description: "Provider-backed durable evidence recalled across tasks and sessions.",
	role: "durable-evidence",
	order: 300,
	capabilities: [
		"status",
		"project",
		"recall",
		"search",
		"read",
		"browse",
		"write",
		"graph",
		"related",
		"link",
		"forget",
		"maintain",
		"export",
		"import"
	]
});
function registerMemorySpacesLayer(catalog, registration = {}) {
	return catalog.registerLayer({
		descriptor: {
			...MEMORY_SPACES_LAYER,
			capabilities: [...MEMORY_SPACES_LAYER.capabilities]
		},
		...registration
	});
}
//#endregion
export { MEMORY_SPACES_LAYER, registerMemorySpacesLayer };
