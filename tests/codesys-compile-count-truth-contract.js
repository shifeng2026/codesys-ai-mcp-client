'use strict'

// 编译计数口径（本轮）：面板标题里的 错误/警告 数必须与**编译器自己的总结行**一致，
// 而不是"我们往正文里显示了几个条目"。
//
// 现场报障原文（用户的真实编译输出）：
//   ▾ 编译输出 · 错误 0 · 警告 7 · 信息 5          ← 当时界面报的（数的是正文条目数）
//   [Warning] 编译: Warning: C…                   ← 正文只列了 7 条警告
//   [Info] 编译: Text: C0: 编译完成 -- 0错误,28警告  ← 编译器自己总结：**28** 条警告
// 头部报 7、编译器总结报 28 —— 28 和 7 不是"矛盾"，而是"总数"与"编译器实际打出来的前 N 条"。
// 旧实现（`warningCount: messages.filter(...).length`）把后者当成总数，于是**少报**。
//
// 这个文件同时钉住两端，因为少报可以由任一端单独造成：
//   生产端 = `plugins/installed/codesys-monitor/scriptengine.cjs`（解析总结行 + 过桥字段）
//   展示端 = 真正的 `CodesysWorkbench` 组件（面板标题 / 状态行 / 复制文本）
// 展示端走 `tests/lib/workbench-driver.js`（加载**真的** client bundle 并渲染真组件），
// 所以断言的是"用户看到的那行字"，不是源码里有没有某个字符串。
//
// 口径（唯一一处定义在 `compileCountLabel`）：
//   · 以总结行为准；
//   · **头部只报两个数**：`错误 N · 警告 M` —— 不带「（已显示 N 条）」这类括注，也不再有「信息 N」
//     这一档（T226；用户口径："把这个显示去除…我只看编译结果"）；
//   · 汇总与明细的差异一律只在**抽屉**里用一行说明（`compileCountNotes` → `data-codesys-compile-note`）；
//   · 只有正文、没有总结行 ⇒ 计数＝正文条目数，并注明"按已显示条目计"（这句话同样只在抽屉里）；
//   · 总结行说 0 而正文有 Warning/Error ⇒ 头部报正文那个大数，**绝不**单独报 0（T200）；
//   · 都解析不出 ⇒ **未知**（不是 0）。
// T225 补一条方向（自测⑨）：正文**多于**汇总时，多出来的可能根本不在汇总的口径里（真机样本的
// 1 行设备层 `Devices: Warning:`）。警告维度下前导数仍取**编译器汇总**（口径不放宽），多出来的
// 条数如实写在抽屉那一行里；错误维度**不**走这条 —— 正文多于汇总在那里是 T200 的"硬证据"方向。

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createWorkbenchDriver, clientFile } = require('./lib/workbench-driver')
const { buildCompileResult, applyCompileResultToPayload } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const SOURCE_PATH = 'C:/projects/demo.project'
const JOB_ID = 'direct-compile-count'

// ── 用户的真实样本（原文照抄；7 条警告正文 + 5 条信息，最后一行是编译器的总结行）──────────
const USER_WARNING_LINES = [
  '编译: Warning: C0180: 变量 "x" 被声明但从未使用',
  '编译: Warning: C0180: 变量 "y" 被声明但从未使用',
  '编译: Warning: C0199: 变量 "i" 被赋值但从未读取',
  '编译: Warning: C0199: 变量 "j" 被赋值但从未读取',
  '编译: Warning: C0058: 隐式类型转换 INT → REAL',
  '编译: Warning: C0058: 隐式类型转换 INT → LREAL',
  '编译: Warning: C0121: 局部常量建议改为 CONSTANT',
]
const USER_INFO_LINES = [
  '编译: Text: C0: ------ 开始构建应用程序 Device_1.Application -------',
  '编译: Text: C0: 代码典型化...',
  '附加代码检查: Text: SA0: 其他代码检查...',
  '附加代码检查: Text: SA0: 其他代码检查完成-0 个错误',
]
const USER_SUMMARY_LINE = '编译: Text: C0: 编译完成 -- 0错误,28警告'

function msg (severity, text) { return { severity, source: 'codesys-stdout', text } }

