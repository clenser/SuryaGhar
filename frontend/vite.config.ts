import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the FastAPI backend so the browser never talks to
// backend secrets directly and the backend origin is not hard-coded in the app.
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // MapLibre is large and changes rarely; keep it in its own cacheable chunk.
        manualChunks: { maplibre: ["maplibre-gl"] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
