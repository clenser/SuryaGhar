/**
 * Header map-provider pill: every state has its exact copy, map-error gets a
 * retry action, and the pill stays separate from backend API health.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MapProviderIndicator } from "../components/workspace/MapProviderIndicator";
import {
  beginGoogleWatch,
  failGoogleWatch,
  failMapProvider,
  markGoogleReady,
  markMapLibreReady,
  resetMapProviderForTests,
} from "../services/mapProvider";

function toMaplibreLoading(): void {
  beginGoogleWatch();
  failGoogleWatch("loader failed");
  vi.advanceTimersByTime(5000);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMapProviderForTests();
});

afterEach(() => {
  resetMapProviderForTests();
  vi.useRealTimers();
});

describe("MapProviderIndicator", () => {
  it("shows Loading Google Maps… during primary initialization", () => {
    render(<MapProviderIndicator />);
    expect(screen.getByText("Loading Google Maps…")).toBeInTheDocument();
    expect(screen.queryByText(/API Online/)).toBeNull(); // never backend copy
  });

  it("stays silent when Google Maps is ready", () => {
    beginGoogleWatch();
    markGoogleReady();
    const { container } = render(<MapProviderIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the per-second countdown copy while falling back", () => {
    beginGoogleWatch();
    act(() => {
      failGoogleWatch("Google Maps did not become ready in time.");
    });
    render(<MapProviderIndicator />);
    expect(
      screen.getByText("Google Maps unavailable — switching to backup map in 5…"),
    ).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByText("Google Maps unavailable — switching to backup map in 4…"),
    ).toBeInTheDocument();
  });

  it("reports Backup map active once the fallback is up", () => {
    act(() => {
      toMaplibreLoading();
      markMapLibreReady();
    });
    render(<MapProviderIndicator />);
    expect(screen.getByText("Backup map active")).toBeInTheDocument();
    expect(screen.getByText("Backup")).toBeInTheDocument(); // short form for mobile
  });

  it("reports Map unavailable with a working retry action when both fail", () => {
    act(() => {
      toMaplibreLoading();
      failMapProvider("Backup map could not be created.");
    });
    render(<MapProviderIndicator />);
    expect(screen.getByText("Map unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry map" }));
    expect(screen.getByText("Loading Google Maps…")).toBeInTheDocument();
  });

  it("uses aria-live only, so backend role=status stays unique in the header", () => {
    render(<MapProviderIndicator />);
    const pill = screen.getByText("Loading Google Maps…").closest(".map-status")!;
    expect(pill).toHaveAttribute("aria-live", "polite");
    expect(pill).not.toHaveAttribute("role", "status");
  });
});
