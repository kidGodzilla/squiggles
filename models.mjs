// Model rules: Opus 5.5 by default, Sonnet 5.5 minimum, never Fable.
// modelFor maps whatever a squiggle asks for (else def, the room's config.model) onto an allowed model; DEFAULT_MODELS is what team defaults may be set to (t898).
export const modelFor = (s, def = '') => (/haiku|sonnet/i.test(s.model || def || '') ? 'claude-sonnet-5-5' : 'claude-opus-5-5');
export const DEFAULT_MODELS = ['', 'opus', 'sonnet', 'gpt-6.1-sol'];
// What a squiggle's own model and effort may be set to (t905): the defaults plus the full Claude ids; null or '' clears.
export const SQUIGGLE_MODELS = [...DEFAULT_MODELS, 'claude-opus-5-5', 'claude-sonnet-5-5'];
export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
// extra: models only a squiggle may use, never team defaults (config.pi).
export function checkModelEffort(b, extra = []) {
  const ok = [...SQUIGGLE_MODELS, ...extra];
  if (b.model != null && !ok.includes(b.model)) throw new Error(`model: one of ${ok.map((m) => m || 'default').join(', ')}`);
  if (b.effort != null && !EFFORTS.includes(b.effort)) throw new Error(`effort: one of ${EFFORTS.map((m) => m || 'default').join(', ')}`);
}
