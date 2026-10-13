import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act, screen, waitFor, within } from "@testing-library/react";
import { resetBackendStatusForTests } from "../services/backendStatus";
import { BACKEND_WAITING_LABEL, useBackendReady } from "../hooks/useBackendStatus";
import { requestBackend } from "../services/backendStatus";
import { StageProgress } from "../components/workspace/StageProgress";
import { SelectionPanel } from "../components/selection/SelectionPanel";
import { ValidatePanel } from "../components/analysis/ValidatePanel";
import { DesignPanel } from "../components/analysis/DesignPanel";
import { SolarPanel } from "../components/analysis/SolarPanel";
import { SitePanel } from "../components/analysis/SitePanel";
import { analyzePolygon } from "../lib/geo";
import type { SelectionState } from "../hooks/useSelection";



function jsonResponse(status: number, body: unknown, retryAfter?: string): Response {
  const headers = retryAfter == null ? undefined : { "Retry-After": retryAfter };
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  resetBackendStatusForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const VERTICES = [
  { lng: 88.36, lat: 22.57 },
  { lng: 88.361, lat: 22.57 },
  { lng: 88.361, lat: 22.571 },
  { lng: 88.36, lat: 22.571 },
];

function confirmedSelection(): SelectionState {
  const noop = () => {};
  return {
    mode: "confirmed",
    vertices: VERTICES,
    metrics: analyzePolygon(VERTICES),
    historyDepth: 1,
    start: noop,
    addVertex: noop,
    finishDrawing: noop,
    beginVertexDrag: noop,
    enterEditing: noop,
    moveVertex: noop,
    deleteVertex: noop,
    undo: noop,
    clear: noop,
    confirm: noop,
    redraw: noop,
  };
}

const STEPS = ["select", "validate", "design", "solar", "site"].map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
  disabled: false,
}));

