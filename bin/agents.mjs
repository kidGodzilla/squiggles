#!/usr/bin/env node
// Harness CLI, used by the lead (and by you from a terminal).
import { loadConfig } from '../config.mjs';
import { callWithUnlock } from './unlock.mjs';
const base = `http://127.0.0.1:${loadConfig().port}/api`;
const steps = (l, w) => (l || []).map((x, i) => `\n    ${w} ${i + 1} (${x.who || 'untagged'}${x.done ? ', done' : x.who && x.who !== 'owner' ? ', waiting' : ''}): ${x.t}`).join('');
// Merged tasks whose after-merge steps aren't all ticked, each with its owner.
const afterMerge = async () => {
  const t = (await call('/board')).tasks.filter((x) => x.status === 'done' && x.after?.some((n) => !n.done));
  return t.length ? 'After merging:\n' + t.map((x) => `${x.id}  ${x.title}${x.owner ? `  @${x.owner}` : ''}${steps(x.after, 'after')}`).join('\n') : '';
};
const [cmd, ...a] = process.argv.slice(2);

// Your terminal unlocks squiggle settings, charters, hiring and deleting shared files; merges stay browser-only.
const UNLOCKS = /^\/(squiggles(\/[^/]+\/update)?|files)$/;
const call = (path, body) => callWithUnlock(base, path, body, process.stdin.isTTY && UNLOCKS.test(path) && (() => askCode('this change')));

// The room passcode, typed at a terminal and not echoed (t950). Squiggles have no terminal, so they can't answer it.
async function askCode(what) {
  if (!process.stdin.isTTY) throw new Error(`${what} needs the room passcode: run it from your terminal`);
  process.stderr.write(`Room passcode for ${what}: `);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((ok, no) => { let v = ''; const on = (c) => { for (const ch of c) {
    if (ch === '\r' || ch === '\n') { done(); return ok(v); }
    if (ch === '\u0003') { done(); return no(new Error('cancelled')); }
    v = ch === '\u007f' ? v.slice(0, -1) : v + ch;
  } }; const done = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stderr.write('\n'); }; process.stdin.on('data', on); });
}
const codeIfSet = async (what) => ((await call('/passcode')).set ? askCode(what) : undefined);

function brief(e) {
  if (e.k === 'say') return e.text;
  if (e.k === 'tool') return `[${e.name}] ${e.text || e.file || e.arg || ''}`.slice(0, 220);
  if (e.k === 'out' && e.err) return `[error] ${e.text.slice(0, 200)}`;
  if (e.k === 'user') return `[${e.from}] ${e.text}`;
  if (e.k === 'end') return `[${e.status}] ${e.note || ''}`;
  return '';
}

