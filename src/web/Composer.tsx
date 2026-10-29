import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { triages, type Event, type Triage, type Vitals } from "../shared/event.ts";
import { draftEvent, type DeviceSource, type EventBody } from "../shared/draftEvent.ts";

type ComposerTab = "note" | "vitals" | "name" | "dob" | "triage" | "leg";

const tabLabels: Record<ComposerTab, string> = {
  note: "Note",
  vitals: "Vitals",
  name: "Name",
  dob: "Date of birth",
  triage: "Triage",
  leg: "Complete my Transfer leg",
};

type VitalName = keyof Vitals;

const vitalLabels: Record<VitalName, string> = {
  pulse: "Pulse (/min)",
  systolic: "Systolic (mmHg)",
  diastolic: "Diastolic (mmHg)",
  spo2: "SpO2 (%)",
  respRate: "Resp. rate (/min)",
  temperature: "Temperature (°C)",
};

const vitalNames = Object.keys(vitalLabels) as VitalName[];

const emptyVitals: Record<VitalName, string> = { pulse: "", systolic: "", diastolic: "", spo2: "", respRate: "", temperature: "" };
const emptyInputs = { note: "", vitals: emptyVitals, name: "", dob: "", triage: "" };

// The reason parseEvent gave, for the tab it came from; `vital` places it next to the vital it names.
type InputError = { tab: ComposerTab; reason: string; vital?: VitalName };

export type ComposerProps = {
  incidentId: string;
  patientId: string;
  device: DeviceSource;
  clock: () => number;
  // The "complete my Transfer leg" tab is shown only while the Resource holds an Active leg.
  holdsActiveLeg: boolean;
  // The Incident is Closed; what locks it is decided in #23.
  locked: boolean;
  onEvent: (event: Event) => void;
};

