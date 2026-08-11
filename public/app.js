"use strict";

const elements = {
  workspace: document.querySelector(".workspace"),
  inputPanel: document.querySelector(".input-panel"),
  reasoningPanel: document.querySelector(".reasoning-panel"),
  resultPanel: document.querySelector(".result-panel"),
  columnResizers: document.querySelectorAll("[data-column-resizer]"),
  codexStatus: document.querySelector("#codexStatus"),
  workspaceInput: document.querySelector("#workspaceInput"),
  refreshDirsButton: document.querySelector("#refreshDirsButton"),
  parentDirButton: document.querySelector("#parentDirButton"),
  directoryList: document.querySelector("#directoryList"),
  modeControl: document.querySelector("#modeControl"),
  reasoningControl: document.querySelector("#reasoningControl"),
  agentSelect: document.querySelector("#agentSelect"),
  modelSelect: document.querySelector("#modelSelect"),
  modelInput: document.querySelector("#modelInput"),
  refreshModelsButton: document.querySelector("#refreshModelsButton"),
  modelStatus: document.querySelector("#modelStatus"),
  autoApprovalToggle: document.querySelector("#autoApprovalToggle"),
  autoApprovalDelay: document.querySelector("#autoApprovalDelay"),
  codesysMcpToggle: document.querySelector("#codesysMcpToggle"),
  autocadMcpToggle: document.querySelector("#autocadMcpToggle"),
  codesysPanelStatus: document.querySelector("#codesysPanelStatus"),
  codesysProjectDirectory: document.querySelector("#codesysProjectDirectory"),
  codesysExportPath: document.querySelector("#codesysExportPath"),
  codesysSaveAsPath: document.querySelector("#codesysSaveAsPath"),
  codesysProjectSelect: document.querySelector("#codesysProjectSelect"),
  codesysRefreshProjectsButton: document.querySelector("#codesysRefreshProjectsButton"),
  codesysProjectSwitchStatus: document.querySelector("#codesysProjectSwitchStatus"),
  codesysGitRoot: document.querySelector("#codesysGitRoot"),
  codesysGitCommitMessage: document.querySelector("#codesysGitCommitMessage"),
  codesysGitIncludeTarget: document.querySelector("#codesysGitIncludeTarget"),
  codesysGitStatusText: document.querySelector("#codesysGitStatusText"),
  codesysGitStatusButton: document.querySelector("#codesysGitStatusButton"),
  codesysGitPullButton: document.querySelector("#codesysGitPullButton"),
  codesysGitSyncButton: document.querySelector("#codesysGitSyncButton"),
  pythonGitRoot: document.querySelector("#pythonGitRoot"),
  pythonGitPaths: document.querySelector("#pythonGitPaths"),
  pythonGitCommitMessage: document.querySelector("#pythonGitCommitMessage"),
  pythonGitStatusText: document.querySelector("#pythonGitStatusText"),
  pythonGitStatusButton: document.querySelector("#pythonGitStatusButton"),
  pythonGitPullButton: document.querySelector("#pythonGitPullButton"),
  pythonGitSyncButton: document.querySelector("#pythonGitSyncButton"),
  plcLinkStatus: document.querySelector("#plcLinkStatus"),
  plcPythonRoot: document.querySelector("#plcPythonRoot"),
  plcPythonLocalIp: document.querySelector("#plcPythonLocalIp"),
  plcLocalIpStatus: document.querySelector("#plcLocalIpStatus"),
  plcPythonScript: document.querySelector("#plcPythonScript"),
  plcRegisterMap: document.querySelector("#plcRegisterMap"),
  plcDeviceName: document.querySelector("#plcDeviceName"),
  plcLinkAnalyzeButton: document.querySelector("#plcLinkAnalyzeButton"),
  plcGenerateRegisterMapButton: document.querySelector("#plcGenerateRegisterMapButton"),
  plcReadFeedbackButton: document.querySelector("#plcReadFeedbackButton"),
  plcGenerateCommandsButton: document.querySelector("#plcGenerateCommandsButton"),
  plcLinkOutput: document.querySelector("#plcLinkOutput"),
  pythonCodeStatus: document.querySelector("#pythonCodeStatus"),
  pythonCodePath: document.querySelector("#pythonCodePath"),
  pythonRefreshTreeButton: document.querySelector("#pythonRefreshTreeButton"),
  pythonRepoTree: document.querySelector("#pythonRepoTree"),
  pythonRunArgs: document.querySelector("#pythonRunArgs"),
  pythonLoadButton: document.querySelector("#pythonLoadButton"),
  pythonSaveButton: document.querySelector("#pythonSaveButton"),
  pythonUndoButton: document.querySelector("#pythonUndoButton"),
  pythonRedoButton: document.querySelector("#pythonRedoButton"),
  pythonRunButton: document.querySelector("#pythonRunButton"),
  pythonStopButton: document.querySelector("#pythonStopButton"),
  pythonCodeText: document.querySelector("#pythonCodeText"),
  pythonRunOutput: document.querySelector("#pythonRunOutput"),
  codesysReadExportButton: document.querySelector("#codesysReadExportButton"),
  codesysAnalyzeExportButton: document.querySelector("#codesysAnalyzeExportButton"),
  codesysInfoButton: document.querySelector("#codesysInfoButton"),
  codesysExportButton: document.querySelector("#codesysExportButton"),
  codesysSaveExportButton: document.querySelector("#codesysSaveExportButton"),
  codesysImportButton: document.querySelector("#codesysImportButton"),
  codesysBuildMode: document.querySelector("#codesysBuildMode"),
  codesysBuildButton: document.querySelector("#codesysBuildButton"),
  codesysExportText: document.querySelector("#codesysExportText"),
  promptInput: document.querySelector("#promptInput"),
  continueContext: document.querySelector("#continueContext"),
  continueContextText: document.querySelector("#continueContextText"),
  cancelContinueButton: document.querySelector("#cancelContinueButton"),
  runButton: document.querySelector("#runButton"),
  stopButton: document.querySelector("#stopButton"),
  continueRunButton: document.querySelector("#continueRunButton"),
  clearButton: document.querySelector("#clearButton"),
  copyResultButton: document.querySelector("#copyResultButton"),
  favoriteHistoryToggle: document.querySelector("#favoriteHistoryToggle"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  refreshHistoryButton: document.querySelector("#refreshHistoryButton"),
  refreshMcpButton: document.querySelector("#refreshMcpButton"),
  collapsibleSections: document.querySelectorAll("[data-collapsible-section]"),
  collapseButtons: document.querySelectorAll("[data-section-collapse]"),
  inputMeta: document.querySelector("#inputMeta"),
  mcpStatus: document.querySelector("#mcpStatus"),
  historyStatus: document.querySelector("#historyStatus"),
  historyList: document.querySelector("#historyList"),
  runStatus: document.querySelector("#runStatus"),
  runMeta: document.querySelector("#runMeta"),
  resultStatus: document.querySelector("#resultStatus"),
  thinkingState: document.querySelector("#thinkingState"),
  thinkingTitle: document.querySelector("#thinkingTitle"),
  thinkingDetail: document.querySelector("#thinkingDetail"),
  approvalPrompt: document.querySelector("#approvalPrompt"),
  approvalTitle: document.querySelector("#approvalTitle"),
  approvalDetail: document.querySelector("#approvalDetail"),
  approvalCountdown: document.querySelector("#approvalCountdown"),
  approveRecoveryButton: document.querySelector("#approveRecoveryButton"),
  approvalStopButton: document.querySelector("#approvalStopButton"),
  reasoningLog: document.querySelector("#reasoningLog"),
  resultLog: document.querySelector("#resultLog"),
  inputHeightSections: document.querySelectorAll("[data-input-height]")
};

const RUN_MODES = {
  read: { label: "只读分析", sandbox: "read-only", approval: "never" },
  write: { label: "完全执行", sandbox: "danger-full-access", approval: "never" },
  confirm: { label: "工作区写入", sandbox: "workspace-write", approval: "never" }
};

const REASONING_LABELS = {
  default: "自动",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  ultra: "超强"
};

const MODEL_MODE_LABELS = {
  auto: "自动匹配",
  configured: "本机配置",
  explicit: "明确选择",
  custom: "自定义"
};

const DEFAULT_AUTO_MODEL_MAP = Object.freeze({
  low: "gpt-5.6-luna",
  medium: "gpt-5.6-terra",
  high: "gpt-5.6-sol",
  xhigh: "gpt-5.6-sol",
  max: "gpt-5.6-sol",
  ultra: "gpt-5.6-sol"
});

const STATUS_LABELS = {
  completed: "完成",
  failed: "失败",
  stopped: "已停止",
  reused: "已复用"
};

const MCP_LABELS = {
  codesys: "CODESYS",
  autocad: "AutoCAD"
};

const AGENT_LABELS = {
  auto: "自动总控",
  plc_fault: "软硬件联动故障",
  codesys: "CODESYS工程",
  python_plc: "Python-PLC控制",
  register_map: "寄存器映射",
  verification: "验证测试",
  git_sync: "Git同步",
  client_maintenance: "客户端维护"
};

function inferAgentProfileForPrompt(profile, prompt) {
  const requested = AGENT_LABELS[profile] ? profile : "auto";
  if (requested !== "auto") {
    return requested;
  }
  const text = String(prompt || "");
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

const PYTHON_EDIT_HISTORY_LIMIT = 30;
const PYTHON_EDIT_HISTORY_CHAR_LIMIT = 2000000;
const WORKSPACE_CONTEXT_TEXT_LIMIT = 72000;
const LIVE_EVENT_LIMIT = 120;
const LIVE_EVENT_TEXT_LIMIT = 180000;
const LIVE_SINGLE_TEXT_LIMIT = 120000;
const LIVE_LOG_ENTRY_LIMIT = 120;
const LIVE_RAW_TEXT_LIMIT = 4096;
const ENGINEERING_PROMPT_PATTERN = /(联动|检查|修改|同步|提交|推送|CODESYS|codesys|PLC|plc|Python|python|寄存器|Modbus|485|XML|project|工程|仓库|Git|git|编译|运行)/i;

const state = {
  running: false,
  controller: null,
  currentParent: "",
  mode: "write",
  agentProfile: "auto",
  reasoningEffort: "default",
  startedAt: 0,
  tickTimer: null,
  runReconcileTimer: null,
  runReconcileBusy: false,
  runReconcileRequest: null,
  resultTexts: [],
  resultEvents: [],
  reasoningTexts: [],
  reasoningEvents: [],
  runErrorTexts: [],
  codexConfig: null,
  autoModelMap: { ...DEFAULT_AUTO_MODEL_MAP },
  history: [],
  mcpStatus: null,
  codesysBusy: false,
  codesysProjectDirectorySubmitted: "",
  codesysProjectScanRequestId: 0,
  gitBusy: false,
  plcLinkBusy: false,
  pythonRunning: false,
  pythonEditUndoStack: [],
  pythonEditRedoStack: [],
  pythonEditLastText: "",
  pythonEditRecordTimer: null,
  pythonEditApplyingHistory: false,
  historyFavoriteOnly: false,
  historyFavoriteCount: 0,
  historyTotalCount: 0,
  currentRun: null,
  continueFromRecord: null,
  lastSavedRecord: null,
  runningSupplementRestart: null,
  saveHistoryPromise: null,
  historySaved: false,
  historySaving: false,
  approvalAlertTimer: null,
  approvalOriginalTitle: "",
  lastPromptKey: "codex-local-client:last-prompt",
  lastWorkspaceKey: "codex-local-client:last-workspace",
  lastModeKey: "codex-local-client:last-mode",
  lastAgentKey: "codex-local-client:last-agent",
  lastReasoningKey: "codex-local-client:last-reasoning",
  autoApprovalKey: "codex-local-client:auto-approval",
  autoApprovalDelayKey: "codex-local-client:auto-approval-delay",
  historyFavoriteOnlyKey: "codex-local-client:history-favorite-only",
  lastMcpKey: "codex-local-client:mcp-tools",
  lastModelKey: "codex-local-client:last-model",
  customModelKey: "codex-local-client:custom-model",
  codesysProjectDirectoryKey: "codex-local-client:codesys-project-directory",
  codesysProjectKey: "codex-local-client:codesys-project",
  codesysExportKey: "codex-local-client:codesys-export",
  codesysSaveAsKey: "codex-local-client:codesys-save-as",
  codesysGitRootKey: "codex-local-client:codesys-git-root",
  codesysGitCommitKey: "codex-local-client:codesys-git-commit",
  codesysGitIncludeTargetKey: "codex-local-client:codesys-git-include-target",
  pythonGitRootKey: "codex-local-client:python-git-root",
  pythonGitPathsKey: "codex-local-client:python-git-paths",
  pythonGitCommitKey: "codex-local-client:python-git-commit",
  plcPythonRootKey: "codex-local-client:plc-python-root",
  plcPythonLocalIpKey: "codex-local-client:plc-python-local-ip",
  plcPythonLocalIpManualKey: "codex-local-client:plc-python-local-ip-manual",
  plcPythonScriptKey: "codex-local-client:plc-python-script",
  plcRegisterMapKey: "codex-local-client:plc-register-map",
  plcDeviceKey: "codex-local-client:plc-device",
  pythonCodePathKey: "codex-local-client:python-code-path",
  pythonRunArgsKey: "codex-local-client:python-run-args",
  panelLayoutKey: "codex-local-client:panel-layout",
  inputHeightsKey: "codex-local-client:input-heights",
  collapsedSectionsKey: "codex-local-client:input-collapsed-sections"
};

function knownReasoningEffort(value) {
  return Object.prototype.hasOwnProperty.call(REASONING_LABELS, value) ? value : "default";
}

function formatReasoningLabel(actual, requested = actual) {
  const actualValue = knownReasoningEffort(actual || "default");
  const requestedValue = knownReasoningEffort(requested || actualValue);
  const actualLabel = REASONING_LABELS[actualValue] || actualValue;
  const requestedLabel = REASONING_LABELS[requestedValue] || requestedValue;
  if (requestedValue === "default" && actualValue !== "default") {
    return `${requestedLabel}->${actualLabel}`;
  }
  if (requestedValue && requestedValue !== actualValue) {
    return `${requestedLabel}->${actualLabel}`;
  }
  return actualLabel;
}

function formatModelLabel(model, modelMode = "", modelSource = "") {
  const value = String(model || "").trim();
  const mode = String(modelMode || "").trim();
  const source = String(modelSource || "").trim();
  const modeLabel = MODEL_MODE_LABELS[mode] || source || "";
  if (value) {
    return modeLabel ? `${value} (${modeLabel})` : value;
  }
  return mode === "configured" ? "本机默认配置" : modeLabel || "未返回实际模型";
}

function resolveAutomaticReasoningEffort(requested, prompt, workspaceContext, options = {}) {
  const requestedValue = knownReasoningEffort(requested || "default");
  if (requestedValue !== "default") {
    return requestedValue;
  }

  const text = String(prompt || "");
  const normalized = text.toLowerCase();
  let score = 0;
  if (text.length > 2400) {
    score += 3;
  } else if (text.length > 900) {
    score += 2;
  } else if (text.length > 260) {
    score += 1;
  }
  if (options.continueFromRecord) {
    score += 1;
  }
  if (workspaceContext && engineeringWorkspaceHasContent(workspaceContext)) {
    score += 1;
  }
  if (ENGINEERING_PROMPT_PATTERN.test(text)) {
    score += 1;
  }
  if (/(修复|bug|异常|失败|没反应|卡住|追问|历史|删除|保存|恢复|保留|集成|升级|同步|布局|模型|权限|打包|发布|多文件|重构|架构|联动|安全|回归|验证|测试)/i.test(text)) {
    score += 2;
  }
  if (/(pdf|word|excel|docx|xlsx|文档|表格|报告|读取|解析)/i.test(text)) {
    score += 1;
  }
  if (/(只输出|简单|快速|翻译|解释一下|列出|查看状态|现在几点|whoami|version|--help)/i.test(normalized)) {
    score -= 1;
  }

  if (score <= 0) {
    return "low";
  }
  if (score <= 2) {
    return "medium";
  }
  if (score <= 4) {
    return "high";
  }
  if (score <= 6) {
    return "xhigh";
  }
  if (score <= 8) {
    return "max";
  }
  return "ultra";
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function nowTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function formatDate(value) {
  if (!value) {
    return "未知时间";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatHistoryMergeTime(value = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function elapsedText() {
  if (!state.startedAt) {
    return "0 秒";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function durationText(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function runningDetail(prefix, progressText = "", supplementText = "") {
  return `${prefix}，已运行 ${elapsedText()}${progressText}${supplementText}`;
}

function setStatus(text) {
  elements.runStatus.textContent = text;
  elements.inputMeta.textContent = text;
}

function setThinking(title, detail, active = false, tone = "") {
  elements.thinkingTitle.textContent = title;
  elements.thinkingDetail.textContent = detail;
  elements.thinkingState.classList.toggle("active", active);
  elements.thinkingState.classList.toggle("idle", !active);
  elements.thinkingState.classList.toggle("warning", tone === "warning");
}

function sandboxLabel(value) {
  if (value === "danger-full-access") {
    return "完全执行";
  }
  if (value === "read-only") {
    return "只读";
  }
  return "工作区写入";
}

function compactVisibleThought(value, maxChars = 520) {
  const text = String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!text) {
    return "";
  }
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    return "";
  }
  const lines = text.split("\n").map((line) => line.trimEnd()).filter(Boolean).slice(0, 8);
  const visible = lines.join("\n");
  return visible.length > maxChars ? `${visible.slice(0, maxChars - 1)}…` : visible;
}

function rememberCurrentThought(title, detail) {
  if (!state.currentRun) {
    return;
  }
  const visibleTitle = String(title || "正在思考运行").trim();
  const visibleDetail = compactVisibleThought(detail);
  state.currentRun.currentThoughtTitle = visibleTitle || "正在思考运行";
  state.currentRun.currentThoughtDetail = visibleDetail || visibleTitle || "Codex 正在处理";
  state.currentRun.currentThoughtAt = Date.now();
}

function showLiveThought(fallbackTitle, fallbackDetail, footer = "") {
  const currentRun = state.currentRun || {};
  const title = currentRun.currentThoughtTitle || fallbackTitle;
  const detail = currentRun.currentThoughtDetail || fallbackDetail;
  setThinking(title, [detail, footer].filter(Boolean).join("\n"), true);
}

function stopApprovalAlert() {
  if (state.approvalAlertTimer) {
    window.clearInterval(state.approvalAlertTimer);
    state.approvalAlertTimer = null;
  }
  if (state.approvalOriginalTitle) {
    document.title = state.approvalOriginalTitle;
    state.approvalOriginalTitle = "";
  }
}

function updateApprovalCountdown() {
  if (!elements.approvalPrompt || elements.approvalPrompt.hidden) {
    return;
  }
  const currentRun = state.currentRun || {};
  const deadlineAt = Number(currentRun.approvalDeadlineAt || 0);
  if (!currentRun.approvalAutoEnabled || !deadlineAt) {
    elements.approvalCountdown.textContent = "自动处理已关闭，请选择允许并恢复或停止。";
    return;
  }
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);
  elements.approvalCountdown.textContent = remainingMs > 0
    ? `${seconds} 秒后自动允许并恢复一次`
    : "正在自动允许并恢复";
}

function startApprovalAlert(title, detail) {
  stopApprovalAlert();
  state.approvalOriginalTitle = document.title;
  let highlighted = false;
  state.approvalAlertTimer = window.setInterval(() => {
    highlighted = !highlighted;
    document.title = highlighted ? `【需要处理】${state.approvalOriginalTitle}` : state.approvalOriginalTitle;
    updateApprovalCountdown();
  }, 700);
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body: compactVisibleThought(detail, 180) || "Codex 任务正在等待处理" });
    } catch {
      // Browser notification support varies by the local wrapper.
    }
  }
}

function showApprovalPrompt(data) {
  if (!elements.approvalPrompt) {
    return;
  }
  const currentRun = state.currentRun || {};
  currentRun.approvalDeadlineAt = Number(data.deadlineAt || 0);
  currentRun.approvalAutoEnabled = data.autoApprovalEnabled === true;
  elements.approvalPrompt.hidden = false;
  elements.approvalTitle.textContent = data.kind === "input" ? "任务等待人工输入" : "任务等待授权";
  elements.approvalDetail.textContent = data.detail || data.message || "Codex 暂停等待处理";
  elements.approveRecoveryButton.disabled = data.recoveryAvailable === false;
  updateApprovalCountdown();
  startApprovalAlert(elements.approvalTitle.textContent, elements.approvalDetail.textContent);
}

function hideApprovalPrompt() {
  stopApprovalAlert();
  if (elements.approvalPrompt) {
    elements.approvalPrompt.hidden = true;
  }
  if (state.currentRun) {
    state.currentRun.approvalDeadlineAt = 0;
  }
}

function setCodesysStatus(text) {
  if (elements.codesysPanelStatus) {
    elements.codesysPanelStatus.textContent = text;
  }
}

function updateCodesysControls() {
  const disabled = state.running || state.codesysBusy;
  const projectRequiredDisabled = disabled || !selectedCodesysProjectPath();
  [
    elements.codesysReadExportButton,
    elements.codesysAnalyzeExportButton,
    elements.codesysInfoButton,
    elements.codesysExportButton,
    elements.codesysSaveExportButton,
    elements.codesysImportButton,
    elements.codesysBuildButton
  ].forEach((control) => {
    if (control) {
      control.disabled = projectRequiredDisabled;
    }
  });
  [
    elements.codesysBuildMode,
    elements.codesysProjectSelect,
    elements.codesysRefreshProjectsButton
  ].forEach((control) => {
    if (control) {
      control.disabled = disabled;
    }
  });
}

function updateGitControls() {
  const disabled = state.running || state.gitBusy;
  [
    elements.codesysGitStatusButton,
    elements.codesysGitPullButton,
    elements.codesysGitSyncButton,
    elements.pythonGitStatusButton,
    elements.pythonGitPullButton,
    elements.pythonGitSyncButton
  ].forEach((control) => {
    if (control) {
      control.disabled = disabled;
    }
  });
  [
    elements.codesysGitRoot,
    elements.codesysGitCommitMessage,
    elements.codesysGitIncludeTarget,
    elements.pythonGitRoot,
    elements.pythonGitPaths,
    elements.pythonGitCommitMessage
  ].forEach((control) => {
    if (control) {
      control.disabled = disabled;
    }
  });
}

function updatePlcLinkControls() {
  const disabled = state.running || state.plcLinkBusy;
  [
    elements.plcLinkAnalyzeButton,
    elements.plcGenerateRegisterMapButton,
    elements.plcReadFeedbackButton,
    elements.plcGenerateCommandsButton,
    elements.pythonLoadButton,
    elements.pythonSaveButton,
    elements.pythonRunButton,
    elements.pythonUndoButton,
    elements.pythonRedoButton,
    elements.pythonRefreshTreeButton,
    elements.plcPythonRoot,
    elements.plcPythonLocalIp,
    elements.plcPythonScript,
    elements.plcRegisterMap,
    elements.plcDeviceName,
    elements.pythonCodePath,
    elements.pythonRunArgs,
    elements.pythonCodeText
  ].forEach((control) => {
    if (control) {
      control.disabled = disabled;
    }
  });
  if (elements.pythonStopButton) {
    elements.pythonStopButton.disabled = !state.pythonRunning;
  }
  updatePythonEditHistoryControls();
}

function startTicker() {
  stopTicker();
  state.tickTimer = window.setInterval(() => {
    if (!state.running) {
      return;
    }
    const currentRun = state.currentRun || {};
    const idleMs = Number.isFinite(currentRun.serverIdleMs)
      ? currentRun.serverIdleMs + Math.max(0, Date.now() - Number(currentRun.lastHeartbeatAt || Date.now()))
      : Math.max(0, Date.now() - Number(currentRun.lastProgressAt || state.startedAt || Date.now()));
    if (currentRun.stallWarning) {
      const timeoutMs = Number(currentRun.effectiveTimeoutMs || currentRun.stallTimeoutMs || 0);
      const remainingText = timeoutMs > idleMs
        ? `，${durationText(timeoutMs - idleMs)}后自动停止`
        : "，正在自动停止";
      const lastDetail = currentRun.lastEventDetail ? `；最后事件: ${currentRun.lastEventDetail}` : "";
      setStatus("可能卡住");
      setThinking(
        "任务可能卡住",
        `已 ${durationText(idleMs)} 没有新进展${remainingText}${lastDetail}`,
        true,
        "warning"
      );
      return;
    }
    if (currentRun.selfChecking) {
      const timeoutMs = Number(currentRun.effectiveTimeoutMs || currentRun.stallTimeoutMs || 0);
      const remainingText = timeoutMs > idleMs
        ? `，${durationText(timeoutMs - idleMs)}后进入自动恢复`
        : "，正在执行自动恢复";
      setStatus("正在自检");
      setThinking(
        "长时间无响应，正在自检",
        `已 ${durationText(idleMs)} 没有新事件；${currentRun.waitLabel || "正在判断等待阶段"}${remainingText}`,
        true,
        "warning"
      );
      return;
    }
    const supplementText = isQueuedContinuationRequest()
      ? "，已排队下一轮追问"
      : state.runningSupplementRestart
        ? "，正在带补充重启"
        : "";
    const progressText = currentRun.lastProgressLabel
      ? `，最近进展: ${currentRun.lastProgressLabel}`
      : "";
    if (currentRun.turnCompleted || currentRun.turnFailed) {
      const failed = currentRun.turnFailed === true;
      setStatus(failed ? "推理失败，正在收尾" : "推理完成，正在收尾");
      setThinking(
        failed ? "推理失败，正在收尾" : "推理完成，正在收尾",
        runningDetail(failed ? "已收到失败事件，正在等待 Codex 进程退出并保存错误记录" : "已收到完成事件，正在等待 Codex 进程退出并保存历史", progressText, supplementText),
        true,
        failed ? "warning" : ""
      );
      return;
    }
    if (currentRun.resultReceived) {
      setStatus("已收到结果，正在收尾");
      setThinking(
        "已收到结果，正在收尾",
        runningDetail("结果已进入结果框，正在等待 Codex 完成事件和历史保存", progressText, supplementText),
        true
      );
      return;
    }
    showLiveThought(
      "正在思考运行",
      "Codex 正在分析任务",
      `已运行 ${elapsedText()}${progressText}${supplementText}`
    );
  }, 1000);
}

function stopTicker() {
  if (state.tickTimer) {
    window.clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
}

function startRunReconcileTimer() {
  stopRunReconcileTimer();
  state.runReconcileTimer = window.setInterval(() => {
    reconcileCurrentRunStatus().catch(() => {});
  }, 5000);
}

function stopRunReconcileTimer() {
  if (state.runReconcileTimer) {
    window.clearInterval(state.runReconcileTimer);
    state.runReconcileTimer = null;
  }
  state.runReconcileRequest = null;
  state.runReconcileBusy = false;
}

function setRunning(running) {
  state.running = running;
  elements.thinkingState.classList.toggle("running", running);
  elements.runButton.disabled = running;
  elements.stopButton.disabled = !running;
  if (elements.continueRunButton) {
    elements.continueRunButton.disabled = !hasContinueCandidate();
  }
  if (elements.clearHistoryButton) {
    elements.clearHistoryButton.disabled = running;
  }
  elements.promptInput.disabled = false;
  elements.modeControl.querySelectorAll("button").forEach((button) => {
    button.disabled = running;
  });
  elements.reasoningControl.querySelectorAll("button").forEach((button) => {
    button.disabled = running;
  });
  if (elements.agentSelect) {
    elements.agentSelect.disabled = running;
  }
  elements.modelSelect.disabled = running;
  elements.refreshModelsButton.disabled = running;
  elements.modelInput.disabled = running || elements.modelSelect.value !== "__custom__";
  elements.codesysMcpToggle.disabled = running || elements.codesysMcpToggle.dataset.available === "0";
  elements.autocadMcpToggle.disabled = running || elements.autocadMcpToggle.dataset.available === "0";
  updateCodesysControls();
  updateGitControls();
  updatePlcLinkControls();
}

function noteRunProgress(label, detail = "") {
  if (!state.currentRun) {
    return;
  }
  state.currentRun.lastProgressAt = Date.now();
  state.currentRun.lastHeartbeatAt = Date.now();
  state.currentRun.serverIdleMs = 0;
  state.currentRun.stallWarning = false;
  state.currentRun.selfChecking = false;
  state.currentRun.lastProgressLabel = String(label || "收到新事件");
  if (detail) {
    state.currentRun.lastEventDetail = String(detail);
  }
}

async function reconcileCurrentRunStatus() {
  if (!state.running || !state.currentRun || state.currentRun.exitSeen || state.runReconcileBusy) {
    return;
  }

  const currentRun = state.currentRun;
  const runId = String(currentRun.runId || "");
  if (!runId) {
    return;
  }

  const requestToken = {};
  state.runReconcileRequest = requestToken;
  state.runReconcileBusy = true;
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json().catch(() => ({}));
    if (
      state.runReconcileRequest !== requestToken ||
      !state.running ||
      state.currentRun !== currentRun ||
      String(currentRun.runId || "") !== runId
    ) {
      return;
    }
    if (!response.ok) {
      throw new Error(status.error || response.statusText);
    }

    const activeRuns = status.runs && Array.isArray(status.runs.active) ? status.runs.active : [];
    const activeRun = activeRuns.find((item) => String(item.runId || "") === runId);
    if (activeRun) {
      state.currentRun.backendMissingSince = 0;
      state.currentRun.serverIdleMs = Number(activeRun.idleMs || 0);
      state.currentRun.lastHeartbeatAt = Date.now();
      state.currentRun.stallWarning = activeRun.stalled === true;
      state.currentRun.selfChecking = activeRun.selfChecking === true;
      state.currentRun.waitKind = activeRun.waitKind || state.currentRun.waitKind || "model";
      state.currentRun.waitLabel = activeRun.waitLabel || state.currentRun.waitLabel || "";
      state.currentRun.effectiveTimeoutMs = Number(activeRun.effectiveTimeoutMs || state.currentRun.effectiveTimeoutMs || 0);
      state.currentRun.selfCheckCount = Number(activeRun.selfCheckCount || state.currentRun.selfCheckCount || 0);
      state.currentRun.watchdogRecoveryCount = Number(activeRun.watchdogRecoveryCount || state.currentRun.watchdogRecoveryCount || 0);
      state.currentRun.lastEventDetail = activeRun.lastEventDetail || state.currentRun.lastEventDetail || "";
      state.currentRun.lastProgressLabel = activeRun.lastEventName || state.currentRun.lastProgressLabel || "";
      return;
    }

    if (!state.currentRun.backendMissingSince) {
      state.currentRun.backendMissingSince = Date.now();
      return;
    }

    if (Date.now() - state.currentRun.backendMissingSince < 8000) {
      return;
    }

    if (state.currentRun.resultReceived || state.currentRun.turnCompleted || state.currentRun.turnFailed || state.resultTexts.length) {
      const failed = state.currentRun.turnFailed === true;
      const detail = [
        "后端活动任务表里已经找不到当前 Codex runId，但客户端已经收到结果或完成事件，按已收尾处理。",
        state.currentRun.runId ? `runId: ${state.currentRun.runId}` : "",
        state.currentRun.pid ? `PID: ${state.currentRun.pid}` : "",
        state.currentRun.lastProgressLabel ? `最后进展: ${state.currentRun.lastProgressLabel}` : "",
        state.currentRun.lastEventDetail ? `事件内容: ${state.currentRun.lastEventDetail}` : ""
      ].filter(Boolean).join("\n");
      recoverResultFromReasoningEvents();
      appendReasoning("exit", "后台已收尾", detail);
      if (!state.resultTexts.length) {
        appendResult("empty", "未捕获到最终结果", "Codex 已结束，但没有输出最终回答。完整过程请查看运行推理框。");
      }
      state.currentRun.exitSeen = true;
      state.currentRun.clientAbortReason = "backend-finished";
      updateContinueRunButtonState();
      setStatus(failed ? "推理失败，已收尾" : "运行完成");
      setThinking(
        failed ? "推理失败，已收尾" : "运行完成",
        failed ? "后端已结束，错误记录正在保存到历史" : "后端已结束，结果正在保存到历史",
        false,
        failed ? "warning" : ""
      );
      elements.resultStatus.textContent = state.resultTexts.length ? (failed ? "失败" : "完成") : "未捕获到最终结果";
      state.saveHistoryPromise = saveHistoryRecord(failed ? "failed" : "completed");
      if (state.controller) {
        state.controller.abort();
      }
      return;
    }

    state.currentRun.clientAbortReason = "backend-lost";
    if (state.controller) {
      state.controller.abort();
    }
  } finally {
    if (state.runReconcileRequest === requestToken) {
      state.runReconcileRequest = null;
      state.runReconcileBusy = false;
    }
  }
}

function hasContinueCandidate() {
  return Boolean(state.continueFromRecord || state.lastSavedRecord || (state.running && state.currentRun));
}

function updateContinueRunButtonState() {
  if (!elements.continueRunButton) {
    return;
  }
  const available = hasContinueCandidate();
  elements.continueRunButton.disabled = !available;
  if (state.running) {
    elements.continueRunButton.title = currentRunHasFinalResponse()
      ? "当前结果会先保存，再作为上下文运行下一轮追问"
      : "运行中输入补充后点击，会停止当前推理并带补充重新推理";
    return;
  }
  elements.continueRunButton.title = state.continueFromRecord
    ? "使用当前历史上下文继续追问"
    : state.lastSavedRecord
      ? "使用最近一次结果继续追问"
      : "先从历史记录里选择一条上下文";
}

function setSegmentValue(container, attribute, value) {
  if (!container) {
    return;
  }
  container.querySelectorAll("button").forEach((button) => {
    const active = button.dataset[attribute] === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

const PANEL_MIN_WIDTHS = {
  input: 380,
  reasoning: 280,
  result: 320
};

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isDesktopLayout() {
  return window.matchMedia("(min-width: 1181px)").matches;
}

function workspaceMetrics() {
  const style = window.getComputedStyle(elements.workspace);
  const contentWidth = elements.workspace.clientWidth
    - Number.parseFloat(style.paddingLeft || "0")
    - Number.parseFloat(style.paddingRight || "0");
  const gap = Number.parseFloat(style.columnGap || "8") || 8;
  return {
    contentWidth,
    fixedWidth: 16 + gap * 4
  };
}

function applyPanelWidths(inputWidth, reasoningWidth) {
  if (!isDesktopLayout()) {
    elements.workspace.style.removeProperty("--input-col");
    elements.workspace.style.removeProperty("--reasoning-col");
    return false;
  }

  const metrics = workspaceMetrics();
  const available = metrics.contentWidth - metrics.fixedWidth - PANEL_MIN_WIDTHS.result;
  if (available < PANEL_MIN_WIDTHS.input + PANEL_MIN_WIDTHS.reasoning) {
    return false;
  }

  const nextInput = clampNumber(
    Math.round(inputWidth),
    PANEL_MIN_WIDTHS.input,
    available - PANEL_MIN_WIDTHS.reasoning
  );
  const nextReasoning = clampNumber(
    Math.round(reasoningWidth),
    PANEL_MIN_WIDTHS.reasoning,
    available - nextInput
  );

  elements.workspace.style.setProperty("--input-col", `${nextInput}px`);
  elements.workspace.style.setProperty("--reasoning-col", `${nextReasoning}px`);
  return true;
}

function savePanelLayout() {
  if (!isDesktopLayout()) {
    return;
  }
  const inputWidth = elements.inputPanel.getBoundingClientRect().width;
  const reasoningWidth = elements.reasoningPanel.getBoundingClientRect().width;
  localStorage.setItem(state.panelLayoutKey, JSON.stringify({
    input: Math.round(inputWidth),
    reasoning: Math.round(reasoningWidth)
  }));
}

function restorePanelLayout() {
  const stored = localStorage.getItem(state.panelLayoutKey);
  if (!stored) {
    return;
  }
  try {
    const layout = JSON.parse(stored);
    if (Number.isFinite(layout.input) && Number.isFinite(layout.reasoning)) {
      applyPanelWidths(layout.input, layout.reasoning);
    }
  } catch {
    localStorage.removeItem(state.panelLayoutKey);
  }
}

function initPanelResizers() {
  restorePanelLayout();
  window.addEventListener("resize", restorePanelLayout);

  elements.columnResizers.forEach((resizer) => {
    resizer.addEventListener("pointerdown", (event) => {
      if (!isDesktopLayout()) {
        return;
      }
      event.preventDefault();
      const mode = resizer.dataset.columnResizer;
      const startX = event.clientX;
      const startInput = elements.inputPanel.getBoundingClientRect().width;
      const startReasoning = elements.reasoningPanel.getBoundingClientRect().width;
      const startResult = elements.resultPanel.getBoundingClientRect().width;
      const inputReasoningTotal = startInput + startReasoning;
      const reasoningResultTotal = startReasoning + startResult;

      resizer.classList.add("dragging");
      document.body.classList.add("resizing-layout");

      const onPointerMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        if (mode === "input-reasoning") {
          const nextInput = clampNumber(
            startInput + delta,
            PANEL_MIN_WIDTHS.input,
            inputReasoningTotal - PANEL_MIN_WIDTHS.reasoning
          );
          applyPanelWidths(nextInput, inputReasoningTotal - nextInput);
          return;
        }

        const nextReasoning = clampNumber(
          startReasoning + delta,
          PANEL_MIN_WIDTHS.reasoning,
          reasoningResultTotal - PANEL_MIN_WIDTHS.result
        );
        applyPanelWidths(startInput, nextReasoning);
      };

      const onPointerUp = () => {
        resizer.classList.remove("dragging");
        document.body.classList.remove("resizing-layout");
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        savePanelLayout();
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    });
  });
}

function saveInputHeights() {
  const heights = {};
  elements.inputHeightSections.forEach((section) => {
    if (section.classList.contains("is-collapsed")) {
      return;
    }
    const key = section.dataset.inputHeight;
    if (!key) {
      return;
    }
    const height = Math.round(section.getBoundingClientRect().height);
    if (height >= 40) {
      heights[key] = height;
    }
  });
  localStorage.setItem(state.inputHeightsKey, JSON.stringify(heights));
}

function restoreInputHeights() {
  const stored = localStorage.getItem(state.inputHeightsKey);
  if (!stored) {
    return;
  }
  try {
    const heights = JSON.parse(stored);
    elements.inputHeightSections.forEach((section) => {
      const key = section.dataset.inputHeight;
      const height = heights && Number(heights[key]);
      if (Number.isFinite(height) && height >= 40) {
        section.style.height = `${Math.round(height)}px`;
      }
    });
  } catch {
    localStorage.removeItem(state.inputHeightsKey);
  }
}

function initInputHeightPersistence() {
  restoreInputHeights();
  if (typeof ResizeObserver !== "function") {
    return;
  }

  let saveTimer = null;
  const observer = new ResizeObserver(() => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveInputHeights, 250);
  });
  elements.inputHeightSections.forEach((section) => observer.observe(section));
}

function collapsedSectionKeys() {
  const stored = localStorage.getItem(state.collapsedSectionsKey);
  if (!stored) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((value) => typeof value === "string" && value));
  } catch {
    localStorage.removeItem(state.collapsedSectionsKey);
    return new Set();
  }
}

function saveCollapsedSections() {
  const collapsed = [];
  elements.collapseButtons.forEach((button) => {
    const key = button.dataset.sectionCollapse;
    if (!key) {
      return;
    }
    const section = document.querySelector(`[data-collapsible-section="${key}"]`);
    if (section && section.classList.contains("is-collapsed")) {
      collapsed.push(key);
    }
  });
  localStorage.setItem(state.collapsedSectionsKey, JSON.stringify(collapsed));
}

function setSectionCollapsed(key, collapsed, persist = true) {
  const section = document.querySelector(`[data-collapsible-section="${key}"]`);
  const button = document.querySelector(`[data-section-collapse="${key}"]`);
  if (!section || !button) {
    return;
  }

  const label = button.dataset.collapseLabel || "区域";
  section.classList.toggle("is-collapsed", collapsed);
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");
  button.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}${label}`);
  button.title = `${collapsed ? "展开" : "折叠"}${label}`;

  if (persist) {
    saveCollapsedSections();
  }
}

function initSectionCollapseButtons() {
  const collapsedKeys = collapsedSectionKeys();
  elements.collapseButtons.forEach((button) => {
    const key = button.dataset.sectionCollapse;
    if (!key) {
      return;
    }
    setSectionCollapsed(key, collapsedKeys.has(key), false);
    button.addEventListener("click", () => {
      const section = document.querySelector(`[data-collapsible-section="${key}"]`);
      if (!section) {
        return;
      }
      setSectionCollapsed(key, !section.classList.contains("is-collapsed"));
    });
  });
  saveCollapsedSections();
}

function autoModelForReasoning(reasoningEffort) {
  const effort = knownReasoningEffort(reasoningEffort || "default");
  const configured = state.autoModelMap && (state.autoModelMap[effort] || state.autoModelMap.default);
  if (configured && typeof configured === "object") {
    return String(configured.id || configured.model || "").trim();
  }
  return String(configured || "").trim();
}

function selectedModelChoice(reasoningEffort) {
  const selected = elements.modelSelect.value;
  if (selected === "__auto__") {
    return {
      model: autoModelForReasoning(reasoningEffort),
      requestedModel: "",
      modelMode: "auto"
    };
  }
  if (selected === "__configured__" || !selected) {
    return { model: "", requestedModel: "", modelMode: "configured" };
  }
  if (selected === "__custom__") {
    const model = elements.modelInput.value.trim();
    return { model, requestedModel: model, modelMode: "custom" };
  }
  return { model: selected, requestedModel: selected, modelMode: "explicit" };
}

function selectedModelValue(reasoningEffort) {
  return selectedModelChoice(reasoningEffort).model;
}

function setCustomModelVisibility() {
  const custom = elements.modelSelect.value === "__custom__";
  elements.modelInput.classList.toggle("visible", custom);
  elements.modelInput.disabled = state.running || !custom;
}

function optionExists(select, value) {
  return Array.from(select.options).some((option) => option.value === value);
}

function renderAgentOptions(profiles) {
  if (!elements.agentSelect || !Array.isArray(profiles) || !profiles.length) {
    return;
  }
  const previous = elements.agentSelect.value || state.agentProfile || "auto";
  elements.agentSelect.textContent = "";
  for (const profile of profiles) {
    const id = String(profile.id || "").trim();
    if (!AGENT_LABELS[id]) {
      continue;
    }
    const option = document.createElement("option");
    option.value = id;
    option.textContent = profile.label || AGENT_LABELS[id];
    option.title = profile.description || "";
    elements.agentSelect.append(option);
  }
  elements.agentSelect.value = AGENT_LABELS[previous] ? previous : "auto";
  state.agentProfile = elements.agentSelect.value || "auto";
}

function appendModelOption(value, label, source) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.title = value === "__auto__"
    ? "根据本次实际推理强度自动选择匹配模型"
    : value === "__configured__"
      ? "使用本机 Codex 配置文件里的默认模型"
    : value === "__custom__"
      ? "手动输入模型 ID"
    : value
      ? `使用模型: ${value}`
      : "使用本机 Codex 配置文件里的默认模型";
  if (source) {
    option.dataset.source = source;
  }
  elements.modelSelect.append(option);
}

function renderModelOptions(data) {
  const configuredModel = data.configuredModel || "";
  const models = Array.isArray(data.models) ? data.models : [];
  const configuredMissing = Boolean(configuredModel && data.source === "provider" && data.configuredModelAvailable === false);
  if (data.autoModelMap && typeof data.autoModelMap === "object") {
    state.autoModelMap = { ...data.autoModelMap };
  }
  const storedSelection = localStorage.getItem(state.lastModelKey);
  const previousSelection = storedSelection == null || storedSelection === ""
    ? "__auto__"
    : storedSelection;
  const customModel = localStorage.getItem(state.customModelKey) || elements.modelInput.value || "";

  elements.modelSelect.textContent = "";
  appendModelOption("__auto__", "自动匹配推理强度", "auto");
  appendModelOption(
    "__configured__",
    configuredModel
      ? `默认配置 (${configuredModel}${configuredMissing ? "，provider未返回" : ""})`
      : "默认配置",
    "default"
  );

  for (const model of models) {
    const id = typeof model === "string" ? model : model.id;
    if (!id || optionExists(elements.modelSelect, id)) {
      continue;
    }
    const marker = id === configuredModel ? "（当前配置）" : "";
    appendModelOption(id, `${id}${marker}`, model.source || "provider");
  }
  appendModelOption("__custom__", "自定义模型...", "custom");

  if (previousSelection === "__auto__") {
    elements.modelSelect.value = "__auto__";
  } else if (previousSelection === "__custom__") {
    elements.modelSelect.value = "__custom__";
    elements.modelInput.value = customModel;
  } else if (previousSelection === "__configured__") {
    elements.modelSelect.value = "__configured__";
  } else if (previousSelection && optionExists(elements.modelSelect, previousSelection)) {
    elements.modelSelect.value = previousSelection;
  } else if (previousSelection) {
    elements.modelSelect.value = "__custom__";
    elements.modelInput.value = previousSelection;
  } else {
    elements.modelSelect.value = "";
    elements.modelInput.value = customModel;
  }

  setCustomModelVisibility();
  const countText = models.length ? `${models.length} 个模型` : "使用默认配置";
  const sourceText = data.source === "provider" ? "provider" : "本地配置";
  const warningText = configuredMissing ? ` | 默认模型 ${configuredModel} 未在provider列表` : "";
  elements.modelStatus.textContent = data.error
    ? `${countText} | ${sourceText} | 列表未完全读取${warningText}`
    : `${countText} | ${sourceText}${warningText}`;
  elements.modelStatus.title = [
    data.error || "",
    configuredMissing ? `当前默认模型 ${configuredModel} 不在 ${data.modelsUrl || "provider"} 返回列表中，建议切换到 provider 列表里的模型。` : ""
  ].filter(Boolean).join("\n");
}

async function refreshModelOptions() {
  elements.modelStatus.textContent = "读取中";
  const response = await fetch("/api/models");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "模型列表读取失败");
  }
  renderModelOptions(data);
}

function trimText(text, maxLength = 10000) {
  const value = text == null ? "" : String(text);
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n\n[内容过长，已截断]`;
}

