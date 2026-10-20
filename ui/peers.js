// Settings > Sharing > Peers (t1174). CLI: peers, peer invite|join|cancel|remove|on|off.
const PEER = { d: null, panel: '', code: '', exp: '', err: '', busy: false, confirm: '', note: '', paste: '', timer: 0 };
const peerTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const peerAgo = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const peerHost = (u) => { try { return new URL(u).hostname; } catch { return u || ''; } };
// The same check the server makes, so a paste previews before Link.
function peerCode(s) {
  s = String(s || '').trim(); if (!s.startsWith('squiggles-peer1.')) return null;
  try {
    const c = JSON.parse(atob(s.slice(16).replace(/-/g, '+').replace(/_/g, '/')));
    return /^[a-z0-9][a-z0-9-]{0,31}$/i.test(c.name) && /^https?:\/\//.test(c.url) && c.key ? c : null;
  } catch { return null; }
}
async function loadPeers() {
  const d = await fetch('/api/peers').then((r) => r.json()).catch(() => null); if (!d || d.error) return;
  // Our invite was spent or ran out since the last look.
  if (PEER.panel === 'code' && !d.pending) {
    if (new Date(PEER.exp) <= Date.now()) { PEER.panel = 'name'; PEER.err = 'Expired. Make a new code.'; } else PEER.panel = '';
  }
  PEER.d = d; clearTimeout(PEER.timer);
  if (d.pending) PEER.timer = setTimeout(loadPeers, Math.max(1000, new Date(d.pending.expires) - Date.now() + 500));
  paintPeers();
}
function peerLast(p) {
  const t = [p.lastIn && `in ${peerAgo(p.lastIn)}`, p.lastOut && `out ${peerAgo(p.lastOut)}`].filter(Boolean).join(', ');
  const title = [p.lastIn && `In ${new Date(p.lastIn).toLocaleString()}`, p.lastOut && `out ${new Date(p.lastOut).toLocaleString()}`].filter(Boolean).join(', ');
  return { text: t ? t[0].toUpperCase() + t.slice(1) : 'None yet', title };
}
function peerRow(p) {
  if (PEER.confirm === p.name) return `<tr><td colspan="5"><span class="prm">Remove ${esc(p.name)}? Their messages will be refused.</span> <button class="chip" data-p="remove" data-n="${esc(p.name)}">Remove</button> <button class="chip" data-p="noremove">Cancel</button></td></tr>`;
  const last = peerLast(p), host = peerHost(p.url);
  const st = p.lastError ? `<td class="st-bad" title="${esc(p.lastError)}">${p.lastErrorKind === 'refused' ? 'Key refused' : "Can't reach"}</td>` : '<td>Linked</td>';
  return `<tr><td>${esc(p.name)}<span class="psub">${esc(host)} · ${esc(last.text.toLowerCase())}</span></td><td class="hide-s">${esc(host)}</td><td class="hide-s" title="${esc(last.title)}">${esc(last.text)}</td>${st}<td><button class="chip" data-p="confirm" data-n="${esc(p.name)}">Remove</button></td></tr>`;
}
function paintPeers() {
  const d = PEER.d, el = $('#peerBody'); if (!d || !el) return;
  $('#peersOn').checked = !!d.on;
  if (!d.on) { el.innerHTML = '<p class="sethint">Peers are off. Nothing links, and nothing from another room arrives.</p>'; return; }
  if (el.contains(document.activeElement) && document.activeElement.matches('textarea:not([readonly]), input')) return; // don't wipe what the user is typing
  const share = !!d.self?.url, rows = d.peers.map(peerRow);
  if (d.pending) rows.push(`<tr><td>Invite<span class="psub">expires ${esc(peerTime(d.pending.expires))}</span></td><td class="hide-s">—</td><td class="hide-s">—</td><td class="st-wait">Waiting for them to paste it</td><td><button class="chip" data-p="cancel">Cancel</button></td></tr>`);
  const table = rows.length ? `<table class="ptable"><thead><tr><th>Peer</th><th class="hide-s">Address</th><th class="hide-s">Last message</th><th>Status</th><th aria-label="Actions"></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="sethint">No peers yet.</p>';
  const err = PEER.err ? `<span class="err" role="alert">${esc(PEER.err)}</span>` : '';
  let panel = '';
  if (PEER.panel === 'name') panel = `<div class="ppanel"><label for="peerName">This room's name, as they'll see it</label><input type="text" id="peerName" value="${esc(d.self?.name || '')}" autocomplete="off" spellcheck="false">${err}<div class="row"><button class="chip primary" data-p="make" ${PEER.busy ? 'disabled' : ''}>Make code</button><button class="chip" data-p="close">Cancel</button></div></div>`;
  if (PEER.panel === 'code') panel = `<div class="ppanel"><label for="peerCodeOut">Send them this code. Works once. Expires at ${esc(peerTime(PEER.exp))}.</label><textarea id="peerCodeOut" class="code" rows="4" readonly>${esc(PEER.code)}</textarea><div class="row"><button class="chip primary" data-p="copy">Copy code</button><button class="chip" data-p="cancel">Cancel invite</button></div></div>`;
  if (PEER.panel === 'add') {
    const c = peerCode(PEER.paste);
    const pre = !PEER.paste.trim() ? '' : c ? `<span class="pnote">Room <b>${esc(c.name)}</b> at ${esc(peerHost(c.url))}</span>` : '<span class="pnote">That isn\'t a pairing code.</span>';
    panel = `<div class="ppanel"><label for="peerPaste">Paste their pairing code</label><textarea id="peerPaste" class="code" rows="4" spellcheck="false">${esc(PEER.paste)}</textarea><span id="peerPre">${pre}</span>${err}<div class="row"><button class="chip primary" data-p="link" ${c && !PEER.busy ? '' : 'disabled'}>${PEER.busy ? 'Linking…' : 'Link'}</button><button class="chip" data-p="close">Cancel</button></div></div>`;
  }
  const acts = PEER.panel ? '' : `<div class="pact"><button class="chip primary" data-p="invite" ${share ? '' : 'disabled'}>Invite a peer</button><button class="chip" data-p="add">Add peer</button></div>${share ? '' : '<p class="sethint">Turn on Share the room first: they need to reach this Mac.</p>'}`;
  el.innerHTML = table + panel + acts + (PEER.note ? `<p class="sethint" role="status">${esc(PEER.note)}</p>` : '');
  for (const t of el.querySelectorAll('textarea.code')) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; } // the whole code, no scrolling
}
const peerPost = (b) => fetch('/api/peers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch((e) => ({ error: e.message }));
$('#peersOn').onchange = async (e) => { const r = await peerPost({ op: e.target.checked ? 'on' : 'off' }); if (r.error) toast(r.error); loadPeers(); };
$('#peerBody').oninput = (e) => {
  if (e.target.id !== 'peerPaste') return;
  PEER.paste = e.target.value; PEER.err = ''; e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight + 2}px`; const c = peerCode(PEER.paste);
  $('#peerPre').innerHTML = !PEER.paste.trim() ? '' : c ? `<span class="pnote">Room <b>${esc(c.name)}</b> at ${esc(peerHost(c.url))}</span>` : '<span class="pnote">That isn\'t a pairing code.</span>';
  $('#peerBody [data-p="link"]').disabled = !c; $('#peerBody .err')?.remove();
};
$('#peerBody').addEventListener('focusin', (e) => { if (e.target.id === 'peerCodeOut') setTimeout(() => e.target.select(), 0); });
$('#peerBody').onclick = async (e) => {
  const b = e.target.closest('[data-p]'); if (!b) return;
  const a = b.dataset.p, focus = (id) => setTimeout(() => $(id)?.focus(), 0);
  PEER.note = '';
  if (a === 'invite') { PEER.panel = 'name'; PEER.err = ''; paintPeers(); focus('#peerName'); return; }
  if (a === 'add') { PEER.panel = 'add'; PEER.err = ''; PEER.paste = ''; paintPeers(); focus('#peerPaste'); return; }
  if (a === 'close') { PEER.panel = ''; PEER.err = ''; document.activeElement?.blur(); paintPeers(); return; }
  if (a === 'confirm') { PEER.confirm = b.dataset.n; paintPeers(); return; }
  if (a === 'noremove') { PEER.confirm = ''; paintPeers(); return; }
  if (a === 'copy') {
    try { await navigator.clipboard.writeText(PEER.code); } catch { $('#peerCodeOut').select(); document.execCommand('copy'); }
    b.textContent = 'Copied'; setTimeout(() => { if (b.isConnected) b.textContent = 'Copy code'; }, 2000); return;
  }
  if (a === 'remove') { const r = await peerPost({ op: 'remove', name: b.dataset.n }); PEER.confirm = ''; if (r.error) toast(r.error); else PEER.note = 'Removed. Their side stays until they remove you.'; return loadPeers(); }
  if (a === 'cancel') { await peerPost({ op: 'cancel' }); PEER.panel = ''; PEER.code = ''; return loadPeers(); }
  if (a === 'make') {
    const name = $('#peerName').value.trim(); PEER.busy = true; paintPeers();
    const r = await peerPost({ op: 'invite', name }); PEER.busy = false; document.activeElement?.blur();
    if (r.error) { PEER.err = r.error.replace(/^name: /, 'Name: '); paintPeers(); return; }
    PEER.panel = 'code'; PEER.code = r.code; PEER.exp = r.expires; PEER.err = ''; return loadPeers();
  }
  if (a === 'link') {
    PEER.busy = true; PEER.err = ''; document.activeElement?.blur(); paintPeers();
    const r = await peerPost({ op: 'join', code: PEER.paste }); PEER.busy = false;
    if (r.error) { PEER.err = r.error; paintPeers(); return; }
    PEER.panel = ''; PEER.paste = ''; return loadPeers();
  }
};
GATE.then(loadPeers);
