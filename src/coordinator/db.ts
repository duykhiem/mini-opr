import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Event, Triage } from "../shared/event.ts";
import type { Incident, TransferLeg } from "../shared/incident.ts";
import { parseEvent } from "../shared/parseEvent.ts";
import { applyEvent, emptyPatient, type PatientState } from "../shared/patient.ts";
import type { LoggedEvent } from "../shared/protocol.ts";
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

// A row in devices: without connectivity, which only the Coordinator knows in memory (ADR 0008).
export type StoredDevice = Omit<DeviceStatus, "connected">;

export function listDevices(db: DatabaseSync): StoredDevice[] {
  return db.prepare('SELECT deviceId, resourceId, "offset" FROM devices ORDER BY deviceId').all() as StoredDevice[];
}

// Undefined once the row is gone, as after a Reset.
export function readDevice(db: DatabaseSync, deviceId: string): StoredDevice | undefined {
  return db.prepare('SELECT deviceId, resourceId, "offset" FROM devices WHERE deviceId = ?').get(deviceId) as
    | StoredDevice
    | undefined;
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

function eventsOf(db: DatabaseSync, incidentId: string): Event[] {
  const rows = db.prepare("SELECT body FROM events WHERE incidentId = ? ORDER BY rowid").all(incidentId) as { body: string }[];
  return rows.map((row) => JSON.parse(row.body) as Event);
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

  return {
    incidents: rows.map((row) => readIncident(db, row.incidentId)),
    events: rows.flatMap((row) => eventsOf(db, row.incidentId)),
  };
}

// A Join: one transaction that inserts an Active Transfer leg for the Resource (ADR 0006). A Resource may Join
// the same Incident any number of times, even while it holds an Active leg there.
// Returns the Incident with its full event history, or null when the Incident does not exist.
export function joinIncident(
  db: DatabaseSync,
  incidentId: string,
  resourceId: string,
  now: number,
): { incident: Incident; events: Event[] } | null {
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM incidents WHERE incidentId = ?").get(incidentId) === undefined) return null;
    db.prepare("INSERT INTO transfer_legs (legId, incidentId, resourceId, createdAt) VALUES (?, ?, ?, ?)").run(
      randomUUID(),
      incidentId,
      resourceId,
      now,
    );
    return { incident: readIncident(db, incidentId), events: eventsOf(db, incidentId) };
  });
}

// A LoggedEvent as it arrives, before parseEvent has checked the event.
export type PushItem = Omit<LoggedEvent, "event"> & { event: unknown };

// A stored push batch: the Device's new Offset, the events it stored and each Incident they touched.
export type StoredPush = { offset: number; events: StoredEvent[]; incidents: Incident[] };

// A bad event is a bug: nothing of the batch is stored and the Offset stays (ADR 0005).
export type RejectedPush = { seq: number; reason: string };

class BadEvent extends Error {
  readonly seq: number;
  readonly reason: string;

  constructor(seq: number, reason: string) {
    super(reason);
    this.seq = seq;
    this.reason = reason;
  }
}

// Checks one Device event against the hello and the tables; throws BadEvent for the first rule it breaks.
function checkDeviceEvent(db: DatabaseSync, device: Omit<StoredDevice, "offset">, { seq, event: input }: PushItem): Event {
  const event = parseEvent(input);
  if ("error" in event) throw new BadEvent(seq, event.error);
  const { source } = event;
  if (source.type !== "device") throw new BadEvent(seq, "a Device can only push device events");
  if (source.deviceId !== device.deviceId) throw new BadEvent(seq, `deviceId ${source.deviceId} differs from the hello`);
  if (source.resourceId !== device.resourceId) throw new BadEvent(seq, `resourceId ${source.resourceId} differs from the hello`);
  const patient = db.prepare("SELECT patientId FROM patients WHERE incidentId = ?").get(event.incidentId) as
    | { patientId: string }
    | undefined;
  if (patient === undefined) throw new BadEvent(seq, `unknown Incident ${event.incidentId}`);
  const leg = db
    .prepare("SELECT 1 FROM transfer_legs WHERE legId = ? AND incidentId = ? AND resourceId = ?")
    .get(source.legId, event.incidentId, device.resourceId);
  if (leg === undefined) throw new BadEvent(seq, `legId ${source.legId} is not this Resource's leg in ${event.incidentId}`);
  if (event.patientId !== patient.patientId) throw new BadEvent(seq, `patientId ${event.patientId} is not ${event.incidentId}'s`);
  if (db.prepare("SELECT 1 FROM events WHERE eventId = ?").get(event.eventId) !== undefined) {
    throw new BadEvent(seq, `eventId ${event.eventId} is already stored`);
  }
  return event;
}

// One push batch is one transaction: insert each event, apply it to the Patient, bump the Offset (ADR 0006).
// seq <= Offset is skipped; a gap after the Offset is a bug.
export function storePush(db: DatabaseSync, device: Omit<StoredDevice, "offset">, items: PushItem[]): StoredPush | RejectedPush {
  try {
    return transaction(db, () => {
      let { offset } = db.prepare('SELECT "offset" FROM devices WHERE deviceId = ?').get(device.deviceId) as { offset: number };
      const insert = db.prepare(
        "INSERT INTO events (eventId, incidentId, kind, enteredAt, deviceId, seq, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const readPatient = db.prepare("SELECT state FROM patients WHERE incidentId = ?");
      const writePatient = db.prepare("UPDATE patients SET state = ? WHERE incidentId = ?");
      const events: StoredEvent[] = [];
      const touched = new Set<string>();

      for (const item of items) {
        if (item.seq <= offset) continue;
        if (item.seq > offset + 1) throw new BadEvent(item.seq, `seq ${item.seq} leaves a gap after Offset ${offset}`);
        const event = checkDeviceEvent(db, device, item);
        const { lastInsertRowid } = insert.run(
          event.eventId,
          event.incidentId,
          event.kind,
          event.enteredAt,
          device.deviceId,
          item.seq,
          JSON.stringify(event),
        );
        const { state } = readPatient.get(event.incidentId) as { state: string };
        writePatient.run(JSON.stringify(applyEvent(JSON.parse(state) as PatientState, event)), event.incidentId);
        events.push({ rowid: Number(lastInsertRowid), deviceId: device.deviceId, seq: item.seq, event });
        touched.add(event.incidentId);
        offset = item.seq;
      }

      db.prepare('UPDATE devices SET "offset" = ? WHERE deviceId = ?').run(offset, device.deviceId);
      return { offset, events, incidents: [...touched].map((incidentId) => readIncident(db, incidentId)) };
    });
  } catch (error) {
    if (error instanceof BadEvent) return { seq: error.seq, reason: error.reason };
    throw error;
  }
}
