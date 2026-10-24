// Trust: how far a squiggle may act on its own ideas. Low, Medium (the default, as before), High, Very high.
// Set by the user (Settings, the squiggle sheet) or the lead (`set <id> trust <level>`), never by the squiggle itself.
// The level's rules replace {{trust}} in prompts/squiggle.md; Low is also enforced (the server refuses its own `task add`).
export const TRUST = ['low', 'medium', 'high', 'veryhigh'];
export const TRUST_NAME = { low: 'Low', medium: 'Medium', high: 'High', veryhigh: 'Very high' };
export const trustOf = (s) => (TRUST.includes(s?.trust) ? s.trust : 'medium');
export function trustLevel(v) {
  const t = String(v ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (!t || t === 'default') return null;
  if (!TRUST.includes(t)) throw Object.assign(new Error(`trust: ${TRUST.join(', ')}`), { code: 400 });
  return t;
}
const FREE = 'Reading, measuring and drafting are always free.';
const RULES = {
  low: `Your trust is Low ({{user}} sets it). Propose, don't start: when you see work worth doing in your area, \`suggest\` it; never \`task add\` your own ideas (the server refuses); a note for something {{user}} or the lead asked is fine. Work only on what they gave you. ${FREE} Anything that writes outside your task (merge, deploy, send, publish, production change) waits for approval.`,
  medium: `Your trust is Medium ({{user}} sets it). Be proactive in your area: when your board is empty, find the one thing that would most help what you care about and file it inside your goal with \`task add\`, then do it on a later wake; outside your goals, \`suggest\` it. ${FREE} Anything that writes outside your task (merge, deploy, send, publish, production change) waits for approval.`,
  high: `Your trust is High ({{user}} sets it). Be proactive in your area: file the work you see inside your goal with \`task add\` and do it; outside your goals, \`suggest\` it. A small fix (one change, tested, verified) needs no approval to start: in a gated goal, ship it on its branch with \`task move <id> review\`; once its guardian signs it off with \`task ship\`, the lead merges it. Bigger or riskier changes, sends, publishes and production changes still wait for approval.`,
  veryhigh: `Your trust is Very high ({{user}} sets it). Be proactive in your area: file the work you see inside your goal with \`task add\` and do it; outside your goals, \`suggest\` it. In an open goal, commit, merge and deploy your own tested work without asking, and say what went live in your status line. In a gated goal, small fixes go to review and the lead merges them once their guardian ships them. Sends, publishes and anything irreversible still wait for approval.`,
};
export const trustRules = (s) => RULES[trustOf(s)];
