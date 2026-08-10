#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER_NAME = "codesys-codex-mcp";
const SERVER_VERSION = "0.1.0";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CODESYS_JOB_SCRIPT = path.join(PROJECT_ROOT, "scripts", "codesys", "codesys_job.py");
const PYTHON_COMMAND_MEMORY_SCRIPT = path.join(PROJECT_ROOT, "scripts", "python_command_memory.py");
const MAX_CAPTURE_BYTES = 1024 * 1024 * 4;

function writeJson(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return { jsonrpc: "2.0", id, error };
}

function toolText(payload, isError = false) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text }],
    isError
  };
}

function toBool(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return /^(1|true|yes|y|on)$/i.test(String(value));
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizePath(inputPath, fieldName) {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error(`${fieldName} is required`);
  }
  return path.resolve(inputPath);
}

function collectLimited(buffer, chunk) {
  const next = Buffer.concat([buffer, Buffer.from(chunk)]);
  if (next.length <= MAX_CAPTURE_BYTES) {
    return next;
  }
  return next.subarray(next.length - MAX_CAPTURE_BYTES);
}

function findCodesysExeCandidates() {
  const roots = [
    process.env.CODESYS_INSTALL_ROOT,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    "C:\\Program Files",
    "C:\\Program Files (x86)"
  ].filter(Boolean);

  const seenRoots = Array.from(new Set(roots.map((item) => path.resolve(item))));
  const candidates = [];
  const seenCandidates = new Set();

  function walk(current, depth) {
    if (depth < 0 || candidates.length >= 50) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "codesys.exe") {
        const resolved = path.resolve(fullPath);
        if (!seenCandidates.has(resolved)) {
          seenCandidates.add(resolved);
          candidates.push(resolved);
        }
      } else if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (depth > 0 && (lower.includes("codesys") || current.toLowerCase().includes("codesys"))) {
          walk(fullPath, depth - 1);
        }
      }
    }
  }

  for (const root of seenRoots) {
    walk(root, 5);
  }

  return candidates.sort((a, b) => b.localeCompare(a));
}

function resolveCodesysExe(args = {}) {
  const requested = args.codesysExe || process.env.CODESYS_EXE;
  if (requested) {
    const resolved = path.resolve(requested);
    return {
      path: resolved,
      source: args.codesysExe ? "argument" : "CODESYS_EXE",
      exists: pathExists(resolved)
    };
  }
  const candidates = findCodesysExeCandidates();
  if (candidates.length > 0) {
    return { path: candidates[0], source: "auto-detected", exists: true, candidates };
  }
  return { path: null, source: "not-found", exists: false, candidates };
}

function resolvePythonExe(args = {}) {
  return args.pythonExe || process.env.PYTHON_EXE || "python";
}

function spawnCapture(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 300000;
  return new Promise((resolve) => {
    let stdoutBuffer = Buffer.alloc(0);
    let stderrBuffer = Buffer.alloc(0);
    let timedOut = false;

    const child = childProcess.spawn(command, args, {
      cwd: options.cwd || PROJECT_ROOT,
      env: options.env || process.env,
      shell: false,
      windowsVerbatimArguments: options.windowsVerbatimArguments === true,
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer = collectLimited(stdoutBuffer, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer = collectLimited(stderrBuffer, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: null,
        timedOut,
        error: error.message,
        stdout: stdoutBuffer.toString("utf8"),
        stderr: stderrBuffer.toString("utf8")
      });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        stdout: stdoutBuffer.toString("utf8"),
        stderr: stderrBuffer.toString("utf8")
      });
    });
  });
}

function runtimeOptions(args = {}) {
  const timeoutSec = Number(args.timeoutSec || process.env.CODESYS_TIMEOUT_SEC || 300);
  const profile = args.profile || process.env.CODESYS_PROFILE || "";
  const additionalFolder = args.additionalFolder || process.env.CODESYS_ADDITIONAL_FOLDER || "";
  const noUI = toBool(args.noUI, toBool(process.env.CODESYS_NO_UI, true));
  return {
    profile,
    additionalFolder,
    noUI,
    timeoutSec: Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 300
  };
}

function formatProfileArg(profile) {
  const text = String(profile || "").trim();
  if (!text) {
    return "";
  }
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text;
  }
  return /\s/.test(text) ? `"${text.replace(/"/g, "\\\"")}"` : text;
}

