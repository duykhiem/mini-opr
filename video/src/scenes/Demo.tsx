import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import close from "../../public/clips/close.json";
import coordinator from "../../public/clips/coordinator.json";
import eoc from "../../public/clips/eoc.json";
import handover from "../../public/clips/handover.json";
import { Captions, Scene, color, font } from "../ui.tsx";

type ClipInfo = { duration: number; markers: { at: number; id: string }[] };

// The clips play a little faster than they were recorded.
const rate = 1.2;
const fps = 30;
const toFrame = (ms: number) => Math.round((ms / 1000 / rate) * fps);

// Captions keyed by the marker ids that record/record.ts writes; "start" is the first frame.
const demos: { name: string; step: string; info: ClipInfo; captions: Record<string, string> }[] = [
  {
    name: "eoc",
    step: "Step 1 of 4: a new Incident",
    info: eoc,
    captions: {
      start: "Left: the EOC. Right: the tablet (Device) of Resource Alpha 1.",
      create: "The EOC creates an Incident for patient Kari Nordmann, and gives the first Transfer leg to Alpha 1.",
      tile: "Seconds later, the Incident is on Alpha 1's tablet. No phone call, nothing typed twice.",
      vitals: "The crew adds vitals. Each change is saved on the tablet first...",
      note: "...and sent to the Coordinator in the background.",
      log: "\"My Event log\" lists every change this Device wrote, and shows that the Coordinator has stored it.",
    },
  },
  {
    name: "handover",
    step: "Step 2 of 4: Handover",
    info: handover,
    captions: {
      start: "Handover: the patient moves from Alpha 1 to Bravo 2.",
      join: "Bravo 2 Joins the Incident by typing its id, INC-0001. There is no accept step.",
      history: "Bravo 2 sees the full record at once: everything the EOC and Alpha 1 wrote.",
      complete: "Alpha 1 completes its Transfer leg. This cannot be undone.",
      realtime: "Bravo 2 adds new vitals. They show up on Alpha 1's tablet in realtime.",
      stillEdit: "After Handover, Alpha 1 can still add to the record, for example a note about the medicine it gave.",
      triage: "Bravo 2 changes the triage to yellow. For name, date of birth and triage, the newest edit wins.",
    },
  },
  {
    name: "close",
    step: "Step 3 of 4: Closed and reopened",
    info: close,
    captions: {
      start: "Bravo 2 has delivered the patient.",
      complete: "Bravo 2 completes its Transfer leg too. Now no leg is Active...",
      closed: "...so the Incident is Closed, and the record is locked on every Device.",
      reopen: "Later, Charlie 3 Joins for a second transfer. A Join reopens the Incident.",
      note: "Charlie 3 carries on with the same record. Nothing starts from zero.",
    },
  },
  {
    name: "coordinator",
    step: "Step 4 of 4: the Coordinator",
    info: coordinator,
    captions: {
      start: "The Coordinator keeps one lane per Device, each with its own numbered Event log.",
      merged: "The merged log: every change from every Device, in one place. The Patient is rebuilt from it.",
    },
  },
];

export const demoScenes = demos.map((d) => ({
  ...d,
  frames: toFrame(d.info.duration),
  lines: [
    { at: 0, text: d.captions.start! },
    ...d.info.markers.filter((m) => d.captions[m.id]).map((m) => ({ at: toFrame(m.at), text: d.captions[m.id]! })),
  ],
}));

export function Demo(props: { scene: (typeof demoScenes)[number] }) {
  const { scene } = props;
  return (
    <Scene duration={scene.frames}>
      <OffthreadVideo src={staticFile(`clips/${scene.name}.webm`)} playbackRate={rate} muted />
      <AbsoluteFill style={{ alignItems: "flex-end", padding: "18px 28px" }}>
        <div style={{ display: "flex", gap: 10, fontFamily: font, fontSize: 20, fontWeight: 600 }}>
          <span style={{ padding: "6px 14px", borderRadius: 999, background: color.accent, color: "#fff" }}>{scene.step}</span>
          <span style={{ padding: "6px 14px", borderRadius: 999, background: "#fff", color: color.muted, border: `1px solid ${color.border}` }}>
            Real app, fictional data
          </span>
        </div>
      </AbsoluteFill>
      <Captions lines={scene.lines} bottom={60} />
    </Scene>
  );
}
