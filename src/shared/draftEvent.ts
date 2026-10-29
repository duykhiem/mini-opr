import type { Event, EventBase, EventSource } from "./event.ts";
import { parseEvent } from "./parseEvent.ts";
import { uuidv7 } from "./uuidv7.ts";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// An Event's kind and payload, without the envelope: what the Device page's form gives.
export type EventBody = DistributiveOmit<Event, keyof EventBase>;

type DeviceSource = Omit<Extract<EventSource, { type: "device" }>, "type">;

// Builds a Device Event and checks it with parseEvent, so a bad body (a blank note, say) comes back as a reason.
export function draftEvent(
  body: EventBody,
  ids: { incidentId: string; patientId: string },
  device: DeviceSource,
  clock: () => number,
): Event | { error: string } {
  const enteredAt = clock();
  return parseEvent({
    ...body,
    eventId: uuidv7(enteredAt),
    enteredAt,
    incidentId: ids.incidentId,
    patientId: ids.patientId,
    source: { type: "device", ...device },
  });
}
