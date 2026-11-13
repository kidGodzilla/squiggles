// A branch named like an option (-D, --orphan) can exist through update-ref; the board must never hand it to git.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createBoard, badBranch } from '../board.mjs';

test('option-like branch names are refused at review, base, worktree and merge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brname-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a'), 'a'); g('add', 'a'); g('commit', '-q', '-m', 'a');
  g('checkout', '-q', '-b', 't1-ok'); fs.writeFileSync(path.join(repo, 'b'), 'b'); g('add', 'b'); g('commit', '-q', '-m', 'b'); g('checkout', '-q', 'main');
  g('update-ref', 'refs/heads/-D', 't1-ok'); g('update-ref', 'refs/heads/--orphan', 'main');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated', repos: [repo] }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'one', goal: 'g', status: 'doing' },
    { id: 't2', title: 'stored', goal: 'g', status: 'review', repo, branch: '-D' } ] }));
  const b = createBoard(dir, () => {}), ask = 'This change does a thing that matters and the user decides whether to merge it';
  assert.equal(badBranch('t1-ok'), false); assert.equal(badBranch('-D'), true); assert.equal(badBranch('a..b'), true);
  assert.throws(() => b.taskOp({ op: 'move', id: 't1', status: 'review', branch: '-D', ask }), /not a usable branch name/);
  assert.throws(() => b.taskOp({ op: 'move', id: 't1', status: 'review', branch: `${repo}:--orphan`, ask }), /not a usable branch name/);
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-ok', ask });
  assert.throws(() => b.taskOp({ op: 'base', id: 't1', branch: '--orphan' }), /not a usable branch name/);
  assert.throws(() => b.taskOp({ op: 'worktree', id: 't2' }), /not a usable branch name/);
  await assert.rejects(b.merge('t2', 'owner'), /not a usable branch name/);
  assert.ok(g('rev-parse', '--verify', 'refs/heads/-D').toString().trim(), 'the odd ref is untouched');
  fs.rmSync(dir, { recursive: true, force: true });
});
