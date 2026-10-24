import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPicks, describePicks } from '../picks.mjs';

const fresh = (t = { v: 1000 }) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picks-')); return { dir, t, p: createPicks({ file: path.join(dir, 'picks.json'), now: () => t.v }) }; };

test('ask, pick by number or label, then it leaves the open list', () => {
  const { dir, p } = fresh();
  const a = p.ask({ by: 'ux', question: 'Which header?', options: ['Tall', { label: 'Short', image: '/tmp/short.png' }], task: 't9' });
  assert.equal(a.id, 'p1'); assert.equal(a.options[1].image, '/tmp/short.png');
  const b = p.ask({ by: 'seo', question: 'Title?', options: ['A', 'B', 'C'] });
  assert.deepEqual(p.list().map((x) => x.id), ['p1', 'p2']);
  assert.equal(p.pick('p1', '2').answer, 'Short');
  assert.equal(p.pick(b.id, 'c', { by: 'lead' }).answer, 'C');
  assert.deepEqual(p.list(), []);
  assert.equal(p.list({ all: true }).length, 2);
  assert.throws(() => p.pick('p1', '1'), /already picked/);
  assert.match(describePicks(p.list({ all: true })), /picked: Short/);
  fs.rmSync(dir, { recursive: true });
});

test('bad picks are refused; answered ones drop off after a week', () => {
  const { dir, p, t } = fresh();
  assert.throws(() => p.ask({ by: 'ux', question: 'Q', options: ['only'] }), /2 to 6/);
  assert.throws(() => p.ask({ by: 'ux', question: 'Q', options: ['a', 'A'] }), /differ/);
  assert.throws(() => p.ask({ by: 'ux', question: 'Q', options: ['a', { label: 'b', image: 'rel.png' }] }), /absolute/);
  const a = p.ask({ by: 'ux', question: 'Q', options: ['a', 'b'] });
  assert.throws(() => p.pick(a.id, '3'), /options for p1: 1 a, 2 b/);
  p.drop(a.id, { by: 'ux' });
  for (let i = 0; i < 5; i++) p.ask({ by: 'ux', question: `Q${i}`, options: ['a', 'b'] });
  assert.throws(() => p.ask({ by: 'ux', question: 'one more', options: ['a', 'b'] }), /5 open picks/);
  t.v += 8 * 864e5; p.ask({ by: 'seo', question: 'later', options: ['a', 'b'] });
  assert.ok(!p.list({ all: true }).some((x) => x.id === a.id));
  fs.rmSync(dir, { recursive: true });
});
