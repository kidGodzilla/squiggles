import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateRefusal } from '../trust.mjs';

const s = { name: 'Ana', cwd: '~/project', permissionMode: 'auto', model: 'claude-opus-5-5', trust: 'medium' };

test('a squiggle cannot make itself lead or change lead-only fields', () => {
  assert.equal(updateRefusal({ lead: true }, s, 'security', false).status, 403);
  assert.equal(updateRefusal({ lead: true }, s, 'lead', true).status, 403, 'lead is the user only');
  for (const [k, v] of [['permissionMode', 'bypassPermissions'], ['cwd', '/'], ['trust', 'veryhigh'], ['model', 'claude-sonnet-5-5']])
    assert.match(updateRefusal({ [k]: v }, s, 'security', false)?.error || '', new RegExp(k), k);
});

test('the lead and the user may; unchanged values pass', () => {
  assert.equal(updateRefusal({ trust: 'high', cwd: '/x' }, s, 'lead', true), null);
  assert.equal(updateRefusal({ lead: true, trust: 'high' }, s, '', false), null);
  assert.equal(updateRefusal({ name: 'V', cwd: '~/project', model: 'claude-opus-5-5', permissionMode: 'auto', trust: 'medium', lead: false }, s, 'security', false), null);
});

test('only known fields are saved', () => {
  assert.equal(updateRefusal({ created: 1 }, s, '', false).status, 400);
  assert.equal(updateRefusal({ resume: 'x' }, s, 'lead', true).status, 400);
});

test('the update route goes through the guard, not a raw spread', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("case 'update': {"), src.indexOf('saveSquiggle({ ...s, ...meta, id })'));
  assert.match(route, /updateRefusal\(meta, s, c,/);
});
