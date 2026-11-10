import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';

// The lead's bare "Handled." replies must not add chat lines; one fold per chat collects them.
const js = fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
const src = js.slice(js.indexOf('const HANDLED'), js.indexOf('function chatEvent'));
function room() {
  const shown = [], cw = { classList: { contains: () => false } };
  const ctx = { S: { hist: {} }, esc: (s) => s, when: () => '', document: { getElementById: () => cw },
    appendLine: (_, line) => { line.el = { remove() { shown.splice(shown.indexOf(line), 1); }, classList: { contains: () => false, toggle() {} } }; shown.push(line); } };
  vm.runInNewContext(`${src}; this.foldHandled = foldHandled;`, ctx);
  const h = (ctx.S.hist.lead = []);
  const add = (line) => { h.push(line); ctx.appendLine(cw, line); };
  return { shown, h, report: (r) => add({ cls: 'm sys', rep: [r], ts: 1 }), say: (t) => add({ cls: 'm lead', text: t, ts: 2 }), handled: () => ctx.foldHandled('lead', 3) };
}

test('bare Handled. replies share one fold that moves to the bottom', () => {
  const r = room();
  r.report('[Ann · DONE] a'); r.handled();
  r.report('[Bo · DONE] b'); r.say('Cy is checking it.');
  r.report('[Di · DONE] c'); r.handled();
  r.report('[Ed · DONE] d'); r.handled();
  assert.deepEqual(r.shown.map((l) => (l.fold ? `fold ${l.fold.length}` : l.text || l.rep[0])), ['[Bo · DONE] b', 'Cy is checking it.', 'fold 3']);
  assert.equal(r.h.filter((l) => l.fold).length, 1);
});
