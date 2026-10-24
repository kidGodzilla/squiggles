import test from 'node:test'; import assert from 'node:assert/strict';
import { slowSync, timedSync } from '../slow.mjs';

test('slow sync calls are labelled cmd, repo, subcommand', () => {
  const f = timedSync(() => { const t = Date.now(); while (Date.now() - t < 210); });
  slowSync.length = 0;
  f('git', ['status', '--porcelain']); f('git', ['-C', '/x/myrepo', 'rev-parse', '--verify']); f('rg', ['-n', 'foo']);
  const quick = timedSync(() => {}); quick('git', ['log']);
  assert.deepEqual(slowSync.map((s) => s.replace(/ \d+ms$/, '')), ['git status', 'git myrepo rev-parse', 'rg foo']);
});
