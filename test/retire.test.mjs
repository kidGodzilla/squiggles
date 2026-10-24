import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createBoard } from '../board.mjs';

// Done/drop saves first, then removes worktrees and merged branches off the event loop.
test('done and drop clean worktrees without blocking; dirty kept; reopened task untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-')), repo = path.join(dir, 'repo');
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env }).toString().trim();
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a'), 'a'); g('add', 'a'); g('commit', '-q', '-m', 'a');
  const wt = (b) => { const p = path.join(dir, b); g('worktree', 'add', '-q', '-b', b, p, 'main'); return p; };
  const [w1, w2, w3, w4] = ['b1', 'b2', 'b3', 'b4'].map(wt);
  fs.writeFileSync(path.join(w3, 'x'), 'dirty');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'open' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: ['b1', 'b2', 'b3', 'b4'].map((b, i) => ({ id: `t${i + 1}`, title: b, goal: 'g', status: 'doing', repo, branch: b, worktrees: [path.join(dir, b)] })) }));
  const b = createBoard(dir, () => {});
  let max = 0, last = Date.now(); const iv = setInterval(() => { const n = Date.now(); max = Math.max(max, n - last - 5); last = n; }, 5); iv.unref();
  const t0 = Date.now();
  b.taskOp({ op: 'move', id: 't1', status: 'done' });
  b.taskOp({ op: 'drop', id: 't2' });
  b.taskOp({ op: 'move', id: 't3', status: 'done' });
  b.taskOp({ op: 'move', id: 't4', status: 'done' }); b.taskOp({ op: 'move', id: 't4', status: 'doing' });
  assert.ok(Date.now() - t0 < 200, 'moves return before git runs');
  assert.ok(fs.existsSync(w1), 'still there right after the move');
  await b.retired(); clearInterval(iv);
  const t = Object.fromEntries(b.tasks().map((x) => [x.id, x]));
  assert.ok(!fs.existsSync(w1) && !fs.existsSync(w2));
  assert.equal(g('branch', '--list', 'b1'), ''); assert.equal(g('branch', '--list', 'b2'), '');
  assert.equal(t.t1.worktrees, undefined); assert.equal(t.t2, undefined);
  assert.ok(fs.existsSync(w3)); assert.deepEqual(t.t3.worktrees, [w3]); assert.match(t.t3.note, /uncommitted work kept/);
  assert.ok(fs.existsSync(w4)); assert.match(g('branch', '--list', 'b4'), /b4/); assert.equal(t.t4.status, 'doing');
  assert.ok(max < 150, `event loop blocked ${max}ms`);
  fs.rmSync(dir, { recursive: true, force: true });
});
