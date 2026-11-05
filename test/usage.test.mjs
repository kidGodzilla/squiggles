import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usage, signal, describeLimit, describeWeek, describeSquiggle, report } from '../usage.mjs';

const H = 36e5, now = Date.UTC(2026, 10, 4, 12), reset = Date.UTC(2026, 10, 6, 15);
const lines = (a) => a.map((o) => JSON.stringify(o)).join('\n');
function room(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')), runs = path.join(root, 'runs'); fs.mkdirSync(runs);
  for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(f === 'tasks.json' ? root : runs, f), s);
  return root;
}

test('signal tells work from bookkeeping', () => {
  assert.equal(signal('git add usage.mjs && git commit -m "usage"'), 'work');
  assert.equal(signal('node bin/agents.mjs task move t1 done "ok"'), 'work');
  assert.equal(signal('node /x/bin/agents.mjs tell lead "hi"'), 'work');
  assert.equal(signal('$A suggest "a thing"'), 'work');
  assert.equal(signal('git add squiggles/ann/journal.md && git commit -m "ann wake"'), 'journal');
  assert.equal(signal('git add usage.mjs squiggles/ann/journal.md && git commit -m "x"'), 'work');
  assert.equal(signal('git commit -m "ann journal: quiet" squiggles/ann/journal.md'), 'journal');
  assert.equal(signal('git status && cat journal.md'), null);
  assert.equal(signal('echo "I will tell the lead"'), null);
});

test('usage reads limits, shares of use, weeks and turns that produced nothing', async () => {
  const at = (h) => now - h * H, row = (id, h, cost, x = {}) => ({ ts: at(h), id, provider: 'claude', in: 1000, out: 10, cost, ...x });
  const root = room({
    'cost.jsonl': lines([
      row('ann', 40, 1), row('ann', 30, 2), row('ann', 20, 4), row('ann', 10, 8), row('ann', 5, 16, { precheck: true }),
      row('bob', 9, 3, { provider: 'codex', cost: undefined }), row('ann', 24 * 9, 100)]),
    'ann.jsonl': lines([
      { ts: at(40.5), k: 'tool', name: 'Bash', text: 'git add a.mjs && git commit -m x' },
      { ts: at(30.5), k: 'tool', name: 'Bash', text: 'ls' },
      { ts: at(20.5), k: 'tool', name: 'Bash', text: 'git add squiggles/ann/journal.md && git commit -m j' },
      { ts: at(10.5), k: 'user', from: 'owner', text: 'hi' },
      { ts: at(3), k: 'rate', info: { rateLimitType: 'seven_day', utilization: 0.2, resetsAt: reset / 1000 } },
      { ts: at(2), k: 'rate', info: { rateLimitType: 'seven_day', resetsAt: reset / 1000, unifiedWindows: { seven_day: { utilization: 0.46, resetsAt: reset / 1000 } } } },
      { ts: at(1), k: 'rate', info: { rateLimitType: 'five_hour', utilization: 0.1, resetsAt: (now + H) / 1000 } }]),
    'tasks.json': JSON.stringify({ tasks: [
      { status: 'done', finished: '2026-11-03', finishedAt: at(20), merged: 'main@a' }, { status: 'done', finished: '2026-11-03', finishedAt: at(21) },
      { status: 'done', finished: '2026-11-03', finishedAt: at(22), kind: 'suggestion' }, { status: 'doing' }] }),
  });
  const u = await usage({ root, days: 7, weeks: 2, now });
  assert.equal(u.limits.seven_day.used, 0.46); assert.equal(u.limits.seven_day.resetsAt, reset);
  assert.deepEqual(Object.keys(u.limits), ['seven_day']); assert.doesNotMatch([report(u), ...u.text.lines, u.text.summary].join('\n'), /5-hour|\$/); // weekly only, no dollars
  assert.deepEqual(u.turns, { count: 5, nothing: { turns: 2, share: 0.1333 }, journal: { turns: 1, share: 0.2667 } }); // of $15; nothing: ann's $2 and bob, who isn't on Claude; precheck skipped
  const ann = u.squiggles[0]; assert.deepEqual([ann.id, ann.share, ann.turns, ann.nothing, ann.nothingShare, ann.reread], ['ann', 1, 4, 1, 0.1333, 100]);
  assert.equal(u.squiggles[1].id, 'bob');
  assert.deepEqual(u.tokens, { in: 5000, out: 50, reread: 100 });
  const w = u.weeks.at(-1);
  assert.equal(w.to, reset); assert.deepEqual([w.finished, w.merged, w.perMerged, w.limit], [2, 1, 0.46, 0.46]);
  assert.equal(w.claude, 31); // the precheck's $16 is real spend, so weeks keep it
  assert.equal(u.weeks[0].cost, 100);
  assert.match(describeLimit('Weekly', u.limits.seven_day), /^Weekly: 46% used, resets /);
  assert.match(describeWeek(w), /: 46% of the weekly limit, 2 finished, 1 merged, 46% per merged task$/);
  assert.match(describeWeek(u.weeks[0]), /: no limit reading, 0 finished/); assert.equal(u.weeks[0].soFar, false); assert.match(describeWeek(w), / so far: /);
  assert.match(describeSquiggle(ann), /^ann: 100% of Claude use, 4 turns, 1 produced nothing \(13%\), 100 read per 1 written$/);
  assert.match(describeSquiggle(u.squiggles[1]), /^bob: not on Claude, 1 turns/);
  fs.rmSync(root, { recursive: true });
});

