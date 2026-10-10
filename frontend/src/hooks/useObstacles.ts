/**
 * useObstacles - Rooftop obstacle application state
 *
 * React owns the obstacle records (AGENTS.md §40, §72); Three.js only
 * renders them. Records survive stage changes and are cleared with the
 * selection (like the building height), so the same rooftop context is
 * always kept consistent.
 */

import { useCallback, useState } from "react";
import type { Obstacle } from "../lib/3d/obstacles";

export interface ObstacleStore {
  obstacles: Obstacle[];
  add: (obstacle: Obstacle) => void;
  update: (obstacle: Obstacle) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export function useObstacles(): ObstacleStore {
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);

  const add = useCallback((obstacle: Obstacle) => {
    setObstacles((current) =>
      current.some((o) => o.id === obstacle.id) ? current : [...current, obstacle],
    );
  }, []);

  const update = useCallback((obstacle: Obstacle) => {
    setObstacles((current) => current.map((o) => (o.id === obstacle.id ? obstacle : o)));
  }, []);

  const remove = useCallback((id: string) => {
    setObstacles((current) => current.filter((o) => o.id !== id));
  }, []);

  const clear = useCallback(() => setObstacles([]), []);

  return { obstacles, add, update, remove, clear };
}
