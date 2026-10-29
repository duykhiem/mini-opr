import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import type { EventBody } from "../shared/draftEvent.ts";
import { triages, type Event } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import { applyEvent, emptyPatient } from "../shared/patient.ts";
import { deviceSocketPath, type CoordinatorMessage } from "../shared/protocol.ts";
import { uuidv7 } from "../shared/uuidv7.ts";
import type { WatchMessage } from "../shared/watch.ts";
import { startCoordinator, type Coordinator } from "./coordinator.ts";

const started: Coordinator[] = [];

async function start(dbPath: string): Promise<Coordinator> {
  const coordinator = await startCoordinator({ dbPath, port: 0 });
  started.push(coordinator);
  return coordinator;
}

async function closeAll(): Promise<void> {
  await Promise.all(started.splice(0).map((c) => c.close()));
}

afterEach(closeAll);

describe("Coordinator", () => {
  it("serves the seeded Resources over HTTP", async () => {
    const coordinator = await start(":memory:");

    const response = await fetch(`http://localhost:${coordinator.port}/api/resources`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { resourceId: "alpha-1", name: "Alpha 1" },
      { resourceId: "bravo-2", name: "Bravo 2" },
      { resourceId: "charlie-3", name: "Charlie 3" },
    ]);
  });

  // A restart needs a file; :memory: does not survive close (ADR 0007).
  it("keeps its Coordinator epoch and its data across a plain restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-opr-"));
    try {
      const dbPath = join(dir, "coordinator.sqlite");
      const first = await start(dbPath);
      const created = await postIncident(first, { resourceId: "alpha-1", name: "Kari Nordmann" });
      const { incident } = (await created.json()) as { incident: Incident };
      const epoch = first.epoch;
      await first.close();

      const second = await start(dbPath);

      expect(epoch).not.toBe("");
      expect(second.epoch).toBe(epoch);
      const snapshot = await openWatchSocket(second).next();
      expect(snapshot).toMatchObject({ type: "snapshot", epoch, incidents: [incident] });
      expect((snapshot as Extract<WatchMessage, { type: "snapshot" }>).events).toHaveLength(1);
      expect((await start(":memory:")).epoch).not.toBe(epoch);
    } finally {
      await closeAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function postIncident(coordinator: Coordinator, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${coordinator.port}/api/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Creating an Incident", () => {
  it("returns 201 with the first Transfer leg and the given Patient fields in the projection", async () => {
    const coordinator = await start(":memory:");

    const response = await postIncident(coordinator, {
      resourceId: "bravo-2",
      name: "Kari Nordmann",
      dob: "1970-01-31",
      triage: "red",
    });

    expect(response.status).toBe(201);
    const { incident } = (await response.json()) as { incident: Incident };
    expect(incident.closed).toBe(false);
    expect(incident.legs).toEqual([expect.objectContaining({ resourceId: "bravo-2", completedAt: null })]);
    expect(incident.patient.name?.value).toBe("Kari Nordmann");
    expect(incident.patient.dob?.value).toBe("1970-01-31");
    expect(incident.patient.triage?.value).toBe("red");
  });

  it("returns an empty Patient when no fields are given", async () => {
    const coordinator = await start(":memory:");

    const response = await postIncident(coordinator, { resourceId: "alpha-1" });

    expect(response.status).toBe(201);
    const { incident } = (await response.json()) as { incident: Incident };
    expect(incident.patient).toEqual({ vitals: [], notes: [] });
  });

  it("gives each Incident a distinct INC- id", async () => {
    const coordinator = await start(":memory:");

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await postIncident(coordinator, { resourceId: "alpha-1" });
      ids.push(((await response.json()) as { incident: Incident }).incident.incidentId);
    }

    for (const id of ids) expect(id).toMatch(/^INC-\d+$/);
    expect(new Set(ids).size).toBe(3);
  });

  it.each([
    ["an unknown resourceId", { resourceId: "zulu-9" }],
    ["no resourceId", { name: "Kari Nordmann" }],
    ["a blank name", { resourceId: "alpha-1", name: "  " }],
    ["a dob that is not YYYY-MM-DD", { resourceId: "alpha-1", dob: "31.01.1970" }],
    ["a dob that is not a real date", { resourceId: "alpha-1", dob: "1970-02-30" }],
    ["an unknown triage", { resourceId: "alpha-1", triage: "purple" }],
    ["a body that is not an object", ["alpha-1"]],
  ])("returns 400 and creates nothing for %s", async (_, body) => {
    const coordinator = await start(":memory:");

    const response = await postIncident(coordinator, body);

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toEqual(expect.any(String));
    const after = await postIncident(coordinator, { resourceId: "alpha-1" });
    expect(((await after.json()) as { incident: Incident }).incident.incidentId).toBe("INC-0001");
  });
});

