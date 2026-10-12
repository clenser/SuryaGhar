import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidatePanel } from "../components/analysis/ValidatePanel";
import type { ValidationSnapshot } from "../hooks/useValidation";

describe("Step 3 ValidatePanel Navigation & State Persistence", () => {
  const dummySnapshot: ValidationSnapshot = {
    kind: "idle",
  };

  const initialModelStatuses = {
    sam2_tiny: { id: "sam2_tiny" as const, display_name: "SAM 2.1 Tiny", available: true },
    sam2_base_plus: { id: "sam2_base_plus" as const, display_name: "SAM 2.1 Base+", available: true },
    sam2_large: { id: "sam2_large" as const, display_name: "SAM 2.1 Large", available: true },
    hotosm_buildings: { id: "hotosm_buildings" as const, display_name: "HOTOSM Buildings", available: true },
  };

  it("renders a Back to Step 2 button at the top of Step 3", () => {
    const onBackToModel = vi.fn();
    render(
      <ValidatePanel
        snapshot={dummySnapshot}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={vi.fn()}
        onProceed={vi.fn()}
        onContinue={vi.fn()}
        onRedraw={vi.fn()}
        onBackToModel={onBackToModel}
        backendReady={true}
        initialModelStatuses={initialModelStatuses}
      />
    );

    const backButton = screen.getByRole("button", { name: /Back to Step 2/i });
    expect(backButton).toBeInTheDocument();
  });

  it("triggers onBackToModel when clicked", async () => {
    const onBackToModel = vi.fn();
    render(
      <ValidatePanel
        snapshot={dummySnapshot}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={vi.fn()}
        onProceed={vi.fn()}
        onContinue={vi.fn()}
        onRedraw={vi.fn()}
        onBackToModel={onBackToModel}
        backendReady={true}
        initialModelStatuses={initialModelStatuses}
      />
    );

    const backButton = screen.getByRole("button", { name: /Back to Step 2/i });
    await userEvent.click(backButton);
    expect(onBackToModel).toHaveBeenCalledTimes(1);
  });

  it("preserves model selection changes through onSegmentationModelChange", async () => {
    const onSegmentationModelChange = vi.fn();
    render(
      <ValidatePanel
        snapshot={dummySnapshot}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={onSegmentationModelChange}
        onProceed={vi.fn()}
        onContinue={vi.fn()}
        onRedraw={vi.fn()}
        onBackToModel={vi.fn()}
        backendReady={true}
        initialModelStatuses={initialModelStatuses}
      />
    );

    const basePlusRadio = screen.getByRole("radio", { name: /Base\+ model/i });
    await userEvent.click(basePlusRadio);
    expect(onSegmentationModelChange).toHaveBeenCalledWith("sam2_base_plus");
  });

  it("Back to Step 2 button remains available and operational during loading state", async () => {
    const onBackToModel = vi.fn();
    const loadingSnapshot: ValidationSnapshot = {
      kind: "loading",
      model: "sam2_tiny",
      startedAt: Date.now(),
    };

    render(
      <ValidatePanel
        snapshot={loadingSnapshot}
        elapsed={2.5}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={vi.fn()}
        onProceed={vi.fn()}
        onContinue={vi.fn()}
        onRedraw={vi.fn()}
        onBackToModel={onBackToModel}
        backendReady={true}
        initialModelStatuses={initialModelStatuses}
      />
    );

    const backButton = screen.getByRole("button", { name: /Back to Step 2/i });
    expect(backButton).toBeInTheDocument();
    await userEvent.click(backButton);
    expect(onBackToModel).toHaveBeenCalledTimes(1);
  });

  it("Back to Step 2 button remains available and operational during error state", async () => {
    const onBackToModel = vi.fn();
    const errorSnapshot: ValidationSnapshot = {
      kind: "error",
      message: "Model unavailable or checkpoint missing",
      model: "sam2_tiny",
    };

    render(
      <ValidatePanel
        snapshot={errorSnapshot}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={vi.fn()}
        onProceed={vi.fn()}
        onContinue={vi.fn()}
        onRedraw={vi.fn()}
        onBackToModel={onBackToModel}
        backendReady={true}
        initialModelStatuses={initialModelStatuses}
      />
    );

    const backButton = screen.getByRole("button", { name: /Back to Step 2/i });
    expect(backButton).toBeInTheDocument();
    await userEvent.click(backButton);
    expect(onBackToModel).toHaveBeenCalledTimes(1);
  });

  it("Back to Step 2 button remains available and operational during success state", async () => {
    const onBackToModel = vi.fn();
    const okSnapshot: ValidationSnapshot = {
      kind: "ok",
      result: {
        classification: "roof",
        confidence: 0.9,
        coverage: 0.85,
        components: { building: 0.5, other: 0.5 },
        metrics: { area_m2: 150 },
        images: null,
        warnings: [],
        limitations: null,
        providers: { imagery: "esri", vision: "groq", segmentation: "sam2_tiny" },
      },
      model: "sam2_tiny",
    };

    render(
      <ValidatePanel
        snapshot={okSnapshot}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={vi.fn()}
        onProceed={vi.fn()}
        onContinue={vi.fn()}
        onRedraw={vi.fn()}
        onBackToModel={onBackToModel}
        backendReady={true}
        initialModelStatuses={initialModelStatuses}
      />
    );

    const backButtons = screen.getAllByRole("button", { name: /Back to Step 2/i });
    expect(backButtons.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(backButtons[0]);
    expect(onBackToModel).toHaveBeenCalledTimes(1);
  });
});