function userSampleMessages () {
  return [
    ...USER_INFO_LINES.map((text) => msg('Info', text)),
    ...USER_WARNING_LINES.map((text) => msg('Warning', text)),
    msg('Info', USER_SUMMARY_LINE),
  ]
}

// 引擎那一半：`buildCompileResult` 解析 → `applyCompileResultToPayload` 过桥。
// 两个函数都是**引擎自己**用的那对（`invokeOfflineScript` 就是这么调的），
// 所以这里不存在"测试自己拼一份 payload"的漂移空间。
function payloadFor (messages) {
  const compile = buildCompileResult({
    action: 'build',
    durationMs: 88000,
    projectPath: SOURCE_PATH,
    stdout: '',
    stderr: '',
    messages,
    processError: null,
  })
  // 引擎是先把 messages 挂上 payload、再过桥计数（顺序不影响结果，保持同序更贴近）。
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

function elementText (element) {
  const parts = Array.isArray(element.children) ? element.children : [element.children]
  return parts.filter((item) => typeof item === 'string').join('')
}

function titleOf (driver) {
  const toggle = driver.find((props) => props['data-codesys-compile-toggle'] === 'true')
  assert(toggle, 'the compile output panel must be rendered once a compile happened')
  return elementText(toggle)
}

function statusOf (driver) {
  const value = driver.statusText()
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string').join('') : String(value)
}

async function renderCompile (payload) {
  const driver = createWorkbenchDriver({
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
  await driver.settle()
  const control = driver.find((props) => props['data-codesys-compile'] === 'true')
  assert(control, 'the workbench must render the standalone compile control')
  assert.strictEqual(control.props.disabled, false, 'the compile control must be enabled once a project is bound')
  control.props.onClick({})
  await driver.settle()
  const title = titleOf(driver)
  const status = statusOf(driver)
  // 抽屉里那几行口径说明（头部一个字都不带它们）。
  const notes = driver.findAll((props) => props['data-codesys-compile-note'] === 'true').map(elementText)
  driver.unmount()
  return { title, status, notes }
}

// ── 自测①：用户的真实样本 ⇒ 28（已显示 7 条），不再出现"警告 7" ────────────────────────
async function caseUserSample () {
  const messages = userSampleMessages()
  const payload = payloadFor(messages)

  // 生产端：总结行解析出来了，而且**分开**保留了"总结 28"与"正文 7 条"。
  assert(payload.compileSummary.includes('28警告'),
    `生产端必须认出编译器的总结行（得到 ${JSON.stringify(payload.compileSummary)}）`)
  assert.strictEqual(payload.summaryWarningCount, 28, '总结行说 28 条警告')
  assert.strictEqual(payload.detailWarningCount, 7, '正文里只有 7 条 Warning（编译器只显示了前 7 条）')
  assert.strictEqual(payload.warningCount, 28, '对外计数以总结行为准（不是正文条数）')
  assert.strictEqual(payload.warningCountSource, 'codesys-summary', '警告数的来源必须是总结行')
  assert.strictEqual(payload.countsDiffer, true, '总结行与正文条目数不一致必须是显式事实')
  assert.strictEqual(payload.errorCount, 0, '总结行说 0 错误')
  assert.strictEqual(payload.summaryErrorCount, 0, '总结行的错误数也一并回传')
  assert.strictEqual(payload.detailErrorCount, 0, '正文里没有 Error 级条目')

  const { title, status, notes } = await renderCompile(payload)
  // ① 头部**逐字**只有编译器的两个数：没有「信息 N」，没有「（已显示 N 条）」，也没有 29。
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 28',
    `面板标题必须逐字只报"错误 0 · 警告 28"（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('信息') && !title.includes('已显示') && !title.includes('29'),
    `头部不许出现"信息"、"已显示"、"29"（得到 ${JSON.stringify(title)}）`)
  assert(!/警告\s*7(?!\d)/.test(title),
    `标题不得再单独把正文条数当成总数（得到 ${JSON.stringify(title)}）`)
  // ② 状态行同一口径：只有错误与警告，同样没有信息档与括注。
  assert(status.includes('错误 0 · 警告 28'),
    `状态行必须与标题同一口径（得到 ${JSON.stringify(status)}）`)
  assert(!status.includes('信息') && !status.includes('已显示'),
    `状态行不许出现信息计数与括注（得到 ${JSON.stringify(status)}）`)
  // ③ "汇总 28 / 明细只有 7 条"这件事只留在抽屉里。
  assert(notes.some((note) => note.includes('编译器汇总 28 条') && note.includes('7')),
    `抽屉里必须有一行说明汇总 28 与明细 7 的差异（得到 ${JSON.stringify(notes)}）`)
  return { title, status, notes }
}

// ── 自测②：只有正文、没有总结行 ⇒ 计数＝正文条目数 + "按已显示条目计" ──────────────────
async function caseBodyOnly () {
  const messages = USER_WARNING_LINES.map((text) => msg('Warning', text))
  const payload = payloadFor(messages)
  assert.strictEqual(payload.compileSummary, '', '这一组里没有可解析的总结行')
  assert.strictEqual(payload.summaryWarningCount, null, '没有总结行 ⇒ 汇总数字是 null（不是 0）')
  assert.strictEqual(payload.warningCount, 7, '没有总结行 ⇒ 计数＝正文条目数')
  assert.strictEqual(payload.warningCountSource, 'message-severity', '来源必须是"正文条目"')
  // 错误数没有任何来源 ⇒ 未知，**不是 0**（T200：绝不退化成 0）。
  assert.strictEqual(payload.errorCount, null, '没有总结行也没有错误明细 ⇒ 错误数未知，不是 0')
  assert.strictEqual(payload.buildSucceeded, null, '未知不得被当成"编译通过"')

  const { title, notes } = await renderCompile(payload)
  assert.strictEqual(title, '▾ 编译输出 · 错误 未知 · 警告 7',
    `只有正文、没有总结行时头部就是一个数（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('信息') && !title.includes('已显示') && !title.includes('（'),
    `头部不带任何括注、不带信息档（得到 ${JSON.stringify(title)}）`)
  assert(title.includes('错误 未知'), `没有来源的错误数必须显示"未知"（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('错误 0'), '未知绝不能被显示成 0')
  assert(notes.some((note) => note.includes('未解析出编译器汇总行') && note.includes('按已显示条目计')),
    `"按已显示条目计"必须留在抽屉里（得到 ${JSON.stringify(notes)}）`)
  return { title, notes }
}

// ── 自测③：总结行说 0、正文却有 Warning ⇒ 两个都显示，绝不单独报 0 ─────────────────────
async function caseSummarySaysZero () {
  const messages = [
    msg('Info', '编译: Text: C0: 代码典型化...'),
    msg('Warning', '编译: Warning: C0180: 变量 "x" 被声明但从未使用'),
    msg('Warning', '编译: Warning: C0199: 变量 "i" 被赋值但从未读取'),
    msg('Warning', '编译: Warning: C0058: 隐式类型转换 INT → REAL'),
    msg('Info', '编译: Text: C0: 编译完成 -- 0错误,0警告'),
  ]
  const payload = payloadFor(messages)
  assert.strictEqual(payload.summaryWarningCount, 0, '总结行说 0 条警告')
  assert.strictEqual(payload.detailWarningCount, 3, '正文里却有 3 条 Warning')
  assert.strictEqual(payload.warningCount, 3, '正文是硬证据：绝不把已经显示出来的警告报成 0')
  assert.strictEqual(payload.countsDiffer, true, '"结论 0 / 正文 3"必须被标成不一致')
  // T200 的方向**不能**放宽：只有"正文多于总结"才是硬证据方向（更保守、更失败）。
  // 这个旗标挂在结构化结果上（`payload.compile`），与 `summaryConflict` 同一层。
  assert.strictEqual(payload.compile.warningConflict, true, '正文多于总结行的警告数必须被标出来')
  assert.strictEqual(payload.compile.summaryConflict, false, '错误数这一维没有冲突（0 对 0）')

  const { title, notes } = await renderCompile(payload)
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 3',
    `总结行说 0、正文却有 3 条 ⇒ 头部报正文的 3（得到 ${JSON.stringify(title)}）`)
  assert(!/警告\s*0(?!\d)/.test(title),
    `绝不单独报 0（得到 ${JSON.stringify(title)}）`)
  assert(notes.some((note) => note.includes('编译器汇总只报 0 条') && note.includes('头部取正文的 3')),
    `"汇总行报 0"这件事必须在抽屉那一行里说清（得到 ${JSON.stringify(notes)}）`)
  return { title, notes }
}

// ── 自测④：只有总结行、没有正文明细 ⇒ 采信总结 ────────────────────────────────────────
async function caseSummaryOnly () {
  const messages = [msg('Info', USER_SUMMARY_LINE)]
  const payload = payloadFor(messages)
  assert.strictEqual(payload.summaryWarningCount, 28, '总结行说 28 条警告')
  assert.strictEqual(payload.detailWarningCount, 0, '正文里 0 条明细')
  assert.strictEqual(payload.warningCount, 28, '只有总结行时**采信总结**')

  const { title, notes } = await renderCompile(payload)
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 28',
    `只有总结行时头部就是总结行的 28（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('警告 0'), '采信总结，绝不能因为正文没有明细就报 0')
  assert(notes.some((note) => note.includes('编译器汇总 28 条') && note.includes('本次明细只有 0 条')),
    `"正文没有明细"这件事只在抽屉里说（得到 ${JSON.stringify(notes)}）`)
  return { title, notes }
}

// ── 自测⑤：都没有 / 解析不出 ⇒ 未知（不是 0）────────────────────────────────────────
async function caseUnknown () {
  const payload = payloadFor([])
  assert.strictEqual(payload.compileSummary, '', '没有任何总结行')
  assert.strictEqual(payload.errorCount, null, '错误数未知，不是 0')
  assert.strictEqual(payload.warningCount, null, '警告数未知，不是 0')
  assert.strictEqual(payload.errorCountSource, 'unknown', '来源必须如实标 unknown')
  assert.strictEqual(payload.warningCountSource, 'unknown', '来源必须如实标 unknown')

  const { title, notes } = await renderCompile(payload)
  assert.strictEqual(title, '▾ 编译输出 · 错误 未知 · 警告 未知',
    `两者都解析不出时头部就是两个"未知"（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('错误 0') && !title.includes('警告 0'), '未知绝不能被显示成 0')
  assert(notes.some((note) => note.includes('未解析出编译器汇总行') && note.includes('未知')),
    `"解析不出来"这件事在抽屉里如实说明（得到 ${JSON.stringify(notes)}）`)
  return { title, notes }
}

// ── 自测⑥：`附加代码检查完成-0 个错误` 不得冒充编译总结（T200 修过的坑，别回退）──────────
async function caseSubstageStatIsNotASummary () {
  const { parseCompileSummary } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')
  // （a）只有那一条中途统计行：解析必须是 null（而不是"0 错误 ⇒ 编译通过"）。
  const substageOnly = buildCompileResult({
    action: 'build',
    durationMs: 1000,
    projectPath: SOURCE_PATH,
    stdout: '',
    stderr: '',
    messages: [
      msg('Info', '编译: Text: C0: ------ 开始构建应用程序 Device_1.Application -------'),
      msg('Info', '编译: Text: C0: 代码典型化...'),
      msg('Info', '附加代码检查: Text: SA0: 其他代码检查完成-0 个错误'),
    ],
    processError: null,
  })
  assert.strictEqual(substageOnly.summary, null,
    `"完成-0 个错误"是中途统计行，不能当终端总结行（得到 ${JSON.stringify(substageOnly.summary)}）`)
  assert.strictEqual(substageOnly.errorCount, null, '解析不出总结行 ⇒ 错误数未知，**不是 0**')
  assert.strictEqual(substageOnly.succeeded, null, '绝不能因为中途统计行就报"编译通过"')
  assert.strictEqual(parseCompileSummary('附加代码检查: Text: SA0: 其他代码检查完成-0 个错误'), null,
    'parseCompileSummary 必须拒绝中途统计行')

  // （b）用户的样本里**同时**有那条中途行和真总结行：必须选中真总结行。
  const withBoth = payloadFor(userSampleMessages())
  assert(withBoth.compileSummary.includes(USER_SUMMARY_LINE.split(': ').pop()),
    `必须选中真正的终端总结行（得到 ${JSON.stringify(withBoth.compileSummary)}）`)
  assert.strictEqual(withBoth.summaryWarningCount, 28,
    '选择的总结行是"28警告"那条，不是"完成-0 个错误"')
  assert.strictEqual(withBoth.errorCountSource, 'codesys-summary', '来源是总结行，不是中途统计行')

  const { title } = await renderCompile(withBoth)
  assert.strictEqual(title, '▾ 编译输出 · 错误 0 · 警告 28',
    `面板必须逐字是 28（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('警告 0'), '"完成-0 个错误"不许把警告数压成 0')
  return { title, substageSummary: substageOnly.summary }
}

// ── 自测⑦：其它语言/形态解析不出 ⇒ 如实标"未识别，按正文计"，**不许猜** ──────────────────
async function caseUnrecognisedLanguage () {
  // 这一条**没有真实样本**（现场只报了中文形态）。这里用一条构造的法语总结行，
  // 断言的是行为：认不出 ⇒ 不猜数字，如实说"没解析出来 + 按已显示条目计"。
  const messages = [
    ...USER_WARNING_LINES.map((text) => msg('Warning', text)),
    msg('Info', 'Compilation terminée -- 0 erreur, 28 avertissements'),
  ]
  const payload = payloadFor(messages)
  assert.strictEqual(payload.compileSummary, '', '未识别的语言形态**不**产生一个总结数字（不许猜）')
  assert.strictEqual(payload.summaryWarningCount, null, '未识别 ⇒ 汇总数字是 null，不是猜出来的 28')
  assert.strictEqual(payload.warningCount, 7, '未识别 ⇒ 计数退回正文条目数')

  const { title, notes } = await renderCompile(payload)
  assert.strictEqual(title, '▾ 编译输出 · 错误 未知 · 警告 7',
    `未识别的形态只报正文那一个数（得到 ${JSON.stringify(title)}）`)
  assert(!title.includes('28'), `未识别时绝不许把猜出来的数字当成结论（得到 ${JSON.stringify(title)}）`)
  assert(notes.some((note) => note.includes('未解析出编译器汇总行') && note.includes('按已显示条目计')),
    `未识别这件事在抽屉里如实说，且不猜语言（得到 ${JSON.stringify(notes)}）`)
  return { title, notes, recognised: false }
}

// ── 复制文本也必须同一口径（用户会把它贴给别人看）────────────────────────────────────
async function caseCopyText () {
  const payload = payloadFor(userSampleMessages())
  const { title } = await renderCompile(payload)
  // 复制文本由同一台 driver 渲染时无法直接读剪贴板，所以这里读的是**源码里的同一条路径**：
  // `compileReportText()` 里那行就是 `compileCountText(report)`，与标题共用 `compileCountLabel`。
  const source = require('node:fs').readFileSync(
    path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js'), 'utf8',
  )
  assert(source.includes('const compileCountText = (report) => `错误 ${compileCountLabel(report.errorCount, report, \'error\')}'),
    '复制文本/状态行/标题必须共用同一个计数文案函数（一处定义）')
  assert(source.includes('}, `${compileOpen ? \'▾\' : \'▸\'} 编译输出 · ${compileCountText(compileReport)}`)'),
    '面板标题必须走 compileCountText')
  // T226：这个"唯一一处"里只剩两个数 —— 信息档与括注都不许再出现在头部共用的文案里。
  assert(!/const compileCountText = \(report\) => `[^`]*信息/.test(source),
    '复制文本 / 状态行 / 标题共用的计数文案里不许再有"信息 N"这一档')
  assert(!/const compileCountText = \(report\) => `[^`]*（/.test(source),
    '复制文本 / 状态行 / 标题共用的计数文案里不许再带括注')
  assert(source.includes('const compileCountNotes = (report) =>'),
    '口径说明（汇总 / 明细差异、载入上限）只有一处定义，而且只给抽屉用')
  return { title }
}

