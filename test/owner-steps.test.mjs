// A step tagged Owner is done from the Review tab, so it is complete when filed: the user never asks anyone for the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoard } from '../board.mjs';

const rig = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osteps-'));
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [
    { id: 't1', title: 'x', goal: 'g', owner: 'builder', status: 'review', needs: [{ t: 'set <secret> on the app', done: false, who: 'ops' }] },
    { id: 't2', title: 'y', goal: 'g', owner: 'builder', status: 'done' },
  ] }));
  const sq = { ops: 'Otto', builder: 'Builder', lead: 'Lead' };
  const whoIs = (w, namesOnly) => { const k = w.toLowerCase(); if (k === 'owner') return 'owner'; return Object.keys(sq).find((id) => (!namesOnly && id === k) || sq[id].toLowerCase() === k) || null; };
  return { b: createBoard(dir, () => {}, { whoIs, onSteps: () => {} }), dir };
};
const add = (b, text, op = 'after', id = 't2') => b.taskOp({ op, id, act: 'add', text });
const WHY = /the owner does this step/;

test('a step with blanks is refused, on both lists', () => {
  const { b, dir } = rig();
  const t = 'Owner: generate a URL-safe secret and change the inbound webhook URL to https://hook:<secret>@<app host>/api/inbound';
  assert.throws(() => add(b, t), WHY);
  assert.throws(() => add(b, t, 'needs', 't1'), WHY);
  assert.equal(b.tasks().find((x) => x.id === 't2').after, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('the refusal names what is missing', () => {
  const { b, dir } = rig();
  assert.throws(() => add(b, 'Owner: open <app host>/admin'), /<app host>/);
  fs.rmSync(dir, { recursive: true, force: true });
});
for (const t of [
  'generate a secret and paste it into the webhook',
  'pick a strong password for the new mailbox',
  'set the DSN to {{dsn}}',
  'set MAIL_FROM to YOUR_ADDRESS',
  'set the region, TBD',
  'ask Otto for the token, then paste it into the dashboard',
  'see the note for what to change',
  'values are in the journal',
]) test(`refused: ${t}`, () => { const { b, dir } = rig(); assert.throws(() => add(b, `Owner: ${t}`), WHY); fs.rmSync(dir, { recursive: true, force: true }); });

for (const t of [
  'flip the flag',
  'Run `openssl rand -hex 24` and paste the result into Settings > Webhooks > Inbound',
  'Deploys tab: deploy the app',
  'delete the old key in the dashboard',
]) test(`accepted: ${t}`, () => {
  const { b, dir } = rig(); add(b, `Owner: ${t}`);
  assert.deepEqual(b.tasks().find((x) => x.id === 't2').after, [{ t, done: false, who: 'owner' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('a squiggle\'s own step can stay short: it has the context', () => {
  const { b, dir } = rig(); add(b, 'Otto: set <secret> on the app');
  assert.equal(b.tasks().find((x) => x.id === 't2').after[0].who, 'ops');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('retagging an incomplete step to Owner is refused, and leaves it where it was', () => {
  const { b, dir } = rig();
  assert.throws(() => b.taskOp({ op: 'needs', id: 't1', act: 'tag', n: 1, who: 'Owner' }), WHY);
  assert.equal(b.tasks().find((x) => x.id === 't1').needs[0].who, 'ops');
  fs.rmSync(dir, { recursive: true, force: true });
});
