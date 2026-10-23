// Stale-ask guard: a lead line that sends the user to an ask that already ran, or to Merge on a task no longer
// in review, is dropped before they see it. A line still naming something actionable stays.
const ACT = /\b(press|click|hit|tap|approve)\b|\b(run|merge)\s+(on\s+|for\s+)?[at]\d+\b/i;
const ids = (l, re) => [...l.matchAll(re)].map((m) => m[1]);
export function dropStale(text, { ask, task }) {
  const dropped = [];
  const kept = String(text).split('\n').filter((l) => {
    if (!ACT.test(l)) return true;
    const st = [
      ...ids(l, /\b(a\d+)\b/g).map((id) => ask(id)).filter(Boolean).map((s) => s === 'pending'),
      ...(/\bmerge\b/i.test(l) ? ids(l, /\b(t\d+)\b/g).map((id) => task(id)).filter(Boolean).map((s) => s === 'review') : []),
    ];
    if (!st.length || st.some(Boolean)) return true;
    dropped.push(l); return false;
  });
  return { text: kept.join('\n'), dropped };
}
