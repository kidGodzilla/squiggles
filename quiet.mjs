// Quiet wakes: a scheduled wake costs a full context read even when it finds nothing. When the last turn ended IDLE
// (or WAITING on a wait the harness checks) and nothing the squiggle would act on has changed since, the wake is skipped.
// A real wake still runs every QUIET_MAX_MS.
import crypto from 'node:crypto';

export const QUIET_MAX_MS = 6 * 3600e3;
// Squiggles whose wakes check outside things (an inbox, logs, servers) set alwaysWake true; the lead or the user sets it.
export const alwaysWakes = (s) => !!s.alwaysWake;
// What a wake could act on: its notes (any change of status, note, title, steps), suggestion answers not yet told, its charter.
export function quietSig(id, tasks, charter = '') {
  const mine = tasks.filter((t) => (t.owner === id && t.status !== 'done' && t.status !== 'dropped') || (t.kind === 'suggestion' && t.by === id && t.untold))
    .map((t) => [t.id, t.status, t.title, t.note || '', JSON.stringify(t.needs || []), JSON.stringify(t.after || []), t.untold ? 1 : 0, t.decision || ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return crypto.createHash('sha1').update(JSON.stringify([mine, charter])).digest('hex');
}
// A turn that ended on its own status line: Claude's normal result is subtype 'success'.
export const ownEnd = (isError, subtype, limited) => !isError && (!subtype || subtype === 'success') && !limited;
// Skip this scheduled wake? `r` is the squiggle's runtime state: endStatus and quietSig as the last turn left them, lastWake.
export function skipWake(r, sig, now = Date.now()) {
  if (r.endStatus !== 'idle' && r.endStatus !== 'waiting') return false;
  if (!r.quietSig || r.quietSig !== sig) return false;
  const real = Date.parse(r.lastWake || 0) || 0;
  return now - real < QUIET_MAX_MS;
}
