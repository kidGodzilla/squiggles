// Vex's scan: a caller the server can't place (curl, a squiggle's detached child) dropped any watch. Only an unlocked session may.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 4397;
async function room(cfg) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-wdrop-'));
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ schema: 1, port: PORT, ...cfg }));
  fs.mkdirSync(path.join(d, 'runs'));
  const file = path.join(d, 'runs', 'watches.json');
  fs.writeFileSync(file, JSON.stringify({ watches: [{ id: 'w1', owner: 'alpha', cmd: 'echo hi', cwd: '/tmp', state: 'pending', every: 3600000 }] }));
  const p = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, SQUIGGLES_HOME: d }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const up = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    for (const s of [p.stdout, p.stderr]) s.on('data', (b) => { out += b; if (/ on http/.test(out)) { clearTimeout(t); res(true); } });
    p.on('exit', () => { clearTimeout(t); res(false); });
  });
  assert.ok(up, out);
  const stop = async () => {
    const gone = new Promise((res) => (p.exitCode !== null || p.signalCode) ? res() : p.once('exit', res));
    p.kill(); await gone; fs.rmSync(d, { recursive: true, force: true });
  };
  return { file, stop };
}
const post = async (p, b, cookie) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const drop = (cookie) => post('watches', { op: 'drop', id: 'w1' }, cookie);
const state = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).watches[0].state;

test('an unknown caller with no session cannot drop a watch', async () => {
  const { file, stop } = await room({});
  try {
    const r = await drop();
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(state(file), 'pending');
  } finally { await stop(); }
});

test('with a passcode: no session asks to unlock, and an unlocked session drops', async () => {
  const { file, stop } = await room({});
  try {
    await post('passcode', { op: 'set', code: '12345678' });
    const { cookie } = await post('passcode', { op: 'unlock', code: '12345678' });
    assert.ok(cookie);
    const r = await drop();
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.equal(r.body.unlock, true);
    assert.equal(state(file), 'pending');
    assert.equal((await drop(cookie)).status, 200);
    assert.equal(state(file), 'dropped');
  } finally { await stop(); }
});

test('the drop route gates unknown callers and tells the page to unlock', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const r = src.slice(src.indexOf("if (b.op === 'drop') {", src.indexOf("url.pathname === '/api/watches' && req.method === 'POST'")));
  const gate = r.indexOf('pass.session(req'), go = r.indexOf('watches.drop(');
  assert.ok(gate >= 0 && gate < go);
  assert.match(r.slice(gate, go), /unlock: true/);
});

test('the terminal and the Team card ask for the passcode', () => {
  assert.match(fs.readFileSync(new URL('../bin/agents.mjs', import.meta.url), 'utf8'), /const UNLOCKS = .*watches/);
  assert.match(fs.readFileSync(new URL('../ui/board.js', import.meta.url), 'utf8'), /unlocked\(\(\) => api\('\/watches', \{ op: 'drop'/);
});
