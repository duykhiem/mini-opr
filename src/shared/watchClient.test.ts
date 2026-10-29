import { afterEach, describe, expect, it } from "vitest";
import { startCoordinator, type Coordinator } from "../coordinator/coordinator.ts";
import type { Incident } from "./incident.ts";
import { deviceSocketPath } from "./protocol.ts";
import { openWatch, type WatchView } from "./watchClient.ts";

const cleanups: (() => unknown)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function start(port = 0): Promise<Coordinator> {
  const coordinator = await startCoordinator({ dbPath: ":memory:", port });
  cleanups.push(() => coordinator.close());
  return coordinator;
}

async function postIncident(coordinator: Coordinator, body: object): Promise<Incident> {
  const response = await fetch(`http://localhost:${coordinator.port}/api/incidents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return ((await response.json()) as { incident: Incident }).incident;
}

// Opens a watch client and resolves `until` once a view matches.
function watch(coordinator: Coordinator) {
  let latest: WatchView = { connected: false, data: undefined };
  let notify = () => {};
  const client = openWatch(`ws://localhost:${coordinator.port}/watch`, (view) => {
    latest = view;
    notify();
  });
  cleanups.push(() => client.close());
  return {
    async until(predicate: (view: WatchView) => boolean): Promise<WatchView> {
      while (!predicate(latest)) await new Promise<void>((resolve) => (notify = resolve));
      return latest;
    },
  };
}

describe("The watch client", () => {
  it("is connected and holds the snapshot after it opens", async () => {
    const coordinator = await start();
    const incident = await postIncident(coordinator, { resourceId: "alpha-1", name: "Kari Nordmann" });

    const view = await watch(coordinator).until((v) => v.connected && v.data !== undefined);

    expect(view.data?.epoch).toBe(coordinator.epoch);
    expect(view.data?.incidents).toEqual([incident]);
    expect(view.data?.events.map((e) => e.event.kind)).toEqual(["fieldSet"]);
  });

  it("adds a created Incident and its events", async () => {
    const coordinator = await start();
    const client = watch(coordinator);
    await client.until((v) => v.data !== undefined);

    const incident = await postIncident(coordinator, { resourceId: "bravo-2", triage: "green" });

    const view = await client.until((v) => v.data?.events.length === 1);
    expect(view.data?.incidents).toEqual([incident]);
    expect(view.data?.events[0]?.event).toMatchObject({ kind: "fieldSet", field: "triage", value: "green" });
  });

  it("adds a Device when it connects and replaces its row when it disconnects", async () => {
    const coordinator = await start();
    const client = watch(coordinator);
    await client.until((v) => v.data !== undefined);

    const device = new WebSocket(`ws://localhost:${coordinator.port}${deviceSocketPath}`);
    device.onopen = () => device.send(JSON.stringify({ type: "hello", deviceId: "device-1", resourceId: "alpha-1", epoch: null }));
    const online = await client.until((v) => v.data?.devices.length === 1);
    expect(online.data?.devices).toEqual([{ deviceId: "device-1", resourceId: "alpha-1", offset: 0, connected: true }]);

    device.close();

    const offline = await client.until((v) => v.data?.devices[0]?.connected === false);
    expect(offline.data?.devices).toEqual([{ deviceId: "device-1", resourceId: "alpha-1", offset: 0, connected: false }]);
  });

  it("shows disconnected when the Coordinator goes away, then replaces everything with the next snapshot", async () => {
    const first = await start();
    await postIncident(first, { resourceId: "alpha-1", name: "Kari Nordmann" });
    const client = watch(first);
    await client.until((v) => v.connected && v.data?.incidents.length === 1);

    await first.close();
    const offline = await client.until((v) => !v.connected);
    expect(offline.data?.incidents).toHaveLength(1);

    // A fresh :memory: database on the same port is a new Coordinator epoch.
    const second = await start(first.port);
    const view = await client.until((v) => v.connected && v.data?.epoch === second.epoch);
    expect(view.data).toEqual({ epoch: second.epoch, incidents: [], events: [], devices: [] });
  });
});
