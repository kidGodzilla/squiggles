// Squiggles: a room of squiggles. Each squiggle is a standing role with a charter and a journal,
// run as a long-lived `claude -p` stream-json process. The lead is the only one the user talks to.
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createBoard } from './board.mjs';
import { modelFor as pickModel, DEFAULT_MODELS, EFFORTS, checkModelEffort } from './models.mjs';
import { createMeetings, local, markPast, meetingNotes, parseWhen } from './meetings.mjs';
import { createInbox } from './inbox.mjs';
import { createHumans } from './humans.mjs';
import { dataDir, loadConfig } from './config.mjs';
import { migrate } from './migrate.mjs';
import { createSchedule } from './schedule.mjs';
import { makeGuard, tailnetName } from './guard.mjs';

const home = (p) => String(p || '').replace(/^~(?=\/|$)/, os.homedir());
// Code (ROOT) is written by git only; the room lives in DATA. See docs/upgrading.md.
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DATA = dataDir();
try { const m = await migrate(DATA); if (m) console.log(`Migrated data schema ${m.from} to ${m.to}; backup in ${m.backup}`); } catch (e) { console.error(e.message); process.exit(1); }
const CONFIG = loadConfig(DATA);
const PORT = CONFIG.port;
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const USER = CONFIG.userName || 'the user', User = CONFIG.userName || 'The user';
const SQ = path.join(DATA, 'squiggles');
const RUNS = path.join(DATA, 'runs');
const MEDIA = path.join(RUNS, 'media');
const FILES = path.join(DATA, 'files'); // chat images land here
const STATE = path.join(RUNS, 'state.json');
const TTS_DIR = path.join(RUNS, 'tts');
for (const d of [SQ, RUNS, MEDIA, TTS_DIR]) fs.mkdirSync(d, { recursive: true });

const kokoro = createRequire(import.meta.url)('./voice/kokoro.cjs');
const now = () => new Date().toISOString();
const readText = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };

// ---------- squiggles on disk ----------
const sqDir = (id) => path.join(SQ, id);
// squiggle.json is edited outside the server too; a read caught mid-write falls back to the last good copy,
// so a squiggle never drops out of the list (t671). Removal moves the directory, which drops it for real.
const lastMeta = new Map();
function loadSquiggle(id) {
  let meta = null;
  try { meta = JSON.parse(readText(path.join(sqDir(id), 'squiggle.json'), 'null')); } catch {}
  if (meta) lastMeta.set(id, meta); else if (fs.existsSync(sqDir(id))) meta = lastMeta.get(id) || null;
  return meta && { ...meta, id };
}
function listSquiggles() {
  return fs.readdirSync(SQ).filter((d) => fs.existsSync(path.join(SQ, d, 'squiggle.json')) || lastMeta.has(d)).map(loadSquiggle).filter(Boolean);
}
function saveSquiggle(s) {
  const { id, ...meta } = s;
  fs.mkdirSync(sqDir(id), { recursive: true });
  fs.writeFileSync(path.join(sqDir(id), 'squiggle.json'), JSON.stringify(meta, null, 2) + '\n');
}
const ROOMCFG = path.join(DATA, 'room.json');
const roomCfg = () => { try { return JSON.parse(fs.readFileSync(ROOMCFG, 'utf8')); } catch { return {}; } };
// Team defaults (t898): model, effort and cadence a new squiggle starts with; room.json `defaults`, set from Settings or `defaults`.
const DEFAULT_OPTS = { model: DEFAULT_MODELS, effort: EFFORTS };
const teamDefaults = () => ({ model: '', effort: '', every: 60, ...(roomCfg().defaults || {}) });
function setDefaults(b) {
  const d = teamDefaults(), bad = Object.keys(b).filter((k) => !['model', 'effort', 'every'].includes(k));
  if (bad.length) throw new Error(`defaults: model, effort or every (not ${bad.join(', ')})`);
  for (const k of ['model', 'effort']) if (b[k] != null) { const v = String(b[k]); if (!DEFAULT_OPTS[k].includes(v)) throw new Error(`${k}: one of ${DEFAULT_OPTS[k].map((x) => x || 'default').join(', ')}`); d[k] = v; }
  if (b.every != null) { const v = b.every === '' ? NaN : Number(b.every); if (!Number.isInteger(v) || v < 0) throw new Error('every: whole minutes, 0 = only when asked'); d.every = v; }
  fs.writeFileSync(ROOMCFG, JSON.stringify({ ...roomCfg(), defaults: d }, null, 2) + '\n'); return d;
}
function createSquiggle({ id, name, role, cwd, charter, every, permissionMode = 'auto', model }) {
  id = String(id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || fs.existsSync(sqDir(id))) throw new Error('name taken or empty');
  checkModelEffort({ model }); const d = teamDefaults();
  saveSquiggle({ id, name, role, cwd: cwd || '~', every: every == null || every === '' ? d.every : Number(every) || 0, permissionMode, model: model || d.model || undefined, effort: d.effort || undefined, paused: false, created: now() });
  fs.writeFileSync(path.join(sqDir(id), 'charter.md'), (charter || role || '').trim() + '\n');
  fs.writeFileSync(path.join(sqDir(id), 'journal.md'), `# ${name} journal\n`);
  return loadSquiggle(id);
}

// ---------- runtime state ----------
// id -> { status, sessionId, lastWake, lastEnd, note, proc }
const rt = new Map();
const persisted = JSON.parse(readText(STATE, '{}'));
const R = (id) => {
  if (!rt.has(id)) rt.set(id, { status: 'idle', ...(persisted[id] || {}), proc: null });
  const r = rt.get(id);
  if (r.status === 'working' && !r.proc) r.status = 'idle';
  return r;
};
function saveState() {
  const out = {};
  for (const [id, { proc, caff, cx, cxThread, cxLast, sig, subs, ...r }] of rt) out[id] = r;
  if (persisted['*limit']) { const { timer, ...l } = persisted['*limit']; out['*limit'] = l; }
  for (const k of ['*meeting', '*started', '*held', '*warned', '*plimit']) if (persisted[k]) out[k] = persisted[k];
  fs.writeFileSync(STATE, JSON.stringify(out, null, 2));
}

