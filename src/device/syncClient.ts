import type { Event } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import type { CoordinatorMessage, DeviceMessage } from "../shared/protocol.ts";

// The part of localStorage the client uses, so tests can pass an in-memory one.
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SyncState = {
  online: boolean;
  epoch: string | null;
  offset: number;
  snapshotReceived: boolean;
  incidents: Incident[];
  received: Event[];
  error: string | null;
};

export type SyncClient = {
  start(): void;
  stop(): void;
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

const pingIntervalMs = 5000;
const pongTimeoutMs = 10_000;
const backoffMs = [500, 1000, 2000, 4000, 5000];

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
    snapshotReceived: false,
    incidents: [],
    received: readReceived(),
    error: null,
  };

  let socket: WebSocket | undefined;
  let stopped = true;
  let attempt = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function update(changes: Partial<SyncState>): void {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
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

  // A new Coordinator epoch means the local data belongs to a Coordinator that no longer exists.
  // Clearing the Event log also restarts seq at 1.
  function clearStored(): void {
    storage.removeItem(keys.events);
    storage.removeItem(keys.received);
    storage.removeItem(keys.epoch);
    update({ received: [], incidents: [] });
  }

  function send(message: DeviceMessage): void {
    socket?.send(JSON.stringify(message));
  }

  function handle(message: CoordinatorMessage): void {
    switch (message.type) {
      case "welcome":
        if (state.epoch !== null && state.epoch !== message.epoch) clearStored();
        storage.setItem(keys.epoch, message.epoch);
        attempt = 0;
        awaitPong();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => send({ type: "ping" }), pingIntervalMs);
        update({ online: true, epoch: message.epoch, offset: message.offset, error: null });
        return;
      case "snapshot":
        update({ incidents: message.incidents, received: storeReceived(message.events), snapshotReceived: true });
        return;
      case "pong":
        awaitPong();
        return;
      case "error":
        update({ error: message.reason });
        return;
    }
  }

  // Online needs a pong under 10 s old (ADR 0005), so the timer restarts on welcome and on every pong.
  function awaitPong(): void {
    clearTimeout(pongTimer);
    pongTimer = setTimeout(dropSocket, pongTimeoutMs);
  }

  // Goes offline at once, without waiting for a close handshake that may never finish.
  function dropSocket(): void {
    const current = socket;
    if (current === undefined) return;
    current.onclose = null;
    current.onmessage = null;
    current.close();
    disconnected();
  }

  function disconnected(): void {
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    socket = undefined;
    update({ online: false, snapshotReceived: false });
    if (stopped) return;
    const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    const current = options.createSocket(options.url);
    socket = current;
    current.onopen = () => send({ type: "hello", deviceId, resourceId, epoch: state.epoch });
    current.onmessage = (e) => handle(JSON.parse(String(e.data)) as CoordinatorMessage);
    current.onclose = () => {
      if (socket === current) disconnected();
    };
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      dropSocket();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
