//#region packages/contracts/src/index.ts
const BUILTIN_MEMORY_LAYER_IDS = [
	"runtime",
	"documents",
	"memory-spaces"
];
const MEMORY_CAPABILITIES = [
	"status",
	"project",
	"recall",
	"search",
	"read",
	"browse",
	"write",
	"archive",
	"graph",
	"related",
	"link",
	"forget",
	"maintain",
	"export",
	"import"
];
const MEMORY_STRATEGY_HOOKS = [
	"admission",
	"placement",
	"retrieval-planning",
	"quality-fusion",
	"projection",
	"promotion-demotion",
	"retention",
	"maintenance"
];
const MEMORY_SOURCE_MODES = ["eager", "routed"];
//#endregion
export { BUILTIN_MEMORY_LAYER_IDS, MEMORY_CAPABILITIES, MEMORY_SOURCE_MODES, MEMORY_STRATEGY_HOOKS };
