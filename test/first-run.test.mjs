// A fresh data dir boots and seeds the lead (first run once crashed: the seed ran before the model lists it checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('first run: empty data dir boots with only the lead', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-first-'));
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ schema: 1, port: 4396 }));
  const p = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, SQUIGGLES_HOME: d }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const up = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    for (const s of [p.stdout, p.stderr]) s.on('data', (b) => { out += b; if (/ on http/.test(out)) { clearTimeout(t); res(true); } });
    p.on('exit', () => { clearTimeout(t); res(false); });
  });
  p.kill();
  try {
    assert.ok(up, out);
    assert.deepEqual(fs.readdirSync(path.join(d, 'squiggles')), ['lead']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'squiggles', 'lead', 'squiggle.json'), 'utf8')).lead, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
