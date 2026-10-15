// Agents: a room of squiggles. Each squiggle is a standing role with a charter and a journal,
// run as a long-lived `claude -p` stream-json process. The lead is the only one James talks to.
import http from 'node:http';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createBoard } from './board.mjs';
import { createMeetings, local, markPast, meetingNotes, parseWhen } from './meetings.mjs';
import { createInbox } from './inbox.mjs';
import { createHumans } from './humans.mjs';
import { dataDir, loadConfig } from './config.mjs';

const home = (p) => String(p || '').replace(/^~(?=\/|$)/, os.homedir());
// Code (ROOT) is written by git only; the room lives in DATA. See docs/upgrading.md.
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DATA = dataDir();
const CONFIG = loadConfig(DATA);
const PORT = CONFIG.port;
const SQ = path.join(DATA, 'squiggles');
const RUNS = path.join(DATA, 'runs');
const MEDIA = path.join(RUNS, 'media');
const STATE = path.join(RUNS, 'state.json');
const TTS_DIR = path.join(RUNS, 'tts');
for (const d of [SQ, RUNS, MEDIA, TTS_DIR]) fs.mkdirSync(d, { recursive: true });

const kokoro = createRequire(import.meta.url)('./voice/kokoro.cjs');
const now = () => new Date().toISOString();
const readText = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };

// ---------- squiggles on disk ----------
const sqDir = (id) => path.join(SQ, id);
function loadSquiggle(id) {
  const meta = JSON.parse(readText(path.join(sqDir(id), 'squiggle.json'), 'null'));
  return meta && { ...meta, id };
}
function listSquiggles() {
  return fs.readdirSync(SQ).filter((d) => fs.existsSync(path.join(SQ, d, 'squiggle.json'))).map(loadSquiggle);
}
function saveSquiggle(s) {
  const { id, ...meta } = s;
  fs.mkdirSync(sqDir(id), { recursive: true });
  fs.writeFileSync(path.join(sqDir(id), 'squiggle.json'), JSON.stringify(meta, null, 2) + '\n');
}
function createSquiggle({ id, name, role, cwd, charter, every = 60, permissionMode = 'auto', model }) {
  id = String(id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id || fs.existsSync(sqDir(id))) throw new Error('name taken or empty');
  saveSquiggle({ id, name, role, cwd: cwd || '~', every: Number(every) || 0, permissionMode, model, paused: false, created: now() });
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
  for (const [id, { proc, caff, ...r }] of rt) out[id] = r;
  if (persisted['*limit']) { const { timer, ...l } = persisted['*limit']; out['*limit'] = l; }
  for (const k of ['*meeting', '*started', '*held', '*warned', '*plimit']) if (persisted[k]) out[k] = persisted[k];
  fs.writeFileSync(STATE, JSON.stringify(out, null, 2));
}

