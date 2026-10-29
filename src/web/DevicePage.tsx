import { useState, type FormEvent, type ReactNode } from "react";
import type { JoinResult, LoggedEvent } from "../device/syncClient.ts";
import type { Event, Vitals } from "../shared/event.ts";
import { isActive, type Incident } from "../shared/incident.ts";
import { applyEvent, compareStamps, emptyPatient, type PatientState, type Stamp } from "../shared/patient.ts";
import type { Resource } from "../shared/resource.ts";
import { CompleteLegButton, EditableCard, NoteForm, PatientForm, TriageForm, VitalsForm, type Writer } from "./EditForms.tsx";
import { useDeviceLock } from "./useDeviceLock.ts";
import { useResources } from "./useResources.ts";
import { useSyncClient } from "./useSyncClient.ts";

type View = { page: "incidents" } | { page: "resource" } | { page: "incident"; incidentId: string };

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

  if (resourceId !== null && lock === "held") {
    return <Device key={resourceId} resourceId={resourceId} resourceName={resourceName} picker={picker} />;
  }

  // No Device yet: only the Resource menu, to pick one.
  return (
    <Shell rail={<RailItem icon={<TruckIcon />} label="Resource" current onClick={() => {}} />}>
      <ResourceView picker={picker}>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {resourceId === null && <p className="muted">Pick a Resource.</p>}
        {resourceId !== null && lock === "taken" && (
          <p role="alert" className="alert">
            Resource {resourceName(resourceId)} is already open in another tab.
          </p>
        )}
      </ResourceView>
    </Shell>
  );
}

function Shell(props: { avatar?: ReactNode; rail: ReactNode; status?: ReactNode; children: ReactNode }) {
  return (
    <div className="app-shell">
      <nav className="rail" aria-label="Device menu">
        {props.avatar}
        {props.rail}
        <div className="rail-bottom">{props.status}</div>
      </nav>
      <main>{props.children}</main>
    </div>
  );
}

