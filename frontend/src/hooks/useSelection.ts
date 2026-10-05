import { useCallback, useMemo, useRef, useState } from "react";
import { analyzePolygon, type LngLat, type PolygonMetrics } from "../lib/geo";

export type SelectionMode = "idle" | "drawing" | "editing" | "confirmed";

export interface SelectionState {
  mode: SelectionMode;
  vertices: LngLat[];
  metrics: PolygonMetrics | null;
  historyDepth: number;
  start: () => void;
  addVertex: (point: LngLat) => void;
  finishDrawing: () => void;
  beginVertexDrag: () => void;
  enterEditing: () => void;
  moveVertex: (index: number, point: LngLat) => void;
  deleteVertex: (index: number) => void;
  undo: () => void;
  clear: () => void;
  confirm: () => void;
  redraw: () => void;
}

/** Polygon selection state machine (Milestone 2). */
export function useSelection(): SelectionState {
  const [mode, setMode] = useState<SelectionMode>("idle");
  const [vertices, setVertices] = useState<LngLat[]>([]);
  const verticesRef = useRef<LngLat[]>([]);
  verticesRef.current = vertices;
  const historyRef = useRef<LngLat[][]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);

  const pushHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-20), verticesRef.current];
    setHistoryDepth(historyRef.current.length);
  }, []);

  const metrics = useMemo(() => (vertices.length >= 3 ? analyzePolygon(vertices) : null), [vertices]);

  const start = useCallback(() => {
    setVertices([]);
    historyRef.current = [];
    setHistoryDepth(0);
    setMode("drawing");
  }, []);

  const addVertex = useCallback(
    (point: LngLat) => {
      if (mode !== "drawing") return;
      // A double-click fires two click events before dblclick; ignore near-identical placements.
      const last = verticesRef.current[verticesRef.current.length - 1];
      if (last && Math.abs(last.lng - point.lng) < 1e-6 && Math.abs(last.lat - point.lat) < 1e-6) return;
      pushHistory();
      setVertices((prev) => [...prev, point]);
    },
    [mode, pushHistory],
  );

  const finishDrawing = useCallback(() => {
    setMode((current) => {
      if (current !== "drawing" || verticesRef.current.length < 3) return current;
      return "editing";
    });
  }, []);

  const enterEditing = useCallback(() => {
    if (verticesRef.current.length >= 3) setMode("editing");
  }, []);

  const beginVertexDrag = useCallback(() => pushHistory(), [pushHistory]);

  const moveVertex = useCallback((index: number, point: LngLat) => {
    setVertices((prev) => prev.map((p, i) => (i === index ? point : p)));
  }, []);

  const deleteVertex = useCallback(
    (index: number) => {
      pushHistory();
      setVertices((prev) => prev.filter((_, i) => i !== index));
    },
    [pushHistory],
  );

  const undo = useCallback(() => {
    const previous = historyRef.current[historyRef.current.length - 1];
    if (!previous) return;
    historyRef.current = historyRef.current.slice(0, -1);
    setHistoryDepth(historyRef.current.length);
    setVertices(previous);
  }, []);

  const clear = useCallback(() => {
    setVertices([]);
    historyRef.current = [];
    setHistoryDepth(0);
    setMode("idle");
  }, []);

  const confirm = useCallback(() => {
    if (verticesRef.current.length >= 3 && metricsRef.current?.valid) setMode("confirmed");
  }, []);

  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  const redraw = useCallback(() => {
    setVertices([]);
    historyRef.current = [];
    setHistoryDepth(0);
    setMode("drawing");
  }, []);

  return {
    mode,
    vertices,
    metrics,
    historyDepth,
    start,
    addVertex,
    finishDrawing,
    enterEditing,
    moveVertex,
    deleteVertex,
    undo,
    clear,
    confirm,
    redraw,
    beginVertexDrag,
  };
}
