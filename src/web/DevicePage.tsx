import { useState, type FormEvent, type ReactNode } from "react";
import type { JoinResult, LoggedEvent } from "../device/syncClient.ts";
import type { Event, Vitals } from "../shared/event.ts";
import { isActive, type Incident } from "../shared/incident.ts";
import { applyEvent, compareStamps, emptyPatient } from "../shared/patient.ts";
import type { Resource } from "../shared/resource.ts";
import { Composer } from "./Composer.tsx";
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
  const { deviceId, state, join, record } = useSyncClient(resourceId);
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
          key={incident.incidentId}
          incident={incident}
          events={state.received.filter((e) => e.incidentId === incident.incidentId)}
          log={state.log.filter((e) => e.event.incidentId === incident.incidentId)}
          offset={state.offset}
          device={{ deviceId, resourceId }}
          onEvent={record}
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

function IncidentView(props: {
  incident: Incident;
  events: Event[]; // received from the Coordinator
  log: LoggedEvent[]; // this Device's own events in the Incident
  offset: number;
  device: { deviceId: string; resourceId: string };
  onEvent: (event: Event) => void;
  resourceName: (id: string) => string;
}) {
  const { incident, resourceName } = props;
  const [view, setView] = useState<"feed" | "log">("feed");
  // The Device's own events show at once, before the Coordinator stores them.
  const received = new Set(props.events.map((e) => e.eventId));
  const events = [...props.events, ...props.log.map((e) => e.event).filter((e) => !received.has(e.eventId))].sort(compareStamps);
  const patient = events.reduce(applyEvent, emptyPatient);
  const latestVitals = patient.vitals.at(-1)?.vitals;
  // A legCompleted in the feed counts at once, before the Coordinator's incident shows the leg Completed,
  // so the leg tab goes away as soon as this Device writes one.
  const completedLegIds = new Set(events.flatMap((e) => (e.kind === "legCompleted" && e.source.type === "device" ? [e.source.legId] : [])));
  const myLegs = incident.legs.filter((l) => l.resourceId === props.device.resourceId);
  const activeLeg = myLegs.findLast((l) => isActive(l) && !completedLegIds.has(l.legId));
  // The Resource writes under its Active leg, or after Handover under its latest completed one (ADR 0003).
  const leg = activeLeg ?? myLegs.at(-1);

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
      <div className="view-toggle" role="group" aria-label="View">
        <button type="button" aria-pressed={view === "feed"} onClick={() => setView("feed")}>
          Feed
        </button>
        <button type="button" aria-pressed={view === "log"} onClick={() => setView("log")}>
          My Event log
        </button>
      </div>
      {view === "feed" ? (
        <ol>
          {events.map((e) => (
            <li key={e.eventId}>
              {new Date(e.enteredAt).toLocaleTimeString()} {sourceLabel(e, resourceName)}: {describeEvent(e)}
            </li>
          ))}
        </ol>
      ) : (
        <ol>
          {props.log.length === 0 && <li>No events from this Device yet.</li>}
          {props.log.map(({ seq, event }) => (
            <li key={event.eventId}>
              #{seq} {new Date(event.enteredAt).toLocaleTimeString()} {describeEvent(event)} ({seq <= props.offset ? "stored" : "waiting"})
            </li>
          ))}
        </ol>
      )}
      {leg && (
        // Closed is the Coordinator's: no leg is Active. With my own leg completed I can still edit until then.
        <Composer
          incidentId={incident.incidentId}
          patientId={incident.patientId}
          device={{ ...props.device, legId: leg.legId }}
          clock={Date.now}
          holdsActiveLeg={activeLeg !== undefined}
          locked={incident.closed}
          onEvent={props.onEvent}
        />
      )}
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
