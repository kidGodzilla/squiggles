// End to end: a real server in a temp room with a stub `claude`. A squiggle whose wake ends IDLE with a big
// context gets `/compact` on its open process; the compaction's result is not a turn; a small context is left alone.
// HOME is the temp room: nothing here touches the live room.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const room = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'compact-')));
const SRC = process.env.SRC || REPO;
const HOME = path.join(room, 'home'), DATA = path.join(room, 'data'), BIN = path.join(room, 'stub');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inbox = (id) => { try { return fs.readFileSync(path.join(HOME, `inbox-${id}.jsonl`), 'utf8'); } catch { return ''; } };
const events = (id) => { try { return fs.readFileSync(path.join(DATA, 'runs', `${id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
async function until(fn, what, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const v = await fn(); if (v) return v; }
  throw new Error(`timed out: ${typeof what === 'function' ? what() : what}`);
}
const port = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => res(p)); }); });

// A turn reports its context on an assistant event, then ends IDLE. `/compact` answers the way the real CLI does.
const stub = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const home = process.env.HOME, id = process.env.AGENTS_ID, sid = 'stub-' + id;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let buf = '', n = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d; const lines = buf.split('\\n'); buf = lines.pop();
  for (const l of lines) {
    fs.appendFileSync(path.join(home, 'inbox-' + id + '.jsonl'), l + '\\n');
    out({ type: 'system', subtype: 'init', session_id: sid });
    if (l.includes('/compact')) { out({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 60000 } }); out({ type: 'result', subtype: 'success', result: '', session_id: sid, usage: {}, total_cost_usd: 0.5 + n }); continue; }
    n++;
    out({ type: 'assistant', message: { id: 'm' + n, content: [{ type: 'text', text: 'IDLE: nothing new' }], usage: { input_tokens: 5, cache_read_input_tokens: id === 'big' ? 60000 : 1000, cache_creation_input_tokens: 0 } } });
    out({ type: 'result', subtype: 'success', result: 'IDLE: nothing new', session_id: sid, usage: {}, total_cost_usd: n });
  }
});
process.stdin.on('end', () => process.exit(0));
`;

let server, base, log = '';
const api = (p, b, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
const wake = (id, text) => api(`/api/squiggles/${id}/send`, { text, from: 'harness' });
const up = () => fetch(`${base}/api/humans`).then((r) => r.ok).catch(() => false);

before(async () => {
  fs.mkdirSync(HOME); fs.mkdirSync(BIN); fs.mkdirSync(path.join(DATA, 'runs'), { recursive: true });
  for (const [id, extra] of [['boss', { lead: true }], ['big', {}], ['small', {}]]) {
    const d = path.join(DATA, 'squiggles', id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'squiggle.json'), JSON.stringify({ name: id, role: 'Test', cwd: '~', every: 0, paused: true, permissionMode: 'auto', ...extra }));
    fs.writeFileSync(path.join(d, 'charter.md'), 'Test fixture.\n'); fs.writeFileSync(path.join(d, 'journal.md'), '');
  }
  fs.writeFileSync(path.join(BIN, 'claude'), stub, { mode: 0o755 });
  const p = await port(); base = `http://127.0.0.1:${p}`;
  server = spawn(process.execPath, ['server.mjs'], { cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME, SQUIGGLES_HOME: DATA, PORT: String(p), PATH: `${BIN}:${process.env.PATH}` } });
  server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  await until(up, () => `server up: ${log.slice(-400)}`);
});
after(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise((r) => { server.on('exit', r); setTimeout(r, 3000); }); }
  await sleep(500);
  fs.rmSync(room, { recursive: true, force: true });
});

test('an IDLE end with a big context compacts on the open process, and the compaction is not a turn', async () => {
  await wake('big', 'wake one');
  await until(() => inbox('big').includes('/compact'), () => `compact sent: ${log.slice(-400)} ${inbox('big')}`);
  await until(() => events('big').some((e) => e.k === 'log' && /compacted while the cache was warm/.test(e.text)), 'compaction result seen');
  assert.equal(events('big').filter((e) => e.k === 'end').length, 1, 'one turn ended, not two');
  // The next message is a normal turn on the same process, and its end is its own.
  await wake('big', 'wake two');
  await until(() => events('big').filter((e) => e.k === 'end').length === 2, 'second turn ended');
  // The second compaction is written just after the second end: wait for it rather than race it.
  await until(() => inbox('big').split('\n').filter(Boolean).length === 4, () => `wake, compact, wake, compact: ${inbox('big')}`);
  assert.equal(events('big').filter((e) => e.k === 'end').length, 2, 'compactions are not turns');
});

test('a small context is not compacted', async () => {
  await wake('small', 'wake one');
  await until(() => events('small').some((e) => e.k === 'end'), 'turn ended');
  await sleep(500);
  assert.ok(!inbox('small').includes('/compact'), inbox('small'));
});
