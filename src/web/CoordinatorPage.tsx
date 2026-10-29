import { useRef, useState, type ReactNode } from "react";
import type { Event, Vitals } from "../shared/event.ts";
import type { Resource } from "../shared/resource.ts";
import type { DeviceStatus, StoredEvent, WatchSnapshot } from "../shared/watch.ts";
import { sampleCoordinatorState } from "./sampleCoordinatorState.ts";
import { useResources } from "./useResources.ts";

// Everything the Coordinator page shows: the /watch snapshot plus whether the socket is live (ADR 0008).
export type CoordinatorState = WatchSnapshot & { live: boolean };

type View = "lanes" | "log";

const slotWidth = 136; // px per seq in a lane

const shortId = (id: string) => id.slice(0, 8);

function summarizeVitals(v: Vitals): string {
  const parts: string[] = [];
  if (v.pulse !== undefined) parts.push(`HR ${v.pulse}`);
  if (v.systolic !== undefined || v.diastolic !== undefined) parts.push(`BP ${v.systolic ?? "?"}/${v.diastolic ?? "?"}`);
  if (v.spo2 !== undefined) parts.push(`SpO2 ${v.spo2}%`);
  if (v.respRate !== undefined) parts.push(`RR ${v.respRate}`);
  if (v.temperature !== undefined) parts.push(`T ${v.temperature}°C`);
  return parts.join(", ");
}

function summarize(event: Event): string {
  switch (event.kind) {
    case "fieldSet":
      return `${event.field}: ${event.value}`;
    case "vitalAdded":
      return `Vitals ${summarizeVitals(event.vitals)}`;
    case "noteAdded":
      return `Note "${event.text}"`;
    case "legCompleted":
      return "Transfer leg completed";
  }
}

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString();

// Reset is called only from this page, behind a confirm dialog that closes on the 200 (ADR 0008).
async function postReset(): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/reset", { method: "POST" });
  } catch {
    throw new Error("Could not reach the Coordinator.");
  }
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
}

export function CoordinatorPage() {
  // Replaced by the /watch client in #21.
  const state = sampleCoordinatorState;
  const { resources, error } = useResources();
  const [view, setView] = useState<View>("lanes");

  return (
    <main>
      <header className="page-header">
        <h1>Coordinator</h1>
        <span className={state.live ? "status live" : "status"}>{state.live ? "live" : "disconnected"}</span>
        <span className="epoch">
          Epoch <code>{state.epoch}</code>
        </span>
        <ResetButton />
      </header>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="view-toggle" role="group" aria-label="View">
        <button type="button" aria-pressed={view === "lanes"} onClick={() => setView("lanes")}>
          Lanes
        </button>
        <button type="button" aria-pressed={view === "log"} onClick={() => setView("log")}>
          Merged log
        </button>
      </div>
      <div className={state.live ? "coordinator-data" : "coordinator-data dimmed"}>
        {view === "lanes" ? (
          <LanesView events={state.events} devices={state.devices} resources={resources} />
        ) : (
          <MergedLogView events={state.events} devices={state.devices} resources={resources} />
        )}
      </div>
    </main>
  );
}

function ResetButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  function open() {
    setError(undefined);
    dialog.current?.showModal();
  }

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await postReset();
      dialog.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="button-danger" onClick={open}>
        Reset
      </button>
      <dialog ref={dialog} className="card dialog">
        <h2>Reset the demo?</h2>
        <p>
          The Coordinator deletes every Incident, Patient, Event and Device Offset and starts a new Coordinator epoch. Each
          Device clears itself when it reconnects. Resources are kept.
        </p>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button-small" onClick={() => dialog.current?.close()} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="button-danger" onClick={() => void confirm()} disabled={pending}>
            {pending ? "Resetting..." : "Reset"}
          </button>
        </div>
      </dialog>
    </>
  );
}

type ViewProps = { events: StoredEvent[]; devices: DeviceStatus[]; resources: Resource[] };

const nameOf = (resources: Resource[], resourceId: string) =>
  resources.find((r) => r.resourceId === resourceId)?.name ?? resourceId;

