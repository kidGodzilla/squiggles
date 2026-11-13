import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoard } from '../board.mjs';

// read-only callers share one parse of tasks.json per change, not one each.
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bview-'));
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ last: 9, tasks: [{ id: 't1', title: 'one', goal: 'g', status: 'todo', owner: 'a' }] }));
  return dir;
};
const counting = (dir, fn) => {
  const f = path.join(dir, 'tasks.json'), orig = fs.readFileSync; let n = 0;
  fs.readFileSync = function (p, ...r) { if (p === f) n++; return orig.call(this, p, ...r); };
  try { fn(); } finally { fs.readFileSync = orig; }
  return n;
};

test('view parses tasks.json once until it changes, and is frozen', () => {
  const dir = setup(), b = createBoard(dir, () => {});
  let a, c;
  const reads = counting(dir, () => { a = b.view(); for (let i = 0; i < 5; i++) c = b.view(); });
  assert.equal(reads, 1);
  assert.equal(a, c);
  assert.throws(() => { a[0].status = 'done'; }, TypeError);
  assert.throws(() => a.push({}), TypeError);
  assert.equal(b.tasks()[0].status, 'todo');
});

test('view sees writes through the board and from outside', () => {
  const dir = setup(), b = createBoard(dir, () => {});
  b.view();
  b.taskOp({ op: 'add', title: 'two', goal: 'g', owner: 'a' });
  assert.deepEqual(b.view().map((t) => t.id), ['t1', 't10']); // ids continue past `last`
  const f = path.join(dir, 'tasks.json'), d = JSON.parse(fs.readFileSync(f, 'utf8'));
  d.tasks.push({ id: 't11', title: 'outside', goal: 'g', status: 'todo' });
  fs.writeFileSync(f, JSON.stringify(d));
  assert.equal(b.view().length, 3);
});

test('a wake-style pass (suggestion news with none untold) does not take a writable parse', () => {
  const dir = setup(), b = createBoard(dir, () => {});
  b.view();
  const reads = counting(dir, () => { assert.deepEqual(b.suggestionNews('a'), []); b.view(); });
  assert.equal(reads, 0);
});
