'use strict'

// T194 — 自愈：发现并恢复"被隐藏但还活着的插件所属 CODESYS 窗口"。
//
// 真机证据（用户那台机器，2026-10-04）：`hidePluginSurface()` → `suspend('surface-hidden')`
// → `ShowWindowAsync(SW_HIDE)` 之后，审计最后一行是
//   {"event":"suspended","windowId":"0x2D709C4","pid":38816,"reason":"surface-hidden"}
// 而那个 hwnd 仍然活着（rect 288,77,1188x1012 在屏内）。问题在于**没有任何入口能把它拿回来**：
//   · `win-window-monitor.ps1 -Mode list` 只枚举 IsWindowVisible 的窗口 ⇒ 面板枚举、
//     `codesys:current-project` 检测、启动清理（`closeLaunchedCodesysInstances`）都看不见它
//     （清理对它答 `no-window` → keep：既不关也不显示，而紧接着的 `markCleanExit()` 会把
//      这条记录一并抹掉）；
//   · 它被 attach 去掉了 WS_CAPTION 并带上 WS_EX_TOOLWINDOW ⇒ 任务栏与 Alt-Tab 里也没有；
//   · 解释这条状态的 `session.suspended` **只在内存里**（进程内字段，重启即失）。
//
// 这个契约钉住修复后的性质，**用真实窗口**（不是替身）：
//   ① 隐藏（非最小化）的插件所属窗口 → 自愈把它显示出来，且**不抢焦点**（前台窗口不变）；
//   ② 最小化的窗口 → 一个字都不动（IsIconic 是用户自己的状态，用 WS_VISIBLE 位区分 SW_HIDE）；
//   ③ 不属于插件的窗口（PID 不在册 / 进程名不是 CODESYS）→ 不动；
//   ④ 幂等：同一窗口在护栏窗口期内**不再发第二次 ShowWindow**（`recently-revived`），
//      而护栏本身（不是判据）才是原因 —— 换一个护栏为 0 的宿主就能再恢复一次；
//   ⑤ 失败/放弃都给**一行可读原因**，并且真的留下审计事件（不静默）。
//
// 为什么要用"复制成 CODESYS.exe 的 powershell.exe"做夹具：自愈只允许碰"进程名像 CODESYS"的
// 窗口，而本机上真实的 CODESYS 属于用户（绝不能拿它做实验）。复制一份 powershell.exe 并改名为
// CODESYS.exe，就能造出**真实**的 HWND / 进程 / 样式位，且与用户的安装和实例完全无关。
// 夹具脚本见 tests/fixtures/revive-fixture.ps1。
//
// ── 负载敏感性修复（只动测试；被测代码 codesys-native-host.js / win-window-host.ps1 /
//    win-window-monitor.ps1 / main.js **一个字都没动**）─────────────────────────────
//
// 现象：三棵树（dev `.repo-stage` / live `C:\TaskHive\resources\app`）**并行**跑
// `node tests/run-contracts.js` 时，这个契约失败过一次（19944ms，"窗口枚举 / ShowWindow
// 一类"），单独跑每次都过；同批里 dev 与 live 用**字节完全相同**的 main.js 都是 79/79。
//
// 先复现、再定位（全部实测数字）：
//   · 三棵树全量并行 5 轮、6 路并行 6 轮（36 次）、3 路带埋点 1 轮 → 契约全绿：失败是**低概率**的，
//     所以"哪一段薄"必须靠**预算余量 + 握手窗口**去量，而不是靠一次复现。
//   · 脚本调用（-Probe / -Revive / -Mode）实测最长 860ms，生产预算是 15s（17× 余量）；
//     夹具冷启动 0.6–2.5s，旧预算是 40s（>16× 余量）；→ **不是超时**。
//   · `ShowWindowAsync(SW_HIDE)` / `SW_SHOWNA` 的样式位在一个**常驻 3ms 轮询**进程里实测在
//     `-Mode suspend` 进程**返回前 30ms** 就已落下（SW_SHOWNA 同理，-50ms）→ **不是异步落地竞态**。
//   · 150s 里每 100ms 采样 `GetForegroundWindow`：三棵树全量跑的过程中前台窗口**一次都没变**
//     （夹具窗口 ShowInTaskbar=false，`Show()` 不抢前台）→ **不是别的树抢焦点**，那条断言没有竞争。
//   · **病灶在夹具就绪握手**：夹具用 `Set-Content` 写 ready 文件（先创建、写完才关句柄），而
//     `startFixture` 把"路径存在"当成"已就绪"，直接 `fs.readFileSync` + `JSON.parse`。
//     实测（3 路并行、240 次夹具启动）**3 次**读失败：
//       EBUSY: resource busy or locked, open '...readyc-32.json'（该文件当时已经有 212 字节，
//       只是写句柄还没关）、EBUSY（0 字节）、EBUSY（0 字节）；
//     另有 busy-poll 实测：**20/20** 次都能观察到"文件已存在、内容为空"的空窗，宽 1–3ms
//     （轮询周期 120ms ⇒ 每次启动天生有几 % 的概率正好踩进去；并行负载下 AV/磁盘争用会把它拉宽）。
//     6 次夹具启动 / 轮 ⇒ 正好是"偶发"的量级，而且失败点（19944ms ≈ 全程 69%）落在第 4 个夹具
//     （③ 段的 `FOREIGN.exe` / `foreign` 夹具）启动处，与实测分段耗时表吻合。
//
// 修法（每条都不放松断言语义）：
//   ⓐ 就绪 = "文件能**完整读出来**、能解析、关键字段齐"，`EBUSY`/空/半截/JSON 错误都只算
//      "还没好"，在预算内继续轮询；读失败次数进诊断。**这条是真正的修复**（变异检查见下）。
//   ⓑ 预算 40s → 60s：实测 0.6–2.5s，留 ~24× 余量；60s + 其余各段仍 < runner 的 120s 总预算，
//      所以超时由契约自己报出来（带诊断），而不是被 runner 静默杀掉。
//   ⓒ 脚本调用走**注入式 harness**：契约自己给 60s 预算（生产默认 15s 不变），并把实测最大值
//      打进摘要 —— 下次一眼能看出"是环境慢还是代码回归"。
//   ⓓ 跨进程互斥：**只**罩住"读系统前台窗口 → 自愈 → 再读前台窗口"这一段（锁文件在 OS 临时
//      目录，绝不落在被 check-tree-parity 逐字节比较的目录里；形态照 tools/build-client-bundle.js）。
//      这一段是整个契约里**唯一**读系统全局状态的地方（GetForegroundWindow），也是唯一可能被
//      另一棵树"顺手中断"的断言。更粗的锁（连夹具启动和每一组枚举/操作都罩住）实测过并**撤回**：
//      三棵树并行时单次等锁最长 20s（等于上限，只能"未拿到锁照旧跑"），契约从 30s 涨到 61–76s，
//      而它保护的东西并没有被观测到（150s × 100ms 采样里前台窗口一次都没变；枚举按 PID、ShowWindow
//      按 HWND，本来就互不相干）。把 120s 预算的三分之一花在一个没测出收益的锁上，是更差的测试。
//   ⓔ 对**可判定的瞬时**失败做有界重试（共 3 次尝试，退避 250/500ms）：只有"这一轮扫描把期望的
//      那个窗口读成仍可见（style-visible）"**且**独立探活证明"窗口还在、PID 还对、样式位其实已经
//      隐藏"才重试；判据坏了、窗口没了、PID 变了都会立刻原样返回结论 ⇒ 该红还是红（变异检查证明：
//      把"找到候选却永不恢复"注进去，重试跑满 3 次后照样红）。
//   ⓕ 失败时打印：分段耗时表、脚本调用耗时分布（最大/中位/意外失败/预期失败）、锁等待、重试门
//      （每轮的扫描数量 + 独立探活快照）、就绪握手空窗次数、当时的自愈结论与候选数。
//
// ── 「抢焦点」断言的判据加固（T203 同法；**只动测试**，被测代码一个字未动）───────────────
//
// 现象（与上面那条病灶**不同**，MASTER 已另记为已知 flaky）：本契约「恢复显示绝不能抢焦点」
// 那条断言（旧写法 `assert.equal(foregroundAfter, foregroundBefore)`）在**并发负载**下偶发
// 红（真机原文：`AssertionError ... '0x1460C22' - '0x407E4'`），单跑必过，且它不引用多数轮的
// 改动文件。
//
// 先定位（读的是什么 / 比的时点 / 有没有归因判据，全部可查）：
//   · 读的是**系统全局**读数 `GetForegroundWindow` —— 这是整个契约里唯一的全局状态读数；
//   · 比的时点是"我们操作前"与"我们操作后"两个瞬间的**句柄字符串**；
//   · 旧写法**没有**"这次变化是不是我们造成的"这个判据（✗）⇒ 外部程序（另一棵树、另一个
//     应用、用户顺手点一下）恰好在这两个瞬间之间换了前台，红的是**测量**，不是被测代码。
//
// 修法（做**可判定**的判据 + 有界重试 + 可诊断，**不放松语义**）：
//   ⓐ 采样升级成"hwnd + 属主 pid + 进程名 + 标题"（仍是一次 powershell 调用），于是结论分三类，
//      每一类都可判定：`clean`（操作前后**同一个**前台窗口 ⇒ 我们什么都没改变，最强形式）/
//      `stolen`（操作后前台就是**被恢复的那个窗口**，或本测试自己的进程 ⇒ **必须红**）/
//      `external`（变了，但变过去的是**别人的**进程 ⇒ 外部抢的，识别并区分，不判我们抢焦点）。
//   ⓑ 有界重试（最多 3 轮观测、退避 100/200ms、墙钟预算 8s）**只**发生在结论为
//      `external`/`unknown`（可判定的环境性抖动 / 采样读不出来）时；`stolen` **立刻红**，
//      绝不重试掩盖。一次重试 = 一次**全新观测**：新宿主（幂等护栏为空 ⇒ 真的会再发一次
//      ShowWindow）+ 新 root（审计计数不落回 roots.scan ⇒ ④ 那条"ShowWindow 只发生过一次"
//      逐字不变）+ 先把窗口重新隐藏（重试的前提是它又是合规候选）。
//   ⓒ 失败信息（可诊断）：每一轮的前台窗口 id / 属主 pid / 进程名 / **是不是**我们托管或恢复的
//      那个窗口 / 重试次数 / 采样次数 —— 既进 `[自测✗] 前台窗口判据`，也进成功时的摘要行。
//   ⓓ 语义只加强不放松：真行为判据 =「恢复之后，被恢复的那个窗口（以及本测试的任何进程）
//      都不能成为前台」，对**每一次**采样（含确认采样）都成立；拿到 `clean` 观测时**再**钉
//      最强形式"操作前后前台一字不变"。把 SetForegroundWindow 注进恢复路径 ⇒ 两条都红。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')
const { execFile, execFileSync, spawn } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

