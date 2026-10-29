import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { listResources, openDatabase, readEpoch } from "./db.ts";

export type Coordinator = { port: number; epoch: string; close(): Promise<void> };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// The caller picks the database path and port, so a test can use ":memory:" and port 0.
export async function startCoordinator(options: { dbPath: string; port: number }): Promise<Coordinator> {
  const db = openDatabase(options.dbPath);

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/api/resources") {
      sendJson(res, 200, listResources(db));
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(options.port, resolve));

  // Closing again returns the first close, so a caller can close more than once.
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => {
        db.close();
        if (error) reject(error);
        else resolve();
      });
    }));

  return { port: (server.address() as AddressInfo).port, epoch: readEpoch(db), close };
}
