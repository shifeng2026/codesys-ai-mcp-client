'use strict';

// Online (PLC) authorization for the CODESYS workbench.
//
// This module is the single authority for what a TaskHive session may do to a
// real controller. Two invariants matter more than anything else here:
//
//   1. Only `login`, `logout` and `download` are grantable. `online-change`,
//      `write-variable`, `start`, `stop`, `reset`, `debug`, `breakpoint`, `step`
//      and `force` are denied unconditionally — there is deliberately no code
//      path in this file that can turn them on.
//   2. A grant is bound to one workbench window and one project file. Switching
//      projects, closing the workbench or closing the CODESYS window revokes it.
//      The grant carries no timer (the operator chose "valid for this workbench
//      session"), so binding is what keeps it honest.

const fs = require('fs');
const path = require('path');

// CODESYS 暴露 12 项 PLC 在线能力。其中 9 项能通过 ScriptEngine 实现；另外 3 项
// 在本版本（SP20 / ScriptEngine 4.1）**没有任何接口** —— 21.5 MB 官方 API dump 里
// set_breakpoint / remove_breakpoint / step_over / step_into / step_out / debug
// 全部不存在，只有 ApplicationState.halt_on_bp 这个**状态**可读。所以它们不是
// "被禁止"，而是"够不着"。
const ONLINE_CAPABILITIES = Object.freeze([
  'login',
  'logout',
  'download',
  'online-change',
  'write-variable',
  'start',
  'stop',
  'reset',
  'force',
]);

const UNSUPPORTED_ONLINE_CAPABILITIES = Object.freeze(['debug', 'breakpoint', 'step']);

// 三类能驱动机械 / 绕过程序逻辑 / 清保持变量的动作：必须输入确认词才放行。
// 取消强制（unforce）故意**不**列入：把 Force 摘掉是安全方向，不该被加锁。
const HARD_GATED_ONLINE_CAPABILITIES = Object.freeze(['write-variable', 'reset', 'force']);

const HARD_GATE_PHRASE = Object.freeze({
  'write-variable': '写入变量',
  reset: '复位设备',
  force: '强制变量',
});

// ScriptEngine action name -> granted capability.
const ONLINE_ACTION_CAPABILITY = Object.freeze({
  'online-login': 'login',
  'online-logout': 'logout',
  'online-download': 'download',
  'online-change': 'online-change',
  'online-start': 'start',
  'online-stop': 'stop',
  'online-reset': 'reset',
  'online-write': 'write-variable',
  'online-force': 'force',
  // 取消强制复用的是 force 能力（必须先有强制权限），但确认强度只按普通档。
  'online-unforce': 'force',
});

