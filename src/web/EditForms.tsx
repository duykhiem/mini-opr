import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { triages, type Event, type Triage, type Vitals } from "../shared/event.ts";
import { draftEvent, type DeviceSource, type EventBody } from "../shared/draftEvent.ts";
import type { PatientState } from "../shared/patient.ts";

// What a form needs to write Events into the Incident under this Device's Transfer leg.
export type Writer = {
  incidentId: string;
  patientId: string;
  device: DeviceSource;
  clock: () => number;
  onEvent: (event: Event) => void;
};

// Every Event is built with draftEvent, so parseEvent checks it (ADR 0003) before anything is emitted.
// All bodies are drafted first, so a form with a bad field writes none of its fields. Returns the reason on failure.
function write(writer: Writer, bodies: EventBody[]): string | undefined {
  const events: Event[] = [];
  for (const body of bodies) {
    const event = draftEvent(body, writer, writer.device, writer.clock);
    if ("error" in event) return event.error;
    events.push(event);
  }
  for (const event of events) writer.onEvent(event);
  return undefined;
}

// A card that shows its values, and its inputs while the edit button at its top right is pressed.
// Without `edit` (as while the Incident is Closed) it has no button. The form unmounts on the way back,
// so reopening starts from the current values.
export function EditableCard(props: { title: string; view: ReactNode; edit?: (done: () => void) => ReactNode }) {
  const [editing, setEditing] = useState(false);
  const open = editing && props.edit !== undefined;

  return (
    <section className="card">
      <div className="card-head">
        <h2>{props.title}</h2>
        {props.edit && (
          <button
            type="button"
            className="icon-button"
            aria-pressed={open}
            aria-label={open ? `Close ${props.title}` : `Edit ${props.title}`}
            title={open ? "Close" : "Edit"}
            onClick={() => setEditing(!open)}
          >
            {open ? <CloseIcon /> : <PencilIcon />}
          </button>
        )}
      </div>
      {open && props.edit ? props.edit(() => setEditing(false)) : props.view}
    </section>
  );
}

type FormProps = { writer: Writer; onDone: () => void };

// Name and date of birth, filled with the current values; only a changed field is written.
export function PatientForm(props: FormProps & { patient: PatientState }) {
  const [name, setName] = useState(props.patient.name?.value ?? "");
  const [dob, setDob] = useState(props.patient.dob?.value ?? "");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const bodies: EventBody[] = [];
    if (name.trim() !== (props.patient.name?.value ?? "")) bodies.push({ kind: "fieldSet", field: "name", value: name.trim() });
    if (dob !== (props.patient.dob?.value ?? "")) bodies.push({ kind: "fieldSet", field: "dob", value: dob });
    const reason = write(props.writer, bodies);
    if (reason === undefined) props.onDone();
    else setError(reason);
  }

  return (
    <form onSubmit={submit} className="form" noValidate>
      <Field label="Patient name">{(id) => <input id={id} value={name} onChange={edited(setName, setError)} />}</Field>
      <Field label="Date of birth">{(id) => <input id={id} type="date" value={dob} onChange={edited(setDob, setError)} />}</Field>
      <Reason text={error} />
      <Submit label="Save" />
    </form>
  );
}

export function TriageForm(props: FormProps & { patient: PatientState }) {
  const current = props.patient.triage?.value ?? "";
  const [triage, setTriage] = useState<string>(current);
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    // Any string goes in; parseEvent rejects one that is not a triage colour.
    const reason = triage === current ? undefined : write(props.writer, [{ kind: "fieldSet", field: "triage", value: triage as Triage }]);
    if (reason === undefined) props.onDone();
    else setError(reason);
  }

  return (
    <form onSubmit={submit} className="form" noValidate>
      <Field label="Triage">
        {(id) => (
          <select id={id} value={triage} onChange={edited(setTriage, setError)}>
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
      <Reason text={error} />
      <Submit label="Save" />
    </form>
  );
}

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

export function VitalsForm(props: FormProps) {
  const [inputs, setInputs] = useState(emptyVitals);
  // `vital` places the reason next to the vital it names.
  const [error, setError] = useState<{ reason: string; vital?: VitalName }>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const vitals: Vitals = {};
    for (const name of vitalNames) {
      const value = inputs[name].trim();
      if (value !== "") vitals[name] = Number(value);
    }
    const reason = write(props.writer, [{ kind: "vitalAdded", vitals }]);
    if (reason === undefined) props.onDone();
    else setError({ reason, vital: vitalNames.find((name) => reason.startsWith(`${name} `)) });
  }

  const setVital = (name: VitalName) => (e: { target: { value: string } }) => {
    setInputs((i) => ({ ...i, [name]: e.target.value }));
    setError(undefined);
  };

  return (
    <form onSubmit={submit} className="form" noValidate>
      <div className="vitals-grid">
        {vitalNames.map((name) => (
          <Field key={name} label={vitalLabels[name]} reason={error?.vital === name ? error.reason : undefined}>
            {(id) => <input id={id} inputMode="decimal" value={inputs[name]} onChange={setVital(name)} />}
          </Field>
        ))}
      </div>
      <Reason text={error?.vital === undefined ? error?.reason : undefined} />
      <Submit label="Add" />
    </form>
  );
}

export function NoteForm(props: FormProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const reason = write(props.writer, [{ kind: "noteAdded", text: text.trim() }]);
    if (reason === undefined) props.onDone();
    else setError(reason);
  }

  return (
    <form onSubmit={submit} className="form" noValidate>
      <Field label="Note" reason={error}>
        {(id) => <textarea id={id} value={text} onChange={edited(setText, setError)} rows={3} />}
      </Field>
      <Submit label="Add" />
    </form>
  );
}

// Shown only while the Resource holds an Active leg; asks for confirmation, since it cannot be undone.
// The button unmounts once the leg is completed, which also closes the dialog.
export function CompleteLegButton(props: { writer: Writer }) {
  const confirm = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string>();

  function complete() {
    const reason = write(props.writer, [{ kind: "legCompleted" }]);
    if (reason !== undefined) return setError(reason);
    confirm.current?.close();
  }

  return (
    <div>
      <button
        type="button"
        className="button-danger"
        onClick={() => {
          setError(undefined);
          confirm.current?.showModal();
        }}
      >
        Complete my Transfer leg...
      </button>
      <dialog ref={confirm} className="card dialog">
        <h2>Complete my Transfer leg?</h2>
        <p>This cannot be undone.</p>
        <Reason text={error} />
        <div className="dialog-actions">
          <button type="button" className="button-small" onClick={() => confirm.current?.close()}>
            Cancel
          </button>
          <button type="button" className="button-danger" onClick={complete}>
            Complete my Transfer leg
          </button>
        </div>
      </dialog>
    </div>
  );
}

// Editing an input hides its reason until the next submit.
function edited(set: (value: string) => void, setError: (error: undefined) => void) {
  return (e: { target: { value: string } }) => {
    set(e.target.value);
    setError(undefined);
  };
}

function Reason(props: { text: string | undefined }) {
  return props.text === undefined ? null : (
    <p role="alert" className="field-error">
      {props.text}
    </p>
  );
}

function Submit(props: { label: string }) {
  return (
    <div>
      <button type="submit" className="button-primary">
        {props.label}
      </button>
    </div>
  );
}

// A labelled input with its reason below it, outside the label so the reason is not part of the input's name.
function Field(props: { label: string; reason?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      <Reason text={props.reason} />
    </div>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
