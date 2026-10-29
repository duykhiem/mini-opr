import type { Event, Triage, Vitals } from "./event.ts";

// The stamp of the Event that last set a field, for last-write-wins.
export type Stamp = { enteredAt: number; eventId: string };

export type FieldValue<T> = { value: T } & Stamp;

export type VitalsEntry = { vitals: Vitals } & Stamp;
export type NoteEntry = { text: string } & Stamp;

export type PatientState = {
  name?: FieldValue<string>;
  dob?: FieldValue<string>;
  triage?: FieldValue<Triage>;
  vitals: VitalsEntry[]; // sorted by (enteredAt, eventId)
  notes: NoteEntry[]; // sorted by (enteredAt, eventId)
};

export const emptyPatient: PatientState = { vitals: [], notes: [] };

// Orders by enteredAt, then by eventId (string compare of UUIDv7).
function compareStamps(a: Stamp, b: Stamp): number {
  if (a.enteredAt !== b.enteredAt) return a.enteredAt - b.enteredAt;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

function isNewer(a: Stamp, b: Stamp | undefined): boolean {
  return b === undefined || compareStamps(a, b) > 0;
}

// Applying the same Event again leaves the entries unchanged.
function insertSorted<T extends Stamp>(entries: T[], entry: T): T[] {
  if (entries.some((e) => e.eventId === entry.eventId)) return entries;
  return [...entries, entry].sort(compareStamps);
}

export function applyEvent(state: PatientState, event: Event): PatientState {
  const stamp: Stamp = { enteredAt: event.enteredAt, eventId: event.eventId };
  switch (event.kind) {
    case "fieldSet":
      // A field can be overwritten but never set back to empty.
      if (event.value.trim() === "" || !isNewer(stamp, state[event.field])) return state;
      return { ...state, [event.field]: { value: event.value, ...stamp } };
    case "vitalAdded":
      return { ...state, vitals: insertSorted(state.vitals, { vitals: event.vitals, ...stamp }) };
    case "noteAdded":
      return { ...state, notes: insertSorted(state.notes, { text: event.text, ...stamp }) };
    case "legCompleted":
      return state;
  }
}
