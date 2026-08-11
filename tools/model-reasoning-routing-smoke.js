"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempPrefix = "codex-model-reasoning-routing-smoke-";

function runFakeCodex() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--fake-codex");
  let prompt = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    prompt += chunk;
  });
  process.stdin.on("end", () => {
    if (args.includes("debug") && args.includes("models") && args.includes("--bundled")) {
      console.log(JSON.stringify({
        models: [
          { slug: "gpt-5.6-sol", default_reasoning_level: "low", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort })) },
          { slug: "gpt-5.6-terra", default_reasoning_level: "medium", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort })) },
          { slug: "gpt-5.6-luna", default_reasoning_level: "medium", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort })) },
          { slug: "gpt-5.5", default_reasoning_level: "medium", supported_reasoning_levels: ["low", "medium", "high", "xhigh"].map((effort) => ({ effort })) },
          { slug: "future-model", default_reasoning_level: "medium" }
        ]
      }));
      return;
    }
    const stateFile = process.env.FAKE_CODEX_STATE_FILE || "";
    if (stateFile) {
      let state = { invocations: [] };
      try {
        state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      } catch {
        state = { invocations: [] };
      }
      if (!Array.isArray(state.invocations)) {
        state.invocations = [];
      }
      state.invocations.push({ args, prompt });
      fs.writeFileSync(stateFile, JSON.stringify(state), "utf8");
    }
    if (args.includes("--version")) {
      console.log("codex-routing-smoke 0.0.0");
      return;
    }
    console.log(JSON.stringify({
      type: "item.completed",
      item: { id: "fake-answer", type: "agent_message", text: "OK" }
    }));
    console.log(JSON.stringify({ type: "turn.completed" }));
  });
  process.stdin.resume();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function availablePort() {
  const configured = Number.parseInt(process.env.TEST_MODEL_REASONING_ROUTING_PORT || "", 10);
  if (Number.isInteger(configured) && configured > 0 && configured < 65536) {
    return configured;
  }
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  assert.ok(port, "failed to allocate an isolated test port");
  return port;
}

