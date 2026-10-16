# Upgrading

Goal: `git pull` never conflicts with your room, and your room never breaks on a new version.

## Two directories

| | Code | Data |
|---|---|---|
| Where | the clone, e.g. `~/squiggles` | `~/.squiggles` (override: `SQUIGGLES_HOME`) |
| Who writes | git only | the server, the CLI, your squiggles |
| Upgraded by | `git pull` | migrations |

The server never writes into the code directory. Data lives in a dot-directory because macOS paths are case-insensitive: `~/Squiggles` would be the clone.

Data layout:

```
~/.squiggles/
  config.json          settings and schema version
  squiggles/<id>/      squiggle.json, charter.md, journal.md
  goals.json  tasks.json  humans.json  meetings.json
  inbox/  calls/  files/  runs/
  prompts/             optional prompt additions (below)
  local.css            optional UI overrides
  backups/             made before each migration
```

Squiggles get `--add-dir ~/.squiggles`; the lead's edit rights point there, not at the clone.

## Customisation seams

Change behaviour here, never by editing the clone. A dirty clone blocks `upgrade`.

1. `config.json`: port, your name, tailnet share on/off, default model (Opus; Fable refused), Codex on/off.
2. `prompts/lead.append.md`, `prompts/squiggle.append.md`: appended to the shipped prompt, so upstream prompt fixes still reach you. A full `prompts/lead.md` replaces the shipped one and freezes it; `upgrade` warns when the shipped version changed underneath it. `prompts/lead-charter.md` replaces the charter a new room's lead starts with.
3. `local.css`: loaded after `room.css`.

Need a seam that doesn't exist? Open an issue; don't fork the file.

## Versions

- `package.json` `version`, semver, tagged `vX.Y.Z`. No dependencies.
- `CHANGELOG.md`: one section per version. Each lists Added, Changed, Fixed, and, when present, Migrations and Breaking.
- Data schema: integer `schema` in `config.json`, independent of the app version.

## Migrations

`migrations/NNN-name.mjs`, each exporting `up(dataDir)`. They must be idempotent and touch only the data directory.

On server start:

1. No data dir: create it at the latest schema with only the lead.
2. Data schema older than the code's: copy `config.json`, the board JSON files and `squiggles/` to `backups/<date>-schema-<n>/`, run each pending migration in order, write the new `schema` after each.
3. Data schema newer than the code's (downgrade): refuse to start, print the version that wrote it.
4. A migration throws: stop, leave the backup, print how to restore it.

`runs/` is not backed up; it is a cache.

## `upgrade`

`node bin/agents.mjs upgrade`:

1. Refuse if the clone has local changes; list them and point at the seams.
2. `git fetch --tags`, print the CHANGELOG sections between the current and newest version.
3. `git pull --ff-only`.
4. Restart the login item (`launchctl kickstart -k`); the server migrates on boot.
5. Wait for `/api/squiggles`, print the new version and schema.

README paste block for Claude Code:

> Upgrade Squiggles: run `node ~/squiggles/bin/agents.mjs upgrade`. If it refuses because of local changes, move each change into a seam from docs/upgrading.md, then run it again. Summarise the CHANGELOG for me.

## Order of work

1. Data dir split and `SQUIGGLES_HOME` (with t317 config).
2. `config.json` with `schema: 1`; migration runner with no migrations.
3. Prompt append files and `local.css`.
4. `package.json`, `CHANGELOG.md`, tag `v0.1.0`.
5. `upgrade` command and README block.
