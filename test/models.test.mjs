import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFor, DEFAULT_MODELS } from '../models.mjs';

const BELOW = ['fable', 'claude-fable-5-1', 'haiku', 'claude-haiku-5-5', 'claude-sonnet-4-5', 'claude-opus-4-1'];

test('modelFor never launches Fable or anything below Sonnet 5.5', () => {
  for (const m of [undefined, '', 'opus', 'claude-opus-5-5', 'fable', 'claude-fable-5-1', 'gpt-6.1-sol']) assert.equal(modelFor({ model: m }), 'claude-opus-5-5', m);
  for (const m of ['sonnet', 'claude-sonnet-5-5', 'haiku', 'claude-haiku-5-5']) assert.equal(modelFor({ model: m }), 'claude-sonnet-5-5', m);
});

test('team defaults (t898) allow only default, Opus, Sonnet or Codex', () => {
  assert.deepEqual(DEFAULT_MODELS, ['', 'opus', 'sonnet', 'gpt-6.1-sol']);
  for (const m of BELOW) assert.ok(!DEFAULT_MODELS.includes(m), m);
  for (const m of DEFAULT_MODELS) assert.match(modelFor({ model: m }), /^claude-(opus|sonnet)-5-5$/);
});
