import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the FastAPI backend so the browser never talks to
// backend secrets directly and the backend origin is not hard-coded in the app.
export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "GOOGLE_GEOCODING_", "GOOGLE_STATIC_MAPS_"],
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {},
  },
  server: {
    port: 5173,
    // Bind the IPv4 loopback explicitly. The default host resolves
    // `localhost` to ::1 first on Windows, which binds IPv6 ONLY and leaves
    // http://127.0.0.1:5173 refusing connections (the Vite proxy target and
    // most local tooling use the IPv4 literal).
    host: "127.0.0.1",
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
