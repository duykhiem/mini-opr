import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCoordinator, type Coordinator } from "./coordinator.ts";

const started: Coordinator[] = [];

async function start(dbPath: string): Promise<Coordinator> {
  const coordinator = await startCoordinator({ dbPath, port: 0 });
  started.push(coordinator);
  return coordinator;
}

async function closeAll(): Promise<void> {
  await Promise.all(started.splice(0).map((c) => c.close()));
}

afterEach(closeAll);

describe("Coordinator", () => {
  it("serves the seeded Resources over HTTP", async () => {
    const coordinator = await start(":memory:");

    const response = await fetch(`http://localhost:${coordinator.port}/api/resources`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { resourceId: "alpha-1", name: "Alpha 1" },
      { resourceId: "bravo-2", name: "Bravo 2" },
      { resourceId: "charlie-3", name: "Charlie 3" },
    ]);
  });

  // A restart needs a file; :memory: does not survive close (ADR 0007).
  it("keeps its Coordinator epoch across a plain restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mini-opr-"));
    try {
      const dbPath = join(dir, "coordinator.sqlite");
      const first = await start(dbPath);
      const epoch = first.epoch;
      await first.close();

      const second = await start(dbPath);

      expect(epoch).not.toBe("");
      expect(second.epoch).toBe(epoch);
      expect((await start(":memory:")).epoch).not.toBe(epoch);
    } finally {
      await closeAll();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
