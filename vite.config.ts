import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { coordinatorPort } from "./src/shared/ports.ts";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": `http://localhost:${coordinatorPort}`,
      "/watch": { target: `ws://localhost:${coordinatorPort}`, ws: true },
    },
  },
});
