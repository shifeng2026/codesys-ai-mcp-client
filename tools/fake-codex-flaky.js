"use strict";

const fs = require("fs");

if (process.argv.includes("--version")) {
  console.log("codex-cli fake-flaky 0.0.0");
  process.exit(0);
}

if (process.argv.includes("mcp")) {
  console.error("Error: fake MCP registry has no entries.");
  process.exit(1);
}

const stateFile = process.env.FAKE_CODEX_STATE_FILE || "";
const failTimes = Math.max(0, Number.parseInt(process.env.FAKE_CODEX_FAIL_TIMES || "1", 10) || 0);

let state = { count: 0 };
if (stateFile) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    state = { count: 0 };
  }
}

state.count += 1;
if (stateFile) {
  fs.writeFileSync(stateFile, JSON.stringify(state));
}

process.stdin.resume();
process.stdin.on("end", () => {
  if (state.count <= failTimes) {
    console.error("stream disconnected before completion: error sending request for url (https://ai.discover-42.com/v1/responses)");
    process.exit(1);
    return;
  }

  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      text: "OK"
    }
  }));
  console.log(JSON.stringify({ type: "turn.completed" }));
  process.exit(0);
});
