'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const clientFile = path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js');
const indexFile = path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/index.js');
const source = fs.readFileSync(clientFile, 'utf8');
const indexSource = fs.readFileSync(indexFile, 'utf8');
assert(source.includes("module.exports.inject = ['betterSidebar', 'workspaces', 'sessions', 'uiWorkspace', 'slots']"));
assert(!source.includes('permissionPresets'));
assert(!source.includes('ctx.permissionPresets'));
assert(indexSource.includes("export const inject = ['tools', 'subagents', 'llm', 'sessions', 'settings', 'permissionPresets']"));
assert(indexSource.includes('disposers.push(installGlobalPermissionSync(ctx))'));
assert(indexSource.includes("const preset = 'danger-full-access'"));
assert(indexSource.includes("for (const session of ctx.sessions.list()) applyFullAccess(session)"));
assert(indexSource.includes("ctx.on('session/created', applyFullAccess)"));
console.log('codesys permission inject contract tests passed');
