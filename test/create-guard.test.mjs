import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRefusal, updateRefusal } from '../trust.mjs';

test('only the lead or the unlocked page hires', () => {
  assert.equal(createRefusal({ name: 'x', permissionMode: 'bypassPermissions' }, { caller: 'security' })?.status, 403);
  assert.equal(createRefusal({ name: 'x' }, {})?.unlock, true, 'a detached child is no caller');
  assert.equal(createRefusal({ name: 'x' }, { caller: 'lead', callerLead: true }), null);
  assert.equal(createRefusal({ name: 'x', permissionMode: 'bypassPermissions' }, { owner: () => true }), null);
});

test('permissionMode is one of the four the sheet offers', () => {
  assert.equal(createRefusal({ permissionMode: 'default --dangerously-skip-permissions' }, { owner: () => true })?.status, 400);
  assert.equal(updateRefusal({ permissionMode: 'yolo' }, { id: 'a' }, { owner: () => true })?.status, 400);
});

test('the create route goes through the guard', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("url.pathname === '/api/squiggles' && req.method === 'POST'"), src.indexOf('createSquiggle(b)'));
  assert.match(route, /createRefusal\(b, \{ caller: c,/);
});

test('no passcode: nobody hires, the lead included, until one is set', () => {
  assert.match(createRefusal({ name: 'x' }, { passcode: false, owner: () => true })?.error || '', /Set a room passcode first/);
  assert.match(createRefusal({ name: 'x' }, { caller: 'lead', callerLead: true, passcode: false })?.error || '', /Set a room passcode first/, 'the lead waits for it too');
  assert.match(createRefusal({ name: 'x' }, { caller: 'ann', passcode: false })?.error || '', /can't hire/);
});

test('a squiggle cannot set, clear or loosen the room passcode', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("url.pathname === '/api/passcode'"), src.indexOf('pass.op(req, b)'));
  assert.match(route, /\['set', 'clear', 'local'\]\.includes\(b\.op\) && await callerSquiggle\(req\)/);
});
