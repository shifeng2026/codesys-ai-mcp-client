const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { CodesysOnlineSession } = require('./online-session.cjs');

const execFileAsync = promisify(execFile);
const ALLOWED_ACTIONS = Object.freeze([
  'doctor', 'probe', 'capabilities', 'create-project', 'stage-project', 'bind-project', 'inspect-project',
  'create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'export-xml', 'import-xml',
  'build', 'rebuild', 'diff', 'rollback', 'build-status',
]);
// `build-status`（T183 第 4 项）：读一次"拆分后的异步 build"的结果。只读、不启动任何
// CODESYS 进程、不写盘 —— 它只是把 job.json 里那条 deferredBuild 记录读回来。
// `apply-and-build` is the composite used by the workbench's confirmed write: one
// CODESYS process applies the batch, saves, compiles offline, and (by default)
// returns the refreshed object tree. It is MUTATING because it writes, so it keeps
// the same confirmation gate, recovery snapshot and commit-back as apply-changes.
const MUTATING_ACTIONS = new Set(['create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'import-xml']);
// ── 在线冻结（本轮 B 项）────────────────────────────────────────────────────
// 用户拍板的规则原话：「登录之后就不允许修改代码，只可以查看在线变量」
// 「ai写入和手动写入都禁止，编辑栏直接被冻结」。
//
// 界面把编辑栏设为只读、把「确认写入」灰掉，只是**提示**：任何绕过界面的调用（外壳 AI
// 对话抽屉、探针、以后新增的入口）都必须在这里被拒绝。所以写类动作在"应用已登录"时
// 由**引擎**拒绝，并带上结构化可读原因（code=ONLINE_WRITE_FROZEN）。
//
// 判定依据是常驻在线进程自己回报的 `status.isLoggedIn`（不是界面传来的字段），所以它
// 无法被界面绕过；`rollback` 也在这里 —— 它同样覆盖磁盘上的工程（把源工程写回旧内容）。
// 没有在线会话时**一步都不多走**（连 status 都不问）：未登录的语义与冻结前逐字相同
// （sha 三态守卫 / 写前快照 / 原子提交 / per-job 互斥 / 用户点击全部保留）。
const ONLINE_WRITE_FROZEN_ACTIONS = new Set([...MUTATING_ACTIONS, 'rollback']);
const ONLINE_WRITE_FROZEN_CODE = 'ONLINE_WRITE_FROZEN';
const ONLINE_WRITE_FROZEN_MESSAGE = '在线状态下不允许写入工程：已登录到应用，代码编辑栏已冻结，写入请求（{action}）被引擎拒绝。如需修改请先退出登录（工作台在线区「退出登录」）。';
const PROJECT_ACTIONS = new Set(['inspect-project', 'create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'export-xml', 'import-xml', 'build', 'rebuild']);

// PLC online actions. These are NOT part of the offline allowlist: they run
// through the persistent online session (online-session.cjs) and each one needs
// an explicit operator authorization bound to the workbench window and the bound
// project. `online-login` only connects the device; the program transfer happens
// in `online-download` alone.
const ONLINE_ACTIONS = Object.freeze([
  'online-login', 'online-logout', 'online-download',
  'online-change', 'online-start', 'online-stop', 'online-reset',
  'online-write', 'online-force', 'online-unforce',
]);
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
  'online-unforce': 'force',
});
// Action -> worker command. Kept separate from the capability table so a rename on
// one side cannot silently change what the other authorizes.
const ONLINE_ACTION_COMMAND = Object.freeze({
  'online-login': 'login',
  'online-logout': 'logout',
  'online-download': 'download',
  'online-change': 'online-change',
  'online-start': 'start',
  'online-stop': 'stop',
  'online-reset': 'reset',
  'online-write': 'write-variable',
  'online-force': 'force',
  'online-unforce': 'unforce',
});
// CODESYS 暴露的 12 项在线能力，全部保留用于审计与报告。
const PLC_ONLINE_CAPABILITIES = Object.freeze([
  'login', 'logout', 'download', 'online-change', 'write-variable', 'start', 'stop', 'reset', 'debug', 'breakpoint', 'step', 'force',
]);
// 这 3 项本版本的 ScriptEngine **没有任何接口**（set_breakpoint / step_* / debug 在
// 21.5MB 官方 API dump 里全部不存在），不是被禁止，而是够不着。
const UNSUPPORTED_ONLINE_CAPABILITIES = Object.freeze(['debug', 'breakpoint', 'step']);

// ── 结构化耗时埋点（T183）─────────────────────────────────────────────────────
// 为什么需要它：现场口径是"读 20–40 秒 / 写约 115 秒"，但那是一个总数。没有分段计时，
// 任何"提速"都只能靠猜，也无法证明改前/改后。所以这里把一次动作拆成**固定字段名**的
// 毫秒数 + 字节/文件计数，第三方（jq / Excel / 契约）可以直接按 key 聚合。
//
// 开销约束（热路径上不能有昂贵序列化，见 T183 要求）：
//   · 计时本体 = process.hrtime.bigint() 相减（单调时钟，不受系统改时间影响）+ 一次整数加法；
//   · 热路径上**不**做 JSON.stringify、不写盘、不建对象数组；
//   · 一次动作**只在结束时**写一行 JSONL（append-only），外加既有的 evidence JSON。
//
// 字段分两类：*Ms 是毫秒累加，其余是计数/字节数。`snapshot()` 一律把两类字段**全部零填**，
// 所以"某个字段不存在"永远不会被误解成"没测到"。
const TIMING_MS_KEYS = Object.freeze([
  // 读路径
  'enumerateMs',        // 作业发现 / 元数据读取（readJob、maintainJobs）
  'readProjectMs',      // 建立"不归 GUI 所有"的工程副本（拷贝，或按源 sha 复用）
  'pythonStartMs',      // ScriptEngine 可用耗时：常驻 worker 启动；冷启动时=整进程耗时
  'serviceMs',          // 常驻 worker 内一次动作的服务时间（Python 侧自报）
  // Python 侧自报的"打开工程"耗时。**它必须永远存在**（哪怕是 0）：openMs=0 与
  // openMs=11000 是两件完全不同的事（前者=复用了 worker 里已打开的工程），而"字段不存在"
  // 会被读成"没测到"。真机就是靠它定位到"每个动作都在重新开工程"的。
  'openMs',             // Python 侧 projects.open()（复用已打开的工程时为 0）
  'saveMs',             // Python 侧 project.save()
  'parseMs',            // 读 result.json 并 JSON.parse
  'treeMs',             // Python 侧生成对象树（walk + coverage）
  // 写路径
  'applyMs',            // Python 侧应用改动 + project.save()
  'buildMs',            // Python 侧离线编译（含消息收集）
  'hashMs',             // sha256（含哈希缓存命中时刻意不花的 0）
  'recoverySnapshotMs', // 写前快照（含内容寻址复用 / 改名 0 字节路径）
  'jobDirCopyMs',       // 作业目录内 .project 拷贝/建副本总耗时
  'commitMs',           // 提交回源工程（含冲突守卫）
  'metadataWriteMs',    // job.json 原子写
  'totalMs',            // 整个动作
]);
// T197：`logs/codesys-timings.jsonl` 的上限。它以前是纯 appendFileSync、**没有任何上限**，
// 是 logs/ 下唯一一个只增不回收的审计文件。同一批 JSONL 里其它文件的策略都是 4 MB（见
// app/diagnostic-log.js 的调用点：native-host-audit / input-audit / online 各 4 MB × 1，
// trajectory.jsonl 4 MB × 2）。这里取同一口径 4 MB × 1：只做轮转（改名成 `.1`），不删任何
// 用户数据；而且这条记录本来就**原样**同时进了 trajectory.jsonl（带 `at`，见 app/main.js 的
// timingSink），所以加上限不丢任何独有信息。
const TIMINGS_LOG_MAX_BYTES = 4 * 1024 * 1024;

const TIMING_COUNT_KEYS = Object.freeze([
  'pythonReused',              // 1 = 复用常驻 worker；0 = 冷启动
  'pythonIsColdProcessTotal',  // 1 = pythonStartMs 其实是"冷启动整进程耗时"（无法再拆）
  'processStarts',             // 本动作启动了几个 CODESYS 进程
  'projectReused',             // 1 = 这一次动作复用了 worker 里**已打开的工程**（openMs 因此为 0）
  'treeReused',                // 1 = 对象树来自 worker 内的缓存（源 sha 未变）
  'hashCalls', 'hashBytes', 'hashBytesSaved', 'hashCacheHits',
  'jobDirCopyBytes', 'jobDirCopyFiles',
  'snapshotReused', 'snapshotRenamed', 'snapshotCopyBytes',
  'commitBackupBytes',
  'workCopyReused',
  // 本次动作真的调了几次 Python 侧 `project.save()`。它是"saveMs 里有没有重复保存"的
  // 唯一可信来源：墙钟（saveMs）只能说明"这一段花了多久"，计数才能说明"这一段被做了几次"。
  // 正常的一次确认写入 = 1（见 handle_request 里每次请求重置的 _SAVE_CALLS）。
  'saveCalls',
  'objects',
]);

function createTimingTrace() {
  const startedAt = process.hrtime.bigint();
  const ms = {};
  const counts = {};
  const elapsedMs = (handle) => Number(process.hrtime.bigint() - handle) / 1e6;
  const trace = {
    // 热路径：一次 BigInt 相减 + 一次加法。不加锁、不分配数组。
    begin() { return process.hrtime.bigint(); },
    add(name, valueMs) {
      const value = Number(valueMs) || 0;
      if (value > 0) ms[name] = Math.round((ms[name] || 0) + value);
      return trace;
    },
    end(name, handle) { if (handle) trace.add(name, elapsedMs(handle)); return trace; },
    count(name, value = 1) { counts[name] = (counts[name] || 0) + (Number(value) || 0); return trace; },
    bytes(name, value) { return trace.count(name, Number(value) || 0); },
    nowMs() { return elapsedMs(startedAt); },
    snapshot(extra = {}) {
      const record = {};
      for (const key of TIMING_MS_KEYS) record[key] = ms[key] || 0;
      for (const key of TIMING_COUNT_KEYS) record[key] = counts[key] || 0;
      record.totalMs = Math.round(elapsedMs(startedAt));
      return Object.assign(record, extra);
    },
  };
  return trace;
}

// `.project` 是 CODESYS 的**不透明容器**：里面没有"可按对象寻址的分片"可供外部哈希
// （唯一的官方出口是 PLCopenXML 导出，代价远大于一次 sha256）。所以"只对改动对象算
// 哈希"在文件层面做不到；能做的、也是这里做的，是**消除重复的全文件哈希**：
//   · 一次动作内的重复调用合并成一次；
//   · 记账/缓存键用 stat 校验过的缓存（size+mtime+ctime+ino 全同 ⇒ 复用上次结果）；
//   · **写入守卫永远走一次真哈希**（sha256 直接调用，不走缓存）—— 缓存只可能让守卫
//     更保守（哈希对不上就拒绝提交），不可能让它放行。
function sha256(file, trace) {
  const startedAt = trace ? process.hrtime.bigint() : null;
  const bytes = fs.readFileSync(file);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (trace) { trace.end('hashMs', startedAt); trace.count('hashCalls', 1); trace.bytes('hashBytes', bytes.length); }
  return digest;
}

// CODESYS 把它的控制台输出写在 **Windows ANSI 代码页**（本机是 GBK/CP936），不是 UTF-8。
// 按 UTF-8 解会把每一条中文编译消息变成一片 U+FFFD：工作台编译输出里看到的
// "[Info] ����: Text: C0: ------ ��ʼ����Ӧ�ó��� ..." 就是这么来的（`编译` 的 4 个 GBK
// 字节 → 4 个替换字符）。所以子进程按**原始字节**捕获，再挑替换字符最少的编码来解。
// 注意 Python 侧不需要改：它读写 result.json 已经显式 utf-8 了。
const PROCESS_TEXT_ENCODINGS = ['utf-8', 'gbk'];
function decodeProcessText(value) {
  if (value === undefined || value === null) return '';
  // 自定义 runProcess 可能已经给出字符串（测试会注入），此时原样返回。
  if (typeof value === 'string') return value;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!buffer.length) return '';
  let best = '';
  let bestBad = Infinity;
  for (const encoding of PROCESS_TEXT_ENCODINGS) {
    let text = '';
    try { text = new TextDecoder(encoding).decode(buffer); } catch { continue }
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad < bestBad) { best = text; bestBad = bad; }
    if (bad === 0) break; // ASCII 或真 UTF-8：第一条就干净，不必再试
  }
  return best;
}

// ── 失败正文：审计行里"只有 reason、没有正文"是不诚实的 ─────────────────────────
// 真机原文（1.1.0 上一轮）：预打开失败时审计里只剩下
//   {"action":"preopen-project","preopened":0,"skipped":"preopen:preopen"}
// 而真因在离线常驻 worker 自己的 stderr 文件里：
//   CODESYS.APInstaller: Cannot open log for source 'AP Installer' (Win32 5)
// 宿主与读取都只看得到 preopened:false，没有任何人能回答"为什么"。下面这一族函数是
// 失败正文的**唯一**出口，审计行 / 返回值 / 抛出的 Error.message 全走它。
//
// 两条硬要求：
//   · 截断：审计 JSONL 有 4 MB 轮转上限，stderr 可能是几 MB，绝不整段灌进去；
//   · 压平：一条记录必须是**一行**。stderr 天生多行，原样塞进 message 会让
//     `grep preopen-project` 之外的每一行读起来都像一条独立的审计记录。
// 隐私：这里只搬 CODESYS / 脚本引擎自己吐出来的诊断（安装路径、日志源名、Win32 码、
// Python traceback）。凭据从不进 worker 日志，本函数也不做任何拼接以外的加工。
const FAILURE_TEXT_MAX = 400;
const FAILURE_MESSAGE_MAX = 150;
const FAILURE_TAIL_MAX = 160;
// 空白压平：一条审计记录必须是一行（stderr 天生多行）。
function collapseText(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function oneLineFailureText(value, max = FAILURE_TEXT_MAX) {
  const text = collapseText(value);
  if (!Number.isFinite(max) || max <= 0) return text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 有界地读一个日志文件的**末尾**并按上面的规则压平。失败返回 ''（绝不抛）：
// 它只在"已经出错了"的路径上被调用，读日志再抛一次只会把真因盖掉。
function fileTailText(file, maxBytes = 4096, max = FAILURE_TEXT_MAX) {
  try {
    const size = fs.statSync(file).size;
    if (!(size > 0)) return '';
    const from = Math.max(0, size - Math.max(1, Number(maxBytes) || 4096));
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(size - from);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, from);
      // 与 worker 的 stdout/stderr 同一条解码路径（GBK/CP936），否则中文诊断变 U+FFFD。
      return oneLineFailureText(decodeProcessText(buffer.subarray(0, bytes)), max);
    } finally { fs.closeSync(fd) }
  } catch { return '' }
}

// «；stderr 末尾：…» 是 invoker 抛错误时用的分隔符（见 startOfflineWorker / invokePersistentScriptLocked）。
const STDERR_SUFFIX_RE = /[；;]\s*stderr 末尾：/;

// 组装一行可读的失败正文：关键码 → error.message → worker 的 stderr 末尾。
// 三段各有预算，因为**真因通常在 stderr 末尾**，绝不能被前面的 message 挤掉。
// invoker 已经把那一段并进 message 了，所以先把它从 message 里剥掉再统一追加一次 ——
// 否则同一段正文会出现两次，并且把 message 的预算吃光（截断之后连去重都对不上）。
function describeWorkerFailure(error, stderrTail = '') {
  const code = collapseText(error?.code || '');
  const tail = collapseText(error?.stderrTail || stderrTail || '');
  let message = collapseText(error?.message || error || '');
  const suffixAt = message.search(STDERR_SUFFIX_RE);
  if (suffixAt >= 0) message = message.slice(0, suffixAt).trim();
  message = oneLineFailureText(message, FAILURE_MESSAGE_MAX);
  const parts = [];
  if (code && !message.includes(code)) parts.push(code);
  if (message) parts.push(message);
  if (tail) parts.push(`stderr 末尾：${oneLineFailureText(tail, FAILURE_TAIL_MAX)}`);
  return oneLineFailureText(parts.join(' · '), FAILURE_TEXT_MAX);
}

// ── 编译结果解析 ───────────────────────────────────────────────────────────────
// 真实的 CODESYS 控制台输出（取自本机 logs/codesys-scriptengine-offline-workbench.json
// 里那次 88 秒的真 build）长这样：
//   编译: Text: C0: ------ 开始构建应用程序 Device_1.Application -------
//   编译: Text: C0: 代码典型化...
//   附加代码检查: Text: SA0: 其他代码检查...
//   附加代码检查: Text: SA0: 其他代码检查完成-0 个错误
//   编译: Text: C0: 编译完成 -- 0错误,0警告
// 汇总行**没有冒号**（`0错误,0警告`），而旧解析只认 `错误:`，于是汇总行、以及
// `C0032: 无法转换类型 ...` 这类真实失败行全部落进 Info：错误数永远是 0、编译永远
// 被当成成功（现场表现就是 56 个 C0032 只显示"错误 0"）。
// 下面这套解析以**真实汇总行**为准；解析不出来时返回 null（未知），绝不默认 0。
const COMPILE_SUMMARY_BOTH_RES = Object.freeze([
  /(\d+)\s*(?:个|條|条)?\s*错误[^0-9\r\n]{0,16}?(\d+)\s*(?:个|條|条)?\s*警告/,
  /(\d+)\s*errors?[^0-9\r\n]{0,16}?(\d+)\s*warnings?/i,
]);
const COMPILE_SUMMARY_ERROR_RES = Object.freeze([
  /\berrors?\s*(?:count)?\s*[:=]\s*(\d+)/i,
  /错误\s*(?:数|总数)?\s*[:：=]\s*(\d+)/,
  /(\d+)\s*(?:个|條|条)?\s*错误/,
  /(\d+)\s*errors?\b/i,
]);
const COMPILE_SUMMARY_WARNING_RES = Object.freeze([
  /\bwarnings?\s*(?:count)?\s*[:=]\s*(\d+)/i,
  /警告\s*(?:数|总数)?\s*[:：=]\s*(\d+)/,
  /(\d+)\s*(?:个|條|条)?\s*警告/,
  /(\d+)\s*warnings?\b/i,
]);
// 明细行的严重度。错误标记排在前面：把一行误判成错误只会让"失败"更保守，
// 把一行误判成 Info 却会把失败藏起来。
const CONSOLE_ERROR_RES = Object.freeze([
  /\berrors?\s*[:：(]/i,
  /\[error\]/i,
  /\berror\s+n?[°º]?\s*\d+/i,
  /错误\s*[:：]/,
  /不能打开库/,
  /cannot open (?:the )?library/i,
  /\bfehler\s*[:：]/i,
]);
const CONSOLE_WARNING_RES = Object.freeze([
  /\bwarnings?\s*[:：]/i,
  /\[warning\]/i,
  /警告\s*[:：]/,
  /\bwarnung\s*[:：]/i,
]);
// CODESYS 编译器消息码（真实失败行：`编译: Text: C0032: 无法转换类型 ...`）。
// 带四位码的行不是成功信号；`C0:`（两字符类别前缀，信息行）不算。
const CONSOLE_MESSAGE_CODE_RE = /\bC0\d{3}\b/;
const BUILD_ACTIONS = new Set(['build', 'rebuild', 'apply-and-build']);
const COMPILE_ERROR_PREVIEW_LIMIT = 10;

// 从最后一行往前找汇总行：CODESYS 把总结打在输出末尾，而 `附加代码检查完成-0 个错误`
// 这种中途统计行不会覆盖它。
//
// T197：但"没有真汇总行"时，上面那句话就不成立了 —— 宽松兜底（`(\d+)\s*个?\s*错误`）
// 会把**中途统计行**当成终端汇总行，于是"根本没编译完"被报成 `succeeded:true` /
// `errorCountSource:'codesys-summary'`。构造样本（原文）：
//   编译: Text: C0: ------ 开始构建应用程序 Device_1.Application -------
//   编译: Text: C0: 代码典型化...
//   附加代码检查: Text: SA0: 其他代码检查完成-0 个错误
// 改前解析结果：{errorCount:0} → succeeded=true（假"编译通过"），且因为不是 null，
// `compileResultNote()` 那条"无法判定"的守卫**不会**触发。
// 形态差别是可判的：中途统计行的"完成"与计数之间是**紧贴的连字符**
// （`完成-0 个错误` / `completed-0 errors` / `beendet-0 Fehler`），而真实终端汇总行在
// 两者之间一定有空白或双横线（`编译完成 -- 0错误,0警告` / `Compile complete -- 0 errors`）。
// 所以只把这一类中途行排除在**宽松兜底**之外：排除后没有别的候选 ⇒ 返回 null ⇒
// 落到既有的 unknown 分支（"无法判定编译结果"），**绝不**退化成"0 错误"。
const COMPILE_SUBSTAGE_STAT_RE = /(?:完成|completed?|finished|beendet)\s*[-–—]\s*\d/i;

function parseCompileSummary(text) {
  const lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    if (COMPILE_SUBSTAGE_STAT_RE.test(raw)) continue;
    for (const pattern of COMPILE_SUMMARY_BOTH_RES) {
      const match = raw.match(pattern);
      if (match) return { errorCount: Number(match[1]), warningCount: Number(match[2]), raw };
    }
    let errorCount = null;
    for (const pattern of COMPILE_SUMMARY_ERROR_RES) {
      const match = raw.match(pattern);
      if (match) { errorCount = Number(match[1]); break; }
    }
    if (errorCount === null) continue;
    let warningCount = null;
    for (const pattern of COMPILE_SUMMARY_WARNING_RES) {
      const match = raw.match(pattern);
      if (match) { warningCount = Number(match[1]); break; }
    }
    return { errorCount, warningCount, raw };
  }
  return null;
}

function classifyConsoleLine(text) {
  const value = String(text || '');
  if (CONSOLE_ERROR_RES.some((pattern) => pattern.test(value))) return 'Error';
  if (CONSOLE_WARNING_RES.some((pattern) => pattern.test(value))) return 'Warning';
  if (CONSOLE_MESSAGE_CODE_RE.test(value)) return 'Error';
  return 'Info';
}

// ── T225：诊断明细按**出现次数**合并，不再"每个文本只留一条" ────────────────────────────────
// 现场报障原文：面板标题写「错误 0 · 警告 28（已显示 8 条） · 信息 5」，正文最后一行是编译器
// 自己的总结 `[Info] 编译: Text: C0: 编译完成 -- 0错误,28警告`。当时的判断是"编译器只把前
// N 条打进了正文"，**这个判断是错的**：真机把 28 条全打在 stderr 里（同一台机器同一次编译的
// 证据文件：`workspaces/codesys-scriptengine/worker/<id>/offline-worker.stderr.log`，
// 2563 B / 34 行，末行 `编译: Text: C0: 编译完成 -- 0错误,28警告`），是**我们自己**在
// `${severity}\u0000${text}` 这个 Set 上把重复出现的 20 行丢掉了 —— 去重后恰好剩 8 个唯一
// 文本，就是界面写"已显示 8 条"的那 8 条。重复是真实告警（同一个隐式转换在多个 POU 上各报
// 一次），必须一条不少地保留。
//
// 但也不能把**同一份控制台输出的两份捕获**记成两倍：常驻 worker 把控制台写进 stdout/stderr
// 日志、单发路径走管道，同一行可能两边都有。所以每个键取各来源出现次数的**最大值**而**不是
// 相加** —— 取大只会多显示、绝不隐藏，"两份捕获"也不会翻倍。
function diagnosticKeyOf(item) {
  return `${String(item?.severity || '')}\u0000${String(item?.text || '')}`;
}

function mergeDiagnosticOccurrences(sources) {
  const counts = new Map();
  const first = new Map();
  const order = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const list = Array.isArray(source) ? source : [];
    const perSource = new Map();
    for (const item of list) {
      const key = diagnosticKeyOf(item);
      if (!first.has(key)) { first.set(key, item); order.push(key); }
      perSource.set(key, (perSource.get(key) || 0) + 1);
    }
    for (const [key, value] of perSource) counts.set(key, Math.max(counts.get(key) || 0, value));
  }
  // 输出顺序＝各键**首次出现**的顺序：结构化消息在前（与旧行为一致），随后是控制台行按原顺序，
  // 于是编译器自己的总结行仍然落在最后（`parseCompileSummary` 从尾部往前找它）。
  const merged = [];
  for (const key of order) {
    const item = first.get(key);
    const total = counts.get(key) || 0;
    for (let index = 0; index < total; index += 1) merged.push(item);
  }
  return merged;
}

// 结构化编译结果：成功/失败/未知 + 错误数 + 警告数 + 前若干条错误文本 + 耗时 + 目标工程。
// succeeded 是三态：true（有汇总行且为 0 错误）、false、null（无法判定）。
function buildCompileResult({ action, durationMs, projectPath, stdout, stderr, messages, processError }) {
  const consoleText = [stdout, stderr].filter(Boolean).join('\n');
  const list = Array.isArray(messages) ? messages : [];
  const summary = parseCompileSummary(consoleText)
    || parseCompileSummary(list.map((item) => String(item?.text || '')).join('\n'));
  const severityOf = (item) => String(item?.severity || '').toLowerCase();
  const detailErrors = list.filter((item) => severityOf(item) === 'error');
  const detailWarnings = list.filter((item) => severityOf(item) === 'warning');
  const summaryErrors = summary ? summary.errorCount : null;
  const summaryWarnings = summary ? summary.warningCount : null;
  // 明细是"至少这么多"的硬证据：汇总行说 0、明细里却有错误行时以明细为准并标注冲突
  // （真实 CODESYS 的汇总行只覆盖最后一步编译，更早的失败不会改这个数字）。
  const errorCount = summaryErrors === null
    ? (detailErrors.length ? detailErrors.length : null)
    : Math.max(summaryErrors, detailErrors.length);
  const warningCount = summaryWarnings === null
    ? (detailWarnings.length ? detailWarnings.length : null)
    : Math.max(summaryWarnings, detailWarnings.length);
  return {
    action,
    succeeded: errorCount === null ? null : errorCount === 0,
    errorCountKnown: summaryErrors !== null && errorCount === summaryErrors,
    errorCount,
    warningCount,
    detailErrorCount: detailErrors.length,
    detailWarningCount: detailWarnings.length,
    messageCount: list.length,
    summary: summary ? { ...summary } : null,
    // 计数口径：**以编译器自己的汇总行为准**，并且把"汇总行原话里的数字"与"我们真的显示出来的
    // 正文条目数"**分开**回传。现场报障就是这一对数字被合成一个而丢了另一个：
    //   [Info] 编译: Text: C0: 编译完成 -- 0错误,28警告      ← 编译器自己的总结：28 条警告
    //   正文里只有 7 条 [Warning] ...                        ← 编译器只显示了前 7 条（面板标题报 7）
    // 28 与 7 不是"矛盾"，而是"总数"与"已显示条数"：只报 7 就是少报，只报 28 又不说明正文为什么
    // 只有 7 行。所以两者都留在结构里，由界面按下面的规则呈现（`countsDiffer` 就是"不一致"）。
    summaryErrorCount: summaryErrors,
    summaryWarningCount: summaryWarnings,
    countsDiffer: Boolean(summary)
      && (summaryErrors !== detailErrors.length || summaryWarnings !== detailWarnings.length),
    // 方向**不能**放宽成"不相等"：汇总行说的是总数（编译器只显示前 N 条），只有"正文多于汇总"
    // 才说明汇总行漏掉了更早的失败 —— 那是 T200 的"硬证据"方向，也是唯一该判失败的方向。
    summaryConflict: Boolean(summary) && detailErrors.length > summaryErrors,
    warningConflict: Boolean(summary) && detailWarnings.length > summaryWarnings,
    errorCountSource: summary ? 'codesys-summary' : (detailErrors.length ? 'message-severity' : 'unknown'),
    warningCountSource: summaryWarnings !== null ? 'codesys-summary' : (detailWarnings.length ? 'message-severity' : 'unknown'),
    errors: detailErrors.slice(0, COMPILE_ERROR_PREVIEW_LIMIT).map((item) => String(item?.text || '')),
    durationMs: Math.max(0, Number(durationMs) || 0),
    projectPath: String(projectPath || ''),
    targetProject: path.basename(String(projectPath || '')),
    processError: processError || {},
    at: new Date().toISOString(),
  };
}

