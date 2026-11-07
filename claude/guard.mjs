// Claude squiggles: the shared fence as a PreToolUse hook for Bash, Grep and Glob; --disallowedTools covers
// Read, Edit and Write. The hook also sees Read, for logs closed to peers, and the Chrome tools, for the room's own address. Claude sends {tool_name, tool_input, cwd}; exit 2 blocks and shows stderr to the model. Fails closed.
// Grep and Glob are read as the shell commands they are (grep -r, ls of the pattern), so a search rooted at home is refused too.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME_TOOL, commandReason, editReason, hookMain, peerReason, roomReason } from '../fence.mjs';

const q = (s) => String(s).replace(/\s/g, '?');
// A pattern that is absolute or starts at ~ stands alone; path.join would drop its root.
const under = (base, p) => (/^[/~]/.test(p) ? p : path.join(base, p));
export function check(ev, id = process.env.AGENTS_ID) {
  const i = ev.tool_input || {}, cwd = ev.cwd || process.cwd(), peer = { cwd, self: id || '' };
  if (ev.tool_name === 'Bash') return commandReason(String(i.command ?? ''), cwd) || peerReason('Bash', { command: String(i.command ?? '') }, peer);
  if (ev.tool_name === 'Grep') return commandReason(`grep -r x ${q(i.path || '.')}${i.glob ? ` ${q(under(i.path || '.', String(i.glob)))}` : ''}`, cwd) || peerReason('Grep', { path: i.path || '' }, peer);
  if (ev.tool_name === 'Read') return peerReason('Read', { path: i.file_path || '' }, peer); // HOME_FENCE covers the rest
  if (ev.tool_name === 'Glob') return commandReason(`ls ${q(under(i.path || '.', String(i.pattern ?? '')))}`, cwd) || (i.path ? commandReason(`ls ${q(i.path)}`, cwd) : '');
  if (CHROME_TOOL.test(ev.tool_name)) return roomReason(i);
  return editReason(ev.tool_name, i);
}
export const MATCHER = 'Bash|Grep|Glob|Read|Edit|Write|NotebookEdit|mcp__claude-in-chrome__.*';
export const HOOK_CMD = fileURLToPath(new URL('./guard.sh', import.meta.url));
// Cross-session messaging off: a squiggle neither receives nor sends Claude Code peer messages, so nothing wakes or
// steers a session outside the board, slots and turn caps. Squiggles talk through tell/wake.
export const NO_PEERS = ['SendMessage', 'ListAgents'];
// Merged into the squiggle's own settings.json and passed as --settings.
export const withHook = (settings = {}) => ({ ...settings, crossSessionInbound: 'refuse',
  permissions: { ...settings.permissions, deny: [...new Set([...(settings.permissions?.deny || []), ...NO_PEERS])] },
  hooks: { ...settings.hooks,
  PreToolUse: [...(settings.hooks?.PreToolUse || []), { matcher: MATCHER, hooks: [{ type: 'command', command: JSON.stringify(HOOK_CMD) }] }] } });
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  hookMain(check);
}
