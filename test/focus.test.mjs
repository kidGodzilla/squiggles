import test from 'node:test'; import assert from 'node:assert/strict';
import { reportHoldMs, QUIET_MS } from '../focus.mjs';

test('team reports wait while the user talked to the lead in the last 15 minutes', () => {
  const now = 1e12;
  assert.equal(reportHoldMs(undefined, now), 0);
  assert.equal(reportHoldMs(now - QUIET_MS - 1, now), 0);
  assert.equal(reportHoldMs(now - 60e3, now), QUIET_MS - 60e3);
  assert.equal(reportHoldMs(now, now), QUIET_MS);
});

test('a held Team reports turn unpacks back into inbox lines', async () => {
  const { reportsText, reportLines } = await import('../focus.mjs');
  assert.deepEqual(reportLines(reportsText(['[Ann · DONE] a', '[Bo · DONE] b'], 'Sam'), 'Sam'), ['[Ann · DONE] a\n[Bo · DONE] b']);
  assert.equal(reportLines('Wake (scheduled) ...', 'Sam'), null);
});
