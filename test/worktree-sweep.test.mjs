// the sweep covers everything in ~/wt, not just the goals' repos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wtsweep-'))), wt = path.join(dir, 'wt');
process.env.AGENTS_WT = wt;
const { createBoard } = await import('../board.mjs');
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env }).toString().trim();
const repo = (name) => { const r = path.join(dir, name); fs.mkdirSync(r); g(r, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(r, 'a'), 'a'); g(r, 'add', 'a'); g(r, 'commit', '-q', '-m', 'base'); return r; };

const inGoal = repo('in-goal'), outside = repo('outside'), gone = repo('gone');
fs.mkdirSync(wt);
g(inGoal, 'worktree', 'add', '-q', '-b', 't1-x', path.join(wt, 'in-goal-t1'));
g(outside, 'worktree', 'add', '-q', '-b', 'side', path.join(wt, 'outside-old'));
g(outside, 'worktree', 'add', '-q', '-b', 't2-y', path.join(wt, 'outside-t2'));
g(gone, 'worktree', 'add', '-q', '-b', 'lost', path.join(wt, 'gone-old'));
fs.rmSync(gone, { recursive: true });
fs.mkdirSync(path.join(wt, 'leftover')); fs.writeFileSync(path.join(wt, 'stray-file'), 'x');
fs.mkdirSync(path.join(wt, '.hidden'));
fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', repos: [inGoal] }] }));
fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [
  { id: 't1', title: 'x', goal: 'g', owner: 'builder', status: 'doing', repo: inGoal, branch: 't1-x' },
  { id: 't2', title: 'y', goal: 'g', owner: 'builder', status: 'doing', worktrees: [path.join(wt, 'outside-t2')] },
] }));
const b = createBoard(dir, () => {}), list = await b.worktrees(), at = (n) => list.filter((x) => x.path === path.join(wt, n));

test('a worktree of a repo in no goal is listed, as an orphan', () => {
  assert.equal(at('outside-old').length, 1);
  assert.deepEqual([at('outside-old')[0].orphan, at('outside-old')[0].branch, at('outside-old')[0].repo], [true, 'side', outside]);
});
test('its task still claims it', () => {
  assert.deepEqual([at('outside-t2')[0].task, at('outside-t2')[0].orphan], ['t2', false]);
});
test('a goal repo\'s worktree shows once, as before', () => {
  assert.equal(at('in-goal-t1').length, 1); assert.equal(at('in-goal-t1')[0].task, 't1');
});
test('a folder that is no working worktree is listed too, and says so', () => {
  for (const n of ['gone-old', 'leftover']) { assert.equal(at(n).length, 1, n); assert.deepEqual([at(n)[0].orphan, at(n)[0].plain], [true, true], n); }
});
test('files and hidden folders are not', () => {
  assert.equal(at('stray-file').length + at('.hidden').length, 0);
  assert.equal(list.length, 5);
});
test('the orphan note names them', async () => {
  await b.orphanNotes();
  const n = b.tasks().find((x) => String(x.title).startsWith('Orphan worktrees'));
  assert.ok(n, 'no note'); assert.match(`${n.title} ${n.note || ''}`, /outside-old/);
});
test('the CLI and the tab both word a plain folder', () => {
  for (const f of ['../bin/agents.mjs', '../ui/board.js']) assert.match(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), /plain \? 'not a working worktree'/, f);
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
