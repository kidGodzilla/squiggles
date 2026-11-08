// When a squiggle's next scheduled wake is due. Random offsets keep many installs from waking in step
// (after a shared limit reset or a reboot): each wake lands at every ± 10% (at least ± 1 min), and the
// first wakes after the server starts spread over a random 10-15 minute window.
export function createSchedule({ now = Date.now, rand = Math.random } = {}) {
  const boot = now(), window = (10 + 5 * rand()) * 60000;
  const first = new Map(), jit = new Map();
  return function dueAt(id, everyMin, lastWake) {
    if (!first.has(id)) first.set(id, boot + rand() * window);
    const period = everyMin * 60000, spread = Math.max(0.1 * period, 60000);
    let j = jit.get(id);
    if (!j || j.last !== lastWake) jit.set(id, j = { last: lastWake, ms: (rand() * 2 - 1) * spread });
    return Math.max(first.get(id), lastWake + period + j.ms);
  };
}

// Late wakes say so. A wake's text carries ⟨wake <due ms>⟩ until its turn really starts, which may be after a
// provider slot queue or a restart hold; then it becomes the start time, and when that is 15+ minutes past due, how late it is.
export const wakeToken = (due = 0) => `⟨wake ${Math.round(due) || 0}⟩`;
export function stampWake(text, t = Date.now()) {
  return String(text).replace(/⟨wake (\d+)⟩/, (_, d) => {
    const due = Number(d), late = due ? Math.round((t - due) / 60000) : 0;
    const at = new Date(t).toLocaleString();
    return late >= 15 ? `${at}, ${late} min late (due ${new Date(due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : at;
  });
}

// Wake times: a squiggle wakes at set times or works in daily windows instead of every N minutes.
// "9:00, 13:00, 17:00" wakes three times a day. "9:00-11:00" starts at 9:00 and, while each wake ends DONE, starts the
// next a minute after the last ends (the cache stays warm); any other end (IDLE, WAITING, BLOCKED, a quiet skip or a
// pre-check DEFER) closes the window until tomorrow. "weekdays " before an item limits it to Monday to Friday.
// Local time, 24-hour clock. Messages, waits and watches wake a squiggle as always.
const hm = (x) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(x); if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null; return +m[1] * 60 + +(m[2] || 0); };
export function parseWakes(spec) {
  const s = String(spec ?? '').trim().toLowerCase();
  if (!s || s === 'off') return null;
  return s.split(',').map((raw) => {
    let x = raw.trim(), weekdays = false;
    if (x.startsWith('weekdays ')) { weekdays = true; x = x.slice(9).trim(); }
    const [a, b, extra] = x.split('-').map((y) => y.trim());
    const from = hm(a), to = b == null ? null : hm(b);
    if (from == null || extra != null || (b != null && to == null)) throw new Error(`wakes: "${raw.trim()}" isn't a time like 9:00 or a window like 9:00-11:00`);
    if (to != null && to <= from) throw new Error(`wakes: "${raw.trim()}" ends before it starts (windows stay within one day)`);
    return { weekdays, from, to };
  });
}
const at = (day, min) => { const d = new Date(day); d.setHours(0, min, 0, 0); return d.getTime(); };
// The next wake for parsed items. last: the last wake or skip; lastEnd: when the last turn ended; endStatus: its status.
export function wakeDue(items, { last = 0, lastEnd = 0, endStatus = '' } = {}) {
  let best = Infinity;
  const day0 = new Date(last || Date.now()); day0.setHours(0, 0, 0, 0);
  for (const it of items) {
    for (let i = 0; i < 9; i++) {
      const day = new Date(day0); day.setDate(day.getDate() + i);
      if (it.weekdays && [0, 6].includes(day.getDay())) continue;
      const start = at(day, it.from);
      if (it.to == null) { if (start > last) { best = Math.min(best, start); break; } continue; }
      const end = at(day, it.to);
      if (end <= last) continue;
      if (start > last) { best = Math.min(best, start); break; }
      // The last wake was in this window: carry on only after a DONE.
      const next = Math.max(last, lastEnd) + 60000;
      if (endStatus === 'done' && next < end) { best = Math.min(best, next); break; }
    }
  }
  return best;
}
// How the page and `team` say it.
export const wakesText = (spec) => { try { return parseWakes(spec) ? `Wakes ${String(spec).trim()}` : ''; } catch { return ''; } };
