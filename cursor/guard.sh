#!/bin/sh
# Cursor preToolUse hook, installed in ~/.cursor/hooks.json by install.mjs. Fail-closed, so it must always answer.
# Outside a squiggle (your own Cursor) it answers {}: no decision, so Cursor's own approvals stand.
# Inside, guard.mjs fences Downloads, Desktop and Documents.
[ -n "$AGENTS_ID" ] || { echo '{}'; exit 0; }
# Any failure refuses: exit 2 is the only code Cursor reads as a refusal.
# A hook timeout kills this shell, not node. CPU time still stops a stuck guard, and a busy machine doesn't count (normal use 0.03 s).
ulimit -t 10
# A guard blocked on I/O spends no CPU, and on a hook timeout the client runs the tool, so node also dies at 30 s wall:
# bin/guard-wall.pl kills node's whole process group then, so nothing it started is left. No perl: no wall limit.
n="${AGENTS_NODE:-node}" g="$(dirname "$0")/guard.mjs"
w="$(dirname "$0")/../bin/guard-wall.pl"
if [ -x /usr/bin/perl ] && [ -f "$w" ]; then /usr/bin/perl "$w" "$n" "$g"; else "$n" "$g"; fi; c=$?
[ "$c" -eq 0 ] && exit 0
[ "$c" -eq 2 ] || echo "fence guard failed (exit $c): refused" >&2
exit 2
