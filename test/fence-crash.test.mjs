// A fence that crashes refuses. Hosts differ on a failed hook: Codex runs the tool on any exit but 2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandReason, privateReason } from '../fence.mjs';
import piGuard from '../pi/guard.ts';

const root = path.join(import.meta.dirname, '..'), env = { PATH: process.env.PATH, AGENTS_ID: 'c', AGENTS_NODE: process.execPath };
const GUARDS = ['claude/guard.sh', 'codex/guard.sh', 'cursor/guard.sh'].map((f) => path.join(root, f));
const MJS = ['claude', 'codex', 'cursor'].map((d) => path.join(root, d, 'guard.mjs'));
const key = ['~', '.ssh', 'id_rsa'].join('/');
const WORDS = { 'regex too large': 'a*'.repeat(20000), 'too many braces': '{a,b}'.repeat(8000) };
const call = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '/tmp' });
const hook = (f, input, e = env) => spawnSync(f, { input, env: e, encoding: 'utf8' });

for (const [name, w] of Object.entries(WORDS)) {
  test(`${name}: the fence reads on and refuses the fenced read after the word`, () => {
    for (const c of [`cat ${w} ${key}`, `ls /${w}/x; cat ${key}`]) assert.match(commandReason(c, '/tmp'), /off limits/);
    assert.doesNotThrow(() => commandReason(`cat ${w}`, '/tmp'));
  });
  test(`${name}: strict mode reads the word without a crash`, () => {
    const rules = { dirs: ['/tmp/private-x'], tools: [], remote: false };
    assert.doesNotThrow(() => privateReason('Bash', { command: `cat ${w}` }, '/tmp', os.homedir(), rules));
    assert.ok(privateReason('Bash', { command: `cat ${w} /tmp/private-x/a` }, '/tmp', os.homedir(), rules));
  });
  test(`${name}: the word and a fenced read exit 2 from the non-Claude guards`, () => {
    for (const f of GUARDS.slice(1)) { const r = hook(f, call(`cat ${w} ${key}`)); assert.equal(r.status, 2, f); assert.ok(r.stderr.trim(), f); }
  });
}
test('a throw in check() exits 2 with a reason, from every guard', () => {
  for (const f of [...GUARDS, ...MJS]) {
    const r = f.endsWith('.sh') ? hook(f, 'null') : spawnSync(process.execPath, [f], { input: 'null', env, encoding: 'utf8' });
    assert.equal(r.status, 2, f); assert.ok(r.stderr.trim(), f); // Codex lets exit 2 with empty stderr through
  }
});
test('a guard that cannot start at all exits 2 with a reason', () => {
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fence-crash-')), 'node');
  fs.writeFileSync(bad, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  try { for (const f of GUARDS) { const r = hook(f, call('ls'), { ...env, AGENTS_NODE: bad }); assert.equal(r.status, 2, f); assert.ok(r.stderr.trim(), f); } }
  finally { fs.rmSync(path.dirname(bad), { recursive: true }); }
});
test('the Pi guard refuses instead of throwing, and still fences', async () => {
  let on; piGuard({ on: (_, f) => { on = f; } });
  assert.equal((await on({ toolName: 'bash', input: { get command() { throw new Error('x'); } } }))?.block, true);
  assert.equal((await on({ toolName: 'bash', input: { command: `cat ${key}` } }))?.block, true);
  assert.equal(await on({ toolName: 'bash', input: { command: 'ls' } }), undefined);
});
test('ordinary calls still pass every guard', () => {
  for (const f of GUARDS) assert.equal(hook(f, call('ls')).status, 0, f);
});
