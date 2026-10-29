// Records the demo clips for scenes 5-7 of the video: a fresh Coordinator and Vite, one browser, and
// one page per segment with the app's pages side by side in iframes. Each segment writes
// public/clips/<name>.webm and public/clips/<name>.json (caption markers in ms from the clip start).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type FrameLocator, type Locator, type Page } from "playwright";

const videoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(videoDir, "..");
const clipsDir = join(videoDir, "public", "clips");
const rawDir = join(videoDir, "out", "raw");
const dbPath = join(videoDir, "out", "demo.sqlite");
// Ports match record/vite.config.ts.
const app = "http://localhost:5273";
const width = 1920;
const height = 1080;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function start(args: string[], env: Record<string, string> = {}): ChildProcess {
  return spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: "ignore" });
}

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`${url} did not come up. Are ports 5273 and 3101 free?`);
}

type Pane = { title: string; subtitle: string; path: string };

// Panes share the width; each iframe is drawn larger and scaled down so the app keeps its desktop layout.
function gridHtml(panes: Pane[]): string {
  const gap = 24;
  const labelHeight = 52;
  const paneWidth = (width - gap * (panes.length + 1)) / panes.length;
  const frameHeight = height - gap * 2 - labelHeight;
  const scale = panes.length === 1 ? 0.9 : 0.8;
  const cells = panes
    .map(
      (p, i) => `<section style="width:${paneWidth}px">
        <header><strong>${p.title}</strong><span>${p.subtitle}</span></header>
        <div class="frame" style="height:${frameHeight}px">
          <iframe name="p${i}" src="${p.path}" style="width:${paneWidth / scale}px;height:${frameHeight / scale}px;transform:scale(${scale})"></iframe>
        </div>
      </section>`,
    )
    .join("");
  return `<!doctype html><html><head><style>
    body { margin:0; background:#e8ecf1; font-family:"Segoe UI",system-ui,sans-serif; overflow:hidden; }
    .grid { display:flex; gap:${gap}px; padding:${gap}px; }
    header { height:${labelHeight - 8}px; display:flex; align-items:baseline; gap:12px; padding:0 4px; }
    header strong { font-size:22px; color:#1b2330; }
    header span { font-size:16px; color:#5f6b7c; }
    .frame { overflow:hidden; border-radius:12px; border:1px solid #d3d9e2; background:#f4f6f9; box-shadow:0 4px 16px #1b233014; }
    iframe { border:0; transform-origin:0 0; display:block; }
    #cursor { position:fixed; left:0; top:0; width:28px; height:28px; z-index:10; pointer-events:none;
      transition:transform 650ms cubic-bezier(.4,0,.2,1); transform:translate(${width / 2}px,${height + 40}px); }
    #ripple { position:fixed; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:50%; z-index:9;
      background:#1f5fbf44; pointer-events:none; opacity:0; }
    #ripple.on { animation:ripple 450ms ease-out; }
    @keyframes ripple { from { opacity:1; transform:scale(.3) } to { opacity:0; transform:scale(1.4) } }
  </style></head><body>
    <div class="grid">${cells}</div>
    <div id="ripple"></div>
    <svg id="cursor" viewBox="0 0 24 24"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#1b2330" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>
  </body></html>`;
}

// One recorded segment: its page, a frame per pane, and caption markers.
class Segment {
  readonly t0 = Date.now();
  readonly markers: { at: number; id: string }[] = [];
  readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  frame(i: number): FrameLocator {
    return this.page.frameLocator(`iframe[name=p${i}]`);
  }

  mark(id: string) {
    this.markers.push({ at: Date.now() - this.t0, id });
  }

