// t4268: a guard spinning in a synchronous loop outlives its caller: a hook timeout kills guard.sh, not node. 18 of them ran for hours
// at parent 1 and froze the Mac. Each wrapper caps CPU time, which works during the loop and doesn't count a busy machine against a guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const GUARDS = ['claude', 'codex', 'cursor'];
const OVER = 15; // CPU seconds: past this the limit didn't work
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const cpu = (pid) => { try { return execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(':').reduce((a, b) => a * 60 + +b, 0); } catch { return 0; } };
const until = async (f) => { while (!f()) await new Promise((r) => setTimeout(r, 200)); };
// A node that spins in place of the real guard. It says its pid first, so the test can watch it, and stops itself at 30 CPU seconds, so even a killed test leaves nothing behind. It checks rarely: asking for CPU time on every pass keeps macOS from enforcing the limit.
const rig = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't4268-')), pidFile = path.join(dir, 'pid'), stub = path.join(dir, 'node');
  fs.writeFileSync(stub, `#!/bin/sh\nexec "${process.execPath}" -e 'require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); let i = 0; while (++i % 1e7 || process.cpuUsage().user < 3e7);'\n`, { mode: 0o755 });
  return { dir, pidFile, env: { PATH: process.env.PATH, AGENTS_ID: 'c', AGENTS_NODE: stub } };
};
const clean = (r, pid) => { if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); fs.rmSync(r.dir, { recursive: true }); };

const file = (g) => path.join(root, g, 'guard.sh');
test('stuck guards', { concurrency: 4 }, async (t) => {
  await Promise.all(GUARDS.flatMap((g) => [
    t.test(`${g}: dies on its own with its caller gone`, async () => {
    const r = rig(); let pid;
    try {
      const sh = spawn(file(g), { env: r.env, stdio: 'ignore' });
      await until(() => fs.existsSync(r.pidFile) && fs.readFileSync(r.pidFile, 'utf8'));
      pid = +fs.readFileSync(r.pidFile, 'utf8');
      sh.kill('SIGKILL'); // the hook timed out
      await until(() => !alive(pid) || cpu(pid) > OVER);
      assert.equal(alive(pid), false, `still spinning after ${OVER} s of CPU`);
    } finally { clean(r, pid); }
  }),
    t.test(`${g}: refuses when its caller is still waiting`, async () => {
    const r = rig(); let pid;
    try {
      const sh = spawn(file(g), { env: r.env, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; sh.stderr.on('data', (d) => { err += d; });
      const code = new Promise((ok) => sh.on('close', ok));
      await until(() => fs.existsSync(r.pidFile) && fs.readFileSync(r.pidFile, 'utf8'));
      pid = +fs.readFileSync(r.pidFile, 'utf8');
      await until(() => !alive(pid) || cpu(pid) > OVER);
      assert.equal(alive(pid), false, `still spinning after ${OVER} s of CPU`);
      assert.equal(await code, 2);
      assert.match(err, /refused/);
    } finally { clean(r, pid); }
  }),
  ]));
});
for (const g of GUARDS) {
  test(`${g}: an ordinary call still answers`, () => {
    const r = spawnSync(file(g), { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/tmp' }), env: { PATH: process.env.PATH, AGENTS_ID: 'c', AGENTS_NODE: process.execPath }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
