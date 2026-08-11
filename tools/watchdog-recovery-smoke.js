"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const workspace = path.resolve(process.argv[2] || path.join(os.tmpdir(), "codex-client-docs-20260811"));
const scenario = String(process.argv[3] || "tool").toLowerCase();
const manualScenario = scenario === "manual";
const approvalDisabledScenario = scenario === "approval-disabled";
const approvalAbortScenario = scenario === "approval-aborted";
const intermediateToolScenario = scenario === "intermediate-tool";
const multiToolScenario = scenario === "multi-tool";
const approvalScenario = scenario === "approval" || manualScenario || approvalDisabledScenario;
const port = Number(process.env.TEST_WATCHDOG_RECOVERY_PORT || 5188);
const baseUrl = "http://127.0.0.1:" + port;
const stateFile = path.join(os.tmpdir(), "codex-watchdog-recovery-" + process.pid + "-" + Date.now() + ".json");
const cacheDir = path.join(os.tmpdir(), "codex-watchdog-doc-cache-" + process.pid + "-" + Date.now());
const logDir = path.join(os.tmpdir(), "codex-watchdog-logs-" + process.pid + "-" + Date.now());

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch(baseUrl + "/api/status");
      if (response.ok) {
        return;
      }
    } catch {
      // Wait for the isolated server to bind.
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
  const response = await fetch(baseUrl + "/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace,
      prompt: "检查工作目录中的流程图文档并只输出 OK",
      sandbox: "danger-full-access",
      approval: "never",
      reasoningEffort: "low",
      mcpTools: [],
      maintenanceContext: true,
      webSearch: true,
      ephemeral: false,
      autoApprovalEnabled: !manualScenario && !approvalDisabledScenario,
      autoApprovalDelayMs: 3000
    })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let manualRecoveryRequested = false;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      if (!block.trim()) {
        continue;
      }
      const event = parseSseBlock(block);
      events.push(event);
      if (["ready", "approval-required", "approval-aborted", "self-check", "stalled", "recovery", "recovery-started", "exit"].includes(event.eventName)) {
        console.log(JSON.stringify({ event: event.eventName, data: event.data }));
      }
      if (manualScenario && event.eventName === "approval-required" && !manualRecoveryRequested) {
        manualRecoveryRequested = true;
        const policyResponse = await fetch(baseUrl + "/api/run/approval-policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: event.data.runId,
            enabled: false,
            delayMs: 3000
          })
        });
        const policyData = await policyResponse.json();
        events.push({ eventName: "approval-policy-response", data: policyData });
        const recoverResponse = await fetch(baseUrl + "/api/run/recover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: event.data.runId })
        });
        const recoverData = await recoverResponse.json();
        events.push({ eventName: "manual-recover-response", data: recoverData });
        console.log(JSON.stringify({
          event: "manual-approval-actions",
          data: {
            policyStatus: policyResponse.status,
            policyData,
            recoverStatus: recoverResponse.status,
            recoverData
          }
        }));
      }
    }
  }
  return events;
}

