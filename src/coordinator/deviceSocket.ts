import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { CoordinatorMessage, DeviceMessage } from "../shared/protocol.ts";
import { readEpoch, registerDevice, resourceExists, snapshotFor } from "./db.ts";

function send(socket: WebSocket, message: CoordinatorMessage): void {
  socket.send(JSON.stringify(message));
}

// Bad messages are bugs: error, then close (ADR 0005).
function reject(socket: WebSocket, reason: string): void {
  send(socket, { type: "error", seq: null, reason });
  socket.close();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

// Returns the message if it has the schema of a DeviceMessage, otherwise a reason it does not.
function parse(data: unknown): DeviceMessage | string {
  let message: unknown;
  try {
    message = JSON.parse(String(data));
  } catch {
    return "message is not JSON";
  }
  if (typeof message !== "object" || message === null) return "message is not an object";
  const m = message as Record<string, unknown>;
  switch (m.type) {
    case "hello":
      if (!isNonEmptyString(m.deviceId) || !isNonEmptyString(m.resourceId)) return "hello needs deviceId and resourceId";
      if (m.epoch !== null && typeof m.epoch !== "string") return "hello epoch must be a string or null";
      return { type: "hello", deviceId: m.deviceId, resourceId: m.resourceId, epoch: m.epoch };
    case "ping":
      return { type: "ping" };
    default:
      return `unknown message type ${String(m.type)}`;
  }
}

// The Device WebSocket (ADR 0001, ADR 0005), served beside the HTTP endpoints.
export type DeviceChannel = {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  // Each Device then reconnects; Reset uses this (ADR 0005).
  closeSockets(): void;
  close(): void;
};

export function createDeviceChannel(db: DatabaseSync): DeviceChannel {
  const wss = new WebSocketServer({ noServer: true });
  // Socket errors end in a close; without listeners ws would throw them.
  wss.on("error", () => {});

  wss.on("connection", (socket) => {
    let helloReceived = false;
    socket.on("error", () => {});

    socket.on("message", (data) => {
      const message = parse(data);
      if (typeof message === "string") return reject(socket, message);

      if (!helloReceived) {
        if (message.type !== "hello") return reject(socket, "first message must be hello");
        if (!resourceExists(db, message.resourceId)) return reject(socket, `unknown resourceId ${message.resourceId}`);
        helloReceived = true;
        const offset = registerDevice(db, message.deviceId, message.resourceId);
        send(socket, { type: "welcome", epoch: readEpoch(db), offset });
        send(socket, { type: "snapshot", ...snapshotFor(db, message.resourceId) });
        return;
      }

      switch (message.type) {
        case "ping":
          return send(socket, { type: "pong" });
        case "hello":
          return reject(socket, "hello sent twice");
      }
    });
  });

  return {
    handleUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
    closeSockets() {
      for (const ws of wss.clients) ws.close();
    },
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
