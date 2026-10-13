import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ObjectDetailsHUD } from "../components/3d/ObjectDetailsHUD";
import type { Obstacle } from "../lib/3d/obstacles";
import type { Tree } from "../lib/3d/treeTypes";
import type { PanelSet } from "../lib/3d/panelSets";
import { DEFAULT_PANEL_CONFIG } from "../lib/3d/panels";

describe("ObjectDetailsHUD", () => {
  const sampleObstacle: Obstacle = {
    id: "obs-1",
    type: "water-tank",
    position: { x: 5.2, y: 3.8 },
    width: 2.0,
    length: 1.5,
    height: 1.8,
    rotation: 45,
  };

  const sampleTree: Tree = {
    id: "tree-1",
    type: "broadleaf",
    position: { x: -8.5, y: 12.0 },
    height: 9.0,
    canopyWidth: 6.0,
    rotation: 0,
  };

  const samplePanelSet: PanelSet = {
    id: "panel-set-1",
    name: "Panel set 1",
    config: {
      ...DEFAULT_PANEL_CONFIG,
      panelTypeId: "panel-550w",
      mounting: "ground_fixed",
      tiltDeg: 28,
      azimuthDeg: 180,
      mountHeightM: 0.5,
      setbackM: 0.5,
      rowSpacingM: 0.2,
      setRows: 2,
      setCols: 5,
      legRows: 2,
      legCols: 5,
    },
    mode: "auto",
    panels: [
      { index: 0, x: 2.0, y: 4.0, rotationDeg: 0 },
      { index: 1, x: 4.28, y: 4.0, rotationDeg: 0 },
    ],
    userModified: false,
  };

  it("renders nothing when no object is selected", () => {
    const { container } = render(
      <ObjectDetailsHUD
        activeTool="select"
        onToolChange={vi.fn()}
        selectedObstacle={null}
        selectedTree={null}
        selectedPanelInfo={null}
        panelSets={[samplePanelSet]}
        selectedBuilding={false}
        buildingHeightM={15}
        parapetHeightM={1}
        metrics={null}
        installationType="rooftop"
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("displays obstacle details with dimensions, coordinates and locked move mode when in select tool", () => {
    const onToolChange = vi.fn();
    const onClose = vi.fn();

    render(
      <ObjectDetailsHUD
        activeTool="select"
        onToolChange={onToolChange}
        selectedObstacle={sampleObstacle}
        selectedTree={null}
        selectedPanelInfo={null}
        panelSets={[samplePanelSet]}
        selectedBuilding={false}
        buildingHeightM={15}
        parapetHeightM={1}
        metrics={null}
        installationType="rooftop"
        onClose={onClose}
      />
    );

    // Shows obstacle title and subtitle
    expect(screen.getByText(/Water Tank/i)).toBeInTheDocument();
    expect(screen.getByText(/Rooftop obstacle/i)).toBeInTheDocument();

    // Shows Select Mode badge (Moving locked)
    expect(screen.getByText(/Select Mode · Moving locked/i)).toBeInTheDocument();

    // Shows real-world dimensions and coordinates
    expect(screen.getByText(/2.00 m × 1.50 m/i)).toBeInTheDocument();
    expect(screen.getByText("1.8 m")).toBeInTheDocument();
    expect(screen.getByText(/E 5.2 m, N 3.8 m/i)).toBeInTheDocument();

    // Clicking 'Move Object' requests switching to move tool
    fireEvent.click(screen.getByRole("button", { name: /Move Object/i }));
    expect(onToolChange).toHaveBeenCalledWith("move");

    // Clicking close button calls onClose
    fireEvent.click(screen.getByRole("button", { name: /Close details/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows active move tool badge and toggle when move tool is active", () => {
    const onToolChange = vi.fn();

    render(
      <ObjectDetailsHUD
        activeTool="move"
        onToolChange={onToolChange}
        selectedObstacle={sampleObstacle}
        selectedTree={null}
        selectedPanelInfo={null}
        panelSets={[samplePanelSet]}
        selectedBuilding={false}
        buildingHeightM={15}
        parapetHeightM={1}
        metrics={null}
        installationType="rooftop"
        onClose={vi.fn()}
      />
    );

    // Shows Move Tool Active badge
    expect(screen.getByText(/Move Tool Active · Drag to move/i)).toBeInTheDocument();

    // Shows button indicating moving is active
    const moveBtn = screen.getByRole("button", { name: /Moving Active/i });
    expect(moveBtn).toBeInTheDocument();

    // Clicking toggles back to select tool
    fireEvent.click(moveBtn);
    expect(onToolChange).toHaveBeenCalledWith("select");
  });

  it("displays ground tree details correctly", () => {
    render(
      <ObjectDetailsHUD
        activeTool="select"
        onToolChange={vi.fn()}
        selectedObstacle={null}
        selectedTree={sampleTree}
        selectedPanelInfo={null}
        panelSets={[samplePanelSet]}
        selectedBuilding={false}
        buildingHeightM={15}
        parapetHeightM={1}
        metrics={null}
        installationType="ground"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Broadleaf Tree")).toBeInTheDocument();
    expect(screen.getByText("9.0 m")).toBeInTheDocument();
    expect(screen.getByText("6.0 m")).toBeInTheDocument();
    expect(screen.getByText(/E -8.5 m, N 12.0 m/i)).toBeInTheDocument();
  });

  it("displays solar panel module details including tilt, azimuth and array capacity", () => {
    render(
      <ObjectDetailsHUD
        activeTool="select"
        onToolChange={vi.fn()}
        selectedObstacle={null}
        selectedTree={null}
        selectedPanelInfo={{ setId: "panel-set-1", panelIndex: 0, panelId: "p-0" }}
        panelSets={[samplePanelSet]}
        selectedBuilding={false}
        buildingHeightM={15}
        parapetHeightM={1}
        metrics={null}
        installationType="ground"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Panel set 1 · Module #1/i)).toBeInTheDocument();
    expect(screen.getByText(/550 W/i)).toBeInTheDocument();
    expect(screen.getByText("28°")).toBeInTheDocument();
    expect(screen.getByText("180° (S)")).toBeInTheDocument();
    expect(screen.getByText(/2 modules \(1.10 kWp\)/i)).toBeInTheDocument();
    expect(screen.getByText(/E 2.00 m, N 4.00 m/i)).toBeInTheDocument();
  });
});
