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

test('fence: wrappers, more recursive tools and dotfile globs at home', () => {
  const P = path.join(H, 'proj');
  for (const c of ['bash -c "grep -r x .."', "sh -c 'cd ~; rg x'", 'zsh -lc "du -sh ~"', 'timeout 5 grep -r x ..', 'timeout -s KILL 5 rg x ~', 'nice -n 10 find ..',
    'nice -n10 rg x ~', 'ditto .. /tmp/b', 'scp -r .. host:b', 'fd x ..', 'ag x ~', '7z a /tmp/a.7z ..', 'cd; fd'])
    assert.equal(commandReason(c, P), REASONS.tree, c);
  for (const c of ['cat ../.[!.]*/config', 'cd ~ && ls .[!.]*'])
    assert.equal(commandReason(c, P), REASONS.ssh, c);
  for (const c of ['bash -c "rg x src"', 'timeout 5 rg x', 'nice -n 10 make', 'scp a.txt host:b', 'scp -r src host:b', 'fd x', 'ag x src', '7z x ../a.7z', 'ls .[!.]*', 'bash build.sh'])
    assert.equal(commandReason(c, P), '', c);
});

test('fence: [^.] and brace globs, wrapper paths and flags, -e patterns, 7z with no file list', () => {
  const P = path.join(H, 'proj');
  for (const c of ['cat ~/.[^.]*/id_ed25519', 'cat ~/.{ssh,x}/config', 'cd ~ && cat .[^.]*/config'])
    assert.equal(commandReason(c, P), REASONS.ssh, c);
  assert.equal(commandReason('ls ~/{Desktop,x}', P), REASONS.dirs);
  for (const [c, d] of [['/bin/bash -c "rg x ~"', P], ['/usr/bin/env -C ~ rg x', P], ['/usr/bin/timeout 5 rg x ~', P], ['sudo -u root grep -r x ~', P],
    ['xargs -0 grep -r x ..', P], ['time -p rg x ~', P], ['command -p grep -r x ..', P], ['bash -O extglob -c "rg x ~"', P],
    ['rg -e x', H], ['grep -r -e x', H], ['fd -e md x', H], ['rg --regexp x', H], ['7z a /tmp/a.7z', H], ['rg -g "*.md" x', H]])
    assert.equal(commandReason(c, d), REASONS.tree, c);
  for (const c of ['rg -e x', 'grep -r -e x src', 'fd -e md x', 'sudo -u root make', '/bin/bash -c "rg x src"', '7z a /tmp/a.7z', 'rg -g "*.md" x src', 'cat {a,b}.txt'])
    assert.equal(commandReason(c, P), '', c);
});

test('fence: nested braces, a leading ] in a class, long wrapper flags with a separate value', () => {
  const P = path.join(H, 'proj');
  for (const c of ['cat ~/.{s{s,}h,x}/config', 'cat ~/.[]s]sh/config', 'cat ~/.[!]x]sh/config'])
    assert.equal(commandReason(c, P), REASONS.ssh, c);
  for (const c of ['sudo -iu root rg x ~', 'sudo --user root rg x ~', 'nice --adjustment 10 rg x ~', 'timeout --signal KILL 5 rg x ~',
    'time -f %e rg x ~', 'bash --rcfile y -c "rg x ~"', 'xargs --max-args 1 grep -r x ..'])
    assert.equal(commandReason(c, P), REASONS.tree, c);
  for (const c of ['sudo -iu root make', 'timeout --signal KILL 5 rg x src', 'cat {a,{b,c}}.txt', 'ls [ab]*'])
    assert.equal(commandReason(c, P), '', c);
});

test('fence: a brace or class spelling a fenced folder is caught; one that does not passes', () => {
  const P = path.join(H, 'proj');
  for (const c of ['ls ~/{Down,x}loads', 'cat ~/[D]ownloads/x']) assert.equal(commandReason(c, P), REASONS.dirs, c);
  for (const c of ['ls ~/{Agents,proj}', 'ls ~/.[!s]*', 'git log --format={x}']) assert.equal(commandReason(c, P), '', c);
});
