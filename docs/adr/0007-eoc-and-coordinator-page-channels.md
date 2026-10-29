# EOC and Coordinator pages: HTTP for writes, one read-only `/watch` socket

The EOC page and the Coordinator page have no `deviceId`, `seq` or Event log, so they do not use the Device protocol. They write with plain HTTP POST and read over one read-only WebSocket, `/watch`, on the same `ws` server: a full `snapshot` on connect, then each change as it is committed. Both pages share the channel and its client, and each renders what it needs. We chose this so both pages update live, as the demo must show Offsets moving and legs completing as they happen, without adding an observer branch to the Device protocol in ADR 0005.

## Writes

```text
POST /api/incidents { resourceId, name?, dob?, triage? }
  201 { incident }   // INC-xxxx, first leg, Patient state
  400                // resourceId not in resources, or a field fails the schema
POST /api/reset
  200
```

- Creating an Incident runs the transaction in ADR 0006.
- Reset is called only from the Coordinator page, behind a confirm dialog. What it clears is decided elsewhere.
- **Failed create:** the EOC keeps the form, shows the reason under the button, and the person clicks again. No automatic retry and no queue. A lost response after a successful create can lead to two Incidents. Accepted for a demo; the live table shows both.

## `/watch` messages

```text
C -> W  snapshot { epoch, incidents, events, devices }
C -> W  events   { events }     // newly stored, in rowid order, EOC events included
C -> W  incident { incident }   // the whole Incident: legs, Active / Closed, Patient state from the projection
C -> W  device   { deviceId, resourceId, offset, connected }
W -> C  ping / C -> W pong      // every 5 s
```

```ts
type StoredEvent = {
  rowid: number;
  deviceId: string | null;  // null for EOC events (the EOC lane)
  seq: number | null;       // null for EOC events
  event: Event;             // as in ADR 0003
};
```

`snapshot.events` and `events.events` carry `StoredEvent`, a shared type, so the lanes view can place each event by Device and `seq` against its Offset, and the merged log can sort by `rowid`. Devices still receive bare `Event`s (ADR 0005).

## Rules

- **When each message is sent.** After a push batch commits: `events`, then `device` with the new Offset, then `incident` for each Incident it touched. After creating an Incident: `incident`, then `events` with the EOC `fieldSet`s. After a Join: `incident`. On hello, close, or a ping older than 10 s: `device`. No batching and no throttling.
- **`incident` is always the whole Incident,** never a diff. A page replaces its row by `incidentId`. Pages never run `applyEvent`; the Patient comes from the projection.
- **Merged log order** is `rowid`, the order the Coordinator stored events, not `enteredAt`. Each line still shows `enteredAt`.
- **Connected** means the Coordinator holds a socket for that Device that has had its `welcome` and a ping within the last 10 s, the same threshold the Device uses to show online. It is kept in memory only; after a Coordinator restart every Device shows disconnected until its next hello. The Devices table lists every row in `devices`.
- **EOC after create.** The Incident table is built only from `/watch`. The POST response is used to clear the form and to highlight the new `INC-xxxx` row when it appears, whichever arrives first.
- **Reset.** After the Reset commits, the Coordinator sends a new `snapshot` (new epoch, empty data) on every open `/watch` socket and does not close them. A page replaces all of its state whenever it receives a `snapshot`, so it needs no epoch check. The confirm dialog closes on the `200`.
- **Reconnect.** The pages use the Device's reconnect helper: backoff 0.5, 1, 2, 4, then at most 5 s, with ping every 5 s and a 10 s threshold. Each page shows "live" or "disconnected"; while disconnected the data stays on screen, dimmed, and the EOC create form still works over HTTP. On reconnect the new `snapshot` replaces everything.

## Considered options

- **Share the Device socket with a `role` in hello:** the Device protocol would grow a branch with no `deviceId`, `seq`, Offset or leg-based fan-out, and a bug there could break Device sync.
- **HTTP GET for the snapshot plus a socket for changes:** a change between the GET and the socket opening is lost unless both are stitched together.
- **Refresh or polling:** the observer pages would lag behind the Devices, which is what the demo exists to show.
- **Commands over the socket:** needs a hand-made request and reply on top of the socket, where HTTP already gives one, and the Coordinator already serves HTTP for Resources (ADR 0006).
- **Closing `/watch` sockets on Reset** like Device sockets: the pages store nothing locally, so a new snapshot is enough.

Source: [Channels for the EOC and Coordinator pages](https://github.com/duykhiem/mini-opr/issues/10).
