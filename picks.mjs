// Picks: a squiggle's question for the owner with fixed options, gathered in one card in the lead's chat instead of
// separate messages. The owner taps an option (or the lead relays their word: pick <id> <option>); the asker hears the answer.
// State in picks.json: open picks, and answered or dropped ones for a week.
import fs from 'node:fs';
import path from 'node:path';

const WEEK = 7 * 864e5, MAX_OPEN = 5, MAX_Q = 600, MAX_LABEL = 120, MAX_OPTIONS = 6;
const err = (m, code = 400) => Object.assign(new Error(m), { code });

export function createPicks({ file, now = () => Date.now() }) {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { n: 0, picks: [] }; } };
  const save = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); s.picks = s.picks.filter((p) => p.status === 'open' || now() - p.ended < WEEK); fs.writeFileSync(file, JSON.stringify(s, null, 1)); };
  const find = (s, id) => s.picks.find((p) => p.id === id) || (() => { throw err(`no pick ${id}`, 404); })();

  function ask({ by, question, options, task }) {
    question = String(question || '').trim(); by = String(by || '').trim();
    if (!by) throw err('a pick needs the squiggle asking');
    if (!question || question.length > MAX_Q) throw err(`question: 1 to ${MAX_Q} characters`);
    options = (options || []).map((o) => (typeof o === 'string' ? { label: o } : o)).map((o) => ({ label: String(o.label || '').trim(), ...(o.image && { image: String(o.image) }) }));
    if (options.length < 2 || options.length > MAX_OPTIONS) throw err(`2 to ${MAX_OPTIONS} options`);
    if (options.some((o) => !o.label || o.label.length > MAX_LABEL)) throw err(`each option: 1 to ${MAX_LABEL} characters`);
    if (new Set(options.map((o) => o.label.toLowerCase())).size < options.length) throw err('options must differ');
    if (options.some((o) => o.image && !path.isAbsolute(o.image))) throw err('option images: absolute paths');
    const s = load();
    if (s.picks.filter((p) => p.status === 'open' && p.by === by).length >= MAX_OPEN) throw err(`${by} already has ${MAX_OPEN} open picks: wait for an answer or drop one`);
    const p = { id: `p${++s.n}`, by, question, options, ...(task && { task: String(task) }), status: 'open', created: now() };
    s.picks.push(p); save(s); return p;
  }
  // An option by its number (1 = first) or its label, any case.
  function pick(id, option, { by = 'owner' } = {}) {
    const s = load(), p = find(s, String(id));
    if (p.status !== 'open') throw err(`${p.id} is already ${p.status}`, 409);
    const o = String(option ?? '').trim(), n = /^\d+$/.test(o) ? p.options[+o - 1] : p.options.find((x) => x.label.toLowerCase() === o.toLowerCase());
    if (!n) throw err(`options for ${p.id}: ${p.options.map((x, i) => `${i + 1} ${x.label}`).join(', ')}`);
    Object.assign(p, { status: 'picked', answer: n.label, pickedBy: by, ended: now() }); save(s); return p;
  }
  function drop(id, { by }) {
    const s = load(), p = find(s, String(id));
    if (p.status !== 'open') throw err(`${p.id} is already ${p.status}`, 409);
    Object.assign(p, { status: 'dropped', droppedBy: by, ended: now() }); save(s); return p;
  }
  const list = ({ all = false } = {}) => load().picks.filter((p) => all || p.status === 'open');
  return { ask, pick, drop, list };
}

export const describePicks = (ps) => ps.length ? ps.map((p) => `${p.id}  ${p.by}  ${p.status === 'open' ? '' : `${p.status}${p.answer ? `: ${p.answer}` : ''}  `}${p.question}${p.task ? `  (${p.task})` : ''}\n${p.options.map((o, i) => `    ${i + 1}. ${o.label}${o.image ? `  ${o.image}` : ''}`).join('\n')}`).join('\n') : 'no picks waiting';
