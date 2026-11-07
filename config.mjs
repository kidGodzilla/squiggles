// Settings in <data dir>/config.json, shared by the server and the CLI. Written with defaults on first run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOM_PORT } from './fence.mjs';
import { codeSchema } from './migrate.mjs';

export const DEFAULTS = {
  schema: 1,        // data schema; a fresh room starts at the latest
  port: ROOM_PORT,
  userName: '',     // what squiggles call you; empty: "the user"
  tailnet: false,   // offer "Share on tailnet" (needs Tailscale)
  cloudflare: false, // offer sharing over a Cloudflare quick tunnel (needs cloudflared; public link, 8+ character passcode)
  model: 'opus',    // default for new squiggles: opus or sonnet. Anything else runs on Opus.
  codex: false,     // allow squiggles on Codex models (needs the Codex CLI)
  pi: [],           // Pi models squiggles may run on, as pi names them ("provider/model"; needs the pi CLI and its own keys)
  piExtensions: [], // pi extensions to load (-e), e.g. one that adds a provider
  cursor: [],       // Cursor models squiggles may run on, as cursor-agent names them (needs the Cursor CLI, signed in, and node cursor/install.mjs)
  fileSources: {},  // extra read-only folders listed by `files`: { "name": "/path" }
  privateDirs: [],  // folders only Claude squiggles may reach (relative to home, ~/x or absolute); Codex, Cursor and Pi are fenced off
  privateTools: [], // tool-name words only Claude squiggles may use, e.g. "helpdesk" for an MCP server holding customer data
  privateRemote: false, // true: non-Claude squiggles may not ssh out or reach a remote database
};

// The model picks the provider: Codex models (when config.codex), config.pi and config.cursor lists; '' is Claude.
export const CODEX_MODELS = ['gpt-6.1-sol'];
const strs = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
export const providerFor = (s, cfg) => (cfg.codex && CODEX_MODELS.includes(s.model) ? 'codex' : strs(cfg.pi).includes(s.model) ? 'pi' : strs(cfg.cursor).includes(s.model) ? 'cursor' : '');

export const dataDir = () => path.resolve(String(process.env.SQUIGGLES_HOME || '~/.squiggles').replace(/^~(?=\/|$)/, os.homedir()));

// A workspace under the OS temp folder is a test one. Paths compare as given and resolved: macOS links /tmp and /var into /private.
export const tempWorkspace = (dir = dataDir()) => {
  const both = (p) => { try { return [p, fs.realpathSync(p)]; } catch { return [p]; } };
  return both(path.resolve(dir)).some((d) => ['/tmp', os.tmpdir()].flatMap(both).some((t) => (d + path.sep).startsWith(t + path.sep)));
};

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
