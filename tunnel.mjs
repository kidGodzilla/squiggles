// Share over a Cloudflare quick tunnel: `cloudflared tunnel --url` gives a random https://<words>.trycloudflare.com that
// proxies to this server, no account needed. That URL is on the public internet, so the room passcode is what keeps it closed.
// The tunnel is a child of the server: shutdown and exit stop it, a pid file catches one a killed server left, and a restart gets a new URL.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const MIN_CODE = 8; // public internet: a 4-digit code falls to the global try cap in days
export const TUNNEL_HOST = /\.trycloudflare\.com$/i;

export function cloudflaredBin(env = process.env) {
  if (env.CLOUDFLARED_BIN) return env.CLOUDFLARED_BIN;
  // The login item's PATH has no Homebrew.
  return ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'].find((f) => fs.existsSync(f)) || 'cloudflared';
}

// The first trycloudflare URL cloudflared prints (it logs to stderr).
export const urlIn = (text) => (String(text).match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com(?![\w.-])/i) || [])[0]?.toLowerCase() || '';

// { start(), stop(), status() -> { on, url, starting, error } }. onChange(status) on every change.
// A cloudflared left by a server that died without stopping it (SIGKILL, crash) still holds its public URL: end it.
// Only if that pid is still a cloudflared, so a reused pid is left alone.
export function killStale(pidFile) {
  let pid; try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { return false; }
  try { fs.unlinkSync(pidFile); } catch {}
  if (!pid) return false;
  let cmd = ''; try { cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); } catch { return false; }
  if (!/cloudflared/.test(cmd)) return false;
  try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
}

export function createTunnel({ port, bin = cloudflaredBin(), onChange = () => {}, wait = 30000, pidFile = '' }) {
  let proc = null, url = '', error = '';
  const status = () => ({ on: !!url, url, starting: !!proc && !url, error });
  const changed = () => onChange(status());
  function start() {
    if (proc) return Promise.resolve(status());
    error = ''; url = '';
    return new Promise((ok) => {
      let buf = '', done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(t); ok(status()); changed(); } };
      const p = proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
      const read = (d) => { if (url) return; buf = (buf + d).slice(-8192); const u = urlIn(buf); if (u) { url = u; finish(); } };
      p.stdout.on('data', read); p.stderr.on('data', read);
      if (pidFile && p.pid) fs.writeFileSync(pidFile, String(p.pid));
      p.on('error', (e) => {
        error = e.code === 'ENOENT' ? 'cloudflared not found: brew install cloudflared' : e.message;
        if (proc === p) { proc = null; url = ''; }
        if (done) changed(); else finish();
      });
      p.on('exit', (code) => {
        if (pidFile) try { if (fs.readFileSync(pidFile, 'utf8') === String(p.pid)) fs.unlinkSync(pidFile); } catch {}
        if (proc !== p) return;
        proc = null; url = '';
        if (!error && code) error = `cloudflared exited ${code}: ${buf.trim().split('\n').pop() || ''}`.trim();
        if (done) changed(); else finish();
      });
      const t = setTimeout(() => { if (!url) { error = 'cloudflared gave no URL in time'; stop(); finish(); } }, wait);
    });
  }
  function stop() {
    const p = proc; proc = null; url = '';
    if (p) { p.kill('SIGTERM'); setTimeout(() => { if (p.exitCode == null && p.signalCode == null) p.kill('SIGKILL'); }, 3000).unref(); }
    changed(); return status();
  }
  return { start, stop, status, host: () => (url ? new URL(url).host : '') };
}
