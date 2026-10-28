// Needs you: on a phone, one list at the top of the Lead chat with everything waiting on the user (asks, picks,
// shipped merges, blocked squiggles), each acted on in one tap. Rule in needs.mjs, served at /api/needs. CLI: needs.
(() => {
  const N = { list: null, open: localStorage.needsOpen !== '0' }, who = (id) => S.sq[id]?.name || id;
  const leadCw = () => document.querySelector('.cw.lead');
  const btn = (a, label, primary) => `<button class="chip${primary ? ' primary' : ''}" type="button" data-n="${esc(a)}">${esc(label)}</button>`;
  function item(n) {
    const line = String(n.text || '').split('\n')[0];
    if (n.kind === 'ask') return [`Run · ${who(n.by)}${n.cwd ? ` · in ${n.cwd.replace(/^\/(Users|home)\/[^/]+/, '~')}` : ''}`, line,
      (ASK.can.run || ASK.can.local ? btn('run', 'Run', true) : '') + btn('deny', 'Deny') + btn('show', 'Show command')];
    if (n.kind === 'pick') return [`Pick · ${who(n.by)}${n.task ? ` · ${n.task}` : ''}`, line, n.options.map((o, i) => btn(`opt:${i + 1}`, o)).join('')];
    if (n.kind === 'merge') return [`Merge · ${who(n.by)} · ${String(n.repo || '').split('/').pop()}`, line, btn('merge', 'Merge', true) + btn('diff', 'See change')];
    return [`Blocked · ${who(n.id)}`, line, btn('open', 'Open 1:1')];
  }
  function paint() {
    const cw = leadCw(); if (!cw) return;
    let el = cw.querySelector(':scope > .needs');
    const ok = Array.isArray(N.list); cw.classList.toggle('hasneeds', ok);
    if (!ok || !N.list.length) return el?.remove();
    if (!el) { el = document.createElement('div'); el.className = 'needs'; cw.querySelector(':scope > .msgs')?.before(el); }
    const html = `<button class="ndh" type="button" aria-expanded="${N.open}"><span>Needs you</span><b>${N.list.length}</b></button>${N.open ? `<div class="ndl">${N.list.map((n) => {
      const [k, t, b] = item(n);
      return `<div class="nd" data-kind="${n.kind}" data-id="${esc(n.id)}"><small>${esc(k)}</small><p>${esc(t)}</p><div class="ndb">${b}</div></div>`;
    }).join('')}</div>` : ''}`;
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  }
  async function load() {
    const l = await api('/needs').catch(() => null);
    N.list = Array.isArray(l) ? l : null; paint();
  }
  // The stream's ask card owns Run and Deny (it confirms with the exact command and binds the hash), so tap that one.
  const streamAsk = (id) => leadCw()?.querySelector(`.msgs > .ask[data-id="${CSS.escape(id)}"]`);
  document.addEventListener('click', async (e) => {
    if (e.target.closest('.needs .ndh')) { N.open = !N.open; localStorage.needsOpen = N.open ? '1' : '0'; return paint(); }
    const b = e.target.closest('.needs .ndb button'); if (!b) return;
    const row = b.closest('.nd'), id = row.dataset.id, n = N.list?.find((x) => x.id === id && x.kind === row.dataset.kind), a = b.dataset.n; if (!n) return;
    if (n.kind === 'ask') {
      const card = streamAsk(id); if (!card) return toast('That ask is no longer waiting');
      if (a === 'show') return card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.querySelector(`.askb button[data-a="${a}"]`)?.click(); return setTimeout(load, 1500);
    }
    if (n.kind === 'pick') {
      row.querySelectorAll('button').forEach((x) => (x.disabled = true));
      const r = await unlocked(() => pickPost({ op: 'pick', id, option: a.slice(4) }), 'Unlock to answer');
      if (r?.error) toast(r.error); else if (r) toast(`${who(n.by)} hears: ${r.answer}`);
      loadPicks(); return load();
    }
    if (n.kind === 'merge') {
      const m = { id, repo: n.repo, branch: n.branch, base: n.base };
      if (a === 'diff') { if (!B.mloaded) B.merges = [m]; return openDiff(id); }
      if (await mergeBranch(m, b)) load();
      return;
    }
    oneOnOne(id);
  });
  load(); setInterval(load, 20000);
  new MutationObserver(paint).observe($('#chats'), { childList: true });
})();
