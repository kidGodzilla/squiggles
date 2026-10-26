// Cursor squiggles: fences Downloads, Desktop and Documents on cursor-agent's preToolUse payload, like pi/guard.ts.
// Exit 2 blocks and shows stderr; anything else must print an allow. Fails closed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fencedPath, fencedCommand, mentionsHome, REASON } from '../fence.mjs';

// The shell command gets the full check; every string in the call is checked as a path and for home paths (fence.mjs).
export function check(ev) {
  const cwd = path.resolve(ev.cwd || ev.tool_input?.cwd || ev.workspace_roots?.[0] || os.homedir()), strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(ev.tool_input);
  const cmd = ev.tool_input?.command;
  return (typeof cmd === 'string' && fencedCommand(cmd, cwd)) || strings.some((s) => mentionsHome(s) || (!s.includes('\n') && s.length < 4096 && fencedPath(s.trim(), cwd)));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let ev; try { ev = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.stderr.write('guard could not read the tool call'); process.exit(2); }
  if (check(ev)) { process.stderr.write(REASON); process.exit(2); }
  process.stdout.write('{"permission":"allow"}');
}
