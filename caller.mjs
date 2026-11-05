// Who is on the other end of a local request. A squiggle can put anything in the body (by, AGENTS_ID),
// but not change whose child its shell is: the process holding the client socket, and its parent chain, can't lie.
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((ok) => execFile(cmd, args, { timeout: 5000 }, (e, out) => ok(e ? '' : String(out))));

// `ps -A -o pid=,ppid=` → Map pid → ppid.
export const parents = (ps) => new Map(ps.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([a, b]) => a > 0 && b >= 0));
// pid, its parent, its grandparent ... up to launchd.
export function chain(pid, pp) { const out = []; while (pid > 1 && !out.includes(pid)) { out.push(pid); pid = pp.get(pid); } return out; }
// `lsof -Fp` lines → pids, minus the server's own end of the connection.
export const sockPids = (lsof, self = process.pid) => [...new Set(lsof.split('\n').filter((l) => /^p\d+$/.test(l)).map((l) => +l.slice(1)))].filter((p) => p !== self);

// The one process on the far end of a local socket, null when unknown. A header can't change it: a proxy is its own process.
async function peerPid(req) {
  const port = req.socket?.remotePort;
  if (!port || !/^(::1|127\.|::ffff:127\.)/.test(req.socket?.remoteAddress || '')) return null;
  const pids = sockPids(await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fp']));
  return pids.length === 1 ? pids[0] : null;
}

// The calling process's chain, [] when unknown (not local, or the lookup failed): callers decide what unknown means.
export async function callerChain(req) {
  const pid = await peerPid(req); if (!pid) return [];
  return chain(pid, parents(await run('ps', ['-A', '-o', 'pid=,ppid='])));
}

// Installed browsers, by the file the process runs: lsof's txt entry, because `ps comm` is argv[0], which any process sets.
// Whole paths, so a copy elsewhere fails. Unlisted browsers fall back to "terminal"; a room passcode lets them in by session.
const APPS = 'Google Chrome( Beta| Canary)?|Chromium|Microsoft Edge|Brave Browser|Arc|Opera|Vivaldi|Dia|Firefox( Developer Edition| Nightly)?';
const HELPER = '[^/]+ Helper( \\([A-Za-z]+\\))?';
const INSTALLED = new RegExp(`^/Applications/(${APPS})\\.app/Contents/(Frameworks/.+/Helpers/${HELPER}\\.app/Contents/MacOS/${HELPER}|MacOS/[^/]+|MacOS/plugin-container\\.app/Contents/MacOS/plugin-container)$`);
const WEBKIT = /^(\/System\/Volumes\/Preboot\/Cryptexes\/OS)?\/System\/Library\/Frameworks\/WebKit\.framework\/Versions\/A\/XPCServices\/com\.apple\.WebKit\.Networking\.xpc\/Contents\/MacOS\/com\.apple\.WebKit\.Networking$/;
export const isBrowserFile = (f) => INSTALLED.test(f) || WEBKIT.test(f);
// `lsof -Fn` lines → the first file named: for `-d txt` that's the running program.
export const firstFile = (lsof) => lsof.split('\n').find((l) => l.startsWith('n'))?.slice(1) || '';
// Is the process holding this socket a browser? Forged headers say so; this is what a detached child can't fake. Unknown is no.
export async function browserCaller(req) {
  const pid = await peerPid(req);
  return !!pid && isBrowserFile(firstFile(await run('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn'])));
}