// A raw /watch socket that hands out its messages one at a time, in arrival order.
function openWatchSocket(coordinator: Coordinator): { next(): Promise<WatchMessage>; send(message: unknown): void } {
  const socket = new WebSocket(`ws://localhost:${coordinator.port}/watch`);
  const received: WatchMessage[] = [];
  let notify = () => {};
  socket.addEventListener("message", (e) => {
    received.push(JSON.parse(String(e.data)) as WatchMessage);
    notify();
  });
  const opened = new Promise((resolve) => socket.addEventListener("open", resolve));
  return {
    async next() {
      while (received.length === 0) await new Promise<void>((resolve) => (notify = resolve));
      return received.shift()!;
    },
    send: (message) => void opened.then(() => socket.send(JSON.stringify(message))),
  };
}

// A raw Device socket that sends hello once open.
function openDeviceSocket(coordinator: Coordinator, device: { deviceId: string; resourceId: string }): WebSocket {
  const socket = new WebSocket(`ws://localhost:${coordinator.port}${deviceSocketPath}`);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "hello", ...device, epoch: null })));
  return socket;
}

describe("The /watch socket", () => {
  it("sends a snapshot with the Incidents and their stored EOC events on connect", async () => {
    const coordinator = await start(":memory:");
    const created = await postIncident(coordinator, { resourceId: "alpha-1", name: "Kari Nordmann", triage: "yellow" });
    const { incident } = (await created.json()) as { incident: Incident };

    const message = await openWatchSocket(coordinator).next();

    expect(message).toMatchObject({ type: "snapshot", epoch: coordinator.epoch, incidents: [incident], devices: [] });
    const { events } = message as Extract<WatchMessage, { type: "snapshot" }>;
    expect(events.map((e) => [e.deviceId, e.seq, e.event.source.type, e.event.incidentId])).toEqual([
      [null, null, "eoc", incident.incidentId],
      [null, null, "eoc", incident.incidentId],
    ]);
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "fieldSet", field: "name", value: "Kari Nordmann", patientId: incident.patientId }),
        expect.objectContaining({ kind: "fieldSet", field: "triage", value: "yellow", patientId: incident.patientId }),
      ]),
    );
    expect(events[0]!.rowid).toBeLessThan(events[1]!.rowid);
  });

  it("sends the whole Incident, then its EOC events, after a create", async () => {
    const coordinator = await start(":memory:");
    const watch = openWatchSocket(coordinator);
    expect(await watch.next()).toMatchObject({ type: "snapshot", incidents: [], events: [] });

    const created = await postIncident(coordinator, { resourceId: "charlie-3", dob: "1985-06-15" });
    const { incident } = (await created.json()) as { incident: Incident };

    expect(await watch.next()).toEqual({ type: "incident", incident });
    const events = await watch.next();
    expect(events).toMatchObject({
      type: "events",
      events: [{ deviceId: null, seq: null, event: { kind: "fieldSet", field: "dob", value: "1985-06-15", source: { type: "eoc" } } }],
    });
  });

  it("sends the Device as connected after its hello", async () => {
    const coordinator = await start(":memory:");
    const watch = openWatchSocket(coordinator);
    await watch.next();

    openDeviceSocket(coordinator, { deviceId: "device-1", resourceId: "alpha-1" });

    expect(await watch.next()).toEqual({ type: "device", deviceId: "device-1", resourceId: "alpha-1", offset: 0, connected: true });
  });

  it("sends the Device as disconnected after its socket closes", async () => {
    const coordinator = await start(":memory:");
    const watch = openWatchSocket(coordinator);
    await watch.next();
    const device = openDeviceSocket(coordinator, { deviceId: "device-1", resourceId: "bravo-2" });
    expect(await watch.next()).toMatchObject({ type: "device", connected: true });

    device.close();

    expect(await watch.next()).toEqual({ type: "device", deviceId: "device-1", resourceId: "bravo-2", offset: 0, connected: false });
  });

  it("lists a Device that has sent nothing in the snapshot, with Offset 0", async () => {
    const coordinator = await start(":memory:");
    const first = openWatchSocket(coordinator);
    await first.next();
    openDeviceSocket(coordinator, { deviceId: "device-1", resourceId: "charlie-3" });
    await first.next();

    const message = await openWatchSocket(coordinator).next();

    expect(message).toMatchObject({
      type: "snapshot",
      devices: [{ deviceId: "device-1", resourceId: "charlie-3", offset: 0, connected: true }],
    });
  });

  it("sends the snapshot events in rowid order, with no deviceId or seq for EOC events", async () => {
    const coordinator = await start(":memory:");
    await postIncident(coordinator, { resourceId: "alpha-1", name: "Kari Nordmann", triage: "red" });
    await postIncident(coordinator, { resourceId: "bravo-2", dob: "1985-06-15" });

    const { events } = (await openWatchSocket(coordinator).next()) as Extract<WatchMessage, { type: "snapshot" }>;

    // Stored as name, then triage, then the second Incident's dob.
    expect(events.map((e) => [e.event.incidentId, e.event.kind === "fieldSet" && e.event.field, e.deviceId, e.seq])).toEqual([
      ["INC-0001", "name", null, null],
      ["INC-0001", "triage", null, null],
      ["INC-0002", "dob", null, null],
    ]);
    const [a, b, c] = events.map((e) => e.rowid);
    expect(a).toBeLessThan(b!);
    expect(b).toBeLessThan(c!);
  });

  it("sends the whole Incident with its new leg after a Join", async () => {
    const coordinator = await start(":memory:");
    const created = await postIncident(coordinator, { resourceId: "alpha-1" });
    const { incident } = (await created.json()) as { incident: Incident };
    const watch = openWatchSocket(coordinator);
    expect(await watch.next()).toMatchObject({ type: "snapshot", incidents: [incident] });

    const device = new WebSocket(`ws://localhost:${coordinator.port}${deviceSocketPath}`);
    device.addEventListener("open", () => {
      device.send(JSON.stringify({ type: "hello", deviceId: "device-2", resourceId: "bravo-2", epoch: null }));
      device.send(JSON.stringify({ type: "join", incidentId: incident.incidentId }));
    });

    // The hello is reported first (ADR 0008).
    expect(await watch.next()).toMatchObject({ type: "device", deviceId: "device-2", connected: true });
    const message = await watch.next();
    expect(message).toEqual({
      type: "incident",
      incident: {
        ...incident,
        legs: [incident.legs[0], { legId: expect.any(String), resourceId: "bravo-2", createdAt: expect.any(Number), completedAt: null }],
      },
    });
    device.close();
  });

  it("answers a ping with a pong", async () => {
    const coordinator = await start(":memory:");
    const watch = openWatchSocket(coordinator);
    await watch.next();

    watch.send({ type: "ping" });

    expect(await watch.next()).toEqual({ type: "pong" });
  });
});

