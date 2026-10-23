// Command approvals. A squiggle files the exact command it was blocked
// from running; the owner sees a card in the lead's chat and in that squiggle's 1:1 with Copy, Run and Deny. CLI: asks, ask show|deny.
// Run is this computer only (the server decides; /asks/can only says whether to show the button) and binds to the bytes the card
// rendered: sha256 of cwd NUL cmd as UTF-8, same as asks.mjs.
const ASK = { list: [], recent: [], can: { run: false }, shown: {} };

// Invisible and direction-changing characters are drawn as <U+XXXX>, controls as \xNN, tabs as \t.
const HIDDEN = /[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|\udb40[\udc00-\udc7f]/;
const ODDSPACE = /[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const hex = (c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
// Padding can't push a tail out of sight: 2+ blank or space-only lines in a row, and 8+ spaces in a row,
// are drawn as one marked span.
function showCmd(s) {
  let hidden = 0, other = 0, blank = 0, pad = 0;
  const line = (l) => {
    let h = '', sp = 0;
    const flush = () => { if (sp >= 8) { pad++; h += `<span class="inv">[${sp} spaces]</span>`; } else h += ' '.repeat(sp); sp = 0; };
    for (const c of l) {
      if (c === ' ') { sp++; continue; }
      if (sp) flush();
      if (c === '\t') h += '<span class="inv">\\t</span>';
      else if (/[\u0000-\u001f\u007f-\u009f]/.test(c)) { hidden++; h += `<span class="inv">\\x${hex(c).slice(2)}</span>`; }
      else if (HIDDEN.test(c) || ODDSPACE.test(c)) { hidden++; h += `<span class="inv">&lt;U+${hex(c)}&gt;</span>`; }
      else { if (c > '~') other++; h += esc(c); }
    }
    if (sp) flush();
    return h;
  };
  const lines = s.split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    let j = i; while (j < lines.length && /^[ \t]*$/.test(lines[j])) j++;
    if (j - i >= 2) { blank = Math.max(blank, j - i); out.push(`<span class="inv">[${j - i} blank lines]</span>`); i = j - 1; }
    else out.push(line(lines[i]));
  }
  return { html: out.join('\n'), hidden, other, blank, pad, lines: lines.length };
}
// Shapes worth a second look. Words, not colours alone.
const RISKY = [
  [/\brm\s+(-\S+\s+)*-[a-zA-Z]*([rR][a-zA-Z]*f|f[a-zA-Z]*[rR])|\brm\s.*--recursive/, 'deletes recursively'],
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b/, 'pipes a download into a shell'],
  [/\bgit\s+push\b/, 'pushes with git'],
  [/\bgit\s+(reset\s+--hard|clean\s+-\S*f|branch\s+-D|checkout\s+--\s|restore\s)/, 'throws away git work'],
  [/\bcurl\b[^;|&]*\s(-[a-zA-Z]*[dFT]|--(data[\w-]*|form[\w-]*|upload-file|json)(\s|=|$))|\bwget\b[^;|&]*--(post|body)-(data|file)|\b(nc|ncat|netcat|socat)\b/, 'sends data out'],
  [/(^|[\s;|&(`])(ssh|scp|sftp|rsync)\s/m, 'reaches another machine'],
  [/\bdokku\b|\bdt\s+(deploy|ssh|dns|cf)\b/, 'changes the fleet'],
  [/\bsudo\b/, 'runs as root'],
  [/\b(chmod|chown)\s+-R\b|\bmkfs\b|\bdd\s+if=|>\s*\/dev\/(disk|sd|nvme)/, 'changes permissions or disks'],
  [/\b(drop\s+(table|database)|dropDatabase|deleteMany|flushall|truncate\s+table)\b/i, 'deletes data'],
  [/\bkill(all)?\b|\bpkill\b|\blaunchctl\s+(bootout|unload)/, 'stops processes'],
];
const risky = (cmd) => RISKY.filter(([re]) => re.test(cmd)).map(([, w]) => w);
async function askSha(cwd, cmd) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${cwd}\u0000${cmd}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const askWho = (id) => S.sq[id]?.name || id;
const askTime = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function askCard(a) {
  ASK.shown[a.id] = { cwd: a.cwd, cmd: a.cmd };
  const c = showCmd(a.cmd), d = showCmd(a.cwd), r = risky(a.cmd);
  const run = ASK.can.run || ASK.can.local
    ? '<button class="chip primary" data-a="run">Run</button>'
    : '<span class="asknote">Run works only on the computer running the room. Copy it there.</span>';
  return `<div class="ask" data-id="${esc(a.id)}" data-ts="${+new Date(a.created)}">
    <div class="askh"><b>${esc(askWho(a.by))}</b> asks to run this <small>${esc(a.id)}, ${esc(askTime(a.created))}, in <code>${d.html}</code>${c.lines > 1 ? `, ${c.lines} lines` : ''}</small></div>
    ${a.why ? `<p class="askwhy">${esc(a.why)}</p>` : ''}
    ${r.length ? `<p class="askrisk">Careful: ${esc(r.join(', '))}.</p>` : ''}
    ${c.hidden || d.hidden ? `<p class="askrisk">Contains ${c.hidden + d.hidden} hidden or control character${c.hidden + d.hidden === 1 ? '' : 's'}, shown in brackets.</p>` : ''}
    ${c.blank || c.pad ? `<p class="askrisk">Padded with ${c.blank ? `${c.blank} blank lines in a row` : 'long runs of spaces'}, shown in brackets.</p>` : ''}
    ${c.other ? `<p class="asknote">Contains ${c.other} non-ASCII character${c.other === 1 ? '' : 's'}.</p>` : ''}
    <pre class="askcmd"><code>${c.html}</code></pre>
    <div class="askb"><button class="chip" data-a="copy">Copy</button>${run}<button class="chip" data-a="deny">Deny</button></div>
  </div>`;
}
function askDone(a) {
  const st = a.status === 'done' ? 'ran' : a.status === 'failed' ? `failed, exit ${a.exit}` : a.status;
  return `<details class="ask past" data-id="${esc(a.id)}" data-ts="${+new Date(a.created)}"><summary><b>${esc(askWho(a.by))}</b>'s ask ${esc(a.id)} ${esc(st)}${a.ms != null ? ` in ${Math.max(1, Math.round(a.ms / 1000))}s` : ''}</summary>
    <pre class="askcmd"><code>${showCmd(a.cmd).html}</code></pre>
    ${a.out != null ? `<pre class="askout">${esc(a.out || '(no output)')}</pre>` : ''}</details>`;
}
// Asks sit in the chat stream where they were filed: the lead's chat shows every ask, a 1:1 its own.
// Past asks from before a clear stay cleared; pending ones always show.
function paintAsks(cw) {
  const id = cw.dataset.id, lead = S.sq[id]?.lead, mine = (a) => lead || a.by === id, box = cw.querySelector('.msgs');
  if (!box) return;
  const cut = +cw.dataset.cleared || 0, at = (a) => +new Date(a.created);
  const want = [...ASK.list.filter(mine).map((a) => [a, askCard(a)]), ...ASK.recent.filter((a) => mine(a) && at(a) > cut).map((a) => [a, askDone(a)])];
  const keep = new Set(want.map(([a]) => a.id));
  for (const el of box.querySelectorAll(':scope > .ask')) if (!keep.has(el.dataset.id)) el.remove();
  for (const [a, html] of want) {
    const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild;
    const old = box.querySelector(`:scope > .ask[data-id="${CSS.escape(a.id)}"]`);
    if (old) { if (old.open) el.open = true; if (old.outerHTML !== el.outerHTML) old.replaceWith(el); continue; }
    const next = [...box.children].find((x) => x.dataset.ts && +x.dataset.ts > at(a));
    box.querySelector('.empty')?.remove(); box.insertBefore(el, next || null);
  }
  if (box.pinned !== false) pinBottom(box);
}
function paintAskBadge() {
  const b = $('#asksBtn'), n = ASK.list.length;
  b.hidden = !n; b.textContent = `${n} ask${n === 1 ? '' : 's'}`;
  b.title = n ? `Commands waiting for you: ${[...new Set(ASK.list.map((a) => askWho(a.by)))].join(', ')}` : '';
}
async function loadAsks() {
  const [list, all, can] = await Promise.all([api('/asks'), api('/asks?all=1'), api('/asks/can')]).catch(() => [null]);
  if (!Array.isArray(list)) return;
  const day = Date.now() - 864e5;
  ASK.list = list; ASK.can = can || { run: false }; ASK.recent = (all || []).filter((a) => a.status !== 'pending' && a.ended > day && ['done', 'failed', 'interrupted'].includes(a.status));
  paintAskBadge(); document.querySelectorAll('.cw').forEach(paintAsks);
}
// Run uses a raw fetch: api() reloads the page on a 401, and a locked Run is one.
const askPost = (b) => fetch('/api/asks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => ({ error: 'Request failed' }));
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.ask .askb button'); if (!btn) return;
  const id = btn.closest('.ask').dataset.id, a = ASK.list.find((x) => x.id === id), shown = ASK.shown[id]; if (!a || !shown) return;
  if (btn.dataset.a === 'copy') {
    try { await navigator.clipboard.writeText(shown.cmd); } catch { const t = document.createElement('textarea'); t.value = shown.cmd; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
    btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1500); return;
  }
  if (btn.dataset.a === 'deny') {
    if (!await askCode(`Deny ${askWho(a.by)}'s ask?`, `<p>${esc(askWho(a.by))} hears it was denied. It can't be run after this.</p>`, 'Deny', null)) return;
    const r = await unlocked(() => api('/asks', { op: 'deny', id }), 'Unlock to deny'); if (r?.error) toast(r.error); return loadAsks();
  }
  if (btn.dataset.a === 'run') {
    const r0 = risky(shown.cmd);
    if (!await askCode(`Run ${a.id}?`, `<p>Runs once, as you, in <code>${showCmd(shown.cwd).html}</code>. ${esc(askWho(a.by))} gets the output.</p><pre class="askcmd"><code>${showCmd(shown.cmd).html}</code></pre>${r0.length ? `<p class="askrisk">Careful: ${esc(r0.join(', '))}.</p>` : ''}`, 'Run', null)) return;
    btn.disabled = true; btn.textContent = 'Running';
    const sha = await askSha(shown.cwd, shown.cmd);
    const r = await unlocked(() => askPost({ op: 'run', id, sha }), 'Unlock to run');
    if (r === null) { btn.disabled = false; btn.textContent = 'Run'; return; }
    if (r?.error) { toast(r.error); return loadAsks(); }
    toast(`Running ${id}. ${askWho(a.by)} gets the output.`);
  }
});
$('#asksBtn').onclick = () => {
  const by = [...new Set(ASK.list.map((a) => a.by))], lead = S.order.find((x) => S.sq[x].lead);
  const id = by.length === 1 && S.sq[by[0]] ? by[0] : lead; if (id) oneOnOne(id);
};
loadAsks();
