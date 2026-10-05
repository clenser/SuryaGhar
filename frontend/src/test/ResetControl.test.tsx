import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetControl } from "../components/workspace/ResetControl";

describe("ResetControl", () => {
  it("resets immediately without confirmation when there is nothing to reset", async () => {
    const onReset = vi.fn();
    render(<ResetControl hasData={false} onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset analysis" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks for confirmation when analysis data exists", async () => {
    const onReset = vi.fn();
    render(<ResetControl hasData onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset analysis" }));
    expect(screen.getByRole("alertdialog", { name: "Confirm reset" })).toBeInTheDocument();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("cancels without resetting", async () => {
    const onReset = vi.fn();
    render(<ResetControl hasData onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset analysis" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReset).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("resets after explicit confirmation", async () => {
    const onReset = vi.fn();
    render(<ResetControl hasData onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset analysis" }));
    await userEvent.click(screen.getByRole("button", { name: /^Reset$/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
