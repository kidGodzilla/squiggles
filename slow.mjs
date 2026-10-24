// Sync work over 200ms, drained by the stall logger in server.mjs: a stall with no request in flight names what blocked.
export const slowSync = [];
export const timed = (what, fn) => { const t = Date.now(); try { return fn(); } finally { const ms = Date.now() - t; if (ms > 200) slowSync.push(`${typeof what === 'function' ? what() : what} ${ms}ms`); } };
// execFileSync, timed and labelled `git <repo> <subcommand>`.
export const timedSync = (sync) => (cmd, args = [], o) => timed(() => { const i = args.indexOf('-C'); return [cmd, i >= 0 ? args[i + 1].split('/').pop() : '', args.find((a, j) => (i < 0 || j !== i + 1) && a !== '-C' && !a.startsWith('-'))].filter(Boolean).join(' '); }, () => sync(cmd, args, o));
