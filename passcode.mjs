// Optional room passcode (t913): casual snoop protection, not Fort Knox. room.json `passcode` holds a salted scrypt hash
// and the 'local skips' choice. Unlocking sets an HttpOnly SameSite=Strict cookie.
// Read once at boot, then memory only (t1396): writing room.json can't add a session; a swapped hash counts only after a
// restart, and gated merges check the caller's process tree first (t1423).
// Sessions are never written, so unlocks end with a restart.
// Local non-browser callers (the CLI, squiggles) always pass; a browser on this Mac passes only when local skips is on.
import crypto from 'node:crypto';

const COOKIE = 'agents_s', DAY = 864e5, TTL = 30 * DAY;
const PROXIED = /\.(ts\.net|trycloudflare\.com)$/i; // hosts only tailscale serve or cloudflared hand us
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashCode = (code, salt) => crypto.scryptSync(String(code), salt, 32).toString('hex');

export function makePasscode({ read, write, now = () => Date.now() }) {
  const disk = (p) => (p?.hash ? { salt: p.salt, hash: p.hash, localSkips: !!p.localSkips, ...(p.codeLen && { codeLen: p.codeLen }) } : null);
  let mem = disk(read());
  if (read()?.sessions) write(mem); // sessions an older server stored
  const cfg = () => mem;
  const save = (p) => { mem = p?.hash ? { ...disk(p), sessions: p.sessions || {} } : null; write(disk(mem)); };
  const fails = new Map(); // client -> { n, until }
  let recent = []; // failure times, all clients

  const cookieTok = (req) => (String(req.headers?.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`)) || [])[1] || '';
  // Belt and braces: a request naming the tailnet or tunnel host, or carrying Cloudflare's client header, came through a proxy.
  const isLocal = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket?.remoteAddress || '') && !req.headers?.['x-forwarded-for'] && !req.headers?.['cf-connecting-ip'] && !PROXIED.test(String(req.headers?.host || '').split(':')[0]);
  // Node's fetch sends sec-fetch-mode too, so only these mark a browser.
  const isBrowser = (req) => ['sec-fetch-site', 'origin', 'cookie'].some((h) => req.headers?.[h] !== undefined) || /Mozilla\//.test(req.headers?.['user-agent'] || '');
  // Local non-browser callers (CLI, scripts) get their own bucket, so one can't lock out the user's browser on 127.0.0.1.
  const client = (req) => String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() + (isLocal(req) && !isBrowser(req) ? ' cli' : '');
  const live = (p) => { const t = now(), s = {}; for (const [k, exp] of Object.entries(p.sessions || {})) if (exp > t) s[k] = exp; return s; };
  const hasSession = (req, p) => { const t = cookieTok(req); return !!t && (live(p)[sha(t)] || 0) > now(); };

  function ok(req) {
    const p = cfg();
    if (!p?.hash) return true;
    if (isLocal(req) && (!isBrowser(req) || p.localSkips)) return true;
    return hasSession(req, p);
  }
  const status = (req) => { const p = cfg(); return { set: !!p?.hash, ok: ok(req), localSkips: !!p?.localSkips }; };

  function issue(p) {
    const tok = crypto.randomBytes(32).toString('hex'), sessions = live(p);
    sessions[sha(tok)] = now() + TTL; save({ ...p, sessions }); return tok;
  }
  const cookie = (req, tok, age = TTL / 1000) => {
    const secure = req.headers?.['x-forwarded-proto'] === 'https' || PROXIED.test(String(req.headers?.host || '').split(':')[0]);
    return `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  };

  const err = (m, code = 400) => Object.assign(new Error(m), { code });
  // The code against the hash, behind the same per-client and global limits as unlocking. Step-up checks answer a wrong code
  // with 403: the page reloads to the lock screen on 401, which means the session ended.
  function check(req, p, code, bad = 401) {
    // An empty code is a slip, not a guess: refused without counting.
    if (code == null || code === '') throw err('wrong passcode', bad);
    const c = client(req), f = fails.get(c) || { n: 0, until: 0 }, t = now();
    recent = recent.filter((x) => t - x < 10 * 60000);
    if (f.until > t) throw err(`too many tries, wait ${Math.ceil((f.until - t) / 1000)} s`, 429);
    if (recent.length >= 30) throw err('too many tries, wait a few minutes', 429);
    const want = Buffer.from(p.hash, 'hex'), got = Buffer.from(hashCode(code ?? '', p.salt), 'hex');
    if (!crypto.timingSafeEqual(want, got)) {
      // The global cap is for tailnet guessing; a local process could read the hash from room.json anyway.
      f.n++; if (!isLocal(req)) recent.push(t);
      if (f.n >= 5) f.until = t + Math.min(15 * 60000, 30000 * 2 ** (f.n - 5));
      fails.set(c, f); throw err('wrong passcode', bad);
    }
    fails.delete(c);
  }
  // Gated merges (t1384): a live unlocked session cookie, from a browser that typed the passcode.
  // Not ok(): local non-browser callers and local skips pass that. No passcode set means no sessions, so no.
  function session(req, what = 'merging gated work') {
    const p = cfg(); if (!p?.hash) throw err(`Set a room passcode first (Settings > Security): ${what} needs it`, 403);
    if (!hasSession(req, p)) throw Object.assign(err('Unlock with the room passcode first', 403), { unlock: true });
    return true;
  }

  // Running an ask: the room's own computer only. isLocal (no x-forwarded-for, Host not .ts.net: tailscale serve proxies
  // tailnet requests to 127.0.0.1) and a live cookie. No CLI pass, no local skips, so tailnet sessions and peers get Copy only.
  function owner(req) {
    const p = cfg(); if (!p?.hash) throw err('Set a room passcode first (Settings > Security): running an ask needs it', 401);
    if (!isLocal(req)) throw err('Run works only on the computer running the room: copy the command instead', 403);
    if (!hasSession(req, p)) throw Object.assign(err('Unlock with the room passcode first', 401), { unlock: true });
    return true;
  }

  // Returns { body, cookie? }. Throws Error with .code for HTTP status.
  function op(req, b = {}) {
    const p = cfg() || {};
    if (b.op === 'unlock') {
      if (!p.hash) return { body: status(req) };
      check(req, p, b.code);
      return { body: { ...status(req), ok: true }, cookie: cookie(req, issue(p)) };
    }
    if (b.op === 'lock') {
      const t = cookieTok(req);
      if (t && p.sessions) { const sessions = live(p); delete sessions[sha(t)]; save({ ...p, sessions }); }
      return { body: { ...status(req), ok: false }, cookie: cookie(req, '', 0) };
    }
    if (!ok(req)) throw err('locked', 401);
    // Changing, clearing or loosening a set passcode needs the current one (t950), from anyone, CLI included.
    if (p.hash && ['set', 'clear', 'local'].includes(b.op)) check(req, p, b.old, 403);
    if (b.op === 'set') {
      const code = String(b.code ?? '');
      if (code.length < 4 || code.length > 64) throw err('passcode: 4 to 64 characters');
      const salt = crypto.randomBytes(16).toString('hex');
      const next = { salt, hash: hashCode(code, salt), localSkips: !!p.localSkips, codeLen: code.length, sessions: {} }; // codeLen: public share needs 8+
      save(next);
      // The device that set it stays unlocked; every other session ends.
      return isBrowser(req) ? { body: { ...status(req), ok: true }, cookie: cookie(req, issue(next)) } : { body: status(req) };
    }
    if (b.op === 'clear') { save(null); return { body: status(req), cookie: cookie(req, '', 0) }; }
    if (b.op === 'local') { if (!p.hash) throw err('no passcode set'); save({ ...p, localSkips: !!b.on }); return { body: status(req) }; }
    if (b.op === 'status' || !b.op) return { body: status(req) };
    throw err('op: unlock, lock, set, clear, local or status');
  }

  return { ok, status, op, session, owner, codeLen: () => mem?.codeLen || 0 };
}
