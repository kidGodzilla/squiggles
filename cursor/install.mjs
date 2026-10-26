// Adds the Cursor squiggle fence (guard.sh) to ~/.cursor/hooks.json, keeping any hooks already there. Cursor reads hooks only from there.
// Run once: node cursor/install.mjs. The server refuses Cursor turns until it's in (fenced()).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const GUARD = path.join(import.meta.dirname, 'guard.sh');
export const HOOKS = process.env.CURSOR_HOOKS || path.join(os.homedir(), '.cursor', 'hooks.json'); // override: temp rooms only
export function fenced(file = HOOKS) {
  try { return (JSON.parse(fs.readFileSync(file, 'utf8')).hooks?.preToolUse || []).some((h) => h.command === GUARD && h.failClosed === true); } catch { return false; }
}
export function install(file = HOOKS) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (fenced(file)) return false;
  j.version ??= 1; j.hooks ??= {}; (j.hooks.preToolUse ||= []).push({ command: GUARD, failClosed: true });
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
  return true;
}
if (process.argv[1] === import.meta.filename) console.log(install() ? `fence added to ${HOOKS}` : 'fence already in');