const root = process.env.TASKHIVE_ROOT || path.join(__dirname, '..')
const appDir = path.join(root, 'app')
const {
  CodesysNativeHost, reviveCandidateDecision, reviveProbeDecision, reviveOutcomeDetail, reviveReasonText, windowStyleVisible,
} = require(path.join(appDir, 'codesys-native-host'))

const hostSource = fs.readFileSync(path.join(appDir, 'codesys-native-host.js'), 'utf8')
const hostPs = fs.readFileSync(path.join(appDir, 'win-window-host.ps1'), 'utf8')
const monitorPs = fs.readFileSync(path.join(appDir, 'win-window-monitor.ps1'), 'utf8')
const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8')
const HOST_PS = path.join(appDir, 'win-window-host.ps1')
const FIXTURE_PS = path.join(__dirname, 'fixtures', 'revive-fixture.ps1')

if (process.platform !== 'win32') {
  process.stdout.write('codesys native host revive contract: skipped (windows only)\n')
  process.exit(0)
}

// ── 诊断：分段耗时 / 脚本调用 / 锁等待 / 重试门 ──────────────────────────────────
// 失败时必须一眼看出"是环境还是回归"，所以这些数字既在成功时打一行摘要，也在失败时全量打出来。
const stageTimings = []
let stageAt = Date.now()
function stage(label) {
  const now = Date.now()
  stageTimings.push({ label, ms: now - stageAt })
  stageAt = now
}
const scriptCalls = []
const lockWaits = []
const retryGates = []
const reviveSnapshots = []
// 前台窗口判据的观测量：每一轮 = 一次"采样 → 恢复显示 → 再采样（+确认采样）"，
// 带结论（clean / stolen / external / unknown）与归属证据。失败时全量打出来。
const focusObservations = []
let foregroundSamplesTaken = 0
let readinessFaultsTotal = 0
let hideSettleRetries = 0

function firstLine(value, limit = 200) {
  const text = String(value?.stderr || value?.message || value || '').replace(/\r/g, '\n')
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const joined = lines.find((line) => !/^Command failed:/i.test(line)) || lines[0] || 'unknown'
  return joined.length > limit ? `${joined.slice(0, limit)}...` : joined
}

function median(sorted) {
  if (!sorted.length) return 0
  return sorted[Math.floor(sorted.length / 2)]
}

function timingSummary(label) {
  const total = stageTimings.reduce((sum, entry) => sum + entry.ms, 0)
  const slowest = [...stageTimings].sort((a, b) => b.ms - a.ms).slice(0, 4)
  const calls = scriptCalls.map((entry) => entry.ms).sort((a, b) => a - b)
  const callMax = calls.length ? calls[calls.length - 1] : 0
  // ⑤a 拿一个**死句柄**去 -Revive，它抛错正是要断言的行为，所以单独计，不混进"意外失败"。
  const failed = scriptCalls.filter((entry) => !entry.ok && entry.expected !== true).length
  const expectedFailed = scriptCalls.filter((entry) => !entry.ok && entry.expected === true).length
  const waited = lockWaits.map((entry) => entry.waitedMs)
  const unlocked = lockWaits.filter((entry) => entry.unlocked).length
  const retried = retryGates.filter((entry) => entry.attempt > 1).length
  const kinds = focusObservations.map((entry) => entry.verdict.kind).join(',') || '(none)'
  return `[自测⏱${label}] 分段合计 ${total}ms；最慢段 ${slowest.map((entry) => `${entry.label}=${entry.ms}ms`).join(' ')}；` +
    `脚本调用 ${scriptCalls.length} 次（最大 ${callMax}ms、中位 ${median(calls)}ms、意外失败 ${failed}、预期失败 ${expectedFailed}，预算 ${SCRIPT_BUDGET_MS}ms）；` +
    `全局窗口锁等待 ${lockWaits.length} 次（最大 ${waited.length ? Math.max(...waited) : 0}ms，未拿到锁照旧跑 ${unlocked} 次）；` +
    `夹具就绪握手空窗 ${readinessFaultsTotal} 次；隐藏落地复核重发 ${hideSettleRetries} 次；有界重试 ${retried} 次；` +
    `前台窗口观测 ${focusObservations.length} 轮（结论 ${kinds}，环境性重试 ${Math.max(0, focusObservations.length - 1)} 次，采样 ${foregroundSamplesTaken} 次）`
}

