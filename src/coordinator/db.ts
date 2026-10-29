import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Resource } from "../shared/resource.ts";

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

export function listResources(db: DatabaseSync): Resource[] {
  return db.prepare("SELECT resourceId, name FROM resources ORDER BY resourceId").all() as Resource[];
}
