#!/bin/sh
# Codex PreToolUse hook, set by codexServer with -c hooks.PreToolUse. A fixed path keeps the hook's hash, and so the
# trust given to it in ~/.codex/config.toml (bin/codex-trust-guard.mjs), across node upgrades.
exec "${AGENTS_NODE:-node}" "$(dirname "$0")/guard.mjs"