// ---------- events ----------
const clients = new Set();
// `stored` is what goes in runs/<id>.jsonl when it shouldn't be the whole event (screen content: t854).
function emit(id, ev, stored) {
  ev = { ts: Date.now(), ...ev };
  fs.appendFileSync(path.join(RUNS, `${id}.jsonl`), JSON.stringify(stored ? { ts: ev.ts, ...stored } : ev) + '\n');
  const line = `data: ${JSON.stringify({ id, ev })}\n\n`;
  for (const res of clients) res.write(line);
}
const board = createBoard(DATA, () => {
  const line = `data: ${JSON.stringify({ id: '*board', ev: { k: 'board' } })}\n\n`;
  for (const res of clients) res.write(line);
});
const meetings = createMeetings(DATA, () => {
  const line = `data: ${JSON.stringify({ id: '*board', ev: { k: 'meetings' } })}\n\n`;
  for (const res of clients) res.write(line);
}, { isSquiggle: (id) => !!loadSquiggle(id) });
const humans = createHumans(DATA, () => {
  const line = `data: ${JSON.stringify({ id: '*board', ev: { k: 'humans' } })}\n\n`;
  for (const res of clients) res.write(line);
}, { ownerName: CONFIG.userName || 'You' });
// Awake squiggles (t294): while one with awake: true is working, caffeinate keeps the display on and the Mac from idle sleep or locking.
// -w ties it to this server, so a crash can't leave the Mac awake for good.
function keepAwake(id, on) {
  const r = R(id);
  if (on && !r.caff) { const c = r.caff = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' }); c.on('exit', () => { if (r.caff === c) r.caff = null; }); }
  if (!on && r.caff) { r.caff.kill(); r.caff = null; }
}
function setStatus(id, status, note) {
  const r = R(id);
  keepAwake(id, status === 'working' && !!loadSquiggle(id)?.awake);
  r.status = status;
  if (note !== undefined) r.note = note;
  saveState();
  emit(id, { k: 'state', status, note: r.note || '' });
}

// Subagents (t4): live while a squiggle's Agent call runs; the page shows each as a temporary tile.
function subStart(id, ev) {
  const r = R(id), sub = (r.subs ||= {})[ev.task_id] = { desc: ev.description || '', type: ev.subagent_type || '', at: Date.now() };
  emit(id, { k: 'sub', task: ev.task_id, ...sub });
}
function subEnd(id, task, status) {
  const r = R(id);
  if (!r.subs?.[task]) return;
  delete r.subs[task];
  emit(id, { k: 'sub', task, end: status || 'completed' });
}

const kindOf = (name) => ({ Bash: 'cmd', Read: 'read', Edit: 'edit', MultiEdit: 'edit', Write: 'write', Grep: 'search', Glob: 'search', TodoWrite: 'todo', WebFetch: 'web', WebSearch: 'web' })[name] || 'tool';
function toolEvent(c) {
  const i = c.input || {}, k = kindOf(c.name);
  const ev = { k: 'tool', tid: c.id, name: c.name, kind: k };
  if (k === 'cmd') Object.assign(ev, { text: i.command, note: i.description });
  else if (k === 'read' || k === 'write' || k === 'edit') Object.assign(ev, { file: i.file_path, old: i.old_string ?? i.edits?.[0]?.old_string, new: i.new_string ?? i.edits?.[0]?.new_string, text: i.content });
  else if (k === 'todo') ev.items = (i.todos || []).map((t) => ({ s: t.status, c: t.content }));
  else ev.arg = JSON.stringify(i).slice(0, 300);
  for (const f of ['text', 'old', 'new']) if (typeof ev[f] === 'string') ev[f] = ev[f].slice(0, 4000);
  return ev;
}
function resultEvent(c) {
  const parts = Array.isArray(c.content) ? c.content : [{ type: 'text', text: String(c.content ?? '') }];
  const imgs = [];
  for (const p of parts) {
    if (p.type !== 'image' || !p.source?.data) continue;
    const f = `${c.tool_use_id}-${imgs.length}.png`;
    fs.writeFileSync(path.join(MEDIA, f), Buffer.from(p.source.data, 'base64'));
    imgs.push(`/media/${f}`);
  }
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return { k: 'out', tid: c.tool_use_id, text: text.slice(0, 6000), err: !!c.is_error, imgs };
}
const statusLine = (text) => {
  const m = /^\s*(DONE|IDLE|BLOCKED|RETHINK):\s*(.*)$/im.exec(text || '');
  return m ? { status: m[1].toLowerCase(), note: m[2].trim() } : null;
};

// ---------- processes ----------
const TEAM = () => listSquiggles().map((s) => `- ${s.id}: ${s.name}, ${s.role}`).join('\n');
// Prompt placeholders: {{user}} / {{User}} (config.userName, else "the user"), {{cli}}, {{data}}.
const fillPrompt = (t) => t.replace(/\{\{(user|User|cli|data)\}\}/g, (_, k) => ({
  user: CONFIG.userName || 'the user', User: CONFIG.userName || 'The user', cli: `node ${ROOT}/bin/agents.mjs`, data: DATA,
})[k]);
// Prompt seams: <data>/prompts/<name>.md replaces the shipped one (frozen; upgrade warns), <name>.append.md is added after it.
const prompt = (name) => fillPrompt([readText(path.join(DATA, 'prompts', name)) || readText(path.join(ROOT, 'prompts', name)),
  readText(path.join(DATA, 'prompts', name.replace(/\.md$/, '.append.md')))].filter((t) => t.trim()).join('\n\n'));
// First run: the room starts with only the lead, whose charter onboards the user.
if (!listSquiggles().length) {
  createSquiggle({ id: 'lead', name: 'Lead', role: 'Runs the team', cwd: '~', every: 0, charter: prompt('lead-charter.md') });
  saveSquiggle({ ...loadSquiggle('lead'), lead: true });
}
function systemPrompt(s) {
  const dir = sqDir(s.id);
  const base = prompt(s.lead ? 'lead.md' : 'squiggle.md');
  return `${base}\n\nYou are ${s.name} (id: ${s.id}). Your role: ${s.role}.\nCharter: ${dir}/charter.md\nJournal: ${dir}/journal.md\nHarness CLI: node ${ROOT}/bin/agents.mjs\n\nThe team:\n${TEAM()}`;
}
// Always pass a model: unset would inherit the CLI default, which may be Fable; squiggles never run on Fable.
// Sonnet is the floor (Haiku has no auto mode); Opus is the default and the ceiling. config.model sets the default.
const modelFor = (s) => pickModel(s, CONFIG.model);
// Settings baked into a process's flags. A change ends the idle process before the next turn; --resume keeps the session.
const launchSig = (s) => JSON.stringify([!!s.chrome, modelFor(s), s.permissionMode, s.autocompact, s.maxTurns, s.effort, s.cwd]);
function launch(s) {
  const r = R(s.id); r.sig = launchSig(s);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt', systemPrompt(s), '--permission-mode', s.permissionMode || 'auto', '--permission-prompts', 'none',
    '--add-dir', sqDir(s.id), '--add-dir', DATA, '--add-dir', os.homedir(),
    // Squiggles roam the home folder freely, except these.
    '--disallowedTools', ...['Downloads', 'Desktop', 'Documents'].flatMap((d) => [`Read(~/${d}/**)`, `Edit(~/${d}/**)`, `Write(~/${d}/**)`])];
  if (s.chrome) args.push('--chrome');
  if (modelFor(s)) args.push('--model', modelFor(s));
  // Usage controls (per squiggle, see handoff): context window cap, effort, and a turn cap per wake.
  args.push('--autocompact', String(s.autocompact ?? (s.lead ? 300000 : 200000)), '--max-turns', String(s.maxTurns ?? 40));
  const effort = s.effort ?? (s.lead ? '' : 'medium'); if (effort) args.push('--effort', effort);
  const cli = `node ${ROOT}/bin/agents.mjs`;
  if (s.lead) args.push('--allowedTools', `Bash(${cli} *)`, 'Read', 'Grep', 'Glob', `Edit(${SQ}/**)`, `Write(${SQ}/**)`, `Edit(${DATA}/goals.json)`, `Edit(${DATA}/config.json)`);
  // A squiggle may see the team and rewrite its own responsibility and journal, nobody else's.
  else args.push('--allowedTools', `Bash(${cli} list)`, `Bash(${cli} charter ${s.id} *)`, `Bash(${cli} charter ${s.id})`, `Edit(${sqDir(s.id)}/journal.md)`,
    `Bash(${cli} tasks*)`, `Bash(${cli} task *)`, `Bash(${cli} goals)`, `Bash(${cli} restart)`, `Bash(${cli} room reload)`);
  const settings = path.join(sqDir(s.id), 'settings.json');
  if (fs.existsSync(settings)) args.push('--settings', settings);
  if (r.sessionId) args.push('--resume', r.sessionId);

  const proc = spawn('claude', args, { cwd: home(s.cwd), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTS_ID: s.id } });
  r.proc = proc;
  let buf = '', lastText = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'system' && ev.subtype === 'init') { r.sessionId = ev.session_id; saveState(); }
      else if (ev.type === 'system' && ev.subtype === 'task_started' && ev.task_type === 'local_agent') subStart(s.id, ev);
      else if (ev.type === 'system' && (ev.subtype === 'task_notification' || (ev.subtype === 'task_updated' && /^(completed|failed|killed|stopped)$/.test(ev.patch?.status || '')))) subEnd(s.id, ev.task_id, ev.status || ev.patch?.status);
      else if (ev.type === 'assistant') {
        // Turn budget: count assistant messages this wake; four before the cap, tell the squiggle to wrap up.
        if (ev.message.id !== r.msgId) {
          r.msgId = ev.message.id; r.turns = (r.turns || 0) + 1;
          const cap = s.maxTurns ?? 40;
          if (r.turns === cap - 4 && !s.lead) {
            const warn = '4 turns left. Stop investigating. Journal what you found, update or file your board task, and end with a status line.';
            emit(s.id, { k: 'user', text: warn, from: 'harness' });
            proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: warn } }) + '\n');
          }
        }
        for (const c of ev.message.content || []) {
          if (c.type === 'text' && c.text.trim()) { lastText = c.text; emit(s.id, { k: 'say', text: c.text }); }
          else if (c.type === 'tool_use') emit(s.id, toolEvent(c));
        }
      } else if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
        for (const c of ev.message.content) if (c.type === 'tool_result') emit(s.id, resultEvent(c));
      } else if (ev.type === 'rate_limit_event') { emit(s.id, { k: 'rate', info: ev.rate_limit_info }); if (ev.rate_limit_info?.status === 'rejected' && ev.rate_limit_info.resetsAt) limitHit(ev.rate_limit_info.resetsAt * 1000); }
      else if (ev.type === 'result') { turnEnded(s, ev.result || lastText, ev.is_error, ev.subtype); if (ev.subtype === 'error_max_turns') { r.proc?.kill('SIGTERM'); } }
    }
  });
  proc.stderr.on('data', (d) => emit(s.id, { k: 'log', text: String(d).slice(0, 2000) }));
  proc.on('exit', (code) => {
    if (r.proc !== proc) return; // replaced by a relaunch
    r.proc = null;
    for (const t of Object.keys(r.subs || {})) subEnd(s.id, t, 'stopped');
    if (r.status === 'working') setStatus(s.id, code ? 'error' : 'idle', code ? `exited ${code}` : '');
  });
  return proc;
}

