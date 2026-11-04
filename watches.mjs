// Watches: a squiggle's own read-only check command, run by the server on a schedule with no model, waking the squiggle
// only when the output changes. waits.mjs never runs a squiggle's command because that would get round auto mode, so a
// watch runs only after the user approves its exact text (askHash of cwd + cmd), and every run still passes the owner's
// guard first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { askHash, mask } from './asks.mjs';
import { commandReason, privateCheck } from './fence.mjs';
import { claudeCaller } from './notes.mjs';
import { dataDir, providerFor as providerOf } from './config.mjs';
import { dur } from './waits.mjs';

const MIN = 6e4, HOUR = 36e5;
export const MAX_PER = 5, MAX_OUT = 64 * 1024, DIFF_MAX = 4096, FAILS_WAKE = 3;
const err = (m, code = 400) => Object.assign(new Error(m), { code });

// The owner's guard, the same rules its tool calls meet. A non-Claude owner also meets the private-data fence its own
// shell hook runs (config privateDirs, privateTools, privateRemote).
export function guardReason(owner, cmd, cwd, data = dataDir()) {
  return commandReason(cmd, cwd) || (claudeCaller(owner, data) ? '' : privateCheck('bash', { command: cmd }, cwd, os.homedir(), data));
}
// What counts as the answer: output minus --ignore matches, plus the exit code.
// The regex runs on the server's main thread, so it gets a time limit: (a+)+$ would otherwise hang the whole server.
export const IGNORE_MS = 250;
export function normalize(out, ignore) {
  const t = String(out ?? '');
  if (!ignore) return t;
  try { return vm.runInNewContext('t.replace(re, "")', { t, re: new RegExp(ignore, 'g') }, { timeout: IGNORE_MS }); }
  catch (e) { throw e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? err(`--ignore took over ${IGNORE_MS} ms`, 'ignore-slow') : e; }
}
export const sigOf = (out, exit, ignore) => crypto.createHash('sha1').update(`${exit}\u0000${normalize(out, ignore)}`).digest('hex');
// Lines gone and lines new, in order, capped. Plenty for a wake prompt; no need for a real LCS.
export function lineDiff(a, b, max = DIFF_MAX) {
  const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n'), inA = new Set(A), inB = new Set(B);
  const d = [...A.filter((l) => !inB.has(l)).map((l) => `- ${l}`), ...B.filter((l) => !inA.has(l)).map((l) => `+ ${l}`)].join('\n');
  return d.length > max ? `${d.slice(0, max)}\n[diff cut at ${max / 1024} KB]` : d;
}
// sh -c in the watch's cwd, env cut to PATH/HOME/AGENTS_ID/SQUIGGLES_HOME, no stdin, timeout, capped. Resolves { exit, out }.
export function runWatch(w, { exec = execFile } = {}) {
  const ms = w.timeout || (/\bssh\b/.test(w.cmd) ? 90000 : 60000);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, AGENTS_ID: w.owner, ...(process.env.SQUIGGLES_HOME && { SQUIGGLES_HOME: process.env.SQUIGGLES_HOME }) };
  return new Promise((res) => {
    const p = exec('/bin/sh', ['-c', w.cmd], { cwd: w.cwd, env, timeout: ms, maxBuffer: MAX_OUT }, (e, out, er) => {
      const exit = e ? (typeof e.code === 'number' ? e.code : e.killed ? 'timeout' : 'error') : 0;
      res({ exit, out: `${String(out || '')}${er ? `\n${String(er)}` : ''}`.slice(0, MAX_OUT) });
    });
    p?.stdin?.end?.();
  });
}

