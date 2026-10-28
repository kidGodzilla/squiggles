import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createBoard } from '../board.mjs';

test('waiting is a task status that needs who or what it waits on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waiting-')), b = createBoard(dir, () => {});
  const t = b.taskOp({ op: 'add', title: 'x' }), get = () => b.tasks().find((y) => y.id === t.id);
  assert.throws(() => b.taskOp({ op: 'move', id: t.id, status: 'waiting' }), /who or what/);
  assert.throws(() => b.taskOp({ op: 'move', id: t.id, status: 'waiting', note: '  ' }), /who or what/);
  b.taskOp({ op: 'move', id: t.id, status: 'waiting', note: 'vendor support ticket' });
  assert.equal(get().status, 'waiting'); assert.equal(get().note, 'vendor support ticket');
  b.taskOp({ op: 'move', id: t.id, status: 'waiting' }); // already waiting: keeps its note
  assert.equal(get().note, 'vendor support ticket');
  assert.ok(b.STATUSES.includes('waiting'));
  fs.rmSync(dir, { recursive: true, force: true });
});
