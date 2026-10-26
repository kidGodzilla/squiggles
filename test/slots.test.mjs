import test from 'node:test'; import assert from 'node:assert/strict';
import { slotKey, rankOf, limitOf, enqueue, next, checkSlots, drain, leave, DEFAULT_SLOTS } from '../slots.mjs';

test('Claude has no provider name; it gets its own slot key', () => {
  assert.equal(slotKey(''), 'claude'); assert.equal(slotKey('codex'), 'codex');
});

test('zero or junk means no cap', () => {
  assert.equal(limitOf({ slots: { codex: 0 } }, 'codex'), 0);
  assert.equal(limitOf({ slots: { codex: 'x' } }, 'codex'), 0); assert.equal(limitOf({ slots: { codex: 2 } }, 'codex'), 2);
  assert.equal(limitOf({}, 'gpu'), 0);
});

test('you first, then the lead, then a squiggle, then the harness', () => {
  assert.deepEqual(['owner', 'lead', 'ana', 'harness'].map((f) => rankOf(f, 'lead')), [0, 1, 2, 3]);
});

test('next takes the best rank, then the longest wait, on that provider only', () => {
  const line = [
    { id: 'a', key: 'codex', rank: 3, at: 1 }, { id: 'b', key: 'codex', rank: 2, at: 5 },
    { id: 'c', key: 'codex', rank: 2, at: 3 }, { id: 'd', key: 'claude', rank: 0, at: 0 },
  ];
  assert.deepEqual([next(line, 'codex'), next(line, 'codex'), next(line, 'codex'), next(line, 'codex')].map((x) => x?.id), ['c', 'b', 'a', undefined]);
  assert.equal(line.length, 1);
});

test('a second message to a waiting squiggle joins its turn, keeping the earlier place and better rank', () => {
  const line = [];
  enqueue(line, { id: 'a', key: 'codex', rank: 3, at: 1, text: 'wake', from: 'harness' });
  enqueue(line, { id: 'a', key: 'codex', rank: 1, at: 9, text: 'from lead', from: 'lead', images: ['x.png'] });
  assert.equal(line.length, 1);
  assert.deepEqual(line[0], { id: 'a', key: 'codex', rank: 1, at: 1, text: 'wake\n\nfrom lead', from: 'lead', images: ['x.png'], human: undefined, asker: undefined });
});

test('checkSlots takes known providers and whole numbers; off clears', () => {
  assert.deepEqual(checkSlots({ codex: '2', claude: 'off' }), { codex: 2, claude: 0 });
  assert.throws(() => checkSlots({ gpu: 2 }), /provider/);
  assert.throws(() => checkSlots({ codex: 1.5 }), /whole number/);
  assert.throws(() => checkSlots({ codex: -1 }), /whole number/);
});

test('defaults cap every provider above one turn; 0 overrides to no cap; default resets', () => {
  assert.equal(limitOf({}, 'claude'), DEFAULT_SLOTS.claude);
  for (const k of ['claude', 'codex']) assert.ok(DEFAULT_SLOTS[k] > 1, k);
  assert.equal(limitOf({ slots: { claude: 0 } }, 'claude'), 0);
  assert.equal(limitOf({ slots: { claude: 3 } }, 'claude'), 3);
  assert.deepEqual(checkSlots({ claude: 'default', codex: '' }), { claude: null, codex: null });
});

test('drain starts waiting turns only while the provider has room, best first', () => {
  const busy = { claude: 1 }, started = [];
  const line = [{ id: 'a', key: 'claude', rank: 3, at: 1 }, { id: 'b', key: 'claude', rank: 2, at: 2 }, { id: 'c', key: 'claude', rank: 3, at: 3 }];
  drain(line, { limit: () => 2, busy: (k) => busy[k] || 0, start: (e) => { busy[e.key]++; started.push(e.id); } });
  assert.deepEqual(started, ['b']); assert.deepEqual(line.map((x) => x.id), ['a', 'c']);
  drain(line, { limit: () => 0, busy: () => 99, start: (e) => started.push(e.id) });
  assert.deepEqual(started, ['b', 'a', 'c'], 'no cap: everything starts'); assert.equal(line.length, 0);
});

test('drain drops gone squiggles and re-keys one whose model changed while it waited', () => {
  const line = [{ id: 'gone', key: 'claude', rank: 2, at: 1 }, { id: 'moved', key: 'claude', rank: 2, at: 2 }], started = [];
  drain(line, { limit: (k) => (k === 'claude' ? 1 : 5), busy: (k) => (k === 'claude' ? 1 : 0), keyOf: (e) => (e.id === 'moved' ? 'codex' : e.key), gone: (e) => e.id === 'gone', start: (e) => started.push(e) });
  assert.deepEqual(started.map((e) => [e.id, e.key]), [['moved', 'codex']]); assert.equal(line.length, 0);
});

test('leave takes a squiggle out of line', () => {
  const line = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
  assert.equal(leave(line, 'a'), 2); assert.deepEqual(line, [{ id: 'b' }]);
});