// ---------- events ----------
const clients = new Set();
function emit(id, ev) {
  ev = { ts: Date.now(), ...ev };
  fs.appendFileSync(path.join(RUNS, `${id}.jsonl`), JSON.stringify(ev) + '\n');
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
});
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
function systemPrompt(s) {
  const dir = sqDir(s.id);
  const base = readText(path.join(ROOT, 'prompts', s.lead ? 'lead.md' : 'squiggle.md'));
  return `${base}\n\nYou are ${s.name} (id: ${s.id}). Your role: ${s.role}.\nCharter: ${dir}/charter.md\nJournal: ${dir}/journal.md\nHarness CLI: node ${ROOT}/bin/agents.mjs\n\nThe team:\n${TEAM()}`;
}
// Always pass a model: unset would inherit the CLI default, which may be Fable; squiggles never run on Fable.
// Sonnet is the floor (Haiku has no auto mode); Opus is the default and the ceiling. config.model sets the default.
const modelFor = (s) => (/haiku|sonnet/i.test(s.model || CONFIG.model || '') ? 'claude-sonnet-5-5' : 'claude-opus-5-5');
function launch(s) {
  const r = R(s.id);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--append-system-prompt', systemPrompt(s), '--permission-mode', s.permissionMode || 'auto', '--permission-prompts', 'none',
    '--add-dir', sqDir(s.id), '--add-dir', DATA, '--add-dir', os.homedir(),
    // Squiggles roam the home folder freely, except these.
    '--disallowedTools', ...['Downloads', 'Desktop', 'Documents'].flatMap((d) => [`Read(~/${d}/**)`, `Edit(~/${d}/**)`, `Write(~/${d}/**)`])];
  if (modelFor(s)) args.push('--model', modelFor(s));
  // Usage controls (per squiggle, see handoff): context window cap, effort, and a turn cap per wake.
  args.push('--autocompact', String(s.autocompact ?? (s.lead ? 300000 : 200000)), '--max-turns', String(s.maxTurns ?? 40));
  const effort = s.effort ?? (s.lead ? '' : 'medium'); if (effort) args.push('--effort', effort);
  const cli = `node ${ROOT}/bin/agents.mjs`;
  if (s.lead) args.push('--allowedTools', `Bash(${cli} *)`, 'Read', 'Grep', 'Glob', `Edit(${SQ}/**)`, `Write(${SQ}/**)`, `Edit(${DATA}/goals.json)`);
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
    r.proc = null;
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
  const until = at || Date.now() + ((Number(t?.[1]) || 0) * 60 + (Number(t?.[2]) || 0) || 60) * 60000;
  plimit[p] = until + 5 * 60000; saveState();
  inbox.push(`[Harness · LIMIT] ${p} usage limit hit; its squiggles' wakes paused until ${hhmm(plimit[p])}.`);
  return plimit[p];
}
// Codex: one `codex exec --json` process per turn, resumed by thread id. No stdin mid-turn, so the
// turn cap kills the process and messages sent mid-turn wait for the next turn.
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
function codexTurn(s, prompt) {
  const r = R(s.id), thread = r.codexThread || s.resume, roots = [sqDir(s.id)];
  // workspace-write keeps .git read-only; the repo's git dir must be a writable root or the squiggle can't commit.
  try { roots.push(execFileSync('git', ['-C', home(s.cwd), 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}
  // First turn in a thread: Codex has no appended system prompt, so the squiggle's instructions lead the prompt.
  if (!r.codexPrimed) prompt = `${systemPrompt(s)}\n\n---\n\n${prompt}`;
  const opts = ['--json', '--skip-git-repo-check', '-m', s.model,
    '-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"',
    // The agents CLI talks to this server over HTTP; the journal lives in the squiggle's folder.
    '-c', 'sandbox_workspace_write.network_access=true', '-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(roots)}`];
  const args = thread ? ['exec', 'resume', ...opts, thread, '-'] : ['exec', ...opts, '-'];
  const proc = spawn(codexBin(), args, { cwd: home(s.cwd), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, AGENTS_ID: s.id } });
  r.proc = proc; r.codexPrimed = true;
  proc.stdin.end(prompt);
  let buf = '', lastText = '', ended = false;
  const end = (text, err, subtype) => { if (ended) return; ended = true; turnEnded(s, text, err, subtype); };
  const cap = s.maxTurns ?? 40;
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      const it = ev.item || {};
      if (ev.type === 'thread.started') { r.codexThread = ev.thread_id; saveState(); }
      else if (ev.type === 'item.started' && it.type === 'command_execution') emit(s.id, { k: 'tool', tid: it.id, name: 'Bash', kind: 'cmd', text: shortEv(it.command) });
      else if (ev.type === 'item.completed') {
        if (it.type === 'agent_message' && it.text?.trim()) { lastText = it.text; emit(s.id, { k: 'say', text: it.text }); }
        else if (it.type === 'command_execution') emit(s.id, { k: 'out', tid: it.id, text: shortEv(it.aggregated_output), err: it.exit_code !== 0, imgs: [] });
        else if (it.type === 'file_change') for (const c of it.changes || []) emit(s.id, { k: 'tool', tid: `${it.id}-${c.path}`, name: 'Edit', kind: c.kind === 'add' ? 'write' : 'edit', file: c.path });
        else if (it.type === 'todo_list') emit(s.id, { k: 'tool', tid: it.id, name: 'TodoWrite', kind: 'todo', items: (it.items || []).map((t) => ({ s: t.completed ? 'completed' : 'pending', c: t.text })) });
        else if (it.type === 'web_search') emit(s.id, { k: 'tool', tid: it.id, name: 'WebSearch', kind: 'web', arg: shortEv(it.query) });
        else if (it.type === 'mcp_tool_call') emit(s.id, { k: 'tool', tid: it.id, name: `${it.server}.${it.tool}`, kind: 'tool', arg: JSON.stringify(it.arguments ?? '').slice(0, 300) });
        else if (it.type === 'error') emit(s.id, { k: 'log', text: shortEv(it.message) });
        if (it.type !== 'reasoning' && ++r.turns >= cap) { end(lastText, true, 'error_max_turns'); proc.kill('SIGTERM'); }
      } else if (ev.type === 'turn.completed') {
        r.capTries = 0; const u = ev.usage || {}; r.usage = { in: (r.usage?.in || 0) + (u.input_tokens || 0), out: (r.usage?.out || 0) + (u.output_tokens || 0) };
        emit(s.id, { k: 'log', text: `codex tokens: ${u.input_tokens || 0} in (${u.cached_input_tokens || 0} cached), ${u.output_tokens || 0} out` });
        end(lastText, false);
      } else if (ev.type === 'turn.failed' || ev.type === 'error') {
        const msg = ev.error?.message || ev.message || 'codex failed';
        emit(s.id, { k: 'log', text: shortEv(msg) });
        if (/usage limit|rate limit|quota/i.test(msg)) { providerLimit('codex', msg); end(msg, true, 'provider_limit'); }
        else if (/at capacity/i.test(msg) && !ended) { if ((r.capTries || 0) < 3) { capacityRetry(s); end(msg, true, 'capacity'); } else { r.capTries = 0; end(msg, true); } }
        else if (ev.type === 'turn.failed') end(msg, true);
      }
    }
  });
  proc.stderr.on('data', (d) => emit(s.id, { k: 'log', text: String(d).slice(0, 2000) }));
  proc.on('exit', (code) => {
    r.proc = null;
    if (!ended && r.status === 'working') end(lastText, !!code || !lastText);
    if (r.queue?.length) { const q = r.queue.splice(0); saveState(); send(s.id, q.join('\n\n'), 'harness', { replay: true }); }
  });
}

