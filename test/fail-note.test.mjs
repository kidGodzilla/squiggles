// Codex turns refused by an untrusted guard ended as a bare "turn failed", with nothing in the run log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('a failed turn\'s note carries the first line of the failure', () => {
  const def = src.match(/^const failNote = .*$/m)[0];
  const failNote = new Function(`${def}; return failNote;`)();
  assert.equal(failNote('\n  Codex guard is not trusted\nmore'), 'turn failed: Codex guard is not trusted');
  assert.equal(failNote(''), 'turn failed');
  assert.equal(failNote(undefined), 'turn failed');
  assert.equal(failNote('x'.repeat(500)).length, 'turn failed: '.length + 200);
  assert.match(src, /isError \? \{ status: 'error', note: failNote\(text\) \}/);
});

test('Codex guard is checked every turn, and a refusal or exit is logged', () => {
  const turn = src.slice(src.indexOf('async function codexTurn'), src.indexOf('// Pi: one'));
  assert.match(turn, /await cx\.guard\(\)\)\) \{ const why = [^;]+; emit\(s\.id, \{ k: 'log', text: why \}\)/);
  assert.match(turn, /method === 'exit'\) \{ emit\(s\.id, \{ k: 'log'/);
  assert.match(src, /cx\.guard = \(\) => /);
});
