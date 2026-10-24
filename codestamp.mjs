// What the running server loaded: restart only when one of these changed since it started.
// The UI (ui/*.js, css, html) and prompts are read from disk on each request or spawn: a page reload or the next wake picks them up.
import fs from 'node:fs';
import path from 'node:path';

const list = (dir, ok) => { try { return fs.readdirSync(dir).filter(ok).map((f) => path.join(dir, f)); } catch { return []; } };
// extra: files outside the code read once at start, such as the data dir's config.json.
export const serverFiles = (root, extra = []) => [
  ...list(root, (f) => f.endsWith('.mjs')), ...list(path.join(root, 'migrations'), (f) => f.endsWith('.mjs')), ...list(path.join(root, 'voice'), (f) => f === 'kokoro.cjs'),
  path.join(root, 'ui', 'cast.js'), ...list(path.join(root, 'ui', 'gen'), () => true), path.join(root, 'package.json'), ...extra,
];
const stat = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
export const codeStamp = (root, extra) => Object.fromEntries(serverFiles(root, extra).map((f) => [f, stat(f)]));
// Server files added, removed or touched since the stamp, relative to root.
export function codeChanged(root, stamp, extra) {
  const now = codeStamp(root, extra), files = new Set([...Object.keys(stamp), ...Object.keys(now)]);
  return [...files].filter((f) => (stamp[f] || 0) !== (now[f] || 0)).map((f) => path.relative(root, f));
}
