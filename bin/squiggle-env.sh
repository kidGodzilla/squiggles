# Sourced before every squiggle Bash command (CLAUDE_ENV_FILE). A login shell runs `brew shellenv`, which puts
# Homebrew's Node first; squiggles use nvm's Node instead: the repo's .nvmrc if installed, else nvm's default.
# Braces also silence zsh's "no matches found".
__sq_pick() { { ls -d "$HOME/.nvm/versions/node/v${1#v}"*; } 2>/dev/null | sort -V | tail -1; }
__sq_node=$( { [ -f .nvmrc ] && __sq_pick "$(tr -d '[:space:]' < .nvmrc)"; } || true)
[ -n "$__sq_node" ] || __sq_node=$(__sq_pick "$(cat "$HOME/.nvm/alias/default" 2>/dev/null)")
[ -x "$__sq_node/bin/node" ] && export PATH="$__sq_node/bin:$PATH"
unset __sq_node; unset -f __sq_pick
