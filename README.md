# Mini OPR

Mini OPR is a single web page with three simulated tablets and one Coordinator. Three crews write into one shared patient record. You switch tablets offline and online, and watch every tablet reach the same record, with no lost entries and every conflict visible.

It is a demo of how a One Patient Record (OPR) should behave. It is not a product. It uses no existing product code, no real data and no real integrations.

## Scope

The Coordinator and the network run as modules inside the page. There is no server, so the page deploys as a static site. The kernel and the Coordinator stay in separate modules, so a real server can come later.

### In scope

| # | Feature | Done means |
|---|---|---|
| 1 | Three tablets side by side, each with its own event log | Each tablet shows its own log and its own view of the record |
| 2 | An Online / Offline switch on each tablet | While offline, entries stay local, and a badge counts the pending events |
| 3 | A Coordinator in the page | It stores events, removes duplicates by `eventId`, keeps an offset for each tablet, and sends each tablet what it has not seen |
| 4 | One incident, one patient record | All three tablets are members. There are no routing rules beyond that. |
| 5 | Three kinds of field | **Added** (vitals, notes): every entry is kept. **Timeline** (triage): the newest wins, with a "disagreement" mark. **Single value** (patient name): "in conflict" until a person settles it. |
| 6 | Settle a conflict | A button writes an entry that names both conflicting entries in `seen`, and the mark goes away |
| 7 | One scenario button: "Three crews offline" | It plays the story step by step: all tablets go offline, each writes, then each reconnects |
| 8 | Kernel tests | `fold(events)` gives the same record for any order and with duplicates |

### Out of scope

These are stretch goals, in priority order:

1. A routing view that animates each event to the tablets.
2. A second incident, and routing by membership.
3. Patient links ("same patient as").
4. Signatures over a person's own entries.
5. An upcaster and version 1 events.
6. A real Node server with WebSocket.
7. A legacy hub, Docker, and persistence across reloads.

## Stack

- Vite, TypeScript and React.
- Vitest for the kernel tests.
- No backend and no database. State lives in memory.

## Layout

```
mini-opr/
├── src/kernel/        types.ts, ids.ts, fold.ts, conflict.ts  (pure, tested)
├── src/coordinator/   coordinator.ts, network.ts             (in memory, with an offline flag)
├── src/ui/            Tablet.tsx, RecordView.tsx, EventLog.tsx, Scenario.tsx
├── src/kernel/*.test.ts
└── README.md
```

## Data model

The whole kernel works on one event type:

```ts
type Event = {
  eventId: string;          // UUIDv7, made on the tablet
  origin: string;           // "A" | "B" | "C"
  recordId: string;         // the patient record
  author: string;           // crew name
  enteredAt: number;        // tablet clock
  seen: string[];           // eventIds this entry has seen
  kind: "vital" | "note" | "triage" | "name" | "settle";
  value: unknown;
};

fold(events: Event[]): PatientRecord   // pure, order-independent
```

## The rules

- A tablet writes every entry to its own log first. The UI never waits for the network.
- A tablet makes its own ids, so it works with no network.
- Tablets never talk to each other. Every event goes through the Coordinator.
- The Coordinator stores each `eventId` once, and sends a tablet only the events after its offset.
- An added entry never conflicts.
- For a timeline field, the newest `enteredAt` is the current value. Two different concurrent values show "disagreement".
- For a single-value field, two concurrent values stay "in conflict" until a person settles them. The last write never wins by itself.
- Every tablet shows the same record, whatever order the events arrive in.

## Plan

| Time | Work |
|---|---|
| 0:00 to 0:20 | Scaffold Vite, React and Vitest. Write the types. |
| 0:20 to 1:00 | Kernel: `fold`, the three kinds of field, settle. Tests for any order and for duplicates. |
| 1:00 to 1:30 | Coordinator: store, dedup, offsets. Network: a queue for each tablet, with an offline flag. |
| 1:30 to 2:20 | UI: three tablets, entry forms, a record view with marks, an event log. |
| 2:20 to 2:45 | The scenario button and a step mode. |
| 2:45 to 3:00 | README screenshots, deploy. |

## Working with Claude

1. Keep this scope in `CLAUDE.md` as the contract, and tell Claude to stay in it.
2. Ask for the kernel and its tests first. Start the UI only when the tests pass.
3. Ask for one slice per prompt: kernel, then Coordinator, then UI, then scenario.
4. At 2:15, stop new features, and finish the scenario and this README.

## Done

A person opens the page, plays "Three crews offline", and sees three tablets reach the same patient record after they reconnect. No entry is lost, and every conflict is visible.

## Data

Every name, patient and value in this project is fictional.
