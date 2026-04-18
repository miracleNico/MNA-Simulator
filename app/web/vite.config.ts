import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.VITE_API_PORT ?? "8010";
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const wsOrigin = `ws://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiOrigin,
      "/health": apiOrigin,
      "/ws": {
        target: wsOrigin,
        ws: true
      }
    }
  }
});
