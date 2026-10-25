// callerSquiggle maps a request's process tree to r.proc.pid; every runtime's handle must carry the pid.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('every runtime turn handle carries a pid', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const sets = src.match(/^\s*r\.proc = .*$/gm).filter((l) => !/= null/.test(l));
  assert.ok(sets.length >= 2, `found ${sets.length}`);
  for (const l of sets) assert.match(l, /r\.proc = proc;|pid: /, l.trim().slice(0, 80));
});
