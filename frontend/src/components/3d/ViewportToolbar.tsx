/**
 * ViewportToolbar - Contextual tools overlay on the 3D viewport
 *
 * Compact floating toolbar anchored to the viewport (not the inspector),
 * showing only the tools relevant to the current mode. Mirrors the map
 * toolbar's visual language so the transition feels consistent.
 *
 * AGENTS.md §48: professional, minimal, engineering-oriented.
 * AGENTS.md §46: 44px touch targets on mobile.
 */

import { Select, PenTool, Move, Trash2, Layers, RotateCcw, Eye, Box, Sun, TreePine } from "lucide-react";
import type { ObstacleType } from "../../lib/3d/obstacles";

export type ViewportTool =
  | "select"
  | "draw-obstacle"
  | "move"
  | "delete"
  | "layers"
  | "xray"
  | "reset-view"
  | "sun"
  | "weather"
  | "trees";

interface ViewportToolbarProps {
  /** Currently active tool */
  activeTool: ViewportTool | null;
  /** Callback when a tool is selected */
  onToolChange: (tool: ViewportTool | null) => void;
  /** Whether X-ray mode is active */
  xrayActive: boolean;
  /** Toggle X-ray mode */
  onToggleXray: () => void;
  /** Reset camera to default view */
  onResetView: () => void;
  /** Current obstacle type for draw mode (Custom obstacles only) */
  obstacleType?: ObstacleType;
  /** Whether we're in footprint drawing mode */
  drawing?: boolean;
  /** Whether manual panel placement is active */
  manualPlaceActive?: boolean;
  /** Manual placement mode: single panel or whole set */
  manualPlaceMode?: "single" | "set";
  /** Sun simulation playing state */
  sunPlaying?: boolean;
  /** Toggle sun playback */
  onToggleSunPlay?: () => void;
  /** Whether the inspector is collapsed (mobile) */
  inspectorCollapsed?: boolean;
}

const TOOL_CONFIG: Record<Exclude<ViewportTool, "draw-obstacle">, { icon: React.ReactNode; label: string; title: string }> = {
  select: { icon: <Select size={16} strokeWidth={2} />, label: "Select", title: "Select objects (V)" },
  move: { icon: <Move size={16} strokeWidth={2} />, label: "Move", title: "Move selected object (M)" },
  delete: { icon: <Trash2 size={16} strokeWidth={2} />, label: "Delete", title: "Delete selected object (Del)" },
  layers: { icon: <Layers size={16} strokeWidth={2} />, label: "Layers", title: "Toggle layer visibility (L)" },
  xray: { icon: <Eye size={16} strokeWidth={2} />, label: "X-ray", title: "Toggle X-ray view (X)" },
  "reset-view": { icon: <RotateCcw size={16} strokeWidth={2} />, label: "Reset view", title: "Reset camera to default (R)" },
  sun: { icon: <Sun size={16} strokeWidth={2} />, label: "Sun", title: "Sun & shadows (S)" },
  weather: { icon: <Box size={16} strokeWidth={2} />, label: "Weather", title: "Weather presets (W)" },
  trees: { icon: <TreePine size={16} strokeWidth={2} />, label: "Trees", title: "Trees & obstacles (T)" },
};

const DRAW_OBSTACLE_CONFIG: Record<ObstacleType, { icon: React.ReactNode; label: string; title: string }> = {
  water_tank: { icon: <Box size={16} strokeWidth={2} />, label: "Water tank", title: "Draw water tank footprint" },
  stair_room: { icon: <Box size={16} strokeWidth={2} />, label: "Stair room", title: "Draw stair room footprint" },
  lift_room: { icon: <Box size={16} strokeWidth={2} />, label: "Lift room", title: "Draw lift room footprint" },
  hvac: { icon: <Box size={16} strokeWidth={2} />, label: "HVAC", title: "Draw HVAC unit footprint" },
  ac_unit: { icon: <Box size={16} strokeWidth={2} />, label: "AC unit", title: "Draw AC unit footprint" },
  parapet: { icon: <Box size={16} strokeWidth={2} />, label: "Parapet", title: "Draw parapet footprint" },
  utility_room: { icon: <Box size={16} strokeWidth={2} />, label: "Utility room", title: "Draw utility room footprint" },
  custom: { icon: <PenTool size={16} strokeWidth={2} />, label: "Custom", title: "Draw custom footprint" },
};

