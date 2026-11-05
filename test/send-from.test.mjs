import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sendFrom } from '../trust.mjs';

test('a squiggle sends as itself, never as the user or the lead', () => {
  assert.deepEqual(sendFrom({ from: 'owner', human: 'ann' }, { caller: 'scout' }), { from: 'scout' });
  assert.deepEqual(sendFrom({ from: 'lead' }, { caller: 'scout' }), { from: 'scout' });
  assert.deepEqual(sendFrom({ from: 'harness' }, { caller: 'scout' }), { from: 'scout' });
});

test('the lead sends as the lead, even if it claims the user', () => {
  assert.deepEqual(sendFrom({ from: 'owner' }, { caller: 'boss', callerLead: true }), { from: 'lead' });
});

test('the page and the terminal keep their word', () => {
  assert.deepEqual(sendFrom({ from: 'owner', human: 'ann' }, {}), { from: 'owner', human: 'ann' });
  assert.deepEqual(sendFrom({}, {}), { from: 'owner', human: undefined });
  assert.deepEqual(sendFrom({ from: 'lead' }, { caller: '' }), { from: 'lead', human: undefined });
});

test('the send route takes `from` from the process tree', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("case 'send':"), src.indexOf("case 'wake':"));
  assert.match(route, /sendFrom\(b, \{ caller: c,/);
  assert.doesNotMatch(route, /b\.from/);
});
