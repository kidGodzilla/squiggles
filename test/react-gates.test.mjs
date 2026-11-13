// A reaction lands only on a message that is there, and names a person only for that person's unlocked page.
// A private squiggle's streamed events and reactions stay with it and the lead. HOME is a temp room.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from './room.mjs';
import { eventOwner } from '../gates.mjs';

const room = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'react-gates-')));
const HOME = path.join(room, 'home'), DATA = path.join(room, 'data');
const CODE = 'demo-code-not-real', META = 'squiggle' + '.json';
let room0, base;
const PAGE = { 'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-origin' };
const post = (p, b, headers = PAGE) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });

before(async () => {
  fs.mkdirSync(HOME); fs.mkdirSync(path.join(DATA, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(DATA, 'squiggles', 'boss'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'squiggles', 'boss', META), JSON.stringify({ id: 'boss', name: 'Boss' }));
  fs.writeFileSync(path.join(DATA, 'runs', 'boss.jsonl'), JSON.stringify({ k: 'say', ts: 111, text: 'hello there' }) + '\n');
  fs.writeFileSync(path.join(DATA, 'humans.json'), JSON.stringify({ humans: [{ id: 'owner', name: 'You', avatar: '' }, { id: 'ann', name: 'Ann', avatar: '' }] }));
  room0 = await boot(DATA, {}, { HOME });
  assert.ok(room0.up, room0.out);
  base = `http://127.0.0.1:${room0.port}`; PAGE.origin = base;
  assert.equal((await post('/api/passcode', { op: 'set', code: CODE })).status, 200);
  PAGE.cookie = ((await post('/api/passcode', { op: 'unlock', code: CODE })).headers.get('set-cookie') || '').split(';')[0];
  assert.ok(PAGE.cookie, 'a session from unlocking');
});
after(async () => { await room0?.halt(); fs.rmSync(room, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('a reaction needs a message that is there', async () => {
  const r = await post('/api/react', { chat: 'boss', ts: 999, emoji: '👍' });
  assert.equal(r.status, 404, await r.text());
  const ok = await post('/api/react', { chat: 'boss', ts: 111, emoji: '👍' });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).list.map((x) => x.emoji), ['👍']);
  const items = (await (await fetch(base + '/api/react', { headers: PAGE })).json()).items;
  assert.deepEqual(Object.keys(items), ['boss:111'], 'nothing stored at the made-up ts');
});

test('a person is named only by their unlocked page', async () => {
  const cli = await post('/api/react', { chat: 'boss', ts: 111, emoji: '🎉', human: 'ann' }, { 'content-type': 'application/json' });
  assert.equal(cli.status, 200, await cli.clone().text());
  assert.deepEqual((await cli.json()).list.find((x) => x.emoji === '🎉').by, 'owner', 'a terminal saying human: ann is not Ann');
  const page = await post('/api/react', { chat: 'boss', ts: 111, emoji: '🔥', human: 'ann' });
  assert.deepEqual((await page.json()).list.find((x) => x.emoji === '🔥').by, 'ann');
});

test("a streamed room event about a chat is that chat's", () => {
  assert.equal(eventOwner('*room', { k: 'room', action: 'react', chat: 'boss' }), 'boss');
  assert.equal(eventOwner('*room', { k: 'room', action: 'slots' }), '*room');
  assert.equal(eventOwner('boss', { k: 'say' }), 'boss');
  const s = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const fn = s.slice(s.indexOf('function broadcast('), s.indexOf('\n}\n', s.indexOf('function broadcast(')));
  assert.match(fn, /res\.caller && res\.caller !== owner && !res\.lead/, 'a private chat skips other squiggles\' pages');
  assert.match(s, /res\.caller = await callerSquiggle\(req\)/, 'the stream knows who opened it');
});
