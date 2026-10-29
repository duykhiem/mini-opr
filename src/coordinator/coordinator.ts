import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { deviceSocketPath } from "../shared/protocol.ts";
import type { DeviceStatus } from "../shared/watch.ts";
import { createIncident, listDevices, listEvents, listIncidents, listResources, openDatabase, readEpoch, resetDatabase } from "./db.ts";
import { createDeviceChannel } from "./deviceSocket.ts";
import { parseNewIncident } from "./newIncident.ts";
import { createWatchChannel } from "./watch.ts";

export type Coordinator = {
  port: number;
  epoch: string;
  listDevices(): Omit<DeviceStatus, "connected">[];
  // Reset closes every Device socket (ADR 0005); each Device then reconnects.
  closeDeviceSockets(): void;
  close(): Promise<void>;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// The caller picks the database path and port, so a test can use ":memory:" and port 0.
export async function startCoordinator(options: { dbPath: string; port: number }): Promise<Coordinator> {
  const db = openDatabase(options.dbPath);
  // Changed only by Reset; kept here so the handle can still read it after close.
  let epoch = readEpoch(db);
  // Connectivity is not tracked yet, so every Device shows disconnected.
  const snapshot = () => ({
    epoch,
    incidents: listIncidents(db),
    events: listEvents(db),
    devices: listDevices(db).map((device) => ({ ...device, connected: false })),
  });
  const watch = createWatchChannel(snapshot);

  const devices = createDeviceChannel(db);

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/api/resources") {
      sendJson(res, 200, listResources(db));
      return;
    }
    if (req.method === "POST" && path === "/api/incidents") {
      readJson(req)
        .then(
          (body) => {
            const input = parseNewIncident(body, listResources(db).map((r) => r.resourceId));
            if ("error" in input) {
              sendJson(res, 400, input);
              return;
            }
            const { incident, events } = createIncident(db, input, Date.now());
            sendJson(res, 201, { incident });
            // ADR 0008: the Incident first, then its EOC events.
            watch.broadcast({ type: "incident", incident });
            if (events.length > 0) watch.broadcast({ type: "events", events });
          },
          () => sendJson(res, 400, { error: "body is not JSON" }),
        )
        .catch((error: unknown) => {
          console.error(error);
          if (!res.headersSent) sendJson(res, 500, { error: "could not create the Incident" });
        });
      return;
    }
    if (req.method === "POST" && path === "/api/reset") {
      try {
        epoch = resetDatabase(db);
      } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: "could not reset" });
        return;
      }
      // Each Device reconnects, sees the new epoch and clears itself (ADR 0005).
      devices.closeSockets();
      res.writeHead(200).end();
      // ADR 0008: open /watch sockets stay open and get the new, empty snapshot.
      watch.broadcast({ type: "snapshot", ...snapshot() });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });

  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/watch") watch.handleUpgrade(req, socket, head);
    else if (path === deviceSocketPath) devices.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));

  // Closing again returns the first close, so a caller can close more than once.
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      watch.close();
      devices.close();
      server.closeAllConnections();
      server.close((error) => {
        db.close();
        if (error) reject(error);
        else resolve();
      });
    }));

  return {
    port: (server.address() as AddressInfo).port,
    get epoch() {
      return epoch;
    },
    listDevices: () => listDevices(db),
    closeDeviceSockets: () => devices.closeSockets(),
    close,
  };
}
