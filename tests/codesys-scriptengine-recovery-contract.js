'use strict'
// Contract: a finished ScriptEngine result must never be thrown away because the
// CODESYS host process misbehaved.
//
// Field failure this pins down (2026-09-15, real project, 62 objects): the
// script wrote a COMPLETE result.json, the CODESYS --noUI host did not exit, the
// process cap killed it, and `invokeOfflineScript` decided
// `actionOk = Boolean(payload?.ok) && !processError` — so the user waited two
// minutes and got "Command failed" with an empty project tree.
//
// The real engine is exercised with an injected process runner: no CODESYS
// installation is needed, and both the recovery path and the still-failing path
// are asserted.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-engine-recovery-'))
const jobDir = path.join(root, 'workspaces', 'codesys-scriptengine', 'jobs', 'direct-fixture')
fs.mkdirSync(jobDir, { recursive: true })

// The runner stands in for `CODESYS.exe --noUI --runscript=...`: it writes
// whatever the script would have written and then reports the process failure.
function makeRunner({ payload }) {
  return async function runProcess(_exePath, args) {
    const scriptArg = args.find((arg) => arg.startsWith('--runscript=')) || ''
    const scriptPath = scriptArg.slice('--runscript='.length).replace(/^"|"$/g, '')
    const script = fs.readFileSync(scriptPath, 'utf8')
    const match = script.match(/result_path = ("(?:[^"\\]|\\.)*")/)
    assert(match, 'the emitted script must declare its result path')
    const resultPath = JSON.parse(match[1])
    if (payload) fs.writeFileSync(resultPath, JSON.stringify(payload), 'utf8')
    const error = new Error('Command failed: CODESYS.exe --profile="CODESYS V3.5 SP20 Patch 4" --noUI --runscript="..."')
    error.killed = true
    error.signal = 'SIGTERM'
    error.code = null
    throw error
  }
}

function makeEngine(runProcess) {
  const engine = new CodesysScriptEngine(root, { runProcess })
  // The installation probe is not what this contract is about.
  engine.doctor = () => ({ ready: true, exePath: 'C:\\fake\\CODESYS.exe', profile: 'CODESYS V3.5 SP20 Patch 4' })
  return engine
}

