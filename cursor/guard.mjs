// Cursor squiggles: fences Downloads, Desktop and Documents on cursor-agent's preToolUse payload, like pi/guard.ts.
// Exit 2 blocks and shows stderr; anything else must print an allow. Fails closed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRS = ['Downloads', 'Desktop', 'Documents'];
export const REASON = 'Downloads, Desktop and Documents are off limits';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function check(ev, home = os.homedir()) {
  const cwd = path.resolve(ev.cwd || ev.tool_input?.cwd || ev.workspace_roots?.[0] || home), strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(ev.tool_input);
  const fenced = (p) => { const abs = path.resolve(cwd, p.replace(/^~(?=\/|$)/, home)); return DIRS.some((d) => abs === path.join(home, d) || abs.startsWith(path.join(home, d) + '/')); };
  const mention = new RegExp(`(~|\\$HOME|\\$\\{HOME\\}|${esc(home)})/(${DIRS.join('|')})\\b`);
  return strings.some((s) => mention.test(s) || (!s.includes('\n') && s.length < 4096 && fenced(s.trim())));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let ev; try { ev = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.stderr.write('guard could not read the tool call'); process.exit(2); }
  if (check(ev)) { process.stderr.write(REASON); process.exit(2); }
  process.stdout.write('{"permission":"allow"}');
}
