// Cost ledger: one row per finished turn in runs/cost.jsonl, so spend survives restarts.
// Claude reports dollars (its result's total_cost_usd is per process, so the caller passes the turn's share); other providers tokens.
import fs from 'node:fs';

const DAY = 864e5;
export function createLedger(file) {
  const add = (row) => fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), ...row }) + '\n');
  const rows = (since) => {
    let t = ''; try { t = fs.readFileSync(file, 'utf8'); } catch {}
    return t.split('\n').flatMap((l) => { try { const r = JSON.parse(l); return r.ts >= since ? [r] : []; } catch { return []; } });
  };
  // Per squiggle over the last `days` days, and today (from local midnight).
  const summary = (days = 1, now = Date.now()) => {
    const mid = new Date(now); mid.setHours(0, 0, 0, 0);
    const since = Math.min(mid.getTime(), now - days * DAY), out = {};
    for (const r of rows(since)) {
      const o = out[r.id] ||= { id: r.id, turns: 0, in: 0, out: 0, cost: 0, today: 0 };
      if (r.ts >= now - days * DAY) { o.turns++; o.in += r.in || 0; o.out += r.out || 0; o.cost += r.cost || 0; }
      if (r.ts >= mid.getTime()) o.today += r.cost || 0;
    }
    return Object.values(out).sort((a, b) => b.cost - a.cost || b.in + b.out - a.in - a.out);
  };
  return { add, rows, summary };
}
export const usd = (n) => `$${(n || 0).toFixed(2)}`;
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
export const describeCost = (r) => `${usd(r.cost)} in ${r.turns} turns, ${tok(r.in)} in / ${tok(r.out)} out tokens${r.today ? `; ${usd(r.today)} today` : ''}`;