// ---------- other providers (t165) ----------
// Whitelist in code, not in squiggle.json: the model picks the provider, anything unlisted runs on Claude (modelFor).
const PROVIDERS = { codex: ['gpt-6.1-sol'] };
const providerOf = (s) => (CONFIG.codex && Object.keys(PROVIDERS).find((p) => PROVIDERS[p].includes(s.model))) || '';
// Each provider has its own usage limit; hitting one pauses only its squiggles' wakes.
const plimit = persisted['*plimit'] ||= {};
function providerLimit(p, msg) {
  const t = /\bin\s+(?=\d)(?:(\d+)\s*h\w*\s*)?(?:(\d+)\s*m\w*)?/i.exec(msg), at = parseReset(`session limit resets ${/\bat\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i.exec(msg)?.[1] || ''}`);
  // Codex weekly limits name a date: "try again at Oct 22nd, 2026 1:59 PM".
  const day = /\bat\s+([a-z]{3,9}\s+\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\s+(\d{1,2}:\d{2}\s*[ap]m)/i.exec(msg), dated = day ? Date.parse(`${day[1]}, ${day[2]} ${day[3]}`) || 0 : 0;
  const until = dated || at || Date.now() + ((Number(t?.[1]) || 0) * 60 + (Number(t?.[2]) || 0) || 60) * 60000;
  plimit[p] = until + 5 * 60000; saveState();
  inbox.push(`[Harness · LIMIT] ${p} usage limit hit; its squiggles' wakes paused until ${hhmm(plimit[p])}.`);
  return plimit[p];
}
// Codex: one `codex app-server` per squiggle, kept between turns, so MCP servers live on (computer use
// keeps its window bindings, t330). Each wake is a turn on the saved thread; messages mid-turn steer it.
const shortEv = (s) => (typeof s === 'string' ? s.slice(0, 6000) : '');
// The ChatGPT app bundles a newer Codex CLI than ~/.local/bin; older CLIs reject current models on ChatGPT sign-in.
const CODEX_APP_BIN = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const codexBin = () => process.env.CODEX_BIN || (fs.existsSync(CODEX_APP_BIN) ? CODEX_APP_BIN : 'codex');
// "Selected model is at capacity" is transient: wait, then resume the thread (3, 6, 12 minutes); a fourth failure is an error.
function capacityRetry(s) {
  const r = R(s.id), n = r.capTries = (r.capTries || 0) + 1, min = 3 * 2 ** (n - 1);
  r.capAt = Date.now() + min * 60000;
  setTimeout(() => { if (!r.proc && r.status === 'waiting') send(s.id, 'The model was at capacity and your last turn stopped. Carry on where you left off.', 'harness'); }, min * 60000);
}
function codexServer(s) {
  const r = R(s.id);
  if (r.cx) return r.cx;
  const roots = [sqDir(s.id)];
  // workspace-write keeps .git read-only; the repo's git dir must be a writable root or the squiggle can't commit.
  try { roots.push(execFileSync('git', ['-C', home(s.cwd), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
  const proc = spawn(codexBin(), ['app-server', '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"',
    // The agents CLI talks to this server over HTTP; the journal lives in the squiggle's folder.
    '-c', 'sandbox_workspace_write.network_access=true', '-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`],
  { cwd: home(s.cwd), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTS_ID: s.id } });
  const cx = r.cx = { proc, n: 0, wait: new Map(), on: null };
  cx.req = (method, params) => new Promise((res, rej) => { const id = ++cx.n; cx.wait.set(id, { res, rej }); proc.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && !m.method) { const w = cx.wait.get(m.id); cx.wait.delete(m.id); if (w) m.error ? w.rej(new Error(m.error.message || 'codex error')) : w.res(m.result); }
      else if (m.id != null) proc.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'not supported by squiggles' } }) + '\n');
      else cx.on?.(m.method, m.params || {});
    }
  });
  proc.stderr.on('data', (d) => emit(s.id, { k: 'log', text: String(d).slice(0, 2000) }));
  proc.on('exit', () => {
    if (r.cx === cx) r.cx = null;
    for (const w of cx.wait.values()) w.rej(new Error('codex app-server exited'));
    cx.on?.('exit', {});
  });
  cx.ready = cx.req('initialize', { clientInfo: { name: 'squiggles', version: '1' } })
    .then(() => proc.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n'));
  return cx;
}
async function codexTurn(s, prompt, images = []) {
  const r = R(s.id), cx = codexServer(s), cap = s.maxTurns ?? 40;
  let lastText = '', ended = false, turnId = null;
  const end = (text, err, subtype) => {
    if (ended) return; ended = true; cx.on = null; r.proc = null; turnEnded(s, text, err, subtype);
    if (r.queue?.length) { const q = r.queue.splice(0); saveState(); send(s.id, q.join('\n\n'), 'harness', { replay: true }); }
  };
  // r.proc stands for the running turn: stop interrupts it, remove and shutdown end the server too.
  const interrupt = () => { if (r.codexThread && turnId) cx.req('turn/interrupt', { threadId: r.codexThread, turnId }).catch(() => {}); };
  r.proc = { kill: () => interrupt(), removeAllListeners() {}, steer: (text) => (turnId ? cx.req('turn/steer', { threadId: r.codexThread, expectedTurnId: turnId, input: [{ type: 'text', text }] }) : Promise.reject(new Error('no turn yet'))) };
  cx.on = (method, p) => {
    const it = p.item || {};
    if (method === 'exit') return end(lastText || 'codex stopped', true);
    if (method === 'item/started' && it.type === 'commandExecution') emit(s.id, { k: 'tool', tid: it.id, name: 'Bash', kind: 'cmd', text: shortEv(it.command) });
    else if (method === 'item/completed') {
      if (it.type === 'agentMessage' && it.text?.trim()) { lastText = it.text; emit(s.id, { k: 'say', text: it.text }); }
      else if (it.type === 'commandExecution') emit(s.id, { k: 'out', tid: it.id, text: shortEv(it.aggregatedOutput), err: it.exitCode !== 0, imgs: [] });
      else if (it.type === 'fileChange') for (const c of it.changes || []) emit(s.id, { k: 'tool', tid: `${it.id}-${c.path}`, name: 'Edit', kind: c.kind?.type === 'add' ? 'write' : 'edit', file: c.path });
      else if (it.type === 'plan') emit(s.id, { k: 'tool', tid: it.id, name: 'TodoWrite', kind: 'todo', items: [{ s: 'pending', c: shortEv(it.text) }] });
      else if (it.type === 'webSearch') emit(s.id, { k: 'tool', tid: it.id, name: 'WebSearch', kind: 'web', arg: shortEv(it.query) });
      else if (it.type === 'mcpToolCall') emit(s.id, { k: 'tool', tid: it.id, name: `${it.server}.${it.tool}`, kind: 'tool', arg: JSON.stringify(it.arguments ?? '').slice(0, 300) });
      if (!['reasoning', 'userMessage'].includes(it.type) && ++r.turns >= cap) { interrupt(); end(lastText, true, 'error_max_turns'); }
    } else if (method === 'thread/tokenUsage/updated') {
      const u = r.cxLast = p.tokenUsage?.last || {}; r.usage = { in: (r.usage?.in || 0) + (u.inputTokens || 0), out: (r.usage?.out || 0) + (u.outputTokens || 0) };
    } else if (method === 'error' && !p.willRetry) emit(s.id, { k: 'log', text: shortEv(p.error?.message) });
    else if (method === 'turn/completed') {
      const t = p.turn || {};
      if (t.status === 'completed') {
        r.capTries = 0; const u = r.cxLast || {};
        emit(s.id, { k: 'log', text: `codex tokens: ${u.inputTokens || 0} in (${u.cachedInputTokens || 0} cached), ${u.outputTokens || 0} out` });
        return end(lastText, false);
      }
      if (t.status === 'interrupted') return end(lastText, true, 'interrupted');
      const msg = t.error?.message || 'codex failed';
      emit(s.id, { k: 'log', text: shortEv(msg) });
      if (/usage limit|rate limit|quota/i.test(msg)) { providerLimit('codex', msg); end(msg, true, 'provider_limit'); }
      else if (/at capacity/i.test(msg)) { if ((r.capTries || 0) < 3) { capacityRetry(s); end(msg, true, 'capacity'); } else { r.capTries = 0; end(msg, true); } }
      else end(msg, true);
    }
  };
  try {
    await cx.ready;
    if (!r.cxThread || r.cxThread !== cx) {
      // First turn on this server: resume the saved thread, or start one with the squiggle's instructions leading the prompt.
      const thread = r.codexThread || s.resume, opts = { cwd: home(s.cwd), model: s.model, sandbox: 'workspace-write', approvalPolicy: 'never' };
      // excludeTurns: hydrating a long thread's full history takes minutes and gigabytes.
      const res = thread ? await cx.req('thread/resume', { threadId: thread, excludeTurns: true, ...opts }) : await cx.req('thread/start', opts);
      r.codexThread = res.thread.id; r.cxThread = cx; saveState();
    }
    if (!r.codexPrimed) prompt = `${systemPrompt(s)}\n\n---\n\n${prompt}`;
    r.codexPrimed = true;
    turnId = (await cx.req('turn/start', { threadId: r.codexThread, model: s.model, input: [{ type: 'text', text: prompt }, ...images.map((f) => ({ type: 'localImage', path: path.join(FILES, f) }))] })).turn.id;
    if (ended) interrupt();
  } catch (e) { emit(s.id, { k: 'log', text: shortEv(e.message) }); end(e.message, true); }
}
// from 'owner' means a person on the page; human says which one (humans.json), and the squiggle reads 'From <name>: '.
function send(id, text, from = 'owner', { replay = false, human, images = [] } = {}) {
  const s = loadSquiggle(id);
  if (!s) throw new Error(`no squiggle ${id}`);
  const r = R(id);
  // A pending restart waits for everyone to be idle; new turns would starve it (a report wakes the lead, the lead wakes someone).
  // So a turn that would start now is held in state and sent after the restart. Messages to a squiggle mid-turn still go through.
  if (restartPending && r.status !== 'working') {
    r.lastWake = now(); (persisted['*held'] ||= []).push({ id, text, from, human, images }); saveState();
    emit(id, { k: 'user', text, from, ...(human && { human }), ...(images.length && { imgs: images.map((f) => `/files/${f}`) }) }); emit(id, { k: 'log', text: 'held until the restart' });
    setTimeout(maybeRestart, 500); return;
  }
  const who = from === 'owner' && (humans.all().find((h) => h.id === (human || 'owner')) || { id: human, name: human });
  const content = (who ? `From ${who.name}: ${text}` : text) + (images.length ? `\n\n(Attached: ${images.map((f) => path.join(FILES, f)).join(', ')})` : '');
  const shown = { k: 'user', text, from, ...(who && { human: who.id }), ...(images.length && { imgs: images.map((f) => `/files/${f}`) }) };
  if (providerOf(s)) {
    if (!replay) emit(id, shown);
    if (r.proc) {
      // Mid-turn: steer the running turn; if it can't take input yet, the message waits for the next turn.
      const queue = () => { (r.queue ||= []).push(content); saveState(); emit(id, { k: 'log', text: 'queued for the next turn' }); };
      if (r.proc.steer) r.proc.steer(content).catch(queue); else queue();
      return;
    }
    r.lastWake = now(); r.turns = 0; r.board0 = ownNotes(id);
    setStatus(id, 'working', '');
    return codexTurn(s, content, images);
  }
  if (r.proc && r.status !== 'working' && r.sig !== launchSig(s)) { const old = r.proc; r.proc = null; old.kill('SIGTERM'); emit(id, { k: 'log', text: 'settings changed: relaunching' }); }
  if (!r.proc) launch(s);
  r.lastWake = now(); r.turns = 0; r.board0 = ownNotes(id);
  if (!replay) emit(id, shown);
  setStatus(id, 'working', '');
  r.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: images.length ? [{ type: 'text', text: content }, ...images.map(imageBlock).filter(Boolean)] : content } }) + '\n');
}
// Chat images (t169): the page or CLI sends data URLs; each is saved under files/ and sent to the squiggle as an image block.
function saveImage(url) {
  const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!m) throw new Error('images must be png, jpeg, gif or webp data URLs');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 20e6) throw new Error('image over 20 MB');
  fs.mkdirSync(FILES, { recursive: true });
  const f = `chat-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 6)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(FILES, f), buf);
  return f;
}
// Claude takes up to 5 MB per image; bigger ones go by path only (the text names it).
function imageBlock(f) {
  const buf = fs.readFileSync(path.join(FILES, f)), ext = path.extname(f).slice(1);
  if (buf.length > 5e6) return null;
  return { type: 'image', source: { type: 'base64', media_type: `image/${ext === 'jpg' ? 'jpeg' : ext}`, data: buf.toString('base64') } };
}

// @mentions in a chat (t657): "@lead" or "@<id or name>" in a message to one squiggle also goes to the mentioned one,
// with the chat's last few lines; its reply at the end of that turn is posted back into the original chat.
function relayMentions(id, text, from, human) {
  const s = loadSquiggle(id), all = listSquiggles(), lead = all.find((x) => x.lead);
  const find = (w) => (w === 'lead' ? lead : all.find((x) => x.id === w || x.name.toLowerCase() === w));
  const ids = [...new Set([...String(text || '').matchAll(/@([\w-]+)/g)].map((m) => find(m[1].toLowerCase())?.id).filter((m) => m && m !== id && m !== from))];
  if (!ids.length) return;
  const hn = humans.all().find((h) => h.id === (human || 'owner'))?.name;
  const who = from === 'owner' ? (hn && hn !== 'You' ? hn : USER) : loadSquiggle(from)?.name || from, Who = who[0].toUpperCase() + who.slice(1);
  const recent = tailEvents(id, 80).filter((e) => (e.k === 'user' && e.from !== 'harness') || e.k === 'say').slice(-7, -1)
    .map((e) => `${e.k === 'say' ? (e.by ? loadSquiggle(e.by)?.name || e.by : s.name) : e.from === 'owner' ? User : e.from}: ${e.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  for (const m of ids) {
    const r = R(m); (r.relay ||= []).push(id); saveState();
    send(m, `${Who} mentioned you in their chat with ${s.name}.${recent ? `\n\nRecent lines:\n${recent}` : ''}\n\n${Who}: ${text}\n\nReply to ${who} in plain words. Your reply at the end of this turn is posted in that chat.`, 'mention');
  }
}

