#!/bin/sh
# Build cap: several builds at once can drive load far past the core count. Squiggle shells find this first as xcodebuild and
# gradle (bin/builds). It takes one of AGENTS_BUILD_SLOTS slots, then execs the real tool, so the slot's pid is the build's:
# when the build dies the slot is free, with nothing to release. Past AGENTS_BUILD_WAIT seconds it runs anyway; a cap must
# not turn into a hang. A race can let a third build in; that costs load, not correctness.
name=${0##*/}; here=$(cd "${0%/*}" && pwd)
rest=; old=$IFS; IFS=:; for p in $PATH; do [ "$p" = "$here" ] || rest=${rest:+$rest:}$p; done; IFS=$old
PATH=$rest; export PATH
real=$(command -v "$name") || { echo "$name: not found" >&2; exit 127; }
for a in "$@"; do case "$a" in -version|--version|-v|-help|--help|-usage|-list|-show*|-find*|-license|--status|--stop) exec "$real" "$@";; esac; done

slots=${AGENTS_BUILD_SLOTS:-2}; wait=${AGENTS_BUILD_WAIT:-900}; poll=${AGENTS_BUILD_POLL:-5}; dir=${AGENTS_BUILD_DIR:-/tmp/agents-build-slots}
mkdir -p "$dir"
take() {
  i=1
  while [ "$i" -le "$slots" ]; do
    ln -s "$$" "$dir/$i" 2>/dev/null && return 0 # one atomic step: the slot and its pid
    p=$(readlink "$dir/$i" 2>/dev/null)
    if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -f "$dir/$i"; ln -s "$$" "$dir/$i" 2>/dev/null && return 0; fi
    i=$((i + 1))
  done
  return 1
}
start=$(date +%s); said=
until take; do
  [ -n "$said" ] || { echo "$name: waiting for a build slot ($slots builds already running on this machine)" >&2; said=1; }
  if [ $(($(date +%s) - start)) -ge "$wait" ]; then echo "$name: waited ${wait}s, running without a slot" >&2; break; fi
  sleep "$poll"
done
exec "$real" "$@"