test('usage says when a limit has no current reading, and when a week predates the cost log', async () => {
  const root = room({
    'ann.jsonl': lines([{ ts: now - 96 * H, k: 'rate', info: { rateLimitType: 'five_hour', resetsAt: (now - 90 * H) / 1000, unifiedWindows: { five_hour: { utilization: 0.03, resetsAt: (now - 90 * H) / 1000 }, seven_day: { utilization: 0.1, resetsAt: reset / 1000 } } } }]),
    'tasks.json': JSON.stringify({ tasks: [{ status: 'done', finished: '2026-11-03', merged: 'main@a' }] }) });
  const u = await usage({ root, weeks: 1, now });
  assert.equal(u.limits.seven_day.used, 0.1); // read from the window list on an event about another window
  const old = await usage({ root: room({ 'ann.jsonl': lines([{ ts: now - 96 * H, k: 'rate', info: { rateLimitType: 'seven_day', utilization: 0.03, resetsAt: (now - 90 * H) / 1000 } }]), 'tasks.json': JSON.stringify({ tasks: [] }) }), weeks: 1, now });
  assert.match(describeLimit('Weekly', old.limits.seven_day), /^Weekly: no current reading \(last 3% on Oct 3\d\)$/);
  assert.deepEqual([u.weeks[0].cost, u.weeks[0].perMerged], [null, 0.1]); // a limit reading needs no cost log
  assert.match(describeWeek(u.weeks[0]), /: 10% of the weekly limit, 1 finished, 1 merged, 10% per merged task$/);
  fs.rmSync(root, { recursive: true });
});

test('usage with no logs says so instead of failing', async () => {
  const root = room({}), u = await usage({ root, now });
  assert.deepEqual(u.limits, {}); assert.equal(u.turns.count, 0); assert.equal(u.weeks.length, 4); assert.equal(u.tokens.reread, null);
  assert.equal(describeLimit('Weekly', u.limits.seven_day), 'Weekly: no reading yet');
  fs.rmSync(root, { recursive: true });
});

test('other providers count turns, never Claude use', async () => {
  const row = (id, h, cost, provider) => ({ ts: now - h * H, id, provider, in: 100, out: 10, cost });
  const root = room({ 'cost.jsonl': lines([row('bob', 3, 5, 'codex'), row('ann', 2, 1, 'claude'), row('ann', 1, 3)]) }); // a row with no provider is Claude
  const u = await usage({ root, days: 7, weeks: 1, now }), by = Object.fromEntries(u.squiggles.map((s) => [s.id, s]));
  assert.deepEqual([by.ann.share, by.bob.share, by.bob.turns], [1, 0, 1]);
  assert.equal(u.weeks[0].claude, 4); assert.equal(u.weeks[0].cost, 9);
  fs.rmSync(root, { recursive: true });
});
