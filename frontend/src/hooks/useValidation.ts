import { useCallback, useEffect, useRef, useState } from "react";
import {
  validateSurface,
  type SegmentationModel,
  type ValidationResult,
} from "../services/analysis";
import type { LngLat } from "../lib/geo";

export type ValidationSnapshot =
  | { kind: "idle" }
  | { kind: "loading"; model: SegmentationModel; startedAt: number }
  | { kind: "error"; message: string; model: SegmentationModel }
  | { kind: "ok"; result: ValidationResult; model: SegmentationModel };

export interface ValidationController {
  snapshot: ValidationSnapshot;
  elapsed: number;
  proceed: (vertices: LngLat[], model: SegmentationModel) => void;
  reset: () => void;
}

/**
 * Validation state lives here (owned by App), NOT in ValidatePanel, so tab
 * switches — which unmount/remount the panel — never lose the result.
 * In-flight requests survive tab switches; stale runs are ignored via runId,
 * so returning to the tab never triggers a duplicate request.
 */
export function useValidation(): ValidationController {
  const [snapshot, setSnapshot] = useState<ValidationSnapshot>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const runId = useRef(0);

  // Wall-clock timer while a request is in flight (no fake progress bar).
  useEffect(() => {
    if (snapshot.kind !== "loading") return;
    const startedAt = snapshot.startedAt;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [snapshot]);

  const proceed = useCallback((vertices: LngLat[], model: SegmentationModel) => {
    const id = ++runId.current;
    setSnapshot({ kind: "loading", model, startedAt: Date.now() });
    const controller = new AbortController();
    // The selected model is always sent explicitly; the backend never
    // substitutes another model for an explicit choice.
    validateSurface(vertices, model, controller.signal)
      .then((result) => {
        if (runId.current !== id) return;
        setSnapshot({ kind: "ok", result, model });
      })
      .catch((err) => {
        if (runId.current !== id) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setSnapshot({ kind: "idle" });
          return;
        }
        setSnapshot({ kind: "error", message: err instanceof Error ? err.message : "Validation failed", model });
      });
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    setSnapshot({ kind: "idle" });
    setElapsed(0);
  }, []);

  return { snapshot, elapsed, proceed, reset };
}
