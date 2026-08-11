"use strict";

const fs = require("fs");

if (process.argv.includes("--version")) {
  console.log("codex-cli fake-flaky 0.0.0");
  process.exit(0);
}

if (process.argv.includes("debug") && process.argv.includes("models") && process.argv.includes("--bundled")) {
  console.log(JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        default_reasoning_level: "low",
        supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort }))
      }
    ]
  }));
  process.exit(0);
}

if (process.argv.includes("mcp")) {
  console.error("Error: fake MCP registry has no entries.");
  process.exit(1);
}

const stateFile = process.env.FAKE_CODEX_STATE_FILE || "";
const failTimes = Math.max(0, Number.parseInt(process.env.FAKE_CODEX_FAIL_TIMES || "1", 10) || 0);
const stallTimes = Math.max(0, Number.parseInt(process.env.FAKE_CODEX_STALL_TIMES || "0", 10) || 0);
const intermediateMessageTimes = Math.max(0, Number.parseInt(process.env.FAKE_CODEX_INTERMEDIATE_MESSAGE_TIMES || "0", 10) || 0);
const interactionTimes = Math.max(0, Number.parseInt(process.env.FAKE_CODEX_INTERACTION_TIMES || "0", 10) || 0);
const approvalAbortTimes = Math.max(0, Number.parseInt(process.env.FAKE_CODEX_APPROVAL_ABORT_TIMES || "0", 10) || 0);

let state = { count: 0, invocations: [] };
if (stateFile) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    state = { count: 0, invocations: [] };
  }
}

if (!Array.isArray(state.invocations)) {
  state.invocations = [];
}
state.count += 1;

function saveState() {
  if (stateFile) {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }
}

function imageArguments(args) {
  const images = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "--image" || args[index] === "-i") {
      images.push(args[index + 1]);
      index += 1;
    }
  }
  return images;
}

saveState();
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  state.invocations.push({
    count: state.count,
    args: process.argv.slice(2),
    images: imageArguments(process.argv.slice(2)),
    prompt
  });
  saveState();

  if (state.count <= approvalAbortTimes) {
    console.error("approval request aborted You canceled the request Conversation interrupted");
    setInterval(() => {}, 60000);
    return;
  }

  if (state.count <= interactionTimes) {
    console.error("Approval required: allow this operation? [y/N]");
    setInterval(() => {}, 60000);
    return;
  }

  if (state.count <= stallTimes) {
    if (state.count <= intermediateMessageTimes) {
      console.log(JSON.stringify({
        type: "item.completed",
        item: {
          id: "fake-intermediate-message-1",
          type: "agent_message",
          text: "I have an intermediate update before the tool wait."
        }
      }));
    }
    console.log(JSON.stringify({
      type: "item.started",
      item: {
        id: "fake-tool-1",
        type: "command_execution",
        command: "fake long-running engineering inspection"
      }
    }));
    setInterval(() => {}, 60000);
    return;
  }

  if (state.count <= failTimes) {
    console.error("stream disconnected before completion: error sending request for url (https://ai.discover-42.com/v1/responses)");
    process.exit(1);
    return;
  }

  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      id: "fake-reasoning-1",
      type: "reasoning",
      text: "Recovered after checking the previous wait state and selected a different method."
    }
  }));
  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      id: "fake-result-1",
      type: "agent_message",
      text: "OK"
    }
  }));
  console.log(JSON.stringify({ type: "turn.completed" }));
  process.exit(0);
});
