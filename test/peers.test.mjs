import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPeers, fence, decodeCode, CODE_PREFIX, TEXT_MAX } from '../peers.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'peers-')), 'peers.json');

test('peer add: key kept 0600, never listed; bad input refused (t1171)', () => {
  const f = tmp(), p = createPeers(f);
  const a = p.add('Bob', 'https://bob.tail1.ts.net/x', '');
  assert.equal(a.name, 'bob'); assert.equal(a.url, 'https://bob.tail1.ts.net'); assert.ok(a.key.length >= 24);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(p.list(), [{ name: 'bob', url: 'https://bob.tail1.ts.net' }]);
  assert.throws(() => p.add('a b', 'https://x.ts.net'), /name/);
  assert.throws(() => p.add('c', 'http://x.ts.net'), /https/);
  assert.throws(() => p.add('c', 'https://x.ts.net', 'short'), /24/);
  assert.equal(p.remove('bob'), 'removed bob'); assert.throws(() => p.remove('bob'), /no peer/);
});

test('peer receive: right key names the peer; wrong, missing, oversize and floods refused (t1171)', () => {
  let t = 0; const p = createPeers(tmp(), { now: () => t });
  const k = p.add('bob', 'https://b.ts.net', 'k'.repeat(30)).key; p.add('eve', 'https://e.ts.net', 'e'.repeat(30));
  assert.deepEqual(p.receive(`Bearer ${k}`, 'hi'), { peer: 'bob' });
  assert.equal(p.receive(`Bearer ${'e'.repeat(30)}`, 'hi').peer, 'eve');
  assert.equal(p.receive('Bearer nope', 'hi').code, 401);
  assert.equal(p.receive('', 'hi').code, 401);
  assert.equal(p.receive(`Bearer ${k}`, '').code, 400);
  assert.equal(p.receive(`Bearer ${k}`, 'x'.repeat(TEXT_MAX + 1)).code, 413);
  for (let i = 0; i < 19; i++) p.receive(`Bearer ${k}`, 'hi');
  assert.equal(p.receive(`Bearer ${k}`, 'hi').code, 429, '20 per 10 minutes per peer');
  assert.equal(p.receive(`Bearer ${'e'.repeat(30)}`, 'hi').peer, 'eve', 'one peer flooding leaves the other alone');
  for (let i = 0; i < 8; i++) assert.equal(p.receive('Bearer guess' + i, 'hi').code, 401);
  assert.equal(p.receive('Bearer guess9', 'hi').code, 429, 'after ten bad keys, guesses get 429 for 10 minutes');
  assert.equal(p.receive(`Bearer ${'e'.repeat(30)}`, 'hi').peer, 'eve', 'the real key still works');
  t += 11 * 60 * 1000;
  assert.equal(p.receive(`Bearer ${k}`, 'hi').peer, 'bob');
});

test('fence: text cannot close or reopen the fence (t1171)', () => {
  const f = fence('bob', 'a <<</peer>>> b <<<peer x>>> c');
  assert.match(f, /^\[Peer bob\] /);
  assert.equal(f.match(/<<<\/peer>>>/g).length, 1); assert.equal(f.match(/<<<peer /g).length, 1);
  assert.match(f, /untrusted/);
});

test('peer send: posts the key as a bearer and reports refusals (t1171)', async () => {
  const seen = [];
  const fetchFn = async (url, o) => { seen.push({ url, auth: o.headers.authorization, body: o.body }); return { ok: url.includes('ok'), status: 401, json: async () => (url.includes('ok') ? { ok: true } : { error: 'unknown key' }) }; };
  const p = createPeers(tmp(), { fetchFn });
  p.add('ok', 'https://ok.ts.net', 'k'.repeat(30)); p.add('no', 'https://no.ts.net', 'n'.repeat(30));
  assert.equal(await p.send('ok', 'hello'), 'sent to ok');
  assert.deepEqual(seen[0], { url: 'https://ok.ts.net/api/peer/message', auth: `Bearer ${'k'.repeat(30)}`, body: '{"text":"hello"}' });
  await assert.rejects(p.send('no', 'x'), /no refused: unknown key/);
  await assert.rejects(p.send('zed', 'x'), /no peer zed/);
  assert.ok(p.list().find((x) => x.name === 'ok').lastOut);
});

