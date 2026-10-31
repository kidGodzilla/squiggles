// Focus: while the user is talking with the lead, team reports wait and go as one batch once they're quiet.
// Serious alerts don't pass through here: they wake their owner directly.
export const QUIET_MS = 15 * 60e3;
// Milliseconds until reports may go to the lead; 0 means now.
export const reportHoldMs = (userAt, now = Date.now()) => Math.max(0, (userAt || 0) + QUIET_MS - now);
