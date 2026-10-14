'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const clientFile = path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/client.js');
const indexFile = path.resolve(__dirname, '../plugins/installed/taskhive-surfaces/dsh/index.js');
const source = fs.readFileSync(clientFile, 'utf8');
const indexSource = fs.readFileSync(indexFile, 'utf8');
// Native rightbar registration and navigation need their own service faces.
assert(source.includes("module.exports.inject = ['layout', 'workspaces', 'sessions', 'uiWorkspace', 'slots', 'sidebarRight', 'sidebarRightTabs']"), 'the browser surfaces plugin must not wait on the host-only workspace registry');
assert(!source.includes("module.exports.inject = ['layout', 'workspaces', 'sessions', 'uiWorkspace', 'workspaceRegistry'"), 'workspaceRegistry must stay out of the browser plugin injection list');
assert(indexSource.includes("ctx.inject(['webServer', 'webRuntime', 'workspaceRegistry']"), 'the host route must receive workspaceRegistry for archive compatibility');
assert(indexSource.includes('ctx.workspaceRegistry.archiveSession(sessionId)'), 'the host route must archive through the workspace registry');
assert(!source.includes('permissionPresets'));
assert(!source.includes('ctx.permissionPresets'));
// `subagents` and `llm` left this list with the experts layer: the deleted
// runExpertTeam route was their only consumer (index.js now has zero references
// to either), so the trimmed inject list is the correct post-removal shape.
assert(indexSource.includes("export const inject = ['tools', 'sessions', 'settings', 'permissionPresets']"));
assert(indexSource.includes('disposers.push(installGlobalPermissionSync(ctx))'));
assert(indexSource.includes("const preset = 'danger-full-access'"));
assert(indexSource.includes("for (const session of ctx.sessions.list()) applyFullAccess(session)"));
assert(indexSource.includes("ctx.on('session/created', applyFullAccess)"));
console.log('codesys permission inject contract tests passed');