// from 'james' means a person on the page; human says which one (humans.json), and the squiggle reads 'From <name>: '.
function send(id, text, from = 'james', { replay = false, human } = {}) {
  const s = loadSquiggle(id);
  if (!s) throw new Error(`no squiggle ${id}`);
  const r = R(id);
  // A pending restart waits for everyone to be idle; new turns would starve it (a report wakes the lead, the lead wakes someone).
  // So a turn that would start now is held in state and sent after the restart. Messages to a squiggle mid-turn still go through.
  if (restartPending && r.status !== 'working') {
    r.lastWake = now(); (persisted['*held'] ||= []).push({ id, text, from, human }); saveState();
    emit(id, { k: 'user', text, from, ...(human && { human }) }); emit(id, { k: 'log', text: 'held until the restart' });
    setTimeout(maybeRestart, 500); return;
  }
  const who = from === 'james' && (humans.all().find((h) => h.id === (human || 'james')) || { id: human, name: human });
  const content = who ? `From ${who.name}: ${text}` : text;
  if (providerOf(s)) {
    if (!replay) emit(id, { k: 'user', text, from, ...(who && { human: who.id }) });
    if (r.proc) { (r.queue ||= []).push(content); saveState(); emit(id, { k: 'log', text: 'queued for the next turn' }); return; }
    r.lastWake = now(); r.turns = 0; r.board0 = ownNotes(id);
    setStatus(id, 'working', '');
    return codexTurn(s, content);
  }
  if (!r.proc) launch(s);
  r.lastWake = now(); r.turns = 0; r.board0 = ownNotes(id);
  if (!replay) emit(id, { k: 'user', text, from, ...(who && { human: who.id }) });
  setStatus(id, 'working', '');
  r.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
}

