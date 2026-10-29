import { triages, type Event, type EventBase, type EventSource, type Triage, type Vitals } from "./event.ts";

const vitalNames = ["pulse", "systolic", "diastolic", "spo2", "respRate", "temperature"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function parseSource(source: unknown): EventSource | undefined {
  if (!isRecord(source)) return undefined;
  if (source.type === "eoc") return { type: "eoc" };
  const { type, deviceId, resourceId, legId } = source;
  if (type === "device" && isId(deviceId) && isId(resourceId) && isId(legId)) return { type, deviceId, resourceId, legId };
  return undefined;
}

function parseVitals(vitals: unknown): Vitals | { error: string } {
  if (!isRecord(vitals) || Object.keys(vitals).length === 0) return { error: "vitals must have at least one vital" };
  const parsed: Vitals = {};
  for (const [name, value] of Object.entries(vitals)) {
    if (!vitalNames.includes(name as keyof Vitals)) return { error: `${name} is not a known vital` };
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: `${name} must be a finite number` };
    parsed[name as keyof Vitals] = value;
  }
  return parsed;
}

// Checks any input against the event schema (ADR 0003); returns the reason on failure. Unknown extra keys are dropped.
export function parseEvent(input: unknown): Event | { error: string } {
  if (!isRecord(input)) return { error: "event must be a JSON object" };
  const { eventId, enteredAt, incidentId, patientId } = input;

  if (!isId(eventId)) return { error: "eventId must be a non-empty string" };
  if (typeof enteredAt !== "number" || !Number.isFinite(enteredAt)) return { error: "enteredAt must be a finite number" };
  if (!isId(incidentId)) return { error: "incidentId must be a non-empty string" };
  if (!isId(patientId)) return { error: "patientId must be a non-empty string" };
  const source = parseSource(input.source);
  if (source === undefined) return { error: "source must be a device or eoc source" };
  const base: EventBase = { eventId, enteredAt, incidentId, patientId, source };

  switch (input.kind) {
    case "fieldSet": {
      const { field, value } = input;
      switch (field) {
        case "name":
          if (!isNonBlank(value)) return { error: "name must be a non-empty string" };
          return { ...base, kind: "fieldSet", field, value };
        case "dob":
          if (!isRealDate(value)) return { error: "dob must be a date as YYYY-MM-DD" };
          return { ...base, kind: "fieldSet", field, value };
        case "triage":
          if (!triages.includes(value as Triage)) return { error: `triage must be one of ${triages.join(", ")}` };
          return { ...base, kind: "fieldSet", field, value: value as Triage };
        default:
          return { error: "field must be name, dob or triage" };
      }
    }
    case "vitalAdded": {
      const vitals = parseVitals(input.vitals);
      if ("error" in vitals) return vitals;
      return { ...base, kind: "vitalAdded", vitals };
    }
    case "noteAdded":
      if (!isNonBlank(input.text)) return { error: "text must be a non-empty string" };
      return { ...base, kind: "noteAdded", text: input.text };
    case "legCompleted":
      if (source.type !== "device") return { error: "legCompleted must come from a device source" };
      return { ...base, kind: "legCompleted" };
    default:
      return { error: "kind must be fieldSet, vitalAdded, noteAdded or legCompleted" };
  }
}
