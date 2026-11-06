// Settings > Sharing > Peers. Turning Share on left Invite a peer disabled until a refresh; a slow read could untick the box or close the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const peersSrc = fs.readFileSync(new URL('../ui/peers.js', import.meta.url), 'utf8');
const roomSrc = fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
const paintShare = /^function paintShare\(st\) \{.*\}$/m.exec(roomSrc)[0];
const paintCf = /^function paintCf\(cf\) \{\n[\s\S]*?\n\}$/m.exec(roomSrc)[0];

const later = () => { let go; const p = new Promise((r) => { go = r; }); return { p, go }; };
const flush = async () => { for (let i = 0; i < 30; i++) await null; };
const el = (extra = {}) => ({ checked: false, hidden: false, dataset: {}, innerHTML: '', contains: () => false, querySelectorAll: () => [], addEventListener() {}, ...extra });

// The real peers.js and paintShare against a stub page. truth is the server; hold(method) can keep a call waiting.
const page = async (truth, hold = () => null) => {
  const els = {}, toasts = [], doc = { activeElement: null }, $ = (s) => (els[s] ||= el());
  const read = () => ({ on: truth.on, self: { name: 'room', url: truth.url }, pending: truth.pending, peers: [] });
  const fetch = async (u, o) => {
    if (o?.method === 'POST') {
      const b = JSON.parse(o.body); await hold('POST', b);
      if (truth.fail) return { json: async () => ({ error: truth.fail }) };
      if (b.op === 'on' || b.op === 'off') truth.on = b.op === 'on';
      if (b.op === 'invite') { truth.pending = { expires: new Date(Date.now() + 6e5).toISOString() }; return { json: async () => ({ code: 'squiggles-peer1.demo', expires: truth.pending.expires }) }; }
      return { json: async () => ({ on: truth.on }) };
    }
    const seen = read(); await hold('GET'); return { json: async () => seen }; // what a read saw when it began
  };
  const stubs = {
    $, fetch, toast: (m) => toasts.push(m), esc: (s) => String(s), unlocked: (go) => go(), GATE: Promise.resolve(),
    B: {}, document: doc, setTimeout: () => 0, clearTimeout() {},
  };
  const r = new Function(...Object.keys(stubs), `${peersSrc}; ${paintCf}; ${paintShare}; return { PEER, loadPeers, paintPeers, paintShare };`)(...Object.values(stubs));
  await flush();
  const tick = (checked) => { $('#peersOn').checked = checked; return $('#peersOn').onchange({ target: $('#peersOn') }); };
  const click = (p) => $('#peerBody').onclick({ target: { closest: () => ({ dataset: { p } }) } });
  return { ...r, $, doc, toasts, tick, click, body: () => $('#peerBody').innerHTML, box: () => $('#peersOn').checked };
};
const off = () => ({ on: false, url: '', pending: null });
const on = () => ({ on: true, url: 'https://demo.example.ts.net', pending: null });
const invite = (r) => /data-p="invite" (?!disabled)/.test(r.body());

