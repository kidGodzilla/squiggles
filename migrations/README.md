# Migrations

`NNN-name.mjs` exports `async up(dataDir)` and moves the data directory from schema NNN-1 to NNN. The first one is `002`; schema 1 is v0.1.

Rules: idempotent, touch only `dataDir`, never the clone. The server backs up first and records the new schema after each step. See docs/upgrading.md.
