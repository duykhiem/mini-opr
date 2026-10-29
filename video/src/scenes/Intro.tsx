import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Ambulance, Captions, Card, Chip, Label, PatientIcon, Reveal, Scene, TabletIcon, clamp, color } from "../ui.tsx";

const crews = [
  { name: "Alpha 1", tint: color.alpha },
  { name: "Bravo 2", tint: color.bravo },
  { name: "Charlie 3", tint: color.charlie },
];

export const hookFrames = 450;

// Scene 1: one patient, three crews, three tablets.
export function Hook() {
  const frame = useCurrentFrame();
  const xs = [480, 960, 1440];
  const patientX = interpolate(frame, [60, 110, 170, 220, 280, 330], [260, xs[0]!, xs[0]!, xs[1]!, xs[1]!, xs[2]!], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <Scene duration={hookFrames}>
      <div style={{ position: "absolute", left: 160, top: 130, fontSize: 84, fontWeight: 700, lineHeight: 1.2 }}>
        <Reveal at={15}>One patient.</Reveal>
        <Reveal at={75}>Three ambulance crews.</Reveal>
        <Reveal at={135}>Three tablets.</Reveal>
        <Reveal at={215} style={{ color: color.accent, marginTop: 24 }}>
          Who has the full record?
        </Reveal>
      </div>
      <div style={{ position: "absolute", left: 160, right: 160, top: 858, height: 6, borderRadius: 3, background: color.border }} />
      {crews.map((crew, i) => (
        <Reveal key={crew.name} at={75 + i * 20} style={{ position: "absolute", left: xs[i]! - 80, top: 760, textAlign: "center", width: 160 }}>
          <Ambulance size={160} tint={crew.tint} />
          <div style={{ fontSize: 26, fontWeight: 600, color: crew.tint, marginTop: 18 }}>{crew.name}</div>
        </Reveal>
      ))}
      {crews.map((crew, i) => (
        <Reveal key={crew.name} at={135 + i * 15} style={{ position: "absolute", left: xs[i]! + 50, top: 690 }}>
          <TabletIcon size={64} tint={crew.tint} />
        </Reveal>
      ))}
      <Reveal at={50} style={{ position: "absolute", left: patientX - 28, top: 680 }}>
        <PatientIcon size={56} />
      </Reveal>
    </Scene>
  );
}

type Line = { text: string; lost?: boolean };
const tablets: { crew: (typeof crews)[number]; lines: Line[]; at: number }[] = [
  {
    crew: crews[0]!,
    at: 30,
    lines: [{ text: "Kari Nordmann, born 1958" }, { text: "Pulse 118, BP 94/58" }, { text: "Fell from a ladder" }, { text: "Morphine 5 mg at 10:42" }],
  },
  {
    crew: crews[1]!,
    at: 300,
    lines: [{ text: "Kari Nordmann, born 1958" }, { text: "Pulse 118, BP 94/58", lost: true }, { text: "Fell from a ladder" }, { text: "Morphine 5 mg at 10:42", lost: true }],
  },
  {
    crew: crews[2]!,
    at: 540,
    lines: [{ text: "Kari Nordmann" }, { text: "Pulse 118, BP 94/58", lost: true }, { text: "Fell from a ladder", lost: true }, { text: "Morphine 5 mg at 10:42", lost: true }],
  },
];

export const problemFrames = 900;

