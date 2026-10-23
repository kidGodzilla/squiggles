// Restart holds: a pending restart holds new turns, but the user's chat waits at most CAP. Then held turns go out
// and nothing is held for OFF, so chat flows while the restart still lands at the next moment nobody is mid-turn.
export const CAP = 2 * 60e3, OFF = 10 * 60e3;
export function holdGate({ cap = CAP, off = OFF } = {}) {
  let since = null, offUntil = 0;
  return {
    holding: (t = Date.now()) => t >= offUntil,
    // A held message from the user: ms left before the hold must be released (timed from their first held message).
    held: (t = Date.now()) => { if (since === null) since = t; return Math.max(0, since + cap - t); },
    release: (t = Date.now()) => { since = null; offUntil = t + off; },
    reset: () => { since = null; offUntil = 0; },
  };
}
