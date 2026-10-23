import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from '../load.mjs';

test('load counts the user per local day and what shipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-')), runs = path.join(root, 'runs'), w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  const now = new Date(2026, 9, 23, 15).getTime(), today = new Date(now).toLocaleDateString('sv'), at = (h) => new Date(2026, 9, 23, h).getTime();
  w(path.join(root, 'tasks.json'), JSON.stringify({ tasks: [
    { status: 'done', finished: today, merged: 'main@a', mergedBy: 'owner' }, { status: 'done', finished: today, merged: 'main@b', mergedBy: 'lead' },
    { status: 'done', finished: today, merged: 'main@c' }, { status: 'done', finished: today }, { status: 'done', finished: '2026-10-01', merged: 'x' }, { status: 'todo' }] }));
  w(path.join(runs, 'asks.log'), [{ t: new Date(at(9)).toISOString(), ev: 'running', who: 'owner' }, { t: new Date(at(9)).toISOString(), ev: 'denied', who: 'owner' }, { t: new Date(at(9)).toISOString(), ev: 'filed' }].map((x) => JSON.stringify(x)).join('\n'));
  const msg = (ts, text, extra = {}) => JSON.stringify({ ts, k: 'user', text, from: 'owner', ...extra });
  w(path.join(runs, 'lead.jsonl'), [msg(at(9), 'hi'), msg(at(9) + 100, 'to all'), JSON.stringify({ ts: at(10), k: 'say', text: 'Merge it?' }), JSON.stringify({ ts: at(10), k: 'say', text: 'Done.' }), JSON.stringify({ ts: at(10), k: 'user', text: 'Team reports?' })].join('\n'));
  w(path.join(runs, 'ops.jsonl'), [msg(at(9) + 200, 'to all'), msg(at(11), 'later')].join('\n'));
  const d = load({ root, days: 2, now });
  assert.equal(d.length, 2); assert.equal(d[1].date, today); assert.equal(d[0].actions, 0);
  assert.deepEqual(({ ...d[1], date: 0 }), { date: 0, merges: 2, runs: 1, denies: 1, messages: 3, questions: 1, done: 4, merged: 3, actions: 7 });
  fs.rmSync(root, { recursive: true });
});

test('load shows how long the lead waited on harness calls and server stalls over 1s', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-')), runs = path.join(root, 'runs'), w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  const now = new Date(2026, 9, 23, 15).getTime(), at = (h) => new Date(2026, 9, 23, h).getTime();
  const ev = (o) => JSON.stringify(o);
  w(path.join(runs, 'lead.jsonl'), [
    ev({ ts: at(9), k: 'tool', tid: 'a', name: 'Bash', text: 'node bin/agents.mjs merges' }), ev({ ts: at(9) + 12000, k: 'out', tid: 'a', text: 'x' }),
    ev({ ts: at(10), k: 'tool', tid: 'b', name: 'Bash', text: 'node bin/agents.mjs tasks' }), ev({ ts: at(10) + 500, k: 'out', tid: 'b', text: 'x' }),
    ev({ ts: at(10), k: 'tool', tid: 'c', name: 'Bash', text: 'git status' }), ev({ ts: at(10) + 90000, k: 'out', tid: 'c', text: 'x' }),
    ev({ ts: at(11), k: 'tool', tid: 'd', name: 'Bash', text: 'node bin/agents.mjs list' }), ev({ ts: at(11) + 1500, k: 'out', tid: 'd', text: 'x' })].join('\n'));
  w(path.join(runs, 'stalls.jsonl'), [ev({ ts: at(9) + 3000, ms: 4200, ops: ['POST /api/merges merge t1'] }), ev({ ts: at(12), ms: 1300, ops: [] })].join('\n'));
  const r = load({ root, days: 1, now })[0];
  assert.deepEqual([r.calls, r.callP50, r.callP90, r.stalls, r.stallMax], [3, 1500, 12000, 2, 4200]);
  fs.rmSync(root, { recursive: true });
});
