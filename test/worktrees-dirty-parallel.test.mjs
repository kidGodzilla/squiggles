// the worktrees listing ran git status on each worktree one after another (134 of them: 9-43 s). They run several at once,
// and each row still gets its own dirty count.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';

test('dirty checks overlap, and each worktree keeps its own count', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-par-'))), wt = path.join(dir, 'wt'), repo = path.join(dir, 'repo'), bin = path.join(dir, 'bin'), log = path.join(dir, 'status.log');
  process.env.AGENTS_WT = wt;
  const { createBoard } = await import('../board.mjs');
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (...a) => execFileSync(real, ['-C', repo, ...a], { stdio: 'pipe', env });
  fs.mkdirSync(repo); fs.mkdirSync(wt); g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a'), 'a'); g('add', 'a'); g('commit', '-q', '-m', 'base');
  const N = 8;
  for (let i = 0; i < N; i++) { const p = path.join(wt, `w${i}`); g('worktree', 'add', '-q', '-b', `b${i}`, p); for (let k = 0; k < i % 3; k++) fs.writeFileSync(path.join(p, `new${k}`), 'x'); }
  fs.writeFileSync(path.join(dir, 'goals.json'), JSON.stringify({ active: [{ id: 'g', title: 'G', repos: [repo] }] }));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify({ tasks: [] }));
  // status sleeps a little so overlap shows even on a loaded machine; starts and ends are logged
  fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ncase "$*" in *"status --porcelain"*) echo start >> '${log}'; sleep 0.3; '${real}' "$@"; r=$?; echo end >> '${log}'; exit $r;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const path0 = process.env.PATH; process.env.PATH = `${bin}:${path0}`;
  try {
    const list = await createBoard(dir, () => {}).worktrees();
    for (let i = 0; i < N; i++) assert.equal(list.find((x) => x.path === path.join(wt, `w${i}`))?.dirty, i % 3, `w${i}`);
    const seq = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    let at = 0, most = 0; for (const s of seq) { at += s === 'start' ? 1 : -1; most = Math.max(most, at); }
    assert.equal(seq.filter((s) => s === 'start').length, N);
    assert.ok(most > 1, `git status ran one at a time: ${seq.join(' ')}`);
  } finally { process.env.PATH = path0; fs.rmSync(dir, { recursive: true, force: true }); }
});