function postReset(coordinator: Coordinator): Promise<Response> {
  return fetch(`http://localhost:${coordinator.port}/api/reset`, { method: "POST" });
}

describe("Reset", () => {
  it("returns 200 and sends an empty snapshot with a new epoch on an open /watch socket", async () => {
    const coordinator = await start(":memory:");
    await postIncident(coordinator, { resourceId: "alpha-1", name: "Kari Nordmann" });
    const watch = openWatchSocket(coordinator);
    const before = await watch.next();
    expect(before).toMatchObject({ type: "snapshot", incidents: [expect.anything()] });
    const oldEpoch = coordinator.epoch;

    const response = await postReset(coordinator);

    expect(response.status).toBe(200);
    const after = await watch.next();
    expect(after).toEqual({ type: "snapshot", epoch: coordinator.epoch, incidents: [], events: [], devices: [] });
    expect(coordinator.epoch).not.toBe(oldEpoch);
    // The socket stays open: it still answers a ping.
    watch.send({ type: "ping" });
    expect(await watch.next()).toEqual({ type: "pong" });
  });

  it("keeps only the Resources: Incidents, Events and Devices are gone and ids start over", async () => {
    const coordinator = await start(":memory:");
    await postIncident(coordinator, { resourceId: "alpha-1", name: "Kari Nordmann" });
    await postIncident(coordinator, { resourceId: "bravo-2", triage: "red" });
    const device = new WebSocket(`ws://localhost:${coordinator.port}${deviceSocketPath}`);
    device.addEventListener("open", () => device.send(JSON.stringify({ type: "hello", deviceId: "device-1", resourceId: "alpha-1", epoch: null })));
    await new Promise((resolve) => device.addEventListener("message", resolve, { once: true }));
    expect(coordinator.listDevices()).toHaveLength(1);

    await postReset(coordinator);

    expect(coordinator.listDevices()).toEqual([]);
    expect(await openWatchSocket(coordinator).next()).toEqual({
      type: "snapshot",
      epoch: coordinator.epoch,
      incidents: [],
      events: [],
      devices: [],
    });
    const resources = await fetch(`http://localhost:${coordinator.port}/api/resources`);
    expect(((await resources.json()) as { resourceId: string }[]).map((r) => r.resourceId)).toEqual(["alpha-1", "bravo-2", "charlie-3"]);
    const created = await postIncident(coordinator, { resourceId: "charlie-3" });
    expect(((await created.json()) as { incident: Incident }).incident.incidentId).toBe("INC-0001");
  });
});

