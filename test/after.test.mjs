import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createBoard } from '../board.mjs';

test('after-merge list beside needs; "After merge" refused on needs (t1182)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-'));
  const b = createBoard(dir, () => {});
  const t = b.taskOp({ op: 'add', title: 'x' });
  b.taskOp({ op: 'after', id: t.id, act: 'add', text: 'Run the one-time migration' });
  b.taskOp({ op: 'after', id: t.id, act: 'add', text: 'Deploy repo B' });
  b.taskOp({ op: 'after', id: t.id, act: 'done', n: '1' });
  let x = b.tasks().find((y) => y.id === t.id);
  assert.deepEqual(x.after, [{ t: 'Run the one-time migration', done: true }, { t: 'Deploy repo B', done: false }]);
  assert.equal(x.needs, undefined);
  assert.throws(() => b.taskOp({ op: 'needs', id: t.id, act: 'add', text: 'After merge: curl the page' }), /task after .* add/);
  assert.throws(() => b.taskOp({ op: 'after', id: t.id, act: 'done', n: '9' }), /no after-merge step 9/);
  assert.throws(() => b.taskOp({ op: 'after', id: t.id, act: 'add', text: ' ' }), /after add/);
  b.taskOp({ op: 'after', id: t.id, act: 'drop', n: '1' }); b.taskOp({ op: 'after', id: t.id, act: 'clear' });
  assert.equal(b.tasks().find((y) => y.id === t.id).after, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge steps carry an owner and go to them on review and merge', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steps-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a'), 'a'); g('add', 'a'); g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 't1-x'); fs.writeFileSync(path.join(repo, 'b'), 'b'); g('add', 'b'); g('commit', '-q', '-m', 'x'); g('checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', repos: [repo] }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', title: 'x', goal: 'g', owner: 'builder', status: 'doing', after: [{ t: 'Ada syncs the bucket', done: false }, { t: 'Merge t9 first', done: false }] }] }));
  const sq = { ops: 'Ada', builder: 'Builder' }, heard = [];
  const whoIs = (w, namesOnly) => { const k = w.toLowerCase(); if (k === 'owner') return 'owner'; return Object.keys(sq).find((id) => (!namesOnly && id === k) || sq[id].toLowerCase() === k) || null; };
  const b = createBoard(dir, () => {}, { whoIs, onSteps: (x) => heard.push(x) });
  let t = b.tasks()[0];
  assert.equal(t.after[0].who, 'ops'); assert.equal(t.after[1].who, undefined); // old steps tagged from names once
  assert.throws(() => b.taskOp({ op: 'needs', id: 't1', act: 'add', text: 'deploy api first' }), /tag the step's owner/);
  b.taskOp({ op: 'needs', id: 't1', act: 'add', text: 'Ada: deploy api first' });
  b.taskOp({ op: 'needs', id: 't1', act: 'add', text: 'Owner: flip the flag' });
  t = b.tasks()[0]; assert.deepEqual(t.needs, [{ t: 'deploy api first', done: false, who: 'ops' }, { t: 'flip the flag', done: false, who: 'owner' }]);
  assert.equal(heard.length, 0); // not in review yet
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-x' });
  assert.deepEqual(heard, [{ id: 't1', title: 'x', list: 'needs', who: 'ops', untagged: false, steps: [{ n: 1, t: 'deploy api first' }] }]);
  heard.length = 0; b.taskOp({ op: 'needs', id: 't1', act: 'add', text: '@builder rebase on main' });
  assert.equal(heard[0].who, 'builder'); assert.deepEqual(heard[0].steps, [{ n: 3, t: 'rebase on main' }]);
  heard.length = 0; await b.merge('t1', 'owner');
  assert.deepEqual(heard.map((x) => [x.who, x.untagged, x.steps.map((y) => y.n)]), [['ops', false, [1]], ['builder', true, [2]]]);
  heard.length = 0; b.taskOp({ op: 'after', id: 't1', act: 'tag', n: '2', who: 'Ada' });
  assert.equal(b.tasks()[0].after[1].who, 'ops'); assert.equal(heard[0].who, 'ops');
  assert.throws(() => b.taskOp({ op: 'after', id: 't1', act: 'tag', n: '2', who: 'nobody' }), /tag 2 with/);
  fs.rmSync(dir, { recursive: true, force: true });
});
