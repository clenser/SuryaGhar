/**
 * Base URL for the SuryaGhar backend.
 *
 * - Production (Vercel): VITE_API_BASE_URL=/api. The Vercel deployment rewrites
 *   /api/:path* to the AWS backend (see frontend/vercel.json), so the browser
 *   stays on the Vercel HTTPS origin and never calls backend IPs directly.
 * - Local dev: unset; requests go to "/api" which the Vite dev server proxies
 *   to http://127.0.0.1:8000 (see frontend/vite.config.ts).
 * Production NEVER silently falls back to localhost.
 */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

if (!configured && !import.meta.env.DEV) {
  console.error("[API] VITE_API_BASE_URL was not set at build time. The production build will not talk to a localhost backend.");
}

export const API_BASE_URL = configured ? configured.replace(/\/+$/, "") : "/api";
