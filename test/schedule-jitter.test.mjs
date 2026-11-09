// Cadences inside the 1h prompt cache never jitter later than their period (a late wake finds the cache gone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchedule } from '../schedule.mjs';

const at = (every, r) => { let i = 0; const seq = [0, 0, r]; const due = createSchedule({ now: () => 0, rand: () => seq[Math.min(i++, 2)] }); return due('x', every, 1e12) - 1e12; };

test('hourly and shorter cadences only jitter earlier', () => {
  for (const every of [15, 30, 60]) {
    assert.equal(at(every, 0.999) <= every * 60000, true, `${every}m late`);
    assert.equal(at(every, 0) >= every * 60000 - Math.max(0.1 * every * 60000, 60000), true, `${every}m too early`);
    assert.notEqual(at(every, 0), at(every, 0.999), `${every}m still spread`);
  }
});

test('longer cadences keep jitter both ways', () => {
  assert.equal(at(120, 0.999) > 120 * 60000, true);
  assert.equal(at(120, 0) < 120 * 60000, true);
});