function normalizeProjectPath(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const resolved = path.resolve(text);
  // Windows project paths are case-insensitive; comparing them literally would
  // let "C:\Plc\A.project" and "c:\plc\a.project" look like two projects.
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function baseName(value) {
  const text = String(value || '').trim();
  return text ? path.basename(text) : '';
}

function containsUnsavedMarker(windowTitle) {
  return String(windowTitle || '').includes('*');
}

function createOnlineAuthorizationStore(options = {}) {
  const auditPath = options.auditPath ? String(options.auditPath) : '';
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  let grant = null;

  function appendAudit(entry) {
    if (!auditPath) return;
    const record = { at: now().toISOString(), ...entry };
    try {
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // Audit is best effort: never let a logging failure break an operation.
    }
  }

  function snapshot() {
    if (!grant) return null;
    return {
      windowId: grant.windowId,
      projectPath: grant.projectPath,
      // Keep the operator's own casing for display; comparisons use the
      // normalized key above.
      projectDisplayPath: grant.projectDisplayPath,
      projectName: baseName(grant.projectDisplayPath || grant.projectPath),
      projectSha256: grant.projectSha256,
      capabilities: [...grant.capabilities],
      grantedAt: grant.grantedAt,
      target: grant.target || null,
    };
  }

  // Arming is a real user gesture in the workbench page; it is never taken from
  // caller-supplied JSON. Re-arming is additive so ticking "download" later does
  // not silently drop "login".
  function arm(input = {}) {
    const projectPath = normalizeProjectPath(input.projectPath);
    if (!projectPath) {
      return { ok: false, code: 'CODESYS_ONLINE_PROJECT_REQUIRED', reason: '请先绑定一个 CODESYS 工程再开启在线授权' };
    }
    const requested = Array.isArray(input.capabilities) && input.capabilities.length
      ? input.capabilities
      : ONLINE_CAPABILITIES;
    const capabilities = [...new Set(requested.map((item) => String(item || '').trim().toLowerCase()))];
    const rejected = capabilities.filter((item) => !ONLINE_CAPABILITIES.includes(item));
    if (rejected.length) {
      return {
        ok: false,
        code: 'CODESYS_ONLINE_CAPABILITY_NOT_GRANTABLE',
        reason: `不允许的在线能力：${rejected.join(', ')}`,
        denied: [...UNSUPPORTED_ONLINE_CAPABILITIES],
      };
    }
    const sameProject = grant && grant.projectPath === projectPath;
    grant = {
      windowId: String(input.windowId || (sameProject ? grant.windowId : '')),
      projectPath,
      projectDisplayPath: path.resolve(String(input.projectPath || '').trim()),
      projectSha256: String(input.projectSha256 || ''),
      capabilities: sameProject ? [...new Set([...grant.capabilities, ...capabilities])] : capabilities,
      grantedAt: sameProject ? grant.grantedAt : now().toISOString(),
      target: input.target && typeof input.target === 'object' ? { ...input.target } : (sameProject ? grant.target : null),
    };
    appendAudit({ event: 'online-arm', windowId: grant.windowId, projectPath: grant.projectPath, capabilities: grant.capabilities });
    return { ok: true, grant: snapshot() };
  }

  function disarm(reason = 'manual') {
    const previous = snapshot();
    grant = null;
    if (previous) appendAudit({ event: 'online-disarm', reason, projectPath: previous.projectPath, capabilities: previous.capabilities });
    return { ok: true, disarmed: Boolean(previous), reason, previous };
  }

  function setTarget(target) {
    if (!grant) return null;
    grant.target = target && typeof target === 'object' ? { ...target } : null;
    return snapshot();
  }

  // The only place a capability is checked. `capability` comes from the action
  // name table above, never from caller input.
  function authorize(input = {}) {
    const capability = String(input.capability || '').trim().toLowerCase();
    if (!ONLINE_CAPABILITIES.includes(capability)) {
      return {
        ok: false,
        code: 'CODESYS_ONLINE_CAPABILITY_DENIED',
        reason: `不是可授予的在线能力：${capability || '(empty)'}`,
        denied: [...UNSUPPORTED_ONLINE_CAPABILITIES],
      };
    }
    if (!grant) {
      return { ok: false, code: 'CODESYS_ONLINE_NOT_ARMED', reason: '在线授权未开启：请先在工作台点击「登录」并确认' };
    }
    const projectPath = normalizeProjectPath(input.projectPath);
    if (projectPath && projectPath !== grant.projectPath) {
      return { ok: false, code: 'CODESYS_ONLINE_PROJECT_MISMATCH', reason: '在线授权绑定的是另一个工程；切换工程后需要重新授权' };
    }
    const windowId = String(input.windowId || '');
    if (grant.windowId && windowId && String(grant.windowId) !== windowId) {
      return { ok: false, code: 'CODESYS_ONLINE_WINDOW_MISMATCH', reason: '在线授权绑定的是另一个 CODESYS 窗口；请重新授权' };
    }
    if (!grant.capabilities.includes(capability)) {
      return { ok: false, code: 'CODESYS_ONLINE_CAPABILITY_NOT_GRANTED', reason: `本次授权不包含「${capability}」` };
    }
    return { ok: true, capability, grant: snapshot() };
  }

  // 危险动作的第二道锁：必须逐字输入确认词。只有 write-variable / reset / force
  // 需要；其余动作（含取消强制）走普通的一次点击确认。
  function confirmHardGate(input = {}) {
    const capability = String(input.capability || '').trim().toLowerCase();
    if (!ONLINE_CAPABILITIES.includes(capability)) {
      return { ok: false, required: false, code: 'CODESYS_ONLINE_CAPABILITY_DENIED', reason: `不是可授予的在线能力：${capability || '(empty)'}` };
    }
    if (!HARD_GATED_ONLINE_CAPABILITIES.includes(capability)) return { ok: true, required: false, capability };
    const expected = HARD_GATE_PHRASE[capability];
    const typed = String(input.phrase || '').trim();
    if (typed !== expected) {
      return {
        ok: false,
        required: true,
        code: 'CODESYS_ONLINE_HARD_GATE_PHRASE_MISMATCH',
        reason: `这是危险动作，需要输入确认词「${expected}」才能执行`,
        expected,
      };
    }
    appendAudit({ event: 'online-hard-gate-confirmed', capability, projectPath: grant ? grant.projectPath : '' });
    return { ok: true, required: true, capability };
  }

  return {
    arm,
    disarm,
    authorize,
    confirmHardGate,
    snapshot,
    setTarget,
    appendAudit,
    grantable: [...ONLINE_CAPABILITIES],
    hardGated: [...HARD_GATED_ONLINE_CAPABILITIES],
    denied: [...UNSUPPORTED_ONLINE_CAPABILITIES],
  };
}

// start / stop / reset / write-variable / force 全都作用在**应用层**，所以必须先有
// 一次"传输型"登录（「下载」= login(Never)，或「在线修改」= login(Try)）：只有那两步
// 才确认过设备上的程序就是当前工程。只登录、不传输的 Keep 登录（「登录」按钮）够用来
// 读在线变量，但不足以启停机械 —— 它连设备里跑的是哪一版都没确认。
function evaluateAppActionPreflight(context = {}) {
  const errors = [];
  if (context.authorized !== true) {
    errors.push({ code: 'CODESYS_ONLINE_NOT_AUTHORIZED', message: '在线授权未开启或已失效，请重新开启授权' });
  }
  if (context.connected !== true) {
    errors.push({ code: 'CODESYS_ONLINE_DEVICE_NOT_CONNECTED', message: '尚未连接到 PLC，请先点「登录」' });
  }
  if (context.loggedIn !== true) {
    errors.push({
      code: 'CODESYS_ONLINE_NOT_LOGGED_IN',
      message: '尚未登录到应用。启动/停止/复位/写变量/Force 都在应用层，请先点「下载」把当前工程送到设备（只想在线看值的话，点「登录」即可：只登录、不传输）。',
    });
  } else if (context.loginMode && context.loginMode !== 'transfer') {
    errors.push({
      code: 'CODESYS_ONLINE_MONITOR_ONLY_LOGIN',
      message: '当前是「只登录、不传输」的在线监视会话：启动/停止/复位/写变量/Force 需要先点「下载」或「在线修改」，以确认设备上的程序就是当前工程。',
    });
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}

// Hard pre-flight for a download. Every failure here is a refusal, not a warning
// prompt — the operator explicitly asked for a one-click download, so the checks
// have to be the thing that stops a bad transfer.
function evaluateDownloadPreflight(context = {}) {
  const errors = [];
  const warnings = [];

  if (context.authorized !== true) {
    errors.push({ code: 'CODESYS_ONLINE_NOT_AUTHORIZED', message: '在线授权未开启或已失效，请重新开启授权后再下载' });
  }
  // `connected` is the device link established by 「登录」. Application-level
  // login is deliberately NOT required here: in this design the download itself
  // performs the application login (OnlineChangeOption.Never), so demanding a
  // prior login would make the button permanently unusable.
  if (context.connected !== true) {
    errors.push({ code: 'CODESYS_ONLINE_DEVICE_NOT_CONNECTED', message: '尚未连接到 PLC，请先点「登录」建立在线连接' });
  }

  const granted = normalizeProjectPath(context.grantedProjectPath);
  const current = normalizeProjectPath(context.projectPath);
  if (!current) {
    errors.push({ code: 'CODESYS_ONLINE_PROJECT_REQUIRED', message: '尚未绑定工程，无法下载' });
  } else if (granted && granted !== current) {
    errors.push({ code: 'CODESYS_ONLINE_PROJECT_MISMATCH', message: '当前工程与授权时绑定的工程不一致，已拒绝下载' });
  }

  const expected = String(context.expectedSha256 || '');
  const actual = String(context.projectSha256 || '');
  if (expected && actual && expected !== actual) {
    errors.push({ code: 'CODESYS_ONLINE_PROJECT_CHANGED', message: '工程文件在绑定之后被改动过（可能刚在 CODESYS 中保存），请点「刷新」重新读取后再下载' });
  }

  // A GUI title carrying '*' means unsaved edits exist in the editor. Downloading
  // the saved file would silently ship the older code, which is the failure mode
  // this check exists for.
  if (containsUnsavedMarker(context.windowTitle)) {
    errors.push({ code: 'CODESYS_ONLINE_UNSAVED_CHANGES', message: 'CODESYS 窗口标题带 *，说明有未保存的改动；请先在 CODESYS 里保存，否则下载的是旧代码' });
  }

  if (context.targetMatched === false) {
    errors.push({ code: 'CODESYS_ONLINE_TARGET_MISMATCH', message: '当前在线目标与授权时的目标设备不一致，已拒绝下载' });
  }

  const buildErrors = Number(context.buildErrorCount);
  if (Number.isFinite(buildErrors) && buildErrors > 0) {
    warnings.push({ code: 'CODESYS_ONLINE_BUILD_ERRORS', message: `最近一次离线编译有 ${buildErrors} 个错误；下载的是上一次成功编译的产物` });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function actionCapability(action) {
  return ONLINE_ACTION_CAPABILITY[String(action || '').trim().toLowerCase()] || '';
}

module.exports = {
  ONLINE_CAPABILITIES,
  UNSUPPORTED_ONLINE_CAPABILITIES,
  HARD_GATED_ONLINE_CAPABILITIES,
  HARD_GATE_PHRASE,
  ONLINE_ACTION_CAPABILITY,
  createOnlineAuthorizationStore,
  evaluateDownloadPreflight,
  evaluateAppActionPreflight,
  normalizeProjectPath,
  containsUnsavedMarker,
  actionCapability,
};
