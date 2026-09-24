'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CodesysScriptEngine } = require('../plugins/installed/codesys-monitor/scriptengine.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskhive-codesys-active-'));
  const sourcePath = path.join(root, 'active.project');
  fs.writeFileSync(sourcePath, 'fixture');
  const engine = new CodesysScriptEngine(root, { runProcess: async () => { throw new Error('runProcess must not be reached'); } });
  const activeProject = { activeGui: true, windowId: '0x123', pid: 42, title: 'active.project [只读] - CODESYS', readOnly: true, detection: 'test', writeAvailable: false, writeBlockReason: '当前 CODESYS 工程以只读方式打开' };
  const bound = engine.bindProject({ sourcePath, activeProject });
  assert.strictEqual(bound.mode, 'active-gui-saved-source');
  assert.strictEqual(bound.writeAvailable, false);
  assert.ok(fs.existsSync(bound.inspectionProjectPath));
  await assert.rejects(() => engine.execute('update-text', { jobId: bound.jobId, objectName: 'PLC_PRG', implementation: 'x := 1;', confirmed: true }), (error) => error.code === 'CODESYS_SCRIPTENGINE_ACTIVE_GUI_WRITE_UNAVAILABLE');
  assert.strictEqual(fs.readFileSync(sourcePath, 'utf8'), 'fixture');
  fs.rmSync(root, { recursive: true, force: true });
  process.stdout.write('codesys active project contract tests passed\n');
})().catch((error) => { console.error(error); process.exit(1); });
