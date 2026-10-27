// a wake that starts 15+ minutes after it was due says so; the time is the real start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeToken, stampWake } from '../schedule.mjs';

const due = new Date(2026, 9, 26, 23, 40).getTime();
const text = `Wake (scheduled), ${wakeToken(due)}. Read your charter.`;

test('on time: just the start time', () => {
  const t = due + 14 * 60000;
  assert.equal(stampWake(text, t), `Wake (scheduled), ${new Date(t).toLocaleString()}. Read your charter.`);
});

test('15+ min late: start time, minutes late and the due time', () => {
  const t = due + 50 * 60000, out = stampWake(text, t);
  assert.ok(out.startsWith(`Wake (scheduled), ${new Date(t).toLocaleString()}, 50 min late (due 11:40`), out);
  assert.ok(!out.includes('⟨'));
});

test('no due (asked wakes) and plain messages', () => {
  assert.equal(stampWake(`Wake (asked), ${wakeToken()}.`, due), `Wake (asked), ${new Date(due).toLocaleString()}.`);
  assert.equal(stampWake('From You: hi', due), 'From You: hi');
});
