# Changelog

Each version lists Added, Changed and Fixed, plus Migrations and Breaking when present. Breaking entries say how to adapt local changes. Data schema is in `config.json`; see docs/upgrading.md.

## 0.1.2 (unreleased)

### Security
- Shared screen reads regular files only, capped in size, and its content isn't saved to the transcript.

### Added
- @mentions: type @ in a chat to pick a squiggle or person; the mentioned squiggle gets the message and its reply posts back in that chat.
- The speaker stays visible: their tile scrolls into view, or a caption shows their face and words.
- Owner faces on Merge and Tasks open a 1:1 with the item drafted.
- Phone: the lead's unread count shows on the Lead tab.
- Meetings are one shared thread with one presenter at a time; `meet now` takes `--presenters`.
- Show and tell meetings (`meeting edit <id> showtell on`) build each presenter's agenda from their work since the last one.
- Shared screen beside a 1:1: `screen diff <task>|url <url>|file <path>|off` pins a diff, page or file next to the chat; diffs show a file list, line numbers and coloured hunks.
- The sharer's camera opens their 1:1.
- More > Inbox lists notes waiting for the lead and ones it has read.
- Browser setting (Off or Claude in Chrome) in the squiggle sheet.
- Subagents show as temporary helper tiles on their squiggle's tile; `list` names them.
- Merge review: `meet merges` has squiggles with branches in review present them, most urgent first.
- Merge needs: `task needs <id> add "<what>"` lists steps beyond the merge button; the Merge tab flags them and ticks them off.
- Worktrees belong to tasks: `task worktree <id> [repo]` makes `~/wt/<repo>-<id>` (`AGENTS_WT` overrides); merge, done and drop remove clean ones; `worktrees [check]` lists them and notes orphans for the lead.
- Task ids in chats, journals and notes are links; hovering or tapping shows the task, clicking opens it on the board.
- A chat's header face and name open that squiggle's 1:1.
- Suggestions: squiggles file things outside their tasks with `suggest "<one line>"`; the lead accepts one as a task or declines it with a reason (`suggestions`, `suggestion accept|decline`), on the board too, and the author hears back at its next wake.

### Changed
- Merge leaves your checkout alone: it merges where the base branch is checked out only after a conflict check, otherwise in a temp worktree.
- Merges, send-backs, task adds and meeting adds record who did them.
- Banners under the header push chats and meeting bars down instead of covering them.
- Squiggles prove a branch is merged before deleting it, and end review talk with `merge <id>`.
- Screenshots and shared pages stay on screen 90 seconds over terminal output.
- More > Share shows Copy link only, not the URL text.
- The lead's "Handled." replies fold with the reports they answer into one line that opens to list them.

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
