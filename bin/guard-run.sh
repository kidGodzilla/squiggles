#!/bin/sh
# Runs a hook guard ($1, a guard.mjs) for claude, codex and cursor guard.sh. Exit 2 refuses; every other failure is
# turned into 2 by guard.sh: the fence fails closed, since some hosts run the tool on any exit but 2.
# A hook timeout kills this shell, not node. CPU time still stops a stuck guard, and a busy machine doesn't count (normal use 0.03 s).
# A guard blocked on I/O spends no CPU, and on a hook timeout the client runs the tool, so node also dies at 30 s wall:
# bin/guard-wall.pl kills node's whole process group then, so nothing it started is left. No perl: no wall limit.
# A guard that doesn't load (exit 1) or throws (the crash reason) is broken in the working tree: the committed one answers
# instead, so a bad edit to fence.mjs or a guard can't lock out every squiggle and the lead.
ulimit -t 10
n="${AGENTS_NODE:-node}" b="$(cd "$(dirname "$0")" && pwd)"
r="$(dirname "$b")"
# Read once, so the committed guard can get the same call. Hosts write it and close; one that holds stdin open gets 5 s.
if [ -x /usr/bin/perl ]; then in="$(/usr/bin/perl -e 'alarm 5; exec @ARGV' cat)"; else in="$(cat)"; fi
run() { if [ -x /usr/bin/perl ] && [ -f "$b/guard-wall.pl" ]; then printf '%s\n' "$in" | /usr/bin/perl "$b/guard-wall.pl" "$n" "$1"; else printf '%s\n' "$in" | "$n" "$1"; fi; }
{ e="$(run "$1" 2>&1 1>&3 3>&-)"; c=$?; } 3>&1
case "$c:$e" in
  1:*|2:*'guard could not read the tool call'*)
    h="$(git -C "$r" show HEAD:bin/guard-head.mjs 2>/dev/null | "$n" --input-type=module - "$r" "$1")" && [ -f "$h" ] && { run "$h"; exit $?; } ;;
esac
[ -n "$e" ] && printf '%s' "$e" >&2
exit "$c"
