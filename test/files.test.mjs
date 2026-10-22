import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFiles } from '../files.mjs';

function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'files-')), root = path.join(d, 'app'), docs = path.join(d, 'docs');
  fs.mkdirSync(path.join(root, 'research', 'sub'), { recursive: true }); fs.mkdirSync(path.join(docs, 'proposals'), { recursive: true });
  fs.writeFileSync(path.join(root, 'research', 'sub', 't42-notes.md'), 'about zebras');
  fs.writeFileSync(path.join(docs, 'proposals', 'p.md'), 'plain');
  fs.utimesSync(path.join(docs, 'proposals', 'p.md'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  fs.writeFileSync(path.join(d, 'secret.txt'), 'no');
  return { d, f: createFiles({ root, extra: { proposals: path.join(docs, 'proposals') }, tasks: () => [{ id: 't42', title: 'x' }] }) };
}

test('lists every source newest first, links tasks, searches text', () => {
  const { f } = setup();
  f.add({ name: 'drop.txt', data: Buffer.from('hello').toString('base64'), by: 'owner' });
  const l = f.list();
  assert.deepEqual(l.map((x) => `${x.src}/${x.name}`).slice(-1), ['proposals/p.md']);
  assert.equal(l.find((x) => x.name === 'drop.txt').by, 'owner');
  assert.equal(l.find((x) => x.name === 'sub/t42-notes.md').task, 't42');
  assert.deepEqual(f.list('zebra').map((x) => x.name), ['sub/t42-notes.md']);
  assert.deepEqual(f.list('DROP').map((x) => x.name), ['drop.txt']);
  assert.ok(!f.list().some((x) => x.name === '.meta.json'));
});

test('add never overwrites; rm only in files/', () => {
  const { f } = setup();
  assert.equal(f.add({ name: '../a.txt', data: '' }).name, 'a.txt');
  assert.equal(f.add({ name: 'a.txt', data: '' }).name, 'a-2.txt');
  assert.throws(() => f.add({ name: '.env', data: '' }));
  assert.equal(f.rm('a.txt').removed, 'a.txt');
  assert.throws(() => f.rm('p.md'));
  assert.throws(() => f.rm('../research/sub/t42-notes.md'));
});

test('resolve stays inside its source', () => {
  const { f } = setup();
  assert.ok(f.resolve('research', 'sub/t42-notes.md'));
  assert.equal(f.resolve('research', '../../secret.txt'), null);
  assert.equal(f.resolve('files', '.meta.json'), null);
  assert.equal(f.resolve('nope', 'x'), null);
  assert.equal(f.resolve('constructor', 'x'), null); assert.equal(f.resolve('__proto__', 'x'), null);
});
