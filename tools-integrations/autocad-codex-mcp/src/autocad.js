import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RESULT_PREFIX = "@@AUTOCAD_MCP_RESULT@@";
const BRIDGE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "autocad-bridge.ps1");

export class AutoCADError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "AutoCADError";
    this.details = details;
  }
}

export async function callAutoCAD(operation, args = {}) {
  const payload = {
    operation,
    args,
    env: {
      defaultProgId: process.env.AUTOCAD_MCP_PROGID || "AutoCAD.Application.26",
      allowRawCommands: process.env.AUTOCAD_MCP_ALLOW_COMMANDS === "1"
    }
  };

  const timeoutMs = toPositiveInteger(args.timeoutMs, 30000);
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const powerShell = process.env.AUTOCAD_MCP_POWERSHELL
    || `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

  const result = await runPowerShell(powerShell, payloadBase64, timeoutMs);
  if (!result.ok) {
    throw new AutoCADError(result.error?.message || "AutoCAD operation failed.", result.error);
  }
  return result.data;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function runPowerShell(powerShell, payloadBase64, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powerShell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        BRIDGE_SCRIPT
      ],
      {
        env: {
          ...process.env,
          AUTOCAD_MCP_PAYLOAD_B64: payloadBase64
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new AutoCADError(`AutoCAD bridge timed out after ${timeoutMs} ms.`, { timeoutMs }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new AutoCADError(`Could not start PowerShell: ${error.message}`, { stderr }));
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const line = stdout
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .reverse()
        .find((item) => item.startsWith(RESULT_PREFIX));

      if (!line) {
        reject(new AutoCADError("PowerShell bridge did not return a parseable result.", {
          code,
          stdout,
          stderr
        }));
        return;
      }

      try {
        const json = Buffer.from(line.slice(RESULT_PREFIX.length), "base64").toString("utf8");
        resolve(JSON.parse(json));
      } catch (error) {
        reject(new AutoCADError(`Could not parse AutoCAD bridge result: ${error.message}`, {
          code,
          stdout,
          stderr
        }));
      }
    });
  });
}

