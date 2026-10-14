'use strict'

// 本轮 A 项（用户报障原文两条之一）：
//   「残留到代码任务会自动加载到我新打开到程序里面，点击放弃没有反映」
//
// 真因（都在我方，不是"模型"也不是"按钮没画出来"）：
//   ① **提案没有绑定工程身份**。宿主的待领取提案队列只按 `sessionId` 排队（`dsh/index.js` 的
//      `workbenchProposals`），而工作台在**换绑工程之后**会事件式地再领取一次
//      （`bindSourceProject` 末尾的 `claimPendingProposal({ force: true })`）。于是上一个工程
//      留下的待确认提案会在用户新打开另一个工程之后被领走、画在新工程头上。修法：提案随
//      `(工程路径, 绑定源 sha256)` 一起排队，领取时两个都得对上；对不上就**不显示**并写一行说明。
//   ①' 同一条队列还有**更早**的一次领取：挂载 / 回到界面时那次领取排在 `detect → bind → inspect`
//      **之前**。实测那条路上，残留提案会先落进一个**还没有工程**的编辑器；随后绑定虽然清了提案
//      状态，却不会把用户眼前那段 AI 代码收回磁盘版本。修法：没有 jobId 就不放行（提案本来也
//      无处可放：sha 防护、编辑器退回、写入闸门全都以 jobId 为前提）。
//   ② **抽屉那枚「放弃」走的能力面是"安装时"的闭包**。`window.__TASKHIVE_CODESYS_CAPABILITIES__`
//      由 `React.useEffect(…, [])` 只装一次，所以它一直拿着**第一次渲染**的 `discardProposal`；
//      那个闭包里 `jobId` 还是空串 ⇒ "退回磁盘最新版本"那一步被整段跳过：提案与草稿清了，编辑器
//      却还停在被放弃的那份 AI 文本上。修法：seam 经 ref 转派到当次渲染的实现（与组件里
//      `applyAgentProposalRef` / `claimPendingProposalRef` 同一个约定），且 `discardProposal`
//      的重读判据改用 `jobIdRef`。
//
// 这条契约驱动**真实源码**（工作台那半用 `lib/workbench-driver` 渲染真实的 `CodesysWorkbench`，
// 抽屉那条路直接调它发布的同一条能力面 seam；领取时机用事件源——与真机同一条监听器），钉六件事：
//   ⓪ 绑定之前那次领取拿到的残留提案 ⇒ 不显示（编辑器仍是磁盘文本）；
//   ① 残留提案来自**另一个工程** ⇒ 不显示，且只写一行说明；
//   ② 残留提案来自**同一工程、另一版源 sha** ⇒ 同样不显示（身份是两维，不是只比路径）；
//   ③ 同一工程 + 同一 sha ⇒ 提案照常显示（没有把正常路径一起挡掉）；
//   ④ 经能力面 seam 放弃 ⇒ 提案与手写一起消失、**真的重读一次磁盘**（inspect-project 在案）、
//      零写通道动作；
//   ⑤ 两半都必须改到（结构判据：防只改工作台、不改宿主队列）。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createWorkbenchDriver } = require('./lib/workbench-driver')

const appRoot = path.join(__dirname, '..')
const clientFile = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'client.js')
const hostFile = path.join(appRoot, 'plugins', 'installed', 'taskhive-surfaces', 'dsh', 'index.js')

const SESSION_ID = 'session-proposal-binding'
const JOB_ID = 'direct-binding-job'
const PROJECT_A = 'C:\\projects\\alpha.project'
const PROJECT_B = 'C:\\projects\\beta.project'
const SHA_A = 'a1'.repeat(32)
const SHA_B = 'b2'.repeat(32)

const PLC_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', 'END_VAR'].join('\n')
const PLC_IMPLEMENTATION = 'x := x + 1;'
const GVL_DECLARATION = ['VAR_GLOBAL', '  y : INT;', 'END_VAR'].join('\n')
const TYPED_GVL = ['VAR_GLOBAL', '  y : INT;', '  mine : BOOL;', 'END_VAR'].join('\n')
const AI_DECLARATION = ['PROGRAM PLC_PRG', 'VAR', '  x : INT;', '  fromAi : INT;', 'END_VAR'].join('\n')

