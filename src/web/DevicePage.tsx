import { useState, type FormEvent, type ReactNode } from "react";
import type { JoinResult } from "../device/syncClient.ts";
import type { Event, Vitals } from "../shared/event.ts";
import { isActive, type Incident } from "../shared/incident.ts";
import { applyEvent, compareStamps, emptyPatient } from "../shared/patient.ts";
import type { Resource } from "../shared/resource.ts";
import { useDeviceLock } from "./useDeviceLock.ts";
import { useResources } from "./useResources.ts";
import { useSyncClient } from "./useSyncClient.ts";

export function DevicePage({ resourceId: initialResourceId }: { resourceId: string | null }) {
  const { resources, error } = useResources();
  const [resourceId, setResourceId] = useState(initialResourceId);
  const lock = useDeviceLock(resourceId);

  // Choosing a Resource writes ?resource= so a reload reopens the same Device.
  function choose(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("resource", id);
    window.history.replaceState(null, "", url);
    setResourceId(id);
  }

  const resourceName = (id: string) => resources.find((r) => r.resourceId === id)?.name ?? id;

  const picker = <ResourcePicker resources={resources} resourceId={resourceId} onChoose={choose} />;

  return (
    <main>
      {resourceId !== null && lock === "held" ? (
        <Device key={resourceId} resourceId={resourceId} resourceName={resourceName} picker={picker} />
      ) : (
        <header>{picker}</header>
      )}
      {error && <p role="alert">{error}</p>}
      {resourceId === null && <p>Pick a Resource.</p>}
      {resourceId !== null && lock === "taken" && (
        <p role="alert">Resource {resourceName(resourceId)} is already open in another tab.</p>
      )}
    </main>
  );
}

function ResourcePicker(props: { resources: Resource[]; resourceId: string | null; onChoose: (id: string) => void }) {
  return (
    <label>
      Resource{" "}
      <select value={props.resourceId ?? ""} onChange={(e) => props.onChoose(e.target.value)}>
        <option value="" disabled>
          Choose
        </option>
        {props.resources.map((r) => (
          <option key={r.resourceId} value={r.resourceId}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Device(props: { resourceId: string; resourceName: (id: string) => string; picker: ReactNode }) {
  const { resourceId, resourceName } = props;
  const { state, join } = useSyncClient(resourceId);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const incident = state.incidents.find((i) => i.incidentId === incidentId);

  return (
    <>
      <header>
        {props.picker}
        <span> {state.online ? "online" : "offline"}</span>
        {state.error && <span role="alert"> sync error: {state.error}</span>}
        <JoinField join={join} onJoined={setIncidentId} />
      </header>
      <section>
        <h2>Incidents</h2>
        {state.incidents.length === 0 && <p>No Incidents yet.</p>}
        <ul>
          {state.incidents.map((i) => (
            <li key={i.incidentId}>
              <button onClick={() => setIncidentId(i.incidentId)} aria-pressed={i.incidentId === incidentId}>
                {i.incidentId} ({incidentStatus(i)})
              </button>
            </li>
          ))}
        </ul>
      </section>
      {incident && (
        <IncidentView
          incident={incident}
          events={state.received.filter((e) => e.incidentId === incident.incidentId)}
          resourceName={resourceName}
        />
      )}
    </>
  );
}

// Join by a pasted Incident id (Handover, no accept step). A failure shows its reason under the field.
function JoinField(props: { join: (incidentId: string) => Promise<JoinResult>; onJoined: (incidentId: string) => void }) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const incidentId = value.trim();
    if (incidentId === "") return;
    setPending(true);
    setError(undefined);
    const result = await props.join(incidentId);
    setPending(false);
    if (result.ok) {
      setValue("");
      props.onJoined(incidentId);
    } else {
      setError(joinFailure(result.reason, incidentId));
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Join Incident <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="INC-0001" />
      </label>
      <button type="submit" disabled={pending || value.trim() === ""}>
        {pending ? "Joining..." : "Join"}
      </button>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function joinFailure(reason: Exclude<JoinResult, { ok: true }>["reason"], incidentId: string): string {
  switch (reason) {
    case "offline":
      return "Offline: Join needs the network. Try again when the Device is online.";
    case "unknown":
      return `Unknown Incident id ${incidentId}.`;
  }
}

function IncidentView(props: { incident: Incident; events: Event[]; resourceName: (id: string) => string }) {
  const { incident, resourceName } = props;
  const events = [...props.events].sort(compareStamps);
  const patient = events.reduce(applyEvent, emptyPatient);
  const latestVitals = patient.vitals.at(-1)?.vitals;

  return (
    <section>
      <h2>
        {incident.incidentId} ({incidentStatus(incident)})
      </h2>
      <dl>
        <dt>Name</dt>
        <dd>{patient.name?.value ?? "-"}</dd>
        <dt>Date of birth</dt>
        <dd>{patient.dob?.value ?? "-"}</dd>
        <dt>Triage</dt>
        <dd>{patient.triage?.value ?? "-"}</dd>
        <dt>Latest vitals</dt>
        <dd>{latestVitals ? formatVitals(latestVitals) : "-"}</dd>
      </dl>
      <h3>Transfer legs</h3>
      <ul>
        {incident.legs.map((leg) => (
          <li key={leg.legId}>
            {resourceName(leg.resourceId)}: {isActive(leg) ? "Active" : "Completed"}
          </li>
        ))}
      </ul>
      <h3>Feed</h3>
      <ol>
        {events.map((e) => (
          <li key={e.eventId}>
            {new Date(e.enteredAt).toLocaleTimeString()} {sourceLabel(e, resourceName)}: {describeEvent(e)}
          </li>
        ))}
      </ol>
    </section>
  );
}

function sourceLabel(event: Event, resourceName: (id: string) => string): string {
  return event.source.type === "eoc" ? "EOC" : resourceName(event.source.resourceId);
}

function formatVitals(vitals: Vitals): string {
  return Object.entries(vitals)
    .map(([name, value]) => `${name} ${value}`)
    .join(", ");
}

function incidentStatus(incident: Incident): string {
  return incident.closed ? "Closed" : "Active";
}

function describeEvent(event: Event): string {
  switch (event.kind) {
    case "fieldSet":
      return `${event.field} set to ${event.value}`;
    case "vitalAdded":
      return `vitals ${formatVitals(event.vitals)}`;
    case "noteAdded":
      return `note: ${event.text}`;
    case "legCompleted":
      return "Transfer leg completed";
  }
}
