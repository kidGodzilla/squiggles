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

test('needs: a serious alert note open 2 hours leads the list', () => {
  const now = 10 * 3600e3, h = 3600e3;
  const l = needsList({ now, squiggles: [{ id: 'apps', status: 'blocked', note: 'x' }], tasks: [
    { id: 't1', owner: 'logs', title: 'api 5xx storm', alert: 'serious', alertAt: now - 2 * h, status: 'doing' },
    { id: 't2', owner: 'logs', title: 'fresh', alert: 'serious', alertAt: now - h, status: 'todo' },
    { id: 't3', owner: 'logs', title: 'fixed', alert: 'serious', alertAt: now - 5 * h, status: 'done' },
    { id: 't4', owner: 'logs', title: 'minor', alert: 'normal', alertAt: now - 5 * h, status: 'todo' },
    { id: 't5', owner: 'logs', title: 'plain note', status: 'todo' },
  ] });
  assert.deepEqual(l.map((n) => `${n.kind}:${n.id}`), ['alert:t1', 'blocked:apps']);
  assert.match(describeNeeds(l), /^Alert {2}t1 {2}logs {2}api 5xx storm/);
});
