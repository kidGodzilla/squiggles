// Pre-commit check for squiggle commits (AGENTS_ID set). The Owner is never checked.
// In a checkout several squiggles share, a squiggle may not commit lines that are someone else's work:
// lines already uncommitted when its turn started (the server snapshots `git diff HEAD` at turn start),
// or lines another squiggle wrote during the turn, with Edit/Write or with Bash.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './config.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dirty = (data) => path.join(data, 'runs', 'dirty');
export const snapPath = (id, data = dataDir()) => path.join(dirty(data), `${id}.json`);
export const wrotePath = (id, data = dataDir()) => path.join(dirty(data), `${id}.wrote.jsonl`);
const DAY = 864e5;
const keep = (l) => l.trim().length >= 12; // short lines (braces, blanks) say nothing about who wrote them

// Added lines per file from a `git diff -U0` patch.
export function addedLines(diff) {
  const out = new Map(); let file = null;
  for (const l of String(diff).split('\n')) {
    if (l.startsWith('+++ ')) { file = l === '+++ /dev/null' ? null : l.slice(4).replace(/^b\//, ''); if (file && !out.has(file)) out.set(file, new Set()); continue; }
    if (file && l.startsWith('+') && keep(l.slice(1))) out.get(file).add(l.slice(1).trim());
  }
  return out;
}

// Files whose staged added lines include lines that were already uncommitted at turn start.
export function foreign(staged, atStart) {
  const before = addedLines(atStart), hits = [];
  for (const [file, lines] of addedLines(staged)) {
    const was = before.get(file); if (!was) continue;
    const n = [...lines].filter((l) => was.has(l)).length;
    if (n) hits.push({ file, n });
  }
  return hits;
}

// Lines a squiggle writes with Edit/Write mid-turn, so a peer whose turn started earlier doesn't commit them.
export function writtenLines(name, input = {}) {
  const t = name === 'Write' ? [input.content] : name === 'Edit' ? [input.new_string] : name === 'MultiEdit' ? (input.edits || []).map((e) => e.new_string)
    : name === 'NotebookEdit' ? [input.new_source] : [];
  const lines = new Set();
  for (const x of t) for (const l of String(x ?? '').split('\n')) if (keep(l)) lines.add(l.trim());
  return [...lines].slice(0, 2000);
}
export function noteWrite(id, c, data = dataDir()) {
  const file = c?.input?.file_path || c?.input?.notebook_path;
  if (!id || !file || !path.isAbsolute(file)) return;
  const lines = writtenLines(c.name, c.input); if (!lines.length) return;
  fs.mkdir(dirty(data), { recursive: true }, () => fs.appendFile(wrotePath(id, data), JSON.stringify({ at: Date.now(), file, lines }) + '\n', () => {}));
}
// Bash edits (sed, heredocs, scripts) aren't tool inputs, so at the end of each Bash call the files it changed in the
// squiggle's repo (mtime inside the call) are read back: lines new since its turn start, claimed by nobody, are its writes.
// When another squiggle's Bash call in the same checkout overlaps, neither is recorded: no guess beats a wrong owner.
const bashOpen = new Map(), bashDone = []; // tool_use id -> {id, cwd, at}; ended windows, for overlap
export function bashStart(id, c, cwd) {
  if (id && cwd && c?.name === 'Bash' && c.id && !c.input?.run_in_background) bashOpen.set(c.id, { id, cwd, at: Date.now() });
}
export function bashEnd(useId, data = dataDir(), done = () => {}) {
  const b = bashOpen.get(useId); if (!b) return done(null);
  bashOpen.delete(useId); const end = Date.now(); b.end = end;
  while (bashDone.length && bashDone[0].end < end - 36e5) bashDone.shift();
  const clash = [...bashOpen.values(), ...bashDone].some((o) => o.id !== b.id && o.cwd === b.cwd && o.at <= end && (o.end ?? end) >= b.at);
  bashDone.push(b);
  if (clash) return done(null);
  execFile('git', ['-C', b.cwd, 'rev-parse', '--show-toplevel'], (e, top) => {
    if (e) return done(null); top = top.trim();
    execFile('git', ['-C', top, 'status', '--porcelain', '-z', '--untracked-files=all'], { maxBuffer: 16 << 20 }, (e2, st) => {
      if (e2) return done(null);
      const tracked = [], fresh = [];
      for (const r of st.split('\0')) {
        if (r.length < 4 || r[2] !== ' ') continue; const f = r.slice(3), abs = path.join(top, f);
        let m = 0; try { const x = fs.statSync(abs); if (!x.isFile() || x.size > 2e6) continue; m = x.mtimeMs; } catch { continue; }
        if (m < b.at - 50 || m > end + 50) continue;
        (r.startsWith('??') ? fresh : tracked).push(f);
      }
      if (!tracked.length && !fresh.length) return done(null);
      const finish = (diff) => {
        const now = addedLines(diff);
        for (const f of fresh) { try { now.set(f, new Set(fs.readFileSync(path.join(top, f), 'utf8').split('\n').filter(keep).map((l) => l.trim()))); } catch {} }
        let snap = null; try { snap = JSON.parse(fs.readFileSync(snapPath(b.id, data), 'utf8')); } catch {}
        const before = snap?.repo === top ? addedLines(snap.diff) : new Map(), claimed = claimedLines(b.id, data);
        const rows = [];
        for (const [f, set] of now) {
          const abs = path.join(top, f), was = before.get(f);
          const lines = [...set].filter((l) => !was?.has(l) && !claimed.has(`${abs}\0${l}`)).slice(0, 2000);
          if (lines.length) rows.push({ at: end, file: abs, lines, bash: true });
        }
        if (!rows.length) return done([]);
        fs.mkdir(dirty(data), { recursive: true }, () =>
          fs.appendFile(wrotePath(b.id, data), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', () => done(rows)));
      };
      if (!tracked.length) return finish('');
      execFile('git', ['-C', top, 'diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff', '--', ...tracked], { maxBuffer: 64 << 20 }, (e3, d) => finish(e3 ? '' : d));
    });
  });
}
// Lines (absolute file + line) other squiggles recorded in the last day: never re-claimed as this squiggle's Bash writes.
function claimedLines(id, data) {
  const out = new Set(), real = new Map(); let names = [];
  const rp = (f) => { if (!real.has(f)) { let r = f; try { r = path.join(fs.realpathSync(path.dirname(f)), path.basename(f)); } catch {} real.set(f, r); } return real.get(f); };
  try { names = fs.readdirSync(dirty(data)).filter((f) => f.endsWith('.wrote.jsonl') && f !== `${id}.wrote.jsonl`); } catch {}
  for (const n of names) {
    let t = ''; try { t = fs.readFileSync(path.join(dirty(data), n), 'utf8'); } catch { continue; }
    for (const row of t.split('\n')) { let e; try { e = JSON.parse(row); } catch { continue; } if (e.at > Date.now() - DAY) for (const l of e.lines || []) out.add(`${rp(e.file)}\0${l}`); }
  }
  return out;
}
// Staged lines (repo-relative file -> count) that another squiggle wrote since `since` and `id` itself didn't.
export function peerWrites(id, staged, top, since, data = dataDir()) {
  let names = []; try { names = fs.readdirSync(dirty(data)).filter((f) => f.endsWith('.wrote.jsonl')); } catch {}
  const by = new Map(), mine = new Set(); // `${rel}\0${line}` -> peer ids
  const real = new Map(), rp = (f) => { // tool paths may go through a symlink (/tmp, /var); git's toplevel doesn't
    if (!real.has(f)) { let r = f; try { r = path.join(fs.realpathSync(path.dirname(f)), path.basename(f)); } catch {} real.set(f, r); }
    return real.get(f);
  };
  for (const n of names) {
    const who = n.slice(0, -'.wrote.jsonl'.length);
    let text = ''; try { text = fs.readFileSync(path.join(dirty(data), n), 'utf8'); } catch { continue; }
    for (const row of text.split('\n')) {
      let e; try { e = JSON.parse(row); } catch { continue; }
      if (!(e.at >= since)) continue;
      const rel = path.relative(top, rp(e.file)); if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      for (const l of e.lines || []) { const k = `${rel}\0${l}`; if (who === id) mine.add(k); else { if (!by.has(k)) by.set(k, new Set()); by.get(k).add(who); } }
    }
  }
  const hits = [];
  for (const [file, lines] of addedLines(staged)) {
    const peers = new Set(); let n = 0;
    for (const l of lines) { const k = `${file}\0${l}`; if (mine.has(k) || !by.has(k)) continue; n++; for (const p of by.get(k)) peers.add(p); }
    if (n) hits.push({ file, n, peers: [...peers] });
  }
  return hits;
}

// Turn start: record what was already uncommitted in the squiggle's repo. Async: never blocks the server.
export function snapshot(id, cwd, data = dataDir(), done = () => {}) {
  execFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], (e, top) => {
    const file = snapPath(id, data);
    if (e) { fs.rm(file, { force: true }, () => done()); return; }
    top = top.trim();
    pruneWrites(id, data);
    execFile('git', ['-C', top, 'diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff'], { maxBuffer: 64 << 20 }, (e2, diff) => {
      if (e2) { fs.rm(file, { force: true }, () => done()); return; }
      fs.mkdirSync(dirty(data), { recursive: true });
      fs.writeFile(file, JSON.stringify({ repo: top, at: Date.now(), diff }), () => done());
    });
  });
}

function pruneWrites(id, data) {
  const f = wrotePath(id, data);
  fs.readFile(f, 'utf8', (e, t) => {
    if (e) return;
    const rows = t.split('\n').filter((r) => { try { return JSON.parse(r).at > Date.now() - DAY; } catch { return false; } });
    fs.writeFile(f, rows.length ? rows.join('\n') + '\n' : '', () => {});
  });
}

// Point a repo's hooks at ours, unless it has hooks of its own: another core.hooksPath, or a live hook in .git/hooks.
export function installHook(repo, hooks = path.join(ROOT, 'bin', 'hooks'), done = () => {}) {
  execFile('git', ['-C', repo, 'config', '--get', 'core.hooksPath'], (_, cur) => {
    if (String(cur || '').trim()) return done(false);
    execFile('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], (e, gd) => {
      if (e) return done(false);
      let own = []; try { own = fs.readdirSync(path.join(gd.trim(), 'hooks')).filter((f) => !f.endsWith('.sample')); } catch {}
      if (own.length) return done(false);
      execFile('git', ['-C', repo, 'config', 'core.hooksPath', hooks], (e2) => done(!e2));
    });
  });
}

// A guard bug must not stop every squiggle commit: on a crash it warns and lets the commit through.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  const id = process.env.AGENTS_ID; if (!id) process.exit(0);
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });
  const top = git('rev-parse', '--show-toplevel').trim();
  const msgs = [], fix = 'Stage only your own hunks: git restore --staged <file>; git diff <file> > /tmp/mine.patch; delete the other hunks from the patch; git apply --cached /tmp/mine.patch.';
  let snap = null; try { snap = JSON.parse(fs.readFileSync(snapPath(id), 'utf8')); } catch {}
  if (snap?.repo === top && !process.env.AGENTS_MINE) {
    const staged = git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff');
    const peer = peerWrites(id, staged, top, snap.at);
    if (peer.length) msgs.push(`staged lines another squiggle wrote during this turn:\n${peer.map((h) => `  ${h.file}: ${h.n} line${h.n > 1 ? 's' : ''} by ${h.peers.join(', ')}`).join('\n')}\n${fix}`);
    const hits = foreign(staged, snap.diff);
    if (hits.length) msgs.push(`staged lines that were already uncommitted when this turn started, so another agent's work:\n${hits.map((h) => `  ${h.file}: ${h.n} line${h.n > 1 ? 's' : ''}`).join('\n')}\n${fix} If those lines are yours from an earlier turn, commit with AGENTS_MINE=1.`);
  }
  if (msgs.length) { console.error(`Commit refused: ${msgs.join('\n\n')}`); process.exit(1); }
} catch (e) { console.error(`commit guard skipped: ${e.message}`); }