// Scene 2: each crew has its own tablet, and every handover drops details.
export function Problem() {
  const frame = useCurrentFrame();
  return (
    <Scene duration={problemFrames}>
      <div style={{ position: "absolute", left: 160, top: 90 }}>
        <Reveal at={0}>
          <Label tint={color.danger}>The problem</Label>
        </Reveal>
        <Reveal at={8} style={{ fontSize: 64, fontWeight: 700, marginTop: 12 }}>
          Every handover is a chance to lose information
        </Reveal>
      </div>
      {tablets.map((t, i) => (
        <Reveal key={t.crew.name} at={t.at} style={{ position: "absolute", left: 160 + i * 560, top: 300, width: 480 }}>
          <Card style={{ padding: 28, borderTop: `8px solid ${t.crew.tint}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <TabletIcon size={44} tint={t.crew.tint} />
              <div style={{ fontSize: 32, fontWeight: 700 }}>Tablet of {t.crew.name}</div>
            </div>
            {t.lines.map((line, j) => {
              const at = t.at + 30 + j * 25;
              const opacity = interpolate(frame, [at, at + 12], [0, 1], clamp);
              return (
                <div
                  key={line.text}
                  style={{
                    opacity,
                    fontSize: 26,
                    padding: "12px 16px",
                    marginTop: 10,
                    borderRadius: 10,
                    background: line.lost ? color.dangerSoft : color.bg,
                    border: line.lost ? `2px dashed ${color.danger}` : "2px solid transparent",
                    color: line.lost ? color.danger : color.text,
                  }}
                >
                  <span style={{ textDecoration: line.lost ? "line-through" : undefined }}>{line.text}</span>
                  {line.lost && <strong style={{ marginLeft: 10, fontSize: 20, textTransform: "uppercase" }}>lost</strong>}
                </div>
              );
            })}
          </Card>
        </Reveal>
      ))}
      {[0, 1].map((i) => {
        const at = tablets[i + 1]!.at - 30;
        const grow = interpolate(frame, [at, at + 25], [0, 1], clamp);
        return (
          <div key={i} style={{ position: "absolute", left: 650 + i * 560, top: 500, opacity: grow }}>
            <svg width="60" height="40" viewBox="0 0 60 40">
              <path d={`M4 20h${44 * grow}`} stroke={color.muted} strokeWidth="5" strokeLinecap="round" />
              <path d="M38 8l14 12-14 12" fill="none" stroke={color.muted} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );
      })}
      <Captions
        lines={[
          { at: 40, text: "Each crew writes down what it sees on its own tablet." },
          { at: 270, text: "At handover, details are told by voice, written on paper, or typed in again." },
          { at: 520, text: "Some details get lost on the way. The next crew starts with gaps." },
          { at: 720, text: "And the hospital receives only part of the story." },
        ]}
      />
    </Scene>
  );
}

const recordLines = [
  { at: 140, who: "EOC", tint: color.eoc, text: "Kari Nordmann, born 1958, triage orange" },
  { at: 230, who: "Alpha 1", tint: color.alpha, text: "Pulse 118, BP 94/58, SpO2 91%" },
  { at: 280, who: "Alpha 1", tint: color.alpha, text: "Fell from a ladder. Pain in left hip." },
  { at: 380, who: "Bravo 2", tint: color.bravo, text: "Pulse 104, BP 102/64, SpO2 95%" },
  { at: 430, who: "Alpha 1", tint: color.alpha, text: "Morphine 5 mg given at 10:42" },
  { at: 530, who: "Charlie 3", tint: color.charlie, text: "Second transfer, to the hospital" },
];

export const oprFrames = 750;

// Scene 3: the idea of One Patient Record.
export function Opr() {
  const frame = useCurrentFrame();
  const active = recordLines.findLast((l) => l.at <= frame && frame < l.at + 45)?.who;
  return (
    <Scene duration={oprFrames}>
      <div style={{ position: "absolute", left: 160, top: 200, width: 720 }}>
        <Reveal at={0}>
          <Label>The idea</Label>
        </Reveal>
        <Reveal at={10} style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.1, marginTop: 16 }}>
          OPR:
          <br />
          One Patient Record
        </Reveal>
        <Reveal at={45} style={{ fontSize: 36, color: color.muted, marginTop: 28, lineHeight: 1.4 }}>
          One record that travels with the patient, not with the vehicle.
        </Reveal>
        <div style={{ marginTop: 48, fontSize: 32, lineHeight: 1.4 }}>
          {["Every crew sees everything written before.", "Every crew adds to the same record.", "Nothing is overwritten. Nothing is lost."].map((t, i) => (
            <Reveal key={t} at={250 + i * 110} style={{ display: "flex", gap: 16, marginTop: 16 }}>
              <span style={{ color: color.ok, fontWeight: 700 }}>✓</span>
              {t}
            </Reveal>
          ))}
        </div>
      </div>
      <div style={{ position: "absolute", left: 1000, top: 130, width: 760 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "0 40px" }}>
          {crews.map((crew, i) => (
            <Reveal key={crew.name} at={60 + i * 15} style={{ textAlign: "center", width: 180 }}>
              <div
                style={{
                  display: "inline-grid",
                  placeItems: "center",
                  width: 96,
                  height: 96,
                  borderRadius: 24,
                  background: active === crew.name ? `${crew.tint}22` : color.surface,
                  border: `2px solid ${active === crew.name ? crew.tint : color.border}`,
                }}
              >
                <TabletIcon size={60} tint={crew.tint} />
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: crew.tint, marginTop: 8 }}>{crew.name}</div>
            </Reveal>
          ))}
        </div>
        <svg width="760" height="70" style={{ display: "block" }}>
          {[130, 380, 630].map((x, i) => (
            <path key={x} d={`M${x} 0 L380 70`} stroke={active === crews[i]!.name ? crews[i]!.tint : color.border} strokeWidth="4" />
          ))}
        </svg>
        <Reveal at={90}>
          <Card style={{ padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
              <PatientIcon size={52} />
              <div>
                <div style={{ fontSize: 34, fontWeight: 700 }}>Kari Nordmann</div>
                <div style={{ fontSize: 22, color: color.muted }}>One record, shared by every crew</div>
              </div>
            </div>
            {recordLines.map((l) => {
              const opacity = interpolate(frame, [l.at, l.at + 12], [0, 1], clamp);
              return (
                <div key={l.at} style={{ opacity, display: "flex", gap: 16, alignItems: "baseline", fontSize: 25, padding: "10px 0", borderTop: `1px solid ${color.border}` }}>
                  <span style={{ width: 130, flexShrink: 0, fontWeight: 700, color: l.tint }}>{l.who}</span>
                  {l.text}
                </div>
              );
            })}
          </Card>
        </Reveal>
      </div>
    </Scene>
  );
}

export const miniOprFrames = 870;

const glossary = [
  { term: "Incident", text: "One emergency case, with one Patient" },
  { term: "Resource", text: "An ambulance unit: vehicle and crew" },
  { term: "Transfer leg", text: "One Resource's part of an Incident" },
  { term: "Event", text: "One recorded change to the Patient" },
];

// Scene 4: what Mini OPR is, and its parts.
export function MiniOprIntro() {
  const frame = useCurrentFrame();
  const dot = (offset: number) => ((frame + offset) % 60) / 60;
  const deviceYs = [400, 535, 670];
  return (
    <Scene duration={miniOprFrames}>
      <div style={{ position: "absolute", left: 160, top: 70, right: 160 }}>
        <Reveal at={0}>
          <Label>Our app</Label>
        </Reveal>
        <Reveal at={8} style={{ fontSize: 54, fontWeight: 700, marginTop: 12 }}>
          Mini OPR: a working demo of how an OPR should behave
        </Reveal>
        <Reveal at={40} style={{ display: "flex", gap: 14, marginTop: 20 }}>
          <Chip tint={color.muted}>Not a product</Chip>
          <Chip tint={color.muted}>Fictional data</Chip>
          <Chip tint={color.muted}>No real integrations</Chip>
        </Reveal>
      </div>
      <AbsoluteFill>
        <svg width="1920" height="1080" style={{ position: "absolute" }}>
          {frame > 150 && <path d="M520 450 L760 450" stroke={color.alpha} strokeWidth="4" strokeDasharray="10 8" opacity={interpolate(frame, [150, 170], [0, 1], clamp)} />}
          {deviceYs.map((y, i) =>
            frame > 260 ? (
              <g key={y} opacity={interpolate(frame, [260 + i * 10, 280 + i * 10], [0, 1], clamp)}>
                <path d={`M1160 ${y + 50} L1400 600`} stroke={color.border} strokeWidth="4" />
                <circle
                  cx={1160 + 240 * dot(i * 20)}
                  cy={y + 50 + (550 - y) * dot(i * 20)}
                  r="9"
                  fill={crews[i]!.tint}
                />
              </g>
            ) : null,
          )}
        </svg>
        <Reveal at={110} style={{ position: "absolute", left: 160, top: 390, width: 360 }}>
          <Card style={{ padding: 26 }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>EOC</div>
            <div style={{ fontSize: 24, color: color.muted, marginTop: 6 }}>Emergency operations centre. Creates the Incident and gives the first Transfer leg.</div>
          </Card>
        </Reveal>
        {crews.map((crew, i) => (
          <Reveal key={crew.name} at={190 + i * 20} style={{ position: "absolute", left: 760, top: deviceYs[i], width: 400 }}>
            <Card style={{ padding: "18px 24px", display: "flex", alignItems: "center", gap: 18, borderLeft: `8px solid ${crew.tint}` }}>
              <TabletIcon size={52} tint={crew.tint} />
              <div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>Device of {crew.name}</div>
                <div style={{ fontSize: 21, color: color.muted }}>Its tablet, with its own Event log</div>
              </div>
            </Card>
          </Reveal>
        ))}
        <Reveal at={300} style={{ position: "absolute", left: 1400, top: 515, width: 360 }}>
          <Card style={{ padding: 26, borderTop: `8px solid ${color.text}` }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>Coordinator</div>
            <div style={{ fontSize: 24, color: color.muted, marginTop: 6 }}>The single place where every Device's Event log is gathered.</div>
          </Card>
        </Reveal>
        <div style={{ position: "absolute", left: 160, right: 160, top: 830, display: "flex", gap: 24 }}>
          {glossary.map((g, i) => (
            <Reveal key={g.term} at={420 + i * 40} style={{ flex: 1 }}>
              <Card style={{ padding: "20px 24px", background: color.accentSoft, border: "none", boxShadow: "none" }}>
                <div style={{ fontSize: 26, fontWeight: 700, color: color.accent }}>{g.term}</div>
                <div style={{ fontSize: 22, marginTop: 4 }}>{g.text}</div>
              </Card>
            </Reveal>
          ))}
        </div>
        <Reveal at={720} style={{ position: "absolute", left: 0, right: 0, top: 990, textAlign: "center", fontSize: 32, fontWeight: 600, color: color.accent }}>
          Let's see it working, with the real app and fictional data.
        </Reveal>
      </AbsoluteFill>
    </Scene>
  );
}
