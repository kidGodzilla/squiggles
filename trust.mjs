// Trust: how far a squiggle may act on its own ideas. Low, Medium (the default, as before), High, Very high.
// Set by the user (Settings, the squiggle sheet) or the lead (`set <id> trust <level>`), never by the squiggle itself.
// The level's rules replace {{trust}} in prompts/squiggle.md; Low is also enforced (the server refuses its own `task add`).
export const TRUST = ['low', 'medium', 'high', 'veryhigh'];
export const TRUST_NAME = { low: 'Low', medium: 'Medium', high: 'High', veryhigh: 'Very high' };
export const trustOf = (s) => (TRUST.includes(s?.trust) ? s.trust : 'medium');
export function trustLevel(v) {
  const t = String(v ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (!t || t === 'default') return null;
  if (!TRUST.includes(t)) throw Object.assign(new Error(`trust: ${TRUST.join(', ')}`), { code: 400 });
  return t;
}
const FREE = 'Reading, measuring and drafting are always free.';
const RULES = {
  low: `Your trust is Low ({{user}} sets it). Propose, don't start: when you see work worth doing in your area, \`suggest\` it; never \`task add\` your own ideas (the server refuses); a note for something {{user}} or the lead asked is fine. Work only on what they gave you. ${FREE} Anything that writes outside your task (merge, deploy, send, publish, production change) waits for approval.`,
  medium: `Your trust is Medium ({{user}} sets it). Be proactive in your area: when your board is empty, find the one thing that would most help what you care about and file it inside your goal with \`task add\`, then do it on a later wake; outside your goals, \`suggest\` it. ${FREE} Anything that writes outside your task (merge, deploy, send, publish, production change) waits for approval.`,
  high: `Your trust is High ({{user}} sets it). Be proactive in your area: file the work you see inside your goal with \`task add\` and do it; outside your goals, \`suggest\` it. A small fix (one change, tested, verified) needs no approval to start: in a gated goal, ship it on its branch with \`task move <id> review\`; once its guardian signs it off with \`task ship\`, the lead merges it. Bigger or riskier changes, sends, publishes and production changes still wait for approval.`,
  veryhigh: `Your trust is Very high ({{user}} sets it). Be proactive in your area: file the work you see inside your goal with \`task add\` and do it; outside your goals, \`suggest\` it. In an open goal, commit, merge and deploy your own tested work without asking, and say what went live in your status line. In a gated goal, small fixes go to review and the lead merges them once their guardian ships them. Sends, publishes and anything irreversible still wait for approval.`,
};
export const trustRules = (s) => RULES[trustOf(s)];
// Update route guard: only these fields reach squiggle.json. lead, permissionMode, cwd, trust and model
// change only from the user or the lead; lead only from the user. `caller` is the squiggle whose process tree sent the
// request and `callerLead` its saved lead flag, never a flag in the body. No caller (the user's page or terminal, or a
// squiggle's double-forked child) needs `owner()`, the page's unlocked session, for those fields and for a charter.
// With no room passcode (`passcode` false) no session can exist: lead and lead-only fields are refused until one is set;
// a charter stays open. A non-lead squiggle changes only itself.
export const UPDATE_FIELDS = ['name', 'role', 'cwd', 'every', 'permissionMode', 'paused', 'look', 'lookSeed', 'maxTurns', 'chrome', 'effort', 'model', 'awake', 'autocompact', 'voice', 'trust', 'lead'];
const LEAD_ONLY = ['permissionMode', 'cwd', 'trust', 'model'];
export const PERMISSION_MODES = ['auto', 'acceptEdits', 'plan', 'bypassPermissions'];
const badMode = (b) => 'permissionMode' in b && !PERMISSION_MODES.includes(b.permissionMode) && { status: 400, error: `permissionMode: ${PERMISSION_MODES.join(', ')}` };
// Hiring: a new squiggle is all lead-only fields, so only the lead or the user's unlocked page creates one.
// With no room passcode any local program could claim the room, so nobody hires, the lead included, until one is set.
export function createRefusal(b, { caller = '', callerLead = false, owner = () => false, passcode = true, user = 'the user' } = {}) {
  const bad = badMode(b); if (bad) return bad;
  if (caller && !callerLead) return { status: 403, error: `${caller} can't hire: ${user} or the lead does` };
  if (!passcode) return { status: 403, error: `Set a room passcode first (Settings > Security): ${user} sets it before the first hire` };
  if (caller) return null;
  return owner() ? null : { status: 403, error: `Unlock with the room passcode first: hiring is ${user} or the lead`, unlock: true };
}
// Quitting leaves the room down until the user reopens it: the lead, or the user's unlocked page. With no passcode
// the lead is the only squiggle (hiring waits for one), so the page quits freely.
export function quitRefusal({ caller = '', callerLead = false, owner = () => false, passcode = true, user = 'the user' } = {}) {
  if (caller) return callerLead ? null : { status: 403, error: `${caller} can't quit the room: ${user} or the lead does` };
  return !passcode || owner() ? null : { status: 403, error: `Unlock with the room passcode first: quitting is ${user} or the lead`, unlock: true };
}
// Provider slots cap the whole room, so a squiggle can't lift its own: the lead or the unlocked page only.
export function slotsRefusal({ caller = '', callerLead = false, owner = () => false, passcode = true, user = 'the user' } = {}) {
  if (caller) return callerLead ? null : { status: 403, error: `${caller} can't change provider slots: ${user} or the lead does` };
  return !passcode || owner() ? null : { status: 403, error: `Unlock with the room passcode first: changing slots is ${user} or the lead`, unlock: true };
}
// Public share (Cloudflare tunnel): the user only, from an unlocked page or their terminal. No squiggle, the lead included.
export function shareRefusal({ caller = '', owner = () => false, user = 'the user' } = {}) {
  if (caller) return { status: 403, error: `${caller} can't share the room on the internet: ${user} does, in Settings > Sharing` };
  return owner() ? null : { status: 403, error: `Unlock with the room passcode first: sharing on the internet is ${user}'s`, unlock: true };
}
// Own charter (a guard against instructions planted in mail, web pages or files): a non-lead squiggle rewrites it only in
// a turn the user or the lead asked for. `askers` is who asked this turn (R(caller).asked): 'owner', 'lead' or the lead's id.
const CHARTER_ASKERS = (leadId) => ['owner', 'lead', leadId].filter(Boolean);
export function updateRefusal(meta, s, { caller = '', callerLead = false, charter = false, askers = [], leadId = '', owner = () => false, passcode = true, user = 'the user' } = {}) {
  const bad = Object.keys(meta).filter((k) => !UPDATE_FIELDS.includes(k));
  if (bad.length) return { status: 400, error: `can't update ${bad.join(', ')}` };
  if (badMode(meta)) return badMode(meta);
  if (caller && caller !== s.id && !callerLead) return { status: 403, error: `${caller} can't change ${s.id}: ${user} or the lead does` };
  const changed = (k) => k in meta && (k === 'trust' ? trustOf(meta) !== trustOf(s) : k === 'lead' ? !!meta.lead !== !!s.lead : meta[k] !== s[k]);
  if (!caller) {
    const what = changed('lead') ? 'lead' : LEAD_ONLY.find(changed) || (charter && 'charter');
    if (!what) return null;
    const by = what === 'lead' ? user : `${user} or the lead`;
    if (!passcode) return what === 'charter' ? null : { status: 403, error: `Set a room passcode first (Settings > Security): ${what} is set by ${by}` };
    return !owner() ? { status: 403, error: `Unlock with the room passcode first: ${what} is set by ${by}`, unlock: true } : null;
  }
  if (changed('lead')) return { status: 403, error: `lead is set by ${user}, not ${caller}` };
  if (charter && !callerLead && !askers.some((a) => CHARTER_ASKERS(leadId).includes(a)))
    return { status: 403, error: `${caller} changes its charter only when ${user} or the lead asks for it this turn` };
  const k = !callerLead && LEAD_ONLY.find(changed);
  return k ? { status: 403, error: `${k} is set by ${user} or the lead, not ${caller}` } : null;
}

// What a charter change looks like to the lead: lines gone (-) and added (+), capped.
export function charterDiff(before, after, max = 1500) {
  const a = String(before || '').trim().split('\n'), b = String(after || '').trim().split('\n');
  const out = [...a.filter((l) => !b.includes(l)).map((l) => `- ${l}`), ...b.filter((l) => !a.includes(l)).map((l) => `+ ${l}`)].join('\n');
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
// The same rule for a charter.md edited with file tools, checked at the end of the squiggle's turn against the copy
// taken when the turn started: 'keep' (unchanged, or the lead), 'report' (allowed: tell the lead) or 'revert'.
export function charterEdit({ before, after, askers = [], leadId = '', lead = false }) {
  if (before == null || String(before).trim() === String(after ?? '').trim() || lead) return 'keep';
  return askers.some((a) => CHARTER_ASKERS(leadId).includes(a)) ? 'report' : 'revert';
}

// Shared files: a squiggle deletes only what it added; the rest needs the user (an unlocked page once a passcode is set).
export function fileRmRefusal({ caller, uploader, owner, passcode, user }) {
  if (caller) return uploader === caller ? null : { status: 403, error: `${caller} can delete only files it added: ${user} deletes the rest` };
  return !passcode || owner() ? null : { status: 403, error: `Unlock with the room passcode first: deleting files is ${user}'s`, unlock: true };
}
// Who added a file: the calling squiggle, never a name it claims; from the page, a person in the room or the owner.
export const fileBy = (caller, by, people) => caller || (people.includes(by) ? by : 'owner');
