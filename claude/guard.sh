#!/bin/sh
# Claude PreToolUse hook, set per run by server.mjs launch via --settings. Claude blocks only on exit 2, so any other
# failure (node missing, a bad import) is turned into 2: the fence fails closed.
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
