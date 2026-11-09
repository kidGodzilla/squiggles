// Built-in tools a squiggle launches with. The default set carries ~25 tools (cron, worktrees,
// notifications, workflows...) squiggles don't use: about 11k input tokens on every cold wake.
// Skill alone is ~7k (its skill listing), so it's opt-in: set <id> skills true.
// ToolSearch stays: Claude in Chrome's tools are deferred behind it.
export const BASE_TOOLS = ['Task', 'Bash', 'Edit', 'Read', 'Write', 'WebFetch', 'WebSearch', 'ToolSearch', 'TaskStop'];
export const toolsFor = (s) => [...BASE_TOOLS, ...(s.skills ? ['Skill'] : [])].join(',');
