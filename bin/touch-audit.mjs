// Touch-target audit: every visible control under 44x44 on a coarse pointer at 390x844, on a temp data dir (never the live room).
// node bin/touch-audit.mjs [--json out.json]; exits 1 when a control is too small.
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url))), JSON_OUT = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const SET_TABS = JSON.parse(fs.readFileSync(path.join(REPO, 'ui/board.js'), 'utf8').match(/const SET_TABS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touch-audit-')), data = path.join(dir, 'data'), META = 'squiggle' + '.json';
const sq = [['boss', 'Boss', 'Lead', true], ['ada', 'Ada', 'Builder'], ['bo', 'Bo', 'Writer']];
for (const [id, name, role, lead] of sq) {
  const d = path.join(data, 'squiggles', id); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, META), JSON.stringify({ name, role, cwd: '~', every: 0, paused: true, permissionMode: 'auto', ...(lead ? { lead: true } : {}) }));
  fs.writeFileSync(path.join(d, 'charter.md'), 'Test fixture.\n'); fs.writeFileSync(path.join(d, 'journal.md'), '');
}
// a throwaway git repo so the gated goal's review task has a branch to show
const repo = path.join(dir, 'site'); fs.mkdirSync(repo);
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const g = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore', env });
g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n'); g('add', '.'); g('commit', '-qm', 'init');
g('checkout', '-qb', 't3'); fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n'); g('commit', '-qam', 'change'); g('checkout', '-q', 'main');
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(data, 'goals.json'), JSON.stringify({
  active: [{ id: 'site', title: 'Website', repos: [repo], owner: 'ada', merge: 'gated', last_confirmed: today, note: 'Gated demo goal.' },
    { id: 'writing', title: 'Writing', owner: 'bo', last_confirmed: today, note: 'Demo goal.' }], hold: [], todo: [], done: [] }, null, 2));
fs.writeFileSync(path.join(data, 'tasks.json'), JSON.stringify({ last: 4, tasks: [
  { id: 't1', title: 'Draft the pricing page', status: 'todo', created: today, confirmed: today, goal: 'writing', owner: 'bo', by: 'boss' },
  { id: 't2', title: 'Fix the header layout', status: 'doing', created: today, confirmed: today, goal: 'site', owner: 'ada', by: 'boss' },
  { id: 't3', title: 'New footer links', status: 'review', created: today, confirmed: today, goal: 'site', owner: 'ada', by: 'boss', repo, branch: 't3', note: 'Tests pass.', ask: 'Footer links look right?' },
  { id: 't4', title: 'Blocked on DNS', status: 'blocked', created: today, confirmed: today, goal: 'site', owner: 'ada', by: 'boss', note: 'Waiting on the owner.' }] }, null, 2));
