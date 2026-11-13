// Usage and waste: Claude's weekly limit, each squiggle's share of Claude use, what a limit week bought, and use that produced nothing.
// The limit is the provider's own reading; shares are of the room's Claude dollars over the period, so no dollars-per-percent rate is assumed.
// Information only: wakes never pause for it. Read-only over runs/cost.jsonl, runs/*.jsonl and tasks.json.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { onClaude, share } from './cost.mjs';

const WEEK = 7 * 864e5;
const json = (l) => { try { return JSON.parse(l); } catch { return null; } };
const money = (n) => +n.toFixed(2);

// A turn "produced" something if it committed, moved a task, messaged someone, or answered the user.
const COMMIT = /\bgit\b[^\n]*\bcommit\b/, BOARD = /\btask (move|add|ship|split|claim|drop|release|edit)\b/;
const MESSAGE = /(?:agents\.mjs|\bagents|\$\w+)\s+(?:tell|suggest|pick ask|ask run)\b|^\s*(?:tell|suggest|pick ask|ask run)\s/m;
// A commit touching only journals or charters is the wake's own bookkeeping, not work.
const journalOnly = (text) => {
  const added = [...text.matchAll(/\bgit\b[^\n;&|]*?\badd\s+([^\n;&|]+)/g)].flatMap((m) => m[1].trim().split(/\s+/)).filter((p) => !p.startsWith('-'));
  return added.length ? added.every((p) => /(journal|charter)\.md["']?$/.test(p)) : /\bcommit\b[^\n]*\bjournal\b/i.test(text);
};
export const signal = (text = '') => {
  if (BOARD.test(text) || MESSAGE.test(text)) return 'work';
  if (COMMIT.test(text)) return journalOnly(text) ? 'journal' : 'work';
  return null;
};

// runs/<id>.jsonl is far too big to hold or read synchronously in the server, so stream it and keep only what we use.
async function scan(file, keep) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const l of rl) if (l.includes('"k":"tool"') || l.includes('"k":"end"') || l.includes('"k":"rate"') || l.includes('"from":"owner"')) { const e = json(l); if (e) keep(e); }
}

export async function usage({ root, days = 7, weeks = 4, now = Date.now() }) {
  const runs = path.join(root, 'runs'), since = now - days * 864e5;
  let cost = []; try { cost = fs.readFileSync(path.join(runs, 'cost.jsonl'), 'utf8').split('\n').filter(Boolean).map(json).filter(Boolean); } catch {}
  const turns = cost.filter((r) => !r.precheck && r.ts).sort((a, b) => a.ts - b.ts);

  // One pass over the run logs: rate events for limits, and tool, end and the user's messages inside the window for turns.
  const limits = {}, peak = {}, events = {};
  let files = []; try { files = fs.readdirSync(runs).filter((f) => f.endsWith('.jsonl') && f !== 'cost.jsonl' && ((st) => st.isFile() && st.mtimeMs >= now - weeks * WEEK)(fs.statSync(path.join(runs, f)))); } catch {}
  for (const f of files) {
    const id = f.slice(0, -6), mine = (events[id] = []);
    await scan(path.join(runs, f), (e) => {
      if (e.k === 'rate') {
        // Weekly only. Each event carries every window it knows about, so an event about another window can still hold a weekly reading; the top-level utilization only sometimes.
        const i = e.info || {}, w = i.unifiedWindows?.seven_day, used = w?.utilization ?? (i.rateLimitType === 'seven_day' ? i.utilization : undefined), resetsAt = (w?.resetsAt ?? i.resetsAt) * 1000;
        if (used != null && resetsAt) {
          if (!limits.seven_day || e.ts > limits.seven_day.at) limits.seven_day = { used, resetsAt, at: e.ts };
          peak[resetsAt] = Math.max(peak[resetsAt] || 0, used);
        }
      } else if (e.ts >= since - 864e5) mine.push(e);
    });
    mine.sort((a, b) => a.ts - b.ts);
  }

  for (const l of Object.values(limits)) l.stale = l.resetsAt <= now; // its window closed, and nothing has reported the next one

  // Each turn owns the events since its squiggle's previous cost row. Rows land at turn end, so allow a few seconds after.
  const by = {}, last = {}, cursor = {};
  const waste = { turns: 0, claude: 0, nothing: { turns: 0, claude: 0 }, journal: { turns: 0, claude: 0 } };
  for (const r of turns) {
    const from = last[r.id] ?? r.ts - 36e5; last[r.id] = r.ts;
    if (r.ts < since) continue;
    const c = onClaude(r) ? r.cost || 0 : 0, s = (by[r.id] ??= { id: r.id, claude: 0, in: 0, out: 0, turns: 0, nothing: 0, nothingClaude: 0 });
    s.claude += c; s.in += r.in || 0; s.out += r.out || 0; s.turns++; waste.turns++; waste.claude += c;
    const es = events[r.id] || []; let i = cursor[r.id] || 0, kind = null;
    while (i < es.length && es[i].ts <= from) i++;
    for (; i < es.length && es[i].ts <= r.ts + 5e3; i++) {
      const e = es[i], got = e.k === 'tool' ? signal(e.text) : e.k === 'user' && e.from === 'owner' ? 'work' : null;
      if (got === 'work' || (got && !kind)) kind = got;
    }
    cursor[r.id] = i;
    if (kind === 'journal') { waste.journal.turns++; waste.journal.claude += c; }
    if (!kind) { waste.nothing.turns++; waste.nothing.claude += c; s.nothing++; s.nothingClaude += c; }
  }
  const ofUse = (c) => (waste.claude ? +(c / waste.claude).toFixed(4) : 0);

  // Limit weeks end at the seven-day reset, so a week's peak is what that week used of the plan.
  const end = limits.seven_day?.resetsAt > now ? limits.seven_day.resetsAt : now;
  let tasks = []; try { tasks = JSON.parse(fs.readFileSync(path.join(root, 'tasks.json'), 'utf8')).tasks; } catch {}
  const list = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const to = end - i * WEEK, from = to - WEEK, inWeek = (t) => t >= from && t < to, w = { from, to, soFar: to > now, cost: 0, claude: 0, finished: 0, merged: 0 };
    let rows = 0;
    for (const r of cost) if (inWeek(r.ts)) { rows++; w.cost += r.cost || 0; if (onClaude(r)) w.claude += r.cost || 0; }
    for (const t of tasks) {
      if (t.status !== 'done' || !t.finished || t.kind === 'suggestion') continue;
      if (inWeek(t.finishedAt || Date.parse(t.finished))) { w.finished++; if (t.merged) w.merged++; }
    }
    w.cost = rows ? money(w.cost) : null; w.claude = rows ? money(w.claude) : null; // before the cost log began, not free
    w.limit = peak[to] ?? null;
    w.perMerged = w.limit != null && w.merged ? +(w.limit / w.merged).toFixed(4) : null;
    list.push(w);
  }

  const squiggles = Object.values(by).map(({ claude, nothingClaude, ...s }) => ({ ...s, share: ofUse(claude), nothingShare: ofUse(nothingClaude), reread: s.out ? Math.round(s.in / s.out) : null })).sort((a, b) => b.share - a.share || b.turns - a.turns);
  const tin = squiggles.reduce((n, s) => n + s.in, 0), tout = squiggles.reduce((n, s) => n + s.out, 0);
  const out = {
    days, limits, weeks: list, squiggles,
    turns: { count: waste.turns, nothing: { turns: waste.nothing.turns, share: ofUse(waste.nothing.claude) }, journal: { turns: waste.journal.turns, share: ofUse(waste.journal.claude) } },
    tokens: { in: tin, out: tout, reread: tout ? Math.round(tin / tout) : null },
  };
  return { ...out, text: {
    summary: `${describeLimit('Weekly', limits.seven_day)}. Produced nothing: ${share(out.turns.nothing.share)} of Claude use in ${days} days.`,
    lines: [...list.map(describeWeek), describeWaste(out.turns, days), describeTokens(out.tokens)],
    definition: DEFINITION } };
}

