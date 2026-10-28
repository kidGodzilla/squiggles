#!/bin/sh
# Claude PreToolUse hook, set per run by server.mjs launch via --settings. Claude blocks only on exit 2, so any other
# failure (node missing, a bad import) is turned into 2: the fence fails closed.
"${AGENTS_NODE:-node}" "$(dirname "$0")/guard.mjs"; c=$?
[ "$c" -eq 0 ] && exit 0
[ "$c" -eq 2 ] || echo "fence guard failed (exit $c): refused" >&2
exit 2