const stubs = path.join(dir, 'stubs'); fs.mkdirSync(stubs);
fs.writeFileSync(path.join(stubs, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const port = await freePort(), base = `http://127.0.0.1:${port}`, cport = await freePort();
if (port === 4317) throw new Error('refusing live port');
const server = spawn(process.execPath, [path.join(REPO, 'server.mjs')], { cwd: dir, stdio: 'ignore', env: { ...process.env, HOME: dir, SQUIGGLES_HOME: data, PORT: String(port), PATH: `${stubs}:${process.env.PATH}` } });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--use-mock-keychain', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(dir, 'chrome')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
console.log('server pid', server.pid, 'chrome pid', chrome.pid);
let results = {}, coarse = null;
try {
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { up = await fetch(`${base}/api/humans`).then((r) => r.ok).catch(() => false); if (!up) await pause(200); }
  if (!up) throw new Error('server not up');
  let tgt;
  for (let i = 0; i < 100 && !tgt; i++) { tgt = await fetch(`http://127.0.0.1:${cport}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null); if (!tgt) await pause(200); }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let n = 0; const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await cdp('Page.navigate', { url: base + '/' }); await pause(2500);
  const MQ = "({coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, hoverNone: matchMedia('(hover: none)').matches})";
  coarse = await ev(MQ);
  if (!coarse.coarse) {
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] });
    await cdp('Page.reload'); await pause(2500);
    coarse = { ...(await ev(MQ)), viaEmulatedMedia: true };
  }
  await ev("document.querySelector('#joinBtn')?.click(), true"); await pause(800);
  const COLLECT = `(() => {
    const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [onclick], summary, label';
    const W = innerWidth, out = [], prose = [];
    const sel = (el) => { if (el.id) return '#' + CSS.escape(el.id); let s = el.tagName.toLowerCase() + [...el.classList].map((c) => '.' + CSS.escape(c)).join('');
      for (const a of ['data-view', 'data-act', 'data-a', 'aria-label', 'name', 'type']) if (el.getAttribute(a) && !s.includes('.')) { s += '[' + a + '="' + el.getAttribute(a).slice(0, 30) + '"]'; break; }
      let p = el.parentElement; while (p && !p.id) p = p.parentElement; return (p ? '#' + CSS.escape(p.id) + ' ' : '') + s; };
    for (const el of document.querySelectorAll(SEL)) {
      if (el.tagName === 'LABEL' && !el.querySelector('input,select,textarea')) continue; // a label beside its control is text; a wrapping label is the target
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.right <= 0 || r.left >= W) continue;
      const inProse = el.tagName === 'A' && el.closest('.msg, .bubble, .text, p, li, .md, .note');
      if (r.width >= 44 && r.height >= 44) continue;
      if (/^(checkbox|radio)$/.test(el.type) && [...el.labels].some((l) => { const b = l.getBoundingClientRect(); return b.width >= 44 && b.height >= 44; })) continue; // a 44px label toggles it
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 20);
      const key = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('') + (text ? ' "' + text + '"' : '');
      const rec = { key, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, sel: sel(el), classes: [...el.classList], id: el.id };
      (inProse ? prose : out)[(inProse ? prose : out).length] = rec;
    }
    const ptr = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.matches(SEL) || el.closest(SEL) || el.querySelector(SEL)) continue;
      if (getComputedStyle(el).cursor !== 'pointer' || (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.right <= 0 || r.left >= W || (r.width >= 44 && r.height >= 44)) continue;
      const text = (el.innerText || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 20);
      ptr[ptr.length] = { key: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].map((c) => '.' + c).join('') + (text ? ' "' + text + '"' : ''), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, sel: sel(el), classes: [...el.classList], id: el.id, pointerOnly: true };
    }
    const seenP = new Set(); out.splice(out.length, 0, ...ptr.filter((x) => !seenP.has(x.key) && seenP.add(x.key)));
    const seen = new Set(), dedup = out.filter((x) => !seen.has(x.key) && seen.add(x.key));
    return { undersized: dedup, proseLinks: prose.length, total: document.querySelectorAll(SEL).length, visible: [...document.querySelectorAll(SEL)].filter((e) => e.checkVisibility() && e.getBoundingClientRect().width).length, body: document.body.className, chats: [...document.querySelectorAll("[id^=cw-]")].map((c) => c.id + ":" + c.checkVisibility()).join(" ") };
  })()`;
  const nav = (v) => `setView('${v}')`, first = (q) => `document.querySelector('${q}')`;
  // ';;' splits a view into steps with a pause between, so a board can render before its popup opens
  const views = [...['room', 'lead', 'team', 'goals', 'tasks', 'merge', 'calendar', 'files'].map((v) => [v, nav(v)]),
    ...SET_TABS.map((t) => ['settings ' + t, `setView('settings'); B.stab = '${t}'; paintSetTab()`]),
    ['tab bar More', "document.querySelector('.tabs .tmore').click()"], ['More menu', "document.querySelector('#moreBtn').click()"],
    ['chat', "setView('room'); openChat('ada')"], ['squiggle sheet', "openSheet('ada')"], ['new squiggle', 'openNew()'], ['inbox', 'openInbox()'],
    ['goal popup', `${nav('goals')};; editGoal(${first('[data-goal]')})`],
    ['task popup', "openTaskNote('t3')"], ['diff', `${nav('merge')};; openDiff('t3')`], ['meeting form', `${nav('calendar')};; editMeeting(${first('#calAdd')})`],
    ['keys', 'window.openKeys?.()'], ['jump', 'window.openJump?.()']];
  for (const [name, js] of views) {
    await cdp('Page.navigate', { url: base + '/' }); await pause(1800); await ev("document.querySelector('#joinBtn')?.click(), true"); await ev("setView('room'), true"); await pause(400); // fresh page per view: nothing left open from the last one
    let err; for (let i = 0; i < 3; i++) { try { for (const step of js.split(';;')) { await ev(`(() => { ${step}; return true; })()`); await pause(600); } err = null; break; } catch (e) { err = e; await pause(1000); } } // the board may still be loading
    if (err) { results[name] = { error: String(err.message).slice(0, 200) }; continue; }
    await pause(1200);
    results[name] = await ev(COLLECT);
  }
  ws.close();
} finally {
  try { process.kill(chrome.pid); } catch {} try { process.kill(server.pid); } catch {}
  await pause(800); fs.rmSync(dir, { recursive: true, force: true });
}
// where each id/class is defined (room.css, then ui/*.js|html)
const css = fs.readFileSync(path.join(REPO, 'ui/room.css'), 'utf8'), uiFiles = fs.readdirSync(path.join(REPO, 'ui')).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\#-]/g, '\\$&');
const where = (r) => { const names = [...(r.id ? ['#' + r.id] : []), ...r.classes.map((c) => '.' + c)], f = [];
  if (names.some((nm) => new RegExp(esc(nm) + '(?![\\w-])').test(css))) f[f.length] = 'room.css';
  for (const u of uiFiles) { const t = fs.readFileSync(path.join(REPO, 'ui', u), 'utf8'); if ((r.id && t.includes(r.id)) || r.classes.some((c) => new RegExp(`['" ]${esc(c)}['" ]`).test(t))) { f[f.length] = u; if (f.length > 2) break; } }
  return f.join(','); };
for (const v of Object.values(results)) for (const r of v.undersized || []) r.file = where(r);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ coarse, results }, null, 2));
console.log('coarse', JSON.stringify(coarse));
for (const [v, r] of Object.entries(results)) {
  if (r.error) { console.log(`== ${v}: ERROR ${r.error}`); continue; }
  console.log(`== ${v}: ${r.undersized.length} undersized of ${r.visible} visible, prose links ${r.proseLinks} [${r.body}] ${r.chats}`);
  for (const x of r.undersized) console.log(`  ${x.pointerOnly ? '(ptr) ' : ''}${x.w}x${x.h}\t${x.key.slice(0, 50)}\t${x.sel.slice(0, 60)}\t${x.file}`);
}
const misses = Object.values(results).reduce((n, r) => n + (r.error ? 1 : r.undersized.length), 0);
console.log(coarse?.coarse ? (misses ? `${misses} problem(s)` : 'all controls 44px or more') : 'coarse pointer not emulated');
process.exitCode = coarse?.coarse && !misses ? 0 : 1;