const when = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const date = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const pct = (n) => `${Math.round(n * 100)}%`;
const big = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);

// Sentences shared by the CLI and the API, so the two can't drift.
export const describeLimit = (name, l) => (!l ? `${name}: no reading yet` : l.stale ? `${name}: no current reading (last ${pct(l.used)} on ${date(l.at)})` : `${name}: ${pct(l.used)} used, resets ${when(l.resetsAt)}`);
export const weekName = (w) => `${date(w.from)} to ${date(w.to)}${w.soFar ? ' so far' : ''}`;
export const describeWeek = (w) => `${weekName(w)}: ${w.limit != null ? `${pct(w.limit)} of the weekly limit` : 'no limit reading'}, ${w.finished} finished, ${w.merged} merged${w.perMerged != null ? `, ${share(w.perMerged)} per merged task` : ''}`;
export const describeWaste = (t, days) => `Last ${days} days: ${t.count} turns. Produced nothing: ${t.nothing.turns} turns, ${share(t.nothing.share)} of Claude use. Journal only: ${t.journal.turns} turns, ${share(t.journal.share)}.`;
export const describeTokens = (k) => `Rereading: ${big(k.in)} tokens in, ${big(k.out)} out, ${k.reread ?? 0} read per 1 written.`;
export const describeSquiggle = (s) => `${s.id}: ${s.share ? `${share(s.share)} of Claude use` : 'not on Claude'}, ${s.turns} turns, ${s.nothing} produced nothing${s.nothingShare ? ` (${share(s.nothingShare)})` : ''}, ${s.reread ?? 0} read per 1 written`;
export const report = (u) => [describeLimit('Weekly', u.limits.seven_day), '', ...u.weeks.map(describeWeek), '', describeWaste(u.turns, u.days), describeTokens(u.tokens), '', ...u.squiggles.map(describeSquiggle), '', DEFINITION].join('\n');
export const DEFINITION = 'Produced nothing: no commit, task change or message, and no reply to you. Journal only: its only commit was a journal or charter. Percents per squiggle and for waste are shares of Claude use over the period, by list price. Other providers aren\'t on the Claude limit, so they count turns only.';
