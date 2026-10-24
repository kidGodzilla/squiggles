import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeStamp, codeChanged } from '../codestamp.mjs';

test('restart only when server code changed: UI and prompts do not count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-')), w = (f, s = 'x') => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), s); };
  for (const f of ['server.mjs', 'board.mjs', 'ui/room.js', 'ui/cast.js', 'ui/gen/a.js', 'prompts/lead.md', 'package.json']) w(f);
  const s0 = codeStamp(root), later = (f) => { const t = new Date(Date.now() + 5000); fs.utimesSync(path.join(root, f), t, t); };
  later('ui/room.js'); later('prompts/lead.md'); w('test/x.test.mjs'); w('docs/handoff.md');
  assert.deepEqual(codeChanged(root, s0), []);
  later('board.mjs'); w('cost.mjs'); later('ui/gen/a.js');
  assert.deepEqual(codeChanged(root, s0).sort(), ['board.mjs', 'cost.mjs', 'ui/gen/a.js']);
  fs.rmSync(root, { recursive: true });
});