  async point(target: Locator) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("No box for target");
    const x = box.x + Math.min(box.width / 2, 60);
    const y = box.y + box.height / 2;
    await this.page.evaluate(([x, y]) => {
      document.getElementById("cursor")!.style.transform = `translate(${x - 4}px,${y - 2}px)`;
    }, [x, y]);
    await wait(750);
    return { x, y };
  }

  async click(target: Locator) {
    const { x, y } = await this.point(target);
    await this.page.evaluate(([x, y]) => {
      const r = document.getElementById("ripple")!;
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      r.classList.remove("on");
      void r.offsetWidth;
      r.classList.add("on");
    }, [x, y]);
    await target.click();
    await wait(350);
  }

  async type(target: Locator, text: string) {
    await this.click(target);
    await target.pressSequentially(text, { delay: 55 });
    await wait(300);
  }

  async choose(target: Locator, value: string) {
    await this.point(target);
    await target.selectOption(value);
    await wait(500);
  }

  async fill(target: Locator, value: string) {
    await this.click(target);
    await target.fill(value);
    await wait(500);
  }
}

async function record(context: BrowserContext, name: string, panes: Pane[], script: (s: Segment) => Promise<void>) {
  await context.route(`${app}/__grid`, (route) => route.fulfill({ contentType: "text/html", body: gridHtml(panes) }));
  const page = await context.newPage();
  await page.goto(`${app}/__grid`);
  await page.waitForLoadState("networkidle");
  const segment = new Segment(page);
  await wait(800);
  await script(segment);
  await wait(1500);
  const video = page.video()!;
  await page.close();
  renameSync(await video.path(), join(clipsDir, `${name}.webm`));
  writeFileSync(join(clipsDir, `${name}.json`), JSON.stringify({ duration: Date.now() - segment.t0, markers: segment.markers }, null, 2));
  await context.unroute(`${app}/__grid`);
  console.log(`Recorded ${name}`);
}

const incidentId = "INC-0001";
const eoc: Pane = { title: "EOC", subtitle: "Emergency operations centre", path: "/eoc" };
const device = (resourceId: string, name: string): Pane => ({
  title: `Device: ${name}`,
  subtitle: `Tablet of Resource ${name}`,
  path: `/device?resource=${resourceId}`,
});
const alpha = device("alpha-1", "Alpha 1");
const bravo = device("bravo-2", "Bravo 2");
const charlie = device("charlie-3", "Charlie 3");
const coordinator: Pane = { title: "Coordinator", subtitle: "Every Device's Event log, gathered in one place", path: "/coordinator" };

const tile = (f: FrameLocator) => f.getByRole("button", { name: new RegExp(incidentId) });

async function addVitals(s: Segment, f: FrameLocator, vitals: [string, string][]) {
  await s.click(f.getByRole("button", { name: "Vitals", exact: true }));
  for (const [label, value] of vitals) await s.type(f.getByLabel(label), value);
  await s.click(f.getByRole("button", { name: "Add", exact: true }));
}

async function addNote(s: Segment, f: FrameLocator, text: string) {
  await s.click(f.getByRole("button", { name: "Note", exact: true }));
  await s.type(f.getByLabel("Note"), text);
  await s.click(f.getByRole("button", { name: "Add", exact: true }));
}

async function join_(s: Segment, f: FrameLocator) {
  await s.click(f.getByRole("button", { name: "Resource", exact: true }));
  await s.type(f.getByLabel("Incident id"), incidentId);
  await s.click(f.getByRole("button", { name: "Join", exact: true }));
  await f.getByRole("heading", { name: incidentId }).waitFor();
}

async function completeLeg(s: Segment, f: FrameLocator) {
  await s.click(f.getByRole("button", { name: "Complete my Transfer leg", exact: true }));
  await s.click(f.getByRole("button", { name: "Complete my Transfer leg..." }));
  await wait(600);
  await s.click(f.locator("dialog[open]").getByRole("button", { name: "Complete my Transfer leg" }));
}