// 把结构化编译结果落进回传 payload（**唯一一处**：契约直接调它，所以"界面读到的字段"和
// "引擎算出来的字段"不可能各写一份而漂移）。计数口径的三个维度都过桥：
//   errorCount / warningCount                 已经定好的那个数（以汇总行为准，取不到就是 null）
//   summaryErrorCount / summaryWarningCount   汇总行原话里的数字（没有汇总行 ⇒ null）
//   detailErrorCount / detailWarningCount     正文里真的显示出来的条目数
// 界面拿这三对才能说出"28（已显示 7 条）"，而不是把 7 当成总数。
function applyCompileResultToPayload(payload, compile) {
  if (!payload || !compile) return payload;
  payload.errorCount = compile.errorCount;
  payload.warningCount = compile.warningCount;
  payload.errorCountKnown = compile.errorCountKnown;
  payload.errorCountSource = compile.errorCountSource;
  payload.warningCountSource = compile.warningCountSource;
  payload.summaryErrorCount = compile.summaryErrorCount;
  payload.summaryWarningCount = compile.summaryWarningCount;
  payload.detailErrorCount = compile.detailErrorCount;
  payload.detailWarningCount = compile.detailWarningCount;
  payload.countsDiffer = compile.countsDiffer;
  payload.compileSummary = compile.summary ? compile.summary.raw : '';
  payload.buildSucceeded = compile.succeeded;
  payload.compile = compile;
  return payload;
}

// 只有"结果无法判定"或"汇总行与错误明细矛盾"时才追加一条说明 —— 这两种情况下
// 单看错误计数会骗人。走的是既有 messages 通道（Info 级），不新造协议、不伪造错误。
function compileResultNote(compile) {
  if (!compile) return '';
  if (compile.succeeded === null) {
    return '无法判定编译结果：CODESYS 输出里没有可解析的汇总行（N错误,N警告），且没有错误明细；原始输出已完整保留，请勿按"编译成功"处理。';
  }
  if (compile.summaryConflict) {
    return `编译汇总行与错误明细矛盾：汇总行 "${compile.summary ? compile.summary.raw : ''}" 说 ${compile.summary ? compile.summary.errorCount : 0} 个错误，实际明细有 ${compile.detailErrorCount} 条错误；按明细计为失败。`;
  }
  return '';
}

function compileResultText(compile) {
  if (!compile) return '';
  const warnings = compile.warningCount === null ? '未知' : compile.warningCount;
  if (compile.succeeded === true) return `离线编译通过（错误 0 · 警告 ${warnings}）`;
  if (compile.succeeded === false) return `离线编译失败（错误 ${compile.errorCount} · 警告 ${warnings}）`;
  return '离线编译结果无法判定（CODESYS 输出里没有可解析的汇总行，原始输出已保留）';
}

function refreshInspectionSnapshot(sourcePath, targetPath, trace) {
  if (fs.existsSync(targetPath)) {
    try { fs.chmodSync(targetPath, 0o600); } catch { /* internal snapshot may already be writable */ }
  }
  const bytes = copyProject(sourcePath, targetPath, trace);
  try { fs.chmodSync(targetPath, 0o600); } catch { /* best effort on non-Windows filesystems */ }
  return bytes;
}

// CODESYS enforces an application-level project lock: a second --noUI
// ScriptEngine process cannot call projects.open() on a project currently
// owned by the GUI.  Keep the GUI project as the source of truth, but execute
// the script against a per-run copy and commit the result only after the
// script succeeds.  This also gives us a cheap conflict check before a
// confirmed write so an external GUI save is never silently overwritten.
//
// 返回值是本次**真的**拷贝了多少字节（复用路径下为 0），用于耗时埋点与"提速"举证。
function copyProject(sourcePath, targetPath, trace) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const startedAt = trace ? process.hrtime.bigint() : null;
  fs.copyFileSync(sourcePath, targetPath);
  let bytes = 0;
  try { bytes = fs.statSync(targetPath).size; } catch { /* 统计失败不影响拷贝本身 */ }
  if (trace) { trace.end('jobDirCopyMs', startedAt); trace.bytes('jobDirCopyBytes', bytes); trace.count('jobDirCopyFiles', 1); }
  try { fs.chmodSync(targetPath, 0o600); } catch { /* best effort */ }
  return bytes;
}

// 提交：把动作产物写回源工程。
//
// 安全语义（逐条保留）：
//   · `expectedSha256` 存在时，**先对源文件做一次真哈希**（不经任何缓存），不一致立刻抛
//     CODESYS_SCRIPTENGINE_SOURCE_CHANGED_DURING_ACTION —— 外部保存永远不会被静默覆盖；
//   · 写回失败时把源文件恢复成写前内容，再抛原始错误；
//   · 写回成功后清掉临时恢复副本。
//
// 改前：无论如何都先 `copyFileSync(source → *.taskhive-write-backup)`，也就是每次写入
// 白白多拷一整个 .project。改后：当调用方给出**写前恢复快照**（bytes 与守卫校验过的
// expectedSha256 完全相同，否则守卫早就抛了）时，直接用那份快照做恢复源，不再拷第二份。
// 没有快照可依据时才落回临时副本 —— 恢复能力一天都没有削弱。
function commitProject(sourcePath, stagedPath, expectedSha256 = '', options = {}) {
  const trace = options.trace || null;
  const rollbackFrom = String(options.rollbackFrom || '');
  if (expectedSha256 && sha256(sourcePath, trace) !== expectedSha256) {
    throw Object.assign(new Error('当前 CODESYS 工程在写入期间已被外部保存，已停止提交以避免覆盖最新内容；写前恢复快照仍保留'), { code: 'CODESYS_SCRIPTENGINE_SOURCE_CHANGED_DURING_ACTION' });
  }
  const snapshotBackup = Boolean(rollbackFrom) && fs.existsSync(rollbackFrom);
  const backupPath = snapshotBackup ? '' : `${sourcePath}.taskhive-write-backup`;
  if (backupPath) {
    try {
      fs.copyFileSync(sourcePath, backupPath);
      if (trace) trace.bytes('commitBackupBytes', fs.statSync(backupPath).size);
    } catch { /* source may not permit sidecar backup */ }
  }
  try {
    fs.copyFileSync(stagedPath, sourcePath);
  } catch (error) {
    try {
      const restore = snapshotBackup ? rollbackFrom : backupPath;
      if (restore && fs.existsSync(restore)) fs.copyFileSync(restore, sourcePath);
    } catch { /* preserve original error */ }
    throw Object.assign(new Error(`无法提交 CODESYS 工程文件：${error?.code || error?.message || error}`), { code: 'CODESYS_SCRIPTENGINE_SOURCE_COMMIT_FAILED' });
  } finally {
    if (backupPath) {
      try { if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath); } catch { /* best effort cleanup */ }
    }
  }
}

function safeId(value, label = '名称') {
  const text = String(value || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(text)) {
    const error = new Error(`${label}必须是 IEC 标识符（字母或下划线开头）`);
    error.code = 'CODESYS_SCRIPTENGINE_IDENTIFIER_INVALID';
    throw error;
  }
  return text;
}

function safeGuid(value, label = '对象 GUID') {
  const text = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw Object.assign(new Error(`${label}无效`), { code: 'CODESYS_SCRIPTENGINE_GUID_INVALID' });
  }
  return text.toLowerCase();
}

function inside(parent, child) {
  const base = path.resolve(parent) + path.sep;
  const target = path.resolve(child);
  return target.startsWith(base);
}

// ── 原子 JSON 写 ───────────────────────────────────────────────────────────────
// 旧实现是 `fs.writeFileSync(metadataPath, JSON.stringify(job))`：writeFileSync 先
// O_TRUNC 再写，并发/中断时磁盘上会留下半个 JSON，下一次 readJob 的 JSON.parse 直接
// 抛，整个作业就废了。现在改成"同目录临时文件 → fsync → rename 覆盖"：rename 在同一
// 卷上是原子的，任何时刻读到要么是旧的完整 JSON、要么是新的完整 JSON。
const ATOMIC_WRITE_RETRY_DELAYS_MS = Object.freeze([0, 5, 20, 60, 150]);

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Number(ms) || 0)); } catch { /* best effort */ }
}

function writeJsonAtomic(targetPath, value) {
  const directory = path.dirname(targetPath);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const handle = fs.openSync(temp, 'wx');
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    try { fs.fsyncSync(handle); } catch { /* 某些文件系统/容器不支持 fsync */ }
  } finally {
    try { fs.closeSync(handle); } catch { /* already closed */ }
  }
  let lastError = null;
  for (const delay of ATOMIC_WRITE_RETRY_DELAYS_MS) {
    if (delay) sleepSync(delay);
    try { fs.renameSync(temp, targetPath); return true; } catch (error) { lastError = error; }
  }
  try { fs.unlinkSync(temp); } catch { /* the retry loop already failed */ }
  throw Object.assign(
    new Error(`无法原子写入 ${path.basename(targetPath)}：${lastError?.code || lastError?.message || lastError}`),
    { code: 'CODESYS_SCRIPTENGINE_JOB_WRITE_FAILED' },
  );
}

function directoryBytes(directory) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else { try { total += fs.statSync(full).size; } catch { /* unreadable */ } }
  }
  return total;
}

function listFiles(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = path.join(directory, entry.name);
        let at = 0; let size = 0;
        try { const stat = fs.statSync(full); at = stat.mtimeMs; size = stat.size; } catch { /* keep zeroes */ }
        return { full, name: entry.name, at, size };
      });
  } catch { return []; }
}

// CODESYS 每次编译都在工程旁边重写这几个中间产物，它们只有大小、没有保留价值：
// 审计实测 `.bootinfo` 59.3 MB + `.compileinfo` 59.3 MB（各 5 个文件）。
// 名单是**白名单式**的已知后缀，绝不按通配符删别的东西；`.opt`（工程选项）与
// `*.project`、`job.json`、`*.json`、`*.py`、`*.log`、`*.xml` 一律不动。
const CODESYS_SIDECAR_RE = /\.(bootinfo|compileinfo|bootinfo_guids|precompilecache)$|\.~u$/i;

// 一个 .project 旁边的中间产物文件名（同目录、同名加后缀）。
function sidecarsOf(projectPath) {
  const directory = path.dirname(projectPath);
  const base = path.basename(projectPath, path.extname(projectPath));
  return listFiles(directory)
    .filter((entry) => entry.name.startsWith(base) && CODESYS_SIDECAR_RE.test(entry.name))
    .map((entry) => entry.full);
}

// 一次动作的**服务体**：所有 CODESYS 调用都在 handle_request(request) 里。
//
// 为什么这段 Python 是**一份文本、两处产出**（单发脚本 / 常驻 worker）：
// 常驻进程只多一个轮询命令文件的循环，动作实现一个字都不重复 —— 两条路径因此不可能
// 行为漂移。共用靠的是下面四个标记 + offlineServiceText()：worker 从中切出同一份
// helper 与 dispatch，而不是把 400 行 Python 抄第二遍（抄一遍就一定会漂）。
//
// 标记同时必须避开既有契约的两个锚点：
//   · `codesys-project-tree-contract.js` 用 `indexOf('function buildOfflineActionScript')`
//     到第一个 `def find_one` 这一段的**反引号个数**来证明"嵌在模板字面量里的 Python
//     没有裸反引号"，所以单发脚本生成器必须仍然是一个**完整的**模板字面量，且
//     `request = read_json(request_path)` 必须紧跟 collect_project_tree（它的
//     对象树切片锚点）。标记是 Python 注释，放在函数体里合法（注释不产生缩进 token）。
const OFFLINE_SERVICE_HELPERS_START = '# >>> taskhive-offline-service:helpers:start';
const OFFLINE_SERVICE_HELPERS_END = '# <<< taskhive-offline-service:helpers:end';
const OFFLINE_SERVICE_DISPATCH_START = '# >>> taskhive-offline-service:dispatch:start';
const OFFLINE_SERVICE_DISPATCH_END = '# <<< taskhive-offline-service:dispatch:end';

// 常驻 worker 的脚本 = 头部 + 常量 + 同一份服务体 + 命令循环。
function offlineServiceText() {
  const sample = buildOfflineActionScript(path.join('t', 'request.json'), path.join('t', 'result.json'));
  const helpersStart = sample.indexOf(OFFLINE_SERVICE_HELPERS_START);
  const helpersEnd = sample.indexOf(OFFLINE_SERVICE_HELPERS_END);
  const dispatchStart = sample.indexOf(OFFLINE_SERVICE_DISPATCH_START);
  const dispatchEnd = sample.indexOf(OFFLINE_SERVICE_DISPATCH_END);
  if (helpersStart < 0 || helpersEnd < helpersStart || dispatchStart < 0 || dispatchEnd < dispatchStart) {
    throw Object.assign(new Error('离线 Python 服务体标记缺失，拒绝生成常驻脚本'), { code: 'CODESYS_SCRIPTENGINE_SERVICE_MARKERS_MISSING' });
  }
  return {
    helpers: sample.slice(helpersStart, helpersEnd + OFFLINE_SERVICE_HELPERS_END.length),
    dispatch: sample.slice(dispatchStart, dispatchEnd + OFFLINE_SERVICE_DISPATCH_END.length),
  };
}

const OFFLINE_PYTHON_HEADER = `# -*- coding: utf-8 -*-
import json
import os
import sys
import time
import traceback
import hashlib
`;

function buildOfflineActionScript(requestPath, resultPath) {
  const requestLiteral = JSON.stringify(path.resolve(requestPath));
  const resultLiteral = JSON.stringify(path.resolve(resultPath));
  return `# -*- coding: utf-8 -*-
import json
import os
import sys
import time
import traceback
import hashlib

request_path = ${requestLiteral}
result_path = ${resultLiteral}
# 单发脚本 = 一个进程只服务一次动作，所以"复用已打开的工程"在这里没有意义：
# 进程结束即释放。置 False 让这段共用代码在单发路径上**一字不改**地保持原有语义
# （每个动作 projects.open + finally project.close）。
PERSIST_OPEN_PROJECT = False

${OFFLINE_SERVICE_HELPERS_START}
def read_json(path_value):
    handle = open(path_value, 'rb')
    try:
        return json.loads(handle.read().decode('utf-8'))
    finally:
        handle.close()

def write_json(value):
    parent = os.path.dirname(result_path)
    if parent and not os.path.isdir(parent): os.makedirs(parent)
    handle = open(result_path, 'wb')
    try:
        handle.write(json.dumps(value, sort_keys=True, ensure_ascii=False).encode('utf-8'))
    finally:
        handle.close()

def value_or(obj, name, default=None):
    try: return getattr(obj, name)
    except: return default

def object_name(obj):
    try: return obj.get_name()
    except: return str(value_or(obj, 'name', ''))

def object_class(obj):
    try: return str(obj.__class__.__name__)
    except: return ''

def object_children(obj):
    # Direct children only. get_children is documented with a recursive flag;
    # when a CODESYS build rejects the positional form, fall back to the keyword
    # form, and treat any failure as "no children" (the caller still reports such
    # objects as ungrouped roots, so nothing disappears from the payload).
    for call in (lambda: obj.get_children(False), lambda: obj.get_children(recursive=False)):
        try:
            children = call()
            return list(children) if children else []
        except: pass
    return []

def object_row(obj):
    row = {
        'name': object_name(obj),
        'type': str(value_or(obj, 'type', '')),
        'guid': str(value_or(obj, 'guid', '')),
        'isFolder': bool(value_or(obj, 'is_folder', False)),
        'hasDeclaration': bool(value_or(obj, 'has_textual_declaration', False)),
        'hasImplementation': bool(value_or(obj, 'has_textual_implementation', False)),
        'isApplication': bool(value_or(obj, 'is_application', False)),
        'hasLibraryManager': bool(value_or(obj, 'has_library_manager', False))
    }
    try:
        if row['hasDeclaration'] or hasattr(obj, 'textual_declaration'):
            row['declaration'] = obj.textual_declaration.text
    except: pass
    try:
        if row['hasImplementation'] or hasattr(obj, 'textual_implementation'):
            row['implementation'] = obj.textual_implementation.text
    except: pass
    # 库管理的读取**只对真的带库管理器的对象做**：get_library_manager() 是一次跨进
    # CODESYS 模型层的调用，而真机实测 63 个对象里只有 Application 一个有库管理器
    # （hasLibraryManager=1 / withLibraries=1），其余 62 次调用纯属白花 —— 对象树
    # walkMs 2594 毫秒里有一大块就是它们。判据用 CODESYS 自己报的 has_library_manager，
    # 也就是这一行上面已经读进 row['hasLibraryManager'] 的那个标志，所以读到的库一个不少。
    try:
        if row['hasLibraryManager']:
            manager = obj.get_library_manager()
            refs = []
            for ref in manager.references:
                refs.append({'name': str(value_or(ref, 'name', '')), 'namespace': str(value_or(ref, 'namespace', '')), 'id': str(value_or(ref, 'id', ''))})
            row['libraries'] = refs[:500]
    except: pass
    return row

def find_one(project, name, guid='', require_text=False):
    matches = project.find(name, True) or []
    if guid:
        wanted_guid = str(guid).lower()
        matches = [obj for obj in matches if str(value_or(obj, 'guid', '')).lower() == wanted_guid]
    if require_text:
        matches = [obj for obj in matches if bool(value_or(obj, 'has_textual_declaration', False)) or bool(value_or(obj, 'has_textual_implementation', False))]
    if len(matches) == 0: raise Exception('Object not found: ' + name)
    if len(matches) > 1: raise Exception('Object name is ambiguous; provide objectGuid: ' + name)
    return matches[0]

class TaskHiveExportReporter(ExportReporter):
    def __init__(self): self.messages = []
    def error(self, obj, message): self.messages.append({'level':'error','object':object_name(obj),'message':str(message)})
    def warning(self, obj, message): self.messages.append({'level':'warning','object':object_name(obj),'message':str(message)})
    def nonexportable(self, obj): self.messages.append({'level':'skipped','object':object_name(obj),'message':'nonexportable'})
    @property
    def aborting(self): return False

class TaskHiveImportReporter(ImportReporter):
    def __init__(self): self.messages = []
    def error(self, message): self.messages.append({'level':'error','message':str(message)})
    def warning(self, message): self.messages.append({'level':'warning','message':str(message)})
    def added(self, obj): self.messages.append({'level':'added','object':object_name(obj)})
    def replaced(self, obj): self.messages.append({'level':'replaced','object':object_name(obj)})
    def skipped(self, objectname): self.messages.append({'level':'skipped','object':str(objectname)})
    def resolve_conflict(self, obj): return ConflictResolve.Replace
    @property
    def aborting(self): return False

def apply_project_changes(project, changes):
    applied = []
    for change in changes:
        operation = str(change.get('operation', 'update-text'))
        if operation in ['create-pou', 'create-gvl', 'create-dut']:
            parent_name = change.get('parentName', '')
            container = find_one(project, parent_name) if parent_name else value_or(project, 'active_application', None)
            if container is None: raise Exception('No active application/container; provide parentName')
            if operation == 'create-pou':
                pou_types = {'program': PouType.Program, 'function-block': PouType.FunctionBlock, 'function': PouType.Function}
                created = container.create_pou(change['objectName'], pou_types.get(change.get('pouType', 'program'), PouType.Program), ImplementationLanguages.st)
            elif operation == 'create-gvl': created = container.create_gvl(change['objectName'])
            else: created = container.create_dut(change['objectName'], DutType.Structure)
            if change.get('declaration') is not None and hasattr(created, 'textual_declaration'): created.textual_declaration.replace(change.get('declaration', ''))
            if change.get('implementation') is not None and hasattr(created, 'textual_implementation'): created.textual_implementation.replace(change.get('implementation', ''))
            applied.append({'operation': operation, 'object': object_row(created)})
        elif operation == 'update-text':
            target = find_one(project, change['objectName'], change.get('objectGuid', ''), True)
            if change.get('declaration') is not None: target.textual_declaration.replace(change.get('declaration', ''))
            if change.get('implementation') is not None: target.textual_implementation.replace(change.get('implementation', ''))
            applied.append({'operation': operation, 'object': object_row(target)})
        else:
            raise Exception('Unsupported batch operation: ' + operation)
    return applied

def collect_build_messages():
    # SP20 declares get_message_objects(category, severities). The old no-argument
    # call raised TypeError inside a bare except, so the message list was ALWAYS
    # empty and the workbench only ever showed stderr-derived diagnostics. Probe
    # the real signatures at runtime instead of hard-coding one build's shape.
    categories = [None, '', 'Compiler', 'Build']
    severities = []
    try:
        for name in ('All', 'Any', 'Error', 'Warning', 'Information'):
            try: severities.append(getattr(Severity, name))
            except: pass
    except: pass
    severities.append(None)
    for category in categories:
        for severity in severities:
            for call in (lambda c=category, s=severity: system.get_message_objects(c, s),
                         lambda c=category: system.get_message_objects(c)):
                try:
                    value = call()
                except:
                    continue
                if value is None: continue
                try:
                    items = list(value)
                except:
                    continue
                if items: return items
    try:
        return [{'severity': 'Info', 'text': str(message)} for message in (system.get_messages('Compiler') or [])]
    except:
        return []

def run_project_build(project, action):
    application = value_or(project, 'active_application', None)
    if application is None: raise Exception('Project has no active application')
    if action == 'build': application.build()
    else: application.rebuild()
    messages = []
    for item in collect_build_messages():
        if isinstance(item, dict):
            messages.append({'severity': str(item.get('severity', 'Info')), 'text': str(item.get('text', ''))})
            continue
        messages.append({'severity': str(value_or(item, 'severity', '')), 'text': str(value_or(item, 'text', item))})
    return messages

def build_result_fields(messages):
    # 消息为空**不等于**没有错误：SP20 上 get_message_objects 的签名探测失败时这里
    # 就是空表，旧代码把空表写成 errorCount=0，于是失败的编译在界面上显示成
    # "0 错误、编译成功"。现在：有错误明细按明细计，有消息但全是 Info 记 0（有依据的
    # 0），一条消息都没有记 None（未知）；最终计数以 JS 侧解析的 CODESYS 真实汇总行
    # （形如 N错误,N警告）为准。
    errors = [item for item in messages if 'error' in str(item.get('severity', '')).lower()]
    warnings = [item for item in messages if 'warning' in str(item.get('severity', '')).lower()]
    fields = {'messageCount': len(messages), 'warningCount': len(warnings) if messages else None, 'errorCountKnown': False, 'errorCountSource': 'unknown'}
    if errors:
        fields['errorCount'] = len(errors)
        fields['errorCountSource'] = 'message-severity'
    elif messages:
        fields['errorCount'] = 0
    else:
        fields['errorCount'] = None
    return fields

def collect_project_tree(project, result, inspect_started):
    # Phase timings: the caller needs to know whether a slow read is
    # CODESYS starting up, the tree walk, or the payload layout — the
    # Python side is the only place that can tell them apart.
    inspect_started = time.time()
    walked_started = None
    # A flat recursive list cannot say WHERE an object lives, and the
    # ScriptEngine returns it in its own order, so the workbench could
    # only ever show one level. Walk the tree one level at a time and
    # record each object's parent, depth and path — that is what makes a
    # real CODESYS-like tree (device → Plc Logic → application → POU /
    # GVL / DUT / Library Manager) possible.
    #
    # Coverage is preserved unconditionally: every object of the flat
    # list that the walk could not reach is appended as an ungrouped
    # root, so the model context and the write path keep seeing the
    # complete project even on a CODESYS build whose tree API differs.
    active_application = value_or(project, 'active_application', None)
    result['project'] = {'path': str(project.path), 'dirty': bool(project.dirty), 'activeApplication': object_name(active_application) if active_application else ''}
    rows = []
    seen_guids = set()
    seen_names = set()
    def walk(obj, parent_row, depth):
        guid = str(value_or(obj, 'guid', ''))
        if guid and guid in seen_guids: return
        row = object_row(obj)
        row['parentGuid'] = parent_row.get('guid', '') if parent_row else ''
        row['parentName'] = parent_row.get('name', '') if parent_row else ''
        row['depth'] = depth
        row['path'] = (parent_row.get('path', []) if parent_row else []) + [row['name']]
        row['className'] = object_class(obj)
        children = object_children(obj)
        row['hasChildren'] = len(children) > 0
        if guid: seen_guids.add(guid)
        elif row['name']: seen_names.add(row['name'])
        rows.append(row)
        for child in children:
            walk(child, row, depth + 1)
    roots = list(project.get_children(False) or [])
    for root in roots:
        walk(root, None, 0)
    walk_done = time.time()
    ungrouped = 0
    for obj in (project.get_children(True) or []):
        guid = str(value_or(obj, 'guid', ''))
        name = object_name(obj)
        if guid and guid in seen_guids: continue
        if not guid and name and name in seen_names: continue
        row = object_row(obj)
        row['parentGuid'] = ''
        row['parentName'] = ''
        row['depth'] = 0
        row['path'] = [row['name']]
        row['className'] = object_class(obj)
        row['hasChildren'] = False
        row['ungrouped'] = True
        rows.append(row)
        if guid: seen_guids.add(guid)
        ungrouped += 1
    result['objects'] = rows
    result['objectCount'] = len(rows)
    result['hierarchy'] = {'roots': len(roots), 'grouped': len(rows) - ungrouped, 'ungrouped': ungrouped}
    result['timings'] = {'walkMs': int((walk_done - inspect_started) * 1000), 'coverageMs': int((time.time() - walk_done) * 1000), 'objects': len(rows)}
    # The scripting model can report code objects at PROJECT scope even
    # though the IDE shows them inside the application (they compile into
    # it and tasks call them). Measured on a real project: 12 POUs and a
    # project-level GlobalTextList were project children while the
    # application owned the rest, which rendered as 18 top-level rows.
    # Re-parent those orphans to the active application so the workbench
    # tree matches the IDE, and mark the objects CODESYS hides (internal
    # __* names, and a project-level duplicate of an object the
    # application already owns, e.g. a second Library Manager).
    application_row = None
    for row in rows:
        if row.get('isApplication'): application_row = row; break
    if application_row is None and result['project']['activeApplication']:
        for row in rows:
            if row['name'] == result['project']['activeApplication']: application_row = row; break
    application_children = set()
    if application_row is not None:
        for row in rows:
            if row.get('parentGuid') and row['parentGuid'] == application_row.get('guid'):
                application_children.add(row['name'])
    application_scoped_types = set([
        '6f9dac99-8de1-4efc-8465-68ac443b7d08',  # POU
        'ffbfa93a-b94d-45fc-a329-229860183b1d',  # GVL
        '2db5746d-d284-4425-9f7f-2663a34b0ebc',  # DUT
        '63784cbb-9ba0-45e6-9d69-babf3f040511',  # Global text list
        'f7aa3620-8073-4c91-b6ec-86ed9eb60303',  # Trace
        'adb5cb65-8e1d-4a00-b70a-375ea27582f3',  # Library manager
    ])
    reparented = 0
    internal = 0
    for row in rows:
        if row.get('parentGuid'): continue
        if str(row['name']).startswith('__'):
            row['internal'] = True
            internal += 1
            continue
        if application_row is None: continue
        if row['name'] in application_children:
            row['internal'] = True
            row['internalReason'] = 'duplicate-of-' + application_row['name']
            internal += 1
            continue
        if str(row.get('type', '')).lower() in application_scoped_types:
            row['parentGuid'] = application_row.get('guid', '')
            row['parentName'] = application_row['name']
            row['reparented'] = True
            reparented += 1
    # Depth/path are always derived from the FINAL parent links, so a
    # re-parented object reports its real position in the tree.
    rows_by_guid = {}
    for row in rows:
        key = str(row.get('guid', '')).lower()
        if key: rows_by_guid[key] = row
    def row_chain(row, guard=0):
        if guard > 64: return [row['name']]
        parent = rows_by_guid.get(str(row.get('parentGuid', '')).lower())
        if parent is None or parent is row: return [row['name']]
        return row_chain(parent, guard + 1) + [row['name']]
    for row in rows:
        chain = row_chain(row)
        row['path'] = chain
        row['depth'] = len(chain) - 1
    result['hierarchy']['reparented'] = reparented
    result['hierarchy']['internal'] = internal
    result['hierarchy']['roots'] = len([row for row in rows if not row.get('parentGuid') and not row.get('internal') and row['depth'] == 0])
    result['timings']['totalMs'] = int((time.time() - inspect_started) * 1000)
    result['complete'] = True
    result['textTruncated'] = False

${OFFLINE_SERVICE_HELPERS_END}
request = read_json(request_path)
${OFFLINE_SERVICE_DISPATCH_START}
# ── 跨动作复用"已打开的工程"（本轮最高收益）───────────────────────────────────
# 真机实测：每一次动作的 serviceMs 里 openMs 占 9–20 秒（inspect 13534ms 里 treeMs 只有
# 2664ms；apply 24253ms 里 applyMs 只有 909ms）。也就是说时间几乎全花在"重新 projects.open
# 一次工程"上，而不是动作本身。常驻 worker 已经让 Python/CODESYS 只冷启一次，但**工程对象**
# 每个请求都被 finally: project.close() 关掉，下一个请求再开一遍 —— 这就是那个 9–20 秒。
#
# 复用判据（正确性优先，且绝不放宽任何一门）：
#   · 路径必须**逐字符相同**（不同文件的同名内容也不算命中）；
#   · 该文件的 sha256 必须与"打开它的时候"完全一致 —— 真读一遍文件算，不靠 mtime/size；
#   · 动作失败 ⇒ 立刻清空缓存（内存里的工程可能已被改到一半，绝不能留给下一次动作）；
#   · 只有常驻 worker 打开这个开关（单发脚本 PERSIST_OPEN_PROJECT=False，语义与改前一致）。
#
# 为什么"自己 save 过之后"要把缓存键更新成新的 sha 而不是作废：save 之后磁盘字节就是内存
# 里那份工程，两者逐字节相同，所以下一次动作复用它是**语义等价**的，不是投机。
_OPEN_PROJECT_STATE_KEY = '__taskhive_open_project_state__'
_TREE_KEYS = ['project', 'objects', 'objectCount', 'hierarchy', 'timings', 'complete', 'textTruncated']


def open_project_state():
    store = globals().get(_OPEN_PROJECT_STATE_KEY)
    if not isinstance(store, dict):
        store = {'path': '', 'sha256': '', 'project': None, 'tree': None, 'treeKey': ''}
        globals()[_OPEN_PROJECT_STATE_KEY] = store
    return store


def project_file_sha(project_path):
    handle = open(project_path, 'rb')
    digest = hashlib.sha256()
    try:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    finally:
        handle.close()
    return digest.hexdigest()


def close_cached_project():
    store = open_project_state()
    project = store.get('project')
    store['project'] = None
    store['path'] = ''
    store['sha256'] = ''
    store['tree'] = None
    store['treeKey'] = ''
    if project is not None:
        try: project.close()
        except: pass


def acquire_project(project_path):
    # 返回 (project, reused)。reused=True 表示这一次**没有**花 openMs。
    if not globals().get('PERSIST_OPEN_PROJECT'):
        return projects.open(project_path), False
    store = open_project_state()
    try:
        current_sha = project_file_sha(project_path)
    except Exception:
        current_sha = ''
    if store.get('project') is not None and store.get('path') == project_path and current_sha and store.get('sha256') == current_sha:
        return store['project'], True
    # 源变了 / 换了文件 / 上一次失败过 ⇒ 先老老实实放掉旧的，再重新打开。
    close_cached_project()
    project = projects.open(project_path)
    store['project'] = project
    store['path'] = project_path
    store['sha256'] = current_sha
    store['tree'] = None
    store['treeKey'] = ''
    return project, False


def save_project(project, project_path):
    # 所有落盘点都走这一个函数：save 之后把缓存键推进到新的磁盘 sha。不做这一步的话，
    # "读完→改一行→写入"这条最常见的链路上，写入会白开一次工程（openMs 10–20 秒）。
    #
    # 计数（T196 第 B 项）：_SAVE_CALLS 在每次请求开始时归零，所以它回答的是
    # "**这一次动作**让 CODESYS 序列化了几次整个工程"。saveMs 只说明这一段花了多久，
    # 只有计数能证明"没有重复保存"。它随结果一起回给宿主，并由宿主写进结构化耗时流。
    globals()['_SAVE_CALLS'] = int(globals().get('_SAVE_CALLS') or 0) + 1
    project.save()
    if not globals().get('PERSIST_OPEN_PROJECT'):
        return
    store = open_project_state()
    try:
        current_sha = project_file_sha(project_path)
    except Exception:
        current_sha = ''
    if current_sha:
        store['project'] = project
        store['path'] = project_path
        store['sha256'] = current_sha
    else:
        close_cached_project()
    # 落了盘 ⇒ 上一次缓存的树一定过期。
    store['tree'] = None
    store['treeKey'] = ''


def take_cached_tree(project_path):
    # 源没变 + 同一个文件 ⇒ 对象树逐字节相同（它是 .project 保存字节的纯函数），
    # 所以 treeMs（真机 1.9–2.8 秒）可以整个省掉。
    if not globals().get('PERSIST_OPEN_PROJECT'):
        return None
    store = open_project_state()
    if store.get('tree') is not None and store.get('path') == project_path and store.get('treeKey') == store.get('sha256'):
        return store['tree']
    return None


def store_cached_tree(project_path, result):
    if not globals().get('PERSIST_OPEN_PROJECT'):
        return
    store = open_project_state()
    if not store.get('sha256') or store.get('path') != project_path:
        return
    snapshot = {}
    for key in _TREE_KEYS:
        if key in result:
            snapshot[key] = result[key]
    store['tree'] = snapshot
    store['treeKey'] = store['sha256']


def handle_request(request):
    # 一次动作 = 一次请求。单发脚本与常驻 worker 都只调用这一个函数。
    action = request['action']
    project_path = request.get('projectPath', '')
    # 每次请求都归零：常驻 worker 一个进程服务很多次动作，跨请求累计的计数器会撒谎。
    globals()['_SAVE_CALLS'] = 0
    # ── 两条控制型请求：只管理"已打开的工程对象"，不碰工程内容 ───────────────────
    #   · release-project：宿主准备覆盖工作副本文件之前，先让 CODESYS 放开句柄。
    #     Windows 上覆盖一个仍被 CODESYS 持有的 .project 会失败，所以"复用已打开的
    #     工程"必须配一条让路命令，否则提速就会变成一个新的 EBUSY 故障。
    #   · preload-project：把工程**提前**打开（绑定后的工作副本，或"预打开"提前交给它的
    #     副本），让紧接着的第一次读取只需要走对象树。
    #     includeTree=True 时顺带把对象树也走一遍：这是 T196 提前预打开服务的那一次
    #     walk（第一次真读本来就要付它），treeMs 如实自报，绝不藏进读取的计时里。
    if action == 'release-project':
        close_cached_project()
        return {'ok': True, 'action': action, 'safetyMode': 'isolated-offline-project-only', 'released': True, 'stillOpen': False, 'saveCalls': 0}
    if action == 'preload-project':
        step = time.time()
        _project, _reused = acquire_project(project_path)
        _open_ms = int((time.time() - step) * 1000)
        _tree_ms = 0
        payload = {'ok': True, 'action': action, 'safetyMode': 'isolated-offline-project-only', 'projectPath': project_path, 'preloaded': True, 'openReused': 1 if _reused else 0, 'heldProjectPath': project_path, 'saveCalls': int(globals().get('_SAVE_CALLS') or 0)}
        if request.get('includeTree') is True:
            # 走树之前先问缓存：worker 已经为**同一份字节**走过一次的话，那棵树逐字节相同
            # （它是保存字节的纯函数），再走一遍纯属白花 —— 这正是 inspect-project 的判据。
            _cached = take_cached_tree(project_path)
            if _cached is not None:
                payload.update(_cached)
                payload['treeReused'] = 1
            else:
                _step = time.time()
                collect_project_tree(_project, payload, time.time())
                store_cached_tree(project_path, payload)
                _tree_ms = int((time.time() - _step) * 1000)
        # phaseMs 必须如实给出：预开**也要**报它花掉的 openMs/treeMs，否则它就会变成一个
        # "藏在读取前面、谁也看不见"的黑箱（这正是上一轮埋点要消灭的那种谎报）。
        payload['phaseMs'] = {'openMs': _open_ms, 'applyMs': 0, 'saveMs': 0, 'buildMs': 0, 'treeMs': _tree_ms, 'totalMs': _open_ms + _tree_ms}
        return payload
    project = None
    result = {'ok': True, 'action': action, 'safetyMode': 'isolated-offline-project-only', 'projectPath': project_path, 'reporterGlobals': sorted([str(key) for key in globals().keys() if 'Reporter' in str(key) or 'Conflict' in str(key)])}
    # 分段计时：只有 Python 侧分得清"打开工程 / 应用改动 / 落盘 / 编译 / 生成对象树"，
    # 宿主看到的是一个进程的墙钟。字段名固定，落进 payload.phaseMs（新增键，不改旧键）。
    #   applyMs 与 buildMs 必须**分开**：T183 第 4 项（拆分 apply 与 build）要求"点击→落盘"
    #   与"点击→编译结束"是两段可举证的耗时，而不是一个 115 秒的黑箱。
    phase = {'openMs': 0, 'applyMs': 0, 'saveMs': 0, 'buildMs': 0, 'treeMs': 0}
    request_started = time.time()

    def stamp(name, started):
        try: phase[name] = int((time.time() - started) * 1000)
        except Exception: pass

    try:
        if action == 'create-project':
            step = time.time()
            project = projects.create(project_path, True)
            save_project(project, project_path)
            stamp('openMs', step)
            result['created'] = True
            result['heldProjectPath'] = project_path
        else:
            step = time.time()
            project, project_reused = acquire_project(project_path)
            result['openReused'] = 1 if project_reused else 0
            result['heldProjectPath'] = project_path
            stamp('openMs', step)
            if action == 'inspect-project':
                step = time.time()
                cached_tree = take_cached_tree(project_path)
                if cached_tree is not None:
                    # 源 sha 未变 + 同一个文件 ⇒ 这棵树与上次逐字节相同，直接复用。
                    result.update(cached_tree)
                    result['treeReused'] = 1
                else:
                    collect_project_tree(project, result, time.time())
                    store_cached_tree(project_path, result)
                stamp('treeMs', step)
            elif action in ['create-pou', 'create-gvl', 'create-dut']:
                step = time.time()
                parent_name = request.get('parentName', '')
                container = find_one(project, parent_name) if parent_name else value_or(project, 'active_application', None)
                if container is None: raise Exception('No active application/container; provide parentName')
                if action == 'create-pou':
                    pou_types = {'program': PouType.Program, 'function-block': PouType.FunctionBlock, 'function': PouType.Function}
                    created = container.create_pou(request['objectName'], pou_types[request.get('pouType', 'program')], ImplementationLanguages.st)
                elif action == 'create-gvl': created = container.create_gvl(request['objectName'])
                else: created = container.create_dut(request['objectName'], DutType.Structure)
                if request.get('declaration') is not None and hasattr(created, 'textual_declaration'): created.textual_declaration.replace(request.get('declaration', ''))
                if request.get('implementation') is not None and hasattr(created, 'textual_implementation'): created.textual_implementation.replace(request.get('implementation', ''))
                stamp('applyMs', step)
                step = time.time()
                save_project(project, project_path)
                stamp('saveMs', step)
                result['createdObject'] = object_row(created)
            elif action == 'update-text':
                step = time.time()
                target = find_one(project, request['objectName'], request.get('objectGuid', ''), True)
                if request.get('declaration') is not None: target.textual_declaration.replace(request.get('declaration', ''))
                if request.get('implementation') is not None: target.textual_implementation.replace(request.get('implementation', ''))
                stamp('applyMs', step)
                step = time.time()
                save_project(project, project_path)
                stamp('saveMs', step)
                result['updatedObject'] = object_row(target)
            elif action == 'apply-changes':
                # Batch all confirmed object edits in one ScriptEngine process and
                # one project.save().  The previous UI loop spawned CODESYS once
                # per object, which made multi-object writes needlessly serial.
                step = time.time()
                applied = apply_project_changes(project, request.get('changes', []))
                stamp('applyMs', step)
                step = time.time()
                save_project(project, project_path)
                stamp('saveMs', step)
                result['applied'] = applied
                result['changeCount'] = len(applied)
            elif action == 'apply-and-build':
                # ONE CODESYS process for the whole confirmed write: apply the batch,
                # save once (exactly as apply-changes does), compile offline, then hand
                # back the refreshed object tree so the workbench needs no third launch.
                #
                # Why: measured on a real 62-object project, one confirmed write was
                #   apply-changes 34-36 s + build 45-47 s + inspect-project 32-34 s
                #   = ~115 s, and scriptEngineProcess was 99.9 % of EACH call
                #   (34,387 / 34,411 ms): the cost was three CODESYS startups, not the
                #   edits themselves. The three steps share one process here.
                #
                # 拆分（T183 第 4 项）：apply+save 完成后立刻置 applyCommitted，编译与读树
                # 是**之后**的阶段。request['build'] is False 时只落盘不编译 —— 这就是
                # "apply 落盘即回报 / build 异步"的服务端一半（宿主侧见 deferBuild）。
                step = time.time()
                applied = apply_project_changes(project, request.get('changes', []))
                stamp('applyMs', step)
                step = time.time()
                save_project(project, project_path)
                stamp('saveMs', step)
                result['applied'] = applied
                result['changeCount'] = len(applied)
                result['applyCommitted'] = True
                result['applyCommittedAt'] = time.time()
                if request.get('build') is not False:
                    step = time.time()
                    messages = run_project_build(project, 'build')
                    stamp('buildMs', step)
                    result['messages'] = messages[-1000:]
                    result.update(build_result_fields(messages))
                elif request.get('includeTree') is not False:
                    # 只落盘的路径不编译，也就不产生编译消息：显式给出空表，别让调用方
                    # 把"没编译"读成"编译通过、0 错误"。
                    result['messages'] = []
                    result['buildSkipped'] = True
                if request.get('includeTree') is not False:
                    step = time.time()
                    collect_project_tree(project, result, time.time())
                    # 记在**落盘之后**的新 sha 上：紧接着的第一次读取因此连 treeMs
                    # （真机 1.9–2.8 秒）都不用付。
                    store_cached_tree(project_path, result)
                    stamp('treeMs', step)
            elif action == 'export-xml':
                target_name = request.get('objectName', '')
                target = find_one(project, target_name) if target_name else project
                reporter = TaskHiveExportReporter()
                target.export_xml(reporter, request['xmlPath'], True)
                result['xmlPath'] = request['xmlPath']
                result['messages'] = reporter.messages
            elif action == 'import-xml':
                reporter = TaskHiveImportReporter()
                project.import_xml(reporter, request['xmlPath'])
                step = time.time()
                save_project(project, project_path)
                stamp('saveMs', step)
                result['xmlPath'] = request['xmlPath']
                result['messages'] = reporter.messages
            elif action == 'build' or action == 'rebuild':
                step = time.time()
                messages = run_project_build(project, action)
                stamp('buildMs', step)
                result['messages'] = messages[-1000:]
                result.update(build_result_fields(messages))
    except Exception:
        # 动作失败 ⇒ 内存里的工程可能已经被改到一半：**绝不能**留给下一次动作复用。
        # 安全网宁可让它下次重新 open（10–20 秒），也不拿一个半成品当"已保存的工程"。
        if globals().get('PERSIST_OPEN_PROJECT'):
            close_cached_project()
        raise
    finally:
        # 只有单发脚本在这里关工程。常驻 worker 把工程留着给下一次动作用 —— 那正是
        # openMs 9–20 秒的来源（见 acquire_project 的说明）。
        if project is not None and not globals().get('PERSIST_OPEN_PROJECT'):
            try: project.close()
            except: pass
    try:
        phase['totalMs'] = int((time.time() - request_started) * 1000)
        result['phaseMs'] = phase
        # 这一次动作真的 save 了几次（B 项的举证字段；0 = 这个动作本来就不落盘）。
        result['saveCalls'] = int(globals().get('_SAVE_CALLS') or 0)
    except Exception:
        pass
    return result

${OFFLINE_SERVICE_DISPATCH_END}
write_json(handle_request(request))
`;
}

