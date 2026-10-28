// Keyboard shortcuts. One table for the ? overlay and `agents.mjs room keys`, so they can't drift.
// Single keys only fire outside text fields and popups; Esc and the chat keys are handled where they live.
const KEYS = [
  ['Get around', [
    ['1–9', 'Tabs, in nav order'],
    [',', 'Settings'],
    ['⌘ K', 'Jump to a squiggle: Enter opens its 1:1, ⌘ Enter its chat'],
    ['[ ]', 'Previous / next squiggle, in a 1:1'],
    ['Alt ↑ ↓', 'Previous / next squiggle, in a 1:1, even while typing'],
    ['/', 'Chat with the lead'],
    ['Esc', 'Close a popup or sheet; clear a list highlight; leave a 1:1'],
  ]],
  ['Act', [
    ['c', 'Chat box of the open 1:1, else the front chat window'],
    ['n', 'New: note on Tasks, goal on Goals, meeting on Calendar'],
    ['m', 'More menu'],
    ['L', 'Lock the room'],
  ]],
  ['Lists', [
    ['j k', 'Move the highlight on Tasks, Merge and Team (↑ ↓ in Team\'s search)'],
    ['Enter', 'Open the highlighted item'],
    ['d', 'Diff of the highlighted Merge row'],
  ]],
  ['Chat', [
    ['Enter', 'Send'],
    ['Shift Enter', 'New line'],
    ['@', 'Mention: ↑ ↓ to pick, Enter or Tab to insert'],
    ['Esc', 'Minimise the chat window'],
  ]],
  ['Help', [
    ['?', 'This list'],
  ]],
];
if (typeof module === 'object') module.exports = { KEYS };

