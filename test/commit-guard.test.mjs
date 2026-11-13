import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { foreign } from '../commit-guard.mjs';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));

test('foreign: staged lines already uncommitted at turn start; short lines ignored', () => {
  const start = 'diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1,0 +2,2 @@\n+const peerStyle = layerCorners(style);\n+}\n';
  const mine = 'diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -9,0 +10 @@\n+const ownDrag = ignoreStack(item);\n+}\n';
  assert.deepEqual(foreign(mine, start), []);
  assert.deepEqual(foreign(start + mine.split('\n').slice(3).join('\n'), start), [{ file: 'app.js', n: 1 }]);
  assert.deepEqual(foreign(mine, ''), []);
});

test('hook in a shared checkout refuses a peer\'s uncommitted hunk, takes the squiggle\'s own', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cgh-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cgr-'));
  fs.mkdirSync(path.join(home, 'bin/hooks'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'bin/hooks/pre-commit'), path.join(home, 'bin/hooks/pre-commit'));
  fs.chmodSync(path.join(home, 'bin/hooks/pre-commit'), 0o755);
  for (const f of ['commit-guard.mjs', 'config.mjs', 'fence.mjs', 'migrate.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(home, f));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const lines = Array.from({ length: 40 }, (_, i) => `const line${i} = original(${i});`);
  const f = path.join(repo, 'app.js'); fs.writeFileSync(f, lines.join('\n') + '\n');
  g('add', '-A'); g('commit', '-qm', 'init'); g('config', 'core.hooksPath', path.join(home, 'bin/hooks'));
  lines[2] = 'const peerStyle = layerCorners(style);'; fs.writeFileSync(f, lines.join('\n') + '\n'); // The peer's uncommitted edit
  const { snapshot: snap } = await import(path.join(home, 'commit-guard.mjs'));
  await new Promise((ok) => snap('a', repo, home, ok));
  lines[35] = 'const ownDrag = ignoreStack(item);'; fs.writeFileSync(f, lines.join('\n') + '\n'); // a's own edit this turn
  const env = { ...process.env, AGENTS_ID: 'a', AGENTS_NODE: process.execPath, SQUIGGLES_HOME: home };
  const r = spawnSync('git', ['-C', repo, 'commit', '-qam', 'drag'], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /app\.js: 1 line/);
  g('restore', '--staged', 'app.js');
  const patch = g('diff', '-U0', 'app.js').replace(/@@ -3 \+3 @@.*\n-.*\n\+.*\n/, '');
  fs.writeFileSync(path.join(repo, '.mine.patch'), patch);
  execFileSync('git', ['-C', repo, 'apply', '--cached', '--unidiff-zero', '.mine.patch']);
  const ok = spawnSync('git', ['-C', repo, 'commit', '-qm', 'drag'], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(g('show', 'HEAD'), /ownDrag/); assert.doesNotMatch(g('show', 'HEAD'), /peerStyle/);
  assert.equal(spawnSync('git', ['-C', repo, 'commit', '-qam', 'owner'], { env: { ...process.env, AGENTS_ID: '' }, encoding: 'utf8' }).status, 0);
  for (const d of [home, repo]) fs.rmSync(d, { recursive: true, force: true });
});

test('hook refuses lines a peer wrote with Edit during this turn; own and shared lines commit', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cgh-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cgr-'));
  fs.mkdirSync(path.join(home, 'bin/hooks'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'bin/hooks/pre-commit'), path.join(home, 'bin/hooks/pre-commit'));
  fs.chmodSync(path.join(home, 'bin/hooks/pre-commit'), 0o755);
  for (const f of ['commit-guard.mjs', 'config.mjs', 'fence.mjs', 'migrate.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(home, f));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const lines = Array.from({ length: 40 }, (_, i) => `const line${i} = original(${i});`);
  const f = path.join(repo, 'app.js'); fs.writeFileSync(f, lines.join('\n') + '\n');
  g('add', '-A'); g('commit', '-qm', 'init'); g('config', 'core.hooksPath', path.join(home, 'bin/hooks'));
  const m = await import(path.join(home, 'commit-guard.mjs'));
  await new Promise((ok) => m.snapshot('a', repo, home, ok)); // a's turn starts on a clean tree
  const edit = (who, i, text) => { lines[i] = text; fs.writeFileSync(f, lines.join('\n') + '\n'); m.noteWrite(who, { name: 'Edit', input: { file_path: f, new_string: text } }, home); };
  edit('b', 2, 'const peerStyle = layerCorners(style);'); // the peer, mid a's turn
  edit('a', 35, 'const ownDrag = ignoreStack(item);');
  edit('b', 20, 'const shared = bothWroteThis(line);'); m.noteWrite('a', { name: 'Edit', input: { file_path: f, new_string: lines[20] } }, home);
  await new Promise((ok) => setTimeout(ok, 100)); // appends are async
  const env = { ...process.env, AGENTS_ID: 'a', AGENTS_NODE: process.execPath, SQUIGGLES_HOME: home };
  const r = spawnSync('git', ['-C', repo, 'commit', '-qam', 'drag'], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /app\.js: 1 line by b/);
  g('restore', '--staged', 'app.js');
  const patch = g('diff', '-U0', 'app.js').replace(/@@ -3 \+3 @@.*\n-.*\n\+.*\n/, '');
  fs.writeFileSync(path.join(repo, '.mine.patch'), patch);
  execFileSync('git', ['-C', repo, 'apply', '--cached', '--unidiff-zero', '.mine.patch']);
  const ok = spawnSync('git', ['-C', repo, 'commit', '-qm', 'drag'], { env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(g('show', 'HEAD'), /ownDrag/); assert.match(g('show', 'HEAD'), /bothWroteThis/); assert.doesNotMatch(g('show', 'HEAD'), /peerStyle/);
  // The peer's own commit of its line goes through: the line is its own.
  const peer = spawnSync('git', ['-C', repo, 'commit', '-qam', 'style'], { env: { ...env, AGENTS_ID: 'b' }, encoding: 'utf8' });
  assert.equal(peer.status, 0, peer.stderr);
  for (const d of [home, repo]) fs.rmSync(d, { recursive: true, force: true });
});

test('hook refuses lines a peer wrote with Bash during this turn; overlapping Bash calls record nobody', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cgh-')), repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cgr-'));
  fs.mkdirSync(path.join(home, 'bin/hooks'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'bin/hooks/pre-commit'), path.join(home, 'bin/hooks/pre-commit'));
  fs.chmodSync(path.join(home, 'bin/hooks/pre-commit'), 0o755);
  for (const f of ['commit-guard.mjs', 'config.mjs', 'fence.mjs', 'migrate.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(home, f));
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  const lines = Array.from({ length: 40 }, (_, i) => `const line${i} = original(${i});`);
  const f = path.join(repo, 'app.js'), put = (i, t) => { lines[i] = t; fs.writeFileSync(f, lines.join('\n') + '\n'); };
  fs.writeFileSync(f, lines.join('\n') + '\n');
  g('add', '-A'); g('commit', '-qm', 'init'); g('config', 'core.hooksPath', path.join(home, 'bin/hooks'));
  const m = await import(path.join(home, 'commit-guard.mjs'));
  for (const id of ['a', 'b']) await new Promise((ok) => m.snapshot(id, repo, home, ok));
  const pause = (ms = 60) => new Promise((ok) => setTimeout(ok, ms)), end = (u) => new Promise((ok) => m.bashEnd(u, home, ok));
  // b runs sed mid a's turn; a's Edit lands inside b's Bash window and stays a's.
  m.bashStart('b', { name: 'Bash', id: 'u1', input: {} }, repo);
  put(2, 'const peerStyle = layerCorners(style);');
  fs.writeFileSync(path.join(repo, 'peer-new.js'), 'export const peerNewFile = makeThing(1);\n');
  put(35, 'const ownDrag = ignoreStack(item);'); m.noteWrite('a', { name: 'Edit', input: { file_path: f, new_string: lines[35] } }, home);
  await pause();
  const rows = await end('u1');
  assert.deepEqual(rows.map((r) => [path.basename(r.file), r.lines]).sort(), [['app.js', ['const peerStyle = layerCorners(style);']], ['peer-new.js', ['export const peerNewFile = makeThing(1);']]]);
  // Two squiggles' Bash calls overlap in one checkout: neither is recorded.
  m.bashStart('a', { name: 'Bash', id: 'u2', input: {} }, repo); m.bashStart('b', { name: 'Bash', id: 'u3', input: {} }, repo);
  await pause(); put(10, 'const whoWroteThis = nobodyKnows(10);');
  assert.equal(await end('u2'), null); assert.equal(await end('u3'), null);
  // A Bash call that changes nothing records nothing; background calls aren't tracked.
  m.bashStart('a', { name: 'Bash', id: 'u4', input: {} }, repo); await pause(); assert.equal(await end('u4'), null);
  m.bashStart('a', { name: 'Bash', id: 'u5', input: { run_in_background: true } }, repo); assert.equal(await end('u5'), null);
  const env = { ...process.env, AGENTS_ID: 'a', AGENTS_NODE: process.execPath, SQUIGGLES_HOME: home };
  g('add', 'app.js', 'peer-new.js');
  const r = spawnSync('git', ['-C', repo, 'commit', '-qm', 'drag'], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /app\.js: 1 line by b/); assert.match(r.stderr, /peer-new\.js: 1 line by b/);
  // The same staging is refused for b too: a's Edit line is in it, and b's Bash record didn't take it.
  const peer = spawnSync('git', ['-C', repo, 'commit', '-qm', 'style'], { env: { ...env, AGENTS_ID: 'b' }, encoding: 'utf8' });
  assert.notEqual(peer.status, 0); assert.match(peer.stderr, /app\.js: 1 line by a/); assert.doesNotMatch(peer.stderr, /peer-new/);
  for (const d of [home, repo]) fs.rmSync(d, { recursive: true, force: true });
});

test('the server tracks each Bash call from tool use to its result', () => {
  const s = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  assert.match(s, /bashStart\(s\.id, c, home\(s\.cwd\)\)/); assert.match(s, /bashEnd\(c\.tool_use_id, DATA\)/);
});

test('writtenLines: Write, Edit, MultiEdit content, short lines dropped', async () => {
  const { writtenLines } = await import('../commit-guard.mjs');
  assert.deepEqual(writtenLines('Write', { content: '}\nconst longEnough = 1;\n' }), ['const longEnough = 1;']);
  assert.deepEqual(writtenLines('MultiEdit', { edits: [{ new_string: 'first long line here' }, { new_string: 'x' }] }), ['first long line here']);
  assert.deepEqual(writtenLines('Bash', { command: 'echo something long enough' }), []);
});

test('installHook: sets core.hooksPath on a plain repo, leaves a repo with hooks of its own alone', async () => {
  const { installHook } = await import('../commit-guard.mjs');
  const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cgi-')); execFileSync('git', ['-C', d, 'init', '-q']); return d; };
  const cfg = (d) => spawnSync('git', ['-C', d, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim();
  const plain = mk(), own = mk(), other = mk(), notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'cgn-'));
  fs.writeFileSync(path.join(own, '.git/hooks/pre-commit'), '#!/bin/sh\n');
  execFileSync('git', ['-C', other, 'config', 'core.hooksPath', '.husky']);
  const run = (d) => new Promise((ok) => installHook(d, '/x/hooks', ok));
  assert.equal(await run(plain), true); assert.equal(cfg(plain), '/x/hooks');
  assert.equal(await run(own), false); assert.equal(cfg(own), '');
  assert.equal(await run(other), false); assert.equal(cfg(other), '.husky');
  assert.equal(await run(notRepo), false);
  for (const d of [plain, own, other, notRepo]) fs.rmSync(d, { recursive: true, force: true });
});
