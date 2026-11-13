// POST /api/room reaches every page: only known actions and their fields go out, as strings, so a caller can't forge
// another event (a reaction) or send a value that breaks the render. Chat images resolve only for image files.
// HOME is a temp room: nothing here touches the live room.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from './room.mjs';

const room = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'room-events-')));
const HOME = path.join(room, 'home'), DATA = path.join(room, 'data');
const CODE = 'demo-code-not-real';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let room0, base, stream, seen = [];
const PAGE = { 'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-origin' };
const api = (p, b, headers = PAGE) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
const roomEvents = () => seen.filter((m) => m.id === '*room' && m.ev.k === 'room').map((m) => m.ev);
async function until(fn, what, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error(`timed out: ${what}`);
}

before(async () => {
  fs.mkdirSync(HOME); fs.mkdirSync(path.join(DATA, 'runs'), { recursive: true });
  room0 = await boot(DATA, {}, { HOME });
  assert.ok(room0.up, room0.out);
  base = `http://127.0.0.1:${room0.port}`; PAGE.origin = base;
  assert.equal((await api('/api/passcode', { op: 'set', code: CODE })).status, 200);
  PAGE.cookie = ((await api('/api/passcode', { op: 'unlock', code: CODE })).headers.get('set-cookie') || '').split(';')[0];
  assert.ok(PAGE.cookie, 'a session from unlocking');
  stream = new AbortController();
  const r = await fetch(base + '/api/stream', { headers: PAGE, signal: stream.signal });
  (async () => {
    let buf = '';
    try {
      for await (const c of r.body) {
        buf += Buffer.from(c).toString('utf8');
        const parts = buf.split('\n\n'); buf = parts.pop();
        for (const p of parts) if (p.startsWith('data: ')) seen.push(JSON.parse(p.slice(6)));
      }
    } catch {}
  })();
});
after(async () => { stream?.abort(); await room0?.halt(); fs.rmSync(room, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('only the action and its own fields are broadcast, as text', async () => {
  const r = await api('/api/room', { action: 'view', value: 'room', id: 7, emoji: 5, chat: 'boss', ts: 1, list: [{ emoji: 5 }], k: 'removed' });
  assert.equal(r.status, 200);
  const ev = await until(() => roomEvents().find((e) => e.action === 'view'), 'the view event');
  assert.deepEqual(ev, { action: 'view', value: 'room', id: '7', k: 'room' });
});

test('a value that is not text is refused', async () => {
  assert.equal((await api('/api/room', { action: 'radio', value: { off: 1 } })).status, 400);
  assert.equal((await api('/api/room', { action: 'chat', value: 'boss', text: ['x'] })).status, 400);
  assert.equal((await api('/api/room', { action: 'nonsense', value: 'x' })).status, 400);
});

test('a reaction is refused here: it has its own endpoint', async () => {
  const r = await api('/api/room', { action: 'react', chat: 'boss', ts: 1, list: [{ emoji: '👍', by: ['owner'] }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /\/api\/react/);
  await api('/api/room', { action: 'radio', value: 'off' });
  await until(() => roomEvents().some((e) => e.action === 'radio'), 'the radio event after it');
  assert.equal(roomEvents().some((e) => e.action === 'react'), false, 'no forged reaction reached the page');
});

test('chat images resolve only for image files', () => {
  const src = fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
  const fn = /^function fileUrl\(p\) \{[\s\S]*?^\}$/m.exec(src)[0];
  const fileUrl = new Function('S', `${fn}\nreturn fileUrl;`)({ home: '/home/x', roots: { files: '/home/x/drop' }, realRoots: {} });
  for (const p of ['/files/notes.txt', '/files/page.html', '/files/pic.svg', '/files/pic.png.txt', '/files/run', '/home/x/drop/notes.txt']) assert.equal(fileUrl(p), null, p);
  for (const p of ['/files/a.png', '/files/a.JPG', '/files/a.jpeg', '/files/a.gif', '/files/a.WebP']) assert.equal(fileUrl(p), p, p);
  assert.equal(fileUrl('/home/x/drop/a.png'), '/files/a.png');
});
