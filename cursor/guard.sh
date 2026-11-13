#!/bin/sh
# Cursor preToolUse hook, installed in ~/.cursor/hooks.json by install.mjs. Fail-closed, so it must always answer.
# Outside a squiggle (your own Cursor) it answers {}: no decision, so Cursor's own approvals stand.
# Inside, guard.mjs fences Downloads, Desktop and Documents.
[ -n "$AGENTS_ID" ] || { echo '{}'; exit 0; }
# Any failure refuses: exit 2 is the only code Cursor reads as a refusal.
# The CPU and wall limits, and the committed guard when the working one is broken, are bin/guard-run.sh's.
sh "$(dirname "$0")/../bin/guard-run.sh" "$(dirname "$0")/guard.mjs"; c=$?
[ "$c" -eq 0 ] && exit 0
[ "$c" -eq 2 ] || echo "fence guard failed (exit $c): refused" >&2
exit 2
