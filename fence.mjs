// The Downloads, Desktop and Documents fence shared by pi/guard.ts and cursor/guard.mjs (claude uses --disallowedTools).
// A rough fence, not a sandbox: shell commands are read as text, so a determined command can still get past it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DIRS = ['downloads', 'desktop', 'documents'];
export const REASON = 'Downloads, Desktop and Documents are off limits';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Follows symlinks through the part of the path that exists, and compares without case (APFS ignores it by default).
const real = (abs) => { let p = abs, rest = ''; while (true) { try { return path.join(fs.realpathSync(p), rest); } catch { const up = path.dirname(p); if (up === p) return abs; rest = path.join(path.basename(p), rest); p = up; } } };
export function fencedPath(p, cwd = process.cwd(), home = os.homedir()) {
  const abs = path.resolve(cwd, String(p).replace(/^~(?=\/|$)/, home)), h = real(home).toLowerCase();
  return [abs, real(abs)].some((a) => { a = a.toLowerCase(); return DIRS.some((d) => a === path.join(h, d) || a.startsWith(path.join(h, d) + '/')); });
}
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const globHits = (seg) => /[*?[]/.test(seg) && DIRS.some((d) => { try { return globRe(seg).test(d); } catch { return true; } });
// Any text (file contents too): a folder reached from home, in any case or by glob (~/downloads, "$HOME"/Desktop, ~/Down*).
export function mentionsHome(text, home = os.homedir()) {
  const homeRef = `(?:~|\\$HOME|\\$\\{HOME\\}|${esc(home)})["']?/["']?([^/\\s"';|&)]*)`;
  for (const m of String(text).matchAll(new RegExp(homeRef, 'gi'))) if (DIRS.includes(m[1].toLowerCase()) || globHits(m[1])) return true;
  return false;
}
// A shell command, also: any word naming one of the folders (cd ~ && cat Downloads/x), and, run from home, a bare glob (D*).
export function fencedCommand(cmd, cwd = process.cwd(), home = os.homedir()) {
  if (mentionsHome(cmd, home) || /(^|[^a-z0-9_.-])(downloads|desktop|documents)([^a-z0-9_.-]|$)/i.test(cmd)) return true;
  if (path.resolve(cwd).toLowerCase() === home.toLowerCase()) for (const t of cmd.split(/[\s;|&()<>"'=]+/)) if (globHits(t.split('/')[0])) return true;
  return false;
}
