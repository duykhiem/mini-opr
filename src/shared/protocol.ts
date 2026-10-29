// Messages on the Device WebSocket (ADR 0005).
import type { Event } from "./event.ts";
import type { Incident } from "./incident.ts";

export const deviceSocketPath = "/sync";

export type DeviceMessage =
  | { type: "hello"; deviceId: string; resourceId: string; epoch: string | null }
  | { type: "join"; incidentId: string } // identity comes from the hello
  | { type: "ping" };

// A Join of an Incident id the Coordinator does not know; a user error, so the socket stays open.
export type JoinRejectReason = "unknown";

export type CoordinatorMessage =
  | { type: "welcome"; epoch: string; offset: number }
  | { type: "snapshot"; incidents: Incident[]; events: Event[] }
  // Legs changed: the whole Incident and its full event history.
  | { type: "incident"; incident: Incident; events: Event[] }
  | { type: "joinRejected"; incidentId: string; reason: JoinRejectReason }
  | { type: "pong" }
  | { type: "error"; seq: number | null; reason: string };
