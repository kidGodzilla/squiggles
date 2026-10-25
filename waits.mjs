// Waits: something better for async work than BLOCKED. A squiggle that started a long job files a wait:
// a file appearing or a pid exiting, here or on a host over ssh. The harness checks it every few minutes, even after the
// squiggle's turn and session end, and wakes it with the result. The checks are fixed probes the harness builds itself
// (test -e, kill -0, head -c of a /tmp file), never a squiggle's own command: that would get round auto mode, which is
// what `ask run` is for. "A command exiting 0" is `nohup sh -c 'cmd; echo $? > /tmp/x.exit' &` and a wait on the file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { mask } from './asks.mjs';

const MIN = 6e4, HOUR = 36e5;
const STATES = ['todo', 'doing', 'blocked', 'review', 'done'];
const MAX_OPEN = 5, MAX_FAILS = 10, SHOW = 2048;
const err = (m, code = 400) => Object.assign(new Error(m), { code });
// "90s", "5m", "4h", or minutes.
export function dur(v, def) {
  if (v == null || v === '') return def;
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(String(v).trim());
  if (!m) throw err(`duration: like 90s, 5m, 4h or 2d, not ${v}`);
  return Number(m[1]) * { s: 1000, m: MIN, h: HOUR, d: 24 * HOUR }[(m[2] || 'm').toLowerCase()];
}
const HOST = /^(?:[A-Za-z0-9_][\w.-]*@)?[A-Za-z0-9][\w.-]*$/;
const PATH = /^[\w.\/~+@:-]+$/;
const home = (p) => p.replace(/^~(?=\/|$)/, os.homedir());

