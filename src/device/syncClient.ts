import type { Event } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import type { CoordinatorMessage, DeviceMessage, JoinRejectReason, LoggedEvent } from "../shared/protocol.ts";
import { openReconnecting, type ReconnectingSocket } from "../shared/reconnect.ts";

// The part of localStorage the client uses, so tests can pass an in-memory one.
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// A LoggedEvent is stored on the Coordinator once its seq is at or below the Offset.
export type { LoggedEvent };

export type SyncState = {
  online: boolean;
  epoch: string | null;
  offset: number;
  log: LoggedEvent[]; // this Device's own events, in seq order
  snapshotReceived: boolean;
  incidents: Incident[];
  received: Event[];
  error: string | null;
};

// "offline": the Device was not online, or the socket closed before a reply.
export type JoinResult = { ok: true } | { ok: false; reason: "offline" | JoinRejectReason };

export type SyncClient = {
  start(): void;
  stop(): void;
  // Writes the Event to the Event log with the next seq, then pushes it if the Device is welcomed.
  record(event: Event): void;
  // Join needs the network: it goes over this Device's socket and never waits for a reconnect.
  join(incidentId: string): Promise<JoinResult>;
  getState(): SyncState;
  subscribe(listener: () => void): () => void;
};

export type SyncClientOptions = {
  url: string;
  deviceId: string;
  resourceId: string;
  storage: KeyValueStore;
  createSocket: (url: string) => WebSocket;
};

// Framework-free: the caller passes the storage and the WebSocket, so it runs in the browser and in Node.
export function createSyncClient(options: SyncClientOptions): SyncClient {
  const { storage, deviceId, resourceId } = options;
  const keys = {
    events: `opr:${deviceId}:events`,
    received: `opr:${deviceId}:received`,
    epoch: `opr:${deviceId}:epoch`,
  };

  const listeners = new Set<() => void>();
  let state: SyncState = {
    online: false,
    epoch: storage.getItem(keys.epoch),
    offset: 0,
    log: readLog(),
    snapshotReceived: false,
    incidents: [],
    received: readReceived(),
    error: null,
  };

  // The shared helper reconnects and pings (ADR 0005 timings); online also needs this socket's welcome.
  let socket: ReconnectingSocket | undefined;
  let connected = false;
  let welcomed = false;
  // Joins waiting for a reply, matched by incidentId.
  const pendingJoins = new Map<string, ((result: JoinResult) => void)[]>();

  function settleJoins(incidentId: string, result: JoinResult): void {
    const waiting = pendingJoins.get(incidentId) ?? [];
    pendingJoins.delete(incidentId);
    for (const resolve of waiting) resolve(result);
  }

  function update(changes: Partial<SyncState>): void {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  function readLog(): LoggedEvent[] {
    const stored = storage.getItem(keys.events);
    return stored === null ? [] : (JSON.parse(stored) as LoggedEvent[]);
  }

  function readReceived(): Event[] {
    const stored = storage.getItem(keys.received);
    return stored === null ? [] : (JSON.parse(stored) as Event[]);
  }

  // Keeps every received Event once, by eventId.
  function storeReceived(events: Event[]): Event[] {
    const known = new Set(state.received.map((e) => e.eventId));
    const received = [...state.received, ...events.filter((e) => !known.has(e.eventId))];
    storage.setItem(keys.received, JSON.stringify(received));
    return received;
  }

  // The Coordinator always sends the whole Incident, so it replaces the one with the same id, or is added.
  function replaceIncident(incident: Incident): Incident[] {
    const known = state.incidents.some((i) => i.incidentId === incident.incidentId);
    return known ? state.incidents.map((i) => (i.incidentId === incident.incidentId ? incident : i)) : [...state.incidents, incident];
  }

  // A new Coordinator epoch means the local data belongs to a Coordinator that no longer exists.
  // Clearing the Event log also restarts seq at 1.
  function clearStored(): void {
    storage.removeItem(keys.events);
    storage.removeItem(keys.received);
    storage.removeItem(keys.epoch);
    update({ log: [], received: [], incidents: [], error: null });
  }

  function send(message: DeviceMessage): void {
    socket?.send(message);
  }

  function handle(message: CoordinatorMessage): void {
    switch (message.type) {
      case "welcome":
        if (state.epoch !== null && state.epoch !== message.epoch) clearStored();
        storage.setItem(keys.epoch, message.epoch);
        welcomed = true;
        update({ online: connected, epoch: message.epoch, offset: message.offset });
        push(state.log.filter((e) => e.seq > message.offset));
        return;
      // A sync error stays through reconnects, since the bad event is pushed again, until an ack shows sync works.
      case "ack":
        update({ offset: Math.max(state.offset, message.upTo), error: null });
        return;
      case "snapshot":
        update({ incidents: message.incidents, received: storeReceived(message.events), snapshotReceived: true });
        return;
      case "incident":
        update({ incidents: replaceIncident(message.incident), received: storeReceived(message.events) });
        settleJoins(message.incident.incidentId, { ok: true });
        return;
      case "joinRejected":
        settleJoins(message.incidentId, { ok: false, reason: message.reason });
        return;
      case "pong":
        return;
      case "error":
        update({ error: message.reason });
        return;
    }
  }

  // Only after this socket's welcome, which says what is stored; a later welcome resends the rest.
  function push(items: LoggedEvent[]): void {
    if (welcomed && items.length > 0) send({ type: "push", items });
  }

  // The helper reports connected while the last pong is under 10 s old.
  function setConnected(value: boolean): void {
    connected = value;
    if (value) return update({ online: welcomed });
    // A Join without a reply may still have been committed; the snapshot after reconnect shows it if so.
    for (const incidentId of [...pendingJoins.keys()]) settleJoins(incidentId, { ok: false, reason: "offline" });
    update({ online: false, snapshotReceived: false });
  }

  return {
    start() {
      if (socket) return;
      socket = openReconnecting({
        url: options.url,
        createSocket: options.createSocket,
        onOpen() {
          welcomed = false;
          send({ type: "hello", deviceId, resourceId, epoch: state.epoch });
        },
        onMessage: (message) => handle(message as CoordinatorMessage),
        onConnectedChange: setConnected,
      });
    },
    stop() {
      socket?.close();
      socket = undefined;
    },
    record(event) {
      // Never at or below the Offset, which the Coordinator would skip as already stored.
      const logged: LoggedEvent = { seq: Math.max(state.log.at(-1)?.seq ?? 0, state.offset) + 1, event };
      const log = [...state.log, logged];
      storage.setItem(keys.events, JSON.stringify(log));
      update({ log });
      push([logged]);
    },
    join(incidentId) {
      if (!state.online) return Promise.resolve({ ok: false, reason: "offline" });
      return new Promise((resolve) => {
        pendingJoins.set(incidentId, [...(pendingJoins.get(incidentId) ?? []), resolve]);
        send({ type: "join", incidentId });
      });
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
