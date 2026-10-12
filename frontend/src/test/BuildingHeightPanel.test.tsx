/**
 * Tests for BuildingHeightPanel component
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BuildingHeightPanel } from "../components/analysis/BuildingHeightPanel";
import { DEFAULT_BUILDING_HEIGHT_M } from "../lib/3d/building";
import type { LngLat, PolygonMetrics } from "../lib/geo";

const TEST_VERTICES: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

const TEST_METRICS: PolygonMetrics = {
  areaM2: 84.5,
  perimeterM: 44.2,
  centroid: { lng: 88.3642, lat: 22.57285 },
  valid: true,
  issue: null,
};

const PROPS = {
  vertices: TEST_VERTICES,
  metrics: TEST_METRICS,
  onConfirm: vi.fn(),
  backendReady: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BuildingHeightPanel", () => {
  it("renders stage header and terrace metrics", () => {
    render(<BuildingHeightPanel {...PROPS} />);

    expect(screen.getByText("Stage 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("Building height")).toBeInTheDocument();
    expect(screen.getByText("84.5 m²")).toBeInTheDocument(); // area
    expect(screen.getByText("44.2 m")).toBeInTheDocument(); // perimeter
    expect(screen.getByText("4")).toBeInTheDocument(); // vertices
  });

  it("shows default height value", () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    expect(input).toHaveValue(10);
  });

  it("defaults new buildings to DEFAULT_BUILDING_HEIGHT_M", () => {
    // A fresh building with no supplied height starts at the shared 10 m
    // default (single source in lib/3d/building), not a stale literal.
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    expect(input).toHaveValue(DEFAULT_BUILDING_HEIGHT_M);
    expect(DEFAULT_BUILDING_HEIGHT_M).toBe(10);
  });

  it("prefills an existing height when provided", () => {
    render(<BuildingHeightPanel {...PROPS} initialHeight={17.2} />);

    const input = screen.getByLabelText("Building height (metres)");
    expect(input).toHaveValue(17.2);
  });

  it("updates height on input change", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "17.2");

    expect(input).toHaveValue(17.2);
  });

  it("validates minimum height", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "0.1");

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    await userEvent.click(button);

    expect(await screen.findByText(/at least 0.5 m/i)).toBeInTheDocument();
    expect(PROPS.onConfirm).not.toHaveBeenCalled();
  });

  it("validates maximum height", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "300");

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    await userEvent.click(button);

    expect(await screen.findByText(/not exceed 200 m/i)).toBeInTheDocument();
    expect(PROPS.onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm with valid height", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(PROPS.onConfirm).toHaveBeenCalledWith(10); // default height
    });
  });

  it("calls onConfirm with custom height", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "17.2");

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    await userEvent.click(button);

    await waitFor(() => {
      expect(PROPS.onConfirm).toHaveBeenCalledWith(17.2);
    });
  });

  it("disables button when backend not ready", () => {
    render(<BuildingHeightPanel {...PROPS} backendReady={false} />);

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    expect(button).toBeDisabled();
  });

  it("shows readiness lock message when backend not ready", () => {
    render(<BuildingHeightPanel {...PROPS} backendReady={false} />);

    expect(screen.getByText(/Waiting for analysis server/i)).toBeInTheDocument();
    expect(screen.getByText(/Height input works offline/i)).toBeInTheDocument();
  });

  it("shows hint with calculated volume", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "10");

    // The preview states the extrusion height derived from the input.
    expect(screen.getByText(/extruded to 10\.0 m/i)).toBeInTheDocument();
  });

  it("requires positive number", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "-5");

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    await userEvent.click(button);

    expect(await screen.findByText(/at least 0.5 m/i)).toBeInTheDocument();
  });

  it("rejects a zero height", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    await userEvent.click(screen.getByRole("button", { name: /Create 3D Building/i }));

    expect(await screen.findByText(/at least 0.5 m/i)).toBeInTheDocument();
    expect(PROPS.onConfirm).not.toHaveBeenCalled();
  });

  it("handles NaN input gracefully", async () => {
    render(<BuildingHeightPanel {...PROPS} />);

    const input = screen.getByLabelText("Building height (metres)");
    await userEvent.clear(input);
    await userEvent.type(input, "abc");

    const button = screen.getByRole("button", { name: /Create 3D Building/i });
    await userEvent.click(button);

    expect(await screen.findByText(/valid number/i)).toBeInTheDocument();
  });
});