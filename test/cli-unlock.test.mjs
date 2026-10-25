// The user's terminal answers an `unlock` refusal with the passcode, retries once, then locks that session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callWithUnlock } from '../bin/unlock.mjs';

function fake() {
  const seen = [], tok = 'agents_s=' + 'a'.repeat(64);
  const srv = http.createServer((req, res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => {
    const b = d ? JSON.parse(d) : {}; seen.push({ url: req.url, b, cookie: req.headers.cookie || '' });
    if (req.url === '/api/passcode' && b.op === 'unlock') { res.setHeader('set-cookie', tok + '; Path=/; HttpOnly'); return res.end(JSON.stringify(b.code === '1234' ? { ok: true } : { error: 'wrong passcode' })); }
    if (req.url === '/api/passcode') return res.end('{}');
    res.end(JSON.stringify(req.headers.cookie === tok ? { ok: 'saved' } : { error: 'Unlock with the room passcode first', unlock: true }));
  }); });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/api`, tok })));
}

test('a refused change prompts, retries with the session, then locks it', async () => {
  const { srv, seen, base, tok } = await fake();
  try {
    let asked = 0; const v = await callWithUnlock(base, '/squiggles/x/update', { trust: 'high' }, async () => (asked++, '1234'));
    assert.deepEqual(v, { ok: 'saved' }); assert.equal(asked, 1);
    assert.deepEqual(seen.map((s) => s.b.op || s.url), ['/api/squiggles/x/update', 'unlock', '/api/squiggles/x/update', 'lock']);
    assert.equal(seen[3].cookie, tok);
  } finally { srv.close(); }
});
test('no terminal: the refusal stands and nothing unlocks', async () => {
  const { srv, seen, base } = await fake();
  try {
    await assert.rejects(callWithUnlock(base, '/quit', {}, false), /Unlock with the room passcode/);
    assert.equal(seen.length, 1);
  } finally { srv.close(); }
});
test('a wrong passcode fails without retrying', async () => {
  const { srv, seen, base } = await fake();
  try {
    await assert.rejects(callWithUnlock(base, '/quit', {}, async () => 'nope'), /wrong passcode/);
    assert.equal(seen.length, 2);
  } finally { srv.close(); }
});
