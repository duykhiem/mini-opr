// The app's Vite setup on its own ports, so recording does not clash with a running npm run dev.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appPort = 5273;
const coordinatorPort = 3101;

export default defineConfig({
  root: new URL("../..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  plugins: [react()],
  server: {
    port: appPort,
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${coordinatorPort}`,
      "/watch": { target: `ws://localhost:${coordinatorPort}`, ws: true },
      "/sync": { target: `ws://localhost:${coordinatorPort}`, ws: true },
    },
  },
});
