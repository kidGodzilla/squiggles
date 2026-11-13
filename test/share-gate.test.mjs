// A device on the tailnet must never reach an unlocked room: no passcode means this computer only, and sharing needs a long one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from './room.mjs';

let PORT;
async function room(roomJson) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-share-'));
  fs.mkdirSync(path.join(d, 'runs'));
  if (roomJson) fs.writeFileSync(path.join(d, 'room.json'), JSON.stringify(roomJson));
  const { up, out, port, stop } = await boot(d, { tailnet: true }, { SQUIGGLES_TAILSCALE: path.join(d, 'no-tailscale') });
  PORT = port;
  assert.ok(up, out);
  return stop;
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
