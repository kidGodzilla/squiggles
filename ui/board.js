// Goals (whiteboard) and Tasks (cork board), each in its own tab. Shares state with room.js (S, api, esc, avatarSVG, openChat).
const B = { goals: { active: [], hold: [], todo: [], done: [] }, tasks: [], fresh: new Set(), seen: false, view: 'room',
  gq: '', tq: '', tgoal: '', towner: '', tshow: 'open', tidy: (() => { try { return localStorage.agentsTidy !== '0'; } catch { return true; } })() };
const TIER_NAMES = { active: 'Active', hold: 'On hold', todo: 'Next up', done: 'Done' };
const COLS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['blocked', 'Blocked'], ['done', 'Done']];
const STALE_DAYS = 7;

const daysSince = (d) => (d ? Math.floor((Date.now() - Date.parse(d + 'T12:00:00')) / 864e5) : 0);
const ago = (d) => { const n = daysSince(d); return n <= 0 ? 'today' : n < 14 ? `${n}d` : `${Math.round(n / 7)}w`; };
const allGoals = () => Object.values(B.goals).flat();
const goalById = (id) => allGoals().find((g) => g.id === id);
const colorOf = (goal) => { if (!goal) return 0; const i = allGoals().findIndex((g) => g.id === goal); return i < 0 ? (hash(goal) >>> 7) % 6 : (i % 5) + 1; };
const rot = (id) => (((hash(id) >>> 5) % 7) - 3) * 0.6;
const face = (id, uid) => (S.sq[id] ? `<span class="face" title="${esc(S.sq[id].name)}">${avatarSVG(persona(S.sq[id]), undefined, uid)}</span>` : '');
const ownerName = (id) => S.sq[id]?.name || id || 'Nobody';
const hit = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
const hl = (text, q) => { const t = esc(text); if (!q) return t; const i = t.toLowerCase().indexOf(esc(q)); return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + esc(q).length) + '</mark>' + t.slice(i + esc(q).length); };
const taskStale = (t) => (t.status === 'todo' || t.status === 'blocked' || t.status === 'review') && daysSince(t.confirmed) >= STALE_DAYS;
const branchOf = (t) => (t.branch ? `${t.repo ? t.repo + ':' : ''}${t.branch}` : '');

async function loadBoard() {
  const b = await api('/board');
  const before = new Set(B.tasks.map((t) => t.id));
  B.goals = { active: [], hold: [], todo: [], done: [], ...b.goals }; B.tasks = b.tasks;
  if (B.seen) for (const t of B.tasks) if (!before.has(t.id)) B.fresh.add(t.id);
  B.seen = true;
  renderGoals(); renderTasks(); B.fresh.clear(); linkAll();
  if (B.view === 'team') { renderTeam(); loadHumans(); }
  if (B.view === 'calendar') loadCal();
  if (B.view === 'merge') loadMerges();
}
window.onBoard = () => loadBoard();

// ---------- Goals: the whiteboard ----------
// Areas (t977): ongoing responsibilities with no finish line sit in one strip above the columns, never in a tier.
const isArea = (g) => g.kind === 'area';
const openCount = (id) => B.tasks.filter((t) => t.goal === id && t.status !== 'done').length;
// Areas strip shows short names: 'SEO: example.com' is SEO, 'Personal site: example.com' is example.com. The tooltip keeps the full title.
const areaName = (t = '') => { const [a, b] = t.split(/:\s+/); t = (b && a.length > 4 ? b : a) || t; return !t || t.includes('.') ? t : t[0].toUpperCase() + t.slice(1); };
function renderGoals() {
  const q = B.gq.toLowerCase(), found = (g) => hit(q, g.title, g.note, ownerName(g.owner)); let shown = 0;
  const areas = allGoals().filter(isArea).sort((a, b) => openCount(b.id) - openCount(a.id)), aShown = areas.filter(found);
  $('#areas').hidden = !aShown.length;
  $('#areas').innerHTML = `<h3>Areas</h3>` + aShown.map((g, i) => { const n = openCount(g.id);
    return `<button class="area" type="button" data-goal="${esc(g.id)}" title="${esc(g.title)}${g.owner ? `, ${esc(ownerName(g.owner))}` : ''}">${g.owner && S.sq[g.owner] ? face(g.owner, 'ar' + i + '_') : ''}<span class="an">${hl(areaName(g.title), q)}</span><span class="ac ${n ? '' : 'none'}">${n ? `${n} open` : 'Nothing open'}</span></button>`; }).join('');
  $('#wbcols').innerHTML = Object.entries(TIER_NAMES).map(([tier, name]) => {
    const all = B.goals[tier].filter((g) => !isArea(g)), list = all.filter(found); shown += list.length;
    return `<div class="wbcol ${tier}" data-tier="${tier}"><h3>${name}<small>${all.length}</small></h3><div class="glist">
      ${list.map((g) => {
        const stale = tier === 'active' && daysSince(g.last_confirmed) >= STALE_DAYS;
        const open = openCount(g.id);
        return `<div class="g ${stale ? 'stale' : ''}" draggable="true" data-goal="${esc(g.id)}">
          <span class="gt">${hl(g.title, q)}${g.note ? `<span class="gn">${hl(g.note, q)}</span>` : ''}${open ? `<span class="gn">${open} open note${open > 1 ? 's' : ''}</span>` : ''}</span>
          <span class="gm">${tier === 'done' ? '' : `<span class="gmerge ${g.merge}" title="${g.merge === 'open' ? 'Open: commits go to main' : 'Gated: a branch per task, merged from the Merge tab'}">${g.merge === 'open' ? 'Open' : 'Gated'}</span>`}${g.owner && S.sq[g.owner] ? `<span class="nown" data-owner="${esc(g.owner)}" title="Ask ${esc(ownerName(g.owner))} about this goal">${face(g.owner, 'gf' + hash(g.id) + '_')}</span>` : ''}${ago(g.last_confirmed)}</span></div>`;
      }).join('')}
      ${tier !== 'done' ? `<button class="addg" data-addgoal="${tier}">+ add a goal</button>` : ''}</div></div>`;
  }).join('');
  const goals = allGoals().length - areas.length, both = `${goals} goal${goals === 1 ? '' : 's'}${areas.length ? `, ${areas.length} area${areas.length === 1 ? '' : 's'}` : ''}`;
  $('#gcount').textContent = q ? `${shown + aShown.length} of ${both}` : both;
}

