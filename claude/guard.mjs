// Claude squiggles: the shared fence as a PreToolUse hook for Bash, Grep and Glob; --disallowedTools covers
// Read, Edit and Write. Claude sends {tool_name, tool_input, cwd}; exit 2 blocks and shows stderr to the model. Fails closed.
// Grep and Glob are read as the shell commands they are (grep -r, ls of the pattern), so a search rooted at home is refused too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandReason } from '../fence.mjs';

const q = (s) => String(s).replace(/\s/g, '?');
export function check(ev) {
  const i = ev.tool_input || {}, cwd = ev.cwd || process.cwd();
  if (ev.tool_name === 'Bash') return commandReason(String(i.command ?? ''), cwd);
  if (ev.tool_name === 'Grep') return commandReason(`grep -r x ${q(i.path || '.')}${i.glob ? ` ${q(path.join(i.path || '.', i.glob))}` : ''}`, cwd);
  if (ev.tool_name === 'Glob') return commandReason(`ls ${q(path.join(i.path || '.', String(i.pattern ?? '')))}`, cwd) || (i.path ? commandReason(`ls ${q(i.path)}`, cwd) : '');
  return '';
}
export const MATCHER = 'Bash|Grep|Glob';
export const HOOK_CMD = fileURLToPath(new URL('./guard.sh', import.meta.url));
// Merged into the squiggle's own settings.json and passed as --settings.
export const withHook = (settings = {}) => ({ ...settings, hooks: { ...settings.hooks,
  PreToolUse: [...(settings.hooks?.PreToolUse || []), { matcher: MATCHER, hooks: [{ type: 'command', command: JSON.stringify(HOOK_CMD) }] }] } });
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let ev; try { ev = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.stderr.write('guard could not read the tool call'); process.exit(2); }
  const r = check(ev); if (r) { process.stderr.write(r); process.exit(2); }
}
