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
  if (e.target.dataset.a !== 'rm') return;
  const name = e.target.closest('.frow').dataset.name; if (!confirm(`Delete ${name} from files?`)) return;
  const r = await api('/files', { op: 'rm', name }); if (r?.error) return toast(r.error);
  toast(`Deleted ${name}`); loadFiles();
};
const fv = $('#filesView');
fv.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); fv.classList.add('drop'); } });
fv.addEventListener('dragleave', (e) => { if (!fv.contains(e.relatedTarget)) fv.classList.remove('drop'); });
fv.addEventListener('drop', (e) => { e.preventDefault(); fv.classList.remove('drop'); const l = [...e.dataTransfer.files]; if (l.length) addFiles(l); });