// 常驻 worker（T183 第 1 项）：一次进程服务多次动作。
//
// 为什么这是最大的一刀：现场实测 `scriptEngineProcess` 占一次动作的 99.9 %
// （34,387 / 34,411 ms）—— 花的不是编辑，是 CODESYS + IronPython 的冷启动。
// 本项目已有成功先例（app/win-window-host.ps1 的常驻 worker 把 632–733 ms 打到 5–7 ms）。
//
// 协议与 online-session.cjs 完全同形，理由是那份已经被现场验证过：
//   · 目录里**每一个**交换文件名都带运行令牌 —— 一个"上次没退干净、还在等命令"的旧
//     进程只认自己的文件，谁也命令不动它，它按自己的空闲上限退出（避免同一条写被跑两次）；
//   · 命令走文件、结果走文件，stdio 只进日志；宿主不依赖管道中继输出；
//   · 每次命令先把 seq 写进 ack 文件再干活 —— 宿主据此区分"命令被接走了（可能已动过
//     工程）"和"命令根本没被接走（可以安全落回冷启动，绝不重放写动作）"；
//   · 空闲上限到了自己退出，不靠宿主心跳续命。
function buildPersistentOfflineWorkerScript(workDir, options = {}) {
  const workLiteral = JSON.stringify(path.resolve(workDir));
  // 空闲上限：worker 就是这个模块"摊掉冷启动 + 摊掉开工程"的那一份状态，所以它一旦自杀，
  // 下一次动作要重新付 pythonStartMs（真机 4.4–11.9 秒）+ openMs（9–20 秒）。
  // 真机原文（logs/codesys-timings.jsonl）证明过一次自杀：bind 在 1791125894187，
  // 下一个动作在 1791127158327 —— 相隔 1264 秒 > 旧的 900 秒上限，于是那一次写
  // pythonReused=0 / processStarts=1 / pythonStartMs=11861，整条写 41.4 秒。
  //
  // 默认从 900 秒提到 3600 秒，并且可以显式覆盖（构造参数 offlineWorkerIdleSeconds /
  // 环境变量 TASKHIVE_CODESYS_WORKER_IDLE_SECONDS）。**仍然是有上限的**：它不是一个
  // 永不退出的进程 —— 应用退出（process.on('exit') 写停止文件）、动作超时、常驻路径连续
  // 失败、显式 stopOfflineWorker 都会立刻收掉它；在线会话那条 600 秒的上限一字未改
  // （它持有 PLC 连接，性质不同：见 codesys-online-gate-contract.js 第 12 节）。
  const configured = Number(options.maxIdleSeconds) || Number(process.env.TASKHIVE_CODESYS_WORKER_IDLE_SECONDS) || 0;
  const maxIdleSeconds = Math.max(60, configured || 3600);
  const tokenSuffix = JSON.stringify(String(options.runToken || '').trim());
  const service = offlineServiceText();
  return `${OFFLINE_PYTHON_HEADER}
WORK = ${workLiteral}
MAX_IDLE_SECONDS = ${maxIdleSeconds}
# 常驻 worker：跨动作复用"已打开的工程对象"。这一句就是 openMs（真机 9–20 秒）的开关。
PERSIST_OPEN_PROJECT = True
RUN_TOKEN = ${tokenSuffix}

COMMAND_PATH = os.path.join(WORK, 'offline-command' + RUN_TOKEN + '.json')
READY_PATH = os.path.join(WORK, 'offline-ready' + RUN_TOKEN + '.json')
STOP_PATH = os.path.join(WORK, 'offline-stop' + RUN_TOKEN)
ACK_PREFIX = 'offline-ack' + RUN_TOKEN + '-'
EXIT_PATH = os.path.join(WORK, 'offline-exit' + RUN_TOKEN + '.json')
POLL_SECONDS = 0.05

${service.helpers}

def write_json_atomic(target, value):
    parent = os.path.dirname(target)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    temp = target + '.tmp'
    handle = open(temp, 'wb')
    try:
        handle.write(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode('utf-8'))
    finally:
        handle.close()
    try:
        if os.path.exists(target):
            os.remove(target)
    except Exception:
        pass
    os.rename(temp, target)


def ack_path_for(seq):
    return os.path.join(WORK, ACK_PREFIX + str(seq) + '.json')


def announce_ready():
    write_json_atomic(READY_PATH, {
        'ok': True,
        'engine': 'CODESYS ScriptEngine',
        'pythonVersion': sys.version,
        'platform': sys.platform,
        'hasProjectsApi': 'projects' in globals(),
        'hasSystemApi': 'system' in globals(),
        'safetyMode': 'offline-worker-persistent',
        'pid': os.getpid(),
        'startedAt': time.time(),
    })


def read_command():
    if not os.path.exists(COMMAND_PATH):
        return None
    try:
        return read_json(COMMAND_PATH)
    except Exception:
        return None

${service.dispatch}

def main():
    announce_ready()
    last_active = time.time()
    seen_seq = 0
    while True:
        if os.path.exists(STOP_PATH):
            break
        if (time.time() - last_active) > MAX_IDLE_SECONDS:
            break
        payload = read_command()
        if not isinstance(payload, dict):
            time.sleep(POLL_SECONDS)
            continue
        try:
            seq = int(payload.get('seq') or 0)
        except Exception:
            seq = 0
        if seq <= seen_seq:
            time.sleep(POLL_SECONDS)
            continue
        # 先 ack 再干活：宿主用 ack 分辨"命令被接走了"与"命令没人接"。
        seen_seq = seq
        last_active = time.time()
        try:
            write_json_atomic(ack_path_for(seq), {'seq': seq, 'acceptedAt': time.time()})
        except Exception:
            pass
        request = payload.get('request') or {}
        result_path = str(payload.get('resultPath') or '')
        started = time.time()
        try:
            result = handle_request(request)
        except Exception:
            result = {
                'ok': False,
                'action': request.get('action'),
                'safetyMode': 'isolated-offline-project-only',
                'projectPath': request.get('projectPath', ''),
                'error': traceback.format_exc(),
            }
        try:
            result['serviceMs'] = int((time.time() - started) * 1000)
            result['workerSeq'] = seq
        except Exception:
            pass
        try:
            write_json_atomic(result_path, result)
        except Exception:
            try:
                write_json_atomic(os.path.join(WORK, 'offline-result-fallback' + RUN_TOKEN + '-' + str(seq) + '.json'), result)
            except Exception:
                pass
    try:
        write_json_atomic(EXIT_PATH, {'ok': True, 'at': time.time(), 'reason': 'idle-or-stop'})
    except Exception:
        pass


main()
`;
}

function boundedFind(directory, fileName, depth = 0) {
  if (!directory || depth > 4 || !fs.existsSync(directory)) return null;
  let entries = [];
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return path.join(directory, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = boundedFind(path.join(directory, entry.name), fileName, depth + 1);
    if (found) return found;
  }
  return null;
}

function candidateInstallations() {
  const candidates = [];
  if (process.env.TASKHIVE_CODESYS_EXE) candidates.push(process.env.TASKHIVE_CODESYS_EXE);
  const bases = [...new Set([
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ].filter(Boolean))];
  for (const base of bases) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^CODESYS\s+3\.5\./i.test(entry.name)) continue;
      candidates.push(path.join(base, entry.name, 'CODESYS', 'Common', 'CODESYS.exe'));
    }
  }
  return [...new Set(candidates)].filter((file) => fs.existsSync(file)).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
}

function versionFromExe(exePath) {
  const match = String(exePath || '').match(/CODESYS\s+(\d+\.\d+\.\d+\.\d+)/i);
  return match ? match[1] : null;
}

