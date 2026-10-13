import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FinalModelControls } from "../components/3d/FinalModelControls";
import { ValidatePanel } from "../components/analysis/ValidatePanel";
import type { SunSimulation } from "../hooks/useSunSimulation";
import type { SunClock } from "../lib/solar";

function mockSun(overrides: Partial<SunSimulation> = {}): SunSimulation {
  return {
    date: "2026-06-21",
    timeMinutes: 720,
    playing: false,
    speed: 20,
    timezone: "Asia/Kolkata",
    samples: [],
    state: {
      azimuthDeg: 180,
      elevationDeg: 65,
      night: false,
    },
    clock: {} as SunClock,
    setDate: vi.fn(),
    setSpeed: vi.fn(),
    setTime: vi.fn(),
    togglePlay: vi.fn(),
    pause: vi.fn(),
    ...overrides,
  };
}

describe("Presentation View & Stage 3 BOM enhancements", () => {
  it("renders Nature toggle in presentation view and fires onToggleNature", () => {
    const onToggleNature = vi.fn();
    const sun = mockSun();

    render(
      <FinalModelControls
        weatherPreset="sunny"
        onWeatherPresetChange={() => {}}
        sun={sun}
        electricityFlowActive={false}
        onToggleElectricityFlow={() => {}}
        xray={false}
        onToggleXray={() => {}}
        treesVisible={true}
        onToggleTrees={() => {}}
        natureActive={false}
        onToggleNature={onToggleNature}
      />
    );

    const natureBtn = screen.getByRole("button", { name: /toggle nature animations/i });
    expect(natureBtn).toBeInTheDocument();
    expect(natureBtn).toHaveTextContent("Off");

    fireEvent.click(natureBtn);
    expect(onToggleNature).toHaveBeenCalledTimes(1);
  });

  it("renders enhanced daylight & sun simulation bar in presentation view", () => {
    const sun = mockSun({ timeMinutes: 720, speed: 20, playing: false });
    const { rerender } = render(
      <FinalModelControls
        weatherPreset="sunny"
        onWeatherPresetChange={() => {}}
        sun={sun}
        electricityFlowActive={false}
        onToggleElectricityFlow={() => {}}
        xray={false}
        onToggleXray={() => {}}
        treesVisible={true}
        onToggleTrees={() => {}}
        natureActive={true}
        onToggleNature={() => {}}
      />
    );

    // Readout shows 12:00 PM and Daylight badge
    expect(screen.getByText("12:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Daylight")).toBeInTheDocument();

    // Play/Pause button
    const playBtn = screen.getByRole("button", { name: /play daylight simulation/i });
    expect(playBtn).toBeInTheDocument();
    fireEvent.click(playBtn);
    expect(sun.togglePlay).toHaveBeenCalledTimes(1);

    // Speed selector
    const speed2x = screen.getByRole("button", { name: /2× speed/i });
    expect(speed2x).toBeInTheDocument();
    fireEvent.click(speed2x);
    expect(sun.setSpeed).toHaveBeenCalledWith(40);

    // Quick jump timeline buttons
    const noonBtn = screen.getByRole("button", { name: /jump to 12:00/i });
    fireEvent.click(noonBtn);
    expect(sun.setTime).toHaveBeenCalledWith(720);

    const duskBtn = screen.getByRole("button", { name: /jump to 18:00/i });
    fireEvent.click(duskBtn);
    expect(sun.setTime).toHaveBeenCalledWith(1080);

    // Continuous time slider
    const slider = screen.getByRole("slider", { name: /time of day/i });
    expect(slider).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "600" } });
    expect(sun.setTime).toHaveBeenCalledWith(600);

    // Sun position info (elevation & azimuth)
    expect(screen.getByText(/180\.0°/)).toBeInTheDocument();
    expect(screen.getByText(/65\.0°/)).toBeInTheDocument();

    // Night test
    const nightSun = mockSun({
      timeMinutes: 60,
      state: { azimuthDeg: 45, elevationDeg: -20, night: true },
    });
    rerender(
      <FinalModelControls
        weatherPreset="sunny"
        onWeatherPresetChange={() => {}}
        sun={nightSun}
        electricityFlowActive={false}
        onToggleElectricityFlow={() => {}}
        xray={false}
        onToggleXray={() => {}}
        treesVisible={true}
        onToggleTrees={() => {}}
      />
    );
    expect(screen.getAllByText("Night").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/sun below horizon/i)).toBeInTheDocument();
  });

  it("always renders Bill of Materials in Stage 3 right panel even before analysis runs", () => {
    render(
      <ValidatePanel
        snapshot={{ kind: "idle" }}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={() => {}}
        onProceed={() => {}}
        onContinue={() => {}}
        onRedraw={() => {}}
        backendReady={true}
        panelCount={20}
        panelTypeId="panel-550w"
      />
    );

    // BOM section is directly visible in the idle Stage 3 panel
    expect(screen.getByText("Bill of Materials (BOM)")).toBeInTheDocument();
    expect(screen.getByText("11 kWp System")).toBeInTheDocument();
    expect(screen.getByText("20 Nos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download Bill of Materials \(CSV\)/i })).toBeInTheDocument();
  });
});