async function waitForServer(baseUrl, workspace, child, getSpawnError) {
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const spawnError = getSpawnError();
    if (spawnError) {
      throw spawnError;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`test server exited before readiness (code=${child.exitCode}, signal=${child.signalCode || ""})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/list?path=${encodeURIComponent(workspace)}`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`readiness probe returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`test server did not become ready: ${lastError ? lastError.message : "timeout"}`);
}

function parseSseBlock(block) {
  const eventName = (block.match(/^event:\s*(.+)$/m) || [])[1] || "message";
  const dataText = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n") || "{}";
  return { eventName, data: JSON.parse(dataText) };
}

async function postRun(baseUrl, workspace, options) {
  const payload = {
    workspace,
    prompt: `routing smoke ${options.name}`,
    sandbox: "danger-full-access",
    approval: "never",
    modelMode: options.modelMode,
    model: options.model || "",
    requestedModel: options.requestedModel || "",
    requestedReasoningEffort: options.reasoningEffort,
    reasoningEffort: options.reasoningEffort,
    mcpTools: [],
    maintenanceContext: false,
    webSearch: false,
    ephemeral: true
  };
  const response = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: await response.json().catch(() => ({})),
      events: []
    };
  }

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      if (block.trim()) {
        events.push(parseSseBlock(block));
      }
    }
  }
  if (buffer.trim()) {
    events.push(parseSseBlock(buffer));
  }
  return { ok: true, status: response.status, events };
}

function assertSuccessfulRoute(result, expected) {
  assert.equal(result.ok, true, `${expected.name}: /api/run should succeed`);
  const ready = result.events.find((event) => event.eventName === "ready");
  const exit = result.events.find((event) => event.eventName === "exit");
  assert.ok(ready, `${expected.name}: missing ready SSE event`);
  assert.ok(exit, `${expected.name}: missing exit SSE event`);
  assert.equal(exit.data.code, 0, `${expected.name}: fake Codex should exit successfully`);
  assert.equal(ready.data.model, expected.model, `${expected.name}: wrong routed model`);
  assert.equal(ready.data.requestedModel || "", expected.requestedModel || "", `${expected.name}: wrong requested model`);
  assert.equal(ready.data.modelMode, expected.modelMode, `${expected.name}: wrong model mode`);
  assert.equal(ready.data.reasoningEffort, expected.effort, `${expected.name}: wrong routed reasoning effort`);
  assert.ok(
    String(ready.data.command || "").includes(`--model ${expected.model}`),
    `${expected.name}: ready.command does not contain routed model: ${ready.data.command || ""}`
  );
  assert.ok(
    String(ready.data.command || "").includes(`model_reasoning_effort="${expected.effort}"`),
    `${expected.name}: ready.command does not contain routed effort: ${ready.data.command || ""}`
  );
  return ready.data;
}

async function requestModels(baseUrl) {
  const response = await fetch(`${baseUrl}/api/models`);
  const data = await response.json();
  assert.equal(response.ok, true, `/api/models failed: ${JSON.stringify(data)}`);
  return data;
}

function readFakeInvocationCount(stateFile) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return Array.isArray(state.invocations) ? state.invocations.length : 0;
  } catch {
    return 0;
  }
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  if (await waitForExit(child, 1500)) {
    return;
  }
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 3000))) {
    throw new Error(`failed to stop isolated test server pid ${child.pid || "unknown"}`);
  }
}

function removeCreatedTempRoot(tempRoot) {
  if (!tempRoot) {
    return;
  }
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTemp, resolvedRoot);
  const safe = relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative) &&
    path.basename(resolvedRoot).startsWith(tempPrefix);
  if (!safe) {
    throw new Error(`refusing to remove unexpected test path: ${resolvedRoot}`);
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}

async function main() {
  let tempRoot = "";
  let child = null;
  let spawnError = null;
  let serverStdout = "";
  let serverStderr = "";
  try {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), tempPrefix));
    const codexHome = path.join(tempRoot, "codex-home");
    const runtimeHome = path.join(tempRoot, "runtime-home");
    const workspace = path.join(tempRoot, "workspace");
    const logs = path.join(tempRoot, "logs");
    const mirrors = path.join(tempRoot, "mirrors");
    const stateFile = path.join(tempRoot, "fake-codex-state.json");
    for (const directory of [codexHome, runtimeHome, workspace, logs, mirrors]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(path.join(codexHome, "config.toml"), [
      'model = "gpt-5.6-terra"',
      'model_reasoning_effort = "high"',
      ""
    ].join("\n"), "utf8");

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(root, "server.js")], {
      cwd: root,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        CODEX_CLIENT_CODEX_HOME: codexHome,
        CODEX_CLIENT_RUNTIME_CODEX_HOME: runtimeHome,
        CODEX_CLIENT_WORKSPACE: workspace,
        CODEX_CLIENT_LOG_DIR: logs,
        CODEX_CLIENT_HISTORY_MIRROR: path.join(mirrors, "history.json"),
        CODEX_CLIENT_MAINTENANCE_LOG_MIRROR: path.join(mirrors, "maintenance.md"),
        CODEX_CLIENT_ENGINEERING_MEMORY_MIRROR: path.join(mirrors, "engineering.md"),
        CODEX_CLIENT_DOCUMENT_CACHE: path.join(tempRoot, "document-cache"),
        PYTHON_COMMAND_MEMORY_PATH: path.join(tempRoot, "python-command-memory.json"),
        CODEX_BIN: process.execPath,
        CODEX_BIN_ARGS: JSON.stringify([__filename, "--fake-codex"]),
        FAKE_CODEX_STATE_FILE: stateFile,
        CODEX_CLIENT_PROVIDER_RETRY_LIMIT: "0"
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      serverStdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      serverStderr += chunk;
    });
    await waitForServer(baseUrl, workspace, child, () => spawnError);

    const cases = [
      { name: "auto-low", modelMode: "auto", model: "gpt-5.6-luna", reasoningEffort: "low", expectedModel: "gpt-5.6-luna", expectedEffort: "low" },
      { name: "auto-medium", modelMode: "auto", model: "gpt-5.6-terra", reasoningEffort: "medium", expectedModel: "gpt-5.6-terra", expectedEffort: "medium" },
      { name: "auto-ultra", modelMode: "auto", model: "gpt-5.6-sol", reasoningEffort: "ultra", expectedModel: "gpt-5.6-sol", expectedEffort: "ultra" },
      { name: "configured-default", modelMode: "configured", reasoningEffort: "default", expectedModel: "gpt-5.6-terra", expectedEffort: "high" },
      { name: "explicit-luna-high", modelMode: "explicit", model: "gpt-5.6-luna", requestedModel: "gpt-5.6-luna", reasoningEffort: "high", expectedModel: "gpt-5.6-luna", expectedEffort: "high" },
      { name: "explicit-unknown-capability-ultra", modelMode: "explicit", model: "future-model", requestedModel: "future-model", reasoningEffort: "ultra", expectedModel: "future-model", expectedEffort: "ultra" }
    ];
    const readyEvents = [];
    for (const item of cases) {
      const result = await postRun(baseUrl, workspace, item);
      readyEvents.push(assertSuccessfulRoute(result, {
        name: item.name,
        model: item.expectedModel,
        requestedModel: item.requestedModel || "",
        modelMode: item.modelMode,
        effort: item.expectedEffort
      }));
    }

    const beforeInvalid = readFakeInvocationCount(stateFile);
    const invalid = await postRun(baseUrl, workspace, {
      name: "explicit-luna-ultra",
      modelMode: "explicit",
      model: "gpt-5.6-luna",
      requestedModel: "gpt-5.6-luna",
      reasoningEffort: "ultra"
    });
    assert.equal(invalid.ok, false, "explicit luna + ultra should be rejected");
    assert.equal(invalid.status, 400, "explicit luna + ultra should return HTTP 400");
    assert.match(String(invalid.data.error || ""), /luna.*ultra|ultra.*luna/i, "HTTP 400 should explain the luna/ultra mismatch");
    await delay(100);
    assert.equal(readFakeInvocationCount(stateFile), beforeInvalid, "invalid explicit luna + ultra spawned fake Codex");

    const beforeGpt55Invalid = readFakeInvocationCount(stateFile);
    const invalidGpt55 = await postRun(baseUrl, workspace, {
      name: "explicit-gpt-5.5-ultra",
      modelMode: "explicit",
      model: "gpt-5.5",
      requestedModel: "gpt-5.5",
      reasoningEffort: "ultra"
    });
    assert.equal(invalidGpt55.ok, false, "explicit gpt-5.5 + ultra should be rejected");
    assert.equal(invalidGpt55.status, 400, "explicit gpt-5.5 + ultra should return HTTP 400");
    assert.match(String(invalidGpt55.data.error || ""), /gpt-5\.5.*ultra|ultra.*gpt-5\.5/i, "HTTP 400 should explain the gpt-5.5/ultra mismatch");
    await delay(100);
    assert.equal(readFakeInvocationCount(stateFile), beforeGpt55Invalid, "invalid explicit gpt-5.5 + ultra spawned fake Codex");

    const models = await requestModels(baseUrl);
    assert.equal(models.source, "config", "provider-unavailable model list should fall back to config");
    assert.ok(models.error, "provider-unavailable fallback should report its provider error");
    assert.deepEqual(
      { low: models.autoModelMap.low, medium: models.autoModelMap.medium, high: models.autoModelMap.high },
      { low: "gpt-5.6-luna", medium: "gpt-5.6-terra", high: "gpt-5.6-sol" },
      "fallback autoModelMap should preserve the three routing tiers"
    );
    assert.equal(Object.values(models.autoModelMap).includes("gpt-5.6"), false, "autoModelMap must not expose the gpt-5.6 alias");
    assert.equal((models.models || []).some((model) => model && model.id === "gpt-5.6"), false, "fallback models must not contain the gpt-5.6 alias");
    const lunaModel = (models.models || []).find((model) => model && model.id === "gpt-5.6-luna");
    const solModel = (models.models || []).find((model) => model && model.id === "gpt-5.6-sol");
    assert.ok(lunaModel && lunaModel.reasoningCapabilitiesKnown, "luna should expose known bundled reasoning capabilities");
    assert.deepEqual(lunaModel.supportedReasoningEfforts, ["low", "medium", "high", "xhigh", "max"], "luna reasoning capability list mismatch");
    assert.ok(solModel && solModel.reasoningCapabilitiesKnown, "sol should expose known bundled reasoning capabilities");
    assert.ok(solModel.supportedReasoningEfforts.includes("ultra"), "sol should expose ultra support");
    assert.equal(models.reasoningCapabilities && models.reasoningCapabilities.available, true, "bundled reasoning capability catalog should be available");

    console.log(JSON.stringify({
      ok: true,
      port,
      routes: readyEvents.map((ready) => ({
        modelMode: ready.modelMode,
        requestedReasoningEffort: ready.requestedReasoningEffort,
        model: ready.model,
        reasoningEffort: ready.reasoningEffort
      })),
      invalidLunaUltraStatus: invalid.status,
      invalidGpt55UltraStatus: invalidGpt55.status,
      autoModelMap: models.autoModelMap,
      providerFallback: models.source
    }));
  } catch (error) {
    if (serverStdout.trim()) {
      console.error(`server stdout:\n${serverStdout.trim()}`);
    }
    if (serverStderr.trim()) {
      console.error(`server stderr:\n${serverStderr.trim()}`);
    }
    throw error;
  } finally {
    await stopServer(child);
    removeCreatedTempRoot(tempRoot);
  }
}

if (process.argv.includes("--fake-codex")) {
  runFakeCodex();
} else {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
