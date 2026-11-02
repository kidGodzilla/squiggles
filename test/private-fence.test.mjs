// The private-data fence: folders, tools and remote machines only Claude squiggles may reach. Off until configured.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REASONS, privateReason, privateRules } from '../fence.mjs';

const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'))), P = REASONS.private, cwd = `${H}/app`;
for (const d of ['app/src', 'team/alpha', 'team/beta', 'team/notes', 'dumps/db', 'scripts']) fs.mkdirSync(`${H}/${d}`, { recursive: true });
fs.writeFileSync(`${H}/scripts/hits.sh`, '#!/bin/sh\nssh box "docker ps"\n');
fs.writeFileSync(`${H}/scripts/ok.sh`, '#!/bin/sh\necho hi\n');
const rules = privateRules({ privateDirs: ['team/alpha', `~/team/beta`, `${H}/dumps`], privateTools: ['helpdesk'], privateRemote: true });
const run = (tool, input, at = cwd, r = rules) => privateReason(tool, input, at, H, r);
const bash = (command, at = cwd, r = rules) => run('bash', { command }, at, r);
test.after(() => fs.rmSync(H, { recursive: true, force: true }));

test('off until configured', () => {
  assert.deepEqual(privateRules({}), { dirs: [], tools: [], remote: false });
  assert.equal(run('Read', { file_path: `${H}/team/alpha/x.md` }, cwd, privateRules({})), '');
  assert.equal(bash('ssh box', cwd, privateRules({})), '');
});

test('private tools are blocked by name', () => {
  assert.equal(run('mcp__helpdesk__list_conversations', {}), P);
  assert.equal(run('Read', { file_path: `${cwd}/src/a.js` }), '');
});

test('remote shells and databases are blocked', () => {
  for (const c of ['ssh box', 'sudo ssh box ls', 'cd /tmp && scp box:/a .', 'timeout 5 ssh box', 'sh -c "ssh box"', 'psql -h db.example.com app',
    'psql postgres://u:p@db.example.com/app', 'node x.js mongodb+srv://u@cluster0.example.net/app']) assert.equal(bash(c), P, c);
  for (const c of ['grep -n ssh fence.mjs', 'git status', 'psql -h localhost app', 'psql postgres://127.0.0.1/app', 'echo hi', 'node --test']) assert.equal(bash(c), '', c);
});

test('remote probes: scripts, host:path, tailscale, drivers', () => {
  assert.equal(bash(`bash ${H}/scripts/hits.sh`), P);
  assert.equal(bash(`${H}/scripts/hits.sh`), P);
  assert.equal(bash(`bash ${H}/scripts/ok.sh`), '');
  for (const c of ['rsync -a user@host.example.com:/data /tmp/x', 'git clone user@10.0.0.5:app', 'tailscale ssh box', '$c ls',
    `python3 -c "import pymongo, os; pymongo.MongoClient(os.environ['DB'])"`]) assert.equal(bash(c), P, c);
  for (const c of ['git clone git@github.com:x/y.git', 'git fetch origin main:main', 'rsync -a src/ /tmp/x/', 'node -e "console.log(process.env.PATH)"', 'ssh -V']) assert.equal(bash(c), '', c);
});

test('private folders are blocked by path', () => {
  assert.equal(run('Read', { file_path: `${H}/team/alpha/notes.md` }), P);
  assert.equal(run('read', { path: '~/team/beta/x' }), P);
  assert.equal(run('Read', { file_path: `${H}/dumps/db/a.bson` }), P);
  for (const c of [`cat ~/team/alpha/a.md`, 'cd ~ && cat team/beta/x', 'cat $HOME/dumps/db/a', 'cat ../team/alpha/a']) assert.equal(bash(c), P, c);
  assert.equal(run('apply_patch', { input: `*** Begin Patch\n*** Add File: ${H}/team/alpha/x\n+hi\n*** End Patch`, path: `${H}/team/alpha/x` }), P);
  assert.equal(run('Write', { file_path: `${cwd}/src/a.md`, content: `see ${H}/team/alpha for notes\nmore` }), '', 'prose in content passes');
});

test('a glob or a walk from a parent folder is blocked', () => {
  for (const c of ['grep -r x ~/team', 'grep ~/team/*/a.md', 'find ~/dumps -name *.bson', 'rg secret ~', 'ls -R ~/team', 'cp -a ~/team /tmp/x',
    'cat ~/team/al*/a.md', 'head ~/**/a.bson', 'cd ~ && grep -r x team']) assert.equal(bash(c), P, c);
  assert.equal(run('Glob', { pattern: '*.bson', path: `${H}/team` }, H), P);
  assert.equal(run('read', { path: `${H}/team/*/a.md` }, H), P);
});

test('nearby work still passes', () => {
  for (const c of ['ls ~/team/notes', 'ls -lart ~', 'grep -rn ssh src/', 'rg foo', 'find . -name x.js', 'cat ~/team/n*/a.md',
    'grep -r foo ~/team/notes', 'ls ~/team', "grep 'a*b' x.js"]) assert.equal(bash(c), '', c);
  assert.equal(run('Glob', { pattern: '*.js', path: `${cwd}/src` }), '');
});
