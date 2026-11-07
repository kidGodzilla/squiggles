// Tailnet sharing needs a passcode: clearing it turns sharing off, and a room with none unshares at boot.
// A real server in a temp home with a stub tailscale: nothing here touches a live room or the real tailnet.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// An older checkout ignores SQUIGGLES_TAILSCALE and would reach the real tailscale.
const skip = !!process.env.SRC;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const room = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sq-sharepass-')));
const HOME = path.join(room, 'home'), STUB = path.join(room, 'tailscale');
const ON = path.join(room, 'on'), FAIL = path.join(room, 'fail'), LOG = path.join(room, 'calls');
const CODE = 'demo-code-not-real';
fs.mkdirSync(path.join(HOME, 'runs'), { recursive: true });
fs.writeFileSync(STUB, `#!/bin/sh
echo "$*" >> '${LOG}'
[ "$1" = serve ] || { echo '{}'; exit 0; }
if [ "$2" = status ]; then
  if [ -f '${ON}' ]; then cat '${ON}'; else echo '{}'; fi
  exit 0
fi
if [ -f '${FAIL}' ]; then echo 'stub refuses' >&2; exit 1; fi
if [ "$2" = --bg ]; then printf '{"Web":{"box.example.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:%s"}}}}}' "$3" > '${ON}'; exit 0; fi
rm -f '${ON}'
`, { mode: 0o755 });

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
async function until(fn, what, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (await fn()) return;
  assert.fail(what);
}
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const serving = (n) => fs.writeFileSync(ON, JSON.stringify({ Web: { 'box.example.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${n}` } } } } }));

let server, base, port, log = '';
async function boot(bin, at, roomJson) {
  port = at || await freePort(); base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({ schema: 1, port, tailnet: true }));
  if (roomJson) fs.writeFileSync(path.join(HOME, 'room.json'), JSON.stringify(roomJson));
  server = spawn(process.execPath, [path.join(REPO, 'server.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SQUIGGLES_HOME: HOME, SQUIGGLES_TAILSCALE: bin } });
  server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  await until(() => / on http/.test(log.slice(-2000)) && fetch(`${base}/api/passcode`).then((r) => r.ok).catch(() => false), `server up: ${log.slice(-400)}`);
}
const stop = () => new Promise((res) => { if (!server || server.exitCode !== null || server.signalCode) return res(); server.once('exit', res); server.kill(); });
after(async () => { await stop(); fs.rmSync(room, { recursive: true, force: true }); });

const PAGE = { 'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-origin' };
const post = (url, b, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
const passcode = () => fetch(`${base}/api/passcode`).then((r) => r.json());
const session = (r) => ({ ...PAGE, cookie: (r.headers.get('set-cookie') || '').split(';')[0] });

test('boot: this room unshares without a passcode, another room stays', { skip }, async () => {
  serving(1);
  await boot(STUB);
  await until(() => /serve status/.test(calls()), 'boot checks sharing');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(fs.existsSync(ON), "another room's entry stays");
  assert.doesNotMatch(calls(), /off/);
  await stop();

  // tailscale serve outlives a server: shared from an earlier boot, off at this one.
  const mine = await freePort();
  serving(mine);
  await boot(STUB, mine);
  await until(() => !fs.existsSync(ON), 'boot turns sharing off');
  await stop();

  // A code from before the 8-character minimum stays shared behind its lock.
  serving(mine);
  await boot(STUB, mine, { passcode: { salt: 'aa', hash: 'bb', codeLen: 4, sessions: {} } });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(fs.existsSync(ON), 'a short code stays shared');
  await stop();
  fs.rmSync(ON); fs.rmSync(path.join(HOME, 'room.json'));
});

test('boot leaves a room with a good passcode shared', { skip }, async () => {
  fs.rmSync(LOG, { force: true });
  const mine = await freePort();
  await boot(STUB, mine);
  assert.equal((await post('/api/passcode', { op: 'set', code: CODE }, PAGE)).status, 200);
  await stop();
  serving(mine);
  await boot(STUB, mine);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(fs.existsSync(ON), 'stays shared');
  await stop();
  fs.rmSync(ON); fs.rmSync(path.join(HOME, 'room.json'));
});

test('clearing the passcode turns sharing off, or stays put if it cannot', { skip }, async () => {
  await boot(STUB);
  const page = session(await post('/api/passcode', { op: 'set', code: CODE }, PAGE));
  assert.ok(page.cookie, 'a session from setting the passcode');
  const on = await post('/api/share', { on: true }, page);
  assert.equal(on.status, 200);
  assert.equal((await on.json()).on, true);

  assert.equal((await post('/api/passcode', { op: 'clear', old: 'wrong-code-here' }, page)).status, 403);
  assert.ok(fs.existsSync(ON), 'a wrong code changes nothing');

  fs.writeFileSync(FAIL, '');
  const stuck = await post('/api/passcode', { op: 'clear', old: CODE }, page);
  assert.equal(stuck.status, 409);
  assert.match((await stuck.json()).error, /passcode stays/);
  assert.equal((await passcode()).set, true);
  fs.rmSync(FAIL);

  const clear = await post('/api/passcode', { op: 'clear', old: CODE }, page);
  assert.equal(clear.status, 200);
  const b = await clear.json();
  assert.deepEqual([b.set, b.sharingOff], [false, true]);
  assert.ok(!fs.existsSync(ON), 'sharing off');
  assert.equal((await fetch(`${base}/api/share`).then((r) => r.json())).on, false);
});

test('no Tailscale on this computer: the passcode still clears', { skip }, async () => {
  await stop();
  await boot(path.join(room, 'no-such-binary'));
  const set = await post('/api/passcode', { op: 'set', code: CODE }, PAGE);
  assert.equal(set.status, 200);
  const clear = await post('/api/passcode', { op: 'clear', old: CODE }, session(set));
  assert.equal(clear.status, 200);
  assert.equal((await clear.json()).set, false);
});