// ---------- Tasks: the cork board ----------
// Suggestions (t825) live in their own filter until the lead accepts one; then it's a normal note.
const isSug = (t) => t.kind === 'suggestion' && t.decision !== 'accepted';
function taskVisible(t) {
  if (B.tshow === 'suggest') return t.kind === 'suggestion' && hit(B.tq.toLowerCase(), t.title, t.evidence, t.why, ownerName(t.by));
  if (isSug(t)) return false;
  if (B.tgoal && t.goal !== B.tgoal) return false;
  if (B.towner && (t.owner || '') !== (B.towner === '-' ? '' : B.towner)) return false;
  if (!hit(B.tq.toLowerCase(), t.title, t.note, goalById(t.goal)?.title, ownerName(t.owner))) return false;
  if (B.tshow === 'stale') return taskStale(t);
  if (B.tshow === 'open') return t.status !== 'done' || daysSince(t.finished || t.confirmed) <= 7;
  return true;
}
function renderTasks() {
  const goalSel = $('#tgoal'), ownSel = $('#towner');
  goalSel.innerHTML = `<option value="">All goals</option>` + ['active', 'hold', 'todo', 'done'].flatMap((t) => B.goals[t]).map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');
  ownSel.innerHTML = `<option value="">Everyone</option><option value="-">Nobody</option>` + S.order.map((id) => `<option value="${esc(id)}">${esc(S.sq[id].name)}</option>`).join('');
  goalSel.value = B.tgoal; ownSel.value = B.towner;
  document.querySelectorAll('#tshow button').forEach((b) => b.classList.toggle('on', b.dataset.v === B.tshow));
  const vis = B.tasks.filter(taskVisible);
  $('#corkcols').innerHTML = COLS.map(([st, name]) => {
    const list = vis.filter((t) => t.status === st);
    let body;
    if (B.tidy && !B.towner && B.tshow !== 'suggest') {
      // Tidy: each agent's notes collapse into one pile; loose (unowned) notes stay on the board.
      const piles = {}, loose = [];
      for (const t of list) (t.owner && S.sq[t.owner] ? (piles[t.owner] = piles[t.owner] || []) : loose).push(t);
      body = Object.entries(piles).map(([o, ts]) => pileHtml(o, ts, st)).join('') + loose.map(noteHtml).join('');
    } else body = list.map(noteHtml).join('');
    return `<div class="ccol" data-status="${st}"><h3><span>${name}<small>${list.length || ''}</small></span></h3><div class="notes">${body}</div></div>`;
  }).join('');
  linkTasks($('#corkcols'));
  const sb = $('#tshow [data-v=suggest]'), open = B.tasks.filter((t) => t.kind === 'suggestion' && !t.decision).length; if (sb) sb.textContent = open ? `Suggestions ${open}` : 'Suggestions';
  $('#tcount').textContent = `${vis.length} of ${B.tasks.length} notes`;
  $('#ttidy').classList.toggle('on', B.tidy); $('#ttidy').textContent = B.tidy ? 'Tidy: piles' : 'Tidy: off';
}
const kidsOf = (t) => B.tasks.filter((x) => x.parent === t.id);
function subLine(t) { const k = kidsOf(t); if (!k.length) return ''; const d = k.filter((x) => x.status === 'done').length; return `<div class="nsub"><span style="--p:${Math.round((d / k.length) * 100)}%"></span>${d}/${k.length} subtasks done</div>`; }
function pileHtml(owner, ts, st) {
  const s = S.sq[owner];
  return `<div class="pile c${colorOf(ts[0].goal)}" data-pile="${esc(owner)}" title="Open ${esc(s.name)}'s board">
    <div class="ph">${face(owner, 'pl' + st + owner + '_')}<b>${esc(s.name)}</b><span>${ts.length} note${ts.length > 1 ? 's' : ''}</span></div>
    ${ts.slice(0, 3).map((t) => `<div class="pt">${esc(t.title)}</div>`).join('')}${ts.length > 3 ? `<div class="pt more">+${ts.length - 3} more</div>` : ''}</div>`;
}
function sugHtml(t) {
  const ev = t.evidence ? (/^https?:\/\//.test(t.evidence) ? `<a href="${esc(t.evidence)}" target="_blank" rel="noopener">${esc(t.evidence)}</a>` : esc(t.evidence)) : '';
  const d = t.decision === 'accepted' ? `Accepted for ${esc(ownerName(t.owner))}` : t.decision === 'declined' ? `Declined: ${esc(t.why || '')}` : 'Waiting for the lead';
  return `<div class="nsug">Suggested by ${esc(ownerName(t.by))}${t.also?.length ? ` and ${t.also.map((x) => esc(ownerName(x))).join(', ')}` : ''}</div>${ev ? `<div class="nev">Evidence: ${ev}</div>` : ''}<div class="ndec ${t.decision || 'open'}">${d}</div>`;
}
function noteHtml(t) {
  const stale = taskStale(t), g = t.goal && goalById(t.goal), q = B.tq.toLowerCase();
  return `<div class="note c${colorOf(t.goal)} ${stale ? 'stale' : ''} ${t.status === 'done' ? 'done' : ''} ${B.fresh.has(t.id) ? 'new' : ''}"
      draggable="true" data-task="${esc(t.id)}" style="--r:${rot(t.id)}deg">
    ${t.parent ? `<div class="np">Part of: ${esc(B.tasks.find((x) => x.id === t.parent)?.title || t.parent)}</div>` : ''}
    <div class="nt">${hl(t.title, q)}</div>${t.note ? `<div class="nn">${hl(t.note, q)}</div>` : ''}
    ${t.kind === 'suggestion' ? sugHtml(t) : ''}${t.branch ? `<div class="nb" title="Branch">${esc(branchOf(t))}</div>` : ''}${t.split ? '<div class="nsplit">Needs splitting</div>' : ''}${subLine(t)}
    <div class="nf">${t.owner && S.sq[t.owner] ? `<span class="nown" data-owner="${esc(t.owner)}" title="Discuss with ${esc(ownerName(t.owner))}">${face(t.owner, 'nf' + t.id + '_')}</span>` : ''}<span class="age" title="Last confirmed ${esc(t.confirmed)}">${stale ? `${ago(t.confirmed)} old` : ago(t.created)}</span>${g ? `<span class="ng">${esc(g.title)}</span>` : ''}</div></div>`;
}
$('#gq').oninput = (e) => { B.gq = e.target.value; renderGoals(); syncUrl(); };
$('#tq').oninput = (e) => { B.tq = e.target.value; renderTasks(); syncUrl(); };
$('#tgoal').onchange = (e) => { B.tgoal = e.target.value; renderTasks(); syncUrl(); };
$('#towner').onchange = (e) => { B.towner = e.target.value; renderTasks(); syncUrl(); };
$('#ttidy').onclick = () => { B.tidy = !B.tidy; try { localStorage.agentsTidy = B.tidy ? '1' : '0'; } catch {} renderTasks(); };
$('#tshow').onclick = (e) => { const v = e.target.dataset.v; if (v) { B.tshow = v; renderTasks(); syncUrl(); } };

// ---------- drag and drop ----------
let drag = null;
for (const v of ['#goalsView', '#tasksView']) {
  const el = $(v);
  el.addEventListener('dragstart', (e) => {
    const n = e.target.closest('[data-task],[data-goal]'); if (!n) return;
    drag = n.dataset.task ? { task: n.dataset.task } : { goal: n.dataset.goal };
    n.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.dataset.task || n.dataset.goal);
  });
  el.addEventListener('dragend', (e) => { e.target.classList?.remove('dragging'); document.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
  el.addEventListener('dragover', (e) => {
    const col = drag && e.target.closest(drag.task ? '.ccol' : '.wbcol'); if (!col) return;
    e.preventDefault(); document.querySelectorAll('.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over');
  });
  el.addEventListener('drop', async (e) => {
    const d = drag; drag = null; if (!d) return;
    if (d.task) {
      const col = e.target.closest('.ccol'); if (!col) return; e.preventDefault();
      const t = B.tasks.find((x) => x.id === d.task); if (t) t.status = col.dataset.status; renderTasks();
      const r = await api('/tasks', { op: 'move', id: d.task, status: col.dataset.status }); if (r?.error) { toast(r.error); loadBoard(); } else AUD.click();
    } else {
      const col = e.target.closest('.wbcol'); if (!col) return; e.preventDefault();
      const items = [...col.querySelectorAll('.g')].filter((x) => x.dataset.goal !== d.goal);
      const index = items.filter((x) => x.getBoundingClientRect().top + x.offsetHeight / 2 < e.clientY).length;
      await api('/goals', { op: 'move', id: d.goal, tier: col.dataset.tier, index }); AUD.click();
    }
  });
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-addgoal]'); if (add) return addGoal(add);
    if (e.target.closest('[data-addnote]')) return addNote();
    const pile = e.target.closest('[data-pile]'); if (pile) { B.towner = pile.dataset.pile; renderTasks(); return; }
    const o = e.target.closest('[data-owner]'); if (o) {
      const t = B.tasks.find((x) => x.id === o.closest('[data-task]')?.dataset.task), g = goalById(o.closest('[data-goal]')?.dataset.goal);
      return discuss(o.dataset.owner, t ? `About ${t.id}${t.branch ? ` (${t.branch})` : ''}: ` : g ? `About the goal "${g.title}": ` : '');
    }
    const n = e.target.closest('[data-task]'); if (n && !n.querySelector('textarea')) return editTask(n);
    const g = e.target.closest('.g[data-goal],.area[data-goal]'); if (g) return editGoal(g);
    if (!e.target.closest('input,select,.seg')) closePop();
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#pop,[data-task],.g,.area,.tlink')) closePop(); });

function addGoal(btn) {
  const tier = btn.dataset.addgoal, input = document.createElement('input');
  input.className = 'inline'; input.placeholder = 'New goal'; btn.replaceWith(input); input.focus();
  const done = async (save) => { const title = input.value.trim(); input.onblur = null; if (save && title) await api('/goals', { op: 'add', title, tier }); else renderGoals(); };
  input.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  input.onblur = () => done(true);
}
function addNote() {
  if (B.tshow === 'stale') { B.tshow = 'open'; renderTasks(); }
  const notes = document.querySelector('.ccol[data-status="todo"] .notes'), n = document.createElement('div');
  n.className = `note c${colorOf(B.tgoal)} new`; n.style.setProperty('--r', '-1deg');
  n.innerHTML = '<textarea placeholder="What needs doing?"></textarea>'; notes.prepend(n); notes.scrollTop = 0;
  const ta = n.querySelector('textarea'); ta.focus();
  const done = async (save) => { const title = ta.value.trim(); ta.onblur = null; if (save && title) await api('/tasks', { op: 'add', title, goal: B.tgoal || undefined, owner: B.towner && B.towner !== '-' ? B.towner : undefined, by: me().id }); else renderTasks(); };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); };
  ta.onblur = () => done(true);
}

