// `agents.mjs upgrade`: pull the newest code, restart, let the server migrate. See docs/upgrading.md.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, loadConfig } from '../config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'local.squiggles.server';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const gitA = (...a) => new Promise((ok, no) => execFile('git', a, { cwd: ROOT, encoding: 'utf8', timeout: 30000 }, (e, out, err) => (e ? no(Object.assign(e, { stderr: err })) : ok(out.trim()))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const version = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const changes = (up, cur) => git('show', `${up}:CHANGELOG.md`).split(/^(?=## )/m).filter((s) => /^## (\d+\.\d+\.\d+)/.test(s) && newer(s.match(/^## (\S+)/)[1], cur)).join('').trim();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const UPGRADE_PROMPT = 'Upgrade Squiggles: run `node ~/squiggles/bin/agents.mjs upgrade`. If it refuses because of local changes, move each change into a seam from ~/squiggles/docs/upgrading.md, then run it again. Summarise the changes it printed for me.';

// Read-only: fetch, then say how far behind this clone is. Pulls and restarts nothing. CLI: upgrade check; page: Settings > Room > Check for updates.
export async function checkUpdate() {
  const current = version();
  let up;
  try { up = await gitA('rev-parse', '--abbrev-ref', '@{u}'); } catch { return { current, error: `This clone tracks no upstream branch, so it can't check. Fix: git -C ${ROOT} branch -u origin/main` }; }
  try { await gitA('fetch', '--tags', '--quiet'); } catch (e) { return { current, error: `Couldn't reach ${up.split('/')[0]}: ${String(e.stderr || e.message).trim().split('\n').pop()}` }; }
  const [behind, ahead, dirty, theirs] = await Promise.all([gitA('rev-list', '--count', `HEAD..${up}`), gitA('rev-list', '--count', `${up}..HEAD`), gitA('status', '--porcelain'), gitA('show', `${up}:package.json`)]);
  return { current, latest: JSON.parse(theirs).version, behind: +behind, ahead: +ahead, dirty: dirty.split('\n').filter(Boolean).map((l) => l.replace(/^\s*\S+\s+/, '')), changes: +behind ? changes(up, current) : '', prompt: UPGRADE_PROMPT };
}

export function formatCheck(c) {
  if (c.error) return `Squiggles ${c.current}. ${c.error}`;
  const mine = c.ahead ? `Your clone has ${plural(c.ahead, 'commit')} upstream doesn't: rebase them onto it first, or upgrade's fast-forward pull fails.` : '';
  if (!c.behind) return [`Up to date: Squiggles ${c.current}.`, mine].filter(Boolean).join(' ');
  return [
    `Update available: Squiggles ${c.current} is ${plural(c.behind, 'commit')} behind${c.latest !== c.current ? ` (newest ${c.latest})` : ''}.`,
    c.changes,
    c.dirty.length ? `upgrade refuses until these local changes move into seams (docs/upgrading.md):\n${c.dirty.join('\n')}` : '',
    mine,
    `To update, paste into Claude Code:\n\n> ${c.prompt}`,
  ].filter(Boolean).join('\n\n');
}

export async function upgrade(sub) {
  if (sub === 'check') return formatCheck(await checkUpdate());
  if (sub) throw new Error('usage: upgrade [check]');
  const dirty = git('status', '--porcelain');
  if (dirty) throw new Error(`The code in ${ROOT} has local changes:\n${dirty}\nMove each into a seam (config.json, ${dataDir()}/prompts, local.css; see docs/upgrading.md), then run upgrade again.`);
  git('fetch', '--tags', '--quiet');
  const up = git('rev-parse', '--abbrev-ref', '@{u}');
  const cur = version();
  if (git('rev-list', '--count', `HEAD..${up}`) === '0') return `Already up to date: Squiggles ${cur}.`;

  const out = [];
  const log = changes(up, cur);
  out.push(log ? `Changes since ${cur}:\n\n${log}` : 'No CHANGELOG entries for this update.');
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
  // Only restart a login item that runs this clone: a second clone (a test, a fork) never restarts another room.
  try { loginItem = execFileSync('launchctl', ['print', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes(path.join(ROOT, 'server.mjs')); } catch { loginItem = false; }
  if (!loginItem) return [...out, 'Updated. No login item runs this clone: restart its server yourself (node server.mjs).'].join('\n\n');
  const want = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  execFileSync('launchctl', ['kickstart', '-k', target], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${loadConfig().port}/api/config`;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const c = await (await fetch(url)).json(); if (c.version === want) return [...out, `Running Squiggles ${c.version}, data schema ${c.schema}.`].join('\n\n'); } catch {}
  }
  throw new Error([...out, 'Updated, but the server did not come back. See ~/Library/Logs/squiggles.log (a failed migration prints how to restore its backup).'].join('\n\n'));
}
