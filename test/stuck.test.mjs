// What stopped moving, oldest first, for the lead's pass, the CLI and the Tasks tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createBoard } from '../board.mjs';
import { stuckList, describeStuck, stuckBrief, stuckLine } from '../stuck.mjs';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const ago = (n) => new Date(NOW - n * 864e5).toISOString().slice(0, 10);
const note = (id, status, age, more = {}) => ({ id, title: `note ${id}`, status, goal: 'g', owner: 'kit', created: ago(age), confirmed: ago(age), ...more });
const kinds = (l) => l.map((x) => `${x.kind} ${x.id}`);
const run = (tasks, more = {}) => stuckList({ tasks, now: NOW, ...more });

test('each status has its own limit', () => {
  const l = run([note('t1', 'blocked', 2), note('t2', 'blocked', 1), note('t3', 'waiting', 2), note('t4', 'waiting', 1), note('t5', 'doing', 3), note('t6', 'doing', 2), note('t7', 'review', 3), note('t8', 'review', 2)]);
  assert.deepEqual(kinds(l).sort(), ['blocked t1', 'doing t5', 'review t7', 'waiting t3']);
});

test('todos count only when a person asked and a week went by', () => {
  const l = run([note('t1', 'todo', 7, { asked: 'owner' }), note('t2', 'todo', 6, { asked: 'owner' }), note('t3', 'todo', 90), note('t4', 'todo', 90, { asked: 'lead' }), note('t5', 'todo', 9, { asked: 'Sam' })], { byPerson: (a) => a !== 'lead' });
  assert.deepEqual(kinds(l), ['asked t5', 'asked t1']);
});

test('age runs from the last status change, so a fresh note on a blocked task does not hide it', () => {
  const [x] = run([note('t1', 'blocked', 0, { since: NOW - 9 * 864e5 })]);
  assert.equal(x.age, 9);
});

test('held goals and suggestions stay out', () => {
  const l = run([note('t1', 'blocked', 30, { goal: 'h' }), note('t2', 'blocked', 30, { kind: 'suggestion' })], { holds: ['h'] });
  assert.deepEqual(l, []);
});

test('open steps around a merge sit on their own clock, even on a finished note', () => {
  const l = run([
    note('t1', 'done', 5, { finished: ago(5), after: [{ t: 'Owner: run it', who: 'owner' }, { t: 'closed', done: true }] }),
    note('t2', 'done', 1, { finished: ago(1), after: [{ t: 'too new' }] }),
    note('t3', 'review', 1, { reviewed: ago(2), needs: [{ t: 'Remy: sync', who: 'ops' }] }),
  ]);
  assert.deepEqual(kinds(l), ['after t1', 'needs t3']);
  assert.equal(l[0].owner, 'owner');
  assert.equal(l[0].n, 1);
  assert.equal(l[1].owner, 'ops');
});

test('a parent whose parts all ended is stuck at any age; one with an open part is not', () => {
  const l = run([note('t1', 'todo', 0), note('t2', 'done', 0, { parent: 't1' }), note('t3', 'todo', 0), note('t4', 'done', 0, { parent: 't3' }), note('t5', 'todo', 0, { parent: 't3' })]);
  assert.deepEqual(kinds(l), ['parts t1']);
});

test('a blocked note naming only finished tasks has lost its reason', () => {
  const l = run([note('t1', 'done', 0), note('t2', 'blocked', 0, { note: 'needs t1 first' }), note('t3', 'todo', 0), note('t4', 'blocked', 0, { note: 'needs t1 and t3' }), note('t5', 'waiting', 0, { note: 'on t404' })]);
  assert.deepEqual(kinds(l), ['cleared t2']);
});

test('moving work held by a paused owner shows; their todos do not', () => {
  const l = run([note('t1', 'doing', 0), note('t2', 'todo', 40)], { paused: ['kit'] });
  assert.deepEqual(kinds(l), ['owner t1']);
});

test('oldest first; the lead gets the count and the top, the CLI gets everything', () => {
  const l = run([note('t1', 'blocked', 3), note('t2', 'blocked', 40), note('t3', 'waiting', 9)]);
  assert.deepEqual(l.map((x) => x.id), ['t2', 't3', 't1']);
  assert.match(describeStuck(l), /40 days {2}Blocked {2}t2 {2}@kit {2}note t2/);
  assert.equal(describeStuck(l).split('\n').length, 3);
  const brief = stuckBrief(l, 2);
  assert.match(brief, /Stuck work: 3/);
  assert.ok(brief.includes(stuckLine(l[1])) && !brief.includes(stuckLine(l[2])));
  assert.equal(stuckBrief([]), '');
  assert.equal(describeStuck([]), 'nothing is stuck');
});

test('the board stamps a status change and leaves a re-note alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-'));
  const b = createBoard(dir, () => {}), t = b.taskOp({ op: 'add', title: 'x' });
  const since = () => b.tasks().find((y) => y.id === t.id).since;
  b.taskOp({ op: 'move', id: t.id, status: 'blocked', note: 'first' });
  const at = since();
  assert.ok(at > 0);
  const raw = path.join(dir, 'tasks.json'), j = JSON.parse(fs.readFileSync(raw, 'utf8'));
  j.tasks.find((y) => y.id === t.id).since = 5; fs.writeFileSync(raw, JSON.stringify(j));
  b.taskOp({ op: 'move', id: t.id, status: 'blocked', note: 'second' });
  assert.equal(since(), 5);
  b.taskOp({ op: 'move', id: t.id, status: 'doing' });
  assert.ok(since() >= at);
  fs.rmSync(dir, { recursive: true, force: true });
});
