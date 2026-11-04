// Watches run only approved text, pass the owner's guard, and wake only on change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWatches, sigOf, lineDiff, guardReason } from '../watches.mjs';

const H = os.homedir();
function setup({ guard = () => '' } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'watches-'));
  let t = 1e12;
  const clock = { now: () => t, step: (ms) => { t += ms; } };
  const W = createWatches({ file: `${d}/watches.json`, outDir: (o) => `${d}/${o}`, now: clock.now, guard });
  return { d, W, clock, done: () => fs.rmSync(d, { recursive: true }) };
}
// A fake exec answering from a queue of { code, out }.
const execOf = (q) => (cmd, args, o, cb) => { const r = q.shift(); setImmediate(() => cb(r.code ? Object.assign(new Error('x'), { code: r.code }) : null, r.out, '')); return {}; };

test('nothing runs until approved, and only the text the user saw', async () => {
  const { W, done } = setup();
  try {
    const w = W.add({ owner: 'alpha', cmd: 'node tools/count.mjs', cwd: H, every: '30m' });
    assert.equal(w.state, 'pending');
    let ran = 0;
    assert.deepEqual(await W.tick({ exec: () => { ran++; } }), []);
    assert.equal(ran, 0);
    assert.throws(() => W.approve(w.id, 'f'.repeat(64)), /changed since/);
    assert.equal(W.approve(w.id, w.hash).state, 'on');
  } finally { done(); }
});

test('first run is the baseline; same output is silent; a change wakes with a diff', async () => {
  const { W, clock, done } = setup();
  try {
    const w = W.add({ owner: 'alpha', cmd: 'echo hi', cwd: '/tmp', every: '10m', ignore: '\\d\\d:\\d\\d', task: 't1' });
    W.approve(w.id, w.hash);
    const q = [{ out: 'issues 3 at 10:00\n' }, { out: 'issues 3 at 10:10\n' }, { out: 'issues 4 at 10:20\n' }];
    const exec = execOf(q);
    assert.deepEqual(await W.tick({ exec }), [], 'baseline');
    clock.step(5 * 6e4); assert.deepEqual(await W.tick({ exec }), [], 'not due');
    clock.step(5 * 6e4); assert.deepEqual(await W.tick({ exec }), [], 'only the ignored time moved');
    clock.step(10 * 6e4); const [k] = await W.tick({ exec });
    assert.equal(k.owner, 'alpha'); assert.equal(k.task, 't1');
    assert.match(k.prompt, /- issues 3 at \n\+ issues 4 at/);
  } finally { done(); }
});

test('failures wake once at three, then once on recovery', async () => {
  const { W, clock, done } = setup();
  try {
    const w = W.add({ owner: 'beta', cmd: 'echo up', cwd: '/tmp', every: '5m' }); W.approve(w.id, w.hash);
    const exec = execOf([{ out: 'up' }, { code: 255, out: '' }, { code: 255, out: '' }, { code: 255, out: '' }, { code: 255, out: '' }, { out: 'up' }]);
    const wakes = [];
    for (let i = 0; i < 6; i++) { wakes.push(...await W.tick({ exec })); clock.step(5 * 6e4); }
    assert.equal(wakes.length, 2);
    assert.match(wakes[0].prompt, /failed 3 times/); assert.match(wakes[1].prompt, /works again/);
  } finally { done(); }
});

test('add refuses secrets, short intervals, and what the guard refuses; tightened guard pauses', async () => {
  let refuse = '';
  const { W, done } = setup({ guard: () => refuse });
  try {
    assert.throws(() => W.add({ owner: 'alpha', cmd: 'curl -H "Authorization: Bearer abcdefgh12345678" https://x', cwd: '/tmp' }), /secret-shaped/);
    assert.throws(() => W.add({ owner: 'alpha', cmd: 'echo', cwd: '/tmp', every: '1m' }), /between 5m/);
    assert.throws(() => W.add({ owner: 'alpha', cmd: 'echo', cwd: 'tmp' }), /absolute/);
    refuse = 'no'; assert.throws(() => W.add({ owner: 'alpha', cmd: 'echo', cwd: '/tmp' }), /guard refuses/); refuse = '';
    const w = W.add({ owner: 'alpha', cmd: 'echo', cwd: '/tmp' }); W.approve(w.id, w.hash);
    refuse = 'fenced';
    const [k] = await W.tick({ exec: () => { throw new Error('ran'); } });
    assert.match(k.prompt, /paused/); assert.equal(W.list()[0].state, 'paused');
  } finally { done(); }
});

test('at most five per squiggle; only the owner or a boss drops', () => {
  const { W, done } = setup();
  try {
    const ids = [1, 2, 3, 4, 5].map((i) => W.add({ owner: 'gamma', cmd: `echo ${i}`, cwd: '/tmp' }).id);
    assert.throws(() => W.add({ owner: 'gamma', cmd: 'echo 6', cwd: '/tmp' }), /already has 5/);
    assert.throws(() => W.drop(ids[0], { by: 'alpha' }), /only gamma/);
    W.drop(ids[0], { by: 'gamma' }); W.drop(ids[1], { boss: true });
    assert.equal(W.list({ owner: 'gamma' }).length, 3);
  } finally { done(); }
});

