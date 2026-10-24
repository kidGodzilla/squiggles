// notes <query>: find what a squiggle (or anyone) already wrote down before researching it again.
// Files holding every word of the query, most matches first, with their matching lines. Text and Markdown only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
// Journals and charters, research/, files/ and fileSources in the data dir, plus the repo's docs/.
export const notesRoots = (data, extra = []) => [path.join(data, 'squiggles'), path.join(data, 'research'), path.join(data, 'files'), ...extra, path.join(ROOT, 'docs')];

// Every .md/.txt under a root; dotfiles and node_modules skipped, no symlink loops.
function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.(md|txt)$/i.test(e.name)) out.push(p);
  }
  return out;
}

export function searchNotes(query, { roots = [], files = 12, lines = 3 } = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('usage: notes <query>');
  const score = (t) => words.filter((w) => t.includes(w)).length, out = [];
  for (const file of [...new Set(roots.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r)))]) {
    let text; try { if (fs.statSync(file).size > 16 << 20) continue; text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const low = text.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue; // files that hold every word
    const ls = low.split('\n').map((l, i) => ({ n: i + 1, s: score(l), i })).filter((l) => l.s);
    if (!ls.length) continue;
    const raw = text.split('\n'), best = Math.max(...ls.map((l) => l.s));
    out.push({ file, best, count: ls.filter((l) => l.s === best).length, lines: ls.sort((a, b) => b.s - a.s || b.n - a.n).slice(0, lines).map(({ n, i }) => ({ n, text: raw[i].slice(0, 300).trim() })) });
  }
  // A file ranks by its best line (most of the words), then by how many lines reach it: many weak lines don't lift a big journal.
  return out.sort((a, b) => b.best - a.best || b.count - a.count).slice(0, files);
}

export const describeNotes = (r) => r.length ? r.map((x) => `${x.file.replace(os.homedir(), '~')}\n${x.lines.map((l) => `  ${l.n}: ${l.text.slice(0, 200)}`).join('\n')}`).join('\n') : 'nothing found';
