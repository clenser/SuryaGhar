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
  it("stays quiet before any request", () => {
    render(<BackendStatusIndicator />);
    expect(screen.queryByText(/Starting server/)).toBeNull();
    expect(screen.queryByText("Server unavailable")).toBeNull();
    expect(screen.queryByText("Server online")).toBeNull();
  });

  it("shows the starting state while the backend wakes", async () => {
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
    expect(screen.getByText(/Starting server… Please wait/)).toBeInTheDocument();
    await act(async () => {
      resolveFetch(jsonResponse(200, { status: "ok" }));
      await pending;
    });
    expect(screen.getByText("Server online")).toBeInTheDocument();
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
    expect(screen.getByText("Server unavailable")).toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "ok" })));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Server online")).toBeInTheDocument();
  });
});