// ---------- popover editors ----------
const ownerOptions = (cur) => `<option value="">Nobody</option>` + S.order.map((id) => `<option value="${esc(id)}" ${cur === id ? 'selected' : ''}>${esc(S.sq[id].name)}</option>`).join('');
const goalOptions = (cur) => `<option value="">No goal</option>` + ['active', 'hold', 'todo'].flatMap((t) => B.goals[t]).map((g) => `<option value="${esc(g.id)}" ${cur === g.id ? 'selected' : ''}>${esc(g.title)}</option>`).join('');
function showPop(anchor, html, wire) {
  const pop = $('#pop'), r = anchor.getBoundingClientRect();
  pop.innerHTML = html; pop.classList.add('on');
  // Auto-growing textareas show the whole text (CSS caps them), measured before the popover is placed.
  for (const ta of pop.querySelectorAll('textarea.grow')) { const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }; fit(); ta.oninput = fit; }
  let x = r.right + 12, y = r.top;
  if (x + 312 > innerWidth) x = r.left - 312;
  pop.style.left = Math.max(8, x) + 'px'; pop.style.top = Math.max(60, Math.min(innerHeight - pop.offsetHeight - 10, y)) + 'px';
  wire(pop); pop.querySelector('input,textarea')?.focus();
}
function closePop() { $('#pop').classList.remove('on', 'tpop-on'); }
function editGoal(el) {
  const g = goalById(el.dataset.goal); if (!g) return;
  const open = openCount(g.id), area = isArea(g);
  showPop(el, `<label>${area ? 'Area' : 'Goal'}</label><input id="pgT" value="${esc(g.title)}">
    <label>Kind</label><div class="seg" id="pgK"><button type="button" data-k="goal" class="${area ? '' : 'on'}">Goal</button><button type="button" data-k="area" class="${area ? 'on' : ''}">Area</button></div>
    <div class="khint">${area ? 'Areas have no finish line, so they never go to Done or get a "still on?".' : 'Goals finish. Make it an area if it never will.'}</div>
    <label>Owner</label><select id="pgO">${ownerOptions(g.owner)}</select>
    <label>Note</label><textarea id="pgN" class="grow" rows="6" placeholder="Optional">${esc(g.note || '')}</textarea>
    <label>Repos (space separated)</label><input id="pgR" value="${esc((g.repos || []).join(' '))}" placeholder="~/project">
    <label>Merge policy</label><select id="pgM"><option value="gated" ${g.merge !== 'open' ? 'selected' : ''}>Gated: branch per task, you merge</option><option value="open" ${g.merge === 'open' ? 'selected' : ''}>Open: commits go to main</option></select>
    <div class="row"><button class="go" data-a="save">Save</button>${area ? '' : '<button data-a="confirm">Still on</button>'}<button data-a="notes">Its notes (${open})</button></div>
    <div class="row">${area ? '' : '<button data-a="done">Mark done</button>'}<button data-a="chat">${g.owner ? 'Chat with owner' : 'Ask the lead'}</button><button class="bad" data-a="drop">Erase</button></div>`, (pop) => {
    pop.onclick = async (e) => {
      const k = e.target.closest('[data-k]'); if (k) { pop.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('on', b === k)); return; }
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'save') await api('/goals', { op: 'edit', id: g.id, title: pop.querySelector('#pgT').value.trim() || g.title, owner: pop.querySelector('#pgO').value, note: pop.querySelector('#pgN').value.trim(), repos: pop.querySelector('#pgR').value.trim(), merge: pop.querySelector('#pgM').value, kind: pop.querySelector('#pgK .on').dataset.k });
      if (a === 'confirm') { await api('/goals', { op: 'confirm', id: g.id }); toast(`Confirmed: ${g.title}`); }
      if (a === 'done') { await api('/goals', { op: 'move', id: g.id, tier: 'done' }); AUD.ding(); }
      if (a === 'drop') await api('/goals', { op: 'drop', id: g.id });
      if (a === 'notes') { B.tgoal = g.id; B.tq = ''; $('#tq').value = ''; B.tshow = 'open'; setView('tasks'); }
      if (a === 'chat') { const who = g.owner && S.sq[g.owner] ? g.owner : leadId(); if (who) openChat(who); }
      closePop();
    };
    pop.querySelector('#pgT').onkeydown = (e) => { if (e.key === 'Enter') pop.querySelector('[data-a=save]').click(); };
  });
}
function editTask(el) {
  const t = B.tasks.find((x) => x.id === el.dataset.task); if (!t) return;
  showPop(el, `<label>Note</label><textarea id="ptT">${esc(t.title)}</textarea>
    <label>Goal</label><select id="ptG">${goalOptions(t.goal)}</select>
    <label>Claimed by</label><select id="ptO">${ownerOptions(t.owner)}</select>
    <label>Branch (repo:branch when the goal has several repos)</label><input id="ptB" value="${esc(branchOf(t))}" placeholder="feature/thing">
    <div class="row">${COLS.map(([st, n]) => `<button data-st="${st}" class="${t.status === st ? 'cur' : ''}">${n}</button>`).join('')}</div>
    ${kidsOf(t).length ? `<label>Subtasks</label><div class="subs">${kidsOf(t).map((k) => `<div class="sub ${k.status}" data-sub="${esc(k.id)}">${k.status === 'done' ? '<s>' + esc(k.title) + '</s>' : esc(k.title)} <em>${esc(COLS.find(([s]) => s === k.status)[1])}</em></div>`).join('')}</div>` : ''}
    ${t.kind === 'suggestion' && !t.decision ? `<label>Suggestion from ${esc(ownerName(t.by))}: accept with the goal and owner above, or decline with a reason</label><textarea id="ptW" placeholder="Why not (sent to ${esc(ownerName(t.by))})"></textarea>
    <div class="row"><button class="go" data-a="accept">Accept</button><button class="bad" data-a="decline">Decline</button></div>` : ''}
    <label>Split into subtasks (one per line)</label><textarea id="ptS" placeholder="First small piece&#10;Second small piece"></textarea>
    <div class="row"><button data-a="split">Split now</button><button data-a="mark" class="${t.split ? 'cur' : ''}">${t.split ? 'Marked: needs splitting' : 'Split later'}</button></div>
    <div class="row"><button class="go" data-a="save">Save</button><button data-a="confirm">Still needed</button>${t.owner ? '<button data-a="release">Release</button><button data-a="chat">Chat with owner</button>' : ''}<button class="bad" data-a="drop">Tear off</button></div>
    <div class="row" style="color:var(--dim);font-size:11.5px">Added ${esc(t.created)}${t.by ? ` by ${esc(ownerName(t.by))}` : ''} · confirmed ${esc(t.confirmed)}</div>`, (pop) => {
    pop.onclick = async (e) => {
      const sub = e.target.closest('[data-sub]'); if (sub) { closePop(); const n = document.querySelector(`[data-task="${sub.dataset.sub}"]`); if (n) { n.scrollIntoView({ block: 'center', behavior: 'smooth' }); editTask(n); } return; }
      const st = e.target.dataset.st, a = e.target.dataset.a; if (!st && !a) return;
      const branch = pop.querySelector('#ptB').value.trim();
      if (st) { const r = await api('/tasks', { op: 'move', id: t.id, status: st, ...(st === 'review' ? { branch } : {}) }); if (r?.error) { toast(r.error); pop.querySelector('#ptB').focus(); return; } }
      if (a === 'save') { const r = await api('/tasks', { op: 'edit', id: t.id, title: pop.querySelector('#ptT').value.trim() || t.title, goal: pop.querySelector('#ptG').value, owner: pop.querySelector('#ptO').value, ...(branch !== branchOf(t) ? { branch } : {}) }); if (r?.error) { toast(r.error); return; } }
      if (a === 'accept' || a === 'decline') {
        const w = pop.querySelector('#ptW'), body = a === 'accept' ? { goal: pop.querySelector('#ptG').value, owner: pop.querySelector('#ptO').value } : { why: w.value.trim() };
        const r = await api('/tasks', { op: a, id: t.id, by: me().id, ...body }); if (r?.error) { toast(r.error); (a === 'decline' ? w : pop.querySelector(body.goal ? '#ptO' : '#ptG')).focus(); return; }
      }
      if (a === 'confirm') await api('/tasks', { op: 'confirm', id: t.id });
      if (a === 'release') await api('/tasks', { op: 'edit', id: t.id, owner: '' });
      if (a === 'split') { const titles = pop.querySelector('#ptS').value.split('\n').map((x) => x.trim()).filter(Boolean); if (!titles.length) { pop.querySelector('#ptS').focus(); return; } await api('/tasks', { op: 'split', id: t.id, titles, by: me().id }); }
      if (a === 'mark') await api('/tasks', { op: 'edit', id: t.id, split: !t.split });
      if (a === 'drop') await api('/tasks', { op: 'drop', id: t.id });
      if (a === 'chat') openChat(t.owner);
      closePop();
    };
  });
}

