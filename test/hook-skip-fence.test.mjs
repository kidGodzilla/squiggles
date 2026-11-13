// Squiggles can't skip the pre-commit check with --no-verify / -n, a moved core.hooksPath or a cleared AGENTS_ID.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandReason, REASONS } from '../fence.mjs';

const HOOKS = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'bin', 'hooks');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe' });

test('fence: commit hook skips refused in a repo running our hook, allowed elsewhere', () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hookskip-')));
  const ours = path.join(d, 'ours'), theirs = path.join(d, 'theirs'), wt = path.join(d, 'wt');
  for (const r of [ours, theirs]) { fs.mkdirSync(r); git(r, 'init', '-q'); git(r, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x'); }
  git(ours, 'config', 'core.hooksPath', HOOKS);
  git(ours, 'worktree', 'add', '-q', '--detach', wt);
  const sub = path.join(ours, 'sub'); fs.mkdirSync(sub);
  try {
    const skip = ['git commit --no-verify -m x', 'git commit -n -m x', 'git commit -anm x', 'git commit -m "a b" --no-verif',
      'git add . && git commit -qn -m x', 'git -c user.name=x commit -n -m x', "alias g='git'; g commit -n -m x"];
    for (const c of skip) {
      for (const cwd of [ours, sub, wt]) assert.equal(commandReason(c, cwd), REASONS.hooks, `${c} in ${cwd}`);
      assert.equal(commandReason(c, theirs), '', `${c} in theirs`);
    }
    assert.equal(commandReason(`git -C ${ours} commit -n -m x`, theirs), REASONS.hooks);
    assert.equal(commandReason(`cd ${ours} && git commit --no-verify -m x`, theirs), REASONS.hooks);
    // Not a skip: -n inside a message, -m taking n as its value, --amend, commit-tree, other git commands.
    for (const c of ['git commit -m "fix -n flag"', 'git commit -mn', 'git commit --amend -m x', 'git commit -am x', 'git log -n 3', 'git clean -n',
      'git commit-tree HEAD^{tree} -m x', 'git config --get core.hooksPath', 'git config core.hooksPath', 'git status'])
      assert.equal(commandReason(c, ours), '', c);
    // Moving the hook or the id: refused anywhere.
    for (const c of ['git -c core.hooksPath=/dev/null commit -m x', 'git config core.hooksPath /tmp/h', 'git config --unset core.hooksPath',
      'git config --local core.hookspath ""', 'AGENTS_ID= git commit -m x', 'env -u AGENTS_ID git commit -m x', 'unset AGENTS_ID; git commit -m x',
      'env -i PATH=$PATH git commit -m x', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/x git commit -m x'])
      assert.equal(commandReason(c, theirs), REASONS.hooks, c);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