function RailItem(props: { icon: ReactNode; label: string; current: boolean; onClick: () => void }) {
  return (
    <button type="button" className="rail-item" aria-current={props.current ? "page" : undefined} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function ResourcePicker(props: { resources: Resource[]; resourceId: string | null; onChoose: (id: string) => void }) {
  return (
    <label className="field">
      Resource
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

function ResourceView(props: { picker: ReactNode; children?: ReactNode }) {
  return (
    <>
      <h1 className="page-title">Resource</h1>
      <div className="resource-layout">
        <section className="card form">
          <h2>This Device</h2>
          {props.picker}
        </section>
        {props.children}
      </div>
    </>
  );
}

function Device(props: { resourceId: string; resourceName: (id: string) => string; picker: ReactNode }) {
  const { resourceId, resourceName } = props;
  const { deviceId, state, join, record } = useSyncClient(resourceId);
  const [view, setView] = useState<View>({ page: "incidents" });
  const incident = view.page === "incident" ? state.incidents.find((i) => i.incidentId === view.incidentId) : undefined;

  const received = (incidentId: string) => state.received.filter((e) => e.incidentId === incidentId);
  const log = (incidentId: string) => state.log.filter((e) => e.event.incidentId === incidentId);
  const open = (incidentId: string) => setView({ page: "incident", incidentId });

  const initials = resourceName(resourceId)
    .split(/\s+/)
    .map((word) => word[0])
    .join("");

  return (
    <Shell
      avatar={
        <span className="rail-avatar" title={resourceName(resourceId)}>
          {initials}
        </span>
      }
      rail={
        <>
          <RailItem
            icon={<GridIcon />}
            label="Incidents"
            current={view.page !== "resource"}
            onClick={() => setView({ page: "incidents" })}
          />
          <RailItem icon={<TruckIcon />} label="Resource" current={view.page === "resource"} onClick={() => setView({ page: "resource" })} />
        </>
      }
      status={
        <span className={state.online ? "rail-status online" : "rail-status offline"} role="status">
          <WifiIcon off={!state.online} />
          {state.online ? "Online" : "Offline"}
        </span>
      }
    >
      {state.error && (
        <p role="alert" className="alert sync-error">
          Sync error: {state.error}
        </p>
      )}
      {view.page === "resource" && (
        <ResourceView picker={props.picker}>
          <JoinField join={join} onJoined={open} />
        </ResourceView>
      )}
      {view.page === "incidents" && (
        <IncidentBoard
          incidents={state.incidents}
          patientOf={(i) => patientOf(mergeEvents(received(i.incidentId), log(i.incidentId)))}
          resourceId={resourceId}
          resourceName={resourceName}
          onOpen={open}
        />
      )}
      {view.page === "incident" && !incident && <p className="muted">This Incident is no longer on this Device.</p>}
      {incident && (
        <IncidentView
          key={incident.incidentId}
          incident={incident}
          events={received(incident.incidentId)}
          log={log(incident.incidentId)}
          offset={state.offset}
          device={{ deviceId, resourceId }}
          onEvent={record}
          onBack={() => setView({ page: "incidents" })}
          resourceName={resourceName}
        />
      )}
    </Shell>
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
    <form onSubmit={submit} className="card form">
      <h2>Join Incident</h2>
      <label className="field">
        Incident id
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="INC-0001" />
      </label>
      <button type="submit" className="button-primary" disabled={pending || value.trim() === ""}>
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

// Home: one tile per Incident, in an Active and a Closed column.
function IncidentBoard(props: {
  incidents: Incident[];
  patientOf: (incident: Incident) => PatientState;
  resourceId: string;
  resourceName: (id: string) => string;
  onOpen: (incidentId: string) => void;
}) {
  const newestFirst = [...props.incidents].sort((a, b) => b.createdAt - a.createdAt);
  const columns = [
    { title: "Active", incidents: newestFirst.filter((i) => !i.closed) },
    { title: "Closed", incidents: newestFirst.filter((i) => i.closed) },
  ];

  return (
    <>
      <h1 className="page-title">Incidents</h1>
      <div className="board">
        {columns.map((column) => (
          <section key={column.title} className="board-column" aria-label={`${column.title} Incidents`}>
            <h2>
              {column.title} <span className="muted">({column.incidents.length})</span>
            </h2>
            {column.incidents.length === 0 && <p className="empty">No {column.title} Incidents.</p>}
            <div className="tiles">
              {column.incidents.map((incident) => (
                <IncidentTile
                  key={incident.incidentId}
                  incident={incident}
                  patient={props.patientOf(incident)}
                  resourceId={props.resourceId}
                  resourceName={props.resourceName}
                  onOpen={() => props.onOpen(incident.incidentId)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function IncidentTile(props: {
  incident: Incident;
  patient: PatientState;
  resourceId: string;
  resourceName: (id: string) => string;
  onOpen: () => void;
}) {
  const { incident, patient } = props;
  const triage = patient.triage?.value;
  const myLeg = incident.legs.findLast((l) => l.resourceId === props.resourceId);

  return (
    <button
      type="button"
      className="tile"
      style={triage ? { borderLeftColor: `var(--triage-${triage})` } : undefined}
      onClick={props.onOpen}
    >
      <span className="tile-head">
        <code className="incident-id">{incident.incidentId}</code>
        {triage && <span className={`badge triage-${triage}`}>{triage}</span>}
      </span>
      <span className="tile-patient">{patient.name?.value ?? <span className="muted">Unknown patient</span>}</span>
      {patient.dob && <span className="muted">Born {patient.dob.value}</span>}
      <span className="tile-legs">
        {incident.legs.map((leg) => (
          <span key={leg.legId} className={isActive(leg) ? "badge state-active" : "badge state-closed"}>
            {props.resourceName(leg.resourceId)}
          </span>
        ))}
      </span>
      {myLeg && <span className="muted">My leg: {isActive(myLeg) ? "Active" : "Completed"}</span>}
    </button>
  );
}

// The Device's own events show at once, before the Coordinator stores them.
function mergeEvents(received: Event[], log: LoggedEvent[]): Event[] {
  const known = new Set(received.map((e) => e.eventId));
  return [...received, ...log.map((e) => e.event).filter((e) => !known.has(e.eventId))].sort(compareStamps);
}

function patientOf(events: Event[]): PatientState {
  return events.reduce(applyEvent, emptyPatient);
}

function IncidentView(props: {
  incident: Incident;
  events: Event[]; // received from the Coordinator
  log: LoggedEvent[]; // this Device's own events in the Incident
  offset: number;
  device: { deviceId: string; resourceId: string };
  onEvent: (event: Event) => void;
  onBack: () => void;
  resourceName: (id: string) => string;
}) {
  const { incident, resourceName } = props;
  const [view, setView] = useState<"feed" | "log">("feed");
  const events = mergeEvents(props.events, props.log);
  const patient = patientOf(events);
  const latestVitals = patient.vitals.at(-1);
  // A legCompleted in the feed counts at once, before the Coordinator's incident shows the leg Completed,
  // so the leg tab goes away as soon as this Device writes one.
  const completedLegIds = new Set(events.flatMap((e) => (e.kind === "legCompleted" && e.source.type === "device" ? [e.source.legId] : [])));
  const myLegs = incident.legs.filter((l) => l.resourceId === props.device.resourceId);
  const activeLeg = myLegs.findLast((l) => isActive(l) && !completedLegIds.has(l.legId));
  // The Resource writes under its Active leg, or after Handover under its latest completed one (ADR 0003).
  const leg = activeLeg ?? myLegs.at(-1);
  // Closed is the Coordinator's: no leg is Active. With my own leg completed I can still edit until then.
  const writer: Writer | undefined =
    leg && !incident.closed
      ? {
          incidentId: incident.incidentId,
          patientId: incident.patientId,
          device: { ...props.device, legId: leg.legId },
          clock: Date.now,
          onEvent: props.onEvent,
        }
      : undefined;
  // Each card's edit button shows only while this Device can write.
  const editWith = (form: (writer: Writer, done: () => void) => ReactNode) => writer && ((done: () => void) => form(writer, done));
  // Who wrote a value and when, from the Event that set it.
  const enteredBy = (stamp: Stamp) => {
    const event = events.find((e) => e.eventId === stamp.eventId);
    return `${event ? sourceLabel(event, resourceName) : "Unknown"}, ${formatTime(stamp.enteredAt)}`;
  };
  const lastChange = events.at(-1);
  const stored = props.log.filter((e) => e.seq <= props.offset).length;

  return (
    <>
      <header className="page-header">
        <button type="button" className="button-small back" onClick={props.onBack}>
          ← Incidents
        </button>
        <h1>{incident.incidentId}</h1>
        <span className={incident.closed ? "badge state-closed" : "badge state-active"}>{incidentStatus(incident)}</span>
        {writer && activeLeg && (
          <div className="header-action">
            <CompleteLegButton writer={writer} />
          </div>
        )}
      </header>
      <div className="detail-layout">
        {incident.closed && <p className="muted">The Incident is Closed, so nothing can be added.</p>}
        <div className="card-grid">
          <EditableCard
            title="Patient"
            view={
              <dl className="patient-fields">
                <dt>Name</dt>
                <dd>{patient.name?.value ?? "-"}</dd>
                <dt>Date of birth</dt>
                <dd>{patient.dob?.value ?? "-"}</dd>
                <dt>Triage</dt>
                <dd>{patient.triage ? <span className={`badge triage-${patient.triage.value}`}>{patient.triage.value}</span> : "-"}</dd>
                <dt>Latest vitals</dt>
                <dd>{latestVitals ? formatVitals(latestVitals.vitals) : "-"}</dd>
                <dt>Notes</dt>
                <dd>{patient.notes.length}</dd>
                <dt>Last change</dt>
                <dd>{lastChange ? enteredBy(lastChange) : "-"}</dd>
                <dt>Patient id</dt>
                <dd>
                  <code title={incident.patientId}>{incident.patientId.slice(0, 8)}</code>
                </dd>
              </dl>
            }
            edit={editWith((writer, done) => <PatientForm writer={writer} onDone={done} patient={patient} />)}
          />
          <EditableCard
            title="Triage"
            view={
              patient.triage ? (
                <p className="card-value">
                  <span className={`badge triage-${patient.triage.value}`}>{patient.triage.value}</span>{" "}
                  <span className="muted">by {enteredBy(patient.triage)}</span>
                </p>
              ) : (
                <p className="muted">Not set.</p>
              )
            }
            edit={editWith((writer, done) => <TriageForm writer={writer} onDone={done} patient={patient} />)}
          />
          <EditableCard
            title={`Vitals (${patient.vitals.length})`}
            view={
              patient.vitals.length === 0 ? (
                <p className="muted">No vitals yet.</p>
              ) : (
                <ol className="feed">
                  {patient.vitals.map((entry) => (
                    <li key={entry.eventId}>
                      <span className="muted">{enteredBy(entry)}</span>
                      <br />
                      {formatVitals(entry.vitals)}
                    </li>
                  ))}
                </ol>
              )
            }
            edit={editWith((writer, done) => <VitalsForm writer={writer} onDone={done} />)}
          />
          <EditableCard
            title={`Notes (${patient.notes.length})`}
            view={
              patient.notes.length === 0 ? (
                <p className="muted">No notes yet.</p>
              ) : (
                <ol className="feed">
                  {patient.notes.map((note) => (
                    <li key={note.eventId}>
                      <span className="muted">{enteredBy(note)}</span>
                      <br />
                      {note.text}
                    </li>
                  ))}
                </ol>
              )
            }
            edit={editWith((writer, done) => <NoteForm writer={writer} onDone={done} />)}
          />
          <section className="card">
            <h2 className="card-title">Transfer legs</h2>
            <ul className="leg-list">
              {incident.legs.map((leg) => (
                <li key={leg.legId}>
                  <span className="leg">
                    {resourceName(leg.resourceId)}
                    {leg.resourceId === props.device.resourceId && <span className="muted"> (this Resource)</span>}
                    <span className={isActive(leg) ? "badge state-active" : "badge state-closed"}>
                      {isActive(leg) ? "Active" : "Completed"}
                    </span>
                  </span>
                  <span className="muted">
                    Started {formatTime(leg.createdAt)}
                    {leg.completedAt !== null && `, completed ${formatTime(leg.completedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2 className="card-title">Incident</h2>
            <dl className="patient-fields">
              <dt>Incident id</dt>
              <dd>
                <code>{incident.incidentId}</code>
              </dd>
              <dt>Status</dt>
              <dd>
                <span className={incident.closed ? "badge state-closed" : "badge state-active"}>{incidentStatus(incident)}</span>
              </dd>
              <dt>Created</dt>
              <dd>{formatTime(incident.createdAt)}</dd>
              <dt>Events</dt>
              <dd>{events.length}</dd>
              <dt>My Event log</dt>
              <dd>
                {stored} of {props.log.length} stored
              </dd>
            </dl>
          </section>
        </div>
        <section className="card">
          <div className="view-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "feed"} onClick={() => setView("feed")}>
              Feed
            </button>
            <button type="button" aria-pressed={view === "log"} onClick={() => setView("log")}>
              My Event log
            </button>
          </div>
          {view === "feed" ? (
            <ol className="feed">
              {events.map((e) => (
                <li key={e.eventId}>
                  <span className="muted">{formatTime(e.enteredAt)}</span> <strong>{sourceLabel(e, resourceName)}</strong>:{" "}
                  {describeEvent(e)}
                </li>
              ))}
            </ol>
          ) : (
            <ol className="feed">
              {props.log.length === 0 && <li className="muted">No events from this Device yet.</li>}
              {props.log.map(({ seq, event }) => (
                <li key={event.eventId}>
                  <span className="muted">
                    #{seq} {formatTime(event.enteredAt)}
                  </span>{" "}
                  {describeEvent(event)} ({seq <= props.offset ? "stored" : "waiting"})
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" strokeLinejoin="round" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
      <path d="M8.5 9v4M6.5 11h4" />
    </svg>
  );
}

function WifiIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString();

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