// ---------- Merge: branches in review across gated goals ----------
B.merges = [];
// The listing can take ~40s (t1129): say so until the first answer lands.
async function loadMerges() {
  if (!B.mloaded) $('#mcount').textContent = 'Loading branches…';
  const wp = api('/worktrees').catch(() => []), m = await api('/merges').catch(() => null); if (!Array.isArray(m)) { if (!B.mloaded) $('#mcount').textContent = 'Couldn’t load branches'; toast(m?.error || 'merge queue unavailable'); return; }
  const w = await wp; B.mloaded = true; B.merges = m; B.worktrees = Array.isArray(w) ? w : []; renderMerges();
}
const repoName = (p) => String(p || '').replace(/\/+$/, '').split('/').pop();
B.mopen = new Set();
function renderMerges() {
  const list = B.merges, g = (id) => goalById(id)?.title || id || '', stale = list.filter((m) => m.stale).length;
  $('#mcount').textContent = list.length ? `${list.length} branch${list.length > 1 ? 'es' : ''} waiting${stale ? `, ${stale} stale` : ''}` : 'Nothing waiting';
  if (!list.length) { $('#mq').innerHTML = '<div class="empty">Nothing in review. Squiggles put branches here with task move &lt;id&gt; review &lt;branch&gt; "&lt;test result&gt;".</div>' + afterHtml() + worktreesHtml(); return; }
  const row = (m) => {
    const nc = m.conflicts?.length || 0, open = B.mopen.has(m.id), why = m.error || (nc ? `Conflicts with ${m.base}: send it back` : m.head !== m.base ? `${repoName(m.repo)} is on ${m.head}: check out ${m.base} first` : '');
    const ab = m.error ? '' : `${m.ahead} ahead${m.behind ? `, ${m.behind} behind` : ''}`, left = (m.needs || []).filter((x) => !x.done).length;
    const acts = `<button data-a="diff" ${m.error ? 'disabled' : ''}>Diff</button><button data-a="back">Send back</button><button class="go" data-a="merge" ${why ? 'disabled' : ''} title="${esc(why || `Merge into ${m.base}, delete the branch, mark done`)}">Merge</button>`;
    return `<tr class="mrow ${open ? 'open' : ''} ${m.error ? 'err' : ''}" data-merge="${esc(m.id)}">
      <td class="mid">${esc(m.id)}${m.stale ? ` <span class="mtag" title="In review ${m.age} days">Stale</span>` : ''}</td>
      <td class="mtt" title="${esc(m.title)}">${nc ? `<span class="mtag mneed mconf" title="${esc(m.conflicts.join('\n'))}">Conflicts</span>` : ''}${left ? `<span class="mtag mneed" title="${esc(m.needs.filter((x) => !x.done).map((x) => x.t).join('\n'))}">Needs ${left}</span>` : ''}<span>${esc(m.title)}</span></td>
      <td class="mrepo" title="${esc([m.repo, ...(m.others || []).map((o) => o.repo)].join('\n'))}">${esc([m.repo, ...(m.others || []).map((o) => o.repo)].map(repoName).join(' + '))}</td>
      <td class="mab">${ab}</td>
      <td class="mres ${m.error ? 'bad' : m.result ? '' : 'none'}" title="${esc(m.error || m.result)}">${m.error ? esc(m.error) : m.result ? esc(m.result) : 'No test result'}</td>
      <td class="mown">${m.owner ? `<button class="mowner" data-a="owner" title="Discuss with ${esc(ownerName(m.owner))}">${face(m.owner, 'mg' + m.id + '_')}</button>` : ''}</td>
      <td class="macts">${acts}</td>
    </tr>${open ? `<tr class="mdet"><td colspan="7"><div class="mdbox">
      <p class="mdt">${esc(m.title)}</p>
      ${stepsHtml(m.needs, 'need', 'Before merging')}${stepsHtml(m.after, 'after', 'After merging')}
      <dl><dt>Goal</dt><dd>${esc(g(m.goal))}</dd><dt>Branch</dt><dd><code>${esc(m.repo)}:${esc(m.branch)}</code></dd>
      ${m.others?.length ? `<dt>Also merges</dt><dd>${m.others.map((o) => `<code>${esc(o.repo)}:${esc(o.branch)}</code>${o.error ? ` ${esc(o.error)}` : `, ${o.ahead} ahead of ${esc(o.base)}`}`).join('<br>')}</dd>` : ''}
      ${nc ? `<dt>Conflicts</dt><dd>${m.conflicts.map((f) => `<code>${esc(f)}</code>`).join(', ')}</dd>` : ''}
      ${m.error ? '' : `<dt>Base</dt><dd>${esc(m.base)}, ${ab}${m.dirty ? `, ${m.dirty} uncommitted file${m.dirty > 1 ? 's' : ''} in the repo` : ''}</dd>`}
      <dt>Test result</dt><dd>${esc(m.error || m.result || 'None on the note')}</dd><dt>In review</dt><dd>since ${esc(m.reviewed || '')} (${m.age <= 0 ? 'today' : `${m.age}d`})${m.owner ? `, by ${esc(ownerName(m.owner))}` : ''}</dd>
      ${m.log?.length ? `<dt>Commits</dt><dd><code class="mlog">${esc(m.log.join('\n'))}</code></dd>` : ''}</dl>
      ${m.desktop || m.compare ? `<p class="mlinks">${m.desktop ? `<a href="${esc(m.desktop)}">Open in GitHub Desktop</a>` : ''}${m.compare ? `<a href="${esc(m.compare)}" target="_blank" rel="noopener">View on GitHub</a>` : m.desktop ? '<span title="The branch is not on GitHub; nobody pushes it from here">Not on GitHub yet</span>' : ''}</p>` : ''}
      <div class="macts mdacts">${m.owner ? `<button data-a="owner">Discuss with ${esc(ownerName(m.owner))}</button>` : ''}${acts}</div></div></td></tr>` : ''}`;
  };
  $('#mq').innerHTML = `<table class="mtab"><thead><tr><th class="mid">Task</th><th>Title</th><th class="mrepo">Repo</th><th class="mab">Commits</th><th class="mres">Test result</th><th class="mown">Owner</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>` + afterHtml() + worktreesHtml();
}
// The user's steps around the button (t766 needs, t1182 after), ticked here or with task needs|after <id> done <n>.
const stepsHtml = (l, a, h) => l?.length ? `<div class="mneeds"><h5>${h}${l.some((x) => !x.done) ? '' : ': all done'}</h5>${l.map((x, i) => `<label class="${x.done ? 'done' : ''}"><input type="checkbox" data-a="${a}" data-n="${i + 1}" ${x.done ? 'checked' : ''}><span>${esc(x.t)}</span></label>`).join('')}</div>` : '';
// Merged tasks with after-merge steps left (t1182). CLI: merges lists them too.
function afterHtml() {
  const t = B.tasks.filter((x) => x.status === 'done' && x.after?.some((n) => !n.done)); if (!t.length) return '';
  return `<h3 class="wth">After merging <span>${t.length}</span></h3><div class="mafter">${t.map((x) => `<div class="mabox" data-merge="${esc(x.id)}">${stepsHtml(x.after, 'after', `${esc(x.id)} ${esc(x.title)}`)}</div>`).join('')}</div>`;
}
// Worktrees (t769): every extra worktree in the goals' repos and the task that owns it. CLI: worktrees.
function worktreesHtml() {
  const w = B.worktrees || [], orphans = w.filter((x) => x.orphan).length; if (!w.length) return '';
  const home = (p) => p.replace(/^\/Users\/[^/]+/, '~');
  return `<h3 class="wth">Worktrees <span>${w.length}${orphans ? `, ${orphans} without a task` : ''}</span></h3><table class="mtab wtab"><thead><tr><th>Task</th><th>Folder</th><th>Branch</th><th>State</th><th>Owner</th></tr></thead><tbody>${w.map((x) => `<tr>
    <td class="mid">${x.orphan ? '<span class="mtag">Orphan</span>' : esc(x.task)}</td>
    <td title="${esc(x.path)}"><code>${esc(home(x.path))}</code></td>
    <td title="${esc(x.branch)}"><code>${esc(x.branch || 'detached')}</code></td>
    <td class="wst">${[x.task ? esc(x.status) : '', x.dirty ? `${x.dirty} uncommitted` : '', x.missing ? 'folder gone' : '', x.home ? '' : 'not in ~/wt'].filter(Boolean).join(', ')}</td>
    <td class="mown">${x.owner ? face(x.owner, 'wt' + hash(x.path) + '_') : ''}</td></tr>`).join('')}</tbody></table>`;
}
function diffHtml(text) {
  return text.split('\n').map((l) => { const c = l.startsWith('+++') || l.startsWith('---') ? 'f' : l.startsWith('diff ') ? 'f' : l[0] === '+' ? 'a' : l[0] === '-' ? 'd' : l.startsWith('@@') ? 'h' : ''; return c ? `<span class="${c}">${esc(l)}</span>` : esc(l); }).join('\n');
}
// Diff view (t176): Merge beside the title, commits and files fold to 5 lines, the diff gets the rest of the height.
const fold = (lines, cls) => `<div class="dfold ${cls}">${lines.length > 5 ? `<pre class="dl">${esc(lines.slice(0, 5).join('\n'))}</pre><pre class="dl dall">${esc(lines.join('\n'))}</pre><button data-a="more" data-n="${lines.length}">Show all ${lines.length}</button>` : `<pre class="dl">${esc(lines.join('\n'))}</pre>`}</div>`;
async function openDiff(id) {
  const d = await api(`/merges/${encodeURIComponent(id)}/diff`); if (d?.error) return toast(d.error);
  const m = B.merges.find((x) => x.id === id), why = m && (m.error || (m.head !== m.base ? `${repoName(m.repo)} is on ${m.head}: check out ${m.base} first` : ''));
  const stat = String(d.stat || '').split('\n').filter(Boolean), sum = stat.pop() || '';
  const box = $('#diffBody');
  box.innerHTML = `<div class="dh"><h2>${esc(d.title)}</h2>${m ? `<button class="go" data-a="dmerge" ${why ? 'disabled' : ''} title="${esc(why || `Merge into ${m.base}, delete the branch, mark done`)}">Merge</button>` : ''}<span class="sp"></span><button data-a="close">Close</button></div>
    <details class="dmeta" open><summary>${esc(repoName(d.repo))}:${esc(d.branch)} → ${esc(d.base)}, ${d.log.length} commit${d.log.length === 1 ? '' : 's'}${sum ? `, ${esc(sum.trim())}` : ''}</summary>
      ${d.log.length ? fold(d.log, 'dcommits') : ''}${stat.length ? fold(stat, 'dstat') : ''}</details><pre class="dpatch">${diffHtml(d.diff) || '(no changes)'}</pre>`;
  box.onclick = (e) => {
    const a = e.target.dataset.a;
    if (a === 'close') closeDiff();
    if (a === 'more') { const f = e.target.closest('.dfold'), on = f.classList.toggle('all'); e.target.textContent = on ? 'Show less' : `Show all ${e.target.dataset.n}`; }
    if (a === 'dmerge' && m) mergeBranch(m, e.target).then((ok) => ok && closeDiff());
  };
  $('#diffBox').classList.add('on'); B.diff = id; syncUrl();
}
// The open diff is in the URL (?view=merge&diff=<task>, t351).
function closeDiff(sync = true) { $('#diffBox').classList.remove('on'); B.diff = ''; if (sync) syncUrl(); }
async function mergeBranch(m, btn) {
  if (!confirm(`Merge ${repoName(m.repo)}:${m.branch} into ${m.base}? The branch is deleted and the task marked done.`)) return false;
  btn.disabled = true; btn.textContent = 'Merging';
  const r = await api('/merges', { op: 'merge', id: m.id, by: me().id }).catch(() => ({ error: 'Merge request failed' })); if (r?.error) { toast(r.error); btn.disabled = false; btn.textContent = 'Merge'; loadMerges(); return false; }
  AUD.ding(); toast(`Merged ${m.branch} ${r.merged?.length > 1 ? `into ${r.merged.length} repos` : `at ${r.sha}`}`); loadMerges(); return true;
}
$('#diffBox').onclick = (e) => { if (e.target.id === 'diffBox') closeDiff(); };
// Merge review now (t599): a meeting where the squiggles with branches in review present them. CLI: meet merges.
$('#mmeet').onclick = async () => {
  const r = await api('/meetings', { op: 'merges', by: me().id });
  if (r?.error) return toast(r.error);
  toast(`Merge review on: ${r.presenters.map((id) => S.sq[id]?.name || id).join(', ')}`);
};
$('#mrefresh').onclick = async () => {
  const r = await api('/merges', { op: 'refresh' });
  if (r?.closed?.length) toast(`Closed ${r.closed.map((c) => `${c.id} (${c.why})`).join(', ')}`);
  return loadMerges();
};
$('#mergeView').onclick = async (e) => {
  // Buttons in the expanded row (the only ones on phone) belong to the row above it.
  const a = e.target.closest('[data-a]')?.dataset.a, det = e.target.closest('.mdet'), row = e.target.closest('[data-merge]') || (a && det?.previousElementSibling); if (!row) return;
  if (!a) { if (e.target.closest('button,a,label,.mabox')) return; const id = row.dataset.merge; B.mopen.has(id) ? B.mopen.delete(id) : B.mopen.add(id); return renderMerges(); }
  const id = row.dataset.merge, m = B.merges.find((x) => x.id === id);
  if (a === 'diff') return openDiff(id);
  // The owner opens a 1:1 with the item in the message box (t627). CLI: room chat <id> "<text>".
  if (a === 'owner') return discuss(m.owner, `About ${m.id} (${repoName(m.repo)}:${m.branch}): `);
  if (a === 'back') {
    const pre = m.conflicts?.length ? `Conflicts with ${m.base} in ${m.conflicts.join(', ')}: rebase or merge ${m.base} in and resolve.` : '';
    const note = prompt(`Send "${m.title}" back to ${ownerName(m.owner)}. What should change?`, pre); if (!note || !note.trim()) return;
    const r = await api('/merges', { op: 'back', id, note: note.trim(), by: me().id }); if (r?.error) return toast(r.error);
    toast(`Sent back to ${ownerName(m.owner)}`); return loadMerges();
  }
  if (a === 'merge') return mergeBranch(m, e.target);
  if (a === 'need' || a === 'after') { const r = await api('/tasks', { op: a === 'need' ? 'needs' : 'after', id, act: e.target.checked ? 'done' : 'undo', n: e.target.dataset.n }); if (r?.error) toast(r.error); else if (a === 'after') { const t = B.tasks.find((x) => x.id === id); if (t && r?.id) { t.after = r.after; renderMerges(); } } return a === 'after' ? loadBoard() : loadMerges(); }
};

