// The fence shared by pi/guard.ts, cursor/guard.mjs and codex/guard.mjs (claude uses --disallowedTools): Downloads, Desktop and Documents,
// ~/.ssh, and git push (squiggles commit; pushing is yours). Pi and Cursor have no approval step, so this is all that stops them.
// A rough fence, not a sandbox: shell commands are read as text, so a determined command can still get past it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DIRS = ['downloads', 'desktop', 'documents'];
// Home folders no squiggle or pre-check may Read, Edit or Write (claude --disallowedTools). Bash, Grep and Glob go through
// claude/guard.mjs; Read's hook checks peers only (peerReason), so this list is its home fence.
export const HOME_FENCE = ['Downloads', 'Desktop', 'Documents', '.ssh'].flatMap((d) => [`Read(~/${d}/**)`, `Edit(~/${d}/**)`, `Write(~/${d}/**)`]);
export const REASONS = { dirs: 'Downloads, Desktop and Documents are off limits', ssh: '~/.ssh is off limits', push: 'git push is off limits: squiggles commit, you push',
  watches: 'watches.json is written only by the watch commands: reading it is fine',
  squiggle: 'squiggle.json is written only by the server: use bin/agents.mjs, or ask the lead. Reading it is fine',
  roomFile: 'room.json is written only by the server: set the passcode from the page. Reading it is fine',
  peer: "that squiggle's transcript, journal and private notes are closed to other squiggles: ask the lead",
  secret: 'credentials stay off the screen',
  tree: 'a recursive read or copy from home or above reaches Downloads, Desktop, Documents and ~/.ssh: name a folder inside home',
  room: "the room is your user's login: in their Chrome you would act as them. Use bin/agents.mjs",
  word: 'a word this long with braces in it is too big to check, so it is refused; put it in a file',
  crash: 'guard could not read the tool call, so it is refused' };
