import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { parseMcp, knownServers, mcpLaunch, toolPrefix } from '../mcp.mjs';
import { updateRefusal } from '../trust.mjs';

const CONNECTORS = ['claude.ai Gmail', 'claude.ai Google Drive', 'claude.ai Docs'];

test('parseMcp: empty and none mean no servers; commas split; bad names refused', () => {
  for (const v of [undefined, '', ' none ', 'OFF']) assert.deepEqual(parseMcp(v), []);
  assert.deepEqual(parseMcp('Gmail, notes-db,Gmail'), ['Gmail', 'notes-db']);
  assert.throws(() => parseMcp('Gmail; rm -rf'), /bad server name/);
});

test('knownServers: connectors, user, project and .mcp.json servers', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-')), cfg = path.join(d, 'c.json');
  fs.writeFileSync(cfg, JSON.stringify({ claudeAiMcpEverConnected: ['claude.ai New One'], mcpServers: { local: {} }, projects: { [d]: { mcpServers: { proj: {} } } } }));
  fs.writeFileSync(path.join(d, '.mcp.json'), JSON.stringify({ mcpServers: { dot: {} } }));
  const k = knownServers(d, cfg);
  for (const n of ['claude.ai New One', 'local', 'proj', 'dot']) assert.ok(k.includes(n), n);
  assert.deepEqual(knownServers(path.join(d, 'nowhere'), path.join(d, 'missing.json')), []);
  fs.rmSync(d, { recursive: true });
});

test('mcpLaunch: no list is strict with connectors off', () => {
  const r = mcpLaunch([], CONNECTORS);
  assert.deepEqual(r.args, ['--strict-mcp-config']);
  assert.equal(r.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
  assert.deepEqual(r.settings, { allowedMcpServers: [] });
});

test('mcpLaunch: local servers only is an allowlist with connectors off', () => {
  const r = mcpLaunch(['notes-db'], [...CONNECTORS, 'notes-db', 'other-tool']);
  assert.deepEqual(r.args, []);
  assert.equal(r.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
  assert.deepEqual(r.settings, { allowedMcpServers: [{ serverName: 'notes-db' }] });
});

test('mcpLaunch: a connector denies every other known server, short names resolve', () => {
  const known = [...CONNECTORS, 'notes-db', 'other-tool'], r = mcpLaunch(['gmail'], known);
  assert.deepEqual(r.env, {});
  const denied = r.settings.deniedMcpServers.map((x) => x.serverName);
  assert.deepEqual(denied, ['claude.ai Google Drive', 'claude.ai Docs']);
  // Denying a local server by name drops every connector, so local servers lose their tools instead.
  assert.deepEqual(r.disallow, ['mcp__notes-db', 'mcp__other-tool']);
  assert.deepEqual(mcpLaunch(['Gmail', 'notes-db'], known).disallow, ['mcp__other-tool']);
  assert.equal(toolPrefix('my server.v2'), 'mcp__my_server_v2');
});

test('mcp is set by the user or the lead, never by the squiggle itself', () => {
  const s = { id: 'seo', mcp: '' };
  assert.equal(updateRefusal({ mcp: 'Gmail' }, s, { caller: 'seo' })?.status, 403);
  assert.equal(updateRefusal({ mcp: 'Gmail' }, s, { caller: 'lead', callerLead: true }), null);
  assert.equal(updateRefusal({ mcp: 'Gmail' }, s, { owner: () => false })?.status, 403);
  assert.equal(updateRefusal({ mcp: 'Gmail' }, s, { owner: () => true }), null);
  assert.equal(updateRefusal({ mcp: 'a;b' }, s, { owner: () => true })?.status, 400);
});
