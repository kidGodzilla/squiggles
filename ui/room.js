// The room: squiggle tiles, the shared screen, the lead's chat, voices, radio and idle chatter.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const base = (f) => String(f || '').split('/').pop();
// The URL the page opened with: views restore from it after the room has loaded (t348).
const URL0 = location.search;
const fmtDur = (ms) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`);
// Room passcode (t913): PASS mirrors /api/passcode. A 401 after unlocking means the session ended elsewhere: reload to the lock screen.
const PASS = { set: false, ok: true };
const api = async (p, body) => (p === '/passcode' || await GATE, fetch('/api' + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => { if (r.status === 401 && PASS.set && PASS.ok) location.reload(); return r.json(); }));
// Every api() call waits here until the passcode gate opens (at once when there is none).
const GATE = passGate();

const prefs = Object.assign({ voice: true, music: true, station: 'fip', musicVol: 0.3, chatter: 'normal' }, (() => { try { return JSON.parse(localStorage.agentsPrefs || '{}'); } catch { return {}; } })());
const savePrefs = () => { try { localStorage.agentsPrefs = JSON.stringify(prefs); } catch {} };

const S = {
  sq: {}, order: [], term: {}, todos: {}, run: {}, speakers: new Set(), present: null, pin: {}, vis: {}, focus: null, office: '', officeIds: [], meeting: null,
  queue: [], level: {}, hist: {}, unread: {}, spokeAt: performance.now(), fill: 0, joined: false, lastFill: '', forUser: {},
};
const P = (id) => persona(S.sq[id]);

// =====================================================================
//  audio: voices, radio, a few office sounds (voice setup adapted from agent-standup, MIT)
// =====================================================================
const AUD = {
  ctx: null,
  init() {
    if (this.ctx) return this.ctx.resume();
    const c = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.voice = c.createGain(); this.music = c.createGain(); this.sfx = c.createGain();
    this.voice.connect(c.destination); this.music.connect(c.destination); this.sfx.connect(c.destination);
    this.music.gain.value = 0; this.sfx.gain.value = 0.8;
    this.apply();
  },
  apply() {
    if (!this.ctx) return;
    this.voice.gain.value = prefs.voice ? 1 : 0;
    const v = prefs.music ? prefs.musicVol * (this.ducked ? 0.16 : 1) : 0;
    this.music.gain.setTargetAtTime(v, this.ctx.currentTime, this.ducked ? 0.12 : 0.7);
    RADIO.sync();
  },
  duck(on) { clearTimeout(this.duckT); if (on) { this.ducked = true; this.apply(); } else this.duckT = setTimeout(() => { this.ducked = false; this.apply(); }, 900); },
  tone(freq, dur, type = 'sine', vol = 0.1, when = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + when, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur);
  },
  noise() { if (!this.nb) { const c = this.ctx; this.nb = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = this.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return this.nb; },
  hit(f, v, d, thump) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.2; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(bp).connect(g).connect(this.sfx); s.start(t, Math.random() * 0.5, d + 0.02);
    if (thump) { const o = c.createOscillator(), og = c.createGain(); o.frequency.setValueAtTime(thump, t); o.frequency.exponentialRampToValueAtTime(thump * 0.4, t + 0.05); og.gain.setValueAtTime(v * 0.7, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.06); o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.07); }
  },
  typing(n) { for (let k = 0; k < n; k++) setTimeout(() => this.hit(2400 + Math.random() * 1400, 0.06 + Math.random() * 0.05, 0.035, 240), k * (60 + Math.random() * 80)); },
  click() { this.hit(3200, 0.08, 0.02); },
  join() { this.tone(523, 0.14, 'triangle', 0.08); this.tone(784, 0.2, 'triangle', 0.08, 0.12); },
  ding() { this.tone(988, 0.5, 'triangle', 0.1); this.tone(1318, 0.5, 'sine', 0.05, 0.02); },
  alarm() { this.tone(440, 0.25, 'triangle', 0.1); this.tone(370, 0.35, 'triangle', 0.1, 0.18); },
};
const STATIONS = [['fip', 'FIP'], ['fipgroove', 'FIP Groove'], ['fipjazz', 'FIP Jazz'], ['fipelectro', 'FIP Electro'], ['fipreggae', 'FIP Reggae'], ['fiprock', 'FIP Rock'], ['fipnouveautes', 'FIP New'], ['fippop', 'FIP Pop']];
const RADIO = {
  el: null, cur: null,
  sync() {
    if (!AUD.ctx) return;
    if (!this.el) { const a = (this.el = new Audio()); a.crossOrigin = 'anonymous'; a.preload = 'none'; AUD.ctx.createMediaElementSource(a).connect(AUD.music); }
    const url = `https://icecast.radiofrance.fr/${prefs.station}-midfi.mp3`;
    if (prefs.music && S.joined) { if (this.cur !== url) { this.cur = url; this.el.src = url; } if (this.el.paused) this.el.play().catch(() => {}); }
    else if (this.cur) { this.cur = null; this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
  },
};

// ---------- speech: one speaker at a time, Kokoro voices, mouth follows the audio level ----------
const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\*\*?|__|#+\s|\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*(DONE|IDLE|BLOCKED|RETHINK):.*$/gim, '').replace(/\s+/g, ' ').trim();
const firstSentences = (t, n = 1, max = 200) => { const s = plain(t).match(/[^.!?]+[.!?]*/g) || []; let out = s.slice(0, n).join(' ').trim(); return out.length > max ? out.slice(0, max).replace(/\s\S*$/, '') + '…' : out; };
const estMs = (t) => Math.min(9000, 900 + t.length * 45);

// cap: the bottom caption is only for words meant for the user (t976); idle chatter and squiggle-to-squiggle talk stay on the tile.
function say(id, text, { label = '', priority = false, cap = false } = {}) {
  if (!text || !S.sq[id]) return;
  if (S.office && !S.officeIds.includes(id)) return;
  if (!priority) { const others = S.queue.filter((q) => !q.priority); if (others.length >= 3) S.queue.splice(S.queue.indexOf(others[0]), 1); }
  S.queue.push({ id, text, label, priority, cap });
  pumpSpeech();
}
let speaking = false;
async function pumpSpeech() {
  if (speaking || !S.joined) return;
  const q = S.queue.shift(); if (!q) return;
  speaking = true;
  try {
    startTalk(q.id, q.text, q.label, q.cap);
    if (prefs.voice && AUD.ctx) await speakAudio(q.id, q.text).catch(() => sleep(estMs(q.text)));
    else await sleep(estMs(q.text));
  } finally {
    stopTalk(q.id); speaking = false; S.spokeAt = performance.now(); S.fill = 0;
    setTimeout(pumpSpeech, 350);
  }
}
async function speakAudio(id, text) {
  const r = await fetch(`/api/tts?id=${encodeURIComponent(id)}&text=${encodeURIComponent(text)}`);
  if (!r.ok) throw new Error('tts');
  const buf = await AUD.ctx.decodeAudioData(await r.arrayBuffer());
  const c = AUD.ctx, src = c.createBufferSource(), an = c.createAnalyser(); an.fftSize = 256; src.buffer = buf;
  src.connect(an); an.connect(AUD.voice); S.src = src;
  const data = new Uint8Array(an.fftSize);
  S.level[id] = () => { an.getByteTimeDomainData(data); let s = 0; for (const v of data) { const x = (v - 128) / 128; s += x * x; } return Math.sqrt(s / data.length); };
  await new Promise((res) => { src.onended = res; setTimeout(res, buf.duration * 1000 + 800); src.start(); });
  delete S.level[id]; S.src = null;
}
const mouths = new Map();
function setMouth(svgRoot, ry, rx) { const m = svgRoot && svgRoot.querySelector('.mouthE'); if (m) { m.setAttribute('ry', ry); m.setAttribute('rx', rx); } }
function startTalk(id, text, label, cap) {
  const t = tileOf(id); if (!t) return;
  if (S.present && S.present !== id && presenter() !== S.present) hidePresent();
  S.speakers.add(id); AUD.duck(true); setFocus(id); showSpeaker(id, t, text, cap);
  for (const el of [t, ...camsOf(id)]) el.classList.add('speaking');
  t.querySelector('.bubble').innerHTML = (label ? `<small>${esc(label)}</small> ` : '') + esc(text); linkTasks(t.querySelector('.bubble'));
  if (S.present === id) $('#pcap').textContent = text;
  let open = false; clearInterval(mouths.get(id));
  mouths.set(id, setInterval(() => {
    const lv = S.level[id]; let ry, rx;
    if (lv) { const v = lv(); ry = (0.9 + Math.min(4.2, v * 28)).toFixed(1); rx = (4.8 - Math.min(1.1, v * 6)).toFixed(1); }
    else { open = !open; ry = open ? 4.2 : 1.1; rx = open ? 4 : 4.7; }
    for (const el of [t, ...camsOf(id)]) setMouth(el, ry, rx);
  }, 70));
}
function stopTalk(id) {
  clearInterval(mouths.get(id)); mouths.delete(id); S.speakers.delete(id); if (!S.speakers.size) AUD.duck(false);
  const t = tileOf(id);
  for (const el of [t, ...camsOf(id)].filter(Boolean)) { el.classList.remove('speaking'); setMouth(el, 0.9, 4.6); }
  if (S.present === id) $('#pcap').textContent = '';
  if ($('#speakcap').dataset.id === id) capLinger();
}
// The speaker is always visible (t670): in the Room their tile scrolls into view, unless the user is scrolling the
// stage; anywhere their tile isn't on screen, a caption with their face, name and words.
let stageTouched = 0;
for (const ev of ['wheel', 'touchmove', 'keydown']) $('#stage').addEventListener(ev, () => (stageTouched = Date.now()), { passive: true });
function onScreen(el) {
  const r = el.getBoundingClientRect(), top = $('header').offsetHeight, bottom = innerHeight - (PHONE.matches ? parseFloat(getComputedStyle(document.body).paddingBottom) || 0 : 0);
  return r.width > 40 && r.height > 30 && Math.min(r.bottom, bottom) - Math.max(r.top, top) > r.height * 0.6;
}
function showSpeaker(id, t, text, forUser) {
  const cap = $('#speakcap'), room = !document.body.matches('.v-goals,.v-tasks,.v-merge,.v-team,.v-cal');
  if (room && !S.office && !onScreen(t) && Date.now() - stageTouched > 5000) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else if (forUser && !onScreen(t) && !(S.present === id && $('#present').classList.contains('on'))) {
    const s = S.sq[id];
    cap.innerHTML = `<div class="tile mini">${avatarSVG(P(id), undefined, 'sc_')}</div><div><b>${esc(s.name)}</b><p>${esc(text)}</p></div><button class="capx" type="button" title="Dismiss" aria-label="Dismiss">×</button>`;
    if (!(cap.classList.contains('on') && cap.dataset.id === id)) capT0 = Date.now();
    clearTimeout(capT); capT = 0;
    cap.dataset.id = id; cap.classList.add('on');
    // Never over the field being typed in (t931): if the caption would cover it, it moves to the top.
    const f = document.activeElement, fr = f?.matches?.('textarea,input,[contenteditable]') && f.getBoundingClientRect();
    cap.classList.remove('top'); if (fr) { const cr = cap.getBoundingClientRect(); if (fr.bottom > cr.top && fr.top < cr.bottom) cap.classList.add('top'); } cap.onclick = (e) => { capHide(); if (!e.target.closest('.capx')) S.office ? openChat(id) : oneOnOne(id); };
  }
}
// After the words end the caption lingers as long again (4 to 12 s) so there's time to click it (t926);
// hovering or touching it holds it, leaving gives 4 s more.
let capT = 0, capT0 = 0, capHeld = false;
function capHide() { clearTimeout(capT); capT = 0; const c = $('#speakcap'); c.classList.remove('on'); c.dataset.id = ''; }
function capLinger(ms = Math.max(4000, Math.min(12000, Date.now() - capT0))) {
  clearTimeout(capT); capT = capHeld ? -1 : setTimeout(capHide, ms);
}
$('#speakcap').addEventListener('pointerenter', () => { capHeld = true; if (capT > 0) clearTimeout(capT), (capT = -1); });
$('#speakcap').addEventListener('pointerleave', () => { capHeld = false; if (capT === -1) capLinger(4000); });
const tileOf = (id) => document.getElementById('t-' + id);
const camsOf = (id) => [S.present === id ? $('#pcam') : null, document.querySelector(`#cw-${id} .tile.mini`), $('#speakcap').dataset.id === id ? $('#speakcap .tile') : null].filter(Boolean);

