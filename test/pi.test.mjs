import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { checkModelEffort, DEFAULT_MODELS } from '../models.mjs';
import { KEYS, slotKey, limitOf } from '../slots.mjs';
import { DEFAULTS } from '../config.mjs';
import guard from '../pi/guard.ts';

test('Pi is off until config.pi names models; then a squiggle may use them, team defaults may not', () => {
  assert.deepEqual(DEFAULTS.pi, []);
  assert.throws(() => checkModelEffort({ model: 'acme/model-1' }));
  assert.doesNotThrow(() => checkModelEffort({ model: 'acme/model-1' }, ['acme/model-1']));
  assert.throws(() => checkModelEffort({ model: 'acme/other' }, ['acme/model-1']));
  assert.ok(!DEFAULT_MODELS.includes('acme/model-1'));
});

test('Pi turns have their own slot', () => {
  assert.ok(KEYS.includes('pi'));
  assert.equal(slotKey('pi'), 'pi');
  assert.equal(limitOf({}, 'pi'), 4);
  assert.equal(limitOf({ slots: { pi: 1 } }, 'pi'), 1);
});

test('pi/guard.ts fences Downloads, Desktop and Documents', async () => {
  let h; guard({ on: (ev, fn) => { assert.equal(ev, 'tool_call'); h = fn; } });
  const H = os.homedir();
  const blocked = async (toolName, input) => !!(await h({ toolName, input }))?.block;
  assert.equal(await blocked('read', { path: path.join(H, 'Downloads', 'a.txt') }), true);
  assert.equal(await blocked('write', { path: '~/Desktop/x' }), true);
  assert.equal(await blocked('ls', { path: '~/Documents' }), true);
  assert.equal(await blocked('bash', { command: 'cat ~/Documents/x' }), true);
  assert.equal(await blocked('bash', { command: `ls ${H}/Downloads` }), true);
  assert.equal(await blocked('read', { path: path.join(H, 'DownloadsArchive', 'a') }), false);
  assert.equal(await blocked('read', { path: '/tmp/x' }), false);
  assert.equal(await blocked('bash', { command: 'git status' }), false);
});