function makeJobFile(action, args) {
  const jobsDir = path.join(os.tmpdir(), "codesys-codex-mcp", "jobs");
  ensureDirectory(jobsDir);
  const stamp = `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const jobPath = path.join(jobsDir, `${stamp}.job.json`);
  const resultPath = path.join(jobsDir, `${stamp}.result.json`);
  const job = {
    action,
    resultPath,
    generatedAt: new Date().toISOString(),
    arguments: args
  };
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2), "utf8");
  return { jobPath, resultPath };
}

async function runCodesysJob(action, args = {}) {
  const codesys = resolveCodesysExe(args);
  if (!codesys.path || !codesys.exists) {
    throw new Error(
      "CODESYS.exe was not found. Pass codesysExe, set CODESYS_EXE, or install CODESYS before using this tool."
    );
  }
  if (!pathExists(CODESYS_JOB_SCRIPT)) {
    throw new Error(`CODESYS job script is missing: ${CODESYS_JOB_SCRIPT}`);
  }

  const options = runtimeOptions(args);
  const { jobPath, resultPath } = makeJobFile(action, args);
  const cliArgs = [];
  if (options.profile) {
    cliArgs.push(`--profile=${formatProfileArg(options.profile)}`);
  }
  if (options.noUI) {
    cliArgs.push("--noUI");
  }
  if (options.additionalFolder) {
    cliArgs.push(`--additionalfolder=${options.additionalFolder}`);
  }
  cliArgs.push(`--runscript=${CODESYS_JOB_SCRIPT}`);
  cliArgs.push(`--scriptargs:${jobPath}`);

  const processResult = await spawnCapture(codesys.path, cliArgs, {
    timeoutMs: options.timeoutSec * 1000,
    cwd: PROJECT_ROOT,
    windowsVerbatimArguments: process.platform === "win32"
  });

  let codesysResult = null;
  if (pathExists(resultPath)) {
    try {
      codesysResult = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    } catch (error) {
      codesysResult = { ok: false, parseError: error.message, resultPath };
    }
  }

  const ok =
    processResult.exitCode === 0 &&
    !processResult.timedOut &&
    (!codesysResult || codesysResult.ok !== false);

  return {
    ok,
    action,
    codesysExe: codesys.path,
    codesysExeSource: codesys.source,
    profile: options.profile || null,
    additionalFolder: options.additionalFolder || null,
    noUI: options.noUI,
    timeoutSec: options.timeoutSec,
    jobPath,
    resultPath,
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    timedOut: processResult.timedOut,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    codesysResult
  };
}

async function runArbitraryCodesysScript(args = {}) {
  if (!toBool(process.env.CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT, false)) {
    throw new Error(
      "codesys_run_script is disabled. Set CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT=1 in the MCP environment to enable it."
    );
  }

  const scriptPath = normalizePath(args.scriptPath, "scriptPath");
  if (!pathExists(scriptPath)) {
    throw new Error(`scriptPath does not exist: ${scriptPath}`);
  }

  const codesys = resolveCodesysExe(args);
  if (!codesys.path || !codesys.exists) {
    throw new Error("CODESYS.exe was not found.");
  }

  const options = runtimeOptions(args);
  const cliArgs = [];
  if (options.profile) {
    cliArgs.push(`--profile=${formatProfileArg(options.profile)}`);
  }
  if (options.noUI) {
    cliArgs.push("--noUI");
  }
  if (options.additionalFolder) {
    cliArgs.push(`--additionalfolder=${options.additionalFolder}`);
  }
  cliArgs.push(`--runscript=${scriptPath}`);
  if (args.scriptArgs) {
    cliArgs.push(`--scriptargs:${String(args.scriptArgs)}`);
  }

  const processResult = await spawnCapture(codesys.path, cliArgs, {
    timeoutMs: options.timeoutSec * 1000,
    cwd: PROJECT_ROOT,
    windowsVerbatimArguments: process.platform === "win32"
  });

  return {
    ok: processResult.exitCode === 0 && !processResult.timedOut,
    action: "run_script",
    codesysExe: codesys.path,
    profile: options.profile || null,
    scriptPath,
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    timedOut: processResult.timedOut,
    stdout: processResult.stdout,
    stderr: processResult.stderr
  };
}

function parseJsonOutput(stdout, stderr) {
  const trimmed = String(stdout || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Command produced no JSON output.", stdout, stderr };
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch (_innerError) {
        // Fall through to raw output.
      }
    }
    return { ok: false, error: `Could not parse JSON output: ${error.message}`, stdout, stderr };
  }
}

async function runPythonCommandMemory(subcommand, args = {}) {
  if (!pathExists(PYTHON_COMMAND_MEMORY_SCRIPT)) {
    throw new Error(`Python command memory script is missing: ${PYTHON_COMMAND_MEMORY_SCRIPT}`);
  }

  const pythonExe = resolvePythonExe(args);
  const cliArgs = [PYTHON_COMMAND_MEMORY_SCRIPT, subcommand];

  function addValue(flag, value) {
    if (value !== undefined && value !== null && String(value) !== "") {
      cliArgs.push(flag, String(value));
    }
  }

  function addBool(flag, value) {
    if (value === true) {
      cliArgs.push(flag);
    }
  }

  if (subcommand === "suggest") {
    addValue("--script", args.scriptPath);
    addValue("--cwd", args.cwd);
    addValue("--python-exe", args.pythonExe);
    addValue("--memory-path", args.memoryPath);
    addBool("--force", args.force);
    addValue("--command", args.command);
    addValue("--notes", args.notes);
  } else if (subcommand === "list") {
    addValue("--script", args.scriptPath);
    addValue("--memory-path", args.memoryPath);
  } else if (subcommand === "forget") {
    addValue("--script", args.scriptPath);
    addValue("--version-id", args.versionId);
    addValue("--memory-path", args.memoryPath);
    addBool("--all", args.all);
  } else {
    throw new Error(`Unknown python command memory subcommand: ${subcommand}`);
  }

  const processResult = await spawnCapture(pythonExe, cliArgs, {
    timeoutMs: Number(args.timeoutSec || 30) * 1000,
    cwd: args.cwd || PROJECT_ROOT
  });
  const parsed = parseJsonOutput(processResult.stdout, processResult.stderr);
  parsed.process = {
    pythonExe,
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    timedOut: processResult.timedOut,
    stderr: processResult.stderr
  };
  if (processResult.error) {
    parsed.process.error = processResult.error;
  }
  if (processResult.exitCode !== 0 || processResult.timedOut || processResult.error) {
    parsed.ok = false;
  }
  return parsed;
}

function validateSetup(args = {}) {
  const codesys = resolveCodesysExe(args);
  const nodePath = process.execPath;
  const codexConfigPath = path.join(os.homedir(), ".codex", "config.toml");
  return {
    ok: pathExists(CODESYS_JOB_SCRIPT),
    server: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      root: PROJECT_ROOT,
      node: nodePath,
      nodeVersion: process.version
    },
    codex: {
      configPath: codexConfigPath,
      configExists: pathExists(codexConfigPath)
    },
    codesys: {
      exe: codesys.path,
      source: codesys.source,
      exists: codesys.exists,
      candidates: codesys.candidates || []
    },
    scripts: {
      jobScript: CODESYS_JOB_SCRIPT,
      jobScriptExists: pathExists(CODESYS_JOB_SCRIPT),
      pythonCommandMemoryScript: PYTHON_COMMAND_MEMORY_SCRIPT,
      pythonCommandMemoryScriptExists: pathExists(PYTHON_COMMAND_MEMORY_SCRIPT)
    },
    python: {
      exe: resolvePythonExe(args)
    },
    environment: {
      CODESYS_PROFILE: process.env.CODESYS_PROFILE || "",
      CODESYS_ADDITIONAL_FOLDER: process.env.CODESYS_ADDITIONAL_FOLDER || "",
      CODESYS_NO_UI: process.env.CODESYS_NO_UI || "",
      CODESYS_TIMEOUT_SEC: process.env.CODESYS_TIMEOUT_SEC || "",
      CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT: process.env.CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT || "0",
      PYTHON_EXE: process.env.PYTHON_EXE || "",
      PYTHON_COMMAND_MEMORY_PATH: process.env.PYTHON_COMMAND_MEMORY_PATH || ""
    }
  };
}

const tools = [
  {
    name: "codesys_validate_setup",
    description: "Check whether the MCP bridge, Node.js, Codex config, CODESYS.exe, and CODESYS job script are available.",
    inputSchema: {
      type: "object",
      properties: {
        codesysExe: {
          type: "string",
          description: "Optional absolute path to CODESYS.exe. Overrides CODESYS_EXE."
        }
      }
    }
  },
  {
    name: "codesys_project_info",
    description: "Open a CODESYS project through ScriptEngine and return basic project/application/object information.",
    inputSchema: {
      type: "object",
      required: ["projectPath"],
      properties: {
        projectPath: { type: "string", description: "Path to the .project file." },
        applicationName: { type: "string", description: "Optional application name to select." },
        codesysExe: { type: "string", description: "Optional absolute path to CODESYS.exe." },
        profile: { type: "string", description: "Optional CODESYS profile, for example CODESYS V3.5 SP21." },
        additionalFolder: { type: "string", description: "Optional CODESYS --additionalfolder value." },
        timeoutSec: { type: "integer", minimum: 1, default: 300 },
        noUI: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "codesys_build_project",
    description: "Build or rebuild a CODESYS project through ScriptEngine. This does not download to a PLC.",
    inputSchema: {
      type: "object",
      required: ["projectPath"],
      properties: {
        projectPath: { type: "string", description: "Path to the .project file." },
        applicationName: { type: "string", description: "Optional application name to build." },
        mode: {
          type: "string",
          enum: ["build", "rebuild", "clean", "clean_build", "generate_code"],
          default: "rebuild"
        },
        saveBeforeBuild: { type: "boolean", default: false },
        codesysExe: { type: "string", description: "Optional absolute path to CODESYS.exe." },
        profile: { type: "string", description: "Optional CODESYS profile, for example CODESYS V3.5 SP21." },
        additionalFolder: { type: "string", description: "Optional CODESYS --additionalfolder value." },
        timeoutSec: { type: "integer", minimum: 1, default: 300 },
        noUI: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "codesys_export_project",
    description: "Export CODESYS project objects to PLCopenXML or CODESYS native export format for Git-friendly review.",
    inputSchema: {
      type: "object",
      required: ["projectPath", "exportPath"],
      properties: {
        projectPath: { type: "string", description: "Path to the .project file." },
        exportPath: { type: "string", description: "Output file or folder path." },
        format: { type: "string", enum: ["xml", "plcopenxml", "native"], default: "xml" },
        objectPaths: {
          type: "array",
          items: { type: "string" },
          description: "Optional project object names or slash paths to export. Exports top-level objects when omitted."
        },
        recursive: { type: "boolean", default: true },
        declarationsAsPlainText: { type: "boolean", default: true },
        codesysExe: { type: "string", description: "Optional absolute path to CODESYS.exe." },
        profile: { type: "string", description: "Optional CODESYS profile." },
        additionalFolder: { type: "string", description: "Optional CODESYS --additionalfolder value." },
        timeoutSec: { type: "integer", minimum: 1, default: 300 },
        noUI: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "codesys_import_project",
    description: "Import PLCopenXML or CODESYS native export files into a CODESYS project and optionally save the project.",
    inputSchema: {
      type: "object",
      required: ["projectPath", "importPath"],
      properties: {
        projectPath: { type: "string", description: "Path to the .project file." },
        importPath: { type: "string", description: "Import file or folder path." },
        format: { type: "string", enum: ["xml", "plcopenxml", "native"], default: "xml" },
        save: { type: "boolean", default: true },
        saveAsPath: { type: "string", description: "Optional path for Save As instead of overwriting projectPath." },
        codesysExe: { type: "string", description: "Optional absolute path to CODESYS.exe." },
        profile: { type: "string", description: "Optional CODESYS profile." },
        additionalFolder: { type: "string", description: "Optional CODESYS --additionalfolder value." },
        timeoutSec: { type: "integer", minimum: 1, default: 300 },
        noUI: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "codesys_run_script",
    description:
      "Run an arbitrary CODESYS ScriptEngine script. Disabled by default; enable only for trusted repos with CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT=1.",
    inputSchema: {
      type: "object",
      required: ["scriptPath"],
      properties: {
        scriptPath: { type: "string", description: "Path to a .py script accepted by CODESYS --runscript." },
        scriptArgs: { type: "string", description: "Raw string passed to --scriptargs." },
        codesysExe: { type: "string", description: "Optional absolute path to CODESYS.exe." },
        profile: { type: "string", description: "Optional CODESYS profile." },
        additionalFolder: { type: "string", description: "Optional CODESYS --additionalfolder value." },
        timeoutSec: { type: "integer", minimum: 1, default: 300 },
        noUI: { type: "boolean", default: true }
      }
    }
  },
  {
    name: "python_command_suggest",
    description:
      "Return a remembered execution command for a Python file/version, or read the Python code and generate a new command when no matching memory exists.",
    inputSchema: {
      type: "object",
      required: ["scriptPath"],
      properties: {
        scriptPath: { type: "string", description: "Absolute or workspace-relative path to the Python file." },
        cwd: { type: "string", description: "Working directory to store with the generated command." },
        pythonExe: { type: "string", description: "Python executable to use in generated commands. Defaults to PYTHON_EXE or python." },
        memoryPath: { type: "string", description: "Optional memory JSON path. Defaults to LocalAppData codesys-codex-mcp memory." },
        force: { type: "boolean", default: false, description: "Re-read the file and replace memory for this exact file/version." },
        command: { type: "string", description: "Optional manual command to save for this file/version instead of the generated command." },
        notes: { type: "string", description: "Optional note saved with this command record." },
        timeoutSec: { type: "integer", minimum: 1, default: 30 }
      }
    }
  },
  {
    name: "python_command_history",
    description: "List remembered Python execution commands, optionally limited to one Python file.",
    inputSchema: {
      type: "object",
      properties: {
        scriptPath: { type: "string", description: "Optional Python file path to filter history." },
        memoryPath: { type: "string", description: "Optional memory JSON path." },
        timeoutSec: { type: "integer", minimum: 1, default: 30 }
      }
    }
  },
  {
    name: "python_command_forget",
    description: "Delete remembered Python execution commands for one file/version, or all memory when explicitly requested.",
    inputSchema: {
      type: "object",
      properties: {
        scriptPath: { type: "string", description: "Python file path to forget." },
        versionId: { type: "string", description: "Optional version id to delete only one remembered version." },
        memoryPath: { type: "string", description: "Optional memory JSON path." },
        all: { type: "boolean", default: false, description: "Delete all remembered Python command entries." },
        timeoutSec: { type: "integer", minimum: 1, default: 30 }
      }
    }
  }
];

async function callTool(name, args) {
  switch (name) {
    case "codesys_validate_setup":
      return toolText(validateSetup(args));
    case "codesys_project_info":
      return toolText(await runCodesysJob("info", args));
    case "codesys_build_project":
      return toolText(await runCodesysJob("build", args));
    case "codesys_export_project":
      return toolText(await runCodesysJob("export", args));
    case "codesys_import_project":
      return toolText(await runCodesysJob("import", args));
    case "codesys_run_script":
      return toolText(await runArbitraryCodesysScript(args));
    case "python_command_suggest":
      return toolText(await runPythonCommandMemory("suggest", args));
    case "python_command_history":
      return toolText(await runPythonCommandMemory("list", args));
    case "python_command_forget":
      return toolText(await runPythonCommandMemory("forget", args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message) {
  const hasId = hasOwn(message, "id");
  const id = message.id;
  try {
    switch (message.method) {
      case "initialize":
        if (hasId) {
          writeJson(
            jsonRpcResult(id, {
              protocolVersion: message.params && message.params.protocolVersion ? message.params.protocolVersion : "2025-06-18",
              capabilities: {
                tools: {
                  listChanged: false
                }
              },
              serverInfo: {
                name: SERVER_NAME,
                version: SERVER_VERSION
              },
              instructions:
                "This server automates CODESYS project export/import/build through local ScriptEngine. It intentionally provides no PLC download/run/stop tools."
            })
          );
        }
        return;
      case "notifications/initialized":
      case "notifications/cancelled":
        return;
      case "ping":
        if (hasId) {
          writeJson(jsonRpcResult(id, {}));
        }
        return;
      case "tools/list":
        if (hasId) {
          writeJson(jsonRpcResult(id, { tools }));
        }
        return;
      case "tools/call": {
        if (!hasId) {
          return;
        }
        const params = message.params || {};
        const result = await callTool(params.name, params.arguments || {});
        writeJson(jsonRpcResult(id, result));
        return;
      }
      case "resources/list":
        if (hasId) {
          writeJson(jsonRpcResult(id, { resources: [] }));
        }
        return;
      case "prompts/list":
        if (hasId) {
          writeJson(jsonRpcResult(id, { prompts: [] }));
        }
        return;
      default:
        if (hasId) {
          writeJson(jsonRpcError(id, -32601, `Method not found: ${message.method}`));
        }
    }
  } catch (error) {
    if (hasId) {
      writeJson(
        jsonRpcResult(
          id,
          toolText(
            {
              ok: false,
              error: error.message,
              stack: process.env.CODESYS_MCP_DEBUG === "1" ? error.stack : undefined
            },
            true
          )
        )
      );
    }
  }
}

function startServer() {
  process.stdin.setEncoding("utf8");
  let buffer = "";

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.search(/\r?\n/)) >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      const lineBreakLength = buffer[newlineIndex] === "\r" && buffer[newlineIndex + 1] === "\n" ? 2 : 1;
      buffer = buffer.slice(newlineIndex + lineBreakLength);
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        writeJson(jsonRpcError(null, -32700, "Parse error", error.message));
        continue;
      }
      handleMessage(message);
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });
}

async function selfTest() {
  const report = validateSetup({});
  report.ok = report.ok && !!process.version;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  startServer();
}
