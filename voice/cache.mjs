// Cached speech: a hit marks the file used, and speech unused for a week is pruned, so the cache can't grow without end.
import fs from 'node:fs';
import path from 'node:path';

export const used = (f) => { try { const t = new Date(); fs.utimesSync(f, t, t); } catch {} return f; };

// Partial files older than an hour are crashed encodes. Returns {files, bytes} removed.
export function pruneSpeech(dir, maxAge = 7 * 864e5, now = Date.now()) {
  let files = 0, bytes = 0, names = [];
  try { names = fs.readdirSync(dir); } catch { return { files, bytes }; }
  for (const n of names) {
    if (!/\.(m4a|wav)(\.part)?$/.test(n)) continue;
    const f = path.join(dir, n); let st; try { st = fs.statSync(f); } catch { continue; }
    if (!st.isFile() || now - st.mtimeMs < (n.includes('.part') ? 36e5 : maxAge)) continue;
    try { fs.rmSync(f); files++; bytes += st.size; } catch {}
  }
  return { files, bytes };
}
