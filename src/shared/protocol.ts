// Messages on the Device WebSocket (ADR 0005).
import type { Event } from "./event.ts";
import type { Incident } from "./incident.ts";

export const deviceSocketPath = "/sync";

// One Event of a Device's Event log, numbered by seq.
export type LoggedEvent = { seq: number; event: Event };

export type DeviceMessage =
  | { type: "hello"; deviceId: string; resourceId: string; epoch: string | null }
  | { type: "join"; incidentId: string } // identity comes from the hello
  // Every seq above the Offset after welcome, then each new event at once.
  | { type: "push"; items: LoggedEvent[] }
  | { type: "ping" };

// A Join of an Incident id the Coordinator does not know; a user error, so the socket stays open.
export type JoinRejectReason = "unknown";

export type CoordinatorMessage =
  | { type: "welcome"; epoch: string; offset: number }
  | { type: "ack"; upTo: number } // after the push batch is committed
  | { type: "events"; events: Event[] } // realtime fan-out of another Device's stored events
  | { type: "snapshot"; incidents: Incident[]; events: Event[] }
  // Legs changed: the whole Incident and its full event history.
  | { type: "incident"; incident: Incident; events: Event[] }
  | { type: "joinRejected"; incidentId: string; reason: JoinRejectReason }
  | { type: "pong" }
  | { type: "error"; seq: number | null; reason: string };
