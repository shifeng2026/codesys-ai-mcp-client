'use strict'

// T188 — 托管窗口的存活看门狗。
//
// 这个契约直接来自用户真机运行证据（2026-10-04 17:29，pid 29248）：`attach` 成功了
// （审计记着 `coordinateSpace: "physical"`、`placementDelta: 0`、`bounds {764,275,1402x1084}`），
// 但随后 CODESYS 替换掉了自己的顶层 HWND —— 被托管的 `0x1C0D32` 已不存在，同一 pid 的窗口
// 变成 `0x3C0C90`（仍是带 WS_CAPTION 的普通顶层窗口），而审计里**只有 `attached`、一次
// `detach` 都没有**。`status().attached` 于是永远保持 true：插件面板里只剩 DOM 占位符，
// 真实窗口是面板之外的另一个窗口 —— 用户看到的就是「托管窗口不在插件面板里面」。
//
// 旧实现只在 `updateNow`（必须有一次 move 被调度）里才发现身份变化，而"窗口被销毁"本身
// 不会触发 move/resize/surface:geometry，所以这个状态可以永远静默保持。本契约钉住修复后的
// 四条不变量：
//   1. 同 pid 出现新主窗口时**自动重新托管**，并沿用面板矩形与首次解析出的宿主 HWND；
//   2. 找不到替代窗口时**退掉 session**（`attached` 变 false）—— 退化必须可见，不许假报已托管；
//   3. **挂起期间不得判活**：surface 切走时窗口是被 SW_HIDE 主动藏起来的，枚举看不见是预期；
//   4. 探活本身失败（PowerShell 抖动）**不得**升级成"窗口已丢失"。
//
// 全程离线：monitor 与 runProcess 都是替身，不起 PowerShell、不碰任何真实窗口。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')

const root = process.env.TASKHIVE_ROOT || path.join(__dirname, '..')
const { CodesysNativeHost } = require(path.join(root, 'app', 'codesys-native-host'))

const appSource = fs.readFileSync(path.join(root, 'app', 'codesys-native-host.js'), 'utf8')
const psSource = fs.readFileSync(path.join(root, 'app', 'win-window-host.ps1'), 'utf8')
const mainSource = fs.readFileSync(path.join(root, 'app', 'main.js'), 'utf8')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return true
    if (Date.now() >= deadline) return false
    await delay(10)
  }
}

const workDir = createTempDir('taskhive-native-host-watchdog-')
const auditPath = path.join(workDir, 'logs', 'codesys-native-host-audit.jsonl')
const readAudit = () => {
  if (!fs.existsSync(auditPath)) return []
  return fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}
const events = () => readAudit().map((entry) => entry.event)

const PID = 4242
const BOUNDS = { x: 100, y: 120, width: 640, height: 480 }
const HOST_HANDLE_HEX = '0x100B0E'
const fixture = (id, width, height) => ({ id, pid: PID, processName: 'codesys', title: 'CODESYS', width, height, left: 0, top: 0, usable: true, fixture: true, windowPhase: 'main' })

let windows = [fixture('0xAAA1', 500, 400)]
let probeFails = false
const calls = []
const monitor = {
  async listWindows() { return windows.map((item) => ({ ...item })) },
  cachedWindow(windowId) { return windows.find((item) => String(item.id) === String(windowId)) || null },
}
const runProcess = async (_file, args) => {
  calls.push(args.join(' '))
  if (args.includes('-Probe')) {
    if (probeFails) throw new Error('Command failed: powershell.exe (simulated timeout)')
    const windowId = args[args.indexOf('-WindowId') + 1]
    const found = windows.find((item) => String(item.id) === String(windowId))
    return { stdout: JSON.stringify(found
      ? { ok: true, mode: 'probe', exists: true, pid: found.pid, owner: HOST_HANDLE_HEX, style: 0x16000000, visible: true, iconic: false }
      : { ok: true, mode: 'probe', exists: false, pid: 0, owner: '0x0', style: 0, visible: false, iconic: false }) }
  }
  if (args.includes('attach')) {
    return { stdout: JSON.stringify({
      ok: true, mode: 'owned-native-dock', identityVerified: true, styleCaptured: true,
      dpiAwareness: 2, coordinateSpace: 'physical', hostWindowId: HOST_HANDLE_HEX,
      actualOwner: HOST_HANDLE_HEX, actualExStyle: 65664, taskbarHidden: true, actualBounds: { ...BOUNDS },
      restore: { style: 0x16CF0000, originalExStyle: 0x50100, owner: '0x0', left: 900, top: 120, width: 1000, height: 700 },
    }) }
  }
  return { stdout: JSON.stringify({ ok: true, identityVerified: true, dpiAwareness: 2, coordinateSpace: 'physical' }) }
}

