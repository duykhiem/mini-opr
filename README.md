# Mini OPR

Mini OPR is a demo of how one patient record travels with a Patient across several ambulance Transfer legs. Each leg is handled by a different Resource on its own Device, and every Device's Event log is gathered by one Coordinator.

It is a demo of how a One Patient Record (OPR) should behave. It is not a product. It uses no existing product code, no real data and no real integrations.

> **Status:** this README is being rewritten as an online-only spec. Open decisions are tracked on the map [Mini OPR online: spec](https://github.com/duykhiem/mini-opr/issues/1). The glossary lives in [CONTEXT.md](CONTEXT.md).

## Pages

The demo is manual: open the EOC page, three Device tabs and the Coordinator page.

- **EOC page.** Creates Incidents. Each Incident has one Patient and an ordered list of Transfer legs, all created up front (leg n goes to Resource n). The EOC is not a Device and has no Event log. When it creates an Incident, it may give the Patient's name, date of birth and triage.
- **Device page.** One browser tab. It picks one of three seeded Resources, from a dropdown or the `?resource=` URL param. There is no auth. It lists the Transfer legs of its Resource.
- **Coordinator page.** Shows the merged log and each Device's offset.

A Reset exists.

## How it works

- Online only. There is no manual offline switch and no scenario button.
- Many Incidents can run at once.
- Leg n+1 becomes the Active leg when Resource n completes leg n.
- A Device first sees an Incident when its leg becomes active, then gets that Incident's new events in realtime.
- After Handover, the previous Resource can still see and edit the Patient.
- A Device keeps its Event log in local browser storage, writes every event locally first, and retries sending in the background. It shows an online / offline indicator, with no pending count.
- The `events` table on the Coordinator is the source of truth for the Patient. The Patient table is a projection.

## Patient fields

| Field | Rule |
| --- | --- |
| Name, date of birth, triage | Last write wins, per field. The newest `enteredAt` wins; on a tie, the larger `eventId` wins. A field can be overwritten but not cleared. |
| Vitals, notes | Append-only. Every entry is kept. |

There are no conflict marks and no settle entries.

## Event schema

```ts
type Triage = "red" | "orange" | "yellow" | "green" | "blue";

type Vitals = {            // at least one present
  pulse?: number;          // /min
  systolic?: number;       // mmHg
  diastolic?: number;      // mmHg
  spo2?: number;           // %
  respRate?: number;       // /min
  temperature?: number;    // °C
};

type EventBase = {
  eventId: string;         // UUIDv7
  enteredAt: number;       // epoch ms
  incidentId: string;
  patientId: string;
  source:
    | { type: "device"; deviceId: string; resourceId: string; legId: string }
    | { type: "eoc" };
};

type Event = EventBase & (
  | { kind: "fieldSet"; field: "name"; value: string }
  | { kind: "fieldSet"; field: "dob"; value: string }      // YYYY-MM-DD
  | { kind: "fieldSet"; field: "triage"; value: Triage }
  | { kind: "vitalAdded"; vitals: Vitals }
  | { kind: "noteAdded"; text: string }                    // non-empty
  | { kind: "legCompleted" }                               // device source only
);
```

- A Device makes `eventId` and `enteredAt` (its own clock) itself, so it can write with no network.
- `legId` is the Transfer leg the Resource writes under. After Handover, the previous Resource's events still carry its own, completed leg.
- EOC events are written by the Coordinator when the Incident is created: one `fieldSet` per given field, with an `eventId` and `enteredAt` made on the Coordinator.

## Stack

- Frontend: Vite, TypeScript and React.
- Coordinator: Node 24.15.0 or later, with TypeScript, in the same repo as the frontend and sharing its types.
- Storage: SQLite through the built-in `node:sqlite`, with a hand-written transaction wrapper.
- Transport: plain WebSocket. `ws` on the Coordinator; the browser `WebSocket` on the Device, with its own reconnect and an app-level ping.

## Not yet decided

Open tickets on the map:

- [Transfer leg lifecycle and Handover rules](https://github.com/duykhiem/mini-opr/issues/5)
- [Device identity and local storage across tabs](https://github.com/duykhiem/mini-opr/issues/6)
- [Sync protocol between Device and Coordinator](https://github.com/duykhiem/mini-opr/issues/7)
- [Coordinator tables and event application](https://github.com/duykhiem/mini-opr/issues/8)
- [Screen layout for EOC, Device and Coordinator pages](https://github.com/duykhiem/mini-opr/issues/9)

Not yet specified:

- Testing strategy.
- Seed data, and what Reset clears.
- Running it: one command to start the frontend and the Coordinator; whether it is deployed anywhere.
- Build order.

## Out of scope

- Manual offline switch and the "Three crews offline" scenario button.
- Pending event count on the offline indicator.
- Conflict marks and settle entries.
- Auth and login.
- More than one Patient per Incident; patient links ("same patient as").
- Signatures over a person's own entries.
- Upcaster and versioned events.
- Legacy hub and Docker.
- An Event log for the EOC.

## Data

Every name, patient and value in this project is fictional.
