// Picks: every question waiting on the owner's choice, in one card above the lead chat's composer (a 1:1 shows its
// own). Options are buttons, with the image when it's one of ours (fileUrl). CLI: picks, pick ask|drop, pick <id> <option>.
const PICK = { list: [] };
const pickWho = (id) => S.sq[id]?.name || id;
function pickCard(list) {
  return `<div class="pickh">${list.length === 1 ? 'A pick waits on you' : `${list.length} picks wait on you`}</div>${list.map((p) => `
    <div class="pick" data-id="${esc(p.id)}"><p class="pickq"><b>${esc(pickWho(p.by))}</b>: ${esc(p.question)}${p.task ? ` <small>${esc(p.task)}</small>` : ''}</p>
      <div class="picko${p.options.some((o) => o.image && fileUrl(o.image)) ? ' img' : ''}">${p.options.map((o, i) => {
        const u = o.image && fileUrl(o.image);
        return `<button class="chip" data-n="${i + 1}" title="${esc(o.label)}">${u ? `<img src="${esc(u)}" alt="" loading="lazy">` : ''}<span>${esc(o.label)}</span></button>`;
      }).join('')}</div></div>`).join('')}`;
}
function paintPicks(cw) {
  const id = cw.dataset.id, lead = S.sq[id]?.lead, list = PICK.list.filter((p) => lead || p.by === id);
  let el = cw.querySelector(':scope > .picks');
  if (!list.length) return el?.remove();
  if (!el) { el = document.createElement('div'); el.className = 'picks'; cw.querySelector(':scope > .act')?.before(el); }
  const html = pickCard(list); if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}
async function loadPicks() {
  const list = await api('/picks').catch(() => null); if (!Array.isArray(list)) return;
  PICK.list = list; document.querySelectorAll('.cw').forEach(paintPicks);
}
const pickPost = (b) => fetch('/api/picks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({ error: 'Request failed' }));
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.picks .picko button'); if (!btn) return;
  const id = btn.closest('.pick').dataset.id, p = PICK.list.find((x) => x.id === id); if (!p) return;
  btn.closest('.picko').querySelectorAll('button').forEach((b) => (b.disabled = true));
  const r = await unlocked(() => pickPost({ op: 'pick', id, option: btn.dataset.n }), 'Unlock to answer');
  if (r?.error) toast(r.error); else if (r) toast(`${pickWho(p.by)} hears: ${r.answer}`);
  loadPicks();
});
loadPicks();
