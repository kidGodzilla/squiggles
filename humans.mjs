// The people who use the room (t138). humans.json: [{id, name, avatar}], James first and never removed.
// avatar: an emoji or a few letters, or an https:/data: image URL; empty shows the name's initial.
import fs from 'node:fs';
import path from 'node:path';

const JAMES = { id: 'james', name: 'James', avatar: '' };
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function checkAvatar(a) {
  a = String(a ?? '').trim();
  if (!a || /^(https:\/\/|data:image\/)/.test(a) || [...a].length <= 4) return a;
  throw new Error('avatar: an emoji or up to 4 letters, or an https: or data:image URL');
}

export function createHumans(root, onChange) {
  const FILE = path.join(root, 'humans.json');
  const all = () => {
    let h = []; try { h = JSON.parse(fs.readFileSync(FILE, 'utf8')).humans || []; } catch {}
    return h.some((x) => x.id === 'james') ? h : [JAMES, ...h];
  };
  const save = (h) => { fs.writeFileSync(FILE, JSON.stringify({ humans: h }, null, 2) + '\n'); onChange?.(); };
  const find = (h, id) => { const x = h.find((k) => k.id === id); if (!x) throw new Error(`no human ${id}`); return x; };

  function op({ op, id, name, avatar }) {
    const h = all();
    if (op === 'add') {
      name = String(name || '').trim(); if (!name) throw new Error('a human needs a name');
      const base = slug(id || name) || 'human'; let nid = base;
      for (let n = 2; h.some((x) => x.id === nid); n++) nid = `${base}-${n}`;
      const x = { id: nid, name, avatar: checkAvatar(avatar) }; h.push(x); save(h); return x;
    }
    const x = find(h, id);
    if (op === 'edit') {
      if (name !== undefined) x.name = String(name).trim() || x.name;
      if (avatar !== undefined) x.avatar = checkAvatar(avatar);
      save(h); return x;
    }
    if (op === 'remove') {
      if (x.id === 'james') throw new Error('James stays');
      h.splice(h.indexOf(x), 1); save(h); return { ...x, removed: true };
    }
    throw new Error(`unknown human op ${op}`);
  }
  return { all, op };
}
