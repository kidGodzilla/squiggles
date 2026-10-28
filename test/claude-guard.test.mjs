import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, withHook, HOOK_CMD, MATCHER } from '../claude/guard.mjs';

const H = os.homedir(), W = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-guard-'));
const ev = (tool_name, tool_input, cwd = W) => ({ tool_name, tool_input, cwd });
const SSH = path.join(H, '.ssh');

test('claude guard: Bash, Grep and Glob fenced from ~/.ssh and the three folders', () => {
  assert.match(check(ev('Bash', { command: `cat ${SSH}/id_ed25519` })), /\.ssh/);
  assert.match(check(ev('Bash', { command: 'cd ~ && ls Downloads' })), /Downloads/);
  assert.match(check(ev('Grep', { pattern: 'x', path: SSH })), /\.ssh/);
  assert.match(check(ev('Grep', { pattern: 'x' }, H)), /recursive/, 'a search from home reaches every fenced folder');
  assert.match(check(ev('Grep', { pattern: 'x', path: H, glob: 'Doc*/**' })), /./);
  assert.match(check(ev('Glob', { pattern: '.s*/*', path: H })), /\.ssh/);
  assert.match(check(ev('Glob', { pattern: '*', path: '~/Desktop' })), /Desktop/);
  assert.match(check(ev('Bash', { command: 'git push origin main' })), /push/);
  // An absolute or ~ pattern with no path keeps its root.
  assert.match(check(ev('Glob', { pattern: path.join(SSH, '*') })), /\.ssh/);
  assert.match(check(ev('Glob', { pattern: path.join(H, 'Downloads', '**', '*') })), /Downloads/);
  assert.match(check(ev('Glob', { pattern: '~/.ssh/*' })), /\.ssh/);
  assert.match(check(ev('Grep', { pattern: 'x', path: W, glob: path.join(SSH, '*') })), /\.ssh/);
});

test('claude guard: ordinary work passes', () => {
  assert.equal(check(ev('Bash', { command: 'git status && ls', description: 'Read ~/Downloads? no, just status' })), '', 'the description is not a command');
  assert.equal(check(ev('Grep', { pattern: 'Downloads', path: W })), '', 'the word is a pattern, not a path');
  assert.equal(check(ev('Glob', { pattern: '**/*.md' })), '');
  assert.equal(check(ev('Read', { file_path: path.join(SSH, 'config') })), '', '--disallowedTools covers Read');
});

test('claude guard: merged into own settings; the hook script blocks with exit 2 and fails closed', () => {
  const s = withHook({ autoMode: { allow: ['x'] }, hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [] }] } });
  assert.deepEqual(s.autoMode, { allow: ['x'] }); assert.equal(s.hooks.PreToolUse.length, 2);
  assert.equal(s.hooks.PreToolUse[1].matcher, MATCHER); assert.equal(s.hooks.PreToolUse[1].hooks[0].command, JSON.stringify(HOOK_CMD));
  const run = (input) => { try { execFileSync(HOOK_CMD, { input, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTS_NODE: process.execPath } }); return 0; } catch (e) { return e.status; } };
  assert.equal(run(JSON.stringify(ev('Bash', { command: `ls ${SSH}` }))), 2);
  assert.equal(run(JSON.stringify(ev('Bash', { command: 'ls' }))), 0);
  assert.equal(run('not json'), 2);
  // A guard that can't even start blocks too: Claude treats any exit but 2 as allow.
  try { execFileSync(HOOK_CMD, { input: '{}', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTS_NODE: '/nonexistent/node' } }); assert.fail('allowed'); } catch (e) { assert.equal(e.status, 2); assert.match(String(e.stderr), /refused/); }
  fs.rmSync(W, { recursive: true, force: true });
});
