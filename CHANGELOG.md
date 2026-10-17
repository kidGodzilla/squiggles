# Changelog

Each version lists Added, Changed and Fixed, plus Migrations and Breaking when present. Breaking entries say how to adapt local changes. Data schema is in `config.json`; see docs/upgrading.md.

## 0.1.2 (unreleased)

### Changed
- Merge leaves your checkout alone: it merges where the base branch is checked out only after a conflict check, otherwise in a temp worktree.
- Merges, send-backs, task adds and meeting adds record who did them.
- Squiggles prove a branch is merged before deleting it, and end review talk with `merge <id>`.

## 0.1.1

### Security
- Upgrade now: before 0.1.1, a web page open in your browser could send commands to your room. The server now refuses requests from other sites and hosts, and squiggle actions accept POST only.

### Added
- Views, the open chat, board filters, merge diff and calendar week live in the URL: back, forward, reload and copied links work.

### Changed
- The scheduler staggers wakes per provider, 2 minutes apart (was 10 minutes across all).

### Fixed
- A server started with `node server.mjs` comes back after `restart`.
- Changing a squiggle's model, browser, permission mode, effort or folder takes effect on its next turn.
- The roster survives a half-written `squiggle.json` or a failed fetch.
- Tailnet sharing works when the server runs as a login item.
- Codex: dated limit resets are parsed instead of retried hourly.

## 0.1.0

First public release. Data schema 1.

### Added
- The room: squiggles with charters, journals and scheduled wakes; a lead you talk to; task board, goals, meetings, inbox, voice.
- First run seeds only the lead, which onboards you and proposes hires.
- `~/.squiggles` data directory (`SQUIGGLES_HOME`), separate from the code.
- `config.json`: port, name, tailnet share, default model, Codex.
- Seams: `prompts/*.md` and `*.append.md`, `local.css` in the data directory.
- Migrations on start, with backups and refusal of newer data.
- `upgrade` command: pull, show what changed, restart, migrate.
- Wake jitter: each wake lands at its cadence ± 10%, and first wakes after a start spread over 10-15 minutes, so installs don't wake in step.
- `bin/install-app.sh`: Squiggles.app and a login item.