// =====================================================================
//  tiles
// =====================================================================
function renderStage() {
  const st = $('#stage');
  for (const id of S.order) {
    let t = tileOf(id);
    if (!t) {
      const p = P(id);
      t = document.createElement('div'); t.id = 't-' + id; t.className = 'tile' + (p.lead ? ' lead' : ''); t.tabIndex = 0;
      t.innerHTML = `${avatarSVG(p, undefined, 't' + p.gid + '_')}<div class="bubble"></div><div class="status"></div><div class="thought"></div><div class="ticker"></div><div class="subs"></div><div class="tag"><b>${esc(p.name)}</b><span>${esc(p.role)}</span></div><button class="chatbtn" title="Chat with ${esc(p.name)}">Chat</button><button class="ib editbtn" title="Edit ${esc(p.name)}" aria-label="Edit ${esc(p.name)}"><svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg></button>`;
      // Chat opens the floating window; anywhere else on the tile is a 1:1 with that squiggle.
      t.onclick = (e) => { if (e.target.closest('.editbtn')) openSheet(id); else if (e.target.closest('.chatbtn') || S.office) openChat(id); else oneOnOne(id); };
      t.onkeydown = (e) => { if (e.key === 'Enter' && e.target === t) oneOnOne(id); };
      st.appendChild(t);
    }
    paintTile(id);
  }
  for (const t of [...st.children]) if (!S.sq[t.id.slice(2)]) t.remove();
  layout(); renderSummary();
}
const STATUS_WORD = { working: 'Working', done: 'Done', idle: '', blocked: 'Blocked', rethink: 'Rethink', error: 'Error', waiting: 'Waiting' };
function paintTile(id) {
  const s = S.sq[id], t = tileOf(id); if (!t) return;
  const st = s.paused ? 'paused' : s.status || 'idle';
  for (const k of ['working', 'done', 'blocked', 'rethink', 'error', 'paused']) t.classList.toggle(k, st === k);
  const el = t.querySelector('.status'); el.className = 'status ' + st; el.textContent = s.paused ? 'Paused' : STATUS_WORD[st] ?? st;
  el.title = s.note || '';
  const cb = t.querySelector('.chatbtn'), n = S.unread[id] || 0;
  cb.textContent = n ? `${n} new` : 'Chat'; cb.classList.toggle('unread', !!n);
  if (id === leadId()) $('.tabs [data-view=lead]').innerHTML = n ? `Lead <span class="tcount" title="${n} new from the lead">${n}</span>` : 'Lead';
  paintSubs(id);
  const cw = document.getElementById('cw-' + id);
  if (cw) cw.querySelector('.chead small').textContent = (s.paused ? 'Paused' : STATUS_WORD[st] || 'Here') + (s.note && st !== 'idle' ? ` · ${s.note}` : '') ;
}
// Subagents (t4): a small tile per live Agent call, pinned to its squiggle's tile until it finishes.
function paintSubs(id) {
  const t = tileOf(id), el = t?.querySelector('.subs'); if (!el) return;
  const subs = Object.entries(S.sq[id].subs || {}), p = P(id);
  el.innerHTML = subs.map(([k, x], i) => `<div class="sub" title="${esc(p.name)}'s helper${x.type ? ` (${esc(x.type)})` : ''}: ${esc(x.desc)}"><div class="tile mini">${avatarSVG(p, undefined, 'sb' + p.gid + '_' + i + '_')}</div><span>${esc(x.desc || x.type || 'Helper')}</span></div>`).join('');
}
function renderSummary() {
  if (typeof B !== 'undefined' && B.view === 'team') renderTeam();
  const n = {}; for (const id of S.order) { const s = S.sq[id]; const k = s.paused ? 'paused' : s.status || 'idle'; n[k] = (n[k] || 0) + 1; }
  const parts = [['working', 'working'], ['blocked', 'blocked'], ['rethink', '<i>need a </i>rethink'], ['done', 'done'], ['paused', 'paused']].filter(([k]) => n[k]);
  $('#moreCount').textContent = `${S.order.length} in the room`;
  $('#summary').innerHTML = parts.map(([k, w]) => k === 'blocked' || k === 'rethink'
    ? `<button class="${k}" data-k="${k}" title="Show who">${n[k]} ${w}</button>` : `<span class="${k}">${n[k]} ${w}</span>`).join('');
}
// Blocked (or rethink) badge: one squiggle opens its 1:1 with the message in view; several open Team, stuck ones first.
function openStuck(k = 'blocked') {
  const ids = S.order.filter((id) => !S.sq[id].paused && S.sq[id].status === k);
  if (ids.length === 1) oneOnOne(ids[0]); else if (ids.length) setView('team');
}
$('#summary').onclick = (e) => { const b = e.target.closest('button[data-k]'); if (b) openStuck(b.dataset.k); };
function layout() {
  // Tiles stay video-call sized however few there are; the speaker gets a 2×2 spotlight.
  const st = $('#stage'), w = st.clientWidth - 32 || 800;
  const cols = Math.max(Math.min(3, Math.floor((w + 14) / 180)), Math.floor((w + 14) / 250)) || 1;
  const colw = (w - 14 * (cols - 1)) / cols, rh = Math.round(colw * 0.74);
  st.style.setProperty('--cols', cols); st.style.setProperty('--rh', rh + 'px');
  st.style.setProperty('--fcols', Math.min(2, cols)); st.style.setProperty('--fr', Math.min(2, cols));
}
new ResizeObserver(layout).observe($('#room'));
function setFocus(id) {
  if (S.focus === id) return; const o = tileOf(S.focus); if (o) o.classList.remove('focus');
  S.focus = id; const t = tileOf(id); if (t) t.classList.add('focus');
}
function thought(id, em) { const t = tileOf(id); if (!t) return; const el = t.querySelector('.thought'); el.textContent = em; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
function pop(id) { const t = tileOf(id); if (t) { t.classList.remove('pop'); void t.offsetWidth; t.classList.add('pop'); } }
function oops(id) { const t = tileOf(id); if (t) { t.classList.remove('oops'); void t.offsetWidth; t.classList.add('oops'); } }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; const c = $('#toasts'); c.appendChild(t); while (c.children.length > 3) c.firstChild.remove(); setTimeout(() => t.remove(), 3500); }

// =====================================================================
//  the shared screen, rebuilt from tool calls (adapted from agent-standup's presentation mode, MIT)
// =====================================================================
function pushTool(id, ev) {
  const buf = (S.term[id] = S.term[id] || []);
  buf.push({ ev, out: null, err: false, imgs: [], end: null, ts: ev.ts });
  if (buf.length > 80) buf.shift();
  if (ev.kind === 'todo') S.todos[id] = ev.items;
}
function attachOut(id, ev) {
  const buf = S.term[id] || [];
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].ev.tid === ev.tid) { Object.assign(buf[i], { out: ev.text, err: ev.err, imgs: ev.imgs || [], end: ev.ts }); if (ev.imgs?.length) seen(id, { view: 'image', title: buf[i].ev.file ? base(buf[i].ev.file) : buf[i].ev.name, imgs: ev.imgs.slice(0, 3) }, ev.ts); return buf[i]; }
}
// Visuals outrank bash (t764): the last screenshot or page a squiggle made stays on screen for VIS_FRESH, held VIS_HOLD.
const VIS_FRESH = 90000, VIS_HOLD = 20000;
function seen(id, m, ts) { S.vis[id] = { ...m, at: ts || Date.now() }; }
function setTicker(id, e) {
  const t = tileOf(id); if (!t || !e) return; const tk = t.querySelector('.ticker'), running = e.end == null, ev = e.ev;
  const arg = ev.kind === 'cmd' ? (ev.note || ev.text) : ev.file ? base(ev.file) : (ev.arg || '');
  tk.innerHTML = `${running ? '<span class="spin"></span>' : ''}<i>${esc(ev.name)}</i> ${esc(String(arg).slice(0, 80))}${running ? '' : ` <em class="${e.err ? 'bad' : 'ok'}">${e.err ? 'failed' : 'ok'} ${fmtDur(e.end - e.ts)}</em>`}`;
  tk.classList.add('on');
}
function termModel(id) {
  const buf = S.term[id] || [], last = buf[buf.length - 1], lines = [], more = (n) => ({ c: 'dim', t: `… +${n} lines` });
  const stat = !last ? '' : last.end == null ? `${last.ev.name} · running` : `${last.err ? 'failed' : 'ok'} · ${last.ev.name} · ${fmtDur(last.end - last.ts)}`;
  const vis = S.vis[id], age = vis ? Date.now() - vis.at : Infinity, code = last && ['edit', 'write', 'read'].includes(last.ev.kind);
  if (age < VIS_FRESH && !(code && age > VIS_HOLD)) return { ...vis, stat };
  if (code) {
    const d = last.ev, rows = (txt, c) => String(txt || '').split('\n').slice(0, 16).map((t) => ({ c, t }));
    if (d.kind === 'read') {
      if (last.out == null) lines.push({ c: 'dim', t: 'Opening file…' });
      else { const r = last.out.split('\n'); r.slice(0, 28).forEach((x) => { const m = x.match(/^\s*(\d+)\t(.*)$/); lines.push({ c: 'ctx', n: m ? m[1] : '', t: m ? m[2] : x }); }); if (r.length > 28) lines.push(more(r.length - 28)); }
    } else {
      if (d.kind === 'edit') lines.push(...rows(d.old, 'del'), ...rows(d.new, 'add')); else lines.push(...rows(d.text, 'add'));
      if (last.out) lines.push({ c: last.err ? 'err' : 'dim', t: last.out.split('\n')[0].slice(0, 140) });
    }
    return { view: 'editor', title: `${base(d.file)} — ${d.kind === 'read' ? 'read-only' : 'Editor'}`, tab: { file: base(d.file), path: String(d.file || '').split('/').slice(-4, -1).join(' › ') }, lines, stat };
  }
  for (const e of buf.slice(-10)) {
    const d = e.ev, out = (n) => { if (e.out == null) return; const r = e.out.split('\n'); r.slice(0, n).forEach((t) => lines.push({ c: e.err ? 'err' : 'out', t })); if (r.length > n) lines.push(more(r.length - n)); };
    if (d.kind === 'cmd') { lines.push({ c: 'cmd', t: String(d.text || '').split('\n').slice(0, 3).join('\n') }); if (d.note) lines.push({ c: 'dim', t: '# ' + d.note }); out(12); if (e.end == null) lines.push({ c: 'run', t: 'running…' }); }
    else { lines.push({ c: 'tool', t: `${d.name}(${d.file ? base(d.file) : String(d.arg || '').slice(0, 70)})` }); if (d.kind === 'search' || d.kind === 'web') out(6); }
  }
  return { view: 'term', lines: lines.slice(-60), stat };
}
const lineHtml = (l, view) => view === 'editor'
  ? `<div class="ln ${l.c}"><b>${esc(l.n != null ? l.n : l.c === 'add' ? '+' : l.c === 'del' ? '−' : '')}</b>${esc(l.t) || ' '}</div>`
  : `<div class="tl ${l.c}">${l.c === 'cmd' ? '<span class="ps">❯</span> ' : l.c === 'run' ? '<span class="spin"></span>' : ''}${esc(l.t)}</div>`;
