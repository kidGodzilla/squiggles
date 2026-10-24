import test from 'node:test';
import assert from 'node:assert/strict';
import { trustLevel, trustOf, trustRules } from '../trust.mjs';

test('trust: medium by default, names normalised, junk refused', () => {
  assert.equal(trustOf({}), 'medium');
  assert.equal(trustOf({ trust: 'bogus' }), 'medium');
  assert.equal(trustLevel('Very high'), 'veryhigh');
  assert.equal(trustLevel('very-high'), 'veryhigh');
  assert.equal(trustLevel(''), null);
  assert.throws(() => trustLevel('max'), /low, medium, high, veryhigh/);
});

test('trust: each level has its own rules', () => {
  assert.match(trustRules({ trust: 'low' }), /never `task add`/);
  assert.match(trustRules({}), /Medium.*task add.*waits for approval/s);
  assert.match(trustRules({ trust: 'high' }), /task ship.*lead merges/s);
  assert.match(trustRules({ trust: 'veryhigh' }), /open goal, commit, merge and deploy/);
});
