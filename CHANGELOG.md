# Changelog

Each version lists Added, Changed and Fixed, plus Migrations and Breaking when present. Breaking entries say how to adapt local changes. Data schema is in `config.json`; see docs/upgrading.md.

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
