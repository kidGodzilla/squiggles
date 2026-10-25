// Files: one flat drop folder (files/) plus read-only folders (research/, and any in config fileSources), newest first, searchable by name and text.
// Only files/ takes uploads and deletes. Who added an upload and its linked task live in files/.meta.json.
import fs from 'node:fs';
import path from 'node:path';

const TEXT = new Set(['.md', '.txt', '.json', '.csv', '.log', '.html', '.js', '.mjs', '.ts', '.sh', '.yml', '.yaml', '.xml', '.ics']);
const MAX_ADD = 100e6;

export function createFiles({ root, extra = {}, tasks = () => [] }) {
  const own = path.join(root, 'files');
  const SOURCES = { ...extra, files: own, research: path.join(root, 'research') };
  const META = path.join(own, '.meta.json');
  const meta = () => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return {}; } };

  // Every file under a source, as "<rel path>" (research keeps subfolders; dotfiles skipped).
  function walk(dir, rel = '', depth = 0, out = []) {
    let ents = []; try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && depth < 3) walk(dir, r, depth + 1, out);
      else if (e.isFile()) out.push(r);
    }
    return out;
  }
  // A file's task: the one it was filed with, else a t<number> in its name, else a task whose note names it.
  function taskFor(name, m, ts) {
    if (m?.task) return m.task;
    const n = /(?:^|[^a-z0-9])t(\d{2,})(?:[^0-9]|$)/i.exec(path.basename(name));
    if (n && ts.some((t) => t.id === `t${n[1]}`)) return `t${n[1]}`;
    return ts.find((t) => (t.note || '').includes(path.basename(name)) && path.basename(name).length > 8)?.id || '';
  }
  function list(query = '') {
    const q = String(query).trim().toLowerCase(), m = meta(), ts = tasks();
    const out = [];
    for (const [src, dir] of Object.entries(SOURCES)) for (const name of walk(dir)) {
      const full = path.join(dir, name), st = fs.statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      const mm = src === 'files' ? m[name] : null;
      if (q && !name.toLowerCase().includes(q) && !(TEXT.has(path.extname(name).toLowerCase()) && st.size < 2e6 && fs.readFileSync(full, 'utf8').toLowerCase().includes(q))) continue;
      out.push({ src, name, path: full, size: st.size, mtime: st.mtimeMs, by: mm?.by || '', task: taskFor(name, mm, ts), url: src === 'files' ? `/files/${encodeURIComponent(name)}` : `/files/@${src}/${name.split('/').map(encodeURIComponent).join('/')}`, own: src === 'files' });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
  // The absolute path for /files/@<src>/<rel>, or null if it leaves the source folder.
  function resolve(src, rel) {
    if (!Object.hasOwn(SOURCES, src)) return null; const dir = SOURCES[src];
    const full = path.resolve(dir, rel);
    let real = ''; try { real = fs.realpathSync(full); } catch { return null; }
    const base = fs.realpathSync(dir);
    return real.startsWith(base + path.sep) && !real.split(path.sep).some((x) => x.startsWith('.')) ? real : null;
  }
  // Saves base64 data as files/<name>, never overwriting (name-2.ext, name-3.ext ...).
  function add({ name, data, by, task }) {
    let base = path.basename(String(name || '')).replace(/[\u0000-\u001f/\\]/g, '').trim();
    if (!base || base.startsWith('.')) throw new Error('a file needs a name that does not start with a dot');
    const buf = Buffer.from(String(data || ''), 'base64');
    if (buf.length > MAX_ADD) throw new Error('file over 100 MB');
    fs.mkdirSync(own, { recursive: true });
    const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
    for (let i = 2; fs.existsSync(path.join(own, base)); i++) base = `${stem}-${i}${ext}`;
    fs.writeFileSync(path.join(own, base), buf);
    const m = meta(); m[base] = { ...(by ? { by } : {}), ...(task ? { task } : {}) }; fs.writeFileSync(META, JSON.stringify(m, null, 1));
    return { name: base, path: path.join(own, base), size: buf.length };
  }
  function setTask(name, task) { const m = meta(); m[name] = { ...(m[name] || {}), task }; fs.writeFileSync(META, JSON.stringify(m, null, 1)); }
  function rm(name) {
    const base = path.basename(String(name || ''));
    if (!base || base.startsWith('.') || !fs.statSync(path.join(own, base), { throwIfNoEntry: false })?.isFile()) throw new Error(`no file ${name} in files/ (only files there can be deleted)`);
    fs.unlinkSync(path.join(own, base));
    const m = meta(); delete m[base]; fs.writeFileSync(META, JSON.stringify(m, null, 1));
    return { removed: base };
  }
  const uploader = (name) => meta()[path.basename(String(name || ''))]?.by || '';
  return { list, resolve, add, rm, setTask, uploader, dir: own, SOURCES };
}
