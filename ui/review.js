// Review: picks, asks, watches and blocked squiggles live at the top of the Review tab (branches below), never in a chat.
// A chat shows one line: how many wait, and a button to Review. Every item names its squiggle (opens the 1:1) and links its task. CLI: needs, picks, asks, merges; room view review.
const RV = { blocked: [], alerts: [], watches: [] };
const rvWho = (id) => S.sq[id]?.name || id;
// What a chat's line counts: the lead's chat counts everything, a 1:1 only what that squiggle filed.
function rvWaiting(id) {
  const lead = S.sq[id]?.lead, mine = (x) => lead || x.by === id;
  return { picks: PICK.list.filter(mine).length, asks: ASK.list.filter(mine).length, watches: RV.watches.filter(mine).length };
}
function paintWaitBar(cw) {
  const { picks, asks, watches } = rvWaiting(cw.dataset.id), n = picks + asks + watches;
  let el = cw.querySelector(':scope > .waitbar');
  if (!n) return el?.remove();
  if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'waitbar'; cw.querySelector(':scope > .act')?.before(el); }
  const parts = [picks && `${picks} pick${picks > 1 ? 's' : ''}`, asks && `${asks} ask${asks > 1 ? 's' : ''}`, watches && `${watches} watch${watches > 1 ? 'es' : ''}`].filter(Boolean).join(', ');
  const html = `<span>${n} waiting for you: ${parts}</span><b>Review</b>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
const watchEvery = (w) => `every ${Math.round(w.every / 6e4)} min${w.timeout ? `, up to ${Math.round(w.timeout / 6e4) || 1} min a run` : ''}`;
function watchCard(w) {
  const who = esc(rvWho(w.by));
  return `<div class="ask" data-id="${esc(w.id)}">
    <div class="askh"><button class="rvwho" type="button" data-one="${esc(w.by)}" title="Open ${who}'s 1:1">${who}</button> asks to run this by itself <small>${esc(w.id)}, ${esc(watchEvery(w))}${w.added ? ', wakes on new lines only' : ''}${w.task ? `, ${esc(w.task)}` : ''}</small></div>
    ${w.why ? `<p class="askwhy">${esc(w.why)}</p>` : ''}
    ${watchBody(w)}
    ${w.runsFor ? `<p class="asknote">Runs for ${esc(w.runsFor)}: output reaches a non-Claude model.</p>` : ''}
    <div class="askb">${ASK.can.run || ASK.can.local ? `<button class="chip primary" type="button" data-wa="approve" data-w="${esc(w.id)}">Approve</button>` : '<span class="asknote">Approve works only on the computer running the room.</span>'}<button class="chip" type="button" data-wa="drop" data-w="${esc(w.id)}">Drop</button></div>
  </div>`;
}
function paintReview() {
  const box = $('#rv'); if (!box) return;
  const p = PICK.list, a = ASK.list, ran = ASK.recent.slice(-5), bl = RV.blocked, al = RV.alerts, wa = RV.watches;
  const sec = (title, body) => `<section class="rvs"><h3>${title}</h3>${body}</section>`;
  const row = (by, text) => `<div class="rvb"><p><button class="rvwho" type="button" data-one="${esc(by)}" title="Open ${esc(rvWho(by))}'s 1:1">${esc(rvWho(by))}</button>: ${esc(String(text || '').split('\n')[0])}</p><button class="chip" type="button" data-one="${esc(by)}">Open 1:1</button></div>`;
  // Commands and watches act only on the room's computer: elsewhere they fold to one line, so branches stay in view.
  const cmds = a.length ? sec(`${a.length} command${a.length > 1 ? 's' : ''} to run`, a.map(askCard).join('')) : '';
  const watches = wa.length ? sec(`${wa.length} watch${wa.length > 1 ? 'es' : ''} to approve`, wa.map(watchCard).join('')) : '';
  const counts = [a.length && `${a.length} command${a.length > 1 ? 's' : ''}`, wa.length && `${wa.length} watch${wa.length > 1 ? 'es' : ''}`].filter(Boolean).join(', ');
  // Serious alerts its squiggle hasn't fixed in 2 hours lead the list.
  const html = (al.length ? sec(`${al.length} serious alert${al.length > 1 ? 's' : ''} open over 2 hours`, al.map((x) => row(x.by, `${x.text} (${x.id})`)).join('')) : '')
    + (p.length ? sec(`${p.length} pick${p.length > 1 ? 's' : ''}`, `<div class="picks">${pickCard(p)}</div>`) : '')
    + (!offHost() ? cmds + watches : counts ? `<details class="rvs rvhost"><summary>${counts} for the computer running the room</summary>${cmds}${watches}</details>` : '')
    + (bl.length ? sec(`${bl.length} blocked`, bl.map((s) => row(s.id, s.text)).join('')) : '')
    + (!al.length && !p.length && !a.length && !wa.length && !bl.length ? '<p class="rvnone">No alerts, picks, asks, watches or blocked squiggles.</p>' : '')
    + (ran.length ? `<details class="rvs rvran"><summary>Ran today (${ran.length})</summary>${ran.map(askDone).join('')}</details>` : '');
  if (box.dataset.html !== html) { const open = ['.rvran', '.rvhost'].filter((s) => box.querySelector(s)?.open); box.innerHTML = html; box.dataset.html = html; open.forEach((s) => { const d = box.querySelector(s); if (d) d.open = true; }); window.linkTasks?.(box); }
  const n = al.length + p.length + a.length + wa.length;
  document.querySelectorAll('[data-view="merge"]').forEach((b) => { b.innerHTML = `Review${n ? ` <b class="tn">${n}</b>` : ''}`; });
}
function paintApprovals() { paintReview(); document.querySelectorAll('.cw').forEach(paintWaitBar); }
async function loadBlocked() {
  const l = await api('/needs').catch(() => null); if (!Array.isArray(l)) return;
  RV.blocked = l.filter((n) => n.kind === 'blocked'); RV.alerts = l.filter((n) => n.kind === 'alert'); RV.watches = l.filter((n) => n.kind === 'watch'); paintApprovals();
}
// Same approve and drop calls as the Team card; the server re-checks the hash this card showed.
async function watchAct(b) {
  const w = RV.watches.find((x) => x.id === b.dataset.w); if (!w) return;
  const pre = `<pre class="askcmd"><code>${showCmd(w.cmd).html}</code></pre>`;
  if (b.dataset.wa === 'drop') {
    if (!await askCode(`Drop ${w.id}?`, `<p>It never runs.</p>${pre}`, 'Drop', null)) return;
    const r = await unlocked(() => api('/watches', { op: 'drop', id: w.id }), 'Unlock to drop'); if (r === null) return;
    if (!r?.error) loadBlocked();
    return toast(r?.error || `Dropped ${w.id}`);
  }
  if (!await askCode(`Approve ${w.id}?`, `<p>Runs by itself ${esc(watchEvery(w))}, as you, until dropped. ${esc(rvWho(w.by))} wakes when the output changes. Nothing else checks that it only reads: read it first.</p>${pre}`, 'Approve', null)) return;
  const r = await unlocked(() => api('/watches', { op: 'approve', id: w.id, hash: w.hash }), 'Unlock to approve'); if (r === null) return;
  if (!r?.error) loadBlocked();
  toast(r?.error || `Approved ${w.id}`);
}
document.addEventListener('click', (e) => {
  const wb = e.target.closest('#mergeView [data-wa]'); if (wb) return watchAct(wb);
  if (e.target.closest('.waitbar')) return setView('merge');
  const o = e.target.closest('#mergeView [data-one]'); if (o) { e.stopPropagation(); oneOnOne(o.dataset.one); }
});
loadBlocked(); setInterval(loadBlocked, 20000);
paintApprovals();
