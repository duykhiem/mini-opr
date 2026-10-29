import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Event } from "./event.ts";
import { applyEvent, emptyPatient, type PatientState } from "./patient.ts";

const base = {
  incidentId: "INC-0001",
  patientId: "patient-1",
  source: { type: "eoc" },
} as const;

function fold(events: Event[]): PatientState {
  return events.reduce(applyEvent, emptyPatient);
}

describe("applyEvent", () => {
  it("keeps the value with the newest enteredAt per field", () => {
    const state = fold([
      { ...base, eventId: "01-b", enteredAt: 2000, kind: "fieldSet", field: "name", value: "Kari Nordmann" },
      { ...base, eventId: "01-a", enteredAt: 1000, kind: "fieldSet", field: "name", value: "Kari" },
      { ...base, eventId: "01-c", enteredAt: 1500, kind: "fieldSet", field: "triage", value: "red" },
    ]);

    expect(state.name?.value).toBe("Kari Nordmann");
    expect(state.triage?.value).toBe("red");
  });

  it("breaks an enteredAt tie with the larger eventId", () => {
    const larger: Event = { ...base, eventId: "019a-0002", enteredAt: 1000, kind: "fieldSet", field: "dob", value: "1970-02-02" };
    const smaller: Event = { ...base, eventId: "019a-0001", enteredAt: 1000, kind: "fieldSet", field: "dob", value: "1970-01-01" };

    expect(fold([larger, smaller]).dob?.value).toBe("1970-02-02");
    expect(fold([smaller, larger]).dob?.value).toBe("1970-02-02");
  });

  it("keeps every vitals and notes entry sorted by enteredAt, then eventId", () => {
    const state = fold([
      { ...base, eventId: "019a-0003", enteredAt: 3000, kind: "vitalAdded", vitals: { pulse: 90 } },
      { ...base, eventId: "019a-0002", enteredAt: 1000, kind: "vitalAdded", vitals: { pulse: 80 } },
      { ...base, eventId: "019a-0001", enteredAt: 1000, kind: "vitalAdded", vitals: { spo2: 97 } },
      { ...base, eventId: "019a-0005", enteredAt: 2000, kind: "noteAdded", text: "Awake" },
      { ...base, eventId: "019a-0004", enteredAt: 1000, kind: "noteAdded", text: "Found on floor" },
    ]);

    expect(state.vitals.map((v) => v.vitals)).toEqual([{ spo2: 97 }, { pulse: 80 }, { pulse: 90 }]);
    expect(state.notes.map((n) => n.text)).toEqual(["Found on floor", "Awake"]);
  });

  it("never clears a field, even with a newer empty value", () => {
    const state = fold([
      { ...base, eventId: "019a-0001", enteredAt: 1000, kind: "fieldSet", field: "name", value: "Kari Nordmann" },
      { ...base, eventId: "019a-0002", enteredAt: 2000, kind: "fieldSet", field: "name", value: "" },
      { ...base, eventId: "019a-0003", enteredAt: 3000, kind: "fieldSet", field: "name", value: "  " },
      { ...base, eventId: "019a-0004", enteredAt: 4000, kind: "noteAdded", text: "Awake" },
    ]);

    expect(state.name?.value).toBe("Kari Nordmann");
  });
});

// A narrow enteredAt range so ties on enteredAt are common.
const arbEvent: fc.Arbitrary<Event> = fc
  .record({
    eventId: fc.uuid({ version: 7 }),
    enteredAt: fc.integer({ min: 0, max: 5 }),
    body: fc.oneof(
      fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("name"), value: fc.string() }),
      fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("dob"), value: fc.constantFrom("1970-01-01", "1980-06-15") }),
      fc.record({ kind: fc.constant("fieldSet"), field: fc.constant("triage"), value: fc.constantFrom("red", "orange", "yellow", "green", "blue") }),
      fc.record({ kind: fc.constant("vitalAdded"), vitals: fc.record({ pulse: fc.integer({ min: 30, max: 200 }) }) }),
      fc.record({ kind: fc.constant("noteAdded"), text: fc.string({ minLength: 1 }) }),
      fc.record({ kind: fc.constant("legCompleted") }),
    ),
  })
  .map(({ eventId, enteredAt, body }) => ({ ...base, eventId, enteredAt, ...body }) as Event);

const arbEvents = fc.uniqueArray(arbEvent, { selector: (e) => e.eventId, maxLength: 12 });

describe("applyEvent properties", () => {
  it("folds every permutation of a set of events to the same state", () => {
    fc.assert(
      fc.property(
        arbEvents.chain((events) => fc.tuple(fc.constant(events), fc.shuffledSubarray(events, { minLength: events.length }))),
        ([events, shuffled]) => {
          expect(fold(shuffled)).toEqual(fold(events));
        },
      ),
    );
  });

  it("changes nothing when an event is applied again", () => {
    fc.assert(
      fc.property(arbEvents, fc.nat(), (events, pick) => {
        fc.pre(events.length > 0);
        const state = fold(events);
        const again = events[pick % events.length]!;
        expect(applyEvent(state, again)).toEqual(state);
      }),
    );
  });
});