let presentTimer = null;
// Shared screen (t664): what a squiggle put up in its 1:1 with `screen`. Stays until closed or replaced.
const pinOne = () => !document.body.classList.contains('v-meet') && S.officeIds.length === 1 ? S.officeIds[0] : '';
// A unified diff as files → hunks → lines with old and new line numbers (t665).
function parseDiff(rows) {
  const files = []; let f = null, h = null, o = 0, n = 0;
  for (const t of rows) {
    if (t.startsWith('diff --git ')) { const m = t.match(/^diff --git a\/(.*) b\/(.*)$/); f = { path: m ? m[2] : t.slice(11), from: m?.[1], add: 0, del: 0, note: '', hunks: [] }; files.push(f); h = null; continue; }
    if (!f) continue;
    if (!h) {
      if (t.startsWith('new file')) f.note = 'New file'; else if (t.startsWith('deleted file')) f.note = 'Deleted';
      else if (t.startsWith('rename from')) f.note = `Renamed from ${f.from}`; else if (t.startsWith('Binary files')) f.note = 'Binary file';
    }
    const hm = t.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/);
    if (hm) { o = +hm[1]; n = +hm[2]; h = { at: n, ctx: hm[3], lines: [] }; f.hunks.push(h); continue; }
    if (!h) continue;
    if (t[0] === '+') { f.add++; h.lines.push({ c: 'add', n: n++, t: t.slice(1) }); }
    else if (t[0] === '-') { f.del++; h.lines.push({ c: 'del', o: o++, t: t.slice(1) }); }
    else if (t[0] === '\\') h.lines.push({ c: 'dim', t: t.slice(2) });
    else h.lines.push({ c: '', o: o++, n: n++, t: t.slice(1) });
  }
  return files;
}
const diffCount = (f) => `${f.add ? `<i class="a">+${f.add}</i>` : ''}${f.del ? `<i class="d">−${f.del}</i>` : ''}`;
const diffView = (files) => !files.length ? '<p class="dnone">No changes</p>'
  : `<nav class="dfiles">${files.map((f, i) => `<a data-f="${i}"><span>${esc(f.path)}</span>${diffCount(f)}</a>`).join('')}</nav>`
  + files.map((f, i) => `<section class="dfile" id="df${i}"><h4><span>${esc(f.path)}</span>${f.note ? `<em>${esc(f.note)}</em>` : ''}${diffCount(f)}</h4>`
    + f.hunks.map((h) => `<div class="dhunk">Line ${h.at}${h.ctx ? `<code>${esc(h.ctx)}</code>` : ''}</div>` + h.lines.map((l) => `<div class="dl2 ${l.c}"><b>${l.o ?? ''}</b><b>${l.n ?? ''}</b><s>${l.c === 'add' ? '+' : l.c === 'del' ? '−' : ''}</s><code>${esc(l.t) || ' '}</code></div>`).join('')).join('')
    + '</section>').join('');
$('#pbody').addEventListener('click', (e) => { const a = e.target.closest('.dfiles a'); if (a) $('#df' + a.dataset.f)?.scrollIntoView({ block: 'start' }); });
function pinModel(id) {
  const v = S.pin[id], rows = String(v.text || '').split('\n').slice(0, 4000);
  if (v.kind === 'url') return { view: 'page', title: v.title, url: v.url, stat: v.url };
  if (v.kind === 'image') return { view: 'image', title: v.title, imgs: [v.url], stat: v.title };
  if (v.kind === 'video') return { view: 'video', title: v.title, url: v.url, stat: v.title };
  if (v.kind === 'diff') { const files = parseDiff(rows), sum = v.stat?.split('\n').pop()?.trim() || `${files.length} file${files.length === 1 ? '' : 's'} changed`; return { view: 'diff', title: v.title, html: diffView(files), stat: (v.cut ? 'Cut short · ' : '') + sum }; }
  const lines = rows.map((t, i) => ({ c: '', n: i + 1, t }));
  return { view: 'editor', title: v.title, tab: { file: v.title.split(/[/ ]/).pop(), path: v.kind === 'diff' ? v.stat?.split('\n').pop()?.trim() || '' : v.title }, lines, stat: (v.cut ? 'Cut short · ' : '') + (v.kind === 'diff' ? v.stat?.split('\n').pop()?.trim() || '' : `${rows.length} lines`) };
}
function syncPin() {
  const id = pinOne(), on = !!(id && S.pin[id]);
  document.body.classList.toggle('screen', on);
  if (on) { S.present = id; $('#present').classList.add('on'); clearTimeout(presentTimer); renderPresent(); layout(); }
  else if ($('#present').classList.contains('pinned')) hidePresent();
}
$('#pclose').onclick = () => { const id = pinOne(); if (id) api(`/squiggles/${id}/screen`, { kind: 'off', by: S.me || 'owner' }).catch((e) => toast(e.message)); };
function renderPresent() {
  const id = S.present, s = S.sq[id]; if (!s) return; const pinned = document.body.classList.contains('screen') && pinOne() === id && !!S.pin[id], m = pinned ? pinModel(id) : termModel(id), p = P(id);
  if (pinned && $('#present')._pin === S.pin[id]) return; // unchanged: keep the user's scroll
  $('#present')._pin = pinned ? S.pin[id] : null; $('#present').classList.toggle('pinned', pinned);
  $('#present .pwin').className = 'pwin ' + m.view; $('#present').classList.toggle('pic', ['image', 'page', 'video'].includes(m.view));
  $('#ptitle').textContent = m.view === 'term' ? `${s.name} — ${s.cwd}` : m.title;
  const pb = $('#pbody');
  if (m.view === 'diff') pb.innerHTML = m.html;
  else if (m.view === 'page') { if (pb.firstChild?.dataset?.u !== m.url) pb.innerHTML = `<iframe data-u="${esc(m.url)}" src="${esc(m.url)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>`; }
  else if (m.view === 'image') pb.innerHTML = m.imgs.map((u) => `<img src="${esc(u)}" alt="">`).join('');
  else if (m.view === 'video') { if (pb.firstChild?.dataset?.u !== m.url) pb.innerHTML = `<video data-u="${esc(m.url)}" src="${esc(m.url)}" controls autoplay muted loop playsinline></video>`; } // t1503: fills the share area
  else pb.innerHTML = (m.view === 'editor' ? `<div class="ptab"><span>${esc(m.tab.file)}</span><em>${esc(m.tab.path)}</em></div>` : '') + m.lines.map((l) => lineHtml(l, m.view)).join('') + (m.view === 'term' ? '<div class="tl"><span class="ps">❯</span> <span class="cursor"></span></div>' : '');
  pb.scrollTop = m.view === 'term' ? pb.scrollHeight : 0; $('#pstat').textContent = m.stat;
  const td = S.todos[id]; $('#present').classList.toggle('has-todo', !!td?.length);
  if (td?.length) $('#ptodo').innerHTML = `<h5>Tasks · ${td.filter((x) => x.s === 'completed').length}/${td.length}</h5>` + td.map((x) => `<div class="td ${x.s}">${esc(x.c)}</div>`).join('');
  $('#pbadge').textContent = pinned ? `${s.name} is sharing` : `${s.name} is sharing their screen`;
  if ($('#pcam').dataset.id !== id) { $('#pcam').innerHTML = avatarSVG(p, undefined, 'pc_') + `<div class="tag"><b>${esc(s.name)}</b></div>`; $('#pcam').dataset.id = id; }
}
const presenter = () => B.view === 'meeting' && S.meeting?.presenters?.[S.meeting.turn];
function showPresent(id) {
  if (S.office && presenter() !== id) return;
  if (S.speakers.size && !S.speakers.has(id) && presenter() !== id) return;
  const first = S.present !== id; S.present = id; $('#present').classList.add('on'); renderPresent();
  if (first) { layout(); sharing(); AUD.tone(880, 0.12, 'sine', 0.04); }
  armPresent();
}
function armPresent() {
  clearTimeout(presentTimer); if ($('#present').classList.contains('pinned')) return;
  if (presenter() === S.present) return; // a presenter's screen stays up for their turn
  presentTimer = setTimeout(() => { const last = (S.term[S.present] || []).slice(-1)[0]; if (last && last.end == null) armPresent(); else hidePresent(); }, $('#present').classList.contains('pic') ? VIS_HOLD : 4500);
}
// The sharer's camera works like their tile (t346): their 1:1, or their chat inside an office.
$('#pcam').onclick = () => { const id = $('#pcam').dataset.id; if (!S.sq[id]) return; if (S.office) openChat(id); else oneOnOne(id); };
$('#pcam').onkeydown = (e) => { if (e.key === 'Enter') $('#pcam').click(); };
function hidePresent() { clearTimeout(presentTimer); $('#present')._pin = null; if (!S.present) return; S.present = null; $('#present').classList.remove('on', 'pinned'); $('#pcap').textContent = ''; layout(); sharing(); }
// Meeting view: a presenter's screen widens the left column; chats re-flow beside it.
function sharing() { const on = !!S.present && presenter() === S.present; if (document.body.classList.contains('sharing') !== on) { document.body.classList.toggle('sharing', on); layoutMeet(); } }

