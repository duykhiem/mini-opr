import { Audio, Series, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Demo, demoScenes } from "./scenes/Demo.tsx";
import { Hook, MiniOprIntro, Opr, Problem, hookFrames, miniOprFrames, oprFrames, problemFrames } from "./scenes/Intro.tsx";
import { BuiltWithClaude, End, Solution, claudeFrames, endFrames, solutionFrames } from "./scenes/Outro.tsx";
import { clamp } from "./ui.tsx";

const scenes = [
  { frames: hookFrames, render: () => <Hook /> },
  { frames: problemFrames, render: () => <Problem /> },
  { frames: oprFrames, render: () => <Opr /> },
  { frames: miniOprFrames, render: () => <MiniOprIntro /> },
  ...demoScenes.map((scene) => ({ frames: scene.frames, render: () => <Demo scene={scene} /> })),
  { frames: solutionFrames, render: () => <Solution /> },
  { frames: claudeFrames, render: () => <BuiltWithClaude /> },
  { frames: endFrames, render: () => <End /> },
];

export const totalFrames = scenes.reduce((sum, s) => sum + s.frames, 0);

export function MiniOpr() {
  const frame = useCurrentFrame();
  // Quiet under the captions, a fade in at the start and out at the end.
  const volume = 0.35 * interpolate(frame, [0, 60, totalFrames - 120, totalFrames], [0, 1, 1, 0], clamp);
  return (
    <>
      <Series>
        {scenes.map((s, i) => (
          <Series.Sequence key={i} durationInFrames={s.frames}>
            {s.render()}
          </Series.Sequence>
        ))}
      </Series>
      <Audio src={staticFile("music.mp3")} volume={volume} />
    </>
  );
}