const SWITCH_NOTICE = '已切换工程，此前的提案不再适用；如需继续请让 AI 重新生成'

function diskObjects () {
  return [
    {
      name: 'PLC_PRG', guid: 'guid-plc-prg', type: 'PROGRAM', hasDeclaration: true, hasImplementation: true,
      declaration: PLC_DECLARATION, implementation: PLC_IMPLEMENTATION,
      path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
    },
    {
      name: 'GVL_Data', guid: 'guid-gvl-data', type: 'GVL', hasDeclaration: true, hasImplementation: false,
      declaration: GVL_DECLARATION, implementation: '',
      path: ['Device', 'PLC Logic', 'Application', 'GVL_Data'],
    },
  ]
}

// 宿主 `pending` 路由的形状（`dsh/index.js` 逐字段构造出来的那一条：id / note / proposal + 工程身份）。
function queuedProposal (id, projectPath, sourceSha256) {
  return {
    id,
    note: '调整 PLC_PRG',
    projectPath,
    sourceSha256,
    proposal: {
      summary: '调整 PLC_PRG',
      changes: [{ operation: 'update-text', objectGuid: 'guid-plc-prg', objectName: 'PLC_PRG', declaration: AI_DECLARATION }],
    },
  }
}

function makeHost ({ sourcePath = PROJECT_A, bindingSha = SHA_A } = {}) {
  const state = { ipc: [], inspectCalls: 0 }
  return {
    state,
    sourcePath,
    bindingSha,
    actions: () => state.ipc.map((item) => item.action),
    run (action, input) {
      state.ipc.push({ action, input })
      if (action === 'bind-project') {
        return { sourcePath: this.sourcePath, jobId: JOB_ID, writeAvailable: true, writeBlockReason: '', baselineSha256: this.bindingSha, currentSha256: this.bindingSha }
      }
      if (action === 'diff') {
        return { ok: true, action: 'diff', jobId: JOB_ID, currentSha256: this.bindingSha, baselineSha256: this.bindingSha, changed: false }
      }
      if (action === 'inspect-project') {
        state.inspectCalls += 1
        return { status: 'complete', payload: { complete: true, textTruncated: false, objects: JSON.parse(JSON.stringify(diskObjects())) } }
      }
      return { status: 'complete', payload: {} }
    },
  }
}

// 领取（pending）的替身。`queue` 是可变的，所以用例可以做到"先绑上工程，再让队列里出现残留
// 提案，然后用**真机同一条事件源**（window focus → recheck → claimPendingProposal({force:true})）
// 触发一次领取"。这样"绑定前 / 绑定后"两条守卫各自被钉住，而不是互相掩盖。
function makeQueue () {
  const queue = { items: [] }
  queue.fetch = async (url) => {
    if (!String(url).endsWith('.pending')) return { ok: true, json: async () => ({ ok: true, value: { accepted: true } }) }
    const deliver = queue.items.splice(0, queue.items.length)
    return { ok: true, json: async () => ({ ok: true, value: { proposals: deliver } }) }
  }
  return queue
}

function makeDriver (host, queue, extraGlobals = {}) {
  return createWorkbenchDriver({
    objects: diskObjects(),
    sourcePath: host.sourcePath,
    jobId: JOB_ID,
    ownerSessionId: SESSION_ID,
    extraGlobals: { fetch: queue.fetch, ...extraGlobals },
    taskhive: {
      currentCodesysProject: async () => ({ found: true, sourcePath: host.sourcePath, detection: 'monitored-window', writeAvailable: true, activeGui: true }),
      runCodesysScriptEngineAction: (action, input) => host.run(action, input),
      codesysOnlineStatus: async () => ({ ok: true, running: false }),
      codesysScriptEngineStatus: async () => ({ ready: true, version: 'V3.5 SP20', missing: [] }),
    },
  })
}

const statusTextOf = (driver) => {
  const value = driver.statusText()
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('') : String(value)
}
const reviewBox = (driver) => driver.find((props) => props['data-codesys-review-accepted'] === 'true')
const discardButton = (driver) => driver.find((props) => props['data-codesys-discard-proposal'] === 'true')

