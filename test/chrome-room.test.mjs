// Claude in Chrome acts on the user's saved login, so Chrome tools refuse the room's own address, read from the room's config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, HOOK_CMD, withHook } from '../claude/guard.mjs';
import { DEFAULTS } from '../config.mjs';
import { REASONS } from '../fence.mjs';

const saved = { home: process.env.SQUIGGLES_HOME, port: process.env.PORT };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-chrome-'));
process.env.SQUIGGLES_HOME = dir; delete process.env.PORT;
test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (saved.home === undefined) delete process.env.SQUIGGLES_HOME; else process.env.SQUIGGLES_HOME = saved.home;
  if (saved.port !== undefined) process.env.PORT = saved.port;
});
const config = (c) => fs.writeFileSync(path.join(dir, 'config.json'), typeof c === 'string' ? c : JSON.stringify(c));
const chrome = (tool, tool_input) => check({ tool_name: `mcp__claude-in-chrome__${tool}`, tool_input, cwd: '/tmp' }, 'a');
const nav = (url) => chrome('navigate', { url });

test('every spelling of the configured port is refused', () => {
  config({ port: 4555 });
  for (const url of ['http://localhost:4555/', 'http://127.0.0.1:4555/api/asks', 'localhost:4555', 'http://0.0.0.0:4555', 'http://[::1]:4555/', 'HTTP://LOCALHOST:4555'])
    assert.equal(nav(url), REASONS.room, url);
});
test('a room URL inside another tool is refused', () => {
  config({ port: 4555 });
  assert.equal(chrome('javascript_tool', { text: "fetch('http://127.0.0.1:4555/api/deploys', { method: 'POST' })" }), REASONS.room);
  assert.equal(chrome('computer', { action: 'type', text: 'localhost:4555' }), REASONS.room);
  assert.equal(chrome('browser_batch', { steps: [{ tool: 'navigate', args: { url: 'http://localhost:4555/' } }] }), REASONS.room);
  assert.equal(chrome('tabs_create_mcp', { url: 'http://localhost:4555/' }), REASONS.room);
});
test('work on other sites keeps going', () => {
  config({ port: 4555, tailnet: true, cloudflare: true });
  for (const url of ['https://example.com/', 'http://127.0.0.1:5093/', 'http://localhost:45550/', 'https://ts.network/', 'https://a.ts.net-x.com/', 'https://a.trycloudflare.com-x.org/'])
    assert.equal(nav(url), '', url);
  assert.equal(chrome('tabs_context_mcp', {}), '');
  assert.equal(chrome('computer', { action: 'screenshot' }), '');
});
test('a share host is the room only while that share is offered', () => {
  const ts = 'https://mac.tail1234.ts.net/', cf = 'https://two-words.trycloudflare.com/';
  config({ port: 4555 });
  assert.equal(nav(ts), ''); assert.equal(nav(cf), '');
  config({ port: 4555, tailnet: true });
  assert.equal(nav(ts), REASONS.room); assert.equal(nav(ts.toUpperCase()), REASONS.room); assert.equal(nav(cf), '');
  config({ port: 4555, cloudflare: true });
  assert.equal(nav(ts), ''); assert.equal(nav(cf), REASONS.room);
});
test('no config file means the default port; PORT wins as it does for the server', () => {
  fs.rmSync(path.join(dir, 'config.json'), { force: true });
  assert.equal(nav(`http://localhost:${DEFAULTS.port}/`), REASONS.room);
  assert.equal(fs.existsSync(path.join(dir, 'config.json')), false, 'a hook writes nothing');
  config({ port: 4555 });
  process.env.PORT = '4666';
  try { assert.equal(nav('http://localhost:4666/'), REASONS.room); assert.equal(nav('http://localhost:4555/'), ''); }
  finally { delete process.env.PORT; }
});
test('a config that cannot be read refuses every Chrome tool', () => {
  config('{ not json');
  assert.match(nav('https://example.com/'), /config\.json/);
});
test('the room stays open to the shell: the CLI talks to it', () => {
  config({ port: 4555 });
  assert.equal(check({ tool_name: 'Bash', tool_input: { command: 'curl -s http://127.0.0.1:4555/api/state' }, cwd: '/tmp' }, 'a'), '');
});
test('the launch settings send Chrome tools to the hook', () => {
  const [entry] = withHook({}).hooks.PreToolUse, re = new RegExp(`^(${entry.matcher})$`);
  for (const t of ['navigate', 'javascript_tool', 'browser_batch', 'computer']) assert.match(`mcp__claude-in-chrome__${t}`, re);
  assert.match('Bash', re);
});
test('the real hook refuses the room and lets other sites through', () => {
  config({ port: 4555 });
  const run = (url) => spawnSync('sh', [HOOK_CMD], { input: JSON.stringify({ tool_name: 'mcp__claude-in-chrome__navigate', tool_input: { url }, cwd: '/tmp' }), encoding: 'utf8' });
  const no = run('http://localhost:4555/');
  assert.equal(no.status, 2); assert.equal(no.stderr, REASONS.room);
  assert.equal(run('https://example.com/').status, 0);
});
test('URLs Chrome normalises to the room are refused: padded port, encoded or wide dots, script escapes', () => {
  config({ port: 4555, tailnet: true, cloudflare: true });
  for (const url of ['http://localhost:04555/', 'http://127.0.0.1:0004555/x', 'https://mac.tail1234.ts%2enet/', 'https://mac.tail1234.ts%252Enet/', 'https://x.trycloudflare%2ecom/',
    'https://mac.tail1234.ts。net/', 'https://mac.tail1234.ts．net/', 'https://x.trycloudflare｡com/'])
    assert.equal(nav(url), REASONS.room, url);
  for (const text of ["location = 'https://mac.tail1234.ts\\x2enet/'", "open('https://x.trycloudflare\\u002ecom')", "fetch('https://mac.tail1234.ts\\u{2e}net')", "fetch('http://localhost:\\x34555/')"])
    assert.equal(chrome('javascript_tool', { text }), REASONS.room, text);
  for (const url of ['http://localhost:045550/', 'https://ts%2enetwork/']) assert.equal(nav(url), '', url);
});
