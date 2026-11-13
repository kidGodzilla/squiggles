// The private fence reads a script named in a command to check it. A FIFO there blocked that read with no CPU use, so the
// guard's CPU limit never fired and the client's hook timeout could run the tool unchecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fifo-')));
fs.mkdirSync(`${H}/team/alpha`, { recursive: true });
const fifo = `${H}/p`;
execFileSync('mkfifo', [fifo]);
fs.writeFileSync(`${H}/ok.sh`, '#!/bin/sh\necho hi\n');
fs.writeFileSync(`${H}/bad.sh`, '#!/bin/sh\ncat ~/team/alpha/x\n');
test.after(() => fs.rmSync(H, { recursive: true, force: true }));

const fence = new URL('../fence.mjs', import.meta.url).href;
// In a child, so a hang shows as a timeout instead of stopping the suite.
const check = (command) => {
  const src = `import { privateReason, privateRules } from ${JSON.stringify(fence)};
    process.stdout.write(privateReason('bash', { command: ${JSON.stringify(command)} }, ${JSON.stringify(H)}, ${JSON.stringify(H)}, privateRules({ privateDirs: ['team/alpha'] })) ? 'refused' : 'ok');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { timeout: 10000, encoding: 'utf8' });
  return r.error?.code === 'ETIMEDOUT' ? 'hung' : r.stdout;
};

test('a FIFO run as a script is refused at once, not left hanging', () => {
  for (const c of [`sh ${fifo}`, `${fifo}`, `sh ${fifo}; echo x`, `echo x; bash ${fifo}`]) assert.equal(check(c), 'refused', c);
});
test('regular scripts are still read: a plain one passes, one reading a private folder refuses', () => {
  assert.equal(check(`sh ${H}/ok.sh`), 'ok');
  assert.equal(check(`sh ${H}/bad.sh`), 'refused');
});