const MUTATING = ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'rollback', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'import-xml']
const writeActions = (actions) => actions.filter((action) => MUTATING.includes(action))

// 真机事件源：回到窗口 = `window` 的 focus → recheck() → detect(silent) + recheckSourceOnDisk + claim。
// 用的是组件自己挂的那条监听器，不是测试另造的一条通路。
const claimByReturningToWindow = async (driver) => {
  driver.scene.fire('window', 'focus', {})
  await driver.settle()
}

// ── ⓪ 身份**未知**（老宿主没有这两个字段 / 绑定 sha 还没到位）⇒ 不判身份，提案照常显示 ────────────
// 判等只在两边都非空时生效：绝不因为"身份未知"而把用户真正在等的那份提案吞掉。
// （另一条守卫 —— "工作台还没有绑定工程时领到的提案不放行" —— 用的是 `jobIdRef`，它由绑定**同步**
//  写入；驱动的时序里那次领取的回包落在 `bind-project` **之后**，所以在这套用具里它总会先看到
//  一个已绑定的工作台、按身份判等走。那条守卫因此只由下面的结构判据 ⑤ 钉住，不在这里假装驱动到。）
async function identityUnknownStillShowsTheProposal () {
  const host = makeHost()
  const queue = makeQueue()
  const driver = makeDriver(host, queue)
  await driver.settle()

  queue.items.push(queuedProposal('unknown-identity', '', ''))
  await claimByReturningToWindow(driver)

  assert.strictEqual(driver.editorValue('declaration'), AI_DECLARATION,
    '身份未知时必须保持既有行为：提案照常落进编辑器（不许因为判不了身份就吞掉它）')
  assert(reviewBox(driver), '它仍然是一份可以逐项审查的待确认差异')
  const status = statusTextOf(driver)
  assert(!status.includes(SWITCH_NOTICE), `身份未知不是"换了工程"：不该出现那句话（实际：${JSON.stringify(status)}）`)
  assert.deepStrictEqual(writeActions(host.actions()), [], '这一趟同样零写通道动作')
  driver.unmount()
  return status
}

// ── ① 残留提案来自**另一个工程** ⇒ 不显示 + 一行说明 ────────────────────────────────────────────
async function staleProposalFromAnotherProjectIsNotShown () {
  const host = makeHost()
  const queue = makeQueue()
  const driver = makeDriver(host, queue)
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION, '起点：已绑定 alpha，编辑器是磁盘文本')

  // 上一个工程留下的残留提案（它是在 alpha 还绑着的时候生成的，但属于 beta）。
  queue.items.push(queuedProposal('stale-project', PROJECT_B, SHA_A))
  await claimByReturningToWindow(driver)

  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION,
    '属于另一个工程的残留提案绝不许画到当前工程上（编辑器必须还是磁盘上的文本）')
  assert.strictEqual(reviewBox(driver), null, '没有可审查的差异：审查勾选框那一段整个不存在（回到空态）')
  assert.strictEqual(discardButton(driver), null, '也不该出现"有一份待放弃提案"才有的那枚按钮')
  const status = statusTextOf(driver)
  assert(status.includes(SWITCH_NOTICE), `必须**写一行**说明提案为何不再适用（实际：${JSON.stringify(status)}）`)
  assert.deepStrictEqual(writeActions(host.actions()), [], '显示判定本身一次写通道动作都不许出现')
  driver.unmount()
  return status
}

// ── ② 同一工程、**另一版源 sha** ⇒ 同样不显示（身份是两维）────────────────────────────────────
async function staleProposalFromAnotherSourceShaIsNotShown () {
  const host = makeHost()
  const queue = makeQueue()
  const driver = makeDriver(host, queue)
  await driver.settle()

  // 路径故意写成正斜杠 + 不同大小写：判等必须走 normalizeCodesysPath（否则这条会假通过）。
  queue.items.push(queuedProposal('stale-sha', 'c:/PROJECTS/Alpha.project', SHA_B))
  await claimByReturningToWindow(driver)

  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION,
    '同一个工程但源 sha 已经不同 ⇒ 那份提案也不再适用（不显示）')
  assert.strictEqual(reviewBox(driver), null, '同样不该留下任何待审查差异')
  const status = statusTextOf(driver)
  assert(status.includes(SWITCH_NOTICE), `源 sha 对不上时也要说一行（实际：${JSON.stringify(status)}）`)
  assert.deepStrictEqual(writeActions(host.actions()), [], '这一趟同样零写通道动作')
  driver.unmount()
  return status
}

