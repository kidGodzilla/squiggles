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

test('goal edit refuses an empty title (t1030)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-'));
  const b = createBoard(dir, () => {});
  const g = b.goalOp({ op: 'add', title: 'Security', tier: 'active' });
  assert.throws(() => b.goalOp({ op: 'edit', id: g.id, title: '' }), /needs a title/);
  assert.throws(() => b.goalOp({ op: 'edit', id: g.id, title: '  ' }), /needs a title/);
  assert.equal(b.goals().active[0].title, 'Security');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('goal due: real dates only, clear removes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goals-'));
  const b = createBoard(dir, () => {});
  const g = b.goalOp({ op: 'add', title: 'Launch', tier: 'active' });
  assert.equal(b.goalOp({ op: 'edit', id: g.id, due: '2028-02-29' }).due, '2028-02-29');
  for (const bad of ['2026-02-30', '2026-04-31', '2026-13-01', 'tomorrow']) assert.throws(() => b.goalOp({ op: 'edit', id: g.id, due: bad }), /YYYY-MM-DD/, bad);
  assert.equal(b.goalOp({ op: 'edit', id: g.id, due: 'clear' }).due, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