// Shared screen in a 1:1 (t664): what a squiggle pins beside its chat until it (or the user) closes it or pins something else.
// diff <task> from the merge queue, url <http(s) page> in a frame, file <path> (text, or an image), off.
const SCREEN_MAX = 400000, IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const liveScreen = new Map();
function screen(id, { kind, arg, by } = {}) {
  let ev;
  if (kind === 'off') ev = { k: 'screen', kind: 'off' };
  else if (kind === 'diff') { const d = board.mergeDiff(String(arg || '')); ev = { k: 'screen', kind, title: `${d.id} · ${path.basename(d.repo)}:${d.branch}`, stat: d.stat, text: d.diff.slice(0, SCREEN_MAX), cut: d.diff.length > SCREEN_MAX }; }
  else if (kind === 'url') { const u = new URL(String(arg || '')); if (!/^https?:$/.test(u.protocol)) throw new Error('url must be http or https'); ev = { k: 'screen', kind, title: u.href, url: u.href }; }
  else if (kind === 'file') {
    const f = path.resolve(home(String(arg || ''))), ext = path.extname(f).toLowerCase(), st = fs.statSync(f);
    if (!st.isFile()) throw new Error('not a regular file');
    if (IMG[ext]) { if (st.size > 5e6) throw new Error('image over 5 MB'); ev = { k: 'screen', kind: 'image', title: path.basename(f), url: `data:${IMG[ext]};base64,${fs.readFileSync(f).toString('base64')}` }; }
    else {
      if (st.size > SCREEN_MAX * 4) throw new Error(`file over ${SCREEN_MAX * 4 / 1e6} MB`);
      const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(Math.min(st.size, SCREEN_MAX));
      try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
      ev = { k: 'screen', kind, title: f.replace(os.homedir(), '~'), text: buf.toString('utf8'), cut: st.size > SCREEN_MAX };
    }
  } else throw new Error('screen diff <task> | url <url> | file <path> | off');
  // Content goes out live only; the transcript keeps {kind,title}, and the full event stays in memory for reloads (t854).
  ev = { ts: Date.now(), ...ev, ...(by && { by }) };
  if (ev.kind === 'off') { liveScreen.delete(id); emit(id, ev); } else { liveScreen.set(id, ev); emit(id, ev, { k: 'screen', kind: ev.kind, title: ev.title, ...(by && { by }), gone: true }); }
  return { ok: true, kind: ev.kind, title: ev.title || '' };
}

function wake(id, why = 'scheduled') {
  const s = loadSquiggle(id);
  if (!s || R(id).status === 'working' || plimit[providerOf(s)] > Date.now()) return false;
  let news = []; try { news = board.suggestionNews(id); } catch {}
  send(id, `Wake (${why}), ${new Date().toLocaleString()}. Read your charter and the end of your journal, decide the single most valuable thing to do now, do it, verify it, append a dated journal entry, then end with a status line. You have ${s.maxTurns ?? 40} turns this wake; journal findings as you confirm them.${news.length ? `\n\nYour suggestions, decided by the lead:\n${news.map((x) => `- ${x}`).join('\n')}` : ''}`, 'harness');
  return true;
}

const ownNotes = (id) => { try { return Object.fromEntries(board.tasks().filter((t) => t.owner === id).map((t) => [t.id, `${t.status}\n${t.note || ''}`])); } catch { return {}; } };
// What a capped squiggle managed to save this wake: its journal's last entry heading and the notes it moved.
function lastSaved(s) {
  const since = Date.parse(R(s.id).lastWake) || 0, out = [];
  try {
    const j = path.join(sqDir(s.id), 'journal.md');
    if (fs.statSync(j).mtimeMs >= since) out.push(`journal: ${(fs.readFileSync(j, 'utf8').match(/^#+ .*$/gm) || []).pop()?.replace(/^#+\s*/, '') || 'updated'}`);
  } catch {}
  try {
    const was = R(s.id).board0 || {}, moved = Object.entries(ownNotes(s.id)).filter(([id, v]) => was[id] !== v).map(([id, v]) => `${id} ${v.split('\n')[0]}`);
    if (moved.length) out.push(`board: ${moved.join(', ')}`);
  } catch {}
  return out.length ? `last saved ${out.join('; ')}` : 'nothing saved this wake';
}

