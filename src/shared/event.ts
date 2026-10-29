// Event schema from ADR 0003.

export type Triage = "red" | "orange" | "yellow" | "green" | "blue";

export type Vitals = {
  // at least one present
  pulse?: number; // /min
  systolic?: number; // mmHg
  diastolic?: number; // mmHg
  spo2?: number; // %
  respRate?: number; // /min
  temperature?: number; // °C
};

export type EventSource =
  | { type: "device"; deviceId: string; resourceId: string; legId: string }
  | { type: "eoc" };

export type EventBase = {
  eventId: string; // UUIDv7
  enteredAt: number; // epoch ms
  incidentId: string;
  patientId: string;
  source: EventSource;
};

export type Event = EventBase &
  (
    | { kind: "fieldSet"; field: "name"; value: string }
    | { kind: "fieldSet"; field: "dob"; value: string } // YYYY-MM-DD
    | { kind: "fieldSet"; field: "triage"; value: Triage }
    | { kind: "vitalAdded"; vitals: Vitals }
    | { kind: "noteAdded"; text: string } // non-empty
    | { kind: "legCompleted" } // device source only
  );
