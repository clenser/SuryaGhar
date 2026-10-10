/**
 * Tests for the compact obstacle form (Phase 3).
 *
 * The form is controlled: it emits draft changes and leaves validation to the
 * deterministic domain module, so these tests focus on the interaction contract
 * (type presets, field updates, submit/cancel, error display).
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ObstacleEditor } from "../components/3d/ObstacleEditor";
import { emptyObstacleDraft, type ObstacleDraft, type ObstacleType } from "../lib/3d/obstacles";

type EditorProps = Parameters<typeof ObstacleEditor>[0];

type EditorPropsWithMocks = EditorProps & {
  onDraftChange: Mock<(draft: ObstacleDraft) => void>;
  onTypeChange: Mock<(type: ObstacleType) => void>;
  onSubmit: Mock<() => void>;
  onCancel: Mock<() => void>;
};

/**
 * Keeps the draft in state exactly like the real parent does, so typing behaves
 * like it does in the app while still recording every emitted change.
 */
function Harness(props: EditorProps) {
  const [draft, setDraft] = useState<ObstacleDraft>(props.draft);
  return (
    <ObstacleEditor
      {...props}
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        props.onDraftChange(next);
      }}
    />
  );
}

function renderEditor(overrides: Partial<Pick<EditorProps, "mode" | "draft" | "error">> = {}) {
  const props: EditorPropsWithMocks = {
    ...overrides,
    mode: overrides.mode ?? "adding",
    draft: overrides.draft ?? emptyObstacleDraft(),
    error: overrides.error ?? null,
    onDraftChange: vi.fn<(draft: ObstacleDraft) => void>(),
    onTypeChange: vi.fn<(type: ObstacleType) => void>(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };
  return { ...render(<Harness {...props} />), props };
}

describe("ObstacleEditor", () => {
  it("shows every editable property with its unit", () => {
    renderEditor();

    expect(screen.getByLabelText("Obstacle type")).toBeInTheDocument();
    expect(screen.getByLabelText("Length")).toBeInTheDocument();
    expect(screen.getByLabelText("Width")).toBeInTheDocument();
    expect(screen.getByLabelText("Height")).toBeInTheDocument();
    expect(screen.getByLabelText("Rotation")).toBeInTheDocument();
    expect(screen.getByLabelText("Position east")).toBeInTheDocument();
    expect(screen.getByLabelText("Position north")).toBeInTheDocument();
  });

  it("preselects the draft's obstacle type", () => {
    renderEditor({ draft: emptyObstacleDraft("hvac") });

    expect(screen.getByLabelText("Obstacle type")).toHaveValue("hvac");
  });

  it("offers every catalog category", () => {
    renderEditor();

    const options = screen
      .getAllByRole("option")
      .map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["hvac", "water-tank", "staircase-room", "lift-room", "custom"]);
  });

  it("asks the parent to load preset dimensions when the type changes", async () => {
    const { props } = renderEditor();

    await userEvent.selectOptions(screen.getByLabelText("Obstacle type"), "lift-room");

    expect(props.onTypeChange).toHaveBeenCalledWith("lift-room");
  });

  it("emits the updated draft as fields are typed", async () => {
    const { props } = renderEditor();

    const height = screen.getByLabelText("Height");
    await userEvent.clear(height);
    await userEvent.type(height, "3.5");

    expect(props.onDraftChange).toHaveBeenCalled();
    const last = props.onDraftChange.mock.calls.at(-1)![0];
    expect(last.height).toBe("3.5");
    expect(last.type).toBe("water-tank"); // untouched fields are preserved
  });

  it("emits position changes", async () => {
    const { props } = renderEditor();

    const east = screen.getByLabelText("Position east");
    await userEvent.clear(east);
    await userEvent.type(east, "6.25");

    const last = props.onDraftChange.mock.calls.at(-1)![0];
    expect(last.x).toBe("6.25");
  });

  it("submits the form", async () => {
    const { props } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: "Add obstacle" }));

    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("labels the submit action for editing", () => {
    renderEditor({ mode: "editing" });

    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByText("Edit obstacle")).toBeInTheDocument();
  });

  it("cancels without submitting", async () => {
    const { props } = renderEditor();

    await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces the validation error in an alert", () => {
    renderEditor({ error: "Width must be greater than 0" });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Width must be greater than 0");
  });

  it("shows no alert when the draft is valid", () => {
    renderEditor({ error: null });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
