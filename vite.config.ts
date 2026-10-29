import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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
});