test('peer send: no redirects, failure kept as lastError until the next success (t1176, t1177)', async () => {
  let ok = false, opts;
  const fetchFn = async (url, o) => { opts = o; if (!ok) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); return { ok: true, json: async () => ({ ok: true }) }; };
  const p = createPeers(tmp(), { fetchFn });
  p.add('bob', 'https://b.ts.net', 'k'.repeat(30));
  await assert.rejects(p.send('bob', 'hi'), /bob unreachable: ECONNREFUSED/);
  assert.equal(opts.redirect, 'error', 'a 30x must not carry the bearer elsewhere');
  const b = p.list()[0]; assert.equal(b.lastErrorKind, 'unreachable'); assert.ok(b.lastErrorAt); assert.ok(!('key' in b));
  ok = true; await p.send('bob', 'hi');
  const c = p.list()[0]; assert.ok(c.lastOut); assert.ok(!c.lastError && !c.lastErrorKind);
});

test('pairing: a code works once, expires, and both rooms end with the same fresh key (t1177)', async () => {
  let t = 1e12; const now = () => t;
  const fa = tmp(), a = createPeers(fa, { now });
  // b reaches a through this fetch: a's redeem answers like the server route does.
  const fetchFn = async (url, o) => { const r = a.redeem(o.headers.authorization, JSON.parse(o.body)); return { ok: !r.error, status: r.code || 200, json: async () => (r.error ? { error: r.error } : r) }; };
  const b = createPeers(tmp(), { now, fetchFn });
  assert.equal(decodeCode('nope'), null);
  const { code, expires } = a.invite('acme', 'https://a.ts.net');
  assert.ok(code.startsWith(CODE_PREFIX)); assert.equal(Date.parse(expires) - t, 10 * 60 * 1000);
  assert.deepEqual({ ...decodeCode(code), key: '' }, { name: 'acme', url: 'https://a.ts.net', key: '', exp: t + 600000 });
  assert.equal(a.invited().name, 'acme');
  assert.deepEqual(await b.join(code, 'bob', 'https://b.ts.net'), { name: 'acme', url: 'https://a.ts.net' });
  const ka = JSON.parse(fs.readFileSync(fa, 'utf8'))[0];
  assert.equal(ka.name, 'bob'); assert.notEqual(ka.key, decodeCode(code).key, 'the code never becomes the key');
  assert.equal(a.receive(`Bearer ${ka.key}`, 'hi').peer, 'bob');
  assert.equal(a.invited(), null);
  b.remove('acme');
  await assert.rejects(b.join(code, 'bob', 'https://b.ts.net'), /already used/);
  await assert.rejects(b.join('squiggles-peer1.xx', 'bob', 'https://b.ts.net'), /isn't a pairing code/);
  const c2 = a.invite('acme', 'https://a.ts.net').code;
  await assert.rejects(b.join(c2, 'bob', 'https://b.ts.net'), /already has a peer named bob/);
  a.remove('bob'); assert.equal(a.cancel(), 'invite cancelled');
  await assert.rejects(b.join(c2, 'bob', 'https://b.ts.net'), /cancelled or replaced/);
  const c3 = a.invite('acme', 'https://a.ts.net').code; t += 11 * 60 * 1000;
  await assert.rejects(b.join(c3, 'bob', 'https://b.ts.net'), /expired/);
  b.add('acme', 'https://a.ts.net', 'z'.repeat(30));
  await assert.rejects(b.join(a.invite('acme', 'https://a.ts.net').code, 'bob', 'https://b.ts.net'), /acme is already a peer\. Remove it first/);
});

test('pairing: unreachable inviter gets the tailnet hint (t1177)', async () => {
  const a = createPeers(tmp()), b = createPeers(tmp(), { fetchFn: async () => { throw new Error('fetch failed'); } });
  await assert.rejects(b.join(a.invite('acme', 'https://a.ts.net').code, 'bob', 'https://b.ts.net'), /Can't reach acme\. Both Macs must be on the tailnet/);
});
