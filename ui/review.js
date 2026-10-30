// Review: picks, asks and blocked squiggles live at the top of the Review tab (branches below), never in a chat.
// A chat shows one line: how many wait, and a button to Review. Every item names its squiggle (opens the 1:1) and links its task. CLI: needs, picks, asks, merges; room view review.
const RV = { blocked: [] };
const rvWho = (id) => S.sq[id]?.name || id;
// What a chat's line counts: the lead's chat counts everything, a 1:1 only what that squiggle filed.
function rvWaiting(id) {
  const lead = S.sq[id]?.lead, mine = (x) => lead || x.by === id;
  return { picks: PICK.list.filter(mine).length, asks: ASK.list.filter(mine).length };
}
function paintWaitBar(cw) {
  const { picks, asks } = rvWaiting(cw.dataset.id), n = picks + asks;
  let el = cw.querySelector(':scope > .waitbar');
  if (!n) return el?.remove();
  if (!el) { el = document.createElement('button'); el.type = 'button'; el.className = 'waitbar'; cw.querySelector(':scope > .act')?.before(el); }
  const parts = [picks && `${picks} pick${picks > 1 ? 's' : ''}`, asks && `${asks} ask${asks > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  const html = `<span>${n} waiting for you: ${parts}</span><b>Review</b>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
function paintReview() {
  const box = $('#rv'); if (!box) return;
  const p = PICK.list, a = ASK.list, ran = ASK.recent.slice(-5), bl = RV.blocked;
  const sec = (title, body) => `<section class="rvs"><h3>${title}</h3>${body}</section>`;
  const html = (p.length ? sec(`${p.length} pick${p.length > 1 ? 's' : ''}`, `<div class="picks">${pickCard(p)}</div>`) : '')
    + (a.length ? sec(`${a.length} command${a.length > 1 ? 's' : ''} to run`, a.map(askCard).join('')) : '')
    + (bl.length ? sec(`${bl.length} blocked`, bl.map((s) => `<div class="rvb"><p><button class="rvwho" type="button" data-one="${esc(s.id)}" title="Open ${esc(rvWho(s.id))}'s 1:1">${esc(rvWho(s.id))}</button>: ${esc(String(s.text || '').split('\n')[0])}</p><button class="chip" type="button" data-one="${esc(s.id)}">Open 1:1</button></div>`).join('')) : '')
    + (!p.length && !a.length && !bl.length ? '<p class="rvnone">No picks, asks or blocked squiggles.</p>' : '')
    + (ran.length ? `<details class="rvs rvran"><summary>Ran today (${ran.length})</summary>${ran.map(askDone).join('')}</details>` : '');
  if (box.dataset.html !== html) { const open = box.querySelector('.rvran')?.open; box.innerHTML = html; box.dataset.html = html; if (open) box.querySelector('.rvran').open = true; window.linkTasks?.(box); }
  const n = p.length + a.length;
  document.querySelectorAll('[data-view="merge"]').forEach((b) => { b.innerHTML = `Review${n ? ` <b class="tn">${n}</b>` : ''}`; });
}
function paintApprovals() { paintReview(); document.querySelectorAll('.cw').forEach(paintWaitBar); }
async function loadBlocked() {
  const l = await api('/needs').catch(() => null); if (!Array.isArray(l)) return;
  RV.blocked = l.filter((n) => n.kind === 'blocked'); paintReview();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('.waitbar')) return setView('merge');
  const o = e.target.closest('#mergeView [data-one]'); if (o) { e.stopPropagation(); oneOnOne(o.dataset.one); }
});
loadBlocked(); setInterval(loadBlocked, 20000);
paintApprovals();
