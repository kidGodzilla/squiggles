import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createBoard } from '../board.mjs';

test('merge listing: async git, merged branches swept, concurrent calls share one run, diff and merge await it (t961)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merges-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const commit = (f, m) => { fs.writeFileSync(path.join(repo, f), m); g('add', f); g('commit', '-q', '-m', m); };
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); commit('a', 'base');
  g('checkout', '-q', '-b', 'open-one'); commit('b', 'work');
  g('checkout', '-q', '-b', 'merged-one', 'main'); commit('c', 'done');
  g('checkout', '-q', 'main'); g('merge', '-q', '--ff-only', 'merged-one');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'open', goal: 'g', status: 'review', repo, branch: 'open-one' },
    { id: 't2', title: 'merged', goal: 'g', status: 'review', repo, branch: 'merged-one' },
    { id: 't3', title: 'gone', goal: 'g', status: 'review', repo, branch: 'nope' } ] }));
  const b = createBoard(dir, () => {});
  const p1 = b.merges(), p2 = b.merges();
  assert.equal(p1, p2);
  const list = await p1;
  assert.deepEqual(list.map((x) => x.id), ['t1']);
  assert.equal(list[0].base, 'main'); assert.equal(list[0].ahead, 1); assert.equal(list[0].behind, 1); assert.equal(list[0].dirty, 0);
  assert.deepEqual(list[0].log.map((l) => l.split(' ').slice(1).join(' ')), ['work']);
  const t = Object.fromEntries(b.tasks().map((x) => [x.id, x]));
  assert.equal(t.t2.status, 'done'); assert.match(t.t2.note, /merged outside into main/);
  assert.equal(t.t3.status, 'done'); assert.match(t.t3.note, /branch gone/);
  const p3 = b.merges(); assert.notEqual(p3, p1); assert.deepEqual((await p3).map((x) => x.id), ['t1']);
  const d = await b.mergeDiff('t1'); assert.equal(d.base, 'main'); assert.match(d.stat, /\bb\b/);
  const sent = b.merge('t1', 'owner'); b.taskOp({ op: 'move', id: 't1', status: 'doing' });
  await assert.rejects(sent, /t1 is doing, not in review/);
  b.taskOp({ op: 'move', id: 't1', status: 'review' });
  const m = await b.merge('t1', 'owner'); assert.equal(m.base, 'main');
  assert.match(String(g('ls-tree', '--name-only', 'main')), /^b$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge listing names the files that would conflict with the base (t783)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merges-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const commit = (f, m) => { fs.writeFileSync(path.join(repo, f), m); g('add', f); g('commit', '-q', '-m', m); };
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); commit('a', 'base'); commit('x', 'base');
  g('checkout', '-q', '-b', 'clash'); commit('a', 'branch side'); commit('y', 'new');
  g('checkout', '-q', '-b', 'clean', 'main'); commit('z', 'clean');
  g('checkout', '-q', 'main'); commit('a', 'main side'); commit('x', 'main only');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'clash', goal: 'g', status: 'review', repo, branch: 'clash' },
    { id: 't2', title: 'clean', goal: 'g', status: 'review', repo, branch: 'clean' } ] }));
  const b = createBoard(dir, () => {}), l = Object.fromEntries((await b.merges()).map((x) => [x.id, x]));
  assert.deepEqual(l.t1.conflicts, ['a']); assert.deepEqual(l.t2.conflicts, []);
  await assert.rejects(b.merge('t1', 'owner'), /conflicts merging clash into main/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('conflicting review branch goes back to doing once per conflict, owner told (t1189)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merges-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const commit = (f, m) => { fs.writeFileSync(path.join(repo, f), m); g('add', f); g('commit', '-q', '-m', m); };
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); commit('a', 'base');
  g('checkout', '-q', '-b', 'clash'); commit('a', 'branch side');
  g('checkout', '-q', '-b', 'clean', 'main'); commit('z', 'clean');
  g('checkout', '-q', 'main'); commit('a', 'main side');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'clash', goal: 'g', owner: 'o', status: 'review', repo, branch: 'clash' },
    { id: 't2', title: 'clean', goal: 'g', owner: 'o', status: 'review', repo, branch: 'clean' } ] }));
  const told = [], b = createBoard(dir, () => {}, { onConflict: (x) => told.push(x) });
  const task = (id) => b.tasks().find((x) => x.id === id);
  assert.deepEqual((await b.merges()).map((x) => x.id), ['t2']);
  assert.equal(task('t1').status, 'doing'); assert.match(task('t1').note, /^sent back by the harness: conflicts with main: a\./);
  assert.deepEqual(told.map((x) => [x.id, x.owner]), [['t1', 'o']]);
  b.taskOp({ op: 'move', id: 't1', status: 'review' }); // resubmitted unchanged: stays, not sent again
  assert.deepEqual((await b.merges()).map((x) => x.id).sort(), ['t1', 't2']); assert.equal(told.length, 1);
  g('checkout', '-q', 'clash'); commit('y', 'more'); g('checkout', '-q', 'main'); // new commit, still conflicting: sent again
  await b.merges(); assert.equal(task('t1').status, 'doing'); assert.equal(told.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge of a task committed straight on the base closes it, no git merge (t1251)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merges-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a'), 'a'); g('add', 'a'); g('commit', '-q', '-m', 'a');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', title: 'on main', goal: 'g', status: 'review', repo, branch: 'main', note: 'abc: done' }] }));
  const b = createBoard(dir, () => {}), m = await b.merge('t1', 'owner');
  assert.equal(m.task.status, 'done'); assert.match(m.task.note, /^already on main, closed by owner — abc: done/);
  assert.equal(execFileSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gated: review tasks in gated goals (and goal-less ones) need the user or the lead (t1384)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merges-'));
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated' }, { id: 'o', title: 'O', merge: 'open' }, { id: 'd', title: 'D' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', goal: 'g' }, { id: 't2', goal: 'o' }, { id: 't3', goal: 'd' }, { id: 't4' }] }));
  const b = createBoard(dir, () => {});
  assert.deepEqual(['t1', 't2', 't3', 't4', 'nope'].map(b.gated), [true, false, true, true, false]);
  fs.rmSync(dir, { recursive: true, force: true });
});
