// Model rules: Opus 5.5 by default, Sonnet 5.5 minimum, never Fable.
// modelFor maps whatever a squiggle asks for (else def, the room's config.model) onto an allowed model; DEFAULT_MODELS is what team defaults may be set to (t898).
export const modelFor = (s, def = '') => (/haiku|sonnet/i.test(s.model || def || '') ? 'claude-sonnet-5-5' : 'claude-opus-5-5');
export const DEFAULT_MODELS = ['', 'opus', 'sonnet', 'gpt-6.1-sol'];
