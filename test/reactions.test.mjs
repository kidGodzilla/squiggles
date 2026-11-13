import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReactions, findMessage, isEmoji } from '../reactions.mjs';
import { roomRefusal } from '../gates.mjs';

const store = () => createReactions(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rx-')), 'reactions.json'));
const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('a second identical reaction takes it back; others stay', () => {
  const r = store(), m = { chat: 'lead', ts: 1000 };
  r.toggle({ ...m, emoji: '🎉', by: 'owner' }); r.toggle({ ...m, emoji: '🎉', by: 'builder' });
  assert.deepEqual(r.toggle({ ...m, emoji: '🎉', by: 'owner' }).list, [{ emoji: '🎉', by: 'builder' }]);
  r.toggle({ ...m, emoji: '🎉', by: 'builder' });
  assert.deepEqual(r.all(), {});
});

test('only single emoji pass', () => {
  for (const e of ['👍', '❤️', '👍🏽', '👩‍💻', '🇳🇿', '✅']) assert.ok(isEmoji(e), e);
  for (const e of ['', 'hi', '<b>', '👍👍', '👍 x', 7, null, '1']) assert.ok(!isEmoji(e), String(e));
  assert.ok(store().toggle({ chat: 'lead', ts: 1, emoji: '<img>', by: 'owner' }).error);
  assert.ok(store().toggle({ chat: 'lead', ts: 'x', emoji: '👍', by: 'owner' }).error);
});

test('finds the newest message, or the newest with those words, skipping tools and system lines', () => {
  const ev = [{ k: 'say', text: 'Deploy done', ts: 1 }, { k: 'user', from: 'owner', text: 'nice one', ts: 2 }, { k: 'say', text: 'later', ts: 3 }, { k: 'user', from: 'harness', text: 'Wake', ts: 4 }, { k: 'tool', ts: 5 }];
  assert.equal(findMessage(ev).ts, 3);
  assert.equal(findMessage(ev, 'NICE').ts, 2);
  assert.equal(findMessage(ev, 'absent'), undefined);
});

test('the store stops growing', () => {
  const f = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-')) + '/r.json';
  fs.writeFileSync(f, JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`lead:${i + 1}`, [{ emoji: '👍', by: 'owner' }]]))));
  const s = createReactions(f); s.toggle({ chat: 'lead', ts: 9999, emoji: '👍', by: 'owner' });
  const all = s.all(); assert.equal(Object.keys(all).length, 5000); assert.ok(!all['lead:1']); assert.ok(all['lead:9999']);
});

test('off refuses new reactions, and who reacted never comes from a squiggle-controlled field', () => {
  const s = src('server.mjs'), route = s.slice(s.indexOf("'/api/react' && req.method === 'POST'"), s.indexOf("if (url.pathname === '/api/react') return"));
  assert.ok(route.indexOf("reactions === 'off'") < route.indexOf('reactions.toggle'));
  assert.match(route, /w = await whoSent\(req, b\.human\)[\s\S]*by = c \|\| w\.human \|\| .owner./);
  assert.doesNotMatch(route, /b\.by/);
});

test('a plain squiggle cannot flip the toggle; UI and CLI both can reach it', () => {
  assert.equal(roomRefusal({ action: 'reactions', caller: 'ann', page: true })?.status, 403);
  assert.equal(roomRefusal({ action: 'reactions', caller: 'lead', lead: true }), null);
  const s = src('server.mjs');
  assert.ok(s.indexOf('roomRefusal({') < s.indexOf("b.action === 'reactions'"), 'gated before it acts');
  assert.match(src('bin/agents.mjs'), /a\[0\] === 'reactions'/);
  assert.match(src('ui/index.html'), /id="reactOn"/);
  assert.match(src('ui/settings.js'), /action: 'reactions'/);
  assert.match(src('ui/room.js'), /case 'reactions': rxPower/);
});
