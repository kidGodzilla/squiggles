// When a squiggle's next scheduled wake is due. Random offsets keep many installs from waking in step
// (after a shared limit reset or a reboot): each wake lands at every ± 10% (at least ± 1 min), and the
// first wakes after the server starts spread over a random 10-15 minute window.
export function createSchedule({ now = Date.now, rand = Math.random } = {}) {
  const boot = now(), window = (10 + 5 * rand()) * 60000;
  const first = new Map(), jit = new Map();
  return function dueAt(id, everyMin, lastWake) {
    if (!first.has(id)) first.set(id, boot + rand() * window);
    const period = everyMin * 60000, spread = Math.max(0.1 * period, 60000);
    let j = jit.get(id);
    if (!j || j.last !== lastWake) jit.set(id, j = { last: lastWake, ms: (rand() * 2 - 1) * spread });
    return Math.max(first.get(id), lastWake + period + j.ms);
  };
}
