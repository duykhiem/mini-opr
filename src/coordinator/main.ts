import { coordinatorPort } from "../shared/ports.ts";
import { startCoordinator } from "./coordinator.ts";

const coordinator = await startCoordinator({
  dbPath: process.env.MINI_OPR_DB ?? "mini-opr.sqlite",
  port: Number(process.env.MINI_OPR_PORT ?? coordinatorPort),
});

console.log(`Coordinator listening on port ${coordinator.port}, epoch ${coordinator.epoch}`);