function compactRaw(raw) {
  if (raw == null) {
    return null;
  }
  let text = "";
  try {
    text = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch {
    return { truncated: true, text: "[原始事件无法序列化]" };
  }
  if (text.length > LIVE_RAW_TEXT_LIMIT) {
    return { truncated: true, text: trimText(text, LIVE_RAW_TEXT_LIMIT) };
  }
  return raw;
}

function compactStoredEvent(kind, title, text, raw) {
  return {
    kind: String(kind || "event").slice(0, 32),
    title: String(title || "事件").slice(0, 120),
    text: trimText(text || "", 30000),
    at: new Date().toISOString(),
    raw: compactRaw(raw)
  };
}

function trimLiveBuffers(texts, events) {
  while (texts.length > LIVE_EVENT_LIMIT) {
    texts.shift();
  }
  while (events.length > LIVE_EVENT_LIMIT) {
    events.shift();
  }

  let textChars = texts.reduce((total, item) => total + String(item || "").length, 0);
  while (textChars > LIVE_EVENT_TEXT_LIMIT && texts.length > 1) {
    textChars -= String(texts.shift() || "").length;
    if (events.length > 1) {
      events.shift();
    }
  }
}

function trimLogEntries(container) {
  while (container.children.length > LIVE_LOG_ENTRY_LIMIT) {
    container.firstElementChild.remove();
  }
}

function appendEntry(container, kind, title, text, raw) {
  const item = document.createElement("article");
  item.className = `log-item ${kind}`;

  const top = document.createElement("div");
  top.className = "log-top";

  const kindEl = document.createElement("span");
  kindEl.className = "log-kind";
  kindEl.textContent = title;

  const timeEl = document.createElement("span");
  timeEl.textContent = nowTime();

  top.append(kindEl, timeEl);
  item.append(top);

  const pre = document.createElement("pre");
  pre.textContent = trimText(text || "", 30000);
  item.append(pre);

  const displayRaw = compactRaw(raw);
  if (displayRaw) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const rawPre = document.createElement("pre");
    summary.textContent = "原始事件";
    rawPre.textContent = typeof displayRaw === "string" ? displayRaw : JSON.stringify(displayRaw, null, 2);
    details.append(summary, rawPre);
    item.append(details);
  }

  container.append(item);
  trimLogEntries(container);
  container.scrollTop = container.scrollHeight;
}

function appendReasoning(kind, title, text, raw, store = true) {
  appendEntry(elements.reasoningLog, kind, title, text, raw);
  if (!store || kind === "heartbeat") {
    return;
  }
  const savedText = text ? `[${title}] ${text}` : `[${title}]`;
  state.reasoningTexts.push(trimText(savedText, LIVE_SINGLE_TEXT_LIMIT));
  state.reasoningEvents.push(compactStoredEvent(kind, title, text, raw));
  trimLiveBuffers(state.reasoningTexts, state.reasoningEvents);
}

function appendResult(kind, title, text, raw, store = true) {
  const empty = elements.resultLog.querySelector(".empty-result");
  if (empty) {
    empty.remove();
  }
  appendEntry(elements.resultLog, kind, title, text, raw);
  if (!store) {
    return;
  }
  state.resultTexts.push(trimText(text || "", LIVE_SINGLE_TEXT_LIMIT));
  state.resultEvents.push(compactStoredEvent(kind, title, text, raw));
  trimLiveBuffers(state.resultTexts, state.resultEvents);
}

function recoverResultFromReasoningEvents() {
  if (state.resultTexts.length) {
    return false;
  }
  const recovered = state.reasoningEvents
    .filter((event) => event.raw && isResultEvent(event.raw))
    .map((event) => ({
      title: "模型回答",
      text: findText(event.raw),
      raw: event.raw
    }))
    .filter((event) => event.text);

  for (const event of recovered) {
    appendResult("result", event.title, event.text, event.raw);
  }
  return recovered.length > 0;
}

