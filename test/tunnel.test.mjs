import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTunnel, urlIn, MIN_CODE } from '../tunnel.mjs';
import { makeGuard } from '../guard.mjs';
import { makePasscode } from '../passcode.mjs';
import { shareRefusal } from '../trust.mjs';

const stub = (body) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-')), 'cloudflared'); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return f; };
const HOST = 'brave-otter-pine.trycloudflare.com';

test('urlIn finds the quick tunnel URL in cloudflared\'s log', () => {
  assert.equal(urlIn(`INF |  https://${HOST}  |`), `https://${HOST}`);
  assert.equal(urlIn('INF Requesting new quick Tunnel on trycloudflare.com...'), '');
  assert.equal(urlIn('https://api.trycloudflare.com.evil.example'), '');
});

test('start reads the URL; stop ends it; args point at this port', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfa-')), args = path.join(dir, 'args');
  const bin = stub(`echo "$@" > ${args}\necho "INF |  https://${HOST}  |" >&2\nexec sleep 30`);
  const seen = []; const t = createTunnel({ port: 4398, bin, onChange: (s) => seen.push(s.on) });
  const st = await t.start();
  assert.deepEqual([st.on, st.url, t.host()], [true, `https://${HOST}`, HOST]);
  assert.equal(fs.readFileSync(args, 'utf8').trim(), 'tunnel --no-autoupdate --url http://127.0.0.1:4398');
  assert.equal(t.stop().on, false); assert.equal(t.host(), '');
  assert.deepEqual(seen, [true, false]);
});

test('missing binary, early exit and no URL are errors, not hangs', async () => {
  assert.match((await createTunnel({ port: 1, bin: '/nonexistent/cloudflared' }).start()).error, /brew install cloudflared/);
  assert.match((await createTunnel({ port: 1, bin: stub('echo "ERR failed to reach edge" >&2; exit 1') }).start()).error, /exited 1: ERR failed to reach edge/);
  const slow = await createTunnel({ port: 1, bin: stub('exec sleep 30'), wait: 300 }).start();
  assert.deepEqual([slow.on, slow.error], [false, 'cloudflared gave no URL in time']);
});

test('guard lets the tunnel host in only while it is up', () => {
  let host = HOST; const refuse = makeGuard(4398, () => '', () => host);
  const json = { 'content-type': 'application/json' };
  assert.equal(refuse({ method: 'POST', headers: { host: HOST, origin: `https://${HOST}`, ...json } }), '');
  assert.equal(refuse({ method: 'POST', headers: { host: HOST, origin: `http://${HOST}`, ...json } }), 'origin');
  assert.equal(refuse({ method: 'GET', headers: { host: 'other-words.trycloudflare.com' } }), 'host');
  host = '';
  assert.equal(refuse({ method: 'GET', headers: { host: HOST } }), 'host');
});

test('tunnel hits are never local, and the passcode keeps its length', () => {
  let store = null; const pc = makePasscode({ read: () => store, write: (p) => { store = p; } });
  const cli = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'user-agent': 'node' } };
  pc.op(cli, { op: 'set', code: '2468' }); assert.equal(pc.codeLen(), 4);
  pc.op(cli, { op: 'set', code: 'longer-code', old: '2468' }); assert.equal(pc.codeLen(), 11); assert.equal(store.codeLen, 11);
  assert.ok(pc.codeLen() >= MIN_CODE);
  const curl = { 'user-agent': 'curl/8' };
  assert.equal(pc.ok({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: HOST, ...curl } }), false, 'tunnel Host');
  assert.equal(pc.ok({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:4398', 'cf-connecting-ip': '203.0.113.5', ...curl } }), false, 'Cloudflare client header');
  assert.equal(pc.ok({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:4398', ...curl } }), true, 'the CLI still passes');
});

test('only the user turns public sharing on', () => {
  assert.match(shareRefusal({ caller: 'lead' }).error, /lead can't share/);
  assert.match(shareRefusal({ caller: 'bo', owner: () => true }).error, /bo can't share/);
  assert.equal(shareRefusal({ owner: () => false }).unlock, true);
  assert.equal(shareRefusal({ owner: () => true }), null);
});
