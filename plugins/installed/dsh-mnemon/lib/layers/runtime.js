const RUNTIME_MEMORY_LAYER = Object.freeze({
	id: "runtime",
	label: "Runtime Memory",
	description: "Bounded, deterministic memory projected into every eligible turn.",
	role: "working-context",
	order: 100,
	capabilities: [
		"status",
		"project",
		"read",
		"write",
		"maintain",
		"export",
		"import"
	]
});
function registerRuntimeMemoryLayer(catalog, registration = {}) {
	return catalog.registerLayer({
		descriptor: {
			...RUNTIME_MEMORY_LAYER,
			capabilities: [...RUNTIME_MEMORY_LAYER.capabilities]
		},
		...registration
	});
}
//#endregion
export { RUNTIME_MEMORY_LAYER, registerRuntimeMemoryLayer };
