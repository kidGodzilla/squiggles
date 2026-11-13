// Cached speech unused for a week is pruned; a replayed file and fresh partials stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneSpeech, used } from '../voice/cache.mjs';

test('speech unused for a week is pruned; a replayed file and fresh partials stay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-')), old = Date.now() - 8 * 864e5;
  const put = (n, t = old) => { const f = path.join(dir, n); fs.writeFileSync(f, 'xx'); fs.utimesSync(f, new Date(t), new Date(t)); return f; };
  put('gone.wav'); put('gone.m4a'); put('crash.wav.part.wav', Date.now() - 2 * 36e5); put('live.wav.part.wav', Date.now() - 60e3);
  put('keep.wav', Date.now() - 864e5); put('other.txt');
  used(put('replayed.wav'));
  assert.deepEqual(pruneSpeech(dir), { files: 3, bytes: 6 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['keep.wav', 'live.wav.part.wav', 'other.txt', 'replayed.wav']);
  assert.deepEqual(pruneSpeech(path.join(dir, 'missing')), { files: 0, bytes: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the server marks a cache hit used and prunes at start and every 6 hours', () => {
  const s = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(s, /if \(fs\.existsSync\(file\)\) return Promise\.resolve\(used\(file\)\)/);
  assert.match(s, /setTimeout\(pruneTts, 30e3\)\.unref\(\); setInterval\(pruneTts, 6 \* 36e5\)\.unref\(\)/);
});
