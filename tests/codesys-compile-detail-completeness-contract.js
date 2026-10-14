'use strict'

// T227 编译明细的呈现：**全量平铺，没有折叠**。
//
// 用户口径原文（本轮）：
//   「编译输出信息不要折叠形式的，改成全部展开」
//   「（明细里要不要包含 [Info] 行？）包含」
// 因此：明细里不再有「▸ 展开查看全部 N 条」这枚按钮、不再有"默认分组 / 点了才展开"，
// **每一条消息各占一行** —— 按原始顺序、重复的逐条列出（不去重、不合并成 ×N）、
// 包含 `[Info]` 行（如「开始构建应用程序」「代码典型化...」「编译完成 -- 0错误,28警告」）。
//
// 这个契约的前身是 T225 的**完整性**契约。它当时钉住的两件事仍然全部有效，只改了呈现形态：
//   ① 生产端不再按文本去重：真机 stderr 那 34 行里 29 条 Warning 一条不少，
//      而**总量仍以编译器自己的总结行为准**（真机那次是 28，绝不允许变成 29）；
//   ② 展示端从"默认分组 + 展开按钮"改成"全量平铺"。
// 现场报障原文：面板标题写「错误 0 · 警告 28（已显示 8 条） · 信息 5」，正文只有 8 条 Warning。
// 丢掉那 20 条的是**我们自己**（`scriptengine.cjs` 里按 `${severity}\u0000${text}` 去重的 Set）。
//
// 口径（唯一一处定义在 `compileCountLabel`）：
//   · 总数仍以**编译器自己的总结行**为准（T223 不放宽）：真机那次是 28，**绝不允许**变成 29；
//   · **头部只报两个数**（T226）：`错误 0 · 警告 28` —— 不带「（已显示 N 条）」这类括注，也没有
//     「信息 N」这一档；汇总与明细的差异（真机那次明细 29：28 条编译器警告 + 1 条设备层警告）
//     只在明细列表**上方**用一行说明（`compileCountNotes` → `data-codesys-compile-note`）；
//   · 明细与汇总相等 ⇒ 头部就是那个干净的 `${count}`，上面也没有差异那一行；
//   · 错误维度、以及"汇总说 0 而正文有内容"这两种情况**一字未改**（T200 方向）。
// T227 只动呈现层：说明行从"展开按钮的文案"挪到"列表上方直接可见"，且**绝不允许**退化成
// 用折叠兜住大列表 —— 大列表必须始终全部渲染，超过 1000 条上限的那部分如实写在说明行里。
//
// 展示端走 `tests/lib/workbench-driver.js`（加载**真的** client bundle 并渲染真组件），
// 所以断言的是"用户看到的那一行字 / DOM"，不是源码里有没有某个字符串。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createWorkbenchDriver, clientFile } = require('./lib/workbench-driver')
const {
  buildCompileResult,
  applyCompileResultToPayload,
  mergeDiagnosticOccurrences,
} = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const SOURCE_PATH = 'C:/projects/demo.project'
const JOB_ID = 'direct-compile-detail'

// ── 真机原文（照抄那 34 行；顺序、标点、行尾空格都不动）────────────────────────────────
// 28 行编译器警告（`编译: Warning: C…`）+ 5 行 Info + 1 行设备层警告（文件第 1 行）。
const DEVICE_WARNING_LINE = "Devices: Warning: 缺少'GCAN_IoDrv'的设备描述"
const COMPILER_WARNING_LINES = [
  "编译: Warning: C540: 属性'no_assign' 缺失POU 'Syslog_FB'?变量'fOpen'的类型带有'no_assign'属性.",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'ULINT' 的隐含转换: 可能改变符号",
  "编译: Warning: C197: 从 'LREAL' 到 'REAL'的隐含转换：可能丢失信息",
  "编译: Warning: C197: 从 'LREAL' 到 'REAL'的隐含转换：可能丢失信息",
  "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C308: BYTE的类型大小超过偏移8",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C197: 从 'LREAL' 到 'REAL'的隐含转换：可能丢失信息",
  "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
  "编译: Warning: C197: 从 'LREAL' 到 'REAL'的隐含转换：可能丢失信息",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
  "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
]
const INFO_LINES = [
  '编译: Text: C0: ------ 开始构建应用程序 Device.Application -------',
  '编译: Text: C0: 代码典型化...',
  '附加代码检查: Text: SA0: 其他代码检查...',
  '附加代码检查: Text: SA0: 其他代码检查完成-0 个错误',
  '编译: Text: C0: 编译完成 -- 0错误,28警告',
]
// 出现 9 次的那一条（真机里 C195 的 INT→WORD 恰好重复 9 次）：逐条平铺时必须看到 9 行。
const C195_INT_TO_WORD = "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号"
// 文件里的真实顺序：设备警告在最前，其后是 Info/编译警告交错、末行是总结行。
const REAL_STDERR_LINES = [
  DEVICE_WARNING_LINE,
  INFO_LINES[0],
  INFO_LINES[1],
  ...COMPILER_WARNING_LINES,
  INFO_LINES[2],
  INFO_LINES[3],
  INFO_LINES[4],
]

// 轻微归一化：真机文件里 `BYTE的类型大小超过偏移8 ` 带一个行尾空格，`trim()` 会去掉它 ——
// 引擎在 `invokeOfflineScript` 里也做同一件事（`map((line) => line.trim())`），所以这里照做，
// 否则断言的是"我抄得对不对"而不是引擎的行为。
const REAL_STDERR = REAL_STDERR_LINES.map((line) => line.trim()).join('\n')

const { classifyConsoleLine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

// `invokeOfflineScript` 就是这么做 stderrDiagnostics 的。
function stderrDiagnosticsOf (text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => ({ severity: classifyConsoleLine(line), text: line, source: 'codesys-stderr' }))
}

