import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createIncident, listDevices, listEvents, listIncidents, listResources, openDatabase, readEpoch } from "./db.ts";
import { parseNewIncident } from "./newIncident.ts";
import { createWatchChannel } from "./watch.ts";

export type Coordinator = { port: number; epoch: string; close(): Promise<void> };

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
  // No Device protocol yet, so no Device is connected.
  const watch = createWatchChannel(() => ({
    epoch: readEpoch(db),
    incidents: listIncidents(db),
    events: listEvents(db),
    devices: listDevices(db).map((device) => ({ ...device, connected: false })),
  }));

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
    sendJson(res, 404, { error: "not found" });
  });

  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/watch") watch.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));

  // Closing again returns the first close, so a caller can close more than once.
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      watch.close();
      server.closeAllConnections();
      server.close((error) => {
        db.close();
        if (error) reject(error);
        else resolve();
      });
    }));

  return { port: (server.address() as AddressInfo).port, epoch: readEpoch(db), close };
}
