import { useCurrentFrame, interpolate } from "remotion";
import { Card, Chip, Label, Reveal, Scene, clamp, color } from "../ui.tsx";

export const solutionFrames = 870;

const points = [
  { title: "One record per Patient", text: "Shared by every Transfer leg and every Resource. Each new crew sees everything at once." },
  { title: "Saved on the tablet first", text: "Each change is stored on the Device, then sent to the Coordinator in the background." },
  { title: "Nothing is overwritten", text: "Every vital and note is kept. For name, date of birth and triage, the newest edit wins." },
  { title: "Handover in seconds", text: "Join with the Incident id. No accept step, no retelling, nothing typed twice." },
];

// Scene 8: how Mini OPR answers the problem.
export function Solution() {
  return (
    <Scene duration={solutionFrames}>
      <div style={{ position: "absolute", left: 160, right: 160, top: 100 }}>
        <Reveal at={0}>
          <Label tint={color.ok}>The answer</Label>
        </Reveal>
        <Reveal at={8} style={{ fontSize: 64, fontWeight: 700, marginTop: 12 }}>
          How Mini OPR solves it
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 50 }}>
          {points.map((p, i) => (
            <Reveal key={p.title} at={60 + i * 120}>
              <Card style={{ padding: "30px 34px", height: 210, borderLeft: `8px solid ${color.ok}` }}>
                <div style={{ fontSize: 36, fontWeight: 700 }}>
                  <span style={{ color: color.ok, marginRight: 14 }}>✓</span>
                  {p.title}
                </div>
                <div style={{ fontSize: 28, color: color.muted, marginTop: 12, lineHeight: 1.4 }}>{p.text}</div>
              </Card>
            </Reveal>
          ))}
        </div>
        <Reveal at={600} style={{ fontSize: 28, marginTop: 44, lineHeight: 1.5 }}>
          Automated tests check that the same changes, in any order, rebuild the same Patient.
        </Reveal>
        <Reveal at={680} style={{ fontSize: 24, color: color.muted, marginTop: 10 }}>
          Scope: this demo works online only. Working without a network is outside this demo.
        </Reveal>
      </div>
    </Scene>
  );
}

export const claudeFrames = 1020;

const steps = [
  { skill: "wayfinder map", title: "Map the questions", text: "One GitHub issue lists every open question for the spec." },
  { skill: "research", title: "Research", text: "2 tickets: transport and database, from primary sources." },
  { skill: "grilling", title: "Grill each decision", text: "7 design decisions, questioned one by one until clear." },
  { skill: "prototype", title: "Prototype", text: "Screen layout tried out before any real code." },
  { skill: "CONTEXT.md + ADRs", title: "Write it down", text: "A shared glossary and 8 ADRs, for people and agents." },
  { skill: "ready-for-agent", title: "Agents build it", text: "12 tickets, each built by a Claude agent in its own git worktree." },
];

const stats = [
  { value: "33", label: "commits" },
  { value: "1", label: "day" },
  { value: "12", label: "agent tickets" },
  { value: "115", label: "automated tests" },
  { value: "8", label: "ADRs" },
];

// Scene 9: how the project was built with Claude Code and the mattpocock skills.
export function BuiltWithClaude() {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [80, 80 + steps.length * 75], [0, 1], clamp);
  return (
    <Scene duration={claudeFrames}>
      <div style={{ position: "absolute", left: 120, right: 120, top: 80 }}>
        <Reveal at={0}>
          <Label tint="#c15f3c">Built with Claude</Label>
        </Reveal>
        <Reveal at={8} style={{ fontSize: 60, fontWeight: 700, marginTop: 12 }}>
          Agentic AI, from first question to working code
        </Reveal>
        <Reveal at={30} style={{ fontSize: 30, color: color.muted, marginTop: 12 }}>
          Claude Code with the mattpocock-skills plugin. People made the decisions; agents did the legwork.
        </Reveal>
        <div style={{ position: "relative", marginTop: 70 }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 26, height: 6, borderRadius: 3, background: color.border }} />
          <div style={{ position: "absolute", left: 0, width: `${progress * 100}%`, top: 26, height: 6, borderRadius: 3, background: "#c15f3c" }} />
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 20 }}>
            {steps.map((s, i) => (
              <Reveal key={s.title} at={80 + i * 75}>
                <div style={{ width: 58, height: 58, borderRadius: 29, background: "#c15f3c", color: "#fff", display: "grid", placeItems: "center", fontSize: 28, fontWeight: 700 }}>
                  {i + 1}
                </div>
                <Card style={{ padding: 22, marginTop: 20, height: 280 }}>
                  <Chip tint="#c15f3c" style={{ fontSize: 19, fontFamily: "Consolas, monospace" }}>
                    {s.skill}
                  </Chip>
                  <div style={{ fontSize: 28, fontWeight: 700, marginTop: 14 }}>{s.title}</div>
                  <div style={{ fontSize: 22, color: color.muted, marginTop: 8, lineHeight: 1.4 }}>{s.text}</div>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 70, marginTop: 70 }}>
          {stats.map((s, i) => (
            <Reveal key={s.label} at={620 + i * 25} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 76, fontWeight: 800, color: color.text, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 24, color: color.muted, marginTop: 6 }}>{s.label}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </Scene>
  );
}

export const endFrames = 270;

// Scene 10: closing card.
export function End() {
  return (
    <Scene duration={endFrames}>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <Reveal at={10} style={{ fontSize: 120, fontWeight: 800 }}>
            Mini OPR
          </Reveal>
          <Reveal at={30} style={{ fontSize: 44, color: color.accent, marginTop: 10 }}>
            One Patient Record, travelling with the patient.
          </Reveal>
          <Reveal at={70} style={{ fontSize: 26, color: color.muted, marginTop: 40 }}>
            A demo, not a product. Every name, patient and value is fictional.
          </Reveal>
        </div>
      </div>
    </Scene>
  );
}
