import test from 'node:test';
import assert from 'node:assert/strict';
import { ownIdeas } from '../board.mjs';

test('proactive: done this wake, filed by the squiggle itself', () => {
  const since = '2026-10-24T10:00:00.000Z', at = Date.parse(since);
  const tasks = [
    { id: 't1', owner: 'ux', by: 'ux', status: 'done', finishedAt: at + 5 },
    { id: 't2', owner: 'ux', by: 'lead', status: 'done', finishedAt: at + 5 }, // assigned by the lead
    { id: 't3', owner: 'ux', by: 'ux', status: 'done', finishedAt: at - 5 }, // an earlier wake
    { id: 't4', owner: 'ux', by: 'ux', status: 'doing' },
    { id: 't5', owner: 'seo', by: 'seo', status: 'done', finishedAt: at + 5 },
  ];
  assert.deepEqual(ownIdeas(tasks, 'ux', since), ['t1']);
  assert.deepEqual(ownIdeas(tasks, 'ops', since), []);
});
