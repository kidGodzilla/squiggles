import test from 'node:test';
import assert from 'node:assert/strict';
import { compactAtEnd, ctxOf, COMPACT_MIN_CTX } from '../compact.mjs';

const now = 1e12, base = { claude: true, lead: false, alive: true, own: true, ctx: 60000, now };

test('an idle, waiting or blocked end compacts', () => {
  for (const endStatus of ['idle', 'waiting', 'blocked']) assert.equal(compactAtEnd({ ...base, endStatus, nextDue: now + 5 * 60000 }), true, endStatus);
});

test('a done end compacts only when the next wake is past the cache', () => {
  assert.equal(compactAtEnd({ ...base, endStatus: 'done', nextDue: now + 40 * 60000 }), false);
  assert.equal(compactAtEnd({ ...base, endStatus: 'done', nextDue: now + 90 * 60000 }), true);
  assert.equal(compactAtEnd({ ...base, endStatus: 'done', nextDue: null }), true);
  assert.equal(compactAtEnd({ ...base, endStatus: 'done', nextDue: Infinity }), true);
  assert.equal(compactAtEnd({ ...base, endStatus: 'done', nextDue: now + 60000 }), false); // a work window chaining the next wake
});

test('never for the lead, other providers, a dead process, an error end or a small context', () => {
  const x = { ...base, endStatus: 'idle', nextDue: null };
  assert.equal(compactAtEnd({ ...x, lead: true }), false);
  assert.equal(compactAtEnd({ ...x, claude: false }), false);
  assert.equal(compactAtEnd({ ...x, alive: false }), false);
  assert.equal(compactAtEnd({ ...x, own: false }), false);
  assert.equal(compactAtEnd({ ...x, ctx: COMPACT_MIN_CTX }), false);
  assert.equal(compactAtEnd({ ...x, ctx: undefined }), false);
});

test('ctxOf adds every input on the call', () => {
  assert.equal(ctxOf({ input_tokens: 3, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000, output_tokens: 99 }), 42003);
  assert.equal(ctxOf(undefined), 0);
});
