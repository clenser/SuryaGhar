import { useCallback, useState } from "react";
import type { LayerSettings, MapErrorEntry, MapViewState } from "../types";

/** Satellite-first defaults: imagery on, roads/labels and buildings off. */
export const DEFAULT_LAYERS: LayerSettings = {
  satelliteOpacity: 1,
  contextOpacity: 0,
  buildings3d: false,
  terrain: false,
  terrainExaggeration: 1.2,
};

const MAX_ERRORS = 50;
const ERROR_WINDOW_MS = 4000;

/** Map UI state kept separate from analysis state (MASTER_PROMPT section 30). */
export function useMapState() {
  const [layers, setLayers] = useState<LayerSettings>(DEFAULT_LAYERS);
  const [view, setView] = useState<MapViewState | null>(null);
  const [errors, setErrors] = useState<MapErrorEntry[]>([]);

  const updateLayers = useCallback((patch: Partial<LayerSettings>) => {
    setLayers((prev) => ({ ...prev, ...patch }));
  }, []);

  const recordError = useCallback((entry: Omit<MapErrorEntry, "id" | "at">) => {
    setErrors((prev) => {
      const last = prev[prev.length - 1];
      const now = Date.now();
      // Collapse bursts of the same failure (one broken tile set can emit dozens of errors).
      if (last && last.message === entry.message && now - last.id < ERROR_WINDOW_MS) {
        return prev;
      }
      const next: MapErrorEntry = {
        id: now,
        at: new Date(now).toISOString().slice(11, 19),
        ...entry,
      };
      return [...prev, next].slice(-MAX_ERRORS);
    });
  }, []);

  return { layers, updateLayers, view, setView, errors, recordError };
}
