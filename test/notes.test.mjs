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
