// Who a request is, from the process tree and the session, never the body.
// caller: the squiggle whose process tree it came from, '' for none. page: a person's page (pass.page).
// Neither: the owner's terminal or a detached process, which look alike, so neither may speak as the owner or the lead.
import fs from 'node:fs';
import { pathReason, peerReason, privateCheck } from './fence.mjs';

const UNLOCK = { status: 403, error: 'Unlock with the room passcode first', unlock: true };
// No code to type, so a terminal isn't asked for one.
const NOCODE = { status: 403, error: 'Use the page, or set a room passcode so your terminal can unlock this' };
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

export function sender({ caller = '', page = false, human, people = [] } = {}) {
  if (caller) return { from: caller };
  if (!page) return { from: 'terminal' };
  return people.some((h) => h.id === human) ? { from: 'owner', human } : { from: 'owner' };
}

// Who asked for this turn. A squiggle can't ask itself and an unknown caller can't ask at all: askers lift the Low trust
// refusal and allow charter edits. A relayed @mention names its own asker.
export const askerOf = (from, human, id) => (['harness', 'terminal', 'mention', id].includes(from) ? '' : from === 'owner' ? human || 'owner' : from);

// --asked is a claim in the request body. On a Low trust squiggle it counts only for an ask the server saw: this turn, or in the last week.
const ASK_TTL = 7 * 864e5;
export function askSeen({ claim, turn = [], seen = {}, leadId = '', peers = [], now = Date.now() }) {
  const who = String(claim).trim().toLowerCase(), id = who === 'lead' ? leadId : who;
  if (id !== leadId && peers.includes(id)) return false; // a person's ask or the lead's: a peer's doesn't count
  return turn.includes(id) || now - (seen[id] || 0) < ASK_TTL;
}

// The writes that make or relabel a note. A Low trust turn gets none of them, bar splitting a note marked for it (add is askSeen's).
// A detached child looks like the owner's terminal, so while any squiggle is Low, those two need the code. With none, a terminal needs nothing.
export const writesNote = (b) => ['add', 'split', 'accept'].includes(b.op) || (b.op === 'edit' && ['title', 'asked', 'split'].some((k) => b[k] !== undefined));
export function noteRefusal({ b, caller = '', low = false, lowInRoom = false, page = false, marked = false, passcode = true }) {
  if (!writesNote(b)) return null;
  if (!caller) return page || !lowInRoom ? null : passcode ? UNLOCK : NOCODE;
  if (!low || b.op === 'add' || (b.op === 'split' && marked)) return null;
  return { status: 403, error: 'Low trust: suggest it instead, the owner or the lead files it' };
}

// The owner's or the lead's to do: not a plain squiggle, a terminal or a detached process.
function controlRefusal({ what, caller = '', lead = false, page = false, passcode = true }) {
  if (caller && !lead) return { status: 403, error: `Only the owner and the lead ${what}` };
  return caller || page ? null : passcode ? UNLOCK : NOCODE;
}

// Peering opens a line to another room.
export const peersRefusal = (who) => controlRefusal({ ...who, what: 'change peers' });

// A squiggle may stop or clear itself. Stopping, clearing or removing another, or removing itself, is the owner's or the lead's.
export function squiggleRefusal({ id, action, ...who }) {
  if (who.caller === id && action !== 'remove') return null;
  return controlRefusal({ ...who, what: `${action} another squiggle` });
}

// The label a squiggle reads. People and the lead keep theirs; anyone else is named first, so a message can't open "From <a person>:".
export function labelled(text, { from, who, leadId, name }) {
  if (who) return `From ${who}: ${text}`;
  return !name || from === leadId ? text : `Sent by ${name}, not a person: ${text}`;
}

// file is resolved. Everyone gets the fence: the page never pins a file and a shared session has no reason to read the fenced folders.
// The private-data fence binds non-Claude squiggles, so only a Claude squiggle passes it, as with its own Read tool.
export function screenRefusal({ id, kind, file, caller = '', lead = false, claude = false, config = '' }, { cwd, home, dir } = {}) {
  if (caller && !lead && caller !== id) return { status: 403, error: `${caller} can only use its own screen` };
  if (kind !== 'file') return null;
  if (config && real(file) === real(config)) return { status: 403, error: 'room.json stays off the screen' };
  const why = pathReason(file, cwd, home) || (caller && !lead ? peerReason('read', { path: file }, { self: caller, cwd, home, root: dir }) : '') || (caller && claude ? '' : privateCheck('read', { file_path: file }, cwd, home, dir));
  return why ? { status: 403, error: why } : null;
}

// A squiggle marked private: its transcript and journal are closed to its peers. Itself, the lead, pages and the terminal read them.
export function peerRefusal({ owner, closed = false, caller = '', lead = false }) {
  return closed && caller && caller !== owner && !lead ? { status: 403, error: `${owner}'s transcript and journal are closed to other squiggles: ask the lead` } : null;
}

export function humansRefusal({ id, caller = '', lead = false, page = false, passcode = true }) {
  if (caller && !lead) return { status: 403, error: 'Only the owner and the lead edit the people in the room' };
  if (caller && id === 'owner') return { status: 403, error: 'Only the owner edits the owner' };
  return caller || page ? null : passcode ? UNLOCK : NOCODE;
}

// Reload stays open: it asks first on a page in use, and any squiggle building the UI needs it.
export function roomRefusal({ action, caller = '', lead = false, page = false, passcode = true }) {
  if (action === 'reload') return null;
  if (caller && !lead) return { status: 403, error: 'Only the owner and the lead change the room' };
  return caller || page ? null : passcode ? UNLOCK : NOCODE;
}
