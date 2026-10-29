import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { draftEvent, type EventBody } from "./draftEvent.ts";
import { triages, type Event } from "./event.ts";
import { parseEvent } from "./parseEvent.ts";

const ids = { incidentId: "INC-0001", patientId: "patient-1" };
const device = { deviceId: "device-1", resourceId: "alpha-1", legId: "leg-1" };

function drafted(result: Event | { error: string }): Event {
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("draftEvent", () => {
  it("stamps the body with a UUIDv7 eventId and enteredAt from the clock", () => {
    const event = draftEvent({ kind: "noteAdded", text: "Awake" }, ids, device, () => 1_760_000_000_000);

    expect(event).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      enteredAt: 1_760_000_000_000,
      incidentId: "INC-0001",
      patientId: "patient-1",
      source: { type: "device", deviceId: "device-1", resourceId: "alpha-1", legId: "leg-1" },
      kind: "noteAdded",
      text: "Awake",
    });
  });

  it("returns the reason for a bad body", () => {
    expect(draftEvent({ kind: "noteAdded", text: "  " }, ids, device, () => 1000)).toEqual({ error: "text must be a non-empty string" });
  });

  it("does not let extra keys in the body replace the envelope", () => {
    const body = { kind: "legCompleted", source: { type: "eoc" }, eventId: "x" } as EventBody;
    const event = drafted(draftEvent(body, ids, device, () => 1000));

    expect(event.source).toEqual({ type: "device", ...device });
    expect(event.eventId).not.toBe("x");
  });
});

const nonBlank = fc.string({ minLength: 1 }).filter((s) => s.trim() !== "");
const realDate = fc
  .date({ min: new Date("1900-01-01T00:00:00Z"), max: new Date("2100-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const vital = fc.double({ noNaN: true, noDefaultInfinity: true });

const arbBody: fc.Arbitrary<EventBody> = fc.oneof(
  fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("name"), value: nonBlank }),
  fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("dob"), value: realDate }),
  fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("triage"), value: fc.constantFrom(...triages) }),
  fc.record({
    kind: fc.constant("vitalAdded"),
    vitals: fc
      .record(
        { pulse: vital, systolic: vital, diastolic: vital, spo2: vital, respRate: vital, temperature: vital },
        { requiredKeys: [] },
      )
      .filter((v) => Object.keys(v).length > 0),
  }),
  fc.record({ kind: fc.constant("noteAdded"), text: nonBlank }),
  fc.record({ kind: fc.constant("legCompleted") }),
) as fc.Arbitrary<EventBody>;

const arbId = fc.string({ minLength: 1 });
const arbNow = fc.integer({ min: 0, max: 2 ** 48 - 1 });

describe("draftEvent properties", () => {
  it("builds Events that pass parseEvent and come back equal", () => {
    fc.assert(
      fc.property(
        arbBody,
        fc.record({ incidentId: arbId, patientId: arbId }),
        fc.record({ deviceId: arbId, resourceId: arbId, legId: arbId }),
        arbNow,
        (body, ids, device, now) => {
          const event = drafted(draftEvent(body, ids, device, () => now));
          expect(parseEvent(event)).toEqual(event);
        },
      ),
    );
  });

  it("gives Events drafted at a later clock time a larger eventId", () => {
    fc.assert(
      fc.property(arbBody, arbNow, arbNow, (body, a, b) => {
        fc.pre(a < b);
        const earlier = drafted(draftEvent(body, ids, device, () => a));
        const later = drafted(draftEvent(body, ids, device, () => b));
        expect(earlier.eventId < later.eventId).toBe(true);
      }),
    );
  });
});