// =====================================================================
//  chat with the lead
// =====================================================================
function md(src) {
  const blocks = [], text = String(src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (_, l, code) => { blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text.split(/\n{2,}/).map((para) => {
    if (/^\u0000\d+\u0000$/.test(para.trim())) return blocks[+para.trim().slice(1, -1)];
    const lines = para.split('\n');
    // tables: | a | b | with a |---| separator line
    if (lines.length >= 2 && /^\s*\|?.*\|.*$/.test(lines[0]) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[1])) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const align = cells(lines[1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      const td = (tag, c, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inline(c)}</${tag}>`;
      return `<div class="tbl"><table><thead><tr>${cells(lines[0]).map((c, i) => td('th', c, i)).join('')}</tr></thead><tbody>${lines.slice(2).map((l) => `<tr>${cells(l).map((c, i) => td('td', c, i)).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (lines.length === 1 && /^\s*(-{3,}|\*{3,})\s*$/.test(lines[0])) return '<hr>';
    const hm = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
    if (hm) { const h = `<h${Math.min(4, hm[1].length + 2)}>${inline(hm[2])}</h${Math.min(4, hm[1].length + 2)}>`; return lines.length > 1 ? h + md(lines.slice(1).join('\n')) : h; }
    if (lines.every((l) => /^\s*>/.test(l))) return `<blockquote>${md(lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n'))}</blockquote>`;
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) { const ol = /^\s*\d+\./.test(lines[0]); return `<${ol ? 'ol' : 'ul'}>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`; }
    return `<p>${lines.map(inline).join('<br>')}</p>`.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  }).join('');
}
const when = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// One floating window per agent. History is kept per agent so a window opens with its conversation.
const chatLine = (id, ev) => {
  const s = S.sq[id];
  if (ev.k === 'user' && ev.from === 'owner') {
    const h = ev.human || 'owner';
    const imgs = (ev.imgs || []).length ? `<div class="mimgs">${ev.imgs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Image"></a>`).join('')}</div>` : '';
    return h === (S.me || 'owner') ? { cls: 'm you', text: ev.text, html: mentionHtml(esc(ev.text)) + imgs } : { cls: 'm you other', text: ev.text, html: mentionHtml(esc(`${B.humans.find((x) => x.id === h)?.name || h}: ${ev.text}`)) + imgs };
  }
  if (ev.k === 'user') {
    const from = ev.from === 'lead' ? 'From the lead' : ev.from === 'mention' ? 'Mentioned' : ev.from === 'harness' ? (/^Team reports/.test(ev.text) ? 'Team reports' : 'Woke up') : ev.from;
    const rep = /^Team reports/.test(ev.text) ? ev.text.split('\n').filter((l) => l.startsWith('[')) : null;
    return { cls: 'm sys', rep, text: rep ? `${from}: ${ev.text.split('\n').filter((l) => l.startsWith('[')).length}` : `${from}: ${ev.text.split('\n')[0].slice(0, 80)}` };
  }
  if (ev.k === 'say') { const t = ev.text.replace(/^\s*(DONE|IDLE):.*$/gim, '').trim(); if (HANDLED.test(t)) return { handled: true }; return t ? { cls: 'm lead', html: (ev.by ? `<b class="by">${esc(S.sq[ev.by]?.name || ev.by)}</b>` : '') + mentionHtml(md(t)) + `<span class="when">${when(ev.ts)}</span>` } : null; }
  if (ev.k === 'end' && !s?.lead && ev.status !== 'idle' && ev.note) return { cls: 'm sys', text: `${STATUS_WORD[ev.status] || ev.status}: ${ev.note}` };
  return null;
};
// The lead answers most team reports with just "Handled." (t801): the reply and the report it answers fold into
// one quiet line, "7 reports handled", that opens to list them. The transcript keeps everything.
const HANDLED = /^handled[.!]?$/i;
function foldHandled(id, ts) {
  const h = S.hist[id] = S.hist[id] || [], last = h[h.length - 1];
  let items = [];
  if (last?.rep) { h.pop(); last.el?.remove(); items = last.rep.map((r) => ({ r, ts: last.ts })); }
  const prev = h[h.length - 1];
  if (prev?.fold) { prev.fold.push(...items); prev.ts = ts; foldPaint(prev); return; }
  const f = { cls: 'm sys fold', fold: items, ts }; foldPaint(f); h.push(f);
  const cw = document.getElementById('cw-' + id);
  if (cw && !cw.classList.contains('min')) appendLine(cw, f, true);
}
function foldPaint(f) {
  const n = f.fold.length, item = ({ r, ts }) => { const m = /^\[(.+?) · \w+\]\s*(.*)$/.exec(r); return `<li>${m ? `<b>${esc(m[1])}</b> ${esc(m[2])}` : esc(r)}<span class="when">${when(ts)}</span></li>`; };
  f.html = `<button type="button" class="fhead">${n ? `${n} report${n === 1 ? '' : 's'} handled` : 'Handled'}</button>${n ? `<ul>${f.fold.map(item).join('')}</ul>` : ''}`;
  if (f.el) { const open = f.el.classList.contains('open'); f.el.innerHTML = f.html; f.el.classList.toggle('open', open); }
}
function chatEvent(id, ev, live) {
  const line = chatLine(id, ev); if (!line) return;
  line.ts = +new Date(ev.ts || Date.now());
  if (line.handled) return foldHandled(id, line.ts);
  if (S.meeting?.attendees.includes(id)) queueThread();
  (S.hist[id] = S.hist[id] || []).push(line); if (S.hist[id].length > 300) S.hist[id].shift();
  const cw = document.getElementById('cw-' + id);
  if (cw && !cw.classList.contains('min')) return appendLine(cw, line, live && line.cls !== 'm you');
  if (live && line.cls === 'm lead') { S.unread[id] = (S.unread[id] || 0) + 1; paintTile(id); }
}
function appendLine(cw, line, keepPlace) {
  const box = cw.querySelector('.msgs'), d = document.createElement('div');
  d.className = line.cls; if (line.html) d.innerHTML = line.html; else d.textContent = line.text; line.el = d;
  if (line.fold) d.onclick = (e) => { if (e.target.closest('.fhead')) d.classList.toggle('open'); };
  box.querySelector('.empty')?.remove();
  box.appendChild(d); if (typeof linkTasks === 'function') linkTasks(d); if (box.pinned !== false || !keepPlace) pinBottom(box);
  for (const i of d.querySelectorAll('img')) i.addEventListener('load', () => { if (box.pinned !== false) pinBottom(box); }, { once: true });
}
// A chat stays pinned to its newest message unless the user scrolls up. Hidden windows (lock screen, another tab,
// minimized) can't scroll, so the pin is re-applied whenever the list becomes visible or changes size.
const pinBottom = (box) => { box.pinned = true; box.scrollTop = box.scrollHeight; };
const pinObserver = new ResizeObserver((es) => { for (const e of es) if (e.target.pinned !== false && e.target.clientHeight) e.target.scrollTop = e.target.scrollHeight; });
function pinChat(box) {
  // Only the user's scrolling moves the pin; a resize also fires scroll, and the observer re-pins after it.
  box.onscroll = () => { const h = box.clientHeight; if (h && h === box.lastH) box.pinned = box.scrollHeight - box.scrollTop - h < 80; box.lastH = h; };
  pinObserver.observe(box);
}
function setAct(id, text) { const el = document.querySelector(`#cw-${id} .act`); if (el) el.textContent = text || ''; }
let zTop = 20;
function front(cw) { document.querySelectorAll('.cw.front').forEach((x) => x.classList.remove('front')); cw.classList.add('front'); cw.style.zIndex = ++zTop; setTimeout(syncUrl); }
// The frontmost floating chat on this page goes in the URL (?chat=<id>, t349). Not the lead's: it opens on every join anyway.
function chatParam(v) {
  const page = v === 'lead' || v === 'one' ? 'room' : v;
  const open = [...document.querySelectorAll('#chats .cw:not(.office):not(.lead)')].filter((cw) => cw.dataset.pages.split(' ').includes(page));
  return open.sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0))[0]?.dataset.id || '';
}
const winPos = () => { try { return JSON.parse(localStorage.agentsWins || '{}'); } catch { return {}; } };
function saveWin(cw) {
  // A hidden window (locked, other tab) measures 0 and a minimized one is short: neither may overwrite the real size.
  if (!cw.offsetWidth || !cw.offsetHeight || (S.office && S.officeIds.includes(cw.dataset.id))) return;
  const all = winPos(), prev = all[cw.dataset.id] || {}, min = cw.classList.contains('min');
  all[cw.dataset.id] = { x: cw.offsetLeft, y: cw.offsetTop, w: cw.offsetWidth, h: min ? prev.h || 520 : cw.offsetHeight }; try { localStorage.agentsWins = JSON.stringify(all); } catch {} }
// A chat with a draft waiting (t627): the 1:1 (or the floating chat), the text in the box, not sent. An unsent draft already there wins.
function discuss(id, text, office = true) {
  if (!S.sq[id]) return;
  if (office) oneOnOne(id); else openChat(id);
  const ta = document.querySelector(`#cw-${id} textarea`); if (!ta) return;
  if (text && !ta.value.trim()) { ta.value = text; ta.dispatchEvent(new Event('input')); }
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
function openChat(id) {
  const s = S.sq[id]; if (!s) return;
  let cw = document.getElementById('cw-' + id);
  const v = (typeof B !== 'undefined' && B.view) || 'room', page = v === 'lead' || v === 'one' ? 'room' : v;
  if (cw) { if (!cw.dataset.pages.split(' ').includes(page)) cw.dataset.pages += ' ' + page; cw.classList.remove('min'); front(cw); pinBottom(cw.querySelector('.msgs')); cw.querySelector('textarea').focus(); clearUnread(id); return cw; }
  const p = P(id), open = document.querySelectorAll('.cw').length, saved = winPos()[id];
  cw = document.createElement('div'); cw.className = 'cw' + (s.lead ? ' lead' : ''); cw.id = 'cw-' + id; cw.dataset.id = id; cw.dataset.pages = page;
  cw.innerHTML = `<div class="chead"><button class="cback" data-a="back">Back</button><div class="tile mini">${avatarSVG(p, undefined, 'cw' + p.gid + '_')}</div>
      <div class="who"><b>${esc(s.name)}</b><small></small></div>
      <button class="ib" data-a="clear" title="Clear chat" aria-label="Clear chat"><svg viewBox="0 0 16 16"><path d="M6 3.5h7.5v9H6L2 8z"/><path d="M8 6l3.5 4M11.5 6L8 10"/></svg></button><button class="ib" data-a="min" title="Minimize" aria-label="Minimize"><svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg></button><button class="ib" data-a="close" title="Close" aria-label="Close"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button><button class="cclose" data-a="close">Close</button></div>
    <div class="msgs"><div class="empty">${s.lead ? 'Ask the lead anything. It runs the team and only brings you what needs you.' : `Talk to ${esc(s.name)} directly. It answers here and keeps working on its responsibility.`}</div></div>
    <div class="act"></div>
    <form><textarea rows="1" placeholder="Message ${esc(s.name)}"></textarea><button type="button" class="mic">Dictate</button><button class="send">Send</button></form>`;
  const W = 380, H = 520, x = saved ? saved.x : innerWidth - W - 20 - open * 34, y = saved ? saved.y : innerHeight - H - 20 - open * 28;
  Object.assign(cw.style, { left: Math.max(8, Math.min(innerWidth - 200, x)) + 'px', top: Math.max(60, Math.min(innerHeight - 80, y)) + 'px', width: (saved?.w || W) + 'px', height: (saved?.h || H) + 'px' });
  $('#chats').appendChild(cw); pinChat(cw.querySelector('.msgs'));
  for (const line of S.hist[id] || []) appendLine(cw, line, false);
  wireChat(cw, id); paintTile(id); front(cw); clearUnread(id);
  cw.querySelector('textarea').focus();
  return cw;
}
// Phone keyboard (t152): the layout viewport doesn't shrink on iOS, so the bottom sheet rides on the visual viewport.
if (window.visualViewport) {
  const vv = visualViewport, kb = () => { const r = document.documentElement.style; r.setProperty('--kb', Math.max(0, innerHeight - vv.height - vv.offsetTop) + 'px'); r.setProperty('--vvh', vv.height + 'px'); r.setProperty('--vvt', vv.offsetTop + 'px'); };
  vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); kb();
}
// The header wraps on phone; the office rows sit under it (t153). Banners under the header (limit, meeting on) push fixed panels down too (t605).
{ const bh = () => document.documentElement.style.setProperty('--bh', $('#limit').offsetHeight + $('#meetOn').offsetHeight + 'px'), ro = new ResizeObserver(bh); ro.observe($('#limit')); ro.observe($('#meetOn')); }
new ResizeObserver(() => document.documentElement.style.setProperty('--hh', $('header').offsetHeight + 'px')).observe($('header'));
function clearUnread(id) { if (S.unread[id]) { S.unread[id] = 0; paintTile(id); } }
const PHONE = matchMedia('(max-width: 760px)');
// @mentions (t677): typing @ in a chat offers squiggles and people; a known @name is a chip in the input and in messages.
const mentionables = () => [
  ...S.order.map((id) => ({ key: /^[\w-]+$/.test(S.sq[id].name) ? S.sq[id].name : id, id, name: S.sq[id].name, role: S.sq[id].lead ? 'Lead' : S.sq[id].role, face: () => avatarSVG(P(id), undefined, 'mn_' + id) })),
  ...(typeof B !== 'undefined' ? B.humans : []).map((h) => ({ key: /^[\w-]+$/.test(h.name) ? h.name : h.id, id: h.id, name: h.name, role: 'Person', human: true, face: () => humanFace(h) })),
];
const isMention = (w) => { w = w.toLowerCase(); return w === 'lead' || mentionables().some((m) => m.id.toLowerCase() === w || m.name.toLowerCase() === w); };
// Marks known @names in already-escaped text/HTML (never inside a tag).
const mentionHtml = (html) => html.replace(/(<[^>]*>)|(?<=^|[\s(>])@([\w-]+)/g, (all, tag, w) => tag ? tag : isMention(w) ? `<span class="mention">@${w}</span>` : all);
const MN = { el: null, ta: null, list: [], i: 0, at: -1 };
function mentionMirror(ta) {
  if (ta._mirror) return ta._mirror;
  const wrap = document.createElement('span'), mir = document.createElement('div');
  wrap.className = 'mwrap'; mir.className = 'mmirror'; mir.setAttribute('aria-hidden', 'true');
  // Moving the textarea blurs it, and this runs on its first focus (t1206).
  const had = document.activeElement === ta;
  ta.parentNode.insertBefore(wrap, ta); wrap.append(mir, ta);
  ta.addEventListener('scroll', () => (mir.scrollTop = ta.scrollTop));
  ta._mirror = mir; if (had) ta.focus();
  return mir;
}
function paintMirror(ta) { const mir = mentionMirror(ta); mir.innerHTML = mentionHtml(esc(ta.value)) + '\u200b'; mir.scrollTop = ta.scrollTop; }
function mentionClose() { if (MN.el) MN.el.classList.remove('on'); MN.ta = null; MN.list = []; }
function mentionOpen(ta) {
  const before = ta.value.slice(0, ta.selectionStart), m = before.match(/(^|\s)@([\w-]*)$/);
  if (!m) return mentionClose();
  const q = m[2].toLowerCase();
  MN.list = mentionables().filter((x) => !q || x.name.toLowerCase().startsWith(q) || x.id.toLowerCase().startsWith(q) || (q && x.role === 'Lead' && 'lead'.startsWith(q)));
  if (!MN.list.length) return mentionClose();
  MN.ta = ta; MN.at = before.length - m[2].length - 1; MN.i = Math.min(MN.i, MN.list.length - 1);
  if (!MN.el) { MN.el = document.createElement('div'); MN.el.id = 'mentions'; MN.el.setAttribute('role', 'listbox'); document.body.append(MN.el);
    MN.el.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); mentionPick(+b.dataset.i); } }); }
  MN.el.innerHTML = MN.list.map((x, i) => `<div class="mo${i === MN.i ? ' on' : ''}" data-i="${i}" role="option"><span class="mf${x.human ? ' hf' : ''}">${x.face()}</span><b>${esc(x.name)}</b><small>${esc(x.role || '')}</small></div>`).join('');
  const r = (ta.closest('form') || ta).getBoundingClientRect();
  Object.assign(MN.el.style, { left: Math.max(8, r.left) + 'px', bottom: innerHeight - r.top + 6 + 'px', width: Math.min(300, r.width) + 'px' });
  MN.el.classList.add('on'); MN.el.querySelector('.mo.on')?.scrollIntoView({ block: 'nearest' });
}
function mentionPick(i) {
  const x = MN.list[i], ta = MN.ta; if (!x || !ta) return;
  const end = ta.selectionStart, ins = `@${x.key} `;
  ta.value = ta.value.slice(0, MN.at) + ins + ta.value.slice(end); ta.selectionStart = ta.selectionEnd = MN.at + ins.length;
  mentionClose(); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
}
const chatInput = (t) => t?.tagName === 'TEXTAREA' && t.closest('.cw form, #meetThread form');
document.addEventListener('input', (e) => { if (!chatInput(e.target)) return; paintMirror(e.target); if (e.isTrusted || MN.ta) mentionOpen(e.target); });
document.addEventListener('focusin', (e) => { if (chatInput(e.target)) paintMirror(e.target); });
document.addEventListener('focusout', (e) => { if (e.target === MN.ta) setTimeout(mentionClose, 120); });
document.addEventListener('keydown', (e) => {
  if (!MN.ta || e.target !== MN.ta || !MN.el?.classList.contains('on')) return;
  const n = MN.list.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { MN.i = (MN.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; mentionOpen(MN.ta); }
  else if (e.key === 'Enter' || e.key === 'Tab') mentionPick(MN.i);
  else if (e.key === 'Escape') mentionClose();
  else return;
  e.preventDefault(); e.stopPropagation();
}, true);
// Images in chat (t169): paste, drop or pick; shown as a tray above the input until sent. Big photos are scaled to
// 2000 px JPEG in the browser so phone shots stay well under the model's 5 MB image limit.
function wireAttach(form, ta, zone) {
  form._imgs = [];
  const tray = document.createElement('div'); tray.className = 'atts';
  const pick = document.createElement('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.multiple = true; pick.hidden = true;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'attach'; btn.title = 'Attach image'; btn.setAttribute('aria-label', 'Attach image');
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 7.5l-5.6 5.6a3.3 3.3 0 01-4.7-4.7l5.9-5.9a2.2 2.2 0 013.1 3.1L6.4 11.4a1.1 1.1 0 01-1.6-1.6l5.3-5.3"/></svg>';
  form.prepend(tray); ta.after(btn, pick);
  const paint = () => { tray.innerHTML = form._imgs.map((u, i) => `<span><img src="${esc(u)}" alt="Image to send"><button type="button" data-i="${i}" title="Remove" aria-label="Remove image">×</button></span>`).join(''); tray.classList.toggle('on', form._imgs.length > 0); };
  const add = async (files) => { for (const f of files) if (/^image\//.test(f.type) && form._imgs.length < 8) form._imgs.push(await shrinkImage(f)); paint(); ta.focus(); };
  form._paint = paint;
  btn.onclick = () => pick.click();
  pick.onchange = () => { add([...pick.files]); pick.value = ''; };
  tray.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) { form._imgs.splice(+b.dataset.i, 1); paint(); } };
  ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); add(fs); } });
  zone.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); zone.classList.add('dropping'); } });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropping'); });
  zone.addEventListener('drop', (e) => { zone.classList.remove('dropping'); const fs = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type)); if (fs.length) { e.preventDefault(); add(fs); } });
}
const takeImages = (form) => { const v = form._imgs.splice(0); form._paint(); return v; };
function shrinkImage(file) {
  const read = () => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
  if (file.type === 'image/gif') return read();
  return new Promise((ok) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && file.size < 3.5e6 && /png|jpeg|webp/.test(file.type)) return ok(read());
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); ok(read()); };
    img.src = url;
  });
}
function wireChat(cw, id) {
  const ta = cw.querySelector('textarea'), head = cw.querySelector('.chead');
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
  const form = cw.querySelector('form'); wireAttach(form, ta, cw);
  const send = async () => { const t = ta.value.trim(), images = takeImages(form); if (!t && !images.length) return; ta.value = ''; autosize(); paintMirror(ta); mentionClose(); await api(`/squiggles/${id}/send`, { text: t, images, from: 'owner', human: me().id }); };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape') cw.classList.add('min'); });
  cw.querySelector('form').onsubmit = (e) => { e.preventDefault(); send(); };
  cw.addEventListener('mousedown', () => front(cw));
  new ResizeObserver(() => saveWin(cw)).observe(cw);
  head.addEventListener('click', (e) => {
    const a = e.target.dataset.a;
    if (a === 'clear') {
      const b = e.target;
      if (!b.classList.contains('arm')) { b.classList.add('arm'); b.dataset.label = b.innerHTML; b.textContent = 'Clear?'; b.title = 'Click again to clear this chat'; clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('arm'); b.innerHTML = b.dataset.label; b.title = 'Clear chat'; }, 3000); return; }
      clearTimeout(b._t); b.classList.remove('arm'); b.innerHTML = b.dataset.label; b.title = 'Clear chat';
      api(`/squiggles/${id}/clear`, {}); return;
    }
    if (a === 'back') return setView('room');
    if (a === 'close') { saveWin(cw); cw.remove(); syncUrl(); }
    else if (a === 'min') cw.classList.toggle('min');
    else if ((head.downOn || e.target).closest('.tile.mini, .who b') && !cw.dragged && !cw.classList.contains('office')) oneOnOne(id); // t821
    else if (cw.classList.contains('min') && !cw.dragged) { cw.classList.remove('min'); clearUnread(id); }
  });
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || PHONE.matches) return;
    // Pointer capture retargets the click to the header, so remember what was pressed (t821).
    head.downOn = e.target; const sx = e.clientX, sy = e.clientY, ox = cw.offsetLeft, oy = cw.offsetTop; cw.dragged = false; head.setPointerCapture(e.pointerId);
    const move = (m) => { const dx = m.clientX - sx, dy = m.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 3) { cw.dragged = true; cw.classList.add('dragging'); }
      cw.style.left = Math.max(0, Math.min(innerWidth - 120, ox + dx)) + 'px'; cw.style.top = Math.max(52, Math.min(innerHeight - 50, oy + dy)) + 'px'; };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); cw.classList.remove('dragging'); saveWin(cw); setTimeout(() => { cw.dragged = false; head.downOn = null; }, 0); };
    head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
  });
  const mic = cw.querySelector('.mic'), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) mic.style.display = 'none';
  else {
    let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.interimResults = true; rec.continuous = true; const start = ta.value;
      rec.onresult = (e) => { ta.value = (start ? start + ' ' : '') + [...e.results].map((r) => r[0].transcript).join(''); autosize(); };
      rec.onend = () => { rec = null; mic.classList.remove('on'); mic.textContent = 'Dictate'; };
      rec.start(); mic.classList.add('on'); mic.textContent = 'Listening';
    };
  }
}
const ACT = { cmd: (e) => e.note || 'running a command', read: (e) => `reading ${base(e.file)}`, edit: (e) => `editing ${base(e.file)}`, write: (e) => `writing ${base(e.file)}`, search: () => 'searching', web: () => 'checking the web', todo: () => 'planning', tool: (e) => e.name };