// ── 自测⑨（T225）：正文**多于**汇总时，警告维度的前导数仍是编译器的汇总 ──────────────────
// 真机样本：28 行 `编译: Warning:` 与汇总行的 28 **完全吻合**，另有 1 行设备层的
//   Devices: Warning: 缺少'GCAN_IoDrv'的设备描述
// 不在编译器的计数之内 ⇒ 明细 29、汇总 28。这个方向下**总数仍以编译器汇总为准**（口径不放宽），
// 明细条数如实写在括号里，两个数都看得见。错误维度**不**走这条：正文多于汇总在那里是 T200 的
// "硬证据"方向（总结说 0、明细却有错误），必须让大的那个当头，绝不把失败说小。
async function caseDetailExceedsSummary () {
  const warnings = []
  for (let index = 0; index < 30; index += 1) warnings.push(`编译: Warning: C100${index}: 样本告警 ${index}`)
  const warningsPayload = payloadFor([
    ...warnings.map((text) => msg('Warning', text)),
    msg('Info', USER_SUMMARY_LINE),
  ])
  assert.strictEqual(warningsPayload.summaryWarningCount, 28, '汇总行说 28')
  assert.strictEqual(warningsPayload.detailWarningCount, 30, '正文里却有 30 条 Warning（多出的不属于汇总口径）')
  assert.strictEqual(warningsPayload.compile.warningConflict, true, '正文多于汇总这件事必须被标出来（不是静默）')

  const { title: warningsTitle, notes: warningNotes } = await renderCompile(warningsPayload)
  assert.strictEqual(warningsTitle, '▾ 编译输出 · 错误 0 · 警告 28',
    `总数必须是编译器汇总的 28，头部逐字只有这两个数（得到 ${JSON.stringify(warningsTitle)}）`)
  assert(!/警告\s*30/.test(warningsTitle),
    `绝不把明细条数当成总数（不得出现"警告 30"，得到 ${JSON.stringify(warningsTitle)}）`)
  assert(!warningsTitle.includes('已显示') && !warningsTitle.includes('信息'),
    `头部不许出现括注或信息档（得到 ${JSON.stringify(warningsTitle)}）`)
  assert(warningNotes.some((note) => note.includes('明细另有 2 条警告') && note.includes('不计入编译器汇总')),
    `"明细多出来的 2 条不在编译器汇总口径内"必须在抽屉那一行里（得到 ${JSON.stringify(warningNotes)}）`)

  // 错误维度：同样的形状（汇总 2、正文 5）**一字不改**，仍然是"大的当头 + 括注汇总"。
  const errorMessages = []
  for (let index = 0; index < 5; index += 1) errorMessages.push(msg('Error', `编译: Error: C003${index}: 无法转换类型 ${index}`))
  errorMessages.push(msg('Info', '编译: Text: C0: 编译完成 -- 2错误,0警告'))
  const errorPayload = payloadFor(errorMessages)
  assert.strictEqual(errorPayload.summaryErrorCount, 2, '汇总行说 2 个错误')
  assert.strictEqual(errorPayload.detailErrorCount, 5, '正文里却有 5 条错误')
  assert.strictEqual(errorPayload.errorCount, 5, '错误维度仍取"正文是硬证据"的那个大数（T200 方向不放宽）')
  const { title: errorTitle, notes: errorNotes } = await renderCompile(errorPayload)
  assert.strictEqual(errorTitle, '▾ 编译输出 · 错误 5 · 警告 0',
    `错误维度必须保持原样：头部取正文那个大数（得到 ${JSON.stringify(errorTitle)}）`)
  assert(errorNotes.some((note) => note.includes('编译器汇总只报 2 条') && note.includes('头部取正文的 5')),
    `错误维度"正文多于汇总"的理由留在抽屉里（得到 ${JSON.stringify(errorNotes)}）`)

  return { title: warningsTitle, errorTitle, warningNotes, errorNotes }
}