async function main() {
  // 1. A complete inspect payload survives the host process being killed.
  const completePayload = {
    ok: true,
    action: 'inspect-project',
    complete: true,
    textTruncated: false,
    objectCount: 2,
    hierarchy: { roots: 1, grouped: 2, ungrouped: 0, reparented: 1, internal: 0 },
    timings: { walkMs: 1200, coverageMs: 40, totalMs: 1240, objects: 2 },
    objects: [
      { name: 'Device', guid: 'g-dev', type: '225bfe47-7336-4dbc-9419-4105a7c831fa', depth: 0, parentGuid: '', parentName: '', path: ['Device'], hasChildren: true },
      { name: 'PLC_PRG', guid: 'g-pou', type: '6f9dac99-8de1-4efc-8465-68ac443b7d08', depth: 1, parentGuid: 'g-dev', parentName: 'Device', path: ['Device', 'PLC_PRG'], hasChildren: false, declaration: 'PROGRAM PLC_PRG', implementation: '' },
    ],
  }
  const recovered = await makeEngine(makeRunner({ payload: completePayload }))
    .invokeOfflineScript('inspect-project', jobDir, { action: 'inspect-project', projectPath: 'C:\\fake\\x.project' })
  assert.strictEqual(recovered.ok, true, 'a complete payload must be reported as success')
  assert.strictEqual(recovered.status, 'verified-with-process-warning', 'the recovered read must be distinguishable')
  assert.strictEqual(recovered.payload.objectCount, 2, 'the finished result must be handed back intact')
  assert.strictEqual(recovered.warnings.length, 1)
  assert.strictEqual(recovered.warnings[0].code, 'CODESYS_PROCESS_ERROR_AFTER_RESULT')
  assert.ok(recovered.processError.killed === true, 'the process failure must still be recorded in the evidence')

  // 2. An incomplete payload must still fail: recovery is not "ignore errors".
  const incomplete = await makeEngine(makeRunner({
    payload: { ok: true, action: 'inspect-project', complete: false, textTruncated: true, objects: [] },
  }))
    .invokeOfflineScript('inspect-project', jobDir, { action: 'inspect-project', projectPath: 'C:\\fake\\x.project' })
    .then(() => null, (error) => error)
  assert(incomplete, 'an incomplete payload with a failed process must still throw')
  assert.strictEqual(incomplete.code, 'CODESYS_SCRIPTENGINE_OFFLINE_ACTION_FAILED')

  // 3. No payload at all (process died before writing) must still fail.
  const nothing = await makeEngine(makeRunner({ payload: null }))
    .invokeOfflineScript('inspect-project', jobDir, { action: 'inspect-project', projectPath: 'C:\\fake\\x.project' })
    .then(() => null, (error) => error)
  assert(nothing, 'a failed process without a result must throw')

  // 4. A clean run keeps the plain success status.
  const clean = await makeEngine(async (_exePath, args) => {
    const scriptArg = args.find((arg) => arg.startsWith('--runscript=')) || ''
    const scriptPath = scriptArg.slice('--runscript='.length).replace(/^"|"$/g, '')
    const match = fs.readFileSync(scriptPath, 'utf8').match(/result_path = ("(?:[^"\\]|\\.)*")/)
    fs.writeFileSync(JSON.parse(match[1]), JSON.stringify(completePayload), 'utf8')
    return { stdout: '', stderr: '' }
  }).invokeOfflineScript('inspect-project', jobDir, { action: 'inspect-project', projectPath: 'C:\\fake\\x.project' })
  assert.strictEqual(clean.ok, true)
  assert.strictEqual(clean.status, 'verified')
  assert.deepStrictEqual(clean.warnings, [])

  // 5. CODESYS 的控制台输出是 **Windows ANSI 代码页（GBK/CP936）**，不是 UTF-8。按 UTF-8 解
  //    会把每条中文编译消息变成一片 U+FFFD —— 工作台编译输出面板里报出来的乱码就是这个：
  //      [Info] ����: Text: C0: ------ ��ʼ����Ӧ�ó��� Device_1.Application -------
  //    下面这串字节取自真实中文行（GBK 编码），断言 stderr 归并之后必须还是真中文。
  const gbkStderr = Buffer.from('b1e0d2eb3a20546578743a2043303a20bfaacabcb1e0d2ebd3a6d3c3b3ccd0f2204465766963655f312e4170706c69636174696f6e', 'hex')
  const gbkCase = await makeEngine(async (_exePath, args) => {
    const scriptArg = args.find((arg) => arg.startsWith('--runscript=')) || ''
    const scriptPath = scriptArg.slice('--runscript='.length).replace(/^"|"$/g, '')
    const match = fs.readFileSync(scriptPath, 'utf8').match(/result_path = ("(?:[^"\\]|\\.)*")/)
    // A build with no engine-side messages: everything comes from the console.
    fs.writeFileSync(JSON.parse(match[1]), JSON.stringify({ ok: true, action: 'build', errorCount: 0, messages: [] }), 'utf8')
    // Raw bytes, exactly like execFile with encoding:'buffer'.
    return { stdout: Buffer.from(''), stderr: gbkStderr }
  }).invokeOfflineScript('build', jobDir, { action: 'build', projectPath: 'C:\\fake\\x.project' })
  const consoleTexts = (gbkCase.payload.messages || []).map((item) => String(item.text || ''))
  assert(
    consoleTexts.some((text) => text.includes('编译') && text.includes('开始编译应用程序')),
    'GBK console output must be decoded to real Chinese (the compile panel showed U+FFFD mojibake)',
  );
  assert(
    !consoleTexts.some((text) => /\uFFFD/.test(text)),
    'no replacement characters may survive the stderr merge',
  );

  fs.rmSync(root, { recursive: true, force: true })
  process.stdout.write('codesys scriptengine recovery contract passed\n')
}

main().catch((error) => {
  console.error(`codesys scriptengine recovery contract failed: ${error.message}`)
  process.exitCode = 1
})
