// The committed copy of a hook guard and the repo modules it imports, for bin/guard-run.sh. When the working fence.mjs
// or a guard doesn't load or throws, the hook answers with what HEAD holds instead of refusing every tool for everyone.
// Each copy sits beside its original as .head.<name>, so paths read from import.meta.url stay the same.
// guard-run.sh pipes this file from HEAD into node, so a broken edit to it can't stop the fallback either.
// Args: the repo root, the guard's path. Prints the copy's path; exit 1 when HEAD can't supply one.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [root, guard] = process.argv.slice(-2).map((p) => path.resolve(p));
const headName = (rel) => path.join(path.dirname(rel), `.head.${path.basename(rel)}`);
const SPEC = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\2/g;
try {
  const first = path.relative(root, guard), todo = [first], seen = new Set();
  while (todo.length) {
    const rel = todo.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`outside the repo: ${rel}`);
    const src = execFileSync('git', ['-C', root, 'show', `HEAD:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .replace(SPEC, (m, pre, q, spec) => {
        const dep = path.join(path.dirname(rel), spec), to = path.relative(path.dirname(rel), headName(dep));
        todo.push(dep);
        return `${pre}${q}${to.startsWith('../') ? to : `./${to}`}${q}`;
      });
    const out = path.join(root, headName(rel)), tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, src);
    fs.renameSync(tmp, out); // atomic: hooks running at once each write the same text
  }
  process.stdout.write(path.join(root, headName(first)));
} catch { process.exit(1); }