type DeviceIdentity = { deviceId: string; resourceId: string };

const alpha: DeviceIdentity = { deviceId: "device-1", resourceId: "alpha-1" };

async function createIncidentFor(coordinator: Coordinator, resourceId: string): Promise<Incident> {
  const created = await postIncident(coordinator, { resourceId });
  return ((await created.json()) as { incident: Incident }).incident;
}

// An Event by the Device under the Resource's latest Transfer leg in the Incident.
function eventBy(device: DeviceIdentity, incident: Incident, body: EventBody): Event {
  const leg = incident.legs.findLast((l) => l.resourceId === device.resourceId)!;
  const enteredAt = Date.now();
  return {
    ...body,
    eventId: uuidv7(enteredAt),
    enteredAt,
    incidentId: incident.incidentId,
    patientId: incident.patientId,
    source: { type: "device", ...device, legId: leg.legId },
  };
}

const noteBy = (device: DeviceIdentity, incident: Incident, text: string) => eventBy(device, incident, { kind: "noteAdded", text });

// A raw Device socket past its welcome and snapshot: hands out later replies in arrival order.
async function connectDevice(coordinator: Coordinator, device: DeviceIdentity) {
  const socket = openDeviceSocket(coordinator, device);
  const received: CoordinatorMessage[] = [];
  let notify = () => {};
  socket.addEventListener("message", (e) => {
    received.push(JSON.parse(String(e.data)) as CoordinatorMessage);
    notify();
  });
  const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve()));
  async function next(): Promise<CoordinatorMessage> {
    while (received.length === 0) await new Promise<void>((resolve) => (notify = resolve));
    return received.shift()!;
  }
  expect(await next()).toMatchObject({ type: "welcome" });
  expect(await next()).toMatchObject({ type: "snapshot" });
  return {
    next,
    closed,
    push: (items: { seq: number; event: unknown }[]) => socket.send(JSON.stringify({ type: "push", items })),
  };
}

