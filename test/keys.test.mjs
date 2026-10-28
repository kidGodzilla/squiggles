import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { KEYS } = createRequire(import.meta.url)('../ui/keys.js');

test('shortcut table: groups of [keys, what], no key twice outside Chat', () => {
  assert.ok(KEYS.length >= 3);
  for (const [g, rows] of KEYS) { assert.equal(typeof g, 'string'); for (const r of rows) assert.ok(r.length === 2 && r[0] && r[1], `${g}: ${r}`); }
  const page = KEYS.filter(([g]) => g !== 'Chat').flatMap(([, r]) => r.map(([k]) => k));
  assert.equal(new Set(page).size, page.length);
});

test('room keys prints the same table, offline', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-'));
  const out = execFileSync(process.execPath, ['bin/agents.mjs', 'room', 'keys'], { encoding: 'utf8', env: { ...process.env, SQUIGGLES_HOME: d, PORT: '9' } });
  fs.rmSync(d, { recursive: true });
  for (const [g, rows] of KEYS) { assert.match(out, new RegExp(`^${g}$`, 'm')); for (const [k, w] of rows) assert.ok(out.includes(w), `${k}: ${w}`); }
});
