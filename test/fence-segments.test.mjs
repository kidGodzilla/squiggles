// The private fence must stay linear on a command made of many short segments: each segment start
// once rescanned the rest of the command, so 64 KB of `sed;` took 12 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { privateReason, REASONS } from '../fence.mjs';

const home = os.homedir(), f = 'squiggle' + '.json';
const rules = { dirs: ['/tmp/private-x'], tools: [], remote: false };
const own = (command) => privateReason('Bash', { command }, home, home, rules);
// CPU time, so a loaded machine doesn't count against the check.
const ms = (fn) => { const t = process.cpuUsage(); const r = fn(); const { user, system } = process.cpuUsage(t); return [r, (user + system) / 1000]; };

test('60 KB of short segments is read in under 1 s', () => {
  const N = 60000;
  for (const c of ['sed;'.repeat(N / 4) + f, (f + ';').repeat(N / 14), 'a=b;'.repeat(N / 4), '-x;'.repeat(N / 3), 'a/b;'.repeat(N / 4), 'env a&'.repeat(N / 6), 'x|'.repeat(N / 2)]) {
    const [, t] = ms(() => own(c));
    assert.ok(t < 1000, `${JSON.stringify(c.slice(0, 12))}: ${Math.round(t)} ms`);
  }
});

test('segments still reach a hidden shell or built program', () => {
  assert.equal(own('ls; /bin/sh -c "cat /tmp/private-x/a"'), REASONS.private);
  assert.ok(own('ls; a=1 env $(echo cat) /tmp/private-x/a'));
  assert.ok(own('ls; -x /usr/bin/$(echo cat) /tmp/private-x/a'));
  assert.equal(own('ls; sed -n 1p a; echo ok'), '');
});

test('a variable set many times is read with each value once', () => {
  const sets = 'p=a;'.repeat(10000);
  const [hit, t] = ms(() => own(`${sets} p=private-x; cat /tmp/$p/a`));
  assert.equal(hit, REASONS.private);
  assert.ok(t < 1000, `${Math.round(t)} ms`);
  assert.equal(own(`${sets} cat /tmp/$p/a`), '');
  assert.equal(own('for p in a private-x; do cat /tmp/${p}/a; done'), REASONS.private);
});

test('a script run after a write to it is still refused', () => {
  assert.equal(own('ls; echo x > ./run.sh; ./run.sh'), REASONS.private);
  assert.equal(own('ls; ./nope-run.sh; echo x > ./nope-run.sh'), '');
});
