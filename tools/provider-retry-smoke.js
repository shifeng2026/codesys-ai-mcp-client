"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.TEST_PROVIDER_RETRY_PORT || 5199);
const baseUrl = `http://127.0.0.1:${port}`;
const stateFile = path.join(os.tmpdir(), `codex-flaky-${process.pid}-${Date.now()}.json`);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Wait for the test server to bind the port.
    }
    await delay(500);
  }
  throw new Error("test server did not become ready");
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

async function runPrompt() {
  const response = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace: __dirname,
      prompt: "只输出 OK",
      sandbox: "workspace-write",
      approval: "never",
      reasoningEffort: "low",
      mcpTools: [],
      maintenanceContext: false,
      ephemeral: true
    })
  });
  if (!response.ok) {
    throw new Error(await response.text());
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
      if (!block.trim()) {
        continue;
      }
      const event = parseSseBlock(block);
      events.push(event);
      if (["ready", "retry", "retry-started", "exit"].includes(event.eventName)) {
        console.log(JSON.stringify({ event: event.eventName, data: event.data }));
      }
    }
  }
  return events;
}

async function main() {
  const server = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      CODEX_BIN: process.execPath,
      CODEX_BIN_ARGS: JSON.stringify([path.join(__dirname, "fake-codex-flaky.js")]),
      FAKE_CODEX_STATE_FILE: stateFile,
      FAKE_CODEX_FAIL_TIMES: "1",
      CODEX_CLIENT_PROVIDER_RETRY_DELAY_MS: "500"
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    const events = await runPrompt();
    const status = await (await fetch(`${baseUrl}/api/status`)).json();
    const names = events.map((event) => event.eventName);
    const exit = events.find((event) => event.eventName === "exit");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const ok = names.includes("retry") &&
      names.includes("retry-started") &&
      exit &&
      exit.data &&
      exit.data.code === 0 &&
      exit.data.providerRetryCount === 1 &&
      state.count === 2 &&
      status.runs &&
      Array.isArray(status.runs.active) &&
      status.runs.active.length === 0;
    console.log(JSON.stringify({
      summary: {
        ok,
        events: names,
        providerRetryCount: exit && exit.data ? exit.data.providerRetryCount : null,
        fakeAttempts: state.count,
        activeRuns: status.runs && Array.isArray(status.runs.active) ? status.runs.active.length : null
      }
    }));
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    server.kill();
    await delay(300);
    if (process.exitCode) {
      console.error(stdout);
      console.error(stderr);
    }
    try {
      fs.unlinkSync(stateFile);
    } catch {
      // Ignore test cleanup failures.
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