// Reports that need the lead's attention, delivered together whenever the lead is free.
const inbox = [];
function turnEnded(s, text, isError, subtype) {
  const p = providerOf(s), reset = !p && parseReset(text); if (reset) limitHit(reset);
  const limited = !p && limit.until > Date.now() && (reset || isError);
  const st = subtype === 'provider_limit' ? { status: 'idle', note: `${p} usage limit, wakes resume ${hhmm(plimit[p])}` }
    : subtype === 'capacity' ? { status: 'waiting', note: `model at capacity, retrying at ${hhmm(R(s.id).capAt)} (try ${R(s.id).capTries} of 3)` }
    : limited ? { status: 'idle', note: `session limit, wakes resume ${hhmm(limit.until)}` }
    : subtype === 'interrupted' ? { status: 'idle', note: 'stopped' }
    : subtype === 'error_max_turns' ? { status: 'error', note: `hit the turn cap (${s.maxTurns ?? 40}); ${lastSaved(s)}; fresh process next wake` }
    : isError ? { status: 'error', note: 'turn failed' } : statusLine(text) || { status: 'idle', note: '' };
  R(s.id).lastEnd = now();
  const relay = R(s.id).relay; if (relay?.length && !isError && text?.trim()) { delete R(s.id).relay; saveState(); for (const t of new Set(relay)) emit(t, { k: 'say', text, by: s.id }); }
  emit(s.id, { k: 'end', status: st.status, note: st.note });
  setStatus(s.id, st.status, st.note);
  if (!s.lead && st.status !== 'idle' && st.status !== 'waiting') {
    inbox.push(`[${s.name} · ${st.status.toUpperCase()}] ${st.note}`);
    flushInbox();
  }
  if (s.lead) flushInbox();
  setTimeout(maybeRestart, 1000);
}
function flushInbox() {
  const lead = listSquiggles().find((x) => x.lead);
  if (!lead || !inbox.length || R(lead.id).status === 'working' || limit.until > Date.now()) return;
  send(lead.id, `Team reports:\n${inbox.splice(0).join('\n')}\n\nHandle what you can. Tell ${USER} only what needs them, in one short message.`, 'harness');
}

// Session limit: one hit pauses every scheduled wake (and the lead's inbox) until the reset time plus 5 minutes,
// shows a banner in the Room, and reports once to the lead when things resume.
const limit = persisted['*limit'] || { until: 0, reported: 0 };
const hhmm = (t) => (t - Date.now() > 20 * 3600000 ? new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' : '') + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function parseReset(text) {
  const m = /session limit[^\n]*?resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text || ''); if (!m) return 0;
  let h = Number(m[1]) % 12; if ((m[3] || '').toLowerCase() === 'pm') h += 12;
  const d = new Date(); d.setHours(h, Number(m[2] || 0), 0, 0);
  if (d.getTime() < Date.now() - 3600000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function limitHit(resetsAt) {
  const until = resetsAt + 5 * 60000;
  if (until <= limit.until) return;
  limit.until = until; limit.reported = 0; persisted['*limit'] = limit; saveState();
  broadcast('*room', { k: 'room', action: 'limit', value: until });
  inbox.push(`[Harness · LIMIT] Session limit hit at ${hhmm(Date.now())}; scheduled wakes paused until ${hhmm(until)}.`);
  armLimit();
}
function armLimit() {
  clearTimeout(limit.timer);
  if (limit.until > Date.now()) limit.timer = setTimeout(() => { broadcast('*room', { k: 'room', action: 'limit', value: 0 }); flushInbox(); }, limit.until - Date.now() + 1000);
}
armLimit(); // a limit that was in force when the server restarted still lifts on time

// Clears what the chat window shows. The agent keeps its session and remembers everything.
function clearChat(id) { emit(id, { k: 'cleared' }); return 'cleared'; }

// Removing a squiggle archives its folder; nothing is deleted.
function removeSquiggle(id) {
  const s = loadSquiggle(id);
  if (!s) throw new Error(`no squiggle ${id}`);
  if (s.lead) throw new Error('the lead cannot be removed');
  const r = R(id);
  if (r.proc) { r.proc.removeAllListeners('exit'); r.proc.kill('SIGTERM'); }
  if (r.cx) { r.cx.on = null; r.cx.proc.kill('SIGTERM'); }
  rt.delete(id); saveState();
  fs.mkdirSync(path.join(SQ, '.archive'), { recursive: true });
  fs.renameSync(sqDir(id), path.join(SQ, '.archive', `${id}-${Date.now()}`));
  broadcast('*room', { k: 'removed', id });
  return `${s.name} removed (archived in squiggles/.archive)`;
}
function broadcast(id, ev) {
  const line = `data: ${JSON.stringify({ id, ev })}\n\n`;
  for (const res of clients) res.write(line);
}

// Restart without killing anyone mid-turn: wait until nobody is working, then exit; the login item starts the server again.
// Started by hand (no login item), start the replacement ourselves; it waits for this one to free the port.
let restartPending = false;
const supervised = process.env.XPC_SERVICE_NAME === 'local.squiggles.server';
function maybeRestart() {
  if (!restartPending || [...rt.values()].some((r) => r.status === 'working' && r.proc)) return;
  broadcast('*room', { k: 'room', action: 'restarting' });
  if (!supervised) spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'inherit', env: { ...process.env, SQUIGGLES_RESPAWN: '1' } }).unref();
  shutdown(0);
}
// Turns held by a pending restart go out once the new server is up.
setTimeout(() => {
  const held = persisted['*held'] || []; delete persisted['*held']; saveState();
  for (const h of held) try { send(h.id, h.text, h.from, { replay: true, human: h.human, images: h.images || [] }); } catch (e) { console.error('held', h.id, e.message); }
}, 3000);
function shutdown(code) {
  for (const r of rt.values()) { if (r.proc) r.proc.kill('SIGTERM'); if (r.cx) r.cx.proc.kill('SIGTERM'); if (r.caff) r.caff.kill(); }
  kokoro.shutdown(); saveState();
  setTimeout(() => process.exit(code), 300);
}

function stop(id) {
  const r = R(id);
  if (r.proc) r.proc.kill('SIGTERM');
  setStatus(id, 'idle', 'stopped');
}

// ---------- scheduler: squiggles wake themselves on their cadence ----------
// Paused while the session limit is hit. Staggered per provider: no two squiggles on the same provider start within 2 minutes of each other. Jittered: schedule.mjs.
const dueAt = createSchedule();
setInterval(() => {
  const all = listSquiggles();
  const newest = {};
  for (const s of all) { const t = Date.parse(R(s.id).lastWake || 0) || 0; const p = providerOf(s); if (!(newest[p] > t)) newest[p] = t; }
  const started = new Set();
  for (const s of all) {
    if (s.lead || s.paused || !(s.every > 0)) continue;
    const p = providerOf(s);
    if (started.has(p) || Date.now() - (newest[p] || 0) < 2 * 60000) continue;
    if (!p && limit.until > Date.now()) continue;
    const r = R(s.id);
    const last = Date.parse(r.lastWake || 0) || 0;
    if (r.status !== 'working' && Date.now() >= dueAt(s.id, s.every, last) && wake(s.id)) started.add(p);
  }
}, 30000);

