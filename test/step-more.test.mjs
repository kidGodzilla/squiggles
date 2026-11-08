// A step is one line in Review; More opens a modal with the full steps as markdown and, inside it only,
// a button that wakes the task's owner and opens its 1:1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBoard } from '../board.mjs';

test('full steps are stored on a step, cleared with empty text, and refused on a missing step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'more-'));
  try {
    const b = createBoard(dir, () => {}), t = b.taskOp({ op: 'add', title: 'x' });
    b.taskOp({ op: 'after', id: t.id, act: 'add', text: 'Check the wallet pass on your iPhone, 5 minutes' });
    b.taskOp({ op: 'after', id: t.id, act: 'more', n: '1', text: '1) Open Safari.\n2) Tap Add to Wallet.\n' });
    assert.deepEqual(b.tasks().find((y) => y.id === t.id).after, [{ t: 'Check the wallet pass on your iPhone, 5 minutes', done: false, more: '1) Open Safari.\n2) Tap Add to Wallet.' }]);
    b.taskOp({ op: 'after', id: t.id, act: 'done', n: '1' });
    assert.equal(b.tasks().find((y) => y.id === t.id).after[0].more, '1) Open Safari.\n2) Tap Add to Wallet.');
    b.taskOp({ op: 'after', id: t.id, act: 'more', n: '1', text: '' });
    assert.equal('more' in b.tasks().find((y) => y.id === t.id).after[0], false);
    assert.throws(() => b.taskOp({ op: 'needs', id: t.id, act: 'more', n: '1', text: 'x' }), /no need 1/);
    assert.throws(() => b.taskOp({ op: 'after', id: t.id, act: 'more', n: '1', text: 'x'.repeat(20001) }), /20000/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The real render functions from ui/board.js against a stub page.
const src = fs.readFileSync(new URL('../ui/board.js', import.meta.url), 'utf8');
const lines = ['stepWho', 'stepHis', 'stepText', 'stepMore', 'stepsHtml'].map((n) => new RegExp(`^const ${n} = .*$`, 'm').exec(src)[0]).join('\n');
const B0 = { smore: new Map() };
const render = () => new Function('esc', 'B', 'S', `${lines}; return stepsHtml;`)((s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), B0, { sq: {} });
const steps = [{ t: 'Check the wallet pass, 5 minutes', done: false, who: 'owner', more: '1) Open `https://x/invite`.\n2) Tap Add.' }, { t: 'Sync R2', done: false, who: 'ops' }];

test('a step renders as one line with More only; the full steps wait for the modal', () => {
  const row = render()(steps, 'after', 'After merging', 't9');
  assert.match(row, /You:<\/b> Check the wallet pass, 5 minutes<button class="mmore" type="button" data-more="t9:after:1" aria-haspopup="dialog">More<\/button><\/span>/);
  assert.doesNotMatch(row, /Open|Walk/);
  assert.equal((row.match(/<button/g) || []).length, 1, 'More is the only button on the row; a step without full steps gets none');
  assert.equal(B0.smore.get('t9:after:1').more, steps[0].more);
});

test('the modal renders the steps as markdown and holds the walk-through button, which wakes the owner and opens its 1:1', async () => {
  const body = /^function openStep[\s\S]*?^}$/m.exec(src)[0], guide = /^const stepGuide = .*$/m.exec(src)[0];
  const calls = [];
  const B = { smore: new Map([['t9:after:1', steps[0]]]), tasks: [{ id: 't9', owner: 'ann' }] }, S = { sq: { ann: { name: 'Ann' } } };
  const pop = { btn: null, querySelector: () => pop.btn };
  const showPop = (el, html, wire, o) => { calls.push(['pop', html, o.title]); pop.btn = /data-guide/.test(html) ? {} : null; wire(pop); };
  const md = (t) => `<ol><li>${t.length}</li></ol>`;
  const api = async (u, b) => { calls.push(['api', u, b.why]); return {}; };
  const openStep = new Function('B', 'S', 'showPop', 'md', 'api', 'closePop', 'toast', 'oneOnOne', 'esc', 'me', `${guide}\n${body}; return openStep;`)(B, S, showPop, md, api, () => calls.push(['close']), () => {}, (id) => calls.push(['1on1', id]), (s) => s, () => ({ name: 'Sam' }));
  openStep({}, 't9:after:1');
  const [, html, title] = calls[0];
  assert.equal(title, 'Check the wallet pass, 5 minutes');
  assert.match(html, /^<div class="mdfull"><ol><li>\d+<\/li><\/ol><\/div><div class="mft"><button type="button" class="btn go" data-guide>Walk through it with Ann<\/button><\/div>$/);
  await pop.btn.onclick();
  assert.equal(calls[1][1], '/squiggles/ann/wake');
  assert.match(calls[1][2], /^Sam opened More on t9 after step 1 .*walk them through it in your 1:1/);
  assert.deepEqual(calls.slice(2), [['close'], ['1on1', 'ann']]);
  B.tasks = [{ id: 't9', owner: 'gone' }]; calls.length = 0; openStep({}, 't9:after:1');
  assert.doesNotMatch(calls[0][1], /data-guide/, 'no button when the owner is not in the room');
});

test('More opens the modal from the Review click handler and is a thumb-sized target', () => {
  assert.match(src, /const more = e\.target\.closest\('\[data-more\]'\); if \(more\) return openStep\(more, more\.dataset\.more\);/);
  assert.match(fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8'), /^function md\(src\) \{$/m, 'md() is the room\'s shared markdown renderer');
  const css = fs.readFileSync(new URL('../ui/room.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(pointer: coarse\) \{ \.mmore \{ min-height: 44px; min-width: 44px \} \}/);
});

test('the modal title drops the backticks a step uses for code', () => {
  const body = /^function openStep[\s\S]*?^}$/m.exec(src)[0], guide = /^const stepGuide = .*$/m.exec(src)[0];
  let title;
  const B = { smore: new Map([['t9:needs:1', { t: 'Run `npm test` then `npm run build`, 2 minutes', more: 'x' }]]), tasks: [] };
  const openStep = new Function('B', 'S', 'showPop', 'md', 'esc', `${guide}\n${body}; return openStep;`)(B, { sq: {} }, (el, h, w, o) => { title = o.title; }, (t) => t, (s) => s);
  openStep({}, 't9:needs:1');
  assert.equal(title, 'Run npm test then npm run build, 2 minutes');
});
