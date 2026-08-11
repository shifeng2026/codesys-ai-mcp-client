"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const zlib = require("zlib");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "5177", 10);
const CLIENT_APP_DIR = __dirname;
const PUBLIC_DIR = path.join(__dirname, "public");
const PLC_LINK_RUNNER_SCRIPT = path.join(__dirname, "tools", "plc_link_runner.py");
const DEFAULT_WORKSPACE = process.env.CODEX_CLIENT_WORKSPACE || os.homedir();
const CODESYS_EXPORT_CACHE_DIR = process.env.CODEX_CLIENT_CODESYS_EXPORT_CACHE || path.join(__dirname, "codesys-exports");
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_CODESYS_TEXT_BYTES = 8 * 1024 * 1024;
const HISTORY_FILE = path.join(__dirname, "codex-history.json");
const LOGS_DIR = process.env.CODEX_CLIENT_LOG_DIR || (process.platform === "win32" ? "C:\\logs" : path.join(os.homedir(), "codex-logs"));
const HISTORY_MIRROR_FILE = process.env.CODEX_CLIENT_HISTORY_MIRROR || path.join(LOGS_DIR, "codex-local-client-history-current.json");
const MAINTENANCE_LOG_FILE = process.env.CODEX_CLIENT_MAINTENANCE_LOG || path.join(__dirname, "maintenance-log-20260731-195311.md");
const MAINTENANCE_LOG_MIRROR_FILE = process.env.CODEX_CLIENT_MAINTENANCE_LOG_MIRROR || path.join(LOGS_DIR, "codex-local-client-maintenance-20260731-195311.md");
const ENGINEERING_MEMORY_FILE = process.env.CODEX_CLIENT_ENGINEERING_MEMORY || path.join(__dirname, "engineering-experience.md");
const ENGINEERING_MEMORY_MIRROR_FILE = process.env.CODEX_CLIENT_ENGINEERING_MEMORY_MIRROR || path.join(LOGS_DIR, "codex-local-client-engineering-experience.md");
const MAX_ENGINEERING_MEMORY_CONTEXT_BYTES = 32000;
const CODEX_RUNTIME_HOME = process.env.CODEX_CLIENT_RUNTIME_CODEX_HOME || path.join(__dirname, ".codex-runtime");
const PROVIDER_PROXY_PREFIX = "/codex-provider-proxy";
const PROVIDER_PROXY_ENABLED = process.env.CODEX_CLIENT_PROVIDER_PROXY !== "0";
const PROVIDER_PROXY_RETRY_LIMIT = clampInteger(
  process.env.CODEX_CLIENT_PROVIDER_PROXY_RETRY_LIMIT,
  0,
  6,
  2
);
const PROVIDER_PROXY_RETRY_DELAY_MS = clampInteger(
  process.env.CODEX_CLIENT_PROVIDER_PROXY_RETRY_DELAY_MS,
  200,
  30000,
  1200
);
const PROVIDER_PROXY_KEEPALIVE_MS = clampInteger(
  process.env.CODEX_CLIENT_PROVIDER_PROXY_KEEPALIVE_MS,
  5000,
  120000,
  15000
);
const CODEX_PROVIDER_RETRY_LIMIT = clampInteger(
  process.env.CODEX_CLIENT_PROVIDER_RETRY_LIMIT,
  0,
  5,
  2
);
const CODEX_PROVIDER_RETRY_DELAY_MS = clampInteger(
  process.env.CODEX_CLIENT_PROVIDER_RETRY_DELAY_MS,
  500,
  60000,
  1800
);
const HISTORY_LIMIT = 300;
const MAX_HISTORY_TEXT_CHARS = 120000;
const MAX_HISTORY_EVENTS = 240;
const MAX_HISTORY_RAW_CHARS = 12000;
const MAX_CONTINUATION_CONTEXT_CHARS = 60000;
const MAX_CONTINUATION_CONTEXT_BYTES = 90000;
const MAX_MAINTENANCE_CONTEXT_CHARS = 30000;
const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;
const MAX_DOCUMENT_TEXT_CHARS = 120000;
const AUTO_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".docm",
  ".xlsx",
  ".xlsm",
  ".txt",
  ".md",
  ".csv",
  ".log"
]);
const AUTO_DOCUMENT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AUTO_DOCUMENT_EXCLUDED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".codex",
  ".codex-runtime",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env",
  "node_modules",
  "build",
  "dist",
  "coverage"
]);
const AUTO_DOCUMENT_CACHE_DIR = process.env.CODEX_CLIENT_DOCUMENT_CACHE || path.join(os.tmpdir(), "codex-local-client-document-cache");
const AUTO_DOCUMENT_MAX_FILES = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_MAX_FILES, 1, 120, 36);
const AUTO_DOCUMENT_MAX_ENTRIES = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_MAX_ENTRIES, 200, 30000, 6000);
const AUTO_DOCUMENT_MAX_DEPTH = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_MAX_DEPTH, 0, 20, 8);
const AUTO_DOCUMENT_TEXT_CHARS = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_TEXT_CHARS, 8000, 120000, 72000);
const AUTO_DOCUMENT_FILE_TEXT_CHARS = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_FILE_TEXT_CHARS, 2000, 60000, 24000);
const AUTO_DOCUMENT_VISUAL_LIMIT = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_VISUAL_LIMIT, 1, 80, 24);
const AUTO_DOCUMENT_RENDER_DPI = clampInteger(process.env.CODEX_CLIENT_DOCUMENT_RENDER_DPI, 96, 216, 144);
const AUTO_DOCUMENT_CACHE_MAX_AGE_MS = clampInteger(
  process.env.CODEX_CLIENT_DOCUMENT_CACHE_MAX_AGE_MS,
  60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000
);
const RECOMMENDED_MODEL_OPTIONS = [
  { id: "gpt-5.6-sol", label: "gpt-5.6-sol", source: "recommended", description: "旗舰编码与复杂任务" },
  { id: "gpt-5.6-terra", label: "gpt-5.6-terra", source: "recommended", description: "日常工程平衡模型" },
  { id: "gpt-5.6-luna", label: "gpt-5.6-luna", source: "recommended", description: "快速低成本模型" }
];
const AUTO_MODEL_BY_REASONING = Object.freeze({
  low: "gpt-5.6-luna",
  medium: "gpt-5.6-terra",
  high: "gpt-5.6-sol",
  xhigh: "gpt-5.6-sol",
  max: "gpt-5.6-sol",
  ultra: "gpt-5.6-sol"
});
const MODEL_LIST_TIMEOUT_MS = 12000;
const MODEL_CAPABILITY_CACHE_TTL_MS = clampInteger(
  process.env.CODEX_CLIENT_MODEL_CAPABILITY_CACHE_TTL_MS,
  60 * 1000,
  24 * 60 * 60 * 1000,
  15 * 60 * 1000
);
const CODESYS_DEFAULT_PROFILE = process.env.CODESYS_PROFILE || "CODESYS V3.5 SP20 Patch 4";
const CODESYS_DEFAULT_TIMEOUT_SEC = 300;
const CODESYS_DEFAULT_PROJECT = process.env.CODEX_CLIENT_CODESYS_PROJECT || path.join(os.homedir(), "codesys-plc-git", "projects", "FiveDofPlatform.project");
const CODESYS_DEFAULT_GIT_ROOT = process.env.CODEX_CLIENT_GIT_ROOT || path.join(os.homedir(), "codesys-plc-git");
const CODESYS_PROJECT_SEARCH_LIMIT = 200;
const CODESYS_PROJECT_SEARCH_MAX_DEPTH = 8;
const CODESYS_XML_SEARCH_LIMIT = 400;
const PYTHON_DEFAULT_GIT_ROOT = process.env.CODEX_CLIENT_PYTHON_GIT_ROOT || path.join(os.homedir(), "Documents", "工作资料", "daqctrl");
const PYTHON_DEFAULT_SCRIPT = process.env.CODEX_CLIENT_PYTHON_SCRIPT || path.join(PYTHON_DEFAULT_GIT_ROOT, "daq_plc_interface", "fivedof", "fivedofplat.py");
const PYTHON_DEFAULT_DEVICE = process.env.CODEX_CLIENT_PLC_DEVICE || "fivedof";
const MANUAL_LOCAL_IPV4 = process.env.CODEX_CLIENT_MANUAL_LOCAL_IP || "192.168.31.100";
const PLC_DEFAULT_REGISTER_MAP = process.env.CODEX_CLIENT_REGISTER_MAP || path.join(os.homedir(), "codesys-codex-mcp", "imports", "FiveDofPlatform_v26086.register_map.md");
const PYTHON_DEFAULT_SYNC_PATHS = ["daq_plc_interface", "test_fivedofplat_v26086.py"];
const GIT_COMMAND_TIMEOUT_MS = 120000;
const MAX_PYTHON_TEXT_BYTES = 4 * 1024 * 1024;
const PYTHON_COMMAND_TIMEOUT_MS = 60000;
const PYTHON_COMMAND_OUTPUT_CHARS = 120000;
const ACTIVE_LOCAL_PROCESSES = new Map();
const ACTIVE_CODEX_RUNS = new Map();
const BUNDLED_MODEL_CAPABILITY_CACHE = {
  invocationKey: "",
  expiresAt: 0,
  models: new Map(),
  error: ""
};
const PROVIDER_MODEL_CATALOG_CACHE = {
  configKey: "",
  known: false,
  models: new Set()
};
const CODEX_HEARTBEAT_INTERVAL_MS = 3000;
const CODEX_SELF_CHECK_MS = clampInteger(
  process.env.CODEX_CLIENT_SELF_CHECK_MS,
  10000,
  10 * 60 * 1000,
  60 * 1000
);
const CODEX_STALL_WARNING_MS = clampInteger(
  process.env.CODEX_CLIENT_STALL_WARNING_MS,
  10000,
  30 * 60 * 1000,
  90 * 1000
);
const CODEX_SAFE_RESTART_MS = Math.max(
  CODEX_SELF_CHECK_MS + 30000,
  clampInteger(
    process.env.CODEX_CLIENT_SAFE_RESTART_MS,
    30000,
    30 * 60 * 1000,
    2 * 60 * 1000
  )
);
const CODEX_STALL_TIMEOUT_MS = Math.max(
  CODEX_STALL_WARNING_MS + 30000,
  clampInteger(
    process.env.CODEX_CLIENT_STALL_TIMEOUT_MS,
    30000,
    2 * 60 * 60 * 1000,
    4 * 60 * 1000
  )
);
const CODEX_TOOL_IDLE_TIMEOUT_MS = clampInteger(
  process.env.CODEX_CLIENT_TOOL_IDLE_TIMEOUT_MS,
  30000,
  2 * 60 * 60 * 1000,
  3 * 60 * 1000
);
const CODEX_POST_TOOL_IDLE_TIMEOUT_MS = clampInteger(
  process.env.CODEX_CLIENT_POST_TOOL_IDLE_TIMEOUT_MS,
  30000,
  2 * 60 * 60 * 1000,
  3 * 60 * 1000
);
const CODEX_WATCHDOG_RECOVERY_LIMIT = clampInteger(
  process.env.CODEX_CLIENT_WATCHDOG_RECOVERY_LIMIT,
  1,
  4,
  3
);
const CODEX_RECOVERY_KILL_GRACE_MS = 10000;
const CODEX_COMPLETED_EXIT_GRACE_MS = clampInteger(
  process.env.CODEX_CLIENT_COMPLETED_EXIT_GRACE_MS,
  1000,
  2 * 60 * 1000,
  5 * 1000
);
const PYTHON_TREE_MAX_ENTRIES = 500;
const PYTHON_TREE_EXCLUDED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env",
  "node_modules",
  "build",
  "dist"
]);
const CODESYS_SCAN_EXCLUDED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "build",
  "dist"
]);
const CODESYS_XML_EXTENSIONS = new Set([".plcopenxml", ".xml"]);
const PYTHON_EDITABLE_EXTENSIONS = new Set([
  ".py",
  ".json",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml",
  ".ini",
  ".cfg",
  ".csv",
  ".xml",
  ".ps1",
  ".cmd",
  ".bat"
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

const SANDBOX_VALUES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const APPROVAL_VALUES = new Set(["never", "on-request", "untrusted"]);
const REASONING_VALUES = new Set(["default", "low", "medium", "high", "xhigh", "max", "ultra"]);
const MODEL_MODE_VALUES = new Set(["auto", "configured", "explicit", "custom"]);
const MCP_NAMES = ["codesys", "autocad"];
const MCP_NAME_SET = new Set(MCP_NAMES);
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@+-]+$/;
const AGENT_PROFILE_DEFINITIONS = {
  auto: {
    label: "自动总控",
    description: "按指令自动选择工程排查策略，协调 CODESYS、Python、Git 和客户端维护。"
  },
  plc_fault: {
    label: "软硬件联动故障",
    description: "按指令链路、通讯、寄存器、PLC逻辑、IO/驱动/执行器分层排查软硬件协调故障。"
  },
  codesys: {
    label: "CODESYS工程",
    description: "分析 CODESYS project/XML、变量、POU、任务、编译和导入导出一致性。"
  },
  python_plc: {
    label: "Python-PLC控制",
    description: "设计和分析 PLC 上位机接口、Python 控制架构、Modbus/485 调用、运行命令和异常输出。"
  },
  register_map: {
    label: "寄存器映射",
    description: "核对寄存器表、地址、类型、读写方向、握手位、缩放和端序。"
  },
  verification: {
    label: "验证测试",
    description: "生成最小验证步骤、验收标准和静态/离线/在线分层测试方案。"
  },
  git_sync: {
    label: "Git同步",
    description: "检查 Python 与 CODESYS 仓库状态，生成提交说明，协助拉取、提交和推送。"
  },
  client_maintenance: {
    label: "客户端维护",
    description: "维护本地客户端 UI、后端服务、历史记录、模型代理、打包和维护日志。"
  }
};
const AGENT_PROFILE_SET = new Set(Object.keys(AGENT_PROFILE_DEFINITIONS));

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = MAX_PROMPT_BYTES + 8192) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (!tooLarge && Buffer.byteLength(body, "utf8") > limitBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("请求体过大"), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        return;
      }
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("JSON 格式无效"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (!tooLarge && total > limitBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("请求体过大"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", reject);
  });
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function trimText(value, maxChars = MAX_HISTORY_TEXT_CHARS) {
  const text = value == null ? "" : String(value);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[内容过长，已截断]`;
}

function trimTextTail(value, maxChars) {
  const text = value == null ? "" : String(value);
  if (text.length <= maxChars) {
    return text;
  }
  return `[前文过长，已只保留最近 ${maxChars} 字符]\n\n${text.slice(-maxChars)}`;
}

function trimTextUtf8(value, maxBytes, fromTail = false) {
  const text = value == null ? "" : String(value);
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= maxBytes) {
    return text;
  }
  const marker = "\n\n[内容过长，已按 UTF-8 字节上限截断]\n";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  const content = fromTail
    ? buffer.subarray(Math.max(0, buffer.length - budget)).toString("utf8")
    : buffer.subarray(0, budget).toString("utf8");
  return fromTail ? `${marker}${content}` : `${content}${marker}`;
}

function previewText(value, maxChars = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 1)}…`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function providerRetryDelay(attemptIndex, baseDelayMs) {
  const multiplier = Math.min(8, 2 ** Math.max(0, attemptIndex - 1));
  return Math.min(60000, Math.round(Number(baseDelayMs || 1000) * multiplier));
}

function isTransientProviderText(value) {
  const text = String(value || "").toLowerCase();
  return Boolean(text) && (
    text.includes("stream disconnected before completion") ||
    text.includes("error sending request for url") ||
    text.includes("reconnecting...") ||
    text.includes("connection reset") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("socket hang up") ||
    text.includes("other side closed") ||
    text.includes("terminated") ||
    text.includes("fetch failed") ||
    text.includes("und_err") ||
    text.includes("bad gateway") ||
    text.includes("service unavailable") ||
    text.includes("gateway timeout") ||
    text.includes("/v1/responses")
  );
}

function appendTailText(existing, next, maxChars = 12000) {
  const text = [existing, next].filter(Boolean).join("\n");
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function readHistoryRecords() {
  const candidates = Array.from(new Set([HISTORY_FILE, HISTORY_MIRROR_FILE]));
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!Array.isArray(parsed)) {
        continue;
      }
      return parsed
        .filter((record) => record && record.id && record.prompt)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    } catch {
      // Try the next history source.
    }
  }
  return [];
}

function writeJsonFileAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempFile, filePath);
}

function writeHistoryRecords(records) {
  const limited = records.slice(0, HISTORY_LIMIT);
  writeJsonFileAtomic(HISTORY_FILE, limited);
  try {
    writeJsonFileAtomic(HISTORY_MIRROR_FILE, limited);
  } catch {
    // The local client should keep working even if C:\logs is unavailable.
  }
}

function syncHistoryMirror() {
  try {
    const records = readHistoryRecords().slice(0, HISTORY_LIMIT);
    writeJsonFileAtomic(HISTORY_MIRROR_FILE, records);
  } catch {
    // Keep startup non-blocking if the external log directory is unavailable.
  }
}

function readMaintenanceText() {
  const candidates = Array.from(new Set([MAINTENANCE_LOG_FILE, MAINTENANCE_LOG_MIRROR_FILE]));
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        continue;
      }
      return {
        exists: true,
        file: MAINTENANCE_LOG_FILE,
        mirrorFile: MAINTENANCE_LOG_MIRROR_FILE,
        sourceFile: filePath,
        updatedAt: stats.mtime.toISOString(),
        size: stats.size,
        text: fs.readFileSync(filePath, "utf8")
      };
    } catch {
      // Try the next maintenance source.
    }
  }

  return {
    exists: false,
    file: MAINTENANCE_LOG_FILE,
    mirrorFile: MAINTENANCE_LOG_MIRROR_FILE,
    sourceFile: "",
    updatedAt: "",
    size: 0,
    text: ""
  };
}

function publicMaintenanceStatus(options = {}) {
  const maintenance = readMaintenanceText();
  return {
    exists: maintenance.exists,
    file: maintenance.file,
    mirrorFile: maintenance.mirrorFile,
    sourceFile: maintenance.sourceFile,
    updatedAt: maintenance.updatedAt,
    size: maintenance.size,
    appDir: __dirname,
    logsDir: LOGS_DIR,
    contextChars: MAX_MAINTENANCE_CONTEXT_CHARS,
    textTail: options.includeText ? trimTextTail(maintenance.text, options.maxChars || 12000) : undefined
  };
}

function readEngineeringMemory() {
  const candidates = Array.from(new Set([ENGINEERING_MEMORY_FILE, ENGINEERING_MEMORY_MIRROR_FILE]));
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        continue;
      }
      return {
        exists: true,
        file: ENGINEERING_MEMORY_FILE,
        mirrorFile: ENGINEERING_MEMORY_MIRROR_FILE,
        sourceFile: filePath,
        updatedAt: stats.mtime.toISOString(),
        size: stats.size,
        text: fs.readFileSync(filePath, "utf8")
      };
    } catch {
      continue;
    }
  }
  return {
    exists: false,
    file: ENGINEERING_MEMORY_FILE,
    mirrorFile: ENGINEERING_MEMORY_MIRROR_FILE,
    sourceFile: "",
    updatedAt: "",
    size: 0,
    text: ""
  };
}

function syncEngineeringMemoryMirror() {
  try {
    const memory = readEngineeringMemory();
    if (!memory.exists) {
      return;
    }
    if (!fs.existsSync(ENGINEERING_MEMORY_FILE)) {
      fs.mkdirSync(path.dirname(ENGINEERING_MEMORY_FILE), { recursive: true });
      fs.copyFileSync(memory.sourceFile, ENGINEERING_MEMORY_FILE);
    }
    fs.mkdirSync(path.dirname(ENGINEERING_MEMORY_MIRROR_FILE), { recursive: true });
    fs.copyFileSync(ENGINEERING_MEMORY_FILE, ENGINEERING_MEMORY_MIRROR_FILE);
  } catch {
    // Engineering runs must not fail just because the external mirror is unavailable.
  }
}

function compactRaw(raw) {
  if (raw == null) {
    return null;
  }
  let rawText = "";
  try {
    rawText = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    return { truncated: true, text: "[原始事件无法序列化]" };
  }
  if (rawText.length > MAX_HISTORY_RAW_CHARS) {
    return {
      truncated: true,
      text: trimText(rawText, MAX_HISTORY_RAW_CHARS)
    };
  }
  return raw;
}

function compactEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  return {
    kind: trimText(event.kind || "event", 32),
    title: trimText(event.title || "事件", 120),
    text: trimText(event.text || "", 30000),
    at: trimText(event.at || "", 64),
    raw: compactRaw(event.raw)
  };
}

function compactEventList(events) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .slice(-MAX_HISTORY_EVENTS)
    .map((event) => compactEvent(event))
    .filter(Boolean);
}

function cleanHistoryId(value) {
  const id = String(value || "");
  return /^[A-Za-z0-9-]{16,80}$/.test(id) ? id : "";
}

function normalizeModelMode(value, requestedModel = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "default") {
    return "configured";
  }
  if (mode === "manual") {
    return requestedModel ? "explicit" : "configured";
  }
  if (MODEL_MODE_VALUES.has(mode)) {
    return mode;
  }
  return requestedModel ? "explicit" : "configured";
}

function resolveRunModel(payload, providerConfig, reasoningEffort) {
  const hasRequestedModel = Object.prototype.hasOwnProperty.call(payload, "requestedModel");
  const modelHint = String(payload.model || "").trim();
  const requestedModelInput = String(hasRequestedModel ? payload.requestedModel || "" : modelHint).trim();
  const modelMode = normalizeModelMode(payload.modelMode, requestedModelInput);
  const requestedModel = modelMode === "explicit" || modelMode === "custom" ? requestedModelInput : "";
  let model = requestedModel;
  const modelSource = modelMode;

  if (modelMode === "auto") {
    model = AUTO_MODEL_BY_REASONING[reasoningEffort] || AUTO_MODEL_BY_REASONING.medium;
    if (knownProviderModelAvailability(providerConfig, model) === false) {
      throw Object.assign(new Error(`当前 provider 模型目录中没有 ${model}，请刷新模型列表或切换模型`), { statusCode: 400 });
    }
    if (modelHint && modelHint.toLowerCase() !== model.toLowerCase()) {
      throw Object.assign(new Error(`自动模型映射已变化：${reasoningEffort} 应使用 ${model}，请刷新模型列表后重试`), { statusCode: 400 });
    }
  } else if (modelMode === "configured") {
    model = String(providerConfig.model || "").trim();
  } else if (!requestedModel) {
    throw Object.assign(new Error("显式模型模式缺少模型名称"), { statusCode: 400 });
  }

  if (!model) {
    throw Object.assign(new Error("Codex 配置未指定可运行模型"), { statusCode: 400 });
  }
  if (!MODEL_ID_PATTERN.test(model)) {
    throw Object.assign(new Error("模型名称包含不支持的字符"), { statusCode: 400 });
  }
  validateModelReasoningCompatibility(model, reasoningEffort);

  return {
    requestedModel,
    modelMode,
    modelSource,
    model
  };
}

function compactHistoryRecord(payload) {
  const prompt = trimText(payload.prompt || "", MAX_PROMPT_BYTES);
  if (!prompt.trim()) {
    throw Object.assign(new Error("历史记录缺少指令内容"), { statusCode: 400 });
  }

  const status = new Set(["completed", "failed", "stopped", "reused"]).has(payload.status)
    ? payload.status
    : "completed";
  const createdAt = payload.createdAt && !Number.isNaN(Date.parse(payload.createdAt))
    ? new Date(payload.createdAt).toISOString()
    : new Date().toISOString();
  const durationMs = Number.isFinite(Number(payload.durationMs))
    ? Math.max(0, Math.round(Number(payload.durationMs)))
    : 0;
  const requestedModelValue = Object.prototype.hasOwnProperty.call(payload, "requestedModel")
    ? payload.requestedModel
    : payload.model;
  const requestedModel = trimText(requestedModelValue || "", 120);
  const modelMode = normalizeModelMode(payload.modelMode, requestedModel);

  return {
    id: cleanHistoryId(payload.id) || crypto.randomUUID(),
    createdAt,
    prompt,
    promptPreview: previewText(prompt, 180),
    parentHistoryId: cleanHistoryId(payload.parentHistoryId || payload.continueFromId),
    parentPromptPreview: previewText(payload.parentPromptPreview || "", 180),
    parentResultPreview: previewText(payload.parentResultPreview || "", 220),
    workspace: trimText(payload.workspace || "", 1024),
    mode: trimText(payload.mode || "", 32),
    sandbox: trimText(payload.sandbox || "", 32),
    approval: trimText(payload.approval || "", 32),
    agentProfile: cleanAgentProfile(payload.agentProfile),
    activeAgentProfile: cleanAgentProfile(payload.activeAgentProfile || payload.agentProfile),
    agentLabel: trimText(payload.agentLabel || "", 80),
    requestedReasoningEffort: trimText(payload.requestedReasoningEffort || payload.reasoningEffort || "default", 32),
    reasoningEffort: trimText(payload.reasoningEffort || "default", 32),
    model: trimText(payload.model || "", 120),
    requestedModel,
    modelMode,
    modelSource: trimText(payload.modelSource || modelMode, 32),
    mcpTools: Array.isArray(payload.mcpTools)
      ? payload.mcpTools.map((name) => String(name || "")).filter((name) => MCP_NAME_SET.has(name))
      : [],
    status,
    durationMs,
    favorite: payload.favorite === true,
    favoriteAt: payload.favorite === true && payload.favoriteAt && !Number.isNaN(Date.parse(payload.favoriteAt))
      ? new Date(payload.favoriteAt).toISOString()
      : "",
    reasoningText: trimText(payload.reasoningText || ""),
    resultText: trimText(payload.resultText || ""),
    reasoningEvents: compactEventList(payload.reasoningEvents),
    resultEvents: compactEventList(payload.resultEvents)
  };
}

function publicHistoryRecord(record, options = {}) {
  const requestedModel = Object.prototype.hasOwnProperty.call(record, "requestedModel")
    ? record.requestedModel || ""
    : record.model || "";
  const modelMode = normalizeModelMode(record.modelMode, requestedModel);
  const result = {
    id: record.id,
    createdAt: record.createdAt,
    prompt: options.details ? record.prompt : undefined,
    promptPreview: record.promptPreview || previewText(record.prompt, 180),
    parentHistoryId: record.parentHistoryId || "",
    parentPromptPreview: record.parentPromptPreview || "",
    parentResultPreview: record.parentResultPreview || "",
    workspace: record.workspace,
    mode: record.mode,
    sandbox: record.sandbox,
    approval: record.approval,
    agentProfile: record.agentProfile || "auto",
    activeAgentProfile: record.activeAgentProfile || record.agentProfile || "auto",
    agentLabel: record.agentLabel || "",
    requestedReasoningEffort: record.requestedReasoningEffort || record.reasoningEffort || "default",
    reasoningEffort: record.reasoningEffort,
    model: record.model,
    requestedModel,
    modelMode,
    modelSource: record.modelSource || modelMode,
    mcpTools: Array.isArray(record.mcpTools) ? record.mcpTools : [],
    status: record.status,
    durationMs: record.durationMs,
    favorite: record.favorite === true,
    favoriteAt: record.favoriteAt || "",
    reasoningPreview: previewText(record.reasoningText, 220),
    resultPreview: previewText(record.resultText, 320)
  };

  if (options.details) {
    result.reasoningText = record.reasoningText || "";
    result.resultText = record.resultText || "";
    result.reasoningEvents = Array.isArray(record.reasoningEvents) ? record.reasoningEvents : [];
    result.resultEvents = Array.isArray(record.resultEvents) ? record.resultEvents : [];
  }

  return result;
}

function resolveDirectory(inputPath) {
  const candidate = String(inputPath || DEFAULT_WORKSPACE).trim();
  const absolutePath = path.resolve(candidate);
  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    throw Object.assign(new Error("目录不存在"), { statusCode: 400 });
  }
  if (!stats.isDirectory()) {
    throw Object.assign(new Error("路径不是目录"), { statusCode: 400 });
  }
  return absolutePath;
}

function tryResolveDirectory(inputPath) {
  const candidate = String(inputPath || "").trim();
  if (!candidate) {
    return "";
  }
  try {
    const resolved = path.resolve(candidate);
    return fs.statSync(resolved).isDirectory() ? resolved : "";
  } catch {
    return "";
  }
}

function normalizeRunWorkspace(resolvedPath) {
  const resolved = path.resolve(resolvedPath);
  const home = path.resolve(os.homedir());
  const localCodexConfig = path.join(resolved, ".codex", "config.toml");
  if (resolved.toLowerCase() === home.toLowerCase() && pathExists(localCodexConfig)) {
    return CLIENT_APP_DIR;
  }
  return resolved;
}

function resolveRunWorkspace(payload = {}) {
  const context = payload.workspaceContext && typeof payload.workspaceContext === "object"
    ? payload.workspaceContext
    : {};
  const codesys = context.codesys && typeof context.codesys === "object" ? context.codesys : {};
  const projectDirectory = String(payload.projectDirectory || codesys.projectDirectory || "").trim();
  const projectPath = String(payload.projectPath || codesys.projectPath || "").trim();
  const candidates = [
    payload.workspace,
    payload.pythonRoot,
    payload.gitRoot,
    projectDirectory,
    projectPath ? path.dirname(path.resolve(projectPath)) : "",
    DEFAULT_WORKSPACE
  ];
  for (const candidate of candidates) {
    const resolved = tryResolveDirectory(candidate);
    if (resolved) {
      return normalizeRunWorkspace(resolved);
    }
  }
  return normalizeRunWorkspace(resolveDirectory(payload.workspace));
}

function samePath(left, right) {
  if (!left || !right) {
    return false;
  }
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pushExtraWritableDir(list, seen, workspace, candidate) {
  const resolved = tryResolveDirectory(candidate);
  if (!resolved || samePath(resolved, workspace)) {
    return;
  }
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  list.push(resolved);
}

function resolveExtraWritableDirs(payload = {}, workspace) {
  const context = payload.workspaceContext && typeof payload.workspaceContext === "object"
    ? payload.workspaceContext
    : {};
  const codesys = context.codesys && typeof context.codesys === "object" ? context.codesys : {};
  const python = context.python && typeof context.python === "object" ? context.python : {};
  const plc = context.plc && typeof context.plc === "object" ? context.plc : {};
  const git = context.git && typeof context.git === "object" ? context.git : {};
  const projectDirectory = String(codesys.projectDirectory || payload.projectDirectory || "").trim();
  const projectPath = String(codesys.projectPath || payload.projectPath || "").trim();
  const scriptPath = String(python.script || plc.pythonScript || payload.pythonScript || "").trim();
  const result = [];
  const seen = new Set();
  [
    CLIENT_APP_DIR,
    payload.pythonRoot,
    payload.gitRoot,
    python.root,
    plc.pythonRoot,
    git.pythonRoot,
    git.codesysRoot,
    CODESYS_DEFAULT_GIT_ROOT,
    PYTHON_DEFAULT_GIT_ROOT,
    projectDirectory,
    projectPath ? path.dirname(path.resolve(projectPath)) : "",
    scriptPath ? path.dirname(path.resolve(scriptPath)) : ""
  ].forEach((candidate) => pushExtraWritableDir(result, seen, workspace, candidate));
  return result;
}

function getCodexInvocation() {
  if (process.env.CODEX_BIN) {
    return {
      command: process.env.CODEX_BIN,
      baseArgs: parseCodexBinArgs(process.env.CODEX_BIN_ARGS),
      source: "CODEX_BIN"
    };
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const codexJs = path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(codexJs)) {
      return {
        command: process.execPath,
        baseArgs: [codexJs],
        source: codexJs
      };
    }
  }

  return {
    command: "codex",
    baseArgs: [],
    source: "PATH"
  };
}