// ── ③ 同一工程 + 同一 sha ⇒ 提案照常显示（没有把正常路径一起挡掉）──────────────────────────────
async function sameProjectAndShaStillShowsTheProposal () {
  const host = makeHost()
  const queue = makeQueue()
  const driver = makeDriver(host, queue)
  await driver.settle()

  // 路径大小写/分隔符不同但**归一化后相同** —— 正常那条路必须照旧走通。
  queue.items.push(queuedProposal('same-identity', 'c:/PROJECTS/Alpha.project', SHA_A))
  await claimByReturningToWindow(driver)

  assert.strictEqual(driver.editorValue('declaration'), AI_DECLARATION,
    '同一工程 + 同一源 sha 的提案必须照常落进编辑器（判等不许把正常路径一起挡掉）')
  assert(reviewBox(driver), '它仍然是一份可以逐项审查的待确认差异')
  const status = statusTextOf(driver)
  assert(!status.includes(SWITCH_NOTICE), `正常路径上不该出现"已切换工程"那句话（实际：${JSON.stringify(status)}）`)
  driver.unmount()
  return status
}

// ── ④ 经能力面 seam 放弃（＝抽屉那枚按钮那条路）⇒ 真的重读磁盘 + 零写通道 ───────────────────────
async function seamDiscardRereadsDiskAndWritesNothing () {
  const host = makeHost()
  const queue = makeQueue()
  const driver = makeDriver(host, queue)
  await driver.settle()
  queue.items.push(queuedProposal('seam-discard', PROJECT_A, SHA_A))
  await claimByReturningToWindow(driver)
  assert.strictEqual(driver.editorValue('declaration'), AI_DECLARATION, '起点：提案已经在编辑器里')

  // 用户另外手打一处（切走别的对象再切回来 —— 走 T096 的草稿表那条路）。
  driver.clickTreeRow('GVL_Data')
  driver.typeInEditor('declaration', TYPED_GVL)
  driver.clickTreeRow('PLC_PRG')
  assert.strictEqual(driver.treeChangeState('GVL_Data'), 'manual', '手写改动必须在案')

  const seam = driver.scene.window.__TASKHIVE_CODESYS_CAPABILITIES__
  assert(seam && typeof seam.discard === 'function', '工作台必须发布只读能力面 seam（抽屉那条路就是它）')
  const before = seam.read()
  assert(before.proposal, '能力面上必须看得到那份待确认提案')

  const readsBefore = host.state.ipc.length
  const outcome = await seam.discard({ proposalSignature: String(before.proposal.signature || '') })
  await driver.settle()
  const during = host.actions().slice(readsBefore)

  assert.strictEqual(outcome.ok, true, `放弃必须真的生效（实际：${JSON.stringify(outcome)}）`)
  assert.strictEqual(outcome.hadProposal, true, '回报里必须说清"确实丢掉了一份提案"')
  assert.strictEqual(outcome.droppedDrafts, 1, '手写处数必须由工作台自己数出来（1 处）')
  assert.strictEqual(outcome.editorReloaded, true,
    '编辑器必须真的退回磁盘最新版本 —— 这一条就是"放弃没有反映"的真因：安装时那个 seam 闭包里 jobId 是空串，这一步被整段跳过')
  assert(during.includes('inspect-project'),
    `退回磁盘最新版本必须真走一次只读 inspect-project（实际动作：${during.join(',') || '(none)'}）`)
  assert.deepStrictEqual(writeActions(during), [], `放弃绝不许写工程 / 编译 / 回滚（实际：${writeActions(during).join(',')}）`)

  assert.strictEqual(driver.editorValue('declaration'), PLC_DECLARATION, '编辑器逐字退回磁盘上的声明')
  assert.strictEqual(driver.editorValue('implementation'), PLC_IMPLEMENTATION, '实现那一段同样退回磁盘')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), '', '提案的待写入标记必须消失')
  assert.strictEqual(driver.treeChangeState('GVL_Data'), '', '手写草稿的标记同样必须消失')
  assert.strictEqual(reviewBox(driver), null, '提案与审查状态一起作废（回到空态）')
  assert.strictEqual(discardButton(driver), null, '没有待放弃内容 ⇒ 那枚按钮不出现')
  assert.strictEqual(seam.read().proposal, null, '能力面投影里也不能再有那份提案')
  const status = statusTextOf(driver)
  assert(status.includes('已放弃此提案与 1 处手写改动'), `一行必须说清丢了什么（实际：${JSON.stringify(status)}）`)
  driver.unmount()
  return { status, during }
}

