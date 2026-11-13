// Stuck work: everything that stopped moving, oldest first. Notes parked with no movement, steps around a merge that sit,
// parents whose parts all ended, notes whose owner isn't running. Served at /api/stuck; the CLI prints it with `stuck`, the
// Tasks tab shows it, and the lead's wakes carry the top of it. Goals on hold stay out: on hold means silent.
// Age counts from the last status change (task.since), so a re-noted blocked task still ages; `confirmed` for older notes.
export const LIMIT = { blocked: 2, waiting: 2, doing: 3, review: 3, asked: 7, step: 2 };
const DAY = 864e5;
const days = (d, now) => { const t = typeof d === 'number' ? d : Date.parse(d); return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : 0; };
const first = (s) => String(s || '').split('\n')[0];

// byPerson(asked): true when a person (the owner, or someone they added) asked for the note, not a squiggle.
export function stuckList({ tasks = [], holds = [], paused = [], byPerson = (a) => a === 'owner', now = Date.now() } = {}) {
  const hold = new Set(holds), off = new Set(paused), out = [], kids = new Map(), byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) if (t.parent) kids.set(t.parent, [...(kids.get(t.parent) || []), t]);
  const add = (kind, t, age, text) => out.push({ kind, id: t.id, owner: t.owner || '', goal: t.goal || '', age, text });
  for (const t of tasks) {
    if (t.kind === 'suggestion' || hold.has(t.goal)) continue;
    const age = days(t.since || t.confirmed || t.created, now), open = t.status !== 'done';
    const steps = (list, from) => (t[list] || []).forEach((s, i) => { if (!s.done) { const a = days(from, now); if (a >= LIMIT.step) out.push({ kind: list, id: t.id, n: i + 1, owner: s.who || t.owner || '', goal: t.goal || '', age: a, text: first(s.t) }); } });
    steps('after', t.finished || t.confirmed); // an open after-step on a merged note outlives the note
    if (t.status === 'review') steps('needs', t.reviewed || t.confirmed);
    if (!open) continue;
    if (t.owner && off.has(t.owner) && t.status !== 'todo') { add('owner', t, age, `${t.owner} is paused: ${first(t.title)}`); continue; }
    const parts = kids.get(t.id);
    if (parts?.length && parts.every((k) => k.status === 'done')) { add('parts', t, age, `all ${parts.length} parts finished: ${first(t.title)}`); continue; }
    // A note says what it waits on by naming tasks. All of them finished means the reason is gone, whatever its age.
    const named = t.status === 'blocked' || t.status === 'waiting' ? [...new Set(String(t.note || '').match(/\bt\d+\b/g) || [])].filter((id) => id !== t.id).map((id) => byId.get(id)) : [];
    if (named.length && named.every((x) => x?.status === 'done')) { add('cleared', t, age, `everything its note names finished: ${first(t.title)}`); continue; }
    if (t.status === 'todo' ? t.asked && byPerson(t.asked) && age >= LIMIT.asked : age >= (LIMIT[t.status] ?? Infinity))
      add(t.status === 'todo' ? 'asked' : t.status, t, age, first(t.title));
  }
  return out.sort((a, b) => b.age - a.age || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

export const STUCK_WORD = { blocked: 'Blocked', waiting: 'Waiting', doing: 'Doing', review: 'In review', asked: 'Asked for', after: 'After merge', needs: 'Before merge', parts: 'Parts done', cleared: 'Reason gone', owner: 'Owner paused' };
export const stuckWord = (k) => STUCK_WORD[k] || k;
const ageOf = (n) => (n === 1 ? '1 day' : `${n} days`);
export const stuckLine = (x) => `${ageOf(x.age)}  ${stuckWord(x.kind)}  ${x.id}${x.n ? ` step ${x.n}` : ''}${x.owner ? `  @${x.owner}` : ''}  ${String(x.text).slice(0, 140)}`;
export const describeStuck = (l) => (l.length ? l.map(stuckLine).join('\n') : 'nothing is stuck');
// What the lead reads on each wake: the count and the oldest few. `stuck` has the rest.
export const stuckBrief = (l, top = 8) => (l.length ? `Stuck work: ${l.length} (oldest first; \`stuck\` lists all). Move each one or say why it waits:\n${l.slice(0, top).map((x) => `- ${stuckLine(x)}`).join('\n')}` : '');
