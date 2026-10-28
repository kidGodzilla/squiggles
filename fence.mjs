// The fence shared by pi/guard.ts, cursor/guard.mjs and codex/guard.mjs (claude uses --disallowedTools): Downloads, Desktop and Documents,
// ~/.ssh, and git push (squiggles commit; pushing is yours). Pi and Cursor have no approval step, so this is all that stops them.
// A rough fence, not a sandbox: shell commands are read as text, so a determined command can still get past it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DIRS = ['downloads', 'desktop', 'documents'];
export const REASONS = { dirs: 'Downloads, Desktop and Documents are off limits', ssh: '~/.ssh is off limits', push: 'git push is off limits: squiggles commit, you push',
  tree: 'a recursive read or copy from home or above reaches Downloads, Desktop, Documents and ~/.ssh: name a folder inside home' };
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
// A shell glob as a regex source: * ? [abc] [!a] [^a] {a,b}.
// Braces nest ({s{s,}h,x}); a ] first in a class is literal ([]s], [!]x]).
const braceEnd = (g, i) => { for (let d = 0; i < g.length; i++) { if (g[i] === '{') d++; else if (g[i] === '}' && !--d) return i; } return -1; };
const topSplit = (s) => { const out = ['']; let d = 0;
  for (const ch of s) { if (ch === ',' && !d) { out.push(''); continue; } if (ch === '{') d++; else if (ch === '}') d--; out[out.length - 1] += ch; }
  return out; };
const globSrc = (g) => { let r = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i], neg = ch === '[' && /[!^]/.test(g[i + 1] || ''), j = ch === '[' ? g.indexOf(']', i + (neg ? 3 : 2)) : ch === '{' ? braceEnd(g, i) : -1;
    if (ch === '*') r += '.*'; else if (ch === '?') r += '.';
    else if (ch === '[' && j > 0) { r += `[${neg ? '^' : ''}${g.slice(i + (neg ? 2 : 1), j).replace(/[\\\]]/g, '\\$&')}]`; i = j; }
    else if (ch === '{' && j > 0) { r += `(?:${topSplit(g.slice(i + 1, j)).map(globSrc).join('|')})`; i = j; }
    else r += ch.replace(/[.+^$(){}|[\]\\]/g, '\\$&');
  }
  return r; };
