// Pre-check: a scheduled wake that quiet.mjs can't skip, after a turn that ended IDLE or WAITING, first runs a fresh, small
// Sonnet session with the squiggle's charter, journal tail and notes. It answers WAKE or DEFER. DEFER skips the full wake;
// WAKE runs it with the finding attached. Anything unclear wakes. A real wake still runs every PRECHECK_MAX_MS.
import { spawn } from 'node:child_process';

export const PRECHECK_MODEL = 'claude-sonnet-5-5';
export const PRECHECK_MAX_MS = 12 * 3600e3;
export const PRECHECK_TURNS = 12;
export const PRECHECK_BUDGET = 0.4; // dollars; a check that costs more than a wake would defeats itself

// Run it? Same turns quiet.mjs looks at: the last turn ended on its own IDLE or WAITING line, and a real wake ran recently.
export function wantsPrecheck(r, now = Date.now()) {
  if (r.endStatus !== 'idle' && r.endStatus !== 'waiting') return false;
  return now - (Date.parse(r.lastWake || 0) || 0) < PRECHECK_MAX_MS;
}

const tail = (t, n) => (t.length > n ? `…${t.slice(-n)}` : t);
export function precheckPrompt({ s, charter, journal, notes, lastEnd, sinceWake, user = 'the user' }) {
  return `You are the pre-check for ${s.name} (id: ${s.id}), a standing agent on ${user}'s team. Its scheduled wake is due. A full wake costs an expensive model a large context read, so first decide whether it has anything to do.

Its last wake ended ${lastEnd}. That was ${sinceWake} ago.

Do only quick, read-only checks its charter's wake routine names (read files, list things, run read-only status commands). Change nothing: no edits, commits, moves, messages, deploys. Use a handful of tool calls at most.

WAKE when something needs doing: a note it can work, a check that found something new, a wait or a deadline that is due, a message to answer. DEFER when it would only find what it found last time. When unsure, or when a check the charter needs isn't possible from here (no MCP tools, no browser), WAKE.

End with exactly one line:
WAKE: <what needs doing, one sentence, with the facts you found>
DEFER: <why there is nothing new, one sentence>

## Charter
${charter.trim()}

## Open notes
${notes.trim() || '(none)'}

## End of journal
${tail(journal.trim(), 4000)}`;
}

// The verdict is the last WAKE:/DEFER: line. No line, or anything else, wakes.
export function parseVerdict(text) {
  const m = [...String(text || '').matchAll(/^\s*\**(WAKE|DEFER)\**:\s*(.+)$/gm)].pop();
  return m ? { wake: m[1] === 'WAKE', why: m[2].trim().slice(0, 300) } : { wake: true, why: 'pre-check gave no verdict' };
}

export const precheckArgs = (prompt, settings) => ['-p', prompt, '--model', PRECHECK_MODEL, '--output-format', 'json', '--max-turns', String(PRECHECK_TURNS),
  '--max-budget-usd', String(PRECHECK_BUDGET), '--effort', 'low', '--no-session-persistence', '--strict-mcp-config',
  '--tools', 'Bash,Read,Grep,Glob', '--permission-mode', 'auto', '--permission-prompts', 'none',
  '--system-prompt', 'You check whether an agent has work. Read-only. Be brief.', '--settings', settings];

// Runs the check; resolves { wake, why, cost, in } and never rejects (a failure wakes).
export function runPrecheck({ prompt, settings, cwd, env, timeoutMs = 5 * 60e3, bin = 'claude' }) {
  return new Promise((done) => {
    let out = '', fin = false;
    const end = (v) => { if (!fin) { fin = true; clearTimeout(t); done(v); } };
    const p = spawn(bin, precheckArgs(prompt, settings), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { p.kill('SIGTERM'); end({ wake: true, why: 'pre-check timed out', cost: 0, in: 0 }); }, timeoutMs);
    p.stdout.on('data', (c) => { out += c; });
    p.on('error', () => end({ wake: true, why: 'pre-check failed to start', cost: 0, in: 0 }));
    p.on('close', () => {
      let r = {}; try { r = JSON.parse(out); } catch {}
      const u = r.usage || {};
      end({ ...(r.is_error && !r.result ? { wake: true, why: `pre-check failed: ${r.subtype || 'error'}` } : parseVerdict(r.result)),
        cost: r.total_cost_usd || 0, in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), out: u.output_tokens || 0 });
    });
  });
}