// Checks a wait once. Resolves { done, result } when it's over, { done: false } while it runs, { fail } when the check can't run.
export function probe(w, { exec = execFile, taskStatus } = {}) {
  // A board task reaching a status: read in-process, nothing runs.
  if (w.state) {
    if (!taskStatus) return Promise.resolve({ fail: 'no board' });
    let st; try { st = taskStatus(w.task); } catch (e) { return Promise.resolve({ fail: `board: ${e.message}` }); } // never read as dropped
    return Promise.resolve(st == null ? { done: true, result: `${w.task} is no longer on the board (dropped)` } : st === w.state ? { done: true, result: `${w.task} is ${st}` } : { done: false });
  }
  const run = (cmd, args) => new Promise((res) => exec(cmd, args, { timeout: 30000, maxBuffer: 64 * 1024 }, (e, out, er) => res({ code: e ? (typeof e.code === 'number' ? e.code : 255) : 0, out: String(out || ''), err: String(er || e?.message || '') })));
  const sh = (script) => (w.host ? run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', w.host, script]) : run('/bin/sh', ['-c', script]));
  const where = w.host ? ` on ${w.host}` : '';
  // The script prints one word, so an ssh failure (255) is never read as "gone".
  if (w.pid) return sh(`kill -0 ${w.pid} 2>/dev/null && echo alive || echo gone`).then((r) =>
    /\bgone\b/.test(r.out) ? { done: true, result: `pid ${w.pid}${where} exited` } : /\balive\b/.test(r.out) ? { done: false } : { fail: (r.err || `exit ${r.code}`).trim().slice(0, 200) });
  const f = w.host ? w.file : home(w.file), q = `'${f}'`;
  // Only a file under /tmp is read back (a job's .exit or .out); anything else just reports that it appeared.
  // A plain file really in /tmp: no symlink (itself or a parent), no hard link to a file elsewhere.
  const show = /^\/tmp\//.test(f) && !f.includes('..');
  const read = `case "$(realpath ${q} 2>/dev/null)" in /tmp/*|/private/tmp/*) [ ! -L ${q} ] && [ -n "$(find ${q} -maxdepth 0 -type f -links 1 2>/dev/null)" ] && head -c ${SHOW} ${q};; esac`;
  return sh(`if [ -e ${q} ]; then echo present; ${show ? read : ''}; else echo absent; fi`).then((r) => {
    if (/^present\n?/.test(r.out)) { const body = r.out.replace(/^present\n?/, '').trim(); return { done: true, result: `${w.file}${where} appeared${body ? `:\n${mask(body)}` : ''}` }; }
    return /^absent/.test(r.out) ? { done: false } : { fail: (r.err || `exit ${r.code}`).trim().slice(0, 200) };
  });
}

export function createWaits({ file, now = () => Date.now() }) {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { n: 0, waits: [] }; } };
  const save = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 1)); };
  function add({ by, what, file: f, pid, host, every, max, task, state }) {
    if (!by) throw err('only a squiggle files a wait', 403);
    what = String(what || '').trim().slice(0, 200);
    if (!what) throw err('wait add "<what>" --file <path> | --pid <pid> [--host <user@host>] [--every 2m] [--for 4h] [--task <id>]');
    if (state != null && !task) throw err('--until <status> needs --task <id>');
    if (state != null && !STATES.includes(state)) throw err(`--until: a task status (${STATES.join(', ')})`);
    if ([f, pid, state].filter((x) => x != null && x !== '').length !== 1) throw err('one of --file <path>, --pid <pid> or --task <id> --until <status>');
    if (pid != null && !/^\d{1,9}$/.test(String(pid))) throw err('--pid: a number');
    if (f && (!PATH.test(String(f)) || String(f).length > 300)) throw err('--file: a plain path (letters, digits, / . _ - ~)');
    if (host && !HOST.test(String(host))) throw err('--host: user@host or host');
    if (host && f && !String(f).startsWith('/')) throw err('--file on a host: an absolute path');
    const ev = dur(every, state ? 30000 : 2 * MIN), mx = dur(max, state ? 3 * 24 * HOUR : 4 * HOUR);
    if (ev < 30000 || ev > HOUR) throw err('--every: between 30s and 1h');
    if (mx < MIN || mx > (state ? 7 * 24 : 24) * HOUR) throw err(`--for: between 1m and ${state ? '7d' : '24h'}`);
    const s = load();
    if (s.waits.filter((w) => w.by === by && w.status === 'waiting').length >= MAX_OPEN) throw err(`${by} already has ${MAX_OPEN} open waits: drop one`, 429);
    const w = { id: `w${++s.n}`, by, what, ...(state ? { state } : f ? { file: String(f) } : { pid: Number(pid) }), ...(host && { host: String(host) }), every: ev,
      ...(task && { task: String(task).slice(0, 20) }), status: 'waiting', created: now(), until: now() + mx, next: now() + Math.min(ev, 30000), fails: 0 };
    s.waits.push(w); save(s); return w;
  }
  const list = ({ all = false, by } = {}) => load().waits.filter((w) => (all || w.status === 'waiting') && (!by || w.by === by));
  const get = (id) => { const w = load().waits.find((x) => x.id === id); if (!w) throw err(`no wait ${id}`, 404); return w; };
  // Its squiggle, the lead or the user drops it.
  function drop(id, { by = '', boss = false } = {}) {
    const s = load(), w = s.waits.find((x) => x.id === id);
    if (!w) throw err(`no wait ${id}`, 404);
    if (!boss && by !== w.by) throw err(`only ${w.by}, the lead or the user drops ${id}`, 403);
    if (w.status !== 'waiting') throw err(`${id} is ${w.status}`, 409);
    Object.assign(w, { status: 'dropped', ended: now(), ...(by && by !== w.by && { droppedBy: by }) }); save(s); return w;
  }
  // One pass (a paused squiggle's waits sit until it's back): checks each due wait, ends the finished, timed-out and failing ones. Returns those that ended, for waking.
  async function tick({ exec, taskStatus, skip = () => false } = {}) {
    const due = load().waits.filter((w) => w.status === 'waiting' && now() >= w.next && !skip(w.by));
    const ended = [];
    for (const w0 of due) {
      const r = await probe(w0, { exec, taskStatus }).catch((e) => ({ fail: e.message }));
      const s = load(), w = s.waits.find((x) => x.id === w0.id); if (!w || w.status !== 'waiting') continue;
      w.checked = now(); w.next = now() + w.every;
      if (r.done) Object.assign(w, { status: 'done', result: r.result, ended: now() });
      else if (r.fail) { w.fails++; w.lastFail = r.fail; if (w.fails >= MAX_FAILS) Object.assign(w, { status: 'failed', result: `the check failed ${w.fails} times in a row: ${r.fail}`, ended: now() }); }
      else { w.fails = 0; delete w.lastFail; }
      if (w.status === 'waiting' && now() >= w.until) Object.assign(w, { status: 'timedout', result: `still not done after ${Math.round((w.until - w.created) / MIN)} min`, ended: now() });
      save(s); if (w.status !== 'waiting') ended.push({ ...w });
    }
    return ended;
  }
  return { add, list, get, drop, tick };
}
