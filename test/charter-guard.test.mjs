// A squiggle rewrites its own charter only in a turn the user or the lead asked for; the lead sees the diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { updateRefusal, charterDiff } from '../trust.mjs';

const s = { id: 'support', name: 'Tess', trust: 'medium' }, own = (askers, leadId = 'lead') => updateRefusal({}, s, { caller: 'support', charter: true, askers, leadId });

test('own charter: refused on a scheduled wake, an inbox note or another squiggle asking', () => {
  for (const a of [[], ['harness'], ['security'], ['Sam']]) assert.equal(own(a)?.status, 403, JSON.stringify(a));
  assert.match(own([]).error, /the user or the lead/);
});

test('own charter: allowed when the user or the lead asked this turn; lead and the user unaffected', () => {
  for (const a of [['owner'], ['lead'], ['security', 'owner']]) assert.equal(own(a), null, JSON.stringify(a));
  assert.equal(own(['boss'], 'boss'), null, 'lead with another id');
  assert.equal(updateRefusal({}, s, { caller: 'lead', callerLead: true, charter: true }), null);
  assert.equal(updateRefusal({}, s, { charter: true, owner: () => true }), null);
  assert.equal(updateRefusal({ paused: true }, s, { caller: 'support' }), null, 'other own fields need no asker');
});

test('charterDiff shows removed and added lines, capped', () => {
  assert.equal(charterDiff('a\nb\nc', 'a\nc\nd'), '- b\n+ d');
  assert.ok(charterDiff('', 'x'.repeat(3000)).length <= 1501);
});

test('the update route passes the turn askers and reports self-rewrites to the lead', () => {
  const src = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(src, /askers: \(c && R\(c\)\.asked\) \|\| \[\]/);
  assert.match(src, /CHARTER\] rewrote its own charter/);
});

test('charter.md edited with file tools: reverted unless the user or the lead asked', async () => {
  const { charterEdit } = await import('../trust.mjs');
  const e = (o) => charterEdit({ before: 'old', after: 'new', leadId: 'lead', ...o });
  assert.equal(e({ askers: [] }), 'revert');
  assert.equal(e({ askers: ['security'] }), 'revert');
  assert.equal(e({ askers: ['owner'] }), 'report');
  assert.equal(e({ askers: ['lead'] }), 'report');
  assert.equal(e({ lead: true }), 'keep', 'the lead edits its own');
  assert.equal(e({ after: 'old\n' }), 'keep', 'whitespace only');
  assert.equal(e({ before: undefined }), 'keep', 'no copy from turn start (restart mid-turn)');
});
