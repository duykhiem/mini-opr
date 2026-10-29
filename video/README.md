# Mini OPR video

A video of about 4:50 that introduces OPR and Mini OPR, demos the app, and shows how it was built with Claude. It is made with [Remotion](https://www.remotion.dev/) (React) and [Playwright](https://playwright.dev/), and has its own `package.json` so the app gets no new dependencies.

Remotion is free only for individuals and small companies. Check [remotion.dev/license](https://www.remotion.dev/license) before using it for company work.

## Making the video

```sh
cd video
npm install
npx playwright install chromium
npm run record     # demo clips into public/clips/ (about 2.5 minutes)
npm run music      # background music into public/music.mp3
npm run render     # out/mini-opr.mp4
```

`npm run studio` opens Remotion Studio to preview and edit scenes.

`npm run record` starts its own Coordinator (with a fresh database in `out/`) and Vite on ports 3101 and 5273, so it does not clash with a running `npm run dev`. Run it again whenever the app's screens change: the captions follow markers that the script writes next to each clip.

## Scenes

| # | Scene | Source |
|---|---|---|
| 1 | One patient, three crews, three tablets | `src/scenes/Intro.tsx` |
| 2 | The problem: details lost at each handover | `src/scenes/Intro.tsx` |
| 3 | OPR: One Patient Record | `src/scenes/Intro.tsx` |
| 4 | Mini OPR, its parts and glossary | `src/scenes/Intro.tsx` |
| 5-8 | Demo: new Incident, Handover, Closed and reopened, Coordinator | `record/record.ts`, `src/scenes/Demo.tsx` |
| 9 | How Mini OPR solves the problem | `src/scenes/Outro.tsx` |
| 10 | Built with Claude | `src/scenes/Outro.tsx` |
| 11 | Closing card | `src/scenes/Outro.tsx` |

## Music

`record/music.ts` writes a calm ambient track from sine waves, so the video carries no third-party music licence. To use another track, put it at `public/music.mp3`.

All names, patients and values are fictional.
