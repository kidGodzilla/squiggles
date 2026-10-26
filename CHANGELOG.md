# Changelog

Each version lists Added, Changed and Fixed, plus Migrations and Breaking when present. Breaking entries say how to adapt local changes. Data schema is in `config.json`; see docs/upgrading.md.

## 0.1.2 (unreleased)

### Security
- Cloudflare share: only the user turns it on (never a squiggle, the lead included); needs a room passcode of 8+ characters, which can't be cleared or shortened while shared; tunnel hits are never local; peers refuse them. Wrong-passcode limits count the address Cloudflare saw, not one the client claims, and guessing over the link never locks you out on your Mac. The link closes when the room stops, and a start ends one a crashed room left open.
- A squiggle can no longer make itself lead or change its own permission mode, working directory, trust or model: only you or the lead can (lead only you). Updates accept known fields only; others are refused. A squiggle other than the lead changes only itself, charter included. Changing lead or those fields from the page or terminal needs a room passcode, and an unlocked page; so does a charter once a passcode is set. Save prompts to unlock and sends the charter only when you changed it.
- Hiring is the lead's or yours, and waits for a room passcode: until one is set any program on your Mac could claim the room. The page asks you to set one each visit, the lead's onboarding asks too, and squiggles can't set, clear or loosen it. Other squiggles can't create squiggles; New squiggle needs an unlocked page. Permission mode must be auto, acceptEdits, plan or bypassPermissions.
- Shared files other than images, audio, PDF, HTML and plain text are served as plain text, so a dropped script or stylesheet can never run as the room's own. A task status from an agent's to-do list never reaches the page's markup unchecked.
- A squiggle deletes only shared files it added, and files and "Shared file for you" notes carry the real sender, not a name it claims. Deleting anyone else's file needs you: an unlocked page once a passcode is set.
- Squiggles can't unlock the room, even with the passcode.
- Squiggles on Codex are recognised as themselves when they call the room, so every squiggle rule applies to them, including programs they left running after a turn; before, they passed as you.
- Only the lead or you can quit the room; once a passcode is set, Quit needs an unlocked page or your terminal's passcode. Quit and restart record who really asked, not a name in the request.
- `wait add --file` reads back only a plain file really under /tmp: a symlink or hard link there to a file elsewhere reports that it appeared, without its contents.
- Voice install is pinned: `npm ci --ignore-scripts` from a shipped lockfile (kokoro-js 1.2.1, sharp 0.35.5 past its advisories) and a fixed model revision. An existing install whose lockfile differs is reinstalled.
- Image paths in agent messages can no longer use %2e or backslashes to make the page fetch a path outside /files/.
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
- Squiggles can run on Pi: list the models in config `pi` and pick one per squiggle (Settings > Squiggles or `set <id> model`). Each keeps one pi process and session between turns, can be steered mid-turn, has its own Turns at once row, and can't touch Downloads, Desktop or Documents.
- Share without Tailscale: Settings > Sharing > Cloudflare and `share cloudflare on|off|status` open a public Cloudflare quick tunnel link (`"cloudflare": true` in config.json; needs `cloudflared`). Reopens after a restart at a new link.
- The app icon, favicon and header logo are your lead in a rounded square, and follow its look when you change it. New workspaces' lead starts with the face on the shipped icon.
- Clean theme: a plain black and white look in the style of shadcn/ui that follows your system light or dark mode. Settings > Room > Theme, or `room theme flat|clean`. Flat stays the default; each browser keeps its own choice.
- Provider slots: at most a set number of turns run at once per provider (`slots` in room.json; defaults 24 Claude, 4 Codex; 0 means no cap). A turn over the cap waits in line and starts when one ends: you first, then the lead, then squiggles, then scheduled wakes. The lead and you never wait. `GET /api/slots` shows the line; the lead or the unlocked page changes caps with `POST /api/slots`.
- Waits on a task's status: `wait add "<what>" --task <id> --until done` wakes the squiggle when the task gets there, or if it leaves the board. Up to 7 days; durations take `d`.
- From your terminal, a change that needs an unlocked room (squiggle settings, charters, hiring, quitting, deleting shared files) asks for the passcode, makes the change, then locks again.
- Proactive: a squiggle that finishes a note it filed itself in a turn nobody asked for (stamped by the server) shows "Proactive" instead of Done (tile, Team, 1:1, header count, toast, `list`), and the lead's team report says which notes were its own idea.
- Waits: a squiggle running a long job files `wait add "<what>" --file <path>|--pid <pid> [--host user@host] [--for 4h]` and ends with WAITING; the harness checks it every 2 minutes (fixed probes, never the squiggle's own command) and wakes it with the result. WAITING without an open wait counts as BLOCKED. `waits`, `wait drop <id>`; the squiggle sheet lists them under Waiting on with Drop.
- Trust per squiggle (Low, Medium, High, Very high) in Settings, the squiggle sheet and `set <id> trust <level>`: sets how far it acts on its own ideas. Low only suggests (the server refuses its own `task add`); only the user or the lead can change it.
- Notes filed in a turn the user or the lead started are marked `asked` and don't count as Proactive; `task add ... --asked [owner|lead]` marks one filed later.
- Calendar on desktop: week hour grid and a month view, with a Week/Month switch kept in the URL. `room view calendar week|month`.
- `notes <query>`: search every journal and charter, research/, files/ and docs/ for what was already written down. Squiggles are told to check it before researching again.
- Chat links `[Name](1on1:<id>)` open that squiggle's 1:1; the lead and squiggle prompts say how to use them.
- `load [days]`: your actions per day (merges, asks, messages) beside tasks shipped, how long the lead waited on harness calls, and server stalls. Goals shows today against the past 6 days.
- Cost ledger: each finished turn adds a row to `runs/cost.jsonl` (dollars for Claude, tokens for other providers). `cost [days]` sums it per squiggle; Team shows each one's spend over 7 days.
- `runs/stalls.jsonl` logs event-loop stalls over 1s: duration, CPU time (near 0 means the process was paused), requests in flight and slow background work, including each slow git call by repo and subcommand.
- `task ship <id> [note]`: a reviewer's sign-off pinned to the commit they saw. Merge takes the reviewed commit, and a branch that moved after review is refused until it's moved to review again. The Merge tab shows the reviewed commit and who shipped it.
- A message sent mid-turn shows at once that it landed and what the squiggle is doing; the squiggle answers it first.
- Images in squiggle messages render inline: a path under the data dir's files/ or research/, or `![alt](path)`. Other paths and web URLs stay text.
- Restart counts down 10s on an open page, with Restart now and Not yet; Not yet lets work go on until you step away. `restart now|later|status`, and a Restart item in the menu.
- Merge steps name their owner (`task needs|after <id> add "Ada: <step>"`, or Owner for you); untagged ones are refused and `tag <n> <owner>` fixes old ones. Each squiggle is told its steps on review or merge, and the Merge tab says whose each step is.
- Squiggle sheet: Look lists every character style; Avataaars adds hair, clothes and colour pickers.
- Two more character styles, Notionists and Lorelei (CC0 art via DiceBear's parts): `look <id> notionists|lorelei` or the room's character setting. Both talk; Lorelei has no desk.
- Ask cards: pending asks show inline where they were filed, in the lead's chat and the filer's 1:1, with Copy, Run and Deny, plus an asks count in the header; ran asks fold to one line. Hidden characters, padding and risky shapes are spelled out; Run confirms with the exact command and shows only on the room's own computer. Squiggles are told to file an ask when auto mode blocks a write.
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
- Picks: `pick ask "<question>" "<option>" "<option>" [--images a,b] [--task <id>]` files a choice for the user; open picks collect on one card above the lead chat composer, options as buttons (images shown when they live in files/ or research/). A tap answers and the asker is told; the lead relays a spoken answer with `pick <id> <option>`. `picks [all]`, `pick drop <id>`. Answering needs the room passcode.
- Settings > Defaults > Turns at once, and `slots`, set how many turns each provider runs at once.
### Changed
- The calendar reader runs as its own small app, so one Allow covers the terminal and every squiggle; the allow prompt waits 5 minutes, and a reader that exits before macOS can track it no longer reads as a failure.
- The tab icon has a deeper tile and a faint edge, so it holds at 16px on a white tab bar.
- Every editor popup is a dialog: a title, a close button, a dimmed page behind it, only the body scrolls, and the footer keeps delete on the left and save on the right. On phones it is a bottom sheet. The task peek stays beside its note.
- README shows a screenshot of the room.
- `restart` is refused when no server code or `config.json` changed since the server started (UI changes need only `room reload`, prompts the next wake). `restart force` restarts anyway.
- Squiggle shells use nvm's Node (the repo's `.nvmrc`, else nvm's default) ahead of Homebrew's. No change without nvm.
- Squiggle prompt: ask only for the user's decisions, check before redoing an irreversible step, declined suggestions stay declined, copy ids from their source, fix or switch off a check that keeps failing.
- Squiggle prompt: propose the next useful thing with `suggest` when the board is empty, and batch blocked commands into one ask.
- Squiggles other than the lead run at lower CPU priority (nice 10), so a busy Mac keeps the lead and the page quick.
- Squiggles are asked to ship each change standalone off main, mergeable and deployable in any order, with no stacked branches.
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
- Toasts show on every view, not only the Room.
- Tasks with filters that match nothing show one line with a Clear button, and the search box is full width on phones.
- Popovers (meeting, goal, note, person, task link) are wider, never taller than the window, scroll inside with the action row pinned, and open beside, opposite or below what you clicked. Meeting attendees sit in an even grid, 44px rows on touch.
- Long goals stay short: goal cards show three lines of title and two of note, Team cards one line of goals; hover for the full text.
- Team cards stay a sane height: bigger photo, every field clamped to a line or two (hover for the full text), cards in a row line up with their buttons on one baseline, and phones hide the charter lines.
- Confirm and unlock prompts open above the New squiggle form instead of behind it.
- Messages such as a failed Save show above an open sheet instead of behind it.
- Sheet buttons such as Wake now no longer spill out of their button on a phone; the row wraps instead.
- A wait on a file outside /tmp now finishes when the file appears; before, its check failed every time. Waits on another host allow a slow first connect (25s) and drop a stalled session.
- Images in picks and chat show when the data dir sits behind a symlink (such as /tmp on macOS); the CLI's realpaths now match.
- Chat composers no longer open at 0px high, clipping the placeholder, when wired while hidden; they size when shown or resized.
- `load` and Goals count a shipped task on the local day it finished; east of UTC it showed as yesterday until UTC midnight. Tasks now record `finishedAt`.
- The lead no longer tells you to press Run on an ask that already ran, or Merge on a task no longer in review: those lines are dropped (noted in the log).
- Ages on the board and merges list no longer show -1d before noon: dates are counted from their UTC day.
- Worktrees get their own copy of node_modules (an APFS clone) instead of a link to main's, so installing in a worktree no longer empties the main checkout's.
- A double-clicked Merge joins the running merge; send back, move and drop wait until git finishes writing.
- Unsent chat text survives a page reload or restart, per chat, until you send or clear it.
- `task worktree`, `worktrees`, the hourly orphan check, merges, and moving a task to done or dropping it run git in the background, so a slow disk no longer freezes every chat while a checkout runs or a finished task's worktrees are removed.
- A due restart holds your chat at most 2 minutes: held messages then go out and nothing is held for 10 minutes; the restart still runs once nobody is mid-turn.
- `room reload` no longer reloads the page under you: while you're active it counts down 10s with Reload now and Not yet; Not yet waits until you step away.
- A restart postponed from the CLI, or before a page reload, now resumes once you are idle on the page instead of waiting for every page to close.
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