// 改前的实现（照抄旧代码）：按 `${severity}\u0000${text}` 去重。留在这里当**变异对照**：
// 如果哪一天有人把去重加回来，自测①的"改后 29 条"仍然会过，但下面这条对照会说明它把
// 20 条真实重复丢掉了 —— 这正是现场那 8 条的来历。
function legacyDedupe (list) {
  const seen = new Set()
  const kept = []
  for (const item of list) {
    const key = `${item.severity}\u0000${item.text}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  return kept
}

function payloadFor (messages) {
  const compile = buildCompileResult({
    action: 'build',
    durationMs: 12546,
    projectPath: SOURCE_PATH,
    stdout: '',
    stderr: REAL_STDERR,
    messages,
    processError: null,
  })
  return applyCompileResultToPayload({ ok: true, action: 'build', messages }, compile)
}

// ── 展示端：驱动**真的** CodesysWorkbench ────────────────────────────────────────────
function makeObjects () {
  return [{
    name: 'PLC_PRG',
    guid: 'guid-plc-prg',
    type: 'PROGRAM',
    hasDeclaration: true,
    hasImplementation: true,
    declaration: 'PROGRAM PLC_PRG\nVAR\n  x : INT;\nEND_VAR',
    implementation: 'x := x + 1;',
    path: ['Device', 'PLC Logic', 'Application', 'PLC_PRG'],
  }]
}

const textOf = (element) => {
  if (!element) return ''
  const parts = Array.isArray(element.children) ? element.children : [element.children]
  return parts.map((item) => (typeof item === 'string' ? item : '')).join('')
}

// 把一棵描述符子树摊平（driver 只对整个渲染树提供 find/findAll，明细区内部的"有没有按钮"
// 必须自己走一遍子树 —— 这正是本契约要钉住的那件事）。
function subtree (value, into = []) {
  if (Array.isArray(value)) { for (const item of value) subtree(item, into); return into }
  if (value && typeof value === 'object' && 'type' in value) {
    into.push(value)
    subtree(value.children, into)
  }
  return into
}

function compileTitle (driver) {
  const toggle = driver.find((props) => props['data-codesys-compile-toggle'] === 'true')
  assert(toggle, 'a compile happened, so the compile output panel must be on screen')
  return textOf(toggle)
}

function makeDriver (payload) {
  return createWorkbenchDriver({
    objects: makeObjects(),
    sourcePath: SOURCE_PATH,
    jobId: JOB_ID,
    taskhive: {
      runCodesysScriptEngineAction: async (action) => {
        if (action === 'build' || action === 'rebuild') return { status: 'complete', payload }
        if (action === 'bind-project') return { sourcePath: SOURCE_PATH, jobId: JOB_ID, writeAvailable: true, writeBlockReason: '' }
        if (action === 'inspect-project') return { status: 'complete', payload: { complete: true, textTruncated: false, objects: makeObjects() } }
        return { status: 'complete', payload: {} }
      },
    },
  })
}

async function runCompile (driver) {
  const control = driver.find((props) => props['data-codesys-compile'] === 'true')
  assert(control, 'the workbench must render the standalone compile control')
  control.props.onClick({})
  await driver.settle()
}

const MUTATING = new Set(['create-pou', 'create-gvl', 'create-dut', 'update-text', 'apply-changes', 'apply-and-build', 'import-xml', 'rollback'])
const mutatingCalls = (driver) => driver.ipcCalls.filter((call) => MUTATING.has(call.action))

// ── 平铺明细的读取 + "没有折叠"的判据 ────────────────────────────────────────────────
// 明细行 = 真正的一条消息一行（空列表时那句"没有产生任何消息"不带这个标记，所以不会被数进来）。
const detailLineElements = (driver) => driver.findAll((props) => props['data-codesys-compile-line'] === 'true')
const detailTexts = (driver) => detailLineElements(driver).map(textOf)
const detailBody = (driver) => driver.find((props) => props['data-codesys-compile-text'] === 'true')
const noteTexts = (driver) => driver.findAll((props) => props['data-codesys-compile-note'] === 'true').map(textOf)

// 折叠机制留下的四个 DOM 标记：一个都不许出现。
const FOLD_MARKERS = [
  'data-codesys-compile-expand-all', // 「▸ 展开查看全部 N 条」那枚按钮
  'data-codesys-compile-all', // "逐条原文 / 分组"的二选一容器
  'data-codesys-compile-group', // 分组行
  'data-codesys-compile-groups', // 分组容器
]

// 自测①（DOM 那一半）：明细区里**一个按钮都没有**、四个折叠标记一个都不出现。
function assertNoFold (driver, where) {
  for (const marker of FOLD_MARKERS) {
    assert(!driver.find((props) => props[marker] !== undefined),
      `${where}：折叠机制必须不存在 —— DOM 里不许有 ${marker}`)
  }
  const body = detailBody(driver)
  assert(body, `${where}：编译面板展开后必须有明细正文容器`)
  const buttons = subtree(body.children).filter((element) => element.type === 'button')
  assert.strictEqual(buttons.length, 0,
    `${where}：明细区里不许有任何按钮（得到 ${buttons.length} 个：${buttons.map(textOf).join(' | ')}）`)
}

// ── 自测①：真机 34 行 ⇒ 明细 29 条（不再被压成 8），总数仍是编译器的 28 ────────────────
async function caseRealRunDetailComplete () {
  const diagnostics = stderrDiagnosticsOf(REAL_STDERR)
  const warnings = diagnostics.filter((item) => item.severity === 'Warning')
  assert.strictEqual(warnings.length, 29, '真机 stderr 里 Warning 级一共 29 行（28 编译器 + 1 设备层）')

  // 变异对照：改前那个 Set 去重会把这些行压成 8 个唯一文本 —— 现场"已显示 8 条"的来历。
  const legacy = legacyDedupe(diagnostics)
  assert.strictEqual(legacy.filter((item) => item.severity === 'Warning').length, 8,
    '改前（去重）恰好只剩 8 条警告 —— 与用户看到的 8 条一一对应')
  assert.strictEqual(legacy.length, 13, '改前一共只剩 13 条明细（8 警告 + 5 信息）')

  const merged = mergeDiagnosticOccurrences([[], diagnostics, []])
  assert.strictEqual(merged.length, 34, '改后一条不少：34 条明细（29 警告 + 5 信息）')
  assert.strictEqual(merged.filter((item) => item.severity === 'Warning').length, 29, '改后 29 条警告全在')
  // 顺序必须保持：编译器自己的总结行仍在最后（`parseCompileSummary` 从尾部往前找它）。
  assert.strictEqual(merged[merged.length - 1].text, INFO_LINES[4], '总结行必须仍在最后一条')

  // 同一份控制台输出的两份捕获不许翻倍（stderr 与 stdout 都是同一份 ⇒ 取最大值而不是相加）。
  const twice = mergeDiagnosticOccurrences([[], diagnostics, diagnostics])
  assert.strictEqual(twice.length, 34, 'stdout / stderr 两份同样的捕获 ⇒ 仍然是 34 条，不翻倍')

  // 结构化的 CODESYS 消息（payload.messages）与同一批控制台行合并时也不翻倍。
  const withPayload = mergeDiagnosticOccurrences([diagnostics, diagnostics, []])
  assert.strictEqual(withPayload.length, 34, 'payload 与控制台行同源 ⇒ 仍然 34 条')

  // 单发路径：控制台落在 stdout、stderr 只有启动横幅 ⇒ 同样一条不少。
  // （`invokeOfflineScript` 对 stdout 只收 Error/Warning 级，所以这里比对的是警告这一维。）
  const stdoutOnly = mergeDiagnosticOccurrences([[], [], diagnostics])
  assert.strictEqual(stdoutOnly.filter((item) => item.severity === 'Warning').length, 29,
    'stdout-only（单发路径）也必须是 29 条警告，不是 8 条')

  const payload = payloadFor(merged)
  assert.strictEqual(payload.summaryWarningCount, 28, '编译器汇总行仍然说 28（总数口径未放宽）')
  assert.strictEqual(payload.detailWarningCount, 29, '明细条数如实＝ 29（不再被去重压成 8）')
  assert.strictEqual(payload.warningCountSource, 'codesys-summary', '警告数的来源仍然是编译器汇总行')
  assert.strictEqual(payload.errorCount, 0, '汇总行说 0 错误')
  assert.strictEqual(payload.detailErrorCount, 0, '正文里没有 Error 级条目')

  // 汇总的 28 必须能被"编译器口径"的明细**正好凑出来** —— 这是"28 不是少报"的正向证据。
  const compilerGroups = new Map()
  for (const item of merged) {
    if (item.severity !== 'Warning') continue
    if (!item.text.includes('编译: Warning:')) continue
    compilerGroups.set(item.text, (compilerGroups.get(item.text) || 0) + 1)
  }
  const compilerOccurrences = [...compilerGroups.values()].reduce((sum, value) => sum + value, 0)
  assert.strictEqual(compilerOccurrences, 28, '编译器口径（文本含 "编译: Warning:"）出现次数合计必须正好 28')
  assert.strictEqual(compilerGroups.size, 7, '编译器口径只有 7 个唯一文本（28 条重复在这 7 个上）')

  return payload
}

// ── 自测②：明细**全量平铺**（真组件）—— 没有折叠、含 Info、含重复、原始顺序 ─────────────
async function caseFlatDetailAlwaysVisible (payload) {
  const driver = makeDriver(payload)
  await driver.settle()
  await runCompile(driver)

  // ③ 头部逐字仍是那两个数（T226 定的，本轮一个字都不动）。
  const title = compileTitle(driver)
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 28',
    `头部必须逐字是"错误 0 · 警告 28"（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('已显示') && !title.includes('信息') && !title.includes('29'),
    `头部不许出现"已显示"、"信息"、"29"（得到 ${JSON.stringify(title)}）`)
  assert(!/警告\s*29/.test(title), `标题里绝不出现"警告 29"（总数以编译器汇总为准，得到 ${JSON.stringify(title)}）`)
  assert(driver.statusText().includes('错误 0 · 警告 28') && !driver.statusText().includes('信息')
    && !driver.statusText().includes('已显示'),
    `状态行必须与标题同一口径，且同样不带信息档与括注（得到 ${JSON.stringify(driver.statusText())}）`)

  // ④ 差异（汇总 28 / 明细 29）**直接可见**：就在明细列表上方，不需要点开任何东西。
  const notes = noteTexts(driver)
  assert(notes.some((note) => note.includes('明细另有 1 条警告') && note.includes('不计入编译器汇总')),
    `明细上方必须直接看到那 1 条多出来的警告不计入编译器汇总（得到 ${JSON.stringify(notes)}）`)

  // ① 没有折叠：四个标记一个都没有，明细区里连一个按钮都没有。
  assertNoFold(driver, '自测②')

  // ② 全部平铺：34 行逐条出现 = 原始顺序 + 重复逐条 + [Info] 一条不少。
  const lineElements = detailLineElements(driver)
  const texts = lineElements.map(textOf)
  assert.strictEqual(lineElements.length, 34,
    `必须 34 行逐条平铺（29 Warning + 5 Info），得到 ${lineElements.length}`)
  const expected = payload.messages.map((item) => `[${String(item.severity || 'info')}] ${String(item.text || '')}`)
  assert.deepStrictEqual(texts, expected,
    '行文本与顺序必须与引擎给的 messages 完全一致（逐字、逐条、原始顺序；不许重排、不许改写）')
  assert.strictEqual(texts.filter((text) => text.startsWith('[Warning]')).length, 29,
    `29 条 Warning 必须逐条出现（得到 ${texts.filter((text) => text.startsWith('[Warning]')).length}）`)
  assert.strictEqual(texts.filter((text) => text.startsWith('[Info]')).length, 5,
    `5 条 Info 必须逐条出现（得到 ${texts.filter((text) => text.startsWith('[Info]')).length}）`)
  // [Info] 行逐条点名（用户口径："包含"）——「开始构建应用程序」「代码典型化...」「编译完成…」都在。
  for (const info of INFO_LINES) {
    assert(texts.includes(`[Info] ${info}`), `[Info] 行必须逐条出现在明细里（缺：${info}）`)
  }
  // 重复项**逐条**都在：C195 那条出现 9 次就该有 9 行（不是一行 ×9）。
  const c195Lines = texts.filter((text) => text === `[Warning] ${C195_INT_TO_WORD}`).length
  assert.strictEqual(c195Lines, 9, `重复项必须逐条列：C195(INT→WORD) 出现 9 次就该有 9 行（得到 ${c195Lines}）`)
  // 编译器口径的 28 条必须能在这 34 行里**正好数出来**（T225 那条"28 与分组相加一致"的证据，
  // 现在直接落在平铺行上）：明细一条不多、一条不少。
  const compilerLines = texts.filter((text) => text.startsWith('[Warning]') && text.includes('编译: Warning:')).length
  assert.strictEqual(compilerLines, 28,
    `平铺明细里"编译: Warning:"必须正好 28 行（得到 ${compilerLines}）—— 与编译器汇总的 28 逐条对上`)
  const deviceLines = texts.filter((text) => text.includes('Devices: Warning:')).length
  assert.strictEqual(deviceLines, 1, `设备层那 1 条也在，且不改写它的类别（得到 ${deviceLines}）`)
  // 合并会把这些行压成 13 行；行数 34 配上 13 个唯一文本正是"重复全在"的证据。
  assert.strictEqual(new Set(texts).size, 13,
    `唯一文本 13 个、行数 34 ⇒ 重复的全部逐条保留（得到 ${new Set(texts).size} 个唯一文本）`)
  assert(!texts.some((text) => text.includes('×')),
    '不许再出现"×出现次数"这种分组行 —— 分组视图已经删除')
  // 首尾顺序：设备层警告在最前，编译器总结行在最后。
  assert.strictEqual(texts[0], `[Warning] ${DEVICE_WARNING_LINE}`, '第一行必须是最早那条（设备层警告）')
  assert.strictEqual(texts[texts.length - 1], `[Info] ${INFO_LINES[4]}`, '最后一行必须仍是编译器总结行')
  // 行上的顺序标记必须是 0..33：探针可读，同时证明没有任何重排。
  const indexes = lineElements.map((element) => Number(element.props['data-codesys-compile-index']))
  assert.deepStrictEqual(indexes, payload.messages.map((_, index) => index),
    'data-codesys-compile-index 必须是原始顺序 0..N-1')

  // ⑦ MUTATING 0：全量平铺本身（以及下面的重新编译）不许产生任何写动作。
  assert.strictEqual(mutatingCalls(driver).length, 0, 'MUTATING 0：平铺渲染不许产生任何写动作')

  // 换一份新报告 ⇒ 仍然是 34 行全量平铺（没有"上一轮展开态"这种东西可以残留）。
  await runCompile(driver)
  assert.strictEqual(detailLineElements(driver).length, 34, '新一次编译 ⇒ 明细仍然是 34 行全量平铺')
  assertNoFold(driver, '自测②（重新编译后）')
  assert.strictEqual(mutatingCalls(driver).length, 0, 'MUTATING 0：重新编译也不许产生任何写动作')

  driver.unmount()
  return { title, lines: lineElements.length, infoLines: 5, c195Lines, notes }
}