// =====================================================================
//  live events
// =====================================================================
function apply(id, ev, live) {
  const s = S.sq[id]; if (!s) return;
  chatEvent(id, ev, live);
  if (ev.k === 'user') S.forUser[id] = ev.from === 'owner';   // this turn answers a person
  switch (ev.k) {
    case 'tool':
      pushTool(id, ev); setTicker(id, S.term[id].slice(-1)[0]);
      if (!live) break;
      setAct(id, `${s.name} is ${ACT[ev.kind](ev)}…`);
      if (S.office && !S.officeIds.includes(id)) break;
      if (ev.kind === 'cmd' || ev.kind === 'edit' || ev.kind === 'write') AUD.typing(5 + Math.floor(Math.random() * 7)); else AUD.click();
      showPresent(id); break;
    case 'out': {
      const e = attachOut(id, ev); if (!e) break; setTicker(id, e);
      if (live && ev.imgs?.length) showPresent(id); else if (live && S.present === id) { renderPresent(); armPresent(); }
      if (live && ev.err) oops(id); break;
    }
    case 'sub':
      if (!live) break;
      s.subs ||= {};
      if (ev.end) delete s.subs[ev.task]; else s.subs[ev.task] = { desc: ev.desc, type: ev.type, at: ev.ts };
      paintSubs(id); break;
    case 'say':
      // A presenter is heard in full (their 60-second summary); everyone else by their first sentence or two.
      if (live && !HANDLED.test(ev.text.replace(/^\s*(DONE|IDLE):.*$/gim, '').trim())) say(id, presenter() === id ? firstSentences(ev.text, 40, 1400) : firstSentences(ev.text, s.lead ? 2 : 1, s.lead ? 260 : 180), { priority: s.lead || presenter() === id, cap: S.forUser[id] || presenter() === id || /^\s*(BLOCKED|RETHINK):/m.test(ev.text) }); break;
    case 'screen':
      if (ev.kind === 'off' || ev.gone) delete S.pin[id]; else S.pin[id] = ev;   // gone: content not kept past a restart (t854)
      if (!ev.gone && (ev.kind === 'image' || ev.kind === 'url' || ev.kind === 'video')) seen(id, ev.kind === 'image' ? { view: 'image', title: ev.title, imgs: [ev.url] } : { view: ev.kind === 'url' ? 'page' : 'video', title: ev.title, url: ev.url }, ev.ts);
      if (pinOne() === id) syncPin(); else if (live && S.vis[id]) showPresent(id); break;
    case 'state':
      s.status = ev.status; s.note = ev.note; paintTile(id); renderSummary();
      if (ev.status !== 'working') setAct(id, '');
      break;
    case 'end':
      if (!live || (S.office && !S.officeIds.includes(id))) break;
      if (ev.status === 'done') { pop(id); AUD.ding(); if (!s.lead) { toast(`${s.name}: done`); if (ev.note) say(id, firstSentences(ev.note, 1, 160), { label: 'Done' }); } }
      if (ev.status === 'blocked' || ev.status === 'rethink') { AUD.alarm(); toast(`${s.name} is ${ev.status === 'blocked' ? 'blocked' : 'asking for a rethink'}`); }
      break;
    case 'meta': if (live) refreshMeta(id); break;
    case 'cleared': {
      S.hist[id] = []; S.unread[id] = 0;
      const box = document.querySelector(`#cw-${id} .msgs`);
      if (box) box.innerHTML = '<div class="empty">Chat cleared. It still remembers everything.</div>';
      if (live) paintTile(id);
      break;
    }
    case 'rate':
      // Replayed history would re-toast old limits on every load (t98): live ones only, and only before the reset.
      if (live && ev.info?.status === 'rejected' && !(ev.info.resetsAt * 1000 < Date.now())) toast(`Usage limit hit${ev.info.resetsAt ? `, resets ${when(ev.info.resetsAt * 1000)}` : ''}`);
      break;
  }
}

