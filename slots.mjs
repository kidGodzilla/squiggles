// Provider slots: at most N turns run at once on a provider, room.json `slots` ({ claude: 6, codex: 2, pi: 2 }).
// No entry means DEFAULT_SLOTS; 0 means no cap.
// A turn that would start on a full provider waits in line and starts when one ends,
// so a capped provider works through its backlog in turn instead of all at once. The lead and you never wait.
export const KEYS = ['claude', 'codex', 'pi', 'cursor'];
export const slotKey = (provider) => provider || 'claude';
// Who goes first when a slot frees: you, then the lead, then a squiggle, then the harness (scheduled wakes, reports).
export const rankOf = (from, leadId) => (from === 'owner' ? 0 : from === leadId ? 1 : from === 'harness' ? 3 : 2);
// Defaults sit well above what a busy room runs at once, so nothing queues until you lower them.
export const DEFAULT_SLOTS = { claude: 24, codex: 4, pi: 4, cursor: 4 };
export const limitOf = (cfg, key) => {
  const set = cfg?.slots && Object.hasOwn(cfg.slots, key), n = set ? cfg.slots[key] : DEFAULT_SLOTS[key];
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// One waiting turn per squiggle: a second message joins the first, keeps the better rank and the earlier place.
export function enqueue(line, e) {
  const had = line.find((x) => x.id === e.id);
  if (!had) { line.push(e); return e; }
  had.text += `\n\n${e.text}`; had.images = [...(had.images || []), ...(e.images || [])];
  if (e.rank < had.rank) Object.assign(had, { rank: e.rank, from: e.from, human: e.human, asker: e.asker });
  return had;
}
// Next turn to start on `key`: best rank, then the longest wait. Removed from the line.
export function next(line, key) {
  let best = -1;
  line.forEach((x, i) => { if (x.key === key && (best < 0 || x.rank < line[best].rank || (x.rank === line[best].rank && x.at < line[best].at))) best = i; });
  return best < 0 ? null : line.splice(best, 1)[0];
}
export function checkSlots(b) {
  const out = {};
  for (const [k, v] of Object.entries(b || {})) {
    if (!KEYS.includes(k)) throw new Error(`slots: provider is one of ${KEYS.join(', ')}`);
    if (v === '' || v === 'default' || v == null) { out[k] = null; continue; } // back to DEFAULT_SLOTS
    const n = v === 'off' ? 0 : Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error('slots: a whole number of turns at once, 0 or off for no cap, default for the default');
    out[k] = n;
  }
  return out;
}
// Start waiting turns while their provider has room. keyOf re-reads the squiggle (its model may have changed while it waited);
// gone drops an entry (squiggle removed, or a scheduled wake for one paused since). start must mark the turn busy before it returns.
export function drain(line, { limit, busy, start, keyOf = (e) => e.key, gone = () => false }) {
  const started = [];
  for (let i = line.length - 1; i >= 0; i--) { if (gone(line[i])) line.splice(i, 1); else line[i].key = keyOf(line[i]) || line[i].key; }
  for (const key of new Set(line.map((x) => x.key))) {
    for (let e; (!limit(key) || busy(key) < limit(key)) && (e = next(line, key));) { started.push(e); start(e); }
  }
  return started;
}
// Stopping a squiggle takes it out of line too.
export const leave = (line, id) => { const n = line.length; for (let i = n - 1; i >= 0; i--) if (line[i].id === id) line.splice(i, 1); return n - line.length; };
