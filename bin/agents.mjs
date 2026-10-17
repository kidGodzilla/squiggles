#!/usr/bin/env node
// Harness CLI, used by the lead (and by you from a terminal).
import { loadConfig } from '../config.mjs';
const base = `http://127.0.0.1:${loadConfig().port}/api`;
const [cmd, ...a] = process.argv.slice(2);

async function call(path, body) {
  const res = await fetch(base + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const v = await res.json();
  if (v && v.error) throw new Error(v.error);
  return v;
}

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
    `${s.id}${s.lead ? ' (lead)' : ''}  ${s.paused ? 'paused' : s.status}  every ${s.every || 0}m  ${s.name}, ${s.role}${s.note ? `  — ${s.note}` : ''}${Object.keys(s.subs || {}).length ? `  · subagents: ${Object.values(s.subs).map((x) => x.desc || x.type).join(', ')}` : ''}`).join('\n'),
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
  tell: () => call(`/squiggles/${a[0]}/send`, { text: a[1], from: 'lead' }),
  stop: () => call(`/squiggles/${a[0]}/stop`, {}),
  clear: () => call(`/squiggles/${a[0]}/clear`, {}),
  tail: async () => (await call(`/squiggles/${a[0]}/events?n=${a[1] || 60}`)).map(brief).filter(Boolean).join('\n'),
  journal: () => call(`/squiggles/${a[0]}/journal`),
  charter: async () => a[1] == null
    ? (await call('/squiggles')).find((s) => s.id === a[0])?.charter ?? `no squiggle ${a[0]}`
    : (await call(`/squiggles/${a[0]}/update`, { charter: a[1] }), `${a[0]}'s responsibility updated`),
  goals: async () => {
    const g = (await call('/board')).goals;
    return ['active', 'hold', 'todo', 'done'].map((t) => `${t.toUpperCase()}\n` + (g[t] || []).map((x) =>
      `  ${x.id}  ${x.title}${x.owner ? `  (owner ${x.owner})` : ''}${x.repos ? `  repos ${x.repos.join(' ')}` : ''}  merge ${x.merge}  confirmed ${x.last_confirmed}${x.note ? `  — ${x.note}` : ''}`).join('\n')).join('\n');
  },
  // goal add <title> [tier] [repos...] | goal repos <id> <repo...> | goal merge <id> gated|open | goal move <id> <active|hold|todo|done> | goal confirm <id> | goal owner <id> <squiggle> | goal edit <id> <title> | goal note <id> <text> | goal drop <id>
  goal: () => {
    const [op, x, y] = a;
    if (op === 'add') return call('/goals', { op, title: x, tier: y, repos: a.slice(3) });
    if (op === 'move') return call('/goals', { op, id: x, tier: y, ...(a[3] != null ? { index: Number(a[3]) } : {}) });
    if (op === 'owner') return call('/goals', { op: 'edit', id: x, owner: y || '' });
    if (op === 'note') return call('/goals', { op: 'edit', id: x, note: y || '' });
    if (op === 'repos') return call('/goals', { op: 'edit', id: x, repos: a.slice(2) });
    if (op === 'merge') return call('/goals', { op: 'edit', id: x, merge: y });
    if (op === 'edit') return call('/goals', { op, id: x, title: y });
    return call('/goals', { op, id: x });
  },
  tasks: async () => {
    const t = (await call('/board')).tasks.filter((x) => (x.kind !== 'suggestion' || x.decision === 'accepted') && (!a[0] || x.goal === a[0] || x.owner === a[0]));
    return t.filter((x) => x.status !== 'done' || a[0]).map((x) =>
      `${x.id}  ${x.status}  ${x.split ? '(needs splitting) ' : ''}${x.title}${x.parent ? `  (part of ${x.parent})` : ''}${x.goal ? `  [${x.goal}]` : ''}${x.owner ? `  @${x.owner}` : ''}${x.branch ? `  branch ${x.repo ? x.repo + ':' : ''}${x.branch}` : ''}${x.needs?.some((n) => !n.done) ? `  needs ${x.needs.filter((n) => !n.done).length} before merge` : ''}  confirmed ${x.confirmed}${x.note ? `  — ${x.note}` : ''}`).join('\n') || 'no tasks';
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
  // task needs <id> add "<what merging needs>" | done|undo|drop <n> | clear (also task edit <id> needs ...) |
  // task add <title> [goal] [owner] | task split <id> <subtask>... | task claim <id> [owner] | task release <id> | task edit <id> split true|false | task edit <id> parent <id> | task move <id> <todo|doing|blocked|done> [note] | task move <id> review [repo:]<branch> [note] | task edit <id> branch [repo:]<branch> | task confirm <id> | task edit <id> <field> <value> | task drop <id>
  task: () => {
    const [op, x, y, z] = a;
    if (op === 'add') return call('/tasks', { op, title: x, goal: y, owner: z, by: process.env.AGENTS_ID });
    if (op === 'move' && y === 'review') return call('/tasks', { op, id: x, status: y, branch: z, note: a[4] });
    if (op === 'move') return call('/tasks', { op, id: x, status: y, note: z });
    if (op === 'claim') return call('/tasks', { op: 'edit', id: x, owner: y || process.env.AGENTS_ID || '' });
    if (op === 'release') return call('/tasks', { op: 'edit', id: x, owner: '' });
    if (op === 'split') return call('/tasks', { op, id: x, titles: a.slice(2), by: process.env.AGENTS_ID });
    if (op === 'worktree') return call('/tasks', { op, id: x, ...(y ? { repo: y } : {}) }).then((t) => `${t.created ? 'created' : 'already there'}: ${t.path} on ${t.branch}`);
    if (op === 'needs' || (op === 'edit' && y === 'needs')) { const [act, v] = op === 'needs' ? [y, z] : [z, a[4]]; return call('/tasks', { op: 'needs', id: x, act, ...(/^\d+$/.test(v || '') ? { n: v } : { text: v }) }); }
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
    : (await call('/merges')).map((m) => m.error
    ? `${m.id}  ${m.title}  ${m.repo}:${m.branch}  — ${m.error}`
    : `${m.id}  ${m.title}  ${m.repo}:${m.branch}  ${m.ahead} ahead${m.behind ? `, ${m.behind} behind` : ''} of ${m.base}  ${m.age}d${m.stale ? ' STALE' : ''}${m.owner ? `  @${m.owner}` : ''}${m.result ? `  — ${m.result}` : '  — no test result'}${m.needs?.length ? m.needs.map((x, i) => `\n    needs ${i + 1}${x.done ? ' (done)' : ''}: ${x.t}`).join('') : ''}${m.desktop ? `\n    desktop: ${m.desktop}` : ''}${m.compare ? `\n    github: ${m.compare}` : ''}`).join('\n') || 'nothing in review',
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
    const r = await call('/merges', { op: 'merge', id: a[0], by: process.env.AGENTS_ID || 'owner' }); return `${r.id} merged into ${r.base} at ${r.sha}, branch ${r.branch} deleted, task done`;
  },
  // call <teams-url> [until <time>] | call status | call leave: the lead joins a Teams call through ~/claude-in-call
  call: async () => {
    if (a[0] === 'leave') return call('/call', { op: 'leave' });
    if (!a[0] || a[0] === 'status') { const c = await call('/call'); return c.live ? `in a call as ${c.name} since ${new Date(c.started).toLocaleTimeString()}${c.ends ? `, until ${c.ends.slice(11)}` : ''} (pid ${c.pid})\n${c.url}\n\n${(c.log || []).join('\n')}` : `not in a call${c.pid ? `\nlast call log:\n${(c.log || []).join('\n')}` : ''}`; }
    const until = a[1] === 'until' ? a.slice(2).join(' ') : a.slice(1).join(' ');
    const r = await call('/call', { op: 'join', url: a[0], ...(until ? { until } : {}) });
    return `joining as ${r.name} (pid ${r.pid})${r.ends ? `; leaves at ${r.ends.slice(11)} + 5 min` : ''}; call status to follow it, call leave to hang up`;
  },
  // screen diff <task> | url <url> | file <path> | off [--as <id>]: pin it on the shared screen beside your 1:1 (t664)
  screen: async () => {
    const i = a.indexOf('--as'), as = i >= 0 ? a.splice(i, 2)[1] : process.env.AGENTS_ID;
    if (!as) throw new Error('screen needs --as <id> outside a squiggle');
    const arg = a.slice(1).join(' '), r = await call(`/squiggles/${as}/screen`, { kind: a[0], arg: a[0] === 'file' && !/^[~/]/.test(arg) ? `${process.cwd()}/${arg}` : arg, by: process.env.AGENTS_ID || 'owner' });
    return r.kind === 'off' ? 'screen closed' : `on ${as}'s screen: ${r.title}`;
  },
  restart: () => call('/restart', {}),
  upgrade: async () => (await import('./upgrade.mjs')).upgrade(),
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
  limit: async () => { const l = await call('/limit'); return l.until ? `session limit: scheduled wakes paused until ${new Date(l.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'no session limit in effect'; },
  remove: () => call(`/squiggles/${a[0]}/remove`, {}),
  // room radio <fip|fipjazz|...|off> | room volume <0-1> | room voices on|off | room chatter quiet|normal|lively | room characters <generator> | room view room|lead|meeting|team|calendar|goals|tasks|merge | room view blocked|rethink | room view 1on1 <id> | room chat <id> ["<draft>"] | room lock
  room: () => call('/room', { action: a[0], value: a[1], ...(a[0] === 'chat' ? (a[2] ? { text: a.slice(2).join(' ') } : {}) : a[2] ? { id: a[2] } : {}) }),
  rename: () => call(`/squiggles/${a[0]}/update`, { name: a[1], ...(a[2] ? { role: a[2] } : {}) }),
  create: () => call('/squiggles', { id: a[0], name: a[1], role: a[2], cwd: a[3], every: a[4], charter: a[5] }),
  // look <id> [<generator>[:<options>]|<character>|auto|shuffle] (t832): the squiggle's character; auto follows the room default
  // (room characters <generator>); shuffle rerolls the seed. Options: a bare value or k=v,k=v, checked against ui/cast.js.
  look: async () => {
    if (a[1] === 'shuffle') return call(`/squiggles/${a[0]}/update`, { lookSeed: Math.floor(Math.random() * 1e9) });
    if (!a[1] || a[1] === 'auto') return call(`/squiggles/${a[0]}/update`, { look: '' });
    const vm = await import('node:vm'), { readFileSync } = await import('node:fs'), ctx = vm.createContext({});
    vm.runInContext(readFileSync(new URL('../ui/cast.js', import.meta.url), 'utf8'), ctx);
    const { gen, opts } = ctx.parseLook(a[1]), G = ctx.GENS[gen], want = a[1].split(':')[0].toLowerCase();
    const given = a[1].includes(':') ? a[1].slice(a[1].indexOf(':') + 1).split(',').filter(Boolean).length : 0;
    if (!G || (gen !== want && !opts.character) || Object.keys(opts).length < given) return `unknown look. generators: ${Object.keys(ctx.GENS).join(', ')}; cast characters: ${ctx.LOOKS.join(', ')}`;
    const first = Object.keys(G.options)[0], ks = Object.keys(opts);
    const o = ks.length === 1 && ks[0] === first ? opts[first] : ks.map((k) => `${k}=${opts[k]}`).join(',');
    return call(`/squiggles/${a[0]}/update`, { look: gen + (o ? ':' + o : '') });
  },
  set: () => {
    const v = a[2] === 'true' ? true : a[2] === 'false' ? false : /^\d+$/.test(a[2]) ? Number(a[2]) : a[2];
    return call(`/squiggles/${a[0]}/update`, { [a[1]]: v });
  },
};

if (!cmds[cmd]) {
  console.log('usage: agents.mjs list | team | wake <id> [why] | tell <id> <text> | stop <id> | clear <id> | remove <id> | room radio|volume|voices|chatter|characters|view|chat <value> | room view 1on1 <id> | room view blocked|rethink | room lock | room reload | call <teams-url> [until <time>] | call status | call leave | restart | upgrade | limit | inbox | screen diff <task>|url <url>|file <path>|off [--as <id>] | share on|off|status | humans | human add "<name>" [avatar] | human edit <id> name|avatar <value> | human remove <id> | tail <id> [n] | journal <id> | charter <id> [new text] | rename <id> <name> [role] | create <id> <name> <role> <cwd> <every> <charter> | set <id> <field> <value> | look <id> [<generator>[:<options>]|character|auto|shuffle] | goals | goal add|move|confirm|owner|note|repos|merge|edit|drop ... | tasks [goal|owner] | task add|move|confirm|edit|needs|drop ... | task needs <id> add "<text>"|done|undo|drop <n>|clear | task move <id> review [repo:]<branch> ["<test result>"] | meetings [days] [from YYYY-MM-DD] | meeting add "<title>" "<when>" <id,id> [once|daily|weekdays|weekly] ["<agenda>"] | meeting edit <id> <field> <value> | meeting cancel <id> [date] | meeting start <id> | meeting next | meeting end | meeting now | meet now <id,id> ["topic"] [--presenters <id,id>] | meet merges | merges [refresh] | worktrees [check] | task worktree <id> [repo] | suggest "<one line>" [evidence] | suggestions [all] | suggestion accept <id> <goal> <owner> | suggestion decline <id> "<why>" | merge <task> | merge diff <task> | merge back <task> "<note>"');
  process.exit(1);
}
try {
  const r = await cmds[cmd]();
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