async function refreshMeta(id) {
  const fresh = (await api('/squiggles')).find((x) => x.id === id); if (!fresh) return;
  const relook = ['look', 'lookSeed'].some((k) => (S.sq[id][k] ?? '') !== (fresh[k] ?? ''));
  Object.assign(S.sq[id], fresh); const t = tileOf(id); if (relook) reskin(id);
  if (t) { t.querySelector('.tag b').textContent = fresh.name; t.querySelector('.tag span').textContent = fresh.role; }
  if (B.view === 'settings' && !document.activeElement?.closest('#setSqs')) renderSettings(); // CLI set/look shows live (t897)
  const cw = document.getElementById('cw-' + id); if (cw) cw.querySelector('.chead b').textContent = fresh.name;
  paintTile(id);
}
// Everything the user can do from the header, the lead can do too (agents.mjs room ...).
async function roomCommand(ev) {
  if (ev.k === 'removed') { document.getElementById('cw-' + ev.id)?.remove(); await load(); return; }
  const v = String(ev.value ?? '').toLowerCase();
  switch (ev.action) {
    case 'defaults': if (B.view === 'settings' && !document.activeElement?.closest('#setDefaults')) renderDefaults(); return; // t898
    case 'radio': prefs.music = v !== 'off'; if (prefs.music && STATIONS.some(([s]) => s === v)) prefs.station = v; paintSound(); break;
    case 'volume': prefs.musicVol = Math.max(0, Math.min(1, +v || 0)); paintSound(); break;
    case 'voices': prefs.voice = v !== 'off'; paintSound(); break;
    case 'chatter': if (['quiet', 'normal', 'lively'].includes(v)) { prefs.chatter = v; paintSound(); } break;
    case 'view': if (v === 'settings' && ev.id) B.stab = setTab(String(ev.id).toLowerCase()); if (['room', 'lead', 'meeting', 'team', 'calendar', 'goals', 'tasks', 'merge', 'files', 'settings'].includes(v)) setView(v); else if (v === 'blocked' || v === 'rethink') openStuck(v); else if (v === '1on1' && S.sq[ev.id]) oneOnOne(ev.id); break;
    case 'fold': case 'unfold': foldGoals(v, ev.action === 'fold'); break; // t1217
    case 'chat': if (S.sq[ev.value]) { if (S.office && !S.officeIds.includes(ev.value)) setView('room'); discuss(ev.value, ev.text, false); } break;
    case 'lock': lock(); break;
    case 'reload': location.reload(); break;
    case 'quit': if (!$('#offnote')) document.body.insertAdjacentHTML('beforeend', '<div id="offnote"><b>Squiggles is off</b><p>Open Squiggles to start it again.</p></div>'); break;
    case 'restarting': toast('Server restarting with the latest code…'); setTimeout(() => location.reload(), 4000); break;
    case 'limit': showLimit(+ev.value || 0); break;
    case 'call': window.onCall?.(); break;
    case 'meeting': meetingNow(ev.value, true); break;
    case 'meetingSoon': meetingSoon(ev.value); break;
    case 'share': paintShare(ev.value); break;
    case 'peers': loadPeers(); return;
    case 'characters': roomGen(v); S.order.forEach(reskin); if (B.view === 'settings') renderSettings(); break;
  }
  savePrefs(); AUD.apply();
}
// Session limit banner, display only (t1284): nothing is paused, and it stays until the server says a Claude turn went through.
function showLimit(until) {
  $('#limit').classList.toggle('on', !!until);
  if (until) $('#limit').textContent = `Session limit hit, stated reset ${when(until)}. Wakes carry on.`;
}
async function load() {
  api('/limit').then((l) => showLimit(l.until || 0));
  roomGen((await api('/room').catch(() => ({}))).characters || 'cast');
  const list = await api('/squiggles').catch(() => null);
  // A failed read must not empty the room (t671): keep what's on screen and try again.
  if (!Array.isArray(list)) { setTimeout(load, 2000); return; }
  S.sq = {}; for (const s of list) S.sq[s.id] = s;
  S.hist = {}; S.term = {}; S.todos = {};
  document.querySelectorAll('.cw .msgs').forEach((m) => (m.innerHTML = ''));
  S.order = list.sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || String(a.created || '').localeCompare(String(b.created || ''))).map((s) => s.id);
  renderStage(); if (B.view === 'settings' && typeof renderSettings === 'function') renderSettings();
  await Promise.all(S.order.map(async (id) => { for (const ev of await api(`/squiggles/${id}/events?n=${S.sq[id].lead ? 300 : 150}`)) apply(id, ev, false); }));
  for (const id of S.order) paintTile(id);
  window.onBoard?.();
  renderJoinCast();
}
function listen() {
  const es = new EventSource('/api/stream');
  es.onmessage = async (m) => {
    const { id, ev } = JSON.parse(m.data);
    if (id === '*board') { window.onBoard?.(); return; }
    if (id === '*room') { roomCommand(ev); return; }
    if (!S.sq[id]) { await load(); return; }
    apply(id, ev, true);
  };
}

// =====================================================================
//  idle chatter and thoughts
// =====================================================================
const FILL = {
  busy: ['Still here, just heads-down.', 'Quick update: still on it.', 'No blockers on my side.', 'I’ll have an update in a minute.', 'Making progress, slowly but surely.', 'This one is taking a bit longer than I hoped.'],
  wait: ['Is it just me, or is it quiet?', 'Anyone need a hand?', 'All clear on my side.', 'Nothing on fire. I checked.', 'I’ll keep an eye on things.', 'Shall we take five?', 'Anyone else want coffee?'],
};
setInterval(() => {
  if (!S.joined || S.office || prefs.chatter === 'quiet' || S.speakers.size || S.queue.length || document.hidden || S.fill > 2) return;
  const here = S.order.filter((id) => !S.sq[id].paused);
  const wait = (prefs.chatter === 'lively' ? 20000 : 50000) * [1, 2.5, 6][S.fill];
  if (!here.length || performance.now() - S.spokeAt < wait) return;
  const busy = here.filter((id) => S.sq[id].status === 'working'), who = pick(busy.length ? busy : here);
  let line = pick(FILL[busy.length ? 'busy' : 'wait']); if (line === S.lastFill) line = pick(FILL.wait); S.lastFill = line;
  S.fill++; say(who, line);
}, 4000);
setInterval(() => {
  if (!S.joined || S.office || prefs.chatter === 'quiet' || S.speakers.size || document.hidden) return;
  const busy = S.order.filter((id) => S.sq[id].status === 'working'); if (!busy.length || Math.random() < 0.5) return;
  const id = pick(busy), last = (S.term[id] || []).slice(-1)[0]?.ev?.kind;
  thought(id, last === 'cmd' ? '⌨️' : last === 'search' || last === 'read' ? '🔍' : pick(['💭', '🎧', '🧠', '☕', '🎵']));
}, 7000);

