import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Event, Triage } from "../shared/event.ts";
import type { Incident, TransferLeg } from "../shared/incident.ts";
import { applyEvent, emptyPatient, type PatientState } from "../shared/patient.ts";
import type { Resource } from "../shared/resource.ts";
import { uuidv7 } from "../shared/uuidv7.ts";
import type { DeviceStatus, StoredEvent } from "../shared/watch.ts";

// Tables from ADR 0006.
const schema = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resources (
  resourceId TEXT PRIMARY KEY,
  name       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  incidentId TEXT PRIMARY KEY,
  createdAt  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS transfer_legs (
  legId            TEXT PRIMARY KEY,
  incidentId       TEXT NOT NULL REFERENCES incidents (incidentId),
  resourceId       TEXT NOT NULL REFERENCES resources (resourceId),
  createdAt        INTEGER NOT NULL,
  completedAt      INTEGER,
  completedEventId TEXT
);
CREATE TABLE IF NOT EXISTS patients (
  patientId  TEXT PRIMARY KEY,
  incidentId TEXT NOT NULL REFERENCES incidents (incidentId),
  state      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  rowid      INTEGER PRIMARY KEY,
  eventId    TEXT NOT NULL UNIQUE,
  incidentId TEXT NOT NULL REFERENCES incidents (incidentId),
  kind       TEXT NOT NULL,
  enteredAt  INTEGER NOT NULL,
  deviceId   TEXT,
  seq        INTEGER,
  body       TEXT NOT NULL,
  UNIQUE (deviceId, seq)
);
CREATE TABLE IF NOT EXISTS devices (
  deviceId   TEXT PRIMARY KEY,
  resourceId TEXT NOT NULL REFERENCES resources (resourceId),
  "offset"   INTEGER NOT NULL DEFAULT 0
);
`;

const seedResources: Resource[] = [
  { resourceId: "alpha-1", name: "Alpha 1" },
  { resourceId: "bravo-2", name: "Bravo 2" },
  { resourceId: "charlie-3", name: "Charlie 3" },
];

// node:sqlite has no transaction helper (ADR 0002).
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  transaction(db, () => {
    db.exec(schema);
    const insertResource = db.prepare("INSERT OR IGNORE INTO resources (resourceId, name) VALUES (?, ?)");
    for (const { resourceId, name } of seedResources) insertResource.run(resourceId, name);
    // The first start writes the Coordinator epoch; a plain restart keeps it.
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('epoch', ?)").run(randomUUID());
  });
  return db;
}

export function readEpoch(db: DatabaseSync): string {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'epoch'").get() as { value: string };
  return row.value;
}

// Starts the demo over: drops everything but resources and writes a new Coordinator epoch, in one transaction.
// devices goes too: a Device restarts seq at 1, so an old Offset would skip its new events.
// Returns the new epoch.
export function resetDatabase(db: DatabaseSync): string {
  const epoch = randomUUID();
  transaction(db, () => {
    for (const table of ["events", "patients", "transfer_legs", "incidents", "devices"]) db.exec(`DELETE FROM ${table}`);
    db.prepare("UPDATE meta SET value = ? WHERE key = 'epoch'").run(epoch);
  });
  return epoch;
}

export function listResources(db: DatabaseSync): Resource[] {
  return db.prepare("SELECT resourceId, name FROM resources ORDER BY resourceId").all() as Resource[];
}

export type NewIncident = { resourceId: string; name?: string; dob?: string; triage?: Triage };

// The next INC- number; ids are unique within a Coordinator epoch because Reset clears incidents.
function nextIncidentId(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT COALESCE(MAX(CAST(substr(incidentId, 5) AS INTEGER)), 0) + 1 AS next FROM incidents")
    .get() as { next: number };
  return `INC-${String(row.next).padStart(4, "0")}`;
}

// The Incident, its first Transfer leg, an empty Patient and one EOC fieldSet per given field, in one transaction (ADR 0006).
export function createIncident(db: DatabaseSync, input: NewIncident, now: number): { incident: Incident; events: StoredEvent[] } {
  return transaction(db, () => {
    const incidentId = nextIncidentId(db);
    const patientId = randomUUID();
    db.prepare("INSERT INTO incidents (incidentId, createdAt) VALUES (?, ?)").run(incidentId, now);
    db.prepare("INSERT INTO transfer_legs (legId, incidentId, resourceId, createdAt) VALUES (?, ?, ?, ?)").run(
      randomUUID(),
      incidentId,
      input.resourceId,
      now,
    );

    const base = { enteredAt: now, incidentId, patientId, source: { type: "eoc" } } as const;
    const fieldEvents: Event[] = [];
    if (input.name !== undefined) fieldEvents.push({ ...base, eventId: uuidv7(now), kind: "fieldSet", field: "name", value: input.name });
    if (input.dob !== undefined) fieldEvents.push({ ...base, eventId: uuidv7(now), kind: "fieldSet", field: "dob", value: input.dob });
    if (input.triage !== undefined) fieldEvents.push({ ...base, eventId: uuidv7(now), kind: "fieldSet", field: "triage", value: input.triage });

    const insertEvent = db.prepare(
      "INSERT INTO events (eventId, incidentId, kind, enteredAt, deviceId, seq, body) VALUES (?, ?, ?, ?, NULL, NULL, ?)",
    );
    const events = fieldEvents.map((event): StoredEvent => {
      const { lastInsertRowid } = insertEvent.run(event.eventId, incidentId, event.kind, event.enteredAt, JSON.stringify(event));
      return { rowid: Number(lastInsertRowid), deviceId: null, seq: null, event };
    });
    const state = fieldEvents.reduce(applyEvent, emptyPatient);
    db.prepare("INSERT INTO patients (patientId, incidentId, state) VALUES (?, ?, ?)").run(patientId, incidentId, JSON.stringify(state));

    return { incident: readIncident(db, incidentId), events };
  });
}

function readIncident(db: DatabaseSync, incidentId: string): Incident {
  const { createdAt } = db.prepare("SELECT createdAt FROM incidents WHERE incidentId = ?").get(incidentId) as { createdAt: number };
  const legs = db
    .prepare("SELECT legId, resourceId, createdAt, completedAt FROM transfer_legs WHERE incidentId = ? ORDER BY createdAt, rowid")
    .all(incidentId) as TransferLeg[];
  const patient = db.prepare("SELECT patientId, state FROM patients WHERE incidentId = ?").get(incidentId) as {
    patientId: string;
    state: string;
  };
  return {
    incidentId,
    createdAt,
    closed: legs.every((leg) => leg.completedAt !== null),
    legs,
    patientId: patient.patientId,
    patient: JSON.parse(patient.state) as PatientState,
  };
}

export function listIncidents(db: DatabaseSync): Incident[] {
  const rows = db.prepare("SELECT incidentId FROM incidents ORDER BY createdAt, incidentId").all() as { incidentId: string }[];
  return rows.map((row) => readIncident(db, row.incidentId));
}

export function listEvents(db: DatabaseSync): StoredEvent[] {
  const rows = db.prepare("SELECT rowid, deviceId, seq, body FROM events ORDER BY rowid").all() as {
    rowid: number;
    deviceId: string | null;
    seq: number | null;
    body: string;
  }[];
  return rows.map(({ body, ...row }) => ({ ...row, event: JSON.parse(body) as Event }));
}

// Without connectivity, which only the Coordinator knows (ADR 0008).
export function listDevices(db: DatabaseSync): Omit<DeviceStatus, "connected">[] {
  return db.prepare('SELECT deviceId, resourceId, "offset" FROM devices ORDER BY deviceId').all() as Omit<DeviceStatus, "connected">[];
}

export function resourceExists(db: DatabaseSync, resourceId: string): boolean {
  return db.prepare("SELECT 1 FROM resources WHERE resourceId = ?").get(resourceId) !== undefined;
}

// Written on hello; returns the Device's Offset, 0 for a Device not seen before.
export function registerDevice(db: DatabaseSync, deviceId: string, resourceId: string): number {
  db.prepare("INSERT OR IGNORE INTO devices (deviceId, resourceId) VALUES (?, ?)").run(deviceId, resourceId);
  const row = db.prepare(`SELECT "offset" FROM devices WHERE deviceId = ?`).get(deviceId) as { offset: number };
  return row.offset;
}

// Every Incident the Resource has a leg in, with its legs and all its events.
export function snapshotFor(db: DatabaseSync, resourceId: string): { incidents: Incident[]; events: Event[] } {
  const rows = db
    .prepare(
      `SELECT incidentId FROM incidents i
       WHERE EXISTS (SELECT 1 FROM transfer_legs l WHERE l.incidentId = i.incidentId AND l.resourceId = ?)
       ORDER BY createdAt, incidentId`,
    )
    .all(resourceId) as { incidentId: string }[];
  const eventsOf = db.prepare("SELECT body FROM events WHERE incidentId = ? ORDER BY rowid");

  return {
    incidents: rows.map((row) => readIncident(db, row.incidentId)),
    events: rows.flatMap((row) =>
      (eventsOf.all(row.incidentId) as { body: string }[]).map((r) => JSON.parse(r.body) as Event),
    ),
  };
}
