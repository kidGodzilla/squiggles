import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createBoard } from '../board.mjs';

test('a dropped task id is never handed out again (t1551)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ids-'));
  const b = createBoard(dir, () => {});
  b.taskOp({ op: 'add', title: 'one' });
  const two = b.taskOp({ op: 'add', title: 'two' });
  b.taskOp({ op: 'drop', id: two.id });
  assert.equal(b.taskOp({ op: 'add', title: 'three' }).id, 't3');
  b.taskOp({ op: 'drop', id: 't3' });
  assert.equal(b.taskOp({ op: 'suggest', title: 'a brand new suggestion here' }).id, 't4');
  b.taskOp({ op: 'drop', id: 't4' });
  const { subtasks } = b.taskOp({ op: 'split', id: 't1', titles: ['a', 'b'] });
  assert.deepEqual(subtasks.map((x) => x.id), ['t5', 't6']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an old tasks.json with no high-water mark starts from its highest id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ids-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [{ id: 't7', title: 'x', status: 'todo' }] }));
  const b = createBoard(dir, () => {});
  assert.equal(b.taskOp({ op: 'add', title: 'next' }).id, 't8');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).last, 8);
  fs.rmSync(dir, { recursive: true, force: true });
});
