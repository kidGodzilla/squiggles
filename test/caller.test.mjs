import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { parents, chain, sockPids, callerChain } from '../caller.mjs';

test('chain walks pid to launchd and stops on a loop (t1384)', () => {
  const pp = parents(' 50   40\n 40 30\n30 1\n 7 8\n 8 7\n');
  assert.deepEqual(chain(50, pp), [50, 40, 30]);
  assert.deepEqual(chain(7, pp), [7, 8]);
  assert.deepEqual(chain(99, pp), [99]);
});

test('socket pids leave out the server end (t1384)', () => {
  assert.deepEqual(sockPids('p10\nf5\np20\np10\n', 10), [20]);
});

test('callerChain finds the process on the other end, and its parent (t1384)', async () => {
  let child, got;
  const srv = http.createServer(async (req, res) => { got = await callerChain(req); res.end('ok'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  child = spawn(process.execPath, ['-e', `fetch('http://127.0.0.1:${srv.address().port}/').then((r) => r.text())`], { stdio: 'ignore' });
  await new Promise((r) => child.on('exit', r)); srv.close();
  assert.equal(got[0], child.pid); assert.equal(got[1], process.pid);
  assert.deepEqual(await callerChain({ socket: { remoteAddress: '10.0.0.2', remotePort: 1 }, headers: {} }), []);
});
