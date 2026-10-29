import { Composition } from "remotion";
import { MiniOpr, totalFrames } from "./MiniOpr.tsx";

export function Root() {
  return <Composition id="MiniOpr" component={MiniOpr} durationInFrames={totalFrames} fps={30} width={1920} height={1080} />;
}
