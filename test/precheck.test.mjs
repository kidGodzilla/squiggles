import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wantsPrecheck, precheckPrompt, parseVerdict, runPrecheck, PRECHECK_MAX_MS } from '../precheck.mjs';

test('parseVerdict: last WAKE/DEFER line wins, bold allowed, none wakes', () => {
  assert.deepEqual(parseVerdict('x\nDEFER: same as before'), { wake: false, why: 'same as before' });
  assert.deepEqual(parseVerdict('**WAKE**: note 12 is due'), { wake: true, why: 'note 12 is due' });
  assert.equal(parseVerdict('WAKE: a\nDEFER: b').wake, false);
  assert.equal(parseVerdict('I think DEFER: maybe').wake, true);
  assert.deepEqual(parseVerdict(''), { wake: true, why: 'pre-check gave no verdict' });
});

test('wantsPrecheck: only after IDLE/WAITING, within the cap', () => {
  const now = Date.parse('2026-11-02T12:00:00Z'), lastWake = new Date(now - 3600e3).toISOString();
  assert.equal(wantsPrecheck({ endStatus: 'idle', lastWake }, now), true);
  assert.equal(wantsPrecheck({ endStatus: 'waiting', lastWake }, now), true);
  for (const endStatus of ['done', 'blocked', 'error', '', undefined]) assert.equal(wantsPrecheck({ endStatus, lastWake }, now), false);
  assert.equal(wantsPrecheck({ endStatus: 'idle', lastWake: new Date(now - PRECHECK_MAX_MS - 1).toISOString() }, now), false);
  assert.equal(wantsPrecheck({ endStatus: 'idle' }, now), false);
});

test('precheckPrompt carries charter, notes and the journal tail', () => {
  const p = precheckPrompt({ s: { id: 'x', name: 'X' }, charter: 'CHARTER', journal: 'a'.repeat(5000) + 'TAIL', notes: '', lastEnd: 'IDLE: nothing', sinceWake: '1 hours' });
  assert.match(p, /CHARTER/); assert.match(p, /TAIL$/); assert.match(p, /\(none\)/); assert.match(p, /IDLE: nothing/);
  assert.ok(!p.includes('a'.repeat(4100)));
});

const bin = (body) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-')), f = path.join(d, 'c.sh'); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`); fs.chmodSync(f, 0o755); return f; };
const run = (b, o = {}) => runPrecheck({ prompt: 'p', settings: '{}', cwd: os.tmpdir(), env: process.env, bin: b, ...o });

test('runPrecheck: DEFER with cost and tokens', async () => {
  const v = await run(bin(`echo '{"result":"DEFER: nothing new","total_cost_usd":0.05,"usage":{"input_tokens":10,"cache_read_input_tokens":90,"output_tokens":7}}'`));
  assert.deepEqual(v, { wake: false, why: 'nothing new', cost: 0.05, in: 100, out: 7 });
});

test('runPrecheck: errors, junk, timeouts and a missing binary all wake', async () => {
  assert.equal((await run(bin(`echo '{"is_error":true,"subtype":"error_max_budget_usd"}'`))).wake, true);
  assert.equal((await run(bin('echo nope'))).wake, true);
  assert.equal((await run(bin('sleep 5'), { timeoutMs: 200 })).why, 'pre-check timed out');
  assert.equal((await run('/nonexistent/claude')).wake, true);
});
