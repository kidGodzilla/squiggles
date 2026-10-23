import test from 'node:test'; import assert from 'node:assert/strict';
import { holdGate } from '../hold.mjs';

test('the user is held at most the cap, timed from their first held message', () => {
  const h = holdGate({ cap: 120, off: 600 });
  assert.equal(h.holding(0), true);
  assert.equal(h.held(0), 120);
  assert.equal(h.held(100), 20);
  assert.equal(h.held(500), 0);
});

test('after release nothing is held for the off window, then holding resumes from scratch', () => {
  const h = holdGate({ cap: 120, off: 600 });
  h.held(0); h.release(130);
  assert.equal(h.holding(200), false);
  assert.equal(h.holding(730), true);
  assert.equal(h.held(730), 120);
});

test('reset holds again at once', () => {
  const h = holdGate({ cap: 120, off: 600 });
  h.release(0); h.reset();
  assert.equal(h.holding(1), true);
});
