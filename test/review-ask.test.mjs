import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createBoard, plainAsk } from '../board.mjs';
import { createPicks, describePicks } from '../picks.mjs';

const ASK = 'Adds error reports for the web app so crashes show up in the log; merge it or send it back?';

test('a squiggle review needs a plain ask; it rides on the merge item and can be edited', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-')), repo = path.join(dir, 'repo');
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a'), 'a'); g('add', 'a'); g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 't1-x'); fs.writeFileSync(path.join(repo, 'b'), 'b'); g('add', 'b'); g('commit', '-q', '-m', 'x'); g('checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', repos: [repo] }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't1', title: 'x', goal: 'g', owner: 'ann', status: 'doing' }] }));
  const b = createBoard(dir, () => {});
  assert.throws(() => b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-x', needAsk: true }), /--ask/);
  assert.throws(() => b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-x', needAsk: true, ask: 'Merge the web fix' }), /12\+ words/);
  assert.equal(b.tasks().find((t) => t.id === 't1').status, 'doing');
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-x', note: 'tests 3/3', needAsk: true, ask: ASK });
  assert.equal((await b.merges()).find((m) => m.id === 't1').ask, ASK);
  // Back to doing and in review again: the ask it already has counts.
  b.taskOp({ op: 'move', id: 't1', status: 'doing' });
  b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-x', needAsk: true });
  b.taskOp({ op: 'edit', id: 't1', ask: 'Changed: ' + ASK });
  assert.match((await b.merges()).find((m) => m.id === 't1').ask, /^Changed: /);
  // The user (no needAsk) is never held to it.
  b.taskOp({ op: 'edit', id: 't1', ask: '' }); b.taskOp({ op: 'move', id: 't1', status: 'review', branch: 't1-x' });
  assert.equal((await b.merges()).find((m) => m.id === 't1').ask, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('plainAsk counts words; picks keep their why', () => {
  assert.equal(plainAsk(''), false); assert.equal(plainAsk('t12 ship?'), false); assert.equal(plainAsk(ASK), true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickwhy-')), p = createPicks({ file: path.join(dir, 'picks.json'), now: () => 1 });
  const x = p.ask({ by: 'ux', question: 'Which header?', why: 'The Review tab header wraps on phones; both fit.', options: ['Tall', 'Short'] });
  assert.equal(x.why, 'The Review tab header wraps on phones; both fit.');
  assert.match(describePicks(p.list()), /why: The Review tab header wraps/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('task add keeps an alert level and when it was filed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-'));
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [] })); fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  const b = createBoard(dir, () => {}), t = b.taskOp({ op: 'add', title: 'site down', owner: 'logs', alert: 'serious' });
  assert.equal(t.alert, 'serious'); assert.ok(Date.now() - t.alertAt < 5000);
  assert.equal(b.taskOp({ op: 'add', title: 'x', alert: 'loud' }).alert, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
