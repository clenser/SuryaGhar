/**
 * Base URL for the SuryaGhar backend.
 *
 * - Production (Vercel): set VITE_API_BASE_URL=https://suryaghar.onrender.com
 * - Local dev: unset; requests go to "/api" which Vite proxies to localhost:8000.
 */
const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;

export const API_BASE_URL = configured ? configured.replace(/\/+$/, "") : "/api";
