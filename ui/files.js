// Files: files/ plus the research folders, newest first. Drop or pick files to add them to files/, optionally for a squiggle
// (a note on its pile). Only files/ deletes. CLI: files [query] | file add <path> [for <id>] | file rm <name>.
const FSRC = { files: 'Drops', research: 'Research' }; // extra sources (config fileSources) show by name
B.files = []; B.fq = '';
const fsize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
// The squiggles may arrive after the first render (a page opened on ?view=files): refill when the select is opened.
function fillFor() {
  const sel = $('#ffor'), cur = sel.value;
  if (sel.options.length === S.order.length + 1) return;
  sel.innerHTML = '<option value="">For nobody</option>' + S.order.map((id) => `<option value="${esc(id)}">For ${esc(S.sq[id]?.name || id)}</option>`).join(''); sel.value = cur;
}
$('#ffor').addEventListener('pointerdown', fillFor); $('#ffor').addEventListener('focus', fillFor);
async function loadFiles() {
  const r = await api(`/files?q=${encodeURIComponent(B.fq)}`); if (r?.error) return toast(r.error);
  B.files = r.files || []; renderFiles();
}
function renderFiles() {
  fillFor();
  $('#fcount').textContent = `${B.files.length} file${B.files.length === 1 ? '' : 's'}${B.fq ? ` matching “${B.fq}”` : ''}`;
  if (!B.files.length) { $('#flist').innerHTML = `<div class="empty">${B.fq ? 'Nothing matches.' : 'No files yet. Drop files here or press Add files.'}</div>`; return; }
  $('#flist').innerHTML = B.files.map((f) => `<div class="frow" data-name="${esc(f.name)}">
    <a class="fname" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.path)}">${esc(f.name)}</a>
    <span class="fmeta">${esc(FSRC[f.src] || f.src)} · ${new Date(f.mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${fsize(f.size)}${f.by ? ` · by ${esc(S.sq[f.by]?.name || B.humans.find((h) => h.id === f.by)?.name || f.by)}` : ''}${f.task ? ` · ${esc(f.task)}` : ''}</span>
    ${f.own ? '<button class="quiet fdel" data-a="rm">Delete</button>' : ''}</div>`).join('');
}
async function addFiles(list) {
  const who = $('#ffor').value;
  for (const file of list) {
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(file); });
    const r = await api('/files', { op: 'add', name: file.name, data, for: who || undefined, by: me().id });
    toast(r?.error || `Added ${r.name}${r.task ? ` for ${S.sq[who]?.name || who}` : ''}`);
  }
  loadFiles();
}
$('#fpick').onchange = (e) => { const l = [...e.target.files]; e.target.value = ''; if (l.length) addFiles(l); };
$('#fq').oninput = (e) => { clearTimeout(B.fqt); B.fqt = setTimeout(() => { B.fq = e.target.value.trim(); loadFiles(); }, 250); };
$('#flist').onclick = async (e) => {
  const a = e.target.closest('a.fname');
  if (a && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) { e.preventDefault(); return previewFile(B.files.find((f) => f.name === a.closest('.frow').dataset.name)); }
  if (e.target.dataset.a !== 'rm') return;
  const name = e.target.closest('.frow').dataset.name; if (!confirm(`Delete ${name} from files?`)) return;
  const r = await api('/files', { op: 'rm', name }); if (r?.error) return toast(r.error);
  toast(`Deleted ${name}`); loadFiles();
};
const fv = $('#filesView');
fv.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); fv.classList.add('drop'); } });
fv.addEventListener('dragleave', (e) => { if (!fv.contains(e.relatedTarget)) fv.classList.remove('drop'); });
fv.addEventListener('drop', (e) => { e.preventDefault(); fv.classList.remove('drop'); const l = [...e.dataTransfer.files]; if (l.length) addFiles(l); });
// Preview: images, PDF, markdown and text inline; anything else offers Download. Files stay on their sandboxed URL.
const FIMG = /\.(png|jpe?g|gif|webp|svg)$/i, FCODE = /\.(json|csv|log|html|js|mjs|ts|sh|ya?ml|xml|ics)$/i, FMAX = 512e3;
async function previewFile(f) {
  if (!f) return;
  const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase(), url = esc(f.url);
  $('#fprevBody').innerHTML = `<div class="dh"><h2>${esc(f.name)}</h2><span class="sp"></span><a class="chip" href="${url}" target="_blank" rel="noopener">Open</a><a class="chip" href="${url}" download="${esc(f.name.split('/').pop())}">Download</a><button data-a="close">Close</button></div><div class="fpb"><div class="empty">Loading…</div></div>`;
  $('#fprevBox').classList.add('on'); B.fprev = f.name;
  const body = $('#fprevBody .fpb');
  if (FIMG.test(ext)) body.innerHTML = `<img src="${url}" alt="${esc(f.name)}">`;
  else if (ext === '.pdf') body.innerHTML = `<iframe src="${url}" title="${esc(f.name)}"></iframe>`;
  else if (ext === '.md' || ext === '.txt' || FCODE.test(ext)) {
    const r = await fetch(f.url).catch(() => null); if (B.fprev !== f.name) return;
    if (!r?.ok) { body.innerHTML = '<div class="empty">Could not load the file.</div>'; return; }
    let t = await r.text(); const cut = t.length > FMAX; if (cut) t = t.slice(0, FMAX);
    body.innerHTML = (ext === '.md' ? `<div class="fmd">${md(t.replace(/\r\n/g, "\n").trimEnd())}</div>` : `<pre class="${ext === '.txt' ? 'ftxt' : 'fcode'}">${esc(t)}</pre>`) + (cut ? '<div class="empty">Showing the first 512 KB. Download for the rest.</div>' : '');
  } else body.innerHTML = `<div class="empty">No preview for this kind of file. <a href="${url}" download="${esc(f.name.split('/').pop())}">Download it</a>.</div>`;
}
function closePreview() { $('#fprevBox').classList.remove('on'); $('#fprevBody').innerHTML = ''; B.fprev = ''; }
$('#fprevBox').onclick = (e) => { if (e.target.id === 'fprevBox' || e.target.dataset.a === 'close') closePreview(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && B.fprev) closePreview(); });
// room view files <name> (CLI parity): open the Files tab with that file previewed.
async function previewByName(name) { await loadFiles(); const n = String(name).toLowerCase(); previewFile(B.files.find((f) => f.name.toLowerCase() === n || f.path.toLowerCase() === n) || B.files.find((f) => f.name.toLowerCase().endsWith(n))); }
