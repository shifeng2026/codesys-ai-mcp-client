'use strict'

// T192 —— 「写入成功之后，运行中的 CODESYS 怎么才能看到更新」。
//
// 用户报障（原话）：「测试程序虽然写进去了，但是我每次都要重新启动 codesys 程序才会看到，
// 之前就存在，现在怎么做才可以看到 codesys 程序更新」。
//
// 机制（已确认）：写入走**离线隔离作业**（ScriptEngine `--noUI`）→ 改的是磁盘上的 `.project`；
// 用户眼前那个 CODESYS GUI 早已把工程读进内存，**不会察觉文件被外部改**。
//
// 调研结论（三处本机安装原文，不是推测）：
//   1. 脚本 API：`CODESYS\ScriptLib\Stubs\scriptengine\*.pyi` 的 `ScriptProjects` 只有
//      create/open/open_archive/get_by_path/primary/all/convert，`ScriptProject` 只有
//      close/save/save_as/dirty —— **没有 reload**（全目录 `reload` 只命中 `reload_from_program`，
//      那是用户管理不是工程）。
//   2. 全量菜单定义：`CODESYS\Settings\Standard (CODESYS V3.5 SP20 Patch 4).opt.menu`（709 条命令、
//      25 个顶级菜单）里唯一带 reload 的是 `73d6ea58-…` "Try To Reload Library"；File / Project
//      菜单里**没有**"重新加载工程"。
//   3. 二进制字符串：`CODESYS\Common` + `CODESYS\PlugIns` 里没有任何工程重载命令标题。
//   4. **真机实测**（2026-10-04，用户正开着自己的工程）：对运行中的
//      `FiveDofPlatform0921.project - CODESYS`（hwnd 0xA80CEE / pid 35876）与 0x7C0CFA / pid 40308
//      做只读探测，`GetMenu(hwnd)` 两次都返回 0 —— 菜单栏是 CODESYS 自己画的，不是 Win32 原生菜单。
//      所以这条原生菜单路在 SP20 上**必然**答 `no-native-menubar`（对应下面夹具 CASE D），
//      而那枚按钮的价值就是"诚实报告 + 最短步骤"，不是"假装重载成功"。
// → 所以**没有**可靠入口可以自动重载（①不可行）。本契约钉住回落实现（②）的四条不变量：
//   A. 只在**写入成功之后**才出现"一段事实 + 一枚按钮"，且**不点就不会有任何动作**；
//   B. 按钮那一次 IPC 只做"读原生菜单栏、命中白名单标题才发一次 WM_COMMAND"——
//      **不动几何、不抢焦点、不关工程、不关进程**（PowerShell 侧静态证明）；
//   C. 唯一的真 reload 命令 "Try To Reload Library" **绝不允许**被误命中；
//   D. 失败可见 + 幂等：没有入口 / 调用失败都要回一行可读原因（含扫过的条数），
//      重复触发只产生**一次** PowerShell 往返。
//
// 全程离线：monitor 与 runProcess 都是替身，不起 PowerShell、不碰任何真实窗口。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createTempDir } = require('./lib/temp-dir')
const path = require('node:path')

const root = process.env.TASKHIVE_ROOT || path.join(__dirname, '..')
const { CodesysNativeHost, reloadProjectDetail } = require(path.join(root, 'app', 'codesys-native-host'))

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const psSource = read(path.join('app', 'win-window-host.ps1'))
const hostSource = read(path.join('app', 'codesys-native-host.js'))
const mainSource = read(path.join('app', 'main.js'))
const preloadSource = read(path.join('app', 'preload.js'))
const rendererSource = read(path.join('app', 'renderer', 'renderer.js'))

// ── A. PowerShell 侧：只在白名单标题上发一次 WM_COMMAND，别的什么都不做 ─────────────────────
assert(!/[^\x00-\x7F]/.test(psSource), 'win-window-host.ps1 必须整体是 ASCII（无 BOM 时非 ASCII 字节会被 PS 5.1 当 ANSI 读）')
assert(psSource.includes('[switch]$ReloadProject'), 'win-window-host.ps1 必须提供 -ReloadProject 开关')
// `-Mode` 的 ValidateSet 被别的契约钉着：重载走**独立开关**，不许变成第六个 mode。
assert(/\[ValidateSet\('attach', 'move', 'suspend', 'resume', 'detach'\)\]\[string\]\$Mode/.test(psSource),
  '-ReloadProject 不得改动 -Mode 的 ValidateSet（重载是独立开关，不是第六个 mode）')