const processes: ChildProcess[] = [];
try {
  rmSync(join(videoDir, "out"), { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(clipsDir, { recursive: true });
  processes.push(start(["src/coordinator/main.ts"], { MINI_OPR_DB: dbPath, MINI_OPR_PORT: "3101" }));
  processes.push(start(["node_modules/vite/bin/vite.js", "--config", "video/record/vite.config.ts"]));
  await waitFor(`${app}/api/resources`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: "light",
    recordVideo: { dir: rawDir, size: { width, height } },
  });

  await record(context, "eoc", [eoc, alpha], async (s) => {
    const e = s.frame(0);
    const a = s.frame(1);
    await wait(1500);
    s.mark("create");
    await s.type(e.getByLabel("Patient name"), "Kari Nordmann");
    await s.fill(e.getByLabel("Date of birth"), "1958-04-12");
    await s.choose(e.getByLabel("Triage"), "orange");
    await s.choose(e.getByLabel("Resource for the first Transfer leg"), "alpha-1");
    await s.click(e.getByRole("button", { name: "Create Incident" }));
    await tile(a).waitFor();
    s.mark("tile");
    await wait(3000);
    await s.click(tile(a));
    s.mark("vitals");
    await wait(1500);
    await addVitals(s, a, [
      ["Pulse (/min)", "118"],
      ["Systolic (mmHg)", "94"],
      ["Diastolic (mmHg)", "58"],
      ["SpO2 (%)", "91"],
    ]);
    s.mark("note");
    await addNote(s, a, "Fell from a ladder. Pain in left hip. Alert and talking.");
    s.mark("log");
    await wait(1000);
    await s.click(a.getByRole("button", { name: "My Event log" }));
    await wait(3500);
    await s.click(a.getByRole("button", { name: "Feed", exact: true }));
    await wait(1500);
  });

  await record(context, "handover", [alpha, bravo], async (s) => {
    const a = s.frame(0);
    const b = s.frame(1);
    await s.click(tile(a));
    await wait(1000);
    s.mark("join");
    await join_(s, b);
    s.mark("history");
    await wait(4000);
    s.mark("complete");
    await completeLeg(s, a);
    await wait(2500);
    s.mark("realtime");
    await addVitals(s, b, [
      ["Pulse (/min)", "104"],
      ["Systolic (mmHg)", "102"],
      ["Diastolic (mmHg)", "64"],
      ["SpO2 (%)", "95"],
    ]);
    await wait(2500);
    s.mark("stillEdit");
    await addNote(s, a, "Handed over to Bravo 2. Morphine 5 mg given at 10:42.");
    await wait(2500);
    s.mark("triage");
    await s.click(b.getByRole("button", { name: "Triage", exact: true }));
    await s.choose(b.getByLabel("Triage"), "yellow");
    await s.click(b.getByRole("button", { name: "Add", exact: true }));
    await wait(3500);
  });

  await record(context, "close", [bravo, charlie], async (s) => {
    const b = s.frame(0);
    const c = s.frame(1);
    await s.click(tile(b));
    await wait(1000);
    s.mark("complete");
    await completeLeg(s, b);
    s.mark("closed");
    await wait(4500);
    s.mark("reopen");
    await join_(s, c);
    await wait(3000);
    s.mark("note");
    await addNote(s, c, "Second transfer, to the university hospital.");
    await wait(3000);
  });

  // The Devices stay open off camera, so the Coordinator page shows them connected.
  const background = await Promise.all(
    [alpha, bravo, charlie].map(async (pane) => {
      const page = await context.newPage();
      await page.goto(`${app}${pane.path}`);
      await page.getByRole("status").filter({ hasText: "Online" }).waitFor();
      return page;
    }),
  );
  await record(context, "coordinator", [coordinator], async (s) => {
    const f = s.frame(0);
    s.mark("lanes");
    await wait(6000);
    s.mark("merged");
    await s.click(f.getByRole("button", { name: "Merged log" }));
    await wait(2500);
    await f.getByRole("heading", { name: "Merged log" }).scrollIntoViewIfNeeded();
    await wait(6000);
  });

  for (const page of background) await page.close();
  await context.close();
  await browser.close();
} finally {
  for (const p of processes) p.kill();
}
// The off-camera pages leave their own videos behind; Windows can hold the files for a moment.
await wait(1000);
rmSync(rawDir, { recursive: true, force: true, maxRetries: 5 });
