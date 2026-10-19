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
