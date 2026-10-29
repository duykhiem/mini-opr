import { useState, type FormEvent } from "react";
import { triages } from "../shared/event.ts";
import type { Incident } from "../shared/incident.ts";
import type { Resource } from "../shared/resource.ts";
import { useResources } from "./useResources.ts";
import { useWatch } from "./useWatch.ts";

const emptyForm = { resourceId: "", name: "", dob: "", triage: "" };

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
      <header className="page-header">
        <h1>EOC</h1>
        <span className={connected ? "status live" : "status"}>{connected ? "live" : "disconnected"}</span>
      </header>
      <div className="eoc-layout">
        <form onSubmit={submit} className="card form">
          <h2>New Incident</h2>
          <label className="field">
            <span>
              Patient name <span className="optional">(optional)</span>
            </span>
            <input value={form.name} onChange={set("name")} />
          </label>
          <label className="field">
            <span>
              Date of birth <span className="optional">(optional)</span>
            </span>
            <input type="date" value={form.dob} onChange={set("dob")} />
          </label>
          <label className="field">
            <span>
              Triage <span className="optional">(optional)</span>
            </span>
            <select value={form.triage} onChange={set("triage")}>
              <option value="">Not set</option>
              {triages.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Resource for the first Transfer leg
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
          <button type="submit" className="button-primary" disabled={pending}>
            {pending ? "Creating..." : "Create Incident"}
          </button>
          {error && (
            <p role="alert" className="alert">
              {error}
            </p>
          )}
          {resourcesError && (
            <p role="alert" className="alert">
              {resourcesError}
            </p>
          )}
        </form>
        <IncidentTable incidents={data?.incidents ?? []} resources={resources} dimmed={!connected} highlightId={createdId} />
      </div>
    </main>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="button-small" onClick={() => void copy()}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function IncidentTable(props: { incidents: Incident[]; resources: Resource[]; dimmed: boolean; highlightId?: string }) {
  const resourceName = (resourceId: string) => props.resources.find((r) => r.resourceId === resourceId)?.name ?? resourceId;
  const newestFirst = [...props.incidents].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <section className={props.dimmed ? "card table-card dimmed" : "card table-card"}>
      <h2>Incidents</h2>
      {newestFirst.length === 0 ? (
        <p className="empty">No Incidents yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {["Incident", "Patient name", "Triage", "Transfer legs", "State", "Created"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((incident) => (
              <tr key={incident.incidentId} className={incident.incidentId === props.highlightId ? "highlight" : undefined}>
                <td>
                  <span className="incident-id">
                    <code>{incident.incidentId}</code>
                    <CopyButton text={incident.incidentId} />
                  </span>
                </td>
                <td>{incident.patient.name?.value ?? <span className="muted">Unknown</span>}</td>
                <td>
                  {incident.patient.triage ? (
                    <span className={`badge triage-${incident.patient.triage.value}`}>{incident.patient.triage.value}</span>
                  ) : (
                    <span className="muted">Not set</span>
                  )}
                </td>
                <td>
                  <div className="legs">
                    {incident.legs.map((leg) => (
                      <span key={leg.legId} className="leg">
                        {resourceName(leg.resourceId)}
                        <span className={leg.completedAt === null ? "badge state-active" : "badge state-closed"}>
                          {leg.completedAt === null ? "Active" : "Completed"}
                        </span>
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={incident.closed ? "badge state-closed" : "badge state-active"}>
                    {incident.closed ? "Closed" : "Active"}
                  </span>
                </td>
                <td>{new Date(incident.createdAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
