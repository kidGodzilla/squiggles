// A fresh data dir boots and seeds the lead (first run once crashed: the seed ran before the model lists it checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from './room.mjs';

test('first run: empty data dir boots with only the lead', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-first-'));
  const { up, out, halt } = await boot(d);
  await halt();
  try {
    assert.ok(up, out);
    assert.deepEqual(fs.readdirSync(path.join(d, 'squiggles')), ['lead']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'squiggles', 'lead', 'squiggle.json'), 'utf8')).lead, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
