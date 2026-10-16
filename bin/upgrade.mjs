// `agents.mjs upgrade`: pull the newest code, restart, let the server migrate. See docs/upgrading.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, loadConfig } from '../config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.squiggles.server';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function upgrade() {
  const dirty = git('status', '--porcelain');
  if (dirty) throw new Error(`The code in ${ROOT} has local changes:\n${dirty}\nMove each into a seam (config.json, ${dataDir()}/prompts, local.css; see docs/upgrading.md), then run upgrade again.`);
  git('fetch', '--tags', '--quiet');
  const up = git('rev-parse', '--abbrev-ref', '@{u}');
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (git('rev-list', '--count', `HEAD..${up}`) === '0') return `Already up to date: Squiggles ${cur}.`;

  const out = [];
  const log = git('show', `${up}:CHANGELOG.md`).split(/^(?=## )/m).filter((s) => /^## (\d+\.\d+\.\d+)/.test(s) && newer(s.match(/^## (\S+)/)[1], cur));
  out.push(log.length ? `Changes since ${cur}:\n\n${log.join('').trim()}` : 'No CHANGELOG entries for this update.');
  // A full prompt override in the data dir freezes the shipped prompt; say when upstream changed it.
  for (const f of git('diff', '--name-only', 'HEAD', up, '--', 'prompts').split('\n').filter(Boolean)) {
    const mine = path.join(dataDir(), 'prompts', path.basename(f));
    if (fs.existsSync(mine)) out.push(`Note: ${f} changed upstream, but ${mine} replaces it. Compare: git -C ${ROOT} diff HEAD@{1} HEAD -- ${f}`);
  }
  try { git('pull', '--ff-only', '--quiet'); } catch (e) {
    throw new Error(`git pull --ff-only failed: your clone has commits upstream doesn't. Rebase them onto ${up} (or move them into seams), then run upgrade again.\n${e.stderr || e.message}`);
  }

  const target = `gui/${process.getuid()}/${LABEL}`;
  let loginItem = true;
  try { execFileSync('launchctl', ['print', target], { stdio: 'ignore' }); } catch { loginItem = false; }
  if (!loginItem) return [...out, 'Updated. No login item runs the server: restart it yourself (node server.mjs).'].join('\n\n');
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  execFileSync('launchctl', ['kickstart', '-k', target], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${loadConfig().port}/api/config`;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const c = await (await fetch(url)).json(); if (c.version === want) return [...out, `Running Squiggles ${c.version}, data schema ${c.schema}.`].join('\n\n'); } catch {}
  }
  throw new Error([...out, 'Updated, but the server did not come back. See ~/Library/Logs/squiggles.log (a failed migration prints how to restore its backup).'].join('\n\n'));
}
