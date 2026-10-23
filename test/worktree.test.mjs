import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
process.env.AGENTS_WT = path.join(dir, 'wt');
const { createBoard } = await import('../board.mjs');

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const r = path.join(dir, 'api'), g = (...a) => execFileSync('git', ['-C', r, ...a], { stdio: 'pipe', env });
fs.mkdirSync(r); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(r, 'a'), 'base'); g('add', 'a'); g('commit', '-q', '-m', 'base');
fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated', repos: [r] }] }));
fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', title: 'Fix it', goal: 'g', status: 'doing', owner: 'x' }] }));
const b = createBoard(dir, () => {});

test('task worktree checks out without blocking, and twice at once makes one', async () => {
  let ticked = false; setImmediate(() => { ticked = true; });
  const p = b.taskOp({ op: 'worktree', id: 't1' }), q = b.taskOp({ op: 'worktree', id: 't1' });
  assert.ok(p instanceof Promise); assert.equal(p, q);
  const w = await p;
  assert.ok(ticked, 'the event loop ran while git checked out');
  assert.equal(w.created, true); assert.equal(fs.readFileSync(path.join(w.path, 'a'), 'utf8'), 'base');
  const t = b.tasks().find((x) => x.id === 't1');
  assert.equal(t.branch, 't1-fix-it'); assert.deepEqual(t.worktrees, [w.path]);
  assert.equal((await b.taskOp({ op: 'worktree', id: 't1' })).created, false);
});

test('a board edit made during the checkout survives it', async () => {
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't2', title: 'Other', goal: 'g', status: 'doing', owner: 'x' }] }));
  const p = b.taskOp({ op: 'worktree', id: 't2' });
  b.taskOp({ op: 'add', title: 'meanwhile' });
  await p;
  assert.ok(b.tasks().some((x) => x.title === 'meanwhile'));
});
