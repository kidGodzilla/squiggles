// Who is on the other end of a local request (t1384). A squiggle can put anything in the body (by, AGENTS_ID),
// but not change whose child its shell is: the process holding the client socket, and its parent chain, can't lie.
import { execFile } from 'node:child_process';

const run = (cmd, args) => new Promise((ok) => execFile(cmd, args, { timeout: 5000 }, (e, out) => ok(e ? '' : String(out))));

// `ps -A -o pid=,ppid=` → Map pid → ppid.
export const parents = (ps) => new Map(ps.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter(([a, b]) => a > 0 && b >= 0));
// pid, its parent, its grandparent ... up to launchd.
export function chain(pid, pp) { const out = []; while (pid > 1 && !out.includes(pid)) { out.push(pid); pid = pp.get(pid); } return out; }
// `lsof -Fp` lines → pids, minus the server's own end of the connection.
export const sockPids = (lsof, self = process.pid) => [...new Set(lsof.split('\n').filter((l) => /^p\d+$/.test(l)).map((l) => +l.slice(1)))].filter((p) => p !== self);

// The calling process's chain, [] when unknown (not local, or the lookup failed): callers decide what unknown means.
export async function callerChain(req) {
  const port = req.socket?.remotePort;
  if (!port || !/^(::1|127\.|::ffff:127\.)/.test(req.socket?.remoteAddress || '') || req.headers?.['x-forwarded-for']) return [];
  const [ls, ps] = await Promise.all([run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fp']), run('ps', ['-A', '-o', 'pid=,ppid='])]);
  const pids = sockPids(ls); if (pids.length !== 1) return [];
  return chain(pids[0], parents(ps));
}
