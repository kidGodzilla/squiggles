// The fence shared by pi/guard.ts, cursor/guard.mjs and codex/guard.mjs (claude uses --disallowedTools): Downloads, Desktop and Documents,
// ~/.ssh, and git push (squiggles commit; pushing is yours). Pi and Cursor have no approval step, so this is all that stops them.
// A rough fence, not a sandbox: shell commands are read as text, so a determined command can still get past it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DIRS = ['downloads', 'desktop', 'documents'];
export const REASONS = { dirs: 'Downloads, Desktop and Documents are off limits', ssh: '~/.ssh is off limits', push: 'git push is off limits: squiggles commit, you push' };
export const REASON = REASONS.dirs;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Follows symlinks through the part of the path that exists, and compares without case (APFS ignores it by default).
const real = (abs) => { let p = abs, rest = ''; while (true) { try { return path.join(fs.realpathSync(p), rest); } catch { const up = path.dirname(p); if (up === p) return abs; rest = path.join(path.basename(p), rest); p = up; } } };
const under = (names, p, cwd, home) => {
  const abs = path.resolve(cwd, String(p).replace(/^~(?=\/|$)/, home)), h = real(home).toLowerCase();
  return [abs, real(abs)].some((a) => { a = a.toLowerCase(); return names.some((d) => a === path.join(h, d) || a.startsWith(path.join(h, d) + '/')); });
};
export const fencedPath = (p, cwd = process.cwd(), home = os.homedir()) => under(DIRS, p, cwd, home);
export const sshPath = (p, cwd = process.cwd(), home = os.homedir()) => under(['.ssh'], p, cwd, home);
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const globHits = (seg, names = DIRS) => /[*?[]/.test(seg) && names.some((d) => { try { return globRe(seg).test(d); } catch { return true; } });
const homeRef = (home) => new RegExp(`(?:~|\\$HOME|\\$\\{HOME\\}|${esc(home)})["']?/["']?([^/\\s"';|&)]*)`, 'gi');
// Any text (file contents too): a folder reached from home, in any case or by glob (~/downloads, "$HOME"/Desktop, ~/Down*).
export function mentionsHome(text, home = os.homedir(), names = DIRS) {
  for (const m of String(text).matchAll(homeRef(home))) if (names.includes(m[1].toLowerCase()) || globHits(m[1], names)) return true;
  return false;
}
export const mentionsSsh = (text, home = os.homedir()) => mentionsHome(text, home, ['.ssh']);
// Shell commands are matched after dropping quotes and backslashes (~/Down"loads", D\ocuments), and a bare cd
// (or cd ~, cd $HOME) counts as running from home.
const unquote = (cmd) => String(cmd).replace(/\\\n/g, '').replace(/["'\\]/g, '');
// The folders a command may run in: cwd, then each cd or pushd target (also builtin cd, command cd, env -C), followed
// from the last (cd .., pushd ~ >/dev/null). A target it can't read (cd -, cd $DIR, cd ~someone) counts as home.
const CD = /(?:^|[;&|(`\n]|\$\()\s*(?:(?:builtin|command)\s+)?(?:cd|pushd)\b(?:[ \t]+([^\s;&|)<>`]+))?|\benv\b[^;&|\n]*?(?:\s-C\s*|\s--chdir[=\s]+)([^\s;&|)<>`]+)/gi;
const homeArg = (home) => new RegExp(`^(~|\\$HOME|\\$\\{HOME\\}|${esc(home)})(?=/|$)`, 'i');
function places(cmd, cwd, home) {
  let cur = path.resolve(cwd); const out = [cur];
  for (const m of String(cmd).matchAll(CD)) {
    const a = m[1] ?? m[2], t = a ? a.replace(homeArg(home), home) : home;
    if (/^[-~]|\$/.test(t)) { out.push(home); continue; }
    out.push(cur = path.resolve(cur, t));
  }
  return out;
}
const startsHome = (cmd, cwd, home) => places(cmd, cwd, home).some((d) => d.toLowerCase() === home.toLowerCase());
// A path-like word (../.ssh/config, ../D*) resolved from each folder the command may run in.
function relReason(cmd, cwd, home) {
  const h = home.toLowerCase(), words = cmd.split(/[\s;|&()<>=`]+/).filter((w) => w.includes('/'));
  for (const d of places(cmd, cwd, home)) for (const w of words) {
    const abs = path.resolve(d, w.replace(homeArg(home), home)), parts = abs.split('/');
    if (fencedPath(abs, d, home)) return REASONS.dirs;
    if (sshPath(abs, d, home)) return REASONS.ssh;
    for (let k = 1; k < parts.length; k++) if (parts.slice(0, k).join('/').toLowerCase() === h) {
      if (globHits(parts[k])) return REASONS.dirs;
      if (globHits(parts[k], ['.ssh'])) return REASONS.ssh;
    }
  }
  return '';
}
// A shell command, also: any word naming one of the folders (cd ~ && cat Downloads/x), and, run from home, a bare glob (D*).
export function fencedCommand(cmd, cwd = process.cwd(), home = os.homedir()) {
  cmd = unquote(cmd);
  if (mentionsHome(cmd, home) || /(^|[^a-z0-9_.-])(downloads|desktop|documents)([^a-z0-9_.-]|$)/i.test(cmd)) return true;
  if (startsHome(cmd, cwd, home)) for (const t of cmd.split(/[\s;|&()<>=`]+/)) if (globHits(t.split('/')[0])) return true;
  return relReason(cmd, cwd, home) === REASONS.dirs;
}
// Any text (file contents, a patch): a home path to a fenced folder or ~/.ssh.
export const mentionReason = (text, home = os.homedir()) => mentionsHome(text, home) ? REASONS.dirs : mentionsSsh(text, home) ? REASONS.ssh : '';
// git [-C dir] [-c k=v] [--flags] push, anywhere in a chain or subshell.
// Also git send-pack, subtree or lfs push, an alias set to push, and push reached through a variable or eval (c=push; git $c).
export const pushes = (cmd) => /\bgit\b(\s+(-[Cc]\s+\S+|--?[\w-]+(=\S+)?))*\s+push\b/.test(cmd) || /\bgit\b.*\bsend-pack\b/.test(cmd) || /\bgit\b[^;&|\n]*\b(subtree|lfs)\b[^;&|\n]*\bpush\b/.test(cmd)
  || /\balias\.[\w-]+[\s=]+!?(git\s+)?push\b/.test(cmd) || (/\bpush\b/.test(cmd) && /\$\{?\w|\beval\b/.test(cmd) && /\bgit\b/.test(cmd));
// The reason a path or shell command is refused, or ''.
export function pathReason(p, cwd = process.cwd(), home = os.homedir()) {
  return fencedPath(p, cwd, home) ? REASONS.dirs : sshPath(p, cwd, home) ? REASONS.ssh : '';
}
export function commandReason(cmd, cwd = process.cwd(), home = os.homedir()) {
  if (fencedCommand(cmd, cwd, home)) return REASONS.dirs;
  cmd = unquote(cmd);
  if (mentionsSsh(cmd, home) || (startsHome(cmd, cwd, home) && /(^|[\s=;&|(`])\.ssh\b/i.test(cmd)) || relReason(cmd, cwd, home) === REASONS.ssh) return REASONS.ssh;
  return pushes(cmd) ? REASONS.push : '';
}
