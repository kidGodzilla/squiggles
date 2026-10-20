// Goals (the whiteboard) and tasks (the sticky notes). Plain JSON files that the user, the lead and squiggles all edit.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const today = () => new Date().toISOString().slice(0, 10);
const TIERS = ['active', 'hold', 'todo', 'done'];
const STATUSES = ['todo', 'doing', 'review', 'blocked', 'done'];
// Merge policy per goal. gated: a branch per task, merged from the Merge tab. open: commit to main. Missing means gated.
const MERGE = ['gated', 'open'];
const expand = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
const hasBranch = (repo, branch) => { try { execFileSync('git', ['-C', expand(repo), 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { stdio: 'pipe' }); return true; } catch { return false; } };
// A review task names a branch. "repo:branch" pins the repo (a path or a goal repo's name); a bare branch is looked up in the goal's repos.
function resolveBranch(spec, goal) {
  const m = /^(.*?):([^:]+)$/.exec(String(spec || '').trim());
  let repo = m ? m[1] : '', branch = (m ? m[2] : String(spec || '')).trim();
  if (!branch) throw new Error('review needs a branch: task move <id> review [repo:]<branch> ["<test result>"]');
  const repos = goal?.repos || [];
  // A bare name (api) means the goal's repo of that name, else ~/<name> (t1197).
  if (repo && !/[/~]/.test(repo)) repo = repos.find((r) => path.basename(expand(r)) === repo) || `~/${repo}`;
  if (repo) { if (!hasBranch(repo, branch)) throw new Error(`no branch ${branch} in ${repo}`); return { repo, branch }; }
  if (!repos.length) return { branch };
  const found = repos.filter((r) => hasBranch(r, branch));
  // In several repos: one task across them (t1197). The first is the task's repo; merging takes every one.
  if (found.length) return { repo: found[0], branch };
  throw new Error(`branch ${branch} not found in ${repos.join(' ')}: commit on it first, or give repo:branch`);
}
// https://github.com/o/r for a repo whose origin is on GitHub (ssh, scp-style or https), else ''.
function githubOf(repo) {
  let u = ''; try { u = git(repo, ['remote', 'get-url', 'origin']); } catch { return ''; }
  const m = u.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : '';
}
const git = (repo, args, opts = {}) => execFileSync('git', ['-C', expand(repo), ...args], { stdio: 'pipe', encoding: 'utf8', maxBuffer: 32 << 20, env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' }, ...opts }).trim();
// Async git for the merge listing (t961): sync git per review branch froze the server for 17 s.
const pexec = promisify(execFile);
const gitA = async (repo, args) => (await pexec('git', ['-C', expand(repo), ...args], { encoding: 'utf8', maxBuffer: 32 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
const okA = (p) => p.then(() => true, () => false);
// Files that would conflict merging branch into base (t783), [] if clean. merge-tree exits 1 on conflicts, file names after the tree id.
const conflictsA = (repo, base, branch) => gitA(repo, ['merge-tree', '--write-tree', '--name-only', base, branch]).then(() => [],
  (e) => { if (e.code !== 1) throw e; return String(e.stdout || '').split('\n\n')[0].split('\n').slice(1).filter(Boolean); });
async function baseOfA(repo) {
  try { return (await gitA(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, ''); } catch {}
  for (const b of ['main', 'master']) if (await okA(gitA(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]))) return b;
  throw new Error(`no main or master branch in ${repo}`);
}
// One lookup per repo per listing: many review branches share a repo.
const memo = () => { const m = new Map(); return (k, f) => (m.has(k) ? m : m.set(k, f())).get(k); };
// At most n at a time, results in order.
async function pool(items, n, f) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } })); return out; }
// The branch a gated repo merges into: origin's default branch, else main, else master.
function baseOf(repo) {
  try { return git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, ''); } catch {}
  for (const b of ['main', 'master']) if (hasBranch(repo, b)) return b;
  throw new Error(`no main or master branch in ${repo}`);
}
const daysSince = (d) => (d ? Math.floor((Date.now() - Date.parse(d + 'T12:00:00')) / 864e5) : 0);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Every harness worktree lives at ~/wt/<repo>-<task> (t769).
export const WT = process.env.AGENTS_WT || path.join(os.homedir(), 'wt');
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
// Uncommitted changes in a worktree, not counting an untracked node_modules symlink (the usual way to share installs).
const dirtyOf = (p) => git(p, ['status', '--porcelain']).split('\n').filter(Boolean).filter((l) => !(/^\?\? node_modules\/?$/.test(l) && isLink(path.join(p, 'node_modules'))));
// Extra worktrees of a repo (not its main checkout): { path, branch, head, locked }.
export function worktreesOf(repo) {
  let list; try { list = git(repo, ['worktree', 'list', '--porcelain']); } catch { return []; }
  return list.split(/\n\n+/).slice(1).map((b) => ({ path: b.match(/^worktree (.+)$/m)?.[1], branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1] || '', head: b.match(/^HEAD (\w+)/m)?.[1]?.slice(0, 8) || '', locked: /^locked/m.test(b), prunable: /^prunable/m.test(b) })).filter((w) => w.path);
}
// Worktrees on a branch or at one of the given paths (t292, t769): clean ones are removed (never --force), dirty or locked kept; then prune.
export function dropWorktrees(repo, branch, paths = []) {
  const out = { removed: [], kept: [] };
  for (const w of worktreesOf(repo)) {
    if (!((branch && w.branch === branch) || paths.includes(w.path))) continue;
    try {
      if (!fs.existsSync(w.path)) { out.removed.push(w.path); continue; } // gone already: prune drops it
      if (w.locked || dirtyOf(w.path).length) throw new Error('dirty');
      if (isLink(path.join(w.path, 'node_modules'))) fs.unlinkSync(path.join(w.path, 'node_modules'));
      git(repo, ['worktree', 'remove', w.path]); out.removed.push(w.path);
    } catch { out.kept.push(w.path); }
  }
  try { git(repo, ['worktree', 'prune']); } catch {}
  return out;
}
// branch -d, never -D: git refuses if it isn't merged. -d checks against HEAD, so run it where the base is checked out, else in a temp worktree.
function deleteMerged(repo, branch) {
  const base = baseOf(repo); if (!branch || branch === base || !hasBranch(repo, branch)) return false;
  if (Number(git(repo, ['rev-list', '--count', `${base}..${branch}`])) > 0) return false;
  const onBase = git(repo, ['worktree', 'list', '--porcelain']).split(/\n\n+/).find((b) => b.match(/^branch (.+)$/m)?.[1] === `refs/heads/${base}`)?.match(/^worktree (.+)$/m)?.[1];
  let tmp;
  try {
    let at = onBase;
    if (!at) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-d-')); fs.rmdirSync(tmp); git(repo, ['worktree', 'add', '--quiet', '--detach', tmp, base]); at = tmp; }
    git(at, ['branch', '-d', branch]); return true;
  } catch { return false; } finally { if (tmp) { try { git(repo, ['worktree', 'remove', tmp]); } catch {} try { git(repo, ['worktree', 'prune']); } catch {} } }
}
const STOP = new Set('the a an and or of to in on for with is are be no not it its this that from at by as has have'.split(' '));
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
// Two titles name the same thing when most of their words overlap (Jaccard over content words).
export function similar(a, b) { const x = words(a), y = words(b); if (!x.size || !y.size) return false; let i = 0; for (const w of x) if (y.has(w)) i++; return i / (x.size + y.size - i) >= 0.5; }
export function createBoard(root, onChange, { onConflict } = {}) {
  const GOALS = path.join(root, 'goals.json'), TASKS = path.join(root, 'tasks.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const goals = () => { const g = read(GOALS, {}); for (const t of TIERS) { g[t] = g[t] || []; for (const x of g[t]) x.merge = x.merge === 'open' ? 'open' : 'gated'; } return g; };
  const tasks = () => read(TASKS, { tasks: [] }).tasks;
  const write = (f, v) => { fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
  const saveGoals = (g) => write(GOALS, g);
  const saveTasks = (t) => write(TASKS, { tasks: t });

  // Agents edit these files directly too: any change on disk refreshes every open board.
  let timer;
  for (const f of [GOALS, TASKS]) {
    if (!fs.existsSync(f)) f === TASKS ? saveTasks([]) : saveGoals(goals());
    fs.watch(f, { persistent: false }, () => { clearTimeout(timer); timer = setTimeout(onChange, 120); });
  }

  function findGoal(g, id) {
    for (const t of TIERS) { const i = g[t].findIndex((x) => x.id === id); if (i >= 0) return { tier: t, i, goal: g[t][i] }; }
    throw new Error(`no goal ${id}`);
  }
  function goalOp({ op, id, title, tier, owner, note, index, repos, merge, kind }) {
    const g = goals();
    // An area (t977) is an ongoing responsibility with no finish line; a goal finishes.
    if (kind !== undefined && !['goal', 'area'].includes(kind)) throw new Error('kind must be goal or area');
    if (merge !== undefined && !MERGE.includes(merge)) throw new Error(`merge must be one of ${MERGE.join(', ')}`);
    if (op === 'add') {
      if (!title) throw new Error('a goal needs a title');
      const goal = { id: slug(id || title), title, last_confirmed: today(), ...(owner ? { owner } : {}), ...(note ? { note } : {}), ...(repos?.length ? { repos } : {}), merge: merge || 'gated' };
      if (TIERS.some((t) => g[t].some((x) => x.id === goal.id))) goal.id += '-' + Date.now().toString(36).slice(-3);
      g[TIERS.includes(tier) ? tier : 'active'].push(goal); saveGoals(g); return goal;
    }
    const f = findGoal(g, id);
    if (op === 'drop') g[f.tier].splice(f.i, 1);
    else if (op === 'move') {
      if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
      g[f.tier].splice(f.i, 1); f.goal.last_confirmed = today();
      g[tier].splice(index == null ? g[tier].length : Math.max(0, Math.min(index, g[tier].length)), 0, f.goal);
    } else if (op === 'confirm') f.goal.last_confirmed = today();
    else if (op === 'edit') {
      if (title != null) { if (!String(title).trim()) throw new Error('a goal needs a title'); f.goal.title = title; }
      if (owner !== undefined) { if (owner) f.goal.owner = owner; else delete f.goal.owner; }
      if (note !== undefined) { if (note) f.goal.note = note; else delete f.goal.note; }
      if (repos !== undefined) { const r = (Array.isArray(repos) ? repos : String(repos).split(/[\s,]+/)).filter(Boolean); if (r.length) f.goal.repos = r; else delete f.goal.repos; }
      if (merge !== undefined) f.goal.merge = merge;
      if (kind !== undefined) { if (kind === 'area') f.goal.kind = 'area'; else delete f.goal.kind; }
    } else throw new Error(`unknown goal op ${op}`);
    saveGoals(g); return f.goal;
  }

  function taskOp({ op, id, title, goal, owner, status, note, by, parent, split, titles, branch, act, text, n, repo: repoArg, evidence, why }) {
    const t = tasks();
    // Suggestions (t825): a squiggle notices something outside its task and files it for the lead, unowned and off every goal.
    // Similar titles (open or declined) count as the same suggestion. accept turns it into a normal task; decline closes it.
    if (op === 'suggest') {
      if (!String(title || '').trim()) throw new Error('a suggestion needs one line saying what you noticed');
      const same = t.find((x) => x.kind === 'suggestion' && (x.status !== 'done' || x.decision === 'declined') && similar(x.title, title));
      if (same) { if (by && by !== same.by && !(same.also || []).includes(by)) { same.also = [...(same.also || []), by]; saveTasks(t); } return { ...same, dup: true }; }
      const n = t.reduce((m, x) => Math.max(m, parseInt(String(x.id).slice(1), 10) || 0), 0) + 1;
      const task = { id: 't' + n, kind: 'suggestion', title: String(title).trim(), status: 'todo', created: today(), confirmed: today(), ...(by ? { by } : {}), ...(evidence ? { evidence: String(evidence).trim() } : {}) };
      t.push(task); saveTasks(t); return task;
    }
    if (op === 'add') {
      if (!title) throw new Error('a task needs a title');
      const n = t.reduce((m, x) => Math.max(m, parseInt(String(x.id).slice(1), 10) || 0), 0) + 1;
      const task = { id: 't' + n, title, status: STATUSES.includes(status) ? status : 'todo', created: today(), confirmed: today(),
        ...(goal ? { goal } : {}), ...(owner ? { owner } : {}), ...(note ? { note } : {}), ...(by ? { by } : {}), ...(parent ? { parent } : {}), ...(split ? { split: true } : {}) };
      t.push(task); saveTasks(t); return task;
    }
    const task = t.find((x) => x.id === id);
    if (!task) throw new Error(`no task ${id}`);
    // task worktree <id> [repo] (t769): the only way a worktree is made. ~/wt/<repo>-<id> on the task's branch, recorded on the task.
    if (op === 'worktree') {
      const goal = task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null;
      if (goal?.merge === 'open') throw new Error(`${goal.id} is an open goal: commit on main, no worktree`);
      const repos = goal?.repos || [], repo = repoArg || task.repo || (repos.length === 1 ? repos[0] : '');
      if (!repo) throw new Error(repos.length ? `say which repo: task worktree ${task.id} <${repos.join('|')}>` : `${task.id} has no repo: task worktree ${task.id} <repo>`);
      const name = path.basename(expand(repo)), at = path.join(WT, `${name}-${task.id}`), br = (task.repo && expand(task.repo) === expand(repo) && task.branch) || `${task.id}-${slug(task.title).slice(0, 30).replace(/-$/, '')}`;
      const have = worktreesOf(repo).find((w) => w.path === at || (w.branch === br && fs.existsSync(w.path)));
      if (!have) {
        fs.mkdirSync(WT, { recursive: true });
        git(repo, hasBranch(repo, br) ? ['worktree', 'add', '--quiet', at, br] : ['worktree', 'add', '--quiet', '-b', br, at, baseOf(repo)]);
        if (fs.existsSync(path.join(expand(repo), 'node_modules')) && fs.existsSync(path.join(at, 'package.json'))) fs.symlinkSync(path.join(expand(repo), 'node_modules'), path.join(at, 'node_modules'));
      }
      const p = have?.path || fs.realpathSync(at);
      task.repo = repo; task.branch = have?.branch || br; task.worktrees = [...new Set([...(task.worktrees || []), p])]; task.confirmed = today();
      saveTasks(t); return { ...task, path: p, created: !have };
    }
    if (op === 'accept' || op === 'decline') {
      if (task.kind !== 'suggestion') throw new Error(`${task.id} is not a suggestion`);
      if (task.decision) throw new Error(`${task.id} was already ${task.decision}`);
      if (op === 'accept') {
        const g = TIERS.flatMap((x) => goals()[x]).find((x) => x.id === goal); if (!g) throw new Error(`accept needs a goal: suggestion accept ${task.id} <goal> <owner>`);
        if (!owner) throw new Error(`accept needs an owner: suggestion accept ${task.id} ${goal} <owner>`);
        Object.assign(task, { goal, owner, decision: 'accepted', decidedBy: by || 'lead', decided: today(), confirmed: today() });
      } else {
        if (!String(why || '').trim()) throw new Error(`decline needs a reason: suggestion decline ${task.id} "<why>"`);
        Object.assign(task, { status: 'done', finished: today(), decision: 'declined', why: String(why).trim(), decidedBy: by || 'lead', decided: today() });
      }
      if (task.by) task.untold = true;
      saveTasks(t); return task;
    }
    if (op === 'split') {
      // One note becomes child notes that inherit its goal and owner; the parent stays as the umbrella.
      const list = (titles || []).map((x) => String(x).trim()).filter(Boolean);
      if (!list.length) throw new Error('split needs at least one subtask title');
      let n = t.reduce((m, x) => Math.max(m, parseInt(String(x.id).slice(1), 10) || 0), 0);
      const kids = list.map((title) => ({ id: 't' + ++n, title, status: 'todo', created: today(), confirmed: today(), parent: task.id,
        ...(task.goal ? { goal: task.goal } : {}), ...(task.owner ? { owner: task.owner } : {}), ...(by ? { by } : {}) }));
      t.push(...kids); delete task.split; task.confirmed = today();
      saveTasks(t); return { parent: task, subtasks: kids };
    }
    if (op === 'drop') { retire(task); t.splice(t.indexOf(task), 1); for (const k of t) if (k.parent === task.id) delete k.parent; }
    else if (op === 'move') {
      if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
      if (status === 'review') {
        const spec = branch || (task.repo ? `${task.repo}:${task.branch}` : task.branch);
        const goal = task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null;
        Object.assign(task, resolveBranch(spec, goal)); task.reviewed = today();
      } else if (branch) Object.assign(task, resolveBranch(branch, task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null));
      task.status = status; task.confirmed = today(); if (status === 'done') task.finished = today(); else delete task.finished;
      if (note !== undefined) task.note = note;
      if (status === 'done') retire(task);
    } else if (op === 'confirm') task.confirmed = today();
    // The user's steps around the Merge button, { t, done } each: needs before merging (t766: stacked tasks, deploy
    // order, syncs) and after merging (t1182: e.g. a one-time migration). A squiggle's own checks go on neither.
    else if (op === 'needs' || op === 'after') {
      const list = task[op] || [], i = Number(n) - 1, what = op === 'needs' ? 'need' : 'after-merge step';
      if (act === 'add') {
        const t = String(text || '').trim();
        if (!t) throw new Error(op === 'needs' ? 'needs add "<what the user must do before merging>"' : 'after add "<what the user must do after merging>"');
        if (op === 'needs' && /^after\b/i.test(t)) throw new Error(`that is after merging: task after ${task.id} add "<step>", only if the user must do it`);
        list.push({ t, done: false });
      }
      else if (act === 'done' || act === 'undo') { if (!list[i]) throw new Error(`no ${what} ${n} on ${task.id}`); list[i].done = act === 'done'; }
      else if (act === 'drop') { if (!list[i]) throw new Error(`no ${what} ${n} on ${task.id}`); list.splice(i, 1); }
      else if (act === 'clear') list.length = 0;
      else throw new Error(`${op} add|done|undo|drop|clear`);
      if (list.length) task[op] = list; else delete task[op];
    }
    else if (op === 'edit') {
      for (const [k, v] of Object.entries({ title, goal, owner, note })) if (v !== undefined) { if (v) task[k] = v; else delete task[k]; }
      if (branch !== undefined) { if (branch) Object.assign(task, resolveBranch(branch, task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null)); else { delete task.branch; delete task.repo; } }
      if (parent !== undefined) { if (parent && parent !== task.id) task.parent = parent; else delete task.parent; }
      if (split !== undefined) { if (split === true || split === 'true') task.split = true; else delete task.split; }
      task.confirmed = today();
    } else throw new Error(`unknown task op ${op}`);
    saveTasks(t); return task;
  }

  // A finished or dropped task takes its worktrees with it (t769): clean ones go, merged branches are deleted (-d). Dirty ones stay, and say so.
  function retire(task) {
    if (!task.repo || (!task.branch && !task.worktrees?.length)) return;
    try {
      if (task.branch === baseOf(task.repo)) return;
      const w = dropWorktrees(task.repo, task.branch, task.worktrees || []), gone = !w.kept.length && deleteMerged(task.repo, task.branch);
      task.worktrees = (task.worktrees || []).filter((p) => w.kept.includes(p)); if (!task.worktrees.length) delete task.worktrees;
      if (w.kept.length) task.note = `worktree with uncommitted work kept: ${w.kept.join(', ')}${task.note ? ` — ${task.note}` : ''}`;
      return { ...w, branchDeleted: gone };
    } catch {}
  }
  // Every extra worktree in the goals' repos, with the task that owns it (t769). No live task = orphan.
  function worktrees() {
    let wtReal = WT; try { wtReal = fs.realpathSync(WT); } catch {}
    const t = tasks(), seen = new Set(), out = [], rc = {}, realOf = (r) => r ? (rc[r] ??= (() => { try { return fs.realpathSync(expand(r)); } catch { return ''; } })()) : '';
    for (const repo of TIERS.flatMap((x) => goals()[x]).flatMap((g) => g.repos || [])) {
      let real; try { real = fs.realpathSync(expand(repo)); } catch { continue; } if (seen.has(real)) continue; seen.add(real);
      for (const w of worktreesOf(repo)) {
        if (/\/(merge-t\d+-|branch-d-)[^/]+$/.test(w.path)) continue; // the Merge tab's own temp worktrees, gone in a moment
        const task = t.find((x) => x.status !== 'done' && ((x.worktrees || []).includes(w.path) || (w.branch && x.branch === w.branch && realOf(x.repo) === real))) || null;
        let dirty = 0; try { dirty = fs.existsSync(w.path) ? dirtyOf(w.path).length : 0; } catch {}
        out.push({ repo: real, path: w.path, branch: w.branch, head: w.head, dirty, missing: !fs.existsSync(w.path), home: w.path.startsWith(wtReal + '/'),
          task: task?.id || '', status: task?.status || '', owner: task?.owner || '', title: task?.title || '', orphan: !task });
      }
    }
    return out;
  }
  // The lead keeps one note listing orphan worktrees (t769): refreshed when the list changes, done when there are none.
  function orphanNotes() {
    const t = tasks(), list = worktrees().filter((x) => x.orphan), cur = t.find((x) => x.status !== 'done' && x.owner === 'lead' && String(x.title).startsWith('Orphan worktrees'));
    const note = list.map((w) => `${w.path} (${path.basename(w.repo)}${w.branch ? ` ${w.branch}` : ' detached'}${w.dirty ? `, ${w.dirty} uncommitted` : ''})`).join('; ');
    if (!list.length) return cur ? taskOp({ op: 'move', id: cur.id, status: 'done', note: 'no orphan worktrees left' }) : null;
    const title = `Orphan worktrees: ${list.length} with no live task. Find each owner (task edit <id> branch repo:branch) or remove it if clean and merged. See: worktrees`;
    if (cur) return cur.note === note ? cur : taskOp({ op: 'edit', id: cur.id, title, note });
    // Filed under the goal that holds the first orphan's repo; no goal if none does.
    const goal = TIERS.flatMap((x) => goals()[x]).find((g) => (g.repos || []).some((r) => (() => { try { return fs.realpathSync(expand(r)); } catch { return ''; } })() === list[0].repo));
    return taskOp({ op: 'add', title, goal: goal?.id, owner: 'lead', by: 'harness', note });
  }

  // ---------- merge queue: review tasks of gated goals ----------
  const goalOf = (id) => (id ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === id) : null);
  // One repo's side of a review branch: base, ahead/behind, conflicts, log, links.
  async function repoInfo(repo, branch, q) {
    const r = { repo, branch };
    try {
      if (!(await okA(gitA(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])))) throw new Error(`branch ${branch} is gone from ${repo}`);
      const base = await q(`base ${repo}`, () => baseOfA(repo));
      r.base = base; r.head = await q(`head ${repo}`, () => gitA(repo, ['rev-parse', '--abbrev-ref', 'HEAD']));
      r.ahead = Number(await gitA(repo, ['rev-list', '--count', `${base}..${branch}`]));
      r.behind = Number(await gitA(repo, ['rev-list', '--count', `${branch}..${base}`]));
      r.conflicts = r.ahead && r.behind ? await conflictsA(repo, base, branch) : [];
      r.dirty = await q(`dirty ${repo}`, async () => (await gitA(repo, ['status', '--porcelain'])).split('\n').filter(Boolean).length);
      r.log = (await gitA(repo, ['log', '--format=%h %s', `${base}..${branch}`])).split('\n').filter(Boolean);
      // Links, never a push: GitHub Desktop opens any local branch; the compare page only when origin already has it (as of the last fetch).
      const gh = githubOf(repo);
      if (gh) {
        r.desktop = `x-github-client://openRepo/${gh}?branch=${encodeURIComponent(branch)}`;
        const onRemote = await okA(gitA(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]));
        if (onRemote) r.compare = `${gh}/compare/${base.replace(/^origin\//, '')}...${branch.split('/').map(encodeURIComponent).join('/')}`;
      }
    } catch (e) { r.error = String(e.message || e).split('\n')[0]; }
    return r;
  }
  // The goal's other repos carrying the same branch with commits to merge (t1197): one task, several repos.
  async function otherRepos(task, q) {
    const real = (p) => { try { return fs.realpathSync(expand(p)); } catch { return expand(p); } };
    const mine = real(task.repo), out = [];
    for (const repo of goalOf(task.goal)?.repos || []) {
      if (real(repo) === mine || !(await okA(gitA(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${task.branch}`])))) continue;
      const o = await repoInfo(repo, task.branch, q);
      if (o.error || o.ahead > 0) out.push(o);
    }
    return out;
  }
  async function mergeInfo(task, q) {
    const goal = goalOf(task.goal), reviewed = task.reviewed || task.confirmed, age = daysSince(reviewed);
    const r = { id: task.id, title: task.title, goal: task.goal, goalTitle: goal?.title || '', owner: task.owner || '', repo: task.repo || '', branch: task.branch || '',
      result: task.note || '', needs: task.needs || [], after: task.after || [], reviewed, age, stale: age >= 7 };
    if (!task.branch) return { ...r, error: 'no branch on the task' };
    if (!task.repo) return { ...r, error: 'no repo on the task: set it with task edit <id> branch repo:branch' };
    const { repo: _r, branch: _b, ...one } = await repoInfo(task.repo, task.branch, q);
    Object.assign(r, one);
    if (r.error) return r;
    const others = await otherRepos(task, q);
    if (others.length) {
      r.others = others;
      const bad = others.find((o) => o.error);
      if (bad) r.error = `${path.basename(expand(bad.repo))}: ${bad.error}`;
      r.conflicts = [...r.conflicts, ...others.flatMap((o) => (o.conflicts || []).map((f) => `${path.basename(expand(o.repo))}: ${f}`))];
      const off = others.find((o) => o.head !== o.base && o.head === o.branch);
      if (off && !r.error) r.error = `${path.basename(expand(off.repo))} has ${off.branch} checked out: switch it away first`;
    }
    return r;
  }
  const inQueue = () => tasks().filter((t) => t.status === 'review' && (goalOf(t.goal)?.merge || 'gated') === 'gated');
  // Why a review branch no longer needs the Merge tab, or '' if it still does. Never touches the branch.
  async function mergedOutside(task, q) {
    if (!task.repo || !task.branch || !fs.existsSync(expand(task.repo))) return '';
    try {
      if (!(await okA(gitA(task.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${task.branch}`])))) return 'branch gone';
      const base = await q(`base ${task.repo}`, () => baseOfA(task.repo));
      // A branch nobody committed to sits on base too; only a moved branch can have been merged.
      const reflog = (await gitA(task.repo, ['reflog', 'show', '--format=%H', `refs/heads/${task.branch}`])).split('\n').filter(Boolean);
      if (reflog.length === 1) return '';
      for (const b of [base, `origin/${base}`]) {
        if (!(await q(`has ${task.repo} ${b}`, () => okA(gitA(task.repo, ['rev-parse', '--verify', '--quiet', b]))))) continue;
        if (await okA(gitA(task.repo, ['merge-base', '--is-ancestor', task.branch, b]))) return `merged outside into ${b}`;
        const cherry = (await gitA(task.repo, ['cherry', b, task.branch])).split('\n').filter(Boolean);
        if (cherry.length && cherry.every((l) => l.startsWith('-'))) return `merged outside into ${b} (same patches)`;
      }
    } catch {}
    return '';
  }
  // Close review tasks whose branch was merged (or deleted) outside the Merge tab.
  async function mergeSweep(q = memo()) {
    const closed = (await pool(inQueue(), 6, async (t) => ({ id: t.id, why: await mergedOutside(t, q) }))).filter((x) => x.why);
    if (!closed.length) return closed;
    const t = tasks();
    for (const c of closed) {
      const x = t.find((k) => k.id === c.id);
      if (x?.status !== 'review') { c.why = ''; continue; } // moved while git ran
      const w = dropWorktrees(x.repo, x.branch, x.worktrees || []);
      x.worktrees = (x.worktrees || []).filter((p) => w.kept.includes(p)); if (!x.worktrees.length) delete x.worktrees;
      if (w.removed.length) c.worktrees = w.removed;
      const why = c.why + (w.kept.length ? `; worktree with uncommitted work kept: ${w.kept.join(', ')}` : '');
      x.status = 'done'; x.finished = today(); x.confirmed = today(); x.note = `${why}${x.note ? ` — ${x.note}` : ''}`;
    }
    saveTasks(t); return closed.filter((c) => c.why);
  }
  // Concurrent callers share one listing; git runs off the event loop, 6 branches at a time.
  let listing = null;
  const merges = () => listing ||= (async () => { const q = memo(); await mergeSweep(q); return conflictSweep(await pool(inQueue(), 6, (t) => mergeInfo(t, q))); })().finally(() => { listing = null; });
  // Auto send-back (t1189): a review branch that conflicts with its base goes back to doing with the files, and onConflict
  // tells the owner. Once per conflict: the same branch and base commits stay in review if resubmitted unchanged.
  async function conflictSweep(list) {
    if (!onConflict) return list;
    const sent = [];
    for (const r of list) {
      if (r.error || !r.conflicts?.length) continue;
      let key; try { key = `${await gitA(r.repo, ['rev-parse', r.branch])} ${await gitA(r.repo, ['rev-parse', r.base])}`; } catch { continue; }
      const t = tasks(), x = t.find((k) => k.id === r.id);
      if (x?.status !== 'review' || x.conflictSent === key) continue;
      x.conflictSent = key; saveTasks(t);
      const note = `conflicts with ${r.base}: ${r.conflicts.join(', ')}. Merge ${r.base} into ${r.branch}, fix, test, move back to review`;
      taskOp({ op: 'move', id: r.id, status: 'doing', note: `sent back by the harness: ${note}` });
      sent.push(r.id); try { onConflict({ id: r.id, owner: r.owner, title: r.title, note }); } catch {}
    }
    return list.filter((r) => !sent.includes(r.id));
  }
  function mergeTask(id) {
    const t = tasks().find((x) => x.id === id);
    if (!t) throw new Error(`no task ${id}`);
    if (t.status !== 'review') throw new Error(`${id} is ${t.status}, not in review`);
    return t;
  }
  async function mergeDiff(id) {
    const r = await mergeInfo(mergeTask(id), memo());
    if (r.error) throw new Error(r.error);
    return { ...r, stat: git(r.repo, ['diff', '--stat', `${r.base}...${r.branch}`]), diff: git(r.repo, ['diff', `${r.base}...${r.branch}`]) };
  }
  // Merge into the base branch without touching the user's checkout. Where the base is checked out (their checkout or a
  // worktree), merge there, but only after git merge-tree proves it conflict-free, so nothing is ever aborted over their
  // uncommitted work; git itself refuses if a dirty file would be overwritten. Otherwise merge in a temp worktree on the base.
  // Fast-forward when possible, a merge commit otherwise. A conflict is reported: send it back.
  // by: who merged or sent back (t142), a human id from the page or a squiggle id from the CLI.
  async function merge(id, by) {
    const task = mergeTask(id), r = await mergeInfo(task, memo());
    mergeTask(id); // sent back while git ran
    if (r.error) throw new Error(r.error);
    if (r.conflicts?.length) throw new Error(`conflicts merging ${r.branch} into ${r.base}: ${r.conflicts.join(', ')}: send it back`);
    // Every repo was checked above before any merges (t1197). If a later one still fails, the task stays in review and says which went in.
    const sides = [{ ...r, worktrees: task.worktrees || [] }, ...(r.others || []).map((o) => ({ ...o, worktrees: task.worktrees || [] }))];
    const done = [], removed = [], kept = [];
    for (const side of sides) {
      try { const m = mergeRepo(id, side); done.push({ repo: side.repo, base: side.base, sha: m.sha }); removed.push(...m.removed); kept.push(...m.kept); }
      catch (e) {
        if (!done.length) throw e;
        const t = tasks(), x = t.find((k) => k.id === id), name = (p) => path.basename(expand(p));
        x.note = `partly merged: ${done.map((d) => `${name(d.repo)} ${d.base}@${d.sha}`).join(', ')}; ${name(side.repo)} failed: ${e.message}${x.note ? ` — ${x.note}` : ''}`;
        if (x.repo !== side.repo) x.repo = side.repo; // what's left to merge
        saveTasks(t); throw new Error(`${done.map((d) => name(d.repo)).join(', ')} merged; ${name(side.repo)} failed: ${e.message}`);
      }
    }
    const t = tasks(), x = t.find((k) => k.id === id), main = done[0];
    const where = done.length > 1 ? done.map((d) => `${path.basename(expand(d.repo))} ${d.base}@${d.sha}`).join(', ') : `${main.base} at ${main.sha}`;
    x.status = 'done'; x.finished = today(); x.confirmed = today(); x.merged = done.map((d) => `${d.base}@${d.sha}`).join(' '); if (by) x.mergedBy = by;
    x.worktrees = (x.worktrees || []).filter((p) => kept.includes(p)); if (!x.worktrees.length) delete x.worktrees;
    const k = kept.length ? `; branch kept, worktree with uncommitted work: ${kept.join(', ')}` : '';
    x.note = `merged into ${where}${by ? ` by ${by}` : ''}${k}${x.note ? ` — ${x.note}` : ''}`;
    saveTasks(t); return { ...r, sha: main.sha, merged: done, task: x, worktrees: removed };
  }
  // Merge one repo's side of a review branch into its base; returns { sha, removed, kept } worktrees.
  function mergeRepo(id, r) {
    if (r.head === r.branch) throw new Error(`${r.repo} has ${r.branch} checked out: switch it away first`);
    const wts = git(r.repo, ['worktree', 'list', '--porcelain']).split(/\n\n+/);
    const onBase = wts.find((b) => b.match(/^branch (.+)$/m)?.[1] === `refs/heads/${r.base}`)?.match(/^worktree (.+)$/m)?.[1];
    let sha, tmp, w;
    try {
      if (r.ahead > 0) {
        try { git(r.repo, ['merge-tree', '--write-tree', r.base, r.branch]); }
        catch (e) { throw new Error(/conflict/i.test(String(e.stdout || '') + String(e.stderr || '')) ? `conflicts merging ${r.branch} into ${r.base}: send it back` : String(e.stderr || e.message).trim().split('\n').pop()); }
        let at = onBase;
        if (!at) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), `merge-${id}-`)); fs.rmdirSync(tmp); git(r.repo, ['worktree', 'add', '--quiet', tmp, r.base]); at = tmp; }
        try { git(at, ['merge', '--no-edit', r.branch]); }
        catch (e) {
          const out = (String(e.stdout || '') + String(e.stderr || '')).trim();
          throw new Error(/commit your changes or stash/i.test(out) ? `${r.base} is checked out at ${at} with uncommitted changes the merge would overwrite: commit or stash them, then merge again` : out.split('\n').filter(Boolean).slice(-3).join(' ') || 'merge failed');
        }
      }
      sha = git(r.repo, ['rev-parse', '--short', r.base]);
      // A branch checked out in a worktree can't be deleted: remove clean worktrees first; a dirty one keeps the branch.
      // branch -d checks against HEAD, so run it where the base is checked out (the user's HEAD may be elsewhere).
      w = dropWorktrees(r.repo, r.branch, r.worktrees || []);
      if (!w.kept.length) {
        let at = onBase || tmp;
        if (!at) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), `merge-${id}-`)); fs.rmdirSync(tmp); git(r.repo, ['worktree', 'add', '--quiet', '--detach', tmp, r.base]); at = tmp; }
        git(at, ['branch', '-d', r.branch]);
      }
    } finally { if (tmp) { try { git(r.repo, ['worktree', 'remove', tmp]); } catch {} try { git(r.repo, ['worktree', 'prune']); } catch {} } }
    return { sha, removed: w.removed, kept: w.kept };
  }
  // The author hears what became of their suggestions at their next wake, once (t825).
  function suggestionNews(id) {
    const t = tasks(), mine = t.filter((x) => x.kind === 'suggestion' && x.by === id && x.untold); if (!mine.length) return [];
    for (const x of mine) delete x.untold; saveTasks(t);
    return mine.map((x) => x.decision === 'accepted' ? `${x.id} "${x.title}" accepted, on ${x.goal} for ${x.owner}` : `${x.id} "${x.title}" declined: ${x.why}`);
  }
  function mergeBack(id, note, by) {
    mergeTask(id); if (!String(note || '').trim()) throw new Error('send back needs a note saying what to fix');
    return taskOp({ op: 'move', id, status: 'doing', note: `sent back${by ? ` by ${by}` : ''}: ${String(note).trim()}` });
  }

  return { goals, tasks, goalOp, taskOp, suggestionNews, merges, mergeSweep, mergeDiff, merge, mergeBack, worktrees, orphanNotes, TIERS, STATUSES, MERGE };
}