describe("useBackendReady state rule", () => {
  it("tolerates a single failure after ONLINE but surfaces persistent outage", async () => {
    const { result, rerender } = renderHook(() => useBackendReady());
    expect(result.current).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready" })));
    await act(async () => {
      await requestBackend("/api/ready");
    });
    rerender();
    expect(result.current).toBe(true);

    // A single failed request is a blip, not an outage: stays ONLINE.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("blip");
      }),
    );
    await act(async () => {
      await expect(requestBackend("/api/x")).rejects.toThrow();
    });
    rerender();
    expect(result.current).toBe(true);

    // Consecutive failures are a genuine outage: flips to OFFLINE.
    await act(async () => {
      await expect(requestBackend("/api/x")).rejects.toThrow();
    });
    await act(async () => {
      await expect(requestBackend("/api/x")).rejects.toThrow();
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

describe("readiness lock (unit)", () => {
  it("locks backend stages in StageProgress but never Select", () => {
    render(<StageProgress steps={STEPS} currentId="select" onSelect={() => {}} backendLocked />);
    expect(screen.getByRole("tab", { name: "Select (current)" })).toBeEnabled();
    for (const label of ["Validate", "Design", "Solar", "Site"]) {
      const tab = screen.getByRole("tab", { name: new RegExp(`^${label}`) });
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute("title", BACKEND_WAITING_LABEL);
    }
  });

  it("leaves StageProgress untouched when the backend is ready", () => {
    render(<StageProgress steps={STEPS} currentId="validate" onSelect={() => {}} backendLocked={false} />);
    for (const label of ["Select", "Validate", "Design", "Solar", "Site"]) {
      const tab = screen.getByRole("tab", { name: new RegExp(`^${label}`) });
      expect(tab).toBeEnabled();
      expect(tab).not.toHaveAttribute("title");
    }
  });

  it("locks Continue to 3D model but keeps selection editing usable", () => {
    render(<SelectionPanel selection={confirmedSelection()} onStartValidate={() => {}} backendReady={false} />);
    const locked = screen.getByRole("button", { name: "Continue to 3D model" });
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("title", BACKEND_WAITING_LABEL);
    // Local selection work is never locked.
    expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redraw" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("enables Continue to 3D model once ready", () => {
    render(<SelectionPanel selection={confirmedSelection()} onStartValidate={() => {}} backendReady />);
    const btn = screen.getByRole("button", { name: "Continue to 3D model" });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute("title");
  });

  it("locks Proceed with analysis in ValidatePanel", () => {
    render(
      <ValidatePanel
        snapshot={{ kind: "idle" }}
        elapsed={0}
        segmentationModel="sam2_tiny"
        onSegmentationModelChange={() => {}}
        onProceed={() => {}}
        onContinue={() => {}}
        onRedraw={() => {}}
        backendReady={false}
      />,
    );
    const locked = screen.getByRole("button", { name: "Proceed with analysis" });
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute("title", BACKEND_WAITING_LABEL);
    // Navigation back stays usable.
    expect(screen.queryByRole("button", { name: "Back to selection" })).toBeNull();
  });

  it("locks Compute layout and Analyse solar yield in DesignPanel", () => {
    render(<DesignPanel vertices={VERTICES} onResult={() => {}} onContinue={() => {}} backendReady={false} />);
    const compute = screen.getByRole("button", { name: /Compute layout/ });
    expect(compute).toBeDisabled();
    expect(compute).toHaveAttribute("title", BACKEND_WAITING_LABEL);
    const analyse = screen.getByRole("button", { name: "Analyse solar yield" });
    expect(analyse).toBeDisabled();
    expect(analyse).toHaveAttribute("title", BACKEND_WAITING_LABEL);
  });

  it("locks the yield estimate and site transition in SolarPanel", () => {
    render(
      <SolarPanel latitude={22.57} longitude={88.36} capacityKwp={3} onContinue={() => {}} backendReady={false} />,
    );
    const run = screen.getByRole("button", { name: "Estimate annual yield" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", BACKEND_WAITING_LABEL);
  });

  it("locks surroundings and shadow analyses in SitePanel", () => {
    render(<SitePanel vertices={VERTICES} onShadows={() => {}} backendReady={false} />);
    for (const name of ["Scan surroundings", "Estimate shadows"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("title", BACKEND_WAITING_LABEL);
    }
    // Date/hour browsing stays usable.
    expect(screen.getByLabelText("Date")).toBeEnabled();
    expect(screen.getByLabelText("Local hour (IST)")).toBeEnabled();
  });
});

describe("readiness lock (App integration)", () => {
  it("locks backend workflow while starting, then unlocks on ready without losing state", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(503, { status: "starting" }, "1")
        : jsonResponse(200, { status: "ready" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: App } = await import("../App");
    render(<App />);

    // Starting: lock notice + locked backend stages, Select usable.
    expect(await screen.findByText(/Waiting for analysis server/)).toBeInTheDocument();
    expect(screen.queryByText("API Online")).toBeNull();
    expect(screen.getByRole("tab", { name: /Select/ })).toBeEnabled();
    const validateStarting = screen.getByRole("tab", { name: /Validate/ });
    expect(validateStarting).toBeDisabled();
    expect(validateStarting).toHaveAttribute("title", BACKEND_WAITING_LABEL);
    // Map toolbar (local selection work) is never locked by readiness: no
    // waiting tooltip appears. (Edit stays disabled here only because no
    // polygon exists yet — pre-existing selection-state behavior.)
    expect(screen.getByRole("button", { name: "Select" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Select" })).not.toHaveAttribute("title", BACKEND_WAITING_LABEL);
    expect(screen.getByRole("button", { name: "Edit" })).not.toHaveAttribute("title", BACKEND_WAITING_LABEL);

    // Backend becomes ready: pill flips, notice disappears, the lock lifts
    // (Validate stays disabled here only because nothing is selected yet —
    // the waiting tooltip is gone), and the workspace state (stage, place,
    // map) is preserved in place.
    expect(await screen.findByText("API Online")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Waiting for analysis server/)).toBeNull());
    const selectTab = screen.getByRole("tab", { name: /Select/ });
    expect(selectTab).toHaveAttribute("aria-selected", "true");
    const validateTab = screen.getByRole("tab", { name: /Validate/ });
    expect(validateTab).not.toHaveAttribute("title");
    expect(screen.getByRole("region", { name: "Location" })).toHaveTextContent("Kolkata");
    expect(screen.getByRole("application", { name: /Satellite map of India/ })).toBeInTheDocument();
  }, 15000);

  it("bounds persistent startup failure to CHECKING, then OFFLINE with retry", async () => {
    // Locally a failing probe means the backend is not running — there is no
    // cloud cold start to wait out. The pill must show a bounded check (never
    // "Starting analysis server…" and never a falsely online pill), then turn
    // OFFLINE with a retry once the local wake window expires.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { default: App } = await import("../App");
    render(<App />);
    // The mount effect sets CHECKING synchronously with render, so assert it
    // in the same tick — never "Starting analysis server…" (no such state on
    // a local page load) and never a falsely online pill.
    expect(screen.getByText("Checking local server…")).toBeInTheDocument();
    expect(screen.queryByText("Starting analysis server…")).toBeNull();
    expect(screen.queryByText("API Online")).toBeNull();
    // Locked, not errored: the notice explains the state, no error is thrown.
    expect(await screen.findByText(/Waiting for analysis server/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Validate/ })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /Select/ })).toBeEnabled();
    // Bounded: the window expires into a real OFFLINE with a retry action.
    expect(await screen.findByText("API Offline", {}, { timeout: 9000 })).toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
  }, 15000);
});