// 失败时的全量诊断：分段耗时 + 脚本调用倒序 + 锁 + 重试门 + 当时扫描到的候选数。
function failureReport(error, workDir) {
  const lines = []
  lines.push(`[自测✗] 失败：${firstLine(error, 400)}`)
  lines.push(`[自测✗] 分段耗时（ms）：${stageTimings.map((entry) => `${entry.label}=${entry.ms}`).join(' ')}`)
  const calls = [...scriptCalls].sort((a, b) => b.ms - a.ms).slice(0, 10)
  lines.push(`[自测✗] 脚本调用（倒序，最多 10 条）：${calls.map((entry) => `${entry.kind}/${entry.label}${entry.ok ? '' : '!'}=${entry.ms}ms${entry.error ? ` (${entry.error})` : ''}`).join(' ') || '(none)'}`)
  lines.push(`[自测✗] 锁等待：${lockWaits.map((entry) => `${entry.label}=${entry.waitedMs}ms${entry.unlocked ? '(未拿到，照旧跑，持有者 pid=' + entry.holderPid + ' label=' + entry.holderLabel + ')' : ''}`).join(' ') || '(none)'} 锁文件 ${WINDOW_LOCK_PATH}`)
  lines.push(`[自测✗] 重试门（attempt/scanned/独立探活 exists,pid,styleVisible/premise）：${retryGates.map((entry) => `${entry.label}#${entry.attempt} scanned=${entry.scanned} probe=(${entry.probeExists},${entry.probePid},${entry.probeStyleVisible}) premise=${entry.premise}`).join(' ') || '(none)'}`)
  lines.push(`[自测✗] 自愈结论：${reviveSnapshots.map((entry) => `${entry.label}{scanned=${entry.scanned} revived=${entry.revived} skipped=${entry.skipped} failed=${entry.failed} detail=${entry.detail}}`).join(' ') || '(none)'}`)
  // 前台窗口判据：每一轮的 before/after（hwnd / 属主 pid / 进程名 / 是不是我们托管或恢复的
  // 那个窗口）+ 结论 + 重试次数。这一行就是"红的是环境还是回归"的判据本身。
  lines.push(`[自测✗] 前台窗口判据：采样 ${foregroundSamplesTaken} 次；观测 ${focusObservations.length} 轮（环境性重试 ${Math.max(0, focusObservations.length - 1)} 次）；${foregroundJudgeLine(focusObservations)}`)
  lines.push(`[自测✗] 夹具：已启动 ${children.length} 个（pid ${children.map((child) => child.pid).join(',')}）工作目录 ${workDir}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

// ── 全局窗口操作的跨进程互斥（锁文件必须在 OS 临时目录）─────────────────────────
// 只用在**读系统前台窗口**这一段（stage-1-revive）：它是整个契约里唯一的全局读数，
// 也是唯一可能被另一棵树的中断改写的断言。其余枚举/操作都按 PID 或 HWND 定域，不共享状态。
// 更粗的锁实测过并撤回（三棵树并行时单次等锁 20s 顶格、契约 30s→61–76s，且没测出它保护了什么）。
// 锁文件绝不能落在被 tools/check-tree-parity.js 逐字节比较的目录里，所以放 os.tmpdir()
// （形态照 tools/build-client-bundle.js：wx 独占创建 + 体内带 pid/host/atMs，死掉的持有者按
// "活着吗"+"多久了"两级判据回收）。等不到锁就**照旧跑**并在诊断里记一笔：锁是加固，
// 绝不能反过来变成"比原来更慢的超时失败"。
const WINDOW_LOCK_PATH = path.join(os.tmpdir(), 'taskhive-window-ops.lock')
const WINDOW_LOCK_STALE_MS = 5000
const WINDOW_LOCK_WAIT_MS = 20000
let windowLockDepth = 0
let windowLockOwned = false

function hostKey(value) {
  return String(value || '').trim().toLowerCase()
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return Boolean(error && error.code === 'EPERM') }
}

function readLockBody() {
  try { return JSON.parse(fs.readFileSync(WINDOW_LOCK_PATH, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

// 尽力而为的互斥：拿不到锁（有人拿着超过 20s）**不再等**，照旧跑并把这件事记进诊断。
// 理由：锁是加固，不是修复。为了它把一个"偶发失败"换成"三棵树里最后一个必然超时"更糟。
function acquireWindowLock(label) {
  if (windowLockDepth > 0) { windowLockDepth += 1; return }
  const startedAt = Date.now()
  for (;;) {
    try {
      const fd = fs.openSync(WINDOW_LOCK_PATH, 'wx')
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), atMs: Date.now(), label }))
      fs.closeSync(fd)
      windowLockDepth = 1
      windowLockOwned = true
      const waitedMs = Date.now() - startedAt
      if (waitedMs > 50) lockWaits.push({ label, waitedMs, unlocked: false })
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const held = readLockBody()
      const atMs = Number(held && held.atMs)
      const ageMs = Number.isFinite(atMs) && atMs > 0
        ? Date.now() - atMs
        : (() => { try { return Date.now() - fs.statSync(WINDOW_LOCK_PATH).mtimeMs } catch { return Infinity } })()
      const sameHost = Boolean(held) && hostKey(held.host) === hostKey(os.hostname())
      const alive = sameHost && processAlive(held && held.pid)
      // 死掉的持有者 + 这把锁已经旧到不可能是"正在创建"（或者干脆读不出来且够旧）⇒ 收回。
      if (!alive && ageMs > WINDOW_LOCK_STALE_MS) {
        try { fs.unlinkSync(WINDOW_LOCK_PATH) } catch { /* 另一个实例先收回了 */ }
        continue
      }
      if (Date.now() - startedAt > WINDOW_LOCK_WAIT_MS) {
        lockWaits.push({ label, waitedMs: Date.now() - startedAt, unlocked: true, holderPid: held && held.pid, holderLabel: held && held.label })
        windowLockDepth = 1
        windowLockOwned = false
        return
      }
      sleepSync(100)
    }
  }
}

function releaseWindowLock() {
  if (windowLockDepth > 1) { windowLockDepth -= 1; return }
  windowLockDepth = 0
  if (!windowLockOwned) return
  windowLockOwned = false
  try {
    const held = readLockBody()
    if (held && held.pid === process.pid) fs.unlinkSync(WINDOW_LOCK_PATH)
  } catch { /* 删不掉就靠下一代按"死掉的持有者 + 旧"回收 */ }
}

async function withWindowLock(label, operation) {
  acquireWindowLock(label)
  try {
    return await operation()
  } finally {
    releaseWindowLock()
  }
}

// ── 脚本调用：注入式 harness ────────────────────────────────────────────────────
// 生产里 codesys-native-host.js 给每次脚本调用 15s。三棵树并行时冷启动会抖，契约自己给 60s，
// **生产默认一个字都不改**（这个契约不钉超时策略，只钉自愈语义：真失败照样抛、照样红）。
const SCRIPT_BUDGET_MS = 60000
const SCRIPT_HARNESS = 'contract-script-harness'

function scriptKind(args) {
  if (args.includes('-Revive')) return 'revive'
  if (args.includes('-Probe')) return 'probe'
  const modeAt = args.indexOf('-Mode')
  if (modeAt >= 0) return `mode:${args[modeAt + 1]}`
  if (args.includes('-IncludeHidden')) return 'scan'
  return 'other'
}

function scriptRunner(label) {
  return async (file, args, options = {}) => {
    const startedAt = Date.now()
    const kind = scriptKind(args)
    // ⑤a 的死句柄：这次调用的失败是被断言的**预期行为**（notifications 里不该被读成环境问题）。
    const expected = label === 'deadHost' && kind === 'revive'
    try {
      const result = await execFileAsync(file, args, { ...options, timeout: SCRIPT_BUDGET_MS })
      scriptCalls.push({ label, kind, ms: Date.now() - startedAt, ok: true, expected })
      return result
    } catch (error) {
      scriptCalls.push({ label, kind, ms: Date.now() - startedAt, ok: false, expected, error: firstLine(error, 120) })
      throw error
    }
  }
}

// ── 有界重试：只对**可判定的瞬时**失败 ──────────────────────────────────────────
// 触发条件必须同时成立：
//   ① 这一轮自愈没有任何动作（revived=0、failed=0），而且
//   ② 结论里**点名了期望的那个窗口**、原因是 `style-visible` —— 也就是"这一轮扫描读到的还是
//      可见的"。注意 `scanned=0` **不**触发重试：枚举返回空有正当原因（进程名不是 CODESYS、
//      窗口本来就不该出现），拿它当瞬时失败就会把"过滤器正常工作"重试成噪音；而且
//   ③ 独立探活（-Probe，与自愈判据无关的另一条路，而且**比那一轮扫描更新**）证明：窗口还在、
//      PID 还是它、样式位**已经**隐藏 ⇒ 那一轮扫描读到的是过期状态，值得再看一遍。
// ③ 不成立就立刻原样返回（窗口没了 / PID 变了 / 它其实可见 = 前提不成立，重试只会掩盖真话）。
// 判据本身坏了（变异检查那一种）会让每一轮都得出同样的结论 ⇒ 重试完照样红。
const SCAN_RETRY_ATTEMPTS = 3
const SCAN_RETRY_BACKOFF_MS = 250

function staleVisibleRead(outcome, windowId) {
  const wanted = String(windowId).toUpperCase()
  return (outcome.skipped || []).some((entry) => entry.reason === 'style-visible' && String(entry.windowId || wanted).toUpperCase() === wanted)
}

async function reviveWithRetry(host, reason, options, expect, label) {
  for (let attempt = 1; attempt <= SCAN_RETRY_ATTEMPTS; attempt += 1) {
    // 不在这里加锁：需要互斥的调用点（读前台窗口那一段）自己在外层持锁，重入计数会把它变成空操作。
    const outcome = await host.revivePluginOwnedHiddenWindows(reason, options)
    reviveSnapshots.push({ label, scanned: outcome.scanned, revived: outcome.revived.length, skipped: outcome.skipped.map((entry) => entry.reason).join('|') || '-', failed: outcome.failed.length, detail: String(outcome.detail || '').slice(0, 160) })
    if (outcome.revived.length || outcome.failed.length) return { outcome, attempt }
    if (!staleVisibleRead(outcome, expect.windowId)) return { outcome, attempt }
    const probe = await host.probeWindow(expect.windowId, expect.pid)
    const premise = Boolean(probe) && probe.exists === true && Number(probe.pid) === Number(expect.pid) && windowStyleVisible(probe.style) === false
    retryGates.push({ label, attempt, scanned: outcome.scanned, probeExists: probe && probe.exists, probePid: probe && probe.pid, probeStyleVisible: windowStyleVisible(probe && probe.style), premise })
    if (!premise || attempt === SCAN_RETRY_ATTEMPTS) return { outcome, attempt }
    sleepSync(SCAN_RETRY_BACKOFF_MS * attempt)
  }
  throw new Error(`unreachable: reviveWithRetry(${label})`)
}

// ── 0. 静态不变量：脚本侧与主进程侧的新增入口 ───────────────────────────────────
assert.ok(!/[^\x00-\x7F]/.test(hostPs), 'win-window-host.ps1 必须整体是 ASCII（无 BOM 时非 ASCII 注释会破坏 PS 5.1 解析）')
assert.ok(!/[^\x00-\x7F]/.test(monitorPs), 'win-window-monitor.ps1 必须整体是 ASCII（同上）')
assert.ok(hostPs.includes('[switch]$Revive'), 'win-window-host.ps1 必须提供 -Revive 开关（不占用被契约钉住的 -Mode ValidateSet）')
assert.ok(hostPs.includes("mode = 'revive'"), 'revive 应答必须自带 mode 标记')
assert.ok(hostPs.includes('[void][TaskHiveNativeHost]::ShowWindowAsync($handle, $SW_SHOWNA)'), 'revive 必须用 SW_SHOWNA（显示但不激活）')
assert.ok(hostPs.includes('$SWP_NOACTIVATE -bor $SWP_SHOWWINDOW'), 'revive 的 SetWindowPos 必须带 SWP_NOACTIVATE')
assert.ok(!hostPs.includes('SetForegroundWindow'), 'revive 绝不许抢焦点：整个脚本不许出现 SetForegroundWindow')
assert.ok(hostPs.includes("if ($iconicBefore) {\n    $reason = 'window-minimized'"), '最小化窗口必须在 revive 里被拒（真实原因写进应答）')
assert.ok(hostPs.includes("ValidateSet('attach', 'move', 'suspend', 'resume', 'detach')"), 'Mode 的 ValidateSet 不得改变（契约钉住）')
// 隐藏枚举：只对调用方给的 PID 开放，且监控脚本**只读**。
assert.ok(monitorPs.includes('[switch]$IncludeHidden') && monitorPs.includes("ValidateSet('list')"), '监控脚本必须保留 list 模式并新增 -IncludeHidden 开关')
assert.ok(monitorPs.includes('[string]$PluginPids'), '隐藏枚举必须有 PID 白名单参数（不叫 -ExpectedPid：那个名字被契约禁止出现在这个脚本里）')
assert.ok(!monitorPs.includes('-ExpectedPid'), 'win-window-monitor.ps1 不许出现 -ExpectedPid（codesys-window-fit-contract 钉住）')
assert.ok(!monitorPs.includes('SetWindowPos'), 'win-window-monitor.ps1 必须是只读的（不许出现 SetWindowPos）')
assert.ok(monitorPs.includes('if ($hiddenPids.Count -eq 0) { exit 0 }'), '没有 PID 白名单时必须什么都不枚举')
for (const event of ['native-host-revive-suspended', 'native-host-revive-skipped', 'native-host-revive-failed', 'native-host-revive-scan', 'native-host-suspend-after-resume']) {
  assert.ok(hostSource.includes(`'${event}'`), `自愈必须留下审计事件：${event}`)
}
assert.ok(hostSource.includes("path.join(this.root, 'logs', 'codesys-native-session.json')"), '挂起状态必须落到跨进程的会话记录里（内存里的 session.suspended 重启即失）')
for (const call of ["persistSession({ windowId: session.window.id, pid: session.window.pid, bounds: session.bounds, suspended: true, reason })", 'noteSurfaceCause']) {
  assert.ok(hostSource.includes(call), `托管层必须提供：${call}`)
}
assert.ok(mainSource.includes("codesysNativeHost?.suspend('surface-hidden')"), '既有的挂起调用点仍是契约钉住的字面量')
// 启动那次自愈：钉**调用点在场**，故意不把参数表写进 needle（历史写法 `...Revive('startup')`，
// 当前修订是 `...Revive('startup', { force: true, ... })` 并在注释里写明自愈必须排在 sweep 之后）。
// needle 以 `'startup'` 结尾、不带右括号，两种写法都算通过 —— 这条断言要证明的是"启动时会跑一次
// 自愈"，**少一次调用**才是回归；把参数表钉死只会让正当的实现改动变成一次假红。
assert.ok(mainSource.includes("scheduleCodesysNativeRevive('startup'"), '启动时必须跑一次自愈')
assert.ok(mainSource.includes("scheduleCodesysNativeRevive('detection')") && mainSource.includes("scheduleCodesysNativeRevive('list-windows')"), '检测链上必须跑自愈（否则隐藏窗口永远不会被发现）')
assert.ok(mainSource.includes("auditPluginSurface('hidden'") && mainSource.includes("auditPluginSurface('shown'"), 'surface 切换必须写归属审计')
assert.ok(mainSource.includes("noteSurfaceCause?.({ kind: previousKind, trigger })"), '触发来源必须交给原生托管层写进那行 suspended')

// ── 判据是纯函数：先把它钉住，真实窗口那部分才说得清"为什么没动" ────────────────────
const codesysItem = (over = {}) => ({ id: '0x1', pid: 42, processName: 'CODESYS', title: 'p.project - CODESYS', width: 900, height: 700, styleVisible: false, iconic: false, ...over })
assert.deepEqual(reviveCandidateDecision(codesysItem(), { allowedPids: new Set([42]) }), { eligible: true, reason: '' })
assert.equal(reviveCandidateDecision(codesysItem(), { allowedPids: new Set([7]) }).reason, 'not-plugin-launched-pid', '别人的 PID 不在册就不许碰')
assert.equal(reviveCandidateDecision(codesysItem({ processName: 'notepad' }), { allowedPids: new Set([42]) }).reason, 'not-codesys-process')
assert.equal(reviveCandidateDecision(codesysItem({ iconic: true, styleVisible: true }), { allowedPids: new Set([42]) }).reason, 'window-minimized', '最小化 ≠ 被 SW_HIDE')
assert.equal(reviveCandidateDecision(codesysItem({ styleVisible: true }), { allowedPids: new Set([42]) }).reason, 'style-visible')
assert.equal(reviveCandidateDecision(codesysItem({ title: 'Default IME', width: 0, height: 0 }), { allowedPids: new Set([42]) }).reason, 'window-frame-too-small')
assert.equal(reviveCandidateDecision(codesysItem({ title: '.NET-BroadcastEventWindow.4.0.0.0.1.0' }), { allowedPids: new Set([42]) }).reason, 'title-not-codesys-main-window')
assert.equal(reviveCandidateDecision(codesysItem(), { allowedPids: new Set([42]), excludedWindowIds: new Set(['0X1']) }).reason, 'session-suspended-by-surface', '当前 surface 主动挂起的那个自己不是候选')
assert.equal(reviveProbeDecision({ mode: 'probe', exists: true, pid: 42, style: 0x10000000, iconic: false, rect: { width: 900, height: 700 } }, { expectedPid: 42 }).reason, 'style-visible')
assert.equal(reviveProbeDecision({ mode: 'probe', exists: false }, { expectedPid: 42 }).reason, 'window-gone')
assert.equal(reviveProbeDecision({ mode: 'probe', exists: true, pid: 7, style: 0, iconic: false, rect: { width: 900, height: 700 } }, { expectedPid: 42 }).reason, 'pid-mismatch')
assert.equal(reviveProbeDecision({ mode: 'probe', exists: true, pid: 42, style: 0, iconic: true, rect: { width: 900, height: 700 } }, { expectedPid: 42 }).reason, 'window-minimized')
assert.deepEqual(reviveProbeDecision({ mode: 'probe', exists: true, pid: 42, style: 0, iconic: false, processName: 'CODESYS', rect: { width: 900, height: 700 } }, { expectedPid: 42 }), { eligible: true, reason: '', processVerified: true })
assert.equal(windowStyleVisible(0x10000000), true)
assert.equal(windowStyleVisible(0x16000000), true)
assert.equal(windowStyleVisible(0x06000000), false)
assert.ok(reviveReasonText('ambiguous-candidates').includes('放弃'), '每个原因都要有一句人话')
const oneLine = reviveOutcomeDetail({ attempted: true, scanned: 3, revived: [], skipped: [{ windowId: '0x2', reason: 'window-minimized' }], failed: [] })
assert.ok(oneLine.length > 0 && !oneLine.includes('\n'), '结论必须是一行')

// ── 真实窗口 ──────────────────────────────────────────────────────────────────
const workDir = createTempDir('taskhive-revive-')
const fixtureDir = path.join(workDir, 'fixture')
fs.mkdirSync(fixtureDir, { recursive: true })
const powershellExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const codesysExe = path.join(fixtureDir, 'CODESYS.exe')
// 名字必须 ≤15 字符：Windows 的原生镜像名被截断到 15 字符，实测 >15 的副本
// （REVIVE-NOT-CODESYS.exe）启动会**不稳定**（真机上一次 20 秒都没起来），
// 于是夹具就成了"测试自己的问题"，而不是被测代码的问题。
const otherExe = path.join(fixtureDir, 'FOREIGN.exe')
fs.copyFileSync(powershellExe, codesysExe)
fs.copyFileSync(powershellExe, otherExe)

const children = []
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

// 就绪握手：**原子性**才是要害。
// 夹具用 `Set-Content -LiteralPath $ReadyFile` 写快照 —— 那是"先创建/截断，写完才关句柄"，
// 所以"路径存在"和"内容可读"是两个时刻。旧代码只判 `fs.existsSync` 就 `readFileSync`+`JSON.parse`，
// 实测在 3 路并行下 240 次启动里有 3 次读到 EBUSY（其中一次文件里已经有 212 字节、只是句柄没关），
// busy-poll 还每次都看到 1–3ms 的"存在但为空"空窗 —— 三棵树并行时的偶发失败就在这里。
// 现在：读失败/空/半截/JSON 错都只算"还没好"，在预算内继续轮询；只有**完整且字段齐**的快照才算就绪。
const READY_DEADLINE_MS = 60000
const READY_POLL_MS = 120

function readReadySnapshot(readyPath) {
  let body
  try {
    body = fs.readFileSync(readyPath, 'utf8')
  } catch (error) {
    // 文件**还不存在**是轮询的正常中间态，不算握手故障。
    if (error.code === 'ENOENT') return { ok: false, fault: null }
    // EBUSY/EPERM/EACCES：文件已经存在、但写句柄还没关（Set-Content 先建后写）—— 这才是实测到
    // 的那条竞态窗口，必须记进诊断。
    return { ok: false, fault: `${error.code || 'READ'} ${firstLine(error, 80)}` }
  }
  const text = body.replace(/^\uFEFF/, '').trim()
  if (!text) return { ok: false, fault: 'empty' }
  let info = null
  try { info = JSON.parse(text) } catch (error) { return { ok: false, fault: `json ${firstLine(error, 80)}` } }
  const complete = info && typeof info.handle === 'string' && info.handle.length > 0 &&
    Number.isSafeInteger(Number(info.pid)) && Number(info.pid) > 0 &&
    typeof info.styleVisible === 'boolean' && typeof info.iconic === 'boolean' && typeof info.visible === 'boolean'
  if (!complete) return { ok: false, fault: `incomplete ${text.slice(0, 80)}` }
  return { ok: true, info }
}

function startFixture(exe, state, title = 'CODESYS TaskHive Revive Fixture') {
  const ready = path.join(workDir, `ready-${state}-${children.length}.json`)
  const child = spawn(exe, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FIXTURE_PS, '-State', state, '-Title', title, '-ReadyFile', ready], { stdio: 'ignore', windowsHide: true })
  children.push(child)
  // 注意：等就绪的循环是**同步**的（sleepSync），所以 'exit' 事件在这个循环里永远不会被投递。
  // 判活只能用系统调用（process.kill(pid,0)），不能靠 child.exitCode —— 否则诊断里永远是空字符串。
  const alive = () => { try { process.kill(Number(child.pid), 0); return true } catch { return false } }
  const deadline = Date.now() + READY_DEADLINE_MS
  const faults = []
  let info = null
  let readyMs = 0
  const startedAt = Date.now()
  while (Date.now() < deadline) {
    const snapshot = readReadySnapshot(ready)
    if (snapshot.ok) { info = snapshot.info; readyMs = Date.now() - startedAt; break }
    if (snapshot.fault) faults.push(snapshot.fault)
    if (!alive()) break // 夹具自己没了：再等下去只会把真原因埋掉
    sleepSync(READY_POLL_MS)
  }
  readinessFaultsTotal += faults.length
  if (!info) {
    throw new Error(`夹具窗口没有就绪（state=${state} exe=${path.basename(exe)} 活着=${alive()} 就绪文件读故障 ${faults.length} 次${faults.length ? `：${faults.slice(0, 3).join(' / ')}` : ''} ready=${ready}）`)
  }
  return { child, info, faults: faults.length, readyMs }
}

const stillRunning = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

// ── 前台窗口采样：把"我们是否抢焦点"做成**可判定**的判据 ──────────────────────────
// 旧写法只比两个瞬间的**句柄字符串**（`foregroundAfter === foregroundBefore`）：系统前台窗口
// 是**全局**读数，没有"这次变化是不是我们造成的"这个判据，于是外部程序（另一棵树、另一个
// 应用、用户顺手点一下）在这两个瞬间之间换了前台时，红的是**测量**而不是被测代码。
// 现在一次调用同时取 hwnd + 属主 pid + 进程名 + 标题，三种结论都可判定：
//   clean    操作前后是**同一个**前台窗口      ⇒ 我们什么都没改变（最强）
//   stolen   操作后前台是**被恢复的那个窗口**  ⇒ 我们抢了焦点，**必须红**
//             （或落到本测试自己的进程上，同上）
//   external 变了，但变过去的是**别人的**进程  ⇒ 外部抢的，不是我们干的（识别并区分）
// 采样本身读不出来 ⇒ unknown：这是"关键前提不确定"，属于可判定的环境性抖动，值得有界重试。
const FOREGROUND_SAMPLE_SCRIPT = [
  'Add-Type -Namespace Th -Name FgSampler -MemberDefinition \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);\'',
  '$h = [Th.FgSampler]::GetForegroundWindow()',
  // 注意：变量名不能用 $pid —— PowerShell 的 $PID 是只读的自动变量（当前进程 id）。
  '$owner = [uint32]0',
  '[void][Th.FgSampler]::GetWindowThreadProcessId($h, [ref]$owner)',
  "$name = ''",
  "$title = ''",
  'try { $p = Get-Process -Id ([int]$owner) -ErrorAction Stop; $name = $p.ProcessName; $title = [string]$p.MainWindowTitle } catch { }',
  "[pscustomobject]@{ hwnd = ('0x{0:X}' -f $h.ToInt64()); pid = [int]$owner; process = $name; title = $title } | ConvertTo-Json -Compress",
].join('\n')

function foregroundSample(label) {
  foregroundSamplesTaken += 1
  const startedAt = Date.now()
  let raw = ''
  try {
    raw = String(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', FOREGROUND_SAMPLE_SCRIPT], { encoding: 'utf8' })).replace(/^\uFEFF/, '').trim()
  } catch (error) {
    return { label, ok: false, hwnd: '', pid: 0, process: '', title: '', error: firstLine(error, 120), ms: Date.now() - startedAt }
  }
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { label, ok: false, hwnd: '', pid: 0, process: '', title: '', error: `json ${firstLine(error, 80)} raw=${raw.slice(0, 40)}`, ms: Date.now() - startedAt }
  }
  const hwnd = String(parsed && parsed.hwnd ? parsed.hwnd : '').toUpperCase()
  const pid = Number(parsed && parsed.pid)
  return {
    label,
    ok: hwnd.length > 0,
    hwnd,
    pid: Number.isSafeInteger(pid) && pid > 0 ? pid : 0,
    process: String((parsed && parsed.process) || ''),
    title: String((parsed && parsed.title) || ''),
    ms: Date.now() - startedAt,
    error: hwnd.length > 0 ? '' : `缺少 hwnd（原始：${raw.slice(0, 40)}）`,
  }
}

// 本测试自己的进程集合：全部夹具（CODESYS.exe / FOREIGN.exe 的副本）＋本进程。
// 前台一旦落到这里面 = "被恢复/托管的窗口（或我们自己的窗口）被抢到了前台" ⇒ 必须红。
function ourProcessPids() {
  const pids = new Set([Number(process.pid)])
  for (const child of children) {
    const pid = Number(child.pid)
    if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid)
  }
  return pids
}

// null = 采样读不出来（不确定，不是"没抢"）；true/false = 可判定。
function foregroundIsOurs(sample, target) {
  if (!sample || sample.ok !== true) return null
  if (!sample.hwnd || sample.hwnd === '0X0') return false
  if (target && sample.hwnd === String(target.windowId).toUpperCase()) return true
  if (target && Number(sample.pid) > 0 && Number(sample.pid) === Number(target.pid)) return true
  return ourProcessPids().has(Number(sample.pid))
}

function foregroundSampleText(sample) {
  if (!sample) return '(none)'
  if (sample.ok !== true) return `read-failed(${firstLine(sample.error || 'unknown', 60)})`
  return `${sample.hwnd}/pid${sample.pid}/${sample.process || '?'}`
}

// 判据本身：**stolen 的定义**就是"操作后前台变成了我们托管/恢复的那个窗口（或本测试的进程）"。
// 它与外部污染无关（外部程序换前台时它照样为假），所以真抢焦点时必然红（变异检查见文件头）。
function classifyForeground(before, after, target) {
  if (!before || before.ok !== true || !after || after.ok !== true) {
    return { kind: 'unknown', why: `前台采样读不出来（before=${foregroundSampleText(before)} after=${foregroundSampleText(after)}）` }
  }
  if (after.hwnd === String(target.windowId).toUpperCase()) {
    return { kind: 'stolen', why: `操作后前台就是**被恢复的那个窗口** ${after.hwnd}（pid ${after.pid} ${after.process || '?'}）` }
  }
  if (foregroundIsOurs(after, target) === true) {
    return { kind: 'stolen', why: `操作后前台落到本测试自己的进程上：${foregroundSampleText(after)}` }
  }
  if (after.hwnd === before.hwnd) {
    return { kind: 'clean', why: `操作前后同为 ${foregroundSampleText(after)} —— 我们的操作没有改变前台` }
  }
  return { kind: 'external', why: `操作前 ${foregroundSampleText(before)} → 操作后 ${foregroundSampleText(after)}；pid ${after.pid} 不在本测试的进程集合里 ⇒ 外部程序抢的，不是我们干的` }
}

// 失败诊断用的判据行：每一轮打印 before/after 的 hwnd / 属主 pid / 进程名 / **是不是我们的窗口**。
function foregroundJudgeLine(observations) {
  if (!observations || !observations.length) return '(none)'
  return observations.map((entry) => `#${entry.attempt}[${entry.verdict.kind}] before=${foregroundSampleText(entry.before)} after=${foregroundSampleText(entry.after)}` +
    ` target=${entry.target ? entry.target.windowId : '-'} after-is-ours=${entry.after ? foregroundIsOurs(entry.after, entry.target) : 'n/a'} confirmations=${(entry.confirmations || []).map(foregroundSampleText).join('|') || '-'}` +
    ` ms=${entry.before ? entry.before.ms : '-'}/${entry.after ? entry.after.ms : '-'} why=${entry.verdict.why}`).join(' ｜ ')
}

// ── 判据是纯函数：把"外部污染"与"真抢焦点"的**区分**逐条钉死 ──────────────────────
// 真实窗口那一段里，外部污染是**低概率**事件（T203 实测 150s × 100ms 采样里前台一次都没变），
// 所以"识别并区分"不能靠运气证明 —— 在这里确定性地钉住四种结论，外加归属函数的三态。
// 这四条也正是重试边界：只有 external / unknown 才允许再观测一轮，stolen 必须立刻红。
const fgSample = (over = {}) => ({ label: 'synthetic', ok: true, hwnd: '0X1', pid: 111, process: 'explorer', title: '', ms: 1, ...over })
const fgTarget = { windowId: '0x2', pid: 2222 }
assert.equal(classifyForeground(fgSample({ hwnd: '0X1', pid: 111 }), fgSample({ hwnd: '0X1', pid: 111 }), fgTarget).kind, 'clean',
  '操作前后是同一个前台窗口 ⇒ clean（不管那个窗口是谁的：我们什么都没改变）')
assert.equal(classifyForeground(fgSample({ hwnd: '0X1', pid: 111 }), fgSample({ hwnd: '0X3', pid: 333, process: 'explorer' }), fgTarget).kind, 'external',
  '变了、但变过去的是别人的进程 ⇒ external（**识别并区分**：外部程序抢的不算我们抢焦点）')
assert.equal(classifyForeground(fgSample({ hwnd: '0X1', pid: 111 }), fgSample({ hwnd: '0X2', pid: 2222, process: 'CODESYS' }), fgTarget).kind, 'stolen',
  '操作后前台就是**被恢复的那个窗口** ⇒ stolen（我们抢了焦点，必须红）')
assert.equal(classifyForeground(fgSample({ hwnd: '0X1', pid: 111 }), fgSample({ hwnd: '0X9', pid: Number(process.pid), process: 'node' }), fgTarget).kind, 'stolen',
  '变到本测试自己的另一个进程/句柄上同样是 stolen（不能靠"句柄不同"蒙混过关）')
assert.equal(classifyForeground(fgSample({ hwnd: '0X1', pid: 111 }), { label: 'synthetic', ok: false, hwnd: '', pid: 0, process: '', title: '', error: 'boom', ms: 1 }, fgTarget).kind, 'unknown',
  '操作后采样读不出来 ⇒ unknown（前提不确定 ⇒ 属于可判定的环境性抖动，值得有界重试，但绝不当作"通过"）')
assert.equal(classifyForeground({ label: 'synthetic', ok: false, hwnd: '', pid: 0, process: '', title: '', error: 'boom', ms: 1 }, fgSample(), fgTarget).kind, 'unknown',
  '基线采样读不出来同样是不确定')
assert.equal(foregroundIsOurs({ label: 'synthetic', ok: false, hwnd: '', pid: 0 }, fgTarget), null, '读不出来的采样：归属**未知**（null，绝不当作"不是我们的"）')
assert.equal(foregroundIsOurs(fgSample({ hwnd: '0X3', pid: 333 }), fgTarget), false, '别人的窗口不是我们的')
assert.equal(foregroundIsOurs(fgSample({ hwnd: '0X2', pid: 2222 }), fgTarget), true, '被恢复的那个句柄就是我们的')
assert.equal(foregroundIsOurs(fgSample({ hwnd: '0X9', pid: Number(process.pid) }), fgTarget), true, '本测试自己的进程也是我们的')

function externalHide(windowId, pid) {
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOST_PS, '-Mode', 'suspend', '-WindowId', windowId, '-ExpectedPid', String(pid)], { encoding: 'utf8' })
}