export const REASON = REASONS.dirs;
// The main of every hook guard: exit 2 with a reason refuses. Codex runs the tool on any other exit, and on exit 2 with empty stderr.
export function hookMain(check, allow = '') {
  let r; try { r = check(JSON.parse(fs.readFileSync(0, 'utf8'))); } catch { r = REASONS.crash; }
  if (r) { process.stderr.write(r); process.exit(2); }
  if (allow) process.stdout.write(allow);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Follows symlinks through the part of the path that exists, and compares without case (APFS ignores it by default).
// A prefix that resolves has parents that do, so the longest one is found by galloping then halving: walking up one folder at a time is quadratic in a long word.
// memo holds what one command's walk has resolved: a command of many words asks for home and each folder over and over.
let memo = null;
const real = (abs) => {
  if (memo?.has(abs)) return memo.get(abs);
  const segs = path.resolve(abs).split('/'), at = (k) => {
    const p = segs.slice(0, k).join('/') || '/', key = `\0${p}`;
    if (memo?.has(key)) return memo.get(key);
    let r = null;
    try { r = fs.realpathSync.native(p); } catch {}
    memo?.set(key, r);
    return r;
  };
  let lo = 1, hi = segs.length, base = '/';
  // The part that exists is usually a few folders: gallop up from the short end first, so no probe joins a long tail.
  for (let k = 2; k < hi; k *= 2) { const r = at(k); if (r === null) { hi = k - 1; break; } base = r; lo = k + 1; }
  while (lo <= hi) { const k = (lo + hi) >> 1, r = at(k); if (r === null) hi = k - 1; else { base = r; lo = k + 1; } }
  const r = path.join(base, segs.slice(hi).join('/'));
  memo?.set(abs, r);
  return r;
};
// A path as written and as it resolves, lower case: the fenced and .ssh checks of one word share it.
const both = (p, cwd, home) => {
  const key = `\x01${cwd}\0${home}\0${p}`; if (memo?.has(key)) return memo.get(key);
  const abs = path.resolve(cwd, String(p).replace(/^~(?=\/|$)/, home)), r = [abs.toLowerCase(), real(abs).toLowerCase()];
  memo?.set(key, r); return r;
};
const under = (names, p, cwd, home) => {
  const h = real(home).toLowerCase();
  return both(p, cwd, home).some((a) => names.some((d) => a === path.join(h, d) || a.startsWith(path.join(h, d) + '/')));
};
export const fencedPath = (p, cwd = process.cwd(), home = os.homedir()) => under(DIRS, p, cwd, home);
export const sshPath = (p, cwd = process.cwd(), home = os.homedir()) => under(['.ssh'], p, cwd, home);
// A shell glob: * ? [abc] [!a] [^a] {a,b}.
// Braces nest ({s{s,}h,x}); a ] first in a class is literal ([]s], [!]x]).
const topSplit = (s) => { const out = []; let d = 0, a = 0;
  for (let i = 0; i < s.length; i++) { if (s[i] === ',' && !d) { out.push(s.slice(a, i)); a = i + 1; } else if (s[i] === '{') d++; else if (s[i] === '}') d--; }
  out.push(s.slice(a));
  return out; };
// A glob is walked, never turned into a regex or a tree: repeated {*,*} backtracks for ever, and spelling out a long glob costs more
// than the check. The walk holds every place in t the glob can have reached and stops when none is left, so a long glob that can't
// match costs a few characters. Group ends and the next ] come from tables built once. Past 64 deep, or at a class no regex
// can read, it throws, and every caller reads a throw as a match. A bad class the walk never reaches can't match either.
const LINE_END = /[\n\r\u2028\u2029]/;
const globTables = (g) => {
  const close = new Int32Array(g.length).fill(-1), shut = new Int32Array(g.length + 4).fill(-1), open = [];
  for (let i = 0; i < g.length; i++) { if (g[i] === '{') open.push(i); else if (g[i] === '}' && open.length) close[open.pop()] = i; }
  for (let i = g.length - 1; i >= 0; i--) shut[i] = g[i] === ']' ? i : shut[i + 1];
  const t = { close, shut, units: new Map() };
  t.min = globMin(g, t, 0, g.length, 0);
  return t;
};
// The fewest characters the glob can match, read the way globWalk reads it: a target shorter than that can't match, so the
// walk is skipped. Fenced folder names are short, and a long word of *{a,b} cost 50 ms walking each one. A lower bound
// only: past 64 deep it says 0 and the walk throws as before.
const globMin = (g, { close, shut }, a, b, depth) => {
  if (depth > 64) return 0;
  let n = 0;
  for (let i = a; i < b; i++) {
    const ch = g[i], neg = ch === '[' && i + 1 < b && /[!^]/.test(g[i + 1]), c = ch === '[' ? shut[i + (neg ? 3 : 2)] : -1, j = c >= b ? -1 : ch === '{' ? close[i] : c;
    if (ch === '*') continue;
    if (ch === '[' && j > 0) { n++; i = j; }
    else if (ch === '{' && j > 0) {
      let s = i + 1, m = Infinity;
      const alt = (e) => { m = Math.min(m, globMin(g, { close, shut }, s, e, depth + 1)); s = e + 1; };
      for (let k = s; k < j; k++) { if (g[k] === ',') alt(k); else if (g[k] === '{' && close[k] > 0) k = close[k]; }
      alt(j); n += m; i = j;
    } else n++;
  }
  return n;
};
const globWalk = (g, { close, shut, units }, t, at, a, b, depth) => {
  if (depth > 64) throw new Error('glob nested too deep');
  const unit = (s) => { if (!units.has(s)) units.set(s, new RegExp(`^${s}$`, 'i')); return units.get(s); };
  const step = (re, out) => { for (const p of at) if (p < t.length && re.test(t[p])) out.add(p + 1); };
  for (let i = a; i < b && at.size; i++) {
    const ch = g[i], neg = ch === '[' && i + 1 < b && /[!^]/.test(g[i + 1]), c = ch === '[' ? shut[i + (neg ? 3 : 2)] : -1, j = c >= b ? -1 : ch === '{' ? close[i] : c, out = new Set();
    if (ch === '*') for (const p of at) { out.add(p); for (let q = p; q < t.length && !LINE_END.test(t[q]) && !out.has(q + 1); q++) out.add(q + 1); }
    else if (ch === '?') step(unit('.'), out);
    else if (ch === '[' && j > 0) { step(unit(`[${neg ? '^' : ''}${g.slice(i + (neg ? 2 : 1), j).replace(/[\\\]]/g, '\\$&')}]`), out); i = j; }
    else if (ch === '{' && j > 0) {
      let s = i + 1;
      const alt = (e) => { for (const p of globWalk(g, { close, shut, units }, t, at, s, e, depth + 1)) out.add(p); s = e + 1; };
      for (let k = s; k < j; k++) { if (g[k] === ',') alt(k); else if (g[k] === '{' && close[k] > 0) k = close[k]; }
      alt(j); i = j;
    } else step(unit(ch.replace(/[.+^$(){}|[\]\\]/g, '\\$&')), out);
    at = out;
  }
  return at;
};
// Tables are kept per glob: reach tests a path's segments against each fenced folder in turn, so keeping only the last
// one rebuilt them for every segment of every folder. Cleared past 256 so a long command can't grow it.
const TABLES = new Map();
const globRe = (g) => {
  let tables = TABLES.get(g);
  if (!tables) { if (TABLES.size >= 256) TABLES.clear(); TABLES.set(g, (tables = globTables(g))); }
  return { test: (t) => t.length >= tables.min && globWalk(g, tables, t, new Set([0]), 0, g.length, 0).has(t.length) };
};
// Past this size a word with a brace in it is refused unread: no real command needs one, and spelling it out costs seconds.
const WORD_MAX = 65536;
const bigBrace = (cmd) => { let n = 0; for (const w of String(cmd).replace(/\\\n/g, '').split(/[\s;|&()<>`]+/)) if (w.length > 1024 && /[{}]/.test(w) && (n += w.length) > WORD_MAX) return true; return false; };
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
const homeWord = (w, home) => w.replace(/^~([\w.-]+)(?=\/|$)/, (_, u) => path.join(path.dirname(home), u)).replace(homeArg(home), home);
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
// {} and {x} stay literal, as in the shell. Capped: past the cap a word keeps its braces and globRe reads them.
// Depth capped too: thousands of groups overflowed the stack.
// The leftmost { that closes with a comma of its own, in one pass: asking of each { in turn was quadratic on nested groups.
const firstGroup = (w) => {
  const open = [], comma = []; let first = -1, end = -1;
  for (let i = w.indexOf('{'); i >= 0 && i < w.length; i++) {
    if (w[i] === '{') { open.push(i); comma.push(false); } else if (!open.length) continue;
    else if (w[i] === ',') comma[comma.length - 1] = true;
    else if (w[i] === '}') {
      const o = open.pop();
      if (comma.pop() && (first < 0 || o < first)) { first = o; end = i; }
      if (!open.length && first >= 0) break;
    }
  }
  return [first, end];
};
const braces = (w, n = 64, depth = 0) => {
  if (depth >= n) return [w];
  const [i, j] = firstGroup(w);
  if (i < 0) return [w];
  const out = [];
  for (const a of topSplit(w.slice(i + 1, j))) for (const x of braces(w.slice(0, i) + a + w.slice(j + 1), n, depth + 1)) { out.push(x); if (out.length >= n) return out; }
  return out;
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
    const segs = homeWord(x, home).split('/'), g = [], lit = path.resolve(segs[0] === '' ? '/' : dir).split('/').filter(Boolean);
    for (const seg of segs) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { if (g.length) g.pop(); else lit.pop(); }
      else if (g.length || /[*?[{]/.test(seg)) g.push(seg);
      else lit.push(seg);
    }
    const cur = `/${lit.join('/')}`;
    // Literal segments may already be inside a fenced folder before the glob ({~/.ssh,/x}/*).
    const r = pathReason(cur, cur, home) || (g.length ? globReason(cur, g, home) : '');
    if (r) return r;
  }
  return '';
};
// Each word (Desktop, ../.ssh/config, ../D*) resolved from each folder the command may run in.
function relReason(cmd, cwd, home) {
  const h = home.toLowerCase(), depth = h.split('/').length, words = new Set(cmd.split(/[\s;|&()<>=`]+/).filter(Boolean));
  memo = new Map();
  try {
    for (const d of places(cmd, cwd, home)) for (const w of words) {
      const r = wordReason(w, d, home); if (r) return r;
      const abs = path.resolve(d, w.replace(homeArg(home), home)), parts = abs.split('/');
      if (fencedPath(abs, d, home)) return REASONS.dirs;
      if (sshPath(abs, d, home)) return REASONS.ssh;
      if (depth < parts.length && parts.slice(0, depth).join('/').toLowerCase() === h) {
        if (globHits(parts[depth])) return REASONS.dirs;
        if (globHits(parts[depth], ['.ssh'])) return REASONS.ssh;
      }
    }
    return '';
  } finally { memo = null; }
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
// git [-C dir] [-c k=v] [--work-tree dir] [--flags] push, anywhere in a chain or subshell.
// Also git send-pack, subtree or lfs push, an alias set to push, and push reached through a variable or eval (c=push; git $c).
export const pushes = (cmd) => /\bgit\b(\s+(-[Cc]\s+\S+|--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix|attr-source|shallow-file)\s+\S+|--?[\w-]+(=\S+)?))*\s+push\b/.test(cmd) || /\bgit\b.*\bsend-pack\b/.test(cmd) || /\bgit\b[^;&|\n]*\b(subtree|lfs)\b[^;&|\n]*\bpush\b/.test(cmd)
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
// Words that run the command after them: sudo, env [-C dir], nice [-n N], timeout [-s SIG] N, bash/sh/zsh -c, shell keywords (do, then, !, {), and so on.
const WRAP = /^(sudo|command|builtin|exec|nice|time|nohup|xargs|env|timeout|bash|sh|zsh|dash|\w+=\S*|do|then|else|elif|if|while|until|!|\{)$/;
const aboveHome = (abs, home) => { const a = abs.toLowerCase(), h = home.toLowerCase(); return a === h || a === '/' || h.startsWith(a.replace(/\/$/, '') + '/'); };
// $NAME or ${NAME}, then nothing or /more, takes every value the command assigns it, plus $HOME and $TMPDIR's own; a mktemp
// result is a new folder. A name set any other way (read, for, printf -v, a nameref, eval) or never set stays unknown and refuses.
const literal = (v) => /^\/[^$`~*?[{]*$/.test(v);
function varPaths(op, cmd, home) {
  const m = op.match(/^\$(?:(\w+)|\{(\w+)\})(\/.*)?$/); if (!m) return null;
  const n = m[1] || m[2], more = m[3] || '';
  if (new RegExp(`\\b(read|mapfile|readarray|getopts|select)\\b[^;&|\\n]*\\b${n}\\b|\\bfor\\s+${n}\\b|\\bprintf\\s+-v\\s*${n}\\b|\\b(declare|typeset|local)\\b[^;&|\\n]*\\s-n\\b|\\beval\\b`).test(cmd)) return null;
  const vals = [...cmd.matchAll(new RegExp(`(?:^|[\\s;&|(])${n}=(\\$\\(mktemp\\b[^()$\`]*\\)|[^\\s;&|()<>]*)`, 'g'))].map((a) => a[1]).filter((v) => !/^\$\(mktemp\b/.test(v));
  if (n === 'HOME') vals.push(home); else if (n === 'TMPDIR') vals.push(process.env.TMPDIR || '/tmp');
  else if (!cmd.match(new RegExp(`(?:^|[\\s;&|(])${n}=`))) return null;
  return vals.every(literal) ? vals.map((v) => v + more) : null;
}
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
    for (const o of ops) {
      const t = o.replace(homeArg(home), home), vs = /^\$/.test(t) ? varPaths(t, cmd, home) : [t];
      if (!vs || vs.some((v) => /^\$|^~/.test(v) || aboveHome(path.resolve(cur, v), home))) return REASONS.tree;
    }
  }
  return '';
}
// A watch runs what its entry says and the hash has no key, so writing watches.json would approve a command with no one looking.
// Lead-only fields are checked by the API and read from squiggle.json, so writing it grants what the API refuses.
// room.json holds the passcode hash, and a swapped hash counts after the next restart: writing it unlocks the page.
// Rough: reads stay open, and a script file, a glob or code piped into an interpreter still get through. A write is a redirect into
// a word naming the file, or in one segment (between ; | & or newline) a file tool, an in-place sed/perl/ruby or an interpreter
// running code, before the name. Linear: the regexes this replaces rescanned from every > or command word (82 s on 200 KB),
// and a hook that slow times out, which Codex reads as allow.
const OWNED_FILES = [['watches.json', 'watches'], ['squiggle.json', 'squiggle'], ['room.json', 'roomFile']];
const FILE_TOOL = /\b(?:cp|mv|ln|install|rsync|ditto|tee|truncate|dd|patch|touch|rm|ed|ex|vim?|nano)\b/g;
const IN_PLACE = /\b(?:g?sed|perl|ruby)\b/g, IN_PLACE_FLAG = /\s-\w*i\S*\s/g;
const INTERP = /\b(?:node|bun|deno|python[\d.]*|ruby|perl|php|osascript)\b/g, CODE_FLAG = /\s-\w*[ecp]\b|\s--eval\b|\s--print\b|\s-(?:\s|$)|<</gm;
const SEP = /[\n;|&]/g;
const find = (re, s, from) => { re.lastIndex = from; const m = re.exec(s); return m && { i: m.index, end: m.index + m[0].length }; };
const sepAfter = (s, from) => { const m = find(SEP, s, from); return m ? m.i : s.length; };
const firstFrom = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; } return lo < a.length ? a[lo] : Infinity; };
// > or >|, optional space, then a word holding the name: a > earlier in that word, or the word before ending in > or >|.
function redirectsInto(s, at) {
  let i = 0, word = -1, gt = -1, prev = false;
  for (const c of at) {
    for (; i < c; i++) {
      if (/\s/.test(s[i])) { if (word !== -1) { prev = s[i - 1] === '>' || (s[i - 1] === '|' && s[i - 2] === '>'); word = -1; } }
      else { if (word === -1) word = i; if (s[i] === '>') gt = i; }
    }
    if (prev || (word !== -1 && gt >= word)) return true;
  }
  return false;
}
// The first command word in a segment decides it: a later one finds its flag and the name in a suffix of the same range.
// An interpreter's code runs to the end of the command, so for it the name may come in any later segment.
// A flag starts inside the segment but may run on to the next space, so it is read up to there (the space found once, kept),
// at most 256 characters past the segment so a long run of segments stays linear.
function toolBefore(s, at, word, flag) {
  let ws = -1;
  for (let from = 0; from < s.length;) {
    const m = find(word, s, from);
    if (!m) return false;
    const end = sepAfter(s, m.end);
    let after = m.end, until = end;
    if (flag) {
      if (ws !== s.length && ws <= end) { const w = find(/\s/g, s, end + 1); ws = w ? w.i : s.length; }
      const f = find(flag, s.slice(m.end, Math.min(ws + 1, end + 257)), 0);
      if (!f || m.end + f.i > end) { from = end + 1; continue; }
      after = m.end + f.end;
      until = flag === CODE_FLAG ? s.length : sepAfter(s, after);
    }
    if (firstFrom(at, after) < until) return true;
    from = end + 1;
  }
  return false;
}
function ownedWrite(cmd) {
  const s = String(cmd).toLowerCase();
  for (const [name, reason] of OWNED_FILES) {
    const at = [];
    for (let i = s.indexOf(name); i !== -1; i = s.indexOf(name, i + 1)) at.push(i);
    if (at.length && (redirectsInto(s, at) || toolBefore(s, at, FILE_TOOL) || toolBefore(s, at, IN_PLACE, IN_PLACE_FLAG) || toolBefore(s, at, INTERP, CODE_FLAG))) return REASONS[reason];
  }
  return '';
}
export const watchesPath = (p) => /(?:^|[\\/])watches\.json$/i.test(String(p).trim());
const squigglePath = (p) => /(?:^|[\\/])squiggle\.json$/i.test(String(p).trim());
const roomPath = (p) => /(?:^|[\\/])room\.json$/i.test(String(p).trim());
export const ownedFileReason = (p) => (watchesPath(p) && REASONS.watches) || (squigglePath(p) && REASONS.squiggle) || (roomPath(p) && REASONS.roomFile) || '';
// Edit and write tools: a path argument that is the file. Contents that name it pass.
export const editReason = (tool, input = {}) => (/edit|write|patch|replace|create/i.test(tool || '') && Object.entries(input || {}).map(([k, v]) => /path|file|target/i.test(k) && typeof v === 'string' && ownedFileReason(v)).find(Boolean)) || '';
// The reason a path or shell command is refused, or ''.
export function pathReason(p, cwd = process.cwd(), home = os.homedir()) {
  return fencedPath(p, cwd, home) ? REASONS.dirs : sshPath(p, cwd, home) ? REASONS.ssh : '';
}
// Under home, lower case. Screen only: a pinned file goes to every page, while squiggles can need these to work.
const SECRETS = ['.aws', '.azure', '.gnupg', '.kube', '.netrc', '.git-credentials', '.npmrc', '.pgpass', '.docker/config.json', '.config/gh', '.config/gcloud', '.config/rclone', '.config/1password', '.config/anthropic',
  '.pi/agent/auth.json', '.codex/auth.json', '.sentryclirc', '.emulator_console_auth_token', '.asc', '.appstoreconnect'];
