'use strict'

// T215 / 用户报障原文：
//   「登录上了，codesys工作台显示到在线值太抽象了根本没法看，不能在原来到代码编辑区
//     直接高亮替换变量？ 而且对话依然读取不到在线变量」
// 本轮（样式 A，用户拍板）用户报障原文：
//   「在线值依然显示的太难看了，为什么不可以把在线值直接替换代码编辑区到变量？？？而且显示
//     不全？我滚动到时候底下很多都没有加载」
//
// 这一条只管显示形态（A 项）：**值就地紧跟在每一个变量 token 后面**（同一行、同一段流），
// 不再有第三列、不再有固定列宽、不再有 overflow:hidden/省略号。后半句（B 项，读值）在
// codesys-ai-online-readonly-contract.js 里，是真机数据驱动的断言。
//
// 现场真机帧（C:\TaskHive\...\jobs\direct-1791453468383-cf2c7a96\online\
// online-result-185b9426ffff-149.json，用户 18:03 已经登录）里的值就是这里的 fixture：
//   expressions: startMove iAxis MaxVel bcontrol log_msg fbMove6DOF.Busy …
//   values:      FALSE    INT#0 UDINT#2048576000 UINT#0 ''  ''  ''  ''
// 三个"太抽象/显示不全"的来源在这一条里逐个钉住：
//   ① ScriptEngine 回报的是**带类型前缀的 IEC 字面量**（`INT#0`），原生 CODESYS 显示的是
//      值本身（`0`）—— 显示上去前缀，原始回报留在数据属性/title 里；
//   ② 值原来被挤在一个 58px 的窄列里被 `overflow:hidden` 裁掉 —— 现在值就在代码流里，
//      没有任何盒子能裁它；
//   ③ 那个窄列还是靠 translateY 跟随滚动的，而 `overflow:hidden` 会把超出自身盒子的内容
//      就地裁掉 —— 平移永远只能露出开头十几行，所以"滚到底很多行没有值"。现在整份镜像都在
//      一个 `overflow:visible` 的层里，由上层 surface 做唯一的窗口裁剪。
//
// 这条测试渲染**真的** CodesysWorkbench 组件（见 lib/workbench-driver），并且只通过
// 用户真的做得到的动作驱动它：点项目树、在代码编辑区打字、登录/退出登录（宿主回报的
// `state.isLoggedIn`）。
//
// 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：代码编辑区那一枚
// 「在线值 开/关」开关**整段删除**了。于是这条测试的驱动信号也换了：
//   · 原来 = 点那枚开关（默认关、状态记忆、未登录 disabled）；
//   · 现在 = **登录状态本身** —— 已登录到应用 ⇒ 值自动出现（不用点任何东西）；
//     未登录（含退出登录）⇒ 不读值、不画值，编辑栏保持可编辑。
// 开关"不存在"本身也是断言的一部分（DOM 里没有那枚按钮、没有旧文案/title、bundle 里没有
// 它的状态/记忆键/样式规则）。T217/T218 的全部成果一条都不动：登录后冻结只读、值就地跟在
// 每个变量后面、稳定槽、只更新变化的行、滚动/选中不被打断、永不裁切、未知 `—`、
// 显示去 IEC 前缀而 raw 留在数据属性与 title 上。
//
// ── 本轮修正：**消掉"登录时那一次右推"**（镜像层不再抢在首笔读数之前画 `—`）────────────
// T219 留下的取舍（原文）：「登录瞬间会有一次右推 —— 镜像层先画 `—`（槽宽 = 该 IEC 类型的
// 最大十进制宽度），首笔真值若更宽（STRING/LREAL/TIME floor=0、FB 成员摘要）则扩槽一次，
// 之后只增不减、不再移动」。
// 成因：`floor=0` 的类型给不出宽度上限，`—` 只占 1 个字；首笔真值比它宽时稳定槽扩一次，
// 那一刻它后面的代码右移一次。
// 修法（客户端 `50-codesys-workbench.js`，**只加一道总闸**）：**等到首笔读数到达再一起画** ——
// 首笔读数回来之前一个值都不画（连 `—` 都不画）。于是每个位置**第一次**画出来时槽宽就已经是
// 真实值定下来的终态（第一次写进 `onlineValueSlotRef` 的就是它），"只增不缩"不会在登录时被
// 触发；`floor>0` 的整数型照旧先用类型下限（它们本来就不会推）；`—` 仍然只属于"这批读数里
// 真的没有它"的位置（更淡、无 raw、共用稳定槽）。总闸的判据仍是**登录状态本身** —— 那个闩
// 只是"登录后第一笔读数的回执"，不需要任何点击、没有任何记忆、不新增定时器/读取/开关。
// 这条测试把"读数何时返回"交给测试自己（可控替身），于是修复前后两个时刻都能逐个钉住：
//   ① 已登录、首笔读数未回 ⇒ 两个区**一个值 span 都没有**（登录本身不改变版面）；
//   ② 首笔读数到达那一帧起：floor=0 的位置第一次画出来就是真实值宽度，随后连续两帧逐字段
//      相同 ⇒ 值出现之后零位移；③ 未知 `—` 与 MUTATING 0 一条不动。

const assert = require('node:assert')
const { readFileSync } = require('node:fs')
const { createWorkbenchDriver, clientFile } = require('./lib/workbench-driver')

const DECLARATION = [
  'PROGRAM PLC_PRG',
  'VAR',
  '  startMove : BOOL;',
  '  iAxis : INT;',
  '  MaxVel : UDINT;',
  '  bcontrol : UINT;',
  '  log_msg : STRING;',
  '  fbMove6DOF : MC_MoveAbsolute;',
  'END_VAR',
].join('\n')
const IMPLEMENTATION = [
  'IF startMove THEN',
  '  IF iAxis > 0 AND MaxVel > 0 THEN',
  '    bcontrol := bcontrol + 1;',
  '  END_IF',
  'END_IF',
  // 点号路径：值必须落在整条路径**后面**（`fbMove6DOF.Busy —`），不能插进点号中间去。
  // 这两个成员在真机帧里回报的是空串（= 没观测到），所以两处都该是淡色占位符。
  'IF fbMove6DOF.Busy AND fbMove6DOF.Done THEN',
  'END_IF',
].join('\n')

const OBJECTS = [
  {
    name: 'PLC_PRG',
    guid: 'guid-plc-prg',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration: DECLARATION,
    implementation: IMPLEMENTATION,
    path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
  },
]

// The real controller frame, byte for byte from the machine.
const MONITOR_EXPRESSIONS = ['startMove', 'iAxis', 'MaxVel', 'bcontrol', 'log_msg', 'fbMove6DOF.Busy', 'fbMove6DOF.Done', 'fbMove6DOF.Error']
const MONITOR_VALUES = ['FALSE', 'INT#0', 'UDINT#2048576000', 'UINT#0', "''", '', '', '']

// 写工程的动作（分批读值全程必须一个都不出现）。两处断言共用这一份，免得两个列表漂开。
const MUTATING_IPC_ACTIONS = ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'rollback', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'import-xml']

const LOGGED_IN_STATUS = {
  ok: true,
  running: true,
  ready: { deviceName: 'GCAN-PLC-521C' },
  state: {
    connected: true,
    isLoggedIn: true,
    loginMode: 'keep',
    applicationState: 'stop (2)',
    applicationStateLabel: '已停止（STOP）',
    sharedConnected: true,
  },
}

// 未登录到应用（连都没连）：本轮的判据是"登录状态"，所以这个状态必须**不读值也不画值**。
const NOT_LOGGED_IN_STATUS = {
  ok: true,
  running: false,
  state: { connected: false, isLoggedIn: false },
}

function monitorStub (calls) {
  return async (input) => {
    calls.push(input)
    return {
      ok: true,
      applicationState: 'stop (2)',
      expressions: MONITOR_EXPRESSIONS,
      values: MONITOR_VALUES,
      partial: true,
      readMode: 'per-expression',
    }
  }
}

function createDriver (extra = {}) {
  const monitorCalls = []
  const driver = createWorkbenchDriver({
    objects: JSON.parse(JSON.stringify(OBJECTS)),
    onlineStatus: extra.onlineStatus || LOGGED_IN_STATUS,
    taskhive: { monitorCodesysOnline: monitorStub(monitorCalls), ...(extra.taskhive || {}) },
    extraGlobals: extra.extraGlobals,
    round: extra.rounds,
  })
  return { driver, monitorCalls }
}

// The switch, as the operator used to see and click it. Since this round it must NOT exist —
// this is the GLOBAL assertion (it must hold in every login state), not "it is off".
function assertNoSwitch (driver, where) {
  assert.strictEqual(driver.find((props) => 'data-codesys-online-values-toggle' in props), null,
    `${where}: the 「在线值」 switch must not exist in the rendered workbench`)
  assert.strictEqual(driver.find((props) => 'data-editor-online' in props), null,
    `${where}: and its live light (data-editor-online) must not exist either`)
  assert.strictEqual(driver.findAll((props) => String(props.className || '').includes('taskhive-codesys-editor-online')).length, 0,
    `${where}: and no element may carry the deleted switch's class`)
  const texts = driver.nodes().map((node) => textOf(node)).join('\u0001')
  assert(!texts.includes('在线值 开') && !texts.includes('在线值 关'),
    `${where}: neither of the switch's two labels may be rendered anywhere`)
  const titles = driver.nodes().map((node) => String((node.props || {}).title || '')).join('\u0001')
  assert(!titles.includes('在线值'), `${where}: and no element may carry the switch's old title copy`)
}

// 等"值真的到了"：本轮修正之后**镜像层只在首笔读数到达那一刻才出现**（首笔读数回来之前一个
// 值都不画，连 `—` 都不画 —— 见文件头"消掉登录时那一次右推"），所以"镜像层出现"现在**等价于**
// "首笔读数到了"。这里仍然等**真的观测到值**（一个带 data-online-value-raw 的 span），因为它
// 同时覆盖"这一批里全是 `—`"的退化情况。仍然是既有的 1.5 s 节拍，不新增定时器。
async function waitForObservedValues (driver, part, rounds = 12) {
  const hasValue = () => allValueSegments(inlineLines(driver, part))
    .some((item) => item.segment.value.props['data-online-value-raw'] !== undefined)
  for (let i = 0; i < rounds && !hasValue(); i += 1) {
    driver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    driver.render()
  }
  return hasValue()
}

function kids (node) {
  return Array.isArray(node.children) ? node.children : (node.children === undefined || node.children === null ? [] : [node.children])
}

function textOf (node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string') return node
  return kids(node).map(textOf).join('')
}

// One single render pass, so the section context and the value spans come from the SAME
// element tree (comparing props objects across two renders can never match).
//
// 值现在**就在代码流里**（`data-codesys-inline-online` 那一层），所以这里按"段落"取：
// 每个值 span 就是一段，它前面的那一段必须是以变量名结尾的代码文字 —— 这就是"紧跟变量
// token 后面、同一行、同一段流"的可验证形式。
function inlineOverlay (driver, part) {
  const output = driver.render().output
  const found = []
  const walk = (node) => {
    if (!node || typeof node !== 'object' || !('type' in node)) return
    const own = node.props || {}
    if (typeof own['data-codesys-inline-online'] === 'string') {
      found.push({ section: own['data-codesys-inline-online'], node })
      return
    }
    for (const child of kids(node)) walk(child)
  }
  walk(output)
  const hit = found.find((item) => item.section === part)
  return hit ? hit.node : null
}

// 代码编辑框（声明区 / 实现区）本身：只读、让位类、aria 都在它身上。
function editorNode (driver, part) {
  return driver.find((props) => props['data-editor-part'] === part)
}

function inlineLines (driver, part) {
  const overlay = inlineOverlay(driver, part)
  if (!overlay) return new Map()
  const map = new Map()
  for (const line of kids(overlay)) {
    const segments = kids(line).map((child) => (typeof child === 'string'
      ? { text: child }
      : { text: textOf(child), value: child }))
    map.set(Number(line.props['data-line-number']), segments)
  }
  return map
}

function lineMapText (segments) {
  return (segments || []).map((segment) => segment.text).join('')
}

// DOM 里的文字是**紧贴**的：值不是用户代码的一部分，它自己不往代码文本里加任何字符
// （这正是"代码文本一个字符都不许改"）。眼睛看到的那个空格来自值 span 上 3px 的
// CSS 内边距。这个函数把"看得见的那一行"拼出来 —— 值的前后各补一个空格，相邻处本来
// 就有空格就不再补（所以不会出现双空格）。
function lineMapVisibleText (segments) {
  const parts = segments || []
  let out = ''
  parts.forEach((segment, index) => {
    if (!segment.value) { out += segment.text; return }
    if (out && !out.endsWith(' ')) out += ' '
    out += segment.text
    const next = parts[index + 1]
    if (!(next && typeof next.text === 'string' && /^\s/.test(next.text))) out += ' '
  })
  return out
}

function valueSegments (lines, line) {
  return (lines.get(line) || []).filter((segment) => segment.value)
}

// 本轮 A 项（修"一片白"）：镜像层里**值 span 之外**的那部分文字，就是"镜像层画出来的代码"。
// 它必须与编辑框对应行逐字符相等 —— 这是"屏幕上同时有代码和值"的可验证形式。
function codeTextOfLine (segments) {
  return (segments || []).filter((segment) => !segment.value).map((segment) => segment.text).join('')
}

// 四条防回归断言里的 ①③：逐行比对镜像层的代码文字与编辑框该行。
function assertMirrorCarriesTheCode (lines, part, editorText) {
  const expected = String(editorText || '').split('\n')
  assert.strictEqual(lines.size, expected.length,
    `${part}: the mirror must carry every line of the editor text (${lines.size} vs ${expected.length})`)
  let checked = 0
  let withValues = 0
  for (const [lineNumber, segments] of lines.entries()) {
    const editorLine = expected[lineNumber - 1] === undefined ? '' : expected[lineNumber - 1]
    const code = codeTextOfLine(segments)
    assert.strictEqual(code, editorLine,
      `${part} line ${lineNumber}: the mirror's CODE text must equal the editor's line character for character`
      + ` (mirror ${JSON.stringify(code)} vs editor ${JSON.stringify(editorLine)})`)
    checked += 1
    const values = valueSegments(lines, lineNumber)
    if (values.length) {
      withValues += 1
      // ③ 不可能出现"只有值没有代码"的行：这一行有值 ⇒ 它的代码文字必须非空。
      assert(code.length > 0,
        `${part} line ${lineNumber}: a line that carries a value must still show its code (got ${JSON.stringify(code)})`)
      // 值必须落在代码文字**之后**（同一行、同一段流）——空值行不可能"吞掉"整行代码。
      const last = segments[segments.length - 1]
      assert(!last.value || code.length > 0,
        `${part} line ${lineNumber}: a dangling value with no code text is exactly the reported "blank + values" defect`)
    }
  }
  return { checked, withValues }
}

