// a failed read during a refresh left the lead tab blank: no office, a chat box of no size, no live updates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
const body = /^async function load\(\) \{[\s\S]*?^\}$/m.exec(src)[0];

// The real load() against a stub page; answers(path, nth call of that path) stands in for the server.
const room = (answers) => {
  const S = { sq: {}, order: [] }, seen = {}, toasts = [], applied = [];
  const api = async (path) => {
    const p = path.split('?')[0]; seen[p] = (seen[p] || 0) + 1;
    return answers(p, seen[p]);
  };
  const stubs = {
    S, B: { view: 'lead' }, api, toast: (m) => toasts.push(m), apply: (id, ev) => applied.push([id, ev]),
    showLimit() {}, rxPower() {}, roomGen() {}, renderStage() {}, paintTile() {}, renderJoinCast() {},
    document: { querySelectorAll: () => [] }, window: {}, setTimeout: (f) => queueMicrotask(f),
  };
  const load = new Function(...Object.keys(stubs), `${body}; return load;`)(...Object.values(stubs));
  return { load, S, seen, toasts, applied };
};
const team = [{ id: 'boss', name: 'Boss', lead: true }, { id: 'ann', name: 'Ann' }];
const server = (over) => async (p, n) => {
  const r = over(p, n); if (r !== undefined) { if (r instanceof Error) throw r; return r; }
  if (p === '/squiggles') return team.map((s) => ({ ...s }));
  if (p.endsWith('/events')) return [{ type: 'said' }];
  return {};
};

test('a failed list read: load waits for the list, so the lead is known when it resolves', async () => {
  const r = room(server((p, n) => (p === '/squiggles' && n <= 2 ? new Error('connection refused') : undefined)));
  await r.load();
  assert.equal(r.seen['/squiggles'], 3);
  assert.deepEqual(r.S.order, ['boss', 'ann']);
  assert.equal(r.toasts.length, 1, 'one word about it, not one per retry');
});
test('an error body in place of the list counts as a failed read', async () => {
  const r = room(server((p, n) => (p === '/squiggles' && n === 1 ? { error: 'busy' } : undefined)));
  await r.load();
  assert.deepEqual(r.S.order, ['boss', 'ann']);
});
test('one history failing once is retried and the room loads whole', async () => {
  const r = room(server((p, n) => (p === '/squiggles/ann/events' && n === 1 ? { error: 'read failed' } : undefined)));
  await r.load();
  assert.deepEqual(r.applied.map(([id]) => id).sort(), ['ann', 'boss']);
  assert.deepEqual(r.toasts, []);
});
test('one history that keeps failing costs that history and says so', async () => {
  const r = room(server((p) => (p === '/squiggles/ann/events' ? new Error('connection refused') : undefined)));
  await r.load();
  assert.equal(r.seen['/squiggles/ann/events'], 3);
  assert.deepEqual(r.applied.map(([id]) => id), ['boss']);
  assert.match(r.toasts.join(), /Ann/);
});
test('live updates start even if load throws', () => {
  assert.match(src, /GATE\.then\(\(\) => load\(\)\)\.catch\([^\n]*\)\.then\(\(\) => \{ listen\(\);/);
});
