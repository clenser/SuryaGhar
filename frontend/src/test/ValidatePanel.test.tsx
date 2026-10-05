import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidatePanel } from "../components/analysis/ValidatePanel";
import type { SegmentationModel } from "../services/analysis";

const PANEL_PROPS = {
  segmentationModel: "hotosm_buildings" as SegmentationModel,
  onSegmentationModelChange: () => {},
  onContinue: () => {},
  onRedraw: () => {},
};

const REASON = "The selected polygon is located entirely on a flat, unobstructed concrete rooftop.";

function mockValidation() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
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
          providers: { imagery: "Esri World Imagery (prototype)", vision: "groq", segmentation: "heuristic" },
          evidence: {
            semantic_available: true,
            hotosm_building_fraction: 0.21,
            vision: { classification: "roof", confidence: 0.9, provider: "groq", reason: REASON },
          },
        }),
        { status: 200 },
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const VERTICES = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
  { lng: 88.3639, lat: 22.5731 },
];

describe("ValidatePanel surface assessment", () => {
  it("shows classification with analysis confidence and separate building evidence", async () => {
    mockValidation();
    render(<ValidatePanel vertices={VERTICES} {...PANEL_PROPS} />);

    // Classification headline + Surface metric share the label by design.
    expect(await screen.findAllByText("Rooftop")).toHaveLength(2);
    expect(await screen.findByText("Analysis confidence · 90%")).toBeInTheDocument();
    expect(screen.getByText("Building evidence")).toBeInTheDocument();
    expect(screen.getByText("21%")).toBeInTheDocument();
  });

  it("exposes no provider branding, no uncertainty section, and no duplicated assessment", async () => {
    mockValidation();
    render(<ValidatePanel vertices={VERTICES} {...PANEL_PROPS} />);
    await screen.findAllByText("Rooftop");

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Groq/);
    expect(body).not.toMatch(/Gemini/);
    expect(body).not.toMatch(/AI assessment/);
    expect(body).not.toMatch(/AI validation/);
    expect(screen.queryByText("Why this may be uncertain")).toBeNull();
    // Site interpretation appears exactly once (not repeated as a warning).
    expect(screen.getAllByText(REASON)).toHaveLength(1);
    expect(screen.getByText("Technical details")).toBeInTheDocument();
  });

  it("keeps both actions reachable", async () => {
    mockValidation();
    render(<ValidatePanel vertices={VERTICES} {...PANEL_PROPS} />);
    await screen.findAllByText("Rooftop");

    expect(screen.getByRole("button", { name: "Review selection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to design" })).toBeInTheDocument();
  });

  it("offers HOTOSM Buildings (default) and SAM 2.1 Tiny without dependency branding", async () => {
    mockValidation();
    render(<ValidatePanel vertices={VERTICES} {...PANEL_PROPS} />);
    await screen.findAllByText("Rooftop");

    const hotosm = screen.getByRole("tab", { name: "HOTOSM Buildings" });
    const sam2 = screen.getByRole("tab", { name: "SAM 2.1 Tiny" });
    expect(hotosm).toHaveAttribute("aria-selected", "true");
    expect(sam2).toHaveAttribute("aria-selected", "false");
    const body = document.body.textContent ?? "";
    for (const banned of ["PyTorch", "ONNX", "CUDA", "Groq", "Gemini"]) {
      expect(body).not.toMatch(new RegExp(banned));
    }
  });

  it("omits the model field for the default selection (backend default path)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          classification: "unknown",
          confidence: 0,
          coverage: 0,
          components: {},
          metrics: {},
          images: null,
          warnings: [],
          limitations: null,
          providers: { imagery: "x", vision: "unavailable", segmentation: "heuristic" },
          evidence: { semantic_available: false },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ValidatePanel vertices={VERTICES} {...PANEL_PROPS} />);
    await screen.findByText("Surface assessment unavailable.");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as unknown as RequestInit;
    expect("segmentation_model" in JSON.parse(init.body as string)).toBe(false);
  });

  it("sends the selected model with the validation request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          classification: "unknown",
          confidence: 0,
          coverage: 0,
          components: {},
          metrics: {},
          images: null,
          warnings: [],
          limitations: null,
          providers: { imagery: "x", vision: "unavailable", segmentation: "sam2_tiny" },
          evidence: { semantic_available: false },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    render(
      <ValidatePanel
        vertices={VERTICES}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={onChange}
        onContinue={() => {}}
        onRedraw={() => {}}
      />,
    );
    await screen.findByText("Surface assessment unavailable.");

    expect(fetchMock).toHaveBeenCalled();
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as unknown as RequestInit;
    expect(JSON.parse(init.body as string).segmentation_model).toBe("sam2_tiny");
    await userEvent.click(screen.getByRole("tab", { name: "HOTOSM Buildings" }));
    expect(onChange).toHaveBeenCalledWith("hotosm_buildings");
  });
});
