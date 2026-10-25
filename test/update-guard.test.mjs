import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateRefusal } from '../trust.mjs';

const s = { id: 'security', name: 'Ana', cwd: '~/project', permissionMode: 'auto', model: 'claude-opus-5-5', trust: 'medium' };

test('a squiggle cannot make itself lead or change lead-only fields', () => {
  assert.equal(updateRefusal({ lead: true }, s, { caller: 'security', callerLead: false }).status, 403);
  assert.equal(updateRefusal({ lead: true }, s, { caller: 'lead', callerLead: true }).status, 403, 'lead is the user only');
  for (const [k, v] of [['permissionMode', 'bypassPermissions'], ['cwd', '/'], ['trust', 'veryhigh'], ['model', 'claude-sonnet-5-5']])
    assert.match(updateRefusal({ [k]: v }, s, { caller: 'security', callerLead: false })?.error || '', new RegExp(k), k);
});

test('the lead and the user may; unchanged values pass', () => {
  assert.equal(updateRefusal({ trust: 'high', cwd: '/x' }, s, { caller: 'lead', callerLead: true }), null);
  assert.equal(updateRefusal({ lead: true, trust: 'high' }, s, { owner: () => true }), null);
  assert.equal(updateRefusal({ name: 'V', cwd: '~/project', model: 'claude-opus-5-5', permissionMode: 'auto', trust: 'medium', lead: false }, s, { caller: 'security', callerLead: false }), null);
});

test('only known fields are saved', () => {
  assert.equal(updateRefusal({ created: 1 }, s, { caller: '', callerLead: false }).status, 400);
  assert.equal(updateRefusal({ resume: 'x' }, s, { caller: 'lead', callerLead: true }).status, 400);
});

test('the update route goes through the guard, not a raw spread', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("case 'update': {"), src.indexOf('saveSquiggle({ ...s, ...meta, id })'));
  assert.match(route, /updateRefusal\(meta, s, \{ caller: c,.*charter: charter != null, owner, passcode: .*, user: USER \}\)/);
});

test('no caller (a double-forked child) needs the unlocked page for lead-only fields and charters', () => {
  for (const m of [{ lead: true }, { trust: 'veryhigh' }, { cwd: '/' }]) assert.equal(updateRefusal(m, s, {})?.unlock, true, JSON.stringify(m));
  assert.equal(updateRefusal({}, s, { charter: true })?.status, 403);
  assert.equal(updateRefusal({ paused: true }, s, {}), null, 'plain fields stay open to the CLI');
  assert.equal(updateRefusal({ lead: true }, s, { charter: true, owner: () => true }), null);
});

test('a non-lead squiggle changes only itself, charter included', () => {
  assert.equal(updateRefusal({}, { ...s, id: 'lead' }, { caller: 'security', charter: true })?.status, 403);
  assert.equal(updateRefusal({ paused: true }, { ...s, id: 'ops' }, { caller: 'security' })?.status, 403);
  assert.equal(updateRefusal({ paused: true }, s, { caller: 'security', charter: true }), null);
  assert.equal(updateRefusal({ paused: true }, { ...s, id: 'ops' }, { caller: 'lead', callerLead: true, charter: true }), null);
});

test('every field the sheet, Settings and `set` change is accepted', () => {
  const me = { caller: 'security' };
  for (const f of ['name', 'role', 'every', 'paused', 'look', 'lookSeed', 'maxTurns', 'chrome', 'effort', 'awake', 'autocompact', 'voice'])
    assert.equal(updateRefusal({ [f]: 'x' }, s, me), null, f);
});

test('no caller and no passcode: lead and lead-only fields need one set; a charter stays open', () => {
  const none = { passcode: false, owner: () => true };
  assert.equal(updateRefusal({ lead: true }, s, none)?.status, 403);
  for (const [k, v] of [['permissionMode', 'bypassPermissions'], ['cwd', '/'], ['trust', 'veryhigh'], ['model', 'claude-sonnet-5-5']])
    assert.match(updateRefusal({ [k]: v }, s, none)?.error || '', /Set a room passcode first/, k);
  assert.equal(updateRefusal({}, s, { ...none, charter: true }), null);
  assert.equal(updateRefusal({ paused: true, cwd: '~/project' }, s, none), null, 'unchanged lead-only values pass');
});