// ② 颜色：镜像层画代码用的颜色不得为透明、不得等于背景色；只有值 span 用灰蓝。
// 规则与主题令牌都从真正运行的 client.js 里解析（不是比字面量）。
function cssRule (source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\{([^}]*)\\}`))
  return match ? match[1] : ''
}

function cssColor (source, rule, property = 'color') {
  const value = (String(rule || '').match(new RegExp(`(?:^|;)${property}:([^;]+)`)) || [])[1] || ''
  const tokenName = (value.match(/var\((--[a-z0-9-]+)/) || [])[1]
  if (!tokenName) return String(value).trim().toLowerCase()
  const tokenValue = (source.match(new RegExp(`${tokenName}:(#[0-9a-fA-F]{3,8})`)) || [])[1] || ''
  return String(tokenValue).trim().toLowerCase()
}

function allValueSegments (lines) {
  const out = []
  for (const [line, segments] of lines.entries()) {
    for (const segment of segments) if (segment.value) out.push({ line, segment })
  }
  return out
}

// 「值紧跟变量 token」：每个值 span 前面那一段文字必须以一条变量路径结尾（整词/整条路径
// 边界，`i` 不命中 `iAxis`、也不命中 `struct.x`），返回这一行上"值所跟随的路径"序列 ——
// 顺序与出现顺序一致。
function valueNamesAfterToken (lines, line) {
  const segments = lines.get(line) || []
  const names = []
  for (let index = 0; index < segments.length; index += 1) {
    if (!segments[index].value) continue
    const before = segments[index - 1]
    const match = before && typeof before.text === 'string'
      ? before.text.match(/(^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/)
      : null
    assert(match, `line ${line}: every value must sit immediately AFTER a variable token in the same text flow`
      + ` (saw ${JSON.stringify(segments.map((item) => item.text))})`)
    names.push(match[2])
  }
  return names
}

async function main () {
  // ── ① 未登录：编辑区里**没有**任何镜像层/值、**没有任何开关元素**、可编辑，
  //    而且**一次值都没读**（未登录 ⇒ 不读也不画）────────────────────────────────
  const first = createDriver({ onlineStatus: NOT_LOGGED_IN_STATUS })
  const driver = first.driver
  await driver.settle()
  driver.clickTreeRow('PLC_PRG')
  await driver.settle()

  // 全局断言"开关不存在"：DOM 里没有那枚按钮、没有它的绿灯、没有旧文案/title。
  assertNoSwitch(driver, 'not logged in')
  assert.strictEqual(driver.editorValue('declaration'), DECLARATION, 'the declaration must load unchanged')
  // 未登录时镜像层**整个不渲染**：版面与原文完全一致，也没有值列。
  assert.strictEqual(inlineOverlay(driver, 'declaration'), null,
    'no inline mirror may be rendered while not logged in (the layout must be the original one)')
  assert.strictEqual(inlineOverlay(driver, 'implementation'), null,
    'no inline mirror may be rendered in the implementation while not logged in')
  assert.strictEqual(driver.findAll((props) => props['data-section-online-values'] === 'true').length, 0,
    'no section may claim to carry online values while not logged in')
  assert.strictEqual(driver.find((props) => props['data-codesys-online-values'] === 'true'), null,
    'and the retired third value column must not come back')
  assert.strictEqual(first.monitorCalls.length, 0,
    'not logged in, the workbench must not read a single value (no read path exists at all)')
  // 未登录 ⇒ 编辑栏保持**可编辑**（T217 的冻结只属于"已登录"这一种状态）。
  const NOT_LOGGED_EDIT = `${DECLARATION}\n(* 未登录时我打得进去 *)`
  driver.typeInEditor('declaration', NOT_LOGGED_EDIT)
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), NOT_LOGGED_EDIT,
    'while NOT logged in the operator can still type (the freeze is about the online login)')
  driver.typeInEditor('declaration', DECLARATION) // 还原，后面的断言都用原文比对
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), DECLARATION, 'the fixture must be back to the original text')
  console.log('[自测] ① 未登录：编辑器里没有任何镜像层/值列（版面=原文）、'
    + '那枚「在线值」开关在 DOM 里**不存在**（marker/绿灯/文案/title 全 0）、编辑栏可编辑，'
    + `而且一次值都没读（monitor 调用 ${first.monitorCalls.length} 次）✓`)

  // ── ② 登录 ⇒ 值**自动**出现（不需要点任何东西），且就地跟在每个变量 token 后面 ──
  const scene = driver.scene
  driver.setOnlineStatus(LOGGED_IN_STATUS)
  await driver.settle()
  assert(first.monitorCalls.length > 0,
    'the application login alone is what starts the (existing) value read — no click of any kind')
  assert(await waitForObservedValues(driver, 'declaration'),
    'the observed values must arrive on their own, with no click of any kind')
  assertNoSwitch(driver, 'logged in')

  const declLines = inlineLines(driver, 'declaration')
  const implLines = inlineLines(driver, 'implementation')
  assert(declLines.size > 0, 'logged in, the declaration must carry per-line value segments on its own')
  assert(implLines.size > 0, 'and so must the implementation')
  assert.strictEqual(driver.findAll((props) => props['data-section-online-values'] === 'true').length > 0, true,
    'the section must advertise that it carries online values')
  // 值列彻底退休：无论登录状态、无论哪个区，都不再有第三列。
  assert.strictEqual(driver.find((props) => props['data-codesys-online-values'] === 'true'), null,
    'the old third value column must be gone for good (values live in the code flow now)')
  assert.strictEqual(driver.findAll((props) => String(props.className || '').includes('taskhive-codesys-online-values')).length, 0,
    'and no element may still carry the retired value-column class')
  // T217：已登录 ⇒ 编辑栏只读冻结（值显示的同时代码仍在，只是打不进字）。
  assert.strictEqual(editorNode(driver, 'declaration').props.readOnly, true,
    'logged in, the editor must be frozen read-only (T217) while the values are on screen')
  console.log('[自测] ② 登录 ⇒ 值**自动**出现（monitor 调用 '
    + `${first.monitorCalls.length} 次，一次点击都没有）、编辑栏 readOnly 冻结（T217）、`
    + `开关在任何登录状态下都不存在 ✓`)

  // ① 每个值都紧跟它所属的变量 token（同一行、同一段流）：
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 3), ['startMove'])
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 4), ['iAxis'])
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 5), ['MaxVel'])
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 6), ['bcontrol'])
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 7), ['log_msg'])
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 8), ['fbMove6DOF'])
  // 一行多个变量：声明区第 3~8 行各一个；实现区第 2 行引用 iAxis + MaxVel 两个、
  // 第 3 行 `bcontrol := bcontrol + 1;` **同一个变量出现两次**，两次都要跟。
  assert.deepStrictEqual(valueNamesAfterToken(implLines, 1), ['startMove'],
    'the implementation line that uses startMove must carry exactly one in-place value')
  assert.deepStrictEqual(valueNamesAfterToken(implLines, 2), ['iAxis', 'MaxVel'],
    'a line that references two declared variables must annotate both, in order')
  assert.deepStrictEqual(valueNamesAfterToken(implLines, 3), ['bcontrol', 'bcontrol'],
    'a variable that appears TWICE on one line must be annotated twice (every occurrence)')
  const implLine2 = valueSegments(implLines, 2)
  assert.strictEqual(implLine2.length, 2, 'a line that references two declared variables must carry two values')
  const implLine3 = valueSegments(implLines, 3)
  assert.strictEqual(implLine3.length, 2,
    'a variable that appears TWICE on one line must be annotated twice (every occurrence)')
  for (const entry of implLine3) {
    assert.strictEqual(lineMapText([entry]) === '0', true, 'each occurrence shows the same current value')
  }
  // 值就在代码流里 —— 段落序列读出来就是"代码 + 值 + 代码 + 值 …"（值是同一段流里的一段，
  // 不是行尾的另一列）。
  assert.strictEqual(lineMapVisibleText(declLines.get(5)), '  MaxVel 2048576000 : UDINT;',
    'the declaration line must read exactly like CODESYS: name, value, then the rest of the line'
    + ` (saw ${JSON.stringify(lineMapVisibleText(declLines.get(5)))})`)
  assert.strictEqual(lineMapText(declLines.get(5)), '  MaxVel2048576000 : UDINT;',
    'and the tight DOM text must be the original code with the value inserted (no character of the'
    + ' operator\'s code may be rewritten; the visible gap is CSS padding, not a character)')
  assert.strictEqual(lineMapVisibleText(implLines.get(2)), '  IF iAxis 0 > 0 AND MaxVel 2048576000 > 0 THEN',
    'the implementation line must read with every referenced value in place'
    + ` (saw ${JSON.stringify(lineMapVisibleText(implLines.get(2)))})`)
  assert.strictEqual(lineMapVisibleText(implLines.get(1)), 'IF startMove FALSE THEN',
    'the first implementation line reads exactly like the native CODESYS online view')
  assert.strictEqual(lineMapVisibleText(declLines.get(8)), '  fbMove6DOF — : MC_MoveAbsolute;',
    'and an unread variable shows the restrained dash in place, not an invented value')
  console.log('[自测] ① 值就地跟在每个变量 token 后面：声明第 5 行 = '
    + `${JSON.stringify(lineMapVisibleText(declLines.get(5)))}；实现第 2 行 = ${JSON.stringify(lineMapVisibleText(implLines.get(2)))}；`
    + `第 3 行同一个变量出现两次 ⇒ 标了 ${implLine3.length} 次 ✓`)

  // ── ①b 本轮 A 项：值在屏幕上时**同时**看得到「代码」和「值」（修"一片白"）──────────
  //
  // 用户报障原文：「开启在线值后会把原来的代码编辑区给覆盖掉，变成一片白和监控过来的值」。
  // 取证（client.js 的样式规则）：值显示时 textarea 的字被 `.is-inline-mirrored` 透明化
  // （`color:transparent!important;caret-color:var(--th-ink)`），而镜像层当时又把**代码文字**
  // 也画成 `color:transparent`（普通字符串段落继承那一层的颜色）⇒ 屏幕上只剩那几个有自己
  // 颜色的值 span。修法：textarea 依旧让位，**由镜像层把整行代码画出来**（正常前景色），
  // 只有值 span 用灰蓝。四条防回归断言（全部按"用户真的看得到什么"判）：
  //   ① 每一行：镜像层的代码文字（值 span 之外的部分）与编辑框该行**逐字符相等**；
  //   ② 镜像层画代码的颜色不得为透明、也不得等于背景色；值 span 必须是另一种颜色；
  //   ③ 不可能出现"只有值没有代码"的行（含值 span 的行必须有对应的代码文字）；
  //   ④ 退出登录 ⇒ 编辑框自己的文字恢复可见（让位规则只挂在 .is-inline-mirrored 上，见 ⑦）。
  {
    const declCheck = assertMirrorCarriesTheCode(declLines, 'declaration', driver.editorValue('declaration'))
    const implCheck = assertMirrorCarriesTheCode(implLines, 'implementation', driver.editorValue('implementation'))
    assert(declCheck.withValues > 0 && implCheck.withValues > 0,
      'both sections must really carry values while the code is being compared')

    // ② 颜色（从真正运行的 client.js 里解析规则与主题令牌）。
    const source = readFileSync(clientFile, 'utf8')
    const mirrorRule = cssRule(source, '.taskhive-codesys-inline-online')
    const mirrorCodeColor = cssColor(source, mirrorRule)
    const surfaceToken = (source.match(/--th-surface:(#[0-9a-fA-F]{3,8})/) || [])[1] || ''
    const valueColor = cssColor(source, cssRule(source, '.taskhive-codesys-inline-value'))
    assert(mirrorRule.includes('overflow:visible'),
      '② the mirror must stay overflow:visible (a clipped mirror can never reveal the lines below its own box)')
    assert(mirrorCodeColor && mirrorCodeColor !== 'transparent',
      `② the mirror layer must NOT paint the code text transparent (resolved ${JSON.stringify(mirrorCodeColor)})`)
    assert(mirrorCodeColor !== String(surfaceToken).toLowerCase(),
      `② the code colour must differ from the editor background (${mirrorCodeColor} vs ${surfaceToken})`)
    assert(valueColor && valueColor !== mirrorCodeColor,
      `② only the value span may use the dimmed grey-blue (value ${valueColor} vs code ${mirrorCodeColor})`)
    // ④ 让位规则只挂在 .is-inline-mirrored 上：镜像层的基样式不许把编辑框的字藏起来。
    assert(!/color:transparent/.test(cssRule(source, '.taskhive-codesys-code-editor')),
      '④ the editor may only go transparent through the .is-inline-mirrored rule, never as its base style')
    const mirroredRule = cssRule(source, '.taskhive-codesys-code-editor.is-inline-mirrored')
    assert(/color:transparent/.test(mirroredRule) && !/color:transparent/.test(mirrorRule),
      '④ the textarea yields and the mirror paints — exactly one of them hides its text, never both')
    // ④（行为）：值显示时 textarea 挂着让位的类，退出登录之后这个类必须消失（见 ⑦）。
    assert(String(editorNode(driver, 'declaration').props.className).includes('is-inline-mirrored'),
      '④ logged in, the textarea must carry the stand-down class (the mirror is drawing the code)')
    // 逐字符对齐的样式前提（用户要求：镜像层与编辑框"字体/字号/行高/内边距/1px 边框抵消"一致）：
    // 任一侧被单独改掉，第 N 行就会漂到别的行上 —— 所以这里把两侧的声明**逐字比对**。
    const declarationOf = (rule, property) => String((String(rule).match(new RegExp(`(?:^|;)${property}:([^;]+)`)) || [])[1] || '').trim()
    const editorRule = cssRule(source, '.taskhive-codesys-code-editor')
    assert(editorRule && mirrorRule, 'both the editor and the mirror rules must be locatable in the bundle')
    for (const property of ['font', 'padding', 'box-sizing']) {
      assert.strictEqual(declarationOf(mirrorRule, property), declarationOf(editorRule, property),
        `the mirror and the textarea must declare the same ${property}, or line N of the values drifts off line N of the code`)
    }
    assert(/border:1px solid transparent/.test(mirrorRule),
      'the mirror must cancel the textarea\'s 1px border with a transparent one (same padding box)')
    assert(/height:15\.95px/.test(cssRule(source, '.taskhive-codesys-inline-line')),
      'every mirror line must be exactly one line-height tall (11px × 1.45 = 15.95px), like the textarea row')
    console.log(`[自测] ①b 同时看得到代码和值：声明区 ${declCheck.checked} 行、实现区 ${implCheck.checked} 行`
      + `逐字符等于编辑框原文（其中 ${declCheck.withValues}+${implCheck.withValues} 行含值）；`
      + `镜像层代码色 ${mirrorCodeColor}（≠ 背景 ${surfaceToken}）· 值色 ${valueColor}（≠ 代码色）·`
      + `让位类 is-inline-mirrored 在已登录（值显示中）时挂在 textarea 上 ✓`)
  }

  // ── ② 前缀已去（显示）而原始回报一字不改（数据属性 + title）────────────────────
  assert.strictEqual(lineMapText(valueSegments(declLines, 4)), '0',
    'iAxis must show 0, not the abstract IEC literal INT#0 (line 4)')
  assert.strictEqual(lineMapText(valueSegments(declLines, 5)), '2048576000',
    'MaxVel must show 2048576000, not UDINT#2048576000 (line 5)')
  assert.strictEqual(lineMapText(valueSegments(declLines, 6)), '0',
    'bcontrol must show 0, not UINT#0 (line 6)')
  assert.strictEqual(lineMapText(valueSegments(declLines, 3)), 'FALSE',
    'a BOOL without a prefix must be shown verbatim')
  assert.strictEqual(lineMapText(valueSegments(declLines, 7)), "''",
    'an observed empty string is a VALUE, not a missing value (line 7)')
  const maxVelSpan = valueSegments(declLines, 5)[0].value
  assert.strictEqual(maxVelSpan.props['data-online-value-raw'], 'UDINT#2048576000',
    'the raw observed string must still be carried (the display-only strip must not lose data)')
  assert.strictEqual(maxVelSpan.props.title, 'UDINT#2048576000',
    'and the raw value must be the hover text, so nothing about the observation is hidden')
  assert.strictEqual(valueSegments(declLines, 4)[0].value.props['data-online-value-raw'], 'INT#0',
    'iAxis must keep INT#0 as its raw observation while displaying 0')
  // 原始回报不许泄漏进"看得见的那段文字"。
  assert(!lineMapText(declLines.get(4)).includes('INT#') && !lineMapText(declLines.get(5)).includes('UDINT#'),
    'no raw IEC type prefix may leak into the in-place display')
  assert(!lineMapText(implLines.get(1)).includes('INT#') && !lineMapText(implLines.get(2)).includes('INT#'),
    'nor into the implementation display')
  console.log('[自测] ② 前缀只在显示上去掉：iAxis INT#0 → 0、MaxVel UDINT#2048576000 → 2048576000，'
    + `而 data-online-value-raw / title 仍是 ${JSON.stringify(maxVelSpan.props['data-online-value-raw'])} ✓`)

  // ── ③ 未知：一个淡色占位符，绝不编造；空行/注释/语法行保持空白 ────────────────
  const unknownSegments = allValueSegments(declLines).filter((item) => item.segment.value.props['data-online-value-unknown'] === 'true')
  assert.strictEqual(unknownSegments.length, 1, 'exactly the unreadable FB line must be marked unknown')
  assert.strictEqual(unknownSegments[0].line, 8, 'the FB instance line (members unreadable) is the unknown one')
  assert.strictEqual(lineMapText([unknownSegments[0].segment]), '—', 'the placeholder must be one restrained dash')
  assert.strictEqual(unknownSegments[0].segment.value.props['data-online-value-raw'], undefined,
    'the placeholder must NOT carry a raw value — nothing may be invented')
  assert.strictEqual(unknownSegments[0].segment.value.props.title, undefined,
    'and it must not grow a tooltip sentence (the code area stays quiet)')
  assert.strictEqual(lineMapText(declLines.get(1)), 'PROGRAM PLC_PRG', 'a non-variable line (PROGRAM …) must stay untouched')
  assert.strictEqual(lineMapText(declLines.get(2)), 'VAR', 'a non-variable line (VAR) must stay untouched')
  assert.strictEqual(lineMapText(declLines.get(9)), 'END_VAR', 'and END_VAR must stay untouched')
  assert.strictEqual(valueSegments(declLines, 1).length + valueSegments(declLines, 2).length + valueSegments(declLines, 9).length, 0,
    'blank/comment/syntax lines must stay blank — no placeholder may be sprayed over them')
  assert.strictEqual(valueSegments(implLines, 4).length + valueSegments(implLines, 5).length, 0,
    'END_IF lines reference no declared variable, so they must stay blank')
  // 点号路径：整条 `fbMove6DOF.Busy` 才是一个 token，值跟在整条路径后面。
  assert.deepStrictEqual(valueNamesAfterToken(implLines, 6), ['fbMove6DOF.Busy', 'fbMove6DOF.Done'],
    'a dotted member reference must be annotated AFTER the whole path (never inside the dots)')
  assert.strictEqual(lineMapVisibleText(implLines.get(6)), 'IF fbMove6DOF.Busy — AND fbMove6DOF.Done — THEN',
    'and an unobserved member shows the dash after its own path')
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 1), [], 'PROGRAM … carries no value')
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 2), [], 'VAR carries no value')
  assert.deepStrictEqual(valueNamesAfterToken(declLines, 9), [], 'END_VAR carries no value')
  console.log(`[自测] ③ 未知只给一个淡色占位符：第 8 行 fbMove6DOF → ${JSON.stringify(lineMapText([unknownSegments[0].segment]))}`
    + '（无 raw、无 tooltip）；PROGRAM/VAR/END_VAR/END_IF 一个占位符都没有 ✓')

  // ── ④ 长值不裁：完整值都在 DOM 里，而且结构上再没有能裁它的东西 ────────────────
  const clientSource = readFileSync(clientFile, 'utf8')
  assert(!/taskhive-codesys-online-values\s*\{[^}]*overflow:hidden/.test(clientSource) || !clientSource.includes('taskhive-codesys-online-values'),
    'the retired value column (and its overflow:hidden) must be gone from the stylesheet')
  assert(!clientSource.includes('minmax(72px') && !clientSource.includes('minmax(96px') && !clientSource.includes('minmax(58px'),
    'no fixed/min value column width may survive anywhere (that is what clipped long values)')
  assert(!/taskhive-codesys-inline-value[^{]*\{[^}]*overflow:hidden/.test(clientSource),
    'the inline value span must not carry overflow:hidden (nothing may clip a value)')
  assert(!/taskhive-codesys-inline-value[^{]*\{[^}]*text-overflow:ellipsis/.test(clientSource),
    'and it must not carry text-overflow:ellipsis')
  assert(!/taskhive-codesys-inline-value[^{]*\{[^}]*white-space:nowrap/.test(clientSource),
    'and it must not be forced nowrap')
  // 镜像层自己必须是 overflow:visible：它是靠 translate 跟随滚动的，overflow:hidden 会把
  // 超出自身盒子的行就地裁掉（"滚到底很多行没值"的成因）。
  assert(/taskhive-codesys-inline-online\{[^}]*overflow:visible/.test(clientSource),
    'the inline mirror must be overflow:visible so translating it can reveal every line')
  // 极限长值：整串值必须在 DOM 里，一个字符都不少。
  const LONG_VALUE = 'UDINT#4294967295'
  const LONG_DRIVER_DECL = ['PROGRAM Long', 'VAR', '  aVeryLongVariableName : UDINT;', 'END_VAR'].join('\n')
  const longDriver = createWorkbenchDriver({
    objects: [{
      name: 'Long', guid: 'guid-long', type: 'PROGRAM',
      hasDeclaration: true, hasImplementation: false, declaration: LONG_DRIVER_DECL, implementation: '',
      path: ['Device', 'PLC Logic', 'Application', 'Long'],
    }],
    onlineStatus: LOGGED_IN_STATUS,
    taskhive: { monitorCodesysOnline: async () => ({ ok: true, applicationState: 'stop (2)', expressions: ['aVeryLongVariableName'], values: [LONG_VALUE] }) },
  })
  await longDriver.settle()
  longDriver.clickTreeRow('Long')
  await longDriver.settle()
  // 本轮：不再点任何开关 —— 已登录，值自己就会出现。
  for (let i = 0; i < 4 && inlineLines(longDriver, 'declaration').size === 0; i += 1) {
    longDriver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    longDriver.render()
  }
  const longLines = inlineLines(longDriver, 'declaration')
  const longSegment = valueSegments(longLines, 3)[0]
  assert.strictEqual(lineMapText([longSegment]), '4294967295', 'the whole long value must be rendered (display)')
  assert.strictEqual(longSegment.value.props['data-online-value-raw'], LONG_VALUE, 'and the whole raw value must be in the DOM')
  assert.strictEqual(lineMapVisibleText(longLines.get(3)), '  aVeryLongVariableName 4294967295 : UDINT;',
    'the long value must sit complete in the code flow, nothing dropped and nothing appended after it')
  console.log(`[自测] ④ 长值完整可见：${JSON.stringify(LONG_VALUE)} → ${JSON.stringify(lineMapVisibleText(longLines.get(3)))}`
    + '；镜像层 overflow:visible、值本身没有 overflow:hidden/ellipsis/nowrap、样式里再没有固定值列宽 ✓')

  // ── ⑤ 全量行都有值（含最后一行）：映射一次性覆盖整份代码，不按"可见行"算 ─────────
  // 1003 行 = 上一轮实测过的规模（全量算一遍 0.80 ms）。变量行**故意排在文件末尾**：
  // 用户报的就是"滚动到底下很多都没有加载"，所以这里要断言**最后一行**（滚动到底看到的那
  // 一行）自己的值也在、而且就在它自己的变量 token 后面。
  //
  // 变量数保持在一轮分批之内（88 个 < 引擎单次上限 120，所以一拍就读齐），这条断言用的是
  // **工作台自己发出的读值清单**，不是测试替身额外塞进来的值：文件里每一个被读到的变量都得
  // 在它出现的位置上就地有值。镜像层同时必须覆盖**所有**行（含注释行与最后一行），不是只画
  // 渲染出来的行。（"上限去除"之后条数不再有上限，跨多拍的规模见 ⑩ capRemovalCheck。）
  const TOTAL_LINES = 1003
  const tailDecl = ['PROGRAM Tail', 'VAR']
  while (tailDecl.length < TOTAL_LINES - 88 - 1) tailDecl.push('  // 填充：这一段只是把变量行推到文件末尾')
  for (let index = 0; index < 88; index += 1) tailDecl.push(`  t${index} : INT;`)
  tailDecl.push('END_VAR')
  const tailDeclaration = tailDecl.join('\n')
  assert.strictEqual(tailDeclaration.split('\n').length, TOTAL_LINES, 'the fixture must be the measured 1003-line scale')
  const lastVariableLine = TOTAL_LINES - 1 // `  t87 : INT;`
  const bigDriver = createWorkbenchDriver({
    objects: [
      { name: 'Tail', guid: 'guid-tail', type: 'PROGRAM', hasDeclaration: true, hasImplementation: false, declaration: tailDeclaration, implementation: '', path: ['Device', 'PLC Logic', 'Application', 'Tail'] },
    ],
    onlineStatus: LOGGED_IN_STATUS,
    taskhive: {
      // 与真机 worker 同构：只回报**工作台要的那一份**表达式（并如实带回 expressions）。
      monitorCodesysOnline: async (input) => ({
        ok: true,
        applicationState: 'stop (2)',
        expressions: input.expressions,
        values: (input.expressions || []).map((name) => `INT#${String(name).replace(/^t/, '')}`),
      }),
    },
  })
  await bigDriver.settle()
  bigDriver.clickTreeRow('Tail')
  await bigDriver.settle()
  // 本轮：不再点任何开关 —— 已登录，值自己就会出现（1003 行也一样）。
  for (let i = 0; i < 6 && inlineLines(bigDriver, 'declaration').size === 0; i += 1) {
    bigDriver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    bigDriver.render()
  }
  const tailLines = inlineLines(bigDriver, 'declaration')
  assert.strictEqual(tailLines.size, TOTAL_LINES,
    'the mirror must carry EVERY line of the code, not just the rows that happen to be rendered')
  assert(tailLines.has(TOTAL_LINES), 'including the very last line of the file (the one you see after scrolling to the bottom)')
  const lastSegments = valueSegments(tailLines, lastVariableLine)
  assert.strictEqual(lastSegments.length, 1,
    'the last VARIABLE line of the code must carry its value too (no "scroll to the bottom and it is empty")')
  assert.deepStrictEqual(valueNamesAfterToken(tailLines, lastVariableLine), ['t87'],
    'and that last value must sit immediately after its own variable token')
  assert.strictEqual(lastSegments[0].text, '87', 'the last line must show the value it actually observed (INT#87 → 87)')
  const totalValues = allValueSegments(tailLines).length
  assert.strictEqual(totalValues, 88,
    'every variable line that was read must have exactly one in-place value (full-line map, not visible rows)')
  assert.strictEqual(lineMapText(tailLines.get(TOTAL_LINES)), 'END_VAR',
    'and the last row still exists and is untouched')
  console.log(`[自测] ⑤ 全量行都有值：${tailLines.size} 行全部进了镜像层（= 代码行数 ${TOTAL_LINES}），`
    + `滚到底那一行（第 ${lastVariableLine} 行）读到 ${JSON.stringify(lineMapVisibleText(tailLines.get(lastVariableLine)))}；`
    + `被读到的变量 ${totalValues} 个 ⇒ 值 ${totalValues} 个（含最后一行）✓`)

  // ── ⑥ 手打草稿：**登录之后编辑栏被冻结**，草稿只可能来自"登录之前" ─────────────
  //
  // 本轮 B 项（用户拍板「ai写入和手动写入都禁止，编辑栏直接被冻结」）：已登录到应用时，
  // 编辑栏是 `readOnly` 的，**再多打一个字都不行**，所以旧写法（"登录状态下打一行草稿，
  // 看镜像层是否跟着草稿走"）在冻结之后不再是一个用户做得到的动作。按**意图**换成两条
  // 更有价值的断言（只加强，不删弱）：
  //   · 已登录 ⇒ 输入被拒（内容逐字不变）—— 这正是冻结规则本身；
  //   · 草稿若来自**登录之前**，登录后仍然逐字保留，而且镜像层跟着草稿走
  //     （值的行对齐在"文本与磁盘不同"时也必须成立）。
  const FROZEN_ATTEMPT = `${DECLARATION}\n(* 在线时我不该被打进去 *)`
  const changeStateBeforeFrozenAttempt = driver.treeChangeState('PLC_PRG')
  driver.typeInEditor('declaration', FROZEN_ATTEMPT)
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), DECLARATION,
    'while logged in the editor is frozen: the attempted text must not land (no draft either)')
  assert.strictEqual(driver.treeChangeState('PLC_PRG'), changeStateBeforeFrozenAttempt,
    'and no draft may appear on the tree row (the edit attempt produced nothing)')
  console.log('[自测] ⑥ 已登录 ⇒ 编辑栏冻结：试图手打 '
    + `${FROZEN_ATTEMPT.split('\n').length - DECLARATION.split('\n').length} 行输入后，textarea 仍是原文 `
    + `${DECLARATION.split('\n').length} 行、树标记仍是 ${JSON.stringify(driver.treeChangeState('PLC_PRG'))} ✓`)
  // 草稿来自**登录之前**：先以"未登录"起一个工作台，打一行，再让它登录。
  const DRAFT_DECLARATION = `${DECLARATION}\n(* 我手打的一行草稿：不要覆盖我 *)`
  const draftDriver = createDriver({ onlineStatus: NOT_LOGGED_IN_STATUS }).driver
  await draftDriver.settle()
  draftDriver.clickTreeRow('PLC_PRG')
  await draftDriver.settle()
  assertNoSwitch(draftDriver, 'draft workbench, not logged in')
  draftDriver.typeInEditor('declaration', DRAFT_DECLARATION)
  await draftDriver.settle()
  assert.strictEqual(draftDriver.editorValue('declaration'), DRAFT_DECLARATION,
    'while NOT logged in the operator can still type (the freeze is about the online login)')
  assert.strictEqual(draftDriver.treeChangeState('PLC_PRG'), 'manual', 'and that draft is recorded')
  // 登录（宿主回报 isLoggedIn:true）⇒ **不用点任何东西**，值自己就出现了；草稿逐字保留，
  // 镜像层跟着草稿走。
  draftDriver.setOnlineStatus(LOGGED_IN_STATUS)
  for (let i = 0; i < 8 && inlineLines(draftDriver, 'declaration').size === 0; i += 1) {
    draftDriver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    draftDriver.render()
  }
  assertNoSwitch(draftDriver, 'draft workbench, logged in')
  assert.strictEqual(editorNode(draftDriver, 'declaration').props.readOnly, true,
    'and the editor must freeze the moment the application login is visible')
  assert(await waitForObservedValues(draftDriver, 'declaration'),
    'the values must arrive on their own on a draft that predates the login (no click at all)')
  const draftLines = inlineLines(draftDriver, 'declaration')
  assert(draftLines.size > 0, 'values must be painted on their own on a draft that predates the login')
  assert.strictEqual(draftLines.size, DRAFT_DECLARATION.split('\n').length,
    'and the mirror must follow that DRAFT text line for line (values stay aligned)')
  assert.strictEqual(lineMapVisibleText(draftLines.get(3)), '  startMove FALSE : BOOL;',
    'the draft keeps its values in place (the added comment line changes nothing above it)')
  assertMirrorCarriesTheCode(draftLines, 'declaration(draft)', DRAFT_DECLARATION)
  assert.strictEqual(draftDriver.editorValue('declaration'), DRAFT_DECLARATION,
    'painting values must never rewrite the operator\'s text (T166 discipline)')
  assert(!draftDriver.editorValue('declaration').includes('FALSE'),
    'no observed value may be injected into the code text')
  assert(!draftDriver.editorValue('declaration').includes('2048576000'),
    'no observed value may be injected into the code text (2)')
  assert(!draftDriver.editorValue('declaration').includes('—'),
    'and the unknown placeholder may not be injected either')
  console.log(`[自测] ⑥ 登录前手打的草稿在登录后逐字保留（${DRAFT_DECLARATION.split('\n').length} 行），`
    + `镜像层跟着草稿走（第 3 行 = ${JSON.stringify(lineMapVisibleText(draftLines.get(3)))}，`
    + `且该区每一行的代码文字都与草稿原文逐字符相等）✓`)

  // ── ⑦ 退出登录＝原样（值消失 + 编辑栏恢复可编辑），且不再读值 ──────────────────
  // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：原来这里"关掉开关"，
  // 现在唯一的关闸是**退出登录**（宿主回报 isLoggedIn:false）。
  driver.setOnlineStatus(NOT_LOGGED_IN_STATUS)
  await driver.settle()
  for (let i = 0; i < 6; i += 1) {
    scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    driver.render()
  }
  assertNoSwitch(driver, 'after logging out')
  assert.strictEqual(inlineOverlay(driver, 'declaration'), null, 'logging out must remove the mirror entirely')
  assert.strictEqual(inlineOverlay(driver, 'implementation'), null, 'in both sections')
  assert.strictEqual(driver.findAll((props) => props['data-section-online-values'] === 'true').length, 0,
    'and no section may still claim to carry values')
  // ④（行为）：让位类消失 ⇒ 编辑框自己的正文颜色回来了（原样可见）。
  assert(!String(editorNode(driver, 'declaration').props.className).includes('is-inline-mirrored'),
    'the stand-down class must be gone with the mirror, so the textarea paints its own text again')
  assert.strictEqual(driver.editorValue('declaration'), DECLARATION,
    'and the editor text is the untouched original (the values never entered it)')
  // 退出登录 ⇒ 立刻恢复**可编辑**（T217 的冻结只属于已登录这一种状态）。
  assert.strictEqual(editorNode(driver, 'declaration').props.readOnly, false,
    'logging out must unfreeze the editor immediately')
  const AFTER_LOGOUT_EDIT = `${DECLARATION}\n(* 退出登录后我又能打字了 *)`
  driver.typeInEditor('declaration', AFTER_LOGOUT_EDIT)
  await driver.settle()
  assert.strictEqual(driver.editorValue('declaration'), AFTER_LOGOUT_EDIT,
    'and the operator can type again the moment the login is gone')
  driver.typeInEditor('declaration', DECLARATION)
  await driver.settle()
  const callsAfterLogout = first.monitorCalls.length
  for (let i = 0; i < 6; i += 1) {
    scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    driver.render()
  }
  assert.strictEqual(first.monitorCalls.length, callsAfterLogout,
    'after logging out, no further value reads may happen (no leftover timer)')
  // 同一轮也在草稿那一个工作台上退出登录：草稿逐字不变、镜像层整个消失、编辑栏恢复可编辑。
  draftDriver.setOnlineStatus(NOT_LOGGED_IN_STATUS)
  await draftDriver.settle()
  for (let i = 0; i < 6; i += 1) {
    draftDriver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    draftDriver.render()
  }
  assert.strictEqual(inlineOverlay(draftDriver, 'declaration'), null,
    'logging out of the draft workbench must remove the mirror there too')
  assert(!String(editorNode(draftDriver, 'declaration').props.className).includes('is-inline-mirrored'),
    'and the draft textarea must paint its own text again')
  assert.strictEqual(editorNode(draftDriver, 'declaration').props.readOnly, false,
    'and the draft editor must be editable again')
  assert.strictEqual(draftDriver.editorValue('declaration'), DRAFT_DECLARATION,
    'and the operator\'s draft must survive the round trip untouched')
  console.log('[自测] ⑦ 退出登录＝原样：镜像层整个消失、让位类消失（编辑框文字恢复可见）、'
    + '编辑栏立刻恢复可编辑且打进去的字真的落下、原文逐字不变、也不再读值'
    + `（退出后 monitor 调用仍是 ${callsAfterLogout} 次；草稿工作台同样恢复）✓`)

  // ── ③ 开关**不存在**：DOM 之外，bundle 里也不许留下它的状态/记忆键/样式/旧文案 ──
  //
  // 本轮（用户规则原文：「把在线值开关去除，登录后默认在线值开启」）：这条是"删除"的可执行
  // 形式 —— 只断言"它是关的"远远不够，必须断言**它不在**。删掉原因写在源码注释里（本仓惯例），
  // 所以"符号已经消失"这类判据只看**代码**：JS 注释与（CSS 在模板字符串里，属于字符串内容的）
  // CSS 注释都先剥掉，剩下的才是真的会跑的代码。
  {
    const raw = readFileSync(clientFile, 'utf8')
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // CSS/JS 块注释（CSS 那份在模板字符串里）
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（`[^:]` 放过 'https://' 这类字面量）
    for (const gone of [
      'data-codesys-online-values-toggle',
      'inlineOnlineValues',
      'setInlineOnlineValues',
      'CODESYS_INLINE_ONLINE_VALUES_KEY',
      'taskhive.codesys.onlineValues.inline',
      'readStoredFlag',
      'storeFlag',
      'valueByLineAny',
      'data-editor-online',
      'taskhive-codesys-editor-online',
      'is-live',
      '在线值 开',
      '在线值 关',
    ]) {
      assert(!code.includes(gone), `the deleted 「在线值」 switch must leave no trace in the code: found ${gone}`)
    }
    // 而"值跟随登录状态"这条新判据必须在代码里（不是只写在注释里）。
    assert(code.includes('if (!jobId || !onlineLoggedIn || !workbenchVisible)'),
      'the login state must be the one and only gate on reading values')
    assert(code.includes('const inlineByLine = onlineLoggedIn'),
      'and the one and only gate on painting them')
    assert(code.includes('if (!onlineLoggedIn) return null'),
      'and both segment maps must be empty while not logged in')
    console.log('[自测] ③ 开关不存在：DOM 里没有那枚按钮/绿灯/旧文案/title（见 ① ② ⑦ 的 assertNoSwitch），'
      + 'bundle 代码里也不再有 data-codesys-online-values-toggle / inlineOnlineValues / '
      + 'setInlineOnlineValues / CODESYS_INLINE_ONLINE_VALUES_KEY / taskhive.codesys.onlineValues.inline / '
      + 'readStoredFlag / storeFlag / valueByLineAny / data-editor-online / taskhive-codesys-editor-online / '
      + 'is-live / 两段旧文案 —— 13 个记号全 0；判据只剩 onlineLoggedIn ✓')
  }

  // ── ⑨ 零写动作：值显示本身一次 IPC 都不产生（唯一的 PLC 流量是 monitor 读） ─────
  const valueDriver = createDriver().driver
  await valueDriver.settle()
  valueDriver.clickTreeRow('PLC_PRG')
  await valueDriver.settle()
  const ipcBeforeValues = valueDriver.ipcCalls.length
  // 值已经自动出现了（登录即显示）；这里只是让既有的读值节拍再跑几拍。
  for (let i = 0; i < 4; i += 1) {
    valueDriver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    valueDriver.render()
  }
  // `settle()` / 读值节拍会驱动工作台自己的 housekeeping，其中的磁盘 sha 复核会跑引擎的
  // 只读 `diff` 动作（它不在 MUTATING 列表里：不启 ScriptEngine、不写、不改工程 —— 见
  // 50-codesys-workbench.js 的 diff 调用点）。所以计数会动；要钉的是"值显示这条通路自己不
  // 产生任何写动作"，而且整个流程一个 mutating 动作都没有。
  const MUTATING = ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'rollback', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'import-xml']
  const newActions = valueDriver.ipcCalls.slice(ipcBeforeValues).map((call) => call.action)
  assert(newActions.every((action) => action === 'diff'),
    `showing values may cause no engine action other than the workbench's own read-only sha recompute (saw ${JSON.stringify([...new Set(newActions)])})`)
  assert(!valueDriver.ipcCalls.some((call) => MUTATING.includes(call.action)),
    'no mutating engine action may appear anywhere in this flow')
  assert.deepStrictEqual(valueDriver.ipcCalls.map((call) => call.action).filter((action) => !['bind-project', 'inspect-project', 'diff', 'current-project'].includes(action)),
    [], 'nothing in this flow may reach a mutating engine action')
  const onlineCalls = first.monitorCalls.map((input) => Object.keys(input).sort().join(','))
  assert(onlineCalls.every((keys) => keys === 'expressions,jobId,projectPath,scope'),
    'the only PLC traffic showing values causes is the existing monitor read (no write path)')
  console.log(`[自测] ⑨ 零写动作：值显示新增的引擎动作 = ${JSON.stringify([...new Set(newActions)])}（只有只读 diff，`
    + `是工作台自己的磁盘 sha 复核）；MUTATING 动作 0 个；`
    + `唯一的 PLC 流量 = monitor（读）✓`)

  // ── 本轮：A 值有底色（原生 IDE 观感）+ B 值刷新不推代码、不打断阅读 ────────────
  //
  // 用户报障原文：「现在在线值看不出来，应该和原生ide一样有背景色，而且在线值是不是刷新一下
  // 导致根本没法正常看」。两件事分开钉：
  //
  // A（看不出来 ⇒ 要底色）：值 span 从"只是一段更浅的灰蓝字"变成"一段有克制的底色的值"，
  //   代码文字仍然是正文墨色（T217 那条不许退回去）。颜色全部走主题令牌，按令牌解析断言。
  // B（刷新一下就没法正常看）：
  //   ① 稳定槽：每个值的位置按"该变量 IEC 类型的最大文本宽度 ∪ 历史上见过的最宽值"留
  //      `min-width`，只增不减 ⇒ 值一变**不会把后面的代码左右推**；
  //   ② 只更新变化了的行/span：值没变的行直接复用上一次那个**同一个元素对象**（React 对
  //      Object.is 相同的子元素整棵子树跳过协调）—— 断言"未变化的行没有被重建"；
  //   ③ 保持滚动与选择：一个节拍前后 textarea 的 scrollTop/scrollLeft、选区、以及三条
  //      跟随层（gutter/highlight/inline）的几何都**不许**变化；
  //   ④ 用户正在滚动/选中时暂停值刷新，停下约 1 秒后恢复（节拍仍是既有的 1.5 s）
  //      —— 用两个真实时间窗证明：滚动让路、选中把让路**续上**、随后自己恢复。
  {
    const sheet = readFileSync(clientFile, 'utf8')
    const valueRule = cssRule(sheet, '.taskhive-codesys-inline-value')
    const unknownRule = (sheet.match(/\.taskhive-codesys-inline-value\.is-unknown\{([^}]*)\}/) || [])[1] || ''
    const surface = (sheet.match(/--th-surface:(#[0-9a-fA-F]{3,8})/) || [])[1]
    const ink = (sheet.match(/--th-ink:(#[0-9a-fA-F]{3,8})/) || [])[1]
    const ink2 = (sheet.match(/--th-ink-2:(#[0-9a-fA-F]{3,8})/) || [])[1]
    // 底色/字色都从**真正运行的 client.js**里把 var(--token) 解析成色值，不比字面量。
    const valueBg = cssColor(sheet, valueRule, 'background')
    const unknownBg = cssColor(sheet, unknownRule, 'background')
    const luminance = (hex) => {
      const raw = String(hex || '').replace('#', '')
      const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw
      const channel = (at) => parseInt(full.slice(at, at + 2), 16) || 0
      return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
    }
    assert(surface && ink && ink2, 'the surface / ink / value-ink tokens must all be defined')
    // ① 底色存在，而且 ≠ 背景、≠ 代码墨色（否则"这一段是值"仍然看不出来）。
    assert(valueBg && valueBg !== 'transparent' && !/^var\(/.test(valueBg),
      `① 值必须有底色（用户报障原文「在线值看不出来，应该和原生ide一样有背景色」，解析到 ${JSON.stringify(valueBg)}）`)
    assert(valueBg !== String(surface).toLowerCase(), `① 值的底色必须 ≠ 编辑区底色（${valueBg} vs ${surface}）`)
    assert(valueBg !== String(ink).toLowerCase() && valueBg !== String(ink2).toLowerCase(),
      `① 值的底色必须 ≠ 代码墨色 / 值字色（${valueBg} vs ${ink} / ${ink2}）`)
    assert(Math.abs(luminance(valueBg) - luminance(surface)) >= 8,
      `① 底色要比背景明显暗一点才看得见（Δ=${Math.abs(luminance(valueBg) - luminance(surface)).toFixed(1)}）`)
    assert(/border-radius:2px/.test(valueRule), '① 值要有 2px 圆角（"一小块值"而不是"一段底色带"）')
    assert(/display:inline-block/.test(valueRule),
      '① min-width 对非替换 inline 元素不生效：值必须是 inline-block，稳定槽才立得住')
    // ⑦ 未知更淡：底色离背景更近（比真值更不显眼），而且它没有 raw（见下面 ⑦）。
    assert(unknownBg && unknownBg !== 'transparent', `⑦ 未知也要有自己的（更淡的）底色，解析到 ${JSON.stringify(unknownBg)}`)
    assert(luminance(unknownBg) > luminance(valueBg),
      `⑦ 未知的底色必须比真值的底色更淡（${unknownBg} 暗度 ${(255 - luminance(unknownBg)).toFixed(1)} < ${valueBg} 的 ${(255 - luminance(valueBg)).toFixed(1)}）`)
    // ② 代码仍是正文墨色：画代码的是镜像层，它的 color 必须是 --th-ink。
    const mirrorRule = cssRule(sheet, '.taskhive-codesys-inline-online')
    assert(/color:var\(--th-ink\)/.test(mirrorRule), '② 镜像层（画代码的那一层）必须用正文墨色 var(--th-ink)')
    assert(cssColor(sheet, mirrorRule) === String(ink).toLowerCase() && String(ink).toLowerCase() !== valueBg,
      `② 代码墨色 ${ink} 必须与值的底色 ${valueBg} 不同（T217：不许退回"一片白 + 值"）`)
    assert(/color:var\(--th-ink-2\)/.test(valueRule) && String(ink2).toLowerCase() !== String(ink).toLowerCase(),
      `② 值自己的字仍然是灰蓝 ${ink2}（≠ 代码墨色 ${ink}）`)
    // 值的内边距（左右各 3px）必须和稳定槽里补的那几个像素一致，否则槽宽会差几像素。
    const cssPadding = Number((valueRule.match(/padding:0 (\d+)px/) || [])[1] || 0)
    const jsPadding = Number((sheet.match(/CODESYS_ONLINE_VALUE_SLOT_PADDING = (\d+)/) || [])[1] || -1)
    assert(cssPadding > 0 && jsPadding === cssPadding * 2,
      `稳定槽的 min-width 补的 ${jsPadding}px 必须等于值内边距的两倍（左右各 ${cssPadding}px）`)
    console.log(`[自测] A① 值有底色：value = ${valueBg}（背景 ${surface}、代码墨色 ${ink}、值字色 ${ink2} 三者互不相同）`
      + `+ 2px 圆角 + 左右各 ${cssPadding}px 内边距（稳定槽补 ${jsPadding}px，与样式一致）；`
      + `未知 ${unknownBg} 比真值更淡 ✓`)

    // ── 一个专门的工作台：读数节拍每次都换一批值（真机那三个变量的形状）──────────
    const DRIFT_DECLARATION = [
      'PROGRAM Drift',
      'VAR',
      '  MaxVel : UDINT;',
      '  msg : STRING;',
      '  iAxis : INT;',
      // FB 实例：成员一个都读不到 ⇒ 这一行是"未知"的那一处（淡色占位符 + 更淡的底色）。
      '  fbAxis : MC_MoveAbsolute;',
      'END_VAR',
    ].join('\n')
    const DRIFT_IMPLEMENTATION = [
      'MaxVel := iAxis;',
      "msg := 'x';",
    ].join('\n')
    // 每一"帧"= 一次读数节拍读回来的值。UDINT 的十进制上限正好 10 位，所以第 1→2 帧
    // （`0` → `2048576000`，用户报障里那一对）必须**一个字都不动**；STRING 没有类型上限，
    // 所以它允许在"真的见到更宽的值"时扩一次（第 3 帧），之后（第 4 帧值变短）也不许收窄。
    const FRAMES = [
      { MaxVel: 'UDINT#0', msg: "''", iAxis: 'INT#0' },
      { MaxVel: 'UDINT#2048576000', msg: "''", iAxis: 'INT#0' },
      { MaxVel: 'UDINT#2048576001', msg: "'ok, long text'", iAxis: 'INT#0' },
      { MaxVel: 'UDINT#2048576001', msg: "'x'", iAxis: 'INT#-32768' },
    ]
    let frame = 0
    const driftCalls = []
    const driftDriver = createWorkbenchDriver({
      objects: [{
        name: 'Drift', guid: 'guid-drift', type: 'PROGRAM',
        hasDeclaration: true, hasImplementation: true,
        declaration: DRIFT_DECLARATION, implementation: DRIFT_IMPLEMENTATION,
        path: ['Device', 'PLC Logic', 'Application', 'Drift'],
      }],
      onlineStatus: LOGGED_IN_STATUS,
      taskhive: {
        monitorCodesysOnline: async (input) => {
          driftCalls.push(input)
          const current = FRAMES[Math.min(frame, FRAMES.length - 1)]
          return {
            ok: true,
            applicationState: 'stop (2)',
            expressions: input.expressions,
            values: (input.expressions || []).map((name) => String(current[name] ?? '')),
          }
        },
      },
    })
    // 本轮：不再点任何开关 —— 已登录，值自己就会出现。
    const settleMirror = async (target) => {
      await target.settle()
      for (let i = 0; i < 8 && inlineLines(target, 'declaration').size === 0; i += 1) {
        target.scene.flushTimers()
        await new Promise((resolve) => setImmediate(resolve))
        target.render()
      }
      assert(inlineLines(target, 'declaration').size > 0, 'the drift workbench must paint its values')
    }
    await driftDriver.settle()
    driftDriver.clickTreeRow('Drift')
    await driftDriver.settle()
    await settleMirror(driftDriver)
    const descendants = (node, into = []) => {
      if (!node || typeof node !== 'object' || !('type' in node)) return into
      into.push(node)
      for (const child of kids(node)) descendants(child, into)
      return into
    }
    const driftSection = (part) => driftDriver.find((props) => props['data-editor-section'] === part)
    const lineNodes = (part) => kids(inlineOverlay(driftDriver, part))
    // 版面：每个值位置（行号 + 这一行里第几个值）的槽宽与内联样式。display 不参与 —— 它本来就该变。
    const geometry = (part) => {
      const out = []
      for (const [line, segments] of inlineLines(driftDriver, part).entries()) {
        let ordinal = 0
        for (const segment of segments) {
          if (!segment.value) continue
          out.push({
            line, index: ordinal,
            slot: Number(segment.value.props['data-online-value-slot']),
            minWidth: String((segment.value.props.style || {}).minWidth || ''),
          })
          ordinal += 1
        }
      }
      return out
    }
    const displays = (part) => {
      const out = []
      for (const [line, segments] of inlineLines(driftDriver, part).entries()) {
        let ordinal = 0
        for (const segment of segments) {
          if (!segment.value) continue
          out.push({
            line, index: ordinal, text: textOf(segment.value), raw: segment.value.props['data-online-value-raw'],
            slot: Number(segment.value.props['data-online-value-slot']),
          })
          ordinal += 1
        }
      }
      return out
    }
    // 走一拍读数（用既有的确定性定时器；不加任何真实等待）。
    const nextFrame = async (index) => {
      frame = index
      const before = driftCalls.length
      for (let attempt = 0; attempt < 12 && driftCalls.length === before; attempt += 1) {
        driftDriver.scene.flushTimers()
        await new Promise((resolve) => setImmediate(resolve))
        driftDriver.render()
      }
      assert(driftCalls.length > before, `frame ${index}: the value poll must run one tick here`)
      for (let i = 0; i < 3; i += 1) { // 让 setState 的那一次重渲染落定
        driftDriver.scene.flushTimers()
        await new Promise((resolve) => setImmediate(resolve))
        driftDriver.render()
      }
    }

    // ④ 滚动/选择：把三条跟随层接上真实的替身节点，然后做一次**用户真的做得到**的滚动。
    const declOverlay = inlineOverlay(driftDriver, 'declaration')
    const gutterStub = driftDriver.scene.document.createElement('div')
    const highlightStub = driftDriver.scene.document.createElement('div')
    const inlineStub = driftDriver.scene.document.createElement('div')
    descendants(driftSection('declaration')).find((element) => String((element.props || {}).className || '').includes('taskhive-codesys-line-gutter')).props.ref.current = gutterStub
    descendants(driftSection('declaration')).find((element) => String((element.props || {}).className || '').includes('taskhive-codesys-editor-highlights')).props.ref.current = highlightStub
    declOverlay.props.ref.current = inlineStub
    const userView = { scrollTop: 246, scrollLeft: 38, selectionStart: 4, selectionEnd: 11 }
    editorNode(driftDriver, 'declaration').props.onScroll({ currentTarget: userView })
    assert.strictEqual(gutterStub.scrollTop, 246, 'the scroll gesture must drive the gutter (baseline sanity)')
    assert.strictEqual(highlightStub.style.transform, 'translateY(-246px)', 'and the line-tint layer (baseline sanity)')
    assert.strictEqual(inlineStub.style.transform, 'translate(-38px, -246px)', 'and the in-place mirror (baseline sanity)')
    // 用户正在滚动/选中 ⇒ 读数节拍让路；而且**选中把让路续上**（第二个窗口里那次"仍然没读"
    // 只可能来自 onSelect —— 距离滚动已经超过 1 秒）。停下约 1 秒后自己恢复。
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const flushQuietly = async (rounds) => {
      const before = driftCalls.length
      for (let i = 0; i < rounds; i += 1) {
        driftDriver.scene.flushTimers()
        await new Promise((resolve) => setImmediate(resolve))
        driftDriver.render()
      }
      return driftCalls.length - before
    }
    assert.strictEqual(await flushQuietly(6), 0, '④ 用户刚滚动过：约 1 秒内的读数节拍必须让路（画面不中途变）')
    await sleep(600)
    editorNode(driftDriver, 'declaration').props.onSelect() // 选中（同一个"我在读"的信号）
    assert.strictEqual(await flushQuietly(6), 0, '④ 选中也要让路')
    await sleep(600) // 距离滚动已 >1s，距离选中只有 0.6s ⇒ 仍然必须让路
    assert.strictEqual(await flushQuietly(6), 0, '④ 选中必须把让路**续上**（这一拍不许读）')
    await sleep(500) // 距离选中也 >1s 了 ⇒ 恢复
    assert((await flushQuietly(6)) > 0, '④ 停下约 1 秒之后读数必须自己恢复')
    // 这一个节拍前后：滚动位置、两条跟随层的几何、选区、以及编辑框内容都**一个字没变**。
    assert.strictEqual(gutterStub.scrollTop, 246, '④ 读数节拍不得改写 gutter 的滚动位置')
    assert.strictEqual(highlightStub.style.transform, 'translateY(-246px)', '④ 也不得改写高亮层的平移')
    assert.strictEqual(inlineStub.style.transform, 'translate(-38px, -246px)', '④ 也不得改写镜像层的平移')
    assert.deepStrictEqual([userView.selectionStart, userView.selectionEnd], [4, 11], '④ 也不得动用户的选区')
    assert.strictEqual(driftDriver.editorValue('declaration'), DRIFT_DECLARATION, '④ 编辑框内容逐字不变')
    assert.strictEqual(driftDriver.editorValue('implementation'), DRIFT_IMPLEMENTATION, '④ 实现区同样逐字不变')
    console.log('[自测] ④ 读数节拍前后：scrollTop=246 / scrollLeft=38、gutter.scrollTop=246、'
      + 'highlight=translateY(-246px)、inline=translate(-38px, -246px)、选区 [4,11]、编辑框逐字不变；'
      + '滚动让路 ✓ 选中续上让路 ✓ 停下约 1 秒后恢复 ✓（节拍仍是既有 1.5 s，没有新增定时器）')

    // ── ③⑤ 稳定槽 + 只更新变化了的行 ──────────────────────────────────────────
    // 逐帧记下两样东西：
    //   · geometry = 每一个值位置的槽宽与内联 min-width（**版面**，display 不参与）；
    //   · rows     = 每一行的元素对象（引用相同 = React 整棵子树跳过协调 = 没有重建）。
    const snapshot = () => ({
      declaration: { geometry: geometry('declaration'), rows: lineNodes('declaration'), displays: displays('declaration') },
      implementation: { geometry: geometry('implementation'), rows: lineNodes('implementation'), displays: displays('implementation') },
    })
    const frames = [snapshot()] // 帧 0：`MaxVel=0 / msg='' / iAxis=0`
    await nextFrame(1) // `0` → `2048576000`（用户报障里的那一对）
    frames.push(snapshot())
    await nextFrame(2) // 只有 STRING 真的变宽（它没有类型上限 ⇒ 允许**扩一次**）
    frames.push(snapshot())
    await nextFrame(3) // STRING 的值变**短**了、INT 变宽到上限：都不许动版面
    frames.push(snapshot())
    const [f0, f1, f2, f3] = frames

    // ③ 帧 0 → 帧 1：`0` → `2048576000`，每一个值位置的槽宽必须**逐字段相同**。
    assert.deepStrictEqual(f1.declaration.geometry, f0.declaration.geometry,
      '③ 值 0 → 2048576000：声明区每一个值位置的槽宽都不许变（UDINT 的 10 位上限已经留好了）')
    assert.deepStrictEqual(f1.implementation.geometry, f0.implementation.geometry,
      '③ 实现区同样一个位置都不许移动')
    const maxVel = f1.declaration.displays.find((item) => item.raw === 'UDINT#2048576000')
    assert(maxVel && maxVel.text === '2048576000' && maxVel.slot === 10,
      `③ MaxVel 必须是 10 个字符宽的稳定槽（看到了 ${JSON.stringify(maxVel)}）`)
    // ③ 帧 1 → 帧 2：唯一允许变的是那个**真的更宽**了的值（STRING 没有等宽上限）。
    const widened = f2.declaration.geometry
      .map((item, index) => ({ item, before: f1.declaration.geometry[index] }))
      .filter(({ item, before }) => item.minWidth !== before.minWidth)
    assert.deepStrictEqual(widened.map(({ item, before }) => [item.line, item.index, before.slot, item.slot]),
      [[4, 0, 2, 15]],
      `③ 第 2 帧只允许 STRING 那一个位置扩一次（它的值真的从 '' 变成 'ok, long text'），实际 ${JSON.stringify(widened.map(({ item }) => [item.line, item.index, item.slot]))}`)
    // ③ 帧 2 → 帧 3：值变短（`'ok, long text'` → `'x'`）也**不收窄** —— 收窄就是把后面的代码往左推。
    assert.deepStrictEqual(f3.declaration.geometry, f2.declaration.geometry,
      '③ 值变短时槽宽一个字符都不许收（"值一变不会把后面的代码左右推"）')
    assert.deepStrictEqual(f3.implementation.geometry, f2.implementation.geometry, '③ 实现区同样不许收窄')
    // ⑥ 每一帧每一个位置：槽宽 ≥ 值的字符数（所以绝不裁切），而且槽宽只增不减。
    const seenSlots = new Map()
    for (const frameState of frames) {
      for (const part of ['declaration', 'implementation']) {
        frameState[part].displays.forEach((item) => {
          const position = frameState[part].geometry.find((entry) => entry.line === item.line && entry.index === item.index)
          assert(position.slot >= item.text.length,
            `⑥ 槽宽必须 ≥ 值的字符数（永不裁切）：第 ${item.line} 行「${item.text}」${item.text.length} 字 vs 槽 ${position.slot}`)
        })
        frameState[part].geometry.forEach((item) => {
          const key = `${part}|${item.line}|${item.index}`
          const previous = seenSlots.get(key)
          if (previous !== undefined) assert(item.slot >= previous, `③ 槽宽只增不减（${key}: ${previous} → ${item.slot}）`)
          seenSlots.set(key, item.slot)
        })
      }
    }

    // ⑤ 帧 0 → 帧 1：只有 MaxVel 的值变了 ⇒ 只有它那一行换元素，其余逐行**复用同一个对象**。
    const DECL_MAXVEL_LINE = 3
    const DECL_MSG_LINE = 4
    const DECL_IAXIS_LINE = 5
    const keysOf = (rows) => rows.map((row) => row.props.key)
    assert.deepStrictEqual(keysOf(f1.declaration.rows), keysOf(f0.declaration.rows),
      '⑤ 每一行的 key 必须逐行相同（React 靠它认位置，不是靠顺序猜）')
    assert(f1.declaration.rows[DECL_MAXVEL_LINE - 1] !== f0.declaration.rows[DECL_MAXVEL_LINE - 1],
      '⑤ 值变了的那一行（MaxVel）必须换成新元素（只更新变化了的 span）')
    assert(f1.declaration.rows[DECL_MSG_LINE - 1] === f0.declaration.rows[DECL_MSG_LINE - 1],
      '⑤ 值没变的那一行（msg）必须复用同一个元素对象 —— React 因此整棵子树跳过协调、一个字符都不重画')
    assert(f1.declaration.rows[DECL_IAXIS_LINE - 1] === f0.declaration.rows[DECL_IAXIS_LINE - 1],
      '⑤ iAxis 那一行同样一个对象都没重建')
    assert(f1.implementation.rows[0] !== f0.implementation.rows[0],
      '⑤ 实现区第 1 行引用了 MaxVel ⇒ 它换新元素')
    assert(f1.implementation.rows[1] === f0.implementation.rows[1],
      '⑤ 实现区第 2 行只引用 msg（它的值两帧相同）⇒ 原样复用')
    // ⑤ 帧 2 → 帧 3：MaxVel 的值两帧完全一样（连原始回报都一样）⇒ 它那一行必须还是同一个对象。
    assert.strictEqual(displays('declaration').find((item) => item.line === DECL_MAXVEL_LINE).raw, 'UDINT#2048576001',
      '⑤ 帧 2/3 之间 MaxVel 的原始回报确实没变（所以它没有理由重建）')
    assert(f3.declaration.rows[DECL_MAXVEL_LINE - 1] === f2.declaration.rows[DECL_MAXVEL_LINE - 1],
      '⑤ 值没变的那一行（MaxVel，帧 2→3）必须复用同一个元素对象')
    assert(f3.declaration.rows[DECL_MSG_LINE - 1] !== f2.declaration.rows[DECL_MSG_LINE - 1],
      '⑤ 值变了的那一行（msg，帧 2→3）换新元素')
    assert(f3.declaration.rows[DECL_IAXIS_LINE - 1] !== f2.declaration.rows[DECL_IAXIS_LINE - 1],
      '⑤ iAxis 的值在帧 2→3 变了（INT#0 → INT#-32768）⇒ 它换新元素（稳定槽本身没变，见 ③）')
    console.log(`[自测] ③ 稳定槽：帧 0→1（${JSON.stringify('0')} → ${JSON.stringify('2048576000')}）声明区+实现区`
      + `每一个值位置逐字段相同；帧 1→2 只有 STRING 那处扩了一次（2 → 15 字符，值真的更宽了）；`
      + `帧 2→3 值变短到 ${JSON.stringify("'x'")}、INT 变到 ${JSON.stringify('-32768')} 都不动版面`
      + `（4 帧 × 两侧，槽宽只增不减、且每个槽都 ≥ 值长度）✓`)
    console.log('[自测] ⑤ 只更新变化了的行：帧 0→1 值没变的 msg/iAxis 行与实现区第 2 行**引用相同**'
      + '（React 整棵子树跳过协调），只有值变了的 MaxVel 行换新元素；帧 2→3 依然如此，两侧每行 key 逐行相同 ✓')

    // ⑦ 未知：更淡，而且绝不带 raw / tooltip（本轮把底色也纳入断言）。
    const unknownSpans = allValueSegments(inlineLines(driftDriver, 'declaration'))
      .filter((item) => item.segment.value.props['data-online-value-unknown'] === 'true')
    assert(unknownSpans.length > 0, '⑦ 这个 fixture 里必须有一个"读不到"的变量位置')
    for (const item of unknownSpans) {
      assert.strictEqual(item.segment.value.props['data-online-value-raw'], undefined, '⑦ 未知不得带 raw')
      assert.strictEqual(item.segment.value.props.title, undefined, '⑦ 未知不得带 tooltip')
      assert(Number(item.segment.value.props['data-online-value-slot']) >= 1, '⑦ 未知也有自己的稳定槽')
    }
    console.log(`[自测] ⑦ 未知：${unknownSpans.length} 处淡色占位符（底色 ${unknownBg} < 真值 ${valueBg}），`
      + '全部无 raw、无 tooltip，而且各自有自己的稳定槽 ✓')

    // ⑧ 冻结/只读不受影响 + ⑨ 零写动作：带着值刷新连读数拍，一个 mutating 动作都不许出现。
    const MUTATING_ACTIONS = ['apply-and-build', 'apply-changes', 'build', 'rebuild', 'rollback', 'update-text', 'create-pou', 'create-gvl', 'create-dut', 'import-xml']
    const ipcBeforeTicks = driftDriver.ipcCalls.length
    for (const index of [0, 1, 2, 3]) {
      await nextFrame(index)
      assert.strictEqual(editorNode(driftDriver, 'declaration').props.readOnly, true,
        `⑧ 值刷新期间编辑栏必须一直是只读冻结（帧 ${index}）`)
      assert.strictEqual(editorNode(driftDriver, 'declaration').props['data-editor-readonly'], 'true',
        `⑧ 而且 data-editor-readonly 一直如实为 true（帧 ${index}）`)
      assert.strictEqual(driftDriver.editorValue('declaration'), DRIFT_DECLARATION,
        `⑧ 任何一次值刷新都不许改动用户的代码文本（帧 ${index}）`)
    }
    const tickActions = driftDriver.ipcCalls.slice(ipcBeforeTicks).map((call) => call.action)
    assert(!tickActions.some((action) => MUTATING_ACTIONS.includes(action)),
      `⑨ 连续读数拍里一个 mutating 引擎动作都不许出现（看到 ${JSON.stringify([...new Set(tickActions)])}）`)
    assert.strictEqual(driftDriver.ipcCalls.filter((call) => MUTATING_ACTIONS.includes(call.action)).length, 0,
      '⑨ 整个流程 MUTATING 0 个')
    console.log(`[自测] ⑧⑨ 值刷新期间编辑栏一直 readOnly/只读（4 帧）、代码文本逐字不变；`
      + `连续读数拍里 mutating 动作 ${MUTATING_ACTIONS.filter((action) => tickActions.includes(action)).length} 个 ✓`)
  }

  await loginShiftCheck()
  await perfCheck()
  await capRemovalCheck()
  await perExpressionCapCheck()
  console.log('codesys inline online values behaviour passed')
}

// ── ⑧ 大体量：500 个变量时渲染耗时实测 ────────────────────────────────────────
// ── 本轮修正的自测：登录零位移（首笔读数到达之前一个值都不画）──────────────────────
// 用户报障 / T219 记录下来的取舍原文：「登录瞬间会有一次右推 —— 镜像层先画 `—`（槽宽 = 该
// IEC 类型的最大十进制宽度），首笔真值若更宽（STRING/LREAL/TIME floor=0、FB 成员摘要）则扩槽
// 一次，之后只增不减、不再移动」。
//
// 这里用"**读数何时返回由测试决定**的替身"把那两个时刻分开，于是修复的每一步都可判定：
//   ① 已登录、首笔读数还没回来 ⇒ 两个区**一个值 span 都没有**（连 `—` 都没有）⇒ 登录本身
//      不改变版面（旧行为在这里画满 `—`，floor=0 的位置槽宽 1）；
//   ② 首笔读数到达那一帧起：每个位置**第一次**画出来槽宽就是终态 —— floor=0 的位置直接等于
//      真实值的宽度（STRING 15 / REAL 3 / TIME 7，都 > 1）、floor>0 的整数型照旧等于类型下限；
//      随后连续两帧逐字段相同 ⇒ 值出现之后零位移；
//   ③ 未知 `—` 只属于"这批读数里真的没有它"的位置（更淡、无 raw/tooltip、共用稳定槽）；
//      冻结只读、编辑框逐字不变、MUTATING 0 一条不动。（500 变量性能见 perfCheck。）
const SHIFT_DECLARATION = [
  'PROGRAM Shift',
  'VAR',
  '  n : INT;',
  '  s : STRING;',
  '  r : REAL;',
  '  t : TIME;',
  '  u : UINT;',
  '  fb : TON;',
  'END_VAR',
].join('\n')
const SHIFT_IMPLEMENTATION = [
  'IF n > 0 THEN',
  '  r := r * 2.0;',
  'END_IF',
].join('\n')
// 真机形态的回报（带 IEC 类型前缀）；`u` 与 FB 成员这一批**没读到**（空串 = 没观测到）。
const SHIFT_EXPRESSIONS = ['n', 's', 'r', 't', 'u', 'fb.Q', 'fb.ET']
const SHIFT_VALUES = ['INT#3', "'ok, long text'", 'REAL#1.5', 'TIME#1s500ms', '', '', '']
// floor：这个 IEC 类型能表示的**最宽文本**（0 = 类型给不出上限）。
const SHIFT_EXPECTED = [
  { line: 3, name: 'n', type: 'INT', display: '3', floor: 6, slot: 6, raw: 'INT#3' },
  { line: 4, name: 's', type: 'STRING', display: "'ok, long text'", floor: 0, slot: 15, raw: "'ok, long text'" },
  { line: 5, name: 'r', type: 'REAL', display: '1.5', floor: 0, slot: 3, raw: 'REAL#1.5' },
  { line: 6, name: 't', type: 'TIME', display: '1s500ms', floor: 0, slot: 7, raw: 'TIME#1s500ms' },
  { line: 7, name: 'u', type: 'UINT', display: '—', floor: 5, slot: 5, raw: undefined },
  { line: 8, name: 'fb', type: 'TON', display: '—', floor: 0, slot: 1, raw: undefined },
]
const SHIFT_OBJECTS = [
  {
    name: 'Shift',
    guid: 'guid-shift',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration: SHIFT_DECLARATION,
    implementation: SHIFT_IMPLEMENTATION,
    path: ['Device', 'PLC Logic', 'Application', 'Shift'],
  },
]

async function loginShiftCheck () {
  // 可控替身：登录 effect 会**立刻**发第一笔读数（既有节拍，不需要任何点击），
  // 这一笔挂在这里不返回 —— 于是"已登录但还没读到"这一刻可以被测试稳定地观察到。
  const readCalls = []
  let pendingRead = null
  const deferredMonitor = (input) => {
    readCalls.push(input)
    return new Promise((resolve) => { pendingRead = resolve })
  }
  const driver = createWorkbenchDriver({
    objects: JSON.parse(JSON.stringify(SHIFT_OBJECTS)),
    onlineStatus: NOT_LOGGED_IN_STATUS,
    taskhive: { monitorCodesysOnline: deferredMonitor },
  })
  const settle = async (rounds = 8) => {
    for (let index = 0; index < rounds; index += 1) {
      driver.scene.flushTimers()
      await new Promise((resolve) => setImmediate(resolve))
      driver.render()
    }
  }
  await driver.settle()
  driver.clickTreeRow('Shift')
  await driver.settle()
  assert.strictEqual(inlineOverlay(driver, 'declaration'), null,
    '前提：未登录时镜像层本来就不渲染（既有语义，见 ①）')

  // ── ① 登录：读值立刻发出，但**首笔读数还没有回来** ⇒ 一个值都不画 ────────────────
  driver.setOnlineStatus(LOGGED_IN_STATUS)
  await settle()
  assert(readCalls.length > 0, '登录状态本身就要发第一笔读数（不需要点任何东西）')
  assert(inlineOverlay(driver, 'declaration') === null && inlineOverlay(driver, 'implementation') === null,
    '① 已登录但首笔读数未回：两个区的镜像层都必须**不存在**（没有 `—`、没有任何值 span）'
    + ' —— 这正是"登录时不再右推"本身')
  assert.strictEqual(driver.findAll((props) => props['data-section-online-values'] === 'true').length, 0,
    '① 首笔读数未回时没有任何一节可以声称"带着在线值"')
  assert(!String(editorNode(driver, 'declaration').props.className).includes('is-inline-mirrored'),
    '① 而且编辑框的字必须还是**可见的**（让位类还没挂上 ⇒ 那一刻屏幕上是原文代码，一个字没动）')
  assert.strictEqual(driver.editorValue('declaration'), SHIFT_DECLARATION, '① 代码文本一个字符都不许被碰')
  assert.strictEqual(driver.editorValue('implementation'), SHIFT_IMPLEMENTATION, '① 实现区同理')
  console.log(`[自测·登录零位移①] 已登录、首笔读数未回（替身挂住，已被调用 ${readCalls.length} 次）：`
    + '两个区镜像层都不存在、没有任何值 span（连占位符 `—` 都没有）、让位类未挂 '
    + '⇒ 登录本身**零位移**（旧行为在这一刻把每个变量后面都画上 1 个字宽的 `—`）✓')

  // ── ② 放行首笔读数 ⇒ 值出现，而且**第一次**画出来就是终态槽宽 ────────────────────
  assert(typeof pendingRead === 'function', '替身必须已经收到第一笔读数（否则第 ① 步的前提不成立）')
  pendingRead({ ok: true, applicationState: 'stop (2)', expressions: SHIFT_EXPRESSIONS, values: SHIFT_VALUES })
  await settle()

  const positions = (part) => {
    const out = []
    for (const [line, segments] of inlineLines(driver, part).entries()) {
      let ordinal = 0
      for (const segment of segments) {
        if (!segment.value) continue
        out.push({
          line,
          index: ordinal,
          text: textOf(segment.value),
          raw: segment.value.props['data-online-value-raw'],
          unknown: segment.value.props['data-online-value-unknown'] === 'true',
          slot: Number(segment.value.props['data-online-value-slot']),
          minWidth: String((segment.value.props.style || {}).minWidth || ''),
        })
        ordinal += 1
      }
    }
    return out
  }

  const firstDecl = positions('declaration')
  assert(firstDecl.length > 0, '② 首笔读数到达之后声明区必须有值（值的出现只由读数决定，不由点击决定）')
  for (const expected of SHIFT_EXPECTED) {
    const item = firstDecl.find((entry) => entry.line === expected.line)
    assert(item, `② 第 ${expected.line} 行的 ${expected.type} 变量 ${expected.name} 后面必须有值位置`)
    assert.strictEqual(item.text, expected.display,
      `② ${expected.type} ${expected.name} 的显示必须是真实值本身（只去掉 IEC 类型前缀）`)
    // 这一条就是"登录时不再扩槽"的直接证据：**第一次**画出来槽宽就已经是终态。
    // floor=0 的类型（给不出宽度上限）也必须是真实值的宽度，而不是 `—` 的 1 个字。
    assert.strictEqual(item.slot, expected.slot,
      `② ${expected.type} ${expected.name} 的槽宽第一次画出来就必须是终态 ${expected.slot}`
      + `（floor=${expected.floor}、值宽 ${expected.display.length}）—— 旧行为会先画 1 个字的 \`—\` 再扩槽一次`)
    assert.strictEqual(item.unknown, expected.raw === undefined,
      `② ${expected.name}：unknown 标记必须与"这一批有没有读到它"一致`)
    assert.strictEqual(item.raw, expected.raw, `② ${expected.name}：原始回报（或"没有观测到"）必须如实`)
    assert(item.slot >= expected.display.length, `② 槽宽必须 ≥ 值的字符数（永不裁切）：${expected.name}`)
    assert(item.minWidth === `calc(${item.slot}ch + 6px)`,
      `② min-width 必须由这个槽宽算出来（${expected.name}: ${JSON.stringify(item.minWidth)}）`)
  }
  // floor=0 的**被观测到**的三个位置（STRING/REAL/TIME）全部 > 1：没有"先占 1 个字"的那一刻。
  // （`fb` 也是 floor=0，但它这一批**没读到** ⇒ 它仍旧是 1 个字宽的 `—`：那是"只增不缩"保留
  //  下来的正常情形，不发生在登录那一刻 —— 见文件头。）
  const floorZero = firstDecl.filter((entry) => !entry.unknown &&
    SHIFT_EXPECTED.some((expected) => expected.line === entry.line && expected.floor === 0))
  assert(floorZero.length === 3 && floorZero.every((entry) => entry.slot > 1),
    `② floor=0 且**读到值**的三个位置（STRING/REAL/TIME）第一次出现槽宽就必须 > 1`
    + `（实际 ${JSON.stringify(floorZero.map((entry) => [entry.line, entry.slot]))}）`)
  // 值仍然紧跟它所属的变量 token（同一行、同一段流）。
  const shiftLines = inlineLines(driver, 'declaration')
  assert.deepStrictEqual(valueNamesAfterToken(shiftLines, 3), ['n'], '② 值仍必须紧跟变量 token（n）')
  assert.deepStrictEqual(valueNamesAfterToken(shiftLines, 4), ['s'], '② 值仍必须紧跟变量 token（s）')
  assert.deepStrictEqual(valueNamesAfterToken(shiftLines, 5), ['r'], '② 值仍必须紧跟变量 token（r）')
  assert.deepStrictEqual(valueNamesAfterToken(shiftLines, 6), ['t'], '② 值仍必须紧跟变量 token（t）')
  console.log(`[自测·登录零位移②] 首笔读数到达 ⇒ 每个位置**第一次**画出就是终态槽宽：`
    + SHIFT_EXPECTED.map((expected) => `${expected.type}=${expected.display.length}字/槽${expected.slot}`).join(' ')
    + '（floor=0 的三处 > 1 ⇒ 没有"先占 1 个字再扩槽"的那一步）✓')

  // ── ③ 值出现之后**零位移**：连续两帧逐字段相同（含 STRING/REAL/TIME 这类 floor=0）──
  await settle()
  const secondDecl = positions('declaration')
  assert.deepStrictEqual(secondDecl, firstDecl,
    '③ 值出现之后连续两帧，声明区每一个值位置都必须逐字段相同（含 floor=0 的 STRING/REAL/TIME）')
  await settle()
  assert.deepStrictEqual(positions('declaration'), secondDecl, '③ 再走一拍仍然逐字段相同（"只增不缩"不得在这里动）')
  const implFirst = positions('implementation')
  await settle()
  assert.deepStrictEqual(positions('implementation'), implFirst, '③ 实现区同样零位移')
  console.log(`[自测·登录零位移③] 值出现之后连续三拍：声明区 ${firstDecl.length} 个位置、实现区 ${implFirst.length} 个位置`
    + '逐字段（槽宽 + min-width + display + raw + unknown）完全相同 ⇒ 代码零位移 ✓')

  // ── ④ 未知 `—` 与冻结/只读/零写动作一条不动 ─────────────────────────────────────
  const unknownSpans = firstDecl.filter((entry) => entry.unknown)
  assert(unknownSpans.length === 2, `④ 这一批里恰好有两个"没观测到"的位置（u 与 FB 成员摘要），实际 ${unknownSpans.length}`)
  for (const item of unknownSpans) {
    assert.strictEqual(item.raw, undefined, '④ 未知不得带 raw（绝不编造）')
    assert(item.slot >= 1, '④ 未知也有自己的稳定槽')
  }
  assert.strictEqual(driver.find((props) => String(props.className || '').includes('is-unknown') && props['data-online-value-unknown'] === 'true') !== null, true,
    '④ 未知的占位符元素必须在（淡色 `—`），修复没有把它一起删掉')
  const MUTATING_ACTIONS = MUTATING_IPC_ACTIONS
  assert.strictEqual(driver.ipcCalls.filter((call) => MUTATING_ACTIONS.includes(call.action)).length, 0,
    '④ 整个登录→值出现→三拍刷新流程里 MUTATING 必须是 0')
  assert.strictEqual(editorNode(driver, 'declaration').props.readOnly, true, '④ 已登录 ⇒ 编辑栏仍然冻结只读（T217）')
  assert.strictEqual(driver.editorValue('declaration'), SHIFT_DECLARATION, '④ 冻结期间代码文本逐字不变')
  assert.strictEqual(driver.editorValue('implementation'), SHIFT_IMPLEMENTATION, '④ 实现区同理')
  console.log(`[自测·登录零位移④] 未知 ${unknownSpans.length} 处（无 raw、各有稳定槽）、`
    + `编辑栏 readOnly 冻结、代码文本逐字不变、MUTATING ${driver.ipcCalls.filter((call) => MUTATING_ACTIONS.includes(call.action)).length} 个 ✓`)
}

// ⑩b 的真机第二重边界：批量读失败 ⇒ worker 逐条回退，而逐条回退有上限与时间预算
// `MONITOR_PER_EXPRESSION_MAX = 24` / `MONITOR_PER_EXPRESSION_BUDGET_SECONDS = 4.0`。
// 真机帧（`direct-1791515392620-f7bf24fd\online\online-result-f01655b4dd74-62.json`，POU
// `AXIS_X_PRG`，27 条表达式）里最后的 `ePowerErrorDiag.Busy/Done/Error` 就是被它标成
// "本轮未读取（逐条读取的数量上限或时间预算已到）"、值留空、`errors[]` 里如实记一条。
// 这个替身**逐字复刻**那个行为：只读它收到的前 24 条，其余**照旧回带**在 `expressions` 里
// （真机就是这样）并放进 `errors`。于是"工作台必须按引擎自报的未读清单换起点"成了可判定的事：
// 只有起点会挪，那几条下一拍才会落到引擎真能读的靠前位置；不挪就是永远读不到。
const MIRROR_PER_EXPRESSION_CAP = 24

function perExpressionFallbackStub (calls, inFlight) {
  return async (input) => {
    inFlight.now += 1
    inFlight.max = Math.max(inFlight.max, inFlight.now)
    try {
      const wanted = Array.isArray(input.expressions) ? input.expressions.map((item) => String(item)) : []
      // 真机那一拍：批量读失败 ⇒ 逐条回退只读前 24 条，其余标记"本轮未读取"。
      const read = wanted.slice(0, MIRROR_PER_EXPRESSION_CAP)
      const skipped = wanted.slice(MIRROR_PER_EXPRESSION_CAP)
      calls.push({ requested: wanted, read, skipped })
      return {
        ok: true,
        applicationState: 'stop (2)',
        readMode: 'per-expression',
        partial: skipped.length > 0,
        expressions: wanted,
        values: wanted.map((name) => (read.includes(name) ? `INT#${String(name).replace(/^k/, '')}` : '')),
        errors: skipped.map((name) => ({ expression: name, error: '本轮未读取（逐条读取的数量上限或时间预算已到）' })),
      }
    } finally {
      inFlight.now -= 1
    }
  }
}

// ── ⑩ 上限去除：超过 90（也超过引擎单次上限）的读数集，**每一条都要拿到值** ──────────
// 用户规则原文：「上限去除」。旧写法在工作台里有一次 `[...simple, ...members].slice(0, 90)`，
// 于是第 90 个之后永远只剩占位符 `—`（现场看到的就是"底下很多都没有"）。
//
// 这条自测用一个**与引擎同构**的替身把这件事钉死：替身只收下并回带它收到的前 120 条 ——
// 这正是 `scriptengine.cjs` 的 `onlineMonitor`（`.slice(0, 120)`）与在线工作进程 `do_monitor`
//（`if len(expressions) >= 120: break`）的真实边界，而且替身**如实回带它收下的那一份**
//（`expressions`），跟真机 worker 一样。于是工作台自己的分批必须成立：
//   ① 第一批发出去的就是**整份**读数集（工作台不再截 90 条，也不截 120）；
//   ② 之后每一批都不超过引擎上限，而且**只推进真的读过的那一段**（不许跳过被引擎截下的部分）；
//   ③ 走完 ceil(N/120) 拍之后，N 个变量**每一条**都有它自己的真值，一个 `—` 都不剩；
//   ④ 同一个节拍只有一个请求在飞（单飞），而且全程 MUTATING 0、编辑栏保持冻结只读 ——
//      分批没有绕过任何只读红线，也没有新增定时器（走的是既有那一条节拍）。
const MIRROR_ENGINE_CAP = 120

function cappedEngineStub (calls, inFlight) {
  return async (input) => {
    inFlight.now += 1
    inFlight.max = Math.max(inFlight.max, inFlight.now)
    // 让"在飞"的窗口真的跨一个宏任务，④ 的单飞断言才有意义。
    await new Promise((resolve) => setImmediate(resolve))
    try {
      const wanted = Array.isArray(input.expressions) ? input.expressions.map((item) => String(item)) : []
      const accepted = wanted.slice(0, MIRROR_ENGINE_CAP) // ← 引擎自己的硬上限
      // requested 与 accepted 分开记：前者证明"工作台发了整份（没有 90/120 截断）"，
      // 后者证明"引擎的 120 条上限确实被尊重、而且被截下的那一段下一拍接着读"。
      calls.push({ requested: wanted, accepted })
      return {
        ok: true,
        applicationState: 'stop (2)',
        // 与真机 worker 同构：只回报它收下的那一份（并如实带回 expressions）。
        expressions: accepted,
        values: accepted.map((name) => `INT#${String(name).replace(/^k/, '')}`),
      }
    } finally {
      inFlight.now -= 1
    }
  }
}

async function capRemovalCheck () {
  const report = []
  for (const count of [150, 300]) {
    const declLines = ['PROGRAM Cap', 'VAR']
    for (let index = 0; index < count; index += 1) declLines.push(`  k${index} : INT;`)
    declLines.push('END_VAR')
    const declaration = declLines.join('\n')
    const calls = []
    const inFlight = { now: 0, max: 0 }
    const driver = createWorkbenchDriver({
      objects: [{
        name: 'Cap', guid: 'guid-cap', type: 'PROGRAM',
        hasDeclaration: true, hasImplementation: false, declaration, implementation: '',
        path: ['Device', 'PLC Logic', 'Application', 'Cap'],
      }],
      onlineStatus: LOGGED_IN_STATUS,
      taskhive: { monitorCodesysOnline: cappedEngineStub(calls, inFlight) },
    })
    await driver.settle()
    // 选中这个 POU（与其它小节同一条用户动作）。**值读取随着 POU 出现在屏上就自动开始**
    //（登录后默认开启，没有开关），所以下面不再"先断言没读"—— 断言的是读的内容对不对。
    driver.clickTreeRow('Cap')
    const expectedTicks = Math.ceil(count / MIRROR_ENGINE_CAP)
    // 走够一轮（多给两拍余量，绝不无限跑）。
    await driver.settle(expectedTicks + 4)

    // ① 第一批 = **整份**读数集：没有 90 条截断，也没有 120 条截断。
    assert(calls.length >= expectedTicks, `cap ${count}: the value poll must have run (${calls.length} calls)`)
    assert(calls.every((call) => call.accepted.length > 0), `cap ${count}: no empty request may ever be sent`)
    assert.strictEqual(calls[0].requested.length, count,
      `cap ${count}: the FIRST request must carry the WHOLE read set (no 90-expression truncation), got ${calls[0].requested.length}`)
    // ② 引擎的 120 条上限被尊重（第一批是**一次刻意的探针**，之后每一批都不超过它），
    //    而且被引擎截下的那一段**下一拍接着读**（不跳过去）。
    calls.forEach((call, index) => {
      assert(call.accepted.length <= MIRROR_ENGINE_CAP,
        `cap ${count}: the engine never accepts more than ${MIRROR_ENGINE_CAP} expressions (saw ${call.accepted.length})`)
      if (index >= 1) {
        assert(call.requested.length <= MIRROR_ENGINE_CAP,
          `cap ${count}: after calibration every request must be one batch, not the whole set (saw ${call.requested.length})`)
      }
    })
    for (let index = 1; index < expectedTicks; index += 1) {
      assert.strictEqual(calls[index]?.accepted?.[0], `k${MIRROR_ENGINE_CAP * index}`,
        `cap ${count}: batch ${index} must resume exactly where the engine stopped`
        + ` (expected to start at k${MIRROR_ENGINE_CAP * index}, got ${calls[index]?.accepted?.[0]})`)
    }
    // 头 count 条真的都被请求过一遍（被引擎截下的部分没有一条被永久跳过）。
    const requested = new Set(calls.slice(0, expectedTicks).flatMap((call) => call.accepted))
    for (let index = 0; index < count; index += 1) {
      assert(requested.has(`k${index}`), `cap ${count}: k${index} must be requested within one full cycle`)
    }
    // ③ 每一条都有它**自己**的真值，一个 `—` 都不剩。
    const lines = inlineLines(driver, 'declaration')
    const painted = allValueSegments(lines)
    const real = painted.filter((item) => item.segment.value.props['data-online-value-raw'] !== undefined)
    assert.strictEqual(painted.length, count,
      `cap ${count}: every one of the ${count} variable lines must carry an in-place value slot (got ${painted.length})`)
    assert.strictEqual(real.length, count,
      `cap ${count}: after a full batching cycle NO variable may still show the placeholder —`
      + ` nothing past the 90th (or the 120th) may be left on ` + '`—`' + ` (real values ${real.length}/${count})`)
    const displays = real.map((item) => textOf(item.segment.value))
    assert.strictEqual(new Set(displays).size, count,
      `cap ${count}: every variable must show its OWN value, not a repeated one`)
    // 第 count 条（最靠后的那一条，旧写法里永远没有值）逐字检查。
    const lastVariableLine = count + 2
    const lastRaw = valueSegments(lines, lastVariableLine)[0]
    assert.strictEqual(lastRaw?.value?.props?.['data-online-value-raw'], `INT#${count - 1}`,
      `cap ${count}: the LAST variable of the POU must show the value the controller reported for it`)
    assert.strictEqual(lineMapVisibleText(lines.get(lastVariableLine)), `  k${count - 1} ${count - 1} : INT;`,
      `cap ${count}: and it must sit in place, right after its own variable token`)
    // ④ 单飞 + 只读红线。
    assert.strictEqual(inFlight.max, 1,
      `cap ${count}: batching must stay SINGLE FLIGHT (max ${inFlight.max} monitor requests were in the air at once)`)
    assert.strictEqual(editorNode(driver, 'declaration').props.readOnly, true,
      `cap ${count}: the editor must stay frozen read-only while the batches rotate (T217)`)
    assert.strictEqual(driver.ipcCalls.filter((call) => MUTATING_IPC_ACTIONS.includes(call.action)).length, 0,
      `cap ${count}: a full batching cycle must contain ZERO mutating actions`)
    // ⑤ 性能实测：300+ 变量时的渲染耗时（这一段是要贴进报告的数字）。
    const rounds = 20
    const startedAt = process.hrtime.bigint()
    for (let index = 0; index < rounds; index += 1) driver.render()
    const renderMs = Number(process.hrtime.bigint() - startedAt) / 1e6 / rounds
    report.push({ count, batches: calls.length, firstBatch: calls[0].requested.length, cycleTicks: expectedTicks, renderMs })
    assert(renderMs < 120, `cap ${count}: a ${count}-variable object must stay responsive (measured ${renderMs.toFixed(2)} ms)`)
    console.log(`[自测] ⑩ 上限去除：${count} 个变量 → 第一批请求 ${calls[0].requested.length} 条（整份读数集），`
      + `批次大小 ${MIRROR_ENGINE_CAP}（引擎上限，替身同构），${expectedTicks} 拍走完一轮；`
      + `${count} 条**全部**拿到真值、占位符 0 个、每条都是自己的值；单飞峰值 ${inFlight.max}；`
      + `MUTATING ${driver.ipcCalls.filter((call) => MUTATING_IPC_ACTIONS.includes(call.action)).length} 个；`
      + `单次渲染 ${renderMs.toFixed(2)} ms ✓`)
  }
  console.log(`[自测] ⑩ 汇总：${report.map((item) => `${item.count} 变量/首批发 ${item.firstBatch}/一轮 ${item.cycleTicks} 拍/${item.renderMs.toFixed(2)} ms`).join('；')}`)
}

// ── ⑩b 真机第二重边界：批量读失败 + 逐条回退上限 24 时，**不能有哪一条永远读不到** ────
async function perExpressionCapCheck () {
  for (const count of [60, 300]) {
    const declLines = ['PROGRAM Fallback', 'VAR']
    for (let index = 0; index < count; index += 1) declLines.push(`  k${index} : INT;`)
    declLines.push('END_VAR')
    const declaration = declLines.join('\n')
    const calls = []
    const inFlight = { now: 0, max: 0 }
    const driver = createWorkbenchDriver({
      objects: [{
        name: 'Fallback', guid: 'guid-fallback', type: 'PROGRAM',
        hasDeclaration: true, hasImplementation: false, declaration, implementation: '',
        path: ['Device', 'PLC Logic', 'Application', 'Fallback'],
      }],
      onlineStatus: LOGGED_IN_STATUS,
      taskhive: { monitorCodesysOnline: perExpressionFallbackStub(calls, inFlight) },
    })
    await driver.settle()
    driver.clickTreeRow('Fallback')
    // 每一拍最多填 MIRROR_PER_EXPRESSION_CAP 条，给两拍余量（绝不无限跑）。
    const maxTicks = Math.ceil(count / MIRROR_PER_EXPRESSION_CAP) + 2
    await driver.settle(maxTicks)

    // ① 工作台发的仍然是**整份**读数集（第一拍就发了 count 条）。
    assert.strictEqual(calls[0].requested.length, count,
      `fallback ${count}: the first request must carry the whole read set (got ${calls[0].requested.length})`)
    // ② 起点真的挪了：第二拍的第一个表达式 = 第一拍**真的读到**的条数（不是整批条数）。
    assert.strictEqual(calls[1]?.requested?.[0], `k${MIRROR_PER_EXPRESSION_CAP}`,
      `fallback ${count}: the next tick must resume after the expressions the worker actually READ`
      + ` (got ${calls[1]?.requested?.[0]}), otherwise the skipped tail can never be reached`)
    // ③ 第一拍被标成"本轮未读取"的那几条，最终**都有值**。
    const stillMissing = []
    const lines = inlineLines(driver, 'declaration')
    const real = allValueSegments(lines)
      .filter((item) => item.segment.value.props['data-online-value-raw'] !== undefined)
    const displays = new Set(real.map((item) => textOf(item.segment.value)))
    for (let index = 0; index < count; index += 1) {
      if (!displays.has(String(index))) stillMissing.push(`k${index}`)
    }
    assert.deepStrictEqual(stillMissing, [],
      `fallback ${count}: every expression must end up with a value — including the ones the engine`
      + ` skipped in the first tick (still missing: ${stillMissing.slice(0, 8).join(',')})`)
    assert.strictEqual(real.length, count,
      `fallback ${count}: all ${count} variable lines must carry a real value (got ${real.length})`)
    assert.strictEqual(inFlight.max, 1, `fallback ${count}: batching must stay single flight`)
    assert.strictEqual(driver.ipcCalls.filter((call) => MUTATING_IPC_ACTIONS.includes(call.action)).length, 0,
      `fallback ${count}: zero mutating actions`)
    const ticksUsed = calls.findIndex((call) => call.requested[0] === 'k0' && calls.indexOf(call) > 0)
    console.log(`[自测] ⑩b 逐条回退上限（真机 24 条/4 s）：${count} 个变量 → 第一拍请求 ${calls[0].requested.length} 条、`
      + `被跳过 ${calls[0].skipped.length} 条；起点按"真读到的 ${MIRROR_PER_EXPRESSION_CAP} 条"逐拍前移，`
      + `${maxTicks} 拍内 ${count} 条**全部**拿到真值、缺 ${stillMissing.length} 条、单飞峰值 ${inFlight.max} ✓`
      + (ticksUsed > 0 ? `（回到起点用了 ${ticksUsed} 拍）` : ''))
  }
}

async function perfCheck () {
  const lines = ['PROGRAM Big', 'VAR']
  for (let index = 0; index < 500; index += 1) lines.push(`  v${index} : INT;`)
  lines.push('END_VAR')
  const declaration = lines.join('\n')
  const implementation = Array.from({ length: 500 }, (_, index) => `v${index} := ${index};`).join('\n')
  const expressions = Array.from({ length: 90 }, (_, index) => `v${index}`)
  const values = Array.from({ length: 90 }, (_, index) => `INT#${index}`)
  const monitorCalls = []
  const driver = createWorkbenchDriver({
    objects: [{
      name: 'Big', guid: 'guid-big', type: 'PROGRAM',
      hasDeclaration: true, hasImplementation: true, declaration, implementation,
      path: ['Device', 'PLC Logic', 'Application', 'Big'],
    }],
    onlineStatus: LOGGED_IN_STATUS,
    taskhive: { monitorCodesysOnline: async (input) => { monitorCalls.push(input); return { ok: true, applicationState: 'stop (2)', expressions, values } } },
  })
  await driver.settle()
  driver.clickTreeRow('Big')
  await driver.settle()
  // 本轮：不再点任何开关 —— 已登录，值自己就会出现。
  for (let i = 0; i < 4 && inlineLines(driver, 'declaration').size === 0; i += 1) {
    driver.scene.flushTimers()
    await new Promise((resolve) => setImmediate(resolve))
    driver.render()
  }
  const declarationLines = declaration.split('\n').length
  const implementationLines = implementation.split('\n').length
  const segmentsByLine = inlineLines(driver, 'declaration').size + inlineLines(driver, 'implementation').size
  // Measure the render that has to walk the whole code, build both per-line segment maps
  // and paint every in-place value.
  const rounds = 20
  const startedAt = process.hrtime.bigint()
  for (let index = 0; index < rounds; index += 1) driver.render()
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6 / rounds
  const painted = allValueSegments(inlineLines(driver, 'declaration')).length + allValueSegments(inlineLines(driver, 'implementation')).length
  assert(painted > 0, 'the 500-variable object must still paint values')
  assert.strictEqual(segmentsByLine, declarationLines + implementationLines,
    'every line of both sections must be covered by the segment maps')
  console.log(`[自测] ⑧ 大体量：${declarationLines} 行声明 + ${implementationLines} 行实现（500 个变量；`
    + `替身只回带前 ${expressions.length} 条，跨节拍分批的"每一条都要有值"在 ⑩ 里断言）`
    + ` → 单次渲染 ${elapsedMs.toFixed(2)} ms（${rounds} 次平均），画出的值 ${painted} 条，`
    + `覆盖行数 ${segmentsByLine}/${declarationLines + implementationLines} 行 ✓`)
  assert(elapsedMs < 120, `a 500-variable object must stay responsive (measured ${elapsedMs.toFixed(2)} ms per render)`)
}

main().then(() => {
  process.exit(0)
}).catch((error) => {
  console.error(`codesys inline online values behaviour failed: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
