// The user's load: per local day, what they did (merges, ask Runs and Denies, messages) and what shipped.
// Read-only over the records the harness already keeps: tasks.json, runs/*.jsonl, runs/asks.log, runs/stalls.jsonl.
import fs from 'node:fs';
import path from 'node:path';

const day = (t) => new Date(t).toLocaleDateString('sv'); // YYYY-MM-DD, local
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const json = (l) => { try { return JSON.parse(l); } catch { return null; } };
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export const KEYS = ['merges', 'runs', 'denies', 'messages'];

export function load({ root, days = 7, now = Date.now() }) {
  const runs = path.join(root, 'runs'), from = day(now - (days - 1) * 864e5), rows = {};
  const row = (d) => (rows[d] ??= { date: d, merges: 0, runs: 0, denies: 0, messages: 0, questions: 0, done: 0, merged: 0 }); // calls, callP50, callP90, stalls, stallMax only when there are any
  const add = (t, k) => { const d = typeof t === 'string' && /^\d{4}-\d\d-\d\d$/.test(t) ? t : day(t); if (d >= from) row(d)[k]++; };
  // finished is a UTC date; finishedAt (ms) puts it on the right local day. Older tasks keep the UTC date.
  for (const t of read(path.join(root, 'tasks.json'), { tasks: [] }).tasks) {
    if (t.status !== 'done' || !t.finished) continue;
    const at = t.finishedAt || t.finished;
    add(at, 'done');
    if (t.merged) { add(at, 'merged'); if (!t.mergedBy || t.mergedBy === 'owner') add(at, 'merges'); }
  }
  for (const e of lines(path.join(runs, 'asks.log')).map(json)) {
    if (e?.ev === 'running' && e.who === 'owner') add(e.t, 'runs');
    if (e?.ev === 'denied') add(e.t, 'denies');
  }
  // One message sent to several chats at once (a meeting, a broadcast) counts once.
  const said = new Set(), calls = new Map(), waits = {}; let files = []; try { files = fs.readdirSync(runs).filter((f) => f.endsWith('.jsonl')); } catch {}
  for (const f of files) for (const l of lines(path.join(runs, f))) {
    if (l.includes('"from":"owner"')) { const e = json(l); if (e?.k === 'user' && e.from === 'owner' && !said.has(`${Math.floor(e.ts / 5000)} ${e.text}`)) { said.add(`${Math.floor(e.ts / 5000)} ${e.text}`); add(e.ts, 'messages'); } }
    else if (f === 'lead.jsonl' && l.includes('"k":"say"') && l.includes('?')) { const e = json(l); if (e?.k === 'say' && /\?/.test(e.text || '')) add(e.ts, 'questions'); }
    // Lead tool-call latency: an agents.mjs Bash call's tool event to its out event, i.e. how long the harness kept the lead waiting.
    else if (f === 'lead.jsonl' && l.includes('"k":"tool"') && l.includes('agents.mjs')) { const e = json(l); if (e?.tid) calls.set(e.tid, e.ts); }
    else if (f === 'lead.jsonl' && calls.size && l.includes('"k":"out"')) { const tid = /"tid":"([^"]+)"/.exec(l)?.[1], at = calls.get(tid), ts = +(/"ts":(\d+)/.exec(l)?.[1]); if (at && ts) { calls.delete(tid); if (day(at) >= from) (waits[day(at)] ??= []).push(ts - at); } }
  }
  // Event-loop stalls over 1s the server logged.
  for (const e of lines(path.join(runs, 'stalls.jsonl')).map(json)) if (e?.ts && day(e.ts) >= from) { const r = row(day(e.ts)); r.stalls = (r.stalls || 0) + 1; r.stallMax = Math.max(r.stallMax || 0, e.ms || 0); }
  const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  for (const [d, a] of Object.entries(waits)) { a.sort((x, y) => x - y); Object.assign(row(d), { calls: a.length, callP50: pct(a, 0.5), callP90: pct(a, 0.9) }); }
  const list = []; for (let i = days - 1; i >= 0; i--) { const d = day(now - i * 864e5); list.push({ ...row(d), actions: KEYS.reduce((n, k) => n + row(d)[k], 0) }); }
  return list;
}

// One line per day for the CLI, and the sentence the Goals tab shows.
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const describe = (r) => `${plural(r.actions, 'action')} (${plural(r.merges, 'merge')}, ${plural(r.runs + r.denies, 'ask')}, ${plural(r.messages, 'message')}); shipped ${plural(r.done, 'task')}, ${r.merged} merged; lead asked ${plural(r.questions, 'question')}${r.calls ? `; lead waited ${secs(r.callP50)} typical, ${secs(r.callP90)} slow per harness call (${r.calls})` : ''}${r.stalls ? `; ${plural(r.stalls, 'server stall')} over 1s, worst ${secs(r.stallMax)}` : ''}`;
const secs = (ms) => `${(ms / 1000).toFixed(ms < 10e3 ? 1 : 0)}s`;
