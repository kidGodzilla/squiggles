import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quietSig, skipWake, QUIET_MAX_MS, alwaysWakes, ownEnd } from '../quiet.mjs';

const T = [{ id: 't1', owner: 'ann', status: 'todo', title: 'a' }, { id: 't2', owner: 'bo', status: 'doing', title: 'b' }, { id: 't3', owner: 'ann', status: 'done', title: 'c' }];
const now = Date.parse('2026-11-01T20:00:00Z'), ago = (h) => new Date(now - h * 3600e3).toISOString();

test('signature moves only with what the squiggle would act on', () => {
  const base = quietSig('ann', T, 'charter');
  assert.equal(quietSig('ann', [...T].reverse(), 'charter'), base); // order
  assert.equal(quietSig('ann', T.map((t) => (t.id === 't2' ? { ...t, note: 'x' } : t)), 'charter'), base); // someone else's note
  assert.equal(quietSig('ann', T.map((t) => (t.id === 't3' ? { ...t, note: 'x' } : t)), 'charter'), base); // a done note
  assert.notEqual(quietSig('ann', T.map((t) => (t.id === 't1' ? { ...t, note: 'x' } : t)), 'charter'), base);
  assert.notEqual(quietSig('ann', T.map((t) => (t.id === 't1' ? { ...t, status: 'doing' } : t)), 'charter'), base);
  assert.notEqual(quietSig('ann', [...T, { id: 't4', owner: 'ann', status: 'todo', title: 'new' }], 'charter'), base);
  assert.notEqual(quietSig('ann', [...T, { id: 't5', kind: 'suggestion', by: 'ann', untold: true, decision: 'accepted' }], 'charter'), base);
  assert.notEqual(quietSig('ann', T, 'charter v2'), base);
});

test('skip only after IDLE or WAITING, unchanged, within the backstop', () => {
  const sig = quietSig('ann', T, 'c'), r = (o) => ({ endStatus: 'idle', quietSig: sig, lastWake: ago(1), ...o });
  assert.equal(skipWake(r(), sig, now), true);
  assert.equal(skipWake(r({ endStatus: 'waiting' }), sig, now), true);
  for (const endStatus of ['done', 'blocked', 'rethink', 'error', '', undefined]) assert.equal(skipWake(r({ endStatus }), sig, now), false);
  assert.equal(skipWake(r(), 'other', now), false);
  assert.equal(skipWake(r({ quietSig: '' }), '', now), false);
  assert.equal(skipWake(r({ lastWake: ago(QUIET_MAX_MS / 3600e3) }), sig, now), false);
  assert.equal(skipWake(r({ lastWake: undefined }), sig, now), false);
});

test('always-wake is per squiggle, off by default', () => {
  assert.equal(alwaysWakes({ id: 'ann' }), false); assert.equal(alwaysWakes({ id: 'ann', alwaysWake: true }), true);
});

test('own end: Claude success and plain ends count; errors, caps, limits and stops do not', () => {
  assert.equal(ownEnd(false, 'success', false), true); assert.equal(ownEnd(false, undefined, undefined), true);
  for (const sub of ['error_max_turns', 'interrupted', 'provider_limit', 'capacity']) assert.equal(ownEnd(false, sub, false), false);
  assert.equal(ownEnd(true, 'success', false), false); assert.equal(ownEnd(false, 'success', true), false);
});
