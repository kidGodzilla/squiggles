// An older install sees it's behind (upgrade check), then upgrade pulls without touching its room: charters, journals, board.
// Runs on a throwaway upstream and clone in a temp dir; never on this clone or its login item.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('upgrade: an older clone checks, then pulls and keeps its room', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-upgrade-'));
  try {
    // Upstream at "old": this tree's tracked files, as the version a user installed.
    const src = path.join(t, 'src');
    fs.mkdirSync(src);
    for (const f of git(ROOT, 'ls-files').split('\n')) {
      if (!fs.existsSync(path.join(ROOT, f))) continue;
      fs.mkdirSync(path.dirname(path.join(src, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(src, f));
    }
    git(src, 'init', '-q', '-b', 'main'); git(src, 'add', '-A'); git(src, 'commit', '-qm', 'old');
    const bare = path.join(t, 'up.git');
    git(t, 'clone', '-q', '--no-local', '--bare', src, bare); // no hardlinks: git's local-clone copy check fails under heavy load

    // The user's install: a clone of the old version, with a room in its data dir and (old layout) inside the clone.
    const clone = path.join(t, 'squiggles'), home = path.join(t, 'data');
    git(t, 'clone', '-q', '--no-local', bare, clone);
    const room = {
      [path.join(home, 'squiggles', 'lead', 'charter.md')]: 'My lead, my words.\n',
      [path.join(home, 'squiggles', 'lead', 'journal.md')]: '## day one\n',
      [path.join(home, 'tasks.json')]: '{"tasks":[{"id":"t1","title":"mine"}]}\n',
      [path.join(clone, 'squiggles', 'lead', 'journal.md')]: '## old layout\n',
      [path.join(clone, 'tasks.json')]: '{"tasks":[]}\n',
    };
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ schema: 1, port: 4398 }));
    for (const [f, s] of Object.entries(room)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); }

    // Upstream moves on: a new version with a CHANGELOG entry.
    const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    const cur = pkg.version, next = cur.replace(/\d+$/, (n) => +n + 7);
    fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ ...pkg, version: next }, null, 2) + '\n');
    const log = fs.readFileSync(path.join(src, 'CHANGELOG.md'), 'utf8');
    fs.writeFileSync(path.join(src, 'CHANGELOG.md'), log.replace(/^## /m, `## ${next}\n\n### Added\n- Test feature zebra.\n\n## `));
    git(src, 'commit', '-qam', 'new'); git(bare, 'fetch', '-q', src, 'main:main');
    const newHead = git(src, 'rev-parse', 'HEAD');

    const cli = (...a) => execFileSync(process.execPath, [path.join(clone, 'bin', 'agents.mjs'), ...a], { cwd: clone, env: { ...process.env, SQUIGGLES_HOME: home, AGENTS_ID: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    // 1. check: says it's behind, shows the change and the paste block, pulls nothing.
    const before = git(clone, 'rev-parse', 'HEAD');
    const c = cli('upgrade', 'check');
    assert.match(c, new RegExp(`Update available: Squiggles ${cur.replace(/\./g, '\\.')} is 1 commit behind \\(newest ${next.replace(/\./g, '\\.')}\\)`));
    assert.match(c, /Test feature zebra/);
    assert.match(c, /agents\.mjs upgrade`/);
    assert.equal(git(clone, 'rev-parse', 'HEAD'), before);

    // 2. A local edit to shipped code: check names it, upgrade refuses and changes nothing.
    const edited = path.join(clone, 'README.md');
    fs.appendFileSync(edited, 'my tweak\n');
    assert.match(cli('upgrade', 'check'), /upgrade refuses until these local changes move into seams \(docs\/upgrading\.md\):\nREADME\.md$/m);
    assert.throws(() => cli('upgrade'), /local changes/);
    assert.equal(git(clone, 'rev-parse', 'HEAD'), before);
    git(clone, 'checkout', '--', 'README.md');

    // 3. upgrade: pulls to the new version, restarts no login item (none runs this clone), room untouched.
    const u = cli('upgrade');
    assert.match(u, /Test feature zebra/);
    assert.match(u, /No login item runs this clone/);
    assert.equal(git(clone, 'rev-parse', 'HEAD'), newHead);
    for (const [f, s] of Object.entries(room)) assert.equal(fs.readFileSync(f, 'utf8'), s, f);
    assert.equal(git(clone, 'status', '--porcelain'), '');

    // 4. Afterwards: up to date.
    assert.match(cli('upgrade', 'check'), new RegExp(`^Up to date: Squiggles ${next.replace(/\./g, '\\.')}\\.`));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});
