// A hook that runs long can fail open (Codex runs the tool if a hook is killed or timed out), so a long word must stay cheap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { commandReason, pathReason, privateReason } from '../fence.mjs';
import piGuard from '../pi/guard.ts';
import { check } from '../codex/guard.mjs';

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

// t4201: nested braces took seconds, then no answer at all. Too big to expand, so refused unread; the real guard answers too.
const huge = ['{a,'.repeat(250000) + 'b' + '}'.repeat(250000), '{'.repeat(500000) + '}'.repeat(500000), '{a,b}'.repeat(200000)];
const guard = fileURLToPath(new URL('../codex/guard.sh', import.meta.url));
test('a 1 MB nested-brace word is refused under 1 s, with or without a fenced read after it', () => {
  for (const w of huge) for (const tail of ['', ...[` ${key}`]]) for (const dir of ['/tmp', home]) {
    const ev = { tool_name: 'Bash', tool_input: { command: `cat ${w}${tail}` }, cwd: dir };
    let why; fast(w.slice(0, 9), () => { why = check(ev); });
    assert.ok(why, `${w.slice(0, 9)} ${tail} from ${dir}`);
  }
});
test('the real guard script answers a 1 MB nested-brace word', () => {
  for (const w of huge) for (const tail of ['', ...[` ${key}`]]) {
    const r = spawnSync('sh', [guard], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: `cat ${w}${tail}` }, cwd: home }), timeout: 30000, encoding: 'utf8' });
    assert.equal(r.status, 2, `${w.slice(0, 9)} ${tail}: ${r.signal || r.status}`);
  }
});
test('many long brace words add up: 1 MB of 8,000-character words is refused under 1 s', () => {
  const line = Array.from({ length: 125 }, (_, i) => '{a,b}'.repeat(1600) + i).join(' ');
  let why; fast('125 words', () => { why = commandReason(`cat ${line}`, cwd); });
  assert.ok(why);
});
test('ordinary brace words stay allowed, however many', () => {
  assert.equal(commandReason(`cat ${'{a,b}/x '.repeat(5000)}`, cwd), '');
});
test('a long run of > or -e that names no owned file takes under 1 s', () => {
  for (const c of ['>'.repeat(200000), `node -e x ${' -e'.repeat(13000)}`]) fast(c.slice(0, 11), () => commandReason(c, cwd));
});
