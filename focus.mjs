// Focus: while the user is talking with the lead, team reports wait and go as one batch once they're quiet.
// Serious alerts don't pass through here: they wake their owner directly.
export const QUIET_MS = 15 * 60e3;
// Milliseconds until reports may go to the lead; 0 means now.
export const reportHoldMs = (userAt, now = Date.now()) => Math.max(0, (userAt || 0) + QUIET_MS - now);
// A held 'Team reports' turn replayed after a restart goes back into the inbox, so it waits like any other batch.
export const REPORTS_HEAD = 'Team reports:\n';
const tail = (user) => `\n\nHandle what you can. Tell ${user} only what needs them, in one short message.`;
export const reportsText = (lines, user = 'the user') => `${REPORTS_HEAD}${lines.join('\n')}${tail(user)}`;
export const reportLines = (text, user = 'the user') => { const s = String(text), t = tail(user); return s.startsWith(REPORTS_HEAD) && s.endsWith(t) ? [s.slice(REPORTS_HEAD.length, -t.length)] : null; };
