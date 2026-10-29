# Testing strategy: Vitest, property tests for the reducer, real SQLite in memory, protocol over a real socket

Tests run on Vitest, for both the shared code and the Coordinator. The claims that matter most are "in any order" claims, so the shared reducer `applyEvent` and the rebuild are tested with `fast-check` properties on top of plain example tests. Everything that touches storage runs on the real `node:sqlite` driver with a `:memory:` database, never on a fake store. The WebSocket protocol gets end-to-end tests: a real Coordinator on port 0 and the real Device sync client, both in Node. React components are not tested; the manual demo covers the UI.

## Levels

- **Reducer (`applyEvent`), pure:** one example test per rule (newest `enteredAt` wins per field, a tie goes to the larger `eventId`, vitals and notes sorted by (`enteredAt`, `eventId`), a field is never cleared). Properties: every permutation of a set of events folds to the same state, and applying an event again does not change the state (dedup by `eventId`).
- **Coordinator core, `node:sqlite` with `:memory:`:** the push transaction (insert, apply, bump Offset, commit; `seq <= offset` skipped; a gap is an error), `legCompleted` first stored wins, each bad-event rule (nothing stored, Offset unchanged), Incident creation as one transaction, and the rebuild from ADR 0006: applying events as stored gives the same `patients` state as clearing it and replaying `events` in any order (a `fast-check` property).
- **Protocol end to end:** the Coordinator listening on port 0 with a `:memory:` database, and the Device sync client run in Node with an in-memory storage and Node's global `WebSocket`. Covers hello, welcome and snapshot; push and ack; fan-out to another Device; `error` then close on a bad event; a Device clearing itself after Reset changes the epoch.
- **Device sync client:** `seq` numbering, resending everything above the Offset after welcome, clearing on a new epoch. Tested in Node with injected storage.
- **Not tested:** React components and browser-only parts (Web Lock, the localStorage adapter, timers in a hidden tab).

## CI

GitHub Actions on every pull request and on push to `main`: Node 24.15.0 or newer, one job that installs, typechecks and runs the tests.

## Consequences

- The Device sync client takes its storage and its WebSocket from the caller, so the same code runs in the browser and in tests.
- The Coordinator takes its database path and port from the caller, so a test can start it on `:memory:` and port 0.
- One exception to `:memory:`: the test that a plain restart keeps the Coordinator epoch needs a database that outlives the Coordinator, so it uses a temporary SQLite file and removes it afterwards.
- Vitest resolves `node:sqlite` as a built-in (checked with Vitest 5 on Node 24), so the Coordinator tests run on Vitest too.

## Considered options

- **`node:test`:** no dependency, but needs a separate way to run TypeScript and a second runner beside the frontend tooling.
- **Example tests only for the reducer:** readable, but a few hand-picked orders do not prove order independence.
- **A temporary SQLite file:** same coverage as `:memory:`, slower, and needs cleanup.
- **A fake in-memory store:** would test SQL that never runs in production.
- **Browser end-to-end tests with Playwright:** heavy for a demo whose UI is checked by hand.
- **React component tests:** low value for thin pages over the shared reducer.

Source: [Testing strategy](https://github.com/duykhiem/mini-opr/issues/12).
