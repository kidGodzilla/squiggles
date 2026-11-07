// Pending watches on Review: every part of the card, Approve bound to the hash shown, and the fold off the room's computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// asks.js and review.js, run for real against stubs for the page around them.
function page({ can, watches = [], asks = [] }) {
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub), set: () => true, apply: () => stub, construct: () => stub });
  const calls = [], box = { dataset: {}, innerHTML: '', querySelector: () => null };
  const ctx = vm.createContext({ document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => stub, hidden: false }, window: {}, $: (s) => (s === '#rv' ? box : stub), setInterval() {}, setTimeout() {}, addEventListener() {}, navigator: stub, localStorage: stub,
    api: async (p, b) => { if (b) calls.push(b); return p === '/needs' ? [] : {}; }, askCode: async () => true, unlocked: async (go, title) => { calls.push(title); return go(); }, toast() {}, setView() {}, oneOnOne() {},
    S: { sq: { logs: { name: 'Logs' }, boss: { lead: true } } }, console,
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) });
  vm.runInContext(`const PICK = { list: [] }, pickCard = () => '';\n${read('ui/asks.js')}\n${read('ui/review.js')}\nglobalThis.t = { ASK, RV, paintReview, rvWaiting, watchAct };`, ctx);
  Object.assign(ctx.t.ASK, { can, list: asks }); ctx.t.RV.watches = watches; ctx.t.paintReview();
  return { html: box.innerHTML, calls, t: ctx.t };
}
const here = { run: true }, away = { run: false, local: false };
const w = { kind: 'watch', id: 'wt1', by: 'logs', cmd: 'ls /tmp', cwd: '/tmp/some-folder', every: 6e5, timeout: 12e4, ignore: '^noise$', added: true, why: 'count files', hash: 'h1', task: 't7' };
const ask = { id: 'a1', by: 'logs', cmd: 'pwd', cwd: '/tmp', created: 1 };

test('the card shows the command, folder, ignore, schedule and reason, with Approve and Drop', () => {
  const { html } = page({ can: here, watches: [w] });
  assert.match(html, /1 watch to approve/);
  for (const s of ['ls /tmp', '/tmp/some-folder', '^noise$', 'every 10 min, up to 2 min a run', 'wakes on new lines only', 'count files', 't7', 'data-one="logs"']) assert.ok(html.includes(s), s);
  assert.match(html, /data-wa="approve"/);
  assert.match(html, /data-wa="drop"/);
});
test('a risky command is called out, and a non-Claude owner named', () => {
  const { html } = page({ can: here, watches: [{ ...w, cmd: 'rm -rf /tmp/x', runsFor: 'codex' }] });
  assert.match(html, /class="askrisk">Careful/);
  assert.match(html, /Runs for codex: output reaches a non-Claude model/);
});
test('a browser that can unlock gets Approve though Run is off', () => {
  assert.match(page({ can: { run: false, local: true }, watches: [w] }).html, /data-wa="approve"/);
});
test('Approve sends the hash the card showed, through the unlock prompt', async () => {
  const { t, calls } = page({ can: here, watches: [w] });
  t.RV.watches = [w];
  await t.watchAct({ dataset: { w: 'wt1', wa: 'approve' } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['Unlock to approve', { op: 'approve', id: 'wt1', hash: 'h1' }]);
});
test('Drop goes through the unlock prompt too: the route wants a session', async () => {
  const { t, calls } = page({ can: here, watches: [w] });
  await t.watchAct({ dataset: { w: 'wt1', wa: 'drop' } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['Unlock to drop', { op: 'drop', id: 'wt1' }]);
});
test('watches count in a chat line: the lead sees all, a 1:1 its own', () => {
  const { t } = page({ can: here, watches: [w] });
  assert.equal(t.rvWaiting('logs').watches, 1);
  assert.equal(t.rvWaiting('boss').watches, 1);
  assert.equal(t.rvWaiting('other').watches, 0);
});
test("off the room's computer, commands and watches fold to one closed line with no Approve", () => {
  const { html } = page({ can: away, watches: [w], asks: [ask] });
  assert.match(html, /<details class="rvs rvhost"><summary>1 command, 1 watch for the computer running the room<\/summary>/);
  assert.doesNotMatch(html, /data-wa="approve"/);
  assert.match(html, /Approve works only on the computer running the room/);
});
test('nothing folds until the server has answered, or when nothing waits', () => {
  assert.doesNotMatch(page({ can: { run: false }, watches: [w] }).html, /rvhost/);
  assert.doesNotMatch(page({ can: away }).html, /rvhost/);
});
test('the server hands watches to the list, and a live update reloads it', () => {
  assert.match(read('server.mjs'), /'\/api\/needs'.*watches: watches\.list\(\{\}\)/);
  assert.match(read('ui/room.js'), /case 'watches': loadWatches\(\); loadBlocked\(\);/);
});
test("the Team card drops Approve off the room's computer", () => {
  assert.match(read('ui/board.js'), /w\.state === 'pending' && !offHost\(\) \? `<button data-a="wapprove"/);
});
test('Review scrolls as one, so a tall card leaves the branches reachable', () => {
  const css = read('ui/room.css');
  assert.match(css, /#mergeView \{ overflow: auto \}/);
  assert.match(css, /#mergeView \.mq \{ flex: none; min-height: auto; overflow: visible \}/);
  assert.match(css, /\.rv \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/, 'a long path must not widen the card past a phone');
});
