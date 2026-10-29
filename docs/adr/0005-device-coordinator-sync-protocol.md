# Device to Coordinator sync: per-Device Offset up, full snapshot down

Each Device numbers the events in its own Event log (`seq` 1, 2, 3...), and the Coordinator keeps one Offset per Device: the highest `seq` it has stored without gaps. Downstream there is no cursor: after every hello the Coordinator sends the Device everything it can see, then pushes new events in realtime, and the Device dedups by `eventId`. We chose this because the Offset is what the Coordinator page shows, a Device never needs per-event "acked" flags, and demo data is small enough that resending a snapshot is cheaper than getting a download cursor right when a leg becomes active.

## Messages

All on one WebSocket per Device.

```text
D -> C  hello    { deviceId, resourceId, epoch }
C -> D  welcome  { epoch, offset }           // offset 0 for a Device the Coordinator has not seen
C -> D  snapshot { visible Incidents with legs, all their events }
D -> C  push     { items: [{ seq, event }] } // every seq > offset, then each new event at once
C -> D  ack      { upTo }                    // after the batch is committed
C -> D  events   { events }                  // realtime fan-out
C -> D  incident { Incident with legs, events } // legs changed; full history when a leg just became active
D -> C  ping / C -> D pong                   // every 5 s
C -> D  error    { seq, reason }, then close
```

## Rules

- **Upload.** The Coordinator skips `seq <= offset`. `seq > offset + 1` is a protocol error. A Device may send a new push before the previous ack arrives; WebSocket keeps order.
- **Event log holds only the Device's own events.** Events received from the Coordinator are stored separately, under `opr:<deviceId>:received`. On an epoch change the Device clears both and `seq` restarts at 1.
- **Fan-out.** A new event goes to every connected Device whose Resource holds or held the Active leg of that Incident, except the connection that sent it. Another browser on the same Resource is another Device and receives it.
- **No business rejects.** Every well-formed event is stored and advances the Offset. Whether an event takes effect (for example a late `legCompleted`) is decided when applying it, not by the sync protocol. The Device learns the outcome from the leg state it receives.
- **Bad events are bugs.** Wrong schema, unknown Incident, `deviceId` or `resourceId` that differ from the hello, or a `legId` that is not this Resource's: the Coordinator stores nothing, keeps the Offset, sends `error` and closes. The Device shows "sync error" and keeps reconnecting.
- **Ordering.** Only per Device: the Coordinator stores each Device's events in `seq` order. Nothing is guaranteed across Devices or on download; the Patient fold does not depend on arrival order.
- **Online.** A Device is online when it has a welcome and its last pong is under 10 s old. On close or timeout it reconnects with backoff 0.5, 1, 2, 4, then at most 5 s. Not verified: timers in a hidden tab may be slowed by the browser and show offline by mistake.
- **Reset.** The Coordinator closes every Device socket. On reconnect the epoch check in hello makes each Device clear itself.

## Considered options

- **Ack by `eventId`** instead of `seq` and Offset: no real Offset to show, and the Device must track a flag per event.
- **Download cursor on a global sequence:** saves bandwidth, but an Incident that becomes visible later has events older than the cursor, so it needs a second catch-up path anyway.
- **Explicit `rejected` replies:** the events table would no longer be a full copy of every Event log, and the Device would need to undo events it already applied.

Source: [Sync protocol between Device and Coordinator](https://github.com/duykhiem/mini-opr/issues/7).
