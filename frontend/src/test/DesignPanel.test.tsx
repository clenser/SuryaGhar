import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignPanel } from "../components/analysis/DesignPanel";
import { computePanelLayout } from "../services/analysis";

vi.mock("../services/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/analysis")>();
  return { ...actual, computePanelLayout: vi.fn() };
});

const mockedLayout = vi.mocked(computePanelLayout);

const VERTICES = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
];

const LAYOUT = {
  panel_count: 263,
  capacity_kwp: 144.65,
  usable_area_m2: 500,
  total_area_m2: 520,
  occupied_area_m2: 300,
  footprints: [],
  assumptions: { row_spacing_m: 0.6, setback_m: 0.5, orientation: "landscape" },
  warnings: [],
  orientation: { tilt_deg: 15, azimuth_deg: 180, compass_direction: "South" },
  solar: {
    annual_generation_kwh: 200000,
    specific_yield_kwh_kwp: 1382,
    poa_kwh_m2: 1900,
    optimization_method: "geometry",
    resource_provider: "test",
    confidence: "medium",
  },
};

const PROPS = {
  vertices: VERTICES,
  onResult: () => {},
  onContinue: () => {},
  backendReady: true,
};

beforeEach(() => {
  mockedLayout.mockReset();
});

describe("DesignPanel solar design", () => {
  it("opens the rich preset selector and switches panel type", async () => {
    render(<DesignPanel {...PROPS} />);
    expect(screen.getByRole("button", { name: "Panel type" })).toHaveTextContent("Standard residential");
    await userEvent.click(screen.getByRole("button", { name: "Panel type" }));
    expect(screen.getByRole("listbox", { name: "Panel type options" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Compact residential/ }));
    expect(screen.getByRole("button", { name: "Panel type" })).toHaveTextContent("Compact residential");
  });

  it("closes the preset menu on Escape", async () => {
    render(<DesignPanel {...PROPS} />);
    await userEvent.click(screen.getByRole("button", { name: "Panel type" }));
    expect(screen.getByRole("listbox", { name: "Panel type options" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Panel type options" })).toBeNull();
  });

  it("updates the setback diagram from the setback input", async () => {
    render(<DesignPanel {...PROPS} />);
    expect(screen.getByRole("img", { name: /0\.5 m roof setback/ })).toBeInTheDocument();
    const input = screen.getByLabelText("Edge setback (m)");
    await userEvent.clear(input);
    await userEvent.type(input, "1");
    expect(screen.getByRole("img", { name: /1 m roof setback/ })).toBeInTheDocument();
  });

  it("expands advanced orientation and resets to optimized", async () => {
    render(<DesignPanel {...PROPS} />);
    const toggle = screen.getByRole("button", { name: /Advanced orientation/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("switch", { name: "Manual orientation override" }));
    expect(screen.getByLabelText("Tilt (°)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset to optimized" }));
    expect(screen.queryByLabelText("Tilt (°)")).toBeNull();
  });

  it("computes a layout and shows the estimated system card", async () => {
    mockedLayout.mockResolvedValueOnce(LAYOUT as never);
    const onResult = vi.fn();
    const onContinue = vi.fn();
    render(<DesignPanel {...PROPS} onResult={onResult} onContinue={onContinue} />);

    const analyse = screen.getByRole("button", { name: "Analyse solar yield" });
    expect(analyse).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /Compute layout/ }));
    expect(await screen.findByText("Estimated layout")).toBeInTheDocument();
    expect(screen.getByText("263")).toBeInTheDocument();
    expect(screen.getByText("144.65")).toBeInTheDocument();
    expect(screen.getByText("Panels")).toBeInTheDocument();
    expect(screen.getByText("kWp")).toBeInTheDocument();
    expect(onResult).toHaveBeenCalled();

    const enabled = screen.getByRole("button", { name: "Analyse solar yield" });
    expect(enabled).toBeEnabled();
    await userEvent.click(enabled);
    expect(onContinue).toHaveBeenCalledWith(144.65);
  });

  it("shows loading and error states honestly", async () => {
    let reject!: (err: Error) => void;
    mockedLayout.mockReturnValueOnce(
      new Promise((_resolve, rej) => {
        reject = rej;
      }) as never,
    );
    render(<DesignPanel {...PROPS} />);
    await userEvent.click(screen.getByRole("button", { name: /Compute layout/ }));
    expect(screen.getByText("Computing solar layout")).toBeInTheDocument();
    expect(screen.getByText("Analyzing roof geometry…")).toBeInTheDocument();
    reject(new Error("boom"));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
