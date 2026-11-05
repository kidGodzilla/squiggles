// a pending watch runs by itself once approved, so its Approve card shows all of it: no cut command, folder, ignore, warnings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (f) => readFileSync(new URL('../ui/' + f, import.meta.url), 'utf8');

// asks.js and the Team card's watch rows, run for real against stubs for the page around them.
function card(w) {
  const board = read('board.js'), from = board.indexOf('const WATCH_STATE'), to = board.indexOf('// People:', from);
  const page = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : page), set: () => true, apply: () => page, construct: () => page });
  const ctx = vm.createContext({ document: page, window: page, $: page, setInterval: page, setTimeout: page, addEventListener: page, api: page, toast: page, S: { sq: {} }, B: { watches: { kit: [w] } }, when: () => 'noon',
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) });
  return vm.runInContext(`${read('asks.js')}\n${board.slice(from, to)}\nwatchRows('kit')`, ctx);
}
const pending = { id: 'w1', owner: 'kit', state: 'pending', every: 6e4, hash: 'h', cwd: '/tmp/some-folder', ignore: '^noise$', cmd: `${'echo padding; '.repeat(150)}rm -rf /tmp/THE-TAIL` };

test('a 2000-character command reaches the card whole, in the wrapping block', () => {
  assert.ok(pending.cmd.length > 2000);
  assert.ok(card(pending).includes(`<pre class="askcmd"><code>${pending.cmd}</code></pre>`));
});
test('the card shows the folder, the ignore pattern and the Approve button', () => {
  const h = card(pending);
  assert.ok(h.includes('/tmp/some-folder'));
  assert.ok(h.includes('^noise$'));
  assert.match(h, /data-a="wapprove"/);
});
test('a risky command is called out', () => {
  assert.match(card(pending), /class="askrisk">Careful: [^<]*delet/i);
});
test('hidden characters in the command, folder or ignore are drawn and counted', () => {
  const h = card({ ...pending, cmd: 'ls‮', cwd: '/tmp/a​', ignore: 'x⁦' });
  assert.match(h, /Contains 3 hidden or control characters/);
  assert.ok(h.includes('&lt;U+202E&gt;') && h.includes('&lt;U+200B&gt;') && h.includes('&lt;U+2066&gt;'));
});
test('an approved watch keeps its one-line row', () => {
  const h = card({ ...pending, state: 'on' });
  assert.doesNotMatch(h, /askcmd/);
  assert.doesNotMatch(h, /data-a="wapprove"/);
});
test('the Team card cuts only its own one-line command, never the pending block', () => {
  const css = read('room.css');
  assert.doesNotMatch(css, /\.tmwr code \{[^}]*nowrap/);
  assert.match(css, /\.tmwr > div > code \{[^}]*nowrap/);
});
