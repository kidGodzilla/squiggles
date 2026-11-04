// The watch hash has no key, so a squiggle that writes watches.json approves its own command.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { commandReason, editReason, REASONS } from '../fence.mjs';
import { check as claude, MATCHER } from '../claude/guard.mjs';
import { check as codex } from '../codex/guard.mjs';
import { check as cursor } from '../cursor/guard.mjs';

const cwd = path.join(os.homedir(), 'squiggles'), F = 'runs/watches.json', A = path.join(cwd, F);
const cmd = (c) => commandReason(c, cwd);

test('shell writes to watches.json are refused', () => {
  for (const c of [`echo x > ${F}`, `echo x >> ${A}`, `echo x >| ${F}`, `echo x >${F}`, `cat a | tee ${F}`, `tee -a ${F} < a`,
    `cp /tmp/x ${F}`, `mv /tmp/x ${F}`, `ln -sf /tmp/x ${F}`, `rm ${F}`, `sed -i '' s/a/b/ ${F}`, `sed -i.bak s/a/b/ ${F}`, `perl -pi -e s/a/b/ ${F}`,
    `dd if=/tmp/x of=${F}`, `cd runs && echo x > watches.json`, `sh -c "echo x > ${F}"`, `echo x > "runs/watch"es.json`, `echo x > RUNS/WATCHES.JSON`,
    `node -e "fs.writeFileSync('${F}', x)"`, `node --input-type=module -e "fs.writeFileSync('${F}', x)"`, `python3 -c "open('${F}','w')"`,
    `python3 - <<EOF\nopen('${F}','w')\nEOF`, `node <<EOF\nfs.writeFileSync('${F}', x)\nEOF`]) assert.equal(cmd(c), REASONS.watches, c);
});

test('reads and prose about watches.json pass', () => {
  for (const c of [`cat ${F}`, `jq .watches ${F}`, `grep -n cmd ${F}`, `sed -n 1,5p ${F}`, `cat ${F} > /tmp/copy`, `wc -l ${F} | tail -1`,
    `git log -- ${F}`, `git commit -m "fence ${F}"`, `node bin/agents.mjs task add "look at ${F}"`, `cat >> journal.md <<EOF\nthe file ${F} is unkeyed\nEOF`,
    `node --test x | grep -E y\ncat ${F}`])
    assert.equal(cmd(c), '', c);
});

test('edit tools are refused in every guard, and reads and other files are not', () => {
  assert.match('Edit', new RegExp(`^(${MATCHER})$`)); assert.match('Write', new RegExp(`^(${MATCHER})$`)); assert.match('NotebookEdit', new RegExp(`^(${MATCHER})$`));
  const call = (tool_name, tool_input) => ({ tool_name, tool_input, cwd });
  for (const [tool, input] of [['Edit', { file_path: A, old_string: 'a', new_string: 'b' }], ['Write', { file_path: A, content: '{}' }]]) {
    assert.equal(claude(call(tool, input)), REASONS.watches, tool);
    assert.equal(cursor(call(tool, input)), REASONS.watches, tool);
  }
  assert.equal(editReason('write', { path: A }), REASONS.watches);
  assert.equal(editReason('edit', { path: F }), REASONS.watches);
  assert.equal(editReason('read', { path: F }), '');
  assert.equal(codex({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${F}\n*** End Patch` }, cwd }), REASONS.watches);
  assert.equal(codex({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: a.md\n*** Move to: ${F}\n*** End Patch` }, cwd }), REASONS.watches);
  assert.equal(claude(call('Write', { file_path: path.join(cwd, 'notes.md'), content: F })), '');
  assert.equal(claude(call('Read', { file_path: A })), '');
});
