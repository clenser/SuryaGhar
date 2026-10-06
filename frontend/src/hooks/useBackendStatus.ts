import { useSyncExternalStore } from "react";
import {
  getBackendStatus,
  subscribeBackendStatus,
  type BackendStatus,
} from "../services/backendStatus";

/** Contextual message for controls locked while the backend is not ready. */
export const BACKEND_WAITING_LABEL = "Waiting for analysis server…";

/** Reactive view of the shared readiness state (driven by GET /api/ready). */
export function useBackendStatus(): BackendStatus {
  return useSyncExternalStore(subscribeBackendStatus, getBackendStatus);
}

/** True only after the backend reported readiness (GET /ready HTTP 200).
 * Backend-dependent controls must use this — never /health — to decide
 * whether they are enabled. */
export function useBackendReady(): boolean {
  return useBackendStatus() === "online";
}
