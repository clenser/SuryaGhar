import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useValidation } from "../hooks/useValidation";

const VERTICES = [
  { lng: 88.3639, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5726 },
  { lng: 88.3645, lat: 22.5731 },
];

function okBody(model = "sam2_tiny") {
  return {
    classification: "roof",
    confidence: 0.9,
    coverage: 0.87,
    components: { building: 0.5, other: 0.5 },
    metrics: { area_m2: 120, perimeter_m: 44 },
    images: null,
    warnings: [],
    limitations: null,
    providers: { imagery: "x", vision: "groq", segmentation: model },
    segmentation: { model, display_name: model, inference_time_seconds: 1.2, device: "cpu" },
    evidence: { semantic_available: true, hotosm_building_fraction: 0.5 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useValidation", () => {
  it("starts idle and runs validation on proceed", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useValidation());

    expect(result.current.snapshot.kind).toBe("idle");
    act(() => {
      result.current.proceed(VERTICES, "sam2_tiny");
    });
    expect(result.current.snapshot.kind).toBe("loading");
    await waitFor(() => expect(result.current.snapshot.kind).toBe("ok"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as unknown as RequestInit;
    expect(JSON.parse(init.body as string).segmentation_model).toBe("sam2_tiny");
    if (result.current.snapshot.kind === "ok") {
      expect(result.current.snapshot.result.classification).toBe("roof");
      expect(result.current.snapshot.model).toBe("sam2_tiny");
    }
  });

  it("ignores a superseded in-flight run instead of duplicating state", async () => {
    let resolveFirst!: (r: Response) => void;
    let resolveSecond!: (r: Response) => void;
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          const body = JSON.parse(init.body as string);
          if (body.segmentation_model === "sam2_tiny") resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useValidation());

    act(() => {
      result.current.proceed(VERTICES, "sam2_tiny");
    });
    act(() => {
      result.current.proceed(VERTICES, "sam2_large");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFirst(new Response(JSON.stringify(okBody("sam2_tiny")), { status: 200 }));
    });
    // Stale first run must not overwrite the second run's loading state.
    expect(result.current.snapshot.kind).toBe("loading");
    await act(async () => {
      resolveSecond(new Response(JSON.stringify(okBody("sam2_large")), { status: 200 }));
    });
    await waitFor(() => expect(result.current.snapshot.kind).toBe("ok"));
    if (result.current.snapshot.kind === "ok") {
      expect(result.current.snapshot.model).toBe("sam2_large");
    }
  });

  it("surfaces backend errors and resets to idle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { result } = renderHook(() => useValidation());

    act(() => {
      result.current.proceed(VERTICES, "sam2_tiny");
    });
    await waitFor(() => expect(result.current.snapshot.kind).toBe("error"));
    act(() => {
      result.current.reset();
    });
    expect(result.current.snapshot.kind).toBe("idle");
  });
});
