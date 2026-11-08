// Compact at wake end. A Claude squiggle's next wake usually comes after its 1h prompt cache has expired, so it
// re-writes its whole conversation. Compacting right after the turn ends reads
// that conversation while it is still cached (cheap) and leaves a short summary for the next wake to write instead.
// Skipped when the next wake comes before the cache expires: then the cache is still warm and compacting only loses context.
export const COMPACT_MIN_CTX = 40000; // smaller contexts cost less to re-write than the compaction itself
export const COMPACT_GAP_MS = 55 * 60000; // the 1h cache, less a margin
export const COMPACT_PROMPT = '/compact Keep open task ids, the last status line, and anything the user asked that is still open.';
// claude: a Claude squiggle (other providers have their own caches); lead: the lead talks all day, its cache stays warm;
// alive: its process is still running; own: the turn ended on its own status line (quiet.mjs ownEnd);
// ctx: tokens in the conversation at its last call; nextDue: ms of its next scheduled wake (null when none).
export function compactAtEnd({ claude, lead, alive, own, endStatus, ctx, nextDue, now = Date.now() }) {
  if (!claude || lead || !alive || !own || !(ctx > COMPACT_MIN_CTX)) return false;
  // IDLE, WAITING and BLOCKED wake next on a message, a wait or a skipped schedule: hours, not minutes.
  if (['idle', 'waiting', 'blocked'].includes(endStatus)) return true;
  return nextDue == null || !Number.isFinite(nextDue) || nextDue - now >= COMPACT_GAP_MS;
}
// The context size an assistant event reports: everything sent on that call.
export const ctxOf = (u) => (u ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : 0);
