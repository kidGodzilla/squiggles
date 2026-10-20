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
