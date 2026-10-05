import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiError, validateSurface } from "../services/analysis";

const VERTICES = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateSurface error handling", () => {
  it("surfaces the backend JSON detail on HTTP 422 instead of a network message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "x", detail: "Backend says no" }), { status: 422 })),
    );
    await expect(validateSurface(VERTICES)).rejects.toMatchObject({ message: "Backend says no" });
  });

  it("uses the network message only for genuine connection failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(validateSurface(VERTICES)).rejects.toMatchObject({
      message: "Could not reach the analysis service.",
    } satisfies Partial<ApiError> as object);
  });

  it("includes the selected segmentation model in the request body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await validateSurface(VERTICES, "sam2_tiny");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as unknown as RequestInit;
    expect(JSON.parse(init.body as string).segmentation_model).toBe("sam2_tiny");
  });
});
