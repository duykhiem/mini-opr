# SQLite driver for the Coordinator

Research for GitHub issue #3. Date: 2026-10-29.

**Question:** Which SQLite driver should the Coordinator use, if it runs as a small Node 24 + TypeScript process for a local demo: the built-in `node:sqlite`, `better-sqlite3`, or something else?

**Recommendation:** Use the built-in `node:sqlite` (`DatabaseSync`), and require Node >= 24.15.0 so it loads with no warning. Keep `better-sqlite3` as the fallback if we need its `transaction()` helper or hit a gap in `node:sqlite`.

## Scope note

The README says the Coordinator runs as a module inside the page, with no server and no database ("State lives in memory"). A real Node server (stretch goal 6) and persistence across reloads (stretch goal 7) are out of scope. This note only matters if one of those stretch goals is picked up. If the Coordinator stays in the page, neither driver applies: both are Node-only. CONTEXT.md also says to avoid the word "server" for the Coordinator.

## Facts

### 1. `node:sqlite` stability in Node 24

| Fact | Source |
|---|---|
| Added in v22.5.0. No longer behind `--experimental-sqlite` since v23.4.0 and v22.13.0, so Node 24 needs no flag. | [Node 24 sqlite docs, history table](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) |
| Stability index in the current Node 24 docs (v24.22.2): **1.2, Release candidate**, since v24.15.0. | same page |
| v24.15.0 (2026-04-15, LTS 'Krypton') lists "sqlite: mark as release candidate" (PR #61262) under Notable Changes. | [CHANGELOG_V24.md](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V24.md#24.15.0) |
| PR #61262 says: "Mark the SQLite module as release candidate and remove the experimental warning." | [nodejs/node#61262](https://github.com/nodejs/node/pull/61262) |
| Confirmed in source: `lib/sqlite.js` at v24.12.0 calls `emitExperimentalWarning('SQLite')`; at v24.15.0 that call is gone. | [v24.12.0](https://github.com/nodejs/node/blob/v24.12.0/lib/sqlite.js), [v24.15.0](https://github.com/nodejs/node/blob/v24.15.0/lib/sqlite.js) |
| Meaning of 1.2: "hopefully ready to become stable. No further breaking changes are anticipated but may still occur in response to user feedback". Stable (2) is not reached yet. | [Node 24 stability index](https://nodejs.org/docs/latest-v24.x/api/documentation.html#stability-index) |
| Node 26 (latest docs, v26.13.0) is also at 1.2 (release candidate since v25.7.0). Not stable on any line yet. | [latest sqlite docs](https://nodejs.org/docs/latest/api/sqlite.html) |
| Latest Node 24 is v24.22.2 (2026-10-28, LTS). | CHANGELOG_V24.md |

**Local check (this machine, Node v24.12.0, Windows 11):**

- `require('node:sqlite')` works with no flag, but prints `ExperimentalWarning: SQLite is an experimental feature and might change at any time`. This matches the v24.12.0 source above.
- `node --disable-warning=ExperimentalWarning` silences it.
- Bundled SQLite is 3.50.4 (`process.versions.sqlite`).
- `DatabaseSync`, `StatementSync`, `Session`, `backup`, `constants` are exported. A `STRICT` table, `INSERT OR IGNORE` dedup by primary key, and `BEGIN`/`COMMIT` all worked.
- So: on 24.12.0 we get the warning; upgrading to >= 24.15.0 removes it (verified from source, not run locally).

### 2. Install pain on Windows

| Driver | Facts | Source |
|---|---|---|
| `node:sqlite` | Built into Node. Nothing to install, no native build. | Node docs |
| `better-sqlite3` | Latest is **13.0.3** (published 2026-08-05), `engines.node >= 22`. | `npm view better-sqlite3` |
| | v13.0.0 (2026-07-21) is "the first version of better-sqlite3 to run on the N-API", so "prebuilt binaries should theoretically work across different versions of Node.js". The `prebuild-install` dependency was removed; prebuilt binaries now ship inside the npm package. | [v13.0.0 release notes](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) |
| | The 13.0.3 package contains `prebuilds/win32-x64.node` and `prebuilds/win32-arm64.node` (plus linux, linuxmusl, darwin). | [package file list](https://www.jsdelivr.com/package/npm/better-sqlite3?version=13.0.3) |
| | `binding.gyp` only builds from source when no prebuild exists for the host (`prebuild_exists` check). A from-source build on Windows needs the usual node-gyp toolchain (Python + Visual Studio C++ tools). | [binding.gyp](https://github.com/WiseLibs/better-sqlite3/blob/master/binding.gyp), [lib/binding.js](https://github.com/WiseLibs/better-sqlite3/blob/master/lib/binding.js) |

So on Windows x64 with Node 24, `better-sqlite3` 13.x should install with no compiler. **Not verified locally**: I did not run `npm install better-sqlite3` (task rule: no installs). Versions before 13 used per-Node-ABI prebuilds via `prebuild-install`, which is where the old Windows install pain came from.

### 3. Sync vs async

| Driver | Facts | Source |
|---|---|---|
| `node:sqlite` | Synchronous. "All APIs exposed by this class execute synchronously." No async API yet. The PR #61262 discussion notes an async API could be added later. | Node 24 sqlite docs, PR #61262 |
| `better-sqlite3` | Synchronous by design; the README claims this gives "better concurrency than an asynchronous API". | [README](https://github.com/WiseLibs/better-sqlite3) |

Both are sync. For a single-process demo Coordinator with small writes, sync is fine and simpler.

### 4. Transactions

| Driver | Facts | Source |
|---|---|---|
| `node:sqlite` | No transaction helper. Use SQL (`BEGIN` / `COMMIT` / `ROLLBACK`) through `db.exec()`. `db.isTransaction` tells if a transaction is open. Confirmed locally: `DatabaseSync.prototype` has no `transaction` method on 24.12.0. | Node 24 sqlite docs, local check |
| `better-sqlite3` | `db.transaction(fn)` returns a function that runs in a transaction: commits on return, rolls back and rethrows on exception. Nested calls become savepoints. `.deferred`, `.immediate`, `.exclusive` variants. Does not work with async functions. | [docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function) |

For `node:sqlite` we would write a small `withTransaction(db, fn)` wrapper (BEGIN, try fn, COMMIT, catch ROLLBACK and rethrow). About ten lines.

### 5. TypeScript types

| Driver | Facts | Source |
|---|---|---|
| `node:sqlite` | Types ship in `@types/node` (`sqlite.d.ts`, `declare module "node:sqlite"`). `@types/node` 24.19.2 includes `DatabaseSync`, `isTransaction`, `limits`. | [@types/node@24.19.2/sqlite.d.ts](https://cdn.jsdelivr.net/npm/@types/node@24.19.2/sqlite.d.ts) |
| `better-sqlite3` | No bundled `.d.ts` in 13.0.3. Types come from `@types/better-sqlite3` (latest 9.6.0, 2026-10-04). It has `transaction()`, but I found no `explain()` in it, so it may lag the v13 additions (`explain()`, `toString()`). Not checked in depth. | npm registry, [index.d.ts](https://cdn.jsdelivr.net/npm/@types/better-sqlite3@9.6.0/index.d.ts) |

Row typing differs: `@types/node` returns `Record<string, SQLOutputValue>` rows, so we cast to our own row types; `@types/better-sqlite3` lets a statement carry a generic `Result` row type (`get(): Result | undefined`).

## Comparison

| | `node:sqlite` | `better-sqlite3` 13 |
|---|---|---|
| Install | none | npm package, prebuilt N-API binary for win32-x64 |
| Flag on Node 24 | none | n/a |
| Warning on Node 24 | yes before 24.15.0, none from 24.15.0 | none |
| Stability | 1.2 Release candidate (breaking changes possible but not expected) | mature library, semver-major for breaks |
| API | sync | sync |
| Transactions | manual `BEGIN`/`COMMIT` | `db.transaction(fn)` helper with savepoints |
| Types | `@types/node` (rows as records, cast needed) | `@types/better-sqlite3` (generic row type, may lag v13) |

## Other options (not researched in depth)

- `sqlite3` (async, callback based): older native module. No reason to prefer it here.
- If the Coordinator stays in the page (current README scope), a Node driver does not apply. A WASM SQLite build would be the route then, but the README says state lives in memory, so no database is needed at all.

## Recommendation

Use **`node:sqlite`** for the Coordinator, with `engines.node >= 24.15.0`.

Why:
- Zero dependencies and no native install step, which suits a local demo on Windows.
- On Node >= 24.15.0 it needs no flag and prints no warning; it is a release candidate on the current LTS line.
- The Coordinator's needs (store each `eventId` once, keep an offset per Device, read events after an offset) are plain inserts and selects. A primary key on `eventId` with `INSERT OR IGNORE` gives dedup; a tiny `withTransaction` wrapper covers the rest.

Action items:
- Upgrade the local Node from 24.12.0 to the latest 24.x (24.22.2) to drop the ExperimentalWarning. If staying on 24.12.0, run with `--disable-warning=ExperimentalWarning`.
- Switch to `better-sqlite3` only if the manual transaction wrapper becomes a burden or a `node:sqlite` change breaks us; v13 should now install cleanly on Windows.

## Could not verify

- That `npm install better-sqlite3@13.0.3` succeeds on this machine with no build tools (not run, no installs allowed).
- That Node 24.15.0+ prints no warning when run locally (verified from source and PR, not by running it).
- Full parity of `@types/better-sqlite3` 9.6.0 with the v13 API.
