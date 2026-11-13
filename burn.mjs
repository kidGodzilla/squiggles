// Burn mode: one room switch (burn: 'on'). While on, every unpaused Claude squiggle on a frequent cadence re-wakes as soon
// as its turn ends: no 2-minute provider stagger, no quiet skip, no pre-check. Turns at once still caps them. Off restores
// the normal schedule. CLI: burn on|off; page: Settings, Room.

export const BURN_TEXT = 'Burn mode is on: keep working nonstop. Take the most valuable open note that does not wait on a person and finish it. Board empty? Take stuck or unowned notes in your area, or file real work from your charter and start it. Use subagents for big pieces. No IDLE while useful work exists.';
// Squiggles on a slower cadence (a daily writer, a fixed-hours inbox) keep their schedule.
export const BURN_MAX_EVERY = 60;

export const burnOn = (cfg) => cfg?.burn === 'on';
// The provider is '' for Claude; other providers have their own quotas and keep the stagger.
export const burns = (cfg, s, provider) => burnOn(cfg) && !provider && !s.lead && !s.paused && s.every > 0 && s.every <= BURN_MAX_EVERY;
// Due once the last wake is at least gap old: a turn that dies at once can't spin the scheduler.
export const burnDue = (lastWake, gap) => (lastWake ? Date.parse(lastWake) || 0 : 0) + gap;