async function main () {
  const user = await caseUserSample()
  const bodyOnly = await caseBodyOnly()
  const zero = await caseSummarySaysZero()
  const summaryOnly = await caseSummaryOnly()
  const unknown = await caseUnknown()
  const substage = await caseSubstageStatIsNotASummary()
  const language = await caseUnrecognisedLanguage()
  const copy = await caseCopyText()
  const exceeds = await caseDetailExceedsSummary()

  console.log(`[自测①] 用户原文（7 条正文 / 编译器总结 28）→ ${user.title}`)
  console.log(`[自测①] 状态行 → ${user.status}`)
  console.log(`[自测①] 抽屉里的口径说明 → ${JSON.stringify(user.notes)}`)
  console.log(`[自测②] 只有正文、无总结行 → ${bodyOnly.title}`)
  console.log(`[自测③] 总结行说 0、正文 3 条 Warning → ${zero.title}`)
  console.log(`[自测④] 只有总结行、无正文明细 → ${summaryOnly.title}`)
  console.log(`[自测⑤] 两者都无 → ${unknown.title}`)
  console.log(`[自测⑥] "完成-0 个错误"当总结行？→ parseCompileSummary=${JSON.stringify(substage.substageSummary)}（必须是 null）`)
  console.log(`[自测⑥] 真总结行胜出 → ${substage.title}`)
  console.log(`[自测⑦] 未识别语言形态（构造样本，无真机样本）→ ${language.title}`)
  console.log(`[自测⑧] 复制文本与标题共用 compileCountText → ${copy.title}`)
  console.log(`[自测⑨] 明细多于汇总（30 条 vs 汇总 28）→ ${exceeds.title} ｜ 错误维度不变 → ${exceeds.errorTitle}`)
  console.log(`[自测⑨] 抽屉里的口径说明 → ${JSON.stringify(exceeds.warningNotes)} ｜ ${JSON.stringify(exceeds.errorNotes)}`)

  // T228 交叉核对（口径与着色的**边界**）：着色只改"每一行的颜色"，不许反过来影响计数与说明。
  // ① 三类着色只挂在 display 层的样式表里，**数据/计数那一半一个字都没动**：错误/警告的
  //    计数文案仍只有 compileCountLabel 一处定义；
  // ② Info 行仍然是"中性字色、无底色"，口径说明行仍是中性 —— 着色没有把"说明"或"信息"
  //    涨成错误（用户口径：说明行保持中性，不许被当成错误标红）；
  // ③ 错误行与警告行用的是**两个不同**的令牌（红 / 黄各一个），不是同一个颜色换个名字。
  const skin = fs.readFileSync(path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/src/60-skin-and-embedded-surfaces.js'), 'utf8')
  const client = fs.readFileSync(clientFile, 'utf8')
  assert(client.includes('const compileCountLabel = (count, report, dimension) => {'),
    '着色是 display 层的事：计数文案仍然只有一处定义（T223/T226 的口径没有被着色绕过）')
  const ruleBody = (role) => {
    // 级联里谁最后写谁赢：同一个选择器有两条规则（旧的单色那条 + 本轮的着色那条），
    // 取**最后**一条才是用户真正看到的颜色。
    const marker = `[data-taskhive-codesys-workbench="true"] .taskhive-codesys-compile-line.${role}{`
    const at = skin.lastIndexOf(marker)
    assert(at > 0, `编译明细的 ${role} 行必须有样式规则`)
    return skin.slice(at + marker.length, skin.indexOf('}', at))
  }
  const errorBody = ruleBody('is-error')
  const warnBody = ruleBody('is-warning')
  const infoBody = ruleBody('is-info')
  const noteBody = (/\[data-taskhive-codesys-workbench="true"\] \.taskhive-codesys-compile-note\{([^}]*)\}/.exec(skin) || [])[1] || ''
  assert(errorBody.includes('var(--th-error-ink)') && errorBody.includes('var(--th-error-bg)'),
    `错误行必须是红系令牌（得到 ${errorBody}）`)
  assert(warnBody.includes('var(--th-warn-ink)') && warnBody.includes('var(--th-warn-bg)'),
    `警告行必须是黄/琥珀系令牌（得到 ${warnBody}）`)
  assert(!errorBody.includes('var(--th-warn-') && !warnBody.includes('var(--th-error-'),
    '错误行与警告行不许互相借用对方的令牌（那就分不出谁是谁了）')
  assert(/color:var\(--th-ink-2\)/.test(infoBody) && !/background|box-shadow/.test(infoBody),
    `Info 行保持中性：只有中性字色、没有底色/色条（得到 ${infoBody}）`)
  assert(/color:var\(--th-ink-2\)/.test(noteBody) && !/background|box-shadow/.test(noteBody),
    `口径说明行保持中性：中性字色、没有底色/色条，不许被看成错误（得到 ${noteBody}）`)

  process.stdout.write(
    'codesys compile count truth contract passed ' +
    '(summary is authoritative: 28 not 7; summary/detail both shown when they differ; ' +
    'warning detail greater than the summary still leads with the compiler summary; ' +
    'error detail greater than the summary is unchanged (T200 direction); ' +
    'body-only labelled "按已显示条目计"; both-absent stays 未知 not 0; ' +
    '"其他代码检查完成-0 个错误" still refused as a summary; unrecognised language reported, not guessed)\n',
  )
}

main().catch((error) => {
  console.error(`codesys compile count truth contract failed: ${error.stack || error.message}`)
  process.exitCode = 1
})
