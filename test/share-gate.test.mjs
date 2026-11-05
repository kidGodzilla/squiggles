// A device on the tailnet must never reach an unlocked room: no passcode means this computer only, and sharing needs a long one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 4395;
async function room(roomJson) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-share-'));
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ schema: 1, port: PORT, tailnet: true }));
  fs.mkdirSync(path.join(d, 'runs'));
  if (roomJson) fs.writeFileSync(path.join(d, 'room.json'), JSON.stringify(roomJson));
  const p = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, SQUIGGLES_HOME: d }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const up = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    for (const s of [p.stdout, p.stderr]) s.on('data', (b) => { out += b; if (/ on http/.test(out)) { clearTimeout(t); res(true); } });
    p.on('exit', () => { clearTimeout(t); res(false); });
  });
  assert.ok(up, out);
  return async () => {
    const gone = new Promise((res) => (p.exitCode !== null || p.signalCode) ? res() : p.once('exit', res));
    p.kill(); await gone; fs.rmSync(d, { recursive: true, force: true });
  };
}
const url = (p) => `http://127.0.0.1:${PORT}/api/${p}`;
const remote = { 'x-forwarded-for': '100.64.0.9' }; // what tailscale serve adds
const share = async () => { const r = await fetch(url('share'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) }); return { status: r.status, ...(await r.json()) }; };

test('with no passcode a remote device gets the lock, this computer gets in', async () => {
  const stop = await room();
  try {
    assert.equal((await fetch(url('squiggles'), { headers: remote })).status, 401);
    assert.equal((await fetch(url('squiggles'))).status, 200);
    const st = await (await fetch(url('passcode'), { headers: remote })).json();
    assert.deepEqual([st.set, st.ok], [false, false]);
    const set = await fetch(url('passcode'), { method: 'POST', headers: { ...remote, 'content-type': 'application/json' }, body: JSON.stringify({ op: 'set', code: 'remote-claims-it' }) });
    assert.ok(set.status >= 400, String(set.status));
  } finally { await stop(); }
});

test('tailnet sharing refuses a room with no passcode', async () => {
  const stop = await room();
  try {
    const r = await share();
    assert.ok(r.status >= 400, JSON.stringify(r));
    assert.match(r.error, /passcode of 8\+/);
  } finally { await stop(); }
});

test('tailnet sharing refuses a passcode set before the 8-character minimum', async () => {
  const stop = await room({ passcode: { salt: 'aa', hash: 'bb', codeLen: 4, sessions: {} } });
  try {
    const r = await share();
    assert.ok(r.status >= 400, JSON.stringify(r));
    assert.match(r.error, /passcode of 8\+/);
  } finally { await stop(); }
});
