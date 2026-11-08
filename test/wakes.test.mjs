// Wake times and work windows instead of every N minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWakes, wakeDue } from '../schedule.mjs';

const t = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime(); // November 2026: the 9th is a Monday
const w = (s, o) => wakeDue(parseWakes(s), o);

test('parses times, windows and weekdays; rejects the rest', () => {
  assert.deepEqual(parseWakes('9:00, 13:30, weekdays 17-18'), [{ weekdays: false, from: 540, to: null }, { weekdays: false, from: 810, to: null }, { weekdays: true, from: 1020, to: 1080 }]);
  assert.equal(parseWakes(''), null);
  for (const bad of ['25:00', '9:00-8:00', 'noon', '9-10-11', '9:00-']) assert.throws(() => parseWakes(bad), /wakes:/, bad);
});

test('three a day: the next set time after the last wake', () => {
  assert.equal(w('9:00, 13:00, 17:00', { last: t(9, 9, 2) }), t(9, 13));
  assert.equal(w('9:00, 13:00, 17:00', { last: t(9, 17, 5) }), t(10, 9));
});

test('a window starts at its start and keeps going while wakes end DONE', () => {
  assert.equal(w('9:00-11:00', { last: t(8, 9, 30) , lastEnd: t(8, 10), endStatus: 'idle' }), t(9, 9));
  assert.equal(w('9:00-11:00', { last: t(9, 9), lastEnd: t(9, 9, 40), endStatus: 'done' }), t(9, 9, 41));
});

test('IDLE, a skip or a DEFER closes the window until tomorrow; so does running past its end', () => {
  assert.equal(w('9:00-11:00', { last: t(9, 9, 41), lastEnd: t(9, 9, 50), endStatus: 'idle' }), t(10, 9));
  assert.equal(w('9:00-11:00', { last: t(9, 10, 30), lastEnd: t(9, 10, 59, 30), endStatus: 'done' }), t(10, 9));
});

test('weekdays skips Saturday and Sunday', () => {
  assert.equal(w('weekdays 9:00', { last: t(13, 9, 5) }), t(16, 9)); // Friday → Monday
});