// ── ⑤ 结构判据：两半都得改到（防只改一半）────────────────────────────────────────────────────
function bothHalvesCarryTheIdentity () {
  const client = fs.readFileSync(clientFile, 'utf8')
  // 工作台那半：seam 必须**转派到当次渲染**的实现（否则抽屉那条路永远走第一次渲染的闭包），
  // 领取时必须按工程身份过滤 + 没有 jobId 就不放行，并且把绑定身份发布给宿主。
  assert(client.includes('capabilityDiscardRef.current(input)'),
    '能力面的 discard 必须经 ref 转派到当次渲染的实现（安装时闭包是 fix 前的真因）')
  assert(client.includes('capabilityApplyRef.current(input)'),
    '能力面的 apply 同理（两枚按钮走同一条 seam）')
  assert(/differentProject \|\| differentSource/.test(client),
    '领取待确认提案时必须同时比对工程路径与源 sha256')
  assert(client.includes('if (!jobIdRef.current) { unboundProposals += 1; continue }'),
    '还没有绑定工程时领到的提案必须被挡下（绑定前那次领取是真的会走到的）')
  assert(client.includes('sourceSha256: String(bindingShaRef.current'), '绑定身份必须随活状态发布给宿主')

  // 宿主那半：队列条目必须记住身份，pending 路由必须把它交回领取方。
  const host = fs.readFileSync(hostFile, 'utf8')
  assert(host.includes('projectPath: String(identity?.projectPath'), '排队时必须记住这份提案是给哪个工程的')
  assert(host.includes('sourceSha256: String(identity?.sourceSha256'), '排队时同样必须记住绑定时的源 sha256')
  assert(host.includes('projectPath: String(item.projectPath'), 'pending 路由必须把工程身份交回领取方（否则工作台无从判等）')
  console.log('[自测⑤] 结构判据：seam 经 ref 转派 ✓ · 领取按 (路径, sha) 判等 ✓ · 未绑定不放行 ✓ · 宿主排队/pending 都带身份 ✓')
}

async function main () {
  const unknownIdentity = await identityUnknownStillShowsTheProposal()
  const anotherProject = await staleProposalFromAnotherProjectIsNotShown()
  const anotherSha = await staleProposalFromAnotherSourceShaIsNotShown()
  const same = await sameProjectAndShaStillShowsTheProposal()
  const seam = await seamDiscardRereadsDiskAndWritesNothing()
  bothHalvesCarryTheIdentity()
  console.log('[自测⓪] 身份未知 → 提案照常显示（判等只在两边都非空时生效；状态行不含"已切换工程"）')
  console.log(`[自测①] 另一工程残留提案 → 不显示；一行="${anotherProject}"`)
  console.log(`[自测②] 同工程另一版 sha → 不显示；一行="${anotherSha}"`)
  console.log('[自测③] 同工程 + 同 sha → 提案照常显示（状态行不含"已切换工程"）')
  console.log(`[自测④] 经能力面 seam 放弃 → 动作=${seam.during.join(',')}；写通道=${writeActions(seam.during).length} 次；一行="${seam.status}"`)
  console.log('codesys proposal project binding behaviour passed (提案绑定 (工程路径, 源 sha256)；身份未知不误伤；抽屉那条路放弃会真的重读磁盘且零写通道)')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
