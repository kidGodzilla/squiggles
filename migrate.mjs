// Moves the data directory forward to the code's schema on start. See docs/upgrading.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const steps = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR) : [])
  .map((f) => ({ f, n: Number((f.match(/^(\d{3})-.+\.mjs$/) || [])[1]) })).filter((s) => s.n > 1).sort((a, b) => a.n - b.n);
export const codeSchema = () => Math.max(1, ...steps().map((s) => s.n));

// Fresh data dir: nothing to do, loadConfig writes the latest schema. Throws a readable message on downgrade or a failed step.
export async function migrate(dir) {
  const file = path.join(dir, 'config.json');
  if (!fs.existsSync(file)) return null;
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const have = read().schema || 1, want = codeSchema();
  if (have > want) throw new Error(`${dir} is at data schema ${have}, written by a newer Squiggles; this code reads schema ${want}. Update the code (git pull), or restore an older copy from ${path.join(dir, 'backups')}.`);
  const todo = steps().filter((s) => s.n > have);
  if (!todo.length) return null;
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const backup = path.join(dir, 'backups', `${stamp}-schema-${have}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of ['config.json', 'goals.json', 'tasks.json', 'humans.json', 'meetings.json', 'squiggles']) {
    if (fs.existsSync(path.join(dir, f))) fs.cpSync(path.join(dir, f), path.join(backup, f), { recursive: true });
  }
  for (const s of todo) {
    try { await (await import(pathToFileURL(path.join(DIR, s.f)))).up(dir); } catch (e) {
      throw new Error(`Migration ${s.f} failed: ${e.message}\nYour data before migrating is in ${backup}. To restore, stop the server and copy its contents back into ${dir}.`);
    }
    fs.writeFileSync(file, JSON.stringify({ ...read(), schema: s.n }, null, 2) + '\n');
  }
  return { from: have, to: want, backup };
}