// ---------- meetings: at the start time, wake the attendees with the agenda and open the meeting view ----------
// One meeting at a time; it closes at its end time (or `meeting end`). Started occurrences are remembered so a restart doesn't repeat them.
const meetingNow = () => persisted['*meeting'] || null;
function startMeeting(m, by = 'calendar') {
  if (meetingNow()) throw new Error(`${meetingNow().title} is still on: end it first`);
  const names = m.attendees.map((id) => loadSquiggle(id)?.name || id), paused = limit.until > Date.now(), pres = (m.presenters || []).filter((id) => m.attendees.includes(id));
  const showtell = pres.length && meetings.all().find((x) => x.id === m.id)?.showtell;
  const cur = { id: m.id, title: m.title, agenda: m.agenda || '', attendees: m.attendees, ...(pres.length ? { presenters: pres, turn: 0 } : {}), ...(showtell ? { since: lastShow(m) } : {}), start: m.start, end: m.end, key: `${m.id}@${m.start}`, by, at: Date.now() };
  persisted['*meeting'] = cur; persisted['*started'] = [...(persisted['*started'] || []), cur.key].slice(-100); saveState();
  broadcast('*room', { k: 'room', action: 'meeting', value: cur });
  if (by === 'calendar') macAlert(`Meeting now: ${m.title}`, `${m.title} has started with ${names.join(', ')}. Join it in the room?`, true);
  if (paused) { inbox.push(`[Harness · MEETING] ${m.title} started but nobody was woken: session limit until ${hhmm(limit.until)}.`); return cur; }
  const head = `Meeting now: ${m.title}, ${m.start.slice(11)} to ${m.end.slice(11)}, with ${USER} and ${names.join(', ')}.${m.agenda ? `\nAgenda:\n${m.agenda}` : ''}\n`;
  const order = pres.map((id) => loadSquiggle(id)?.name || id).join(', then ');
  for (const id of m.attendees) {
    if (!loadSquiggle(id)) continue;
    if (pres[0] === id) send(id, head + presentPrompt(cur, id), 'harness');
    else if (pres.length) send(id, head + `Presenters take turns: ${order}, then ${USER}'s questions. It isn't your turn yet: post nothing now. `
      + `Read what bears on the agenda so you're ready. You'll get a message when it's your turn. The meeting is one shared thread: you hear only what ${USER} addresses to you; answer that briefly.`, 'harness');
    else send(id, head + `${User} runs it from the meeting view: one shared thread with everyone's messages. Check your board and journal for what bears on the agenda, `
      + `then post a short brief: what you did, what you need from ${USER}. Answer questions in your chat until the meeting ends. Keep it brief; journal any decisions.`, 'harness');
  }
  return cur;
}
// Meet now (t146): an unscheduled meeting that starts at once, 30 minutes unless said otherwise.
// Presenters (t604): given order, else the attendees in the order given; one presenter at a time.
function meetNow({ attendees, presenters, topic = '', agenda, minutes = 30, by = 'owner' } = {}) {
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const ids = list(attendees), pres = list(presenters);
  if (!ids.length) throw new Error('pick at least one attendee');
  const bad = [...ids, ...pres].filter((id) => !loadSquiggle(id)); if (bad.length) throw new Error(`no squiggle ${bad.join(', ')}`);
  for (const id of pres) if (!ids.includes(id)) ids.push(id);
  const s = new Date(), e = new Date(s.getTime() + (Number(minutes) || 30) * 60000), t = String(topic).trim();
  return startMeeting({ id: `now-${s.getTime().toString(36)}`, title: t || 'Meet now', agenda: agenda ?? t, attendees: ids, presenters: pres.length ? pres : ids, start: local(s), end: local(e) }, by);
}
// Merge review now (t599): squiggles with branches in review present them, urgent or prod first, then security, then most commits and oldest; at most 5.
function mergeMeeting(by = 'owner') {
  const hot = (x) => /\burgent\b|\bprod\b|outage|hotfix/i.test(x.title), sec = (x) => x.owner === 'security' || /secur|vuln|cve|secret/i.test(x.title);
  const per = {};
  for (const x of board.merges()) if (x.owner && loadSquiggle(x.owner)) (per[x.owner] = per[x.owner] || []).push(x);
  const score = (xs) => [xs.some(hot) ? 1 : 0, xs.some(sec) ? 1 : 0, xs.reduce((n, x) => n + (x.ahead || 0), 0), Math.max(...xs.map((x) => x.age || 0))];
  const ids = Object.keys(per).sort((a, b) => { const A = score(per[a]), B = score(per[b]); for (let i = 0; i < 4; i++) if (A[i] !== B[i]) return B[i] - A[i]; return 0; }).slice(0, 5);
  if (!ids.length) throw new Error('nothing is in review');
  const line = (x) => `- ${x.id} ${String(x.title).slice(0, 90)} (${path.basename(x.repo || '')}:${x.branch}, ${x.ahead ?? '?'} ahead${x.stale ? ', stale' : ''}) diff: http://localhost:${PORT}/?view=merge&diff=${x.id}${x.compare ? ` compare: ${x.compare}` : ''}`;
  const agenda = `Merge review. Each presenter walks ${USER} through their branches: what each changes for them, how it was tested, the risk. ${User} merges or sends back.\n`
    + ids.map((id) => `${loadSquiggle(id)?.name || id}:\n${per[id].map(line).join('\n')}`).join('\n');
  return meetNow({ attendees: ids, presenters: ids, topic: 'Merge review', agenda, by });
}
// Show and tell (t131): since the last time this meeting ran (else a week ago); a presenter's agenda is their notes done or in review since then.
function lastShow(m) {
  const prev = (persisted['*started'] || []).filter((k) => k.startsWith(`${m.id}@`)).map((k) => k.slice(m.id.length + 1)).filter((s) => s < m.start).sort().pop();
  return (prev || local(new Date(new Date(m.start).getTime() - 7 * 864e5))).slice(0, 10);
}
function showItems(id, since) {
  let ts = []; try { ts = board.tasks(); } catch {}
  return ts.filter((t) => t.owner === id && ((t.status === 'done' && (t.finished || '') >= since) || (t.status === 'review' && (t.reviewed || '') >= since)))
    .slice(-12).map((t) => `- ${t.id} ${String(t.title).slice(0, 110)}${t.status === 'review' ? ' (in review)' : ''}`);
}
// A presenter's turn: one spoken summary (the room reads it aloud), visuals through tools (shown on the shared screen), then questions.
function presentPrompt(cur, id) {
  const n = cur.presenters.length, i = cur.presenters.indexOf(id);
  const items = cur.since ? showItems(id, cur.since) : null;
  const own = !items ? '' : items.length ? `Your agenda is your work since ${cur.since}:\n${items.join('\n')}\nShow what each one changed for ${USER}, not how. ` : `You have no notes done or in review since ${cur.since}: say so in one line and what you're on now. `;
  return own + `Your turn to present (${i + 1} of ${n}). Present your part of the agenda now in one chat message ${USER} can hear in about 60 seconds: `
    + `about 150 words, plain words, no tables or code. If a diagram, file or page helps, open it with a tool (Read an image or file, run a command): the room shows your tool output on the shared screen while you present. `
    + `Then stop and answer ${USER}'s questions in the meeting thread, briefly, until they move on to the next presenter. Journal any decisions.`;
}
// The user moves the floor on: the next presenter gets their turn; after the last, open questions.
function nextTurn() {
  const cur = meetingNow(); if (!cur) throw new Error('no meeting is on');
  if (!cur.presenters?.length) throw new Error(`${cur.title} has no presenters`);
  if (cur.turn >= cur.presenters.length) throw new Error('every presenter has had a turn');
  cur.turn += 1; saveState();
  broadcast('*room', { k: 'room', action: 'meeting', value: cur });
  const id = cur.presenters[cur.turn];
  if (id && loadSquiggle(id)) send(id, `${cur.title}: ${presentPrompt(cur, id)}`, 'harness');
  return cur;
}
function endMeeting() {
  const cur = meetingNow(); if (!cur) throw new Error('no meeting is on');
  delete persisted['*meeting']; saveState();
  broadcast('*room', { k: 'room', action: 'meeting', value: null });
  // Notes: the whole conversation to runs/meetings.log, what the user asked each attendee to their journal.
  try {
    const logs = {}, names = {};
    for (const id of cur.attendees) {
      names[id] = loadSquiggle(id)?.name || id;
      logs[id] = readText(path.join(RUNS, `${id}.jsonl`)).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    }
    const n = meetingNotes(cur, logs, names, Date.now(), USER);
    fs.appendFileSync(path.join(RUNS, 'meetings.log'), n.log);
    for (const id of cur.attendees) if (loadSquiggle(id)) fs.appendFileSync(path.join(sqDir(id), 'journal.md'), n.journal[id]);
  } catch (e) { console.error('meeting notes:', e.message); }
  return { ...cur, ended: true };
}
// Meeting alerts on the Mac (t147), 5 minutes before and at the start, only when no page is open here: an open page chimes and opens the meeting view itself.
// At the start a dialog offers Join, which opens the room on the meeting view.
const pageOpenHere = () => [...clients].some((c) => c.local);
const asStr = (s) => `"${String(s).replace(/[\x00-\x1f]/g, ' ').replace(/[\\"]/g, '\\$&')}"`;
function macAlert(title, text, join) {
  if (pageOpenHere()) return false;
  const script = join
    ? `display dialog ${asStr(text)} with title ${asStr(title)} buttons {"Later", "Join"} default button "Join" giving up after 120`
    : `display notification ${asStr(text)} with title ${asStr(title)} sound name "Glass"`;
  execFile('osascript', ['-e', script], (e, out) => {
    if (e) return console.error('mac alert:', e.message);
    if (join && /button returned:Join/.test(out)) execFile('open', [`http://localhost:${PORT}/?view=meeting`]);
  });
  return true;
}
function meetingSoon(now) {
  const warned = new Set(persisted['*warned'] || []);
  for (const m of meetings.upcoming(new Date(now + 4 * 60000), new Date(now + 5 * 60000 + 30000))) {
    const key = `${m.id}@${m.start}`; if (warned.has(key)) continue;
    persisted['*warned'] = [...warned, key].slice(-100); saveState();
    broadcast('*room', { k: 'room', action: 'meetingSoon', value: m }); // open pages alert themselves (t148)
    macAlert(`In 5 minutes: ${m.title}`, `${m.start.slice(11)} to ${m.end.slice(11)} with ${m.attendees.map((id) => loadSquiggle(id)?.name || id).join(', ')}`);
  }
}
function meetingTick() {
  const now = Date.now(), cur = meetingNow();
  meetingSoon(now);
  if (cur && new Date(cur.end).getTime() <= now) endMeeting();
  if (meetingNow()) return;
  // Start anything that began in the last 2 minutes and hasn't been started yet.
  const done = new Set(persisted['*started'] || []);
  const due = meetings.upcoming(new Date(now - 2 * 60000), new Date(now + 1000)).find((m) => !done.has(`${m.id}@${m.start}`));
  if (due) startMeeting(due);
}
setInterval(() => { try { meetingTick(); } catch (e) { console.error('meetings:', e.message); } }, 20000);
// Orphan worktrees (t769): hourly, the lead's one note is refreshed (or closed when none are left).
setInterval(() => { try { board.orphanNotes(); } catch (e) { console.error('worktrees:', e.message); } }, 3600000);

// ---------- inbox: text files the user drops in <data>/inbox wake the lead, then move to inbox/read/ ----------
const drop = createInbox(path.join(DATA, 'inbox'));
setInterval(() => {
  try {
    const lead = listSquiggles().find((x) => x.lead);
    if (!lead || R(lead.id).status === 'working' || limit.until > Date.now()) return; // files wait in inbox/ until the lead can take them
    const notes = drop.take(); if (!notes.length) return;
    send(lead.id, `${User} dropped ${notes.length > 1 ? `${notes.length} notes` : 'a note'} in the inbox:\n\n${notes.map((n) => `--- ${n.name} ---\n${n.text.trim()}`).join('\n\n')}\n\nTreat ${notes.length > 1 ? 'these' : 'it'} as a message from ${USER}. Moved to inbox/read/.`, 'inbox');
  } catch (e) { console.error('inbox:', e.message); }
}, 5000);