function rememberRunError(text) {
  const value = String(text || "").trim();
  if (!value) {
    return;
  }
  if (!state.runErrorTexts.includes(value)) {
    state.runErrorTexts.push(value);
  }
}

function runErrorSummary() {
  return state.runErrorTexts
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n\n");
}

function currentProviderConfig() {
  return (state.currentRun && state.currentRun.provider) || state.codexConfig || {};
}

function providerEndpointText(config = currentProviderConfig()) {
  const baseUrl = String(config.baseUrl || "").trim();
  const wireApi = String(config.wireApi || "").trim();
  if (!baseUrl) {
    return "";
  }
  const endpoint = wireApi && !baseUrl.toLowerCase().endsWith(`/${wireApi.toLowerCase()}`)
    ? `${baseUrl.replace(/\/+$/, "")}/${wireApi}`
    : baseUrl;
  return endpoint;
}

function lastRunErrorLines(limit = 6) {
  return state.runErrorTexts
    .slice(-limit)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function classifyRunFailure(errorText, exitData = {}) {
  const text = String(errorText || "").trim();
  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();
  const reconnectCount = (text.match(/reconnecting\.\.\./gi) || []).length;
  const providerConfig = currentProviderConfig();
  const endpoint = providerEndpointText(providerConfig);
  const proxyEndpoint = state.currentRun ? String(state.currentRun.providerProxyBaseUrl || "").trim() : "";
  const urlMatch = text.match(/https?:\/\/[^\s)]+/i);
  const errorUrl = urlMatch ? urlMatch[0] : "";
  const isResponsesStreamFailure = (
    lower.includes("stream disconnected before completion") ||
    lower.includes("error sending request for url") ||
    lower.includes("/v1/responses") ||
    reconnectCount > 0
  );

  if (isResponsesStreamFailure) {
    const details = [
      "模型服务连接中断，未得到最终结果。",
      "本地客户端和 Codex 进程已经启动，但连接模型接口时断流；这不是 CODESYS/Python 执行结果不确定。",
      `退出状态: ${exitData.code == null ? exitData.signal || "-" : exitData.code}`,
      `模型服务: ${endpoint || errorUrl || "未读取到"}`,
      proxyEndpoint ? `模型代理: ${proxyEndpoint}` : "",
      providerConfig.modelProvider ? `Provider: ${providerConfig.modelProvider}` : "",
      providerConfig.model ? `配置模型: ${providerConfig.model}` : "",
      reconnectCount ? `已重连 ${reconnectCount} 次后失败。` : "",
      exitData.providerRetryCount ? `客户端自动重试 ${exitData.providerRetryCount} 次后仍未得到最终结果。` : "",
      "",
      "最后错误输出:",
      ...lastRunErrorLines()
    ].filter((line) => line !== "");

    return {
      kind: "provider-stream",
      status: "模型服务中断",
      title: "模型服务连接中断",
      text: details.join("\n")
    };
  }

  return {
    kind: "error",
    status: "运行错误",
    title: "运行错误",
    text
  };
}

function resetRunBuffers(options = {}) {
  elements.reasoningLog.textContent = "";
  if (options.preserveResultLog !== true) {
    elements.resultLog.innerHTML = '<div class="empty-result">正在等待 Codex 输出最终结果。</div>';
    delete elements.resultLog.dataset.historyId;
  }
  state.resultTexts = [];
  state.resultEvents = [];
  state.reasoningTexts = [];
  state.reasoningEvents = [];
  state.runErrorTexts = [];
}

function prepareContinuationResultLog(record) {
  const historyId = String(record && record.id || "");
  if (historyId && elements.resultLog.dataset.historyId === historyId) {
    return true;
  }

  elements.resultLog.innerHTML = "";
  appendResult(
    "continue-history",
    "之前的模型回答（已保留）",
    continuationAnswerText(record) || "上一轮没有保存模型回答。",
    null,
    false
  );
  if (historyId) {
    elements.resultLog.dataset.historyId = historyId;
  } else {
    delete elements.resultLog.dataset.historyId;
  }
  return false;
}

function findText(value, depth = 0) {
  if (depth > 6 || value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => findText(item, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") {
    return "";
  }

  if (value.item && typeof value.item === "object") {
    const itemText = findText(value.item, depth + 1);
    if (itemText) {
      return itemText;
    }
  }

  const preferredKeys = [
    "text",
    "delta",
    "message",
    "content",
    "output_text",
    "final_answer",
    "answer",
    "summary",
    "command",
    "cmd",
    "error"
  ];

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const found = findText(value[key], depth + 1);
      if (found) {
        return found;
      }
    }
  }

  for (const child of Object.values(value)) {
    const found = findText(child, depth + 1);
    if (found) {
      return found;
    }
  }

  return "";
}

function eventType(data) {
  return String(data.type || data.event || data.kind || data.name || "codex");
}

function itemType(data) {
  return String(data && data.item && data.item.type ? data.item.type : "").toLowerCase();
}

function eventLabel(type) {
  const lower = String(type || "").toLowerCase();
  if (lower.includes("reasoning") || lower.includes("thinking")) {
    return "推理摘要";
  }
  if (lower.includes("plan")) {
    return "计划更新";
  }
  if (lower.includes("exec") || lower.includes("command") || lower.includes("cmd")) {
    return "命令执行";
  }
  if (lower.includes("tool")) {
    return "工具调用";
  }
  if (lower.includes("patch") || lower.includes("file")) {
    return "文件修改";
  }
  if (lower.includes("stderr") || lower.includes("error")) {
    return "错误";
  }
  if (lower.includes("message") || lower.includes("assistant")) {
    return "消息";
  }
  return type || "Codex 事件";
}

function isResultEvent(data) {
  const type = eventType(data).toLowerCase();
  const itemKind = itemType(data);
  if (type.includes("final") || type.includes("assistant") || type.includes("agent_message")) {
    return true;
  }
  if (type.includes("output_text") && (type.includes("done") || type.includes("completed"))) {
    return true;
  }
  if (data.final_answer || data.answer) {
    return true;
  }
  if (itemKind === "message" || itemKind === "agent_message") {
    return true;
  }
  return false;
}

function isErrorEvent(data) {
  const type = eventType(data).toLowerCase();
  const itemKind = itemType(data);
  return type.includes("error") || type.includes("failed") || itemKind === "error";
}

function readableCodexEvent(data) {
  const type = eventType(data);
  const itemKind = itemType(data);
  const sourceType = itemKind || type;
  const label = itemKind === "agent_message" ? "模型回答" : eventLabel(sourceType);
  const text = findText(data);
  const title = label === sourceType ? sourceType : `${label} (${sourceType})`;
  if (text) {
    return { title, text };
  }
  return { title, text: JSON.stringify(data, null, 2) };
}

async function requestMcpStatus() {
  const response = await fetch("/api/mcp");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "MCP 状态读取失败");
  }
  return data;
}

