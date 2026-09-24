const DOCUMENTS_MEMORY_LAYER = Object.freeze({
	id: "documents",
	label: "Documents",
	description: "Versioned narrative documents searched first and read in full on demand.",
	role: "narrative",
	order: 200,
	capabilities: [
		"status",
		"project",
		"recall",
		"search",
		"read",
		"browse",
		"write",
		"archive",
		"maintain",
		"export",
		"import"
	]
});
function registerDocumentsMemoryLayer(catalog, registration = {}) {
	return catalog.registerLayer({
		descriptor: {
			...DOCUMENTS_MEMORY_LAYER,
			capabilities: [...DOCUMENTS_MEMORY_LAYER.capabilities]
		},
		...registration
	});
}
//#endregion
export { DOCUMENTS_MEMORY_LAYER, registerDocumentsMemoryLayer };
