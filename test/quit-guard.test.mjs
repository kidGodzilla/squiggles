import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quitRefusal } from '../trust.mjs';

test('only the lead or the unlocked page quits the room', () => {
  assert.equal(quitRefusal({ caller: 'ana' })?.status, 403);
  assert.equal(quitRefusal({ caller: 'ana', owner: () => true })?.status, 403);
  assert.equal(quitRefusal({})?.unlock, true, 'a detached child is no caller');
  assert.equal(quitRefusal({ caller: 'lead', callerLead: true }), null);
  assert.equal(quitRefusal({ owner: () => true }), null);
  assert.equal(quitRefusal({ passcode: false }), null, 'no passcode: the lead is the only squiggle');
});

test('quit and restart take `by` from the caller, not the body', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const q = src.slice(src.indexOf("url.pathname === '/api/quit' && req.method === 'POST'"), src.indexOf("url.pathname === '/api/restart' && req.method === 'GET'"));
  assert.match(q, /quitRefusal\(\{ caller: c,/); assert.match(q, /quit\(!!b\.now, c \|\| 'owner'\)/);
  const r = src.slice(src.indexOf("url.pathname === '/api/restart' && req.method === 'POST'"), src.indexOf("url.pathname === '/api/restart' && req.method === 'POST'") + 600);
  assert.match(r, /b\.by = c \|\|/);
});

test('unlock prompts open above the forms that ask for them', () => {
  const css = fs.readdirSync(new URL('../ui/', import.meta.url)).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(new URL(`../ui/${f}`, import.meta.url), 'utf8')).join('\n');
  const z = (sel) => Number(css.match(new RegExp(`${sel} \\{[^}]*z-index: (\\d+)`))?.[1]);
  assert.ok(z('#dask') > z('\\.overlay'));
});
