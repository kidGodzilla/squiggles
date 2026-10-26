// Cursor squiggles: the fence.mjs checks on cursor-agent's preToolUse payload, like pi/guard.ts.
// Exit 2 blocks and shows stderr; anything else must print an allow. Fails closed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathReason, commandReason, mentionsHome, mentionsSsh, REASONS } from '../fence.mjs';

// The shell command gets the full check; every string in the call is checked as a path and for home paths (fence.mjs).
// Returns the reason, or '' to allow.
export function check(ev) {
  const cwd = path.resolve(ev.cwd || ev.tool_input?.cwd || ev.workspace_roots?.[0] || os.homedir()), strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(ev.tool_input);
  const cmd = ev.tool_input?.command;
  const c = typeof cmd === 'string' && commandReason(cmd, cwd); if (c) return c;
  for (const s of strings) {
    if (mentionsHome(s)) return REASONS.dirs;
    if (mentionsSsh(s)) return REASONS.ssh;
    const r = !s.includes('\n') && s.length < 4096 && pathReason(s.trim(), cwd); if (r) return r;
  }
  return '';
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let ev; try { ev = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.stderr.write('guard could not read the tool call'); process.exit(2); }
  const reason = check(ev); if (reason) { process.stderr.write(reason); process.exit(2); }
  process.stdout.write('{"permission":"allow"}');
}
