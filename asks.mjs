// Command approvals. A squiggle whose write auto mode blocked
// files the exact command; the owner runs it once from the page, or denies it. Command, cwd and why are frozen at filing.
// Run binds to what the owner saw: sha256 of cwd + NUL + cmd as UTF-8. State in asks.json, every event in an append-only log.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn as spawn_ } from 'node:child_process';

const DAY = 864e5, MAX_CMD = 8192, MAX_WHY = 1000, MAX_PENDING = 5;
export const askHash = (cwd, cmd) => crypto.createHash('sha256').update(Buffer.from(`${cwd}\u0000${cmd}`, 'utf8')).digest('hex');
const RUN_MS = 10 * 6e4, MAX_OUT = 256 * 1024, SH = fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/sh';
// Secret-shaped strings are masked in stored and posted output . Commit hashes and ids stay readable.
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, /\bglpat-[A-Za-z0-9_-]{16,}/g, /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g, /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, /\bxapp-[A-Za-z0-9-]{10,}/g,
  /\bSG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // SendGrid
  /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}/g, /\bwhsec_[A-Za-z0-9]{10,}/g, // Stripe
  /\bAIza[0-9A-Za-z_-]{30,}/g, /\bya29\.[0-9A-Za-z_-]{16,}/g, /\b1\/\/0[0-9A-Za-z_-]{20,}/g, // Google key, OAuth access and refresh
  /\bdop_v1_[a-f0-9]{40,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
// UPPER_SNAKE names that hold secrets (SMS_KEY, AUTH_KEYS, SENTRY_DSN, ...), as env lines, export lines and
// dokku config:show / config:set output ("NAME:   value"). The whole value goes, to the end of the line or its quote.
const SECRET_NAME = String.raw`\b[A-Z][A-Z0-9_]*(?:KEYS?|SECRETS?|TOKENS?|PASS|PASSWORD|PASSWD|PASSPHRASE|DSN|CREDENTIALS?|AUTH|SALT|COOKIE|PRIVATE|CONFIG|B64|CERT)\b`;
// Any case, camelCase too (encryptionKey, sms_key, ?auth=): a name ending in a secret word, then = or :.
const SECRET_WORD = String.raw`(?:^|(?<=[\s"'{,;&?(]))[A-Za-z0-9_.-]*(?:key|keys|secret|secrets|token|tokens|pass|password|passwd|passphrase|dsn|credentials?|auth|salt|sig|signature)(?=["']?[ \t]*[:=])`;
// Fallback: long random-looking runs. Mixed case plus digits, so hex shas, uuids and words stay readable.
const randomish = (w) => /[a-z]/.test(w) && /[A-Z]/.test(w) && /[0-9]/.test(w) && (w.match(/\//g) || []).length <= w.length / 16;
export function mask(text) {
  let t = String(text);
  for (const re of SECRETS) t = t.replace(re, '[masked]');
  t = t.replace(new RegExp(`(${SECRET_NAME}["']?[ \\t]*[:=][ \\t]*)("[^"\\n]*"|'[^'\\n]*'|[^\\s"'][^\\n]*)`, 'g'), (_, k, v) => `${k}${/^["']/.test(v) ? v[0] + '[masked]' + v[0] : '[masked]'}`);
  t = t.replace(new RegExp(`(${SECRET_WORD}["']?[ \\t]*[:=][ \\t]*)("[^"\\n]*"|'[^'\\n]*'|[^\\s"',;&}]+)`, 'gim'), (_, k, v) => `${k}${/^["']/.test(v) ? v[0] + '[masked]' + v[0] : '[masked]'}`);
  t = t.replace(/((?:^|\s)(?:-u|--user)(?:[ \t]+|=)["']?)[^\s"']+/g, '$1[masked]'); // curl -u user:pass
  // Auth headers: custom x-*auth* ones and the standard ones.
  t = t.replace(/(\b(?:x-[\w-]*auth[\w-]*|authorization|proxy-authorization|cookie|set-cookie|x-api-key)["']?[ \t]*:[ \t]*)[^\s"'][^\n]*/gi, '$1[masked]');
  t = t.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[masked]');
  t = t.replace(/((?:^|[\s"'{,;&?])[\w.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*["']?\s*[:=]\s*["']?)[^\s"',;&]{4,}/gim, '$1[masked]');
  t = t.replace(/(\/\/[^\s:/@]*:)[^\s@/]+@/g, '$1[masked]@'); // user:password@, redis://:password@
  t = t.replace(/(\/\/)[A-Za-z0-9_-]{16,}@/g, '$1[masked]@'); // key@host (Sentry DSN)
  t = t.replace(/[A-Za-z0-9_-]{32,}|[A-Za-z0-9+/]{40,}={0,2}/g, (w) => (randomish(w) ? '[masked]' : w));
  return t;
}
// Runs a claimed ask once: zsh -c (sh where there's no zsh) in the frozen cwd, the server's env minus the squiggle markers, stdin closed,
// SIGTERM at the timeout then SIGKILL, output capped. Resolves { exit, ms, out } with out masked.
export function runAsk(a, { spawn = spawn_, ms: limit = RUN_MS, cap = MAX_OUT } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now(), env = { ...process.env }; delete env.AGENTS_ID; delete env.CLAUDE_ENV_FILE;
    let out = '', size = 0, cut = false, timedOut = false, done = false;
    const end = (exit, extra = '') => {
      if (done) return; done = true; clearTimeout(kill);
      resolve({ exit, ms: Date.now() - t0, out: mask(out + (cut ? `\n[output cut at ${cap / 1024} KB]` : '') + (timedOut ? `\n[stopped after ${Math.round(limit / 1000)}s]` : '') + extra) });
    };
    let p; try { p = spawn(SH, ['-c', a.cmd], { cwd: a.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); } catch (e) { return end(127, e.message); }
    const take = (d) => { if (size >= cap) { cut = true; return; } const s = d.toString('utf8'); size += d.length; out += size > cap ? s.slice(0, cap - (size - d.length)) : s; if (size > cap) cut = true; };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const group = (sig) => { try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch {} } };
    const kill = setTimeout(() => { timedOut = true; group('SIGTERM'); setTimeout(() => group('SIGKILL'), 5000).unref(); }, limit);
    p.on('error', (e) => end(127, e.message));
    const code = (c, sig) => c ?? (sig ? 128 : 1);
    p.on('close', (c, sig) => end(code(c, sig)));
    // A backgrounded child can hold the pipes open; the shell's exit decides.
    p.on('exit', (c, sig) => setTimeout(() => end(code(c, sig)), 2000).unref());
  });
}
const err = (m, code = 400) => Object.assign(new Error(m), { code });

export function createAsks({ file, log, now = () => Date.now() }) {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { n: 0, asks: [] }; } };
  const save = (s) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s, null, 1)); };
  const note = (ev, a, extra = {}) => { fs.mkdirSync(path.dirname(log), { recursive: true }); fs.appendFileSync(log, JSON.stringify({ t: new Date(now()).toISOString(), ev, id: a.id, by: a.by, sha: a.sha, ...extra }) + '\n'); };
  // Pending asks past 24h expire, logged once.
  function fresh() {
    const s = load(); let changed = false;
    for (const a of s.asks) if (a.status === 'pending' && now() > a.expires) { a.status = 'expired'; a.ended = now(); note('expired', a); changed = true; }
    if (changed) save(s);
    return s;
  }
  function file_({ by, cwd, cmd, why }) {
    if (!by) throw err('only a squiggle files asks', 403);
    cmd = typeof cmd === 'string' ? cmd : '';
    if (!cmd.trim()) throw err('ask run "<command>" "<why>": the command is empty');
    if (cmd.length > MAX_CMD) throw err(`command over ${MAX_CMD} characters`);
    if (cmd.includes('\u0000')) throw err('command contains NUL');
    if (!path.isAbsolute(String(cwd || '')) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) throw err(`cwd ${cwd} is not a folder`);
    const s = fresh();
    if (s.asks.filter((a) => a.by === by && a.status === 'pending').length >= MAX_PENDING) throw err(`${by} already has ${MAX_PENDING} pending asks: wait or withdraw one`, 429);
    const a = { id: `a${++s.n}`, by, cwd, cmd, why: String(why || '').slice(0, MAX_WHY), sha: askHash(cwd, cmd), status: 'pending', created: now(), expires: now() + DAY };
    s.asks.push(a); save(s); note('filed', a, { cwd, cmd });
    return a;
  }
  const list = ({ all = false } = {}) => fresh().asks.filter((a) => all || a.status === 'pending');
  const get = (id) => { const a = fresh().asks.find((x) => x.id === id); if (!a) throw err(`no ask ${id}`, 404); return a; };
  // The owner denies any pending ask; a squiggle withdraws only its own. Final either way.
  function deny(id, { by = '', owner = false, note: why = '' } = {}) {
    const s = fresh(), a = s.asks.find((x) => x.id === id);
    if (!a) throw err(`no ask ${id}`, 404);
    if (!owner && (!by || by !== a.by)) throw err(`only the owner denies ${a.by}'s ask; a squiggle withdraws only its own`, 403);
    if (a.status !== 'pending') throw err(`${id} is ${a.status}`, 409);
    Object.assign(a, { status: owner ? 'denied' : 'withdrawn', ended: now(), ...(why ? { note: String(why).slice(0, MAX_WHY) } : {}) });
    save(s); note(a.status, a, { who: owner ? 'owner' : by, ...(a.note ? { note: a.note } : {}) });
    return a;
  }
  // pending -> running, once, only for the bytes the owner saw. The runner calls this after its own auth checks.
  function claim(id, sha, who) {
    const s = fresh(), a = s.asks.find((x) => x.id === id);
    if (!a) throw err(`no ask ${id}`, 404);
    if (a.status !== 'pending') throw err(`${id} is ${a.status}`, 409);
    if (typeof sha !== 'string' || sha !== askHash(a.cwd, a.cmd) || sha !== a.sha) throw err(`${id} changed since the page showed it: reload and check it again`, 409);
    Object.assign(a, { status: 'running', started: now(), runBy: who }); save(s); note('running', a, { who });
    return { ...a };
  }
  function finish(id, { exit, ms, out = '' }) {
    const s = load(), a = s.asks.find((x) => x.id === id);
    if (!a || a.status !== 'running') throw err(`${id} is not running`, 409);
    Object.assign(a, { status: exit === 0 ? 'done' : 'failed', exit, ms, out, ended: now() }); save(s);
    note(a.status, a, { exit, ms, outSha: crypto.createHash('sha256').update(out).digest('hex') });
    return a;
  }
  return { file: file_, list, get, deny, claim, finish };
}