function wake(id, why = 'scheduled') {
  const s = loadSquiggle(id);
  if (!s || R(id).status === 'working' || plimit[providerOf(s)] > Date.now()) return false;
  send(id, `Wake (${why}), ${new Date().toLocaleString()}. Read your charter and the end of your journal, decide the single most valuable thing to do now, do it, verify it, append a dated journal entry, then end with a status line. You have ${s.maxTurns ?? 40} turns this wake; journal findings as you confirm them.`, 'harness');
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
    : subtype === 'error_max_turns' ? { status: 'error', note: `hit the turn cap (${s.maxTurns ?? 40}); ${lastSaved(s)}; fresh process next wake` }
    : isError ? { status: 'error', note: 'turn failed' } : statusLine(text) || { status: 'idle', note: '' };
  R(s.id).lastEnd = now();
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
  send(lead.id, `Team reports:\n${inbox.splice(0).join('\n')}\n\nHandle what you can. Tell James only what needs him, in one short message.`, 'harness');
}

// Session limit: one hit pauses every scheduled wake (and the lead's inbox) until the reset time plus 5 minutes,
// shows a banner in the Room, and reports once to the lead when things resume.
const limit = persisted['*limit'] || { until: 0, reported: 0 };
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
let restartPending = false;
function maybeRestart() {
  if (!restartPending || [...rt.values()].some((r) => r.status === 'working' && r.proc)) return;
  broadcast('*room', { k: 'room', action: 'restarting' });
  shutdown(0);
}
// Turns held by a pending restart go out once the new server is up.
setTimeout(() => {
  const held = persisted['*held'] || []; delete persisted['*held']; saveState();
  for (const h of held) try { send(h.id, h.text, h.from, { replay: true, human: h.human }); } catch (e) { console.error('held', h.id, e.message); }
}, 3000);
function shutdown(code) {
  for (const r of rt.values()) { if (r.proc) r.proc.kill('SIGTERM'); if (r.caff) r.caff.kill(); }
  kokoro.shutdown(); saveState();
  setTimeout(() => process.exit(code), 300);
}

function stop(id) {
  const r = R(id);
  if (r.proc) r.proc.kill('SIGTERM');
  setStatus(id, 'idle', 'stopped');
}

// ---------- scheduler: squiggles wake themselves on their cadence ----------
// Paused while the session limit is hit. Staggered: no two squiggles start within 10 minutes of each other.
setInterval(() => {
  if (limit.until > Date.now()) return;
  const newest = Math.max(0, ...[...rt.values()].map((r) => Date.parse(r.lastWake || 0) || 0));
  if (Date.now() - newest < 10 * 60000) return;
  for (const s of listSquiggles()) {
    if (s.lead || s.paused || !(s.every > 0)) continue;
    const r = R(s.id);
    const last = Date.parse(r.lastWake || 0) || 0;
    if (r.status !== 'working' && Date.now() - last >= s.every * 60000 && wake(s.id)) break;
  }
}, 30000);

