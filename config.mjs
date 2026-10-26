// Settings in <data dir>/config.json, shared by the server and the CLI. Written with defaults on first run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeSchema } from './migrate.mjs';

export const DEFAULTS = {
  schema: 1,        // data schema; a fresh room starts at the latest
  port: 4327,
  userName: '',     // what squiggles call you; empty: "the user"
  tailnet: false,   // offer "Share on tailnet" (needs Tailscale)
  cloudflare: false, // offer sharing over a Cloudflare quick tunnel (needs cloudflared; public link, 8+ character passcode)
  model: 'opus',    // default for new squiggles: opus or sonnet. Anything else runs on Opus.
  codex: false,     // allow squiggles on Codex models (needs the Codex CLI)
  fileSources: {},  // extra read-only folders listed by `files`: { "name": "/path" }
};

export const dataDir = () => path.resolve(String(process.env.SQUIGGLES_HOME || '~/.squiggles').replace(/^~(?=\/|$)/, os.homedir()));

export function loadConfig(dir = dataDir()) {
  const file = path.join(dir, 'config.json');
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`${file}: ${e.message}`);
  }
  const cfg = { ...DEFAULTS, schema: codeSchema(), ...saved };
  if (!saved) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n'); }
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  return cfg;
}
