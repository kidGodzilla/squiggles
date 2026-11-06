// Forms the private fence's strict mode must refuse, and everyday commands next to them it must let through.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateReason, privateRules, commandReason, REASONS } from '../fence.mjs';

const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'))), cwd = `${H}/app`;
for (const d of ['app/src', 'team/alpha']) fs.mkdirSync(`${H}/${d}`, { recursive: true });
test.after(() => fs.rmSync(H, { recursive: true, force: true }));
const rules = privateRules({ privateDirs: ['team/alpha'], privateRemote: true });
const run = (command) => privateReason('Bash', { command }, cwd, H, rules);
const refused = (list) => { for (const c of list) assert.equal(run(c), REASONS.private, c); };
const passes = (list) => { for (const c of list) assert.equal(run(c), '', c); };
const words = (n, w = 'v') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

test('a program after a substituted assignment or built in quotes', () => {
  refused(['x=$(date) ssh box', 'x=$(echo a b) $(echo ssh) box', '"a $(echo ssh)" box', '"`echo ssh`" box']);
  passes(['x=$(date)', 'FOO=$(date) node app.js', 'x="a; $(date)"; echo $x', 'echo "$(date)$(date)"', 'echo "a $(date)" box']);
});

test('a substitution inside a path counts as a glob', () => {
  refused(['cat ~/te`echo am`/alpha/a', 'cat ~/te$(echo am)/alpha/a']);
  passes(['cat src/`date`/a', 'cat ~/app/$(date)/a', 'echo `date`/x']);
});

test('an unknown variable leading a path could be anywhere', () => {
  refused(['cat $p/a.txt', 'cat ${p}/a.txt', 'cat < $p/a.txt', 'p=$(echo ~/team/alpha); cat $p/a', `for p in ${words(40)}; do cat $p/a; done`]);
  passes(['p=/tmp; cat $p/a', 'cat $HOME/app/a', 'cat $PWD/a', 'cat $TMPDIR/a', 'echo $p/a', `for p in ${words(5)}; do cat $p/a; done`, `for p in ${words(40)}; do echo $p; done`]);
  refused(['p=/tmp; cat $p/a $q/b', 'p=~/team/alpha; cat $p/a', 'cat $PWD/../team/alpha/a', 'r=$(pwd); cat $r/../team/alpha/a']);
  passes(['r=$(pwd); cat $r/a']);
});

test('a script on the pipe, however the shell is spelled or wrapped', () => {
  refused(["ls | xargs -I{} sh -c '{}'", 'echo x | (sh)', 'echo x | ( sh )', 'echo x | s\\h', 'echo x | \\sh', 'echo x | busybox sh', 'echo x | setsid sh', 'echo x | stdbuf -o0 sh', 'echo x | caffeinate -i sh']);
  passes(['echo x | (cat)', "printf 'a\\nb' | cat", "grep 'a\\bc' src", 'ls | wc -l']);
});

test('wrappers are read through', () => {
  refused(['setsid ssh box', 'caffeinate ssh box', 'stdbuf -o0 ssh box', 'busybox ssh box']);
});

test('a shell given one word: the program and its arguments are read', () => {
  const dl = `${os.homedir()}/Downloads`;
  refused([`/bin/zsh -lc "rg -n "x" ${H}/team/alpha"`, `/bin/zsh -lc "rg -n x ${H}/team/alpha"`]);
  passes(['/bin/zsh -lc "rg -n "x" src"']);
  assert.ok(commandReason(`/bin/zsh -lc "rg -n "x" ${dl}"`, cwd));
  assert.equal(commandReason('/bin/zsh -lc "rg -n "x" src"', cwd), '');
});

test('path prefixes are looked up once per command, not once per word', (t) => {
  const real = fs.realpathSync, native = real.native;
  let calls = 0;
  const counted = (...a) => { calls++; return real(...a); };
  counted.native = (...a) => { calls++; return native(...a); };
  fs.realpathSync = counted;
  t.after(() => { fs.realpathSync = real; });
  commandReason(`for p in ${words(1000, 'src/w')}; do cat $p; done`, cwd);
  assert.ok(calls < 3000, `${calls} lookups for 1000 words`);
});

test('a for over many words answers fast', () => {
  for (const c of [`for p in ${words(4000, 'w')}; do echo $p; done`, `for p in ${words(4000, 'src/w')}; do cat $p; done`]) {
    // Each check on its own, in CPU time as in fence-slow-word: the wall clock also counts the test files running beside this one.
    for (const check of [() => run(c), () => commandReason(c, cwd)]) {
      const at = process.cpuUsage();
      check();
      const { user, system } = process.cpuUsage(at), ms = (user + system) / 1000;
      assert.ok(ms < 1000, `${Math.round(ms)} ms`);
    }
  }
});

test('a shell given options before its -c text', () => {
  refused(['bash -o pipefail -c "ssh box"', "bash -eo pipefail -c 'ssh box'", "bash +o history -c 'ssh box'", "bash --rcfile x -c 'ssh box'"]);
  passes(["bash -o pipefail -c 'npm test'", "bash -lc 'npm test'", "zsh -c 'cat src/a | grep x'"]);
});

test('the -c text is read as a command, whole', () => {
  refused(["/bin/zsh -lc '$(echo ssh) box'", `/bin/zsh -lc "echo 'ssh x' | sh"`, `sh -c "sh -c 'ssh box'"`, `cd /tmp; bash -c "echo 'ssh x' | sh"`, `echo "$(sh -c "echo 'ssh x' | sh")"`, `sh -c "echo 'ssh x' | sh" <<'E'\n'\nE`]);
  passes([`echo "run sh -c 'ssh box'"`, `bash -c "echo 'ssh x' | grep s"`, `zsh -lc "cd /tmp; python3 - <<'E'\nprint('~/\`date\`/a.txt')\nE"`]);
});

test('a script run by a shell with an option', () => {
  fs.writeFileSync(`${cwd}/opt.sh`, 'ssh box\n');
  fs.writeFileSync(`${cwd}/fine.sh`, 'echo hi\n');
  refused(['bash -o pipefail opt.sh']);
  passes(['bash -o pipefail fine.sh']);
});

test('a pipe into a shell behind a group or an option', () => {
  refused(['echo x | (cd /tmp; sh)', 'echo x | { cd /tmp; sh; }', 'echo x | bash -o pipefail']);
  passes(['echo x | (cd /tmp; cat)', 'echo x | { grep x; }']);
});

test('a variable set outside the -c text', () => {
  refused([`p=~/team/alpha; bash -c 'cat $p/a'`, `export p=~/team/alpha; bash -c 'cat $p/a'`, `p=$(echo ~/team/alpha); sh -c 'cat $p/a'`, `bash -c 'cat $p/a'`]);
  passes(['d=/tmp; bash -c "cat $d/a"', `d=/tmp bash -c 'cat $d/a'`]);
});

test('many -c texts stay quick', () => {
  const start = process.cpuUsage();
  passes([Array.from({ length: 3000 }, (_, i) => `sh -c 'echo ${i}'`).join('; ')]);
  const { user, system } = process.cpuUsage(start);
  assert.ok(user + system < 4e6, `${(user + system) / 1e6} s`);
});