// ---------- Team: every squiggle, what it cares about and guards, how it runs ----------
const charterLine = (c, label) => (String(c || '').match(new RegExp(label + ':\\s*([^\\n]+)', 'i')) || [])[1] || '';
const cadence = (m) => (!m ? 'Only when asked' : m % 1440 === 0 ? (m === 1440 ? 'Daily' : `Every ${m / 1440} days`) : m % 60 === 0 ? `Every ${m / 60}h` : `Every ${m}m`);
const modelName = (m) => ({ opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'gpt-6.1-sol': 'Codex 6.1 Sol' })[m] || m || 'Opus 5.5';
function renderTeam() {
  const q = ($('#teamq').value || '').trim().toLowerCase();
  const all = S.order.map((id) => S.sq[id]).filter(Boolean);
  const rank = (s) => (s.paused ? 2 : { blocked: 0, rethink: 1 }[s.status] ?? 2);
  const list = all.filter((s) => hit(q, s.id, s.name, s.role, s.charter, s.cwd)).sort((a, b) => rank(a) - rank(b));
  $('#teamcount').textContent = `${all.length} on the team${q ? `, ${list.length} shown` : ''}`;
  $('#teamList').innerHTML = list.map((s) => {
    const owns = allGoals().filter((g) => g.owner === s.id && g.tier !== 'done').map((g) => g.title);
    const care = charterLine(s.charter, 'What you care about'), guard = charterLine(s.charter, 'What you guard');
    const st = s.paused ? 'Paused' : STATUS_WORD[s.status] || 'Idle';
    return `<div class="tm ${s.paused ? 'paused' : rank(s) < 2 ? 'stuck' : ''}" data-sq="${esc(s.id)}" tabindex="0" title="Open a 1:1 with ${esc(s.name)}">
      <div class="tmh">${face(s.id, 'tm' + s.id + '_')}<div><b>${esc(s.name)}${s.lead && !/lead/i.test(s.name) ? ' (lead)' : ''}</b><small>${esc(s.role)}</small></div><span class="tmst ${s.paused ? '' : esc(s.status || '')}">${esc(st)}</span></div>
      ${s.note ? `<div class="tmnote" title="${esc(s.note)}">${esc(s.note)}</div>` : ''}
      <dl>${care ? `<dt>Cares about</dt><dd>${esc(care)}</dd>` : ''}${guard ? `<dt>Guards</dt><dd>${esc(guard)}</dd>` : ''}
        <dt>Goals</dt><dd>${owns.length ? owns.map(esc).join(', ') : 'None'}</dd>
        <dt>Runs</dt><dd>${esc(cadence(s.every))}, ${esc(modelName(s.model))}${s.permissionMode && s.permissionMode !== 'auto' ? `, ${esc(s.permissionMode)}` : ''}</dd>
        <dt>Works in</dt><dd><code>${esc(s.cwd || '~')}</code></dd></dl>
      <div class="acts"><button data-a="one">1:1</button><button data-a="chat">Chat</button><button data-a="wake">Wake</button><button data-a="meet">Meet</button><button data-a="edit">Settings</button></div>
    </div>`;
  }).join('') || '<div class="empty">Nobody matches.</div>';
}
// People: the humans who use the room (humans.json). The owner first; click one to edit. CLI: humans, human add|edit|remove.
B.humans = [];
async function loadHumans() { const r = await api('/humans'); if (r?.humans) { B.humans = r.humans; renderPeople(); paintMe(); } }
function humanFace(h) {
  const a = h.avatar || '', hue = [...h.id].reduce((n, c) => n + c.charCodeAt(0), 0) * 47 % 360;
  return /^(https:|data:image\/)/.test(a) ? `<span class="hface"><img src="${esc(a)}" alt=""></span>`
    : `<span class="hface" style="background:hsl(${hue} 45% 32%)">${esc(a || [...h.name][0]?.toUpperCase() || '?')}</span>`;
}
function renderPeople() {
  const list = B.humans.map((h) => `<button class="hm" data-human="${esc(h.id)}" title="Edit ${esc(h.name)}">${humanFace(h)}<b>${esc(h.name)}</b></button>`).join('');
  $('#peopleList').innerHTML = `<h4>People</h4>` + list;
  $('#setPeople').innerHTML = list + `<button class="chip" data-human-add>+ Person</button>`;
}
function editHuman(anchor, id) {
  const h = id && B.humans.find((x) => x.id === id);
  showPop(anchor, `<label>Name</label><input id="hmN" value="${esc(h?.name || '')}" placeholder="Their name">
    <label>Avatar (emoji, up to 4 letters, or an image link)</label><input id="hmA" value="${esc(h?.avatar || '')}" placeholder="Empty: their initial">
    <div class="row"><button class="go" data-a="save">${h ? 'Save' : 'Add'}</button>${h && h.id !== 'owner' ? '<button class="bad" data-a="remove">Remove</button>' : ''}</div>`, (pop) => {
    pop.onclick = async (e) => {
      const a = e.target.dataset.a; if (!a) return;
      let r;
      if (a === 'save') { const f = { name: pop.querySelector('#hmN').value.trim(), avatar: pop.querySelector('#hmA').value.trim() }; r = await api('/humans', h ? { op: 'edit', id: h.id, ...f } : { op: 'add', ...f }); if (!r?.error) toast(h ? `Saved ${r.name}` : `Added ${r.name}`); }
      if (a === 'remove') { if (!confirm(`Remove ${h.name}?`)) return; r = await api('/humans', { op: 'remove', id: h.id }); if (!r?.error) toast(`Removed ${h.name}`); }
      if (r?.error) return toast(r.error);
      closePop(); loadHumans();
    };
  });
}
// Who's at this browser (t141): asked on joining when there's more than one human, switched from the top bar. Messages carry it.
S.me = localStorage.getItem('agents.me') || '';
const me = () => B.humans.find((h) => h.id === S.me) || B.humans[0] || { id: 'owner', name: 'You', avatar: '' };
const whoButtons = () => B.humans.map((h) => `<button class="hm" data-me="${esc(h.id)}">${humanFace(h)}<b>${esc(h.name)}</b></button>`).join('');
function paintMe() {
  const several = B.humans.length > 1, m = me(), ask = several && !B.humans.some((h) => h.id === S.me);
  $('#meBtn').hidden = !several; $('#meBtn').innerHTML = `${humanFace(m)}<span class="nm">${esc(m.name)}</span>`; $('#meBtn').title = `You're ${m.name}. Switch`;
  $('#joinWho').hidden = !ask; $('#joinBtn').hidden = ask;
  if (ask) $('#joinWho .who').innerHTML = whoButtons();
}
function setMe(id) { S.me = id; localStorage.setItem('agents.me', id); paintMe(); }
$('#joinWho').onclick = (e) => { const b = e.target.closest('[data-me]'); if (b) { setMe(b.dataset.me); $('#joinBtn').click(); } };
$('#meBtn').onclick = (e) => showPop(e.currentTarget, `<label>Who is using this browser?</label><div class="who">${whoButtons()}</div>`, (pop) => {
  pop.onclick = (ev) => { const b = ev.target.closest('[data-me]'); if (b) { setMe(b.dataset.me); closePop(); toast(`You're ${me().name}`); } };
});
loadHumans();
$('#teamPerson').onclick = (e) => editHuman(e.currentTarget);
$('#peopleList').onclick = $('#setPeople').onclick = (e) => { const b = e.target.closest('[data-human],[data-human-add]'); if (b) editHuman(b, b.dataset.human); };
$('#teamq').oninput = renderTeam;
$('#teamHire').onclick = () => openNew();
$('#teamList').onclick = async (e) => {
  const card = e.target.closest('[data-sq]'); if (!card) return;
  const id = card.dataset.sq, a = e.target.dataset.a;
  if (a === 'chat') return openChat(id);
  if (a === 'edit') return openSheet(id);
  if (a === 'meet') return meetNowPop(e.target, id);
  if (a === 'wake') { const r = await api(`/squiggles/${id}/wake`, { why: 'Asked from the room' }); return toast(r?.error || `Woke ${S.sq[id].name}`); }
  oneOnOne(id);
};
$('#teamList').onkeydown = (e) => { const c = e.target.closest?.('[data-sq]'); if (e.key === 'Enter' && c === e.target) oneOnOne(c.dataset.sq); };

