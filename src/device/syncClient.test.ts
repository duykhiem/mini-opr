import { afterEach, describe, expect, it } from "vitest";
import { startCoordinator, type Coordinator } from "../coordinator/coordinator.ts";
import { draftEvent } from "../shared/draftEvent.ts";
import type { Event } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import { deviceSocketPath } from "../shared/protocol.ts";
import type { WatchSnapshot } from "../shared/watch.ts";
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

async function postIncident(c: Coordinator, body: unknown): Promise<Incident> {
  const response = await fetch(`http://localhost:${c.port}/api/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return ((await response.json()) as { incident: Incident }).incident;
}

describe("Incidents on a Device", () => {
  it("gets a snapshot with the Incidents of its Resource, their legs and events, and no other", async () => {
    const c = await coordinator();
    const mine = await postIncident(c, { resourceId: "alpha-1", name: "Kari Nordmann", triage: "red" });
    await postIncident(c, { resourceId: "bravo-2", name: "Ola Nordmann" });

    const state = await waitFor(client(c), (s) => s.snapshotReceived);

    expect(state.incidents).toEqual([mine]);
    expect(state.received.map((e) => [e.incidentId, e.kind, e.source.type])).toEqual([
      [mine.incidentId, "fieldSet", "eoc"],
      [mine.incidentId, "fieldSet", "eoc"],
    ]);
  });

  it("gets an Incident the EOC creates for its Resource while it is connected, with its events", async () => {
    const c = await coordinator();
    const device = client(c);
    const other = client(c, { deviceId: "device-2", resourceId: "bravo-2" });
    await waitFor(device, (s) => s.snapshotReceived);
    await waitFor(other, (s) => s.snapshotReceived);

    const created = await postIncident(c, { resourceId: "alpha-1", name: "Kari Nordmann" });
    const state = await waitFor(device, (s) => s.incidents.length === 1);

    expect(state.incidents).toEqual([created]);
    expect(state.received).toEqual([expect.objectContaining({ incidentId: created.incidentId, field: "name", value: "Kari Nordmann" })]);
    expect(other.getState().incidents).toEqual([]);
  });
});

// A raw Device socket that hands out its messages one at a time, in arrival order.
function openDeviceSocket(c: Coordinator): { next(): Promise<unknown>; send(message: unknown): void; closed(): boolean } {
  const socket = new WebSocket(socketUrl(c));
  const received: unknown[] = [];
  let notify = () => {};
  socket.addEventListener("message", (e) => {
    received.push(JSON.parse(String(e.data)));
    notify();
  });
  const opened = new Promise((resolve) => socket.addEventListener("open", resolve));
  return {
    async next() {
      while (received.length === 0) await new Promise<void>((resolve) => (notify = resolve));
      return received.shift();
    },
    send: (message) => void opened.then(() => socket.send(JSON.stringify(message))),
    closed: () => socket.readyState !== WebSocket.OPEN,
  };
}

describe("Join", () => {
  it("opens an Active leg for the Resource and gives the joiner the full history", async () => {
    const c = await coordinator();
    const created = await postIncident(c, { resourceId: "alpha-1", name: "Kari Nordmann", triage: "orange" });
    const joiner = client(c, { deviceId: "device-2", resourceId: "bravo-2" });
    await waitFor(joiner, (s) => s.online && s.snapshotReceived);

    const result = await joiner.join(created.incidentId);

    expect(result).toEqual({ ok: true });
    const [incident] = joiner.getState().incidents;
    expect(incident?.incidentId).toBe(created.incidentId);
    expect(incident?.closed).toBe(false);
    expect(incident?.legs.map((l) => [l.resourceId, l.completedAt])).toEqual([
      ["alpha-1", null],
      ["bravo-2", null],
    ]);
    expect(joiner.getState().received.map((e) => [e.kind, e.source.type])).toEqual([
      ["fieldSet", "eoc"],
      ["fieldSet", "eoc"],
    ]);
  });

  it("shows the new leg on a Device of a Resource that already works on the Incident", async () => {
    const c = await coordinator();
    const created = await postIncident(c, { resourceId: "alpha-1" });
    const earlier = client(c);
    const bystander = client(c, { deviceId: "device-3", resourceId: "charlie-3" });
    const joiner = client(c, { deviceId: "device-2", resourceId: "bravo-2" });
    await waitFor(earlier, (s) => s.snapshotReceived);
    await waitFor(bystander, (s) => s.snapshotReceived);
    await waitFor(joiner, (s) => s.online && s.snapshotReceived);

    await joiner.join(created.incidentId);
    const state = await waitFor(earlier, (s) => s.incidents[0]?.legs.length === 2);

    expect(state.incidents[0]?.legs.map((l) => l.resourceId)).toEqual(["alpha-1", "bravo-2"]);
    expect(bystander.getState().incidents).toEqual([]);
  });

  it("lets a Resource Join an Incident again while it holds an Active leg there", async () => {
    const c = await coordinator();
    const created = await postIncident(c, { resourceId: "alpha-1" });
    const device = client(c);
    await waitFor(device, (s) => s.online && s.snapshotReceived);

    expect(await device.join(created.incidentId)).toEqual({ ok: true });

    expect(device.getState().incidents[0]?.legs.map((l) => [l.resourceId, l.completedAt])).toEqual([
      ["alpha-1", null],
      ["alpha-1", null],
    ]);
  });

  it("answers an unknown Incident id with joinRejected and keeps the socket open", async () => {
    const c = await coordinator();
    const device = openDeviceSocket(c);
    device.send({ type: "hello", deviceId: "device-1", resourceId: "alpha-1", epoch: null });
    expect(await device.next()).toMatchObject({ type: "welcome" });
    expect(await device.next()).toMatchObject({ type: "snapshot" });

    device.send({ type: "join", incidentId: "INC-9999" });

    expect(await device.next()).toEqual({ type: "joinRejected", incidentId: "INC-9999", reason: "unknown" });
    device.send({ type: "ping" });
    expect(await device.next()).toEqual({ type: "pong" });
    expect(device.closed()).toBe(false);
  });

  it("reports an unknown Incident id to the caller", async () => {
    const c = await coordinator();
    const device = client(c);
    await waitFor(device, (s) => s.online && s.snapshotReceived);

    expect(await device.join("INC-9999")).toEqual({ ok: false, reason: "unknown" });
    expect(device.getState().online).toBe(true);
  });

  it("fails at once with offline and sends nothing when the Device is not online", async () => {
    const c = await coordinator();
    const created = await postIncident(c, { resourceId: "bravo-2" });
    const device = client(c);

    expect(device.getState().online).toBe(false);
    expect(await device.join(created.incidentId)).toEqual({ ok: false, reason: "offline" });

    const state = await waitFor(device, (s) => s.online && s.snapshotReceived);
    expect(state.incidents).toEqual([]);
  });

  it("fails with offline when the socket closes before a reply", async () => {
    const c = await coordinator();
    const device = client(c);
    await waitFor(device, (s) => s.online && s.snapshotReceived);

    const result = device.join("INC-0001");
    device.stop();

    expect(await result).toEqual({ ok: false, reason: "offline" });
  });
});

type DeviceIdentity = { deviceId: string; resourceId: string };

const device1: DeviceIdentity = { deviceId: "device-1", resourceId: "alpha-1" };
const bravo: DeviceIdentity = { deviceId: "device-2", resourceId: "bravo-2" };

// A note by the Device under its Resource's latest Transfer leg in the Incident, unless a legId is given.
function noteBy(device: DeviceIdentity, incident: Incident, text: string, legId?: string): Event {
  const result = draftEvent(
    { kind: "noteAdded", text },
    incident,
    { ...device, legId: legId ?? incident.legs.findLast((l) => l.resourceId === device.resourceId)!.legId },
    Date.now,
  );
  if ("error" in result) throw new Error(result.error);
  return result;
}

const note = (incident: Incident, text: string, legId?: string) => noteBy(device1, incident, text, legId);

describe("Uploading the Event log", () => {
  it("writes an Event to the Event log with the next seq, pushes it and moves the Offset on ack", async () => {
    const c = await coordinator();
    const incident = await postIncident(c, { resourceId: "alpha-1" });
    const storage = memoryStorage();
    const device = client(c, { storage });
    await waitFor(device, (s) => s.online && s.snapshotReceived);

    device.record(note(incident, "Breathing normally"));
    device.record(note(incident, "Alert"));

    expect(device.getState().log.map((e) => e.seq)).toEqual([1, 2]);
    expect(JSON.parse(storage.getItem("opr:device-1:events")!)).toHaveLength(2);
    await waitFor(device, (s) => s.offset === 2);
    expect(c.listDevices()).toEqual([{ deviceId: "device-1", resourceId: "alpha-1", offset: 2 }]);
  });

  it("after a reconnect pushes only what is above the Offset, so nothing is stored twice", async () => {
    const c = await coordinator();
    const incident = await postIncident(c, { resourceId: "alpha-1" });
    const device = client(c);
    await waitFor(device, (s) => s.online);
    device.record(note(incident, "Breathing normally"));
    await waitFor(device, (s) => s.offset === 1);

    c.closeDeviceSockets();
    await waitFor(device, (s) => !s.online);
    device.record(note(incident, "Alert"));
    expect(device.getState().offset).toBe(1);

    await waitFor(device, (s) => s.online && s.offset === 2);
    expect((await watchSnapshot(c)).events.map((e) => [e.deviceId, e.seq])).toEqual([
      ["device-1", 1],
      ["device-1", 2],
    ]);
  });

  it("shows a sync error for a bad event and keeps reconnecting", async () => {
    const c = await coordinator();
    const incident = await postIncident(c, { resourceId: "alpha-1" });
    const device = client(c);
    await waitFor(device, (s) => s.online);

    device.record(note(incident, "Wrong leg", "not-a-leg"));

    await waitFor(device, (s) => s.error !== null);
    await waitFor(device, (s) => !s.online);
    const state = await waitFor(device, (s) => s.online);
    expect(state.error).toMatch(/legId not-a-leg/);
    expect(state.offset).toBe(0);
  });
});

// A legCompleted by the Device for its Resource's latest Transfer leg in the Incident.
function completion(incident: Incident, device: { deviceId: string; resourceId: string }): Event {
  const legId = incident.legs.findLast((l) => l.resourceId === device.resourceId)!.legId;
  const result = draftEvent({ kind: "legCompleted" }, incident, { ...device, legId }, Date.now);
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("Completing a Transfer leg", () => {
  it("closes the Incident on every connected Device with a leg in it once no leg is Active", async () => {
    const c = await coordinator();
    const created = await postIncident(c, { resourceId: "alpha-1" });
    const first = client(c);
    const second = client(c, { deviceId: "device-2", resourceId: "bravo-2" });
    const bystander = client(c, { deviceId: "device-3", resourceId: "charlie-3" });
    await waitFor(first, (s) => s.online && s.snapshotReceived);
    await waitFor(second, (s) => s.online && s.snapshotReceived);
    await waitFor(bystander, (s) => s.online && s.snapshotReceived);
    await second.join(created.incidentId);
    const joined = second.getState().incidents[0]!;

    // Handover: the earlier Resource completes its leg; the Incident stays Active on both.
    first.record(completion(joined, { deviceId: "device-1", resourceId: "alpha-1" }));
    const handedOver = await waitFor(second, (s) => s.incidents[0]?.legs[0]?.completedAt !== null);
    expect(handedOver.incidents[0]?.closed).toBe(false);

    const last = completion(joined, { deviceId: "device-2", resourceId: "bravo-2" });
    second.record(last);

    for (const device of [first, second]) {
      const state = await waitFor(device, (s) => s.incidents[0]?.closed === true);
      expect(state.incidents[0]?.legs.map((l) => [l.resourceId, l.completedAt !== null])).toEqual([
        ["alpha-1", true],
        ["bravo-2", true],
      ]);
      expect(state.incidents[0]?.legs[1]?.completedAt).toBe(last.enteredAt);
    }
    expect(bystander.getState().incidents).toEqual([]);
  });

  it("reopens a Closed Incident on a Join", async () => {
    const c = await coordinator();
    const created = await postIncident(c, { resourceId: "alpha-1" });
    const earlier = client(c);
    const joiner = client(c, { deviceId: "device-2", resourceId: "bravo-2" });
    await waitFor(earlier, (s) => s.online && s.snapshotReceived);
    await waitFor(joiner, (s) => s.online && s.snapshotReceived);
    earlier.record(completion(created, { deviceId: "device-1", resourceId: "alpha-1" }));
    await waitFor(earlier, (s) => s.incidents[0]?.closed === true);

    expect(await joiner.join(created.incidentId)).toEqual({ ok: true });

    expect(joiner.getState().incidents[0]?.closed).toBe(false);
    const state = await waitFor(earlier, (s) => s.incidents[0]?.legs.length === 2);
    expect(state.incidents[0]?.closed).toBe(false);
  });
});

async function watchSnapshot(c: Coordinator): Promise<WatchSnapshot> {
  const socket = new WebSocket(`ws://localhost:${c.port}/watch`);
  const message = await new Promise<WatchSnapshot>((resolve) => (socket.onmessage = (e) => resolve(JSON.parse(String(e.data)))));
  socket.close();
  return message;
}

describe("Realtime fan-out", () => {
  it("sends a stored event to another Device of the same Resource, and not back to the sender", async () => {
    const c = await coordinator();
    const incident = await postIncident(c, { resourceId: "alpha-1" });
    const sender = client(c, { deviceId: "device-1" });
    const otherStorage = memoryStorage();
    const other = client(c, { deviceId: "device-2", storage: otherStorage });
    await waitFor(sender, (s) => s.online);
    await waitFor(other, (s) => s.online);
    const event = note(incident, "Breathing normally");

    sender.record(event);

    await waitFor(other, (s) => s.received.some((e) => e.eventId === event.eventId));
    expect(JSON.parse(otherStorage.getItem("opr:device-2:received")!)).toContainEqual(event);
    // One more round trip, so an echo of the first event would have arrived by now.
    sender.record(note(incident, "Alert"));
    await waitFor(sender, (s) => s.offset === 2);
    expect(sender.getState().received.map((e) => e.eventId)).not.toContain(event.eventId);
  });

  it("sends nothing to a Resource with no Transfer leg in the Incident, and after a Join fans out both ways", async () => {
    const c = await coordinator();
    const incident = await postIncident(c, { resourceId: "alpha-1" });
    const alpha = client(c, { deviceId: "device-1", resourceId: "alpha-1" });
    const bravoDevice = client(c, bravo);
    await waitFor(alpha, (s) => s.online);
    await waitFor(bravoDevice, (s) => s.online);
    // Anything fanned out to bravo before its Join would land while it has no Incident.
    let receivedWithoutIncident = false;
    bravoDevice.subscribe(() => {
      const s = bravoDevice.getState();
      if (s.incidents.length === 0 && s.received.length > 0) receivedWithoutIncident = true;
    });

    const before = note(incident, "Before the Join");
    alpha.record(before);
    await waitFor(alpha, (s) => s.offset === 1);
    expect(await bravoDevice.join(incident.incidentId)).toEqual({ ok: true });
    expect(receivedWithoutIncident).toBe(false);

    const joined = bravoDevice.getState().incidents[0]!;
    const fromBravo = noteBy(bravo, joined, "Handover received");
    bravoDevice.record(fromBravo);
    await waitFor(alpha, (s) => s.received.some((e) => e.eventId === fromBravo.eventId));
    // The earlier Resource can still edit the Patient.
    const fromAlpha = note(joined, "Leaving the scene");
    alpha.record(fromAlpha);
    await waitFor(bravoDevice, (s) => s.received.some((e) => e.eventId === fromAlpha.eventId));
  });
});
