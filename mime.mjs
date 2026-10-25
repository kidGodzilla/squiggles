import path from 'node:path';
export const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'application/json', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };
// Outside ui/ (dropped files, media, tts) only these keep their type: script or style types there would let
// an agent's file load as the room's own script under script-src 'self'; everything else is text/plain.
const SAFE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.wav', '.pdf', '.html', '.txt', '.md', '.log', '.csv']);
export function mimeFor(file, ui = false) {
  const ext = path.extname(file).toLowerCase();
  if (ui) return MIME[ext] || 'application/octet-stream';
  return SAFE.has(ext) ? MIME[ext] : 'text/plain; charset=utf-8';
}