export function ViewportToolbar({
  activeTool,
  onToolChange,
  xrayActive,
  onToggleXray,
  onResetView,
  obstacleType = "custom",
  drawing = false,
  manualPlaceActive = false,
  manualPlaceMode = "single",
  sunPlaying = false,
  onToggleSunPlay,
  inspectorCollapsed = false,
}: ViewportToolbarProps) {
  // Primary tools: always visible
  const primaryTools: ViewportTool[] = ["select", "move", "delete", "layers"];

  // Mode tools: visible when relevant
  const modeTools: ViewportTool[] = [];
  if (drawing || obstacleType === "custom") modeTools.push("draw-obstacle");
  if (manualPlaceActive) modeTools.push("sun"); // Sun affects panel preview shadows
  if (sunPlaying !== undefined) modeTools.push("sun");
  modeTools.push("weather", "trees");

  // View tools: always visible
  const viewTools: ViewportTool[] = ["xray", "reset-view"];

  const handleToolClick = (tool: ViewportTool) => {
    onToolChange(activeTool === tool ? null : tool);
  };

  const renderToolButton = (tool: ViewportTool, isActive: boolean) => {
    if (tool === "draw-obstacle") {
      const config = DRAW_OBSTACLE_CONFIG[obstacleType];
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${isActive ? " is-active" : ""}`}
          onClick={() => handleToolClick(tool)}
          title={config.title}
          aria-pressed={isActive}
          aria-label={config.title}
        >
          {config.icon}
          <span className="viewport-tool__label">{config.label}</span>
        </button>
      );
    }

    if (tool === "xray") {
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${xrayActive ? " is-active" : ""}`}
          onClick={onToggleXray}
          title="Toggle X-ray view (X)"
          aria-pressed={xrayActive}
          aria-label="Toggle X-ray view"
        >
          <Eye size={16} strokeWidth={2} />
          <span className="viewport-tool__label">X-ray</span>
        </button>
      );
    }

    if (tool === "reset-view") {
      return (
        <button
          key={tool}
          type="button"
          className="viewport-tool"
          onClick={onResetView}
          title="Reset camera to default (R)"
          aria-label="Reset camera to default view"
        >
          <RotateCcw size={16} strokeWidth={2} />
          <span className="viewport-tool__label">Reset view</span>
        </button>
      );
    }

    if (tool === "sun") {
      return (
        <button
          key={tool}
          type="button"
          className={`viewport-tool${sunPlaying ? " is-playing" : ""}${activeTool === "sun" ? " is-active" : ""}`}
          onClick={onToggleSunPlay}
          title={sunPlaying ? "Pause sun simulation" : "Play sun simulation"}
          aria-pressed={sunPlaying}
          aria-label={sunPlaying ? "Pause sun simulation" : "Play sun simulation"}
        >
          {sunPlaying ? (
            <>
              <span className="viewport-tool__icon" style={{ display: "flex" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              </span>
              <span className="viewport-tool__label">Pause</span>
            </>
          ) : (
            <>
              <Sun size={16} strokeWidth={2} />
              <span className="viewport-tool__label">Play day</span>
            </>
          )}
        </button>
      );
    }

    const config = TOOL_CONFIG[tool];
    return (
      <button
        key={tool}
        type="button"
        className={`viewport-tool${isActive ? " is-active" : ""}`}
        onClick={() => handleToolClick(tool)}
        title={config.title}
        aria-pressed={isActive}
        aria-label={config.title}
      >
        <span className="viewport-tool__icon">{config.icon}</span>
        <span className="viewport-tool__label">{config.label}</span>
      </button>
    );
  };

  return (
    <div className="viewport-toolbar" role="toolbar" aria-label="Viewport tools">
      <div className="viewport-toolbar__group" aria-label="Primary tools">
        {primaryTools.map((tool) => renderToolButton(tool, activeTool === tool))}
      </div>

      <div className="viewport-toolbar__divider" aria-hidden="true" />

      <div className="viewport-toolbar__group" aria-label="Mode tools">
        {modeTools.map((tool) => renderToolButton(tool, activeTool === tool))}
      </div>

      <div className="viewport-toolbar__divider" aria-hidden="true" />

      <div className="viewport-toolbar__group" aria-label="View tools">
        {viewTools.map((tool) => renderToolButton(tool, activeTool === tool))}
      </div>

      {inspectorCollapsed && (
        <button
          type="button"
          className="viewport-tool viewport-tool--inspector-toggle"
          onClick={() => onToolChange("layers")}
          title="Open inspector"
          aria-label="Open inspector panel"
        >
          <Layers size={16} strokeWidth={2} />
          <span className="viewport-tool__label">Inspector</span>
        </button>
      )}
    </div>
  );
}

export default ViewportToolbar;