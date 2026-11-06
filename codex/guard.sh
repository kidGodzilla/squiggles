#!/bin/sh
# Codex PreToolUse hook, set by codexServer with -c hooks.PreToolUse. A fixed path keeps the hook's hash, and so the
# trust given to it in ~/.codex/config.toml (bin/codex-trust-guard.mjs), across node upgrades.
# Any failure refuses: Codex runs the tool on every exit but 2.
# A hook timeout kills this shell, not node. CPU time still stops a stuck guard, and a busy machine doesn't count (normal use 0.03 s).
ulimit -t 10
"${AGENTS_NODE:-node}" "$(dirname "$0")/guard.mjs"; c=$?
[ "$c" -eq 0 ] && exit 0
[ "$c" -eq 2 ] || echo "fence guard failed (exit $c): refused" >&2
exit 2