function restoreMcpSelection() {
  const stored = localStorage.getItem(state.lastMcpKey);
  if (!stored) {
    return null;
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function persistMcpSelection() {
  localStorage.setItem(state.lastMcpKey, JSON.stringify(selectedMcpTools()));
}

function applyMcpStatus(mcpStatus) {
  state.mcpStatus = mcpStatus;
  const integrations = Array.isArray(mcpStatus.integrations) ? mcpStatus.integrations : [];
  const storedSelection = restoreMcpSelection();
  const availableNames = integrations.filter((item) => item.available).map((item) => item.name);
  const selected = new Set(storedSelection || availableNames);
  const toggleByName = {
    codesys: elements.codesysMcpToggle,
    autocad: elements.autocadMcpToggle
  };

  for (const item of integrations) {
    const toggle = toggleByName[item.name];
    if (!toggle) {
      continue;
    }
    toggle.dataset.available = item.available ? "1" : "0";
    toggle.disabled = state.running || !item.available;
    toggle.checked = item.available && selected.has(item.name);
    const label = toggle.closest(".mcp-tile");
    if (label) {
      label.classList.toggle("unavailable", !item.available);
      label.title = item.available
        ? `启用 ${item.label} MCP 工具，供 Codex 在推理中调用`
        : `${item.label} MCP 工具未安装或入口不存在`;
    }
  }

  const availableText = integrations
    .map((item) => `${item.label}${item.available ? "" : " 未找到"}`)
    .join(" | ");
  const activeText = mcpToolsText(selectedMcpTools());
  elements.mcpStatus.textContent = `${availableText || "无 MCP 配置"} | 本次: ${activeText}`;
}

async function refreshMcpStatus() {
  try {
    applyMcpStatus(await requestMcpStatus());
  } catch (error) {
    elements.mcpStatus.textContent = error.message;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function selectedCodesysProjectPath() {
  return elements.codesysProjectSelect ? elements.codesysProjectSelect.value.trim() : "";
}

function isCodesysProjectFilePath(value) {
  return /\.project$/i.test(String(value || "").trim());
}

function persistCodesysPaths() {
  if (!elements.codesysProjectDirectory) {
    return;
  }
  localStorage.setItem(state.codesysProjectDirectoryKey, elements.codesysProjectDirectory.value.trim());
  const projectPath = selectedCodesysProjectPath();
  if (projectPath) {
    localStorage.setItem(state.codesysProjectKey, projectPath);
  }
  localStorage.setItem(state.codesysExportKey, elements.codesysExportPath.value.trim());
  localStorage.setItem(state.codesysSaveAsKey, elements.codesysSaveAsPath.value.trim());
  if (elements.codesysGitRoot) {
    localStorage.setItem(state.codesysGitRootKey, elements.codesysGitRoot.value.trim());
  }
  if (elements.codesysGitCommitMessage) {
    localStorage.setItem(state.codesysGitCommitKey, elements.codesysGitCommitMessage.value.trim());
  }
  if (elements.codesysGitIncludeTarget) {
    localStorage.setItem(state.codesysGitIncludeTargetKey, elements.codesysGitIncludeTarget.checked ? "1" : "0");
  }
}

function codesysBasePayload() {
  persistCodesysPaths();
  return {
    projectDirectory: elements.codesysProjectDirectory.value.trim(),
    projectPath: selectedCodesysProjectPath(),
    exportPath: elements.codesysExportPath.value.trim(),
    saveAsPath: elements.codesysSaveAsPath.value.trim(),
    gitRoot: elements.codesysGitRoot ? elements.codesysGitRoot.value.trim() : "",
    mode: elements.codesysBuildMode.value || "rebuild"
  };
}

function requireCodesysEditorText(actionLabel) {
  const text = elements.codesysExportText.value;
  if (!text.trim()) {
    throw new Error(`${actionLabel}失败：PLCopenXML 文本为空。请先点击“从 project 重导”生成 XML，或粘贴完整 XML 后再操作。`);
  }
  return text;
}

function parentPath(filePath) {
  const text = String(filePath || "").trim();
  const slashIndex = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"));
  return slashIndex > 0 ? text.slice(0, slashIndex) : text;
}

function normalizeLocalPathForCompare(value) {
  return String(value || "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/g, "");
}

function commonLocalAncestor(paths) {
  const normalized = paths
    .map((item) => normalizeLocalPathForCompare(item))
    .filter(Boolean);
  if (normalized.length < 2) {
    return normalized[0] || "";
  }

  const splitPaths = normalized.map((item) => item.split("\\").filter(Boolean));
  const drive = splitPaths[0][0] || "";
  if (!drive || !splitPaths.every((parts) => parts[0].toLowerCase() === drive.toLowerCase())) {
    return normalized[0] || "";
  }

  const commonParts = [];
  for (let index = 0; index < splitPaths[0].length; index += 1) {
    const part = splitPaths[0][index];
    if (!splitPaths.every((parts) => String(parts[index] || "").toLowerCase() === part.toLowerCase())) {
      break;
    }
    commonParts.push(part);
  }

  if (commonParts.length <= 1) {
    return normalized[0] || "";
  }
  return commonParts.join("\\");
}

function deriveWorkspace() {
  const selectedWorkspace = elements.workspaceInput ? elements.workspaceInput.value.trim() : "";
  if (selectedWorkspace) {
    return selectedWorkspace;
  }
  const engineeringRoots = [
    elements.plcPythonRoot ? elements.plcPythonRoot.value.trim() : "",
    elements.pythonGitRoot ? elements.pythonGitRoot.value.trim() : "",
    elements.codesysGitRoot ? elements.codesysGitRoot.value.trim() : "",
    elements.codesysProjectDirectory ? elements.codesysProjectDirectory.value.trim() : ""
  ].filter(Boolean);
  const sharedRoot = commonLocalAncestor(engineeringRoots);
  if (sharedRoot) {
    return sharedRoot;
  }
  const candidates = [
    ...engineeringRoots,
    selectedWorkspace
  ].filter(Boolean);
  return candidates[0] || "";
}

function persistWorkspace() {
  const workspace = elements.workspaceInput ? elements.workspaceInput.value.trim() : "";
  if (workspace) {
    localStorage.setItem(state.lastWorkspaceKey, workspace);
  }
  return workspace;
}

function persistPythonGitSettings() {
  if (elements.pythonGitRoot) {
    localStorage.setItem(state.pythonGitRootKey, elements.pythonGitRoot.value.trim());
  }
  if (elements.pythonGitPaths) {
    localStorage.setItem(state.pythonGitPathsKey, elements.pythonGitPaths.value.trim());
  }
  if (elements.pythonGitCommitMessage) {
    localStorage.setItem(state.pythonGitCommitKey, elements.pythonGitCommitMessage.value.trim());
  }
}

function pythonGitPayload() {
  persistPythonGitSettings();
  const syncPaths = elements.pythonGitPaths.value
    .split(/[\r\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    gitRoot: elements.pythonGitRoot.value.trim(),
    syncPaths,
    commitMessage: elements.pythonGitCommitMessage.value.trim()
  };
}

function persistPlcLinkSettings() {
  if (elements.plcPythonRoot) {
    localStorage.setItem(state.plcPythonRootKey, elements.plcPythonRoot.value.trim());
  }
  if (elements.plcPythonLocalIp) {
    localStorage.setItem(state.plcPythonLocalIpKey, elements.plcPythonLocalIp.value.trim());
  }
  if (elements.plcPythonScript) {
    localStorage.setItem(state.plcPythonScriptKey, elements.plcPythonScript.value.trim());
  }
  if (elements.plcRegisterMap) {
    localStorage.setItem(state.plcRegisterMapKey, elements.plcRegisterMap.value.trim());
  }
  if (elements.plcDeviceName) {
    localStorage.setItem(state.plcDeviceKey, elements.plcDeviceName.value.trim());
  }
  if (elements.pythonCodePath) {
    localStorage.setItem(state.pythonCodePathKey, elements.pythonCodePath.value.trim());
  }
  if (elements.pythonRunArgs) {
    localStorage.setItem(state.pythonRunArgsKey, elements.pythonRunArgs.value.trim());
  }
}

function plcLinkPayload(options = {}) {
  persistCodesysPaths();
  persistPlcLinkSettings();
  const payload = {
    ...codesysBasePayload(),
    pythonRoot: elements.plcPythonRoot.value.trim(),
    localIp: elements.plcPythonLocalIp.value.trim(),
    pythonScript: elements.plcPythonScript.value.trim(),
    registerMap: elements.plcRegisterMap.value.trim(),
    deviceName: elements.plcDeviceName.value.trim()
  };
  if (options.includeCodesysText !== false && elements.codesysExportText.value.trim()) {
    payload.codesysText = elements.codesysExportText.value;
  }
  return payload;
}

function pythonFilePayload(options = {}) {
  persistPlcLinkSettings();
  return {
    pythonRoot: elements.plcPythonRoot.value.trim(),
    localIp: elements.plcPythonLocalIp.value.trim(),
    filePath: elements.pythonCodePath.value.trim() || elements.plcPythonScript.value.trim(),
    pythonScript: elements.pythonCodePath.value.trim() || elements.plcPythonScript.value.trim(),
    args: elements.pythonRunArgs.value.trim(),
    text: options.includeText ? elements.pythonCodeText.value : undefined,
    saveText: options.saveText === true
  };
}

async function saveCurrentPythonEditorForPlc() {
  if (!elements.pythonCodeText || !elements.pythonCodeText.value.trim()) {
    return null;
  }
  const saved = await pythonSaveFile({ silent: true });
  if (saved.filePath) {
    elements.pythonCodePath.value = saved.filePath;
    elements.plcPythonScript.value = saved.filePath;
    persistPlcLinkSettings();
  }
  return saved;
}

function currentPythonCommandPayload(options = {}) {
  const payload = plcLinkPayload(options);
  if (elements.pythonCodePath.value.trim()) {
    payload.pythonScript = elements.pythonCodePath.value.trim();
  }
  payload.forcePythonCommand = true;
  return payload;
}

function formatCommandList(commands) {
  return (commands || []).map((item) => {
    const safety = item.safetyText || (item.safe ? "只读/安全" : "会写 PLC，执行前确认现场安全");
    const detail = item.detail ? `\n  ${String(item.detail).replace(/\n/g, "\n  ")}` : "";
    return `${item.label} (${safety})\n  cwd: ${item.cwd || ""}\n  ${item.command}${detail}`;
  }).join("\n\n");
}

function plcLinkSummary(action, data) {
  const lines = [
    `${action}: ${data.ok ? "完成" : "有问题"}`,
    `CODESYS工程: ${data.projectPath || ""}`,
    `Python仓库: ${data.pythonRoot || ""}`,
    `Python脚本: ${data.pythonScript || ""}`,
    `Python本机IP: ${data.localIp || ""}`,
    `寄存器表: ${data.registerMapPath || ""}`
  ];
  if (data.device) {
    lines.push(`设备: ${data.device.deviceName || ""}${data.device.address ? ` | ${data.device.address}` : ""}`);
  }
  if (data.pythonSurface) {
    const surface = data.pythonSurface;
    const getKeys = Array.isArray(surface.getKeys) ? surface.getKeys.map((item) => item.key).join(", ") : "";
    const setKeys = Array.isArray(surface.setKeys) ? surface.setKeys.map((item) => item.key).join(", ") : "";
    const modbusCount = Array.isArray(surface.modbusCalls) ? surface.modbusCalls.length : 0;
    lines.push(`当前Python识别: ${surface.primaryClass || "未识别控制类"} | 只读: ${getKeys || "无"} | 写入: ${setKeys || "无"} | Modbus调用: ${modbusCount}`);
  }
  if (Array.isArray(data.checks) && data.checks.length) {
    lines.push(`检查: ${data.checks.filter((check) => check.ok).length}/${data.checks.length} 通过`);
    data.checks.forEach((check) => {
      lines.push(`${check.ok ? "OK" : check.severity === "warning" ? "提示" : "问题"} ${check.label}: ${check.detail || ""}`);
    });
  }
  if (data.saved) {
    lines.push(`已生成寄存器表: ${data.registerMapPath}`);
  }
  if (data.generatedRegisterMap) {
    lines.push("", "[自动生成寄存器表预览]", data.generatedRegisterMap);
  }
  if (data.commandSource) {
    lines.push(`命令来源: ${data.commandSource}`);
  }
  if (data.commandMemoryError) {
    lines.push(`命令生成提示: ${data.commandMemoryError}`);
  }
  if (Array.isArray(data.commands) && data.commands.length) {
    lines.push("", "[验证命令]", formatCommandList(data.commands));
  }
  if (data.stdout || data.stderr || data.error) {
    lines.push("", "[Python输出]", data.stdout || "");
    if (data.stderr) {
      lines.push("", "[错误输出]", data.stderr);
    }
    if (data.error) {
      lines.push("", `[错误] ${data.error}`);
    }
  }
  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function setPlcLinkOutput(text) {
  if (elements.plcLinkOutput) {
    elements.plcLinkOutput.value = text || "";
  }
}

function setPythonCodeStatus(text) {
  if (elements.pythonCodeStatus) {
    elements.pythonCodeStatus.textContent = text;
  }
}

function setLocalIpStatus(value, info = null) {
  if (!elements.plcLocalIpStatus) {
    return;
  }
  const address = String(value || "").trim();
  const adapter = info && info.name ? ` | ${info.name}` : "";
  const isManual = info && info.source === "manual";
  elements.plcLocalIpStatus.textContent = address ? `${address}${adapter}` : "未识别";
  elements.plcLocalIpStatus.title = address
    ? (isManual ? "当前使用手动配置的本机以太网 IPv4 地址" : "当前客户端识别到的本机 IPv4 地址")
    : "未识别到本机以太网 IPv4 地址，可在 Python本机IP 输入框中手动填写";
}

function updatePythonEditHistoryControls() {
  const blocked = state.running || state.plcLinkBusy || !elements.pythonCodeText || elements.pythonCodeText.disabled;
  if (elements.pythonUndoButton) {
    elements.pythonUndoButton.disabled = blocked || state.pythonEditUndoStack.length === 0;
  }
  if (elements.pythonRedoButton) {
    elements.pythonRedoButton.disabled = blocked || state.pythonEditRedoStack.length === 0;
  }
}

function trimPythonEditStack(stack) {
  while (stack.length > PYTHON_EDIT_HISTORY_LIMIT) {
    stack.shift();
  }
  let totalChars = stack.reduce((total, item) => total + String(item || "").length, 0);
  while (totalChars > PYTHON_EDIT_HISTORY_CHAR_LIMIT && stack.length > 1) {
    totalChars -= String(stack.shift() || "").length;
  }
}

function setPythonCodeText(text, options = {}) {
  if (!elements.pythonCodeText) {
    return;
  }
  const nextText = String(text || "");
  state.pythonEditApplyingHistory = true;
  elements.pythonCodeText.value = nextText;
  state.pythonEditApplyingHistory = false;
  state.pythonEditLastText = nextText;
  if (options.resetHistory !== false) {
    state.pythonEditUndoStack = [];
    state.pythonEditRedoStack = [];
  }
  updatePythonEditHistoryControls();
}

function recordPythonEditSnapshot() {
  if (!elements.pythonCodeText || state.pythonEditApplyingHistory) {
    return;
  }
  const nextText = elements.pythonCodeText.value;
  if (nextText === state.pythonEditLastText) {
    updatePythonEditHistoryControls();
    return;
  }
  state.pythonEditUndoStack.push(state.pythonEditLastText);
  trimPythonEditStack(state.pythonEditUndoStack);
  state.pythonEditRedoStack = [];
  state.pythonEditLastText = nextText;
  updatePythonEditHistoryControls();
}

function schedulePythonEditSnapshot() {
  if (state.pythonEditApplyingHistory) {
    return;
  }
  if (state.pythonEditRecordTimer) {
    window.clearTimeout(state.pythonEditRecordTimer);
  }
  state.pythonEditRecordTimer = window.setTimeout(recordPythonEditSnapshot, 450);
}

function applyPythonEditHistory(direction) {
  if (!elements.pythonCodeText) {
    return;
  }
  recordPythonEditSnapshot();
  const sourceStack = direction === "redo" ? state.pythonEditRedoStack : state.pythonEditUndoStack;
  const targetStack = direction === "redo" ? state.pythonEditUndoStack : state.pythonEditRedoStack;
  if (!sourceStack.length) {
    updatePythonEditHistoryControls();
    return;
  }
  const currentText = elements.pythonCodeText.value;
  const nextText = sourceStack.pop();
  targetStack.push(currentText);
  trimPythonEditStack(targetStack);
  state.pythonEditApplyingHistory = true;
  elements.pythonCodeText.value = nextText;
  state.pythonEditApplyingHistory = false;
  state.pythonEditLastText = nextText;
  elements.pythonCodeText.focus();
  updatePythonEditHistoryControls();
  setPythonCodeStatus(direction === "redo" ? "已退撤回" : "已撤回");
}

function selectedPythonRoot() {
  return elements.plcPythonRoot.value.trim() || (elements.pythonGitRoot ? elements.pythonGitRoot.value.trim() : "");
}

function setPythonTreeMessage(text, className = "python-tree-empty") {
  if (!elements.pythonRepoTree) {
    return;
  }
  elements.pythonRepoTree.textContent = "";
  const item = document.createElement("div");
  item.className = className;
  item.textContent = text;
  elements.pythonRepoTree.append(item);
}

async function requestPythonTree(dirPath = "") {
  return requestJson("/api/python/list-tree", {
    method: "POST",
    body: JSON.stringify({
      pythonRoot: selectedPythonRoot(),
      path: dirPath
    })
  });
}

function selectPythonTreeFile(entry, row) {
  const filePath = entry.path || "";
  elements.pythonCodePath.value = filePath;
  if (entry.runnable || String(filePath).toLowerCase().endsWith(".py")) {
    elements.plcPythonScript.value = filePath;
  }
  elements.pythonRepoTree.querySelectorAll(".python-tree-row.selected").forEach((item) => {
    item.classList.remove("selected");
  });
  if (row) {
    row.classList.add("selected");
  }
  persistPlcLinkSettings();
  setPythonCodeStatus(`已定位: ${entry.relativePath || entry.name}`);
}

function renderPythonTreeEntries(container, data, options = {}) {
  container.textContent = "";
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "python-tree-empty";
    empty.textContent = "此目录没有可显示文件";
    container.append(empty);
    return;
  }

  for (const entry of entries) {
    const node = document.createElement("div");
    node.className = "python-tree-node";

    const row = document.createElement("button");
    row.type = "button";
    row.className = `python-tree-row ${entry.kind}`;
    row.title = entry.kind === "directory"
      ? `展开目录: ${entry.relativePath || entry.name}`
      : `选择文件: ${entry.relativePath || entry.name}`;
    row.dataset.path = entry.path || "";
    row.dataset.kind = entry.kind || "";

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = entry.kind === "directory" ? ">" : "";

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = entry.name;

    row.append(toggle, name);
    node.append(row);

    if (entry.kind === "directory") {
      const children = document.createElement("div");
      children.className = "python-tree-children";
      children.hidden = true;
      node.append(children);
      row.addEventListener("click", async () => {
        const expanded = row.dataset.expanded === "1";
        if (expanded) {
          row.dataset.expanded = "0";
          toggle.textContent = ">";
          children.hidden = true;
          return;
        }
        row.dataset.expanded = "1";
        toggle.textContent = "v";
        children.hidden = false;
        if (row.dataset.loaded === "1") {
          return;
        }
        children.textContent = "";
        const loading = document.createElement("div");
        loading.className = "python-tree-empty";
        loading.textContent = "读取中...";
        children.append(loading);
        try {
          const childData = await requestPythonTree(entry.path);
          row.dataset.loaded = "1";
          renderPythonTreeEntries(children, childData, { autoSelectSingle: true });
        } catch (error) {
          children.textContent = "";
          const message = document.createElement("div");
          message.className = "python-tree-error";
          message.textContent = error.message;
          children.append(message);
        }
      });
    } else {
      row.addEventListener("click", () => selectPythonTreeFile(entry, row));
    }

    container.append(node);
  }

  if (options.autoSelectSingle) {
    const files = entries.filter((entry) => entry.kind === "file");
    const dirs = entries.filter((entry) => entry.kind === "directory");
    if (files.length === 1 && dirs.length === 0) {
      const fileRow = container.querySelector(".python-tree-row.file");
      selectPythonTreeFile(files[0], fileRow);
    }
  }

  if (data.truncated) {
    const truncated = document.createElement("div");
    truncated.className = "python-tree-empty";
    truncated.textContent = `只显示前 ${entries.length} 项，目录内容共 ${data.total} 项`;
    container.append(truncated);
  }
}

async function refreshPythonRepoTree() {
  if (!elements.pythonRepoTree) {
    return;
  }
  const root = selectedPythonRoot();
  if (!root) {
    setPythonTreeMessage("请先填写 Python仓库路径");
    return;
  }
  setPythonTreeMessage("正在读取 Python 仓库...");
  try {
    const data = await requestPythonTree("");
    renderPythonTreeEntries(elements.pythonRepoTree, data);
    setPythonCodeStatus("文件树已刷新");
  } catch (error) {
    setPythonTreeMessage(error.message, "python-tree-error");
    setPythonCodeStatus(error.message);
  }
}

function codesysResultSummary(action, data) {
  const mcp = data.mcpResult || {};
  const result = data.codesysResult || {};
  const lines = [
    `${action}: ${data.ok ? "完成" : "失败"}`,
    `工程: ${data.projectPath || result.projectPath || ""}`
  ];
  if (data.fast) {
    lines.push("方式: 本地快速文件操作，不启动 CODESYS");
  }
  if (action === "识别工程") {
    lines.push("识别范围: 当前目标 project 文件；PLC 在线运行版本尚未接入");
  }
  if (data.exportDir) {
    lines.push(`导出目录: ${data.exportDir}`);
  }
  if (data.exportPathAdjusted) {
    lines.push(`提示: 已按规则改用 export 子目录，忽略旧XML路径: ${data.requestedExportPath || ""}`);
  }
  if (data.saveAsPathAdjusted) {
    lines.push(`提示: project副本已改用 export 子目录，忽略旧副本路径: ${data.requestedSaveAsPath || ""}`);
  }
  if (data.exportPath || result.exportPath) {
    lines.push(`XML: ${data.exportPath || result.exportPath}`);
  }
  if (data.saveAsPath || result.savedBy) {
    lines.push(`副本: ${data.saveAsPath || result.savedBy || ""}`);
  }
  if (result.activeApplication) {
    lines.push(`应用: ${result.activeApplication}`);
  }
  if (result.objectCount != null) {
    lines.push(`对象数: ${result.objectCount}`);
  }
  if (result.errors != null || result.warnings != null) {
    lines.push(`编译: ${Number(result.errors || 0)} 错误 / ${Number(result.warnings || 0)} 警告`);
  }
  if (data.textBytes != null) {
    lines.push(`文本大小: ${Math.round(Number(data.textBytes || 0) / 1024)} KB`);
  }
  if (data.stale) {
    lines.push("提示: XML 修改时间早于 project，建议点击“从project重导”刷新缓存");
  }
  if (Array.isArray(data.checks) && data.checks.length) {
    const issueCount = Number(data.issueCount || 0);
    lines.push(`静态检查: ${Number(data.passedCheckCount || 0)}/${data.checks.length} 通过${issueCount ? `，${issueCount} 个风险` : ""}`);
    data.checks.slice(0, 8).forEach((check) => {
      lines.push(`${check.ok ? "OK" : "风险"} ${check.label}: ${check.detail || ""}`);
    });
  }
  if (mcp.timedOut) {
    lines.push("CODESYS 调用超时");
  }
  if (mcp.exitCode != null) {
    lines.push(`退出码: ${mcp.exitCode}`);
  }
  if (!data.ok && (result.error || mcp.error)) {
    lines.push(`错误: ${result.error || mcp.error}`);
  }
  return lines.filter(Boolean).join("\n");
}

function renderCodesysResult(action, data) {
  const summary = codesysResultSummary(action, data);
  appendReasoning("codesys", action, summary, data, false);
  appendResult("codesys", action, summary, data, false);
}

async function runCodesysAction(action, statusText, callback) {
  if (state.codesysBusy) {
    return null;
  }
  state.codesysBusy = true;
  updateCodesysControls();
  setCodesysStatus(statusText);
  setStatus(statusText);
  setThinking("CODESYS 正在运行", statusText, true);
  appendReasoning("codesys", "CODESYS 操作", statusText, codesysBasePayload(), false);
  try {
    const data = await callback();
    setCodesysStatus(data.ok ? `${action}完成` : `${action}失败`);
    setStatus(data.ok ? `${action}完成` : `${action}失败`);
    setThinking(data.ok ? "CODESYS 操作完成" : "CODESYS 操作失败", action, false);
    renderCodesysResult(action, data);
    return data;
  } catch (error) {
    setCodesysStatus(error.message);
    setStatus(error.message);
    setThinking("CODESYS 操作失败", error.message, false);
    appendReasoning("codesys-error", action, error.message, null, false);
    appendResult("codesys-error", action, error.message, null, false);
    return null;
  } finally {
    state.codesysBusy = false;
    updateCodesysControls();
  }
}

function codesysGitPayload() {
  const payload = codesysBasePayload();
  payload.commitMessage = elements.codesysGitCommitMessage
    ? elements.codesysGitCommitMessage.value.trim()
    : "";
  payload.includeTarget = elements.codesysGitIncludeTarget
    ? elements.codesysGitIncludeTarget.checked
    : false;
  return payload;
}

function codesysGitResultSummary(action, data) {
  const lines = [
    `${action}: ${data.ok ? "完成" : "失败"}`,
    `仓库: ${data.gitRoot || ""}`,
    `分支: ${data.branch || "未识别"}${data.upstream ? ` -> ${data.upstream}` : ""}`,
    `远端: ${data.remote || "未配置 origin"}`
  ];
  if (data.ahead != null || data.behind != null) {
    lines.push(`同步: ahead ${data.ahead == null ? "?" : data.ahead} / behind ${data.behind == null ? "?" : data.behind}`);
  }
  lines.push(`工作区: ${data.clean ? "干净" : `${Array.isArray(data.changes) ? data.changes.length : "有"} 个修改`}`);
  if (data.committed != null) {
    lines.push(`提交: ${data.committed ? "已提交" : "无新修改"}`);
  }
  if (data.pushed != null) {
    lines.push(`推送: ${data.pushed ? "已推送" : "未推送"}`);
  }
  if (data.stagedPaths && data.stagedPaths.length) {
    lines.push(`同步文件: ${data.stagedPaths.join(", ")}`);
  }
  if (Array.isArray(data.pathWarnings) && data.pathWarnings.length) {
    data.pathWarnings.slice(0, 6).forEach((warning) => {
      lines.push(`提示: ${warning}`);
    });
  }
  if (data.lastCommit) {
    lines.push(`最近提交: ${data.lastCommit} ${data.lastCommitMessage || ""}`.trim());
  }
  if (data.output) {
    lines.push(`Git输出: ${data.output}`);
  }
  if (data.error) {
    lines.push(`错误: ${data.error}`);
  }
  return lines.join("\n");
}

function updateGitStatusText(element, data) {
  if (!element) {
    return;
  }
  if (!data) {
    element.textContent = "未检查";
    return;
  }
  if (data.unchecked) {
    element.textContent = data.error || "未检查 | 点击 Git状态";
    return;
  }
  const syncText = data.ahead != null || data.behind != null
    ? ` | ${data.ahead || 0}待推送/${data.behind || 0}待拉取`
    : "";
  element.textContent = data.ok
    ? `${data.branch || "未识别分支"} | ${data.clean ? "干净" : `${data.changes.length}项修改`}${syncText}`
    : (data.error || "Git未就绪");
}

function updateCodesysGitStatusText(data) {
  updateGitStatusText(elements.codesysGitStatusText, data);
}

function updatePythonGitStatusText(data) {
  updateGitStatusText(elements.pythonGitStatusText, data);
}

async function runCodesysGitAction(action, statusText, callback) {
  if (state.gitBusy) {
    return null;
  }
  state.gitBusy = true;
  updateGitControls();
  setCodesysStatus(statusText);
  setStatus(statusText);
  setThinking("Git 正在运行", statusText, true);
  appendReasoning("git", "Git 操作", statusText, codesysGitPayload(), false);
  try {
    const data = await callback();
    updateCodesysGitStatusText(data);
    setCodesysStatus(data.ok ? `${action}完成` : `${action}失败`);
    setStatus(data.ok ? `${action}完成` : `${action}失败`);
    setThinking(data.ok ? "Git 操作完成" : "Git 操作失败", action, false);
    appendReasoning("git", action, codesysGitResultSummary(action, data), data, false);
    appendResult("git", action, codesysGitResultSummary(action, data), data, false);
    return data;
  } catch (error) {
    updateCodesysGitStatusText({ ok: false, error: error.message });
    setCodesysStatus(error.message);
    setStatus(error.message);
    setThinking("Git 操作失败", error.message, false);
    appendReasoning("git-error", action, error.message, null, false);
    appendResult("git-error", action, error.message, null, false);
    return null;
  } finally {
    state.gitBusy = false;
    updateGitControls();
  }
}

async function runPythonGitAction(action, statusText, callback) {
  if (state.gitBusy) {
    return null;
  }
  state.gitBusy = true;
  updateGitControls();
  setStatus(statusText);
  setThinking("Python Git 正在运行", statusText, true);
  appendReasoning("python-git", "Python Git 操作", statusText, pythonGitPayload(), false);
  try {
    const data = await callback();
    updatePythonGitStatusText(data);
    setStatus(data.ok ? `${action}完成` : `${action}失败`);
    setThinking(data.ok ? "Python Git 操作完成" : "Python Git 操作失败", action, false);
    appendReasoning("python-git", action, codesysGitResultSummary(action, data), data, false);
    appendResult("python-git", action, codesysGitResultSummary(action, data), data, false);
    return data;
  } catch (error) {
    updatePythonGitStatusText({ ok: false, error: error.message });
    setStatus(error.message);
    setThinking("Python Git 操作失败", error.message, false);
    appendReasoning("python-git-error", action, error.message, null, false);
    appendResult("python-git-error", action, error.message, null, false);
    return null;
  } finally {
    state.gitBusy = false;
    updateGitControls();
  }
}

async function pythonGitStatus(options = {}) {
  const request = () => requestJson("/api/python/git/status", {
    method: "POST",
    body: JSON.stringify(pythonGitPayload())
  });
  if (options.silent) {
    try {
      const data = await request();
      updatePythonGitStatusText(data);
      return data;
    } catch (error) {
      updatePythonGitStatusText({ ok: false, error: error.message });
      return null;
    }
  }
  return runPythonGitAction("Python Git状态", "正在读取 Python PLC 控制代码 Git 状态", request);
}

async function pythonGitPull() {
  return runPythonGitAction("Python Git拉取", "正在从 Python 仓库 upstream 快进拉取更新", () => requestJson("/api/python/git/pull", {
    method: "POST",
    body: JSON.stringify(pythonGitPayload())
  }));
}

async function pythonGitSync() {
  return runPythonGitAction("Python Git快速同步", "正在提交并推送 Python PLC 控制代码", () => requestJson("/api/python/git/sync", {
    method: "POST",
    body: JSON.stringify(pythonGitPayload())
  }));
}

async function codesysGitStatus(options = {}) {
  const request = () => requestJson("/api/codesys/git/status", {
    method: "POST",
    body: JSON.stringify(codesysGitPayload())
  });
  if (options.silent) {
    try {
      const data = await request();
      updateCodesysGitStatusText(data);
      return data;
    } catch (error) {
      updateCodesysGitStatusText({ ok: false, error: error.message });
      return null;
    }
  }
  return runCodesysGitAction("Git状态", "正在读取 CODESYS Git 状态", request);
}

async function codesysGitPull() {
  return runCodesysGitAction("Git拉取", "正在从当前 upstream 快进拉取更新", () => requestJson("/api/codesys/git/pull", {
    method: "POST",
    body: JSON.stringify(codesysGitPayload())
  }));
}

async function codesysGitSync() {
  return runCodesysGitAction("Git快速同步", "正在保存 XML 并提交推送当前 CODESYS 文件", async () => {
    if (elements.codesysExportText.value.trim()) {
      await codesysSaveExport({ silent: true });
    }
    return requestJson("/api/codesys/git/sync", {
      method: "POST",
      body: JSON.stringify(codesysGitPayload())
    });
  });
}

async function loadCodesysStatus() {
  if (!elements.codesysProjectDirectory) {
    return;
  }
  try {
    const data = await requestJson("/api/codesys/status");
    const storedProjectValue = localStorage.getItem(state.codesysProjectKey) || "";
    let storedProjectDirectory = localStorage.getItem(state.codesysProjectDirectoryKey) || "";
    let storedProjectPath = isCodesysProjectFilePath(storedProjectValue) ? storedProjectValue : "";
    if (!storedProjectDirectory && storedProjectValue) {
      storedProjectDirectory = storedProjectPath ? parentPath(storedProjectPath) : storedProjectValue;
    }
    if (storedProjectValue && !storedProjectPath) {
      localStorage.removeItem(state.codesysProjectKey);
    }
    if (!storedProjectDirectory) {
      storedProjectDirectory = data.defaultProjectDirectory || parentPath(data.defaultProject || "");
      storedProjectPath = storedProjectPath || data.defaultProject || "";
    }

    elements.codesysProjectDirectory.value = storedProjectDirectory;
    state.codesysProjectDirectorySubmitted = normalizeLocalPathForCompare(storedProjectDirectory).toLowerCase();
    elements.codesysExportPath.value = localStorage.getItem(state.codesysExportKey) || data.defaultExportPath || "";
    elements.codesysSaveAsPath.value = localStorage.getItem(state.codesysSaveAsKey) || data.defaultSaveAsPath || "";
    elements.codesysGitRoot.value = localStorage.getItem(state.codesysGitRootKey) || data.gitRoot || "";
    elements.codesysGitCommitMessage.value = localStorage.getItem(state.codesysGitCommitKey) || "同步 CODESYS 工程和 PLCopenXML";
    elements.codesysGitIncludeTarget.checked = localStorage.getItem(state.codesysGitIncludeTargetKey) === "1";
    updateCodesysGitStatusText(data.gitRepoExists
      ? { unchecked: true, error: "未检查 | 点击 Git状态" }
      : { ok: false, error: "Git仓库不存在" });
    setCodesysStatus(data.ok
      ? `${data.exportFile ? "已有XML缓存" : "未读XML"} | 点击快速读XML`
      : data.error || "CODESYS 未就绪");
    await refreshCodesysProjectList({ silent: true, projectPath: storedProjectPath });
  } catch (error) {
    setCodesysStatus(error.message);
  }
  updateCodesysControls();
}

function setCodesysProjectSwitchStatus(text) {
  if (elements.codesysProjectSwitchStatus) {
    elements.codesysProjectSwitchStatus.textContent = text;
  }
}

function renderCodesysProjectOptions(data) {
  if (!elements.codesysProjectSelect) {
    return;
  }
  const projects = Array.isArray(data.projects) ? data.projects : [];
  elements.codesysProjectSelect.textContent = "";
  if (!projects.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "文件夹内未找到 .project";
    elements.codesysProjectSelect.append(option);
    setCodesysProjectSwitchStatus("0 个工程");
    return;
  }

  const currentProject = String(data.currentProject || "").trim();
  const currentKey = normalizeLocalPathForCompare(currentProject).toLowerCase();
  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.path;
    option.textContent = project.name;
    option.title = project.path;
    option.dataset.exportPath = project.exportPath || "";
    option.dataset.saveAsPath = project.saveAsPath || "";
    elements.codesysProjectSelect.append(option);
    if (project.current || (currentKey && normalizeLocalPathForCompare(project.path).toLowerCase() === currentKey)) {
      elements.codesysProjectSelect.value = project.path;
    }
  }
  if (!elements.codesysProjectSelect.value && projects[0]) {
    elements.codesysProjectSelect.value = projects[0].path;
  }
  setCodesysProjectSwitchStatus(`${projects.length} 个工程`);
}

function applyCodesysProjectScanResult(data, options = {}) {
  if (!data || !elements.codesysProjectDirectory) {
    return;
  }

  const projects = Array.isArray(data.projects) ? data.projects : [];
  if (data.searchRoot) {
    elements.codesysProjectDirectory.value = data.searchRoot;
  }
  state.codesysProjectDirectorySubmitted = normalizeLocalPathForCompare(elements.codesysProjectDirectory.value).toLowerCase();
  const projectPath = selectedCodesysProjectPath();
  const projectKey = normalizeLocalPathForCompare(projectPath).toLowerCase();
  const selectedProject = projects.find((project) => (
    normalizeLocalPathForCompare(project.path).toLowerCase() === projectKey
  )) || projects[0] || null;
  const exportPath = data.currentExportPath || (selectedProject ? selectedProject.exportPath : "");
  const saveAsPath = data.currentSaveAsPath || (selectedProject ? selectedProject.saveAsPath : "");

  if (!projectPath) {
    elements.codesysExportPath.value = "";
    elements.codesysSaveAsPath.value = "";
    elements.codesysExportText.value = "";
    localStorage.removeItem(state.codesysProjectKey);
    persistCodesysPaths();
    setCodesysStatus("工程文件夹内未找到 .project，已清空工程文件选择");
    updateCodesysControls();
    return;
  }

  elements.codesysExportPath.value = exportPath || "";
  elements.codesysSaveAsPath.value = saveAsPath || "";
  if (!exportPath) {
    elements.codesysExportText.value = "";
  }
  persistCodesysPaths();

  const xmlText = exportPath ? "已关联XML" : "未找到XML";
  const rootText = data.searchRoot ? ` | 文件夹: ${data.searchRoot}` : "";
  setCodesysStatus(`${xmlText} | ${projects.length || 1} 个工程文件${rootText}`);
  updateCodesysControls();
  elements.workspaceInput.value = deriveWorkspace() || elements.workspaceInput.value;
}

async function refreshCodesysProjectList(options = {}) {
  if (!elements.codesysProjectSelect) {
    return null;
  }
  const requestId = ++state.codesysProjectScanRequestId;
  if (!options.silent) {
    setCodesysProjectSwitchStatus("读取中");
  }
  try {
    const payload = codesysBasePayload();
    if (Object.prototype.hasOwnProperty.call(options, "projectPath")) {
      payload.projectPath = String(options.projectPath || "").trim();
    }
    const data = await requestJson("/api/codesys/list-projects", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (requestId !== state.codesysProjectScanRequestId) {
      return null;
    }
    renderCodesysProjectOptions(data);
    applyCodesysProjectScanResult(data, options);
    return data;
  } catch (error) {
    if (requestId === state.codesysProjectScanRequestId) {
      setCodesysProjectSwitchStatus(error.message);
    }
    return null;
  }
}

function clearCodesysProjectSelection() {
  elements.codesysProjectSelect.textContent = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "等待读取工程文件";
  elements.codesysProjectSelect.append(option);
  elements.codesysExportPath.value = "";
  elements.codesysSaveAsPath.value = "";
  elements.codesysExportText.value = "";
  localStorage.removeItem(state.codesysProjectKey);
  persistCodesysPaths();
  setCodesysProjectSwitchStatus("待读取");
  updateCodesysControls();
}

function refreshCodesysProjectDirectory() {
  state.codesysProjectDirectorySubmitted = normalizeLocalPathForCompare(elements.codesysProjectDirectory.value).toLowerCase();
  clearCodesysProjectSelection();
  return refreshCodesysProjectList({ silent: false, projectPath: "" });
}

function switchCodesysProjectFromSelect() {
  const option = elements.codesysProjectSelect.selectedOptions[0];
  if (!option || !option.value) {
    return;
  }
  elements.codesysExportPath.value = option.dataset.exportPath || "";
  elements.codesysSaveAsPath.value = option.dataset.saveAsPath || "";
  elements.codesysExportText.value = "";
  persistCodesysPaths();
  setCodesysStatus("已切换工程 | 点击快速读XML");
  setCodesysProjectSwitchStatus("已切换");
  updateCodesysControls();
  elements.workspaceInput.value = deriveWorkspace() || elements.workspaceInput.value;
}

async function codesysReadExportRaw(options = {}) {
  const data = await requestJson("/api/codesys/read-export", {
    method: "POST",
    body: JSON.stringify(codesysBasePayload())
  });
  if (data.exportPath) {
    elements.codesysExportPath.value = data.exportPath;
  }
  if (data.saveAsPath) {
    elements.codesysSaveAsPath.value = data.saveAsPath;
  }
  if (typeof data.text === "string") {
    elements.codesysExportText.value = data.text;
  }
  persistCodesysPaths();
  if (!options.silent) {
    renderCodesysResult("快速读取XML", data);
  }
  return data;
}

async function codesysReadExport(options = {}) {
  if (options.silent) {
    try {
      setCodesysStatus("正在快速读取 XML");
      const data = await codesysReadExportRaw({ silent: true });
      setCodesysStatus(data.stale ? "XML 已读取，可能落后于 project" : "XML 已快速读取");
      return data;
    } catch (error) {
      setCodesysStatus(error.message);
      return null;
    }
  }
  return runCodesysAction("快速读取XML", "正在快速读取本地 PLCopenXML，不启动 CODESYS", () => codesysReadExportRaw({ silent: true }));
}

async function codesysAnalyzeExport() {
  return runCodesysAction("快速检查XML", "正在本地检查 PLCopenXML，不启动 CODESYS", async () => {
    const payload = codesysBasePayload();
    if (elements.codesysExportText.value.trim()) {
      payload.text = elements.codesysExportText.value;
    }
    const data = await requestJson("/api/codesys/analyze-export", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    persistCodesysPaths();
    return data;
  });
}

async function codesysInfo() {
  return runCodesysAction("识别工程", "正在识别 CODESYS 工程", async () => {
    const data = await requestJson("/api/codesys/info", {
      method: "POST",
      body: JSON.stringify(codesysBasePayload())
    });
    if (data.exportPath) {
      elements.codesysExportPath.value = data.exportPath;
    }
    if (data.saveAsPath) {
      elements.codesysSaveAsPath.value = data.saveAsPath;
    }
    persistCodesysPaths();
    return data;
  });
}

async function codesysExportProject() {
  return runCodesysAction("从project重导", "正在启动 CODESYS，把 project 重新导出为 PLCopenXML", async () => {
    const data = await requestJson("/api/codesys/export", {
      method: "POST",
      body: JSON.stringify(codesysBasePayload())
    });
    if (data.exportPath) {
      elements.codesysExportPath.value = data.exportPath;
    }
    if (data.saveAsPath) {
      elements.codesysSaveAsPath.value = data.saveAsPath;
    }
    if (typeof data.text === "string") {
      elements.codesysExportText.value = data.text;
    }
    persistCodesysPaths();
    return data;
  });
}

async function codesysSaveExport(options = {}) {
  const payload = codesysBasePayload();
  payload.text = requireCodesysEditorText("保存XML");
  const data = await requestJson("/api/codesys/save-export", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (data.exportPath) {
    elements.codesysExportPath.value = data.exportPath;
  }
  if (!options.silent) {
    renderCodesysResult("保存文本", data);
    setCodesysStatus("保存文本完成");
  }
  persistCodesysPaths();
  return data;
}

async function codesysSaveExportClicked() {
  return runCodesysAction("保存XML", "正在保存 PLCopenXML 文本，不启动 CODESYS", () => codesysSaveExport({ silent: true }));
}

async function codesysImportProject() {
  return runCodesysAction("XML转project", "正在启动 CODESYS，把 XML 转回目标 project", async () => {
    const saved = elements.codesysExportText.value.trim()
      ? await codesysSaveExport({ silent: true })
      : null;
    const payload = codesysBasePayload();
    payload.importPath = saved ? saved.exportPath : payload.exportPath;
    const data = await requestJson("/api/codesys/import", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (data.saveAsPath) {
      elements.codesysSaveAsPath.value = data.saveAsPath;
    }
    persistCodesysPaths();
    return data;
  });
}

async function codesysBuildProject() {
  return runCodesysAction("编译目标project", "正在对目标 project 执行 CODESYS 编译验证，不转换 XML、不下载 PLC", async () => {
    const payload = codesysBasePayload();
    if (payload.saveAsPath) {
      payload.projectPath = payload.saveAsPath;
    }
    const data = await requestJson("/api/codesys/build", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    persistCodesysPaths();
    return data;
  });
}

async function runPlcLinkAction(action, statusText, callback) {
  if (state.plcLinkBusy) {
    return null;
  }
  state.plcLinkBusy = true;
  updatePlcLinkControls();
  if (elements.plcLinkStatus) {
    elements.plcLinkStatus.textContent = statusText;
  }
  setStatus(statusText);
  setThinking("PLC联动正在运行", statusText, true);
  appendReasoning("plc-link", "PLC联动操作", statusText, plcLinkPayload({ includeCodesysText: false }), false);
  try {
    const data = await callback();
    const summary = plcLinkSummary(action, data);
    if (elements.plcLinkStatus) {
      elements.plcLinkStatus.textContent = data.ok ? `${action}完成` : `${action}有问题`;
    }
    setStatus(data.ok ? `${action}完成` : `${action}有问题`);
    setThinking(data.ok ? "PLC联动完成" : "PLC联动发现问题", action, false);
    setPlcLinkOutput(summary);
    appendReasoning("plc-link", action, summary, data, false);
    appendResult("plc-link", action, summary, data, false);
    return data;
  } catch (error) {
    if (elements.plcLinkStatus) {
      elements.plcLinkStatus.textContent = error.message;
    }
    setStatus(error.message);
    setThinking("PLC联动失败", error.message, false);
    setPlcLinkOutput(error.message);
    appendReasoning("plc-link-error", action, error.message, null, false);
    appendResult("plc-link-error", action, error.message, null, false);
    return null;
  } finally {
    state.plcLinkBusy = false;
    updatePlcLinkControls();
  }
}

async function loadPythonStatus() {
  if (!elements.plcPythonRoot) {
    return;
  }
  try {
    const data = await requestJson("/api/python/status");
    const defaultRoot = data.defaultPythonRoot || "";
    const defaultScript = data.defaultPythonScript || "";
    const defaultMap = data.defaultRegisterMap || "";
    const defaultDevice = data.defaultDeviceName || "fivedof";
    const storedLocalIp = localStorage.getItem(state.plcPythonLocalIpKey) || "";
    const manualLocalIp = data.manualLocalIpv4 || "";
    const userSetLocalIp = localStorage.getItem(state.plcPythonLocalIpManualKey) === "1";
    elements.plcPythonRoot.value = localStorage.getItem(state.plcPythonRootKey) || defaultRoot;
    elements.plcPythonLocalIp.value = (userSetLocalIp && storedLocalIp) || manualLocalIp || storedLocalIp || data.localIpv4 || "";
    const localIpInfo = Array.isArray(data.localIpv4List)
      ? data.localIpv4List.find((item) => item.address === elements.plcPythonLocalIp.value)
      : null;
    const localIpLabel = `${elements.plcPythonLocalIp.value || "-"}${localIpInfo && localIpInfo.name ? `/${localIpInfo.name}` : ""}`;
    setLocalIpStatus(elements.plcPythonLocalIp.value, localIpInfo);
    elements.plcPythonLocalIp.title = localIpInfo && localIpInfo.source === "manual"
      ? "当前使用手动 IP；未连接的以太网也会按这个地址参与 PLC/Python 联动"
      : (localIpInfo && localIpInfo.preferred
        ? "已识别到有 IPv4 的以太网网卡地址"
        : "当前未识别到有 IPv4 的以太网网卡；可在这里手动填写你的以太网 IP");
    elements.plcPythonScript.value = localStorage.getItem(state.plcPythonScriptKey) || defaultScript;
    elements.plcRegisterMap.value = localStorage.getItem(state.plcRegisterMapKey) || defaultMap;
    elements.plcDeviceName.value = localStorage.getItem(state.plcDeviceKey) || defaultDevice;
    elements.pythonCodePath.value = localStorage.getItem(state.pythonCodePathKey) || elements.plcPythonScript.value;
    elements.pythonRunArgs.value = localStorage.getItem(state.pythonRunArgsKey) || "--glossary";
    if (elements.pythonGitRoot) {
      elements.pythonGitRoot.value = localStorage.getItem(state.pythonGitRootKey) || elements.plcPythonRoot.value;
    }
    if (elements.pythonGitPaths) {
      elements.pythonGitPaths.value = localStorage.getItem(state.pythonGitPathsKey) || "daq_plc_interface, test_fivedofplat_v26086.py";
    }
    if (elements.pythonGitCommitMessage) {
      elements.pythonGitCommitMessage.value = localStorage.getItem(state.pythonGitCommitKey) || "同步 Python PLC 控制代码";
    }
    if (elements.plcLinkStatus) {
      elements.plcLinkStatus.textContent = data.ok
        ? (data.device && data.device.ok ? `Python已就绪 | 本机 ${localIpLabel} | PLC ${data.device.address || data.defaultDeviceName}` : "Python已就绪 | 设备待检查")
        : "Python路径未就绪";
    }
    setPythonCodeStatus(data.pythonScriptFile && data.pythonScriptFile.exists ? "可读取" : "脚本缺失");
    updatePythonGitStatusText(data.gitRepoExists
      ? { unchecked: true, error: "未检查 | 点击 Git状态" }
      : { ok: false, error: "Python Git仓库不存在" });
  } catch (error) {
    if (elements.plcLinkStatus) {
      elements.plcLinkStatus.textContent = error.message;
    }
    setPythonCodeStatus(error.message);
  }
  updatePlcLinkControls();
  window.setTimeout(() => {
    refreshPythonRepoTree().catch(() => {});
  }, 0);
}

async function plcLinkAnalyze() {
  return runPlcLinkAction("联动检查", "正在检查 CODESYS/Python/寄存器表联动", async () => {
    await saveCurrentPythonEditorForPlc();
    return requestJson("/api/plc-link/analyze", {
      method: "POST",
      body: JSON.stringify(currentPythonCommandPayload())
    });
  });
}

async function plcGenerateRegisterMap() {
  return runPlcLinkAction("生成寄存器表", "正在生成并保存 PLC/Python 对应寄存器表", async () => {
    await saveCurrentPythonEditorForPlc();
    return requestJson("/api/plc-link/generate-register-map", {
      method: "POST",
      body: JSON.stringify(currentPythonCommandPayload())
    });
  });
}

async function plcReadFeedback() {
  return runPlcLinkAction("只读反馈", "正在通过 Python 只读 PLC 反馈寄存器", async () => {
    state.pythonRunning = true;
    updatePlcLinkControls();
    try {
      return await requestJson("/api/plc-link/read-feedback", {
        method: "POST",
        body: JSON.stringify(plcLinkPayload({ includeCodesysText: false }))
      });
    } finally {
      state.pythonRunning = false;
      updatePlcLinkControls();
    }
  });
}

async function plcGenerateCommands() {
  return runPlcLinkAction("生成命令", "正在保存当前 Python 代码并生成验证命令", async () => {
    await saveCurrentPythonEditorForPlc();
    const payload = currentPythonCommandPayload({ includeCodesysText: false });
    return requestJson("/api/plc-link/commands", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  });
}

async function pythonLoadFile() {
  return runPlcLinkAction("读取Python", "正在读取 Python 控制代码", async () => {
    const data = await requestJson("/api/python/read-file", {
      method: "POST",
      body: JSON.stringify(pythonFilePayload())
    });
    elements.pythonCodePath.value = data.filePath || elements.pythonCodePath.value;
    setPythonCodeText(data.text || "");
    setPythonCodeStatus(`已读取 ${Math.round(Number(data.textBytes || 0) / 1024)} KB`);
    return {
      ...data,
      generatedRegisterMap: "",
      commands: [],
      checks: [],
      ok: true
    };
  });
}

async function pythonSaveFile(options = {}) {
  const data = await requestJson("/api/python/save-file", {
    method: "POST",
    body: JSON.stringify(pythonFilePayload({ includeText: true }))
  });
  elements.pythonCodePath.value = data.filePath || elements.pythonCodePath.value;
  setPythonCodeStatus(`已保存 ${Math.round(Number(data.textBytes || 0) / 1024)} KB`);
  persistPlcLinkSettings();
  if (!options.silent) {
    const summary = `保存Python: 完成\n文件: ${data.filePath}\n大小: ${data.textBytes} bytes`;
    setPlcLinkOutput(summary);
    appendReasoning("python-code", "保存Python", summary, data, false);
    appendResult("python-code", "保存Python", summary, data, false);
  }
  return data;
}

async function pythonSaveFileClicked() {
  return runPlcLinkAction("保存Python", "正在保存 Python 控制代码", () => pythonSaveFile({ silent: true }));
}

async function pythonRunFile() {
  return runPlcLinkAction("运行Python", "正在保存并运行 Python 控制代码", async () => {
    if (elements.pythonCodeText.value.trim()) {
      await pythonSaveFile({ silent: true });
    }
    state.pythonRunning = true;
    updatePlcLinkControls();
    let data;
    try {
      data = await requestJson("/api/python/run", {
        method: "POST",
        body: JSON.stringify(pythonFilePayload())
      });
    } finally {
      state.pythonRunning = false;
      updatePlcLinkControls();
    }
    const output = [
      `运行Python: ${data.ok ? "完成" : "失败"}`,
      `命令: ${data.command || ""}`,
      "",
      data.stdout ? `[stdout]\n${data.stdout}` : "",
      data.stderr ? `[stderr]\n${data.stderr}` : "",
      data.error ? `[error]\n${data.error}` : ""
    ].filter(Boolean).join("\n");
    elements.pythonRunOutput.value = output;
    setPythonCodeStatus(data.ok ? "运行完成" : "运行失败");
    return {
      ...data,
      generatedRegisterMap: "",
      commands: [],
      checks: [],
      stdout: output
    };
  });
}

async function pythonStopProcess() {
  if (!state.pythonRunning) {
    setPythonCodeStatus("没有正在运行的 Python");
    return;
  }
  try {
    setPythonCodeStatus("正在停止 Python");
    const data = await requestJson("/api/python/stop", {
      method: "POST",
      body: JSON.stringify({ target: "python" })
    });
    setPythonCodeStatus(data.stopped ? "已发送停止" : "未找到运行中的 Python");
    const text = data.stopped
      ? `停止Python: 已发送停止\nPID: ${data.pid || "-"}`
      : "停止Python: 未找到运行中的 Python 进程";
    elements.pythonRunOutput.value = text;
    appendReasoning("python-stop", "停止Python", text, data, false);
  } catch (error) {
    setPythonCodeStatus(error.message);
    elements.pythonRunOutput.value = error.message;
    appendReasoning("python-stop-error", "停止Python", error.message, null, false);
  }
}

async function requestHistory(options = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit || 80));
  if (options.id) {
    params.set("id", options.id);
  }
  if (options.details) {
    params.set("details", "1");
  }
  if (options.favoriteOnly) {
    params.set("favorites", "1");
  }

  const response = await fetch(`/api/history?${params.toString()}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "历史读取失败");
  }
  return data;
}

function setHistoryEmpty(container, text) {
  container.textContent = "";
  const empty = document.createElement("div");
  empty.className = "history-empty";
  empty.textContent = text;
  container.append(empty);
}

function historyDisplayTitle(record) {
  return record.promptPreview || record.prompt || "历史记录";
}

function continuationQuestionText(record) {
  return String(record && (record.prompt || record.promptPreview || record.parentPromptPreview) || "").trim();
}

function continuationAnswerText(record) {
  return String(record && (record.resultText || record.resultPreview || record.parentResultPreview) || "").trim();
}

function continuationContextText(record, nextPrompt = "", options = {}) {
  const question = trimContextText(continuationQuestionText(record), options.questionChars || 700);
  const answer = trimContextText(continuationAnswerText(record), options.answerChars || 1400);
  const prompt = trimContextText(nextPrompt, options.promptChars || 700);
  const lines = [
    `上一轮问题：\n${question || "(未保存上一轮问题)"}`,
    `上一轮回答：\n${answer || "(未保存上一轮回答)"}`
  ];
  if (options.includeNextPrompt !== false) {
    lines.push(`本次追问：\n${prompt || "(待输入)"}`);
  }
  return lines.join("\n\n");
}

function updateContinueContextText(record, nextPrompt = "") {
  if (!elements.continueContextText || !record) {
    return;
  }
  const idText = record.id ? `历史 ${record.id.slice(0, 8)}` : "当前结果";
  elements.continueContextText.textContent = [
    `${idText} | ${historyDisplayTitle(record)}`,
    continuationContextText(record, nextPrompt, {
      questionChars: 260,
      answerChars: 520,
      promptChars: 260
    })
  ].join("\n");
}

function sortHistoryForDisplay(records) {
  return records.slice().sort((a, b) => {
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function renderFavoriteFilterState() {
  if (!elements.favoriteHistoryToggle) {
    return;
  }
  const active = state.historyFavoriteOnly;
  elements.favoriteHistoryToggle.classList.toggle("active", active);
  elements.favoriteHistoryToggle.setAttribute("aria-pressed", active ? "true" : "false");
  elements.favoriteHistoryToggle.title = active ? "显示全部历史" : "只看收藏";
}

function updateHistoryStatusText() {
  if (state.historyFavoriteOnly) {
    elements.historyStatus.textContent = `收藏 ${state.history.length} 条 / 全部 ${state.historyTotalCount} 条`;
    return;
  }
  elements.historyStatus.textContent = `${state.history.length} 条记录 | 收藏 ${state.historyFavoriteCount} 条`;
}

function setContinueContext(record, options = {}) {
  const clearPrompt = options.clearPrompt !== false;
  state.continueFromRecord = {
    id: record.id,
    prompt: record.prompt || "",
    promptPreview: record.promptPreview || record.prompt || "",
    resultText: record.resultText || "",
    resultPreview: record.resultPreview || record.resultText || "",
    workspace: record.workspace || "",
    mcpTools: Array.isArray(record.mcpTools) ? record.mcpTools : [],
    favorite: record.favorite === true
  };

  if (elements.continueContext) {
    elements.continueContext.hidden = false;
  }
  updateContinueContextText(state.continueFromRecord, clearPrompt ? "" : elements.promptInput.value.trim());

  if (record.workspace) {
    elements.workspaceInput.value = record.workspace;
  }

  if (clearPrompt) {
    elements.promptInput.value = "";
  }
  elements.promptInput.placeholder = "输入要继续追问的新问题，运行时会自动带入已选历史上下文";
  if (options.focus !== false) {
    elements.promptInput.focus();
  }
  setStatus("已选择历史上下文，可继续追问");
  setThinking("已选择历史上下文", "输入新的追问内容后运行，会基于这条历史记录继续回答", false);
  elements.historyStatus.textContent = "已选择续问历史";
  updateContinueRunButtonState();
}

function clearContinueContext(updateStatus = true) {
  state.continueFromRecord = null;
  if (elements.continueContext) {
    elements.continueContext.hidden = true;
  }
  if (elements.continueContextText) {
    elements.continueContextText.textContent = "未选择历史上下文";
  }
  elements.promptInput.placeholder = "在这里输入指令，Ctrl + Enter 运行";
  if (updateStatus) {
    setStatus("已取消续问上下文");
  }
  updateContinueRunButtonState();
}

function buildSupplementedPrompt(basePrompt, supplements) {
  const supplementText = supplements
    .map((item, index) => `补充 ${index + 1}：\n${item}`)
    .join("\n\n");
  return [
    "请基于下面的原始问题和运行中补充说明，重新完整推理并给出最终结果。",
    "",
    "【原始问题】",
    basePrompt,
    "",
    "【运行中补充说明】",
    supplementText
  ].join("\n");
}

function currentRunHasFinalResponse() {
  const currentRun = state.currentRun;
  return Boolean(
    state.running &&
    currentRun &&
    (currentRun.resultReceived || currentRun.turnCompleted || currentRun.turnFailed || currentRun.exitSeen)
  );
}

function isQueuedContinuationRequest(request = state.runningSupplementRestart) {
  return Boolean(request && request.kind === "continuation");
}

function requestRunningContinuation() {
  if (!currentRunHasFinalResponse()) {
    return false;
  }

  const prompt = elements.promptInput.value.trim();
  const currentPrompt = String(state.currentRun.prompt || "").trim();
  if (!prompt || prompt === currentPrompt) {
    setStatus("当前结果正在收尾，请输入下一轮追问");
    elements.historyStatus.textContent = "输入新问题后会在当前结果保存完成后继续";
    elements.promptInput.focus();
    return true;
  }

  state.runningSupplementRestart = {
    kind: "continuation",
    prompt,
    requestedAt: new Date().toISOString()
  };
  localStorage.removeItem(state.lastPromptKey);
  elements.promptInput.value = "";
  appendReasoning("continue", "已排队下一轮追问", `当前结果保存完成后继续：\n${prompt}`, null, false);
  setStatus("已排队下一轮追问");
  setThinking("正在保存当前结果", "保存完成后会把当前结果作为上下文启动下一轮追问", true);
  elements.historyStatus.textContent = "当前结果保存后自动继续追问";
  updateContinueRunButtonState();
  return true;
}

function requestRunningPromptHandoff() {
  return currentRunHasFinalResponse()
    ? requestRunningContinuation()
    : requestRunningSupplementRestart();
}

function requestRunningSupplementRestart() {
  if (!state.running || !state.currentRun) {
    return false;
  }

  const supplement = elements.promptInput.value.trim();
  const currentPrompt = String(state.currentRun.prompt || "").trim();
  if (!supplement || supplement === currentPrompt) {
    setStatus("请输入对当前问题的补充内容");
    elements.historyStatus.textContent = "运行中可补充，请先输入补充说明";
    elements.promptInput.focus();
    return true;
  }

  const existing = state.runningSupplementRestart && !isQueuedContinuationRequest()
    ? state.runningSupplementRestart
    : {
    kind: "supplement",
    basePrompt: state.currentRun.basePrompt || state.currentRun.prompt || "",
    supplements: Array.isArray(state.currentRun.runningSupplements)
      ? state.currentRun.runningSupplements.slice()
      : [],
    continueFromRecord: state.continueFromRecord ? { ...state.continueFromRecord } : null
  };
  existing.supplements.push(supplement);
  existing.prompt = buildSupplementedPrompt(existing.basePrompt, existing.supplements);
  existing.requestedAt = new Date().toISOString();
  state.runningSupplementRestart = existing;

  localStorage.removeItem(state.lastPromptKey);
  elements.promptInput.value = "";
  appendReasoning("supplement", "收到运行中补充", `将带补充重新推理：\n${supplement}`, null, false);
  setStatus("已收到补充，正在停止当前推理并重新运行");
  setThinking("正在带补充重新推理", "客户端会用原问题加补充说明重启本轮推理", true);
  elements.historyStatus.textContent = `已收到 ${existing.supplements.length} 条运行中补充`;
  updateContinueRunButtonState();
  stopCurrentCodexRun();
  return true;
}

function renderHistoryItem(record, variant = "list") {
  const item = document.createElement("article");
  item.className = `history-item ${variant}`;
  item.classList.toggle("favorite", record.favorite === true);

  const head = document.createElement("div");
  head.className = "history-item-head";
  const title = document.createElement("strong");
  title.textContent = record.promptPreview || record.prompt || "无指令内容";
  const meta = document.createElement("span");
  const status = STATUS_LABELS[record.status] || record.status || "未知";
  const mcpText = Array.isArray(record.mcpTools) && record.mcpTools.length ? ` | MCP ${mcpToolsText(record.mcpTools)}` : "";
  const agentText = ` | 智能体 ${record.agentLabel || AGENT_LABELS[record.activeAgentProfile] || AGENT_LABELS[record.agentProfile] || "自动总控"}`;
  const parentText = record.parentHistoryId ? " | 续问" : "";
  const favoriteText = record.favorite ? " | 已收藏" : "";
  meta.textContent = `${formatDate(record.createdAt)} | ${status}${agentText} | 推理 ${formatReasoningLabel(record.reasoningEffort, record.requestedReasoningEffort)}${favoriteText}${parentText}${mcpText}`;
  head.append(title, meta);

  const preview = document.createElement("p");
  preview.textContent = record.resultPreview || record.reasoningPreview || "没有保存结果";

  const actions = document.createElement("div");
  actions.className = "history-actions";

  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = record.favorite ? "favorite-link active" : "favorite-link";
  favoriteButton.dataset.historyAction = "favorite";
  favoriteButton.dataset.historyId = record.id;
  favoriteButton.dataset.favorite = record.favorite ? "0" : "1";
  favoriteButton.textContent = record.favorite ? "取消收藏" : "收藏";
  actions.append(favoriteButton);

  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.dataset.historyAction = "view";
  viewButton.dataset.historyId = record.id;
  viewButton.textContent = "查看";
  actions.append(viewButton);

  const fillButton = document.createElement("button");
  fillButton.type = "button";
  fillButton.dataset.historyAction = "fill";
  fillButton.dataset.historyId = record.id;
  fillButton.textContent = "填入";
  actions.append(fillButton);

  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.dataset.historyAction = "continue";
  continueButton.dataset.historyId = record.id;
  continueButton.textContent = "继续追问";
  actions.append(continueButton);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger-link";
  deleteButton.dataset.historyAction = "delete";
  deleteButton.dataset.historyId = record.id;
  deleteButton.textContent = "删除";
  actions.append(deleteButton);

  item.append(head, preview, actions);
  return item;
}

function renderHistoryList() {
  elements.historyList.textContent = "";
  if (!state.history.length) {
    setHistoryEmpty(elements.historyList, state.historyFavoriteOnly ? "还没有收藏的推理记录" : "还没有历史推理记录");
    return;
  }

  for (const record of sortHistoryForDisplay(state.history).slice(0, 20)) {
    elements.historyList.append(renderHistoryItem(record, "list"));
  }
}

async function refreshHistory() {
  try {
    const data = await requestHistory({ limit: 80, favoriteOnly: state.historyFavoriteOnly });
    state.history = data.records || [];
    state.historyFavoriteCount = Number(data.favoriteCount || 0);
    state.historyTotalCount = Number(data.totalCount || state.history.length);
    updateHistoryStatusText();
    renderFavoriteFilterState();
    renderHistoryList();
  } catch (error) {
    elements.historyStatus.textContent = error.message;
    setHistoryEmpty(elements.historyList, "历史读取失败");
  }
}

async function loadHistoryRecord(id) {
  const data = await requestHistory({ id, details: true });
  return data.record;
}

async function setHistoryFavorite(id, favorite) {
  const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "收藏状态更新失败");
  }
  return data.record;
}

async function clearNonFavoriteHistory() {
  if (state.running) {
    return;
  }
  const ok = window.confirm("清空全部非收藏历史记录？已收藏记录会保留。");
  if (!ok) {
    return;
  }

  elements.historyStatus.textContent = "正在清空非收藏历史";
  const response = await fetch("/api/history?scope=nonfavorites", { method: "DELETE" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "清空历史失败");
  }

  if (state.continueFromRecord && !state.continueFromRecord.favorite) {
    clearContinueContext(false);
  }
  if (state.lastSavedRecord && !state.lastSavedRecord.favorite) {
    state.lastSavedRecord = null;
    updateContinueRunButtonState();
  }
  await refreshHistory();
  elements.historyStatus.textContent = `已清空 ${Number(data.deleted || 0)} 条非收藏历史，保留收藏 ${Number(data.remaining || 0)} 条`;
}

function appendHistorySection(existingText, heading, body) {
  return [`${heading}\n${body || "(本轮没有保存内容)"}`, existingText || ""]
    .filter((item) => String(item || "").trim())
    .join("\n\n---\n\n");
}

function isMergedHistoryRecord(record) {
  return String(`${record.resultText || ""}\n${record.reasoningText || ""}`).includes("[继续追问");
}

function mergedEventList(existingEvents, nextEvents) {
  return [
    ...(Array.isArray(existingEvents) ? existingEvents : []),
    ...(Array.isArray(nextEvents) ? nextEvents : [])
  ];
}

async function mergeContinuationHistoryPayload(payload) {
  const parentId = state.currentRun ? state.currentRun.parentHistoryId : "";
  if (!parentId) {
    return { payload, merged: false };
  }

  const parent = await loadHistoryRecord(parentId);
  const mergedAt = new Date().toISOString();
  const heading = `[继续追问 ${formatHistoryMergeTime(mergedAt)}]`;
  const statusText = STATUS_LABELS[payload.status] || payload.status || "完成";
  const resultBody = [
    `问题：\n${payload.prompt}`,
    `状态：${statusText}`,
    `回答：\n${payload.resultText || "(本轮没有捕获到最终结果，请查看运行推理过程)"}`
  ].join("\n\n");
  const reasoningBody = [
    `问题：\n${payload.prompt}`,
    payload.reasoningText || "(本轮没有保存过程记录)"
  ].join("\n\n");

  return {
    merged: true,
    payload: {
      ...payload,
      id: parent.id,
      createdAt: mergedAt,
      prompt: parent.prompt || parent.promptPreview || payload.prompt,
      parentHistoryId: parent.parentHistoryId || "",
      parentPromptPreview: parent.parentPromptPreview || "",
      parentResultPreview: parent.parentResultPreview || "",
      durationMs: Number(parent.durationMs || 0) + Number(payload.durationMs || 0),
      favorite: parent.favorite === true,
      favoriteAt: parent.favoriteAt || "",
      reasoningText: appendHistorySection(parent.reasoningText, `${heading} 运行过程`, reasoningBody),
      resultText: appendHistorySection(parent.resultText, `${heading} 回答`, resultBody),
      reasoningEvents: mergedEventList(parent.reasoningEvents, payload.reasoningEvents),
      resultEvents: mergedEventList(parent.resultEvents, payload.resultEvents)
    }
  };
}

function showHistoryRecord(record, options = {}) {
  resetRunBuffers();
  state.currentRun = null;
  state.historySaved = true;
  state.historySaving = false;
  state.lastSavedRecord = record;
  state.resultTexts = record.resultText ? [record.resultText] : [];

  if (options.setPrompt !== false) {
    elements.promptInput.value = record.prompt || record.promptPreview || elements.promptInput.value;
  }
  const meta = [
    `时间: ${formatDate(record.createdAt)}`,
    `工作目录: ${record.workspace || "-"}`,
    `状态: ${STATUS_LABELS[record.status] || record.status || "-"}`,
    `智能体: ${record.agentLabel || AGENT_LABELS[record.activeAgentProfile] || AGENT_LABELS[record.agentProfile] || "自动总控"}`,
    `模型: ${formatModelLabel(record.model, record.modelMode, record.modelSource)}`,
    `推理强度: ${formatReasoningLabel(record.reasoningEffort, record.requestedReasoningEffort)}`,
    `MCP 工具: ${mcpToolsText(record.mcpTools || [])}`,
    record.parentHistoryId ? `续问来源: ${record.parentHistoryId}` : ""
  ].filter(Boolean).join("\n");

  appendReasoning("history", "历史记录", meta, null, false);

  const mergedHistory = isMergedHistoryRecord(record);
  const reasoningEvents = Array.isArray(record.reasoningEvents) ? record.reasoningEvents : [];
  if (reasoningEvents.length && !mergedHistory) {
    for (const event of reasoningEvents) {
      appendReasoning(event.kind || "history", event.title || "过程", event.text || "", event.raw, false);
    }
  } else {
    appendReasoning("history", "过程记录", record.reasoningText || "没有保存过程记录", null, false);
  }

  elements.resultLog.innerHTML = "";
  const resultEvents = Array.isArray(record.resultEvents) ? record.resultEvents : [];
  if (resultEvents.length && !mergedHistory) {
    for (const event of resultEvents) {
      appendResult(event.kind || "history", event.title || "结果", event.text || "", event.raw, false);
    }
  } else {
    appendResult("history", "历史结果", record.resultText || "没有保存结果", null, false);
  }

  state.resultTexts = record.resultText ? [record.resultText] : [];
  elements.resultLog.dataset.historyId = record.id || "";
  setStatus("正在查看历史");
  setThinking("历史推理记录", "正在查看已保存的过程和结果", false);
  elements.runMeta.textContent = record.id ? `历史 ${record.id.slice(0, 8)}` : "历史记录";
  elements.resultStatus.textContent = "历史结果";
  elements.historyStatus.textContent = "历史已拉取";
  updateContinueRunButtonState();
}

async function saveHistoryRecord(status, extra = {}) {
  if (!state.currentRun || state.historySaved || state.historySaving) {
    return null;
  }
  state.historySaving = true;
  const basePayload = {
    ...state.currentRun,
    status,
    durationMs: extra.durationMs || (state.startedAt ? Date.now() - state.startedAt : 0),
    reasoningText: state.reasoningTexts.join("\n\n").trim(),
    resultText: state.resultTexts.join("\n\n").trim(),
    reasoningEvents: state.reasoningEvents,
    resultEvents: state.resultEvents
  };

  try {
    const { payload, merged } = await mergeContinuationHistoryPayload(basePayload);
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "历史保存失败");
    }
    state.historySaved = true;
    if (data.record && data.record.id) {
      elements.resultLog.dataset.historyId = data.record.id;
      if (status === "completed" || data.record.resultText) {
        state.lastSavedRecord = data.record;
      }
    }
    if (state.currentRun.parentHistoryId && data.record && data.record.id) {
      state.continueFromRecord = {
        id: data.record.id,
        prompt: data.record.prompt || "",
        promptPreview: data.record.promptPreview || data.record.prompt || "",
        resultText: data.record.resultText || "",
        resultPreview: data.record.resultPreview || data.record.resultText || "",
        workspace: data.record.workspace || "",
        mcpTools: Array.isArray(data.record.mcpTools) ? data.record.mcpTools : [],
        favorite: data.record.favorite === true
      };
      if (elements.continueContext) {
        elements.continueContext.hidden = false;
      }
      updateContinueContextText(state.continueFromRecord);
      elements.promptInput.placeholder = "继续输入下一个追问，会基于刚刚保存的结果继续";
    }
    elements.historyStatus.textContent = merged ? "续问已合并到原历史" : "历史已保存";
    await refreshHistory();
    updateContinueRunButtonState();
    return data.record || null;
  } catch (error) {
    state.historySaved = false;
    elements.historyStatus.textContent = error.message;
    return null;
  } finally {
    state.historySaving = false;
  }
}

function handleStreamEvent(eventName, data) {
  if (eventName === "approval-aborted") {
    hideApprovalPrompt();
    if (state.currentRun) {
      state.currentRun.waitKind = "approval";
      state.currentRun.waitLabel = "外层授权已取消";
      state.currentRun.lastEventDetail = data.detail || data.message || "";
      state.currentRun.approvalDeadlineAt = 0;
      state.currentRun.approvalAbortDetected = true;
    }
    const detail = [
      data.message || "外层授权已取消，本轮不会再次自动重试。",
      data.detail,
      "本地网页客户端不能替外层 Codex 宿主点击 Yes；重新运行前请先允许外层授权，或改用无需该授权的方法。"
    ].filter(Boolean).join("\n");
    appendReasoning("approval", "外层授权已取消", detail, data);
    setStatus("外层授权已取消");
    setThinking("已停止授权重放", "本轮不会再次自动重试同一命令", false, "warning");
    return;
  }

  if (eventName === "approval-required") {
    if (state.currentRun) {
      state.currentRun.waitKind = data.kind || "approval";
      state.currentRun.waitLabel = data.kind === "input" ? "等待人工输入" : "等待权限确认";
      state.currentRun.lastEventDetail = data.detail || data.message || "";
      state.currentRun.approvalAutoEnabled = data.autoApprovalEnabled === true;
      state.currentRun.approvalDeadlineAt = Number(data.deadlineAt || 0);
    }
    const title = data.kind === "input" ? "任务等待人工输入" : "任务等待授权";
    const detail = [data.message, data.detail].filter(Boolean).join("\n");
    appendReasoning("approval", title, detail, data);
    setStatus(title);
    setThinking(title, detail || "客户端正在等待你的选择", true, "warning");
    showApprovalPrompt(data);
    return;
  }

  if (eventName === "self-check") {
    if (state.currentRun) {
      state.currentRun.serverIdleMs = Number(data.idleMs || 0);
      state.currentRun.lastHeartbeatAt = Date.now();
      state.currentRun.selfChecking = true;
      state.currentRun.selfCheckMs = Number(data.selfCheckMs || state.currentRun.selfCheckMs || 0);
      state.currentRun.selfCheckCount = Number(data.selfCheckCount || state.currentRun.selfCheckCount || 0);
      state.currentRun.waitKind = data.waitKind || state.currentRun.waitKind || "model";
      state.currentRun.waitLabel = data.waitLabel || state.currentRun.waitLabel || "";
      state.currentRun.effectiveTimeoutMs = Number(data.effectiveTimeoutMs || state.currentRun.effectiveTimeoutMs || 0);
      state.currentRun.lastEventDetail = data.lastEventDetail || state.currentRun.lastEventDetail || "";
    }
    const recoveryCount = Number(data.recoveryCount || 0);
    const recoveryLimit = Number(data.recoveryLimit || 0);
    const recoveryRemaining = data.recoveryEligible && data.recoveryAtMs > data.idleMs
      ? `${durationText(data.recoveryAtMs - data.idleMs)}后自动恢复（第 ${recoveryCount + 1}/${recoveryLimit} 次）`
      : "";
    const interactionText = data.waitKind === "approval" || data.waitKind === "input"
      ? `客户端已显示处理界面；将按上限自动恢复（最多 ${recoveryLimit} 次），或停止任务。`
      : "";
    const detail = [
      data.message || "watchdog 已开始自检。",
      `等待阶段: ${data.waitLabel || data.waitKind || "未知"}`,
      `子进程: ${data.processAlive ? "仍在运行" : "已退出或丢失"}`,
      recoveryRemaining,
      interactionText,
      data.lastEventName ? `最后事件: ${data.lastEventName}` : "",
      data.lastEventDetail ? `事件内容: ${data.lastEventDetail}` : ""
    ].filter(Boolean).join("\n");
    appendReasoning("self-check", "无响应自检", detail, data);
    setStatus("正在自检");
    setThinking("长时间无响应，正在自检", detail.replace(/\n/g, "；"), true, "warning");
    return;
  }

  if (eventName === "recovery") {
    hideApprovalPrompt();
    const recoveryFailed = data.action === "failed";
    if (state.currentRun) {
      state.currentRun.watchdogRecoveryCount = Number(data.recoveryCount || state.currentRun.watchdogRecoveryCount || 0);
      state.currentRun.selfChecking = true;
      state.currentRun.lastProgressLabel = recoveryFailed ? "watchdog 恢复失败，正在收尾" : "watchdog 正在换方法推进";
    }
    const detail = [
      data.message || "watchdog 正在恢复任务。",
      data.strategy ? `本次策略: ${data.strategy}` : "",
      data.recoveryCount && data.recoveryLimit ? `恢复次数: ${data.recoveryCount}/${data.recoveryLimit}` : "",
      `无响应时间: ${durationText(data.idleMs)}`,
      data.lastEventName ? `最后事件: ${data.lastEventName}` : "",
      data.lastEventDetail ? `事件内容: ${data.lastEventDetail}` : ""
    ].filter(Boolean).join("\n");
    appendReasoning("recovery", recoveryFailed ? "自动恢复失败" : "正在自动恢复", detail, data);
    setStatus(recoveryFailed ? "自动恢复失败，正在收尾" : "正在自动恢复");
    setThinking(
      recoveryFailed ? "自动恢复失败，正在安全收尾" : "正在换方法推进任务",
      recoveryFailed
        ? "旧模型进程未及时退出，本次任务将结束，不会继续留下运行状态。"
        : data.stateAware
          ? "正在携带现场状态恢复；新任务会先核对已完成步骤，再换一种方法取得新证据。"
           : "正在重启模型进程；新任务会先自检，再换一种方法取得新证据。",
      true,
      "warning"
    );
    return;
  }

  if (eventName === "retry") {
    if (state.currentRun) {
      state.currentRun.lastProgressLabel = "模型连接自动重试";
      state.currentRun.lastEventDetail = data.lastError || data.message || "";
      state.currentRun.retryAttempt = Number(data.attempt || state.currentRun.retryAttempt || 0);
      state.currentRun.maxAttempts = Number(data.maxAttempts || state.currentRun.maxAttempts || 0);
      state.currentRun.providerRetryCount = Number(data.retryCount || state.currentRun.providerRetryCount || 0);
    }
    const attemptText = data.attempt && data.maxAttempts ? `第 ${data.attempt}/${data.maxAttempts} 次` : "下一次";
    const delayText = data.delayMs ? `${Math.round(Number(data.delayMs) / 1000)} 秒后` : "稍后";
    const detail = [
      data.message || `模型连接中断，${delayText}自动重试${attemptText}。`,
      data.lastError ? `最后错误: ${data.lastError}` : ""
    ].filter(Boolean).join("\n");
    appendReasoning("retry", "模型连接自动重试", detail, data);
    setStatus("模型连接自动重试");
    setThinking("模型连接自动重试", `${delayText}重新启动推理，${attemptText}`, true, "warning");
    return;
  }

  if (eventName === "retry-started" || eventName === "recovery-started") {
    hideApprovalPrompt();
    const watchdogRecovery = eventName === "recovery-started";
    const modeLabel = RUN_MODES[state.mode].label;
    const reasoningLabel = formatReasoningLabel(data.reasoningEffort || (state.currentRun ? state.currentRun.reasoningEffort : state.reasoningEffort), data.requestedReasoningEffort || (state.currentRun ? state.currentRun.requestedReasoningEffort : state.reasoningEffort));
    const modelLabel = formatModelLabel(
      data.model || (state.currentRun ? state.currentRun.model : ""),
      data.modelMode || (state.currentRun ? state.currentRun.modelMode : ""),
      data.modelSource || (state.currentRun ? state.currentRun.modelSource : "")
    );
    const agentLabel = data.agentLabel || AGENT_LABELS[data.activeAgentProfile] || AGENT_LABELS[data.agentProfile] || "自动总控";
    const mcpText = mcpToolsText((data.mcpTools || []).map((item) => item.name || item));
    const maintenanceText = data.maintenanceContext ? "已载入" : "未启用";
    const attemptText = watchdogRecovery
      ? ` | 自恢复 ${data.watchdogRecoveryCount || 1}/${data.watchdogRecoveryLimit || 1}`
      : data.attempt && data.maxAttempts ? ` | 重试 ${data.attempt}/${data.maxAttempts}` : "";
    elements.runMeta.textContent = `PID ${data.pid || "-"} | ${modeLabel} | 权限 ${sandboxLabel(data.sandbox)} | 智能体 ${agentLabel} | 模型 ${modelLabel} | 推理 ${reasoningLabel} | MCP ${mcpText} | 维护 ${maintenanceText}${attemptText}`;
    if (state.currentRun) {
      state.currentRun.pid = data.pid || null;
      state.currentRun.lastProgressLabel = watchdogRecovery ? "watchdog 自恢复已启动" : "自动重试已启动";
      state.currentRun.selfChecking = false;
      state.currentRun.watchdogRecoveryCount = Number(data.watchdogRecoveryCount || state.currentRun.watchdogRecoveryCount || 0);
      state.currentRun.retryAttempt = Number(data.attempt || state.currentRun.retryAttempt || 0);
      state.currentRun.maxAttempts = Number(data.maxAttempts || state.currentRun.maxAttempts || 0);
      state.currentRun.providerRetryCount = Number(data.providerRetryCount || state.currentRun.providerRetryCount || 0);
      state.currentRun.provider = data.provider || state.currentRun.provider || state.codexConfig || null;
      state.currentRun.providerProxyBaseUrl = data.providerProxyBaseUrl || state.currentRun.providerProxyBaseUrl || "";
      state.currentRun.model = data.model || state.currentRun.model || "";
      state.currentRun.requestedModel = data.requestedModel || state.currentRun.requestedModel || "";
      state.currentRun.modelMode = data.modelMode || state.currentRun.modelMode || "";
      state.currentRun.modelSource = data.modelSource || state.currentRun.modelSource || "";
    }
    const title = watchdogRecovery ? "自恢复已启动" : "自动重试已启动";
    appendReasoning(watchdogRecovery ? "recovery" : "retry", title, `PID ${data.pid || "-"}\n${data.attempt && data.maxAttempts ? `尝试: ${data.attempt}/${data.maxAttempts}` : ""}`, data);
    setStatus(title);
    const restartedDetail = watchdogRecovery
      ? data.recoveryStateAware ? "已携带现场状态启动新的模型进程，正在换一种方法取得新证据" : "已启动新的模型进程，先自检再继续推进"
      : (data.attempt && data.maxAttempts ? `正在执行第 ${data.attempt}/${data.maxAttempts} 次推理` : "正在重新连接模型服务并推理");
    rememberCurrentThought(title, restartedDetail);
    setThinking(title, restartedDetail, true);
    return;
  }

  if (eventName === "ready") {
    const modeLabel = RUN_MODES[state.mode].label;
    const reasoningLabel = formatReasoningLabel(data.reasoningEffort || (state.currentRun ? state.currentRun.reasoningEffort : state.reasoningEffort), data.requestedReasoningEffort || (state.currentRun ? state.currentRun.requestedReasoningEffort : state.reasoningEffort));
    const modelLabel = formatModelLabel(
      data.model || (state.currentRun ? state.currentRun.model : ""),
      data.modelMode || (state.currentRun ? state.currentRun.modelMode : ""),
      data.modelSource || (state.currentRun ? state.currentRun.modelSource : "")
    );
    const agentLabel = data.agentLabel || AGENT_LABELS[data.activeAgentProfile] || AGENT_LABELS[data.agentProfile] || "自动总控";
    const mcpText = mcpToolsText((data.mcpTools || []).map((item) => item.name || item));
    const maintenanceText = data.maintenanceContext ? "已载入" : "未启用";
    elements.runMeta.textContent = `PID ${data.pid || "-"} | ${modeLabel} | 权限 ${sandboxLabel(data.sandbox)} | 智能体 ${agentLabel} | 模型 ${modelLabel} | 推理 ${reasoningLabel} | MCP ${mcpText} | 维护 ${maintenanceText}`;
    if (state.currentRun) {
      state.currentRun.runId = data.runId;
      state.currentRun.workspace = data.workspace || state.currentRun.workspace;
      state.currentRun.sandbox = data.sandbox || state.currentRun.sandbox;
      state.currentRun.approval = data.approval || state.currentRun.approval;
      state.currentRun.requestedReasoningEffort = data.requestedReasoningEffort || state.currentRun.requestedReasoningEffort;
      state.currentRun.reasoningEffort = data.reasoningEffort || state.currentRun.reasoningEffort;
      state.currentRun.agentProfile = data.agentProfile || state.currentRun.agentProfile || state.agentProfile;
      state.currentRun.activeAgentProfile = data.activeAgentProfile || state.currentRun.activeAgentProfile || "";
      state.currentRun.agentLabel = agentLabel;
      state.currentRun.provider = data.provider || state.currentRun.provider || state.codexConfig || null;
      state.currentRun.providerProxyBaseUrl = data.providerProxyBaseUrl || "";
      state.currentRun.model = data.model || state.currentRun.model || "";
      state.currentRun.requestedModel = data.requestedModel || state.currentRun.requestedModel || "";
      state.currentRun.modelMode = data.modelMode || state.currentRun.modelMode || "";
      state.currentRun.modelSource = data.modelSource || state.currentRun.modelSource || "";
      state.currentRun.selfCheckMs = Number(data.selfCheckMs || 0);
      state.currentRun.stallWarningMs = Number(data.stallWarningMs || 0);
      state.currentRun.safeRestartMs = Number(data.safeRestartMs || 0);
      state.currentRun.stallTimeoutMs = Number(data.stallTimeoutMs || 0);
      state.currentRun.toolIdleTimeoutMs = Number(data.toolIdleTimeoutMs || 0);
      state.currentRun.postToolIdleTimeoutMs = Number(data.postToolIdleTimeoutMs || 0);
      state.currentRun.watchdogRecoveryLimit = Number(data.watchdogRecoveryLimit || 0);
      state.currentRun.watchdogRecoveryCount = Number(data.watchdogRecoveryCount || 0);
      state.currentRun.pid = data.pid || null;
      state.currentRun.backendMissingSince = 0;
      state.currentRun.approvalAutoEnabled = data.autoApprovalEnabled === true;
    }
    noteRunProgress("Codex 已启动");
    rememberCurrentThought("正在分析任务", "Codex 已启动，正在分析你的指令并选择执行步骤");
    setStatus("已启动");
    showLiveThought("正在思考运行", "Codex 已启动，正在分析你的指令");
    const continueText = data.continueFrom ? `\n续问历史: ${data.continueFrom.id} | ${data.continueFrom.promptPreview || ""}` : "";
    const addDirsText = Array.isArray(data.addDirs) && data.addDirs.length
      ? `\n附加可写目录:\n${data.addDirs.map((item) => `- ${item}`).join("\n")}`
      : "\n附加可写目录: 无";
    const providerProxyText = data.providerProxyBaseUrl
      ? `\n模型代理: ${data.providerProxyBaseUrl}`
      : "\n模型代理: 未启用";
    const maintenanceDetail = data.maintenanceContext && data.maintenance
      ? `\n维护上下文: 已载入\n维护记录: ${data.maintenance.sourceFile || data.maintenance.file || "-"}`
      : "\n维护上下文: 未启用";
    const watchdogDetail = `\n自检策略: ${durationText(data.selfCheckMs)}无事件后自检；整轮任务最多状态感知恢复 ${data.watchdogRecoveryLimit || 0} 次，每次换方法取得新证据；最终超时 ${durationText(data.stallTimeoutMs)}`;
    const approvalDetail = data.fullAccess
      ? `\n权限策略: 完全执行、无需人工批准；异常授权等待${data.autoApprovalEnabled ? `将在 ${durationText(data.autoApprovalDelayMs)} 后自动恢复` : "等待界面处理"}`
      : "\n权限策略: 非交互工作区沙箱；越权时尝试替代方案或进入授权恢复界面";
    appendReasoning("ready", "启动", `会话 ${data.runId}\n工作目录: ${data.workspace}\n智能体: ${agentLabel}\n模型: ${modelLabel}\n推理强度: ${reasoningLabel}${addDirsText}${providerProxyText}\nMCP 工具: ${mcpText}${maintenanceDetail}${watchdogDetail}${approvalDetail}${continueText}\n${data.command || ""}`, data);
    if (data.approvalDowngraded === true) {
      appendReasoning("warning", "已关闭交互批准", "网页客户端不支持 Codex 交互批准弹窗，本次已自动改为非交互运行，避免任务卡在等待确认。", data);
    } else {
      appendReasoning("policy", data.fullAccess ? "完全执行权限" : "非交互权限模式", data.fullAccess ? "当前任务已取消 Codex 文件沙箱并关闭人工批准；仍受 Windows 进程令牌、账号凭据和硬件现场条件限制。" : "当前任务不等待 Codex 弹窗；异常授权等待会显示恢复或停止操作。", data);
    }
    return;
  }

  if (eventName === "heartbeat") {
    const seconds = Math.round((data.elapsedMs || 0) / 1000);
    if (state.currentRun) {
      state.currentRun.serverIdleMs = Number(data.idleMs || 0);
      state.currentRun.lastHeartbeatAt = Date.now();
      state.currentRun.stallWarning = data.stalled === true;
      state.currentRun.selfChecking = data.selfChecking === true;
      state.currentRun.selfCheckMs = Number(data.selfCheckMs || state.currentRun.selfCheckMs || 0);
      state.currentRun.selfCheckCount = Number(data.selfCheckCount || state.currentRun.selfCheckCount || 0);
      state.currentRun.stallWarningMs = Number(data.warningMs || state.currentRun.stallWarningMs || 0);
      state.currentRun.stallTimeoutMs = Number(data.timeoutMs || state.currentRun.stallTimeoutMs || 0);
      state.currentRun.toolWaiting = data.toolWaiting === true;
      state.currentRun.toolIdleTimeoutMs = Number(data.toolIdleTimeoutMs || state.currentRun.toolIdleTimeoutMs || 0);
      state.currentRun.postToolIdleTimeoutMs = Number(data.postToolIdleTimeoutMs || state.currentRun.postToolIdleTimeoutMs || 0);
      state.currentRun.waitKind = data.waitKind || state.currentRun.waitKind || "model";
      state.currentRun.waitLabel = data.waitLabel || state.currentRun.waitLabel || "";
      state.currentRun.effectiveTimeoutMs = Number(data.effectiveTimeoutMs || state.currentRun.effectiveTimeoutMs || 0);
      state.currentRun.watchdogRecoveryCount = Number(data.watchdogRecoveryCount || state.currentRun.watchdogRecoveryCount || 0);
      state.currentRun.watchdogRecoveryLimit = Number(data.watchdogRecoveryLimit || state.currentRun.watchdogRecoveryLimit || 0);
      state.currentRun.lastEventDetail = data.lastEventDetail || state.currentRun.lastEventDetail || "";
      state.currentRun.lastProgressLabel = data.lastEventName || state.currentRun.lastProgressLabel || "";
    }
    const currentRun = state.currentRun || {};
    if (currentRun.turnCompleted || currentRun.turnFailed) {
      const failed = currentRun.turnFailed === true;
      setStatus(failed ? "推理失败，正在收尾" : "推理完成，正在收尾");
      setThinking(
        failed ? "推理失败，正在收尾" : "推理完成，正在收尾",
        runningDetail(failed ? "已收到失败事件，正在等待 Codex 进程退出并保存错误记录" : "已收到完成事件，正在等待 Codex 进程退出并保存历史"),
        true,
        failed ? "warning" : ""
      );
      return;
    }
    if (currentRun.resultReceived) {
      setStatus("已收到结果，正在收尾");
      setThinking(
        "已收到结果，正在收尾",
        runningDetail("结果已进入结果框，正在等待 Codex 完成事件和历史保存"),
        true
      );
      return;
    }
    if (data.stalled === true) {
      const timeoutMs = Number(data.effectiveTimeoutMs || data.timeoutMs || 0);
      const remaining = Math.max(0, timeoutMs - Number(data.idleMs || 0));
      setStatus("可能卡住");
      setThinking(
        data.waitLabel || (data.toolWaiting === true ? "本地工具调用未返回" : "任务可能卡住"),
        `已 ${durationText(data.idleMs)} 没有新进展${remaining ? `，${durationText(remaining)}后自动恢复` : ""}`,
        true,
        "warning"
      );
    } else if (data.selfChecking === true) {
      const remaining = Math.max(0, Number(data.effectiveTimeoutMs || 0) - Number(data.idleMs || 0));
      setStatus("正在自检");
      setThinking(
        "长时间无响应，正在自检",
        `${data.waitLabel || "正在判断等待阶段"}；已 ${durationText(data.idleMs)} 无新事件${remaining ? `，${durationText(remaining)}后自动恢复` : ""}`,
        true,
        "warning"
      );
    } else {
      setStatus("正在思考运行");
      showLiveThought("正在思考运行", "Codex 正在处理", `已运行 ${seconds} 秒`);
    }
    return;
  }

  if (eventName === "stalled") {
    if (state.currentRun) {
      state.currentRun.serverIdleMs = Number(data.idleMs || 0);
      state.currentRun.lastHeartbeatAt = Date.now();
      state.currentRun.stallWarning = true;
      state.currentRun.selfChecking = true;
      state.currentRun.stallWarningMs = Number(data.warningMs || state.currentRun.stallWarningMs || 0);
      state.currentRun.stallTimeoutMs = Number(data.timeoutMs || state.currentRun.stallTimeoutMs || 0);
      state.currentRun.toolWaiting = data.toolWaiting === true || data.toolIdle === true;
      state.currentRun.toolIdleTimeoutMs = Number(data.toolIdleTimeoutMs || state.currentRun.toolIdleTimeoutMs || 0);
      state.currentRun.postToolIdleTimeoutMs = Number(data.postToolIdleTimeoutMs || state.currentRun.postToolIdleTimeoutMs || 0);
      state.currentRun.waitKind = data.waitKind || state.currentRun.waitKind || "";
      state.currentRun.waitLabel = data.waitLabel || state.currentRun.waitLabel || "";
      state.currentRun.effectiveTimeoutMs = Number(data.effectiveTimeoutMs || state.currentRun.effectiveTimeoutMs || 0);
      state.currentRun.lastEventDetail = data.lastEventDetail || state.currentRun.lastEventDetail || "";
    }
    const title = data.interactionRequired === true
      ? "检测到交互等待，已自动停止"
      : data.toolIdle === true
        ? "工具链无进展，已自动停止"
        : data.autoStopped ? "任务无进展，已自动停止" : "任务可能卡住";
    const detail = [
      data.message || "Codex 长时间没有新进展。",
      `无进展时间: ${durationText(data.idleMs)}`,
      data.toolIdle === true && data.toolIdleTimeoutMs ? `本地工具超时: ${durationText(data.toolIdleTimeoutMs)}` : "",
      data.waitLabel ? `等待阶段: ${data.waitLabel}` : "",
      data.lastEventName ? `最后事件: ${data.lastEventName}` : "",
      data.lastEventDetail ? `事件内容: ${data.lastEventDetail}` : ""
    ].filter(Boolean).join("\n");
    appendReasoning("stalled", title, detail, data);
    setStatus(data.autoStopped ? "已自动停止" : "可能卡住");
    setThinking(title, detail.replace(/\n/g, "；"), !data.autoStopped, "warning");
    if (data.autoStopped) {
      rememberRunError(detail);
    }
    return;
  }

  if (eventName === "codex") {
    const formatted = readableCodexEvent(data);
    const type = eventType(data).toLowerCase();
    noteRunProgress(formatted.title, formatted.text);
    if (isResultEvent(data)) {
      if (state.currentRun) {
        state.currentRun.resultReceived = true;
      }
      updateContinueRunButtonState();
      elements.resultStatus.textContent = "收到结果";
      setStatus("已收到结果，正在收尾");
      setThinking("已收到结果，正在收尾", runningDetail("结果已进入结果框，正在等待 Codex 完成事件和历史保存"), true);
      appendResult("result", formatted.title, formatted.text, data);
    } else if (type === "turn.completed" || type === "turn.failed") {
      if (state.currentRun) {
        state.currentRun.turnCompleted = type === "turn.completed";
        state.currentRun.turnFailed = type === "turn.failed";
      }
      updateContinueRunButtonState();
      const completed = type === "turn.completed";
      setStatus(completed ? "推理完成，正在收尾" : "推理失败，正在收尾");
      setThinking(
        completed ? "推理完成，正在收尾" : "推理失败，正在收尾",
        runningDetail(completed ? "已收到完成事件，正在等待 Codex 进程退出并保存历史" : "已收到失败事件，正在等待 Codex 进程退出并保存错误记录"),
        true,
        completed ? "" : "warning"
      );
      appendReasoning("codex", formatted.title, formatted.text, data);
    } else {
      if (isErrorEvent(data)) {
        rememberRunError(formatted.text);
      }
      const visibleDetail = compactVisibleThought(formatted.text) || `Codex 正在处理: ${formatted.title}`;
      rememberCurrentThought(formatted.title, visibleDetail);
      setStatus("正在处理事件");
      showLiveThought("正在思考运行", visibleDetail, `已运行 ${elapsedText()}`);
      appendReasoning("codex", formatted.title, formatted.text, data);
    }
    return;
  }

  if (eventName === "stdout") {
    noteRunProgress("收到标准输出", data.text || "");
    elements.resultStatus.textContent = "收到输出";
    appendResult("stdout", "输出", data.text || "");
    return;
  }

  if (eventName === "stderr") {
    noteRunProgress("收到错误输出", data.text || "");
    rememberRunError(data.text || "");
    appendReasoning("stderr", "错误输出", data.text || "");
    return;
  }

  if (eventName === "error") {
    noteRunProgress("Codex 进程错误", data.message || "");
    rememberRunError(data.message || JSON.stringify(data));
    appendReasoning("error", "错误", data.message || JSON.stringify(data));
    setThinking("运行出错", data.message || "Codex 返回错误", false);
    return;
  }

  if (eventName === "exit") {
    hideApprovalPrompt();
    const seconds = Math.max(0, Math.round((data.durationMs || 0) / 1000));
    const code = data.code == null ? data.signal : data.code;
    const toolIdle = data.reason === "tool-idle" || data.signal === "TOOL_IDLE_TIMEOUT";
    const postToolIdle = data.reason === "post-tool-idle";
    const interactionRequired = data.reason === "interaction-required" || data.signal === "INTERACTION_REQUIRED";
    const approvalAborted = data.approvalAbortDetected === true;
    if (data.stopped === true) {
      if (isQueuedContinuationRequest()) {
        recoverResultFromReasoningEvents();
        appendReasoning("exit", "当前结果已收尾", "正在保存当前结果，保存完成后继续下一轮追问");
        setStatus("正在保存当前结果");
        setThinking("正在保存当前结果", "保存完成后会把本轮结果作为上下文继续追问", true);
        elements.resultStatus.textContent = state.resultTexts.length ? "正在保存" : "未捕获到最终结果";
        const continuationStatus = state.currentRun && state.currentRun.turnFailed
          ? "failed"
          : state.currentRun && (state.currentRun.resultReceived || state.currentRun.turnCompleted)
            ? "completed"
            : "stopped";
        state.saveHistoryPromise = saveHistoryRecord(continuationStatus, { durationMs: data.durationMs });
      } else if (state.runningSupplementRestart) {
        appendReasoning("exit", "旧推理已停止", "正在带入运行中补充重新启动推理");
        setStatus("正在带补充重新推理");
        setThinking("正在带补充重新推理", "旧推理已停止，正在启动包含补充说明的新任务", true);
        elements.resultStatus.textContent = "正在重启";
      } else {
        appendReasoning("exit", "停止", `当前任务已停止\n耗时: ${seconds} 秒`);
        setStatus("已停止");
        setThinking("已停止", "当前任务已被手动停止", false);
        elements.resultStatus.textContent = "已停止";
        state.saveHistoryPromise = saveHistoryRecord("stopped", { durationMs: data.durationMs });
      }
      if (state.currentRun) {
        state.currentRun.exitSeen = true;
      }
      updateContinueRunButtonState();
      return;
    }
    recoverResultFromReasoningEvents();
    appendReasoning("exit", "结束", `退出状态: ${code}\n耗时: ${seconds} 秒`);
    setStatus(data.stalled ? (approvalAborted ? "外层授权已取消" : interactionRequired ? "交互等待已停止" : (toolIdle || postToolIdle) ? "工具链超时已停止" : "无进展已停止") : (data.code === 0 ? "运行完成" : "运行结束"));
    setThinking(
      data.stalled ? (approvalAborted ? "外层授权已取消，本轮已停止" : interactionRequired ? "检测到无法处理的交互等待，已自动停止" : (toolIdle || postToolIdle) ? "工具链无进展，已自动停止" : "任务无进展，已自动停止") : (data.code === 0 ? "运行完成" : "运行结束"),
      data.stalled ? (approvalAborted ? "不会再次自动重试或原样重放同一命令" : `连续 ${durationText(data.idleMs)} 没有新进展`) : `总耗时 ${seconds} 秒`,
      false,
      data.stalled ? "warning" : ""
    );
    const errorText = runErrorSummary();
    const failure = data.stalled
      ? {
          kind: "stalled",
          status: approvalAborted ? "外层授权已取消" : interactionRequired ? "交互等待已停止" : (toolIdle || postToolIdle) ? "工具链超时已停止" : "无进展已停止",
          title: approvalAborted ? "外层宿主取消了授权" : interactionRequired ? "任务要求人工确认或输入" : (toolIdle || postToolIdle) ? "工具链长时间无进展" : "任务长时间无进展",
          text: [
            approvalAborted
              ? "外层授权已取消；客户端已经终止本轮，并禁止 watchdog 重放同一命令。客户端不能替外层 Codex 宿主点击 Yes。"
              : interactionRequired
              ? "客户端检测到权限确认或人工输入等待；授权恢复不可用或次数已用完，因此已自动结束，避免界面卡死。"
              : (toolIdle || postToolIdle)
                ? "Codex 工具链长时间没有继续返回进展，客户端已自动结束任务。"
                : "Codex 长时间没有返回新的模型或工具事件，客户端已自动结束任务，避免无限等待。",
            `无进展时间: ${durationText(data.idleMs)}`,
            data.lastEventName ? `最后事件: ${data.lastEventName}` : "",
            data.lastEventDetail ? `事件内容: ${data.lastEventDetail}` : "",
            approvalAborted
              ? "如需继续，请重新发起任务并在外层只确认一次；也可以改用不需要该外层授权的方法。"
              : interactionRequired
              ? "客户端默认使用完全执行权限；如果仍需 Windows 管理员令牌、账号凭据或硬件现场确认，必须由外部条件满足后重新运行。"
              : (toolIdle || postToolIdle)
                ? "客户端已经使用过一次状态感知恢复；为避免无限循环，本次不再自动重启。"
                : "可以检查最后一条事件后重新运行。"
          ].filter(Boolean).join("\n")
        }
      : classifyRunFailure(errorText, data);
    elements.resultStatus.textContent = state.resultTexts.length ? "完成" : (failure ? failure.status : "未捕获到最终结果");
    if (!state.resultTexts.length) {
      appendResult(
        failure ? "error" : "empty",
        failure ? failure.title : "未捕获到最终结果",
        failure ? failure.text : "Codex 已结束，但没有输出最终回答。完整过程请查看运行推理框。"
      );
    }
    if (state.currentRun) {
      state.currentRun.exitSeen = true;
    }
    updateContinueRunButtonState();
    state.saveHistoryPromise = saveHistoryRecord(data.code === 0 && !data.stalled ? "completed" : "failed", { durationMs: data.durationMs });
    return;
  }

  appendReasoning("event", eventName, JSON.stringify(data, null, 2));
}

function parseSseBlock(block) {
  const lines = block.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  const eventName = eventLine ? eventLine.slice(6).trim() : "message";
  const dataText = dataLines.map((line) => line.slice(5).trimStart()).join("\n");
  if (!dataText) {
    return;
  }
  try {
    handleStreamEvent(eventName, JSON.parse(dataText));
  } catch {
    handleStreamEvent(eventName, { text: dataText });
  }
}

function selectedRunOptions(options = {}) {
  const mode = RUN_MODES[state.mode] || RUN_MODES.write;
  const requestedReasoningEffort = knownReasoningEffort(state.reasoningEffort);
  const reasoningEffort = resolveAutomaticReasoningEffort(
    requestedReasoningEffort,
    options.prompt || "",
    options.workspaceContext || null,
    options
  );
  return {
    mode: state.mode,
    sandbox: mode.sandbox,
    approval: mode.approval,
    requestedReasoningEffort,
    reasoningEffort
  };
}

function selectedMcpTools() {
  const tools = [];
  if (elements.codesysMcpToggle.checked && elements.codesysMcpToggle.dataset.available !== "0") {
    tools.push("codesys");
  }
  if (elements.autocadMcpToggle.checked && elements.autocadMcpToggle.dataset.available !== "0") {
    tools.push("autocad");
  }
  return tools;
}

function mcpToolsText(tools) {
  if (!tools || !tools.length) {
    return "未启用";
  }
  return tools.map((name) => MCP_LABELS[name] || name).join("、");
}

function trimContextText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  const headLength = Math.max(0, Math.floor(maxChars * 0.58));
  const tailLength = Math.max(0, maxChars - headLength);
  return [
    text.slice(0, headLength),
    "",
    `[中间内容已截断，原始长度 ${text.length} 字符，保留头部 ${headLength} 字符和尾部 ${tailLength} 字符]`,
    "",
    text.slice(-tailLength)
  ].join("\n");
}

function textFromElement(element) {
  if (!element) {
    return "";
  }
  if ("value" in element) {
    return String(element.value || "");
  }
  return String(element.innerText || element.textContent || "");
}

function engineeringWorkspaceHasContent(context) {
  if (!context) {
    return false;
  }
  return Boolean(
    context.codesys.projectPath ||
    context.codesys.exportPath ||
    context.codesys.exportText ||
    context.python.root ||
    context.python.script ||
    context.python.codePath ||
    context.python.codeText ||
    context.plc.output ||
    context.git.codesysRoot ||
    context.git.pythonRoot ||
    context.result.text
  );
}

function buildEngineeringWorkspaceContext() {
  const codesysText = textFromElement(elements.codesysExportText);
  const pythonText = textFromElement(elements.pythonCodeText);
  const plcOutput = textFromElement(elements.plcLinkOutput);
  const pythonOutput = textFromElement(elements.pythonRunOutput);
  const resultText = textFromElement(elements.resultLog);
  const reasoningText = state.reasoningTexts.join("\n\n");
  return {
    capturedAt: new Date().toISOString(),
    title: "工程工作区",
    workspace: deriveWorkspace() || (elements.workspaceInput ? elements.workspaceInput.value.trim() : ""),
    run: {
      status: elements.runStatus ? elements.runStatus.textContent : "",
      meta: elements.runMeta ? elements.runMeta.textContent : "",
      thinking: elements.thinkingDetail ? elements.thinkingDetail.textContent : ""
    },
    git: {
      codesysRoot: elements.codesysGitRoot ? elements.codesysGitRoot.value.trim() : "",
      codesysStatus: elements.codesysGitStatusText ? elements.codesysGitStatusText.textContent : "",
      pythonRoot: elements.pythonGitRoot ? elements.pythonGitRoot.value.trim() : "",
      pythonPaths: elements.pythonGitPaths ? elements.pythonGitPaths.value.trim() : "",
      pythonStatus: elements.pythonGitStatusText ? elements.pythonGitStatusText.textContent : ""
    },
    codesys: {
      status: elements.codesysPanelStatus ? elements.codesysPanelStatus.textContent : "",
      projectDirectory: elements.codesysProjectDirectory ? elements.codesysProjectDirectory.value.trim() : "",
      projectPath: selectedCodesysProjectPath(),
      exportPath: elements.codesysExportPath ? elements.codesysExportPath.value.trim() : "",
      saveAsPath: elements.codesysSaveAsPath ? elements.codesysSaveAsPath.value.trim() : "",
      projectSwitchStatus: elements.codesysProjectSwitchStatus ? elements.codesysProjectSwitchStatus.textContent : "",
      buildMode: elements.codesysBuildMode ? elements.codesysBuildMode.value : "",
      exportText: trimContextText(codesysText, 24000)
    },
    plc: {
      status: elements.plcLinkStatus ? elements.plcLinkStatus.textContent : "",
      pythonRoot: elements.plcPythonRoot ? elements.plcPythonRoot.value.trim() : "",
      localIp: elements.plcPythonLocalIp ? elements.plcPythonLocalIp.value.trim() : "",
      pythonScript: elements.plcPythonScript ? elements.plcPythonScript.value.trim() : "",
      registerMap: elements.plcRegisterMap ? elements.plcRegisterMap.value.trim() : "",
      deviceName: elements.plcDeviceName ? elements.plcDeviceName.value.trim() : "",
      output: trimContextText(plcOutput, 10000)
    },
    python: {
      status: elements.pythonCodeStatus ? elements.pythonCodeStatus.textContent : "",
      root: elements.plcPythonRoot ? elements.plcPythonRoot.value.trim() : "",
      localIp: elements.plcPythonLocalIp ? elements.plcPythonLocalIp.value.trim() : "",
      script: elements.plcPythonScript ? elements.plcPythonScript.value.trim() : "",
      codePath: elements.pythonCodePath ? elements.pythonCodePath.value.trim() : "",
      runArgs: elements.pythonRunArgs ? elements.pythonRunArgs.value.trim() : "",
      codeText: trimContextText(pythonText, 24000),
      runOutput: trimContextText(pythonOutput, 8000)
    },
    result: {
      status: elements.resultStatus ? elements.resultStatus.textContent : "",
      text: trimContextText(resultText, 6000)
    },
    reasoning: {
      text: trimContextText(reasoningText, 6000)
    }
  };
}

async function runCodex(options = {}) {
  if (state.running) {
    requestRunningPromptHandoff();
    return false;
  }

  const prompt = String(options.promptOverride != null ? options.promptOverride : elements.promptInput.value).trim();
  if (!prompt) {
    setStatus("请输入指令");
    elements.promptInput.focus();
    return;
  }
  const continueFromRecord = state.continueFromRecord;
  const workspace = deriveWorkspace() || elements.workspaceInput.value;
  const workspaceContext = buildEngineeringWorkspaceContext();
  state.agentProfile = elements.agentSelect && AGENT_LABELS[elements.agentSelect.value] ? elements.agentSelect.value : "auto";
  elements.workspaceInput.value = workspace;

  localStorage.setItem(state.lastPromptKey, prompt);
  localStorage.setItem(state.lastWorkspaceKey, workspace);
  localStorage.setItem(state.lastModeKey, state.mode);
  localStorage.setItem(state.lastAgentKey, state.agentProfile);
  localStorage.setItem(state.lastReasoningKey, state.reasoningEffort);
  localStorage.setItem(state.autoApprovalKey, elements.autoApprovalToggle.checked ? "1" : "0");
  localStorage.setItem(state.autoApprovalDelayKey, String(Math.max(3, Math.min(120, Number(elements.autoApprovalDelay.value || 10)))));
  localStorage.setItem(state.lastModelKey, elements.modelSelect.value);
  localStorage.setItem(state.customModelKey, elements.modelInput.value.trim());
  persistMcpSelection();

  const runOptions = selectedRunOptions({ prompt, workspaceContext, continueFromRecord });
  const modelChoice = selectedModelChoice(runOptions.reasoningEffort);
  const mcpTools = selectedMcpTools();
  const payload = {
    workspace,
    pythonRoot: elements.plcPythonRoot ? elements.plcPythonRoot.value.trim() : "",
    projectDirectory: elements.codesysProjectDirectory ? elements.codesysProjectDirectory.value.trim() : "",
    projectPath: selectedCodesysProjectPath(),
    workspaceContext,
    prompt,
    agentProfile: state.agentProfile,
    model: modelChoice.model,
    requestedModel: modelChoice.requestedModel,
    modelMode: modelChoice.modelMode,
    webSearch: true,
    ephemeral: false,
    maintenanceContext: true,
    autoApprovalEnabled: elements.autoApprovalToggle.checked,
    autoApprovalDelayMs: Math.max(3, Math.min(120, Number(elements.autoApprovalDelay.value || 10))) * 1000,
    mcpTools,
    continueFromId: continueFromRecord ? continueFromRecord.id : "",
    ...runOptions
  };

  if (continueFromRecord) {
    resetRunBuffers({ preserveResultLog: true });
    prepareContinuationResultLog(continueFromRecord);
  } else {
    resetRunBuffers();
  }
  state.currentRun = {
    prompt,
    workspace: payload.workspace,
    mode: runOptions.mode,
    sandbox: runOptions.sandbox,
    approval: runOptions.approval,
    requestedReasoningEffort: runOptions.requestedReasoningEffort,
    reasoningEffort: runOptions.reasoningEffort,
    agentProfile: state.agentProfile,
    activeAgentProfile: "",
    agentLabel: AGENT_LABELS[state.agentProfile] || "自动总控",
    model: payload.model,
    requestedModel: payload.requestedModel,
    modelMode: payload.modelMode,
    modelSource: payload.modelMode,
    provider: state.codexConfig,
    mcpTools,
    webSearch: payload.webSearch,
    ephemeral: payload.ephemeral,
    maintenanceContext: payload.maintenanceContext,
    parentHistoryId: continueFromRecord ? continueFromRecord.id : "",
    parentPromptPreview: continueFromRecord ? continueFromRecord.promptPreview : "",
    parentResultPreview: continueFromRecord ? continueFromRecord.resultPreview : "",
    basePrompt: options.basePrompt || prompt,
    runningSupplements: Array.isArray(options.supplements) ? options.supplements.slice() : [],
    lastProgressAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    backendMissingSince: 0,
    clientAbortReason: "",
    currentThoughtTitle: "正在启动 Codex",
    currentThoughtDetail: "正在建立模型连接并准备工程上下文",
    currentThoughtAt: Date.now(),
    approvalAutoEnabled: payload.autoApprovalEnabled,
    approvalDeadlineAt: 0,
    pid: null,
    serverIdleMs: 0,
    stallWarning: false,
    selfChecking: false,
    selfCheckMs: 0,
    selfCheckCount: 0,
    stallWarningMs: 0,
    stallTimeoutMs: 0,
    safeRestartMs: 0,
    effectiveTimeoutMs: 0,
    waitKind: "model",
    waitLabel: "等待模型响应",
    watchdogRecoveryCount: 0,
    watchdogRecoveryLimit: 0,
    toolWaiting: false,
    toolIdleTimeoutMs: 0,
    postToolIdleTimeoutMs: 0,
    resultReceived: false,
    turnCompleted: false,
    turnFailed: false,
    lastProgressLabel: "正在启动",
    lastEventDetail: ""
  };
  state.historySaved = false;
  state.historySaving = false;
  state.saveHistoryPromise = null;
  state.startedAt = Date.now();
  hideApprovalPrompt();
  setRunning(true);
  updateContinueRunButtonState();
  startTicker();
  startRunReconcileTimer();
  setStatus("正在启动");
  setThinking("正在启动 Codex", `智能体: ${AGENT_LABELS[state.agentProfile] || "自动总控"}，MCP: ${mcpToolsText(mcpTools)}${continueFromRecord ? "，已带入历史上下文" : ""}`, true);
  elements.resultStatus.textContent = "等待结果";
  elements.runMeta.textContent = "启动中";
  if (continueFromRecord) {
    const contextText = continuationContextText(continueFromRecord, prompt, {
      questionChars: 1200,
      answerChars: 2600,
      promptChars: 1200
    });
    updateContinueContextText(continueFromRecord, prompt);
    appendReasoning("continue", "续问上下文", contextText, continueFromRecord, false);
    appendResult("continue-question", "本次追问", prompt, null, false);
    elements.resultStatus.textContent = "已保留历史模型回答，等待新回答";
  }
  if (state.currentRun.runningSupplements.length) {
    appendReasoning("supplement", "运行中补充已合并", state.currentRun.runningSupplements
      .map((item, index) => `补充 ${index + 1}：\n${item}`)
      .join("\n\n"));
  }

  const controller = new AbortController();
  state.controller = controller;

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || response.statusText);
    }

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
        parseSseBlock(block);
      }
    }

    if (buffer.trim()) {
      parseSseBlock(buffer);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      if (state.currentRun && state.currentRun.clientAbortReason === "backend-finished") {
        const failed = state.currentRun.turnFailed === true;
        recoverResultFromReasoningEvents();
        setStatus(failed ? "推理失败，已收尾" : "运行完成");
        setThinking(
          failed ? "推理失败，已收尾" : "运行完成",
          failed ? "后台已结束，错误记录已进入历史保存流程" : "后台已结束，结果已进入历史保存流程",
          false,
          failed ? "warning" : ""
        );
        elements.resultStatus.textContent = state.resultTexts.length ? (failed ? "失败" : "完成") : "未捕获到最终结果";
      } else if (state.currentRun && state.currentRun.clientAbortReason === "backend-lost") {
        const detail = [
          "后端活动任务表里已经找不到当前 Codex runId，说明子进程已结束、服务已重启，或 SSE 连接丢失。",
          state.currentRun.runId ? `runId: ${state.currentRun.runId}` : "",
          state.currentRun.pid ? `PID: ${state.currentRun.pid}` : "",
          state.currentRun.lastProgressLabel ? `最后进展: ${state.currentRun.lastProgressLabel}` : "",
          state.currentRun.lastEventDetail ? `事件内容: ${state.currentRun.lastEventDetail}` : ""
        ].filter(Boolean).join("\n");
        rememberRunError(detail);
        appendReasoning("error", "后台任务已结束或连接丢失", detail);
        setStatus("后台任务已结束");
        setThinking("后台任务已结束或连接丢失", "客户端已自动结束这次运行状态，可以重新提交。", false, "warning");
        elements.resultStatus.textContent = "运行状态已收尾";
        if (!state.resultTexts.length) {
          appendResult("error", "后台任务已结束或连接丢失", detail);
        }
        await saveHistoryRecord("failed");
      } else if (isQueuedContinuationRequest()) {
        recoverResultFromReasoningEvents();
        setStatus("正在保存当前结果");
        setThinking("正在保存当前结果", "连接已结束，保存完成后会继续下一轮追问", true);
        const continuationStatus = state.currentRun && state.currentRun.turnFailed ? "failed" : "completed";
        state.saveHistoryPromise = saveHistoryRecord(continuationStatus);
      } else if (state.runningSupplementRestart) {
        appendReasoning("supplement", "带补充重新推理", "已停止旧推理，正在用原问题和补充内容重新启动。", null, false);
        setStatus("正在带补充重新推理");
        setThinking("正在带补充重新推理", "旧推理不会保存为历史，下一次完整结果会保存", true);
        elements.resultStatus.textContent = "正在重启";
      } else {
        appendReasoning("exit", "停止", "用户已停止当前任务");
        setStatus("已停止");
        setThinking("已停止", "当前任务已被手动停止", false);
        elements.resultStatus.textContent = "已停止";
        await saveHistoryRecord("stopped");
      }
    } else {
      rememberRunError(error.message);
      const failure = classifyRunFailure(runErrorSummary() || error.message, { code: "fetch" });
      appendReasoning("error", "错误", error.message);
      setStatus("运行失败");
      setThinking("运行失败", error.message, false);
      elements.resultStatus.textContent = failure ? failure.status : "失败";
      if (!state.resultTexts.length) {
        appendResult(
          "error",
          failure ? failure.title : "运行失败",
          failure ? failure.text : error.message
        );
      }
      await saveHistoryRecord("failed");
    }
  } finally {
    let savedRecord = null;
    if (state.saveHistoryPromise) {
      savedRecord = await state.saveHistoryPromise.catch(() => null);
      state.saveHistoryPromise = null;
    }
    const restartRequest = state.runningSupplementRestart;
    state.runningSupplementRestart = null;
    state.controller = null;
    setRunning(false);
    updateContinueRunButtonState();
    stopTicker();
    stopRunReconcileTimer();
    if (isQueuedContinuationRequest(restartRequest)) {
      const continuationRecord = savedRecord || (state.historySaved ? state.lastSavedRecord : null);
      if (continuationRecord && continuationRecord.id) {
        setContinueContext(continuationRecord, { clearPrompt: false, focus: false });
        runCodex({ promptOverride: restartRequest.prompt }).catch((error) => {
          elements.promptInput.value = restartRequest.prompt;
          appendReasoning("error", "续问启动失败", error.message);
          setStatus("续问启动失败");
          setThinking("续问启动失败", error.message, false);
        });
      } else {
        elements.promptInput.value = restartRequest.prompt;
        localStorage.setItem(state.lastPromptKey, restartRequest.prompt);
        setStatus("当前结果保存失败，续问尚未启动");
        setThinking("当前结果保存失败", "已保留追问输入，请先确认历史保存状态后重试", false, "warning");
        elements.historyStatus.textContent = "未取得可续问的已保存记录";
      }
    } else if (restartRequest) {
      if (restartRequest.continueFromRecord) {
        state.continueFromRecord = restartRequest.continueFromRecord;
      }
      runCodex({
        skipReuse: true,
        promptOverride: restartRequest.prompt,
        basePrompt: restartRequest.basePrompt,
        supplements: restartRequest.supplements
      }).catch((error) => {
        appendReasoning("error", "补充重启失败", error.message);
        setStatus("补充重启失败");
        setThinking("补充重启失败", error.message, false);
      });
    }
  }
  return true;
}

function stopCodex() {
  state.runningSupplementRestart = null;
  hideApprovalPrompt();
  setStatus("正在停止");
  setThinking("正在停止", "正在终止当前 Codex 进程和它启动的工具进程", true);
  stopCurrentCodexRun();
}

async function stopCurrentCodexRun() {
  const currentController = state.controller;
  const runId = state.currentRun ? String(state.currentRun.runId || "") : "";
  let stoppedByServer = false;

  if (runId) {
    try {
      const response = await fetch("/api/run/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId })
      });
      const data = await response.json().catch(() => ({}));
      stoppedByServer = response.ok && data.stopped === true;
    } catch {
      stoppedByServer = false;
    }
  }

  if (!stoppedByServer && currentController) {
    currentController.abort();
    return;
  }

  window.setTimeout(() => {
    if (state.running && state.controller === currentController && currentController) {
      currentController.abort();
    }
  }, 2000);
}

async function approveCurrentRecovery() {
  const runId = state.currentRun ? String(state.currentRun.runId || "") : "";
  if (!runId) {
    return;
  }
  elements.approveRecoveryButton.disabled = true;
  setStatus("正在授权恢复");
  setThinking("正在授权恢复", "正在终止等待进程，并以完全权限携带现场状态恢复一次", true, "warning");
  try {
    const response = await fetch("/api/run/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || "授权恢复失败");
    }
    hideApprovalPrompt();
  } catch (error) {
    elements.approveRecoveryButton.disabled = false;
    setStatus("授权恢复失败");
    setThinking("授权恢复失败", error.message, true, "warning");
  }
}

async function syncApprovalPolicyForCurrentRun() {
  const runId = state.currentRun ? String(state.currentRun.runId || "") : "";
  if (!state.running || !runId) {
    return;
  }
  const delayMs = Math.max(3, Math.min(120, Number(elements.autoApprovalDelay.value || 10))) * 1000;
  try {
    const response = await fetch("/api/run/approval-policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        enabled: elements.autoApprovalToggle.checked,
        delayMs
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || "授权策略更新失败");
    }
    if (state.currentRun) {
      state.currentRun.approvalAutoEnabled = data.autoApprovalEnabled === true;
      state.currentRun.approvalDeadlineAt = Number(data.deadlineAt || 0);
    }
    updateApprovalCountdown();
  } catch (error) {
    appendReasoning("warning", "授权策略更新失败", error.message);
  }
}

async function loadDirectories(targetPath) {
  const response = await fetch(`/api/list?path=${encodeURIComponent(targetPath || elements.workspaceInput.value)}`);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "目录读取失败");
  }

  elements.workspaceInput.value = data.path;
  persistWorkspace();
  state.currentParent = data.parent;
  elements.directoryList.textContent = "";

  if (data.entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-entry";
    empty.textContent = "无子目录";
    elements.directoryList.append(empty);
    return;
  }

  for (const entry of data.entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dir-entry";
    button.title = entry.path;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span></span>';
    button.querySelector("span").textContent = entry.name;
    button.addEventListener("click", () => {
      loadDirectories(entry.path).catch((error) => setStatus(error.message));
    });
    elements.directoryList.append(button);
  }
}

async function loadStatus() {
  const response = await fetch("/api/status");
  const data = await response.json();
  const lastWorkspace = localStorage.getItem(state.lastWorkspaceKey);
  const lastPrompt = localStorage.getItem(state.lastPromptKey);
  const lastMode = localStorage.getItem(state.lastModeKey);
  const lastAgent = localStorage.getItem(state.lastAgentKey);
  const lastReasoning = localStorage.getItem(state.lastReasoningKey);
  const autoApproval = localStorage.getItem(state.autoApprovalKey);
  const autoApprovalDelay = localStorage.getItem(state.autoApprovalDelayKey);
  const lastFavoriteOnly = localStorage.getItem(state.historyFavoriteOnlyKey);

  elements.workspaceInput.value = lastWorkspace || data.defaultWorkspace;
  elements.promptInput.value = lastPrompt || "";
  elements.autoApprovalToggle.checked = autoApproval !== "0";
  elements.autoApprovalDelay.value = String(Math.max(3, Math.min(120, Number(autoApprovalDelay || 10))));
  elements.autoApprovalDelay.disabled = !elements.autoApprovalToggle.checked;
  const maintenance = data.maintenance || {};
  state.historyFavoriteOnly = lastFavoriteOnly === "1";
  renderFavoriteFilterState();
  if (RUN_MODES[lastMode]) {
    state.mode = lastMode;
  }
  if (AGENT_LABELS[lastAgent]) {
    state.agentProfile = lastAgent;
  }
  if (elements.agentSelect) {
    elements.agentSelect.value = AGENT_LABELS[state.agentProfile] ? state.agentProfile : "auto";
  }
  renderAgentOptions(data.agentProfiles || []);
  if (REASONING_LABELS[lastReasoning]) {
    state.reasoningEffort = lastReasoning;
  }
  setSegmentValue(elements.modeControl, "mode", state.mode);
  setSegmentValue(elements.reasoningControl, "reasoning", state.reasoningEffort);

  if (data.codex.ok) {
    elements.codexStatus.textContent = data.codex.version || "Codex 可用";
  } else {
    elements.codexStatus.textContent = data.codex.error || "Codex 未就绪";
  }

  const env = data.environment || {};
  const config = env.config || {};
  const auth = env.auth || {};
  state.codexConfig = config;
  renderModelOptions({
    configuredModel: config.model || "",
    models: (config.modelHints || []).map((id) => ({ id, source: "config" })),
    autoModelMap: data.autoModelMap || config.autoModelMap,
    source: "config"
  });
  refreshModelOptions().catch((error) => {
    elements.modelStatus.textContent = error.message;
  });
  if (data.codex.ok && config.exists) {
    const provider = config.modelProvider || "未配置 provider";
    const model = config.model || "默认模型";
    const authText = auth.hasOpenAIKey ? "认证已就绪" : "缺少 API key";
    elements.codexStatus.textContent = `${data.codex.version || "Codex 可用"} | ${provider}/${model} | ${authText}`;
  }

  applyMcpStatus(data.mcp || { integrations: [] });
  await loadCodesysStatus();
  await loadPythonStatus();
  elements.workspaceInput.value = deriveWorkspace() || lastWorkspace || data.defaultWorkspace;
  window.setTimeout(() => {
    refreshHistory().catch(() => {});
  }, 0);
}

async function handleHistoryAction(event) {
  const button = event.target.closest("button[data-history-action]");
  if (!button || state.running) {
    return;
  }

  const action = button.dataset.historyAction;
  const id = button.dataset.historyId;
  if (!id) {
    return;
  }

  try {
    if (action === "favorite") {
      const nextFavorite = button.dataset.favorite === "1";
      await setHistoryFavorite(id, nextFavorite);
      if (state.continueFromRecord && state.continueFromRecord.id === id) {
        state.continueFromRecord.favorite = nextFavorite;
      }
      if (state.lastSavedRecord && state.lastSavedRecord.id === id) {
        state.lastSavedRecord.favorite = nextFavorite;
      }
      elements.historyStatus.textContent = nextFavorite ? "已收藏" : "已取消收藏";
      await refreshHistory();
      return;
    }

    if (action === "delete") {
      const ok = window.confirm("删除这条历史推理记录？");
      if (!ok) {
        return;
      }
      button.disabled = true;
      button.textContent = "删除中";
      elements.historyStatus.textContent = "正在删除历史";
      const removedRecord = state.history.find((record) => record.id === id) || null;
      const response = await fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "删除失败");
      }
      if (state.continueFromRecord && state.continueFromRecord.id === id) {
        clearContinueContext(false);
      }
      if (state.lastSavedRecord && state.lastSavedRecord.id === id) {
        state.lastSavedRecord = null;
        updateContinueRunButtonState();
      }
      state.history = state.history.filter((record) => record.id !== id);
      if (removedRecord) {
        state.historyTotalCount = Math.max(0, state.historyTotalCount - 1);
        if (removedRecord.favorite) {
          state.historyFavoriteCount = Math.max(0, state.historyFavoriteCount - 1);
        }
      }
      renderHistoryList();
      updateHistoryStatusText();
      await refreshHistory();
      elements.historyStatus.textContent = Number(data.deleted || 0) > 0 ? "历史已删除" : "历史记录已不存在，列表已刷新";
      return;
    }

    const record = await loadHistoryRecord(id);
    if (action === "fill") {
      clearContinueContext(false);
      elements.promptInput.value = record.prompt || record.promptPreview || "";
      localStorage.setItem(state.lastPromptKey, elements.promptInput.value);
      setStatus("已填入历史指令");
      return;
    }

    if (action === "continue") {
      showHistoryRecord(record, { setPrompt: false });
      setContinueContext(record);
      return;
    }

    showHistoryRecord(record, { setPrompt: false });
  } catch (error) {
    elements.historyStatus.textContent = error.message;
  }
}

elements.modeControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mode]");
  if (!button || state.running) {
    return;
  }
  state.mode = button.dataset.mode;
  setSegmentValue(elements.modeControl, "mode", state.mode);
});

elements.reasoningControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-reasoning]");
  if (!button || state.running) {
    return;
  }
  state.reasoningEffort = button.dataset.reasoning;
  setSegmentValue(elements.reasoningControl, "reasoning", state.reasoningEffort);
});

elements.agentSelect.addEventListener("change", () => {
  if (state.running) {
    elements.agentSelect.value = state.agentProfile;
    return;
  }
  state.agentProfile = AGENT_LABELS[elements.agentSelect.value] ? elements.agentSelect.value : "auto";
  elements.agentSelect.value = state.agentProfile;
  localStorage.setItem(state.lastAgentKey, state.agentProfile);
});

elements.continueRunButton.addEventListener("click", () => {
  if (state.running) {
    requestRunningPromptHandoff();
    return;
  }

  const record = state.continueFromRecord || state.lastSavedRecord;
  if (!record) {
    setStatus("请先运行一次问题，或从历史记录里选择一条上下文");
    elements.historyStatus.textContent = "暂无可续问上下文";
    updateContinueRunButtonState();
    return;
  }

  const prompt = elements.promptInput.value.trim();
  const originalPrompt = String(record.prompt || record.promptPreview || "").trim();
  const hasNewPrompt = Boolean(prompt && prompt !== originalPrompt);
  if (!state.continueFromRecord || state.continueFromRecord.id !== record.id) {
    setContinueContext(record, {
      clearPrompt: !hasNewPrompt,
      focus: !hasNewPrompt
    });
  }

  if (!hasNewPrompt) {
    setStatus("已进入继续追问模式，请输入新问题");
    elements.historyStatus.textContent = "已选择当前结果，可继续追问";
    elements.promptInput.focus();
    return;
  }

  runCodex();
});
elements.runButton.addEventListener("click", runCodex);
elements.stopButton.addEventListener("click", stopCodex);
elements.approveRecoveryButton.addEventListener("click", approveCurrentRecovery);
elements.approvalStopButton.addEventListener("click", stopCodex);
elements.cancelContinueButton.addEventListener("click", () => clearContinueContext());
elements.clearButton.addEventListener("click", () => {
  if (state.running) {
    elements.promptInput.value = "";
    localStorage.removeItem(state.lastPromptKey);
    setStatus("已清空输入框，当前任务仍在运行");
    elements.promptInput.focus();
    return;
  }

  resetRunBuffers();
  elements.promptInput.value = "";
  localStorage.removeItem(state.lastPromptKey);
  elements.resultLog.innerHTML = '<div class="empty-result">运行完成后，最终回答会显示在这里。</div>';
  elements.runMeta.textContent = "无会话";
  elements.resultStatus.textContent = "等待输出";
  setStatus("已清空");
  setThinking("等待指令", "运行后会显示可见推理摘要、执行过程和状态提示", false);
  state.currentRun = null;
  state.lastSavedRecord = null;
  clearContinueContext(false);
  state.historySaved = false;
  state.historySaving = false;
  updateContinueRunButtonState();
  refreshHistory().catch(() => {});
  elements.promptInput.focus();
});
elements.copyResultButton.addEventListener("click", async () => {
  const text = state.resultTexts.join("\n\n").trim();
  if (!text) {
    elements.resultStatus.textContent = "没有可复制的结果";
    return;
  }
  await navigator.clipboard.writeText(text);
  elements.resultStatus.textContent = "已复制";
});
elements.refreshDirsButton.addEventListener("click", () => {
  loadDirectories(elements.workspaceInput.value).catch((error) => setStatus(error.message));
});
elements.parentDirButton.addEventListener("click", () => {
  loadDirectories(state.currentParent).catch((error) => setStatus(error.message));
});
elements.refreshHistoryButton.addEventListener("click", () => {
  refreshHistory().catch(() => {});
});
elements.clearHistoryButton.addEventListener("click", () => {
  clearNonFavoriteHistory().catch((error) => {
    elements.historyStatus.textContent = error.message;
  });
});
elements.favoriteHistoryToggle.addEventListener("click", () => {
  state.historyFavoriteOnly = !state.historyFavoriteOnly;
  localStorage.setItem(state.historyFavoriteOnlyKey, state.historyFavoriteOnly ? "1" : "0");
  renderFavoriteFilterState();
  refreshHistory().catch(() => {});
});
elements.refreshMcpButton.addEventListener("click", () => {
  refreshMcpStatus().catch(() => {});
});
elements.codesysReadExportButton.addEventListener("click", () => {
  codesysReadExport();
});
elements.codesysAnalyzeExportButton.addEventListener("click", () => {
  codesysAnalyzeExport();
});
elements.codesysGitStatusButton.addEventListener("click", () => {
  codesysGitStatus();
});
elements.codesysGitPullButton.addEventListener("click", () => {
  codesysGitPull();
});
elements.codesysGitSyncButton.addEventListener("click", () => {
  codesysGitSync();
});
elements.pythonGitStatusButton.addEventListener("click", () => {
  pythonGitStatus();
});
elements.pythonGitPullButton.addEventListener("click", () => {
  pythonGitPull();
});
elements.pythonGitSyncButton.addEventListener("click", () => {
  pythonGitSync();
});
elements.codesysInfoButton.addEventListener("click", () => {
  codesysInfo();
});
elements.codesysExportButton.addEventListener("click", () => {
  codesysExportProject();
});
elements.codesysSaveExportButton.addEventListener("click", () => {
  codesysSaveExportClicked();
});
elements.codesysImportButton.addEventListener("click", () => {
  codesysImportProject();
});
elements.codesysBuildButton.addEventListener("click", () => {
  codesysBuildProject();
});
elements.codesysRefreshProjectsButton.addEventListener("click", () => {
  refreshCodesysProjectList();
});
elements.codesysProjectSelect.addEventListener("change", () => {
  switchCodesysProjectFromSelect();
});
elements.plcLinkAnalyzeButton.addEventListener("click", () => {
  plcLinkAnalyze();
});
elements.plcGenerateRegisterMapButton.addEventListener("click", () => {
  plcGenerateRegisterMap();
});
elements.plcReadFeedbackButton.addEventListener("click", () => {
  plcReadFeedback();
});
elements.plcGenerateCommandsButton.addEventListener("click", () => {
  plcGenerateCommands();
});
elements.pythonLoadButton.addEventListener("click", () => {
  pythonLoadFile();
});
elements.pythonSaveButton.addEventListener("click", () => {
  pythonSaveFileClicked();
});
elements.pythonRunButton.addEventListener("click", () => {
  pythonRunFile();
});
elements.pythonStopButton.addEventListener("click", () => {
  pythonStopProcess();
});
elements.pythonUndoButton.addEventListener("click", () => {
  applyPythonEditHistory("undo");
});
elements.pythonRedoButton.addEventListener("click", () => {
  applyPythonEditHistory("redo");
});
elements.pythonCodeText.addEventListener("input", () => {
  schedulePythonEditSnapshot();
  setPythonCodeStatus("有未保存修改");
});
elements.pythonRefreshTreeButton.addEventListener("click", () => {
  refreshPythonRepoTree();
});
elements.refreshModelsButton.addEventListener("click", () => {
  refreshModelOptions().catch((error) => {
    elements.modelStatus.textContent = error.message;
  });
});
elements.modelSelect.addEventListener("change", () => {
  localStorage.setItem(state.lastModelKey, elements.modelSelect.value);
  setCustomModelVisibility();
  if (elements.modelSelect.value === "__custom__") {
    elements.modelInput.focus();
  }
});
elements.modelInput.addEventListener("input", () => {
  localStorage.setItem(state.customModelKey, elements.modelInput.value.trim());
});
elements.historyList.addEventListener("click", handleHistoryAction);
elements.autoApprovalToggle.addEventListener("change", () => {
  elements.autoApprovalDelay.disabled = !elements.autoApprovalToggle.checked;
  localStorage.setItem(state.autoApprovalKey, elements.autoApprovalToggle.checked ? "1" : "0");
  if (elements.autoApprovalToggle.checked && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
  syncApprovalPolicyForCurrentRun();
});
elements.autoApprovalDelay.addEventListener("change", () => {
  const seconds = Math.max(3, Math.min(120, Number(elements.autoApprovalDelay.value || 10)));
  elements.autoApprovalDelay.value = String(seconds);
  localStorage.setItem(state.autoApprovalDelayKey, String(seconds));
  syncApprovalPolicyForCurrentRun();
});
elements.codesysMcpToggle.addEventListener("change", () => {
  persistMcpSelection();
  applyMcpStatus(state.mcpStatus || { integrations: [] });
});
elements.autocadMcpToggle.addEventListener("change", () => {
  persistMcpSelection();
  applyMcpStatus(state.mcpStatus || { integrations: [] });
});
[elements.codesysExportPath, elements.codesysSaveAsPath].forEach((input) => {
  input.addEventListener("change", persistCodesysPaths);
});
elements.codesysProjectDirectory.addEventListener("change", () => {
  const directoryKey = normalizeLocalPathForCompare(elements.codesysProjectDirectory.value).toLowerCase();
  if (directoryKey === state.codesysProjectDirectorySubmitted) {
    return;
  }
  refreshCodesysProjectDirectory().catch(() => {});
  elements.workspaceInput.value = deriveWorkspace() || elements.workspaceInput.value;
});
elements.codesysProjectDirectory.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    refreshCodesysProjectDirectory().catch(() => {});
    elements.workspaceInput.value = deriveWorkspace() || elements.workspaceInput.value;
  }
});
[elements.codesysGitRoot, elements.codesysGitCommitMessage].forEach((input) => {
  input.addEventListener("change", persistCodesysPaths);
});
elements.codesysGitIncludeTarget.addEventListener("change", persistCodesysPaths);
[elements.pythonGitRoot, elements.pythonGitPaths, elements.pythonGitCommitMessage].forEach((input) => {
  input.addEventListener("change", persistPythonGitSettings);
});
[elements.plcPythonRoot, elements.plcPythonLocalIp, elements.plcPythonScript, elements.plcRegisterMap, elements.plcDeviceName, elements.pythonCodePath, elements.pythonRunArgs].forEach((input) => {
  input.addEventListener("change", () => {
    persistPlcLinkSettings();
    if (input === elements.plcPythonLocalIp) {
      localStorage.setItem(state.plcPythonLocalIpManualKey, "1");
      setLocalIpStatus(input.value);
    }
    elements.workspaceInput.value = deriveWorkspace() || elements.workspaceInput.value;
    if (input === elements.plcPythonRoot) {
      setPythonTreeMessage("Python仓库路径已变更，点击“刷新文件树”重新读取");
    }
  });
});
elements.workspaceInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadDirectories(elements.workspaceInput.value).catch((error) => setStatus(error.message));
  }
});
elements.workspaceInput.addEventListener("change", persistWorkspace);
window.addEventListener("pagehide", persistWorkspace);
elements.promptInput.addEventListener("input", () => {
  if (state.continueFromRecord) {
    updateContinueContextText(state.continueFromRecord, elements.promptInput.value.trim());
  }
});
elements.promptInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    if (state.running) {
      requestRunningPromptHandoff();
      return;
    }
    runCodex();
  }
});

initSectionCollapseButtons();
updateContinueRunButtonState();
initInputHeightPersistence();
initPanelResizers();

loadStatus().catch((error) => {
  elements.codexStatus.textContent = "服务异常";
  setStatus(error.message);
  refreshHistory().catch(() => {});
});