const reloadBlock = psSource.slice(psSource.indexOf('if ($ReloadProject) {'), psSource.indexOf("if ($Width -lt 320 -or $Height -lt 200)"))
assert(reloadBlock.length > 400, '必须能定位 -ReloadProject 分支')
// B：这个分支里**不允许**出现任何会动窗口/抢输入/关东西的调用。
for (const forbidden of ['SetWindowPos', 'ShowWindow', 'SetLong', 'SetForegroundWindow', 'SetCursorPos', 'mouse_event', 'keybd_event', 'SendKeys', 'CloseWindow', 'WM_CLOSE', 'Stop-Process', 'taskkill']) {
  assert(!reloadBlock.includes(forbidden), `-ReloadProject 分支里不允许出现 ${forbidden}（重载只允许"读菜单栏 + PostMessage"）`)
}
assert(reloadBlock.includes('GetMenu('), '-ReloadProject 必须用 GetMenu 读原生菜单栏')
assert(reloadBlock.includes('GetMenuItemCount('), '-ReloadProject 必须枚举菜单项')
assert(reloadBlock.includes('MenuText('), '-ReloadProject 必须读菜单项标题')
assert(psSource.includes('extern int GetMenuString('), '读标题必须走 GetMenuStringW（同一份 Add-Type，不另起第二次编译）')
assert(reloadBlock.includes('PostMessage(') && reloadBlock.includes('$WM_COMMAND'), '-ReloadProject 命中白名单时必须 PostMessage(WM_COMMAND)')
// 枚举（读菜单栏）必须发生在几何门槛之前：小窗口不代表"没有重载入口"。
assert(psSource.indexOf('if ($ReloadProject) {') < psSource.indexOf("if ($Width -lt 320 -or $Height -lt 200)"),
  '-ReloadProject 分支必须在 bounds 门槛之前（读菜单栏不需要几何）')