// A temp data dir: one non-Claude owner (codex model) with a private folder, one Claude owner.
function dataSetup() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'watches-data-'));
  const priv = path.join(data, 'private'); fs.mkdirSync(priv);
  fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ codex: true, privateDirs: [priv] }));
  for (const [id, model] of [['delta', 'gpt-6.1-sol'], ['alpha', 'opus']]) {
    fs.mkdirSync(path.join(data, 'squiggles', id), { recursive: true });
    fs.writeFileSync(path.join(data, 'squiggles', id, 'squiggle.json'), JSON.stringify({ model }));
  }
  return { data, priv, done: () => fs.rmSync(data, { recursive: true }) };
}
test('real guard: non-Claude owners meet the private fence, Claude owners the shared one', () => {
  const { data, priv, done } = dataSetup();
  try {
    assert.notEqual(guardReason('delta', `ls ${priv}`, data, data), '');
    assert.equal(guardReason('delta', 'git log -1', data, data), '');
    assert.equal(guardReason('alpha', `ls ${priv}`, data, data), '');
    assert.notEqual(guardReason('alpha', 'cat ~/.ssh/id_ed25519', data, data), '');
    assert.equal(guardReason('alpha', 'git log -1', data, data), '');
  } finally { done(); }
});
test('helpers', () => {
  assert.equal(sigOf('a 10:00', 0, '\\d\\d:\\d\\d'), sigOf('a 11:11', 0, '\\d\\d:\\d\\d'));
  assert.notEqual(sigOf('a', 0), sigOf('a', 1), 'exit code counts');
  assert.match(lineDiff('x'.repeat(5000), 'y'.repeat(5000), 100), /diff cut/);
});

// --ignore is part of what the user approves.
test('a changed --ignore needs re-approval', async () => {
  const { d, W, done } = setup();
  try {
    const a = W.add({ owner: 'alpha', cmd: 'echo hi', cwd: '/tmp' }), b = W.add({ owner: 'alpha', cmd: 'echo hi', cwd: '/tmp', ignore: '[\\s\\S]*' });
    assert.notEqual(a.hash, b.hash, 'the ignore is in the approved hash');
    W.approve(b.id, b.hash);
    const f = `${d}/watches.json`, s = JSON.parse(fs.readFileSync(f, 'utf8'));
    s.watches.find((w) => w.id === b.id).ignore = 'x'; fs.writeFileSync(f, JSON.stringify(s));
    await W.tick({ exec: execOf([{ code: 0, out: 'hi' }]) });
    assert.equal(W.list().find((w) => w.id === b.id).state, 'paused');
  } finally { done(); }
});
test('list names a non-Claude owner\'s provider', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'watches-'));
  try {
    const W = createWatches({ file: `${d}/w.json`, outDir: (o) => `${d}/${o}`, guard: () => '', providerFor: (o) => (o === 'delta' ? 'codex' : '') });
    W.add({ owner: 'delta', cmd: 'ls', cwd: '/tmp' }); W.add({ owner: 'alpha', cmd: 'ls', cwd: '/tmp' });
    assert.deepEqual(W.list().map((w) => w.runsFor || ''), ['codex', '']);
  } finally { fs.rmSync(d, { recursive: true }); }
});
test('the default provider reads the data dir; an unknown owner counts as non-Claude', () => {
  const { data, done } = dataSetup();
  try {
    const W = createWatches({ file: `${data}/w.json`, outDir: (o) => `${data}/${o}`, data, guard: () => '' });
    for (const owner of ['delta', 'alpha', 'nobody']) W.add({ owner, cmd: 'ls', cwd: '/tmp' });
    assert.deepEqual(W.list().map((w) => w.runsFor || ''), ['codex', '', 'unknown']);
  } finally { done(); }
});
// watch add refuses for a non-Claude owner what its own shell would.
test('watch add refuses private-data commands for a non-Claude owner', () => {
  const { data, priv, done } = dataSetup();
  try {
    const W = createWatches({ file: `${data}/w.json`, outDir: (o) => `${data}/${o}`, data });
    for (const [cmd, cwd] of [['ls', priv], [`cat ${priv}/x.json`, data], ['ls private', data]])
      assert.throws(() => W.add({ owner: 'delta', cmd, cwd }), /guard refuses/, `delta: ${cmd} in ${cwd}`);
    assert.equal(W.add({ owner: 'delta', cmd: 'git log -1', cwd: data }).state, 'pending');
    assert.equal(W.add({ owner: 'alpha', cmd: 'ls', cwd: priv }).state, 'pending');
  } finally { done(); }
});
// A long watch (up to 10 min) gets its own timeout and doesn't hold back the rest.
test('--timeout sets the run limit, 10s to 15m', async () => {
  const { W, clock, done } = setup();
  try {
    assert.throws(() => W.add({ owner: 'alpha', cmd: 'node a.js', cwd: H, timeout: '20m' }), /--timeout/);
    assert.throws(() => W.add({ owner: 'alpha', cmd: 'node a.js', cwd: H, timeout: '5s' }), /--timeout/);
    const w = W.add({ owner: 'alpha', cmd: 'node a.js', cwd: H, timeout: '10m' });
    const d = W.add({ owner: 'alpha', cmd: 'node b.js', cwd: H });
    assert.equal(w.timeout, 600000);
    W.approve(w.id, w.hash); W.approve(d.id, d.hash);
    const seen = {};
    await W.tick({ exec: (c, args, o, cb) => { seen[args[1]] = o.timeout; setImmediate(() => cb(null, 'x', '')); return {}; } });
    assert.deepEqual(seen, { 'node a.js': 600000, 'node b.js': 60000 });
  } finally { done(); }
});

