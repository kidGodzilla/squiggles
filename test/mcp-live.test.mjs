// End to end: a real server in a temp room with a stub `claude` that records its launch. A squiggle with no mcp
// field launches strict with connectors off; one with `mcp: notes-db` gets only that server allowed.
// HOME is the temp room: nothing here touches the live room.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const room = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-live-')));
const SRC = process.env.SRC || REPO;
const HOME = path.join(room, 'home'), DATA = path.join(room, 'data'), BIN = path.join(room, 'stub');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const launch = (id) => { try { return JSON.parse(fs.readFileSync(path.join(HOME, `launch-${id}.json`), 'utf8')); } catch { return null; } };
async function until(fn, what, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error(`timed out: ${typeof what === 'function' ? what() : what}`);
}
const port = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); }); });

const stub = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const id = process.env.AGENTS_ID, sid = 'stub-' + id;
fs.writeFileSync(path.join(process.env.HOME, 'launch-' + id + '.json'), JSON.stringify({ args: process.argv.slice(2), connectors: process.env.ENABLE_CLAUDEAI_MCP_SERVERS ?? null }));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d; const lines = buf.split('\\n'); buf = lines.pop();
  for (const l of lines) {
    out({ type: 'system', subtype: 'init', session_id: sid });
    out({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'IDLE: nothing new' }], usage: { input_tokens: 5 } } });
    out({ type: 'result', subtype: 'success', result: 'IDLE: nothing new', session_id: sid, usage: {}, total_cost_usd: 0 });
  }
});
process.stdin.on('end', () => process.exit(0));
`;

let server, base, log = '';
const api = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const up = () => fetch(`${base}/api/humans`).then((r) => r.ok).catch(() => false);
const settingsOf = (l) => JSON.parse(l.args[l.args.indexOf('--settings') + 1]);

before(async () => {
  fs.mkdirSync(HOME); fs.mkdirSync(BIN); fs.mkdirSync(path.join(DATA, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ claudeAiMcpEverConnected: ['claude.ai Gmail'], mcpServers: { 'notes-db': {}, 'other-tool': {} } }));
  for (const [id, extra] of [['boss', { lead: true }], ['plain', {}], ['notes', { mcp: 'notes-db' }], ['mail', { mcp: 'Gmail' }]]) {
    const d = path.join(DATA, 'squiggles', id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'squiggle' + '.json'), JSON.stringify({ name: id, role: 'Test', cwd: '~', every: 0, paused: true, permissionMode: 'auto', ...extra }));
    fs.writeFileSync(path.join(d, 'charter.md'), 'Test fixture.\n'); fs.writeFileSync(path.join(d, 'journal.md'), '');
  }
  fs.writeFileSync(path.join(BIN, 'claude'), stub, { mode: 0o755 });
  // The harness may itself run with connectors off; the server must start without it to see what launch adds.
  const env = { ...process.env }; delete env.ENABLE_CLAUDEAI_MCP_SERVERS;
  const p = await port(); base = `http://127.0.0.1:${p}`;
  server = spawn(process.execPath, ['server.mjs'], { cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, HOME, SQUIGGLES_HOME: DATA, PORT: String(p), PATH: `${BIN}:${process.env.PATH}` } });
  server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  await until(up, () => `server up: ${log.slice(-400)}`);
  for (const id of ['plain', 'notes', 'mail']) await api(`/api/squiggles/${id}/send`, { text: 'hi', from: 'harness' });
  await until(() => ['plain', 'notes', 'mail'].every(launch), () => `all launched: ${log.slice(-400)}`);
});
after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((r) => { server.on('exit', r); setTimeout(r, 3000); }); }
  await sleep(500);
  fs.rmSync(room, { recursive: true, force: true });
});

test('no mcp field: strict config, connectors off, nothing allowed', () => {
  const l = launch('plain');
  assert.ok(l.args.includes('--strict-mcp-config'), l.args.join(' '));
  assert.equal(l.connectors, 'false');
  assert.deepEqual(settingsOf(l).allowedMcpServers, []);
  assert.ok(settingsOf(l).hooks, 'fence hook kept');
});

test('a local server listed: only it is allowed, connectors off', () => {
  const l = launch('notes');
  assert.ok(!l.args.includes('--strict-mcp-config'));
  assert.equal(l.connectors, 'false');
  assert.deepEqual(settingsOf(l).allowedMcpServers, [{ serverName: 'notes-db' }]);
});

test('a connector listed: local servers lose their tools', () => {
  const l = launch('mail');
  assert.equal(l.connectors, null);
  assert.deepEqual(settingsOf(l).deniedMcpServers, []);
  for (const t of ['mcp__notes-db', 'mcp__other-tool']) assert.ok(l.args.includes(t), t);
});

test('a bad mcp value is refused', async () => {
  assert.equal((await api('/api/squiggles/plain/update', { mcp: 'a;b' })).status, 400);
});
