import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidatePanel } from "../components/analysis/ValidatePanel";
import type { SegmentationModel } from "../services/analysis";
import type { ValidationSnapshot } from "../hooks/useValidation";

const REASON = "The selected polygon is located entirely on a flat, unobstructed concrete rooftop.";

function resultBody() {
  return {
    classification: "roof",
    confidence: 0.9,
    coverage: 0.87,
    components: { building: 0.34, other: 0.66 },
    metrics: { area_m2: 120, perimeter_m: 44 },
    images: null,
    // Backend echoes the interpretation inside warnings: the panel must
    // still show it exactly once.
    warnings: [REASON],
    limitations: ["Imagery resolution limits precision."],
    providers: { imagery: "Esri World Imagery (prototype)", vision: "groq", segmentation: "sam2_base_plus" },
    segmentation: {
      model: "sam2_base_plus",
      display_name: "SAM 2.1 Base+",
      inference_time_seconds: 5.83,
      device: "cuda",
    },
    evidence: {
      semantic_available: true,
      hotosm_building_fraction: 0.42,
      vision: { classification: "roof", confidence: 0.9, provider: "groq", reason: REASON },
    },
  };
}

function renderPanel(snapshot: ValidationSnapshot, props?: Partial<Parameters<typeof ValidatePanel>[0]>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(resultBody()), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onProceed = vi.fn();
  const onSegmentationModelChange = vi.fn();
  render(
    <ValidatePanel
      snapshot={snapshot}
      elapsed={0}
      segmentationModel="sam2_tiny"
      onSegmentationModelChange={onSegmentationModelChange}
      onProceed={onProceed}
      onContinue={() => {}}
      onRedraw={() => {}}
      backendReady
      {...props}
    />,
  );
  return { fetchMock, onProceed, onSegmentationModelChange };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ValidatePanel surface assessment", () => {
  it("lists only the three SAM models with Tiny checked by default", () => {
    renderPanel({ kind: "idle" });

    expect(screen.queryByRole("radio", { name: /HOTOSM/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Tiny model/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Base\+ model/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /Large model/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Fastest · Lightweight")).toBeInTheDocument();
    expect(screen.getByText("Balanced · Higher quality")).toBeInTheDocument();
    expect(screen.getByText("Highest quality · Slowest")).toBeInTheDocument();
  });

  it("does NOT validate when only the model selection changes", async () => {
    const { fetchMock, onProceed } = renderPanel({ kind: "idle" });

    await userEvent.click(screen.getByRole("radio", { name: /Large model/ }));
    expect(screen.getByRole("radio", { name: /Large model/ })).toHaveAttribute("aria-checked", "true");
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onProceed).not.toHaveBeenCalled();
  });

  it("Proceed delegates the selected model without fetching itself", async () => {
    const { fetchMock, onProceed, onSegmentationModelChange } = renderPanel({ kind: "idle" });

    await userEvent.click(screen.getByRole("radio", { name: /Base\+ model/ }));
    await userEvent.click(screen.getByRole("button", { name: "Proceed with analysis" }));

    expect(onSegmentationModelChange).toHaveBeenCalledWith("sam2_base_plus");
    expect(onProceed).toHaveBeenCalledWith("sam2_base_plus");
    // The panel never fetches directly; the parent hook owns the request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a cached result immediately without any request", async () => {
    const { fetchMock } = renderPanel({
      kind: "ok",
      result: resultBody() as never,
      model: "sam2_base_plus" as SegmentationModel,
    });

    // Classification headline + Surface metric share the label by design.
    expect(await screen.findAllByText("Rooftop")).toHaveLength(2);
    expect(await screen.findByText("Analysis completed in 5.8 s")).toBeInTheDocument();
    // Selector option + Model metric share the name by design.
    expect(screen.getAllByText("Base+ model")).toHaveLength(2);
    expect(screen.getByText("CUDA")).toBeInTheDocument();
    expect(screen.getByText("5.8 s")).toBeInTheDocument();
    expect(screen.getByText("Mask coverage")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the loading state with the live timer and disables input", () => {
    renderPanel({ kind: "loading", model: "sam2_large", startedAt: Date.now() - 4200 }, { elapsed: 4.2 });
    expect(screen.getByText(/Analyzing with Large model/)).toBeInTheDocument();
    expect(screen.getByText(/Elapsed 4\.2 s/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyzing site..." })).toBeDisabled();
  });

  it("shows backend errors with a working Retry", async () => {
    const { onProceed } = renderPanel({ kind: "error", message: "Backend says no", model: "sam2_tiny" });

    expect(screen.getByText("Backend says no")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onProceed).toHaveBeenCalledWith("sam2_tiny");
  });

  it("exposes no provider branding and no duplicated assessment", () => {
    renderPanel({ kind: "ok", result: resultBody() as never, model: "sam2_base_plus" as SegmentationModel });

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Groq/);
    expect(body).not.toMatch(/Gemini/);
    expect(body).not.toMatch(/AI assessment/);
    expect(body).not.toMatch(/AI validation/);
    expect(body).not.toMatch(/PyTorch/);
    expect(body).not.toMatch(/ONNX/);
    expect(body).not.toMatch(/SAM 2\.1/);
    expect(screen.queryByText("Why this may be uncertain")).toBeNull();
    // Site interpretation appears exactly once (not repeated as a warning).
    expect(screen.getAllByText(REASON)).toHaveLength(1);
  });

  it("keeps both actions reachable", () => {
    renderPanel({ kind: "ok", result: resultBody() as never, model: "sam2_base_plus" as SegmentationModel });

    expect(screen.getByRole("button", { name: "Review selection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to design" })).toBeInTheDocument();
  });
});
