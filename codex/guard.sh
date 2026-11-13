#!/bin/sh
# Codex PreToolUse hook, set by codexServer with -c hooks.PreToolUse. A fixed path keeps the hook's hash, and so the
# trust given to it in ~/.codex/config.toml (bin/codex-trust-guard.mjs), across node upgrades.
# Any failure refuses: Codex runs the tool on every exit but 2.
# The CPU and wall limits, and the committed guard when the working one is broken, are bin/guard-run.sh's.
sh "$(dirname "$0")/../bin/guard-run.sh" "$(dirname "$0")/guard.mjs"; c=$?
[ "$c" -eq 0 ] && exit 0
[ "$c" -eq 2 ] || echo "fence guard failed (exit $c): refused" >&2
exit 2
