// The emoji pack in reactions. A :name: counts only if the pack has it, and the page draws it as an image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReactions, isEmoji, packNames } from '../reactions.mjs';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const dir = new URL('../ui/emoji/', import.meta.url);

test('a :name: from the pack is an emoji; anything else that looks like one is not', () => {
  for (const e of [':blobbee_hug_heart:', ':neobread_uwu:', ':neocat_hug_bee:']) assert.ok(isEmoji(e), e);
  for (const e of [':nope:', '::', ':blobbee_hug_heart', 'blobbee_hug_heart', ':../room:', ':BLOBBEE_HUG:', ':blobbee_hug: :blobbee_hug:']) assert.ok(!isEmoji(e), e);
  assert.ok(isEmoji('👍'), 'Unicode still works');
});

test('every pack file fits a reaction and a url, and all of them pass', () => {
  const names = packNames();
  assert.equal(names.length, 320);
  for (const n of names) { assert.match(n, /^[a-z0-9_]+$/); assert.ok(isEmoji(`:${n}:`), n); }
});

test('a pack reaction toggles like any other', () => {
  const r = createReactions(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rx-')), 'reactions.json')), m = { chat: 'lead', ts: 1, emoji: ':blobbee_uwu:', by: 'owner' };
  assert.deepEqual(r.toggle(m).list, [{ emoji: ':blobbee_uwu:', by: 'owner' }]);
  assert.deepEqual(r.toggle(m).list, []);
  assert.ok(r.toggle({ ...m, emoji: ':nope:' }).error);
});

test('no pack file can run anything or reach out, even opened directly', () => {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
    const s = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(s, /<script|<foreignObject|\son\w+=/i, f);
    for (const [, v] of s.matchAll(/(?:href|src)="([^"]*)"/gi)) assert.match(v, /^(#|data:image\/png;base64,)/, f);
  }
});

test('the credits name every author, and the folder carries its own licence', () => {
  const c = fs.readFileSync(new URL('CREDITS.md', dir), 'utf8');
  for (const w of ['olivvybee', 'volpeon', 'moonrabbits', 'wep', 'symtrkl', 'Twemoji', 'CC-BY-NC-SA', 'LICENSE.md', 'Apache-2.0']) assert.ok(c.includes(w), w);
  assert.match(fs.readFileSync(new URL('LICENSE.md', dir), 'utf8'), /^Attribution-NonCommercial-ShareAlike 4\.0 International/);
  assert.match(src('THIRD-PARTY-NOTICES.md'), /ui\/emoji\/CREDITS\.md/);
  assert.match(src('ui/room.js'), /\/ui\/emoji\/CREDITS\.md/, 'the picker links them');
  assert.match(src('README.md'), /Apache-2\.0 doesn't cover the emoji pack in `ui\/emoji`.*CC-BY-NC-SA/, 'the README says the repo licence stops there');
});

test('the picker\'s cuddly row is all real pack names', () => {
  const row = src('ui/room.js').match(/const RX_CUDDLY = '([^']+)'/)?.[1].split(' ');
  assert.ok(row?.length >= 12);
  for (const n of row) assert.ok(packNames().includes(n), n);
});

test('page, CLI and prompt all reach the pack', () => {
  const s = src('server.mjs');
  assert.ok(s.indexOf("p[1] === 'emoji'") > 0 && s.indexOf("p[1] === 'emoji'") < s.indexOf("if (p[0] === 'ui') return"), 'own route, before the flat ui one');
  assert.match(s, /pack: packNames\(\)/);
  assert.match(src('bin/agents.mjs'), /emojis: async/);
  assert.match(src('prompts/squiggle.md'), /`emojis \[query\]`/);
});
