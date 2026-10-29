import { afterEach, describe, expect, it } from "vitest";
import { startCoordinator, type Coordinator } from "../coordinator/coordinator.ts";
import { deviceSocketPath } from "../shared/protocol.ts";
import { createSyncClient, type KeyValueStore, type SyncClient, type SyncState } from "./syncClient.ts";
import { memoryStorage } from "./memoryStorage.ts";

const coordinators: Coordinator[] = [];
const clients: SyncClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  await Promise.all(coordinators.splice(0).map((c) => c.close()));
});

async function coordinator(): Promise<Coordinator> {
  const c = await startCoordinator({ dbPath: ":memory:", port: 0 });
  coordinators.push(c);
  return c;
}

function client(c: Coordinator, options: { deviceId?: string; resourceId?: string; storage?: KeyValueStore } = {}): SyncClient {
  const created = createSyncClient({
    url: socketUrl(c),
    deviceId: options.deviceId ?? "device-1",
    resourceId: options.resourceId ?? "alpha-1",
    storage: options.storage ?? memoryStorage(),
    createSocket: (url) => new WebSocket(url),
  });
  clients.push(created);
  created.start();
  return created;
}

function socketUrl(c: Coordinator): string {
  return `ws://localhost:${c.port}${deviceSocketPath}`;
}

// Sends raw messages on a Device socket and collects the replies until the Coordinator closes it.
async function exchange(c: Coordinator, messages: unknown[]): Promise<unknown[]> {
  const socket = new WebSocket(socketUrl(c));
  const replies: unknown[] = [];
  socket.onmessage = (e) => replies.push(JSON.parse(String(e.data)));
  socket.onopen = () => messages.forEach((m) => socket.send(JSON.stringify(m)));
  await new Promise((resolve) => (socket.onclose = resolve));
  return replies;
}

function waitFor(c: SyncClient, predicate: (state: SyncState) => boolean): Promise<SyncState> {
  return new Promise((resolve) => {
    const check = () => {
      const state = c.getState();
      if (!predicate(state)) return;
      unsubscribe();
      resolve(state);
    };
    const unsubscribe = c.subscribe(check);
    check();
  });
}

describe("Device sync", () => {
  it("gets a welcome with offset 0 and an empty snapshot on hello", async () => {
    const c = await coordinator();
    const device = client(c);

    const state = await waitFor(device, (s) => s.online && s.snapshotReceived);

    expect(state.epoch).toBe(c.epoch);
    expect(state.offset).toBe(0);
    expect(state.incidents).toEqual([]);
    expect(state.received).toEqual([]);
  });

  it("registers the Device on hello", async () => {
    const c = await coordinator();
    const device = client(c, { deviceId: "device-7", resourceId: "bravo-2" });

    await waitFor(device, (s) => s.online);

    expect(c.listDevices()).toEqual([{ deviceId: "device-7", resourceId: "bravo-2", offset: 0 }]);
  });

  it("answers a hello with an unknown resourceId with error, then close", async () => {
    const c = await coordinator();

    const replies = await exchange(c, [{ type: "hello", deviceId: "device-1", resourceId: "zulu-9", epoch: null }]);

    expect(replies).toEqual([{ type: "error", seq: null, reason: "unknown resourceId zulu-9" }]);
    expect(c.listDevices()).toEqual([]);
  });

  it.each([
    ["null", [null]],
    ["a hello without deviceId", [{ type: "hello", resourceId: "alpha-1", epoch: null }]],
    ["an unknown message type", [{ type: "hello", deviceId: "device-1", resourceId: "alpha-1", epoch: null }, { type: "bogus" }]],
  ])("answers %s with error, then close", async (_name, messages) => {
    const c = await coordinator();

    const replies = await exchange(c, messages);

    expect(replies.at(-1)).toMatchObject({ type: "error", seq: null });
  });

  it("saves the epoch it receives when it has none stored", async () => {
    const c = await coordinator();
    const storage = memoryStorage();

    await waitFor(client(c, { storage }), (s) => s.online);

    expect(storage.getItem("opr:device-1:epoch")).toBe(c.epoch);
  });

  it("clears its stored data and keeps its deviceId when the Coordinator epoch has changed", async () => {
    const c = await coordinator();
    const storage = memoryStorage();
    const oldEvent = {
      eventId: "019a-0001",
      enteredAt: 1000,
      incidentId: "INC-0001",
      patientId: "patient-1",
      source: { type: "eoc" },
      kind: "noteAdded",
      text: "From a Coordinator that no longer exists",
    };
    storage.setItem("device:alpha-1", "device-1");
    storage.setItem("opr:device-1:epoch", "old-epoch");
    storage.setItem("opr:device-1:events", JSON.stringify([{ seq: 1, event: oldEvent }]));
    storage.setItem("opr:device-1:received", JSON.stringify([oldEvent]));

    const device = client(c, { storage });
    expect(device.getState().received).toHaveLength(1);
    const state = await waitFor(device, (s) => s.snapshotReceived);

    expect(state.received).toEqual([]);
    expect(storage.getItem("opr:device-1:events")).toBeNull();
    expect(storage.getItem("opr:device-1:received")).toBe("[]");
    expect(storage.getItem("opr:device-1:epoch")).toBe(c.epoch);
    expect(storage.getItem("device:alpha-1")).toBe("device-1");
  });

  it("reconnects after the Coordinator closes its socket", async () => {
    const c = await coordinator();
    const device = client(c);
    await waitFor(device, (s) => s.online);

    c.closeDeviceSockets();
    await waitFor(device, (s) => !s.online);
    const state = await waitFor(device, (s) => s.online && s.snapshotReceived);

    expect(state.epoch).toBe(c.epoch);
  });

  it("is disconnected by a Reset, reconnects, clears itself and gets the new epoch with Offset 0", async () => {
    const c = await coordinator();
    await fetch(`http://localhost:${c.port}/api/incidents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId: "alpha-1", name: "Kari Nordmann" }),
    });
    const storage = memoryStorage();
    const device = client(c, { storage });
    const before = await waitFor(device, (s) => s.online && s.snapshotReceived);
    expect(before.incidents).toHaveLength(1);
    expect(before.received).toHaveLength(1);
    const oldEpoch = before.epoch;

    const response = await fetch(`http://localhost:${c.port}/api/reset`, { method: "POST" });
    expect(response.status).toBe(200);
    await waitFor(device, (s) => !s.online);
    const state = await waitFor(device, (s) => s.online && s.snapshotReceived && s.epoch !== oldEpoch);

    expect(state.epoch).toBe(c.epoch);
    expect(state.offset).toBe(0);
    expect(state.incidents).toEqual([]);
    expect(state.received).toEqual([]);
    expect(storage.getItem("opr:device-1:epoch")).toBe(c.epoch);
    expect(c.listDevices()).toEqual([{ deviceId: "device-1", resourceId: "alpha-1", offset: 0 }]);
  });
});
