import test from 'node:test'; import assert from 'node:assert/strict';
import { reportHoldMs, QUIET_MS } from '../focus.mjs';

test('team reports wait while the user talked to the lead in the last 15 minutes', () => {
  const now = 1e12;
  assert.equal(reportHoldMs(undefined, now), 0);
  assert.equal(reportHoldMs(now - QUIET_MS - 1, now), 0);
  assert.equal(reportHoldMs(now - 60e3, now), QUIET_MS - 60e3);
  assert.equal(reportHoldMs(now, now), QUIET_MS);
});