// ---------- meetings: at the start time, wake the attendees with the agenda and open the meeting view ----------
// One meeting at a time; it closes at its end time (or `meeting end`). Started occurrences are remembered so a restart doesn't repeat them.
const meetingNow = () => persisted['*meeting'] || null;
function startMeeting(m, by = 'calendar') {
  if (meetingNow()) throw new Error(`${meetingNow().title} is still on: end it first`);
  const names = m.attendees.map((id) => loadSquiggle(id)?.name || id), paused = limit.until > Date.now(), pres = (m.presenters || []).filter((id) => m.attendees.includes(id));
  const cur = { id: m.id, title: m.title, agenda: m.agenda || '', attendees: m.attendees, ...(pres.length ? { presenters: pres, turn: 0 } : {}), start: m.start, end: m.end, key: `${m.id}@${m.start}`, by, at: Date.now() };
  persisted['*meeting'] = cur; persisted['*started'] = [...(persisted['*started'] || []), cur.key].slice(-100); saveState();
  broadcast('*room', { k: 'room', action: 'meeting', value: cur });
  if (by === 'calendar') macAlert(`Meeting now: ${m.title}`, `${m.title} has started with ${names.join(', ')}. Join it in the room?`, true);
  if (paused) { inbox.push(`[Harness · MEETING] ${m.title} started but nobody was woken: session limit until ${hhmm(limit.until)}.`); return cur; }
  const head = `Meeting now: ${m.title}, ${m.start.slice(11)} to ${m.end.slice(11)}, with James and ${names.join(', ')}.${m.agenda ? `\nAgenda:\n${m.agenda}` : ''}\n`;
  const order = pres.map((id) => loadSquiggle(id)?.name || id).join(', then ');
  for (const id of m.attendees) {
    if (!loadSquiggle(id)) continue;
    if (pres[0] === id) send(id, head + presentPrompt(cur, id), 'harness');
    else if (pres.length) send(id, head + `Presenters take turns: ${order}, then James's questions. It isn't your turn yet: post nothing now. `
      + `Read what bears on the agenda so you're ready. You'll get a message when it's your turn; until then answer only what James asks you in your chat, briefly.`, 'harness');
    else send(id, head + `James runs it from the meeting view, where your chat is open next to the others'. Check your board and journal for what bears on the agenda, `
      + `then post a short brief: what you did, what you need from James. Answer questions in your chat until the meeting ends. Keep it brief; journal any decisions.`, 'harness');
  }
  return cur;
}
// Meet now (t146): an unscheduled meeting that starts at once, 30 minutes unless said otherwise.
function meetNow({ attendees, topic = '', minutes = 30, by = 'james' } = {}) {
  const ids = (Array.isArray(attendees) ? attendees : String(attendees || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  if (!ids.length) throw new Error('pick at least one attendee');
  const bad = ids.filter((id) => !loadSquiggle(id)); if (bad.length) throw new Error(`no squiggle ${bad.join(', ')}`);
  const s = new Date(), e = new Date(s.getTime() + (Number(minutes) || 30) * 60000), t = String(topic).trim();
  return startMeeting({ id: `now-${s.getTime().toString(36)}`, title: t || 'Meet now', agenda: t, attendees: ids, start: local(s), end: local(e) }, by);
}
// A presenter's turn: one spoken summary (the room reads it aloud), visuals through tools (shown on the shared screen), then questions.
function presentPrompt(cur, id) {
  const n = cur.presenters.length, i = cur.presenters.indexOf(id);
  return `Your turn to present (${i + 1} of ${n}). Present your part of the agenda now in one chat message James can hear in about 60 seconds: `
    + `about 150 words, plain words, no tables or code. If a diagram, file or page helps, open it with a tool (Read an image or file, run a command): the room shows your tool output on the shared screen while you present. `
    + `Then stop and answer James's questions in your chat, briefly, until he moves on to the next presenter. Journal any decisions.`;
}
// James moves the floor on: the next presenter gets their turn; after the last, open questions.
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
  // Notes: the whole conversation to runs/meetings.log, what James asked each attendee to their journal.
  try {
    const logs = {}, names = {};
    for (const id of cur.attendees) {
      names[id] = loadSquiggle(id)?.name || id;
      logs[id] = readText(path.join(RUNS, `${id}.jsonl`)).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    }
    const n = meetingNotes(cur, logs, names);
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

// ---------- inbox: text files James drops in ~/Agents/inbox wake the lead, then move to inbox/read/ ----------
const drop = createInbox(path.join(DATA, 'inbox'));
setInterval(() => {
  try {
    const lead = listSquiggles().find((x) => x.lead);
    if (!lead || R(lead.id).status === 'working' || limit.until > Date.now()) return; // files wait in inbox/ until the lead can take them
    const notes = drop.take(); if (!notes.length) return;
    send(lead.id, `James dropped ${notes.length > 1 ? `${notes.length} notes` : 'a note'} in the inbox:\n\n${notes.map((n) => `--- ${n.name} ---\n${n.text.trim()}`).join('\n\n')}\n\nTreat ${notes.length > 1 ? 'these' : 'it'} as a message from James. Moved to inbox/read/.`, 'inbox');
  } catch (e) { console.error('inbox:', e.message); }
}, 5000);

// ---------- share on the tailnet: `tailscale serve` proxies https://<this mac>.<tailnet>.ts.net/ to this server. No ACL: the tailnet is trusted. ----------
const TS = fs.existsSync('/Applications/Tailscale.app/Contents/MacOS/Tailscale') ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale' : 'tailscale';
const tsRun = (args) => new Promise((ok, no) => execFile(TS, args, { timeout: 15000 }, (e, out, err) => e ? no(new Error(String(err || e.message).trim().split('\n').pop())) : ok(out)));
// The serve entry pointing at this port, if any: {on, url}.
function shareFrom(status, port = PORT) {
  for (const [host, w] of Object.entries(status?.Web || {}))
    for (const [p, h] of Object.entries(w.Handlers || {}))
      if (new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/?$`).test(h.Proxy || '')) return { on: true, url: `https://${host.replace(/:443$/, '')}${p}` };
  return { on: false, url: '' };
}
const shareStatus = async () => !CONFIG.tailnet ? { on: false, url: '', off: true } : shareFrom(JSON.parse((await tsRun(['serve', 'status', '--json'])) || '{}'));
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
  return `You are ${lead.name || 'Lead'}, the lead of James's agent team, joining this call on his behalf. James is in the call. Answer as the lead, with the team's context below. Your workspace is ~/Agents; \`node bin/agents.mjs\` there shows the live team and board (list, goals, tasks, tail <id>). Do not wake, tell or change squiggles from the call unless James asks.

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
function callFace(s) {
  try {
    const ctx = vm.createContext({}); vm.runInContext(readText(path.join(ROOT, 'ui', 'cast.js')), ctx);
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };
function serveFile(res, file) {
  if (!fs.existsSync(file)) return json(res, { error: 'not found' }, 404);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}
const view = (s) => {
  const { proc, caff, ...r } = R(s.id);
  return { ...s, ...r, voice: voiceFor(s.id), charter: readText(path.join(sqDir(s.id), 'charter.md')) };
};
function tailEvents(id, n = 400) {
  const lines = readText(path.join(RUNS, `${id}.jsonl`)).trim().split('\n').filter(Boolean);
  return lines.slice(-n).map((l) => JSON.parse(l));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.split('/').filter(Boolean);
  try {
    if (url.pathname === '/') return serveFile(res, path.join(ROOT, 'ui', 'index.html'));
    if (p[0] === 'ui') return serveFile(res, path.join(ROOT, 'ui', path.basename(p[1] || '')));
    if (p[0] === 'media') return serveFile(res, path.join(MEDIA, path.basename(p[1] || '')));
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
    if (url.pathname === '/api/config') { const { userName, model, codex, tailnet } = CONFIG; return json(res, { userName, model, codex, tailnet }); }
    if (url.pathname === '/api/share') return json(res, req.method === 'POST' ? await share(!!(await body(req)).on) : await shareStatus());
    if (url.pathname === '/api/inbox') return json(res, drop.list());
    if (url.pathname === '/api/limit') return json(res, { until: limit.until > Date.now() ? limit.until : 0 });
    if (url.pathname === '/api/restart' && req.method === 'POST') { restartPending = true; setTimeout(maybeRestart, 500); return json(res, 'restarting as soon as nobody is mid-turn'); }
    if (url.pathname === '/api/voice') return json(res, kokoro.status());
    // Room controls (radio, voices, chatter, tabs, chat windows) so the lead can do whatever James can.
    if (url.pathname === '/api/room' && req.method === 'POST') { const b = await body(req); broadcast('*room', { k: 'room', ...b }); return json(res, 'ok'); }
    if (url.pathname === '/api/board') return json(res, { goals: board.goals(), tasks: board.tasks() });
    if (url.pathname === '/api/goals' && req.method === 'POST') return json(res, board.goalOp(await body(req)));
    if (url.pathname === '/api/tasks' && req.method === 'POST') return json(res, board.taskOp(await body(req)));
    if (url.pathname === '/api/meetings' && req.method === 'GET') {
      const days = Math.min(366, Number(url.searchParams.get('days')) || 7), from = url.searchParams.get('from') ? new Date(url.searchParams.get('from')) : new Date();
      return json(res, { meetings: meetings.all(), upcoming: markPast(meetings.upcoming(from, new Date(from.getTime() + days * 864e5)), new Set(persisted['*started'] || []), readText(path.join(RUNS, 'meetings.log'))), current: meetingNow() });
    }
    if (url.pathname === '/api/meetings' && req.method === 'POST') {
      const b = await body(req);
      if (b.op === 'end') return json(res, endMeeting());
      if (b.op === 'next') return json(res, nextTurn());
      if (b.op === 'now') return json(res, meetNow(b));
      if (b.op === 'start') {
        // Start now, ahead of time: today's (or the next) occurrence, keeping its length.
        const m = meetings.all().find((x) => x.id === b.id); if (!m) throw new Error(`no meeting ${b.id}`);
        const next = meetings.upcoming(new Date(Date.now() - 864e5), new Date(Date.now() + 366 * 864e5)).find((o) => o.id === m.id && new Date(o.end) > new Date());
        const s = new Date(), e = new Date(s.getTime() + (m.minutes || 30) * 60000);
        const cur = startMeeting({ id: m.id, title: m.title, agenda: m.agenda, attendees: m.attendees, presenters: m.presenters, start: local(s), end: local(e) }, 'james');
        if (next && new Date(next.start).toDateString() === s.toDateString()) { persisted['*started'].push(`${m.id}@${next.start}`); saveState(); }
        return json(res, cur);
      }
      return json(res, meetings.op(b));
    }
    if (url.pathname === '/api/merges' && req.method === 'GET') return json(res, board.merges());
    if (p[1] === 'merges' && p[2] && p[3] === 'diff') return json(res, board.mergeDiff(p[2]));
    if (url.pathname === '/api/merges' && req.method === 'POST') {
      const b = await body(req);
      if (b.op === 'merge') return json(res, board.merge(b.id));
      if (b.op === 'back') return json(res, board.mergeBack(b.id, b.note));
      if (b.op === 'refresh') { const closed = board.mergeSweep(); return json(res, { closed, merges: board.merges() }); }
      return json(res, { error: 'op must be merge, back or refresh' }, 400);
    }
    if (p[0] === 'api' && p[1] === 'squiggles' && p[2]) {
      const id = p[2], s = loadSquiggle(id);
      if (!s) return json(res, { error: 'no such squiggle' }, 404);
      const b = req.method === 'POST' ? await body(req) : {};
      switch (p[3]) {
        case 'events': return json(res, tailEvents(id, Number(url.searchParams.get('n') || 400)));
        case 'journal': return json(res, readText(path.join(sqDir(id), 'journal.md')));
        case 'send': send(id, b.text, b.from || 'james', { human: b.human }); return json(res, 'ok');
        case 'wake': return json(res, wake(id, b.why || 'asked'));
        case 'stop': stop(id); return json(res, 'ok');
        case 'clear': return json(res, clearChat(id));
        case 'remove': return json(res, removeSquiggle(id));
        case 'update': {
          const { charter, ...meta } = b;
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

server.listen(PORT, '127.0.0.1', () => console.log(`Agents on http://127.0.0.1:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
