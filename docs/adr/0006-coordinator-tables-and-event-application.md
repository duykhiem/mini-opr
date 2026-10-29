# Coordinator tables: events, a Patient projection, and direct-write Incidents and legs

The Coordinator keeps every Device event in an `events` table and applies each one, in the same transaction, to a `patients` projection built by one pure reducer `applyEvent(state, event)` that Device and Coordinator share. Incidents and Transfer legs are not events: the EOC and Join write them directly, so they are their own source of truth and cannot be rebuilt from `events`. Only the Patient and the completion of a leg are derived from events. We chose a stored projection over folding on read so the EOC and Coordinator pages can list Patients cheaply, and one shared reducer so there is a single LWW implementation to test.

## Tables

```text
meta          (key, value)                                  -- Coordinator epoch
resources     (resourceId, name)                            -- seeded at startup, INSERT OR IGNORE
incidents     (incidentId, createdAt, ...)                  -- Closed is derived, not stored
transfer_legs (legId, incidentId, resourceId, createdAt,
               completedAt NULL, completedEventId NULL)
patients      (patientId, incidentId, state JSON)           -- projection, output of applyEvent
events        (rowid, eventId PK, incidentId, kind, enteredAt,
               deviceId NULL, seq NULL, body JSON)          -- UNIQUE(deviceId, seq); NULLs for EOC events
devices       (deviceId, resourceId, offset)                -- written on hello, offset bumped on push
```

## Rules

- **One push batch is one transaction:** insert the events, apply each, bump the Offset, commit, then send `ack` and fan out (`events`, plus `incident` when a leg changed).
- **Creating an Incident is one transaction:** the Incident, its first leg, an empty `patients` row with a Coordinator-minted `patientId`, and the EOC's `fieldSet` events applied to it. A Join is one transaction that inserts a leg.
- **`fieldSet`:** last-write-wins per field, by `enteredAt`, then the larger `eventId`. Vitals and notes are arrays in `state`, sorted by (`enteredAt`, `eventId`), never by arrival.
- **Every stored event takes effect on the Patient,** even while the Incident is Closed. Locking the form is the Device's job.
- **`legCompleted`:** the first one stored wins (`UPDATE ... WHERE completedAt IS NULL`). Later ones are stored with no effect, and a completion never changes.
- **Bad events are bugs** (error, then close): an `eventId` already stored arriving with a new `seq`, a `patientId` that is not its Incident's, or a `resourceId` not in `resources` (in hello or on Join).
- **Readers:** the projection feeds the EOC Incident list and the Coordinator page. Devices still get events in the snapshot and fold them with the same reducer.
- **Merged log** on the Coordinator page shows `events` in `rowid` order only; Incident creation and Joins are not in it.
- **Resources** are fetched by the Device and the EOC with an HTTP GET on the Coordinator.

## Rebuild

Never at runtime. A test proves that applying each event as it is stored gives the same `patients` state as clearing the table and replaying `events` in any order.

## Considered options

- **No `patients` table, fold on read:** nothing to keep in sync, but every list on the EOC and Coordinator pages would fold all events of every Incident.
- **One column per LWW field with its stamp, and separate vitals and notes tables:** LWW written in SQL, a second implementation beside the Device's fold.
- **Earliest `enteredAt` wins for `legCompleted`:** a completion time a Device has already seen could move backwards.
- **Offset derived as `MAX(seq)` from `events`:** cannot drift, but a Device that has connected and sent nothing would not appear on the Coordinator page.
- **Resources as a constant in shared code:** simpler, but the Coordinator would have no table to validate against or list from.

Source: [Coordinator tables and event application](https://github.com/duykhiem/mini-opr/issues/8).
