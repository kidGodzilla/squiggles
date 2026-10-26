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
