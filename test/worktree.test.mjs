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

test('a worktree gets its own node_modules: emptying it leaves main\'s alone', async () => {
  const n = path.join(dir, 'web'), h = (...a) => execFileSync('git', ['-C', n, ...a], { stdio: 'pipe', env });
  fs.mkdirSync(path.join(n, 'node_modules', 'dep'), { recursive: true }); fs.writeFileSync(path.join(n, 'node_modules', 'dep', 'index.js'), 'main');
  fs.symlinkSync(path.join(n, 'node_modules'), path.join(n, 'node_modules', 'node_modules')); // a self-link some mains carry
  fs.writeFileSync(path.join(n, 'package.json'), '{}'); fs.writeFileSync(path.join(n, '.gitignore'), 'node_modules\n');
  h('init', '-q', '-b', 'main'); h('add', '.'); h('commit', '-q', '-m', 'base');
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't3', title: 'Web', goal: 'g', status: 'doing', owner: 'x', repo: n }, { id: 't4', title: 'Old', goal: 'g', status: 'doing', owner: 'x', repo: n }] }));
  const w = await b.taskOp({ op: 'worktree', id: 't3' }), nm = path.join(w.path, 'node_modules');
  assert.ok(!fs.lstatSync(nm).isSymbolicLink());
  assert.equal(fs.readFileSync(path.join(nm, 'dep', 'index.js'), 'utf8'), 'main');
  assert.equal(fs.lstatSync(path.join(nm, 'node_modules'), { throwIfNoEntry: false }), undefined, 'no link back to main');
  fs.rmSync(nm, { recursive: true }); // what npm ci does first
  assert.equal(fs.readFileSync(path.join(n, 'node_modules', 'dep', 'index.js'), 'utf8'), 'main');
  // An older worktree has a symlink; asking for it again swaps in a copy.
  const old = await b.taskOp({ op: 'worktree', id: 't4' }), onm = path.join(old.path, 'node_modules');
  fs.rmSync(onm, { recursive: true }); fs.symlinkSync(path.join(n, 'node_modules'), onm);
  await b.taskOp({ op: 'worktree', id: 't4' });
  assert.ok(!fs.lstatSync(onm).isSymbolicLink()); assert.ok(fs.existsSync(path.join(n, 'node_modules', 'dep', 'index.js')));
});
