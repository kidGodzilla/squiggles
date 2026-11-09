import test from 'node:test'; import assert from 'node:assert/strict';
import { toolsFor, BASE_TOOLS } from '../tools.mjs';

test('toolsFor: base set by default, Skill only when skills is on', () => {
  assert.equal(toolsFor({}), BASE_TOOLS.join(','));
  assert.ok(!toolsFor({ skills: false }).includes('Skill'));
  assert.ok(toolsFor({ skills: true }).endsWith(',Skill'));
  for (const t of ['Bash', 'Read', 'Edit', 'Write', 'Task', 'ToolSearch']) assert.ok(BASE_TOOLS.includes(t), t); // ToolSearch loads chrome's deferred tools
  for (const t of ['PushNotification', 'CronCreate', 'EnterWorktree', 'Workflow']) assert.ok(!BASE_TOOLS.includes(t), t);
});