// What the user approves: cwd + cmd, plus --ignore when set (an ignore like [\s\S]* would silence a watch), plus --added,
// which decides which changes wake.
export const watchHash = (w) => askHash(w.cwd, `${w.ignore ? `${w.cmd}\u0000ignore:${w.ignore}` : w.cmd}${w.added ? '\u0000added' : ''}`);
// --added: lines in the new output that weren't in the old, blanks skipped.
export const addedLines = (a, b) => { const inA = new Set(String(a ?? '').split('\n')); return String(b ?? '').split('\n').filter((l) => l.trim() && !inA.has(l)); };
// The owner's provider ('' for Claude); unreadable counts as non-Claude.
export function ownerProvider(o, data = dataDir()) {
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')); } catch {}
  try { return providerOf(JSON.parse(fs.readFileSync(path.join(data, 'squiggles', o, 'squiggle.json'), 'utf8')), cfg) || ''; } catch { return 'unknown'; }
}
export function createWatches({ file, outDir, now = () => Date.now(), data = dataDir(), guard = (o, c, d) => guardReason(o, c, d, data), providerFor = (o) => ownerProvider(o, data) }) {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { n: 0, watches: [] }; } };
  const save = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2)); fs.renameSync(`${file}.tmp`, file); };
  const outFile = (w) => path.join(outDir(w.owner), `watch-${w.id}.out`);
  const find = (s, id) => { const w = s.watches.find((x) => x.id === id); if (!w) throw err(`no watch ${id}`, 404); return w; };

  // Filed pending: nothing runs until approve(). The guard is checked now too, so a refused command never reaches the user.
  // timeout: a run's limit (10s to 15m), kept out of the hash: it limits the run, never widens it.
  function add({ owner, cmd, cwd, every, ignore, task, timeout, added }) {
    cmd = String(cmd || '').trim(); cwd = String(cwd || '');
    if (!owner || !cmd) throw err('watch add "<read-only command>" --every 30m [--timeout 10m] [--added] [--ignore <regex>] [--cwd <dir>] [--task <id>]');
    if (cmd.length > 2000) throw err('command: 2000 characters at most');
    if (mask(cmd) !== cmd) throw err('the command holds something secret-shaped: read it from a file or a tool (dt, gh) instead');
    if (!path.isAbsolute(cwd)) throw err('--cwd: an absolute path');
    const ev = dur(every, 30 * MIN);
    if (ev < 5 * MIN || ev > 24 * HOUR) throw err('--every: between 5m and 24h');
    const to = timeout == null || timeout === '' ? 0 : dur(timeout, 0);
    if (to && (to < 10000 || to > 15 * MIN)) throw err('--timeout: between 10s and 15m');
    if (ignore) { if (String(ignore).length > 300) throw err('--ignore: 300 characters at most'); try { new RegExp(ignore); } catch (e) { throw err(`--ignore: ${e.message}`); } }
    const r = guard(owner, cmd, cwd);
    if (r) throw err(`your guard refuses it: ${r}`, 403);
    const s = load();
    if (s.watches.filter((w) => w.owner === owner && w.state !== 'dropped').length >= MAX_PER) throw err(`${owner} already has ${MAX_PER} watches: drop one`, 429);
    const w = { id: `wt${++s.n}`, owner, cmd, cwd, every: ev, ...(ignore && { ignore: String(ignore) }), ...(task && { task: String(task).slice(0, 20) }), ...(to && { timeout: to }), ...(added && { added: true }),
      hash: watchHash({ cwd, cmd, ignore, added: !!added }), state: 'pending', created: now(), fails: 0 };
    s.watches.push(w); save(s); return w;
  }
  // The user approves what they saw: the hash must match the stored text.
  function approve(id, hash) {
    const s = load(), w = find(s, id);
    if (w.state !== 'pending') throw err(`${id} is ${w.state}`, 409);
    if (hash !== w.hash || watchHash(w) !== w.hash) throw err(`${id} changed since you saw it`, 409);
    Object.assign(w, { state: 'on', approved: now(), approvedHash: w.hash, next: now() }); save(s); return w;
  }
  function drop(id, { by = '', boss = false } = {}) {
    const s = load(), w = find(s, id);
    if (!boss && by !== w.owner) throw err(`only ${w.owner}, the lead or the user drops ${id}`, 403);
    if (w.state === 'dropped') throw err(`${id} is dropped`, 409);
    Object.assign(w, { state: 'dropped', ended: now() }); save(s); try { fs.rmSync(outFile(w)); } catch {}
    return w;
  }
  // runsFor: a non-Claude owner's provider, shown on the card (its output reaches that model).
  const list = ({ owner, all = false } = {}) => load().watches.filter((w) => (all || w.state !== 'dropped') && (!owner || w.owner === owner))
    .map((w) => { const p = providerFor(w.owner); return p ? { ...w, runsFor: p } : w; });

  // One pass over due watches, run side by side: a 10-minute watch doesn't hold back the rest.
  // running: a watch still in flight from an earlier tick is skipped, never started twice.
  const running = new Set();
  async function tick({ exec, skip = () => false, onWake } = {}) {
    const due = load().watches.filter((w) => (w.state === 'on' || w.state === 'failing') && now() >= (w.next || 0) && !skip(w.owner) && !running.has(w.id));
    // onWake: sent the moment it happens, not when the slowest watch in this tick ends.
    const wakes = [], out = (x) => { wakes.push(x); try { onWake?.(x); } catch {} };
    await Promise.all(due.map(async (w0) => {
      // Approved text only; a guard that has tightened since pauses it.
      if (watchHash(w0) !== w0.approvedHash) { set(w0.id, { state: 'paused', why: 'command differs from what was approved' }); return; }
      const g = guard(w0.owner, w0.cmd, w0.cwd);
      if (g) { set(w0.id, { state: 'paused', why: `guard: ${g}` }); out(wake(w0, `Watch ${w0.id} is paused: your guard now refuses \`${w0.cmd}\` (${g}).`)); return; }
      running.add(w0.id);
      let r; try { r = await runWatch(w0, { exec }).catch((e) => ({ exit: 'error', out: e.message })); } finally { running.delete(w0.id); }
      // Load, change, save with no await between: parallel runs can't overwrite each other.
      const s = load(), w = s.watches.find((x) => x.id === w0.id); if (!w || (w.state !== 'on' && w.state !== 'failing')) return;
      w.lastRun = now(); w.next = now() + w.every; w.lastExit = r.exit;
      const failed = r.exit === 'timeout' || r.exit === 'error' || r.exit === 255;
      if (failed) {
        w.fails++;
        if (w.fails === FAILS_WAKE) { w.state = 'failing'; out(wake(w, `Watch ${w.id} failed ${w.fails} times in a row (exit ${r.exit}): ${mask(r.out).slice(-500)}`)); }
        save(s); return;
      }
      const recovered = w.state === 'failing'; w.fails = 0; w.state = 'on';
      let sig, a, b; const f = outFile(w);
      try {
        sig = sigOf(r.out, r.exit, w.ignore);
        if (sig !== w.lastSig) { let old = null; try { old = fs.readFileSync(f, 'utf8'); } catch {} a = normalize(old, w.ignore); b = normalize(r.out, w.ignore); }
      } catch (e) {
        if (e.code !== 'ignore-slow') throw e;
        Object.assign(w, { state: 'paused', why: e.message }); save(s);
        out(wake(w, `Watch ${w.id} is paused: ${e.message}. Drop it and add a simpler one.`)); return;
      }
      if (sig !== w.lastSig) {
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, r.out);
        if (w.lastSig && w.added) { const nl = addedLines(a, b); if (nl.length) out(wake(w, `Watch ${w.id} has ${nl.length} new line${nl.length > 1 ? 's' : ''} (\`${w.cmd}\`, exit ${r.exit}).\n${mask(lineDiff('', nl.join('\n')))}`)); }
        else if (w.lastSig) out(wake(w, `Watch ${w.id} changed (\`${w.cmd}\`, exit ${r.exit}).\n${mask(lineDiff(a, b))}`));
        w.lastSig = sig; w.changed = now();
      } else if (recovered) out(wake(w, `Watch ${w.id} works again; output unchanged.`));
      save(s);
    }));
    return wakes;
  }
  const set = (id, patch) => { const s = load(), w = s.watches.find((x) => x.id === id); if (w) { Object.assign(w, patch); save(s); } };
  const wake = (w, prompt) => ({ owner: w.owner, id: w.id, ...(w.task && { task: w.task }), prompt });
  return { add, approve, drop, list, tick, outFile };
}
