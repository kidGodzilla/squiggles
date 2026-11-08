// Review, picks and asks can paint before the squiggle list arrives, showing ids. load() repaints them once names are known.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('load() repaints Review after it fills S.sq', () => {
  const src = fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
  const body = /^async function load\(\) \{[\s\S]*?^}$/m.exec(src)[0];
  const fill = body.indexOf('S.sq = {}; for (const s of list) S.sq[s.id] = s;'), paint = body.indexOf('paintApprovals');
  assert.ok(fill > 0, 'load fills S.sq');
  assert.ok(paint > fill, 'paintApprovals runs after S.sq is filled');
  const histories = body.indexOf('await Promise.all(');
  assert.ok(paint < histories, 'and before the chat histories load, so names show at once');
});
