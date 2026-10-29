// A built-in state for the Coordinator page until it is connected to /watch (#21).
import type { EventBase } from "../shared/event.ts";
import type { CoordinatorState } from "./CoordinatorPage.tsx";

const t0 = Date.UTC(2026, 9, 29, 9, 0);
const minutes = (n: number) => t0 + n * 60_000;

const alpha = { deviceId: "3f9c2b1e-5a7d-4c21-9e8f-0b6d2a4c7e11", resourceId: "alpha-1" };
const bravo = { deviceId: "a81d47c0-2e6b-4f93-8d15-7c3e9b0f5a22", resourceId: "bravo-2" };
const alphaLeg = "019a2f00-0000-7000-8000-00000000a001";

const eoc = (n: number, incidentId: string, patientId: string): EventBase => ({
  eventId: `019a2f00-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`,
  enteredAt: minutes(n),
  incidentId,
  patientId,
  source: { type: "eoc" },
});

const fromAlpha = (n: number): EventBase => ({
  ...eoc(n, "INC-1001", "p-1001"),
  source: { type: "device", ...alpha, legId: alphaLeg },
});

// Alpha 1 has written five events but the Coordinator's Offset for it is 3, as between an
// `events` and its `device` message; Bravo 2 has an Offset of 0 and no events.
export const sampleCoordinatorState: CoordinatorState = {
  live: true,
  epoch: "6b0e3d52-91f4-4a7c-b2d8-5e1f0c9a3b74",
  incidents: [
    {
      incidentId: "INC-1001",
      createdAt: minutes(1),
      closed: false,
      legs: [{ legId: alphaLeg, resourceId: "alpha-1", createdAt: minutes(1), completedAt: null }],
      patientId: "p-1001",
      patient: {
        name: { value: "Kari Nordmann", enteredAt: minutes(1), eventId: eoc(1, "INC-1001", "p-1001").eventId },
        dob: { value: "1961-04-17", enteredAt: minutes(3), eventId: fromAlpha(3).eventId },
        triage: { value: "red", enteredAt: minutes(5), eventId: fromAlpha(5).eventId },
        vitals: [{ vitals: { pulse: 112, spo2: 94 }, enteredAt: minutes(4), eventId: fromAlpha(4).eventId }],
        notes: [],
      },
    },
    {
      incidentId: "INC-1002",
      createdAt: minutes(6),
      closed: false,
      legs: [{ legId: "019a2f00-0000-7000-8000-00000000b001", resourceId: "bravo-2", createdAt: minutes(6), completedAt: null }],
      patientId: "p-1002",
      patient: {
        triage: { value: "yellow", enteredAt: minutes(6), eventId: eoc(6, "INC-1002", "p-1002").eventId },
        vitals: [],
        notes: [],
      },
    },
  ],
  events: [
    { rowid: 1, deviceId: null, seq: null, event: { ...eoc(1, "INC-1001", "p-1001"), kind: "fieldSet", field: "name", value: "Kari Nordmann" } },
    { rowid: 2, deviceId: null, seq: null, event: { ...eoc(2, "INC-1001", "p-1001"), kind: "fieldSet", field: "triage", value: "orange" } },
    { rowid: 3, deviceId: alpha.deviceId, seq: 1, event: { ...fromAlpha(3), kind: "fieldSet", field: "dob", value: "1961-04-17" } },
    { rowid: 4, deviceId: alpha.deviceId, seq: 2, event: { ...fromAlpha(4), kind: "vitalAdded", vitals: { pulse: 112, spo2: 94 } } },
    { rowid: 5, deviceId: alpha.deviceId, seq: 3, event: { ...fromAlpha(5), kind: "fieldSet", field: "triage", value: "red" } },
    { rowid: 6, deviceId: null, seq: null, event: { ...eoc(6, "INC-1002", "p-1002"), kind: "fieldSet", field: "triage", value: "yellow" } },
    { rowid: 7, deviceId: alpha.deviceId, seq: 4, event: { ...fromAlpha(7), kind: "noteAdded", text: "Chest pain since 08:30, given aspirin" } },
    { rowid: 8, deviceId: alpha.deviceId, seq: 5, event: { ...fromAlpha(8), kind: "vitalAdded", vitals: { systolic: 138, diastolic: 86, respRate: 20 } } },
  ],
  devices: [
    { ...alpha, offset: 3, connected: true },
    { ...bravo, offset: 0, connected: false },
  ],
};