test('turning Share on enables Invite a peer without a refresh', async () => {
  const truth = { ...on(), url: '' }, r = await page(truth);
  assert.equal(invite(r), false);
  r.$('#shareOn').checked = true; // the click flips the box before the reply lands
  truth.url = 'https://demo.example.ts.net';
  r.paintShare({ on: true, url: truth.url }); await flush();
  assert.equal(invite(r), true);
  assert.doesNotMatch(r.body(), /Turn on Share the room first/);
});
test('turning Share off disables it the same way', async () => {
  const truth = on(), r = await page(truth);
  assert.equal(invite(r), true);
  r.$('#shareOn').checked = false; truth.url = '';
  r.paintShare({ on: false }); await flush();
  assert.equal(invite(r), false);
});
test('the tick shows at once, while the save is slow', async () => {
  const save = later(), r = await page(on(), (m) => (m === 'POST' ? save.p : null));
  r.PEER.d.on = false; r.paintPeers();
  const ticked = r.tick(true); await flush();
  assert.equal(r.box(), true);
  assert.match(r.body(), /Invite a peer/, 'the page moves on before the save returns');
  save.go(); await ticked; await flush();
  assert.equal(r.box(), true);
});
test('a read begun before the tick, landing during the save, keeps the box ticked', async () => {
  const old = later(), save = later(), truth = off(); let holdRead = false;
  const r = await page(truth, (m) => { if (m === 'POST') return save.p; if (holdRead) { holdRead = false; return old.p; } return null; });
  holdRead = true; const slow = r.loadPeers(); await flush();
  const ticked = r.tick(true); await flush();
  old.go(); await slow; await flush();
  assert.equal(r.box(), true);
  save.go(); await ticked; await flush();
  assert.equal(r.box(), true);
});
test('a read begun before the save, landing after it, keeps the box ticked', async () => {
  const old = later(), truth = off(); let holdRead = false;
  const r = await page(truth, (m) => { if (m === 'GET' && holdRead) { holdRead = false; return old.p; } return null; });
  holdRead = true; const slow = r.loadPeers(); await flush();
  await r.tick(true); await flush();
  old.go(); await slow; await flush();
  assert.equal(r.box(), true);
});
test('a refused save unticks and says why', async () => {
  const truth = { ...off(), fail: 'Only the owner and the lead change peers' }, r = await page(truth);
  await r.tick(true); await flush();
  assert.equal(r.box(), false);
  assert.deepEqual(r.toasts, [truth.fail]);
  assert.match(r.body(), /Peers are off/);
});
test('the code shows as soon as the invite returns, before the next read', async () => {
  const read = later(); let holdRead = false;
  const r = await page(on(), (m) => (m === 'GET' && holdRead ? read.p : null));
  r.PEER.panel = 'name'; r.paintPeers(); r.$('#peerName').value = 'room';
  holdRead = true; const made = r.click('make'); await flush();
  assert.match(r.body(), /squiggles-peer1\.demo/);
  read.go(); await made; await flush();
  assert.match(r.body(), /squiggles-peer1\.demo/);
});
test('an older read landing after the invite does not close the code', async () => {
  const old = later(), truth = on(); let holdRead = false;
  const r = await page(truth, (m) => { if (m === 'GET' && holdRead) { holdRead = false; return old.p; } return null; });
  r.PEER.panel = 'name'; r.paintPeers(); r.$('#peerName').value = 'room';
  holdRead = true; const slow = r.loadPeers(); await flush();
  await r.click('make'); await flush();
  old.go(); await slow; await flush();
  assert.equal(r.PEER.panel, 'code');
  assert.match(r.body(), /squiggles-peer1\.demo/);
});
test('a refused name stays in the box', async () => {
  const truth = { ...on(), fail: 'name: too long' }, r = await page(truth);
  r.PEER.panel = 'name'; r.paintPeers(); r.$('#peerName').value = 'typed-name';
  await r.click('make'); await flush();
  assert.match(r.body(), /value="typed-name"/);
  assert.match(r.body(), /Name: too long/);
});
test('Make code says it is working, even with the name box focused', async () => {
  const save = later(), r = await page(on(), (m) => (m === 'POST' ? save.p : null));
  r.PEER.panel = 'name'; r.paintPeers();
  const name = r.$('#peerName'); name.value = 'room'; name.matches = () => true; name.blur = () => { r.doc.activeElement = null; };
  r.$('#peerBody').contains = (x) => !!x; r.doc.activeElement = name; // Safari keeps focus in the box on a button click
  const made = r.click('make'); await flush();
  assert.match(r.body(), /Making/);
  assert.match(r.body(), /data-p="make" disabled/);
  save.go(); await made;
});
test('a fresh install, no sharing set up: the Sharing tab stays and says how to turn it on', async () => {
  const r = await page(off());
  r.tick(true); await flush();
  r.paintShare({ on: false, url: '', tailnetOff: true, cloudflare: { on: false, url: '', off: true }, off: true }); await flush();
  assert.equal(r.$('.settabs [data-stab="sharing"]').hidden, false);
  assert.equal(r.$('#shareOffHint').hidden, false);
  assert.equal(invite(r), false);
  assert.match(r.body(), /"tailnet": true/);
});
test('with tailnet set up but off, Peers points at Share the room', async () => {
  const r = await page(off());
  r.tick(true); await flush();
  r.paintShare({ on: false, url: '', cloudflare: { off: true } }); await flush();
  assert.equal(r.$('#shareOffHint').hidden, true);
  assert.match(r.body(), /Turn on Share the room first/);
});
