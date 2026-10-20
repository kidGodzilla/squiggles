import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createBoard } from '../board.mjs';

const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function repo(dir, name, branch, file) {
  const r = path.join(dir, name), g = (...a) => execFileSync('git', ['-C', r, ...a], { stdio: 'pipe', env });
  const commit = (f, m) => { fs.writeFileSync(path.join(r, f), m); g('add', f); g('commit', '-q', '-m', m); };
  fs.mkdirSync(r); g('init', '-q', '-b', 'main'); commit('a', 'base');
  g('checkout', '-q', '-b', branch); commit(file, 'work'); g('checkout', '-q', 'main');
  return { r, g, commit };
}
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-'));
  const A = repo(dir, 'api', 'feat', 'x'), B = repo(dir, 'app', 'feat', 'y');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated', repos: [A.r, B.r] }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', title: 'both', goal: 'g', status: 'doing', owner: 'x' }], next: 2 }));
  return { dir, A, B, b: createBoard(dir, () => {}) };
};

test('one branch in two goal repos: review takes it, merge lands both (t1197)', async () => {
  const { dir, A, B, b } = setup();
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 'feat', note: 'ok' });
  const [row] = await b.merges();
  assert.equal(row.repo, A.r); assert.deepEqual(row.others.map((o) => o.repo), [B.r]);
  const m = await b.merge('t1', 'owner');
  assert.equal(m.task.status, 'done'); assert.equal(m.merged.length, 2);
  assert.equal(fs.readFileSync(path.join(A.r, 'x'), 'utf8'), 'work');
  assert.equal(fs.readFileSync(path.join(B.r, 'y'), 'utf8'), 'work');
  assert.throws(() => B.g('rev-parse', '--verify', 'refs/heads/feat'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a conflict in the second repo merges neither (t1197)', async () => {
  const { dir, A, B, b } = setup();
  B.g('checkout', '-q', 'feat'); B.commit('a', 'branch side'); B.g('checkout', '-q', 'main'); B.commit('a', 'main side');
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 'feat', note: 'ok' });
  const [row] = await b.merges();
  assert.deepEqual(row.conflicts, ['app: a']);
  await assert.rejects(b.merge('t1', 'owner'), /conflicts merging feat/);
  assert.equal(fs.existsSync(path.join(A.r, 'x')), false);
  assert.equal(b.tasks()[0].status, 'review');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('repo:branch accepts the bare repo name (t1197)', async () => {
  const { dir, B, b } = setup();
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 'app:feat', note: 'ok' });
  assert.equal(b.tasks()[0].repo, B.r);
  fs.rmSync(dir, { recursive: true, force: true });
});
