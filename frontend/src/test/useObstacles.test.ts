/**
 * Tests for the obstacle application-state hook (Phase 3).
 *
 * React owns the records: create, edit, delete and clear must all work
 * independently of any Three.js object (AGENTS.md §40, §72).
 */

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useObstacles } from "../hooks/useObstacles";
import type { Obstacle } from "../lib/3d/obstacles";

function obstacle(overrides: Partial<Obstacle> = {}): Obstacle {
  return {
    id: "obstacle-1",
    type: "water-tank",
    position: { x: 0, y: 0 },
    width: 2.5,
    length: 2.5,
    height: 2,
    rotation: 0,
    ...overrides,
  };
}

describe("useObstacles", () => {
  it("starts with an empty rooftop", () => {
    const { result } = renderHook(() => useObstacles());
    expect(result.current.obstacles).toEqual([]);
  });

  it("creates obstacles", () => {
    const { result } = renderHook(() => useObstacles());

    act(() => {
      result.current.add(obstacle());
      result.current.add(obstacle({ id: "obstacle-2", type: "hvac" }));
    });

    expect(result.current.obstacles).toHaveLength(2);
    expect(result.current.obstacles.map((o) => o.id)).toEqual(["obstacle-1", "obstacle-2"]);
  });

  it("ignores a duplicate id instead of corrupting the list", () => {
    const { result } = renderHook(() => useObstacles());

    act(() => {
      result.current.add(obstacle());
      result.current.add(obstacle({ width: 9 }));
    });

    expect(result.current.obstacles).toHaveLength(1);
    expect(result.current.obstacles[0].width).toBe(2.5);
  });

  it("edits an existing obstacle in place", () => {
    const { result } = renderHook(() => useObstacles());

    act(() => result.current.add(obstacle()));
    act(() =>
      result.current.update(
        obstacle({ width: 4, length: 3, height: 1.2, rotation: 45, position: { x: 5, y: -3 } }),
      ),
    );

    expect(result.current.obstacles).toHaveLength(1);
    expect(result.current.obstacles[0]).toMatchObject({
      width: 4,
      length: 3,
      height: 1.2,
      rotation: 45,
      position: { x: 5, y: -3 },
    });
  });

  it("deletes a single obstacle and keeps the rest", () => {
    const { result } = renderHook(() => useObstacles());

    act(() => {
      result.current.add(obstacle());
      result.current.add(obstacle({ id: "obstacle-2" }));
      result.current.add(obstacle({ id: "obstacle-3" }));
    });

    act(() => result.current.remove("obstacle-2"));

    expect(result.current.obstacles.map((o) => o.id)).toEqual(["obstacle-1", "obstacle-3"]);
  });

  it("clears the rooftop", () => {
    const { result } = renderHook(() => useObstacles());

    act(() => result.current.add(obstacle()));
    act(() => result.current.clear());

    expect(result.current.obstacles).toEqual([]);
  });

  it("keeps stable action identities across renders", () => {
    const { result, rerender } = renderHook(() => useObstacles());
    const first = result.current.add;
    rerender();
    expect(result.current.add).toBe(first);
  });
});