function profileFromVersion(version) {
  const parts = String(version || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return `CODESYS V${parts[0]}.${parts[1]} SP${parts[2]} Patch ${Math.floor(parts[3] / 10)}`;
}

function buildProbeScript(outputPath) {
  const target = JSON.stringify(path.resolve(outputPath));
  return `# -*- coding: utf-8 -*-\nimport json\nimport os\nimport sys\nimport traceback\n\noutput_path = ${target}\nresult = {\n    "ok": True,\n    "engine": "CODESYS ScriptEngine",\n    "pythonVersion": sys.version,\n    "platform": sys.platform,\n    "hasProjectsApi": "projects" in globals(),\n    "hasSystemApi": "system" in globals(),\n    "hasOnlineApi": "online" in globals(),\n    "safetyMode": "offline-probe-only"\n}\ntry:\n    parent = os.path.dirname(output_path)\n    if parent and not os.path.isdir(parent):\n        os.makedirs(parent)\n    handle = open(output_path, "wb")\n    handle.write(json.dumps(result, sort_keys=True))\n    handle.close()\nexcept Exception:\n    result = {"ok": False, "engine": "CODESYS ScriptEngine", "error": traceback.format_exc(), "safetyMode": "offline-probe-only"}\n    try:\n        handle = open(output_path, "wb")\n        handle.write(json.dumps(result, sort_keys=True))\n        handle.close()\n    except Exception:\n        pass\n`;
}

class CodesysScriptEngine {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.exePath = options.exePath || null;
    this.profile = options.profile || process.env.TASKHIVE_CODESYS_PROFILE || null;
    this.runProcess = options.runProcess || execFileAsync;
    // The online session spawns a long-lived process with file-backed stdio, so
    // it needs a spawner rather than the awaited execFile helper.
    this.spawnProcess = options.spawnProcess || null;
    this.onlineLog = typeof options.onlineLog === 'function' ? options.onlineLog : ((message) => console.log(`[codesys-online] ${message}`));
    // One online session at a time: it owns a PLC connection, and two of them
    // would fight over the same controller.
    this.onlineSession = null;
    this.onlineSessionJobId = '';
    // 最近一次从在线进程**观测到**的应用层登录状态（null = 还没观测过）。
    // 它只用于"写类动作是否被冻结"这一件事：读过一次 isLoggedIn=true 之后，即使下一次
    // status 读失败（在线进程正忙/刚被杀），写请求也仍然被拒 —— 不把"读不到"当成"没登录"，
    // 否则一个超时就成了绕过冻结的窗口。会话停止/重建时由 stopOnlineSession 清回 null。
    this.onlineLoggedInObserved = null;
    // 正在启动中的会话（promise）。启动要 20–40 秒，这段时间里 this.onlineSession
    // 还是 null，后来者必须等这个 promise 而不是再起一个（见 ensureOnlineSession）。
    this.onlineSessionPending = null;
    this.onlineSessionPendingJobId = '';
    // 每次"要求停止"都 +1，用来丢弃那些在停止请求之后才启动完成的会话。
    this.onlineSessionGeneration = 0;
    this.jobsRoot = path.join(this.root, 'workspaces', 'codesys-scriptengine', 'jobs');
    this.logsRoot = path.join(this.root, 'logs');
    // ── T183 提速（1/2/3/4 项）───────────────────────────────────────────────
    // 常驻 ScriptEngine worker：长驻进程 + 文件型 stdio，形状是 spawn 而不是 execFile。
    // 什么时候启用（这条规则很重要，它决定了契约测试怎么注入）：
    //   · 宿主没有注入**任何**进程接缝（生产：`new CodesysScriptEngine(root)`）⇒ 启用；
    //   · 调用方注入了 runProcess（模拟单发 CODESYS）或 spawnProcess（模拟在线 worker）
    //     ⇒ 说明它要自己决定进程形状，常驻路径关闭，走原来的单发路径。
    // 另外还留了显式开关 persistentScriptEngine，便于契约/运维单独验证两条路径。
    this.persistentScriptEngine = options.persistentScriptEngine !== undefined
      ? options.persistentScriptEngine === true
      : (options.runProcess === undefined && options.spawnProcess === undefined);
    this.offlineSpawnProcess = options.offlineSpawnProcess || options.spawnProcess || spawn;
    this.offlineWorker = null;
    this.offlineWorkerPending = null;
    // 命令通道的串行化：常驻 worker 一次只服务一条命令（协议就是一个命令文件 + 逐 seq
    // 结果文件）。两个并发调用若各自写命令文件，后写的会覆盖前一个，前一个就永远等不到
    // 自己的 seq —— 那不只是慢，超时分支还会把 worker 收掉。控制型命令（preload /
    // release）也要走同一条队列，所以这把锁是必须的，不能只依赖 ensureOfflineWorker 的锁。
    this.offlineCommandPending = null;
    // worker 空闲上限（秒）。显式传值可覆盖默认的 3600（见 buildPersistentOfflineWorkerScript）。
    this.offlineWorkerIdleSeconds = Number(options.offlineWorkerIdleSeconds) || 0;
    this.offlineWorkerRunToken = '';
    // 熔断：常驻起不来时不要每个动作都白等一次启动超时，退避一段时间再试。
    this.offlineWorkerDisabledUntil = 0;
    this.offlineWorkerFailures = 0;
    this.offlineWorkerLog = typeof options.offlineWorkerLog === 'function' ? options.offlineWorkerLog : ((message) => console.log(`[codesys-offline-worker] ${message}`));
    this.offlineWorkerExitHook = false;
    this.workerRoot = path.join(this.root, 'workspaces', 'codesys-scriptengine', 'worker');
    // 预打开（T196 A 项）里"待绑定的那一个作业"。只留一个：下一个预打开把它顶掉。
    // 绑定接管它（takePreopenedJob）时清空；源变了 / 作业没了就作废。
    this.preopenedJob = null;
    // stat 校验过的 sha 缓存（"只对改动对象算哈希"在文件层面的可行形态，见 sha256 注释）。
    this.shaCache = new Map();
    // 结构化耗时埋点的出口：默认每次动作 append 一行 JSONL（固定字段名，可直接聚合）。
    // 注入 timingSink 时**同时**调用它 —— 宿主想接 harness.append 只需要在
    // `new CodesysScriptEngine(root)` 传一个函数，不必改这个文件。
    this.timingSink = typeof options.timingSink === 'function' ? options.timingSink : null;
    this.timingsLogPath = path.join(this.logsRoot, 'codesys-timings.jsonl');
    // 拆分 apply/build 之后，后台编译任务的对象（buildId → promise），只用于自报与测试等待。
    this.deferredBuildTasks = new Map();
    // Installation discovery walks the CODESYS plug-in tree. Cache it briefly
    // so opening a workbench and refreshing its project do not repeat that
    // expensive scan on every action.
    this.doctorCache = null;
    this.inspectCache = new Map();
    // 按 job 的互斥：同一个作业上的两个动作（写盘 + 编译、回滚 + 直写…）会各自
    // readJob → 改内存 → writeJob，互相覆盖对方的 actions/currentSha256/snapshots。
    // 队列挂在 jobId 上，第二个调用者等第一个释放后才进入临界区。
    this.jobLocks = new Map();
    // Persistent inspect cache. Launching the CODESYS ScriptEngine dominates the
    // cost of reading a project (measured: scriptEngineProcess = 31,852 ms for a
    // 66-object project), and the result is a pure function of the saved
    // .project bytes — so it survives restarts, keyed by that file's sha256.
    this.inspectCacheRoot = path.join(this.root, 'cache', 'codesys-inspect');
  }

  inspectCacheFile(sourceSha256) {
    return path.join(this.inspectCacheRoot, `${String(sourceSha256 || '').slice(0, 64)}.json`);
  }

  readInspectDiskCache(sourceSha256) {
    if (!sourceSha256) return null;
    const file = this.inspectCacheFile(sourceSha256);
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!payload || payload.complete !== true || !Array.isArray(payload.objects)) return null;
      const now = new Date();
      try { fs.utimesSync(file, now, now); } catch { /* LRU touch is best effort */ }
      return payload;
    } catch { return null; }
  }

  writeInspectDiskCache(sourceSha256, payload) {
    if (!sourceSha256 || !payload || payload.complete !== true || !Array.isArray(payload.objects)) return false;
    try {
      fs.mkdirSync(this.inspectCacheRoot, { recursive: true });
      const file = this.inspectCacheFile(sourceSha256);
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(payload), 'utf8');
      fs.renameSync(temp, file);
      // Keep the cache bounded: newest 8 projects by mtime.
      const entries = fs.readdirSync(this.inspectCacheRoot)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .map((name) => {
          const full = path.join(this.inspectCacheRoot, name);
          let at = 0;
          try { at = fs.statSync(full).mtimeMs } catch { at = 0 }
          return { full, at };
        })
        .sort((left, right) => right.at - left.at);
      for (const stale of entries.slice(8)) { try { fs.unlinkSync(stale.full) } catch { /* best effort */ } }
      return true;
    } catch { return false }
  }

  // ── 哈希：stat 校验过的缓存（T183 第 3 项）──────────────────────────────
  // 现状实测：一次 apply 会对**同一个** 1.2 MB 的 .project 算 ~6 次全文件 sha256。
  // 这里把"记账/缓存键"用的哈希换成 stat 校验过的缓存：size+mtime+ctime+ino 全同 ⇒
  // 复用上次结果；任何一项不同 ⇒ 老老实实重算。
  //
  // 安全边界（必须写清楚，因为它决定了什么能缓存、什么绝不能）：
  //   · **写入守卫绝不走这个函数** —— commitProject / checkSourceUnchanged 的对源哈希
  //     永远是 `sha256()` 直接调用（真读一遍文件）。缓存一旦撒谎，守卫只会更保守
  //     （期望值与磁盘不一致 ⇒ 拒绝提交），永远不会放行一次覆盖。
  //   · 缓存只用于 job.currentSha256 这类记账、以及 inspect 缓存键。
  //   · 每次本进程写过的路径都显式失效（不靠 stat 自己变）。
  sha256Validated(file, trace) {
    const resolved = path.resolve(String(file || ''));
    const key = resolved.toLowerCase();
    let stat = null;
    try { stat = fs.statSync(resolved) } catch { return sha256(resolved, trace) }
    const signature = `${stat.size}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.ino}|${stat.birthtimeMs}`;
    const hit = this.shaCache.get(key);
    if (hit && hit.signature === signature) {
      if (trace) trace.count('hashCacheHits', 1);
      if (trace) trace.bytes('hashBytesSaved', stat.size);
      return hit.sha;
    }
    const digest = sha256(resolved, trace);
    this.shaCache.set(key, { signature, sha: digest });
    if (this.shaCache.size > 64) this.shaCache.delete(this.shaCache.keys().next().value);
    return digest;
  }

  invalidateShaCache(file) {
    try { this.shaCache.delete(path.resolve(String(file || '')).toLowerCase()) } catch { /* best effort */ }
  }

  // 结构化耗时埋点：一次动作一行 JSONL（append-only）。字段名固定、不做嵌套，
  // 直接 `jq -s 'group_by(.action)' logs/codesys-timings.jsonl` 就能聚合。
  // 开销 = 一次 appendFileSync（几百字节），不在热路径上（每个动作一次）。
  //
  // T197：加上限（4 MB × 1，与其它审计 JSONL 同口径）。以前这里是纯 appendFileSync，
  // 于是它是 logs/ 下唯一"只写不回收"的文件 —— 真机实测 98 行 / 70,435 B，仓库树 5 行 /
  // 3,785 B，约 720 B/动作，永不回收。轮转只改名（`.1`），**不删**任何数据。
  appendTimingAudit(record) {
    const line = `${JSON.stringify(record)}\n`;
    try {
      fs.mkdirSync(this.logsRoot, { recursive: true });
      let currentBytes = 0;
      try { currentBytes = fs.statSync(this.timingsLogPath).size; } catch { /* 首次写 */ }
      if (currentBytes > 0 && currentBytes + Buffer.byteLength(line, 'utf8') > TIMINGS_LOG_MAX_BYTES) {
        // 与 app/diagnostic-log.js 同序：先清掉更旧的备份，再把当前文件挪成 `.1`。
        // 挪不动（被占用）时保持追加 —— 宁可暂时超上限，也不丢这一行。
        try { fs.rmSync(`${this.timingsLogPath}.1`, { force: true }) } catch { /* 没有更旧的备份 */ }
        try { fs.renameSync(this.timingsLogPath, `${this.timingsLogPath}.1`) } catch { /* 挪不动就继续追加 */ }
      }
      fs.appendFileSync(this.timingsLogPath, line, 'utf8');
    } catch { /* 审计失败绝不能影响动作本身 */ }
    if (this.timingSink) {
      try { this.timingSink(record) } catch { /* 注入的出口同样不许影响动作 */ }
    }
    return record;
  }

  // ── 作业目录内的"常驻工作副本"（T183 第 2 项）────────────────────────────
  // 现场实测（1.0.3 审计）：jobs 目录 100 个作业 = 570 MB，其中整份 `.project` 副本
  // 428 MB —— 每次动作都重新拷一份，而绝大多数时候源文件一个字节都没变。
  //
  // CODESYS 的应用级工程锁决定"必须有一份不归 GUI 所有的副本"（第二个 --noUI 进程
  // 打不开 GUI 正持有的 .project），但**不要求每次动作都新建一份**。所以：
  //   · 每个作业一份固定名字的工作副本 `snapshots/working.project`；
  //   · 只有当"源文件 sha 变了 / 副本丢了 / 上次动作失败留下脏副本"时才重新拷；
  //   · 成功提交之后副本内容 == 源内容，于是**下一次写入拷贝 0 字节**。
  //
  // 为什么不硬链接/写时复制（任务里提的备选）：本引擎的写回是
  // `copyFileSync(staged → source)`，它在 Windows 上是**原地截断覆盖**目标文件。
  // 如果 staged/snapshot 与 source 是同一份数据的硬链接，这次写会同时改掉"快照"，
  // 而快照正是失败回滚与外部改动检测的凭据 —— 那等于把安全网拆了。所以副本必须是
  // 独立的字节拷贝，优化只能落在"少拷几次"上。
  workProjectPathFor(jobId) {
    return path.join(this.jobPath(jobId), 'snapshots', 'working.project');
  }

  ensureWorkProject(job, metadataPath, options = {}) {
    const trace = options.trace || null;
    const target = this.workProjectPathFor(job.jobId);
    const sourceSha = String(options.sourceSha256 || '') || this.sha256Validated(job.projectPath, trace);
    const mirrors = Boolean(job.workProjectPath)
      && path.resolve(job.workProjectPath) === path.resolve(target)
      && job.workProjectSha256 === sourceSha
      && job.workProjectDirty !== true
      && fs.existsSync(target);
    if (mirrors) {
      if (trace) trace.count('workCopyReused', 1);
      return { path: target, copied: false, bytes: 0 };
    }
    const startedAt = trace ? trace.begin() : null;
    const bytes = copyProject(job.projectPath, target, trace);
    if (trace) trace.end('readProjectMs', startedAt);
    job.workProjectPath = target;
    job.workProjectSha256 = sourceSha;
    job.workProjectDirty = false;
    this.invalidateShaCache(target);
    try { this.writeJob(metadataPath, job) } catch { /* 元数据稍后还会整体写一次 */ }
    return { path: target, copied: true, bytes };
  }

  // 写前恢复快照（T183 第 2 项）。
  // 安全语义**一字不改**：MUTATING 动作前一定存在一份"写前内容"的副本，回滚可以拿它恢复。
  // 变的是"这份副本怎么来"，按代价从低到高：
  //   ① 内容寻址复用：作业里已经有一份 sha 完全相同的快照（最常见的是 000-baseline）
  //      ⇒ 0 字节、0 哈希。注意**不新建 entry**，直接把那份既有快照作为本次写前快照返回：
  //      新建一个指向同一文件的 entry 会让 T169 的保留策略按 id 去删那个共享文件 —— 那会
  //      把别的 entry 的凭据删掉。
  //   ② 常驻工作副本改名：它此刻与源内容逐字节相同（sha 已核对），rename 是元数据操作
  //      ⇒ 0 字节。改完由调用方重建工作副本。
  //   ③ 兜底：老老实实拷一份。
  snapshot(jobDir, metadataPath, job, reason, options = {}) {
    const trace = options.trace || null;
    const sourceSha = String(options.sourceSha256 || '') || sha256(job.projectPath, trace);
    const snapshots = Array.isArray(job.snapshots) ? job.snapshots : [];
    const existing = snapshots.find((entry) => entry
      && String(entry.sha256 || '') === sourceSha
      && entry.path
      && fs.existsSync(entry.path));
    if (existing) {
      if (trace) trace.count('snapshotReused', 1);
      return Object.assign({}, existing, { reused: true, consumedWorkCopy: false });
    }
    const existingPaths = new Set(snapshots.map((entry) => path.resolve(String(entry.path || ''))));
    const reusableWorkPath = String(options.reusableWorkPath || '');
    // 常驻 worker 可能正把这份工作副本打开着。rename 一个仍被 CODESYS 持有的文件在
    // Windows 上要么失败、要么更糟（句柄跟着改名走，CODESYS 下一次 save 会写进快照）。
    // 所以只要它被持有，就**不走改名这条路**，老实拷一份：安全的兜底本来就是它，
    // 而"复用已打开的工程"省下的 9–20 秒 openMs 远比这 1.3 MB 拷贝值钱。
    const heldPath = path.resolve(String(options.holdPath || ''));
    const reusableIsHeld = Boolean(options.holdPath) && heldPath === path.resolve(reusableWorkPath);
    if (reusableWorkPath && !reusableIsHeld && fs.existsSync(reusableWorkPath) && !existingPaths.has(path.resolve(reusableWorkPath))) {
      const id = `${String(snapshots.length).padStart(3, '0')}-${Date.now()}`;
      const target = path.join(jobDir, 'snapshots', `${id}.project`);
      try {
        fs.renameSync(reusableWorkPath, target);
        try { fs.chmodSync(target, 0o600) } catch { /* best effort */ }
        if (trace) trace.count('snapshotRenamed', 1);
        const value = { id, path: target, sha256: sourceSha, reason, createdAt: new Date().toISOString(), renamedFromWorkCopy: true };
        snapshots.push(value);
        job.snapshots = snapshots;
        job.workProjectPath = '';
        job.workProjectSha256 = '';
        job.workProjectDirty = false;
        this.invalidateShaCache(target);
        return Object.assign({}, value, { reused: false, consumedWorkCopy: true });
      } catch { /* 跨卷 / 被占用 → 落到拷贝 */ }
    }
    const startedAt = trace ? trace.begin() : null;
    const id = `${String(snapshots.length).padStart(3, '0')}-${Date.now()}`;
    const target = path.join(jobDir, 'snapshots', `${id}.project`);
    const bytes = copyProject(job.projectPath, target, trace);
    if (trace) trace.end('recoverySnapshotMs', startedAt);
    if (trace) trace.bytes('snapshotCopyBytes', bytes);
    const value = { id, path: target, sha256: sourceSha, reason, createdAt: new Date().toISOString() };
    snapshots.push(value);
    job.snapshots = snapshots;
    this.invalidateShaCache(target);
    return Object.assign({}, value, { reused: false, consumedWorkCopy: false });
  }

  policy() {
    return {
      mode: 'offline-allowlist',
      allowedActions: [...ALLOWED_ACTIONS],
      onlineActions: [...ONLINE_ACTIONS],
      onlineActionCapabilities: { ...ONLINE_ACTION_CAPABILITY },
      plcOnlineCapabilities: [...PLC_ONLINE_CAPABILITIES],
      unsupportedOnlineCapabilities: [...UNSUPPORTED_ONLINE_CAPABILITIES],
      // 这 9 项都只能通过工作台、在显式授权下到达；3 项无 API。
      onlineAuthorizationRequired: true,
      onlineHardGateRequired: ['write-variable', 'reset', 'force'],
      onlineSessionModel: 'persistent-worker-process',
      plcLogin: 'authorized-only',
      plcLogout: 'authorized-only',
      plcDownload: 'authorized-only',
      plcOnlineChange: 'authorized-only',
      plcStartStopReset: 'authorized-only',
      variableWrite: 'authorized-with-confirmation-phrase',
      force: 'authorized-with-confirmation-phrase',
      debugBreakpointStep: 'unsupported-by-this-scriptengine-version',
      arbitraryScript: false,
      sourceProjectWrite: 'confirmed-with-recovery-snapshot',
      isolatedProjectCopyRequired: false,
      recoverySnapshotRequired: true,
    };
  }

  doctor({ persist = false } = {}) {
    if (this.doctorCache && Date.now() - this.doctorCache.at < 30000) {
      const cached = { ...this.doctorCache.value, cached: true };
      if (persist) this.persistEvidence('codesys-scriptengine-doctor.json', cached);
      return cached;
    }
    const exePath = this.exePath && fs.existsSync(this.exePath) ? this.exePath : candidateInstallations()[0] || null;
    const version = versionFromExe(exePath);
    const codesysRoot = exePath ? path.resolve(path.dirname(exePath), '..') : null;
    const commonRoot = exePath ? path.dirname(exePath) : null;
    const pluginsRoot = codesysRoot ? path.join(codesysRoot, 'PlugIns') : null;
    const lacRoot = codesysRoot ? path.join(codesysRoot, 'LacBinaries', 'GAC_MSIL') : null;
    const scriptEngineDll = commonRoot && fs.existsSync(path.join(commonRoot, 'ScriptEngine.dll')) ? path.join(commonRoot, 'ScriptEngine.dll') : null;
    const scriptEnginePlugin = boundedFind(pluginsRoot, 'ScriptEngine.plugin.dll');
    const ironPythonDll = boundedFind(lacRoot && path.join(lacRoot, 'IronPython'), 'IronPython.dll');
    const profile = this.profile || profileFromVersion(version);
    const missing = [];
    if (!exePath) missing.push({ id: 'codesys-exe', label: 'CODESYS.exe' });
    if (!scriptEngineDll) missing.push({ id: 'scriptengine-core', label: 'ScriptEngine.dll' });
    if (!scriptEnginePlugin) missing.push({ id: 'scriptengine-plugin', label: 'ScriptEngine.plugin.dll' });
    if (!ironPythonDll) missing.push({ id: 'ironpython', label: 'IronPython.dll' });
    if (!profile) missing.push({ id: 'profile', label: '兼容的 CODESYS profile' });
    const result = {
      installed: Boolean(exePath && scriptEngineDll && scriptEnginePlugin && ironPythonDll && profile),
      ready: Boolean(exePath && scriptEngineDll && scriptEnginePlugin && ironPythonDll && profile),
      state: exePath ? (scriptEngineDll && scriptEnginePlugin && ironPythonDll ? 'ready' : 'incomplete') : 'not-installed',
      exePath: exePath || '',
      version: version || '',
      profile: profile || '',
      scriptEngineDll: scriptEngineDll || '',
      scriptEnginePlugin: scriptEnginePlugin || '',
      ironPythonDll: ironPythonDll || '',
      missing,
      configuration: {
        automaticInstallAvailable: false,
        mode: missing.length ? 'official-installer-or-component-manager' : 'ready',
        reason: missing.length ? 'TaskHive 不静默下载或替换 CODESYS；仅打开经过签名验证的本机官方安装器，或引导到官方组件管理器。' : '',
      },
      policy: this.policy(),
      checkedAt: new Date().toISOString(),
    };
    this.doctorCache = { at: Date.now(), value: result };
    if (persist) this.persistEvidence('codesys-scriptengine-doctor.json', result);
    return result;
  }

  async execute(action, input = {}, exec = {}) {
    const normalized = String(action || '').trim().toLowerCase();
    // Online actions are not part of the offline allowlist: they never touch the
    // project file and are governed by their own authorization contract.
    if (ONLINE_ACTIONS.includes(normalized)) return this.runOnlineAction(normalized, input, exec);
    if (!ALLOWED_ACTIONS.includes(normalized)) {
      const error = new Error(`CODESYS ScriptEngine 动作不在离线白名单：${normalized || '(empty)'}`);
      error.code = 'CODESYS_SCRIPTENGINE_ACTION_DENIED';
      throw error;
    }
    // 在线冻结：已登录到应用时，写类动作在这里就被拒绝（界面按钮、抽屉、探针都走这条路）。
    await this.assertOnlineWriteAllowed(normalized);
    if (normalized === 'doctor') return this.doctor({ persist: input.persist !== false });
    if (normalized === 'probe') return this.probe({ timeoutMs: input.timeoutMs, signal: exec.signal });
    if (normalized === 'capabilities') return this.capabilities({ persist: input.persist !== false });
    if (normalized === 'stage-project') return this.stageProject(input);
    if (normalized === 'bind-project') return this.bindProject(input);
    if (normalized === 'diff') return this.diff(input);
    if (normalized === 'rollback') return this.rollback(input);
    if (normalized === 'build-status') return this.readDeferredBuild(input);
    return this.runOfflineAction(normalized, input, exec);
  }

  onlineState() {
    const session = this.onlineSession;
    return {
      running: Boolean(session && session.running),
      jobId: this.onlineSessionJobId,
      ready: session ? session.ready : null,
      lastError: session ? session.lastError : '',
      pid: session ? (session.child?.pid || 0) : 0,
    };
  }

  // ── 在线冻结（本轮 B 项）：写类动作在"应用已登录"时的引擎侧判定 ─────────────
  // 这里**只读**（status 不改控制器），而且只在"确实有一个常驻在线会话"时才去问它：
  //   · 没有在线会话 = 根本没登录 ⇒ 立即返回未冻结，**一次 IPC 都不产生**（未登录时
  //     的语义因此与冻结前逐字相同：既有 sha 三态守卫、写前快照、原子提交、per-job
  //     互斥、用户点击全部照旧）；
  //   · 有会话 ⇒ 问一次 worker 的 status，以 `isLoggedIn` 为准；
  //   · 读失败/读不到这个字段 ⇒ 保持上一次观测（`onlineLoggedInObserved`），绝不把
  //     "读不到"当成"没登录" —— 否则一次超时就是绕过冻结的窗口。
  async onlineWriteFreeze() {
    if (!this.onlineSession || !this.onlineSession.running) {
      this.onlineLoggedInObserved = null;
      return { running: false, loggedIn: false, frozen: false };
    }
    let loggedIn = this.onlineLoggedInObserved === true;
    try {
      const status = await this.onlineStatus();
      const state = status?.state;
      if (status?.ok === true && state && typeof state.isLoggedIn === 'boolean') {
        loggedIn = state.isLoggedIn === true;
        this.onlineLoggedInObserved = loggedIn;
      }
    } catch {
      // 保持上一次观测：status 是只读查询，它失败不该改变"冻结"这个已经看到的事实。
    }
    return { running: true, loggedIn, frozen: loggedIn };
  }

  // 写类动作的统一闸门。非写类动作（inspect / diff / build / build-status / 在线动作…）
  // 一步都不多走，直接放行 —— 特别是 build/rebuild：它们只编译隔离副本，不覆盖源工程。
  async assertOnlineWriteAllowed(action = '') {
    const normalized = String(action || '').trim().toLowerCase();
    if (!ONLINE_WRITE_FROZEN_ACTIONS.has(normalized)) return { frozen: false, checked: false };
    const freeze = await this.onlineWriteFreeze();
    if (!freeze.frozen) return { ...freeze, checked: true };
    throw Object.assign(
      new Error(ONLINE_WRITE_FROZEN_MESSAGE.replace('{action}', normalized)),
      {
        code: ONLINE_WRITE_FROZEN_CODE,
        details: { action: normalized, onlineWriteFrozen: true, loggedIn: true, running: freeze.running },
      },
    );
  }

  async stopOnlineSession(reason = 'manual') {
    // 即使此刻没有会话，也要推进代数：一个正在启动中的会话必须看到"有人要求停止过"。
    this.onlineSessionGeneration += 1;
    // 会话没了 ⇒ "已登录"这个观测作废：下一次写请求回到"未登录"的既有语义。
    this.onlineLoggedInObserved = null;
    if (!this.onlineSession) {
      const pending = this.onlineSessionPending;
      this.onlineSessionPending = null;
      this.onlineSessionPendingJobId = '';
      return { stopped: false, reason, pending: Boolean(pending) };
    }
    const session = this.onlineSession;
    this.onlineSession = null;
    this.onlineSessionJobId = '';
    try {
      return await session.stop(reason);
    } catch (error) {
      return { stopped: false, reason, error: String(error?.message || error) };
    }
  }

  // Read-only online status. It asks the worker for its connection state, which
  // is safe to call without an authorization: nothing on the controller changes.
  async onlineStatus() {
    if (!this.onlineSession || !this.onlineSession.running) {
      return { ok: true, running: false, ...this.onlineState() };
    }
    try {
      const value = await this.onlineSession.send('status', {}, 20000);
      return { ok: true, running: true, ...this.onlineState(), state: value };
    } catch (error) {
      return { ok: false, running: false, ...this.onlineState(), error: String(error?.message || error) };
    }
  }

  // CODESYS' own "scan network". It asks the gateway to discover controllers on
  // the network; no controller is contacted and nothing is changed. A live scan
  // can take a while, the cached variant returns instantly.
  async onlineScanDevices(input = {}) {
    if (!this.onlineSession || !this.onlineSession.running) {
      return { ok: false, running: false, reason: 'session-not-running' };
    }
    const value = await this.onlineSession.send('scan', { useCache: input.useCache === true }, input.useCache === true ? 30000 : 180000);
    return { ok: true, running: true, ...value };
  }

  // Retarget THIS session. The worker holds a throwaway copy of the project and
  // never saves it, so this changes where a login goes WITHOUT editing the
  // operator's .project file.
  async onlineSetTarget(input = {}) {
    // 绑定过的目标要跟着**作业**走，而不是只活在这一次的在线进程里：否则进程空闲
    // 10 分钟退出后，"已绑定"就凭空消失，用户会以为绑定没生效。写的是作业元数据
    // （job.json），**不是** .project —— 工程文件仍然一个字节都不动（worker 侧照旧
    // 报 saved:false）。
    const override = {
      gatewayName: String(input.gatewayName || '').trim(),
      gatewayGuid: String(input.gatewayGuid || '').trim(),
      address: String(input.address || '').trim(),
      ipAddress: String(input.ipAddress || '').trim(),
      port: Number(input.port) || 0,
      source: String(input.source || 'scan').trim() || 'scan',
      boundAt: new Date().toISOString(),
    };
    const jobId = String(input.jobId || '').trim();
    let persisted = false;
    if (jobId) {
      try {
        // 读-改-写放到按 job 的锁里：否则同时来的两个动作各读一份旧 job、各自写回，
        // 后写的会把前一个的改动（例如 actions/snapshots）整段覆盖掉。
        await this.updateJob(jobId, (current) => { current.onlineTargetOverride = override; });
        persisted = true;
      } catch {
        // 作业元数据写不进去时仍然尝试应用到当前会话：绑定本身不该因此失败。
      }
    }
    if (!this.onlineSession || !this.onlineSession.running) {
      // 会话没在跑：绑定先记下来，等它起来时自动应用（见 openOnlineSession）。
      return { ok: true, running: false, appliedNow: false, deferred: true, persisted, boundTarget: override };
    }
    const value = await this.onlineSession.send('set-target', {
      gatewayName: override.gatewayName,
      gatewayGuid: override.gatewayGuid,
      address: override.address,
      // ip 模式：走 set_gateway_and_ip_address（没有 getter，设完读不回来）
      ipAddress: override.ipAddress,
      port: override.port,
    }, 60000);
    if (this.onlineSession.ready) {
      this.onlineSession.ready.targetSource = override.source;
      this.onlineSession.ready.boundTarget = override;
    }
    // 注意展开顺序：worker 自己也会回一个 `applied`（是 'name'/'address'/'ip' 这种
    // 字符串，审计要用），所以"这次真的应用了"另起一个字段，别把它盖掉。
    return { ...value, ok: true, running: true, appliedNow: true, deferred: false, persisted, boundTarget: override };
  }

  // Start the online worker WITHOUT connecting to anything. This is what lets the
  // operator see the configured target (gateway / address / device identification)
  // before any login: the worker only opens a copy of the project and reads it.
  async prepareOnlineSession(jobId, timeoutMs) {
    const { job } = this.readJob(jobId);
    const ensured = await this.ensureOnlineSession(job, timeoutMs);
    return { ok: true, reused: ensured.reused === true, running: true, ready: ensured.ready };
  }

  // 唯一的"确保在线会话存在"入口。存在的理由是现场报错：
  //   EBUSY: resource busy or locked, open '...\online\online-worker.py'
  // 一次启动要 20–40 秒，而"绑定工程后读目标"的后台准备、扫描按钮、登录按钮都会
  // 走到这里。此前 this.onlineSession 是在 start() **完成之后**才赋值的，于是这段
  // 窗口里第二次调用会认为"没有会话"，再起一个 CODESYS 去写同一个目录 —— 第二个
  // 写 online-worker.py 时，第一个 CODESYS 已经把它打开，Windows 直接 EBUSY。
  // 现在：同一个 job 的启动在途时，后来者等同一个 promise，绝不重复启动。
  async ensureOnlineSession(job, timeoutMs) {
    if (this.onlineSession && this.onlineSession.running && this.onlineSessionJobId === job.jobId) {
      return { session: this.onlineSession, ready: this.onlineSession.ready, reused: true };
    }
    if (this.onlineSessionPending && this.onlineSessionPendingJobId === job.jobId) {
      const opened = await this.onlineSessionPending;
      return { ...opened, reused: true };
    }
    // 先占坑、再 await：stopOnlineSession 也是异步的，若先 await 再占坑，三个并发
    // 调用会一起穿过上面的检查、各自启动一个 worker —— 那正是 EBUSY 的成因。
    const pending = (async () => {
      await this.stopOnlineSession('rebind');
      return this.openOnlineSession(job, timeoutMs);
    })();
    this.onlineSessionPending = pending;
    this.onlineSessionPendingJobId = job.jobId;
    const clear = () => {
      if (this.onlineSessionPending === pending) {
        this.onlineSessionPending = null;
        this.onlineSessionPendingJobId = '';
      }
    };
    pending.then(clear, clear);
    return pending;
  }

  // Read online values from the session that a login (Keep) or a download established.
  // Reading is not a mutating action, so it is not gated behind a new capability;
  // the worker itself refuses unless the application is actually logged in.
  // `scope` is the selected object's name: a PROGRAM's locals are only reachable as
  // "POU.var" in the application scope, while a GVL's globals work bare. The worker
  // tries both and remembers which one worked.
  async onlineMonitor(expressions, scope = '') {
    if (!this.onlineSession || !this.onlineSession.running) {
      return { ok: false, running: false, reason: 'session-not-running', ...this.onlineState() };
    }
    const list = Array.isArray(expressions)
      ? [...new Set(expressions.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 120)
      : [];
    if (!list.length) return { ok: true, running: true, isLoggedIn: false, expressions: [], values: [] };
    try {
      const value = await this.onlineSession.send('monitor', { expressions: list, scope: String(scope || '') }, 20000);
      return { ok: true, running: true, ...value };
    } catch (error) {
      return {
        ok: false,
        running: this.onlineSession.running,
        code: error?.code || '',
        error: String(error?.message || error),
      };
    }
  }

  async openOnlineSession(job, timeoutMs) {
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) {
      throw Object.assign(new Error('CODESYS ScriptEngine 未就绪'), { code: 'CODESYS_SCRIPTENGINE_NOT_READY', details: doctor });
    }
    const jobDir = this.jobPath(job.jobId);
    // The online worker keeps its project open for the whole session, so it must
    // NOT share the inspect snapshot path: a later 刷新 (inspect-project) would
    // overwrite the file CODESYS currently holds open, which fails on Windows and
    // would break the live session.
    // 运行令牌同时进文件名：CODESYS 会一直持有它打开的 .project 与脚本，固定名字会让
    // "上一个进程还没退干净、下一个就启动"在 Windows 上直接 EBUSY（现场报错就是这个）。
    const runToken = crypto.randomBytes(6).toString('hex');
    const snapshotsDir = path.join(jobDir, 'snapshots');
    const workProject = path.join(snapshotsDir, `online-session-${runToken}.project`);
    // 上一轮留下的工程副本已经没有主人了（每个名字都带令牌），清掉免得越积越多；
    // 还被旧进程占用的删不掉，忽略即可。
    try {
      for (const name of fs.readdirSync(snapshotsDir)) {
        if (!/^online-session(-[0-9a-f]+)?\.project$/.test(name)) continue;
        try { fs.unlinkSync(path.join(snapshotsDir, name)); } catch { /* still held by an exiting worker */ }
      }
    } catch { /* no snapshot dir yet */ }
    refreshInspectionSnapshot(job.projectPath, workProject);
    job.onlineProjectPath = workProject;
    // 走锁 + 原子写：这份元数据可能和同一作业上的其他动作并发更新。
    await this.updateJob(job.jobId, (current) => { current.onlineProjectPath = workProject; });
    const workDir = path.join(jobDir, 'online');
    const session = new CodesysOnlineSession({
      exePath: doctor.exePath,
      profile: doctor.profile,
      ...(this.spawnProcess ? { spawnProcess: this.spawnProcess } : {}),
      log: this.onlineLog,
    });
    const generation = this.onlineSessionGeneration;
    const ready = await session.start({ workDir, projectPath: workProject, timeoutMs, runToken });
    // 启动期间有人要求停止（例如操作者点了「释放在线会话」）：不要把这个刚起来的
    // 会话挂上去 —— 否则它会带着一个 PLC 连接继续活着，谁也找不到它。
    if (generation !== this.onlineSessionGeneration) {
      try { await session.stop('superseded-start'); } catch { /* best effort */ }
      throw Object.assign(new Error('在线会话在启动期间被要求停止，已放弃这次启动。'), { code: 'CODESYS_ONLINE_START_SUPERSEDED' });
    }
    this.onlineSession = session;
    this.onlineSessionJobId = job.jobId;
    // 把"上次绑定过的目标"重新应用到新进程：只改这份工程副本的内存值，绝不写
    // .project。这样一来，在线进程空闲退出、或换了一个新进程之后，界面上的
    // 「已绑定」仍然是真的，而不是只活了一次会话。
    const bound = job.onlineTargetOverride;
    if (bound && (bound.address || bound.ipAddress)) {
      try {
        const applied = await session.send('set-target', {
          gatewayName: String(bound.gatewayName || ''),
          gatewayGuid: String(bound.gatewayGuid || ''),
          address: String(bound.address || ''),
          ipAddress: String(bound.ipAddress || ''),
          port: Number(bound.port) || 0,
        }, 60000);
        ready.boundTarget = { ...bound, appliedAt: new Date().toISOString() };
        ready.targetSource = String(bound.source || 'scan');
        ready.target = applied?.target || ready.target;
      } catch (error) {
        // 应用失败要如实报出来（例如设备/网关已不在），否则界面会显示"已绑定"
        // 而登录其实会去别的地方。
        ready.boundTargetError = String(error?.message || error);
      }
    }
    return { session, ready, workProject, workDir };
  }

  async runOnlineAction(action, input = {}, exec = {}) {
    const capability = ONLINE_ACTION_CAPABILITY[action];
    // Defense in depth: main.js performs the real authorization checks, but the
    // engine still refuses to move unless the caller declares the authorization
    // it was granted, so a stray IPC call cannot drive a controller.
    if (input.onlineAuthorization !== true) {
      throw Object.assign(new Error('在线动作缺少授权标记：请先在工作台开启在线授权'), { code: 'CODESYS_ONLINE_NOT_ARMED' });
    }
    const actionStartedAt = Date.now();
    const timings = {};
    const { job } = this.readJob(input.jobId);
    timings.jobRead = Date.now() - actionStartedAt;

    // 绑定是登录 / 下载 / 在线修改的前置条件：没有绑定过设备时，绝不去连"工程文件里
    // 碰巧配着的那台"（用户口径：「我都没有绑定设备 为什么可以登录？明显不合理」）。
    // 界面已经把这几个按钮禁用了，这里是第二道锁：绕过界面直接发 IPC 也一样拒绝。
    const REQUIRES_BOUND_TARGET = ['online-login', 'online-download', 'online-change'];
    if (REQUIRES_BOUND_TARGET.includes(action) && !job.onlineTargetOverride) {
      throw Object.assign(
        new Error('尚未绑定设备：请先在工作台点「扫描设备」选中一台 PLC（或手动填写目标并应用），再登录/下载。工程文件里配置的目标不作为登录依据。'),
        { code: 'CODESYS_ONLINE_TARGET_NOT_BOUND', details: { action } },
      );
    }

    if (action === 'online-download') {
      // Authoritative "the file is still what we last knew" check. The job stores
      // the sha it last observed; a CODESYS save that happened after that point
      // would otherwise let older content (already read into the workbench) be
      // downloaded over newer code.
      const currentSha = sha256(job.projectPath);
      if (job.currentSha256 && currentSha !== job.currentSha256) {
        throw Object.assign(
          new Error('工程文件在本次读取之后被改动过（可能刚在 CODESYS 中保存）。已拒绝下载，请先在 CODESYS 中确认，再点工作台「刷新」重新读取工程。'),
          { code: 'CODESYS_ONLINE_PROJECT_CHANGED', details: { expectedSha256: job.currentSha256, actualSha256: currentSha } },
        );
      }
    }

    let session = this.onlineSession;
    const reused = Boolean(session && session.running && this.onlineSessionJobId === job.jobId);
    if (!reused) {
      const phaseStartedAt = Date.now();
      const opened = await this.ensureOnlineSession(job, input.timeoutMs);
      session = opened.session;
      timings.sessionStart = Date.now() - phaseStartedAt;
    } else {
      timings.sessionStart = 0;
    }

    const command = ONLINE_ACTION_COMMAND[action] || 'status';
    const commandArgs = { capability };
    if (action === 'online-write' || action === 'online-force') {
      commandArgs.assignments = Array.isArray(input.assignments) ? input.assignments.slice(0, 60) : [];
    }
    if (action === 'online-reset') {
      commandArgs.resetOption = String(input.resetOption || 'warm');
      commandArgs.forceKill = input.forceKill === true;
    }
    const defaultTimeout = (command === 'download' || command === 'online-change') ? 300000 : 120000;
    const commandStartedAt = Date.now();
    const value = await session.send(command, commandArgs, Number(input.timeoutMs) || defaultTimeout);
    timings.onlineCommand = Date.now() - commandStartedAt;

    if (command === 'logout') {
      // An explicit logout ends the session: the persistent process exists only
      // to hold the connection, and leaving it alive would keep a half-open
      // worker attached to the controller with nothing to do.
      await this.stopOnlineSession('logout');
    }

    const evidence = {
      ok: true,
      status: 'verified-online',
      action,
      capability,
      command,
      jobId: job.jobId,
      mode: job.mode || 'isolated-copy',
      sourcePath: job.sourcePath || '',
      projectPath: job.projectPath,
      sessionProjectPath: job.onlineProjectPath || '',
      durationMs: Date.now() - actionStartedAt,
      payload: value,
      target: session.ready || null,
      sessionReused: reused,
      policy: this.policy(),
      timings: { ...timings, total: Date.now() - actionStartedAt },
      completedAt: new Date().toISOString(),
    };
    this.persistEvidence('codesys-scriptengine-online.json', evidence);
    return evidence;
  }

  capabilities({ persist = true } = {}) {
    const doctor = this.doctor({ persist: false });
    const result = {
      ok: doctor.ready,
      source: 'local-official-scriptengine-help',
      codesysVersion: doctor.version,
      scriptEngine: doctor.scriptEngineDll,
      open: {
        projectLifecycle: ['create-project', 'stage-project', 'bind-project', 'inspect-project', 'diff', 'rollback'],
        iecObjects: ['create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes'],
        interchange: ['export-xml', 'import-xml'],
        compilation: ['build', 'rebuild'],
        inspection: ['project-tree', 'textual-declaration', 'textual-implementation', 'library-references', 'device-objects'],
      },
      restrictions: { sourceWriteMode: 'confirmed-with-recovery-snapshot', arbitraryScript: false, onlineActions: [...ONLINE_ACTIONS], onlineAuthorizationRequired: true, onlineHardGateRequired: ['write-variable', 'reset', 'force'], unsupportedOnlineCapabilities: [...UNSUPPORTED_ONLINE_CAPABILITIES] },
      verifiedApis: ['projects.create', 'projects.open', 'get_children', 'find', 'create_pou', 'create_gvl', 'create_dut', 'textual_declaration.replace', 'textual_implementation.replace', 'export_xml', 'import_xml', 'build', 'rebuild'],
      checkedAt: new Date().toISOString(),
    };
    if (persist) this.persistEvidence('codesys-scriptengine-capabilities.json', result);
    return result;
  }

  newJobId(prefix = 'offline') { return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }

  jobPath(jobId) {
    const value = String(jobId || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{5,100}$/i.test(value)) throw Object.assign(new Error('ScriptEngine 作业 ID 无效'), { code: 'CODESYS_SCRIPTENGINE_JOB_INVALID' });
    const target = path.join(this.jobsRoot, value);
    if (!inside(this.jobsRoot, target)) throw Object.assign(new Error('ScriptEngine 作业越界'), { code: 'CODESYS_SCRIPTENGINE_JOB_OUTSIDE_ROOT' });
    return target;
  }

  readJob(jobId) {
    const jobDir = this.jobPath(jobId);
    const metadataPath = path.join(jobDir, 'job.json');
    if (!fs.existsSync(metadataPath)) throw Object.assign(new Error('ScriptEngine 隔离作业不存在'), { code: 'CODESYS_SCRIPTENGINE_JOB_NOT_FOUND' });
    const job = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const directSource = ['direct-source', 'active-gui-saved-source'].includes(job.mode) && path.resolve(job.projectPath) === path.resolve(job.sourcePath || '');
    if ((!directSource && !inside(jobDir, job.projectPath)) || !fs.existsSync(job.projectPath)) throw Object.assign(new Error('绑定的工程文件不存在'), { code: 'CODESYS_SCRIPTENGINE_PROJECT_MISSING' });
    return { jobDir, metadataPath, job };
  }

  writeJob(metadataPath, job) { writeJsonAtomic(metadataPath, job); }

  // 按 job 的异步互斥。**不可对同一 jobId 嵌套调用**（会自锁）；需要"在已持锁的
  // 临界区里再改一次元数据"时用 updateJob(jobId, fn, { locked: true })。
  async withJobLock(jobId, task) {
    const key = String(jobId || '').trim();
    if (!key || typeof task !== 'function') return task ? task() : undefined;
    const previous = this.jobLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.jobLocks.set(key, tail);
    await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (this.jobLocks.get(key) === tail) this.jobLocks.delete(key);
    }
  }

  // 读-改-写必须在锁里做完，否则两个动作读到的都是同一份旧 job，后写的赢。
  // 元数据路径由 jobPath(jobId) 推出（readJob 的返回形状由调用方可替换，不作为依据）。
  async updateJob(jobId, mutator, { locked = false } = {}) {
    const run = async () => {
      const { job } = this.readJob(jobId);
      const metadataPath = path.join(this.jobPath(jobId), 'job.json');
      const next = await mutator(job, { metadataPath });
      this.writeJob(metadataPath, next || job);
      return next || job;
    };
    if (locked) return run();
    return this.withJobLock(jobId, run);
  }

  // ── 作业目录保留与清理 ─────────────────────────────────────────────────────
  // 审计实测（C:\Users\29925\Documents\TaskHive1.0.3）：100 个作业 = 570.11 MB，其中
  //   snapshots/ 488.26 MB（写前 `before-*` 快照 + 在线会话副本；`before-*` 只写不读，
  //     回滚只用 `000-baseline`）、
  //   staged/ 51.63 MB（每次直写都留一份 .project 副本，提交后就没有主人了）、
  //   `.bootinfo` 59.26 MB + `.compileinfo` 59.26 MB（CODESYS 每次编译重写）。
  // 策略（参数见 cleanupJobArtifacts 的默认值，理由写在每一处）：
  //   * 只在一个作业目录**内部**按**已知文件名**删，绝不递归通配删除；
  //   * `000-baseline.project` 永不删（它是回滚基线）；
  //   * `before-*` 只保留最新 keepBeforeSnapshots 个，被删的在 job.json 里标 pruned；
  //   * staged 只保留最新 keepStaged 个，且只删"已经不再可能被提交"的（超过 minAge）；
  //   * 在线会话副本只保留 job.onlineProjectPath 指着的那个；
  //   * 中间产物后缀只有 CODESYS_SIDECAR_RE 那几种；
  //   * job.json mtime 在 liveWindowMs（默认 15 分钟）内的作业整目录跳过 —— 正在运行的
  //     作业绝不被清。
  // 幂等：再跑一次 freedBytes 必须是 0。
  cleanupJobArtifacts(jobId, options = {}) {
    const {
      dryRun = false,
      keepBeforeSnapshots = 2,
      keepStaged = 1,
      now = Date.now(),
      liveWindowMs = 15 * 60 * 1000,
      minArtifactAgeMs = 15 * 60 * 1000,
    } = options;
    let jobDir = '';
    try { jobDir = this.jobPath(jobId); } catch { return { jobId: String(jobId || ''), skipped: 'invalid-job-id', removed: [], freedBytes: 0 } }
    const metadataPath = path.join(jobDir, 'job.json');
    if (!fs.existsSync(metadataPath)) return { jobId, skipped: 'job-metadata-missing', removed: [], freedBytes: 0 };
    let job = null; let jobAt = 0;
    try { job = JSON.parse(fs.readFileSync(metadataPath, 'utf8')); jobAt = fs.statSync(metadataPath).mtimeMs; } catch { return { jobId, skipped: 'job-metadata-unreadable', removed: [], freedBytes: 0 } }
    if (now - jobAt < liveWindowMs) return { jobId, skipped: 'live', removed: [], freedBytes: 0, liveWindowMs };
    const removed = [];
    const kept = [];
    const planned = new Set();
    let jobChanged = false;
    const removeFile = (full, reason) => {
      if (!full || !inside(jobDir, full)) return false;                    // 越界一律不动
      // dry-run 只登记不删除，必须自己去重：同一个文件可能同时命中"中间产物"和"孤儿
      // 中间产物"两条规则，否则统计出来的释放量会翻倍。
      if (dryRun && planned.has(full)) return false;
      let size = 0;
      try { size = fs.statSync(full).size; } catch { if (dryRun) { planned.add(full); removed.push({ path: path.relative(jobDir, full), bytes: 0, reason }); return true; } return false }
      planned.add(full);
      if (!dryRun) {
        try { fs.unlinkSync(full); } catch { return false; }               // 被 CODESYS 占着就留着
      }
      removed.push({ path: path.relative(jobDir, full), bytes: size, reason });
      return true;
    };
    const removeWithSidecars = (projectPath, reason) => {
      if (!inside(jobDir, projectPath) || !/\.project$/i.test(projectPath)) return false;
      const removedProject = removeFile(projectPath, reason);
      for (const sidecar of sidecarsOf(projectPath)) removeFile(sidecar, 'codesys-intermediate');
      return removedProject;
    };

    // 1) 中间产物：CODESYS 每次编译都会重写，删了只会让下一次编译慢一点。
    for (const sub of ['', 'project', 'staged', 'snapshots']) {
      const directory = sub ? path.join(jobDir, sub) : jobDir;
      for (const entry of listFiles(directory)) {
        if (!CODESYS_SIDECAR_RE.test(entry.name)) continue;
        if (now - entry.at < minArtifactAgeMs) { kept.push({ path: path.relative(jobDir, entry.full), reason: 'recent-intermediate' }); continue; }
        removeFile(entry.full, 'codesys-intermediate');
      }
    }

    // 2) 写前快照：只保留最新 keepBeforeSnapshots 个，其余删除并在元数据里标 pruned，
    //    这样 rollback 到一个已被回收的快照时会明确报"已被保留策略回收"，而不是文件不存在。
    const snapshots = Array.isArray(job.snapshots) ? job.snapshots : [];
    const beforeSnapshots = snapshots
      .filter((item) => item && item.id !== '000-baseline' && String(item.reason || '').startsWith('before-'))
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    for (const entry of beforeSnapshots.slice(Math.max(0, keepBeforeSnapshots))) {
      if (entry.pruned === true) continue;                                  // 幂等
      // 先认作业目录**内部**的那一份（升级/搬运后 job.json 里的绝对路径可能指向老的
      // 安装目录；那种路径绝不跟随，越界删除是事故）。内部的没有才看 entry.path。
      const localTarget = path.join(jobDir, 'snapshots', `${entry.id}.project`);
      const candidate = fs.existsSync(localTarget)
        ? localTarget
        : (entry.path && inside(jobDir, entry.path) ? entry.path : localTarget);
      const removedFile = removeWithSidecars(candidate, 'before-snapshot');
      // 只有"真的删掉了"或者"已经不存在了"才标 pruned —— 否则回滚时会谎报已被回收。
      if (!removedFile && (fs.existsSync(candidate) || (entry.path && fs.existsSync(entry.path)))) {
        kept.push({ path: path.relative(jobDir, candidate), reason: 'before-snapshot-unreachable' });
        continue;
      }
      entry.pruned = true;
      entry.prunedAt = new Date(now).toISOString();
      entry.prunedReason = `retention:keep-latest-${keepBeforeSnapshots}-before-snapshots`;
      jobChanged = true;
    }
    for (const entry of beforeSnapshots.slice(0, Math.max(0, keepBeforeSnapshots))) {
      kept.push({ path: path.join('snapshots', `${entry.id}.project`), reason: 'newest-before-snapshot' });
    }

    // 3) 直写用的隔离副本：提交（commitProject）之后就没有主人了，只留最新 keepStaged 个。
    const stagedDir = path.join(jobDir, 'staged');
    const stagedProjects = listFiles(stagedDir)
      .filter((entry) => /\.project$/i.test(entry.name))
      .sort((left, right) => right.at - left.at);
    for (const entry of stagedProjects.slice(Math.max(0, keepStaged))) {
      if (now - entry.at < minArtifactAgeMs) { kept.push({ path: path.relative(jobDir, entry.full), reason: 'recent-staged-copy' }); continue; }
      removeWithSidecars(entry.full, 'stale-staged-copy');
    }
    for (const entry of listFiles(stagedDir)) {
      if (/\.project$/i.test(entry.name)) continue;
      if (!CODESYS_SIDECAR_RE.test(entry.name)) continue;                    // 只删已知中间产物
      if (now - entry.at < minArtifactAgeMs) continue;
      removeFile(entry.full, 'orphan-intermediate');
    }

    // 4) 在线会话的工程副本：每开一次会话就换一个令牌名，除了当前那个其余都没有主人。
    const snapshotsDir = path.join(jobDir, 'snapshots');
    const currentOnline = job.onlineProjectPath ? path.resolve(job.onlineProjectPath) : '';
    for (const entry of listFiles(snapshotsDir)) {
      if (!/^online-session(-[0-9a-f]+)?\.project$/i.test(entry.name)) continue;
      if (currentOnline && path.resolve(entry.full) === currentOnline) { kept.push({ path: path.relative(jobDir, entry.full), reason: 'current-online-session' }); continue; }
      if (now - entry.at < minArtifactAgeMs) { kept.push({ path: path.relative(jobDir, entry.full), reason: 'recent-online-session-copy' }); continue; }
      removeWithSidecars(entry.full, 'stale-online-session-copy');
    }

    // 5) 原子写在崩溃后留下的临时文件（`.job.json.<pid>.<rand>.tmp`）。
    for (const entry of listFiles(jobDir)) {
      if (!/^\..*\.tmp$/i.test(entry.name)) continue;
      if (now - entry.at < Math.max(minArtifactAgeMs, 60 * 60 * 1000)) continue;
      removeFile(entry.full, 'stale-atomic-temp');
    }

    if (jobChanged && !dryRun) {
      try { this.writeJob(metadataPath, job); } catch { /* 元数据写不进去时下一次清理会重试 */ }
    }
    return {
      jobId,
      skipped: '',
      dryRun,
      removed,
      kept,
      freedBytes: removed.reduce((total, item) => total + item.bytes, 0),
      keepBeforeSnapshots,
      keepStaged,
      liveWindowMs,
      minArtifactAgeMs,
    };
  }

  // 作业级保留：与 app/main.js 的 T157 策略同参数（超过 keepJobs 份**且**超过 jobMaxAgeMs
  // 未访问才删整个作业）。在线会话绑着的作业永不删。measure=true 时额外统计前后字节数
  // （只统计，不改动别人目录之外的任何东西）。
  maintainJobs(options = {}) {
    const {
      dryRun = false,
      keepJobs = 20,
      jobMaxAgeMs = 14 * 24 * 60 * 60 * 1000,
      measure = false,
      now = Date.now(),
    } = options;
    let entries = [];
    try {
      entries = fs.readdirSync(this.jobsRoot, { withFileTypes: true })
        // 只认"真的是作业"的目录（里面必须有 job.json）：作业根目录里别人放的东西一律不动。
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(this.jobsRoot, entry.name, 'job.json')))
        .map((entry) => {
          const full = path.join(this.jobsRoot, entry.name);
          let at = 0;
          try { at = fs.statSync(path.join(full, 'job.json')).mtimeMs; } catch { try { at = fs.statSync(full).mtimeMs } catch { at = 0 } }
          return { jobId: entry.name, full, at };
        })
        .sort((left, right) => right.at - left.at);
    } catch { return { ok: true, dryRun, jobCount: 0, keptJobs: [], removedJobs: [], freedBytes: 0, removedFileCount: 0, perJob: [] } }
    const beforeBytes = measure ? entries.reduce((total, entry) => total + directoryBytes(entry.full), 0) : 0;
    const keptJobs = [];
    const removedJobs = [];
    const perJob = [];
    entries.forEach((entry, index) => {
      const ageMs = now - entry.at;
      const pruneJob = index >= Math.max(0, keepJobs)
        && ageMs > jobMaxAgeMs
        && (!this.onlineSessionJobId || this.onlineSessionJobId !== entry.jobId);
      if (pruneJob && inside(this.jobsRoot, entry.full)) {
        const bytes = directoryBytes(entry.full);
        if (!dryRun) {
          try { fs.rmSync(entry.full, { recursive: true, force: true }); } catch { /* 有事就下次再来 */ }
        }
        removedJobs.push({ jobId: entry.jobId, bytes, ageDays: Math.round(ageMs / 86400000) });
        perJob.push({ jobId: entry.jobId, action: 'removed-job', freedBytes: bytes });
        return;
      }
      keptJobs.push(entry.jobId);
      const result = this.cleanupJobArtifacts(entry.jobId, { ...options, dryRun, now });
      perJob.push({
        jobId: entry.jobId,
        action: result.skipped ? `skipped:${result.skipped}` : 'cleaned-artifacts',
        freedBytes: result.freedBytes,
        removedFileCount: result.removed.length,
        keptFileCount: (result.kept || []).length,
      });
    });
    const afterBytes = measure ? directoryBytes(this.jobsRoot) : 0;
    return {
      ok: true,
      dryRun,
      keepJobs,
      jobMaxAgeMs,
      jobCount: entries.length,
      keptJobs,
      removedJobs,
      freedBytes: perJob.reduce((total, item) => total + item.freedBytes, 0),
      removedFileCount: perJob.reduce((total, item) => total + (item.removedFileCount || 0), 0),
      beforeBytes,
      afterBytes,
      perJob,
    };
  }

  // 建新作业时顺手做一次保留与清理（策略幂等、绝不抛）。
  maintainJobsBestEffort() {
    try { return this.maintainJobs({ measure: false }); } catch { return null; }
  }

  stageProject(input = {}) {
    const sourcePath = path.resolve(String(input.sourcePath || ''));
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || path.extname(sourcePath).toLowerCase() !== '.project') {
      throw Object.assign(new Error('请选择现有的 .project 工程文件'), { code: 'CODESYS_SCRIPTENGINE_SOURCE_PROJECT_INVALID' });
    }
    // 新作业之前先做一次保留与清理：作业目录是"追加式"的，只在建作业这一刻收口最省事。
    this.maintainJobsBestEffort();
    const jobId = this.newJobId('stage');
    const jobDir = this.jobPath(jobId);
    const projectDir = path.join(jobDir, 'project');
    const snapshotsDir = path.join(jobDir, 'snapshots');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const projectPath = path.join(projectDir, path.basename(sourcePath));
    const baselinePath = path.join(snapshotsDir, '000-baseline.project');
    fs.copyFileSync(sourcePath, projectPath);
    fs.copyFileSync(sourcePath, baselinePath);
    const hash = sha256(projectPath);
    const job = { jobId, state: 'staged', sourcePath, sourceProjectModified: false, projectPath, baselinePath, baselineSha256: hash, currentSha256: hash, snapshots: [{ id: '000-baseline', path: baselinePath, sha256: hash, reason: 'immutable-source-copy' }], actions: [], createdAt: new Date().toISOString(), policy: this.policy() };
    const metadataPath = path.join(jobDir, 'job.json');
    this.writeJob(metadataPath, job);
    const result = { ok: true, action: 'stage-project', jobId, state: job.state, sourcePath, projectPath, sourceProjectModified: false, baselineSha256: hash, policy: this.policy() };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', result);
    return result;
  }

  // T196（A 项）：把"建一个 direct 作业"抽成**一个**函数。bind-project 与"提前预打开"走
  // 同一段代码，所以两条路建出来的作业逐字段相同（基线快照、基线 sha、工作副本路径与内容、
  // 模式、策略），绑定接管预打开作业时不需要任何"补齐" —— 也就不会出现"接管来的作业与
  // 新建的作业语义不完全一样"这种最难查的偏差。这里的写入顺序/内容与 T183 版逐字相同。
  normalizeActiveProject(input) {
    return input && typeof input === 'object' ? {
      activeGui: input.activeGui === true,
      windowId: String(input.windowId || ''),
      pid: Number(input.pid || 0),
      title: String(input.title || ''),
      readOnly: input.readOnly === true,
      detection: String(input.detection || ''),
      writeAvailable: input.writeAvailable === true,
      writeBlockReason: String(input.writeBlockReason || ''),
    } : null;
  }

  createBoundJob(sourcePath, activeProjectInput, trace) {
    const jobId = this.newJobId('direct');
    const jobDir = this.jobPath(jobId);
    const snapshotsDir = path.join(jobDir, 'snapshots');
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const baselinePath = path.join(snapshotsDir, '000-baseline.project');
    // 检查快照与常驻工作副本**合并成同一份文件**：改前绑定要拷两份（baseline +
    // current-saved-read），之后每一次读取还要再拷一份；现在读路径复用这一份，
    // 只有源内容变了才重拷（见 ensureWorkProject）。
    const inspectionProjectPath = path.join(snapshotsDir, 'working.project');
    const copyStartedAt = trace.begin();
    copyProject(sourcePath, baselinePath, trace);
    refreshInspectionSnapshot(sourcePath, inspectionProjectPath, trace);
    trace.end('readProjectMs', copyStartedAt);
    const hash = this.sha256Validated(sourcePath, trace);
    const activeProject = this.normalizeActiveProject(activeProjectInput);
    const job = { jobId, mode: activeProject?.activeGui ? 'active-gui-saved-source' : 'direct-source', state: 'bound', sourcePath, sourceProjectModified: false, projectPath: sourcePath, inspectionProjectPath, workProjectPath: inspectionProjectPath, workProjectSha256: hash, workProjectDirty: false, activeProject, baselinePath, baselineSha256: hash, currentSha256: hash, snapshots: [{ id: '000-baseline', path: baselinePath, sha256: hash, reason: 'automatic-recovery-baseline', createdAt: new Date().toISOString() }], actions: [], createdAt: new Date().toISOString(), policy: this.policy() };
    const metadataPath = path.join(jobDir, 'job.json');
    this.writeJob(metadataPath, job);
    return { jobId, jobDir, metadataPath, job, baselinePath, inspectionProjectPath, hash, activeProject };
  }

  // 预打开只保留**一个**待接管的作业：下一次预打开把它顶掉（它没被绑定过 = 没有主人）。
  // 不这么做，"每 45 秒一次的检测"会不停建作业目录。**只丢记账、不删目录**：目录可能正被
  // 常驻 worker 打开着，删一个正在被读的文件是自找麻烦；作业级保留（maintainJobs，20 份 /
  // 14 天）本来就用同一套策略回收它。
  discardPreopenedJob(reason) {
    const entry = this.preopenedJob;
    this.preopenedJob = null;
    if (!entry) return null;
    this.appendTimingAudit({ action: 'preopen-project.discarded', reason, jobId: entry.jobId, sourcePath: entry.sourcePath, sourceSha256: entry.sourceSha256 });
    return entry;
  }

  // 绑定是否接管一个预打开作业 —— 条件逐条都要成立，任何一条不成立就老实新建：
  //   · 同一个源（路径逐字符相同、内容 sha 相同）；
  //   · 作业还在、状态还是 bound、工作副本文件还在；
  //   · **写前快照仍然等于磁盘上的源工程**（两边都走一次真哈希，绝不用 stat 缓存）——
  //     这是唯一要紧的一条：源在这中间被外部保存过，基线就不再是"写前内容"，
  //     接管它等于把恢复快照指向一个错误的内容。
  takePreopenedJob(sourcePath, trace) {
    const entry = this.preopenedJob;
    if (!entry) return null;
    if (String(entry.sourcePath || '').toLowerCase() !== sourcePath.toLowerCase()) return null;
    let job = null;
    try { job = this.readJob(entry.jobId).job } catch { job = null }
    if (!job || job.state !== 'bound' || !fs.existsSync(job.inspectionProjectPath)) { this.discardPreopenedJob('job-missing'); return null }
    let currentSourceSha = '';
    try { currentSourceSha = sha256(sourcePath, trace) } catch { currentSourceSha = '' }
    if (!currentSourceSha || currentSourceSha !== job.baselineSha256) {
      // 源在这中间变了 ⇒ 预打开那一次看到的内容已经不是现在的内容。
      this.discardPreopenedJob('source-changed');
      return null;
    }
    if (job.workProjectSha256 !== job.baselineSha256) { this.discardPreopenedJob('work-copy-diverged'); return null }
    this.preopenedJob = null;
    return job;
  }

  bindProject(input = {}) {
    // 绑定是**读路径的起点**（枚举 + 建立不归 GUI 所有的副本），所以它同样埋点：
    // 现场口径"绑定工程→对象树出现 20–40 秒"里，绑定这一段必须能被单独量出来。
    const trace = createTimingTrace();
    const startedAt = trace.begin();
    const sourcePath = path.resolve(String(input.sourcePath || ''));
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || path.extname(sourcePath).toLowerCase() !== '.project') {
      throw Object.assign(new Error('请选择现有的 .project 工程文件'), { code: 'CODESYS_SCRIPTENGINE_SOURCE_PROJECT_INVALID' });
    }
    this.maintainJobsBestEffort();
    trace.end('enumerateMs', startedAt);
    // ── T196（A 项）：接管"更早时刻"已经预打开好的同一个作业 ──────────────────────
    // 面板打开 / 检测到工程时，宿主已经把**同一个源工程**建好作业、打开并走过对象树
    // （见 preopenProjectForRead）。这里接管它：0 字节拷贝、0 次重开，于是紧接着的
    // 第一次真读可以直接命中对象树缓存，而不是再等一次 projects.open（真机 19.5–25 秒）。
    // 接管不改任何安全语义：基线快照、基线 sha、工作副本、模式全部来自同一个作业，
    // 而"源是否还是预打开时那一份"由 takePreopenedJob 用真哈希逐次核对。
    const adoptedJob = this.takePreopenedJob(sourcePath, trace);
    if (adoptedJob) {
      const activeProject = this.normalizeActiveProject(input.activeProject);
      adoptedJob.activeProject = activeProject;
      adoptedJob.mode = activeProject?.activeGui ? 'active-gui-saved-source' : 'direct-source';
      this.writeJob(path.join(this.jobPath(adoptedJob.jobId), 'job.json'), adoptedJob);
      const adoptedResult = { ok: true, action: 'bind-project', jobId: adoptedJob.jobId, mode: adoptedJob.mode, state: adoptedJob.state, sourcePath, projectPath: sourcePath, inspectionProjectPath: adoptedJob.inspectionProjectPath, activeProject, writeAvailable: activeProject ? activeProject.writeAvailable : true, writeBlockReason: activeProject?.writeBlockReason || '', recoverySnapshotPath: adoptedJob.baselinePath, sourceProjectModified: false, baselineSha256: adoptedJob.baselineSha256, adoptedPreopen: true, timings: trace.snapshot({ action: 'bind-project', jobId: adoptedJob.jobId, mode: adoptedJob.mode, objects: 0, workCopyCopied: false, adoptedPreopen: true }), policy: this.policy() };
      this.appendTimingAudit(adoptedResult.timings);
      this.persistEvidence('codesys-scriptengine-direct-workbench.json', adoptedResult);
      // 预打开那一次已经把常驻 worker 里的**同一份工作副本**打开着（路径与内容都没变），
      // 所以这里不需要再预开一次：prewarmOfflineWorkerProject 的 workerHoldsProject
      // 会认出它并直接返回（already-open）。这一步只为兜底"预打开没能打开"的情形。
      if (this.persistentScriptEngine && Date.now() >= this.offlineWorkerDisabledUntil) {
        void this.prewarmOfflineWorkerProject(adoptedJob.inspectionProjectPath, 'bind-project-adopted').catch(() => { /* 读取时的兜底会处理 */ });
      }
      return adoptedResult;
    }
    const created = this.createBoundJob(sourcePath, input.activeProject, trace);
    const { jobId, job, metadataPath, baselinePath, inspectionProjectPath, hash, activeProject } = created;
    const result = { ok: true, action: 'bind-project', jobId, mode: job.mode, state: job.state, sourcePath, projectPath: sourcePath, inspectionProjectPath, activeProject, writeAvailable: activeProject ? activeProject.writeAvailable : true, writeBlockReason: activeProject?.writeBlockReason || '', recoverySnapshotPath: baselinePath, sourceProjectModified: false, baselineSha256: hash, timings: trace.snapshot({ action: 'bind-project', jobId, mode: job.mode, objects: 0, workCopyCopied: true }), policy: this.policy() };
    this.appendTimingAudit(result.timings);
    this.persistEvidence('codesys-scriptengine-direct-workbench.json', result);
    // 首次预热 + 预开工程（T183 第 1 项 / 本轮）：工作者绑定之后**必然**会有一次读取
    // （工作台 bind 完就 inspect），而那次读取必须有一个 ScriptEngine 进程、也必须有一次
    // projects.open（真机 9–20 秒）。既然两件事都躲不掉，就现在起 —— 让启动**和开工程**
    // 与绑定之后的 IPC/渲染重叠，而不是串在读取后面。
    // prewarmOfflineWorkerProject 复用 ensureOfflineWorker 的去重（offlineWorkerPending）
    // 与控制命令队列，所以紧接着的 inspect 绝不会起第二个进程、也绝不会和它抢命令文件；
    // 它自己**不 await、不抛**，绑定本身永远不会因为常驻/预开起不来而失败（读取自己会
    // 落回单发路径）。它的耗时单独记一条 action=preload-project 的审计行，不藏进读取。
    if (this.persistentScriptEngine && Date.now() >= this.offlineWorkerDisabledUntil) {
      void this.prewarmOfflineWorkerProject(inspectionProjectPath, 'bind-project').catch(() => { /* 读取时的兜底会处理 */ });
    }
    return result;
  }

  async createProject(input = {}, exec = {}) {
    this.maintainJobsBestEffort();
    const jobId = this.newJobId('create');
    const jobDir = this.jobPath(jobId);
    const projectDir = path.join(jobDir, 'project');
    const snapshotsDir = path.join(jobDir, 'snapshots');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(snapshotsDir, { recursive: true });
    const rawName = String(input.name || 'TaskHiveOffline').trim().replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80) || 'TaskHiveOffline';
    const projectPath = path.join(projectDir, `${rawName}.project`);
    const job = { jobId, state: 'creating', sourcePath: '', sourceProjectModified: false, projectPath, baselinePath: '', baselineSha256: '', currentSha256: '', snapshots: [], actions: [], createdAt: new Date().toISOString(), policy: this.policy() };
    const metadataPath = path.join(jobDir, 'job.json');
    this.writeJob(metadataPath, job);
    await this.invokeOfflineScript('create-project', jobDir, { action: 'create-project', projectPath }, input.timeoutMs, exec.signal);
    const baselinePath = path.join(snapshotsDir, '000-baseline.project');
    fs.copyFileSync(projectPath, baselinePath);
    const hash = sha256(projectPath);
    Object.assign(job, { state: 'ready', baselinePath, baselineSha256: hash, currentSha256: hash, snapshots: [{ id: '000-baseline', path: baselinePath, sha256: hash, reason: 'created-project' }] });
    this.writeJob(metadataPath, job);
    return { ok: true, action: 'create-project', jobId, projectPath, sourceProjectModified: false, sha256: hash, policy: this.policy() };
  }

  normalizeActionInput(action, input, jobDir, projectPath) {
    const request = { action, projectPath };
    if (['create-pou', 'create-gvl', 'create-dut', 'update-text'].includes(action)) request.objectName = safeId(input.objectName, '对象名称');
    if (input.objectGuid) request.objectGuid = safeGuid(input.objectGuid);
    if (input.parentName) request.parentName = safeId(input.parentName, '父对象名称');
    if (action === 'create-pou') {
      request.pouType = ['program', 'function-block', 'function'].includes(input.pouType) ? input.pouType : 'program';
    }
    if (['create-pou', 'create-gvl', 'create-dut', 'update-text'].includes(action)) {
      if (input.declaration !== undefined) request.declaration = String(input.declaration).slice(0, 1024 * 1024);
      if (input.implementation !== undefined) request.implementation = String(input.implementation).slice(0, 1024 * 1024);
      if (action === 'update-text' && request.declaration === undefined && request.implementation === undefined) throw Object.assign(new Error('至少提供声明或实现文本'), { code: 'CODESYS_SCRIPTENGINE_TEXT_REQUIRED' });
    }
    if (action === 'apply-changes' || action === 'apply-and-build') {
      // The composite validates its batch exactly like apply-changes, so the two
      // paths cannot drift apart. `includeTree` defaults to true: returning the
      // post-write tree is the whole point of the composite.
      if (action === 'apply-and-build') request.includeTree = input.includeTree !== false;
      const changes = Array.isArray(input.changes) ? input.changes : [];
      if (!changes.length || changes.length > 200) throw Object.assign(new Error('批量写入变更数量无效'), { code: 'CODESYS_SCRIPTENGINE_BATCH_INVALID' });
      request.changes = changes.map((change) => {
        const item = { operation: String(change.operation || 'update-text') };
        if (!['create-pou', 'create-gvl', 'create-dut', 'update-text'].includes(item.operation)) throw Object.assign(new Error(`不允许的批量操作：${item.operation}`), { code: 'CODESYS_SCRIPTENGINE_BATCH_OPERATION_INVALID' });
        item.objectName = safeId(change.objectName, '对象名称');
        if (change.objectGuid) item.objectGuid = safeGuid(change.objectGuid);
        if (change.parentName) item.parentName = safeId(change.parentName, '父对象名称');
        if (item.operation === 'create-pou') item.pouType = ['program', 'function-block', 'function'].includes(change.pouType) ? change.pouType : 'program';
        if (change.declaration !== undefined) item.declaration = String(change.declaration).slice(0, 1024 * 1024);
        if (change.implementation !== undefined) item.implementation = String(change.implementation).slice(0, 1024 * 1024);
        if (item.operation === 'update-text' && item.declaration === undefined && item.implementation === undefined) throw Object.assign(new Error('批量更新至少提供声明或实现文本'), { code: 'CODESYS_SCRIPTENGINE_TEXT_REQUIRED' });
        return item;
      });
    }
    if (action === 'export-xml') {
      request.objectName = input.objectName ? safeId(input.objectName, '导出对象名称') : '';
      const exportDir = path.join(jobDir, 'exports');
      fs.mkdirSync(exportDir, { recursive: true });
      request.xmlPath = path.join(exportDir, `${request.objectName || 'project'}-${Date.now()}.xml`);
    }
    if (action === 'import-xml') {
      const source = path.resolve(String(input.xmlPath || ''));
      if (!fs.existsSync(source) || path.extname(source).toLowerCase() !== '.xml') throw Object.assign(new Error('请选择有效的 PLCopenXML 文件'), { code: 'CODESYS_SCRIPTENGINE_XML_INVALID' });
      const importDir = path.join(jobDir, 'imports');
      fs.mkdirSync(importDir, { recursive: true });
      request.xmlPath = path.join(importDir, `${Date.now()}-${path.basename(source)}`);
      fs.copyFileSync(source, request.xmlPath);
    }
    return request;
  }

  async runOfflineAction(action, input = {}, exec = {}) {
    if (action === 'create-project') return this.createProject(input, exec);
    if (!PROJECT_ACTIONS.has(action)) throw Object.assign(new Error(`未实现的离线动作：${action}`), { code: 'CODESYS_SCRIPTENGINE_ACTION_UNAVAILABLE' });
    // 同一个作业上的两个动作会各自 readJob → 各自 writeJob，并且都会往同一个
    // job.projectPath 提交/编译；按 job 串行化，避免互相覆盖元数据与半成品工程。
    // （这里绝不能再嵌套取同一把锁，见 withJobLock 的说明。）
    return this.withJobLock(input.jobId, () => this.runOfflineActionLocked(action, input, exec));
  }

  async runOfflineActionLocked(action, input = {}, exec = {}) {
    const trace = createTimingTrace();
    const actionStartedAt = Date.now();
    // 兼容既有消费方（工作台读 timings.total / scriptEngineProcess / recoverySnapshot），
    // 新字段一律加在同一个对象里，旧键不删不改语义。
    const timings = {};
    const mark = (name, startedAt) => { timings[name] = Date.now() - startedAt; };
    const enumerateStartedAt = trace.begin();
    const { jobDir, metadataPath, job } = this.readJob(input.jobId);
    mark('jobRead', actionStartedAt);
    trace.end('enumerateMs', enumerateStartedAt);
    const directSource = job.mode === 'direct-source' || job.mode === 'active-gui-saved-source';
    if (directSource && MUTATING_ACTIONS.has(action) && input.confirmed !== true) throw Object.assign(new Error('直接写入当前工程前必须确认具体代码差异'), { code: 'CODESYS_SCRIPTENGINE_DIRECT_CONFIRMATION_REQUIRED' });
    // The user explicitly confirms writes in the dedicated workbench. When
    // the current GUI project file is writable, mutate that saved source
    // directly; no PLC/online operation is performed by this engine.
    if (job.mode === 'active-gui-saved-source' && MUTATING_ACTIONS.has(action) && job.activeProject?.writeAvailable !== true) {
      throw Object.assign(new Error(job.activeProject?.writeBlockReason || '当前工程文件不可写'), { code: 'CODESYS_SCRIPTENGINE_ACTIVE_GUI_WRITE_UNAVAILABLE' });
    }
    // 记账用的哈希走 stat 校验缓存；**写入守卫**在 commitProject 里另走一次真哈希。
    const sourceSha256BeforeAction = this.sha256Validated(job.projectPath, trace);
    let actionProjectPath = job.projectPath;
    let stagedProjectPath = '';
    let workCopy = { path: '', copied: false, bytes: 0 };
    // 写前快照必须**先**做：MUTATING 动作前一定存在一份"写前内容"的副本。
    // `reusableWorkPath` 只在工作副本确实与源内容逐字节相同时给出，于是这里可以把
    // "改名"当成取快照（0 字节），而不是再拷一份 428 MB 口径里的那一个 .project。
    let before = null;
    if (MUTATING_ACTIONS.has(action)) {
      const snapshotStartedAt = Date.now();
      const mirror = directSource
        && job.workProjectPath
        && job.workProjectSha256 === sourceSha256BeforeAction
        && job.workProjectDirty !== true
        ? job.workProjectPath
        : '';
      before = this.snapshot(jobDir, metadataPath, job, `before-${action}`, { trace, sourceSha256: sourceSha256BeforeAction, reusableWorkPath: mirror, holdPath: this.offlineWorkerHeldPath() });
      mark('recoverySnapshot', snapshotStartedAt);
    }
    // A GUI-owned project cannot be opened by a second CODESYS --noUI
    // process.  Run every direct-source action against an isolated copy;
    // successful confirmed mutations are committed back atomically after
    // ScriptEngine closes the copy.  This removes the
    // ProjectConcurrentlyInUseException path while retaining the write
    // snapshot and an external-save conflict check.
    //
    // 改前：**每个**动作都新建一份副本（`staged/<action>-<ts>.project`），现场实测
    // 作业目录里的 .project 副本因此累积到 428 MB。改后：一份按源 sha 复用的常驻工作
    // 副本；源没变、副本没脏、也没被上一次提交换掉 ⇒ 拷贝 0 字节。
    if (directSource) {
      const workTarget = this.workProjectPathFor(job.jobId);
      // 只有"这一次真的会覆盖那个文件"时才让 worker 先放手：快路径（工作副本可直接复用）
      // 上放一次手等于白付一次 openMs（9–20 秒），那是把最大的一笔收益又还回去。
      const workCopyMirrors = Boolean(job.workProjectPath)
        && path.resolve(job.workProjectPath) === path.resolve(workTarget)
        && job.workProjectSha256 === sourceSha256BeforeAction
        && job.workProjectDirty !== true
        && fs.existsSync(workTarget);
      if (!workCopyMirrors && this.workerHoldsProject(workTarget)) {
        await this.releaseOfflineWorkerProject('work-copy-rebuild');
      }
      const stageStartedAt = Date.now();
      workCopy = this.ensureWorkProject(job, metadataPath, { trace, sourceSha256: sourceSha256BeforeAction });
      actionProjectPath = workCopy.path;
      stagedProjectPath = workCopy.path;
      if (action === 'inspect-project') {
        job.inspectionProjectPath = workCopy.path;
        this.writeJob(metadataPath, job);
      }
      mark('stageCopy', stageStartedAt);
    }
    const normalizeStartedAt = Date.now();
    const request = this.normalizeActionInput(action, input, jobDir, actionProjectPath);
    mark('requestNormalize', normalizeStartedAt);
    if (action === 'inspect-project' && directSource) {
      request.sourceProjectPath = job.projectPath;
      request.inspectionMode = job.mode === 'active-gui-saved-source' ? 'active-gui-saved-snapshot' : 'direct-source-saved-snapshot';
    }
    // 第 4 项（拆分 apply 与 build）的服务端一半：只落盘不编译。
    // 默认**关闭**（`deferBuild !== true`），所以既有的一次 IPC 语义与返回形状完全不变；
    // 显式打开时这次调用在 apply+save+提交之后立刻回报 buildPending，编译交给
    // build-status 去收（见 buildStatus / readDeferredBuild）。
    if (action === 'apply-and-build' && input.deferBuild === true) {
      request.build = false;
      if (input.includeTree === undefined) request.includeTree = false;
    }
    let result = null;
    // 同一个源 sha 只算一次（改前这里对同一个文件算了两遍）。`job.sourcePath` 为空的
    // 作业（create-project）用作业内的工程副本做缓存键，而不是对空路径取哈希。
    const inspectSourceSha = action === 'inspect-project'
      ? this.sha256Validated(job.sourcePath || job.projectPath, trace)
      : '';
    const inspectCacheKey = action === 'inspect-project' && directSource
      ? `${path.resolve(job.sourcePath).toLowerCase()}::${inspectSourceSha}`
      : '';
    const cachedInspection = inspectCacheKey ? this.inspectCache.get(inspectCacheKey) : null;
    const diskInspection = !cachedInspection && inspectSourceSha ? this.readInspectDiskCache(inspectSourceSha) : null;
    if (cachedInspection) {
      result = {
        ok: true,
        status: 'verified-cached',
        action,
        durationMs: 0,
        payload: JSON.parse(JSON.stringify(cachedInspection.payload)),
        processError: {},
        stdout: '',
        stderr: '',
        policy: this.policy(),
        artifacts: { cached: true, sourceCacheKey: inspectCacheKey },
      };
    } else if (diskInspection) {
      // Same saved .project bytes ⇒ the same object tree, without paying the
      // ~30 s ScriptEngine launch again after an app restart.
      result = {
        ok: true,
        status: 'verified-disk-cached',
        action,
        durationMs: 0,
        payload: JSON.parse(JSON.stringify(diskInspection)),
        processError: {},
        stdout: '',
        stderr: '',
        policy: this.policy(),
        artifacts: { cached: true, cacheSource: 'disk', sourceCacheKey: inspectSourceSha },
      };
      if (result.payload && typeof result.payload === 'object') {
        result.payload.projectPath = actionProjectPath;
        if (result.payload.project && typeof result.payload.project === 'object') result.payload.project.path = actionProjectPath;
      }
      if (inspectCacheKey) {
        this.inspectCache.set(inspectCacheKey, { payload: JSON.parse(JSON.stringify(result.payload)), cachedAt: Date.now() });
        if (this.inspectCache.size > 16) this.inspectCache.delete(this.inspectCache.keys().next().value);
      }
    } else {
      const scriptStartedAt = Date.now();
      try {
        result = await this.invokeOfflineScript(action, jobDir, request, input.timeoutMs, exec.signal, trace);
      } catch (error) {
        // 动作失败 = 工作副本可能已被 CODESYS 存过一半：标脏，下一次动作从源工程重建。
        // 不这么做的话，下一次编译/回滚会拿一份脏副本当"已保存的工程"。
        if (directSource && MUTATING_ACTIONS.has(action)) {
          job.workProjectDirty = true;
          try { this.writeJob(metadataPath, job) } catch { /* 后面还会整体写一次 */ }
        }
        throw error;
      }
      mark('scriptEngineProcess', scriptStartedAt);
      if (inspectCacheKey && result?.payload?.complete === true && result?.payload?.textTruncated === false) {
        this.inspectCache.set(inspectCacheKey, { payload: JSON.parse(JSON.stringify(result.payload)), cachedAt: Date.now() });
        if (this.inspectCache.size > 16) this.inspectCache.delete(this.inspectCache.keys().next().value);
      }
      if (inspectSourceSha && result?.payload?.complete === true && result?.payload?.textTruncated === false) {
        this.writeInspectDiskCache(inspectSourceSha, result.payload);
      }
    }
    if ((action === 'inspect-project' || (action === 'apply-and-build' && result?.payload?.objects)) && result?.payload) {
      result.payload.sourceProjectPath = job.projectPath;
      result.payload.inspectionMode = request.inspectionMode || (action === 'apply-and-build' ? 'post-write-refresh' : undefined);
      result.payload.activeProject = job.activeProject || null;
    }
    job.currentSha256 = this.sha256Validated(job.projectPath, trace);
    job.state = 'ready';
    job.actions.push({ action, at: new Date().toISOString(), beforeSnapshot: before?.id || '', beforeSha256: before?.sha256 || '', afterSha256: job.currentSha256, resultPath: result.artifacts.resultPath, ok: result.ok });
    if (stagedProjectPath && MUTATING_ACTIONS.has(action) && result.ok === true) {
      const commitStartedAt = Date.now();
      // 恢复源：优先用写前快照（它的字节就是写前内容，且守卫刚刚核对过 sha）。
      // 这样每次写入不再白拷一份 `*.taskhive-write-backup`，恢复能力一字不减。
      commitProject(job.projectPath, stagedProjectPath, sourceSha256BeforeAction, { trace, rollbackFrom: before?.path || '' });
      this.invalidateShaCache(job.projectPath);
      this.invalidateShaCache(stagedProjectPath);
      job.currentSha256 = this.sha256Validated(job.projectPath, trace);
      if (job.workProjectPath && path.resolve(job.workProjectPath) === path.resolve(stagedProjectPath)) {
        // 我们刚把 staged 拷到源，两边现在逐字节相同 ⇒ 下一次动作拷贝 0 字节。
        job.workProjectSha256 = job.currentSha256;
        job.workProjectDirty = false;
      }
      mark('sourceCommit', commitStartedAt);
    } else if (directSource && MUTATING_ACTIONS.has(action) && result.ok !== true && job.workProjectPath) {
      job.workProjectDirty = true;
    }
    // 第 4 项：apply 已经落盘（上面 commitProject 成功）⇒ 这里就可以回报了。编译排到
    // 锁释放之后后台跑，结果用 build-status 收。
    let deferredBuild = null;
    if (action === 'apply-and-build' && input.deferBuild === true && result.ok === true) {
      deferredBuild = this.queueDeferredBuild(job, actionProjectPath, { committedBytes: Number(trace.snapshot().commitBackupBytes) || 0 });
    }
    // The composite already read the post-write tree inside the write's own CODESYS
    // process, so cache it under the NEW source hash: a later read of this project
    // then costs 0 ms instead of another ~33 s ScriptEngine launch. This has to run
    // AFTER the commit — a post-write read used to miss the cache by definition,
    // because the write had just changed the content the key is derived from.
    if ((action === 'apply-and-build' || action === 'apply-changes') && result?.ok === true
      && result.payload?.complete === true && result.payload?.textTruncated === false
      && Array.isArray(result.payload?.objects)) {
      try { this.writeInspectDiskCache(job.currentSha256, result.payload); } catch { /* the cache is best effort */ }
    }
    const sourceProjectModified = directSource && MUTATING_ACTIONS.has(action) && result.ok === true;
    job.sourceProjectModified = job.sourceProjectModified || sourceProjectModified;
    const metadataStartedAt = Date.now();
    this.writeJob(metadataPath, job);
    mark('metadataWrite', metadataStartedAt);
    const timingRecord = trace.snapshot({
      action,
      jobId: job.jobId,
      mode: job.mode || 'isolated-copy',
      cachedRead: Boolean(result?.artifacts?.cached),
      workCopyCopied: workCopy.copied === true,
      beforeSnapshotReused: before?.reused === true,
      objects: Array.isArray(result?.payload?.objects) ? result.payload.objects.length : 0,
    });
    // Python 侧自报的分段（open/apply/save/build/tree），是"apply 与 build 分开计时"的唯一
    // 可信来源 —— 宿主看到的只是进程墙钟。
    // **缓存命中时这些字段必须归零**：那一次根本没有 Python 进程跑过，payload 是从上次
    // 的返回里原样拿回来的（payload 里还留着上一次的 phaseMs）。不归零的话，一次 12 毫秒的
    // 缓存读取会在审计流里写成 treeMs=3040 —— 聚合（jq/Excel）就会把同一段耗时重复计一遍。
    const phase = timingRecord.cachedRead ? {} : (result?.payload?.phaseMs || {});
    for (const key of ['openMs', 'applyMs', 'saveMs', 'buildMs', 'treeMs', 'serviceMs']) {
      const value = key === 'serviceMs' ? (timingRecord.cachedRead ? 0 : result?.payload?.serviceMs) : phase[key];
      if (Number(value) > 0) timingRecord[key] = Math.round(Number(value));
    }
    // "已打开的工程被复用了"必须能在审计流里独立看见：openMs=0 与 openMs=11000 是两件
    // 完全不同的事，不能让读者只能靠 serviceMs 猜。
    if (!timingRecord.cachedRead && Number(result?.payload?.openReused) === 1) timingRecord.projectReused = 1;
    if (!timingRecord.cachedRead && Number(result?.payload?.treeReused) === 1) timingRecord.treeReused = 1;
    // B 项（saveMs 里有没有重复保存）的唯一可信来源：**这一次动作**让 CODESYS 序列化了几次
    // 整个工程。缓存命中时必须是 0 —— 那一次根本没有 Python 进程跑过，payload 是上一次返回的
    // 原样拷贝，它的 saveCalls 属于上一次动作，计进来就是把同一次落盘数两遍。
    timingRecord.saveCalls = timingRecord.cachedRead ? 0 : (Number(result?.payload?.saveCalls) || 0);
    timings.scriptEngineProcess = timings.scriptEngineProcess || 0;
    timings.recoverySnapshot = timings.recoverySnapshot || timingRecord.recoverySnapshotMs;
    timings.total = timingRecord.totalMs;
    timings.jobDirCopyBytes = timingRecord.jobDirCopyBytes;
    timings.hashCalls = timingRecord.hashCalls;
    timings.pythonStartMs = timingRecord.pythonStartMs;
    const auditRecord = Object.assign({}, timingRecord, {
      legacy: { jobRead: timings.jobRead || 0, stageCopy: timings.stageCopy || 0, requestNormalize: timings.requestNormalize || 0, recoverySnapshot: timings.recoverySnapshot, scriptEngineProcess: timings.scriptEngineProcess, sourceCommit: timings.sourceCommit || 0, metadataWrite: timings.metadataWrite || 0 },
    });
    this.appendTimingAudit(auditRecord);
    const evidence = { ...result, jobId: job.jobId, mode: job.mode || 'isolated-copy', sourcePath: job.sourcePath || '', projectPath: job.projectPath, actionProjectPath, stagedProjectPath, sourceProjectModified, buildPending: Boolean(deferredBuild), buildId: deferredBuild?.buildId || '', beforeSnapshot: before || null, currentSha256: job.currentSha256, baselineSha256: job.baselineSha256, timings: { ...timings, ...timingRecord }, timingAudit: auditRecord };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', evidence);
    return evidence;
  }

  // diff 只读（读 job.json + 算 sha256），没有读-改-写竞争，而且 app/main.js 是
  // **同步**调用它（`const offlineProject = ... .diff({ jobId })`），所以它必须保持
  // 同步、不进按 job 的异步队列。
  diff(input = {}) {
    const { job } = this.readJob(input.jobId);
    const currentSha256 = sha256(job.projectPath);
    const result = { ok: true, action: 'diff', jobId: job.jobId, mode: job.mode || 'isolated-copy', sourcePath: job.sourcePath || '', projectPath: job.projectPath, changed: currentSha256 !== job.baselineSha256, baselineSha256: job.baselineSha256, currentSha256, sourceProjectModified: job.mode === 'direct-source' && currentSha256 !== job.baselineSha256, snapshots: job.snapshots.map(({ id, path: snapshotPath, sha256: hash, reason, createdAt }) => ({ id, path: snapshotPath, sha256: hash, reason, createdAt })) };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', result);
    return result;
  }

  rollback(input = {}) {
    return this.withJobLock(input.jobId, () => this.rollbackLocked(input));
  }

  async rollbackLocked(input = {}) {
    const { metadataPath, job } = this.readJob(input.jobId);
    if (job.mode === 'active-gui-saved-source' && job.activeProject?.writeAvailable !== true) {
      throw Object.assign(new Error(job.activeProject?.writeBlockReason || '当前工程文件不可写'), { code: 'CODESYS_SCRIPTENGINE_ACTIVE_GUI_WRITE_UNAVAILABLE' });
    }
    const wanted = String(input.snapshotId || '000-baseline');
    const snapshot = job.snapshots.find((item) => item.id === wanted);
    if (snapshot && snapshot.pruned === true && !fs.existsSync(snapshot.path)) {
      throw Object.assign(new Error(`回滚快照 ${snapshot.id} 已被作业目录保留策略回收（只保留最新若干份写前快照）；000-baseline 基线不受影响，可回滚到基线`), { code: 'CODESYS_SCRIPTENGINE_SNAPSHOT_PRUNED', details: { snapshotId: snapshot.id, prunedAt: snapshot.prunedAt || '', prunedReason: snapshot.prunedReason || '' } });
    }
    if (!snapshot || !fs.existsSync(snapshot.path)) throw Object.assign(new Error('回滚快照不存在'), { code: 'CODESYS_SCRIPTENGINE_SNAPSHOT_NOT_FOUND' });
    // 回滚是"整文件覆盖 job.projectPath"：常驻 worker 可能正把它打开着。让路是必须的 ——
    // 否则 Windows 上这次覆盖会直接失败（或者更糟：改写一个正被读的句柄）。
    if (this.workerHoldsProject(job.projectPath)) {
      await this.releaseOfflineWorkerProject('rollback-restore');
    }
    fs.copyFileSync(snapshot.path, job.projectPath);
    job.currentSha256 = sha256(job.projectPath);
    job.state = 'rolled-back';
    job.sourceProjectModified = job.mode === 'direct-source' && job.currentSha256 !== job.baselineSha256;
    job.actions.push({ action: 'rollback', snapshotId: snapshot.id, at: new Date().toISOString() });
    this.writeJob(metadataPath, job);
    const result = { ok: true, action: 'rollback', jobId: job.jobId, mode: job.mode || 'isolated-copy', sourcePath: job.sourcePath || '', projectPath: job.projectPath, snapshotId: snapshot.id, currentSha256: job.currentSha256, sourceProjectModified: job.sourceProjectModified, restored: true };
    this.persistEvidence('codesys-scriptengine-offline-workbench.json', result);
    return result;
  }

  async invokeOfflineScript(action, jobDir, request, timeoutMs = 180000, signal, trace = null) {
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) throw Object.assign(new Error('CODESYS ScriptEngine 未就绪'), { code: 'CODESYS_SCRIPTENGINE_NOT_READY', details: doctor });
    const runId = `${action}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const runDir = path.join(jobDir, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const requestPath = path.join(runDir, 'request.json');
    const scriptPath = path.join(runDir, 'action.py');
    const resultPath = path.join(runDir, 'result.json');
    fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    const safeTimeout = Math.max(10000, Math.min(300000, Number(timeoutMs) || 180000));
    const startedAt = Date.now();
    let stdout = ''; let stderr = ''; let processError = null; let workerInfo = null;
    if (this.persistentScriptEngine && Date.now() >= this.offlineWorkerDisabledUntil) {
      try {
        const served = await this.invokePersistentScript(action, request, resultPath, safeTimeout, signal, trace);
        stdout = served.stdout;
        stderr = served.stderr;
        processError = served.processError;
        workerInfo = served.worker;
      } catch (error) {
        if (error?.code === 'CODESYS_OFFLINE_WORKER_UNSAFE_RETRY') throw error;
        // 常驻起不来 / 命令没被接走：**这一条动作**落回单发路径（行为与改前完全一致）。
        // 熔断一段时间，避免每个动作都白等一次启动超时；崩溃后的重建就发生在熔断到期之后。
        this.offlineWorkerFailures += 1;
        this.offlineWorkerDisabledUntil = Date.now() + Math.min(120000, 15000 * this.offlineWorkerFailures);
        this.offlineWorkerLog(`persistent worker unavailable (${error?.code || error?.message}); falling back to one-process-per-action for ${Math.round((this.offlineWorkerDisabledUntil - Date.now()) / 1000)}s`);
        try { await this.stopOfflineWorker('fallback') } catch { /* best effort */ }
        workerInfo = null;
      }
    }
    if (!workerInfo) {
      fs.writeFileSync(scriptPath, buildOfflineActionScript(requestPath, resultPath), 'utf8');
      const args = [`--profile=\"${doctor.profile}\"`, '--noUI', `--runscript=\"${scriptPath}\"`];
      const coldStartedAt = trace ? trace.begin() : null;
      if (trace) trace.count('processStarts', 1);
      let output = {};
      try {
        // encoding:'buffer' —— 见 decodeProcessText：CODESYS 的控制台输出是 GBK，按 UTF-8 解
        // 会得到一片 U+FFFD（编译输出面板里显示成乱码的根因）。
        output = await this.runProcess(doctor.exePath, args, { cwd: runDir, windowsHide: true, windowsVerbatimArguments: process.platform === 'win32', timeout: safeTimeout, maxBuffer: 4 * 1024 * 1024, signal, encoding: 'buffer' });
      } catch (error) {
        output = error || {};
        processError = { code: error?.code || null, signal: error?.signal || null, killed: Boolean(error?.killed), message: String(error?.message || error).slice(0, 4000) };
      }
      if (trace) {
        // 冷启动里"启动"和"干活"在同一个进程里，拆不开 —— 如实标注整段耗时。
        trace.end('pythonStartMs', coldStartedAt);
        trace.count('pythonIsColdProcessTotal', 1);
        trace.count('pythonReused', 0);
      }
      stdout = decodeProcessText(output?.stdout).slice(-32000);
      stderr = decodeProcessText(output?.stderr).slice(-32000);
    }
    return this.finalizeOfflineEvidence({ action, jobDir, runId, runDir, requestPath, scriptPath, resultPath, request, startedAt, stdout, stderr, processError, trace });
  }

  // 单发路径的收尾：读 result.json、解析编译族结果、判定三态状态、拼证据。
  // 常驻与单发**共用这一段**，所以两条路径的返回形状与错误语义不可能漂移。
  finalizeOfflineEvidence(context) {
    const { action, jobDir, runId, runDir, requestPath, scriptPath, resultPath, request, startedAt, stdout, stderr, processError, trace } = context;
    const parseStartedAt = trace ? trace.begin() : null;
    let payload = null;
    try { payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch {}
    if (trace) trace.end('parseMs', parseStartedAt);
    // 编译族动作：结果**必须**结构化回传（成功/失败/未知 + 错误数 + 警告数 + 前若干条
    // 错误文本 + 耗时 + 目标工程）。旧实现只把 stderr 里 `错误:` / `Error:` 的行算成
    // 错误，于是真实的 `编译完成 -- 0错误,0警告` 和 `C0032: 无法转换类型` 全被忽略，
    // 错误的编译被当成成功；而且没有 payload 时连一条结构化结果都不回传。
    // 拆分后的"只落盘不编译"那一半：这一次调用根本没有编译，所以状态必须如实说
    // "已应用、未编译"，绝不能落到编译三态上（否则界面会拿一个不存在的编译结果去显示）。
    const buildSkipped = Boolean(payload && payload.buildSkipped === true);
    let compile = null;
    if (BUILD_ACTIONS.has(action) && !buildSkipped) {
      const stderrDiagnostics = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((text) => ({
        severity: classifyConsoleLine(text),
        text,
        source: 'codesys-stderr',
      }));
      // CODESYS 把编译消息打在**控制台**（真机原文：`编译: Text: C0032: 无法转换类型 ...`、
      // `编译: Text: C0: 编译完成 -- 0错误,0警告`），而那份控制台输出在常驻 worker 里走的是
      // stdout 日志（stdio 只进文件），单发路径里才是管道。所以 stdout 里的诊断行也必须进
      // messages，否则抽屉里"编译是否干净"永远只有计数、没有一条明细。
      // 只收 Error/Warning 级：stdout 上还有启动横幅之类的 Info 行，全收会把明细淹掉。
      const stdoutDiagnostics = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        .map((text) => ({ severity: classifyConsoleLine(text), text, source: 'codesys-stdout' }))
        .filter((item) => item.severity === 'Error' || item.severity === 'Warning');
      const payloadMessages = Array.isArray(payload?.messages) ? payload.messages : [];
      // T225：这里以前是 `Set(severity\u0000text)` 去重 —— 它顺手把**真实的重复告警**也删了
      // （真机：29 行警告压成 8 个唯一文本，界面只能说"已显示 8 条"）。现在按出现次数合并：
      // 结构化的 CODESYS 消息 + 控制台两份捕获，每个键取各来源计数的最大值（见
      // `mergeDiagnosticOccurrences`）。计数口径一个字没改：`detailWarningCount` 依旧由
      // `buildCompileResult` 从这份明细里数出来，总数依旧以编译器总结行为准。
      const merged = mergeDiagnosticOccurrences([payloadMessages, stderrDiagnostics, stdoutDiagnostics]);
      compile = buildCompileResult({ action, durationMs: Date.now() - startedAt, projectPath: request?.projectPath, stdout, stderr, messages: merged, processError });
      // "无法判定"/"汇总行与明细矛盾"这两种情况必须让界面也看得见，否则单看计数仍然
      // 会骗人。走既有 messages 通道（Info 级），不新造字段协议、不伪造错误级。
      const note = compileResultNote(compile);
      if (note) merged.push({ severity: 'Info', source: 'taskhive-compile-guard', text: note });
      if (payload) {
        payload.messages = merged;
        // 计数口径（界面按它呈现）：汇总行的数字与正文条目数**分开**过桥，界面才能在两者不一致时
        // 两个都显示（`28（已显示 7 条）`）。此前桥上一个数都没有，界面只能自己去数 messages，
        // 于是"编译器汇总 28 条警告"被显示成"警告 7"。字段清单只在 applyCompileResultToPayload 一处。
        applyCompileResultToPayload(payload, compile);
      }
    } else if (payload) {
      payload.compile = null;
    }
    // A CODESYS --noUI host sometimes does not exit after a finished script (a
    // hidden warning dialog blocks it), and the process cap then kills a run
    // whose result was ALREADY complete on disk. Measured in the field: a
    // 62-object inspect wrote a complete result and was killed at the 120 s cap,
    // so the user waited two minutes and got "Command failed" with no tree. A
    // complete payload wins over the process outcome; the process error becomes
    // a warning instead of throwing finished work away.
    const payloadComplete = Boolean(payload && payload.ok === true)
      && (action !== 'inspect-project' || (payload.complete === true && payload.textTruncated === false));
    const recovered = Boolean(payloadComplete && processError);
    const actionOk = payloadComplete;
    const warnings = recovered ? [{ code: 'CODESYS_PROCESS_ERROR_AFTER_RESULT', message: processError?.message || 'ScriptEngine 进程在写出完整结果后被结束' }] : [];
    // 编译族的状态取三态：成功 / 失败 / 无法判定。unknown 绝不能落到 verified ——
    // "解析不出错误数"不等于"没有错误"。
    const compileStatus = BUILD_ACTIONS.has(action) && !buildSkipped && compile
      ? (compile.succeeded === false ? 'completed-with-errors' : compile.succeeded === null ? 'completed-with-unknown-errors' : '')
      : '';
    const status = actionOk
      ? (buildSkipped ? 'applied-without-build' : (compileStatus || (recovered ? 'verified-with-process-warning' : 'verified')))
      : 'failed';
    const evidence = { ok: actionOk, status, warnings, action, runId, durationMs: Date.now() - startedAt, payload, compile, buildSkipped, processError: processError || {}, stdout, stderr, policy: this.policy(), artifacts: { jobDir, runDir, requestPath, scriptPath, resultPath }, completedAt: new Date().toISOString() };
    if (!evidence.ok) {
      const error = Object.assign(new Error(processError?.message || `ScriptEngine 离线动作失败：${action}`), { code: 'CODESYS_SCRIPTENGINE_OFFLINE_ACTION_FAILED', details: evidence });
      // 失败也要回传：结构化结果同时挂在 error.compile（工具返回给会话）和既有的工作台
      // 证据日志里，摘要进 message —— 否则调用方只拿到一句 "Command failed"。
      if (compile) {
        error.compile = compile;
        error.message = `${error.message}；${compileResultText(compile)}`;
        if (compile.errors.length) error.message = `${error.message}；首条错误：${String(compile.errors[0]).slice(0, 300)}`;
        try { this.persistEvidence('codesys-scriptengine-offline-workbench.json', { ...evidence, ok: false, compile }); } catch { /* 证据落盘失败不能盖掉原始错误 */ }
      }
      throw error;
    }
    return evidence;
  }

  // ── 常驻 ScriptEngine worker（T183 第 1 项）──────────────────────────────
  // 冷启动 vs 常驻：现场实测一次动作的 `scriptEngineProcess` 占 99.9 %
  // （34,387 / 34,411 ms），也就是说 34 秒里几乎全是 CODESYS + IronPython 的启动。
  // 常驻 worker 把这个启动**摊到多次动作上**（首次预热一次，之后每次只付服务时间）。
  offlineWorkerState() {
    const worker = this.offlineWorker;
    return {
      enabled: this.persistentScriptEngine,
      running: Boolean(worker && worker.running),
      seq: worker ? worker.seq : 0,
      pid: worker?.child?.pid || 0,
      runToken: worker ? worker.runToken : '',
      workDir: worker ? worker.workDir : '',
      disabledForMs: Math.max(0, this.offlineWorkerDisabledUntil - Date.now()),
      failures: this.offlineWorkerFailures,
      lastError: worker ? worker.lastError : '',
      startMs: worker ? worker.startMs : 0,
    };
  }

  // 并发串行化：同一时刻只有一个在途请求 —— 常驻进程一次只服务一条命令（协议就是
  // 一个命令文件 + 逐 seq 结果文件），两个并发调用若各自写命令文件，后写的会覆盖前
  // 一个，前一个就永远等不到自己的 seq。
  async withOfflineWorkerLock(task) {
    const previous = this.offlineWorkerPending || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.offlineWorkerPending = tail;
    await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (this.offlineWorkerPending === tail) this.offlineWorkerPending = null;
    }
  }

  // 首次复用必须**如实**记下"这一次其实等了启动"：worker 是绑定工程时预热的，那次启动
  // 没有算在任何动作头上。如果这里不记，用户看到的第一次读取就是
  // "pythonStartMs=0 却花了 30 秒" —— 那正是埋点要消灭的那种谎报。
  noteWorkerStart(trace) {
    const worker = this.offlineWorker;
    if (!trace || !worker) return;
    if (worker.startMs && worker.startAttributed !== true) {
      worker.startAttributed = true;
      trace.add('pythonStartMs', worker.startMs);
    }
  }

  async ensureOfflineWorker(trace) {
    const worker = this.offlineWorker;
    if (worker && worker.running) {
      if (trace) trace.count('pythonReused', 1);
      this.noteWorkerStart(trace);
      return worker;
    }
    // 启动要 20–40 秒：这段时间里 this.offlineWorker 还是 null/死进程，后来者必须等
    // 同一个 promise，而不是再起一个（否则第二个会去写同一个目录 —— 在线会话那边
    // 现场踩过的 EBUSY 就是这么来的）。
    return this.withOfflineWorkerLock(async () => {
      if (this.offlineWorker && this.offlineWorker.running) {
        // 这一支是"等到了别人起的那个进程"，也就是**真正付了等待**的那一次动作。
        if (trace) trace.count('pythonReused', 1);
        this.noteWorkerStart(trace);
        return this.offlineWorker;
      }
      return this.startOfflineWorker(trace);
    });
  }

  async startOfflineWorker(trace, options = {}) {
    // 启动上限 90 秒：现场实测 CODESYS 启动 31.9 秒，90 秒还没有 ready 就说明它起不来，
    // 这时候**落回单发路径比继续等更有价值**（改前的冷启动上限是 180 秒，所以这个上限
    // 只会让最坏情况更早结束，不会更慢）。
    const startTimeoutMs = Math.max(15000, Number(options.timeoutMs) || 90000);
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) throw Object.assign(new Error('CODESYS ScriptEngine 未就绪'), { code: 'CODESYS_SCRIPTENGINE_NOT_READY', details: doctor });
    const runToken = crypto.randomBytes(6).toString('hex');
    const workDir = path.join(this.workerRoot, runToken);
    fs.mkdirSync(workDir, { recursive: true });
    // 每个运行令牌一套交换文件：一个"上次崩溃没退干净、还在等命令"的旧进程只认自己的
    // 文件，谁也命令不动它，它按自己的空闲上限退出 —— 同一条写因此不可能被跑两次。
    const scriptPath = path.join(workDir, `offline-worker-${runToken}.py`);
    const commandPath = path.join(workDir, `offline-command-${runToken}.json`);
    const readyPath = path.join(workDir, `offline-ready-${runToken}.json`);
    const stopPath = path.join(workDir, `offline-stop-${runToken}`);
    fs.writeFileSync(scriptPath, buildPersistentOfflineWorkerScript(workDir, {
      runToken: `-${runToken}`,
      maxIdleSeconds: this.offlineWorkerIdleSeconds,
    }), 'utf8');
    try {
      for (const name of fs.readdirSync(this.workerRoot)) {
        if (name === runToken) continue;
        try { fs.rmSync(path.join(this.workerRoot, name), { recursive: true, force: true }) } catch { /* 还被旧进程占着就留着 */ }
      }
    } catch { /* first start */ }
    const stdoutPath = path.join(workDir, 'offline-worker.stdout.log');
    const stderrPath = path.join(workDir, 'offline-worker.stderr.log');
    const stdoutFd = fs.openSync(stdoutPath, 'a');
    const stderrFd = fs.openSync(stderrPath, 'a');
    const args = [`--profile=\"${doctor.profile}\"`, '--noUI', `--runscript=\"${scriptPath}\"`];
    const startedAtNanos = trace ? trace.begin() : null;
    const startedAt = Date.now();
    if (trace) trace.count('processStarts', 1);
    const child = this.offlineSpawnProcess(doctor.exePath, args, {
      cwd: workDir,
      windowsHide: true,
      windowsVerbatimArguments: process.platform === 'win32',
      detached: false,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    const worker = {
      child, running: true, seq: 0, runToken, workDir, scriptPath, commandPath, readyPath, stopPath,
      startedAt: new Date().toISOString(), startMs: 0, lastError: '', stdoutPath, stderrPath,
      // worker 里那个"已打开的工程"的路径（由每个结果自报）。空 = 它手里没有工程。
      heldProjectPath: '',
      resultPathFor: (seq) => path.join(workDir, `offline-result-${runToken}-${seq}.json`),
      ackPathFor: (seq) => path.join(workDir, `offline-ack-${runToken}-${seq}.json`),
    };
    Object.defineProperty(worker, 'running', {
      get() { return Boolean(child && child.exitCode === null && !child.killed) },
    });
    child.on?.('exit', (code, signal) => {
      worker.lastError = `CODESYS 离线常驻进程已退出（code=${code}${signal ? `, signal=${signal}` : ''}）`;
      this.offlineWorkerLog(worker.lastError);
    });
    child.on?.('error', (error) => {
      worker.lastError = `CODESYS 离线常驻进程启动失败：${error?.message || error}`;
      this.offlineWorkerLog(worker.lastError);
    });
    const closeLogFds = () => {
      try { fs.closeSync(stdoutFd) } catch { /* already closed */ }
      try { fs.closeSync(stderrFd) } catch { /* already closed */ }
    };
    const deadline = Date.now() + startTimeoutMs;
    try {
      while (Date.now() < deadline) {
        if (fs.existsSync(readyPath)) {
          let payload = null;
          try { payload = JSON.parse(fs.readFileSync(readyPath, 'utf8')) } catch { payload = null }
          if (payload && payload.ok === true) {
            worker.ready = payload;
            worker.startMs = Date.now() - startedAt;
            if (trace) trace.end('pythonStartMs', startedAtNanos);
            if (trace) trace.count('pythonReused', 0);
            this.offlineWorker = worker;
            this.offlineWorkerFailures = 0;
            this.offlineWorkerLog(`persistent worker ready pid=${child.pid} startMs=${worker.startMs}`);
            // 应用退出时让常驻 worker 立刻收尾：main.js 的关停路径只收在线会话
            // （那份文件不在本轮写作用域内），所以这里挂一个**同步**的 exit 钩子写停止
            // 文件 —— worker 150 毫秒内就会看到并干净退出，而不是留一个 ~700 MB 的进程
            // 到空闲上限。强杀 TaskHive 时它仍会按自己的 MAX_IDLE_SECONDS 退出。
            // 钩子只挂一次，且绝不在退出路径上抛。
            if (!this.offlineWorkerExitHook) {
              this.offlineWorkerExitHook = true;
              process.on('exit', () => {
                try {
                  const current = this.offlineWorker;
                  if (current && current.stopPath) fs.writeFileSync(current.stopPath, 'stop\n', 'utf8');
                } catch { /* best effort: 退出路径上不允许抛 */ }
              });
            }
            closeLogFds();
            return worker;
          }
          if (payload) {
            worker.lastError = String(payload.error || 'CODESYS 离线常驻进程初始化失败');
            // 启动期就已经能从 stderr 文件里取到正文，所以**现在就取**：等到调用方
            // catch 时，workDir 可能已被下一次启动清掉（startOfflineWorker 会清旧目录）。
            const stderrTail = fileTailText(stderrPath);
            try { child.kill() } catch { /* already gone */ }
            throw Object.assign(
              new Error(`${worker.lastError.slice(-800)}${stderrTail ? `；stderr 末尾：${stderrTail}` : ''}`),
              { code: 'CODESYS_OFFLINE_WORKER_FAILED', details: payload, logPath: stderrPath, stderrTail },
            );
          }
        }
        if (child.exitCode !== null) {
          // 这条分支就是上一轮真机的那条：worker 死在 CODESYS 自己的日志初始化上，
          // 而 `worker.lastError` 只有一句"已退出（code=1）"—— 真因**只**存在于 stderr
          // 文件里。所以这里必须把 stderr 末尾并进 message 并挂在 error 上，否则
          // "预打开失败"这件事在整条链路上都没有正文（审计、日志、返回值全都没有）。
          const stderrTail = fileTailText(stderrPath);
          const base = worker.lastError || 'CODESYS 离线常驻进程在就绪前退出';
          throw Object.assign(
            new Error(`${base}${stderrTail ? `；stderr 末尾：${stderrTail}` : ''}`),
            { code: 'CODESYS_OFFLINE_WORKER_EXITED', logPath: stderrPath, stderrTail },
          );
        }
        await new Promise((resolve) => { setTimeout(resolve, 150) });
      }
      const stderrTail = fileTailText(stderrPath);
      try { child.kill() } catch { /* best effort */ }
      throw Object.assign(
        new Error(`CODESYS 离线常驻进程启动超时${stderrTail ? `；stderr 末尾：${stderrTail}` : ''}`),
        { code: 'CODESYS_OFFLINE_WORKER_TIMEOUT', logPath: stderrPath, stderrTail },
      );
    } catch (error) {
      closeLogFds();
      throw error;
    }
  }

  // 空闲回收：worker 自己也有空闲上限（脚本里 MAX_IDLE_SECONDS）；宿主这一侧在应用退出
  // / 动作连续失败 / 显式要求时收掉它，避免一个 700 MB 的进程没人管。
  async stopOfflineWorker(reason = 'manual', { graceMs = 3000 } = {}) {
    const worker = this.offlineWorker;
    this.offlineWorker = null;
    if (worker) worker.heldProjectPath = '';
    if (!worker) return { stopped: false, reason };
    const child = worker.child;
    try { fs.writeFileSync(worker.stopPath, 'stop\n', 'utf8') } catch { /* best effort */ }
    const exited = await new Promise((resolve) => {
      if (!child || child.exitCode !== null) return resolve(true);
      const timer = setTimeout(() => resolve(false), Math.max(500, graceMs));
      child.once?.('exit', () => { clearTimeout(timer); resolve(true) });
    });
    let killed = false;
    if (!exited) {
      try { child.kill(); killed = true } catch { /* best effort */ }
      await new Promise((resolve) => {
        if (!child || child.exitCode !== null) return resolve(true);
        const timer = setTimeout(() => resolve(false), Math.max(500, graceMs));
        child.once?.('exit', () => { clearTimeout(timer); resolve(true) });
      });
    }
    this.offlineWorkerLog(`offline worker stopped reason=${reason} killed=${killed}`);
    return { stopped: true, killed, reason };
  }

  // 命令通道串行化（见构造函数里 offlineCommandPending 的说明）。控制型命令
  // （preload-project / release-project）与真正的动作走的是**同一条**队列，否则两条
  // 命令会互相覆盖命令文件，被覆盖的那一条要等到超时 —— 而超时分支会收掉 worker。
  async withWorkerCommandLock(task) {
    const previous = this.offlineCommandPending || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.offlineCommandPending = tail;
    await previous.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      if (this.offlineCommandPending === tail) this.offlineCommandPending = null;
    }
  }

  // 常驻 worker 的 stdout/stderr 走文件（stdio 只进日志），所以 CODESYS 打在控制台里的
  // 编译汇总行与诊断明细**不在**返回的 stdout 里。不把这一段读回来的话，编译错误数永远
  // 是 unknown（真机表现：ok:true + errorCount:null + errorCountKnown:false + messages:[]）——
  // 单发路径之所以能看到 `编译完成 -- 0错误,0警告`，只是因为它有管道。
  readWorkerLogChunk(worker, offsets) {
    const read = (file, offset) => {
      try {
        const size = fs.statSync(file).size;
        if (!(size > offset)) return '';
        const from = Math.max(Number(offset) || 0, size - 96 * 1024);
        const length = size - from;
        const fd = fs.openSync(file, 'r');
        try {
          const buffer = Buffer.alloc(length);
          const bytes = fs.readSync(fd, buffer, 0, length, from);
          return decodeProcessText(buffer.subarray(0, bytes));
        } finally { fs.closeSync(fd); }
      } catch { return ''; }
    };
    return {
      stdout: read(worker.stdoutPath, offsets?.stdout),
      stderr: read(worker.stderrPath, offsets?.stderr),
    };
  }

  fileSize(file) {
    try { return fs.statSync(file).size } catch { return 0 }
  }

  offlineWorkerHeldPath() {
    const worker = this.offlineWorker;
    if (!worker || !worker.running) return '';
    return String(worker.heldProjectPath || '');
  }

  workerHoldsProject(projectPath) {
    const held = this.offlineWorkerHeldPath();
    if (!held || !projectPath) return false;
    return path.resolve(held).toLowerCase() === path.resolve(String(projectPath)).toLowerCase();
  }

  // 让 worker 放掉它手里的工程句柄。**只有在宿主准备覆盖那个文件时才调用**：它是
  // "复用已打开的工程"与"Windows 不允许覆盖被持有的文件"之间唯一的那道让路。
  async releaseOfflineWorkerProject(reason = 'host-overwrite') {
    const held = this.offlineWorkerHeldPath();
    if (!held) return { released: false, reason: 'nothing-held' };
    try {
      // projectPath 只是让这条命令**可审计**（"放掉的是哪一个文件"）：Python 侧不看它。
      await this.invokePersistentScript('release-project', { action: 'release-project', projectPath: held }, '', 30000, undefined, null);
    } catch (error) {
      // 释放失败 ⇒ 我们不能安全覆盖那个文件。绝不假装成功、绝不硬来。
      throw Object.assign(new Error(`无法让离线常驻 ScriptEngine 释放已打开的工程（${reason}）：${error?.message || error}`), { code: 'CODESYS_OFFLINE_WORKER_PROJECT_RELEASE_FAILED' });
    }
    this.offlineWorker.heldProjectPath = '';
    this.offlineWorkerLog(`released held project (${held}) before ${reason}`);
    return { released: true, path: held, reason };
  }

  // 绑定工程之后**后台**把工作副本打开：它让紧接着的第一次读取只需要走对象树，而不再
  // 付一次 openMs（真机 9–20 秒）。刻意不 await —— 绑定本身绝不允许被它拖慢；代价
  // 单独记一条 preload-project 的审计行，绝不藏进读取的计时里。
  //
  // T196（A 项）扩展：`options.includeTree` = 预打开时**顺带把对象树也走一遍**
  // （预打开提前服务的那一次 walk 就是"第一次真读"本来要付的那一次，所以它不是新增开销）；
  // `options.sourceSha256` 给定源工程 sha 时，走出来的树会记进**按源内容寻址**的磁盘对象树
  // 缓存 ⇒ 之后的第一次真读直接命中 verified-disk-cached，不必等第二次 projects.open。
  // 默认参数下行为与 T183 版逐字相同（绑定时的预开只开工程、不走树）。
  async prewarmOfflineWorkerProject(projectPath, reason = 'prewarm', options = {}) {
    const trace = createTimingTrace();
    const startedAt = Date.now();
    const includeTree = options.includeTree === true;
    // worker 提到 try 外面：catch 里要读它的 stderrPath 才能把**正文**取回来。
    let worker = null;
    // 「预打开没能发生」也必须有自己的一行。改前只有成功路径写审计，于是 worker 起不来
    // 时整条链路上唯一的结构化证据就是宿主那句 preopened:false —— 真因无处可查。
    const auditFailure = (skipped, errorText, phase) => {
      try {
        this.appendTimingAudit(trace.snapshot({
          action: 'preload-project', jobId: '', mode: 'prewarm', reason,
          cachedRead: false, preloaded: 0, skipped, error: oneLineFailureText(errorText), phase,
        }));
      } catch { /* 审计失败绝不能影响动作本身 */ }
      return { preloaded: false, reason, skipped, error: oneLineFailureText(errorText), phase, ms: Date.now() - startedAt };
    };
    try {
      worker = await this.ensureOfflineWorker(null);
      if (!worker || !worker.running) {
        return auditFailure('worker-unavailable', worker?.lastError || '', 'ensure-worker');
      }
      if (this.workerHoldsProject(projectPath)) {
        return { preloaded: true, reused: true, reason, ms: Date.now() - startedAt, phase: 'already-open' };
      }
      const served = await this.invokePersistentScript('preload-project', { action: 'preload-project', projectPath, includeTree }, '', 180000, undefined, null);
      const payload = served?.payload || {};
      const record = trace.snapshot({
        action: 'preload-project', jobId: '', mode: 'prewarm', reason,
        cachedRead: false, objects: includeTree && Array.isArray(payload.objects) ? payload.objects.length : 0,
        // 成功路径**不带任何正文**：error 为空串（字段常在，永不误导；与 preopen 的返回值同形）。
        error: '',
        preloaded: 1,
        skipped: '',
        openMs: Math.round(Number(payload.phaseMs?.openMs) || 0),
        treeMs: Math.round(Number(payload.phaseMs?.treeMs) || 0),
        serviceMs: Math.round(Number(payload.serviceMs) || 0),
        projectReused: Number(payload.openReused) === 1 ? 1 : 0,
      });
      this.appendTimingAudit(record);
      // 树是**保存字节的纯函数**，与它是从哪一份副本走出来的无关（引擎早就在生产路径上
      // 这么用：apply-and-build 落盘后就是把工作副本走出来的树记在源 sha 名下）。
      // 只有当前这次真的走了树、并且调用方给了源 sha 时才写缓存。
      let inspectCacheWritten = false;
      const cacheSha = String(options.sourceSha256 || '');
      if (includeTree && cacheSha && payload.complete === true && Array.isArray(payload.objects)) {
        inspectCacheWritten = this.writeInspectDiskCache(cacheSha, payload);
      }
      return { preloaded: true, reused: false, reason, ms: record.totalMs, openMs: record.openMs, treeMs: record.treeMs, inspectCacheWritten, phase: 'preload-project' };
    } catch (error) {
      // 预热失败**绝不能**把绑定或读取带下水：读取自己会落回单发路径。
      // 但失败**必须留下正文** —— 这条 catch 就是上一轮真机"只看到 preopened:false"的地方。
      return auditFailure('preload-failed', describeWorkerFailure(error, fileTailText(worker?.stderrPath || '')), error?.code || 'preload-failed');
    }
  }

  // T196（A 项，本轮最高收益）：**提前预打开**。
  //
  // 病根（有真机原文）：这个工程**第一次**被 CODESYS 打开那一次要 29,062 ms
  // （= 常驻 worker 冷启动 + projects.open 19.5–25 s + 首次 walk 3.5 s）。它挂在"绑定"
  // 那一刻，而工作台的流程是"检测到工程 → **立刻**绑定 → **立刻**读取"（detectCurrentProject
  // 里 `await bindSourceProject(...)` 紧跟着 `await inspect(...)`），所以用户紧紧跟着绑定
  // 去读时，预打开还没跑完，读取照样吃满这一笔。
  //
  // 这里把同一件事搬到**路径已知的最早时刻**：面板打开时（用记住的工程路径）或一次真的
  // 检测到工程时。做法与绑定完全同形，所以**总代价不变、只是提前**：
  //   · 用与 bind-project 同一段代码（createBoundJob）建作业：基线快照 + 基线 sha + 工作副本；
  //   · 在常驻 worker 里打开它（复用 ensureOfflineWorker / preload-project 的既有去重）；
  //   · 顺带走一遍对象树，把结果记进按源 content 寻址的磁盘对象树缓存。
  // 于是紧接着的"绑定 + 第一次真读"：绑定**接管**这个作业（0 字节拷贝、0 次重开，
  // 见 takePreopenedJob），读取命中 verified-disk-cached —— 不再需要等任何一次 projects.open。
  // 而常驻 worker 此刻手里就是**同一份工作副本**，所以第一次写入的 openMs 仍然是 0（不倒退）。
  //
  // 三条纪律：
  //   · 幂等：同一个源内容只做一次（磁盘对象树缓存已热 / 已经预打开 ⇒ 直接跳过）；
  //     进程侧由 ensureOfflineWorker 等锁去重，工程侧由 acquire_project 的"路径 + 真读 sha"去重；
  //   · 不阻塞：调用方绝不 await（宿主侧见 preopenCodesysProject）；
  //   · 失败可见：成功 / 跳过 / 失败各一行审计，另加一行 action=preopen-project 的结构化耗时，
  //     预打开真的花掉的 openMs/treeMs 如实上报，绝不藏进读取的计时里（也绝不虚报）。
  async preopenProjectForRead(sourcePathInput, reason = 'preopen') {
    const trace = createTimingTrace();
    const startedAt = Date.now();
    const sourcePath = path.resolve(String(sourcePathInput || ''));
    const record = (extra) => {
      const row = trace.snapshot(Object.assign({ action: 'preopen-project', reason, sourcePath }, extra));
      this.appendTimingAudit(row);
      return row;
    };
    if (!sourcePath || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile() || path.extname(sourcePath).toLowerCase() !== '.project') {
      record({ preopened: 0, skipped: 'not-a-project', error: '' });
      return { ok: false, preopened: false, reason: 'not-a-project', skipped: 'not-a-project', sourcePath, ms: Date.now() - startedAt };
    }
    if (!this.persistentScriptEngine || Date.now() < this.offlineWorkerDisabledUntil) {
      // 熔断开着的唯一原因就是上一次启动失败 —— 把那条原因带上，否则"为什么没预打开"
      // 又要回到"只有一句 persistent-worker-unavailable"。
      record({ preopened: 0, skipped: 'persistent-worker-unavailable', error: oneLineFailureText(this.offlineWorker?.lastError || '') });
      return { ok: false, preopened: false, reason: 'persistent-worker-unavailable', skipped: 'persistent-worker-unavailable', sourcePath, error: oneLineFailureText(this.offlineWorker?.lastError || ''), ms: Date.now() - startedAt };
    }
    const sourceSha256 = this.sha256Validated(sourcePath, trace);
    // 这个内容已经被读过（磁盘对象树缓存按源 sha 寻址、跨重启有效）⇒ 读取本来就是亚秒级的，
    // 再开一次工程纯属白花。
    if (this.readInspectDiskCache(sourceSha256)) {
      record({ preopened: 0, skipped: 'inspect-cache-warm', sourceSha256, error: '' });
      return { ok: true, preopened: false, reason: 'inspect-cache-warm', skipped: 'inspect-cache-warm', sourcePath, sourceSha256, ms: Date.now() - startedAt };
    }
    const current = this.preopenedJob;
    if (current
      && current.sourceSha256 === sourceSha256
      && String(current.sourcePath || '').toLowerCase() === sourcePath.toLowerCase()
      && fs.existsSync(current.metadataPath)) {
      record({ preopened: 0, skipped: 'already-preopened', sourceSha256, jobId: current.jobId, error: '' });
      return { ok: true, preopened: false, reason: 'already-preopened', skipped: 'already-preopened', sourcePath, sourceSha256, jobId: current.jobId, ms: Date.now() - startedAt };
    }
    if (current) this.discardPreopenedJob('superseded');
    try {
      this.maintainJobsBestEffort();
      const created = this.createBoundJob(sourcePath, null, trace);
      this.preopenedJob = { jobId: created.jobId, metadataPath: created.metadataPath, sourcePath, sourceSha256, at: Date.now() };
      const prewarmed = await this.prewarmOfflineWorkerProject(created.inspectionProjectPath, `preopen:${reason}`, { includeTree: true, sourceSha256 });
      const row = record({
        preopened: prewarmed.preloaded ? 1 : 0,
        // 跳过 / 失败各留一句**可读原因**：prewarm 在早退分支上报自己的 skipped
        // （worker-unavailable / preload-failed），成功时为空。
        skipped: prewarmed.preloaded ? '' : String(prewarmed.skipped || prewarmed.reason || 'preload-failed'),
        // 失败正文（改前这里只有 skipped，于是真机只看到 preopened:false）。
        // 成功路径不带任何文字 —— error 恒为 ''，字段常在，永不误导。
        error: prewarmed.preloaded ? '' : oneLineFailureText(prewarmed.error || ''),
        jobId: created.jobId,
        sourceSha256,
        openMs: Math.round(Number(prewarmed.openMs) || 0),
        treeMs: Math.round(Number(prewarmed.treeMs) || 0),
        inspectCacheWritten: prewarmed.inspectCacheWritten ? 1 : 0,
        workCopyCopied: 1,
      });
      return {
        ok: true,
        preopened: prewarmed.preloaded === true,
        reason,
        skipped: row.skipped,
        sourcePath,
        sourceSha256,
        jobId: created.jobId,
        inspectionProjectPath: created.inspectionProjectPath,
        openMs: row.openMs,
        treeMs: row.treeMs,
        inspectCacheWritten: prewarmed.inspectCacheWritten === true,
        error: row.error,
        ms: Date.now() - startedAt,
      };
    } catch (error) {
      // 预打开失败**绝不能**影响任何功能：绑定会老实新建作业，读取会自己落回单发路径。
      this.preopenedJob = null;
      const body = describeWorkerFailure(error, fileTailText(this.offlineWorker?.stderrPath || ''));
      record({ preopened: 0, skipped: 'failed', error: body });
      return { ok: false, preopened: false, reason, skipped: 'failed', sourcePath, error: body, ms: Date.now() - startedAt };
    }
  }

  async invokePersistentScript(action, request, resultPath, timeoutMs, signal, trace) {
    return this.withWorkerCommandLock(() => this.invokePersistentScriptLocked(action, request, resultPath, timeoutMs, signal, trace));
  }

  async invokePersistentScriptLocked(action, request, resultPath, timeoutMs, signal, trace) {
    const worker = await this.ensureOfflineWorker(trace);
    const seq = worker.seq + 1;
    worker.seq = seq;
    // 控制型命令没有自己的 run 目录，就用 worker 目录里逐 seq 的结果文件；
    // 这里现算（而不是让调用方先算）是必须的：seq 只在队列内才唯一。
    const targetResultPath = resultPath || worker.resultPathFor(seq);
    const ackPath = worker.ackPathFor(seq);
    const commandPath = worker.commandPath;
    const command = { seq, action, request, resultPath: targetResultPath, at: new Date().toISOString() };
    const logOffsets = { stdout: this.fileSize(worker.stdoutPath), stderr: this.fileSize(worker.stderrPath) };
    try { fs.rmSync(ackPath, { force: true }) } catch { /* fresh seq ⇒ stale ack impossible, but be explicit */ }
    try { fs.rmSync(targetResultPath, { force: true }) } catch { /* same */ }
    // 命令文件用**直接覆盖写**，不用"临时文件 + rename"：worker 正在读这个文件时，
    // rename 覆盖在 Windows 上会撞上被占用的句柄（EPERM/EBUSY）。协议本来就能容忍读到
    // 半个 JSON —— worker 的 read_command() 解析失败就返回 None，下一次轮询重读，
    // 所以"写进去、读半边、重试"是安全且与在线 worker 完全同形的做法。
    fs.writeFileSync(commandPath, `${JSON.stringify(command)}\n`, 'utf8');
    const deadline = Date.now() + Math.max(10000, Number(timeoutMs) || 180000);
    let accepted = false;
    let stdout = ''; let stderr = ''; let processError = null;
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw Object.assign(new Error(`离线常驻动作被取消：${action}`), { code: 'CODESYS_OFFLINE_WORKER_ABORTED' });
      }
      if (!accepted && fs.existsSync(ackPath)) accepted = true;
      if (fs.existsSync(targetResultPath)) {
        let payload = null;
        try { payload = JSON.parse(fs.readFileSync(targetResultPath, 'utf8')) } catch { payload = null }
        if (payload && Number(payload.workerSeq) === seq) {
          if (trace) trace.add('serviceMs', payload.serviceMs);
          // worker 现在把它打开着的工程路径报回来，宿主据此决定"覆盖之前要不要先让它放手"。
          // 结果里没有这个字段（旧脚本 / 已释放）时一律当成"没持有"。
          worker.heldProjectPath = String(payload.heldProjectPath || '');
          // 只有**真的编译过**的动作才需要控制台那一段：它是编译汇总行与诊断明细的唯一来源，
          // 也是唯一会读日志文件的理由。读取/写入路径上不做这次读盘 + 解码。
          const wantsConsole = BUILD_ACTIONS.has(action) && request?.build !== false;
          if (wantsConsole) {
            const chunk = this.readWorkerLogChunk(worker, logOffsets);
            stdout = chunk.stdout;
            stderr = chunk.stderr;
            // CODESYS 的原生输出可能比结果文件晚一步落盘（写缓冲）。只对编译族动作多等一
            // 拍，且只在这两段都空的时候 —— 编译错误数是三态判断，绝不能靠"读不到就当成 0"。
            if (!stdout && !stderr) {
              await new Promise((resolve) => { setTimeout(resolve, 250) });
              const settled = this.readWorkerLogChunk(worker, logOffsets);
              stdout = settled.stdout;
              stderr = settled.stderr;
            }
          }
          return { stdout, stderr, processError, payload, worker: { reused: true, seq, runToken: worker.runToken, startMs: worker.startMs, serviceMs: Number(payload.serviceMs) || 0 } };
        }
      }
      if (!worker.running) {
        // 走 fileTailText（有界 + 按 GBK 解码 + 压平一行）而不是裸读 utf-8：
        // CODESYS 的诊断是 CP936，按 UTF-8 解出来是一片 U+FFFD，等于没有正文。
        const tail = fileTailText(worker.stderrPath);
        this.offlineWorker = null;
        worker.heldProjectPath = '';
        if (accepted) {
          // 命令**已经被接走**：动作可能已经改过工程副本、甚至已经保存。这里绝不能自动
          // 重试（那会把一次写跑两遍）。如实报错，让调用方按"状态未知"处理。
          throw Object.assign(new Error(`CODESYS 离线常驻进程在动作 ${action} 执行期间退出；该动作可能已部分生效，未自动重试${tail ? `；stderr 末尾：${tail}` : ''}`), { code: 'CODESYS_OFFLINE_WORKER_UNSAFE_RETRY', logPath: worker.stderrPath, stderrTail: tail });
        }
        // 未被接走：这一次动作会落回单发路径，但"为什么常驻起不来"仍必须带正文
        // （上一轮真机就是死在这一支，而 lastError 只有一句 code=1）。
        throw Object.assign(new Error(`${worker.lastError || 'CODESYS 离线常驻进程在接走命令前退出'}${tail ? `；stderr 末尾：${tail}` : ''}`), { code: 'CODESYS_OFFLINE_WORKER_EXITED', logPath: worker.stderrPath, stderrTail: tail });
      }
      // 60 毫秒的轮询给每一次动作白加 ~30 毫秒的平均延迟（真机实测 5 次动作里最慢的一段
      // 就是"worker 已经写完结果、宿主还没看见"）。20 毫秒仍然是"轮询"而不是忙等。
      await new Promise((resolve) => { setTimeout(resolve, 20) });
    }
    // 超时：进程还活着但没给出结果。动作可能仍在跑，所以同样不许自动重试。
    try { await this.stopOfflineWorker('timeout') } catch { /* best effort */ }
    throw Object.assign(new Error(`离线常驻动作超时（${Math.round(timeoutMs / 1000)} 秒）：${action}；进程已收掉，工程状态未知，请在 CODESYS 里核对`), { code: 'CODESYS_OFFLINE_WORKER_UNSAFE_RETRY', timeout: true });
  }

  // 「apply 落盘即回报」的客户端那一半：`apply-and-build` 带 deferBuild 时立刻回报，
  // 这里把那次落盘之后的可选编译结果读回来（含进度）。
  readDeferredBuild(input = {}) {
    const { jobDir, job } = this.readJob(input.jobId);
    const buildId = String(input.buildId || job.pendingBuildId || '');
    const record = (job.deferredBuilds || {})[buildId] || null;
    if (!record) return { ok: true, action: 'build-status', jobId: job.jobId, buildId, state: 'unknown', builds: Object.keys(job.deferredBuilds || {}) };
    return Object.assign({ ok: true, action: 'build-status', jobId: job.jobId, buildId }, record);
  }

  // 拆分的服务端实现（T183 第 4 项）：
  //   阶段一（同步、调用方等的那一段）= apply + save + 提交回源工程 ⇒ 落盘即回报；
  //   阶段二（后台）= 在**同一把作业锁**里跑一次 build，结果写进 job.deferredBuilds。
  //
  // 为什么后台 build 还要拿作业锁：build 读的就是那份常驻工作副本，而下一个动作可能
  // 正是"重建工作副本"（源变了 / 上一次失败了）。不串行化的话，编译会读到一个正在被
  // 覆盖的文件 —— 那是"编译结果对不上代码"的来源。串行化只影响速度，不影响正确性。
  queueDeferredBuild(job, actionProjectPath, options = {}) {
    const buildId = `build-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const jobId = job.jobId;
    const requestedAt = new Date().toISOString();
    // 这个方法只在**已经持有作业锁**的临界区里被调用，所以它绝不自己取锁、也不自己写
    // job.json：只改内存里的 job（由调用方随后的 writeJob 一起落盘），否则两边会互相
    // 覆盖（先写的那份 deferredBuilds 会被动作的整体写冲掉）。
    const map = job.deferredBuilds && typeof job.deferredBuilds === 'object' ? job.deferredBuilds : {};
    map[buildId] = {
      buildId,
      state: 'running',
      action: 'build',
      projectPath: actionProjectPath,
      requestedAt,
      startedAt: Date.now(),
      finishedAt: 0,
      durationMs: 0,
      errorCount: null,
      warningCount: null,
      messageCount: 0,
      messages: [],
      error: '',
    };
    job.deferredBuilds = map;
    job.pendingBuildId = buildId;
    this.appendTimingAudit({ action: 'apply-and-build.apply-phase', jobId, buildId, applyCommitted: true, committedBytes: Number(options.committedBytes) || 0 });
    const refresh = (patch) => {
      Promise.resolve(this.updateJob(jobId, (current) => {
        const currentMap = current.deferredBuilds && typeof current.deferredBuilds === 'object' ? current.deferredBuilds : {};
        currentMap[buildId] = Object.assign({}, currentMap[buildId] || {}, patch);
        current.deferredBuilds = currentMap;
        current.pendingBuildId = buildId;
        return current;
      })).catch(() => {});
    };
    // 后台起点必须**等这一次动作把锁放掉**再取锁：setImmediate 保证排在本轮之后。
    const promise = new Promise((resolve) => {
      setImmediate(() => {
        this.withJobLock(jobId, async () => {
          const startedAt = Date.now();
          try {
            const request = this.normalizeActionInput('build', {}, this.jobPath(jobId), actionProjectPath);
            const result = await this.invokeOfflineScript('build', this.jobPath(jobId), request, 300000, undefined, null);
            const payload = result?.payload || {};
            refresh({
              state: 'done',
              finishedAt: Date.now(),
              durationMs: Date.now() - startedAt,
              buildMs: Number(payload.phaseMs?.buildMs) || 0,
              errorCount: payload.errorCount === undefined ? null : payload.errorCount,
              warningCount: payload.warningCount === undefined ? null : payload.warningCount,
              // 计数口径（本轮）：后台那一趟编译的口径字段必须一起过桥。只带回一个数，界面就
              // 只能退回"数正文条数"，"汇总 28 条 / 已显示 7 条"又被压成 7。
              summaryErrorCount: payload.summaryErrorCount === undefined ? null : payload.summaryErrorCount,
              summaryWarningCount: payload.summaryWarningCount === undefined ? null : payload.summaryWarningCount,
              detailErrorCount: payload.detailErrorCount === undefined ? null : payload.detailErrorCount,
              detailWarningCount: payload.detailWarningCount === undefined ? null : payload.detailWarningCount,
              errorCountSource: String(payload.errorCountSource || ''),
              warningCountSource: String(payload.warningCountSource || ''),
              compileSummary: String(payload.compileSummary || ''),
              messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
              messages: Array.isArray(payload.messages) ? payload.messages.slice(0, 1000) : [],
              status: result.status,
            });
            return result;
          } catch (error) {
            refresh({ state: 'failed', finishedAt: Date.now(), durationMs: Date.now() - startedAt, error: String(error?.message || error).slice(0, 2000), code: error?.code || '' });
            return null;
          }
        }).then(resolve, () => resolve(null));
      });
    });
    if (!this.deferredBuildTasks) this.deferredBuildTasks = new Map();
    this.deferredBuildTasks.set(buildId, promise);
    return { buildId, requestedAt };
  }


  async probe({ timeoutMs = 45000, signal } = {}) {
    const doctor = this.doctor({ persist: true });
    if (!doctor.ready) {
      const error = new Error('CODESYS ScriptEngine 未就绪');
      error.code = 'CODESYS_SCRIPTENGINE_NOT_READY';
      error.details = doctor;
      throw error;
    }
    const safeTimeout = Math.max(5000, Math.min(120000, Number(timeoutMs) || 45000));
    const jobId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const jobDir = path.join(this.jobsRoot, jobId);
    const scriptPath = path.join(jobDir, 'probe.py');
    const resultPath = path.join(jobDir, 'result.json');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(scriptPath, buildProbeScript(resultPath), 'utf8');
    const args = [`--profile=\"${doctor.profile}\"`, '--noUI', `--runscript=\"${scriptPath}\"`];
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let processError = null;
    try {
      const output = await this.runProcess(doctor.exePath, args, {
        cwd: jobDir,
        windowsHide: true,
        windowsVerbatimArguments: process.platform === 'win32',
        timeout: safeTimeout,
        maxBuffer: 1024 * 1024,
        signal,
      });
      stdout = String(output?.stdout || '').slice(-16000);
      stderr = String(output?.stderr || '').slice(-16000);
    } catch (error) {
      stdout = String(error?.stdout || '').slice(-16000);
      stderr = String(error?.stderr || '').slice(-16000);
      processError = { code: error?.code || null, signal: error?.signal || null, killed: Boolean(error?.killed), message: String(error?.message || error).slice(0, 2000) };
    }
    let payload = null;
    try { payload = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { /* reported below */ }
    const evidence = {
      ok: Boolean(payload?.ok) && !processError,
      status: payload?.ok && !processError ? 'verified' : 'failed',
      action: 'probe',
      jobId,
      durationMs: Date.now() - startedAt,
      executable: doctor.exePath,
      version: doctor.version,
      profile: doctor.profile,
      args: [`--profile=\"${doctor.profile}\"`, '--noUI', '--runscript="<isolated-probe.py>"'],
      payload,
      processError: processError || {},
      stdout,
      stderr,
      policy: this.policy(),
      artifacts: { jobDir, scriptPath, resultPath },
      completedAt: new Date().toISOString(),
    };
    this.persistEvidence('codesys-scriptengine-probe.json', evidence);
    if (!evidence.ok) {
      const error = new Error(processError?.message || 'CODESYS ScriptEngine 探针未生成有效结果');
      error.code = 'CODESYS_SCRIPTENGINE_PROBE_FAILED';
      error.details = evidence;
      throw error;
    }
    return evidence;
  }

  persistEvidence(name, value) {
    fs.mkdirSync(this.logsRoot, { recursive: true });
    fs.writeFileSync(path.join(this.logsRoot, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
}

module.exports = {
  CodesysScriptEngine,
  ALLOWED_ACTIONS,
  ONLINE_ACTIONS,
  // 在线冻结（本轮 B 项）：动作集合与错误码导出给契约/宿主用，便于断言"哪些动作被冻结"
  // 与"拒绝时用的是哪个 code"（不新增任何 IPC 或动作）。
  ONLINE_WRITE_FROZEN_ACTIONS,
  ONLINE_WRITE_FROZEN_CODE,
  ONLINE_WRITE_FROZEN_MESSAGE,
  ONLINE_ACTION_CAPABILITY,
  ONLINE_ACTION_COMMAND,
  PLC_ONLINE_CAPABILITIES,
  UNSUPPORTED_ONLINE_CAPABILITIES,
  buildProbeScript,
  buildOfflineActionScript,
  buildPersistentOfflineWorkerScript,
  profileFromVersion,
  versionFromExe,
  // 编译结果解析与作业磁盘占用：给契约/运维脚本用（不新增任何 IPC 或动作）。
  parseCompileSummary,
  classifyConsoleLine,
  // T225：诊断明细的合并规则导出给契约用 —— 真机报障（28 条里只显示 8 条）的根因就在这个
  // 函数里，所以它必须能被直接断言，而不是只靠界面上的数字间接证明。
  mergeDiagnosticOccurrences,
  buildCompileResult,
  applyCompileResultToPayload,
  directoryBytes,
};
