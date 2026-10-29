import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Event } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import type { CoordinatorMessage, DeviceMessage } from "../shared/protocol.ts";
import { joinIncident, readEpoch, registerDevice, resourceExists, snapshotFor, storePush, type PushItem, type StoredPush } from "./db.ts";

function send(socket: WebSocket, message: CoordinatorMessage): void {
  socket.send(JSON.stringify(message));
}

// Bad messages are bugs: error, then close (ADR 0005).
function reject(socket: WebSocket, reason: string, seq: number | null = null): void {
  send(socket, { type: "error", seq, reason });
  socket.close();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isPushItem(value: unknown): value is PushItem {
  if (typeof value !== "object" || value === null) return false;
  const { seq } = value as Record<string, unknown>;
  return typeof seq === "number" && Number.isInteger(seq) && seq >= 1;
}

// A push's events are checked when it is stored, so each reason can carry its seq.
type ParsedMessage = Exclude<DeviceMessage, { type: "push" }> | { type: "push"; items: PushItem[] };

// Returns the message if it has the schema of a DeviceMessage, otherwise a reason it does not.
function parse(data: unknown): ParsedMessage | string {
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
    case "push":
      if (!Array.isArray(m.items) || !m.items.every(isPushItem)) return "push needs items, each with a seq of 1 or more";
      return { type: "push", items: m.items };
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
// onJoin after a Join commits and onPush after a push batch commits, so the Coordinator can tell
// the /watch pages (ADR 0008).
export function createDeviceChannel(
  db: DatabaseSync,
  options: {
    onConnectedChange(deviceId: string): void;
    onJoin(incident: Incident): void;
    onPush(deviceId: string, stored: StoredPush): void;
  },
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

  // The Device and Resource of each socket, from its hello.
  const identities = new Map<WebSocket, { deviceId: string; resourceId: string }>();

  function sendIncident(incident: Incident, events: Event[]): void {
    const legResources = new Set(incident.legs.map((leg) => leg.resourceId));
    for (const [socket, { resourceId }] of identities) {
      if (legResources.has(resourceId) && socket.readyState === socket.OPEN) send(socket, { type: "incident", incident, events });
    }
  }

  // Fan-out (ADR 0005): each stored event goes to every connected Device whose Resource has a Transfer
  // leg in its Incident, including other Devices of the sender's Resource, but to no socket of the sender:
  // a Device's own events are in its Event log, never among those it receives.
  function fanOut(senderId: string, { events, incidents }: StoredPush): void {
    const resourcesByIncident = new Map(incidents.map((i) => [i.incidentId, new Set(i.legs.map((leg) => leg.resourceId))]));
    for (const [socket, { deviceId, resourceId }] of identities) {
      if (deviceId === senderId || socket.readyState !== socket.OPEN) continue;
      const visible = events.filter((e) => resourcesByIncident.get(e.event.incidentId)?.has(resourceId)).map((e) => e.event);
      if (visible.length > 0) send(socket, { type: "events", events: visible });
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
        identities.set(socket, { deviceId: message.deviceId, resourceId: message.resourceId });
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
          const joined = joinIncident(db, message.incidentId, identities.get(socket)!.resourceId, Date.now());
          // A typo is a user error, not a bug: reply and keep the socket open.
          if (joined === null) return send(socket, { type: "joinRejected", incidentId: message.incidentId, reason: "unknown" });
          // The joining socket is among them, as its Resource now has a leg.
          sendIncident(joined.incident, joined.events);
          options.onJoin(joined.incident);
          return;
        }
        case "push": {
          let stored: ReturnType<typeof storePush>;
          try {
            stored = storePush(db, identities.get(socket)!, message.items);
          } catch (error) {
            // The transaction has rolled back; fail loudly on this socket instead of on the process.
            console.error(error);
            return reject(socket, "could not store the push");
          }
          if ("reason" in stored) return reject(socket, stored.reason, stored.seq);
          send(socket, { type: "ack", upTo: stored.offset });
          fanOut(deviceId, stored);
          // A completed leg goes to every Device with a leg in the Incident, this one included (ADR 0005).
          for (const { incident, events } of stored.legsChanged) sendIncident(incident, events);
          if (stored.events.length > 0) options.onPush(deviceId, stored);
          return;
        }
        case "hello":
          return reject(socket, "hello sent twice");
      }
    });

    socket.on("close", () => {
      clearTimeout(pingTimer);
      identities.delete(socket);
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
