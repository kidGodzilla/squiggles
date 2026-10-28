// Needs you: everything waiting on the user in one list. Asks to run, picks to answer, merges a reviewer has shipped
// (no open before-merge steps, no conflicts), and squiggles whose last status was BLOCKED. Served at /api/needs;
// the phone shows it at the top of the Lead chat, the CLI prints it with `needs`.
export function needsList({ asks = [], picks = [], merges = [], squiggles = [] } = {}) {
  const out = [];
  for (const a of asks) out.push({ kind: 'ask', id: a.id, by: a.by, text: a.why || a.cmd, cwd: a.cwd, at: a.created });
  for (const p of picks) if (!p.status || p.status === 'open') out.push({ kind: 'pick', id: p.id, by: p.by, text: p.question, options: (p.options || []).map((o) => o.label), task: p.task, at: p.created });
  for (const m of merges) {
    if (m.error || !m.shipped?.length || (m.needs || []).some((x) => !x.done) || m.conflicts?.length) continue;
    out.push({ kind: 'merge', id: m.id, by: m.owner, text: m.title, repo: m.repo, branch: m.branch, base: m.base, shipped: m.shipped.map((x) => x.by), at: m.reviewed });
  }
  for (const s of squiggles) if (s.status === 'blocked' && !s.paused) out.push({ kind: 'blocked', id: s.id, by: s.id, text: s.note || 'Blocked' });
  return out;
}
const WORD = { ask: 'Run', pick: 'Pick', merge: 'Merge', blocked: 'Blocked' };
export const describeNeeds = (l) => l.length
  ? l.map((n) => `${WORD[n.kind]}  ${n.kind === 'blocked' ? n.id : `${n.id}  ${n.by}`}  ${String(n.text).split('\n')[0]}${n.options ? `  [${n.options.join(' | ')}]` : ''}${n.shipped ? `  (shipped by ${n.shipped.join(', ')})` : ''}`).join('\n')
  : 'nothing needs you';
