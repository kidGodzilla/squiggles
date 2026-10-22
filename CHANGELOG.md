# Changelog

Each version lists Added, Changed and Fixed, plus Migrations and Breaking when present. Breaking entries say how to adapt local changes. Data schema is in `config.json`; see docs/upgrading.md.

## 0.1.2 (unreleased)

### Security
- Restart and quit requests log who asked as one line of at most 40 characters, so a caller can't forge shutdown log lines.
- `calendar` leaves out invite locations and notes unless `--notes`, then marks them untrusted; control characters in titles, calendars and attendees become spaces. Attendees are listed.
- Request bodies are capped at 200 MB (413), read as bytes so split UTF-8 survives; the composer escapes attached image URLs.
- Optional room passcode (Settings > Security or `room passcode set <code>|clear|status|local on|off`): browsers unlock with it; HttpOnly session cookie, scrypt hash, rate-limited. GET /api/room no longer returns it.
- Content-Security-Policy: the UI runs only its own scripts and can't be framed; chat files, media and speech are sandboxed; nosniff on all of them.
- Settings escapes option values, and squiggle model and effort accept only allowed values.
- Shared screen reads regular files only, capped in size, and its content isn't saved to the transcript.
- Passcode limiter: empty codes don't count, and local scripts have their own bucket, so they can't lock out the browser.
- Gated merges: only the lead, or a browser unlocked with the room passcode, merges; the Merge button asks for it once per device. Without a passcode, set one first.
- Gated merges check the caller's process first: a squiggle holding an unlocked session cookie is still refused.
- Passcode hash loads at boot and sessions stay in memory, so editing room.json can't forge an unlock. Unlocks end on restart.
- Changing, clearing or loosening a set passcode needs the current one, in Settings and the CLI.
- Ask output masking also catches secrets split by colour codes or a tab, `mysql -pPASS`, and URL-encoded `token%3D` values.
- An ask cut off by a server restart is marked interrupted at boot and its filer is told; its output is lost.

