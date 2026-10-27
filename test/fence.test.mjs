import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fencedPath, fencedCommand, mentionsHome, commandReason, pathReason, REASONS } from '../fence.mjs';
import { check } from '../cursor/guard.mjs';

const H = os.homedir();
test('fence: paths in any case and through symlinks', () => {
  for (const p of ['~/downloads/x', '~/DOCUMENTS', `${H}/Desktop`, '~/Desktop/../Downloads/a']) assert.ok(fencedPath(p, '/tmp'), p);
  for (const p of ['~/DownloadsArchive/a', '/tmp/x', '~/code/documents/a']) assert.ok(!fencedPath(p, '/tmp'), p);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-')), l = path.join(d, 'dl');
  fs.symlinkSync(path.join(H, 'Downloads'), l);
  assert.ok(fencedPath(path.join(l, 'x'), '/tmp'));
  fs.rmSync(d, { recursive: true });
});

test('fence: shell forms that got past the old check', () => {
  for (const c of ['cd ~ && cat Downloads/x', 'cat ~/Down*/x', 'cat "$HOME"/Desktop/x', 'ls ~/downloads', 'ls ${HOME}/D*', 'ls ~/*', `cat ${H}/documents/a`])
    assert.ok(fencedCommand(c, '/tmp'), c);
  assert.ok(fencedCommand('ls Do*', H)); assert.ok(!fencedCommand('ls Do*', '/tmp/w'));
  for (const c of ['git status', 'ls *.js', 'cat my-documents.md', 'echo ~/code']) assert.ok(!fencedCommand(c, '/tmp'), c);
});

test('fence: file contents only trip on home paths', () => {
  assert.ok(!mentionsHome('Store documents in a folder'));
  assert.ok(mentionsHome('see ~/Documents/plan'));
  assert.ok(!check({ tool_input: { path: '/tmp/w/README.md', fileText: 'Downloads and documents' }, cwd: '/tmp/w' }));
  assert.ok(check({ tool_input: { command: 'cd ~ && cat downloads/x' }, cwd: '/tmp/w' }));
});

test('fence: ~/.ssh and git push', () => {
  for (const c of ['git push', 'git -C /tmp/r push origin main', 'make && git push dokku main', '(cd r; git -c a=b push)', 'cat ~/.ssh/id_ed25519', 'cp "$HOME"/.SSH/config x'])
    assert.ok(commandReason(c, '/tmp'), c);
  assert.equal(commandReason('cat .ssh/config', H), REASONS.ssh); assert.equal(commandReason('cat .ssh/config', '/tmp'), '');
  for (const c of ['git commit -m "push fix"', 'git status', 'npm run push-notes', 'echo ~/.sshd']) assert.equal(commandReason(c, '/tmp'), '', c);
  assert.equal(pathReason('~/.ssh/known_hosts', '/tmp'), REASONS.ssh); assert.equal(pathReason('~/Downloads', '/tmp'), REASONS.dirs);
  assert.equal(check({ tool_input: { command: 'git push' }, cwd: '/tmp/w' }), REASONS.push);
  assert.equal(check({ tool_input: { file_path: `${H}/.ssh/id_rsa` }, cwd: '/tmp/w' }), REASONS.ssh);
});

test('fence: quotes, backslashes and a bare cd', () => {
  for (const c of ['cat ~/Down"loads"/x', "cat ~/'Desk'top/a", 'cat ~/D\\ocuments/a', 'cd; ls Docu*', 'cd ~/ && ls De*', 'cd $HOME; cat Do*/x', 'x=$(cd; ls D*)'])
    assert.ok(fencedCommand(c, '/tmp/w'), c);
  for (const c of ['cd; cat .ssh/id_rsa', 'cat ~/".ssh"/config', 'g"it" push', 'git pu\\sh']) assert.ok(commandReason(c, '/tmp/w'), c);
  for (const c of ['cd src && ls *.js', 'cd; ls *.md', 'echo "push it"', 'cd ~/code; git status']) assert.equal(commandReason(c, '/tmp/w'), '', c);
});

