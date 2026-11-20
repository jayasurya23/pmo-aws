import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Same shape as PMO 360's Vite config: dev proxy /api -> FastAPI on :8000.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": { target: process.env.VITE_API_PROXY || "http://127.0.0.1:8000", changeOrigin: true } },
  },
  preview: {
    port: 8080,
    proxy: { "/api": { target: process.env.VITE_API_PROXY || "http://127.0.0.1:8000", changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 1200 },
});
