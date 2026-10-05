/**
 * Base URL for the SuryaGhar backend.
 *
 * - Production (Vercel): built with VITE_API_BASE_URL=https://suryaghar.onrender.com
 * - Local dev: unset; requests go to "/api" which Vite proxies to localhost:8000.
 * Production NEVER silently falls back to localhost.
 */
const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

if (!configured && !import.meta.env.DEV) {
  console.error("[API] VITE_API_BASE_URL was not set at build time. The production build will not talk to a localhost backend.");
}

export const API_BASE_URL = configured ? configured.replace(/\/+$/, "") : "/api";
