// The private-data fence: folders, tools and remote machines only Claude squiggles may reach. Off until configured.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REASONS, privateReason, privateRules } from '../fence.mjs';

const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'))), P = REASONS.private, cwd = `${H}/app`;
for (const d of ['app/src', 'team/alpha', 'team/beta', 'team/notes', 'dumps/db', 'scripts']) fs.mkdirSync(`${H}/${d}`, { recursive: true });
fs.writeFileSync(`${H}/scripts/hits.sh`, '#!/bin/sh\nssh box "docker ps"\n');
fs.writeFileSync(`${H}/scripts/ok.sh`, '#!/bin/sh\necho hi\n');
const rules = privateRules({ privateDirs: ['team/alpha', `~/team/beta`, `${H}/dumps`], privateTools: ['helpdesk'], privateRemote: true });
const run = (tool, input, at = cwd, r = rules) => privateReason(tool, input, at, H, r);
const bash = (command, at = cwd, r = rules) => run('bash', { command }, at, r);
test.after(() => fs.rmSync(H, { recursive: true, force: true }));

test('off until configured', () => {
  assert.deepEqual(privateRules({}), { dirs: [], tools: [], remote: false });
  assert.equal(run('Read', { file_path: `${H}/team/alpha/x.md` }, cwd, privateRules({})), '');
  assert.equal(bash('ssh box', cwd, privateRules({})), '');
});

test('private tools are blocked by name', () => {
  assert.equal(run('mcp__helpdesk__list_conversations', {}), P);
  assert.equal(run('Read', { file_path: `${cwd}/src/a.js` }), '');
});

test('remote shells and databases are blocked', () => {
  for (const c of ['ssh box', 'sudo ssh box ls', 'cd /tmp && scp box:/a .', 'timeout 5 ssh box', 'sh -c "ssh box"', 'psql -h db.example.com app',
    'psql postgres://u:p@db.example.com/app', 'node x.js mongodb+srv://u@cluster0.example.net/app']) assert.equal(bash(c), P, c);
  for (const c of ['grep -n ssh fence.mjs', 'git status', 'psql -h localhost app', 'psql postgres://127.0.0.1/app', 'echo hi', 'node --test']) assert.equal(bash(c), '', c);
});

test('remote probes: scripts, host:path, tailscale, drivers', () => {
  assert.equal(bash(`bash ${H}/scripts/hits.sh`), P);
  assert.equal(bash(`${H}/scripts/hits.sh`), P);
  assert.equal(bash(`bash ${H}/scripts/ok.sh`), '');
  for (const c of ['rsync -a user@host.example.com:/data /tmp/x', 'git clone user@10.0.0.5:app', 'tailscale ssh box', '$c ls',
    `python3 -c "import pymongo, os; pymongo.MongoClient(os.environ['DB'])"`]) assert.equal(bash(c), P, c);
  for (const c of ['git clone git@github.com:x/y.git', 'git fetch origin main:main', 'rsync -a src/ /tmp/x/', 'node -e "console.log(process.env.PATH)"', 'ssh -V']) assert.equal(bash(c), '', c);
});

test('private folders are blocked by path', () => {
  assert.equal(run('Read', { file_path: `${H}/team/alpha/notes.md` }), P);
  assert.equal(run('read', { path: '~/team/beta/x' }), P);
  assert.equal(run('Read', { file_path: `${H}/dumps/db/a.bson` }), P);
  for (const c of [`cat ~/team/alpha/a.md`, 'cd ~ && cat team/beta/x', 'cat $HOME/dumps/db/a', 'cat ../team/alpha/a']) assert.equal(bash(c), P, c);
  assert.equal(run('apply_patch', { input: `*** Begin Patch\n*** Add File: ${H}/team/alpha/x\n+hi\n*** End Patch`, path: `${H}/team/alpha/x` }), P);
  assert.equal(run('Write', { file_path: `${cwd}/src/a.md`, content: `see ${H}/team/alpha for notes\nmore` }), '', 'prose in content passes');
});

