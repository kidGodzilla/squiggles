import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createBoard } from '../board.mjs';

test('goal kind: area on, back to goal, bad kind refused (t977)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-'));
  const b = createBoard(dir, () => {});
  const g = b.goalOp({ op: 'add', title: 'Security', tier: 'active' });
  assert.equal(b.goalOp({ op: 'edit', id: g.id, kind: 'area' }).kind, 'area');
  assert.equal(b.goals().active[0].kind, 'area');
  assert.equal(b.goalOp({ op: 'edit', id: g.id, kind: 'goal' }).kind, undefined);
  assert.throws(() => b.goalOp({ op: 'edit', id: g.id, kind: 'forever' }), /kind must be goal or area/);
  assert.equal(b.goalOp({ op: 'edit', id: g.id, note: 'x' }).kind, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
