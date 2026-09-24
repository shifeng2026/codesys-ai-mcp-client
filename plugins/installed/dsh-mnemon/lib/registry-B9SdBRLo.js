import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
//#region src/process.ts
const DEFAULT_MAX_OUTPUT_BYTES = 2097152;
/** Spawn without a shell, with bounded output and cooperative cancellation. */
const runProcess = (command, args, options) => new Promise((resolve, reject) => {
	const label = options.label ?? "mnemon";
	const child = spawn(command, [...args], {
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		shell: false,
		windowsHide: true,
		...options.cwd === void 0 ? {} : { cwd: options.cwd },
		...options.env === void 0 ? {} : { env: options.env }
	});
	const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	let stdout = "";
	let stderr = "";
	let outputBytes = 0;
	let settled = false;
	let killTimer;
	const stop = () => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		child.kill("SIGTERM");
		killTimer = setTimeout(() => {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		}, 1500);
	};
	const finish = (error, result) => {
		if (settled) return;
		settled = true;
		clearTimeout(timeout);
		if (killTimer !== void 0) clearTimeout(killTimer);
		options.signal?.removeEventListener("abort", abort);
		if (error === null) resolve(result);
		else reject(error);
	};
	const abort = () => {
		stop();
		finish(/* @__PURE__ */ new Error(`${label} command aborted: ${String(options.signal?.reason ?? "cancelled")}`));
	};
	const append = (target, chunk) => {
		outputBytes += chunk.byteLength;
		if (outputBytes > maxOutputBytes) {
			stop();
			finish(/* @__PURE__ */ new Error(`${label} output exceeded ${maxOutputBytes} bytes`));
			return;
		}
		if (target === "stdout") stdout += chunk.toString("utf8");
		else stderr += chunk.toString("utf8");
	};
	child.stdout.on("data", (chunk) => {
		append("stdout", chunk);
	});
	child.stderr.on("data", (chunk) => {
		append("stderr", chunk);
	});
	child.on("error", (error) => {
		finish(/* @__PURE__ */ new Error(`failed to launch ${label} (${JSON.stringify(command)}): ${error.message}`));
	});
	child.on("close", (exitCode) => {
		finish(null, {
			stdout,
			stderr,
			exitCode
		});
	});
	const timeout = setTimeout(() => {
		stop();
		finish(/* @__PURE__ */ new Error(`${label} did not respond within ${options.timeoutMs}ms`));
	}, options.timeoutMs);
	if (options.signal?.aborted === true) abort();
	else options.signal?.addEventListener("abort", abort, { once: true });
});
//#endregion
//#region src/providers/catalog.ts
const NATIVE_CAPABILITIES = {
	search: true,
	browse: true,
	graph: true,
	entities: true,
	related: true,
	remember: true,
	link: true,
	forget: true,
	writeMode: "exact",
	deletionMode: "soft"
};
const REMOTE_EXACT_CAPABILITIES = {
	search: true,
	browse: true,
	graph: false,
	entities: false,
	related: false,
	remember: true,
	link: false,
	forget: true,
	writeMode: "exact",
	deletionMode: "hard"
};
const field = (value) => value;
const MEMORY_PROVIDER_IDS = [
	"mnemon-native",
	"openviking",
	"honcho",
	"mem0",
	"hindsight",
	"holographic",
	"retaindb",
	"byterover",
	"supermemory"
];
const MEMORY_PROVIDER_ID_SET = new Set(MEMORY_PROVIDER_IDS);
const MEMORY_PROVIDER_CATALOG = [
	{
		id: "mnemon-native",
		label: "mnemon",
		kind: "local",
		workspaceBinding: "automatic",
		summary: "Official local-first memory with exact writes, typed graph relations, and soft deletion.",
		origin: "native",
		capabilities: NATIVE_CAPABILITIES,
		fields: []
	},
	{
		id: "openviking",
		label: "OpenViking",
		kind: "remote",
		workspaceBinding: "provider-global",
		summary: "Filesystem-shaped shared memory with tiered reads and automatic semantic extraction.",
		origin: "third-party",
		capabilities: {
			...REMOTE_EXACT_CAPABILITIES,
			writeMode: "async-extracting"
		},
		fields: [
			field({
				key: "endpoint",
				label: "Endpoint",
				scope: "service",
				input: "url",
				required: true,
				defaultValue: "http://127.0.0.1:1933",
				placeholder: "http://127.0.0.1:1933"
			}),
			field({
				key: "targetUri",
				label: "Memory URI",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "viking://user/memories",
				placeholder: "viking://user/memories"
			}),
			field({
				key: "apiKey",
				label: "API key",
				scope: "service",
				input: "secret",
				required: false
			}),
			field({
				key: "account",
				label: "Account",
				scope: "service",
				input: "text",
				required: false
			}),
			field({
				key: "user",
				label: "User",
				scope: "memory",
				input: "text",
				required: false
			}),
			field({
				key: "actorPeerId",
				label: "Agent peer",
				scope: "memory",
				input: "text",
				required: false,
				defaultValue: "dsh"
			})
		]
	},
	{
		id: "honcho",
		label: "Honcho",
		kind: "remote",
		workspaceBinding: "provider-global",
		summary: "Cross-session user modelling, peer profiles, dialectic reasoning, and persistent conclusions.",
		origin: "third-party",
		capabilities: REMOTE_EXACT_CAPABILITIES,
		fields: [
			field({
				key: "endpoint",
				label: "Endpoint",
				scope: "service",
				input: "url",
				required: true,
				defaultValue: "https://api.honcho.dev"
			}),
			field({
				key: "apiKey",
				label: "API key",
				scope: "service",
				input: "secret",
				required: false
			}),
			field({
				key: "workspace",
				label: "Workspace",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh"
			}),
			field({
				key: "userId",
				label: "User peer",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh-user"
			}),
			field({
				key: "agentId",
				label: "Agent peer",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh"
			})
		]
	},
	{
		id: "mem0",
		label: "Mem0",
		kind: "remote",
		workspaceBinding: "provider-global",
		summary: "Automatic fact extraction, semantic retrieval, reranking, and deduplication.",
		origin: "third-party",
		capabilities: {
			...REMOTE_EXACT_CAPABILITIES,
			writeMode: "async-extracting"
		},
		fields: [
			field({
				key: "endpoint",
				label: "Endpoint",
				scope: "service",
				input: "url",
				required: true,
				defaultValue: "https://api.mem0.ai"
			}),
			field({
				key: "apiKey",
				label: "API key",
				scope: "service",
				input: "secret",
				required: false
			}),
			field({
				key: "mode",
				label: "Mode",
				scope: "service",
				input: "select",
				required: true,
				defaultValue: "platform",
				options: [{
					value: "platform",
					label: "Mem0 Platform"
				}, {
					value: "self-hosted",
					label: "Self-hosted server"
				}]
			}),
			field({
				key: "userId",
				label: "User ID",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh-user"
			}),
			field({
				key: "agentId",
				label: "Agent ID",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh"
			}),
			field({
				key: "rerank",
				label: "Rerank search results",
				scope: "memory",
				input: "boolean",
				required: false,
				defaultValue: false
			})
		]
	},
	{
		id: "hindsight",
		label: "Hindsight",
		kind: "remote",
		workspaceBinding: "provider-global",
		summary: "Knowledge-graph memory with entity resolution, observations, multi-strategy recall, and reflection.",
		origin: "third-party",
		capabilities: {
			...REMOTE_EXACT_CAPABILITIES,
			graph: true,
			entities: true,
			related: true,
			writeMode: "async-extracting",
			deletionMode: "soft"
		},
		fields: [
			field({
				key: "endpoint",
				label: "Endpoint",
				scope: "service",
				input: "url",
				required: true,
				defaultValue: "https://api.hindsight.vectorize.io"
			}),
			field({
				key: "apiKey",
				label: "API key",
				scope: "service",
				input: "secret",
				required: false
			}),
			field({
				key: "bankId",
				label: "Memory bank",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh"
			}),
			field({
				key: "budget",
				label: "Recall budget",
				scope: "memory",
				input: "select",
				required: true,
				defaultValue: "mid",
				options: [
					{
						value: "low",
						label: "Low"
					},
					{
						value: "mid",
						label: "Medium"
					},
					{
						value: "high",
						label: "High"
					}
				]
			})
		]
	},
	{
		id: "holographic",
		label: "Holographic",
		kind: "local",
		workspaceBinding: "optional-override",
		summary: "Local structured fact memory with trust scoring, entity resolution, and compositional retrieval.",
		origin: "third-party",
		capabilities: {
			...NATIVE_CAPABILITIES,
			link: false,
			deletionMode: "hard"
		},
		fields: [
			field({
				key: "dataPath",
				label: "Fact store path",
				scope: "service",
				role: "global-location",
				input: "path",
				required: false
			}),
			field({
				key: "defaultTrust",
				label: "Default trust",
				scope: "memory",
				input: "number",
				required: true,
				defaultValue: .5
			}),
			field({
				key: "minTrust",
				label: "Minimum recall trust",
				scope: "memory",
				input: "number",
				required: true,
				defaultValue: .3
			})
		]
	},
	{
		id: "retaindb",
		label: "RetainDB",
		kind: "remote",
		workspaceBinding: "provider-global",
		summary: "Cloud memory with hybrid vector/BM25 retrieval, profiles, and typed durable facts.",
		origin: "third-party",
		capabilities: REMOTE_EXACT_CAPABILITIES,
		fields: [
			field({
				key: "endpoint",
				label: "Endpoint",
				scope: "service",
				input: "url",
				required: true,
				defaultValue: "https://api.retaindb.com"
			}),
			field({
				key: "apiKey",
				label: "API key",
				scope: "service",
				input: "secret",
				required: true
			}),
			field({
				key: "project",
				label: "Project",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh"
			}),
			field({
				key: "userId",
				label: "User ID",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh-user"
			})
		]
	},
	{
		id: "byterover",
		label: "ByteRover",
		kind: "local",
		workspaceBinding: "optional-override",
		summary: "Local-first hierarchical knowledge tree accessed through the brv CLI.",
		origin: "third-party",
		capabilities: {
			...REMOTE_EXACT_CAPABILITIES,
			browse: false,
			forget: false,
			writeMode: "async-extracting",
			deletionMode: "unsupported"
		},
		fields: [
			field({
				key: "cliPath",
				label: "brv executable",
				scope: "service",
				input: "path",
				required: false,
				defaultValue: "brv"
			}),
			field({
				key: "defaultDirectory",
				label: "Default knowledge directory",
				scope: "service",
				role: "global-location",
				input: "path",
				required: false
			}),
			field({
				key: "workingDirectory",
				label: "Knowledge directory",
				scope: "memory",
				input: "path",
				required: false
			}),
			field({
				key: "apiKey",
				label: "Cloud API key",
				scope: "service",
				input: "secret",
				required: false
			})
		]
	},
	{
		id: "supermemory",
		label: "Supermemory",
		kind: "remote",
		workspaceBinding: "provider-global",
		summary: "Semantic memory, persistent profiles, conversation ingest, and multi-container recall.",
		origin: "third-party",
		capabilities: {
			...REMOTE_EXACT_CAPABILITIES,
			writeMode: "async-extracting",
			deletionMode: "soft"
		},
		fields: [
			field({
				key: "endpoint",
				label: "Endpoint",
				scope: "service",
				input: "url",
				required: true,
				defaultValue: "https://api.supermemory.ai"
			}),
			field({
				key: "apiKey",
				label: "API key",
				scope: "service",
				input: "secret",
				required: true
			}),
			field({
				key: "containerTag",
				label: "Container tag",
				scope: "memory",
				input: "text",
				required: true,
				defaultValue: "dsh"
			}),
			field({
				key: "searchMode",
				label: "Search mode",
				scope: "memory",
				input: "select",
				required: true,
				defaultValue: "hybrid",
				options: [
					{
						value: "hybrid",
						label: "Hybrid"
					},
					{
						value: "memories",
						label: "Memories"
					},
					{
						value: "documents",
						label: "Documents"
					}
				]
			})
		]
	}
];
function memoryProviderDescriptor(id) {
	const descriptor = MEMORY_PROVIDER_CATALOG.find((candidate) => candidate.id === id);
	if (descriptor === void 0) throw new Error(`unsupported memory provider: ${String(id)}`);
	return descriptor;
}
function isMemoryProviderId(value) {
	return typeof value === "string" && MEMORY_PROVIDER_ID_SET.has(value);
}
function normalizeUrl(value, label) {
	const normalized = value.trim().replace(/\/+$/u, "");
	let url;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error(`${label} must be a valid http(s) URL`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use http or https`);
	if (url.username !== "" || url.password !== "") throw new Error(`${label} must not contain credentials`);
	return normalized;
}
function normalizeString(value, field) {
	const normalized = typeof value === "string" ? value.trim() : value === void 0 || value === null ? "" : String(value).trim();
	if (normalized.length > (field.input === "secret" ? 8e3 : 2e3)) throw new Error(`${field.label} is too long`);
	if (field.required && normalized === "") throw new Error(`${field.label} is required`);
	if (field.input === "url" && normalized !== "") return normalizeUrl(normalized, field.label);
	if (field.options !== void 0 && normalized !== "" && !field.options.some((option) => option.value === normalized)) throw new Error(`${field.label} has an unsupported value`);
	return normalized;
}
function validateProviderSpecific(providerId, output) {
	if (providerId === "openviking" && output.targetUri !== void 0) {
		const targetUri = String(output.targetUri).replace(/\/+$/u, "");
		if (!/^viking:\/\/user(?:\/[^/]+)?\/memories$/u.test(targetUri)) throw new Error("OpenViking memory URI must be a viking://user/.../memories root");
		output.targetUri = targetUri;
	}
	if (providerId === "holographic") for (const key of ["defaultTrust", "minTrust"]) {
		if (output[key] === void 0) continue;
		const value = Number(output[key]);
		if (value < 0 || value > 1) throw new Error(`${key} must be within 0..1`);
	}
	if (providerId === "supermemory" && output.containerTag !== void 0) {
		const containerTag = String(output.containerTag);
		if (!/^[a-zA-Z0-9_:-]+$/u.test(containerTag) || containerTag.length > 100) throw new Error("Supermemory container tag may contain only letters, numbers, _, :, and - (max 100 characters)");
	}
}
function normalizeScopedProviderConnection(providerId, scope, input, previous = {}, clearSecrets = []) {
	const descriptor = memoryProviderDescriptor(providerId);
	if (providerId === "mnemon-native") return {};
	const fields = descriptor.fields.filter((item) => item.scope === scope);
	const allowed = new Set(fields.map((item) => item.key));
	for (const key of Object.keys(input ?? {})) if (!allowed.has(key)) throw new Error(`unsupported ${descriptor.label} ${scope} setting: ${key}`);
	for (const key of clearSecrets) if (fields.find((item) => item.key === key)?.input !== "secret") throw new Error(`cannot clear non-secret ${descriptor.label} ${scope} setting: ${key}`);
	const output = {};
	for (const configField of fields) {
		if (clearSecrets.includes(configField.key)) {
			output[configField.key] = "";
			continue;
		}
		const value = input?.[configField.key] ?? previous[configField.key] ?? configField.defaultValue;
		if (configField.input === "boolean") {
			if (value === void 0) continue;
			if (typeof value === "boolean") output[configField.key] = value;
			else if (value === "true" || value === "false") output[configField.key] = value === "true";
			else throw new Error(`${configField.label} must be true or false`);
			continue;
		}
		if (configField.input === "number") {
			if (value === void 0 || value === "") continue;
			const parsed = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(parsed)) throw new Error(`${configField.label} must be a finite number`);
			output[configField.key] = parsed;
			continue;
		}
		const normalized = normalizeString(value, configField);
		if (normalized !== "" || configField.required || configField.input === "secret") output[configField.key] = normalized;
	}
	validateProviderSpecific(providerId, output);
	return output;
}
function providerServiceFields(providerId) {
	return memoryProviderDescriptor(providerId).fields.filter((field) => field.scope === "service");
}
function splitProviderConnection(providerId, connection) {
	const serviceKeys = new Set(providerServiceFields(providerId).map((field) => field.key));
	return {
		service: Object.fromEntries(Object.entries(connection ?? {}).filter(([key]) => serviceKeys.has(key))),
		memory: Object.fromEntries(Object.entries(connection ?? {}).filter(([key]) => !serviceKeys.has(key)))
	};
}
function normalizeProviderServiceConnection(providerId, input, previous = {}, clearSecrets = []) {
	return normalizeScopedProviderConnection(providerId, "service", input, previous, clearSecrets);
}
function normalizeProviderMemoryConnection(providerId, input, previous = {}) {
	return normalizeScopedProviderConnection(providerId, "memory", input, previous);
}
function normalizeProviderConnection(providerId, input, previous = {}, clearSecrets = []) {
	const descriptor = memoryProviderDescriptor(providerId);
	if (providerId === "mnemon-native") return {};
	const allowed = new Set(descriptor.fields.map((item) => item.key));
	for (const key of Object.keys(input ?? {})) if (!allowed.has(key)) throw new Error(`unsupported ${descriptor.label} setting: ${key}`);
	for (const key of clearSecrets) if (descriptor.fields.find((item) => item.key === key)?.input !== "secret") throw new Error(`cannot clear non-secret ${descriptor.label} setting: ${key}`);
	const output = {};
	for (const configField of descriptor.fields) {
		if (clearSecrets.includes(configField.key)) {
			output[configField.key] = "";
			continue;
		}
		const supplied = input?.[configField.key];
		const fallback = previous[configField.key] ?? configField.defaultValue;
		const value = supplied ?? fallback;
		if (configField.input === "boolean") {
			if (value === void 0) continue;
			if (typeof value === "boolean") output[configField.key] = value;
			else if (value === "true" || value === "false") output[configField.key] = value === "true";
			else throw new Error(`${configField.label} must be true or false`);
			continue;
		}
		if (configField.input === "number") {
			if (value === void 0 || value === "") continue;
			const parsed = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(parsed)) throw new Error(`${configField.label} must be a finite number`);
			output[configField.key] = parsed;
			continue;
		}
		const normalized = normalizeString(value, configField);
		if (normalized !== "" || configField.required || configField.input === "secret") output[configField.key] = normalized;
	}
	validateProviderSpecific(providerId, output);
	return output;
}
function publicScopedProviderConnection(providerId, scope, connection) {
	const fields = memoryProviderDescriptor(providerId).fields.filter((item) => item.scope === scope);
	const keys = new Set(fields.map((item) => item.key));
	const secrets = new Set(fields.filter((item) => item.input === "secret").map((item) => item.key));
	return {
		settings: Object.fromEntries(Object.entries(connection).filter(([key]) => keys.has(key) && !secrets.has(key))),
		configuredSecrets: [...secrets].filter((key) => String(connection[key] ?? "") !== "")
	};
}
function publicProviderConnection(providerId, connection) {
	const descriptor = memoryProviderDescriptor(providerId);
	const secrets = new Set(descriptor.fields.filter((item) => item.input === "secret").map((item) => item.key));
	return {
		settings: Object.fromEntries(Object.entries(connection).filter(([key]) => !secrets.has(key))),
		configuredSecrets: [...secrets].filter((key) => String(connection[key] ?? "") !== "")
	};
}
//#endregion
//#region src/providers/provider.ts
const NORMALIZED_RELEVANCE_SCORE = Object.freeze({ kind: "normalized-relevance" });
//#endregion
//#region src/providers/byterover.ts
var ByteRoverProvider = class {
	memoryBodies;
	id = "byterover";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	process;
	queryTimeoutMs;
	curateTimeoutMs;
	statusCache = /* @__PURE__ */ new Map();
	statusInFlight = /* @__PURE__ */ new Map();
	constructor(memoryBodies, options = {}) {
		this.memoryBodies = memoryBodies;
		this.process = options.process ?? runProcess;
		this.queryTimeoutMs = options.queryTimeoutMs ?? 1e4;
		this.curateTimeoutMs = options.curateTimeoutMs ?? 12e4;
	}
	async discover(connection) {
		const configured = String(connection.defaultDirectory ?? "").trim();
		const existingDirectory = this.memoryBodies.list().find((body) => body.provider.id === this.id)?.provider.settings.workingDirectory;
		const directory = configured === "" ? String(existingDirectory ?? "").trim() || join(this.memoryBodies.runner.effectiveDataDir(), "state", "byterover", "default") : isAbsolute(configured) ? configured : resolve(this.memoryBodies.runner.effectiveDataDir(), configured);
		return [{
			externalId: directory,
			name: basename(directory) || "ByteRover",
			description: `ByteRover knowledge directory at ${directory}`,
			connection: { workingDirectory: directory }
		}];
	}
	async status(body, signal) {
		if (signal !== void 0) return this.checkStatus(body, signal);
		const cached = this.statusCache.get(body.id);
		if (cached !== void 0 && Date.now() - cached.checkedAt < 6e4) return cached.value;
		const running = this.statusInFlight.get(body.id);
		if (running !== void 0) return running;
		const pending = this.checkStatus(body);
		this.statusInFlight.set(body.id, pending);
		try {
			const value = await pending;
			this.statusCache.set(body.id, {
				checkedAt: Date.now(),
				value
			});
			return value;
		} finally {
			if (this.statusInFlight.get(body.id) === pending) this.statusInFlight.delete(body.id);
		}
	}
	invalidateStatus(memoryBodyId) {
		if (memoryBodyId === void 0) this.statusCache.clear();
		else this.statusCache.delete(memoryBodyId);
	}
	async checkStatus(body, signal) {
		try {
			await this.run(body, ["status"], 15e3, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const output = await this.run(body, [
			"query",
			"--",
			request.query.slice(0, 5e3)
		], this.queryTimeoutMs, signal);
		if (output.length < 20) return {
			results: [],
			hint: "ByteRover found no relevant memories."
		};
		const content = output.length > 8e3 ? `${output.slice(0, 8e3)}\n\n[... truncated]` : output;
		return { results: [{
			id: `byterover:${createHash("sha256").update(content).digest("hex").slice(0, 24)}`,
			content,
			category: "context",
			source: "external",
			score: 1
		}] };
	}
	async graph(body) {
		this.connection(body);
		return {
			nodes: [],
			edges: [],
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async list(body, request, signal) {
		if (request.query === void 0 || request.query.trim() === "") {
			this.connection(body);
			return [];
		}
		return (await this.search(body, {
			query: request.query,
			...request.limit === void 0 ? {} : { limit: request.limit }
		}, signal)).results;
	}
	async remember(body, request, signal) {
		await this.run(body, [
			"curate",
			"--",
			request.content
		], this.curateTimeoutMs, signal);
		return {
			action: "stored",
			provider: this.id,
			summary: "ByteRover curated the memory into its knowledge tree."
		};
	}
	connection(body) {
		if (body.provider.id !== this.id) throw new Error(`ByteRover cannot serve provider ${body.provider.id}`);
		return this.memoryBodies.providerConnection(body.id, this.id);
	}
	async run(body, args, timeoutMs, signal) {
		const connection = this.connection(body);
		const command = String(connection.cliPath ?? "brv");
		const configuredDirectory = String(connection.workingDirectory ?? connection.defaultDirectory ?? "").trim();
		const defaultDirectory = join(this.memoryBodies.runner.effectiveDataDir(), "state", "byterover", "default");
		const cwd = configuredDirectory === "" ? defaultDirectory : isAbsolute(configuredDirectory) ? configuredDirectory : resolve(this.memoryBodies.runner.effectiveDataDir(), configuredDirectory);
		mkdirSync(cwd, {
			recursive: true,
			mode: 448
		});
		const apiKey = String(connection.apiKey ?? "").trim();
		const result = await this.process(command, args, {
			timeoutMs,
			maxOutputBytes: 262144,
			...signal === void 0 ? {} : { signal },
			cwd,
			label: "ByteRover",
			env: {
				...process.env,
				...apiKey === "" ? {} : { BRV_API_KEY: apiKey }
			}
		});
		const stdout = result.stdout.trim();
		const stderr = result.stderr.trim();
		if (result.exitCode !== 0) throw new Error(stderr || stdout || `ByteRover exited with code ${String(result.exitCode)}`);
		return stdout;
	}
};
//#endregion
//#region src/providers/http.ts
function jsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function jsonString(value) {
	return typeof value === "string" ? value : void 0;
}
function jsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function jsonArray(value) {
	return Array.isArray(value) ? value : [];
}
function firstArray(value, ...keys) {
	if (Array.isArray(value)) return value;
	const root = jsonObject(value);
	for (const key of keys) if (Array.isArray(root?.[key])) return root[key];
	const nested = jsonObject(root?.data);
	for (const key of keys) if (Array.isArray(nested?.[key])) return nested[key];
	return [];
}
function errorDetail(payload) {
	if (typeof payload === "string") return payload.trim() || void 0;
	const root = jsonObject(payload);
	const direct = jsonString(root?.message) ?? jsonString(root?.error) ?? jsonString(root?.detail);
	if (direct !== void 0) return direct;
	const error = jsonObject(root?.error);
	return jsonString(error?.message) ?? jsonString(error?.detail);
}
/** Shared timeout, cancellation, error, and projection behavior for HTTP providers. */
var HttpMemoryProvider = class {
	memoryBodies;
	requestFetch;
	requestTimeoutMs;
	constructor(memoryBodies, options = {}) {
		this.memoryBodies = memoryBodies;
		this.requestFetch = options.fetch ?? globalThis.fetch;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15e3;
	}
	async graph(body, signal) {
		return {
			nodes: (await this.list(body, { limit: 200 }, signal)).map((item) => ({
				...item,
				color: "#6574d9"
			})),
			edges: [],
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	connection(body) {
		if (body.provider.id !== this.id) throw new Error(`${this.id} cannot serve provider ${body.provider.id}`);
		return this.memoryBodies.providerConnection(body.id, this.id);
	}
	async request(body, path, options = {}) {
		const connection = this.connection(body);
		return this.requestConnection(connection, path, options);
	}
	async requestConnection(connection, path, options = {}) {
		const endpoint = String(connection.endpoint ?? "").replace(/\/+$/u, "");
		const label = memoryProviderDescriptor(this.id).label;
		if (endpoint === "") throw new Error(`${label} endpoint is not configured`);
		if (!path.startsWith("/")) throw new Error(`${label} request path must be absolute`);
		options.signal?.throwIfAborted();
		const controller = new AbortController();
		const relay = () => controller.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", relay, { once: true });
		const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
		const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error(`${label} request timed out`)), timeoutMs);
		const headers = new Headers(options.headers);
		if (options.json !== void 0 && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
		try {
			const response = await this.requestFetch(`${endpoint}${path}`, {
				method: options.method ?? (options.json === void 0 ? "GET" : "POST"),
				headers,
				...options.json === void 0 ? {} : { body: JSON.stringify(options.json) },
				signal: controller.signal
			});
			const raw = await response.text();
			let payload = {};
			if (raw !== "") try {
				payload = JSON.parse(raw);
			} catch {
				payload = raw;
			}
			if (!response.ok) {
				const detail = errorDetail(payload);
				throw new Error(`${label} HTTP ${response.status}${detail === void 0 ? "" : `: ${detail}`}`);
			}
			return payload;
		} catch (error) {
			if (controller.signal.aborted && options.signal?.aborted !== true) throw new Error(`${label} request timed out after ${timeoutMs}ms`);
			throw error;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", relay);
		}
	}
};
//#endregion
//#region src/providers/hindsight.ts
function insight$5(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.text) ?? jsonString(item?.content) ?? jsonString(item?.label);
	if (id === void 0 || content === void 0) return void 0;
	const score = jsonNumber(jsonObject(item?.scores)?.final) ?? jsonNumber(item?.score);
	const createdAt = jsonString(item?.mentioned_at) ?? jsonString(item?.date) ?? jsonString(item?.occurred_start);
	const rawEntities = item?.entities;
	const entities = Array.isArray(rawEntities) ? rawEntities.filter((entry) => typeof entry === "string") : typeof rawEntities === "string" ? rawEntities.split(",").map((entry) => entry.replace(/\s*\([^)]*\)\s*$/u, "").trim()).filter(Boolean) : [];
	const tags = jsonArray(item?.tags).filter((entry) => typeof entry === "string");
	return {
		id,
		content,
		category: jsonString(item?.type) ?? jsonString(item?.fact_type) ?? "general",
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt },
		...entities.length === 0 ? {} : { entities },
		...tags.length === 0 ? {} : { tags }
	};
}
function edgeType(value) {
	return value === "temporal" || value === "semantic" || value === "causal" || value === "entity" ? value : void 0;
}
var HindsightProvider = class extends HttpMemoryProvider {
	id = "hindsight";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memoryBodies, options = {}) {
		super(memoryBodies, options);
	}
	async discover(connection, signal) {
		return firstArray(await this.requestConnection(connection, "/v1/default/banks", {
			headers: this.headers(connection),
			signal
		}), "banks", "items").flatMap((value) => {
			const item = jsonObject(value);
			const id = jsonString(item?.bank_id) ?? jsonString(item?.id);
			if (id === void 0) return [];
			const description = jsonString(item?.mission)?.trim() || jsonString(item?.description)?.trim() || `Hindsight memory bank ${id}`;
			return [{
				externalId: id,
				name: jsonString(item?.name) ?? id,
				description,
				connection: {
					bankId: id,
					budget: "mid"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			const connection = this.connection(body);
			await this.request(body, "/health/live", {
				headers: this.headers(connection),
				signal
			});
			try {
				const [statsPayload, entitiesPayload] = await Promise.all([this.request(body, `${this.bankPath(connection)}/stats`, {
					headers: this.headers(connection),
					signal
				}), this.request(body, `${this.bankPath(connection)}/entities?limit=100&offset=0`, {
					headers: this.headers(connection),
					signal
				})]);
				const stats = jsonObject(statsPayload) ?? {};
				const byFactType = jsonObject(stats.nodes_by_fact_type) ?? {};
				const byCategory = Object.fromEntries(Object.entries(byFactType).flatMap(([category, count]) => {
					const value = jsonNumber(count);
					return value === void 0 ? [] : [[category, value]];
				}));
				const operations = jsonObject(stats.operations_by_status) ?? {};
				const topEntities = firstArray(entitiesPayload, "items").flatMap((value) => {
					const item = jsonObject(value);
					const entity = jsonString(item?.canonical_name);
					const count = jsonNumber(item?.mention_count);
					return entity === void 0 || count === void 0 ? [] : [{
						entity,
						count
					}];
				});
				return {
					healthy: true,
					stats: {
						totalInsights: jsonNumber(stats.total_nodes) ?? 0,
						deletedInsights: 0,
						edgeCount: jsonNumber(stats.total_links) ?? 0,
						oplogCount: Object.values(operations).reduce((total, value) => total + (jsonNumber(value) ?? 0), 0),
						dbSizeBytes: 0,
						byCategory,
						topEntities
					}
				};
			} catch {
				return { healthy: true };
			}
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		return { results: firstArray(await this.request(body, `${this.bankPath(connection)}/memories/recall`, {
			headers: this.headers(connection),
			json: {
				query: request.query,
				budget: String(connection.budget ?? "mid"),
				max_tokens: Math.min(Math.max((request.limit ?? 10) * 400, 400), 8e3),
				types: [
					"world",
					"experience",
					"observation"
				],
				prefer_observations: true
			},
			signal
		}), "results", "items").map(insight$5).filter((item) => item !== void 0).slice(0, request.limit ?? 10) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const params = new URLSearchParams({
			limit: String(Math.min(Math.max(request.limit ?? 200, 1), 1e3)),
			offset: "0",
			state: "valid"
		});
		if (request.query !== void 0 && request.query.trim() !== "") params.set("q", request.query.trim());
		return firstArray(await this.request(body, `${this.bankPath(connection)}/memories/list?${params}`, {
			headers: this.headers(connection),
			signal
		}), "items", "results").map(insight$5).filter((item) => item !== void 0).filter((item) => request.category === void 0 || item.category === request.category);
	}
	async graph(body, signal) {
		const connection = this.connection(body);
		const payload = jsonObject(await this.request(body, `${this.bankPath(connection)}/graph?limit=1000`, {
			headers: this.headers(connection),
			signal
		})) ?? {};
		return {
			nodes: jsonArray(payload.nodes).flatMap((value) => {
				const item = jsonObject(value);
				const data = jsonObject(item?.data) ?? item;
				const projected = insight$5(data);
				return projected === void 0 ? [] : [{
					...projected,
					color: jsonString(data?.color) ?? "#6574d9"
				}];
			}),
			edges: jsonArray(payload.edges).flatMap((value) => {
				const item = jsonObject(value);
				const data = jsonObject(item?.data) ?? item;
				const sourceId = jsonString(data?.from) ?? jsonString(data?.source);
				const targetId = jsonString(data?.to) ?? jsonString(data?.target);
				if (sourceId === void 0 || targetId === void 0) return [];
				const rawType = jsonString(data?.type) ?? jsonString(data?.linkType);
				const type = edgeType(rawType);
				return [{
					sourceId,
					targetId,
					label: rawType ?? "related",
					color: type === "causal" ? "#e74c3c" : type === "entity" ? "#2ecc71" : type === "temporal" ? "#aaaaaa" : "#3498db",
					...type === void 0 ? {} : { type }
				}];
			}),
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async related(body, id, depth, _edge, signal) {
		const graph = await this.graph(body, signal);
		let frontier = /* @__PURE__ */ new Set([id]);
		const visited = /* @__PURE__ */ new Set([id]);
		for (let level = 0; level < depth; level += 1) {
			const next = /* @__PURE__ */ new Set();
			for (const edge of graph.edges) {
				if (frontier.has(edge.sourceId) && !visited.has(edge.targetId)) next.add(edge.targetId);
				if (frontier.has(edge.targetId) && !visited.has(edge.sourceId)) next.add(edge.sourceId);
			}
			for (const value of next) visited.add(value);
			frontier = next;
		}
		return graph.nodes.filter((node) => node.id !== id && visited.has(node.id)).map(({ color: _color, ...node }) => node);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const operationId = randomUUID();
		const payload = jsonObject(await this.request(body, `${this.bankPath(connection)}/memories`, {
			headers: this.headers(connection),
			json: {
				items: [{
					content: request.content,
					context: request.category ?? "dsh-mnemon",
					metadata: { source: "dsh-mnemon" },
					...request.tags === void 0 ? {} : { tags: request.tags },
					...request.entities === void 0 ? {} : { entities: request.entities.map((text) => ({ text })) }
				}],
				async: true,
				operation_id: operationId
			},
			signal
		})) ?? {};
		return {
			action: "stored",
			provider: this.id,
			summary: "Hindsight queued the content for structured memory extraction.",
			operationId: jsonString(payload.operation_id) ?? operationId,
			...jsonNumber(payload.items_count) === void 0 ? {} : { itemsCount: jsonNumber(payload.items_count) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		await this.request(body, `${this.bankPath(connection)}/memories/${encodeURIComponent(id)}`, {
			method: "PATCH",
			headers: this.headers(connection),
			json: {
				state: "invalidated",
				reason: "Forgotten from dsh-mnemon"
			},
			signal
		});
		return {
			action: "invalidated",
			provider: this.id,
			id
		};
	}
	bankPath(connection) {
		return `/v1/default/banks/${encodeURIComponent(String(connection.bankId))}`;
	}
	headers(connection) {
		const token = String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "");
		return token === "" ? {} : { Authorization: `Bearer ${token}` };
	}
};
//#endregion
//#region src/providers/holographic.ts
const WORD = /[\p{L}\p{N}_-]+/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const QUOTED = /["“”'‘’]([^"“”'‘’]{2,100})["“”'‘’]/gu;
const CAPITALIZED = /\b([A-Z][\p{L}\p{N}_-]+(?:\s+[A-Z][\p{L}\p{N}_-]+)*)\b/gu;
function clampTrust(value) {
	return Math.min(1, Math.max(0, value));
}
function terms(value) {
	const normalized = value.toLocaleLowerCase();
	const output = new Set((normalized.match(WORD) ?? []).filter((token) => token.length > 1));
	for (const run of normalized.match(CJK) ?? []) {
		for (const character of run) output.add(character);
		for (let index = 0; index < run.length - 1; index += 1) output.add(run.slice(index, index + 2));
	}
	return output;
}
function overlap(left, right) {
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const value of left) if (right.has(value)) shared += 1;
	return shared / (/* @__PURE__ */ new Set([...left, ...right])).size;
}
function extractEntities(content, supplied = []) {
	const values = [...supplied];
	for (const match of content.matchAll(QUOTED)) values.push(match[1]);
	for (const match of content.matchAll(CAPITALIZED)) values.push(match[1]);
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length >= 2 && value.length <= 100))].slice(0, 50);
}
function insight$4(fact, score) {
	return {
		id: fact.id,
		content: fact.content,
		category: fact.category,
		importance: fact.trustScore,
		tags: fact.tags,
		entities: fact.entities,
		source: "external",
		createdAt: fact.createdAt,
		...score === void 0 ? {} : { score }
	};
}
var HolographicProvider = class {
	memoryBodies;
	id = "holographic";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memoryBodies) {
		this.memoryBodies = memoryBodies;
	}
	async discover(connection) {
		const configured = String(connection.dataPath ?? "").trim();
		const path = configured === "" ? join(this.memoryBodies.runner.effectiveDataDir(), "state", "holographic", "store.json") : isAbsolute(configured) ? configured : resolve(this.memoryBodies.runner.effectiveDataDir(), configured);
		const label = basename(path).replace(/\.json$/iu, "") || "Holographic";
		return [{
			externalId: path,
			name: label === "store" ? "Holographic" : label,
			description: `Holographic fact store at ${path}`,
			connection: {
				defaultTrust: .5,
				minTrust: .3
			}
		}];
	}
	async status(body) {
		try {
			const store = this.load(body);
			return {
				healthy: true,
				stats: this.stats(store)
			};
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request) {
		const store = this.load(body);
		const connection = this.connection(body);
		const minTrust = clampTrust(Number(connection.minTrust ?? .3));
		const queryTerms = terms(request.query);
		const query = request.query.toLocaleLowerCase();
		const limit = Math.min(Math.max(request.limit ?? 10, 1), 50);
		return { results: store.facts.flatMap((fact) => {
			if (fact.trustScore < minTrust || request.category !== void 0 && fact.category !== request.category) return [];
			const lexical = overlap(queryTerms, terms(`${fact.content} ${fact.tags.join(" ")} ${fact.entities.join(" ")}`));
			const phrase = fact.content.toLocaleLowerCase().includes(query) ? 1 : 0;
			const entity = fact.entities.some((value) => query.includes(value.toLocaleLowerCase())) ? 1 : 0;
			const relevance = Math.max(lexical, phrase * .9, entity * .8);
			return relevance <= 0 ? [] : [{
				fact,
				score: relevance * fact.trustScore
			}];
		}).sort((left, right) => right.score - left.score).slice(0, limit).map((result) => insight$4(result.fact, result.score)) };
	}
	async list(body, request) {
		if (request.query !== void 0 && request.query.trim() !== "") return (await this.search(body, {
			query: request.query,
			...request.category === void 0 ? {} : { category: request.category },
			...request.limit === void 0 ? {} : { limit: request.limit }
		})).results;
		const store = this.load(body);
		const minTrust = clampTrust(Number(this.connection(body).minTrust ?? .3));
		return store.facts.filter((fact) => fact.trustScore >= minTrust && (request.category === void 0 || fact.category === request.category)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.min(Math.max(request.limit ?? 200, 1), 1e3)).map((fact) => insight$4(fact));
	}
	async graph(body) {
		const facts = await this.list(body, { limit: 500 });
		const entities = [...new Set(facts.flatMap((fact) => fact.entities ?? []))];
		return {
			nodes: [...facts.map((fact) => ({
				...fact,
				color: "#6574d9",
				kind: "memory"
			})), ...entities.map((entity) => ({
				id: `entity:${encodeURIComponent(entity)}`,
				content: entity,
				color: "#2ecc71",
				kind: "entity"
			}))],
			edges: facts.flatMap((fact) => (fact.entities ?? []).map((entity) => ({
				sourceId: fact.id,
				targetId: `entity:${encodeURIComponent(entity)}`,
				label: "entity",
				color: "#2ecc71",
				type: "entity"
			}))),
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async related(body, id, _depth) {
		const store = this.load(body);
		const source = store.facts.find((fact) => fact.id === id);
		if (source === void 0) return [];
		const sourceEntities = new Set(source.entities.map((value) => value.toLocaleLowerCase()));
		const sourceTerms = terms(source.content);
		return store.facts.flatMap((fact) => {
			if (fact.id === id) return [];
			const sharedEntities = fact.entities.filter((value) => sourceEntities.has(value.toLocaleLowerCase())).length;
			const score = Math.max(sharedEntities === 0 ? 0 : Math.min(1, .5 + sharedEntities * .2), overlap(sourceTerms, terms(fact.content))) * fact.trustScore;
			return score <= 0 ? [] : [{
				fact,
				score
			}];
		}).sort((left, right) => right.score - left.score).slice(0, 20).map((result) => insight$4(result.fact, result.score));
	}
	async remember(body, request) {
		const store = this.load(body);
		const existing = store.facts.find((fact) => fact.content === request.content.trim());
		if (existing !== void 0) return {
			action: "skipped",
			provider: this.id,
			id: existing.id,
			summary: "Holographic already contains this fact."
		};
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const connection = this.connection(body);
		const fact = {
			id: `holo-${randomUUID()}`,
			content: request.content.trim(),
			category: request.category ?? "general",
			tags: [...new Set(request.tags ?? [])],
			entities: extractEntities(request.content, request.entities),
			trustScore: clampTrust(Number(request.importance ?? connection.defaultTrust ?? .5)),
			createdAt: now,
			updatedAt: now
		};
		store.facts.push(fact);
		this.save(body, store);
		return {
			action: "stored",
			provider: this.id,
			id: fact.id,
			summary: "Holographic stored the structured fact."
		};
	}
	async forget(body, id) {
		const store = this.load(body);
		const before = store.facts.length;
		store.facts = store.facts.filter((fact) => fact.id !== id);
		if (store.facts.length === before) throw new Error(`unknown Holographic fact: ${id}`);
		this.save(body, store);
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	connection(body) {
		if (body.provider.id !== this.id) throw new Error(`Holographic cannot serve provider ${body.provider.id}`);
		return this.memoryBodies.providerConnection(body.id, this.id);
	}
	path(body) {
		const configured = String(this.connection(body).dataPath ?? "").trim();
		if (configured === "") return join(this.memoryBodies.runner.effectiveDataDir(), "state", "holographic", "store.json");
		return isAbsolute(configured) ? configured : resolve(this.memoryBodies.runner.effectiveDataDir(), configured);
	}
	load(body) {
		const path = this.path(body);
		if (!existsSync(path)) return {
			version: 1,
			facts: []
		};
		const value = JSON.parse(readFileSync(path, "utf8"));
		if (value.version !== 1 || !Array.isArray(value.facts)) throw new Error(`invalid Holographic fact store: ${path}`);
		return {
			version: 1,
			facts: value.facts
		};
	}
	save(body, store) {
		const path = this.path(body);
		mkdirSync(dirname(path), {
			recursive: true,
			mode: 448
		});
		const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		renameSync(temporary, path);
		chmodSync(path, 384);
	}
	stats(store) {
		const byCategory = {};
		const entityCounts = /* @__PURE__ */ new Map();
		for (const fact of store.facts) {
			byCategory[fact.category] = (byCategory[fact.category] ?? 0) + 1;
			for (const entity of fact.entities) entityCounts.set(entity, (entityCounts.get(entity) ?? 0) + 1);
		}
		return {
			totalInsights: store.facts.length,
			deletedInsights: 0,
			edgeCount: store.facts.reduce((total, fact) => total + fact.entities.length, 0),
			oplogCount: 0,
			dbSizeBytes: Buffer.byteLength(JSON.stringify(store)),
			byCategory,
			topEntities: [...entityCounts].map(([entity, count]) => ({
				entity,
				count
			})).sort((left, right) => right.count - left.count).slice(0, 20)
		};
	}
};
//#endregion
//#region src/providers/honcho.ts
function insight$3(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.content);
	if (id === void 0 || content === void 0) return void 0;
	const observer = jsonString(item?.observer_id) ?? jsonString(item?.observer);
	const observed = jsonString(item?.observed_id) ?? jsonString(item?.observed);
	const createdAt = jsonString(item?.created_at) ?? jsonString(item?.createdAt);
	const entities = [observer, observed].filter((entry) => entry !== void 0);
	return {
		id,
		content,
		category: jsonString(item?.level) ?? "insight",
		source: "external",
		...createdAt === void 0 ? {} : { createdAt },
		...entities.length === 0 ? {} : { entities }
	};
}
var HonchoProvider = class extends HttpMemoryProvider {
	id = "honcho";
	constructor(memoryBodies, options = {}) {
		super(memoryBodies, options);
	}
	async discover(connection, signal) {
		return firstArray(await this.requestConnection(connection, "/v3/workspaces/list?page=1&size=100", {
			headers: this.headers(connection),
			json: {},
			signal
		}), "items", "results").flatMap((value) => {
			const item = jsonObject(value);
			const id = jsonString(item?.id);
			if (id === void 0) return [];
			const metadata = jsonObject(item?.metadata);
			return [{
				externalId: id,
				name: jsonString(metadata?.name) ?? jsonString(metadata?.title) ?? id,
				description: jsonString(metadata?.description) ?? `Honcho workspace ${id}`,
				connection: {
					workspace: id,
					userId: "*",
					agentId: "*"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.list(body, { limit: 1 }, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		return { results: firstArray(await this.request(body, `${this.basePath(connection)}/conclusions/query`, {
			headers: this.headers(connection),
			json: {
				query: request.query,
				top_k: Math.min(request.limit ?? 10, 100),
				filters: this.scope(connection, true)
			},
			signal
		}), "items", "results").map(insight$3).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 100);
		return firstArray(await this.request(body, `${this.basePath(connection)}/conclusions/list?page=1&size=${limit}`, {
			headers: this.headers(connection),
			json: { filters: {
				...this.scope(connection),
				...request.category === void 0 ? {} : { level: request.category }
			} },
			signal
		}), "items", "results").map(insight$3).filter((item) => item !== void 0);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const created = firstArray(await this.request(body, `${this.basePath(connection)}/conclusions`, {
			headers: this.headers(connection),
			json: { conclusions: [{
				content: request.content,
				observer_id: String(connection.agentId) === "*" ? "dsh" : String(connection.agentId),
				observed_id: String(connection.userId) === "*" ? "dsh-user" : String(connection.userId),
				session_id: null
			}] },
			signal
		}), "items", "results").map(jsonObject).find((item) => item !== void 0);
		return {
			action: "stored",
			provider: this.id,
			summary: "Honcho stored an explicit peer conclusion.",
			...jsonString(created?.id) === void 0 ? {} : { id: jsonString(created?.id) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		await this.request(body, `${this.basePath(connection)}/conclusions/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: this.headers(connection),
			signal
		});
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	basePath(connection) {
		return `/v3/workspaces/${encodeURIComponent(String(connection.workspace))}`;
	}
	scope(connection, requirePeers = false) {
		const agentId = String(connection.agentId);
		const userId = String(connection.userId);
		return {
			...agentId === "*" ? requirePeers ? { observer_id: "dsh" } : {} : { observer_id: agentId },
			...userId === "*" ? requirePeers ? { observed_id: "dsh-user" } : {} : { observed_id: userId }
		};
	}
	headers(connection) {
		const token = String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "");
		return token === "" ? {} : { Authorization: `Bearer ${token}` };
	}
};
//#endregion
//#region src/providers/mem0.ts
function category(item) {
	const categories = jsonArray(item.categories).filter((value) => typeof value === "string");
	return jsonString(item.category) ?? categories[0] ?? "general";
}
function insight$2(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.memory) ?? jsonString(item?.text) ?? jsonString(item?.content);
	if (id === void 0 || content === void 0) return void 0;
	const score = jsonNumber(item?.score);
	const createdAt = jsonString(item?.created_at) ?? jsonString(item?.createdAt) ?? jsonString(item?.updated_at);
	const tags = jsonArray(item?.categories).filter((entry) => typeof entry === "string");
	return {
		id,
		content,
		category: category(item),
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt },
		...tags.length === 0 ? {} : { tags }
	};
}
var Mem0Provider = class extends HttpMemoryProvider {
	id = "mem0";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memoryBodies, options = {}) {
		super(memoryBodies, options);
	}
	async discover(connection, signal) {
		const mode = String(connection.mode ?? "platform");
		return firstArray(await this.requestConnection(connection, mode === "self-hosted" ? "/entities" : "/v1/entities", {
			headers: this.headers(connection, mode),
			signal
		}), "entities", "results").flatMap((value) => {
			const item = jsonObject(value);
			const id = jsonString(item?.id);
			const type = jsonString(item?.type);
			if (id === void 0 || type !== "user" && type !== "agent") return [];
			const metadata = jsonObject(item?.metadata);
			const count = jsonNumber(item?.total_memories);
			return [{
				externalId: `${type}:${id}`,
				name: jsonString(item?.name) ?? jsonString(metadata?.name) ?? id,
				description: jsonString(metadata?.description) ?? `${type === "user" ? "User" : "Agent"} memory${count === void 0 ? "" : ` · ${count} memories`}`,
				connection: type === "user" ? {
					userId: id,
					agentId: "*",
					rerank: false
				} : {
					userId: "*",
					agentId: id,
					rerank: false
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.list(body, { limit: 1 }, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const filters = this.filters(connection);
		return { results: firstArray(await this.request(body, mode === "self-hosted" ? "/search" : "/v3/memories/search/", {
			headers: this.headers(connection, mode),
			json: {
				query: request.query,
				filters,
				top_k: request.limit ?? 10,
				...mode === "platform" && connection.rerank === true ? { rerank: true } : {}
			},
			signal
		}), "results", "memories").map(insight$2).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 200);
		return firstArray(mode === "self-hosted" ? await this.request(body, `/memories?${new URLSearchParams({
			...this.filters(connection),
			limit: String(limit)
		})}`, {
			headers: this.headers(connection, mode),
			signal
		}) : await this.request(body, `/v3/memories/?page=1&page_size=${limit}`, {
			headers: this.headers(connection, mode),
			json: {
				filters: this.filters(connection),
				...request.category === void 0 ? {} : { categories: [request.category] }
			},
			signal
		}), "results", "memories").map(insight$2).filter((item) => item !== void 0);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const result = jsonObject(await this.request(body, mode === "self-hosted" ? "/memories" : "/v3/memories/add/", {
			headers: this.headers(connection, mode),
			json: {
				messages: [{
					role: "user",
					content: request.content
				}],
				user_id: String(connection.userId) === "*" ? "dsh-user" : String(connection.userId),
				agent_id: String(connection.agentId) === "*" ? "dsh" : String(connection.agentId),
				...mode === "self-hosted" ? { infer: false } : {},
				metadata: {
					source: "dsh-mnemon",
					...request.category === void 0 ? {} : { category: request.category },
					...request.importance === void 0 ? {} : { importance: request.importance },
					...request.tags === void 0 ? {} : { tags: request.tags },
					...request.entities === void 0 ? {} : { entities: request.entities }
				}
			},
			signal
		})) ?? {};
		return {
			action: "stored",
			provider: this.id,
			summary: mode === "platform" ? "Mem0 queued the memory for extraction." : "Mem0 stored the explicit memory.",
			...jsonString(result.event_id) === void 0 ? {} : { eventId: jsonString(result.event_id) },
			...jsonString(result.status) === void 0 ? {} : { status: jsonString(result.status) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const path = mode === "self-hosted" ? `/memories/${encodeURIComponent(id)}` : `/v1/memories/${encodeURIComponent(id)}`;
		await this.request(body, path, {
			method: "DELETE",
			headers: this.headers(connection, mode),
			signal
		});
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	filters(connection) {
		const userId = String(connection.userId);
		const agentId = String(connection.agentId ?? "");
		return {
			...userId === "*" ? {} : { user_id: userId },
			...agentId === "" || agentId === "*" ? {} : { agent_id: agentId }
		};
	}
	headers(connection, mode) {
		const apiKey = String(connection.apiKey ?? "").replace(/^(?:Token|Bearer)\s+/iu, "");
		if (apiKey === "") return {};
		return mode === "self-hosted" ? { "X-API-Key": apiKey } : { Authorization: `Token ${apiKey}` };
	}
};
//#endregion
//#region src/providers/openviking.ts
function object(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function string(value) {
	return typeof value === "string" ? value : void 0;
}
function number(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function delay(ms, signal) {
	if (signal?.aborted === true) return Promise.reject(signal.reason ?? /* @__PURE__ */ new Error("OpenViking request aborted"));
	return new Promise((resolve, reject) => {
		const aborted = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? /* @__PURE__ */ new Error("OpenViking request aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", aborted);
			resolve();
		}, ms);
		signal?.addEventListener("abort", aborted, { once: true });
	});
}
function categoryFromUri(uri) {
	const marker = "/memories/";
	return (uri.includes(marker) ? uri.slice(uri.indexOf(marker) + 10) : "").split("/")[0]?.replace(/\.md$/u, "") || "general";
}
var OpenVikingProvider = class {
	memoryBodies;
	id = "openviking";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	requestFetch;
	requestTimeoutMs;
	settlementTimeoutMs;
	pollIntervalMs;
	constructor(memoryBodies, options = {}) {
		this.memoryBodies = memoryBodies;
		this.requestFetch = options.fetch ?? globalThis.fetch;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15e3;
		this.settlementTimeoutMs = options.settlementTimeoutMs ?? 12e4;
		this.pollIntervalMs = options.pollIntervalMs ?? 750;
	}
	async discover(connection, signal) {
		let account = String(connection.account ?? "").trim();
		if (account === "") {
			const accounts = await this.requestConnection(connection, "/api/v1/admin/accounts", {}, { signal });
			const ids = (Array.isArray(accounts) ? accounts : []).flatMap((value) => {
				const id = string(object(value)?.account_id) ?? string(object(value)?.id);
				return id === void 0 ? [] : [id];
			});
			if (ids.length > 1) throw new Error("OpenViking exposes multiple accounts; configure the account to select one discovery scope");
			account = ids[0] ?? "default";
		}
		const users = await this.requestConnection({
			...connection,
			account
		}, `/api/v1/admin/accounts/${encodeURIComponent(account)}/users?limit=100`, {}, { signal });
		return (Array.isArray(users) ? users : []).flatMap((value) => {
			const item = object(value);
			const user = string(item?.user_id) ?? string(item?.id) ?? string(item?.name);
			if (user === void 0) return [];
			return [{
				externalId: `${account}:${user}`,
				name: string(item?.display_name) ?? string(item?.name) ?? user,
				description: string(item?.description) ?? string(item?.role) ?? `OpenViking memory namespace for ${user}`,
				connection: {
					targetUri: "viking://user/memories",
					user,
					actorPeerId: "dsh"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.request(body, "/health", {}, {
				signal,
				timeoutMs: 5e3
			});
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		const root = object(await this.request(body, "/api/v1/search/find", {
			method: "POST",
			body: JSON.stringify({
				query: request.query,
				target_uri: connection.targetUri,
				context_type: ["memory"],
				limit: request.limit
			})
		}, { signal }));
		return { results: (Array.isArray(root?.memories) ? root.memories : []).flatMap((value) => {
			const item = object(value);
			const uri = string(item?.uri);
			if (uri === void 0) return [];
			const score = number(item?.score);
			return [{
				id: uri,
				externalUri: uri,
				content: string(item?.overview) ?? string(item?.abstract) ?? uri,
				category: string(item?.category) ?? categoryFromUri(uri),
				source: "external",
				...score === void 0 ? {} : { score }
			}];
		}) };
	}
	async graph(body, signal) {
		return {
			nodes: (await this.list(body, { limit: 200 }, signal)).map((item) => ({
				...item,
				color: "#5568d9"
			})),
			edges: [],
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const query = new URLSearchParams({
			uri: connection.targetUri,
			recursive: "true",
			output: "original"
		});
		const result = await this.request(body, `/api/v1/fs/ls?${query}`, {}, { signal });
		const entries = Array.isArray(result) ? result : [];
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 1e3);
		const files = entries.flatMap((value) => {
			const item = object(value);
			const uri = string(item?.uri);
			const filename = uri?.slice(uri.lastIndexOf("/") + 1);
			return item === void 0 || uri === void 0 || item.isDir === true || filename?.startsWith(".") === true || !uri.endsWith(".md") ? [] : [{
				item,
				uri
			}];
		}).slice(0, limit);
		return Promise.all(files.map(async ({ item, uri }) => {
			let content = string(item.abstract) ?? string(item.overview) ?? "";
			if (content === "") try {
				const read = await this.request(body, `/api/v1/content/abstract?uri=${encodeURIComponent(uri)}`, {}, { signal });
				content = string(read) ?? string(object(read)?.content) ?? string(object(read)?.abstract) ?? uri;
			} catch {
				content = uri;
			}
			const createdAt = string(item.modTime);
			return {
				id: uri,
				externalUri: uri,
				content,
				category: categoryFromUri(uri),
				source: "external",
				...createdAt === void 0 ? {} : { createdAt }
			};
		}));
	}
	async remember(body, request, signal) {
		const sessionId = `dsh-mnemon-${Date.now()}-${randomUUID()}`;
		await this.request(body, "/api/v1/sessions", {
			method: "POST",
			body: JSON.stringify({ session_id: sessionId })
		}, { signal });
		await this.request(body, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
			method: "POST",
			body: JSON.stringify({
				role: "user",
				content: request.content
			})
		}, { signal });
		const committed = object(await this.request(body, `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
			method: "POST",
			body: JSON.stringify({ keep_recent_count: 0 })
		}, {
			signal,
			timeoutMs: 3e4
		}));
		const taskId = string(committed?.task_id);
		const archiveUri = string(committed?.archive_uri);
		if (taskId === void 0) return {
			action: "skipped",
			provider: "openviking",
			summary: string(committed?.reason) ?? "OpenViking did not archive a memory candidate.",
			sessionId
		};
		const task = await this.settleTask(body, taskId, signal);
		if (task === void 0) return {
			action: "queued",
			provider: "openviking",
			summary: "OpenViking accepted the session and is extracting durable memories asynchronously.",
			status: "pending",
			taskId,
			sessionId,
			...archiveUri === void 0 ? {} : { archiveUri }
		};
		const extracted = object(object(task.result)?.memories_extracted) ?? {};
		const total = Object.values(extracted).reduce((sum, value) => sum + (number(value) ?? 0), 0);
		return {
			action: total > 0 ? "stored" : "skipped",
			provider: "openviking",
			summary: total > 0 ? `OpenViking extracted ${total} durable ${total === 1 ? "memory" : "memories"}.` : "OpenViking completed extraction without a durable memory change.",
			taskId,
			sessionId,
			...archiveUri === void 0 ? {} : { archiveUri },
			extracted
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		const uri = id.trim();
		const root = connection.targetUri.replace(/\/+$/u, "");
		const filename = uri.slice(uri.lastIndexOf("/") + 1);
		if (!uri.startsWith(`${root}/`) || !uri.endsWith(".md") || filename.startsWith(".")) throw new Error("OpenViking forget requires an exact non-generated .md memory URI inside this Memory Space");
		const query = new URLSearchParams({
			uri,
			recursive: "false"
		});
		const result = object(await this.request(body, `/api/v1/fs?${query}`, { method: "DELETE" }, { signal })) ?? {};
		return {
			action: "deleted",
			provider: this.id,
			uri: string(result.uri) ?? uri,
			...number(result.estimated_deleted_count) === void 0 ? {} : { estimatedDeletedCount: number(result.estimated_deleted_count) }
		};
	}
	connection(body) {
		if (body.provider.id !== this.id) throw new Error(`OpenViking cannot serve provider ${body.provider.id}`);
		return this.memoryBodies.openVikingConnection(body.id);
	}
	async settleTask(body, taskId, signal) {
		const deadline = Date.now() + this.settlementTimeoutMs;
		while (Date.now() < deadline) {
			const task = object(await this.request(body, `/api/v1/tasks/${encodeURIComponent(taskId)}`, {}, {
				signal,
				timeoutMs: 1e4
			})) ?? {};
			const status = string(task.status);
			if (status === "completed") return task;
			if (status === "failed" || status === "cancelled") throw new Error(`OpenViking memory extraction ${status}: ${string(task.error) ?? taskId}`);
			await delay(this.pollIntervalMs, signal);
		}
	}
	async request(body, path, init = {}, options = {}) {
		const connection = this.connection(body);
		return this.requestConnection(connection, path, init, options);
	}
	async requestConnection(connection, path, init = {}, options = {}) {
		options.signal?.throwIfAborted();
		const controller = new AbortController();
		const relay = () => controller.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", relay, { once: true });
		const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("OpenViking request timed out")), options.timeoutMs ?? this.requestTimeoutMs);
		try {
			const response = await this.requestFetch(`${connection.endpoint}${path}`, {
				...init,
				headers: {
					"Content-Type": "application/json",
					...connection.apiKey === void 0 || connection.apiKey === "" ? {} : { Authorization: `Bearer ${connection.apiKey}` },
					...connection.account === void 0 || connection.account === "" ? {} : { "X-OpenViking-Account": String(connection.account) },
					...connection.user === void 0 || connection.user === "" ? {} : { "X-OpenViking-User": String(connection.user) },
					...connection.actorPeerId === void 0 || connection.actorPeerId === "" ? {} : { "X-OpenViking-Actor-Peer": String(connection.actorPeerId) },
					...init.headers
				},
				signal: controller.signal
			});
			const envelope = await response.json().catch(() => ({}));
			if (!response.ok || envelope.status === "error") {
				const trace = envelope.error?.trace_id ?? envelope.trace_id;
				throw new Error(`${envelope.error?.message ?? `OpenViking HTTP ${response.status}`}${trace === void 0 ? "" : ` (trace ${trace})`}`);
			}
			return envelope.result ?? envelope;
		} catch (error) {
			if (controller.signal.aborted && options.signal?.aborted !== true) throw new Error(`OpenViking request timed out after ${options.timeoutMs ?? this.requestTimeoutMs}ms`);
			throw error;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", relay);
		}
	}
};
//#endregion
//#region src/providers/retaindb.ts
function insight$1(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id) ?? jsonString(item?.memory_id);
	const content = jsonString(item?.content) ?? jsonString(item?.memory) ?? jsonString(item?.text);
	if (id === void 0 || content === void 0) return void 0;
	const score = jsonNumber(item?.score) ?? jsonNumber(item?.similarity);
	const createdAt = jsonString(item?.created_at) ?? jsonString(item?.createdAt) ?? jsonString(item?.updated_at);
	return {
		id,
		content,
		category: jsonString(item?.memory_type) ?? jsonString(item?.category) ?? "general",
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt }
	};
}
var RetainDbProvider = class extends HttpMemoryProvider {
	id = "retaindb";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memoryBodies, options = {}) {
		super(memoryBodies, options);
	}
	async discover(connection, signal) {
		return firstArray(await this.requestConnection(connection, "/v1/projects", {
			headers: this.headers(connection, "/v1/projects"),
			signal
		}), "projects", "items").flatMap((value) => {
			const item = jsonObject(value);
			const project = jsonString(item?.slug) ?? jsonString(item?.name) ?? jsonString(item?.id);
			if (project === void 0) return [];
			return [{
				externalId: jsonString(item?.id) ?? project,
				name: jsonString(item?.name) ?? project,
				description: jsonString(item?.description) ?? `RetainDB project ${project}`,
				connection: {
					project,
					userId: "*"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.list(body, { limit: 1 }, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		return { results: firstArray(await this.request(body, "/v1/memory/search", {
			headers: this.headers(connection, "/v1/memory/search"),
			json: {
				project: String(connection.project),
				query: request.query,
				...String(connection.userId) === "*" ? {} : { user_id: String(connection.userId) },
				session_id: `dsh-${body.id}`,
				top_k: request.limit ?? 10,
				include_pending: true
			},
			signal
		}), "results", "memories").map(insight$1).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const params = new URLSearchParams({
			project: String(connection.project),
			include_pending: "true"
		});
		let payload;
		try {
			if (String(connection.userId) === "*") throw new Error("project-wide scope uses the collection endpoint");
			payload = await this.request(body, `/v1/memory/profile/${encodeURIComponent(String(connection.userId))}?${params}`, {
				headers: this.headers(connection, "/v1/memory/profile"),
				signal
			});
		} catch {
			if (String(connection.userId) !== "*") params.set("user_id", String(connection.userId));
			params.set("limit", String(Math.min(Math.max(request.limit ?? 200, 1), 200)));
			payload = await this.request(body, `/v1/memories?${params}`, {
				headers: this.headers(connection, "/v1/memories"),
				signal
			});
		}
		return firstArray(payload, "memories", "results").map(insight$1).filter((item) => item !== void 0).filter((item) => request.category === void 0 || item.category === request.category).slice(0, Math.min(Math.max(request.limit ?? 200, 1), 200));
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const json = {
			project: String(connection.project),
			content: request.content,
			memory_type: request.category ?? "factual",
			user_id: String(connection.userId) === "*" ? "dsh-user" : String(connection.userId),
			session_id: `dsh-${body.id}`,
			importance: request.importance ?? .7,
			write_mode: "sync"
		};
		let payload;
		try {
			payload = await this.request(body, "/v1/memory", {
				headers: this.headers(connection, "/v1/memory"),
				json,
				signal
			});
		} catch {
			const { write_mode: _writeMode, ...legacy } = json;
			payload = await this.request(body, "/v1/memories", {
				headers: this.headers(connection, "/v1/memories"),
				json: legacy,
				signal
			});
		}
		const result = jsonObject(payload) ?? {};
		return {
			action: "stored",
			provider: this.id,
			summary: "RetainDB stored the memory synchronously.",
			...jsonString(result.id) === void 0 ? {} : { id: jsonString(result.id) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		try {
			await this.request(body, `/v1/memory/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: this.headers(connection, "/v1/memory"),
				signal
			});
		} catch {
			await this.request(body, `/v1/memories/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: this.headers(connection, "/v1/memories"),
				signal
			});
		}
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	headers(connection, path) {
		const token = String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "");
		return {
			Authorization: `Bearer ${token}`,
			"x-sdk-runtime": "dsh-mnemon",
			...path.startsWith("/v1/memory") || path.startsWith("/v1/context") ? { "X-API-Key": token } : {}
		};
	}
};
//#endregion
//#region src/providers/supermemory.ts
function insight(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.memory) ?? jsonString(item?.chunk) ?? jsonString(item?.content);
	if (id === void 0 || content === void 0) return void 0;
	const metadata = jsonObject(item?.metadata);
	const score = jsonNumber(item?.similarity) ?? jsonNumber(item?.score);
	const createdAt = jsonString(item?.updatedAt) ?? jsonString(item?.createdAt);
	return {
		id,
		content,
		category: jsonString(metadata?.category) ?? "general",
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt }
	};
}
var SupermemoryProvider = class extends HttpMemoryProvider {
	id = "supermemory";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memoryBodies, options = {}) {
		super(memoryBodies, options);
	}
	async discover(connection, signal) {
		return firstArray(await this.requestConnection(connection, "/v3/container-tags/list", {
			headers: this.headers(connection),
			signal
		}), "containerTags", "items").flatMap((value) => {
			const item = jsonObject(value);
			const tag = jsonString(item?.containerTag) ?? jsonString(item?.container_tag);
			if (tag === void 0) return [];
			return [{
				externalId: jsonString(item?.id) ?? tag,
				name: jsonString(item?.name) ?? tag,
				description: jsonString(item?.description) ?? `Supermemory space ${tag}`,
				connection: {
					containerTag: tag,
					searchMode: "hybrid"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.list(body, { limit: 1 }, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		return { results: firstArray(await this.request(body, "/v4/search", {
			headers: this.headers(connection),
			json: {
				q: request.query,
				containerTag: String(connection.containerTag),
				searchMode: String(connection.searchMode ?? "hybrid"),
				limit: request.limit ?? 10
			},
			signal
		}), "results").map(insight).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 200);
		const memories = firstArray(await this.request(body, "/v4/memories/list", {
			headers: this.headers(connection),
			json: {
				containerTags: [String(connection.containerTag)],
				limit,
				page: 1,
				sort: "createdAt",
				order: "desc"
			},
			signal
		}), "memoryEntries", "results").map(insight).filter((item) => item !== void 0);
		const projectedDocuments = firstArray(await this.request(body, "/v3/documents/documents", {
			headers: this.headers(connection),
			json: {
				containerTags: [String(connection.containerTag)],
				limit,
				page: 1,
				sort: "createdAt",
				order: "desc"
			},
			signal
		}), "documents", "memories", "results").map(insight).filter((item) => item !== void 0);
		return [...new Map([...memories, ...projectedDocuments].map((item) => [item.id, item])).values()].filter((item) => request.category === void 0 || item.category === request.category).slice(0, limit);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const result = jsonObject(await this.request(body, "/v3/documents", {
			headers: this.headers(connection),
			json: {
				content: request.content,
				containerTag: String(connection.containerTag),
				taskType: "memory",
				metadata: {
					sm_source: "dsh-mnemon",
					...request.category === void 0 ? {} : { category: request.category },
					...request.importance === void 0 ? {} : { importance: request.importance }
				}
			},
			signal
		})) ?? {};
		return {
			action: "stored",
			provider: this.id,
			summary: "Supermemory accepted the memory document for extraction.",
			...jsonString(result.id) === void 0 ? {} : { id: jsonString(result.id) },
			...jsonString(result.status) === void 0 ? {} : { status: jsonString(result.status) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		try {
			const payload = await this.request(body, "/v4/memories", {
				method: "DELETE",
				headers: this.headers(connection),
				json: {
					id,
					containerTag: String(connection.containerTag),
					reason: "Deleted from dsh-mnemon"
				},
				signal
			});
			return {
				action: "deleted",
				provider: this.id,
				id,
				...jsonObject(payload)?.forgotten === void 0 ? {} : { forgotten: jsonObject(payload).forgotten }
			};
		} catch (error) {
			if (!(error instanceof Error) || !/HTTP 404\b/u.test(error.message)) throw error;
			await this.request(body, `/v3/documents/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: this.headers(connection),
				signal
			});
			return {
				action: "deleted",
				provider: this.id,
				id,
				document: true
			};
		}
	}
	headers(connection) {
		return {
			Authorization: `Bearer ${String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "")}`,
			"x-sm-source": "dsh-mnemon"
		};
	}
};
//#endregion
//#region packages/provider-sdk/src/index.ts
/** Lifecycle-owned factory directory used by Provider plugins and the Host. */
var MemoryAdapterFactoryRegistry = class {
	factories = /* @__PURE__ */ new Map();
	constructor(factories = []) {
		for (const factory of factories) this.register(factory);
	}
	register(factory) {
		if (this.factories.has(factory.id)) throw new Error(`memory adapter factory is already registered: ${factory.id}`);
		this.factories.set(factory.id, factory);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (this.factories.get(factory.id) === factory) this.factories.delete(factory.id);
		};
	}
	create(context) {
		const adapters = /* @__PURE__ */ new Map();
		for (const factory of this.factories.values()) {
			const adapter = factory.create(context);
			if (adapter.id !== factory.id) throw new Error(`memory adapter factory ${factory.id} returned ${adapter.id}`);
			if (adapters.has(adapter.id)) throw new Error(`memory adapter is already created: ${adapter.id}`);
			adapters.set(adapter.id, adapter);
		}
		return adapters;
	}
	ids() {
		return [...this.factories.keys()];
	}
};
function defineMemoryAdapterDescriptor(descriptor) {
	return descriptor;
}
//#endregion
//#region src/providers/registry.ts
/**
* Runtime adapter factory seam. The control plane owns registration and
* provider implementations own construction; MnemonService depends only on
* the resulting adapter contract.
*/
var MemoryProviderAdapterRegistry = class extends MemoryAdapterFactoryRegistry {};
const BUILTIN_MEMORY_PROVIDER_ADAPTER_FACTORIES = [
	{
		id: "mnemon-native",
		create: (context) => context.nativeAdapter
	},
	{
		id: "openviking",
		create: (context) => new OpenVikingProvider(context.memoryBodies, {
			requestTimeoutMs: context.config.timeoutMs,
			settlementTimeoutMs: context.config.timeoutMs
		})
	},
	{
		id: "honcho",
		create: (context) => new HonchoProvider(context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
	},
	{
		id: "mem0",
		create: (context) => new Mem0Provider(context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
	},
	{
		id: "hindsight",
		create: (context) => new HindsightProvider(context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
	},
	{
		id: "holographic",
		create: (context) => new HolographicProvider(context.memoryBodies)
	},
	{
		id: "retaindb",
		create: (context) => new RetainDbProvider(context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
	},
	{
		id: "byterover",
		create: (context) => new ByteRoverProvider(context.memoryBodies, { queryTimeoutMs: context.config.timeoutMs })
	},
	{
		id: "supermemory",
		create: (context) => new SupermemoryProvider(context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
	}
];
function createBuiltinMemoryProviderAdapterRegistry() {
	return new MemoryProviderAdapterRegistry(BUILTIN_MEMORY_PROVIDER_ADAPTER_FACTORIES);
}
/** Global extension registry sampled when a runtime generation is constructed. */
const memoryProviderAdapterFactories = createBuiltinMemoryProviderAdapterRegistry();
function registerMemoryProviderAdapterFactory(factory) {
	return memoryProviderAdapterFactories.register(factory);
}
//#endregion
export { publicScopedProviderConnection as _, MemoryAdapterFactoryRegistry as a, MEMORY_PROVIDER_CATALOG as c, isMemoryProviderId as d, memoryProviderDescriptor as f, publicProviderConnection as g, normalizeProviderServiceConnection as h, registerMemoryProviderAdapterFactory as i, MEMORY_PROVIDER_IDS as l, normalizeProviderMemoryConnection as m, createBuiltinMemoryProviderAdapterRegistry as n, defineMemoryAdapterDescriptor as o, normalizeProviderConnection as p, memoryProviderAdapterFactories as r, NORMALIZED_RELEVANCE_SCORE as s, MemoryProviderAdapterRegistry as t, MEMORY_PROVIDER_ID_SET as u, splitProviderConnection as v, runProcess as y };