test('a glob or a walk from a parent folder is blocked', () => {
  for (const c of ['grep -r x ~/team', 'grep ~/team/*/a.md', 'find ~/dumps -name *.bson', 'rg secret ~', 'ls -R ~/team', 'cp -a ~/team /tmp/x',
    'cat ~/team/al*/a.md', 'head ~/**/a.bson', 'cd ~ && grep -r x team']) assert.equal(bash(c), P, c);
  assert.equal(run('Glob', { pattern: '*.bson', path: `${H}/team` }, H), P);
  assert.equal(run('read', { path: `${H}/team/*/a.md` }, H), P);
});

test('nearby work still passes', () => {
  for (const c of ['ls ~/team/notes', 'ls -lart ~', 'grep -rn ssh src/', 'rg foo', 'find . -name x.js', 'cat ~/team/n*/a.md',
    'grep -r foo ~/team/notes', 'ls ~/team', "grep 'a*b' x.js"]) assert.equal(bash(c), '', c);
  assert.equal(run('Glob', { pattern: '*.js', path: `${cwd}/src` }), '');
});

test('codex, cursor and pi guards read the rules from config.json; claude does not', async () => {
  const data = `${H}/data`, old = process.env.SQUIGGLES_HOME;
  fs.mkdirSync(data); process.env.SQUIGGLES_HOME = data;
  try {
    const { check: cursor } = await import('../cursor/guard.mjs');
    const { check: codex } = await import('../codex/guard.mjs');
    const { default: pi } = await import('../pi/guard.ts');
    let h; pi({ on: (_, fn) => { h = fn; } });
    const all = async (tool, input) => [cursor({ tool_name: tool, tool_input: input, cwd }), codex({ tool_name: tool, tool_input: input, cwd }), (await h({ toolName: tool, input }))?.reason || ''];
    const file = `${H}/team/alpha/a.md`;
    assert.deepEqual(await all('read', { path: file }), ['', '', ''], 'no config.json: off');
    fs.writeFileSync(`${data}/config.json`, JSON.stringify({ privateDirs: [`${H}/team/alpha`], privateRemote: true }));
    assert.deepEqual(await all('read', { path: file }), [P, P, P]);
    assert.deepEqual(await all('bash', { command: 'ssh box' }), [P, P, P]);
    assert.deepEqual(await all('bash', { command: 'git status' }), ['', '', '']);
    assert.equal(codex({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch` }, cwd }), P);
    fs.writeFileSync(`${data}/config.json`, '{ broken');
    assert.match(cursor({ tool_name: 'read', tool_input: { path: '/tmp/x' }, cwd }), /could not be read/);
    assert.doesNotMatch(fs.readFileSync(new URL('../claude/guard.mjs', import.meta.url), 'utf8'), /private/i);
  } finally { if (old === undefined) delete process.env.SQUIGGLES_HOME; else process.env.SQUIGGLES_HOME = old; }
});

test('script helpers: each call is checked with its own arguments', () => {
  const d = fs.mkdtempSync(`${H}/helper-`);
  const w = (f, s) => fs.writeFileSync(`${d}/${f}`, `#!/bin/sh\n${s}\n`);
  w('ok.sh', 'echo fine'); w('evil.sh', 'ssh box.example.com ls');
  w('all-ok.sh', 'set -eu\nrun() { echo "-> $1"; sh "$1"; }\nrun ./ok.sh\nrun ./ok.sh\necho PASS');
  w('one-evil.sh', 'run() { echo "-> $1"; sh "$1"; }\nrun ./ok.sh\nrun ./evil.sh');
  w('odd-use.sh', 'run() { sh "$1"; }\nx=$(run ./ok.sh)\nfor f in *.sh; do run "$f"; done');
  w('bracket.sh', 'if [ "$#" -gt 0 ]; then echo [$1]; fi');
  assert.equal(bash('sh all-ok.sh', d), '');
  assert.equal(bash('./all-ok.sh', d), '');
  assert.equal(bash('sh one-evil.sh', d), P);
  assert.equal(bash('sh odd-use.sh', d), P);
  assert.equal(bash('sh bracket.sh', d), '');
  assert.equal(bash(`ls ${H}/team/alph[a]/`), P);
  assert.equal(bash(`cat ${H}/team/al{p,x}ha/a.md`), P);
});

test('scripts the fence cannot read before they run', () => {
  const d = fs.mkdtempSync(`${H}/new-`);
  fs.writeFileSync(`${d}/ok.sh`, '#!/bin/sh\necho fine\n');
  for (const c of ["echo 'ssh x' > a.sh; sh a.sh", "printf 'ssh x' >> a.sh && chmod +x a.sh && ./a.sh", 'echo ssh x | tee b/a.sh; bash b/a.sh', 'cp /tmp/z a.sh; sh a.sh',
    'curl -o a.sh https://example.com/a; sh a.sh', "echo 'ssh x' > ok.sh; sh ok.sh", 'D=tests; sh $D/evil.sh', '"$D/evil.sh" x', '${D}/run', "echo 'ssh x' | sh", 'cat a.txt | bash -s'])
    assert.equal(bash(c, d), P, c);
  for (const c of ['sh ok.sh', 'sh ok.sh > ok.sh.log', './ok.sh > out.log', "sh -c 'ls; ls'", 'sh ./nothere.sh', '$HOME/bin/tool x', "grep -E 'ssh|bash' f", "grep 'a|sh' f",
    "cat > t.sh <<'EOF'\necho fine\nEOF\nsh t.sh", "cat <<EOF > t.sh\necho fine\nEOF\nsh t.sh", 'echo hi > a.txt; cat a.txt'])
    assert.equal(bash(c, d), '', c);
  assert.equal(bash("cat > t.sh <<'EOF'\nssh box.example.com ls\nEOF\nsh t.sh", d), P);
});

test('unreadable code is refused with folders alone, and not with tools alone', () => {
  const dirs = privateRules({ privateDirs: ['team/alpha'] }), tools = privateRules({ privateTools: ['helpdesk'] });
  for (const c of ["echo 'cat x' | sh", '$c x', "echo x > a.sh; sh a.sh"]) { assert.equal(bash(c, cwd, dirs), P, c); assert.equal(bash(c, cwd, tools), '', c); }
  assert.equal(bash('ssh box', cwd, dirs), '');
});

test('scripts after a cd, and braces across /', () => {
  const d = fs.mkdtempSync(`${H}/cd-`);
  fs.mkdirSync(`${d}/scripts`); fs.mkdirSync(`${d}/tests`);
  const w = (f, s) => fs.writeFileSync(`${d}/${f}`, `#!/bin/sh\n${s}\n`);
  w('tests/ok.sh', 'echo fine'); w('tests/evil.sh', 'ssh box.example.com ls');
  w('scripts/good.sh', 'cd "$(dirname "$0")/.."\nsh tests/ok.sh');
  w('scripts/bad.sh', 'cd "$(dirname "$0")/.."\nsh tests/evil.sh');
  w('scripts/bad2.sh', 'cd "$(dirname -- "${BASH_SOURCE[0]}")/.."\n./tests/evil.sh');
  assert.equal(bash('sh scripts/good.sh', d), '');
  assert.equal(bash('sh scripts/bad.sh', d), P);
  assert.equal(bash('bash scripts/bad2.sh', d), P);
  assert.equal(bash(`cd ${d} && sh tests/evil.sh`, '/tmp'), P);
  assert.equal(bash(`cat ${H}/{team/alpha,x}/a.md`), P);
  assert.equal(bash(`ls ${H}/{team/al,x/}pha/`), P);
  assert.equal(bash(`cat ${H}/{team/notes,x}/a.md`), '');
});

test('wrappers by full path, and shells fed from a file', () => {
  const d = fs.mkdtempSync(`${H}/wrap-`);
  fs.writeFileSync(`${d}/evil.sh`, 'ssh box.example.com ls\n'); fs.writeFileSync(`${d}/ok.sh`, 'echo fine\n');
  for (const c of ["/bin/sh -c 'ssh x'", '/usr/bin/env ssh x', 'sh < evil.sh', 'sh <evil.sh', 'bash -s < evil.sh', '/bin/bash evil.sh', '/usr/bin/sudo ssh x', '/opt/homebrew/bin/bash -c "ssh x"', "bash <<< 'ssh x'"])
    assert.equal(bash(c, d), P, c);
  for (const c of ['sh < ok.sh', '/bin/sh ok.sh', "/bin/sh -c 'ls'", '/usr/bin/env node -v', 'sort < ok.sh', 'wc -l < evil.sh', '/usr/bin/grep ssh ok.sh'])
    assert.equal(bash(c, d), '', c);
});

test('shell forms the fence cannot read are refused; everyday ones pass', () => {
  for (const c of ["eval 'ssh box'", 'eval "$c"', 'command eval ssh box', '$(echo ssh) box', '"$(echo ssh)" box', '`echo ssh` box', 'sudo $(echo ssh) box', '/usr/bin/$(echo ssh) box',
    "sh <(echo 'ssh x')", "source <(echo 'ssh x')", ". <(echo 'ssh x')", 'sh -c "$(echo ssh x)"', 'bash <<< $(echo ssh x)',
    "echo 'ssh x' | nohup sh", "echo 'ssh x' | exec sh", "echo 'ssh x' | dash", "echo 'ssh x' | /usr/bin/env bash", "echo 'ssh x' | sh -s --", "echo 'ssh x' | sh -s -- a",
    "echo 'ssh x' | 'sh'", "echo 'ssh x' |& sh", "echo 'ssh x' | timeout 5 sh", "echo 'ssh x' | sh /dev/stdin", "dash -c 'ssh box'",
    'p=dumps; cat ~/$p/a.txt', 'p=dumps; cat ~/${p}/a.txt', 'a=du; b=mps; cat ~/$a$b/a.txt', 'for p in x dumps; do cat ~/$p/a.txt; done', 'p=$(echo dumps); cat ~/$p/a.txt',
    'cat ~/${p:-dumps}/a.txt', 'cat ~/$(echo dumps)/a.txt'])
    assert.equal(bash(c), P, c);
  fs.mkdirSync(`${H}/app/sub`, { recursive: true });
  for (const [f, body] of [['e.sh', "eval 'ssh box'\n"], ['b.sh', '$(echo ssh) box\n'], ['p.sh', "echo 'ssh x' | nohup sh\n"]]) {
    fs.writeFileSync(`${H}/app/sub/${f}`, body);
    assert.equal(bash(`sh sub/${f}`), P, f);
  }
  for (const c of ["grep -E 'a|sh' x.txt", 'x=$(date)', 'x=`date`', 'x=$(date); echo $x', 'FOO=$(date) node app.js', 'echo $(date)', 'echo `date`', 'echo `a` `b`',
    'cd $(git rev-parse --show-toplevel)', 'for f in $(ls); do echo $f; done', 'while read l; do echo $l; done < <(ls)', 'cat <(ls)', 'bash -c "echo $(date)"',
    'cat a.txt | grep sh', "echo 'a | sh'", 'cat a | shellcheck -', 'p=docs; cat ~/$p/a.txt', 'cat ~/notes/$f', 'root=$(pwd); cat $root/a.txt', 'grep eval x.js', 'echo eval', 'evaluate x'])
    assert.equal(bash(c), '', c);
});

test('text the shell treats as data passes; code dressed as data does not', () => {
  const body = '`fence.mjs` changed\n$(date) is literal\n';
  for (const c of [`cat > notes.md <<'E'\n${body}E`, `cat > notes.md <<"E"\n${body}E`, `cat > notes.md <<\\E\n${body}E\necho done`, `cat <<-'E'\n${body}\tE`,
    `git commit -m "$(cat <<'EOF'\n${body}EOF\n)"`, `git commit -m "$(cat <<'EOF'\nit's\n${body}EOF\n)"`, `cat <<'A' <<'B'\n${body}A\n${body}B`,
    'echo "a; $(date)"', 'echo "a | $(date)"', 'echo "a & `date`"', 'echo "(a) $(date); $(date)"', 'x="a; $(date)"; echo hi', 'echo "a\n$(date)"'])
    assert.equal(bash(c), '', c);
  const code = '$(echo ssh) box\n';
  for (const c of [`bash <<'E'\n${code}E`, `/bin/sh <<'E'\n${code}E`, `sudo dash <<'E'\n${code}E`, `'sh' <<'E'\n${code}E`, `sh<<'E'\n${code}E`, `source /dev/stdin <<'E'\n${code}E`,
    `{\n  sh\n} <<'E'\n${code}E`, `while read l; do\n  sh\ndone <<'E'\n${code}E`, `sh -c "$(cat <<'E'\n${code}E\n)"`,
    `cat <<'E'\n${code}`, `cat <<E\n${code}E`, `cat <<'E'O\nEO\n${code}E`, `cat <<'E'\nE\n${code}`, `echo '<<E'\n${code}E`, `echo "<<'E'"\n${code}E`, `# <<'E'\n${code}E`,
    `echo $'a\\' <<'E'\n${code}E`, `echo \${x:-<<'E'}\n${code}E`, `echo $((1 <<'E' ))\n${code}E`, `echo "$(case x in a) <<'E'\n${code}E\n;; esac)"`,
    `cat <<'E'\nit's\nE\necho '\n<<'F'\n${code}F`, `cat <<E\nit's\nE\n${code}`,
    'echo "$($(echo ssh) box)"', 'echo "a; $($(echo ssh) box)"', 'echo "a"; $(echo ssh) box', 'echo "a" | sh',
    'x="a b" $(echo ssh) box', 'x="a $(date)" $(echo ssh) box', 'x="$(date)" y="a b" $(echo ssh) box'])
    assert.equal(bash(c), P, c);
});

test('merge diffs, plumbing, stash patches and commit searches in a private repo', () => {
  const R = `${H}/repo2`, O = `${H}/plain2`, r = privateRules({ privateDirs: ['repo2/secret'] }), g = (c, at = R) => bash(c, at, r);
  for (const d of [R, O]) { fs.mkdirSync(`${d}/secret`, { recursive: true }); fs.mkdirSync(`${d}/docs`); fs.writeFileSync(`${d}/docs/b.md`, 'y'); execFileSync('git', ['init', '-q'], { cwd: d }); }
  for (const c of ['git log -c', 'git log --cc', 'git log --dd', 'git log --remerge-diff', 'git log --binary', 'git log --diff-merges=on', 'git log --diff-merges on', 'git log --check', 'git log --stat -c',
    'git diff-tree -p HEAD', 'git diff-tree --patch-with-raw HEAD', 'git diff-tree --cc HEAD', 'git diff-index -p HEAD', 'git diff-files -p', 'git stash show -p', 'git stash show --patch', 'git stash show --include-untracked -p',
    'git stash list -p', 'git request-pull -p a b',
    'git show :/text', 'git show :0:docs/b.md', 'git show "HEAD^{/a:b}"', 'git cat-file -p :/text', 'git cat-file -p :0:docs/b.md']) assert.equal(g(c), P, c);
  for (const c of ['git log -c -- docs', 'git diff-tree -p HEAD -- docs', 'git diff-tree -r --name-only HEAD', 'git diff-tree --stat HEAD', 'git stash', 'git stash -u', 'git stash list', 'git stash show',
    'git log --oneline -n 5', 'git show HEAD:docs/b.md', 'git show main:docs/b.md HEAD:docs/b.md']) assert.equal(g(c), '', c);
  for (const c of ['git log -c', 'git diff-tree -p HEAD', 'git stash show -p', 'git show :/text']) assert.equal(g(c, O), '', c);
});

test('git history in a repo holding a private folder', () => {
  const R = `${H}/repo`, O = `${H}/plain`, r = privateRules({ privateDirs: ['repo/secret'] }), g = (c, at = R) => bash(c, at, r);
  for (const d of [R, O]) {
    fs.mkdirSync(`${d}/secret`, { recursive: true }); fs.mkdirSync(`${d}/docs`); fs.writeFileSync(`${d}/secret/a.md`, 'x'); fs.writeFileSync(`${d}/docs/b.md`, 'y');
    execFileSync('git', ['init', '-q'], { cwd: d });
  }
  for (const c of ['git show HEAD:secret/a.md', 'git cat-file -p HEAD:secret/a.md', 'git log -p', 'git log --patch', 'git log -U3', 'git log --word-diff', 'git log --patch-with-stat',
    'git log -Sword', 'git show', 'git show abc123', 'git show HEAD --stat -p', 'git show HEAD:docs/b.md abc123', 'git diff', 'git diff HEAD~1', 'git grep word', 'git grep word HEAD',
    'git cat-file -p abc123', 'git cat-file --batch', 'git format-patch -1', 'git archive HEAD', 'git bundle create x HEAD', 'git fast-export HEAD', 'git log -p -- secret',
    'git log -p -- "*.md"', 'git log -p -- :/secret', 'git -c a=b log -p', 'git diff -- docs secret'])
    assert.equal(g(c), P, c);
  // Inside the repo from elsewhere, or a folder it can't read.
  for (const c of [`git -C ${R} log -p`, `git -C ${R} show HEAD:secret/a.md`, `git --git-dir=${R}/.git log -p`, `cd ${R} && git log -p`, 'git -C $X log -p', 'git -C $X show HEAD:a.md'])
    assert.equal(g(c, cwd), P, c);
  assert.equal(g('git log -p', `${R}/secret`), P);
  for (const c of ['git status', 'git log --oneline', 'git log --stat', 'git log -5', 'git show --stat', 'git show -s HEAD', 'git show --name-only HEAD', 'git diff --stat', 'git diff --name-only',
    'git show HEAD:docs/b.md', 'git cat-file -p HEAD:docs/b.md', 'git cat-file -t abc123', 'git log -p -- docs', 'git log -p docs', 'git diff -- docs', 'git diff docs', 'git grep word -- docs',
    'git add docs', 'git commit -m x', 'git branch', 'git fetch origin'])
    assert.equal(g(c), '', c);
  // Any other repo, and no repo at all.
  for (const c of ['git log -p', 'git show', 'git diff', 'git grep word', 'git show HEAD:secret/a.md', 'git archive HEAD', 'git cat-file -p abc123']) {
    assert.equal(g(c, O), '', c);
    assert.equal(g(c, cwd), '', c);
    assert.equal(bash(c, R, privateRules({ privateTools: ['helpdesk'] })), '', c);
  }
});

test('a for list past the cap is judged as unknown, and a pipe to a shell may have a tail', () => {
  const names = Array.from({ length: 33 }, (_, i) => `n${i}`).join(' ');
  for (const c of [`for p in ${names} dumps; do cat ~/$p/a.txt; done`,
    'echo x | sh 2>/dev/null', 'echo x | bash 2>&1', 'echo x | sh > o', 'echo x | sh -', 'echo x | sh # c']) assert.equal(bash(c), P, c);
  for (const c of [`for p in ${names}; do echo $p; done`, "grep 'a| sh > o' x.txt", 'echo x | shasum > o']) assert.equal(bash(c), '', c);
});

test('remote: a bare ssh alias host and ssh:// URLs', () => {
  for (const c of ['rsync -av ./site/ prod:/var/www/', 'rsync -a prod:logs/ ./logs', 'unison . ssh://prod/x', 'unison . prod:x', 'git clone prod:repo.git', 'git ls-remote prod:repo.git', 'git remote add live prod:app.git', 'git clone ssh://prod/srv/app.git', 'rsync -a x rsync://box/mod/'])
    assert.equal(bash(c), P, c);
  for (const c of ['git fetch origin main:main', 'git pull origin dev:dev', 'git clone ssh://git@github.com/x/y.git', 'git clone https://github.com/x/y.git', 'rsync -a C:/data /tmp/x', 'rsync -a src/ /tmp/x/'])
    assert.equal(bash(c), '', c);
  assert.equal(bash('rsync -av ./site/ prod:/var/www/', cwd, privateRules({})), '', 'off without privateRemote');
});

test('xargs flags clustered ahead of the mark; a script fed in by xargs', () => {
  for (const c of ['echo x | xargs -0I {} sh -c {}', 'echo x | xargs -0J% sh -c %', 'echo ssh | xargs -0I{} {} box', 'echo ssh | xargs -0I {} {} box', 'echo ssh | xargs -0tI% % box', 'echo ssh | xargs -0 -I% % box', 'echo x | xargs sh', "echo x | xargs -I{} sh -c '{} box'"])
    assert.equal(bash(c), P, c);
  for (const c of ['ls | xargs -I{} cat {}', 'ls | xargs -0I{} cat {}', 'ls | xargs -0n1 echo', 'ls | xargs -0r echo', 'ls | xargs -0I % cp % /tmp'])
    assert.equal(bash(c), '', c);
});

test('a long run of function words takes under 1 s', () => {
  for (const c of ['function '.repeat(30000), 'function a '.repeat(24000)]) {
    const t = performance.now(); bash(c); const ms = performance.now() - t;
    assert.ok(ms < 1000, `${c.slice(0, 11)}: ${Math.round(ms)} ms`);
  }
});

test('other spellings of hidden shell forms are refused; everyday ones pass', () => {
  for (const c of ['cat ${p:-~/team/alpha}/a.txt', 'function f { ssh box; }; f', 'x+=1 ssh box', 'x[0]=1 ssh box', 'echo ssh | xargs -I{} {} box', 'echo x | sh >| o',
    'cat ${p:=~/team/alpha}/a.txt', 'cat ${p-~/team/alpha}/a.txt', 'cat ${a:-${b:-~/team/alpha}}/a.txt', "bash -c 'cat ${p:-~/team/alpha}/a.txt'",
    'function { ssh box; }', 'function f\n{\n  ssh box\n}', 'function f { $(echo ssh) box; }', 'x+=$(date) ssh box', 'x[0]=$(date) ssh box', 'x[a b]=1 ssh box', 'x[$(echo 0)]=1 ssh box', 'x+=1 $(echo ssh) box',
    'echo ssh | xargs -I % % box', "echo ssh | xargs -I'{}' {} box", 'echo ssh | xargs -i {} box', 'echo ssh | xargs --replace {} box', 'echo ssh | xargs -I{} sudo {} box', 'echo ssh | xargs -I{} /usr/bin/{} box',
    'ls | xargs -n1 echo; echo ssh | xargs -I{} {} box', 'echo ssh | xargs -d , -I{} {} box', 'echo x | sh >|o', 'echo x | sh 2>| o', 'x=$(date) ssh box', 'case x in x) ssh box;; esac'])
    assert.equal(bash(c), P, c);
  for (const c of ['x+=1', 'x+=1; echo $x', 'x[0]=1; echo ok', '((i+=1))', 'function f { echo hi; }; f', 'function f() { echo hi; }; f', 'echo ${x:-hello}', 'cat ${TMPDIR:-/tmp}/a.txt', 'cat ${p:-docs}.txt',
    'ls | xargs -I{} cat {}', 'ls | xargs -I{} echo {}', 'ls | xargs -n1 echo', 'ls | xargs -0 -I{} cp {} /tmp', 'echo x | tee a >| o', "grep 'function f {' x.sh", 'x=$(date); echo $x', 'x=$(date) node app.js', 'case x in x) echo hi;; esac'])
    assert.equal(bash(c), '', c);
});
