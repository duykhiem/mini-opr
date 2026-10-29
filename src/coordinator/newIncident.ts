import { triages, type Triage } from "../shared/event.ts";
import type { NewIncident } from "./db.ts";

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// Checks a POST /api/incidents body against the event schema (ADR 0003); returns the reason on failure.
export function parseNewIncident(body: unknown, resourceIds: string[]): NewIncident | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { error: "body must be a JSON object" };
  const { resourceId, name, dob, triage } = body as Record<string, unknown>;

  if (typeof resourceId !== "string" || !resourceIds.includes(resourceId)) return { error: "resourceId is not a known Resource" };
  if (name !== undefined && (typeof name !== "string" || name.trim() === "")) return { error: "name must be a non-empty string" };
  if (dob !== undefined && (typeof dob !== "string" || !isRealDate(dob))) return { error: "dob must be a date as YYYY-MM-DD" };
  if (triage !== undefined && !triages.includes(triage as Triage))
    return { error: `triage must be one of ${triages.join(", ")}` };

  return { resourceId, name, dob, triage: triage as Triage | undefined };
}
