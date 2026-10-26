// Who may talk to the server (t762). It listens on 127.0.0.1, but any web page the user opens can still
// send it requests: a "simple" cross-site POST (text/plain) or an <img> GET, or a DNS-rebinding page
// that reads everything. Only this Mac's own names get through: localhost, 127.0.0.1 and, when shared,
// its tailnet name (tailscale serve keeps the Host header) and its Cloudflare tunnel name (cloudflared keeps it too).
import { execFile } from 'node:child_process';

export function makeGuard(port, tailnetHost = () => '', tunnelHost = () => '') {
  const local = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const shared = (h) => [tailnetHost(), tunnelHost()].some((s) => !!s && h === s);
  const hostOk = (h) => local.has(h) || shared(h);
  const originOk = (o) => {
    let u; try { u = new URL(o); } catch { return false; }
    return (u.protocol === 'http:' && local.has(u.host)) || (u.protocol === 'https:' && shared(u.host));
  };
  // '' = allowed, else why not.
  return function refuse(req) {
    const h = req.headers || {};
    if (!hostOk(String(h.host || '').toLowerCase())) return 'host';
    if (h.origin !== undefined && !originOk(String(h.origin).toLowerCase())) return 'origin';
    if (h['sec-fetch-site'] === 'cross-site') return 'cross-site';
    if (req.method !== 'GET' && req.method !== 'HEAD' && !/^application\/json\b/i.test(String(h['content-type'] || ''))) return 'content-type';
    return '';
  };
}

// This Mac's MagicDNS name (e.g. mac.tailXXXX.ts.net), looked up now and again whenever a .ts.net Host
// arrives before it is known (tailscale may start after the server). At most every 30 s.
export function tailnetName(ts, env = process.env) {
  let name = '', last = 0;
  const look = () => {
    last = Date.now();
    execFile(ts, ['status', '--json'], { timeout: 10000, env: { ...env, TAILSCALE_BE_CLI: '1' } }, (e, out) => {
      try { name = String(JSON.parse(out).Self.DNSName || '').replace(/\.$/, '').toLowerCase(); } catch {}
    });
  };
  look();
  return {
    get: () => name,
    seen: (host) => { if (!name && /\.ts\.net$/i.test(host || '') && Date.now() - last > 30000) look(); },
  };
}
