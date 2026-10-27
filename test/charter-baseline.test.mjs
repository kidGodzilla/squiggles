// A charter.md changed between turns (a leftover background job, or across a restart) is checked at the next turn's
// start against the last approved copy, which survives restarts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { charterStart } from '../trust.mjs';

test('charter baseline: between-turn edits are put back unless nothing was approved yet or it is the lead', () => {
  assert.equal(charterStart({ approved: 'a\n', disk: 'a\n' }), 'adopt');
  assert.equal(charterStart({ approved: 'a\n', disk: 'a' }), 'adopt');
  assert.equal(charterStart({ approved: null, disk: 'x\n' }), 'adopt');
  assert.equal(charterStart({ approved: undefined, disk: 'x\n' }), 'adopt');
  assert.equal(charterStart({ approved: 'a\n', disk: 'evil\n' }), 'revert');
  assert.equal(charterStart({ approved: 'a\n', disk: '' }), 'revert');
  assert.equal(charterStart({ approved: 'a\n', disk: 'evil\n', lead: true }), 'adopt');
});
