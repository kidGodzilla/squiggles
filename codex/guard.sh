#!/bin/sh
# Codex PreToolUse hook, set by codexServer with -c hooks.PreToolUse. A fixed path keeps the hook's hash, and so the
# trust given to it in ~/.codex/config.toml (bin/codex-trust-guard.mjs), across node upgrades.
# Any failure refuses: Codex runs the tool on every exit but 2.
# A hook timeout kills this shell, not node. CPU time still stops a stuck guard, and a busy machine doesn't count (normal use 0.03 s).
ulimit -t 10
# A guard blocked on I/O spends no CPU, and on a hook timeout the client runs the tool, so node also dies at 30 s wall:
# perl's alarm survives its exec, so node keeps this stdin and pid and nothing is left to clean up. No perl: no wall limit.
n="${AGENTS_NODE:-node}" g="$(dirname "$0")/guard.mjs"
if [ -x /usr/bin/perl ]; then /usr/bin/perl -e 'alarm 30; exec { $ARGV[0] } @ARGV; exit 127' "$n" "$g"; else "$n" "$g"; fi; c=$?
[ "$c" -eq 0 ] && exit 0
[ "$c" -eq 2 ] || echo "fence guard failed (exit $c): refused" >&2
exit 2