function LanesView({ events, devices, resources }: ViewProps) {
  const eocEvents = events.filter((e) => e.deviceId === null);
  const lanes = devices.map((device) => ({
    device,
    events: events.filter((e) => e.deviceId === device.deviceId),
  }));
  const slots = Math.max(
    1,
    eocEvents.length,
    ...devices.map((d) => d.offset),
    ...events.map((e) => e.seq ?? 0),
  );

  return (
    <section className="card lanes-card">
      <h2>Lanes</h2>
      <div className="lanes">
        <div className="lane">
          <div className="lane-label">
            <strong>EOC</strong>
            <span className="muted">no Offset</span>
          </div>
          <LaneTrack slots={slots}>
            {eocEvents.map((e, i) => (
              <EventChip key={e.rowid} stored={e} slot={i + 1} />
            ))}
          </LaneTrack>
        </div>
        {lanes.map(({ device, events }) => (
          <div className="lane" key={device.deviceId}>
            <div className="lane-label">
              <strong>{nameOf(resources, device.resourceId)}</strong>
              <code title={device.deviceId}>{shortId(device.deviceId)}</code>
              <span className="muted">Offset {device.offset}</span>
            </div>
            <LaneTrack slots={slots} offset={device.offset}>
              {events.map((e) => (
                <EventChip key={e.rowid} stored={e} slot={e.seq ?? 0} aboveOffset={(e.seq ?? 0) > device.offset} />
              ))}
            </LaneTrack>
          </div>
        ))}
      </div>
    </section>
  );
}

function LaneTrack(props: { slots: number; offset?: number; children: ReactNode }) {
  return (
    <div className="lane-track" style={{ gridTemplateColumns: `repeat(${props.slots}, ${slotWidth}px)` }}>
      {props.children}
      {props.offset !== undefined && (
        <div className="offset-line" style={{ left: props.offset * slotWidth }} title={`Offset ${props.offset}`} />
      )}
    </div>
  );
}

function EventChip(props: { stored: StoredEvent; slot: number; aboveOffset?: boolean }) {
  const { stored, slot } = props;
  const summary = summarize(stored.event);
  return (
    <div
      className={props.aboveOffset ? "lane-event above-offset" : "lane-event"}
      style={{ gridColumn: slot }}
      title={`${stored.event.incidentId} at ${formatTime(stored.event.enteredAt)}: ${summary}`}
    >
      <span className="lane-event-head">
        <span>{stored.seq === null ? `row ${stored.rowid}` : `#${stored.seq}`}</span>
        <span className="muted">{stored.event.incidentId}</span>
      </span>
      <span className="lane-event-summary">{summary}</span>
    </div>
  );
}

function MergedLogView({ events, devices, resources }: ViewProps) {
  const byRowid = [...events].sort((a, b) => a.rowid - b.rowid);
  const resourceOfDevice = (deviceId: string) => {
    const device = devices.find((d) => d.deviceId === deviceId);
    return device ? nameOf(resources, device.resourceId) : "Unknown Device";
  };

  return (
    <>
      <section className="card table-card">
        <h2>Devices</h2>
        {devices.length === 0 ? (
          <p className="empty">No Devices yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {["Device", "Resource", "Connection", "Offset"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.deviceId}>
                  <td>
                    <code title={d.deviceId}>{shortId(d.deviceId)}</code>
                  </td>
                  <td>{nameOf(resources, d.resourceId)}</td>
                  <td>
                    <span className={d.connected ? "status live" : "status"}>{d.connected ? "connected" : "disconnected"}</span>
                  </td>
                  <td>{d.offset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card table-card">
        <h2>Merged log</h2>
        {byRowid.length === 0 ? (
          <p className="empty">No Events stored yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {["Row", "Entered at", "Source", "Incident", "Event"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byRowid.map((e) => (
                <tr key={e.rowid}>
                  <td>{e.rowid}</td>
                  <td>{formatTime(e.event.enteredAt)}</td>
                  <td>
                    {e.deviceId === null ? (
                      "EOC"
                    ) : (
                      <>
                        {resourceOfDevice(e.deviceId)} <code title={e.deviceId}>{shortId(e.deviceId)}</code> #{e.seq}
                      </>
                    )}
                  </td>
                  <td>
                    <code>{e.event.incidentId}</code>
                  </td>
                  <td>{summarize(e.event)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
