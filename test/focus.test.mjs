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

test('away 30 minutes, reports go at most once an hour as one batch', async () => {
  const { AWAY_MS, AWAY_EVERY_MS, away } = await import('../focus.mjs');
  const now = 1e12, gone = now - AWAY_MS;
  assert.equal(reportHoldMs(gone, now, now - 10 * 60e3), AWAY_EVERY_MS - 10 * 60e3);
  assert.equal(reportHoldMs(gone, now, now - AWAY_EVERY_MS), 0);
  assert.equal(reportHoldMs(undefined, now, now - 60e3), AWAY_EVERY_MS - 60e3); // never talked: away
  assert.equal(reportHoldMs(undefined, now), 0); // first batch goes
  assert.equal(reportHoldMs(now - 20 * 60e3, now, now - 60e3), 0); // quiet but not away: as before
  assert.ok(away(gone, now)); assert.ok(!away(now - 20 * 60e3, now));
});

test('an away batch asks for a bare Handled. and still unpacks after a restart', async () => {
  const { reportsText, reportLines } = await import('../focus.mjs');
  const t = reportsText(['[Ann · DONE] a'], 'Sam', true);
  assert.match(t, /Sam is away/); assert.match(t, /"Handled\."/);
  assert.deepEqual(reportLines(t, 'Sam'), ['[Ann · DONE] a']);
  assert.match(reportsText(['x'], 'the user', true), /The user is away/);
  assert.doesNotMatch(reportsText(['x'], 'Sam'), /away/);
});