// The composer at the bottom of the Device page (#9). Every Event is built with draftEvent, so parseEvent
// checks it (ADR 0003) before anything is emitted.
export function Composer(props: ComposerProps) {
  const [tab, setTab] = useState<ComposerTab>("note");
  const [inputs, setInputs] = useState(emptyInputs);
  const [error, setError] = useState<InputError>();
  const confirmLeg = useRef<HTMLDialogElement>(null);

  const tabs = (Object.keys(tabLabels) as ComposerTab[]).filter((t) => t !== "leg" || props.holdsActiveLeg);
  const canCompleteLeg = props.holdsActiveLeg && !props.locked;

  // Losing the Active leg, or the Incident closing, takes away the leg tab and its open confirmation.
  useEffect(() => {
    if (canCompleteLeg) return;
    confirmLeg.current?.close();
    if (!props.holdsActiveLeg) setTab((t) => (t === "leg" ? "note" : t));
  }, [canCompleteLeg, props.holdsActiveLeg]);

  const reason = (shown: boolean) =>
    shown && error?.tab === tab ? (
      <p role="alert" className="field-error">
        {error.reason}
      </p>
    ) : null;

  function emit(body: EventBody): boolean {
    if (props.locked) return false;
    const event = draftEvent(body, { incidentId: props.incidentId, patientId: props.patientId }, props.device, props.clock);
    if ("error" in event) {
      setError({ tab, reason: event.error, vital: vitalNames.find((name) => event.error.startsWith(`${name} `)) });
      return false;
    }
    props.onEvent(event);
    // Only the submitted tab clears; what is typed in another tab stays.
    if (tab !== "leg") setInputs((i) => ({ ...i, [tab]: emptyInputs[tab] }));
    setError(undefined);
    return true;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    switch (tab) {
      case "note":
        return void emit({ kind: "noteAdded", text: inputs.note.trim() });
      case "vitals": {
        const vitals: Vitals = {};
        for (const name of vitalNames) {
          const value = inputs.vitals[name].trim();
          if (value !== "") vitals[name] = Number(value);
        }
        return void emit({ kind: "vitalAdded", vitals });
      }
      case "name":
        return void emit({ kind: "fieldSet", field: "name", value: inputs.name.trim() });
      case "dob":
        return void emit({ kind: "fieldSet", field: "dob", value: inputs.dob });
      case "triage":
        // Any string goes in; parseEvent rejects one that is not a triage colour.
        return void emit({ kind: "fieldSet", field: "triage", value: inputs.triage as Triage });
      case "leg":
        setError(undefined);
        confirmLeg.current?.showModal();
        return;
    }
  }

  function completeLeg() {
    if (canCompleteLeg && emit({ kind: "legCompleted" })) confirmLeg.current?.close();
  }

  function choose(next: ComposerTab) {
    setTab(next);
    setError(undefined);
  }

  // Editing an input hides its reason until the next submit.
  const set = (field: "note" | "name" | "dob" | "triage") => (e: { target: { value: string } }) => {
    setInputs((i) => ({ ...i, [field]: e.target.value }));
    setError(undefined);
  };
  const setVital = (name: VitalName) => (e: { target: { value: string } }) => {
    setInputs((i) => ({ ...i, vitals: { ...i.vitals, [name]: e.target.value } }));
    setError(undefined);
  };

  return (
    <section className="card composer">
      {props.locked && <p className="muted">The Incident is Closed, so nothing can be added.</p>}
      <fieldset disabled={props.locked}>
        <div className="view-toggle" role="group" aria-label="Composer">
          {tabs.map((t) => (
            <button key={t} type="button" aria-pressed={t === tab} onClick={() => choose(t)}>
              {tabLabels[t]}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="form" noValidate>
          {tab === "note" && (
            <Field label="Note" reason={reason(true)}>
              {(id) => <textarea id={id} value={inputs.note} onChange={set("note")} rows={3} />}
            </Field>
          )}
          {tab === "vitals" && (
            <>
              <div className="vitals-grid">
                {vitalNames.map((name) => (
                  <Field key={name} label={vitalLabels[name]} reason={reason(error?.vital === name)}>
                    {(id) => <input id={id} inputMode="decimal" value={inputs.vitals[name]} onChange={setVital(name)} />}
                  </Field>
                ))}
              </div>
              {reason(error?.vital === undefined)}
            </>
          )}
          {tab === "name" && (
            <Field label="Patient name" reason={reason(true)}>
              {(id) => <input id={id} value={inputs.name} onChange={set("name")} />}
            </Field>
          )}
          {tab === "dob" && (
            <Field label="Date of birth" reason={reason(true)}>
              {(id) => <input id={id} type="date" value={inputs.dob} onChange={set("dob")} />}
            </Field>
          )}
          {tab === "triage" && (
            <Field label="Triage" reason={reason(true)}>
              {(id) => (
                <select id={id} value={inputs.triage} onChange={set("triage")}>
                  <option value="" disabled>
                    Choose a colour
                  </option>
                  {triages.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {tab === "leg" && <p className="muted">Completing my Transfer leg cannot be undone.</p>}
          <div>
            <button type="submit" className={tab === "leg" ? "button-danger" : "button-primary"}>
              {tab === "leg" ? "Complete my Transfer leg..." : "Add"}
            </button>
          </div>
        </form>
      </fieldset>
      <dialog ref={confirmLeg} className="card dialog">
        <h2>Complete my Transfer leg?</h2>
        <p>This cannot be undone.</p>
        {reason(true)}
        <div className="dialog-actions">
          <button type="button" className="button-small" onClick={() => confirmLeg.current?.close()}>
            Cancel
          </button>
          <button type="button" className="button-danger" onClick={completeLeg} disabled={!canCompleteLeg}>
            Complete my Transfer leg
          </button>
        </div>
      </dialog>
    </section>
  );
}

// A labelled input with its reason below it, outside the label so the reason is not part of the input's name.
function Field(props: { label: string; reason: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.reason}
    </div>
  );
}