// ── 自测③：明细与汇总相等时是干净的 `${count}`（"修好了"的样子）───────────────────────
async function caseCleanWhenComplete () {
  // 把真机那 20 条重复各留一条 ⇒ 28 条编译器警告压成 7 条唯一文本、汇总仍是 28 会不相等，
  // 所以这里要的是"明细恰好等于汇总"：用一份明细 28、汇总 28 的样本。
  const messages = []
  for (let index = 0; index < 28; index += 1) messages.push({ severity: 'Warning', source: 'codesys-stderr', text: `编译: Warning: C1${String(index).padStart(3, '0')}: 样本告警 ${index}` })
  messages.push({ severity: 'Info', source: 'codesys-stderr', text: INFO_LINES[4] })
  const payload = payloadFor(messages)
  assert.strictEqual(payload.summaryWarningCount, 28, '汇总行说 28')
  assert.strictEqual(payload.detailWarningCount, 28, '明细也是 28')
  const driver = makeDriver(payload)
  await driver.settle()
  await runCompile(driver)
  const title = compileTitle(driver)
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 28',
    `明细齐了就该是干净的 28（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('已显示') && !title.includes('信息'),
    `明细与汇总相等时头部仍然只有两个数（得到 ${JSON.stringify(title)}）`)
  assert.strictEqual(noteTexts(driver).length, 0,
    '明细与汇总相等 ⇒ 列表上方连差异那一行都不该有（安静）')
  // 明细也是全量平铺：28 条警告 + 1 条总结 = 29 行，且没有折叠。
  assert.strictEqual(detailLineElements(driver).length, 29,
    `28 条警告 + 1 条 [Info] 总结必须在列表里逐条可见（得到 ${detailLineElements(driver).length}）`)
  assertNoFold(driver, '自测③')
  driver.unmount()
  return { title, lines: 29 }
}

// ── 自测④：大列表**始终全部渲染**（没有折叠兜底）+ 超过 1000 条上限时不许把 1000 冒充"全部" ──
async function caseLargeListHonest () {
  const CODE_TEXTS = [
    "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
    "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
    "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
    "编译: Warning: C197: 从 'LREAL' 到 'REAL'的隐含转换：可能丢失信息",
  ]
  const messages = []
  for (let index = 0; index < 500; index += 1) messages.push({ severity: 'Warning', source: 'codesys-stderr', text: CODE_TEXTS[index % CODE_TEXTS.length] })
  for (let index = 0; index < 100; index += 1) messages.push({ severity: 'Info', source: 'codesys-stderr', text: INFO_LINES[index % 2] })
  messages.push({ severity: 'Info', source: 'codesys-stderr', text: '编译: Text: C0: 编译完成 -- 0错误,500警告' })
  const payload = payloadFor(messages)
  const driver = makeDriver(payload)
  await driver.settle()

  const startedAt = process.hrtime.bigint()
  await runCompile(driver)
  const compileMs = Number(process.hrtime.bigint() - startedAt) / 1e6
  const texts = detailTexts(driver)
  // 601 条**始终全部渲染**：默认视图就是全量，不存在"先只画分组、点了才画全部"。
  assert.strictEqual(texts.length, 601, `601 条必须始终全部渲染（得到 ${texts.length}）`)
  assert.strictEqual(texts.filter((text) => text.startsWith('[Warning]')).length, 500, '500 条警告逐条在')
  assert.strictEqual(texts.filter((text) => text.startsWith('[Info]')).length, 101, '101 条 Info 逐条在（含总结行）')
  assert.strictEqual(texts[0], `[Warning] ${CODE_TEXTS[0]}`, '第一行必须是最早那条消息（原始顺序）')
  assert.strictEqual(texts[500], `[Info] ${INFO_LINES[0]}`, '第 501 行必须正好是第一条 Info（顺序没有被打乱）')
  assert.strictEqual(texts[texts.length - 1], '[Info] 编译: Text: C0: 编译完成 -- 0错误,500警告', '最后一行仍是编译器总结行')
  // 4 个唯一警告文本 + 2 个唯一 Info + 1 条总结 = 7 个唯一文本；行数 601 ⇒ 一条没被合并。
  assert.strictEqual(new Set(texts).size, 7, `7 个唯一文本、601 行 ⇒ 没有去重/合并（得到 ${new Set(texts).size}）`)
  assert(!texts.some((text) => text.includes('×')), '大列表里也不许出现 ×N 分组行')
  assertNoFold(driver, '自测④（601 条）')
  assert.strictEqual(mutatingCalls(driver).length, 0, 'MUTATING 0：大列表渲染不许产生任何写动作')
  driver.unmount()

  // 超过 1000 条上限：上限说明必须**直接可见**（以前它挂在展开按钮的文案里，不点开就看不见），
  // 绝不把 1000 冒充"全部"。
  const hugeMessages = []
  for (let index = 0; index < 1400; index += 1) hugeMessages.push({ severity: 'Warning', source: 'codesys-stderr', text: CODE_TEXTS[index % CODE_TEXTS.length] })
  hugeMessages.push({ severity: 'Info', source: 'codesys-stderr', text: '编译: Text: C0: 编译完成 -- 0错误,1400警告' })
  const hugePayload = payloadFor(hugeMessages)
  const hugeDriver = makeDriver(hugePayload)
  await hugeDriver.settle()
  const hugeStartedAt = process.hrtime.bigint()
  await runCompile(hugeDriver)
  const hugeMs = Number(process.hrtime.bigint() - hugeStartedAt) / 1e6
  const hugeTitle = compileTitle(hugeDriver)
  const hugeTexts = detailTexts(hugeDriver)
  // T226：头部仍然只有两个数（上限这件事一个字都不往头部放）。这一组的汇总数来自同一份真机
  // stderr（`payloadFor` 一直带着它），所以头部是编译器汇总的 28 —— 与"载入 1000 条"的差异
  // 只在列表上方那行说明里。客户端那 1000 条上限仍在（它是界面保护，不是折叠）：
  // 1400 条样本 ⇒ 永远渲染的是前 1000 条，其余 401 条由说明行如实交代。
  assert.strictEqual(hugeTitle, '▾ 编译输出 · 错误 0 · 警告 28',
    `明细没载全时头部也还是那两个数（得到 ${JSON.stringify(hugeTitle)}）`)
  assert(!hugeTitle.includes('已显示') && !hugeTitle.includes('信息') && !hugeTitle.includes('1000'),
    `头部不许出现"已显示 N 条"、"信息 N"或 1000（得到 ${JSON.stringify(hugeTitle)}）`)
  assert.strictEqual(hugeTexts.length, 1000,
    `载入上限 1000 条：明细仍然全部平铺（得到 ${hugeTexts.length}）—— 不许用折叠把大列表藏起来`)
  assert(!hugeTexts.some((text) => text.includes('×')), '上限那组也不许用 ×N 分组行压缩')
  assert.strictEqual(new Set(hugeTexts).size, 4, '1000 行只有 4 个唯一文本 ⇒ 重复逐条都在')
  assertNoFold(hugeDriver, '自测④（超上限）')
  // ⑤ 上限说明直接可见，且逐字给出"共 1401 条、超出上限的 401 条未载入"，不冒充"全部"。
  const hugeNotes = noteTexts(hugeDriver)
  assert(hugeNotes.some((note) => note.includes('共 1401 条') && note.includes('超出上限的 401 条未载入')),
    `列表上方必须直接看到"共 1401 条、超出上限的 401 条未载入"（得到 ${JSON.stringify(hugeNotes)}）`)
  assert(hugeNotes.some((note) => note.includes('不把 1000 冒充「全部」')),
    `不许把 1000 冒充"全部"，这句话必须直接可见（得到 ${JSON.stringify(hugeNotes)}）`)
  assert.strictEqual(mutatingCalls(hugeDriver).length, 0, 'MUTATING 0：超上限那组也不许产生任何写动作')
  hugeDriver.unmount()

  // ⑥ 性能实测：明细"始终全部渲染"以后的上屏耗时（含 IPC + 整棵树的渲染）。
  const budgetMs = 5000
  assert(compileMs < budgetMs, `601 条始终渲染必须远快于 ${budgetMs} ms（实测 ${compileMs} ms）`)
  assert(hugeMs < budgetMs, `1000 条始终渲染必须远快于 ${budgetMs} ms（实测 ${hugeMs} ms）`)
  return { compileMs, hugeMs, lines: texts.length, hugeLines: hugeTexts.length, hugeNotes, budgetMs }
}

// ── 自测⑥：现场报障时的原始形态 —— 明细只有 8 条、汇总 28 ⇒ 总数 28 / 明细 8 / 那 8 条都在 ──
// 用户原话那 8 条正文（设备描述缺失 + C540 + C195 + C197 + C196 + C195 + C196 + C308），各一条。
// 13 条明细（8 警告 + 5 信息）现在一律逐条平铺，没有任何"没有重复反而要点一下"的中间态。
async function caseOriginalEightDetails () {
  const eight = [
    DEVICE_WARNING_LINE,
    "编译: Warning: C540: 属性'no_assign' 缺失POU 'Syslog_FB'?变量'fOpen'的类型带有'no_assign'属性.",
    "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'ULINT' 的隐含转换: 可能改变符号",
    "编译: Warning: C197: 从 'LREAL' 到 'REAL'的隐含转换：可能丢失信息",
    "编译: Warning: C196: 从无符号类型 'UINT' 到有符号类型'INT' 的隐含转换：可能改变符号",
    "编译: Warning: C195: 从有符号类型 'INT' 到无符号类型'WORD' 的隐含转换: 可能改变符号",
    "编译: Warning: C196: 从无符号类型 'WORD' 到有符号类型'INT' 的隐含转换：可能改变符号",
    '编译: Warning: C308: BYTE的类型大小超过偏移8',
  ]
  const messages = [...eight.map((text) => ({ severity: 'Warning', source: 'codesys-stderr', text })), ...INFO_LINES.map((text) => ({ severity: 'Info', source: 'codesys-stderr', text }))]
  const payload = payloadFor(messages)
  assert.strictEqual(payload.summaryWarningCount, 28, '总数仍以编译器总结为准：28')
  assert.strictEqual(payload.detailWarningCount, 8, '明细如实：8 条')

  const driver = makeDriver(payload)
  await driver.settle()
  await runCompile(driver)
  const title = compileTitle(driver)
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 28',
    `现场原文形态（8 条明细 / 汇总 28）头部逐字只有这两个数（得到 ${JSON.stringify(title)}）`)
  assert(!/警告\s*8(?!\d)/.test(title) && !title.includes('已显示') && !title.includes('信息'),
    `头部不许出现明细条数、括注或信息档（得到 ${JSON.stringify(title)}）`)
  const body = detailBody(driver)
  assert(body, '明细正文必须能展开')
  // 差异说明那一行在**明细列表上方**，直接可见。
  const notes = noteTexts(driver)
  assert(notes.some((note) => note.includes('编译器汇总 28 条') && note.includes('本次明细只有 8 条')),
    `列表上方必须有一行说明汇总 28 与明细 8 的差异（得到 ${JSON.stringify(notes)}）`)
  // 13 条明细逐条平铺，那 8 条 Warning 一条不少。
  const texts = detailTexts(driver)
  assert.strictEqual(texts.length, 13, `8 条警告 + 5 条信息 = 13 行全量平铺（得到 ${texts.length}）`)
  const shown = texts.filter((text) => text.startsWith('[Warning]'))
  assert.strictEqual(shown.length, 8, `明细里必须能看到那 8 条警告（得到 ${shown.length}）`)
  assert.strictEqual(shown.filter((text) => text === `[Warning] ${DEVICE_WARNING_LINE}`).length, 1,
    '设备层那条警告也逐条显示（它的类别 Devics 写在原文里，不冒充编译器警告）')
  // 没有重复也必须一样平铺：不再有"没有重复就不画按钮"这种分支（按钮整个没了）。
  assertNoFold(driver, '自测⑥')
  driver.unmount()
  return { title, shown: shown.length, lines: texts.length, notes }
}

// ── 自测⑤：源码形状 —— 折叠机制不存在、说明直接可见、没有定时器、没有去重 ────────────────
function caseSourceShape () {
  const client = fs.readFileSync(clientFile, 'utf8')
  const engine = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/codesys-monitor/scriptengine.cjs'), 'utf8')

  // 旧去重必须**不再存在**（它是丢掉 20 条的那一行）。
  assert(!engine.includes('if (messageKeys.has(key)) continue'),
    '按文本去重的那一行必须删除：它就是"28 条只显示 8 条"的根因')
  assert(engine.includes('function mergeDiagnosticOccurrences(sources)'),
    '改成按出现次数合并，且这个函数是唯一一处合并规则')
  assert(engine.includes('counts.set(key, Math.max(counts.get(key) || 0, value))'),
    '每个键取各来源出现次数的**最大值**（两份捕获不翻倍，真实重复不丢）')

  // T227：折叠机制必须**整条不存在**。断言用的是"代码形状"（带引号的属性名 / 声明），
  // 因为客户端里保留了说明这段历史的注释 —— 注释提到一个名字不算把它写回来。
  assert(!client.includes('const [compileAllOpen'),
    '明细的展开态 state 必须删除（折叠机制整条移除）')
  assert(!client.includes('setCompileAllOpen('),
    '没有任何地方再改展开态：那条代码路径必须整条不存在（不许自动展开、也不许点了才展开）')
  assert(!client.includes('const compileMessageGroups'),
    '分组用的 memo 必须删除（明细不再按唯一文本合成一行）')
  assert(!client.includes("'data-codesys-compile-expand-all': 'true'"),
    '「▸ 展开查看全部 N 条」按钮的标记必须删除')
  assert(!client.includes('▸ 展开查看全部') && !client.includes('▾ 收起逐条明细'),
    '客户端不许再产出"展开查看全部 / 收起逐条明细"这两句按钮文案')
  assert(!client.includes("'data-codesys-compile-all': 'true'"),
    '"逐条原文 / 分组"的二选一容器标记必须删除')
  assert(!client.includes("'data-codesys-compile-group': 'true'")
    && !client.includes("'data-codesys-compile-groups': 'true'")
    && !client.includes("'data-codesys-compile-group-count':"),
    '分组行 / 分组容器 / ×出现次数 的标记必须全部删除')
  assert(!client.includes("'taskhive-codesys-compile-more'"),
    '那枚展开按钮的样式类必须删除（样式表里对应的三条规则也一并删了）')

  // 平铺明细必须带上可定位的标记（契约与探针靠它读"一条消息一行"）。
  assert(client.includes("'data-codesys-compile-line': 'true'"),
    '每一条消息都要带 data-codesys-compile-line（一条一行，探针据此逐条读）')
  assert(client.includes("'data-codesys-compile-lines': 'true'"),
    '平铺列表容器要带 data-codesys-compile-lines')
  assert(client.includes('compileReport.messages.map((item, index) => h(\'div\', {'),
    '明细必须直接由 messages 逐条 map 出来（不经过任何分组/去重/截断的中间结构）')
  assert(!client.includes('compileReport.messages.length > '),
    '不许再出现"分组之后变短了才画按钮"这种分支')

  // 头部那颗开关仍在（它收起的只是**整个面板**；面板里的明细不再折叠）——T226 的头部一个字不动。
  assert(client.includes("'data-codesys-compile-toggle': 'true'"),
    '面板头部开关仍在（收起的只是整个面板，不是明细）')
  assert(client.includes('编译输出 · ${compileCountText(compileReport)}'),
    '头部文案仍然只走那唯一一处 compileCountText')

  // 计数文案的唯一一处定义仍在使用（T223/T226 那几条断言的**意图**没被绕过：总数以汇总为准、
  // 口径说明不丢 —— 只是说明从"展开按钮的文案"挪到了列表上方）。
  assert(client.includes('const compileCountLabel = (count, report, dimension) => {'), '计数文案仍然只有一处定义')
  assert(client.includes('const compileCountNotes = (report) =>'), '口径说明（汇总 / 明细差异 / 载入上限）仍然只有一处定义')
  assert(client.includes("'data-codesys-compile-note': 'true'"), '口径说明必须画出来（带 data-codesys-compile-note 标记）')
  assert(client.includes('明细上限：本次只载入 ${report.messages.length} 条')
    && client.includes('超出上限的 ${report.messagesOmitted} 条未载入')
    && client.includes('不把 ${report.messages.length} 冒充「全部」'),
    '载入上限必须如实写在说明行里（不把载入条数冒充"全部"）')
  // 头部共用的文案里**不许**再有括注与信息档（T226 修掉的就是这两样）。
  assert(!/const compileCountText = \(report\) => `[^`]*（/.test(client), '头部文案里不许再有「（已显示 N 条）」这类括注')
  assert(!/const compileCountText = \(report\) => `[^`]*信息/.test(client), '头部文案里不许再有「信息 N」这一档')
  assert(client.includes('明细另有 ${detailCount - summaryCount} 条警告'), '"明细多出来的不计入编译器汇总"这件事必须写出来')
  assert(client.includes('编译器汇总只报 ${summaryCount} 条'), '"汇总行报 N"这个方向也必须写出来')
  assert(client.includes("if (count === null || count === undefined) return '未知'"),
    '解析不出计数时必须显示"未知"，绝不能退化成 0（T200）')

  // 不抢注意力 / 不新增定时器 / 不加徽章：整段明细渲染里不许出现这些。
  const marker = "'data-codesys-compile-lines': 'true'"
  const at = client.indexOf(marker)
  assert(at > 0, '平铺列表容器必须带 data-codesys-compile-lines 标记（契约与探针靠它定位）')
  const window = client.slice(Math.max(0, at - 1600), at + 1600)
  for (const banned of ['setTimeout', 'setInterval', 'autoFocus', 'requestAnimationFrame', '.focus(', 'IntersectionObserver']) {
    assert(!window.includes(banned), `明细渲染这一段不许出现 ${banned}（不抢注意力、不新增定时器、不做连续监视）`)
  }
  // 明细视图的样式类只剩下平铺容器那一条（按钮的样式规则随按钮一起删）。
  const skin = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/src/60-skin-and-embedded-surfaces.js'), 'utf8')
  assert(skin.includes('.taskhive-codesys-compile-lines{display:block;min-width:0}'),
    '平铺容器的样式规则必须在')
  assert(!skin.includes('.taskhive-codesys-compile-more{'),
    '展开按钮的样式规则必须删除（没有那颗按钮了）')
  assert(!skin.includes('.taskhive-codesys-compile-groups'), '分组容器的样式规则必须删除')
  const colors = assertSeverityColours(skin, client)
  return { window: window.length, colors }
}

// ── T228 ─────────────────────────────────────────────────────────────────────────────────
// 用户口径原文：「错误行标红/警告行标黄」。上面那些断言说的是"一条消息一行、一行不少"，
// 这里补的是"每一行**看得懂是什么级别**"：三类颜色必须**互不相同**，错误不是黄的、警告不是
// 红的，说明行与 Info 行**不许**被当成错误涂色。全部只读样式表原文，不改任何数据。

function colourOf (value) {
  const text = String(value || '').trim().toLowerCase()
  const short = /^#([0-9a-f]{3})$/.exec(text)
  if (short) return short[1].split('').map((char) => parseInt(char + char, 16)).join(',')
  const long = /^#([0-9a-f]{6})$/.exec(text)
  if (long) return long[1].match(/../g).map((pair) => parseInt(pair, 16)).join(',')
  const func = /^rgba?\(([^)]+)\)$/.exec(text)
  if (func) {
    const parts = func[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
    if (parts.length === 3) return parts.map((part) => String(Number(part))).join(',')
  }
  return text
}

// WCAG 相对亮度 / 对比度：只说"淡底 + 深字"，不如直接把比值算出来钉住。
function relativeLuminance (rgb) {
  const channels = String(rgb).split(',').map((part) => Number(part) / 255)
  if (channels.length !== 3 || channels.some((value) => !Number.isFinite(value))) return NaN
  const linear = channels.map((value) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function hueOf (rgb) {
  const values = String(rgb).split(',').map((part) => Number(part) / 255)
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return NaN
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min
  if (span === 0) return NaN
  let hue
  if (max === values[0]) hue = ((values[1] - values[2]) / span) % 6
  else if (max === values[1]) hue = (values[2] - values[0]) / span + 2
  else hue = (values[0] - values[1]) / span + 4
  hue *= 60
  return hue < 0 ? hue + 360 : hue
}

function contrastRatio (front, back) {
  const a = relativeLuminance(front)
  const b = relativeLuminance(back)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function assertSeverityColours (skin, client) {
  const prefix = '[data-taskhive-codesys-workbench="true"] '
  const classes = ['is-error', 'is-warning', 'is-info']
  // 内联 style 会赢过样式表：编译输出的**渲染点**只要有一处内联涂色，"颜色只由令牌 + 样式表
  // 决定"就不成立（工作台别处确有既有的内联样式，这里只圈编译输出的渲染点，不越界管别人）。
  const renderAt = client.indexOf("compileReport ? h('section', {")
  const scanMark = "'data-codesys-scan-panel': 'true'"
  const compileSection = renderAt > 0
    ? client.slice(renderAt, (() => {
      const scanAt = client.indexOf(scanMark, renderAt)
      return scanAt > renderAt ? scanAt : renderAt + 4000
    })())
    : ''
  assert(compileSection.length > 0, '编译输出的渲染点必须能在渲染源码里定位')
  const inlinePainted = (compileSection.match(/style: \{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) || [])
    .filter((entry) => /\b(?:background|backgroundColor|color|boxShadow|borderColor)\s*:/.test(entry))
  assert(inlinePainted.length === 0,
    `编译输出这段渲染里不许内联涂色（颜色必须只来自样式表令牌）：${inlinePainted.slice(0, 2).join(' | ')}`)
  // 令牌块（:root,[data-...="true"]{...}）里 --th-* 的字面值。规则里只许引用令牌，
  // 不许把颜色写散在业务代码里，所以这里就是"解析出来的颜色"的唯一来源。
  // 先把注释整段去掉再按 `;` 拆声明：令牌块里的注释文本**可以**带分号（本轮那几个令牌的说明
  // 就带），不先去注释就会把注释当成声明，把令牌解析成 var(...) 的原样文本。
  const tokenBlock = /:root[^{]*\{([^}]*)\}/.exec(skin)
  assert(tokenBlock, '主题令牌块必须在（:root,[data-taskhive-codesys-workbench="true"]{...}）')
  const tokens = new Map()
  for (const entry of tokenBlock[1].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const at = entry.indexOf(':')
    if (at <= 0) continue
    tokens.set(entry.slice(0, at).trim(), entry.slice(at + 1).trim())
  }
  const resolve = (value) => {
    const text = String(value || '').trim()
    const indirect = /^var\(\s*(--th-[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i.exec(text)
    if (!indirect) return text
    const declared = tokens.get(indirect[1])
    return declared ? declared : (indirect[2] || text)
  }
  for (const name of ['--th-error-ink', '--th-error-bg', '--th-warn-ink', '--th-warn-bg']) {
    assert(tokens.get(name), `级别着色令牌 ${name} 必须在主题令牌块里给出字面值`)
  }
  const rulesFor = (role) => {
    const marker = `${prefix}.taskhive-codesys-compile-line.${role}{`
    const found = []
    let from = 0
    for (;;) {
      const at = skin.indexOf(marker, from)
      if (at < 0) break
      const end = skin.indexOf('}', at)
      assert(end > at, `${marker} 的规则必须闭合`)
      found.push({ index: at, body: skin.slice(at + marker.length, end) })
      from = at + marker.length
    }
    return found
  }
  const declarationValue = (text) => (/^#[0-9a-fA-F]{3,8}$/.test(String(text).trim()) ? String(text).trim() : text)
  // 声明的**颜色值**必须全部走令牌：不许出现字面 #rrggbb / rgb()（"别把颜色写散在业务代码里"）。
  const assertTokenOnly = (body, label) => {
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const property = declaration.slice(0, colon).trim().toLowerCase()
      const value = declaration.slice(colon + 1).trim()
      if (!/(^|-)color$|^background$|^box-shadow$/.test(property)) continue
      assert(!/#|rgba?\(/.test(value),
        `${label} 的 ${property} 必须引用主题令牌，不许写死颜色字面值（现在是 ${value}）`)
    }
  }

  const computed = {}
  for (const role of classes) {
    // 级联：`.compile-line`（基础）+ `.compile-line.<role>`（旧的中性/单色那条）
    //       + `.compile-line.<role>`（本轮那条着色，靠"后写者赢"，不吃 !important）。
    const base = skin.indexOf(`${prefix}.taskhive-codesys-compile-line{`)
    assert(base > 0, '平铺行必须有基础规则 .taskhive-codesys-compile-line{...}')
    const baseEnd = skin.indexOf('}', base)
    const chain = [{ index: base, body: skin.slice(base + `${prefix}.taskhive-codesys-compile-line{`.length, baseEnd) }]
    chain.push(...rulesFor(role))
    let color = null
    let background = null
    let shadow = null
    for (const rule of chain) {
      assertTokenOnly(rule.body, `.compile-line.${role} 第 ${chain.indexOf(rule) + 1} 条`)
      for (const declaration of rule.body.split(';')) {
        const colon = declaration.indexOf(':')
        if (colon < 0) continue
        const property = declaration.slice(0, colon).trim().toLowerCase()
        const value = declaration.slice(colon + 1).trim()
        if (property === 'color') color = value
        else if (property === 'background' || property === 'background-color') background = value
        else if (property === 'box-shadow') shadow = value
      }
    }
    assert(color, `.compile-line.${role} 必须有字色（从中性墨色到级别色）`)
    computed[role] = {
      ink: colourOf(resolve(color)),
      inkDeclared: declarationValue(color),
      bg: colourOf(resolve(background)),
      bgDeclared: background === null ? 'transparent' : declarationValue(background),
      barDeclared: shadow ? declarationValue(shadow) : null,
    }
  }

  const error = computed['is-error']
  const warning = computed['is-warning']
  const info = computed['is-info']
  const distinct = new Set([error.ink, warning.ink, info.ink])
  assert(distinct.size === 3,
    `错误 / 警告 / 中性三类的字色必须互不相同，现在解析出来是 ${[...distinct].join(' | ')}`)
  assert(error.inkDeclared !== warning.inkDeclared,
    '错误行与警告行不许用同一个颜色令牌（那等于没分级）')
  assert(info.inkDeclared !== error.inkDeclared && info.inkDeclared !== warning.inkDeclared,
    'Info 行的字色必须与错误/警告都不同 —— 它保持中性，不抢眼')

  // 错误行不是黄的、警告行不是红的 —— 用通道关系说清楚，不靠肉眼看色号。
  const channels = (rgb) => String(rgb).split(',').map(Number)
  const [errorR, errorG, errorB] = channels(error.ink)
  const [warnR, warnG, warnB] = channels(warning.ink)
  assert(errorR > errorG && errorR > errorB, `错误行必须是红系（R 最大），解析出 ${error.inkDeclared} = rgb(${error.ink})`)
  assert(warnR > warnB && warnG > warnB, `警告行必须是暖黄/琥珀系（B 最小），解析出 ${warning.inkDeclared} = rgb(${warning.ink})`)
  // 「错误行不是黄的、警告行不是红的」用色相说清楚：红系色相 ≤ 20°，黄/琥珀系 35°–70°，
  // 两段之间留出空档，所以任何一侧漂到对方的色相域都会被拦下（这才是这两句话的判据）。
  const errorHue = hueOf(error.ink)
  const warningHue = hueOf(warning.ink)
  assert(errorHue <= 20,
    `错误行必须是红（色相 ≤ 20°，不许落到黄/琥珀 35°–70°），解析出 ${error.inkDeclared} = rgb(${error.ink}) 色相 ${errorHue.toFixed(1)}°`)
  assert(warningHue >= 35 && warningHue <= 70,
    `警告行必须是黄/琥珀（色相 35°–70°，不许落到红 ≤ 20°），解析出 ${warning.inkDeclared} = rgb(${warning.ink}) 色相 ${warningHue.toFixed(1)}°`)
  const distance = (a, b) => {
    const x = channels(a)
    const y = channels(b)
    return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])
  }
  assert(distance(error.ink, warning.ink) > 60,
    `错误红与警告黄必须一眼分得开（现在两色的通道差只有 ${distance(error.ink, warning.ink)}）`)
  assert(distance(info.ink, error.ink) > 100 && distance(info.ink, warning.ink) > 100,
    '中性行与两个级别色也必须分得开')

  // 荧光色禁令：不许纯 #ff0000 / #ffff00 这一类的饱和色当字色或底。
  const fluorescence = new Set(['255,0,0', '255,255,0', '255,0,255', '0,255,0', '0,255,255'])
  for (const role of classes) {
    assert(!fluorescence.has(computed[role].ink), `拒绝荧光字色：.compile-line.${role} 解析出 rgb(${computed[role].ink})`)
    assert(!fluorescence.has(computed[role].bg), `拒绝荧光底色：.compile-line.${role} 解析出 rgb(${computed[role].bg})`)
  }
  // 着色必须避开既有那几个语义色的字面值（免得"红"和"危险"两个意思被混在一处）。
  for (const banned of ['#ff0000', '#ffff00', '#fff000', 'red', 'yellow', '#f00', '#ff0']) {
    for (const role of classes) {
      assert(!String(computed[role].inkDeclared).toLowerCase().includes(banned)
        && !String(computed[role].bgDeclared).toLowerCase().includes(banned),
        `.compile-line.${role} 不许用高饱和字面色 ${banned}`)
    }
  }

  // 「淡底 + 深字」：底必须比字亮得多，对比度还不能低于 7:1（不然就是"看得见颜色、看不清字"）。
  for (const role of ['is-error', 'is-warning']) {
    assert(relativeLuminance(computed[role].bg) > relativeLuminance(computed[role].ink),
      `${role} 必须是淡底 + 深字（底要比字亮）`)
    const ratio = contrastRatio(computed[role].ink, computed[role].bg)
    assert(ratio >= 7,
      `${role} 的字与底对比度必须 ≥ 7:1，现在只有 ${Number.isFinite(ratio) ? ratio.toFixed(2) : ratio}:1`)
  }
  const bar = (value) => Number((/(\d+(?:\.\d+)?)px/.exec(String(value || '')) || [])[1])
  assert(/inset/.test(String(error.barDeclared || '')) && bar(error.barDeclared) >= 2 && bar(error.barDeclared) <= 3,
    `错误行左侧要有一道 2-3px 色条（用 inset box-shadow 画），现在是 ${error.barDeclared}`)
  assert(/inset/.test(String(warning.barDeclared || '')) && bar(warning.barDeclared) >= 2 && bar(warning.barDeclared) <= 3,
    `警告行左侧要有一道 2-3px 色条（用 inset box-shadow 画），现在是 ${warning.barDeclared}`)

  // 说明行 / 空报告行**不许**被卷进任何着色规则（用户口径：它们保持中性）。
  const noteRule = /\[data-taskhive-codesys-workbench="true"\] \.taskhive-codesys-compile-note\{([^}]*)\}/.exec(skin)
  assert(noteRule, '口径说明行必须有样式规则 .taskhive-codesys-compile-note{...}')
  assert(colourOf(resolve((/color:([^;]+)/.exec(noteRule[1]) || [])[1])) === info.ink,
    '口径说明行的字色必须与 Info 行一致（都是中性墨色）')
  assert(!/background|box-shadow/.test(noteRule[1]),
    '口径说明行不许有底色/色条 —— 差异与上限说明保持中性，不许被看成错误')
  assert(!/compile-note/.test(classes.map((role) => rulesFor(role).map((rule) => rule.body).join('')).join('')),
    '着色规则里不许出现 compile-note（说明行不属于任何着色类）')
  assert(!skin.includes('.taskhive-codesys-compile-note.is-error')
    && !skin.includes('.taskhive-codesys-compile-note.is-warning'),
    '说明行不许有任何 "标红/标黄" 的选择器')

  // 禁用项：整行可读性不许被 !important 强盖。
  for (const role of ['is-error', 'is-warning']) {
    for (const rule of rulesFor(role)) {
      assert(!rule.body.includes('!important'),
        `.compile-line.${role} 的着色规则不许用 !important（会盖掉整行可读性，也让令牌失去意义）`)
    }
  }

  // 字号 / 行高 / 内边距 / 边框：着色只加底与色条，这三样一个都不许出现在着色规则里。
  // （容器 .taskhive-codesys-compile-body 的 font:11px/1.5 与 padding 是**原有的**，一行未动。）
  for (const role of ['is-error', 'is-warning']) {
    for (const rule of rulesFor(role)) {
      const declarations = rule.body.split(';').map((entry) => entry.trim().toLowerCase())
      // border-radius 不在禁用清单里：它不参与布局，圆角不会动行高；会影响盒子尺寸的
      // border / border-width / border-left 这些才禁。
      const banned = declarations.filter((entry) => /^(font|font-size|font-family|font-weight|line-height|padding|padding-[a-z]+|margin|margin-[a-z]+|border|border-width|border-(?:top|right|bottom|left)(?:-width)?|height|min-height|max-height|display|float)\s*:/.test(entry))
      assert(banned.length === 0,
        `.compile-line.${role} 的着色规则不许改字号/行高/内边距/边框（发现 ${banned.join(' , ')}）`)
    }
  }
  assert(!/height|line-height/.test(rulesFor('is-error')[0].body),
    '着色规则里不许出现 height / line-height（行高不许因着色而变化）')

  return {
    error: `rgb(${error.ink}) on rgb(${error.bg}) bar ${error.barDeclared} contrast ${contrastRatio(error.ink, error.bg).toFixed(2)}:1`,
    warning: `rgb(${warning.ink}) on rgb(${warning.bg}) bar ${warning.barDeclared} contrast ${contrastRatio(warning.ink, warning.bg).toFixed(2)}:1`,
    info: `rgb(${info.ink}) on ${info.bgDeclared}`,
    note: `rgb(${colourOf(resolve((/color:([^;]+)/.exec(noteRule[1]) || [])[1]))})`,
  }
}

async function main () {
  const payload = await caseRealRunDetailComplete()
  const flat = await caseFlatDetailAlwaysVisible(payload)
  const clean = await caseCleanWhenComplete()
  const large = await caseLargeListHonest()
  const original = await caseOriginalEightDetails()
  const shape = caseSourceShape()

  console.log('[自测①] 真机 34 行（GBK 原始 stderr）⇒ 明细 29 条 Warning（改前去重只剩 8 条）· 汇总仍 28 · 编译器口径 7 组相加 28')
  console.log(`[自测①] 展示端 DOM：折叠标记 ${FOLD_MARKERS.length} 个一个都不存在，明细区里 0 个按钮（没有「展开查看全部」）`)
  console.log(`[自测②] 全量平铺 → ${flat.title}；34 行逐条在（29 Warning + 5 Info，含「开始构建应用程序」「代码典型化...」）；`
    + `C195(INT→WORD) 逐条 ${flat.c195Lines} 行；13 个唯一文本 / 34 行 ⇒ 重复没被合并；顺序与引擎 messages 逐字一致`)
  console.log(`[自测②] 明细上方的差异说明 → ${JSON.stringify(flat.notes)}（直接可见，不用点任何按钮）`)
  console.log(`[自测③] 明细齐了（28/28）⇒ ${clean.title}（没有"已显示"）；29 行平铺；差异说明 0 行`)
  console.log(`[自测④] 大列表实测（始终全部渲染）：601 行上屏 ${large.compileMs.toFixed(2)} ms；`
    + `1400 条样本（客户端 1000 条上限）上屏 ${large.hugeMs.toFixed(2)} ms / 实际渲染 ${large.hugeLines} 行`)
  console.log(`[自测⑤] 上限说明直接可见 → ${JSON.stringify(large.hugeNotes)}（不许把 1000 冒充"全部"）`)
  console.log(`[自测⑤] 源码形状：去重已删、折叠机制整条不存在（无 state / 无按钮 / 无分组 / 无 ×N）、说明画在列表上方、无定时器、无徽章（窗口 ${shape.window} 字符）`)
  console.log(`[自测⑥] 现场原文形态（8 条正文 / 汇总 28）⇒ ${original.title}；13 行平铺里看得到那 ${original.shown} 条警告；没有折叠按钮`)
  console.log(`[自测⑥] 明细上方的差异说明 → ${JSON.stringify(original.notes)}（直接可见）`)
  console.log(`[自测⑦] MUTATING 0：平铺渲染 / 重新编译 / 超上限那组都不产生任何写动作`)
  console.log(`[自测⑧] 严重级别着色（只动样式，数据/逻辑一字未动）：错误行 ${shape.colors.error}；`
    + `警告行 ${shape.colors.warning}；Info 行 ${shape.colors.info}（中性、无底色、无色条）；`
    + `说明行 ${shape.colors.note} 与 Info 同行色、不属于任何着色类；三条规则互不覆盖、无 !important、`
    + `未改字号/行高/内边距（选中复制的 textContent 逐字不变）`)

  process.stdout.write(
    'codesys compile detail completeness contract passed ' +
    '(real 28-warning stderr keeps all 29 warnings not 8; summary stays 28; ' +
    'detail is ALWAYS fully flattened one message per line in source order, duplicates kept line by line, ' +
    '[Info] lines included, no fold button / no grouping / no expand-all marker anywhere, ' +
    'count notes directly visible above the list, >1000 messages disclosed instead of faked; ' +
    'no timers, MUTATING 0)\n',
  )
}

main().catch((error) => {
  console.error(`codesys compile detail completeness contract failed: ${error.stack || error.message}`)
  process.exitCode = 1
})
