import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAsks, askHash } from '../asks.mjs';

const setup = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asks-')); let t = 1e12;
  const asks = createAsks({ file: path.join(d, 'asks.json'), log: path.join(d, 'asks.log'), now: () => t });
  return { d, asks, tick: (ms) => { t += ms; }, log: () => fs.readFileSync(path.join(d, 'asks.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) };
};

test('file freezes cmd and cwd and hashes cwd NUL cmd', () => {
  const { d, asks } = setup();
  const a = asks.file({ by: 'ops', cwd: d, cmd: 'echo hi', why: 'needs a write' });
  assert.equal(a.id, 'a1'); assert.equal(a.status, 'pending');
  assert.equal(a.sha, askHash(d, 'echo hi'));
  assert.notEqual(askHash(d, 'echo hi'), askHash(`${d}\u0000echo`, ' hi'.slice(1)));
  assert.throws(() => asks.file({ by: '', cwd: d, cmd: 'x' }), /only a squiggle/);
  assert.throws(() => asks.file({ by: 'ops', cwd: d, cmd: '  ' }), /empty/);
  assert.throws(() => asks.file({ by: 'ops', cwd: d, cmd: 'a\u0000b' }), /NUL/);
  assert.throws(() => asks.file({ by: 'ops', cwd: d, cmd: 'x'.repeat(8193) }), /over/);
  assert.throws(() => asks.file({ by: 'ops', cwd: 'rel', cmd: 'x' }), /not a folder/);
  for (let i = 0; i < 4; i++) asks.file({ by: 'ops', cwd: d, cmd: `echo ${i}` });
  assert.throws(() => asks.file({ by: 'ops', cwd: d, cmd: 'one more' }), /5 pending/);
});

test('claim is one-shot and bound to the bytes shown (bidi and zero-width)', () => {
  const { d, asks, log } = setup();
  const cmd = 'echo safe ‮;hr- mr‬ && echo ​ok';
  const a = asks.file({ by: 'ops', cwd: d, cmd });
  assert.throws(() => asks.claim(a.id, askHash(d, 'echo safe ;hr- mr && echo ok'), 'owner'), (e) => e.code === 409);
  assert.throws(() => asks.claim(a.id, undefined, 'owner'), (e) => e.code === 409);
  const r = asks.claim(a.id, askHash(d, cmd), 'owner');
  assert.equal(r.status, 'running');
  assert.throws(() => asks.claim(a.id, askHash(d, cmd), 'owner'), (e) => e.code === 409);
  const f = asks.finish(a.id, { exit: 0, ms: 12, out: 'ok' });
  assert.equal(f.status, 'done');
  assert.deepEqual(log().map((x) => x.ev), ['filed', 'running', 'done']);
  assert.ok(log().every((x) => x.sha === a.sha));
});

test('an edited asks.json is refused at claim', () => {
  const { d, asks } = setup();
  const a = asks.file({ by: 'ops', cwd: d, cmd: 'echo a' });
  const shown = a.sha, j = JSON.parse(fs.readFileSync(path.join(d, 'asks.json'), 'utf8'));
  j.asks[0].cmd = 'rm -rf ~'; fs.writeFileSync(path.join(d, 'asks.json'), JSON.stringify(j));
  assert.throws(() => asks.claim(a.id, shown, 'owner'), /changed since/);
});

test('deny: the owner any, a squiggle only its own; final', () => {
  const { d, asks } = setup();
  const a = asks.file({ by: 'ops', cwd: d, cmd: 'echo a' }), b = asks.file({ by: 'ops', cwd: d, cmd: 'echo b' });
  assert.throws(() => asks.deny(a.id, { by: 'seo' }), (e) => e.code === 403);
  assert.equal(asks.deny(a.id, { by: 'ops' }).status, 'withdrawn');
  assert.equal(asks.deny(b.id, { owner: true, note: 'no' }).status, 'denied');
  assert.throws(() => asks.deny(b.id, { owner: true }), (e) => e.code === 409);
  assert.throws(() => asks.claim(b.id, b.sha, 'owner'), (e) => e.code === 409);
  assert.equal(asks.list().length, 0); assert.equal(asks.list({ all: true }).length, 2);
});

test('pending asks expire after 24h', () => {
  const { d, asks, tick, log } = setup();
  const a = asks.file({ by: 'ops', cwd: d, cmd: 'echo a' });
  tick(864e5 + 1);
  assert.equal(asks.list().length, 0);
  assert.throws(() => asks.claim(a.id, a.sha, 'owner'), /expired/);
  assert.equal(log().filter((x) => x.ev === 'expired').length, 1);
});

test('runAsk: frozen cwd, no squiggle env, stdin closed, masked, capped, timed out', async () => {
  const { runAsk, mask } = await import('../asks.mjs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  process.env.AGENTS_ID = 'ops';
  const r = await runAsk({ cwd: d, cmd: 'pwd; echo "id=${AGENTS_ID:-none}"; cat; echo token=hunter2secret >&2; exit 3' });
  delete process.env.AGENTS_ID;
  assert.equal(r.exit, 3);
  assert.match(r.out, new RegExp(`${fs.realpathSync(d)}\\n`)); assert.match(r.out, /id=none/); assert.match(r.out, /token=\[masked\]/);
  assert.doesNotMatch(r.out, /hunter2/);
  const big = await runAsk({ cwd: d, cmd: 'yes x | head -c 50000' }, { cap: 1024 });
  assert.ok(big.out.length < 1200); assert.match(big.out, /cut at 1 KB/);
  const slow = await runAsk({ cwd: d, cmd: 'sleep 30' }, { ms: 300 });
  assert.notEqual(slow.exit, 0); assert.match(slow.out, /stopped after/); assert.ok(slow.ms < 5000);
  const bg = await runAsk({ cwd: d, cmd: 'sleep 20 & echo started' }, { ms: 60000 });
  assert.equal(bg.exit, 0); assert.ok(bg.ms < 5000, `background child held it ${bg.ms}ms`);
  assert.equal(mask('commit 1d8a03f5e9c2 at a7116dc'), 'commit 1d8a03f5e9c2 at a7116dc');
  assert.equal(mask('Bearer abcdefgh1234'), 'Bearer [masked]');
  assert.equal(mask('https://me:pw12345@github.com/x'), 'https://me:[masked]@github.com/x');
});

test('mask: common secret shapes, with fake values; shas and plain config stay readable', async () => {
  const { mask } = await import('../asks.mjs');
  const leaks = {
    'SMS_KEY=tb_fake_123456': 'tb_fake', 'AUTH_KEYS=a1b2c3,d4e5f6': 'a1b2c3', 'export MAIL_KEY="pm-fake-0000"': 'pm-fake',
    'SIMPLE_ENCRYPTOR_KEY=abcdefghijklmnop': 'abcdefgh', 'SENTRY_DSN=https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/2': '0123456789abcdef',
    '=====> api env vars\nSMS_KEY:         tb fake value\nSESSION_SECRET:   hush hush': 'fake value|hush',
    '-----> Setting config vars\n       MAIL_KEY:  pm-fake-0000': 'pm-fake', 'dokku config:set api STRIPE_SECRET=xyz123abc NODE_ENV=production': 'xyz123',
    'sent with SG.abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123': 'SG\\.abc', 'sk_live_51Habcdefghijklmnop': 'sk_live', 'rk_live_51Habcdefghijklmnop': 'rk_live',
    'key AIzaSyA-fake0123456789abcdefghijklmnopq': 'AIza', 'ya29.a0AfH6SMfakefakefakefake': 'ya29', 'url https://0123456789abcdef0123@sentry.io/1': '0123456789abcdef0123@',
    'x-auth: s3cr3tvalue': 's3cr3t', 'X-Acme-Admin-Auth: abc123def456': 'abc123', 'Authorization: Basic dXNlcjpwYXNz': 'dXNlc', 'mongodb://u:p4ssw0rd@db/x': 'p4ss',
  };
  for (const [s, leak] of Object.entries(leaks)) assert.doesNotMatch(mask(s), new RegExp(leak), s);
  const keep = 'commit a7116dc 1d8a03f5e9c2b4a6d8f0e1c3b5a7d9f1e3c5b7a9 KEY_COUNT; PWD=/tmp; NODE_ENV:  production; DOKKU_APP_TYPE=herokuish';
  assert.equal(mask(keep), keep);
});

test('mask: full fake-value probe, 33 shapes; shas, uuids, paths and plain config stay readable', async () => {
  const { mask } = await import('../asks.mjs');
  const F="Zq7xR2mK9pL4vT8wB3nH6jD1", B64=Buffer.from("{\"type\":\"service_account\",\"private_key\":\"-----BEGIN PRIVATE KEY-----\\n"+F+"\\n-----END PRIVATE KEY-----\\n\"}").toString("base64");
  const CA=Buffer.from("-----BEGIN CERTIFICATE-----\nMIIFakeCertificateBody"+F+"\n-----END CERTIFICATE-----\n").toString("base64");
  const TOK="Xk9pQ2vL7mN4bR8tY1wZ6cF3hJ5sD0gA2eU7iO9kP4lM8nB1";
  const cases={
   "dokku config:show":"SENDGRID_KEY:   SG.abcdefghijklmnopqrstuv."+F+F,
   "dokku config:set echo":"-----> Setting config vars\n       SMS_KEY:  "+F,
   "env AUTH_KEYS":"AUTH_KEYS="+F+","+F, "env SMS_KEY":"SMS_KEY="+F,
   "env SIMPLE_ENCRYPTOR_KEY":"SIMPLE_ENCRYPTOR_KEY="+F, "env MAIL_KEY":"MAIL_KEY="+F,
   "export MAIL_KEY":"export MAIL_KEY=\""+F+"\"", "CRONOFYCLIENTSECRET":"CRONOFYCLIENTSECRET="+F,
   "stripe live":"sk_live_"+F, "stripe rk":"rk_live_"+F, "google api":"AIza"+F+"abcdefghijk", "google oauth":"ya29."+F+F,
   "sentry dsn":"SENTRY_DSN=https://"+F+"@o1.ingest.sentry.io/1", "bare sentry dsn":"https://"+F+"@o1.ingest.sentry.io/1",
   "x-auth header":"x-auth: "+F, "x-acme-proxy-auth":"x-acme-proxy-auth: "+F,
   "mongo uri":"VM_MONGO_CONNECT=mongodb+srv://user:"+F+"@c.x.net/db", "pg uri":"postgres://app:"+F+"@db:5432/x",
   "redis no user":"REDIS_URL=redis://:"+F+"@10.0.0.5:6379", "FIREBASE_CONFIG b64":"FIREBASE_CONFIG:  "+B64,
   "MONGO_CA_B64":"MONGO_CA_B64=   "+CA, "camelCase json":"{\"encryptionKey\": \""+F+"\"}", "json token":"{\"access_token\": \""+F+"\"}",
   "lowercase env":"sms_key="+F, "query auth=":"GET /x?auth="+F+"&y=1", "query secret=impersonating":"?secret=impersonating-"+F,
   "cli --password":"mongodump --password="+F, "curl -u":"curl -u admin:"+F+" https://x", "curl --user":"curl --user admin:"+F+" https://x",
   "bare token line":"\n"+F+F+"\n", "bare 48 token":TOK, "PEM":"-----BEGIN RSA PRIVATE KEY-----\n"+F+"\n-----END RSA PRIVATE KEY-----", "bearer":"Authorization: Bearer "+F,
  };
  for (const [k, v] of Object.entries(cases)) { const m = mask(v); assert.ok(![F, B64.slice(0, 40), CA.slice(0, 40), TOK].some((x) => m.includes(x)), `${k}: ${m}`); }
  for (const keep of ['commit 4b3d681a5779212b9e31e1492666ac73b4c1ad25', 'KEY_COUNT=3', 'NODE_ENV=production', 'PORT=5000', `sha256 ${'a'.repeat(64)}`, '550e8400-e29b-41d4-a716-446655440000', '/Users/someone/projects/app/docs/design.md', 'author: Someone', "Merge branch 'main' into t42"]) assert.equal(mask(keep), keep);
});