// ---------- share on the tailnet: `tailscale serve` proxies https://<this mac>.<tailnet>.ts.net/ to this server. No ACL: the tailnet is trusted. ----------
const TS = fs.existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale') ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : 'tailscale';
// Without a terminal the app binary tries to start its GUI ('The Tailscale GUI failed to start'); TAILSCALE_BE_CLI keeps it a CLI.
const tsRun = (args) => new Promise((ok, no) => execFile(TS, args, { timeout: 15000, env: { ...process.env, TAILSCALE_BE_CLI: '1' } }, (e, out, err) => e ? no(new Error(String(err || e.message).trim().split('\n').pop())) : ok(out)));
// The serve entry pointing at this port, if any: {on, url}.
function shareFrom(status, port = PORT) {
  for (const [host, w] of Object.entries(status?.Web || {}))
    for (const [p, h] of Object.entries(w.Handlers || {}))
      if (new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/?$`).test(h.Proxy || '')) return { on: true, url: `https://${host.replace(/:443$/, '')}${p}` };
  return { on: false, url: '' };
}
const shareStatus = async () => {
  if (!CONFIG.tailnet) return { on: false, url: '', off: true };
  const out = (await tsRun(['serve', 'status', '--json'])).trim();
  try { return shareFrom(JSON.parse(out || '{}')); } catch { throw new Error(out.split('\n').pop()); }
};
async function share(on) {
  if (!CONFIG.tailnet) throw new Error('tailnet sharing is off: set "tailnet": true in config.json');
  if (on) await tsRun(['serve', '--bg', String(PORT)]); else if ((await shareStatus()).on) await tsRun(['serve', '--https=443', 'off']);
  const st = await shareStatus(); broadcast('*room', { k: 'room', action: 'share', value: st }); return st;
}

// ---------- voice ----------
const VOICE_POOL = kokoro.voices().filter((v) => v.locale.startsWith('en'));
function voiceFor(id) {
  const s = loadSquiggle(id);
  if (s?.voice) return s.voice;
  const h = parseInt(crypto.createHash('md5').update(id).digest('hex').slice(0, 6), 16);
  return VOICE_POOL[h % VOICE_POOL.length].name;
}
const ttsJobs = new Map();
function tts(text, voice) {
  text = String(text).slice(0, 1500);
  const key = crypto.createHash('sha1').update(voice + '|' + text).digest('hex');
  const file = path.join(TTS_DIR, key + '.wav');
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (!ttsJobs.has(key)) {
    const tmp = file + '.part.wav';
    ttsJobs.set(key, kokoro.synth(text, voice, 1.08, tmp).then(() => { fs.renameSync(tmp, file); return file; }).finally(() => ttsJobs.delete(key)));
  }
  return ttsJobs.get(key);
}
kokoro.warm();

// ---------- http ----------
// ---------- the lead in a Teams call (~/claude-in-call) ----------
// Detached, with its pid in runs/call.json, so a server restart neither hangs it up nor loses track of it.
const CALL = path.join(RUNS, 'call.json'), CALL_LOG = path.join(RUNS, 'call.log'), CALL_DIR = home('~/claude-in-call');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function callStatus() {
  const c = JSON.parse(readText(CALL, 'null'));
  if (!c) return { live: false };
  const log = readText(CALL_LOG).split('\n').filter(Boolean).slice(-12);
  return { ...c, live: alive(c.pid), log };
}
function callPrompt() {
  const lead = listSquiggles().find((s) => s.lead) || {};
  const g = board.goals(), line = (x) => `- ${x.title}${x.owner ? ` (owner ${x.owner})` : ''}${x.due ? `, due ${x.due}` : ''}${x.note ? `: ${x.note}` : ''}`;
  const open = board.tasks().filter((t) => t.status === 'doing' || t.status === 'blocked' || t.status === 'review');
  return `You are ${lead.name || 'Lead'}, the lead of ${USER}'s agent team, joining this call on their behalf. ${User} is in the call. Answer as the lead, with the team's context below. Your workspace is ${ROOT}; \`node bin/agents.mjs\` there shows the live team and board (list, goals, tasks, tail <id>). Do not wake, tell or change squiggles from the call unless ${USER} asks.

Your responsibility:
${readText(path.join(sqDir(lead.id || 'lead'), 'charter.md')).trim()}

The team:
${TEAM()}

Active goals:
${(g.active || []).map(line).join('\n') || '- none'}
Next up:
${(g.todo || []).map(line).join('\n') || '- none'}

In flight (${open.length}): ${open.slice(0, 30).map((t) => `${t.id} ${t.status} ${t.title.slice(0, 70)}${t.owner ? ` @${t.owner}` : ''}`).join('; ')}`;
}
// The squiggle's room avatar as its call face: idle, talking and open-mouth SVGs from ui/cast.js, for claude-in-call's --face=avatar:<dir>.
// Room-wide settings that outlive a page: { characters: <default generator> }.
// ui/cast.js and the generators in ui/gen (parts before renderers) in a sandbox, with the room's default generator applied.
function castCtx() {
  const ctx = vm.createContext({}), gen = path.join(ROOT, 'ui', 'gen');
  const files = fs.readdirSync(gen).filter((f) => f.endsWith('.js')).sort((a, b) => b.endsWith('-parts.js') - a.endsWith('-parts.js') || a.localeCompare(b));
  for (const f of [path.join(ROOT, 'ui', 'cast.js'), ...files.map((f) => path.join(gen, f))]) vm.runInContext(readText(f), ctx);
  ctx.roomGen(roomCfg().characters || 'cast'); return ctx;
}
function callFace(s) {
  try {
    const ctx = castCtx();
    const p = ctx.persona(s), dir = path.join(RUNS, 'call-face'); fs.mkdirSync(dir, { recursive: true });
    for (const [k, m] of [['idle', 0], ['talk', 1], ['open', 2]]) fs.writeFileSync(path.join(dir, `${k}.svg`), ctx.avatarSVG(p, { m }, 'cf_'));
    return dir;
  } catch (e) { console.error('call face:', e.message); return null; }
}
// When the call should end, so claude-in-call leaves 5 min after it: given (`until`), else the Calendar meeting on now, else one starting within 15 min either side.
function callEnds(until) {
  if (until) return parseWhen(until);
  if (meetingNow()) return meetingNow().end;
  const near = meetings.upcoming(new Date(Date.now() - 15 * 60000), new Date(Date.now() + 15 * 60000))[0];
  return near ? near.end : '';
}
function callJoin(url, until) {
  if (!fs.existsSync(CALL_DIR)) throw new Error('calls need ~/claude-in-call, which is not installed');
  if (!/^https:\/\/([\w-]+\.)*(teams\.microsoft\.com|teams\.live\.com)\//.test(String(url || ''))) throw new Error('give a Teams meeting link (https://teams.microsoft.com/... or teams.live.com/...)');
  const c = callStatus(); if (c.live) throw new Error(`already in a call (pid ${c.pid}): call leave first`);
  const lead = listSquiggles().find((s) => s.lead) || { id: 'lead', name: 'Lead', lead: true }, face = callFace(lead), ends = callEnds(until);
  const promptFile = path.join(RUNS, 'call-prompt.md'); fs.writeFileSync(promptFile, callPrompt());
  const out = fs.openSync(CALL_LOG, 'w');
  const env = { ...process.env }; delete env.CLAUDECODE;
  const p = spawn(process.execPath, ['src/call.js', url, lead.name || 'Lead', `--workspace=${ROOT}`, '--model=claude-opus-5-5', `--prompt-file=${promptFile}`, ...(face ? [`--face=avatar:${face}`] : []), ...(ends ? [`--ends=${ends}`] : [])],
    { cwd: CALL_DIR, detached: true, stdio: ['ignore', out, out], env });
  p.unref(); fs.closeSync(out);
  const rec = { pid: p.pid, url, name: lead.name || 'Lead', started: now(), ...(ends ? { ends } : {}) };
  fs.writeFileSync(CALL, JSON.stringify(rec, null, 2)); broadcast('*room', { k: 'room', action: 'call', value: 'joined' });
  return rec;
}
async function callLeave() {
  const c = callStatus(); if (!c.live) return 'not in a call';
  process.kill(c.pid, 'SIGINT'); // call.js hangs up in Teams first, then closes its browser
  for (let i = 0; i < 20 && alive(c.pid); i++) await new Promise((r) => setTimeout(r, 250));
  if (alive(c.pid)) process.kill(c.pid, 'SIGTERM');
  broadcast('*room', { k: 'room', action: 'call', value: 'left' });
  return 'left the call';
}

function body(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}
const json = (res, v, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };
function serveFile(res, file) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return json(res, { error: 'not found' }, 404);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
const view = (s) => {
  const { proc, caff, cx, cxThread, cxLast, sig, ...r } = R(s.id);
  return { ...s, ...r, voice: voiceFor(s.id), charter: readText(path.join(sqDir(s.id), 'charter.md')) };
};
function tailEvents(id, n = 400) {
  const lines = readText(path.join(RUNS, `${id}.jsonl`)).trim().split('\n').filter(Boolean);
  return lines.slice(-n).map((l) => JSON.parse(l)).map((e) => (e.k === 'screen' && e.gone && liveScreen.get(id)?.ts === e.ts ? liveScreen.get(id) : e));
}

// Tailnet sharing off: only the local names are allowed, and tailscale is never asked.
const tailnet = CONFIG.tailnet ? tailnetName(TS) : { get: () => '', seen: () => {} };
const refuse = makeGuard(PORT, tailnet.get);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.split('/').filter(Boolean);
  tailnet.seen(req.headers.host);
  const why = refuse(req);
  if (why) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end(`refused: ${why}`); }
  try {
    if (url.pathname === '/') return serveFile(res, path.join(ROOT, 'ui', 'index.html'));
    // UI seam: <data>/local.css loads after room.css; empty when absent.
    if (url.pathname === '/local.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(readText(path.join(DATA, 'local.css'))); }
    if (p[0] === 'ui' && p[1] === 'gen') return serveFile(res, path.join(ROOT, 'ui', 'gen', path.basename(p[2] || '')));
    if (p[0] === 'ui') return serveFile(res, path.join(ROOT, 'ui', path.basename(p[1] || '')));
    if (p[0] === 'media') return serveFile(res, path.join(MEDIA, path.basename(p[1] || '')));
    if (p[0] === 'files') return serveFile(res, path.join(FILES, path.basename(decodeURIComponent(p[1] || ''))));
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(': hi\n\n');
      // A page on this Mac (not proxied by tailscale serve, which adds x-forwarded-for): meeting alerts are left to it.
      res.local = !req.headers['x-forwarded-for'];
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/squiggles' && req.method === 'GET') return json(res, listSquiggles().map(view));
    if (url.pathname === '/api/squiggles' && req.method === 'POST') return json(res, view(createSquiggle(await body(req))));
    if (url.pathname === '/api/tts') {
      const file = await tts(url.searchParams.get('text') || '', voiceFor(url.searchParams.get('id') || ''));
      return serveFile(res, file);
    }
    if (url.pathname === '/api/call' && req.method === 'GET') return json(res, callStatus());
    if (url.pathname === '/api/call' && req.method === 'POST') { const b = await body(req); return json(res, b.op === 'leave' ? await callLeave() : callJoin(b.url, b.until)); }
    if (url.pathname === '/api/health') return json(res, 'ok');
    if (url.pathname === '/api/humans') return json(res, req.method === 'POST' ? humans.op(await body(req)) : { humans: humans.all() });
    if (url.pathname === '/api/config') { const { userName, model, codex, tailnet } = CONFIG; return json(res, { userName, model, codex, tailnet, call: fs.existsSync(CALL_DIR), version: VERSION, schema: CONFIG.schema }); }
    if (url.pathname === '/api/share') return json(res, req.method === 'POST' ? await share(!!(await body(req)).on) : await shareStatus());
    if (url.pathname === '/api/inbox') return json(res, { ...drop.list(), dir: path.join(DATA, 'inbox').replace(os.homedir(), '~') });
    if (url.pathname === '/api/limit') return json(res, { until: limit.until > Date.now() ? limit.until : 0 });
    if (url.pathname === '/api/restart' && req.method === 'POST') { restartPending = true; setTimeout(maybeRestart, 500); return json(res, 'restarting as soon as nobody is mid-turn'); }
    if (url.pathname === '/api/voice') return json(res, kokoro.status());
    // Room controls (radio, voices, chatter, tabs, chat windows) so the lead can do whatever the user can.
    if (url.pathname === '/api/room' && req.method === 'POST') {
      const b = await body(req);
      if (b.action === 'characters') {   // the room's default character generator (t832), saved so every page agrees
        const gens = Object.keys(castCtx().GENS), g = String(b.value || '').toLowerCase();
        if (!gens.includes(g)) return json(res, { error: `generators: ${gens.join(', ')}` }, 400);
        fs.writeFileSync(ROOMCFG, JSON.stringify({ ...roomCfg(), characters: g }, null, 2) + '\n'); b.value = g;
      }
      broadcast('*room', { k: 'room', ...b }); return json(res, 'ok');
    }
    if (url.pathname === '/api/defaults' && req.method === 'POST') {
      const d = setDefaults(await body(req)); broadcast('*room', { k: 'room', action: 'defaults' }); return json(res, d);
    }
    if (url.pathname === '/api/defaults') return json(res, teamDefaults());
    if (url.pathname === '/api/room') return json(res, roomCfg());
    if (url.pathname === '/api/board') return json(res, { goals: board.goals(), tasks: board.tasks() });
    if (url.pathname === '/api/goals' && req.method === 'POST') return json(res, board.goalOp(await body(req)));
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const b = await body(req), r = board.taskOp(b);
      // A new suggestion rides along with the next team report to the lead; it never wakes anyone on its own (t825).
      if (b.op === 'suggest' && !r.dup) inbox.push(`[${(r.by && loadSquiggle(r.by)?.name) || r.by || 'Someone'} · SUGGESTION] ${r.id} ${r.title}${r.evidence ? ` (evidence: ${r.evidence})` : ''}`);
      return json(res, r);
    }
    if (url.pathname === '/api/meetings' && req.method === 'GET') {
      const days = Math.min(366, Number(url.searchParams.get('days')) || 7), from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')) : new Date();
      return json(res, { meetings: meetings.all(), upcoming: markPast(meetings.upcoming(from, new Date(from.getTime() + days * 864e5)), new Set(persisted['*started'] || []), readText(path.join(RUNS, 'meetings.log'))), current: meetingNow() });
    }
    if (url.pathname === '/api/meetings' && req.method === 'POST') {
      const b = await body(req);
      if (b.op === 'end') return json(res, endMeeting());
      if (b.op === 'next') return json(res, nextTurn());
      if (b.op === 'now') return json(res, meetNow(b));
      if (b.op === 'merges') return json(res, mergeMeeting(b.by));
      if (b.op === 'start') {
        // Start now, ahead of time: today's (or the next) occurrence, keeping its length.
        const m = meetings.all().find((x) => x.id === b.id); if (!m) throw new Error(`no meeting ${b.id}`);
        const next = meetings.upcoming(new Date(Date.now() - 864e5), new Date(Date.now() + 366 * 864e5)).find((o) => o.id === m.id && new Date(o.end) > new Date());
        const s = new Date(), e = new Date(s.getTime() + (m.minutes || 30) * 60000);
        const cur = startMeeting({ id: m.id, title: m.title, agenda: m.agenda, attendees: m.attendees, presenters: m.presenters, start: local(s), end: local(e) }, 'owner');
        if (next && new Date(next.start).toDateString() === s.toDateString()) { persisted['*started'].push(`${m.id}@${next.start}`); saveState(); }
        return json(res, cur);
      }
      return json(res, meetings.op(b));
    }
    if (url.pathname === '/api/merges' && req.method === 'GET') return json(res, board.merges());
    if (url.pathname === '/api/worktrees' && req.method === 'GET') return json(res, board.worktrees());
    if (url.pathname === '/api/worktrees' && req.method === 'POST') return json(res, { note: board.orphanNotes(), worktrees: board.worktrees() });
    if (p[1] === 'merges' && p[2] && p[3] === 'diff') return json(res, board.mergeDiff(p[2]));
    if (url.pathname === '/api/merges' && req.method === 'POST') {
      const b = await body(req);
      if (b.op === 'merge') return json(res, board.merge(b.id, b.by));
      if (b.op === 'back') return json(res, board.mergeBack(b.id, b.note, b.by));
      if (b.op === 'refresh') { const closed = board.mergeSweep(); return json(res, { closed, merges: board.merges() }); }
      return json(res, { error: 'op must be merge, back or refresh' }, 400);
    }
    if (p[0] === 'api' && p[1] === 'squiggles' && p[2]) {
      const id = p[2], s = loadSquiggle(id);
      if (!s) return json(res, { error: 'no such squiggle' }, 404);
      if (!['events', 'journal'].includes(p[3]) && req.method !== 'POST') return json(res, { error: 'POST only' }, 405);
      const b = req.method === 'POST' ? await body(req) : {};
      switch (p[3]) {
        case 'events': return json(res, tailEvents(id, Number(url.searchParams.get('n') || 400)));
        case 'journal': return json(res, readText(path.join(sqDir(id), 'journal.md')));
        case 'send': send(id, b.text || '', b.from || 'owner', { human: b.human, images: (b.images || []).slice(0, 8).map(saveImage) }); relayMentions(id, b.text || '', b.from || 'owner', b.human); return json(res, 'ok');
        case 'wake': return json(res, wake(id, b.why || 'asked'));
        case 'stop': stop(id); return json(res, 'ok');
        case 'clear': return json(res, clearChat(id));
        case 'screen': return json(res, screen(id, b));
        case 'remove': return json(res, removeSquiggle(id));
        case 'update': {
          const { charter, ...meta } = b;
          checkModelEffort(meta); // t905: only allowed models and efforts reach squiggle.json and the launch args
          saveSquiggle({ ...s, ...meta, id });
          if (charter != null) fs.writeFileSync(path.join(sqDir(id), 'charter.md'), charter.trim() + '\n');
          emit(id, { k: 'meta' });
          return json(res, view(loadSquiggle(id)));
        }
      }
    }
    json(res, { error: 'not found' }, 404);
  } catch (e) {
    json(res, { error: String(e.message || e) }, 500);
  }
});

let portTries = process.env.SQUIGGLES_RESPAWN ? 40 : 0; // a respawn waits up to 10s for the old server to exit
server.on('error', (e) => { if (e.code === 'EADDRINUSE' && portTries-- > 0) setTimeout(() => server.listen(PORT, '127.0.0.1'), 250); else throw e; });
server.listen(PORT, '127.0.0.1', () => console.log(`Squiggles ${VERSION} on http://127.0.0.1:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
