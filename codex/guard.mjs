// Codex squiggles: the fence.mjs checks as a PreToolUse hook on codex app-server (its workspace-write sandbox reads
// everywhere and has network). Codex sends {tool_name, tool_input, cwd}; exit 2 blocks and shows stderr to the model.
// Fails closed on bad input. apply_patch carries its patch in tool_input.command: read as text, each file it touches checked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check as cursorCheck } from '../cursor/guard.mjs';
import { mentionReason, pathReason } from '../fence.mjs';

const PATCH = /^(apply_patch|Edit|Write)$/;
export function check(ev) {
  const cwd = path.resolve(ev.cwd || process.cwd(), ev.tool_input?.workdir || '.');
  if (!PATCH.test(ev.tool_name || '')) return cursorCheck({ ...ev, cwd });
  const text = String(ev.tool_input?.command ?? '');
  for (const m of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)) { const r = pathReason((m[1] || m[2]).trim(), cwd); if (r) return r; }
  return mentionReason(text) || cursorCheck({ ...ev, cwd, tool_input: { ...ev.tool_input, command: undefined } });
}
// Args for codex: the hook inline (-c) as a session flag. App-server runs it only once trusted: codex keeps the trust in
// ~/.codex/config.toml under hooks.state.<HOOK_KEY>.trusted_hash, which bin/codex-trust-guard.mjs writes.
export const HOOK_CMD = JSON.stringify(fileURLToPath(new URL('./guard.sh', import.meta.url)));
export const HOOK_KEY = '/<session-flags>/config.toml:pre_tool_use:0:0';
export const hookConfig = () => `hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=${JSON.stringify(HOOK_CMD)}}]}]`;
// From app-server's hooks/list: is our hook there, enabled and trusted?
export const hookTrusted = (list) => (list?.data || []).some((e) => (e.hooks || []).some((h) => h.key === HOOK_KEY && h.command === HOOK_CMD && h.enabled && h.trustStatus === 'trusted'));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let ev; try { ev = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.stderr.write('guard could not read the tool call'); process.exit(2); }
  const r = check(ev); if (r) { process.stderr.write(r); process.exit(2); }
}