// ---------- calendar: a week of meetings with squiggles, plus goal due dates ----------
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const mondayOf = (d) => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
B.week = mondayOf(new Date()); B.cal = { meetings: [], upcoming: [] };
const REPEAT_WORD = { once: '', daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week' };
async function loadCal() {
  const r = await api(`/meetings?from=${ymd(B.week)}T00:00&days=7`);
  if (r?.error || !r?.upcoming) { $('#calWeek').innerHTML = `<p class="calempty">${esc(r?.error || 'Calendar unavailable: restart the server to load it.')}</p>`; return; }
  B.cal = r; renderCal();
}
function renderCal() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(B.week); d.setDate(d.getDate() + i); return d; }), today = ymd(new Date());
  const fmt = (d, o) => d.toLocaleDateString([], o);
  $('#calRange').textContent = `${fmt(days[0], { month: 'short', day: 'numeric' })} to ${fmt(days[6], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const due = allGoals().filter((g) => g.due);
  $('#calWeek').innerHTML = days.map((d) => {
    const key = ymd(d), ms = B.cal.upcoming.filter((m) => m.start.startsWith(key)), gs = due.filter((g) => g.due === key);
    return `<div class="calday ${key === today ? 'today' : ''} ${key < today ? 'past' : ''}">
      <h3>${fmt(d, { weekday: 'short' })} <span>${fmt(d, { month: 'short', day: 'numeric' })}</span>${key === today ? '<em>Today</em>' : ''}</h3>
      ${gs.map((g) => `<button class="caldue c${colorOf(g.id)}" data-goal="${esc(g.id)}">Due: ${esc(g.title)}</button>`).join('')}
      ${ms.map((m) => { const on = S.meeting?.key === `${m.id}@${m.start}`; return `<button class="calm ${on ? 'on' : m.past || ''}" data-meeting="${esc(m.id)}" data-date="${key}" data-start="${esc(m.start)}">
        <span class="calt">${on ? '<em>On now</em> ' : m.past ? `<em>${m.past === 'done' ? 'Done' : 'Missed'}</em> ` : ''}${m.start.slice(11)} to ${m.end.slice(11)}${REPEAT_WORD[m.repeat] ? ` · ${REPEAT_WORD[m.repeat]}` : ''}</span>
        <b>${esc(m.title)}</b><span class="calppl">${m.attendees.map((id) => face(id, `cal${m.id}${key}${id}_`)).join('')}</span>
        ${m.agenda ? `<span class="calag">${esc(m.agenda)}</span>` : ''}</button>`; }).join('')}
      ${!ms.length && !gs.length ? '<p class="calempty">Nothing</p>' : ''}</div>`;
  }).join('');
}
function meetingForm(m, date, occ) {
  const at = m ? m.at : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return `${ymd(d)}T09:00`; })();
  const who = new Set(m?.attendees || [leadId()].filter(Boolean));
  return `<label>Meeting</label><input id="cmT" value="${esc(m?.title || '')}" placeholder="Weekly status">
    <label>When</label><input id="cmW" type="datetime-local" value="${esc(at)}">
    <div class="row2"><div><label>Minutes</label><input id="cmM" type="number" min="5" step="5" value="${m?.minutes || 30}"></div>
      <div><label>Repeats</label><select id="cmR">${Object.keys(REPEAT_WORD).map((r) => `<option value="${r}" ${(m?.repeat || 'once') === r ? 'selected' : ''}>${REPEAT_WORD[r] || 'Once'}</option>`).join('')}</select></div></div>
    <label>Who</label><div class="calwho">${S.order.map((id) => `<label><input type="checkbox" value="${esc(id)}" ${who.has(id) ? 'checked' : ''}>${esc(S.sq[id].name)}</label>`).join('')}</div>
    <label>Presenters, in order (optional)</label><input id="cmP" value="${esc((m?.presenters || []).map((id) => S.sq[id]?.name || id).join(', '))}" placeholder="Empty: everyone briefs at once. Or e.g. Vex, Otto">
    <div class="calwho"><label><input type="checkbox" id="cmS" ${m?.showtell ? 'checked' : ''}>Show and tell: each presenter's agenda is their work since the last one</label></div>
    <label>Agenda</label><textarea id="cmA" class="grow" rows="4" placeholder="What to cover; attendees get this when they wake">${esc(m?.agenda || '')}</textarea>
    ${occ?.past && S.meeting?.id !== m.id ? `<label>Notes</label>${occ.notes ? `<pre class="calnotes">${esc(occ.notes)}</pre>` : `<p class="calempty">${occ.past === 'done' ? 'No notes in runs/meetings.log.' : 'It never started.'}</p>`}`
      : m ? `<div class="row">${S.meeting?.id === m.id ? '<button class="go" data-a="join">Join</button>' : '<button class="go" data-a="start">Meet now</button>'}</div>` : ''}
    <div class="row"><button class="go" data-a="save">${m ? 'Save' : 'Schedule'}</button>${m ? `${m.repeat !== 'once' ? `<button data-a="skip">Cancel ${esc(new Date(date + 'T12:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</button>` : ''}<button class="bad" data-a="cancel">${m.repeat !== 'once' ? 'Cancel series' : 'Cancel meeting'}</button>` : ''}</div>`;
}
function editMeeting(anchor, id, date, start) {
  const m = id && B.cal.meetings.find((x) => x.id === id), occ = start && B.cal.upcoming.find((o) => o.id === id && o.start === start);
  showPop(anchor, meetingForm(m, date, occ), (pop) => {
    pop.onclick = async (e) => {
      const a = e.target.dataset.a; if (!a) return;
      let r;
      if (a === 'save') {
        const v = (s) => pop.querySelector(s).value, attendees = [...pop.querySelectorAll('.calwho input:checked:not(#cmS)')].map((x) => x.value);
        // Presenters by name or id, in the order typed.
        const byName = (x) => S.order.find((id) => id === x || S.sq[id].name.toLowerCase() === x.toLowerCase()) || x;
        const presenters = v('#cmP').split(',').map((x) => x.trim()).filter(Boolean).map(byName);
        const f = { title: v('#cmT').trim(), at: v('#cmW'), minutes: Number(v('#cmM')) || 30, repeat: v('#cmR'), agenda: v('#cmA').trim(), attendees, presenters, showtell: pop.querySelector('#cmS').checked };
        r = await api('/meetings', m ? { op: 'edit', id: m.id, ...f } : { op: 'add', by: me().id, ...f });
        if (!r?.error) toast(m ? `Saved ${r.title}` : `Scheduled ${r.title}`);
      }
      // Join a meeting that's on; Meet now starts this event at once (CLI: meeting start <id>, room view meeting).
      if (a === 'join') { closePop(); return setView('meeting'); }
      if (a === 'start') { r = await api('/meetings', { op: 'start', id: m.id }); if (!r?.error) toast(`Meeting on: ${m.title}`); }
      if (a === 'skip') { r = await api('/meetings', { op: 'cancel', id: m.id, date }); if (!r?.error) toast(`${m.title} cancelled on ${date}`); }
      if (a === 'cancel') { if (!confirm(`Cancel "${m.title}"${m.repeat !== 'once' ? ' and every repeat' : ''}?`)) return; r = await api('/meetings', { op: 'cancel', id: m.id }); if (!r?.error) toast(`Cancelled ${m.title}`); }
      if (r?.error) return toast(r.error);
      closePop(); loadCal();
    };
  });
}
$('#calPrev').onclick = () => { B.week.setDate(B.week.getDate() - 7); loadCal(); syncUrl(); };
$('#calNext').onclick = () => { B.week.setDate(B.week.getDate() + 7); loadCal(); syncUrl(); };
$('#calToday').onclick = () => { B.week = mondayOf(new Date()); loadCal(); syncUrl(); };
$('#calAdd').onclick = (e) => editMeeting(e.currentTarget);
// New meeting (t146, was Meet now): pick who, an optional topic and presenters (t604; default: the attendees); a 30-minute meeting starts at once. CLI: meet now <id,id> ["topic"] [--presenters <id,id>].
function meetNowPop(anchor, id) {
  const who = new Set([id || leadId()].filter(Boolean));
  showPop(anchor, `<label>New meeting with</label><div class="calwho">${S.order.map((x) => `<label><input type="checkbox" value="${esc(x)}" ${who.has(x) ? 'checked' : ''}>${esc(S.sq[x].name)}</label>`).join('')}</div>
    <label>Topic (optional)</label><input id="mnT" placeholder="What it's about">
    <label>Presenters, in order (optional)</label><input id="mnP" placeholder="Empty: everyone ticked, in this order">
    <div class="row"><button class="go" data-a="start">Start, 30 minutes</button></div>`, (pop) => {
    pop.querySelector('#mnT').onkeydown = (e) => { if (e.key === 'Enter') pop.querySelector('[data-a=start]').click(); };
    pop.onclick = async (e) => {
      if (e.target.dataset.a !== 'start') return;
      const attendees = [...pop.querySelectorAll('.calwho input:checked')].map((x) => x.value);
      const byName = (n) => S.order.find((x) => x === n.toLowerCase() || S.sq[x].name.toLowerCase() === n.toLowerCase()) || n;
      const presenters = pop.querySelector('#mnP').value.split(',').map((x) => x.trim()).filter(Boolean).map(byName);
      const r = await api('/meetings', { op: 'now', attendees, presenters, topic: pop.querySelector('#mnT').value.trim(), by: me().id });
      if (r?.error) return toast(r.error);
      closePop(); toast(`Meeting on: ${r.title}`);
    };
  });
}
$('#calNow').onclick = (e) => meetNowPop(e.currentTarget);
$('#teamMeet').onclick = (e) => meetNowPop(e.currentTarget);
$('#calWeek').onclick = (e) => {
  const m = e.target.closest('[data-meeting]'); if (m) return editMeeting(m, m.dataset.meeting, m.dataset.date, m.dataset.start);
  const g = e.target.closest('[data-goal]'); if (g) editGoal(g);
};

// ---------- tabs: Room | Lead | Team | Calendar | Goals | Tasks | Merge ----------
function setView(v, who, nav) {
  // lead and one are the office: one squiggle alone with the user (lead = the lead's office, one = anyone else's).
  // meeting is the office for a meeting's attendees together.
  if (v === 'meeting' && !S.meeting) v = 'room';
  const office = v === 'lead' || v === 'one' || v === 'meeting';
  if (v === 'lead') who = leadId() || who; if (v === 'one' && !who) v = 'room'; if (v === 'meeting') who = meetOrder();
  B.view = v; B.who = who; closePop(); paintMeetOn(); if (v !== 'merge' && B.diff) closeDiff(false);
  document.body.classList.toggle('v-goals', v === 'goals'); document.body.classList.toggle('v-tasks', v === 'tasks'); document.body.classList.toggle('v-merge', v === 'merge'); document.body.classList.toggle('v-team', v === 'team'); document.body.classList.toggle('v-settings', v === 'settings'); document.body.classList.toggle('v-cal', v === 'calendar');
  document.body.classList.toggle('v-one', office); document.body.classList.toggle('v-meet', v === 'meeting'); if (v !== 'meeting') document.body.classList.remove('sharing'); document.body.classList.toggle('v-lead', v === 'lead'); if (v === 'lead') loadCall(); setOffice(office ? who : '');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('.tabs .tmore').classList.toggle('on', ['team', 'calendar', 'goals'].includes(v)); moreTabs(false);
  try { localStorage.agentsView = v === 'one' ? 'one:' + who : v; } catch {}
  // The view lives in the URL (?view=tasks, ?view=one&with=<id>): back, forward, new tabs and copied links (t348).
  const q = viewUrl(v, who);
  if (nav !== 'none' && location.search !== q) history[nav === 'replace' ? 'replaceState' : 'pushState'](null, '', location.pathname + q);
  if (v === 'room' || office) layout(); else loadBoard();
  if (v === 'merge') loadMerges();
  if (v === 'team') { renderTeam(); loadHumans(); }
  if (v === 'calendar') loadCal();
  if (v === 'settings') { if (typeof renderSettings === 'function') renderSettings(); loadHumans(); }
  // Entering an office puts the cursor in its chat (t188). Not on touch screens: it would pop the keyboard.
  if ((v === 'lead' || v === 'one') && matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => document.querySelector(`#cw-${S.officeIds[0]} textarea`)?.focus());
}
// Phone bottom bar (t154): More opens Team, Calendar and Goals above the bar.
const moreTabs = (on) => { $('.tabs').classList.toggle('open', on); $('.tabs .tmore').setAttribute('aria-expanded', String(on)); };
document.querySelector('.tabs').onclick = (e) => { if (e.target.closest('.tmore')) { e.stopPropagation(); return moreTabs(!$('.tabs').classList.contains('open')); } const v = e.target.dataset.view; if (v) setView(v); };
document.addEventListener('click', (e) => { if (!e.target.closest('.tabs')) moreTabs(false); });
function viewUrl(v = B.view, who = B.who) {
  const p = new URLSearchParams(); if (v && v !== 'room') p.set('view', v); if (v === 'one') p.set('with', who);
  // Board filters: goals search; tasks search, goal, owner and show (open is the default).
  if (v === 'goals' && B.gq) p.set('q', B.gq);
  if (v === 'tasks') { if (B.tq) p.set('q', B.tq); if (B.tgoal) p.set('goal', B.tgoal); if (B.towner) p.set('owner', B.towner); if (B.tshow !== 'open') p.set('show', B.tshow); }
  // Merge diff and calendar week: week only when it isn't this week.
  if (v === 'merge' && B.diff) p.set('diff', B.diff);
  if (v === 'settings' && B.stab && B.stab !== 'room') p.set('tab', B.stab);
  if (v === 'calendar' && ymd(B.week) !== ymd(mondayOf(new Date()))) p.set('week', ymd(B.week));
  const c = chatParam(v || 'room'); if (c) p.set('chat', c);
  const s = p.toString(); return s ? '?' + s : '';
}
// Opening, raising or closing a floating chat updates the URL in place, without a history step.
function syncUrl() { const q = viewUrl(); if (location.search !== q) history.replaceState(null, '', location.pathname + q); }
const SET_TABS = ['room', 'characters', 'squiggles', 'people', 'sharing', 'defaults', 'security'], setTab = (t) => (SET_TABS.includes(t) ? t : 'room');
const VIEWS = ['room', 'lead', 'meeting', 'one', 'team', 'calendar', 'goals', 'tasks', 'merge', 'settings'];
function viewFromUrl(search, nav) {
  const q = new URLSearchParams(search), v = q.get('view');
  if (!VIEWS.includes(v)) return false;
  if (v === 'goals') $('#gq').value = B.gq = q.get('q') || '';
  if (v === 'tasks') { $('#tq').value = B.tq = q.get('q') || ''; B.tgoal = q.get('goal') || ''; B.towner = q.get('owner') || ''; B.tshow = ['open', 'all', 'stale', 'suggest'].includes(q.get('show')) ? q.get('show') : 'open'; }
  if (v === 'settings') B.stab = setTab(q.get('tab'));
  if (v === 'calendar') { const w = /^(\d{4})-(\d\d)-(\d\d)$/.exec(q.get('week') || ''); B.week = mondayOf(w ? new Date(+w[1], w[2] - 1, +w[3]) : new Date()); }
  const d = v === 'merge' && q.get('diff'); if (!d) closeDiff(false);
  setView(v, q.get('with') || '', nav); if (d) openDiff(d); return true;
}
window.addEventListener('popstate', () => {
  if (!viewFromUrl(location.search, 'none')) setView('room', '', 'none');
  const c = new URLSearchParams(location.search).get('chat'); if (S.joined && S.sq[c]) openChat(c);
});
// The URL wins; without one, the last view.
setTimeout(() => {
  if (viewFromUrl(URL0, 'replace')) return;
  let v = ''; try { v = localStorage.agentsView || ''; } catch {}
  if (['goals', 'tasks', 'lead', 'merge', 'team', 'calendar', 'settings'].includes(v)) setView(v, '', 'replace'); else if (v.startsWith('one:')) setView('one', v.slice(4), 'replace');
}, 0);
loadBoard();
document.querySelector('.brand').onclick = () => setView('room');

// ---------- the lead in a Teams call (Lead tab); CLI: call <url> | call status | call leave ----------
async function loadCall() {
  const c = await api('/call'); if (!c || c.error) return;
  $('#callState').textContent = c.live ? `${c.name} is in the call${c.ends ? ` until ${c.ends.slice(11)}` : ''}` : 'Not in a call';
  $('#callState').title = c.live ? c.url : (c.log || []).slice(-3).join('\n');
  $('#callUrl').hidden = $('#callUntil').hidden = $('#callJoin').hidden = !!c.live; $('#callLeave').hidden = !c.live;
}
$('#callBar').onsubmit = async (e) => {
  e.preventDefault(); const url = $('#callUrl').value.trim(); if (!url) return;
  const until = $('#callUntil').value, r = await api('/call', { op: 'join', url, ...(until ? { until } : {}) }); if (r?.error) return toast(r.error);
  $('#callUrl').value = $('#callUntil').value = ''; toast(`${r.name} is joining the call`); loadCall();
};
$('#callLeave').onclick = async () => { const r = await api('/call', { op: 'leave' }); toast(r?.error || r); loadCall(); };
window.onCall = loadCall;

// ---------- task ids as links (t822) ----------
// Any rendered text naming a task that exists (t227) gets a link: a popover with its title, status, owner and branch,
// and a button that opens it on the board. Skips code, links and form fields. Idempotent, so re-run after the board loads.
const TID = /\bt\d{1,5}\b/g;
function linkTasks(root) {
  if (!root || !B.tasks.length) return;
  const ids = new Set(B.tasks.map((t) => t.id)), walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.parentElement.closest('code,pre,a,.tlink,textarea,input,select,script,style,.mmirror') || !/\bt\d/.test(n.data) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  }), hits = [];
  while (walk.nextNode()) hits.push(walk.currentNode);
  for (const n of hits) {
    const parts = n.data.split(/(\bt\d{1,5}\b)/); if (!parts.some((p, i) => i % 2 && ids.has(p))) continue;
    const f = document.createDocumentFragment();
    parts.forEach((p, i) => { if (i % 2 && ids.has(p)) { const a = document.createElement('a'); a.className = 'tlink'; a.dataset.tid = p; a.href = '#'; a.textContent = p; f.append(a); } else if (p) f.append(p); });
    n.replaceWith(f);
  }
}
const linkAll = () => ['#chats', '#meetThread', '#corkcols', '#stage'].forEach((s) => linkTasks(document.querySelector(s)));
function taskPop(a) {
  const t = B.tasks.find((x) => x.id === a.dataset.tid); if (!t) return;
  const st = COLS.find(([s]) => s === t.status)?.[1] || t.status;
  showPop(a, `<div class="tpop"><div class="tph"><b>${esc(t.id)}</b><span>${esc(st)}</span></div><div class="tpt">${esc(t.title)}</div>
    <dl>${t.owner ? `<dt>Owner</dt><dd>${esc(ownerName(t.owner))}</dd>` : ''}${t.goal ? `<dt>Goal</dt><dd>${esc(goalById(t.goal)?.title || t.goal)}</dd>` : ''}${t.branch ? `<dt>Branch</dt><dd><code>${esc(t.branch)}</code></dd>` : ''}</dl>
    <div class="row"><button class="go" data-a="open">Open on the board</button></div></div>`, (pop) => {
    pop.classList.add('tpop-on');
    pop.onclick = (e) => { if (e.target.dataset.a === 'open') { closePop(); openTaskNote(t.id); } };
  });
}
// Shows one note on the Tasks board with filters cleared enough to include it, then opens it.
function openTaskNote(id) {
  const t = B.tasks.find((x) => x.id === id); if (!t) return;
  B.tgoal = ''; B.tq = ''; B.towner = t.owner && S.sq[t.owner] ? t.owner : ''; if (!taskVisible(t)) B.tshow = 'all';
  $('#tq').value = ''; setView('tasks'); renderTasks();
  const n = document.querySelector(`#corkcols [data-task="${id}"]`); if (!n) return;
  n.scrollIntoView({ block: 'center' }); n.classList.add('new'); editTask(n);
}
document.addEventListener('click', (e) => { const a = e.target.closest('a.tlink'); if (!a) return; e.preventDefault(); e.stopPropagation(); taskPop(a); }, true);
