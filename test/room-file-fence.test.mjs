// The room file holds the passcode hash, and a swapped hash counts after the next restart, so a squiggle that writes it can
// unlock the page as its user. The server writes it; squiggles may read it.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { commandReason, REASONS } from '../fence.mjs';
import { check as claude } from '../claude/guard.mjs';
import { check as codex } from '../codex/guard.mjs';
import { check as cursor } from '../cursor/guard.mjs';
import piGuard from '../pi/guard.ts';

const cwd = path.join(os.homedir(), '.squiggles'), F = 'room' + '.json', A = path.join(cwd, F);
const cmd = (c) => commandReason(c, cwd);
let pi; piGuard({ on: (_, f) => { pi = f; } });

test('shell writes to the room file are refused', () => {
  for (const c of [`echo x > ${F}`, `echo x >> ${A}`, `cat a | tee ${F}`, `cp /tmp/x ${A}`, `mv /tmp/x ${F}`, `rm ${F}`,
    `sed -i '' s/a/b/ ${F}`, `node -e "fs.writeFileSync('${A}', x)"`, `python3 - <<EOF\nopen('${F}','w')\nEOF`]) assert.equal(cmd(c), REASONS.roomFile, c);
});

test('reads of the room file pass', () => {
  for (const c of [`cat ${F}`, `jq .passcode ${A}`, `cat ${F} > /tmp/copy`, `git commit -m "about ${F}"`]) assert.equal(cmd(c), '', c);
});

test('edit tools on the room file are refused in every guard; reads are not', async () => {
  const call = (tool_name, tool_input) => ({ tool_name, tool_input, cwd });
  for (const [tool, input] of [['Edit', { file_path: A, old_string: 'a', new_string: 'b' }], ['Write', { file_path: A, content: '{}' }]]) {
    assert.equal(claude(call(tool, input)), REASONS.roomFile, tool);
    assert.equal(cursor(call(tool, input)), REASONS.roomFile, tool);
  }
  for (const toolName of ['write', 'edit']) assert.equal((await pi({ toolName, input: { path: A } }))?.reason, REASONS.roomFile, toolName);
  assert.equal(codex({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${A}\n*** End Patch` }, cwd }), REASONS.roomFile);
  assert.equal(claude(call('Read', { file_path: A })), '');
});
