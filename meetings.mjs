// Meetings the user schedules with squiggles (the Calendar). One JSON file; times are local wall-clock "YYYY-MM-DDTHH:MM".
import fs from 'node:fs';
import path from 'node:path';

export const REPEATS = ['once', 'daily', 'weekdays', 'weekly'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n).padStart(2, '0');
export const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dateOf = (s) => String(s).slice(0, 10);

// "2026-10-15 09:00", "2026-10-15T9:30", "today 15:00", "tomorrow 9am", "mon 9:00" (next Monday, today if still ahead).
export function parseWhen(text, now = new Date()) {
  const s = String(text || '').trim().toLowerCase();
  const t = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!t) throw new Error(`no time in "${text}": use e.g. "2026-10-15 09:00", "tomorrow 9:00" or "mon 14:30"`);
  let h = Number(t[1]); const m = Number(t[2] || 0);
  if (t[3] === 'pm' && h < 12) h += 12; if (t[3] === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) throw new Error(`bad time in "${text}"`);
  const day = s.slice(0, t.index).trim().replace(/[t,]$/, '').trim();
  const d = new Date(now); d.setHours(h, m, 0, 0);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (iso) d.setFullYear(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  else if (day === 'tomorrow') d.setDate(d.getDate() + 1);
  else if (day && day !== 'today') {
    const w = DAYS.indexOf(day.slice(0, 3)); if (w < 0) throw new Error(`unknown day "${day}"`);
    d.setDate(d.getDate() + ((w - d.getDay() + 7) % 7)); if (d <= now) d.setDate(d.getDate() + 7);
  }
  return local(d);
}

const checkAt = (at) => { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) || isNaN(new Date(at))) throw new Error(`at must be YYYY-MM-DDTHH:MM, got "${at}"`); return at; };

export function createMeetings(root, onChange, { isSquiggle = () => true } = {}) {
  const FILE = path.join(root, 'meetings.json');
  const all = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).meetings || []; } catch { return []; } };
  const save = (m) => { fs.writeFileSync(FILE, JSON.stringify({ meetings: m }, null, 2) + '\n'); onChange?.(); };
  const find = (m, id) => { const x = m.find((k) => k.id === id); if (!x) throw new Error(`no meeting ${id}`); return x; };
  const people = (list) => {
    const ids = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)).map((x) => x.trim()).filter(Boolean))];
    if (!ids.length) throw new Error('a meeting needs at least one attendee');
    const bad = ids.filter((id) => !isSquiggle(id)); if (bad.length) throw new Error(`no squiggle ${bad.join(', ')}`);
    return ids;
  };

  // Presenters: attendees who take the floor in this order (empty = no turns, everyone briefs at once).
  const order = (list, attendees) => {
    const ids = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)).map((x) => x.trim()).filter(Boolean))];
    const bad = ids.filter((id) => !attendees.includes(id)); if (bad.length) throw new Error(`presenters must be attendees: ${bad.join(', ')}`);
    return ids;
  };

  // Every start of meeting m in [from, to), skipping cancelled dates.
  function starts(m, from, to) {
    const out = [], first = new Date(m.at), step = { daily: 1, weekdays: 1, weekly: 7 }[m.repeat];
    if (!step) return first >= from && first < to && !(m.skip || []).includes(dateOf(m.at)) ? [first] : [];
    const d = new Date(first);
    if (d < from) { const jump = Math.floor((from - d) / (step * 864e5)); d.setDate(d.getDate() + jump * step); }
    for (; d < to; d.setDate(d.getDate() + step)) {
      if (d < from || d < first) continue;
      if (m.repeat === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6)) continue;
      if (!(m.skip || []).includes(dateOf(local(d)))) out.push(new Date(d));
    }
    return out;
  }
  // Occurrences between from and to, soonest first.
  function upcoming(from = new Date(), to = new Date(Date.now() + 7 * 864e5)) {
    return all().flatMap((m) => starts(m, from, to).map((s) => ({ id: m.id, title: m.title, agenda: m.agenda || '', attendees: m.attendees, presenters: m.presenters || [], repeat: m.repeat,
      start: local(s), end: local(new Date(s.getTime() + (m.minutes || 30) * 60000)), minutes: m.minutes || 30 })))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  function op({ op, id, title, agenda, attendees, presenters, at, when, minutes, repeat, date, by }) {
    const m = all();
    if (op === 'add') {
      if (!String(title || '').trim()) throw new Error('a meeting needs a title');
      const r = repeat || 'once'; if (!REPEATS.includes(r)) throw new Error(`repeat must be one of ${REPEATS.join(', ')}`);
      const n = m.reduce((x, k) => Math.max(x, parseInt(String(k.id).slice(1), 10) || 0), 0) + 1;
      const who = people(attendees), pres = order(presenters, who);
      const mt = { id: 'm' + n, title: String(title).trim(), attendees: who, at: at ? checkAt(at) : parseWhen(when), minutes: Number(minutes) || 30, repeat: r,
        ...(pres.length ? { presenters: pres } : {}), ...(agenda ? { agenda: String(agenda).trim() } : {}), ...(by ? { by } : {}), created: local(new Date()) };
      m.push(mt); save(m); return mt;
    }
    const mt = find(m, id);
    if (op === 'cancel') {
      // A date cancels one occurrence of a series; without one the meeting is gone.
      if (date && mt.repeat !== 'once') { mt.skip = [...new Set([...(mt.skip || []), dateOf(parseWhen(`${date} 0:00`))])]; save(m); return mt; }
      m.splice(m.indexOf(mt), 1); save(m); return { ...mt, cancelled: true };
    }
    if (op === 'edit') {
      if (title !== undefined) mt.title = String(title).trim() || mt.title;
      if (agenda !== undefined) { if (agenda) mt.agenda = String(agenda).trim(); else delete mt.agenda; }
      if (attendees !== undefined) { mt.attendees = people(attendees); if (mt.presenters) mt.presenters = mt.presenters.filter((x) => mt.attendees.includes(x)); }
      if (presenters !== undefined) { const pres = order(presenters, mt.attendees); if (pres.length) mt.presenters = pres; else delete mt.presenters; }
      if (mt.presenters && !mt.presenters.length) delete mt.presenters;
      if (at || when) mt.at = at ? checkAt(at) : parseWhen(when);
      if (minutes !== undefined) mt.minutes = Number(minutes) || 30;
      if (repeat !== undefined) { if (!REPEATS.includes(repeat)) throw new Error(`repeat must be one of ${REPEATS.join(', ')}`); mt.repeat = repeat; }
      save(m); return mt;
    }
    throw new Error(`unknown meeting op ${op}`);
  }

  return { all, upcoming, op };
}