// =====================================================================
//  squiggle sheet and the new-squiggle form
// =====================================================================
const brief = (e) => e.k === 'say' ? esc(e.text) : e.k === 'tool' ? `<code>${esc(e.name)}</code> ${esc(String(e.note || e.text || (e.file && base(e.file)) || e.arg || '').slice(0, 160))}` : e.k === 'out' && e.err ? `<code>failed</code> ${esc(e.text.slice(0, 160))}` : e.k === 'user' ? `<code>${esc(e.from)}</code> ${esc(e.text.slice(0, 200))}` : e.k === 'end' ? `<code>${esc(e.status)}</code> ${esc(e.note || '')}` : '';
async function openSheet(id) {
  await refreshMeta(id);
  const s = S.sq[id], p = P(id);
  const [journal, events] = await Promise.all([api(`/squiggles/${id}/journal`), api(`/squiggles/${id}/events?n=60`)]);
  const feed = events.map(brief).filter(Boolean).slice(-30).reverse();
  $('#sheetBody').innerHTML = `
    <div class="shead"><div class="tile">${avatarSVG(p, undefined, 'sh_')}</div>
      <div><h2>${esc(s.name)}</h2><small>${esc(s.role)}</small><small>${esc(s.paused ? 'Paused' : STATUS_WORD[s.status] || 'Idle')}${s.note ? ` · ${esc(s.note)}` : ''}</small></div></div>
    <div class="actions" style="justify-content:flex-start">
      <button class="btn go" data-a="wake">Wake now</button><button class="btn" data-a="stop">Stop</button>
      <button class="btn" data-a="pause">${s.paused ? 'Resume' : 'Pause'}</button><button class="btn" data-a="meet">New meeting</button>
    </div>
    <div class="row2"><div><label>Name</label><input id="shName" value="${esc(s.name)}"></div><div><label>Role</label><input id="shRole" value="${esc(s.role)}"></div></div>
    <h3>Responsibility</h3><textarea id="shCharter">${esc(s.charter)}</textarea>
    <div class="row2">
      <div><label>Starts in</label><input id="shCwd" value="${esc(s.cwd)}"></div>
      <div><label>Wakes every (minutes, 0 = only when asked)</label><input id="shEvery" type="number" min="0" value="${esc(s.every || 0)}"></div>
    </div>
    <div class="row2">
      <div><label>Model</label><select id="shModel">${['', 'opus', 'sonnet', 'gpt-6.1-sol'].map((m) => `<option value="${m}" ${(s.model || '') === m ? 'selected' : ''}>${m ? modelName(m) : 'Default (Opus 5.5)'}</option>`).join('')}</select></div>
      <div><label>Permissions</label><select id="shPerm">${['auto', 'acceptEdits', 'plan', 'bypassPermissions'].map((m) => `<option ${s.permissionMode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
    </div>
    <div class="row2">
      <div><label>Browser</label><select id="shBrowser"><option value="">Off</option><option value="chrome" ${s.chrome ? 'selected' : ''}>Claude in Chrome</option></select></div>
    </div>
    <div class="row2">
      <div><label>Effort</label><select id="shEffort">${['', 'low', 'medium', 'high', 'xhigh', 'max'].map((m) => `<option value="${m}" ${(s.effort ?? '') === m ? 'selected' : ''}>${m || (s.lead ? 'Default' : 'medium (default)')}</option>`).join('')}</select></div>
      <div><label>Turns per wake</label><input id="shTurns" type="number" min="1" value="${esc(s.maxTurns ?? 40)}"></div>
    </div>
    <div class="row2">
      <div><label>Context cap (tokens before compacting)</label><input id="shCompact" type="number" min="20000" step="10000" value="${esc(s.autocompact ?? (s.lead ? 300000 : 200000))}"></div>
      <div><label>Look</label><div class="lookrow"><select id="shLook"><option value="">Automatic${p.gen === 'cast' ? ` (${esc(LOOKS[p.char])})` : ''}</option>${LOOKS.map((n) => `<option value="cast:${n}" ${s.look && p.opts.character === n ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="btn" data-a="shuffle" title="New colour, face, accessory, desk item and room">Shuffle</button></div></div>
    </div>
    <div class="row2">
      <div><label>Keep the Mac awake while working</label><select id="shAwake"><option value="">No</option><option value="1" ${s.awake ? 'selected' : ''}>Yes: display on, no sleep or lock</option></select></div><div></div>
    </div>
    <div class="actions">${s.lead ? '' : '<button class="btn danger" data-a="remove" style="margin-right:auto">Remove from the room</button>'}<button class="btn go" data-a="save">Save</button></div>
    <h3>Journal</h3><div class="journal">${esc(journal.slice(-3000))}</div>
    <h3>Recent activity</h3><div class="feed">${feed.map((f) => `<div>${f}</div>`).join('') || '<div>Nothing yet</div>'}</div>`;
  $('#sheetBody').onclick = async (e) => {
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'meet') return meetNowPop(e.target, id);
    if (a === 'wake') await api(`/squiggles/${id}/wake`, { why: 'Asked from the room' });
    if (a === 'stop') await api(`/squiggles/${id}/stop`, {});
    if (a === 'pause') Object.assign(S.sq[id], await api(`/squiggles/${id}/update`, { paused: !s.paused }));
    if (a === 'remove') {
      const b = e.target; if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = `Remove ${s.name}? Click again`; setTimeout(() => { b.classList.remove('arm'); b.textContent = 'Remove from the room'; }, 3000); return; }
      const res = await api(`/squiggles/${id}/remove`, {}); toast(typeof res === 'string' ? res : res.error); $('#sheet').classList.remove('on'); return;
    }
    if (a === 'shuffle') { await restyle(id, { lookSeed: Math.floor(Math.random() * 1e9) }); return openSheet(id); }
    if (a === 'save') Object.assign(S.sq[id], await api(`/squiggles/${id}/update`, { name: $('#shName').value.trim() || s.name, role: $('#shRole').value.trim() || s.role, charter: $('#shCharter').value, cwd: $('#shCwd').value, every: Number($('#shEvery').value) || 0, model: $('#shModel').value || undefined, permissionMode: $('#shPerm').value, effort: $('#shEffort').value || undefined, chrome: $('#shBrowser').value === 'chrome', awake: !!$('#shAwake').value, maxTurns: Number($('#shTurns').value) || 40, autocompact: Number($('#shCompact').value) || undefined }));
    paintTile(id); renderSummary(); $('#sheet').classList.remove('on');
  };
  $('#shLook').onchange = async (e) => { await restyle(id, { look: e.target.value }); openSheet(id); };
  $('#sheet').classList.add('on');
}
// Look changes apply at once: the server saves them, and the meta event redraws every copy of the avatar.
const restyle = (id, look) => api(`/squiggles/${id}/update`, look).then((r) => { Object.assign(S.sq[id], r); reskin(id); });
function reskin(id) {
  const p = P(id), t = tileOf(id);
  if (t) t.querySelector('svg').outerHTML = avatarSVG(p, undefined, 't' + p.gid + '_');
  const mini = document.querySelector(`#cw-${id} .tile.mini`); if (mini) mini.innerHTML = avatarSVG(p, undefined, 'cw' + p.gid + '_');
  if ($('#pcam').dataset.id === id) $('#pcam').dataset.id = '';
}
const TEMPLATES = {
  'Head of security': { role: 'Head of security', every: 240, charter: 'Own security across my repos and servers: dependency vulnerabilities, leaked secrets, exposed services, weak auth. Each wake, check one area, fix what is safe to fix, and report anything that needs a decision.' },
  'DevOps': { role: 'DevOps', every: 60, charter: 'Keep servers, deploys and backups healthy. Each wake, check service health, disk, backups and recent deploy failures. Fix routine problems; report anything risky before doing it.' },
  'Updates': { role: 'Keeps things current', every: 1440, charter: 'Keep dependencies, SDKs and toolchains current. Each wake, pick one repo, update what is safe, run its tests, and report what changed.' },
  'Patches': { role: 'Patches the fleet', every: 1440, charter: 'Apply OS and package security patches across the servers. Each wake, check what is pending, patch what is routine, and report anything needing a reboot or downtime.' },
};
function openNew() {
  $('#newForm').innerHTML = `<h2>New squiggle</h2>
    <div class="templates">${Object.keys(TEMPLATES).map((k) => `<button type="button" data-t="${esc(k)}">${esc(k)}</button>`).join('')}</div>
    <div class="row2"><div><label>Name</label><input id="nName" required placeholder="Sentinel"></div><div><label>Role</label><input id="nRole" required placeholder="Head of security"></div></div>
    <label>Responsibility</label><textarea id="nCharter" required placeholder="What it owns and what it should do on each wake."></textarea>
    <div class="row2"><div><label>Starts in (it can go anywhere in your home folder)</label><input id="nCwd" value="~"></div><div><label>Wakes every (minutes, 0 = only when asked)</label><input id="nEvery" type="number" min="0" value="60"></div></div>
    <div class="actions"><button type="button" class="btn" id="nCancel">Cancel</button><button class="btn go">Add to the room</button></div>`;
  $('#newForm').querySelector('.templates').onclick = (e) => { const t = TEMPLATES[e.target.dataset.t]; if (!t) return; $('#nRole').value = t.role; $('#nCharter').value = t.charter; $('#nEvery').value = t.every; if (!$('#nName').value) $('#nName').focus(); };
  $('#nCancel').onclick = () => $('#newSq').classList.remove('on');
  $('#newForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api('/squiggles', { name: $('#nName').value, role: $('#nRole').value, charter: $('#nCharter').value, cwd: $('#nCwd').value, every: $('#nEvery').value });
    if (r.error) return toast(r.error);
    $('#newSq').classList.remove('on'); await load(); AUD.join(); toast(`${r.name} joined the room`);
  };
  $('#newSq').classList.add('on'); $('#nName').focus();
  api('/defaults').then((d) => { if (d && !d.error) $('#nEvery').value = d.every; }); // team default cadence (t898)
}
for (const o of ['#sheet', '#newSq']) $(o).addEventListener('click', (e) => { if (e.target === $(o)) $(o).classList.remove('on'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#sheet').classList.remove('on'); $('#newSq').classList.remove('on'); $('#inboxBox').classList.remove('on'); } });

// =====================================================================
//  composer, mic, header controls, joining
// =====================================================================
const leadId = () => S.order.find((id) => S.sq[id].lead);
// Sound controls live in the Menu and in Settings; every copy carries data-snd and repaints from prefs (t914).
const snd = (k, f) => document.querySelectorAll(`[data-snd="${k}"]`).forEach(f);
const paintSound = () => {
  snd('station', (e) => { e.value = prefs.music ? prefs.station : 'off'; }); snd('musicVol', (e) => { e.value = prefs.musicVol; });
  snd('voice', (e) => { e.checked = !!prefs.voice; }); snd('chatter', (e) => { e.value = prefs.chatter; });
};
const sndSet = (fn) => (e) => { fn(e.target); savePrefs(); AUD.apply(); paintSound(); };
snd('station', (e) => { e.innerHTML = `<option value="off">Off</option>` + STATIONS.map(([v, n]) => `<option value="${v}">${n}</option>`).join(''); e.onchange = sndSet((t) => { prefs.music = t.value !== 'off'; if (prefs.music) prefs.station = t.value; }); });
snd('musicVol', (e) => { e.oninput = sndSet((t) => { prefs.musicVol = +t.value; }); });
snd('voice', (e) => { e.onchange = sndSet((t) => { prefs.voice = t.checked; }); });
snd('chatter', (e) => { e.onchange = sndSet((t) => { prefs.chatter = t.value; }); });
paintSound();
// Share on tailnet (tailscale serve): the toggle and its link in More. CLI: share on|off|status.
// Only Copy link shows (t837); the URL rides on the button.
// Tailnet sharing off in config: the Sharing tab (Sharing and Peers cards) is hidden.
function paintShare(st) { B.shareOff = !!st?.off; $('.settabs [data-stab="sharing"]').hidden = B.shareOff; if (B.shareOff && B.stab === 'sharing' && typeof paintSetTab === 'function') paintSetTab(); if (typeof loadPeers === 'function' && !B.shareOff && !!st?.on !== $('#shareOn').checked) loadPeers(); $('#shareOn').checked = !!st?.on; $('#shareCopy').hidden = !st?.on; $('#shareCopy').dataset.url = st?.url || ''; }
async function loadShare() { const r = await fetch('/api/share').then((x) => x.json()).catch(() => null); if (r && !r.error) paintShare(r); }
// Copy the tailnet link (t149). The clipboard API needs a secure page (localhost or https); otherwise copy through a selection.
$('#shareCopy').onclick = async (e) => {
  const b = e.currentTarget, url = b.dataset.url;
  try { await navigator.clipboard.writeText(url); } catch { const t = document.createElement('textarea'); t.value = url; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  b.textContent = 'Copied'; clearTimeout(b.t); b.t = setTimeout(() => (b.textContent = 'Copy link'), 1500);
};
$('#shareOn').onchange = async (e) => {
  const on = e.target.checked; e.target.disabled = true;
  const r = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) }).then((x) => x.json()).catch((er) => ({ error: er.message }));
  e.target.disabled = false;
  if (r.error) { toast(r.error); loadShare(); } else { paintShare(r); toast(r.on ? 'Shared on the tailnet' : 'No longer shared'); }
};
$('#newBtn').onclick = () => { closeMore(); openNew(); };
// More: secondary header controls behind a chevron so the tabs never overflow.
// Inbox (t135): parity with the CLI inbox. Text files in the data folder's inbox go to the lead when it's idle, then move to read/.
async function openInbox() {
  const r = await api('/inbox'); if (!r?.unread) return toast(r?.error || 'Inbox unavailable');
  const when = (f) => new Date(f.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const list = (fs, none) => fs.length ? `<ul style="margin:0;padding-left:18px">${fs.map((f) => `<li>${esc(f.name)} <span style="color:var(--dim)">${when(f)}</span></li>`).join('')}</ul>` : `<p style="margin:0;color:var(--dim)">${none}</p>`;
  $('#inboxBody').innerHTML = `<div style="display:flex;align-items:baseline;gap:12px"><h2 style="flex:1">Inbox</h2><button class="chip" data-a="close">Close</button></div>
    <p style="color:var(--dim)">Drop a text file in <code>${esc(r.dir || 'inbox')}</code>. The lead reads it when idle, then it moves to <code>read/</code>.</p>
    <h3>Waiting for the lead</h3>${list(r.unread, 'Nothing waiting.')}<h3>Read</h3>${list(r.read.slice(0, 20), 'Nothing yet.')}`;
  $('#inboxBox').classList.add('on');
}
$('#inboxBtn').onclick = () => { closeMore(); openInbox(); };
$('#settingsBtn').onclick = () => { closeMore(); setView('settings'); };
$('#inboxBox').onclick = (e) => { if (e.target.id === 'inboxBox' || e.target.dataset.a === 'close') $('#inboxBox').classList.remove('on'); };
const closeMore = () => { $('#morePanel').classList.remove('on'); $('#moreBtn').setAttribute('aria-expanded', 'false'); };
$('#moreBtn').onclick = (e) => { e.stopPropagation(); const on = $('#morePanel').classList.toggle('on'); $('#moreBtn').setAttribute('aria-expanded', String(on)); };
document.addEventListener('click', (e) => { if (!e.target.closest('.more')) closeMore(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMore(); });
// The office (setView('lead'|'one') in board.js): one squiggle alone on the stage, its chat docked beside it, nobody else speaks or shares.
// The Lead tab is the lead's office; clicking any other tile opens that squiggle's.
const oneOnOne = (id) => setView(S.sq[id]?.lead ? 'lead' : 'one', id);
// The office: one squiggle (or a meeting's attendees) alone with the user, everyone else quiet. who: an id or a list of ids.
function setOffice(who) {
  const prev = S.officeIds || [], ids = [].concat(who || []).filter((id) => S.sq[id]);
  S.officeIds = ids; S.office = ids.join(',');
  document.querySelectorAll('.tile.office,.cw.office').forEach((x) => x.classList.remove('office'));
  for (const id of prev) if (!ids.includes(id)) { const cw = document.getElementById('cw-' + id), p = winPos()[id]; if (cw && p) Object.assign(cw.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' }); }
  if (ids.length) {
    S.queue = S.queue.filter((q) => ids.includes(q.id));
    for (const id of [...S.speakers]) if (!ids.includes(id)) { stopTalk(id); S.src?.stop?.(); }
    hidePresent();
    // A meeting has one shared thread (t604), not a chat per attendee.
    for (const id of ids) { tileOf(id)?.classList.add('office'); if (!document.body.classList.contains('v-meet')) openChat(id)?.classList.add('office'); }
    $('#officeBack').textContent = `Back to the Room`;
  }
  syncPin(); layout(); layoutMeet();
}
// A meeting the user scheduled (Calendar) is on: chime, then the meeting view. null = it ended.
function meetingNow(m, live) {
  const same = m && S.meeting && S.meeting.key === m.key;
  S.meeting = m || null; paintMeet(); paintMeetOn();
  if (same) return;
  if (m && live) { AUD.ding(); toast(`Meeting now: ${m.title}`); notify(`Meeting now: ${m.title}`, meetWho(m), 'meeting'); setView('meeting'); }
  else if (!m) { if (live) toast('Meeting ended'); if (B.view === 'meeting') setView('room'); }
}
// A meeting on now, seen from anywhere but the meeting view: a bar with Join (t222).
function paintMeetOn() {
  const m = S.meeting, on = !!m && B.view !== 'meeting';
  $('#meetOn').classList.toggle('on', on); if (on) $('#meetOnT').textContent = `${m.title} is on now`;
}
$('#meetOnJoin').onclick = () => setView('meeting');
// Browser notifications (t148): about 5 minutes before and at the start, when the page is in the background. Clicking brings the room forward.
// Permission is asked on Join (a click). The Mac alerts (t147) cover the page being closed.
const meetWho = (m) => `${m.start.slice(11)} to ${m.end.slice(11)} with ${m.attendees.map((id) => S.sq[id]?.name || id).join(', ')}`;
function notify(title, body, view) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return null;
  const n = new Notification(title, { body, tag: title });
  n.onclick = () => { window.focus(); if (view) setView(view); n.close(); };
  return n;
}
function meetingSoon(m) {
  toast(`In 5 minutes: ${m.title}`);
  notify(`In 5 minutes: ${m.title}`, meetWho(m), 'calendar');
}
async function loadMeeting() {
  const r = await fetch('/api/meetings?days=1').then((x) => x.json()).catch(() => ({}));
  let was = ''; try { was = localStorage.agentsView; } catch {}
  // ?view=meeting: the Mac's Join alert (t147) opens the room straight on the meeting.
  const want = new URLSearchParams(URL0).get('view');
  meetingNow(r.current, false); if (r.current && (was === 'meeting' || want === 'meeting')) setView('meeting', '', 'replace');
}
function paintMeet() {
  const m = S.meeting; if (!m) return;
  const hm = (s) => String(s).slice(11, 16), names = m.attendees.map((id) => S.sq[id]?.name || id).join(', ');
  $('#meetTitle').textContent = m.title; $('#meetWhen').textContent = `${hm(m.start)} to ${hm(m.end)} with ${names}`;
  $('#meetAgenda').textContent = m.agenda || ''; $('#meetAgenda').hidden = !m.agenda;
  // Presenter turns: who has the floor, and Next hands it on (after the last, open questions).
  const pres = m.presenters || [], name = (id) => S.sq[id]?.name || id, on = pres[m.turn];
  $('#meetTurn').hidden = $('#meetNext').hidden = !pres.length;
  if (pres.length) {
    $('#meetTurn').textContent = on ? `Presenting: ${name(on)}, ${m.turn + 1} of ${pres.length}` : 'Everyone has presented. Open questions.';
    $('#meetNext').hidden = !on; $('#meetNext').textContent = pres[m.turn + 1] ? `Next: ${name(pres[m.turn + 1])}` : 'Done: open questions';
  }
  if (B.view === 'meeting') { if (S.present && S.present !== on) hidePresent(); if (meetOrder().join() !== S.officeIds.join()) setOffice(meetOrder()); else layoutMeet(); }
}
// The attendees, whoever has the floor first.
function meetOrder() { const m = S.meeting; if (!m) return []; const on = m.presenters?.[m.turn]; return (on ? [on, ...m.attendees.filter((x) => x !== on)] : m.attendees).filter((id) => S.sq[id]); }
$('#meetNext').onclick = async () => {
  const r = await fetch('/api/meetings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'next' }) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  if (r.error) toast(r.error);
};
$('#meetEnd').onclick = async () => {
  const r = await fetch('/api/meetings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'end' }) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  if (r.error) toast(r.error);
};
$('#meetBack').onclick = () => setView('room');
// Meeting view (t604): one shared thread under the meeting bar: every attendee's messages and the user's, in time order, one presenter at a time.
function layoutMeet() {
  if (!document.body.classList.contains('v-meet')) return;
  document.documentElement.style.setProperty('--mtt', $('#meetBar').getBoundingClientRect().bottom + 12 + 'px');
  queueThread();
}
new ResizeObserver(() => layoutMeet()).observe($('#meetBar'));
let threadQ = 0;
const queueThread = () => { if (!threadQ) threadQ = requestAnimationFrame(() => { threadQ = 0; paintThread(); }); };
// What the user sent to several attendees at once shows once, with who it went to.
function threadLines() {
  const m = S.meeting; if (!m) return [];
  const all = m.attendees.flatMap((id) => (S.hist[id] || []).filter((l) => l.ts >= m.at - 2000 && l.cls !== 'm sys').map((l) => ({ id, l }))).sort((a, b) => a.l.ts - b.l.ts), out = [];
  for (const x of all) {
    const dup = x.l.cls !== 'm lead' && out.slice(-4).find((o) => o.l.cls === x.l.cls && o.l.text === x.l.text && x.l.ts - o.l.ts < 10000);
    if (dup) dup.to.push(x.id); else out.push({ ...x, to: [x.id] });
  }
  return out;
}
const mname = (id) => S.sq[id]?.name || id;
function paintThread() {
  if (B.view !== 'meeting' || !S.meeting) return;
  const box = $('#meetThread .msgs'), on = presenter(), rows = threadLines();
  box.innerHTML = rows.length ? '' : `<div class="empty">${on ? `${esc(mname(on))} presents first. Everyone's messages show here.` : "Everyone's messages show here."}</div>`;
  for (const { id, l, to } of rows) {
    const d = document.createElement('div'); d.className = l.cls + (l.cls === 'm lead' && id === on ? ' pres' : '');
    if (l.cls === 'm lead') d.innerHTML = `<span class="spk">${esc(mname(id))}${id === on ? ', presenting' : ''}</span>` + l.html;
    else { if (l.html) d.innerHTML = l.html; else d.textContent = l.text; const t = document.createElement('span'); t.className = 'to'; t.textContent = `To ${to.map(mname).join(', ')}`; d.prepend(t); }
    box.appendChild(d);
  }
  linkTasks(box); if (box.pinned !== false) pinBottom(box);
  $('#meetThread textarea').placeholder = on ? `Message ${mname(on)}, or @name` : 'Message everyone, or @name';
}
// Who hears the user: anyone @named, else the presenter, else (no presenters, or open questions) every attendee.
function threadTo(text) {
  const m = S.meeting; if (!m) return [];
  const ids = m.attendees.filter((id) => S.sq[id]), at = (n) => new RegExp(`@${n.replace(/[^\w]/g, '')}\\b`, 'i');
  const named = ids.filter((id) => at(id).test(text) || at(S.sq[id].name).test(text));
  return named.length ? named : presenter() ? [presenter()] : ids;
}
{
  const f = $('#meetThread form'), ta = f.querySelector('textarea');
  pinChat($('#meetThread .msgs'));
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; };
  wireAttach(f, ta, $('#meetThread'));
  const send = async () => { const t = ta.value.trim(), images = takeImages(f); if (!t && !images.length) return; ta.value = ''; autosize(); paintMirror(ta); mentionClose(); pinBottom($('#meetThread .msgs')); for (const id of threadTo(t)) await api(`/squiggles/${id}/send`, { text: t, images, from: 'owner', human: me().id }); };
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  f.onsubmit = (e) => { e.preventDefault(); send(); };
}
addEventListener('resize', () => layoutMeet());
$('#officeBack').onclick = () => setView('room');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.office && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector('.overlay.on')) setView('room'); });
function renderJoinCast() { $('#joinCast').innerHTML = S.order.slice(0, 5).map((id, i) => `<div class="tile">${avatarSVG(P(id), undefined, 'j' + i + '_')}</div>`).join(''); }
// Lock: back to the splash with all sound stopped. The team keeps working; joining again picks up where it was.
function lock(why = '') {
  if (!S.joined) return;
  if (PASS.set) { fetch('/api/passcode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"op":"lock"}' }).finally(() => location.reload()); return; }
  S.joined = false; S.queue.length = 0;
  for (const id of [...S.speakers]) stopTalk(id);
  if (AUD.ctx) AUD.ctx.suspend();
  if (RADIO.el) { RADIO.el.pause(); RADIO.cur = null; }
  const working = S.order.filter((id) => S.sq[id].status === 'working').length;
  $('#lockNote').textContent = (why ? why + ' ' : '') + (working ? `${working} still working.` : 'Everyone is idle.');
  renderJoinCast(); $('#join').classList.add('on'); document.body.classList.add('locked');
}
$('#lockBtn').onclick = () => lock();
// Quit (t1154) asks first, and with turns running offers to wait for them.
$('#quitBtn').onclick = () => {
  const n = S.order.filter((id) => S.sq[id].status === 'working').length, a = $('#quitAsk');
  a.innerHTML = n ? `<p>${n} working. Quit when they finish, or stop them now?</p><button class="chip primary" data-q="wait">Quit when they finish</button><button class="chip" data-q="now">Quit now</button><button class="chip" data-q="no">Cancel</button>`
    : '<p>Stop every squiggle and the server? Open Squiggles to start again.</p><button class="chip" data-q="now">Quit</button><button class="chip" data-q="no">Cancel</button>';
  a.hidden = false; a.querySelector('.primary')?.focus(); // the safe choice is the default (t1154)
};
$('#quitAsk').onclick = async (e) => {
  const q = e.target.dataset?.q; if (!q) return; $('#quitAsk').hidden = true; if (q === 'no') return;
  const r = await api('/quit', { now: q === 'now' }).catch(() => null); if (r?.error) return toast(r.error);
  if (typeof r === 'string') toast(r[0].toUpperCase() + r.slice(1));
};
let lastActive = Date.now();
for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, () => (lastActive = Date.now()), { passive: true });
setInterval(() => { if (S.joined && Date.now() - lastActive > 10 * 60000) lock('Locked after 10 minutes away.'); }, 30000);
$('#joinBtn').onclick = () => {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  const rejoin = !!AUD.ctx; lastActive = Date.now();
  AUD.init(); S.joined = true; $('#join').classList.remove('on'); document.body.classList.remove('locked'); AUD.join();
  if (rejoin) { S.spokeAt = performance.now(); AUD.apply(); return focusOffice(true); }
  const lead = leadId(), chat = new URLSearchParams(URL0).get('chat');
  // On phone the lead's chat would cover the room; its unread count sits on the Lead tab instead (t352).
  if (lead) { if (!PHONE.matches) openChat(lead); say(lead, pick(['Hey. Everyone’s here.', `${(h => h < 5 ? 'Late one' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening')(new Date().getHours())}. The team is in.`, 'Hi. We’re all set up.']), { priority: true }); }
  if (S.sq[chat]) openChat(chat);
  focusOffice(true);
};
document.addEventListener('keydown', (e) => { if (e.key === '/' && S.joined && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); const l = leadId(); if (l) openChat(l); } });

