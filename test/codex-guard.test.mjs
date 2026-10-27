// Codex squiggles had no fence; codex/guard.mjs runs as a PreToolUse hook on codex app-server.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { check } from '../codex/guard.mjs';
import { REASONS } from '../fence.mjs';

const H = os.homedir(), bash = (command) => check({ tool_name: 'Bash', tool_input: { command }, cwd: '/tmp/w' });
const patch = (body) => check({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` }, cwd: '/tmp/w' });

test('Codex shell: push, ~/.ssh and fenced folders blocked', () => {
  assert.equal(bash('git push origin HEAD:main'), REASONS.push);
  assert.equal(bash('cat ~/.ssh/id_ed25519'), REASONS.ssh);
  assert.equal(bash('cd ~ && ls Downloads/x'), REASONS.dirs);
  assert.equal(bash('git status --short'), '');
});

test('Codex apply_patch: files it touches are checked; contents are text', () => {
  assert.equal(patch(`*** Add File: ${H}/Downloads/x.txt\n+hi`), REASONS.dirs);
  assert.equal(patch('*** Update File: ../../../Users/x/a\n*** Move to: ~/.ssh/config'), REASONS.ssh);
  assert.equal(patch('*** Add File: notes.md\n+Run git push. Downloads and documents.'), '');
  assert.equal(patch('*** Add File: notes.md\n+see ~/Documents/plan'), REASONS.dirs);
});

test('Codex hook process: exit 2 with the reason, fails closed', () => {
  const run = (input) => spawnSync(process.execPath, [new URL('../codex/guard.mjs', import.meta.url).pathname], { input, encoding: 'utf8' });
  const r = run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: '/tmp' }));
  assert.equal(r.status, 2); assert.match(r.stderr, /git push/);
  assert.equal(run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/tmp' })).status, 0);
  assert.equal(run('not json').status, 2);
});

test('Codex hook config: fixed guard.sh command; trusted only when codex says so for that exact hook', async () => {
  const { hookConfig, hookTrusted, HOOK_CMD, HOOK_KEY } = await import('../codex/guard.mjs');
  assert.match(HOOK_CMD, /codex\/guard\.sh"$/);
  assert.ok(hookConfig().includes(JSON.stringify(HOOK_CMD)));
  const list = (h) => ({ data: [{ cwd: '/tmp', hooks: [{ key: HOOK_KEY, command: HOOK_CMD, enabled: true, trustStatus: 'trusted', ...h }] }] });
  assert.ok(hookTrusted(list({})));
  for (const h of [{ trustStatus: 'untrusted' }, { trustStatus: 'modified' }, { enabled: false }, { command: '"/tmp/evil.sh"' }]) assert.ok(!hookTrusted(list(h)), JSON.stringify(h));
  assert.ok(!hookTrusted({ data: [] })); assert.ok(!hookTrusted(undefined));
});
