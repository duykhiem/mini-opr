import { useState, type FormEvent } from "react";
import { triages } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import type { Resource } from "../shared/resource.ts";
import { useResources } from "./useResources.ts";
import { useWatch } from "./useWatch.ts";

const emptyForm = { resourceId: "", name: "", dob: "", triage: "" };
const cell = { padding: "0.25rem 0.75rem" };

// Creates over HTTP; a failed create keeps the form and is not retried (ADR 0008).
async function postIncident(form: typeof emptyForm): Promise<Incident> {
  const body: Record<string, string> = { resourceId: form.resourceId };
  if (form.name.trim() !== "") body.name = form.name.trim();
  if (form.dob !== "") body.dob = form.dob;
  if (form.triage !== "") body.triage = form.triage;

  let response: Response;
  try {
    response = await fetch("/api/incidents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the Coordinator.");
  }
  const result = (await response.json().catch(() => ({}))) as { incident?: Incident; error?: string };
  if (response.status !== 201 || !result.incident) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result.incident;
}

export function EocPage() {
  const { resources, error: resourcesError } = useResources();
  const { connected, data } = useWatch();
  const [form, setForm] = useState(emptyForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [createdId, setCreatedId] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      const incident = await postIncident(form);
      setForm(emptyForm);
      // Highlights the row whether /watch delivered it before or after this response.
      setCreatedId(incident.incidentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const set = (field: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <main>
      <h1>
        EOC <small>{connected ? "live" : "disconnected"}</small>
      </h1>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(14rem, 18rem) 1fr", gap: "2rem", alignItems: "start" }}>
        <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
          <h2>New Incident</h2>
          <label>
            Patient name
            <br />
            <input value={form.name} onChange={set("name")} />
          </label>
          <label>
            Date of birth
            <br />
            <input type="date" value={form.dob} onChange={set("dob")} />
          </label>
          <label>
            Triage
            <br />
            <select value={form.triage} onChange={set("triage")}>
              <option value="">Not set</option>
              {triages.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resource for the first Transfer leg
            <br />
            <select required value={form.resourceId} onChange={set("resourceId")}>
              <option value="" disabled>
                Choose a Resource
              </option>
              {resources.map((r) => (
                <option key={r.resourceId} value={r.resourceId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending}>
            Create Incident
          </button>
          {error && <p role="alert">{error}</p>}
          {resourcesError && <p role="alert">{resourcesError}</p>}
        </form>
        <IncidentTable incidents={data?.incidents ?? []} resources={resources} dimmed={!connected} highlightId={createdId} />
      </div>
    </main>
  );
}

function IncidentTable(props: { incidents: Incident[]; resources: Resource[]; dimmed: boolean; highlightId?: string }) {
  const resourceName = (resourceId: string) => props.resources.find((r) => r.resourceId === resourceId)?.name ?? resourceId;
  const newestFirst = [...props.incidents].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <table style={{ opacity: props.dimmed ? 0.5 : 1, borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {["Incident", "Patient name", "Triage", "Transfer legs", "State", "Created"].map((h) => (
            <th key={h} style={{ ...cell, textAlign: "left" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((incident) => (
          <tr key={incident.incidentId} style={{ background: incident.incidentId === props.highlightId ? "#fff3b0" : undefined }}>
            <td style={cell}>
              <code>{incident.incidentId}</code>{" "}
              <button type="button" onClick={() => void navigator.clipboard.writeText(incident.incidentId)}>
                Copy
              </button>
            </td>
            <td style={cell}>{incident.patient.name?.value ?? ""}</td>
            <td style={cell}>{incident.patient.triage?.value ?? ""}</td>
            <td style={cell}>
              {incident.legs.map((leg) => (
                <div key={leg.legId}>
                  {resourceName(leg.resourceId)}: {leg.completedAt === null ? "Active" : "Completed"}
                </div>
              ))}
            </td>
            <td style={cell}>{incident.closed ? "Closed" : "Active"}</td>
            <td style={cell}>{new Date(incident.createdAt).toLocaleTimeString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
