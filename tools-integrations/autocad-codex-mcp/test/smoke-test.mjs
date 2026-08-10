import { spawn } from "node:child_process";
import { once } from "node:events";
import readline from "node:readline";

const child = spawn(process.execPath, ["src/server.js"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});

const rl = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity
});

const pending = new Map();
let nextId = 1;

rl.on("line", (line) => {
  const message = JSON.parse(line);
  const resolver = pending.get(message.id);
  if (resolver) {
    pending.delete(message.id);
    resolver(message);
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

function request(method, params = undefined) {
  const id = nextId++;
  const message = { jsonrpc: "2.0", id, method };
  if (params !== undefined) {
    message.params = params;
  }
  const response = new Promise((resolve) => pending.set(id, resolve));
  child.stdin.write(`${JSON.stringify(message)}\n`);
  return response;
}

function notify(method, params = undefined) {
  const message = { jsonrpc: "2.0", method };
  if (params !== undefined) {
    message.params = params;
  }
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const init = await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke-test", version: "0.0.0" }
});

if (init.error) {
  throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
}

notify("notifications/initialized");

const list = await request("tools/list");
if (list.error) {
  throw new Error(`tools/list failed: ${JSON.stringify(list.error)}`);
}

const toolNames = list.result.tools.map((tool) => tool.name);
for (const expected of ["autocad_status", "autocad_draw_rectangle", "autocad_save_as"]) {
  if (!toolNames.includes(expected)) {
    throw new Error(`Missing expected tool: ${expected}`);
  }
}

const status = await request("tools/call", {
  name: "autocad_status",
  arguments: {
    startIfMissing: false,
    timeoutMs: 10000
  }
});

if (status.error) {
  throw new Error(`autocad_status failed: ${JSON.stringify(status.error)}`);
}

console.log(JSON.stringify({
  ok: true,
  toolCount: toolNames.length,
  status: JSON.parse(status.result.content[0].text)
}, null, 2));

child.stdin.end();
await once(child, "exit");