const globRe = (g) => new RegExp(`^${globSrc(g)}$`, 'i');
const globHits = (seg, names = DIRS) => /[*?[{]/.test(seg) && names.some((d) => { try { return globRe(seg).test(d); } catch { return true; } });
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
// {a,b} spelled out, so a brace can hold the home path or a folder above it ({~,x}/.ssh, {/home/me,/x}/Downloads).
// {} and {x} stay literal, as in the shell. Capped: past the cap a word keeps its braces and globSrc reads them.
const braces = (w, n = 64) => {
  for (let i = w.indexOf('{'); i >= 0; i = w.indexOf('{', i + 1)) {
    const j = braceEnd(w, i), alts = j > 0 ? topSplit(w.slice(i + 1, j)) : [];
    if (alts.length < 2) continue;
    const out = [];
    for (const a of alts) for (const x of braces(w.slice(0, i) + a + w.slice(j + 1), n)) { out.push(x); if (out.length >= n) return out; }
    return out;
  }
  return [w];
};
// Glob segments against a path's segments; ** spans any number. Reaching the end of the path means the glob gets to it or inside.
const segsMatch = (g, t) => {
  if (!t.length) return true;
  if (!g.length) return false;
  if (g[0] === '**') return segsMatch(g.slice(1), t) || segsMatch(g, t.slice(1));
  let ok; try { ok = globRe(g[0]).test(t[0]); } catch { ok = true; }
  return ok && segsMatch(g.slice(1), t.slice(1));
};
const FENCES = [['dirs', DIRS], ['ssh', ['.ssh']]];
// A glob met at home or above it, matched against every fenced folder (ls ~/D*, ls /home/*/.ssh, ls /h*/m*/Downloads).
const globReason = (cur, g, home) => {
  for (const h of new Set([home, real(home)].map((x) => x.toLowerCase()))) for (const c of new Set([cur, real(cur)])) {
    if (!aboveHome(c, h)) continue;
    const base = h.slice(c.replace(/\/$/, '').length).split('/').filter(Boolean);
    for (const [why, dirs] of FENCES) if (dirs.some((d) => segsMatch(g, [...base, d]))) return REASONS[why];
  }
  return '';
};
// A word walked as a path from dir, braces spelled out. Once a glob segment appears, the rest is matched against the fenced
// folders; a .. after it cancels the segment before it (/tmp/*/../../home/m*/.ssh).
const wordReason = (w, dir, home) => {
  for (const x of braces(w)) {
    const segs = x.replace(/^~([\w.-]+)(?=\/|$)/, (_, u) => path.join(path.dirname(home), u)).replace(homeArg(home), home).split('/'), g = [];
    let cur = segs[0] === '' ? '/' : dir;
    for (const seg of segs) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { if (g.length) g.pop(); else cur = path.dirname(cur); }
      else if (g.length || /[*?[{]/.test(seg)) g.push(seg);
      else cur = path.resolve(cur, seg);
    }
    // Literal segments may already be inside a fenced folder before the glob ({~/.ssh,/x}/*).
    const r = pathReason(cur, cur, home) || (g.length ? globReason(cur, g, home) : '');
    if (r) return r;
  }
  return '';
};
// Each word (Desktop, ../.ssh/config, ../D*) resolved from each folder the command may run in.
function relReason(cmd, cwd, home) {
  const h = home.toLowerCase(), words = cmd.split(/[\s;|&()<>=`]+/).filter(Boolean);
  for (const d of places(cmd, cwd, home)) for (const w of words) {
    const r = wordReason(w, d, home); if (r) return r;
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
// A shell command, also: each word walked as a path from every folder the command runs in (cd ~ && cat Downloads/x), so prose
// like 'documents retirement' outside home passes, and, run from home, a bare glob (D*).
export function fencedCommand(cmd, cwd = process.cwd(), home = os.homedir()) {
  cmd = unquote(cmd);
  if (mentionsHome(cmd, home)) return true;
  if (startsHome(cmd, cwd, home)) for (const t of cmd.split(/[\s;|&()<>=`]+/)) if (globHits(t.split('/')[0])) return true;
  return relReason(cmd, cwd, home) === REASONS.dirs;
}
// Any text (file contents, a patch): a home path to a fenced folder or ~/.ssh.
export const mentionReason = (text, home = os.homedir()) => mentionsHome(text, home) ? REASONS.dirs : mentionsSsh(text, home) ? REASONS.ssh : '';
// git [-C dir] [-c k=v] [--flags] push, anywhere in a chain or subshell.
// Also git send-pack, subtree or lfs push, an alias set to push, and push reached through a variable or eval (c=push; git $c).
export const pushes = (cmd) => /\bgit\b(\s+(-[Cc]\s+\S+|--?[\w-]+(=\S+)?))*\s+push\b/.test(cmd) || /\bgit\b.*\bsend-pack\b/.test(cmd) || /\bgit\b[^;&|\n]*\b(subtree|lfs)\b[^;&|\n]*\bpush\b/.test(cmd)
  || /\balias\.[\w-]+[\s=]+!?(git\s+)?push\b/.test(cmd) || (/\bpush\b/.test(cmd) && (/\$\{?\w|\beval\b/.test(cmd) || /\bxargs\b[^;&|\n]*\bgit\b/.test(cmd)) && /\bgit\b/.test(cmd));
// Recursive reads and copies (grep -r, rg, find, cp -r, tar, du, ls -R, rsync -a, zip -r, tree) rooted at home or above reach
// every fenced folder at once. Each simple command is checked from the folder it runs in, following cd and env -C; no path means that folder.
const RECURSE = { grep: /^-[a-zA-Z]*[rR]|^--(dereference-)?recursive$/, cp: /^-[a-zA-Z]*[rRa]|^--(recursive|archive)$/, ls: /^-[a-zA-Z]*R|^--recursive$/,
  rsync: /^-[a-zA-Z]*[ra]|^--(recursive|archive)$/, zip: /^-[a-zA-Z]*r|^--recurse-paths$/, scp: /^-[a-zA-Z]*r/,
  rg: true, find: true, du: true, tar: true, tree: true, ditto: true, fd: true, ag: true, '7z': true, '7za': true, '7zz': true };
const NEEDS_PATH = new Set(['cp', 'tar', 'rsync', 'zip', 'scp', 'ditto', '7z', '7za', '7zz']), PATTERN_FIRST = new Set(['grep', 'rg', 'fd', 'ag']);
// Flags whose next word is a value, not a path (rg -g '*.md', fd -e md); a pattern given by -e or -f leaves every operand a path.
const VAL = { grep: /^-[a-zA-Z]*[efmABCD]$|^--(regexp|file|max-count|context|after-context|before-context)$/,
  rg: /^-[a-zA-Z]*[efgtTmABCMj]$|^--(regexp|file|glob|iglob|type|type-not|max-count|context|after-context|before-context|max-columns|threads)$/,
  fd: /^-[a-zA-Z]*[etdExXcjS]$|^--(extension|type|max-depth|min-depth|exclude|exec|exec-batch|color|threads|size)$/,
  ag: /^-[a-zA-Z]*[GgABCm]$|^--(file-search-regex|ignore|context|after|before|max-count)$/, du: /^-[dB]$/ };
const PATTERN_FLAG = /^-[a-zA-Z]*[ef]$|^--(regexp|file)\b/;
// Wrapper flags that take a value (sudo -u root, xargs -I {}, bash -O extglob).
const WRAP_VAL = { sudo: /^-[a-zA-Z]*[ugCDhpRrT]$|^--(user|group|other-user|chdir|close-from|host|prompt|role|type|command-timeout)$/,
  xargs: /^-[a-zA-Z0-9]*[IndELPs]$|^--(max-args|max-procs|max-chars|max-lines|delimiter|eof|replace|arg-file)$/,
  nice: /^-n$|^--adjustment$/, timeout: /^-[sk]$|^--(signal|kill-after)$/, exec: /^-a$/, time: /^-[a-zA-Z]*[fo]$|^--(format|output)$/ };
// Words that run the command after them: sudo, env [-C dir], nice [-n N], timeout [-s SIG] N, bash/sh/zsh -c, and so on.
const WRAP = /^(sudo|command|builtin|exec|nice|time|nohup|xargs|env|timeout|bash|sh|zsh|dash|\w+=\S*)$/;
const aboveHome = (abs, home) => { const a = abs.toLowerCase(), h = home.toLowerCase(); return a === h || a === '/' || h.startsWith(a.replace(/\/$/, '') + '/'); };
function treeReason(cmd, cwd, home) {
  let cur = path.resolve(cwd);
  for (const seg of cmd.split(/[;&|\n()`]|\$\(/)) {
    const w = seg.trim().split(/\s+/).filter(Boolean);
    while (w.length && WRAP.test(path.basename(w[0]))) {
      const c0 = path.basename(w.shift()), flags = (arg) => { while (/^[-+]/.test(w[0] || '')) if (arg.test(w.shift())) w.shift(); };
      if (/^(bash|sh|zsh|dash)$/.test(c0)) { if (!w.some((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))) { w.unshift(c0); break; } flags(/^[-+][oO]$|^--(rcfile|init-file)$/); continue; }
      if (c0 !== 'env') { flags(WRAP_VAL[c0] || /^$/); if (c0 === 'timeout') w.shift(); continue; }
      while (/^-|^\w+=/.test(w[0] || '')) { const f = w.shift(), m = f.match(/^(?:-C|--chdir=?)(.*)$/); if (!m) continue;
        const t = (m[1] || w.shift() || '').replace(homeArg(home), home); cur = !t || /^[-~]|\$/.test(t) ? home : path.resolve(cur, t); }
    }
    const [c, ...args] = w; if (!c) continue;
    const name = path.basename(c);
    if (name === 'cd' || name === 'pushd') { const t = args[0] ? args[0].replace(homeArg(home), home) : home; cur = /^[-~]|\$/.test(t) ? home : path.resolve(cur, t); continue; }
    const rx = RECURSE[name];
    if (!rx || (rx !== true && !args.some((a) => rx.test(a)))) continue;
    if (name === 'find') while (/^-[HLPEXdsx]+$/.test(args[0] || '')) args.shift();
    let ops = [];
    if (name === 'find') ops = args.slice(0, (args.findIndex((a) => /^[-!(]/.test(a)) + 1 || args.length + 1) - 1);
    else for (let i = 0; i < args.length; i++) { if (!args[i].startsWith('-')) ops.push(args[i]); else if (VAL[name]?.test(args[i])) i++; }
    if (PATTERN_FIRST.has(name) && !((name === 'grep' || name === 'rg') && args.some((a) => PATTERN_FLAG.test(a)))) ops = ops.slice(1);
    if (/^7z/.test(name) && /^[au]$/.test(ops[0] || '') && ops.length === 2) ops.push('.'); // 7z a out.7z: no file list adds the whole folder
    if (!ops.length && !NEEDS_PATH.has(name)) ops = ['.'];
    for (const o of ops) { const t = o.replace(homeArg(home), home); if (/^\$|^~/.test(t) || aboveHome(path.resolve(cur, t), home)) return REASONS.tree; }
  }
  return '';
}
// The reason a path or shell command is refused, or ''.
export function pathReason(p, cwd = process.cwd(), home = os.homedir()) {
  return fencedPath(p, cwd, home) ? REASONS.dirs : sshPath(p, cwd, home) ? REASONS.ssh : '';
}
export function commandReason(cmd, cwd = process.cwd(), home = os.homedir()) {
  if (fencedCommand(cmd, cwd, home)) return REASONS.dirs;
  cmd = unquote(cmd);
  if (mentionsSsh(cmd, home) || (startsHome(cmd, cwd, home) && /(^|[\s=;&|(`])\.ssh\b/i.test(cmd)) || relReason(cmd, cwd, home) === REASONS.ssh) return REASONS.ssh;
  return treeReason(cmd, cwd, home) || (pushes(cmd) ? REASONS.push : '');
}
