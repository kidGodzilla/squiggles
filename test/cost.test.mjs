import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createLedger, describeCost } from '../cost.mjs';

test('cost ledger sums per squiggle and survives a new instance', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-')), f = path.join(d, 'cost.jsonl');
  const now = Date.parse('2026-10-24T12:00:00'), day = 864e5;
  fs.writeFileSync(f, [
    { ts: now - 1000, id: 'ops', cost: 0.5, in: 100, out: 10 },
    { ts: now - 2000, id: 'ops', cost: 0.25, in: 50, out: 5 },
    { ts: now - 3 * day, id: 'ops', cost: 9 },
    { ts: now - 3000, id: 'coder', provider: 'codex', in: 2000, out: 300 },
  ].map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n');
  const s = createLedger(f).summary(1, now);
  assert.deepEqual(s.map((r) => [r.id, r.turns, r.cost, r.in]), [['ops', 2, 0.75, 150], ['coder', 1, 0, 2000]]);
  assert.equal(createLedger(f).summary(7, now).find((r) => r.id === 'ops').cost, 9.75);
  createLedger(f).add({ id: 'lead', cost: 1 });
  assert.equal(createLedger(f).summary(7, Date.now()).find((r) => r.id === 'lead').today, 1);
  assert.equal(describeCost(s[0]), '$0.75 in 2 turns, 150 in / 15 out tokens; $0.75 today');
  fs.rmSync(d, { recursive: true });
});
