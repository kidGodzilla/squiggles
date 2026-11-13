// Burn mode end to end: a real server in a temp room with a stub `claude`, the scheduler ticking every 300 ms. Burn on wakes
// the frequent Claude squiggles back to back; slow, paused and lead squiggles keep their schedule; burn off stops it.
// HOME is the temp room: nothing here touches the live room.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { boot } from './room.mjs';
import { burns, burnDue, burnOn, BURN_MAX_EVERY } from '../burn.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const room = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'burn-')));
const HOME = path.join(room, 'home'), DATA = path.join(room, 'data'), BIN = path.join(room, 'stub');
const CODE = 'demo-code-not-real';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const busy = () => Math.min(6, Math.max(1, os.loadavg()[0] / os.cpus().length));
async function until(fn, what, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms * busy()) { const v = await fn(); if (v) return v; await sleep(100); }
  throw new Error(`timed out: ${typeof what === 'function' ? what() : what}`);
}
// Every message a squiggle got, one JSON line each; a turn ends at once.
const stub = `#!${process.execPath}
const fs = require('fs'), path = require('path'), id = process.env.AGENTS_ID, home = process.env.HOME;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d; const lines = buf.split('\\n'); buf = lines.pop();
  for (const l of lines) {
    fs.appendFileSync(path.join(home, 'inbox-' + id + '.jsonl'), l + '\\n');
    out({ type: 'system', subtype: 'init', session_id: 'stub-' + id });
    out({ type: 'result', subtype: 'success', result: 'IDLE: test', session_id: 'stub-' + id, usage: {} });
  }
});
process.stdin.on('end', () => process.exit(0));
`;
const inbox = (id) => { try { return fs.readFileSync(path.join(HOME, `inbox-${id}.jsonl`), 'utf8'); } catch { return ''; } };
const burnWakes = (id) => (inbox(id).match(/Wake \(burn\)/g) || []).length;
const allWakes = (id) => (inbox(id).match(/Wake \(/g) || []).length;
const SQ = { boss: { lead: true }, fast: { every: 10 }, quick: { every: 30 }, slow: { every: 1440 }, napping: { every: 10, paused: true } };

let room0, base;
const PAGE = { 'user-agent': 'Mozilla/5.0', 'sec-fetch-site': 'same-origin' };
const api = (p, b, headers = PAGE) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
const cli = (...args) => spawnSync(process.execPath, [path.join(REPO, 'bin', 'agents.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, HOME, SQUIGGLES_HOME: DATA } });

before(async () => {
  fs.mkdirSync(HOME); fs.mkdirSync(BIN); fs.mkdirSync(path.join(DATA, 'runs'), { recursive: true });
  for (const [id, extra] of Object.entries(SQ)) {
    const d = path.join(DATA, 'squiggles', id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'squiggle' + '.json'), JSON.stringify({ name: id, role: 'Test', cwd: '~', every: 0, paused: false, permissionMode: 'auto', ...extra }));
    fs.writeFileSync(path.join(d, 'charter.md'), 'Test fixture.\n'); fs.writeFileSync(path.join(d, 'journal.md'), '');
  }
  fs.writeFileSync(path.join(BIN, 'claude'), stub, { mode: 0o755 });
  room0 = await boot(DATA, {}, { HOME, PATH: `${BIN}:${process.env.PATH}`, SQUIGGLES_SCHED_MS: '300' });
  assert.ok(room0.up, room0.out);
  base = `http://127.0.0.1:${room0.port}`; PAGE.origin = base;
  assert.equal((await api('/api/passcode', { op: 'set', code: CODE })).status, 200);
  PAGE.cookie = ((await api('/api/passcode', { op: 'unlock', code: CODE })).headers.get('set-cookie') || '').split(';')[0];
  assert.ok(PAGE.cookie, 'a session from unlocking');
});
after(async () => { await room0?.halt(); fs.rmSync(room, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('burn picks frequent unpaused Claude squiggles only', () => {
  const on = { burn: 'on' };
  assert.equal(burnOn(on), true); assert.equal(burnOn({}), false);
  assert.equal(burns(on, { every: 10 }, ''), true);
  assert.equal(burns(on, { every: BURN_MAX_EVERY }, ''), true);
  assert.equal(burns(on, { every: 1440 }, ''), false);
  assert.equal(burns(on, { every: 10, paused: true }, ''), false);
  assert.equal(burns(on, { every: 10, lead: true }, ''), false);
  assert.equal(burns(on, { every: 0 }, ''), false);
  assert.equal(burns(on, { every: 10 }, 'codex'), false);
  assert.equal(burns({}, { every: 10 }, ''), false);
  assert.equal(burnDue('2026-11-12T00:00:00.000Z', 60000), Date.parse('2026-11-12T00:01:00.000Z'));
  assert.equal(burnDue(undefined, 60000), 60000);
});

test('burn on wakes back to back, burn off restores the schedule', async () => {
  // Let the normal schedule settle: the stagger allows one Claude start per 2 minutes.
  await sleep(1500);
  assert.ok(['fast', 'quick', 'slow'].reduce((n, id) => n + allWakes(id), 0) <= 1, 'one staggered wake at most before burn');
  assert.equal((await api('/api/room', { action: 'burn', value: 'maybe' })).status, 400);
  assert.match(cli('burn', 'maybe').stderr, /burn on\|off/);
  assert.equal(cli('burn').stdout.trim(), 'burn off');
  assert.equal((await api('/api/room', { action: 'burn', value: 'on' })).status, 200);
  assert.equal(cli('burn').stdout.trim(), 'burn on');
  // Two ticks between wakes, so three each well inside a few seconds.
  await until(() => burnWakes('fast') >= 3 && burnWakes('quick') >= 3, () => `fast ${burnWakes('fast')}, quick ${burnWakes('quick')}: ${room0.out.slice(-400)}`);
  assert.match(inbox('fast'), /Burn mode is on/);
  assert.equal(burnWakes('slow'), 0, 'a daily squiggle keeps its schedule');
  assert.equal(burnWakes('boss'), 0, 'the lead is never burned');
  assert.equal(inbox('napping'), '', 'a paused squiggle stays asleep');
  // Off: the last burn wake is recent, so the 10-minute cadence holds everything still.
  assert.equal((await api('/api/room', { action: 'burn', value: 'off' })).status, 200);
  assert.equal(cli('burn').stdout.trim(), 'burn off');
  await sleep(500);
  const n = burnWakes('fast') + burnWakes('quick');
  await sleep(2500);
  assert.equal(burnWakes('fast') + burnWakes('quick'), n, 'no burn wakes after off');
});

test('burn needs the unlocked page or the lead', async () => {
  assert.notEqual((await api('/api/room', { action: 'burn', value: 'on' }, {})).status, 200, 'no session, no squiggle');
  assert.notEqual(cli('burn', 'on').status, 0, 'a plain process is not the lead');
  assert.equal(cli('burn').stdout.trim(), 'burn off');
});
