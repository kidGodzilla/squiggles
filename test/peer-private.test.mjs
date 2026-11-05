// A squiggle's marked logs and private notes are closed to its peers. The fence keeps honest squiggles out; it isn't a sandbox.
// test/squiggle-gates-live.test.mjs covers the routes through a real server and squiggle process.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { peerReason, privatePaths, REASONS } from '../fence.mjs';
import { updateRefusal } from '../trust.mjs';
import { searchNotes } from '../notes.mjs';
import { check, MATCHER } from '../claude/guard.mjs';
import { check as codexCheck } from '../codex/guard.mjs';
import { check as cursorCheck } from '../cursor/guard.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'peer-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));
for (const [id, meta] of [['boss', { lead: true }], ['ann', {}], ['sam', { private: true }], ['open', {}]]) {
  const d = path.join(root, 'squiggles', id); fs.mkdirSync(path.join(d, 'private'), { recursive: true });
  fs.writeFileSync(path.join(d, 'squiggle.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(d, 'journal.md'), `demo journal of ${id} zebra\n`);
  fs.writeFileSync(path.join(d, 'private', 'note.md'), `demo private of ${id} zebra\n`);
}
const T = path.join(root, 'squiggles', 'sam'), O = path.join(root, 'squiggles', 'open'), run = path.join(root, 'runs', 'sam.jsonl');
const peer = (input, self = 'ann', tool = 'Read', cwd = root) => peerReason(tool, input, { self, root, cwd, home: os.homedir() });
const sh = (command, self, cwd) => peer({ command }, self, 'Bash', cwd);

test('a peer is refused a marked journal, run log and private notes', () => {
  for (const p of [`${T}/journal.md`, run, `${T}/private/note.md`, `${T}/private`]) assert.equal(peer({ path: p }), REASONS.peer, p);
  for (const c of [`cat ${T}/journal.md`, 'tail -5 squiggles/sam/journal.md', 'cd squiggles/sam && cat journal.md', 'cat squiggles/*/journal.md', 'grep x squiggles/{sam,ann}/journal.md', 'cat "squiggles/sam/private/note.md"', 'grep -r x squiggles/sam/private']) assert.equal(sh(c), REASONS.peer, c);
});

test('every squiggle\'s private/ is closed, marked or not; an unmarked journal stays open', () => {
  assert.equal(peer({ path: `${O}/private/note.md` }), REASONS.peer);
  assert.equal(peer({ path: `${O}/journal.md` }), '');
  assert.equal(peer({ path: path.join(root, 'runs', 'open.jsonl') }), '');
});

test('a link into a closed file is refused by its real path', () => {
  const l = path.join(root, 'plain.txt'); fs.symlinkSync(`${T}/journal.md`, l);
  assert.equal(peer({ path: l }), REASONS.peer);
});

test('owner, lead and no squiggle pass', () => {
  for (const self of ['sam', 'boss', '']) {
    assert.equal(peer({ path: `${T}/journal.md` }, self), '', self);
    assert.equal(sh(`cat ${T}/journal.md`, self), '', self);
  }
  assert.deepEqual(privatePaths('boss', root), []);
  assert.deepEqual(privatePaths('', root), []);
});

test('a peer\'s ordinary work passes: walks from above, its own files, the Glob tool', () => {
  for (const c of ['grep -r x .', 'grep -r x squiggles', 'ls squiggles/sam', 'git status', 'cat squiggles/ann/journal.md', 'cat squiggles/ann/private/note.md']) assert.equal(sh(c), '', c);
  assert.equal(peer({ path: 'squiggles' }), '');
  assert.equal(check({ tool_name: 'Glob', tool_input: { pattern: '**/*.md' }, cwd: root }, 'ann'), '');
});

test('notes skips closed files for a peer and keeps them for the lead', () => {
  const hits = (closed) => JSON.stringify(searchNotes('zebra', { roots: [path.join(root, 'squiggles')], data: root, claude: true, closed, files: 20 }));
  const peerSees = hits(privatePaths('ann', root));
  assert.doesNotMatch(peerSees, /sam/);
  assert.doesNotMatch(peerSees, /open\/private/);
  assert.match(peerSees, /open\/journal\.md/);
  assert.match(peerSees, /ann\/private/);
  assert.match(hits(privatePaths('boss', root)), /sam\/journal\.md/);
});

test('the Claude, Codex, Cursor and Pi guards refuse, Read included', () => {
  const note = path.join(root, 'squiggles', 'ann', 'private', 'x.md'), was = { id: process.env.AGENTS_ID, home: process.env.SQUIGGLES_HOME };
  assert.match(MATCHER, /\bRead\b/, 'Read reaches the hook');
  process.env.SQUIGGLES_HOME = root; process.env.AGENTS_ID = 'open';
  try {
    const read = { tool_name: 'Read', tool_input: { file_path: note }, cwd: root };
    assert.equal(check(read, 'open'), REASONS.peer);
    assert.equal(check({ tool_name: 'Bash', tool_input: { command: `cat ${note}` }, cwd: root }, 'open'), REASONS.peer);
    assert.equal(check({ tool_name: 'Grep', tool_input: { pattern: 'x', path: path.dirname(note) }, cwd: root }, 'open'), REASONS.peer);
    assert.equal(check(read, 'ann'), '');
    assert.equal(codexCheck({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${note}\n*** End Patch` }, cwd: root }), REASONS.peer);
    assert.equal(cursorCheck({ tool_name: 'Read', tool_input: { path: note }, cwd: root }), REASONS.peer);
  } finally {
    for (const [k, v] of [['AGENTS_ID', was.id], ['SQUIGGLES_HOME', was.home]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  assert.match(fs.readFileSync(new URL('../pi/guard.ts', import.meta.url), 'utf8'), /peerReason\(event\.toolName, input/);
});

test('only the lead and the owner set the mark; it is true or false', () => {
  const s = { id: 'sam', name: 'Sam', trust: 'medium', private: true };
  assert.equal(updateRefusal({ private: false }, s, { caller: 'ann' })?.status, 403);
  assert.equal(updateRefusal({ private: false }, s, { caller: 'sam' })?.status, 403);
  assert.equal(updateRefusal({ private: false }, s, { caller: 'boss', callerLead: true }), null);
  assert.equal(updateRefusal({ private: 'yes' }, s, { caller: 'boss', callerLead: true })?.status, 400);
});

test('CLI and UI both set it', () => {
  const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(src('bin/agents.mjs'), /usage: private <id> on\|off/);
  assert.match(src('ui/settings.js'), /data-f="private"/);
});
