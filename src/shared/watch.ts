// Messages on the read-only /watch socket (ADR 0008).
import type { Event } from "./event.ts";
import type { Incident } from "./incident.ts";

export type StoredEvent = {
  rowid: number;
  deviceId: string | null; // null for EOC events (the EOC lane)
  seq: number | null; // null for EOC events
  event: Event;
};

export type DeviceStatus = { deviceId: string; resourceId: string; offset: number; connected: boolean };

export type WatchSnapshot = {
  epoch: string;
  incidents: Incident[];
  events: StoredEvent[]; // rowid order
  devices: DeviceStatus[];
};

export type WatchMessage =
  | ({ type: "snapshot" } & WatchSnapshot)
  | { type: "events"; events: StoredEvent[] }
  | { type: "incident"; incident: Incident }
  | ({ type: "device" } & DeviceStatus)
  | { type: "pong" };
