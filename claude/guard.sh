#!/bin/sh
# Claude PreToolUse hook, set per run by server.mjs launch via --settings.
exec "${AGENTS_NODE:-node}" "$(dirname "$0")/guard.mjs"
