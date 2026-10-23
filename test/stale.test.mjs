import test from 'node:test'; import assert from 'node:assert/strict';
import { dropStale } from '../stale.mjs';

const asks = { a14: 'ran', a15: 'pending', a9: 'denied' }, tasks = { t100: 'done', t200: 'review', t300: 'doing' };
const drop = (text) => dropStale(text, { ask: (id) => asks[id], task: (id) => tasks[id] });

test('drops lines sending the user to a finished ask', () => {
  const r = drop('Fix is in.\nPress Run on a14 when you can.\n- approve a9\nNext: run a15.');
  assert.equal(r.text, 'Fix is in.\nNext: run a15.');
  assert.deepEqual(r.dropped, ['Press Run on a14 when you can.', '- approve a9']);
});

test('drops Merge lines for tasks not in review, keeps live ones', () => {
  const r = drop('Press Merge on t100.\nPress Merge on t200.\nmerge t300 next\nt100 merged fine.');
  assert.equal(r.text, 'Press Merge on t200.\nt100 merged fine.');
});

test('keeps mixed, unknown and non-action lines', () => {
  const keep = 'Press Run on a14 and a15.\nPress Run on a99.\na14 ran: 3 files.\nt100 merged; press Run on a15.\nPress Merge on t200 after t100.';
  assert.deepEqual(drop(keep), { text: keep, dropped: [] });
});