// 外部挂起是异步动作（脚本里就是 ShowWindowAsync(SW_HIDE)）：**有界**复核，不假设它立刻落地。
// 实测在这台机器上样式位在挂起进程返回前 ~30ms 就已落下，所以这条路正常情况下一次都不重试；
// 它存在只是为了让"还没落地"不会被当成"没生效"。
const HIDE_SETTLE_ATTEMPTS = 3
const HIDE_SETTLE_BACKOFF_MS = 250

async function hideThenSettle(host, windowId, pid, label) {
  externalHide(windowId, pid)
  let probe = await host.probeWindow(windowId, pid)
  for (let attempt = 1; attempt <= HIDE_SETTLE_ATTEMPTS && windowStyleVisible(probe && probe.style); attempt += 1) {
    hideSettleRetries += 1
    sleepSync(HIDE_SETTLE_BACKOFF_MS)
    externalHide(windowId, pid)
    probe = await host.probeWindow(windowId, pid)
    scriptCalls.push({ label: `${label}:hide-settle-retry`, kind: 'settle', ms: 0, ok: true })
  }
  return probe
}

const readAudit = (workRoot) => {
  const file = path.join(workRoot, 'logs', 'codesys-native-host-audit.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}
const countEvents = (workRoot, event) => readAudit(workRoot).filter((entry) => entry.event === event).length

const stubMonitor = { async listWindows() { return [] }, cachedWindow() { return null } }

// ── 抖动测量（离线替身，不起 PowerShell、不碰真实窗口）──────────────────────────
// 真机审计里 resume→suspend 的间隔是 710ms / 743ms，所以判据钉在 1s；策略是"照做 + 记录"
// （理由写在 native-host-suspend-after-resume 的 why 字段里，可读可查）。
async function flapChecks() {
  const flapRoot = path.join(workDir, 'flap')
  fs.mkdirSync(path.join(flapRoot, 'logs'), { recursive: true })
  const fixture = { id: '0xAAA1', pid: 4242, processName: 'codesys', title: 'CODESYS', width: 900, height: 700, usable: true, fixture: true, pluginOwned: true }
  const bounds = { x: 10, y: 20, width: 800, height: 600 }
  const runProcess = async (_file, args) => {
    if (args.includes('-Probe')) return { stdout: JSON.stringify({ ok: true, mode: 'probe', exists: true, pid: 4242, style: 0x16000000, visible: true, iconic: false, processName: 'CODESYS', title: 'p - CODESYS', rect: bounds }) }
    if (args.includes('attach')) return { stdout: JSON.stringify({ ok: true, mode: 'owned-native-dock', identityVerified: true, styleCaptured: true, dpiAwareness: 2, coordinateSpace: 'physical', hostWindowId: '0x100B0E', actualOwner: '0x100B0E', actualExStyle: 65664, taskbarHidden: true, actualBounds: { ...bounds }, restore: { style: 0x16CF0000, originalExStyle: 0x50100, owner: '0x0', left: 0, top: 0, width: 900, height: 700 } }) }
    return { stdout: JSON.stringify({ ok: true, identityVerified: true, dpiAwareness: 2, coordinateSpace: 'physical' }) }
  }
  const host = new CodesysNativeHost(flapRoot, { async listWindows() { return [fixture] }, cachedWindow() { return fixture } }, { runProcess, watchdogIntervalMs: 100000 })
  const hostWindow = { isDestroyed: () => false, getNativeWindowHandle: () => Buffer.from([0x0e, 0x0b, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00]) }
  await host.attach('0xAAA1', bounds, hostWindow)
  await host.suspend('surface-hidden')
  assert.equal(readAudit(flapRoot).filter((entry) => entry.event === 'native-host-suspend-after-resume').length, 0, '第一次挂起前面没有 resume，不该算抖动')
  await host.resume(bounds)
  host.noteSurfaceCause({ kind: 'codesys', trigger: 'surface:open:chat' })
  await host.suspend('surface-hidden')
  const flaps = readAudit(flapRoot).filter((entry) => entry.event === 'native-host-suspend-after-resume')
  assert.equal(flaps.length, 1, 'resume 后 1 秒内的 suspend 必须留下一条可数记录')
  assert.ok(Number(flaps[0].resumeToSuspendMs) >= 0 && Number(flaps[0].resumeToSuspendMs) < 1000, `抖动间隔必须记下来：${flaps[0].resumeToSuspendMs}`)
  assert.equal(flaps[0].policy, 'suspend-performed', '策略要写清楚：终态自洽，所以照做 + 记录（不静默抑制）')
  assert.ok(String(flaps[0].why).length > 40, '策略必须带理由（why）')
  // 第 2 项：suspended 那一行自己就带触发来源。
  const suspendedLine = readAudit(flapRoot).filter((entry) => entry.event === 'suspended').pop()
  assert.equal(suspendedLine.pluginSurfaceKind, 'codesys', 'suspended 行必须写清当时的 pluginSurfaceKind')
  assert.equal(suspendedLine.surfaceTrigger, 'surface:open:chat', 'suspended 行必须写清触发来源（surface:open 的值）')
  assert.equal(suspendedLine.flap, true, '抖动也在 suspended 行上标出来')
  assert.equal(host.status().revive.flips, 1, '抖动次数必须能从 status() 读到（面板/状态查询可见）')
  host.stopWatchdog()
  console.log(`[自测③b] 抖动：resume→suspend ${flaps[0].resumeToSuspendMs}ms < 1000ms → 审计 native-host-suspend-after-resume（policy=${flaps[0].policy}）；同一行 suspended 带 pluginSurfaceKind=${suspendedLine.pluginSurfaceKind} surfaceTrigger=${suspendedLine.surfaceTrigger}；status().revive.flips=${host.status().revive.flips}`)
}

async function main() {
  const roots = {}
  for (const name of ['scan', 'guardless', 'record', 'minimized', 'dead']) {
    roots[name] = path.join(workDir, name)
    fs.mkdirSync(path.join(roots[name], 'logs'), { recursive: true })
  }

  // 抖动测量先跑（纯替身、不依赖任何真实窗口），这样即使夹具起不来，第 3 项也有结论。
  await flapChecks()
  stage('flap-offline')

  // 真实窗口的宿主：全部走注入式 harness（更宽的脚本预算 + 调用埋点）。判据、动作、
  // 断言一个字都没变，变的只是"这次脚本调用允许用多久"以及"这些数字会被打出来"。
  const scanHost = new CodesysNativeHost(roots.scan, stubMonitor, { runProcess: scriptRunner('scanHost') })
  const guardlessHost = new CodesysNativeHost(roots.guardless, stubMonitor, { runProcess: scriptRunner('guardlessHost'), reviveGuardMs: 0 })
  const deadHost = new CodesysNativeHost(roots.dead, stubMonitor, { runProcess: scriptRunner('deadHost') })
  const recordHost = new CodesysNativeHost(roots.record, stubMonitor, { runProcess: scriptRunner('recordHost') })

  // ── ① 隐藏（非最小化）的插件所属窗口 → 恢复显示，且不抢焦点 ────────────────────
  // 夹具：一个真实窗口（CODESYS.exe）。它同时是 ④/③/⑤c/①c 的同一个窗口 —— 这几段用的是
  // **同一个句柄上的同一个语义**（重新隐藏 → 再枚举/再操作），不需要再各起一个进程；少起一个
  // 夹具就少一份 %TEMP% 文件争用（就绪握手那条病灶正是在这个争用下变宽的）。
  const hidden = startFixture(codesysExe, 'hidden')
  assert.equal(hidden.info.styleVisible, false, '夹具前提：窗口存在但 WS_VISIBLE=false')
  assert.equal(hidden.info.iconic, false, '夹具前提：不是最小化')
  assert.equal(hidden.info.visible, false, '夹具前提：IsWindowVisible=false')
  stage('fixture:hidden-ready')

  const before = await scanHost.probeWindow(hidden.info.handle, hidden.info.pid)
  assert.equal(before.exists, true)
  assert.equal(windowStyleVisible(before.style), false, '前提：探活读到的样式位是"隐藏"')

  // ── ① 的前台窗口观测：可判定判据 + **只对可判定的环境性抖动**有界重试 ──────────────
  // 前台窗口是**全局**读数：采样、自愈、再采样放进同一个跨进程互斥区（T203 留下的那把锁），
  // 免得另一棵树正好在这中间把系统前台窗口换掉。
  const FOREGROUND_ATTEMPTS = 3
  const FOREGROUND_BACKOFF_MS = 100
  const FOREGROUND_SAMPLE_SETTLE_ATTEMPTS = 3
  // 重试的**墙钟**上限：④ 依赖 scanHost 的 30s 幂等护栏（REVIVE_REPEAT_GUARD_MS），
  // 所以重试不许把那个窗口期吃穿 —— 次数有界之外再加一道时间界。
  const FOREGROUND_RETRY_BUDGET_MS = 8000
  const focusTarget = { windowId: hidden.info.handle, pid: hidden.info.pid }

  async function observeReviveFocus(attempt) {
    const label = `stage-1-focus#${attempt}`
    let host = scanHost
    let reason = 'selftest-hidden'
    let reviveLabel = 'stage-1'
    if (attempt > 1) {
      // 重试 = 一次**全新**观测：新宿主（幂等护栏为空 ⇒ 真的会再发一次 ShowWindow）
      // ＋ 新 root（审计计数不落回 roots.scan ⇒ ④ 的"ShowWindow 只发生过一次"逐字不变）。
      const retryRoot = path.join(workDir, `scan-retry-${attempt}`)
      fs.mkdirSync(path.join(retryRoot, 'logs'), { recursive: true })
      host = new CodesysNativeHost(retryRoot, stubMonitor, { runProcess: scriptRunner(`scanRetry${attempt}`) })
      reason = `selftest-hidden-env-retry-${attempt}`
      reviveLabel = `stage-1-retry${attempt}`
      // 前提：上一轮已经把它显示出来了；重试前它必须重新成为"隐藏的合规候选"。
      const resettled = await hideThenSettle(host, focusTarget.windowId, focusTarget.pid, `stage-1-retry${attempt}`)
      if (windowStyleVisible(resettled && resettled.style)) {
        return {
          attempt, label, target: focusTarget, confirmations: [],
          verdict: { kind: 'unknown', why: `重试前提不成立：窗口没能重新隐藏（styleVisible=${windowStyleVisible(resettled && resettled.style)}）` },
          before: null, after: null, foregroundBefore: '', foregroundAfter: '',
        }
      }
    }
    const measured = await withWindowLock(`stage-1-revive#${attempt}`, async () => {
      // 基线自己读不出来 = 前提不确定 ⇒ 有界补采（退避 100ms）。
      let foregroundBefore = foregroundSample(`${label}:before`)
      for (let settle = 1; settle <= FOREGROUND_SAMPLE_SETTLE_ATTEMPTS && foregroundBefore.ok !== true; settle += 1) {
        sleepSync(FOREGROUND_BACKOFF_MS)
        foregroundBefore = foregroundSample(`${label}:before-settle${settle}`)
      }
      const revived = await reviveWithRetry(host, reason, { force: true, ownedPids: [focusTarget.pid] }, focusTarget, reviveLabel)
      let foregroundAfter = foregroundSample(`${label}:after`)
      const confirmations = []
      // **只对可判定的环境性抖动**继续确认：变了但不是我们干的，就退避后重采，看前台是不是
      // 稳定停在那个外部窗口上；一旦它变成我们那个窗口，结论立刻翻成 stolen。
      for (let confirm = 1; confirm <= FOREGROUND_SAMPLE_SETTLE_ATTEMPTS; confirm += 1) {
        const kind = classifyForeground(foregroundBefore, foregroundAfter, focusTarget).kind
        if (kind === 'clean' || kind === 'stolen') break
        confirmations.push(foregroundAfter)
        sleepSync(FOREGROUND_BACKOFF_MS * confirm)
        foregroundAfter = foregroundSample(`${label}:after-confirm${confirm}`)
      }
      return { revived, foregroundBefore, foregroundAfter, confirmations }
    })
    return {
      attempt,
      label,
      target: focusTarget,
      confirmations: measured.confirmations,
      outcome: measured.revived.outcome,
      reviveAttempt: measured.revived.attempt,
      foregroundBefore: measured.foregroundBefore.hwnd,
      foregroundAfter: measured.foregroundAfter.hwnd,
      before: measured.foregroundBefore,
      after: measured.foregroundAfter,
      verdict: classifyForeground(measured.foregroundBefore, measured.foregroundAfter, focusTarget),
    }
  }

  const stage1StartedAt = Date.now()
  for (let attempt = 1; attempt <= FOREGROUND_ATTEMPTS; attempt += 1) {
    const observation = await observeReviveFocus(attempt)
    focusObservations.push(observation)
    // 结论一可判定就停：clean = 最强证据；stolen = **立刻红**（重试只会掩盖真抢焦点）。
    if (observation.verdict.kind === 'clean' || observation.verdict.kind === 'stolen') break
    // 只剩 external / unknown ⇒ 环境不确定，才值得再观测一轮（次数 + 墙钟双界）。
    if (attempt >= FOREGROUND_ATTEMPTS) break
    if (Date.now() - stage1StartedAt > FOREGROUND_RETRY_BUDGET_MS) break
    sleepSync(FOREGROUND_BACKOFF_MS * attempt)
  }

  const first = focusObservations[0]
  const readableObservations = focusObservations.filter((entry) => entry.before && entry.before.ok === true && entry.after && entry.after.ok === true)

  assert.equal(first.outcome.revived.length, 1, `自愈必须恢复这一个窗口：${first.outcome.detail}`)
  assert.equal(first.outcome.revived[0].source, 'owned-hidden-scan')
  assert.equal(first.outcome.revived[0].windowId.toUpperCase(), hidden.info.handle.toUpperCase())
  assert.ok(!first.outcome.detail.includes('\n'), '结论是一行')
  const after = await scanHost.probeWindow(hidden.info.handle, hidden.info.pid)
  assert.equal(after.exists, true, '恢复显示不许销毁窗口')
  assert.equal(windowStyleVisible(after.style), true, '恢复后 WS_VISIBLE 位必须是置上的')
  assert.equal(after.visible, true, '恢复后 IsWindowVisible 必须为 true')
  assert.equal(after.iconic, false, '恢复显示不许把它变成最小化')
  assert.deepEqual(after.rect, before.rect, '恢复显示不许移动窗口（几何是读出来的，不是发明的）')
  // ── 恢复显示绝不能抢焦点：**可判定**的真行为判据（不放宽，反而比旧写法更强）────────────
  // ① 真行为判据（对**每一次**采样，含确认采样）：恢复之后被恢复的那个窗口、以及本测试的任何
  //    进程，都不许成为前台窗口 —— 这正是"我们抢了焦点"的定义，外部程序换前台时它照样成立，
  //    我们抢焦点时它必然为假（变异检查：把 SetForegroundWindow 注进恢复路径 ⇒ 下面这条红）。
  // ② 拿到 clean 观测（环境干净，我们操作前后同一前台）时**再**钉最强形式：一字不变。
  // ③ 全部观测都读不出前台窗口 ⇒ 不能声称"没抢焦点"，同样红（不确定不当作通过）。
  assert.ok(readableObservations.length > 0, `前台窗口判据不成立：${focusObservations.length} 轮观测全部读不出前台窗口 ⇒ 不能声称"没抢焦点"（采样 ${foregroundSamplesTaken} 次；${foregroundJudgeLine(focusObservations)}）`)
  for (const entry of focusObservations) {
    assert.ok(entry.verdict.kind !== 'stolen', `恢复显示绝不能抢焦点：${foregroundJudgeLine([entry])}`)
    if (entry.verdict.kind === 'clean') {
      assert.equal(entry.after.hwnd, entry.before.hwnd, '恢复显示绝不能抢焦点（前台窗口必须不变）')
    }
    for (const sample of [entry.before, entry.after, ...(entry.confirmations || [])]) {
      if (!sample || sample.ok !== true) continue
      assert.ok(foregroundIsOurs(sample, entry.target) !== true, `恢复显示绝不能抢焦点：采样 ${sample.label} 落在我们自己的窗口上（${foregroundSampleText(sample)}）`)
    }
  }
  const revivedAudit = readAudit(roots.scan).filter((entry) => entry.event === 'native-host-revive-suspended')
  assert.equal(revivedAudit.length, 1)
  assert.equal(revivedAudit[0].focused, false)
  assert.equal(revivedAudit[0].inputSent, false)
  assert.equal(revivedAudit[0].pid, hidden.info.pid)
  console.log(`[自测①] 隐藏窗口 ${hidden.info.handle}（pid ${hidden.info.pid}）→ 已恢复显示：styleVisible ${windowStyleVisible(before.style)} → ${windowStyleVisible(after.style)}；前台窗口判据 ${focusObservations.length} 轮观测=${focusObservations.map((entry) => entry.verdict.kind).join(',')}（环境性重试 ${Math.max(0, focusObservations.length - 1)} 次、采样 ${foregroundSamplesTaken} 次${first.verdict.kind === 'clean' ? `，${first.foregroundBefore} → ${first.foregroundAfter} 一字未变` : `，结论 ${first.verdict.kind}：${first.verdict.why}`}）⇒ 未抢焦点；矩形容器 ${JSON.stringify(after.rect)}；夹具就绪 ${hidden.readyMs}ms（就绪文件读故障 ${hidden.faults} 次）`)
  stage('stage-1-hidden-revive')

  // ── ④ 幂等：再次发现不许反复 ShowWindow ──────────────────────────────────────
  // 先用**独立**的挂起调用把它重新隐藏（真实路径：-Mode suspend），于是它又是一个合规候选。
  const fourth = await (async () => {
    const hiddenAgain = await hideThenSettle(scanHost, hidden.info.handle, hidden.info.pid, 'stage-4')
    assert.equal(windowStyleVisible(hiddenAgain.style), false, '外部挂起后应重新是隐藏状态')
    const second = await reviveWithRetry(scanHost, 'selftest-repeat', { force: true, ownedPids: [hidden.info.pid] }, { windowId: hidden.info.handle, pid: hidden.info.pid }, 'stage-4-repeat')
    const stillHidden = await scanHost.probeWindow(hidden.info.handle, hidden.info.pid)
    const third = await reviveWithRetry(guardlessHost, 'selftest-guardless', { force: true, ownedPids: [hidden.info.pid] }, { windowId: hidden.info.handle, pid: hidden.info.pid }, 'stage-4-guardless')
    const afterThird = await guardlessHost.probeWindow(hidden.info.handle, hidden.info.pid)
    return { hiddenAgain, second, stillHidden, third, afterThird }
  })()
  assert.equal(fourth.second.outcome.revived.length, 0, '护栏窗口期内不许再发第二次 ShowWindow')
  assert.equal(fourth.second.outcome.skipped.map((entry) => entry.reason).includes('recently-revived'), true, `重复发现必须给出原因是 recently-revived：${fourth.second.outcome.detail}`)
  assert.equal(windowStyleVisible(fourth.stillHidden.style), false, 'recently-revived 期间窗口必须保持原样（证明确实没有再 ShowWindow）')
  assert.equal(countEvents(roots.scan, 'native-host-revive-suspended'), 1, 'ShowWindow 只发生过一次')
  // 护栏本身才是原因：把护栏设为 0 的宿主（同一个窗口、同一份判据）能再恢复一次。
  assert.equal(fourth.third.outcome.revived.length, 1, '护栏为 0 时同一个窗口应能再被恢复（证明挡住第二次的是护栏，不是判据）')
  assert.equal(windowStyleVisible(fourth.afterThird.style), true)
  console.log(`[自测④] 幂等：第一次 ${hidden.info.handle} 恢复并显示；重新隐藏后再跑 → revived=${fourth.second.outcome.revived.length}、reason=recently-revived、样式位仍 ${windowStyleVisible(fourth.stillHidden.style)}（未重复 ShowWindow，审计里 native-host-revive-suspended 仍是 1 条）；换护栏为 0 的宿主 → 又能恢复（revived=${fourth.third.outcome.revived.length}）`)
  stage('stage-4-idempotence')

  // ── ⑤ 失败/放弃给一行可读原因（含跨进程会话记录路径）─────────────────────────
  // (a) 句柄已经不存在：-Revive 会抛，必须落一条 native-host-revive-failed 并给一行话。
  const deadOutcome = { reason: 'selftest-dead', attempted: true, scanned: 0, revived: [], skipped: [], failed: [] }
  await deadHost.reviveWindowNow({ id: '0xDEAD00', pid: 0x7FFFFFF0 }, 'selftest-dead', deadOutcome)
  assert.equal(deadOutcome.failed.length, 1, '死句柄必须走失败分支，而不是静默')
  assert.ok(deadOutcome.failed[0].detail.startsWith(reviveReasonText('revive-failed')), `失败必须有一行可读原因：${deadOutcome.failed[0].detail}`)
  assert.equal(countEvents(roots.dead, 'native-host-revive-failed'), 1)
  // (b) 没有可扫描的插件 PID：不许静默，结论要说明为什么没动。
  const noPid = await deadHost.revivePluginOwnedHiddenWindows('selftest-no-pid', { force: true, ownedPids: [] })
  assert.equal(noPid.revived.length, 0)
  assert.ok(noPid.detail.includes('PID'), `结论必须说明原因：${noPid.detail}`)
  assert.equal(oneLine.includes('\n'), false)
  console.log(`[自测⑤] 失败一行原因：${deadOutcome.failed[0].detail}`)
  console.log(`[自测⑤b] 放弃一行原因：${noPid.detail}`)
  stage('stage-5-dead-and-nopid')

  // ── ①b/⑤c 跨进程会话记录路径：进程被杀之后，唯一还活着的证据就是这条记录 ────────
  // 用同一个隐藏窗口（记录里写的就是它的句柄/PID），重新隐藏后**只靠记录**恢复：
  // ownedPids 传空数组，所以只有 (a) 记录路径能驱动这次恢复。
  const viaRecord = await (async () => {
    const settled = await hideThenSettle(recordHost, hidden.info.handle, hidden.info.pid, 'stage-5c')
    assert.equal(windowStyleVisible(settled.style), false, '会话记录路径的前提：窗口重新是隐藏的')
    fs.writeFileSync(path.join(roots.record, 'logs', 'codesys-native-session.json'), JSON.stringify({ version: 1, windowId: hidden.info.handle, pid: hidden.info.pid, suspended: true, reason: 'surface-hidden', atMs: Date.now() }), 'utf8')
    const revived = await reviveWithRetry(recordHost, 'selftest-record', { force: true, ownedPids: [] }, { windowId: hidden.info.handle, pid: hidden.info.pid }, 'stage-5c')
    const recordProbe = await recordHost.probeWindow(hidden.info.handle, hidden.info.pid)
    return { revived, recordProbe }
  })()
  assert.equal(viaRecord.revived.outcome.revived.length, 1, `会话记录路径必须能恢复：${viaRecord.revived.outcome.detail}`)
  assert.equal(viaRecord.revived.outcome.revived[0].source, 'session-record')
  assert.equal(windowStyleVisible(viaRecord.recordProbe.style), true)
  assert.equal(readAudit(roots.record).some((entry) => entry.event === 'native-host-revive-scan' && entry.source === 'session-record'), true, '记录路径也要留扫描事实')
  assert.equal(JSON.parse(fs.readFileSync(path.join(roots.record, 'logs', 'codesys-native-session.json'), 'utf8')).suspended, false, '恢复之后记录必须落成"未挂起"（否则每次启动都会再问一遍）')
  console.log(`[自测①b] 跨进程会话记录（logs/codesys-native-session.json suspended:true）→ 恢复 ${hidden.info.handle}；source=session-record；记录随后落成 suspended=false`)
  stage('stage-5c-session-record')

  // ── ② 最小化窗口 → 一个字都不动 ──────────────────────────────────────────────
  const minimized = startFixture(codesysExe, 'minimized', 'CODESYS TaskHive Revive Fixture Minimized')
  assert.equal(minimized.info.iconic, true, '夹具前提：窗口是最小化的')
  const minimizedHost = new CodesysNativeHost(roots.minimized, stubMonitor, { runProcess: scriptRunner('minimizedHost') })
  fs.writeFileSync(path.join(roots.minimized, 'logs', 'codesys-native-session.json'), JSON.stringify({ version: 1, windowId: minimized.info.handle, pid: minimized.info.pid, suspended: true, reason: 'surface-hidden', atMs: Date.now() }), 'utf8')
  const minimizedOutcome = await reviveWithRetry(minimizedHost, 'selftest-minimized', { force: true, ownedPids: [minimized.info.pid] }, { windowId: minimized.info.handle, pid: minimized.info.pid }, 'stage-2')
  assert.equal(minimizedOutcome.outcome.revived.length, 0, '最小化窗口绝不能被恢复显示（那是用户自己的状态）')
  const minimizedProbe = await minimizedHost.probeWindow(minimized.info.handle, minimized.info.pid)
  assert.equal(minimizedProbe.iconic, true, '最小化窗口必须保持最小化')
  assert.equal(windowStyleVisible(minimizedProbe.style), minimized.info.styleVisible, '最小化窗口的样式位不许被改写')
  const minimizedSkip = readAudit(roots.minimized).filter((entry) => entry.event === 'native-host-revive-skipped').map((entry) => entry.reason)
  assert.ok(minimizedSkip.includes('window-minimized'), `最小化必须留下原因 window-minimized（实际：${JSON.stringify(minimizedSkip)}）`)
  console.log(`[自测②] 最小化窗口 ${minimized.info.handle}（iconic=${minimizedProbe.iconic}，styleVisible=${windowStyleVisible(minimizedProbe.style)}）→ 未被动作；审计原因 ${JSON.stringify(minimizedSkip)}`)
  stage('stage-2-minimized')

  // ── ③ 非插件所属窗口 → 不动 ─────────────────────────────────────────────────
  const foreignPid = startFixture(codesysExe, 'hidden', 'CODESYS TaskHive Revive Fixture Foreign')
  const thirdStage = await (async () => {
    const settled = await hideThenSettle(guardlessHost, hidden.info.handle, hidden.info.pid, 'stage-3')
    assert.equal(windowStyleVisible(settled.style), false, '③ 的前提：合规候选重新是隐藏的')
    // 让扫描**确实有事可做**：这一轮扫描里既有一个合规候选（F1），又有一个"长得一样但不属于
    // 插件"的隐藏窗口（foreign）。自愈只能显示前者。
    const isolation = await reviveWithRetry(guardlessHost, 'selftest-foreign-pid', { force: true, ownedPids: [hidden.info.pid] }, { windowId: hidden.info.handle, pid: hidden.info.pid }, 'stage-3-isolation')
    const foreignProbe = await scanHost.probeWindow(foreignPid.info.handle, foreignPid.info.pid)
    return { isolation, foreignProbe }
  })()
  assert.equal(thirdStage.isolation.outcome.revived.length, 1, `不在册的 PID 不该影响自愈本身：${thirdStage.isolation.outcome.detail}`)
  assert.equal(thirdStage.isolation.outcome.revived[0].windowId.toUpperCase(), hidden.info.handle.toUpperCase())
  assert.equal(windowStyleVisible(thirdStage.foreignProbe.style), false, '同一轮扫描里，不属于插件的隐藏窗口必须保持原样')
  // 进程名不符的窗口：脚本侧第一道过滤就应该把它挡在外面（连枚举都不返回它）。
  const otherName = startFixture(otherExe, 'hidden', 'TaskHive Revive Not CODESYS')
  const otherScan = await scanHost.listHiddenWindowsForPids([otherName.info.pid])
  assert.equal(otherScan.length, 0, `隐藏枚举只返回 CODESYS 进程的窗口（脚本侧过滤）；实际看到 ${JSON.stringify(otherScan.map((item) => ({ id: item.id, pid: item.pid, processName: item.processName, title: item.title })))}；夹具 ${JSON.stringify(otherName.info)}`)
  const notCodesys = await reviveWithRetry(scanHost, 'selftest-not-codesys', { force: true, ownedPids: [otherName.info.pid] }, { windowId: otherName.info.handle, pid: otherName.info.pid }, 'stage-3-not-codesys')
  assert.equal(notCodesys.outcome.revived.length, 0, '进程名不是 CODESYS 的窗口绝不能被显示')
  const otherProbe = await scanHost.probeWindow(otherName.info.handle, otherName.info.pid)
  assert.equal(windowStyleVisible(otherProbe.style), false, '非 CODESYS 进程的窗口必须保持原样')
  console.log(`[自测③] 非插件窗口未被动：不在册 PID ${foreignPid.info.pid} → styleVisible=${windowStyleVisible(thirdStage.foreignProbe.style)}（同一轮里合规候选 ${hidden.info.handle} 照常被恢复）；进程名不符 ${otherName.info.pid} → 枚举返回 ${otherScan.length} 项、styleVisible=${windowStyleVisible(otherProbe.style)}`)
  stage('stage-3-foreign')

  // ── 附：attach 路径上的定点自愈（缓存里有 pid 且是本插件拥有的窗口）──────────────
  // 还是同一个隐藏窗口：attach 路径的语义是"缓存说它是本插件拥有的窗口"，与窗口来自哪个
  // 进程实例无关，所以重新隐藏它、换一个宿主就行（再起一个夹具只是多一份 %TEMP% 争用）。
  const attachHost = new CodesysNativeHost(roots.scan, {
    async listWindows() { return [{ id: hidden.info.handle, pid: hidden.info.pid, processName: 'CODESYS', title: 'CODESYS TaskHive Revive Fixture', width: 900, height: 700, usable: true, pluginOwned: true }] },
    cachedWindow() { return { id: hidden.info.handle, pid: hidden.info.pid, processName: 'CODESYS', title: 'CODESYS TaskHive Revive Fixture', width: 900, height: 700, usable: true, pluginOwned: true, fixture: true } },
  }, { runProcess: scriptRunner('attachHost') })
  const targeted = await (async () => {
    const settled = await hideThenSettle(attachHost, hidden.info.handle, hidden.info.pid, 'stage-1c')
    assert.equal(windowStyleVisible(settled.style), false, '①c 的前提：窗口重新是隐藏的')
    const revived = await attachHost.reviveTargetedWindow(hidden.info.handle)
    const attachProbe = await attachHost.probeWindow(hidden.info.handle, hidden.info.pid)
    return { revived, attachProbe }
  })()
  assert.equal(targeted.revived?.id, hidden.info.handle, 'attach 路径必须把隐藏的插件窗口显示出来并交回枚举结果')
  assert.equal(windowStyleVisible(targeted.attachProbe.style), true)
  // 用户自己开的窗口（cachedWindow 不带 pluginOwned）绝不走这条路径。
  const userHost = new CodesysNativeHost(roots.dead, { async listWindows() { return [] }, cachedWindow() { return { id: foreignPid.info.handle, pid: foreignPid.info.pid, processName: 'CODESYS', width: 900, height: 700, usable: true } } }, { runProcess: scriptRunner('userHost') })
  assert.equal(await userHost.reviveTargetedWindow(foreignPid.info.handle), null, '不是本插件拥有的窗口必须被 attach 自愈拒绝')
  console.log(`[自测①c] attach 路径：隐藏的插件窗口 ${hidden.info.handle} → 已显示并交回枚举；非插件窗口被拒（返回 null）`)
  stage('stage-1c-attach')

  // ── 抖动测量：resume→suspend 间隔 <1s 必须留下可数的记录 ──────────────────────
  assert.ok(hostSource.includes('SUSPEND_FLAP_WINDOW_MS = 1000'), '抖动窗口必须钉在 1s')
  assert.ok(hostSource.includes("if (flap) {\n      this.audit('native-host-suspend-after-resume'"), '抖动必须留下审计（记录 + 策略，不静默）')
  console.log('[自测③b-静态] 抖动接线在场：SUSPEND_FLAP_WINDOW_MS=1000 + native-host-suspend-after-resume')

  return workDir
}

let exitCode = 0
main().then(() => {
  process.stdout.write(`${timingSummary('')}\n`)
  process.stdout.write('codesys native host revive contract passed\n')
}).catch((error) => {
  exitCode = 1
  failureReport(error, workDir)
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
}).finally(() => {
  // 清理：先按 pid 收，再按**镜像路径**兜底扫一遍。只按 pid 判活是不够的 —— 这个测试第一版
  // 就出现过"pid 判活说进程没了、进程其实还在"（workdir 都被删掉了，可执行文件仍活着），
  // 所以最终判据是"还有没有进程的镜像路径落在本次夹具目录里"，并把结果原样打出来。
  const startedPids = children.map((child) => Number(child.pid)).filter((pid) => Number.isInteger(pid) && pid > 0)
  for (const child of children) { try { child.kill() } catch { /* already gone */ } }
  for (const pid of startedPids) { try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ } }
  const sweep = () => {
    try {
      const script = `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "${fixtureDir}\\*" } | ForEach-Object { $_.Id }`
      return String(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], { encoding: 'utf8' })).split(/\s+/).filter(Boolean).map(Number)
    } catch { return [] }
  }
  sleepSync(400)
  const strayFirst = sweep()
  for (const pid of strayFirst) { try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* report below */ } }
  sleepSync(300)
  const stray = sweep()
  let removed = false
  try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* locked by a survivor */ }
  removed = !fs.existsSync(workDir)
  process.stdout.write(`revive fixture cleanup: started=${children.length} pids=${startedPids.join(',')} stray-after-kill=${strayFirst.length} residue=${stray.length}${stray.length ? ` leftover=${stray.join(',')}` : ''} workdir=${workDir} removed=${removed} devices=${os.tmpdir()} lock=${WINDOW_LOCK_PATH} harness=${SCRIPT_HARNESS}\n`)
  process.exit(exitCode)
})
