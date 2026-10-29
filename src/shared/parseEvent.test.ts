import { describe, expect, it } from "vitest";
import type { Event } from "./event.ts";
import { parseEvent } from "./parseEvent.ts";

const base = {
  eventId: "019a3b2c-0000-7000-8000-000000000001",
  enteredAt: 1_760_000_000_000,
  incidentId: "INC-0001",
  patientId: "patient-1",
  source: { type: "device", deviceId: "device-1", resourceId: "alpha-1", legId: "leg-1" },
} as const;

const eoc = { ...base, source: { type: "eoc" } } as const;

describe("parseEvent accepts", () => {
  it.each<[string, Event]>([
    ["fieldSet name", { ...base, kind: "fieldSet", field: "name", value: "Kari Nordmann" }],
    ["fieldSet dob", { ...base, kind: "fieldSet", field: "dob", value: "1970-01-31" }],
    ["fieldSet triage", { ...base, kind: "fieldSet", field: "triage", value: "red" }],
    ["vitalAdded", { ...base, kind: "vitalAdded", vitals: { pulse: 80, spo2: 97, temperature: 36.8 } }],
    ["noteAdded", { ...base, kind: "noteAdded", text: "Found on floor" }],
    ["legCompleted", { ...base, kind: "legCompleted" }],
    ["an EOC source", { ...eoc, kind: "fieldSet", field: "triage", value: "blue" }],
  ])("%s", (_, event) => {
    expect(parseEvent(event)).toEqual(event);
  });
});

describe("parseEvent rejects", () => {
  it.each<[string, unknown, string]>([
    ["a non-object", "hello", "event must be a JSON object"],
    ["an array", [], "event must be a JSON object"],
    ["a missing eventId", { ...base, eventId: undefined, kind: "legCompleted" }, "eventId must be a non-empty string"],
    ["a number eventId", { ...base, eventId: 1, kind: "legCompleted" }, "eventId must be a non-empty string"],
    ["a string enteredAt", { ...base, enteredAt: "1760000000000", kind: "legCompleted" }, "enteredAt must be a finite number"],
    ["a NaN enteredAt", { ...base, enteredAt: NaN, kind: "legCompleted" }, "enteredAt must be a finite number"],
    ["a missing incidentId", { ...base, incidentId: undefined, kind: "legCompleted" }, "incidentId must be a non-empty string"],
    ["a number patientId", { ...base, patientId: 7, kind: "legCompleted" }, "patientId must be a non-empty string"],
    ["a missing source", { ...base, source: undefined, kind: "legCompleted" }, "source must be a device or eoc source"],
    ["an unknown source type", { ...base, source: { type: "radio" }, kind: "legCompleted" }, "source must be a device or eoc source"],
    [
      "a device source without legId",
      { ...base, source: { type: "device", deviceId: "device-1", resourceId: "alpha-1" }, kind: "legCompleted" },
      "source must be a device or eoc source",
    ],
    ["an unknown kind", { ...base, kind: "fieldCleared" }, "kind must be fieldSet, vitalAdded, noteAdded or legCompleted"],
    ["a fieldSet with an unknown field", { ...base, kind: "fieldSet", field: "address", value: "Oslo" }, "field must be name, dob or triage"],
    ["an empty name", { ...base, kind: "fieldSet", field: "name", value: "" }, "name must be a non-empty string"],
    ["a blank name", { ...base, kind: "fieldSet", field: "name", value: "  " }, "name must be a non-empty string"],
    ["a dob that is not YYYY-MM-DD", { ...base, kind: "fieldSet", field: "dob", value: "31.01.1970" }, "dob must be a date as YYYY-MM-DD"],
    ["a dob that is not a real date", { ...base, kind: "fieldSet", field: "dob", value: "1970-02-30" }, "dob must be a date as YYYY-MM-DD"],
    [
      "a triage outside the five colours",
      { ...base, kind: "fieldSet", field: "triage", value: "purple" },
      "triage must be one of red, orange, yellow, green, blue",
    ],
    ["vitalAdded with no vitals object", { ...base, kind: "vitalAdded" }, "vitals must have at least one vital"],
    ["vitalAdded with no vital", { ...base, kind: "vitalAdded", vitals: {} }, "vitals must have at least one vital"],
    ["a vital that is a string", { ...base, kind: "vitalAdded", vitals: { pulse: "80" } }, "pulse must be a finite number"],
    ["a vital that is Infinity", { ...base, kind: "vitalAdded", vitals: { spo2: Infinity } }, "spo2 must be a finite number"],
    ["an unknown vital", { ...base, kind: "vitalAdded", vitals: { glucose: 5 } }, "glucose is not a known vital"],
    ["noteAdded with empty text", { ...base, kind: "noteAdded", text: "" }, "text must be a non-empty string"],
    ["noteAdded with blank text", { ...base, kind: "noteAdded", text: " \n " }, "text must be a non-empty string"],
    ["legCompleted from an EOC source", { ...eoc, kind: "legCompleted" }, "legCompleted must come from a device source"],
  ])("%s", (_, input, error) => {
    expect(parseEvent(input)).toEqual({ error });
  });
});

describe("parseEvent output", () => {
  it("keeps only the schema fields", () => {
    const parsed = parseEvent({ ...base, kind: "noteAdded", text: "Awake", extra: true, source: { ...base.source, extra: 1 } });
    expect(parsed).toEqual({ ...base, kind: "noteAdded", text: "Awake" });
  });
});