const cmds = {
  list: async () => (await call('/squiggles')).map((s) =>
    `${s.id}${s.lead ? ' (lead)' : ''}  ${s.paused ? 'paused' : s.status === 'done' && s.proactive?.length ? `proactive (${s.proactive.join(', ')}, its own idea)` : s.status}  every ${s.every || 0}m${!s.lead && s.trust && s.trust !== 'medium' ? `  trust ${s.trust}` : ''}  ${s.name}, ${s.role}${s.note ? `  — ${s.note}` : ''}${Object.keys(s.subs || {}).length ? `  · subagents: ${Object.values(s.subs).map((x) => x.desc || x.type).join(', ')}` : ''}`).join('\n'),
  // team: the roster, with what each squiggle cares about and guards, its goals and how it runs (the Team tab)
  team: async () => {
    const [sq, b] = await Promise.all([call('/squiggles'), call('/board')]);
    const goals = Object.entries(b.goals).filter(([t]) => t !== 'done').flatMap(([, g]) => g);
    const line = (c, l) => (String(c || '').match(new RegExp(l + ':\\s*([^\\n]+)', 'i')) || [])[1];
    const every = (m) => (!m ? 'only when asked' : m % 60 ? `every ${m}m` : `every ${m / 60}h`);
    return sq.map((s) => [`${s.id}  ${s.name}, ${s.role}${s.lead ? ' (lead)' : ''}  ${s.paused ? 'paused' : s.status}${s.note ? `  — ${s.note}` : ''}`,
      line(s.charter, 'What you care about') && `  cares about: ${line(s.charter, 'What you care about')}`,
      line(s.charter, 'What you guard') && `  guards: ${line(s.charter, 'What you guard')}`,
      `  goals: ${goals.filter((g) => g.owner === s.id).map((g) => g.title).join('; ') || 'none'}`,
      `  runs ${every(s.every)}, ${({ sonnet: 'Sonnet 5.5', 'gpt-6.1-sol': 'Codex 6.1 Sol' })[s.model] || 'Opus 5.5'}, ${s.permissionMode || 'auto'}, in ${s.cwd}`].filter(Boolean).join('\n')).join('\n\n');
  },
  wake: () => call(`/squiggles/${a[0]}/wake`, { why: a[1] || 'lead' }),
  // tell <id> "<text>" [--image <path>]: the image goes to the squiggle as an image block and shows in its chat (t169).
  tell: async () => {
    const i = a.indexOf('--image'), img = i >= 0 ? a.splice(i, 2)[1] : '';
    if (!img) return call(`/squiggles/${a[0]}/send`, { text: a[1], from: 'lead' });
    const { readFileSync } = await import('node:fs'), { resolve, extname } = await import('node:path');
    const type = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.gif': 'gif', '.webp': 'webp' }[extname(img).toLowerCase()];
    if (!type) throw new Error('--image must be png, jpg, gif or webp');
    return call(`/squiggles/${a[0]}/send`, { text: a[1] || '', from: 'lead', images: [`data:image/${type};base64,${readFileSync(resolve(img)).toString('base64')}`] });
  },
  stop: () => call(`/squiggles/${a[0]}/stop`, {}),
  clear: () => call(`/squiggles/${a[0]}/clear`, {}),
  tail: async () => (await call(`/squiggles/${a[0]}/events?n=${a[1] || 60}`)).map(brief).filter(Boolean).join('\n'),
  journal: () => call(`/squiggles/${a[0]}/journal`),
  charter: async () => a[1] == null
    ? (await call('/squiggles')).find((s) => s.id === a[0])?.charter ?? `no squiggle ${a[0]}`
    : (await call(`/squiggles/${a[0]}/update`, { charter: a[1] }), `${a[0]}'s responsibility updated`),
  // load [days]: the user's actions per day and what shipped.
  // notes <query>: search journals, charters, research/, files/, fileSources and docs/. Local: no server needed.
  notes: async () => { const { searchNotes, describeNotes, notesRoots } = await import('../notes.mjs'), { dataDir } = await import('../config.mjs'), os = await import('node:os'), path = await import('node:path'); const extra = Object.values(loadConfig().fileSources || {}).map((v) => path.resolve(String(v).replace(/^~(?=\/|$)/, os.homedir()))); return describeNotes(searchNotes(a.join(' '), { roots: notesRoots(dataDir(), extra) })); },
  load: async () => { const { describe } = await import('../load.mjs'); return (await call(`/load?days=${+a[0] || 7}`)).map((r) => `${r.date}  ${describe(r)}`).join('\n'); },
  cost: async () => { const { describeCost } = await import('../cost.mjs'); const n = +a[0] || 1, rows = await call(`/cost?days=${n}`); return rows.length ? rows.map((r) => `${r.id.padEnd(10)} ${describeCost(r)}`).join('\n') : `no turns in ${n} day${n > 1 ? 's' : ''}`; },
  goals: async () => {
    const g = (await call('/board')).goals;
    const line = (x) => `  ${x.id}  ${x.title}${x.owner ? `  (owner ${x.owner})` : ''}${x.repos ? `  repos ${x.repos.join(' ')}` : ''}  merge ${x.merge}${x.due ? `  due ${x.due}` : ''}  confirmed ${x.last_confirmed}${x.note ? `  — ${x.note}` : ''}`;
    const all = ['active', 'hold', 'todo', 'done'].flatMap((t) => g[t] || []), areas = all.filter((x) => x.kind === 'area');
    return ['active', 'hold', 'todo', 'done'].map((t) => `${t.toUpperCase()}\n` + (g[t] || []).filter((x) => x.kind !== 'area').map(line).join('\n'))
      .concat(areas.length ? [`AREAS (ongoing, no finish line)\n${areas.map(line).join('\n')}`] : []).join('\n');
  },
  // goal add <title> [tier] [repos...] | goal repos <id> <repo...> | goal merge <id> gated|open | goal move <id> <active|hold|todo|done> | goal confirm <id> | goal owner <id> <squiggle> | goal edit <id> <title> | goal note <id> <text> | goal kind <id> area|goal | goal drop <id>
  goal: () => {
    const [op, x, y] = a;
    if (op === 'add') return call('/goals', { op, title: x, tier: y, repos: a.slice(3) });
    if (op === 'move') return call('/goals', { op, id: x, tier: y, ...(a[3] != null ? { index: Number(a[3]) } : {}) });
    if (op === 'owner') return call('/goals', { op: 'edit', id: x, owner: y || '' });
    if (op === 'note') return call('/goals', { op: 'edit', id: x, note: y || '' });
    if (op === 'repos') return call('/goals', { op: 'edit', id: x, repos: a.slice(2) });
    if (op === 'merge') return call('/goals', { op: 'edit', id: x, merge: y });
    if (op === 'kind') return call('/goals', { op: 'edit', id: x, kind: y });
    if (op === 'due') return call('/goals', { op: 'edit', id: x, due: y || 'clear' });
    if (op === 'edit') return call('/goals', { op, id: x, title: y });
    return call('/goals', { op, id: x });
  },
  tasks: async () => {
    const t = (await call('/board')).tasks.filter((x) => (x.kind !== 'suggestion' || x.decision === 'accepted') && (!a[0] || x.goal === a[0] || x.owner === a[0]));
    return t.filter((x) => x.status !== 'done' || a[0]).map((x) =>
      `${x.id}  ${x.status}  ${x.split ? '(needs splitting) ' : ''}${x.title}${x.parent ? `  (part of ${x.parent})` : ''}${x.goal ? `  [${x.goal}]` : ''}${x.owner ? `  @${x.owner}` : ''}${x.branch ? `  branch ${x.repo ? x.repo + ':' : ''}${x.branch}${x.base ? ` into ${x.base}` : ''}` : ''}${x.needs?.some((n) => !n.done) ? `  needs ${x.needs.filter((n) => !n.done).length} before merge` : ''}${x.after?.some((n) => !n.done) ? `  ${x.after.filter((n) => !n.done).length} after merge` : ''}  confirmed ${x.confirmed}${x.note ? `  — ${x.note}` : ''}`).join('\n') || 'no tasks';
  },
  // Command approvals: asks [all] | ask run "<cmd>" "<why>" (squiggles file) | ask show <id> | ask deny <id> ["note"].
  // Running is the owner's Run button only: no CLI run.
  asks: async () => {
    const l = await call(`/asks${a[0] === 'all' ? '?all=1' : ''}`);
    return l.map((x) => `${x.id}  ${x.status}  ${x.by}  ${x.why || ''}\n    cwd ${x.cwd}\n    ${JSON.stringify(x.cmd)}`).join('\n') || (a[0] === 'all' ? 'no asks' : 'no pending asks');
  },
  // Waits: waits [all|<id>] | wait add "<what>" --file <path>|--pid <pid> [--host <user@host>] [--every 2m] [--for 4h] [--task <id>] | wait drop <id>.
  waits: async () => {
    const one = a[0] && a[0] !== 'all', l = one ? [await call(`/waits?all=1`).then((x) => x.find((w) => w.id === a[0]) || Promise.reject(new Error(`no wait ${a[0]}`)))] : await call(`/waits${a[0] === 'all' ? '?all=1' : ''}`);
    const at = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return l.map((w) => `${w.id}  ${w.status}  ${w.by}  ${w.what}${w.task ? `  [${w.task}]` : ''}\n    ${w.file ? `file ${w.file}` : `pid ${w.pid}`}${w.host ? ` on ${w.host}` : ''}, every ${Math.round(w.every / 1000)}s until ${at(w.until)}${w.checked ? `, checked ${at(w.checked)}` : ''}${w.lastFail ? `, check failing (${w.fails}): ${w.lastFail}` : ''}${w.result ? `\n    ${w.result}` : ''}`).join('\n') || (a[0] === 'all' ? 'no waits' : 'no open waits');
  },
  wait: async () => {
    const [op, ...rest] = a, flag = (n) => { const i = rest.indexOf(n); return i < 0 ? undefined : rest.splice(i, 2)[1]; };
    if (op === 'add') {
      const w = await call('/waits', { op: 'add', file: flag('--file'), pid: flag('--pid'), host: flag('--host'), every: flag('--every'), max: flag('--for'), task: flag('--task'), what: rest.join(' ') });
      return `${w.id} filed: the harness checks every ${Math.round(w.every / 1000)}s and wakes you with the result. End your turn with WAITING: <what>.`;
    }
    if (op === 'drop') { const w = await call('/waits', { op: 'drop', id: rest[0] }); return `${w.id} dropped`; }
    throw new Error('wait add "<what>" --file <path>|--pid <pid> [--host <user@host>] [--every 2m] [--for 4h] [--task <id>] | wait drop <id>');
  },
  // Picks: picks [all] | pick ask "<question>" "<option>" "<option>"... [--images <path>,<path>] [--task <id>]
  // | pick <id> <option number or label> (the owner's word, relayed by the lead) | pick drop <id>.
  picks: async () => (await import('../picks.mjs')).describePicks(await call(`/picks${a[0] === 'all' ? '?all=1' : ''}`)),
  pick: async () => {
    const [op, ...rest] = a, flag = (n) => { const i = rest.indexOf(n); return i < 0 ? undefined : rest.splice(i, 2)[1]; };
    if (op === 'ask') {
      const task = flag('--task'), images = (flag('--images') || '').split(',').map((s) => s.trim()), { resolve } = await import('node:path'), { homedir } = await import('node:os'), { realpathSync } = await import('node:fs');
      const real = (f) => { const r = resolve(f.replace(/^~(?=\/|$)/, homedir())); try { return realpathSync(r); } catch { return r; } }; // the page maps realpaths
      const [question, ...labels] = rest, r = await call('/picks', { op: 'ask', question, task, options: labels.map((label, i) => ({ label, ...(images[i] && { image: real(images[i]) }) })) });
      return `${r.id} filed: ${loadConfig().userName || 'the user'} sees it on the picks card in the lead chat. You hear the answer.`;
    }
    if (op === 'drop') { const r = await call('/picks', { op: 'drop', id: rest[0] }); return `${r.id} dropped`; }
    if (!op) throw new Error('pick ask "<question>" "<option>" "<option>" [--images a.png,b.png] [--task <id>] | pick <id> <option> | pick drop <id>');
    const r = await call('/picks', { op: 'pick', id: op, option: rest.join(' ') }); return `${r.id}: ${r.answer}. ${r.by} is told.`;
  },
  ask: async () => {
    const [op, x, ...rest] = a;
    if (op === 'run') { const r = await call('/asks', { op: 'file', cmd: x, why: rest.join(' '), cwd: process.cwd() }); return `${r.id} filed: the owner sees it and runs or denies it. You hear the result.`; }
    if (op === 'show') { const r = await call(`/asks/${encodeURIComponent(x || '')}`); return `${r.id} ${r.status} by ${r.by}\ncwd: ${r.cwd}\n${r.cmd}${r.out != null ? `\n--- exit ${r.exit}, ${Math.round(r.ms / 1000)}s\n${r.out}` : ''}`; }
    if (op === 'deny') { const r = await call('/asks', { op: 'deny', id: x, note: rest.join(' ') || undefined }); return `${r.id} ${r.status}`; }
    if (op === 'exec' || op === 'approve') throw new Error('only the owner runs an ask, with Run on the page');
    throw new Error('ask run "<command>" "<why>" | ask show <id> | ask deny <id> ["note"]');
  },
  // Suggestions (t825): suggest "<one line>" [evidence path/url] files one for the lead; similar titles dedupe.
  suggest: async () => {
    const r = await call('/tasks', { op: 'suggest', title: a[0], evidence: a.slice(1).join(' ') || undefined, by: process.env.AGENTS_ID });
    return r.dup ? `already suggested as ${r.id}: ${r.title}${r.decision ? ` (${r.decision}${r.why ? `: ${r.why}` : ''})` : ''}` : `${r.id} suggested; the lead sees it with the next team report`;
  },
  // suggestions [all]: open ones, or every one with the lead's decision
  suggestions: async () => {
    const t = (await call('/board')).tasks.filter((x) => x.kind === 'suggestion' && (a[0] === 'all' || !x.decision));
    return t.map((x) => `${x.id}  ${x.decision || 'open'}  ${x.title}  by ${x.by || '?'}${x.also?.length ? ` (also ${x.also.join(', ')})` : ''}${x.evidence ? `  evidence: ${x.evidence}` : ''}${x.decision === 'accepted' ? `  -> [${x.goal}] @${x.owner}` : ''}${x.why ? `  why: ${x.why}` : ''}`).join('\n') || (a[0] === 'all' ? 'no suggestions' : 'no open suggestions');
  },
  // suggestion accept <id> <goal> <owner> | suggestion decline <id> "<why>"
  suggestion: async () => {
    const [op, id, x, y] = a, by = process.env.AGENTS_ID || 'owner';
    if (op === 'accept') { const r = await call('/tasks', { op, id, goal: x, owner: y, by }); return `${r.id} accepted: on ${r.goal} for ${r.owner}`; }
    if (op === 'decline') { const r = await call('/tasks', { op, id, why: a.slice(2).join(' '), by }); return `${r.id} declined; ${r.by || 'the author'} hears why at their next wake`; }
    throw new Error('usage: suggestion accept <id> <goal> <owner> | suggestion decline <id> "<why>"');
  },
  // task worktree <id> [repo]: the only way to make a worktree, at ~/wt/<repo>-<id>, recorded on the task (gated goals) |
  // task needs <id> add "<owner>: <what they must do before merging>" | done|undo|drop <n> | tag <n> <owner> | clear (also task edit <id> needs ...) |
  // task after <id> add "<owner>: <what they must do after merging>" | done|undo|drop <n> | tag <n> <owner> | clear |
  // task add <title> [goal] [owner] [--asked <who>] | task split <id> <subtask>... | task claim <id> [owner] | task release <id> | task edit <id> split true|false | task edit <id> parent <id> | task move <id> <todo|doing|blocked|done> [note] | task move <id> review [repo:]<branch> [note] | task edit <id> branch [repo:]<branch> | task confirm <id> | task ship <id> [note] | task edit <id> <field> <value> | task drop <id>
  task: () => {
    const [op, x, y, z] = a;
    if (op === 'add') { const i = a.indexOf('--asked'), asked = i > 0 ? a.splice(i, 2)[1] || 'owner' : undefined; const [, t, g, o] = a; return call('/tasks', { op, title: t, goal: g, owner: o, by: process.env.AGENTS_ID, asked }); }
    if (op === 'move' && y === 'review') return call('/tasks', { op, id: x, status: y, branch: z, note: a[4] });
    if (op === 'move') return call('/tasks', { op, id: x, status: y, note: z });
    if (op === 'claim') return call('/tasks', { op: 'edit', id: x, owner: y || process.env.AGENTS_ID || '' });
    if (op === 'release') return call('/tasks', { op: 'edit', id: x, owner: '' });
    if (op === 'split') return call('/tasks', { op, id: x, titles: a.slice(2), by: process.env.AGENTS_ID });
    // task base <id> <branch>|auto (t1638): what the Merge tab merges into; set on review when the branch was cut from another branch.
    if (op === 'base') return call('/tasks', { op, id: x, branch: y || 'auto' }).then((t) => `${t.id} merges into ${t.base || 'the default branch'}`);
    if (op === 'worktree') return call('/tasks', { op, id: x, ...(y ? { repo: y } : {}) }).then((t) => `${t.created ? 'created' : 'already there'}: ${t.path} on ${t.branch}`);
    if (op === 'needs' || op === 'after' || (op === 'edit' && (y === 'needs' || y === 'after'))) { const [list, act, v] = op === 'edit' ? [y, z, a[4]] : [op, y, z]; return call('/tasks', { op: list, id: x, act, ...(/^\d+$/.test(v || '') ? { n: v } : { text: v }), ...(act === 'tag' ? { who: op === 'edit' ? a[5] : a[4] } : {}) }); }
    // task ship <id> [note]: a guardian's sign-off, pinned to the commit under review.
    if (op === 'ship') return call('/tasks', { op, id: x, note: y, by: process.env.AGENTS_ID }).then((t) => `${t.id} shipped at ${t.shipped.at(-1).sha.slice(0, 7)}`);
    if (op === 'edit') return call('/tasks', { op, id: x, [y]: z ?? '' });
    return call('/tasks', { op, id: x });
  },
  // worktrees [check]: every extra worktree in the goals' repos with its task and owner; check refreshes the lead's orphan note (t769).
  worktrees: async () => {
    const r = a[0] === 'check' ? (await call('/worktrees', {})).worktrees : await call('/worktrees'), home = (p) => p.replace(/^\/Users\/[^/]+/, '~');
    return r.map((w) => `${w.orphan ? 'ORPHAN  ' : `${w.task}  `}${home(w.path)}  ${w.branch || '(detached)'}${w.task ? `  ${w.status}${w.owner ? ` @${w.owner}` : ''}` : ''}${w.dirty ? `  ${w.dirty} uncommitted` : ''}${w.missing ? '  folder gone' : ''}${w.home ? '' : '  (not in ~/wt)'}`).join('\n') || 'no extra worktrees';
  },
  // merges | merge <task> | merge diff <task> | merge back <task> <note>. The user merges from the Merge tab; the lead runs `merge` only when they say so for that item.
  merges: async () => a[0] === 'refresh'
    ? ((r) => r.closed.length ? r.closed.map((c) => `${c.id} done: ${c.why}`).join('\n') : `nothing merged outside; ${r.merges.length} in review`)(await call('/merges', { op: 'refresh' }))
    : [(await call('/merges')).map((m) => m.error
    ? `${m.id}  ${m.title}  ${m.repo}:${m.branch}  — ${m.error}`
    : `${m.id}  ${m.title}  ${m.repo}:${m.branch}  ${m.ahead} ahead${m.behind ? `, ${m.behind} behind` : ''} of ${m.base}${m.others?.length ? `  + ${m.others.map((o) => `${o.repo}${o.error ? ` (${o.error})` : ` ${o.ahead} ahead`}`).join(', ')}` : ''}${m.conflicts?.length ? `  CONFLICTS: ${m.conflicts.join(', ')}` : ''}  ${m.age}d${m.stale ? ' STALE' : ''}${m.sha ? `  at ${m.sha}` : ''}${m.shipped?.length ? `  shipped by ${m.shipped.map((x) => x.by).join(', ')}` : ''}${m.owner ? `  @${m.owner}` : ''}${m.result ? `  — ${m.result}` : '  — no test result'}${steps(m.needs, 'needs')}${steps(m.after, 'after')}${m.desktop ? `\n    desktop: ${m.desktop}` : ''}${m.compare ? `\n    github: ${m.compare}` : ''}`).join('\n'), await afterMerge()].filter(Boolean).join('\n\n') || 'nothing in review',
  // meetings [days] [from YYYY-MM-DD] (past ones say Done or Missed) | meeting add "<title>" "<when>" <id,id> [once|daily|weekdays|weekly] ["<agenda>"] | meeting edit <id> <field> <value> (presenters <id,id> sets the turn order; showtell true|false builds each presenter's agenda from their work since the last one) | meeting cancel <id> [date] | meeting start <id> | meeting next | meeting end | meeting now
  meetings: async () => {
    const { upcoming } = await call(`/meetings?days=${Number(a[0]) || 7}${a[1] ? `&from=${a[1]}T00:00` : ''}`);
    const day = (s) => new Date(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return upcoming.map((m) => `${m.past ? (m.past === 'done' ? 'Done: ' : 'Missed: ') : ''}${day(m.start)} ${m.start.slice(11)}-${m.end.slice(11)}  ${m.id}  ${m.title}  with ${m.attendees.join(', ')}${m.repeat !== 'once' ? `  (${m.repeat})` : ''}${m.agenda ? `\n    ${m.agenda.replace(/\n/g, '\n    ')}` : ''}`).join('\n') || `no meetings in the next ${Number(a[0]) || 7} days`;
  },
  meeting: async () => {
    const [op, ...r] = a, fmt = (m) => `${m.id} ${m.title}: ${m.at.replace('T', ' ')}, ${m.minutes} min, ${m.repeat}, with ${m.attendees.join(', ')}`;
    if (op === 'add') return fmt(await call('/meetings', { op, title: r[0], when: r[1], attendees: r[2], repeat: ['once', 'daily', 'weekdays', 'weekly'].includes(r[3]) ? r[3] : undefined, agenda: ['once', 'daily', 'weekdays', 'weekly'].includes(r[3]) ? r[4] : r[3], by: process.env.AGENTS_ID || 'owner' }));
    if (op === 'edit') { if (!['title', 'agenda', 'attendees', 'presenters', 'showtell', 'when', 'minutes', 'repeat'].includes(r[1])) throw new Error('meeting edit <id> title|agenda|attendees|presenters|showtell|when|minutes|repeat <value>'); return fmt(await call('/meetings', { op, id: r[0], [r[1]]: r.slice(2).join(' ') })); }
    if (op === 'cancel') { const m = await call('/meetings', { op, id: r[0], date: r[1] }); return m.cancelled ? `${m.id} cancelled` : `${m.id} skips ${m.skip.at(-1)}`; }
    if (op === 'start') { const m = await call('/meetings', { op, id: r[0] }); return `meeting on: ${m.title}, ${m.start.slice(11)} to ${m.end.slice(11)}, attendees woken`; }
    if (op === 'end') { await call('/meetings', { op }); return 'meeting ended'; }
    if (op === 'next') { const m = await call('/meetings', { op }); return m.turn < m.presenters.length ? `now presenting: ${m.presenters[m.turn]} (${m.turn + 1} of ${m.presenters.length})` : 'all presented: open questions'; }
    if (op === 'now') { const { current: m } = await call('/meetings?days=1'); return m ? `${m.title}, ${m.start.slice(11)} to ${m.end.slice(11)} with ${m.attendees.join(', ')}${m.presenters ? `; ${m.turn < m.presenters.length ? `presenting: ${m.presenters[m.turn]} (${m.turn + 1} of ${m.presenters.length})` : 'open questions'}` : ''}` : 'no meeting on'; }
    if (op === 'list' || !op) return cmds.meetings();
    throw new Error('meeting add|edit|cancel|start|next|end|now|list');
  },
  // meet now <id,id> ["topic"] [--presenters <id,id>]: a 30-minute meeting that starts at once; presenters default to the attendees in order
  meet: async () => {
    // meet merges (t599): squiggles with branches in review present them, most urgent first, at most 5
    if (a[0] === 'merges') { const m = await call('/meetings', { op: 'merges', by: process.env.AGENTS_ID || 'owner' }); return `merge review on: ${m.presenters.join(', ')} present, in that order`; }
    if (a[0] !== 'now' || !a[1]) throw new Error('meet now <id,id> ["topic"] [--presenters <id,id>] | meet merges');
    const pi = a.indexOf('--presenters'), presenters = pi > 0 ? a.splice(pi, 2)[1] : '';
    const m = await call('/meetings', { op: 'now', attendees: a[1], presenters, topic: a.slice(2).join(' '), by: process.env.AGENTS_ID || 'owner' });
    return `meeting on: ${m.title}, ${m.start.slice(11)} to ${m.end.slice(11)} with ${m.attendees.join(', ')}, attendees woken`;
  },
  merge: async () => {
    if (a[0] === 'back') return call('/merges', { op: 'back', id: a[1], note: a[2], by: process.env.AGENTS_ID || 'owner' });
    if (a[0] === 'diff') { const d = await call(`/merges/${a[1]}/diff`); return `${d.log.join('\n')}\n\n${d.stat}\n\n${d.diff}`; }
    const r = await call('/merges', { op: 'merge', id: a[0], by: process.env.AGENTS_ID || 'owner' }); if (!r.merged?.length) return `${r.id} already on ${r.base}, task done`; return `${r.id} merged into ${r.merged?.length > 1 ? r.merged.map((d) => `${d.repo} ${d.base} at ${d.sha}`).join(', ') : `${r.base} at ${r.sha}`}, branch ${r.branch} deleted, task done`;
  },
  // call <teams-url> [until <time>] | call status | call leave: the lead joins a Teams call through ~/claude-in-call
  call: async () => {
    if (a[0] === 'leave') return call('/call', { op: 'leave' });
    if (!a[0] || a[0] === 'status') { const c = await call('/call'); return c.live ? `in a call as ${c.name} since ${new Date(c.started).toLocaleTimeString()}${c.ends ? `, until ${c.ends.slice(11)}` : ''} (pid ${c.pid})\n${c.url}\n\n${(c.log || []).join('\n')}` : `not in a call${c.pid ? `\nlast call log:\n${(c.log || []).join('\n')}` : ''}`; }
    const until = a[1] === 'until' ? a.slice(2).join(' ') : a.slice(1).join(' ');
    const r = await call('/call', { op: 'join', url: a[0], ...(until ? { until } : {}) });
    return `joining as ${r.name} (pid ${r.pid})${r.ends ? `; leaves at ${r.ends.slice(11)} + 5 min` : ''}; call status to follow it, call leave to hang up`;
  },
  // screen diff <task> | url <url> | file <path> | off [--as <id>]: pin it on the shared screen beside your 1:1 (t664); a .mp4/.mov/.webm file plays as video (t1503)
  screen: async () => {
    const i = a.indexOf('--as'), as = i >= 0 ? a.splice(i, 2)[1] : process.env.AGENTS_ID;
    if (!as) throw new Error('screen needs --as <id> outside a squiggle');
    const arg = a.slice(1).join(' '), r = await call(`/squiggles/${as}/screen`, { kind: a[0], arg: a[0] === 'file' && !/^[~/]/.test(arg) ? `${process.cwd()}/${arg}` : arg, by: process.env.AGENTS_ID || 'owner' });
    return r.kind === 'off' ? 'screen closed' : `on ${as}'s screen: ${r.title}`;
  },
  // restart [now|later|status]: plain restart counts down 10s on the owner's open page; now skips that.
  // restart [now|later|force|status]: refused when no server code or config changed since start; force skips that.
  restart: async () => {
    const who = loadConfig().userName || 'the user';
    if (a[0] === 'status') { const r = await call('/restart'); return r.phase === 'asking' ? `counting down on ${who}'s page: ${Math.max(0, Math.round((r.until - Date.now()) / 1000))}s left` : r.phase === 'later' ? `postponed by ${who} at ${new Date(r.at).toLocaleTimeString()}; runs once they are idle on the page` : r.pending ? `pending: waiting for ${r.working} working turn${r.working === 1 ? '' : 's'}` : 'no restart due'; }
    if (a[0] === 'now' || a[0] === 'later') return call('/restart', { op: a[0], by: process.env.AGENTS_ID || 'owner' });
    if (a[0] && a[0] !== 'force') throw new Error('restart [now|later|force|status]');
    return call('/restart', { by: process.env.AGENTS_ID || 'owner', ...(a[0] === 'force' && { force: true }) });
  },
  upgrade: async () => (await import('./upgrade.mjs')).upgrade(),
  // peers | peer invite [name] | peer join '<code>' | peer cancel | peer add|remove|send | peer on|off (t1171, t1177): lead-to-lead link to another room over the tailnet
  peers: async () => {
    const r = await call('/peers'), t = (x) => new Date(x).toLocaleString('en-CA', { hour12: false }).slice(0, 17).replace(',', '');
    const rows = r.peers.map((p) => `${p.name}  ${p.url}${p.lastIn ? `  in ${t(p.lastIn)}` : ''}${p.lastOut ? `  out ${t(p.lastOut)}` : ''}${p.lastError ? `  ${p.lastErrorKind === 'unreachable' ? "can't reach" : 'key refused'} ${t(p.lastErrorAt)}: ${p.lastError}` : ''}`);
    return [`peers ${r.on ? 'on' : 'off'}; this room is ${r.self.name}${r.self.url ? ` at ${r.self.url}` : ' (not shared)'}`, ...(r.pending ? [`invite open as ${r.pending.name} until ${t(r.pending.expires)}`] : []), ...rows].join('\n') + (rows.length ? '' : '\nno peers');
  },
  peer: async () => {
    const [op, name, ...r] = a;
    if (op === 'invite') { const c = await call('/peers', { op, name }); return `Pairing code, works once until ${new Date(c.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Give it to the other room's 'peer join':\n${c.code}`; }
    if (op === 'join') { const p = await call('/peers', { op, code: name }); return `linked ${p.name} (${p.url})`; }
    if (op === 'cancel' || op === 'on' || op === 'off') return call('/peers', { op });
    if (op === 'add') { const p = await call('/peers', { op, name, url: r[0], key: r[1] }); return `${p.name} added (${p.url}). Its key is in ${p.keyFile} (only you can read it): give it to the other room's 'peer add', then delete the file. 'peer invite' is easier.`; }
    if (op === 'remove' || op === 'send') return call('/peers', { op, name, text: r.join(' ') });
    throw new Error("peer invite [name] | peer join '<code>' | peer cancel | peer add <name> <url> [key] | peer remove <name> | peer send <name> \"<text>\" | peer on|off");
  },
  // quit [now]: end every squiggle and the server; the login item stays off until Squiggles.app opens it (t1154). Only when the user says.
  quit: () => call('/quit', { now: a[0] === 'now', by: process.env.AGENTS_ID || 'owner' }),
  // files [query] | file add <path> [for <id>] | file rm <name>: files/ plus the read-only folders, newest first; only files/ takes adds and deletes.
  files: async () => (await call(`/files?q=${encodeURIComponent(a.join(' '))}`)).files.map((f) => `${new Date(f.mtime).toISOString().slice(0, 10)}  ${f.src === 'files' ? f.name : `${f.src}/${f.name}`}${f.by ? `  by ${f.by}` : ''}${f.task ? `  ${f.task}` : ''}\n    ${f.path}`).join('\n') || 'no files',
  file: async () => {
    const [op, ...r] = a;
    if (op === 'add') {
      if (!r[0] || (r[1] && (r[1] !== 'for' || !r[2]))) throw new Error('file add <path> [for <id>]');
      const { readFileSync } = await import('node:fs'), { resolve, basename } = await import('node:path');
      const f = await call('/files', { op, name: basename(r[0]), data: readFileSync(resolve(r[0])).toString('base64'), for: r[2], by: process.env.AGENTS_ID || 'owner' });
      return `${f.path}${f.task ? `  (${f.task} for ${r[2]})` : ''}`;
    }
    if (op === 'rm') return `${(await call('/files', { op, name: r[0] })).removed} removed`;
    throw new Error('file add <path> [for <id>] | file rm <name>');
  },
  // humans | human add "<name>" [avatar] | human edit <id> name|avatar <value> | human remove <id>
  humans: async () => (await call('/humans')).humans.map((h) => `${h.id}  ${h.name}${h.avatar ? `  ${h.avatar.length > 40 ? 'image' : h.avatar}` : ''}`).join('\n'),
  human: async () => {
    const [op, ...r] = a, show = (h) => `${h.id}  ${h.name}${h.avatar ? `  ${h.avatar.length > 40 ? 'image' : h.avatar}` : ''}`;
    if (op === 'add') return show(await call('/humans', { op, name: r[0], avatar: r[1] }));
    if (op === 'edit') { if (!['name', 'avatar'].includes(r[1])) throw new Error('human edit <id> name|avatar <value>'); return show(await call('/humans', { op, id: r[0], [r[1]]: r.slice(2).join(' ') })); }
    if (op === 'remove') { const h = await call('/humans', { op, id: r[0] }); return `${h.name} removed`; }
    throw new Error('human add|edit|remove');
  },
  // share on|off|status: the room on the tailnet (tailscale serve)
  share: async () => {
    const op = a[0] || 'status'; if (!['on', 'off', 'status'].includes(op)) throw new Error('share on|off|status');
    const st = op === 'status' ? await call('/share') : await call('/share', { on: op === 'on' });
    return st.on ? `shared on the tailnet: ${st.url}` : 'not shared on the tailnet';
  },
  // inbox: the user's dropped notes, unread (waiting for the lead) and read
  inbox: async () => {
    const { unread, read } = await call('/inbox'), t = (f) => new Date(f.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return [`unread: ${unread.length ? '' : 'none'}`, ...unread.map((f) => `  ${f.name}  ${t(f)}`), `read: ${read.length ? '' : 'none'}`, ...read.slice(0, 20).map((f) => `  ${f.name}  ${t(f)}`)].join('\n');
  },
  limit: async () => {
    const l = await call('/limit'), t = (x) => new Date(x).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return l.until ? `session limit hit, stated reset ${t(l.until)} (display only: wakes carry on)` : 'no session limit reported';
  },
  remove: () => call(`/squiggles/${a[0]}/remove`, {}),
  // room radio <fip|fipjazz|...|off> | room volume <0-1> | room voices on|off | room chatter quiet|normal|lively | room characters <generator> | room view room|lead|meeting|team|calendar|goals|tasks|merge|files|settings | room view files <name> (preview) | room view blocked|rethink | room fold|unfold active|hold|next|done|areas | room view 1on1 <id> | room view calendar week|month | room view settings [room|characters|squiggles|people|sharing|defaults|security] | room chat <id> ["<draft>"] | room lock
  // room passcode set <code>|clear|status|local on|off (t913): optional lock-screen passcode. Once set, changing it asks for the current one.
  room: async () => {
    if (a[0] === 'passcode') {
      const op = a[1] || 'status', b = op === 'set' ? { op, code: a[2] } : op === 'local' ? { op, on: a[2] === 'on' } : { op };
      if (op === 'set' && !a[2]) throw new Error('room passcode set <code>');
      if (op === 'local' && !['on', 'off'].includes(a[2])) throw new Error('room passcode local on|off');
      if (['set', 'clear', 'local'].includes(op)) b.old = await codeIfSet('the current passcode');
      const r = op === 'status' ? await call('/passcode') : await call('/passcode', b);
      return r.set ? `passcode on${r.localSkips ? ', this Mac skips it' : ''}` : 'passcode off';
    }
    // Goals columns (t1217): fold or unfold on every open page; each browser remembers it.
    if ((a[0] === 'fold' || a[0] === 'unfold') && !['active', 'hold', 'todo', 'next', 'done', 'areas'].includes(a[1])) throw new Error(`room ${a[0]} active|hold|next|done|areas`);
    return call('/room', { action: a[0], value: a[1], ...(a[0] === 'chat' ? (a[2] ? { text: a.slice(2).join(' ') } : {}) : a[2] ? { id: a[2] } : {}) });
  },
  // defaults [model|effort|every <value>] (t898): what a new squiggle starts with. 'default' clears model or effort.
  defaults: () => {
    if (!a[0]) return call('/defaults');
    if (a[1] == null) throw new Error('defaults model|effort|every <value> (default clears model or effort)');
    return call('/defaults', { [a[0]]: a[1] === 'default' ? '' : a[1] });
  },
  rename: () => call(`/squiggles/${a[0]}/update`, { name: a[1], ...(a[2] ? { role: a[2] } : {}) }),
  create: () => call('/squiggles', { id: a[0], name: a[1], role: a[2], cwd: a[3], every: a[4], charter: a[5] }),
  // look <id> [<generator>[:<options>]|<character>|auto|shuffle] (t832): the squiggle's character; auto follows the room default
  // (room characters <generator>); shuffle rerolls the seed. Options: a bare value or k=v,k=v, checked against ui/cast.js.
  look: async () => {
    if (a[1] === 'shuffle') return call(`/squiggles/${a[0]}/update`, { lookSeed: Math.floor(Math.random() * 1e9) });
    if (!a[1] || a[1] === 'auto') return call(`/squiggles/${a[0]}/update`, { look: '' });
    const vm = await import('node:vm'), { readFileSync, readdirSync } = await import('node:fs'), ctx = vm.createContext({}), gdir = new URL('../ui/gen/', import.meta.url);
    const files = readdirSync(gdir).filter((f) => f.endsWith('.js')).sort((x, y) => y.endsWith('-parts.js') - x.endsWith('-parts.js') || x.localeCompare(y));
    for (const u of [new URL('../ui/cast.js', import.meta.url), ...files.map((f) => new URL(f, gdir))]) vm.runInContext(readFileSync(u, 'utf8'), ctx);
    const { gen, opts } = ctx.parseLook(a[1]), G = ctx.GENS[gen], want = a[1].split(':')[0].toLowerCase();
    const given = a[1].includes(':') ? a[1].slice(a[1].indexOf(':') + 1).split(',').filter(Boolean).length : 0;
    if (G && gen === want && Object.keys(opts).length < given) return `unknown option. ${gen} takes a bare ${Object.keys(G.options)[0]} or k=v with k one of: ${Object.keys(G.options).join(', ')}. Values: ${Object.entries(G.options).map(([k, v]) => `${k}: ${v.join(' ')}`).join('; ')}`;
    if (!G || (gen !== want && !opts.character) || Object.keys(opts).length < given) return `unknown look. generators: ${Object.keys(ctx.GENS).join(', ')}; cast characters: ${ctx.LOOKS.join(', ')}`;
    const first = Object.keys(G.options)[0], ks = Object.keys(opts);
    const o = ks.length === 1 && ks[0] === first ? opts[first] : ks.map((k) => `${k}=${opts[k]}`).join(',');
    return call(`/squiggles/${a[0]}/update`, { look: gen + (o ? ':' + o : '') });
  },
  // calendar [from] [to] [calendar] [--notes] [--json] | calendar list | status | allow (t785): this Mac's calendars via EventKit, read-only, local (no server).
  // Dates YYYY-MM-DD, today or tomorrow; to is inclusive. Only `allow` shows the macOS prompt.
  // --notes adds location and notes, which the invite's sender wrote (t925): fenced and line-prefixed as untrusted data.
  calendar: async () => {
    const { execFileSync } = await import('node:child_process'), fs = await import('node:fs'), dir = new URL('.', import.meta.url).pathname;
    const bin = dir + 'calendar-reader', src = bin + '.swift';
    if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs)
      execFileSync('swiftc', ['-O', src, '-o', bin, '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', bin + '.plist'], { stdio: 'inherit' });
    const json = a.includes('--json'), notes = a.includes('--notes'), r = a.filter((x) => x !== '--json' && x !== '--notes'), day = (x) => x === 'today' || x === 'tomorrow' || /^\d{4}-\d{2}-\d{2}$/.test(x);
    const iso = (x) => { if (x !== 'today' && x !== 'tomorrow') return x; const d = new Date(); if (x === 'tomorrow') d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv'); };
    const sub = ['status', 'allow', 'list'].includes(r[0]) ? r[0] : 'events', dates = r.filter(day).map(iso), cal = sub === 'events' && r.find((x) => !day(x));
    const argv = sub === 'list' ? ['calendars'] : sub !== 'events' ? [sub] : ['events', ...(dates[0] ? ['--from', dates[0]] : []), ...(dates[1] ? ['--to', dates[1]] : []), ...(cal ? ['--calendar', cal] : []), ...(notes ? ['--notes'] : [])];
    let v; try { v = JSON.parse(execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (e) { let m = e.message; try { m = JSON.parse(e.stderr).error; } catch {} throw new Error(m); }
    if (json || sub === 'status' || sub === 'allow') return sub === 'status' || sub === 'allow' ? (json ? v : `calendar access: ${v.status}`) : v;
    if (sub === 'list') { const { oneLine } = await import('../calendar.mjs'); return v.map((c) => oneLine(`${c.title}  (${c.source}, ${c.type})`)).join('\n') || 'no calendars'; }
    return (await import('../calendar.mjs')).eventsText(v);
  },
  set: () => {
    const v = a[2] === 'true' ? true : a[2] === 'false' ? false : /^\d+$/.test(a[2]) ? Number(a[2]) : a[2];
    return call(`/squiggles/${a[0]}/update`, { [a[1]]: v });
  },
};

if (!cmds[cmd]) {
  console.log('usage: agents.mjs list | team | wake <id> [why] | tell <id> <text> [--image <path>] | stop <id> | clear <id> | remove <id> | room radio|volume|voices|chatter|characters|view|chat <value> | room passcode set <code>|clear|status|local on|off | room view 1on1 <id> | room view calendar week|month | room view settings [room|characters|squiggles|people|sharing|defaults|security] | room view blocked|rethink | room fold|unfold active|hold|next|done|areas | room lock | room reload | call <teams-url> [until <time>] | call status | call leave | restart [now|later|force|status] | load [days] | cost [days] | notes <query> | quit [now] | peers | peer invite [name] | peer join "<code>" | peer cancel | peer add <name> <url> [key] | peer remove <name> | peer send <name> "<text>" | peer on|off | upgrade | limit | inbox | screen diff <task>|url <url>|file <path>|off [--as <id>] | share on|off|status | defaults [model|effort|every <value>] | asks [all] | ask run "<cmd>" "<why>" | ask show <id> | ask deny <id> ["note"] | waits [all|<id>] | wait add "<what>" --file <path>|--pid <pid> [--host <user@host>] [--every 2m] [--for 4h] [--task <id>] | wait drop <id> | picks [all] | pick ask "<question>" "<option>" "<option>" [--images a,b] [--task <id>] | pick <id> <option> | pick drop <id> | files [query] | file add <path> [for <id>] | file rm <name> | calendar [from] [to] [calendar] [--notes] [--json] | calendar list|status|allow | humans | human add "<name>" [avatar] | human edit <id> name|avatar <value> | human remove <id> | tail <id> [n] | journal <id> | charter <id> [new text] | rename <id> <name> [role] | create <id> <name> <role> <cwd> <every> <charter> | set <id> <field> <value> | look <id> [<generator>[:<options>]|character|auto|shuffle] | goals | goal add|move|confirm|owner|note|repos|merge|kind|edit|drop ... | goal due <id> <YYYY-MM-DD>|clear | tasks [goal|owner] | task add|move|confirm|edit|needs|drop ... | task needs <id> add "<owner>: <text>"|done|undo|drop <n>|tag <n> <owner>|clear | task after <id> add "<owner>: <text>"|done|undo|drop <n>|tag <n> <owner>|clear | task move <id> review [repo:]<branch> ["<test result>"] | meetings [days] [from YYYY-MM-DD] | meeting add "<title>" "<when>" <id,id> [once|daily|weekdays|weekly] ["<agenda>"] | meeting edit <id> <field> <value> | meeting cancel <id> [date] | meeting start <id> | meeting next | meeting end | meeting now | meet now <id,id> ["topic"] [--presenters <id,id>] | meet merges | merges [refresh] | worktrees [check] | task worktree <id> [repo] | task base <id> <branch>|auto | suggest "<one line>" [evidence] | suggestions [all] | suggestion accept <id> <goal> <owner> | suggestion decline <id> "<why>" | merge <task> | merge diff <task> | merge back <task> "<note>"');
  process.exit(1);
}
try {
  const r = await cmds[cmd]();
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
