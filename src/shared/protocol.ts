// Messages on the Device WebSocket (ADR 0005).
import type { Event } from "./event.ts";
import type { Incident } from "./incident.ts";

export const deviceSocketPath = "/sync";

export type DeviceMessage =
  | { type: "hello"; deviceId: string; resourceId: string; epoch: string | null }
  | { type: "ping" };

export type CoordinatorMessage =
  | { type: "welcome"; epoch: string; offset: number }
  | { type: "snapshot"; incidents: Incident[]; events: Event[] }
  | { type: "pong" }
  | { type: "error"; seq: number | null; reason: string };
