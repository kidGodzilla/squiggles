import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkModelEffort, DEFAULT_MODELS } from '../models.mjs';
import { KEYS, limitOf } from '../slots.mjs';
import { DEFAULTS } from '../config.mjs';
import { check } from '../cursor/guard.mjs';
import { install, fenced, GUARD } from '../cursor/install.mjs';

test('Cursor is off until config.cursor names models; a squiggle may use them, team defaults may not; own slot', () => {
  assert.deepEqual(DEFAULTS.cursor, []);
  assert.throws(() => checkModelEffort({ model: 'composer-x' }));
  assert.doesNotThrow(() => checkModelEffort({ model: 'composer-x' }, ['composer-x']));
  assert.ok(!DEFAULT_MODELS.includes('composer-x'));
  assert.ok(KEYS.includes('cursor')); assert.equal(limitOf({}, 'cursor'), 4);
});

test('Cursor fence blocks Downloads, Desktop and Documents; stays out of the way outside a squiggle', () => {
  const H = os.homedir();
  assert.ok(check({ tool_name: 'Read', tool_input: { file_path: `${H}/Downloads/x.zip` }, workspace_roots: ['/tmp/w'] }));
  assert.ok(check({ tool_name: 'Shell', tool_input: { command: 'ls ~/Desktop', cwd: '/tmp/w' }, cwd: '/tmp/w' }));
  assert.ok(check({ tool_name: 'Read', tool_input: { file_path: 'x' }, workspace_roots: [`${H}/Documents`] }));
  assert.ok(!check({ tool_name: 'Shell', tool_input: { command: 'echo ok', cwd: '/tmp/w' }, cwd: '/tmp/w' }));
  const run = (input, env) => spawnSync(GUARD, { input, env: { PATH: process.env.PATH, AGENTS_NODE: process.execPath, ...env }, encoding: 'utf8' });
  const bad = JSON.stringify({ tool_input: { command: 'cat ~/Downloads/a' }, cwd: '/tmp' });
  assert.equal(run(bad, {}).stdout.trim(), '{}'); // outside a squiggle: no decision, your own Cursor keeps its prompts
  const r = run(bad, { AGENTS_ID: 'c' }); assert.equal(r.status, 2); assert.match(r.stderr, /off limits/);
  assert.equal(run(JSON.stringify({ tool_input: { command: 'echo ok' }, cwd: '/tmp' }), { AGENTS_ID: 'c' }).stdout, '{"permission":"allow"}');
  assert.equal(run('not json', { AGENTS_ID: 'c' }).status, 2);
});

test('install adds the fence once and keeps existing hooks', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cur-')), f = path.join(d, '.cursor', 'hooks.json');
  assert.ok(!fenced(f)); assert.ok(install(f)); assert.ok(fenced(f)); assert.ok(!install(f));
  fs.writeFileSync(f, JSON.stringify({ version: 1, hooks: { stop: [{ command: 'x' }], preToolUse: [{ command: 'y' }] } }));
  assert.ok(install(f)); const j = JSON.parse(fs.readFileSync(f));
  assert.deepEqual(j.hooks.stop, [{ command: 'x' }]); assert.equal(j.hooks.preToolUse.length, 2); assert.ok(fenced(f));
  fs.rmSync(d, { recursive: true });
});
