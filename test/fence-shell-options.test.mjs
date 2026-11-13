// The checks for code piped into a shell or passed with -c must stay linear on long runs of shell options.
// A hook that hangs times out, and some agents read a timeout as allow.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { privateReason, commandReason, REASONS } from '../fence.mjs';

const rules = { dirs: ['/tmp/private-x'], tools: [], remote: false };
const strict = (command) => privateReason('Bash', { command }, '/tmp', os.homedir(), rules);
// CPU time, so a loaded machine doesn't count against the check.
const ms = (fn) => { const t = process.cpuUsage(); fn(); const { user, system } = process.cpuUsage(t); return (user + system) / 1000; };

test('a shell with 40 option pairs is read in under 50 ms', () => {
  for (const tok of [' -o -o', ' -o x', ' -o 2>x', ' -o a2>x', ' -a>>', ' >a1>a', ' --rcfile a>b', ' +o -o'])
    for (const c of [`echo | sh${tok.repeat(40)} "`, `sh${tok.repeat(40)} -c x y`, `bash${tok.repeat(40)} "`]) {
      const t = ms(() => { strict(c); commandReason(c, '/tmp'); });
      assert.ok(t < 50, `${JSON.stringify(c.slice(0, 20))}: ${Math.round(t)} ms`);
    }
});

test('options before the shell still leave piped and -c code checked', () => {
  assert.equal(strict('echo cat /tmp/private-x/a | bash -o pipefail -o errexit'), REASONS.private);
  assert.equal(strict('echo cat /tmp/private-x/a | sh -x 2>log'), REASONS.private);
  assert.equal(strict("bash -o pipefail -e -c 'cat /tmp/private-x/a'"), REASONS.private);
  assert.equal(strict("bash --rcfile f -c 'cat /tmp/private-x/a'"), REASONS.private);
  assert.equal(strict("bash -o pipefail -c 'ls /tmp'"), '');
});

test('a command over 64 KB is refused unread', () => {
  const big = 'echo ' + 'a'.repeat(64 * 1024);
  assert.equal(commandReason(big, '/tmp'), REASONS.long);
  assert.equal(strict(big), REASONS.long);
  assert.equal(commandReason('echo ' + 'a'.repeat(1000), '/tmp'), '');
});

test('owned files: output flags and archive tools count as writes, reads stay open', () => {
  const f = 'squiggle' + '.json';
  for (const c of [`sort -o ${f} a`, `sort --output=${f} a`, `curl -o ${f} http://x`, `curl -sO http://x/${f}`, `wget -O ${f} http://x`, `wget --output-document ${f} http://x`,
    `uniq a ${f}`, `tar xf a.tar ${f}`, `unzip a.zip ${f}`, `sed --in-place s/a/b/ ${f}`])
    assert.equal(commandReason(c, '/tmp'), REASONS.squiggle, c);
  for (const c of [`sort ${f}`, `sort -k2 ${f}`, `curl -d @${f} http://x`, `sed -n 1p ${f}`])
    assert.equal(commandReason(c, '/tmp'), '', c);
});
