'use strict';

const assert = require('assert');
const path = require('path');
const { buildCodesysPathAuthorization } = require('../app/codesys-path-authorization');

const project = 'C:\\Users\\29925\\Documents\\RealProjects\\Machine.project';
const authorization = buildCodesysPathAuthorization({
  sourceProjectPath: project,
  jobRoot: 'C:\\Users\\29925\\Documents\\TaskHive1.0.2\\resources\\app\\workspaces\\codesys-scriptengine\\jobs\\direct-1\\harness-requests\\codesys-code-1',
  scriptEngineJobRoot: 'C:\\Users\\29925\\Documents\\TaskHive1.0.2\\resources\\app\\workspaces\\codesys-scriptengine\\jobs\\direct-1',
});
assert.strictEqual(authorization.mode, 'danger-full-access');
assert.strictEqual(authorization.sessionPermissionPreset, 'danger-full-access');
assert.strictEqual(authorization.onlinePlcActions, 'prohibited');
assert(authorization.paths.includes('*'));
assert(authorization.paths.includes(path.resolve(project)));
assert(authorization.paths.includes(path.dirname(path.resolve(project))));
assert(authorization.paths.some((item) => /harness-requests/.test(item)));
assert.deepStrictEqual(buildCodesysPathAuthorization({}).paths, ['*']);
console.log(JSON.stringify({ ok: true, authorization }));
