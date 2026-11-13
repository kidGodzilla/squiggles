// Git history in a repo holding a private folder, however git is reached: an alias, a repo named by GIT_DIR, a subcommand
// outside the reviewed list, or flags git gets from xargs or a substitution.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateReason, privateRules, REASONS } from '../fence.mjs';

const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phf-'))), R = `${H}/repo`, away = `${H}/app`, P = REASONS.private;
for (const d of ['repo/secret', 'repo/docs', 'app']) fs.mkdirSync(`${H}/${d}`, { recursive: true });
fs.writeFileSync(`${R}/secret/a.md`, 'x'); fs.writeFileSync(`${R}/docs/b.md`, 'y');
execFileSync('git', ['init', '-q'], { cwd: R });
for (const [k, v] of [['lp', 'log -p'], ['s', 'status'], ['sh', '!cat secret/a.md']]) execFileSync('git', ['-C', R, 'config', `alias.${k}`, v]);
after(() => fs.rmSync(H, { recursive: true, force: true }));
const r = privateRules({ privateDirs: ['repo/secret'] }), g = (c, at = R) => privateReason('bash', { command: c }, at, H, r);

test('an alias is read as what it runs', () => {
  for (const c of ['git -c alias.x=log x -p', 'git -c alias.x="log -p" x', "git -c 'alias.x=show' x", 'git lp', 'git sh', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.y GIT_CONFIG_VALUE_0=show git y'])
    assert.equal(g(c), P, c);
  for (const c of ['git s', 'git -c alias.x=status x', 'git -c alias.x=log x --oneline']) assert.equal(g(c), '', c);
});

test('a repo named by GIT_DIR or GIT_WORK_TREE', () => {
  for (const c of [`GIT_DIR=${R}/.git git log -p`, `env GIT_DIR=${R}/.git git show`, `export GIT_DIR=${R}/.git; git log -p`, `GIT_WORK_TREE=${R} git -C ${H} log -p`, 'GIT_DIR=$X git log -p'])
    assert.equal(g(c, away), P, c);
  assert.equal(g(`GIT_DIR=${R}/.git git log --oneline`, away), '');
});

test('a subcommand outside the list is refused there', () => {
  for (const c of ['git range-diff a...b', 'git pack-objects --stdout', 'git difftool', 'git fsck --lost-found', 'git worktree add /tmp/w', 'git clone . /tmp/c', 'git diff-pairs', 'git $S'])
    assert.equal(g(c), P, c);
  assert.equal(g(`git clone ${R} /tmp/c`, away), P);
  for (const c of ['git status', 'git worktree list', 'git ls-files', 'git rebase main', 'git rev-parse HEAD']) assert.equal(g(c), '', c);
  for (const c of ['git range-diff a...b', 'git difftool', 'git clone https://example.com/x.git']) assert.equal(g(c, away), '', c);
});

test('flags from xargs, a substitution or a variable read as a patch', () => {
  for (const c of ['echo -p | xargs git log', 'git log $(echo -p)', 'git log `echo -p`', 'git log "$F"', 'git log -$P', 'git show --stat $(echo -p)'])
    assert.equal(g(c), P, c);
  for (const c of ['git log --oneline', 'echo -p | xargs git log']) assert.equal(g(c, away), '', c);
});
