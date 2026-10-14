'use strict'

// Contract (T199): 「代码任务」 must bind by the PID this plugin LAUNCHED, not by the one
// HWND value the panel happens to remember.
//
// 现场（2026-10-08，用户报「面板检测到并绑定成功，点代码任务却被拒」）逐字可查：
//   · `codesys-launched.json.bak`  本插件启动过 PID 10308（`codesys.open-program` 01:15:33Z）；
//   · `codesys-native-host-audit.jsonl` 01:15:38Z attached win=0x1204AC pid=10308，
//     01:16:49Z `native-host-window-lost reason=hwnd-destroyed replacementId=0x1304AC`，
//     01:16:50Z attached win=0x1304AC + `native-host-window-replaced`（CODESYS 启动时换了顶层窗口）；
//   · `trajectory.jsonl` 01:15:37Z 之后再没有任何 `codesys.list-windows` —— 面板的下拉框
//     从此没有被重新枚举过，它手里一直是**已销毁**的 0x1204AC；
//   · `renderer-console.log` 01:27:26Z–01:36:35Z **13 次**
//     `codesys:workbench-open` → 「工作台只能绑定由当前插件打开的 CODESYS 窗口」。
// 结论：旧句柄 + `resolveWindow` 只按句柄精确匹配（它没有归属过滤，`listWindows` 连外部窗口
// 一起返回）⇒ 拒绝，而原因与事实相反（那个进程正是本插件启动的）。
//
// 这里钉住四件事（真源码 + 真模块，`electron` 只做最小替身，不启动 Electron / PowerShell）：
//   ① 同一 PID 换了新顶层窗口 → 仍能绑上（修复点）；
//   ② 非本插件启动的 PID → 依旧被拒（安全意图不退化），且"谎报 PID"也拉不进外部窗口；
//   ③ 归一属于 T194 的集合：本次登记 ∪ 上一轮 `codesys-launched.json` 记录，别的一律不算；
//   ④ 工程文件被外部改过（sha 变）时既有三态守卫仍在写入之前、仍需**显式**确认，
//      而这次改动本身一个字节都不写工程、不重建基线。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

// `app/windows-monitor.js` 是全仓唯一 require('electron') 的应用模块（desktopCapturer，属被删掉的
// 实时监视那一半）。窗口解析这条链一次都不碰它，所以这里注入最小替身，而不是为了一个契约去起 Electron。
const realLoad = Module._load
Module._load = function taskhiveContractElectronStub (request, parent, isMain) {
  if (request === 'electron') return { desktopCapturer: { getSources: async () => [] } }
  return realLoad.call(this, request, parent, isMain)
}

const { CodesysWindowOwnership } = require('../app/codesys-window-ownership')
const { CodesysWindowMonitor } = require('../app/windows-monitor')
const { createTempDir } = require('./lib/temp-dir')

const appRoot = path.join(__dirname, '..')
const mainFile = path.join(appRoot, 'app', 'main.js')
const mainSource = fs.readFileSync(mainFile, 'utf8')
const monitorSource = fs.readFileSync(path.join(appRoot, 'app', 'windows-monitor.js'), 'utf8')
const ownershipSource = fs.readFileSync(path.join(appRoot, 'app', 'codesys-window-ownership.js'), 'utf8')
const workbenchShard = fs.readFileSync(path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'src', '50-codesys-workbench.js'), 'utf8')

const tempRoot = createTempDir('taskhive-codesys-workbench-rebind-')

// A monitor whose enumeration is a plain array — no PowerShell, no timing.
function monitorFor (ownership, initialWindows) {
  const monitor = new CodesysWindowMonitor(tempRoot, { ownership })
  let live = initialWindows
  monitor.listRawWindows = async () => live
  monitor.setLive = (next) => { live = next }
  return monitor
}

// The exact incident's fixtures: launch-sized frame first, real IDE frame after the swap.
const PLUGIN_PID = 10308
const EXTERNAL_PID = 4242
const launchWindow = { id: '0x1204AC', pid: PLUGIN_PID, title: 'CODESYS ', width: 482, height: 1085, usable: true, visible: true, styleVisible: true }
const replacementWindow = { id: '0x1304AC', pid: PLUGIN_PID, title: 'FiveDofPlatform0921.project - CODESYS ', width: 1402, height: 1084, usable: true, visible: true, styleVisible: true }
const externalWindow = { id: '0x777', pid: EXTERNAL_PID, title: 'manual.project - CODESYS', width: 1723, height: 1035, usable: true, visible: true, styleVisible: true }

