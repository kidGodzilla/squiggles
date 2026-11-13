// The owned-file write check must stay linear when a long command names the file. Codex runs the tool when a hook times out,
// so a slow check is an open fence. The old regexes took 82 s on 200 KB of > and 32 s on a tail of cp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { commandReason, REASONS } from '../fence.mjs';

const N = 200000, f = 'squiggle' + '.json';
// CPU time, so a loaded machine doesn't count against the check.
const fast = (name, fn) => { const t = process.cpuUsage(); const r = fn(); const { user, system } = process.cpuUsage(t), ms = (user + system) / 1000; assert.ok(ms < 1000, `${name}: ${Math.round(ms)} ms`); return r; };

test('200 KB commands naming the file take under 1 s, and the verdict is unchanged', () => {
  const cases = {
    gt: ['>'.repeat(N) + ' x ' + f, ''],
    cpTail: ['echo ' + f + ' ' + 'cp '.repeat(N / 3), ''],
    segments: ['sed;'.repeat(N / 4) + ' ' + f, ''],
    flagless: ['sed '.repeat(N / 4) + f + ';', ''],
    names: [(f + ';').repeat(N / 14), ''],
    nodeTail: ['node -e '.repeat(N / 8) + 'x ' + f, REASONS.squiggle],
    gtNames: [('>' + f).repeat(N / 14), REASONS.squiggle],
    inPlace: ['sed '.repeat(N / 4) + ' -i x ' + f, REASONS.squiggle],
  };
  for (const [k, [c, want]] of Object.entries(cases)) assert.equal(fast(k, () => commandReason(c, '/tmp')), want, k);
});

test('each write shape still refuses, and reads stay open', () => {
  for (const c of [`echo x > ${f}`, `echo x >|${f}`, `echo x >> a/${f}`, `cp a ${f}`, `sed -i s/a/b/ ${f}`, `perl -pi -e 1 ${f}`, `node -e "fs.writeFileSync('${f}')"`, `python3 - <<EOF\n${f}\nEOF`])
    assert.equal(commandReason(c, '/tmp'), REASONS.squiggle, c);
  for (const c of [`cat ${f}`, `jq . ${f}`, `echo > x; cat ${f}`, `cp a b; cat ${f}`, `sed -n 1p ${f}`])
    assert.equal(commandReason(c, '/tmp'), '', c);
});
