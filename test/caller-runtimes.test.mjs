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

test('callerSquiggle also maps the Codex app-server pid', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function callerSquiggle'), src.indexOf('async function merger'));
  assert.match(fn, /r\.cx\?\.proc\?\.pid/);
  assert.equal([...src.matchAll(/if \(r\.cx === cx\) r\.cx = null/g)].length, 1, 'the app-server clears r.cx on exit');
});