test('a slow watch runs beside the others and is not started twice while in flight', async () => {
  const { W, clock, done } = setup();
  try {
    const s = W.add({ owner: 'alpha', cmd: 'slow', cwd: H, every: '5m', timeout: '10m' });
    const f = W.add({ owner: 'alpha', cmd: 'fast', cwd: H, every: '5m' });
    W.approve(s.id, s.hash); W.approve(f.id, f.hash);
    const runs = { slow: 0, fast: 0 }; let release;
    const exec = (c, args, o, cb) => { const k = args[1]; runs[k]++; if (k === 'slow') release = () => cb(null, 'slow out', ''); else setImmediate(() => cb(null, `fast ${runs.fast}`, '')); return {}; };
    const first = W.tick({ exec });
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(W.list().find((w) => w.id === f.id).lastRun, 'fast ran while slow is still running');
    clock.step(6 * 6e4);
    const wakes = await W.tick({ exec });
    assert.deepEqual(runs, { slow: 1, fast: 2 });
    assert.equal(wakes.length, 1, 'fast changed and woke; slow was skipped, not rerun');
    release(); await first;
    assert.ok(W.list().find((w) => w.id === s.id).lastRun);
  } finally { done(); }
});

// Delta scripts print new alerts once, then nothing. --added wakes on new lines only.
test('--added wakes when output gains lines, not when it empties; the flag is in the hash', async () => {
  const { W, clock, done } = setup();
  try {
    const plain = W.add({ owner: 'alpha', cmd: 'node alerts.js', cwd: H });
    const w = W.add({ owner: 'alpha', cmd: 'node alerts.js', cwd: H, added: true });
    assert.equal(w.added, true);
    assert.notEqual(w.hash, plain.hash, 'the mode is approved too');
    W.drop(plain.id, { boss: true });
    W.approve(w.id, w.hash);
    const q = [{ out: 'a\n' }, { out: '' }, { out: 'b\n' }, { out: 'b\nc\n' }, { out: '' }];
    const wakes = [];
    for (let i = 0, n = q.length; i < n; i++) { wakes.push((await W.tick({ exec: execOf(q) })).length); clock.step(31 * 6e4); }
    assert.deepEqual(wakes, [0, 0, 1, 1, 0], 'baseline, emptied, b new, c new, emptied');
  } finally { done(); }
});

test('the approve route refuses a squiggle and needs the unlocked owner before it approves', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const r = src.slice(src.indexOf("if (b.op === 'approve') {\n          if (who) return json(res, { error: `only ${USER} approves a watch"));
  const refuse = r.indexOf('if (who)'), gate = r.indexOf('pass.owner(req)'), go = r.indexOf('watches.approve(');
  assert.ok(refuse >= 0 && refuse < gate && gate < go);
});

// --ignore runs on the server's main thread, so a catastrophic regex must not hang the room.
test('a catastrophic --ignore pauses the watch inside a second and tells the owner', async () => {
  const { W, done } = setup();
  try {
    const w = W.add({ owner: 'alpha', cmd: 'echo hi', cwd: '/tmp', ignore: '(a+)+$' });
    W.approve(w.id, w.hash);
    const t = Date.now();
    const wakes = await W.tick({ exec: execOf([{ code: 0, out: `${'a'.repeat(40)}!` }]) });
    assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
    const after = W.list({ owner: 'alpha' })[0];
    assert.equal(after.state, 'paused');
    assert.match(after.why, /--ignore/);
    assert.equal(wakes.length, 1);
    assert.match(wakes[0].prompt, /--ignore/);
  } finally { done(); }
});

test('a slow --ignore on the old output also pauses, with no crash', async () => {
  const { W, clock, done } = setup();
  try {
    const w = W.add({ owner: 'alpha', cmd: 'echo hi', cwd: '/tmp', ignore: '(a+)+$' });
    W.approve(w.id, w.hash);
    const exec = execOf([{ code: 0, out: 'fine' }, { code: 0, out: `${'a'.repeat(40)}!` }]);
    await W.tick({ exec });
    assert.equal(W.list({ owner: 'alpha' })[0].state, 'on', 'harmless output passes');
    clock.step(31 * 6e4);
    const t = Date.now();
    await W.tick({ exec });
    assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
    assert.equal(W.list({ owner: 'alpha' })[0].state, 'paused');
  } finally { done(); }
});
