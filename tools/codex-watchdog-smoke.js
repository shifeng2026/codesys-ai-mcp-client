"use strict";

const baseUrl = String(process.argv[2] || "http://127.0.0.1:5177").replace(/\/+$/, "");
const prompt = process.argv[3] || "Use PowerShell to run Start-Sleep -Seconds 120. Wait for it to finish, then output only OK.";

async function main() {
  const response = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspace: __dirname,
      prompt,
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const eventName = (block.match(/^event:\s*(.+)$/m) || [])[1] || "message";
      const dataText = (block.match(/^data:\s*(.+)$/m) || [])[1] || "{}";
      const data = JSON.parse(dataText);
      events.push(eventName);
      if (eventName === "ready" || eventName === "stalled" || eventName === "exit") {
        console.log(JSON.stringify({ event: eventName, data }));
      }
    }
  }

  const status = await (await fetch(`${baseUrl}/api/status`)).json();
  console.log(JSON.stringify({
    summary: {
      events,
      activeRuns: status.runs && Array.isArray(status.runs.active) ? status.runs.active.length : null
    }
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
