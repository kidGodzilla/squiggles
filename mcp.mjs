// MCP servers per squiggle. Default none: a squiggle gets only the servers in its `mcp` field.
// Claude Code facts (probed): allowedMcpServers in --settings filters local and project servers but drops every
// claude.ai connector, even one it names; deniedMcpServers removes a connector by name. So a list with no claude.ai
// connector is fail-closed (allowlist plus connectors off); a list with one denies every other known server.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const AI = 'claude.ai ';

export function parseMcp(v) {
  const s = String(v ?? '').trim();
  if (!s || /^(none|off)$/i.test(s)) return [];
  const list = [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
  const bad = list.find((x) => !/^[\w .:-]{1,80}$/.test(x));
  if (bad) throw new Error(`mcp: bad server name "${bad}"`);
  return list;
}

// Server names Claude Code would load for this cwd: connectors it has seen (claudeAiMcpEverConnected in
// ~/.claude.json), user servers, the project's servers and .mcp.json.
export function knownServers(cwd, cfgFile = path.join(os.homedir(), '.claude.json')) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
  let dot = {}; try { dot = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8')).mcpServers || {}; } catch {}
  return [...new Set([...(j.claudeAiMcpEverConnected || []), ...Object.keys(j.mcpServers || {}),
    ...Object.keys(j.projects?.[cwd]?.mcpServers || {}), ...Object.keys(dot)])];
}

// "Gmail" or "claude.ai gmail" both name "claude.ai Gmail".
const resolve = (n, known) => known.find((k) => k.toLowerCase() === n.toLowerCase()) || known.find((k) => k.toLowerCase() === (AI + n).toLowerCase()) || n;

// Claude Code's tool prefix for a server: mcp__<name with anything but letters, digits, _ and - as _>.
export const toolPrefix = (n) => `mcp__${n.replace(/[^\w-]/g, '_')}`;

// What to add to a squiggle's launch: extra args, env, --settings keys and --disallowedTools rules.
// Denying a local or project server by name also drops every connector, so with a connector listed,
// other connectors are denied by name and other local servers lose their tools instead (they still start).
// That branch fails open for a connector missing from claudeAiMcpEverConnected.
export function mcpLaunch(list, known) {
  const want = list.map((n) => resolve(n, known)), name = (serverName) => ({ serverName });
  if (!want.some((n) => n.startsWith(AI)))
    return { args: want.length ? [] : ['--strict-mcp-config'], env: { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }, settings: { allowedMcpServers: want.map(name) }, disallow: [] };
  const other = known.filter((k) => !want.includes(k));
  return { args: [], env: {}, settings: { deniedMcpServers: other.filter((k) => k.startsWith(AI)).map(name) }, disallow: other.filter((k) => !k.startsWith(AI)).map(toolPrefix) };
}
