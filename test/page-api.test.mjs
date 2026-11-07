// a proxy's HTML 502 made api() throw an unhandled rejection; callers read .error, so it has to answer with one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../ui/room.js', import.meta.url), 'utf8');
const line = /^const api = async \(p, body\) => .*$/m.exec(src)[0];
const page = (reply) => {
  const seen = { reloads: 0 }, location = { reload: () => seen.reloads++ };
  const api = new Function('fetch', 'GATE', 'PASS', 'location', `${line}\nreturn api;`)(async () => reply, Promise.resolve(), { set: true, ok: true }, location);
  return { api, seen };
};
const res = (status, text) => new Response(text, { status });

test('a non-JSON 5xx answers with an error', async () => {
  const r = await page(res(502, '<html>Bad gateway</html>')).api('/squiggles');
  assert.match(r.error, /502/);
});

test('an empty reply answers with an error', async () => {
  assert.match((await page(res(500, '')).api('/x', {})).error, /500/);
});

test('JSON passes through', async () => {
  assert.deepEqual(await page(res(200, '{"a":1}')).api('/x'), { a: 1 });
  assert.deepEqual(await page(res(500, '{"error":"no"}')).api('/x'), { error: 'no' });
});

test('a 401 still reloads unless it asks for the code', async () => {
  const a = page(res(401, '{}')); await a.api('/x'); assert.equal(a.seen.reloads, 1);
  const b = page(res(401, '{"unlock":true}')); await b.api('/x'); assert.equal(b.seen.reloads, 0);
});