const host = new CodesysNativeHost(workDir, monitor, { runProcess, watchdogIntervalMs: 20 })
const hostWindow = { isDestroyed: () => false, getNativeWindowHandle: () => Buffer.from([0x0e, 0x0b, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00]) }

async function run() {
  // ── 1. 托管成功即开启看门狗 ────────────────────────────────────────────────
  const attached = await host.attach('0xAAA1', BOUNDS, hostWindow)
  assert.equal(attached.attached, true)
  assert.equal(attached.windowId, '0xAAA1')
  assert.equal(attached.lost, false)
  assert.equal(attached.watchdog, true, '托管成功后看门狗必须已启动（否则窗口消失永远不会被发现）')
  assert.equal(attached.windowRecoveries, 0)
  const hostCall = calls.find((entry) => entry.includes('attach'))
  assert.ok(hostCall.includes(`-HostWindowId ${HOST_HANDLE_HEX}`), 'attach 必须把解析出的宿主 HWND 交给脚本')

  // ── 2. CODESYS 替换自己的顶层 HWND（同 pid）→ 自动重新托管 ──────────────────
  windows = [fixture('0xBBB2', 1400, 1000)]
  assert.ok(await waitFor(() => events().includes('native-host-window-replaced')), '同 pid 出现新主窗口时必须自动重新托管')
  const replaced = host.status()
  assert.equal(replaced.attached, true)
  assert.equal(replaced.windowId, '0xBBB2', '重新托管必须指向新 HWND')
  assert.equal(replaced.pid, PID)
  assert.deepEqual(replaced.bounds, BOUNDS, '重新托管必须沿用面板矩形，而不是窗口自己的旧位置')
  assert.equal(replaced.windowRecoveries, 1)
  assert.ok(events().includes('native-host-window-lost'), '窗口丢失必须先留下审计事件')
  assert.ok(calls.some((entry) => entry.includes('attach') && entry.includes('-WindowId 0xBBB2') && entry.includes(`-HostWindowId ${HOST_HANDLE_HEX}`)),
    '看门狗没有 BrowserWindow，必须复用首次解析出的宿主 HWND')

  // ── 3. 挂起期间不得判活：SW_HIDE 造成的"看不见"不是"已消失" ────────────────
  await host.suspend('surface-switch')
  windows = []
  const auditBeforeSuspend = events().length
  await delay(150)
  const suspended = host.status()
  assert.equal(suspended.suspended, true)
  assert.equal(suspended.attached, true, '挂起期间不得判定脱管')
  assert.equal(suspended.lost, false)
  assert.equal(events().length, auditBeforeSuspend, '挂起期间看门狗不得写任何"窗口丢失"审计')
  windows = [fixture('0xBBB2', 1400, 1000)]
  await host.resume(BOUNDS)
  assert.equal(host.status().suspended, false)

  // ── 4. 探活本身失败不得退掉健康 session ───────────────────────────────────
  const auditBeforeProbeFailure = events().length
  probeFails = true
  await delay(150)
  assert.equal(host.status().attached, true, 'PowerShell 抖动不得被升级成"窗口已丢失"')
  assert.equal(host.status().lost, false)
  assert.equal(events().length, auditBeforeProbeFailure, '探活失败不得记成窗口丢失')
  probeFails = false

  // ── 5. 找不到替代窗口 → 退掉 session（可见的退化）─────────────────────────
  windows = []
  assert.ok(await waitFor(() => host.status().attached === false), '找不到替代窗口时必须退掉 session，不许继续假报已托管')
  assert.ok(events().includes('native-host-window-lost-unrecovered'))
  const unrecovered = readAudit().filter((entry) => entry.event === 'native-host-window-lost-unrecovered').pop()
  assert.equal(unrecovered.windowId, '0xBBB2')
  assert.equal(unrecovered.pid, PID)
  assert.equal(host.status().watchdog, false, '退掉 session 后看门狗必须停止')

  // ── 6. 脱管：停看门狗、还原原始 exStyle/owner、之后不再活动 ────────────────
  windows = [fixture('0xAAA1', 500, 400)]
  await host.attach('0xAAA1', BOUNDS, hostWindow)
  const detached = await host.detach('user')
  assert.equal(detached.attached, false)
  assert.equal(detached.restored, true)
  assert.equal(detached.watchdog, false, '脱管必须停掉看门狗（否则脱管途中它会把窗口又托管回去）')
  const detachCall = calls.filter((entry) => entry.includes('detach')).pop()
  assert.ok(detachCall.includes('-RestoreExStyle 327936'), 'detach 必须还原 originalExStyle（0x50100 = 327936），不是被改造过的 exStyle')
  assert.ok(detachCall.includes('-RestoreOwner 0x0'), 'detach 必须把 owner 还原成原始值')
  const auditBeforeIdle = events().length
  windows = []
  await delay(150)
  assert.equal(events().length, auditBeforeIdle, '脱管后看门狗不得再有活动')

  // ── 7. 静态不变量 ─────────────────────────────────────────────────────────
  for (const event of ['native-host-window-lost', 'native-host-window-replaced', 'native-host-window-recovery-failed', 'native-host-window-lost-unrecovered', 'native-host-watchdog-failed']) {
    assert.ok(appSource.includes(`'${event}'`), `看门狗必须留下审计事件：${event}`)
  }
  assert.ok(appSource.includes('this.stopWatchdog();'), 'detachNow/stop 必须先停看门狗')
  assert.ok(appSource.includes('this.startWatchdog();'), 'attach 必须启动看门狗')

  // 脱管的顺序不变量：先摘 owner，再还原样式，最后写几何。owner 还挂着时写几何等于写到
  // 一个用户已经看不见的窗口上（宿主最小化会隐藏 owned 窗口；宿主销毁会连带销毁它）。
  const releaseIndex = psSource.indexOf('[void][TaskHiveNativeHost]::SetLong($handle, $GWLP_HWNDPARENT, $restoreOwnerHandle)')
  const styleIndex = psSource.indexOf('[void][TaskHiveNativeHost]::SetLong($handle, $GWL_STYLE, [IntPtr]::new($RestoreStyle))')
  const geometryIndex = psSource.lastIndexOf('SetWindowPos($handle, [IntPtr]::Zero, $Left, $Top, $Width, $Height,')
  assert.ok(releaseIndex > 0, '脱管必须显式把 owner 摘掉（GWL_PARENT 不是 parent 关系）')
  assert.ok(styleIndex > releaseIndex, '脱管顺序必须是 owner → 样式')
  assert.ok(geometryIndex > styleIndex, '脱管顺序必须是 owner → 样式 → 几何')
  assert.ok(psSource.includes("if ($releasedOwner -ne $restoreOwnerHandle.ToInt64()) { throw 'Cannot release target window owner' }"),
    '摘 owner 失败必须抛错（可见的失败），不得静默继续')
  assert.ok(psSource.includes("ValidateSet('attach', 'move', 'suspend', 'resume', 'detach')"), 'Mode 的 ValidateSet 不得改变（契约钉住）')
  assert.ok(psSource.includes('[switch]$Probe'), '探活必须是独立开关，不占用 Mode')
  assert.ok(psSource.includes("mode = 'probe'"), '探活应答必须自带 mode 标记（调用方据此区分"探活失败"与"窗口不存在"）')
  assert.ok(psSource.includes('[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);'), '探活必须报告可见性，供调用方诊断')
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x00-\x7F]/.test(psSource), 'win-window-host.ps1 必须整体是 ASCII（无 BOM 时非 ASCII 注释会破坏 PS 5.1 解析）')

  // 主窗口销毁：必须先摘窗口再清面板状态（宿主被销毁会连带销毁被拥有的窗口）。
  const closedIndex = mainSource.indexOf("mainWindow.on('closed', () => {")
  assert.ok(closedIndex > 0, 'mainWindow closed 处理器必须存在')
  const closedRegion = mainSource.slice(closedIndex, closedIndex + 1500)
  const detachInClosed = closedRegion.indexOf("detach('main-window-closed')")
  const stopInClosed = closedRegion.indexOf('codesysNativeHost?.stopWatchdog?.()')
  const closeInClosed = closedRegion.indexOf('pluginSurfaceView?.webContents?.close()')
  assert.ok(stopInClosed > 0, '主窗口 closed 时必须停掉看门狗')
  assert.ok(detachInClosed > 0, '主窗口 closed 时必须先把窗口从宿主摘出来')
  assert.ok(closeInClosed > detachInClosed && detachInClosed > stopInClosed, 'closed 里的收尾顺序必须是 停看门狗 → 摘窗口 → 清面板状态')

  host.stopWatchdog()
  process.stdout.write('codesys-native-host-watchdog-contract: ok\n')
}

run().then(() => {
  try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* best effort */ }
  process.exit(0)
}).catch((error) => {
  try { fs.rmSync(workDir, { recursive: true, force: true }) } catch { /* best effort */ }
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
  process.exit(1)
})
