import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePasscode } from '../passcode.mjs';

const setup = () => {
  let store = null, t = 1e12;
  const pc = makePasscode({ read: () => store, write: (p) => { store = p; }, now: () => t });
  return { pc, get store() { return store; }, tick: (ms) => { t += ms; } };
};
const remote = (cookie) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '100.64.0.9', 'sec-fetch-site': 'same-origin', ...(cookie && { cookie }) } });
const localBrowser = (cookie) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'sec-fetch-site': 'same-origin', ...(cookie && { cookie }) } });
// What Node's fetch (the CLI) actually sends.
const cli = { socket: { remoteAddress: '127.0.0.1' }, headers: { accept: '*/*', 'sec-fetch-mode': 'cors', 'user-agent': 'node' } };
const safari = { socket: { remoteAddress: '::1' }, headers: { 'user-agent': 'Mozilla/5.0 (iPad) Safari/605' } };
const tok = (c) => c.match(/agents_s=([a-f0-9]*)/)[1];

test('off by default: everyone passes', () => {
  const { pc } = setup();
  assert.equal(pc.ok(remote()), true);
  assert.deepEqual(pc.status(remote()), { set: false, ok: true, localSkips: false });
});

test('set stores only a salted hash; remote needs the cookie; CLI always passes', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  assert.ok(s.store.hash && s.store.salt && !JSON.stringify(s.store).includes('2468'));
  assert.equal(s.pc.ok(remote()), false);
  assert.equal(s.pc.ok(localBrowser()), false);
  assert.equal(s.pc.ok(cli), true);
  assert.equal(s.pc.ok(safari), false, 'a browser without sec-fetch headers is still a browser');
  assert.throws(() => s.pc.op(remote(), { op: 'clear' }), /locked/);
  assert.throws(() => s.pc.op(remote(), { op: 'set', code: 'nope1' }), /locked/);
});

test('unlock sets an HttpOnly SameSite=Strict cookie that opens the API until lock', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  assert.throws(() => s.pc.op(remote(), { op: 'unlock', code: '1111' }), /wrong/);
  const r = s.pc.op(remote(), { op: 'unlock', code: '2468' });
  assert.match(r.cookie, /HttpOnly; SameSite=Strict; Max-Age=2592000/);
  const c = `agents_s=${tok(r.cookie)}`;
  assert.equal(s.pc.ok(remote(c)), true);
  assert.ok(!JSON.stringify(s.store).includes(tok(r.cookie)), 'only the token hash is stored');
  s.pc.op(remote(c), { op: 'lock' });
  assert.equal(s.pc.ok(remote(c)), false);
});

test('sessions expire after 30 days', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  const c = `agents_s=${tok(s.pc.op(remote(), { op: 'unlock', code: '2468' }).cookie)}`;
  s.tick(29 * 864e5); assert.equal(s.pc.ok(remote(c)), true);
  s.tick(2 * 864e5); assert.equal(s.pc.ok(remote(c)), false);
});

test('local skips lets this Mac\'s browser in, never a tailnet one', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  s.pc.op(cli, { op: 'local', on: true });
  assert.equal(s.pc.ok(localBrowser()), true);
  assert.equal(s.pc.ok(remote()), false);
  const tsHost = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'mac.example.ts.net', 'user-agent': 'curl/8' } };
  assert.equal(s.pc.ok(tsHost), false, 'tailnet Host is never local');
});

test('guesses are rate-limited per client', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  for (let i = 0; i < 5; i++) assert.throws(() => s.pc.op(remote(), { op: 'unlock', code: '0000' }), /wrong/);
  assert.throws(() => s.pc.op(remote(), { op: 'unlock', code: '2468' }), (e) => e.code === 429);
  s.tick(31000);
  assert.ok(s.pc.op(remote(), { op: 'unlock', code: '2468' }).cookie);
});

test('setting a new passcode ends other sessions; clear turns it off', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  const c = `agents_s=${tok(s.pc.op(remote(), { op: 'unlock', code: '2468' }).cookie)}`;
  s.pc.op(cli, { op: 'set', code: '1357' });
  assert.equal(s.pc.ok(remote(c)), false);
  assert.throws(() => s.pc.op(cli, { op: 'set', code: '12' }), /4 to 64/);
  s.pc.op(cli, { op: 'clear' });
  assert.equal(s.pc.ok(remote()), true);
});

test('empty codes and local scripts cannot lock the user out (t956)', () => {
  const s = setup(), r = remote(), local = localBrowser();
  s.pc.op(cli, { op: 'set', code: '2468' });
  for (let i = 0; i < 40; i++) assert.throws(() => s.pc.op(r, { op: 'unlock' }), /wrong/);
  for (let i = 0; i < 40; i++) assert.throws(() => s.pc.op(cli, { op: 'unlock', code: '0000' }), /wrong|too many/);
  assert.equal(s.pc.op(local, { op: 'unlock', code: '2468' }).body.ok, true, 'the local browser has its own bucket');
  assert.equal(s.pc.op(r, { op: 'unlock', code: '2468' }).body.ok, true, 'neither counted toward the tailnet client or the global cap');
});
