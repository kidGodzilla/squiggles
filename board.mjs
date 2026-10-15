// Goals (the whiteboard) and tasks (the sticky notes). Plain JSON files that James, the lead and squiggles all edit.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const today = () => new Date().toISOString().slice(0, 10);
const TIERS = ['active', 'hold', 'todo', 'done'];
const STATUSES = ['todo', 'doing', 'review', 'blocked', 'done'];
// Merge policy per goal. gated: a branch per task, merged from the Merge tab. open: commit to main. Missing means gated.
const MERGE = ['gated', 'open'];
const expand = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
const hasBranch = (repo, branch) => { try { execFileSync('git', ['-C', expand(repo), 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { stdio: 'pipe' }); return true; } catch { return false; } };
// A review task names a branch. "repo:branch" pins the repo; a bare branch is looked up in the goal's repos and must be in exactly one.
function resolveBranch(spec, goal) {
  const m = /^(.*?):([^:]+)$/.exec(String(spec || '').trim());
  let repo = m ? m[1] : '', branch = (m ? m[2] : String(spec || '')).trim();
  if (!branch) throw new Error('review needs a branch: task move <id> review [repo:]<branch> ["<test result>"]');
  const repos = goal?.repos || [];
  if (repo) { if (!hasBranch(repo, branch)) throw new Error(`no branch ${branch} in ${repo}`); return { repo, branch }; }
  if (!repos.length) return { branch };
  const found = repos.filter((r) => hasBranch(r, branch));
  if (found.length === 1) return { repo: found[0], branch };
  if (found.length > 1) throw new Error(`branch ${branch} exists in ${found.join(' and ')}: say which with repo:branch`);
  throw new Error(`branch ${branch} not found in ${repos.join(' ')}: commit on it first, or give repo:branch`);
}
// https://github.com/o/r for a repo whose origin is on GitHub (ssh, scp-style or https), else ''.
function githubOf(repo) {
  let u = ''; try { u = git(repo, ['remote', 'get-url', 'origin']); } catch { return ''; }
  const m = u.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : '';
}
const git = (repo, args, opts = {}) => execFileSync('git', ['-C', expand(repo), ...args], { stdio: 'pipe', encoding: 'utf8', maxBuffer: 32 << 20, env: { ...process.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' }, ...opts }).trim();
// The branch a gated repo merges into: origin's default branch, else main, else master.
function baseOf(repo) {
  try { return git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, ''); } catch {}
  for (const b of ['main', 'master']) if (hasBranch(repo, b)) return b;
  throw new Error(`no main or master branch in ${repo}`);
}
const daysSince = (d) => (d ? Math.floor((Date.now() - Date.parse(d + 'T12:00:00')) / 864e5) : 0);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Worktrees that have a branch checked out (t292): clean ones are removed (never --force), dirty or locked ones kept; then prune.
export function dropWorktrees(repo, branch) {
  const out = { removed: [], kept: [] };
  let list; try { list = git(repo, ['worktree', 'list', '--porcelain']); } catch { return out; }
  const blocks = list.split(/\n\n+/), main = blocks[0].match(/^worktree (.+)$/m)?.[1];
  for (const b of blocks) {
    const p = b.match(/^worktree (.+)$/m)?.[1];
    if (!p || p === main || b.match(/^branch (.+)$/m)?.[1] !== `refs/heads/${branch}`) continue;
    try { git(repo, ['worktree', 'remove', p]); out.removed.push(p); } catch { out.kept.push(p); }
  }
  try { git(repo, ['worktree', 'prune']); } catch {}
  return out;
}
export function createBoard(root, onChange) {
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
    fs.watch(f, () => { clearTimeout(timer); timer = setTimeout(onChange, 120); });
  }

  function findGoal(g, id) {
    for (const t of TIERS) { const i = g[t].findIndex((x) => x.id === id); if (i >= 0) return { tier: t, i, goal: g[t][i] }; }
    throw new Error(`no goal ${id}`);
  }
  function goalOp({ op, id, title, tier, owner, note, index, repos, merge }) {
    const g = goals();
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
      if (title != null) f.goal.title = title;
      if (owner !== undefined) { if (owner) f.goal.owner = owner; else delete f.goal.owner; }
      if (note !== undefined) { if (note) f.goal.note = note; else delete f.goal.note; }
      if (repos !== undefined) { const r = (Array.isArray(repos) ? repos : String(repos).split(/[\s,]+/)).filter(Boolean); if (r.length) f.goal.repos = r; else delete f.goal.repos; }
      if (merge !== undefined) f.goal.merge = merge;
    } else throw new Error(`unknown goal op ${op}`);
    saveGoals(g); return f.goal;
  }

  function taskOp({ op, id, title, goal, owner, status, note, by, parent, split, titles, branch }) {
    const t = tasks();
    if (op === 'add') {
      if (!title) throw new Error('a task needs a title');
      const n = t.reduce((m, x) => Math.max(m, parseInt(String(x.id).slice(1), 10) || 0), 0) + 1;
      const task = { id: 't' + n, title, status: STATUSES.includes(status) ? status : 'todo', created: today(), confirmed: today(),
        ...(goal ? { goal } : {}), ...(owner ? { owner } : {}), ...(note ? { note } : {}), ...(by ? { by } : {}), ...(parent ? { parent } : {}), ...(split ? { split: true } : {}) };
      t.push(task); saveTasks(t); return task;
    }
    const task = t.find((x) => x.id === id);
    if (!task) throw new Error(`no task ${id}`);
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
    if (op === 'drop') { t.splice(t.indexOf(task), 1); for (const k of t) if (k.parent === task.id) delete k.parent; }
    else if (op === 'move') {
      if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`);
      if (status === 'review') {
        const spec = branch || (task.repo ? `${task.repo}:${task.branch}` : task.branch);
        const goal = task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null;
        Object.assign(task, resolveBranch(spec, goal)); task.reviewed = today();
      } else if (branch) Object.assign(task, resolveBranch(branch, task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null));
      task.status = status; task.confirmed = today(); if (status === 'done') task.finished = today(); else delete task.finished;
      if (note !== undefined) task.note = note;
    } else if (op === 'confirm') task.confirmed = today();
    else if (op === 'edit') {
      for (const [k, v] of Object.entries({ title, goal, owner, note })) if (v !== undefined) { if (v) task[k] = v; else delete task[k]; }
      if (branch !== undefined) { if (branch) Object.assign(task, resolveBranch(branch, task.goal ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === task.goal) : null)); else { delete task.branch; delete task.repo; } }
      if (parent !== undefined) { if (parent && parent !== task.id) task.parent = parent; else delete task.parent; }
      if (split !== undefined) { if (split === true || split === 'true') task.split = true; else delete task.split; }
      task.confirmed = today();
    } else throw new Error(`unknown task op ${op}`);
    saveTasks(t); return task;
  }

  // ---------- merge queue: review tasks of gated goals ----------
  const goalOf = (id) => (id ? TIERS.flatMap((x) => goals()[x]).find((g) => g.id === id) : null);
  function mergeInfo(task) {
    const goal = goalOf(task.goal), reviewed = task.reviewed || task.confirmed, age = daysSince(reviewed);
    const r = { id: task.id, title: task.title, goal: task.goal, goalTitle: goal?.title || '', owner: task.owner || '', repo: task.repo || '', branch: task.branch || '',
      result: task.note || '', reviewed, age, stale: age >= 7 };
    if (!task.branch) return { ...r, error: 'no branch on the task' };
    if (!task.repo) return { ...r, error: 'no repo on the task: set it with task edit <id> branch repo:branch' };
    try {
      if (!hasBranch(task.repo, task.branch)) throw new Error(`branch ${task.branch} is gone from ${task.repo}`);
      const base = baseOf(task.repo);
      r.base = base; r.head = git(task.repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
      r.ahead = Number(git(task.repo, ['rev-list', '--count', `${base}..${task.branch}`]));
      r.behind = Number(git(task.repo, ['rev-list', '--count', `${task.branch}..${base}`]));
      r.dirty = git(task.repo, ['status', '--porcelain']).split('\n').filter(Boolean).length;
      r.log = git(task.repo, ['log', '--format=%h %s', `${base}..${task.branch}`]).split('\n').filter(Boolean);
      // Links, never a push: GitHub Desktop opens any local branch; the compare page only when origin already has it (as of the last fetch).
      const gh = githubOf(task.repo);
      if (gh) {
        r.desktop = `x-github-client://openRepo/${gh}?branch=${encodeURIComponent(task.branch)}`;
        let onRemote = false; try { git(task.repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${task.branch}`]); onRemote = true; } catch {}
        if (onRemote) r.compare = `${gh}/compare/${base.replace(/^origin\//, '')}...${task.branch.split('/').map(encodeURIComponent).join('/')}`;
      }
    } catch (e) { r.error = String(e.message || e).split('\n')[0]; }
    return r;
  }
  const inQueue = () => tasks().filter((t) => t.status === 'review' && (goalOf(t.goal)?.merge || 'gated') === 'gated');
  // Why a review branch no longer needs the Merge tab, or '' if it still does. Never touches the branch.
  function mergedOutside(task) {
    if (!task.repo || !task.branch || !fs.existsSync(expand(task.repo))) return '';
    try {
      if (!hasBranch(task.repo, task.branch)) return 'branch gone';
      const base = baseOf(task.repo);
      // A branch nobody committed to sits on base too; only a moved branch can have been merged.
      const reflog = git(task.repo, ['reflog', 'show', '--format=%H', `refs/heads/${task.branch}`]).split('\n').filter(Boolean);
      if (reflog.length === 1) return '';
      for (const b of [base, `origin/${base}`]) {
        try { git(task.repo, ['rev-parse', '--verify', '--quiet', b]); } catch { continue; }
        try { git(task.repo, ['merge-base', '--is-ancestor', task.branch, b]); return `merged outside into ${b}`; } catch {}
        const cherry = git(task.repo, ['cherry', b, task.branch]).split('\n').filter(Boolean);
        if (cherry.length && cherry.every((l) => l.startsWith('-'))) return `merged outside into ${b} (same patches)`;
      }
    } catch {}
    return '';
  }
  // Close review tasks whose branch was merged (or deleted) outside the Merge tab.
  function mergeSweep() {
    const closed = inQueue().map((t) => ({ id: t.id, why: mergedOutside(t) })).filter((x) => x.why);
    if (!closed.length) return closed;
    const t = tasks();
    for (const c of closed) {
      const x = t.find((k) => k.id === c.id), w = dropWorktrees(x.repo, x.branch);
      if (w.removed.length) c.worktrees = w.removed;
      const why = c.why + (w.kept.length ? `; worktree with uncommitted work kept: ${w.kept.join(', ')}` : '');
      x.status = 'done'; x.finished = today(); x.confirmed = today(); x.note = `${why}${x.note ? ` — ${x.note}` : ''}`;
    }
    saveTasks(t); return closed;
  }
  const merges = () => { mergeSweep(); return inQueue().map(mergeInfo); };
  function mergeTask(id) {
    const t = tasks().find((x) => x.id === id);
    if (!t) throw new Error(`no task ${id}`);
    if (t.status !== 'review') throw new Error(`${id} is ${t.status}, not in review`);
    return t;
  }
  function mergeDiff(id) {
    const r = mergeInfo(mergeTask(id));
    if (r.error) throw new Error(r.error);
    return { ...r, stat: git(r.repo, ['diff', '--stat', `${r.base}...${r.branch}`]), diff: git(r.repo, ['diff', `${r.base}...${r.branch}`]) };
  }
  // Merge into the base branch in the repo as it stands (James's checkout). Fast-forward when possible, a merge commit otherwise.
  // Refuses rather than switching branches or touching uncommitted work; a conflict is aborted and reported.
  function merge(id) {
    const task = mergeTask(id), r = mergeInfo(task);
    if (r.error) throw new Error(r.error);
    if (r.head !== r.base) throw new Error(`${r.repo} is on ${r.head}: check out ${r.base} first`);
    let sha;
    if (r.ahead === 0) sha = git(r.repo, ['rev-parse', '--short', r.base]);
    else {
      try { git(r.repo, ['merge', '--no-edit', r.branch]); }
      catch (e) {
        const out = String(e.stdout || '') + String(e.stderr || '');
        try { git(r.repo, ['merge', '--abort']); } catch {}
        throw new Error(/conflict/i.test(out) ? `conflicts merging ${r.branch} into ${r.base}: send it back` : out.trim().split('\n').pop() || 'merge failed');
      }
      sha = git(r.repo, ['rev-parse', '--short', r.base]);
    }
    // A branch checked out in a worktree can't be deleted: remove clean worktrees first; a dirty one keeps the branch.
    const w = dropWorktrees(r.repo, r.branch);
    const kept = w.kept.length ? `; branch kept, worktree with uncommitted work: ${w.kept.join(', ')}` : '';
    if (!w.kept.length) git(r.repo, ['branch', '-d', r.branch]);
    const t = tasks(), x = t.find((k) => k.id === id);
    x.status = 'done'; x.finished = today(); x.confirmed = today(); x.merged = `${r.base}@${sha}`;
    x.note = `merged into ${r.base} at ${sha}${kept}${x.note ? ` — ${x.note}` : ''}`;
    saveTasks(t); return { ...r, sha, task: x, worktrees: w.removed };
  }
  function mergeBack(id, note) {
    mergeTask(id); if (!String(note || '').trim()) throw new Error('send back needs a note saying what to fix');
    return taskOp({ op: 'move', id, status: 'doing', note: `sent back: ${String(note).trim()}` });
  }

  return { goals, tasks, goalOp, taskOp, merges, mergeSweep, mergeDiff, merge, mergeBack, TIERS, STATUSES, MERGE };
}
