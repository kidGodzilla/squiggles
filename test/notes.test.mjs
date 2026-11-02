import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchNotes } from '../notes.mjs';

test('notes finds files holding every word, best line first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), w = (f, s) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  // A big journal with many weak lines must not beat a small note with one line holding every word.
  w('a/journal.md', Array.from({ length: 50 }, (_, i) => `- ${i} mongo restart`).join('\n') + '\n- backup elsewhere\n');
  w('b/notes.md', '# Runbook\n- mongo backup runs nightly from the Mac\n');
  w('c/other.md', '- mongo only\n');
  w('d/skip.json', 'mongo backup');
  w('d/node_modules/x.md', 'mongo backup');
  const r = searchNotes('Mongo backup', { roots: [root] });
  assert.deepEqual(r.map((x) => path.relative(root, x.file)), ['b/notes.md', 'a/journal.md']);
  assert.deepEqual(r[0].lines, [{ n: 2, text: '- mongo backup runs nightly from the Mac' }]);
  assert.deepEqual(searchNotes('qqzzxx', { roots: [root] }), []);
  assert.throws(() => searchNotes(' ', { roots: [root] }), /usage/);
  fs.rmSync(root, { recursive: true });
});

test('a non-Claude squiggle\'s notes search skips private folders', async () => {
  const { claudeCaller } = await import('../notes.mjs');
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-priv-'))), w = (f, s) => { fs.mkdirSync(path.dirname(path.join(data, f)), { recursive: true }); fs.writeFileSync(path.join(data, f), s); };
  w('research/open.md', 'backup plan\n');
  w('private/secret.md', 'backup plan\n');
  w('squiggles/cx/squiggle.json', JSON.stringify({ id: 'cx', model: 'gpt-6.1-sol' }));
  w('squiggles/cl/squiggle.json', JSON.stringify({ id: 'cl', model: 'opus' }));
  w('config.json', JSON.stringify({ codex: true, privateDirs: [path.join(data, 'private')] }));
  const roots = [path.join(data, 'research'), path.join(data, 'private')], found = (id) => searchNotes('backup plan', { roots, data, claude: claudeCaller(id, data) }).map((x) => path.relative(data, x.file)).sort();
  assert.deepEqual(found('cx'), ['research/open.md']);
  assert.deepEqual(found('cl'), ['private/secret.md', 'research/open.md']);
  assert.deepEqual(found(''), ['private/secret.md', 'research/open.md'], 'the user at a shell');
  assert.deepEqual(found('ghost'), ['research/open.md'], 'unreadable squiggle counts as non-Claude');
  w('config.json', JSON.stringify({ codex: true }));
  assert.deepEqual(found('cx'), ['private/secret.md', 'research/open.md'], 'off until configured');
  fs.rmSync(data, { recursive: true });
});