test('fence: relative cd to home, and push by alias, variable or send-pack', () => {
  const sub = path.join(H, 'code');
  for (const c of ['cd ..; ls Docu*', 'pushd ~ >/dev/null; ls D*', 'cd ../.. && cd ~ 2>/dev/null && ls De*', 'cd -; ls D*', 'cd $DIR; ls Do*'])
    assert.ok(fencedCommand(c, sub), c);
  assert.ok(commandReason('cd ..; cat .ssh/config', sub), 'relative cd then .ssh');
  for (const c of ['git config alias.p push && git p', 'git -c alias.up=push up', 'c=push; git $c', 'g=git; $g push origin', 'git send-pack origin main', 'eval "git push"'])
    assert.equal(commandReason(c, '/tmp/w'), REASONS.push, c);
  for (const c of ['cd src && ls *.js', 'cd ../lib; ls D*.md', 'git commit -m "push $x"'.replace('$x', 'fix')])
    assert.equal(commandReason(c, sub), '', c);
});

test('fence: relative paths and globs to home folders, cd spelled other ways, subtree and lfs push', () => {
  const sub = path.join(H, 'code');
  for (const c of ['ls ../D*', 'cat ../Docu*/x', 'builtin cd ..; ls D*', 'command cd .. && ls De*', 'env -C .. ls D*', 'cd ~someone; ls D*'])
    assert.equal(commandReason(c, sub), REASONS.dirs, c);
  for (const c of ['cat ../.ssh/config', 'cp x ../.ssh/authorized_keys', 'ls ../.ss*']) assert.equal(commandReason(c, sub), REASONS.ssh, c);
  for (const c of ['git subtree push --prefix=d origin main', 'git lfs push origin main']) assert.equal(commandReason(c, sub), REASONS.push, c);
  for (const c of ['ls ../*.md', 'cat ../code/D*.txt', 'cat ./notes/.sshrc', 'git subtree pull --prefix=d origin main', 'cd ../lib && ls'])
    assert.equal(commandReason(c, sub), '', c);
});

test('fence: fenced names in prose pass outside home, still block at home', () => {
  const P = path.join(H, 'proj');
  assert.equal(commandReason('node bin/agents.mjs task ship x1 "docs match; documents retirement"', P), '');
  assert.equal(commandReason('echo keeps desktop parity >> j.md', P), '');
  assert.equal(commandReason('echo .ssh is fenced', P), '');
  assert.equal(commandReason('ls Desktop', H), REASONS.dirs);
  assert.equal(commandReason('cd ~ && ls documents', P), REASONS.dirs);
  assert.equal(commandReason('cd .. && cat Downloads/x', P), REASONS.dirs);
  assert.equal(commandReason('cd; cat .ssh/config', P), REASONS.ssh);
});

test('fence: recursive reads and copies rooted at home or above', () => {
  const P = path.join(H, 'proj'), up = path.dirname(H);
  for (const [c, d] of [['grep -r token ..', P], ['cd ~ && grep -r token .', P], ['cp -r .. /tmp/x', P], ['rg token ~', P], [`grep -R token ${up}`, P],
    ['find / -name id_rsa', P], ['find -L ~ -type f', P], ['tar -czf /tmp/a.tgz ..', P], ['du -sh ~', P], ['ls -R ..', P], ['rg token', H], ['cd; find -name x', P],
    ['rsync -a ~ /tmp/b', P], ['zip -r /tmp/a.zip ..', P], ['sudo grep -rn token $HOME', P], ['echo x; grep --recursive token ~/', P]])
    assert.equal(commandReason(c, d), REASONS.tree, c);
  for (const [c, d] of [['grep -r token .', P], ['grep -r token src', H], ['rg token', P], ['find . -name x', P], ['cp -r .. /tmp/x', path.join(P, 'a')],
    ['grep token ..', P], ['cp ../a.txt .', P], ['ls ..', P], ['tar -xf ../a.tar', P], ['du -sh .', P], ['cd ~/proj && rg token', H]])
    assert.equal(commandReason(c, d), '', c);
});

test('fence: push through xargs', () => {
  assert.equal(commandReason('echo push | xargs git', path.join(H, 'proj')), REASONS.push);
  assert.equal(commandReason('printf "push origin" | xargs -n2 git', path.join(H, 'proj')), REASONS.push);
  assert.equal(commandReason('git ls-files | xargs grep push', path.join(H, 'proj')), '');
});

test('fence: recursive reads run from home through env -C', () => {
  const P = path.join(H, 'proj');
  for (const c of ['env -C ~ grep -r x .', 'env -C .. rg x', 'env --chdir=.. rg x', 'env --chdir .. du -sh', 'env -i FOO=1 -C ~ find'])
    assert.equal(commandReason(c, P), REASONS.tree, c);
  for (const c of ['env -C src rg x', 'env FOO=1 rg x', 'env -C .. ls'])
    assert.equal(commandReason(c, P), '', c);
});
