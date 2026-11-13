// The Merge tab ran about a dozen git processes per review row (85 rows: 20-100 s under load). Refs come from one
// call per repo, and what git says about a branch against its base is kept while both tips stay put.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { createBoard } from '../board.mjs';

test('a second listing runs a handful of git processes, not one batch per row, and still sees moved tips', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merges-count-')), repo = path.join(dir, 'repo'), bin = path.join(dir, 'bin'), log = path.join(dir, 'git.log');
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (...a) => execFileSync(real, ['-C', repo, ...a], { stdio: 'pipe', env });
  const commit = (f, m) => { fs.writeFileSync(path.join(repo, f), m); g('add', f); g('commit', '-q', '-m', m); };
  fs.mkdirSync(repo); g('init', '-q', '-b', 'main'); commit('a', 'base');
  const N = 12, tasks = [];
  for (let i = 0; i < N; i++) { g('checkout', '-q', '-b', `b${i}`, 'main'); commit(`f${i}`, `work ${i}`); tasks.push({ id: `t${i}`, title: `w${i}`, goal: 'g', status: 'review', repo, branch: `b${i}` }); }
  g('checkout', '-q', 'main'); commit('m', 'main moves');
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', merge: 'gated' }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks }));
  fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path0 = process.env.PATH; process.env.PATH = `${bin}:${path0}`;
  const count = () => { try { return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  try {
    const b = createBoard(dir, () => {});
    const first = await b.merges(), c1 = count();
    assert.equal(first.length, N); assert.ok(first.every((r) => r.ahead === 1 && r.behind === 1 && !r.error), JSON.stringify(first[0]));
    const second = await b.merges(), c2 = count() - c1;
    assert.deepEqual(second.map((r) => [r.id, r.ahead, r.behind, r.log.length]), first.map((r) => [r.id, r.ahead, r.behind, r.log.length]));
    assert.ok(c2 <= 8, `second listing ran ${c2} git processes for ${N} rows (first ran ${c1}): ${fs.readFileSync(log, 'utf8').split('\n').slice(c1, c1 + 12).join(' | ')}`);
    // A branch gains a commit and main moves again: both show on the next listing.
    g('checkout', '-q', 'b3'); commit('g3', 'more'); g('checkout', '-q', 'main'); commit('m2', 'main again');
    const third = Object.fromEntries((await b.merges()).map((r) => [r.id, r]));
    assert.equal(third.t3.ahead, 2); assert.equal(third.t3.behind, 2); assert.equal(third.t0.behind, 2);
    // A branch merged into main outside the tab is still swept.
    g('merge', '-q', '--no-edit', 'b5');
    const fourth = await b.merges();
    assert.ok(!fourth.some((r) => r.id === 't5')); assert.match(b.tasks().find((t) => t.id === 't5').note, /merged outside into main/);
  } finally { process.env.PATH = path0; fs.rmSync(dir, { recursive: true, force: true }); }
});