describe("Push", () => {
  it("stores a batch, moves the Offset and acks up to its last seq", async () => {
    const coordinator = await start(":memory:");
    const incident = await createIncidentFor(coordinator, "alpha-1");
    const device = await connectDevice(coordinator, alpha);

    device.push([
      { seq: 1, event: noteBy(alpha, incident, "Breathing normally") },
      { seq: 2, event: noteBy(alpha, incident, "Alert") },
    ]);

    expect(await device.next()).toEqual({ type: "ack", upTo: 2 });
    expect(coordinator.listDevices()).toEqual([{ ...alpha, offset: 2 }]);
  });

  it("skips seq at or below the Offset, so a resent batch stores no duplicates", async () => {
    const coordinator = await start(":memory:");
    const incident = await createIncidentFor(coordinator, "alpha-1");
    const device = await connectDevice(coordinator, alpha);
    const first = { seq: 1, event: noteBy(alpha, incident, "Breathing normally") };
    device.push([first]);
    expect(await device.next()).toEqual({ type: "ack", upTo: 1 });

    device.push([first, { seq: 2, event: noteBy(alpha, incident, "Alert") }]);

    expect(await device.next()).toEqual({ type: "ack", upTo: 2 });
    const snapshot = (await openWatchSocket(coordinator).next()) as Extract<WatchMessage, { type: "snapshot" }>;
    expect(snapshot.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("sends events, then the Device with its new Offset, then the touched Incident on /watch", async () => {
    const coordinator = await start(":memory:");
    const incident = await createIncidentFor(coordinator, "alpha-1");
    const device = await connectDevice(coordinator, alpha);
    const watch = openWatchSocket(coordinator);
    await watch.next();
    const name = eventBy(alpha, incident, { kind: "fieldSet", field: "name", value: "Kari Nordmann" });

    device.push([{ seq: 1, event: name }]);

    expect(await watch.next()).toEqual({ type: "events", events: [{ rowid: expect.any(Number), deviceId: "device-1", seq: 1, event: name }] });
    expect(await watch.next()).toEqual({ type: "device", ...alpha, offset: 1, connected: true });
    const touched = await watch.next();
    expect(touched).toMatchObject({ type: "incident", incident: { incidentId: incident.incidentId, patient: { name: { value: "Kari Nordmann" } } } });
  });

  type Context = { incident: Incident; other: Incident; first: Event };

  // Each bad event goes at seq 3, after a good one at seq 2 in the same batch; the reason names the rule.
  it.each<[string, (c: Context) => { seq?: number; event: unknown }, RegExp]>([
    ["a wrong schema", (c) => ({ event: { ...noteBy(alpha, c.incident, "x"), text: "  " } }), /text must be/],
    ["an EOC source", (c) => ({ event: { ...noteBy(alpha, c.incident, "x"), source: { type: "eoc" } } }), /device events/],
    ["an unknown Incident", (c) => ({ event: { ...noteBy(alpha, c.incident, "x"), incidentId: "INC-9999" } }), /unknown Incident/],
    ["a deviceId that differs from the hello", (c) => ({ event: withSource(noteBy(alpha, c.incident, "x"), { deviceId: "device-9" }) }), /deviceId/],
    ["a resourceId that differs from the hello", (c) => ({ event: withSource(noteBy(alpha, c.incident, "x"), { resourceId: "bravo-2" }) }), /resourceId/],
    ["a legId that is not this Resource's", (c) => ({ event: withSource(noteBy(alpha, c.incident, "x"), { legId: c.other.legs[0]!.legId }) }), /legId/],
    ["a patientId that is not its Incident's", (c) => ({ event: { ...noteBy(alpha, c.incident, "x"), patientId: c.other.patientId } }), /patientId/],
    ["an eventId already stored, with a new seq", (c) => ({ event: { ...noteBy(alpha, c.incident, "x"), eventId: c.first.eventId } }), /already stored/],
    ["a seq that leaves a gap after the Offset", (c) => ({ seq: 4, event: noteBy(alpha, c.incident, "x") }), /gap/],
  ])("answers %s with error, then close, and stores nothing of the batch", async (_, bad, reason) => {
    const coordinator = await start(":memory:");
    const incident = await createIncidentFor(coordinator, "alpha-1");
    const other = await createIncidentFor(coordinator, "bravo-2");
    const device = await connectDevice(coordinator, alpha);
    const first = noteBy(alpha, incident, "Breathing normally");
    device.push([{ seq: 1, event: first }]);
    expect(await device.next()).toEqual({ type: "ack", upTo: 1 });

    const { seq = 3, event } = bad({ incident, other, first });
    device.push([{ seq: 2, event: noteBy(alpha, incident, "Alert") }, { seq, event }]);

    expect(await device.next()).toEqual({ type: "error", seq, reason: expect.stringMatching(reason) });
    await device.closed;
    expect(coordinator.listDevices()).toEqual([{ ...alpha, offset: 1 }]);
    const snapshot = (await openWatchSocket(coordinator).next()) as Extract<WatchMessage, { type: "snapshot" }>;
    expect(snapshot.events.map((e) => e.event.eventId)).toEqual([first.eventId]);
  });
});

function withSource(event: Event, changes: Partial<{ deviceId: string; resourceId: string; legId: string }>): Event {
  return { ...event, source: { ...(event.source as Extract<Event["source"], { type: "device" }>), ...changes } };
}

describe("The Patient projection", () => {
  const body: fc.Arbitrary<EventBody> = fc.oneof(
    fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("name"), value: fc.constantFrom("Kari", "Kari Nordmann", "Ola") }),
    fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("dob"), value: fc.constantFrom("1970-01-31", "1985-06-15") }),
    fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("triage"), value: fc.constantFrom(...triages) }),
    fc.record({ kind: fc.constant("vitalAdded"), vitals: fc.record({ pulse: fc.integer({ min: 30, max: 200 }) }) }),
    fc.record({ kind: fc.constant("noteAdded"), text: fc.constantFrom("Alert", "Breathing normally") }),
  ) as fc.Arbitrary<EventBody>;

  // Few distinct enteredAt values, so ties on enteredAt are common and the eventId decides.
  // `order` gives the replay order of the stored events.
  const stamped = fc.uniqueArray(
    fc.record({ body, enteredAt: fc.integer({ min: 1000, max: 1003 }), tag: fc.stringMatching(/^[0-9a-f]{6}$/), order: fc.nat() }),
    {
      minLength: 1,
      maxLength: 12,
      selector: (e) => e.tag,
    },
  );

  it("equals clearing it and replaying the stored events in any order", async () => {
    const coordinator = await start(":memory:");
    let run = 0;

    await fc.assert(
      fc.asyncProperty(
        stamped,
        async (items) => {
          // Every run, shrinking included, uses its own Device and eventIds on the one Coordinator.
          const device = { deviceId: `device-${++run}`, resourceId: "alpha-1" };
          const eventId = (tag: string) => `e-${run}-${tag}`;
          const incident = await createIncidentFor(coordinator, "alpha-1");
          const toEvent = ({ body, enteredAt, tag }: (typeof items)[number]): Event => ({ ...eventBy(device, incident, body), eventId: eventId(tag), enteredAt });
          const order = new Map(items.map((item) => [eventId(item.tag), item.order]));
          const connected = await connectDevice(coordinator, device);

          connected.push(items.map((item, i) => ({ seq: i + 1, event: toEvent(item) })));
          expect(await connected.next()).toEqual({ type: "ack", upTo: items.length });

          const snapshot = (await openWatchSocket(coordinator).next()) as Extract<WatchMessage, { type: "snapshot" }>;
          const stored = snapshot.incidents.find((i) => i.incidentId === incident.incidentId)!;
          // Clear the Patient and replay the stored events in another order.
          const replayed = snapshot.events
            .filter((e) => e.event.incidentId === incident.incidentId)
            .map((e) => e.event)
            .sort((a, b) => order.get(a.eventId)! - order.get(b.eventId)!)
            .reduce(applyEvent, emptyPatient);
          expect(stored.patient).toEqual(replayed);
        },
      ),
      { numRuns: 30 },
    );
  });
});