// With a passcode set and no session, the splash asks for it; unlocking reloads into the room.
async function passGate() {
  Object.assign(PASS, await fetch('/api/passcode').then((r) => r.json()).catch(() => ({})));
  if (!PASS.set || PASS.ok) return;
  $('#joinBtn').hidden = true; $('#passForm').hidden = false; $('#lockNote').textContent = 'Enter the passcode.'; $('#passIn').focus();
  $('#passForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/passcode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'unlock', code: $('#passIn').value }) }).then((x) => x.json()).catch(() => ({ error: 'no connection' }));
    if (r.error) { $('#passErr').textContent = r.error[0].toUpperCase() + r.error.slice(1) + '.'; $('#passIn').select(); return; }
    location.reload();
  };
  await new Promise(() => {});
}
GATE.then(() => load()).then(() => { listen(); loadMeeting(); loadShare(); fetch('/api/config').then((x) => x.json()).then((c) => { $('#callBar').hidden = !c.call; }).catch(() => {});
  // A view restored before the room loaded (URL or last view) gets its office now.
  if (B.view === 'lead') setOffice(leadId()); else if (B.view === 'one') { if (S.sq[B.who]) setOffice(B.who); else setView('room', '', 'replace'); } else if (S.office) setOffice(S.officeIds); });