// Notes for a meeting that just ended, from the attendees' event logs: what the user said to each and what they said back.
// cur: the meeting; logs: {id: [events]}; names: {id: name}. Returns the runs/meetings.log block and a journal entry per attendee.
export function meetingNotes(cur, logs, names, endTs = Date.now(), user = 'the user') {
  const User = user[0].toUpperCase() + user.slice(1);
  const from = cur.at || new Date(cur.start).getTime(), hm = (ts) => local(new Date(ts)).slice(11);
  const clip = (s) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > 400 ? s.slice(0, 399) + '…' : s; };
  const said = {}, all = [];
  for (const id of cur.attendees) {
    said[id] = (logs[id] || []).filter((e) => e.ts >= from && e.ts <= endTs && ((e.k === 'user' && e.from === 'owner') || e.k === 'say'))
      .map((e) => ({ ts: e.ts, id, owner: e.k === 'user', text: clip(e.text) }));
    all.push(...said[id]);
  }
  all.sort((a, b) => a.ts - b.ts);
  const who = cur.attendees.map((id) => names[id] || id).join(', '), when = `${cur.start.slice(0, 10)} ${cur.start.slice(11)} to ${hm(endTs)}`;
  const head = `${cur.title}, ${when}, with ${user} and ${who}`;
  const log = `== ${head}\n${cur.agenda ? `Agenda: ${cur.agenda.replace(/\n/g, '; ')}\n` : ''}`
    + (all.map((x) => `${hm(x.ts)} ${x.owner ? `${User} to ${names[x.id] || x.id}` : names[x.id] || x.id}: ${x.text}`).join('\n') || '(nothing said)') + '\n\n';
  const journal = {};
  for (const id of cur.attendees) {
    const asked = said[id].filter((x) => x.owner).map((x) => `- ${User}: ${x.text}`);
    journal[id] = `\n## ${cur.start.slice(0, 10)} Meeting: ${cur.title}\n- ${when}, with ${user} and ${who}.${cur.agenda ? ` Agenda: ${cur.agenda.replace(/\n/g, '; ')}.` : ''}\n`
      + (asked.length ? asked.join('\n') + '\n' : `- ${User} said nothing to me directly.\n`) + `- Full notes: runs/meetings.log\n`;
  }
  return { log, journal };
}

// Past occurrences (t231): held = 'done' or never started = 'missed', with the meeting's block from runs/meetings.log when there is one.
// started: keys `${id}@${start}` of meetings that began; log: the meetings.log text.
export function markPast(occ, started, log, now = new Date()) {
  return occ.map((o) => {
    if (new Date(o.end) > now) return o;
    const at = log.indexOf(`== ${o.title}, ${o.start.slice(0, 10)} ${o.start.slice(11)} to`), next = log.indexOf('\n== ', at + 1);
    return { ...o, past: started.has(`${o.id}@${o.start}`) ? 'done' : 'missed', ...(at >= 0 ? { notes: log.slice(at, next < 0 ? undefined : next).trim() } : {}) };
  });
}
