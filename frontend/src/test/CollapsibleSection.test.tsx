/**
 * Tests for inspector collapsible sections (SuryaGhar M3.5).
 *
 * Verifies that:
 * 1. CollapsibleSection starts collapsed by default (aria-expanded="false").
 * 2. Clicking a section header toggles open/closed without forcibly re-collapsing.
 * 3. All 7 inspector sections in ModelPanel start collapsed on initial entry into design mode.
 * 4. Expanding any section reveals its controls and keeps them interactive.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollapsibleSection } from "../components/3d/CollapsibleSection";
import { ModelPanel } from "../components/analysis/ModelPanel";
import type { LngLat, PolygonMetrics } from "../lib/geo";

vi.mock("three", async () => {
  const actual = await vi.importActual<typeof import("three")>("three");
  class WebGLRenderer {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: null as number | null, autoUpdate: false };
    toneMapping = 0;
    toneMappingExposure = 1;
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => {
  class OrbitControls {
    target = { set: (..._args: number[]) => {} };
    enableRotate = true;
    enableZoom = true;
    enablePan = true;
    enableDamping = false;
    dampingFactor = 0;
    rotateSpeed = 1;
    zoomSpeed = 1;
    minPolarAngle = 0;
    maxPolarAngle = Math.PI;
    minDistance = 0;
    maxDistance = Infinity;
    mouseButtons = {};
    touches = {};
    update() {}
    dispose() {}
  }
  return { OrbitControls };
});

const originalGetContext = HTMLCanvasElement.prototype.getContext;

const TERRACE: LngLat[] = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

const METRICS: PolygonMetrics = {
  areaM2: 84.5,
  perimeterM: 44.2,
  centroid: { lng: 88.3642, lat: 22.57285 },
  valid: true,
  issue: null,
};

describe("CollapsibleSection unit tests", () => {
  it("defaults to collapsed state with aria-expanded=false", () => {
    render(
      <CollapsibleSection id="test-sec" title="Test Section">
        <div>Content inside section</div>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /Test Section/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const section = button.closest("section");
    expect(section).toHaveClass("is-closed");
    expect(section).not.toHaveClass("is-open");
  });

  it("toggles open and closed on click", async () => {
    render(
      <CollapsibleSection id="test-sec" title="Test Section">
        <div>Content inside section</div>
      </CollapsibleSection>,
    );

    const button = screen.getByRole("button", { name: /Test Section/i });
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button.closest("section")).toHaveClass("is-open");

    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.closest("section")).toHaveClass("is-closed");
  });
});

describe("ModelPanel default-collapsed inspector sections", () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = ((type: string) =>
      type === "webgl2" ? ({} as unknown as WebGL2RenderingContext) : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("renders all 7 inspector sections collapsed by default in design mode", () => {
    const { container } = render(
      <ModelPanel
        vertices={TERRACE}
        metrics={METRICS}
        buildingHeight={15}
        designMode={true}
        backendReady={true}
      />,
    );

    const sectionIds = [
      "metrics",
      "parapet",
      "sun",
      "weather",
      "obstacles",
      "panel-sets",
      "panel-config",
    ];

    sectionIds.forEach((id) => {
      const section = container.querySelector(`[data-section-id="${id}"]`);
      expect(section).toBeInTheDocument();
      expect(section).toHaveClass("is-closed");
      expect(section).not.toHaveClass("is-open");

      const header = section!.querySelector(".collapsible-section__header");
      expect(header).toBeInTheDocument();
      expect(header).toHaveAttribute("aria-expanded", "false");
    });
  });

  it("allows expanding and interacting with a section without collapsing on subsequent renders", async () => {
    const { container, rerender } = render(
      <ModelPanel
        vertices={TERRACE}
        metrics={METRICS}
        buildingHeight={15}
        designMode={true}
        backendReady={true}
      />,
    );

    const weatherSection = container.querySelector('[data-section-id="weather"]')!;
    const weatherHeader = weatherSection.querySelector<HTMLButtonElement>(".collapsible-section__header")!;
    expect(weatherHeader).toHaveAttribute("aria-expanded", "false");

    // Click to expand Weather
    await userEvent.click(weatherHeader);
    expect(weatherHeader).toHaveAttribute("aria-expanded", "true");
    expect(weatherSection).toHaveClass("is-open");

    // Click a weather preset inside
    const cloudyBtn = screen.getByRole("button", { name: "Cloudy" });
    await userEvent.click(cloudyBtn);
    expect(cloudyBtn).toHaveClass("weather-preset-btn--active");

    // Section stays expanded
    expect(weatherHeader).toHaveAttribute("aria-expanded", "true");

    // Rerender with unchanged props does not forcibly collapse
    rerender(
      <ModelPanel
        vertices={TERRACE}
        metrics={METRICS}
        buildingHeight={15}
        designMode={true}
        backendReady={true}
      />,
    );
    expect(weatherHeader).toHaveAttribute("aria-expanded", "true");
    expect(weatherSection).toHaveClass("is-open");
  });
});
