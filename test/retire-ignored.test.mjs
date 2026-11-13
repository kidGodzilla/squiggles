// git worktree remove deletes ignored files without asking: a worktree holding a .env or a key stays; ignored build output doesn't hold one back.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createBoard } from '../board.mjs';

test('a worktree whose only changes are ignored secrets is kept; ignored build output is not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-ign-')), repo = path.join(dir, 'repo');
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env }).toString().trim();
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n*.pem\ndist/\nnode_modules/\n'); g('add', '.gitignore'); g('commit', '-q', '-m', 'a');
  const names = ['env', 'pem', 'build'];
  const [wEnv, wPem, wBuild] = names.map((b) => { const p = path.join(dir, b); g('worktree', 'add', '-q', '-b', b, p, 'main'); return p; });
  fs.writeFileSync(path.join(wEnv, '.env'), 'TOKEN=x');
  fs.mkdirSync(path.join(wPem, 'certs')); fs.writeFileSync(path.join(wPem, 'certs', 'dev.pem'), 'k');
  fs.mkdirSync(path.join(wBuild, 'dist')); fs.writeFileSync(path.join(wBuild, 'dist', 'app.js'), 'x');
  fs.mkdirSync(path.join(wBuild, 'node_modules')); fs.writeFileSync(path.join(wBuild, 'node_modules', 'm.js'), 'x');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'open' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: names.map((b, i) => ({ id: `t${i + 1}`, title: b, goal: 'g', status: 'doing', repo, branch: b, worktrees: [path.join(dir, b)] })) }));
  const b = createBoard(dir, () => {});
  for (const id of ['t1', 't2', 't3']) b.taskOp({ op: 'move', id, status: 'done' });
  await b.retired();
  const t = Object.fromEntries(b.tasks().map((x) => [x.id, x]));
  assert.equal(fs.readFileSync(path.join(wEnv, '.env'), 'utf8'), 'TOKEN=x'); assert.match(t.t1.note, /kept/);
  assert.ok(fs.existsSync(path.join(wPem, 'certs', 'dev.pem'))); assert.match(t.t2.note, /kept/);
  assert.ok(!fs.existsSync(wBuild), 'ignored build output alone does not keep a worktree');
  fs.rmSync(dir, { recursive: true, force: true });
});