// In any folder. An env file: .env, .envrc, .env.prod, .env-prod, .env_local, prod.env; not its example.
// Basename only, and none over the longest a file can have: these backtrack on a long word.
const SECRET_NAME = /^(?:[^/]*\.(?:key|pem|p8|p12|pfx)|\.claude\.json(?:\.[^/]*)?|\.zsh_history[^/]*|config\.json\.bak[^/]*)$/;
const ENV_FILE = /^(?:[^/]*\.env(?:[._-][^/]*)?|\.envrc)$/, ENV_EXAMPLE = /(?:^|[._-])(?:example|sample|template)(?:\.env)?$/;
const secretName = (a) => { const n = path.basename(a); return n.length <= 255 && (SECRET_NAME.test(n) || (ENV_FILE.test(n) && !ENV_EXAMPLE.test(n))); };
export function secretReason(p, cwd = process.cwd(), home = os.homedir()) {
  const abs = path.resolve(cwd, String(p).replace(/^~(?=\/|$)/, home));
  return under(SECRETS, p, cwd, home) || [abs, real(abs)].some((a) => secretName(a.toLowerCase())) ? REASONS.secret : '';
}
// Each quoted string or escaped space as one word, quotes gone: unquoted, git -C "my repo" push reads as git -C my repo push.
const oneWord = (cmd) => String(cmd).replace(/\\\n/g, '').replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'|\\(.)/gs, (m, a, b, c) => (a ?? b ?? c).replace(/\\/g, '').replace(/\s/g, '_'));
// Then with each command substitution as one word (git -C $(pwd -P) push), innermost first, then inside every quoted string
// (sh -c 'git -C "a b" push'). A string that holds a push is refused as text, same as the plain form.
const quotedBodies = (cmd) => [...String(cmd).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/gs)].map((m) => m[2] ?? m[1].replace(/\\(["\\$`])/g, '$1'));
function pushesInside(cmd) {
  let w = oneWord(cmd), was;
  do { if (pushes(w)) return true; was = w; w = w.replace(/\$\([^()]*\)|`[^`]*`/g, '_'); } while (w !== was);
  return quotedBodies(cmd).some(pushesInside);
}
export function commandReason(cmd, cwd = process.cwd(), home = os.homedir()) {
  if (bigBrace(cmd)) return REASONS.word;
  if (fencedCommand(cmd, cwd, home)) return REASONS.dirs;
  const raw = cmd; cmd = unquote(cmd);
  if (mentionsSsh(cmd, home) || (startsHome(cmd, cwd, home) && /(^|[\s=;&|(`])\.ssh\b/i.test(cmd)) || relReason(cmd, cwd, home) === REASONS.ssh) return REASONS.ssh;
  return treeReason(cmd, cwd, home) || (pushes(cmd) || pushesInside(raw) ? REASONS.push : '') || ownedWrite(cmd);
}

// Private data (config privateDirs, privateTools, privateRemote): folders, tools and remote machines only Claude squiggles may
// reach. The codex, cursor and pi guards add this check; Claude never does. Off until configured. Commands and paths, not prose.
REASONS.private = 'private data is Claude-only here: hand that part to a Claude squiggle through the lead';
const list = (v) => [].concat(v || []).map(String).map((s) => s.trim()).filter(Boolean);
export const privateRules = (cfg = {}) => ({ dirs: list(cfg.privateDirs), tools: list(cfg.privateTools), remote: !!cfg.privateRemote });
const REMOTE_SHELLS = ['ssh', 'scp', 'sftp', 'mosh', 'autossh'];
const DB_CLIENTS = ['psql', 'pg_dump', 'mysql', 'mysqldump', 'mongosh', 'mongo', 'redis-cli'];
const DB_URL = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?):\/\/(?:[^@\/\s]*@)?([^\/:\s?'"]+)/gi;
const DB_DRIVER = /\b(?:pymongo|MongoClient|psycopg2?|mongoose\.connect|pg\.(?:Client|Pool)|redis\.(?:Redis|createClient))\b[\s\S]*\b(?:os\.environ|getenv|process\.env)\b|\b(?:os\.environ|getenv|process\.env)\b[\s\S]*\b(?:pymongo|MongoClient|psycopg2?|mongoose\.connect)\b/;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|0\.0\.0\.0)$/i;
const HOST_ARG = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)/;
const CODE_HOSTS = /^(github|gitlab|bitbucket)\.(com|org)$/i;
// ssh://host/path (and rsync://, git+ssh://): another machine by URL.
const URL_HOST = /^(?:ssh|rsync|git\+ssh|ssh\+git):\/\/(?:[^@/\s]+@)?([^/:\s]+)/i;
// A word naming another machine. host:path with a bare host (an ssh alias like prod:) counts only where a git refspec
// (main:main) can't stand: rsync and unison operands, git clone, ls-remote and remote add/set-url.
const remoteArg = (w, bare) => {
  const u = w.match(URL_HOST); if (u) return !CODE_HOSTS.test(u[1]);
  const m = w.match(HOST_ARG);
  return !!m && !CODE_HOSTS.test(m[1]) && !/^[a-z]$/i.test(m[1]) && (bare || /[.@]/.test(m[0] + m[1]));
};
const SHELLS = ['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'csh', 'tcsh', 'fish'];
const WRAPS = ['sudo', 'exec', 'env', 'nohup', 'time', 'command', 'builtin', 'xargs', 'timeout', 'nice', 'busybox', 'setsid', 'stdbuf', 'caffeinate', ...SHELLS, 'source', '.',
  'do', 'then', 'else', 'elif', 'if', 'while', 'until', '{', ')', '!'];
// Code hidden from the word-by-word check below. LEAD is what may stand before a program, as in that check's wrapper loop.
const SHELL = `(?:\\S*/)?(?:${SHELLS.join('|')})`;
const lead = (words) => `(?:(?:\\w+=(?:"[^"\\n]*"|[^\\s"])*|-\\S+|\\d+[smh]?|(?:\\S*/)?(?:${words.map((w) => w.replace(/[.{)!]/, '\\$&')).join('|')}))\\s+)*`;
const LEAD = lead(WRAPS), RUNS_TEXT = [...SHELLS, 'source', '.'];
// `echo 'ssh x' | nohup sh`, `| sh -s -- a`, `| sh 2>&1`, `| sh -`: the script is only on the pipe.
// `bash -o pipefail`, `bash --rcfile f`: options whose value is the next word.
const SHELL_OPT = '\\s+[-+]\\w*[oO]\\s+[\\w-]+|\\s+--(?:rc|init-)file\\s+\\S+';
const PIPED = new RegExp(`\\|&?[\\s(]*(?:[({](?:[^(){}]*[;&]\\s*|\\s*))?${LEAD}${SHELL}(?:(?:${SHELL_OPT}|\\s+-\\S*|\\s*\\d*&?[<>]+[&|]?\\s*[^\\s;&|)'"]+)*(?:\\s+#.*)?\\s*(?:$|[;&|)])|(?:\\s+-\\S+)*\\s+-\\w*s\\b)`, 'm');
// `/bin/zsh -lc '...'`: the quoted text is the command, not data. The -c text is one shell word: `"rg -n "a" b"` is `rg -n a b`, and `'it'\''s'` is `it's`.
const C_BODY = `${SHELL}(?:${SHELL_OPT}|\\s+[-+]\\S+)*?\\s+-\\w*c\\w*\\s+((?:'[^']*'|"(?:[^"\\\\]|\\\\[\\s\\S])*"|\\\\[\\s\\S]|[^\\s;&|()<>'"\\\\])+)`;
const SHELL_C = new RegExp(`(?:^|[\\s;&|(])${C_BODY}`, 'g'), WRAPPED = new RegExp(`^\\s*${C_BODY}\\s*$`);
const shellBody = (m) => m[1].replace(/'([^']*)'|"((?:[^"\\]|\\[\s\S])*)"|\\([\s\S])/g, (_, one, two, esc) => one ?? esc ?? two.replace(/\\([\s\S])/g, '$1'));
// plain() blanks what a double-quoted body runs, so bodies come from the raw text. Not those inside quotes, which are data, unless a substitution there runs them. A heredoc, escaped quote, $'' or # comment makes quotes unreliable: then all of them.
const spokenBodies = (raw) => {
  const shown = /<<|\\['"]|\$'|(?:^|\s)#/.test(raw) ? raw : raw.replace(/'[^']*'|"(?:[^"\\]|\\[\s\S])*"/g, (q) => (q[0] === '"' && /\$\(|`/.test(q) ? q : '\0'.repeat(q.length)));
  return [...raw.matchAll(SHELL_C)].filter((m) => shown[m.index] !== '\0');
};
// `$(echo ssh) box`, `"a $(echo ssh)" box`, `sh <(echo x)`, `sh -c "$(cat x)"`: the program or script only exists once it runs. Not `x=$(date)`, nor `sh -c "echo $(date)"`.
const BUILT = new RegExp(`(?:^|[;&|\\n(]|\\$\\()\\s*${LEAD}(?:<+\\s*)?[^\\s=)]*(?:\\$\\(|\`|<\\()|(?:^|[;&|\\n(]|\\$\\()\\s*${lead(WRAPS.filter((w) => !RUNS_TEXT.includes(w)))}"[^"\\n]*(?:\\$\\(|\`)`, 'm');
const SUBST = '\\$\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\)|`[^`]*`';
// Inside "a; $(x)" only the $(x) is code: the ; around it is text.
// A `case x in a)` closes SUBST early, so such a quote stays as it is.
const calmed = (q) => /\bcase\b/.test(q) ? q : q.split(new RegExp(`(${SUBST})`)).map((p, i) => (i % 2 ? p : p.replace(/[;&|\n]|(?<!\$)\(/g, ' '))).join('');
// Quoted text is data, unless it runs something: 'a|sh' goes, 's'h and "$(x)" stay.
const masked = (raw) => raw.replace(/\\\n/g, '').replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (q) =>
  q[0] === '"' && /\$\(|`/.test(q) ? calmed(q) : /[\s|;&()<>]/.test(q) ? 'Q' : q.slice(1, -1));
// A line feeding its heredoc to something that runs it: `bash <<'E'`, `$(sh <<'E'`, or a compound's closing `done <<'E'`.
const FED = new RegExp(`(?:^|[\\s;&|(/\`])(?:${[...SHELLS, 'source', 'eval', 'xargs', '\\.'].join('|')})(?=[\\s;&|)<\`]|$)|^\\s*(?:done|fi|esac|[})])`);
const HEREDOC = /<<(-?)\s*(?:'([\w.-]+)'|"([\w.-]+)"|\\([\w.-]+)|([\w.-]+))(?=[\s;&|<>]|$)/y;
// The command without the text the shell treats as data: `;&|(` in double quotes, and bodies of quoted heredocs nothing runs.
// Walks quotes as the shell does, so `echo '<<E'` or `# <<E` can't hide the lines after it. Anything unsure comes back whole.
function plain(raw) {
  if (/\(\(|\bcase\s+\S+\s+in\b/.test(raw)) return raw;
  const stack = [], waiting = [];
  let out = '', i = 0;
  while (i < raw.length) {
    const c = raw[i], top = stack.at(-1), two = raw.slice(i, i + 2);
    if (c === '\\') { out += two; i += 2; continue; }
    if (c === top) { stack.pop(); out += c; i++; continue; }
    if (two === '$(' || two === '${') { stack.push(two === '$(' ? ')' : '}'); out += two; i += 2; continue; }
    if (c === '`') { stack.push(c); out += c; i++; continue; }
    if (top === '"') { out += /[;&|\n(]/.test(c) ? ' ' : c; i++; continue; }
    if (c === "'" || two === "$'") {
      let end = i + (c === "'" ? 1 : 2);
      while (end < raw.length && raw[end] !== "'") end += c !== "'" && raw[end] === '\\' ? 2 : 1;
      out += raw.slice(i, end + 1); i = end + 1; continue;
    }
    if (c === '"' || c === '(') { stack.push(c === '"' ? c : ')'); out += c; i++; continue; }
    if (top !== '}' && c === '#' && (!i || /[\s;&|(]/.test(raw[i - 1]))) {
      const end = raw.indexOf('\n', i);
      if (end < 0) return out + raw.slice(i);
      out += raw.slice(i, end); i = end; continue;
    }
    if (top !== '}' && two === '<<') {
      if (raw[i + 2] === '<') { out += '<<<'; i += 3; continue; }
      HEREDOC.lastIndex = i;
      const m = HEREDOC.exec(raw);
      if (!m || waiting.length > 7) return raw;
      const line = raw.slice(raw.lastIndexOf('\n', i) + 1, (raw.indexOf('\n', i) + 1 || raw.length + 1) - 1);
      waiting.push({ tabs: !!m[1], end: m[2] ?? m[3] ?? m[4] ?? m[5], data: m[5] === undefined && !FED.test(unquote(line)) });
      out += m[0]; i += m[0].length; continue;
    }
    out += c; i++;
    if (c === '\n') for (const h of waiting.splice(0)) {
      let from = i, found = false;
      while (from < raw.length && !found) {
        const stop = raw.indexOf('\n', from), next = stop < 0 ? raw.length : stop;
        found = raw.slice(from, next).replace(h.tabs ? /^\t+/ : '', '') === h.end;
        from = next + 1;
      }
      if (!found) return raw;
      if (!h.data) out += raw.slice(i, from);
      i = from;
    }
  }
  return out;
}
// `p=dumps; cat ~/$p/a.txt`, `for p in a b`: the command read again with the values it set.
function expanded(text) {
  const sets = new Map(), add = (k, v) => sets.set(k, [...(sets.get(k) || []), ...v]);
  for (const m of text.matchAll(/(?:^|[\s;&|(])(\w+)=([^\s;&|`$()<>"]+)(?=[\s;&|)]|$)/gm)) add(m[1], [m[2]]);
  for (const m of text.matchAll(/\bfor\s+(\w+)\s+in\s+([^;\n$`]+)/g)) add(m[1], m[2].trim().split(/\s+/));
  let out = [text];
  for (const [k, vals] of sets) {
    const use = new RegExp(`\\$(?:${k}\\b|\\{${k}\\})`, 'g');
    if (!out.some((t) => t.search(use) >= 0)) continue;
    out = out.flatMap((t) => vals.map((v) => t.replace(use, () => v)));
    // Past the cap the values aren't all read, so the command is judged with $p unknown, not on the first 32.
    if (out.length > 32) return [];
  }
  return out[0] === text ? [] : out;
}
// The text `expanded` reads: quotes dropped, except around a substitution, or x="a; $(date)" would read as two commands.
const keeping = (raw) => raw.split(/("(?:[^"\\]|\\.)*")/).map((p, i) => (i % 2 && /\$\(|`/.test(p) ? p : unquote(p))).join('');
// A variable or $(...) further along a path stands for anything, so it counts as a glob. `$root/x` at the start doesn't.
const starred = (p) => p.replace(/(?<=.)\$(?:\{[^}]*\}|\w+|$)/g, '*');
const WALKERS = ['rg', 'ag', 'fd', 'find', 'tree', 'tar', 'zip', 'du', '7z'];
const isGlob = (s) => /[*?[{]/.test(s);
export function privateReason(tool, input = {}, cwd = process.cwd(), home = os.homedir(), rules = {}) {
  const names = list(rules.dirs), tools = list(rules.tools).map((t) => t.toLowerCase()), remote = !!rules.remote;
  if (!names.length && !tools.length && !remote) return '';
  const t = String(tool || '').toLowerCase();
  if (tools.some((x) => t.includes(x))) return REASONS.private;
  const toHome = (p) => String(p).replace(homeArg(home), home);
  const spelled = names.map((d) => path.resolve(home, toHome(d)).toLowerCase()), dirs = names.map((d) => real(path.resolve(home, toHome(d))).toLowerCase());
  // Once per path for this one check: a repeated word mustn't cost a disk read each time.
  const hits = new Map(), hit = (p, from) => { const k = `${from}\0${p}`;
    if (!hits.has(k)) { const abs = path.resolve(from, toHome(p)); hits.set(k, [abs, real(abs)].some((a) => { a = a.toLowerCase(); return dirs.some((d) => a === d || a.startsWith(d + '/')); })); }
    return hits.get(k); };
  // A path that can name something inside a private folder ('in': ~/cl*/a, ~/**) or a parent of one ('above': ~, ~/work),
  // which only matters to something that walks down (grep -r, find, a Glob tool).
  // Remembered per call: a repeated word was walked against every private folder each time it appeared.
  const reached = new Map(), reach = (p, from) => { const k = `${from}\0${p}`; if (!reached.has(k)) reached.set(k, reachOnce(p, from)); return reached.get(k); };
  const reachOnce = (p, from) => {
    const gs = path.resolve(from, toHome(p)).toLowerCase().split('/').filter(Boolean); let out = '';
    // A glob can't be resolved, so it's held against both spellings: a home reached through a symlink differs from its real path.
    for (const d of new Set([...dirs, ...spelled])) {
      const ds = d.split('/').filter(Boolean); let i = 0, ok = true;
      for (; i < Math.min(gs.length, ds.length); i++) {
        if (gs[i] === '**') return 'in';
        let m; try { m = isGlob(gs[i]) ? globRe(gs[i]).test(ds[i]) : gs[i] === ds[i]; } catch { m = true; }
        if (!m) { ok = false; break; }
      }
      if (!ok) continue;
      if (gs.length >= ds.length) return 'in';
      out = 'above';
    }
    return out;
  };
  const walker = /glob|grep|find|search/i.test(t);
  const strings = []; const walk = (v, k) => { if (typeof v === 'string') strings.push([k, v]); else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) walk(v2, Array.isArray(v) ? k : k2); };
  walk(input, '');
  for (const [k, s] of strings) {
    if (k === 'command' || k === 'cmd') { if (privateCommand(s, cwd, home, { hit, reach, remote, dirs }, 0)) return REASONS.private; continue; }
    const p = s.trim();
    if (!dirs.length || !p || p.includes('\n') || p.length >= 4096) continue;
    const r = reach(p, cwd);
    if (hit(p, cwd) || (r === 'in' && isGlob(p)) || (r === 'above' && walker)) return REASONS.private;
  }
  return '';
}
// One-line helpers (run() { echo "$1"; sh "$1"; }): each plain call is checked as the helper's body with the call's words for
// $1..$9. A helper used any other way ($(run x), run "$f" in a loop) stays as written, so its $1 still refuses.
function inlineHelpers(cmd) {
  for (const [line, name, body] of [...cmd.matchAll(/^[ \t]*(?:function[ \t]+)?([A-Za-z_]\w*)[ \t]*\(\)[ \t]*\{(.*)\}[ \t]*;?[ \t]*$/gm)]) {
    const lines = cmd.split('\n'), word = new RegExp(`(?<![\\w$-])${name}(?![\\w-])`);
    const calls = lines.map((l) => l.match(new RegExp(`^[ \\t]*${name}((?:[ \\t]+[\\w./~@:+,=-]+)*)[ \\t]*$`)));
    if (lines.filter((l) => word.test(l)).length !== 1 + calls.filter(Boolean).length) continue;
    cmd = lines.map((l, i) => l === line ? '' : calls[i] ? body.replace(/\$\{?([1-9])\}?/g, (_, n) => calls[i][1].trim().split(/[ \t]+/)[n - 1] ?? '') : l).join('\n');
  }
  return cmd;
}
// Does the command, before this point, write the script it runs? What's on disk then isn't what will run, so it can't be checked.
// A heredoc is exempt: its lines are read as part of the command.
const writes = (cmd, base) => { const re = new RegExp(`(?:>|\\btee\\s+(?:-a\\s+)?|\\b(?:cp|mv|ln)\\s[^;&|]*\\s|\\b(?:curl|wget)\\s(?:[^;&|]*\\s)?(?:-o|-O|--output)[\\s=]*)\\s*(?:\\S*/)?${esc(base)}(?=[\\s;&|)]|$)`);
  return !!base && cmd.split('\n').some((l) => re.test(l) && !l.includes('<<')); };
// /bin/sh is sh. System folders only: ~/bin/sh is a script and gets read as one.
const sysBin = (w) => w.replace(/^\/(?:usr\/(?:local\/)?|opt\/homebrew\/)?s?bin\/(?=[^/]+$)/, '');
// Git reads private files out of history or the index without naming them: git log -p, git show <rev>, git grep, git diff, git cat-file,
// HEAD:private/a.md. So in a repo holding a private folder (or inside one) those are refused unless the output can't hold file
// contents or is limited to paths outside the fence. Other repos are untouched. Rough: a copy or clone first gets round it.
const repoRoot = (dir) => { for (let d = real(dir); ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, '.git'))) return d; if (d === path.dirname(d)) return ''; } };
const holds = (root, dirs) => { const r = root.toLowerCase(); return !!r && dirs.some((d) => d === r || d.startsWith(r + '/') || r.startsWith(d + '/')); };
const NAMES_ONLY = /^(-s|--no-patch|--stat|--shortstat|--numstat|--name-only|--name-status|--summary)$/;
const PATCH = /^(-\w*[puc]\w*|-U\d*|--patch\S*|--unified\S*|--cc|--dd|--remerge-diff|--diff-merges\S*|--binary|--check|--word-diff\S*|--color-words\S*|--full-diff|-W|--function-context|-[GSL].*)$/;
const REV_PATH = /^[^:]*:(?!\/\/)(.+)$/;
// A real rev:path. Not :/text or HEAD^{/a:b}, which name a commit, nor :0:path, whose path REV_PATH misreads.
const REV_ONLY = /^(?!.*\^\{\/)[^-:][^:]*:.+/;
function gitHistory(ws, here, home, o) {
  let dirs = here, blind = false, i = 1;
  for (; ws[i]?.startsWith('-'); i++) {
    const m = ws[i].match(/^(-[Cc]|--git-dir|--work-tree)(?:=(.*))?$/); if (!m) continue;
    const v = (m[2] ?? ws[++i] ?? '').replace(homeArg(home), home); if (m[1] === '-c') continue;
    if (/\$|^~/.test(v)) blind = true; else dirs = dirs.map((d) => path.resolve(d, v));
  }
  const sub = ws[i], rest = ws.slice(i + 1), roots = dirs.map(repoRoot), inside = dirs.filter((d, k) => holds(roots[k], o.dirs));
  // rev:path starts at the repo root, not the cwd.
  if (rest.some((w) => { const p = w.match(REV_PATH)?.[1]; return p && [...dirs, ...roots.filter(Boolean)].some((d) => o.hit(p, d)); })) return true;
  if (!inside.length && !blind) return false;
  if (['format-patch', 'archive', 'bundle', 'fast-export'].includes(sub)) return true;
  // Only rev:path words: each was just checked. git show HEAD:a <rev> still shows <rev>.
  const named = rest.filter((w) => !w.startsWith('-')), revOnly = !blind && named.length > 0 && named.every((w) => REV_ONLY.test(w));
  if (sub === 'cat-file') return !revOnly && !rest.some((w) => /^-[est]$/.test(w));
  // Read like log: names only until a patch flag. stash -u is a write, so only its read forms count.
  const logs = ['log', 'whatchanged', 'reflog', 'diff-tree', 'diff-index', 'diff-files', 'request-pull'].includes(sub) || sub === 'stash' && ['show', 'list'].includes(rest[0]);
  const patch = rest.some((w) => PATCH.test(w));
  if (logs ? !patch : !['show', 'diff', 'grep'].includes(sub)) return false;
  if (sub !== 'grep' && !patch && (rest.some((w) => NAMES_ONLY.test(w)) || !logs && revOnly)) return false;
  const dash = rest.indexOf('--'), operands = named.slice(sub === 'grep' ? 1 : 0);
  const paths = dash >= 0 ? rest.slice(dash + 1) : operands.filter((w) => inside.some((d) => fs.existsSync(path.resolve(d, w))));
  return blind || !paths.length || paths.some((p) => /[*?[:]/.test(p) || inside.some((d) => o.hit(p, d) || o.reach(p, d)));
}
// `x=$(date) ssh box`, `case x in x) ssh box;; esac`: the program sits after a value or a pattern the segment split can't see past.
const ASSIGNED = new RegExp(`(^|[\\s;&|(])(\\w+=)((?:"(?:[^"\\\\$\`]|\\\\[\\s\\S]|${SUBST}|\\$(?!\\())*"|'[^']*'|${SUBST}|[^\\s;&|()<>"'\`$]|\\$(?!\\())*)`, 'gm');
const flat = (text) => (/\bcase\s+\S+\s+in\b/.test(text) ? text.replace(/\bcase\s+\S+\s+in\s+\(?[^;()\n]*\)|;;&?\s*\(?[^;()\n]*\)|;&\s*\(?[^;()\n]*\)/g, ';') : text)
  .replace(ASSIGNED, (m, at, key, value) => (/\$\(|`/.test(value) ? `${at}${key}S` : m));
// `... | xargs sh`, `xargs -I{} sh -c '{} box'`: the script or part of it comes in on stdin, so it can't be read here.
const XARGS_OPTS = '(?:^|[\\s;&|(/])xargs((?:\\s+-(?:[0oprtx]*[EIJLPRSadns]\\s*\\S+|[\\w-]+(?:=\\S*)?))*)\\s+';
const XARGS = new RegExp(`${XARGS_OPTS}${LEAD}${SHELL}(?=\\s|$|[;&|)])(.*)`, 'm'), XARGS_RUNS = new RegExp(`${XARGS_OPTS}${LEAD}(\\S+)`, 'gm');
// `-I %`, `-0J%`, `--replace=%`; `-i` and `--replace` alone mean {}.
const xargsMark = (opts) => opts.match(/\s(?:-[0oprtx]*[IJ]\s*|-i|--replace=)(\S+)/)?.[1] ?? (/\s(?:-i|--replace)(?![\w-])/.test(opts) ? '{}' : '');
function fedByXargs(text) {
  const m = text.match(XARGS);
  if (!m) return false;
  const mark = xargsMark(m[1]) || '{}';
  return m[2].includes(mark) || /^(?:\s+-\S+)*\s*(?:$|[;&|)])/.test(m[2]);
}
// `echo ssh | xargs -I{} {} box`: the program itself comes in on stdin.
function xargsProgram(text) {
  for (const [, opts, prog] of text.matchAll(XARGS_RUNS)) {
    const mark = xargsMark(opts);
    if (mark && prog.includes(mark)) return true;
  }
  return false;
}
// The same command in the spelling the checks read: `s\h` as `sh`, `function f {` as `() {`, `x+=1` and `x[0]=1` as `x=1`, `${p:-~/a}` as its default.
// Read as well as the original, not instead: `${p:-docs}` could still be anything else. Nesting too deep to unwrap comes back null.
function respelled(text) {
  let t = text.replace(/(?<!<<-?\s*)\\(?=[a-z])/gi, '').replace(/(^|[\s;&|({])function((?:\s+[^\s(){};&|]+)*)(\s+\{)?/g, (m, at, names, brace) => (brace ? `${at}() {` : m)) // takes the whole run of names in one match: retrying from each word is quadratic
    .replace(/(^|[\s;&|(])(\w+)(?:\[[^\]\n]{0,200}\]\+?|\+)=/g, '$1$2=');
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/\$\{\w+:?[-=+]([^{}]*)\}/g, '$1');
    if (next === t) return t;
    t = next;
  }
  return null;
}
const NO_READ = ['echo', 'printf', 'test', '[', ':', 'export'], SYSTEM_VARS = ['HOME', 'PWD', 'TMPDIR'];
function privateCommand(cmd, cwd, home, o, depth, outer = '') {
  const raw = String(cmd), key = createHash('sha1').update([depth, cwd, depth ? '' : outer, raw].join('\0')).digest('base64');
  // flat() and expanded() come back to the same text: read it, and any script it runs, once. Hashed: V8 gives long strings of one length a single bucket.
  if ((o.seen ||= new Set()).has(key)) return false;
  o.seen.add(key);
  const text = inlineHelpers(unquote(raw)), here = [...new Set(places(text, cwd, home))];
  // Code the fence can't read is refused once there is a folder or machine to protect. Tools alone are matched by name.
  const strict = o.remote || o.dirs.length > 0;
  const again = strict ? respelled(raw) : raw;
  if (again === null || again !== raw && privateCommand(again, cwd, home, o, depth, outer)) return true;
  const bare = strict ? plain(raw) : raw, code = masked(bare);
  if (strict && (PIPED.test(bare) || PIPED.test(code) || BUILT.test(code) || fedByXargs(bare) || xargsProgram(code))) return true;
  // plain() blanks the | in a double-quoted body, so a command that is only a wrapper is read from raw.
  const whole = strict ? raw.match(WRAPPED) : null;
  const bodies = !strict ? [] : whole ? [whole] : spokenBodies(raw);
  for (const m of bodies) if (privateCommand(shellBody(m), cwd, home, o, depth, `${outer}\n${bare}`)) return true;
  // Shell bodies were just read, so what follows looks at the rest of the line only.
  const rest = !strict ? bare : whole ? '' : bare.replace(SHELL_C, ' ');
  const level = strict ? flat(rest) : rest;
  if (level !== rest && privateCommand(level, cwd, home, o, depth, outer)) return true;
  const values = strict ? expanded(inlineHelpers(keeping(raw))) : [];
  // Words the shell will read as paths: not single-quoted text, nor double-quoted prose, but "$p/a b" still is.
  const cwdVars = [...raw.matchAll(/(?:^|[\s;&|(])(\w+)=\$\(pwd\)(?=[\s;&|)]|$)/gm)].map((m) => m[1]);
  const open = strict && !depth && o.dirs.length && !values.length ? unquote(bare.replace(/'[^']*'/g, 'Q').replace(/"(?!\$\{?\w+\}?\/)[^"]*"/g, 'Q')) : '';
  if (values.some((t) => privateCommand(t, cwd, home, o, depth, outer))) return true;
  if (o.remote) {
    if (DB_DRIVER.test(raw)) return true;
    for (const m of text.matchAll(DB_URL)) if (!LOCAL.test(m[1])) return true;
  }
  // Each segment's program, past env assignments and wrappers: `grep ssh x.js` passes, `sudo ssh x` doesn't.
  for (const seg of text.split(/[;&|`\n(]|\$\(/)) {
    const ws = seg.trim().split(/\s+/).filter(Boolean); let viaShell = false;
    while (ws.length && (/^\w+=/.test(ws[0]) || WRAPS.includes(sysBin(ws[0])) || /^-/.test(ws[0]) || /^\d+[smh]?$/.test(ws[0]))) {
      if ([...SHELLS, 'source', '.'].includes(sysBin(ws[0]))) viaShell = true;
      ws.splice(0, viaShell && /^[-+]\w*[oO]$/.test(ws[0]) ? 2 : 1);
      // `sh < x.sh`, `bash <<< 'ssh x'`: what follows is the script.
      if (viaShell && ws[0]?.startsWith('<')) { ws[0] = ws[0].replace(/^<+/, ''); if (!ws[0]) ws.shift(); }
    }
    if (!ws.length) continue;
    const prog = ws[0].split('/').pop(), rest = ws.slice(1);
    if (strict && (prog === 'eval' || viaShell && /^\/dev\/(?:stdin|fd\/0)$/.test(ws[0]))) return true;
    // `$c "ls"`: a program held in a variable can't be checked. `sh $D/x.sh` too, in the command itself:
    // inside a script `$DIR/lib.sh` is everyday, and refusing it would stop ordinary scripts.
    if (strict && (/^\$/.test(prog) || !depth && /^\$/.test(ws[0].replace(/^\$\{?HOME\}?(?=\/)/, '')))) return true;
    // `cat $p/a`: a variable nothing here set, leading a path, could be anywhere. Same limit as above: the command itself, not scripts.
    // A value holding a substitution or a variable of unknown worth is no better than an unset variable: q=$(x); p=$q/a.
    const unset = `(?:\\$(?!\\{?(?:${[...SYSTEM_VARS, ...cwdVars].join('|')})\\b)|\`)`;
    if (open && !NO_READ.includes(prog) && rest.some((w) => { const m = w.match(/^[<>]*\$\{?(\w+)\}?\//); return m && open.includes(w) && (w.includes('/../') || !(SYSTEM_VARS.includes(m[1]) || cwdVars.includes(m[1]) || new RegExp(`(?:^|[\\s;&|(])${m[1]}=(?!"[^"]*${unset}|[^\\s;&|]*${unset})`, 'm').test(outer))); })) return true;
    if (o.remote) {
      if (REMOTE_SHELLS.includes(prog) && rest.join(' ') !== '-V') return true;
      if (prog === 'tailscale' && rest[0] === 'ssh') return true;
      const host = seg.match(/(?:^|\s)(?:-h|--host)(?:=|\s*)([^\s-]\S*)/);
      if (DB_CLIENTS.includes(prog) && host && !LOCAL.test(host[1])) return true;
      // rsync, git and unison reach another machine over ssh with host:path or an ssh:// URL (code hosts and drive letters excepted).
      if (['rsync', 'git', 'unison'].includes(prog)) {
        const bare = prog !== 'git' || rest.some((w) => ['clone', 'ls-remote'].includes(w)) || (rest.includes('remote') && rest.some((w) => ['add', 'set-url'].includes(w)));
        if (rest.some((w) => remoteArg(w, bare))) return true;
      }
    }
    if (o.dirs.length) {
      if (prog === 'git' && gitHistory(ws, here, home, o)) return true;
      // grep -r ~/work, find ~: a walk from a parent reaches the private folders under it.
      const flags = rest.filter((w) => /^-/.test(w)).join(' '), args = rest.filter((w) => !/^-/.test(w));
      const walks = WALKERS.includes(prog) || /(^|\s)--recursive\b/.test(flags)
        || (['grep', 'egrep', 'fgrep', 'chmod', 'chown'].includes(prog) && /(^|\s)-[a-zA-Z]*[rR]/.test(flags))
        || (prog === 'ls' && /(^|\s)-[a-zA-Z]*R/.test(flags)) || (['cp', 'rsync'].includes(prog) && /(^|\s)-[a-zA-Z]*[rRa]/.test(flags));
      const targets = /grep$/.test(prog) && args.length <= 1 || !/grep$/.test(prog) && !args.length ? [...args, '.'] : args;
      if (walks && here.some((dir) => targets.some((w) => o.reach(w, dir) === 'above'))) return true;
    }
    // A script run here gets the same check, two levels deep, found from every folder the command cd's to.
    // Its own $(dirname "$0") reads as the script's folder.
    if (depth < 2 && (viaShell || ws[0].includes('/') || /\.(sh|bash|zsh)$/.test(ws[0]))) {
      const rel = ws[0].replace(homeArg(home), home);
      if (strict && !depth && /^[\w.~\/-]+$/.test(rel) && writes(text.slice(0, text.lastIndexOf(seg)), path.basename(rel))) return true;
      for (const f of new Set(here.map((dir) => path.resolve(dir, rel)))) {
        // Opened without blocking and checked on the open file: a FIFO hung the guard with no CPU use, past its CPU limit, until
        // the client's hook timeout ran the tool. Its body is unknown, so anything but a regular file or folder refuses.
        let body = '', odd = false;
        try { const fd = fs.openSync(f, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); try { const st = fs.fstatSync(fd); odd = !st.isFile() && !st.isDirectory(); if (st.isFile() && st.size < 256 * 1024) body = fs.readFileSync(fd, 'utf8'); } finally { fs.closeSync(fd); } } catch {}
        if (odd) return true;
        if (!body || body.includes('\0') || !(viaShell || new RegExp(`^#!.*\\b(${SHELLS.join('|')})\\b`).test(body))) continue;
        body = body.replace(/\$\(\s*dirname\s+(?:--\s+)?["']?\$\{?(?:0|BASH_SOURCE(?:\[0\])?)\}?["']?\s*\)|\$\{(?:0|BASH_SOURCE(?:\[0\])?)%\/\*\}/g, () => path.dirname(f));
        if (privateCommand(body, path.dirname(f), home, o, depth + 1)) return true;
      }
    }
  }
  if (!o.dirs.length) return false;
  // Each distinct word once: 1,000 copies of one long word cost 1,000 resolves and regex passes.
  const words = [...new Set(text.split(/[\s;|&()<>`]+/).filter(Boolean).flatMap((w) => braces(w)))];
  // `cat ~/te$(echo am)/alpha/a`: a substitution inside a path counts as a glob.
  const globs = strict ? masked(rest).replace(/["'\\]/g, '').replace(new RegExp(SUBST, 'g'), '*').split(/[\s;|&()<>=]+/).filter((w) => w.includes('*') && w.includes('/')) : [];
  if (here.some((dir) => globs.some((w) => o.reach(w, dir) === 'in'))) return true;
  return here.some((dir) => words.some((w) => w.split('=').some((part) => {
    const p = values.length ? part : starred(part);
    return p && (o.hit(p, dir) || (isGlob(p) && o.reach(p, dir) === 'in'));
  })));
}
// What the codex, cursor and pi guards call: the rules from <data dir>/config.json, read on every call so a change applies
// at once. No file: off. A file that can't be read: blocked, since the rules are unknown.
export const ROOM_PORT = 4327;
const dataDir = () => path.resolve(String(process.env.SQUIGGLES_HOME || '~/.squiggles').replace(/^~(?=\/|$)/, os.homedir()));
export function savedRules(dir = dataDir()) {
  try { return privateRules(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))); }
  catch (e) { return e.code === 'ENOENT' ? privateRules({}) : null; }
}
export function privateCheck(tool, input, cwd = process.cwd(), home = os.homedir(), dir = dataDir()) {
  const rules = savedRules(dir);
  return rules ? privateReason(tool, input, cwd, home, rules) : 'config.json in the data folder could not be read, so the private-data rules are unknown: fix it to go on';
}

// Claude in Chrome carries the user's saved login, so the room reads a Chrome page action as them. Every Chrome tool's input is read whole: batches nest
// URLs and scripts hold them. Any spelling of loopback shares the port, and a share host counts only while that share is offered. Read on every call, as above.
// Not seen: a room tab already open, a URL built at run time.
export const CHROME_TOOL = /^mcp__claude-in-chrome__/;
export function roomReason(input = {}, dir = dataDir()) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) ?? {}; }
  catch (e) { if (e.code !== 'ENOENT') return 'config.json in the data folder could not be read, so the room address is unknown: fix it to go on'; }
  const port = process.env.PORT || cfg.port || ROOM_PORT, hosts = [cfg.tailnet && 'ts\\.net', cfg.cloudflare && 'trycloudflare\\.com'].filter(Boolean);
  const room = new RegExp(`:0*${esc(String(port))}(?!\\d)${hosts.map((h) => `|\\.${h}(?![\\w-])`).join('')}`, 'i');
  return strings(input).some((t) => room.test(asChromeReads(t))) ? REASONS.room : '';
}
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : []);
// Chrome decodes a URL before it opens it, and a script decodes its own escapes: undo both, a few rounds deep, and fold wide dots and digits.
const code = (h) => { const n = parseInt(h, 16); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; };
function asChromeReads(t) {
  for (let i = 0, was = ''; i < 5 && was !== t; i++) {
    was = t;
    t = t.replace(/%([0-9a-f]{2})/gi, (_, h) => code(h)).replace(/\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|u\{([0-9a-f]{1,6})\})/gi, (_, a, b, c) => code(a || b || c));
  }
  return t.normalize('NFKC').replace(/[\u3002\uff61]/g, '.');
}

// Peer-private logs. Every squiggle's private/ folder is closed to the others; a squiggle marked private closes its journal
// and transcript too. The lead and the owner of the files pass, and so does a process that is no squiggle.
const metaOf = (root, id) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'squiggles', id, 'squiggle.json'), 'utf8')); } catch { return null; } };
export function privatePaths(self, root = dataDir()) {
  if (!self || metaOf(root, self)?.lead) return [];
  let ids = []; try { ids = fs.readdirSync(path.join(root, 'squiggles')); } catch { return []; }
  return ids.filter((id) => id !== self).flatMap((id) => {
    const d = path.join(root, 'squiggles', id);
    return [path.join(d, 'private'), ...(metaOf(root, id)?.private === true ? [path.join(d, 'journal.md'), path.join(root, 'runs', `${id}.jsonl`)] : [])];
  });
}
// A glob reaches a closed path when its folders match all the way down; ** spans any number.
const globReaches = (gs, cs, i = 0, j = 0) => {
  if (j >= cs.length) return true;
  if (i >= gs.length) return false;
  if (gs[i] === '**') return globReaches(gs, cs, i + 1, j) || globReaches(gs, cs, i, j + 1);
  let ok; try { ok = globRe(gs[i]).test(cs[j]); } catch { ok = true; }
  return ok && globReaches(gs, cs, i + 1, j + 1);
};
// Every provider, Claude too, so it reads paths only. A folder above a closed file passes: grep -r from the repo has to keep
// working, so a walk isn't refused. This keeps honest squiggles out; it isn't a sandbox.
export function peerReason(tool, input = {}, o = {}) {
  const closed = o.closed || privatePaths(o.self ?? process.env.AGENTS_ID, o.root);
  if (!closed.length) return '';
  const home = o.home || os.homedir(), cwd = o.cwd || process.cwd(), low = closed.map((c) => c.toLowerCase()), segs = closed.map((c) => c.split('/').filter(Boolean)), seen = new Map();
  const within = (a) => low.some((c) => a === c || a.startsWith(c + '/'));
  const hit = (p, from) => {
    const abs = path.resolve(from, homeWord(p, home));
    if (!seen.has(abs)) seen.set(abs, within(abs.toLowerCase()) || within(real(abs).toLowerCase()) || (/[*?[{]/.test(p) && segs.some((c) => globReaches(abs.split('/').filter(Boolean), c))));
    return seen.get(abs);
  };
  const found = [], walk = (v, k) => { if (typeof v === 'string') found[found.length] = [k, v]; else if (v && typeof v === 'object') Object.entries(v).forEach(([k2, v2]) => walk(v2, Array.isArray(v) ? k : k2)); };
  walk(input, '');
  for (const [k, s] of found) {
    if (k === 'command' || k === 'cmd') {
      const cmd = s.replace(/\\\n/g, '').replace(/["'\\]/g, ''), words = cmd.split(/[\s;|&()<>=`]+/).filter(Boolean).flatMap((w) => braces(w));
      for (const dir of new Set(places(cmd, cwd, home))) if (words.some((w) => hit(w, dir))) return REASONS.peer;
    } else if (!s.includes('\n') && s.length < 4096 && s.trim() && hit(s.trim(), cwd)) return REASONS.peer;
  }
  return '';
}
