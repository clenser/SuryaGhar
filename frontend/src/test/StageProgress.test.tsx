import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StageProgress } from "../components/workspace/StageProgress";

const STEPS = [
  { id: "select", label: "Select", disabled: false },
  { id: "validate", label: "Validate", disabled: false },
  { id: "design", label: "Design", disabled: true },
  { id: "solar", label: "Solar", disabled: true },
  { id: "site", label: "Site", disabled: true },
];

describe("StageProgress", () => {
  it("marks current, completed, and future stages", () => {
    render(<StageProgress steps={STEPS} currentId="validate" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: "Validate (current)" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Select (completed)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Design" })).toBeDisabled();
  });

  it("notifies the selected stage on click", async () => {
    const onSelect = vi.fn();
    render(<StageProgress steps={STEPS} currentId="select" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("tab", { name: "Validate" }));
    expect(onSelect).toHaveBeenCalledWith("validate");
  });

  it("renders all five workflow stages in order", () => {
    render(<StageProgress steps={STEPS} currentId="select" onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["1Select", "2Validate", "3Design", "4Solar", "5Site"]);
  });
});