if (typeof document === 'object') {
  const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent), mod = (e) => (mac ? e.metaKey : e.ctrlKey);
  const label = (k) => (mac ? k : k.replace(/⌘/g, 'Ctrl'));
  const typing = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const help = () => document.getElementById('keysBox'), jump = () => document.getElementById('jumpBox');
  function openKeys() {
    if (document.body.classList.contains('locked')) return;
    help().querySelector('.panel').innerHTML = `<div style="display:flex;align-items:baseline;gap:12px"><h2 style="flex:1">Keyboard shortcuts</h2><button class="chip" data-a="close">Close</button></div>`
      + KEYS.map(([g, rows]) => `<h3>${g}</h3><dl class="keys">${rows.map(([k, w]) => `<dt>${label(k).split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</dt><dd>${label(w)}</dd>`).join('')}</dl>`).join('');
    help().classList.add('on');
  }
  const closeKeys = () => help().classList.remove('on');
  document.addEventListener('click', (e) => { if (e.target === help() || (e.target.dataset?.a === 'close' && help().contains(e.target))) closeKeys(); });
  const step = (d) => {
    const ids = Object.keys(S.sq), i = ids.indexOf(S.officeIds?.[0]);
    if (i >= 0) oneOnOne(ids[(i + d + ids.length) % ids.length]);
  };

  // ⌘K: jump to a squiggle by name, id or role. Enter opens its 1:1, ⌘Enter its chat window.
  let jsel = 0;
  const matches = () => {
    const q = jump().querySelector('input').value.trim().toLowerCase();
    return Object.entries(S.sq).filter(([id, s]) => !q || [s.name, id, s.role].some((x) => String(x || '').toLowerCase().includes(q)))
      .sort(([, a], [, b]) => (q && b.name.toLowerCase().startsWith(q)) - (q && a.name.toLowerCase().startsWith(q)));
  };
  function paintJump() {
    const list = matches(); jsel = Math.max(0, Math.min(jsel, list.length - 1));
    jump().querySelector('ul').innerHTML = list.length ? list.map(([id, s], i) => `<li data-id="${esc(id)}" class="${i === jsel ? 'on' : ''}"><b>${esc(s.name)}</b> <span>${esc(s.role || '')}</span></li>`).join('') : '<li class="none">No squiggle by that name</li>';
    jump().querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
  }
  function openJump() {
    if (document.body.classList.contains('locked')) return;
    const i = jump().querySelector('input'); i.value = ''; jsel = 0; paintJump(); jump().classList.add('on'); i.focus();
  }
  const closeJump = () => jump().classList.remove('on');
  const go = (id, chat) => { closeJump(); if (!S.sq[id]) return; if (chat) openChat(id); else oneOnOne(id); };
  jump().querySelector('input').addEventListener('input', () => { jsel = 0; paintJump(); });
  jump().querySelector('input').addEventListener('keydown', (e) => {
    const list = matches();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); jsel = (jsel + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % (list.length || 1); paintJump(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[jsel]) go(list[jsel][0], mod(e)); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeJump(); }
  });
  jump().addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) go(li.dataset.id, mod(e)); else if (e.target === jump()) closeJump(); });

  // j/k lists: the highlight is kept by id, so it survives a refresh of the list; a mouse click clears it.
  const LISTS = { tasks: ['#corkcols', '.note[data-task]', 'task'], merge: ['#mergeView', 'tr.mrow[data-merge]', 'merge'], team: ['#teamList', '.tm[data-sq]', 'sq'] };
  let ksel = null; // { view, id }
  const rows = () => { const l = LISTS[B.view]; return l ? [...document.querySelectorAll(`${l[0]} ${l[1]}`)].filter((x) => x.offsetParent) : []; };
  const selEl = () => { const l = ksel && LISTS[ksel.view]; return l && ksel.view === B.view ? [...document.querySelectorAll(`${l[0]} ${l[1]}`)].find((x) => x.dataset[l[2]] === ksel.id) : null; };
  const paintSel = () => { document.querySelectorAll('.ksel').forEach((x) => x.classList.remove('ksel')); selEl()?.classList.add('ksel'); };
  const moveSel = (d) => {
    const r = rows(); if (!r.length) return;
    const i = r.indexOf(selEl()), n = i < 0 ? (d > 0 ? 0 : r.length - 1) : Math.max(0, Math.min(r.length - 1, i + d));
    ksel = { view: B.view, id: r[n].dataset[LISTS[B.view][2]] }; paintSel(); r[n].scrollIntoView({ block: 'nearest' });
  };
  const clearSel = () => { if (!ksel) return false; ksel = null; paintSel(); return true; };
  for (const [sel] of Object.values(LISTS)) { const el = document.querySelector(sel); if (el) new MutationObserver(() => { if (ksel && !selEl()?.classList.contains('ksel')) paintSel(); }).observe(el, { childList: true, subtree: true }); }
  document.addEventListener('mousedown', clearSel, true);
  // Team opens with its search focused: there ↑ ↓ move the highlight and Enter opens it, so the list stays reachable.
  document.getElementById('teamq')?.addEventListener('keydown', (e) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Enter' && selEl()) { e.preventDefault(); selEl().click(); }
  });

  document.addEventListener('keydown', (e) => {
    document.body.classList.add('kb'); // a hardware keyboard: show Shortcuts in More on phones too
    if (e.isComposing || !S.joined || document.body.classList.contains('locked')) return;
    const k = e.key, office = B.view === 'one' || B.view === 'lead';
    if (mod(e) && !e.altKey && !e.shiftKey && k.toLowerCase() === 'k') { e.preventDefault(); return jump().classList.contains('on') ? closeJump() : openJump(); }
    if (e.altKey && !e.metaKey && !e.ctrlKey && (k === 'ArrowUp' || k === 'ArrowDown') && office && !jump().classList.contains('on')) { e.preventDefault(); return step(k === 'ArrowDown' ? 1 : -1); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing(document.activeElement)) return;
    if (help().classList.contains('on')) { if (k === '?' || k === 'Escape') { e.preventDefault(); closeKeys(); } return; }
    if (document.querySelector('.overlay.on, .pop.on, #morePanel.on')) return;
    if (B.view !== ksel?.view) ksel = null;
    const tabs = [...document.querySelectorAll('.tabs button[data-view]')];
    let act;
    if (/^[1-9]$/.test(k) && tabs[k - 1]) act = () => tabs[k - 1].click();
    else if (k === ',') act = () => setView('settings');
    else if ((k === '[' || k === ']') && office) act = () => step(k === ']' ? 1 : -1);
    else if (k === 'c') act = () => {
      const ta = document.querySelector(`#cw-${S.officeIds?.[0]} textarea`) || [...document.querySelectorAll('.cw:not(.min) textarea')].sort((a, b) => (+getComputedStyle(b.closest('.cw')).zIndex || 0) - (+getComputedStyle(a.closest('.cw')).zIndex || 0))[0];
      ta?.focus();
    };
    else if (k === 'n') act = { tasks: () => document.querySelector('#tasksView [data-addnote]')?.click(), goals: () => document.querySelector('#wbcols [data-addgoal]')?.click(), calendar: () => document.getElementById('calAdd').click() }[B.view];
    else if (k === 'm') act = () => document.getElementById('moreBtn').click();
    else if (k === 'l' || k === 'L') act = () => lock();
    else if ((k === 'j' || k === 'k') && LISTS[B.view]) act = () => moveSel(k === 'j' ? 1 : -1);
    else if (k === 'Enter' && selEl()) act = () => selEl().click();
    else if (k === 'd' && B.view === 'merge' && selEl()) act = () => openDiff(ksel.id);
    else if (k === 'Escape' && ksel) act = clearSel;
    else if (k === '?') act = openKeys;
    if (act) { e.preventDefault(); if (k === 'Escape') e.stopImmediatePropagation(); act(); }
  });

  // Tooltips name the key: "Tasks (6)", "Settings (,)", "More (m)". Desktop only.
  if (matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.tabs button[data-view]').forEach((b, i) => { if (i < 9) b.title = `${b.textContent.trim()} (${i + 1})${b.title ? `\n${b.title}` : ''}`; });
    document.getElementById('settingsBtn').title = 'Settings (,)';
    document.getElementById('moreBtn').title = 'More (m)';
  }
  window.openKeys = openKeys; // room view keys
  window.openJump = openJump; // room view jump
  document.getElementById('keysBtn').onclick = () => { closeMore(); openKeys(); };
}
