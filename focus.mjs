// Focus: while the user is talking with the lead, team reports wait and go as one batch once they're quiet.
// Away: once they haven't messaged the lead for 30 minutes, reports go at most once an hour, one batch.
// Serious alerts don't pass through here: they wake their owner directly.
export const QUIET_MS = 15 * 60e3, AWAY_MS = 30 * 60e3, AWAY_EVERY_MS = 60 * 60e3;
export const away = (userAt, now = Date.now()) => now - (userAt || 0) >= AWAY_MS;
// Milliseconds until reports may go to the lead; 0 means now. sentAt: when the last batch went.
export const reportHoldMs = (userAt, now = Date.now(), sentAt = 0) => {
  const talk = (userAt || 0) + QUIET_MS - now; if (talk > 0) return talk;
  return away(userAt, now) ? Math.max(0, (sentAt || 0) + AWAY_EVERY_MS - now) : 0;
};
// A held 'Team reports' turn replayed after a restart goes back into the inbox, so it waits like any other batch.
export const REPORTS_HEAD = 'Team reports:\n';
const tail = (user) => `\n\nHandle what you can. Tell ${user} only what needs them, in one short message.`;
const awayTail = (user) => `\n\n${user[0].toUpperCase()}${user.slice(1)} is away and reads one digest when they're back. Handle what you can. Reply only "Handled." unless something needs them; then one short message.`;
export const reportsText = (lines, user = 'the user', isAway = false) => `${REPORTS_HEAD}${lines.join('\n')}${(isAway ? awayTail : tail)(user)}`;
export const reportLines = (text, user = 'the user') => {
  const s = String(text), t = [tail(user), awayTail(user)].find((x) => s.endsWith(x));
  return s.startsWith(REPORTS_HEAD) && t ? [s.slice(REPORTS_HEAD.length, -t.length)] : null;
};
