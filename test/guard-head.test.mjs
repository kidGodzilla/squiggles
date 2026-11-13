// A working fence.mjs or guard that doesn't load or throws would lock out every squiggle and the lead.
// The committed guard answers instead: it still refuses what it refuses, and lets the rest through. Run in a throwaway repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUARD_FILES as FILES, GUARD_PROVIDERS as ALL, brokenGuards } from '../commit-guard.mjs';

const src = path.join(import.meta.dirname, '..');
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-head-home-')));
const env = { PATH: process.env.PATH, AGENTS_ID: 'c', AGENTS_NODE: process.execPath, HOME: home, SQUIGGLES_HOME: path.join(home, 'room') };
const call = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '/tmp' });
const SECRET = `cat ${path.join(home, '.ssh', 'id')}`;
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

function repo() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-head-'))); // /var is a link: a guard run by its linked path doesn't see itself as main
  for (const f of FILES) { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.copyFileSync(path.join(src, f), path.join(r, f)); }
  const git = (...a) => execFileSync('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'x');
  return { r, git, hook: (d, c) => spawnSync('sh', [path.join(r, d, 'guard.sh')], { input: call(c), env, encoding: 'utf8' }) };
}
const edit = (r, f, from, to) => { const p = path.join(r, f), s = fs.readFileSync(p, 'utf8'); assert.ok(s.includes(from), from); fs.writeFileSync(p, s.replace(from, to)); };
const answers = ({ hook }) => {
  for (const d of ALL) {
    const ok = hook(d, 'ls'); assert.equal(ok.status, 0, `${d}: ${ok.stderr}`);
    const s = hook(d, SECRET); assert.equal(s.status, 2, d); assert.match(s.stderr + s.stdout, /off limits/, d);
  }
};
const CMD = 'export function commandReason(cmd, cwd = process.cwd(), home = os.homedir()) {';
const PATH_FN = 'export function pathReason(p, cwd = process.cwd(), home = os.homedir()) {';

test('the fence answers in a fresh copy', () => {
  const t = repo();
  try { answers(t); } finally { fs.rmSync(t.r, { recursive: true }); }
});
test('a fence that does not parse: the committed one answers', () => {
  const t = repo();
  try { fs.appendFileSync(path.join(t.r, 'fence.mjs'), '\nconst broken = (w) => 1; // )\nexport const = ;\n'); answers(t); }
  finally { fs.rmSync(t.r, { recursive: true }); }
});
test('a fence that throws on every call: the committed one answers', () => {
  const t = repo();
  try {
    edit(t.r, 'fence.mjs', CMD, `${CMD} notDefined();`);
    edit(t.r, 'fence.mjs', PATH_FN, `${PATH_FN} notDefined();`);
    answers(t);
  } finally { fs.rmSync(t.r, { recursive: true }); }
});
test('a guard that does not parse: the committed one answers', () => {
  const t = repo();
  try { for (const d of ['claude', 'cursor']) fs.appendFileSync(path.join(t.r, d, 'guard.mjs'), '\n}}\n'); answers(t); }
  finally { fs.rmSync(t.r, { recursive: true }); }
});
test('a broken committed fence still refuses everything', () => {
  const t = repo();
  try {
    fs.appendFileSync(path.join(t.r, 'fence.mjs'), '\nexport const = ;\n'); t.git('commit', '-qam', 'broken');
    for (const d of ALL) { const x = t.hook(d, 'ls'); assert.equal(x.status, 2, d); assert.ok(x.stderr.trim(), d); }
  } finally { fs.rmSync(t.r, { recursive: true }); }
});
test('a working fence change takes effect: no fallback while it loads', () => {
  const t = repo();
  try { edit(t.r, 'fence.mjs', CMD, `${CMD} if (cmd === 'ls') return 'new rule';`); const x = t.hook('claude', 'ls'); assert.equal(x.status, 2); assert.match(x.stderr, /new rule/); }
  finally { fs.rmSync(t.r, { recursive: true }); }
});
test('a commit of a broken fence or guard is refused; a good one passes', () => {
  const t = repo(), git = (...a) => execFileSync('git', ['-C', t.r, ...a], { encoding: 'utf8' });
  try {
    assert.deepEqual(brokenGuards(t.r, git), []); // nothing staged
    edit(t.r, 'fence.mjs', CMD, `${CMD} // fine\n`); git('add', 'fence.mjs');
    assert.deepEqual(brokenGuards(t.r, git), []);
    fs.appendFileSync(path.join(t.r, 'fence.mjs'), '\nexport const = ;\n'); git('add', 'fence.mjs');
    assert.deepEqual(brokenGuards(t.r, git), ALL);
    fs.appendFileSync(path.join(t.r, 'cursor', 'guard.mjs'), '\n}}\n'); git('add', 'cursor/guard.mjs'); git('checkout', 'HEAD', '--', 'fence.mjs');
    assert.deepEqual(brokenGuards(t.r, git), ['codex', 'cursor']); // codex loads cursor's
  } finally { fs.rmSync(t.r, { recursive: true }); }
});
