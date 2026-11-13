// At most two builds at once on the machine. Stub builds only; the real tools never run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const SHIMS = new URL('../bin/builds', import.meta.url).pathname, ENVFILE = new URL('../bin/squiggle-env.sh', import.meta.url).pathname;
const room = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-')), bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  // A stub build: says it started, holds until `go` appears.
  for (const n of ['xcodebuild', 'gradle']) fs.writeFileSync(path.join(bin, n), `#!/bin/sh\necho $$ >> ${dir}/started\nwhile [ ! -e ${dir}/go ]; do sleep 0.02; done\necho ran "$@"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${SHIMS}:${SHIMS}:${bin}:${process.env.PATH}`, AGENTS_BUILD_DIR: path.join(dir, 'slots'), AGENTS_BUILD_POLL: '0.05' };
  const run = (name, args = [], more = {}) => { const p = spawn(name, args, { env: { ...env, ...more } }); p.out = ''; p.err = ''; p.stdout.on('data', (d) => p.out += d); p.stderr.on('data', (d) => p.err += d); p.done = new Promise((r) => p.on('close', r)); return p; };
  return { dir, env, run, started: () => { try { return fs.readFileSync(path.join(dir, 'started'), 'utf8').trim().split('\n').length; } catch { return 0; } }, go: () => fs.writeFileSync(path.join(dir, 'go'), ''), end: () => fs.rmSync(dir, { recursive: true, force: true }) };
};
const until = async (f) => { for (let i = 0; i < 600 && !f(); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(f(), 'timed out'); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('two builds run, the third waits and says so, across tools', async () => {
  const r = room();
  try {
    const a = r.run('xcodebuild', ['build']), b = r.run('gradle', ['assemble']);
    await until(() => r.started() === 2);
    const c = r.run('xcodebuild', ['test']);
    await until(() => /waiting for a build slot/.test(c.err));
    await pause(300);
    assert.equal(r.started(), 2);
    r.go();
    assert.deepEqual(await Promise.all([a.done, b.done, c.done]), [0, 0, 0]);
    assert.equal(r.started(), 3);
    assert.match(c.out, /ran test/);
  } finally { r.end(); }
});

test('a build that died frees its slot', async () => {
  const r = room();
  try {
    const a = r.run('xcodebuild', ['build']), b = r.run('xcodebuild', ['build']);
    await until(() => r.started() === 2);
    a.kill('SIGKILL'); await a.done;
    const c = r.run('xcodebuild', ['build']);
    await until(() => r.started() === 3);
    r.go(); await Promise.all([b.done, c.done]);
  } finally { r.end(); }
});

test('a full house never hangs: past the wait it runs anyway', async () => {
  const r = room();
  try {
    const a = r.run('gradle'), b = r.run('gradle');
    await until(() => r.started() === 2);
    const c = r.run('gradle', [], { AGENTS_BUILD_WAIT: '0' });
    await until(() => r.started() === 3);
    assert.match(c.err, /running without a slot/);
    r.go(); await Promise.all([a.done, b.done, c.done]);
  } finally { r.end(); }
});

test('a question to the tool takes no slot', async () => {
  const r = room();
  try {
    const a = r.run('xcodebuild', ['build']), b = r.run('xcodebuild', ['build']);
    await until(() => r.started() === 2);
    const q = r.run('xcodebuild', ['-showsdks']);
    await until(() => r.started() === 3);
    assert.equal(q.err, '');
    r.go(); await Promise.all([a.done, b.done, q.done]);
  } finally { r.end(); }
});

test('a tool that is not installed says so instead of looping', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-')), sh = '/bin:/usr/sbin';
  try {
    assert.throws(() => execFileSync(path.join(SHIMS, 'gradle'), [], { env: { PATH: `${SHIMS}:${sh}`, AGENTS_BUILD_DIR: dir }, stdio: 'pipe' }), (e) => e.status === 127 && /not found/.test(e.stderr));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a squiggle shell finds the cap first, even after a login shell reorders PATH', () => {
  const out = execFileSync('/bin/zsh', ['-c', `export PATH=/usr/bin:/bin; source ${ENVFILE}; command -v xcodebuild`], { env: { ...process.env, AGENTS_BUILDS: SHIMS }, encoding: 'utf8' });
  assert.equal(out.trim(), path.join(SHIMS, 'xcodebuild'));
});
