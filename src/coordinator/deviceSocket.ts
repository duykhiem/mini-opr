import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Event } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import type { CoordinatorMessage, DeviceMessage } from "../shared/protocol.ts";
import { joinIncident, readEpoch, registerDevice, resourceExists, snapshotFor } from "./db.ts";

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
    case "join":
      if (!isNonEmptyString(m.incidentId)) return "join needs incidentId";
      return { type: "join", incidentId: m.incidentId };
    case "ping":
      return { type: "ping" };
    default:
      return `unknown message type ${String(m.type)}`;
  }
}

// The Device WebSocket (ADR 0001, ADR 0005), served beside the HTTP endpoints.
export type DeviceChannel = {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  // A socket for the Device that has had its welcome and a ping within the last 10 s (ADR 0008).
  isConnected(deviceId: string): boolean;
  // Sends the whole Incident and its full history to every Device whose Resource has a leg in it.
  sendIncident(incident: Incident, events: Event[]): void;
  // Each Device then reconnects; Reset uses this (ADR 0005).
  closeSockets(): void;
  close(): void;
};

const pingTimeoutMs = 10_000;

// onConnectedChange runs on hello, on close and when a socket's last ping gets older than 10 s,
// and onJoin after a Join commits, so the Coordinator can tell the /watch pages (ADR 0008).
export function createDeviceChannel(
  db: DatabaseSync,
  options: { onConnectedChange(deviceId: string): void; onJoin(incident: Incident): void },
): DeviceChannel {
  const wss = new WebSocketServer({ noServer: true });
  // Socket errors end in a close; without listeners ws would throw them.
  wss.on("error", () => {});
  // In memory only: after a restart every Device is disconnected until its next hello.
  const connectedSockets = new Map<string, Set<WebSocket>>();
  let closed = false;

  const isConnected = (deviceId: string) => (connectedSockets.get(deviceId)?.size ?? 0) > 0;

  // The database is closed after the channel, so nothing is reported once closing starts.
  function report(deviceId: string): void {
    if (!closed) options.onConnectedChange(deviceId);
  }

  function setConnected(deviceId: string, socket: WebSocket, connected: boolean): void {
    const sockets = connectedSockets.get(deviceId) ?? new Set();
    if (connected) sockets.add(socket);
    else sockets.delete(socket);
    if (sockets.size > 0) connectedSockets.set(deviceId, sockets);
    else connectedSockets.delete(deviceId);
  }

  // The Resource of each socket, from its hello.
  const resources = new Map<WebSocket, string>();

  function sendIncident(incident: Incident, events: Event[]): void {
    const legResources = new Set(incident.legs.map((leg) => leg.resourceId));
    for (const [socket, resourceId] of resources) {
      if (legResources.has(resourceId) && socket.readyState === socket.OPEN) send(socket, { type: "incident", incident, events });
    }
  }

  wss.on("connection", (socket) => {
    let deviceId: string | undefined; // set once hello is accepted
    let pingTimer: ReturnType<typeof setTimeout> | undefined;
    socket.on("error", () => {});

    // Counts this socket as connected for the next 10 s; on welcome and on every ping.
    function keepConnected(id: string): void {
      setConnected(id, socket, true);
      clearTimeout(pingTimer);
      pingTimer = setTimeout(() => {
        setConnected(id, socket, false);
        report(id);
      }, pingTimeoutMs);
    }

    socket.on("message", (data) => {
      const message = parse(data);
      if (typeof message === "string") return reject(socket, message);

      if (deviceId === undefined) {
        if (message.type !== "hello") return reject(socket, "first message must be hello");
        if (!resourceExists(db, message.resourceId)) return reject(socket, `unknown resourceId ${message.resourceId}`);
        deviceId = message.deviceId;
        resources.set(socket, message.resourceId);
        const offset = registerDevice(db, message.deviceId, message.resourceId);
        send(socket, { type: "welcome", epoch: readEpoch(db), offset });
        send(socket, { type: "snapshot", ...snapshotFor(db, message.resourceId) });
        keepConnected(deviceId);
        report(deviceId);
        return;
      }

      switch (message.type) {
        case "ping": {
          // A ping after more than 10 s of silence makes the Device connected again.
          const wasConnected = isConnected(deviceId);
          keepConnected(deviceId);
          if (!wasConnected) report(deviceId);
          return send(socket, { type: "pong" });
        }
        case "join": {
          const joined = joinIncident(db, message.incidentId, resources.get(socket)!, Date.now());
          // A typo is a user error, not a bug: reply and keep the socket open.
          if (joined === null) return send(socket, { type: "joinRejected", incidentId: message.incidentId, reason: "unknown" });
          // The joining socket is among them, as its Resource now has a leg.
          sendIncident(joined.incident, joined.events);
          options.onJoin(joined.incident);
          return;
        }
        case "hello":
          return reject(socket, "hello sent twice");
      }
    });

    socket.on("close", () => {
      clearTimeout(pingTimer);
      resources.delete(socket);
      if (deviceId === undefined) return;
      setConnected(deviceId, socket, false);
      report(deviceId);
    });
  });

  return {
    handleUpgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)),
    isConnected,
    sendIncident,
    closeSockets() {
      for (const ws of wss.clients) ws.close();
    },
    close() {
      closed = true;
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
