// Shared files: squiggles delete only their own; who added a file comes from the caller, not the body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileRmRefusal, fileBy } from '../trust.mjs';

const base = { user: 'Sam', passcode: true, owner: () => false };
test('a squiggle deletes only files it added', () => {
  assert.equal(fileRmRefusal({ ...base, caller: 'ana', uploader: 'ana' }), null);
  assert.equal(fileRmRefusal({ ...base, caller: 'ana', uploader: 'owner' }).status, 403);
  assert.equal(fileRmRefusal({ ...base, caller: 'ana', uploader: '' }).status, 403);
  assert.equal(fileRmRefusal({ ...base, caller: 'ana', uploader: 'bo', owner: () => true }).status, 403);
});
test('the page deletes once unlocked, or freely before a passcode is set', () => {
  assert.equal(fileRmRefusal({ ...base, caller: null, uploader: 'ana' }).unlock, true);
  assert.equal(fileRmRefusal({ ...base, caller: null, uploader: 'ana', owner: () => true }), null);
  assert.equal(fileRmRefusal({ ...base, caller: null, uploader: 'ana', passcode: false }), null);
});
test('by is the calling squiggle, or a person in the room', () => {
  assert.equal(fileBy('ana', 'owner', ['owner']), 'ana');
  assert.equal(fileBy('ana', 'bo', ['owner']), 'ana');
  assert.equal(fileBy(null, 'kim', ['owner', 'kim']), 'kim');
  assert.equal(fileBy(null, 'bo', ['owner', 'kim']), 'owner');
  assert.equal(fileBy(null, undefined, ['owner']), 'owner');
});
