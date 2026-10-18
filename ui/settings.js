// Settings view (t836). CLI: room view settings. Characters: try a pack on everyone at tile and mini size, then use it for the room or one squiggle.
const SET = { gen: '', talk: 0 };
function renderSettings() {
  const room = roomGen(), sel = $('#setGen');
  if (!SET.gen || !GENS[SET.gen]) SET.gen = room;
  sel.innerHTML = Object.values(GENS).map((g) => `<option value="${g.id}"${g.id === SET.gen ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  $('#setNow').textContent = `The room uses ${GENS[room].name}.`;
  $('#setRoom').disabled = SET.gen === room; $('#setRoom').textContent = SET.gen === room ? `${GENS[room].name} is the room's pack` : `Use ${GENS[SET.gen].name} for the room`;
  // A squiggle keeps its own options when it already uses this pack; otherwise it gets the pack's seeded look.
  $('#setGrid').innerHTML = S.order.map((id) => {
    const s = S.sq[id], own = s.look && parseLook(s.look).gen === SET.gen, p = persona({ ...s, look: own ? s.look : SET.gen }), mine = P(id).gen === SET.gen;
    return `<div class="setsq"><div class="tile">${avatarSVG(p, undefined, 'st' + p.gid + '_')}</div>
      <div class="who"><div class="tile mini">${avatarSVG(p, undefined, 'sm' + p.gid + '_')}</div><div><b>${esc(s.name)}</b><small>${mine ? `Uses ${esc(GENS[SET.gen].name)}` : `Uses ${esc(GENS[P(id).gen].name)}`}</small></div></div>
      <button class="chip" data-use="${id}"${mine && own ? ' disabled' : ''}>Use for ${esc(s.name)}</button></div>`;
  }).join('');
  setTalk(); renderSetSqs(); renderDefaults();
}
// Squiggles card (t897): model, effort, cadence, paused and pack per squiggle; each change posts to /update, like the CLI's set and look.
// Option lists shared by the Squiggles and Team defaults cards. A value outside the list (set from the CLI) is kept and shown.
const withCur = (l, cur) => (cur != null && cur !== '' && !l.includes(cur) ? [...l, cur] : l), opt = (v, cur, label) => `<option value="${v}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
const cap = (m) => ({ xhigh: 'Extra high' })[m] || m[0].toUpperCase() + m.slice(1);
const every = (m) => (!m ? 'Only when asked' : m % 1440 === 0 ? (m === 1440 ? 'Daily' : `Every ${m / 1440} days`) : m % 60 === 0 ? (m === 60 ? 'Hourly' : `Every ${m / 60} hours`) : `Every ${m} min`);
const modelOpts = (cur) => withCur(['', 'opus', 'sonnet', 'gpt-6.1-sol'], cur).map((m) => opt(m, cur, m ? modelName(m) : 'Default (Opus 5.5)')).join('');
const effortOpts = (cur, lead) => withCur(['', 'low', 'medium', 'high', 'xhigh', 'max'], cur).map((m) => opt(m, cur, m ? cap(m) : lead ? 'Default' : 'Medium (default)')).join('');
const everyOpts = (cur) => withCur([0, 15, 30, 60, 180, 360, 720, 1440], cur || 0).sort((x, y) => x - y).map((m) => opt(m, cur || 0, every(m))).join('');
// Team defaults card (t898): what a new squiggle starts with. CLI: defaults.
async function renderDefaults() {
  const d = await api('/defaults'); if (!d || d.error) return;
  $('#defModel').innerHTML = modelOpts(d.model); $('#defEffort').innerHTML = effortOpts(d.effort); $('#defEvery').innerHTML = everyOpts(d.every);
}
$('#setDefaults').onchange = async (e) => {
  const f = e.target.dataset.f; if (!f) return;
  const r = await api('/defaults', { [f]: f === 'every' ? Number(e.target.value) : e.target.value });
  if (!r || r.error) return toast(r?.error || 'Not saved');
  toast('Saved team defaults');
};
function renderSetSqs() {
  const cell = (label, html) => `<td><label class="sqf"><span class="sqlab">${label}</span>${html}</label></td>`;
  $('#setSqs').innerHTML = `<table class="sqtable"><thead><tr><th scope="col">Squiggle</th><th scope="col">Model</th><th scope="col">Effort</th><th scope="col">Wakes</th><th scope="col">Pack</th><th scope="col">Paused</th></tr></thead><tbody>` + S.order.map((id) => {
    const s = S.sq[id], own = s.look ? parseLook(s.look).gen : '';
    return `<tr data-sq="${id}"><th scope="row"><span class="sqname"><span class="tile mini">${avatarSVG(P(id), undefined, 'sq' + P(id).gid + '_')}</span><b>${esc(s.name)}</b></span></th>
      ${cell('Model', `<select data-f="model">${modelOpts(s.model)}</select>`)}
      ${cell('Effort', `<select data-f="effort">${effortOpts(s.effort, s.lead)}</select>`)}
      ${cell('Wakes', `<select data-f="every">${everyOpts(s.every)}</select>`)}
      ${cell('Pack', `<select data-f="look">${opt('', own, 'Room pack')}${Object.values(GENS).map((g) => opt(g.id, own, g.name)).join('')}</select>`)}
      <td><label class="sqpause"><input data-f="paused" type="checkbox"${s.paused ? ' checked' : ''}><span class="sqlab">Paused</span></label></td></tr>`;
  }).join('') + '</tbody></table>';
}
$('#setSqs').onchange = async (e) => {
  const f = e.target.dataset.f, id = e.target.closest('[data-sq]')?.dataset.sq, s = S.sq[id]; if (!f || !s) return;
  const v = e.target.value, val = f === 'paused' ? e.target.checked : f === 'every' ? Math.max(0, Number(v) || 0)
    : f === 'look' ? (!v ? '' : s.look && parseLook(s.look).gen === v ? s.look : v) : v || null;
  const r = await api(`/squiggles/${id}/update`, { [f]: val });
  if (!r || r.error) return toast(r?.error || 'Not saved');
  Object.assign(s, r); if (f === 'look') reskin(id);
  renderSettings(); toast(`Saved ${s.name}`);
};
// Talking: every preview speaks with a moving mouth, as in the room.
function setTalk() {
  const on = $('#setTalk').checked && B.view === 'settings';
  document.querySelectorAll('#setGrid .tile').forEach((t) => t.classList.toggle('speaking', on));
  clearInterval(SET.talk); SET.talk = 0;
  if (on) SET.talk = setInterval(() => { if (B.view !== 'settings') return setTalk(); document.querySelectorAll('#setGrid .tile').forEach((t) => setMouth(t, (1 + Math.random() * 3.6).toFixed(1), (3.6 + Math.random()).toFixed(1))); }, 120);
}
$('#setGen').onchange = (e) => { SET.gen = e.target.value; renderSettings(); };
$('#setTalk').onchange = setTalk;
$('#setRoom').onclick = async () => { const r = await api('/room', { action: 'characters', value: SET.gen }); if (r && r.error) return toast(r.error); roomGen(SET.gen); S.order.forEach(reskin); renderSettings(); };
$('#setGrid').onclick = async (e) => {
  const id = e.target.closest('[data-use]')?.dataset.use; if (!id) return;
  const s = S.sq[id], look = s.look && parseLook(s.look).gen === SET.gen ? s.look : SET.gen;
  await restyle(id, { look }); renderSettings(); toast(`${s.name} now uses ${GENS[SET.gen].name}`);
};
if (B.view === 'settings' && S.order.length) renderSettings(); // the squiggle list may load before this script