### Added
- Ask cards: pending asks show in the lead's chat and the filer's 1:1 with Copy, Run and Deny, plus an asks count in the header. Hidden characters, padding and risky shapes are spelled out; Run confirms with the exact command and shows only on the room's own computer. Squiggles are told to file an ask when auto mode blocks a write.
- Command approvals (groundwork): a squiggle files a command auto mode blocked with `ask run "<cmd>" "<why>"`; `asks` lists them, `ask show`/`ask deny` inspect or refuse. Only an unlocked browser on the room's own computer can run one, once, for the exact command shown; secrets are masked in the output sent back. Page buttons come later.
- Files preview: click a file to see images, PDFs, markdown and text inline (first 512 KB), with Open and Download; anything else offers Download. `room view files <name>` opens one.
- Files tab (More > Files, `room view files`): list and search shared files and research, add by picking or dropping (optionally for a squiggle), delete your drops.
- A review branch cut from another branch merges into that branch, not main: detected on `task move <id> review`, shown on the Merge tab (Base, with Change) and in `tasks`; set it with `task base <id> <branch>|auto`. Merge no longer needs the base checked out, only the review branch not checked out.
- Files: `files [query]` lists the shared drop folder plus `research/` and any `fileSources` folders, newest first, searching names and text; `file add <path> [for <id>]` (never overwrites; `for` puts a note on that squiggle's pile) and `file rm <name>` (drop folder only). Squiggles are told where shared files live.
- A blocked note saying "for review <meeting id or title>" joins that meeting's agenda under "Deferred here" (listing, calendar, wake message, meeting view).
- Shared screen plays videos (`screen file` with .mp4, .m4v, .mov or .webm): it fills the share area, the server streams the file and seeking works.
- Goal due dates: set in the goal editor or `goal due <id> <YYYY-MM-DD>|clear`; cards say days left, or overdue in red.
- Goals: click a column heading or Areas to fold it to its heading and count; each browser remembers. CLI: `room fold|unfold active|hold|next|done|areas`.
- Every server exit writes its cause to `runs/shutdowns.log`: restart or quit and who asked, the signal and parent, or the crash.
- Peer rooms (off by default; needs Share the room): leads of two Squiggles rooms can message each other. `peer on`, `peer invite [name]` gives a one-time code for the other room's `peer join '<code>'`, then `peer send <name> "<text>"`. Incoming messages need the pair's key and reach the lead fenced as untrusted.
- Settings > Sharing > Peers: turn linking on, invite, paste a code, see and remove peers.
- Merge tab flags branches that conflict with the base: lists the files, disables Merge, and pre-fills Send back.
- Areas: a goal can be an ongoing area (`goal kind <id> area`), shown in a strip above the Goals columns; areas never go to Done or get a "still on?". The strip shows short names (full title on hover).
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

- Quit in the menu (and `quit [now]` in the CLI). Quit waits for working turns or stops them now; the login item stays off until Squiggles.app is opened.
- After-merge list beside needs: `task after <id> add|done|undo|drop|clear` for the user's own steps after merging (a one-time migration). Shown on the Merge tab and in `merges` until ticked. A needs line starting "After" is refused.
- Shared prompt: no routine deploy or self-check chores in review notes or needs; checking your own work after a merge is the squiggle's job.
- Merge merges every goal repo carrying the task's branch (Repo shows "api + web"; detail lists "Also merges"). `repo:branch` accepts a goal repo's bare name.
### Changed
- Squiggles describe code to you by when and what ("the fix from today 14:27"), not commit hash.
- Squiggles treat a convenient cause ("user error", "intended") as likely until evidence shows it explains the symptom.
- Merge tab below 1000px wide hides the Test result column so titles get the room; it stays in the opened row.
- Squiggles stop only test servers they started, by pid, never by name or port. A change to a squiggle's prompt (role, team) relaunches its idle process on the next message.
- Merging a task committed straight on its base closes it as already on main instead of refusing; the CLI and toast say so.
- Session limit is display only: wakes, team reports and meetings carry on; the banner shows the stated reset and clears when a Claude turn goes through. Not kept across restarts.
- The merge listing sends a review branch that conflicts with its base back to doing, with the files, and tells its owner. Once per conflict: resubmitting the same commits keeps it in review.
- Squiggle prompt: a reviewer's Ship or sign-off approves a change but is never a go to merge; only the user's word is.
- More menu: Quit sits in its own group; with squiggles working, Quit when they finish is the default.
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

### Fixed
- An unknown CLI command prints usage again instead of crashing.
- A dropped task's id is never handed out again; tasks.json keeps the highest id issued.
- Merge tab between 760 and 1100px wide: opening a row no longer squeezes the titles.
- Merge tab: clicking a step's text no longer ticks it; only the checkbox does. Clicking an After merging box shows its full title.
- The Team tab puts the cursor in its search on desktop, unless you're typing in a chat.
- Opening the lead's office or a 1:1, including after Join, puts the cursor in its chat on desktop.
- The meeting presenters example uses placeholder names.
- With tailnet sharing off in config, the Sharing settings tab is hidden; before, it still showed when opened.
- Codex squiggles no longer show idle mid-turn, so wakes aren't sent into a running turn.
- Loading the Merge tab no longer freezes the server while git runs; a branch sent back mid-merge is not merged.
- Editing a squiggle's settings.json takes effect on its next message.
- Stopping a Codex squiggle right as its turn starts now stops it.
- Merge tab on phone: the list keeps its full height and an open row wraps instead of scrolling sideways.
- Areas strip no longer breaks on a goal titled ': x'; editing a goal to an empty title is refused.
- Phone header stays on one line; the menu never wraps.
- Merge tab says 'Loading branches…' until the list arrives, and 'Couldn’t load branches' if it fails.
- Merge buttons, toolbar, links, header pills and top tabs have 44px touch targets.
- Merge tab shows a listing error without waiting on the worktree list.
- Inbox button tooltip no longer names a fixed folder; the Inbox panel shows the real path.
- Merge detail centers the GitHub links; the After merging card heading stays on one line.

## 0.1.1

### Security
- Upgrade now: before 0.1.1, a web page open in your browser could send commands to your room. The server now refuses requests from other sites and hosts, and squiggle actions accept POST only.

### Added
- Goal due dates: set in the goal editor or `goal due <id> <YYYY-MM-DD>|clear`; cards say days left, or overdue in red.
- Views, the open chat, board filters, merge diff and calendar week live in the URL: back, forward, reload and copied links work.

### Changed
- The scheduler staggers wakes per provider, 2 minutes apart (was 10 minutes across all).

### Fixed
- A dropped task's id is never handed out again; tasks.json keeps the highest id issued.
- Merge tab between 760 and 1100px wide: opening a row no longer squeezes the titles.
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
- Goal due dates: set in the goal editor or `goal due <id> <YYYY-MM-DD>|clear`; cards say days left, or overdue in red.
- The room: squiggles with charters, journals and scheduled wakes; a lead you talk to; task board, goals, meetings, inbox, voice.
- First run seeds only the lead, which onboards you and proposes hires.
- `~/.squiggles` data directory (`SQUIGGLES_HOME`), separate from the code.
- `config.json`: port, name, tailnet share, default model, Codex.
- Seams: `prompts/*.md` and `*.append.md`, `local.css` in the data directory.
- Migrations on start, with backups and refusal of newer data.
- `upgrade` command: pull, show what changed, restart, migrate.
- Wake jitter: each wake lands at its cadence ± 10%, and first wakes after a start spread over 10-15 minutes, so installs don't wake in step.
- `bin/install-app.sh`: Squiggles.app and a login item.
