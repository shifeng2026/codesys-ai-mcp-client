#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
let serverScript = path.join(root, "server", "index.js");
const usageDocScript = path.join(root, "scripts", "New-UsageDoc.py");
const argIndex = process.argv.indexOf("-ServerScript");
if (argIndex >= 0 && process.argv[argIndex + 1]) {
  serverScript = path.resolve(process.argv[argIndex + 1]);
}

const child = childProcess.spawn(process.execPath, [serverScript], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

const responses = new Map();
let stdout = "";
let stderr = "";
let done = false;

function fail(message) {
  if (done) {
    return;
  }
  done = true;
  try {
    child.kill();
  } catch (_error) {
    // ignored
  }
  console.error(message);
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
  process.exit(1);
}

function pass() {
  if (done) {
    return;
  }
  done = true;
  try {
    child.kill();
  } catch (_error) {
    // ignored
  }
  const toolsResponse = responses.get(2);
  const validateResponse = responses.get(3);
  const pythonCommandResponse = responses.get(4);
  const pythonCommand = JSON.parse(pythonCommandResponse.result.content[0].text);
  console.log(
    JSON.stringify(
      {
        ok: true,
        serverScript,
        toolCount: toolsResponse.result.tools.length,
        validateSetup: JSON.parse(validateResponse.result.content[0].text),
        pythonCommandMemory: {
          cache: pythonCommand.cache,
          versionId: pythonCommand.file && pythonCommand.file.versionId,
          command: pythonCommand.commandRecord && pythonCommand.commandRecord.command
        }
      },
      null,
      2
    )
  );
  process.exit(0);
}

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
  let newline;
  while ((newline = stdout.search(/\r?\n/)) >= 0) {
    const line = stdout.slice(0, newline).trim();
    const lineBreakLength = stdout[newline] === "\r" && stdout[newline + 1] === "\n" ? 2 : 1;
    stdout = stdout.slice(newline + lineBreakLength);
    if (!line) {
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      fail(`Server emitted invalid JSON: ${error.message}: ${line}`);
      return;
    }
    if (message.id !== undefined) {
      responses.set(message.id, message);
    }
    if (responses.has(1) && responses.has(2) && responses.has(3) && responses.has(4)) {
      const init = responses.get(1);
      const list = responses.get(2);
      const validate = responses.get(3);
      const pythonCommand = responses.get(4);
      if (init.error) {
        fail(`initialize failed: ${JSON.stringify(init.error)}`);
      }
      if (list.error || !list.result || !Array.isArray(list.result.tools)) {
        fail(`tools/list failed: ${JSON.stringify(list)}`);
      }
      const toolNames = new Set(list.result.tools.map((tool) => tool.name));
      for (const expected of ["python_command_suggest", "python_command_history", "python_command_forget"]) {
        if (!toolNames.has(expected)) {
          fail(`tools/list did not include ${expected}`);
        }
      }
      if (validate.error || !validate.result || !validate.result.content) {
        fail(`codesys_validate_setup failed: ${JSON.stringify(validate)}`);
      }
      if (pythonCommand.error || !pythonCommand.result || !pythonCommand.result.content) {
        fail(`python_command_suggest failed: ${JSON.stringify(pythonCommand)}`);
      }
      const parsedPythonCommand = JSON.parse(pythonCommand.result.content[0].text);
      if (!parsedPythonCommand.ok || !parsedPythonCommand.commandRecord || !parsedPythonCommand.commandRecord.command) {
        fail(`python_command_suggest returned invalid payload: ${JSON.stringify(parsedPythonCommand)}`);
      }
      pass();
    }
  }
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

child.on("error", (error) => {
  fail(error.message);
});

child.on("exit", (code, signal) => {
  if (!done && code !== null && code !== 0) {
    fail(`Server exited early with code ${code}, signal ${signal || ""}`);
  }
});

setTimeout(() => fail("Smoke test timed out."), 5000).unref();

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "codesys-codex-mcp-smoke-test", version: "0.1.0" }
  }
});
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "codesys_validate_setup", arguments: {} } });
send({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "python_command_suggest", arguments: { scriptPath: usageDocScript } }
});