function parseCodexBinArgs(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function getCodexStatus() {
  const invocation = getCodexInvocation();
  const result = spawnSync(invocation.command, [...invocation.baseArgs, "--version"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
    env: getCodexChildEnv()
  });

  return {
    ok: result.status === 0,
    command: invocation.command,
    source: invocation.source,
    version: (result.stdout || result.stderr || "").trim(),
    error: result.error ? result.error.message : null
  };
}

function bundledModelCapabilityInvocationKey(invocation) {
  return JSON.stringify([invocation.command, ...(invocation.baseArgs || [])]);
}

function parseBundledModelCatalog(text) {
  const candidates = [String(text || "").trim(), ...String(text || "").split(/\r?\n/).reverse()]
    .map((item) => item.trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && Array.isArray(parsed.models)) {
        return parsed.models;
      }
    } catch {}
  }
  throw new Error("Codex bundled 模型目录不是有效 JSON");
}

function getBundledModelCapabilityCatalog() {
  const invocation = getCodexInvocation();
  const invocationKey = bundledModelCapabilityInvocationKey(invocation);
  const now = Date.now();
  if (
    BUNDLED_MODEL_CAPABILITY_CACHE.invocationKey === invocationKey &&
    BUNDLED_MODEL_CAPABILITY_CACHE.expiresAt > now
  ) {
    return BUNDLED_MODEL_CAPABILITY_CACHE;
  }

  const result = spawnSync(invocation.command, [...invocation.baseArgs, "debug", "models", "--bundled"], {
    encoding: "utf8",
    timeout: MODEL_LIST_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: getCodexChildEnv()
  });
  const models = new Map();
  let error = "";
  try {
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(trimText(`${result.stderr || ""}\n${result.stdout || ""}`.trim(), 500) || `Codex 退出状态 ${result.status}`);
    }
    for (const item of parseBundledModelCatalog(result.stdout || result.stderr || "")) {
      const id = String(item && (item.slug || item.id || item.model) || "").trim();
      if (!id || !MODEL_ID_PATTERN.test(id)) {
        continue;
      }
      const supportedReasoningEfforts = Array.from(new Set((Array.isArray(item.supported_reasoning_levels)
        ? item.supported_reasoning_levels
        : [])
        .map((level) => String(level && typeof level === "object" ? level.effort || "" : level || "").trim())
        .filter((effort) => effort !== "default" && REASONING_VALUES.has(effort))));
      if (!supportedReasoningEfforts.length) {
        continue;
      }
      models.set(id.toLowerCase(), {
        id,
        defaultReasoningEffort: REASONING_VALUES.has(item.default_reasoning_level)
          ? item.default_reasoning_level
          : "",
        supportedReasoningEfforts
      });
    }
    if (!models.size) {
      throw new Error("Codex bundled 模型目录为空");
    }
  } catch (catalogError) {
    error = catalogError.message || String(catalogError);
    models.clear();
  }

  BUNDLED_MODEL_CAPABILITY_CACHE.invocationKey = invocationKey;
  BUNDLED_MODEL_CAPABILITY_CACHE.expiresAt = now + (error ? Math.min(MODEL_CAPABILITY_CACHE_TTL_MS, 60 * 1000) : MODEL_CAPABILITY_CACHE_TTL_MS);
  BUNDLED_MODEL_CAPABILITY_CACHE.models = models;
  BUNDLED_MODEL_CAPABILITY_CACHE.error = error;
  return BUNDLED_MODEL_CAPABILITY_CACHE;
}

function bundledModelCapability(model, catalog = getBundledModelCapabilityCatalog()) {
  const key = String(model || "").trim().toLowerCase();
  return key && catalog && catalog.models instanceof Map ? catalog.models.get(key) || null : null;
}

function validateModelReasoningCompatibility(model, reasoningEffort) {
  if (!reasoningEffort || reasoningEffort === "default") {
    return;
  }
  const capability = bundledModelCapability(model);
  if (capability && !capability.supportedReasoningEfforts.includes(reasoningEffort)) {
    const supported = capability.supportedReasoningEfforts.join("、") || "未声明";
    throw Object.assign(new Error(`${model} 不支持 ${reasoningEffort} 推理强度；本机 Codex 支持档位：${supported}`), { statusCode: 400 });
  }
  if (!capability && String(model || "").trim().toLowerCase() === "gpt-5.6-luna" && reasoningEffort === "ultra") {
    throw Object.assign(new Error("gpt-5.6-luna 不支持 ultra 推理强度，请改用 gpt-5.6-sol 或 gpt-5.6-terra"), { statusCode: 400 });
  }
}

