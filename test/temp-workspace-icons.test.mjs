// Drawing icons starts headless Chrome, and Chrome without a mock keychain asks macOS for one in a dialog on the owner's screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempWorkspace } from '../config.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

test('every headless Chrome the app starts uses the mock keychain', () => {
  const files = [...fs.readdirSync(REPO).filter((f) => f.endsWith('.mjs')), ...fs.readdirSync(path.join(REPO, 'bin'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join('bin', e.name))];
  const lines = files.flatMap((f) => fs.readFileSync(path.join(REPO, f), 'utf8').split('\n').filter((l) => l.includes('--headless')).map((l) => ({ f, l })));
  assert.ok(lines.length > 0, 'the icon drawing launch is found');
  for (const { f, l } of lines) assert.match(l, /--use-mock-keychain/, f);
});

test('temp folders are test workspaces, anywhere else is real', () => {
  assert.equal(tempWorkspace(path.join(os.tmpdir(), 'room')), true);
  assert.equal(tempWorkspace('/tmp/room'), true);
  assert.equal(tempWorkspace(fs.realpathSync(os.tmpdir())), true);
  assert.equal(tempWorkspace(path.join(os.homedir(), '.squiggles')), false);
  assert.equal(tempWorkspace('/tmpfoo/room'), false);
});

test('a test workspace boots without drawing icons, a real one still draws', { timeout: 120000 }, async () => {
  const room = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-icons-'));
  const real = fs.mkdtempSync(path.join(os.homedir(), '.sq-icons-'));
  const servers = [];
  try {
    // A copy of the code, because the server runs render-icons.sh from beside itself: the stub leaves a mark instead of starting Chrome.
    const code = path.join(room, 'code');
    fs.cpSync(REPO, code, { recursive: true, filter: (f) => path.basename(f) !== '.git' });
    fs.writeFileSync(path.join(code, 'bin', 'render-icons.sh'), '#!/bin/sh\ntouch "$SQUIGGLES_HOME/drew"\n', { mode: 0o755 });
    const stubs = path.join(room, 'stubs'); fs.mkdirSync(stubs);
    fs.writeFileSync(path.join(stubs, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

    const boot = async (data) => {
      const d = path.join(data, 'squiggles', 'boss'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'squiggle.json'), JSON.stringify({ name: 'Boss', role: 'Test', cwd: '~', every: 0, paused: true, permissionMode: 'auto', lead: true }));
      fs.writeFileSync(path.join(d, 'charter.md'), 'Test fixture.\n'); fs.writeFileSync(path.join(d, 'journal.md'), '');
      const port = await freePort();
      fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ schema: 1, port, userName: 'Sam' }));
      const server = spawn(process.execPath, ['server.mjs'], { cwd: code, stdio: 'ignore', env: { ...process.env, SQUIGGLES_HOME: data, PATH: `${stubs}:${process.env.PATH}` } });
      servers[servers.length] = server;
      for (let i = 0; i < 300; i++) { if (await fetch(`http://127.0.0.1:${port}/api/humans`).then((r) => r.ok).catch(() => false)) return; await pause(200); }
      assert.fail('server up');
    };

    const temp = path.join(room, 'data'); fs.mkdirSync(temp);
    await boot(temp); await boot(real);
    for (let i = 0; i < 300 && !fs.existsSync(path.join(real, 'drew')); i++) await pause(200);
    assert.ok(fs.existsSync(path.join(real, 'drew')), 'the real workspace draws its icons');
    await pause(1000);
    assert.ok(!fs.existsSync(path.join(temp, 'drew')), 'the test workspace does not');
  } finally {
    for (const s of servers) if (s.exitCode === null) { s.kill(); await new Promise((r) => { s.on('exit', r); setTimeout(r, 3000); }); }
    fs.rmSync(room, { recursive: true, force: true });
    fs.rmSync(real, { recursive: true, force: true });
  }
});
