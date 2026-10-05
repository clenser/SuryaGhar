import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocationSearch } from "../components/search/LocationSearch";
import type { LocationResult } from "../types";

const place = (over: Partial<LocationResult>): LocationResult => ({
  name: "Kolkata",
  locality: null,
  state: "West Bengal",
  country: "India",
  latitude: 22.5726,
  longitude: 88.3639,
  bounds: null,
  ...over,
});

describe("LocationSearch", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("is a labelled combobox with a search landmark", () => {
    render(<LocationSearch onSelect={() => {}} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search location" })).toBeInTheDocument();
  });

  it("shows results after debounce and calls onSelect on click", async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ provider: "nominatim", results: [place({}), place({ name: "Salt Lake", locality: "Salt Lake" })] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LocationSearch onSelect={onSelect} />);

    await userEvent.type(screen.getByRole("combobox"), "kolk");
    const options = await screen.findAllByRole("option", {}, { timeout: 2000 });
    expect(options).toHaveLength(2);
    expect(screen.getAllByText("West Bengal, India", { exact: false })).toHaveLength(2);

    await userEvent.click(options[1]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "Salt Lake" }));
    vi.unstubAllGlobals();
  });

  it("supports keyboard navigation with arrows and Enter", async () => {
    const onSelect = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ provider: "nominatim", results: [place({ name: "A-one" }), place({ name: "B-two" })] }), { status: 200 }),
    ));
    render(<LocationSearch onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "abc");
    await screen.findAllByRole("option", {}, { timeout: 2000 });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "B-two" }));
    vi.unstubAllGlobals();
  });

  it("shows an empty state with the query when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ provider: "nominatim", results: [] }), { status: 200 })));
    render(<LocationSearch onSelect={() => {}} />);
    await userEvent.type(screen.getByRole("combobox"), "zzqqxx");
    expect(await screen.findByText(/No places found for “zzqqxx”/, {}, { timeout: 2000 })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows a retryable error when the backend is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    render(<LocationSearch onSelect={() => {}} />);
    await userEvent.type(screen.getByRole("combobox"), "delhi");
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 });
    expect(alert).toHaveTextContent(/temporarily unavailable/);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ provider: "nominatim", results: [place({ name: "Delhi" })] }), { status: 200 })));
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("option", { name: /Delhi/ }, { timeout: 2000 })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("clears the query on the clear button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 422 })));
    render(<LocationSearch onSelect={() => {}} />);
    const input = screen.getByRole("combobox") as HTMLInputElement;
    await userEvent.type(input, "mumbai");
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input.value).toBe("");
    vi.unstubAllGlobals();
  });
});
