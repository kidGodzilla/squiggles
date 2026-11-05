// Who a request is, from the process tree and the session, never the body.
// caller: the squiggle whose process tree it came from, '' for none. page: a person's page (pass.page).
// Neither: the owner's terminal or a detached process, which look alike, so neither may speak as the owner or the lead.
import fs from 'node:fs';
import { pathReason, privateCheck } from './fence.mjs';

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
// refusal and allow charter edits.
export const askerOf = (from, human, id) => (['harness', 'terminal', id].includes(from) ? '' : from === 'owner' ? human || 'owner' : from);

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
  const why = pathReason(file, cwd, home) || (caller && claude ? '' : privateCheck('read', { file_path: file }, cwd, home, dir));
  return why ? { status: 403, error: why } : null;
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
