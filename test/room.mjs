// Boots a throwaway room for server tests on a free port, so suites running at once don't clash.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const freePort = () => new Promise((res, rej) => {
  const s = net.createServer().once('error', rej).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

// Writes config.json (with a free port) into d, starts server.mjs there and waits for it to listen.
export async function boot(d, cfg = {}, env = {}) {
  const port = await freePort();
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ schema: 1, port, ...cfg }));
  const p = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, SQUIGGLES_HOME: d, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const up = await new Promise((res) => {
    const t = setTimeout(() => res(false), 15000);
    for (const s of [p.stdout, p.stderr]) s.on('data', (b) => { out += b; if (/ on http/.test(out)) { clearTimeout(t); res(true); } });
    p.on('exit', () => { clearTimeout(t); res(false); });
  });
  // The server still writes runs/ while it shuts down; removing d before it exits races it.
  const halt = async () => {
    const gone = new Promise((res) => (p.exitCode !== null || p.signalCode) ? res() : p.once('exit', res));
    p.kill(); await gone;
  };
  const stop = async () => { await halt(); fs.rmSync(d, { recursive: true, force: true }); };
  return { up, out, port, halt, stop };
}