// C：唯一的真 reload 命令是库重载，必须被显式拒绝（size/library 与"库"字两重判据）。
assert(reloadBlock.includes("$caption -match 'library'"), '-ReloadProject 必须拒绝 caption 里含 library 的项')
assert(reloadBlock.includes('$caption.Contains($zhLibrary)'), '-ReloadProject 必须拒绝 caption 里含"库"字的项（Try To Reload Library）')
assert(!/['"][^'"]*[\u4e00-\u9fff][^'"]*['"]/.test(psSource), '中文字面量必须用码点拼（ASCII-only 源文件），不许直接写字面中文')
assert(psSource.includes('$reloadCaptions = @('), '-ReloadProject 必须有精确标题白名单')
for (const reason of ['no-native-menubar', 'no-reload-command']) {
  assert(reloadBlock.includes(`'${reason}'`), `-ReloadProject 必须回报 ${reason}`)
}
assert(reloadBlock.includes('scanned = $scanned'), '-ReloadProject 必须回报"已扫过多少项"这一事实')

// ── A/B. 主进程：一条新通道，只允许 CODESYS 面板调；不做任何"关/重启"动作 ──────────────────
assert(mainSource.includes("handleTrusted('codesys:native-host-reload-project'"), 'main.js 必须注册 codesys:native-host-reload-project')
const panelOnly = /CODESYS_PANEL_ONLY_CHANNELS = new Set\(\[([\s\S]*?)\]\)/.exec(mainSource)
assert(panelOnly && panelOnly[1].includes("'codesys:native-host-reload-project'"), '重载通道必须登记在 CODESYS_PANEL_ONLY_CHANNELS 里（只有面板能触发）')
const handlerStart = mainSource.indexOf("handleTrusted('codesys:native-host-reload-project'")
const handlerBlock = mainSource.slice(handlerStart, mainSource.indexOf("handleTrusted('codesys:ai-chat'"))
for (const forbidden of ['kill(', 'app.quit', 'mainWindow.close', 'codesysNativeHost.stop', 'detach(']) {
  assert(!handlerBlock.includes(forbidden), `重载通道里不允许出现 ${forbidden}（重载不是重启、不是脱管）`)
}
assert(handlerBlock.includes('codesysNativeHost.reloadProject('), '重载通道必须把动作交给原生托管层（不要在 IPC 层自己写窗口逻辑）')

// ── 预加载：新通道只有这一个 preload 方法，且方法名不许出现在 DSH 客户端 bundle 里 ───────────
assert(preloadSource.includes("ipcRenderer.invoke('codesys:native-host-reload-project')"), 'preload.js 必须暴露 codesys:native-host-reload-project')
const dshBundle = read(path.join('plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js'))
assert(!dshBundle.includes('taskhive.codesysNativeHostReloadProject'), 'DSH 客户端 bundle 不许通过 preload 调重载（只有外壳 CODESYS 面板能触发）')

// ── 渲染层：只有那枚按钮的点击会走到 IPC；不点就什么都不发生 ──────────────────────────────────
const callSites = rendererSource.match(/window\.taskhive\.codesysNativeHostReloadProject\(/g) || []
assert.equal(callSites.length, 1, '渲染层里调用重载 IPC 的落点必须恰好一处')
const reloadFnStart = rendererSource.indexOf('async function codesysAiChatReloadProject()')
const reloadFn = rendererSource.slice(reloadFnStart, rendererSource.indexOf('\nfunction codesysAiChatRepaint()'))
assert(reloadFn.includes('window.taskhive.codesysNativeHostReloadProject('), '那唯一一处 IPC 调用必须在 codesysAiChatReloadProject 里面')
assert.equal((rendererSource.match(/codesysAiChatReloadProject\(/g) || []).length, 2, 'codesysAiChatReloadProject 只能是"定义 + 一处调用"（调用点必须是按钮那一下点击）')
assert(rendererSource.includes("event.target?.closest?.('[data-ai-reload-project]')"), '那唯一一处调用必须挂在 [data-ai-reload-project] 的点击委托上')
// 幂等：busy 时直接返回（连点不会叠出第二次 IPC）。
assert(/if \(state\.codesysAiChatReload\?\.state === 'busy'\) return/.test(reloadFn), '重载必须幂等：在途时直接返回')
// 两处都是"行为测试抓出来的真 bug"，在这里钉成静态回归闸：
//   ① 完成态如果把 `signature` 丢掉，紧接着一次**带着同一份提案**的陈旧轮询就会把这一段擦掉
//      （用户刚得到的按钮凭空消失）；所以三处赋值都必须先铺开 `base`（written + signature）。
assert(reloadFn.includes('const base = { written: Number(state.codesysAiChatReload?.written || 0), signature: String(state.codesysAiChatReload?.signature || \'\') }'),
  '重载状态必须一路保留 signature/written（丢失会让按钮被一次陈旧轮询擦掉）')
assert.equal((reloadFn.match(/\.\.\.base/g) || []).length, 3, 'busy / 成功 / 抛错三处赋值都必须铺开 base')
//   ② 撤掉那一段的判据必须是"**换了另一份**提案"，不是"有提案"。
assert(rendererSource.includes("capabilitySignature !== String(state.codesysAiChatReload.signature || '')"),
  '撤掉那一段的判据必须是"不同签名"（否则写入成功后的一次陈旧轮询就会把按钮擦掉）')
// 那一段只在"写入成功"之后才存在 —— 没有成功写入过时 `codesysAiChatReload` 是 null。
assert(rendererSource.includes('codesysAiChatReload: null }'), '抽屉状态里 codesysAiChatReload 初值必须是 null（成功写入前不画那一段）')
const successPath = rendererSource.slice(rendererSource.indexOf('async function codesysAiChatConfirmWrite'), rendererSource.indexOf('function codesysAiChatOpenHomeAnswer'))
assert(successPath.includes("state.codesysAiChatReload = { state: 'idle'"), '写入成功分支必须只**画**出那一段（state: idle）')
assert(!successPath.includes('codesysNativeHostReloadProject'), '⚠️ 写入成功**不许**自动重载：重载只能是用户点那枚按钮')
assert(!/setTimeout\([^)]*codesysAiChatReloadProject/.test(rendererSource) && !/setInterval\([^)]*codesysAiChatReloadProject/.test(rendererSource), '重载不许被定时器/轮询触发')
// 失败可见 + 一行原因（含"扫过多少项"这类事实由主进程给）。
assert(reloadFn.includes("state: ok ? 'ok' : 'failed'"), '重载结果必须落成 ok/failed 两态（不静默）')
assert(reloadFn.includes('IPC codesys:native-host-reload-project'), '重载 IPC 抛错时必须把原因写成一行')
// 「为什么不能自动」那一行必须就在按钮旁边（同一段里）。
assert(rendererSource.includes('CODESYS 3.5 没有可编程的重载入口'), '按钮旁必须有一行说明为什么不能自动重载')

// ── 原生托管层：幂等 + 审计 + 一行可读原因 ─────────────────────────────────────────────────
assert(hostSource.includes('reloadProject(target = null)'), 'codesys-native-host.js 必须提供 reloadProject(target)')
assert(hostSource.includes('this.pendingReload') && hostSource.includes('this.reloadBusy'), 'reloadProject 必须自己合并并发调用（幂等）')
assert(hostSource.includes("'-ReloadProject'"), 'reloadProject 必须以 -ReloadProject 调 PowerShell')
assert(hostSource.includes('native-host-reload-invoked') && hostSource.includes('native-host-reload-unavailable') && hostSource.includes('native-host-reload-failed'),
  '三种结果都必须留审计（invoked / unavailable / failed）')
for (const key of ['no-native-menubar', 'no-reload-command']) {
  assert(reloadProjectDetail({ ok: false, invoked: false, reason: key, scanned: 3, topLevelMenus: 'file / edit' }).includes('关闭工程'), `${key} 的可读原因必须给出最短步骤（关闭工程）`)
}
assert(reloadProjectDetail({ ok: false, invoked: false, reason: 'no-reload-command', scanned: 3 }).includes('3'), 'no-reload-command 的原因必须带上"已扫过多少项"这一事实')
assert(reloadProjectDetail({ ok: true, invoked: true, caption: 'reload', commandId: 257 }).includes('257'), '成功路径的原因必须带上真正发出的命令 id')

// ── 行为（离线替身）：幂等 / 失败可见 / 无目标时一次 PowerShell 都不起 ─────────────────────────
const workDir = createTempDir('taskhive-reload-handoff-')
const auditPath = path.join(workDir, 'logs', 'codesys-native-host-audit.jsonl')
const readAudit = () => (fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [])

const window = { id: '0xAAA1', pid: 4242, processName: 'codesys', title: 'CODESYS', width: 1200, height: 800, left: 0, top: 0, usable: true, fixture: true }
const monitor = { async listWindows() { return [{ ...window }] }, cachedWindow() { return { ...window } } }

let windows0 = 0
let reloadAnswers = []
const host = new CodesysNativeHost(workDir, monitor, {
  runProcess: async (_file, args) => {
    windows0 += 1
    assert(args.includes('-ReloadProject'), '重载只允许调 -ReloadProject')
    const answer = reloadAnswers.length ? reloadAnswers.shift() : { ok: true, invoked: true, reason: '', scanned: 2, commandId: 257, caption: 'reload', topLevelMenus: 'file' }
    return { stdout: JSON.stringify(answer) }
  },
})

async function contract() {
  // ① 没有托管 session、也没有给目标 → 一次 PowerShell 都不起（"不点不会发生任何事"的硬证据）。
  const noTarget = await host.reloadProject()
  assert.equal(noTarget.ok, false)
  assert.equal(noTarget.reason, 'no-hosted-window')
  assert.equal(windows0, 0, '没有目标窗口时不许起 PowerShell')
  assert(noTarget.detail.includes('CODESYS 窗口'), '没有目标窗口时必须给一行可读原因')

  // ② 有目标 + 命中白名单 → 真的把 -ReloadProject 发出去，并回报命令 id / 标题。
  const invoked = await host.reloadProject(window)
  assert.equal(invoked.ok, true)
  assert.equal(invoked.invoked, true)
  assert.equal(invoked.caption, 'reload')
  assert.equal(windows0, 1)

  // ③ 幂等：并发三次只产生一次 PowerShell 往返，且三次拿到同一结果。
  windows0 = 0
  reloadAnswers = [{ ok: true, invoked: true, reason: '', scanned: 2, commandId: 258, caption: 'reload', topLevelMenus: 'file' }]
  const [first, second, third] = await Promise.all([host.reloadProject(window), host.reloadProject(window), host.reloadProject(window)])
  assert.equal(windows0, 1, '并发触发必须只产生一次 PowerShell 往返（幂等）')
  assert.equal(first, second, '在途时后到的调用必须复用同一个 Promise')
  assert.equal(second, third, '在途时后到的调用必须复用同一个 Promise')
  assert.equal(first.ok, true)

  // ④ 没有可用入口 → ok:false + 一行可读原因（含扫过条数），并且留一条审计。
  reloadAnswers = [{ ok: false, invoked: false, reason: 'no-reload-command', scanned: 7, commandId: 0, caption: '', topLevelMenus: 'file / project' }]
  const missing = await host.reloadProject(window)
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'no-reload-command')
  assert(missing.detail.includes('7'), '没有入口时的原因必须带上扫过的条数')
  assert(missing.detail.includes('关闭工程'), '没有入口时必须给出最短步骤')

  // ⑤ PowerShell 失败（抖动/超时）→ 一行可读原因 + 审计，绝不静默。
  const failing = new CodesysNativeHost(workDir, monitor, { runProcess: async () => { throw new Error('simulated powershell timeout') } })
  const failed = await failing.reloadProject(window)
  assert.equal(failed.ok, false)
  assert.equal(failed.reason, 'reload-failed')
  assert(failed.detail.includes('simulated powershell timeout'))

  const events = readAudit().map((entry) => entry.event)
  for (const expected of ['native-host-reload-invoked', 'native-host-reload-unavailable', 'native-host-reload-failed']) {
    assert(events.includes(expected), `审计里必须有 ${expected}`)
  }
  assert(!events.some((event) => /closed|killed|quit/.test(event)), '重载审计里不许出现关闭/杀进程类事件')

  console.log(`codesys reload handoff contract passed (${events.length} audited reload events)`)
}

contract().catch((error) => { console.error(error); process.exitCode = 1 })
