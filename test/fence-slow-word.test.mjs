// A hook that runs long can fail open (Codex runs the tool if a hook is killed or timed out), so a long word must stay cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandReason, pathReason, privateReason } from '../fence.mjs';
import piGuard from '../pi/guard.ts';

const word = 'a/'.repeat(20000) + 'a', read = '/tmp/private-x/a', cwd = '/tmp', home = os.homedir(), key = ['~', '.ssh', 'id_rsa'].join('/');
const rules = { dirs: ['/tmp/private-x'], tools: [], remote: false }, strict = (command) => privateReason('Bash', { command }, cwd, home, rules);
let pi; piGuard({ on: (_, f) => { pi = f; } });
// CPU time, so a loaded machine doesn't count against the check.
const fast = (name, f) => { const t = process.cpuUsage(); f(); const { user, system } = process.cpuUsage(t), ms = (user + system) / 1000; assert.ok(ms < 1000, `${name}: ${Math.round(ms)} ms`); };

test('the 40,000-character word takes each fence check under 1 s', () => {
  fast('commandReason', () => commandReason(`cat ${word}`, cwd));
  fast('privateReason', () => strict(`cat ${word}`));
  fast('pi guard', () => pi({ toolName: 'bash', input: { command: `cat ${word}` } }));
  fast('pathReason', () => pathReason(word, cwd));
  fast('64KB path', () => pathReason('a/'.repeat(32000), cwd));
});
test('six brace groups before the long word take each fence check under 1 s, and a read after them still refuses', () => {
  const c = `cat ${'{a,b}/'.repeat(6)}${word}`;
  fast('commandReason', () => commandReason(c, cwd));
  fast('privateReason', () => strict(c));
  assert.ok(strict(`${c} ${read}`));
});
test('a long run of function words takes under 1 s', () => {
  for (const c of ['function '.repeat(30000), 'function a '.repeat(24000)]) fast(c.slice(0, 11), () => strict(c));
});
test('the fence reads on past the word', () => {
  assert.match(strict(`cat ${word} ${read}`), /Claude-only/);
  assert.ok(commandReason(`cat ${word} ${key}`, cwd));
});
test('a symlink to a fenced folder still counts under a long tail', () => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'slow-word-')));
  try {
    fs.mkdirSync(path.join(h, '.ssh')); fs.mkdirSync(path.join(h, 'w'));
    fs.symlinkSync(path.join(h, '.ssh'), path.join(h, 'w', 'link'));
    for (const tail of ['id_rsa', 'x/y', word]) assert.ok(pathReason(path.join(h, 'w', 'link', tail), h, h), tail.slice(0, 9));
    assert.equal(pathReason(path.join(h, 'w', 'other', 'x'), h, h), '');
  } finally { fs.rmSync(h, { recursive: true }); }
});
test('what one command resolved is looked up fresh on the next call', () => {
  const h = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'slow-word-'))), p = path.join(h, 'w', 'link', 'x');
  try {
    fs.mkdirSync(path.join(h, '.ssh')); fs.mkdirSync(path.join(h, 'w'));
    assert.equal(commandReason(`cat ${p}`, h, h), '');
    fs.symlinkSync(path.join(h, '.ssh'), path.join(h, 'w', 'link'));
    assert.ok(pathReason(p, h, h));
  } finally { fs.rmSync(h, { recursive: true }); }
});
test('a word that climbs back out of the depth lands where the shell would', () => {
  const up = '../'.repeat(20001), rel = home.slice(1);
  assert.ok(commandReason(`cat ${word}/${up}${rel}/.ssh/id_rsa`, cwd));
  assert.equal(commandReason(`cat ${word}/${up}tmp/x`, cwd), '');
});
test('a long run of > or -e that names no owned file takes under 1 s', () => {
  for (const c of ['>'.repeat(200000), `node -e x ${' -e'.repeat(13000)}`]) fast(c.slice(0, 11), () => commandReason(c, cwd));
});