function pathExists(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function copyFileIfNewer(sourcePath, targetPath) {
  if (!pathExists(sourcePath)) {
    return false;
  }
  try {
    const sourceStats = fs.statSync(sourcePath);
    const targetStats = pathExists(targetPath) ? fs.statSync(targetPath) : null;
    if (targetStats && targetStats.mtimeMs >= sourceStats.mtimeMs && targetStats.size === sourceStats.size) {
      return true;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

function firstExistingDirectory(paths) {
  for (const candidate of paths) {
    if (pathExists(candidate)) {
      try {
        if (fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {
        // Ignore broken candidates.
      }
    }
  }
  return paths[0];
}

function getConfiguredCodexHome() {
  const candidates = [
    process.env.CODEX_CLIENT_CODEX_HOME,
    path.join(path.dirname(__dirname), ".codex"),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".codex") : "",
    path.join(os.homedir(), ".codex")
  ].filter(Boolean);

  return firstExistingDirectory(candidates);
}

function ensureCodexRuntimeHome(sourceHome = getConfiguredCodexHome()) {
  const runtimeHome = path.resolve(CODEX_RUNTIME_HOME);
  fs.mkdirSync(runtimeHome, { recursive: true });
  fs.mkdirSync(path.join(runtimeHome, "tmp"), { recursive: true });

  if (sourceHome && path.resolve(sourceHome).toLowerCase() !== runtimeHome.toLowerCase()) {
    copyFileIfNewer(path.join(sourceHome, "auth.json"), path.join(runtimeHome, "auth.json"));
    copyFileIfNewer(path.join(sourceHome, "config.toml"), path.join(runtimeHome, "config.toml"));
  }

  return runtimeHome;
}

function readCodexAuthKey(codexHome = getConfiguredCodexHome()) {
  try {
    const authFile = path.join(codexHome, "auth.json");
    const parsed = JSON.parse(fs.readFileSync(authFile, "utf8"));
    return typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY.trim() : "";
  } catch {
    return "";
  }
}

function getCodexAuthInfo() {
  const codexHome = getConfiguredCodexHome();
  const authFile = path.join(codexHome, "auth.json");
  const key = readCodexAuthKey(codexHome);
  return {
    authFile,
    exists: pathExists(authFile),
    hasOpenAIKey: key.length > 0,
    keyLength: key.length
  };
}

function localIpv4Addresses() {
  const byAddress = new Map();
  if (isValidIpv4(MANUAL_LOCAL_IPV4)) {
    byAddress.set(MANUAL_LOCAL_IPV4, {
      name: "手动配置",
      address: MANUAL_LOCAL_IPV4,
      cidr: "",
      mac: "",
      preferred: true,
      source: "manual"
    });
  }
  for (const item of ipconfigIpv4Addresses()) {
    if (!byAddress.has(item.address)) {
      byAddress.set(item.address, item);
    }
  }
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (!address || address.family !== "IPv4" || address.internal) {
        continue;
      }
      if (byAddress.has(address.address)) {
        continue;
      }
      byAddress.set(address.address, {
        name,
        address: address.address,
        cidr: address.cidr || "",
        mac: address.mac || "",
        preferred: /ethernet|以太网/i.test(name),
        source: "node"
      });
    }
  }
  const items = Array.from(byAddress.values());
  return items.sort((a, b) => {
    if (a.preferred !== b.preferred) {
      return a.preferred ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function ipconfigIpv4Addresses() {
  if (process.platform !== "win32") {
    return [];
  }
  try {
    const ipconfigPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "ipconfig.exe");
    const result = spawnSync(ipconfigPath, [], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true
    });
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    const lines = text.split(/\r?\n/);
    const items = [];
    let adapterName = "";
    let preferred = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const adapterMatch = line.match(/^(.*adapter\s+.+):$/i);
      if (adapterMatch) {
        adapterName = adapterMatch[1].trim();
        preferred = /ethernet|以太网/i.test(adapterName) && !/蓝牙|bluetooth/i.test(adapterName);
        continue;
      }
      const ipv4Match = line.match(/IPv4[^:]*:\s*([0-9]+(?:\.[0-9]+){3})/i);
      if (adapterName && ipv4Match) {
        items.push({
          name: adapterName,
          address: ipv4Match[1],
          cidr: "",
          mac: "",
          preferred,
          source: "ipconfig"
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

function preferredLocalIpv4() {
  if (isValidIpv4(MANUAL_LOCAL_IPV4)) {
    return MANUAL_LOCAL_IPV4;
  }
  const addresses = localIpv4Addresses();
  return addresses.length ? addresses[0].address : "";
}

function isValidIpv4(value) {
  const parts = String(value || "").trim().split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const number = Number.parseInt(part, 10);
    return number >= 0 && number <= 255 && String(number) === String(Number(part));
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTomlString(text, key) {
  const match = text.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? match[1] : "";
}

function extractTomlBoolean(text, key) {
  const match = text.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)`, "m"));
  return match ? match[1] === "true" : null;
}

function extractTomlSection(text, sectionName) {
  const pattern = new RegExp(`\\[${escapeRegExp(sectionName)}\\]([\\s\\S]*?)(?=\\n\\[|$)`, "m");
  const match = text.match(pattern);
  return match ? match[1] || "" : "";
}

function extractModelHintsFromConfig(text) {
  const hints = [];
  const configuredModel = extractTomlString(text, "model");
  if (configuredModel) {
    hints.push(configuredModel);
  }

  const availabilitySection = extractTomlSection(text, "tui.model_availability_nux");
  const quotedKeyPattern = /^\s*"([^"]+)"\s*=/gm;
  let keyMatch = quotedKeyPattern.exec(availabilitySection);
  while (keyMatch) {
    hints.push(keyMatch[1]);
    keyMatch = quotedKeyPattern.exec(availabilitySection);
  }

  return Array.from(new Set(hints.filter((model) => MODEL_ID_PATTERN.test(model))));
}

function getCodexConfigSummary() {
  const codexHome = getConfiguredCodexHome();
  const configFile = path.join(codexHome, "config.toml");
  let text = "";
  try {
    text = fs.readFileSync(configFile, "utf8");
  } catch {
    return {
      codexHome,
      configFile,
      exists: false,
      modelProvider: "",
      model: "",
      modelReasoningEffort: "",
      baseUrl: "",
      wireApi: "",
      supportsWebsockets: null,
      modelHints: []
    };
  }

  const modelProvider = extractTomlString(text, "model_provider");
  const providerPattern = modelProvider
    ? new RegExp(`\\[model_providers\\.${escapeRegExp(modelProvider)}\\]([\\s\\S]*?)(?=\\n\\[|$)`, "m")
    : null;
  const providerSection = providerPattern ? (text.match(providerPattern) || [])[1] || "" : "";

  return {
    codexHome,
    configFile,
    exists: true,
    modelProvider,
    model: extractTomlString(text, "model"),
    modelReasoningEffort: extractTomlString(text, "model_reasoning_effort"),
    baseUrl: extractTomlString(providerSection || text, "base_url"),
    wireApi: extractTomlString(providerSection || text, "wire_api"),
    supportsWebsockets: extractTomlBoolean(providerSection || text, "supports_websockets"),
    modelHints: extractModelHintsFromConfig(text)
  };
}

function getCodexChildEnv(baseUrlOverride = "") {
  const config = getCodexConfigSummary();
  const runtimeHome = ensureCodexRuntimeHome(config.codexHome);
  const env = {
    ...process.env,
    CODEX_HOME: runtimeHome,
    CODEX_CLIENT_CODEX_HOME: config.codexHome,
    CODEX_CLIENT_RUNTIME_CODEX_HOME: runtimeHome
  };

  const key = readCodexAuthKey(config.codexHome);
  if (key && !env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = key;
  }
  if (baseUrlOverride) {
    env.OPENAI_BASE_URL = baseUrlOverride;
  } else if (config.baseUrl && !env.OPENAI_BASE_URL) {
    env.OPENAI_BASE_URL = config.baseUrl;
  }

  return env;
}

function buildModelsUrl(baseUrl) {
  if (!baseUrl) {
    return "";
  }
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/models") ? pathname : `${pathname}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function localProviderProxyHost() {
  return HOST === "0.0.0.0" || HOST === "::" ? "127.0.0.1" : HOST;
}

function localProviderProxyBaseUrl(config) {
  if (!config || !config.baseUrl) {
    return "";
  }
  try {
    const base = new URL(config.baseUrl);
    const pathname = base.pathname.replace(/\/+$/, "");
    return `http://${localProviderProxyHost()}:${PORT}${PROVIDER_PROXY_PREFIX}${pathname}`;
  } catch {
    return "";
  }
}

function shouldUseProviderProxy(config) {
  if (!PROVIDER_PROXY_ENABLED || !config || !config.baseUrl) {
    return false;
  }
  try {
    return new URL(config.baseUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeProviderModel(item) {
  if (typeof item === "string") {
    return item;
  }
  if (!item || typeof item !== "object") {
    return "";
  }
  return String(item.id || item.model || item.name || "").trim();
}

function mergeModelOptions(configuredModel, hints, providerModels, options = {}) {
  const models = [];
  const seen = new Set();

  function add(value, source, description = "") {
    const entry = value && typeof value === "object"
      ? {
          id: String(value.id || value.model || value.name || "").trim(),
          label: String(value.label || value.id || value.model || value.name || "").trim(),
          description: String(value.description || description || "").trim(),
          source: String(value.source || source || "").trim() || source
        }
      : {
          id: String(value || "").trim(),
          label: String(value || "").trim(),
          description: String(description || "").trim(),
          source
        };
    if (!entry.id || seen.has(entry.id) || !MODEL_ID_PATTERN.test(entry.id)) {
      return;
    }
    seen.add(entry.id);
    models.push({
      id: entry.id,
      label: entry.label || entry.id,
      description: entry.description || "",
      source: entry.source || source
    });
  }

  if (options.includeConfigured !== false) {
    add(configuredModel, "configured");
  }
  if (options.includeRecommended !== false) {
    for (const recommended of RECOMMENDED_MODEL_OPTIONS) {
      add(recommended, recommended.source || "recommended", recommended.description || "");
    }
  }
  for (const hint of hints || []) {
    add(hint, "config");
  }
  for (const model of providerModels || []) {
    add(model, "provider");
  }

  return models.sort((left, right) => {
    if (left.id === configuredModel) {
      return -1;
    }
    if (right.id === configuredModel) {
      return 1;
    }
    if (left.source === "recommended" && right.source !== "recommended") {
      return -1;
    }
    if (right.source === "recommended" && left.source !== "recommended") {
      return 1;
    }
    return left.id.localeCompare(right.id, "en");
  });
}

function providerModelCatalogConfigKey(config) {
  return JSON.stringify([
    String(config && config.modelProvider || "").trim().toLowerCase(),
    String(config && config.baseUrl || "").trim().replace(/\/+$/, "").toLowerCase()
  ]);
}

function rememberProviderModelCatalog(config, providerResult) {
  PROVIDER_MODEL_CATALOG_CACHE.configKey = providerModelCatalogConfigKey(config);
  PROVIDER_MODEL_CATALOG_CACHE.known = !providerResult.error;
  PROVIDER_MODEL_CATALOG_CACHE.models = new Set((providerResult.models || [])
    .map((model) => normalizeProviderModel(model).toLowerCase())
    .filter(Boolean));
}

function knownProviderModelAvailability(config, model) {
  if (
    !PROVIDER_MODEL_CATALOG_CACHE.known ||
    PROVIDER_MODEL_CATALOG_CACHE.configKey !== providerModelCatalogConfigKey(config)
  ) {
    return null;
  }
  return PROVIDER_MODEL_CATALOG_CACHE.models.has(String(model || "").trim().toLowerCase());
}

function attachModelReasoningCapabilities(models, catalog) {
  return (models || []).map((model) => {
    const capability = bundledModelCapability(model.id, catalog);
    return {
      ...model,
      supportedReasoningEfforts: capability ? capability.supportedReasoningEfforts.slice() : [],
      defaultReasoningEffort: capability ? capability.defaultReasoningEffort : "",
      reasoningCapabilitiesKnown: Boolean(capability)
    };
  });
}

async function requestProviderModels(config) {
  const url = buildModelsUrl(config.baseUrl);
  if (!url) {
    return { url, models: [], error: "未配置模型 provider base_url" };
  }

  const headers = { Accept: "application/json" };
  const key = readCodexAuthKey(config.codexHome);
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        url,
        models: [],
        error: `模型列表接口返回 ${response.status}: ${trimText(text, 300)}`
      };
    }

    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      return { url, models: [], error: "模型列表接口返回的 JSON 无效" };
    }

    const rawModels = Array.isArray(parsed.data)
      ? parsed.data
      : Array.isArray(parsed.models)
        ? parsed.models
        : Array.isArray(parsed)
          ? parsed
          : [];
    return {
      url,
      models: rawModels.map((item) => normalizeProviderModel(item)).filter(Boolean),
      error: ""
    };
  } catch (error) {
    return {
      url,
      models: [],
      error: error.name === "AbortError" ? "模型列表接口请求超时" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveDocumentPath(filePath, workspace = DEFAULT_WORKSPACE) {
  const candidate = String(filePath || "").trim();
  if (!candidate) {
    throw httpError("缺少文档路径", 400);
  }
  const baseWorkspace = tryResolveDirectory(workspace) || DEFAULT_WORKSPACE;
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(baseWorkspace, candidate);
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) {
    throw httpError(`路径不是文件: ${resolved}`, 400);
  }
  if (stats.size > MAX_DOCUMENT_BYTES) {
    throw httpError(`文件过大，已超过 ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB: ${resolved}`, 413);
  }
  return resolved;
}

function runDocumentReader(filePath, maxChars = MAX_DOCUMENT_TEXT_CHARS, options = {}) {
  const scriptPath = path.join(__dirname, "tools", "document_reader.py");
  if (!pathExists(scriptPath)) {
    throw httpError(`文档读取脚本不存在: ${scriptPath}`, 500);
  }
  const args = [scriptPath, "--max-chars", String(maxChars)];
  const visualDir = String(options.visualDir || "").trim();
  const maxVisualPages = clampInteger(options.maxVisualPages, 0, AUTO_DOCUMENT_VISUAL_LIMIT, 0);
  if (visualDir && maxVisualPages > 0) {
    args.push(
      "--visual-dir",
      visualDir,
      "--max-visual-pages",
      String(maxVisualPages),
      "--render-dpi",
      String(AUTO_DOCUMENT_RENDER_DPI)
    );
  }
  args.push(filePath);
  const result = spawnSync("python", args, {
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    }
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.error) {
    throw httpError(`文档读取失败: ${result.error.message}`, 500);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout || "{}");
  } catch {
    throw httpError(`文档读取失败: ${trimText(output, 400) || "解析 JSON 失败"}`, 500);
  }
  if (result.status !== 0 || parsed.ok === false) {
    throw httpError(parsed.error || trimText(output, 400) || "文档读取失败", 500);
  }
  return parsed;
}

async function handleDocumentRead(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const filePath = resolveDocumentPath(payload.filePath || payload.path || "", payload.workspace || DEFAULT_WORKSPACE);
  const stats = fs.statSync(filePath);
  const preview = runDocumentReader(filePath, MAX_DOCUMENT_TEXT_CHARS);
  sendJson(res, 200, {
    ...preview,
    ok: true,
    filePath,
    fileName: path.basename(filePath),
    size: stats.size,
    text: trimText(preview.text || "", MAX_DOCUMENT_TEXT_CHARS)
  });
}

function buildAutoModelMap(modelValues) {
  const available = new Map();
  for (const value of modelValues || []) {
    const id = normalizeProviderModel(value);
    if (id) {
      available.set(id.toLowerCase(), id);
    }
  }
  return Object.fromEntries(Object.entries(AUTO_MODEL_BY_REASONING).map(([effort, desiredModel]) => [
    effort,
    available.get(desiredModel.toLowerCase()) || ""
  ]));
}

function automaticDocumentPriority(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    return 0;
  }
  if (AUTO_DOCUMENT_IMAGE_EXTENSIONS.has(extension)) {
    return 1;
  }
  if ([".docx", ".docm", ".xlsx", ".xlsm"].includes(extension)) {
    return 2;
  }
  return 3;
}

function discoverAutomaticDocuments(workspace) {
  const candidates = [];
  const stack = [{ dir: path.resolve(workspace), depth: 0 }];
  const candidateLimit = AUTO_DOCUMENT_MAX_FILES * 4;
  const internalContextFiles = new Set([
    path.resolve(MAINTENANCE_LOG_FILE).toLowerCase(),
    path.resolve(ENGINEERING_MEMORY_FILE).toLowerCase(),
    path.resolve(HISTORY_FILE).toLowerCase()
  ]);
  let scannedEntries = 0;

  while (
    stack.length &&
    candidates.length < candidateLimit &&
    scannedEntries < AUTO_DOCUMENT_MAX_ENTRIES
  ) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > AUTO_DOCUMENT_MAX_ENTRIES) {
        break;
      }
      if (entry.isSymbolicLink() || entry.name.startsWith("~$")) {
        continue;
      }
      const entryPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (
          current.depth < AUTO_DOCUMENT_MAX_DEPTH &&
          !AUTO_DOCUMENT_EXCLUDED_NAMES.has(entry.name.toLowerCase())
        ) {
          stack.push({ dir: entryPath, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!AUTO_DOCUMENT_EXTENSIONS.has(extension) && !AUTO_DOCUMENT_IMAGE_EXTENSIONS.has(extension)) {
        continue;
      }
      if (internalContextFiles.has(path.resolve(entryPath).toLowerCase())) {
        continue;
      }
      try {
        const stats = fs.statSync(entryPath);
        candidates.push({
          filePath: path.resolve(entryPath),
          relativePath: path.relative(workspace, entryPath) || entry.name,
          extension,
          size: stats.size,
          mtimeMs: stats.mtimeMs
        });
      } catch {
        continue;
      }
      if (candidates.length >= candidateLimit) {
        break;
      }
    }
  }

  candidates.sort((left, right) => {
    return (
      automaticDocumentPriority(left.filePath) - automaticDocumentPriority(right.filePath) ||
      left.relativePath.localeCompare(right.relativePath, "zh-Hans-CN")
    );
  });
  return {
    files: candidates.slice(0, AUTO_DOCUMENT_MAX_FILES),
    discoveredCount: candidates.length,
    scannedEntries,
    truncated:
      candidates.length > AUTO_DOCUMENT_MAX_FILES ||
      candidates.length >= candidateLimit ||
      scannedEntries >= AUTO_DOCUMENT_MAX_ENTRIES
  };
}

function automaticDocumentCacheDir(record) {
  const cacheKey = crypto
    .createHash("sha256")
    .update([record.filePath.toLowerCase(), record.size, Math.floor(record.mtimeMs)].join("|"))
    .digest("hex")
    .slice(0, 24);
  return path.join(AUTO_DOCUMENT_CACHE_DIR, cacheKey);
}

function pruneAutomaticDocumentCache() {
  if (!pathExists(AUTO_DOCUMENT_CACHE_DIR)) {
    return;
  }
  const cacheRoot = path.resolve(AUTO_DOCUMENT_CACHE_DIR);
  const now = Date.now();
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const target = path.resolve(cacheRoot, entry.name);
    if (path.dirname(target).toLowerCase() !== cacheRoot.toLowerCase()) {
      continue;
    }
    try {
      const stats = fs.statSync(target);
      if (now - stats.mtimeMs > AUTO_DOCUMENT_CACHE_MAX_AGE_MS) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    } catch {
      continue;
    }
  }
}

function automaticDocumentVisualItems(preview) {
  const metadata = preview && preview.metadata && typeof preview.metadata === "object"
    ? preview.metadata
    : {};
  const rawItems = [
    ...(Array.isArray(metadata.visualPages) ? metadata.visualPages : []),
    ...(Array.isArray(metadata.visualAssets) ? metadata.visualAssets : [])
  ];
  const seen = new Set();
  const items = [];
  for (const item of rawItems) {
    const filePath = path.resolve(String(item && item.filePath ? item.filePath : ""));
    const key = filePath.toLowerCase();
    if (
      !filePath ||
      seen.has(key) ||
      !AUTO_DOCUMENT_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ||
      !pathExists(filePath)
    ) {
      continue;
    }
    seen.add(key);
    items.push({
      filePath,
      page: Number.isFinite(Number(item.page)) ? Number(item.page) : null,
      source: String(item.source || "")
    });
  }
  return items;
}

function collectAutomaticDocumentContext(workspace) {
  const discovery = discoverAutomaticDocuments(workspace);
  const context = {
    enabled: true,
    workspace,
    discoveredCount: discovery.discoveredCount,
    scannedEntries: discovery.scannedEntries,
    truncated: discovery.truncated,
    indexedCount: 0,
    skippedCount: 0,
    files: [],
    visualAttachments: [],
    errors: []
  };
  if (!discovery.files.length) {
    return context;
  }

  try {
    fs.mkdirSync(AUTO_DOCUMENT_CACHE_DIR, { recursive: true });
    pruneAutomaticDocumentCache();
  } catch {
    // Text indexing remains useful even when the visual cache is unavailable.
  }

  let remainingTextChars = AUTO_DOCUMENT_TEXT_CHARS;
  let remainingVisuals = AUTO_DOCUMENT_VISUAL_LIMIT;
  for (const record of discovery.files) {
    const entry = {
      filePath: record.filePath,
      relativePath: record.relativePath,
      extension: record.extension,
      size: record.size,
      kind: AUTO_DOCUMENT_IMAGE_EXTENSIONS.has(record.extension) ? "image" : "document",
      summary: "",
      text: "",
      visualAttachments: [],
      visualLimited: false
    };

    if (record.size > MAX_DOCUMENT_BYTES) {
      entry.summary = "文件超过自动读取大小上限，保留原始路径供智能体按需检查";
      context.skippedCount += 1;
      context.files.push(entry);
      continue;
    }

    if (AUTO_DOCUMENT_IMAGE_EXTENSIONS.has(record.extension)) {
      entry.summary = "工作目录原始图片";
      if (remainingVisuals > 0) {
        const attachment = {
          filePath: record.filePath,
          sourcePath: record.filePath,
          relativePath: record.relativePath,
          page: null,
          source: "original-image"
        };
        entry.visualAttachments.push(attachment);
        context.visualAttachments.push(attachment);
        remainingVisuals -= 1;
      } else {
        entry.visualLimited = true;
      }
      context.indexedCount += 1;
      context.files.push(entry);
      continue;
    }

    if ([".txt", ".md", ".csv", ".log"].includes(record.extension)) {
      try {
        const text = fs.readFileSync(record.filePath, "utf8");
        entry.kind = "text";
        entry.summary = "工作目录文本文件";
        if (remainingTextChars > 0) {
          entry.text = trimText(text, Math.min(AUTO_DOCUMENT_FILE_TEXT_CHARS, remainingTextChars));
          remainingTextChars = Math.max(0, remainingTextChars - entry.text.length);
        }
        context.indexedCount += 1;
      } catch (error) {
        entry.summary = "自动读取失败，保留原始路径供智能体直接检查";
        context.errors.push({
          relativePath: record.relativePath,
          error: error.message || String(error)
        });
        context.skippedCount += 1;
      }
      context.files.push(entry);
      continue;
    }

    try {
      const preview = runDocumentReader(
        record.filePath,
        Math.max(1, Math.min(AUTO_DOCUMENT_FILE_TEXT_CHARS, remainingTextChars || 1)),
        {
          visualDir: remainingVisuals > 0 ? automaticDocumentCacheDir(record) : "",
          maxVisualPages: remainingVisuals
        }
      );
      entry.kind = preview.kind || "document";
      entry.summary = String(preview.summary || "");
      if (remainingTextChars > 0) {
        entry.text = trimText(preview.text || "", remainingTextChars);
        remainingTextChars = Math.max(0, remainingTextChars - entry.text.length);
      }
      const visualItems = automaticDocumentVisualItems(preview).slice(0, remainingVisuals);
      for (const item of visualItems) {
        const attachment = {
          ...item,
          sourcePath: record.filePath,
          relativePath: record.relativePath
        };
        entry.visualAttachments.push(attachment);
        context.visualAttachments.push(attachment);
      }
      remainingVisuals = Math.max(0, remainingVisuals - visualItems.length);
      const metadata = preview.metadata && typeof preview.metadata === "object" ? preview.metadata : {};
      entry.visualLimited = metadata.visualPagesLimited === true;
      if (metadata.visualError) {
        context.errors.push({
          relativePath: record.relativePath,
          error: String(metadata.visualError)
        });
      }
      context.indexedCount += 1;
    } catch (error) {
      entry.summary = "自动读取失败，保留原始路径供智能体直接检查";
      context.errors.push({
        relativePath: record.relativePath,
        error: error.message || String(error)
      });
      context.skippedCount += 1;
    }
    context.files.push(entry);
  }
  return context;
}

function automaticDocumentPromptPrefix(context) {
  if (!context || !Array.isArray(context.files) || !context.files.length) {
    return "";
  }
  const lines = [
    "客户端后台文档阅读固定开启，已自动检索当前工作目录；不要要求用户再次手动选择这些文件。",
    "文本抽取只用于检索。不得把 PDF 文本层或 Word/Excel 内部 XML 当成完整原件；流程图、接线图、版面、表格关系和扫描页必须结合视觉附件或原始文件核对。",
    "下面每条都保留原始绝对路径。视觉附件已通过 Codex 原生图片输入提供，并标注对应原文件和 PDF 页码。",
    "若视觉页因数量上限未预载，必须根据问题用原始路径和本机 PDF 渲染工具按需检查相关页，不能据纯文本猜测图形关系。",
    "",
    "[自动发现的工作目录文档]"
  ];

  for (const file of context.files) {
    const visuals = file.visualAttachments.map((item) => {
      return item.page ? "PDF 第 " + item.page + " 页" : (item.source || "原始图片");
    });
    lines.push(
      "- " + file.relativePath +
      " | 原始路径: " + file.filePath +
      " | " + (file.summary || file.kind) +
      (visuals.length ? " | 视觉附件: " + visuals.join("、") : "") +
      (file.visualLimited ? " | 仍有视觉内容需按需检查" : "")
    );
  }

  const textFiles = context.files.filter((file) => String(file.text || "").trim());
  if (textFiles.length) {
    lines.push("", "[文档可检索文本层]");
    for (const file of textFiles) {
      lines.push("", "【" + file.relativePath + "】", file.text);
    }
  }
  if (context.errors.length) {
    lines.push("", "[自动读取提示]");
    for (const item of context.errors) {
      lines.push("- " + item.relativePath + ": " + item.error);
    }
  }
  return trimTextUtf8(lines.join("\n"), 120000) + "\n\n";
}

function publicAutomaticDocumentContext(context) {
  return {
    enabled: true,
    discoveredCount: context.discoveredCount,
    indexedCount: context.indexedCount,
    skippedCount: context.skippedCount,
    visualAttachmentCount: context.visualAttachments.length,
    truncated: context.truncated,
    errors: context.errors.slice(0, 12),
    files: context.files.map((file) => ({
      relativePath: file.relativePath,
      kind: file.kind,
      summary: file.summary,
      visualAttachmentCount: file.visualAttachments.length,
      visualLimited: file.visualLimited
    }))
  };
}

async function handleModels(_req, res) {
  const config = getCodexConfigSummary();
  const providerResult = await requestProviderModels(config);
  rememberProviderModelCatalog(config, providerResult);
  const providerAvailable = !providerResult.error;
  const fallbackModels = mergeModelOptions(config.model, config.modelHints, []);
  const mergedModels = providerAvailable
    ? mergeModelOptions("", [], providerResult.models, {
        includeConfigured: false,
        includeRecommended: false
      })
    : fallbackModels;
  const capabilityCatalog = getBundledModelCapabilityCatalog();
  const models = attachModelReasoningCapabilities(mergedModels, capabilityCatalog);
  const autoModelValues = providerAvailable ? providerResult.models : fallbackModels;
  const autoModelMap = buildAutoModelMap(autoModelValues);
  const configuredModelKey = String(config.model || "").trim().toLowerCase();
  const providerModelKeys = new Set(providerResult.models.map((model) => String(model || "").trim().toLowerCase()));
  sendJson(res, 200, {
    provider: config.modelProvider,
    configuredModel: config.model,
    configuredReasoningEffort: config.modelReasoningEffort || "default",
    configuredModelAvailable: providerAvailable && configuredModelKey ? providerModelKeys.has(configuredModelKey) : true,
    baseUrl: config.baseUrl,
    models,
    autoModelMap,
    source: providerAvailable ? "provider" : "config",
    error: providerResult.error || null,
    modelsUrl: providerResult.url,
    reasoningCapabilities: {
      source: "codex-bundled",
      available: !capabilityCatalog.error,
      modelCount: capabilityCatalog.models.size,
      error: capabilityCatalog.error || null
    }
  });
}

function getNodeCommand() {
  if (process.execPath && path.basename(process.execPath).toLowerCase() === "node.exe") {
    return process.execPath;
  }

  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe")
  ];
  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }
  return "node";
}

function findCodesysExe() {
  const candidates = [
    process.env.CODESYS_EXE,
    "C:\\Program Files\\CODESYS 3.5.21.0\\CODESYS\\Common\\CODESYS.exe",
    "C:\\Program Files\\CODESYS 3.5.20.40\\CODESYS\\Common\\CODESYS.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }
  return "";
}

function getMcpDefinition(name) {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const nodeCommand = getNodeCommand();

  if (name === "codesys") {
    const root = firstExistingDirectory([
      process.env.CODEX_CLIENT_CODESYS_MCP_ROOT,
      process.env.CODESYS_MCP_ROOT,
      path.join(home, "codesys-codex-mcp"),
      path.join(localAppData, "codesys-codex-mcp")
    ]);
    const script = path.join(root, "server", "index.js");
    const env = {
      CODESYS_MCP_ROOT: root,
      CODESYS_MCP_ALLOW_ARBITRARY_SCRIPT: "0",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    };
    const codesysExe = findCodesysExe();
    if (codesysExe) {
      env.CODESYS_EXE = codesysExe;
    }
    if (process.env.CODESYS_PROFILE) {
      env.CODESYS_PROFILE = process.env.CODESYS_PROFILE;
    }
    return {
      name,
      label: "CODESYS",
      description: "项目读取、PLCopenXML 导入导出、工程编译；不包含 PLC 下载、启动、停止。",
      command: nodeCommand,
      args: [script],
      root,
      script,
      env,
      startupTimeoutSec: 30,
      toolTimeoutSec: 300,
      tools: [
        "codesys_validate_setup",
        "codesys_project_info",
        "codesys_build_project",
        "codesys_export_project",
        "codesys_import_project",
        "python_command_suggest",
        "python_command_history",
        "python_command_forget"
      ],
      available: pathExists(script)
    };
  }

  if (name === "autocad") {
    const root = firstExistingDirectory([
      process.env.CODEX_CLIENT_AUTOCAD_MCP_ROOT,
      process.env.AUTOCAD_MCP_ROOT,
      path.join(home, "autocad-codex-mcp")
    ]);
    const script = path.join(root, "src", "server.js");
    return {
      name,
      label: "AutoCAD",
      description: "通过 COM Automation 新建/打开图纸、绘制线框、图层、文字并保存 DWG/DXF。",
      command: nodeCommand,
      args: [script],
      root,
      script,
      env: {
        AUTOCAD_MCP_PROGID: process.env.AUTOCAD_MCP_PROGID || "AutoCAD.Application.26",
        AUTOCAD_MCP_ALLOW_COMMANDS: "0"
      },
      startupTimeoutSec: 30,
      toolTimeoutSec: 180,
      tools: [
        "autocad_status",
        "autocad_new_drawing",
        "autocad_open_drawing",
        "autocad_save_as",
        "autocad_set_layer",
        "autocad_draw_line",
        "autocad_draw_polyline",
        "autocad_draw_rectangle",
        "autocad_draw_circle",
        "autocad_add_text"
      ],
      available: pathExists(script)
    };
  }

  return null;
}

function tomlString(value) {
  return JSON.stringify(String(value || ""));
}

function getSelectedMcpNames(payload) {
  if (!Array.isArray(payload.mcpTools)) {
    return [];
  }
  return payload.mcpTools
    .map((name) => String(name || "").trim().toLowerCase())
    .filter((name, index, names) => MCP_NAME_SET.has(name) && names.indexOf(name) === index);
}

function appendMcpDefinitionArgs(args, name, definition, enabled) {
  args.push("-c", `mcp_servers.${name}.enabled=${enabled ? "true" : "false"}`);
  args.push("-c", `mcp_servers.${name}.transport="stdio"`);
  args.push("-c", `mcp_servers.${name}.command=${tomlString(definition.command)}`);
  args.push("-c", `mcp_servers.${name}.args=[${definition.args.map((item) => tomlString(item)).join(",")}]`);
  args.push("-c", `mcp_servers.${name}.startup_timeout_sec=${definition.startupTimeoutSec}`);
  args.push("-c", `mcp_servers.${name}.tool_timeout_sec=${definition.toolTimeoutSec}`);
  for (const [key, value] of Object.entries(definition.env)) {
    args.push("-c", `mcp_servers.${name}.env.${key}=${tomlString(value)}`);
  }
}

function buildMcpConfigArgs(selectedNames, explicitSelection) {
  const selected = new Set(selectedNames);
  const args = [];
  const enabled = [];

  if (!explicitSelection) {
    return { args, enabled };
  }

  for (const name of MCP_NAMES) {
    const definition = getMcpDefinition(name);
    if (!definition) {
      continue;
    }

    if (!selected.has(name)) {
      if (definition.available) {
        appendMcpDefinitionArgs(args, name, definition, false);
      }
      continue;
    }

    if (!definition.available) {
      throw Object.assign(new Error(`${definition.label} MCP 服务入口不存在: ${definition.script}`), { statusCode: 400 });
    }

    appendMcpDefinitionArgs(args, name, definition, true);
    enabled.push({
      name,
      label: definition.label,
      tools: definition.tools
    });
  }

  return { args, enabled };
}

function mcpPromptPrefix(enabledMcp) {
  if (!enabledMcp.length) {
    return "";
  }

  const lines = [
    "本次本地客户端已启用以下 MCP 工具集成："
  ];
  for (const item of enabledMcp) {
    if (item.name === "codesys") {
      lines.push("- CODESYS MCP：可用于 CODESYS 项目读取、工程信息、导出、导入、build/rebuild/clean/generate_code。不要执行 PLC 下载、在线启动、停止、复位或强制写入。");
    }
    if (item.name === "autocad") {
      lines.push("- AutoCAD MCP：可用于 AutoCAD 状态检查、新建/打开图纸、图层、线/多段线/矩形/圆/文字绘制和保存。优先使用结构化绘图工具，原始命令默认禁用。");
    }
  }
  lines.push("如任务涉及这些软件，优先调用对应 MCP 工具；如与任务无关，不要主动操作外部软件。");
  return `${lines.join("\n")}\n\n`;
}

function cleanAgentProfile(value) {
  const profile = String(value || "auto").trim();
  return AGENT_PROFILE_SET.has(profile) ? profile : "auto";
}

function inferAgentProfile(profile, basePrompt) {
  const requested = cleanAgentProfile(profile);
  if (requested !== "auto") {
    return requested;
  }

  const text = String(basePrompt || "");
  if (/(客户端|本地化|界面|按钮|布局|\.exe|exe|打包|维护记录|模型代理|server\.js|app\.js|styles\.css)/i.test(text)) {
    return "client_maintenance";
  }
  if (/(故障|不动作|没反应|卡住|超时|断流|通讯|通信|联动|软硬件|485|以太网|IP|ip|驱动|电机|执行器|传感器|限位|报警|PLC\s*不|plc\s*不)/i.test(text)) {
    return "plc_fault";
  }
  if (/(寄存器表|寄存器映射|地址表|保持寄存器|输入寄存器|线圈|Modbus|modbus|offset|偏移|端序|缩放|读写方向)/i.test(text)) {
    return "register_map";
  }
  if (/(Python|python|上位机|脚本|运行参数|ModbusCtrl|控制代码|串口|serial|py$)/i.test(text)) {
    return "python_plc";
  }
  if (/(CODESYS|codesys|PLCopenXML|project|工程|POU|编译|rebuild|XML转project|从project重导)/i.test(text)) {
    return "codesys";
  }
  if (/(验证|测试|验收|复现|最小步骤|回归|检查项|测试计划)/i.test(text)) {
    return "verification";
  }
  if (/(Git|git|GitLab|gitlab|jihulab|仓库|提交|推送|拉取|commit|push|pull|diff)/i.test(text)) {
    return "git_sync";
  }
  return "auto";
}

function agentPromptPrefix(profile, requestedProfile) {
  const definition = AGENT_PROFILE_DEFINITIONS[profile] || AGENT_PROFILE_DEFINITIONS.auto;
  const requested = AGENT_PROFILE_DEFINITIONS[requestedProfile] || AGENT_PROFILE_DEFINITIONS.auto;
  const lines = [
    `本次运行启用工程智能体: ${definition.label}${profile !== requestedProfile ? `（由 ${requested.label} 自动选择）` : ""}。`,
    `智能体目标: ${definition.description}`,
    "通用工作方式：先读当前客户端提供的工程上下文，再按需要读取磁盘真实文件；先定位证据，再修改；一次只改变必要变量，避免靠反复试错推进。",
    "电气工程师思维：先确认电源、通讯、控制链、联锁/限位、执行器和反馈状态，再沿用户指令 -> 上位机 -> 通讯 -> PLC逻辑 -> IO/驱动 -> 机械负载逐层定位；明确区分事实、假设、验证结果和现场风险。",
    "主动执行原则：只要能在用户目标范围内通过本地工具检查、修改和验证，就直接推进到结果，不停留在建议或等待用户重复催促；遇到失败先读取现场状态，再换一种方法继续。",
    "默认安全边界：不要下载、启动、停止、复位 PLC；不要执行会写现场寄存器或动作输出的命令，除非用户明确要求并且你先说明风险。"
  ];

  if (profile === "auto") {
    lines.push(
      "自动总控策略：先判断任务属于 CODESYS、Python-PLC、寄存器映射、Git、客户端维护或软硬件联动故障；再按对应策略收集证据和输出结论。",
      "如果任务跨 CODESYS/Python/寄存器/硬件，优先按软硬件联动故障策略执行。"
    );
  }
  if (profile === "plc_fault") {
    lines.push(
      "排查链路必须覆盖：用户指令 -> Python 控制函数 -> Modbus/485/以太网参数 -> PLC 寄存器 -> CODESYS 逻辑/任务周期 -> IO/驱动/执行器/传感器反馈。",
      "优先检查高频错误：IP/端口/站号、串口波特率/校验/停止位、寄存器地址 0/1 基偏移、功能码、数据类型、符号位、端序、缩放比例、读写方向、握手位、done/error/busy 状态和超时。",
      "输出必须区分：已确认事实、最可能原因、需要读取/测试的证据、低风险验证步骤、禁止或需确认的在线动作。"
    );
  }
  if (profile === "codesys") {
    lines.push(
      "重点检查 CODESYS project/XML 同名关系、export 目录、变量声明、POU 调用链、任务周期、编译结果、寄存器变量和 Python 使用的寄存器是否一致。",
      "修改 CODESYS/XML 后必须说明版本号变动、导出/导入路径和可执行的编译验证。"
    );
  }
  if (profile === "python_plc") {
    lines.push(
      "使用 `$plc-host-control-software` 软件工程技能，把 PLC 寄存器与握手区当成版本化接口契约；PLC 保留实时控制和安全互锁，Python 负责通信、设备抽象、流程编排和上位机 API/UI。",
      "重点检查当前 Python 文件的真实 API、导入路径、运行命令、Modbus/485 初始化、读写函数、异常处理、反馈读取和命令执行顺序。",
      "同时核对接口版本、地址/类型/端序/缩放、命令序号或请求确认握手、busy/done/error、心跳、超时、重连和断线后的安全状态；禁止自动重放可能产生动作的写命令。",
      "生成命令必须可执行，不能只给 `python 文件.py` 这种粗糙命令；需要先阅读代码再给出 import/call 形式，并补充模拟传输、契约测试和受控在线验证。"
    );
  }
  if (profile === "register_map") {
    lines.push(
      "寄存器核对必须形成表格字段：名称、地址、功能码/寄存器区、数据类型、读写方向、CODESYS变量、Python调用、缩放/单位、握手/完成/错误位、备注。",
      "发现映射缺失或同名不一致时，必须明确哪一侧缺失，以及推荐的修复位置。"
    );
  }
  if (profile === "verification") {
    lines.push(
      "验证输出按离线静态检查、仿真/干运行、只读在线检查、需要确认的在线写入动作分层。",
      "每个测试都要给出目的、命令或操作、预期结果、失败时下一步定位方向。"
    );
  }
  if (profile === "git_sync") {
    lines.push(
      "Python 仓库和 CODESYS 仓库必须分开处理：Python 控制代码同步到 Python 仓库，CODESYS project/XML 同步到 CODESYS 仓库。",
      "提交前先看 status/diff，提交说明要包含版本号、改动摘要和验证结果；不要覆盖或重置用户未要求处理的改动。"
    );
  }
  if (profile === "client_maintenance") {
    lines.push(
      "维护客户端时优先检查 index.html、public/app.js、public/styles.css、server.js 和维护记录；改后运行 node --check，必要时重启服务并重新打包 exe。",
      "必须把功能变更追加到客户端维护记录和 C:\\logs 镜像。"
    );
  }

  lines.push(
    "最终回答格式要短而可执行：结论、证据、已处理内容、验证结果、剩余风险/下一步。"
  );
  return `${lines.join("\n")}\n\n`;
}

function engineeringExperiencePromptPrefix(workspace) {
  const memory = readEngineeringMemory();
  const lines = [
    "工程经验记忆在后台固定开启。先复用已验证经验，再结合当前工程、设备型号、固件/软件版本和现场证据重新核对；历史经验不是免验证的事实。",
    "涉及电气、PLC、IO、驱动、传感器或软硬件联动时使用 `$electrical-engineering-workflow`；涉及 PLC 预留上位机接口、Python 控制、通信库或接口测试时同时使用 `$plc-host-control-software`。",
    "遇到数据表、通讯协议、标准条款、器件能力或陌生故障机理时，联网搜索已默认开启，应主动查制造商官方手册、数据表、发行说明和适用 IEC/ISO/GB 标准或权威工程资料；记录来源链接、文档版本和访问日期。",
    "工程推理必须把内容分成：当前项目已验证事实、外部资料、待验证假设。禁止把网上通用经验直接写成当前设备结论。",
    "完成任务后，如果产生可复用且已经验证的新经验，更新工程经验主库；先查重，优先修订已有条目，不重复堆积。未验证猜测只能写入“待验证假设”，验证失败的经验要标记失效，不能继续沿用。",
    "经验条目至少包含：日期、工作目录/项目、专业领域、设备与版本、现象、证据、根因、处理、验证方法与结果、资料来源、安全边界。不得写入账号、密钥、令牌或个人敏感信息。",
    "工程经验主库: " + ENGINEERING_MEMORY_FILE,
    "工程经验镜像: " + ENGINEERING_MEMORY_MIRROR_FILE,
    "当前工作目录: " + workspace,
    "",
    "[最近工程经验]"
  ];
  lines.push(
    memory.exists
      ? trimTextUtf8(memory.text, MAX_ENGINEERING_MEMORY_CONTEXT_BYTES, true)
      : "经验库尚未建立；本次出现第一条已验证、可复用经验时按上述字段创建。"
  );
  return lines.join("\n") + "\n\n";
}

function runtimePermissionPromptPrefix(sandbox, approval) {
  const fullAccess = sandbox === "danger-full-access";
  const lines = [
    `本次客户端权限：${fullAccess ? "完全执行（无 Codex 文件沙箱）" : sandbox}；批准策略：${approval}。`,
    fullAccess
      ? "客户端已授权你在当前 Windows 进程本身拥有的权限范围内读取、修改文件并运行命令；不要为常规工程操作请求人工批准，直接执行并验证。"
      : "当前仍受 Codex 沙箱限制；权限不足时直接记录错误并尝试权限范围内的替代方法，不要等待人工批准。",
    "权限不等于 Windows 管理员令牌、账号密码、第三方登录或硬件现场许可。确实需要这些外部条件时，明确报告缺少的条件并结束等待，不能静默卡住。",
    "高风险或不可逆操作仍必须先核对准确目标和当前状态；恢复任务不得盲目重复已经完成的写入、下载、提交、现场控制或其他不可逆步骤。"
  ];
  return `${lines.join("\n")}\n\n`;
}

function maintenancePromptPrefix() {
  const maintenance = readMaintenanceText();
  const lines = [
    "本次本地客户端已启用“客户端维护上下文”。",
    "如果用户要求升级、修复、优化或维护这个 Codex 本地客户端，请优先使用下面的本地路径和维护规则：",
    `- 客户端目录: ${__dirname}`,
    `- 后端入口: ${path.join(__dirname, "server.js")}`,
    `- 前端页面: ${path.join(PUBLIC_DIR, "index.html")}`,
    `- 前端脚本: ${path.join(PUBLIC_DIR, "app.js")}`,
    `- 前端样式: ${path.join(PUBLIC_DIR, "styles.css")}`,
    `- 维护记录: ${MAINTENANCE_LOG_FILE}`,
    `- 维护记录镜像: ${MAINTENANCE_LOG_MIRROR_FILE}`,
    `- 历史记录: ${HISTORY_FILE}`,
    `- 历史记录镜像: ${HISTORY_MIRROR_FILE}`,
    "- 改动前读取现有代码和维护记录，延续当前客户端结构与中文界面。",
    "- 改动后把维护内容追加到维护记录，并同步到 C:\\logs 的镜像文件。",
    "- 不要输出、保存或暴露 API Key、令牌、认证文件完整内容。",
    "- 保留历史记录、收藏记录、续问合并和 MCP 集成功能，除非用户明确要求改变。",
    `- 客户端运行连续 60 秒没有新事件时，必须由 watchdog 自检进程、等待阶段和权限状态；最多进行 ${CODEX_WATCHDOG_RECOVERY_LIMIT} 次有上限的状态感知恢复，每次都要检查已完成步骤、绕开卡住工具并换一种方法取得新证据，仍无进展才按分级超时收尾。`,
    "- 代码检查优先运行 node --check server.js 和 node --check public/app.js；后端变化后需要重启本地服务。",
    "",
    "[最近维护记录]",
    maintenance.exists
      ? trimTextUtf8(maintenance.text, 36000, true)
      : "未找到维护记录文件；如本次完成客户端维护，请新建维护记录并同步到 C:\\logs。"
  ];
  return `${lines.join("\n")}\n\n`;
}

function engineeringWorkspacePromptPrefix(workspaceContext) {
  if (!workspaceContext || typeof workspaceContext !== "object") {
    return "";
  }

  const contextText = trimTextUtf8(JSON.stringify(workspaceContext, null, 2), 56000);
  const lines = [
    "本次本地客户端已把当前“工程工作区”内容作为上下文提供给你。",
    "这些内容来自客户端当前界面，包含 CODESYS 工程/XML、Python 文件、PLC 联动输出、Python 运行输出、Git 状态、PDF/Word/Excel 文档、推理过程和结果框；它们可以帮助定位问题，但实际修改前仍要读取磁盘上的真实文件。",
    "工程职责约束：CODESYS 是 PLC 执行程序，Python 是上位机控制程序；Python 通过以太网/Modbus/485 控制 PLC 寄存器。修改寄存器地址、方向、数据类型或时序时，必须同时核对 CODESYS、Python 和寄存器表，避免只改一侧。",
    "当用户要求“代码联动检查”“联动检查”或类似任务时，必须同时检查 CODESYS 工程/XML、Python 代码、寄存器表、设备/IP 配置以及当前运行输出，并按 CODESYS 侧、Python 侧、寄存器映射、运行验证分别给出结论。",
    "当用户要求“代码联动修改”“联动修改”或类似任务时，必须根据用户要求实际修改相关 CODESYS/Python 文件；涉及双方的变更要保持寄存器映射和读写方向一致，然后执行可用的本地静态检查（Python 语法、XML/工程文本检查、Git diff 等）并说明未执行的在线 PLC 操作。",
    "凡是修改 CODESYS 工程、PLCopenXML、Python 工程代码或两者联动逻辑，必须同步维护工程版本号和改动说明：优先沿用工程内已有 version/changelog/寄存器表版本字段；如果找不到明确版本位置，需在结果中说明未找到并建议版本号位置，不能假装已更新。",
    "完成工程修改后的最终结果必须列出版本变动（旧版本 -> 新版本）、改动说明、受影响文件、验证命令与验证结果；Git 提交说明也应包含版本号和改动摘要。",
    "默认不下载、启动、停止、复位 PLC，也不执行会写入现场寄存器的命令；只有用户明确要求且工具支持时才执行，并先说明风险。",
    "",
    "[工程工作区实时上下文]",
    contextText
  ];
  return `${lines.join("\n")}\n\n`;
}

function getContinuationRecord(value) {
  const id = cleanHistoryId(value);
  if (!id) {
    return null;
  }

  const record = readHistoryRecords().find((item) => item.id === id);
  if (!record) {
    throw Object.assign(new Error("选择的历史记录不存在，无法继续追问"), { statusCode: 404 });
  }
  return record;
}

function buildContinuationPrompt(payload, basePrompt) {
  const parent = getContinuationRecord(payload.continueFromId || payload.parentHistoryId);
  if (!parent) {
    return { prompt: basePrompt, parent: null };
  }

  const promptLimit = Math.floor(MAX_CONTINUATION_CONTEXT_BYTES * 0.25);
  const resultLimit = Math.floor(MAX_CONTINUATION_CONTEXT_BYTES * 0.55);
  const reasoningLimit = Math.floor(MAX_CONTINUATION_CONTEXT_BYTES * 0.2);
  const parentPrompt = trimTextUtf8(parent.prompt || parent.promptPreview || "", promptLimit);
  const parentResult = trimTextUtf8(parent.resultText || parent.resultPreview || "", resultLimit);
  const parentReasoning = trimTextUtf8(parent.reasoningText || "", reasoningLimit);

  const lines = [
    "你正在基于下面这条本地历史推理记录继续回答。",
    "请把历史问题和历史结果作为上下文，只回答本次新增问题；如果历史内容与本次新增问题冲突，以本次新增问题为准。",
    "",
    "[历史记录]",
    `历史ID: ${parent.id}`,
    `时间: ${parent.createdAt || ""}`,
    `工作目录: ${parent.workspace || ""}`,
    "",
    "[历史问题]",
    parentPrompt || "(历史记录没有保存问题)",
    "",
    "[历史结果]",
    parentResult || "(历史记录没有保存最终结果)"
  ];

  if (parentReasoning) {
    lines.push("", "[历史运行过程摘要]", parentReasoning);
  }

  lines.push("", "[本次新增问题]", basePrompt);
  const prompt = lines.join("\n");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw Object.assign(new Error("历史上下文和本次问题合计过长，请缩短问题或换一条历史记录"), { statusCode: 413 });
  }

  return { prompt, parent };
}

function getCodexMcpRegistration(name) {
  const invocation = getCodexInvocation();
  const result = spawnSync(invocation.command, [...invocation.baseArgs, "mcp", "get", name], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
    env: getCodexChildEnv()
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    registered: result.status === 0,
    enabled: result.status === 0 ? /enabled:\s*true/i.test(output) : false,
    output: output.trim(),
    error: result.error ? result.error.message : null
  };
}

function getMcpStatus() {
  return {
    integrations: MCP_NAMES.map((name) => {
      const definition = getMcpDefinition(name);
      const registration = getCodexMcpRegistration(name);
      return {
        name,
        label: definition.label,
        description: definition.description,
        available: definition.available,
        registered: registration.registered,
        enabled: registration.enabled,
        root: definition.root,
        script: definition.script,
        command: definition.command,
        args: definition.args,
        tools: definition.tools,
        registrationError: registration.registered ? null : registration.output || registration.error
      };
    })
  };
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function ensureParentDirectory(filePath) {
  const dirPath = path.dirname(filePath);
  if (dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function findCodesysFilesInDirectory(rootDir, predicate, options = {}) {
  const root = path.resolve(rootDir);
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : CODESYS_PROJECT_SEARCH_LIMIT;
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : CODESYS_PROJECT_SEARCH_MAX_DEPTH;
  const files = [];
  const stack = [{ dir: root, depth: 0 }];
  const seen = new Set();

  while (stack.length && files.length < limit) {
    const { dir, depth } = stack.shift();
    const key = dir.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && predicate(fullPath, entry)) {
        files.push(fullPath);
        if (files.length >= limit) {
          break;
        }
      }
    }

    if (depth >= maxDepth || files.length >= limit) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || CODESYS_SCAN_EXCLUDED_NAMES.has(entry.name)) {
        continue;
      }
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  return files.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function findCodesysProjectsInDirectory(rootDir, options = {}) {
  return findCodesysFilesInDirectory(
    rootDir,
    (fullPath) => path.extname(fullPath).toLowerCase() === ".project",
    { ...options, limit: options.limit || CODESYS_PROJECT_SEARCH_LIMIT }
  );
}

function findCodesysXmlFilesInDirectory(rootDir, options = {}) {
  return findCodesysFilesInDirectory(
    rootDir,
    (fullPath) => CODESYS_XML_EXTENSIONS.has(path.extname(fullPath).toLowerCase()),
    { ...options, limit: options.limit || CODESYS_XML_SEARCH_LIMIT }
  );
}

function chooseCodesysProjectPath(projects, searchRoot = "") {
  if (!Array.isArray(projects) || !projects.length) {
    return "";
  }

  const defaultProject = path.resolve(CODESYS_DEFAULT_PROJECT);
  const defaultMatch = projects.find((projectPath) => path.resolve(projectPath).toLowerCase() === defaultProject.toLowerCase());
  if (defaultMatch && (!searchRoot || isPathInside(searchRoot, defaultMatch))) {
    return defaultMatch;
  }

  return projects
    .map((projectPath) => {
      let score = 0;
      const base = path.basename(projectPath, path.extname(projectPath)).toLowerCase();
      if (base.includes("fivedof") || base.includes("five")) {
        score += 12;
      }
      if (findAssociatedCodesysXmlPath(projectPath, searchRoot || path.dirname(projectPath))) {
        score += 8;
      }
      try {
        score += Math.min(6, fs.statSync(projectPath).mtimeMs / 100000000000);
      } catch {
        // Keep ranking deterministic if stat fails.
      }
      return { projectPath, score };
    })
    .sort((a, b) => b.score - a.score || a.projectPath.localeCompare(b.projectPath, "zh-Hans-CN"))[0].projectPath;
}

function resolveCodesysProjectInput(inputPath, options = {}) {
  const candidate = String(inputPath || "").trim();
  const fallback = options.useDefault === false ? "" : CODESYS_DEFAULT_PROJECT;
  const target = candidate || fallback;
  if (!target) {
    return { projectPath: "", searchRoot: "", projects: [], inputKind: "empty" };
  }

  const resolved = path.resolve(target);
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    if (options.allowMissing) {
      return { projectPath: "", searchRoot: resolved, projects: [], inputKind: "missing" };
    }
    throw httpError(`CODESYS 工程路径不存在: ${resolved}`);
  }

  if (stats.isDirectory()) {
    const projects = findCodesysProjectsInDirectory(resolved, options);
    return {
      projectPath: chooseCodesysProjectPath(projects, resolved),
      searchRoot: resolved,
      projects,
      inputKind: "directory"
    };
  }

  if (!stats.isFile()) {
    throw httpError(`CODESYS 工程路径既不是文件也不是目录: ${resolved}`);
  }
  if (path.extname(resolved).toLowerCase() !== ".project") {
    throw httpError("当前只支持 CODESYS .project 工程文件，或包含 .project 的目录");
  }

  return {
    projectPath: resolved,
    searchRoot: path.dirname(resolved),
    projects: [resolved],
    inputKind: "file"
  };
}

function resolveCodesysProjectPath(inputPath) {
  const resolvedInput = resolveCodesysProjectInput(inputPath, { useDefault: true });
  if (!resolvedInput.projectPath) {
    throw httpError("缺少 CODESYS 工程路径");
  }
  return resolvedInput.projectPath;
}

function codesysExportDirectory(projectPath) {
  const projectDir = path.dirname(projectPath);
  const parentDir = path.dirname(projectDir);
  const exportRoot = path.basename(projectDir).toLowerCase() === "projects"
    ? parentDir
    : projectDir;
  return path.join(exportRoot, "export");
}

function defaultCodesysExportPath(projectPath) {
  const exportDir = codesysExportDirectory(projectPath);
  return path.join(exportDir, `${path.basename(projectPath, path.extname(projectPath))}.plcopenxml`);
}

function defaultCodesysCopyPath(projectPath) {
  const ext = path.extname(projectPath);
  const base = path.basename(projectPath, ext);
  return path.join(codesysExportDirectory(projectPath), `${base}.client-copy${ext}`);
}

function resolveCodesysGeneratedPath(projectPath, inputPath, defaultPath) {
  const requestedPath = String(inputPath || "").trim() ? path.resolve(String(inputPath).trim()) : "";
  const exportDir = codesysExportDirectory(projectPath);
  const fallbackPath = path.resolve(defaultPath);
  const useRequested = requestedPath && isPathInside(exportDir, requestedPath);
  const finalPath = useRequested ? requestedPath : fallbackPath;
  return {
    finalPath,
    requestedPath,
    exportDir,
    adjusted: !!requestedPath && path.resolve(requestedPath).toLowerCase() !== path.resolve(finalPath).toLowerCase(),
    adjustmentReason: requestedPath && !useRequested ? "导出文件必须放在工程 export 子目录" : ""
  };
}

function resolveCodesysReadableXmlPath(projectPath, inputPath) {
  const defaultPath = defaultCodesysExportPath(projectPath);
  const requestedPath = String(inputPath || "").trim() ? path.resolve(String(inputPath).trim()) : "";
  if (requestedPath && pathExists(requestedPath)) {
    return requestedPath;
  }
  if (requestedPath && path.basename(requestedPath).toLowerCase() === path.basename(defaultPath).toLowerCase()) {
    return defaultPath;
  }
  if (pathExists(defaultPath)) {
    return defaultPath;
  }
  return resolveCodesysTextPath(inputPath, defaultPath, "XML 文件路径");
}

function uniqueExistingDirectories(paths) {
  const seen = new Set();
  const result = [];
  for (const item of paths) {
    if (!item) {
      continue;
    }
    const resolved = path.resolve(item);
    const key = resolved.toLowerCase();
    if (seen.has(key) || !pathExists(resolved)) {
      continue;
    }
    try {
      if (!fs.statSync(resolved).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function codesysXmlBaseName(filePath) {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

function codesysXmlMatchesProject(projectPath, xmlPath) {
  return codesysXmlBaseName(projectPath) === codesysXmlBaseName(xmlPath);
}

function codesysXmlScore(projectPath, xmlPath, searchRoot) {
  const projectBase = path.basename(projectPath, path.extname(projectPath)).toLowerCase();
  const xmlBase = path.basename(xmlPath, path.extname(xmlPath)).toLowerCase();
  const xmlDir = path.dirname(xmlPath);
  const projectDir = path.dirname(projectPath);
  let score = 0;

  if (xmlBase !== projectBase) {
    return -1;
  }
  score += 100;
  if (CODESYS_XML_EXTENSIONS.has(path.extname(xmlPath).toLowerCase())) {
    score += path.extname(xmlPath).toLowerCase() === ".plcopenxml" ? 20 : 8;
  }
  if (xmlDir.toLowerCase() === projectDir.toLowerCase()) {
    score += 18;
  }
  if (xmlDir.toLowerCase().includes(`${path.sep}exports`)) {
    score += 16;
  }
  if (searchRoot && isPathInside(searchRoot, xmlPath)) {
    score += 6;
  }
  try {
    score += Math.min(10, fs.statSync(xmlPath).mtimeMs / 100000000000);
  } catch {
    // Ignore stale or inaccessible files during ranking.
  }
  return score;
}

function findAssociatedCodesysXmlPath(projectPath, searchRoot = "") {
  if (!projectPath) {
    return "";
  }

  const defaultPath = defaultCodesysExportPath(projectPath);
  if (pathExists(defaultPath)) {
    return defaultPath;
  }

  const projectDir = path.dirname(projectPath);
  const roots = uniqueExistingDirectories([
    searchRoot,
    codesysExportDirectory(projectPath),
    projectDir,
    path.dirname(projectDir),
    path.join(path.dirname(projectDir), "export"),
    path.join(path.dirname(projectDir), "exports")
  ]);
  const xmlFiles = [];
  const seen = new Set();
  for (const root of roots) {
    for (const xmlPath of findCodesysXmlFilesInDirectory(root)) {
      if (!codesysXmlMatchesProject(projectPath, xmlPath)) {
        continue;
      }
      const key = xmlPath.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        xmlFiles.push(xmlPath);
      }
    }
  }
  if (!xmlFiles.length) {
    return "";
  }

  return xmlFiles
    .map((xmlPath) => ({ xmlPath, score: codesysXmlScore(projectPath, xmlPath, searchRoot || projectDir) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.xmlPath.localeCompare(b.xmlPath, "zh-Hans-CN"))[0].xmlPath;
}

function resolveCodesysTextPath(inputPath, fallbackPath, fieldName) {
  const candidate = String(inputPath || fallbackPath || "").trim();
  if (!candidate) {
    throw httpError(`缺少 ${fieldName}`);
  }
  return path.resolve(candidate);
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveCodesysGitRoot(inputPath, projectPath) {
  const root = path.resolve(String(inputPath || CODESYS_DEFAULT_GIT_ROOT).trim() || CODESYS_DEFAULT_GIT_ROOT);
  if (!pathExists(root)) {
    throw httpError(`Git 仓库目录不存在: ${root}`, 404);
  }
  if (!pathExists(path.join(root, ".git"))) {
    throw httpError(`不是 Git 仓库: ${root}`, 400);
  }
  return root;
}

function resolvePythonGitRoot(inputPath) {
  const root = path.resolve(String(inputPath || PYTHON_DEFAULT_GIT_ROOT).trim() || PYTHON_DEFAULT_GIT_ROOT);
  if (!pathExists(root)) {
    throw httpError(`Python Git 仓库目录不存在: ${root}`, 404);
  }
  if (!pathExists(path.join(root, ".git"))) {
    throw httpError(`不是 Python Git 仓库: ${root}`, 400);
  }
  return root;
}

function resolvePythonRootPath(inputPath) {
  const root = path.resolve(String(inputPath || PYTHON_DEFAULT_GIT_ROOT).trim() || PYTHON_DEFAULT_GIT_ROOT);
  let stats;
  try {
    stats = fs.statSync(root);
  } catch {
    throw httpError(`Python 路径不存在: ${root}`, 404);
  }
  if (!stats.isDirectory()) {
    throw httpError(`Python 路径不是目录: ${root}`, 400);
  }
  return root;
}

function resolveFileInRoot(rootPath, inputPath, fallbackPath, fieldName, options = {}) {
  const candidateText = String(inputPath || fallbackPath || "").trim();
  if (!candidateText) {
    throw httpError(`缺少 ${fieldName}`);
  }
  const resolved = path.isAbsolute(candidateText)
    ? path.resolve(candidateText)
    : path.resolve(rootPath, candidateText);
  if (!isPathInside(rootPath, resolved) || resolved === path.resolve(rootPath)) {
    throw httpError(`${fieldName} 必须位于 Python 路径内: ${resolved}`, 400);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (options.extension && extension !== options.extension) {
    throw httpError(`${fieldName} 必须是 ${options.extension} 文件: ${resolved}`, 400);
  }
  if (Array.isArray(options.extensions) && options.extensions.length && !options.extensions.includes(extension)) {
    throw httpError(`${fieldName} 文件类型不支持: ${resolved}`, 400);
  }
  if (options.mustExist && !pathExists(resolved)) {
    throw httpError(`${fieldName} 不存在: ${resolved}`, 404);
  }
  if (options.mustExist) {
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) {
      throw httpError(`${fieldName} 不是文件: ${resolved}`, 400);
    }
  }
  return resolved;
}

function resolvePythonScriptPath(rootPath, inputPath, options = {}) {
  return resolveFileInRoot(rootPath, inputPath, PYTHON_DEFAULT_SCRIPT, "Python 控制脚本", {
    extension: ".py",
    mustExist: options.mustExist !== false
  });
}

function resolvePythonCodePath(rootPath, inputPath, options = {}) {
  return resolveFileInRoot(rootPath, inputPath, PYTHON_DEFAULT_SCRIPT, "Python 文件", {
    extensions: Array.from(PYTHON_EDITABLE_EXTENSIONS),
    mustExist: options.mustExist === true
  });
}

function isSafeGeneratedPath(filePath) {
  const roots = [
    os.homedir(),
    LOGS_DIR,
    os.tmpdir()
  ].filter(Boolean).map((item) => path.resolve(item));
  return roots.some((root) => isPathInside(root, filePath));
}

function resolveRegisterMapPath(inputPath) {
  const resolved = path.resolve(String(inputPath || PLC_DEFAULT_REGISTER_MAP).trim() || PLC_DEFAULT_REGISTER_MAP);
  if (!isSafeGeneratedPath(resolved)) {
    throw httpError(`寄存器表路径不在允许的本地目录内: ${resolved}`, 400);
  }
  return resolved;
}

function readBoundedTextFile(filePath, maxBytes, label) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw httpError(`${label || "文件"}不是文件: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw httpError(`${label || "文件"}过大，已超过 ${Math.floor(maxBytes / 1024 / 1024)}MB: ${filePath}`, 413);
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeBoundedTextFile(filePath, text, maxBytes, label) {
  const normalizedText = String(text == null ? "" : text);
  const byteLength = Buffer.byteLength(normalizedText, "utf8");
  if (byteLength > maxBytes) {
    throw httpError(`${label || "文本"}过大，已超过 ${Math.floor(maxBytes / 1024 / 1024)}MB`, 413);
  }
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, normalizedText, "utf8");
  return byteLength;
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function splitCommandLineArgs(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  if (text.length > 4096) {
    throw httpError("运行参数过长", 413);
  }

  const args = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = "";
      } else if (char === "\\" && text[index + 1] === quote) {
        current += quote;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) {
    throw httpError("运行参数引号未闭合", 400);
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function runLocalProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const processKey = String(options.processKey || "").trim();
    if (processKey) {
      const active = ACTIVE_LOCAL_PROCESSES.get(processKey);
      if (active && active.child && !active.child.killed) {
        reject(httpError(`已有 ${processKey} 进程正在运行，请先停止或等待结束`, 409));
        return;
      }
    }
    const runId = crypto.randomUUID();
    const timeoutMs = clampInteger(options.timeoutMs, 1000, 300000, PYTHON_COMMAND_TIMEOUT_MS);
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        ...(options.env || {})
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    if (processKey) {
      ACTIVE_LOCAL_PROCESSES.set(processKey, {
        key: processKey,
        runId,
        child,
        command,
        args,
        cwd: options.cwd || process.cwd(),
        startedAt: new Date().toISOString()
      });
    }

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (processKey) {
        const active = ACTIVE_LOCAL_PROCESSES.get(processKey);
        if (active && active.child === child) {
          ACTIVE_LOCAL_PROCESSES.delete(processKey);
        }
      }
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      killProcessTree(child);
      finish(httpError(`${command} 命令超时`, 504));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = trimTextTail(`${stdout}${chunk}`, PYTHON_COMMAND_OUTPUT_CHARS);
    });
    child.stderr.on("data", (chunk) => {
      stderr = trimTextTail(`${stderr}${chunk}`, PYTHON_COMMAND_OUTPUT_CHARS);
    });
    child.on("error", (error) => {
      finish(httpError(`${command} 启动失败: ${error.message}`, 502));
    });
    child.on("close", (code, signal) => {
      finish(null, {
        ok: code === 0,
        code,
        signal: signal || "",
        runId,
        pid: child.pid,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function gitPathspec(rootPath, filePath, fieldName) {
  const resolved = path.resolve(filePath);
  if (!isPathInside(rootPath, resolved) || resolved === path.resolve(rootPath)) {
    throw httpError(`${fieldName || "文件"}必须位于 Git 仓库内: ${resolved}`, 400);
  }
  return path.relative(rootPath, resolved).split(path.sep).join("/");
}

function gitSnapshotPathItem(rootPath, item) {
  const resolved = path.resolve(item.path);
  const inRepo = isPathInside(rootPath, resolved) && resolved !== path.resolve(rootPath);
  return {
    label: item.label || "同步文件",
    path: resolved,
    relativePath: inRepo ? path.relative(rootPath, resolved).split(path.sep).join("/") : "",
    inRepo,
    exists: pathExists(resolved),
    warning: inRepo ? "" : `${item.label || "同步文件"}不在 Git 仓库内`
  };
}

function runGitCommand(args, cwd, timeoutMs = GIT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const safeArgs = ["-c", `safe.directory=${path.resolve(cwd).replace(/\\/g, "/")}`, ...args];
    const child = spawn("git", safeArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      killProcessTree(child);
      finish(httpError(`Git 命令超时: git ${args.join(" ")}`, 504));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = trimTextTail(`${stdout}${chunk}`, 20000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = trimTextTail(`${stderr}${chunk}`, 20000);
    });
    child.on("error", (error) => {
      finish(httpError(`Git 启动失败: ${error.message}`, 502));
    });
    child.on("close", (code, signal) => {
      finish(null, {
        ok: code === 0,
        code,
        signal: signal || "",
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function parseGitStatusShort(output) {
  const lines = String(output || "").split(/\r?\n/).filter(Boolean);
  const header = lines.find((line) => line.startsWith("## ")) || "";
  const changes = lines.filter((line) => !line.startsWith("## "));
  return {
    header,
    changes,
    clean: changes.length === 0
  };
}

async function getGitSnapshot(rootPath, filePaths = []) {
  const statusResult = await runGitCommand(["status", "--short", "--branch"], rootPath);
  if (!statusResult.ok) {
    throw httpError(`Git 状态读取失败: ${statusResult.stderr || statusResult.stdout}`, 502);
  }
  const branchResult = await runGitCommand(["branch", "--show-current"], rootPath);
  const upstreamResult = await runGitCommand(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], rootPath);
  const remoteResult = await runGitCommand(["remote", "get-url", "origin"], rootPath);
  const commitResult = await runGitCommand(["log", "-1", "--format=%h%n%s%n%ci"], rootPath);
  const status = parseGitStatusShort(statusResult.stdout);
  let ahead = null;
  let behind = null;
  if (upstreamResult.ok) {
    const countResult = await runGitCommand(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], rootPath);
    if (countResult.ok) {
      const counts = countResult.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
      ahead = Number.isFinite(counts[0]) ? counts[0] : null;
      behind = Number.isFinite(counts[1]) ? counts[1] : null;
    }
  }
  const pathItems = filePaths
    .filter((item) => item && item.path)
    .map((item) => gitSnapshotPathItem(rootPath, item));
  const commitLines = commitResult.stdout.split(/\r?\n/);
  return {
    gitRoot: rootPath,
    branch: branchResult.ok ? branchResult.stdout.trim() : "",
    upstream: upstreamResult.ok ? upstreamResult.stdout.trim() : "",
    remote: remoteResult.ok ? remoteResult.stdout.trim() : "",
    clean: status.clean,
    changes: status.changes,
    statusHeader: status.header,
    ahead,
    behind,
    lastCommit: commitLines[0] || "",
    lastCommitMessage: commitLines[1] || "",
    lastCommitAt: commitLines[2] || "",
    paths: pathItems,
    pathWarnings: pathItems.filter((item) => !item.inRepo).map((item) => `${item.warning}: ${item.path}`)
  };
}

async function getCodesysGitSnapshot(rootPath, projectPath, exportPath, saveAsPath) {
  return getGitSnapshot(rootPath, [
    { label: "CODESYS 工程", path: projectPath },
    { label: "PLCopenXML", path: exportPath },
    saveAsPath ? { label: "目标 project", path: saveAsPath } : null
  ]);
}

function readCodesysTextFile(filePath) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw httpError(`路径不是文件: ${filePath}`);
  }
  if (stats.size > MAX_CODESYS_TEXT_BYTES) {
    throw httpError(`文件过大，已超过 ${Math.floor(MAX_CODESYS_TEXT_BYTES / 1024 / 1024)}MB: ${filePath}`, 413);
  }
  return fs.readFileSync(filePath, "utf8");
}

function writeCodesysTextFile(filePath, text) {
  const normalizedText = String(text == null ? "" : text);
  const byteLength = Buffer.byteLength(normalizedText, "utf8");
  if (byteLength > MAX_CODESYS_TEXT_BYTES) {
    throw httpError(`文本过大，已超过 ${Math.floor(MAX_CODESYS_TEXT_BYTES / 1024 / 1024)}MB`, 413);
  }
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, normalizedText, "utf8");
  return byteLength;
}

function requireCodesysXmlText(text, actionLabel, options = {}) {
  const normalizedText = String(text == null ? "" : text);
  const trimmed = normalizedText.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw httpError(`${actionLabel}失败：PLCopenXML 文本为空。请先点击“从 project 重导”生成 XML，或粘贴完整 XML 后再操作。`, 422);
  }
  if (!options.importable) {
    return normalizedText;
  }

  let cursor = trimmed;
  while (true) {
    if (cursor.startsWith("<?")) {
      const end = cursor.indexOf("?>");
      if (end < 0) {
        throw httpError(`${actionLabel}失败：XML 声明不完整。`, 422);
      }
      cursor = cursor.slice(end + 2).trimStart();
      continue;
    }
    if (cursor.startsWith("<!--")) {
      const end = cursor.indexOf("-->");
      if (end < 0) {
        throw httpError(`${actionLabel}失败：XML 注释不完整。`, 422);
      }
      cursor = cursor.slice(end + 3).trimStart();
      continue;
    }
    break;
  }

  const rootMatch = /^<([A-Za-z_][\w:.-]*)\b/.exec(cursor);
  const rootName = rootMatch ? rootMatch[1].split(":").pop().toLowerCase() : "";
  if (rootName !== "project") {
    throw httpError(`${actionLabel}失败：当前内容不是 CODESYS PLCopenXML project，未找到 <project> 根元素。`, 422);
  }
  if (!/<\/(?:[A-Za-z_][\w.-]*:)?project>\s*$/i.test(trimmed)) {
    throw httpError(`${actionLabel}失败：PLCopenXML 不完整，未找到 </project> 结束标签。`, 422);
  }
  return normalizedText;
}

function codesysFileInfo(filePath) {
  if (!pathExists(filePath)) {
    return null;
  }
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    isFile: stats.isFile(),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    modifiedAt: stats.mtime.toISOString()
  };
}

function codesysTextSnapshot(projectPath, exportPath, text) {
  const projectInfo = codesysFileInfo(projectPath);
  const exportInfo = codesysFileInfo(exportPath);
  const projectMtime = projectInfo ? projectInfo.mtimeMs : 0;
  const exportMtime = exportInfo ? exportInfo.mtimeMs : 0;
  return {
    projectPath,
    exportPath,
    text,
    textBytes: Buffer.byteLength(text || "", "utf8"),
    projectFile: projectInfo,
    exportFile: exportInfo,
    stale: !!(projectMtime && exportMtime && exportMtime < projectMtime)
  };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripStructuredTextComments(text) {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, (match) => " ".repeat(match.length))
    .replace(/\(\*[\s\S]*?\*\)/g, (match) => " ".repeat(match.length))
    .replace(/\/\/[^\r\n]*/g, (match) => " ".repeat(match.length));
}

function lineNumberAt(text, index) {
  return String(text || "").slice(0, Math.max(0, index)).split(/\r\n|\r|\n/).length;
}

function extractCodesysNamedBlocks(text, tagName) {
  const blocks = [];
  const blockRe = new RegExp(`<${tagName}\\b([^>]*)>[\\s\\S]*?<\\/${tagName}>`, "gi");
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const attrs = match[1] || "";
    const nameMatch = attrs.match(/\bname="([^"]+)"/i);
    blocks.push({
      tagName,
      name: decodeXmlAttribute(nameMatch ? nameMatch[1] : ""),
      start: match.index,
      end: blockRe.lastIndex,
      text: match[0]
    });
  }
  return blocks;
}

function countRegexMatches(text, regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  let count = 0;
  while (re.exec(text)) {
    count += 1;
  }
  return count;
}

function makeCodesysCheck(id, label, ok, detail, severity = "error") {
  return {
    id,
    label,
    ok: !!ok,
    detail,
    severity: ok ? "ok" : severity
  };
}

function analyzeCodesysExportText(projectPath, exportPath, text) {
  const checks = [];
  const issues = [];
  const pouBlocks = extractCodesysNamedBlocks(text, "pou");
  const gvlBlocks = extractCodesysNamedBlocks(text, "globalVars").filter((block) => block.name === "GVL");
  const requiredCacheVars = ["xJogReset", "wAxisStatusReg", "dwPowerErrorIDReg", "wJogModeReg"];
  const pouNames = pouBlocks.map((block) => block.name).filter(Boolean);
  const gvlText = gvlBlocks.map((block) => block.text).join("\n");
  const missingCacheVars = requiredCacheVars.filter((name) => {
    const variableRe = new RegExp(`<variable\\b[^>]*\\bname="${escapeRegExp(name)}"(?:\\s|>|/)`, "i");
    return !variableRe.test(gvlText);
  });
  const copyNameMatches = [];
  const copyNameRe = /<(?:pou|globalVars)\b[^>]*\bname="([^"]*_1)"[^>]*>/gi;
  let copyNameMatch;
  while ((copyNameMatch = copyNameRe.exec(text)) !== null) {
    copyNameMatches.push({
      name: decodeXmlAttribute(copyNameMatch[1]),
      line: lineNumberAt(text, copyNameMatch.index)
    });
  }

  const directAccessObjects = [];
  let modbusAccessCount = 0;
  for (const block of pouBlocks) {
    const codeText = stripStructuredTextComments(block.text);
    const arRegCount = countRegexMatches(codeText, /\barReg_data\s*\[/gi);
    const arAiCount = countRegexMatches(codeText, /\barAi_data\s*\[/gi);
    const accessCount = arRegCount + arAiCount;
    if (!accessCount) {
      continue;
    }
    if (block.name === "ModbusTcpSlave") {
      modbusAccessCount += accessCount;
      continue;
    }
    const firstAccess = /\bar(?:Reg|Ai)_data\s*\[/gi.exec(codeText);
    directAccessObjects.push({
      name: block.name || "(未命名 POU)",
      line: lineNumberAt(text, block.start + (firstAccess ? firstAccess.index : 0)),
      arRegCount,
      arAiCount,
      accessCount
    });
  }

  const hasSeparateCacheGvl = /\bFiveDOF_ModbusCache_GVL\b/.test(text);
  const hasModbusProgram = pouNames.includes("ModbusTcpSlave");
  const hasDiagnostic84 = /\barReg_data\s*\[\s*84\s*\]\s*:=\s*26086\b/.test(text);
  const hasDiagnostic99 = /\barReg_data\s*\[\s*99\s*\]\s*:=\s*26086\b/.test(text);

  checks.push(makeCodesysCheck(
    "xml_loaded",
    "XML 可读取",
    typeof text === "string" && text.length > 0,
    `${Math.round(Buffer.byteLength(text || "", "utf8") / 1024)} KB`
  ));
  checks.push(makeCodesysCheck(
    "modbus_program_exists",
    "存在 ModbusTcpSlave",
    hasModbusProgram,
    hasModbusProgram ? "已找到集中读写程序" : "未找到 ModbusTcpSlave，无法确认寄存器集中逻辑"
  ));
  checks.push(makeCodesysCheck(
    "no_duplicate_copies",
    "没有 _1 副本对象",
    copyNameMatches.length === 0,
    copyNameMatches.length
      ? copyNameMatches.slice(0, 6).map((item) => `${item.name}@${item.line}`).join(", ")
      : "未发现 POU/GVL 副本"
  ));
  checks.push(makeCodesysCheck(
    "no_separate_cache_gvl",
    "缓存变量在原 GVL",
    !hasSeparateCacheGvl,
    hasSeparateCacheGvl ? "发现 FiveDOF_ModbusCache_GVL，v26086 记录要求不要单独新建" : "未发现独立缓存 GVL"
  ));
  checks.push(makeCodesysCheck(
    "required_cache_vars",
    "关键缓存变量完整",
    missingCacheVars.length === 0,
    missingCacheVars.length ? `缺少: ${missingCacheVars.join(", ")}` : requiredCacheVars.join(", ")
  ));
  checks.push(makeCodesysCheck(
    "direct_access_centralized",
    "寄存器读写集中",
    directAccessObjects.length === 0 && modbusAccessCount > 0,
    directAccessObjects.length
      ? directAccessObjects.slice(0, 6).map((item) => `${item.name}@${item.line}(${item.accessCount})`).join(", ")
      : `ModbusTcpSlave 中发现 ${modbusAccessCount} 处 arReg/arAi 访问`
  ));
  checks.push(makeCodesysCheck(
    "diagnostic_version",
    "v26086 诊断版本",
    hasDiagnostic84 && hasDiagnostic99,
    hasDiagnostic84 && hasDiagnostic99
      ? "arReg_data[84] 和 arReg_data[99] 都写入 26086"
      : "未同时发现 arReg_data[84] := 26086 与 arReg_data[99] := 26086",
    "warning"
  ));

  for (const check of checks) {
    if (!check.ok) {
      issues.push({
        id: check.id,
        severity: check.severity,
        message: check.detail
      });
    }
  }

  return {
    fast: true,
    passed: issues.filter((item) => item.severity === "error").length === 0,
    checkCount: checks.length,
    passedCheckCount: checks.filter((check) => check.ok).length,
    issueCount: issues.length,
    checks,
    issues,
    directAccessObjects,
    modbusAccessCount,
    pouCount: pouBlocks.length,
    gvlCount: gvlBlocks.length,
    projectPath,
    exportPath
  };
}

const FIVE_AXIS_REGISTER_DEFINITIONS = [
  { area: "arReg_data", start: 0, end: 0, direction: "Python/HMI -> PLC", group: "控制", purpose: "五轴绝对定位启动命令" },
  { area: "arReg_data", start: 1, end: 5, direction: "Python/HMI -> PLC", group: "控制", purpose: "X/Y/Z/B/C 五轴目标位置原始值" },
  { area: "arReg_data", start: 6, end: 15, direction: "Python/HMI -> PLC", group: "控制", purpose: "X/Y/Z/B/C 正反向点动方向命令" },
  { area: "arReg_data", start: 19, end: 19, direction: "Python/HMI -> PLC", group: "控制", purpose: "点动总开关位图：bit0=X、bit1=Y、bit2=Z、bit3=B、bit4=C" },
  { area: "arReg_data", start: 32, end: 32, direction: "Python/HMI -> PLC", group: "控制", purpose: "五轴总使能命令：0=关闭，非0=打开" },
  { area: "arReg_data", start: 89, end: 89, direction: "Python/HMI -> PLC", group: "控制", purpose: "五轴复位命令位图，写短脉冲后清 0" },
  { area: "arAi_data", start: 1, end: 5, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C 五轴当前位置反馈" },
  { area: "arReg_data", start: 33, end: 37, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C 五轴状态字" },
  { area: "arReg_data", start: 38, end: 47, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C AxisErrorID 低/高 16 位" },
  { area: "arReg_data", start: 48, end: 48, direction: "PLC -> Python/HMI", group: "反馈", purpose: "五轴使能请求反馈，bit0..bit4 和 bit15" },
  { area: "arReg_data", start: 49, end: 58, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C MC_ReadStatus.ErrorID 低/高 16 位" },
  { area: "arReg_data", start: 59, end: 68, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C MC_ReadAxisError.ErrorID 低/高 16 位" },
  { area: "arReg_data", start: 69, end: 78, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C MC_Power.ErrorID 低/高 16 位" },
  { area: "arReg_data", start: 79, end: 83, direction: "PLC -> Python/HMI", group: "反馈", purpose: "X/Y/Z/B/C MC_Power 诊断字，bit0=Status，bit1=Error" },
  { area: "arReg_data", start: 84, end: 84, direction: "PLC -> Python/HMI", group: "反馈", purpose: "轴状态诊断版本号，v26086 固定为 26086" },
  { area: "arReg_data", start: 85, end: 88, direction: "PLC -> Python/HMI", group: "反馈", purpose: "使能不一致、状态读取、轴错误读取、FB 错误位图" },
  { area: "arReg_data", start: 90, end: 99, direction: "PLC -> Python/HMI", group: "反馈", purpose: "复位、点动进入 FB 前和 FB_ServoJog 诊断反馈；[99] 为 v26086" }
];

function registerLabel(definition) {
  const range = definition.start === definition.end
    ? String(definition.start)
    : `${definition.start}..${definition.end}`;
  return `${definition.area}[${range}]`;
}

function registerKey(area, address) {
  return `${String(area || "").toLowerCase()}:${Number(address)}`;
}

function expandRegisterDefinition(definition) {
  const result = [];
  for (let address = definition.start; address <= definition.end; address += 1) {
    result.push({
      ...definition,
      address,
      key: registerKey(definition.area, address)
    });
  }
  return result;
}

function requiredRegisterItems() {
  return FIVE_AXIS_REGISTER_DEFINITIONS.flatMap((definition) => expandRegisterDefinition(definition));
}

function scanRegisterReferences(text) {
  const source = String(text || "");
  const re = /\b(arReg_data|arAi_data)\s*\[\s*(\d+)(?:\s*\.\.\s*(\d+))?\s*\]/gi;
  const refs = [];
  const counts = new Map();
  let match;
  while ((match = re.exec(source)) !== null) {
    const area = match[1];
    const start = Number.parseInt(match[2], 10);
    const rawEnd = match[3] ? Number.parseInt(match[3], 10) : start;
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) {
      continue;
    }
    const end = Math.max(start, rawEnd);
    for (let address = start; address <= end; address += 1) {
      const key = registerKey(area, address);
      counts.set(key, (counts.get(key) || 0) + 1);
      refs.push({
        area,
        address,
        key,
        line: lineNumberAt(source, match.index)
      });
    }
  }
  const addresses = {};
  for (const ref of refs) {
    const area = ref.area;
    if (!addresses[area]) {
      addresses[area] = [];
    }
    if (!addresses[area].includes(ref.address)) {
      addresses[area].push(ref.address);
    }
  }
  Object.keys(addresses).forEach((area) => addresses[area].sort((a, b) => a - b));
  return {
    count: refs.length,
    refs,
    counts: Object.fromEntries(counts.entries()),
    addresses
  };
}

function emptyRegisterScan() {
  return {
    count: 0,
    refs: [],
    counts: {},
    addresses: {}
  };
}

function mergeRegisterScans(...scans) {
  const refs = [];
  const counts = new Map();
  const addresses = {};
  for (const scan of scans) {
    if (!scan || !Array.isArray(scan.refs)) {
      continue;
    }
    for (const ref of scan.refs) {
      if (!ref || !ref.key) {
        continue;
      }
      refs.push(ref);
      counts.set(ref.key, (counts.get(ref.key) || 0) + 1);
      if (!addresses[ref.area]) {
        addresses[ref.area] = [];
      }
      if (!addresses[ref.area].includes(ref.address)) {
        addresses[ref.area].push(ref.address);
      }
    }
  }
  Object.keys(addresses).forEach((area) => addresses[area].sort((a, b) => a - b));
  return {
    count: refs.length,
    refs,
    counts: Object.fromEntries(counts.entries()),
    addresses
  };
}

function splitTopLevelComma(text) {
  const parts = [];
  let current = "";
  let quote = "";
  let depth = 0;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      current += char;
      if (char === "\\" && index + 1 < source.length) {
        index += 1;
        current += source[index];
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function pythonNamedArg(parts, name) {
  const prefix = `${name}=`;
  const item = parts.find((part) => part.replace(/\s+/g, "").startsWith(prefix));
  if (!item) {
    return "";
  }
  const index = item.indexOf("=");
  return index === -1 ? "" : item.slice(index + 1).trim();
}

function pythonNumberExpression(value, locals = {}) {
  const text = String(value || "").trim();
  if (/^-?\d+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  if (Object.prototype.hasOwnProperty.call(locals.numbers || {}, text)) {
    return locals.numbers[text];
  }
  return null;
}

function pythonValueCount(value, locals = {}) {
  const text = String(value || "").trim();
  if (!text) {
    return 1;
  }
  if (/^\[.*\]$/.test(text) || /^\(.*\)$/.test(text)) {
    const inner = text.slice(1, -1).trim();
    return inner ? splitTopLevelComma(inner).length : 0;
  }
  if (Object.prototype.hasOwnProperty.call(locals.listLengths || {}, text)) {
    return locals.listLengths[text];
  }
  return 1;
}

function pythonMethodBlocks(text) {
  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    const match = line.match(/^(\s{4})def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/);
    if (match) {
      if (current) {
        blocks.push(current);
      }
      current = {
        name: match[2],
        args: match[3],
        startLine: index + 1,
        lines: [line]
      };
      return;
    }
    if (current) {
      current.lines.push(line);
    }
  });
  if (current) {
    blocks.push(current);
  }
  return blocks;
}

function pythonBlockLocals(block) {
  const text = block.lines.join("\n");
  const numbers = {};
  const listLengths = {};
  const paramLengths = {};
  let match;
  const numberRe = /^\s*([A-Za-z_]\w*)\s*=\s*(-?\d+)\b/gm;
  while ((match = numberRe.exec(text)) !== null) {
    numbers[match[1]] = Number.parseInt(match[2], 10);
  }
  const lenRe = /len\(\s*([A-Za-z_]\w*)\s*\)\s*!=\s*(\d+)/g;
  while ((match = lenRe.exec(text)) !== null) {
    paramLengths[match[1]] = Number.parseInt(match[2], 10);
  }
  const listRe = /^\s*([A-Za-z_]\w*)\s*=\s*\[\s*\]/gm;
  while ((match = listRe.exec(text)) !== null) {
    const listName = match[1];
    for (const [paramName, length] of Object.entries(paramLengths)) {
      const appendRe = new RegExp(`for\\s+\\w+\\s+in\\s+${paramName}[\\s\\S]*?${listName}\\.append\\s*\\(`);
      if (appendRe.test(text)) {
        listLengths[listName] = length;
      }
    }
  }
  return { numbers, listLengths };
}

function scanPythonModbusCalls(text) {
  const refs = [];
  const calls = [];
  const blocks = pythonMethodBlocks(text);
  for (const block of blocks) {
    const locals = pythonBlockLocals(block);
    block.lines.forEach((line, offset) => {
      const lineNumber = block.startLine + offset;
      const callRe = /\b(?:self\.)?(_read_holding_registers|read_holding_registers|read_input_registers|write_holding_registers|write_single_coil|_read_discrete_input_bit)\s*\((.*)\)/g;
      let match;
      while ((match = callRe.exec(line)) !== null) {
        const fn = match[1];
        const parts = splitTopLevelComma(match[2]);
        const namedAddress = pythonNamedArg(parts, "address");
        const namedCount = pythonNamedArg(parts, "count");
        const namedValues = pythonNamedArg(parts, "values");
        const address = pythonNumberExpression(namedAddress || parts[0], locals);
        if (address == null) {
          continue;
        }
        let area = "arReg_data";
        let operation = "read_holding";
        let direction = "PLC -> Python";
        let count = 1;
        if (fn === "read_input_registers") {
          area = "arAi_data";
          operation = "read_input";
          count = pythonNumberExpression(namedCount || parts[1], locals) || 1;
        } else if (fn === "_read_holding_registers" || fn === "read_holding_registers") {
          operation = "read_holding";
          count = pythonNumberExpression(namedCount || parts[1], locals) || 1;
        } else if (fn === "write_holding_registers") {
          operation = "write_holding";
          direction = "Python -> PLC";
          count = pythonValueCount(namedValues || parts[1], locals) || 1;
        } else {
          area = "coil";
          operation = fn === "write_single_coil" ? "write_coil" : "read_discrete";
          direction = fn === "write_single_coil" ? "Python -> PLC" : "PLC -> Python";
        }
        const call = {
          method: block.name,
          function: fn,
          operation,
          area,
          address,
          count,
          direction,
          line: lineNumber
        };
        calls.push(call);
        if (area === "arReg_data" || area === "arAi_data") {
          for (let itemAddress = address; itemAddress < address + count; itemAddress += 1) {
            refs.push({
              area,
              address: itemAddress,
              key: registerKey(area, itemAddress),
              line: lineNumber,
              method: block.name,
              operation
            });
          }
        }
      }
    });
  }
  return {
    calls,
    registerScan: mergeRegisterScans({ refs })
  };
}

function extractPythonKeyMap(text, mapName) {
  const keys = [];
  const lines = String(text || "").split(/\r?\n/);
  let active = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes(`${mapName} = {`)) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^\s*}\s*$/.test(line)) {
      active = false;
      continue;
    }
    const match = line.match(/["']([^"']+)["']\s*:\s*(?:self\.)?([A-Za-z_]\w*)?/);
    if (match) {
      keys.push({
        key: match[1],
        method: match[2] || "",
        line: index + 1
      });
    }
  }
  return keys;
}

function scanPythonPlcSurface(text) {
  const source = String(text || "");
  const classNames = [];
  let match;
  const classRe = /^class\s+([A-Za-z_]\w*)\s*[\(:]/gm;
  while ((match = classRe.exec(source)) !== null) {
    classNames.push(match[1]);
  }
  const methods = pythonMethodBlocks(source)
    .map((block) => ({
      name: block.name,
      line: block.startLine,
      args: block.args
    }))
    .filter((method) => !method.name.startsWith("_"));
  const modbus = scanPythonModbusCalls(source);
  const getKeys = extractPythonKeyMap(source, "method_map");
  const setKeys = extractPythonKeyMap(source, "actions");
  const primaryClass = classNames.find((name) => /control|plc|dof|platform/i.test(name)) || classNames[0] || "";
  return {
    classNames,
    primaryClass,
    methods,
    getKeys,
    setKeys,
    modbusCalls: modbus.calls,
    registerScan: modbus.registerScan
  };
}

function extractPythonRegisterConstants(text) {
  const constants = [];
  const source = String(text || "");
  const lineRe = /^\s*([A-Z][A-Z0-9_]*REGISTER(?:S)?|[A-Z][A-Z0-9_]*READ_START|[A-Z][A-Z0-9_]*READ_COUNT)\s*=\s*([^\r\n#]+)/gm;
  let match;
  while ((match = lineRe.exec(source)) !== null) {
    const name = match[1];
    const expression = match[2];
    const numberRe = /\b\d+\b/g;
    let numberMatch;
    while ((numberMatch = numberRe.exec(expression)) !== null) {
      constants.push({
        name,
        value: Number.parseInt(numberMatch[0], 10),
        line: lineNumberAt(source, match.index)
      });
    }
  }
  return constants;
}

function pythonModuleCandidateFiles(rootPath, moduleName) {
  const relative = String(moduleName || "").replace(/\./g, path.sep);
  return [
    path.join(rootPath, `${relative}.py`),
    path.join(rootPath, relative, "__init__.py")
  ];
}

function detectMissingPythonLocalImports(rootPath, text) {
  const missing = [];
  const source = String(text || "");
  const importRe = /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*))/gm;
  let match;
  while ((match = importRe.exec(source)) !== null) {
    const moduleName = match[1] || match[2] || "";
    if (!moduleName.startsWith("daq_plc_interface")) {
      continue;
    }
    const candidates = pythonModuleCandidateFiles(rootPath, moduleName);
    if (!candidates.some((candidate) => pathExists(candidate))) {
      missing.push({
        module: moduleName,
        line: lineNumberAt(source, match.index),
        expected: candidates[0]
      });
    }
  }
  return missing;
}

function deviceConfigSummary(rootPath, deviceName) {
  const devicesPath = path.join(rootPath, "daq_plc_interface", "devices.json");
  const devices = pathExists(devicesPath) ? readJsonFileSafe(devicesPath) : null;
  const device = devices && typeof devices === "object" ? devices[deviceName] : null;
  return {
    path: devicesPath,
    exists: pathExists(devicesPath),
    deviceName,
    device: device || null,
    ok: !!device,
    address: device ? `${device.ip || "?"}:${device.modbus_port || device.port || "?"}` : ""
  };
}

function coverageForRequiredRegisters(scan) {
  const counts = scan && scan.counts ? scan.counts : {};
  const missing = [];
  for (const item of requiredRegisterItems()) {
    if (!counts[item.key]) {
      missing.push(item);
    }
  }
  return {
    total: requiredRegisterItems().length,
    missing,
    missingLabels: missing.slice(0, 30).map((item) => `${item.area}[${item.address}]`)
  };
}

function makePlcCheck(id, label, ok, detail, severity = "error") {
  return {
    id,
    label,
    ok: !!ok,
    detail,
    severity: ok ? "ok" : severity
  };
}

function quoteCommandArg(value) {
  const text = String(value == null ? "" : value);
  if (!text) {
    return "\"\"";
  }
  if (!/[\s"'`;|&<>(){}\[\]]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/(["\\])/g, "\\$1")}"`;
}

function commandLine(parts) {
  return parts.map((part) => quoteCommandArg(part)).join(" ");
}

function plcDeviceEndpoint(context) {
  const device = context.device && context.device.device ? context.device.device : {};
  const addressText = context.device && context.device.address ? String(context.device.address) : "";
  const [addressIp, addressPort] = addressText.split(":");
  const ip = String(device.ip || addressIp || "").trim();
  const port = Number.parseInt(device.modbus_port || device.port || addressPort || "502", 10);
  return {
    ip,
    port: Number.isFinite(port) ? port : 502
  };
}

function plcRunnerCommandParts(context, action, extra = []) {
  const endpoint = plcDeviceEndpoint(context);
  const className = context.pythonSurface && context.pythonSurface.primaryClass
    ? context.pythonSurface.primaryClass
    : "ControlFiveDOF";
  return [
    "python",
    PLC_LINK_RUNNER_SCRIPT,
    "--python-root",
    context.pythonRoot || PYTHON_DEFAULT_GIT_ROOT,
    "--script",
    context.pythonScript || PYTHON_DEFAULT_SCRIPT,
    "--class-name",
    className,
    "--ip",
    endpoint.ip || "PLC_IP",
    "--port",
    String(endpoint.port),
    "--action",
    action,
    ...extra
  ];
}

function pythonStringLiteral(value) {
  return `'${String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function pythonInlineCommand(code) {
  return commandLine(["python", "-c", code]);
}

function pythonModuleNameForScript(rootPath, scriptPath) {
  if (!rootPath || !scriptPath) {
    return "";
  }
  const relative = path.relative(path.resolve(rootPath), path.resolve(scriptPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || path.extname(relative).toLowerCase() !== ".py") {
    return "";
  }
  const withoutExt = relative.slice(0, -3);
  const parts = withoutExt.split(path.sep).filter(Boolean);
  if (!parts.length) {
    return "";
  }
  if (parts[parts.length - 1] === "__init__") {
    parts.pop();
  }
  const moduleName = parts.join(".");
  return /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/u.test(moduleName) ? moduleName : "";
}

function hasDaqCtrlEntry(rootPath) {
  return !!rootPath
    && pathExists(path.join(rootPath, "daq_plc_interface", "__init__.py"))
    && pathExists(path.join(rootPath, "daq_plc_interface", "ctrl.py"));
}

function looksLikeFiveDofContext(context, getKeys, setKeys, methodNames) {
  const scriptText = String(context && context.pythonScript ? context.pythonScript : "").toLowerCase();
  const classText = String(context && context.pythonSurface ? context.pythonSurface.primaryClass || "" : "");
  return /fivedof|five_dof|five-dof|五轴/i.test(scriptText)
    || /fivedof|five.*dof/i.test(classText)
    || getKeys.includes("FiveDOF_positions")
    || setKeys.some((key) => key.startsWith("FiveDOF_"))
    || methodNames.includes("read_all_actual_positions")
    || methodNames.includes("move_fivedof_platform");
}

function fiveDofUnavailableNotes(getKeys, setKeys, methodNames) {
  const notes = [];
  if (setKeys.includes("FiveDOF_move_push") && !methodNames.includes("move_pushmotor")) {
    notes.push("FiveDOF_move_push 未生成命令：当前代码 actions 调用了缺失的 move_pushmotor()");
  }
  if (setKeys.includes("FiveDOF_vibrator") && !methodNames.includes("control_vibrator")) {
    notes.push("FiveDOF_vibrator 未生成命令：当前代码 actions 调用了缺失的 control_vibrator()");
  }
  return notes;
}

function buildFiveDofModbusCtrlCommands(context, unavailableNotes) {
  if (!hasDaqCtrlEntry(context.pythonRoot)) {
    return [];
  }
  const deviceName = context.deviceName || PYTHON_DEFAULT_DEVICE;
  const deviceArg = pythonStringLiteral(deviceName);
  const prefix = `import json,atexit; from daq_plc_interface import ModbusCtrl; ctrl=ModbusCtrl(fivedof_device=${deviceArg}); atexit.register(ctrl.close); `;
  const unavailableText = unavailableNotes.length ? `\n未生成动作:\n${unavailableNotes.map((item) => `- ${item}`).join("\n")}` : "";
  return [
    {
      label: "当前工程入口: 只读五轴当前位置",
      safe: true,
      safetyText: "只调用 ModbusCtrl.get('fivedof_positions')，读取反馈寄存器，不写 PLC。",
      command: pythonInlineCommand(`${prefix}print(json.dumps({'fivedof_positions': ctrl.get('fivedof_positions')}, ensure_ascii=False))`),
      cwd: context.pythonRoot,
      source: "current-python-code",
      confidence: "high",
      detail: `已读取 daq_plc_interface.ctrl.ModbusCtrl 和当前五轴代码生成；在 cwd 目录执行即可。${unavailableText}`
    },
    {
      label: "当前工程入口: 读取PLC日志",
      safe: false,
      safetyText: "会调用 get_log()，当前代码读取后会写线圈 16 做已读确认，执行前确认现场允许。",
      command: pythonInlineCommand(`${prefix}print(json.dumps({'fivedof_plc_log': ctrl.get('fivedof_plc_log')}, ensure_ascii=False))`),
      cwd: context.pythonRoot,
      source: "current-python-code",
      confidence: "high",
      detail: "对应 ctrl.get('fivedof_plc_log') -> ControlFiveDOF.get('plc_log')。"
    },
    {
      label: "当前工程入口: 五轴回零",
      safe: false,
      safetyText: "会写 PLC 控制寄存器并触发五轴动作，执行前必须确认设备安全。",
      command: pythonInlineCommand(`${prefix}print(json.dumps({'fivedof_return_home': ctrl.set('fivedof_return_home', None, wait_complete=True)}, ensure_ascii=False))`),
      cwd: context.pythonRoot,
      source: "current-python-code",
      confidence: "high",
      detail: "对应 ctrl.set('fivedof_return_home', None, wait_complete=True)。"
    },
    {
      label: "当前工程入口: 五轴移动示例",
      safe: false,
      safetyText: "会写 PLC 控制寄存器并触发五轴动作；目标点已按当前 config 软限位取值，执行前仍需确认现场安全。",
      command: pythonInlineCommand(`${prefix}target=[10,10,10,0,0]; print(json.dumps({'target': target, 'fivedof_move': ctrl.set('fivedof_move', target, wait_complete=True)}, ensure_ascii=False))`),
      cwd: context.pythonRoot,
      source: "current-python-code",
      confidence: "high",
      detail: "对应 ctrl.set('fivedof_move', [10,10,10,0,0], wait_complete=True)；如需其它目标点，改 target 数组。"
    }
  ];
}

function buildFiveDofClassCommands(context) {
  const surface = context.pythonSurface || {};
  const className = surface.primaryClass || "ControlFiveDOF";
  const moduleName = pythonModuleNameForScript(context.pythonRoot, context.pythonScript);
  if (!moduleName || !/^[A-Za-z_]\w*$/u.test(className)) {
    return [];
  }
  const endpoint = plcDeviceEndpoint(context);
  const ip = endpoint.ip || "PLC_IP";
  const port = Number.isFinite(endpoint.port) ? endpoint.port : 502;
  const prefix = `import json,atexit; from ${moduleName} import ${className}; ctrl=${className}(${pythonStringLiteral(ip)}, port=${port}, timeout=3, retries=2); atexit.register(ctrl.close); `;
  return [
    {
      label: "当前文件类: 只读五轴当前位置",
      safe: true,
      safetyText: "直接导入当前 Python 文件的控制类，只读输入寄存器 1..5。",
      command: pythonInlineCommand(`${prefix}print(json.dumps({'FiveDOF_positions': ctrl.get('FiveDOF_positions')}, ensure_ascii=False))`),
      cwd: context.pythonRoot,
      source: "current-python-code",
      confidence: "high",
      detail: `对应 ${moduleName}.${className}.get('FiveDOF_positions')。`
    }
  ];
}

function buildPythonRunnerCommandSuggestions(context) {
  if (!context || !context.pythonText || !pathExists(PLC_LINK_RUNNER_SCRIPT)) {
    return [];
  }
  const surface = context.pythonSurface || {};
  const getKeys = Array.isArray(surface.getKeys) ? surface.getKeys.map((item) => item.key) : [];
  const setKeys = Array.isArray(surface.setKeys) ? surface.setKeys.map((item) => item.key) : [];
  const methods = Array.isArray(surface.methods) ? surface.methods.map((item) => item.name) : [];
  const unavailableNotes = fiveDofUnavailableNotes(getKeys, setKeys, methods);
  const commands = [];

  if (looksLikeFiveDofContext(context, getKeys, setKeys, methods)) {
    commands.push(...buildFiveDofModbusCtrlCommands(context, unavailableNotes));
    commands.push(...buildFiveDofClassCommands(context));
  }

  commands.push({
    label: "当前文件导入自检",
    safe: true,
    safetyText: "只导入当前 Python 代码，不连接 PLC。",
    command: commandLine(plcRunnerCommandParts(context, "import_check")),
    cwd: context.pythonRoot,
    source: "current-python-runner",
    confidence: surface.primaryClass ? "high" : "medium",
    detail: `控制类: ${surface.primaryClass || "未识别"}\n文件: ${context.pythonScript}`
  });

  return commands;
}

function generatePlcRegisterMapText(context) {
  const generatedAt = new Date().toISOString();
  const device = context.device || {};
  const lines = [
    "# FiveDofPlatform PLC/Python 联动寄存器表",
    "",
    `生成时间: ${generatedAt}`,
    `CODESYS工程: ${context.projectPath || ""}`,
    `PLCopenXML: ${context.exportPath || ""}`,
    `Python仓库: ${context.pythonRoot || ""}`,
    `Python脚本: ${context.pythonScript || ""}`,
    `Python本机IP: ${context.localIp || ""}`,
    `设备: ${context.deviceName || PYTHON_DEFAULT_DEVICE}${device.address ? ` (${device.address})` : ""}`,
    "",
    "## 使用原则",
    "",
    "- CODESYS 作为 PLC 执行程序，Python 作为上位机控制程序。",
    "- Python 通过 Modbus/485 工作流控制 PLC 寄存器；写寄存器动作应在确认现场安全后执行。",
    "- 客户端默认联动检查和生成寄存器表不写 PLC；只读反馈只读取反馈寄存器。",
    "",
    "## 寄存器表",
    "",
    "| 地址 | 方向 | 分组 | 功能 |",
    "|---:|---|---|---|"
  ];

  for (const definition of FIVE_AXIS_REGISTER_DEFINITIONS) {
    lines.push(`| \`${registerLabel(definition)}\` | ${definition.direction} | ${definition.group} | ${definition.purpose} |`);
  }

  const pythonRefs = context.pythonScan && context.pythonScan.addresses ? context.pythonScan.addresses : {};
  const codesysRefs = context.codesysScan && context.codesysScan.addresses ? context.codesysScan.addresses : {};
  const surface = context.pythonSurface || {};
  const getKeys = Array.isArray(surface.getKeys) ? surface.getKeys : [];
  const setKeys = Array.isArray(surface.setKeys) ? surface.setKeys : [];
  const modbusCalls = Array.isArray(surface.modbusCalls) ? surface.modbusCalls : [];
  lines.push(
    "",
    "## 当前代码扫描",
    "",
    `- Python寄存器引用: ${JSON.stringify(pythonRefs)}`,
    `- CODESYS XML寄存器引用: ${JSON.stringify(codesysRefs)}`,
    `- Python控制类: ${surface.primaryClass || "未识别"}`,
    `- Python只读接口: ${getKeys.map((item) => item.key).join(", ") || "未识别"}`,
    `- Python写入接口: ${setKeys.map((item) => item.key).join(", ") || "未识别"}`,
    "",
    "## 当前 Python Modbus 调用",
    "",
    "| 行 | 方法 | 操作 | 地址 | 方向 |",
    "|---:|---|---|---|---|"
  );

  if (modbusCalls.length) {
    for (const call of modbusCalls) {
      const end = call.count > 1 ? `..${call.address + call.count - 1}` : "";
      lines.push(`| ${call.line} | \`${call.method}\` | ${call.operation} | \`${call.area}[${call.address}${end}]\` | ${call.direction} |`);
    }
  } else {
    lines.push("| - | - | 未识别当前 Python 代码中的 Modbus 调用 | - | - |");
  }

  const quickCommands = buildPythonRunnerCommandSuggestions(context)
    .filter((item) => item.safe && item.command)
    .slice(0, 2)
    .map((item) => item.command);

  lines.push(
    "",
    "## 快捷验证命令",
    "",
    "```powershell",
    ...(quickCommands.length ? quickCommands : [
      commandLine(plcRunnerCommandParts(context, "import_check")),
      commandLine(plcRunnerCommandParts(context, "read_positions"))
    ]),
    "```"
  );

  return `${lines.join("\n")}\n`;
}

function buildPlcCommandSuggestions(contextOrPythonRoot, pythonScript, deviceName) {
  const context = contextOrPythonRoot && typeof contextOrPythonRoot === "object"
    ? contextOrPythonRoot
    : {
      pythonRoot: contextOrPythonRoot,
      pythonScript,
      deviceName,
      pythonText: "",
      pythonSurface: null,
      device: null
    };
  const runnerCommands = buildPythonRunnerCommandSuggestions(context);
  if (runnerCommands.length) {
    return runnerCommands;
  }
  const quotedScript = quoteCommandArg(context.pythonScript || PYTHON_DEFAULT_SCRIPT);
  const deviceArg = `--device ${context.deviceName || PYTHON_DEFAULT_DEVICE}`;
  return [
    {
      label: "兼容模板: 只读反馈",
      safe: true,
      safetyText: "未识别到当前 Python 控制入口时的旧模板，执行前确认脚本支持这些参数。",
      command: `python ${quotedScript} ${deviceArg} --read-axis-feedback --verbose-diagnostics`,
      source: "fallback-template"
    },
    {
      label: "兼容模板: 打印缩写表",
      safe: true,
      safetyText: "未识别到当前 Python 控制入口时的旧模板，执行前确认脚本支持这些参数。",
      command: `python ${quotedScript} --glossary`,
      source: "fallback-template"
    },
    {
      label: "兼容模板: 五轴使能请求",
      safe: false,
      safetyText: "会写 PLC 控制寄存器，且是旧模板参数，执行前必须确认脚本支持。",
      command: `python ${quotedScript} ${deviceArg} --enable-all`,
      source: "fallback-template"
    },
    {
      label: "兼容模板: 关闭五轴使能",
      safe: false,
      safetyText: "会写 PLC 控制寄存器，且是旧模板参数，执行前必须确认脚本支持。",
      command: `python ${quotedScript} ${deviceArg} --disable-all`,
      source: "fallback-template"
    },
    {
      label: "兼容模板: 五轴复位脉冲",
      safe: false,
      safetyText: "会写 PLC 控制寄存器，且是旧模板参数，执行前必须确认脚本支持。",
      command: `python ${quotedScript} ${deviceArg} --reset-all --reset-pulse 0.2`,
      source: "fallback-template"
    },
    {
      label: "兼容模板: 单轴点动示例",
      safe: false,
      safetyText: "会写 PLC 控制寄存器，且是旧模板参数，执行前必须确认脚本支持。",
      command: `python ${quotedScript} ${deviceArg} --jog --axis 1 --direction fwd --watch-interval 0.5`,
      source: "fallback-template"
    }
  ].map((item) => ({
    ...item,
    cwd: context.pythonRoot
  }));
}

function pythonCommandMemoryToSuggestions(memoryResult, context) {
  const record = memoryResult && memoryResult.commandRecord ? memoryResult.commandRecord : null;
  if (!record || !record.command) {
    return [];
  }

  const file = memoryResult.file || {};
  const notes = Array.isArray(record.notes) ? record.notes.filter(Boolean) : [];
  const confidence = record.confidence || "";
  const cache = memoryResult.cache || "";
  const versionText = file.versionId || record.versionId || file.sha256Short || record.sha256Short || "";
  const label = cache === "hit" ? "当前Python版本记忆命令" : "当前Python代码生成命令";
  const safetyText = confidence === "high"
    ? "按当前代码生成，执行前核对参数"
    : "静态分析生成，执行前确认";
  const detailLines = [
    cache ? `来源: python_command_suggest (${cache})` : "来源: python_command_suggest",
    versionText ? `版本: ${versionText}` : "",
    confidence ? `置信度: ${confidence}` : "",
    file.path ? `文件: ${file.path}` : "",
    ...notes.map((note) => `备注: ${note}`)
  ].filter(Boolean);

  return [{
    label,
    safe: false,
    safetyText,
    command: record.command,
    cwd: record.cwd || context.pythonRoot,
    source: "python_command_suggest",
    cache,
    versionId: versionText,
    confidence,
    notes,
    detail: detailLines.join("\n")
  }];
}

async function buildCurrentPythonCommandSuggestions(context, payload = {}) {
  const force = payload.forcePythonCommand !== false;
  const args = {
    scriptPath: context.pythonScript,
    cwd: context.pythonRoot,
    pythonExe: payload.pythonExe || "python",
    force,
    timeoutSec: clampInteger(payload.timeoutSec, 1, 120, 30)
  };
  const response = publicCodesysResponse(
    await callCodesysMcpTool("python_command_suggest", args, { timeoutSec: args.timeoutSec }),
    { pythonScript: context.pythonScript, pythonRoot: context.pythonRoot }
  );
  const suggestions = pythonCommandMemoryToSuggestions(response.mcpResult, context);
  if (!response.ok || !suggestions.length) {
    const error = response.mcpResult && response.mcpResult.error
      ? response.mcpResult.error
      : response.rawText || response.stderr || "python_command_suggest 未返回可用命令";
    throw httpError(error, 502);
  }
  return {
    response,
    commands: suggestions
  };
}

async function resolveCurrentPythonCommandPayload(context, payload = {}) {
  const runnerCommands = buildPythonRunnerCommandSuggestions(context);
  const localCommands = runnerCommands.length ? runnerCommands : buildPlcCommandSuggestions(context);
  try {
    const result = await buildCurrentPythonCommandSuggestions(context, payload);
    const commands = [];
    const seen = new Set();
    for (const item of [...localCommands, ...result.commands]) {
      const key = item && item.command ? item.command : "";
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      commands.push(item);
    }
    return {
      commandSource: runnerCommands.length ? "current-python-code + python_command_suggest" : "python_command_suggest",
      commandMemory: result.response.mcpResult,
      commandMemoryError: "",
      commands
    };
  } catch (error) {
    return {
      commandSource: runnerCommands.length ? "current-python-code" : "fallback-template",
      commandMemory: null,
      commandMemoryError: error.message,
      commands: localCommands
    };
  }
}

function buildPlcLinkContext(payload = {}) {
  const pythonRoot = resolvePythonRootPath(payload.pythonRoot || payload.gitRoot);
  const pythonScript = resolvePythonScriptPath(pythonRoot, payload.pythonScript || payload.scriptPath, { mustExist: false });
  const registerMapPath = resolveRegisterMapPath(payload.registerMap || payload.registerMapPath);
  const deviceName = String(payload.deviceName || PYTHON_DEFAULT_DEVICE).trim() || PYTHON_DEFAULT_DEVICE;
  const localIp = String(payload.localIp || "").trim() || preferredLocalIpv4();
  const localIps = localIpv4Addresses();
  const projectPath = path.resolve(String(payload.projectPath || CODESYS_DEFAULT_PROJECT).trim() || CODESYS_DEFAULT_PROJECT);
  const exportPath = resolveCodesysReadableXmlPath(projectPath, payload.exportPath);
  const pythonText = pathExists(pythonScript) ? readBoundedTextFile(pythonScript, MAX_PYTHON_TEXT_BYTES, "Python 控制脚本") : "";
  const registerMapText = pathExists(registerMapPath) ? readBoundedTextFile(registerMapPath, MAX_PYTHON_TEXT_BYTES, "寄存器表") : "";
  let codesysText = typeof payload.codesysText === "string" ? payload.codesysText : "";
  if (!codesysText && typeof payload.text === "string") {
    codesysText = payload.text;
  }
  if (!codesysText && pathExists(exportPath)) {
    codesysText = readCodesysTextFile(exportPath);
  }

  const pythonSurface = pythonText ? scanPythonPlcSurface(pythonText) : {
    classNames: [],
    primaryClass: "",
    methods: [],
    getKeys: [],
    setKeys: [],
    modbusCalls: [],
    registerScan: emptyRegisterScan()
  };
  const pythonScan = mergeRegisterScans(scanRegisterReferences(pythonText), pythonSurface.registerScan);
  const codesysScan = scanRegisterReferences(codesysText);
  const registerMapScan = scanRegisterReferences(registerMapText);
  const device = deviceConfigSummary(pythonRoot, deviceName);
  const missingImports = pythonText ? detectMissingPythonLocalImports(pythonRoot, pythonText) : [];
  const pythonConstants = pythonText ? extractPythonRegisterConstants(pythonText) : [];
  const codesysAnalysis = codesysText ? analyzeCodesysExportText(projectPath, exportPath, codesysText) : null;
  const generatedRegisterMap = generatePlcRegisterMapText({
    projectPath,
    exportPath,
    pythonRoot,
    pythonScript,
    deviceName,
    localIp,
    device,
    pythonScan,
    codesysScan,
    pythonSurface
  });
  const generatedScan = scanRegisterReferences(generatedRegisterMap);

  return {
    pythonRoot,
    pythonScript,
    registerMapPath,
    deviceName,
    localIp,
    localIps,
    projectPath,
    exportPath,
    pythonText,
    registerMapText,
    codesysText,
    pythonScan,
    codesysScan,
    registerMapScan,
    generatedRegisterMap,
    generatedScan,
    device,
    missingImports,
    pythonConstants,
    pythonSurface,
    codesysAnalysis
  };
}

function publicPlcLinkAnalysis(context, commandPayload = null) {
  const resolvedCommandPayload = commandPayload || {
    commandSource: "fallback-template",
    commandMemory: null,
    commandMemoryError: "",
    commands: buildPlcCommandSuggestions(context)
  };
  const generatedCoverage = coverageForRequiredRegisters(context.generatedScan);
  const registerMapCoverage = coverageForRequiredRegisters(context.registerMapScan);
  const pythonCoverage = coverageForRequiredRegisters(context.pythonScan);
  const codesysCoverage = coverageForRequiredRegisters(context.codesysScan);
  const checks = [
    makePlcCheck(
      "python_root",
      "Python路径可用",
      pathExists(context.pythonRoot),
      context.pythonRoot
    ),
    makePlcCheck(
      "python_local_ip",
      "Python本机以太网IP",
      !!context.localIp,
      context.localIp
        ? `${context.localIp}（Python 上位机电脑 IP，不是 PLC 目标 IP）`
        : "未识别到本机以太网 IPv4，请手动填写",
      "warning"
    ),
    makePlcCheck(
      "python_script",
      "Python控制脚本可读",
      pathExists(context.pythonScript) && !!context.pythonText,
      pathExists(context.pythonScript) ? context.pythonScript : `脚本不存在: ${context.pythonScript}`
    ),
    makePlcCheck(
      "python_imports",
      "Python本地导入链完整",
      context.missingImports.length === 0,
      context.missingImports.length
        ? context.missingImports.map((item) => `${item.module}@${item.line} 缺少 ${item.expected}`).join("; ")
        : "本地 daq_plc_interface 导入可解析"
    ),
    makePlcCheck(
      "device_config",
      "设备配置存在",
      context.device.ok,
      context.device.ok ? `${context.deviceName}: ${context.device.address}` : `未在 ${context.device.path} 找到 ${context.deviceName}`
    ),
    makePlcCheck(
      "codesys_xml",
      "CODESYS XML可扫描",
      !!context.codesysText,
      context.codesysText ? `${Math.round(Buffer.byteLength(context.codesysText, "utf8") / 1024)} KB` : `未找到 XML: ${context.exportPath}`,
      "warning"
    ),
    makePlcCheck(
      "codesys_registers",
      "CODESYS寄存器覆盖",
      !context.codesysText || codesysCoverage.missing.length === 0,
      !context.codesysText
        ? "没有 XML 时跳过覆盖判断"
        : codesysCoverage.missing.length
          ? `缺少: ${codesysCoverage.missingLabels.join(", ")}`
          : "v26086 控制/反馈地址均可在 XML 中找到",
      "warning"
    ),
    makePlcCheck(
      "codesys_static",
      "CODESYS集中读写规则",
      !context.codesysAnalysis || context.codesysAnalysis.passed,
      !context.codesysAnalysis
        ? "没有 XML 时跳过 CODESYS 静态规则"
        : context.codesysAnalysis.issues.length
          ? context.codesysAnalysis.issues.map((item) => item.message).slice(0, 4).join("; ")
          : "ModbusTcpSlave 集中读写规则通过",
      "warning"
    ),
    makePlcCheck(
      "python_registers",
      "Python寄存器覆盖",
      pythonCoverage.missing.length === 0,
      pythonCoverage.missing.length
        ? `Python 未直接引用: ${pythonCoverage.missingLabels.join(", ")}`
        : "Python 控制脚本覆盖 v26086 控制/反馈地址",
      "warning"
    ),
    makePlcCheck(
      "register_map_file",
      "寄存器表文件",
      pathExists(context.registerMapPath) && registerMapCoverage.missing.length === 0,
      !pathExists(context.registerMapPath)
        ? `文件不存在，可点击“生成寄存器表”: ${context.registerMapPath}`
        : registerMapCoverage.missing.length
          ? `现有表缺少: ${registerMapCoverage.missingLabels.join(", ")}`
          : "现有寄存器表覆盖 v26086 地址",
      "warning"
    ),
    makePlcCheck(
      "generated_register_map",
      "自动生成寄存器表",
      generatedCoverage.missing.length === 0,
      generatedCoverage.missing.length
        ? `生成内容缺少: ${generatedCoverage.missingLabels.join(", ")}`
        : "生成内容已覆盖 v26086 控制/反馈地址"
    )
  ];
  const issues = checks
    .filter((check) => !check.ok)
    .map((check) => ({
      id: check.id,
      severity: check.severity,
      message: check.detail
    }));
  const hardErrorCount = issues.filter((item) => item.severity === "error").length;
  return {
    ok: hardErrorCount === 0,
    fast: true,
    projectPath: context.projectPath,
    exportPath: context.exportPath,
    pythonRoot: context.pythonRoot,
    pythonScript: context.pythonScript,
    registerMapPath: context.registerMapPath,
    localIp: context.localIp,
    localIps: context.localIps,
    device: context.device,
    missingImports: context.missingImports,
    pythonConstants: context.pythonConstants.slice(0, 80),
    pythonSurface: context.pythonSurface,
    pythonScan: context.pythonScan,
    codesysScan: context.codesysScan,
    registerMapScan: context.registerMapScan,
    checks,
    issues,
    issueCount: issues.length,
    generatedRegisterMap: context.generatedRegisterMap,
    commandSource: resolvedCommandPayload.commandSource,
    commandMemory: resolvedCommandPayload.commandMemory,
    commandMemoryError: resolvedCommandPayload.commandMemoryError,
    commands: resolvedCommandPayload.commands,
    analyzedAt: new Date().toISOString()
  };
}

function codesysRuntimeArgs(payload = {}, extra = {}) {
  const profile = String(payload.profile || CODESYS_DEFAULT_PROFILE).trim();
  const args = {
    profile: quoteCodesysProfile(profile),
    timeoutSec: clampInteger(payload.timeoutSec, 1, 3600, CODESYS_DEFAULT_TIMEOUT_SEC),
    noUI: typeof payload.noUI === "boolean" ? payload.noUI : true,
    ...extra
  };
  if (payload.applicationName) {
    args.applicationName = String(payload.applicationName);
  }
  return args;
}

function quoteCodesysProfile(profile) {
  if (!profile) {
    return "";
  }
  if ((profile.startsWith("\"") && profile.endsWith("\"")) || (profile.startsWith("'") && profile.endsWith("'"))) {
    return profile;
  }
  return `"${profile.replace(/"/g, "\\\"")}"`;
}

function parseCodesysToolResult(toolResult) {
  const content = Array.isArray(toolResult && toolResult.content) ? toolResult.content : [];
  const text = content
    .filter((item) => item && item.type === "text")
    .map((item) => String(item.text || ""))
    .join("\n");
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  return {
    isError: !!(toolResult && toolResult.isError),
    rawText: text,
    payload
  };
}

function publicCodesysResponse(callResult, extra = {}) {
  const parsed = parseCodesysToolResult(callResult.toolResult);
  const mcpResult = parsed.payload || {};
  const codesysResult = mcpResult && typeof mcpResult === "object" ? mcpResult.codesysResult || null : null;
  const ok = !parsed.isError && mcpResult.ok !== false && (!codesysResult || codesysResult.ok !== false);
  return {
    ok,
    tool: callResult.tool,
    profile: CODESYS_DEFAULT_PROFILE,
    isError: parsed.isError,
    mcpResult,
    codesysResult,
    rawText: parsed.rawText,
    stderr: callResult.stderr || "",
    ...extra
  };
}

async function callCodesysMcpTool(tool, args = {}, options = {}) {
  const definition = getMcpDefinition("codesys");
  if (!definition || !definition.available) {
    throw httpError("CODESYS MCP 服务未安装或入口文件不存在", 503);
  }

  const timeoutSec = clampInteger(options.timeoutSec || args.timeoutSec, 1, 3600, CODESYS_DEFAULT_TIMEOUT_SEC);
  const env = {
    ...process.env,
    ...definition.env,
    CODESYS_PROFILE: CODESYS_DEFAULT_PROFILE,
    CODESYS_TIMEOUT_SEC: String(timeoutSec)
  };

  return new Promise((resolve, reject) => {
    let nextId = 1;
    let settled = false;
    let stderr = "";
    const pending = new Map();
    const child = spawn(definition.command, definition.args, {
      cwd: definition.root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(overallTimer);
      for (const item of pending.values()) {
        clearTimeout(item.timer);
      }
      pending.clear();
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
      setTimeout(() => {
        if (!child.killed) {
          killProcessTree(child);
        }
      }, 500).unref();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const overallTimer = setTimeout(() => {
      finish(httpError(`CODESYS MCP 调用超时: ${tool}`, 504));
    }, timeoutSec * 1000 + 30000);

    const request = (method, params = {}) => new Promise((requestResolve, requestReject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        requestReject(httpError(`CODESYS MCP 请求超时: ${method}`, 504));
      }, timeoutSec * 1000 + 15000);
      pending.set(id, { resolve: requestResolve, reject: requestReject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

    const notify = (method, params = {}) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    };

    const stdoutParser = appendLineParser((line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id == null || !pending.has(message.id)) {
        return;
      }
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) {
        item.reject(httpError(message.error.message || "CODESYS MCP 返回错误", 502));
      } else {
        item.resolve(message.result);
      }
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdoutParser.write(chunk));
    child.stderr.on("data", (chunk) => {
      stderr = trimTextTail(`${stderr}${chunk}`, 8000);
    });
    child.on("error", (error) => {
      finish(httpError(`CODESYS MCP 启动失败: ${error.message}`, 502));
    });
    child.on("close", (code, signal) => {
      if (!settled) {
        finish(httpError(`CODESYS MCP 提前退出: code=${code} signal=${signal || ""} ${stderr}`.trim(), 502));
      }
    });

    (async () => {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "codex-local-client",
          version: "0.1.0"
        }
      });
      notify("notifications/initialized");
      const toolResult = await request("tools/call", { name: tool, arguments: args });
      finish(null, { tool, toolResult, stderr });
    })().catch((error) => finish(error));
  });
}

async function handleCodesysStatus(_req, res, url) {
  const definition = getMcpDefinition("codesys");
  const defaultProject = path.resolve(CODESYS_DEFAULT_PROJECT);
  const defaultProjectDirectory = path.dirname(defaultProject);
  const defaultExportPath = defaultCodesysExportPath(defaultProject);
  const shouldValidateSetup = url && url.searchParams.get("setup") === "1";
  const status = {
    ok: !!(definition && definition.available),
    available: !!(definition && definition.available),
    label: definition ? definition.label : "CODESYS",
    root: definition ? definition.root : "",
    script: definition ? definition.script : "",
    command: definition ? definition.command : "",
    args: definition ? definition.args : [],
    profile: CODESYS_DEFAULT_PROFILE,
    defaultProject,
    defaultProjectDirectory,
    defaultExportPath,
    defaultSaveAsPath: defaultCodesysCopyPath(defaultProject),
    gitRoot: path.resolve(CODESYS_DEFAULT_GIT_ROOT),
    gitRepoExists: pathExists(path.join(path.resolve(CODESYS_DEFAULT_GIT_ROOT), ".git")),
    projectFile: codesysFileInfo(defaultProject),
    exportFile: codesysFileInfo(defaultExportPath),
    codesysExe: findCodesysExe(),
    setupChecked: shouldValidateSetup,
    setup: null
  };

  if (status.available && shouldValidateSetup) {
    try {
      status.setup = publicCodesysResponse(
        await callCodesysMcpTool("codesys_validate_setup", {}, { timeoutSec: 15 })
      );
      status.ok = status.ok && !!(status.setup.mcpResult && status.setup.mcpResult.ok);
    } catch (error) {
      status.ok = false;
      status.error = error.message;
    }
  }

  sendJson(res, 200, status);
}

async function handleCodesysListProjects(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const requestedDirectory = String(payload.projectDirectory || "").trim();
  const requestedProject = String(payload.projectPath || "").trim();
  const defaultProject = path.resolve(CODESYS_DEFAULT_PROJECT);
  let resolvedInput;
  let currentProjectHint = "";

  if (requestedDirectory) {
    resolvedInput = resolveCodesysProjectInput(requestedDirectory, {
      useDefault: false,
      allowMissing: true,
      maxDepth: 0
    });
    currentProjectHint = requestedProject || (resolvedInput.inputKind === "file" ? resolvedInput.projectPath : "");
  } else if (requestedProject) {
    resolvedInput = resolveCodesysProjectInput(requestedProject, {
      useDefault: false,
      allowMissing: true,
      maxDepth: 0
    });
    currentProjectHint = resolvedInput.inputKind === "file" ? resolvedInput.projectPath : "";
  } else {
    resolvedInput = resolveCodesysProjectInput(path.dirname(defaultProject), {
      useDefault: false,
      allowMissing: true,
      maxDepth: 0
    });
    currentProjectHint = defaultProject;
  }

  const searchRoot = resolvedInput.searchRoot || "";
  const projectPaths = resolvedInput.inputKind === "file" && searchRoot
    ? findCodesysProjectsInDirectory(searchRoot, { maxDepth: 0 })
    : (resolvedInput.projects || []);
  const resolvedProjectHint = currentProjectHint
    ? (path.isAbsolute(currentProjectHint)
      ? path.resolve(currentProjectHint)
      : path.resolve(searchRoot || process.cwd(), currentProjectHint))
    : "";
  const currentProject = resolvedProjectHint
    ? (projectPaths.find((projectPath) => samePath(projectPath, resolvedProjectHint)) || chooseCodesysProjectPath(projectPaths, searchRoot))
    : chooseCodesysProjectPath(projectPaths, searchRoot);
  const projects = projectPaths
    .map((projectPath) => {
      const file = codesysFileInfo(projectPath);
      const exportPath = findAssociatedCodesysXmlPath(projectPath, searchRoot);
      return {
        name: path.basename(projectPath),
        path: projectPath,
        exportDir: codesysExportDirectory(projectPath),
        exportPath,
        saveAsPath: defaultCodesysCopyPath(projectPath),
        hasXml: !!exportPath,
        modifiedAt: file ? file.modifiedAt : "",
        size: file ? file.size : 0,
        current: currentProject
          ? path.resolve(projectPath).toLowerCase() === path.resolve(currentProject).toLowerCase()
          : false
      };
    })
    .sort((a, b) => {
      if (a.current !== b.current) {
        return a.current ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
  sendJson(res, 200, {
    ok: true,
    fast: true,
    dirPath: searchRoot,
    projectDirectory: searchRoot,
    searchRoot,
    inputKind: resolvedInput.inputKind,
    currentProject,
    currentExportDir: currentProject ? codesysExportDirectory(currentProject) : "",
    currentExportPath: currentProject ? findAssociatedCodesysXmlPath(currentProject, searchRoot) : "",
    currentSaveAsPath: currentProject ? defaultCodesysCopyPath(currentProject) : "",
    projects
  });
}

async function handleCodesysReadExport(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const projectPath = payload.projectPath
    ? resolveCodesysProjectPath(payload.projectPath)
    : path.resolve(CODESYS_DEFAULT_PROJECT);
  const exportPath = resolveCodesysReadableXmlPath(projectPath, payload.exportPath);
  if (!pathExists(exportPath)) {
    throw httpError(`XML 缓存不存在，请先点击“从 project 重导”: ${exportPath}`, 404);
  }
  const text = readCodesysTextFile(exportPath);
  requireCodesysXmlText(text, "快速读XML");
  sendJson(res, 200, {
    ok: true,
    fast: true,
    ...codesysTextSnapshot(projectPath, exportPath, text)
  });
}

async function handleCodesysAnalyzeExport(req, res) {
  const payload = await readJsonBody(req, MAX_CODESYS_TEXT_BYTES + 65536);
  const projectPath = payload.projectPath
    ? resolveCodesysProjectPath(payload.projectPath)
    : path.resolve(CODESYS_DEFAULT_PROJECT);
  const exportPath = resolveCodesysReadableXmlPath(projectPath, payload.exportPath);
  const text = typeof payload.text === "string" ? payload.text : readCodesysTextFile(exportPath);
  const snapshot = codesysTextSnapshot(projectPath, exportPath, text);
  const analysis = analyzeCodesysExportText(projectPath, exportPath, text);
  sendJson(res, 200, {
    ok: true,
    ...snapshot,
    ...analysis,
    text: typeof payload.includeText === "boolean" && payload.includeText ? text : undefined,
    analyzedAt: new Date().toISOString()
  });
}

async function handleCodesysInfo(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const projectPath = resolveCodesysProjectPath(payload.projectPath);
  const args = codesysRuntimeArgs(payload, { projectPath });
  const response = publicCodesysResponse(
    await callCodesysMcpTool("codesys_project_info", args, { timeoutSec: args.timeoutSec }),
    {
      projectPath,
      exportPath: defaultCodesysExportPath(projectPath),
      saveAsPath: defaultCodesysCopyPath(projectPath)
    }
  );
  sendJson(res, 200, response);
}

async function handleCodesysExport(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const projectPath = resolveCodesysProjectPath(payload.projectPath);
  const exportTarget = resolveCodesysGeneratedPath(projectPath, payload.exportPath, defaultCodesysExportPath(projectPath));
  const exportPath = exportTarget.finalPath;
  ensureParentDirectory(exportPath);

  const args = codesysRuntimeArgs(payload, {
    projectPath,
    exportPath,
    format: "plcopenxml",
    recursive: payload.recursive !== false,
    declarationsAsPlainText: payload.declarationsAsPlainText !== false
  });
  if (Array.isArray(payload.objectPaths)) {
    args.objectPaths = payload.objectPaths.map((item) => String(item || "").trim()).filter(Boolean);
  }

  const response = publicCodesysResponse(
    await callCodesysMcpTool("codesys_export_project", args, { timeoutSec: args.timeoutSec }),
    {
      projectPath,
      exportPath,
      exportDir: exportTarget.exportDir,
      requestedExportPath: exportTarget.requestedPath,
      exportPathAdjusted: exportTarget.adjusted,
      exportPathAdjustmentReason: exportTarget.adjustmentReason,
      saveAsPath: defaultCodesysCopyPath(projectPath)
    }
  );

  if (pathExists(exportPath)) {
    const text = readCodesysTextFile(exportPath);
    Object.assign(response, codesysTextSnapshot(projectPath, exportPath, text));
  }

  sendJson(res, 200, response);
}

async function handleCodesysSaveExport(req, res) {
  const payload = await readJsonBody(req, MAX_CODESYS_TEXT_BYTES + 65536);
  const projectPath = payload.projectPath ? resolveCodesysProjectPath(payload.projectPath) : path.resolve(CODESYS_DEFAULT_PROJECT);
  const exportTarget = resolveCodesysGeneratedPath(projectPath, payload.exportPath, defaultCodesysExportPath(projectPath));
  const exportPath = exportTarget.finalPath;
  const text = requireCodesysXmlText(payload.text, "保存XML");
  const textBytes = writeCodesysTextFile(exportPath, text);
  sendJson(res, 200, {
    ok: true,
    projectPath,
    exportPath,
    exportDir: exportTarget.exportDir,
    requestedExportPath: exportTarget.requestedPath,
    exportPathAdjusted: exportTarget.adjusted,
    exportPathAdjustmentReason: exportTarget.adjustmentReason,
    textBytes,
    savedAt: new Date().toISOString()
  });
}

async function handleCodesysImport(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const projectPath = resolveCodesysProjectPath(payload.projectPath);
  const importPath = resolveCodesysReadableXmlPath(projectPath, payload.importPath || payload.exportPath);
  if (!pathExists(importPath)) {
    throw httpError(`导入文件不存在: ${importPath}`);
  }
  const importText = readCodesysTextFile(importPath);
  requireCodesysXmlText(importText, "XML转project", { importable: true });
  const saveAsTarget = resolveCodesysGeneratedPath(projectPath, payload.saveAsPath, defaultCodesysCopyPath(projectPath));
  const saveAsPath = saveAsTarget.finalPath;
  ensureParentDirectory(saveAsPath);
  const args = codesysRuntimeArgs(payload, {
    projectPath,
    importPath,
    format: "plcopenxml",
    save: payload.save !== false,
    saveAsPath
  });
  const response = publicCodesysResponse(
    await callCodesysMcpTool("codesys_import_project", args, { timeoutSec: args.timeoutSec }),
    {
      projectPath,
      importPath,
      saveAsPath,
      exportDir: saveAsTarget.exportDir,
      requestedSaveAsPath: saveAsTarget.requestedPath,
      saveAsPathAdjusted: saveAsTarget.adjusted,
      saveAsPathAdjustmentReason: saveAsTarget.adjustmentReason
    }
  );
  sendJson(res, 200, response);
}

async function handleCodesysBuild(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const projectPath = resolveCodesysProjectPath(payload.projectPath);
  const allowedModes = new Set(["build", "rebuild", "clean", "clean_build", "generate_code"]);
  const mode = allowedModes.has(payload.mode) ? payload.mode : "rebuild";
  const args = codesysRuntimeArgs(payload, {
    projectPath,
    mode,
    saveBeforeBuild: payload.saveBeforeBuild === true
  });
  const response = publicCodesysResponse(
    await callCodesysMcpTool("codesys_build_project", args, { timeoutSec: args.timeoutSec }),
    { projectPath, mode }
  );
  sendJson(res, 200, response);
}

function resolveCodesysGitPayload(payload = {}) {
  const projectPath = resolveCodesysProjectPath(payload.projectPath || CODESYS_DEFAULT_PROJECT);
  const exportPath = resolveCodesysReadableXmlPath(projectPath, payload.exportPath);
  const saveAsPath = payload.saveAsPath
    ? resolveCodesysGeneratedPath(projectPath, payload.saveAsPath, defaultCodesysCopyPath(projectPath)).finalPath
    : null;
  const gitRoot = resolveCodesysGitRoot(payload.gitRoot, projectPath);
  return {
    projectPath,
    exportPath,
    saveAsPath,
    gitRoot
  };
}

async function handleCodesysGitStatus(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const paths = resolveCodesysGitPayload(payload);
  const snapshot = await getCodesysGitSnapshot(paths.gitRoot, paths.projectPath, paths.exportPath, paths.saveAsPath);
  sendJson(res, 200, {
    ok: true,
    fast: true,
    action: "status",
    ...snapshot
  });
}

async function handleCodesysGitPull(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const paths = resolveCodesysGitPayload(payload);
  const before = await getCodesysGitSnapshot(paths.gitRoot, paths.projectPath, paths.exportPath, paths.saveAsPath);
  if (!before.upstream) {
    sendJson(res, 200, {
      ok: false,
      action: "pull",
      error: "当前分支没有 upstream，未执行拉取",
      ...before
    });
    return;
  }
  if (!before.clean) {
    sendJson(res, 200, {
      ok: false,
      action: "pull",
      error: "工作区有未提交修改，先提交或处理本地修改后再拉取",
      ...before
    });
    return;
  }
  const pullResult = await runGitCommand(["pull", "--ff-only"], paths.gitRoot);
  const snapshot = await getCodesysGitSnapshot(paths.gitRoot, paths.projectPath, paths.exportPath, paths.saveAsPath);
  sendJson(res, 200, {
    ok: pullResult.ok,
    action: "pull",
    output: pullResult.stdout,
    error: pullResult.ok ? "" : (pullResult.stderr || pullResult.stdout || "Git 拉取失败"),
    ...snapshot
  });
}

async function handleCodesysGitSync(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const paths = resolveCodesysGitPayload(payload);
  const pathspecs = [
    gitPathspec(paths.gitRoot, paths.projectPath, "CODESYS 工程"),
    gitPathspec(paths.gitRoot, paths.exportPath, "PLCopenXML")
  ];
  if (payload.includeTarget && paths.saveAsPath) {
    pathspecs.push(gitPathspec(paths.gitRoot, paths.saveAsPath, "目标 project"));
  }
  const uniquePathspecs = [...new Set(pathspecs)];
  const addResult = await runGitCommand(["add", "--", ...uniquePathspecs], paths.gitRoot);
  if (!addResult.ok) {
    throw httpError(`Git 暂存失败: ${addResult.stderr || addResult.stdout}`, 502);
  }

  const stagedResult = await runGitCommand(["diff", "--cached", "--name-status", "--", ...uniquePathspecs], paths.gitRoot);
  if (!stagedResult.ok) {
    throw httpError(`Git 暂存内容读取失败: ${stagedResult.stderr || stagedResult.stdout}`, 502);
  }

  if (!stagedResult.stdout.trim()) {
    const snapshot = await getCodesysGitSnapshot(paths.gitRoot, paths.projectPath, paths.exportPath, paths.saveAsPath);
    sendJson(res, 200, {
      ok: true,
      fast: true,
      action: "sync",
      committed: false,
      pushed: false,
      message: "当前 CODESYS 工程和 XML 没有新的 Git 修改",
      stagedPaths: uniquePathspecs,
      ...snapshot
    });
    return;
  }

  const commitMessage = String(payload.commitMessage || "同步 CODESYS 工程和 PLCopenXML")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  if (!commitMessage) {
    throw httpError("Git 提交说明不能为空");
  }
  const commitResult = await runGitCommand(["commit", "-m", commitMessage], paths.gitRoot);
  if (!commitResult.ok) {
    throw httpError(`Git 提交失败: ${commitResult.stderr || commitResult.stdout}`, 502);
  }

  const pushResult = await runGitCommand(["push"], paths.gitRoot);
  const snapshot = await getCodesysGitSnapshot(paths.gitRoot, paths.projectPath, paths.exportPath, paths.saveAsPath);
  sendJson(res, 200, {
    ok: pushResult.ok,
    fast: true,
    action: "sync",
    committed: true,
    pushed: pushResult.ok,
    commitMessage,
    commitOutput: commitResult.stdout,
    pushOutput: pushResult.stdout,
    error: pushResult.ok ? "" : (pushResult.stderr || pushResult.stdout || "Git 推送失败；本地提交已保留"),
    stagedPaths: uniquePathspecs,
    ...snapshot
  });
}

function resolvePythonGitPayload(payload = {}) {
  const gitRoot = resolvePythonGitRoot(payload.gitRoot);
  const rawPaths = Array.isArray(payload.syncPaths)
    ? payload.syncPaths
    : PYTHON_DEFAULT_SYNC_PATHS;
  const pathItems = rawPaths
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => {
      const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(gitRoot, value);
      return {
        label: "Python代码",
        path: candidate,
        relativePath: gitPathspec(gitRoot, candidate, "Python代码")
      };
    });
  if (!pathItems.length) {
    throw httpError("至少指定一个 Python 同步路径");
  }
  return { gitRoot, pathItems };
}

async function handlePythonGitStatus(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const paths = resolvePythonGitPayload(payload);
  const snapshot = await getGitSnapshot(paths.gitRoot, paths.pathItems);
  sendJson(res, 200, {
    ok: true,
    fast: true,
    action: "status",
    syncPaths: paths.pathItems.map((item) => item.relativePath),
    ...snapshot
  });
}

async function handlePythonGitPull(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const paths = resolvePythonGitPayload(payload);
  const before = await getGitSnapshot(paths.gitRoot, paths.pathItems);
  if (!before.upstream) {
    sendJson(res, 200, {
      ok: false,
      action: "pull",
      error: "Python 仓库当前分支没有 upstream，未执行拉取",
      ...before
    });
    return;
  }
  if (!before.clean) {
    sendJson(res, 200, {
      ok: false,
      action: "pull",
      error: "Python 仓库工作区有未提交修改，先提交或处理本地修改后再拉取",
      ...before
    });
    return;
  }
  const pullResult = await runGitCommand(["pull", "--ff-only"], paths.gitRoot);
  const snapshot = await getGitSnapshot(paths.gitRoot, paths.pathItems);
  sendJson(res, 200, {
    ok: pullResult.ok,
    action: "pull",
    output: pullResult.stdout,
    error: pullResult.ok ? "" : (pullResult.stderr || pullResult.stdout || "Python 仓库拉取失败"),
    ...snapshot
  });
}

async function handlePythonGitSync(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const paths = resolvePythonGitPayload(payload);
  const pathspecs = [...new Set(paths.pathItems.map((item) => item.relativePath))];
  const addResult = await runGitCommand(["add", "--", ...pathspecs], paths.gitRoot);
  if (!addResult.ok) {
    throw httpError(`Python Git 暂存失败: ${addResult.stderr || addResult.stdout}`, 502);
  }
  const stagedResult = await runGitCommand(["diff", "--cached", "--name-status", "--", ...pathspecs], paths.gitRoot);
  if (!stagedResult.ok) {
    throw httpError(`Python Git 暂存内容读取失败: ${stagedResult.stderr || stagedResult.stdout}`, 502);
  }
  if (!stagedResult.stdout.trim()) {
    const snapshot = await getGitSnapshot(paths.gitRoot, paths.pathItems);
    sendJson(res, 200, {
      ok: true,
      fast: true,
      action: "sync",
      committed: false,
      pushed: false,
      message: "当前 Python 同步路径没有新的 Git 修改",
      stagedPaths: pathspecs,
      ...snapshot
    });
    return;
  }
  const commitMessage = String(payload.commitMessage || "同步 Python PLC 控制代码")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  if (!commitMessage) {
    throw httpError("Python Git 提交说明不能为空");
  }
  const commitResult = await runGitCommand(["commit", "-m", commitMessage], paths.gitRoot);
  if (!commitResult.ok) {
    throw httpError(`Python Git 提交失败: ${commitResult.stderr || commitResult.stdout}`, 502);
  }
  const pushResult = await runGitCommand(["push"], paths.gitRoot);
  const snapshot = await getGitSnapshot(paths.gitRoot, paths.pathItems);
  sendJson(res, 200, {
    ok: pushResult.ok,
    fast: true,
    action: "sync",
    committed: true,
    pushed: pushResult.ok,
    commitMessage,
    commitOutput: commitResult.stdout,
    pushOutput: pushResult.stdout,
    error: pushResult.ok ? "" : (pushResult.stderr || pushResult.stdout || "Python Git 推送失败；本地提交已保留"),
    stagedPaths: pathspecs,
    ...snapshot
  });
}

function handlePythonStatus(_req, res) {
  const pythonRoot = path.resolve(PYTHON_DEFAULT_GIT_ROOT);
  const pythonScript = path.resolve(PYTHON_DEFAULT_SCRIPT);
  const registerMapPath = path.resolve(PLC_DEFAULT_REGISTER_MAP);
  const device = pathExists(pythonRoot)
    ? deviceConfigSummary(pythonRoot, PYTHON_DEFAULT_DEVICE)
    : {
        path: path.join(pythonRoot, "daq_plc_interface", "devices.json"),
        exists: false,
        deviceName: PYTHON_DEFAULT_DEVICE,
        device: null,
        ok: false,
        address: ""
      };
  sendJson(res, 200, {
    ok: pathExists(pythonRoot),
    defaultPythonRoot: pythonRoot,
    defaultPythonScript: pythonScript,
    defaultRegisterMap: registerMapPath,
    defaultDeviceName: PYTHON_DEFAULT_DEVICE,
    manualLocalIpv4: isValidIpv4(MANUAL_LOCAL_IPV4) ? MANUAL_LOCAL_IPV4 : "",
    localIpv4: preferredLocalIpv4(),
    localIpv4List: localIpv4Addresses(),
    gitRepoExists: pathExists(path.join(pythonRoot, ".git")),
    pythonRootFile: codesysFileInfo(pythonRoot),
    pythonScriptFile: codesysFileInfo(pythonScript),
    registerMapFile: codesysFileInfo(registerMapPath),
    device
  });
}

async function handlePythonListTree(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const pythonRoot = resolvePythonRootPath(payload.pythonRoot);
  const requestedPath = String(payload.path || "").trim();
  const dirPath = requestedPath
    ? (path.isAbsolute(requestedPath) ? path.resolve(requestedPath) : path.resolve(pythonRoot, requestedPath))
    : pythonRoot;
  if (!isPathInside(pythonRoot, dirPath)) {
    throw httpError(`目录不在 Python 仓库内: ${dirPath}`, 400);
  }
  let stats;
  try {
    stats = fs.statSync(dirPath);
  } catch {
    throw httpError(`目录不存在: ${dirPath}`, 404);
  }
  if (!stats.isDirectory()) {
    throw httpError(`路径不是目录: ${dirPath}`, 400);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !PYTHON_TREE_EXCLUDED_NAMES.has(entry.name))
    .filter((entry) => !entry.name.startsWith(".") || entry.name === ".env.example")
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const isDirectory = entry.isDirectory();
      return {
        name: entry.name,
        path: fullPath,
        relativePath: path.relative(pythonRoot, fullPath).split(path.sep).join("/"),
        kind: isDirectory ? "directory" : "file",
        extension: isDirectory ? "" : path.extname(entry.name).toLowerCase(),
        selectable: !isDirectory,
        runnable: !isDirectory && path.extname(entry.name).toLowerCase() === ".py"
      };
    })
    .filter((entry) => entry.kind === "directory" || entry.kind === "file")
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });

  sendJson(res, 200, {
    ok: true,
    fast: true,
    pythonRoot,
    path: dirPath,
    relativePath: path.relative(pythonRoot, dirPath).split(path.sep).join("/"),
    parent: dirPath === pythonRoot ? "" : path.dirname(dirPath),
    entries: entries.slice(0, PYTHON_TREE_MAX_ENTRIES),
    truncated: entries.length > PYTHON_TREE_MAX_ENTRIES,
    total: entries.length
  });
}

async function handlePythonReadFile(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const pythonRoot = resolvePythonRootPath(payload.pythonRoot);
  const filePath = resolvePythonCodePath(pythonRoot, payload.filePath || payload.pythonScript, { mustExist: true });
  const text = readBoundedTextFile(filePath, MAX_PYTHON_TEXT_BYTES, "Python 文件");
  sendJson(res, 200, {
    ok: true,
    fast: true,
    pythonRoot,
    filePath,
    text,
    textBytes: Buffer.byteLength(text, "utf8"),
    file: codesysFileInfo(filePath)
  });
}

async function handlePythonSaveFile(req, res) {
  const payload = await readJsonBody(req, MAX_PYTHON_TEXT_BYTES + 65536);
  const pythonRoot = resolvePythonRootPath(payload.pythonRoot);
  const filePath = resolvePythonCodePath(pythonRoot, payload.filePath || payload.pythonScript, { mustExist: false });
  const textBytes = writeBoundedTextFile(filePath, payload.text, MAX_PYTHON_TEXT_BYTES, "Python 文件");
  sendJson(res, 200, {
    ok: true,
    fast: true,
    pythonRoot,
    filePath,
    textBytes,
    file: codesysFileInfo(filePath),
    savedAt: new Date().toISOString()
  });
}

async function handlePythonRun(req, res) {
  const payload = await readJsonBody(req, MAX_PYTHON_TEXT_BYTES + 65536);
  const pythonRoot = resolvePythonRootPath(payload.pythonRoot);
  const scriptPath = resolvePythonScriptPath(pythonRoot, payload.pythonScript || payload.filePath, { mustExist: true });
  if (payload.saveText === true && typeof payload.text === "string") {
    writeBoundedTextFile(scriptPath, payload.text, MAX_PYTHON_TEXT_BYTES, "Python 文件");
  }
  const args = splitCommandLineArgs(payload.args);
  const result = await runLocalProcess("python", [scriptPath, ...args], {
    cwd: pythonRoot,
    processKey: "python",
    timeoutMs: payload.timeoutMs
  });
  sendJson(res, 200, {
    ok: result.ok,
    fast: true,
    action: "run",
    pythonRoot,
    scriptPath,
    args,
    command: ["python", `"${scriptPath}"`, ...args].join(" "),
    ...result,
    error: result.ok ? "" : (result.stderr || result.stdout || "Python 运行失败")
  });
}

async function handlePythonStop(req, res) {
  await readJsonBody(req, 4096).catch(() => ({}));
  const active = ACTIVE_LOCAL_PROCESSES.get("python");
  if (!active || !active.child || active.child.killed) {
    sendJson(res, 200, {
      ok: true,
      stopped: false,
      message: "没有正在运行的 Python 进程"
    });
    return;
  }
  killProcessTree(active.child);
  sendJson(res, 200, {
    ok: true,
    stopped: true,
    runId: active.runId,
    pid: active.child.pid,
    command: [active.command, ...active.args].join(" "),
    startedAt: active.startedAt
  });
}

async function handlePlcLinkAnalyze(req, res) {
  const payload = await readJsonBody(req, MAX_CODESYS_TEXT_BYTES + 65536);
  const context = buildPlcLinkContext(payload);
  const commandPayload = await resolveCurrentPythonCommandPayload(context, payload);
  sendJson(res, 200, publicPlcLinkAnalysis(context, commandPayload));
}

async function handlePlcLinkGenerateRegisterMap(req, res) {
  const payload = await readJsonBody(req, MAX_CODESYS_TEXT_BYTES + 65536);
  const context = buildPlcLinkContext(payload);
  const commandPayload = await resolveCurrentPythonCommandPayload(context, payload);
  const textBytes = writeBoundedTextFile(
    context.registerMapPath,
    context.generatedRegisterMap,
    MAX_PYTHON_TEXT_BYTES,
    "寄存器表"
  );
  sendJson(res, 200, {
    ...publicPlcLinkAnalysis(context, commandPayload),
    saved: true,
    textBytes,
    savedAt: new Date().toISOString(),
    registerMapFile: codesysFileInfo(context.registerMapPath)
  });
}

async function handlePlcLinkCommands(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const context = buildPlcLinkContext(payload);
  const commandPayload = await resolveCurrentPythonCommandPayload(context, payload);
  sendJson(res, 200, {
    ok: true,
    fast: true,
    pythonRoot: context.pythonRoot,
    pythonScript: context.pythonScript,
    deviceName: context.deviceName,
    ...commandPayload
  });
}

async function handlePlcLinkReadFeedback(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const context = buildPlcLinkContext(payload);
  const args = plcRunnerCommandParts(context, "read_positions").slice(1);
  const result = await runLocalProcess("python", args, {
    cwd: context.pythonRoot,
    processKey: "python",
    timeoutMs: clampInteger(payload.timeoutMs, 5000, 120000, 45000)
  });
  sendJson(res, 200, {
    ok: result.ok,
    fast: true,
    action: "read-feedback",
    readOnly: true,
    pythonRoot: context.pythonRoot,
    pythonScript: context.pythonScript,
    args,
    command: commandLine(["python", ...args]),
    ...result,
    error: result.ok ? "" : (result.stderr || result.stdout || "只读反馈失败")
  });
}

function streamEvent(res, eventName, data) {
  if (!res || res.destroyed || res.writableEnded) {
    return false;
  }
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(child) {
  if (!child || !child.pid || child.exitCode != null || child.signalCode != null) {
    return false;
  }

  if (process.platform === "win32") {
    const fallbackKill = () => {
      if (child.exitCode == null && child.signalCode == null) {
        try {
          child.kill();
        } catch {
          // The process may have exited while taskkill was running.
        }
      }
    };
    try {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("error", fallbackKill);
      killer.once("close", (code) => {
        if (code !== 0) {
          fallbackKill();
        }
      });
      killer.unref();
      return true;
    } catch {
      fallbackKill();
      return true;
    }
  }

  try {
    child.kill("SIGTERM");
  } catch {
    return false;
  }
  setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may have exited between the checks.
      }
    }
  }, 3000).unref();
  return true;
}

function isCodexChildRunning(record) {
  const child = record && record.child;
  return Boolean(child && child.pid && child.exitCode == null && child.signalCode == null);
}

function codexWaitInfo(record) {
  const waitKind = String(record && record.waitKind ? record.waitKind : "").toLowerCase();
  if (waitKind === "approval") {
    return { kind: "approval", label: "等待权限确认", timeoutMs: CODEX_SELF_CHECK_MS };
  }
  if (waitKind === "input") {
    return { kind: "input", label: "等待人工输入", timeoutMs: CODEX_SELF_CHECK_MS };
  }
  if (waitKind === "tool" || (record && record.pendingTools && record.pendingTools.size > 0)) {
    return { kind: "tool", label: "等待本地工具返回", timeoutMs: CODEX_TOOL_IDLE_TIMEOUT_MS };
  }
  if (record && record.sawToolStarted) {
    return { kind: "post-tool", label: "工具结束后等待模型继续", timeoutMs: CODEX_POST_TOOL_IDLE_TIMEOUT_MS };
  }
  return { kind: "model", label: "等待模型响应", timeoutMs: CODEX_STALL_TIMEOUT_MS };
}

function publicActiveCodexRun(record) {
  const now = Date.now();
  const wait = codexWaitInfo(record);
  return {
    runId: record.runId,
    pid: record.child && record.child.pid ? record.child.pid : null,
    workspace: record.workspace,
    attempt: record.attempt || 1,
    maxAttempts: record.maxAttempts || 1,
    providerRetryCount: record.providerRetryCount || 0,
    startedAt: new Date(record.startedAt).toISOString(),
    elapsedMs: Math.max(0, now - record.startedAt),
    lastActivityAt: new Date(record.lastActivityAt).toISOString(),
    idleMs: Math.max(0, now - record.lastActivityAt),
    lastEventName: record.lastEventName || "",
    lastEventDetail: record.lastEventDetail || "",
    stalled: now - record.lastActivityAt >= CODEX_STALL_WARNING_MS,
    selfChecking: now - record.lastActivityAt >= CODEX_SELF_CHECK_MS,
    selfCheckCount: record.selfCheckCount || 0,
    watchdogRecoveryCount: record.watchdogRecoveryCount || 0,
    waitKind: wait.kind,
    waitLabel: wait.label,
    effectiveTimeoutMs: wait.timeoutMs,
    processAlive: isCodexChildRunning(record),
    toolWaiting: wait.kind === "tool"
  };
}

function isCodexToolWaiting(record) {
  return codexWaitInfo(record).kind === "tool";
}

function appendLineParser(onLine) {
  let buffer = "";
  return {
    write(chunk) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          onLine(line);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    },
    flush() {
      const line = buffer.replace(/\r$/, "");
      buffer = "";
      if (line.length > 0) {
        onLine(line);
      }
    }
  };
}

function buildCodexArgs(payload, workspace) {
  const basePrompt = String(payload.prompt || "").trim();
  if (!basePrompt) {
    throw Object.assign(new Error("请输入任务内容"), { statusCode: 400 });
  }
  if (Buffer.byteLength(basePrompt, "utf8") > MAX_PROMPT_BYTES) {
    throw Object.assign(new Error("任务内容过长"), { statusCode: 413 });
  }

  const sandbox = SANDBOX_VALUES.has(payload.sandbox) ? payload.sandbox : "danger-full-access";
  const requestedApproval = APPROVAL_VALUES.has(payload.approval) ? payload.approval : "never";
  const approvalDowngraded = requestedApproval === "on-request";
  const approval = approvalDowngraded ? "never" : requestedApproval;
  const autoApprovalEnabled = payload.autoApprovalEnabled !== false;
  const autoApprovalDelayMs = clampInteger(payload.autoApprovalDelayMs, 3000, 120000, 10000);
  const providerConfig = getCodexConfigSummary();
  const requestedReasoningEffort = REASONING_VALUES.has(payload.requestedReasoningEffort)
    ? payload.requestedReasoningEffort
    : REASONING_VALUES.has(payload.reasoningEffort) ? payload.reasoningEffort : "default";
  const selectedReasoningEffort = REASONING_VALUES.has(payload.reasoningEffort)
    ? payload.reasoningEffort
    : requestedReasoningEffort;
  const configuredReasoningEffort = REASONING_VALUES.has(providerConfig.modelReasoningEffort)
    ? providerConfig.modelReasoningEffort
    : "default";
  const reasoningEffort = selectedReasoningEffort === "default"
    ? configuredReasoningEffort
    : selectedReasoningEffort;
  const modelSelection = resolveRunModel(payload, providerConfig, reasoningEffort);
  const { model, requestedModel, modelMode, modelSource } = modelSelection;
  const requestedAgentProfile = cleanAgentProfile(payload.agentProfile);
  const activeAgentProfile = inferAgentProfile(requestedAgentProfile, basePrompt);
  const agentLabel = (AGENT_PROFILE_DEFINITIONS[activeAgentProfile] || AGENT_PROFILE_DEFINITIONS.auto).label;
  const providerProxyBaseUrl = shouldUseProviderProxy(providerConfig) ? localProviderProxyBaseUrl(providerConfig) : "";
  const selectedMcpNames = getSelectedMcpNames(payload);
  const mcpConfig = buildMcpConfigArgs(selectedMcpNames, Array.isArray(payload.mcpTools));
  const extraWritableDirs = sandbox === "workspace-write" ? resolveExtraWritableDirs(payload, workspace) : [];
  const continuation = buildContinuationPrompt(payload, basePrompt);
  const maintenanceEnabled = payload.maintenanceContext !== false;
  const workspaceContextEnabled = !!(payload.workspaceContext && typeof payload.workspaceContext === "object");
  const automaticDocuments = collectAutomaticDocumentContext(workspace);
  const fixedPromptPrefix = [
    maintenanceEnabled ? maintenancePromptPrefix() : "",
    mcpPromptPrefix(mcpConfig.enabled),
    runtimePermissionPromptPrefix(sandbox, approval),
    agentPromptPrefix(activeAgentProfile, requestedAgentProfile),
    engineeringExperiencePromptPrefix(workspace),
    workspaceContextEnabled ? engineeringWorkspacePromptPrefix(payload.workspaceContext) : ""
  ].join("");
  const automaticDocumentText = automaticDocumentPromptPrefix(automaticDocuments);
  const automaticDocumentBudget = Math.max(
    0,
    MAX_PROMPT_BYTES -
      Buffer.byteLength(fixedPromptPrefix + continuation.prompt, "utf8") -
      2048
  );
  const automaticDocumentPrefix = automaticDocumentBudget > 0
    ? trimTextUtf8(automaticDocumentText, automaticDocumentBudget)
    : "";
  const prompt = fixedPromptPrefix + automaticDocumentPrefix + continuation.prompt;
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw Object.assign(new Error("任务内容过长，请缩短指令或历史上下文"), { statusCode: 413 });
  }
  const args = [];

  if (payload.webSearch === true) {
    args.push("--search");
  }

  args.push("--ask-for-approval", approval);

  if (reasoningEffort !== "default") {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  }

  if (providerProxyBaseUrl && /^[A-Za-z0-9_-]+$/.test(providerConfig.modelProvider || "")) {
    args.push("-c", `model_providers.${providerConfig.modelProvider}.base_url=${tomlString(providerProxyBaseUrl)}`);
  }

  args.push(...mcpConfig.args);

  args.push(
    "exec",
    "--json",
    "--color",
    "never",
    "--cd",
    workspace,
    "--sandbox",
    sandbox,
    "--skip-git-repo-check"
  );
  extraWritableDirs.forEach((dir) => {
    args.push("--add-dir", dir);
  });

  if (payload.ephemeral === true) {
    args.push("--ephemeral");
  }

  args.push("--model", model);

  for (const attachment of automaticDocuments.visualAttachments) {
    args.push("--image", attachment.filePath);
  }

  args.push("-");
  return {
    args,
    prompt,
    basePrompt,
    sandbox,
    approval,
    requestedApproval,
    approvalDowngraded,
    autoApprovalEnabled,
    autoApprovalDelayMs,
    model,
    requestedModel,
    modelMode,
    modelSource,
    agentProfile: requestedAgentProfile,
    activeAgentProfile,
    agentLabel,
    requestedReasoningEffort,
    reasoningEffort,
    mcpTools: mcpConfig.enabled,
    addDirs: extraWritableDirs,
    providerConfig,
    providerProxyBaseUrl,
    maintenanceContext: maintenanceEnabled,
    maintenance: maintenanceEnabled ? publicMaintenanceStatus({ includeText: false }) : null,
    workspaceContext: workspaceContextEnabled,
    automaticDocuments: publicAutomaticDocumentContext(automaticDocuments),
    continueFrom: continuation.parent ? publicHistoryRecord(continuation.parent, { details: false }) : null
  };
}

async function handleRun(req, res) {
  const payload = await readJsonBody(req);
  const workspace = resolveRunWorkspace(payload);
  const run = buildCodexArgs(payload, workspace);
  const invocation = getCodexInvocation();
  const providerConfig = run.providerConfig;
  const runId = crypto.randomUUID();

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  let finished = false;
  let retryTimer = null;
  let stdoutParser = null;
  let stderrParser = null;
  let attemptErrorText = "";
  let allErrorText = "";
  let sawTurnEnd = false;
  let sawFinalResult = false;
  let sawToolStarted = false;
  const startedAt = Date.now();
  const maxAttempts = 1 + CODEX_PROVIDER_RETRY_LIMIT;
  const activeRun = {
    runId,
    child: null,
    workspace,
    startedAt,
    lastActivityAt: startedAt,
    lastEventName: "spawn",
    lastEventDetail: "Codex 进程已启动",
    stallWarningSent: false,
    selfCheckSent: false,
    selfCheckCount: 0,
    watchdogRecoveryCount: 0,
    recoveryPending: false,
    recoveryChild: null,
    recoveryKillTimer: null,
    recoveryTrigger: "",
    recoveryPrompt: "",
    recoveryStateAware: false,
    recoveryHistory: [],
    approvalAbortDetected: false,
    approvalAbortDetail: "",
    interactionNoticeSent: false,
    interactionDeadlineAt: 0,
    interactionKind: "",
    pendingTools: new Set(),
    waitKind: "model",
    sawToolStarted: false,
    completionExitTimer: null,
    attempt: 0,
    maxAttempts,
    providerRetryCount: 0,
    stop: null,
    requestRecovery: null,
    updateApprovalPolicy: null
  };

  function markActivity(eventName, detail = "") {
    activeRun.lastActivityAt = Date.now();
    activeRun.lastEventName = String(eventName || "activity");
    activeRun.lastEventDetail = trimText(detail || "", 240);
    activeRun.stallWarningSent = false;
    activeRun.selfCheckSent = false;
  }

  function clearCompletionTimer() {
    if (activeRun.completionExitTimer) {
      clearTimeout(activeRun.completionExitTimer);
      activeRun.completionExitTimer = null;
    }
  }

  function flushCurrentParsers() {
    if (stdoutParser) {
      stdoutParser.flush();
      stdoutParser = null;
    }
    if (stderrParser) {
      stderrParser.flush();
      stderrParser = null;
    }
  }

  function finishRun(code, signal, options = {}) {
    if (finished) {
      return;
    }
    finished = true;
    clearInterval(watchdog);
    clearCompletionTimer();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (activeRun.recoveryKillTimer) {
      clearTimeout(activeRun.recoveryKillTimer);
      activeRun.recoveryKillTimer = null;
    }
    ACTIVE_CODEX_RUNS.delete(runId);
    syncEngineeringMemoryMirror();
    if (options.killChild === true) {
      killProcessTree(activeRun.child);
    }
    flushCurrentParsers();
    streamEvent(res, "exit", {
      code,
      signal,
      durationMs: Date.now() - startedAt,
      idleMs: Math.max(0, Date.now() - activeRun.lastActivityAt),
      lastEventName: activeRun.lastEventName,
      lastEventDetail: activeRun.lastEventDetail,
      attempt: activeRun.attempt || 1,
      maxAttempts,
      providerRetryCount: activeRun.providerRetryCount || 0,
      synthetic: options.synthetic === true,
      stopped: options.stopped === true,
      stalled: options.stalled === true,
      autoStopped: options.autoStopped === true,
      reason: options.reason || "",
      waitKind: codexWaitInfo(activeRun).kind,
      selfCheckCount: activeRun.selfCheckCount || 0,
      watchdogRecoveryCount: activeRun.watchdogRecoveryCount || 0,
      approvalAbortDetected: activeRun.approvalAbortDetected === true,
      approvalAbortDetail: activeRun.approvalAbortDetail || ""
    });
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }

  function stopActiveChild() {
    killProcessTree(activeRun.child);
  }

  activeRun.stop = (reason = "user") => {
    const toolIdle = reason === "tool-idle" || reason === "post-tool-idle";
    const interactionRequired = reason === "interaction-required";
    const stalled = reason === "stalled" || toolIdle || interactionRequired;
    if (stalled) {
      const wait = codexWaitInfo(activeRun);
      streamEvent(res, "stalled", {
        elapsedMs: Date.now() - startedAt,
        idleMs: Date.now() - activeRun.lastActivityAt,
        warningMs: CODEX_STALL_WARNING_MS,
        timeoutMs: CODEX_STALL_TIMEOUT_MS,
        toolIdle,
        interactionRequired,
        waitKind: wait.kind,
        waitLabel: wait.label,
        effectiveTimeoutMs: wait.timeoutMs,
        toolIdleTimeoutMs: CODEX_TOOL_IDLE_TIMEOUT_MS,
        lastEventName: activeRun.lastEventName,
        lastEventDetail: activeRun.lastEventDetail,
        autoStopped: true,
        message: interactionRequired
          ? activeRun.approvalAbortDetected
            ? "外层宿主的授权已取消；客户端已立即停止本轮任务，并禁止 watchdog 重放同一命令。"
            : "检测到需要权限确认或人工输入，但网页任务是非交互运行；客户端已自动停止，避免无限等待。"
          : toolIdle
            ? "Codex 工具链长时间没有继续返回进展，客户端已自动停止任务。"
            : "Codex 长时间没有新进展，客户端已自动停止任务。"
      });
    }
    finishRun(null, interactionRequired ? "INTERACTION_REQUIRED" : toolIdle ? "TOOL_IDLE_TIMEOUT" : stalled ? "STALL_TIMEOUT" : "CLIENT_STOP", {
      synthetic: true,
      killChild: true,
      stopped: !stalled,
      stalled,
      autoStopped: stalled,
      reason
    });
  };
  ACTIVE_CODEX_RUNS.set(runId, activeRun);

  function codexEventType(event) {
    return String(event && event.type ? event.type : "").toLowerCase();
  }

  function codexItemType(event) {
    const item = event && event.item && typeof event.item === "object" ? event.item : {};
    return String(item.type || "").toLowerCase();
  }

  function isCodexToolItemType(itemType) {
    const value = String(itemType || "").toLowerCase();
    return (
      value.includes("command") ||
      value.includes("function_call") ||
      value.includes("tool_call") ||
      value.includes("mcp") ||
      value.includes("web_search") ||
      value.includes("file_change")
    );
  }

  function codexInteractionWaitKind(event) {
    const item = event && event.item && typeof event.item === "object" ? event.item : {};
    const marker = [
      codexEventType(event),
      codexItemType(event),
      item.name,
      event && event.name
    ].filter(Boolean).join(" ").toLowerCase();
    if (/approval|permission|confirmation|authorize/.test(marker)) {
      return "approval";
    }
    if (/request_user_input|user[_ -]?input|elicitation|prompt_user/.test(marker)) {
      return "input";
    }
    return "";
  }

  function looksLikeCodexInteractionWait(text) {
    return /waiting (?:for )?(?:approval|permission|confirmation|user input)|approval required|request_user_input|press (?:enter|y\/n)|等待.{0,12}(?:授权|批准|确认|输入)|需要.{0,12}(?:人工确认|用户输入)/i.test(String(text || ""));
  }

  function looksLikeCodexApprovalAbort(text) {
    return /approval request aborted|you canceled the request|conversation interrupted/i.test(String(text || ""));
  }

  function codexItemKey(event) {
    const item = event && event.item && typeof event.item === "object" ? event.item : {};
    return String(item.id || item.call_id || (event && (event.id || event.call_id)) || item.type || "tool");
  }

  function noteInteractionWait(kind, detail = "") {
    activeRun.waitKind = kind;
    activeRun.interactionKind = kind;
    if (activeRun.interactionNoticeSent) {
      return;
    }
    activeRun.interactionNoticeSent = true;
    activeRun.interactionDeadlineAt = kind === "approval" && run.autoApprovalEnabled
      ? Date.now() + run.autoApprovalDelayMs
      : 0;
    streamEvent(res, "approval-required", {
      runId,
      kind,
      message: kind === "approval" ? "检测到任务正在等待权限确认。" : "检测到任务正在等待人工输入。",
      detail: previewText(detail || activeRun.lastEventDetail, 500),
      autoApprovalEnabled: kind === "approval" && run.autoApprovalEnabled,
      autoApprovalDelayMs: run.autoApprovalDelayMs,
      deadlineAt: activeRun.interactionDeadlineAt || null,
      recoveryAvailable: activeRun.watchdogRecoveryCount < CODEX_WATCHDOG_RECOVERY_LIMIT
    });
  }

  function noteApprovalAbort(detail = "") {
    if (finished || activeRun.approvalAbortDetected) {
      return;
    }
    activeRun.approvalAbortDetected = true;
    activeRun.approvalAbortDetail = previewText(detail || "外层授权已取消", 500);
    activeRun.waitKind = "approval";
    activeRun.interactionKind = "approval";
    activeRun.interactionDeadlineAt = 0;
    streamEvent(res, "approval-aborted", {
      runId,
      message: "外层授权已取消，本轮不会再次自动重试。",
      detail: activeRun.approvalAbortDetail,
      recoveryBlocked: true
    });
    activeRun.stop("interaction-required");
  }

  function updateCodexWaitState(event) {
    const type = codexEventType(event);
    const interactionKind = codexInteractionWaitKind(event);
    if (interactionKind) {
      noteInteractionWait(interactionKind, findCodexEventDetail(event));
      return;
    }
    if (isCodexToolStartEvent(event)) {
      activeRun.pendingTools.add(codexItemKey(event));
      activeRun.waitKind = "tool";
      activeRun.sawToolStarted = true;
      return;
    }
    if (type === "item.completed") {
      const key = codexItemKey(event);
      activeRun.pendingTools.delete(key);
      if (isCodexToolItemType(codexItemType(event)) && activeRun.pendingTools.size === 0) {
        activeRun.waitKind = "model";
      }
      return;
    }
    if (type === "turn.completed" || type === "turn.failed") {
      activeRun.pendingTools.clear();
      activeRun.waitKind = "model";
      return;
    }
    if (activeRun.pendingTools.size === 0 && activeRun.waitKind !== "approval" && activeRun.waitKind !== "input") {
      activeRun.waitKind = "model";
    }
  }

  function isCodexFinalResultLikeEvent(event) {
    const type = codexEventType(event);
    const itemType = codexItemType(event);
    const item = event && event.item && typeof event.item === "object" ? event.item : {};
    const text = [
      event && event.text,
      event && event.message,
      event && event.output_text,
      item.text,
      item.message
    ].filter(Boolean).join("\n");
    if (isCodexToolItemType(itemType)) {
      return false;
    }
    return Boolean(text.trim()) && (
      type.includes("output_text.done") ||
      type.includes("message") ||
      (type === "item.completed" && (itemType === "message" || itemType === "agent_message"))
    );
  }

  function isCodexToolStartEvent(event) {
    const type = codexEventType(event);
    const itemType = codexItemType(event);
    return (
      type === "function_call" ||
      isCodexToolItemType(type) ||
      (type === "item.started" && isCodexToolItemType(itemType))
    );
  }

  function shouldRetryProviderFailure(code, signal) {
    if (finished || activeRun.attempt >= maxAttempts) {
      return false;
    }
    if (code === 0 || sawTurnEnd || sawFinalResult) {
      return false;
    }
    if (sawToolStarted && process.env.CODEX_CLIENT_RETRY_AFTER_TOOL !== "1") {
      return false;
    }
    const text = [
      attemptErrorText,
      allErrorText,
      activeRun.lastEventName,
      activeRun.lastEventDetail,
      signal
    ].filter(Boolean).join("\n");
    return isTransientProviderText(text);
  }

  function buildRunReadyData(child) {
    return {
      runId,
      pid: child && child.pid ? child.pid : null,
      workspace,
      sandbox: run.sandbox,
      approval: run.approval,
      requestedApproval: run.requestedApproval,
      approvalDowngraded: run.approvalDowngraded,
      requestedReasoningEffort: run.requestedReasoningEffort,
      reasoningEffort: run.reasoningEffort,
      agentProfile: run.agentProfile,
      activeAgentProfile: run.activeAgentProfile,
      agentLabel: run.agentLabel,
      mcpTools: run.mcpTools,
      addDirs: run.addDirs,
      maintenanceContext: run.maintenanceContext,
      workspaceContext: run.workspaceContext,
      maintenance: run.maintenance,
      automaticDocuments: run.automaticDocuments,
      model: run.model,
      requestedModel: run.requestedModel,
      modelMode: run.modelMode,
      modelSource: run.modelSource,
      provider: providerConfig,
      providerProxyBaseUrl: run.providerProxyBaseUrl || "",
      interactiveApprovalSupported: false,
      approvalRecoverySupported: true,
      autoApprovalEnabled: run.autoApprovalEnabled,
      autoApprovalDelayMs: run.autoApprovalDelayMs,
      selfCheckMs: CODEX_SELF_CHECK_MS,
      stallWarningMs: CODEX_STALL_WARNING_MS,
      safeRestartMs: CODEX_SAFE_RESTART_MS,
      stallTimeoutMs: CODEX_STALL_TIMEOUT_MS,
      toolIdleTimeoutMs: CODEX_TOOL_IDLE_TIMEOUT_MS,
      postToolIdleTimeoutMs: CODEX_POST_TOOL_IDLE_TIMEOUT_MS,
      watchdogRecoveryLimit: CODEX_WATCHDOG_RECOVERY_LIMIT,
      watchdogRecoveryCount: activeRun.watchdogRecoveryCount || 0,
      recoveryTrigger: activeRun.recoveryTrigger || "",
      recoveryStateAware: activeRun.recoveryStateAware === true,
      fullAccess: run.sandbox === "danger-full-access",
      attempt: activeRun.attempt || 1,
      maxAttempts,
      providerRetryCount: activeRun.providerRetryCount || 0,
      continueFrom: run.continueFrom,
      command: [invocation.command, ...invocation.baseArgs, ...run.args.filter((arg) => arg !== run.prompt)].join(" ")
    };
  }

  function scheduleProviderRetry(code, signal) {
    activeRun.providerRetryCount += 1;
    const nextAttempt = activeRun.attempt + 1;
    const delayMs = providerRetryDelay(activeRun.providerRetryCount, CODEX_PROVIDER_RETRY_DELAY_MS);
    const detail = trimTextTail(attemptErrorText || allErrorText || signal || "模型连接中断", 1600);
    markActivity("provider-retry", `模型连接中断，准备第 ${nextAttempt}/${maxAttempts} 次运行`);
    streamEvent(res, "retry", {
      runId,
      attempt: nextAttempt,
      previousAttempt: activeRun.attempt,
      maxAttempts,
      retryCount: activeRun.providerRetryCount,
      delayMs,
      code,
      signal,
      reason: "provider-stream",
      message: `模型连接中断，${Math.round(delayMs / 1000)} 秒后自动重试第 ${nextAttempt}/${maxAttempts} 次。`,
      lastError: detail
    });
    activeRun.child = null;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      launchAttempt("provider-stream");
    }, delayMs);
    retryTimer.unref();
  }

  function scheduleTurnEndExit(event) {
    const type = codexEventType(event);
    if (type !== "turn.completed" && type !== "turn.failed") {
      return;
    }
    if (activeRun.completionExitTimer) {
      return;
    }
    const completed = type === "turn.completed";
    activeRun.completionExitTimer = setTimeout(() => {
      finishRun(completed ? 0 : 1, null, {
        synthetic: true,
        killChild: true,
        reason: completed ? "turn-completed-grace" : "turn-failed-grace"
      });
    }, CODEX_COMPLETED_EXIT_GRACE_MS);
    activeRun.completionExitTimer.unref();
  }

  function watchdogRecoveryThreshold(waitKind) {
    if (waitKind === "approval" || waitKind === "input") {
      return CODEX_SELF_CHECK_MS;
    }
    if (waitKind === "tool") {
      return CODEX_TOOL_IDLE_TIMEOUT_MS;
    }
    if (waitKind === "post-tool") {
      return CODEX_POST_TOOL_IDLE_TIMEOUT_MS;
    }
    return CODEX_SAFE_RESTART_MS;
  }

  function watchdogTriggerLabel(trigger) {
    const labels = {
      "model-idle": "模型长时间无事件",
      "tool-idle": "本地工具长时间未返回",
      "post-tool-idle": "工具结束后模型未继续",
      "interaction-required": "检测到权限或人工输入等待",
      "manual-approval": "用户允许以完全权限恢复",
      "auto-approval": "授权倒计时结束后自动恢复",
      stalled: "任务整体无进展"
    };
    return labels[trigger] || trigger || "任务无进展";
  }

  function watchdogRecoveryPlan(recoveryCount) {
    if (recoveryCount <= 1) {
      return {
        label: "现场核对并换路径",
        instruction: "先读取工作区、Git diff、相关进程和工具状态；不要再次调用刚刚卡住的同一个工具，先用低风险读取或替代命令取得新证据。"
      };
    }
    if (recoveryCount === 2) {
      return {
        label: "缩小范围并完成最小步骤",
        instruction: "把原任务拆成尚未完成的最小可验证子任务，优先完成不依赖卡住工具的部分；对替代工具设置明确超时，不要继续空等原工具。"
      };
    }
    return {
      label: "交付可验证的部分结果",
      instruction: "停止等待不可用依赖，完成能独立验证的修改或分析；如果确实无法继续，输出阻塞证据、已完成步骤和下一步，而不是继续等待。"
    };
  }

  function buildWatchdogRecoveryPrompt(trigger, idleMs) {
    const wait = codexWaitInfo(activeRun);
    const recoveryCount = Math.max(1, activeRun.watchdogRecoveryCount || 1);
    const recoveryPlan = watchdogRecoveryPlan(recoveryCount);
    const previousRecoveryText = activeRun.recoveryHistory
      .slice(0, -1)
      .map((item) => `第 ${item.count} 次=${watchdogTriggerLabel(item.trigger)}/${item.waitKind}`)
      .join("；") || "无";
    const recoveryHeader = [
      `这是客户端 watchdog 自动发起的第 ${recoveryCount}/${CODEX_WATCHDOG_RECOVERY_LIMIT} 次恢复运行。不要从头盲目重做原任务。`,
      `恢复原因: ${watchdogTriggerLabel(trigger)}`,
      `无新事件: ${Math.round(Math.max(0, idleMs) / 1000)} 秒`,
      `等待阶段: ${wait.label}`,
      `本次恢复策略: ${recoveryPlan.label}`,
      "现场状态：恢复运行必须先核对当前文件、进程、工具和已完成步骤。",
      `之前的恢复尝试: ${previousRecoveryText}`,
      `上次运行是否启动过工具: ${activeRun.sawToolStarted ? "是" : "否"}`,
      `尚未完成的工具数: ${activeRun.pendingTools.size}`,
      `最后事件: ${activeRun.lastEventName || "未知"}`,
      `最后事件内容: ${activeRun.lastEventDetail || "无"}`,
      "恢复执行规则：",
      `0. ${recoveryPlan.instruction}`,
      "1. 先检查当前工作区文件、Git diff、相关进程和可读取的工具状态，判断哪些步骤已经完成。",
      "2. 保留已经完成且正确的结果，不重复不可逆操作；尤其不要盲目重复删除、覆盖、提交、下载、现场寄存器写入或设备动作。",
      "3. 找到上次停滞的原因，改用不同的方法继续，并主动运行必要的低风险验证。",
      `4. 当前执行权限为 ${run.sandbox === "danger-full-access" ? "完全执行" : "非交互沙箱"}，不要请求或等待人工批准。权限不足时换可行方法。`,
      "5. 如果上次出现 approval request aborted、You canceled the request 或 Conversation interrupted，禁止原样重放同一命令；应改用无需外层授权的方法，无法替代时直接结束。",
      "6. 如果必须依赖 Windows 管理员令牌、账号凭据、第三方登录或硬件现场确认，明确说明缺少的外部条件并结束，不要继续等待。",
      "7. 完成原任务后直接给出结果、验证和剩余风险。"
    ].join("\n");
    const separator = "\n\n[原任务与原运行上下文]\n";
    const promptBudget = Math.max(0, MAX_PROMPT_BYTES - Buffer.byteLength(recoveryHeader + separator, "utf8"));
    return `${recoveryHeader}${separator}${trimTextUtf8(run.prompt, promptBudget, true)}`;
  }

  function startWatchdogRecovery(idleMs, trigger = "model-idle") {
    const child = activeRun.child;
    if (
      finished ||
      activeRun.approvalAbortDetected ||
      activeRun.recoveryPending ||
      activeRun.watchdogRecoveryCount >= CODEX_WATCHDOG_RECOVERY_LIMIT ||
      sawTurnEnd
    ) {
      return false;
    }
    if (!isCodexChildRunning(activeRun)) {
      finishRun(null, "PROCESS_MISSING", {
        synthetic: true,
        stalled: true,
        autoStopped: true,
        reason: "process-missing"
      });
      return true;
    }

    activeRun.watchdogRecoveryCount += 1;
    activeRun.recoveryPending = true;
    activeRun.recoveryChild = child;
    activeRun.recoveryTrigger = trigger;
    activeRun.recoveryStateAware = activeRun.sawToolStarted || sawToolStarted || trigger !== "model-idle";
    activeRun.recoveryHistory.push({
      count: activeRun.watchdogRecoveryCount,
      trigger,
      waitKind: codexWaitInfo(activeRun).kind,
      idleMs,
      lastEventName: activeRun.lastEventName,
      lastEventDetail: activeRun.lastEventDetail
    });
    const recoveryPlan = watchdogRecoveryPlan(activeRun.watchdogRecoveryCount);
    activeRun.recoveryPrompt = buildWatchdogRecoveryPrompt(trigger, idleMs);
    streamEvent(res, "recovery", {
      runId,
      action: "restart",
      trigger,
      triggerLabel: watchdogTriggerLabel(trigger),
      stateAware: activeRun.recoveryStateAware,
      hadToolActivity: activeRun.sawToolStarted,
      idleMs,
      recoveryCount: activeRun.watchdogRecoveryCount,
      recoveryLimit: CODEX_WATCHDOG_RECOVERY_LIMIT,
      strategy: recoveryPlan.label,
      lastEventName: activeRun.lastEventName,
      lastEventDetail: activeRun.lastEventDetail,
      message: activeRun.recoveryStateAware
        ? `watchdog 将携带现场状态启动第 ${activeRun.watchdogRecoveryCount}/${CODEX_WATCHDOG_RECOVERY_LIMIT} 次恢复；本次策略为换方法取得新进展。`
        : `watchdog 将启动第 ${activeRun.watchdogRecoveryCount}/${CODEX_WATCHDOG_RECOVERY_LIMIT} 次恢复，并要求新任务先自检后继续。`
    });
    if (!killProcessTree(child)) {
      activeRun.recoveryPending = false;
      activeRun.recoveryChild = null;
      activeRun.stop("stalled");
      return true;
    }
    activeRun.recoveryKillTimer = setTimeout(() => {
      if (finished || !activeRun.recoveryPending || activeRun.recoveryChild !== child) {
        return;
      }
      activeRun.recoveryPending = false;
      activeRun.recoveryChild = null;
      activeRun.recoveryKillTimer = null;
      streamEvent(res, "recovery", {
        runId,
        action: "failed",
        idleMs: Date.now() - activeRun.lastActivityAt,
        recoveryCount: activeRun.watchdogRecoveryCount,
        recoveryLimit: CODEX_WATCHDOG_RECOVERY_LIMIT,
        message: "旧模型进程未在恢复时限内退出，客户端已放弃重启并安全收尾。"
      });
      activeRun.stop("stalled");
    }, CODEX_RECOVERY_KILL_GRACE_MS);
    activeRun.recoveryKillTimer.unref();
    return true;
  }

  activeRun.requestRecovery = (trigger = "manual-approval") => {
    return startWatchdogRecovery(Math.max(0, Date.now() - activeRun.lastActivityAt), trigger);
  };
  activeRun.updateApprovalPolicy = (enabled, delayMs) => {
    run.autoApprovalEnabled = enabled === true;
    run.autoApprovalDelayMs = clampInteger(delayMs, 3000, 120000, run.autoApprovalDelayMs || 10000);
    activeRun.interactionDeadlineAt = activeRun.waitKind === "approval" && run.autoApprovalEnabled
      ? Date.now() + run.autoApprovalDelayMs
      : 0;
    return {
      autoApprovalEnabled: run.autoApprovalEnabled,
      autoApprovalDelayMs: run.autoApprovalDelayMs,
      deadlineAt: activeRun.interactionDeadlineAt || null
    };
  };

  function launchAttempt(reason = "initial") {
    if (finished) {
      return;
    }
    clearCompletionTimer();
    flushCurrentParsers();
    attemptErrorText = "";
    activeRun.attempt += 1;
    activeRun.lastActivityAt = Date.now();
    activeRun.pendingTools.clear();
    activeRun.waitKind = "model";
    activeRun.sawToolStarted = false;
    activeRun.interactionNoticeSent = false;
    activeRun.interactionDeadlineAt = 0;
    activeRun.interactionKind = "";
    activeRun.selfCheckSent = false;
    activeRun.lastEventName = reason === "initial"
      ? "spawn"
      : reason === "watchdog-recovery" ? "watchdog-recovery-start" : "provider-retry-start";
    activeRun.lastEventDetail = reason === "initial"
      ? "Codex 进程已启动"
      : reason === "watchdog-recovery"
        ? `watchdog 已启动状态感知恢复: ${watchdogTriggerLabel(activeRun.recoveryTrigger)}`
        : `第 ${activeRun.attempt}/${maxAttempts} 次自动重试已启动`;

    const child = spawn(invocation.command, [...invocation.baseArgs, ...run.args], {
      cwd: workspace,
      env: getCodexChildEnv(run.providerProxyBaseUrl),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    activeRun.child = child;

    stdoutParser = appendLineParser((line) => {
      markActivity("stdout", line);
      try {
        const event = JSON.parse(line);
        const type = codexEventType(event);
        if (type === "turn.completed" || type === "turn.failed") {
          sawTurnEnd = true;
        }
        if (isCodexFinalResultLikeEvent(event)) {
          sawFinalResult = true;
        }
        if (isCodexToolStartEvent(event)) {
          sawToolStarted = true;
        }
        updateCodexWaitState(event);
        activeRun.lastEventName = type || "codex";
        activeRun.lastEventDetail = previewText(findCodexEventDetail(event), 240);
        streamEvent(res, "codex", event);
        scheduleTurnEndExit(event);
      } catch {
        streamEvent(res, "stdout", { text: line });
      }
    });

    stderrParser = appendLineParser((line) => {
      markActivity("stderr", line);
      attemptErrorText = appendTailText(attemptErrorText, line, 12000);
      allErrorText = appendTailText(allErrorText, line, 24000);
      streamEvent(res, "stderr", { text: line });
      if (looksLikeCodexApprovalAbort(line)) {
        noteApprovalAbort(line);
        return;
      }
      if (looksLikeCodexInteractionWait(line)) {
        noteInteractionWait(/input|press|输入/i.test(line) ? "input" : "approval", line);
      }
    });

    child.on("error", (error) => {
      const message = error.message || String(error);
      markActivity("process-error", message);
      attemptErrorText = appendTailText(attemptErrorText, message, 12000);
      allErrorText = appendTailText(allErrorText, message, 24000);
      streamEvent(res, "error", { message });
      finishRun(null, "SPAWN_ERROR", {
        synthetic: true,
        killChild: true,
        reason: "spawn-error"
      });
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdoutParser.write(chunk));
    child.stderr.on("data", (chunk) => stderrParser.write(chunk));

    child.on("close", (code, signal) => {
      flushCurrentParsers();
      if (activeRun.recoveryPending && activeRun.recoveryChild === child) {
        if (activeRun.recoveryKillTimer) {
          clearTimeout(activeRun.recoveryKillTimer);
          activeRun.recoveryKillTimer = null;
        }
        activeRun.recoveryPending = false;
        activeRun.recoveryChild = null;
        launchAttempt("watchdog-recovery");
        return;
      }
      if (shouldRetryProviderFailure(code, signal)) {
        scheduleProviderRetry(code, signal);
        return;
      }
      finishRun(code, signal);
    });

    if (reason === "initial") {
      streamEvent(res, "ready", buildRunReadyData(child));
    } else if (reason === "watchdog-recovery") {
      streamEvent(res, "recovery-started", buildRunReadyData(child));
    } else {
      streamEvent(res, "retry-started", buildRunReadyData(child));
    }

    try {
      child.stdin.end(reason === "watchdog-recovery" && activeRun.recoveryPrompt ? activeRun.recoveryPrompt : run.prompt);
    } catch (error) {
      const message = error.message || String(error);
      attemptErrorText = appendTailText(attemptErrorText, message, 12000);
      allErrorText = appendTailText(allErrorText, message, 24000);
      streamEvent(res, "error", { message });
    }
  }

  const watchdog = setInterval(() => {
    if (finished) {
      return;
    }
    const now = Date.now();
    const idleMs = now - activeRun.lastActivityAt;
    const wait = codexWaitInfo(activeRun);
    const toolWaiting = wait.kind === "tool";
    const selfChecking = idleMs >= CODEX_SELF_CHECK_MS;

    if (selfChecking && !activeRun.selfCheckSent) {
      activeRun.selfCheckSent = true;
      activeRun.selfCheckCount += 1;
      streamEvent(res, "self-check", {
        runId,
        elapsedMs: now - startedAt,
        idleMs,
        selfCheckMs: CODEX_SELF_CHECK_MS,
        waitKind: wait.kind,
        waitLabel: wait.label,
        effectiveTimeoutMs: wait.timeoutMs,
        processAlive: isCodexChildRunning(activeRun),
        recoveryEligible: !sawTurnEnd &&
          activeRun.watchdogRecoveryCount < CODEX_WATCHDOG_RECOVERY_LIMIT,
        recoveryAtMs: watchdogRecoveryThreshold(wait.kind),
        recoveryCount: activeRun.watchdogRecoveryCount,
        recoveryLimit: CODEX_WATCHDOG_RECOVERY_LIMIT,
        lastEventName: activeRun.lastEventName,
        lastEventDetail: activeRun.lastEventDetail,
        message: wait.kind === "approval" || wait.kind === "input"
          ? "检测到任务正在等待人工操作，客户端已显示处理界面并继续监控。"
          : `连续 ${Math.round(idleMs / 1000)} 秒没有新事件，watchdog 已检查子进程和等待阶段。`
      });
    }

    if (activeRun.recoveryPending) {
      return;
    }
    if (!isCodexChildRunning(activeRun) && !retryTimer) {
      finishRun(null, "PROCESS_MISSING", {
        synthetic: true,
        stalled: true,
        autoStopped: true,
        reason: "process-missing"
      });
      return;
    }
    if (
      wait.kind === "approval" &&
      run.autoApprovalEnabled &&
      activeRun.interactionDeadlineAt > 0 &&
      now >= activeRun.interactionDeadlineAt
    ) {
      if (startWatchdogRecovery(idleMs, "auto-approval")) {
        return;
      }
      activeRun.stop("interaction-required");
      return;
    }
    if (wait.kind === "input" && selfChecking) {
      if (startWatchdogRecovery(idleMs, "interaction-required")) {
        return;
      }
      activeRun.stop("interaction-required");
      return;
    }
    if (toolWaiting && idleMs >= CODEX_TOOL_IDLE_TIMEOUT_MS) {
      if (startWatchdogRecovery(idleMs, "tool-idle")) {
        return;
      }
      activeRun.stop("tool-idle");
      return;
    }
    if (wait.kind === "post-tool" && idleMs >= CODEX_POST_TOOL_IDLE_TIMEOUT_MS) {
      if (startWatchdogRecovery(idleMs, "post-tool-idle")) {
        return;
      }
      activeRun.stop("post-tool-idle");
      return;
    }
    if (
      wait.kind === "model" &&
      idleMs >= CODEX_SAFE_RESTART_MS
    ) {
      if (startWatchdogRecovery(idleMs, "model-idle")) {
        return;
      }
    }
    if (idleMs >= CODEX_STALL_TIMEOUT_MS) {
      if (wait.kind === "approval" || wait.kind === "input") {
        activeRun.stop("interaction-required");
        return;
      }
      if (wait.kind !== "approval" && startWatchdogRecovery(idleMs, "stalled")) {
        return;
      }
      activeRun.stop("stalled");
      return;
    }
    const stalled = idleMs >= CODEX_STALL_WARNING_MS;
    if (stalled && !activeRun.stallWarningSent) {
      activeRun.stallWarningSent = true;
      streamEvent(res, "stalled", {
        elapsedMs: now - startedAt,
        idleMs,
        warningMs: CODEX_STALL_WARNING_MS,
        timeoutMs: CODEX_STALL_TIMEOUT_MS,
        toolWaiting,
        toolIdleTimeoutMs: CODEX_TOOL_IDLE_TIMEOUT_MS,
        postToolIdleTimeoutMs: CODEX_POST_TOOL_IDLE_TIMEOUT_MS,
        waitKind: wait.kind,
        waitLabel: wait.label,
        effectiveTimeoutMs: wait.timeoutMs,
        selfChecking,
        selfCheckMs: CODEX_SELF_CHECK_MS,
        lastEventName: activeRun.lastEventName,
        lastEventDetail: activeRun.lastEventDetail,
        autoStopped: false,
        message: `${wait.label}，暂时没有返回新事件。`
      });
    }
    streamEvent(res, "heartbeat", {
      elapsedMs: now - startedAt,
      idleMs,
      warningMs: CODEX_STALL_WARNING_MS,
      timeoutMs: CODEX_STALL_TIMEOUT_MS,
      toolWaiting,
      toolIdleTimeoutMs: CODEX_TOOL_IDLE_TIMEOUT_MS,
      postToolIdleTimeoutMs: CODEX_POST_TOOL_IDLE_TIMEOUT_MS,
      waitKind: wait.kind,
      waitLabel: wait.label,
      effectiveTimeoutMs: wait.timeoutMs,
      selfChecking,
      selfCheckMs: CODEX_SELF_CHECK_MS,
      selfCheckCount: activeRun.selfCheckCount,
      watchdogRecoveryCount: activeRun.watchdogRecoveryCount,
      watchdogRecoveryLimit: CODEX_WATCHDOG_RECOVERY_LIMIT,
      autoApprovalEnabled: run.autoApprovalEnabled,
      approvalDeadlineAt: activeRun.interactionDeadlineAt || null,
      stalled,
      lastEventName: activeRun.lastEventName,
      lastEventDetail: activeRun.lastEventDetail,
      message: selfChecking
        ? `watchdog 正在自检：${wait.label}。`
        : "Codex 正在思考或运行。"
    });
  }, CODEX_HEARTBEAT_INTERVAL_MS);

  res.on("close", () => {
    if (!finished) {
      finishRun(null, "CLIENT_DISCONNECT", {
        synthetic: true,
        killChild: true,
        stopped: true,
        reason: "client-disconnect"
      });
    }
  });

  launchAttempt("initial");
}

function findCodexEventDetail(event) {
  if (!event || typeof event !== "object") {
    return "";
  }
  const item = event.item && typeof event.item === "object" ? event.item : {};
  return (
    item.command ||
    item.text ||
    item.message ||
    event.message ||
    event.error ||
    event.type ||
    ""
  );
}

async function handleStopRun(req, res) {
  const payload = await readJsonBody(req);
  const runId = String(payload.runId || "").trim();
  const activeRun = runId ? ACTIVE_CODEX_RUNS.get(runId) : null;
  if (!activeRun) {
    sendJson(res, 200, {
      ok: true,
      stopped: false,
      runId,
      message: "未找到运行中的 Codex 任务"
    });
    return;
  }
  const pid = activeRun.child && activeRun.child.pid ? activeRun.child.pid : null;
  activeRun.stop("user");
  sendJson(res, 200, {
    ok: true,
    stopped: true,
    runId,
    pid,
    message: "已停止 Codex 任务"
  });
}

async function handleRecoverRun(req, res) {
  const payload = await readJsonBody(req);
  const runId = String(payload.runId || "").trim();
  const activeRun = runId ? ACTIVE_CODEX_RUNS.get(runId) : null;
  if (!activeRun) {
    sendJson(res, 404, { ok: false, runId, message: "未找到运行中的 Codex 任务" });
    return;
  }
  const wait = codexWaitInfo(activeRun);
  if (wait.kind !== "approval" && wait.kind !== "input") {
    sendJson(res, 409, { ok: false, runId, message: "当前任务没有等待授权或人工输入" });
    return;
  }
  if (typeof activeRun.requestRecovery !== "function" || !activeRun.requestRecovery("manual-approval")) {
    sendJson(res, 409, { ok: false, runId, message: "本轮自动恢复次数已用完，无法再次重启" });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    runId,
    message: "已允许客户端以完全权限携带现场状态恢复一次"
  });
}

async function handleApprovalPolicy(req, res) {
  const payload = await readJsonBody(req);
  const runId = String(payload.runId || "").trim();
  const activeRun = runId ? ACTIVE_CODEX_RUNS.get(runId) : null;
  if (!activeRun || typeof activeRun.updateApprovalPolicy !== "function") {
    sendJson(res, 404, { ok: false, runId, message: "未找到运行中的 Codex 任务" });
    return;
  }
  const policy = activeRun.updateApprovalPolicy(payload.enabled === true, payload.delayMs);
  sendJson(res, 200, { ok: true, runId, ...policy });
}

function handleStatus(_req, res) {
  const config = getCodexConfigSummary();
  sendJson(res, 200, {
    codex: getCodexStatus(),
    mcp: getMcpStatus(),
    environment: {
      codexHome: config.codexHome,
      config,
      auth: getCodexAuthInfo(),
      providerProxy: {
        enabled: shouldUseProviderProxy(config),
        localBaseUrl: shouldUseProviderProxy(config) ? localProviderProxyBaseUrl(config) : "",
        prefix: PROVIDER_PROXY_PREFIX,
        retryLimit: PROVIDER_PROXY_RETRY_LIMIT,
        retryDelayMs: PROVIDER_PROXY_RETRY_DELAY_MS,
        keepaliveMs: PROVIDER_PROXY_KEEPALIVE_MS
      }
    },
    history: {
      file: HISTORY_FILE,
      mirrorFile: HISTORY_MIRROR_FILE,
      limit: HISTORY_LIMIT,
      count: readHistoryRecords().length
    },
    runs: {
      active: Array.from(ACTIVE_CODEX_RUNS.values()).map(publicActiveCodexRun),
      heartbeatIntervalMs: CODEX_HEARTBEAT_INTERVAL_MS,
      selfCheckMs: CODEX_SELF_CHECK_MS,
      stallWarningMs: CODEX_STALL_WARNING_MS,
      safeRestartMs: CODEX_SAFE_RESTART_MS,
      stallTimeoutMs: CODEX_STALL_TIMEOUT_MS,
      toolIdleTimeoutMs: CODEX_TOOL_IDLE_TIMEOUT_MS,
      postToolIdleTimeoutMs: CODEX_POST_TOOL_IDLE_TIMEOUT_MS,
      watchdogRecoveryLimit: CODEX_WATCHDOG_RECOVERY_LIMIT,
      interactiveApprovalSupported: false,
      approvalRecoverySupported: true,
      completedExitGraceMs: CODEX_COMPLETED_EXIT_GRACE_MS,
      providerRetryLimit: CODEX_PROVIDER_RETRY_LIMIT,
      providerRetryDelayMs: CODEX_PROVIDER_RETRY_DELAY_MS
    },
    agentProfiles: Object.entries(AGENT_PROFILE_DEFINITIONS).map(([id, definition]) => ({
      id,
      label: definition.label,
      description: definition.description
    })),
    maintenance: publicMaintenanceStatus({ includeText: false }),
    defaultWorkspace: path.resolve(DEFAULT_WORKSPACE),
    platform: process.platform,
    node: process.version
  });
}

function handleMaintenanceGet(_req, res) {
  sendJson(res, 200, publicMaintenanceStatus({ includeText: true }));
}

function handleMcpStatus(_req, res) {
  sendJson(res, 200, getMcpStatus());
}

function handleList(req, res, url) {
  const target = resolveDirectory(url.searchParams.get("path") || DEFAULT_WORKSPACE);
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const fullPath = path.join(target, entry.name);
      return { name: entry.name, path: fullPath };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  sendJson(res, 200, {
    path: target,
    parent: path.dirname(target),
    entries
  });
}

function handleHistoryGet(_req, res, url) {
  const records = readHistoryRecords();
  const id = url.searchParams.get("id");
  const details = url.searchParams.get("details") === "1";

  if (id) {
    const record = records.find((item) => item.id === id);
    if (!record) {
      sendJson(res, 404, { error: "历史记录不存在" });
      return;
    }
    sendJson(res, 200, {
      record: publicHistoryRecord(record, { details: true })
    });
    return;
  }

  const limit = clampInteger(url.searchParams.get("limit"), 1, HISTORY_LIMIT, 80);
  const favoriteOnly = url.searchParams.get("favorites") === "1";
  const visibleRecords = favoriteOnly ? records.filter((record) => record.favorite === true) : records;
  const favoriteCount = records.filter((record) => record.favorite === true).length;

  sendJson(res, 200, {
    records: visibleRecords.slice(0, limit).map((record) => publicHistoryRecord(record, { details: false })),
    totalCount: records.length,
    favoriteCount,
    favoriteOnly
  });
}

async function handleHistoryPost(req, res) {
  const payload = await readJsonBody(req, MAX_BODY_BYTES);
  const record = compactHistoryRecord(payload);
  const records = readHistoryRecords().filter((item) => item.id !== record.id);
  records.unshift(record);
  writeHistoryRecords(records);

  sendJson(res, 201, {
    record: publicHistoryRecord(record, { details: true })
  });
}

async function handleHistoryPatch(req, res, url) {
  const id = url.searchParams.get("id");
  if (!id) {
    sendJson(res, 400, { error: "缺少历史记录 ID" });
    return;
  }

  const payload = await readJsonBody(req, 4096);
  const records = readHistoryRecords();
  const record = records.find((item) => item.id === id);
  if (!record) {
    sendJson(res, 404, { error: "历史记录不存在" });
    return;
  }

  record.favorite = payload.favorite === true;
  record.favoriteAt = record.favorite ? new Date().toISOString() : "";
  writeHistoryRecords(records);

  sendJson(res, 200, {
    ok: true,
    record: publicHistoryRecord(record, { details: true })
  });
}

function handleHistoryDelete(_req, res, url) {
  const scope = String(url.searchParams.get("scope") || "").toLowerCase();
  if (scope === "nonfavorites") {
    const records = readHistoryRecords();
    const nextRecords = records.filter((record) => record.favorite === true);
    writeHistoryRecords(nextRecords);
    sendJson(res, 200, {
      ok: true,
      deleted: records.length - nextRecords.length,
      remaining: nextRecords.length
    });
    return;
  }

  const id = url.searchParams.get("id");
  if (!id) {
    sendJson(res, 400, { error: "缺少历史记录 ID" });
    return;
  }

  const records = readHistoryRecords();
  const nextRecords = records.filter((record) => record.id !== id);
  writeHistoryRecords(nextRecords);
  sendJson(res, 200, {
    ok: true,
    deleted: records.length - nextRecords.length
  });
}

function filteredProxyRequestHeaders(headers, authKey) {
  const blocked = new Set([
    "host",
    "authorization",
    "accept-encoding",
    "connection",
    "content-length",
    "transfer-encoding",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade"
  ]);
  const nextHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (blocked.has(lower) || value == null) {
      continue;
    }
    nextHeaders[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  if (authKey) {
    nextHeaders.Authorization = `Bearer ${authKey}`;
  }
  nextHeaders["Accept-Encoding"] = "identity";
  return nextHeaders;
}

function filteredProxyResponseHeaders(headers, extra = {}) {
  const blocked = new Set([
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "transfer-encoding",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "upgrade"
  ]);
  const nextHeaders = {};
  headers.forEach((value, name) => {
    if (!blocked.has(name.toLowerCase())) {
      nextHeaders[name] = value;
    }
  });
  nextHeaders["cache-control"] = nextHeaders["cache-control"] || "no-store";
  for (const [name, value] of Object.entries(extra || {})) {
    if (value != null) {
      nextHeaders[name] = String(value);
    }
  }
  return nextHeaders;
}

function isRetryableProviderStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

async function fetchProviderResponseWithRetry(target, options) {
  let lastError = null;
  for (let attempt = 0; attempt <= PROVIDER_PROXY_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch(target, options);
      if (attempt < PROVIDER_PROXY_RETRY_LIMIT && isRetryableProviderStatus(response.status)) {
        await response.arrayBuffer().catch(() => null);
        await delay(providerRetryDelay(attempt + 1, PROVIDER_PROXY_RETRY_DELAY_MS));
        continue;
      }
      return { response, retryCount: attempt, lastError: null };
    } catch (error) {
      lastError = error;
      if (attempt >= PROVIDER_PROXY_RETRY_LIMIT || !isTransientProviderText(error.message || error.code || error.name)) {
        throw error;
      }
      await delay(providerRetryDelay(attempt + 1, PROVIDER_PROXY_RETRY_DELAY_MS));
    }
  }
  throw lastError || new Error("模型代理请求失败");
}

function isStreamingProviderRequest(req, target, body, response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    return true;
  }
  if (!target.pathname.toLowerCase().includes("/responses")) {
    return false;
  }
  if (!body || ["GET", "HEAD"].includes(req.method)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
    return parsed && parsed.stream === true;
  } catch {
    return String(body).includes('"stream":true') || String(body).includes('"stream": true');
  }
}

function providerProxyTargetUrl(url, config) {
  if (!url.pathname.startsWith(`${PROVIDER_PROXY_PREFIX}/`)) {
    throw httpError("模型代理路径无效", 404);
  }
  const base = new URL(config.baseUrl);
  const targetPath = url.pathname.slice(PROVIDER_PROXY_PREFIX.length) || "/";
  const basePath = base.pathname.replace(/\/+$/, "");
  if (basePath && targetPath.toLowerCase() !== basePath.toLowerCase() && !targetPath.toLowerCase().startsWith(`${basePath.toLowerCase()}/`)) {
    throw httpError("模型代理路径不在配置的 base_url 下", 403);
  }
  const target = new URL(base.origin);
  target.pathname = targetPath;
  target.search = url.search;
  return target;
}

async function handleCodexProviderProxy(req, res, url) {
  if (!PROVIDER_PROXY_ENABLED) {
    sendJson(res, 404, { error: "模型代理未启用" });
    return;
  }
  if (!["GET", "POST", "HEAD", "OPTIONS"].includes(req.method)) {
    sendJson(res, 405, { error: "模型代理不支持该方法" });
    return;
  }

  const config = getCodexConfigSummary();
  if (!config.baseUrl) {
    sendJson(res, 502, { error: "未配置模型 provider base_url" });
    return;
  }

  const target = providerProxyTargetUrl(url, config);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readRawBody(req, MAX_BODY_BYTES);
  let upstream;
  try {
    upstream = await fetchProviderResponseWithRetry(target, {
      method: req.method,
      headers: filteredProxyRequestHeaders(req.headers, readCodexAuthKey(config.codexHome)),
      body,
      redirect: "manual"
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "模型代理连接上游失败",
      target: target.toString(),
      retryCount: PROVIDER_PROXY_RETRY_LIMIT,
      detail: error.message || String(error)
    });
    return;
  }

  const response = upstream.response;
  res.writeHead(response.status, filteredProxyResponseHeaders(response.headers, {
    "x-codex-local-proxy-retry-count": upstream.retryCount || 0,
    "x-codex-local-proxy-target": target.origin
  }));
  if (req.method === "HEAD" || !response.body) {
    res.end();
    return;
  }
  const streaming = isStreamingProviderRequest(req, target, body, response);
  let lastWriteAt = Date.now();
  const keepaliveTimer = streaming
    ? setInterval(() => {
        if (!res.destroyed && !res.writableEnded && Date.now() - lastWriteAt >= PROVIDER_PROXY_KEEPALIVE_MS) {
          lastWriteAt = Date.now();
          res.write(`: codex-local-client keepalive ${new Date().toISOString()}\n\n`);
        }
      }, PROVIDER_PROXY_KEEPALIVE_MS)
    : null;
  if (keepaliveTimer) {
    keepaliveTimer.unref();
  }
  try {
    for await (const chunk of response.body) {
      lastWriteAt = Date.now();
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    if (!res.destroyed) {
      res.destroy(error);
    }
  } finally {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
    }
  }
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const requestedPath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!requestedPath.startsWith(PUBLIC_DIR + path.sep) && requestedPath !== PUBLIC_DIR) {
    sendJson(res, 403, { error: "禁止访问" });
    return;
  }

  fs.readFile(requestedPath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "文件不存在" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(requestedPath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (url.pathname.startsWith(`${PROVIDER_PROXY_PREFIX}/`)) {
      await handleCodexProviderProxy(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      handleStatus(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/maintenance") {
      handleMaintenanceGet(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/list") {
      handleList(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/mcp") {
      handleMcpStatus(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/codesys/status") {
      await handleCodesysStatus(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/list-projects") {
      await handleCodesysListProjects(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/read-export") {
      await handleCodesysReadExport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/analyze-export") {
      await handleCodesysAnalyzeExport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/info") {
      await handleCodesysInfo(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/export") {
      await handleCodesysExport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/save-export") {
      await handleCodesysSaveExport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/import") {
      await handleCodesysImport(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/build") {
      await handleCodesysBuild(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/git/status") {
      await handleCodesysGitStatus(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/git/pull") {
      await handleCodesysGitPull(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codesys/git/sync") {
      await handleCodesysGitSync(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/python/status") {
      handlePythonStatus(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/list-tree") {
      await handlePythonListTree(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/read-file") {
      await handlePythonReadFile(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/save-file") {
      await handlePythonSaveFile(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/document/read") {
      await handleDocumentRead(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/run") {
      await handlePythonRun(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/stop") {
      await handlePythonStop(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plc-link/analyze") {
      await handlePlcLinkAnalyze(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plc-link/generate-register-map") {
      await handlePlcLinkGenerateRegisterMap(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plc-link/commands") {
      await handlePlcLinkCommands(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/plc-link/read-feedback") {
      await handlePlcLinkReadFeedback(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/git/status") {
      await handlePythonGitStatus(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/git/pull") {
      await handlePythonGitPull(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/python/git/sync") {
      await handlePythonGitSync(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      await handleModels(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/history") {
      handleHistoryGet(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/history") {
      await handleHistoryPost(req, res);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/history") {
      await handleHistoryPatch(req, res, url);
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/history") {
      handleHistoryDelete(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      await handleRun(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run/stop") {
      await handleStopRun(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run/recover") {
      await handleRecoverRun(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run/approval-policy") {
      await handleApprovalPolicy(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, url);
      return;
    }

    sendJson(res, 405, { error: "方法不支持" });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "服务器错误"
    });
  }
});

server.listen(PORT, HOST, () => {
  syncHistoryMirror();
  syncEngineeringMemoryMirror();
  console.log(`Codex local client running at http://${HOST}:${PORT}`);
});

