// An unknown command prints usage and exits 1, not a crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('unknown command prints usage', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/agents.mjs', import.meta.url)), 'nosuchcommand'], { encoding: 'utf8', env: { ...process.env, PORT: '1' } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^usage: agents\.mjs /);
  assert.match(r.stdout, /peer join "<code>"/);
  assert.equal(r.stderr, '');
});
