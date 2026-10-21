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
  s.pc.op(cli, { op: 'local', on: true, old: '2468' });
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
  s.pc.op(cli, { op: 'set', code: '1357', old: '2468' });
  assert.equal(s.pc.ok(remote(c)), false);
  assert.throws(() => s.pc.op(cli, { op: 'set', code: '12', old: '1357' }), /4 to 64/);
  s.pc.op(cli, { op: 'clear', old: '1357' });
  assert.equal(s.pc.ok(remote()), true);
});

test('session: gated merges need a live unlocked cookie; the CLI and local skips do not count', () => {
  const s = setup();
  assert.throws(() => s.pc.session(cli), (e) => e.code === 403 && /Set a room passcode/.test(e.message));
  s.pc.op(cli, { op: 'set', code: '2468' });
  s.pc.op(cli, { op: 'local', on: true, old: '2468' });
  assert.equal(s.pc.ok(cli), true); assert.equal(s.pc.ok(localBrowser()), true);
  for (const r of [cli, localBrowser(), remote(), remote('agents_s=' + 'a'.repeat(64))]) assert.throws(() => s.pc.session(r), (e) => e.code === 403 && e.unlock === true);
  const c = `agents_s=${tok(s.pc.op(localBrowser(), { op: 'unlock', code: '2468' }).cookie)}`;
  assert.equal(s.pc.session(localBrowser(c)), true);
  assert.equal(s.pc.session(remote(c)), true);
  s.pc.op(remote(c), { op: 'lock' });
  assert.throws(() => s.pc.session(remote(c)), (e) => e.unlock === true, 'locking ends it');
  const c2 = `agents_s=${tok(s.pc.op(remote(), { op: 'unlock', code: '2468' }).cookie)}`;
  s.tick(31 * 864e5); assert.throws(() => s.pc.session(remote(c2)), (e) => e.unlock === true, 'expired');
});

test('changing, clearing or loosening a set passcode needs the current one, even from the CLI', () => {
  const s = setup();
  s.pc.op(cli, { op: 'set', code: '2468' });
  for (const b of [{ op: 'set', code: '9999' }, { op: 'clear' }, { op: 'local', on: true }, { op: 'clear', old: '1111' }]) assert.throws(() => s.pc.op(cli, b), (e) => e.code === 403 && /wrong/.test(e.message));
  assert.equal(s.pc.status(cli).set, true); assert.equal(s.pc.status(cli).localSkips, false);
  s.pc.op(cli, { op: 'set', code: '9999', old: '2468' });
  assert.throws(() => s.pc.op(cli, { op: 'clear', old: '2468' }), /wrong/);
  s.pc.op(cli, { op: 'clear', old: '9999' });
  assert.equal(s.pc.status(cli).set, false);
  s.pc.op(cli, { op: 'set', code: '1234' }); assert.equal(s.pc.status(cli).set, true, 'the first set needs no old code');
});

test('wrong current codes share the unlock limiter', () => {
  const s = setup(), r = remote();
  s.pc.op(cli, { op: 'set', code: '2468' });
  const c = `agents_s=${tok(s.pc.op(r, { op: 'unlock', code: '2468' }).cookie)}`, rc = remote(c);
  for (let i = 0; i < 5; i++) assert.throws(() => s.pc.op(rc, { op: 'clear', old: '0000' }), /wrong/);
  assert.throws(() => s.pc.op(rc, { op: 'clear', old: '2468' }), (e) => e.code === 429);
  assert.throws(() => s.pc.op(r, { op: 'unlock', code: '2468' }), (e) => e.code === 429);
});

test('empty codes and local scripts cannot lock the user out (t956)', () => {
  const s = setup(), r = remote(), local = localBrowser();
  s.pc.op(cli, { op: 'set', code: '2468' });
  for (let i = 0; i < 40; i++) assert.throws(() => s.pc.op(r, { op: 'unlock' }), /wrong/);
  for (let i = 0; i < 40; i++) assert.throws(() => s.pc.op(cli, { op: 'unlock', code: '0000' }), /wrong|too many/);
  assert.equal(s.pc.op(local, { op: 'unlock', code: '2468' }).body.ok, true, 'the local browser has its own bucket');
  assert.equal(s.pc.op(r, { op: 'unlock', code: '2468' }).body.ok, true, 'neither counted toward the tailnet client or the global cap');
});

test('room.json edits after boot are ignored: a forged session or swapped hash is refused (t1396)', async () => {
  const crypto = await import('node:crypto'), sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const s = setup(), forged = 'f'.repeat(64);
  s.pc.op(cli, { op: 'set', code: '2468' });
  assert.equal(s.store.sessions, undefined, 'sessions never written');
  // A squiggle adds its own session line, then swaps in a hash for a code it knows.
  const other = setup(); other.pc.op(cli, { op: 'set', code: '9999' });
  Object.assign(s.store, { sessions: { [sha(forged)]: 1e12 + 864e5 } });
  for (const k of ['salt', 'hash']) s.store[k] = other.store[k];
  assert.throws(() => s.pc.session(remote(`agents_s=${forged}`)), (e) => e.code === 403 && e.unlock);
  assert.equal(s.pc.ok(remote(`agents_s=${forged}`)), false);
  assert.throws(() => s.pc.op(remote(), { op: 'unlock', code: '9999' }), /wrong passcode/);
  assert.ok(s.pc.op(remote(), { op: 'unlock', code: '2468' }).cookie);
});

test('boot loads the hash, drops stored sessions; set and clear update memory (t1396)', () => {
  const sha = 'a'.repeat(64);
  let store = { salt: 's', hash: 'b'.repeat(64), localSkips: false, sessions: { [sha]: Date.now() + 864e5 } };
  const pc = makePasscode({ read: () => store, write: (p) => { store = p; } });
  assert.equal(store.sessions, undefined);
  assert.deepEqual(pc.status(remote()), { set: true, ok: false, localSkips: false });
  store = null; assert.equal(pc.status(remote()).set, true, 'clearing room.json by hand does not turn it off');
});
