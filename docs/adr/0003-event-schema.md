# Event schema: per-field last write wins, no conflicts

Every change to a Patient, and the completion of a Transfer leg, is an Event. The Coordinator's `events` table is the source of truth; the Patient table is a projection of it. Name, date of birth and triage are last-write-wins per field; vitals and notes are append-only. There are no conflict marks and no settle entries, so the Patient can be rebuilt from events in any arrival order.

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

## Rules

- **Last write wins:** the newest `enteredAt` wins; on a tie, the larger `eventId` (string compare of UUIDv7). Deterministic and independent of arrival order.
- **No clearing:** a field can be overwritten but never set back to empty.
- **Device events:** the Device makes `eventId` and `enteredAt` (its own clock) itself, so it can write with no network. `legId` is the leg the Resource writes under, including its own completed leg after Handover.
- **Completing a leg is an Event** (`legCompleted`), written to the Event log first and synced like any other.
- **EOC events:** when the EOC creates an Incident with name, dob or triage, the Coordinator records one `fieldSet` per field with `source: { type: "eoc" }`, minting the `eventId` and using its own clock.
- **No schema version and no upcaster.**

## Consequences

- Clock skew between a Device and the Coordinator can make an EOC value win or lose unexpectedly. Accepted for a demo.

## Considered options

- **Conflict marks and settle entries** (the old design): dropped together with offline as a feature.
- **One event kind per field** instead of a generic `fieldSet`: more kinds for the same rule.

Source: [Event schema for Device events](https://github.com/duykhiem/mini-opr/issues/4).
