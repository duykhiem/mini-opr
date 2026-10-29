/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { configDefaults } from "vitest/config";
import { coordinatorPort } from "./src/shared/ports.ts";
import { deviceSocketPath } from "./src/shared/protocol.ts";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://localhost:${coordinatorPort}`,
      "/watch": { target: `ws://localhost:${coordinatorPort}`, ws: true },
      [deviceSocketPath]: { target: `ws://localhost:${coordinatorPort}`, ws: true },
    },
  },
  // Agent worktrees hold their own copy of the tests.
  test: { exclude: [...configDefaults.exclude, ".claude/worktrees/**"] },
});
