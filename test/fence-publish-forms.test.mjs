// The publish check reads git push however the command reaches it: through a shell function, a substituted subcommand or
// program name, or an alias set earlier in git config (in the repo, or written straight into its config file).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commandReason, REASONS } from '../fence.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-home-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-repo-'));
after(() => { for (const d of [home, repo]) fs.rmSync(d, { recursive: true, force: true }); });
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
git('init', '-q');
for (const [k, v] of [['p', 'push'], ['q', 'p'], ['r', '!git push origin'], ['s', 'status'], ['l', 'log --oneline']]) git('config', `alias.${k}`, v);
const reason = (c, cwd = os.tmpdir()) => commandReason(c, cwd, home);

test('a shell function that runs git', () => {
  for (const c of ['f() { git "$@"; }; f push', 'function f { git "$@"; }; f push origin', 'g() { command git "$@"; }; g push', 'f() ( git "$@" ); f push'])
    assert.equal(reason(c), REASONS.push, c);
  assert.equal(reason('f() { git "$@"; }; f status'), '');
});

test('a subcommand or program built by substitution', () => {
  for (const c of ['git pu$(echo sh)', 'git pu`echo sh`', 'git pu${x}sh', '$(echo git) push', '`which git` push', '"$(command -v git)" push', 'git "$(echo push)"'])
    assert.equal(reason(c), REASONS.push, c);
  assert.equal(reason('git log $(git rev-parse HEAD)'), '');
});

test('an alias already in the repo config', () => {
  for (const c of ['git p', 'git q origin', 'git r']) {
    assert.equal(reason(c, repo), REASONS.push, c);
    assert.equal(reason(c), '', `${c} where no alias is set`);
  }
  assert.equal(reason(`git -C ${repo} p`), REASONS.push);
  assert.equal(reason(`cd ${repo} && git q`), REASONS.push);
  for (const c of ['git s', 'git l', 'git status', 'git log -1']) assert.equal(reason(c, repo), '', c);
});

test('an alias written straight into a git config file', () => {
  for (const c of [String.raw`printf '[alias]\n p = push\n' >> .git/config; git p`, 'echo "[alias] p = push" >> ~/.gitconfig', 'cat a >> ~/.config/git/config; git push'])
    assert.equal(reason(c), REASONS.push, c);
  assert.equal(reason('cat .git/config'), '');
});
