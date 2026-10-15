// The user's drop box: plain text files in <data>/inbox go to the lead, then move to inbox/read/.
// Files stay put until the lead can take them (idle, no session limit), so a restart or a limit loses nothing.
import fs from 'node:fs';
import path from 'node:path';

export function createInbox(dir) {
  const READ = path.join(dir, 'read');
  fs.mkdirSync(READ, { recursive: true });
  const files = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => { const st = fs.statSync(path.join(d, e.name)); return { name: e.name, size: st.size, mtime: st.mtimeMs }; }); } catch { return []; } };
  const list = () => ({ unread: files(dir).sort((a, b) => a.mtime - b.mtime), read: files(READ).sort((a, b) => b.mtime - a.mtime) });
  // Unread files untouched for settleMs (so a half-written file waits), read and moved to read/. A name already in read/ gets a time suffix.
  function take(settleMs = 2000, max = 20000) {
    const out = [];
    for (const f of list().unread) {
      if (Date.now() - f.mtime < settleMs) continue;
      const src = path.join(dir, f.name);
      let text = fs.readFileSync(src, 'utf8'); if (text.length > max) text = text.slice(0, max) + '\n[cut: file continues]';
      let dest = path.join(READ, f.name);
      if (fs.existsSync(dest)) dest = path.join(READ, `${f.name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.renameSync(src, dest);
      out.push({ name: f.name, text });
    }
    return out;
  }
  return { list, take };
}
