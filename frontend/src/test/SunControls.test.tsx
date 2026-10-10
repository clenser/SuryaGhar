/**
 * SunControls tests: date/time inputs, Play/Pause, the azimuth/elevation
 * readout, the nighttime state and the unavailable fallback.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SunControls, type SunControlsProps } from "../components/3d/SunControls";
import type { SunState } from "../lib/solar";

const DAY_STATE: SunState = { azimuthDeg: 142.3, elevationDeg: 61.2, night: false };
const NIGHT_STATE: SunState = { azimuthDeg: 20, elevationDeg: -14, night: true };

type Overrides = Partial<SunControlsProps>;

function baseProps(overrides: Overrides = {}): SunControlsProps {
  return {
    date: "2026-03-21",
    timeMinutes: 12 * 60 + 30,
    playing: false,
    state: DAY_STATE,
    timezoneLabel: "Asia/Kolkata (UTC+05:30)",
    onDateChange: vi.fn(),
    onTimeChange: vi.fn(),
    onTogglePlay: vi.fn(),
    ...overrides,
  };
}

function renderControls(overrides: Overrides = {}) {
  const props = baseProps(overrides);
  const { rerender } = render(<SunControls {...props} />);
  return {
    props,
    rerender: (next: Overrides) => rerender(<SunControls {...baseProps({ ...overrides, ...next })} />),
  };
}

describe("SunControls", () => {
  it("shows the simulation time, sun position and site timezone", () => {
    renderControls();
    expect(screen.getAllByText("12:30 PM").length).toBeGreaterThan(0);

    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("Azimuth");
    expect(readout).toHaveTextContent("142.3°");
    expect(readout).toHaveTextContent("61.2°");

    expect(screen.getByText(/Asia\/Kolkata \(UTC\+05:30\)/)).toBeInTheDocument();
    expect(screen.getByText(/not an energy-loss calculation/i)).toBeInTheDocument();
  });

  it("binds a date picker and a local time slider to the state", () => {
    renderControls();
    const date = screen.getByLabelText("Date");
    expect(date).toHaveAttribute("type", "date");
    expect(date).toHaveValue("2026-03-21");

    const time = screen.getByLabelText(/Local time/) as HTMLInputElement;
    expect(time).toHaveAttribute("type", "range");
    expect(time.value).toBe("750");
    expect(time).toHaveAttribute("aria-valuetext", "12:30 PM local time");
  });

  it("reports date and time changes", () => {
    const { props } = renderControls();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-06-21" } });
    expect(props.onDateChange).toHaveBeenCalledWith("2026-06-21");

    fireEvent.change(screen.getByLabelText(/Local time/), { target: { value: "600" } });
    expect(props.onTimeChange).toHaveBeenCalledWith(600);
  });

  it("toggles playback and reflects the playing state", async () => {
    const user = userEvent.setup();
    const { props, rerender } = renderControls();

    const play = screen.getByRole("button", { name: /Play day/i });
    expect(play).toHaveAttribute("aria-pressed", "false");
    await user.click(play);
    expect(props.onTogglePlay).toHaveBeenCalledTimes(1);

    rerender({ playing: true });
    const pause = screen.getByRole("button", { name: /Pause/i });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /Play day/i })).toBeNull();
  });

  it("shows a clear nighttime state instead of daytime values", () => {
    renderControls({ state: NIGHT_STATE, timeMinutes: 22 * 60 });
    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent(/Night — sun below the horizon/i);
    expect(readout).not.toHaveTextContent("Azimuth");
    expect(readout.className).toContain("sun-readout--night");
    expect(screen.getAllByText("10:00 PM").length).toBeGreaterThan(0);
    // Nighttime stays fully controllable.
    expect(screen.getByRole("button", { name: /Play day/i })).toBeEnabled();
  });

  it("disables playback and explains itself when no position is available", () => {
    renderControls({ state: null, date: "" });
    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent(/Sun position unavailable/i);
    expect(readout.className).toContain("sun-readout--error");
    expect(screen.getByRole("button", { name: /Play day/i })).toBeDisabled();
    expect(screen.getByLabelText(/Local time/)).toBeDisabled();
    // The date stays editable so the user can recover.
    expect(screen.getByLabelText("Date")).toBeEnabled();
  });

  it("labels the section for assistive technology", () => {
    renderControls();
    expect(screen.getByRole("region", { name: "Sun and shadows" })).toBeInTheDocument();
  });
});
