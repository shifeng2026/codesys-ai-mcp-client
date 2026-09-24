#!/usr/bin/env node
// Inspect TaskHive/DSH session logs: route, tool surface, per-turn usage, and the
// exact content blocks each assistant turn produced (so "the model's thinking was
// not shown" can be answered from data instead of from the UI).
//
// Session files are `.jsonl.zstd` and DSH writes them as a chain of independent
// zstd frames, so `zstdDecompressSync` alone stops after the first one. This splits
// on the zstd frame magic and decodes every frame.
//
// Usage:
//   node tools/inspect-session.mjs                 # newest session, summary
//   node tools/inspect-session.mjs --list          # recent sessions
//   node tools/inspect-session.mjs <file>          # a specific session file
//   node tools/inspect-session.mjs --blocks <file> # per-block detail per turn
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SKIPPABLE = Buffer.from([0x50, 0x2a, 0x4d, 0x18]);

function dshHome() {
  const override = process.env.DSH_HOME;
  if (override) return override;
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'TaskHive', 'runtime', 'profiles', 'dsh'),
    path.join(os.homedir(), '.dsh'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function listSessions(limit = 12) {
  const root = path.join(dshHome(), 'sessions');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl.zstd') || entry.name.endsWith('.jsonl')) found.push(full);
    }
  };
  if (!fs.existsSync(root)) return [];
  walk(root);
  return found.map((file) => ({ file, at: fs.statSync(file).mtime })).sort((a, b) => b.at - a.at).slice(0, limit);
}

function decode(file) {
  const buffer = fs.readFileSync(file);
  if (!file.endsWith('.zstd')) return { text: buffer.toString('utf8'), frames: 1 };
  const starts = [];
  for (let index = 0; index + 4 <= buffer.length; index += 1) {
    if (buffer.compare(MAGIC, 0, 4, index, index + 4) === 0 || buffer.compare(SKIPPABLE, 0, 4, index, index + 4) === 0) starts.push(index);
  }
  if (starts.length === 0 || starts[0] !== 0) starts.unshift(0);
  let text = '';
  let ok = 0;
  for (let index = 0; index < starts.length; index += 1) {
    try {
      text += zlib.zstdDecompressSync(buffer.subarray(starts[index], starts[index + 1] ?? buffer.length)).toString('utf8');
      ok += 1;
    } catch { /* not a frame boundary */ }
  }
  return { text, frames: starts.length, ok };
}

function events(file) {
  const { text, frames, ok } = decode(file);
  const list = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { list.push(JSON.parse(line)); } catch { /* partial frame tail */ }
  }
  return { list, frames, ok, chars: text.length };
}

function summarise(file, blocks) {
  const { list, frames, ok, chars } = events(file);
  console.log(`\n=== ${path.basename(path.dirname(file))} (${fs.statSync(file).mtime.toISOString()})`);
  console.log(`frames=${frames} decoded=${ok} events=${list.length} chars=${chars}`);
  let header = null;
  const turns = [];
  let pendingUser = null;
  for (const event of list) {
    if (event.type === 'request/header') header = event.data?.header || event.data;
    if (event.type === 'user/message') {
      const content = event.data?.message?.content || event.data?.content || [];
      pendingUser = content.map((block) => String(block.text || `[${block.type}]`).replace(/\s+/g, ' ').trim()).join(' ').slice(0, 90);
    }
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content || [];
      const kinds = content.map((block) => {
        if (block.type === 'text') return `text(${String(block.text || '').length})`;
        if (block.type === 'reasoning') return `reasoning(${String(block.text || '').length})`;
        if (block.type === 'tool-call') return `tool-call(${block.name})`;
        return block.type;
      });
      turns.push({ seq: event.seq, kinds, usage: event.data?.usage, reasoning: content.filter((block) => block.type === 'reasoning').map((block) => String(block.text || '')).join(''), user: pendingUser });
      pendingUser = null;
    }
  }
  if (header) console.log(`route: ${header.config?.provider}/${header.config?.model}, tools: ${(header.tools || []).length} schemaChars=${JSON.stringify(header.tools || []).length}`);
  console.log(`assistant turns: ${turns.length}`);
  for (const turn of turns) {
    const u = turn.usage || {};
    const total = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0) + (u.outputTokens ?? 0);
    console.log(`  seq=${turn.seq} blocks=[${turn.kinds.join(', ')}] usage=${total ? total : '-'}${u.reasoningTokens ? ` (reasoning ${u.reasoningTokens})` : ''}${turn.user ? ` :: ${turn.user}` : ''}`);
    if (blocks && turn.reasoning) console.log(`      reasoning: ${turn.reasoning.slice(0, 300).replace(/\s+/g, ' ')}${turn.reasoning.length > 300 ? '…' : ''}`);
  }
  return turns;
}

// Print every event, and call out the two places a failed model run records WHY.
function dumpRaw(file) {
  const { list, frames, ok } = events(file);
  console.log(`\n=== ${path.basename(path.dirname(file))} (${fs.statSync(file).mtime.toISOString()})`);
  console.log(`frames=${frames} decoded=${ok} events=${list.length}`);
  const failures = [];
  for (const event of list) {
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const keys = Object.keys(data).join(',');
    console.log(`\n[${event.seq}] ${event.type}  data{${keys}}`);
    console.log(`   ${JSON.stringify(data).slice(0, 700)}`);
    if (event.type === 'turn/end' && data.reason?.kind === 'error') failures.push(`turn/end reason.error: ${data.reason.error?.message} (code=${data.reason.error?.code})`);
    const chunks = Array.isArray(data.stream) ? data.stream : [];
    for (const entry of chunks) {
      const failure = entry?.chunk?.finish?.reason?.failure;
      if (failure) failures.push(`assistant/attempt finish failure: ${failure.message} (code=${failure.code})`);
    }
  }
  if (failures.length > 0) {
    console.log('\n--- WHY THIS RUN FAILED ---');
    for (const line of [...new Set(failures)]) console.log(`  ${line}`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--list')) {
  for (const entry of listSessions()) console.log(`${entry.at.toISOString()}  ${entry.file}`);
  process.exit(0);
}
const blocks = args.includes('--blocks');
const raw = args.includes('--raw');
const target = args.find((arg) => !arg.startsWith('--'));
const chosen = target || listSessions(1)[0]?.file;
if (!chosen) {
  console.error(`no sessions under ${path.join(dshHome(), 'sessions')}`);
  process.exit(2);
}
if (raw) dumpRaw(chosen);
else summarise(chosen, blocks);
