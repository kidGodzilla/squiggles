#!/usr/bin/env node
// Trusts the Codex squiggle guard in the user's ~/.codex/config.toml, so codex app-server runs it.
// Codex hashes the hook; this asks an app-server started with exactly the harness's hook for that hash, checks
// the command is ours, and writes hooks.state.<key>.trusted_hash through codex itself. Run once (you).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { HOOK_CMD, HOOK_KEY, hookConfig, hookTrusted } from '../codex/guard.mjs';

const APP = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const bin = process.env.CODEX_BIN || (fs.existsSync(APP) ? APP : 'codex');
const p = spawn(bin, ['app-server', '-c', hookConfig()], { stdio: ['pipe', 'pipe', 'inherit'] });
let n = 0, buf = ''; const wait = new Map();
const req = (method, params) => new Promise((res, rej) => { const id = ++n; wait.set(id, { res, rej }); p.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { let m; try { m = JSON.parse(buf.slice(0, i)); } catch {} buf = buf.slice(i + 1); const w = m?.id && wait.get(m.id); if (w) { wait.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); } } });
const done = (msg, code) => { console.log(msg); p.kill(); process.exit(code); };
setTimeout(() => done('codex app-server did not answer', 1), 60000).unref();
await req('initialize', { clientInfo: { name: 'squiggles', version: '1' } }); p.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
const list = async () => req('hooks/list', { cwds: [process.cwd()] });
let l = await list();
if (hookTrusted(l)) done('Codex guard already trusted', 0);
const h = (l.data || []).flatMap((e) => e.hooks || []).find((x) => x.key === HOOK_KEY);
if (!h || h.command !== HOOK_CMD) done(`Codex guard not found as ${HOOK_KEY} with command ${HOOK_CMD}`, 1);
await req('config/value/write', { keyPath: 'hooks.state', value: { [HOOK_KEY]: { trusted_hash: h.currentHash } }, mergeStrategy: 'upsert' });
l = await list();
done(hookTrusted(l) ? `Codex guard trusted (${h.currentHash})` : 'Wrote trust, but codex still reports the guard untrusted', hookTrusted(l) ? 0 : 1);
