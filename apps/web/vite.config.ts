import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://127.0.0.1:5177";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": api,
      "/img": api,
      "/ws": { target: api.replace("http", "ws"), ws: true },
    },
  },
  // Deck analysis runs the rules engine in module workers (code-split, loaded only when used).
  worker: { format: "es" },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
