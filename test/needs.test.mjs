// The Needs you list keeps only what waits on the user.
import test from 'node:test';
import assert from 'node:assert/strict';
import { needsList, describeNeeds } from '../needs.mjs';

test('needs: asks, open picks, shipped merges, blocked squiggles', () => {
  const l = needsList({
    asks: [{ id: 'a1', by: 'ops', cmd: 'ls', why: 'check', cwd: '/tmp' }],
    picks: [{ id: 'p1', by: 'ux', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], status: 'open' }, { id: 'p2', by: 'ux', question: 'Old', options: [], status: 'answered' }],
    merges: [
      { id: 't1', owner: 'apps', title: 'ready', shipped: [{ by: 'ux' }], needs: [{ t: 'x', done: true }] },
      { id: 't2', owner: 'apps', title: 'unreviewed' },
      { id: 't3', owner: 'apps', title: 'step open', shipped: [{ by: 'ux' }], needs: [{ t: 'x' }] },
      { id: 't4', owner: 'apps', title: 'conflicts', shipped: [{ by: 'ux' }], conflicts: ['a.js'] },
      { id: 't5', owner: 'apps', title: 'broken', shipped: [{ by: 'ux' }], error: 'no repo' },
    ],
    squiggles: [{ id: 'apps', status: 'blocked', note: 'needs a sign-in' }, { id: 'ops', status: 'blocked', paused: true }, { id: 'ux', status: 'idle' }],
  });
  assert.deepEqual(l.map((n) => `${n.kind}:${n.id}`), ['ask:a1', 'pick:p1', 'merge:t1', 'blocked:apps']);
  assert.deepEqual(l[1].options, ['A', 'B']);
  assert.match(describeNeeds(l), /Merge {2}t1 {2}apps {2}ready {2}\(shipped by ux\)/);
  assert.equal(describeNeeds([]), 'nothing needs you');
});
