import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWaits, probe, dur } from '../waits.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'waits-')), 'waits.json');
// A fake execFile: answers with the next canned result and records what ran.
const fake = (...outs) => { const ran = []; const exec = (cmd, args, o, cb) => { ran.push([cmd, ...args]); const r = outs.shift() || { out: '' }; cb(r.code ? Object.assign(new Error(r.err || 'x'), { code: r.code }) : null, r.out || '', r.err || ''); }; return { exec, ran }; };

test('dur reads s, m, h and bare minutes', () => {
  assert.equal(dur('90s'), 90000); assert.equal(dur('5m'), 300000); assert.equal(dur('4h'), 4 * 36e5); assert.equal(dur('3'), 180000); assert.equal(dur('', 7), 7);
  assert.throws(() => dur('soon'));
});

test('add refuses bad input and non-squiggles', () => {
  const w = createWaits({ file: tmp() });
  assert.throws(() => w.add({ what: 'x', file: '/tmp/a' }), /only a squiggle/);
  assert.throws(() => w.add({ by: 'ana', what: 'x' }), /one of/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', file: '/tmp/a', pid: 3 }), /one of/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', file: "/tmp/a'; rm -rf ~" }), /plain path/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', pid: '1; reboot' }), /number/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', pid: 1, host: '-oProxyCommand=x' }), /host/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', file: '~/a', host: 'ubuntu@1.2.3.4' }), /absolute/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', pid: 1, every: '5s' }), /every/);
  for (let i = 0; i < 5; i++) w.add({ by: 'ana', what: `x${i}`, pid: 1 });
  assert.throws(() => w.add({ by: 'ana', what: 'x6', pid: 1 }), /5 open/);
});

test('pid on a host: ssh with a fixed probe; gone ends it, an ssh failure does not', async () => {
  const f = fake({ code: 255, err: 'Connection timed out' }, { out: 'alive\n' }, { out: 'gone\n' });
  assert.deepEqual(await probe({ pid: 42, host: 'ubuntu@100.1.2.3' }, f), { fail: 'Connection timed out' });
  assert.deepEqual(await probe({ pid: 42, host: 'ubuntu@100.1.2.3' }, f), { done: false });
  assert.deepEqual(await probe({ pid: 42, host: 'ubuntu@100.1.2.3' }, f), { done: true, result: 'pid 42 on ubuntu@100.1.2.3 exited' });
  assert.deepEqual(f.ran[0], ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'ubuntu@100.1.2.3', 'kill -0 42 2>/dev/null && echo alive || echo gone']);
});

test('a /tmp file is read back masked; other files only reported', async () => {
  const f = fake({ out: 'present\n0\nTOKEN=abc123secret\n' }, { out: 'present\n' }, { out: 'absent\n' });
  const r = await probe({ file: '/tmp/scan.exit' }, f);
  assert.equal(r.done, true); assert.match(r.result, /^\/tmp\/scan\.exit appeared:\n0\nTOKEN=\[masked\]/);
  assert.equal((await probe({ file: '/var/log/x' }, f)).result, '/var/log/x appeared');
  assert.deepEqual(await probe({ file: '/tmp/none' }, f), { done: false });
  assert.match(f.ran[0][2], /head -c 2048 '\/tmp\/scan\.exit'/); assert.doesNotMatch(f.ran[1][2], /head/);
});

test('tick: ends done, failing and timed-out waits; skips paused squiggles; survives a reload', async () => {
  let t = 1e6; const file = tmp(), now = () => t;
  const w = createWaits({ file, now });
  const a = w.add({ by: 'ana', what: 'scan', pid: 1, task: 't1' }), b = w.add({ by: 'bo', what: 'build', file: '/tmp/b' }), c = w.add({ by: 'mo', what: 'slow', pid: 2, max: '1m' });
  t += 31000;
  assert.deepEqual(await w.tick({ exec: fake({ out: 'alive' }, { out: 'absent' }).exec, skip: (id) => id === 'mo' }), []);
  t += 2 * 6e4;
  const again = createWaits({ file, now }); // the server restarted
  const ended = await again.tick({ exec: fake({ out: 'gone' }, { code: 255, err: 'no route' }, { out: 'alive' }).exec });
  assert.deepEqual(ended.map((x) => [x.id, x.status]), [[a.id, 'done'], [c.id, 'timedout']]);
  assert.equal(again.get(b.id).fails, 1); assert.equal(again.get(b.id).lastFail, 'no route');
  assert.deepEqual(again.list().map((x) => x.id), [b.id]);
});

test('drop: the owner or a boss, once', () => {
  const w = createWaits({ file: tmp() }), a = w.add({ by: 'ana', what: 'x', pid: 1 });
  assert.throws(() => w.drop(a.id, { by: 'bo' }), /only ana/);
  assert.equal(w.drop(a.id, { by: 'lead', boss: true }).droppedBy, 'lead');
  assert.throws(() => w.drop(a.id, { by: 'ana' }), /dropped/);
});

test('read-back refuses /tmp links to files elsewhere', async () => {
  const d = fs.mkdtempSync('/tmp/waitlink-'), out = fs.mkdtempSync(path.join(os.homedir(), '.waitlink-'));
  try {
    fs.writeFileSync(path.join(out, 'secret'), 'SECRET-OUTSIDE'); fs.writeFileSync(path.join(d, 'ok.exit'), '0');
    fs.symlinkSync(path.join(out, 'secret'), path.join(d, 'sym')); fs.symlinkSync(out, path.join(d, 'dir'));
    let hard = true; try { fs.linkSync(path.join(out, 'secret'), path.join(d, 'hard')); } catch { hard = false; }
    const ok = await probe({ file: path.join(d, 'ok.exit') }); assert.match(ok.result, /appeared:\n0$/);
    for (const f of ['sym', 'dir/secret', ...(hard ? ['hard'] : [])]) {
      const r = await probe({ file: path.join(d, f) });
      assert.equal(r.done, true, f); assert.doesNotMatch(r.result, /SECRET/, f); assert.match(r.result, /appeared$/, f);
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

// A wait on a board task's status, no file or pid.
test('a task-state wait needs a task and a known status', () => {
  const w = createWaits({ file: tmp() });
  assert.throws(() => w.add({ by: 'ana', what: 'x', state: 'done' }), /--task/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', task: 't1', state: 'shipped' }), /status/);
  assert.throws(() => w.add({ by: 'ana', what: 'x', task: 't1', state: 'done', file: '/tmp/a' }), /one of/);
  const x = w.add({ by: 'ana', what: 'x', task: 't1', state: 'review', max: '3d' });
  assert.equal(x.state, 'review'); assert.ok(x.until - x.created >= 3 * 24 * 36e5);
});
test('a task-state wait ends when the task reaches the status, or is dropped', async () => {
  let t = 0; const w = createWaits({ file: tmp(), now: () => t });
  const st = { t1: 'doing', t2: 'todo' }, taskStatus = (id) => st[id];
  w.add({ by: 'ana', what: 'merge', task: 't1', state: 'done' }); w.add({ by: 'ana', what: 'gone', task: 't2', state: 'review' });
  t = 60000; assert.deepEqual(await w.tick({ taskStatus }), []);
  st.t1 = 'done'; delete st.t2; t = 120000;
  const ended = await w.tick({ taskStatus });
  assert.deepEqual(ended.map((e) => [e.task, e.status]), [['t1', 'done'], ['t2', 'done']]);
  assert.match(ended[0].result, /t1 is done/); assert.match(ended[1].result, /t2 is no longer on the board/);
});