async function main () {
  // ── ① 同一 PID 换了顶层窗口 → 仍能绑上 ────────────────────────────────────────
  {
    let now = 1_000_000
    const ownership = new CodesysWindowOwnership({ now: () => now, discoveryWindowMs: 60_000, settleWindowMs: 500 })
    ownership.registerPid(PLUGIN_PID, { profile: 'CODESYS V3.5 SP20 Patch 4' })
    const monitor = monitorFor(ownership, [launchWindow])

    const bound = await monitor.resolveOwnedWindow(launchWindow.id, PLUGIN_PID, { launchedPids: [] })
    assert.strictEqual(bound?.id, launchWindow.id, 'a plugin-launched window must bind on the first try')

    // The session runs long enough that the registration freezes (the field timeline: 71 s).
    // Freezing is decided inside observeWindows (i.e. on an enumeration), so settle it here.
    now += 61_000
    await monitor.listWindows()
    assert.strictEqual(ownership.snapshot().registrations[0].state, 'frozen', 'the registration must have settled before the swap')

    // CODESYS destroys its top-level HWND and creates a new one; the panel still holds the OLD id.
    monitor.setLive([replacementWindow])
    const rebound = await monitor.resolveOwnedWindow(launchWindow.id, PLUGIN_PID, { launchedPids: [] })
    assert.ok(rebound, 'the remembered handle is gone — binding must re-resolve the plugin-launched PID, not refuse')
    assert.strictEqual(rebound.id, replacementWindow.id, 'the CURRENT top-level window of that PID is what the workbench binds')
    assert.strictEqual(ownership.ownsWindow(replacementWindow), true, 'the replacement handle must become owned (same-pid-hwnd-replacement)')

    // Same failure shape, but before the registration freezes: the fresh remember path agrees.
    let freshNow = 2_000_000
    const fresh = new CodesysWindowOwnership({ now: () => freshNow, discoveryWindowMs: 60_000 })
    fresh.registerPid(PLUGIN_PID)
    const freshMonitor = monitorFor(fresh, [launchWindow])
    await freshMonitor.resolveOwnedWindow(launchWindow.id, PLUGIN_PID, { launchedPids: [] })
    freshMonitor.setLive([replacementWindow])
    assert.strictEqual((await freshMonitor.resolveOwnedWindow(launchWindow.id, PLUGIN_PID, { launchedPids: [] }))?.id, replacementWindow.id,
      're-binding must not depend on the freeze having happened')
  }

  // ── ② 外部窗口：依旧被拒，而且谎报 PID 也拉不进来 ─────────────────────────────
  {
    const ownership = new CodesysWindowOwnership({ now: () => 3_000_000 })
    ownership.registerPid(PLUGIN_PID)
    const monitor = monitorFor(ownership, [externalWindow])

    assert.strictEqual(await monitor.resolveOwnedWindow(externalWindow.id, EXTERNAL_PID, { launchedPids: [] }), null,
      'a window of a process this plugin never launched must stay refused (ownership is not widened)')
    assert.strictEqual(await monitor.resolveOwnedWindow(externalWindow.id, PLUGIN_PID, { launchedPids: [] }), null,
      'a caller that names a plugin PID while pointing at a foreign window must still get nothing: selection is confined to that same PID')
    assert.strictEqual(await monitor.resolveOwnedWindow('0xDEADBEE', PLUGIN_PID, { launchedPids: [] }), null,
      'a plugin PID with no window on screen must not produce a window from anywhere else')

    // ── ③ 归属集合 = 本次登记 ∪ 上一轮记录（T194 的 codesysReviveOwnedPids） ─────
    const leftover = { id: '0x900', pid: 5150, title: 'leftover.project - CODESYS', width: 1600, height: 1000, usable: true, visible: true, styleVisible: true }
    const leftoverMonitor = monitorFor(new CodesysWindowOwnership({ now: () => 3_100_000 }), [leftover])
    assert.strictEqual(await leftoverMonitor.resolveOwnedWindow('0xSTALE', 5150, { launchedPids: [] }), null,
      'a PID nobody recorded must not become bindable')
    assert.strictEqual((await leftoverMonitor.resolveOwnedWindow('0xSTALE', 5150, { launchedPids: [5150] }))?.id, leftover.id,
      'a PID the previous run recorded in logs/codesys-launched.json is plugin-owned and must bind (no live registration survives an app restart)')
    assert.strictEqual(await leftoverMonitor.resolveOwnedWindow('0xSTALE', 6000, { launchedPids: [5150] }), null,
      'the recorded-PID set is a strict allow-list: another process cannot borrow it')
    assert.strictEqual(await leftoverMonitor.resolveOwnedWindow('0xSTALE', 0, { launchedPids: [5150] }), null,
      'with no PID to ask about, the resolver must answer nothing rather than guess one')
  }

  // ── ④ 原有正常路径不回归 ────────────────────────────────────────────────────
  {
    const ownership = new CodesysWindowOwnership({ now: () => 4_000_000 })
    ownership.registerPid(PLUGIN_PID)
    const monitor = monitorFor(ownership, [launchWindow, replacementWindow])

    // The plain path (handle still alive) is unchanged.
    assert.strictEqual((await monitor.resolveOwnedWindow(replacementWindow.id, PLUGIN_PID, { launchedPids: [] }))?.id, replacementWindow.id)
    // `resolveWindow` keeps its own semantics for every other caller (preferred-window, project detection).
    assert.strictEqual((await monitor.resolveWindow(replacementWindow.id))?.id, replacementWindow.id,
      'resolveWindow must still resolve by exact handle — other callers rely on that')
    assert.strictEqual(await monitor.resolveWindow('0xDEADBEE'), null,
      'resolveWindow still answers null for a handle that is no longer enumerated')

    // Isolated smoke fixtures must keep binding (the smoke path has no real PID at all).
    const fixtureOwnership = new CodesysWindowOwnership({ allowFixtures: true })
    const fixture = { id: '0x300', pid: 0, title: 'CODESYS TaskHive Media Fixture A', width: 960, height: 540, usable: true, fixture: true }
    const fixtureMonitor = monitorFor(fixtureOwnership, [fixture])
    assert.strictEqual((await fixtureMonitor.resolveOwnedWindow(fixture.id, 0, { launchedPids: [] }))?.id, fixture.id,
      'the isolated smoke fixture must still bind')

    // The refused case must still be a plain refusal for an unknown window (no invented ownership).
    assert.strictEqual(await monitor.resolveOwnedWindow('0x404', 0, { launchedPids: [] }), null)
  }

  // ── source shape: the handler binds by PID and writes nothing ───────────────
  {
    const channel = "handleTrusted('codesys:workbench-open'"
    const start = mainSource.indexOf(channel)
    assert(start > 0, 'main.js must register codesys:workbench-open')
    const end = mainSource.indexOf('\n  handleTrusted(', start + channel.length)
    assert(end > start, 'the workbench-open handler must be sliceable')
    const handler = mainSource.slice(start, end)

    assert(handler.includes('monitor.resolveOwnedWindow('),
      'the workbench must bind through the ownership-stable resolver, not the exact-handle lookup')
    assert(handler.includes('codesysReviveOwnedPids()'),
      'the plugin-owned PID set must be the T194 one (current registrations + records from the previous run)')
    assert(handler.includes("type:'codesys.workbench.open'"),
      'the handler must still deliver the same workbench-open message (nothing else opened it)')
    assert(handler.includes('CODESYS_WORKBENCH_WINDOW_NOT_OWNED'),
      'the refusal code must stay the one the panel already reports')

    // This change is about identity only: it must not write a project, rebuild a baseline or
    // touch the scriptengine (the write path is guarded elsewhere, by design).
    for (const forbidden of ['writeFileSync', 'baselineSha256', 'codesysScriptEngine', 'apply-and-build', 'commitProject']) {
      assert(!handler.includes(forbidden), `窗口归属修复不得碰写入通路（发现 ${forbidden}）`)
    }

    // The resolver itself must consult ownership and must not shell out to anything new.
    assert(monitorSource.includes('async resolveOwnedWindow('), 'windows-monitor.js must own the PID-stable resolver')
    assert(monitorSource.includes('this.ownership.ownsWindow(exact)'),
      'the exact-handle hit must still be filtered by ownership (listWindows returns external windows too)')
    assert(ownershipSource.includes('ownedPidForWindow(') && ownershipSource.includes('windowForOwnedPid('),
      'the ownership registry must be able to answer "which plugin PID owns this handle" and "which window does that PID have now"')
  }

  // ── ③(baseline sha) 外部改过工程：三态守卫仍在写入之前，仍需显式确认 ─────────
  {
    const guardAt = workbenchShard.indexOf('const guard = await checkSourceUnchanged(jobId)')
    const applyCallAt = workbenchShard.indexOf("run('apply-and-build'")
    assert(guardAt > 0 && applyCallAt > guardAt,
      'the sha tri-state guard (checkSourceUnchanged) must still run BEFORE apply-and-build')
    assert(workbenchShard.includes("if (current !== baseline) return { ok: false, reason: 'changed', baseline, current }"),
      'a changed baseline must be reported as `changed`, never silently adopted')
    assert(workbenchShard.includes("return { ok: false, reason: changed ? 'source-changed' : 'unverifiable', detail, needsOverwriteConfirmation: true"),
      'the changed/unverifiable answer must carry a NEEDS-CONFIRMATION flag instead of writing')
    assert(workbenchShard.includes("acceptLabel: '我已确认，继续写入'"),
      'the write must require an explicit confirmation phrase from the user')
    assert(workbenchShard.includes('const detail = changed')
      && workbenchShard.includes('基线 sha256 ${String(guard.baseline).slice(0, 16)}'),
      'the change must be explained as ONE readable line naming both hashes')
  }

  process.stdout.write('codesys workbench PID-stable window binding contract tests passed\n')
}

main().catch((error) => {
  console.error(`codesys workbench PID-stable window binding contract tests failed: ${error.message}`)
  process.exitCode = 1
})
