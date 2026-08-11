"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { TextDecoder, TextEncoder } = require("util");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "public", "app.js");
const OLD_RESULT = "OLD_RESULT_SENTINEL_7b29";
const NEW_RESULT = "NEW_RESULT_SENTINEL_a451";

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.extra = new Set();
  }

  contains(name) {
    return this.extra.has(name) || String(this.element.className || "").split(/\s+/).includes(name);
  }

  add(...names) {
    names.forEach((name) => this.extra.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.extra.delete(name));
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.contains(name) : Boolean(force);
    if (enabled) {
      this.extra.add(name);
    } else {
      this.extra.delete(name);
    }
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.className = "";
    this.classList = new FakeClassList(this);
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value)),
      getPropertyValue: (name) => this.style.values.get(name) || "",
      removeProperty: (name) => this.style.values.delete(name)
    };
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.title = "";
    this.type = "";
    this.placeholder = "";
    this.scrollTop = 0;
    this._text = "";
    this._innerHtmlWriteCount = 0;
    this._trackInnerHtmlWrites = false;
  }

  get textContent() {
    return `${this._text}${this.children.map((child) => child.textContent).join("")}`;
  }

  set textContent(value) {
    this._text = String(value == null ? "" : value);
    this._detachChildren();
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this.textContent = value;
  }

  get innerHTML() {
    return this.textContent;
  }

  set innerHTML(value) {
    if (this._trackInnerHtmlWrites) {
      this._innerHtmlWriteCount += 1;
    }
    const markup = String(value == null ? "" : value);
    this._text = "";
    this._detachChildren();
    const emptyMatch = markup.match(/<div\s+class=["']empty-result["']>([\s\S]*?)<\/div>/i);
    if (emptyMatch) {
      const empty = new FakeElement("div");
      empty.className = "empty-result";
      empty.textContent = emptyMatch[1].replace(/<[^>]+>/g, "");
      this.append(empty);
    } else if (markup) {
      this._text = markup.replace(/<[^>]+>/g, "");
    }
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get options() {
    return this.children.filter((child) => child.tagName === "OPTION");
  }

  get scrollHeight() {
    return this.children.length * 100;
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = node instanceof FakeElement ? node : this._textNode(node);
      if (child.parentElement) {
        child.remove();
      }
      child.parentElement = this;
      this.children.push(child);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  remove() {
    if (!this.parentElement) {
      return;
    }
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) {
      this.parentElement.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child._matches(selector)) {
          matches.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener() {}

  removeEventListener() {}

  focus() {}

  getBoundingClientRect() {
    return { width: 640, height: 480, left: 0, right: 640, top: 0, bottom: 480 };
  }

  beginInnerHtmlTracking() {
    this._innerHtmlWriteCount = 0;
    this._trackInnerHtmlWrites = true;
  }

  get innerHtmlWriteCount() {
    return this._innerHtmlWriteCount;
  }

  _detachChildren() {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
  }

  _matches(selector) {
    const value = String(selector || "").trim();
    if (value.startsWith(".")) {
      return this.classList.contains(value.slice(1));
    }
    return this.tagName.toLowerCase() === value.toLowerCase();
  }

  _textNode(value) {
    const node = new FakeElement("span");
    node.textContent = String(value == null ? "" : value);
    return node;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.title = "Codex Local Client Smoke";
    this.body = new FakeElement("body");
    this.documentElement = new FakeElement("html");
  }

  querySelector(selector) {
    if (!this.elements.has(selector)) {
      const tagName = String(selector).toLowerCase().includes("select") ? "select" : "div";
      this.elements.set(selector, new FakeElement(tagName));
    }
    return this.elements.get(selector);
  }

  querySelectorAll() {
    return [];
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class ControlledSse {
  constructor(label) {
    this.label = label;
    this.encoder = new TextEncoder();
    this.queue = [];
    this.waiter = null;
    this.closed = false;
    this.reader = {
      read: () => this.read()
    };
  }

  read() {
    if (this.queue.length) {
      return Promise.resolve({ value: this.queue.shift(), done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    assert.equal(this.waiter, null, `${this.label}: only one pending SSE read is supported`);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  push(eventName, data) {
    assert.equal(this.closed, false, `${this.label}: cannot push after close`);
    const value = this.encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value, done: false });
      return;
    }
    this.queue.push(value);
  }

  close() {
    this.closed = true;
    if (this.waiter && this.queue.length === 0) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined, done: true });
    }
  }
}

class DeferredStatus {
  constructor(label) {
    this.label = label;
    this.requested = false;
    this.settled = false;
    this.promise = new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(data, status = 200) {
    assert.equal(this.requested, true, `${this.label}: status response resolved before request`);
    assert.equal(this.settled, false, `${this.label}: status response already resolved`);
    this.settled = true;
    this.resolvePromise(jsonResponse(data, status));
  }
}

class FetchRouter {
  constructor(gates = []) {
    this.gates = gates.slice();
    this.runCalls = [];
    this.stopCalls = [];
    this.statusGates = [];
    this.statusCalls = [];
    this.history = new Map();
    this.nextHistoryId = 1;
  }

  addHistory(record) {
    this.history.set(record.id, { ...record });
  }

  addStatusGate(gate) {
    this.statusGates.push(gate);
  }

  async fetch(input, options = {}) {
    const target = String(input);
    const method = String(options.method || "GET").toUpperCase();
    if (target === "/api/run" && method === "POST") {
      const gate = this.gates[this.runCalls.length];
      assert.ok(gate, `unexpected /api/run call ${this.runCalls.length + 1}`);
      this.runCalls.push(JSON.parse(String(options.body || "{}")));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        body: { getReader: () => gate.reader }
      };
    }

    if (target === "/api/run/stop" && method === "POST") {
      const payload = JSON.parse(String(options.body || "{}"));
      this.stopCalls.push(payload);
      return jsonResponse({ stopped: true, runId: payload.runId || "" });
    }

    if (target === "/api/status" && method === "GET") {
      const gate = this.statusGates[this.statusCalls.length];
      assert.ok(gate, `unexpected /api/status call ${this.statusCalls.length + 1}`);
      gate.requested = true;
      this.statusCalls.push({ gate, options });
      return gate.promise;
    }

    if (target.startsWith("/api/history")) {
      const url = new URL(target, "http://local.test");
      if (method === "GET") {
        const id = url.searchParams.get("id");
        if (id) {
          return jsonResponse({ record: this.history.get(id) || null });
        }
        const records = Array.from(this.history.values());
        return jsonResponse({ records, totalCount: records.length, favoriteCount: 0 });
      }
      if (method === "POST") {
        const payload = JSON.parse(String(options.body || "{}"));
        const id = payload.id || `history-${this.nextHistoryId++}`;
        const record = {
          ...payload,
          id,
          promptPreview: payload.promptPreview || payload.prompt || "",
          resultPreview: payload.resultPreview || payload.resultText || ""
        };
        this.history.set(id, record);
        return jsonResponse({ record });
      }
    }

    throw new Error(`unexpected fetch ${method} ${target}`);
  }
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

function parentRecord() {
  return {
    id: "history-parent",
    createdAt: "2026-08-11T08:00:00.000Z",
    prompt: "第一轮问题",
    promptPreview: "第一轮问题",
    resultText: OLD_RESULT,
    resultPreview: OLD_RESULT,
    reasoningText: "第一轮推理",
    reasoningEvents: [],
    resultEvents: [],
    workspace: "C:\\smoke-workspace",
    mcpTools: [],
    favorite: false
  };
}

function createHarness(gates) {
  const document = new FakeDocument();
  const localStorage = new MemoryStorage();
  const router = new FetchRouter(gates);
  let timerId = 0;
  const window = {
    document,
    innerWidth: 1600,
    setInterval: () => ++timerId,
    clearInterval: () => {},
    setTimeout: () => ++timerId,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    confirm: () => true
  };
  const context = vm.createContext({
    AbortController,
    Date,
    JSON,
    Math,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    console,
    document,
    fetch: router.fetch.bind(router),
    localStorage,
    navigator: { clipboard: { writeText: async () => {} } },
    window
  });
  const source = fs.readFileSync(appPath, "utf8");
  const bootstrapMarker = '\nelements.modeControl.addEventListener("click"';
  const markerIndex = source.indexOf(bootstrapMarker);
  assert.ok(markerIndex > 0, "app.js bootstrap marker not found; update smoke hook boundary");
  const hookSource = `
globalThis.__continuationSmokeHooks = {
  elements,
  state,
  showHistoryRecord,
  setContinueContext,
  clearContinueContext,
  runCodex,
  handleStreamEvent,
  requestRunningSupplementRestart,
  reconcileCurrentRunStatus,
  stopRunReconcileTimer
};
`;
  vm.runInContext(`${source.slice(0, markerIndex)}\n${hookSource}`, context, { filename: appPath });
  const hooks = context.__continuationSmokeHooks;
  hooks.elements.workspaceInput.value = "C:\\smoke-workspace";
  hooks.elements.agentSelect.value = "auto";
  hooks.elements.autoApprovalDelay.value = "10";
  hooks.elements.codesysMcpToggle.dataset.available = "1";
  hooks.elements.autocadMcpToggle.dataset.available = "1";
  return { hooks, router };
}

async function waitFor(predicate, message, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out: ${message}`);
}

function resultText(hooks) {
  return hooks.elements.resultLog.textContent;
}

function assertRetained(hooks, stage, expectedNew = false) {
  const visible = resultText(hooks);
  assert.ok(
    visible.includes(OLD_RESULT),
    `${stage}: previous result was cleared; expected ${OLD_RESULT}, visible=${JSON.stringify(visible)}`
  );
  if (expectedNew) {
    assert.ok(
      visible.includes(NEW_RESULT),
      `${stage}: new result is missing; expected ${NEW_RESULT}, visible=${JSON.stringify(visible)}`
    );
  }
}

function pushReady(gate, runId) {
  gate.push("ready", {
    runId,
    pid: 4100,
    workspace: "C:\\smoke-workspace",
    sandbox: "danger-full-access",
    approval: "never",
    reasoningEffort: "low",
    requestedReasoningEffort: "low",
    agentProfile: "auto",
    activeAgentProfile: "auto",
    agentLabel: "自动总控",
    mcpTools: [],
    addDirs: [],
    maintenanceContext: false,
    selfCheckMs: 30000,
    stallTimeoutMs: 120000,
    watchdogRecoveryLimit: 0,
    command: "fake codex"
  });
}

function pushResult(gate, text) {
  gate.push("codex", {
    type: "item.completed",
    item: {
      id: `message-${text}`,
      type: "agent_message",
      text
    }
  });
}

function pushCompleted(gate) {
  gate.push("codex", { type: "turn.completed" });
}

function pushExit(gate, options = {}) {
  gate.push("exit", {
    code: options.code == null ? 0 : options.code,
    durationMs: 120,
    stopped: options.stopped === true
  });
  gate.close();
}

async function testSavedHistoryContinuation() {
  const gate = new ControlledSse("saved-history-run");
  const { hooks, router } = createHarness([gate]);
  const parent = parentRecord();
  router.addHistory(parent);
  hooks.showHistoryRecord(parent, { setPrompt: false });
  hooks.setContinueContext(parent, { clearPrompt: true, focus: false });
  hooks.elements.promptInput.value = "继续追问第一轮";
  hooks.elements.resultLog.beginInnerHtmlTracking();

  const runPromise = hooks.runCodex();
  await waitFor(() => router.runCalls.length === 1, "saved history continuation run start");
  assertRetained(hooks, "saved history continuation / run start");
  assert.equal(hooks.elements.resultLog.innerHtmlWriteCount, 0, "saved history continuation / run start replaced resultLog.innerHTML");

  pushReady(gate, "saved-history-run-id");
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.runId === "saved-history-run-id", "saved history ready");
  assertRetained(hooks, "saved history continuation / ready");

  pushResult(gate, NEW_RESULT);
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.resultReceived, "saved history result");
  assertRetained(hooks, "saved history continuation / result", true);

  pushCompleted(gate);
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.turnCompleted, "saved history completed");
  assertRetained(hooks, "saved history continuation / turn.completed", true);

  pushExit(gate);
  await runPromise;
  assertRetained(hooks, "saved history continuation / exit", true);
  assert.equal(hooks.elements.resultLog.innerHtmlWriteCount, 0, "saved history continuation replaced resultLog.innerHTML");
}

async function testIndependentRunClearsOldResult() {
  const gate = new ControlledSse("independent-run");
  const { hooks, router } = createHarness([gate]);
  const parent = parentRecord();
  router.addHistory(parent);
  hooks.showHistoryRecord(parent, { setPrompt: false });
  hooks.clearContinueContext(false);
  hooks.state.lastSavedRecord = null;
  hooks.elements.promptInput.value = "这是一个无关的新任务";
  hooks.elements.resultLog.beginInnerHtmlTracking();

  const runPromise = hooks.runCodex();
  await waitFor(() => router.runCalls.length === 1, "independent run start");
  assert.equal(resultText(hooks).includes(OLD_RESULT), false, "independent run should clear the previous result");
  assert.ok(hooks.elements.resultLog.innerHtmlWriteCount > 0, "independent run should replace resultLog content");

  pushReady(gate, "independent-run-id");
  pushResult(gate, NEW_RESULT);
  pushCompleted(gate);
  pushExit(gate);
  await runPromise;
  assert.ok(resultText(hooks).includes(NEW_RESULT), "independent run should display its new result");
}

async function testImmediateFollowUpBeforeExit() {
  const firstGate = new ControlledSse("immediate-follow-up-first-run");
  const secondGate = new ControlledSse("immediate-follow-up-second-run");
  const { hooks, router } = createHarness([firstGate, secondGate]);
  hooks.elements.promptInput.value = "第一轮正在运行的问题";
  const firstRunPromise = hooks.runCodex();
  await waitFor(() => router.runCalls.length === 1, "first run start");

  pushReady(firstGate, "immediate-first-run-id");
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.runId === "immediate-first-run-id", "first run ready");
  pushResult(firstGate, OLD_RESULT);
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.resultReceived, "first run result");
  pushCompleted(firstGate);
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.turnCompleted, "first run turn.completed");
  assert.equal(hooks.state.running, true, "fixture requires the first run to remain active before exit");
  assertRetained(hooks, "immediate follow-up / before user follow-up");

  hooks.elements.promptInput.value = "结果出来了，立刻继续追问";
  hooks.elements.resultLog.beginInnerHtmlTracking();
  await hooks.runCodex();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(hooks.state.runningSupplementRestart, "immediate follow-up should queue a handoff while the first run is active");

  pushExit(firstGate);
  await firstRunPromise;
  await waitFor(() => router.runCalls.length === 2, "second run start after immediate follow-up");

  assertRetained(hooks, "immediate follow-up / second run start before ready");
  assert.equal(
    hooks.elements.resultLog.innerHtmlWriteCount,
    0,
    "immediate follow-up / second run start destructively replaced resultLog.innerHTML"
  );

  pushReady(secondGate, "immediate-second-run-id");
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.runId === "immediate-second-run-id", "second run ready");
  assertRetained(hooks, "immediate follow-up / second ready");

  pushResult(secondGate, NEW_RESULT);
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.resultReceived, "second run result");
  assertRetained(hooks, "immediate follow-up / second result", true);

  pushCompleted(secondGate);
  await waitFor(() => hooks.state.currentRun && hooks.state.currentRun.turnCompleted, "second run turn.completed");
  assertRetained(hooks, "immediate follow-up / second turn.completed", true);

  pushExit(secondGate);
  secondGate.close();
  await waitFor(() => hooks.state.running === false, "second run exit");
  assertRetained(hooks, "immediate follow-up / second exit", true);
}

async function testStaleRunReconcileResponseIsolation() {
  const { hooks, router } = createHarness([]);
  const oldStatus = new DeferredStatus("old run status");
  const newStatus = new DeferredStatus("new run status");
  router.addStatusGate(oldStatus);
  router.addStatusGate(newStatus);

  const oldRun = {
    runId: "old-run-id",
    exitSeen: false,
    backendMissingSince: 0,
    serverIdleMs: 0,
    waitKind: "model",
    waitLabel: "old-initial",
    lastProgressLabel: "old-initial-progress",
    lastEventDetail: "old-initial-detail"
  };
  hooks.state.running = true;
  hooks.state.currentRun = oldRun;
  const oldRequestPromise = hooks.reconcileCurrentRunStatus();
  await waitFor(() => router.statusCalls.length === 1, "old run status request");
  assert.equal(hooks.state.runReconcileBusy, true, "old status request should mark reconciliation busy");

  hooks.stopRunReconcileTimer();
  const newRun = {
    runId: "new-run-id",
    exitSeen: false,
    backendMissingSince: 0,
    serverIdleMs: 0,
    stallWarning: false,
    selfChecking: false,
    waitKind: "model",
    waitLabel: "new-initial",
    effectiveTimeoutMs: 0,
    selfCheckCount: 0,
    watchdogRecoveryCount: 0,
    lastProgressLabel: "new-initial-progress",
    lastEventDetail: "new-initial-detail"
  };
  hooks.state.running = true;
  hooks.state.currentRun = newRun;
  const newRequestPromise = hooks.reconcileCurrentRunStatus();
  await waitFor(() => router.statusCalls.length === 2, "new run status request");
  const newRequestToken = hooks.state.runReconcileRequest;
  assert.ok(newRequestToken, "new status request should install its own request token");
  assert.equal(hooks.state.runReconcileBusy, true, "new status request should remain busy while pending");

  oldStatus.resolve({
    runs: {
      active: [{
        runId: "old-run-id",
        idleMs: 111,
        stalled: true,
        selfChecking: true,
        waitKind: "tool",
        waitLabel: "stale-old-wait",
        effectiveTimeoutMs: 1111,
        selfCheckCount: 11,
        watchdogRecoveryCount: 11,
        lastEventName: "stale-old-progress",
        lastEventDetail: "stale-old-detail"
      }]
    }
  });
  await oldRequestPromise;

  assert.equal(hooks.state.currentRun, newRun, "late old status response replaced the new currentRun");
  assert.equal(newRun.serverIdleMs, 0, "late old status response mutated new run idle time");
  assert.equal(newRun.waitLabel, "new-initial", "late old status response mutated new run wait label");
  assert.equal(newRun.lastProgressLabel, "new-initial-progress", "late old status response mutated new run progress");
  assert.equal(hooks.state.runReconcileRequest, newRequestToken, "late old status response cleared the new request token");
  assert.equal(hooks.state.runReconcileBusy, true, "late old status response cleared the new request busy flag");

  newStatus.resolve({
    runs: {
      active: [{
        runId: "new-run-id",
        idleMs: 222,
        stalled: false,
        selfChecking: true,
        waitKind: "post-tool",
        waitLabel: "new-live-wait",
        effectiveTimeoutMs: 2222,
        selfCheckCount: 2,
        watchdogRecoveryCount: 1,
        lastEventName: "new-live-progress",
        lastEventDetail: "new-live-detail"
      }]
    }
  });
  await newRequestPromise;

  assert.equal(hooks.state.currentRun, newRun, "new status response should keep the new currentRun object");
  assert.equal(newRun.serverIdleMs, 222, "new status response did not update new run idle time");
  assert.equal(newRun.waitLabel, "new-live-wait", "new status response did not update new run wait label");
  assert.equal(newRun.lastProgressLabel, "new-live-progress", "new status response did not update new run progress");
  assert.equal(newRun.lastEventDetail, "new-live-detail", "new status response did not update new run detail");
  assert.equal(hooks.state.runReconcileRequest, null, "new status response should clear its request token");
  assert.equal(hooks.state.runReconcileBusy, false, "new status response should clear reconciliation busy");
}

async function main() {
  const completed = [];
  await testSavedHistoryContinuation();
  completed.push("saved-history-start-ready-result-completed-exit");
  await testIndependentRunClearsOldResult();
  completed.push("independent-run-clears-old-result");
  await testImmediateFollowUpBeforeExit();
  completed.push("immediate-follow-up-before-exit-retains-old-result");
  await testStaleRunReconcileResponseIsolation();
  completed.push("stale-run-reconcile-response-isolated");
  console.log(JSON.stringify({ ok: true, completed }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
