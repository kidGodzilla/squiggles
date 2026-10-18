# Changelog

Each version lists Added, Changed and Fixed, plus Migrations and Breaking when present. Breaking entries say how to adapt local changes. Data schema is in `config.json`; see docs/upgrading.md.

## 0.1.2 (unreleased)

### Security
- `calendar` leaves out invite locations and notes unless `--notes`, then marks them untrusted; control characters in titles, calendars and attendees become spaces. Attendees are listed.
- Request bodies are capped at 200 MB (413), read as bytes so split UTF-8 survives; the composer escapes attached image URLs.
- Optional room passcode (Settings > Security or `room passcode set <code>|clear|status|local on|off`): browsers unlock with it; HttpOnly session cookie, scrypt hash, rate-limited. GET /api/room no longer returns it.
- Content-Security-Policy: the UI runs only its own scripts and can't be framed; chat files, media and speech are sandboxed; nosniff on all of them.
- Settings escapes option values, and squiggle model and effort accept only allowed values.
- Shared screen reads regular files only, capped in size, and its content isn't saved to the transcript.

### Added
- `calendar [from] [to] [calendar]` reads this Mac's calendars (iCloud, Google, Exchange) through EventKit, read-only; `calendar allow` asks macOS once. Needs Xcode command line tools.
- Settings tabs: Room, Characters, Squiggles, People, Sharing, Defaults, Security; `?tab=` and `room view settings <tab>` open one.
- Team defaults: model, effort and wake cadence new squiggles start with, set in Settings or `defaults [model|effort|every <value>]`. Fable and models below Sonnet 5.5 are refused.
- Settings (Menu > Settings, `?view=settings`, `room view settings`): Room sound, Sharing (only when tailnet is on), People, a Squiggles table (model, effort, wakes, pack, paused) and a character pack tester.
- Avataaars characters: `look <id> avataaars` (or `room characters avataaars`) draws a seeded Avataaars person that talks and blinks. Credits in THIRD-PARTY-NOTICES.md.
- Images in chat: paste, drop or pick them in a 1:1 or meeting thread; squiggles see them. `tell <id> <text> --image <path>` sends one from the CLI. Saved in the data dir under files/.
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
- `look <id> <character|auto|shuffle>` sets a squiggle's character; looks take a generator (`cast:Puff`), and `room characters <generator>` sets the room default, saved in room.json.

### Changed
- A Codex usage limit no longer pauses wakes: the turn ends and the next wake tries again. `limit` shows the day as well as the time.
- The bottom speaker caption shows only replies to you, blockers and presentations, not idle chatter.
- The speaker caption has × to dismiss it, and moves to the top when it would cover the field you're typing in.
- A goal owner's face opens a chat asking about that goal.
- Owner faces sit at the right of task piles and notes.
- The speaker caption lingers 4 to 12 seconds after the words end, and stays while hovered or touched.
- Sound controls (radio, volume, voices, chatter) are back in the Menu, kept in sync with Settings.
- The header More is now a Menu icon (Lock, Settings, Inbox, New squiggle). Tablet 1:1 docks the chat instead of floating it; phone has Back in the chat header.
- Codex squiggles run on a persistent `codex app-server`: MCP servers survive between turns, and messages sent mid-turn steer the running turn instead of waiting.
- New installs default to port 4327 (was 4317). Existing rooms keep the port in their config.json.
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
- Installed on iPhone, the header is no longer blurred under the status bar.
- Settings at 390: passcode buttons stay on one line, selects are 44px on touch, and a refused default puts the select back.
- After an upgrade the browser no longer runs stale UI files: they are served with no-cache and an ETag.
- `look <id> constructor` (or `__proto__`) no longer breaks the room; unknown looks fall back to the default.
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
