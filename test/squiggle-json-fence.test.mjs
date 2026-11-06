// Lead-only fields (trust, permissionMode, private) are checked only by the API, and the server reads squiggle.json from disk,
// so a squiggle that writes the file gives itself what the API refuses. Writes go through the server; your terminal has no guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { commandReason, editReason, REASONS } from '../fence.mjs';
import { check as claude } from '../claude/guard.mjs';
import { check as codex } from '../codex/guard.mjs';
import { check as cursor } from '../cursor/guard.mjs';
import piGuard from '../pi/guard.ts';

const cwd = path.join(os.homedir(), 'squiggles'), F = 'squiggles/helper/squiggle.json', A = path.join(cwd, F);
const cmd = (c) => commandReason(c, cwd);
let pi; piGuard({ on: (_, f) => { pi = f; } });

test('shell writes to squiggle.json are refused', () => {
  for (const c of [`echo x > ${F}`, `echo x >> ${A}`, `echo x >| ${F}`, `cat a | tee ${F}`, `cp /tmp/x ${F}`, `mv /tmp/x ${F}`, `ln -sf /tmp/x ${F}`, `rm ${F}`,
    `sed -i '' s/a/b/ ${F}`, `perl -pi -e s/a/b/ ${F}`, `dd if=/tmp/x of=${F}`, `cd squiggles/helper && echo x > squiggle.json`, `sh -c "echo x > ${F}"`,
    `node -e "fs.writeFileSync('${F}', x)"`, `python3 -c "open('${F}','w')"`, `python3 - <<EOF\nopen('${F}','w')\nEOF`]) assert.equal(cmd(c), REASONS.squiggle, c);
});

test('reads and prose about squiggle.json pass', () => {
  for (const c of [`cat ${F}`, `jq .lead ${F}`, `grep -c trust ${F}`, `cat ${F} > /tmp/copy`, `git log -- ${F}`, `git commit -m "fence ${F}"`,
    `node bin/agents.mjs task add "look at ${F}"`, `cat >> journal.md <<EOF\nthe file ${F} is writable\nEOF`]) assert.equal(cmd(c), '', c);
});

test('edit tools are refused in every guard, and reads and other files are not', async () => {
  const call = (tool_name, tool_input) => ({ tool_name, tool_input, cwd });
  for (const [tool, input] of [['Edit', { file_path: A, old_string: 'a', new_string: 'b' }], ['Write', { file_path: A, content: '{}' }]]) {
    assert.equal(claude(call(tool, input)), REASONS.squiggle, tool);
    assert.equal(cursor(call(tool, input)), REASONS.squiggle, tool);
  }
  for (const toolName of ['write', 'edit']) assert.equal((await pi({ toolName, input: { path: A } }))?.reason, REASONS.squiggle, toolName);
  assert.equal(await pi({ toolName: 'read', input: { path: A } }), undefined);
  assert.equal(codex({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${F}\n*** End Patch` }, cwd }), REASONS.squiggle);
  assert.equal(codex({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: a.md\n*** Move to: ${F}\n*** End Patch` }, cwd }), REASONS.squiggle);
  assert.equal(claude(call('Write', { file_path: path.join(cwd, 'notes.md'), content: F })), '');
  assert.equal(claude(call('Read', { file_path: A })), '');
});

test('the watches file keeps its own reason', () => {
  assert.equal(editReason('Write', { file_path: 'runs/watches.json' }), REASONS.watches);
  assert.equal(editReason('Write', { file_path: 'notes.md' }), '');
});