async function main() {
  if (!fs.existsSync(workspace)) {
    throw new Error("document test workspace does not exist: " + workspace);
  }
  const server = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      CODEX_BIN: process.execPath,
      CODEX_BIN_ARGS: JSON.stringify([path.join(__dirname, "fake-codex-flaky.js")]),
      CODEX_CLIENT_WORKSPACE: workspace,
      CODEX_CLIENT_LOG_DIR: logDir,
      CODEX_CLIENT_DOCUMENT_CACHE: cacheDir,
      CODEX_CLIENT_PROVIDER_RETRY_LIMIT: "0",
      CODEX_CLIENT_SELF_CHECK_MS: "10000",
      CODEX_CLIENT_STALL_WARNING_MS: "10000",
      CODEX_CLIENT_SAFE_RESTART_MS: "30000",
      CODEX_CLIENT_STALL_TIMEOUT_MS: "40000",
      CODEX_CLIENT_TOOL_IDLE_TIMEOUT_MS: "30000",
      CODEX_CLIENT_POST_TOOL_IDLE_TIMEOUT_MS: "30000",
      FAKE_CODEX_STATE_FILE: stateFile,
      FAKE_CODEX_FAIL_TIMES: "0",
      FAKE_CODEX_STALL_TIMES: approvalScenario || approvalAbortScenario ? "0" : multiToolScenario ? "3" : "1",
      FAKE_CODEX_INTERMEDIATE_MESSAGE_TIMES: intermediateToolScenario ? "1" : "0",
      FAKE_CODEX_INTERACTION_TIMES: approvalScenario ? "1" : "0",
      FAKE_CODEX_APPROVAL_ABORT_TIMES: approvalAbortScenario ? "1" : "0"
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
    const status = await (await fetch(baseUrl + "/api/status")).json();
    const names = events.map((event) => event.eventName);
    const ready = events.find((event) => event.eventName === "ready");
    const recovery = events.find((event) => event.eventName === "recovery");
    const recoveries = events.filter((event) => event.eventName === "recovery" && event.data && event.data.action === "restart");
    const recoveryStarts = events.filter((event) => event.eventName === "recovery-started");
    const exit = events.find((event) => event.eventName === "exit");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const firstInvocation = state.invocations[0] || {};
    const secondInvocation = state.invocations[1] || {};
    const firstImages = Array.isArray(firstInvocation.images) ? firstInvocation.images : [];
    const secondImages = Array.isArray(secondInvocation.images) ? secondInvocation.images : [];
    const documents = ready && ready.data ? ready.data.automaticDocuments : null;
    const expectedTrigger = approvalDisabledScenario || approvalAbortScenario
      ? null
      : manualScenario
      ? "manual-approval"
      : approvalScenario ? "auto-approval" : "tool-idle";
    const scenarioEventsOk = approvalAbortScenario
      ? names.includes("approval-aborted") &&
        names.includes("stalled") &&
        !names.includes("approval-required") &&
        !names.includes("recovery") &&
        !names.includes("recovery-started")
      : approvalDisabledScenario
      ? names.includes("approval-required") &&
        names.includes("self-check") &&
        names.includes("stalled") &&
        !names.includes("recovery") &&
        !names.includes("recovery-started")
      : approvalScenario
      ? names.includes("approval-required") &&
        (!manualScenario || (
          names.includes("approval-policy-response") &&
          names.includes("manual-recover-response") &&
          events.find((event) => event.eventName === "approval-policy-response").data.ok === true &&
          events.find((event) => event.eventName === "manual-recover-response").data.ok === true
        ))
      : names.includes("self-check") && names.includes("stalled");
    const completionOk = approvalAbortScenario
      ? exit && exit.data &&
        exit.data.signal === "INTERACTION_REQUIRED" &&
        exit.data.reason === "interaction-required" &&
        exit.data.stalled === true &&
        exit.data.autoStopped === true &&
        exit.data.approvalAbortDetected === true &&
        exit.data.watchdogRecoveryCount === 0 &&
        state.count === 1
      : approvalDisabledScenario
      ? exit && exit.data &&
        exit.data.signal === "INTERACTION_REQUIRED" &&
        exit.data.reason === "interaction-required" &&
        exit.data.stalled === true &&
        exit.data.autoStopped === true &&
        exit.data.watchdogRecoveryCount === 0 &&
        state.count === 1
      : names.includes("recovery") &&
        names.includes("recovery-started") &&
        recovery && recovery.data && recovery.data.trigger === expectedTrigger &&
        recovery.data.stateAware === true &&
        exit && exit.data && exit.data.code === 0 &&
        exit.data.watchdogRecoveryCount === (multiToolScenario ? 3 : 1) &&
        state.count === (multiToolScenario ? 4 : 2) &&
        recoveries.length === (multiToolScenario ? 3 : 1) &&
        recoveryStarts.length === (multiToolScenario ? 3 : 1) &&
        (!multiToolScenario || JSON.stringify(recoveries.map((event) => event.data.strategy)) === JSON.stringify([
          "现场核对并换路径",
          "缩小范围并完成最小步骤",
          "交付可验证的部分结果"
        ])) &&
        JSON.stringify(firstImages) === JSON.stringify(secondImages) &&
        String(secondInvocation.prompt || "").includes("现场状态") &&
        names.indexOf("recovery") < names.indexOf("recovery-started");
    const ok =
      scenarioEventsOk &&
      completionOk &&
      firstImages.length >= 1 &&
      String(firstInvocation.prompt || "").includes("flow-test.pdf") &&
      documents && documents.visualAttachmentCount >= 1 &&
      status.runs && Array.isArray(status.runs.active) && status.runs.active.length === 0;
    console.log(JSON.stringify({
      summary: {
        ok,
        scenario,
        events: names,
        trigger: recovery && recovery.data ? recovery.data.trigger : null,
        stateAware: recovery && recovery.data ? recovery.data.stateAware : null,
        watchdogRecoveryCount: exit && exit.data ? exit.data.watchdogRecoveryCount : null,
        recoveryStrategies: recoveries.map((event) => event.data.strategy || null),
        fakeAttempts: state.count,
        firstImageCount: firstImages.length,
        secondImageCount: secondImages.length,
        documents,
        activeRuns: status.runs && Array.isArray(status.runs.active) ? status.runs.active.length : null
      }
    }));
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    server.kill();
    await delay(500);
    if (process.exitCode) {
      console.error(stdout);
      console.error(stderr);
    }
    for (const target of [stateFile, cacheDir, logDir]) {
      try {
        fs.rmSync(target, { recursive: true, force: true });
      } catch {
        // Ignore isolated test cleanup failures.
      }
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
