// Emoji reactions on chat messages. A message is known by its chat and the ts emit stamped on it, so the
// transcripts stay untouched. Reacting twice with the same emoji takes it back; a reaction never wakes anyone.
import fs from 'node:fs';

const MAX_MESSAGES = 5000, MAX_PER_MESSAGE = 40;
const EMOJI = /^(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\p{EMod}|️⃣?)?(?:‍\p{Extended_Pictographic}(?:\p{EMod}|️)?)*)$/u;
export const isEmoji = (s) => typeof s === 'string' && s.length <= 32 && EMOJI.test(s);

// The newest message the owner or a squiggle wrote in this chat, or the newest holding `match`.
export function findMessage(events, match) {
  const q = String(match || '').toLowerCase();
  return [...events].reverse().find((e) => (e.k === 'say' || (e.k === 'user' && e.from === 'owner')) && String(e.text || '').trim() && String(e.text).toLowerCase().includes(q));
}

export function createReactions(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const write = (all) => { fs.writeFileSync(file + '.tmp', JSON.stringify(all)); fs.renameSync(file + '.tmp', file); };
  return {
    all: read,
    // Adds the reaction, or takes it back. Returns the message's reactions, or { error }.
    toggle({ chat, ts, emoji, by }) {
      if (!isEmoji(emoji)) return { error: 'one emoji, please' };
      if (!Number.isSafeInteger(ts) || ts <= 0) return { error: 'no such message' };
      const all = read(), key = `${chat}:${ts}`, list = all[key] || [];
      const i = list.findIndex((r) => r.emoji === emoji && r.by === by);
      if (i >= 0) list.splice(i, 1);
      else if (list.length >= MAX_PER_MESSAGE) return { error: 'that message is full' };
      else list.push({ emoji, by });
      if (list.length) all[key] = list; else delete all[key];
      const keys = Object.keys(all);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_MESSAGES))) delete all[k]; // oldest first: insertion order
      write(all);
      return { list };
    },
  };
}
