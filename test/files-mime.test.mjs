// an agent's dropped file must never load as the room's script or style; TodoWrite status never reaches markup raw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('dropped scripts and styles are served as plain text', async () => {
  const { mimeFor } = await import('../mime.mjs');
  for (const f of ['x.js', 'x.mjs', 'x.css', 'x.json', 'x.webmanifest', 'x', 'x.JS']) assert.match(mimeFor(f), /^text\/plain/, f);
  assert.equal(mimeFor('a.png'), 'image/png'); assert.equal(mimeFor('a.wav'), 'audio/wav'); assert.equal(mimeFor('a.pdf'), 'application/pdf');
  assert.equal(mimeFor('ui.js', true), 'text/javascript');
});
test('TodoWrite status is allowlisted before the class attribute', () => {
  const src = readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /class="td \$\{x\.s\}"/);
  assert.match(src, /TODO_S\.includes\(x\.s\)/);
});
