# Built-in node:sqlite for the Coordinator, Node 24.15.0 or later

The Coordinator is Node and TypeScript in the same repo as the Vite and React frontend, sharing its types, and stores its data in SQLite through the built-in `node:sqlite` (`DatabaseSync`). It needs no dependency and no native build on Windows. From Node 24.15.0 the module prints no ExperimentalWarning, so that is the minimum version.

## Consequences

- The API is synchronous but has no transaction helper; the Coordinator wraps `BEGIN` / `COMMIT` / `ROLLBACK` itself.
- Rows are plain records, cast to our own types.

## Considered options

- **`better-sqlite3` 13.x:** has `db.transaction()` and ships Windows binaries, but adds a native dependency. It is the fallback if the hand-written transaction wrapper becomes a burden.

Source: [SQLite driver for the Coordinator](https://github.com/duykhiem/mini-opr/issues/3).
