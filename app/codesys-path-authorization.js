'use strict';

const path = require('path');

function buildCodesysPathAuthorization({ sourceProjectPath = '', jobRoot = '', scriptEngineJobRoot = '' } = {}) {
  const source = sourceProjectPath ? path.resolve(String(sourceProjectPath)) : '';
  const paths = [...new Set([
    source,
    source ? path.dirname(source) : '',
    jobRoot ? path.resolve(String(jobRoot)) : '',
    scriptEngineJobRoot ? path.resolve(String(scriptEngineJobRoot)) : '',
  ].filter(Boolean))];
  return {
    // Harness itself runs every session with danger-full-access. Keep the
    // project/job paths as audit hints, but do not turn them into a second
    // filesystem allow-list that would reintroduce the workspace restriction.
    mode: 'danger-full-access',
    scope: '全部本地文件系统路径均可访问；CODESYS 在线 PLC 动作仍由工具层禁止',
    paths: ['*', ...paths],
    sessionPermissionPreset: 'danger-full-access',
    onlinePlcActions: 'prohibited',
  };
}

module.exports = { buildCodesysPathAuthorization };
