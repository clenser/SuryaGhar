import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackendStatusIndicator } from "../components/workspace/BackendStatusIndicator";
import { resetBackendStatusForTests } from "../services/backendStatus";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  resetBackendStatusForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackendStatusIndicator", () => {
  it("shows only the dot before any request", () => {
    const { container } = render(<BackendStatusIndicator />);
    expect(screen.queryByText(/Starting/)).toBeNull();
    expect(screen.queryByText("API Offline")).toBeNull();
    expect(screen.queryByText("API Online")).toBeNull();
    expect(container.querySelector(".backend-status__dot--unknown")).toBeInTheDocument();
  });

  it("shows the checking state while the first request is in flight", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })),
    );
    const { requestBackend } = await import("../services/backendStatus");
    let pending: Promise<Response>;
    act(() => {
      pending = requestBackend("http://t/health");
    });
    render(<BackendStatusIndicator />);
    expect(screen.getByText("Checking local server…")).toBeInTheDocument();
    expect(screen.queryByText("Starting analysis server…")).toBeNull();
    await act(async () => {
      resolveFetch(jsonResponse(200, { status: "ok" }));
      await pending;
    });
    expect(screen.getByText("API Online")).toBeInTheDocument();
  });

  it("shows an error with a retry action on failure, and recovers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const { requestBackend } = await import("../services/backendStatus");
    render(<BackendStatusIndicator />);
    await act(async () => {
      await expect(requestBackend("http://t/health")).rejects.toThrow();
    });
    expect(screen.getByText("API Offline")).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ready" })));
    await userEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(await screen.findByText("API Online")).toBeInTheDocument();
  });
});
