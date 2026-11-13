// a guard blocked on I/O spends no CPU, so ulimit -t never stops it, and on a hook timeout the client runs the tool.
// Each wrapper kills node at 30 s wall and still refuses, leaving nothing running: not node, not a child it started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
test('guards that sleep', { concurrency: 4 }, async (t) => {
  await Promise.all(['claude', 'codex', 'cursor'].map((g) => t.test(`${g}: a guard that sleeps 120 s is stopped within 40 s and refuses`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-')), pidFile = path.join(dir, 'pid'), stub = path.join(dir, 'node');
    // The stub becomes the sleep (exec), so its pid is the one the wrapper must stop.
    // It first starts a child of its own, which must not outlive the wrapper either.
    const kidFile = path.join(dir, 'kid');
    fs.writeFileSync(stub, `#!/bin/sh\nsleep 120 &\necho $! > ${JSON.stringify(kidFile)}\necho $$ > ${JSON.stringify(pidFile)}\nexec sleep 120\n`, { mode: 0o755 });
    const t0 = Date.now(), sh = spawn(path.join(root, g, 'guard.sh'), { env: { PATH: process.env.PATH, AGENTS_ID: 'c', AGENTS_NODE: stub }, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; sh.stderr.on('data', (d) => { err += d; });
    const code = await new Promise((ok) => { const k = setTimeout(() => { sh.kill('SIGKILL'); ok('still running at 45 s'); }, 45000); sh.on('close', (c) => { clearTimeout(k); ok(c); }); });
    const pid = +fs.readFileSync(pidFile, 'utf8'), kid = +fs.readFileSync(kidFile, 'utf8');
    try {
      assert.equal(code, 2);
      assert.ok(Date.now() - t0 < 40000, `${Date.now() - t0} ms`);
      assert.match(err, /refused/);
      assert.equal(alive(pid), false, 'the sleep is left running');
      await new Promise((ok) => setTimeout(ok, 200));
      assert.equal(alive(kid), false, 'the guard\'s own child is left running');
    } finally { for (const p of [pid, kid]) if (alive(p)) process.kill(p, 'SIGKILL'); fs.rmSync(dir, { recursive: true }); }
  })));
});
